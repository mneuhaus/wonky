// HS1 operation-level boundary on strict WONKY_BACKEND=rust (adapted from
// local-development-evidence, strict mode only; rust-mixed stays unavailable). Every
// FeatureScript builtin that constructs, changes, queries or exports geometry is
// routed here before any legacy host geometry code runs: the Rust host port
// (rust-host.mjs) implements a subset, and every other operation refuses with
// its family and builtin name (host/<family>:invoke). There is no fallback.
import { NativeCapabilityError } from './errors.mjs';
import { rustHostBuiltins, rustHostOf } from './rust-host.mjs';

// Null prototype: a builtin named like an Object.prototype member (FS toString)
// must not look up an inherited function and pass for a host operation.
// HS1 gate (Opus): instantiate and opTransform are transform-family operations
// too; without these rows they reached legacy leaf entries on rust.
export const HOST_OPERATIONS = Object.freeze(Object.assign(Object.create(null), {
  newSketchOnPlane: 'sketch', skRectangle: 'sketch', skPolyline: 'sketch',
  skLineSegment: 'sketch', skArc: 'sketch', skCircle: 'sketch', skSolve: 'sketch',
  qSketchRegion: 'sketch', evOwnerSketchPlane: 'sketch',
  opExtrude: 'extrude', opLoft: 'loft', opRevolve: 'revolve',
  opBoolean: 'boolean', fCuboid: 'extrude', fCylinder: 'extrude', fSphere: 'sphere', opSphere: 'sphere',
  opFillet: 'fillet', opChamfer: 'chamfer', opShell: 'shell',
  opPattern: 'transform', opDeleteBodies: 'transform', opTransform: 'transform', instantiate: 'transform',
  evVolume: 'volume', evDistance: 'query', evBox3d: 'query', evCurveDefinition: 'query',
  evEdgeTangentLine: 'query', evLine: 'query', evaluateQuery: 'query',
  makeRobustQuery: 'query', qAdjacent: 'query', qContainsPoint: 'query',
  qCoincidesWithPlane: 'query', qClosestTo: 'query', qParallelEdges: 'query',
}));

// The builtins the Rust port implements (rust-host.mjs rustHostBuiltins).
export const RUST_PORTED = Object.freeze(['newSketchOnPlane', 'skArc', 'skLineSegment', 'skPolyline', 'skRectangle', 'skSolve', 'qSketchRegion', 'opExtrude', 'fCuboid', 'fCylinder', 'fSphere', 'opSphere', 'opTransform', 'opBoolean', 'evaluateQuery', 'evVolume', 'evBox3d', 'evDistance', 'skCircle', 'opRevolve', 'opDeleteBodies', 'opPattern', 'qClosestTo', 'opFillet', 'opChamfer', 'opShell', 'qAdjacent', 'qCoincidesWithPlane', 'qParallelEdges']);

function refusing(name, family, sourceHash) {
  return (_args, loc) => {
    const error = new NativeCapabilityError({ entry: `host/${family}:invoke`, label: name, backend: 'rust', sourceHash, set: 'rust' });
    if (loc && !error.line) { error.line = loc.line; error.column = loc.column; }
    throw error;
  };
}

// `values` are ModelingContext.builtins(); `h` the host sketch helpers. On
// strict rust every HOST_OPERATIONS builtin becomes the Rust port's
// implementation or a named refusal; other backends are unchanged.
export function guardHostBuiltins(values, engine, strict, h) {
  if (!strict) return values;
  const backend = rustHostOf(engine.kernel);
  const ported = backend ? rustHostBuiltins(engine, h) : {};
  const sourceHash = backend?.sourceHash ?? 'unregistered';
  for (const [name, value] of Object.entries(values)) {
    const family = HOST_OPERATIONS[name];
    if (!family) continue;
    if (value?.type !== 'builtin' || typeof value.call !== 'function') throw new TypeError(`host operation ${name} is not a builtin`);
    values[name] = { ...value, call: ported[name] ?? refusing(name, family, sourceHash) };
  }
  return values;
}
