#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE: oracle arbitration (plan step 3,
// docs/hybrid-boolean-plan.md section 8; docs/bakeoff.md "Oracle
// arbitration").
//
// The harness has two oracles: OCCT's exact CSG of the analytic input and
// manifold3d on the same tessellated leaves. Both are wrong on some
// adversarial cases (OCCT's fuzzy merge closes a 1e-9 mm gap and loses
// sub-micron slabs; manifold3d's symbolic perturbation splits rotated
// touching faces and re-entered operands). A case *disputes* when they give a
// different shell count, or volumes further apart than OCCT area x deviation.
//
// For every disputed case this module computes a third reference with an
// independent method (closed form, quadrature of a closed-form cross
// section, a set identity, or a result mesh constructed from the wire leaves
// and checked by the exact validator), then *derives* which oracle it
// confirms. The policy: the reference is the exact CSG of the analytic input,
// unless the F32x2 rounding of the input itself can change the topology; such
// a case is `ambiguous` with the measured rounding displacement as the reason,
// and either oracle's topology is admissible.
//
// fixtures/bakeoff/arbiter.json stores one entry per disputed case, keyed by
// case id and the job hash it was computed for. run.mjs and judge.mjs score
// with it (run.mjs compare / verdictOf); judge.mjs reports the disputes that
// have no entry ("unarbitrated").
//
//   node scripts/bakeoff/arbiter.mjs [--suites out/bakeoff/judge2/suites] [--write | --check]
//
// --write regenerates the entries (needs the suites' reference.json for the
// oracle values); --check recomputes every committed entry from the fixture
// files alone and fails on any difference, and, where suite references exist,
// on a dispute without an entry. It computes no production geometry.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, buildCase, loadCases } from './fixtures.mjs';
import { decodeJob, encodeJob } from './jobfmt.mjs';
import { orient3d, pointInTri2, project, projectionAxis } from './predicates.mjs';
import { validateMesh } from './validate.mjs';

export const ARBITER_PATH = path.join(ROOT, 'fixtures/bakeoff/arbiter.json');
export const ADVERSARIAL_SUITES = ['adv-corefine', 'adv-exact-plane', 'adv-sdf', 'adv-recover'];
// Same thresholds as run.mjs (not imported: run.mjs imports this module).
const VOLUME_AGREE = 1e-4;
const COINCIDENT_MM = 1e-9;

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ---------------------------------------------------------------------------
// Case sets and disputes

const fixtureOf = (suite) => path.join(ROOT, `fixtures/bakeoff/adversarial-${suite.slice('adv-'.length)}.json`);
const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

// [{suite, cases, reference|null}] for the corpus and the four adversarial
// fixture files; references of the suites come from <suitesRoot>/<suite>/.
export function caseSets(suitesRoot = path.join(ROOT, 'out/bakeoff/judge2/suites')) {
  const sets = [{ suite: 'corpus', cases: loadCases(), reference: readJson(path.join(ROOT, 'fixtures/bakeoff/reference.json')) }];
  for (const s of ADVERSARIAL_SUITES) {
    sets.push({ suite: s, cases: JSON.parse(fs.readFileSync(fixtureOf(s), 'utf8')).cases, reference: readJson(path.join(suitesRoot, s, 'reference.json')) });
  }
  return sets;
}

const eulerOfGenus = (g) => (typeof g === 'number' ? 2 - 2 * g : null);

// The two oracles' answers for one reference entry, as recorded evidence.
export function oracleSummary(ref) {
  const o = ref?.occt && !ref.occt.error ? ref.occt : null;
  const m = ref?.manifold && !ref.manifold.error ? ref.manifold : null;
  return {
    occt: o ? { shells: o.shells ?? o.solids, solids: o.solids, volume: o.volume, area: o.area, valid: o.valid } : null,
    manifold: m ? { components: m.components, euler: eulerOfGenus(m.genus), volume: m.volume, area: m.area } : null,
  };
}

// null when the oracles agree (or one of them failed: nothing to arbitrate);
// otherwise the list of disagreements.
export function oracleDispute(ref) {
  const { occt: o, manifold: m } = oracleSummary(ref);
  if (!o || !m) return null;
  const why = [];
  if (o.shells !== m.components) why.push(`shells: OCCT ${o.shells}, manifold3d ${m.components}`);
  const bound = o.area * ref.deviationMm;
  const dv = Math.abs(m.volume - o.volume);
  if (dv > bound) why.push(`volume: OCCT ${o.volume}, manifold3d ${m.volume} (|difference| ${dv.toExponential(2)} > OCCT area x deviation ${bound.toExponential(2)})`);
  return why.length ? why : null;
}

// Every dispute over the given case sets (sets without a reference are
// skipped and reported as such by the caller).
export function findDisputes(sets) {
  const out = [];
  for (const { suite, cases, reference } of sets) {
    if (!reference) continue;
    for (const c of cases) {
      const ref = reference.cases?.[c.id];
      const why = oracleDispute(ref);
      if (why) out.push({ suite, id: c.id, expect: c.expect ?? 'solid', case: c, jobSha256: ref.jobSha256, dispute: why, oracles: oracleSummary(ref) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Exact point classification against a closed wire mesh (ray parity with the
// exact orient3d of predicates.mjs; a ray through an edge or a vertex is
// retried in another direction).

const RAYS = [[0.5773502691896258, 0.4082482904638631, 0.7071067811865476], [-0.3141592653589793, 0.8660254037844386, 0.2718281828459045], [0.6931471805599453, -0.5772156649015329, 0.4142135623730951], [-0.7320508075688772, -0.2360679774997897, -0.6180339887498949]];

export function pointInMesh(p, mesh) {
  const { vertices: V, triangles: T } = mesh;
  let far = 1;
  for (const v of V) for (let k = 0; k < 3; k++) far = Math.max(far, Math.abs(v[k] - p[k]));
  for (const d of RAYS) {
    const q = [p[0] + 4 * far * d[0], p[1] + 4 * far * d[1], p[2] + 4 * far * d[2]];
    let crossings = 0, degenerate = false;
    for (const [ia, ib, ic] of T) {
      const a = V[ia], b = V[ib], c = V[ic];
      const op = orient3d(a, b, c, p);
      if (op === 0) {
        const k = projectionAxis(a, b, c);
        if (k >= 0 && pointInTri2(project(p, k), project(a, k), project(b, k), project(c, k))) return 'on';
        continue;
      }
      const oq = orient3d(a, b, c, q);
      if (oq === 0) { degenerate = true; break; }
      if (op === oq) continue;
      const s1 = orient3d(p, q, a, b), s2 = orient3d(p, q, b, c), s3 = orient3d(p, q, c, a);
      if (s1 === 0 || s2 === 0 || s3 === 0) {
        if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) { degenerate = true; break; }
        continue;
      }
      if (s1 === s2 && s2 === s3) crossings++;
    }
    if (!degenerate) return crossings % 2 ? 'in' : 'out';
  }
  throw new Error('pointInMesh: every ray direction was degenerate');
}

// Planar faces of leaf X that coincide with a planar face of leaf Y within
// COINCIDENT_MM (parallel or anti-parallel carriers): per pair, how the
// vertices of X's face lie against the whole mesh of Y (exact) and their
// largest distance from Y's carrier plane. This measures what the F32x2
// rounding of a rotation did to faces that coincide analytically.
export function coincidentFaceProbe(job, leafX, leafY) {
  const mx = job.meshes.find((m) => m.leaf === leafX), my = job.meshes.find((m) => m.leaf === leafY);
  const out = [];
  job.faces.forEach((fx, tx) => {
    if (fx.leaf !== leafX || fx.surface.type !== 'plane') return;
    job.faces.forEach((fy, ty) => {
      if (fy.leaf !== leafY || fy.surface.type !== 'plane') return;
      const nx = fx.surface.n, ny = fy.surface.n;
      if (Math.abs(Math.abs(dot(nx, ny)) - 1) > 1e-12) return;
      if (Math.abs(dot(sub(fx.surface.o, fy.surface.o), ny)) > COINCIDENT_MM) return;
      const verts = [...new Set(mx.triangles.filter((t) => t[3] === tx).flatMap((t) => t.slice(0, 3)))].sort((a, b) => a - b);
      const cls = { in: 0, on: 0, out: 0 };
      let maxAbs = 0;
      for (const v of verts) {
        cls[pointInMesh(mx.vertices[v], my)]++;
        maxAbs = Math.max(maxAbs, Math.abs(dot(sub(mx.vertices[v], fy.surface.o), ny)));
      }
      out.push({ faces: [tx, ty], orientation: dot(nx, ny) > 0 ? 'same' : 'opposite', vertices: verts.length, inside: cls.in, on: cls.on, outside: cls.out, maxDistanceFromCarrierMm: maxAbs });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Closed forms

// Area of the circular segment of a disk of radius r beyond a chord at
// distance d from the centre (0 <= d <= r).
export function circularSegmentArea(r, d) {
  return r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
}

// Gauss-Legendre nodes and weights on [-1, 1] (Newton on P_n).
function legendre(n) {
  const x = [], w = [];
  for (let i = 1; i <= n; i++) {
    let z = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = z;
      for (let k = 2; k <= n; k++) [p0, p1] = [p1, ((2 * k - 1) * z * p1 - (k - 1) * p0) / k];
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x.push(z);
    w.push(2 / ((1 - z * z) * dp * dp));
  }
  return { x, w };
}
const GL16 = legendre(16);

// Composite 16-point Gauss-Legendre quadrature of a smooth integrand.
export function integrate(f, a, b, panels = 16) {
  let s = 0;
  const h = (b - a) / panels;
  for (let p = 0; p < panels; p++) {
    const m = a + (p + 0.5) * h;
    for (let i = 0; i < 16; i++) s += GL16.w[i] * f(m + (h / 2) * GL16.x[i]);
  }
  return (s * h) / 2;
}

const isIdentity = (m) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 0 && m[4] === 0 && m[5] === 1 && m[6] === 0 && m[7] === 0 && m[8] === 0 && m[9] === 0 && m[10] === 1 && m[11] === 0;
const sameRotation = (a, b) => [0, 1, 2, 4, 5, 6, 8, 9, 10].every((k) => a[k] === b[k]);
const need = (cond, what) => {
  if (!cond) throw new Error(`arbiter precondition failed: ${what}`);
};

const boxOf = (prim) => {
  need(prim.kind === 'box', `box leaf expected, got ${prim.kind}`);
  const [x0, y0, z0, x1, y1, z1] = prim.params;
  return { lo: [x0, y0, z0], hi: [x1, y1, z1] };
};
const boxVolume = (b) => (b.hi[0] - b.lo[0]) * (b.hi[1] - b.lo[1]) * (b.hi[2] - b.lo[2]);
const boxArea = (b) => {
  const [dx, dy, dz] = [0, 1, 2].map((k) => b.hi[k] - b.lo[k]);
  return 2 * (dx * dy + dy * dz + dz * dx);
};

// Regularized union / subtract of two axis-aligned boxes given in one frame,
// for the configurations the disputes need. Signs are exact: the bounds are
// doubles and every difference below is a difference of close doubles or a
// comparison.
export function boxesClosedForm(op, A, B) {
  const d = [0, 1, 2].map((k) => Math.min(A.hi[k], B.hi[k]) - Math.max(A.lo[k], B.lo[k]));
  const VA = boxVolume(A), VB = boxVolume(B);
  if (op === 'union') {
    if (d.some((x) => x < 0)) return { shells: 2, euler: 4, volume: VA + VB, area: boxArea(A) + boxArea(B), configuration: `disjoint boxes (gap ${Math.max(...d.map((x) => -x)).toExponential(3)} mm)` };
    if (d.every((x) => x > 0)) {
      const common = d[0] * d[1] * d[2];
      // The overlap box is a corner block: each of its faces lies on A or B.
      const overlapArea = 2 * (d[0] * d[1] + d[1] * d[2] + d[2] * d[0]);
      return { shells: 1, euler: 2, volume: VA + VB - common, area: boxArea(A) + boxArea(B) - overlapArea, configuration: `boxes overlapping by ${d.map((x) => x.toExponential(3)).join(' x ')} mm` };
    }
    const zero = d.filter((x) => x === 0).length;
    if (zero === 1) {
      const k = d.indexOf(0);
      const contact = d[(k + 1) % 3] * d[(k + 2) % 3];
      return { shells: 1, euler: 2, volume: VA + VB, area: boxArea(A) + boxArea(B) - 2 * contact, configuration: `face contact of ${contact} mm^2 (regularized union merges)` };
    }
    throw new Error('boxesClosedForm: edge or vertex contact is not a 2-manifold result');
  }
  if (op === 'subtract') {
    need(d.every((x) => x > 0), 'subtract of overlapping boxes');
    const inside = [0, 1, 2].every((k) => B.lo[k] >= A.lo[k] && B.hi[k] <= A.hi[k]);
    if (inside) {
      const touching = [0, 1, 2].flatMap((k) => [B.lo[k] === A.lo[k], B.hi[k] === A.hi[k]]).filter(Boolean).length;
      need(touching <= 1, 'pocket touching A on one face at most');
      const [bx, by, bz] = [0, 1, 2].map((k) => B.hi[k] - B.lo[k]);
      if (touching === 0) return { shells: 2, euler: 4, volume: VA - VB, area: boxArea(A) + boxArea(B), configuration: 'closed internal void' };
      const k = [0, 1, 2].find((i) => B.lo[i] === A.lo[i] || B.hi[i] === A.hi[i]);
      const mouth = [bx, by, bz][(k + 1) % 3] * [bx, by, bz][(k + 2) % 3];
      return { shells: 1, euler: 2, volume: VA - VB, area: boxArea(A) + boxArea(B) - 2 * mouth, configuration: `open pocket, flush with A on axis ${'xyz'[k]}` };
    }
    // B covers A on two axes and one side of the third: a slab of A remains.
    const cover = [0, 1, 2].map((k) => B.lo[k] <= A.lo[k] && B.hi[k] >= A.hi[k]);
    need(cover.filter(Boolean).length === 2, 'slab configuration (B covers A on two axes)');
    const k = cover.indexOf(false);
    let lo, hi;
    if (B.lo[k] > A.lo[k] && B.hi[k] >= A.hi[k]) [lo, hi] = [A.lo[k], B.lo[k]];
    else if (B.hi[k] < A.hi[k] && B.lo[k] <= A.lo[k]) [lo, hi] = [B.hi[k], A.hi[k]];
    else throw new Error('boxesClosedForm: B splits A into two slabs');
    const R = { lo: [...A.lo], hi: [...A.hi] };
    R.lo[k] = lo;
    R.hi[k] = hi;
    return { shells: 1, euler: 2, volume: boxVolume(R), area: boxArea(R), configuration: `slab of A, ${(hi - lo).toExponential(3)} mm thick along ${'xyz'[k]}` };
  }
  throw new Error(`boxesClosedForm: op ${op}`);
}

// Leaves and ops of a two-leaf tree.
function binary(job) {
  const t = job.tree;
  need(t.op && t.children.every((c) => c.leaf !== undefined), 'tree is one Boolean of two leaves');
  return { op: t.op, a: t.children[0].leaf, b: t.children[1].leaf };
}

// Planar references (deviation 0 on the wire): VOLUME_AGREE relative, the
// harness's mesh agreement bound. Curved references: area x deviation, the
// first-order volume between a surface and a mesh within the deviation.
const planarTol = (v) => VOLUME_AGREE * Math.abs(v);
const curvedTol = (v, area, dev) => Math.max(VOLUME_AGREE * Math.abs(v), area * dev);

// ---------------------------------------------------------------------------
// Recipes: case -> third reference. Each checks its own preconditions on the
// wire job and throws if the case is not of the form it computes.

const RECIPES = {
  // Two axis-aligned boxes; union or subtract. OCCT's fuzzy CSG merges a gap,
  // drops a slab or splits an overlap below 1e-7 mm.
  axisBoxes(c, job) {
    const { op, a, b } = binary(job);
    need(isIdentity(job.prims[a].matrix) && isIdentity(job.prims[b].matrix), 'axis-aligned boxes (identity placement)');
    const r = boxesClosedForm(op, boxOf(job.prims[a]), boxOf(job.prims[b]));
    return {
      class: 'occt-fuzzy',
      method: 'closed form on the wire box bounds (exact doubles)',
      reference: { shells: r.shells, euler: r.euler, volume: r.volume, area: r.area, volumeTolAbs: planarTol(r.volume) },
      evidence: { configuration: r.configuration },
    };
  },

  // A - B with B strictly inside A: the result mesh is A's mesh plus B's
  // mesh reversed. It is constructed from the wire leaves and accepted only
  // if the exact validator passes it (no touching, closed, oriented) and a
  // vertex of B lies strictly inside A (exact ray parity).
  nestedSubtract(c, job) {
    const { op, a, b } = binary(job);
    need(op === 'subtract', 'subtract');
    const A = job.meshes.find((m) => m.leaf === a), B = job.meshes.find((m) => m.leaf === b);
    const n = A.vertices.length;
    const mesh = { vertices: [...A.vertices, ...B.vertices], triangles: [...A.triangles, ...B.triangles.map(([x, y, z, t]) => [n + x, n + z, n + y, t])] };
    const v = validateMesh(mesh, { faces: job.faces, deviation: job.deviation });
    need(v.valid, `constructed nested result validates (${v.issues.map((i) => i.kind).join(', ')})`);
    const where = pointInMesh(B.vertices[0], A);
    need(where === 'in', `B vertex strictly inside A (got ${where})`);
    return {
      class: 'occt-fuzzy',
      method: 'result mesh constructed from the wire leaves (A + reversed B), exact validator + exact point-in-mesh',
      reference: { shells: v.components, euler: v.euler, volume: v.volume, area: v.area, volumeTolAbs: planarTol(v.volume) },
      evidence: { nesting: 'every triangle pair of A and B is disjoint (exact) and B lies inside A', triangles: v.triangles },
    };
  },

  // (((A - B) u B) - B) u B with identical B leaves: by regularized set
  // algebra this is A u B. A is an axis-aligned box, B a tilted cylinder that
  // pierces both horizontal faces of A and stays inside its sides.
  iteratedBoxCylinder(c, job) {
    const t = job.tree;
    const L = (n) => n.leaf;
    need(t.op === 'union' && t.children[0].op === 'subtract' && t.children[0].children[0].op === 'union' && t.children[0].children[0].children[0].op === 'subtract', 'tree (((A - B) u B) - B) u B');
    const leaves = [L(t.children[0].children[0].children[0].children[0]), L(t.children[0].children[0].children[0].children[1]), L(t.children[0].children[0].children[1]), L(t.children[0].children[1]), L(t.children[1])];
    const [ia, ...ib] = leaves;
    const same = (x, y) => JSON.stringify(job.prims[x]) === JSON.stringify(job.prims[y]) && JSON.stringify(job.meshes.find((m) => m.leaf === x).vertices) === JSON.stringify(job.meshes.find((m) => m.leaf === y).vertices);
    need(ib.every((x) => same(x, ib[0])), 'all B leaves identical (params, placement, mesh)');
    const r = boxUnionPiercingCylinder(job.prims[ia], job.prims[ib[0]]);
    return {
      class: 'manifold-perturbation',
      method: 'set identity (((A - B) u B) - B) u B = A u B, then closed form of box u tilted cylinder',
      reference: { ...r.reference, volumeTolAbs: curvedTol(r.reference.volume, r.reference.area, job.deviation) },
      evidence: r.evidence,
    };
  },

  // Cylinder (world z axis) against a box whose -x face is a slightly tilted
  // plane that cuts a thin segment off the cylinder. The shaving is thinner
  // than the tessellation deviation, so the tessellated leaves miss it; the
  // exact CSG does not.
  cylinderShave(c, job) {
    const { op, a, b } = binary(job);
    const cyl = job.prims[a], box = job.prims[b];
    need(cyl.kind === 'cylinder' && isIdentity(cyl.matrix), 'cylinder on the world z axis from the origin');
    const [r, h] = cyl.params;
    const m = box.matrix;
    need(m[3] === 0 && m[7] === 0 && m[11] === 0, 'box placed without translation');
    const col = (k) => [m[k], m[4 + k], m[8 + k]];
    const [c0, c1, c2] = [col(0), col(1), col(2)];
    need(c0[1] === 0 && c0[0] > 0, 'box rotated about the y axis only (its -x face stays a -x face)');
    const B = boxOf(box);
    // The cylinder's bounding box, in box coordinates, lies inside the box
    // on every side but -x: only the -x face cuts the cylinder.
    for (const p of [[-r, -r, 0], [r, -r, 0], [-r, r, 0], [r, r, 0], [-r, -r, h], [r, -r, h], [-r, r, h], [r, r, h]]) {
      const q = [dot(c0, p), dot(c1, p), dot(c2, p)];
      need(q[0] < B.hi[0] && q[1] > B.lo[1] && q[1] < B.hi[1] && q[2] > B.lo[2] && q[2] < B.hi[2], 'box covers the cylinder except for its -x face');
    }
    // Half-space c0 . p >= x0; at height z the chord lies at distance d(z).
    const dz = (z) => (B.lo[0] - c0[2] * z) / c0[0];
    need(dz(0) > 0 && dz(0) < r && dz(h) > 0 && dz(h) < r, 'the -x face cuts a segment (0 < d < r) over the whole height');
    const vShave = integrate((z) => circularSegmentArea(r, dz(z)), 0, h);
    const arc = integrate((z) => 2 * r * Math.acos(dz(z) / r), 0, h);
    const flat = integrate((z) => (2 * Math.sqrt(r * r - dz(z) ** 2)) / Math.abs(c0[0]), 0, h);
    const caps = circularSegmentArea(r, dz(0)) + circularSegmentArea(r, dz(h));
    const shave = { volume: vShave, area: arc + flat + caps };
    const evidence = { chordDistanceMm: [dz(0), dz(h)], shaveThicknessMm: [r - dz(0), r - dz(h)], deviationMm: job.deviation, shaveVolumeMm3: vShave };
    const method = 'quadrature (16-point Gauss-Legendre, 16 panels) of the closed-form circular-segment cross section';
    if (op === 'intersect') {
      return { class: 'below-deviation', method, reference: { shells: 1, euler: 2, volume: vShave, area: shave.area, volumeTolAbs: curvedTol(vShave, shave.area, job.deviation) }, evidence };
    }
    need(op === 'union', 'union or intersect');
    const volume = Math.PI * r * r * h + boxVolume(B) - vShave;
    const area = 2 * Math.PI * r * h + 2 * Math.PI * r * r + boxArea(B) - shave.area;
    return { class: 'below-deviation', method, reference: { shells: 1, euler: 2, volume, area, volumeTolAbs: curvedTol(volume, area, job.deviation) }, evidence };
  },

  // Torus (axis z) intersect a box whose bottom face z = h cuts a thin
  // annular cap off the top of the torus.
  torusCap(c, job) {
    const { op, a, b } = binary(job);
    need(op === 'intersect', 'intersect');
    const tor = job.prims[a], box = job.prims[b];
    need(tor.kind === 'torus' && isIdentity(tor.matrix) && isIdentity(box.matrix), 'torus and box without placement');
    const [R, r] = tor.params;
    const B = boxOf(box);
    const h = B.lo[2];
    need(h > 0 && h < r && B.hi[2] >= r && [0, 1].every((k) => B.lo[k] < -(R + r) && B.hi[k] > R + r), 'box bottom z = h cuts the torus top only');
    const w = Math.sqrt(r * r - h * h);
    const volume = 2 * Math.PI * R * circularSegmentArea(r, h);
    const area = 2 * Math.PI * r * R * (Math.PI - 2 * Math.asin(h / r)) + 4 * Math.PI * R * w;
    return {
      class: 'below-deviation',
      method: 'closed form: V = 2 pi R x circular segment area (Pappus); an annular ring (genus 1)',
      reference: { shells: 1, euler: 0, volume, area, volumeTolAbs: curvedTol(volume, area, job.deviation) },
      evidence: { capHeightMm: r - h, capWidthMm: 2 * w, deviationMm: job.deviation },
    };
  },

  // The case's `expect: empty` is decided by a set identity; the scorer does
  // not use the oracles for it.
  expectEmpty(c) {
    need(c.expect === 'empty', 'expect empty');
    return {
      class: 'expectation',
      method: 'set identity: (A - B) n B is empty after regularization',
      reference: { shells: 0, euler: 0, volume: 0, area: 0, volumeTolAbs: 0 },
      evidence: {},
    };
  },

  // Two boxes under the same rotation whose faces coincide analytically.
  // After the rotation the wire coordinates are rounded to F32x2, so the
  // coincident faces are displaced by ~1e-13 mm; whether the rounded input
  // touches, overlaps or leaves a gap is decided below the input rounding.
  roundedCoplanarBoxes(c, job) {
    const { op, a, b } = binary(job);
    need(sameRotation(job.prims[a].matrix, job.prims[b].matrix), 'both boxes under the same rotation');
    need(job.prims[a].matrix[3] === job.prims[b].matrix[3] && job.prims[a].matrix[7] === job.prims[b].matrix[7] && job.prims[a].matrix[11] === job.prims[b].matrix[11], 'same translation');
    const r = boxesClosedForm(op, boxOf(job.prims[a]), boxOf(job.prims[b]));
    return {
      class: 'input-rounding',
      ambiguous: true,
      method: 'closed form in the common box frame; exact probe of the rounded coincident faces',
      reference: { shells: r.shells, euler: r.euler, volume: r.volume, area: r.area, volumeTolAbs: planarTol(r.volume) },
      evidence: { configuration: r.configuration, probe: [...coincidentFaceProbe(job, b, a), ...coincidentFaceProbe(job, a, b)] },
    };
  },

  // Rotated plate minus (through hole u countersink cone) whose cone top is
  // flush with the plate top: the flush faces are displaced by the F32x2
  // rounding as in roundedCoplanarBoxes.
  roundedCoplanarCountersink(c, job) {
    const t = job.tree;
    need(t.op === 'subtract' && t.children[0].leaf !== undefined && t.children[1].op === 'union', 'plate - (cylinder u cone)');
    const ip = t.children[0].leaf, [ic, ik] = t.children[1].children.map((x) => x.leaf);
    const plate = job.prims[ip], cyl = job.prims[ic], cone = job.prims[ik];
    need(plate.kind === 'box' && cyl.kind === 'cylinder' && cone.kind === 'cone', 'box, cylinder, cone leaves');
    need(sameRotation(plate.matrix, cyl.matrix) && sameRotation(plate.matrix, cone.matrix), 'one rotation for all leaves');
    const m = plate.matrix;
    const toLocal = (p) => { const q = sub(p, [m[3], m[7], m[11]]); return [0, 1, 2].map((k) => q[0] * m[k] + q[1] * m[4 + k] + q[2] * m[8 + k]); };
    const bc = toLocal([cyl.matrix[3], cyl.matrix[7], cyl.matrix[11]]), bk = toLocal([cone.matrix[3], cone.matrix[7], cone.matrix[11]]);
    const P = boxOf(plate);
    const [rc, hc] = cyl.params, [r1, r2, hk] = cone.params;
    const T = P.hi[2] - P.lo[2];
    need(Math.hypot(bc[0] - bk[0], bc[1] - bk[1]) < 1e-9, 'coaxial cylinder and cone');
    need(Math.abs(bk[2] + hk - P.hi[2]) < COINCIDENT_MM, 'cone top flush with the plate top');
    need(bc[2] < P.lo[2] && bc[2] + hc > P.hi[2] && bk[2] > P.lo[2], 'cylinder through the plate, cone base inside');
    need(r1 === rc && r2 > r1, 'cone starts at the hole radius and widens');
    need(bc[0] - r2 > P.lo[0] && bc[0] + r2 < P.hi[0] && bc[1] - r2 > P.lo[1] && bc[1] + r2 < P.hi[1], 'hole inside the plate');
    const frustum = (Math.PI * hk * (r1 * r1 + r1 * r2 + r2 * r2)) / 3;
    const volume = boxVolume(P) - Math.PI * rc * rc * (T - hk) - frustum;
    const area = boxArea(P) - Math.PI * r2 * r2 - Math.PI * rc * rc + 2 * Math.PI * rc * (T - hk) + Math.PI * (r1 + r2) * Math.hypot(hk, r2 - r1);
    return {
      class: 'input-rounding',
      ambiguous: true,
      method: 'closed form in the plate frame (plate - bore - frustum; genus 1); exact probe of the rounded flush faces',
      reference: { shells: 1, euler: 0, volume, area, volumeTolAbs: curvedTol(volume, area, job.deviation) },
      evidence: { configuration: `countersink flush with the plate top (|cone top - plate top| = ${Math.abs(bk[2] + hk - P.hi[2]).toExponential(2)} mm in the plate frame)`, probe: coincidentFaceProbe(job, ik, ip) },
    };
  },
};

// Axis-aligned box A and a cylinder B (any placement) that enters through
// A's bottom face and leaves through its top face, never touching its sides.
function boxUnionPiercingCylinder(boxPrim, cylPrim) {
  need(isIdentity(boxPrim.matrix), 'axis-aligned box');
  need(cylPrim.kind === 'cylinder', 'cylinder');
  const A = boxOf(boxPrim);
  const [r, h] = cylPrim.params;
  const m = cylPrim.matrix;
  const axis = [m[2], m[6], m[10]], base = [m[3], m[7], m[11]];
  const cos = axis[2], sin = Math.sqrt(1 - cos * cos);
  need(cos > 0, 'cylinder axis points up');
  need(base[2] + r * sin < A.lo[2] && base[2] + h * cos - r * sin > A.hi[2], 'both caps outside the box (below and above)');
  const at = (z) => { const s = (z - base[2]) / cos; return [base[0] + s * axis[0], base[1] + s * axis[1]]; };
  const reach = r / cos;
  for (const z of [A.lo[2], A.hi[2]]) {
    const [x, y] = at(z);
    need(x - reach > A.lo[0] && x + reach < A.hi[0] && y - reach > A.lo[1] && y + reach < A.hi[1], 'the cylinder stays inside the box sides');
  }
  const T = A.hi[2] - A.lo[2];
  const ellipse = (Math.PI * r * r) / cos;
  const volume = boxVolume(A) + Math.PI * r * r * h - T * ellipse;
  const area = boxArea(A) - 2 * ellipse + 2 * Math.PI * r * (h - T / cos) + 2 * Math.PI * r * r;
  return { reference: { shells: 1, euler: 2, volume, area }, evidence: { tiltDeg: (Math.acos(cos) * 180) / Math.PI, crossSectionMm2: ellipse } };
}

// Which case uses which recipe. A dispute without a recipe is unarbitrated.
export const CASE_RECIPES = {
  'adv-box-union-gap-1e-9': 'axisBoxes',
  'adv-slab-sliver-1e-7': 'axisBoxes',
  // Regressions of the hybrid gate (fix#1): a sealed void under a skin below
  // the step-4 tolerance of the time (2^-40 x scale); OCCT's fuzzy CSG opens
  // it, the closed form keeps 2 shells.
  'adv-skin-void-2e-11': 'axisBoxes',
  'adv-skin-void-5e-10-at-1000': 'axisBoxes',
  // Regressions of the hybrid gate (fix#2): a sealed void under a 1e-11 mm
  // skin on a tilted (not axis-aligned) face and on a rotated block; the skin
  // is far above the input rounding (2^-44 x scale unification). The
  // constructed nested mesh keeps 2 shells; OCCT's fuzzy CSG opens the void.
  'adv-skin-void-prism-tilted-1e-11': 'nestedSubtract',
  'adv-skin-void-rot-1e-11': 'nestedSubtract',
  'adv-ep2-skin-5e-7': 'axisBoxes',
  'adv-ep2-r1-skin-1e-7': 'axisBoxes',
  'adv-ep2-cube-corner-overlap-1e-7': 'axisBoxes',
  'adv-ep2-cube-edge-overlap-1e-9': 'axisBoxes',
  'adv-thin-spherical-shell-1e-6': 'nestedSubtract',
  'adv-ep2-iterated-sub-add-sub': 'iteratedBoxCylinder',
  'adv-ep2-empty-sub-then-intersect': 'expectEmpty',
  'adv3-cyl-plane-shave-tilt-intersect': 'cylinderShave',
  'adv3-cyl-plane-shave-tilt-union': 'cylinderShave',
  'adv3-torus-top-cap-intersect': 'torusCap',
  'adv-ep2-sweep-touch-union-1': 'roundedCoplanarBoxes',
  'adv-ep2-sweep-touch-union-3': 'roundedCoplanarBoxes',
  'adv-ep2-sweep-pocket-4': 'roundedCoplanarBoxes',
  'adv2-sdf-countersink-rot': 'roundedCoplanarCountersink',
};

// Which oracle the third reference confirms. Topology = shell count and
// Euler characteristic (manifold3d's is known; OCCT reports none), volume
// within the reference tolerance.
export function decide(entry, oracles) {
  if (entry.class === 'expectation') return 'expectation';
  if (entry.ambiguous) return 'ambiguous';
  const R = entry.reference;
  const m = oracles.manifold, o = oracles.occt;
  const okM = m && m.components === R.shells && m.euler === R.euler && Math.abs(m.volume - R.volume) <= R.volumeTolAbs;
  const okO = o && o.shells === R.shells && Math.abs(o.volume - R.volume) <= R.volumeTolAbs;
  if (okM && !okO) return 'manifold';
  if (okO && !okM) return 'occt';
  if (okM && okO) throw new Error('decide: both oracles agree with the reference; the case is not a dispute');
  return 'reference';
}

const REASONS = {
  manifold: 'OCCT is wrong here (fuzzy merge / lost sub-micron feature); the third reference confirms manifold3d',
  occt: 'manifold3d is wrong here; the third reference confirms OCCT',
  reference: 'neither oracle matches the third reference; the reference is used alone',
  expectation: 'the expectation decides the case; the oracles are not used for scoring',
  ambiguous: 'the analytic input has one answer, but the F32x2 rounding of the rotated input displaces the coincident faces below the rounding; whether the rounded input touches, overlaps or leaves a gap is not decided by either oracle (OCCT uses the analytic input, manifold3d a symbolic perturbation). Plan step 4 (carrier unification within 2^-44 x scale) fixes the intended answer; until then either oracle topology is admissible, with the reference volume',
};

// One arbiter entry for a dispute (needs the case and the oracle summary).
export function arbitrateCase(c, oracles, dispute = null) {
  const recipe = CASE_RECIPES[c.id];
  if (!recipe) throw new Error(`no arbitration recipe for ${c.id}`);
  const full = encodeJob(buildCase(c).job);
  const job = decodeJob(full); // the wire values
  const r = RECIPES[recipe](c, job);
  const entry = { id: c.id, expect: c.expect ?? 'solid', jobSha256: sha256(full), recipe, class: r.class, method: r.method, reference: r.reference, evidence: r.evidence };
  if (r.ambiguous) entry.ambiguous = true;
  entry.decision = decide(entry, oracles);
  if (entry.decision === 'ambiguous') {
    const alt = [{ shells: r.reference.shells, euler: r.reference.euler, source: 'analytic input (OCCT shells)' }];
    const m = oracles.manifold;
    if (m && (m.components !== r.reference.shells || m.euler !== r.reference.euler)) alt.push({ shells: m.components, euler: m.euler, source: 'rounded input as manifold3d resolves it' });
    entry.admissible = alt;
  }
  entry.reason = REASONS[entry.decision];
  entry.oracles = oracles;
  if (dispute) entry.dispute = dispute;
  return entry;
}

// ---------------------------------------------------------------------------
// Loading and lookup (run.mjs, judge.mjs)

export function loadArbiter(file = ARBITER_PATH) {
  const doc = readJson(file);
  return doc ? new Map(doc.entries.map((e) => [e.id, e])) : new Map();
}

// The entry for a case, only if it was computed for this exact job.
export function arbiterFor(arbiter, id, jobSha256) {
  const e = arbiter?.get(id);
  return e && e.jobSha256 === jobSha256 ? e : null;
}

// ---------------------------------------------------------------------------

function main(argv) {
  const suitesRoot = argv.includes('--suites') ? path.resolve(argv[argv.indexOf('--suites') + 1]) : path.join(ROOT, 'out/bakeoff/judge2/suites');
  const sets = caseSets(suitesRoot);
  const missingRefs = sets.filter((s) => !s.reference).map((s) => s.suite);
  const disputes = findDisputes(sets);
  const committed = readJson(ARBITER_PATH);
  let failures = 0;
  const fail = (msg) => { failures++; console.log(`FAIL ${msg}`); };

  if (argv.includes('--write')) {
    if (missingRefs.length) throw new Error(`--write needs every suite reference; missing: ${missingRefs.join(', ')} (run scripts/bakeoff/suite.mjs)`);
    const entries = [];
    for (const d of disputes) {
      if (!d.jobSha256) throw new Error(`${d.id}: reference has no jobSha256`);
      const e = { suite: d.suite, ...arbitrateCase(d.case, d.oracles, d.dispute) };
      if (e.jobSha256 !== d.jobSha256) throw new Error(`${d.id}: job hash differs from the suite reference (${e.jobSha256} vs ${d.jobSha256})`);
      entries.push(e);
      console.log(`${d.suite.padEnd(16)} ${d.id.padEnd(40)} ${e.decision.padEnd(11)} ${e.class}`);
    }
    const doc = {
      schema: 'wonky-bakeoff-arbiter/1',
      generator: 'node scripts/bakeoff/arbiter.mjs --write',
      policy: 'reference = exact CSG of the analytic input, unless the F32x2 rounding of the input can change the topology (ambiguous). A dispute = OCCT shells != manifold3d components, or |V_manifold - V_occt| > OCCT area x deviation.',
      suitesReferences: path.relative(ROOT, suitesRoot),
      entries,
    };
    fs.writeFileSync(ARBITER_PATH, JSON.stringify(doc, null, 1) + '\n');
    console.log(`wrote ${path.relative(ROOT, ARBITER_PATH)}: ${entries.length} entries`);
    return 0;
  }

  // --check (default): recompute every entry from the fixtures; coverage
  // against the suite references where they exist.
  if (!committed) {
    fail(`${path.relative(ROOT, ARBITER_PATH)} missing`);
    return 1;
  }
  const byId = new Map(sets.flatMap((s) => s.cases.map((c) => [c.id, c])));
  for (const e of committed.entries) {
    const c = byId.get(e.id);
    if (!c) { fail(`${e.id}: not in any case set`); continue; }
    const again = { suite: e.suite, ...arbitrateCase(c, e.oracles, e.dispute) };
    if (JSON.stringify(again) !== JSON.stringify(e)) fail(`${e.id}: recomputed entry differs from the committed one`);
  }
  const arb = loadArbiter();
  const unarbitrated = disputes.filter((d) => !arbiterFor(arb, d.id, d.jobSha256));
  for (const d of unarbitrated) fail(`unarbitrated dispute ${d.suite}/${d.id}: ${d.dispute.join('; ')}`);
  console.log(`${committed.entries.length} entries recomputed; ${disputes.length} disputes in ${sets.length - missingRefs.length} case sets with references, ${unarbitrated.length} unarbitrated${missingRefs.length ? `; no reference for ${missingRefs.join(', ')}` : ''}`);
  return failures ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err.stack ?? err.message);
    process.exit(1);
  }
}
