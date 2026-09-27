// Inspector column: Inspect / Review tabs and the selection inspector
// (harness: renderInspector; seam: panel). Host owner: help-a11y. Other
// features contribute sections through
// slots.inspector.section({ id, order, when, render, bind }).
//
// Fixed order (spec section 4):
//   selection     heading; sections with order < 30 (exact geometry 20, live
//                 notice 24, measurement 25); identity (properties, the
//                 split/merge note, Comment and Copy reference) at 30;
//                 sections 30..49 (print 35, operation source 40); Browse
//                 geometry at 50; sections >= 50; display warning; reference;
//                 LLM context and print (context-section.js appends them)
//   no selection  heading, model overview (size labelled recorded, kernel or
//                 display), bodies, LLM context
//
// Every render keeps keyboard focus (core/dom.js): changing Browse geometry
// leaves focus on the select; when the focused control is gone (a body row
// after selecting its body) focus moves to the new heading instead of <body>.
import { captureFocus, escape, restoreFocus } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { number, short } from '../../core/format.js';
import {
  geometryAlias, modelLabel, selectedRecords, selectionIdentity, sourceFor,
} from '../../core/scene-records.js';
import { appendGeometryCopy } from './context-section.js';
import { overviewSizeMarkup } from './overview-section.js';

export const id = 'inspector';
export const legacy = true;

export const IDENTITY_ORDER = 30;
export const BROWSE_ORDER = 50;

const COLUMN = '<div class="tabs inspector-tabs" role="tablist" aria-label="Review panel">'
  + '<button id="inspect-tab" role="tab" aria-selected="true" aria-controls="inspect-panel"'
  + ' tabindex="0">Inspect</button><button id="review-tab" role="tab" aria-selected="false"'
  + ' aria-controls="review-panel" tabindex="-1">Review <span id="annotation-count"'
  + ' class="count">0</span></button></div>'
  + '<div id="inspect-panel" class="inspector-panel" role="tabpanel" aria-labelledby="inspect-tab">'
  + '<div id="selection-content" class="selection-content"></div></div>'
  + '<div id="review-panel" class="inspector-panel review-panel" role="tabpanel"'
  + ' aria-labelledby="review-tab" hidden data-slot="inspector.reviewPanel"></div>';
const FOOTER = '<div class="inspector-footer"><span data-icon="shield"></span>'
  + '<span id="revision-hint">Selections stay linked to their model version.</span></div>';

const HEADING = 'id="inspector-heading" tabindex="-1"';
const emptyInspector = (title, text) => '<div class="empty-inspector"><span class="empty-icon">'
  + `${icon('cursor')}</span><h2 ${HEADING}>${title}</h2><p class="muted">${text}</p></div>`;
const SCOPES = {
  semantic: 'Semantic role',
  source: 'Frozen source ID',
  'revision-local': 'This model revision only',
};
const CORRESPONDENCE = '<div class="display-note"><p><strong>Split/merge correspondence is'
  + ' unresolved.</strong> This output has no supported mapping to individual input faces or edges.'
  + ' The operation source and earlier body operations describe construction ancestry. This'
  + ' selection identifies only this saved model revision.</p></div>';
const ACTIONS = '<div class="selection-actions"><button id="comment-selection"'
  + ` class="button primary">${icon('comment')}Comment</button><button id="copy-selection"`
  + ` class="button secondary">${icon('copy')}Copy reference</button></div>`;
const REFERENCE_NOTE = '<p class="small muted inspector-note inspector-note-relaxed">Linked to this'
  + ' saved model version. Copy the reference to include this exact selection in feedback.</p>';

const capitalized = text => text[0].toUpperCase() + text.slice(1);
const entityLabel = kind => (kind === 'vertex' ? 'Point' : capitalized(kind));
const properties = rows => '<dl class="properties">'
  + rows.map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join('')
  + '</dl>';

function browseGeometry(body, reference, type) {
  const groups = [['face', 'faces', 'surfaceType'], ['edge', 'edges', 'curveType'],
    ['vertex', 'vertices', null]];
  const options = groups.map(([kind, key, property]) => {
    const group = kind === 'vertex' ? 'Points' : capitalized(key);
    const items = body[key].map(item => {
      const selected = kind === type && item.index === reference.entityIndex ? 'selected' : '';
      const detail = property ? ` · ${escape(item[property])}` : '';
      return `<option value="${kind}:${item.index}" ${selected}>${entityLabel(kind)}`
        + ` ${item.index + 1}${detail}</option>`;
    }).join('');
    return `<optgroup label="${group}">${items}</optgroup>`;
  }).join('');
  return '<section class="inspector-section"><h3>Browse geometry</h3><select id="inspect-entity"'
    + ' class="text-input" aria-label="Choose a body, face, edge or point"><option value="body:0">'
    + `Body</option>${options}</select></section>`;
}

function displayWarning(scene) {
  const warnings = [...new Set(scene.display?.notes ?? [])];
  if (!warnings.length) return '';
  return '<div class="display-note"><p>Some faces are shown as boundaries only.</p><details>'
    + '<summary>Display details</summary><ul>'
    + `${warnings.map(note => `<li>${escape(note)}</li>`).join('')}</ul></details></div>`;
}

export function overviewMarkup(scene, warning, bounds = null) {
  const faces = scene.bodies.reduce((sum, body) => sum + body.faces.length, 0);
  const bodies = scene.bodies.map(body => `<button class="body-row" data-body="${escape(body.id)}"`
    + ` data-focus-key="body-${escape(body.id)}">${icon('cube')}`
    + `<span>${escape(body.name ?? body.id)}</span></button>`).join('');
  return emptyInspector('Select something to inspect',
    'Click a face, edge or point. Add a comment to keep your feedback connected to it.')
    + '<section class="inspector-section"><h3>Model overview</h3><dl class="properties">'
    + `<dt>Bodies</dt><dd>${scene.bodies.length}</dd><dt>Faces</dt><dd>${faces}</dd>`
    + `${overviewSizeMarkup(scene, bounds)}<dt>Version</dt>`
    + `<dd><code>${escape(short(scene.sha256 ?? scene.id))}</code></dd></dl>`
    + `${warning}</section><section class="inspector-section"><h3>Bodies</h3>`
    + `<div class="body-list">${bodies}</div></section>`;
}

// Overview data from the draw model while the JSON scene is not loaded
// (render-transport): same fields overviewMarkup reads, display bounds.
function summaryScene(summary, label) {
  return {
    id: summary.id, sha256: summary.id, label, bounds: summary.bounds,
    display: {
      toleranceMm: summary.toleranceMm,
      notes: [...new Set(summary.displayWarnings.map(item => item.warning))],
    },
    bodies: summary.bodies.map(body => ({ id: body.id, name: body.name,
      faces: { length: body.faces } })),
  };
}

function selectionRows(scene, body, entity, type, identity) {
  const rows = [['Model', scene.label], ['Body', body.name ?? body.id],
    ['Version', short(scene.sha256 ?? scene.id)]];
  if (type === 'face') {
    rows.push(['Surface', entity.surfaceType], ['Boundary edges', entity.edgeIndices.length]);
  }
  if (type === 'edge') rows.push(['Curve', entity.curveType]);
  if (type === 'vertex') {
    rows.push(['X · mm', number(entity.point[0], 5)], ['Y · mm', number(entity.point[1], 5)],
      ['Z · mm', number(entity.point[2], 5)]);
  }
  if (type === 'body') {
    rows.push(['Faces', body.faces.length], ['Edges', body.edges.length],
      ['Volume · mm³', number(body.volumeMm3)]);
  }
  if (identity?.role) {
    const role = typeof identity.role === 'string' ? identity.role : JSON.stringify(identity.role);
    rows.push(['Role', role]);
  }
  rows.push(['Identity scope', SCOPES[identity?.stability] ?? 'Unattributed']);
  return rows;
}

function referenceMarkup(body, type, reference, identity) {
  const identityLine = identity?.id ? `<br>${escape(identity.id)}` : '';
  return '<section class="inspector-section"><h3>Reference</h3><div class="source-path">'
    + `${escape(body.id)}<br><span class="muted">${escape(type)} · index `
    + `${reference.entityIndex}</span>${identityLine}</div>${REFERENCE_NOTE}</section>`;
}

// Splits contributed sections around the host's identity and browse blocks.
export function sectionBands(sections) {
  const order = section => section.order ?? 50;
  return {
    early: sections.filter(section => order(section) < IDENTITY_ORDER),
    middle: sections.filter(section => order(section) >= IDENTITY_ORDER
      && order(section) < BROWSE_ORDER),
    late: sections.filter(section => order(section) >= BROWSE_ORDER),
  };
}

export function setup(ctx) {
  const { state, app, slots, commands, dom: { $, $$ } } = ctx;
  slots.add('inspector', { id: 'inspector.column', order: 10, html: COLUMN });
  slots.add('inspector', { id: 'inspector.footer', order: 90, html: FOOTER });

  function panel(name) {
    state.panel = name;
    for (const key of ['inspect', 'review']) {
      const tab = $(`#${key}-tab`);
      tab.setAttribute('aria-selected', String(key === name));
      tab.tabIndex = key === name ? 0 : -1;
      $(`#${key}-panel`).hidden = key !== name;
    }
  }

  const sectionsFor = context => slots.list('inspector.section')
    .filter(section => !section.when || section.when(context));

  // Writes the markup, runs the binders, then puts keyboard focus back.
  function commit(content, markup, bind) {
    const snapshot = captureFocus(content);
    content.innerHTML = markup;
    bind();
    if (snapshot && !restoreFocus(content, snapshot)) {
      content.querySelector?.('#inspector-heading')?.focus?.({ preventScroll: true });
    }
  }

  function renderOverview(scene, content, warning) {
    commit(content, overviewMarkup(scene, warning, app.modelBounds?.(scene.id)), () => {
      $$('.body-row').forEach(button => {
        button.onclick = () => app.select({
          modelId: scene.id, bodyId: button.dataset.body, entityType: 'body', entityIndex: 0,
        });
      });
      appendGeometryCopy(ctx, scene);
    });
  }

  function renderInspector() {
    const records = selectedRecords(state.scenes, state.selection);
    const content = $('#selection-content');
    // The JSON scene (identity, source) loads on the first inspection.
    const wanted = state.selection?.modelId;
    if (wanted && !records && !state.scenes.has(wanted) && ctx.cache.model(wanted)) {
      content.innerHTML = emptyInspector('Loading details',
        'Fetching identity and source of this selection…');
      ctx.cache.loadScene(wanted).then(() => app.renderInspector(), error => {
        content.innerHTML = emptyInspector('Details unavailable', escape(error.message));
      });
      return;
    }
    const summary = !records && !state.scenes.has(state.after)
      ? ctx.renderer.summary(state.after) : null;
    const scene = records?.scene ?? state.scenes.get(state.after)
      ?? (summary && summaryScene(summary, modelLabel(state.workspace, state.scenes,
        state.after)));
    if (!scene) {
      commit(content, emptyInspector('Your model, in detail',
        'Open a model to explore its surfaces, edges and points.'), () => {});
      return;
    }
    const warning = displayWarning(scene);
    if (!records) {
      renderOverview(scene, content, warning);
      return;
    }
    const { body, entity } = records;
    const reference = state.selection;
    const type = reference.entityType;
    const label = type === 'body' ? 'Body' : `${entityLabel(type)} ${reference.entityIndex + 1}`;
    const identity = entity.identity ?? (type === 'body' ? body.identity : null);
    const unresolved = identity?.lineage?.matching === 'unsupported-split-merge-correspondence';
    const context = { scene, records, reference, identity };
    const sections = sectionsFor(context);
    const { early, middle, late } = sectionBands(sections);
    const renderAll = list => list.map(section => section.render(context)).join('');
    const entityWarning = entity.displayWarning
      ? `<p class="display-note">${escape(entity.displayWarning)}</p>`
      : warning;
    const markup = '<div class="selection-heading"><span class="selection-symbol">'
      + `${icon(type === 'body' ? 'cube' : type)}</span><div><h2 ${HEADING}>${escape(label)}</h2>`
      + `<p>${escape(scene.label)}</p></div></div>`
      + renderAll(early)
      + '<div class="inspector-identity">'
      + properties(selectionRows(scene, body, entity, type, identity))
      + (unresolved ? CORRESPONDENCE : '') + ACTIONS + '</div>'
      + renderAll(middle)
      + browseGeometry(body, reference, type)
      + renderAll(late)
      + entityWarning
      + referenceMarkup(body, type, reference, identity);
    commit(content, markup, () => {
      $('#copy-selection').onclick = () => ctx.copyText(JSON.stringify({
        ...reference,
        alias: geometryAlias(scene, reference),
        identity: selectionIdentity(identity, body),
        ...(sourceFor(records) ? { source: sourceFor(records) } : {}),
      }, null, 2), 'Selection reference copied');
      $('#comment-selection').onclick = () => app.commentOnSelection();
      $('#inspect-entity').onchange = event => {
        const [entityType, index] = event.target.value.split(':');
        app.select({
          modelId: reference.modelId, bodyId: reference.bodyId, entityType,
          entityIndex: Number(index),
        });
      };
      for (const section of sections) section.bind?.(context);
      appendGeometryCopy(ctx, scene, reference);
    });
  }

  commands.register({
    id: 'inspector.tab.inspect', label: 'Inspect', run: () => app.panel('inspect'),
  });
  commands.register({
    id: 'inspector.tab.review', label: 'Review', run: () => app.panel('review'),
  });
  commands.bind('#inspect-tab', 'inspector.tab.inspect');
  commands.bind('#review-tab', 'inspector.tab.review');
  ctx.keyboard.bindTabList($('.inspector-tabs'));

  return {
    api: { renderInspector, panel },
    legacy: { harness: { renderInspector }, state: ctx.fields('inspector', ['panel']) },
    defaults: { inspector: { panel: 'inspect' } },
  };
}
