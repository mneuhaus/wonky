// Browser entry: loads every feature in isolation, composes the viewer,
// exposes window.wonkyViewer (debug handle) and starts it.
import { createViewer } from './app.js';
import { loadFeatures } from './core/feature-loader.js';
import { FEATURES } from './features/index.js';

const bind = name => window[name].bind(window);
const env = {
  window,
  document,
  fetch: bind('fetch'),
  history: window.history,
  location: window.location,
  navigator: window.navigator,
  requestAnimationFrame: bind('requestAnimationFrame'),
  setTimeout: bind('setTimeout'),
  clearTimeout: bind('clearTimeout'),
  ResizeObserver: window.ResizeObserver,
  URLSearchParams: window.URLSearchParams,
  AbortController: window.AbortController,
  EventSource: window.EventSource,
};

const { features, failures } = await loadFeatures(FEATURES);
const viewer = createViewer(env, { features, failures });
window.wonkyViewer = viewer.debug;
viewer.start();
