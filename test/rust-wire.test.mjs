import { missingBend } from './helpers/public-tree.mjs';
// Rust wire v1/v2/v3 and N-API boundary (docs/rust-migration.md 3.3 and 6).
// Strict Rust serves operation-level host ports; unported leaf entries still
// refuse explicitly. Retired Bend backends must not execute in this suite.
//
// `before` builds the addon and the isolated plant-panic variant. Run this
// release-build suite through the remote runner (or its capped fallback).
// The fixture fixtures/rust/wire-v1/spike holds the Rust spike's captured planar
// Boolean requests and Bend native replies (wire v1) with provenance.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { generate } from '../scripts/native-bridge/gen-wire.mjs';
import { UnsupportedFeatureError } from '../src/errors.mjs';
import { BackendDivergenceError, NativeCapabilityError, NativeKernelError, NativeKernelStaleError } from '../src/native/errors.mjs';
import { selectBackend } from '../src/native/backend.mjs';
import { KEY_SCRIPTS, computeKey, toolchain } from '../src/native/rust-build-key.mjs';
import { rustExportNamespace } from '../src/native/rust-kernel.mjs';
import { loadModelingServices } from '../src/library.mjs';
import { STATUS, compareRustReplies, locateRustBuild, openRustBackend, openRustDiffKernel, openRustKernel, openRustMixedKernel, replyMessage, rustStaleCheck } from '../src/native/rust-kernel.mjs';
import { WIRE_HASH, layout, ops } from '../src/native/rust-wire.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, 'tmp/rust/test');
const spike = join(root, 'fixtures/rust/wire-v1/spike');
const guardPreload = join(root, 'scripts/r20/bend-guard.mjs');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const opId = entry => { const op = ops.find(o => o.entry === entry); assert.ok(op, `${entry} is in the op table`); return op.id; };
const words = file => { const b = readFileSync(file); return new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const same = (a, b) => a.length === b.length && a.every((w, i) => w === b[i]);
let backend;

function buildAddon(features = [], extraArgs = [], env = process.env) {
  const run = spawnSync(process.execPath, [join(root, 'scripts/rust/build-node.mjs'), ...(features.length ? ['--features', features.join(',')] : []), ...extraArgs],
    { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split('\n').pop());
}

before(async () => {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  buildAddon();
  buildAddon(['plant-panic']);
  backend = await openRustBackend();
});

test('the generated Rust and JS wire is exactly what gen-wire-rust.mjs produces now', { skip: missingBend() }, () => {
  const run = spawnSync(process.execPath, [join(root, 'scripts/native-bridge/gen-wire-rust.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const report = JSON.parse(run.stdout.trim());
  assert.deepEqual(report.stale, []);
  assert.equal(report.wireHash, WIRE_HASH);
  // Every production entry of src/native/surface.json, in its order.
  const surface = readJson(join(root, 'src/native/surface.json')).entries.filter(e => e.production).map(e => e.entry);
  assert.deepEqual(ops.map(op => op.entry), surface);
});

test('WONKY_BACKEND accepts rust but refuses hybrid modes until B1', () => {
  assert.equal(selectBackend('rust'), 'rust');
  for (const mode of ['rust-diff', 'rust-mixed']) {
    assert.throws(() => selectBackend(mode), error => error instanceof NativeKernelError && error.code === 'BX_BACKEND' && error.message.includes(`WONKY_BACKEND=${mode}`) && error.message.includes('package B1'));
  }
  assert.throws(() => selectBackend('rust-js'), error => error instanceof NativeKernelError && error.code === 'BX_BACKEND');
});

test('the rust backend loads a stale-checked addon whose hashes and op table match the codecs', () => {
  const key = computeKey(root);
  assert.equal(backend.sourceHash, key.sourceHash);
  assert.equal(backend.info.wireHash, WIRE_HASH);
  assert.deepEqual(backend.addon.info().ops, ops.map(op => op.entry));
  assert.deepEqual(backend.info.features, []);
  assert.deepEqual(backend.addon.info().wireVersions, [1, 2, 3]);
});

// A throwaway project root holding exactly the key inputs: rust/ without build output, the key scripts.
function keyRootCopy() {
  const copy = mkdtempSync(join(tmpdir(), 'wonky-rust-root-'));
  cpSync(join(root, 'rust'), join(copy, 'rust'), { recursive: true, filter: src => !src.includes('/rust/target') });
  for (const path of KEY_SCRIPTS) { mkdirSync(dirname(join(copy, path)), { recursive: true }); cpSync(join(root, path), join(copy, path)); }
  return copy;
}

test('the addon key uses the pinned compiler and includes Cargo configuration', () => {
  assert.match(toolchain(root).rustc, /rustc 1\.88\.0/);
  const located = locateRustBuild();
  const copy = keyRootCopy();
  try {
    const file = join(copy, 'rust/.cargo/config.toml');
    writeFileSync(file, readFileSync(file, 'utf8') + '\n# planted Cargo configuration change\n');
    assert.throws(() => rustStaleCheck(located, { root: copy }), error => error instanceof NativeKernelStaleError && error.message.includes('rust/.cargo/config.toml changed'));
  } finally { rmSync(copy, { recursive: true, force: true }); }
});

test('a changed, added or removed rust/ file, or a different binary, makes the build stale before anything loads', () => {
  const located = locateRustBuild();
  const copy = keyRootCopy();
  try {
    assert.equal(rustStaleCheck(located, { root: copy }).sourceHash, located.manifest.sourceHash);
    const lib = join(copy, 'rust/wonky-wire/src/lib.rs');
    writeFileSync(lib, readFileSync(lib, 'utf8') + '\n// edit\n');
    assert.throws(() => rustStaleCheck(located, { root: copy }), error => error instanceof NativeKernelStaleError && /^BX_STALE: the Rust addon build 'rust' is stale: /.test(error.message) && /rust\/wonky-wire\/src\/lib\.rs changed/.test(error.message) && /node scripts\/rust\/build-node\.mjs/.test(error.message));
    cpSync(join(root, 'rust/wonky-wire/src/lib.rs'), lib);
    writeFileSync(join(copy, 'rust/wonky-node/src/extra.rs'), '// new file\n');
    assert.throws(() => rustStaleCheck(located, { root: copy }), error => error instanceof NativeKernelStaleError && /rust\/wonky-node\/src\/extra\.rs added/.test(error.message));
    rmSync(join(copy, 'rust/wonky-node/src/extra.rs'));
    rmSync(join(copy, 'rust/wonky-node/build.rs'));
    assert.throws(() => rustStaleCheck(located, { root: copy }), error => error instanceof NativeKernelStaleError && /rust\/wonky-node\/build\.rs removed/.test(error.message));
  } finally { rmSync(copy, { recursive: true, force: true }); }
  // A binary that is not the recorded one.
  const cache = mkdtempSync(join(tmpdir(), 'wonky-rust-cache-'));
  try {
    cpSync(located.dir, join(cache, located.manifest.sourceHash), { recursive: true });
    cpSync(join(dirname(located.dir), 'node.json'), join(cache, 'node.json'));
    const node = join(cache, located.manifest.sourceHash, 'wonky-node.node');
    const bytes = readFileSync(node); bytes[bytes.length - 1] ^= 1; writeFileSync(node, bytes);
    assert.throws(() => rustStaleCheck(locateRustBuild({ cacheRoot: cache })), error => error instanceof NativeKernelStaleError && /sha256 differs/.test(error.message));
    const repair = buildAddon([], ['--cache', cache]);
    assert.equal(repair.cached, false, 'corrupt cached bytes must trigger the recommended rebuild');
    assert.equal(rustStaleCheck(locateRustBuild({ cacheRoot: cache })).sourceHash, located.manifest.sourceHash);
    assert.equal(buildAddon([], ['--cache', cache]).cached, true);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test('addon poisoning: environment and ancestor config never masquerade as the canonical build', () => {
  const canonical = locateRustBuild();
  const cache = mkdtempSync(join(tmpdir(), 'wonky-addon-poison-'));
  const copy = keyRootCopy();
  try {
    const poisoned = buildAddon([], ['--cache', cache], { ...process.env, CARGO_PROFILE_RELEASE_OPT_LEVEL: '0' });
    assert.notEqual(poisoned.sourceHash, canonical.manifest.sourceHash);
    assert.throws(() => rustStaleCheck(locateRustBuild({ cacheRoot: cache })),
      e => e instanceof NativeKernelStaleError && /CARGO_PROFILE_RELEASE_OPT_LEVEL/.test(e.message));
    for (const variable of ['CARGO_PROFILE_RELEASE_PANIC', 'RUSTFLAGS']) {
      const run = spawnSync(process.execPath, [join(root, 'scripts/rust/build-node.mjs'), '--cache', cache, '--features', 'plant-panic'],
        { cwd: root, encoding: 'utf8', env: { ...process.env, [variable]: variable === 'RUSTFLAGS' ? '-C panic=abort' : 'abort' } });
      assert.notEqual(run.status, 0, `${variable} must not produce a loadable abort addon`);
      assert.match(run.stderr, /wonky-node requires panic=unwind/);
    }
    // A config in the parent of rust/ is deliberately outside the keyed tree.
    mkdirSync(join(copy, '.cargo'));
    writeFileSync(join(copy, '.cargo/config.toml'), '[profile.release]\npanic="abort"\n');
    assert.throws(() => rustStaleCheck(canonical, { root: copy }),
      e => e instanceof NativeKernelStaleError && /cargo config/.test(e.message));
    const run = spawnSync('cargo', ['build', '--release', '--offline', '--locked', '-p', 'wonky-node'],
      { cwd: join(copy, 'rust'), encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /wonky-node requires panic=unwind/);
  } finally {
    rmSync(cache, { recursive: true, force: true }); rmSync(copy, { recursive: true, force: true });
    // Restore the ordinary build pointer even after a failing poison assertion.
    buildAddon();
  }
});

// ---------------------------------------------------------------- wire v1: the spike captures

test('every captured spike request (wire v1) decodes and re-encodes word for word, in Rust and in JS, and reads as the Bend codec reads it', { skip: missingBend() }, async () => {
  const provenance = readJson(join(spike, 'provenance.json'));
  assert.equal(provenance.calls.length, 9);
  // The Bend native codec of the two entries, generated exactly as build-native.mjs does.
  const outDir = mkdtempSync(join(tmpdir(), 'wonky-bend-wire-'));
  const specs = ['ports/planar-boolean.bend:union', 'ports/planar-boolean.bend:subtract'];
  writeFileSync(join(outDir, 'wire.mjs'), generate({ ops: specs, outDir }).js);
  const bend = await import(pathToFileURL(join(outDir, 'wire.mjs')).href);
  let checked = 0;
  for (const call of provenance.calls) {
    const request = words(join(spike, call.request.file)), reply = words(join(spike, call.reply.file));
    for (const [file, bytes] of [[call.request.file, request], [call.reply.file, reply]]) {
      assert.equal(createHash('sha256').update(Buffer.from(bytes.buffer)).digest('hex'), file === call.request.file ? call.request.sha256 : call.reply.sha256, `${file} matches its provenance`);
    }
    assert.equal(reply[0], 0, `${call.workload}.${call.call}: the Bend reply is ok`);
    const op = ops[opId(call.entry)];
    // Rust v1: arguments and result.
    const args = backend.addon.wire(1, op.id, request, 'args');
    assert.equal(args[0], STATUS.OK, replyMessage(args));
    assert.ok(same(args.subarray(1), request), `${call.workload}.${call.call}: Rust re-encodes the request word for word`);
    const result = backend.addon.wire(1, op.id, reply.subarray(1), 'result');
    assert.equal(result[0], STATUS.OK, replyMessage(result));
    assert.ok(same(result.subarray(1), reply.subarray(1)), `${call.workload}.${call.call}: Rust re-encodes the Bend reply word for word`);
    // JS v1 of this generator against the Bend native codec.
    const decoded = op.v1.decodeArgs(request);
    assert.ok(same(op.v1.encode(decoded), request));
    assert.ok(same(bend.ops[specs.indexOf(call.entry.replace(/^kernel\//, ''))].encode(decoded), request), 'the Bend codec encodes the same values to the same words');
    assert.deepStrictEqual(op.v1.decode(reply), bend.ops[specs.indexOf(call.entry.replace(/^kernel\//, ''))].decode(reply));
    checked += 1;
  }
  assert.equal(checked, 9);
  rmSync(outDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- random values

// Deterministic PRNG (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SPECIAL64 = [0, -0, 5e-324, -5e-324, 2.2250738585072014e-308, 2.225073858507201e-308, Number.MAX_VALUE, -Number.MAX_VALUE, 1, -1, 1e10 + 1e-4, 1e10 / 3, 0.1];
function randomFinite(r) {
  if (r() < 0.4) return SPECIAL64[Math.floor(r() * SPECIAL64.length)];
  const b = new Uint32Array(2), f = new Float64Array(b.buffer);
  do { b[0] = Math.floor(r() * 2 ** 32); b[1] = Math.floor(r() * 2 ** 32); } while (!Number.isFinite(f[0]));
  return f[0];
}
function randomF32(r) {
  if (r() < 0.4) return Math.fround([0, -0, 1.401298464324817e-45, -1.401298464324817e-45, 1.1754942106924411e-38, 3.4028234663852886e38, -3.4028234663852886e38, 1, 0.1][Math.floor(r() * 9)]);
  const b = new Uint32Array(1), f = new Float32Array(b.buffer);
  do { b[0] = Math.floor(r() * 2 ** 32); } while (!Number.isFinite(f[0]));
  return f[0];
}
function randomString(r) {
  const n = Math.floor(r() * 4), codes = [];
  for (let i = 0; i < n; i++) {
    const pick = r();
    let c = pick < 0.5 ? 32 + Math.floor(r() * 90) : pick < 0.7 ? 0x1f600 + Math.floor(r() * 64) : pick < 0.85 ? 0xe9 : 0xdc00; // lone low surrogate
    if (c === 0xdc00 && codes.length && codes.at(-1) >= 0xd800 && codes.at(-1) <= 0xdbff) c = 0x41;
    codes.push(c);
  }
  return String.fromCodePoint(...codes);
}
const list = values => values.reduceRight((tail, head) => ({ $: 'Con', head, tail }), { $: 'Nil' });
function randomValue(type, r, v, depth = 0) {
  switch (type.kind) {
    case 'base':
      if (type.name === 'U32') return [0, 1, 0xffffffff, Math.floor(r() * 2 ** 32)][Math.floor(r() * 4)];
      if (type.name === 'Bool') return r() < 0.5;
      if (type.name === 'String') return randomString(r);
      return v === 2 ? randomFinite(r) : randomF32(r);
    case 'real':
      // v2: the canonical decoded form { hi: x, lo: 0 }; v1: any pair of F32 words (non-canonical pairs included).
      return v === 2 ? { $: 'Real', hi: randomFinite(r), lo: 0 } : { $: 'Real', hi: randomF32(r), lo: randomF32(r) };
    case 'list': return list(Array.from({ length: depth > 3 ? 0 : Math.floor(r() * 3) }, () => randomValue(type.elem, r, v, depth + 1)));
    case 'maybe': return r() < 0.5 ? { $: 'None' } : { $: 'Some', value: randomValue(type.elem, r, v, depth + 1) };
    case 'adt': {
      const adt = layout.adts[type.key], ctor = adt.ctors[Math.floor(r() * adt.ctors.length)];
      return Object.fromEntries([['$', ctor.name], ...ctor.fields.map(f => [f.name, randomValue(f.type, r, v, depth + 1)])]);
    }
    default: throw new Error(`type kind ${type.kind}`);
  }
}

function randomRoundTrips(v, count, seed) {
  const r = rng(seed);
  let words = 0, minus0 = 0, subnormal = 0, maxFinite = 0;
  // Subnormal and largest finite of the version's float: binary64 (v2), binary32 (v1).
  const [minNormal, largest] = v === 2 ? [2.2250738585072014e-308, Number.MAX_VALUE] : [1.1754943508222875e-38, 3.4028234663852886e38];
  const census = value => {
    if (typeof value === 'number') { if (Object.is(value, -0)) minus0++; if (value !== 0 && Math.abs(value) < minNormal) subnormal++; if (Math.abs(value) === largest) maxFinite++; }
    else if (value && typeof value === 'object') Object.values(value).forEach(census);
  };
  for (let i = 0; i < count; i++) {
    const op = ops[i % ops.length], codec = op[`v${v}`], side = i % 2 === 0 ? 'args' : 'result';
    const value = side === 'args' ? layout.ops[op.id].params.map(p => randomValue(p.type, r, v)) : randomValue(layout.ops[op.id].result, r, v);
    census(value);
    const request = side === 'args' ? codec.encode(value) : codec.encodeResult(value);
    const reply = backend.addon.wire(v, op.id, request, side);
    assert.equal(reply[0], STATUS.OK, `v${v} ${op.entry} ${side} #${i}: status ${reply[0]} ${replyMessage(reply)}`);
    const back = reply.subarray(1);
    assert.ok(same(back, request), `v${v} ${op.entry} ${side} #${i}: Rust changed the words`);
    assert.deepStrictEqual(side === 'args' ? codec.decodeArgs(back) : codec.decodeResult(back), value, `v${v} ${op.entry} ${side} #${i}`);
    words += request.length;
  }
  return { words, minus0, subnormal, maxFinite };
}

test('1e5 random ADT values JS v2 -> Rust -> JS v2 are identical (every op, arguments and results, -0, subnormals, max finite)', { timeout: 600000 }, () => {
  const stats = randomRoundTrips(2, 100000, 0x5eed2);
  assert.ok(stats.minus0 > 1000 && stats.subnormal > 1000 && stats.maxFinite > 1000, JSON.stringify(stats));
});

test('2e4 random ADT values JS v1 -> Rust -> JS v1 are identical (non-canonical F32 pairs kept)', { timeout: 600000 }, () => {
  const stats = randomRoundTrips(1, 20000, 0x5eed1);
  assert.ok(stats.minus0 > 100 && stats.subnormal > 100 && stats.maxFinite > 100, JSON.stringify(stats));
});

// ---------------------------------------------------------------- refusals on the wire

test('a count larger than the message, truncation, trailing words, bad tags, Bool and Char words are status 1', () => {
  const boxLayout = opId('kernel/identity.bend:box_layout'), box = opId('kernel/identity.bend:box'), plane = opId('kernel/analytic.bend:plane');
  const status = (v, op, w) => backend.addon.call(op, Uint32Array.from(w), v)[0];
  for (const v of [1, 2]) {
    const width = v === 1 ? 3 : 6;
    for (const claimed of [5, 0x10000, 0xffffffff]) assert.equal(status(v, boxLayout, [claimed, ...new Array(4 * width).fill(0)]), STATUS.MALFORMED, `v${v} count ${claimed}`);
    assert.equal(status(v, boxLayout, [4, ...new Array(4 * width).fill(0)]), STATUS.UNAVAILABLE, 'the well-formed request reaches the op');
    assert.equal(status(v, box, [0xffffffff, 65, 66]), STATUS.MALFORMED);
    assert.equal(status(v, box, [1, 0x110000, 0, 0, 0]), STATUS.MALFORMED, 'Char above U+10FFFF');
    assert.equal(status(v, boxLayout, [0, 0]), STATUS.MALFORMED, 'trailing word');
    // analytic.bend:plane(origin, normal: Vec3 of Reals) = 12 words in both versions.
    assert.equal(status(v, plane, new Array(12).fill(0)), STATUS.UNAVAILABLE);
    assert.equal(status(v, plane, new Array(11).fill(0)), STATUS.MALFORMED, 'truncated');
  }
  // A tag word past the last constructor: analytic.bend:Surface has 5.
  const residual = opId('kernel/analytic.bend:surface_residual');
  assert.equal(status(2, residual, [5, ...new Array(40).fill(0)]), STATUS.MALFORMED);
  // Bool word 2: identity.bend:named_extrusion ends in a Bool.
  const named = opId('kernel/identity.bend:named_extrusion');
  assert.equal(status(2, named, [0, 0, 0, 0, 0, 0, 1]), STATUS.UNAVAILABLE);
  assert.equal(status(2, named, [0, 0, 0, 0, 0, 0, 2]), STATUS.MALFORMED);
  const unknown = backend.addon.call(ops.length, new Uint32Array(0));
  assert.equal(unknown[0], STATUS.UNKNOWN_OP);
  assert.match(replyMessage(unknown), /unknown op 98/);
});

test('NaN and +-Inf are refused by every decoder (status 3 in Rust, a thrown error in JS v2)', () => {
  const max = opId('kernel/real.bend:max');
  const f64 = x => { const b = new Uint32Array(new Float64Array([x]).buffer); return [b[0], b[1]]; };
  const f32 = x => new Uint32Array(new Float32Array([x]).buffer)[0];
  for (const bad of [NaN, Infinity, -Infinity]) {
    const v2 = backend.addon.call(max, Uint32Array.from([...f64(bad), ...f64(1)]), 2);
    assert.equal(v2[0], STATUS.INVALID, `v2 ${bad}`);
    assert.match(replyMessage(v2), /does not cross the wire/);
    assert.equal(backend.addon.call(max, Uint32Array.from([f32(bad), 0, f32(1), 0]), 1)[0], STATUS.INVALID, `v1 ${bad}`);
    assert.throws(() => ops[max].v2.encode([{ $: 'Real', hi: bad, lo: 0 }, { $: 'Real', hi: 1, lo: 0 }]), /does not cross the wire/);
    assert.throws(() => ops[max].v2.decodeArgs(Uint32Array.from([...f64(bad), ...f64(1)])), /does not cross the wire/);
  }
  // A NaN payload other than the canonical one is refused too.
  assert.equal(backend.addon.call(max, Uint32Array.from([1, 0x7ff00000, ...f64(1)]), 2)[0], STATUS.INVALID);
  // Through the backend a status 3 is a NativeKernelError, never a result.
  assert.throws(() => backend.call(max, Uint32Array.from([...f64(NaN), ...f64(1)]), 2), error => error instanceof NativeKernelError && error.code === 'BX_WIRE' && error.status === 3);
});

// ---------------------------------------------------------------- the binary64 host path

// Plane at 1e10 + 1e-4 (roadmap-gaps G: qCoincidesWithPlane lost precision in the
// F32x2 host serialisation). 1e10 + 1e-4 alone is F32x2-exact (hi 1e10, lo
// 13 * 2^-17), so the repro also carries coordinates and a normal whose binary64
// needs more than F32x2's 48 bits: 1e10 / 3 and normalize(1, 2, 3).
test('a plane at 1e10 + 1e-4 reaches Rust bit for bit through the rust host path (src/real.mjs, wire v2)', async () => {
  const { real, vector } = await import('../src/real.mjs');
  const n = Math.hypot(1, 2, 3);
  const origin = [1e10 + 1e-4, 1e10 / 3, -(1e10 + 1e-4)], normal = [1 / n, 2 / n, 3 / n];
  const split = x => { const hi = Math.fround(x); return hi + Math.fround(x - hi); };
  // 1e10 / 3, 1/sqrt(14) and 2/sqrt(14) lose bits under the F32x2 split (1e10 + 1e-4 and 3/sqrt(14) happen not to).
  assert.deepEqual([...origin, ...normal].map(x => split(x) !== x), [false, true, false, true, true, false], 'which repro values F32x2 cannot carry');
  const saved = process.env.WONKY_BACKEND;
  process.env.WONKY_BACKEND = 'rust';
  let args;
  try { args = [vector(origin), vector(normal)]; assert.deepStrictEqual(real(1e10 + 1e-4), { $: 'Real', hi: 1e10 + 1e-4, lo: 0 }); }
  finally { if (saved === undefined) delete process.env.WONKY_BACKEND; else process.env.WONKY_BACKEND = saved; }
  const op = ops[opId('kernel/analytic.bend:plane')];
  const reply = backend.addon.wire(2, op.id, op.v2.encode(args), 'args');
  assert.equal(reply[0], STATUS.OK, replyMessage(reply));
  const [o, nv] = op.v2.decodeArgs(reply.subarray(1));
  const got = [o.x, o.y, o.z, nv.x, nv.y, nv.z].map(r => r.hi + r.lo);
  [...origin, ...normal].forEach((x, i) => assert.ok(Object.is(got[i], x), `coordinate ${i}: Rust saw ${got[i]} for ${x}`));
});

test('the rust host path serialises F32 fields and Reals without Math.fround; every other backend keeps the F32x2 split', async () => {
  const { real } = await import('../src/real.mjs');
  const { vector } = await import('../src/kernel.mjs');
  const saved = process.env.WONKY_BACKEND;
  try {
    process.env.WONKY_BACKEND = 'rust';
    assert.deepStrictEqual(vector([0.1, 1e10 / 3, -0]), { $: 'V3', x: 0.1, y: 1e10 / 3, z: -0 });
    assert.deepStrictEqual(real(0.1), { $: 'Real', hi: 0.1, lo: 0 });
    assert.throws(() => real(NaN), RangeError);
    for (const b of ['js', 'native', 'diff', 'rust-diff', 'rust-mixed']) {
      process.env.WONKY_BACKEND = b;
      assert.deepStrictEqual(vector([0.1, 0, 0]).x, Math.fround(0.1));
      assert.deepStrictEqual(real(0.1), { $: 'Real', hi: Math.fround(0.1), lo: Math.fround(0.1 - Math.fround(0.1)) });
    }
  } finally { if (saved === undefined) delete process.env.WONKY_BACKEND; else process.env.WONKY_BACKEND = saved; }
});

// A v2 Real is one binary64. A pair whose sum is not exact (a Bend F32x2 value
// that binary64 cannot hold) is refused, never rounded on the way to Rust.
test('wire v2 refuses a Real whose hi + lo is not exact in binary64, and carries an exact pair as its sum', () => {
  const max = ops[opId('kernel/real.bend:max')];
  const one = { $: 'Real', hi: 1, lo: 0 };
  assert.throws(() => max.v2.encode([{ $: 'Real', hi: 1, lo: 2 ** -80 }, one]), /Real 1 \+ 8\.271806125530277e-25 is not exact in binary64/);
  assert.throws(() => max.v2.encode([one, { $: 'Real', hi: 1e10, lo: 1e-10 }]), /not exact in binary64/);
  const hi = Math.fround(0.1), lo = Math.fround(0.1 - hi);
  const words = max.v2.encode([{ $: 'Real', hi, lo }, one]);
  assert.deepEqual(max.v2.decodeArgs(words), [{ $: 'Real', hi: hi + lo, lo: 0 }, one]);
});

test('box identity corners and an inherited construction budget keep the binary64 on rust and F32 words on every other backend', async () => {
  const { identifyExtrusion } = await import('../src/identity.mjs');
  const { inheritedConstructionBudget } = await import('../src/construction-history.mjs');
  const { real, number } = await import('../src/real.mjs');
  const x = 1e10 / 3, points = [[0, 0, 0], [x, 0, 0], [x, 0.1, 0], [0, 0.1, 0]];
  const cornersSent = () => {
    const seen = [];
    const kernel = { identity: { box_layout: profile => { seen.push(profile); return false; } } };
    assert.throws(() => identifyExtrusion(kernel, {}, 'box', points, null, null, null, { primitive: 'box' }), UnsupportedFeatureError);
    const corners = [];
    for (let node = seen[0]; node.$ === 'Con'; node = node.tail) corners.push([node.head.x, node.head.y]);
    return corners;
  };
  const budget = value => { const n = real(value); return { constructionBudget: { schema: 'wonky-construction-budget/1', ceilingMm: number(n), nativeCeiling: n } }; };
  const saved = process.env.WONKY_BACKEND;
  try {
    process.env.WONKY_BACKEND = 'rust';
    assert.deepEqual(cornersSent(), points.map(([px, py]) => [px, py]));
    assert.deepStrictEqual(inheritedConstructionBudget(budget(1e-7 / 3)), { $: 'Real', hi: 1e-7 / 3, lo: 0 });
    // An F32x2 pair is not a v2 native word on rust.
    const pair = { $: 'Real', hi: Math.fround(1e-7 / 3), lo: Math.fround(1e-7 / 3 - Math.fround(1e-7 / 3)) };
    assert.throws(() => inheritedConstructionBudget({ constructionBudget: { schema: 'wonky-construction-budget/1', ceilingMm: number(pair), nativeCeiling: pair } }), /Invalid inherited construction budget/);
    for (const b of ['js', 'native', 'diff', 'rust-diff', 'rust-mixed']) {
      process.env.WONKY_BACKEND = b;
      assert.deepEqual(cornersSent(), points.map(([px, py]) => [Math.fround(px), Math.fround(py)]), b);
      assert.deepStrictEqual(inheritedConstructionBudget(budget(1e-7 / 3)), real(1e-7 / 3), b);
      assert.throws(() => inheritedConstructionBudget({ constructionBudget: { schema: 'wonky-construction-budget/1', ceilingMm: 1e-7 / 3, nativeCeiling: { $: 'Real', hi: 1e-7 / 3, lo: 0 } } }),
        /Invalid inherited construction budget/, b);
    }
  } finally { if (saved === undefined) delete process.env.WONKY_BACKEND; else process.env.WONKY_BACKEND = saved; }
});

// ---------------------------------------------------------------- refusal, panic, threads

test('an entry Rust does not serve throws NativeCapabilityError naming it; a slot outside the surface too, by kernel/<module>.bend:<def>', async () => {
  const { kernel } = await openRustKernel();
  const { real } = await import('../src/real.mjs');
  assert.throws(() => kernel.real.max(real(1), real(2)), error => error instanceof NativeCapabilityError && error instanceof UnsupportedFeatureError &&
    error.entry === 'kernel/real.bend:max' && error.backend === 'rust' &&
    error.message === `kernel entry kernel/real.bend:max (kernel.real.max) is not ported to the Rust kernel ${error.sourceHash.slice(0, 12)} (WONKY_BACKEND=rust)`);
  assert.throws(() => kernel.analytic.no_such_def(), error => error instanceof NativeCapabilityError && error.entry === 'kernel/analytic.bend:no_such_def (not in src/native/surface.json)');
  // loadKernel().hybrid is not in the surface (the Bend native build hosts it in a subprocess): named from the wiring.
  assert.throws(() => kernel.hybrid.boolean('job'), error => error instanceof NativeCapabilityError && error.entry === 'kernel/hybrid/main.bend:boolean (not in src/native/surface.json)');
  assert.equal(kernel.then, undefined, 'the namespace is not a thenable');
});

test('FeatureScript `try silent` cannot swallow the refusal on WONKY_BACKEND=rust, and nothing Bend is loaded', { timeout: 120000 }, () => {
  const dir = join(work, 'try-silent');
  mkdirSync(dir, { recursive: true });
  const source = join(dir, 'try-silent-extrude.fs');
  writeFileSync(source, `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function main(context is Context, id is Id, definition is map)
{
    var base = newSketchOnPlane(context, id + "base", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skRectangle(base, "r", { "firstCorner" : vector(-10, -10) * millimeter, "secondCorner" : vector(10, 10) * millimeter });
    skSolve(base);
    opExtrude(context, id + "box", { "entities" : qSketchRegion(id + "base"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
    try silent(opLoft(context, id + "loft", {}));
}
`);
  const probe = `
    const { build } = await import(${JSON.stringify(join(root, 'src/index.mjs'))});
    const { UnsupportedFeatureError } = await import(${JSON.stringify(join(root, 'src/errors.mjs'))});
    const { NativeCapabilityError } = await import(${JSON.stringify(join(root, 'src/native/errors.mjs'))});
    const { readFileSync } = await import('node:fs');
    try { await build(readFileSync(${JSON.stringify(source)}, 'utf8')); console.log(JSON.stringify({ built: true })); }
    catch (error) { console.log(JSON.stringify({ unsupported: error instanceof UnsupportedFeatureError, capability: error instanceof NativeCapabilityError,
      entry: error.entry, backend: error.backend, message: error.message })); }`;
  const guardFile = join(dir, 'guard.json');
  const child = spawnSync(process.execPath, ['--import', guardPreload, '--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8',
    env: { ...process.env, WONKY_BACKEND: 'rust', WONKY_BEND_GUARD_LOG: guardFile } });
  assert.equal(child.status, 0, child.stderr);
  const out = JSON.parse(child.stdout.trim().split('\n').pop());
  assert.equal(out.capability, true, JSON.stringify(out));
  assert.equal(out.unsupported, true);
  assert.equal(out.backend, 'rust');
  assert.equal(out.entry, 'host/loft:invoke');
  assert.match(out.message, /opLoft/);
  const guard = readJson(guardFile).summary;
  assert.equal(guard.bendLoaded, false, JSON.stringify(guard));
  assert.ok(guard.addons.some(a => a.endsWith('/wonky-node.node')), JSON.stringify(guard.addons));
  // The CLI (which also imports the exporters) reports it, exits nonzero and loads nothing Bend either.
  const cliGuard = join(dir, 'guard-cli.json');
  const cli = spawnSync(process.execPath, ['--import', guardPreload, join(root, 'bin/wonky.mjs'), source, '--check'], { cwd: root, encoding: 'utf8',
    env: { ...process.env, WONKY_BACKEND: 'rust', WONKY_BEND_GUARD_LOG: cliGuard } });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /host\/loft:invoke \(kernel\.opLoft\).*WONKY_BACKEND=rust/);
  assert.equal(readJson(cliGuard).summary.bendLoaded, false, JSON.stringify(readJson(cliGuard).summary));
});

// Exercise successful native service dispatch, not merely an early refusal.
// Python remains unported and must refuse without loading the retired kernel.
test('strict rust evaluates evBox3d and refuses unported Python geometry without loading Bend', { timeout: 180000 }, t => {
  const dir = join(work, 'no-bend-services');
  mkdirSync(dir, { recursive: true });
  const source = join(dir, 'evbox-extrude.fs');
  writeFileSync(source, `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function main(context is Context, id is Id, definition is map)
{
    var base = newSketchOnPlane(context, id + "base", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skRectangle(base, "r", { "firstCorner" : vector(-10, -10) * millimeter, "secondCorner" : vector(10, 10) * millimeter });
    skSolve(base);
    opExtrude(context, id + "box", { "entities" : qSketchRegion(id + "base"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
    const bounds = evBox3d(context, { "topology" : qCreatedBy(id + "box", EntityType.BODY) });
    if (bounds.minCorner != vector(-10, -10, 0) * millimeter || bounds.maxCorner != vector(10, 10, 4) * millimeter)
        throw regenError("Incorrect Rust bounds");
}
`);
  const refusal = /kernel entry kernel\/\S+\.bend:\w+ \(kernel\.[\w.]+\) is not ported to the Rust kernel [0-9a-f]{12} \(WONKY_BACKEND=rust\)/;
  const fsGuard = join(dir, 'guard-fs.json');
  const fs = spawnSync(process.execPath, ['--import', guardPreload, join(root, 'bin/wonky.mjs'), source, '--check'], { cwd: root, encoding: 'utf8',
    env: { ...process.env, WONKY_BACKEND: 'rust', WONKY_BEND_GUARD_LOG: fsGuard } });
  assert.equal(fs.status, 0, fs.stderr);
  assert.equal(readJson(fsGuard).summary.bendLoaded, false, JSON.stringify(readJson(fsGuard).summary));
  const python = join(root, 'out/build123d-performance/reference-venv/bin/python');
  if (!existsSync(python)) {
    t.skip('REFERENCE_VENV_UNAVAILABLE: Python no-Bend integration was not exercised');
    return;
  }
  const pyGuard = join(dir, 'guard-py.json');
  const py = spawnSync('uv', ['run', '--no-project', '--python', python, process.execPath, '--import', guardPreload, join(root, 'bin/wonky-python.mjs'), join(root, 'examples/python-box.py'), '--python', 'python', '--check'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, WONKY_BACKEND: 'rust', WONKY_BEND_GUARD_LOG: pyGuard } });
  assert.notEqual(py.status, 0);
  assert.match(py.stderr, refusal);
  assert.equal(readJson(pyGuard).summary.bendLoaded, false, JSON.stringify(readJson(pyGuard).summary));
});

test('a panic in an op is a NativeKernelError (status 5) and the next call works (planted: --features plant-panic)', async () => {
  const planted = await openRustBackend({ features: ['plant-panic'] });
  assert.deepEqual(planted.info.features, ['plant-panic']);
  assert.notEqual(planted.dir, backend.dir);
  const max = opId('kernel/real.bend:max'), plane = opId('kernel/analytic.bend:plane');
  const args = ops[max].v2.encode([{ $: 'Real', hi: 1, lo: 0 }, { $: 'Real', hi: 2, lo: 0 }]);
  for (let round = 0; round < 2; round++) {
    assert.throws(() => planted.call(max, args, 2), error => error instanceof NativeKernelError && error.code === 'BX_FAULT' && error.status === 5 && /planted panic in kernel\/real\.bend:max/.test(error.message));
    // The next call runs normally (here: the refusal of an unported entry).
    assert.throws(() => planted.call(plane, ops[plane].v2.encode([{ $: 'V3', x: { $: 'Real', hi: 0, lo: 0 }, y: { $: 'Real', hi: 0, lo: 0 }, z: { $: 'Real', hi: 0, lo: 0 } },
      { $: 'V3', x: { $: 'Real', hi: 0, lo: 0 }, y: { $: 'Real', hi: 0, lo: 0 }, z: { $: 'Real', hi: 1, lo: 0 } }]), 2), NativeCapabilityError);
  }
  assert.equal(planted.addon.stats().faults, 2);
  // The production addon has no planted panic: the same call is an ordinary refusal.
  assert.throws(() => backend.call(max, args, 2), NativeCapabilityError);
});

test('the addon loads and answers in a worker thread', async () => {
  const path = join(backend.dir, 'wonky-node.node');
  const max = opId('kernel/real.bend:max');
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const m = { exports: {} };
      process.dlopen(m, workerData.path);
      m.exports.init({ threads: 1 });
      const reply = m.exports.call(workerData.op, new Uint32Array([0, 0x3ff00000, 0, 0x40000000]), 2);
      parentPort.postMessage({ status: reply[0], wireHash: m.exports.info().wireHash });`, { eval: true, workerData: { path, op: max } });
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  assert.deepEqual(result, { status: STATUS.UNAVAILABLE, wireHash: WIRE_HASH });
});

// ---------------------------------------------------------------- rust-diff, rust-mixed
// P0 must refuse by name before loading Bend, including through both frontends.
test('rust-diff and rust-mixed fail by name through loadKernel, CLI and Python frontend', { timeout: 120000 }, async () => {
  const { loadKernel } = await import('../src/kernel.mjs');
  for (const mode of ['rust-diff', 'rust-mixed']) {
    const previous = process.env.WONKY_BACKEND;
    try {
      process.env.WONKY_BACKEND = mode;
      await assert.rejects(loadKernel(), error => error instanceof NativeKernelError && error.code === 'BX_BACKEND' && error.message.includes(`WONKY_BACKEND=${mode}`) && error.message.includes('package B1'));
    } finally { if (previous === undefined) delete process.env.WONKY_BACKEND; else process.env.WONKY_BACKEND = previous; }
    const opener = mode === 'rust-diff' ? openRustDiffKernel : openRustMixedKernel;
    await assert.rejects(opener(), error => error instanceof NativeKernelError && error.code === 'BX_BACKEND' && error.message.includes(`WONKY_BACKEND=${mode}`));
    for (const [bin, source] of [['bin/wonky.mjs', 'examples/bracket.fs'], ['bin/wonky-python.mjs', 'examples/python-box.py']]) {
      const run = spawnSync(process.execPath, [join(root, bin), join(root, source), '--check'], {
        cwd: root, encoding: 'utf8', env: { ...process.env, WONKY_BACKEND: mode, NODE_OPTIONS: '--max-old-space-size=8192' }, timeout: 30000 });
      assert.notEqual(run.status, 0, `${mode} ${bin}: ${run.stdout}`);
      assert.match(run.stderr, new RegExp(`WONKY_BACKEND=${mode}.*package B1`), `${bin}: ${run.stderr}`);
    }
  }
});


test('rust-diff: an entry Rust does not serve refuses and Bend never answers for it; replies compare word for word (B1: enable after first Rust entries and per-build provenance)', { skip: 'Bend toolchain: mixed-backend integration is retired' }, async () => {
  const { kernel } = await openRustDiffKernel({ dumpDir: join(work, 'divergence') });
  const { real } = await import('../src/real.mjs');
  assert.throws(() => kernel.real.max(real(1), real(2)), error => error instanceof NativeCapabilityError && error.entry === 'kernel/real.bend:max' && error.backend === 'rust-diff' && error.message.includes('(WONKY_BACKEND=rust-diff)'));
  const op = ops[opId('kernel/real.bend:max')];
  const request = Uint32Array.from([1, 2, 3, 4]);
  assert.equal(compareRustReplies({ op, request, rustReply: Uint32Array.from([0, 7, 8]), jsReply: Uint32Array.from([0, 7, 8]), sourceHash: 'x', dumpDir: join(work, 'divergence') }), 3);
  assert.throws(() => compareRustReplies({ op, request, rustReply: Uint32Array.from([0, 7, 9]), jsReply: Uint32Array.from([0, 7, 8]), sourceHash: 'x', dumpDir: join(work, 'divergence') }),
    error => error instanceof BackendDivergenceError && error.wordIndex === 2 && /^the Rust kernel and the Bend JS target diverge in op \d+ \(kernel\/real\.bend:max\) at reply word 2 \(result word 1\): rust 0x9, js 0x8/.test(error.message) && existsSync(join(error.dump, 'meta.json')) && readJson(join(error.dump, 'meta.json')).entry === 'kernel/real.bend:max');
  assert.throws(() => compareRustReplies({ op, request, rustReply: Uint32Array.from([0, 7]), jsReply: Uint32Array.from([0, 7, 8]), sourceHash: 'x', dumpDir: join(work, 'divergence') }), BackendDivergenceError);
});

test('rust-mixed: listed entries go to Rust and a refusal is never answered by Bend; unlisted entries run on Bend JS; bad tables are refused (B1: enable after first Rust entries and per-build provenance)', { skip: 'Bend toolchain: mixed-backend integration is retired' }, async () => {
  const dir = join(work, 'mixed');
  mkdirSync(dir, { recursive: true });
  const table = join(dir, 'table.json');
  writeFileSync(table, JSON.stringify({ schema: 'wonky-rust-mixed/1', rust: ['kernel/real.bend:max'] }));
  const { kernel, backend: mixed } = await openRustMixedKernel({ table });
  assert.deepEqual(mixed.info.mixed.rust, ['kernel/real.bend:max']);
  const { real } = await import('../src/real.mjs');
  assert.throws(() => kernel.real.max(real(1), real(2)), error => error instanceof NativeCapabilityError && error.entry === 'kernel/real.bend:max' && error.backend === 'rust-mixed' && error.message.includes('(WONKY_BACKEND=rust-mixed)'));
  const sum = kernel.real.add(real(1), real(2));
  assert.equal(sum.hi + sum.lo, 3, 'real.add runs on Bend JS');
  writeFileSync(table, JSON.stringify({ schema: 'wonky-rust-mixed/1', rust: ['kernel/real.bend:no_such_entry'] }));
  await assert.rejects(openRustMixedKernel({ table }), error => error instanceof NativeKernelError && error.code === 'BX_BACKEND' && /no_such_entry/.test(error.message));
  writeFileSync(table, JSON.stringify({ rust: [] }));
  await assert.rejects(openRustMixedKernel({ table }), error => error instanceof NativeKernelError && error.code === 'BX_BACKEND');
});

test('rust-mixed with the tracked (empty) table builds a model on Bend JS and records the table in brep.json (B1: enable after first Rust entries and per-build provenance)', { skip: 'Bend toolchain: mixed-backend integration is retired', timeout: 120000 }, () => {
  const out = join(work, 'mixed-bracket', 'model');
  const cli = spawnSync(process.execPath, [join(root, 'bin/wonky.mjs'), join(root, 'examples/bracket.fs'), '--out', out], { cwd: root, encoding: 'utf8',
    env: { ...process.env, WONKY_BACKEND: 'rust-mixed' } });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /model\/extrusion: 12 vertices · 18 edges · 8 faces · 8832 mm³ · closed topology/);
  const brep = readFileSync(`${out}.brep.json`, 'utf8');
  assert.match(brep, /rust-mixed \(Rust \+ Bend JS by op table, wire v1\)/);
  assert.match(brep, /src\/native\/rust-mixed\.json/);
});

// An export proxy cannot change ownership when a second kernel opens.
test('export namespace retains its original Rust kernel after opening mixed (B1: enable after first Rust entries and per-build provenance)', { skip: 'Bend toolchain: mixed-backend integration is retired' }, async () => {
  await openRustKernel();
  const namespace = rustExportNamespace({ file: 'kernel/step-cylinder-pcurves.bend', namespace: 'stepCylinderPCurves', backend: 'rust' });
  const table = join(work, 'route-isolation.json');
  writeFileSync(table, JSON.stringify({ schema: 'wonky-rust-mixed/1', rust: [] }));
  await openRustMixedKernel({ table });
  assert.throws(() => namespace.max_budget({ $: 'Nil' }, { $: 'Real', hi: 1, lo: 0 }), NativeCapabilityError);
});

test('unported face-query services refuse on strict rust without importing Bend', { timeout: 180000 }, () => {
  const dir = join(work, 'face-query-services');
  mkdirSync(dir, { recursive: true });
  const source = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function main(context is Context, id is Id, definition is map) {
  fCuboid(context, id + "box", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
  const faces = qContainsPoint(qOwnedByBody(qCreatedBy(id + "box", EntityType.BODY), EntityType.FACE), vector(5, 0, 5) * millimeter);
  if (size(evaluateQuery(context, faces)) != 1) throw regenError("expected face");
}`;
  const probe = `import { build } from ${JSON.stringify(join(root, 'src/index.mjs'))};
    try { const model = await build(${JSON.stringify(source)}); console.log(JSON.stringify({ ok: true, bodies: model.bodies.length, target: model.backend.target })); }
    catch (error) { console.log(JSON.stringify({ ok: false, code: error.code, entry: error.entry, backend: error.backend, message: error.message })); }`;
  const guardFile = join(dir, 'rust-guard.json');
  const child = spawnSync(process.execPath, ['--import', guardPreload, '--input-type=module', '-e', probe],
    { cwd: root, encoding: 'utf8', timeout: 120000,
      env: { ...process.env, WONKY_BACKEND: 'rust', WONKY_BEND_GUARD_LOG: guardFile } });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout.trim().split('\n').at(-1));
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.backend, 'rust');
  assert.equal(result.code, 'BX_UNAVAILABLE');
  assert.equal(result.entry, 'host/query:invoke');
  assert.match(result.message, /qContainsPoint/);
  const guard = readJson(guardFile).summary;
  assert.equal(guard.bendLoaded, false, JSON.stringify(guard));
});

test('modeling services select the strict rust kernel classifier without loading Bend', async () => {
  const { openKernel } = await import('../src/native/backend.mjs');
  const kernel = await openKernel('rust');
  const services = await loadModelingServices(kernel);
  assert.equal(services.faceClassifier, kernel.faceClassifier);
});

// P3: an op table may only claim a Rust entry when the actual service routes to it.
test('rust-mixed face service routes qContainsPoint and records its executed provenance (B1: enable after first Rust entries and per-build provenance)', { skip: 'Bend toolchain: mixed-backend integration is retired', timeout: 120000 }, () => {
  const source = `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function main(context is Context, id is Id, definition is map) {
  fCuboid(context, id + "box", { "corner1" : vector(0,0,0) * millimeter, "corner2" : vector(10,10,10) * millimeter });
  const faces = qContainsPoint(qOwnedByBody(qCreatedBy(id + "box", EntityType.BODY), EntityType.FACE), vector(5,0,5) * millimeter);
  if (size(evaluateQuery(context, faces)) != 1) throw regenError("expected face");
}`;
  const dir = join(work, 'mixed-face-service');
  mkdirSync(dir, { recursive: true });
  const probe = `import { build } from ${JSON.stringify(join(root, 'src/index.mjs'))};
    try { const model = await build(${JSON.stringify(source)}); console.log(JSON.stringify({ ok: true, execution: model.backend.mixedExecution })); }
    catch (error) { console.log(JSON.stringify({ ok: false, code: error.code, entry: error.entry, message: error.message })); }`;
  const run = entries => {
    const table = join(dir, `ops-${entries.length}.json`);
    writeFileSync(table, JSON.stringify({ schema: 'wonky-rust-mixed/1', rust: entries }));
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192', WONKY_BACKEND: 'rust-mixed', WONKY_RUST_MIXED: table } });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout.trim().split('\n').at(-1));
  };
  const entry = 'kernel/face-classification.bend:linear_edge';
  const bend = run([]);
  assert.equal(bend.ok, true, JSON.stringify(bend));
  assert.ok(bend.execution.bend.includes(entry), JSON.stringify(bend));
  const rust = run([entry]);
  assert.equal(rust.ok, false, JSON.stringify(rust));
  assert.equal(rust.entry, entry);
});

test('generated wire changes invalidate the loader and cache hits validate generation', () => {
  const generated = join(root, 'src/native/rust-wire.mjs');
  const original = readFileSync(generated);
  const located = locateRustBuild();
  try {
    writeFileSync(generated, Buffer.concat([original, Buffer.from('\n// stale generated wire\n')]));
    assert.notEqual(computeKey(root).sourceHash, located.manifest.sourceHash);
    assert.throws(() => rustStaleCheck(located), error => error instanceof NativeKernelStaleError && /src\/native\/rust-wire\.mjs changed/.test(error.message));
    const child = spawnSync(process.execPath, [join(root, 'scripts/rust/build-node.mjs')], { cwd: root, encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /generated wire is stale/);
  } finally { writeFileSync(generated, original); }
});

test('all W0 plant anchors match exactly once', async () => {
  const { PLANTS } = await import('../scripts/rust/w0-plants.mjs');
  for (const plant of PLANTS) {
    const text = readFileSync(join(root, plant.file), 'utf8');
    assert.equal(text.split(plant.from).length - 1, 1, plant.name);
  }
});

test('cold addon build follows Cargo artifact messages for all target-dir mechanisms (P7)', { timeout: 180000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-cargo-artifact-'));
  const home = join(dir, 'cargo-home');
  mkdirSync(home);
  writeFileSync(join(home, 'config.toml'), `[build]\ntarget-dir = ${JSON.stringify(join(dir, 'configured'))}\n`);
  try {
    for (const [name, env, target] of [
      ['CARGO_TARGET_DIR', { CARGO_TARGET_DIR: join(dir, 'direct') }, join(dir, 'direct')],
      ['CARGO_BUILD_TARGET_DIR', { CARGO_BUILD_TARGET_DIR: join(dir, 'build-env') }, join(dir, 'build-env')],
      ['build.target-dir', { CARGO_HOME: home }, join(dir, 'configured')],
    ]) {
      const built = buildAddon([], ['--cache', join(dir, `cache-${name}`)], {
        ...process.env, CARGO_TARGET_DIR: undefined, CARGO_BUILD_TARGET_DIR: undefined, ...env,
      });
      assert.equal(built.cached, false, name);
      assert.equal(built.cargoArtifact, join(target, 'release', process.platform === 'darwin' ? 'libwonky_node.dylib' : 'libwonky_node.so'), name);
      assert.ok(existsSync(join(built.dir, 'wonky-node.node')), name);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('builder honors an absolute CARGO_TARGET_DIR and still validates source hash', () => {
  const cache = mkdtempSync(join(tmpdir(), 'wonky-node-target-'));
  try {
    const target = join(root, 'rust/target');
    const built = buildAddon([], ['--cache', cache], { ...process.env, CARGO_TARGET_DIR: target });
    assert.equal(built.cached, false);
    assert.equal(built.sourceHash, computeKey(root).sourceHash);
    assert.equal(buildAddon([], ['--cache', cache], { ...process.env, CARGO_TARGET_DIR: target }).cached, true);
    const nested = spawnSync(process.execPath, [join(root, 'scripts/rust/build-node.mjs'), '--cache', cache], { cwd: root, encoding: 'utf8',
      env: { ...process.env, CARGO_TARGET_DIR: 'nested-output' } });
    assert.notEqual(nested.status, 0);
    assert.match(nested.stderr, /CARGO_TARGET_DIR.*rust\/target/);
    const rootOutput = spawnSync(process.execPath, [join(root, 'scripts/rust/build-node.mjs'), '--cache', cache], { cwd: root, encoding: 'utf8',
      env: { ...process.env, CARGO_TARGET_DIR: '.' } });
    assert.notEqual(rootOutput.status, 0);
    assert.match(rootOutput.stderr, /CARGO_TARGET_DIR.*rust\/target/);
  } finally { rmSync(cache, { recursive: true, force: true }); }
});
