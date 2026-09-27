// Hover preview, click selection, multi-selection, the selection filter and
// the SVG edge highlight layer (harness: select). Owner: exact-measure (W1).
//
// state.selection is the primary reference (or null); state.selectionSet is
// the ordered multi-selection. select(reference | [references]) replaces both.
// A Shift-, ⌘- or Ctrl-click (below the pointer drag threshold) adds the
// picked entity to the set or removes it; the primary stays the first entry.
//
// Every click also records a display anchor: the point on the display mesh
// (or edge polyline, or vertex) under the cursor, in world mm. Dimension
// lines start there and say so ("anchor: display pick"); anchors are never
// used as measured values. This feature makes no requests (legacy seam).
import { clamp } from '../../core/dom.js';
import { referencePoints, sameReference, selectedRecords } from '../../core/scene-records.js';

export const id = 'selection';
export const legacy = true;

const FILTERS = Object.freeze(['auto', 'face', 'edge', 'vertex', 'body']);
const MODE = '<label class="selection-control"><span data-icon="cursor"></span><select'
  + ' id="selection-mode" aria-label="Geometry selection mode"><option value="auto">Auto select'
  + '</option><option value="face">Faces</option><option value="edge">Edges</option>'
  + '<option value="vertex">Points</option><option value="body">Bodies</option></select></label>';

export const referenceKey = reference => (reference
  ? [reference.modelId, reference.bodyId, reference.entityType, reference.entityIndex].join('|')
  : '');

// Adds `reference` to `references` or removes it when it is already there.
export function toggleReference(references, reference) {
  if (!reference) return references;
  return references.some(item => sameReference(item, reference))
    ? references.filter(item => !sameReference(item, reference))
    : [...references, reference];
}

const lerp = (a, b, t) => a.map((value, axis) => value + (b[axis] - value) * t);

function barycentric(x, y, a, b, c) {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-10) return null;
  const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
  const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
  const w = 1 - u - v;
  return u >= -1e-9 && v >= -1e-9 && w >= -1e-9 ? [u, v, w] : null;
}

// World point on the display geometry of `records.entity` under the screen
// point (x, y) seen through `pane`; null when nothing is under it.
export function displayAnchor(records, reference, { x, y, pane, project }) {
  if (!records?.entity || !pane) return null;
  if (reference.entityType === 'vertex') return [...records.entity.point];
  if (reference.entityType === 'edge') {
    let best = null;
    const points = records.entity.points ?? [];
    const screen = points.map(point => project(point, pane));
    for (let index = 1; index < points.length; index++) {
      const a = screen[index - 1];
      const b = screen[index];
      const length2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      const t = length2 ? clamp(((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / length2,
        0, 1) : 0;
      const distance = Math.hypot(x - a.x - t * (b.x - a.x), y - a.y - t * (b.y - a.y));
      if (!best || distance < best.distance) {
        best = { distance, point: lerp(points[index - 1], points[index], t) };
      }
    }
    return best?.point ?? null;
  }
  const faces = reference.entityType === 'face' ? [records.entity] : records.body.faces;
  let best = null;
  for (const face of faces) {
    for (const triangle of face.triangles ?? []) {
      const screen = triangle.points.map(point => project(point, pane));
      const weights = barycentric(x, y, ...screen);
      if (!weights) continue;
      const depth = weights.reduce((sum, weight, index) => sum + weight * screen[index].depth, 0);
      if (best && depth <= best.depth) continue;
      const point = [0, 1, 2].map(axis => weights.reduce((sum, weight, index) => sum
        + weight * triangle.points[index][axis], 0));
      best = { depth, point };
    }
  }
  return best?.point ?? null;
}

// Mean of the entity's display points (anchor for selections without a click).
export function displayCentroid(records, reference) {
  const points = referencePoints(records, reference);
  if (!points.length) return null;
  return [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0)
    / points.length);
}

export function setup(ctx) {
  const { state, app, store, slots, renderer, pointer, panes, env, dom: { $ } } = ctx;
  const canvas = $('#model-canvas');
  slots.viewportHud.item({ id: 'selection.mode', corner: 'top-right', order: 10, html: MODE });

  let hoverPoint = null;
  let hoverFramePending = false;

  function setHover(reference, pane = null) {
    if (sameReference(reference, state.hover) && pane === state.hoverPane) return;
    store.update('selection.hover', current => {
      current.selection.hover = reference;
      current.selection.hoverPane = pane;
    });
    renderer.setHighlights({ hover: reference, hoverPane: pane });
    canvas.classList.toggle('hovering', !!reference);
    app.scheduleDraw();
  }
  function clearHover() {
    hoverPoint = null;
    setHover(null);
  }
  function previewAt(point) {
    hoverPoint = point;
    if (hoverFramePending) return;
    hoverFramePending = true;
    env.requestAnimationFrame(() => {
      hoverFramePending = false;
      const next = hoverPoint;
      hoverPoint = null;
      const previewing = ['select', 'comment'].includes(state.tool);
      if (!next || pointer.gesture() || state.loading || !previewing) return;
      const reference = renderer.pick(next.x, next.y);
      setHover(reference, reference ? panes.paneAt(next.x, next.y)?.side : null);
    });
  }
  const setSelection = references => store.update('selection.selection', current => {
    current.selection.selection = references[0] ?? null;
    current.selection.selectionSet = references;
    const keys = new Set(references.map(referenceKey));
    for (const key of Object.keys(current.selection.anchors)) {
      if (!keys.has(key)) delete current.selection.anchors[key];
    }
  });
  // select(reference) or select([references]); the first is the primary.
  function select(reference, showPanel = true) {
    clearHover();
    const references = [reference].flat().filter(Boolean);
    setSelection(references);
    renderer.setHighlights({ selection: references });
    if (showPanel) app.panel('inspect');
    app.renderInspector();
    app.scheduleDraw();
  }
  // Adds the entity to the multi-selection, or removes it when selected.
  function toggleSelection(reference) {
    if (!reference) return;
    select(toggleReference(state.selectionSet, reference));
  }
  function recordAnchor(reference, point) {
    if (!reference) return;
    const detail = renderer.pickDetail(point.x, point.y);
    const anchor = detail && sameReference(detail.reference, reference) ? detail.point
      : displayAnchor(selectedRecords(state.scenes, reference), reference, {
        ...point, pane: panes.paneAt(point.x, point.y), project: panes.project,
      });
    store.get().selection.anchors[referenceKey(reference)] = anchor;
  }
  // Display anchor of a selected entity: { point, source } with the clicked
  // display point ('pick'), else the centroid of its display points
  // ('centroid', e.g. after Browse geometry); null without display data.
  function selectionAnchor(reference) {
    const picked = store.get().selection.anchors[referenceKey(reference)];
    if (picked) return { point: picked, source: 'pick' };
    const records = selectedRecords(state.scenes, reference);
    const points = records ? null : renderer.entityPoints(reference);
    const centroid = points?.length ? [0, 1, 2].map(axis => points.reduce((sum, item) => sum
      + item[axis], 0) / points.length) : displayCentroid(records, reference);
    return centroid ? { point: centroid, source: 'centroid' } : null;
  }

  pointer.onHover(previewAt);
  pointer.onClick((point, { additive = false } = {}) => {
    const reference = renderer.pick(point.x, point.y);
    recordAnchor(reference, point);
    if (additive) toggleSelection(reference);
    else select(reference);
  });
  env.window.addEventListener('blur', () => app.clearHover());
  // The selection filter persists globally (spec section 6, scope G); under
  // the legacy seam settings stay in memory, so no request is made.
  const applyFilter = value => {
    if (!FILTERS.includes(value) || value === state.mode) return;
    app.clearHover();
    state.mode = value;
    const element = $('#selection-mode');
    if (element) element.value = value;
  };
  $('#selection-mode').onchange = event => {
    app.clearHover();
    state.mode = event.target.value;
    ctx.settings.set('G', 'selectionFilter', event.target.value);
  };
  const stopSettings = ctx.settings.onChange(() => {
    applyFilter(ctx.settings.get('G', 'selectionFilter', 'auto'));
  });
  ctx.keyboard.onEscape(() => select(null, false), 30);

  ctx.overlay.layer({
    id: 'selection.edges',
    order: 20,
    render({ height }) {
      let content = '';
      const selected = state.selectionSet;
      const entries = [[state.hover, true], ...selected.map(reference => [reference, false])];
      for (const [reference, preview] of entries) {
        if (reference?.entityType !== 'edge') continue;
        if (preview && selected.some(item => sameReference(reference, item))) continue;
        const polyline = renderer.entityPoints(reference);
        if (!polyline.length) continue;
        const visible = panes.viewPanes().filter(pane => pane.modelId === reference.modelId
          && (!preview || pane.side === state.hoverPane));
        for (const pane of visible) {
          const points = polyline.map(point => panes.project(point, pane));
          const clip = `${preview ? 'hover' : 'selection'}-${pane.side}-clip`;
          content += `<defs><clipPath id="${clip}"><rect x="${pane.clipX}" y="0"`
            + ` width="${pane.clipWidth}" height="${height}"/></clipPath></defs>`
            + `<polyline clip-path="url(#${clip})" points="`
            + `${points.map(point => `${point.x},${point.y}`).join(' ')}" fill="none"`
            + ` stroke="${preview ? '#a3ad83' : '#c18a5c'}" stroke-width="${preview ? 2 : 2.5}"`
            + ' stroke-linejoin="round"/>';
        }
      }
      return content;
    },
  });

  const selectionField = {
    get: () => store.get().selection.selection,
    set: value => setSelection(value ? [value] : []),
  };
  return {
    api: { select, clearHover, setHover, previewAt, toggleSelection, selectionAnchor },
    dispose: stopSettings,
    legacy: {
      harness: { select },
      state: {
        selection: selectionField,
        ...ctx.fields('selection', ['selectionSet', 'hover', 'hoverPane', 'mode']),
      },
    },
    defaults: {
      selection: {
        selection: null, selectionSet: [], hover: null, hoverPane: null, mode: 'auto',
        anchors: {},
      },
    },
  };
}
