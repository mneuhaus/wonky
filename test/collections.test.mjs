import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("kernel/vendor/bend-collections/PIN.json", "local design note");
if (publicTreeSkip) {
  test("collections.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { execFileSync } = await import("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
const { array, list } = await import("../src/kernel.mjs");
// The vendored bend-collections tree (kernel/vendor/bend-collections) and the
// kernel/lib adapters over it (docs/collections.md), on the JS target through
// src/bend-loader.mjs. Every adapter answer is compared with a plain JS oracle
// on seeded random scripts. WONKY_COLLECTIONS_NATIVE=1 also builds the same
// drivers with the pinned bend CLI and requires identical answers natively.










const root = fileURLToPath(new URL('../', import.meta.url));
const probePath = join(root, 'kernel/lib/collections-probe.bend');
const probe = await loadBend(probePath);

// Bend lists become JS arrays, recursively; constructors keep their fields.
const plain = value => {
  if (value && typeof value === 'object') {
    if (value.$ === 'Con' || value.$ === 'Nil') return array(value).map(plain);
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, plain(field)]));
  }
  return value;
};
const NONE = 4294967295;

// Small deterministic PRNG (mulberry32), so a failure names a reproducible seed.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ints = (random, n, bound) => Array.from({ length: n }, () => Math.floor(random() * bound));

test('vendored tree matches its manifest and pin', () => {
  const out = execFileSync(process.execPath, [join(root, 'scripts/vendor/bend-collections.mjs'), '--offline'], { encoding: 'utf8' });
  assert.match(out, /5af9089cb0c70e696d5a47dc697fa873ff8fb97c: 49 files identical/);
  const pin = JSON.parse(readFileSync(join(root, 'kernel/vendor/bend-collections/PIN.json'), 'utf8'));
  assert.equal(pin.repository, 'https://github.com/Giulio2002/bend-collections');
  assert.match(readFileSync(join(root, 'local design note'), 'utf8'), new RegExp(pin.commit));
});

// Fixed cases shared with the native build below.
const fixed = {
  dynamic_array: [probe.dynamic_array(list([5, 7, 9]), 1), probe.dynamic_array(list([5, 7, 9]), 3)],
  tree_map_value: [probe.tree_map_value(list([30, 10, 20]), 20), probe.tree_map_value(list([30, 10, 20]), 40)],
  tree_map_keys: probe.tree_map_keys(list([30, 10, 20, 10])),
  bitset_members: probe.bitset_members(40, list([33, 2, 99, 2])),
  hash_map_value: [probe.hash_map_value(list(['a', 'bb', 'ccc', 'bb']), 'bb'), probe.hash_map_value(list(['a']), 'zz')],
  sha256: [probe.sha256_hex('abc'), probe.sha256_hex('')],
  id_vec: probe.id_vec_script(list([5, 6, 7]), list([1, 9, 0]), list([60, 90, 50]), list([0, 1, 2, 3, 100]), 77),
  id_set: probe.id_set_script(70, list([3, 64, 69, 70, 3]), list([64, 80]), list([3, 64, 69, 70, 5]), list([1, 2, 69])),
  edge_map: probe.edge_map(list([3, 1, 2, 5]), list([1, 3, 0, 5]), list([1, 3, 0, 9]), list([3, 1, 2, 9])),
};

test('every vendored module compiles in the loader; containers and SHA-256 answer', () => {
  assert.deepEqual(fixed.dynamic_array.map(plain), [[7, 5, 7, 9], [NONE, 5, 7, 9]]);
  assert.deepEqual(fixed.tree_map_value, [200, NONE]);
  assert.deepEqual(plain(fixed.tree_map_keys), [10, 20, 30]);
  assert.deepEqual(plain(fixed.bitset_members), [2, 33]);
  assert.deepEqual(fixed.hash_map_value, [4, 0]);
  assert.deepEqual(fixed.sha256, ['ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']);
});

function vecOracle(xs, ids, values, gets, fallback) {
  const items = [...xs], flags = [true];
  ids.forEach((id, k) => { const ok = id < items.length; if (ok) items[id] = values[k]; flags.push(ok); });
  return { $: 'VecTrace', flags, reads: gets.map(id => (id < items.length ? items[id] : fallback)), items, length: items.length };
}

test('IdVec: from_list, set, get with fallback, find, filled agree with a JS array', () => {
  assert.deepEqual(plain(fixed.id_vec), vecOracle([5, 6, 7], [1, 9, 0], [60, 90, 50], [0, 1, 2, 3, 100], 77));
  const random = rng(20260923);
  for (let round = 0; round < 40; round++) {
    const n = Math.floor(random() * 70), bound = n + 5;
    const xs = ints(random, n, 1000), ids = ints(random, 30, bound), values = ints(random, 30, 1000), gets = ints(random, 30, bound);
    const got = plain(probe.id_vec_script(list(xs), list(ids), list(values), list(gets), NONE));
    assert.deepEqual(got, vecOracle(xs, ids, values, gets, NONE), `round ${round}`);
  }
  assert.deepEqual(plain(probe.id_vec_script(list([]), list([0]), list([1]), list([0]), 9)), vecOracle([], [0], [1], [0], 9));
  assert.deepEqual(plain(probe.id_vec_filled(4, 3, list([2, 4]), list([8, 1]))),
    { $: 'VecTrace', flags: [true, true, false], reads: [], items: [3, 3, 8, 3], length: 4 });
  assert.deepEqual(plain(probe.id_vec_filled(0, 3, list([]), list([]))), { $: 'VecTrace', flags: [true], reads: [], items: [], length: 0 });
  assert.deepEqual(plain(probe.id_vec_find(list([5, 6]), 1)), { $: 'Some', value: 6 });
  assert.deepEqual(plain(probe.id_vec_find(list([5, 6]), 2)), { $: 'None' });
  assert.deepEqual(plain(probe.id_vec_find(list([5, 6]), NONE)), { $: 'None' });
});

function setOracle(n, adds, removes, probes, anyOf) {
  const set = new Set();
  let added = true;
  for (const id of adds) { if (id < n) set.add(id); else added = false; }
  const removed = removes.map(id => { const ok = id < n; if (ok) set.delete(id); return ok; });
  const has = id => id < n && set.has(id);
  return { $: 'SetTrace', added, removed, probes: probes.map(has), any: anyOf.some(has), count: set.size, capacity: n,
    members: [...set].sort((a, b) => a - b) };
}

test('IdSet: add, remove, has, has_any, count, members agree with a JS Set', () => {
  assert.deepEqual(plain(fixed.id_set), setOracle(70, [3, 64, 69, 70, 3], [64, 80], [3, 64, 69, 70, 5], [1, 2, 69]));
  const random = rng(7);
  for (let round = 0; round < 40; round++) {
    // Capacities around the 32-bit word boundaries, ids a little past the end.
    const n = [0, 1, 31, 32, 33, 63, 64, 65, 100, 257][round % 10] + Math.floor(random() * 3), bound = n + 4;
    const adds = ints(random, 40, bound), removes = ints(random, 15, bound), probes = ints(random, 25, bound), anyOf = ints(random, 1 + (round % 4), bound);
    const got = plain(probe.id_set_script(n, list(adds), list(removes), list(probes), list(anyOf)));
    assert.deepEqual(got, setOracle(n, adds, removes, probes, anyOf), `round ${round} n=${n}`);
  }
  assert.equal(plain(probe.id_set_script(8, list([1]), list([]), list([]), list([]))).any, false);
});

function edgeOracle(as, bs, qa, qb) {
  const key = (a, b) => (a <= b ? [a, b] : [b, a]), map = new Map();
  as.forEach((a, k) => map.set(key(a, bs[k]).join(), k));
  const keys = [...map.keys()].map(text => text.split(',').map(Number)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return { $: 'EdgeTrace', keys: keys.map(([a, b]) => ({ $: 'P', a, b })),
    found: qa.map((a, k) => map.get(key(a, qb[k]).join()) ?? NONE), size: map.size };
}

test('tree map over undirected edge keys (keys.bend edge, pair_cmp) agrees with a JS Map', () => {
  assert.deepEqual(plain(fixed.edge_map), edgeOracle([3, 1, 2, 5], [1, 3, 0, 5], [1, 3, 0, 9], [3, 1, 2, 9]));
  const random = rng(99);
  for (let round = 0; round < 25; round++) {
    const n = Math.floor(random() * 60), v = 2 + Math.floor(random() * 20);
    const as = ints(random, n, v), bs = ints(random, n, v), qa = ints(random, 20, v + 2), qb = ints(random, 20, v + 2);
    assert.deepEqual(plain(probe.edge_map(list(as), list(bs), list(qa), list(qb))), edgeOracle(as, bs, qa, qb), `round ${round}`);
  }
  // U32 extremes compare unsigned.
  assert.deepEqual(plain(probe.edge_map(list([NONE, 0]), list([0, 2147483648]), list([0]), list([NONE]))),
    edgeOracle([NONE, 0], [0, 2147483648], [0], [NONE]));
});

const f32Bits = x => new Uint32Array(new Float32Array([x]).buffer)[0];
const orderBits = x => { const b = f32Bits(x); return b >= 2147483648 ? (~b) >>> 0 : (b | 2147483648) >>> 0; };

test('exact Vec3 keys: f32_order is monotone and injective; point_map dedups bit-identical points', () => {
  const special = [-Infinity, -3.5e38, -1, -1e-45, -0, 0, 1e-45, 1, 3.5e38, Infinity];
  assert.deepEqual(plain(probe.f32_orders(list(special))), special.map(orderBits));
  const random = rng(3);
  const floats = Array.from({ length: 200 }, () => Math.fround((random() - 0.5) * 10 ** Math.floor(random() * 12 - 6)));
  const orders = plain(probe.f32_orders(list(floats)));
  assert.deepEqual(orders, floats.map(orderBits));
  const sorted = [...floats].sort((a, b) => a - b || (Object.is(a, -0) ? -1 : Object.is(b, -0) ? 1 : 0));
  const sortedOrders = plain(probe.f32_orders(list(sorted)));
  for (let k = 1; k < sortedOrders.length; k++) assert.ok(sortedOrders[k - 1] <= sortedOrders[k], `order at ${k}`);

  // Grid points with repeats and signed zeros: keys ascend lexicographically, first index kept.
  const coords = [-1.5, -0, 0, 0.1, 2];
  const points = Array.from({ length: 80 }, () => [0, 1, 2].map(() => Math.fround(coords[Math.floor(random() * coords.length)])));
  const firsts = new Map();
  points.forEach((p, k) => { const key = p.map(orderBits).join(); if (!firsts.has(key)) firsts.set(key, k); });
  const keys = [...firsts.keys()].map(text => text.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const got = plain(probe.point_map(list(points.map(p => p[0])), list(points.map(p => p[1])), list(points.map(p => p[2]))));
  assert.deepEqual(got, { $: 'PointTrace', keys: keys.map(([x, y, z]) => ({ $: 'K3', x, y, z })), firsts: keys.map(k => firsts.get(k.join())) });
});

// The same fixed cases through a native build (pinned bend CLI + clang).
const nativeDriver = `import Base
import ${probePath} as P
import ${join(root, "kernel/lib/keys.bend")} as K

def u32s(xs: List<&2, U32>) -> String:
  match xs:
    case Nil{}:
      ""
    case x <> tail:
      U32.show(x) ++ "," ++ u32s(tail)

def bools(xs: List<&2, Bool>) -> String:
  match xs:
    case Nil{}:
      ""
    case x <> tail:
      Bool.pick(String, x, "1", "0") ++ "," ++ bools(tail)

def pairs(xs: List<&2, K.IdPair>) -> String:
  match xs:
    case Nil{}:
      ""
    case K.P{a, b} <> tail:
      U32.show(a) ++ "-" ++ U32.show(b) ++ "," ++ pairs(tail)

def vec(t: P.VecTrace) -> String:
  P.VecTrace{flags, reads, items, n} = t
  bools(flags) ++ "|" ++ u32s(reads) ++ "|" ++ u32s(items) ++ "|" ++ U32.show(n)

def set(t: P.SetTrace) -> String:
  P.SetTrace{added, removed, probes, any, count, capacity, members} = t
  bools([added]) ++ "|" ++ bools(removed) ++ "|" ++ bools(probes) ++ "|" ++ bools([any]) ++ "|" ++ U32.show(count) ++ "|" ++ U32.show(capacity) ++ "|" ++ u32s(members)

def edges(t: P.EdgeTrace) -> String:
  P.EdgeTrace{keys, found, size} = t
  pairs(keys) ++ "|" ++ u32s(found) ++ "|" ++ U32.show(size)

def main() -> IO(Unit):
  do IO<Unit>:
    IO.print(u32s(P.dynamic_array([5, 7, 9], 1)) ++ " " ++ u32s(P.dynamic_array([5, 7, 9], 3)))
    IO.print(U32.show(P.tree_map_value([30, 10, 20], 20)) ++ " " ++ U32.show(P.tree_map_value([30, 10, 20], 40)))
    IO.print(u32s(P.tree_map_keys([30, 10, 20, 10])))
    IO.print(u32s(P.bitset_members(40, [33, 2, 99, 2])))
    IO.print(U32.show(P.hash_map_value(["a", "bb", "ccc", "bb"], "bb")) ++ " " ++ U32.show(P.hash_map_value(["a"], "zz")))
    IO.print(P.sha256_hex("abc") ++ " " ++ P.sha256_hex(""))
    IO.print(vec(P.id_vec_script([5, 6, 7], [1, 9, 0], [60, 90, 50], [0, 1, 2, 3, 100], 77)))
    IO.print(set(P.id_set_script(70, [3, 64, 69, 70, 3], [64, 80], [3, 64, 69, 70, 5], [1, 2, 69])))
    IO.print(edges(P.edge_map([3, 1, 2, 5], [1, 3, 0, 5], [1, 3, 0, 9], [3, 1, 2, 9])))
`;

test('native build of the same drivers answers identically', { skip: process.env.WONKY_COLLECTIONS_NATIVE !== '1' && 'set WONKY_COLLECTIONS_NATIVE=1 (about 30 s)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-collections-'));
  try {
    writeFileSync(join(dir, 'driver.bend'), nativeDriver);
    execFileSync(join(root, '.tools/bend-2.0.25/bin/bend'), ['driver.bend', '-o', 'driver'], { cwd: dir, stdio: 'pipe' });
    const lines = execFileSync(join(dir, 'driver'), { encoding: 'utf8' }).trim().split('\n');
    const u32s = xs => xs.map(x => `${x},`).join(''), bools = xs => xs.map(x => (x ? '1,' : '0,')).join('');
    const v = plain(fixed.id_vec), s = plain(fixed.id_set), e = plain(fixed.edge_map);
    assert.deepEqual(lines, [
      fixed.dynamic_array.map(plain).map(u32s).join(' '),
      fixed.tree_map_value.join(' '),
      u32s(plain(fixed.tree_map_keys)),
      u32s(plain(fixed.bitset_members)),
      fixed.hash_map_value.join(' '),
      fixed.sha256.join(' '),
      [bools(v.flags), u32s(v.reads), u32s(v.items), v.length].join('|'),
      [bools([s.added]), bools(s.removed), bools(s.probes), bools([s.any]), s.count, s.capacity, u32s(s.members)].join('|'),
      [e.keys.map(({ a, b }) => `${a}-${b},`).join(''), u32s(e.found), e.size].join('|'),
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

}
