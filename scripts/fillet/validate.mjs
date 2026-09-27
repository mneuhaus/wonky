#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE: the result validator
// (docs/fillet/harness.md, "Validator"). It checks a prototype's B-rep; it
// never repairs or builds geometry.
//
//   node scripts/fillet/validate.mjs <job> <result> [--case <id>] [--no-occt] [--step <out.step>] [--writer production|harness]
//
// Checks, in order:
//   1. format        the result decodes (scripts/fillet/brepfmt.mjs)
//   2. topology      closed oriented 2-manifold: every loop chains, every edge
//                    used exactly once forward and once reversed, no unused
//                    vertex or edge, Euler-Poincaré gives an integer genus >= 0
//   3. geometry      vertices on their edge curves, edge ends at their vertices,
//                    edge samples on the surfaces of both faces (<= 1e-6 mm plus
//                    the face's stated approximation tolerance)
//   4. surface types blend/corner faces carry the exact types the case expects
//                    (blendTypes); any face with tol > 0 is an approximation and
//                    must state tol <= 0.01 mm
//   5. tangency      fillets: G1 across every edge between a blend/corner face and
//                    a support face (<= 1e-6 rad, 1e-3 rad next to approximations);
//                    blend radius equals the requested radius (cylinder radius,
//                    torus minor, sphere radius)
//   6. measures      volume and area: OpenCascade reads the result STEP
//                    (the prototype's writer: resultStepFor, the production
//                    writer src/exporters.mjs for A, else the harness writer
//                    scripts/bakeoff/recover-stepx.mjs; reference.py --measure); compared with the closed form (input volume +
//                    deltaVolume), the OCCT oracle in fixtures/fillet/reference.json
//                    and, where a probe exists, the Onshape oracle (the same
//                    file's `onshape` section, scripts/fillet/onshape-oracle.mjs;
//                    passed in as spec.onshape): Onshape is the primary oracle
//                    wherever it was probed

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toStepRecovered } from '../bakeoff/recover-stepx.mjs';
import { toStepFillet } from './stepx.mjs';
import { decodeJob, decodeResult } from './brepfmt.mjs';
import { closedFormVariants } from './closedform.mjs';
import { blendRadius, curvePoint, dist, dot, edgeInterval, edgeSamples, faceNormal, norm, pointCurveDistance, pointSurfaceDistance, scale, sub, unit } from './geom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const GEOM_TOL = 1e-6; // mm
export const APPROX_MAX = 0.01; // mm: largest stated approximation tolerance admitted
export const G1_TOL = 1e-6; // rad
export const G1_TOL_APPROX = 1e-3; // rad
export const RADIUS_TOL = 1e-7; // mm
export const VOLUME_REL = 1e-7;
export const AREA_REL = 1e-7;

function topology(body, issues) {
  const { vertices, edges, faces } = body;
  const fwd = edges.map(() => 0), rev = edges.map(() => 0);
  const usedV = vertices.map(() => false);
  let loops = 0;
  const bad = (m) => { if (issues.length < 200) issues.push(m); };
  edges.forEach((e, i) => {
    if (!(e.start < vertices.length && e.end < vertices.length)) bad(`edge ${i}: vertex index out of range`);
    usedV[e.start] = usedV[e.end] = true;
  });
  const faceEdges = faces.map(() => new Set());
  faces.forEach((f, fi) => {
    if (!f.loops.length) bad(`face ${fi}: no loop`);
    if (f.outer.filter(Boolean).length !== 1) bad(`face ${fi}: ${f.outer.filter(Boolean).length} outer loops`);
    for (const loop of f.loops) {
      loops++;
      if (!loop.length) { bad(`face ${fi}: empty loop`); continue; }
      const ends = loop.map((u) => {
        const e = edges[u.edge];
        if (!e) { bad(`face ${fi}: edge ${u.edge} out of range`); return [0, 0]; }
        (u.forward ? fwd : rev)[u.edge] = ((u.forward ? fwd : rev)[u.edge] || 0) + 1;
        faceEdges[fi].add(u.edge);
        return u.forward ? [e.start, e.end] : [e.end, e.start];
      });
      for (let k = 0; k < ends.length; k++) {
        const next = ends[(k + 1) % ends.length];
        if (ends[k][1] !== next[0]) bad(`face ${fi}: loop does not chain at use ${k} (vertex ${ends[k][1]} -> ${next[0]})`);
      }
    }
  });
  edges.forEach((_, i) => {
    if (fwd[i] !== 1 || rev[i] !== 1) bad(`edge ${i}: used ${fwd[i] || 0}x forward and ${rev[i] || 0}x reversed (need 1 + 1)`);
  });
  usedV.forEach((u, i) => { if (!u) bad(`vertex ${i}: unused`); });
  // Shells = face components through shared edges.
  const parent = faces.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const owner = new Map();
  faces.forEach((f, fi) => f.loops.flat().forEach((u) => {
    if (owner.has(u.edge)) parent[find(fi)] = find(owner.get(u.edge));
    else owner.set(u.edge, fi);
  }));
  const shells = new Set(faces.map((_, i) => find(i))).size;
  const V = vertices.length, E = edges.length, F = faces.length;
  const genus = shells - (V - E + 2 * F - loops) / 2;
  if (!Number.isInteger(genus) || genus < 0) bad(`Euler-Poincaré: V ${V} E ${E} F ${F} L ${loops} S ${shells} gives genus ${genus}`);
  return { vertices: V, edges: E, faces: F, loops, shells, genus };
}

function geometry(body, issues) {
  const { vertices, edges, faces } = body;
  const faceOf = edges.map(() => []);
  faces.forEach((f, fi) => f.loops.flat().forEach((u) => faceOf[u.edge]?.push(fi)));
  let vOnCurve = 0, endGap = 0, onSurface = 0;
  const bad = (m) => { if (issues.length < 200) issues.push(m); };
  edges.forEach((e, i) => {
    if (!vertices[e.start] || !vertices[e.end]) return;
    const dv = Math.max(pointCurveDistance(e.curve, vertices[e.start]), pointCurveDistance(e.curve, vertices[e.end]));
    vOnCurve = Math.max(vOnCurve, dv);
    const { t0, t1 } = edgeInterval(e, vertices);
    const gap = Math.max(dist(curvePoint(e.curve, t0), vertices[e.start]), dist(curvePoint(e.curve, t1), vertices[e.end]));
    endGap = Math.max(endGap, gap);
    if (dv > GEOM_TOL) bad(`edge ${i}: vertex off its curve by ${dv.toExponential(2)} mm`);
    if (gap > GEOM_TOL) bad(`edge ${i}: curve range ends ${gap.toExponential(2)} mm from its vertices`);
    if (Math.abs(t1 - t0) < 1e-12) bad(`edge ${i}: zero parameter length`);
    const samples = edgeSamples(e, vertices, 16);
    for (const fi of new Set(faceOf[i])) {
      const f = faces[fi], tol = GEOM_TOL + (f.tol ?? 0);
      const d = Math.max(...samples.map((s) => pointSurfaceDistance(f.surface, s.p)));
      onSurface = Math.max(onSurface, d - (f.tol ?? 0));
      if (d > tol) bad(`edge ${i}: ${d.toExponential(2)} mm off the ${f.surface.type} of face ${fi}`);
    }
  });
  return { maxVertexOffCurveMm: vOnCurve, maxRangeEndGapMm: endGap, maxEdgeOffSurfaceMm: onSurface, toleranceMm: GEOM_TOL };
}

const isBlend = (f) => f.role === 'blend' || f.role === 'corner';

function surfaces(body, job, spec, issues) {
  const byType = {}, byRole = {}, approximated = [];
  body.faces.forEach((f, i) => {
    byType[f.surface.type] = (byType[f.surface.type] ?? 0) + 1;
    byRole[f.role] ??= {};
    byRole[f.role][f.surface.type] = (byRole[f.role][f.surface.type] ?? 0) + 1;
    if (f.surface.type === 'bspline' && !(f.tol > 0)) issues.push(`face ${i}: a bspline face is an approximation and must state tol > 0`);
    if (f.tol > 0) {
      approximated.push({ face: i, type: f.surface.type, tolMm: f.tol });
      if (f.tol > APPROX_MAX) issues.push(`face ${i}: stated approximation tolerance ${f.tol} mm exceeds ${APPROX_MAX} mm`);
    }
  });
  const blendFaces = body.faces.filter(isBlend);
  const exactBlendTypes = [...new Set(blendFaces.filter((f) => !(f.tol > 0)).map((f) => f.surface.type))];
  const expected = spec?.blendTypes ?? null;
  const blendTypesMatch = expected ? exactBlendTypes.every((t) => expected.includes(t)) : null;
  return { byType, byRole, blendFaces: blendFaces.length, exactBlendTypes, expectedBlendTypes: expected, blendTypesMatch, approximated, exact: approximated.length === 0 };
}

// Two surface records describe the same point set (frames may differ).
export function sameSurface(a, b, tol = 1e-7) {
  if (a.type !== b.type) return false;
  const par = (u, v) => Math.abs(Math.abs(dot(unit(u), unit(v))) - 1) < 1e-12;
  const onAxis = (p, o, ax) => { const d = sub(p, o); return norm(sub(d, scale(unit(ax), dot(d, unit(ax))))) < tol; };
  switch (a.type) {
    case 'plane': return par(a.normal, b.normal) && Math.abs(dot(sub(b.origin, a.origin), unit(a.normal))) < tol;
    case 'cylinder': return par(a.axis, b.axis) && onAxis(b.origin, a.origin, a.axis) && Math.abs(a.radius - b.radius) < tol;
    case 'sphere': return dist(a.origin, b.origin) < tol && Math.abs(a.radius - b.radius) < tol;
    case 'torus': return par(a.axis, b.axis) && dist(a.origin, b.origin) < tol && Math.abs(a.major - b.major) < tol && Math.abs(a.minor - b.minor) < tol;
    case 'cone': {
      if (!par(a.axis, b.axis) || !onAxis(b.origin, a.origin, a.axis)) return false;
      // Compare the radius law r(h) along a's axis at two heights.
      const lawA = (h) => Math.abs(a.radius + h * Math.tan(a.angle));
      const lawB = (h) => { const hb = (h - dot(sub(b.origin, a.origin), unit(a.axis))) * Math.sign(dot(unit(b.axis), unit(a.axis))); return Math.abs(b.radius + hb * Math.tan(b.angle)); };
      return Math.abs(lawA(0) - lawB(0)) < tol && Math.abs(lawA(10) - lawB(10)) < tol;
    }
    default: return false;
  }
}

// Fillets: an edge between a blend/corner face and a support face lying on a
// surface the ball rolls on (a face adjacent to a selected input edge) is a
// spring when the faces meet at less than TRIM_ANGLE; it must then be G1.
// Steeper junctions are trims (caps, mitres) and are only reported.
export const TRIM_ANGLE = 0.1; // rad
function tangency(body, job, issues) {
  const { faces, edges, vertices } = body;
  const uses = edges.map(() => []);
  faces.forEach((f, fi) => f.loops.flat().forEach((u) => uses[u.edge]?.push(fi)));
  const inUses = job.body.edges.map(() => []);
  job.body.faces.forEach((f, fi) => f.loops.flat().forEach((u) => inUses[u.edge].push(fi)));
  const rolled = [...new Set(job.select.flatMap((e) => inUses[e]))].map((fi) => job.body.faces[fi].surface);
  const onRolled = (f) => rolled.some((s) => sameSurface(s, f.surface));
  let springs = 0, maxSpring = 0, trims = 0, seams = 0, maxSeam = 0, radiusErr = 0;
  // Support faces that still lie on a rolled-on surface: none when every
  // support is consumed (r equal to both face widths), and then no spring
  // can exist; the blend meets only the far faces.
  const rolledLeft = faces.filter((f) => !isBlend(f) && onRolled(f)).length;
  const bad = (m) => { if (issues.length < 200) issues.push(m); };
  if (job.op === 'fillet') {
    faces.forEach((f, i) => {
      if (!isBlend(f) || f.tol > 0) return;
      const r = blendRadius(f.surface);
      if (r === null) { bad(`face ${i}: fillet ${f.role} face is a ${f.surface.type}, not a rolling-ball surface`); return; }
      const e = Math.abs(r - job.size);
      radiusErr = Math.max(radiusErr, e);
      if (e > RADIUS_TOL) bad(`face ${i}: blend radius ${r} differs from ${job.size} by ${e.toExponential(2)} mm`);
    });
  }
  edges.forEach((e, i) => {
    const [a, b] = uses[i];
    if (a === undefined || b === undefined || a === b) return;
    const fa = faces[a], fb = faces[b];
    if (!isBlend(fa) && !isBlend(fb)) return;
    const samples = edgeSamples(e, vertices, 10).slice(1, -1);
    const ang = Math.max(...samples.map((s) => Math.acos(Math.max(-1, Math.min(1, dot(faceNormal(fa, s.p), faceNormal(fb, s.p)))))));
    if (isBlend(fa) && isBlend(fb)) { seams++; maxSeam = Math.max(maxSeam, ang); return; }
    const support = isBlend(fa) ? fb : fa;
    if (onRolled(support) && ang > Math.PI - TRIM_ANGLE) bad(`edge ${i}: blend and support normals opposed (${ang.toFixed(3)} rad): face orientation`);
    if (ang >= TRIM_ANGLE || !onRolled(support)) { trims++; return; }
    springs++;
    maxSpring = Math.max(maxSpring, ang);
    const tol = fa.tol > 0 || fb.tol > 0 ? G1_TOL_APPROX : G1_TOL;
    if (job.op === 'fillet' && ang > tol) bad(`edge ${i}: spring not G1 (${ang.toExponential(2)} rad)`);
  });
  return { springEdges: springs, maxSpringAngleRad: maxSpring, trimEdges: trims, blendBlendEdges: seams, maxBlendBlendAngleRad: maxSeam,
    maxBlendRadiusErrMm: job.op === 'fillet' ? radiusErr : null, rolledSupportFaces: rolledLeft,
    required: job.op === 'fillet' && rolledLeft > 0, waived: job.op === 'fillet' && rolledLeft === 0 ? 'every rolled-on support face is consumed' : null };
}

// Synchronous part: everything except the OCCT measurement.
export function checkResult(jobText, resultText, spec = null) {
  const job = decodeJob(jobText);
  let res;
  try {
    res = decodeResult(resultText);
  } catch (err) {
    return { status: 'malformed', valid: false, issues: [`format: ${err.message}`] };
  }
  if (res.status === 'unresolved') return { status: 'unresolved', refusal: { class: res.class, knownClass: res.knownClass, reason: res.reason }, valid: null, issues: [] };
  const issues = [];
  const topo = topology(res.body, issues);
  const geo = issues.length ? null : geometry(res.body, issues);
  const surf = surfaces(res.body, job, spec, issues);
  const tan = issues.length ? null : tangency(res.body, job, issues);
  if (job.op === 'fillet' && tan && tan.springEdges === 0 && tan.required) issues.push('no G1 spring edge between a blend face and a rolled-on support face');
  if (!surf.blendFaces) issues.push('no face has role blend or corner');
  return { status: 'ok', valid: issues.length === 0, issues, topology: topo, geometry: geo, surfaces: surf, tangency: tan, body: res.body };
}

// STEP CONICAL_SURFACE needs a positive semi-angle; (axis, angle) and
// (−axis, −angle) describe the same cone with the same natural normal
// (geom.mjs conventions), so negative angles are written flipped. Serializing
// only: no coordinate changes.
function stepSurface(s) {
  return s.type === 'cone' && s.angle < 0 ? { ...s, axis: s.axis.map((x) => -x), angle: -s.angle } : s;
}

const BEND_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'bend.lock.json'), 'utf8')).version;

// The harness result writer (no parameter curves): prototypes without the
// production writer, and the adversarial runner's input STEPs.
export function resultStep(body, id) {
  body = { ...body, faces: body.faces.map((f) => ({ ...f, surface: stepSurface(f.surface) })) };
  const model = { backend: { version: BEND_VERSION }, bodies: [{ id, vertices: body.vertices, edges: body.edges, faces: body.faces }] };
  // Bodies with the stage-C2 bspline surface go through the extended copy.
  const extended = body.faces.some((f) => f.surface.type === 'bspline');
  return (extended ? toStepFillet : toStepRecovered)(model, id, 1e-6);
}

// The production writer (docs/fillet-plan.md §8 step 1): the result text is
// mapped onto the production types in Bend (kernel/fillet/production.bend via
// src/fillet.mjs: Sphere, Torus, a positive-angle Cone, periodic whole
// circles) and written by src/exporters.mjs with its parameter curves
// (cylinder charts, sphere frames). Loaded on first use: the exporter compiles
// its Bend modules when imported.
let production;
export async function productionStep(resultText, id) {
  production ??= Promise.all([import('../../src/fillet.mjs'), import('../../src/exporters.mjs')])
    .then(async ([fillet, exporters]) => ({ fillet, toStep: exporters.toStep, native: await fillet.loadFilletProduction(), kernel: await fillet.loadFilletValidation() }));
  const { fillet, toStep, native, kernel } = await production;
  const r = fillet.filletResultBody(native, resultText, id, kernel);
  if (r.status !== 'ok') throw new Error(`${id}: the result is a refusal, not a B-rep`);
  return { step: toStep({ backend: { version: BEND_VERSION }, bodies: [r.body] }, id), body: r.body };
}

// The STEP of a valid result with the prototype's writer ('production' for
// A, else 'harness'). A production export refusal (a capability error) is
// returned, never replaced by the harness writer.
export async function resultStepFor(writer, body, resultText, id) {
  if (writer !== 'production') return { ok: true, writer: 'harness', step: resultStep(body, id), body };
  try {
    return { ok: true, writer, ...(await productionStep(resultText, id)) };
  } catch (err) {
    return { ok: false, writer, error: `production STEP export refused: ${err.message}` };
  }
}

function run(exe, args) {
  return new Promise((resolve) => {
    const c = spawn(exe, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (b) => { out += b; });
    c.stderr.on('data', (b) => { err += b; });
    c.on('close', (code) => resolve({ code, out, err }));
  });
}

// OCCT measurement of result STEP files (one uv process for the batch).
export async function occtMeasure(files) {
  if (!files.length) return [];
  const r = await run('uv', ['run', '--quiet', 'scripts/fillet/reference.py', '--measure', ...files]);
  if (r.code !== 0) throw new Error(`reference.py --measure failed: ${r.err.slice(-1500)}`);
  return JSON.parse(r.out.trim().split('\n').pop());
}

// Expected volume(s): closed form (primary and, when accepted, alternatives)
// on the kernel's input volume, and the OCCT oracle's result. With the job
// text, a closed form that states a job form (closedform.mjs) is evaluated on
// the job's geometry; Onshape agreement is judged on the design value (the
// probe ran on the design geometry).
export function compareMeasures(m, spec, sidecar, ref, jobText = null) {
  const out = { volume: m.volume, area: m.area, occtValid: m.valid, occtFreeEdges: m.freeEdges, occtSolids: m.solids };
  const V0 = sidecar?.kernel?.volumeMm3 ?? ref?.input?.volume ?? null;
  const approxTol = spec?._approxTolMm ?? 0;
  const tolFor = (V) => VOLUME_REL * Math.max(Math.abs(V), 1) + (m.area ?? 0) * approxTol;
  if (V0 !== null) {
    out.inputVolume = V0;
    out.deltaVolume = m.volume - V0;
    out.noOp = Math.abs(m.volume - V0) <= tolFor(V0);
  }
  const cf = spec?.closedForm;
  if (cf && V0 !== null) {
    const variants = closedFormVariants(cf, jobText ? decodeJob(jobText) : null);
    out.closedForm = {};
    for (const [k, v] of Object.entries(variants)) {
      const e = Math.abs(m.volume - (V0 + v.value));
      out.closedForm[k] = { expected: V0 + v.value, absErr: e, ok: e <= tolFor(V0 + v.value), design: V0 + v.design,
        ...(v.job !== undefined ? { onJob: true } : {}), ...(v.jobError ? { jobError: v.jobError } : {}) };
    }
    out.matchesClosedForm = Object.entries(out.closedForm).find(([, v]) => v.ok)?.[0] ?? null;
  }
  // Onshape oracle: its volume change applied to the kernel's input (the two
  // inputs agree to the recorded inputVolumeRelErrVsKernel), and the
  // mass-property bounds [min, max] shifted the same way.
  const on = spec?.onshape;
  if (on?.verdict === 'built' && V0 !== null) {
    const expected = V0 + on.deltaVolume, lo = V0 + (on.volumeMin - on.inputVolume), hi = V0 + (on.volumeMax - on.inputVolume);
    const e = Math.abs(m.volume - expected);
    out.onshape = { code: on.code, deltaVolume: on.deltaVolume, expected, absErr: e, ok: e <= tolFor(expected),
      inRange: m.volume >= lo - tolFor(lo) && m.volume <= hi + tolFor(hi), faces: on.faces, faceTypes: on.faceTypes };
    if (out.closedForm) for (const [, v] of Object.entries(out.closedForm)) v.onshapeAgrees = Math.abs(v.design - expected) <= tolFor(expected);
  }
  if (ref?.status === 'done') {
    const e = Math.abs(m.volume - ref.result.volume), ea = Math.abs(m.area - ref.result.area);
    out.occt = { volume: ref.result.volume, area: ref.result.area, volumeAbsErr: e, areaRelErr: ea / ref.result.area,
      volumeOk: e <= tolFor(ref.result.volume), areaOk: ea <= AREA_REL * ref.result.area + (m.area ?? 0) * approxTol * 10, occtValid: ref.result.valid };
  }
  return out;
}

// Verdict of one case (docs/fillet/harness.md, "Verdicts").
export function verdictOf(spec, report) {
  const expect = spec?.expect ?? 'ok';
  if (!report || report.status === 'malformed') return 'error';
  if (report.status === 'unresolved') return expect === 'ok' ? 'declined' : 'expected-refusal';
  if (!report.valid) return 'invalid';
  if (expect === 'must-refuse') return 'wrong';
  // Onshape is the primary oracle wherever a probe exists: a result on a case
  // Onshape refuses (FP12, FILLET_FAIL_SMOOTH) is wrong.
  if (spec?.onshape?.verdict === 'refused') return 'wrong';
  const c = report.comparison;
  if (!c || c.error) return 'unmeasured';
  if (c.occtValid === false || (c.occtFreeEdges ?? 0) > 0) return 'invalid';
  // A closed-form change below the volume tolerance cannot be told from a
  // no-op by volume (the 178.9° ridge: -2.4e-5 mm³ on 6043 mm³). Such a result
  // is scored by its closed-form match; being valid, it has a blend face and a
  // G1 spring, so it is not the unchanged input.
  const tolV = VOLUME_REL * Math.max(Math.abs(c.inputVolume ?? 1), 1);
  const expectedChange = spec?.closedForm ? Math.abs(spec.closedForm.deltaVolume) > tolV : true;
  if (c.noOp && expectedChange && !spec?.noOpAllowed) return 'no-op';
  if (report.surfaces?.blendTypesMatch === false) return 'mismatch';
  const tier = report.surfaces?.exact ? 'pass' : 'pass-approx';
  // With an Onshape probe the closed forms Onshape agrees with decide (FP16
  // picks the corner triangle of ch-box-corner-3-d1); without an agreeing
  // form, Onshape's own value or its mass-property bounds do.
  const onForms = c.onshape && c.closedForm ? Object.entries(c.closedForm).filter(([, v]) => v.onshapeAgrees) : [];
  if (onForms.length) return onForms.some(([, v]) => v.ok) ? tier : 'mismatch';
  if (c.closedForm) return c.matchesClosedForm ? tier : 'mismatch';
  if (c.onshape) return c.onshape.ok || c.onshape.inRange ? tier : 'mismatch';
  if (c.occt && c.occt.occtValid) return c.occt.volumeOk && c.occt.areaOk ? tier : 'mismatch';
  return 'unverified';
}

async function main(argv) {
  const [jobPath, resultPath] = argv.filter((a) => !a.startsWith('--') && !['--case', '--step', '--writer'].includes(argv[argv.indexOf(a) - 1]));
  if (!jobPath || !resultPath) {
    console.error('usage: node scripts/fillet/validate.mjs <job> <result> [--case <id>] [--no-occt] [--step <out.step>] [--writer production|harness]');
    process.exit(2);
  }
  const jobText = fs.readFileSync(jobPath, 'utf8');
  const id = argv.includes('--case') ? argv[argv.indexOf('--case') + 1] : decodeJob(jobText).id;
  const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/fillet/cases.json'), 'utf8')).cases;
  const spec = cases.find((c) => c.id === id) ?? null;
  const resultText = fs.readFileSync(resultPath, 'utf8');
  const report = checkResult(jobText, resultText, spec);
  const written = report.status === 'ok' && report.valid && !argv.includes('--no-occt')
    ? await resultStepFor(argv.includes('--writer') ? argv[argv.indexOf('--writer') + 1] : 'harness', report.body, resultText, id) : null;
  if (written && !written.ok) report.comparison = { error: written.error };
  if (written?.ok) {
    const step = argv.includes('--step') ? path.resolve(argv[argv.indexOf('--step') + 1]) : path.join(ROOT, 'tmp/fillet/validate', `${id}.step`);
    fs.mkdirSync(path.dirname(step), { recursive: true });
    fs.writeFileSync(step, written.step);
    const [m] = await occtMeasure([step]);
    const sidecarPath = path.join(ROOT, 'fixtures/fillet/jobs', `${id}.json`);
    const sidecar = fs.existsSync(sidecarPath) ? JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) : null;
    const refAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/fillet/reference.json'), 'utf8'));
    const spec2 = spec ? { ...spec, onshape: refAll.onshape?.cases?.[id] ?? null, _approxTolMm: Math.max(0, ...report.surfaces.approximated.map((a) => a.tolMm)) } : null;
    report.comparison = m.error ? { error: m.error } : compareMeasures(m, spec2, sidecar, refAll.cases[id], jobText);
  }
  delete report.body;
  const refOn = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/fillet/reference.json'), 'utf8')).onshape?.cases?.[id] ?? null;
  report.verdict = verdictOf(spec ? { ...spec, onshape: refOn } : spec, report);
  console.log(JSON.stringify(report, null, 1));
  process.exit(report.status === 'ok' && !report.valid ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.stack ?? err.message);
    process.exit(1);
  });
}
