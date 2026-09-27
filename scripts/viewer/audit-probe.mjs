// Probe appended to viewer/app.js inside an audit browser session only (see
// audit-render-bench.mjs). It wraps module functions and exposes window.__audit.
export const probe = String.raw`
;(() => {
  const audit = window.__audit = { samples: {}, gpuTimer: true, gpuSync: false, queries: [], moveAt: 0, hoverPending: null };
  const push = (key, value) => (audit.samples[key] ??= []).push(value);
  const ext = gl && gl.getExtension('EXT_disjoint_timer_query');
  audit.hasTimer = !!ext;
  const sync = () => { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const originalDraw = draw;
  draw = function () {
    const t0 = performance.now();
    let query = null;
    if (ext && audit.gpuTimer) { query = ext.createQueryEXT(); ext.beginQueryEXT(ext.TIME_ELAPSED_EXT, query); }
    originalDraw();
    if (query) { ext.endQueryEXT(ext.TIME_ELAPSED_EXT); audit.queries.push({ query, at: t0 }); }
    if (audit.samplePoints) { const ratio = canvas.width / Math.max(1, canvas.clientWidth); audit.pixels = audit.samplePoints.map(([x, y]) => { const px = new Uint8Array(4); gl.readPixels(Math.round(x * ratio), Math.round(canvas.height - y * ratio), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [...px]; }); }
    const t1 = performance.now();
    if (audit.gpuSync) sync();
    const t2 = performance.now();
    push('draw', { at: t0, cpu: t1 - t0, synced: t2 - t0 });
    if (audit.hoverPending) { push('hover', { ...audit.hoverPending, drawnAt: t2, moveToDrawn: t2 - audit.hoverPending.moveAt }); audit.hoverPending = null; }
    if (audit.selectPending) { push('selectFrame', { ...audit.selectPending, drawnAt: t2, clickToDrawn: t2 - audit.selectPending.downAt }); audit.selectPending = null; }
    audit.resolveQueries();
  };
  audit.resolveQueries = () => {
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    audit.queries = audit.queries.filter(({ query, at }) => {
      if (!ext.getQueryObjectEXT(query, ext.QUERY_RESULT_AVAILABLE_EXT)) return true;
      if (!disjoint) push('gpu', { at, ms: ext.getQueryObjectEXT(query, ext.QUERY_RESULT_EXT) / 1e6 });
      ext.deleteQueryEXT(query);
      return false;
    });
  };
  const originalPick = pick;
  pick = function (...rest) { const t0 = performance.now(); const result = originalPick(...rest); push('pick', { ms: performance.now() - t0, hit: result?.entityType ?? null }); return result; };
  const originalHighlight = referenceHighlight;
  referenceHighlight = function (reference) { const t0 = performance.now(); const result = originalHighlight(reference); if (reference) push('highlight', { ms: performance.now() - t0, type: reference.entityType, vertices: result?.count ?? 0 }); return result; };
  const originalSetHover = setHover;
  setHover = function (reference, pane) {
    const changed = !sameReference(reference, state.hover) || pane !== state.hoverPane;
    const t0 = performance.now();
    originalSetHover(reference, pane);
    if (changed && reference) audit.hoverPending = { moveAt: audit.moveAt, pickedAt: t0, type: reference.entityType, moveToPick: t0 - audit.moveAt };
  };
  const originalSelect = select;
  select = function (reference, showPanel) {
    const t0 = performance.now(); originalSelect(reference, showPanel); const ms = performance.now() - t0;
    push('select', { ms, type: reference?.entityType ?? null });
    if (reference) audit.selectPending = { downAt: audit.downAt ?? t0, selectMs: ms, type: reference.entityType };
  };
  const originalPrepare = prepareScene;
  prepareScene = function (scene) { const had = state.buffers.has(scene.id); const t0 = performance.now(); originalPrepare(scene); if (!had) push('prepare', { ms: performance.now() - t0, id: scene.id }); };
  const originalApi = api;
  api = async function (path, options) { const t0 = performance.now(); const result = await originalApi(path, options); push('api', { path, ms: performance.now() - t0 }); return result; };
  const originalOverlay = renderOverlay;
  renderOverlay = function () { const t0 = performance.now(); originalOverlay(); push('overlay', { ms: performance.now() - t0 }); };
  canvas.addEventListener('pointermove', event => { audit.moveAt = event.timeStamp; }, { capture: true });
  canvas.addEventListener('pointerdown', event => { audit.downAt = event.timeStamp; }, { capture: true });
  audit.state = state;
  audit.gl = () => gl;
  audit.reset = () => { audit.samples = {}; };
  audit.frames = (count = 2) => new Promise(resolve => { const step = n => n ? requestAnimationFrame(() => step(n - 1)) : resolve(); step(count); });
  audit.sync = sync;
  audit.scheduleDraw = () => scheduleDraw();
  audit.bufferBytes = () => { let bytes = 0; for (const value of state.buffers.values()) bytes += ((value.triangles?.count ?? 0) + (value.edges?.count ?? 0)) * 24; return bytes; };
  audit.heap = () => { if (window.gc) { window.gc(); window.gc(); } return performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null; };
  audit.evict = id => { const b = state.buffers.get(id); if (b) { gl.deleteBuffer(b.triangles.buffer); gl.deleteBuffer(b.edges.buffer); } state.buffers.delete(id); state.scenes.delete(id); };
  audit.open = async (id, { cold = true } = {}) => {
    if (cold) audit.evict(id);
    const heapBefore = audit.heap();
    audit.samples.api = []; audit.samples.prepare = [];
    const t0 = performance.now();
    state.compare = false; state.before = id; state.after = id;
    await loadSelectedModels();
    const t1 = performance.now();
    await audit.frames(1); sync();
    const t2 = performance.now();
    const heapAfter = audit.heap();
    const scene = state.scenes.get(id);
    let triangles = 0, segments = 0;
    for (const body of scene.bodies) { for (const face of body.faces) triangles += face.triangles.length; for (const edge of body.edges) segments += Math.max(0, edge.points.length - 1); }
    return { id, label: scene.label, bodies: scene.bodies.length, faces: scene.bodies.reduce((n, b) => n + b.faces.length, 0), triangles, segments,
      openMs: t2 - t0, loadSelectedMs: t1 - t0, apiMs: audit.samples.api.at(-1)?.ms, prepareMs: audit.samples.prepare.at(-1)?.ms,
      firstFrameMs: t2 - t1, heapBefore, heapAfter, bufferBytes: ((state.buffers.get(id)?.triangles.count ?? 0) + (state.buffers.get(id)?.edges.count ?? 0)) * 24, extent: state.extent, center: state.center };
  };
  audit.transfer = async id => {
    const t0 = performance.now(); const response = await fetch('/api/models/' + id); const text = await response.text(); const t1 = performance.now();
    const value = JSON.parse(text); const t2 = performance.now();
    const t3 = performance.now(); new Float32Array(triangleData(value.bodies.flatMap(body => body.faces))); new Float32Array(edgeData(value.bodies.flatMap(body => body.edges))); const t4 = performance.now();
    return { bytes: text.length, downloadMs: t1 - t0, parseMs: t2 - t1, flattenMs: t4 - t3 };
  };
  audit.setCamera = camera => { clearHover(); state.camera = { ...state.camera, ...camera, pan: camera.pan ?? state.camera.pan }; scheduleDraw(); };
  audit.project = point => project(point, viewPanes()[0]);
  audit.cameraFactor = () => cameraFactor();
  audit.pick = (x, y, mode) => { const saved = audit.samples.pick; const result = originalPick(x, y, mode); audit.samples.pick = saved; return result; };
  audit.selectReference = reference => select(reference, false);
  audit.hoverReference = reference => setHover(reference, 'after');
  audit.showEdges = value => { state.showEdges = value; scheduleDraw(); };
})();
`;
