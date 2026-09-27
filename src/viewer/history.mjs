// Construction history for GET /api/models/:id/history (spec 9.2). Package:
// source-links.
//
//   operationHistory(model, { modelId }) -> {
//     schema, modelId, source, exactness, scope, available,
//     operations: [{ sequence, name, operationId, status, file, sha256, span, excerpt,
//                    callPath, callSite, sketch, parameters, parametersDisplay, outputs,
//                    removedBodies, error? }],
//     bodies: [{ alias, id, name, operation, faces, edges, vertices }],
//     files: [{ sha256, file, lines: { <line>: { line, operations, links, targets, notes } } }],
//   }
//
// Everything here is read from the recorded model: the source map
// (`sourceMap.operations`, one record per observed modeling call), the
// per-entity identity (`identity.operationId`, face- and edge-level
// sketch-entity sources), body lineage and Boolean construction origins.
// Nothing is inferred from geometry. Links are `recorded`; parameters are
// `design-parameter` values (SI in the source map, also shown in mm/deg).
//
// A line maps to geometry through these relations (strongest first):
//   sketch-entity   face/edge whose recorded sketch-entity source is this line
//   sketch          face/edge built from the sketch created or solved at this line
//   operation       final body created by the modeling call at this line
//   boolean-origin  result face/edge whose recorded construction origin is a
//                   face/edge of an input body created at this line
//   descendant      final body whose recorded lineage contains a body created at
//                   this line (whole body; no face correspondence recorded)
//   call            everything above, for modeling calls made inside a helper
//                   function that is called at this line
// Call sites are located in the calling operation's source document: the
// recorded frames carry lines only, and a build evaluates one document.
import { inputIdentity } from '../construction-history.mjs';

export const HISTORY_SCHEMA = 'wonky.viewer-history/1';

export const RELATIONS = Object.freeze([
  'sketch-entity', 'sketch', 'operation', 'boolean-origin', 'descendant', 'call',
]);

const SCOPE = 'Observed modeling calls of this revision (recorded source map), their final'
  + ' bodies and the recorded entity links. Source locations are call points, not expression'
  + ' ranges. Lines without a recorded modeling call, sketch entity or helper call map to no'
  + ' geometry.';

const SKETCH_CALL = /^sk[A-Z]/;
const SKETCH_LEVEL = new Set(['newSketchOnPlane', 'skSolve']);

const sameFrame = (a, b) => a.name === b.name
  && a.calledAt?.line === b.calledAt?.line && a.calledAt?.column === b.calledAt?.column
  && a.declaration?.line === b.declaration?.line
  && a.declaration?.column === b.declaration?.column;

// Recorded call stack without consecutive duplicate frames (feature wrappers
// are recorded twice), outermost first.
export function callPath(stack = []) {
  const frames = [];
  for (const frame of stack ?? []) {
    if (frames.length && sameFrame(frames.at(-1), frame)) continue;
    frames.push({
      name: frame.name,
      calledAt: frame.calledAt ?? null,
      declaration: frame.declaration ?? null,
    });
  }
  return frames;
}

// The innermost helper call of an operation: the last frame that was called
// from somewhere (the feature entry itself has no call site).
export function helperFrame(stack = []) {
  return [...callPath(stack)].reverse().find(frame => frame.calledAt?.line) ?? null;
}

const location = span => (span?.line
  ? { line: span.line, ...(span.column ? { column: span.column } : {}) } : null);

// Display value of a recorded Quantity snapshot (SI base units).
function quantityDisplay(snapshot) {
  const { value, lengthPower = 0, anglePower = 0 } = snapshot;
  if (typeof value !== 'number') return null;
  const round = number => Number(number.toPrecision(12));
  if (anglePower === 0 && lengthPower !== 0) {
    const unit = lengthPower === 1 ? 'mm' : `mm^${lengthPower}`;
    return { value: round(value * 1000 ** lengthPower), unit, si: value };
  }
  if (lengthPower === 0 && anglePower === 1) {
    return { value: round(value * 180 / Math.PI), unit: 'deg', si: value };
  }
  if (lengthPower === 0 && anglePower === 0) return { value, unit: '', si: value };
  return null;
}

const isQuantity = value => value?.type === 'Quantity';

// Flattened quantities of a parameter snapshot in mm/deg, with the SI
// original: [{ path, value, unit, si }] or vectors [{ path, values, unit, si }].
export function displayParameters(parameters) {
  const rows = [];
  const visit = (value, path, depth) => {
    if (!value || typeof value !== 'object' || depth > 6 || rows.length >= 64) return;
    if (isQuantity(value)) {
      const display = quantityDisplay(value);
      if (display) rows.push({ path, ...display });
      return;
    }
    if (value.type === 'Vector' && Array.isArray(value.items)
      && value.items.length && value.items.every(isQuantity)) {
      const parts = value.items.map(quantityDisplay);
      if (parts.every(part => part && part.unit === parts[0].unit)) {
        rows.push({
          path, values: parts.map(part => part.value), unit: parts[0].unit,
          si: parts.map(part => part.si),
        });
      }
      return;
    }
    const entries = Array.isArray(value) ? value.map((item, index) => [index, item])
      : Object.entries(value);
    for (const [key, item] of entries) {
      if (key === 'type' || key === 'truncated') continue;
      const next = Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
      visit(item, next, depth + 1);
    }
  };
  visit(parameters, '', 0);
  return rows;
}

// The recorded sk* call that created a sketch entity (sketch id and entity
// id as its first two arguments), else the sk* call at the same span.
export function sketchOperation(operations, source) {
  if (source?.kind !== 'sketch-entity') return null;
  const sketchCalls = operations.filter(op => SKETCH_CALL.test(op.name ?? ''));
  const byArguments = sketchCalls.find(op => op.parameters?.[0]?.id === source.sketchId
    && op.parameters?.[1] === source.entityId);
  if (byArguments) return byArguments;
  const line = source.span?.line;
  return sketchCalls.find(op => op.source?.span?.line === line
    && (!source.span?.column || op.source?.span?.column === source.span.column)) ?? null;
}

const sketchIdOf = op => (op.name === 'newSketchOnPlane' ? op.operationId
  : op.parameters?.[0]?.type === 'Sketch' ? op.parameters[0].id : null);

// Cons list {$: 'Con', head, tail} or array -> array.
function listOf(value) {
  if (Array.isArray(value)) return value;
  const items = [];
  for (let node = value; node?.$ === 'Con'; node = node.tail) items.push(node.head);
  return items;
}

function faceOperands(origin) {
  if (!origin) return [];
  const refs = [origin.owner, ...listOf(origin.contributors)];
  return [...new Set(refs.filter(ref => Number.isInteger(ref?.operand)).map(ref => ref.operand))];
}

function edgeOperands(origin) {
  if (!origin) return [];
  const refs = origin.$ === 'OriginalEdge' ? [origin]
    : origin.$ === 'FaceIntersection' ? [origin.first, origin.second]
      : origin.$ === 'FaceSubdivision' ? listOf(origin.faces) : [];
  return [...new Set(refs.filter(ref => Number.isInteger(ref?.operand)).map(ref => ref.operand))];
}

// Ids (body ids and operation ids) a body descends from, from its recorded
// lineage and Boolean evidence. The body's own id is excluded. The model
// resolves evidence input identities that brep.json stores once per model.
export function ancestorIds(body, model = null) {
  const ids = new Set();
  const add = value => {
    if (typeof value === 'string' && value) ids.add(value);
  };
  for (const id of body.identity?.operation?.parentOperations ?? []) add(id);
  for (const parent of body.identity?.lineage?.parents ?? []) add(parent.operationId);
  for (const entry of body.identity?.lineage?.history ?? []) add(entry.id);
  for (const record of body.operationHistory ?? []) {
    for (const input of record.evidence?.inputs ?? []) {
      add(input.bodyId);
      add(inputIdentity(model, input)?.operationId);
      for (const entry of input.history ?? []) add(entry.id ?? entry.operationId);
    }
  }
  ids.delete(body.id);
  return ids;
}

// Input body ids of a Boolean result by operand index (recorded evidence).
function operandBodies(body, model) {
  const inputs = body.operationHistory?.find(record => record.evidence?.inputs)?.evidence.inputs;
  const operands = new Map();
  for (const input of inputs ?? []) {
    if (Number.isInteger(input.operand)) {
      operands.set(input.operand, [input.bodyId, inputIdentity(model, input)?.operationId].filter(Boolean));
    }
  }
  return operands;
}

const reference = (modelId, body, entityType, entityIndex) => ({
  modelId, bodyId: body.id, entityType, entityIndex,
});

function targetOf(modelId, body, bodyIndex, entityType, entityIndex) {
  const letter = { face: 'F', edge: 'E', vertex: 'V' }[entityType];
  const whole = entityType === 'body';
  const alias = whole ? `B${bodyIndex + 1}` : `B${bodyIndex + 1}.${letter}${entityIndex + 1}`;
  return { alias, ...reference(modelId, body, entityType, whole ? 0 : entityIndex) };
}

function operationRecord(op, aliases) {
  const source = op.source ?? {};
  const helper = helperFrame(op.callStack);
  return {
    sequence: op.sequence,
    name: op.name,
    operationId: op.operationId ?? null,
    status: op.status ?? null,
    file: source.file ?? null,
    sha256: source.sha256 ?? null,
    span: location(source.span),
    excerpt: source.excerpt ?? null,
    callPath: callPath(op.callStack),
    callSite: helper ? {
      name: helper.name, ...location(helper.calledAt), file: source.file ?? null,
      sha256: source.sha256 ?? null,
    } : null,
    sketch: SKETCH_CALL.test(op.name ?? '') || op.name === 'newSketchOnPlane' ? {
      id: sketchIdOf(op),
      ...(typeof op.parameters?.[1] === 'string' && !SKETCH_LEVEL.has(op.name)
        ? { entityId: op.parameters[1] } : {}),
    } : null,
    parameters: op.parameters ?? null,
    parametersDisplay: displayParameters(op.parameters),
    outputs: (op.outputs ?? []).map(output => ({
      bodyId: output.bodyId, alias: aliases.get(output.bodyId) ?? null,
    })),
    removedBodies: op.removedBodies ?? [],
    ...(op.error ? { error: op.error } : {}),
  };
}

// Entity -> operation and sketch-entity links for one body.
function entityLinks(model, body, bodyIndex, context) {
  const { operations, byOperationId, bodyOperation } = context;
  const operationOf = identity => {
    const op = identity?.operationId ? byOperationId.get(identity.operationId) : null;
    return (op ?? bodyOperation.get(body.id))?.sequence ?? null;
  };
  const sketchLink = source => {
    if (source?.kind !== 'sketch-entity') return null;
    const op = sketchOperation(operations, source);
    return {
      sketchId: source.sketchId ?? null,
      entityId: source.entityId ?? null,
      ...(source.curveType ? { curveType: source.curveType } : {}),
      ...(source.role ? { role: source.role } : {}),
      span: location(source.span),
      operation: op?.sequence ?? null,
    };
  };
  const topology = body.identity?.topology ?? {};
  const operands = operandBodies(body, model);
  const origin = (operandsOf, value) => {
    const inputs = operandsOf(value);
    if (!inputs.length) return null;
    return inputs.map(operand => ({ operand, inputs: operands.get(operand) ?? [] }));
  };
  const alias = (letter, index) => `B${bodyIndex + 1}.${letter}${index + 1}`;
  const faces = body.faces.map((_face, index) => {
    const identity = topology.faces?.[index];
    const sketchEntity = sketchLink(identity?.source);
    const origins = origin(faceOperands, body.construction?.faceOrigins?.[index]);
    return {
      alias: alias('F', index),
      operation: operationOf(identity),
      ...(sketchEntity ? { sketchEntity } : {}),
      ...(origins ? { origins } : {}),
    };
  });
  const edges = body.edges.map((_edge, index) => {
    const identity = topology.edges?.[index];
    const sketchEntity = sketchLink(identity?.source);
    const origins = origin(edgeOperands, body.construction?.edgeOrigins?.[index]);
    return {
      alias: alias('E', index),
      operation: operationOf(identity),
      ...(sketchEntity ? { sketchEntity } : {}),
      ...(origins ? { origins } : {}),
    };
  });
  const vertices = body.vertices.map((_vertex, index) => ({
    alias: alias('V', index),
    operation: operationOf(topology.vertices?.[index]),
  }));
  return { faces, edges, vertices };
}

// Line index: per source document and line, the recorded calls and the
// geometry they produced in this revision.
function lineIndex(model, modelId, bodies, context) {
  const { operations } = context;
  const files = new Map();
  const entryFor = (sha256, file, line) => {
    if (!sha256 || !line) return null;
    if (!files.has(sha256)) files.set(sha256, { sha256, file: file ?? null, lines: {} });
    const document = files.get(sha256);
    document.file ??= file ?? null;
    document.lines[line] ??= { line, operations: [], links: [], targets: [], notes: [] };
    return document.lines[line];
  };
  const summary = op => ({
    sequence: op.sequence, name: op.name, operationId: op.operationId ?? null,
  });
  // Direct products of every operation.
  const products = new Map(operations.map(op => [op.sequence, []]));
  const addProduct = (op, relation, targets) => {
    if (!op || !targets.length) return;
    products.get(op.sequence).push({ relation, targets });
  };
  const liveBodies = new Set(model.bodies.map(body => body.id));
  const creator = new Map();
  for (const op of operations) {
    for (const output of op.outputs ?? []) creator.set(output.bodyId, op);
  }

  model.bodies.forEach((body, bodyIndex) => {
    const links = bodies[bodyIndex];
    const own = context.bodyOperation.get(body.id);
    addProduct(own, 'operation', [targetOf(modelId, body, bodyIndex, 'body', 0)]);
    // Face- and edge-level sketch sources.
    for (const [kind, list] of [['face', links.faces], ['edge', links.edges]]) {
      list.forEach((entity, index) => {
        const sketch = entity.sketchEntity;
        if (!sketch) return;
        const target = targetOf(modelId, body, bodyIndex, kind, index);
        addProduct(operations.find(op => op.sequence === sketch.operation), 'sketch-entity',
          [target]);
        for (const op of operations) {
          if (SKETCH_LEVEL.has(op.name) && sketch.sketchId && sketchIdOf(op) === sketch.sketchId) {
            addProduct(op, 'sketch', [target]);
          }
        }
      });
    }
    // Boolean construction origins: result entities from input bodies.
    const fromOrigins = new Set();
    for (const [kind, list] of [['face', links.faces], ['edge', links.edges]]) {
      list.forEach((entity, index) => {
        for (const origin of entity.origins ?? []) {
          const inputs = origin.inputs.map(id => creator.get(id) ?? context.byOperationId.get(id));
          for (const op of new Set(inputs.filter(Boolean))) {
            if (op === own) continue;
            fromOrigins.add(op);
            addProduct(op, 'boolean-origin', [targetOf(modelId, body, bodyIndex, kind, index)]);
          }
        }
      });
    }
    // Recorded lineage without face correspondence: the whole body.
    const ancestors = ancestorIds(body, model);
    for (const op of operations) {
      if (op === own || fromOrigins.has(op)) continue;
      // Only calls that created bodies, none of which is still in the model.
      const outputs = (op.outputs ?? []).map(output => output.bodyId);
      if (!outputs.length || outputs.some(id => liveBodies.has(id))) continue;
      if (outputs.some(id => ancestors.has(id)) || ancestors.has(op.operationId)) {
        addProduct(op, 'descendant', [targetOf(modelId, body, bodyIndex, 'body', 0)]);
      }
    }
  });

  const merge = (entry, relation, op, targets, extra = {}) => {
    let link = entry.links.find(item => item.relation === relation && item.via === extra.via);
    if (!link) {
      link = { relation, ...extra, operations: [], targets: [] };
      entry.links.push(link);
    }
    if (!link.operations.includes(op.sequence)) link.operations.push(op.sequence);
    for (const target of targets) {
      if (!link.targets.some(item => item.alias === target.alias)) link.targets.push(target);
      if (!entry.targets.some(item => item.alias === target.alias)) entry.targets.push(target);
    }
  };

  for (const op of operations) {
    const source = op.source ?? {};
    const entry = entryFor(source.sha256, source.file, source.span?.line);
    const produced = products.get(op.sequence);
    if (entry) {
      if (!entry.operations.some(item => item.sequence === op.sequence)) {
        entry.operations.push(summary(op));
      }
      for (const product of produced) merge(entry, product.relation, op, product.targets);
      const removed = (op.removedBodies ?? []).filter(id => !liveBodies.has(id));
      if (removed.length) {
        entry.notes.push({ kind: 'removed-bodies', operation: op.sequence, bodies: removed });
      }
      const gone = (op.outputs ?? []).filter(output => !liveBodies.has(output.bodyId));
      if (gone.length && !produced.length) {
        entry.notes.push({
          kind: 'outputs-not-in-model', operation: op.sequence,
          bodies: gone.map(output => output.bodyId),
        });
      }
      if (op.status === 'failed') {
        entry.notes.push({ kind: 'failed', operation: op.sequence, error: op.error ?? null });
      }
    }
    // Helper calls: every frame that was called from a line.
    const targets = produced.flatMap(product => product.targets);
    for (const frame of callPath(op.callStack)) {
      if (!frame.calledAt?.line) continue;
      const site = entryFor(source.sha256, source.file, frame.calledAt.line);
      if (!site) continue;
      if (!targets.length) {
        if (!site.links.some(link => link.relation === 'call' && link.via === frame.name)) {
          site.links.push({ relation: 'call', via: frame.name, operations: [], targets: [] });
        }
        const link = site.links.find(item => item.relation === 'call' && item.via === frame.name);
        if (!link.operations.includes(op.sequence)) link.operations.push(op.sequence);
        continue;
      }
      merge(site, 'call', op, targets, { via: frame.name });
    }
  }
  const order = relation => RELATIONS.indexOf(relation);
  for (const document of files.values()) {
    for (const entry of Object.values(document.lines)) {
      entry.links.sort((a, b) => order(a.relation) - order(b.relation));
    }
  }
  return [...files.values()];
}

export function operationHistory(model, { modelId = null } = {}) {
  const operations = model?.sourceMap?.operations ?? [];
  const bodies = model?.bodies ?? [];
  const byOperationId = new Map();
  for (const op of operations) {
    if (op.operationId && !byOperationId.has(op.operationId)) byOperationId.set(op.operationId, op);
  }
  const bodyOperation = new Map();
  for (const body of bodies) {
    const op = operations.find(item => item.sequence === body.debug?.sourceOperation)
      ?? operations.find(item => item.outputs?.some(output => output.bodyId === body.id));
    if (op) bodyOperation.set(body.id, op);
  }
  const aliases = new Map(bodies.map((body, index) => [body.id, `B${index + 1}`]));
  const context = { operations, byOperationId, bodyOperation };
  const bodyLinks = bodies.map((body, index) => entityLinks(model, body, index, context));
  return {
    schema: HISTORY_SCHEMA,
    modelId,
    available: !!model?.sourceMap,
    source: model?.sourceMap?.source ?? null,
    exactness: { operations: 'recorded', links: 'recorded', parameters: 'design-parameter' },
    scope: model?.sourceMap ? SCOPE : 'This revision has no recorded source map.',
    parameterUnits: 'parameters as recorded (SI: meter, radian); parametersDisplay in mm and deg',
    operations: operations.map(op => operationRecord(op, aliases)),
    bodies: bodies.map((body, index) => ({
      alias: `B${index + 1}`,
      id: body.id,
      ...(body.name ? { name: body.name } : {}),
      operation: bodyOperation.get(body.id)?.sequence ?? null,
      ...bodyLinks[index],
    })),
    files: lineIndex(model ?? { bodies: [] }, modelId, bodyLinks, context),
  };
}
