import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend() || missing("kernel/ports/occt.bend");
if (publicTreeSkip) {
  test("collections-hotspot.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
const { array, list } = await import("../src/kernel.mjs");
// The graph/table rewrites of the solid-validation passes (docs/collections.md,
// "Hotspot rewrite"): face connectivity as a BFS over an edge -> faces table,
// per-edge use counts in one pass, used-vertex flags, and the vertex remap
// table. Each is compared on seeded random structures with a JS oracle that
// restates the former list definition (for connectivity: the Jacobi fold).
// Connectivity is also checked on the same faces with their edge ids renamed
// to sparse ids, which the kernel ranks to dense ids before the BFS.






const root = fileURLToPath(new URL('../', import.meta.url));
const hs = await loadBend(root + 'kernel/halfspace.bend');
const section = await loadBend(root + 'kernel/section.bend');
const occt = await loadBend(root + 'kernel/ports/occt.bend');
const NONE = 4294967295;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const plain = v => v && typeof v === 'object'
  ? (v.$ === 'Con' || v.$ === 'Nil' ? array(v).map(plain) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])))
  : v;
const surface = { $: 'Plane', origin: null, normal: null, x: null };
const bendFaces = faces => list(faces.map(loops => ({ $: 'Face', surface, same_sense: true,
  loops: list(loops.map(uses => ({ $: 'Loop', outer: true, uses: list(uses.map(([edge, forward]) => ({ $: 'Use', edge, forward }))) }))) })));
const edgeValue = ([start, end], k) => ({ $: 'Edge', start, end, curve: { $: 'Line', origin: { $: 'V3', x: k, y: 0, z: 0 }, direction: { $: 'V3', x: 1, y: 0, z: 0 } }, same_sense: k % 2 === 0 });
const vertexValue = k => ({ $: 'V3', x: k, y: 2 * k, z: -k });

// Oracles: the former list definitions, restated.
function jacobi(fuel, faces, mask) {
  if (fuel === 0) return mask;
  let m = mask.slice(0, Math.min(faces.length, mask.length));
  const fs = faces.slice(0, m.length);
  for (let r = 0; r < fuel; r++) {
    const known = new Set(fs.flatMap((f, i) => m[i] ? f.flat().map(u => u[0]) : []));
    m = fs.map((f, i) => m[i] || f.flat().some(u => known.has(u[0])));
  }
  return m;
}
const countFaces = (faces, id) => faces.flat(2).reduce(([f, b], [e, forward]) => e === id ? (forward ? [f + 1, b] : [f, b + 1]) : [f, b], [0, 0]);
const ids = (index, n) => Array.from({ length: n }, (_, k) => (index + k) >>> 0);
const oracle = {
  edgesClosed: (n, faces, index) => ids(index, n).every(id => { const [f, b] = countFaces(faces, id); return f === 1 && b === 1; }),
  openUses: (n, faces, index) => ids(index, n).flatMap(id => { const [f, b] = countFaces(faces, id); return f + b === 1 ? [{ $: 'Use', edge: id, forward: b === 1 }] : []; }),
  used: (edges, id) => edges.some(([a, b]) => a === id || b === id),
  compact(vertices, edges, before, after) {
    const kept = [], map = [];
    ids(before, vertices.length).forEach((id, k) => { if (this.used(edges, id)) { kept.push(vertexValue(vertices[k])); map.push({ $: 'VertexMap', before: id, after: (after + map.length) >>> 0 }); } });
    return { $: 'Compact', vertices: kept, map };
  },
  mapped: (map, id) => map.find(([b]) => b === id)?.[1] ?? NONE,
  closed(n, faces, index) {
    for (const id of ids(index, n)) { const [f, b] = countFaces(faces, id); if (f !== 1 || b !== 1) return { $: 'Some', value: { $: 'SourceNotClosed', edge: id, forward: f, backward: b } }; }
    return { $: 'None' };
  },
  pack(edges, domains, origins, faces, before, after) {
    const out = { $: 'EdgePack', edges: [], domains: [], origins: [], map: [] };
    const n = Math.min(edges.length, domains.length, origins.length);
    ids(before, n).forEach((id, k) => {
      const [f, b] = countFaces(faces, id);
      if (f + b === 0) return;
      out.edges.push(plain(edgeValue(edges[k], k))); out.domains.push(domains[k]); out.origins.push(origins[k]);
      out.map.push({ $: 'VertexMap', before: id, after: (after + out.map.length) >>> 0 });
    });
    return out;
  },
};

function randomCase(r) {
  const nf = Math.floor(r() * 18), range = Math.max(1, Math.floor(r() * nf * 2.5)), sparse = r() < 0.05;
  const faces = Array.from({ length: nf }, () => Array.from({ length: Math.floor(r() * 3) }, () =>
    Array.from({ length: Math.floor(r() * 5) }, () => [sparse && r() < 0.3 ? 100000 + Math.floor(r() * 1e9) : Math.floor(r() * range), r() < 0.5])));
  const ml = r() < 0.8 ? nf : Math.floor(r() * (nf + 3));
  const mask = Array.from({ length: ml }, () => r() < 0.15);
  if (r() < 0.5 && ml) mask[0] = true;
  const index = r() < 0.1 ? NONE - Math.floor(r() * 5) : (r() < 0.2 ? Math.floor(r() * 4) : 0);
  const nv = Math.floor(r() * 14), vrange = Math.max(1, nv + Math.floor(r() * 4));
  const vid = () => sparse && r() < 0.2 ? NONE - Math.floor(r() * 8) : (index > 4294967000 && r() < 0.5 ? (index + Math.floor(r() * vrange)) >>> 0 : Math.floor(r() * vrange));
  return { faces, mask, fuel: Math.floor(r() * (nf + 3)), index,
    edges: Array.from({ length: Math.floor(r() * (range + 3)) }, () => [vid(), vid()]),
    vertices: Array.from({ length: nv }, (_, k) => k),
    map: Array.from({ length: Math.floor(r() * (vrange + 2)) }, () => [sparse && r() < 0.3 ? 5000000 + Math.floor(r() * 1e9) : Math.floor(r() * vrange), Math.floor(r() * 50)]),
    after: Math.floor(r() * 3) };
}
const box = [[[[0, true], [1, true], [2, true], [3, true]]], [[[3, false], [4, true], [5, true], [6, true]]], [[[2, false], [7, true], [8, true], [4, false]]],
  [[[1, false], [9, true], [10, true], [7, false]]], [[[0, false], [6, false], [11, true], [9, false]]], [[[5, false], [8, false], [10, false], [11, false]]]];
const cases = [
  { faces: box, mask: box.map((_, i) => i === 0), fuel: 6, index: 0, edges: Array.from({ length: 12 }, (_, k) => [k % 8, (k + 1) % 8]), vertices: [0, 1, 2, 3, 4, 5, 6, 7, 8], map: [[2, 7], [2, 9], [5, 1]], after: 0 },
  { faces: [...box, ...box.map(f => f.map(l => l.map(([e, d]) => [e + 12, d])))], mask: Array.from({ length: 12 }, (_, i) => i === 0), fuel: 12, index: 0, edges: [], vertices: [], map: [], after: 0 },
  { faces: [[[[4000000000, true]]], [[[4000000000, false], [1, true]]], [[[1, false]]]], mask: [true, false, false], fuel: 3, index: 0, edges: [[4000000000, 1]], vertices: [0, 1], map: [[4000000000, 1]], after: 0 },
  ...Array.from({ length: 300 }, (_, i) => randomCase(rng(i + 1))),
  ...Array.from({ length: 60 }, (_, i) => treeCase(rng(1000 + i))),
];

// Faces joined in a random spanning tree through shared edge ids (connected by
// construction), sometimes with one face cut loose; seeds anywhere.
function treeCase(r) {
  const nf = 2 + Math.floor(r() * 16);
  const faces = Array.from({ length: nf }, () => [[]]);
  let next = 0;
  for (let i = 1; i < nf; i++) {
    const id = next++, parent = Math.floor(r() * i);
    faces[parent][0].push([id, true]);
    faces[i][0].push([id, false]);
  }
  for (const f of faces) for (let k = Math.floor(r() * 3); k > 0; k--) f[0].push([next++, r() < 0.5]);
  if (r() < 0.3) faces[Math.floor(r() * nf)] = [[[next + 5, true]]];
  for (const f of faces) f[0].sort(() => r() - 0.5);
  const mask = faces.map(() => r() < 0.1);
  mask[Math.floor(r() * nf)] = true;
  return { faces, mask, fuel: Math.floor(r() * (nf + 2)), index: 0, edges: [], vertices: [], map: [], after: 0 };
}

// The same faces with every edge id renamed by an injective map to ids far
// beyond the use count (the sparse path): an offset, a stride, or scattered
// ids up to 2^32 - 1. Connectivity only depends on id equality.
function renamed(faces, r, kind) {
  const uses = faces.flat(2).length, fresh = new Map(), taken = new Set();
  const scatter = () => { for (;;) { const id = r() < 0.2 ? NONE - Math.floor(r() * 64) : 4 * uses + 1024 + Math.floor(r() * (NONE - 4 * uses - 1024)); if (!taken.has(id)) { taken.add(id); return id; } } };
  const name = e => {
    if (!fresh.has(e)) fresh.set(e, kind === 0 ? e + 8 * uses + 1024 : kind === 1 ? (1000003 + e * 7919) >>> 0 : scatter());
    return fresh.get(e);
  };
  return faces.map(f => f.map(l => l.map(([e, d]) => [name(e), d])));
}

test('connectivity BFS equals the Jacobi fold, on dense and on sparse edge ids', () => {
  let reachedAll = 0, sparse = 0;
  cases.forEach((c, i) => {
    const faces = bendFaces(c.faces), mask = list(c.mask);
    const want = jacobi(c.fuel, c.faces, c.mask);
    assert.deepEqual(array(hs.connectivity_steps(BigInt(c.fuel), faces, mask)), want, `case ${i}`);
    const connected = jacobi(c.faces.length, c.faces, c.faces.map((_, i) => i === 0)).every(Boolean);
    assert.equal(hs.connected(faces), connected, `case ${i}`);
    if (connected && c.faces.length > 1) reachedAll++;
    const moved = renamed(c.faces, rng(5000 + i), i % 3), top = Math.max(0, ...moved.flat(2).map(([e]) => e));
    if (top >= 4 * moved.flat(2).length + 1024) sparse++;
    assert.deepEqual(jacobi(c.fuel, moved, c.mask), want, `oracle, case ${i}`);
    assert.deepEqual(array(hs.connectivity_steps(BigInt(c.fuel), bendFaces(moved), mask)), want, `sparse case ${i}`);
    assert.equal(hs.connected(bendFaces(moved)), connected, `sparse case ${i}`);
  });
  assert.ok(reachedAll > 10, 'enough connected cases');
  assert.ok(sparse > 300, 'the renamed cases take the sparse path');
});

// Regression (collections-adopt fix-1): sparse edge ids used to fall back to
// the former Jacobi fold, O(fuel * faces * uses): a 400-face chain took 15.7 s
// against 16 ms with dense ids. It happens in practice: ports/curved.bend,
// occt.bend and curved-contact.bend split components and call
// connectivity_steps again on the faces left, which keep global edge ids.
test('sparse edge ids stay near-linear: a component split on a long chain', () => {
  const n = 1500, chain = (from, count) => Array.from({ length: count }, (_, k) => [[[from + k, true], [from + k + 1, false]]]);
  const first = chain(0, n), second = chain(n + 1, n);
  const all = [...first, ...second];
  const t0 = performance.now();
  const mask = array(hs.connectivity_steps(BigInt(all.length), bendFaces(all), list(all.map((_, i) => i === 0))));
  assert.deepEqual(mask, all.map((_, i) => i < n));
  // What components() does next: the faces left, global ids, dense test fails.
  const shifted = second.map(f => f.map(l => l.map(([e, d]) => [e + 4 * 2 * n + 1024, d])));
  assert.ok(Math.max(...shifted.flat(2).map(([e]) => e)) >= 4 * shifted.flat(2).length + 1024, 'sparse path');
  const left = bendFaces(shifted);
  assert.equal(hs.connected(left), true);
  const fuel = 7;
  assert.deepEqual(array(hs.connectivity_steps(BigInt(fuel), left, list(second.map((_, i) => i === 0)))), second.map((_, i) => i <= fuel));
  const ms = performance.now() - t0;
  assert.ok(ms < 20000, `took ${ms.toFixed(0)} ms; the cubic fallback needs minutes here`);
});

test('one-pass edge use counts: edges_closed, open_uses, section.closed_edges, occt.edge_pack', () => {
  cases.forEach((c, i) => {
    const faces = bendFaces(c.faces), edges = list(c.edges.map(edgeValue));
    assert.equal(hs['solid-classification.edges_closed'](edges, faces, c.index), oracle.edgesClosed(c.edges.length, c.faces, c.index), `case ${i}`);
    assert.deepEqual(plain(hs.open_uses(edges, faces, c.index)), oracle.openUses(c.edges.length, c.faces, c.index), `case ${i}`);
    assert.deepEqual(plain(section.closed_edges(edges, faces, c.index)), oracle.closed(c.edges.length, c.faces, c.index), `case ${i}`);
    const domains = c.edges.map((_, k) => ({ $: 'D', k })), origins = c.edges.slice(0, Math.max(0, c.edges.length - (i % 2))).map((_, k) => ({ $: 'O', k }));
    assert.deepEqual(plain(occt.edge_pack(edges, list(domains), list(origins), faces, c.index, c.after)),
      oracle.pack(c.edges, domains, origins, c.faces, c.index, c.after), `case ${i}`);
  });
});

test('used-vertex flags and the vertex remap table: all_used, compact, remap_edges', () => {
  cases.forEach((c, i) => {
    const edges = list(c.edges.map(edgeValue)), vertices = list(c.vertices.map(vertexValue));
    assert.equal(hs.all_used(vertices, edges, c.index), ids(c.index, c.vertices.length).every(id => oracle.used(c.edges, id)), `case ${i}`);
    assert.deepEqual(plain(hs.compact(vertices, edges, c.index, c.after)), oracle.compact(c.vertices, c.edges, c.index, c.after), `case ${i}`);
    const map = list(c.map.map(([before, after]) => ({ $: 'VertexMap', before, after })));
    assert.deepEqual(plain(hs.remap_edges(edges, map)), c.edges.map(([a, b], k) => ({ ...plain(edgeValue([oracle.mapped(c.map, a), oracle.mapped(c.map, b)], k)) })), `case ${i}`);
  });
});

}
