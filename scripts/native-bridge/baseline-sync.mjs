// Synchronous facade over the out-of-process baseline.
//
// The FeatureScript interpreter and the build123d shim call the kernel
// synchronously (k.fn(...) returns the result). An out-of-process kernel is
// therefore either an async rewrite of the interpreter or a blocking bridge.
// This is the blocking bridge: a worker thread owns the child process through
// ProcessKernel (async pipes); the calling thread copies the request into a
// SharedArrayBuffer and blocks in Atomics.wait until the worker has put the
// answer there. Every wait has a deadline, every failure is a thrown
// NativeKernelError; nothing falls back to the JS target.
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { MAX_PAYLOAD, NativeKernelError, ProcessKernel } from './baseline-client.mjs';

const ROLE = 'wonky-baseline-sync-worker';
// Control words (Int32).
const STATE = 0, OPCODE = 1, LENGTH = 2, CODE = 3, PID = 4;
// States: the calling thread moves STARTING/ANSWERED -> REQUESTED or CLOSING,
// the worker moves REQUESTED -> ANSWERED | FAILED and CLOSING -> CLOSED.
const STARTING = 1, REQUESTED = 2, ANSWERED = 3, FAILED = 4, CLOSING = 5, CLOSED = 6;
const encoder = new TextEncoder(), decoder = new TextDecoder();

export class SyncProcessKernel {
  #worker; #control; #data; #failure = null; #timeoutMs;

  // Blocks until the service has sent READY or the start deadline passed.
  static start(binary, { threads = 1, requestTimeoutMs = 30000, startTimeoutMs = 10000, capacity = MAX_PAYLOAD + 65536, backstopMs = 2000 } = {}) {
    const started = performance.now();
    const kernel = new SyncProcessKernel();
    kernel.#control = new Int32Array(new SharedArrayBuffer(64));
    kernel.#data = new Uint8Array(new SharedArrayBuffer(capacity));
    // The worker's own ProcessKernel times out first; the backstop only covers
    // a worker that cannot answer at all.
    kernel.#timeoutMs = requestTimeoutMs + backstopMs;
    Atomics.store(kernel.#control, STATE, STARTING);
    kernel.#worker = new Worker(fileURLToPath(import.meta.url), {
      workerData: { role: ROLE, binary, threads, requestTimeoutMs, startTimeoutMs, control: kernel.#control.buffer, data: kernel.#data.buffer },
    });
    kernel.#worker.unref();
    kernel.#wait(STARTING, startTimeoutMs + backstopMs, 'READY');
    kernel.pid = Atomics.load(kernel.#control, PID);
    kernel.startMs = performance.now() - started;
    return kernel;
  }

  get alive() { return this.#failure === null; }
  // Exit details as far as the worker reported them (the child's exit event
  // is the worker's, not this thread's).
  get exited() { return Promise.resolve(this.#failure ? { code: this.#failure.code ?? null, signal: this.#failure.signal ?? null, timeout: Boolean(this.#failure.timeout) } : null); }

  request(op, payload = new Uint8Array(0)) {
    if (this.#failure) throw this.#failure;
    if (payload.length > MAX_PAYLOAD || payload.length > this.#data.length) throw new NativeKernelError(`payload of ${payload.length} bytes exceeds the bridge capacity`);
    this.#data.set(payload);
    Atomics.store(this.#control, OPCODE, op);
    Atomics.store(this.#control, LENGTH, payload.length);
    Atomics.store(this.#control, STATE, REQUESTED);
    Atomics.notify(this.#control, STATE);
    this.#wait(REQUESTED, this.#timeoutMs, `response (op ${op})`);
    const status = Atomics.load(this.#control, CODE), length = Atomics.load(this.#control, LENGTH);
    const answer = Buffer.from(this.#data.subarray(0, length));
    // The worker forwards ProcessKernel's message, which names the status.
    if (status !== 0) throw new NativeKernelError(answer.toString('utf8'), { status });
    return answer;
  }

  // Sends stdin EOF, waits for the exit and the worker. Returns the exit record.
  close(timeoutMs = 5000) {
    if (this.#failure) { this.#worker.terminate(); return this.#failure.exit ?? null; }
    Atomics.store(this.#control, STATE, CLOSING);
    Atomics.notify(this.#control, STATE);
    this.#wait(CLOSING, timeoutMs, 'close');
    const exit = JSON.parse(decoder.decode(this.#data.subarray(0, Atomics.load(this.#control, LENGTH))));
    this.#failure = new NativeKernelError('native kernel bridge is closed', { exit });
    return exit;
  }

  kill(signal = 'SIGKILL') { try { process.kill(this.pid, signal); } catch { /* already gone */ } }

  #wait(state, timeoutMs, what) {
    const deadline = performance.now() + timeoutMs;
    while (Atomics.load(this.#control, STATE) === state) {
      const left = deadline - performance.now();
      if (left <= 0 || Atomics.wait(this.#control, STATE, state, left) === 'timed-out') {
        if (Atomics.load(this.#control, STATE) !== state) break;
        this.#failure = new NativeKernelError(`native kernel bridge did not deliver ${what} within ${timeoutMs} ms`, { timeout: true, backstop: true });
        const pid = Atomics.load(this.#control, PID);
        if (pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
        this.#worker.terminate();
        throw this.#failure;
      }
    }
    if (Atomics.load(this.#control, STATE) === FAILED) {
      const details = JSON.parse(decoder.decode(this.#data.subarray(0, Atomics.load(this.#control, LENGTH))));
      this.#failure = new NativeKernelError(details.message, details);
      this.#worker.terminate();
      throw this.#failure;
    }
  }
}

// Worker side
// -----------
async function serveWorker({ binary, threads, requestTimeoutMs, startTimeoutMs, control, data }) {
  const ctrl = new Int32Array(control), bytes = new Uint8Array(data);
  const publish = (state, code, payload) => {
    const length = Math.min(payload.length, bytes.length);
    bytes.set(payload.subarray(0, length));
    Atomics.store(ctrl, LENGTH, length);
    Atomics.store(ctrl, CODE, code);
    Atomics.store(ctrl, STATE, state);
    Atomics.notify(ctrl, STATE);
  };
  const fail = error => publish(FAILED, 0, encoder.encode(JSON.stringify({
    message: error.message, timeout: Boolean(error.timeout), code: error.code ?? null, signal: error.signal ?? null,
    protocol: Boolean(error.protocol), stderr: error.stderr ?? '',
  })));
  process.on('uncaughtException', fail);
  let kernel;
  try {
    kernel = await ProcessKernel.start(binary, { threads, requestTimeoutMs, startTimeoutMs });
  } catch (error) { fail(error); return; }
  Atomics.store(ctrl, PID, kernel.pid);
  publish(ANSWERED, 0, new Uint8Array(0));
  for (;;) {
    const waiting = Atomics.waitAsync(ctrl, STATE, ANSWERED);
    if (waiting.async) await waiting.value;
    const state = Atomics.load(ctrl, STATE);
    if (state === CLOSING) {
      const exit = await kernel.close();
      publish(CLOSED, 0, encoder.encode(JSON.stringify(exit)));
      return;
    }
    if (state !== REQUESTED) continue;
    const op = Atomics.load(ctrl, OPCODE), length = Atomics.load(ctrl, LENGTH);
    try {
      // encodeRequest copies the view into the frame before the write.
      const answer = await kernel.request(op, Buffer.from(bytes.buffer, 0, length));
      publish(ANSWERED, 0, answer);
    } catch (error) {
      if (error instanceof NativeKernelError && error.status !== undefined) publish(ANSWERED, error.status, encoder.encode(error.message));
      else { fail(error); kernel.kill(); return; }
    }
  }
}

if (!isMainThread && workerData?.role === ROLE) await serveWorker(workerData);
