// Viewport panes (pure), the bound pane helpers used by the harness, and the
// legacy drawing rule for annotations saved on the mirrored view (spec D6).
//
// Pane shape (frozen): { x, y, width, height, clipX, clipWidth, modelId, side },
// plus `members` on the single pane of a workspace node (an assembly or a
// placed model: [{ instance, key, modelId, matrix }], render/placement.js);
// `modelId` stays the active model then. No `members` (null): the pane draws
// and picks `modelId`; `members: []` (every instance hidden): nothing.
// Single: one pane for `after`. Wipe: two full-width panes clipped at the
// split. Side by side: two half-width panes. Every pane shares one camera:
// the world camera (render/camera.js, convention 2) of the state facade.
import {
  CONVENTION, depthPerPixel, isWorldCamera, pixelsPerMm, project, unproject, worldCamera,
} from './camera.js';

export const comparisonLayout = value => (value === 'side-by-side' ? 'side-by-side' : 'wipe');

export function computePanes({
  width, height, compare, layout, split, before, after, members = null,
}) {
  const pane = (modelId, side, x, paneWidth, clipX, clipWidth) => ({
    x, y: 0, width: paneWidth, height, clipX, clipWidth, modelId, side,
  });
  if (!compare) {
    const single = pane(after, 'after', 0, width, 0, width);
    if (members) single.members = members;
    return [single];
  }
  if (layout === 'side-by-side') {
    return ['before', 'after'].map((side, index) => pane(side === 'before' ? before : after, side,
      index * width / 2, width / 2, index * width / 2, width / 2));
  }
  return [
    pane(before, 'before', 0, width, 0, width * split),
    pane(after, 'after', 0, width, width * split, width * (1 - split)),
  ];
}

export function paneAt(panes, height, x, y = height / 2) {
  if (y < 0 || y >= height) return null;
  return panes.find(pane => x >= pane.clipX && x < pane.clipX + pane.clipWidth) ?? null;
}

// How an annotation's screen-space drawing is shown (spec D6):
//   'current'  drawn on a convention-2 view (its camera is a world camera,
//              or its view records cameraConvention 2)
//   'mirrored' legacy drawing in single or side-by-side mode, or in wipe mode
//              over one model: mirrored in X within its pane, which puts it
//              back over the same geometry
//   'hidden'   legacy drawing in wipe mode over two different models: the
//              two halves swap sides, so it cannot be re-projected
export function legacyDrawing(annotation) {
  if (isWorldCamera(annotation?.camera)) return 'current';
  const view = annotation?.view;
  if (view?.cameraConvention === CONVENTION) return 'current';
  if (view?.compare && comparisonLayout(view.layout) === 'wipe' && view.before !== view.after) {
    return 'hidden';
  }
  return 'mirrored';
}

export const LEGACY_WIPE_NOTE = 'Drawn on the legacy mirrored wipe view; cannot be re-projected';

// A normalized legacy point mirrored in X within its pane (side by side: the
// half it lies in; otherwise the whole viewport).
export function mirrorLegacyPoint(point, annotation) {
  const paired = annotation?.view?.compare
    && comparisonLayout(annotation.view.layout) === 'side-by-side';
  const center = paired ? (point[0] < 0.5 ? 0.25 : 0.75) : 0.5;
  return [2 * center - point[0], point[1]];
}

// Pane helpers bound to the canvas size and the legacy state facade. The
// facade holds a world camera; a legacy {yaw, pitch, zoom, pan} camera (only
// while an old view feature writes one) is read in the bounds frame.
export function createPanes({ canvas, state }) {
  // Workspace members of the single pane (features/workspace sets this).
  let membersOf = () => null;
  const viewPanes = () => computePanes({
    width: canvas.clientWidth, height: canvas.clientHeight, compare: state.compare,
    layout: state.layout, split: state.split, before: state.before, after: state.after,
    members: membersOf(),
  });
  const camera = () => worldCamera(state.camera, { center: state.center, extent: state.extent });
  return {
    viewPanes,
    setMembers(provider) {
      membersOf = provider ?? (() => null);
    },
    paneAt: (x, y = canvas.clientHeight / 2) => paneAt(viewPanes(), canvas.clientHeight, x, y),
    // The world camera every pane shares (convention 2).
    camera,
    project: (point, pane = viewPanes()[0]) => project(point, camera(), pane),
    unproject: (x, y, depth, pane = viewPanes()[0]) => unproject(x, y, depth, camera(), pane),
    // px per mm at the target plane (all panes share one scale).
    factor: (pane = viewPanes()[0]) => pixelsPerMm(camera(), pane),
    depthPerPixel: (pane = viewPanes()[0]) => depthPerPixel(camera(), pane),
  };
}
