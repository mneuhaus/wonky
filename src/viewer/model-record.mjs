// The stored-record form of a model for viewer code.
//
// Every viewer module reads the brep.json record shape (bodies with vertices,
// edges, faces, loops, carriers). A model that was just built on the Rust kernel
// holds opaque RustBody objects whose legacy fields refuse by name, so it is
// converted once to the same record `JSON.stringify(model)` writes. Records and
// legacy models pass through unchanged. The conversion is cached per model.
import { isRustBody } from '../native/rust-host.mjs';

const records = new WeakMap();

export function viewerRecord(model) {
  if (!model || !Array.isArray(model.bodies) || !model.bodies.some(isRustBody)) return model;
  if (!records.has(model)) records.set(model, model.toJSON());
  return records.get(model);
}
