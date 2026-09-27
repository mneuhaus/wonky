// Pure lookups over JSON display scenes shared by features: references,
// aliases, sources and compact identities. A selection reference is exactly
// {modelId, bodyId, entityType, entityIndex}; everything else is derived.
const ENTITY_KEYS = { face: 'faces', edge: 'edges', vertex: 'vertices' };
const ALIAS_LETTERS = { face: 'F', edge: 'E', vertex: 'V' };

export function selectedRecords(scenes, reference) {
  if (!reference) return null;
  const scene = scenes.get(reference.modelId);
  const body = scene?.bodies.find(value => value.id === reference.bodyId);
  if (!body) return null;
  const key = ENTITY_KEYS[reference.entityType];
  const entity = key ? body[key].find(value => value.index === reference.entityIndex) : body;
  return { scene, body, entity };
}

export function sameReference(a, b) {
  return a === b || !!a && !!b
    && ['modelId', 'bodyId', 'entityType', 'entityIndex'].every(key => a[key] === b[key]);
}

export function geometryAlias(scene, reference) {
  const bodyIndex = scene.bodies.findIndex(body => body.id === reference.bodyId);
  const entity = reference.entityType === 'body' ? ''
    : '.' + ALIAS_LETTERS[reference.entityType] + (reference.entityIndex + 1);
  return `B${bodyIndex + 1}${entity}`;
}

export function sourceFor(records) {
  if (!records) return null;
  const { entity, body } = records;
  return entity?.source ?? entity?.identity?.source ?? entity?.identity?.operation?.source
    ?? body.source ?? body.identity?.operation?.source ?? null;
}

export function selectionIdentity(identity, body) {
  if (!identity) return null;
  const keys = ['originId', 'instanceId', 'revision', 'stability', 'role', 'operationId'];
  const reference = Object.fromEntries(keys.map(key => [key, identity[key]]));
  if (identity.lineage) {
    reference.lineage = Object.fromEntries(Object.entries(identity.lineage)
      .filter(([key]) => key !== 'history'));
    if (identity.lineage.matching === 'unsupported-split-merge-correspondence') {
      reference.lineage.ambiguity ??= body.identity?.lineage?.ambiguity
        ?? 'Input ancestry is known; split/merge correspondence for output topology is unresolved.';
    }
  }
  return reference;
}

export function modelLabel(workspace, scenes, id) {
  return workspace.models.find(model => model.id === id)?.label ?? scenes.get(id)?.label ?? 'Model';
}

// Display points of a reference (for centroids).
export function referencePoints(records, reference) {
  if (!records) return [];
  if (reference.entityType === 'vertex') return [records.entity.point];
  if (reference.entityType === 'edge') return records.entity.points;
  if (reference.entityType === 'face') {
    return records.entity.triangles.flatMap(triangle => triangle.points);
  }
  return records.body.vertices.map(vertex => vertex.point);
}
