// The Rust host port on WONKY_BACKEND=rust (HS1 seam, WC0 wire v3): the
// sketch, extrude and export families of the planar extrusion slice.
//
// Every geometric decision runs in Rust (rust/wonky-ops/src/host.rs) on the
// interpreter's own binary64 values (E9): lengths travel as Quantity.value in
// metres, never through length()/vectorNumbers(), which round to mm
// (src/values.mjs). A body is held as opaque WC0 v3 words that only Rust reads;
// the host keeps names and bookkeeping beside them. What the port does not
// implement refuses by name (host-ops.mjs); nothing falls back to Bend.
import { createHash } from 'node:crypto';
import { tessellateReference, referenceStl, exactCarrierPointRows, ReferenceMeshError } from './reference-mesh.mjs';
import registry from '../../rust/wonky-ops/host-operations.json' with { type: 'json' };
import { FeatureScriptException, NamedRefusal, UnsupportedFeatureError, raise, unsupported } from '../errors.mjs';
import { NativeKernelError } from './errors.mjs';
import { Quantity, Vector, Transform, clone } from '../values.mjs';
import { resolveTopology, RegionQuery, TopologyQuery, isRegionQuery, refuseRegionQuery, regionRefusal, REGION_HINTS } from '../queries.mjs';
import { normalized } from '../brep.mjs';
import { rustBoxBuiltins } from './rust-box.mjs';
import { classifyClash } from './rust-clash.mjs';
import { rustQueryBuiltins } from './rust-query.mjs';
import { rustFilletBuiltins } from './rust-fillet.mjs';
import { rustPlanarBuiltins } from './rust-planarops.mjs';
import { rustChamferBuiltins } from './rust-chamfer.mjs';
import { revolveBuiltins } from './rust-revolve.mjs';
import { rustSphereBuiltins } from './rust-sphere.mjs';
import { commonLoftFrame, exactPlacement, exactRotationSteps } from './rust-placement.mjs';
import { instantiatorBuiltins } from '../modules.mjs';

// Numbers come from the same registry that generates Rust's OP_* constants.
// Keep the protocol header out of opcode uniqueness checks (VERSION is not an op).
export const HOST_OP = Object.freeze({
  MAGIC: registry.protocol.magic, VERSION: registry.protocol.version,
  ...Object.fromEntries(registry.operations.map(({ name, number }) => [name, number])),
});
const STATUS = Object.freeze({ OK: 0, MALFORMED: 1, FAULT: 5, REFUSED: 7 });
// Sketch rule 3 entity tags (wonky_contract::sketch3) and the Bezier cap: at
// most 8 control points, degree 7.
const SKETCH3_TAG = Object.freeze({ line: 1, arc3: 2, circle: 3, bezier: 4, fit: 6 });
const BEZIER_MAX_POINTS = 8;

// A capability the Rust kernel does not have for this input (a crossing
// sketch, a hole, a sloped edge without an exact carrier): named, and like
// every capability error never caught by FeatureScript `try`.
export class RustCapabilityError extends UnsupportedFeatureError {
  constructor(builtin, reason, loc) {
    super(`${builtin}: ${reason} is not implemented on the Rust kernel (WONKY_BACKEND=rust)`, loc);
    this.name = 'RustCapabilityError';
    // Kernel diagnostics may follow a stable refusal code after a colon.
    // Preserve that diagnostic in the message, but keep the CLI code named.
    const code = reason.match(/^([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)+):/)?.[1] ?? reason;
    Object.assign(this, { builtin, reason: code });
  }
}
// A proven geometric failure of the operation itself, as Onshape raises one
// (for example opExtrude of a sketch whose exact incidence graph has no closed
// loop): a FeatureScript exception, so `try` catches it like Onshape's.
export class GeometryRefusal extends FeatureScriptException {
  constructor(builtin, category, message, loc) {
    super(`${builtin}: ${message}`, loc);
    Object.assign(this, { builtin, refusalCategory: category, operationUnderTest: true,
      location: loc ? { line: loc.line, column: loc.column } : null });
  }
}

const ports = new WeakMap();
export function registerRustHost(kernel, backend) {
  const info = backend?.addon?.info?.();
  if (typeof backend?.addon?.hostOp !== 'function' || typeof backend.addon.wireV3Json !== 'function' ||
      !info?.wireVersions?.includes(3) || info.hostOpVersion !== HOST_OP.VERSION) {
    throw new NativeKernelError('BX_ABI', `Rust addon lacks hostOp v${HOST_OP.VERSION} or the WC0 v3 transport`);
  }
  ports.set(kernel, backend);
}
export const rustHostOf = kernel => ports.get(kernel) ?? null;

export function verifyAngleWitness(kernel, angle, loc) {
  const w=angle.angleWitness;
  if (!w) return;
  const addon=rustHostOf(kernel)?.addon;
  if (!addon?.angleWitness) throw new RustCapabilityError('angle','angle/witness-verifier-unavailable',loc);
  const refusal=addon.angleWitness(angle.value,w.kind,w.numerator,w.denominator);
  if (refusal) throw new RustCapabilityError('angle',refusal,loc);
}

// ---------------------------------------------------------------- requests

class Request {
  constructor(op) { this.words = [HOST_OP.MAGIC, HOST_OP.VERSION, op]; }
  u32(x) { if (!Number.isInteger(x) || x < 0 || x > 0xffffffff) throw new NativeKernelError('BX_ARGS', `host op word ${x}`); this.words.push(x); return this; }
  f64(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new NativeKernelError('BX_ARGS', `host op binary64 ${x}`);
    const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x, true);
    this.words.push(view.getUint32(0, true), view.getUint32(4, true)); return this;
  }
  text(s) { const cps = [...s].map(c => c.codePointAt(0)); this.u32(cps.length); this.words.push(...cps); return this; }
  block(words) { this.u32(words.length); for (const w of words) this.words.push(w); return this; }
  segments(list) { this.u32(list.length); for (const s of list) for (const x of s) this.f64(x); return this; }
  circles(list) { this.u32(list.length); for (const c of list) this.f64(c.center[0]).f64(c.center[1]).f64(c.radius); return this; }
  numbers(list) { this.u32(list.length); for (const x of list) this.f64(x); return this; }
  done() { return Uint32Array.from(this.words); }
}
const decodeText = words => { let s = ''; for (const c of words) s += String.fromCodePoint(c); return s; };

function call(kernel, request, builtin, loc) {
  const backend = ports.get(kernel);
  if (!backend) throw new NativeKernelError('BX_ABI', 'no Rust host port is registered for this kernel');
  let reply;
  try { reply = backend.addon.hostOp(request); }
  catch (error) { throw new NativeKernelError(error?.code ?? 'BX_ABI', `hostOp: ${error.message}`, { cause: error }); }
  const status = reply[0], payload = reply.subarray(1);
  if (status === STATUS.OK) return payload;
  const message = decodeText(payload);
  if (status === STATUS.REFUSED) {
    if (builtin === 'opBoolean' && message.startsWith('{')) {
      const report = JSON.parse(message);
      if (report.schema !== 'wonky-carrier-refusal/1') throw new NativeKernelError('BX_WIRE', 'unknown carrier refusal schema');
      const error = new RustCapabilityError(builtin, report.reason, loc);
      error.carrierCoincidence = report;
      throw error;
    }
    // A cuboid with zero extent along an axis is a failed operation in Onshape too
    // (a FeatureScript exception `try` catches), not a missing capability.
    if (builtin === 'fCuboid' && message === 'orthogonal/empty-prism') throw new GeometryRefusal(builtin, 'empty-prism', 'the cuboid has zero or unresolved extent along an axis', loc);
    if (builtin === 'opRevolve' && message.startsWith('revolve/singular-geometry:')) throw new GeometryRefusal(builtin, 'singular-geometry', message, loc);
    throw new RustCapabilityError(builtin, message, loc);
  }
  throw new NativeKernelError(status === STATUS.FAULT ? 'BX_FAULT' : 'BX_WIRE', `hostOp (${builtin}) answered status ${status}: ${message}`);
}

// ---------------------------------------------------------------- bodies

const WORDS = new WeakMap();
const LEGACY_FIELDS = ['vertices', 'edges', 'faces', 'shell'];
// A Rust body: WC0 v3 words (read only by Rust) plus host metadata that
// setProperty writes (name, appearance, description). Its legacy B-rep fields
// refuse by name, so a host path that has not been ported stops explicitly.
export class RustBody {
  constructor(id, words, validation) {
    this.type = 'RustBody'; this.id = id; this.geometry = 'rust-wc0-v3'; this.wireVersion = 3;
    this.validation = validation;
    WORDS.set(this, Uint32Array.from(words));
  }
}
for (const field of LEGACY_FIELDS) {
  Object.defineProperty(RustBody.prototype, field, {
    get() { throw new UnsupportedFeatureError(`the legacy B-rep view (${field}) of a Rust WC0 body is not available; this host path is not ported to WONKY_BACKEND=rust`); },
  });
}
const REFERENCES = new WeakMap();
export class RustReferenceBody extends RustBody {
  constructor(report, source) {
    super(`step/${report.id}`, [], { boundsMm: report.bboxMm });
    this.geometry = 'imported-reference'; this.exactness = 'reference';
    this.name = report.name; this.provenance = report.provenance;
    REFERENCES.set(this, { report: structuredClone(report), source });
  }
}
export const isRustReferenceBody = body => REFERENCES.has(body);
export const referenceBodySource = body => REFERENCES.get(body)?.source;
export const referenceBodyReport = body => {
  const report = structuredClone(REFERENCES.get(body)?.report);
  return report && { ...report, sourceLabel: report.name, name: body.name ?? report.name };
};
export function importStepReferenceBodies(kernel, source) {
  const backend = ports.get(kernel);
  if (!backend?.addon?.referenceStepJson) throw new RustCapabilityError('import', 'import/reference-entrypoint-unavailable');
  try { return JSON.parse(backend.addon.referenceStepJson(source)).map(report => new RustReferenceBody(report, source)); }
  catch (error) { if (error.code === 'BX_CAPABILITY') throw new RustCapabilityError('import', error.message); throw error; }
}
export function requireExactRustBody(body, operation = 'modelling', loc) {
  if (REFERENCES.has(body)) throw new RustCapabilityError(operation, `import/reference-body/${operation}`, loc);
}
export const isRustBody = body => body instanceof RustBody;
export const rustBodyWords = body => {
  requireExactRustBody(body);
  const words = WORDS.get(body);
  if (!words) throw new NativeKernelError('BX_WIRE', 'not a Rust WC0 v3 body');
  return Uint32Array.from(words);
};
// A body or its WC0 words (a stored model record keeps the words, not the body).
export const rustWordsOf = source => source instanceof Uint32Array ? source : rustBodyWords(source);
export const rustBodySha256 = body => createHash('sha256').update(Buffer.from(rustBodyWords(body).buffer)).digest('hex');

// The same native copy boundary serves opPattern and imported Part Studios.
// Keep the original SI binary64 translation; an mm conversion would round it.
export function copyRustBody(kernel, original, id, transform, loc) {
  requireExactRustBody(original, 'pattern', loc);
  if (!isRustBody(original)) throw new RustCapabilityError('instantiate', 'requires a native source solid', loc);
  if (transform !== undefined && (!(transform instanceof Transform) || transform.linear.rows.length !== 3 ||
    transform.linear.rows.some(row => row.length !== 3 || row.some(v => typeof v !== 'number' || !Number.isFinite(v))))) {
    raise('Solid copy expects a finite 3D transform', loc);
  }
  const frame = transform && exactPlacement(transform);
  const steps = transform && exactRotationSteps(transform);
  const local = steps?.length === 1 && steps[0].localTurns !== undefined ? steps[0] : null;
  const frames = local ? [] : steps ?? (frame ? [frame] : null);
  // toWorld owns exact X/Z construction axes, not its rounded matrix cache.
  // Rekey by an identity copy, then use the same frame transport as opTransform.
  const rows = !frames && transform ? transform.linear.rows : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const offset = !frames && transform ? point3(transform.translation, 'transform translation', loc) : [0, 0, 0];
  const request = new Request(HOST_OP.PATTERN).block(rustBodyWords(original));
  for (const w of bodyKey(id)) request.u32(w);
  request.u32(0);
  for (const value of rows.flat()) request.f64(value);
  for (const value of offset) request.f64(value);
  if (local) {
    for (const value of [...local.origin, ...local.x, ...local.z]) request.f64(value);
    request.u32(local.localTurns);
  }
  let words = call(kernel, request.done(), 'opPattern', loc);
  for (const frame of frames ?? []) {
    const placement = new Request(HOST_OP.PLACEMENT).block(words);
    for (const value of [...frame.origin, ...frame.x, ...frame.z]) placement.f64(value);
    words = call(kernel, placement.done(), 'opPattern', loc);
  }
  const copy = new RustBody(id, words, null);
  const m = measureRustBody(kernel, copy);
  copy.validation = { ...original.validation, volumeMm3: m.volumeMm3, areaMm2: m.areaMm2, toleranceMm: m.toleranceMm, boundsMm: m.bboxMm };
  for (const key of ['name', 'description', 'appearance', 'provenance']) if (original[key] !== undefined) copy[key] = clone(original[key]);
  return copy;
}

export function describeRustBody(kernel, body) {
  const backend = ports.get(kernel);
  if (!backend) throw new NativeKernelError('BX_ABI', 'no Rust host port is registered for this kernel');
  return JSON.parse(backend.addon.wireV3Json(rustBodyWords(body)));
}

// General measurements of one body (Rust wonky-ops::polyhedron): volume, area,
// bbox (world and, optionally, after an affine map given as data), topology,
// probe distances with an exact inside test. `map`: 3 rows of 4 numbers.
export function measureRustBody(kernel, body, { map = null, probes = [], surfaceTypes = false } = {}) {
  if (REFERENCES.has(body)) {
    if (map || probes.length || surfaceTypes) throw new RustCapabilityError('measure', 'import/reference-measurement-unavailable');
    const report = referenceBodyReport(body);
    return { ...report, validity: { closed: null }, boundToConstruction: false };
  }
  const request = new Request(HOST_OP.MEASURE).block(rustWordsOf(body));
  if (map) { request.u32(1); for (const row of map) for (const x of row) request.f64(x); } else request.u32(0);
  request.u32(probes.length); for (const p of probes) for (const x of p) request.f64(x);
  if (surfaceTypes) request.u32(1);
  const measured = JSON.parse(decodeText(call(kernel, request.done(), 'measure')));
  if (measured.regularization && !(body instanceof Uint32Array)) {
    body.regularization = measured.regularization;
    if (!measured.regularization.exact) body.exactness = 'regularized';
  }
  return measured;
}

// Native edge IDs, not a legacy B-rep projection. The tie length is exactly
// the FS zeroLength binary64 in metres; point3 never passes through mm rounding.
export function closestRustEdges(kernel, rows, point, loc) {
  if (rows.some(r => r.kind !== 'edge' || !isRustBody(r.record.body))) {
    throw new RustCapabilityError('qClosestTo', 'requires only Rust edges', loc);
  }
  const request = new Request(HOST_OP.CLOSEST_EDGES);
  for (const v of point3(point, 'qClosestTo point', loc)) request.f64(v);
  request.f64(1e-8).u32(rows.length);
  for (const row of rows) request.block(rustBodyWords(row.record.body)).u32(row.index);
  return [...call(kernel, request.done(), 'qClosestTo', loc)].map(i => rows[i]);
}

// A separate certified enclosure, never the rounded bboxMm measurement.
export function certifiedBoundsRustBody(kernel, body) {
  if (REFERENCES.has(body)) throw new RustCapabilityError('measure', 'import/reference-occupied-set-unproved');
  const request = new Request(HOST_OP.CERTIFIED_BOUNDS).block(rustWordsOf(body));
  return JSON.parse(decodeText(call(kernel, request.done(), 'interferenceBounds')));
}

export function distanceRustBodies(kernel, a, b) {
  const request = new Request(HOST_OP.DISTANCE).block(rustBodyWords(a)).block(rustBodyWords(b));
  return JSON.parse(decodeText(call(kernel, request.done(), 'evDistance')));
}
// One exact Boolean of whole bodies as a pure query: no engine, no record
// updates. Returns the result bodies' WC0 words; refusals throw by name.
function booleanRustBodies(kernel, op, bodies) {
  for (const body of bodies) requireExactRustBody(body, 'boolean');
  const request = new Request(HOST_OP.BOOLEAN);
  for (const w of bodyKey('clash-query')) request.u32(w);
  request.u32(op).u32(bodies.length);
  for (const b of bodies) request.block(rustBodyWords(b));
  const reply = call(kernel, request.done(), 'opBoolean');
  const out = []; let at = 1;
  for (let i = 0; i < reply[0]; i++) { const n = reply[at++]; out.push(reply.slice(at, at + n)); at += n; }
  return out;
}

// Exact clash class of two Rust solids (rust-clash.mjs): interference with its
// exact-Boolean volume, containment, abutment, clear with the certified
// distance, or a named refusal. Never a default "clear".
export function prepareInterferenceRustBody(kernel, body) {
  call(kernel, new Request(HOST_OP.PAIR_PREPARE).block(rustBodyWords(body)).done(), 'interferencePrepare');
}

export function clashRustBodies(kernel, a, b, { certify = false } = {}) {
  return classifyClash({
    certify: certify ? (x, y) => {
      const request = new Request(HOST_OP.PAIR_PROOF).block(rustBodyWords(x)).block(rustBodyWords(y));
      return JSON.parse(decodeText(call(kernel, request.done(), 'interferenceProof')));
    } : null,
    intersect: (x, y) => booleanRustBodies(kernel, 2, [x, y]),
    subtract: (x, y) => booleanRustBodies(kernel, 1, [x, y]),
    distance: (x, y) => distanceRustBodies(kernel, x, y),
    volume: words => { const m = measureRustBody(kernel, new RustBody('clash-volume', words, null)); return { volumeMm3: m.volumeMm3, relBound: m.volumeRelBound }; },
  }, a, b);
}

// One exact rigid placement of a whole Rust body (host op OP_PLACEMENT): the
// same map opTransform applies, on binary64 frame values in metres
// (`origin`, unit `x` and `z`; y = z cross x). The kernel refuses a frame that
// is not orthonormal (non-rigid-placement) and composes chained placements
// exactly, so callers chain steps instead of composing frames in binary64.
// Name and appearance carry over; the result has no measured validation.
export function placeRustBody(kernel, body, frame) {
  requireExactRustBody(body, 'transform');
  const request = new Request(frame.rational ? HOST_OP.RATIONAL_PLACEMENT : HOST_OP.RIGID_PLACEMENT).block(rustWordsOf(body));
  for (const v of (frame.rational ? [...frame.rational.rows.flat(), frame.rational.denominator] : [...frame.origin, ...frame.x, ...frame.z])) request.f64(v);
  const placed = new RustBody(body.id, call(kernel, request.done(), 'placement'), null);
  for (const key of ['name', 'description', 'appearance']) if (body[key] !== undefined) placed[key] = body[key];
  return placed;
}

// Extents in the body's construction frame, subtracting exact source values
// before world placement or unit conversion. Not a world bbox subtraction.
export function sourceExtentsRustBody(kernel, body) {
  return JSON.parse(decodeText(call(kernel, new Request(HOST_OP.EXTENTS).block(rustBodyWords(body)).done(), 'evBox3d')));
}

export function rustStep(kernel, bodies, name) {
  const request = new Request(HOST_OP.STEP).text(name).u32(bodies.length);
  for (const body of bodies) request.text(String(body.id)).block(rustBodyWords(body));
  return decodeText(call(kernel, request.done(), 'export'));
}

// Binary STL is constructed in Rust. The response packs four little-endian
// bytes per transport word, prefixed by the unpadded byte length.
export function rustStl(kernel, bodies, deviationMm = 0.02) {
  if (bodies.some(isRustReferenceBody)) {
    try { return referenceStl(rustMesh(kernel, bodies, deviationMm).bodies, deviationMm); }
    catch (error) { if (error instanceof ReferenceMeshError) throw new RustCapabilityError('export/stl', error.reason); throw error; }
  }

  const request = new Request(HOST_OP.STL).f64(deviationMm).u32(bodies.length);
  for (const body of bodies) request.block(rustBodyWords(body));
  const reply = call(kernel, request.done(), 'export/stl');
  const length = reply[0];
  if (!Number.isInteger(length) || length < 84 || reply.length !== 1 + Math.ceil(length / 4)) {
    throw new NativeKernelError('BX_WIRE', 'invalid binary STL response');
  }
  const bytes = Buffer.alloc((reply.length - 1) * 4);
  for (let i = 1; i < reply.length; i++) bytes.writeUInt32LE(reply[i], (i - 1) * 4);
  return bytes.subarray(0, length);
}

// The tessellation the STL is written from (wonky-mesh/1), before f32
// quantisation: world millimetres, the WC0 face id of every triangle (`faces`
// is empty when the producer cannot attribute them) and one sampled polyline
// per WC0 edge. `deviationMm` is the stated chordal deviation of the mesh.
export function referenceDisplaySource(kernel, body, deviationMm = 0.02) {
  const data = REFERENCES.get(body);
  if (!data) throw new RustCapabilityError('mesh', 'import/mesh/not-reference');
  data.displaySources ??= new Map();
  if (!data.displaySources.has(deviationMm)) {
    let sources;
    try { sources = JSON.parse(ports.get(kernel).addon.referenceDisplayJson(data.source, deviationMm)); }
    catch (error) { if (error.code === 'BX_CAPABILITY') throw new RustCapabilityError('mesh', error.message); throw error; }
    const source = sources.find(s => s.id === data.report.id);
    if (!source) throw new RustCapabilityError('mesh', 'import/mesh/body-missing');
    data.displaySources.set(deviationMm, source);
  }
  return structuredClone(data.displaySources.get(deviationMm));
}

export function referenceChartLegalizer(kernel) {
  return (points,triangles,constraints,metric) => {
    const rows=[`metric ${metric.join(' ')}`,...points.map(p=>`p ${p.join(' ')}`),...triangles.map(t=>`t ${t.join(' ')}`),...constraints.map(e=>`e ${e.join(' ')}`)].join('\n');
    return JSON.parse(ports.get(kernel).addon.referenceLegalizeRows(rows));
  };
}

export function rustMesh(kernel, bodies, deviationMm = 0.02) {
  if (bodies.some(isRustReferenceBody)) {
    return { schema: 'wonky-mesh/1', exact: false, approximation: 'tessellated mesh', deviationMm,
      bodies: bodies.map(body => {
        if (!isRustReferenceBody(body)) return rustMesh(kernel, [body], deviationMm).bodies[0];
        try {
          const data = REFERENCES.get(body);
          data.meshes ??= new Map();
          if (!data.meshes.has(deviationMm)) {
            const source = referenceDisplaySource(kernel, body, deviationMm);
            const mesh = tessellateReference(source, deviationMm, referenceChartLegalizer(kernel));
            mesh.uncertainty = structuredClone(data.report.uncertainty);
            const check = JSON.parse(ports.get(kernel).addon.referenceCheckPoints(data.source, exactCarrierPointRows(source, mesh), deviationMm / 4));
            Object.assign(mesh.validation, {exactCarrierChecks:check.exactCarrierChecks,exactCarrierCheckDeviationMm:check.deviationMm});
            mesh.maximumDeviationBoundMm = mesh.maximumInterpolationBoundMm + deviationMm / 4 + deviationMm / 32 + deviationMm / 32 + mesh.maximumArithmeticErrorBoundMm;
            if (mesh.maximumDeviationBoundMm > deviationMm) throw new ReferenceMeshError('import/mesh/total-deviation-budget');
            data.meshes.set(deviationMm, mesh);
          }
          return structuredClone(data.meshes.get(deviationMm));
        } catch (error) {
          if (error instanceof ReferenceMeshError || error.code === 'BX_CAPABILITY') throw new RustCapabilityError('mesh', error.reason ?? error.message);
          throw error;
        }
      }) };
  }

  const request = new Request(HOST_OP.MESH).f64(deviationMm).u32(bodies.length);
  for (const body of bodies) request.block(rustWordsOf(body));
  const mesh = JSON.parse(decodeText(call(kernel, request.done(), 'mesh')));
  if (mesh.schema !== 'wonky-mesh/1' || mesh.bodies.length !== bodies.length) throw new NativeKernelError('BX_WIRE', 'invalid wonky-mesh/1 response');
  return mesh;
}

// World-space analytic carriers (wonky-carriers/1) per WC0 face and edge, in
// millimetres after the exact frame composition. An entry the host cannot
// state exactly carries `refused: "carriers/<reason>"` instead of a value.
export function rustCarriers(kernel, bodies) {
  const request = new Request(HOST_OP.CARRIERS).u32(bodies.length);
  for (const body of bodies) request.block(rustWordsOf(body));
  const out = JSON.parse(decodeText(call(kernel, request.done(), 'carriers')));
  if (out.schema !== 'wonky-carriers/1' || out.bodies.length !== bodies.length) throw new NativeKernelError('BX_WIRE', 'invalid wonky-carriers/1 response');
  return out.bodies;
}

// ---------------------------------------------------------------- builtins

const metres = (quantity, what, loc) => {
  if (!(quantity instanceof Quantity) || quantity.dimension !== 1 || quantity.angle !== 0) raise(`${what} must be a length with units (for example 10 * millimeter)`, loc);
  if (!Number.isFinite(quantity.value)) raise(`${what} is not finite`, loc);
  return quantity.value;
};
const point2 = (value, what, loc) => {
  if (!(value instanceof Vector) || value.items.length !== 2) raise(`${what} must be a 2D length Vector`, loc);
  return value.items.map(q => metres(q, what, loc));
};
const point3 = (value, what, loc) => {
  if (!(value instanceof Vector) || value.items.length !== 3) raise(`${what} must be a 3D length Vector`, loc);
  return value.items.map(q => metres(q, what, loc));
};
const direction3 = (value, what, loc) => {
  if (!(value instanceof Vector) || value.items.length !== 3 || !value.items.every(x => typeof x === 'number' && Number.isFinite(x))) raise(`${what} must be a 3D unitless Vector`, loc);
  return value.items;
};
const bodyKey = id => {
  const digest = createHash('sha256').update(id).digest();
  return [0, 4, 8, 12].map(k => digest.readUInt32LE(k));
};

// Implementations of the routed builtins. `h` supplies the host's own sketch
// bookkeeping (the Sketch and Query classes, fieldMap, checkType), so
// snapshots, records and queries keep working unchanged.
export function rustHostBuiltins(engine, h) {
  const kernel = engine.kernel;
  const segmentSketch = (sketch, loc) => {
    engine.sketch(sketch, loc, true);
    if (!sketch.rust) unsupported('This sketch was not created by the Rust port', loc);
    return sketch.rust;
  };
  const addSegments = (sketch, id, segments, loc) => {
    if (typeof id !== 'string' || !id || sketch.entityIds.has(id)) raise('Sketch entity ID must be nonempty and unique', loc);
    sketch.entityIds.add(id);
    for (const s of segments) { sketch.rust.segments.push({ id, s }); sketch.rust.curves.push({ id, tag: 'line', data: s }); }
  };
  // sketch.rust.curves: every entity in call order as a sketch rule 3 entity
  // (wonky_contract::sketch3), beside the per-family lists the line, arc and
  // circle paths read. Once a sketch holds a spline, the curve path (one
  // closed chain, rust/wonky-ops/src/curve_profile.rs) takes the whole list.
  const splineSketch = sketch => sketch.rust.curves.some(c => c.tag === 'bezier' || c.tag === 'fit');
  const sketch3 = sketch => [0, ...sketch.rust.curves.flatMap(({ tag, data }) =>
    tag === 'bezier' ? [SKETCH3_TAG.bezier, data.length / 2, ...data] : [SKETCH3_TAG[tag], ...data])];
  const noConstruction = (d, loc, name) => {
    if ((d.construction !== undefined && d.construction !== false) || (d.constrained !== undefined && d.constrained !== false)) {
      throw new RustCapabilityError(name, 'construction geometry or sketch constraints', loc);
    }
  };
  // Regions of closed chains and full circles from the one exact arrangement
  // (wonky-curve, work budget). Numbering is the arrangement's, not the loose
  // edge solver's, so everything that indexes regions asks `arrangement`.
  const arrangementRegions = (sketch, builtin, loc) => {
    const { segments, arcs, circles } = sketch.rust;
    const request = new Request(HOST_OP.SKETCH_REGION).segments(segments.map(x => x.s)).segments(arcs.map(a => a.s)).circles(circles);
    return { ...JSON.parse(decodeText(call(kernel, request.done(), builtin, loc))), arrangement: true };
  };
  // The loose-edge solvers still decide every sketch they accept. A sketch they
  // refuse is tried on the arrangement; when that refuses too (or the sketch is
  // not made of closed chains) the original refusal stands.
  const regions = (sketch, loc, builtin) => {
    if (splineSketch(sketch)) {
      return JSON.parse(decodeText(call(kernel, new Request(HOST_OP.CURVE_REGION).numbers(sketch3(sketch)).done(), builtin, loc)));
    }
    const { arcs, circles } = sketch.rust;
    if (engine.modelingPolicy.curvedContacts === 'tolerated-regularized') return looseRegions(sketch, loc, builtin);
    const arrangeFirst = arcs.length > 0 && circles.length > 0 || circles.length > 1;
    let legacy = null;
    try { return looseRegions(sketch, loc, builtin); } catch (error) {
      if (!(error instanceof RustCapabilityError)) throw error;
      legacy = error;
    }
    try { return { ...arrangementRegions(sketch, builtin, loc), legacyRefusal: legacy.reason }; } catch (error) {
      if (!(error instanceof RustCapabilityError)) throw error;
      if (!arrangeFirst || error.reason.startsWith('sketch-regions/not-closed-chains')) throw legacy;
      throw error;
    }
  };
  const looseRegions = (sketch, loc, builtin) => {
    if (sketch.rust.arcs.length) {
      if (sketch.rust.circles.length) throw new RustCapabilityError(builtin, 'arc-profile/full-circle-arrangement', loc);
      const request = new Request(HOST_OP.ARC_REGION).segments(sketch.rust.segments.map(s => s.s)).segments(sketch.rust.arcs.map(a => a.s));
      if (engine.modelingPolicy.curvedContacts === 'tolerated-regularized') request.f64(engine.modelingPolicy.contactCapMm);
      return JSON.parse(decodeText(call(kernel, request.done(), builtin, loc)));
    }
    if (sketch.rust.circles.length) {
      if (sketch.rust.circles.length !== 1) throw new RustCapabilityError(builtin, 'sketch/multiple-circle-arrangement', loc);
      const c = sketch.rust.circles[0], mixed = sketch.rust.segments.length > 0;
      const request = new Request(mixed ? HOST_OP.PROFILE_REGION : HOST_OP.CIRCLE_REGION).f64(c.center[0]).f64(c.center[1]).f64(c.radius);
      if (mixed) request.segments(sketch.rust.segments.map(s => s.s));
      return JSON.parse(decodeText(call(kernel, request.done(), builtin, loc)));
    }

    const request = new Request(HOST_OP.REGION).segments(sketch.rust.segments.map(x => x.s)).done();
    return JSON.parse(decodeText(call(kernel, request, builtin, loc)));
  };
  // std query.fs qContainsPoint / qClosestTo over qSketchRegion: a lazy
  // selection among the regions of the subquery. Rust decides it exactly when
  // the opExtrude that consumes it runs (evaluateRegions), in that extrusion's
  // frame.
  const REGION_PICK = { qContainsPoint: 0, qClosestTo: 1 };
  const pickRegions = (builtin, [query, point], loc) => {
    point3(point, `${builtin} point`, loc);
    return new RegionQuery('pick', { builtin, query, point, loc,
      refuse: at => { throw new RustCapabilityError(builtin, 'sketch-region/point-selection-outside-extrude', at); } });
  };
  const uniqueRegions = items => [...new Map(items.map(item => [`${item.sketch.id.key()}:${item.index}`, item])).values()];
  const regionKey = item => `${item.sketch.id.key()}:${item.index}`;
  // The regions a region query names, in std order (qUnion keeps subquery
  // precedence order, qIntersection and qSubtraction the first operand's), as
  // { sketch, index } with index numbering the regions as OP_PRISM and the
  // profile ops do. A sketch-region query is a set: no region twice.
  const evaluateRegions = (query, loc) => {
    if (query instanceof h.Query) {
      const sketch = engine.resolve(query, loc);
      if (!sketch.rust?.regions) unsupported('opExtrude on the Rust kernel needs a sketch built by the Rust port', loc);
      const all = sketch.rust.regions.loops.map((_, index) => ({ sketch, index }));
      // Arrangement regions: filterInnerLoops drops the islands inside holes. A hole
      // holding more than islands of its own (two overlapping bores, a gap between
      // circles) has no decided filter: refuse rather than guess which cells drop.
      if (sketch.rust.regions.arrangement) {
        if (!query.filterInnerLoops) return all;
        if (sketch.rust.regions.loops.some(loop => loop.contested)) throw new RustCapabilityError('qSketchRegion', 'sketch-region/composite-hole-filter', loc);
        return all.filter(item => !sketch.rust.regions.loops[item.index].inner);
      }
      // circle-with-profile arrangements: filterInnerLoops keeps the outer region.
      const mixed = sketch.rust.circles.length > 0 && sketch.rust.segments.length > 0;
      return all.slice(0, mixed && query.filterInnerLoops ? 1 : undefined);
    }
    if (!(query instanceof RegionQuery)) {
      if (query instanceof TopologyQuery && query.kind === 'union' && query.queries.every(q => evaluateRegions(q, loc).length === 0)) return [];
      return regionRefusal('opExtrude', 'sketch-region/topology-query-not-extrudable', 'only sketch regions are implemented here, not a topology query', REGION_HINTS.topology, loc);
    }
    switch (query.kind) {
      case 'nothing': return [];
      case 'union': return uniqueRegions(query.queries.flatMap(q => evaluateRegions(q, loc)));
      case 'intersection': {
        const [first, ...rest] = query.queries.map(q => evaluateRegions(q, loc));
        const keep = rest.map(items => new Set(items.map(regionKey)));
        return (first ?? []).filter(item => keep.every(set => set.has(regionKey(item))));
      }
      case 'subtract': {
        const remove = new Set(evaluateRegions(query.b, loc).map(regionKey));
        return evaluateRegions(query.a, loc).filter(item => !remove.has(regionKey(item)));
      }
      case 'ref': {
        const sketch = engine.resolve(query.leaf, loc);
        if (!sketch.rust?.regions || query.index >= sketch.rust.regions.loops.length) raise('the region query refers to a region that no longer exists', loc);
        return [{ sketch, index: query.index }];
      }
      case 'nth': {
        const items = evaluateRegions(query.query, query.loc ?? loc), { n } = query;
        if (n >= items.length || n < -items.length) {
          return regionRefusal('qNthElement', 'sketch-region/nth-element-out-of-range', `index ${n} is outside the ${items.length} regions of the subquery`,
            'Onshape does not document the result of an out-of-range qNthElement; use an index inside the query (negative counts from the end).', query.loc ?? loc);
        }
        if (items.length > 1) {
          return regionRefusal('qNthElement', 'sketch-region/nth-element-order-unspecified', `the subquery has ${items.length} regions and Onshape's qNthElement order is deterministic but arbitrary`,
            'Narrow the subquery to one region first (qContainsPoint or qClosestTo with a point inside it), then take element 0.', query.loc ?? loc);
        }
        return items;
      }
      case 'pick': {
        const { builtin, point, loc: at } = query;
        const items = evaluateRegions(query.query, at);
        if (!items.length) return [];
        const sketch = items[0].sketch;
        if (items.some(item => item.sketch !== sketch)) {
          return regionRefusal(builtin, 'sketch-region/multi-sketch-point-selection', `${builtin} over regions of several sketches`,
            'Select from the regions of one sketch: qSketchRegion(oneSketchId).', at);
        }
        // Spline sketches (skBezier) have no region picking yet: refuse by name instead of picking on their chords.
        if (splineSketch(sketch)) throw new RustCapabilityError(builtin, 'sketch-region/curved-profile-point-selection', at);
        const frame = [...point3(sketch.plane.origin, 'sketch plane origin', at), ...direction3(sketch.plane.x, 'sketch plane x', at),
          ...direction3(sketch.plane.normal, 'sketch plane normal', at), ...point3(point, `${builtin} point`, at)];
        // Arrangement regions (any sketch with arcs, circles or crossing chains) are numbered
        // by the arrangement and decided on it; loose line sketches keep the line-only solver.
        const arranged = sketch.rust.regions.arrangement === true || sketch.rust.circles.length > 0 || sketch.rust.arcs.length > 0;
        if (arranged && !sketch.rust.regions.arrangement) throw new RustCapabilityError(builtin, 'sketch-region/point-selection-legacy-numbering', at);
        // TOLERANCE.zeroLength in metres: the containment and tie band of std.
        const request = new Request(arranged ? HOST_OP.SKETCH_PICK : HOST_OP.REGION_PICK).u32(REGION_PICK[builtin]);
        for (const v of frame) request.f64(v);
        request.f64(1e-8).segments(sketch.rust.segments.map(x => x.s));
        if (arranged) request.segments(sketch.rust.arcs.map(a => a.s)).circles(sketch.rust.circles);
        request.u32(items.length);
        for (const item of items) request.u32(item.index);
        const chosen = new Set(call(kernel, request.done(), builtin, at));
        return items.filter(item => chosen.has(item.index));
      }
      default: throw new TypeError(`unknown region query kind ${query.kind}`);
    }
  };
  // The one sketch a region evaluation refers to (the sketch of its first
  // leaf when it selected nothing), or undefined when it has no leaf at all.
  const leafSketch = query => {
    if (query instanceof h.Query) return engine.resolve(query, null);
    if (query instanceof RegionQuery) {
      if (query.kind === 'ref') return engine.resolve(query.leaf, null);
      for (const sub of query.queries ?? [query.query, query.a].filter(Boolean)) { const found = leafSketch(sub); if (found) return found; }
    }
    return undefined;
  };
  const fillet = rustFilletBuiltins(engine, h, { Request, OP: HOST_OP, call, metres, point3, RustBody, words: body => { requireExactRustBody(body, 'fillet'); return rustBodyWords(body); }, measure: measureRustBody, RustCapabilityError });
  return {
    ...rustSphereBuiltins(engine, h, { Request, OP: HOST_OP, call, bodyKey, point3, metres, RustBody, measure: measureRustBody }),
    ...rustPlanarBuiltins(engine, h, { Request, OP: HOST_OP, call, metres, RustBody, words: rustBodyWords, measure: measureRustBody, RustCapabilityError }),
    ...rustChamferBuiltins(engine, h, { Request, OP: HOST_OP, call, metres, RustBody, words: body => { requireExactRustBody(body, 'chamfer'); return rustBodyWords(body); }, measure: measureRustBody, RustCapabilityError }),
    ...fillet,
    qClosestTo: (args, loc) => isRegionQuery(args[0]) ? pickRegions('qClosestTo', args, loc) : fillet.qClosestTo(args, loc),
    qContainsPoint: (args, loc) => isRegionQuery(args[0]) ? pickRegions('qContainsPoint', args, loc) : h.refusal('qContainsPoint')(args, loc),
    makeRobustQuery: (args, loc) => isRegionQuery(args[1]) ? refuseRegionQuery('makeRobustQuery', loc) : h.refusal('makeRobustQuery')(args, loc),
    ...rustBoxBuiltins(engine, h, { Request, OP: HOST_OP, call, bodyKey, point3, metres, RustBody, requireExact: requireExactRustBody, words: rustBodyWords,
      measure: measureRustBody, GeometryRefusal, RustCapabilityError, distance: distanceRustBodies, clash: clashRustBodies }),
    ...(() => {
      const query = rustQueryBuiltins(engine, { Request, OP: HOST_OP, call, words: rustBodyWords, RustBody, RustCapabilityError, point3, direction3, closestEdges: closestRustEdges, fieldMap: h.fieldMap });
      return { ...query,
        // evaluateQuery of a region query: one transient query per region.
        evaluateQuery: (args, loc) => isRegionQuery(args[1]) ? (args[0] !== engine.context ? raise('Invalid modeling context', loc)
          : evaluateRegions(args[1], loc).map(({ sketch, index }) => new RegionQuery('ref', { leaf: new h.Query(sketch.id), index }))) : query.evaluateQuery(args, loc) };
    })(),
    ...revolveBuiltins(engine, h, { Request, HOST_OP, call, segmentSketch, noConstruction, point2, point3, direction3, metres,
      bodyKey, RustBody, RustCapabilityError, measureRustBody, raise, Quantity, resolveTopology, splineSketch }),
    instantiate: instantiatorBuiltins(engine).instantiate.call,
    opPattern: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['entities', 'transforms', 'instanceNames'], [], loc);
      if (!Array.isArray(d.transforms) || !Array.isArray(d.instanceNames) || d.transforms.length !== d.instanceNames.length ||
          d.instanceNames.some(n => typeof n !== 'string' || !n) || new Set(d.instanceNames).size !== d.instanceNames.length) {
        raise('opPattern requires matching transforms and unique nonempty instanceNames', loc);
      }
      engine.claim(context, id, loc);
      const source = resolveTopology(engine, d.entities, loc);
      if (!source.length || source.some(row => row.kind !== 'body' || row.record.kind !== 'solid' || !isRustBody(row.record.body))) {
        throw new RustCapabilityError('opPattern', 'only nonempty solid-body selections are supported', loc);
      }
      // Build the entire operation before publishing any copy (atomic failure).
      const copies = d.transforms.flatMap((t, i) => {
        if (!(t instanceof Transform) || t.linear.rows.length !== 3 || t.linear.rows.some(row => row.length !== 3 || row.some(v => typeof v !== 'number' || !Number.isFinite(v)))) raise('opPattern expects finite 3D transforms', loc);
        return source.map(row => {
          const original = row.record.body;
          return copyRustBody(kernel, original, `${id}/${d.instanceNames[i]}/${original.id}`, t, loc);
        });
      });
      copies.forEach(body => engine.addSolid(id, body));
    },
    newSketchOnPlane: ([context, id, definition], loc) => {
      const { sketchPlane } = h.fieldMap(definition, ['sketchPlane'], [], loc);
      h.checkType(sketchPlane, 'Plane', loc); engine.claim(context, id, loc);
      const sketch = new h.Sketch(id, sketchPlane);
      sketch.rust = { segments: [], circles: [], arcs: [], curves: [] };
      engine.sketches.set(id.key(), sketch);
      return sketch;
    },
    skArc: ([sketch, id, definition], loc) => {
      segmentSketch(sketch, loc);
      const d = h.fieldMap(definition, ['start', 'mid', 'end'], ['construction'], loc);
      noConstruction(d, loc, 'skArc');
      if (typeof id !== 'string' || !id || sketch.entityIds.has(id)) raise('Sketch entity ID must be nonempty and unique', loc);
      const s = [...point2(d.start, 'start', loc), ...point2(d.mid, 'mid', loc), ...point2(d.end, 'end', loc)];
      sketch.entityIds.add(id); sketch.rust.arcs.push({ id, s }); sketch.rust.curves.push({ id, tag: 'arc3', data: s });
    },
    // std sketch.fs skBezier: `points` are the CONTROL points (size > 1) of one
    // Bezier curve of degree size - 1, never points it passes through. WC0
    // carries degree <= 7 (wonky_contract::sketch3::MAX_DEGREE); above that the
    // entity refuses by name.
    skBezier: ([sketch, id, definition], loc) => {
      segmentSketch(sketch, loc);
      const d = h.fieldMap(definition, ['points'], ['construction'], loc);
      noConstruction(d, loc, 'skBezier');
      if (typeof id !== 'string' || !id || sketch.entityIds.has(id)) raise('Sketch entity ID must be nonempty and unique', loc);
      if (!Array.isArray(d.points) || d.points.length < 2) raise('skBezier needs an array of at least two points', loc);
      const data = d.points.flatMap(p => point2(p, 'points', loc));
      if (d.points.length > BEZIER_MAX_POINTS) throw new RustCapabilityError('skBezier', 'sketch/bezier-degree-cap', loc);
      sketch.entityIds.add(id); sketch.rust.curves.push({ id, tag: 'bezier', data });
    },
    skFitSpline: ([sketch, id, definition], loc) => {
      segmentSketch(sketch, loc);
      const d = h.fieldMap(definition, ['points'], ['construction', 'parameters', 'startDerivative', 'endDerivative'], loc);
      noConstruction(d, loc, 'skFitSpline');
      if (typeof id !== 'string' || !id || sketch.entityIds.has(id)) raise('Sketch entity ID must be nonempty and unique', loc);
      if (!Array.isArray(d.points) || d.points.length < 2) raise('skFitSpline needs at least two points', loc);
      if (d.points.length > 64) throw new RustCapabilityError('skFitSpline', 'curve2/fit-budget', loc);
      const points = d.points.map(p => point2(p, 'points', loc));
      const first = points[0], last = points.at(-1);
      if (first.every((x, i) => x === last[i])) throw new RustCapabilityError('skFitSpline', 'curve2/closed-fit-spline', loc);
      if (points.slice(1).some((p, i) => p.every((x, j) => x === points[i][j]))) throw new RustCapabilityError('skFitSpline', 'curve2/degenerate-span', loc);
      const parameters = d.parameters ?? h.fitSplineParameters(points);
      if (d.parameters === undefined && !parameters.every(Number.isFinite)) throw new RustCapabilityError('skFitSpline', 'curve2/fit-budget', loc);
      if (!Array.isArray(parameters) || parameters.length !== points.length || !parameters.every(x => typeof x === 'number' && Number.isFinite(x))) raise('skFitSpline parameters must be finite numbers, one per point', loc);
      if (parameters.slice(1).some((x, i) => x <= parameters[i])) throw new RustCapabilityError('skFitSpline', 'curve2/degenerate-span', loc);
      const derivative = value => value === undefined ? [0] : [1, ...point2(value, 'derivative', loc)];
      const data = [points.length, ...points.flat(), 1, ...parameters, ...derivative(d.startDerivative), ...derivative(d.endDerivative), 0, 1];
      sketch.entityIds.add(id); sketch.rust.curves.push({ id, tag: 'fit', data });
    },
    skLineSegment: ([sketch, id, definition], loc) => {
      segmentSketch(sketch, loc);
      const d = h.fieldMap(definition, ['start', 'end'], ['construction'], loc);
      noConstruction(d, loc, 'skLineSegment');
      addSegments(sketch, id, [[...point2(d.start, 'start', loc), ...point2(d.end, 'end', loc)]], loc);
    },
    // skPolyline: one segment between consecutive points; a repeated first
    // point closes it (an open polyline is legal and bounds no region).
    skPolyline: ([sketch, id, definition], loc) => {
      segmentSketch(sketch, loc);
      const d = h.fieldMap(definition, ['points'], ['construction', 'constrained'], loc);
      noConstruction(d, loc, 'skPolyline');
      if (!Array.isArray(d.points) || d.points.length < 2) raise('skPolyline needs at least two points', loc);
      const points = d.points.map(p => point2(p, 'points', loc));
      addSegments(sketch, id, points.slice(1).map((q, k) => [...points[k], ...q]), loc);
    },
    // Axis-aligned rectangle from the corners' own values (min/max only).
    skRectangle: ([sketch, id, definition], loc) => {
      segmentSketch(sketch, loc);
      const d = h.fieldMap(definition, ['firstCorner', 'secondCorner'], ['construction'], loc);
      noConstruction(d, loc, 'skRectangle');
      const a = point2(d.firstCorner, 'firstCorner', loc), b = point2(d.secondCorner, 'secondCorner', loc);
      const [x0, y0] = a.map((v, i) => Math.min(v, b[i])), [x1, y1] = a.map((v, i) => Math.max(v, b[i]));
      addSegments(sketch, id, [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]], loc);
    },
    skSolve: ([sketch], loc) => {
      const rust = segmentSketch(sketch, loc);
      // Regions from the undirected exact incidence graph (Rust); a capability
      // gap (crossings, branching, holes) refuses here by name.
      rust.regions = rust.curves.length ? regions(sketch, loc, 'skSolve') : { loops: [], openWires: 0 };
      if (rust.regions.regularization?.merges.length) {
        const entities = [...rust.segments, ...rust.arcs].map(e => e.id);
        const regularization = {...rust.regions.regularization, merges: rust.regions.regularization.merges.map(merge => ({...merge,
          sketch: sketch.id.toString(), entities: merge.entities.map(i => entities[i]), movedEntity: entities[merge.movedEntity]}))};
        engine.operationEvidence.push({operation:'skSolve', regularization});
      }
      sketch.solved = true;
      const key = String(engine.nextRecord++); engine.records.set(key, { key, kind: 'sketch', sketch, createdBy: new Set([sketch.id.key()]) });
    },
    qSketchRegion: ([id, filterInnerLoops = false], loc) => {
      h.checkType(id, 'Id', loc);
      if (typeof filterInnerLoops !== 'boolean') raise('filterInnerLoops must be boolean', loc);
      const query = new h.Query(id);
      query.filterInnerLoops = filterInnerLoops;
      return query;
    },
    opLoft: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['profileSubqueries'], [], loc);
      if (!Array.isArray(d.profileSubqueries) || d.profileSubqueries.length !== 2) {
        throw new RustCapabilityError('opLoft', 'loft/two-profiles-required', loc);
      }
      const profiles = d.profileSubqueries.map(q => engine.resolve(q, loc));
      const arranged = profiles.find(p => p.rust?.regions?.arrangement);
      if (arranged) throw new RustCapabilityError('opLoft', arranged.rust.regions.legacyRefusal, loc);
      if (profiles.some(p => !p.rust?.regions || p.rust.circles.length || p.rust.arcs.length || splineSketch(p))) {
        throw new RustCapabilityError('opLoft', 'loft/planar-line-profiles-required', loc);
      }
      const common = commonLoftFrame(profiles[0].plane, profiles[1].plane);
      if (!common) throw new RustCapabilityError('opLoft', 'loft/common-exact-frame-unavailable', loc);
      const request = new Request(HOST_OP.LOFT);
      for (const w of bodyKey(id.toString())) request.u32(w);
      request.u32(0);
      for (const v of [...common.frame.origin, ...common.frame.x, ...common.frame.z, common.height]) request.f64(v);
      for (const p of profiles) request.segments(p.rust.segments.map(s => s.s));
      const body = new RustBody(id.toString(), call(kernel, request.done(), 'opLoft', loc), null);
      const m = measureRustBody(kernel, body);
      body.validation = { closed: m.validity.closed, brep: m.validity.brep, volumeMm3: m.volumeMm3,
        areaMm2: m.areaMm2, toleranceMm: m.toleranceMm, boundsMm: m.bboxMm,
        certificate: m.certificate, boundToConstruction: m.boundToConstruction };
      engine.claim(context, id, loc);
      engine.addSolid(id, body);
    },
    opExtrude: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['entities', 'direction', 'endBound', 'endDepth'], ['startBound', 'startDepth'], loc);
      if (d.endBound !== 'BoundingType.BLIND') throw new RustCapabilityError('opExtrude', `end bound ${d.endBound}`, loc);
      if (d.startBound !== undefined || d.startDepth !== undefined) throw new RustCapabilityError('opExtrude', 'startBound/startDepth', loc);
      const items = evaluateRegions(d.entities, loc);
      const sketches = new Set(items.map(item => item.sketch));
      if (sketches.size > 1) {
        throw new NamedRefusal('opExtrude', 'sketch-region/multiple-sketches', 'the query selects regions of several sketches',
          'Extrude the regions of each sketch with its own opExtrude (Onshape would fuse touching regions of different sketches; that is not decided here).', loc);
      }
      const sketch = items[0]?.sketch ?? leafSketch(d.entities);
      if (!sketch) throw new GeometryRefusal('opExtrude', 'empty-region', 'the query selects no region of the sketch', loc);
      const depth = metres(d.endDepth, 'endDepth', loc);
      // std math.fs TOLERANCE.zeroLength: a sweep of zero height fails (and is catchable) as in Onshape.
      if (Math.abs(depth) <= 1e-8) raise('opExtrude: the extrusion has zero or unresolved thickness normal to the sketch plane', loc);
      if (!(depth > 0)) raise('opExtrude endDepth must be positive', loc);
      // The direction must be the sketch normal or its negation, bit for bit
      // after the same normalization the plane builtin applied (library.mjs).
      const normal = direction3(sketch.plane.normal, 'sketch plane normal', loc);
      const direction = normalized(direction3(d.direction, 'direction', loc), loc);
      const same = direction.every((x, i) => x === normal[i]);
      const opposite = direction.every((x, i) => x === -normal[i]);
      if (!same && !opposite) throw new RustCapabilityError('opExtrude', 'an extrusion direction that is not exactly the sketch normal', loc);
      const { openWires } = sketch.rust.regions;
      const mixed = sketch.rust.circles.length > 0 && sketch.rust.segments.length > 0;
      // Region indices, as OP_PRISM and the profile ops number them.
      const loops = items.map(item => item.index);
      if (!loops.length) {
        throw sketch.rust.regions.loops.length ? new GeometryRefusal('opExtrude', 'empty-region', 'the query selects no region of the sketch', loc)
          : openWires ? new GeometryRefusal('opExtrude', 'open-profile', 'the sketch has no closed region: exact endpoint incidence leaves every wire open', loc)
          : new GeometryRefusal('opExtrude', 'empty-region', 'the sketch has no region', loc);
      }
      engine.claim(context, id, loc);
      const origin = point3(sketch.plane.origin, 'sketch plane origin', loc), x = direction3(sketch.plane.x, 'sketch plane x', loc);
      const segments = sketch.rust.segments.map(s => s.s);
      // Onshape's one opExtrude fuses adjacent bounded faces of the same
      // sketch. The native arrangement supplies their exact exterior; separate
      // opExtrude calls still produce separate bodies. Disconnected or ambiguous
      // arrangements refuse before this point rather than welding by tolerance.
      // A sketch with a spline is one closed chain (OP_CURVE_REGION admitted
      // it at skSolve), extruded from its rule 3 entity list, not the per-family lists.
      const spline = splineSketch(sketch);
      const measured = body => {
        const m = measureRustBody(kernel, body);
        body.validation = { closed: m.validity.closed, brep: m.validity.brep, volumeMm3: m.volumeMm3, areaMm2: m.areaMm2,
          toleranceMm: m.toleranceMm, boundsMm: m.bboxMm, certificate: m.certificate, boundToConstruction: m.boundToConstruction };
        return body;
      };
      const arranged = sketch.rust.regions.arrangement === true;
      if (arranged) {
        const touching = loops.find(a => loops.some(b => sketch.rust.regions.loops[a].adjacent.includes(b)));
        if (touching !== undefined) {
          throw new NamedRefusal('opExtrude', 'sketch-region/adjacent-regions-fuse', 'the query selects regions that share a boundary; Onshape fuses them into one body',
            'Select regions that do not touch (for example qSketchRegion(id, true) on a holed face), or extrude each region with its own opExtrude.', loc);
        }
      }
      const mergeArcRegions = !spline && !arranged && sketch.rust.arcs.length > 0 && loops.length > 1;
      const bodies = (mergeArcRegions ? [0] : loops).map(index => {
        const bodyId = loops.length === 1 || mergeArcRegions ? id.toString() : `${id}/${index}`;
        if (arranged) {
          const request = new Request(HOST_OP.SKETCH_EXTRUDE);
          for (const w of bodyKey(bodyId)) request.u32(w);
          request.u32(0);
          for (const v of [...origin, ...x, ...normal]) request.f64(v);
          request.f64(depth).u32(opposite ? 1 : 0).segments(segments).segments(sketch.rust.arcs.map(a => a.s)).circles(sketch.rust.circles).u32(index);
          return measured(new RustBody(bodyId, call(kernel, request.done(), 'opExtrude', loc), null));
        }
        const circle = sketch.rust.circles[0];
        const arcs = sketch.rust.arcs;
        const request = new Request(spline ? HOST_OP.CURVE_EXTRUDE : arcs.length ? HOST_OP.ARC_EXTRUDE : circle ? HOST_OP.PROFILE_EXTRUDE : HOST_OP.PRISM);
        for (const w of bodyKey(bodyId)) request.u32(w);
        request.u32(0); // revision
        if (!spline && !circle && !arcs.length) request.u32(0).u32(0).u32(0).u32(0); // interpreter source frame
        for (const v of [...origin, ...x, ...normal]) request.f64(v);
        if (circle && !spline) for (const v of [...circle.center, circle.radius]) request.f64(v);
        request.f64(depth).u32(opposite ? 1 : 0);
        if (spline) request.numbers(sketch3(sketch));
        else if (arcs.length) {
          request.segments(segments).segments(arcs.map(a => a.s)).u32(mergeArcRegions ? 0xffffffff : index);
          if (engine.modelingPolicy.curvedContacts === 'tolerated-regularized') request.f64(engine.modelingPolicy.contactCapMm);
        } else request.u32(circle ? Number(!mixed || index === 1) : index).segments(segments);
        return measured(new RustBody(bodyId, call(kernel, request.done(), 'opExtrude', loc), null));
      });
      // Publish only after every selected face has extruded and measured.
      bodies.forEach(body => engine.addSolid(id, body));
    },
  };
}

// Is this model built on the strict Rust port (every body a Rust body)?
export function rustModel(model) {
  const rust = model.bodies.filter(isRustBody);
  if (rust.length && rust.length !== model.bodies.length) throw new NativeKernelError('BX_ABI', 'a model mixes Rust WC0 bodies and legacy bodies');
  return rust.length > 0;
}

// brep.json on the Rust path: the WC0 v3 reading of each body plus a
// legacy-shaped projection (world mm vertices, edges, face loops) that
// scripts/validate-step.py reads. The projection is written by Rust; its
// coordinates carry the stated export budget (validation.toleranceMm).
// Legacy-shaped carriers of one WC0 face/edge from a `wonky-carriers/1` entry.
// Every field is world millimetres from the exact carrier; an entry Rust cannot
// state keeps a named `refused` reason instead of a guessed carrier.
const legacySurface = c => {
  if (c.refused) return { type: 'unsupported', refused: c.refused };
  switch (c.kind) {
    case 'plane': return { type: 'plane', origin: c.origin, normal: c.normal, x: c.x };
    case 'cylinder': return { type: 'cylinder', origin: c.origin, axis: c.axis, x: c.x, radius: c.radiusMm };
    case 'sphere': return { type: 'sphere', origin: c.origin, axis: c.axis, x: c.x, radius: c.radiusMm };
    case 'torus': return { type: 'torus', origin: c.origin, axis: c.axis, x: c.x, major: c.majorMm, minor: c.minorMm };
    case 'cone': return { type: 'cone', origin: c.origin, axis: c.axis, x: c.x, radius: c.radiusMm, angle: c.angleRad };
    default: return { type: 'unsupported', refused: `carriers/${c.kind}-not-in-legacy-shape` };
  }
};
const legacyCurve = c => {
  if (c.refused) return { type: 'unsupported', refused: c.refused };
  if (c.kind === 'line') return 'line';
  if (c.kind === 'circle') return { type: 'circle', origin: c.origin, normal: c.normal, x: c.x, radius: c.radiusMm };
  if (c.kind === 'ellipse') return { type: 'ellipse', origin: c.origin, normal: c.normal, x: c.x, major: c.majorMm, minor: c.minorMm };
  return { type: 'unsupported', refused: `carriers/${c.kind}-not-in-legacy-shape` };
};

// Which WC0 face is projection face k? The projection lists faces in WC0 id
// order, but that is checked, not assumed: face k must use exactly the edges of
// WC0 face k; otherwise the unique WC0 face with the same edge set is taken, and
// no unique match is a named error (never a guessed pairing). The projection keeps
// the WC0 edge ids and appends the STEP chart seams WC0 does not carry (a full
// revolve, revolve_full_observe.rs), so edge ids past the WC0 edges are not compared.
export function projectionFaceOrder(faceEdgeIds, wc0Body) {
  const wc0Edges = wc0Body.edges.length;
  const key = ids => ids.filter(id => id < wc0Edges).sort((a, b) => a - b).join(',');
  const wcKeys = wc0Body.faces.map(face => key(face.loops.flatMap(id => wc0Body.loops[id].coedges.map(c => wc0Body.coedges[c].edge))));
  return faceEdgeIds.map((ids, k) => {
    const want = key(ids);
    if (wcKeys[k] === want) return k;
    const hits = wcKeys.flatMap((have, j) => have === want ? [j] : []);
    if (hits.length !== 1) throw new NativeKernelError('BX_ABI', `projection face ${k} matches ${hits.length} WC0 faces by edge set; no unique pairing`);
    return hits[0];
  });
}

export function rustModelRecord(kernel, model) {
  if (model.bodies.every(isRustReferenceBody)) return { ...model, bodies: model.bodies.map(body => {
    const report = referenceBodyReport(body), source = referenceDisplaySource(kernel, body, 0.02), mesh = rustMesh(kernel, [body], 0.02).bodies[0];
    const vertexIds = new Map(source.vertices.map(([id],i)=>[id,i])), edgeIds = new Map(source.edges.map((edge,i)=>[edge.id,i]));
    return { ...report, id:body.id, precision:'binary64', referenceDisplay:{source,mesh},
      vertices:source.vertices.map((_,i)=>mesh.vertices.slice(3*i,3*i+3)),
      edges:source.edges.map(edge=>({start:vertexIds.get(edge.vertices[0]),end:vertexIds.get(edge.vertices[1]),curve:{type:'unsupported',refused:'import/reference-exact-curve-unavailable'}})),
      faces:source.faces.map(face=>({sourceFace:face.id,surface:{type:'unsupported',refused:'import/reference-exact-surface-unavailable'},sameSense:face.sameSense,
        loops:face.loops.map(loop=>loop.uses.map(([id,forward])=>({edge:edgeIds.get(id),forward})))})),
      validation:{boundsMm:report.bboxMm,volumeMm3:null,areaMm2:null,closed:null,toleranceMm:report.uncertainty.mm??null} };
  }) };
  const carriers = rustCarriers(kernel, model.bodies);
  return {
    ...model,
    bodies: model.bodies.map((body, bodyIndex) => {
      const m = measureRustBody(kernel, body);
      const { vertices, edges, faces } = m.projection;
      const wc0 = describeRustBody(kernel, body);
      const faceOrder = wc0.body.shells.flatMap(shell => shell.faces); // STEP face order (referenceMeasurements)
      const wcOf = projectionFaceOrder(faces.map(loops => loops.flat().map(([edge]) => edge)), wc0.body);
      const car = carriers[bodyIndex];
      const loopsOf = wcFace => wc0.body.faces[wcFace].loops.map(id => wc0.body.loops[id].outer === true);
      const faceCarrier = k => legacySurface(car.faces[wcOf[k]]);
      // A projection seam past the WC0 edges has no WC0 carrier (see projectionFaceOrder).
      const edgeCarrier = k => (k < car.edges.length ? legacyCurve(car.edges[k])
        : { type: 'unsupported', refused: 'carriers/projection-seam-not-in-wc0' });
      return {
        id: body.id, name: body.name, description: body.description, appearance: body.appearance,
        geometry: body.geometry, validation: body.validation,
        exact: !body.exactness, ...(body.exactness ? {exactness:body.exactness} : {}),
        ...(m.regularization ? {regularization:m.regularization} : {}),
        vertices, edges: edges.map(([start, end], k) => {
          const curve = edgeCarrier(k);
          return { start, end, curve, ...(curve.refused ? { curveRefused: curve.refused } : {}) };
        }),
        faces: faces.map((loops, k) => ({ surface: faceCarrier(k), sameSense: car.faces[wcOf[k]].forward, outer: loopsOf(wcOf[k]),
          ...(car.faces[wcOf[k]].refused ? { surfaceRefused: car.faces[wcOf[k]].refused } : {}),
          loops: loops.map(loop => loop.map(([edge, forward]) => ({ edge, forward }))) })),
        referenceMeasurements: { faceAreasMm2: faceOrder.map(i => m.faceAreasMm2[i]), facePerimetersMm: faceOrder.map(i => m.facePerimetersMm[i]), faceTolerancesMm: faceOrder.map(() => m.toleranceMm) },
        wc0,
        wc0Sha256: rustBodySha256(body),
        wc0Words: Buffer.from(rustBodyWords(body).buffer).toString('base64'),
      };
    }),
  };
}

// The kernel that built a Rust model, for export (toStep, serializeModel).
const models = new WeakMap();
// The JSON form of a Rust model is its brep.json record (the exact bytes the
// CLI and the viewer read back), not the thin wire description of its bodies.
export function bindRustModel(model, kernel) {
  models.set(model, kernel);
  Object.defineProperty(model, 'toJSON', { value: () => rustModelRecord(kernel, model), enumerable: false });
}
export function rustModelKernel(model) {
  const kernel = models.get(model);
  if (!kernel || !ports.has(kernel)) throw new NativeKernelError('BX_ABI', 'this Rust model has no registered Rust host port');
  return kernel;
}
