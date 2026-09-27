// Failure analysis harness for corpus cluster kernel-sketch-and-ops
// (docs/corpus/cluster-kernel-sketch-and-ops.md). Production code stays untouched: the harness
// runs one FS unit through the production build() (src/index.mjs) with the CLI's options and
// adds in-process hooks around ModelingContext builtins and the loaded Bend kernel object.
//
// Diagnostics (always on):
//   lofts            every opLoft call: profile kinds and vertex counts, parallel planes,
//                    worst side-quad non-planarity (index correspondence), error
//   profileFailures  every refused sketch profile: vertex count, collinear corners with their
//                    deviation (mm), backtracking flag and adjacent edge lengths
//
// STUBS (--stub a,b,...): analysis only, never production. They let a unit continue past a
// blocker so the next blocker becomes visible. "exact" stubs model a proposed fix; "proxy" stubs
// change the geometry and only serve to reach later calls.
//   frame      exact  cap faces of a planar extrusion take the sketch frame (normal oriented along
//                     the sweep, x = frame x) instead of the F32 absolute-coordinate area vector
//                     and first edge (proposed fix, variant B)
//   area       exact  cap normal from the area vector about the first point (fix variant A)
//   collinear  exact* drop collinear profile vertices (* exact when the deviation is 0; the
//                     recorded deviation says when it is not)
//   loftplanar exact  two equal-count polygon profiles whose side quads are planar (<= 1e-9 mm):
//                     planar ruled solid with the extrusion topology (proposed loft phase 1)
//   loft       proxy  any other failing loft: extrusion of the first profile to the last plane
//   maxverts   proxy  profiles over 256 vertices are decimated to <= 256 (not exact)
//   mixed      proxy  skCircle entities in a line/arc sketch are dropped (holes disappear)
//   pvol       exact  rigid opPattern copies keep the volume of their source (fixes the
//                     RangeError of a second pierce after a copy; not this cluster)
//   boolean    proxy  a refused opBoolean is skipped with production-like lineage bookkeeping
//
// Usage: node scripts/corpus/kernel-sketch-and-ops/harness.mjs <file.fs> [feature] [--stub list]
// Prints one JSON line.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ModelingContext } from '../../../src/library.mjs';
import { loadJsKernel, list, array, vector, coords } from '../../../src/kernel.mjs';
import { dot, sub, cross, norm, tolerance, validatePolygon, validateSolid } from '../../../src/brep.mjs';
import { resolveTopology } from '../../../src/queries.mjs';

const args = process.argv.slice(2);
const stubIx = args.indexOf('--stub');
const stubs = new Set(stubIx >= 0 ? args[stubIx + 1].split(',') : []);
const [file, feature] = stubIx >= 0 ? args.filter((a, i) => i !== stubIx && i !== stubIx + 1) : args;
const log = { lofts: [], profileFailures: [], stubsUsed: {} };
const used = k => { log.stubsUsed[k] = (log.stubsUsed[k] ?? 0) + 1; };
const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function dropCollinear(points) {
  let pts = points.slice(), changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const eps = tolerance(pts);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if (Math.abs(turn(a, b, c)) <= eps * norm(sub(b, a))) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts;
}
function polygonDiag(points) {
  const eps = tolerance(points), out = { vertices: points.length, eps };
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
    const len = norm(sub(b, a)), t = turn(a, b, c);
    if (Math.abs(t) <= eps * len) {
      const back = dot(sub(b, a), sub(c, b)) < 0;
      (out.collinear ??= []).push({ i: (i + 1) % points.length, at: b, deviationMm: Math.abs(t) / Math.max(norm(sub(c, a)), 1e-12), backtrack: back, lenIn: len, lenOut: norm(sub(c, b)) });
    }
  }
  return out;
}
function lift(plane, p) { const y = cross(plane.normal, plane.x); return plane.origin.map((o, k) => o + plane.x[k] * p[0] + y[k] * p[1]); }
function loftDiag(engine, sketches) {
  const profs = sketches.map(s => {
    const p = s.profiles[0], plane = engine.numericPlane(s.plane);
    if (Array.isArray(p)) return { kind: 'polygon', n: p.length, plane, pts3: p.map(q => lift(plane, q)) };
    return { kind: p.type, plane };
  });
  const d = { profiles: profs.map(p => p.kind + (p.n ? p.n : '')).join('+') };
  if (profs.length === 2) {
    const [a, b] = profs;
    d.parallel = norm(cross(a.plane.normal, b.plane.normal)) < 1e-9;
    if (a.kind === 'polygon' && b.kind === 'polygon' && a.n === b.n) {
      let worst = 0;
      for (let i = 0; i < a.n; i++) {
        const p0 = a.pts3[i], p1 = a.pts3[(i + 1) % a.n], q0 = b.pts3[i], q1 = b.pts3[(i + 1) % a.n];
        // quad planarity: distance of q1 from plane(p0,p1,q0)
        const nrm = cross(sub(p1, p0), sub(q0, p0)), m = norm(nrm);
        const dev = m < 1e-12 ? 0 : Math.abs(dot(sub(q1, p0), nrm)) / m;
        worst = Math.max(worst, dev);
      }
      d.maxQuadNonPlanarityMm = worst;
      d.identical = a.pts3.every((p, i) => norm(sub(p, b.pts3[i])) < 1e-9);
      d.sameShape = sketches[0].profiles[0].every((p, i) => norm(sub(p, sketches[1].profiles[0][i])) < 1e-9);
    }
  }
  return d;
}

// Analysis-only exact ruled loft between two equal-count polygons whose side quads are planar.
// Same topology layout as kernel/topology.bend extrude; F32 vertices like the planar path.
function prismatoid(engine, id, sketches, loc) {
  const [A, B] = sketches.map(s => { const pl = engine.numericPlane(s.plane, loc); return { pl, pts: s.profiles[0].map(q => lift(pl, q).map(Math.fround)) }; });
  const n = A.pts.length;
  const along = sub(B.pts[0], A.pts[0]);
  const area = pts => pts.reduce((acc, p, i) => { const q = pts[(i + 1) % n]; const c = cross(sub(p, pts[0]), sub(q, pts[0])); return acc.map((v, k) => v + c[k]); }, [0, 0, 0]);
  let bottom = A.pts, top = B.pts;
  if (dot(area(bottom), along) < 0) { bottom = [...bottom].reverse(); top = [...top].reverse(); }
  const unit = v => { const m = norm(v); return v.map(x => x / m); };
  const vertices = [...bottom, ...top];
  const next = i => (i + 1) % n;
  const edges = [];
  for (let i = 0; i < n; i++) edges.push({ curve: 'line', start: i, end: next(i) });
  for (let i = 0; i < n; i++) edges.push({ curve: 'line', start: n + i, end: n + next(i) });
  for (let i = 0; i < n; i++) edges.push({ curve: 'line', start: i, end: n + i });
  const capN = unit(area(bottom));
  const x0 = unit(sub(bottom[1], bottom[0]));
  const faces = [];
  faces.push({ surface: { type: 'plane', origin: bottom[0], normal: capN.map(v => -v), x: x0 }, loops: [[...Array(n).keys()].reverse().map(i => ({ edge: i, forward: false }))] });
  faces.push({ surface: { type: 'plane', origin: top[0], normal: capN, x: unit(sub(top[1], top[0])) }, loops: [[...Array(n).keys()].map(i => ({ edge: n + i, forward: true }))] });
  for (let i = 0; i < n; i++) {
    const a = bottom[i], b = bottom[next(i)], t = top[i];
    const x = unit(sub(b, a)), nn = unit(cross(x, sub(t, a)));
    faces.push({ surface: { type: 'plane', origin: a, normal: nn, x }, loops: [[{ edge: i, forward: true }, { edge: 2 * n + next(i), forward: true }, { edge: n + i, forward: false }, { edge: 2 * n + i, forward: false }]] });
  }
  const body = { id: id.toString(), vertices, edges, faces, shell: { closed: true, faces: faces.map((_, i) => i) } };
  body.validation = validateSolid(body);
  return body;
}
const origBuiltins = ModelingContext.prototype.builtins;
ModelingContext.prototype.builtins = function () {
  const b = origBuiltins.call(this), engine = this;
  const loft = b.opLoft.call;
  b.opLoft = { ...b.opLoft, call: (argv, loc) => {
    const [context, id, definition] = argv;
    let sketches = null;
    try { sketches = (definition.profileSubqueries ?? []).map(q => engine.resolve(q, loc)); } catch {}
    const rec = { line: loc?.line, count: sketches?.length ?? null, ...(sketches ? loftDiag(engine, sketches) : {}) };
    log.lofts.push(rec);
    try { return loft(argv, loc); }
    catch (error) {
      rec.error = error.message;
      if (stubs.has('loftplanar') && sketches && rec.count === 2 && rec.maxQuadNonPlanarityMm !== undefined && rec.maxQuadNonPlanarityMm <= 1e-9) {
        used('loftplanar');
        engine.claim(context, id, loc);
        engine.addSolid(id, prismatoid(engine, id, sketches, loc));
        return;
      }
      if (!stubs.has('loft') || !sketches) throw error;
      used('loft');
      engine.claim(context, id, loc);
      const a = sketches[0], z = sketches.at(-1), pa = engine.numericPlane(a.plane, loc), pz = engine.numericPlane(z.plane, loc);
      const ca = a.profiles[0], cz = z.profiles[0];
      const cen = (p, pl) => Array.isArray(p) ? lift(pl, p.reduce((s, q) => [s[0] + q[0] / p.length, s[1] + q[1] / p.length], [0, 0])) : p.center ? lift(pl, p.center) : pl.origin;
      const dvec = sub(cen(cz, pz), cen(ca, pa));
      const h = dot(dvec, pa.normal);
      const delta = pa.normal.map(v => v * h);
      if (Array.isArray(ca)) engine.body(id, ca, pa, delta, undefined, loc);
      else throw error;
    }
  } };
  const circle = b.skCircle.call;
  b.skCircle = { ...b.skCircle, call: (argv, loc) => {
    const sk = argv[0];
    if (stubs.has('mixed') && sk?.curveEntities?.length) { used('mixed'); return; }
    return circle(argv, loc);
  } };
  if (stubs.has('pvol')) {
    // Rigid copies keep the exact volume of a pierced analytic source (analysis stub for the
    // transformAnalytic gap: 'native Bend through-hole pierce' is not in its volume-preserving list).
    const pattern = b.opPattern.call;
    b.opPattern = { ...b.opPattern, call: (argv, loc) => {
      const sources = resolveTopology(engine, argv[2].entities, loc).map(r => r.record.body);
      const before = new Set(engine.records.keys());
      const out = pattern(argv, loc);
      const fresh = [...engine.records.values()].filter(r => !before.has(r.key));
      fresh.forEach((r, i) => { const src = sources[i % sources.length]; if (r.body.validation && r.body.validation.volumeMm3 == null && Number.isFinite(src.validation?.volumeMm3)) { used('pvol'); r.body.validation.volumeMm3 = src.validation.volumeMm3; } });
      return out;
    } };
  }
  if (stubs.has('boolean')) {
    const realBoolean = b.opBoolean.call;
    b.opBoolean = { ...b.opBoolean, call: (argv, loc) => {
      try { return realBoolean(argv, loc); }
      catch (error) {
        if (error.name !== 'UnsupportedFeatureError' && !/InvalidTopology|unresolved/.test(error.message)) throw error;
        used('boolean');
        const [context, id, d] = argv;
        const tools = resolveTopology(engine, d.tools, loc), targets = d.targets === undefined ? [] : resolveTopology(engine, d.targets, loc);
        const subtract = d.operationType?.name === 'SUBTRACTION', intersect = d.operationType?.name === 'INTERSECTION';
        if (!engine.ids.has(id.key())) engine.claim(context, id, loc);
        const recs = (subtract ? targets : [...targets, ...tools]).map(r => r.record);
        if (subtract) { if (!d.keepTools) for (const t of tools) engine.records.delete(t.record.key); for (const r of recs) r.createdBy.add(id.key()); return; }
        const [first, ...rest] = recs;
        for (const r of rest) { for (const c of r.createdBy) first.createdBy.add(c); engine.records.delete(r.key); }
        first.createdBy.add(id.key());
      }
    } };
  }
  return b;
};
const origAddProfile = ModelingContext.prototype.addProfile;
ModelingContext.prototype.addProfile = function (sketch, id, points, loc) {
  try { validatePolygon(points, loc); }
  catch (error) {
    log.profileFailures.push({ line: loc?.line, message: error.message, ...polygonDiag(points) });
    if (stubs.has('collinear') && /collinear/.test(error.message)) { used('collinear'); points = dropCollinear(points); }
    else if (stubs.has('maxverts') && /3–256/.test(error.message)) { used('maxverts'); const k = Math.ceil(points.length / 256); points = dropCollinear(points.filter((_, i) => i % k === 0)); }
  }
  return origAddProfile.call(this, sketch, id, points, loc);
};
const kernel = await loadJsKernel();
if (stubs.has('area')) {
  const extrude = kernel.extrude;
  kernel.extrude = (points, delta) => {
    const P = array(points).map(coords), first = P[0];
    const local = extrude(list(P.map(p => vector(sub(p, first)))), delta);
    used('area');
    return kernel.transform(local, { $: 'Rotation', x: vector([1, 0, 0]), y: vector([0, 1, 0]), z: vector([0, 0, 1]) }, vector(first));
  };
}
if (stubs.has('frame')) {
  // Proposed fix, variant B: cap faces take the sketch frame (normal oriented along delta, x = frame x)
  // instead of the absolute-coordinate area vector and the first edge.
  const frameFn = kernel['geometry.frame'], extrude = kernel.extrude;
  let lastFrame = null;
  kernel['geometry.frame'] = (...a) => (lastFrame = frameFn(...a));
  kernel.extrude = (points, delta) => {
    const solid = extrude(points, delta);
    if (!lastFrame) return solid;
    used('frame');
    const n = coords(lastFrame.normal), d = coords(delta), sgn = dot(n, d) >= 0 ? 1 : -1;
    const top = vector(n.map(v => v * sgn)), bottom = vector(n.map(v => -v * sgn));
    const faces = array(solid.faces);
    faces[0] = { ...faces[0], normal: bottom, x: lastFrame.x };
    faces[1] = { ...faces[1], normal: top, x: lastFrame.x };
    lastFrame = null;
    return { ...solid, faces: list(faces) };
  };
}
const { build } = await import('../../../src/index.mjs');
const { normalizeModelingPolicy } = await import('../../../src/modeling-policy.mjs');
const source = readFileSync(file, 'utf8');
const sibling = resolve(dirname(file), 'modules.json');
const t0 = performance.now();
let result;
try {
  const model = await build(source, { feature: feature || undefined, parameters: {}, moduleManifest: existsSync(sibling) ? sibling : undefined,
    sourcePath: resolve(file), modelingPolicy: normalizeModelingPolicy({ curvedContacts: 'strict' }) });
  result = { ok: true, bodies: model.bodies.length, volumesMm3: model.bodies.map(b => b.validation?.volumeMm3 ?? null), completed: model.sourceMap?.operations?.filter(o => o.status === "completed").length };
} catch (error) {
  const ops = error.modelTrace?.operations ?? [];
  const at = [...ops].reverse().find(o => o.status === 'failed') ?? [...ops].reverse().find(o => o.status === 'running');
  result = { ok: false, errorClass: error.name, message: String(error.message).slice(0, 400), line: error.line ?? null, jsStack: /Error|TypeError/.test(error.name) && !/FeatureScript|Unsupported/.test(error.name) ? String(error.stack).split("\n").slice(1, 8).map(s => s.trim()) : undefined,
    completed: ops.filter(o => o.status === 'completed').length,
    failing: at ? { name: at.name, error: at.error?.message?.slice(0, 300) ?? null, chain: (at.callStack ?? []).map(f => `${f.name}@${f.calledAt?.line ?? '?'}`).join('>') } : null };
}
console.log(JSON.stringify({ file, feature: feature ?? null, stubs: [...stubs], ms: Math.round(performance.now() - t0), result, ...log }));
