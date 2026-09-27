// Live client (spec 3.1, 6, 7.4, 9.2). Package: live-client.
//
// Opens the SSE stream (core/events.js), keeps the client's live model from
// its events (trust-state.js) and drives:
//   - the live pill, the viewport trust chip and the busy bar (pill.js),
//   - the failure banner and the no-good-build panel (banner.js), the failure
//     drawer (failure-drawer.js),
//   - follow live (L, setting S "followLive", default on): a new good revision
//     of the displayed source replaces the displayed one once its scene and
//     draw payload are loaded, keeping the camera. Follow pauses while the
//     open review has annotations on a displayed revision; a revision the user
//     picked from the library or a review is never replaced. Otherwise the
//     chip "r4 available" appears and the view stays;
//   - selection carry: references on the replaced revision are resolved on
//     the server (POST /api/models/:id/resolve) and carried only when their
//     recorded identity matches exactly; the others are cleared with a toast;
//   - derived data keyed by model id: store key live.swap and onLiveSwap()
//     announce each swap; the inspector marks the measurement "pending" until
//     it is recomputed for the new revision;
//   - client pins (POST /api/live/pins) for the displayed, compare, annotated
//     and loading revisions.
// Nothing runs under the legacy seam: this feature is not in the VS set and
// the SSE client is disabled there.
import { createBanner } from './banner.js';
import { editorHref, openFailureDrawer } from './failure-drawer.js';
import { createPill } from './pill.js';
import {
  annotationModels, buildSeconds, BUSY_ROWS, carryMessage, createLiveModel, followMode,
  liveRevisionOf, noticesOf, pinIds, reduceLive, settle, trustInput, trustState,
} from './trust-state.js';
import { escape } from '../../core/dom.js';
import { EVENT_NAMES } from '../../core/events.js';

export const id = 'live';
export const legacy = false;

const CLIENT_KEY = 'wonky.live.client';
const DISPLAYED_KEY = 'wonky.live.displayed';
const FOLLOW_KEY = 'followLive';
const TICK_MS = 100;
const PIN_DELAY_MS = 150;
const CLIENT = /^[A-Za-z0-9_-]{1,64}$/;

function storage(env) {
  try {
    return env.window?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function clientIdOf(env) {
  const store = storage(env);
  try {
    const saved = store?.getItem(CLIENT_KEY);
    if (saved && CLIENT.test(saved)) return saved;
  } catch {
    // Private mode: a fresh id per page.
  }
  const random = env.window?.crypto?.randomUUID?.()
    ?? `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  try {
    store?.setItem(CLIENT_KEY, random);
  } catch {
    // Not persisted; pins still work for this page.
  }
  return random;
}

const isAbort = error => error?.name === 'AbortError';

export function setup(ctx) {
  const { store, app, api, events, settings, env, commands, slots, dom: { $ } } = ctx;
  const { state } = ctx;
  const swapScope = ctx.requests.scope('live.swap');
  const listScope = ctx.requests.scope('live.list');
  const now = () => Date.now();

  const model = createLiveModel();
  let helloSeen = false;
  let connected = false;
  let clientId = null;
  let displayedRevision = null;
  let loading = null;
  let busySince = null;
  let shown = null;
  let wakeTimer = null;
  let tickTimer = null;
  let pinTimer = null;
  let pinnedKey = '';
  let applying = false;
  let job = null;
  let wantFirst = false;
  let wantSwap = null;
  let wantList = false;
  let restore = null;
  // After a server restart: the path and model id the tab still shows, kept
  // until that source has a good revision in the new session (fix round 2).
  let pendingRestart = null;
  let lastSwap = null;
  let swapCommitted = false;
  let published = '';
  let firstTried = '';
  let badgesKey = '';
  const stops = [];
  const userPicked = new Map();
  const received = new Map();
  const listTried = new Set();
  const swapListeners = new Set();

  // ---- Lookups ----
  const models = () => state.workspace?.models ?? [];
  const listed = modelId => models().some(item => item.id === modelId);
  const revisionOf = modelId => liveRevisionOf(model, modelId, models());
  const sourceOfModel = modelId => revisionOf(modelId)?.sourceId ?? null;
  const displayedIds = () => [...new Set(state.compare ? [state.before, state.after]
    : [state.after])].filter(Boolean);
  const effectiveDisplayed = () => loading?.modelId ?? state.after;
  // Without a displayed model: the source an open workspace node waits for
  // (features/workspace), else the first source.
  const waitingSourceId = () => app.workspaceEmptyNode?.()?.sourceId ?? null;
  const currentSourceId = () => sourceOfModel(effectiveDisplayed())
    ?? (effectiveDisplayed() ? null : waitingSourceId() ?? model.order[0] ?? null);
  const settingsWhere = sourceId => ({ source: model.sources[sourceId]?.path ?? sourceId });
  const followEnabled = sourceId => !!sourceId
    && settings.get('S', FOLLOW_KEY, true, settingsWhere(sourceId)) !== false;
  const modeFor = sourceId => followMode({
    enabled: followEnabled(sourceId), annotations: state.annotations ?? [],
    displayedIds: displayedIds(),
  });
  const newestListed = sourceId => models()
    .filter(item => item.live?.sourceId === sourceId && Number.isInteger(item.live.revision))
    .reduce((best, item) => (!best || item.live.revision > best.live.revision ? item : best),
      null);
  const editorScheme = () => settings.get('G', 'editor', 'zed');
  const pathOfModel = modelId => models().find(item => item.id === modelId)?.live?.path
    ?? model.sources[sourceOfModel(modelId)]?.path ?? null;

  // ---- Rendering ----
  const pill = createPill(ctx);
  const banner = createBanner(ctx);

  function view(time = now()) {
    const displayedId = state.after && (listed(state.after) || revisionOf(state.after))
      ? state.after : null;
    // A follow swap that is decided but waits for another job already counts
    // as loading: the trust state never shows "Viewing rN · rN+1 is latest"
    // for a revision the view is about to follow.
    const input = trustInput(model, {
      connected, displayedId, now: time, workspaceModels: models(),
      waitingSourceId: waitingSourceId(),
      loading: loading ?? wantSwap ?? null,
      displayedRevision: displayedRevision?.modelId === displayedId
        ? displayedRevision.revision : null,
      staticLabel: displayedId ? app.revisionText?.(displayedId) || null : null,
    });
    return { input, trust: trustState(input) };
  }

  function bannerView(input) {
    if (!helloSeen) return null;
    if (input.workerFailed) {
      return { mode: 'worker', worker: model.workerFailed, displayed: input.displayed };
    }
    const source = input.source;
    const failure = source?.failure;
    // Notices of the displayed revision (ignored show() calls) when no newer
    // failure takes the banner.
    const notices = noticesOf(source, input.displayed?.revision);
    const notice = notices.length
      ? { mode: 'notice', notices, displayed: input.displayed } : null;
    if (!failure) return notice;
    const revision = failure.revision ?? source.attempt?.revision ?? null;
    if (source.lastGood && Number.isInteger(revision) && revision < source.lastGood.revision) {
      return notice;
    }
    const href = editorHref(failure.error?.location, editorScheme());
    if (!source.lastGood) return { mode: 'panel', failure, revision, editorHref: href };
    return {
      mode: 'failure', failure, displayed: input.displayed, good: source.lastGood,
      editorHref: href,
    };
  }

  function availableOf(input, mode) {
    const latest = input.good;
    const displayed = input.displayed;
    if (!latest || !displayed || latest.modelId === displayed.modelId || loading) return null;
    const note = mode === 'off' ? 'follow off (L)'
      : mode === 'paused' ? `follow paused: review annotations on r${displayed.revision ?? '?'}`
        : '';
    return { revision: latest.revision, modelId: latest.modelId, note };
  }

  function render() {
    const time = now();
    const { input, trust } = view(time);
    if (!BUSY_ROWS.has(trust.row)) busySince = null;
    const settled = settle(trust, shown, { busySince, now: time });
    shown = settled.state;
    env.clearTimeout(wakeTimer);
    wakeTimer = null;
    if (settled.wakeAt) wakeTimer = env.setTimeout(render, Math.max(10, settled.wakeAt - time));
    const sourceId = input.sourceId;
    const mode = sourceId ? modeFor(sourceId) : 'off';
    const source = input.source;
    const building = shown.row === 'building';
    // "Current r12 · 0.21 s · bracket.fs": build time, and the file unless the
    // trust text already names it.
    const file = source?.label ? `${source.label}${source.language === 'python' ? '.py'
      : '.fs'}` : null;
    // The build time excludes the wait for a worker (timings.buildMs); a
    // wait of half a second or more is named, like the terminal line.
    const timings = source?.timings;
    const buildMs = timings?.buildMs ?? timings?.totalMs;
    const extra = !input.live ? '' : [
      shown.row === 'current' && Number.isFinite(buildMs)
        ? buildSeconds(buildMs) + (timings.queuedMs >= 500
          ? ` (queued ${buildSeconds(timings.queuedMs)})` : '') : null,
      file && !shown.text.includes(file) ? file : null,
    ].filter(Boolean).join(' · ');
    pill.render({
      visible: helloSeen,
      live: helloSeen && model.order.length > 0,
      trust: shown,
      extra,
      follow: mode,
      followNote: `the open review has annotations on r${input.displayed?.revision ?? '?'}`,
      available: availableOf(input, mode),
      busy: building ? shown.text : null,
    });
    banner.render(bannerView(input));
    const key = `${shown.row}|${shown.text}|${mode}`;
    if (key !== published) {
      published = key;
      store.update('live.status', current => {
        current.live.trust = shown;
        current.live.follow = mode;
      });
    }
    env.clearTimeout(tickTimer);
    tickTimer = building ? env.setTimeout(render, TICK_MS) : null;
    const nextBadges = model.order.map(sourceId => `${sourceId}:${badgeOf(sourceId)?.text}`)
      .join('|');
    if (nextBadges !== badgesKey) {
      badgesKey = nextBadges;
      app.renderLibrary?.();
    }
  }

  // Library row badge of a live source's newest revision: the latest attempt
  // when it is not a success ("r5 building", "r5 fails", "r5 cancelled").
  function badgeOf(sourceId) {
    const attempt = model.sources[sourceId]?.attempt;
    if (!attempt || attempt.status === 'ok' || !Number.isInteger(attempt.revision)) return null;
    const tone = { queued: 'blue', building: 'blue', failed: 'amber', cancelled: 'amber' };
    const word = { queued: 'queued', building: 'building', failed: 'fails',
      cancelled: 'cancelled' };
    return { text: `r${attempt.revision} ${word[attempt.status]}`, tone: tone[attempt.status] };
  }

  const markBusy = () => {
    busySince ??= now();
  };

  // ---- Workspace list, swaps and first display ----
  async function fetchList(signal) {
    const [data, facts] = await Promise.all([
      api.json('/api/workspace', { signal }),
      api.json('/api/compare/revisions', { signal }).catch(error => {
        if (isAbort(error)) throw error;
        return null;
      }),
    ]);
    return { data, facts };
  }

  function applyList({ data, facts }) {
    state.workspace = {
      models: data.models ?? [], reports: data.reports ?? [], feedback: data.feedback ?? [],
    };
    app.setRevisionFacts?.(facts);
    const count = state.workspace.models.length;
    const status = $('#workspace-status');
    if (status) {
      status.textContent = `${count} model ${count === 1 ? 'version' : 'versions'}`
        + ' · Local workspace';
    }
    app.renderSaved?.();
    if (app.syncControls) app.syncControls();
    else app.renderLibrary?.();
  }

  async function resolveCarry(from, target, references, signal) {
    const body = {
      from,
      references: references.map(({ bodyId, entityType, entityIndex }) => ({
        bodyId, entityType, entityIndex,
      })),
    };
    const label = `r${target.revision}`;
    try {
      const data = await api.post(`/api/models/${encodeURIComponent(target.modelId)}/resolve`,
        body, { signal });
      return {
        references: data.results.filter(result => result.status === 'exact')
          .map(result => result.reference),
        message: carryMessage(data.results, label),
        results: data.results,
      };
    } catch (error) {
      if (isAbort(error)) throw error;
      return { references: [], message: `Selection not carried to ${label}: ${error.message}` };
    }
  }

  // Shared with the renderer's own draw request (deduplicated by the cache),
  // so it is not aborted with the swap.
  async function preloadDraw(modelId) {
    try {
      await ctx.renderer.loadModel?.(modelId);
    } catch {
      // Without WebGL the JSON path draws; loadSelectedModels reports real errors.
    }
  }

  // Derived data keyed by model id is stale from here on; set before the
  // carried selection renders the inspector, so its sections see the swap.
  function markSwap(from, target) {
    store.update('live.swap', current => {
      current.live.swap = { from, to: target.modelId, revision: target.revision, at: now() };
    });
  }

  function recordSwap(from, target) {
    const record = {
      from, to: target.modelId, revision: target.revision, sourceId: target.sourceId,
      receivedAt: received.get(target.modelId) ?? null, displayedAt: now(), paintedAt: null,
    };
    lastSwap = record;
    env.requestAnimationFrame(() => {
      record.paintedAt = now();
    });
    for (const listener of [...swapListeners]) {
      try {
        listener({ from, to: target.modelId, revision: target.revision });
      } catch (error) {
        env.window?.console?.warn?.('live swap listener failed:', error);
      }
    }
  }

  async function swapTo(target) {
    const run = swapScope.begin();
    loading = target;
    markBusy();
    render();
    schedulePins();
    const from = state.after;
    const carry = (state.selectionSet ?? []).filter(reference => reference.modelId === from);
    const wasPrevious = state.compare && !!state.before
      && state.before === app.previousRevision?.(from);
    try {
      const [list, carried] = await Promise.all([
        fetchList(run.signal),
        carry.length ? resolveCarry(from, target, carry, run.signal) : null,
        app.loadScene?.(target.modelId),
        preloadDraw(target.modelId),
      ]);
      if (!run.current()) return;
      swapCommitted = true;
      applying = true;
      applyList(list);
      state.after = target.modelId;
      if (wasPrevious) state.before = app.previousRevision?.(target.modelId) ?? from;
      displayedRevision = { modelId: target.modelId, revision: target.revision };
      await app.loadSelectedModels(false);
      if (state.after !== target.modelId) return;
      markSwap(from, target);
      if (carried?.references?.length) app.select(carried.references, false);
      if (carried?.message) ctx.notify(carried.message);
      recordSwap(from, target);
      rememberDisplayed();
    } catch (error) {
      if (!isAbort(error) && run.current()) {
        ctx.notify(`r${target.revision} could not be loaded: ${error.message}`);
      }
    } finally {
      applying = false;
      swapCommitted = false;
      if (loading === target) loading = null;
    }
  }

  async function firstDisplay() {
    applying = true;
    try {
      await app.workspace?.();
      displayedRevision = null;
      rememberDisplayed();
    } catch {
      // The library shows its own viewport message.
    } finally {
      applying = false;
    }
  }

  async function refreshList() {
    const run = listScope.begin();
    try {
      const list = await fetchList(run.signal);
      if (!run.current() || loading) return;
      applying = true;
      applyList(list);
    } catch (error) {
      if (!isAbort(error)) env.window?.console?.warn?.('Live list refresh failed:', error.message);
    } finally {
      applying = false;
    }
  }

  // Decides what the view should do from the live model and the view state.
  // A list refresh or first display is tried once per set of good revisions,
  // so a revision the workspace does not list cannot cause a refresh loop.
  const goodKey = () => model.order.map(sourceId => model.sources[sourceId].lastGood?.modelId)
    .filter(Boolean).join(',');
  // The workspace list is stale for a good revision that is not listed, or
  // listed under an older revision number: a rebuild that reproduces an
  // earlier model keeps its model id ("r5 ok · same model as r3"), and the
  // library, model bar and compare selectors must say r5 (fix round 2, D1).
  function requestList(good) {
    const entry = models().find(item => item.id === good.modelId);
    if (entry && entry.live?.revision >= good.revision) return;
    const key = `${good.modelId}@${good.revision}`;
    if (listTried.has(key)) return;
    listTried.add(key);
    wantList = true;
  }

  // After a restart, keep showing the last model until its source (matched by
  // path; source ids are per session) has a good revision: the same model id
  // only refreshes the list, another one is swapped in. A source that is gone
  // falls back to the first display.
  function evaluateRestart() {
    const sourceId = model.order.find(id => model.sources[id].path === pendingRestart.path);
    if (!sourceId) {
      pendingRestart = null;
      wantFirst = true;
      return;
    }
    const good = model.sources[sourceId].lastGood;
    if (!good) return;
    const { modelId } = pendingRestart;
    pendingRestart = null;
    if (good.modelId === modelId) {
      listTried.delete(`${good.modelId}@${good.revision}`);
      wantList = true;
    } else {
      wantSwap = { ...good, sourceId };
      markBusy();
    }
  }

  function evaluate() {
    if (!helloSeen || state.loading && !job) return;
    if (pendingRestart) {
      evaluateRestart();
      return;
    }
    const displayedId = effectiveDisplayed();
    // A workspace node that shows no model on purpose: no first display of
    // another source (its own first revision opens it, features/workspace).
    if (!displayedId && waitingSourceId()) return;
    if (!displayedId || !listed(displayedId) && !loading) {
      const key = goodKey();
      if (key && key !== firstTried) {
        firstTried = key;
        wantFirst = true;
      }
      return;
    }
    if (restore) {
      const { modelId } = restore;
      restore = null;
      if (modelId !== state.after && listed(modelId)) {
        const sourceId = sourceOfModel(modelId);
        if (sourceId) userPicked.set(sourceId, modelId);
        wantSwap = { ...revisionOf(modelId), modelId, restore: true };
        return;
      }
    }
    const sourceId = sourceOfModel(displayedId);
    // Other sources: the library learns about their new revisions too (L4).
    for (const id of model.order) {
      const good = model.sources[id].lastGood;
      if (good && id !== sourceId) requestList(good);
    }
    const latest = sourceId ? model.sources[sourceId]?.lastGood : null;
    const listLatest = () => requestList(latest);
    if (latest && latest.modelId === displayedId) {
      if (!loading) displayedRevision = { modelId: displayedId, revision: latest.revision };
      listLatest();
      return;
    }
    if (!latest) return;
    if (modeFor(sourceId) === 'on' && !userPicked.has(sourceId)) {
      if (loading?.modelId !== latest.modelId) {
        wantSwap = { ...latest, sourceId };
        markBusy();
      }
    } else listLatest();
  }

  // Runs one pending job at a time; a newer swap aborts a running one.
  function kick() {
    evaluate();
    if (wantSwap && job?.kind === 'swap' && !swapCommitted
      && job.target.modelId !== wantSwap.modelId) {
      swapScope.abort();
    }
    if (job || state.loading) {
      render();
      return;
    }
    let next = null;
    if (wantFirst) {
      wantFirst = false;
      wantList = false;
      next = { kind: 'first', run: firstDisplay };
    } else if (wantSwap) {
      const target = wantSwap;
      wantSwap = null;
      wantList = false;
      // Loading from this tick on (swapTo runs a microtask later), so the
      // render below already shows the busy "loading" row, which the 250 ms
      // rule keeps hidden for a fast swap.
      loading = target;
      markBusy();
      next = { kind: 'swap', target, run: () => swapTo(target) };
    } else if (wantList) {
      wantList = false;
      next = { kind: 'list', run: refreshList };
    }
    render();
    if (!next) return;
    job = next;
    Promise.resolve().then(next.run).finally(() => {
      job = null;
      render();
      schedulePins();
      kick();
    });
  }

  // ---- Pins ----
  function schedulePins() {
    if (pinTimer !== null) return;
    pinTimer = env.setTimeout(() => {
      pinTimer = null;
      postPins();
    }, PIN_DELAY_MS);
  }
  async function postPins() {
    if (!connected || !helloSeen || !model.order.length || !clientId) return;
    const ids = pinIds({
      after: state.after, before: state.before, compare: state.compare,
      annotations: state.annotations ?? [],
      // The ghost revision (diff-overlay) is pinned too (spec 10.4).
      extra: [loading?.modelId, app.ghostModelId?.()].filter(Boolean),
    });
    const key = `${model.session}|${ids.join(',')}`;
    // Nothing to pin and nothing pinned by this client in this session yet.
    if (key === pinnedKey || !ids.length && !pinnedKey) return;
    pinnedKey = key;
    try {
      await api.post('/api/live/pins', { client: clientId, modelIds: ids });
    } catch (error) {
      pinnedKey = '';
      env.window?.console?.warn?.('Live pins not posted:', error.message);
    }
  }

  // ---- Reload: the displayed revision per tab ----
  function rememberDisplayed() {
    const sourceId = sourceOfModel(state.after);
    try {
      storage(env)?.setItem(DISPLAYED_KEY, JSON.stringify({
        modelId: state.after, sourceId, path: pathOfModel(state.after),
        picked: !!sourceId && userPicked.has(sourceId),
      }));
    } catch {
      // Not persisted.
    }
  }
  function readSaved() {
    try {
      const saved = JSON.parse(storage(env)?.getItem(DISPLAYED_KEY) ?? 'null');
      return saved && typeof saved.modelId === 'string' ? saved : null;
    } catch {
      return null;
    }
  }
  // A revision the user picked (older than the newest) is restored as such.
  function readDisplayed() {
    const saved = readSaved();
    return saved?.picked ? saved : null;
  }
  // The first model after a reload (workspace.js defaultAfter): the picked
  // revision, else the newest revision of the source this tab showed, found
  // by source id or path (fix round 2, L3: a reload used to fall back to the
  // first source).
  function preferredAfter(list) {
    const saved = readSaved();
    if (!saved) return null;
    if (saved.picked && list.some(item => item.id === saved.modelId)) return saved.modelId;
    const same = list.filter(item => item.live && (item.live.sourceId === saved.sourceId
      || saved.path && item.live.path === saved.path));
    const newest = same.reduce((best, item) => (!best
      || (item.live.revision ?? -1) > (best.live.revision ?? -1) ? item : best), null);
    return newest?.id ?? (list.some(item => item.id === saved.modelId) ? saved.modelId : null);
  }

  // ---- Events ----
  function onEvent(name, data) {
    const time = now();
    const previousSession = model.session;
    const shownPath = name === 'hello' && state.after ? pathOfModel(state.after) : null;
    reduceLive(model, name, data, time);
    if (name === 'hello') {
      if (!helloSeen) restore = readDisplayed();
      helloSeen = true;
      connected = true;
      pinnedKey = '';
      // A restarted server (another session) lists other revisions. The tab
      // keeps showing its model until that source is back (L2); without a
      // shown live model it takes the first display.
      if (previousSession && previousSession !== model.session) {
        listTried.clear();
        userPicked.clear();
        restore = null;
        if (shownPath) pendingRestart = { path: shownPath, modelId: state.after };
        else wantFirst = true;
      }
      schedulePins();
    } else if (name === 'source-changed' || name === 'build-queued') {
      markBusy();
    } else if (name === 'revision') {
      received.set(data.modelId, time);
    } else if (name === 'workspace-changed' && data?.reason !== 'revision' && !pendingRestart) {
      // Reviews and archives saved elsewhere: refresh the list, never the view.
      // New revisions are handled per source above (requestList).
      wantList = true;
    }
    kick();
  }
  for (const name of EVENT_NAMES) stops.push(events.on(name, data => onEvent(name, data)));
  stops.push(events.on('connection', ({ connected: open }) => {
    connected = open;
    if (open) schedulePins();
    render();
  }));

  // ---- Commands ----
  const liveSourceId = () => currentSourceId() ?? model.order[0] ?? null;
  const hasLive = () => helloSeen && model.order.length > 0;

  async function toggleFollow() {
    const sourceId = liveSourceId();
    if (!sourceId) return;
    // Off -> on; on or paused -> off (an explicit choice).
    const turnOn = modeFor(sourceId) === 'off';
    await settings.set('S', FOLLOW_KEY, turnOn, settingsWhere(sourceId));
    if (turnOn) {
      userPicked.delete(sourceId);
      ctx.notify('Follow live on · each new revision replaces the view (L)');
    } else ctx.notify('Follow live off · new revisions wait until you show them (L)');
    kick();
  }
  function goToLatest() {
    const sourceId = liveSourceId();
    const latest = sourceId ? model.sources[sourceId]?.lastGood : null;
    if (!latest) return;
    userPicked.delete(sourceId);
    if (latest.modelId === state.after) {
      render();
      return;
    }
    wantSwap = { ...latest, sourceId };
    kick();
  }
  async function post(action) {
    const sourceId = liveSourceId();
    if (!sourceId) return null;
    try {
      return await api.post(`/api/live/${encodeURIComponent(sourceId)}/${action}`, {});
    } catch (error) {
      ctx.notify(`${action === 'cancel' ? 'Cancel' : 'Rebuild'} failed: ${error.message}`);
      return null;
    }
  }
  function openDetails() {
    const sourceId = liveSourceId();
    const source = sourceId ? model.sources[sourceId] : null;
    const worker = model.workerFailed;
    if (!source?.failure && !worker) return undefined;
    return openFailureDrawer(ctx, {
      failure: source?.failure, worker: source?.failure ? null : worker,
      lastGood: source?.lastGood ?? null, scheme: editorScheme(),
      displayed: !!view().input.displayed,
    }).catch(error => ctx.notify(`Failure details unavailable: ${error.message}`));
  }

  commands.register({
    id: 'live.follow', label: 'Follow live on/off', keys: ['L'], enabled: hasLive,
    run: () => toggleFollow(),
  });
  commands.register({
    id: 'live.cancel', label: 'Cancel the running build', enabled: hasLive,
    run: () => post('cancel'),
  });
  commands.register({
    id: 'live.rebuild', label: 'Rebuild the live source', enabled: hasLive,
    run: () => post('rebuild'),
  });
  commands.register({ id: 'live.latest', label: 'Go to the latest revision', run: goToLatest });
  commands.register({ id: 'live.details', label: 'Build failure details', run: openDetails });

  slots.library.row({
    id: 'live.state',
    order: 10,
    render: ({ entry, group }) => {
      const sourceId = entry?.model?.live?.sourceId;
      if (!sourceId || group?.revisions?.[0]?.id !== entry.id) return '';
      const badge = badgeOf(sourceId);
      return badge ? `<span class="item-badge live-badge" data-tone="${badge.tone}">`
        + `${escape(badge.text)}</span>` : '';
    },
  });

  // ---- Inspector: derived data pending after a swap ----
  const swapped = () => store.get().live.swap;
  // Asking the measure feature for its entry starts the request it would start
  // itself when its section binds (memoized per selection).
  const measurementPending = () => {
    const entry = state.selectionSet?.length >= 2 ? app.measureSelection?.() : null;
    return !!entry && entry.status === 'pending';
  };
  slots.inspector.section({
    id: 'live.derived',
    order: 24,
    when: ({ reference }) => !!swapped() && reference?.modelId === swapped().to
      && typeof app.measureSelection === 'function' && measurementPending(),
    render: () => {
      const swap = swapped();
      const previous = revisionOf(swap.from)?.revision;
      return '<section id="live-derived" class="inspector-section live-derived">'
        + '<p class="live-derived-line"><span class="live-pending">pending</span>'
        + ` Measurement of r${swap.revision} is being recomputed. Derived data of`
        + ` ${Number.isInteger(previous) ? `r${previous}` : 'the previous revision'} was cleared`
        + ' on the swap.</p></section>';
    },
  });
  ctx.onFrame(() => {
    const element = $('#live-derived');
    if (!element || element.hidden || !element.isConnected) return;
    if (!measurementPending()) element.hidden = true;
  });

  // ---- View changes: user picks, pause, pins ----
  const afterKey = () => state.after ?? '';
  stops.push(store.select(afterKey, after => {
    if (applying || !helloSeen) return;
    const sourceId = sourceOfModel(after);
    if (sourceId) {
      const newest = newestListed(sourceId);
      const picked = revisionOf(after);
      if (newest && newest.id !== after && picked && picked.revision < newest.live.revision) {
        userPicked.set(sourceId, after);
      } else userPicked.delete(sourceId);
    }
    displayedRevision = null;
    rememberDisplayed();
    kick();
  }));
  const viewKey = () => [state.after, state.compare ? state.before : '',
    [...annotationModels(state.annotations ?? [])].sort().join(','),
    app.ghostModelId?.() ?? ''].join('|');
  stops.push(store.select(viewKey, () => {
    schedulePins();
    if (helloSeen) kick();
  }));
  stops.push(store.select(() => !!state.loading, isLoading => {
    if (!isLoading && helloSeen) kick();
  }));
  stops.push(settings.onChange?.(() => {
    if (helloSeen) render();
  }));

  // ---- Start ----
  if (!ctx.legacy && env.EventSource) {
    clientId = clientIdOf(env);
    events.connect({ clientId });
  }

  return {
    api: {
      // Debug and cross-feature: a snapshot of the live state.
      liveStatus: () => ({
        connected, session: model.session, clientId, helloSeen,
        trust: shown, follow: currentSourceId() ? modeFor(currentSourceId()) : null,
        displayed: { modelId: state.after, revision: displayedRevision?.revision ?? null },
        loading, lastSwap, events: events.status?.() ?? null,
        sources: model.order.map(sourceId => ({ ...model.sources[sourceId] })),
      }),
      // listener({ from, to, revision }) after each live swap (derived data
      // keyed by model id is stale then).
      onLiveSwap(listener) {
        swapListeners.add(listener);
        return () => swapListeners.delete(listener);
      },
      liveRevision: modelId => revisionOf(modelId),
      preferredAfter,
    },
    defaults: { live: { trust: null, follow: null, swap: null } },
    dispose() {
      for (const stop of stops) stop?.();
      env.clearTimeout(wakeTimer);
      env.clearTimeout(tickTimer);
      env.clearTimeout(pinTimer);
      swapScope.abort();
      listScope.abort();
    },
  };
}
