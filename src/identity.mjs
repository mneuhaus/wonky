import { createHash } from 'node:crypto';
import { fail, unsupported } from './errors.mjs';
import { noteParents } from './diagnostics.mjs';
import { binary64Host } from './real.mjs';

const schema = 'wonky-topology-identity/1';
const list = values => values.reduceRight((tail, head) => ({ $: 'Con', head, tail }), { $: 'Nil' });
const array = value => {
  const values = [];
  while (value.$ === 'Con') { values.push(value.head); value = value.tail; }
  if (value.$ !== 'Nil') fail('Invalid Bend identity list');
  return values;
};
const groups = { vertex: 'vertices', edge: 'edges', face: 'faces' };
const stable = entry => ['semantic', 'source'].includes(entry.stability);
const nonempty = (value, label) => {
  if (typeof value !== 'string' || !value.length) fail(`${label} must be a nonempty string`);
  return value;
};

// Hashes record geometry revisions only. Every origin/instance key is derived
// independently by kernel/identity.bend from named operations/roles/ancestry.
export function geometryRevision(body) {
  const geometry = { geometry: body.geometry ?? 'planar', vertices: body.vertices, edges: body.edges, faces: body.faces };
  return `sha256:${createHash('sha256').update(JSON.stringify(geometry)).digest('hex')}`;
}

const encodeParent = parent => ({ $: 'ParentIdentity', origin_id: parent.originId, instance_id: parent.instanceId,
  revision: parent.revision, operation_id: parent.operationId });
const decodeParent = parent => ({ originId: parent.origin_id, instanceId: parent.instance_id,
  revision: parent.revision, operationId: parent.operation_id });
const encodeEntity = entry => ({ $: 'EntityIdentity', origin_id: entry.originId, instance_id: entry.instanceId,
  revision: entry.revision, kind: entry.kind, role: entry.role, stability: entry.stability,
  operation_id: entry.operationId, relation: entry.lineage.relation, matching: entry.lineage.matching,
  parents: list(entry.lineage.parents.map(encodeParent)) });
const decodeEntity = entry => ({ originId: entry.origin_id, instanceId: entry.instance_id, revision: entry.revision,
  kind: entry.kind, role: entry.role, stability: entry.stability, operationId: entry.operation_id,
  lineage: { relation: entry.relation, matching: entry.matching, parents: array(entry.parents).map(decodeParent) } });
const parentOf = identity => ({ originId: identity.originId, instanceId: identity.instanceId,
  revision: identity.revision, operationId: identity.operationId });

function context(id, type, parameters, options = {}, parents = []) {
  const operationId = nonempty(options.operationId ?? id, 'Identity operationId');
  const namespace = nonempty(options.namespace ?? 'model', 'Identity namespace');
  const occurrence = nonempty(options.occurrenceId ?? id, 'Identity occurrenceId');
  const source = options.source ?? {};
  const operation = { id: operationId, type,
    source: structuredClone({ ...source, file: source.file ?? null, sha256: source.sha256 ?? null, span: source.span ?? null }),
    parameters: structuredClone(options.parameters ?? parameters),
    parentOperations: [...new Set(parents.map(parent => parent.operationId))] };
  return { operationId, namespace, occurrence, operation };
}

function attach(body, identities, metadata) {
  const identity = { schema, ...decodeEntity(identities.body), operation: metadata.operation,
    topology: Object.fromEntries(Object.values(groups).map(group => [group, array(identities[group]).map(decodeEntity)])) };
  for (const group of Object.values(groups)) {
    if (identity.topology[group].length !== body[group].length) fail(`Identity ${group} do not match the B-rep topology`);
  }
  const all = [identity, ...Object.values(identity.topology).flat()];
  if (new Set(all.map(entry => entry.instanceId)).size !== all.length) fail('Duplicate topology identity in a body');
  body.identity = identity;
  return identity;
}

// kept: the source indices of the profile vertices the prism was built from,
// when the profile ring merge dropped straight-on vertices (null otherwise).
// The identities then run over the kept count, and each entry names the
// source profile vertices and edges it stands for.
export function identifyExtrusion(kernel, body, id, points, plane, delta, offset, options = {}, kept = null) {
  const box = options.primitive === 'box';
  if (options.primitive !== undefined && !box) unsupported(`Unsupported identity primitive '${options.primitive}'`);
  const profile = kept ? kept.map(index => points[index]) : points;
  // F32 profile corners for Bend; WONKY_BACKEND=rust sends the binary64 (wire v2).
  const corner = binary64Host() ? ([x, y]) => ({ $: 'V3', x, y, z: 0 }) : ([x, y]) => ({ $: 'V3', x: Math.fround(x), y: Math.fround(y), z: 0 });
  if (box && !kernel.identity.box_layout(list(profile.map(corner)))) {
    unsupported('Semantic box identities require the canonical four-corner rectangle profile');
  }
  const metadata = context(id, box ? 'box' : 'extrusion', { points, plane, delta, startOffset: offset }, options);
  const revision = geometryRevision(body), I = kernel.identity;
  const args = [metadata.namespace, metadata.operationId, metadata.occurrence, revision];
  const identity = attach(body, box ? I.box(...args) : I.extrusion(...args, profile.length), metadata);
  if (kept) attachProfileSpans(identity, kept, points.length);
  return identity;
}

// Topology layout of a prism (kernel/polygon-prism.bend, topology.bend extrude)
// over n kept vertices: vertices bottom 0..n-1, top n..2n-1; edges bottom ring,
// top ring, verticals; faces bottom cap, top cap, then side j from kept j to j+1.
function attachProfileSpans(identity, kept, sourceVertices) {
  const n = kept.length, { vertices, edges, faces } = identity.topology;
  const vertex = j => ({ kind: 'profile-vertex', sourceVertices, sourceVertex: kept[j] });
  const span = j => {
    const sourceEdges = [];
    for (let e = kept[j]; e !== kept[(j + 1) % n]; e = (e + 1) % sourceVertices) sourceEdges.push(e);
    return { kind: 'profile-span', sourceVertices, sourceEdges };
  };
  for (let j = 0; j < n; j++) {
    vertices[j].source = vertex(j); vertices[n + j].source = vertex(j);
    edges[j].source = span(j); edges[n + j].source = span(j); edges[2 * n + j].source = vertex(j);
    faces[2 + j].source = span(j);
  }
  identity.profile = { sourceVertices, kept: [...kept] };
}

export function identifyFrustum(kernel, body, id, parameters, options = {}) {
  const metadata = context(id, 'circular-frustum', parameters, options);
  return attach(body, kernel.identity.frustum(metadata.namespace, metadata.operationId, metadata.occurrence, geometryRevision(body)), metadata);
}

export function identifySketchArcExtrusion(kernel, body, id, sketch, plane, delta, offset, options = {}) {
  const uses = array(sketch.native.uses);
  const source = use => {
    const index = use.fit.source.index, entity = sketch.entities[index];
    if (!entity || entity.index !== index) fail('Native sketch identity references an absent source entity');
    return entity;
  };
  const names = uses.map(use => source(use).id);
  const junctions = uses.map((use, index) => {
    const previous = uses[(index + uses.length - 1) % uses.length];
    return JSON.stringify([[source(previous).id, previous.forward ? 'end' : 'start'],
      [source(use).id, use.forward ? 'start' : 'end']].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  });
  const metadata = context(id, 'line-arc-extrusion', { sketchId: sketch.sketchId, plane, delta, startOffset: offset }, options);
  const identity = attach(body, kernel.identity.named_extrusion(metadata.namespace, metadata.operationId, metadata.occurrence,
    geometryRevision(body), list(names), list(junctions), body.construction.signedDepthMm > 0), metadata);
  uses.forEach((use, index) => {
    const entity = source(use), origin = { kind: 'sketch-entity', sketchId: sketch.sketchId, entityId: entity.id,
      sourceIndex: entity.index, span: entity.location, curveType: entity.type };
    identity.topology.faces[index + 2].source = { ...origin, role: 'extruded-side' };
    identity.topology.edges[index].source = { ...origin, role: identity.topology.faces[0].role };
    identity.topology.edges[index + uses.length].source = { ...origin, role: identity.topology.faces[1].role };
  });
  return identity;
}

export function ensureBodyIdentity(kernel, body) {
  if (body.identity) return body.identity;
  const metadata = context(body.id, 'unattributed-geometry', null);
  const identities = kernel.identity.unattributed(metadata.namespace, metadata.operationId, metadata.occurrence,
    geometryRevision(body), body.vertices.length, body.edges.length, body.faces.length);
  return attach(body, identities, metadata);
}

export function identifyTransform(kernel, source, result, id, rows, offset, options = {}) {
  const previous = ensureBodyIdentity(kernel, source), parent = parentOf(previous);
  const metadata = context(id, 'rigid-transform', { rows, offset }, options, [parent]);
  const encoded = { $: 'IdentitySet', body: encodeEntity(previous),
    ...Object.fromEntries(Object.values(groups).map(group => [group, list(previous.topology[group].map(encodeEntity))])) };
  const identity = attach(result, kernel.identity.transform(encoded, metadata.operationId, metadata.occurrence, geometryRevision(result)), metadata);
  const carrySource = (before, after) => { if (before.source) after.source = structuredClone(before.source); };
  carrySource(previous, identity);
  if (previous.profile) identity.profile = structuredClone(previous.profile);
  for (const group of Object.values(groups)) previous.topology[group].forEach((entry, i) => carrySource(entry, identity.topology[group][i]));
  identity.lineage.history = [...(previous.lineage.history ?? []), previous.operation];
  noteParents(result, [source], { transformed: true, rows, offset });
  return identity;
}

export function identifyBoolean(kernel, body, id, operation, inputs, component, options = {}) {
  const previous = inputs.map(input => ensureBodyIdentity(kernel, input)), parents = previous.map(parentOf);
  const metadata = context(id, `boolean:${operation}`, { operation }, options, parents);
  const identity = attach(body, kernel.identity.boolean_result(metadata.namespace, metadata.operationId, metadata.occurrence,
    geometryRevision(body), component, body.vertices.length, body.edges.length, body.faces.length, list(parents.map(encodeParent))), metadata);
  identity.lineage.ambiguity = 'Output ancestry is known; entity correspondence and result-component continuity across revisions are unresolved';
  identity.lineage.history = previous.flatMap(entry => [...(entry.lineage.history ?? []), entry.operation]);
  return identity;
}

export function identifyImport(kernel, body, source, id, provenance = {}, options = {}) {
  const sourceNamespace = options.sourceNamespace ?? (provenance.document && provenance.element && provenance.microversion
    ? JSON.stringify(['onshape', provenance.document, provenance.element, provenance.microversion]) : null);
  if (sourceNamespace !== null) nonempty(sourceNamespace, 'Imported sourceNamespace');
  const metadata = context(id, 'frozen-import', null, options);
  const revision = geometryRevision(body), I = kernel.identity;
  const namespace = sourceNamespace ?? JSON.stringify(['unqualified-import', id]);
  const sourceInfo = entityId => ({ namespace: sourceNamespace, entityId, document: provenance.document ?? null,
    element: provenance.element ?? null, microversion: provenance.microversion ?? null, sha256: provenance.sha256 ?? null });
  const fromSource = (kind, sourceId, parents = []) => I.from_source(namespace, metadata.operationId, metadata.occurrence,
    revision, nonempty(source.id, 'Imported body ID'), kind, nonempty(sourceId, `Imported ${kind} ID`), sourceNamespace !== null, list(parents));
  const base = fromSource('body', source.id), parent = I.parent(base);
  const identities = { $: 'IdentitySet', body: base };
  for (const [kind, group] of Object.entries(groups)) {
    const originals = source[group];
    if (new Set(originals.map(entry => entry.id)).size !== originals.length) fail(`Duplicate imported ${kind} IDs`);
    const entries = originals.map(entry => fromSource(kind, entry.id, [parent]));
    for (let i = originals.length; i < body[group].length; i++) {
      entries.push(I.created(namespace, metadata.operationId, metadata.occurrence, revision, kind,
        `generated-seam/${i - originals.length}`, 'revision-local', list([parent])));
    }
    identities[group] = list(entries);
  }
  const identity = attach(body, identities, metadata);
  identity.source = sourceInfo(source.id);
  for (const group of Object.values(groups)) source[group].forEach((entry, i) => { identity.topology[group][i].source = sourceInfo(entry.id); });
  return identity;
}

export function topologyReference(body, kind = 'body', index = 0, { persistent = false } = {}) {
  const identity = body.identity;
  const entry = kind === 'body' ? identity : identity?.topology[groups[kind]]?.[index];
  if (!entry || !['body', ...Object.keys(groups)].includes(kind)) fail('Unknown topology identity selection');
  if (persistent && !stable(entry)) unsupported('This topology identity is revision-local; persistent matching is not supported');
  return { schema, kind, originId: entry.originId, instanceId: entry.instanceId, revision: entry.revision, stability: entry.stability };
}

// Match supported identities only. Never replace a missing identity with the
// closest geometry, an array position, or a silently chosen clone.
export function matchTopologyReference(bodies, reference, { byOrigin = false } = {}) {
  if (reference?.schema !== schema || !['body', ...Object.keys(groups)].includes(reference.kind)) fail('Invalid topology reference');
  if (reference.stability === 'revision-local' && !reference.revision) return { status: 'unsupported', reason: 'Revision-local references require their geometry revision' };
  const candidates = [];
  let staleLocal = false;
  for (const body of bodies) {
    if (!body.identity) continue;
    const entries = reference.kind === 'body' ? [body.identity] : body.identity.topology[groups[reference.kind]];
    entries.forEach((entry, index) => {
      if (entry.originId !== reference.originId || (!byOrigin && entry.instanceId !== reference.instanceId)) return;
      if (!stable(entry) && entry.revision !== reference.revision) { staleLocal = true; return; }
      candidates.push({ bodyId: body.id, kind: reference.kind, index, identity: entry });
    });
  }
  if (candidates.length > 1) return { status: 'ambiguous', reason: 'Several occurrences share the selected origin', candidates };
  if (candidates.length === 1) return { status: 'matched', ...candidates[0] };
  if (staleLocal || (reference.stability === 'revision-local' && !bodies.some(body => body.identity?.revision === reference.revision))) {
    return { status: 'unsupported', reason: 'Revision-local topology cannot be matched across geometry revisions' };
  }
  return { status: 'missing', reason: 'No matching origin/occurrence identity; general geometric matching is not implemented' };
}
