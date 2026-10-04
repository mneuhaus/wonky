// HS1 operation-level boundary on strict WONKY_BACKEND=rust (adapted from
// local-development-evidence, strict mode only; rust-mixed stays unavailable). Every
// FeatureScript builtin that constructs, changes, queries or exports geometry is
// routed here before any legacy host geometry code runs: the Rust host port
// (rust-host.mjs) implements a subset, and every other operation refuses with
// its family and builtin name (host/<family>:invoke). There is no fallback.
import registry from '../../rust/wonky-ops/host-operations.json' with { type: 'json' };
import { resolveTopology } from '../queries.mjs';
import { stdMapView, isMap } from '../values.mjs';
import { NativeCapabilityError } from './errors.mjs';
import { rustHostBuiltins, rustHostOf, requireExactRustBody, isRustReferenceBody, RustCapabilityError } from './rust-host.mjs';

// Null prototype: a builtin named like an Object.prototype member (FS toString)
// must not look up an inherited function and pass for a host operation.
// HS1 gate (Opus): instantiate and opTransform are transform-family operations
// too; without these rows they reached legacy leaf entries on rust.
export const HOST_OPERATIONS = Object.freeze(Object.assign(Object.create(null), registry.hostOperations));

// The builtins the Rust port implements (rust-host.mjs rustHostBuiltins).
// qContainsPoint only over qSketchRegion; over topology it keeps the refusal.
// skBezier: control points, degree = points - 1 <= 7 (a sketch with a Bezier is
// one closed chain extruded along the sketch normal, strand S10).
export const RUST_PORTED = Object.freeze([...registry.rustPorted]);

function refusing(name, family, sourceHash) {
  return (_args, loc) => {
    const error = new NativeCapabilityError({ entry: `host/${family}:invoke`, label: name, backend: 'rust', sourceHash, set: 'rust' });
    Object.assign(error, { builtin: name, reason: `host/${family}/not-ported`, operationUnderTest: true });
    if (loc && !error.line) { error.line = loc.line; error.column = loc.column; }
    throw error;
  };
}

// `values` are ModelingContext.builtins(); `h` the host sketch helpers. On
// strict rust every HOST_OPERATIONS builtin becomes the Rust port's
// implementation or a named refusal; other backends are unchanged. A port
// that covers only some inputs of a builtin refuses the rest with h.refusal.
export function guardHostBuiltins(values, engine, strict, h) {
  if (!strict) return values;
  const backend = rustHostOf(engine.kernel);
  const sourceHash = backend?.sourceHash ?? 'unregistered';
  const refusal = name => refusing(name, HOST_OPERATIONS[name], sourceHash);
  const ported = backend ? rustHostBuiltins(engine, { ...h, refusal }) : {};
  // Known but unimplemented std operations must reach this capability boundary
  // rather than fail as undefined identifiers. Signatures are registry data.
  for (const [name, signature] of Object.entries(registry.unimplementedBuiltins ?? {})) {
    if (!Object.hasOwn(HOST_OPERATIONS, name)) throw new TypeError(`host operation ${name} lacks a family`);
    values[name] ??= { type: 'builtin', name, ...signature, call: refusal(name) };
  }
  for (const [name, value] of Object.entries(values)) {
    const family = HOST_OPERATIONS[name];
    if (!family) continue;
    if (value?.type !== 'builtin' || typeof value.call !== 'function') throw new TypeError(`host operation ${name} is not a builtin`);
    const invoke = ported[name] ?? refusal(name);
    const referenceOperations = { opBoolean: 'boolean', opFillet: 'fillet', opChamfer: 'chamfer', opPattern: 'pattern', opTransform: 'transform' };
    values[name] = { ...value, call: referenceOperations[name] ? (args, loc) => {
      if (![...engine.records.values()].some(record => isRustReferenceBody(Object.getOwnPropertyDescriptor(record, 'body')?.value))) return invoke(args, loc);
      const definition = isMap(args[2]) ? args[2] : stdMapView(args[2]);
      for (const key of ['bodies', 'entities', 'tools', 'targets']) {
        if (definition?.[key] === undefined) continue;
        try {
          for (const row of resolveTopology(engine, definition[key], loc)) requireExactRustBody(row.record.body, referenceOperations[name], loc);
        } catch (error) {
          // A native topology selection itself needs an exact WC0 Model.
          // Keep the reference refusal, with the operation that requested it.
          if (error instanceof RustCapabilityError && error.reason.startsWith('import/reference-body/')) throw new RustCapabilityError(name, `import/reference-body/${referenceOperations[name]}`, loc);
          throw error;
        }
      }
      return invoke(args, loc);
    } : invoke };
  }
  return values;
}
