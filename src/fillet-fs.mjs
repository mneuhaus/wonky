// FeatureScript opFillet and opChamfer (std geomOperations.fs) on the
// production fillet (src/fillet-op.mjs, kernel/fillet; docs/fillet-plan.md §8
// step 4). src/library.mjs registers them.
//
// Definition (std geomOperations.fs, v2960 = v3083; docs/research/sources/
// onshape-featurescript-std-library-mirror-opfillet-opchamfer-.md):
//   opFillet  entities, radius; tangentPropagation (default false). The other
//             std keys are accepted at their defaults (crossSection CIRCULAR,
//             allowEdgeOverflow true, isVariable/smoothCorners/
//             createDetachedSurface/isPartial/isAsymmetric false); any other
//             value, and any key wonky does not know, is a capability error.
//   opChamfer entities, chamferType, width (EQUAL_OFFSETS); tangentPropagation
//             (default false), oppositeDirection (no effect on equal offsets).
//             TWO_OFFSETS, OFFSET_ANGLE and RAW_OFFSET are capability errors
//             naming the type.
// Entities are edges and faces (a face stands for all edges of its loops; a
// face a planar Boolean left split into coplanar fragments stands for the
// whole region, as Onshape has one face there: src/fillet-fragments.mjs);
// bodies of the context each get one blend call, committed together only
// after every call built.
//
// Outcomes:
//   - built: the record keeps its identity (queries that found the body find
//     the blended body), its lineage gains the operation id (qCreatedBy(id,
//     BODY) finds the body; FACE and EDGE find only the faces the blend
//     created and their edges), and body.fillet
//     holds the record (engine, claim 'exact', faceRoles, the deterministic
//     stripe order and the selection notes, e.g. "seam-ignored 3");
//   - a refusal Onshape raises for the same input too (ONSHAPE_FAILURES,
//     measured: FP12 FILLET_FAIL_SMOOTH) is an ordinary FeatureScript
//     exception, so try and try silent catch it as in Onshape;
//   - every other refusal is a capability error (UnsupportedFeatureError),
//     which no try catches, also inside try silent.
import { raise, unsupported } from './errors.mjs';
import { EnumValue, isMap, length } from './values.mjs';
import { resolveTopology, recordCreatedEntities } from './queries.mjs';
import { operationEvidence, attachOperationEvidence } from './construction-history.mjs';
import { selectBackend } from './native/backend.mjs';
import { blendBody, refusalMessage, BLEND_ENGINE } from './fillet-op.mjs';
import { fragmentEdges, regionEdges } from './fillet-fragments.mjs';

const enumName = (value, type) => value instanceof EnumValue && value.enumType === type ? value.name : undefined;

// key -> test of the value wonky implements (the std default).
const FILLET_DEFAULTS = {
  crossSection: v => enumName(v, 'FilletCrossSection') === 'CIRCULAR',
  allowEdgeOverflow: v => v === true,
  isVariable: v => v === false, smoothCorners: v => v === false, createDetachedSurface: v => v === false,
  isPartial: v => v === false, isAsymmetric: v => v === false,
};
const CHAMFER_DEFAULTS = { oppositeDirection: v => typeof v === 'boolean' };

function definitionOf(what, definition, required, known, loc) {
  if (!isMap(definition)) raise(`${what} expects a definition map`, loc);
  for (const key of required) if (!Object.hasOwn(definition, key)) raise(`${what} is missing required field '${key}'`, loc);
  for (const [key, value] of Object.entries(definition)) {
    if (required.includes(key) || key === 'tangentPropagation') continue;
    if (!Object.hasOwn(known, key)) unsupported(`${what} field '${key}' is not implemented`, loc); // Onshape passes unknown keys through; wonky cannot tell their effect
    if (!known[key](value)) unsupported(`${what} ${key} other than its default is not implemented`, loc);
  }
  const propagate = definition.tangentPropagation ?? false;
  if (typeof propagate !== 'boolean') raise(`${what} tangentPropagation must be boolean`, loc);
  return propagate;
}

// Selected edges per solid record, in record order; a face adds all edges of
// its loops, or of its coplanar-fragment region without the fragment edges
// between its faces.
function selection(engine, native, what, entities, loc) {
  const rows = resolveTopology(engine, entities, loc);
  const byRecord = new Map();
  for (const row of rows) {
    if (row.record.kind !== 'solid') unsupported(`${what} over sketch bodies is not implemented`, loc);
    if (row.kind === 'body') unsupported(`${what} of a whole body is not implemented; select its edges or faces`, loc);
    const edges = byRecord.get(row.record) ?? new Set();
    if (row.kind === 'edge') edges.add(row.index);
    else for (const edge of regionEdges(row.record.body, fragmentEdges(native, row.record.body), row.index)) edges.add(edge);
    byRecord.set(row.record, edges);
  }
  if (!byRecord.size) unsupported(`${what} entities resolved to no edges`, loc);
  return [...byRecord].map(([record, edges]) => ({ record, edges: [...edges].sort((a, b) => a - b) }));
}

// The faces the blend created (its blend and corner faces; support faces are
// trimmed and cap faces grown, both kept) and the edges bounding them, for
// qCreatedBy(id, FACE | EDGE).
function createdByBlend(body) {
  const faces = body.fillet.faceRoles.flatMap((role, face) => role === 'blend' || role === 'corner' ? [face] : []);
  const edges = new Set(faces.flatMap(face => body.faces[face].loops.flat().map(use => use.edge)));
  return { faces, edges };
}

export function fsBlend(engine, op, [context, id, definition], loc, bodyProperties) {
  const what = op === 'fillet' ? 'opFillet' : 'opChamfer';
  let size, chamferType, propagate;
  if (op === 'fillet') {
    propagate = definitionOf(what, definition, ['entities', 'radius'], FILLET_DEFAULTS, loc);
    size = length(definition.radius, loc);
    if (!(size > 0)) raise(`${what} radius must be positive`, loc);
  } else {
    if (!isMap(definition)) raise(`${what} expects a definition map`, loc);
    const type = enumName(definition.chamferType, 'ChamferType');
    if (type === undefined) raise('opChamfer requires a ChamferType', loc);
    if (type !== 'EQUAL_OFFSETS') unsupported(`opChamfer (${type}) is not implemented; only ChamferType.EQUAL_OFFSETS (a setback along each support face) is`, loc);
    propagate = definitionOf(what, definition, ['entities', 'chamferType', 'width'], CHAMFER_DEFAULTS, loc);
    size = length(definition.width, loc);
    if (!(size > 0)) raise(`${what} width must be positive`, loc);
    chamferType = 'equal-offsets';
  }
  const native = engine.services?.fillet;
  if (!native) unsupported(`${what} needs the production fillet (kernel/fillet), which this build did not load${selectBackend() === 'native' ? ': it runs on the Bend JS target, and the native backend does not include it' : ''}`, loc);
  const targets = selection(engine, native, what, definition.entities, loc);
  engine.claim(context, id, loc);
  const built = targets.map(({ record, edges }, n) => {
    const jobId = targets.length === 1 ? id.toString() : `${id}/${n}`;
    const out = blendBody(native, engine.kernel, { id: jobId, op, size, chamferType, tangentPropagation: propagate, body: record.body, select: edges });
    if (out.status !== 'ok') (out.onshape ? raise : unsupported)(refusalMessage(what, out), loc);
    const evidence = operationEvidence(id.toString(), op, [record.body], engine.modelingPolicy, {
      method: BLEND_ENGINE, status: 'Resolved',
      blend: { op, sizeMm: size, ...(chamferType ? { chamferType } : {}), tangentPropagation: propagate, selected: edges,
        order: out.body.fillet.order, notes: out.body.fillet.notes, quantizationMm: out.quantizationMm },
    });
    attachOperationEvidence([out.body], evidence);
    for (const key of bodyProperties) if (record.body[key] !== undefined) out.body[key] = record.body[key];
    return { record, body: out.body, evidence };
  });
  for (const { record, body, evidence } of built) {
    record.body = body; record.createdBy = new Set([...record.createdBy, id.key()]);
    recordCreatedEntities(engine, id, body, createdByBlend(body));
    engine.operationEvidence.push(evidence);
  }
}
