// Ordered feature list. Order is setup order, slot order ties and the CSS
// cascade order in index.html. `legacy: true` marks the feature set the
// VS harness (test/viewer-state.test.mjs) preloads.
export const FEATURES = Object.freeze([
  { id: 'library', legacy: true, load: () => import('./library/library.js') },
  { id: 'compare', legacy: true, load: () => import('./compare/compare.js') },
  { id: 'selection', legacy: true, load: () => import('./selection/selection.js') },
  { id: 'inspector', legacy: true, load: () => import('./inspector/inspector.js') },
  { id: 'annotations', legacy: true, load: () => import('./annotations/annotations.js') },
  { id: 'reviews', legacy: true, load: () => import('./reviews/reviews.js') },
  { id: 'reports', legacy: true, load: () => import('./reports/reports.js') },
  { id: 'drawer', legacy: true, load: () => import('./drawer/drawer.js') },
  { id: 'source', legacy: true, load: () => import('./source/source.js') },
  { id: 'view', legacy: true, load: () => import('./view/view.js') },
  { id: 'display', legacy: false, load: () => import('./display/display.js') },
  { id: 'live', legacy: false, load: () => import('./live/live.js') },
  { id: 'measure', legacy: false, load: () => import('./measure/measure.js') },
  { id: 'parts', legacy: false, load: () => import('./parts/parts.js') },
  { id: 'workspace', legacy: false, load: () => import('./workspace/workspace.js') },
  { id: 'fdm', legacy: false, load: () => import('./fdm/fdm.js') },
  { id: 'section', legacy: false, load: () => import('./section/section.js') },
  { id: 'diff', legacy: false, load: () => import('./diff/diff.js') },
  { id: 'thickness', legacy: false, load: () => import('./thickness/thickness.js') },
  { id: 'help', legacy: false, load: () => import('./help/help.js') },
]);

export const LEGACY_FEATURES = Object.freeze(FEATURES.filter(feature => feature.legacy));
