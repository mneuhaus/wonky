// Boolean bake-off TEST INFRASTRUCTURE: tessellation of a frozen exact B-rep
// body (wonky-acceptance-operands/1 JSON, e.g. the r10b g10 operands) into a
// tagged watertight fixture mesh. Never used to build production geometry.
//
// Scope, checked and refused otherwise: planar faces (any number of loops)
// and cylindrical faces with one loop; edges that are lines, circles or
// ellipses. Every edge is sampled once (line: its two vertices; circle and
// ellipse: vertices plus interior points on the exact curve, spaced by the
// chordal deviation), so both faces of an edge share its samples and the
// mesh is watertight by construction. Planar faces are ear-clipped in their
// plane. A cylindrical face owns the sampling of its curved edges: they are
// sampled at a uniform angular grid (sagitta <= deviation) plus the angles of
// all the face's vertices, so its unrolled (phi, height) domain splits into
// angular slabs with no vertex inside; each slab is cut into trapezoids that
// are zipper-triangulated. No vertex is invented off an edge. Body vertices are used as stored: the source body states a
// vertex tolerance (validation.toleranceMm), which is reported as the
// source tolerance and added to the case deviation budget.

import earcut from 'earcut';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { quantize } from './jobfmt.mjs';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / norm(a));
const TAU = 2 * Math.PI;

const cache = new Map();
export function loadOperands(file) {
  if (!cache.has(file)) cache.set(file, JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')));
  return cache.get(file);
}

// Largest angular step whose chord stays within `deviation` of radius r.
function maxStep(radius, deviation) {
  const c = 1 - deviation / radius;
  return c <= -1 ? Math.PI : 2 * Math.acos(Math.max(-1, c));
}

function curveFrame(curve) {
  const n = unit(curve.normal);
  const x = unit(curve.x);
  return { o: curve.origin, n, x, y: cross(n, x) };
}

function curvePoint(curve, f, t) {
  const [a, b] = curve.type === 'circle' ? [curve.radius, curve.radius] : [curve.major, curve.minor];
  return add(f.o, add(scale(f.x, a * Math.cos(t)), scale(f.y, b * Math.sin(t))));
}

function curveParam(curve, f, p) {
  const d = sub(p, f.o);
  const [a, b] = curve.type === 'circle' ? [curve.radius, curve.radius] : [curve.major, curve.minor];
  return Math.atan2(dot(d, f.y) / b, dot(d, f.x) / a);
}

const angleGap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// Points of an edge from its start to its end vertex (vertex indices at the
// ends, coordinates in between).
function sampleEdge(body, edge, deviation, tolerance) {
  const S = body.vertices[edge.start];
  const E = body.vertices[edge.end];
  const c = edge.curve;
  if (c.type === 'line') {
    if (edge.start === edge.end) throw new Error('closed line edge');
    return [];
  }
  if (c.type !== 'circle' && c.type !== 'ellipse') throw new Error(`unsupported edge curve ${c.type}`);
  const f = curveFrame(c);
  // Chord deviation is governed by the largest radius of curvature.
  const rho = c.type === 'circle' ? c.radius : (c.major * c.major) / c.minor;
  const t0 = curveParam(c, f, S);
  let sweep;
  if (edge.start === edge.end) {
    sweep = edge.sameSense === false ? -TAU : TAU;
  } else {
    if (!edge.curveRange) throw new Error('open curved edge without curveRange');
    const L = edge.curveRange[1] - edge.curveRange[0];
    const t1 = curveParam(c, f, E);
    const fwd = angleGap(t0 + L, t1);
    const bwd = angleGap(t0 - L, t1);
    sweep = fwd <= bwd ? L : -L;
    if (Math.min(fwd, bwd) * rho > 50 * tolerance + 1e-9) throw new Error(`edge endpoints do not match its curveRange (${Math.min(fwd, bwd) * rho} mm)`);
  }
  for (const p of [S, E]) {
    const q = curvePoint(c, f, curveParam(c, f, p));
    if (norm(sub(p, q)) > 50 * tolerance + 1e-9) throw new Error(`edge vertex ${norm(sub(p, q))} mm off its curve`);
  }
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / maxStep(rho, deviation)));
  const out = [];
  for (let k = 1; k < n; k++) out.push(curvePoint(c, f, t0 + (sweep * k) / n));
  return out;
}

const area2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

// Ear clipping of rings (first outer) of global vertex ids with 2D coords;
// restores boundary vertices earcut drops as collinear, so every ring edge
// is an edge of the triangulation (watertight against the neighbour faces).
function triangulate(rings, uv) {
  const flat = [];
  const ids = [];
  const holes = [];
  const next = new Map();
  for (const [r, ring] of rings.entries()) {
    if (r > 0) holes.push(ids.length);
    for (const [i, v] of ring.entries()) {
      flat.push(uv(v)[0], uv(v)[1]);
      ids.push(v);
      next.set(v, ring[(i + 1) % ring.length]);
    }
  }
  if (new Set(ids).size !== ids.length) throw new Error('face loops repeat a vertex');
  const pos = new Map(ids.map((v) => [v, uv(v)]));
  let tris = [];
  const idx = earcut(flat, holes);
  for (let i = 0; i < idx.length; i += 3) tris.push([ids[idx[i]], ids[idx[i + 1]], ids[idx[i + 2]]]);
  // Split triangle edges that skip collinear ring vertices.
  const chain = (u, w) => {
    const pts = [];
    let v = next.get(u);
    for (let guard = 0; v !== w && guard < ids.length; guard++) {
      pts.push(v);
      v = next.get(v);
    }
    if (v !== w || !pts.length) return null;
    const A = pos.get(u), B = pos.get(w);
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    for (const p of pts) if (Math.abs(area2(A, B, pos.get(p))) / L > 1e-9 * Math.max(1, L)) return null;
    return pts;
  };
  for (let changed = true, pass = 0; changed; pass++) {
    if (pass > ids.length) throw new Error("collinear repair did not converge");
    changed = false;
    const out = [];
    for (const t of tris) {
      let done = false;
      for (let k = 0; k < 3 && !done; k++) {
        const u = t[k], w = t[(k + 1) % 3], o = t[(k + 2) % 3];
        if (next.get(u) === w || next.get(w) === u) continue;
        const fwd = chain(u, w);
        const bwd = fwd ? null : chain(w, u);
        const pts = fwd ?? (bwd ? [...bwd].reverse() : null);
        if (!pts) continue;
        const seq = [u, ...pts, w];
        for (let j = 0; j + 1 < seq.length; j++) out.push([seq[j], seq[j + 1], o]);
        done = true;
        changed = true;
      }
      if (!done) out.push(t);
    }
    tris = out;
    if (tris.length > 4 * ids.length) throw new Error("collinear repair diverged");
  }
  const used = new Set(tris.flat());
  for (const v of ids) if (!used.has(v)) throw new Error('triangulation dropped a boundary vertex');
  return tris;
}


// Cylinder frame of a face: phi(p) is the angle about the axis from x.
function cylinderFrame(s) {
  const a = unit(s.axis);
  const x = unit(sub(s.x, scale(a, dot(s.x, a))));
  return { o: s.origin, a, x, y: cross(a, x), r: s.radius };
}

const wrap = (t) => ((t % TAU) + TAU) % TAU;
const phiOf = (F, p) => {
  const d = sub(p, F.o);
  return wrap(Math.atan2(dot(d, F.y), dot(d, F.x)));
};

// The point of the planar curve `c` (circle or ellipse lying on the
// cylinder F) at cylinder angle phi: the cylinder ruling at phi meets the
// curve's plane there.
function liftToCurve(F, c, phi) {
  const n = unit(c.normal);
  const base = add(F.o, add(scale(F.x, F.r * Math.cos(phi)), scale(F.y, F.r * Math.sin(phi))));
  const an = dot(F.a, n);
  if (Math.abs(an) < 1e-9) throw new Error('curve plane parallel to its cylinder axis');
  return add(base, scale(F.a, dot(sub(c.origin, base), n) / an));
}

function conicResidual(c, p) {
  const f = curveFrame(c);
  const d = sub(p, f.o);
  const off = Math.abs(dot(d, f.n));
  if (c.type === 'circle') return Math.max(off, Math.abs(Math.hypot(dot(d, f.x), dot(d, f.y)) - c.radius));
  const e = Math.hypot(dot(d, f.x) / c.major, dot(d, f.y) / c.minor);
  return Math.max(off, Math.abs(e - 1) * c.minor);
}

// Zipper triangulation of a slab trapezoid between a left and a right chain
// (each ascending in v); counter-clockwise in (u, v).
function zipper(L, R, v) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < L.length - 1 || j < R.length - 1) {
    const advanceLeft = j === R.length - 1 || (i < L.length - 1 && v(L[i + 1]) <= v(R[j + 1]));
    if (advanceLeft) {
      out.push([L[i], R[j], L[i + 1]]);
      i++;
    } else {
      out.push([L[i], R[j], R[j + 1]]);
      j++;
    }
  }
  return out;
}

// body -> {vertices, triangles: [a,b,c,faceIndex], faces: [{faceIndex, surface}],
//          deviation: {measured, method}, sourceToleranceMm, nominalVolume}
export function tessellateBrep(body, deviation) {
  const tolerance = body.validation?.toleranceMm ?? Math.max(0, ...(body.vertexTolerancesMm ?? [0]));
  const vertices = body.vertices.map((v) => [...v]);

  // Cylinder faces own the sampling of their curved edges: every curved
  // edge of a cylinder face is sampled at all of the face's target angles
  // (a uniform grid fine enough for the deviation plus the angles of all the
  // face's vertices), so no slab of the unrolled domain has a vertex inside.
  const cyl = new Map();
  const owner = new Map();
  for (const [fi, face] of body.faces.entries()) {
    if (face.surface.type !== 'cylinder') continue;
    if (face.loops.length !== 1) throw new Error(`cylinder face ${fi} with ${face.loops.length} loops`);
    const F = cylinderFrame(face.surface);
    const phi = new Map();
    // Line edges on a cylinder are rulings: their ends share one angle.
    for (const use of face.loops[0]) {
      const e = body.edges[use.edge];
      for (const v of [e.start, e.end]) if (!phi.has(v)) phi.set(v, phiOf(F, body.vertices[v]));
      if (e.curve.type === 'line') {
        const d = Math.abs(Math.atan2(Math.sin(phi.get(e.start) - phi.get(e.end)), Math.cos(phi.get(e.start) - phi.get(e.end))));
        if (d * F.r > 50 * tolerance + 1e-9) throw new Error(`cylinder face ${fi}: line edge ${use.edge} is not a ruling`);
        phi.set(e.end, phi.get(e.start));
      } else {
        if (owner.has(use.edge) && owner.get(use.edge) !== fi) throw new Error(`curved edge ${use.edge} lies on two cylinder faces`);
        owner.set(use.edge, fi);
      }
    }
    // Grid angles closer than 1e-7 rad to a vertex angle are dropped (the
    // vertex already bounds that slab); no near-duplicate samples.
    const n = Math.ceil(TAU / maxStep(F.r, deviation));
    const own = [...new Set(phi.values())];
    const near = (t) => own.some((p) => angleGap(p, t) < 1e-7);
    const grid = Array.from({ length: n }, (_, k) => (TAU * k) / n).filter((t) => !near(t));
    const targets = [...own, ...grid].sort((p, q) => p - q);
    cyl.set(fi, { F, phi, targets, sample: new Map() });
  }

  // Edge samples: [{id, phi?}] strictly between the end vertices.
  const samples = body.edges.map((e, ei) => {
    if (e.curve.type === 'line') {
      if (e.start === e.end) throw new Error(`closed line edge ${ei}`);
      return [];
    }
    if (!owner.has(ei)) {
      return sampleEdge(body, e, deviation, tolerance).map((p) => {
        vertices.push(p);
        return { id: vertices.length - 1 };
      });
    }
    const C = cyl.get(owner.get(ei));
    const { F } = C;
    const f = curveFrame(e.curve);
    const along = Math.sign(dot(f.n, F.a));
    // Direction of travel in phi: the curve parameter sweep (sampleEdge
    // logic) mapped through the orientation of the curve plane.
    let sweep;
    const t0 = curveParam(e.curve, f, body.vertices[e.start]);
    if (e.start === e.end) sweep = e.sameSense === false ? -TAU : TAU;
    else {
      const L = e.curveRange[1] - e.curveRange[0];
      const t1 = curveParam(e.curve, f, body.vertices[e.end]);
      sweep = angleGap(t0 + L, t1) <= angleGap(t0 - L, t1) ? L : -L;
    }
    const dir = Math.sign(sweep) * along;
    const ps = C.phi.get(e.start);
    const pe = C.phi.get(e.end);
    const span = e.start === e.end ? TAU : wrap(dir * (pe - ps));
    const out = [];
    for (const t of C.targets) {
      const d = wrap(dir * (t - ps));
      if (d > 1e-9 && d < span - 1e-9) out.push({ d, t });
    }
    out.sort((p, q) => p.d - q.d);
    return out.map(({ t }) => {
      const p = liftToCurve(F, e.curve, t);
      const res = conicResidual(e.curve, p);
      if (res > 50 * tolerance + 1e-9) throw new Error(`edge ${ei}: lifted sample ${res} mm off its curve`);
      vertices.push(p);
      const id = vertices.length - 1;
      C.phi.set(id, t);
      return { id };
    });
  });

  const edgePath = (use) => {
    const e = body.edges[use.edge];
    const path = [e.start, ...samples[use.edge].map((s) => s.id), e.end];
    return use.forward ? path : path.reverse();
  };
  const ring = (loop) => {
    const out = [];
    for (const use of loop) {
      const p = edgePath(use);
      if (out.length && out[out.length - 1] !== p[0]) throw new Error('loop is not connected');
      out.push(...p.slice(out.length ? 1 : 0));
    }
    if (out[0] !== out[out.length - 1]) throw new Error('loop is not closed');
    out.pop();
    return out;
  };

  const triangles = [];
  const faces = [];
  let measured = 0;
  for (const [fi, face] of body.faces.entries()) {
    const s = face.surface;
    const outward = face.sameSense === false ? -1 : 1;
    if (face.outer && face.outer.some((o, i) => o !== (i === 0))) throw new Error(`face ${fi}: outer loop must come first`);
    const rings = face.loops.map(ring);
    if (s.type === 'plane') {
      const n = unit(s.normal);
      const x = unit(sub(s.x, scale(n, dot(s.x, n))));
      const y = cross(n, x);
      const uv = (v) => {
        const d = sub(vertices[v], s.origin);
        return [dot(d, x), dot(d, y)];
      };
      let tris;
      try {
        tris = triangulate(rings, uv);
      } catch (err) {
        throw new Error(`planar face ${fi}: ${err.message}`);
      }
      for (const t of tris) {
        const a = area2(uv(t[0]), uv(t[1]), uv(t[2]));
        triangles.push(a * outward > 0 ? [t[0], t[1], t[2], fi] : [t[0], t[2], t[1], fi]);
      }
      faces.push({ faceIndex: fi, surface: { type: 'plane', o: s.origin, n: scale(n, outward), x } });
    } else if (s.type === 'cylinder') {
      const { F, phi } = cyl.get(fi);
      // Unrolled ring (u = phi, unwrapped continuously; v = height).
      const pts = [];
      let prev = null;
      for (const id of rings[0]) {
        let u = phi.get(id);
        if (u === undefined) throw new Error(`cylinder face ${fi}: vertex without angle`);
        if (prev !== null) u += TAU * Math.round((prev - u) / TAU);
        prev = u;
        pts.push({ id, u, v: dot(sub(vertices[id], F.o), F.a) });
      }
      if (Math.abs(prev - pts[0].u) > Math.PI) throw new Error(`cylinder face ${fi}: loop winds around the axis`);
      const us = [...new Set(pts.map((p) => p.u))].sort((p, q) => p - q);
      const edges = pts.map((p, i) => [p, pts[(i + 1) % pts.length]]).filter(([p, q]) => p.u !== q.u);
      const tris = [];
      for (let j = 0; j + 1 < us.length; j++) {
        const u0 = us[j], u1 = us[j + 1], uc = (u0 + u1) / 2;
        const crossing = [];
        for (const [p, q] of edges) {
          const [lo, hi] = p.u < q.u ? [p, q] : [q, p];
          if (lo.u <= u0 && hi.u >= u1) {
            if (lo.u !== u0 || hi.u !== u1) throw new Error(`cylinder face ${fi}: an edge spans several slabs`);
            crossing.push({ lo, hi, vc: (lo.v + hi.v) / 2 });
          }
        }
        if (crossing.length % 2) throw new Error(`cylinder face ${fi}: odd slab crossing`);
        crossing.sort((p, q) => p.vc - q.vc);
        for (let k = 0; k < crossing.length; k += 2) {
          const bot = crossing[k], top = crossing[k + 1];
          const side = (u, a, b) => {
            const inner = pts.filter((p) => p.u === u && p.v > a.v && p.v < b.v).sort((p, q) => p.v - q.v);
            const chain = [a, ...inner, b];
            return chain.filter((p, i) => i === 0 || p.id !== chain[i - 1].id);
          };
          const L = side(u0, bot.lo, top.lo);
          const R = side(u1, bot.hi, top.hi);
          for (const t of zipper(L, R, (p) => p.v)) tris.push(t);
        }
        measured = Math.max(measured, F.r * (1 - Math.cos((u1 - u0) / 2)));
      }
      for (const [p, q, w] of tris) triangles.push(outward > 0 ? [p.id, q.id, w.id, fi] : [p.id, w.id, q.id, fi]);
      faces.push({ faceIndex: fi, surface: { type: 'cylinder', o: s.origin, n: F.a, x: F.x, r: F.r } });
    } else {
      throw new Error(`unsupported face surface ${s.type}`);
    }
  }
  // Curved edges: chord sagitta between consecutive samples.
  for (const [ei, e] of body.edges.entries()) {
    if (e.curve.type === 'line') continue;
    const path = [e.start, ...samples[ei].map((s) => s.id), e.end].map((v) => vertices[v]);
    const rho = e.curve.type === 'circle' ? e.curve.radius : (e.curve.major * e.curve.major) / e.curve.minor;
    for (let k = 0; k + 1 < path.length; k++) {
      const chord = Math.min(2 * rho, norm(sub(path[k + 1], path[k])));
      measured = Math.max(measured, rho - Math.sqrt(rho * rho - (chord * chord) / 4));
    }
  }
  const q3 = (p) => [quantize(p[0]), quantize(p[1]), quantize(p[2])];
  const qs = (sf) => {
    const out = { ...sf, o: q3(sf.o), n: q3(sf.n) };
    if (sf.x) out.x = q3(sf.x);
    if (sf.r !== undefined) out.r = quantize(sf.r);
    return out;
  };
  return {
    vertices: vertices.map(q3),
    triangles,
    faces: faces.map((f) => ({ faceIndex: f.faceIndex, surface: qs(f.surface) })),
    sourceToleranceMm: tolerance,
    nominalVolume: body.validation?.volumeMm3 ?? null,
    deviation: { measured, method: 'exact chord sagitta per curved edge and per cylinder slab (planar faces exact); excludes the source vertex tolerance' },
  };
}
