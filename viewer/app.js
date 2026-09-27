// createViewer(env, { seams, features, failures, legacy }): the composition
// root. It builds the core services, runs every feature's setup(ctx) in
// order and merges what they return:
//
//   api       -> ctx.app (late-bound cross-feature calls; duplicate names throw)
//   legacy    -> { harness: {name: fn}, state: {field: {get, set}} }: VS harness
//                functions and legacy state facade fields
//   defaults  -> store slices (duplicate slices throw)
//   dispose   -> called by viewer.dispose()
//
// seams replace ctx.app functions (the VS harness passes no-ops for
// renderInspector, scheduleDraw, renderAnnotations, renderLibrary,
// renderSaved and panel). Frozen after the foundation; packages add
// features, not code here.
import { createApi } from './core/api.js';
import { createCommands } from './core/commands.js';
import { createDom } from './core/dom.js';
import { createEvents } from './core/events.js';
import * as format from './core/format.js';
import { createHudDock } from './core/hud-dock.js';
import { hydrateIcons } from './core/icons.js';
import { createKeyboard } from './core/keyboard.js';
import { createNotifier } from './core/notify.js';
import { createOverlay } from './core/overlay.js';
import { createPointer } from './core/pointer.js';
import { createRequests } from './core/requests.js';
import { createSettings } from './core/settings.js';
import { createSlots } from './core/slots.js';
import { createFacade, createStore, field } from './core/store.js';
import { createPanes } from './render/panes.js';
import { createPicker } from './render/picking.js';
import { createRenderer } from './render/renderer.js';
import { createSceneCache } from './render/scene-cache.js';

export const HARNESS_FUNCTIONS = Object.freeze([
  'renderInspector', 'loadReview', 'saveReview', 'workspace', 'restoreAnnotation', 'openReport',
  'openSource', 'startupWorkspace', 'pick', 'project', 'viewPanes', 'setLayout', 'renderOverlay',
  'currentView', 'viewMatches', 'annotationAt', 'annotationPoint', 'reviewPayload', 'tool',
  'select', 'loadSelectedModels',
]);
export const FACADE_FIELDS = Object.freeze([
  'after', 'annotations', 'before', 'camera', 'center', 'compare', 'dirty', 'extent', 'hover',
  'hoverPane', 'layout', 'loading', 'mode', 'panel', 'saved', 'saving', 'scenes', 'selection',
  'split', 'workspace',
]);

export function createViewer(env, {
  seams = {}, features = [], failures = [], legacy = false,
  log = (...args) => console.warn(...args),
} = {}) {
  const dom = createDom(env.document);
  const { $ } = dom;
  const canvas = $('#model-canvas');
  hydrateIcons(env.document);
  const store = createStore({ display: {} });
  const cache = createSceneCache();
  const app = {};
  const accessors = {
    scenes: {
      get: () => cache.scenes,
      set: value => {
        cache.scenes.clear();
        for (const [key, scene] of value) cache.scenes.set(key, scene);
      },
    },
  };
  // Live facade: accessors are added as features register them.
  const state = {};
  const defineField = (name, accessor) => {
    if (Object.prototype.hasOwnProperty.call(state, name)) {
      throw new Error(`State facade field ${name} is defined twice`);
    }
    Object.defineProperty(state, name, { get: accessor.get, set: accessor.set, enumerable: true });
  };
  defineField('scenes', accessors.scenes);

  const notifier = createNotifier({ env, dom });
  const commands = createCommands({ dom, log });
  const requests = createRequests(env);
  const api = createApi(env);
  const events = createEvents(env, { enabled: !legacy });
  const slots = createSlots({ env });
  const settings = createSettings({
    api, legacy, onError: error => log('settings:', error.message),
  });
  const panes = createPanes({ canvas, state });
  const picker = createPicker({ state, panes });
  const renderer = createRenderer({ env, canvas, state, cache, panes, picker });
  const overlay = createOverlay({ canvas, element: $('#annotation-overlay') });
  const frameHooks = [];
  let framePending = false;
  Object.assign(app, {
    scheduleDraw() {
      if (framePending) return;
      framePending = true;
      env.requestAnimationFrame(() => {
        framePending = false;
        app.draw();
      });
    },
    draw() {
      renderer.draw();
      for (const hook of frameHooks) hook();
      app.renderOverlay();
    },
    renderOverlay: () => overlay.render(),
  });
  const pointer = createPointer({
    env, canvas, state,
    scheduleDraw: () => app.scheduleDraw(),
    clearHover: () => app.clearHover?.(),
  });
  const keyboard = createKeyboard({ env, dom, commands, canvas, log });
  commands.register({
    id: 'app.escape', label: 'Cancel', keys: ['Escape'], allowWhileTyping: true,
    preventDefault: false, run: event => keyboard.escape(event),
  });
  keyboard.onEscape(() => pointer.cancel(), 0);
  keyboard.onEscape(({ typing }) => {
    if (typing) env.document.activeElement.blur();
  }, 100);

  const ctx = {
    env, dom, store, state, app, api, requests, events, renderer, overlay, slots, commands,
    keyboard, pointer, panes, cache, settings, format, legacy,
    notify: notifier.notify,
    showError: notifier.showError,
    viewportMessage: notifier.viewportMessage,
    copyText: notifier.copyText,
    drawer: {
      open: options => app.openDrawer(options),
      close: () => app.closeDrawer(),
    },
    review: { touch: reason => app.touchReview?.(reason) },
    onFrame: hook => frameHooks.push(hook),
    field: (slice, key, options) => field(store, slice, key, options),
    fields: (slice, keys) => Object.fromEntries(keys.map(key => [key, field(store, slice, key)])),
  };

  const harness = { state };
  const addHarness = (name, fn) => {
    if (Object.prototype.hasOwnProperty.call(harness, name)) {
      throw new Error(`Harness function ${name} is defined twice`);
    }
    harness[name] = (...args) => (app[name] ?? fn)(...args);
  };
  addHarness('pick', picker);
  addHarness('project', panes.project);
  addHarness('viewPanes', panes.viewPanes);
  addHarness('renderOverlay', () => overlay.render());
  Object.assign(app, { pick: picker, project: panes.project, viewPanes: panes.viewPanes });

  const disposers = [];
  const loadFailures = [...failures];
  for (const feature of features) {
    let result;
    try {
      result = feature.setup(ctx) ?? {};
    } catch (error) {
      if (legacy) throw error;
      loadFailures.push({ id: feature.id, error });
      continue;
    }
    for (const [name, fn] of Object.entries(result.api ?? {})) {
      if (Object.prototype.hasOwnProperty.call(app, name)) {
        throw new Error(`Feature ${feature.id} redefines ${name}`);
      }
      app[name] = fn;
    }
    for (const [name, fn] of Object.entries(result.legacy?.harness ?? {})) addHarness(name, fn);
    for (const [name, accessor] of Object.entries(result.legacy?.state ?? {})) {
      defineField(name, accessor);
    }
    for (const [slice, value] of Object.entries(result.defaults ?? {})) {
      const [root, key] = slice.split('.');
      if (key) {
        if (Object.prototype.hasOwnProperty.call(store.get()[root], key)) {
          throw new Error(`Store key ${slice} is defined twice`);
        }
        store.get()[root][key] = value;
      } else store.define(root, value);
    }
    if (result.dispose) disposers.push(result.dispose);
  }
  for (const [name, fn] of Object.entries(seams)) app[name] = fn;
  Object.seal(state);
  if (legacy) {
    const missing = [...HARNESS_FUNCTIONS.filter(name => !harness[name]),
      ...FACADE_FIELDS.filter(name => !(name in state))];
    if (missing.length) throw new Error(`Legacy contract incomplete: ${missing.join(', ')}`);
  }

  for (const { id, error } of loadFailures) {
    log(`Feature ${id} failed to load:`, error);
    if (!slots.list('stage').some(item => item.id === 'viewport-banner')) {
      slots.add('stage', {
        id: 'viewport-banner', order: 5,
        html: '<div class="viewport-banner" role="alert" data-slot="viewportBanner.item"></div>',
      });
    }
    slots.viewportBanner.item({
      id: `feature-${id}`, order: 10,
      html: `<p class="viewport-banner-item">Feature ${id} failed to load</p>`,
    });
  }
  keyboard.install();
  // Floating stage controls follow the height of the bottom status line.
  disposers.push(createHudDock(env, dom));

  return {
    harness,
    ctx,
    failures: loadFailures,
    // Debug handle (window.wonkyViewer): the harness plus core services.
    debug: { ...harness, store, commands, renderer, slots, app, settings },
    start() {
      try {
        renderer.init();
        renderer.onContextLost(() => {
          app.clearHover?.();
          notifier.viewportMessage('3D display was interrupted',
            'Restoring the view… If it does not come back, save any notes and reload.');
        });
      } catch (error) {
        notifier.viewportMessage('3D display unavailable', error.message);
      }
      app.renderInspector?.();
      app.renderAnnotations?.();
      app.tool?.('select');
      if (!legacy) settings.load();
      app.startupWorkspace?.().catch(error => {
        notifier.viewportMessage('Workspace unavailable', error.message, true);
        notifier.showError(error);
      });
    },
    dispose() {
      for (const dispose of disposers.reverse()) dispose();
      events.close();
    },
  };
}
