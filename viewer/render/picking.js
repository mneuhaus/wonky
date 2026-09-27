// Typed-array CPU picker over draw models (spec 7.2). Package: render-transport.
//
// A draw model comes from the scene cache: the binary draw payload, or the
// JSON-scene adapter when only a JSON scene is loaded (VS fixtures, no
// WebGL2). Both hold identical positions, triangle order and winding, so
// they return identical references.
//
// Semantics are the pre-foundation ones: vertex within 7 px, then edge
// within 6 px, then face (nearest by depth); `body` mode returns the body of
// the nearest face. Points and edges behind the nearest face are not
// pickable. New: the depth tolerance is 1.5 CSS px of view depth
// (camera.depthPerPixel) instead of 0.1 % of the extent, hidden bodies are
// skipped and clipped-away sides are not pickable. References keep the key
// order {modelId, bodyId, entityType, entityIndex}.
//
// Cost: every vertex, edge point and B-rep point is projected once per
// camera, pane and model (float64 matrix over float32 model-relative
// positions), and triangles, segments and points are binned into a screen
// grid. A pick then tests only the items of one grid cell, in ascending
// index order, so ties resolve exactly like a linear scan.
import { basis, depthPerPixel, fromLegacy, viewProjection } from './camera.js';
import { adapterFor, cacheOf } from './scene-cache.js';
import { resolveBodyStyle } from './style.js';
import {
  applyPoint, isIdentity, localDirection, localPlanes, localPoint, placedMatrix,
} from './placement.js';

export const VERTEX_RADIUS_PX = 7;
export const EDGE_RADIUS_PX = 6;
export const DEPTH_TOLERANCE_PX = 1.5;
// Barycentric slack so a point on an edge shared by two triangles is not
// lost to rounding (about 1e-7 px).
const EPSILON = 1e-9;
// Items covering more cells than this are tested for every pick.
const MAX_CELLS_PER_ITEM = 256;
const GRID_MARGIN_PX = 8;

// The frozen-API camera of a pane. camera-navigation may provide
// panes.camera(pane); otherwise the legacy facade camera is converted.
export function cameraFor(state, panes, pane) {
  const provided = panes.camera?.(pane);
  if (provided) return provided;
  return fromLegacy(state.camera, { center: state.center, extent: state.extent, pane });
}

function createGrid(pane, items) {
  const width = pane.width + 2 * GRID_MARGIN_PX;
  const height = pane.height + 2 * GRID_MARGIN_PX;
  const cell = Math.min(64, Math.max(8, Math.sqrt(width * height * 4 / Math.max(1, items))));
  return {
    x0: pane.x - GRID_MARGIN_PX, y0: pane.y - GRID_MARGIN_PX, cell,
    columns: Math.max(1, Math.ceil(width / cell)), rows: Math.max(1, Math.ceil(height / cell)),
  };
}

// CSR bins of `count` items; bbox(index, box) fills [minX, minY, maxX, maxY]
// and returns false for items that can never be hit (NaN coordinates).
function binItems(grid, count, bbox) {
  const { x0, y0, cell, columns, rows } = grid;
  const cells = columns * rows;
  const offsets = new Uint32Array(cells + 1);
  const ranges = new Int32Array(count * 4);
  const box = new Float64Array(4);
  const big = [];
  for (let index = 0; index < count; index++) {
    const at = 4 * index;
    ranges[at] = -1;
    if (!bbox(index, box)) continue;
    const c0 = Math.max(0, Math.floor((box[0] - x0) / cell));
    const r0 = Math.max(0, Math.floor((box[1] - y0) / cell));
    const c1 = Math.min(columns - 1, Math.floor((box[2] - x0) / cell));
    const r1 = Math.min(rows - 1, Math.floor((box[3] - y0) / cell));
    if (!(c0 <= c1 && r0 <= r1)) continue;
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_CELLS_PER_ITEM) {
      big.push(index);
      continue;
    }
    ranges[at] = c0;
    ranges[at + 1] = r0;
    ranges[at + 2] = c1;
    ranges[at + 3] = r1;
    for (let row = r0; row <= r1; row++) {
      for (let column = c0; column <= c1; column++) offsets[row * columns + column + 1]++;
    }
  }
  for (let cellIndex = 0; cellIndex < cells; cellIndex++) {
    offsets[cellIndex + 1] += offsets[cellIndex];
  }
  const items = new Uint32Array(offsets[cells]);
  const cursor = offsets.slice(0, cells);
  for (let index = 0; index < count; index++) {
    const at = 4 * index;
    if (ranges[at] < 0) continue;
    for (let row = ranges[at + 1]; row <= ranges[at + 3]; row++) {
      for (let column = ranges[at]; column <= ranges[at + 2]; column++) {
        items[cursor[row * columns + column]++] = index;
      }
    }
  }
  return { offsets, items, big: Uint32Array.from(big) };
}

// Calls visit(index) for every candidate under (x, y), in ascending order.
function forCandidates(grid, bins, x, y, visit) {
  const column = Math.floor((x - grid.x0) / grid.cell);
  const row = Math.floor((y - grid.y0) / grid.cell);
  const inside = column >= 0 && column < grid.columns && row >= 0 && row < grid.rows;
  const cellIndex = row * grid.columns + column;
  let item = inside ? bins.offsets[cellIndex] : 0;
  const end = inside ? bins.offsets[cellIndex + 1] : 0;
  let bigItem = 0;
  const { items, big } = bins;
  while (item < end || bigItem < big.length) {
    if (bigItem >= big.length || (item < end && items[item] < big[bigItem])) visit(items[item++]);
    else visit(big[bigItem++]);
  }
}

const finiteBox = box => box[0] === box[0] && box[1] === box[1] && box[2] === box[2]
  && box[3] === box[3];

// Screen-space projection of a model through one pane and camera; a
// workspace member passes its placement (render/placement.js), and depths
// are then along the view direction in its local frame.
export function projectModel(model, pane, camera, placement = null) {
  const matrix = memberMatrix(model, pane, camera, placement);
  const toward = localDirection(placement, basis(camera).toward);
  const halfWidth = pane.width / 2;
  const halfHeight = pane.height / 2;
  const project = (positions, count) => {
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    const depth = new Float64Array(count);
    // 1 / clip w: perspective-correct interpolation of screen barycentrics.
    const inverseW = new Float64Array(count);
    for (let index = 0; index < count; index++) {
      const px = positions[3 * index];
      const py = positions[3 * index + 1];
      const pz = positions[3 * index + 2];
      const cx = matrix[0] * px + matrix[4] * py + matrix[8] * pz + matrix[12];
      const cy = matrix[1] * px + matrix[5] * py + matrix[9] * pz + matrix[13];
      const cw = matrix[3] * px + matrix[7] * py + matrix[11] * pz + matrix[15];
      // At or behind a perspective eye: not on screen (NaN never hits).
      x[index] = cw > 0 ? pane.x + (cx / cw + 1) * halfWidth : NaN;
      y[index] = cw > 0 ? pane.y + (1 - cy / cw) * halfHeight : NaN;
      depth[index] = toward[0] * px + toward[1] * py + toward[2] * pz;
      inverseW[index] = cw > 0 ? 1 / cw : NaN;
    }
    return { x, y, depth, inverseW };
  };
  const { counts, arrays } = model;
  const vertices = project(arrays.positions, counts.vertices);
  const edges = project(arrays.edgePoints, counts.edgePoints);
  const points = project(arrays.vertexPoints, counts.points);
  const grid = createGrid(pane, counts.triangles);
  const { indices, edgeSegments } = arrays;
  const triangles = binItems(grid, counts.triangles, (triangle, box) => {
    const a = indices[3 * triangle];
    const b = indices[3 * triangle + 1];
    const c = indices[3 * triangle + 2];
    box[0] = Math.min(vertices.x[a], vertices.x[b], vertices.x[c]);
    box[1] = Math.min(vertices.y[a], vertices.y[b], vertices.y[c]);
    box[2] = Math.max(vertices.x[a], vertices.x[b], vertices.x[c]);
    box[3] = Math.max(vertices.y[a], vertices.y[b], vertices.y[c]);
    return finiteBox(box);
  });
  const segments = binItems(grid, counts.segments, (segment, box) => {
    const i = edgeSegments[2 * segment];
    const j = edgeSegments[2 * segment + 1];
    box[0] = Math.min(edges.x[i], edges.x[j]) - EDGE_RADIUS_PX;
    box[1] = Math.min(edges.y[i], edges.y[j]) - EDGE_RADIUS_PX;
    box[2] = Math.max(edges.x[i], edges.x[j]) + EDGE_RADIUS_PX;
    box[3] = Math.max(edges.y[i], edges.y[j]) + EDGE_RADIUS_PX;
    return finiteBox(box);
  });
  const pointBins = binItems(grid, counts.points, (point, box) => {
    box[0] = points.x[point] - VERTEX_RADIUS_PX;
    box[1] = points.y[point] - VERTEX_RADIUS_PX;
    box[2] = points.x[point] + VERTEX_RADIUS_PX;
    box[3] = points.y[point] + VERTEX_RADIUS_PX;
    return finiteBox(box);
  });
  return {
    key: projectionKey(matrix, pane),
    vertices, edges, points, grid,
    bins: { triangles, segments, points: pointBins },
    depthTolerance: DEPTH_TOLERANCE_PX * depthPerPixel(camera, pane, model.bounds),
  };
}

function memberMatrix(model, pane, camera, placement) {
  if (isIdentity(placement)) {
    return viewProjection(camera, pane, model.bounds, { relativeTo: model.center });
  }
  return placedMatrix(viewProjection(camera, pane, model.bounds,
    { relativeTo: applyPoint(placement, model.center) }), placement);
}

const projectionKey = (matrix, pane) => `${Array.from(matrix).join(',')}|${pane.x},${pane.y},`
  + `${pane.width},${pane.height}`;

// Clip planes are world-space { origin, normal }; geometry with
// dot(p - origin, normal) > 0 is clipped away.
function clipTest(model, planes) {
  if (!planes?.length) return null;
  const relative = planes.map(plane => ({
    normal: plane.normal,
    offset: plane.normal[0] * (plane.origin[0] - model.center[0])
      + plane.normal[1] * (plane.origin[1] - model.center[1])
      + plane.normal[2] * (plane.origin[2] - model.center[2]),
  }));
  return (x, y, z) => relative.some(plane => plane.normal[0] * x + plane.normal[1] * y
    + plane.normal[2] * z > plane.offset);
}

// Picks in one model seen through a projected view. `modelId` goes into the
// reference (the pane's model id), `hidden` is a Uint8Array mask of hidden
// body indices (or null), `clipPlanes` world-space planes (or none).
export function pickModel(model, view, x, y, mode, options) {
  return pickDetail(model, view, x, y, mode, options)?.reference ?? null;
}

// Like pickModel, plus the display hit point in world coordinates
// ({ reference, point }): the vertex, the nearest point of the edge polyline
// or the point on the display triangle under the cursor. The point is a
// display approximation (draw model tolerance), never a measurement.
export function pickDetail(model, view, x, y, mode, {
  modelId = model.id, hidden = null, clipPlanes, placement = null,
} = {}) {
  const { positions, indices, faceOfVertex, bodyOfVertex } = model.arrays;
  const clipped = clipTest(model, clipPlanes);
  const { x: sx, y: sy, depth: sd, inverseW } = view.vertices;
  let faceDepth = -Infinity;
  let face = -1;
  let faceHit = null;
  // Outward winding: a front face has a negative screen-space denominator
  // (y down). With clip planes a back face under the cursor is a section cap.
  let faceBack = false;
  forCandidates(view.grid, view.bins.triangles, x, y, triangle => {
    const a = indices[3 * triangle];
    const b = indices[3 * triangle + 1];
    const c = indices[3 * triangle + 2];
    const ax = sx[a];
    const bx = sx[b];
    const cx = sx[c];
    if ((x < ax && x < bx && x < cx) || (x > ax && x > bx && x > cx)) return;
    const ay = sy[a];
    const by = sy[b];
    const cy = sy[c];
    if ((y < ay && y < by && y < cy) || (y > ay && y > by && y > cy)) return;
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denominator) < 1e-10) return;
    const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator;
    const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator;
    const w0 = 1 - u - v;
    // Written NaN-safe: a vertex behind a perspective eye projects to NaN.
    if (!(u >= -EPSILON && v >= -EPSILON && w0 >= -EPSILON)) return;
    // Perspective-correct weights (identical to u, v, w0 in orthographic).
    const pu = u * inverseW[a];
    const pv = v * inverseW[b];
    const pw = w0 * inverseW[c];
    const sum = pu + pv + pw;
    if (!(sum > 0)) return;
    const [wa, wb, wc] = [pu / sum, pv / sum, pw / sum];
    const depth = sd[a] * wa + sd[b] * wb + sd[c] * wc;
    if (!(depth > faceDepth)) return;
    if (hidden?.[bodyOfVertex[a]]) return;
    if (clipped) {
      const point = [0, 1, 2].map(axis => positions[3 * a + axis] * wa
        + positions[3 * b + axis] * wb + positions[3 * c + axis] * wc);
      if (clipped(...point)) return;
    }
    faceDepth = depth;
    face = faceOfVertex[a];
    faceHit = [a, b, c, wa, wb, wc];
    faceBack = denominator > 0;
  });
  // Looking into a clipped body through its cut: the pixel shows a section
  // cap, not the inside face behind it. No face is picked there, but the cap
  // still occludes edges and points behind it.
  const cap = Boolean(clipped && face >= 0 && faceBack);
  const tolerance = view.depthTolerance;
  const visible = depth => faceDepth === -Infinity || depth >= faceDepth - tolerance;
  if (cap) {
    face = -1;
    faceHit = null;
  }
  const { vertexPoints, edgePoints } = model.arrays;
  let point = -1;
  if (mode === 'auto' || mode === 'vertex') {
    const { x: px, y: py, depth: pd } = view.points;
    const { bodyOfPoint } = model.arrays;
    let best = VERTEX_RADIUS_PX;
    forCandidates(view.grid, view.bins.points, x, y, index => {
      const dx = px[index] - x;
      const dy = py[index] - y;
      if (!(dx < best && dx > -best && dy < best && dy > -best)) return;
      const distance = Math.hypot(dx, dy);
      if (!(distance < best) || !visible(pd[index]) || hidden?.[bodyOfPoint[index]]) return;
      if (clipped?.(vertexPoints[3 * index], vertexPoints[3 * index + 1],
        vertexPoints[3 * index + 2])) return;
      best = distance;
      point = index;
    });
  }
  let edge = -1;
  let edgeHit = null;
  if (mode === 'auto' || mode === 'edge') {
    const { x: ex, y: ey, depth: ed } = view.edges;
    const { edgeSegments, edgeOfSegment } = model.arrays;
    let best = EDGE_RADIUS_PX;
    forCandidates(view.grid, view.bins.segments, x, y, segment => {
      const i = edgeSegments[2 * segment];
      const j = edgeSegments[2 * segment + 1];
      const ax = ex[i];
      const bx = ex[j];
      if ((x < ax - best && x < bx - best) || (x > ax + best && x > bx + best)) return;
      const ay = ey[i];
      const by = ey[j];
      if ((y < ay - best && y < by - best) || (y > ay + best && y > by + best)) return;
      const length2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = length2
        ? Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length2))
        : 0;
      const distance = Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
      if (!(distance < best)) return;
      const global = edgeOfSegment[segment];
      if (!visible(ed[i] + t * (ed[j] - ed[i])) || hidden?.[model.edgeBody[global]]) return;
      if (clipped?.(...[0, 1, 2].map(axis => edgePoints[3 * i + axis]
        + t * (edgePoints[3 * j + axis] - edgePoints[3 * i + axis])))) return;
      best = distance;
      edge = global;
      edgeHit = [i, j, t];
    });
  }
  const result = (bodyIndex, entityType, entityIndex, relative) => ({
    reference: { modelId, bodyId: model.bodies[bodyIndex].id, entityType, entityIndex },
    point: applyPoint(placement, relative.map((value, axis) => model.center[axis] + value)),
  });
  const at = (array, index) => [array[3 * index], array[3 * index + 1], array[3 * index + 2]];
  if (point >= 0) {
    return result(model.arrays.bodyOfPoint[point], 'vertex', model.arrays.vertexIndex[point],
      at(vertexPoints, point));
  }
  if (edge >= 0) {
    const [i, j, t] = edgeHit;
    const a = at(edgePoints, i);
    const b = at(edgePoints, j);
    return result(model.edgeBody[edge], 'edge', model.edgeLocal[edge],
      a.map((value, axis) => value + t * (b[axis] - value)));
  }
  if (face < 0 || !['auto', 'face', 'body'].includes(mode)) return null;
  const [a, b, c, u, v, w] = faceHit;
  const hit = [0, 1, 2].map(axis => positions[3 * a + axis] * u + positions[3 * b + axis] * v
    + positions[3 * c + axis] * w);
  if (mode === 'body') return result(model.faceBody[face], 'body', 0, hit);
  return result(model.faceBody[face], 'face', model.faceLocal[face], hit);
}

// Hidden-body mask of a model under the full style table (shared
// style.bodies, per-model style.models[modelId].bodies, opacity 0), or null.
export function hiddenMask(model, style, modelId = model.id) {
  if (!style?.bodies && !style?.models) return null;
  let mask = null;
  model.bodies.forEach((body, index) => {
    if (!resolveBodyStyle(style, modelId, body, index).visible) {
      mask ??= new Uint8Array(model.bodies.length);
      mask[index] = 1;
    }
  });
  return mask;
}

// Picker bound to the pane helpers and the scene cache (harness `pick`).
export function createPicker({ state, panes }) {
  const views = new WeakMap();
  const timings = [];
  const stats = { picks: 0, projections: 0, projectionMs: 0, lastMs: 0, lastAt: 0 };
  let style = null;

  function viewOf(model, pane, camera, member = null) {
    const placement = member?.matrix ?? null;
    const matrix = memberMatrix(model, pane, camera, placement);
    const key = projectionKey(matrix, pane);
    let byPane = views.get(model);
    if (!byPane) {
      byPane = new Map();
      views.set(model, byPane);
    }
    const slot = `${pane.side}:${member?.instance ?? pane.modelId}`;
    const cached = byPane.get(slot);
    if (cached?.key === key) return cached;
    const started = performance.now();
    const view = projectModel(model, pane, camera, placement);
    stats.projections++;
    stats.projectionMs = performance.now() - started;
    byPane.set(slot, view);
    return view;
  }

  function modelFor(id) {
    const cache = cacheOf(state.scenes);
    return cache ? cache.model(id) : adapterFor(state.scenes.get(id));
  }

  // Timings exclude the projection (once per camera change, stats.projectionMs).
  // A pane with workspace members picks in every member (ray in its local
  // frame) and keeps the hit nearest the eye; the result names its instance.
  function pickMembers(pane, x, y, mode) {
    const camera = cameraFor(state, panes, pane);
    const { toward } = basis(camera);
    let best = null;
    let bestDepth = -Infinity;
    for (const member of pane.members) {
      const model = modelFor(member.modelId);
      if (!model) continue;
      const view = viewOf(model, pane, camera, member);
      const picked = pickDetail(model, view, x, y, mode, {
        modelId: member.modelId, hidden: hiddenMask(model, style, member.modelId),
        clipPlanes: localPlanes(member.matrix, style?.clipPlanes ?? []),
        placement: member.matrix,
      });
      if (!picked) continue;
      const depth = toward[0] * picked.point[0] + toward[1] * picked.point[1]
        + toward[2] * picked.point[2];
      if (depth > bestDepth) {
        bestDepth = depth;
        // localPoint: the hit in the member's own model frame (server queries).
        best = { ...picked, instance: member.instance,
          localPoint: localPoint(member.matrix, picked.point) };
      }
    }
    return best;
  }

  function detail(x, y, mode = state.mode) {
    const pane = panes.paneAt(x, y);
    if (pane?.members) {
      const started = performance.now();
      const picked = pickMembers(pane, x, y, mode);
      stats.picks++;
      stats.lastMs = performance.now() - started;
      stats.lastAt = started;
      return picked;
    }
    const model = pane ? modelFor(pane.modelId) : null;
    if (!model) return null;
    const view = viewOf(model, pane, cameraFor(state, panes, pane));
    const started = performance.now();
    const picked = pickDetail(model, view, x, y, mode, {
      modelId: pane.modelId, hidden: hiddenMask(model, style, pane.modelId),
      clipPlanes: style?.clipPlanes,
    });
    stats.picks++;
    stats.lastMs = performance.now() - started;
    stats.lastAt = started;
    timings.push(stats.lastMs);
    if (timings.length > 512) timings.shift();
    return picked;
  }
  const pick = (x, y, mode) => detail(x, y, mode)?.reference ?? null;
  // { reference, point, exactness } with the display hit point in world mm.
  pick.detail = (x, y, mode) => {
    const picked = detail(x, y, mode);
    return picked ? { ...picked, exactness: 'display-approximation' } : null;
  };
  pick.stats = () => {
    const sorted = [...timings].sort((a, b) => a - b);
    return { ...stats, samples: sorted.length, medianMs: sorted[sorted.length >> 1] ?? null };
  };
  pick.resetStats = () => {
    timings.length = 0;
    Object.assign(stats, { picks: 0, projections: 0, projectionMs: 0, lastMs: 0, lastAt: 0 });
  };
  // The renderer passes its style (hidden bodies, clip planes).
  pick.setStyle = next => {
    style = next;
  };
  pick.model = modelFor;
  return pick;
}
