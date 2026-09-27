// GL layer of the ghost revision (diff-overlay).
//
// Draws the display mesh of the ghost model into the pane of the model it is
// paired with, after that model:
//   - faces in one flat tint, translucent (alpha = blend), back faces first,
//     then front faces, depth-tested against the displayed model and without
//     depth writes. The polygon offset pushes the ghost behind the displayed
//     model's surfaces, so surfaces both revisions share show the displayed
//     model only; the ghost shows where the previous revision differs;
//   - the ghost's feature edges (sharp, tangent, unresolved) that do not
//     coincide with a display segment of the displayed model, so unchanged
//     edges stay as they are and the changed outline stands out.
// Everything here is display data (the draw payloads); nothing is measured.
export const GHOST_COLOR = Object.freeze([0.36, 0.48, 0.86]);
export const GHOST_EDGE_COLOR = Object.freeze([0.12, 0.24, 0.62]);
// Polygon offset (factor, units) of the ghost faces: behind the displayed
// model's own offset (1, 1) by enough depth-buffer steps that coplanar faces
// with a different triangulation never show through (1, 6 did, in stripes).
export const GHOST_POLYGON_OFFSET = Object.freeze([2, 40]);
export const GHOST_EDGE_LIMIT = 20000;
export const GHOST_EDGE_WIDTH_PX = 1.25;

// Edge class codes of the draw payload (render/draw-decode.js): sharp,
// tangent, seam, subdivision, unresolved. Seams and subdivisions stay hidden.
const GHOST_EDGE_CLASSES = new Set([0, 1, 4]);

// Endpoint key on a 1e-3 mm grid (display positions are float32 relative to
// each model's own center, so equal world points can differ in the last bits).
const pointKey = (x, y, z, grid) => `${Math.round(x / grid)},${Math.round(y / grid)},`
  + `${Math.round(z / grid)}`;

function segmentKeys(model, grid) {
  const keys = new Set();
  const { edgePoints, edgeSegments } = model?.arrays ?? {};
  if (!edgePoints || !edgeSegments) return keys;
  const [cx, cy, cz] = model.center ?? [0, 0, 0];
  const point = index => pointKey(cx + edgePoints[3 * index], cy + edgePoints[3 * index + 1],
    cz + edgePoints[3 * index + 2], grid);
  for (let segment = 0; 2 * segment + 1 < edgeSegments.length; segment++) {
    const a = point(edgeSegments[2 * segment]);
    const b = point(edgeSegments[2 * segment + 1]);
    keys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return keys;
}

// World positions (flat x, y, z pairs) of the ghost's feature-edge segments
// that do not coincide with a segment of `shown`. Returns
// { positions: Float64Array, segments, coincident, truncated }.
export function ghostEdgePositions(ghost, shown, { limit = GHOST_EDGE_LIMIT, grid = 1e-3 } = {}) {
  const empty = { positions: new Float64Array(0), segments: 0, coincident: 0, truncated: 0 };
  const arrays = ghost?.arrays;
  if (!arrays?.edgePoints || !arrays.edgeSegments) return empty;
  const { edgePoints, edgeSegments, edgeOfSegment, edgeClass } = arrays;
  const [cx, cy, cz] = ghost.center ?? [0, 0, 0];
  const taken = segmentKeys(shown, grid);
  const out = [];
  let coincident = 0;
  let truncated = 0;
  for (let segment = 0; 2 * segment + 1 < edgeSegments.length; segment++) {
    const code = edgeClass && edgeOfSegment ? edgeClass[edgeOfSegment[segment]] : 0;
    if (code !== undefined && !GHOST_EDGE_CLASSES.has(code)) continue;
    const a = 3 * edgeSegments[2 * segment];
    const b = 3 * edgeSegments[2 * segment + 1];
    const pa = [cx + edgePoints[a], cy + edgePoints[a + 1], cz + edgePoints[a + 2]];
    const pb = [cx + edgePoints[b], cy + edgePoints[b + 1], cz + edgePoints[b + 2]];
    const ka = pointKey(...pa, grid);
    const kb = pointKey(...pb, grid);
    if (taken.has(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`)) {
      coincident++;
      continue;
    }
    if (out.length / 6 >= limit) {
      truncated++;
      continue;
    }
    out.push(...pa, ...pb);
  }
  return { positions: Float64Array.from(out), segments: out.length / 6, coincident, truncated };
}

// renderer.addLayer wrapper. `current()` returns { modelId, forModelId,
// opacity } or null; `modelOf(id)` returns a cached draw model (ctx.cache).
export function createGhostLayer({ renderer, modelOf, current, order = 20 }) {
  const stats = { frames: 0, triangles: 0, segments: 0, coincident: 0, truncated: 0 };
  let edges = { key: null, ghost: null, shown: null, value: null };

  function edgesFor(ghostId, shownModel) {
    const ghost = modelOf(ghostId);
    if (!ghost) return null;
    const key = `${ghostId}|${shownModel?.id ?? ''}`;
    if (edges.key !== key || edges.ghost !== ghost || edges.shown !== shownModel) {
      edges = { key, ghost, shown: shownModel, value: ghostEdgePositions(ghost, shownModel) };
    }
    return edges.value;
  }

  const remove = renderer.addLayer({
    id: 'diff.ghost',
    order,
    draw(frame) {
      const ghost = current();
      if (!ghost?.modelId || frame.pane.modelId !== ghost.forModelId) return;
      const alpha = ghost.opacity;
      const faces = {
        modelId: ghost.modelId, color: GHOST_COLOR, alpha, lit: true, depthMask: false,
        polygonOffset: GHOST_POLYGON_OFFSET,
      };
      const triangles = frame.drawBodies({ ...faces, cull: 'front' })
        + frame.drawBodies({ ...faces, cull: 'back' });
      const lines = edgesFor(ghost.modelId, frame.model);
      let segments = 0;
      if (lines?.segments) {
        segments = frame.drawLines({
          positions: lines.positions, color: [...GHOST_EDGE_COLOR, Math.min(1, 0.3 + alpha)],
          widthPx: GHOST_EDGE_WIDTH_PX, depthBias: 0.5, clip: true,
        });
      }
      Object.assign(stats, {
        frames: stats.frames + 1, triangles, segments,
        coincident: lines?.coincident ?? 0, truncated: lines?.truncated ?? 0,
      });
    },
  });

  return {
    stats: () => ({ ...stats }),
    reset() {
      edges = { key: null, ghost: null, shown: null, value: null };
    },
    dispose: () => remove?.(),
  };
}
