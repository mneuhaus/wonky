// Selection carry across revisions via recorded identity (spec 3.1 step 7).
// Package: live-client.
//
// Frozen signature:
//   resolveReferences(fromModel, toModel, references)
//     -> [{ status: 'exact' | 'lost' | 'ambiguous', alias?, ... }]
//
// A reference is a selection reference without its model id:
// { bodyId, entityType: 'body' | 'face' | 'edge' | 'vertex', entityIndex }.
// Each one is turned into the recorded topology identity of its entity in
// `fromModel` (src/identity.mjs topologyReference) and matched in `toModel`
// with matchTopologyReference. Only a unique identity match carries:
//
//   exact      one entity of `toModel` has the same origin and occurrence
//              identity (and, for revision-local identities, the same
//              geometry revision); the result names it (bodyId, entityType,
//              entityIndex, alias)
//   ambiguous  several occurrences share the origin; nothing is chosen
//   lost       no identity, a revision-local identity of another geometry
//              revision, or no matching origin/occurrence
//
// Nothing is ever matched by geometry, position or array index
// (src/identity.mjs: "never replace a missing identity with the closest
// geometry"). `fromAlias` names the entity in `fromModel` for messages.
import { matchTopologyReference, topologyReference } from '../identity.mjs';
import { viewerRecord } from './model-record.mjs';

export const ENTITY_TYPES = Object.freeze(['body', 'face', 'edge', 'vertex']);
const GROUPS = { face: 'faces', edge: 'edges', vertex: 'vertices' };
const LETTERS = { face: 'F', edge: 'E', vertex: 'V' };

export const aliasOf = (bodyIndex, entityType, entityIndex) => `B${bodyIndex + 1}`
  + (entityType === 'body' ? '' : `.${LETTERS[entityType]}${entityIndex + 1}`);

const bodiesOf = model => (Array.isArray(model?.bodies) ? model.bodies : []);

// Checks the shape of one reference; returns an error text or null.
export function referenceProblem(reference) {
  if (!reference || typeof reference !== 'object') return 'a reference must be an object';
  if (typeof reference.bodyId !== 'string' || !reference.bodyId) return 'bodyId must be a string';
  if (!ENTITY_TYPES.includes(reference.entityType)) {
    return `entityType must be one of ${ENTITY_TYPES.join(', ')}`;
  }
  if (!Number.isInteger(reference.entityIndex) || reference.entityIndex < 0) {
    return 'entityIndex must be a nonnegative integer';
  }
  if (reference.entityType === 'body' && reference.entityIndex !== 0) {
    return 'a body reference has entityIndex 0';
  }
  return null;
}

const lost = (fromAlias, reason, extra = {}) => ({ status: 'lost', fromAlias, reason, ...extra });

function resolveOne(fromModel, toModel, reference) {
  const fromBodies = bodiesOf(fromModel);
  const bodyIndex = fromBodies.findIndex(body => body.id === reference.bodyId);
  const body = fromBodies[bodyIndex];
  const { entityType, entityIndex } = reference;
  if (!body) return lost(null, `Body ${reference.bodyId} is not in the source revision`);
  const fromAlias = aliasOf(bodyIndex, entityType, entityIndex);
  if (entityType !== 'body' && !body[GROUPS[entityType]]?.[entityIndex]) {
    return lost(fromAlias, `${fromAlias} is not in the source revision`);
  }
  if (!body.identity) {
    const rust = String(body.geometry).startsWith('rust-wc0');
    return lost(fromAlias, rust
      ? 'unsupported on Rust: Rust bodies carry no recorded topology identity, so a selection cannot carry across revisions'
      : 'The body has no recorded topology identity', { stability: null });
  }
  let identity;
  try {
    identity = topologyReference(body, entityType, entityIndex);
  } catch (error) {
    return lost(fromAlias, error.message, { stability: null });
  }
  const { stability } = identity;
  const match = matchTopologyReference(bodiesOf(toModel), identity);
  if (match.status === 'matched') {
    const toIndex = bodiesOf(toModel).findIndex(item => item.id === match.bodyId);
    return {
      status: 'exact',
      fromAlias,
      alias: aliasOf(toIndex, entityType, match.index),
      bodyId: match.bodyId,
      entityType,
      entityIndex: entityType === 'body' ? 0 : match.index,
      stability,
    };
  }
  if (match.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      fromAlias,
      reason: match.reason,
      stability,
      candidates: match.candidates.map(candidate => {
        const index = bodiesOf(toModel).findIndex(item => item.id === candidate.bodyId);
        return aliasOf(index, entityType, candidate.index);
      }),
    };
  }
  // 'unsupported' (revision-local identity of another geometry revision) and
  // 'missing' (no matching origin/occurrence) do not carry.
  return lost(fromAlias, match.reason, { stability, match: match.status });
}

export function resolveReferences(fromModel, toModel, references) {
  if (!Array.isArray(references)) throw new TypeError('references must be an array');
  fromModel = viewerRecord(fromModel);
  toModel = viewerRecord(toModel);
  return references.map(reference => {
    const problem = referenceProblem(reference);
    if (problem) throw new TypeError(`Invalid reference: ${problem}`);
    return resolveOne(fromModel, toModel, reference);
  });
}
