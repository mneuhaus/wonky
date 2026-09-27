// Workspace loading (harness: workspace, startupWorkspace). Owner:
// model-first-compare.
//
// Model-first (spec D10): the store's initial value stays compare: true (VS
// fixtures rely on it); startupWorkspace() applies the persisted compare
// mode of the opened model's source (settings scope S, default off) at the
// place where the pre-foundation viewer turned compare off for a single
// model. A loaded review restores its own mode afterwards. Refresh keeps the
// current mode.
import { comparisonLayout } from '../../render/panes.js';

export function createWorkspace(ctx) {
  const { state, app, api, dom: { $ }, env, settings } = ctx;
  const navigation = ctx.requests.scope('navigation');

  // Revision facts (times, archive detection, live revision numbers). Kept
  // off the legacy path; a failure falls back to the local grouping.
  async function loadRevisionFacts() {
    if (ctx.legacy) return null;
    try {
      return await api.json('/api/compare/revisions');
    } catch (error) {
      console.warn('Revision facts unavailable:', error.message);
      return null;
    }
  }

  const settingsReady = () => (ctx.legacy || settings.loaded() ? null : settings.load());

  // The first model: the one the live feature restores for this tab (the
  // source it showed before a reload), else the newest revision of the first
  // source group.
  function defaultAfter() {
    const preferred = app.preferredAfter?.(state.workspace.models);
    if (preferred) return preferred;
    const groups = app.revisionGroups();
    const group = groups.find(value => value.kind !== 'archive') ?? groups[0];
    return group.revisions[0].id;
  }

  // Persisted per-source compare mode. On: compare against the explicitly
  // chosen before model if it still exists, else the previous revision of
  // the same source; nothing to compare against keeps compare off for this
  // start (the setting itself is unchanged).
  function applyStartupMode(ids) {
    const source = app.sourceKey(state.after);
    const where = { source };
    state.layout = comparisonLayout(settings.get('G', 'compareLayout', 'wipe'));
    const split = Number(settings.get('G', 'compareSplit', 0.5));
    state.split = Number.isFinite(split) ? Math.min(1, Math.max(0, split)) : 0.5;
    if (!source || !settings.get('S', 'compare', false, where)) {
      state.compare = false;
      return;
    }
    const chosen = settings.get('S', 'compareBefore', null, where);
    const before = chosen && ids.has(chosen) && chosen !== state.after ? chosen
      : app.previousRevision(state.after);
    state.compare = !!before;
    if (before) state.before = before;
  }

  async function workspace({ startup = false } = {}) {
    app.clearHover();
    const request = navigation.next();
    state.loading = true;
    app.syncControls();
    try {
      const data = await api.json('/api/workspace');
      if (!navigation.isCurrent(request)) return;
      // Facts are read after /api/workspace, which registers rebuilt inputs.
      const [facts] = await Promise.all([loadRevisionFacts(), startup ? settingsReady() : null]);
      if (!navigation.isCurrent(request)) return;
      state.workspace = {
        models: data.models ?? [], reports: data.reports ?? [], feedback: data.feedback ?? [],
      };
      app.setRevisionFacts(facts);
      const count = state.workspace.models.length;
      $('#workspace-status').textContent = `${count} model ${count === 1 ? 'version' : 'versions'}`
        + ' · Local workspace';
      app.renderLibrary();
      app.renderSaved();
      if (!count) {
        state.loading = false;
        ctx.viewportMessage('No models yet',
          'Open a model in this workspace to inspect, compare and annotate it.');
        app.syncControls();
        return;
      }
      const models = state.workspace.models;
      const ids = new Set(models.map(model => model.id));
      if (!ids.has(state.after)) state.after = defaultAfter();
      if (!ids.has(state.before)) state.before = app.previousRevision(state.after) ?? state.after;
      if (startup) applyStartupMode(ids);
      if (models.length < 2) state.compare = false;
      app.renderModelOptions();
      await app.loadSelectedModels(!state.saved, request);
    } catch (error) {
      if (!navigation.isCurrent(request)) return;
      state.loading = false;
      app.syncControls();
      throw error;
    }
  }

  async function startupWorkspace() {
    const request = navigation.current() + 1;
    await workspace({ startup: true });
    if (request !== navigation.current()) return;
    const id = new env.URLSearchParams(env.location.hash.slice(1)).get('review');
    if (id) await app.loadReview(id);
  }

  return { workspace, startupWorkspace };
}
