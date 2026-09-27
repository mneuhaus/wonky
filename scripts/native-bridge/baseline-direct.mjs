// Blocking out-of-process client without a thread hop.
//
// The FeatureScript interpreter calls the kernel synchronously. Instead of
// bridging to an async client in a worker (baseline-sync.mjs), the calling
// thread here writes and reads the service's pipes itself with blocking
// fs.writeSync / fs.readSync. Node has no pipe(2), so the pipes are two FIFOs
// opened in blocking mode in an order that never blocks in open():
//   FIFO x: open O_RDWR (helper), then the two plain ends, then close the helper.
// The child gets the request read end as stdin and the response write end as
// stdout; the parent keeps only the opposite ends (O_CLOEXEC, so no other
// child inherits them). A dead child therefore means EOF / EPIPE at once.
//
// A blocked read cannot time out by itself, so a watchdog thread kills the
// child with SIGKILL when an armed deadline passes; the read then ends with
// EOF and the request throws NativeKernelError with timeout: true. Nothing
// here falls back to the JS target.
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { HEADER_BYTES, MAGIC_RESPONSE, MAX_PAYLOAD, NativeKernelError, PROTOCOL_VERSION, STATUS, encodeRequest } from './baseline-client.mjs';

// Watchdog control words (Int32): armed request id (0 = idle), deadline in ms
// after `base`, fired flag, stop flag, sleep slot.
const ARMED = 0, DEADLINE = 1, FIRED = 2, STOP = 3, SLEEP = 4;
const WATCHDOG = `
const { workerData } = require('node:worker_threads');
const ctrl = new Int32Array(workerData.control);
for (;;) {
  if (Atomics.load(ctrl, ${STOP})) break;
  const armed = Atomics.load(ctrl, ${ARMED});
  if (armed !== 0 && Date.now() - workerData.base > Atomics.load(ctrl, ${DEADLINE}) && Atomics.load(ctrl, ${ARMED}) === armed) {
    Atomics.store(ctrl, ${FIRED}, armed);
    try { process.kill(workerData.pid, 'SIGKILL'); } catch {}
    break;
  }
  Atomics.wait(ctrl, ${SLEEP}, 0, workerData.pollMs);
}`;

// Two FIFOs as blocking pipes: the parent's write/read ends and the child's
// stdin/stdout ends. The FIFO paths are unlinked before returning.
export function openBlockingPipes() {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-nb-'));
  const requestPath = join(dir, 'request'), responsePath = join(dir, 'response');
  try {
    execFileSync('mkfifo', [requestPath, responsePath]);
    const helperIn = openSync(requestPath, 'r+'), helperOut = openSync(responsePath, 'r+');
    const pipes = { parentWrite: openSync(requestPath, 'w'), childIn: openSync(requestPath, 'r'), parentRead: openSync(responsePath, 'r'), childOut: openSync(responsePath, 'w') };
    closeSync(helperIn); closeSync(helperOut);
    return pipes;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export class DirectProcessKernel {
  #child; #request; #response; #control; #base; #watchdog; #nextId = 1; #failure = null; #stderr = '';
  #head = Buffer.alloc(HEADER_BYTES); #armed = { what: '', ms: 0 };

  static start(binary, { threads = 1, requestTimeoutMs = 30000, startTimeoutMs = 10000, watchdogPollMs = 20 } = {}) {
    const started = performance.now();
    const kernel = new DirectProcessKernel();
    kernel.requestTimeoutMs = requestTimeoutMs;
    const { parentWrite, parentRead, childIn, childOut } = openBlockingPipes();
    kernel.#request = parentWrite;
    kernel.#response = parentRead;
    kernel.#child = spawn(binary, ['--threads', String(threads), '--gpu', 'off'], { stdio: [childIn, childOut, 'pipe'], env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
    closeSync(childIn); closeSync(childOut);
    kernel.pid = kernel.#child.pid;
    kernel.#child.stderr.on('data', chunk => { kernel.#stderr = (kernel.#stderr + chunk).slice(-4096); });
    kernel.exited = new Promise(resolve => kernel.#child.on('close', (code, signal) => resolve({ code, signal, stderr: kernel.#stderr })));
    if (!kernel.pid) throw new NativeKernelError(`native kernel could not be spawned: ${binary}`);
    kernel.#control = new Int32Array(new SharedArrayBuffer(32));
    kernel.#base = Date.now();
    kernel.#watchdog = new Worker(WATCHDOG, { eval: true, workerData: { control: kernel.#control.buffer, base: kernel.#base, pid: kernel.pid, pollMs: watchdogPollMs } });
    kernel.#watchdog.unref();
    const ready = kernel.#exchange(null, 0, startTimeoutMs, 'READY frame');
    if (ready.length !== 4 || ready.readUInt32LE(0) !== PROTOCOL_VERSION) {
      kernel.kill();
      throw new NativeKernelError('native kernel speaks an unexpected protocol version');
    }
    kernel.startMs = performance.now() - started;
    return kernel;
  }

  get alive() { return this.#failure === null; }
  get stderr() { return this.#stderr; }

  request(op, payload = new Uint8Array(0)) {
    if (this.#failure) throw this.#failure;
    if (payload.length > MAX_PAYLOAD) throw new NativeKernelError(`payload of ${payload.length} bytes exceeds ${MAX_PAYLOAD}`);
    const id = this.#nextId++;
    return this.#exchange(encodeRequest(op, id, payload), id, this.requestTimeoutMs, `response to request ${id} (op ${op})`);
  }

  // stdin EOF, then the exit record (async: the exit status arrives through the event loop).
  async close() {
    if (!this.#failure) { this.#failure = new NativeKernelError('native kernel client is closed'); closeSync(this.#request); }
    this.#stopWatchdog();
    const exit = await this.exited;
    try { closeSync(this.#response); } catch { /* already closed */ }
    return exit;
  }

  kill(signal = 'SIGKILL') { try { process.kill(this.pid, signal); } catch { /* already gone */ } }

  #stopWatchdog() {
    Atomics.store(this.#control, STOP, 1);
    Atomics.notify(this.#control, SLEEP);
  }

  #exchange(frame, id, timeoutMs, what) {
    this.#armed = { what, ms: timeoutMs };
    Atomics.store(this.#control, DEADLINE, Date.now() - this.#base + timeoutMs);
    Atomics.store(this.#control, ARMED, id === 0 ? -1 : id);
    try {
      if (frame) this.#write(frame);
      this.#read(this.#head, HEADER_BYTES);
      const magic = this.#head.readUInt32LE(0), status = this.#head.readUInt32LE(4), answerId = this.#head.readUInt32LE(8), length = this.#head.readUInt32LE(12);
      if (magic !== MAGIC_RESPONSE || length > MAX_PAYLOAD || (answerId !== id && status === 0)) {
        this.kill();
        throw this.#fatal(`native kernel protocol violation: magic 0x${magic.toString(16)}, id ${answerId} for ${id}, length ${length}`, { protocol: true });
      }
      const payload = Buffer.allocUnsafe(length);
      this.#read(payload, length);
      if (status !== 0) {
        // Status 3..5 end the process; later requests must not wait for it.
        if (status >= 3) this.#failure = new NativeKernelError(`native kernel ended the stream: ${STATUS[status]}: ${payload.toString('utf8')}`, { status });
        throw new NativeKernelError(`native kernel rejected request ${id}: ${STATUS[status] ?? `status ${status}`}: ${payload.toString('utf8')}`, { status });
      }
      return payload;
    } finally {
      Atomics.store(this.#control, ARMED, 0);
    }
  }

  #fatal(message, details = {}) {
    const fired = Atomics.load(this.#control, FIRED) !== 0;
    this.#failure ??= new NativeKernelError(fired ? `native kernel did not deliver the ${this.#armed.what} within ${this.#armed.ms} ms; the watchdog killed it` : message, { ...details, timeout: fired });
    this.#stopWatchdog();
    return this.#failure;
  }

  #write(frame) {
    let at = 0;
    try {
      while (at < frame.length) at += writeSync(this.#request, frame, at, frame.length - at);
    } catch (error) {
      throw this.#fatal(`native kernel request pipe failed: ${error.code ?? error.message} (process ended)`, { cause: error });
    }
  }

  #read(target, length) {
    let at = 0;
    while (at < length) {
      let got;
      try { got = readSync(this.#response, target, at, length - at, null); } catch (error) {
        throw this.#fatal(`native kernel response pipe failed: ${error.code ?? error.message}`, { cause: error });
      }
      if (got === 0) throw this.#fatal('native kernel process closed its output (exited or was killed)', { eof: true });
      at += got;
    }
  }
}
