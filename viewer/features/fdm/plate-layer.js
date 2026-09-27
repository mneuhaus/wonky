// Build plate layer (spec 3.6, key G): the plate at Z = 0, centred on the
// world origin (256 × 256 mm by default), drawn as grid lines only (10 mm,
// and 1 mm fading in from 6 CSS px per mm), its outline and the origin
// axes (X red, Y green, Z blue). Lines only, so the bottom view sees the
// model through the plate. The plate is a drawing aid, not model geometry.
//
// Depth window. The renderer's near and far planes come from the bounding
// sphere of the pane's model (render/camera.js), so most of a 256 mm plate
// under a 30 mm part lies outside them and would be clipped. The layer
// therefore splits every plate segment where it leaves a slab slightly
// larger than the model's bounding sphere and moves the outside pieces along
// their eye rays onto the slab faces: their screen position is unchanged
// (a projection maps lines to lines), pieces behind the model stay hidden by
// it through the depth test, and pieces in front of it are drawn over it,
// which is where they are. Inside the slab the true depth is kept.
import {
  basis, boundsFrame, eyeDistance, pixelsPerMm, unionBox, worldCamera,
} from '../../render/camera.js';

export const GRID_MAJOR_MM = 10;
export const GRID_MINOR_MM = 1;
// The slab: model bounding sphere × SLAB (the camera's own window is at least
// radius × 1.05, so the slab faces are always inside it).
export const SLAB = 1.02;
// Perspective: nothing closer to the eye than this fraction of its distance.
const EYE_MARGIN = 2e-3;

export const PLATE_STYLE = Object.freeze({
  outline: { color: [0.29, 0.35, 0.31, 0.85], widthPx: 1.5 },
  major: { color: [0.36, 0.42, 0.38], alpha: 0.38, widthPx: 1 },
  minor: { color: [0.36, 0.42, 0.38], alpha: 0.16, widthPx: 1 },
  x: { color: [0.80, 0.20, 0.18, 0.95], widthPx: 2 },
  y: { color: [0.22, 0.56, 0.24, 0.95], widthPx: 2 },
  z: { color: [0.20, 0.38, 0.80, 0.95], widthPx: 2 },
  depthBias: 0.5,
});

const within = (value, half) => Math.abs(value) < half - 1e-9;

// Plate segments as flat [ax, ay, az, bx, by, bz, …] pairs in world mm.
export function plateGeometry([width, depth]) {
  const hx = width / 2;
  const hy = depth / 2;
  const outline = [
    -hx, -hy, 0, hx, -hy, 0, hx, -hy, 0, hx, hy, 0,
    hx, hy, 0, -hx, hy, 0, -hx, hy, 0, -hx, -hy, 0,
  ];
  const major = [];
  const minor = [];
  const lines = (step, target, skip) => {
    for (let x = Math.ceil(-hx / step) * step; x <= hx; x += step) {
      if (!within(x, hx) || skip(x)) continue;
      // The positive Y half of x = 0 is the Y axis.
      target.push(x, -hy, 0, x, x === 0 ? 0 : hy, 0);
    }
    for (let y = Math.ceil(-hy / step) * step; y <= hy; y += step) {
      if (!within(y, hy) || skip(y)) continue;
      target.push(-hx, y, 0, y === 0 ? 0 : hx, y, 0);
    }
  };
  lines(GRID_MAJOR_MM, major, () => false);
  const onMajor = value => Math.abs(value / GRID_MAJOR_MM - Math.round(value / GRID_MAJOR_MM))
    < 1e-9;
  lines(GRID_MINOR_MM, minor, onMajor);
  const axisLength = Math.min(width, depth) * 0.1;
  return {
    outline, major, minor,
    x: [0, 0, 0, hx, 0, 0],
    y: [0, 0, 0, 0, hy, 0],
    z: [0, 0, 0, 0, 0, axisLength],
  };
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Slab of view depths (mm along the eye direction from the target, larger =
// nearer) that is safely inside the camera's depth window. null when there
// are no bounds or the slab is degenerate (then lines are drawn unclamped).
export function depthSlab({ camera, bounds }) {
  const box = unionBox(bounds);
  if (!box || !camera) return null;
  const view = worldCamera(camera, boundsFrame([box]));
  const { toward } = basis(view);
  const center = box.min.map((value, axis) => (value + box.max[axis]) / 2);
  const radius = Math.max(1e-3, Math.hypot(...box.max.map((value, axis) => value
    - box.min[axis])) / 2);
  const mid = dot(center.map((value, axis) => value - view.target[axis]), toward);
  const perspective = view.projection === 'perspective';
  const distance = perspective ? eyeDistance(view) : Infinity;
  const eyeLimit = perspective ? distance * (1 - EYE_MARGIN) : Infinity;
  const lo = mid - SLAB * radius;
  const hi = Math.min(mid + SLAB * radius, eyeLimit);
  if (!(hi > lo)) return null;
  return { toward, target: [...view.target], perspective, distance, eyeLimit, lo, hi };
}

// Appends point a + (b − a) t (depth d) to `out`, moved along its eye ray to
// depth `to` when `to` is not null.
function pushPoint(out, slab, a, b, t, d, to) {
  const { toward, target, distance } = slab;
  for (let axis = 0; axis < 3; axis++) {
    const value = a[axis] + (b[axis] - a[axis]) * t;
    if (to === null) out.push(value);
    else if (!slab.perspective) out.push(value + (to - d) * toward[axis]);
    else {
      const eye = target[axis] + toward[axis] * distance;
      out.push(eye + (value - eye) * ((distance - to) / (distance - d)));
    }
  }
}

// Splits and clamps flat segment pairs against a slab (see the header).
// Pieces at or behind the perspective eye limit are dropped. Runs every
// frame, so it works on scalars without per-point arrays.
export function clampSegments(points, slab) {
  if (!slab) return points;
  const out = [];
  const { toward, target, lo, hi, eyeLimit } = slab;
  const offset = dot(target, toward);
  const cuts = [lo, hi, eyeLimit].filter(Number.isFinite);
  const a = [0, 0, 0];
  const b = [0, 0, 0];
  const ts = [];
  for (let index = 0; index + 5 < points.length; index += 6) {
    for (let axis = 0; axis < 3; axis++) {
      a[axis] = points[index + axis];
      b[axis] = points[index + 3 + axis];
    }
    const da = dot(a, toward) - offset;
    const db = dot(b, toward) - offset;
    if (da >= lo && da <= hi && db >= lo && db <= hi) {
      for (let item = 0; item < 6; item++) out.push(points[index + item]);
      continue;
    }
    ts.length = 0;
    ts.push(0, 1);
    if (da !== db) {
      for (const cut of cuts) {
        const t = (cut - da) / (db - da);
        if (t > 0 && t < 1) ts.push(t);
      }
    }
    ts.sort((left, right) => left - right);
    for (let piece = 0; piece + 1 < ts.length; piece++) {
      const t0 = ts[piece];
      const t1 = ts[piece + 1];
      if (t1 - t0 < 1e-12) continue;
      const dp = da + (db - da) * t0;
      const dq = da + (db - da) * t1;
      const middle = (dp + dq) / 2;
      if (middle >= eyeLimit) continue;
      const to = middle < lo ? lo : middle > hi ? hi : null;
      pushPoint(out, slab, a, b, t0, dp, to);
      pushPoint(out, slab, a, b, t1, dq, to);
    }
  }
  return out;
}

// Grid alpha factors from the on-screen size of a millimetre at the target.
export function gridFade(pxPerMm) {
  const major = Math.min(1, Math.max(0.25, (pxPerMm * GRID_MAJOR_MM - 3) / 6));
  const minor = Math.min(1, Math.max(0, (pxPerMm * GRID_MINOR_MM - 6) / 8));
  return { major, minor };
}

// Registers the GL layer. active() and sizeMm() are read every frame.
export function createPlateLayer(ctx, { active, sizeMm }) {
  let cached = null;
  const stats = { frames: 0, segments: 0, clamped: false };
  const geometry = size => {
    const key = size.join('x');
    if (cached?.key !== key) cached = { key, lines: plateGeometry(size) };
    return cached.lines;
  };
  const remove = ctx.renderer.addLayer({
    id: 'fdm.plate',
    order: 10,
    draw(frame) {
      if (!active()) return;
      const lines = geometry(sizeMm());
      const slab = depthSlab(frame);
      const view = worldCamera(frame.camera, boundsFrame([frame.bounds]) ?? {});
      const fade = gridFade(pixelsPerMm(view, frame.pane));
      let segments = 0;
      const draw = (points, { color, widthPx, alpha }, factor = 1) => {
        const rgba = alpha === undefined ? color : [...color.slice(0, 3), alpha * factor];
        if (rgba[3] !== undefined && rgba[3] <= 0.01) return;
        segments += frame.drawLines({
          positions: clampSegments(points, slab), color: rgba, widthPx,
          depthBias: PLATE_STYLE.depthBias,
        });
      };
      draw(lines.minor, PLATE_STYLE.minor, fade.minor);
      draw(lines.major, PLATE_STYLE.major, fade.major);
      draw(lines.outline, PLATE_STYLE.outline);
      draw(lines.x, PLATE_STYLE.x);
      draw(lines.y, PLATE_STYLE.y);
      draw(lines.z, PLATE_STYLE.z);
      stats.frames++;
      stats.segments = segments;
      stats.clamped = !!slab;
    },
  });
  return { dispose: remove, stats: () => ({ ...stats }) };
}
