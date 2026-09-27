// Node side of the out-of-process baseline (kernel/service/baseline/service.bend).
// One long-lived child process, framed binary messages over its stdin/stdout.
// Every failure path rejects with a NativeKernelError; nothing falls back to
// the JS target and no request can wait forever (per-request timeout).
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export const MAGIC_REQUEST = 0x31424b57; // "WKB1" little-endian
export const MAGIC_RESPONSE = 0x31524b57; // "WKR1" little-endian
export const HEADER_BYTES = 16;
export const MAX_PAYLOAD = 64 * 1024 * 1024;
export const PROTOCOL_VERSION = 1;
export const OP = Object.freeze({ ping: 0, echo: 1, words: 2, store: 3, load: 4, kernel: 5, replay: 6 });
export const STATUS = Object.freeze({ 0: 'ok', 1: 'unknown-op', 2: 'bad-payload', 3: 'bad-magic', 4: 'too-large', 5: 'short-header' });

export class NativeKernelError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'NativeKernelError';
    Object.assign(this, details);
  }
}

export function encodeRequest(op, id, payload = new Uint8Array(0)) {
  const frame = Buffer.allocUnsafe(HEADER_BYTES + payload.length);
  frame.writeUInt32LE(MAGIC_REQUEST, 0);
  frame.writeUInt32LE(op, 4);
  frame.writeUInt32LE(id, 8);
  frame.writeUInt32LE(payload.length, 12);
  frame.set(payload, HEADER_BYTES);
  return frame;
}

export class ProcessKernel {
  #child; #pending = new Map(); #nextId = 1; #chunks = []; #buffered = 0;
  #failure = null; #stderr = ''; #stdinError = null; #exit;

  constructor(child, { requestTimeoutMs }) {
    this.#child = child;
    this.pid = child.pid;
    this.requestTimeoutMs = requestTimeoutMs;
    this.exited = new Promise(resolve => { this.#exit = resolve; });
    child.stdout.on('data', chunk => this.#receive(chunk));
    child.stderr.on('data', chunk => { this.#stderr = (this.#stderr + chunk).slice(-4096); });
    // EPIPE on a dead child must not become an uncaught exception. The exit
    // reason from 'close' is the better error, but it is not waited for long.
    child.stdin.on('error', error => {
      this.#stdinError ??= error.code ?? error.message;
      setTimeout(() => this.#fail(`native kernel stdin failed: ${this.#stdinError}`, { cause: error }), 1000).unref();
    });
    child.on('error', error => this.#fail(`native kernel process error: ${error.message}`, { cause: error }));
    child.on('close', (code, signal) => {
      const stdin = this.#stdinError ? `, stdin ${this.#stdinError}` : '';
      this.#fail(`native kernel process exited (code=${code}, signal=${signal})${stdin}`, { code, signal });
      this.#exit({ code, signal, stderr: this.#stderr });
    });
  }

  static async start(binary, { args = [], threads = 1, requestTimeoutMs = 30000, startTimeoutMs = 10000 } = {}) {
    const started = performance.now();
    const child = spawn(binary, [...args, '--threads', String(threads), '--gpu', 'off'], { env: { ...process.env, BEND_NO_TELEMETRY: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const kernel = new ProcessKernel(child, { requestTimeoutMs });
    const ready = await kernel.#await(0, startTimeoutMs, 'READY frame');
    if (ready.payload.length !== 4 || ready.payload.readUInt32LE(0) !== PROTOCOL_VERSION) {
      kernel.kill();
      throw new NativeKernelError(`native kernel speaks an unexpected protocol version`, { payload: ready.payload });
    }
    kernel.startMs = performance.now() - started;
    return kernel;
  }

  get stderr() { return this.#stderr; }
  get alive() { return this.#failure === null; }

  request(op, payload = new Uint8Array(0)) {
    if (this.#failure) return Promise.reject(this.#failure);
    if (payload.length > MAX_PAYLOAD) return Promise.reject(new NativeKernelError(`payload of ${payload.length} bytes exceeds ${MAX_PAYLOAD}`));
    const id = this.#nextId++;
    const response = this.#await(id, this.requestTimeoutMs, `response to request ${id} (op ${op})`);
    this.writeRaw(encodeRequest(op, id, payload));
    return response.then(frame => {
      if (frame.status !== 0) {
        throw new NativeKernelError(`native kernel rejected request ${id}: ${STATUS[frame.status] ?? `status ${frame.status}`}: ${frame.payload.toString('utf8')}`, { status: frame.status });
      }
      return frame.payload;
    });
  }

  // Raw bytes for malformed-input tests; production callers use request().
  writeRaw(bytes) {
    if (!this.#failure && !this.#stdinError) this.#child.stdin.write(bytes);
  }

  // Frames addressed to id 0 (READY, fatal protocol errors) or to a raw id.
  expect(id, timeoutMs = this.requestTimeoutMs) { return this.#await(id, timeoutMs, `frame ${id}`); }

  async close(timeoutMs = 5000) {
    this.#child.stdin.end();
    const timer = setTimeout(() => this.kill(), timeoutMs);
    const result = await this.exited;
    clearTimeout(timer);
    return result;
  }

  kill(signal = 'SIGKILL') { this.#child.kill(signal); }

  #await(id, timeoutMs, what) {
    if (this.#failure) return Promise.reject(this.#failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // The stream position is unknown after a timeout: the process is unusable.
        this.#fail(`native kernel did not answer ${what} within ${timeoutMs} ms`, { timeout: true });
        this.kill();
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
    });
  }

  #fail(message, details = {}) {
    if (!this.#failure) this.#failure = new NativeKernelError(message, details);
    const error = this.#failure;
    error.stderr = this.#stderr;
    for (const { reject, timer } of this.#pending.values()) { clearTimeout(timer); reject(error); }
    this.#pending.clear();
  }

  #receive(chunk) {
    this.#chunks.push(chunk);
    this.#buffered += chunk.length;
    while (this.#buffered >= HEADER_BYTES) {
      const head = this.#chunks[0].length >= HEADER_BYTES ? this.#chunks[0] : this.#flatten();
      const magic = head.readUInt32LE(0), status = head.readUInt32LE(4), id = head.readUInt32LE(8), length = head.readUInt32LE(12);
      if (magic !== MAGIC_RESPONSE || length > MAX_PAYLOAD) {
        this.#fail(`native kernel protocol violation: magic 0x${magic.toString(16)}, length ${length}`, { protocol: true });
        this.kill();
        return;
      }
      if (this.#buffered < HEADER_BYTES + length) return;
      const all = this.#flatten();
      const payload = all.subarray(HEADER_BYTES, HEADER_BYTES + length);
      const rest = all.subarray(HEADER_BYTES + length);
      this.#chunks = rest.length ? [rest] : [];
      this.#buffered = rest.length;
      // A fatal frame may carry id 0 (the id was unreadable): it answers the oldest request.
      const key = this.#pending.has(id) ? id : status !== 0 ? this.#pending.keys().next().value : undefined;
      if (key === undefined) {
        this.#fail(`native kernel sent an unsolicited frame for id ${id} (status ${status})`, { protocol: true });
        this.kill();
        return;
      }
      const waiter = this.#pending.get(key);
      this.#pending.delete(key);
      clearTimeout(waiter.timer);
      waiter.resolve({ status, id, payload });
    }
  }

  #flatten() {
    const all = this.#chunks.length === 1 ? this.#chunks[0] : Buffer.concat(this.#chunks, this.#buffered);
    this.#chunks = [all];
    return all;
  }
}
