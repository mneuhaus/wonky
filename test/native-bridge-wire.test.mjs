import { test } from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("native-bridge-wire.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { performance } = await import("node:perf_hooks");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
const { number, real } = await import("../src/real.mjs");
const { WireError, closure, parseModule, resolveType, writeGenerated } = await import("../scripts/native-bridge/gen-wire.mjs");
// Round-trip proof for the generated native-bridge wire codecs
// (scripts/native-bridge/gen-wire.mjs). The generated Bend module is compiled
// with the JS target; its encoders/decoders/dispatcher must agree word for
// word with the generated JS codecs, and must be bit-exact on F32 / Real.










process.env.BEND_NO_TELEMETRY = '1';
const root = new URL('../', import.meta.url);
const outDir = fileURLToPath(new URL('tmp/native-bridge/surface/gen/', root));
const TYPES = ['real.bend:Real', 'face-classification.bend:DomainChoice', 'analytic.bend:Solid', 'identity.bend:ParentIdentity', 'identity.bend:IdentitySet'];
const OPS = ['real.bend:max', 'analytic.bend:frustum', 'identity.bend:frustum'];
const { manifest } = writeGenerated({ types: TYPES, ops: OPS, outDir });
const bend = await loadBend(new URL('wire.bend', `file://${outDir}`), { cacheDirectory: fileURLToPath(new URL('tmp/native-bridge/surface/bend-cache/', root)) });
const { codecs, ops } = await import(new URL('wire.mjs', `file://${outDir}`).href + `?t=${Date.now()}`);

// Imported kernel defs are keyed by their import path, e.g. '../../../../kernel/analytic.frustum'.
const kernelDef = name => bend[Object.keys(bend).find(key => key.endsWith(`/kernel/${name}`))] ?? assert.fail(`missing kernel def ${name}`);
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const fromBits = word => { u32[0] = word; return f32[0]; };
const bitsOf = value => { f32[0] = value; return u32[0]; };
const R = (hi, lo) => ({ $: 'Real', hi, lo });
const V = (x, y, z) => ({ $: 'V3', x, y, z });
const fromList = xs => { const out = []; for (; xs.$ === 'Con'; xs = xs.tail) out.push(xs.head); assert.equal(xs.$, 'Nil'); return out; };
const toList = values => values.reduceRight((tail, head) => ({ $: 'Con', head, tail }), { $: 'Nil' });

// Structural equality that distinguishes -0 from 0 (Object.is on numbers).
function same(a, b, path = '$') {
  if (typeof a === 'number' || typeof b === 'number') return assert.ok(Object.is(a, b), `${path}: ${a} !== ${b}`);
  if (typeof a !== 'object' || a === null) return assert.equal(a, b, path);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);
  for (const key of Object.keys(a)) same(a[key], b[key], `${path}.${key}`);
}

// Values seen in the nativeChainExact:false diff, plus -0 and subnormal limbs.
const reals = [
  R(-1, Math.fround(2.2438708385304134e-31)),
  R(8, Math.fround(1.1368683094535245e-14)),
  R(1, Math.fround(-4.04e-28)),
  R(-0, -0),
  R(fromBits(0x00000001), fromBits(0x80000001)),
  R(fromBits(0x7f7fffff), fromBits(0x73000000)),
];

test('generator closure covers the analytic Solid tree', () => {
  assert.deepEqual(manifest.roots, TYPES);
  const names = manifest.adts.map(adt => adt.type);
  for (const name of ['real.bend:Real', 'precise.bend:Vec3', 'identity.bend:EntityIdentity', 'analytic.bend:Curve', 'analytic.bend:Surface', 'analytic.bend:Edge',
    'topology.bend:Coedge', 'analytic.bend:Loop', 'analytic.bend:Face', 'analytic.bend:Solid', 'curve-plane.bend:Domain', 'face-classification.bend:DomainChoice']) {
    assert.ok(names.includes(name), name);
  }
  assert.equal(manifest.adts.find(adt => adt.type === 'real.bend:Real').fixedWords, 2);
  assert.equal(manifest.adts.find(adt => adt.type === 'precise.bend:Vec3').fixedWords, 6);
});

test('Real crosses as exactly two F32 bit patterns, Bend and JS agree', () => {
  const codec = codecs['real.bend:Real'];
  for (const value of reals) {
    const words = codec.encode(value);
    assert.deepEqual([...words], [bitsOf(value.hi), bitsOf(value.lo)]);
    assert.deepEqual(fromList(bend.encode_real_Real(value)), [...words]);
    const decoded = bend.decode_real_Real(toList([...words]));
    assert.equal(decoded.$, 'Some');
    same(decoded.value, value);
    assert.deepEqual(fromList(bend.encode_real_Real(decoded.value)), [...words]);
    same(codec.decode(words), value);
  }
});

test('the binary64 collapse in src/real.mjs is what loses the low word', () => {
  const codec = codecs['real.bend:Real'];
  const lossy = reals.slice(0, 3).map(value => real(number(value)));
  assert.equal(lossy[0].lo, 0);
  assert.notEqual(bitsOf(lossy[1].lo), bitsOf(reals[1].lo));
  assert.equal(lossy[2].lo, 0);
  for (const value of reals) same(codec.decode(codec.encode(value)), value);
});

test('DomainChoice variants round-trip through Bend and JS', () => {
  const codec = codecs['face-classification.bend:DomainChoice'];
  const values = [
    { $: 'AutoDomain' },
    { $: 'GivenDomain', domain: { $: 'Untrimmed' } },
    { $: 'GivenDomain', domain: { $: 'Interval', first: reals[0], last: reals[1] } },
  ];
  const expected = [[0], [1, 0], [1, 1, bitsOf(reals[0].hi), bitsOf(reals[0].lo), bitsOf(reals[1].hi), bitsOf(reals[1].lo)]];
  values.forEach((value, i) => {
    const words = codec.encode(value);
    assert.deepEqual([...words], expected[i]);
    assert.deepEqual(fromList(bend.encode_face_classification_DomainChoice(value)), [...words]);
    const decoded = bend.decode_face_classification_DomainChoice(toList([...words]));
    same(decoded.value, value);
    same(codec.decode(words), value);
  });
});

function frustumArgs() {
  return [V(R(0, 0), R(0, 0), R(0, 0)), V(R(0, 0), R(0, 0), R(10, 0)), V(R(1, 0), R(0, 0), R(0, 0)), R(5, 0), R(3, Math.fround(1.1368683094535245e-14) / 64)];
}

test('an analytic frustum Solid from the kernel round-trips bit-exactly', () => {
  const solid = kernelDef('analytic.frustum')(...frustumArgs());
  const codec = codecs['analytic.bend:Solid'];
  const words = codec.encode(solid);
  assert.deepEqual(fromList(bend.encode_analytic_Solid(solid)), [...words]);
  const decoded = bend.decode_analytic_Solid(toList([...words]));
  assert.equal(decoded.$, 'Some');
  same(decoded.value, solid);
  assert.deepEqual(fromList(bend.encode_analytic_Solid(decoded.value)), [...words]);
  same(codec.decode(words), solid);
  const nonzeroLow = [...words].filter((_, i) => i % 2 === 1).some(word => word !== 0 && word !== 0x80000000);
  assert.ok(nonzeroLow, 'fixture exercises non-zero low limbs');
});

test('dispatch runs kernel defs on wire frames and matches direct calls', () => {
  const [max, frustum] = ops;
  const request = max.encode([reals[1], reals[0]]);
  const response = fromList(bend.dispatch(max.id, toList([...request])));
  const direct = kernelDef('real.max')(reals[1], reals[0]);
  assert.deepEqual(response, [0, ...codecs['real.bend:Real'].encode(direct)]);
  same(max.decode(Uint32Array.from(response)), direct);

  const args = frustumArgs();
  const frame = fromList(bend.dispatch(frustum.id, toList([...frustum.encode(args)])));
  const solid = kernelDef('analytic.frustum')(...args);
  assert.deepEqual(frame, [0, ...codecs['analytic.bend:Solid'].encode(solid)]);
  same(frustum.decode(Uint32Array.from(frame)), solid);
});

// String is the only non-numeric scalar on the production surface
// (kernel/identity.bend). JS-target Strings are JS strings; the wire carries
// Unicode code points, so astral characters count once on both sides.
const identityArgs = ['ns/ä', 'op😀/1', 'occ', 'sha256:00ff'];

test('identity strings round-trip through Bend and JS, including astral code points', () => {
  const set = kernelDef('identity.frustum')(...identityArgs);
  const codec = codecs['identity.bend:IdentitySet'];
  const words = codec.encode(set);
  assert.deepEqual(fromList(bend.encode_identity_IdentitySet(set)), [...words]);
  const decoded = bend.decode_identity_IdentitySet(toList([...words]));
  assert.equal(decoded.$, 'Some');
  same(decoded.value, set);
  same(codec.decode(words), set);
  const parent = codecs['identity.bend:ParentIdentity'];
  const value = { $: 'ParentIdentity', origin_id: '😀', instance_id: '', revision: 'ä', operation_id: 'x' };
  assert.deepEqual([...parent.encode(value)], [1, 0x1f600, 0, 1, 0xe4, 1, 0x78]);
  same(bend.decode_identity_ParentIdentity(toList([...parent.encode(value)])).value, value);
  const frame = fromList(bend.dispatch(ops[2].id, toList([...ops[2].encode(identityArgs)])));
  assert.deepEqual(frame, [0, ...words]);
  same(ops[2].decode(Uint32Array.from(frame)), set);
});

test('malformed frames fail loudly on both sides', () => {
  const badChar = [1, 0x110000, 0, 0, 0];
  assert.equal(bend.decode_identity_ParentIdentity(toList(badChar)).$, 'None');
  assert.throws(() => codecs['identity.bend:ParentIdentity'].decode(Uint32Array.from(badChar)), /Char 1114112/);
  assert.equal(bend.decode_identity_ParentIdentity(toList([5, 97])).$, 'None');
  assert.throws(() => codecs['identity.bend:ParentIdentity'].decode(Uint32Array.of(5, 97)), /string length exceeds message/);
  const words = [...codecs['real.bend:Real'].encode(reals[0])];
  assert.equal(bend.decode_real_Real(toList(words.slice(0, 1))).$, 'None');
  assert.equal(bend.decode_real_Real(toList([...words, 7])).$, 'None');
  assert.equal(bend.decode_face_classification_DomainChoice(toList([2])).$, 'None');
  assert.equal(bend.decode_face_classification_DomainChoice(toList([1, 9])).$, 'None');
  assert.deepEqual(fromList(bend.dispatch(ops[0].id, toList(words))), [1]);
  assert.deepEqual(fromList(bend.dispatch(99, toList([]))), [2]);
  assert.throws(() => codecs['real.bend:Real'].decode(Uint32Array.of(words[0])), /truncated/);
  assert.throws(() => codecs['real.bend:Real'].decode(Uint32Array.of(...words, 7)), /trailing/);
  assert.throws(() => codecs['face-classification.bend:DomainChoice'].decode(Uint32Array.of(2)), /tag 2/);
  assert.throws(() => codecs['real.bend:Real'].encode(R(0.1, 0)), /not exactly representable/);
  assert.throws(() => codecs['analytic.bend:Solid'].decode(Uint32Array.of(0xffffffff)), /exceeds message/);
});

// Fix round 2: the Bend decoder used to decode a claimed count of elements
// before noticing the words had run out (4 request bytes pinned GBs natively;
// the heap bound is test/native-bridge-slice.test.mjs (j)). Both decoders now
// apply one rule: n elements of at least w words need n * w words after the count.
test('both decoders refuse a count the remaining words cannot carry, at the same boundary, before decoding it', () => {
  const solid = codecs['analytic.bend:Solid'];
  const vec3 = manifest.adts.find(adt => adt.type === 'precise.bend:Vec3');
  assert.equal(vec3.minWords, 6);
  // Solid{vertices: List<Vec3>, edges, faces}: one zero Vec3 is 6 words, then two empty lists
  const fits = [1, 0, 0, 0, 0, 0, 0, 0, 0];
  same(bend.decode_analytic_Solid(toList(fits)).value, solid.decode(Uint32Array.from(fits)));
  // two Vec3s need 12 words, only 8 follow: refused on both sides (the JS codec before reading one element)
  const short = [2, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(bend.decode_analytic_Solid(toList(short)).$, 'None');
  assert.throws(() => solid.decode(Uint32Array.from(short)), /list length exceeds message/);
  // strings: one word per character
  assert.equal(bend.decode_identity_ParentIdentity(toList([2, 97])).$, 'None');
  // a claim of 2^20 elements is answered at once; only then the largest claim
  // (which would not finish if the Bend decoder looped over it)
  const t0 = performance.now();
  assert.equal(bend.decode_analytic_Solid(toList([2 ** 20])).$, 'None');
  assert.equal(bend.decode_identity_ParentIdentity(toList([2 ** 20])).$, 'None');
  const ms = performance.now() - t0;
  assert.ok(ms < 250, `refusing a 2^20 claim took ${ms.toFixed(1)} ms on the Bend JS target: the elements were decoded first`);
  assert.equal(bend.decode_analytic_Solid(toList([0xffffffff])).$, 'None');
  assert.equal(bend.decode_identity_IdentitySet(toList([0xffffffff])).$, 'None');
  assert.deepEqual(fromList(bend.dispatch(ops[0].id, toList([0xffffffff]))), [1]);
  // identity.frustum(String, ...): a String claiming 2^32 - 1 characters
  assert.deepEqual(fromList(bend.dispatch(ops[2].id, toList([0xffffffff]))), [1]);
  assert.deepEqual(fromList(bend.dispatch(ops[2].id, toList([0, 0, 0, 0xffffffff, 97]))), [1]);
});

test('the generator refuses a list whose elements can be zero words wide', () => {
  const dir = fileURLToPath(new URL('tmp/native-bridge/surface/zero-width/', root));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'units.bend');
  writeFileSync(file, 'import Base\n\ntype Unit is Data:\n  Unit{}\n\ntype Units is Data:\n  Units{items: List<&2, Unit>}\n');
  const module = parseModule(file);
  assert.throws(() => closure([resolveType(module, 'Units')]), error => error instanceof WireError && /zero words cannot be bounded/.test(error.message));
  assert.deepEqual(closure([resolveType(module, 'Unit')]).map(t => t.name), ['Unit']);
});

// The whole production surface (scripts/native-bridge/surface-scan.mjs), not
// just the three sample types: every entry point's signature must be codable,
// and no generated encoder may hold more than 255 words across a non-tail
// call (Bend's C emitter refuses that). Generation only; compiling and
// replaying real values is scripts/native-bridge/wire-closure.mjs.
test('every production entry point generates codecs within the native width estimate', async () => {
  const { scan } = await import('../scripts/native-bridge/surface-scan.mjs');
  const surface = scan();
  const specs = surface.entries.filter(entry => entry.production).map(entry => entry.entry.replace(/^kernel\//, ''));
  assert.ok(specs.length >= 80, `expected the full production surface, got ${specs.length} entries`);
  assert.deepEqual(surface.unsupportedProductionTypes, []);
  const { manifest } = writeGenerated({ types: [], ops: specs, outDir: fileURLToPath(new URL('tmp/native-bridge/surface/closure-check/', root)) });
  assert.equal(manifest.ops.length, specs.length);
  assert.deepEqual(manifest.nativeWidthWarnings, []);
});

}
