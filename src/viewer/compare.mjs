// Revision comparison for GET /api/compare. Package: model-first-compare
// (frozen after wave 1).
//
// Frozen signature: compareModels(before, after, { logical }) -> { deltas, sourceLines }
//
// `before` and `after` are revision descriptors
//   { id?, model, displayBounds?: { min, max, toleranceMm },
//     kernelBounds?: result of kernelBounds() / the diffBounds query
//       (src/viewer/diff.mjs): { bodies: [{ bodyId, status, bounds, toleranceMm }] },
//     source?: { file, sha256, language?, text: string | null, reason?,
//                modules?: [{ path, sha256 }] } | null }
// Imported project modules (a Python model's model.source.modules) are
// compared too: `sourceLines.modules` lists the module files whose recorded
// SHA-256 differs, so a rebuild caused by an edited import never reads as
// "source unchanged" alone.
// or bare wonky-brep/1 models. `logical` is a function model -> the result of
// logicalFaces(model) (src/viewer/logical-faces.mjs, the default).
//
// Nothing here computes new geometry. Counts come from the stored B-rep,
// volumes and bounds from the recorded build-time metadata
// (body.validation.volumeMm3 / boundsMm). A null recorded value stays
// "not evaluated", never 0. A body without recorded bounds uses the
// kernel-resolved edge-band bounds of `kernelBounds` when the descriptor
// carries them for that body (label kernel-resolved, diff-overlay). Bounds
// fall back to the display envelope only when a body has neither, and are
// then labelled display-approximation with the display tolerance. Bodies are
// matched by body id only; no geometric correspondence is inferred.
import { logicalFaces as defaultLogicalFaces } from './logical-faces.mjs';
import { changedSourceLines } from './source-diff.mjs';
import { viewerRecord } from './model-record.mjs';

export const COMPARE_SCHEMA = 'wonky.compare/1';
export const REVISIONS_SCHEMA = 'wonky.revisions/1';

export const COMPARE_SCOPE = 'Counts compare the stored B-rep of two exact revisions. Volumes'
  + ' and bounds are recorded build-time values (null: not evaluated) or, for bounds only, the'
  + ' display envelope with its tolerance. Bodies are matched by body id; no geometric'
  + ' correspondence is inferred.';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const triple = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const validBox = value => !!value && triple(value.min) && triple(value.max)
  && value.min.every((entry, index) => entry <= value.max[index]);
const sub = (left, right) => left.map((value, index) => value - right[index]);
const box = ({ min, max }) => ({ min: [...min], max: [...max], size: sub(max, min) });

const union = boxes => ({
  min: [0, 1, 2].map(index => Math.min(...boxes.map(value => value.min[index]))),
  max: [0, 1, 2].map(index => Math.max(...boxes.map(value => value.max[index]))),
});

const isModel = value => value?.schema === 'wonky-brep/1' && Array.isArray(value.bodies);
const descriptorOf = value => (isModel(value) ? { model: value } : value ?? {});

function logicalCounts(model, logical) {
  try {
    const result = logical(model);
    const counts = model.bodies.map((_body, index) => result?.bodies?.[index]?.groups?.length);
    if (!counts.every(Number.isInteger)) throw new Error('logicalFaces returned no groups');
    return { counts, reason: null };
  } catch (error) {
    return { counts: model.bodies.map(() => null), reason: error.message };
  }
}

const KERNEL = 'kernel-resolved';

// Resolved kernel bounds of body `index` of a kernelBounds result (matched by
// position and body id), or null.
function kernelBody(kernelBounds, body, index) {
  const row = kernelBounds?.bodies?.[index];
  if (!row || row.bodyId !== body.id || row.status !== 'resolved' || !validBox(row.bounds)) {
    return null;
  }
  return row;
}

const toleranceOf = row => (finite(row?.toleranceMm) ? row.toleranceMm : 0);

// Per-revision facts: bodies with counts, recorded volume and bounds.
function revisionFacts(descriptor, logical) {
  const { model } = descriptor;
  if (!isModel(model)) throw new TypeError('compareModels needs wonky-brep/1 models');
  const logicalResult = logicalCounts(model, logical);
  const bodies = model.bodies.map((body, index) => {
    const volume = body.validation?.volumeMm3;
    const bounds = body.validation?.boundsMm;
    const recorded = validBox(bounds) ? box(bounds) : null;
    const kernel = recorded ? null : kernelBody(descriptor.kernelBounds, body, index);
    return {
      id: body.id, alias: `B${index + 1}`, name: body.name ?? null,
      faces: body.faces.length, logicalFaces: logicalResult.counts[index],
      edges: body.edges.length, vertices: body.vertices.length,
      volumeMm3: finite(volume) ? volume : null,
      boundsMm: recorded ?? (kernel ? box(kernel.bounds) : null),
      boundsExactness: recorded ? 'recorded' : kernel ? KERNEL : null,
      boundsToleranceMm: toleranceOf(kernel),
    };
  });
  const sum = key => bodies.reduce((total, body) => total + body[key], 0);
  let bounds = null;
  if (bodies.every(body => body.boundsMm)) {
    const kernel = bodies.filter(body => body.boundsExactness === KERNEL);
    bounds = {
      ...box(union(bodies.map(body => body.boundsMm))),
      exactness: kernel.length ? KERNEL : 'recorded',
      ...(kernel.length ? {
        toleranceMm: Math.max(...kernel.map(body => body.boundsToleranceMm)),
        method: descriptor.kernelBounds?.method ?? 'Bend edge bands',
      } : {}),
    };
  } else if (validBox(descriptor.displayBounds)) {
    const reason = descriptor.kernelBounds?.reason;
    bounds = {
      ...box(descriptor.displayBounds), exactness: 'display-approximation',
      toleranceMm: descriptor.displayBounds.toleranceMm ?? 0.02,
      ...(reason ? { kernelReason: reason } : {}),
    };
  }
  return {
    bodies,
    faces: sum('faces'),
    logicalFaces: logicalResult.reason ? null : sum('logicalFaces'),
    logicalReason: logicalResult.reason,
    edges: sum('edges'),
    vertices: sum('vertices'),
    volumeMm3: bodies.every(body => body.volumeMm3 !== null) ? sum('volumeMm3') : null,
    bounds,
  };
}

const count = (before, after) => ({
  before, after,
  delta: Number.isInteger(before) && Number.isInteger(after) ? after - before : null,
});

function volumeDelta(before, after) {
  const missing = [['before', before], ['after', after]]
    .filter(([, value]) => value === null).map(([side]) => side);
  return {
    before, after,
    delta: missing.length ? null : after - before,
    exactness: 'recorded',
    status: missing.length ? 'not evaluated' : 'evaluated',
    ...(missing.length ? { notEvaluated: missing } : {}),
  };
}

// Tolerance of one side: recorded bounds carry none (0), kernel-resolved
// bounds their guard and model tolerance, display envelopes their display
// tolerance. A delta's tolerance is the sum of both sides.
const sideTolerance = side => (side?.exactness === 'recorded' ? 0 : toleranceOf(side));

// A delta is as weak as its weakest side: recorded < kernel-resolved <
// display-approximation (anything unknown counts as display).
function deltaExactness(before, after) {
  const sides = [before.exactness, after.exactness];
  if (sides.every(value => value === 'recorded')) return 'recorded';
  if (sides.every(value => value === 'recorded' || value === KERNEL)) return KERNEL;
  return 'display-approximation';
}

export function boundsDelta(before, after) {
  const result = { before: before ?? null, after: after ?? null, delta: null };
  if (!before || !after) {
    return { ...result, exactness: null, toleranceMm: null, status: 'not evaluated' };
  }
  return {
    ...result,
    status: 'evaluated',
    exactness: deltaExactness(before, after),
    toleranceMm: sideTolerance(before) + sideTolerance(after),
    delta: {
      min: sub(after.min, before.min), max: sub(after.max, before.max),
      size: sub(after.size, before.size),
    },
  };
}

// A body's bounds with their label: recorded, or kernel-resolved with the
// kernel tolerance.
const bodyBox = body => (body?.boundsMm ? {
  ...body.boundsMm, exactness: body.boundsExactness,
  ...(body.boundsExactness === KERNEL ? { toleranceMm: body.boundsToleranceMm } : {}),
} : null);

// Bodies matched by body id, in after order, then removed bodies.
function bodyMatches(before, after) {
  const beforeById = new Map(before.bodies.map(body => [body.id, body]));
  const afterIds = new Set(after.bodies.map(body => body.id));
  const row = (left, right) => ({
    bodyId: (right ?? left).id,
    name: (right ?? left).name,
    alias: { before: left?.alias ?? null, after: right?.alias ?? null },
    status: left && right ? 'matched' : right ? 'added' : 'removed',
    faces: count(left?.faces ?? null, right?.faces ?? null),
    logicalFaces: count(left?.logicalFaces ?? null, right?.logicalFaces ?? null),
    edges: count(left?.edges ?? null, right?.edges ?? null),
    volumeMm3: volumeDelta(left?.volumeMm3 ?? null, right?.volumeMm3 ?? null),
    bounds: boundsDelta(bodyBox(left), bodyBox(right)),
  });
  return [
    ...after.bodies.map(body => row(beforeById.get(body.id) ?? null, body)),
    ...before.bodies.filter(body => !afterIds.has(body.id)).map(body => row(body, null)),
  ];
}

const sourceSummary = source => (source
  ? { file: source.file ?? null, sha256: source.sha256 ?? null, language: source.language ?? null }
  : null);

const missingSide = (before, after) => {
  if (!before && !after) return 'either revision';
  return before ? 'the after revision' : 'the before revision';
};

// Project modules a model recorded (Python: path and SHA-256 of every module
// file the build imported), or null when the model records none.
export function recordedModules(model) {
  const modules = model?.source?.modules;
  if (!Array.isArray(modules)) return null;
  return modules.filter(entry => typeof entry?.path === 'string')
    .map(entry => ({ path: entry.path, sha256: entry.sha256 ?? null }));
}

// Module files changed, added or removed between two recorded module lists;
// null when either side records none.
export function compareModules(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  const left = new Map(before.map(entry => [entry.path, entry.sha256]));
  const right = new Map(after.map(entry => [entry.path, entry.sha256]));
  return {
    changed: [...right].filter(([path, sha]) => left.has(path) && left.get(path) !== sha)
      .map(([path]) => path).sort(),
    added: [...right.keys()].filter(path => !left.has(path)).sort(),
    removed: [...left.keys()].filter(path => !right.has(path)).sort(),
  };
}

const anyModule = modules => !!modules
  && modules.changed.length + modules.added.length + modules.removed.length > 0;

// Changed lines between the recorded top-level sources of both revisions,
// plus the changed module files (`modules`, null when not recorded).
export function compareSources(before, after) {
  const modules = compareModules(before?.modules, after?.modules);
  return { ...compareTopLevel(before, after), modules,
    modulesChanged: anyModule(modules) };
}

function compareTopLevel(before, after) {
  const base = { before: sourceSummary(before), after: sourceSummary(after) };
  if (!before?.sha256 || !after?.sha256) {
    return {
      ...base, status: 'unavailable',
      reason: `No recorded source for ${missingSide(before?.sha256, after?.sha256)}`,
    };
  }
  if (before.sha256 === after.sha256) {
    return { ...base, status: 'unchanged', changed: [], added: [], removed: [] };
  }
  if (before.file && after.file && before.file !== after.file) {
    return {
      ...base, status: 'different-files',
      reason: 'The revisions were built from different source files',
    };
  }
  const missing = [['before', before], ['after', after]]
    .filter(([, source]) => typeof source.text !== 'string');
  if (missing.length) {
    const reasons = missing.map(([, source]) => source.reason).filter(Boolean);
    return {
      ...base, status: 'unavailable',
      reason: 'Frozen source snapshot unavailable for the '
        + `${missing.map(([side]) => side).join(' and ')} revision`
        + (reasons.length ? ` (${reasons.join('; ')})` : ''),
    };
  }
  return { ...base, status: 'changed', ...changedSourceLines(before.text, after.text) };
}

const withModules = descriptor => (descriptor.source ? {
  ...descriptor.source, modules: descriptor.source.modules ?? recordedModules(descriptor.model),
} : null);

export function compareModels(before, after, { logical = defaultLogicalFaces } = {}) {
  before = viewerRecord(before);
  after = viewerRecord(after);
  const left = descriptorOf(before);
  const right = descriptorOf(after);
  const b = revisionFacts(left, logical);
  const a = revisionFacts(right, logical);
  const logicalFaces = count(b.logicalFaces, a.logicalFaces);
  const logicalReason = b.logicalReason ?? a.logicalReason;
  return {
    deltas: {
      bodies: count(b.bodies.length, a.bodies.length),
      faces: count(b.faces, a.faces),
      logicalFaces: logicalReason
        ? { ...logicalFaces, status: 'unavailable', reason: logicalReason } : logicalFaces,
      edges: count(b.edges, a.edges),
      vertices: count(b.vertices, a.vertices),
      volumeMm3: volumeDelta(b.volumeMm3, a.volumeMm3),
      bounds: boundsDelta(b.bounds, a.bounds),
      bodyMatches: bodyMatches(b, a),
    },
    sourceLines: compareSources(withModules(left), withModules(right)),
  };
}

// ---------------------------------------------------------------------------
// Revision facts for GET /api/compare/revisions (grouping in the library).
//
// kind: 'live' (metadata.live, filled by live-server), 'archive' (a snapshot
// under <reviews>/models loaded at startup) or 'input' (a .brep.json input).
// source: the grouping and settings key (live source path, input path, or
// 'archive'). revision: live.revision when live-server provides it, else the
// 1-based registration order within the source (session-local for inputs);
// null for archived snapshots.

const insideDirectory = (path, directory) => typeof path === 'string' && !!directory
  && path.startsWith(directory.endsWith('/') ? directory : `${directory}/`);

export function revisionSource(metadata, { snapshotDirectory } = {}) {
  const live = metadata.live && typeof metadata.live === 'object' ? metadata.live : null;
  if (live) {
    const path = [live.sourceKey, live.path, live.sourcePath, live.source, metadata.sourcePath]
      .find(value => typeof value === 'string' && value);
    return { kind: 'live', source: path ?? metadata.id };
  }
  if (insideDirectory(metadata.sourcePath, snapshotDirectory)) {
    return { kind: 'archive', source: 'archive' };
  }
  return { kind: 'input', source: metadata.sourcePath ?? metadata.id };
}

export function describeRevisions(list, {
  snapshotDirectory, modelOf = () => null, timeOf = () => null,
} = {}) {
  const counters = new Map();
  return list.map(metadata => {
    const { kind, source } = revisionSource(metadata, { snapshotDirectory });
    // Only archived snapshots need their recorded source (their title); a
    // live revision may be spooled, and reading it back is not free.
    const recorded = kind === 'archive' ? modelOf(metadata.id)?.sourceMap?.source : null;
    let revision = null;
    if (kind !== 'archive') {
      const next = (counters.get(source) ?? 0) + 1;
      counters.set(source, next);
      revision = Number.isInteger(metadata.live?.revision) ? metadata.live.revision : next;
    }
    const time = timeOf(metadata) ?? {};
    return {
      modelId: metadata.id, kind, source, revision,
      ...(typeof metadata.live?.key === 'string' ? { model: metadata.live.key } : {}),
      time: time.at ?? null, timeBasis: time.basis ?? null,
      recordedSource: recorded?.sha256 ? {
        file: recorded.file ?? null, sha256: recorded.sha256, language: recorded.language ?? null,
      } : null,
    };
  });
}
