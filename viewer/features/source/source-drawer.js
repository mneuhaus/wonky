// Frozen source snapshot in the drawer (harness: openSource) and the source
// links behavior of the source feature. Owner: source-links (W2).
//
// openSource(source, { focus }) opens the frozen bytes of `source.sha256`.
// It marks the selection's source lines in that document: the primary line
// (sketch entity or operation) as current, the operation context and a
// helper's call site as context; without a selection only `source.span`.
//
// Source to geometry: clicking a line selects the geometry that line
// produced in the model of the selection (else the displayed model), using
// the line index of GET /api/models/:id/history, or says that it produced
// none and why. Lines that produced geometry are marked once the history has
// loaded. Under the legacy seam (VS) no history request is made.
//
// createSourceDrawer(ctx) also installs the editor setting (settings item
// `source.editor`, key `editor`, scope G) for the inspector section.
import { escape } from '../../core/dom.js';
import { modelLabel, selectedRecords, sourceFor } from '../../core/scene-records.js';
import { DEFAULT_EDITOR } from '../../core/editor-links.js';
import {
  EDITOR_LABELS, EDITOR_SETTING, codeLine, editorHref, editorScheme, headlineOf, lineClass,
  sourceLinks, useEditorSetting,
} from './source-section.js';

const RELATION_LABELS = Object.freeze({
  'sketch-entity': 'sketch entity',
  sketch: 'built from this sketch',
  operation: 'created here',
  'boolean-origin': 'Boolean construction origin',
  descendant: 'descendant body (recorded lineage, no face correspondence)',
  call: 'through the helper call',
});
const MAX_ALIASES = 8;
const HISTORY_CACHE = 8;
const SKETCH_CALL = /^(sk[A-Z]|newSketchOnPlane$)/;

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const aliasList = targets => targets.slice(0, MAX_ALIASES).map(target => target.alias).join(', ')
  + (targets.length > MAX_ALIASES ? ` and ${targets.length - MAX_ALIASES} more` : '');

// Why a recorded call at a line produced no geometry (from the history notes).
function noGeometryReason(entry) {
  const notes = entry.notes ?? [];
  const names = entry.operations.map(op => op.name);
  const calls = entry.links.filter(link => link.relation === 'call').map(link => link.via);
  if (notes.some(note => note.kind === 'failed')) return 'the call failed';
  const removed = notes.find(note => note.kind === 'removed-bodies');
  if (removed) return `it removed ${plural(removed.bodies.length, 'body', 'bodies')}`;
  if (notes.some(note => note.kind === 'outputs-not-in-model')) {
    return 'the bodies it created are not in the final model and no recorded lineage leads'
      + ' to one';
  }
  if (names.length && names.every(name => name === 'setProperty')) {
    return 'it sets body properties, not geometry';
  }
  if (names.length && names.every(name => SKETCH_CALL.test(name))) {
    return 'face-level sketch sources are recorded only for line and arc sketch extrusions';
  }
  if (calls.length) return `the helper call (${calls.join(', ')}) made no call that did`;
  return 'no recorded link leads from it to geometry';
}

// Status of a clicked line from its history index entry (pure; tested):
// { text, targets, linked }.
export function lineSummary(entry, line) {
  if (!entry) {
    return {
      linked: false, targets: [],
      text: `Line ${line} has no recorded modeling call, sketch entity or helper call, so it`
        + ' produced no geometry in this revision.',
    };
  }
  const names = [...new Set(entry.operations.map(op => op.name))];
  const calls = [...new Set(entry.links.filter(link => link.relation === 'call')
    .map(link => `call to ${link.via}`))];
  const what = [...names, ...calls].join(', ');
  const head = `Line ${line}${what ? ` (${what})` : ''}`;
  if (!entry.targets.length) {
    return {
      linked: false, targets: [],
      text: `${head} produced no geometry in this revision: ${noGeometryReason(entry)}.`,
    };
  }
  const groups = entry.links.filter(link => link.targets.length).map(link => {
    const via = link.relation === 'call' ? ` ${link.via}` : '';
    return `${RELATION_LABELS[link.relation] ?? link.relation}${via}: ${aliasList(link.targets)}`;
  });
  return {
    linked: true,
    targets: entry.targets,
    text: `${head} produced ${plural(entry.targets.length, 'entity', 'entities')} (recorded): `
      + `${groups.join('; ')}.`,
  };
}

// Selection reference of a history target, in the canonical key order.
export const targetReference = target => ({
  modelId: target.modelId, bodyId: target.bodyId, entityType: target.entityType,
  entityIndex: target.entityIndex,
});

// Lines to mark in document `sha256`: { current, span, context: [line],
// legend: [{ line, kind, text }] }; `span` is the current line's location.
export function sourceMarks(sha256, source, focus) {
  const links = focus?.links;
  const marks = { current: null, span: null, context: [], legend: [] };
  if (links?.primary.sha256 === sha256 && links.primary.span?.line) {
    marks.current = links.primary.span.line;
    marks.span = links.primary.span;
    const head = headlineOf(links);
    const inHelper = links.helper ? ` in ${links.helper.name}` : '';
    marks.legend.push({ line: marks.current, kind: 'current',
      text: `${[head.name, head.detail].filter(Boolean).join(' ')}${inHelper} (selection)` });
    const context = links.context;
    if (context?.sha256 === sha256 && context.span?.line && context.span.line !== marks.current) {
      marks.context.push(context.span.line);
      marks.legend.push({ line: context.span.line, kind: 'context',
        text: `${context.name ?? 'Operation'} (context)` });
    }
    const site = links.helper?.calledAt?.line;
    if (site && site !== marks.current) {
      marks.context.push(site);
      marks.legend.push({ line: site, kind: 'context', text: `call to ${links.helper.name}` });
    }
  }
  const span = source?.span?.start ?? source?.span;
  if (!marks.current && span?.line) {
    marks.current = span.line;
    marks.span = span;
  }
  return marks;
}

export function createSourceDrawer(ctx) {
  const { api, drawer, dom: { $ }, settings, slots, state, app } = ctx;
  const readEditor = () => editorScheme(settings.get('G', 'editor', DEFAULT_EDITOR));
  useEditorSetting(readEditor);
  slots.settings.item(EDITOR_SETTING);
  let editor = readEditor();
  settings.onChange(() => {
    const next = readEditor();
    if (next === editor) return;
    editor = next;
    app.renderInspector?.();
  });

  // History documents per model id (latest HISTORY_CACHE).
  const histories = new Map();
  function history(modelId) {
    if (!histories.has(modelId)) {
      const request = api.json(`/api/models/${modelId}/history`);
      request.catch(() => histories.delete(modelId));
      histories.set(modelId, request);
      while (histories.size > HISTORY_CACHE) histories.delete(histories.keys().next().value);
    }
    return histories.get(modelId);
  }

  function selectionFocus() {
    const records = selectedRecords(state.scenes, state.selection);
    const links = records ? sourceLinks(records, sourceFor(records)) : null;
    return links ? { modelId: state.selection.modelId, links } : null;
  }

  let views = 0;
  let drawerSelection = null;
  let collapsed = false;
  const viewSelector = view => `#report-content [data-source-view="${view.id}"]`;
  const isCurrent = view => !$('#report-drawer').hidden && !!$(viewSelector(view));
  const status = (view, text) => {
    const element = $(`${viewSelector(view)} .source-line-status`);
    if (element) element.textContent = text;
  };
  const labelOf = modelId => modelLabel(state.workspace, state.scenes, modelId);

  const KEYS = ['modelId', 'bodyId', 'entityType', 'entityIndex'];
  function sameSelection(references) {
    const current = state.selectionSet ?? (state.selection ? [state.selection] : []);
    if (!references || current.length !== references.length) return false;
    return current.every((item, index) => KEYS.every(key => item[key] === references[index][key]));
  }

  async function showLine(view, line) {
    const previous = $(`${viewSelector(view)} .source-picked`);
    previous?.classList.remove('source-picked');
    $(`${viewSelector(view)} [data-line="${line}"]`)?.classList.add('source-picked');
    if (ctx.legacy) {
      status(view, 'Source-to-geometry links load from the history API, which this mode does'
        + ' not request.');
      return;
    }
    if (!view.modelId) {
      status(view, 'Open a model to link source lines to its geometry.');
      return;
    }
    let recorded;
    try {
      recorded = (await history(view.modelId)).files.find(file => file.sha256 === view.sha256);
    } catch (error) {
      if (isCurrent(view)) status(view, `Geometry links unavailable: ${error.message}`);
      return;
    }
    if (!isCurrent(view)) return;
    const summary = recorded ? lineSummary(recorded.lines[line], line)
      : { linked: false, targets: [], text: `${labelOf(view.modelId)} was not built from this`
        + ' source file, so its lines produced no geometry there.' };
    if (!summary.linked) {
      // Clear a highlight that an earlier line click made, never the user's own.
      if (sameSelection(drawerSelection)) app.select([], false);
      drawerSelection = null;
      status(view, summary.text);
      return;
    }
    const references = summary.targets.map(targetReference);
    drawerSelection = references;
    app.select(references);
    const shown = [state.after, state.before].includes(view.modelId) ? 'Selected in the viewport.'
      : `Selected in ${labelOf(view.modelId)}, which is not displayed.`;
    status(view, `${summary.text} ${shown}`);
  }

  async function decorate(view) {
    let result;
    try {
      result = await history(view.modelId);
    } catch (error) {
      if (isCurrent(view)) status(view, `Geometry links unavailable: ${error.message}`);
      return;
    }
    if (!isCurrent(view)) return;
    const recorded = result.files.find(file => file.sha256 === view.sha256);
    const label = labelOf(view.modelId);
    if (!recorded) {
      status(view, `${label} was not built from this source file; its lines are not linked`
        + ' to that model.');
      return;
    }
    const linked = Object.values(recorded.lines).filter(entry => entry.targets.length);
    for (const entry of linked) {
      const element = $(`${viewSelector(view)} [data-line="${entry.line}"]`);
      if (!element) continue;
      element.classList.add('source-linked');
      element.setAttribute('tabindex', '0');
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', `Line ${entry.line}: select the geometry it produced`);
    }
    status(view, `${plural(linked.length, 'line')} of this file produced geometry in ${label}`
      + ' (marked). Click a line to select what it produced.');
  }

  function bind(view) {
    const lines = $(`${viewSelector(view)} .source-full`);
    const lineOf = target => Number(target?.closest?.('[data-line]')?.dataset.line) || null;
    lines?.addEventListener('click', event => {
      if (ctx.env.window.getSelection?.()?.toString()) return;
      const line = lineOf(event.target);
      if (line) showLine(view, line);
    });
    lines?.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const line = lineOf(event.target);
      if (!line) return;
      event.preventDefault();
      showLine(view, line);
    });
    // Hide code: the drawer shrinks to its status line so the selected
    // geometry is visible; the choice holds for later openings.
    const toggle = $(`${viewSelector(view)} .source-collapse`);
    toggle?.addEventListener('click', () => {
      collapsed = !collapsed;
      applyCollapsed(view);
    });
    const legend = $(`${viewSelector(view)} .source-legend`);
    legend?.addEventListener('click', event => {
      const line = event.target?.closest?.('[data-scroll-line]')?.dataset.scrollLine;
      if (!line) return;
      $(`${viewSelector(view)} [data-line="${line}"]`)?.scrollIntoView({ block: 'center' });
    });
  }

  function applyCollapsed(view) {
    $(viewSelector(view))?.classList.toggle('source-collapsed', collapsed);
    const toggle = $(`${viewSelector(view)} .source-collapse`);
    if (!toggle) return;
    toggle.textContent = collapsed ? 'Show code' : 'Hide code';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }

  function legendMarkup(marks) {
    if (!marks.legend.length) return '';
    const items = marks.legend.map(item => `<button type="button" class="source-legend-item`
      + ` source-legend-${item.kind}" data-scroll-line="${item.line}">`
      + `<span class="source-mark" aria-hidden="true"></span>Line ${item.line} · `
      + `${escape(item.text)}</button>`).join('');
    return `<div class="source-legend">${items}</div>`;
  }

  function viewMarkup(view, data, marks) {
    const lines = data.text.split('\n')
      .map((line, index) => codeLine(index + 1, line, lineClass(index + 1, marks))).join('');
    const href = editorHref(data.file, marks.span, editor);
    const open = href
      ? `<a class="button secondary source-button source-editor" href="${escape(href)}"`
        + ` data-editor="${editor}">Open in ${EDITOR_LABELS[editor]}</a>`
      : '';
    const intro = ctx.legacy ? 'Click a line to see the geometry it produced.'
      : view.modelId ? `Loading the geometry links of ${labelOf(view.modelId)}…`
        : 'Open a model to link source lines to its geometry.';
    const toggle = '<button type="button" class="button secondary source-button source-collapse"'
      + ` aria-expanded="${!collapsed}">${collapsed ? 'Show code' : 'Hide code'}</button>`;
    const folded = collapsed ? ' source-collapsed' : '';
    return `<div class="source-view${folded}" data-source-view="${view.id}">`
      + `<div class="source-drawer-bar"><p class="small muted">${escape(data.sha256)}</p>`
      + `<div class="source-drawer-actions">${toggle}${open}</div></div>${legendMarkup(marks)}`
      + `<p class="source-line-status" role="status" aria-live="polite">${escape(intro)}</p>`
      + `<pre class="source-excerpt source-full">${lines}</pre></div>`;
  }

  return async function openSource(source, { focus } = {}) {
    const selected = focus === undefined ? selectionFocus() : focus;
    const sha256 = source?.sha256 ?? selected?.links.primary.sha256;
    const data = await drawer.open({
      title: 'Source snapshot', eyebrow: 'Source snapshot',
      load: () => api.json(`/api/source/${sha256}`),
    });
    if (!data) return;
    const marks = sourceMarks(data.sha256, source, selected);
    const view = {
      id: ++views,
      sha256: data.sha256,
      modelId: selected?.modelId ?? state.selection?.modelId ?? state.after ?? null,
    };
    $('#report-drawer .eyebrow').textContent = 'Source snapshot';
    $('#report-title').textContent = data.file.split('/').at(-1);
    $('#report-content').innerHTML = viewMarkup(view, data, marks);
    $('#report-drawer').hidden = false;
    $('#report-content .source-current')?.scrollIntoView({ block: 'center' });
    bind(view);
    if (!ctx.legacy && view.modelId) decorate(view);
  };
}
