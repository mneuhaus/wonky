// Review camera validation for both camera conventions (spec D6, 7.1).
//
// Legacy (convention 1, no `convention` key): the bounds-relative camera
// {yaw, pitch, zoom, pan} of reviews saved before the handedness fix. The
// rules are unchanged: finite yaw/pitch/zoom, 0 < zoom <= 100, pan of two
// finite numbers. Legacy files are never rewritten.
//
// Convention 2: the world camera of viewer/render/camera.js
// {convention: 2, projection, target: [x, y, z] mm, yaw, pitch, height}.
// A review whose camera is convention 2 records `cameraConvention: 2`.
export const CAMERA_CONVENTION = 2;
const PROJECTIONS = new Set(['orthographic', 'perspective']);
// height: mm spanned by the shorter pane side; the viewer limits zoom to
// 1 µm..10 m per CSS px, so any real pane stays well inside these bounds.
const HEIGHT_MIN = 1e-9;
const HEIGHT_MAX = 1e9;
// Coordinates beyond ±1000 km are not a CAD camera.
const TARGET_MAX = 1e9;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const invalid = () => new Error('Invalid review camera');

export function validateLegacyCamera(value) {
  if (!value || !['yaw', 'pitch', 'zoom'].every(key => finite(value[key]))
    || value.zoom <= 0 || value.zoom > 100
    || !Array.isArray(value.pan) || value.pan.length !== 2 || !value.pan.every(finite)) {
    throw invalid();
  }
  return { yaw: value.yaw, pitch: value.pitch, zoom: value.zoom, pan: [...value.pan] };
}

export function validateWorldCamera(value) {
  if (!value || value.convention !== CAMERA_CONVENTION || !PROJECTIONS.has(value.projection)
    || !finite(value.yaw) || !finite(value.pitch) || !finite(value.height)
    || value.height < HEIGHT_MIN || value.height > HEIGHT_MAX
    || !Array.isArray(value.target) || value.target.length !== 3
    || !value.target.every(item => finite(item) && Math.abs(item) <= TARGET_MAX)) {
    throw invalid();
  }
  return {
    convention: CAMERA_CONVENTION, projection: value.projection, target: [...value.target],
    yaw: value.yaw, pitch: value.pitch, height: value.height,
  };
}

// Either convention; the key `convention` decides (absent = legacy).
export function validateReviewCamera(value) {
  if (value && typeof value === 'object' && 'convention' in value) {
    return validateWorldCamera(value);
  }
  return validateLegacyCamera(value);
}

// The review-level marker: {cameraConvention: 2} for a review whose camera is
// convention 2, {} for a legacy review (old files keep their shape).
export function cameraConventionField(camera) {
  return camera?.convention === CAMERA_CONVENTION ? { cameraConvention: CAMERA_CONVENTION } : {};
}
