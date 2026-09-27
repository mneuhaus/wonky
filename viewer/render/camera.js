// Camera (pure), convention 2: one right-handed world-space camera shared by
// the shader, the picker and every overlay (spec 7.1, D6, D13).
//
//   { convention: 2, projection: 'orthographic' | 'perspective',
//     target: [x, y, z] mm (float64), yaw, pitch, height }
//
// yaw and pitch keep the pre-foundation meaning, so a saved legacy camera
// still looks at the same side of the part: yaw 0 puts the eye on the +Y
// side, pitch -π/2 looks straight down. Convention 2 flips screen X, which
// makes the view basis right-handed (right × up = toward, determinant +1).
// Convention 1 views were mirror images.
//
// height is the world size in mm that the shorter side of a pane shows at
// the target: px per mm = min(pane.width, pane.height) / height. The view
// scales with its pane (like the legacy camera and the orthographic view
// height of three.js/OCP), side-by-side panes share one scale, and legacy
// conversion needs no pane. In perspective (fov 35° across the shorter side)
// the eye sits height / (2 tan(fov / 2)) from the target, so the target
// plane keeps the orthographic scale when the projection is toggled.
//
// Zoom is limited physically: 1 µm to 10 m per CSS px. Depth (near/far) comes
// from the bounding sphere of the bounds passed to viewProjection().

export const CONVENTION = 2;
export const FOV = 35 * Math.PI / 180;
export const PITCH_LIMIT = Math.PI / 2;
export const MM_PER_PX = Object.freeze({ min: 1e-3, max: 1e4 });
export const PROJECTIONS = Object.freeze(['orthographic', 'perspective']);
// Legacy fit: the largest bounds dimension fills 67 % of the shorter side.
export const LEGACY_FILL = 0.67;
// Projected fit: the bounds' screen box fills 80 % of the pane, which keeps the
// model clear of the HUD (tool rail, title, view actions).
export const FIT_FILL = 0.8;

// Marks the camera returned by defaultLegacyCamera(): assigning it through the
// view feature's state facade means "apply the fit policy" (features/view).
export const DEFAULT_CAMERA = Symbol.for('wonky.viewer.defaultCamera');

const TAN_HALF_FOV = Math.tan(FOV / 2);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const unit = vector => {
  const length = Math.hypot(...vector);
  if (!(length > 0)) throw new Error('A view direction needs a nonzero length');
  return vector.map(value => value / length);
};

// Standard views as in Onshape and OCP: the direction points from the target
// toward the eye; `up` orients the two views along the Z axis.
export const VIEWS = Object.freeze({
  front: Object.freeze({ label: 'Front', direction: [0, -1, 0], up: [0, 0, 1] }),
  back: Object.freeze({ label: 'Back', direction: [0, 1, 0], up: [0, 0, 1] }),
  left: Object.freeze({ label: 'Left', direction: [-1, 0, 0], up: [0, 0, 1] }),
  right: Object.freeze({ label: 'Right', direction: [1, 0, 0], up: [0, 0, 1] }),
  top: Object.freeze({ label: 'Top', direction: [0, 0, 1], up: [0, 1, 0] }),
  bottom: Object.freeze({ label: 'Bottom', direction: [0, 0, -1], up: [0, -1, 0] }),
  iso: Object.freeze({ label: 'Isometric', direction: [1, -1, 1], up: [0, 0, 1] }),
});
export const PRESET_NAMES = Object.freeze([
  'front', 'back', 'left', 'right', 'top', 'bottom', 'iso',
]);
// The pre-foundation cycle of the view button (kept for callers of the old API).
export const LEGACY_PRESET_CYCLE = Object.freeze(['iso', 'front', 'top', 'right']);

// Turntable angles of a view direction. At the poles (top, bottom) `up`
// chooses the yaw; elsewhere the screen up is the world Z side.
export function anglesFrom(direction, up = [0, 0, 1], fallbackYaw = 0) {
  const [dx, dy, dz] = unit(direction);
  const pitch = -Math.asin(clamp(dz, -1, 1)) + 0;
  if (Math.hypot(dx, dy) > 1e-9) return [Math.atan2(dx, dy) + 0, pitch];
  // Pole: screen up = sin(pitch) · (sin yaw, cos yaw, 0).
  const sp = Math.sin(pitch);
  const ux = sp * up[0] + 0;
  const uy = sp * up[1] + 0;
  return [Math.hypot(ux, uy) > 1e-9 ? Math.atan2(ux, uy) + 0 : fallbackYaw, pitch];
}

// [yaw, pitch] of every standard view (convention 2).
export const PRESETS = Object.freeze(Object.fromEntries(PRESET_NAMES.map(name => [
  name, Object.freeze(anglesFrom(VIEWS[name].direction, VIEWS[name].up)),
])));

// The default view in the legacy {yaw, pitch, zoom, pan} form: the Iso preset
// fitted to the bounds. The DEFAULT_CAMERA mark asks the view feature for its
// fit policy (fit on the first revision or another source, keep otherwise).
export function defaultLegacyCamera() {
  const camera = { yaw: PRESETS.iso[0], pitch: PRESETS.iso[1], zoom: 1, pan: [0, 0] };
  Object.defineProperty(camera, DEFAULT_CAMERA, { value: true });
  return camera;
}

export const isWorldCamera = camera => camera?.convention === CONVENTION;

// Shared bounds of several {min, max} boxes: center and largest extent.
export function boundsFrame(boxes) {
  const box = unionBox(boxes);
  if (!box) return null;
  return {
    center: box.min.map((value, axis) => (value + box.max[axis]) / 2),
    extent: Math.max(1e-6, ...box.max.map((value, axis) => value - box.min[axis])),
  };
}

export function unionBox(boxes) {
  const list = (Array.isArray(boxes) ? boxes : [boxes]).filter(box => box?.min && box?.max);
  if (!list.length) return null;
  return {
    min: [0, 1, 2].map(axis => Math.min(...list.map(box => box.min[axis]))),
    max: [0, 1, 2].map(axis => Math.max(...list.map(box => box.max[axis]))),
  };
}

// {right, up, toward}: world directions of screen +x, screen +y and the eye
// (from the target). right × up = toward.
export function basis(camera) {
  const c = Math.cos(camera.yaw);
  const s = Math.sin(camera.yaw);
  const cp = Math.cos(camera.pitch);
  const sp = Math.sin(camera.pitch);
  return {
    right: [-c, s, 0],
    up: [s * sp, c * sp, cp],
    toward: [s * cp, c * cp, -sp],
  };
}

// ---- Legacy conversion (convention 1, the pre-fix bounds-relative camera) ----

// px per mm of a legacy camera in a pane (the pre-foundation cameraFactor).
export const legacyFactor = (pane, extent, zoom) => Math.min(pane.width, pane.height)
  * LEGACY_FILL / extent * zoom;

// The pre-foundation (mirrored) projection, bit-identical. Kept for legacy
// drawings and tests; nothing renders with it any more.
export function projectLegacy(point, legacy, center, extent, pane) {
  const x = point[0] - center[0];
  const y = point[1] - center[1];
  const z = point[2] - center[2];
  const { yaw, pitch, pan } = legacy;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const a = x * c - y * s;
  const b = x * s + y * c;
  const factor = legacyFactor(pane, extent, legacy.zoom);
  return {
    x: pane.x + pane.width / 2 + (a + pan[0] * extent) * factor,
    y: pane.y + pane.height / 2 - (b * Math.sin(pitch) + z * Math.cos(pitch) + pan[1] * extent)
      * factor,
    depth: b * Math.cos(pitch) - z * Math.sin(pitch),
  };
}

// Legacy screen right (mirrored): the world direction of legacy screen +x.
const legacyRight = yaw => [Math.cos(yaw), -Math.sin(yaw), 0];

// A legacy camera {yaw, pitch, zoom, pan} relative to the bounds frame
// {center, extent} as a convention-2 camera: same eye direction, same world
// point at the pane center, same scale; the image is the mirror image of the
// legacy one about the pane center. A convention-2 camera passes through
// (normalized copy), so callers may pass either form. The pane is not needed
// (the scale is pane-relative); it is accepted for the frozen signature.
export function fromLegacy(legacy, { center, extent } = {}) {
  if (isWorldCamera(legacy)) return copyCamera(legacy);
  const frameCenter = center ?? [0, 0, 0];
  const frameExtent = extent ?? 1;
  const { up } = basis(legacy);
  const right = legacyRight(legacy.yaw);
  const [panX, panY] = legacy.pan ?? [0, 0];
  return {
    convention: CONVENTION,
    projection: 'orthographic',
    target: frameCenter.map((value, axis) => value - panX * frameExtent * right[axis]
      - panY * frameExtent * up[axis]),
    yaw: legacy.yaw,
    pitch: legacy.pitch,
    height: frameExtent / (LEGACY_FILL * (legacy.zoom ?? 1)),
  };
}

// Inverse of fromLegacy for the same frame. The target's offset along the
// view direction is not representable in the legacy form and is dropped.
export function toLegacy(camera, { center, extent } = {}) {
  if (!isWorldCamera(camera)) {
    return { yaw: camera.yaw, pitch: camera.pitch, zoom: camera.zoom, pan: [...camera.pan] };
  }
  const frameCenter = center ?? [0, 0, 0];
  const frameExtent = extent ?? 1;
  const offset = sub(camera.target, frameCenter);
  const { up } = basis(camera);
  return {
    yaw: camera.yaw,
    pitch: camera.pitch,
    zoom: frameExtent / (LEGACY_FILL * camera.height),
    pan: [-dot(offset, legacyRight(camera.yaw)) / frameExtent, -dot(offset, up) / frameExtent],
  };
}

export const copyCamera = camera => ({
  convention: CONVENTION,
  projection: camera.projection === 'perspective' ? 'perspective' : 'orthographic',
  target: [...camera.target],
  yaw: camera.yaw,
  pitch: camera.pitch,
  height: camera.height,
});

// Any camera form as a convention-2 camera; legacy cameras need their frame.
export const worldCamera = (camera, frame) => (isWorldCamera(camera) ? camera
  : fromLegacy(camera ?? defaultLegacyCamera(), frame ?? {}));

// Hot path: a world camera is used as is; a legacy one is read in the bounds frame.
const asWorld = (camera, bounds) => (isWorldCamera(camera) ? camera
  : worldCamera(camera, boundsFrame(bounds) ?? {}));

// ---- Projection ----

// px per mm at the target plane.
export const pixelsPerMm = (camera, pane) => Math.min(pane.width, pane.height) / camera.height;

// Distance of the perspective eye from the target.
export const eyeDistance = camera => camera.height / (2 * TAN_HALF_FOV);

// mm per CSS px at the target plane (orthographic: everywhere). Used as the
// depth tolerance unit of the picker and the depth bias of edges.
export function depthPerPixel(camera, pane, bounds) {
  return 1 / pixelsPerMm(asWorld(camera, bounds), pane);
}

// {x, y, depth} in CSS px; depth is the signed distance in mm along the view
// direction from the target plane (larger depth = nearer). In perspective a
// point at or behind the eye has x = y = NaN.
export function project(point, camera, pane, bounds) {
  const view = asWorld(camera, bounds);
  const { right, up, toward } = basis(view);
  const relative = sub(point, view.target);
  const depth = dot(relative, toward);
  let scale = pixelsPerMm(view, pane);
  if (view.projection === 'perspective') {
    const distance = eyeDistance(view);
    const ahead = distance - depth;
    scale = ahead > 0 ? scale * distance / ahead : NaN;
  }
  return {
    x: pane.x + pane.width / 2 + dot(relative, right) * scale,
    y: pane.y + pane.height / 2 - dot(relative, up) * scale,
    depth,
  };
}

export function unproject(x, y, depth, camera, pane, bounds) {
  const view = asWorld(camera, bounds);
  const { right, up, toward } = basis(view);
  let scale = pixelsPerMm(view, pane);
  if (view.projection === 'perspective') {
    const distance = eyeDistance(view);
    scale *= distance / (distance - depth);
  }
  const a = (x - pane.x - pane.width / 2) / scale;
  const b = (pane.y + pane.height / 2 - y) / scale;
  return [0, 1, 2].map(axis => view.target[axis] + a * right[axis] + b * up[axis]
    + depth * toward[axis]);
}

// Depth window {mid, half} (mm, relative to the target along toward) from the
// bounding sphere of `bounds`. Without bounds the window is wide (±10 m or
// 1000 view heights) and centered on `around` (e.g. the model center).
function depthWindow(view, toward, bounds, around) {
  const box = unionBox(bounds);
  if (!box) {
    const mid = around ? dot(sub(around, view.target), toward) : 0;
    return { mid, half: Math.max(1e4, 1e3 * view.height) };
  }
  const center = box.min.map((value, axis) => (value + box.max[axis]) / 2);
  const radius = Math.hypot(...sub(box.max, box.min)) / 2;
  const mid = dot(sub(center, view.target), toward);
  const half = radius * 1.05 + view.height * 0.01 + 1e-6 * (Math.hypot(...center) + radius)
    + 1e-6;
  return { mid, half };
}

// Column-major 4x4 world -> clip matrix for the pane's viewport. With
// `relativeTo` the matrix maps (point - relativeTo) instead, which keeps
// float32 GPU positions small. Agrees with project() (tested to 1e-6 px).
export function viewProjection(camera, pane, bounds, { relativeTo } = {}) {
  const view = asWorld(camera, bounds);
  const { right, up, toward } = basis(view);
  const origin = relativeTo ?? [0, 0, 0];
  const shift = sub(origin, view.target);
  const scale = pixelsPerMm(view, pane);
  const kx = 2 * scale / pane.width;
  const ky = 2 * scale / Math.max(1e-9, pane.height);
  const { mid, half } = depthWindow(view, toward, bounds, relativeTo);
  const toX = dot(right, shift);
  const toY = dot(up, shift);
  const toDepth = dot(toward, shift);
  let rows;
  if (view.projection === 'perspective') {
    const distance = eyeDistance(view);
    const far = Math.max(distance - mid + half, distance * 1e-3 * 2);
    const near = Math.max(distance - mid - half, distance * 1e-3, far * 1e-6);
    const a = -(far + near) / (far - near);
    const b = -2 * far * near / (far - near);
    rows = [
      [...right.map(value => value * kx * distance), kx * distance * toX],
      [...up.map(value => value * ky * distance), ky * distance * toY],
      [...toward.map(value => value * a), a * (toDepth - distance) + b],
      [...toward.map(value => -value), distance - toDepth],
    ];
  } else {
    rows = [
      [...right.map(value => value * kx), kx * toX],
      [...up.map(value => value * ky), ky * toY],
      [...toward.map(value => -value / half), -(toDepth - mid) / half],
      [0, 0, 0, 1],
    ];
  }
  const matrix = new Float64Array(16);
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) matrix[column * 4 + row] = rows[row][column];
  }
  return matrix;
}

// Column-major 3x3 world -> view rotation for normals (lighting).
export function normalMatrix(camera) {
  const { right, up, toward } = basis(camera);
  return new Float64Array([
    right[0], up[0], toward[0],
    right[1], up[1], toward[1],
    right[2], up[2], toward[2],
  ]);
}

// ---- Orientation ----

// Orients the camera so the eye sits along `direction` (from the target toward
// the eye). The camera is a Z-up turntable: `up` only matters at the poles
// (top and bottom views), where it chooses the screen up.
export function lookFrom(direction, up, camera) {
  const view = worldCamera(camera);
  const [yaw, pitch] = anglesFrom(direction, up ?? [0, 0, 1], view.yaw);
  return { ...copyCamera(view), yaw, pitch };
}

// One of the seven standard views; target and height are kept.
export function preset(name, camera) {
  const view = VIEWS[name];
  if (!view) throw new Error(`Unknown view preset ${name}`);
  return lookFrom(view.direction, view.up, camera);
}

// The standard view the camera shows exactly (same orientation), or null.
export function presetOf(camera, tolerance = 1e-9) {
  const { right, toward } = basis(camera);
  return PRESET_NAMES.find(name => {
    const other = basis(PRESETS_CAMERAS[name]);
    return [0, 1, 2].every(axis => Math.abs(other.right[axis] - right[axis]) < tolerance
      && Math.abs(other.toward[axis] - toward[axis]) < tolerance);
  }) ?? null;
}
const PRESETS_CAMERAS = Object.fromEntries(PRESET_NAMES.map(name => [
  name, { yaw: PRESETS[name][0], pitch: PRESETS[name][1] },
]));

// Pitch step clamped to ±90°. A restored legacy pitch beyond the limit is kept
// (legacy drawings depend on it) but never moves further out.
export function clampPitch(pitch, delta) {
  return clamp(pitch + delta, Math.min(-PITCH_LIMIT, pitch), Math.max(PITCH_LIMIT, pitch));
}

export function orbit(camera, deltaYaw, deltaPitch) {
  const view = copyCamera(camera);
  return { ...view, yaw: view.yaw + deltaYaw, pitch: clampPitch(view.pitch, deltaPitch) };
}

// Moves the view so the content follows the pointer by (dx, dy) CSS px at the
// target plane.
export function panBy(camera, pane, dx, dy) {
  const view = copyCamera(camera);
  const { right, up } = basis(view);
  const scale = pixelsPerMm(view, pane);
  view.target = view.target.map((value, axis) => value - right[axis] * dx / scale
    + up[axis] * dy / scale);
  return view;
}

// Height limits for a pane (1 µm to 10 m per CSS px).
export function heightLimits(pane) {
  const side = Math.min(pane.width, pane.height);
  return { min: MM_PER_PX.min * side, max: MM_PER_PX.max * side };
}

// Zooms by `factor` (> 1 zooms out) keeping the world point under (x, y) at
// view depth `depth` (mm from the target plane, larger = nearer) fixed on
// screen; the factor is limited physically. The camera is scaled about that
// point, so in perspective the eye dollies toward it. Orthographic views
// keep every point of the cursor ray fixed; depth 0 keeps the target (the
// orbit pivot) at its depth.
export function zoomAt(camera, pane, x, y, factor, depth = 0) {
  const view = copyCamera(camera);
  const limits = heightLimits(pane);
  const height = clamp(view.height * factor, Math.min(limits.min, view.height),
    Math.max(limits.max, view.height));
  const applied = height / view.height;
  const inside = Number.isFinite(x) && Number.isFinite(y);
  const anchor = inside ? unproject(x, y, depth, view, pane) : view.target;
  return {
    ...view,
    height,
    target: anchor.map((value, axis) => value + (view.target[axis] - value) * applied),
  };
}

// ---- Fit ----

// Fits the bounds keeping the orientation and projection. With a pane the
// bounds' projected box fills FIT_FILL of it; without one the legacy fit is
// used (largest dimension over 67 % of the shorter side).
export function fit(bounds, camera, pane) {
  const view = copyCamera(worldCamera(camera));
  const box = unionBox(bounds);
  if (!box) return view;
  const center = box.min.map((value, axis) => (value + box.max[axis]) / 2);
  const extent = Math.max(1e-6, ...box.max.map((value, axis) => value - box.min[axis]));
  view.target = center;
  if (!pane || !(pane.width > 0) || !(pane.height > 0)) {
    view.height = extent / LEGACY_FILL;
    return view;
  }
  const { right, up, toward } = basis(view);
  const corners = [];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) corners.push(sub([x, y, z], center));
    }
  }
  const side = Math.min(pane.width, pane.height);
  const required = (perspective, height) => {
    const distance = perspective ? eyeDistance({ height }) : Infinity;
    let needed = 0;
    for (const corner of corners) {
      const ahead = distance - dot(corner, toward);
      const grow = perspective ? (ahead > 0 ? distance / ahead : Infinity) : 1;
      needed = Math.max(needed,
        2 * Math.abs(dot(corner, right)) * grow * side / (FIT_FILL * pane.width),
        2 * Math.abs(dot(corner, up)) * grow * side / (FIT_FILL * pane.height));
    }
    return needed;
  };
  let height = required(false);
  if (view.projection === 'perspective' && height > 0) {
    // Near corners grow as the eye comes closer: the smallest height whose
    // perspective still fits (required(h) - h decreases with h; bisection).
    let low = height;
    let high = height * 2;
    for (let grow = 0; grow < 60 && !(required(true, high) <= high); grow++) high *= 2;
    for (let step = 0; step < 60; step++) {
      const middle = (low + high) / 2;
      if (required(true, middle) <= middle) high = middle;
      else low = middle;
    }
    height = high;
  }
  const limits = heightLimits(pane);
  view.height = clamp(height > 0 ? height : extent / LEGACY_FILL, limits.min, limits.max);
  return view;
}

// The default view: Iso, fitted. Without a pane the legacy fit is used.
export function defaultCamera(bounds, pane, projection = 'orthographic') {
  const base = {
    convention: CONVENTION, projection, target: [0, 0, 0],
    yaw: PRESETS.iso[0], pitch: PRESETS.iso[1], height: 1 / LEGACY_FILL,
  };
  return fit(bounds, base, pane);
}

// Same camera within a relative tolerance (orientation, target, height,
// projection). Legacy cameras are compared in their frame.
export function sameCamera(a, b, frame, tolerance = 1e-7) {
  if (!a || !b) return false;
  const first = worldCamera(a, frame);
  const second = worldCamera(b, frame);
  const size = Math.max(first.height, second.height);
  return first.projection === second.projection
    && Math.abs(first.yaw - second.yaw) < tolerance
    && Math.abs(first.pitch - second.pitch) < tolerance
    && Math.abs(first.height - second.height) <= tolerance * size
    && first.target.every((value, axis) => Math.abs(value - second.target[axis])
      <= tolerance * size);
}
