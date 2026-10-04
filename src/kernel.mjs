import { loadBend, registerBendImports } from './bend-loader.mjs';
import { selectBackend } from './native/backend.mjs';
import { cross, validateSolid } from './brep.mjs';
import { unsupported } from './errors.mjs';
import { binary64Host, number, real, vector as preciseVector, coords as preciseCoords } from './real.mjs';
import { identifyExtrusion, identifyTransform } from './identity.mjs';
import { transformConstructionHistory } from './construction-history.mjs';
import { addExactnessLabel, copyExactness, recordExtrudedProfile, settleExactness } from './exactness.mjs';

let loaded;
const selected = new Map();
// The shared selector defaults to Rust. Missing Rust builds refuse explicitly;
// the historical Bend JS path is reachable only with WONKY_BACKEND=js.
export function loadKernel() {
  // Preserve the Promise rejection contract for explicit unsupported modes.
  const backend = process.env.WONKY_BACKEND ?? selectBackend();
  if (backend === 'js') return loadJsKernel();
  if (!selected.has(backend)) selected.set(backend, import('./native/backend.mjs').then(native => native.openKernel(backend)));
  return selected.get(backend);
}
export function loadJsKernel() {
  loaded ??= (async () => {
    await registerBendImports();
    const kernel = await loadBend(new URL('../kernel/topology.bend', import.meta.url));
    const analytic = await loadBend(new URL('../kernel/analytic.bend', import.meta.url));
    const real = await loadBend(new URL('../kernel/real.bend', import.meta.url));
    const precise = await loadBend(new URL('../kernel/precise.bend', import.meta.url));
    const boolean = await loadBend(new URL('../kernel/boolean.bend', import.meta.url));
    const comparison = await loadBend(new URL('../kernel/comparison.bend', import.meta.url));
    const identity = await loadBend(new URL('../kernel/identity.bend', import.meta.url));
    const faceClassifier = await loadBend(new URL('../kernel/face-classification.bend', import.meta.url));
    const halfspace = await loadBend(new URL('../kernel/halfspace.bend', import.meta.url));
    const sketchLines = await loadBend(new URL('../kernel/sketch-lines.bend', import.meta.url));
    const sketchArcs = await loadBend(new URL('../kernel/sketch-arcs.bend', import.meta.url));
    const solidIntersection = await loadBend(new URL('../kernel/ports/solid-intersection.bend', import.meta.url));
    const curved = await loadBend(new URL('../kernel/ports/curved.bend', import.meta.url));
    const curvedIntersection = await loadBend(new URL('../kernel/ports/curved-intersection.bend', import.meta.url));
    const planarBoolean = await loadBend(new URL('../kernel/ports/planar-boolean.bend', import.meta.url));
    const revolve = await loadBend(new URL('../kernel/revolve.bend', import.meta.url));
    const tessellate = await loadBend(new URL('../kernel/tessellate.bend', import.meta.url));
    const pierce = await loadBend(new URL('../kernel/pierce.bend', import.meta.url));
    const profileRing = await loadBend(new URL('../kernel/profile-ring.bend', import.meta.url));
    const polygonPrism = await loadBend(new URL('../kernel/polygon-prism.bend', import.meta.url));
    // The hybrid Boolean (docs/hybrid-boolean-plan.md): hybrid.boolean(job text)
    // answers `exact` (B-rep), `mesh` (certified approximation) or `unresolved`;
    // the format is in kernel/hybrid/main.bend. Its module load: about 0.1 s
    // (0.6 s on a heavily loaded machine).
    const hybrid = await loadBend(new URL('../kernel/hybrid/main.bend', import.meta.url));
    // Integrated volume with a stated bound (kernel/volume.bend,
    // src/volume.mjs): recovered and imported bodies have no volume of their own.
    const volume = await loadBend(new URL('../kernel/volume.bend', import.meta.url));
    // Exact Booleans of prisms with a shared axis and cap planes
    // (kernel/prism-boolean.bend, src/prism-boolean.mjs): the arm just before
    // the hybrid.
    const prismBoolean = await loadBend(new URL('../kernel/prism-boolean.bend', import.meta.url));
    return { ...kernel, analytic, real, precise, boolean, comparison, identity, faceClassifier, halfspace, sketchLines, sketchArcs, solidIntersection, curved, curvedIntersection, planarBoolean, revolve, tessellate, pierce, profileRing, polygonPrism, hybrid, volume, prismBoolean };
  })();
  return loaded;
}
// F32 words for the kernel modules that still take them (topology.bend, geometry.bend).
// The polygon prism below takes F32x2 words from src/real.mjs instead. On
// WONKY_BACKEND=rust an F32 field crosses as binary64 (wire v2): no rounding.
export const vector = ([x, y, z]) => binary64Host() ? { $: 'V3', x, y, z } : { $: 'V3', x: Math.fround(x), y: Math.fround(y), z: Math.fround(z) };
export const coords = v => [v.x, v.y, v.z];
export function precisionForBodies(bodies) {
  const precisions = [...new Set(bodies.map(body => body.precision ?? 'F32'))];
  return precisions.length === 1 ? precisions[0] : 'mixed F32/F32x2';
}
export const list = values => values.reduceRight((tail, head) => ({ $: 'Con', head, tail }), { $: 'Nil' });
export function array(values) {
  const out = [];
  while (values.$ === 'Con') { out.push(values.head); values = values.tail; }
  if (values.$ !== 'Nil') throw new Error('Unexpected Bend list representation');
  return out;
}


// Profile merge policy (corpus W2, K2; docs/corpus/w2-plan.md decision 4).
// Exactly collinear straight-on vertices (deviation 0) are always merged. A
// near-collinear vertex (0 < deviation <= the profile tolerance, the host's
// tolerance(points)) is merged only when allowRegularized is true; the merge
// and its deviation are recorded in construction.profileMerge and the body
// states exactness 'regularized'. With false, such a vertex is kept and the
// face-loop admission (validateSolid) refuses it explicitly.
// OPEN (Marc): whether regularized merges are wanted under the strict policy.
export const PROFILE_MERGE = Object.freeze({ allowRegularized: true });

const where = reason => (reason.index === undefined ? '' : ` at vertex ${reason.index}`);
function refuseRing(reason) {
  unsupported(`Profile ring simplification in Bend refused the profile: ${reason.$}${where(reason)}`);
}
function refusePrism(reason, operation) {
  const measured = ['required', 'before', 'allowance'].filter(key => reason[key] !== undefined)
    .map(key => `${key} ${number(reason[key]).toExponential(3)} mm`);
  const detail = [...(reason.index === undefined ? [] : [`profile edge ${reason.index}`]), ...measured];
  unsupported(`Polygon prism ${operation} in Bend refused: ${reason.$}${detail.length ? ` (${detail.join(', ')})` : ''}`);
}
const lifted = points => list(points.map(p => preciseVector([p[0], p[1], 0])));

// Sketch-frame regularization (corpus W2 integrate). The prism refuses a frame
// whose axes are not orthogonal within 1e-11 (kernel/polygon-prism.bend
// frame_budget). Generated FeatureScript planes carry binary64 noise above that
// (corpus: archive-r16/hopper.fs:121 n.x = 8.43e-11; archive-r17/hopper.fs:33
// and r21-expanded-hopper.fs:33 2.04e-9). A sketch x axis within
// FRAME_REGULARIZATION.toleranceRad of orthogonal is projected onto the plane
// orthogonal to the normal before the F32x2 split: a profile point at distance
// r from the origin moves by at most toleranceRad * r, 1e-5 mm at r = 1000 mm,
// which is Onshape's own length tolerance (1e-8 m). The
// body records the measured defect (construction.frameRegularization) and
// states exactness 'regularized'. Defects at or below angularGuard (1e-12, the
// planar arrangement's resolution) are left alone; above toleranceRad the
// prism's InvalidFrame refusal stands.
export const FRAME_REGULARIZATION = Object.freeze({ angularGuard: 1e-12, toleranceRad: 1e-8 });
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit3 = a => { const length = Math.sqrt(dot3(a, a)); return a.map(v => v / length); };

// The binary64 inputs of polygonPrism.extrude: the near cap origin (plane
// origin + start offset) and the far cap origin (+ the sweep) are summed in
// binary64 and split once each, so equal cap planes reached by different sums
// (a box top at 0 + 11.78 and a pocket top at 1.68 + 10.1) get equal words; an
// F32x2 sum of the split summands drifts by up to an F32x2 ulp and the planar
// arrangement refuses such a contact as ambiguous. -0 is written as +0.
// Shared with the WK evaluator (src/lang/wk/real-host.mjs), which must hand
// the kernel the same words.
export function prismInputs(plane, delta, startOffset = [0, 0, 0]) {
  const offset = startOffset ?? [0, 0, 0];
  const origin = plane.origin.map((v, i) => v + offset[i] + 0);
  const far = origin.map((v, i) => v + delta[i] + 0);
  // The defect is measured on the decoded words of the normal and x, so it is a
  // function of the kernel inputs alone (the WK content key covers those).
  const words = v => v.map(c => number(real(c)));
  let x = plane.x, frameRegularization = null;
  const normal = unit3(words(plane.normal)), axis = unit3(words(plane.x));
  const defect = dot3(normal, axis);
  if (Math.abs(defect) > FRAME_REGULARIZATION.angularGuard && Math.abs(defect) <= FRAME_REGULARIZATION.toleranceRad) {
    x = unit3(axis.map((v, i) => v - defect * normal[i]));
    frameRegularization = { orthogonalityDefect: defect, toleranceRad: FRAME_REGULARIZATION.toleranceRad };
  }
  return { origin, normal: plane.normal, x, far, frameRegularization };
}

// A rigid translation of a prism is the prism of the translated cap origins
// (corpus W2 integrate fix 1). transformInBend of a polyhedral body adds the
// offset to the decoded words in F32x2, so a pocket built at z = -5.05..5.05
// and moved by 6.73 got a top 2.9e-14 mm off a box top at 11.78, and the planar
// arrangement refused the contact (AmbiguousContact, stage 2) where Onshape
// builds an open-top pocket (tmp/w2/verify-1/pattern-flush.fs; Python
// Pos() * Box(), fixtures/corpus-repro/py-api-surface/next-box-chain.py). The
// extrusion's binary64 inputs are kept with the body (not in its JSON) and a
// translation with an exactly identity rotation sums them in binary64, like
// prismInputs, and extrudes again in Bend: the copy's words are those of the
// same prism extruded in place. A body without them (a clone, a Boolean
// result, an imported body) and every rotation take the F32x2 transform.
const PRISM_INPUTS = new WeakMap();
// A copy of the body object ({ ...body } with other names) is the same prism.
export function carryPrismInputs(from, to) {
  if (PRISM_INPUTS.has(from)) PRISM_INPUTS.set(to, PRISM_INPUTS.get(from));
  return to;
}
export const isIdentityRotation = rows => rows.length === 3 && rows.every((row, i) => row.length === 3 && row.every((v, j) => v === (i === j ? 1 : 0)));
export const translatedPrismInputs = (inputs, offset) => ({ ...inputs,
  origin: inputs.origin.map((v, i) => v + offset[i] + 0), far: inputs.far.map((v, i) => v + offset[i] + 0) });
function prismInBend(kernel, inputs) {
  return kernel.polygonPrism.extrude(lifted(inputs.profile), preciseVector(inputs.origin), preciseVector(inputs.normal),
    preciseVector(inputs.x), preciseVector(inputs.far));
}

// The profile ring merge, then the F32x2 polygon prism (kernel/profile-ring.bend,
// kernel/polygon-prism.bend, docs/polygon-prism.md). Every input word is the
// F32x2 image of the host float64 (src/real.mjs), never an F32 rounding.
export function extrudeInBend(kernel, id, points, plane, delta, startOffset = [0, 0, 0], identityContext = {}) {
  const offset = startOffset ?? [0, 0, 0];
  const ring = kernel.profileRing.simplify(lifted(points), PROFILE_MERGE.allowRegularized);
  if (ring.$ !== 'Simplified') refuseRing(ring.reason);
  const kept = array(ring.kept);
  const merged = array(ring.merged).map(m => ({ index: m.index, deviationMm: number(m.deviation), exact: m.exact }));
  const profile = kept.map(index => points[index]);
  const inputs = { ...prismInputs(plane, delta, offset), profile };
  const result = prismInBend(kernel, inputs);
  if (result.$ !== 'Built') refusePrism(result.reason, 'extrusion');
  const body = decodePrism(result, id, {
    method: 'native Bend F32x2 polygon prism',
    profileMerge: { sourceVertices: points.length, keptVertices: kept.length, merged, toleranceMm: number(ring.tolerance),
      ...(merged.length ? { kept } : {}) },
    ...(inputs.frameRegularization ? { frameRegularization: inputs.frameRegularization } : {}),
  });
  if (merged.some(m => !m.exact) || inputs.frameRegularization) body.exactness = 'regularized';
  identifyExtrusion(kernel, body, id, points, plane, delta, offset, identityContext, merged.length ? kept : null);
  PRISM_INPUTS.set(body, { profile, origin: inputs.origin, normal: inputs.normal, x: inputs.x, far: inputs.far });
  recordExtrudedProfile(body, points);
  return body;
}

// A polyhedral body of the prism module decoded to float64. Each F32x2 word
// decodes with at most half a float64 ulp of rounding (docs/polygon-prism.md).
// required/allowance: the Bend incidence audit of the returned words.
// Zero words decode with the sign of their F32x2 arithmetic; -0 is written as +0
// (JSON drops the sign anyway), so equal geometry compares equal in memory too.
const decoded = value => preciseCoords(value).map(x => x + 0);
function decodePrism(result, id, construction) {
  const { solid } = result;
  const body = {
    id, precision: 'F32x2',
    vertices: array(solid.vertices).map(decoded),
    edges: array(solid.edges).map(({ start, end }) => ({ curve: 'line', start, end })),
    faces: array(solid.faces).map(face => ({
      surface: { type: 'plane', origin: decoded(face.origin), normal: decoded(face.normal), x: decoded(face.x) },
      loops: [array(face.boundary).map(({ edge, forward }) => ({ edge, forward }))],
    })),
  };
  body.shell = { closed: true, faces: body.faces.map((_, i) => i) };
  const [requiredMm, allowanceMm] = [number(result.required), number(result.allowance)];
  // A copy of an imprecise (F32) source keeps its own residual: it is not F32x2-precise.
  if (!(requiredMm <= allowanceMm)) body.precision = 'F32';
  body.construction = { ...construction, requiredIncidenceMm: requiredMm, allowanceMm };
  body.validation = validateSolid(body);
  return body;
}

export function transformInBend(kernel, body, id, rows, offset, identityContext = {}) {
  // The source's label is written before its construction record is cloned.
  settleExactness(body);
  if (body.faces.some(face => face.loops.length !== 1)) {
    unsupported('Rigid transform of a polyhedral body with inner face loops is not supported by the polygon prism transform');
  }
  const determinant = dot3(rows[0], cross(rows[1], rows[2]));
  const reflected = determinant < 0;
  const prism = PRISM_INPUTS.get(body), translated = !reflected && prism && isIdentityRotation(rows) ? translatedPrismInputs(prism, offset) : null;
  let moved;
  if (reflected) {
    // polygonPrism.transform accepts proper rotations only. Mirror the input
    // coordinates on the host, reverse every face loop (det = -1), and send
    // the resulting oriented solid through the existing Bend incidence audit.
    if (body.faces.some(face => face.surface.type !== 'plane') || body.edges.some(edge => (edge.curve.type ?? edge.curve) !== 'line')) unsupported('opTransform reflection requires a planar straight-edged solid');
    const point = p => preciseVector(rows.map((row, i) => dot3(row, p) + offset[i]));
    const direction = p => preciseVector(rows.map(row => dot3(row, p)));
    moved = kernel.polygonPrism.admit({ $: 'Solid', vertices: list(body.vertices.map(point)),
      edges: list(body.edges.map(edge => ({ $: 'Edge', start: edge.start, end: edge.end }))),
      faces: list(body.faces.map(face => ({ $: 'Face', origin: point(face.surface.origin), normal: direction(face.surface.normal),
        x: direction(face.surface.x), boundary: list([...face.loops[0]].reverse().map(use => ({ $: 'Use', edge: use.edge, forward: !use.forward }))) }))) });
    if (moved.$ !== 'Built') refusePrism(moved.reason, 'reflected transform');
  } else if (translated) {
    moved = prismInBend(kernel, translated);
    if (moved.$ !== 'Built') refusePrism(moved.reason, 'extrusion');
  } else {
    const solid = {
      $: 'Solid', vertices: list(body.vertices.map(preciseVector)),
      edges: list(body.edges.map(edge => ({ $: 'Edge', start: edge.start, end: edge.end }))),
      faces: list(body.faces.map(face => ({ $: 'Face', origin: preciseVector(face.surface.origin), normal: preciseVector(face.surface.normal),
        x: preciseVector(face.surface.x), boundary: list(face.loops[0].map(use => ({ $: 'Use', edge: use.edge, forward: use.forward }))) }))),
    };
    const columns = [0, 1, 2].map(k => preciseVector(rows.map(row => row[k])));
    moved = kernel.polygonPrism.transform(solid, { $: 'Rotation', x: columns[0], y: columns[1], z: columns[2] }, preciseVector(offset));
    if (moved.$ !== 'Built') refusePrism(moved.reason, 'rigid transform');
  }
  // A rigid copy keeps its source's construction record (as transformAnalytic
  // does); the incidence audit is the copy's own. A source without one (an F32
  // body from before W2, a frozen fixture) is named by the transform.
  const construction = body.construction ? structuredClone(body.construction)
    : { method: 'native Bend F32x2 rigid transform', sourcePrecision: body.precision ?? 'F32' };
  const result = decodePrism(moved, id, construction);
  if (translated) PRISM_INPUTS.set(result, translated);
  copyExactness(body, result);
  if (body.name) result.name = body.name;
  if (body.description !== undefined) result.description = body.description;
  if (body.appearance) result.appearance = body.appearance;
  transformConstructionHistory(body, result, id, rows, offset);
  identifyTransform(kernel, body, result, id, rows, offset, identityContext);
  return result;
}

// Cap snap before a planar Boolean (W2 integrate fix round 2,
// tmp/w2/verify-2/fold-residual.fs). A flush pocket reaches the box top by a
// different binary64 sum (a pocket z -3.04..3.04 moved up 25.22 against a box
// top at 28.26; FeatureScript's metre-to-millimetre conversion adds its own
// noise), and in 7-9.5 % of two-decimal cases the two caps split to F32x2
// words about 1e-14 mm apart. The planar arrangement refuses every vertex
// within its resolution of a plane that is not exactly on it
// (AmbiguousContact), where Onshape (1e-8 m tolerance) builds an open-top
// pocket. After such a refusal, and only then, src/boolean.mjs retries once
// with one operand's prism caps moved onto near-coplanar planes of the other:
// - the operand is a polygon prism with its binary64 inputs (PRISM_INPUTS: an
//   extrusion or a folded translation of one), its normal is a coordinate axis
//   exactly and its sketch x axis has no component along it, so every cap
//   vertex takes the cap origin's coordinate unchanged;
// - the other operand has a plane face whose normal is the same axis (both
//   directions) at a coordinate q with 0 < |q - cap| <= toleranceMm;
// - the cap origin coordinate becomes q, the prism is extruded again in Bend,
//   and every vertex of the moved cap must decode to q exactly, else no snap;
// - toleranceMm = CAP_SNAP.angularGuard * scale, scale = max(1, the largest
//   coordinate magnitude of both operands): the planar arrangement's own
//   resolution (kernel/ports/curved-validate.bend resolution uses the same
//   guard over a scale at least this large), 3e-11 mm for a 30 mm part. So a
//   snapped contact is one the arrangement cannot resolve at all.
// The operand states exactness 'regularized' with construction.capSnap
// ({cap, axis, fromMm, toMm, distanceMm, toleranceMm, onto}), and the Boolean
// result inherits it (src/exactness.mjs). Tilted caps, side faces and operands
// without prism inputs (Boolean results) are not snapped; their contact stays
// an explicit AmbiguousContact refusal.
// OPEN (Marc): whether the snap is wanted under the strict policy (enabled: false
// leaves such contacts to the AmbiguousContact refusal).
export const CAP_SNAP = Object.freeze({ enabled: true, angularGuard: 1e-12 });
const coordinateAxis = v => {
  const k = v.findIndex(c => c !== 0);
  return k >= 0 && v.every((c, i) => i === k || c === 0) ? k : -1;
};
const bodyScale = body => Math.max(...body.vertices.flat().map(Math.abs),
  ...body.faces.flatMap(face => face.surface.origin ?? []).map(Math.abs));
export function snapPrismCaps(kernel, body, other) {
  const prism = PRISM_INPUTS.get(body);
  if (!CAP_SNAP.enabled || !prism || body.faces.some(face => face.loops.length !== 1)) return null;
  const k = coordinateAxis(prism.normal);
  if (k < 0 || prism.x[k] !== 0) return null;
  const toleranceMm = CAP_SNAP.angularGuard * Math.max(1, bodyScale(body), bodyScale(other));
  const planes = [...new Set(other.faces.filter(face => face.surface.type === 'plane' && coordinateAxis(face.surface.normal) === k)
    .map(face => face.surface.origin[k]))].sort((p, q) => p - q);
  const snaps = [], moved = { origin: [...prism.origin], far: [...prism.far] };
  for (const cap of ['near', 'far']) {
    const key = cap === 'near' ? 'origin' : 'far', at = number(real(prism[key][k]));
    const candidates = planes.filter(q => q !== at && Math.abs(q - at) <= toleranceMm)
      .sort((p, q) => Math.abs(p - at) - Math.abs(q - at) || p - q);
    if (!candidates.length) continue;
    const to = candidates[0];
    moved[key][k] = to;
    snaps.push({ cap, axis: 'xyz'[k], fromMm: at, toMm: to, distanceMm: Math.abs(to - at), toleranceMm, onto: other.id ?? null });
  }
  if (!snaps.length) return null;
  const inputs = { ...prism, origin: moved.origin, far: moved.far };
  const result = prismInBend(kernel, inputs);
  if (result.$ !== 'Built') return null;
  const fresh = decodePrism(result, body.id, {});
  const sameTopology = fresh.edges.length === body.edges.length && fresh.edges.every((edge, i) => edge.start === body.edges[i].start && edge.end === body.edges[i].end)
    && fresh.faces.length === body.faces.length && fresh.faces.every((face, i) => JSON.stringify(face.loops) === JSON.stringify(body.faces[i].loops));
  if (!sameTopology || !(fresh.construction.requiredIncidenceMm <= fresh.construction.allowanceMm)) return null;
  // Every vertex of a moved cap lies on the other operand's plane exactly.
  for (const snap of snaps) {
    const from = snap.fromMm, onCap = body.vertices.map((v, i) => (v[k] === from ? i : -1)).filter(i => i >= 0);
    if (!onCap.length || onCap.some(i => fresh.vertices[i][k] !== snap.toMm)) return null;
  }
  settleExactness(body);
  const snapped = { ...body, vertices: fresh.vertices, faces: fresh.faces, shell: fresh.shell, validation: fresh.validation,
    construction: { ...structuredClone(body.construction ?? {}), requiredIncidenceMm: fresh.construction.requiredIncidenceMm,
      allowanceMm: fresh.construction.allowanceMm, capSnap: snaps } };
  addExactnessLabel(snapped, 'regularized');
  PRISM_INPUTS.set(snapped, inputs);
  return snapped;
}
