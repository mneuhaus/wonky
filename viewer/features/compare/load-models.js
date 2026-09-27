// Scene loading for the displayed models (harness: loadSelectedModels).
// Owner: model-first-compare.
import { boundsFrame, defaultLegacyCamera } from '../../render/camera.js';

export function createModelLoader(ctx) {
  const { state, app, api, renderer, dom: { $ } } = ctx;
  const navigation = ctx.requests.scope('navigation');

  const displayedIds = () => [
    ...new Set(state.compare ? [state.before, state.after] : [state.after]),
  ];
  const activeScenes = () => displayedIds().map(id => state.scenes.get(id)).filter(Boolean);
  // Draw-model summaries of the displayed models (no JSON scene needed).
  const activeSummaries = () => displayedIds().map(id => renderer.summary(id))
    .filter(Boolean);

  function sharedBounds() {
    const frame = boundsFrame(displayedIds().map(id => renderer.bounds(id)).filter(Boolean));
    if (!frame) return;
    state.center = frame.center;
    state.extent = frame.extent;
  }

  async function loadScene(id) {
    if (!id) return null;
    // With WebGL2 only the binary draw payload loads; the JSON scene follows
    // on the first inspection (render-transport, spec 7.2).
    if (!ctx.legacy && renderer.available() && !state.scenes.has(id)) {
      await renderer.loadModel(id);
      return null;
    }
    if (!state.scenes.has(id)) {
      state.scenes.set(id, await api.json(`/api/models/${encodeURIComponent(id)}`));
    }
    const scene = state.scenes.get(id);
    renderer.prepareScene(scene);
    return scene;
  }

  async function loadSelectedModels(resetCamera = true, request = navigation.next()) {
    app.clearHover();
    state.loading = true;
    app.syncControls();
    ctx.viewportMessage('Opening model', 'Preparing the view…');
    try {
      await Promise.all(displayedIds().filter(Boolean).map(loadScene));
      if (!navigation.isCurrent(request)) return;
      sharedBounds();
      if (resetCamera) state.camera = defaultLegacyCamera();
      app.select(null, false);
      state.loading = false;
      app.syncControls();
      app.renderInspector();
      if (renderer.available()) $('#viewport-message').hidden = true;
      else {
        ctx.viewportMessage('3D display unavailable', renderer.unavailableReason?.()
          ?? 'Enable WebGL2 or open this page in another browser. Checks and review'
          + ' notes are still available.');
      }
      app.scheduleDraw();
    } catch (error) {
      if (!navigation.isCurrent(request)) return;
      state.loading = false;
      app.syncControls();
      ctx.viewportMessage('Model could not be opened', error.message, true);
      throw error;
    }
  }

  return { activeScenes, activeSummaries, loadScene, loadSelectedModels, sharedBounds };
}
