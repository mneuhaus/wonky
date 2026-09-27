// Model bar (single mode: title, revision chip, delta strip, "Compare with
// previous"; compare mode: before/after selectors, swap, compare toggle),
// wipe and side-by-side layouts, the model title HUD. Legacy feature (VS).
// Owner: model-first-compare.
//
// Compare is off by default and persisted per source (settings scope S key
// `compare`; an explicitly chosen before model as `compareBefore`). `W` and
// "Compare with previous" open compare against the previous revision of the
// same source; without one, compare opens with the before selector focused.
import { escape } from '../../core/dom.js';
import { short } from '../../core/format.js';
import { modelLabel } from '../../core/scene-records.js';
import { createDeltaStrip } from './delta-strip.js';
import { createLayout } from './layout.js';
import { createModelLoader } from './load-models.js';

export const id = 'compare';
export const legacy = true;

const MODEL = '<div id="model-bar-title" class="model-bar-title"><h2 id="model-bar-name"'
  + ' class="model-bar-name">Model</h2><span id="model-bar-revision" class="revision-chip">'
  + '</span><button id="model-bar-newer" class="revision-newer" type="button" hidden></button>'
  + '</div>';
const BEFORE = '<label class="version-select"><span class="eyebrow">'
  + '<i class="version-dot before"></i>Before</span><select id="before-model"'
  + ' aria-label="Before model version"></select></label>';
const SWAP = '<button id="swap-models" class="icon-button swap-button"'
  + ' title="Swap before and after" aria-label="Swap before and after" data-icon="swap"></button>';
const AFTER = '<label class="version-select"><span class="eyebrow">'
  + '<i class="version-dot after"></i><span id="after-label">After</span></span>'
  + '<select id="after-model" aria-label="After model version"></select></label>';
const PREVIOUS = '<button id="compare-previous" class="button compare-button compare-previous"'
  + ' type="button" aria-pressed="false" aria-keyshortcuts="W"><span data-icon="compare"></span>'
  + '<span class="compare-previous-label">Compare with previous</span>'
  + '<kbd class="key-hint">W</kbd></button>';
const TOGGLE = '<button id="compare-toggle" class="button compare-button" aria-pressed="true"'
  + ' title="Leave compare mode (W)"><span data-icon="compare"></span><span>Compare</span>'
  + '</button>';
const DELTA = '<div id="delta-strip" class="delta-strip" aria-live="polite" hidden></div>';
const TITLE = '<h1 id="model-title">Model review</h1><p id="model-summary" class="muted">Choose a'
  + ' model to begin</p><p id="display-note" class="viewport-display-note" hidden></p>';
const DIVIDER = '<div id="wipe-divider" class="wipe-divider"><button id="wipe-handle"'
  + ' class="wipe-handle" aria-label="Drag comparison divider" title="Drag to compare">'
  + '<span data-icon="compare"></span></button></div>';
// The version bar and #comparison-bar are fixed-height shell regions in
// index.html, so the canvas has its final size on the first frame.
const BEFORE_LABEL = '<div class="comparison-label"><i class="version-dot before"></i>'
  + '<span>Before</span><small id="before-short"></small></div>';
const CONTROLS = '<div class="comparison-controls">'
  + '<div class="comparison-layout" role="group" aria-label="Comparison layout">'
  + '<button id="layout-wipe" aria-pressed="true" title="Reveal each model with a movable divider">'
  + 'Wipe</button><button id="layout-side-by-side" aria-pressed="false"'
  + ' title="Show both complete models with a shared camera">Side by side</button></div>'
  + '<div id="comparison-range" class="comparison-range"><input id="comparison-split" type="range"'
  + ' min="0" max="100" value="50" aria-label="Before and after comparison split">'
  + '<output id="split-value" for="comparison-split">50 / 50</output></div>'
  + '<span id="linked-camera" class="linked-camera" hidden>Linked camera</span></div>';
const AFTER_LABEL = '<div class="comparison-label after-label"><small id="after-short"></small>'
  + '<span>After</span><i class="version-dot after"></i></div>';

export function setup(ctx) {
  const { state, app, slots, commands, settings, dom: { $ } } = ctx;
  slots.modelBar.item({ id: 'compare.model', order: 5, html: MODEL });
  slots.modelBar.item({ id: 'compare.before', order: 10, html: BEFORE });
  slots.modelBar.item({ id: 'compare.swap', order: 20, html: SWAP });
  slots.modelBar.item({ id: 'compare.after', order: 30, html: AFTER });
  slots.modelBar.item({ id: 'compare.previous', order: 38, html: PREVIOUS });
  slots.modelBar.item({ id: 'compare.toggle', order: 40, html: TOGGLE });
  slots.modelBar.item({ id: 'compare.delta', order: 90, html: DELTA });
  slots.viewportHud.item({ id: 'compare.title', corner: 'top-left', order: 10, html: TITLE });
  slots.add('stage', { id: 'compare.divider', order: 40, html: DIVIDER });
  slots.add('comparisonBar', { id: 'compare.before-label', order: 10, html: BEFORE_LABEL });
  slots.add('comparisonBar', { id: 'compare.controls', order: 20, html: CONTROLS });
  slots.add('comparisonBar', { id: 'compare.after-label', order: 30, html: AFTER_LABEL });

  const { setSplit, setLayout } = createLayout(ctx);
  const loader = createModelLoader(ctx);
  const delta = createDeltaStrip(ctx);
  let optionsMarkup = null;

  const revision = modelId => app.revisionOf?.(modelId) ?? null;
  const revisionText = modelId => app.revisionText?.(modelId) ?? '';
  const where = () => ({ source: app.sourceKey?.(state.after) });

  // Grouped options: the after model's source first, then the other sources
  // in library order, archived snapshots last. The closed select shows only
  // the option, so every option names its model: "bracket · r3 · 14:05 · b922…".
  function renderModelOptions() {
    const groups = app.revisionGroups?.() ?? [];
    const current = app.sourceKey?.(state.after);
    const ordered = [...groups.filter(group => group.key === current),
      ...groups.filter(group => group.key !== current)];
    const option = entry => `<option value="${escape(entry.id)}">`
      + `${escape([app.entryTitle(entry.id), revisionText(entry.id),
        short(entry.model.sha256 ?? entry.id)].filter(Boolean).join(' · '))}</option>`;
    const markup = ordered.map(group => `<optgroup label="${escape(group.label)}`
      + `${group.key === current && group.kind !== 'archive' ? ' (this source)' : ''}">`
      + `${group.revisions.map(option).join('')}</optgroup>`).join('');
    if (markup === optionsMarkup) return;
    optionsMarkup = markup;
    $('#before-model').innerHTML = markup;
    $('#after-model').innerHTML = markup;
  }

  // Compare chrome only with something to compare (also avoids a flash of
  // compare chrome while the startup workspace loads: store default is true).
  const comparing = () => state.compare && state.workspace.models.length > 1;

  function renderModelBar() {
    const record = revision(state.after);
    const group = record?.group;
    $('#model-bar-name').textContent = record ? app.entryTitle(state.after)
      : modelLabel(state.workspace, state.scenes, state.after);
    $('#model-bar-name').title = group?.path ?? '';
    const latest = group && group.kind !== 'archive' && group.revisions.length > 1
      && !record.position;
    $('#model-bar-revision').textContent = record
      ? `${revisionText(state.after)}${latest ? ' · latest' : ''}` : '';
    $('#model-bar-revision').title = record ? app.revisionTimeTitle(state.after) : '';
    const newer = record && group.kind !== 'archive' && record.position > 0 ? record.newest : null;
    $('#model-bar-newer').hidden = !newer;
    $('#model-bar-newer').textContent = newer ? `r${newer.revision} is newer` : '';
    $('#model-bar-newer').dataset.model = newer?.id ?? '';
    const previous = app.previousRevision?.(state.after);
    const button = $('#compare-previous');
    button.disabled = state.workspace.models.length < 2;
    button.title = state.workspace.models.length < 2
      ? 'Only one model version in this workspace'
      : previous ? `Compare with ${revisionText(previous)} of this source (W)`
        : 'No earlier revision of this source: choose a before model (W)';
  }

  function syncControls() {
    renderModelOptions();
    const compare = comparing();
    $('.version-bar').dataset.mode = compare ? 'compare' : 'single';
    $('#before-model').value = state.before ?? '';
    $('#after-model').value = state.after ?? '';
    $('#before-model').disabled = !state.compare;
    $('#swap-models').disabled = !state.compare;
    $('#compare-toggle').setAttribute('aria-pressed', String(state.compare));
    $('#compare-toggle').disabled = state.workspace.models.length < 2;
    $('#compare-previous').setAttribute('aria-pressed', String(state.compare));
    $('#comparison-bar').hidden = !compare;
    $('#wipe-divider').hidden = !compare;
    const paired = state.layout === 'side-by-side';
    $('#stage').dataset.layout = compare ? state.layout : 'single';
    $('#wipe-handle').hidden = paired;
    $('#comparison-range').hidden = paired;
    $('#linked-camera').hidden = !paired;
    $('#layout-wipe').setAttribute('aria-pressed', String(!paired));
    $('#layout-side-by-side').setAttribute('aria-pressed', String(paired));
    $('#after-label').textContent = state.compare ? 'After' : 'Model';
    $('#before-short').textContent = short(state.before);
    $('#after-short').textContent = short(state.after);
    setSplit(state.split, false);
    const scene = state.scenes.get(state.after);
    const summary = ctx.renderer.summary(state.after);
    $('#model-title').textContent = scene?.label
      ?? modelLabel(state.workspace, state.scenes, state.after);
    $('#model-summary').textContent = summary
      ? `${summary.bodies.length} ${summary.bodies.length === 1 ? 'body' : 'bodies'} · `
        + `${summary.faces} faces · ${short(state.after)}`
      : 'Choose a model to begin';
    const summaries = loader.activeSummaries();
    const incompleteFaces = summaries.reduce((sum, item) => sum
      + item.displayWarnings.length, 0);
    const diagnostics = summaries.filter(item => item.diagnostic)
      .map(item => item.diagnostic.purpose);
    const faceNote = incompleteFaces
      ? `${incompleteFaces} ${incompleteFaces === 1 ? 'face shown' : 'faces shown'}`
        + ' as boundaries only'
      : '';
    $('#display-note').hidden = !incompleteFaces && !diagnostics.length;
    $('#display-note').textContent = [faceNote, ...diagnostics].filter(Boolean).join(' · ');
    renderModelBar();
    delta.render();
    app.renderSaveAction();
    app.renderLibrary();
  }

  // Persists the compare mode of the displayed model's source (scope S).
  function persistMode(before) {
    const place = where();
    if (!place.source) return;
    settings.set('S', 'compare', state.compare, place);
    if (before !== undefined) settings.set('S', 'compareBefore', before, place);
  }

  function leaveCompare() {
    state.compare = false;
    ctx.review.touch('compare.toggle');
    persistMode();
    app.loadSelectedModels(false).catch(ctx.showError);
  }

  // Opens compare with `before`; without one, with before = after and the
  // before selector focused, so a before model can be chosen.
  function enterCompare(before, chosen) {
    state.before = before ?? state.after;
    state.compare = true;
    ctx.review.touch('compare.toggle');
    persistMode(chosen ?? null);
    const loading = app.loadSelectedModels(false).catch(ctx.showError);
    if (!before) {
      ctx.notify('No earlier revision of this source · choose a before model');
      loading.then(() => {
        const select = $('#before-model');
        select.focus?.();
        try {
          select.showPicker?.();
        } catch {
          // showPicker needs a user activation; the focused select is enough.
        }
      });
    }
    return loading;
  }

  function comparePrevious() {
    if (!state.after || state.workspace.models.length < 2) return undefined;
    if (state.compare) return leaveCompare();
    return enterCompare(app.previousRevision?.(state.after) ?? null);
  }

  // The toggle keeps its pre-foundation meaning (VS): on with the current
  // before model when it is a different model, else like W.
  function toggleCompare() {
    if (state.compare) return leaveCompare();
    const current = state.before && state.before !== state.after ? state.before : null;
    return enterCompare(current ?? app.previousRevision?.(state.after) ?? null,
      current && current !== app.previousRevision?.(state.after) ? current : undefined);
  }

  $('#before-model').onchange = event => {
    state.before = event.target.value;
    if (state.saved) ctx.review.touch('compare.before');
    if (state.compare) {
      const previous = app.previousRevision?.(state.after);
      persistMode(state.before === previous ? null : state.before);
    }
    app.loadSelectedModels().catch(ctx.showError);
  };
  $('#after-model').onchange = event => {
    state.after = event.target.value;
    if (state.saved) ctx.review.touch('compare.after');
    app.loadSelectedModels().catch(ctx.showError);
  };
  commands.register({
    id: 'compare.swap', label: 'Swap before and after',
    run: () => {
      [state.before, state.after] = [state.after, state.before];
      ctx.review.touch('compare.swap');
      app.loadSelectedModels(false).catch(ctx.showError);
    },
  });
  commands.register({ id: 'compare.toggle', label: 'Compare', run: toggleCompare });
  commands.register({
    id: 'compare.previous', label: 'Compare with previous', keys: ['W'], run: comparePrevious,
  });
  commands.register({
    id: 'compare.newest', label: 'Show the newest revision of this source',
    run: () => {
      // A live revision goes through live-client, which also clears a
      // picked revision so follow live resumes.
      if (app.liveRevision?.(state.after) && commands.get('live.latest')) {
        commands.run('live.latest');
        return;
      }
      const target = $('#model-bar-newer').dataset.model;
      if (target) app.openModel(target);
    },
  });
  commands.register({ id: 'compare.layout.wipe', label: 'Wipe', run: () => setLayout('wipe') });
  commands.register({
    id: 'compare.layout.sideBySide', label: 'Side by side', run: () => setLayout('side-by-side'),
  });
  commands.bind('#swap-models', 'compare.swap');
  commands.bind('#compare-toggle', 'compare.toggle');
  commands.bind('#compare-previous', 'compare.previous');
  commands.bind('#model-bar-newer', 'compare.newest');
  commands.bind('#layout-wipe', 'compare.layout.wipe');
  commands.bind('#layout-side-by-side', 'compare.layout.sideBySide');
  $('#comparison-split').oninput = event => setSplit(Number(event.target.value) / 100);

  const handle = $('#wipe-handle');
  let wiping = false;
  handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    app.clearHover();
    wiping = true;
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!wiping) return;
    const rect = $('#model-canvas').getBoundingClientRect();
    setSplit((event.clientX - rect.left) / rect.width);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    handle.addEventListener(name, () => {
      wiping = false;
    });
  }
  handle.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setSplit(state.split + (event.key === 'ArrowLeft' ? -0.02 : 0.02));
  });
  // The divider follows the split every frame, like the pre-foundation draw().
  ctx.onFrame(() => {
    $('#wipe-divider').style.left = `${state.layout === 'side-by-side' ? 50 : state.split * 100}%`;
  });

  return {
    api: {
      syncControls, renderModelOptions, setSplit, setLayout, comparePrevious, toggleCompare,
      leaveCompare, loadScene: loader.loadScene, loadSelectedModels: loader.loadSelectedModels,
      activeScenes: loader.activeScenes,
    },
    legacy: {
      harness: { setLayout, loadSelectedModels: loader.loadSelectedModels },
      state: ctx.fields('compare', ['before', 'after', 'compare', 'layout', 'split']),
    },
    defaults: {
      compare: { before: null, after: null, compare: true, layout: 'wipe', split: 0.5 },
    },
  };
}
