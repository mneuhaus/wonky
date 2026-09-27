// Which view an annotation belongs to (harness: currentView, viewMatches).
// Owner: camera-navigation (W1).
//
// Cameras are compared as world cameras (render/camera.js, convention 2). A
// legacy annotation camera {yaw, pitch, zoom, pan} is read in the current
// bounds frame, exactly as restoring it does, so a restored legacy view
// matches its annotations.
//
// currentView() records `cameraConvention: 2`: screen-space drawings made now
// are drawn on the right-handed view, whatever form the facade camera has.
// render/panes.js (legacyDrawing) reads it together with the camera form.
import { CONVENTION, sameCamera } from '../../render/camera.js';
import { comparisonLayout } from '../../render/panes.js';

export function createViewMatch({ state, canvas }) {
  const frame = () => ({ center: state.center, extent: state.extent });
  function currentView() {
    return {
      before: state.before, after: state.after, split: state.split, compare: state.compare,
      layout: state.layout, aspect: canvas.clientWidth / Math.max(1, canvas.clientHeight),
      cameraConvention: CONVENTION,
    };
  }
  function viewMatches(annotation) {
    const view = annotation.view;
    if (!sameCamera(annotation.camera, state.camera, frame())) return false;
    if (!view) return true;
    if (view.after !== state.after || view.compare !== state.compare) return false;
    if (!view.compare) return true;
    return view.before === state.before && comparisonLayout(view.layout) === state.layout
      && (state.layout === 'side-by-side' || Math.abs(view.split - state.split) < 1e-7);
  }
  return { currentView, viewMatches };
}
