import { test, before } from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("native-bridge-baseline.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { existsSync, readFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { randomBytes } = await import("node:crypto");
const { build, outDir, serviceBinary, sourceSha256 } = await import("../scripts/native-bridge/build-baseline.mjs");
const { ProcessKernel, NativeKernelError, OP, MAGIC_REQUEST, encodeRequest } = await import("../scripts/native-bridge/baseline-client.mjs");
const { KIND, kernelPayload, referenceEvidence, checkEvidence } = await import("../scripts/native-bridge/baseline-reference.mjs");
const { SyncProcessKernel } = await import("../scripts/native-bridge/baseline-sync.mjs");
const { DirectProcessKernel } = await import("../scripts/native-bridge/baseline-direct.mjs");
// Out-of-process baseline: framed pipe protocol against the native Bend
// service. Correctness plus the failure contract: every failure surfaces as an
// explicit NativeKernelError or exit code, never as a hang.











before(async () => {
  const record = existsSync(join(outDir, 'build.json')) ? JSON.parse(readFileSync(join(outDir, 'build.json'), 'utf8')) : null;
  if (!existsSync(serviceBinary) || record?.sourceSha256 !== sourceSha256()) await build();
});

const start = options => ProcessKernel.start(serviceBinary, { requestTimeoutMs: 20000, ...options });
const header = (magic, op, id, len) => {
  const b = Buffer.alloc(16);
  [magic, op, id, len].forEach((w, i) => b.writeUInt32LE(w, 4 * i));
  return b;
};

test('echo, words, store/load and ping round-trip byte-exact', async () => {
  const kernel = await start();
  for (const size of [0, 1, 3, 64, 4096, 65537, 102400]) {
    const payload = randomBytes(size);
    assert.ok((await kernel.request(OP.echo, payload)).equals(payload), `echo ${size}`);
  }
  const words = Buffer.from([1, 0, 0, 0, 255, 255, 255, 255, 0x78, 0x56, 0x34, 0x12]);
  assert.ok((await kernel.request(OP.words, words)).equals(words));
  const blob = randomBytes(5000);
  assert.equal((await kernel.request(OP.store, blob)).readUInt32LE(0), 5000);
  assert.ok((await kernel.request(OP.load)).equals(blob));
  const ping = await kernel.request(OP.ping);
  assert.equal(ping.readUInt32LE(0), 10, 'requests answered before this ping');
  assert.equal(ping.readUInt32LE(12), 5000, 'resident blob bytes');
  // Concurrent requests are answered in order and matched by id.
  const many = Array.from({ length: 32 }, (_, i) => randomBytes(i * 97));
  const answers = await Promise.all(many.map(p => kernel.request(OP.echo, p)));
  answers.forEach((answer, i) => assert.ok(answer.equals(many[i])));
  assert.deepEqual(await kernel.close(), { code: 0, signal: null, stderr: '' });
});

test('kernel op matches the JS target and the independent volume', async () => {
  const cases = [[KIND.boolean, 0, 1, 37], [KIND.comparison, 0, 1, 37], [KIND.boolean, 3, 2, 1046], [KIND.comparison, 4, 4, 2055]];
  const reference = referenceEvidence(cases);
  const kernel = await start();
  for (const [i, c] of cases.entries()) {
    const evidence = JSON.parse((await kernel.request(OP.kernel, kernelPayload(...c))).toString('utf8'));
    const check = checkEvidence(evidence, reference[i], c);
    assert.ok(check.ok, `case ${c}: ${JSON.stringify({ evidence, reference: reference[i], check })}`);
  }
  await kernel.close();
});

test('replay op answers the requested size with the wrapping word sum', async () => {
  const kernel = await start();
  for (const [reply, words] of [[4, []], [10, [0xffffffff, 5, 7]], [4096, [1, 2, 3]], [8, Array.from({ length: 5000 }, (_, i) => i * 7919)]]) {
    const payload = Buffer.alloc(4 + 4 * words.length);
    payload.writeUInt32LE(reply, 0);
    words.forEach((w, i) => payload.writeUInt32LE(w >>> 0, 4 + 4 * i));
    const answer = await kernel.request(OP.replay, payload);
    assert.equal(answer.length, reply);
    assert.equal(answer.readUInt32LE(0), words.reduce((a, w) => (a + w) >>> 0, 0));
    assert.ok(answer.subarray(4).every(b => b === 0));
  }
  await assert.rejects(kernel.request(OP.replay, Buffer.alloc(4)), e => e.status === 2 && /reply length/.test(e.message));
  await assert.rejects(kernel.request(OP.replay, Buffer.alloc(6)), e => e.status === 2 && /multiple of 4/.test(e.message));
  await kernel.close();
});

for (const [name, Client] of [['worker bridge', SyncProcessKernel], ['direct blocking pipes', DirectProcessKernel]]) {
  test(`${name}: exact answers, explicit errors, kill and hang throw`, async () => {
    const kernel = Client.start(serviceBinary, { requestTimeoutMs: 20000 });
    for (const size of [0, 64, 4096, 102400]) {
      const payload = randomBytes(size);
      assert.ok(kernel.request(OP.echo, payload).equals(payload), `echo ${size}`);
    }
    assert.throws(() => kernel.request(42), e => e instanceof NativeKernelError && e.status === 1);
    assert.throws(() => kernel.request(OP.words, Buffer.from('abc')), e => e instanceof NativeKernelError && e.status === 2);
    assert.ok(kernel.request(OP.echo, Buffer.from('ok')).equals(Buffer.from('ok')));
    kernel.kill('SIGKILL');
    assert.throws(() => kernel.request(OP.ping), e => e instanceof NativeKernelError && !e.timeout);
    assert.throws(() => kernel.request(OP.ping), NativeKernelError);
    const stopped = Client.start(serviceBinary, { requestTimeoutMs: 300 });
    process.kill(stopped.pid, 'SIGSTOP');
    const started = performance.now();
    assert.throws(() => stopped.request(OP.ping), e => e instanceof NativeKernelError && e.timeout === true);
    assert.ok(performance.now() - started < 5000);
    const clean = Client.start(serviceBinary);
    clean.request(OP.ping);
    assert.deepEqual(await clean.close(), { code: 0, signal: null, stderr: '' });
  });
}

test('recoverable request errors are explicit and keep the process usable', async () => {
  const kernel = await start();
  await assert.rejects(kernel.request(42, Buffer.from('x')), e => e instanceof NativeKernelError && e.status === 1);
  await assert.rejects(kernel.request(OP.words, Buffer.from('abc')), e => e instanceof NativeKernelError && e.status === 2);
  await assert.rejects(kernel.request(OP.kernel, Buffer.alloc(8)), e => e instanceof NativeKernelError && e.status === 2);
  assert.ok((await kernel.request(OP.echo, Buffer.from('still alive'))).equals(Buffer.from('still alive')));
  await kernel.close();
});

test('unrecoverable stream errors answer, then exit with a distinct code', async () => {
  const cases = [
    ['bad magic', header(0x12345678, OP.echo, 7, 0), 3, 65, /bad request magic/],
    ['too large', header(MAGIC_REQUEST, OP.echo, 8, 64 * 1024 * 1024 + 1), 4, 67, /exceeds the limit/],
  ];
  for (const [label, bytes, status, code, message] of cases) {
    const kernel = await start();
    const frame = kernel.expect(0, 5000);
    kernel.writeRaw(bytes);
    assert.equal((await frame).status, status, label);
    const exit = await kernel.exited;
    assert.equal(exit.code, code, label);
    assert.match(exit.stderr, message, label);
    await assert.rejects(kernel.request(OP.ping), NativeKernelError, `${label}: later requests reject at once`);
  }
});

test('stdin EOF: clean between frames, error inside a frame', async () => {
  const clean = await start();
  await clean.request(OP.ping);
  assert.equal((await clean.close()).code, 0);
  for (const bytes of [header(MAGIC_REQUEST, OP.echo, 1, 10).subarray(0, 9), Buffer.concat([header(MAGIC_REQUEST, OP.echo, 1, 10), Buffer.from('abc')])]) {
    const kernel = await start();
    kernel.writeRaw(bytes);
    const exit = await kernel.close();
    assert.equal(exit.code, 66);
    assert.match(exit.stderr, /stdin closed inside/);
  }
});

test('a killed process rejects in-flight and later requests explicitly', async () => {
  const kernel = await start();
  const inFlight = kernel.request(OP.echo, randomBytes(1024 * 1024));
  kernel.kill('SIGKILL');
  await assert.rejects(inFlight, NativeKernelError);
  assert.equal((await kernel.exited).signal, 'SIGKILL');
  await assert.rejects(kernel.request(OP.ping), NativeKernelError);
  // Writing into the dead pipe must not throw an uncaught EPIPE.
  kernel.writeRaw(encodeRequest(OP.echo, 99, randomBytes(1 << 20)));
  assert.equal(kernel.alive, false);
});

test('a stopped process hits the request timeout instead of hanging', async () => {
  const kernel = await start({ requestTimeoutMs: 300 });
  process.kill(kernel.pid, 'SIGSTOP');
  const started = performance.now();
  await assert.rejects(kernel.request(OP.ping), e => e instanceof NativeKernelError && e.timeout === true);
  assert.ok(performance.now() - started < 5000);
  const exit = await kernel.exited;
  assert.equal(exit.signal, 'SIGKILL');
});

}
