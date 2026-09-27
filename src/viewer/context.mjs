// LLM context, copied references and the review Markdown (spec 3.5, 3.7, D7).
// Package: reviews-context.
//
// Two audiences:
//   - saved reviews: contextText(record, …) is written next to the review
//     (<id>.context.md, port-independent: empty origin prefix) and served
//     with the live origin by GET /api/feedback/:id/context;
//   - copy actions: copyText(kind, request, …) builds what Copy reference(s),
//     Copy selected geometry, Copy model overview and Copy LLM context put on
//     the clipboard (POST /api/context).
//
// Rules:
//   - Every model a text names with a command is archived by the caller
//     first, so each `wonky-inspect` command resolves after the server stops.
//     Commands use the absolute path of this repository's bin/wonky-inspect.mjs
//     and of the archived snapshot, so they run from any directory.
//   - Scope: the displayed model, the before model only in compare mode, and
//     models an annotation targets or showed. A hidden compare model is never
//     named.
//   - Exact data is inlined from the stored analytic parameters
//     (src/viewer/geometry.mjs, `exact-parameters` with tolerance t) and
//     measurements from src/viewer/measure.mjs. Display meshes are never read;
//     recorded values that are null read "not evaluated".
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatGeometrySummary } from '../geometry-summary.mjs';
import { formatAngle, formatLength, formatTolerance } from '../../viewer/core/format.js';
import { classifyEdges } from './edge-classes.mjs';
import { aliasOf, cachedLogicalFaces, geometryEntities, logicalGroup } from './geometry.mjs';
import { HttpError } from './http.mjs';
import { measureEntities } from './measure.mjs';

export const INSPECT_SCRIPT = fileURLToPath(new URL('../../bin/wonky-inspect.mjs',
  import.meta.url));
export const REFERENCES_SCHEMA = 'wonky.viewer-references/1';
export const REFERENCE_POLICY = 'Bound to the immutable model revision (modelId); aliases are'
  + ' positions in that exact snapshot, not persistent identity.';
export const COPY_KINDS = Object.freeze(['references', 'geometry', 'overview', 'llm']);
export const MAX_COPY_REFERENCES = 64;

const ENTITY_KEYS = { face: 'faces', edge: 'edges', vertex: 'vertices' };
const ENTITY_TYPES = ['body', 'face', 'edge', 'vertex'];
const MODEL_ID = /^[a-f0-9]{64}$/;
const SAFE_WORD = /^[A-Za-z0-9_/.,:@%+=-]+$/;
const IDENTITY_KEYS = ['originId', 'instanceId', 'revision', 'stability', 'role', 'operationId'];
const UNRESOLVED = 'unsupported-split-merge-correspondence';
const UNRESOLVED_NOTE = 'Input ancestry is known; split/merge correspondence for output'
  + ' topology is unresolved.';
const SCOPE_NOTE = 'Aliases (B1.F3) refer only to the exact model revision (modelId) named with'
  + ' them. Screen drawings are view-bound annotations, not model geometry.';
const EXACT_NOTE = 'Exactness: "exact ±t" is a closed form over the stored analytic parameters'
  + ' with tolerance t; "recorded" is build-time metadata (null reads "not evaluated"). No'
  + ' display-mesh value is included.';

// Shell word: bare when it has only safe characters, else single-quoted.
export const shellQuote = value => (SAFE_WORD.test(String(value))
  ? String(value) : `'${String(value).replace(/'/g, "'\\''")}'`);

// `node <repo>/bin/wonky-inspect.mjs <snapshot> [--revision <id> --detail <alias>]`
export function inspectCommand(snapshot, { modelId, alias, bodiesOnly = false } = {}) {
  const words = ['node', shellQuote(INSPECT_SCRIPT), shellQuote(snapshot)];
  if (alias) words.push('--revision', modelId, '--detail', alias);
  else if (bodiesOnly) words.push('--bodies-only');
  return words.join(' ');
}

// References ------------------------------------------------------------------

const isReference = value => value && typeof value === 'object'
  && typeof value.modelId === 'string' && MODEL_ID.test(value.modelId)
  && typeof value.bodyId === 'string' && ENTITY_TYPES.includes(value.entityType)
  && Number.isInteger(value.entityIndex) && value.entityIndex >= 0;

// Exactly {modelId, bodyId, entityType, entityIndex} in this key order.
export const canonicalReference = value => ({
  modelId: value.modelId, bodyId: value.bodyId, entityType: value.entityType,
  entityIndex: value.entityIndex,
});

// Validates posted selection references against the known revisions: 400 on
// malformed input, 404 on an unknown revision.
export function readReferences(value, { has, max = MAX_COPY_REFERENCES } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'references must be an array');
  if (value.length > max) throw new HttpError(400, `At most ${max} references`);
  return value.map((item, index) => {
    if (!isReference(item)) {
      throw new HttpError(400, `Reference ${index} must be {modelId, bodyId, entityType,`
        + ' entityIndex}');
    }
    if (has && !has(item.modelId)) throw new HttpError(404, 'Unknown model revision');
    return canonicalReference(item);
  });
}

export function readModelIds(value, { has, label = 'visible' } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 8
    || !value.every(id => typeof id === 'string' && MODEL_ID.test(id))) {
    throw new HttpError(400, `${label} must list up to 8 model revision ids`);
  }
  for (const id of value) {
    if (has && !has(id)) throw new HttpError(404, 'Unknown model revision');
  }
  return [...new Set(value)];
}

// The body, entity and alias of a reference in its model (404 when the
// reference does not exist in that frozen revision).
export function locateReference(model, reference) {
  const bodyIndex = model.bodies.findIndex(body => body.id === reference.bodyId);
  const body = model.bodies[bodyIndex];
  if (!body) throw new HttpError(404, `Unknown body ${reference.bodyId}`);
  const key = ENTITY_KEYS[reference.entityType];
  const inRange = reference.entityType === 'body'
    ? reference.entityIndex === 0 : reference.entityIndex < body[key].length;
  if (!inRange) {
    throw new HttpError(404, `${reference.entityType} ${reference.entityIndex} is outside its`
      + ' frozen revision');
  }
  return {
    body, bodyIndex, key,
    alias: aliasOf(bodyIndex, reference.entityType, reference.entityIndex),
  };
}

// Compact identity, as the browser's Copy reference writes it (lineage
// without history; the split/merge ambiguity is stated, never invented away).
export function compactIdentity(identity, body) {
  if (!identity) return null;
  const compact = {};
  for (const key of IDENTITY_KEYS) {
    if (identity[key] !== undefined) compact[key] = identity[key];
  }
  if (identity.lineage) {
    compact.lineage = Object.fromEntries(Object.entries(identity.lineage)
      .filter(([key]) => key !== 'history'));
    if (identity.lineage.matching === UNRESOLVED) {
      compact.lineage.ambiguity ??= body.identity?.lineage?.ambiguity ?? UNRESOLVED_NOTE;
    }
  }
  return compact;
}

export const bodySource = body => body.identity?.operation?.source ?? body.debug?.source ?? null;

// Reference with alias, logical face, compact identity and source.
export function referenceRecord(model, reference, { logical = cachedLogicalFaces(model) } = {}) {
  const { body, bodyIndex, key, alias } = locateReference(model, reference);
  const identity = reference.entityType === 'body'
    ? body.identity : body.identity?.topology?.[key]?.[reference.entityIndex];
  const group = reference.entityType === 'face'
    ? logicalGroup(logical, bodyIndex, reference.entityIndex) : null;
  const source = bodySource(body);
  return {
    ...canonicalReference(reference),
    alias,
    ...(group ? { logical: { alias: group.alias, fragments: group.fragments } } : {}),
    identity: compactIdentity(identity, body),
    ...(source ? { source } : {}),
  };
}

// Exact data ------------------------------------------------------------------

const trimmed = text => text.replace(/\.?0+$/, '').replace(/^-0$/, '0');
const direction = vector => `(${vector.map(value => trimmed(value.toFixed(6))).join(', ')})`;
const point = (vector, toleranceMm) => `(${vector.map(value => formatLength(value, toleranceMm,
  { unit: '' })).join(', ')}) mm`;
const exactChip = toleranceMm => `exact ±${formatTolerance(toleranceMm)}`;

function faceLine(entry) {
  const { surface: s, toleranceMm: t } = entry;
  if (s.unsupported) return `${s.type} face · unsupported: ${s.unsupported}`;
  if (s.type === 'plane') {
    return `plane · outward normal ${direction(s.normal)} · offset ${formatLength(s.offsetMm, t)}`
      + ` along the normal · ${exactChip(t)}`;
  }
  if (s.type === 'cylinder') {
    return `cylinder ${s.sense} Ø${formatLength(s.diameterMm, t)} (r ${formatLength(s.radiusMm,
      t)}) · axis ${direction(s.axis.direction)} through ${point(s.axis.pointNearestOriginMm,
      t)} (nearest the origin) · ${exactChip(t)}`;
  }
  return `cone ${s.sense} · half angle ${formatAngle(s.halfAngleDeg)} · r ${formatLength(
    s.radiusAtOriginMm, t)} at ${point(s.originMm, t)} · axis ${direction(s.axis.direction)}`
    + ` · ${exactChip(t)}`;
}

function edgeLine(entry) {
  const { curve: c, toleranceMm: t } = entry;
  const length = Number.isFinite(entry.lengthMm) ? ` · length ${formatLength(entry.lengthMm, t)}`
    : '';
  const kind = entry.class ? ` · ${entry.class} edge` : '';
  if (entry.unsupported) return `${c.type} edge${length} · unsupported: ${entry.unsupported}`;
  if (c.type === 'line') {
    return `line${length} · from ${point(c.startMm, t)} to ${point(c.endMm, t)}${kind}`
      + ` · ${exactChip(t)}`;
  }
  return `${c.full ? 'circle' : 'arc'} Ø${formatLength(c.diameterMm, t)} · center ${point(
    c.centerMm, t)} · normal ${direction(c.normal)} · sweep ${formatAngle(c.sweepDeg)}${length}`
    + `${kind} · ${exactChip(t)}`;
}

function bodyLine(body) {
  const volume = body.validation?.volumeMm3;
  const bounds = body.validation?.boundsMm;
  const size = bounds ? bounds.max.map((value, axis) => value - bounds.min[axis]) : null;
  return `body ${JSON.stringify(body.name ?? body.id)} · ${body.faces.length} faces,`
    + ` ${body.edges.length} edges, ${body.vertices.length} vertices · volume `
    + `${Number.isFinite(volume) ? `${volume} mm³ recorded` : 'not evaluated'} · bounds `
    + `${size ? `${size.map(value => trimmed(value.toFixed(4))).join(' × ')} mm recorded`
      : 'not evaluated'}`;
}

// One line of exact data for an entry of geometry.mjs (or a body).
export function summaryLine(entry) {
  if (entry.surface) return faceLine(entry);
  if (entry.curve) return edgeLine(entry);
  if (entry.point) return `point ${point(entry.point, entry.toleranceMm)} · `
    + exactChip(entry.toleranceMm);
  return bodyLine(entry);
}

const classesCache = new WeakMap();
const classesOf = model => {
  if (!classesCache.has(model)) classesCache.set(model, classifyEdges(model));
  return classesCache.get(model);
};

// {alias -> {entry, text, exactness, toleranceMm}} for the references of one
// model. Bodies get their recorded counts, volume and bounds.
export function exactSummaries(model, modelId, references, { kernel }) {
  const located = references.map(reference => ({ reference, ...locateReference(model,
    reference) }));
  const aliases = located.filter(item => item.reference.entityType !== 'body')
    .map(item => item.alias);
  const result = new Map();
  if (aliases.length) {
    const tables = geometryEntities(model, {
      aliases, kernel, modelId, logical: cachedLogicalFaces(model), classes: classesOf(model),
    });
    for (const entry of [...tables.faces, ...tables.edges, ...tables.vertices]) {
      result.set(entry.alias, {
        text: summaryLine(entry), exactness: entry.exactness, toleranceMm: entry.toleranceMm,
        entry,
      });
    }
  }
  for (const item of located.filter(value => value.reference.entityType === 'body')) {
    result.set(item.alias, {
      text: summaryLine(item.body), exactness: 'recorded', toleranceMm: null,
      entry: {
        alias: item.alias, id: item.body.id, name: item.body.name ?? null,
        counts: {
          faces: item.body.faces.length, edges: item.body.edges.length,
          vertices: item.body.vertices.length,
        },
        volumeMm3: item.body.validation?.volumeMm3 ?? null,
        boundsMm: item.body.validation?.boundsMm ?? null,
        exactness: 'recorded',
      },
    });
  }
  return result;
}

// Groups references by model, keeping their order.
export function byModel(references) {
  const groups = new Map();
  references.forEach((reference, index) => {
    if (!groups.has(reference.modelId)) groups.set(reference.modelId, []);
    groups.get(reference.modelId).push({ reference, index });
  });
  return groups;
}

// Measurement lines (measure.mjs rows) for one model's references.
export function measurementLines(result) {
  const value = row => {
    if (row.unit === 'mm') return formatLength(row.value, row.toleranceMm ?? 0.0001);
    if (row.unit === 'deg') return formatAngle(row.value);
    return String(row.value);
  };
  const chip = row => {
    if (row.exactness !== 'exact-parameters') return row.exactness;
    return row.toleranceMm > 0 ? exactChip(row.toleranceMm) : 'exact';
  };
  // Inputs are "B1.F3@<modelId>"; the heading already names the model.
  const inputs = row => (row.inputs ?? []).map(input => String(input).split('@')[0]).join(', ');
  return [
    ...result.measurements.map(row => `- ${row.label}: ${value(row)} · ${chip(row)}`
      + `${row.note ? ` · ${row.note}` : ''} · ${inputs(row)}`),
    ...result.unsupported.map(row => `- unsupported (${row.quantity}): ${row.reason}`
      + `${row.inputs?.length ? ` · ${inputs(row)}` : ''}`),
  ];
}

// Revisions -------------------------------------------------------------------

// "r3 of /path/part.fs (live)", "input /path/model.brep.json", "archived snapshot".
export function revisionText(metadata, { snapshotDirectory } = {}) {
  if (!metadata) return 'unknown revision';
  const live = metadata.live;
  if (live && Number.isInteger(live.revision)) {
    const path = live.path ?? live.sourcePath ?? metadata.sourcePath ?? 'live source';
    return `r${live.revision} of ${path} (live${live.previousSession ? ', previous session' : ''})`;
  }
  const path = metadata.sourcePath ?? '';
  if (snapshotDirectory && path.startsWith(snapshotDirectory)) return 'archived snapshot';
  return path ? `input ${path}` : 'input';
}

const modelHeading = metadata => metadata?.label ?? 'Model';

function snapshotLines(id, snapshot) {
  return [
    `- snapshot: ${snapshot}`,
    `- overview: ${inspectCommand(snapshot, { bodiesOnly: true })}`,
    `- detail (replace the alias): ${inspectCommand(snapshot, { modelId: id, alias: 'B1.F1' })}`,
  ];
}

// Saved review context ---------------------------------------------------------

// Models a review shows, in order, with the reason each is included. The
// before model is included only when compare was on (for the review or an
// annotation's view); annotated models always are.
export function reviewScope(record) {
  const scope = new Map();
  const add = (id, reason) => {
    if (!id) return;
    if (!scope.has(id)) scope.set(id, new Set());
    scope.get(id).add(reason);
  };
  const { comparison } = record;
  add(comparison.after, 'displayed');
  if (comparison.compare !== false) add(comparison.before, 'compare before');
  for (const annotation of record.annotations ?? []) {
    if (annotation.target) add(annotation.target.modelId, 'annotated');
    const view = annotation.view;
    if (!view) continue;
    add(view.after, 'annotation view');
    if (view.compare !== false) add(view.before, 'annotation view (compare before)');
  }
  return [...scope].map(([id, reasons]) => ({ id, reasons: [...reasons] }));
}

// The alias of an annotation target. Targets saved before reviews stored
// aliases carry only bodyId/entityType/entityIndex; the alias is derived from
// the frozen revision exactly as validateReview does (null when the revision
// or the entity is unavailable, never guessed).
export function targetAlias(target, raw) {
  if (typeof target?.alias === 'string' && target.alias) return target.alias;
  if (!raw) return null;
  try {
    return locateReference(raw, target).alias;
  } catch {
    return null;
  }
}

const entityText = target => `${target.bodyId} ${target.entityType} ${target.entityIndex}`;

const annotationHead = (annotation, index, alias) => {
  const target = annotation.target;
  const on = target
    ? ` on ${alias ?? entityText(target)} (${target.entityType}, model ${target.modelId})`
    : ' (view annotation, no model entity)';
  return `${index + 1}. ${annotation.tool}${on}: ${annotation.text}`;
};

function safeSummaries(model, id, references, kernel) {
  try {
    return { summaries: exactSummaries(model, id, references, { kernel }) };
  } catch (error) {
    return { summaries: new Map(), error: error.message };
  }
}

// The review's LLM context. `kernel` (optional) inlines exact data for the
// annotation targets; without it the lines say "exact data unavailable".
export function contextText(record, {
  originPrefix, reviewDirectory, snapshotDirectory, inspector, model = () => null, kernel = null,
}) {
  const review = originPrefix ? 'Review' : 'Review route at the current viewer server';
  const snapshotOf = id => join(snapshotDirectory, `${id}.brep.json`);
  const labelOf = id => record.revisions?.find(revision => revision.sha256 === id)?.label;
  const lines = [
    `# ${record.id}: ${record.title}`, '',
    ...(record.notes?.trim() ? [record.notes, ''] : []),
    `${review}: ${originPrefix}/viewer/#review=${record.id}`,
    `Structured feedback: ${join(reviewDirectory, record.id + '.json')}`, '',
    SCOPE_NOTE, '',
  ];
  const targets = (record.annotations ?? []).map(annotation => annotation.target)
    .filter(Boolean);
  const exact = new Map();
  for (const [id, items] of byModel(targets)) {
    const raw = model(id);
    const found = raw && kernel
      ? safeSummaries(raw, id, items.map(item => item.reference), kernel)
      : { summaries: new Map(), error: kernel ? 'model unavailable' : 'kernel unavailable' };
    exact.set(id, found);
  }
  if (record.annotations?.length) lines.push('## Annotations', '');
  record.annotations?.forEach((annotation, index) => {
    const target = annotation.target;
    const alias = target ? targetAlias(target, model(target.modelId)) : null;
    lines.push(annotationHead(annotation, index, alias));
    if (!target) return;
    const found = exact.get(target.modelId);
    const summary = alias ? found?.summaries.get(alias) : null;
    lines.push(summary ? `   exact: ${summary.text}`
      : `   exact data unavailable: ${found?.error ?? 'not resolved'}`);
    lines.push(alias
      ? `   detail: ${inspectCommand(snapshotOf(target.modelId), {
        modelId: target.modelId, alias,
      })}`
      : `   detail unavailable: ${entityText(target)} is not in the stored revision`);
  });
  if (record.annotations?.length) lines.push('');
  const scope = reviewScope(record);
  for (const { id, reasons } of scope) {
    const modelInspector = inspector(id);
    if (!modelInspector) throw new Error('Review model snapshot is unavailable');
    const route = originPrefix ? '' : ' route at the current viewer server';
    lines.push(
      `## Model ${labelOf(id) ? `${labelOf(id)} · ` : ''}${id} (${reasons.join(', ')})`, '',
      formatGeometrySummary(modelInspector.summary({ includeFaces: false })),
      `Entity details${route}: ${originPrefix}/api/models/${id}/entities/B1.F1`,
      `Local detail command (replace alias): ${inspectCommand(snapshotOf(id), {
        modelId: id, alias: 'B1.F1',
      })}`,
      '',
    );
  }
  const hidden = record.models.filter(id => !scope.some(entry => entry.id === id));
  if (hidden.length) {
    lines.push(`Not included (hidden in the saved view): ${hidden.length} referenced`
      + ` revision${hidden.length === 1 ? '' : 's'}.`, '');
  }
  lines.push(EXACT_NOTE);
  return lines.join('\n') + '\n';
}

export function reviewMarkdown(complete, { origin, file }) {
  const target = annotation => (annotation.target
    ? ` on ${annotation.target.alias ?? annotation.target.bodyId} (${annotation.target.entityType},`
      + ` revision ${annotation.target.modelId})`
    : '');
  const lines = [
    `# ${complete.id}: ${complete.title}`, '', complete.notes, '',
    `Review: ${origin}/viewer/#review=${complete.id}`, `Structured feedback: ${file}`, '',
    ...complete.revisions.map(revision => `- Model ${revision.label}: ${revision.sha256}; `
      + `snapshot ${revision.snapshot}`),
    '',
    ...complete.annotations.map((annotation, index) => `${index + 1}. ${annotation.tool}`
      + `${target(annotation)}: ${annotation.text}`),
  ];
  return lines.join('\n') + '\n';
}

// Copy actions ------------------------------------------------------------------

// Models a copy request names (they are archived before the text is built).
export function copyModels(kind, { references = [], visible = [], previous = null }) {
  const ids = new Set();
  if (kind === 'overview') ids.add(visible[0]);
  else for (const reference of references) ids.add(reference.modelId);
  if (kind === 'llm') {
    for (const id of visible) ids.add(id);
    if (previous) ids.add(previous);
  }
  return [...ids].filter(Boolean);
}

function referencesText(references, env) {
  const records = references.map(reference => {
    const model = env.model(reference.modelId);
    const record = referenceRecord(model, reference);
    const snapshot = env.snapshots.get(reference.modelId);
    const summary = env.summaries(reference.modelId).get(record.alias);
    return {
      ...record,
      ...(summary ? { exact: summary.text } : {}),
      snapshot,
      inspect: inspectCommand(snapshot, { modelId: reference.modelId, alias: record.alias }),
    };
  });
  if (records.length === 1) return JSON.stringify(records[0], null, 2);
  return JSON.stringify({
    schema: REFERENCES_SCHEMA, count: records.length, references: records,
    referencePolicy: REFERENCE_POLICY,
  }, null, 2);
}

function geometryText(reference, env) {
  const model = env.model(reference.modelId);
  const { alias } = locateReference(model, reference);
  const detail = env.inspector(reference.modelId).detail({ modelId: reference.modelId, alias });
  const summary = env.summaries(reference.modelId).get(alias);
  const snapshot = env.snapshots.get(reference.modelId);
  return JSON.stringify({
    ...detail,
    exact: summary ? { text: summary.text, ...summary.entry } : null,
    inspect: {
      snapshot, command: inspectCommand(snapshot, { modelId: reference.modelId, alias }),
    },
  }, null, 2);
}

function overviewText(id, env) {
  const snapshot = env.snapshots.get(id);
  return formatGeometrySummary(env.inspector(id).summary({ includeFaces: false }))
    + ['', `Revision: ${revisionText(env.metadata(id), env)}`, ...snapshotLines(id, snapshot)]
      .join('\n') + '\n';
}

const quantity = value => (Number.isInteger(value) ? String(value)
  : trimmed(value.toFixed(4)));

function deltaText(delta, unit = '') {
  const { before, after } = delta ?? {};
  if (!Number.isFinite(before) || !Number.isFinite(after)) return 'not evaluated';
  return `${quantity(before)} → ${quantity(after)}${unit}`;
}

function changeLines(previous, id, env) {
  const result = env.compare(previous, id);
  if (!result) return [];
  const { deltas, sourceLines } = result;
  const volume = deltas.volumeMm3?.status === 'evaluated'
    ? `volume ${deltaText(deltas.volumeMm3, ' mm³')} recorded` : 'volume not evaluated';
  const size = deltas.bounds?.status === 'evaluated'
    ? `size Δ (${deltas.bounds.delta.size.map(quantity).join(', ')}) mm ${deltas.bounds.exactness}`
    : 'size Δ not evaluated';
  const changed = sourceLines?.status === 'changed'
    ? `source: lines ${(sourceLines.changed ?? []).slice(0, 20).join(', ') || 'none'} changed`
    : `source: ${sourceLines?.status ?? 'unavailable'}`;
  const modules = sourceLines?.modules;
  const imports = modules && sourceLines.modulesChanged ? `; imported modules: ${[
    ...modules.changed.map(path => `${path} changed`),
    ...modules.added.map(path => `${path} added`),
    ...modules.removed.map(path => `${path} removed`)].join(', ')}` : '';
  return [
    `## Changes since ${revisionText(env.metadata(previous), env)} (${previous})`, '',
    `- bodies ${deltaText(deltas.bodies)}, faces ${deltaText(deltas.faces)} (logical`
      + ` ${deltaText(deltas.logicalFaces)}), edges ${deltaText(deltas.edges)}, ${volume}`,
    `- ${size}; ${changed}${imports}`,
    '- counts compare the stored B-rep of both revisions; bodies are matched by body id;'
      + ' no geometric correspondence is inferred.',
    '',
  ];
}

function selectionLines(references, env) {
  if (!references.length) return ['## Selection', '', 'Nothing is selected.', ''];
  const lines = [`## Selection (${references.length})`, ''];
  references.forEach((reference, index) => {
    const model = env.model(reference.modelId);
    const record = referenceRecord(model, reference);
    const body = model.bodies.find(item => item.id === reference.bodyId);
    const summary = env.summaries(reference.modelId).get(record.alias);
    const snapshot = env.snapshots.get(reference.modelId);
    lines.push(`${index + 1}. ${record.alias} · ${reference.entityType} of body`
      + ` ${JSON.stringify(body.name ?? body.id)} · model ${reference.modelId}`);
    if (record.logical && record.logical.fragments.length > 1) {
      lines.push(`   logical face ${record.logical.alias} (fragments`
        + ` ${record.logical.fragments.join(', ')})`);
    }
    lines.push(`   exact: ${summary?.text ?? 'unavailable'}`);
    if (record.identity) {
      lines.push(`   identity: ${record.identity.stability ?? 'unattributed'}`
        + `${record.identity.role ? ` · role ${JSON.stringify(record.identity.role)}` : ''}`);
    }
    if (record.source) {
      const span = record.source.span;
      lines.push(`   source: ${record.source.file ?? '<unknown file>'}`
        + `${span?.line ? `:${span.line}${span.column ? `:${span.column}` : ''}` : ''}`);
    }
    lines.push(`   detail: ${inspectCommand(snapshot, {
      modelId: reference.modelId, alias: record.alias,
    })}`);
    if (summary?.entry && reference.entityType !== 'body') {
      lines.push(`   data: ${JSON.stringify(summary.entry)}`);
    }
  });
  lines.push('');
  for (const [id, items] of byModel(references)) {
    if (items.length < 2) continue;
    const result = env.measure(id, items.map(item => item.reference));
    lines.push(`## Measurement (${items.length} entities of ${id})`, '',
      ...measurementLines(result), '');
  }
  if (byModel(references).size > 1) {
    lines.push('Entities from different revisions are not measured against each other.', '');
  }
  return lines;
}

function llmText({ references, visible, previous }, env) {
  const [displayed] = visible;
  const lines = [
    `# wonky context · ${modelHeading(env.metadata(displayed))}`, '',
    'Scope: the model(s) visible in the viewer and the current selection; hidden compare'
      + ' models are not included.',
    SCOPE_NOTE, '',
  ];
  visible.forEach((id, index) => {
    const metadata = env.metadata(id);
    const role = index === 0 ? 'displayed' : 'compare before';
    lines.push(`## Model ${modelHeading(metadata)} (${role})`, '', `- modelId: ${id}`,
      `- revision: ${revisionText(metadata, env)}`, ...snapshotLines(id, env.snapshots.get(id)),
      '', formatGeometrySummary(env.inspector(id).summary({ includeFaces: false })));
  });
  if (previous && displayed && previous !== displayed) {
    lines.push(...changeLines(previous, displayed, env));
    lines.push(`- previous snapshot: ${env.snapshots.get(previous)}`, '');
  }
  lines.push(...selectionLines(references, env), EXACT_NOTE);
  return lines.join('\n') + '\n';
}

// Text for a copy action. `env` gives model(id), metadata(id), inspector(id),
// snapshots (Map id -> archived path), kernel, snapshotDirectory, and
// optionally compare(beforeId, afterId) for the change summary.
export function copyText(kind, request, env) {
  const summaryCache = new Map();
  const context = {
    ...env,
    summaries(id) {
      if (!summaryCache.has(id)) {
        const refs = request.references.filter(reference => reference.modelId === id);
        summaryCache.set(id, exactSummaries(env.model(id), id, refs, { kernel: env.kernel }));
      }
      return summaryCache.get(id);
    },
    measure: (id, refs) => measureEntities(env.model(id), refs, {
      kernel: env.kernel, modelId: id, logical: cachedLogicalFaces(env.model(id)),
    }),
    compare: env.compare ?? (() => null),
  };
  if (kind === 'references') {
    if (!request.references.length) throw new HttpError(400, 'Copy references needs a selection');
    return { format: 'json', text: referencesText(request.references, context) };
  }
  if (kind === 'geometry') {
    const [reference] = request.references;
    if (!reference) throw new HttpError(400, 'Copy selected geometry needs a selection');
    return { format: 'json', text: geometryText(reference, context) };
  }
  if (kind === 'overview') {
    if (!request.visible[0]) throw new HttpError(400, 'Copy model overview needs a model');
    return { format: 'text', text: overviewText(request.visible[0], context) };
  }
  if (kind === 'llm') {
    if (!request.visible.length) throw new HttpError(400, 'LLM context needs a visible model');
    return { format: 'markdown', text: llmText(request, context) };
  }
  throw new HttpError(400, `kind must be one of ${COPY_KINDS.join(', ')}`);
}
