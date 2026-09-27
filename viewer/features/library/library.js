// Library column: workspace status, Models / Checks tabs, search, model and
// check lists, refresh. Legacy feature (VS).
//
// Models are grouped per source (model-first-compare): newest revision first
// with rN and time, older revisions folded under "N earlier", archived
// snapshots in their own group. A click on a model from another source
// leaves compare mode and fits; a same-source click keeps the before model
// and the camera (spec 3.4, LIB-03).
//
// library.row slot items ({ id, order, render({ model, entry, group }) })
// add badge markup to model rows; render returns trusted markup or ''.
import { escape, patch, raw } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { reportStatus, short } from '../../core/format.js';
import {
  entryTitle, factsFrom, groupRevisions, indexRevisions, matchesSearch, revisionText, timeTitle,
} from './revisions.js';
import { createWorkspace } from './workspace.js';

export const id = 'library';
export const legacy = true;

const STATUS = '<span class="status-dot"></span>'
  + '<span id="workspace-status">Opening workspace</span>';
const LIST = '<div class="library-heading"><span class="eyebrow">Workspace</span>'
  + '<button id="refresh" class="icon-button" title="Refresh workspace"'
  + ' aria-label="Refresh workspace" data-icon="refresh"></button></div>'
  + '<div class="tabs library-tabs" role="tablist" aria-label="Workspace content"'
  + ' data-slot="library.tab"></div>'
  + '<label class="search-field"><span data-icon="search"></span><input id="library-search"'
  + ' type="search" placeholder="Find a model…" aria-label="Filter workspace items"'
  + ' autocomplete="off"></label>'
  + '<div id="library-content" class="library-content" role="tabpanel"'
  + ' aria-labelledby="models-tab"><p class="muted loading-copy">Loading your models…</p></div>';
// Ids stay literal so they can be searched (docs/viewer/contracts.md).
const MODELS_TAB = '<button id="models-tab" role="tab" aria-selected="true"'
  + ' aria-controls="library-content">Models <span id="model-count" class="count">0</span>'
  + '</button>';
const CHECKS_TAB = '<button id="checks-tab" role="tab" aria-selected="false"'
  + ' aria-controls="library-content">Checks <span id="report-count" class="count">0</span>'
  + '</button>';
const FOOTER = '<div class="library-footer"><span class="small muted">A place to inspect, compare'
  + ' and refine.</span><span class="unit-label">mm</span></div>';

const checkItem = item => `<button class="library-item" data-report="${escape(item.id)}">`
  + `<span class="item-icon">${icon('report')}</span><span class="item-copy">`
  + `<span class="item-title">${escape(item.label)}</span>`
  + `<span class="item-detail">${escape(reportStatus(item).label)}</span></span></button>`;
const bodies = model => (Number.isInteger(model.bodyCount)
  ? `${model.bodyCount} ${model.bodyCount === 1 ? 'body' : 'bodies'}` : '');

export function setup(ctx) {
  const { state, app, slots, commands, dom: { $, $$ } } = ctx;
  slots.header.status({ id: 'library.status', order: 10, html: STATUS });
  slots.library.section({ id: 'library.list', order: 10, html: LIST });
  slots.library.tab({ id: 'models', order: 10, html: MODELS_TAB });
  slots.library.tab({ id: 'checks', order: 20, html: CHECKS_TAB });
  slots.library.section({ id: 'library.footer', order: 90, html: FOOTER });

  const { workspace, startupWorkspace } = createWorkspace(ctx);
  const expanded = new Set();
  let memo = { models: null, facts: null, length: -1, groups: [], index: new Map() };

  function revisions() {
    const { models } = state.workspace;
    const { facts } = ctx.store.get().library;
    if (memo.models !== models || memo.facts !== facts || memo.length !== models.length) {
      const groups = groupRevisions(models, facts);
      memo = { models, facts, length: models.length, groups, index: indexRevisions(groups) };
    }
    return memo;
  }
  const revisionGroups = () => revisions().groups;
  const revisionOf = id => revisions().index.get(id) ?? null;
  // The per-source settings key (scope S): a live source's path or a
  // .brep.json input path. Archived snapshots have none (null): they share
  // one library group but no source.
  const sourceKey = id => {
    const group = revisionOf(id)?.group;
    return group && group.kind !== 'archive' ? group.key : null;
  };
  const previousRevision = id => revisionOf(id)?.previous?.id ?? null;
  const sameSource = (left, right) => {
    const key = sourceKey(left);
    return !!key && key === sourceKey(right);
  };
  // Display texts by model id ("r3 · 14:05", "bracket", "bracket r3").
  const revisionTextOf = id => revisionText(revisionOf(id)?.entry);
  const entryTitleOf = id => {
    const record = revisionOf(id);
    return record ? entryTitle(record.entry, record.group) : '';
  };
  const revisionName = id => {
    const record = revisionOf(id);
    if (!record) return '';
    const tag = record.entry.kind === 'archive' ? 'archived' : `r${record.entry.revision}`;
    return `${entryTitle(record.entry, record.group)} ${tag}`;
  };
  const revisionTimeTitle = id => timeTitle(revisionOf(id)?.entry);
  const setRevisionFacts = response => {
    ctx.store.update('library.facts', current => {
      current.library.facts = response ? factsFrom(response) : null;
    });
  };

  function openModel(modelId) {
    const same = sameSource(modelId, state.after);
    state.after = modelId;
    if (state.compare && !same) state.compare = false;
    if (state.saved) ctx.review.touch('library.model');
    app.loadSelectedModels(!same).catch(ctx.showError);
  }

  function libraryTab(name) {
    state.tab = name;
    // Every registered tab (slots.library.tab), with roving focus.
    const tabs = new Set([$('#models-tab'), $('#checks-tab'),
      ...$$('.library-tabs [role=tab]')]);
    for (const tab of tabs) {
      const selected = tab.id === `${name}-tab`;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    $('#library-content').setAttribute('aria-labelledby', `${name}-tab`);
    $('#library-search').placeholder = name === 'models' ? 'Find a model…' : 'Find a check…';
    $('#library-search').value = '';
    app.renderLibrary();
  }

  const rowBadges = (entry, group) => slots.list('library.row')
    .map(item => item.render?.({ model: entry.model, entry, group }) ?? '').join('');

  function badges(entry, group) {
    const open = entry.id === state.after;
    const before = state.compare && entry.id === state.before && !open;
    return rowBadges(entry, group)
      + (before ? '<span class="item-badge before-badge">Before</span>' : '')
      + (open ? '<span class="item-badge">Open</span>' : '');
  }

  const detail = (entry, withBodies) => [
    `<span class="revision-tag" title="${escape(timeTitle(entry))}">`
      + `${escape(revisionText(entry))}</span>`,
    withBodies && bodies(entry.model) ? `<span>${escape(bodies(entry.model))}</span>` : '',
    `<code>${escape(short(entry.model.sha256 ?? entry.id))}</code>`,
  ].filter(Boolean).join('<span aria-hidden="true">·</span>');

  const selectedClass = entry => [entry.id === state.after ? 'selected' : '',
    state.compare && entry.id === state.before && entry.id !== state.after ? 'before-row' : '']
    .filter(Boolean).join(' ');

  // The newest revision of a source: a full library item.
  const headItem = (entry, group) => `<button class="library-item ${selectedClass(entry)}"`
    + ` data-model="${escape(entry.id)}" data-focus-key="model-${escape(entry.id)}"`
    + ` title="${escape(group.path ?? '')}"><span class="item-icon">${icon('cube')}</span>`
    + `<span class="item-copy"><span class="item-title">${escape(entryTitle(entry, group))}`
    + '</span>'
    + `<span class="item-detail">${detail(entry, true)}</span></span>${badges(entry, group)}`
    + '</button>';
  // An older or archived revision: a compact row.
  const revisionItem = (entry, group) => `<button class="library-item revision-item`
    + ` ${selectedClass(entry)}" data-model="${escape(entry.id)}"`
    + ` data-focus-key="model-${escape(entry.id)}">`
    + `<span class="item-copy">${group.kind === 'archive'
      ? `<span class="item-title">${escape(entryTitle(entry, group))}</span>` : ''}`
    + `<span class="item-detail">${detail(entry, group.kind === 'archive')}</span></span>`
    + `${badges(entry, group)}</button>`;

  function groupMarkup(group, filter) {
    const visible = group.revisions.filter(entry => matchesSearch(entry, group, filter));
    if (!visible.length) return '';
    const archive = group.kind === 'archive';
    const [head, ...rest] = archive ? [null, ...visible] : visible;
    const pinned = entry => entry.id === state.after
      || (state.compare && entry.id === state.before);
    const open = filter || expanded.has(group.key);
    const shown = open ? rest : rest.filter(pinned);
    const hidden = rest.length - shown.length;
    const words = archive ? ['Hide snapshots', `Show ${hidden}`]
      : ['Hide earlier', `${hidden} earlier`];
    const fold = rest.length && (hidden || open) && !filter
      ? `<button class="revision-fold" data-fold="${escape(group.key)}"`
        + ` data-focus-key="fold-${escape(group.key)}" aria-expanded="${open}">`
        + `${open ? words[0] : words[1]}</button>` : '';
    const heading = archive ? '<div class="revision-group-heading"><span class="item-icon">'
      + `${icon('save')}</span><span class="item-title">${escape(group.label)}</span>`
      + `<span class="count">${group.revisions.length}</span></div>` : '';
    return `<section class="revision-group${rest.length ? ' has-revisions' : ''}"`
      + ` data-source="${escape(group.key)}" aria-label="${escape(group.label)}">`
      + heading + (head ? headItem(head, group) : '')
      + (shown.length ? `<div class="revision-list">${shown.map(entry => revisionItem(entry,
        group)).join('')}</div>` : '')
      + fold + '</section>';
  }

  function renderLibrary() {
    const filter = $('#library-search').value.toLowerCase();
    $('#model-count').textContent = state.workspace.models.length;
    $('#report-count').textContent = state.workspace.reports.length;
    const content = $('#library-content');
    let markup;
    if (state.tab === 'models') {
      markup = revisionGroups().map(group => groupMarkup(group, filter)).join('');
    } else {
      const checks = state.workspace.reports
        .filter(item => `${item.label} ${item.id}`.toLowerCase().includes(filter))
        .map(checkItem).join('');
      // Kernel reports come from fixed files under out/ (API-10), not from
      // the open model (spec section 4).
      markup = checks && `<p class="checks-scope">Workspace checks (not specific to this`
        + ` model)</p>${checks}`;
    }
    if (!markup) {
      const empty = filter ? 'No matching items.' : state.tab === 'models'
        ? 'No models are open in this workspace.' : 'No check reports are available yet.';
      patch(content, raw(`<p class="empty-library">${empty}</p>`));
      return;
    }
    patch(content, raw(markup));
    $$('[data-model]').forEach(button => {
      button.onclick = () => openModel(button.dataset.model);
    });
    $$('[data-fold]').forEach(button => {
      button.onclick = () => {
        const key = button.dataset.fold;
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        app.renderLibrary();
      };
    });
    $$('[data-report]').forEach(button => {
      button.onclick = () => app.openReport(button.dataset.report).catch(ctx.showError);
    });
  }

  commands.register({
    id: 'library.refresh', label: 'Refresh workspace',
    run: () => workspace().then(() => ctx.notify('Workspace refreshed')).catch(ctx.showError),
  });
  commands.register({
    id: 'library.retry', label: 'Try again',
    run: () => (state.after ? app.loadSelectedModels(false) : workspace()).catch(ctx.showError),
  });
  commands.register({ id: 'library.tab.models', label: 'Models', run: () => libraryTab('models') });
  commands.register({ id: 'library.tab.checks', label: 'Checks', run: () => libraryTab('checks') });
  commands.bind('#refresh', 'library.refresh');
  commands.bind('#viewport-retry', 'library.retry');
  commands.bind('#models-tab', 'library.tab.models');
  commands.bind('#checks-tab', 'library.tab.checks');
  $('#library-search').oninput = () => app.renderLibrary();
  ctx.keyboard.bindTabList($('.library-tabs'));

  return {
    api: {
      workspace, startupWorkspace, renderLibrary, libraryTab, openModel, setRevisionFacts,
      revisionGroups, revisionOf, sourceKey, previousRevision, sameSource,
      revisionText: revisionTextOf, entryTitle: entryTitleOf, revisionName, revisionTimeTitle,
    },
    legacy: {
      harness: { workspace, startupWorkspace },
      state: ctx.fields('library', ['workspace', 'loading', 'tab']),
    },
    defaults: {
      library: {
        workspace: { models: [], reports: [], feedback: [] }, loading: false, tab: 'models',
        facts: null,
      },
    },
  };
}
