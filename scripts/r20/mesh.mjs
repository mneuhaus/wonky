// Mesh measures for the R20 acceptance gate (scripts/r20/acceptance.mjs):
// STL reading, volume / area / bounds, a watertightness and component check,
// a sampled symmetric Hausdorff distance, and a reader for the r20 check
// export that mirrors cad-31's checks/meshes.py (load_manifest, load_parts,
// validate_mesh). Test tooling only: nothing here constructs geometry.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// --- STL ----------------------------------------------------------------------

// Returns [{ name, triangles: [[a, b, c], ...] }]. A binary STL is one solid;
// an ASCII STL may hold several `solid ... endsolid` blocks (the print export
// writes one per body).
export function readStl(file) {
  const buf = fs.readFileSync(file);
  const head = buf.subarray(0, Math.min(buf.length, 512)).toString('latin1');
  const count = buf.length >= 84 ? buf.readUInt32LE(80) : -1;
  const binary = count >= 0 && buf.length === 84 + 50 * count;
  if (!binary && /^\s*solid\b/.test(head)) return readAsciiStl(buf.toString('latin1'));
  if (!binary) throw new Error(`${file}: neither a binary STL of consistent size nor an ASCII STL`);
  const triangles = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = 84 + 50 * i + 12, tri = [];
    for (let k = 0; k < 3; k++) tri.push([0, 1, 2].map(j => buf.readFloatLE(o + 12 * k + 4 * j)));
    triangles[i] = tri;
  }
  return [{ name: path.basename(file, path.extname(file)), triangles }];
}

function readAsciiStl(text) {
  const solids = [];
  let current = null, vertices = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('solid')) { current = { name: line.slice(5).trim(), triangles: [] }; solids.push(current); }
    else if (line.startsWith('vertex')) {
      vertices.push(line.split(/\s+/).slice(1, 4).map(Number));
      if (vertices.length === 3) { current.triangles.push(vertices); vertices = []; }
    }
  }
  return solids;
}

export const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// --- float32 storage -------------------------------------------------------------

// Half the float32 spacing at a stored value x: storing a real r as float32
// (round to nearest) gives x only if |r - x| <= this. Read from x's exponent
// bits: for x in [2^k, 2^(k+1)) the spacing is 2^(k-23); at x = 2^k the
// spacing above is the larger one; subnormals have spacing 2^-149.
const f32Cell = new Float32Array(1), u32Cell = new Uint32Array(f32Cell.buffer);
export function float32HalfSpacing(x) {
  f32Cell[0] = x;
  const biased = (u32Cell[0] >>> 23) & 0xff;
  return biased === 0 ? 2 ** -150 : 2 ** (biased - 127 - 24);
}

// Bound on the storage rounding of a float32 STL, read from its own
// coordinates: every stored vertex lies within this of the point that was
// stored (largest hypot of the three half spacings). The factor 1 + 2^-20
// covers the hypot's rounding and a binary64 unit conversion before storage
// (<= 2^-53 |x|, i.e. <= 2^-28 of a half spacing). Rigid transforms keep it.
export function float32StorageBoundMm(triangles) {
  let worst = 0;
  for (const t of triangles) for (const p of t) {
    const d = Math.hypot(float32HalfSpacing(p[0]), float32HalfSpacing(p[1]), float32HalfSpacing(p[2]));
    if (d > worst) worst = d;
  }
  return worst * (1 + 2 ** -20);
}

// --- measures -------------------------------------------------------------------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function measure(triangles) {
  let volume = 0, area = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let finite = true;
  for (const [a, b, c] of triangles) {
    volume += dot(a, cross(b, c)) / 6;
    area += Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
    for (const p of [a, b, c]) for (let i = 0; i < 3; i++) {
      if (!Number.isFinite(p[i])) finite = false;
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }
  return { triangles: triangles.length, volumeMm3: volume, areaMm2: area, bbox: [min, max], finite, ...topology(triangles) };
}

// Welds bitwise-equal coordinates (what trimesh's process=True merge does for
// exported meshes) and checks that every undirected edge is used exactly twice,
// once in each direction; counts edge-connected components.
export function topology(triangles) {
  const ids = new Map(), key = p => `${p[0]},${p[1]},${p[2]}`;
  const vid = p => { const k = key(p); let id = ids.get(k); if (id === undefined) { id = ids.size; ids.set(k, id); } return id; };
  const faces = triangles.map(t => t.map(vid));
  const edges = new Map();
  let degenerate = 0;
  faces.forEach(([a, b, c], f) => {
    if (a === b || b === c || a === c) { degenerate++; return; }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = u < v ? `${u}:${v}` : `${v}:${u}`;
      const e = edges.get(k) ?? { forward: 0, backward: 0, faces: [] };
      if (u < v) e.forward++; else e.backward++;
      e.faces.push(f);
      edges.set(k, e);
    }
  });
  let boundary = 0, nonManifold = 0, misoriented = 0;
  const parent = faces.map((_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (const e of edges.values()) {
    const uses = e.forward + e.backward;
    if (uses === 1) boundary++;
    else if (uses > 2) nonManifold++;
    else if (e.forward !== 1) misoriented++;
    for (const f of e.faces.slice(1)) parent[find(f)] = find(e.faces[0]);
  }
  const roots = new Set(faces.map((_, i) => find(i)));
  return { vertices: ids.size, degenerate, boundaryEdges: boundary, nonManifoldEdges: nonManifold, misorientedEdges: misoriented,
    watertight: boundary === 0 && nonManifold === 0 && misoriented === 0, components: roots.size };
}

// --- Hausdorff --------------------------------------------------------------------

// Closest point on triangle (Ericson, Real-Time Collision Detection 5.1.5).
function closestOnTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)), bc = sub(c, b);
    return [b[0] + w * bc[0], b[1] + w * bc[1], b[2] + w * bc[2]];
  }
  const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

function buildBvh(triangles) {
  const items = triangles.map((t, i) => {
    const lo = [0, 1, 2].map(k => Math.min(t[0][k], t[1][k], t[2][k])), hi = [0, 1, 2].map(k => Math.max(t[0][k], t[1][k], t[2][k]));
    return { i, lo, hi, c: [0, 1, 2].map(k => (lo[k] + hi[k]) / 2) };
  });
  const build = list => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const x of list) for (let k = 0; k < 3; k++) { if (x.lo[k] < lo[k]) lo[k] = x.lo[k]; if (x.hi[k] > hi[k]) hi[k] = x.hi[k]; }
    if (list.length <= 4) return { lo, hi, leaf: list.map(x => x.i) };
    const axis = [0, 1, 2].reduce((best, k) => (hi[k] - lo[k] > hi[best] - lo[best] ? k : best), 0);
    list.sort((x, y) => x.c[axis] - y.c[axis]);
    const mid = list.length >> 1;
    return { lo, hi, left: build(list.slice(0, mid)), right: build(list.slice(mid)) };
  };
  return build(items);
}

const boxDistance2 = (p, node) => {
  let d = 0;
  for (let k = 0; k < 3; k++) { const v = p[k] < node.lo[k] ? node.lo[k] - p[k] : p[k] > node.hi[k] ? p[k] - node.hi[k] : 0; d += v * v; }
  return d;
};

function nearestDistance(p, bvh, triangles) {
  let best = Infinity;
  const stack = [bvh];
  while (stack.length) {
    const node = stack.pop();
    if (boxDistance2(p, node) >= best) continue;
    if (node.leaf) {
      for (const i of node.leaf) { const [a, b, c] = triangles[i], q = closestOnTriangle(p, a, b, c), d = sub(p, q), d2 = dot(d, d); if (d2 < best) best = d2; }
    } else {
      const dl = boxDistance2(p, node.left), dr = boxDistance2(p, node.right);
      if (dl < dr) { stack.push(node.right, node.left); } else { stack.push(node.left, node.right); }
    }
  }
  return Math.sqrt(best);
}

// Deterministic samples: every vertex, every edge midpoint, and `extra`
// area-weighted points (mulberry32, fixed seed).
function samples(triangles, extra) {
  let seed = 0x5eed1234;
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [], seen = new Set();
  const areas = triangles.map(([a, b, c]) => Math.hypot(...cross(sub(b, a), sub(c, a))) / 2);
  const total = areas.reduce((s, x) => s + x, 0);
  for (const [a, b, c] of triangles) {
    for (const p of [a, b, c]) { const k = p.join(','); if (!seen.has(k)) { seen.add(k); out.push(p); } }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) out.push([(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2]);
  }
  const cumulative = []; let acc = 0; for (const x of areas) cumulative.push(acc += x);
  for (let n = 0; n < extra && total > 0; n++) {
    const r = rand() * total; let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < r) lo = mid + 1; else hi = mid; }
    let u = rand(), v = rand(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const [a, b, c] = triangles[lo];
    out.push([0, 1, 2].map(k => a[k] + u * (b[k] - a[k]) + v * (c[k] - a[k])));
  }
  return out;
}

// Sampled symmetric Hausdorff distance (a lower bound of the true one; the
// samples include every vertex and edge midpoint of both meshes).
export function hausdorff(meshA, meshB, { extra = 20000 } = {}) {
  const one = (from, to) => {
    const bvh = buildBvh(to);
    let max = 0, sum = 0, arg = null;
    const pts = samples(from, extra);
    for (const p of pts) { const d = nearestDistance(p, bvh, to); sum += d; if (d > max) { max = d; arg = p; } }
    return { max, mean: sum / pts.length, at: arg, samples: pts.length };
  };
  const ab = one(meshA, meshB), ba = one(meshB, meshA);
  return { hausdorffMm: Math.max(ab.max, ba.max), oursToRef: ab, refToOurs: ba };
}

// --- r20 check export reader (mirrors checks/meshes.py) -----------------------------

export const R20_MANIFEST_SCHEMA = 'r20/tessellate-manifest/v1';
export const sanitizeKey = token => token.replace(/[^A-Za-z0-9._-]/g, '_');
export const partKey = name => sanitizeKey((name ?? '').trim().split(/\s+/)[0] ?? '');

// Reads <dir>/<manifestName> and every <key>.stl it lists. Fail closed like
// load_manifest / load_parts / validate_mesh, plus the export contract of the
// gate: schema, key rule (first NAME token, sanitised, unique case-insensitively,
// not the part id), SHA-256, one watertight body per part, triangle count.
// With { wonky: true } also wonky's side of the contract (src/r20-export.mjs):
// part_studio 'wonky:<source>#<feature>', a sha256 fingerprint, and per part a
// 'wonky' row whose exactness claim is consistent, whose mesh deviation holds
// the requested one and whose stated deviation includes the float32 storage
// rounding it states (the two-number contract of src/r20-export.mjs).
export function readR20Export(dir, { manifestName = 'tessellate-manifest.json', wonky = false } = {}) {
  const manifestPath = path.join(dir, manifestName);
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest missing: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const problems = [];
  if (manifest.schema !== R20_MANIFEST_SCHEMA) problems.push(`schema is ${JSON.stringify(manifest.schema)}, expected ${R20_MANIFEST_SCHEMA}`);
  for (const field of ['part_studio', 'fingerprint']) if (typeof manifest[field] !== 'string' || !manifest[field]) problems.push(`manifest.${field} missing`);
  if (!manifest.parts || typeof manifest.parts !== 'object' || Array.isArray(manifest.parts)) throw new Error(`${manifestPath}: manifest needs a 'parts' object`);
  const seen = new Set(), parts = {};
  for (const [key, row] of Object.entries(manifest.parts)) {
    const where = `part ${key}`;
    if (seen.has(key.toLowerCase())) problems.push(`${where}: duplicate key (case-insensitive)`);
    seen.add(key.toLowerCase());
    for (const field of ['name', 'part_id', 'triangles', 'sha256', 'description']) if (!(field in row)) problems.push(`${where}: row lacks '${field}'`);
    if (partKey(row.name) !== key) problems.push(`${where}: key is not the sanitised first token of NAME ${JSON.stringify(row.name)}`);
    if (row.part_id !== undefined && sanitizeKey(String(row.part_id)) === key) problems.push(`${where}: key equals the part id`);
    const file = path.join(dir, row.file ?? `${key}.stl`);
    if (!fs.existsSync(file)) { problems.push(`${where}: mesh file missing (${file})`); continue; }
    const digest = sha256File(file);
    if (row.sha256 !== digest) problems.push(`${where}: SHA-256 ${digest.slice(0, 12)} differs from manifest ${String(row.sha256).slice(0, 12)}`);
    const buf = fs.readFileSync(file);
    if (!(buf.length >= 84 && buf.length === 84 + 50 * buf.readUInt32LE(80))) problems.push(`${where}: not a binary STL`);
    const solids = readStl(file), triangles = solids.flatMap(s => s.triangles), m = measure(triangles);
    if (!triangles.length) problems.push(`${where}: mesh has no faces`);
    if (!m.finite) problems.push(`${where}: non-finite vertices`);
    if (row.triangles !== triangles.length) problems.push(`${where}: manifest says ${row.triangles} triangles, file has ${triangles.length}`);
    if (!m.watertight) problems.push(`${where}: not watertight (boundary ${m.boundaryEdges}, non-manifold ${m.nonManifoldEdges}, misoriented ${m.misorientedEdges})`);
    if (m.components !== 1) problems.push(`${where}: ${m.components} bodies, expected 1`);
    if (!(m.volumeMm3 > 0)) problems.push(`${where}: volume ${m.volumeMm3} is not positive (inside-out?)`);
    if (wonky) problems.push(...wonkyRowProblems(where, row.wonky));
    parts[key] = { key, name: row.name, file, triangles, measure: m, row };
  }
  if (wonky) {
    if (!/^wonky:.+#.+$/.test(String(manifest.part_studio))) problems.push(`manifest.part_studio ${JSON.stringify(manifest.part_studio)} is not wonky:<source>#<feature>`);
    if (!/^[0-9a-f]{64}$/.test(String(manifest.fingerprint))) problems.push('manifest.fingerprint is not a sha256 hex digest');
  }
  return { manifest, parts, problems, ok: problems.length === 0 };
}

function wonkyRowProblems(where, w) {
  if (!w || typeof w !== 'object') return [`${where}: row lacks 'wonky'`];
  const out = [];
  for (const field of ['volumeMm3', 'exact', 'approximation', 'deviationMm', 'achievedDeviationMm']) if (!(field in w)) out.push(`${where}: wonky row lacks '${field}'`);
  if (w.volumeMm3 !== null && !(Number.isFinite(w.volumeMm3) && w.volumeMm3 > 0)) out.push(`${where}: wonky.volumeMm3 ${w.volumeMm3} is neither null nor a positive volume`);
  if (typeof w.exact !== 'boolean') out.push(`${where}: wonky.exact is not a boolean`);
  if (w.exact && (w.approximation !== null || w.volumeMm3 === null)) out.push(`${where}: claims exact with an approximation label or without a volume`);
  if (!(w.deviationMm > 0)) out.push(`${where}: wonky.deviationMm ${w.deviationMm} is not positive`);
  // The statement is about the stored file: achievedDeviationMm = meshDeviationMm
  // (the mesh before float32 storage, which the request bounds) +
  // float32RoundingMm (the measured storage rounding), rounded up. A row from
  // before that contract has only achievedDeviationMm, the mesh's deviation.
  const twoNumbers = 'meshDeviationMm' in w || 'float32RoundingMm' in w;
  if (twoNumbers && !('meshDeviationMm' in w && 'float32RoundingMm' in w)) out.push(`${where}: wonky row states only one of meshDeviationMm and float32RoundingMm`);
  const meshDev = w.meshDeviationMm ?? w.achievedDeviationMm;
  if (!(meshDev >= 0 && meshDev <= w.deviationMm)) out.push(`${where}: mesh deviation ${meshDev} does not hold the requested ${w.deviationMm}`);
  if ('float32RoundingMm' in w) {
    if (!(w.float32RoundingMm >= 0 && Number.isFinite(w.float32RoundingMm))) out.push(`${where}: wonky.float32RoundingMm ${w.float32RoundingMm} is not a measured rounding`);
    else if (!(w.achievedDeviationMm >= meshDev + w.float32RoundingMm))
      out.push(`${where}: stated deviation ${w.achievedDeviationMm} is below mesh ${meshDev} + float32 storage ${w.float32RoundingMm}`);
  }
  return out;
}
