// Pure live-state logic (no DOM): the client's live model built from the SSE
// events, the trust-state table of spec 7.4, the 250 ms settle rule, follow
// live, pins and the carry message. Package: live-client. Every function is
// unit-tested in test/viewer-live-client.test.mjs.

// ---- Live model ---------------------------------------------------------
//
// { session, workerFailed, sources: { [sourceId]: source }, order: [sourceId] }
// source: { id, path, label, language, notes, attempt, lastGood, failure,
//           dirty, revisions: { [revision]: modelId }, timings,
//           notices: { [revision]: [{ kind, message, detail }] } }
// attempt: { jobId, revision, status: queued|building|ok|failed|cancelled,
//            phase, queuedAt, startedAt, reason }
export function createLiveModel() {
  return { session: null, workerFailed: null, sources: {}, order: [] };
}

const emptySource = entry => ({
  id: entry.sourceId ?? entry.id,
  path: entry.path ?? null,
  label: entry.label ?? null,
  language: entry.language ?? null,
  notes: [...(entry.notes ?? [])],
  attempt: null,
  lastGood: null,
  failure: null,
  dirty: null,
  revisions: {},
  timings: null,
  notices: {},
});

const good = value => (value && Number.isInteger(value.revision) && value.modelId
  ? { revision: value.revision, modelId: value.modelId,
    previousSession: !!value.previousSession } : null);

// A source entry of `hello` (GET /api/live) as the client's source.
export function sourceFromStatus(entry, now) {
  const source = emptySource(entry);
  source.lastGood = good(entry.lastGood);
  if (source.lastGood) source.revisions[source.lastGood.revision] = source.lastGood.modelId;
  if (source.lastGood && entry.lastGood.notices?.length) {
    source.notices[source.lastGood.revision] = entry.lastGood.notices;
  }
  const current = entry.current;
  if (current?.modelId && Number.isInteger(current.revision)) {
    source.revisions[current.revision] = current.modelId;
  }
  const job = entry.job;
  if (job) {
    const elapsed = Number.isFinite(job.elapsedMs) ? job.elapsedMs : 0;
    source.attempt = {
      jobId: job.jobId, revision: job.revision, reason: job.reason ?? null,
      status: job.state === 'queued' ? 'queued' : 'building',
      phase: job.state === 'registering' ? 'registering' : job.phase ?? job.state,
      queuedAt: now - elapsed, startedAt: job.state === 'queued' ? null : now - elapsed,
    };
  } else if (current) {
    source.attempt = {
      jobId: current.jobId ?? null, revision: current.revision, reason: null,
      status: current.status, phase: null, queuedAt: null, startedAt: null,
    };
  }
  if (entry.lastFailure && source.attempt?.status !== 'ok') source.failure = entry.lastFailure;
  if (entry.state === 'starting' && !source.attempt) {
    source.attempt = {
      jobId: null, revision: null, reason: 'start', status: 'queued', phase: 'starting',
      queuedAt: now, startedAt: null,
    };
  }
  return source;
}

function sourceFor(model, data) {
  const id = data.sourceId;
  if (!id) return null;
  if (!model.sources[id]) {
    model.sources[id] = emptySource(data);
    model.order.push(id);
  }
  const source = model.sources[id];
  if (data.path) source.path = data.path;
  return source;
}

const sameJob = (attempt, data) => !!attempt && (attempt.jobId === data.jobId
  || attempt.jobId === null && attempt.revision === data.revision);

// Applies one SSE event to the live model (mutates and returns it).
export function reduceLive(model, name, data = {}, now = Date.now()) {
  if (name === 'hello') {
    const next = createLiveModel();
    next.session = data.session ?? null;
    next.workerFailed = data.workers?.failed ?? null;
    for (const entry of data.sources ?? []) {
      const source = sourceFromStatus(entry, now);
      next.sources[source.id] = source;
      next.order.push(source.id);
    }
    return Object.assign(model, next);
  }
  if (name === 'worker-failed') {
    model.workerFailed = data;
    return model;
  }
  const source = sourceFor(model, data);
  if (!source) return model;
  switch (name) {
    case 'source-changed':
      source.dirty = { since: now, files: data.files ?? [] };
      break;
    case 'build-queued':
      source.dirty = null;
      source.attempt = {
        jobId: data.jobId, revision: data.revision, reason: data.reason ?? null,
        status: 'queued', phase: 'queued', queuedAt: now, startedAt: null,
      };
      break;
    case 'build-started':
      model.workerFailed = null;
      if (sameJob(source.attempt, data)) {
        Object.assign(source.attempt, {
          status: 'building', phase: data.worker === 'cold' ? 'warming worker' : 'starting',
          startedAt: now,
        });
      }
      break;
    case 'build-phase':
      if (sameJob(source.attempt, data) && source.attempt.status !== 'cancelled') {
        source.attempt.status = 'building';
        source.attempt.phase = data.phase;
        if (Number.isFinite(data.elapsedMs)) source.attempt.startedAt = now - data.elapsedMs;
      }
      break;
    case 'build-cancelled':
      if (sameJob(source.attempt, data)) {
        Object.assign(source.attempt, {
          status: 'cancelled', phase: null, reason: data.reason ?? 'cancelled',
          supersededBy: data.supersededBy ?? null,
        });
      }
      break;
    case 'revision': {
      source.revisions[data.revision] = data.modelId;
      if (data.notices?.length) source.notices[data.revision] = data.notices;
      const next = good({ ...data, previousSession: data.previousSession });
      const last = source.lastGood;
      if (!last || (!data.previousSession && data.revision >= last.revision)) {
        source.lastGood = next;
      }
      if (!data.previousSession) {
        source.failure = null;
        source.timings = data.timings ?? null;
        if (sameJob(source.attempt, data)) {
          Object.assign(source.attempt, { status: 'ok', phase: null });
        }
      }
      break;
    }
    case 'build-failed':
      if (sameJob(source.attempt, data) || !source.attempt
        || source.attempt.revision < data.revision) {
        source.attempt = {
          ...(source.attempt ?? {}), jobId: data.jobId, revision: data.revision,
          status: 'failed', phase: null,
        };
      }
      source.failure = data.failure ?? null;
      if (data.lastGood) source.lastGood = good(data.lastGood) ?? source.lastGood;
      break;
    default:
      break;
  }
  return model;
}

// The live source and revision of a model id: from the revisions announced
// on the stream, else from the workspace metadata (`live.sourceId`,
// `live.revision`). The highest revision with that model id wins (a rebuild
// with identical output reuses the model id: "same model as r0").
export function liveRevisionOf(model, modelId, workspaceModels = []) {
  if (!modelId) return null;
  let best = null;
  for (const id of model.order) {
    for (const [revision, value] of Object.entries(model.sources[id].revisions)) {
      if (value === modelId && (!best || Number(revision) > best.revision)) {
        best = { sourceId: id, revision: Number(revision), modelId };
      }
    }
  }
  const listed = workspaceModels.find(item => item.id === modelId)?.live;
  if (listed && Number.isInteger(listed.revision)
    && (!best || best.sourceId === listed.sourceId && listed.revision > best.revision)) {
    best = { sourceId: listed.sourceId ?? best?.sourceId ?? null, revision: listed.revision,
      modelId };
  }
  return best;
}

// Build notices of a revision (a successful build whose model differs from
// what the source seems to ask for, e.g. ignored show() calls).
export const noticesOf = (source, revision) => (Number.isInteger(revision)
  ? source?.notices?.[revision] ?? [] : []);

// ---- Trust states (spec 7.4) ----------------------------------------------

export const TRUST_ROWS = Object.freeze([
  'disconnected', 'worker-failed', 'no-good-build', 'building', 'dirty', 'loading', 'failed',
  'cancelled', 'older', 'current', 'static', 'waiting',
]);
export const BUSY_ROWS = new Set(['building', 'dirty', 'loading']);

const basename = path => String(path ?? '').split(/[/\\]/).at(-1);
export const seconds = ms => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
// Build time like the terminal line ("r1 ok 0.21 s"): two decimals, no trailing zeros.
export const buildSeconds = ms => `${Number((Math.max(0, ms) / 1000).toFixed(2))} s`;
const rev = value => (value === null || value === undefined ? 'r?' : `r${value}`);

// "part.fs:24" (the table's file:line) from a failure payload.
export function failsAt(failure) {
  const location = failure?.error?.location;
  if (!location?.file || !Number.isInteger(location.line)) return null;
  return `${basename(location.file)}:${location.line}`;
}

// input: {
//   connected, live, workerFailed, dirty, follow,
//   displayed: { revision, modelId } | null     (D)
//   good: { revision, modelId } | null          (G)
//   attempt: { revision, status, phase, elapsedMs } | null  (A)
//   failure: payload | null                     (A's failure)
//   loading: { revision } | null                (N)
//   staticLabel: text for a static file ("r1", "archived")
// }
// -> { row, tone, text, actions: ['cancel' | 'latest' | 'details' | 'rebuild'] }
// First match wins, in the order of the spec table.
export function trustState(input) {
  const {
    connected = false, live = false, workerFailed = false, dirty = false,
    displayed = null, good: latest = null, attempt = null, failure = null, loading = null,
    staticLabel = null,
  } = input;
  const D = displayed?.revision;
  const showing = displayed ? ` · showing ${live ? rev(D) : staticLabel ?? 'file'}` : '';
  const at = failsAt(failure);
  const fails = at ? `fails at ${at}` : 'fails';
  const sameAsGood = !!displayed && !!latest && displayed.modelId === latest.modelId;
  if (!connected) {
    return {
      row: 'disconnected', tone: 'grey', actions: [],
      text: `Disconnected${showing} · reconnecting`,
    };
  }
  if (workerFailed) {
    return {
      row: 'worker-failed', tone: 'red', actions: ['rebuild', 'details'],
      text: `Build worker failed to start${showing}`,
    };
  }
  if (!live) {
    return {
      row: 'static', tone: 'neutral', actions: [],
      text: `Static file · ${staticLabel ?? (displayed ? rev(D) : 'no model')}`,
    };
  }
  if (!latest && attempt?.status === 'failed') {
    return {
      row: 'no-good-build', tone: 'red', actions: ['details'],
      text: `No successful build · ${rev(attempt.revision)} ${fails}`,
    };
  }
  if (!latest && attempt?.status === 'cancelled') {
    return {
      row: 'no-good-build', tone: 'red', actions: ['rebuild'],
      text: `No successful build · ${rev(attempt.revision)} cancelled`,
    };
  }
  if (attempt && ['queued', 'building'].includes(attempt.status)) {
    const phase = attempt.phase ?? attempt.status;
    const behind = displayed && !sameAsGood ? ` · showing ${rev(D)}` : '';
    return {
      row: 'building', tone: 'blue', actions: ['cancel'],
      text: `Building ${rev(attempt.revision)} · ${phase} · ${seconds(attempt.elapsedMs ?? 0)}`
        + behind,
    };
  }
  if (dirty) {
    return {
      row: 'dirty', tone: 'blue', actions: [],
      text: displayed ? `Source changed · showing ${rev(D)}` : 'Source changed',
    };
  }
  if (loading || (!displayed && latest)) {
    const N = loading?.revision ?? latest.revision;
    return {
      row: 'loading', tone: 'blue', actions: [],
      // During the swap itself the new revision is already the displayed one;
      // "Loading r2 · showing r2" would say nothing.
      text: `Loading ${rev(N)}${displayed && D !== N ? ` · showing ${rev(D)}` : ''}`,
    };
  }
  if (attempt?.status === 'failed' && sameAsGood) {
    return {
      row: 'failed', tone: 'amber', actions: ['details'],
      text: `Last good ${rev(latest.revision)} · ${rev(attempt.revision)} ${fails}`,
    };
  }
  if (attempt?.status === 'cancelled' && sameAsGood) {
    return {
      row: 'cancelled', tone: 'amber', actions: ['rebuild'],
      text: `Last good ${rev(latest.revision)} · ${rev(attempt.revision)} cancelled`,
    };
  }
  if (displayed && latest && !sameAsGood) {
    return {
      row: 'older', tone: 'neutral', actions: ['latest'],
      text: `Viewing ${rev(D)} · ${rev(latest.revision)} is latest`,
    };
  }
  if (sameAsGood && (!attempt || attempt.status === 'ok')) {
    return { row: 'current', tone: 'green', actions: [], text: `Current ${rev(latest.revision)}` };
  }
  return { row: 'waiting', tone: 'blue', actions: [], text: 'Waiting for the first build' };
}

// Builds the trust-state input for the displayed model from the live model.
// Without a displayed model the input describes `waitingSourceId` (the model
// an open workspace node waits for), else the first source.
export function trustInput(model, {
  connected, displayedId, displayedRevision = null, workspaceModels = [], loading = null,
  staticLabel = null, now = Date.now(), waitingSourceId = null,
}) {
  const found = liveRevisionOf(model, displayedId, workspaceModels);
  const sourceId = found?.sourceId ?? (displayedId ? null
    : (model.sources[waitingSourceId] ? waitingSourceId : model.order[0] ?? null));
  const source = sourceId ? model.sources[sourceId] : null;
  const live = !!source;
  const displayed = displayedId
    ? { modelId: displayedId, revision: displayedRevision ?? found?.revision ?? null } : null;
  const attempt = source?.attempt ? {
    ...source.attempt,
    elapsedMs: source.attempt.startedAt !== null && source.attempt.startedAt !== undefined
      ? now - source.attempt.startedAt
      : source.attempt.queuedAt ? now - source.attempt.queuedAt : 0,
  } : null;
  return {
    connected, live, sourceId, source,
    workerFailed: !!model.workerFailed && model.order.length > 0,
    dirty: !!source?.dirty,
    displayed,
    good: source?.lastGood ?? null,
    attempt,
    failure: attempt?.status === 'failed' ? source.failure : null,
    loading: loading && loading.sourceId === sourceId ? loading : null,
    staticLabel,
  };
}

// The 250 ms rule (spec 3.1 step 4): a busy row (building, source changed,
// loading) replaces the shown state only once the busy period is 250 ms old,
// so fast builds go straight from "Current r1" to "Current r2".
// -> { state, wakeAt } (wakeAt: when to re-evaluate, or null)
export function settle(next, shown, { busySince, now, delayMs = 250 }) {
  if (!BUSY_ROWS.has(next.row) || !shown || busySince === null || busySince === undefined) {
    return { state: next, wakeAt: null };
  }
  if (BUSY_ROWS.has(shown.row) || now >= busySince + delayMs) return { state: next, wakeAt: null };
  return { state: shown, wakeAt: busySince + delayMs };
}

// ---- Follow live, pins, carry -------------------------------------------

const MODEL_ID = /^[a-f0-9]{64}$/;

// Model ids an annotation list refers to: the view's model (and its before
// model when the view is a comparison) and the target's model.
export function annotationModels(annotations = []) {
  const ids = new Set();
  for (const annotation of annotations ?? []) {
    const view = annotation?.view;
    for (const id of [view?.after, view?.compare ? view.before : null,
      annotation?.target?.modelId]) {
      if (typeof id === 'string' && MODEL_ID.test(id)) ids.add(id);
    }
  }
  return ids;
}

// 'on' | 'off' | 'paused'. Paused: the open review has annotations on a
// displayed revision (spec 3.1 step 11).
export function followMode({ enabled = true, annotations = [], displayedIds = [] }) {
  if (!enabled) return 'off';
  const annotated = annotationModels(annotations);
  return displayedIds.some(id => annotated.has(id)) ? 'paused' : 'on';
}

// Whether a new good revision should replace the displayed one. `previous`
// is the source's last good model before this revision; `trailing` means the
// view was held back earlier by follow off or paused and catches up now.
export function shouldFollow({ mode, displayedId, previousGoodId, targetId, trailing = false }) {
  if (!targetId || targetId === displayedId) return false;
  if (mode !== 'on') return false;
  return !displayedId || displayedId === previousGoodId || trailing;
}

// Revisions the client pins (spec 10.4): displayed, compare and annotated
// revisions, plus extra ones (a revision being loaded, a ghost). Sorted, at
// most 64 valid model ids.
export function pinIds({ after, before, compare, annotations = [], extra = [] }) {
  const ids = new Set([after, compare ? before : null, ...annotationModels(annotations), ...extra]
    .filter(id => typeof id === 'string' && MODEL_ID.test(id)));
  return [...ids].sort().slice(0, 64);
}

const listText = items => (items.length < 2 ? items.join('')
  : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

// Toast for references that did not carry, e.g. "B1.F3 has a revision-local
// identity; not carried to r3". null when everything carried.
export function carryMessage(results, target) {
  const groups = { local: [], ambiguous: [], missing: [] };
  for (const result of results ?? []) {
    if (result.status === 'exact') continue;
    const alias = result.fromAlias ?? 'The selection';
    if (result.status === 'ambiguous') groups.ambiguous.push(alias);
    else if (result.stability === 'revision-local') groups.local.push(alias);
    else groups.missing.push(alias);
  }
  const parts = [];
  if (groups.local.length) {
    parts.push(groups.local.length === 1
      ? `${groups.local[0]} has a revision-local identity; not carried to ${target}`
      : `${listText(groups.local)} have revision-local identities; not carried to ${target}`);
  }
  if (groups.ambiguous.length) {
    parts.push(`${listText(groups.ambiguous)} ${groups.ambiguous.length === 1 ? 'matches'
      : 'match'} several entities in ${target}; not carried`);
  }
  if (groups.missing.length) {
    parts.push(`${listText(groups.missing)} ${groups.missing.length === 1 ? 'has' : 'have'} no`
      + ` identity match in ${target}; not carried`);
  }
  return parts.length ? parts.join('. ') : null;
}
