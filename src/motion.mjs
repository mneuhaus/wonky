// Motion sampling over a built Rust Part Studio (docs/simulation.md, "Motion
// sampling"). A separate layer: it reads the model's bodies, never edits them.
//
//   spec (wonky-motion/v1)  -> poses (one driver value per joint and pose)
//   pose -> exact rigid placement of every moved body (OP_PLACEMENT steps,
//           chained so the kernel composes them exactly)
//   pose -> exact interference of every body pair (rust-clash.mjs)
//
// No float geometry decides anything here. Requested angles select a nearby
// rational tan-half-angle rotation within a disclosed angular tolerance; its
// Pythagorean matrix is transported as integer numerators / denominator. A
// translation is the driver value times a unit coordinate direction, so it is
// the binary64 value the FeatureScript quantity `value * millimeter` has.
// Sampling at poses is NOT continuous collision detection and the report says so.
import { createHash } from 'node:crypto';
import { quarterTurn } from './native/rust-placement.mjs';
import { clashRustBodies, placeRustBody, rustBodySha256, rustModelKernel } from './native/rust-host.mjs';

export const MOTION_SCHEMA = 'wonky-motion/v1';
export const REPORT_SCHEMA = 'wonky-motion-report/v1';

// A refusal with a stable code (motion/...); never a guessed answer.
export class MotionRefusal extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name = 'MotionRefusal'; this.code = code; }
}
const refuse = (code, message) => { throw new MotionRefusal(code, message); };

const LENGTH_UNITS = Object.freeze({ mm: 0.001, m: 1 });
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && Number.isFinite(x));
// Unit coordinate direction: exactly one nonzero component, equal to +-1.
const latticeAxis = v => (isVec3(v) && v.filter(x => x !== 0).length === 1 && v.every(x => x === 0 || x === 1 || x === -1)) ? v : null;
const key = joint => `joint '${joint.id}'`;

// ---------------------------------------------------------------- spec

// Checks and normalises a parsed spec. Lengths stay in the spec's unit until
// evaluation. Unsupported shapes refuse by name; chains are refused today
// (`parent` other than "world") but the joint record already names its parent.
export function normalizeMotionSpec(spec) {
  if (!isObject(spec) || spec.schema !== MOTION_SCHEMA) refuse('motion/schema', `schema must be '${MOTION_SCHEMA}'`);
  const unit = spec.units?.length ?? 'mm';
  if (!Object.hasOwn(LENGTH_UNITS, unit)) refuse('motion/unit', `units.length must be one of ${Object.keys(LENGTH_UNITS).join(', ')}`);
  if (!isObject(spec.model) || typeof spec.model.source !== 'string' || !spec.model.source) refuse('motion/model', 'model.source (a FeatureScript file) is required');
  if (!Array.isArray(spec.joints) || !spec.joints.length) refuse('motion/joints', 'joints must be a nonempty list');
  const ids = new Set(), moved = new Set(), joints = [];
  for (const j of spec.joints) {
    if (!isObject(j) || typeof j.id !== 'string' || !j.id || ids.has(j.id)) refuse('motion/joint-id', 'every joint needs a unique string id');
    ids.add(j.id);
    if (!['revolute', 'prismatic'].includes(j.type)) refuse('motion/joint-type', `${key(j)}: type must be revolute or prismatic`);
    if (j.parent !== undefined && j.parent !== 'world') refuse('motion/chains-not-supported', `${key(j)}: parent '${j.parent}' (only parent "world" is implemented)`);
    const bodies = j.bodies ?? (j.body === undefined ? null : [j.body]);
    if (!Array.isArray(bodies) || !bodies.length || bodies.some(b => typeof b !== 'string' || !b)) refuse('motion/joint-bodies', `${key(j)}: body (a name) or bodies (a list of names) is required`);
    for (const b of bodies) { if (moved.has(b)) refuse('motion/body-moved-twice', `${key(j)}: body '${b}' is already moved by another joint (chains are not implemented)`); moved.add(b); }
    if (!Array.isArray(j.range) || j.range.length !== 2 || !j.range.every(Number.isFinite) || j.range[0] > j.range[1]) refuse('motion/range', `${key(j)}: range must be [min, max]`);
    const out = { id: j.id, type: j.type, parent: 'world', bodies, range: [...j.range], samples: null };
    if (j.type === 'revolute') {
      if (!isObject(j.axis) || !isVec3(j.axis.direction) || !j.axis.direction.some(x => x !== 0)) refuse('motion/axis', `${key(j)}: axis.direction must be a nonzero 3-vector`);
      out.point = j.axis.point === undefined ? [0, 0, 0] : j.axis.point;
      if (!isVec3(out.point)) refuse('motion/axis', `${key(j)}: axis.point must be a 3-vector`);
      out.direction = [...j.axis.direction];
      out.rotationToleranceDegrees = j.rotationToleranceDegrees ?? 1e-6;
      if (!Number.isFinite(out.rotationToleranceDegrees) || out.rotationToleranceDegrees <= 0 || out.rotationToleranceDegrees > 1) refuse('motion/rotation-tolerance', `${key(j)}: rotationToleranceDegrees must be in (0, 1]`);
    } else {
      if (!isVec3(j.direction) || !j.direction.some(x => x !== 0)) refuse('motion/direction', `${key(j)}: direction must be a nonzero 3-vector`);
      out.direction = [...j.direction];
    }
    const d = j.driver;
    if (!isObject(d) || (d.samples === undefined) === (d.count === undefined)) refuse('motion/driver', `${key(j)}: driver needs exactly one of samples (a list) or count`);
    if (d.samples !== undefined) {
      if (!Array.isArray(d.samples) || !d.samples.length || !d.samples.every(Number.isFinite)) refuse('motion/driver', `${key(j)}: driver.samples must be a nonempty list of numbers`);
      out.samples = [...d.samples];
    } else {
      if (!Number.isInteger(d.count) || d.count < 2) refuse('motion/driver', `${key(j)}: driver.count must be an integer >= 2`);
      const [lo, hi] = out.range;
      const span = hi - lo;
      out.samples = Array.from({ length: d.count }, (_, i) => {
        if (i === 0) return lo;
        if (i === d.count - 1) return hi;
        const t = i / (d.count - 1);
        return Number.isFinite(span) ? lo + span * t : lo * (1 - t) + hi * t;
      });
    }
    if (!out.samples.every(Number.isFinite)) refuse('motion/driver', `${key(j)}: generated samples must be finite`);
    for (const v of out.samples) if (v < out.range[0] || v > out.range[1]) refuse('motion/sample-out-of-range', `${key(j)}: sample ${v} is outside range [${out.range}]`);
    joints.push(out);
  }
  const counts = new Set(joints.map(j => j.samples.length));
  if (counts.size !== 1) refuse('motion/sample-counts', 'all joints must have the same number of samples (pose i uses sample i of every joint)');
  const pairs = spec.pairs;
  if (pairs !== undefined && (!Array.isArray(pairs) || pairs.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => typeof n !== 'string')))) refuse('motion/pairs', 'pairs must be a list of [nameA, nameB]');
  return { schema: MOTION_SCHEMA, unit, model: spec.model, joints, pairs: pairs ?? null, poses: joints[0].samples.length };
}

// ---------------------------------------------------------------- bodies

// One body by its NAME property, its full id, or its id's last path segment.
export function resolveBody(model, ref) {
  const hits = model.bodies.filter(b => b.name === ref || b.id === ref || b.id.endsWith(`/${ref}`));
  if (!hits.length) refuse('motion/body-not-found', `no body named '${ref}' in the Part Studio`);
  if (hits.length > 1) refuse('motion/body-ambiguous', `'${ref}' names ${hits.length} bodies`);
  return hits[0];
}

// ---------------------------------------------------------------- placement

const negate = v => v.map(x => (x === 0 ? 0 : -x));
const translation = origin => ({ origin, x: [1, 0, 0], z: [0, 0, 1] });

const IDENTITY_ROWS = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// Binary64 input as an exact dyadic fraction, for the angular admission check.
function dyadic(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
  const shift = exponent ? exponent - 1075 : -1074;
  return { n: BigInt(Math.sign(value)) * mantissa * (shift > 0 ? 1n << BigInt(shift) : 1n), d: shift < 0 ? 1n << BigInt(-shift) : 1n };
}
const ANGLE_SCALE = 1n << 128n;
const ceilDiv = (n, d) => (n + d - 1n) / d;
const absInt = n => n < 0n ? -n : n;
// Certified atan enclosure: alternating series, with exact integer rounding of
// every term and of the remainder. |p/q| <= 1/2, so 64 terms suffice. The two
// decimal endpoints enclose pi (50 fractional digits), not a Math.PI assumption.
function angularErrorUpper(value, quarterTurns, p, q) {
  let lo = 0n, hi = 0n, pp = absInt(BigInt(p)), qq = BigInt(q);
  const p2 = pp * pp, q2 = qq * qq;
  for (let i = 0; i < 64; i++) {
    const n = ANGLE_SCALE * pp, d = qq * BigInt(2 * i + 1);
    const a = n / d, b = ceilDiv(n, d);
    if (i % 2) { lo -= b; hi -= a; } else { lo += a; hi += b; }
    pp *= p2; qq *= q2;
  }
  hi += ceilDiv(ANGLE_SCALE * pp, qq * 129n);
  const piLo = 314159265358979323846264338327950288419716939937510n;
  const piHi = piLo + 1n, decimalScale = 10n ** 50n;
  let lower = 360n * lo * decimalScale / piHi;
  let upper = ceilDiv(360n * hi * decimalScale, piLo);
  if (p < 0) [lower, upper] = [-upper, -lower];
  const quarter = BigInt(quarterTurns) * 90n * ANGLE_SCALE;
  const target = dyadic(value);
  const n = [lower, upper].map(v => absInt((quarter + v) * target.d - target.n * ANGLE_SCALE)).reduce((a, b) => a > b ? a : b);
  return { n, d: ANGLE_SCALE * target.d };
}
function adjacentPositive(value, up) {
  if (value === 0) return up ? Number.MIN_VALUE : 0;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value); view.setBigUint64(0, view.getBigUint64(0) + (up ? 1n : -1n));
  return view.getFloat64(0);
}
// Float trig selects a bounded-denominator candidate only. Exact integer atan
// bounds then certify its angular tolerance; Rust receives the rational map.
function rationalRotation(value, toleranceDegrees = 1e-6) {
  if (!Number.isFinite(value)) refuse('motion/angle-range', 'angle must be finite');
  if (!Number.isFinite(toleranceDegrees) || toleranceDegrees <= 0 || toleranceDegrees > 1) refuse('motion/rotation-tolerance', 'rotationToleranceDegrees must be in (0, 1]');
  const quarterTurns = Math.round(value / 90);
  const residual = value - quarterTurns * 90;
  if (!Number.isSafeInteger(quarterTurns)) refuse('motion/angle-range', 'angle quarter-turn count is outside the safe integer range');
  // At large values a rounded product quarterTurns * 90 can equal the input
  // without being its exact integer value; the dyadic comparison prevents that.
  const targetAngle = dyadic(value);
  if (residual === 0 && targetAngle.n === BigInt(quarterTurns) * 90n * targetAngle.d) return { requestedDegrees: value, realizedDegrees: value, deviationDegrees: 0, toleranceDegrees, angularErrorUpperDegrees: 0, quarterTurns, tanHalfAngle: { numerator: 0, denominator: 1 }, maxDenominator: 1_000_000 };
  const target = Math.abs(Math.tan(residual * Math.PI / 360));
  let x = target, p0 = 0, q0 = 1, p1 = 1, q1 = 0;
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(x), q2 = q0 + a * q1;
    if (!Number.isSafeInteger(a) || q2 > 1_000_000) break;
    [p0, p1] = [p1, p0 + a * p1]; [q0, q1] = [q1, q2];
    const tail = x - a;
    if (tail === 0) break;
    x = 1 / tail;
  }
  const k = Math.floor((1_000_000 - q0) / q1);
  const candidates = [[p1, q1], [p0 + k * p1, q0 + k * q1]].filter(([, q]) => q > 0);
  const sign = Math.sign(residual);
  const realized = ([p, q]) => quarterTurns * 90 + sign * 360 / Math.PI * Math.atan(p / q);
  candidates.sort((a, b) => Math.abs(realized(a) - value) - Math.abs(realized(b) - value));
  const [p, q] = candidates[0], realizedDegrees = realized([p, q]);
  const deviationDegrees = realizedDegrees - value;
  if (!Number.isSafeInteger(p) || !Number.isSafeInteger(q) || q <= 0 || 2 * p > q) refuse('motion/angle-range', 'tan-half-angle candidate is outside the certified series range');
  const error = angularErrorUpper(value, quarterTurns, sign * p, q), tolerance = dyadic(toleranceDegrees);
  if (error.n * tolerance.d > tolerance.n * error.d) refuse('motion/rotation-tolerance-unmet', `${value} degrees: bounded rational candidate deviates by ${deviationDegrees} degrees (tolerance ${toleranceDegrees})`);
  // Convert the actual rational bound, without a fixed angular reporting grid.
  // First scale to [1,2), avoiding overflow of either BigInt conversion.
  const shift = error.d.toString(2).length - error.n.toString(2).length;
  const scaled = shift >= 0 ? { n: error.n << BigInt(shift), d: error.d } : { n: error.n, d: error.d << BigInt(-shift) };
  const bits = 1n << 53n;
  let angularErrorUpperDegrees = Number(ceilDiv(scaled.n * bits, scaled.d)) / Number(bits) * 2 ** (-shift);
  const encloses = v => { const b = dyadic(v); return b.n * error.d >= error.n * b.d; };
  for (let i = 0; i < 4 && !encloses(angularErrorUpperDegrees); i++) angularErrorUpperDegrees = adjacentPositive(angularErrorUpperDegrees, true);
  if (!Number.isFinite(angularErrorUpperDegrees) || !encloses(angularErrorUpperDegrees)) refuse('motion/angle-bound-range', 'certified angular bound is not representable');
  // Tighten only by proved rational comparisons; an exactly representable
  // error may equal the tolerance, including the smallest subnormal.
  for (let i = 0; i < 4; i++) {
    const previous = adjacentPositive(angularErrorUpperDegrees, false);
    if (!encloses(previous)) break;
    angularErrorUpperDegrees = previous;
  }
  if (angularErrorUpperDegrees > toleranceDegrees) refuse('motion/rotation-tolerance-unmet', `${value} degrees: reportable certified bound exceeds tolerance ${toleranceDegrees}`);
  return { requestedDegrees: value, realizedDegrees, deviationDegrees, toleranceDegrees, angularErrorUpperDegrees, quarterTurns, tanHalfAngle: { numerator: sign * p, denominator: q }, maxDenominator: 1_000_000 };
}

function rationalTurn(axis, p, q) {
  // All integers here are <= 2e12, hence transported exactly in binary64.
  const denominator = q * q + p * p, cos = q * q - p * p, sin = 2 * p * q;
  const columns = IDENTITY_ROWS.map(e => {
    const along = axis.reduce((v, a, i) => v + a * e[i], 0);
    const cross = [axis[1]*e[2]-axis[2]*e[1], axis[2]*e[0]-axis[0]*e[2], axis[0]*e[1]-axis[1]*e[0]];
    return e.map((v, i) => axis[i]*along*denominator + cos*(v-axis[i]*along) + sin*cross[i] + 0);
  });
  return { rational: { rows: [0,1,2].map(i => columns.map(c => c[i])), denominator } };
}

// The exact placement steps of one joint at one driver value: [] for the
// identity, or frames the kernel chains exactly. Throws MotionRefusal when the
// value has no exact binary64 placement.
export function jointSteps(joint, value, unit) {
  const scale = LENGTH_UNITS[unit];
  if (joint.type === 'prismatic') {
    const axis = latticeAxis(joint.direction);
    if (!axis) refuse('motion/direction-not-lattice', `${key(joint)}: direction ${JSON.stringify(joint.direction)} is not a signed coordinate axis, so the translation is not an exact binary64 value`);
    if (value === 0) return [];
    const metres = value * scale;
    return [translation(axis.map(c => (c === 0 ? 0 : c * metres)))];
  }
  const axis = latticeAxis(joint.direction);
  if (!axis) refuse('motion/rotation-not-exact', `${key(joint)}: axis ${JSON.stringify(joint.direction)} is not a signed coordinate axis`);
  const realization = rationalRotation(value, joint.rotationToleranceDegrees);
  const k = ((realization.quarterTurns % 4) + 4) % 4;
  const { numerator: p, denominator: q } = realization.tanHalfAngle;
  if (k === 0 && p === 0) return [];
  const [ex, , ez] = quarterTurn(axis, k);
  const hinge = joint.point.map(c => c * scale);
  const steps = [];
  if (hinge.some(c => c !== 0)) steps.push(translation(negate(hinge)));
  if (k !== 0) steps.push({ origin: [0, 0, 0], x: ex, z: ez });
  if (p !== 0) steps.push(rationalTurn(axis, p, q));
  if (hinge.some(c => c !== 0)) steps.push(translation(hinge));
  return steps;
}

// ---------------------------------------------------------------- run

const sha256 = text => createHash('sha256').update(text).digest('hex');

function pairRecord(a, b, verdict) {
  return { a: a.id, b: b.id, aName: a.name ?? null, bName: b.name ?? null, type: verdict.type, kind: verdict.kind,
    volumeMm3: verdict.volumeMm3, volumeBoundMm3: verdict.volumeBoundMm3, distanceMm: verdict.distanceMm, distanceBoundMm: verdict.distanceBoundMm,
    ...(verdict.containment ? { containment: verdict.containment } : {}), ...(verdict.refusal ? { refusal: verdict.refusal } : {}) };
}
const refusedPair = (a, b, code, message) => pairRecord(a, b, { type: null, kind: 'refused', volumeMm3: null, volumeBoundMm3: null,
  distanceMm: null, distanceBoundMm: null, refusal: `${code}: ${message}` });

// Runs the spec on a built Rust model. Returns { report, posed } where
// posed[i] is the pose i body list (a body that could not be placed exactly is
// null), in model.bodies order. Refusals of one pose never abort the others.
export function runMotion(model, rawSpec, { specSha256 = null, specFile = null } = {}) {
  const spec = normalizeMotionSpec(rawSpec);
  if (!model.bodies.length || !model.bodies.every(b => b.geometry === 'rust-wc0-v3')) refuse('motion/backend', 'motion sampling needs a Rust solid body model (WONKY_BACKEND=rust)');
  const kernel = rustModelKernel(model);
  const bodies = model.bodies;
  const mover = new Map();   // body id -> joint
  for (const joint of spec.joints) for (const ref of joint.bodies) {
    const id = resolveBody(model, ref).id;
    if (mover.has(id)) refuse('motion/body-moved-twice', `${key(joint)}: body '${ref}' resolves to already moved body '${id}' (chains are not implemented)`);
    mover.set(id, joint);
  }
  const named = ref => resolveBody(model, ref);
  const wanted = spec.pairs ? spec.pairs.map(([x, y]) => [named(x), named(y)]) : bodies.flatMap((a, i) => bodies.slice(i + 1).map(b => [a, b]));
  const constant = new Map();   // pairs in one rigid motion: the original bodies decide, once

  const poses = [], posed = [];
  for (let index = 0; index < spec.poses; index++) {
    const values = Object.fromEntries(spec.joints.map(j => [j.id, { value: j.samples[index], unit: j.type === 'revolute' ? 'degree' : spec.unit }]));
    const failed = new Map(), placed = new Map();
    for (const joint of spec.joints) {
      let steps = null;
      try {
        steps = jointSteps(joint, joint.samples[index], spec.unit);
        if (joint.type === 'revolute') values[joint.id].rotation = rationalRotation(joint.samples[index], joint.rotationToleranceDegrees);
      }
      catch (e) { if (!(e instanceof MotionRefusal)) throw e; failed.set(joint.id, e); }
      for (const ref of joint.bodies) {
        const body = named(ref);
        if (!steps) continue;
        try { placed.set(body.id, steps.reduce((current, frame) => placeRustBody(kernel, current, frame), body)); }
        catch (e) { if (e?.name !== 'RustCapabilityError') throw e; failed.set(joint.id, new MotionRefusal('motion/placement-refused', e.reason)); }
      }
    }
    const pairs = wanted.map(([a, b]) => {
      const ja = mover.get(a.id), jb = mover.get(b.id);
      for (const joint of [ja, jb]) if (joint && failed.has(joint.id)) return refusedPair(a, b, failed.get(joint.id).code, failed.get(joint.id).message.replace(/^[^:]+: /, ''));
      if (ja === jb) {
        const id = `${a.id}|${b.id}`;
        if (!constant.has(id)) constant.set(id, pairRecord(a, b, clashRustBodies(kernel, a, b)));
        return { ...constant.get(id) };
      }
      return pairRecord(a, b, clashRustBodies(kernel, placed.get(a.id) ?? a, placed.get(b.id) ?? b));
    });
    const count = kind => pairs.filter(p => p.kind === kind).length;
    poses.push({ index, values, exactPlacement: failed.size === 0,
      ...(failed.size ? { refusals: [...failed.values()].map(e => ({ code: e.code, message: e.message })) } : {}),
      pairs, summary: { pairs: pairs.length, interference: count('interference'), abutment: count('abutment'), clear: count('clear'), refused: count('refused') } });
    posed.push(bodies.map(b => failed.has(mover.get(b.id)?.id) ? null : placed.get(b.id) ?? b));
  }

  const steps = spec.joints.map(j => {
    let largest = { step: null, from: null, to: null };
    for (let i = 1; i < j.samples.length; i++) {
      const step = Math.abs(j.samples[i] - j.samples[i - 1]);
      if (largest.step === null || step > largest.step) largest = { step, from: j.samples[i - 1], to: j.samples[i] };
    }
    return { joint: j.id, unit: j.type === 'revolute' ? 'degree' : spec.unit, ...largest };
  });
  const stepText = steps.map(s => `${s.joint} ${s.step === null ? 'single sample' : `${s.step} ${s.unit}`}`).join(', ');
  const total = kind => poses.reduce((n, p) => n + p.summary[kind], 0);
  const evidence = bodies.map(b => ({ id: b.id, name: b.name ?? null, wc0Sha256: rustBodySha256(b) }));
  const report = {
    schema: REPORT_SCHEMA,
    statement: `Sampled at ${poses.length} pose${poses.length === 1 ? '' : 's'}; not continuous collision detection. Largest sample step: ${stepText}. Contact between samples is not checked.`,
    sampling: { poses: poses.length, continuous: false, largestSampleStep: steps },
    model: { source: spec.model.source, feature: spec.model.feature ?? null, bodies: evidence,
      hash: sha256(JSON.stringify(evidence.map(e => [e.id, e.wc0Sha256]))) },
    configuration: { spec: specFile, specSha256, unit: spec.unit, joints: spec.joints.map(j => ({ id: j.id, type: j.type, parent: j.parent, bodies: j.bodies, range: j.range, samples: j.samples, ...(j.type === 'revolute' ? { rotationToleranceDegrees: j.rotationToleranceDegrees } : {}) })) },
    validation: { placement: 'exact rigid maps, chained; coordinate-axis rotations use rational tan(theta/2) with Pythagorean cos/sin, requested and realized angles plus deviation disclosed per pose',
      collision: 'exact Boolean and exact distance per pair (rust-clash.mjs); an undecided pair is refused, never clear',
      contact: 'abutment is exact only for binary64 lengths that meet exactly; decimal mm values are rounded to binary64 as FeatureScript rounds them' },
    poses,
    summary: { poses: poses.length, posesWithRefusal: poses.filter(p => p.summary.refused || !p.exactPlacement).length,
      pairChecks: poses.reduce((n, p) => n + p.pairs.length, 0), interference: total('interference'), abutment: total('abutment'), clear: total('clear'), refused: total('refused') },
    notChecked: ['continuous (swept) collision', 'dynamics', 'closed kinematic chains', 'joint chains'],
  };
  return { report, posed, spec };
}
