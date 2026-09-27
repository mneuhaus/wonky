// Ghost of the previous revision and exact bounds deltas (spec 3.4, 9.2).
// Package: diff-overlay (P1).
//
//   Shift+W / #ghost-toggle  ghost on or off. The ghost is the previous
//            revision of the displayed model's source (in compare mode: the
//            before model), drawn translucent over the displayed model by the
//            GL layer in ghost-layer.js. The panel above the view actions
//            names it ("r3 ghost"), has the blend slider (ghost opacity, G
//            setting ghostBlend) and the bounds and volume deltas from
//            GET /api/diff, each with its exactness chip.
//   Keyed by model id: whenever the displayed model changes (a live swap, a
//            library click, a compare change) the ghost and its deltas are
//            cleared at once and show "pending" until the new pair has its
//            draw payload and its /api/diff answer.
//
// Store keys: `diff` (controller snapshot and blend), `display.ghost`
// ({ modelId, opacity }: pins the ghost in the scene cache and widens the
// pane's depth window; only set while the ghost is drawn).
// Nothing runs on the legacy seam (the feature is not in the VS set).
// Debug handle (window.wonkyViewer.app): ghostStatus(), toggleGhost(on),
// setGhostBlend(value), ghostModelId().
import { escape } from '../../core/dom.js';
import { exactnessChipMarkup, number, toleranceDecimals } from '../../core/format.js';
import { createGhostLayer } from './ghost-layer.js';

export const id = 'diff';
export const legacy = false;

export const BLEND_KEY = 'ghostBlend';
export const DEFAULT_BLEND = 0.35;
export const BLEND_MIN = 0.05;
const MINUS = '−';

export const clampBlend = value => {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_BLEND;
  return Math.min(1, Math.max(BLEND_MIN, Math.round(number * 100) / 100));
};

const isAbort = error => error?.name === 'AbortError';

// ---------------------------------------------------------------------------
// Texts (pure, tested).

// "r3 ghost", "archived ghost", or "ghost" without revision facts.
export function ghostLabel(revision) {
  if (revision?.kind === 'archive') return 'archived ghost';
  return Number.isInteger(revision?.revision) ? `r${revision.revision} ghost` : 'ghost';
}

const signedNumber = (value, digits) => {
  if (!Number.isFinite(value)) return 'not evaluated';
  const text = number(Math.abs(value), digits);
  if (Number(text.replace(/,/g, '')) === 0) return '0';
  return `${value > 0 ? '+' : MINUS}${text}`;
};

// Digits of a bounds value: display values and kernel-resolved values to the
// decade of their tolerance, recorded values to 0.001 mm.
export function boundsDigits(bounds) {
  if (bounds?.exactness === 'recorded' || !(bounds?.toleranceMm > 0)) return 3;
  return toleranceDecimals(bounds.toleranceMm);
}

export function boundsDeltaText(bounds) {
  if (!bounds || bounds.status !== 'evaluated') return 'bounds not evaluated';
  const digits = boundsDigits(bounds);
  return `bounds Δ ${bounds.delta.size.map(value => signedNumber(value, digits)).join(' × ')} mm`;
}

export function volumeDeltaText(volume) {
  if (!volume || volume.status !== 'evaluated') return 'volume not evaluated';
  return `volume Δ ${signedNumber(volume.delta, 1)} mm³`;
}

const sizeText = (box, digits) => (box
  ? `${box.size.map(value => number(value, digits)).join(' × ')} mm` : 'not evaluated');

// Title of the bounds item: sizes and where the values come from.
export function boundsTitle(bounds) {
  if (!bounds || bounds.status !== 'evaluated') {
    return bounds?.before?.kernelReason ?? bounds?.after?.kernelReason
      ?? 'No recorded, kernel or display bounds';
  }
  const digits = boundsDigits(bounds);
  const parts = [`${sizeText(bounds.before, digits)} → ${sizeText(bounds.after, digits)}`];
  const method = bounds.before?.method ?? bounds.after?.method;
  if (bounds.exactness === 'kernel-resolved' && method) parts.push(method);
  const reasons = [bounds.before?.kernelReason, bounds.after?.kernelReason].filter(Boolean);
  if (reasons.length) parts.push(`kernel bounds unavailable: ${reasons.join('; ')}`);
  return parts.join(' · ');
}

const chip = (exactness, toleranceMm) => (exactness
  ? exactnessChipMarkup(exactness, toleranceMm) : '');

// Delta items [{ key, text, chip, title }] of a GET /api/diff answer.
export function deltaItems(result) {
  const deltas = result?.deltas;
  if (!deltas) return [];
  return [
    {
      key: 'bounds', text: boundsDeltaText(deltas.bounds),
      chip: chip(deltas.bounds?.exactness, deltas.bounds?.toleranceMm),
      title: boundsTitle(deltas.bounds),
    },
    {
      key: 'volume', text: volumeDeltaText(deltas.volumeMm3), chip: chip('recorded'),
      title: deltas.volumeMm3?.status === 'evaluated'
        ? `${number(deltas.volumeMm3.before, 2)} → ${number(deltas.volumeMm3.after, 2)} mm³`
        : 'Recorded volume is null for '
          + `${(deltas.volumeMm3?.notEvaluated ?? []).join(' and ') || 'a'} revision`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Controller (pure state machine over injected effects, tested).
//
//   view()                 { after, before, compare }
//   previous(id)           previous revision of the same source, or null
//   loadModel(id)          resolves when the ghost's draw data is cached
//   fetchDiff({ before, after }, { signal })  GET /api/diff
//   scope                  latest-wins request scope (core/requests.js)
//   unavailable()          null, or why the ghost cannot be drawn (no WebGL2)
//   emit(snapshot)         after every change
//
// Snapshot: { on, key, forModelId, modelId, pairing, status, reason, diff }
//   status  off | pending | ready | none | failed | unavailable
//   diff    { status: idle | pending | ready | none | failed, result, error }
const IDLE_DIFF = Object.freeze({ status: 'idle', result: null, error: null });

export const initialGhost = () => ({
  on: false, key: null, forModelId: null, modelId: null, pairing: null, status: 'off',
  reason: null, diff: IDLE_DIFF,
});

// Ghost pairing on the client: the compare before model, else the previous
// revision of the same source; null leaves the pairing to the server.
export function ghostTarget({ after, before, compare } = {}, previous = () => null) {
  if (!after) return { forModelId: null, modelId: null, pairing: null };
  if (compare && before && before !== after) {
    return { forModelId: after, modelId: before, pairing: 'explicit' };
  }
  const modelId = previous(after) ?? null;
  return { forModelId: after, modelId, pairing: modelId ? 'previous-revision' : null };
}

export function createGhostController({
  view, previous = () => null, loadModel, fetchDiff, scope, unavailable = () => null,
  emit = () => {},
}) {
  let state = initialGhost();
  const set = patch => {
    state = { ...state, ...patch };
    emit(state);
  };

  async function diffOf(target, run) {
    try {
      const result = await fetchDiff({ before: target.modelId, after: target.forModelId },
        { signal: run.signal });
      if (!run.current()) return null;
      if (result?.pairing === 'none' || !result?.ghost?.modelId) {
        set({
          status: 'none', reason: result?.reason ?? 'No earlier revision of this source',
          diff: { status: 'none', result: result ?? null, error: null },
        });
        return null;
      }
      set({ diff: { status: 'ready', result, error: null } });
      return result;
    } catch (error) {
      if (!run.current() || isAbort(error)) return null;
      set({ diff: { status: 'failed', result: null, error: error.message } });
      return null;
    }
  }

  async function start(target, run) {
    const diffing = diffOf(target, run);
    let ghostId = target.modelId;
    if (!ghostId) {
      const result = await diffing;
      if (!run.current()) return;
      if (!result) {
        if (state.status === 'pending') {
          set({ status: 'failed', reason: `Ghost pairing unavailable: ${state.diff.error}` });
        }
        return;
      }
      ghostId = result.ghost.modelId;
      set({ modelId: ghostId, pairing: result.pairing });
    }
    const blocked = unavailable();
    if (blocked) {
      set({ status: 'unavailable', reason: blocked });
      return;
    }
    try {
      await loadModel(ghostId);
    } catch (error) {
      if (!run.current() || isAbort(error)) return;
      set({ status: 'failed', reason: `Ghost draw data unavailable: ${error.message}` });
      return;
    }
    if (run.current() && state.status === 'pending') set({ status: 'ready' });
  }

  function sync({ force = false } = {}) {
    if (!state.on) return state;
    const target = ghostTarget(view(), previous);
    const key = `${target.forModelId ?? ''}|${target.modelId ?? '?'}`;
    if (!force && key === state.key) return state;
    const run = scope.begin();
    if (!target.forModelId) {
      set({ key, forModelId: null, modelId: null, pairing: null, status: 'none',
        reason: 'No model is displayed', diff: IDLE_DIFF });
      return state;
    }
    set({
      key, forModelId: target.forModelId, modelId: target.modelId, pairing: target.pairing,
      status: 'pending', reason: null, diff: { status: 'pending', result: null, error: null },
    });
    start(target, run);
    return state;
  }

  function toggle(on = !state.on) {
    if (!!on === state.on) return state;
    if (on) {
      state = { ...initialGhost(), on: true };
      return sync({ force: true });
    }
    scope.abort?.();
    set(initialGhost());
    return state;
  }

  return {
    sync,
    toggle,
    snapshot: () => state,
    // The ghost to draw: only a loaded pair of the displayed model.
    drawn: () => (state.on && state.status === 'ready' && state.modelId
      ? { modelId: state.modelId, forModelId: state.forModelId } : null),
  };
}

// ---------------------------------------------------------------------------
// Markup.

const GHOST_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"'
  + ' stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">'
  + '<path d="M9 4h9a2 2 0 0 1 2 2v9" stroke-dasharray="2.2 2.2"/>'
  + '<rect x="4" y="8" width="12" height="12" rx="2"/></svg>';
const TOGGLE = '<button id="ghost-toggle" class="icon-button" type="button"'
  + ' aria-pressed="false" title="Ghost of the previous revision (Shift+W)"'
  + ` aria-label="Ghost of the previous revision">${GHOST_ICON}</button>`;
const PANEL = '<div id="ghost-panel" class="ghost-panel" role="group"'
  + ' aria-label="Ghost of the previous revision" hidden>'
  + '<span class="ghost-name"><span class="ghost-swatch" aria-hidden="true"></span>'
  + '<span id="ghost-label">ghost</span>'
  + '<span id="ghost-state" class="ghost-state"></span></span>'
  + '<label class="ghost-blend" for="ghost-blend">Blend<input id="ghost-blend" type="range"'
  + ` min="${BLEND_MIN * 100}" max="100" step="5" value="${DEFAULT_BLEND * 100}">`
  + `<output id="ghost-blend-value" for="ghost-blend">${DEFAULT_BLEND * 100} %</output></label>`
  + '<button id="ghost-details" class="ghost-delta" type="button"'
  + ' title="Show the delta with every label"></button>'
  + '<button id="ghost-close" class="ghost-close" type="button"'
  + ' title="Hide the ghost (Shift+W)" aria-label="Hide the ghost">×</button></div>';

const STATE_TEXT = {
  pending: 'pending', ready: '', none: '', failed: 'unavailable', unavailable: 'not drawn',
  off: '',
};

export function panelModel(snapshot, { label }) {
  const reason = ['none', 'failed', 'unavailable'].includes(snapshot.status)
    ? snapshot.reason : null;
  const diff = snapshot.diff ?? IDLE_DIFF;
  let delta;
  if (snapshot.status === 'none') delta = { text: 'no ghost', items: [] };
  else if (diff.status === 'ready') delta = { items: deltaItems(diff.result) };
  else if (diff.status === 'failed') {
    delta = { text: `delta unavailable: ${diff.error}`, items: [] };
  } else delta = { text: 'bounds Δ pending', items: [], pending: true };
  // A drawn ghost whose delta is still computing reads "pending" too.
  const pending = snapshot.status === 'ready' && diff.status === 'pending';
  return {
    hidden: !snapshot.on,
    label: snapshot.status === 'none' && !snapshot.modelId ? 'ghost' : label,
    state: pending ? 'pending' : STATE_TEXT[snapshot.status] ?? snapshot.status,
    tone: pending ? 'pending' : snapshot.status,
    reason,
    delta,
  };
}

const itemMarkup = item => `<span class="ghost-delta-item"${item.title
  ? ` title="${escape(item.title)}"` : ''}>${escape(item.text)}${item.chip ?? ''}</span>`;

function deltaMarkup(delta) {
  if (!delta.items.length) {
    return `<span class="ghost-delta-note${delta.pending ? ' pending' : ''}">`
      + `${escape(delta.text)}</span>`;
  }
  return delta.items.map(itemMarkup).join('<span class="ghost-sep" aria-hidden="true">·</span>');
}

// ---------------------------------------------------------------------------
// Details drawer.

const cell = value => `<td>${escape(value ?? '–')}</td>`;
const triple = (box, digits) => (box ? box.map(value => number(value, digits)).join(', ') : null);

function boundsRows(bounds) {
  if (bounds?.status !== 'evaluated') {
    return '<tr><th>Bounds</th><td colspan="3">not evaluated</td><td></td></tr>';
  }
  const digits = boundsDigits(bounds);
  const label = chip(bounds.exactness, bounds.toleranceMm);
  return ['size', 'min', 'max'].map(key => `<tr><th>Bounds ${key} (mm)</th>`
    + `${cell(triple(bounds.before[key], digits))}${cell(triple(bounds.after[key], digits))}`
    + `${cell(bounds.delta[key].map(value => signedNumber(value, digits)).join(', '))}`
    + `<td>${label}</td></tr>`).join('');
}

function kernelRows(side, name) {
  const summary = side?.kernelBounds;
  if (!summary || summary.status === 'not-needed') {
    return `<tr><th>${escape(name)}</th><td colspan="3">every body has recorded bounds</td></tr>`;
  }
  return (summary.bodies ?? []).map(row => `<tr><th>${escape(name)} ${escape(row.alias)}`
    + `<small>${escape(row.bodyId)}</small></th>`
    + `<td>${escape(row.source)}</td><td>${escape(row.status)}</td>`
    + `<td>${escape(row.bounds ? sizeText(row.bounds, 4) : row.reason ?? '')}</td></tr>`).join('');
}

export function detailsMarkup(result, { names }) {
  const { deltas } = result;
  const volume = deltas.volumeMm3;
  const volumeValue = key => (volume[key] === null ? 'not evaluated' : number(volume[key], 2));
  const method = deltas.bounds?.before?.method ?? deltas.bounds?.after?.method;
  return '<div class="ghost-report">'
    + `<p class="small muted">${escape(result.scope ?? '')}</p>`
    + `<table class="ghost-table"><thead><tr><th></th><th>${escape(names.before)}</th>`
    + `<th>${escape(names.after)}</th><th>Δ</th><th>Label</th></tr></thead><tbody>`
    + boundsRows(deltas.bounds)
    + `<tr><th>Volume (mm³)</th>${cell(volumeValue('before'))}${cell(volumeValue('after'))}`
    + `${cell(volume.status === 'evaluated' ? signedNumber(volume.delta, 2) : 'not evaluated')}`
    + `<td>${chip('recorded')}</td></tr></tbody></table>`
    + (method ? `<p class="small muted">Kernel bounds: ${escape(method)}.</p>` : '')
    + '<h3>Bounds per body <small>source and status</small></h3>'
    + '<table class="ghost-table"><thead><tr><th>Body</th><th>Source</th><th>Status</th>'
    + '<th>Size (mm) or reason</th></tr></thead><tbody>'
    + kernelRows(result.before, names.before) + kernelRows(result.after, names.after)
    + '</tbody></table>'
    + `<p class="small muted">${escape(result.ghost?.note ?? '')}</p></div>`;
}

// ---------------------------------------------------------------------------
// Feature.

export function setup(ctx) {
  const { store, app, api, commands, slots, settings, renderer, state, dom: { $ } } = ctx;
  slots.viewActions.button({ id: 'diff.ghost', order: 13, html: TOGGLE });
  // Lower-right column shared with the overhang legend (styles/layout.css).
  slots.viewportHud.item({ corner: 'bottom-right', id: 'diff.panel', order: 40, html: PANEL });

  const unavailable = () => {
    try {
      return renderer?.unavailableReason?.() ?? null;
    } catch {
      return null;
    }
  };
  const blendOf = () => store.get().diff?.blend ?? DEFAULT_BLEND;

  const controller = createGhostController({
    view: () => ({ after: state.after, before: state.before, compare: !!state.compare }),
    previous: modelId => app.previousRevision?.(modelId) ?? null,
    // Shared with other loaders of the same payload, so not aborted here.
    loadModel: modelId => renderer.loadModel(modelId),
    fetchDiff: ({ before, after }, { signal }) => {
      const query = new URLSearchParams({ after });
      if (before) query.set('before', before);
      return api.json(`/api/diff?${query}`, { signal });
    },
    scope: ctx.requests.scope('diff.ghost'),
    unavailable,
    emit: publish,
  });

  // The panel first, then one notification for the snapshot and the style
  // key, so no listener ever sees a new pair with the previous pair's ghost
  // still in the style or in the panel.
  function publish(snapshot) {
    const modelId = controller?.drawn?.()?.modelId ?? null;
    render();
    store.batch('diff.ghost', () => {
      store.update('diff.ghost', current => {
        current.diff.ghost = snapshot;
      });
      const ghost = store.get().display.ghost;
      if (ghost.modelId !== modelId || ghost.opacity !== blendOf()) {
        store.update('display.ghost', current => {
          current.display.ghost = { modelId, opacity: blendOf() };
        });
      }
    });
    app.scheduleDraw?.();
  }

  const layer = ctx.legacy ? null : createGhostLayer({
    renderer,
    modelOf: modelId => ctx.cache?.model?.(modelId) ?? renderer.model?.(modelId) ?? null,
    current: () => {
      const drawn = controller.drawn();
      return drawn ? { ...drawn, opacity: blendOf() } : null;
    },
  });

  // ---- Panel ----
  const labelOf = modelId => {
    const entry = app.revisionOf?.(modelId)?.entry;
    if (entry) return ghostLabel(entry);
    const result = controller.snapshot().diff.result;
    return ghostLabel(result?.before?.modelId === modelId ? result.before : null);
  };

  function render() {
    const panel = $('#ghost-panel');
    const snapshot = controller.snapshot();
    $('#ghost-toggle')?.setAttribute('aria-pressed', String(snapshot.on));
    if (!panel) return;
    const model = panelModel(snapshot, { label: labelOf(snapshot.modelId) });
    panel.hidden = model.hidden;
    panel.dataset.status = snapshot.status;
    if (model.hidden) return;
    $('#ghost-label').textContent = model.label;
    const stateElement = $('#ghost-state');
    stateElement.textContent = model.state;
    stateElement.hidden = !model.state;
    stateElement.dataset.tone = model.tone;
    const details = $('#ghost-details');
    details.innerHTML = deltaMarkup(model.delta);
    details.disabled = snapshot.diff.status !== 'ready';
    details.title = model.reason ?? (snapshot.diff.status === 'ready'
      ? 'Show the delta with every label' : '');
    if (model.reason && !model.delta.items.length) {
      details.innerHTML = `<span class="ghost-delta-note">${escape(model.reason)}</span>`;
    }
    const blend = blendOf();
    const input = $('#ghost-blend');
    if (input && Number(input.value) !== Math.round(blend * 100)) {
      input.value = String(Math.round(blend * 100));
    }
    const output = $('#ghost-blend-value');
    if (output) output.textContent = `${Math.round(blend * 100)} %`;
  }

  function setBlend(value, { persist = true } = {}) {
    const blend = clampBlend(value);
    store.update('diff.blend', current => {
      current.diff.blend = blend;
    });
    if (persist && settings.loaded?.()) settings.set('G', BLEND_KEY, blend);
    publish(controller.snapshot());
    return blend;
  }

  function bindPanel() {
    const input = $('#ghost-blend');
    // Opacity follows the drag; the G setting is written once on release.
    if (input) {
      input.oninput = () => setBlend(Number(input.value) / 100, { persist: false });
      input.onchange = () => setBlend(Number(input.value) / 100);
    }
    const close = $('#ghost-close');
    if (close) close.onclick = () => toggle(false);
    const details = $('#ghost-details');
    if (details) details.onclick = () => openDetails().catch(ctx.showError);
  }

  async function openDetails() {
    const snapshot = controller.snapshot();
    const result = snapshot.diff.result;
    if (!result || snapshot.diff.status !== 'ready') return;
    const nameOf = (modelId, fallback) => app.revisionName?.(modelId) || fallback;
    const names = {
      before: `${nameOf(result.before.modelId, 'Before')} (ghost)`,
      after: nameOf(result.after.modelId, 'After'),
    };
    await ctx.drawer.open({
      title: `${names.before} → ${names.after}`, eyebrow: 'Ghost delta',
      load: async () => result,
      render: data => {
        const eyebrow = $('#report-drawer .eyebrow');
        if (eyebrow) eyebrow.textContent = 'Ghost delta';
        const content = $('#report-content');
        if (content) content.innerHTML = detailsMarkup(data, { names });
      },
    });
  }

  function toggle(on) {
    const snapshot = controller.toggle(on);
    if (!snapshot.on) layer?.reset();
    return snapshot;
  }

  commands.register({
    id: 'diff.ghost', label: 'Ghost of previous revision', keys: ['Shift+W'],
    run: () => toggle(),
  });
  commands.bind('#ghost-toggle', 'diff.ghost');
  bindPanel();
  render();

  // ---- Keyed by model id: re-pair on every change of the displayed pair ----
  const pairKey = () => [state.after ?? '', state.compare ? state.before ?? '' : '',
    state.after ? app.previousRevision?.(state.after) ?? '' : ''].join('|');
  const stops = [
    store.select(pairKey, () => controller.sync()),
    settings.onChange?.(() => {
      const saved = settings.get('G', BLEND_KEY, null);
      if (saved !== null && clampBlend(saved) !== blendOf()) setBlend(saved, { persist: false });
    }),
    app.onLiveSwap?.(() => controller.sync()),
  ];

  return {
    api: {
      ghostStatus: () => ({
        ...controller.snapshot(), blend: blendOf(), drawn: controller.drawn(),
        display: { ...store.get().display.ghost }, layer: layer?.stats() ?? null,
      }),
      toggleGhost: on => toggle(on),
      setGhostBlend: value => setBlend(value),
      // For client pins (live-client): the ghost revision while it is shown.
      ghostModelId: () => (controller.snapshot().on ? controller.snapshot().modelId : null),
    },
    defaults: {
      diff: { ghost: initialGhost(), blend: DEFAULT_BLEND },
      'display.ghost': { modelId: null, opacity: DEFAULT_BLEND },
    },
    dispose() {
      for (const stop of stops) stop?.();
      layer?.dispose();
    },
  };
}
