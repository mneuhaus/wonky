// Parts tab (spec 3.6, 4, 5, 6; package parts-tree).
//
// A left-column tab next to Models and Checks. It is the default tab when the
// displayed model has two or more bodies or comes from a live source; an
// explicit tab choice is remembered per source (setting S libraryTab) and
// applied on the next start. Once the user picks a tab by hand, the tab is
// not switched automatically again in that page. Each body row shows eye,
// color swatch, name, alias, raw and logical face counts
// (GET /api/models/:id/parts) and the FDM badge slot; a row expands to
// opacity, color override, recorded facts, contributed details and the row
// actions (print export). Below the tree: the revisions of the current source.
//
//   Y         hide the selected bodies (else the hovered body)
//   Shift+Y   show every body of the displayed model(s)
//   I         isolate: only the selected bodies stay visible
//   [ / ]     collapse or show the library / inspector column (columns.js)
//
// Visibility, opacity and color persist per source + body name (scope SB,
// key = body name when unique, else body id). This feature writes only the
// store key display.parts; features/display/display.js composes it into the
// renderer style. Every body is also written to the shared body map, which
// the picker reads (hidden bodies cannot be hovered or picked) and which
// keeps a hidden body hidden across a live revision swap until the new
// revision's own entries are composed.
//
// Workspaces (features/workspace): the workspace tree renders above the
// bodies; an open assembly lists the bodies of every visible member model,
// grouped per model, and every row acts on its own model (data-model-id).
//
// Extension points rendered here:
//   parts.rowBadge   { id, order, render({ modelId, bodyId, part }) -> markup }
//   parts.rowAction  { id, order, label, icon, run({ modelId, bodyId, part }) }
//   parts.rowDetail  { id, order, render({ modelId, bodyId, part }) -> markup,
//                      bind?({ element, modelId, bodyId, part }) }
// Other features call app.renderParts() when their badges or details change.
import { escape, patch, raw } from '../../core/dom.js';
import { resolveBodyStyle } from '../../render/style.js';
import { createColumns } from './columns.js';
import {
  hexToRgb, isHex, matchesPart, percent, revisionsMarkup, rgbToHex, rowMarkup, summaryText,
} from './parts-row.js';

export const id = 'parts';
export const legacy = false;

export const LIBRARY_TABS = Object.freeze(['parts', 'models', 'checks']);
export const OPACITY_MIN = 0.1;
const REVISION_LIMIT = 8;
const DOCUMENT_LIMIT = 16;

const TAB = '<button id="parts-tab" role="tab" aria-selected="false" aria-controls="parts-panel"'
  + ' data-focus-key="parts-tab">Parts <span id="parts-count" class="count">–</span></button>';
const PANEL = '<div id="parts-panel" class="parts-panel" role="tabpanel"'
  + ' aria-labelledby="parts-tab" hidden><p class="muted loading-copy">No model open.</p></div>';

// ---- Pure logic (tested in test/viewer-parts-tree.test.mjs) ----

// The library tab for a source: an explicit stored choice, else Parts when
// the model has two or more bodies or comes from a live source, else Models.
export function defaultLibraryTab({ bodyCount = 0, live = false, stored = null } = {}) {
  if (LIBRARY_TABS.includes(stored)) return stored;
  return bodyCount >= 2 || live ? 'parts' : 'models';
}

const nameOf = body => (typeof body.name === 'string' && body.name.length ? body.name : null);

// SB settings keys (same rule as src/viewer/parts.mjs settingsKeys): the body
// name when present and unique in the model, else the body id.
export function settingsKeysOf(bodies) {
  const names = new Map();
  for (const body of bodies) {
    const name = nameOf(body);
    if (name) names.set(name, (names.get(name) ?? 0) + 1);
  }
  return bodies.map(body => {
    const name = nameOf(body);
    return name && names.get(name) === 1 ? name : body.id;
  });
}

// Normalized body settings from a reader name -> stored value.
export function bodySettings(read) {
  const opacity = Number(read('opacity'));
  const color = read('color');
  return {
    visible: read('visible') !== false,
    opacity: Number.isFinite(opacity) && opacity >= OPACITY_MIN && opacity < 1 ? opacity : null,
    color: isHex(color) ? color.toLowerCase() : null,
  };
}

// display.parts from the displayed models, the first one (the "after"
// model) winning in the shared body map:
//   models: [{ modelId, source, bodies: [{ id, key }] }]
//   settingsOf(source, key) -> { visible, opacity, color }
//   preview: { [modelId]: { [bodyId]: { opacity?, color? } } } (while dragging)
export function composePartsStyle(models, settingsOf, preview = {}) {
  const shared = {};
  const perModel = {};
  for (const model of [...models].reverse()) {
    const bodies = {};
    for (const body of model.bodies) {
      const stored = settingsOf(model.source, body.key);
      const draft = preview[model.modelId]?.[body.id] ?? {};
      const entry = { visible: stored.visible };
      const opacity = draft.opacity ?? stored.opacity;
      if (Number.isFinite(opacity) && opacity < 1) entry.opacity = opacity;
      const color = hexToRgb(draft.color ?? stored.color);
      if (color) entry.color = color;
      bodies[body.id] = entry;
      shared[body.id] = entry;
    }
    perModel[model.modelId] = { bodies };
  }
  return { bodies: shared, models: perModel };
}

// Visibility changes of one source's bodies for an action:
//   parts: [{ id, key, visible }], selected: Set of ids
//   action: hide | show-all | isolate | toggle
// Returns [{ key, id, visible }] for the bodies that change.
export function visibilityPlan(action, parts, selected = new Set()) {
  const want = part => {
    if (action === 'hide') return selected.has(part.id) ? false : part.visible;
    if (action === 'show-all') return true;
    if (action === 'isolate') return selected.has(part.id);
    if (action === 'toggle') return selected.has(part.id) ? !part.visible : part.visible;
    throw new Error(`Unknown visibility action ${action}`);
  };
  return parts.flatMap(part => {
    const visible = want(part);
    return visible === part.visible ? [] : [{ key: part.key, id: part.id, visible }];
  });
}

// The latest live attempt of a source when it is not a listed revision:
// { revision, status: building | failed | cancelled, text, failure } or null.
export function liveAttemptLine(source) {
  const attempt = source?.attempt;
  if (!attempt || attempt.status === 'ok' || !Number.isInteger(attempt.revision)) return null;
  if (attempt.status === 'failed') {
    const location = source.failure?.error?.location;
    const file = String(location?.file ?? '').split(/[/\\]/).at(-1);
    const at = file && Number.isInteger(location?.line) ? ` at ${file}:${location.line}` : '';
    const kind = source.failure?.kind ? `${source.failure.kind} error` : 'build failed';
    return {
      revision: attempt.revision, status: 'failed', text: `fails · ${kind}${at}`, failure: true,
    };
  }
  if (attempt.status === 'cancelled') {
    return { revision: attempt.revision, status: 'cancelled', text: 'cancelled', failure: false };
  }
  return {
    revision: attempt.revision, status: 'building',
    text: attempt.phase ? `building · ${attempt.phase}` : 'building', failure: false,
  };
}

// ---- Feature ----

export function setup(ctx) {
  const { state, store, app, api, settings, slots, commands, renderer } = ctx;
  const { $ } = ctx.dom;
  slots.library.tab({ id: 'parts', order: 5, html: TAB });
  slots.library.section({ id: 'parts.panel', order: 15, html: PANEL });
  const columns = createColumns(ctx);

  const documents = new Map();
  const expanded = new Set();
  const pending = new Map();
  const preview = {};
  let active = false;
  let manual = false;
  let autoSource;
  let showAllRevisions = false;
  let writes = Promise.resolve();
  let composed = '';
  let rendered = '';

  // ---- Model data ----
  const sourceOf = modelId => (modelId ? app.sourceKey?.(modelId) || modelId : null);
  const members = () => (state.compare ? [] : app.workspaceMembers?.() ?? []);
  const displayed = () => [...new Set([state.after, state.compare ? state.before : null,
    store.get().display.ghost?.modelId ?? null, ...members().map(member => member.modelId)])]
    .filter(Boolean);
  const documentOf = modelId => documents.get(modelId)?.document ?? null;

  function loadDocument(modelId) {
    if (!modelId || ctx.legacy || documents.has(modelId)) return;
    const entry = { status: 'loading', document: null, error: null };
    documents.set(modelId, entry);
    const keep = new Set(displayed());
    for (const key of [...documents.keys()]) {
      if (documents.size <= DOCUMENT_LIMIT) break;
      if (!keep.has(key)) documents.delete(key);
    }
    api.json(`/api/models/${encodeURIComponent(modelId)}/parts`).then(document => {
      if (!Array.isArray(document?.bodies)) {
        Object.assign(entry, { status: 'error', error: 'Parts response has no bodies' });
        return;
      }
      Object.assign(entry, { status: 'ready', document });
    }, error => {
      Object.assign(entry, { status: 'error', error: error.message });
    }).finally(() => {
      if (documents.get(modelId) !== entry) return;
      render();
      if (modelId === state.after) applyDefaultTab();
    });
  }

  // Bodies of a model with their settings key: from the parts document, else
  // from the draw model or JSON scene (so styles apply before it arrives).
  function bodiesOf(modelId) {
    const document = documentOf(modelId);
    if (document) return document.bodies.map(part => ({ id: part.id, key: part.settingsKey }));
    const bodies = renderer.model?.(modelId)?.bodies ?? state.scenes.get(modelId)?.bodies ?? [];
    const keys = settingsKeysOf(bodies);
    return bodies.map((body, index) => ({ id: body.id, key: keys[index] }));
  }
  const keyOf = (modelId, bodyId) => bodiesOf(modelId).find(body => body.id === bodyId)?.key
    ?? bodyId;

  // Settings with the not yet written values of this feature on top.
  const slot = (source, key, name) => `${source}\u0000${key}\u0000${name}`;
  const settingsOf = (source, key) => bodySettings(name => {
    const waiting = pending.get(slot(source, key, name));
    if (waiting) return waiting.value ?? undefined;
    return settings.get('SB', name, undefined, { source, body: key });
  });

  // Writes are serialized, so every settings response carries all earlier
  // patches; the pending map shows the new value at once.
  function writeBody(source, key, name, value) {
    const id = slot(source, key, name);
    const waiting = { value };
    pending.set(id, waiting);
    writes = writes.then(() => settings.set('SB', name, value, { source, body: key }))
      .catch(error => ctx.notify?.(`Parts setting not saved: ${error.message}`))
      .finally(() => {
        if (pending.get(id) === waiting) pending.delete(id);
      });
    return writes;
  }

  function compose() {
    const models = displayed().map(modelId => ({
      modelId, source: sourceOf(modelId), bodies: bodiesOf(modelId),
    }));
    const next = composePartsStyle(models, settingsOf, preview);
    const key = JSON.stringify(next);
    if (key === composed) return;
    composed = key;
    store.update('display.parts', current => {
      current.display.parts = next;
    });
  }

  // Style of a part as the renderer resolves it, without x-ray (the row
  // shows the body's own opacity).
  function styleOf(modelId, part) {
    const { bodies, models } = store.get().display.parts;
    const resolved = resolveBodyStyle({ xray: false, bodies, models }, modelId,
      { id: part.id, appearance: part.appearance, index: part.index }, part.index);
    const own = models[modelId]?.bodies?.[part.id];
    return {
      visible: own ? own.visible !== false : resolved.visible,
      opacity: own?.opacity ?? (resolved.visible ? resolved.opacity : 1),
      hex: rgbToHex(resolved.color),
      colorSource: resolved.colorSource,
    };
  }

  // ---- Visibility actions ----
  const bodyReference = (modelId, bodyId) => ({
    modelId, bodyId, entityType: 'body', entityIndex: 0,
  });

  function selectedBodies() {
    const references = state.selectionSet?.length ? state.selectionSet
      : state.selection ? [state.selection] : [];
    const shown = displayed();
    const byModel = new Map();
    for (const reference of references) {
      if (!shown.includes(reference.modelId)) continue;
      if (!byModel.has(reference.modelId)) byModel.set(reference.modelId, new Set());
      byModel.get(reference.modelId).add(reference.bodyId);
    }
    return byModel;
  }

  // Applies an action per source (models of one source share their
  // settings); returns the number of changed bodies.
  function applyVisibility(action, byModel) {
    const groups = new Map();
    for (const [modelId, selected] of byModel) {
      const source = sourceOf(modelId);
      if (!groups.has(source)) groups.set(source, { parts: new Map(), selected: new Set() });
      const group = groups.get(source);
      for (const body of bodiesOf(modelId)) {
        if (!group.parts.has(body.key)) {
          group.parts.set(body.key, {
            id: body.key, key: body.key, visible: settingsOf(source, body.key).visible,
          });
        }
        if (selected.has(body.id)) group.selected.add(body.key);
      }
    }
    let changes = 0;
    for (const [source, group] of groups) {
      for (const change of visibilityPlan(action, [...group.parts.values()], group.selected)) {
        writeBody(source, change.key, 'visible', change.visible ? null : false);
        changes++;
      }
    }
    if (!changes) return 0;
    compose();
    dropHiddenSelection();
    render();
    return changes;
  }

  // Hidden bodies leave the selection and the hover.
  function dropHiddenSelection() {
    const hidden = reference => !!reference && !settingsOf(sourceOf(reference.modelId),
      keyOf(reference.modelId, reference.bodyId)).visible;
    if (hidden(state.hover)) app.clearHover?.();
    const selection = state.selectionSet ?? [];
    const kept = selection.filter(reference => !hidden(reference));
    if (kept.length !== selection.length) app.select?.(kept, false);
  }

  const bodies = count => `${count} ${count === 1 ? 'body' : 'bodies'}`;
  function hideSelected() {
    let byModel = selectedBodies();
    if (!byModel.size && state.hover && displayed().includes(state.hover.modelId)) {
      byModel = new Map([[state.hover.modelId, new Set([state.hover.bodyId])]]);
    }
    if (!byModel.size) {
      ctx.notify?.('Select a face, edge or body to hide its body (Y)');
      return;
    }
    const count = applyVisibility('hide', byModel);
    if (count) ctx.notify?.(`${bodies(count)} hidden · Shift+Y shows all`);
  }
  function showAll() {
    const count = applyVisibility('show-all', new Map(displayed()
      .map(modelId => [modelId, new Set()])));
    ctx.notify?.(count ? `${bodies(count)} shown again` : 'All bodies are visible');
  }
  function isolate() {
    const byModel = selectedBodies();
    if (!byModel.size) {
      ctx.notify?.('Select a face, edge or body to isolate its body (I)');
      return;
    }
    const count = [...byModel.values()].reduce((total, set) => total + set.size, 0);
    for (const modelId of displayed()) if (!byModel.has(modelId)) byModel.set(modelId, new Set());
    applyVisibility('isolate', byModel);
    ctx.notify?.(`Isolated ${bodies(count)} · Shift+Y shows all`);
  }
  const toggleBody = (modelId, bodyId) => applyVisibility('toggle',
    new Map([[modelId, new Set([bodyId])]]));

  // ---- Library tab ----
  const isLive = modelId => app.revisionOf?.(modelId)?.group?.kind === 'live'
    || !!app.liveRevision?.(modelId);

  function setActive(next) {
    active = next;
    const library = $('.library');
    if (next) library?.setAttribute?.('data-library-view', 'parts');
    else library?.removeAttribute?.('data-library-view');
    $('#parts-tab')?.setAttribute('aria-selected', String(next));
    const panel = $('#parts-panel');
    if (panel) panel.hidden = !next;
    if (next) {
      $('#models-tab')?.setAttribute('aria-selected', 'false');
      $('#checks-tab')?.setAttribute('aria-selected', 'false');
      const search = $('#library-search');
      if (search) search.placeholder = 'Find a part…';
    }
    render();
  }

  function showParts() {
    if (active) return;
    const search = $('#library-search');
    if (search?.value) {
      search.value = '';
      app.renderLibrary?.();
    }
    setActive(true);
  }

  // A tab picked by hand: remembered for the source (scope S) and never
  // overridden automatically in this page.
  function choose(tab) {
    manual = true;
    const source = sourceOf(state.after);
    if (source && !ctx.legacy) settings.set('S', 'libraryTab', tab, { source });
    if (tab === 'parts') showParts();
    else if (active) setActive(false);
  }

  // The default rule (stored choice, else two or more bodies or live). Runs
  // until the user picks a tab; re-runs when parts, facts or settings arrive.
  function applyDefaultTab() {
    if (manual) return;
    const modelId = state.after;
    const source = sourceOf(modelId);
    if (!source || !settings.loaded()) return;
    const stored = settings.get('S', 'libraryTab', null, { source });
    const bodyCount = documentOf(modelId)?.bodies.length
      ?? renderer.model?.(modelId)?.bodies.length ?? 0;
    const tab = defaultLibraryTab({ bodyCount, live: isLive(modelId), stored });
    const changedSource = autoSource !== source;
    autoSource = source;
    if (tab === 'parts') {
      showParts();
      return;
    }
    if (!changedSource) return;
    if (active) setActive(false);
    if (state.tab !== tab) app.libraryTab?.(tab);
  }

  // ---- Rendering ----
  const filterText = () => (active ? $('#library-search')?.value?.trim() ?? '' : '');
  const selectedIds = modelId => new Set((state.selectionSet ?? [])
    .filter(reference => reference.modelId === modelId).map(reference => reference.bodyId));

  function rowOf(modelId, part, selected) {
    const context = { modelId, bodyId: part.id, part };
    const open = expanded.has(`${sourceOf(modelId)}\u0000${part.settingsKey}`);
    return {
      part,
      style: styleOf(modelId, part),
      selected: selected.has(part.id),
      expanded: open,
      badges: slots.list('parts.rowBadge').map(item => item.render?.(context) ?? '').join(''),
      details: open ? slots.list('parts.rowDetail').map(item => item.render?.(context) ?? '')
        .join('') : '',
      actions: slots.list('parts.rowAction').filter(item => typeof item.run === 'function'),
    };
  }

  function revisionsSection() {
    const group = app.revisionOf?.(state.after)?.group;
    if (!group || group.kind === 'archive') return '';
    const entries = group.revisions.map(entry => ({
      id: entry.id,
      text: app.revisionText?.(entry.id) || 'revision',
      title: app.revisionTimeTitle?.(entry.id) ?? '',
      open: entry.id === state.after,
      before: state.compare && entry.id === state.before && entry.id !== state.after,
    }));
    const liveSource = group.kind === 'live'
      ? (app.liveStatus?.().sources ?? []).find(source => source.path === group.path) : null;
    let live = liveAttemptLine(liveSource);
    if (live && group.revisions.some(entry => entry.revision === live.revision)) live = null;
    return revisionsMarkup({
      label: group.path ?? group.label, entries, live, limit: REVISION_LIMIT,
      showAll: showAllRevisions,
    });
  }

  // inGroup: one member of an open assembly (the other members may still
  // be drawn, so a fully hidden member does not claim an empty viewport).
  function listMarkup(modelId, { inGroup = false } = {}) {
    if (!modelId) return '<p class="empty-library">No model open.</p>';
    const entry = documents.get(modelId);
    if (!entry || entry.status === 'loading') {
      return '<p class="muted loading-copy">Loading parts…</p>';
    }
    if (entry.status === 'error') {
      return `<p class="parts-error" role="alert">Parts unavailable: ${escape(entry.error)}</p>`;
    }
    const { document } = entry;
    const selected = selectedIds(modelId);
    const text = filterText();
    const rows = document.bodies.map(part => rowOf(modelId, part, selected));
    const hidden = rows.filter(row => !row.style.visible).length;
    const shown = rows.filter(row => matchesPart(row.part, text));
    const list = shown.length
      ? `<ul class="parts-list" aria-label="Bodies">${shown.map(rowMarkup).join('')}</ul>`
      : `<p class="empty-library">${text ? 'No matching parts.' : 'This model has no bodies.'}</p>`;
    const note = !inGroup && rows.length && hidden === rows.length
      ? '<p class="parts-note">Every body is hidden; the viewport is empty.</p>' : '';
    return '<div class="parts-summary">'
      + `<span>${escape(summaryText(document, hidden))}</span>`
      + (hidden ? '<button class="part-link" type="button" data-parts-show-all>Show all'
        + ' <kbd>Shift+Y</kbd></button>' : '')
      + `</div>${note}${list}`;
  }

  // The body lists of an open assembly: one group per visible member model.
  function groupsMarkup(list) {
    if (!list.length) {
      return '<p class="parts-note">No instance is shown; the viewport is empty.</p>';
    }
    const tree = app.workspaceTree?.();
    const parts = list.flatMap(member => (documentOf(member.modelId)?.bodies ?? [])
      .map(part => styleOf(member.modelId, part)));
    const note = parts.length && parts.every(style => !style.visible)
      ? '<p class="parts-note">Every body is hidden; the viewport is empty.</p>' : '';
    return note + list.map(member => {
      const label = tree?.models?.find(model => model.key === member.key)?.label ?? member.key;
      const open = member.modelId === state.after;
      return `<section class="parts-group${open ? ' is-active' : ''}"`
        + ` data-model-id="${escape(member.modelId)}" aria-label="${escape(label)}">`
        + `<h3 class="parts-heading parts-group-heading"><span>${escape(label)}</span>`
        + (open ? '<span class="item-badge">Active</span>' : '')
        + `</h3>${listMarkup(member.modelId, { inGroup: true })}</section>`;
    }).join('');
  }

  // Every render composes first: assembly members come and go without a store
  // change (a node switch, a member's first good revision, instance
  // visibility), and a row read from a stale display.parts showed the shared
  // entry of another model's body instead of its own (fix round 3).
  function render() {
    const modelId = state.after;
    const group = members();
    // Every listed model has its parts document requested, else its group and
    // the count wait forever (fix round 2).
    for (const member of group) loadDocument(member.modelId);
    compose();
    // An assembly lists its members, none when every instance is hidden.
    const assembly = app.workspaceNode?.()?.kind === 'assembly' && !state.compare;
    const count = assembly ? group.reduce((total, member) => total
      + (documentOf(member.modelId)?.bodies.length ?? 0), 0)
      : documentOf(modelId)?.bodies.length;
    const counter = $('#parts-count');
    if (counter) counter.textContent = Number.isInteger(count) ? String(count) : '–';
    const panel = $('#parts-panel');
    if (!panel || !active) return;
    // Unchanged markup is not patched (live status ticks, selection noise).
    const markup = (app.workspaceTreeMarkup?.() ?? '')
      + (assembly ? groupsMarkup(group) : listMarkup(modelId) + revisionsSection());
    if (markup === rendered && panel.innerHTML) return;
    rendered = markup;
    patch(panel, raw(markup));
    const binders = slots.list('parts.rowDetail').filter(item => typeof item.bind === 'function');
    if (!binders.length) return;
    for (const row of panel.querySelectorAll?.('.part-row.is-expanded') ?? []) {
      const rowModel = modelOfElement(row);
      const part = documentOf(rowModel)?.bodies.find(body => body.id === row.dataset.bodyId);
      if (!part) continue;
      for (const item of binders) {
        item.bind({ element: row, modelId: rowModel, bodyId: part.id, part });
      }
    }
  }

  // ---- Panel events (delegated; the panel is re-rendered by patch) ----
  // The model a row belongs to: its assembly group, else the displayed model.
  const modelOfElement = element => element?.closest?.('[data-model-id]')?.dataset?.modelId
    ?? state.after;
  const partByAlias = (alias, modelId = state.after) => documentOf(modelId)?.bodies
    .find(part => part.alias === alias) ?? null;

  function onClick(event) {
    const target = event.target?.closest?.('button');
    if (!target) return;
    const data = target.dataset;
    const modelId = modelOfElement(target);
    const part = partByAlias(data.partEye ?? data.partSelect ?? data.partExpand
      ?? data.partColorReset ?? data.part, modelId);
    if (data.partEye && part) toggleBody(modelId, part.id);
    else if (data.partSelect && part) {
      const reference = bodyReference(modelId, part.id);
      if (event.shiftKey || event.metaKey || event.ctrlKey) app.toggleSelection?.(reference);
      else app.select?.(reference);
    } else if (data.partExpand && part) {
      const key = `${sourceOf(modelId)}\u0000${part.settingsKey}`;
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      render();
    } else if (data.partColorReset && part) {
      if (preview[modelId]?.[part.id]) delete preview[modelId][part.id].color;
      writeBody(sourceOf(modelId), part.settingsKey, 'color', null);
      render();
    } else if (data.partAction && part) {
      const action = slots.list('parts.rowAction').find(item => item.id === data.partAction);
      action?.run({ modelId, bodyId: part.id, part });
    } else if (data.partRevision !== undefined) {
      if (data.partRevision !== state.after) app.openModel?.(data.partRevision);
    } else if (data.partsShowAll !== undefined) {
      showAll();
    } else if (data.partsRevisionsFold !== undefined) {
      showAllRevisions = !showAllRevisions;
      render();
    } else if (data.partsLiveDetails !== undefined) {
      commands.run('live.details');
    }
  }

  // Opacity and color: preview while dragging, persist on change.
  function onInput(event, persist) {
    const target = event.target;
    const data = target?.dataset ?? {};
    const modelId = modelOfElement(target);
    const part = partByAlias(data.partOpacity ?? data.partColor, modelId);
    if (!part) return;
    const source = sourceOf(modelId);
    const draft = ((preview[modelId] ??= {})[part.id] ??= {});
    if (data.partOpacity) {
      const opacity = Math.min(1, Math.max(OPACITY_MIN, Number(target.value) / 100));
      draft.opacity = opacity;
      const output = $('#parts-panel')?.querySelector?.(
        `[data-part-opacity-value="${part.alias}"]`);
      if (output) output.textContent = percent(opacity);
      if (persist) writeBody(source, part.settingsKey, 'opacity', opacity < 1 ? opacity : null);
    } else {
      if (!isHex(target.value)) return;
      draft.color = target.value.toLowerCase();
      if (persist) writeBody(source, part.settingsKey, 'color', draft.color);
    }
    if (persist) delete preview[modelId][part.id];
    compose();
    if (persist) render();
  }

  let hovered = null;
  function onHover(event) {
    const row = event.target?.closest?.('.part-row');
    const bodyId = row?.dataset?.bodyId ?? null;
    const modelId = modelOfElement(row);
    const next = bodyId === null ? null : `${modelId}:${bodyId}`;
    if (next === hovered) return;
    hovered = next;
    const visible = bodyId && modelId
      && settingsOf(sourceOf(modelId), keyOf(modelId, bodyId)).visible;
    if (visible) app.setHover?.(bodyReference(modelId, bodyId), 'after');
    else app.clearHover?.();
  }
  function onLeave() {
    if (hovered === null) return;
    hovered = null;
    app.clearHover?.();
  }

  const panel = $('#parts-panel');
  panel?.addEventListener?.('click', onClick);
  panel?.addEventListener?.('input', event => onInput(event, false));
  panel?.addEventListener?.('change', event => onInput(event, true));
  panel?.addEventListener?.('mouseover', onHover);
  panel?.addEventListener?.('mouseleave', onLeave);
  $('#library-search')?.addEventListener?.('input', () => {
    if (active) render();
  });
  // Models / Checks clicks: the library switches its list (its own handler);
  // this feature leaves the Parts view and remembers the choice.
  $('#models-tab')?.addEventListener?.('click', () => choose('models'));
  $('#checks-tab')?.addEventListener?.('click', () => choose('checks'));

  // ---- Commands ----
  commands.register({ id: 'parts.tab', label: 'Parts', run: () => choose('parts') });
  commands.bind('#parts-tab', 'parts.tab');
  commands.register({
    id: 'parts.hide', label: 'Hide selected bodies', keys: ['Y'], run: hideSelected,
  });
  commands.register({
    id: 'parts.showAll', label: 'Show all bodies', keys: ['Shift+Y'], run: showAll,
  });
  commands.register({
    id: 'parts.isolate', label: 'Isolate selected bodies', keys: ['I'], run: isolate,
  });

  // ---- Reactions ----
  function onDisplayed() {
    for (const modelId of displayed()) loadDocument(modelId);
    render();
    applyDefaultTab();
  }
  const stops = [
    store.select(current => current.compare?.after ?? null, onDisplayed),
    store.select(current => `${current.compare?.compare}|${current.compare?.before}|`
      + `${current.display.ghost?.modelId ?? ''}`, onDisplayed),
    store.select(current => current.library?.workspace?.models, () => render()),
    store.select(current => current.library?.facts, () => {
      render();
      applyDefaultTab();
    }),
    store.select(current => current.selection?.selectionSet, () => render()),
    store.select(current => current.live?.trust, () => {
      render();
      applyDefaultTab();
    }),
    settings.onChange(() => {
      render();
      applyDefaultTab();
    }),
  ];
  // Bodies known only from the draw model (before the parts document)
  // are composed, and their rows rendered, as soon as the model is drawn.
  let drawn = '';
  ctx.onFrame(() => {
    const key = displayed().map(modelId => `${modelId}:`
      + `${renderer.model?.(modelId)?.bodies.length ?? 0}:${documents.get(modelId)?.status}`)
      .join('|');
    if (key === drawn) return;
    drawn = key;
    render();
  });

  return {
    api: {
      renderParts: render,
      partsDocument: modelId => documentOf(modelId ?? state.after),
      // Debug and QA handle: tab, columns, composed style and resolved rows.
      partsState: () => ({
        active, manual, modelId: state.after, columns: columns.state(),
        style: store.get().display.parts,
        rows: (documentOf(state.after)?.bodies ?? []).map(part => ({
          alias: part.alias, id: part.id, key: part.settingsKey, label: part.label,
          ...styleOf(state.after, part),
        })),
      }),
      showPartsTab: () => choose('parts'),
      setBodyVisible(bodyId, visible, modelId = state.after) {
        const source = sourceOf(modelId);
        if (settingsOf(source, keyOf(modelId, bodyId)).visible === visible) return 0;
        return toggleBody(modelId, bodyId);
      },
      toggleColumn: column => columns.toggle(column),
    },
    defaults: {
      'display.parts': { bodies: {}, models: {} },
    },
    dispose() {
      for (const stop of stops) stop?.();
      columns.dispose();
    },
  };
}
