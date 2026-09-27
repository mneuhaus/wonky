// Saved reviews: title and notes, save, load (also from #review=<id>), the
// saved list with per-review error rows, copy review, and the copy and export
// actions every other feature reaches through ctx.app (harness: loadReview,
// saveReview, reviewPayload). Package: reviews-context.
//
//   copyContext(kind, options)    POST /api/context: the server archives every
//                                 revision it names first (D7), so the copied
//                                 wonky-inspect commands resolve after it stops
//   exportForPrint(modelId, body) print STL + deviation manifest downloads
//
// The dirty rule (D9) lives in dirty.js; the selection is posted to the
// server by selection-share.js. Neither makes a request under the legacy
// seam (VS).
import { clone, escape } from '../../core/dom.js';
import { formatTolerance } from '../../core/format.js';
import { icon } from '../../core/icons.js';
import { modelLabel } from '../../core/scene-records.js';
import { comparisonLayout } from '../../render/panes.js';
import { createDirty, dirtyPayload } from './dirty.js';
import { createSelectionShare, visibleModels } from './selection-share.js';

export const id = 'reviews';
export const legacy = true;

const ACTIONS = '<span id="save-state" class="save-state"></span><button id="copy-review"'
  + ' class="button secondary" disabled><span data-icon="link"></span><span>Copy review</span>'
  + '</button><button id="save-review" class="button primary"><span data-icon="save"></span>'
  + '<span>Save review</span></button>';
const FIELDS = '<div class="review-fields"><label class="field-label" for="review-title">'
  + 'Review title</label><input id="review-title" class="text-input"'
  + ' placeholder="What needs attention?" maxlength="200">'
  + '<label class="field-label" for="review-notes">Notes</label><textarea'
  + ' id="review-notes" rows="3" placeholder="Describe the change, question or next step…">'
  + '</textarea></div>';
const DETAIL = '<div id="saved-review-detail" class="saved-review-detail" hidden></div>';
const SAVED = '<section class="saved-section"><h2>Saved reviews</h2><div id="saved-reviews"><p'
  + ' class="muted small">Your saved notes will appear here.</p></div></section>';
const EMPTY_SAVED = '<p class="muted small">Your saved notes will appear here.</p>';

// A saved-list row; a review file that cannot be read is an error row.
export function savedRow(entry) {
  if (entry.error) {
    return `<div class="saved-item saved-item-error" role="note" title="${escape(entry.file
      ?? entry.id)}">${icon('report')}<span><strong>${escape(entry.id)}</strong>`
      + `<small>${escape(entry.error)}</small></span></div>`;
  }
  return `<button class="saved-item" data-review="${escape(entry.id)}"`
    + ` title="${escape(entry.title)}">${icon('comment')}<span>${escape(entry.title || entry.id)}`
    + '</span></button>';
}

const COPY_MESSAGES = {
  references: count => (count > 1 ? `${count} references copied` : 'Selection reference copied'),
  geometry: () => 'Selected geometry and source copied',
  overview: () => 'Model overview copied',
  llm: () => 'LLM context copied (visible model and selection)',
};

export function setup(ctx) {
  const { state, app, api, slots, commands, env, dom: { $, $$ } } = ctx;
  slots.header.action({ id: 'reviews.actions', order: 10, html: ACTIONS });
  slots.add('inspector.reviewPanel', { id: 'reviews.fields', order: 10, html: FIELDS });
  slots.add('inspector.reviewPanel', { id: 'reviews.detail', order: 30, html: DETAIL });
  slots.library.section({ id: 'reviews.saved', order: 50, html: SAVED });

  const navigation = ctx.requests.scope('navigation');
  // The dirty payload reads the live state (no clone): it is serialized once
  // per touch and compared as a string.
  const dirty = createDirty(ctx, {
    snapshot: () => dirtyPayload({
      notes: $('#review-notes').value,
      comparison: {
        before: state.before, after: state.after, split: state.split, compare: state.compare,
        layout: state.layout,
      },
      annotations: state.annotations,
    }, $('#review-title').value),
  });
  const share = createSelectionShare(ctx);

  function renderSaveAction() {
    $('#save-review').disabled = !state.after || state.loading || state.saving;
  }

  function renderSaved() {
    const values = state.workspace.feedback ?? [];
    const valid = values.filter(entry => !entry.error).slice(0, 12);
    const failed = values.filter(entry => entry.error);
    $('#saved-reviews').innerHTML = values.length
      ? [...valid, ...failed].map(savedRow).join('')
      : EMPTY_SAVED;
    $$('[data-review]').forEach(button => {
      button.onclick = () => loadReview(button.dataset.review).catch(ctx.showError);
    });
  }

  function savedState(record) {
    state.saved = record;
    dirty.markSaved();
    $('#copy-review').disabled = false;
    $('#saved-review-detail').hidden = false;
    $('#saved-review-detail').innerHTML = `Saved review<br><code>${escape(record.id)}</code><br>`
      + '<span class="muted">Copy this review to share its models, annotations and exact'
      + ` selections.</span><button id="copy-context" class="button secondary saved-review-copy">`
      + `${icon('copy')}Copy LLM context</button>`;
    $('#copy-context').onclick = async () => {
      try {
        const text = await api.text(`/api/feedback/${record.id}/context`,
          { unavailable: 'Review context is unavailable' });
        await ctx.copyText(text, 'Review notes and geometry overview copied');
      } catch (error) {
        ctx.showError(error);
      }
    };
    env.history.replaceState(null, '', `#review=${encodeURIComponent(record.id)}`);
  }

  function reviewPayload() {
    const models = new Set([state.before, state.after]);
    for (const annotation of state.annotations) {
      if (annotation.target) models.add(annotation.target.modelId);
      if (annotation.view) {
        models.add(annotation.view.before);
        models.add(annotation.view.after);
      }
    }
    return {
      title: $('#review-title').value.trim()
        || `${modelLabel(state.workspace, state.scenes, state.after)} review`,
      notes: $('#review-notes').value,
      models: [...models].filter(Boolean),
      comparison: {
        before: state.before, after: state.after, split: state.split, compare: state.compare,
        layout: state.layout,
      },
      camera: clone(state.camera),
      annotations: clone(state.annotations),
    };
  }

  async function saveReview() {
    if (!state.after || state.loading || state.saving) return;
    const request = navigation.current();
    const previousSaved = state.saved;
    state.saving = true;
    app.syncControls();
    try {
      const payload = reviewPayload();
      // D9: the stale check compares the dirty payload (camera excluded), which
      // still covers comparison and layout.
      const snapshot = dirty.key();
      const record = await api.json('/api/feedback', {
        method: 'POST', body: JSON.stringify(payload),
      });
      const current = navigation.isCurrent(request) && snapshot === dirty.key();
      if (current) {
        $('#review-title').value = payload.title;
        savedState(record);
      } else if (state.saved === previousSaved) dirty.touch('reviews.stale-save');
      state.workspace.feedback = [{ ...record, title: payload.title },
        ...state.workspace.feedback.filter(item => item.id !== record.id)];
      app.renderSaved();
      ctx.notify(`${current ? 'Review saved' : 'Earlier review snapshot saved'} · ${record.id}`);
    } finally {
      state.saving = false;
      app.syncControls();
    }
  }

  async function loadReview(reviewId) {
    app.clearHover();
    const request = navigation.next();
    state.loading = true;
    app.syncControls();
    try {
      const record = await api.json(`/api/feedback/${encodeURIComponent(reviewId)}`);
      if (!navigation.isCurrent(request)) return;
      const comparison = record.comparison;
      Object.assign(state, {
        before: comparison.before, after: comparison.after, split: comparison.split,
        compare: comparison.compare !== false, layout: comparisonLayout(comparison.layout),
      });
      state.annotations = clone(record.annotations ?? []).map(annotation => ({
        ...annotation,
        view: annotation.view ?? { ...comparison, compare: comparison.compare !== false },
      }));
      state.activeAnnotation = -1;
      $('#review-title').value = record.title ?? '';
      $('#review-notes').value = record.notes ?? '';
      await app.loadSelectedModels(false, request);
      if (!navigation.isCurrent(request)) return;
      state.camera = clone(record.camera);
      savedState(record);
      app.renderAnnotations();
      app.panel('review');
      app.syncControls();
      app.scheduleDraw();
    } catch (error) {
      if (!navigation.isCurrent(request)) return;
      state.loading = false;
      app.syncControls();
      throw error;
    }
  }

  function copyReview() {
    if (!state.saved) return;
    const { saved } = state;
    const page = `${env.location.origin}${env.location.pathname}`;
    const url = saved.url ?? `${page}#review=${saved.id}`;
    const context = saved.contextUrl ?? `${env.location.origin}/api/feedback/${saved.id}/context`;
    const local = saved.contextFile ? '\nLocal context: ' + saved.contextFile : '';
    ctx.copyText(`Review ${saved.id}\n${url}\nLLM context: ${context}${local}`,
      'Review link and code copied');
  }

  // Copy actions (spec 3.7). The server archives every revision the text
  // names before answering, so its commands resolve after the server stops.
  async function copyContext(kind, { references = state.selectionSet, visible } = {}) {
    const body = {
      kind,
      references: references ?? [],
      visible: visible ?? visibleModels(state),
      previous: kind === 'llm' ? app.previousRevision?.(state.after) ?? null : null,
    };
    // The copy starts now (inside the click) and resolves with the text.
    const request = api.post('/api/context', body);
    const copied = ctx.copyText(request.then(result => result.text),
      COPY_MESSAGES[kind](body.references.length));
    const result = await request;
    await copied;
    return result;
  }

  // Print export (spec 3.6): the manifest first (it meshes and archives the
  // revision, and a capability error stops here), then both downloads.
  function download(href, name) {
    const link = env.document.createElement('a');
    link.href = href;
    link.download = name;
    link.hidden = true;
    env.document.body.append(link);
    link.click();
    link.remove();
  }
  async function exportForPrint(modelId = state.after, body = null) {
    if (!modelId) return null;
    const query = body ? `?body=${encodeURIComponent(body)}` : '';
    const base = `/api/models/${encodeURIComponent(modelId)}/print`;
    const response = await api.fetch(`${base}.json${query}`);
    const manifest = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Export for print: ${manifest.error
        ?? `request failed (${response.status})`}`);
    }
    download(`${base}.stl${query}`, manifest.file.name);
    download(`${base}.json${query}`, manifest.file.name.replace(/\.stl$/, '.print.json'));
    const achieved = manifest.deviation.achievedMm;
    ctx.notify(`Print STL and manifest downloaded · chord deviation ${achieved > 0
      ? `≤ ${formatTolerance(achieved, 4)} mm` : '0 mm (planar facets)'}`);
    return manifest;
  }
  const report = promise => promise.catch(ctx.showError);

  commands.register({
    id: 'reviews.save', label: 'Save review', keys: ['Mod+S'], allowWhileTyping: true,
    run: () => saveReview().catch(ctx.showError),
  });
  commands.register({ id: 'reviews.copy', label: 'Copy review', run: copyReview });
  commands.register({
    id: 'reviews.copyContext', label: 'Copy LLM context',
    enabled: () => !!state.after, run: () => report(copyContext('llm')),
  });
  commands.register({
    id: 'reviews.copyReferences', label: 'Copy references',
    enabled: () => state.selectionSet.length > 0, run: () => report(copyContext('references')),
  });
  commands.register({
    id: 'reviews.exportPrint', label: 'Export for print',
    enabled: () => !!state.after, run: () => report(exportForPrint()),
  });
  // The parts tree (parts-tree package) renders these per body row.
  slots.parts.rowAction({
    id: 'reviews.printBody', order: 50, label: 'Export for print', icon: 'cube',
    run: ({ modelId, bodyId }) => report(exportForPrint(modelId, bodyId)),
  });
  commands.bind('#save-review', 'reviews.save');
  commands.bind('#copy-review', 'reviews.copy');
  $('#review-title').oninput = () => dirty.touch('reviews.title');
  $('#review-notes').oninput = () => dirty.touch('reviews.notes');
  env.window.addEventListener('hashchange', () => {
    const reviewId = new env.URLSearchParams(env.location.hash.slice(1)).get('review');
    if (reviewId && reviewId !== state.saved?.id) loadReview(reviewId).catch(ctx.showError);
  });

  return {
    api: {
      loadReview, saveReview, reviewPayload, renderSaved, renderSaveAction,
      touchReview: dirty.touch, copyContext, exportForPrint,
    },
    dispose: share.dispose,
    legacy: {
      harness: { loadReview, saveReview, reviewPayload },
      state: ctx.fields('reviews', ['dirty', 'saved', 'saving']),
    },
    defaults: { reviews: { dirty: false, saved: null, saving: false } },
  };
}
