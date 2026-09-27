// Comparison layout and split (harness: setLayout). Owner: model-first-compare.
//
// Layout and split are global settings (scope G keys compareLayout and
// compareSplit, applied by startupWorkspace). While a saved review is open
// they belong to the review (R) and are not written as the global default.
import { clamp } from '../../core/dom.js';
import { comparisonLayout } from '../../render/panes.js';

const SPLIT_SAVE_DELAY = 400;

export function createLayout(ctx) {
  const { state, app, settings, env, dom: { $ } } = ctx;
  let splitTimer = null;

  function saveSplit() {
    if (state.saved) return;
    env.clearTimeout(splitTimer);
    splitTimer = env.setTimeout(() => {
      splitTimer = null;
      settings.set('G', 'compareSplit', Math.round(state.split * 1000) / 1000);
    }, SPLIT_SAVE_DELAY);
  }

  function setSplit(value, dirty = true) {
    app.clearHover();
    state.split = clamp(value, 0, 1);
    $('#comparison-split').value = Math.round(state.split * 100);
    $('#split-value').textContent = `${Math.round(state.split * 100)} / `
      + `${Math.round((1 - state.split) * 100)}`;
    if (dirty && state.saved) ctx.review.touch('compare.split');
    if (dirty) saveSplit();
    app.scheduleDraw();
  }
  // A layout change changes the pane size: models that were complete in the
  // old layout are refitted (orientation kept) when they would be cut off in
  // the new one; a view the user had zoomed into stays as it is (fix round 2,
  // CMP-08/09: wipe fit, then side by side cut both models).
  function setLayout(layout) {
    if (state.layout === layout) return;
    app.clearHover();
    state.pending = null;
    const fitted = app.modelFits?.();
    state.layout = comparisonLayout(layout);
    if (fitted && app.modelFits?.() === false) app.fit?.();
    ctx.review.touch('compare.layout');
    if (!state.saved) settings.set('G', 'compareLayout', state.layout);
    app.syncControls();
    app.scheduleDraw();
  }
  return { setSplit, setLayout };
}
