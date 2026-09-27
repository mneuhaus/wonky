// View feature (id 'view'): the world camera (render/camera.js, convention 2)
// and everything that moves or shows it. Owner: camera-navigation (W1).
//
// State facade: camera, center, extent, preset. Assigning a legacy
// {yaw, pitch, zoom, pan} camera converts it in the bounds frame
// {center, extent} with fromLegacy (same eye direction, spec D6); a center or
// extent assigned in the same turn re-anchors it (VS assigns all three).
// Assigning defaultLegacyCamera() (the model loader does after loading)
// applies the fit policy (spec D13):
//   - first model of the session: the camera saved for its source
//     (settings scope S), else the default view (Iso, fitted);
//   - another revision of the same source: the camera is kept exactly;
//   - a model from another source: fit, keeping the orientation.
// The camera never marks a review dirty (spec D9, NAV-07 changed).
//
// Keys (spec 5): digits match event.code, so the number row, the numpad with
// NumLock on or off and Shift+1..7 all work on QWERTZ. core/keyboard.js
// matches event.key only, so a capture listener on window handles Digit* and
// Numpad* codes and stops them before the core dispatch; the commands are
// still registered (code-named keys such as 'Digit1') for help and conflict
// checks. Arrows go through the core (canvas scope).
import { clamp } from '../../core/dom.js';
import {
  basis, copyCamera, DEFAULT_CAMERA, defaultCamera, fit, fromLegacy, isWorldCamera, orbit, panBy,
  preset, presetOf, PRESET_NAMES, project, unionBox, VIEWS, worldCamera, zoomAt,
} from '../../render/camera.js';
import { LEGACY_WIPE_NOTE, legacyDrawing } from '../../render/panes.js';
import { createViewMatch } from './view-match.js';
import { createViewMenu, menuMarkup } from './view-menu.js';
import { describeAxes, originMarkup, triadMarkup } from './triad.js';

export const id = 'view';
export const legacy = true;

const PROJECTION_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  + ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M3 17.5 8.5 6.5h7l5.5 11Z"/><path d="M8.5 6.5 12 17.5 15.5 6.5"/></svg>';
const ACTIONS = [
  ['toggle-edges', 10, '<button id="toggle-edges" class="icon-button" aria-pressed="true"'
    + ' title="Show edges (E)" aria-label="Show edges" data-icon="edges"></button>'],
  ['fit-view', 20, '<button id="fit-view" class="icon-button"'
    + ' title="Fit, keeping the orientation (F)" aria-label="Fit model" data-icon="fit">'
    + '</button>'],
  ['view-presets', 30, '<button id="view-presets" class="icon-button" title="Views (1-8,'
    + ' Shift+1-7, 0)" aria-label="Views" aria-haspopup="menu" aria-expanded="false"'
    + ' aria-controls="view-menu" data-icon="cube"></button>'],
  ['toggle-projection', 40, '<button id="toggle-projection" class="icon-button"'
    + ' aria-pressed="false" title="Perspective (O)" aria-label="Perspective projection">'
    + `${PROJECTION_ICON}</button>`],
];
const TRIAD = '<div id="view-triad" class="view-triad" role="img" aria-label="Axis triad"></div>';
const LEGEND = '<button id="projection-legend" class="projection-legend" type="button"'
  + ' title="Orthographic or perspective (O)">Orthographic</button>';
const LEGACY_NOTE = '<p id="legacy-drawings-note" class="legacy-drawings-note" role="status"'
  + ' hidden></p>';

const DEGREE = Math.PI / 180;
const ORBIT_RATE = 0.008;
const ARROW_PAN_PX = 40;
const PERSIST_DELAY_MS = 600;
// OCP numpad layout on digits and the numpad; Onshape order on Shift+1..7.
const DIGIT_VIEWS = Object.freeze({
  0: 'default', 1: 'front', 2: 'bottom', 3: 'back', 4: 'left', 5: 'iso', 6: 'right', 8: 'top',
});
const SHIFT_VIEWS = Object.freeze({
  1: 'front', 2: 'back', 3: 'left', 4: 'right', 5: 'top', 6: 'bottom', 7: 'iso',
});
const ARROWS = Object.freeze({
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
});
const MODEL_ID = /^[a-f0-9]{64}$/;
const SETTINGS = [
  { id: 'view.projection', order: 20, label: 'Projection', scope: 'G', key: 'projection',
    type: 'choice', choices: ['orthographic', 'perspective'], default: 'orthographic' },
  { id: 'view.trackpadMode', order: 30, label: 'Trackpad mode', scope: 'G',
    key: 'trackpadMode', type: 'boolean', default: false,
    description: 'Two-finger scroll pans; pinch zooms toward the cursor' },
];
const digitOf = (table, name) => Object.keys(table).find(key => table[key] === name);

export function setup(ctx) {
  const { state, app, store, slots, commands, keyboard, pointer, panes, env, dom } = ctx;
  const { $ } = dom;
  const canvas = $('#model-canvas');
  for (const [name, order, markup] of ACTIONS) {
    slots.viewActions.button({ id: `view.${name}`, order, html: markup });
  }
  slots.viewActions.button({ id: 'view.menu', order: 31, html: menuMarkup() });
  slots.add('stage', { id: 'view.triad', order: 25, html: TRIAD });
  slots.add('stage', { id: 'view.legacyNote', order: 61, html: LEGACY_NOTE });
  slots.statusBar.item({ id: 'view.projection', order: 80, html: LEGEND });
  for (const item of SETTINGS) slots.settings.item(item);

  const { currentView, viewMatches } = createViewMatch({ state, canvas });
  const menu = createViewMenu({ env, dom, keyboard, commands });
  const unbindMenu = menu.bind();

  // ---- Camera state ----
  const view = () => store.get().view;
  const frame = () => ({ center: state.center, extent: state.extent });
  const mainPane = () => panes.viewPanes()[0];
  let pendingLegacy = null;
  // Where the current camera came from: 'initial', 'policy' (automatic fit),
  // 'restored' (saved camera of the source), 'assigned' (review, annotation),
  // 'user' (navigation, views, fit, projection).
  let provenance = 'initial';
  let cameraSource = null;
  // The sources on screen (after, plus before in compare mode): a change of
  // this set refits, so a before model from another source is framed too.
  let cameraScope = null;
  let initialDefault = false;
  let projectionTouched = false;

  function setCamera(next, { from = 'user', reason = 'view.camera', presetName = null } = {}) {
    store.update(reason, current => {
      current.view.camera = next;
      current.view.preset = presetName;
    });
    provenance = from;
    if (from !== 'policy') initialDefault = false;
    if (from === 'user') schedulePersist();
  }
  const camera = () => worldCamera(view().camera, frame());

  const cameraField = {
    get: () => view().camera,
    set(value) {
      if (value?.[DEFAULT_CAMERA]) {
        applyModelPolicy();
        return;
      }
      if (isWorldCamera(value)) pendingLegacy = null;
      else {
        pendingLegacy = JSON.parse(JSON.stringify(value));
        Promise.resolve().then(() => {
          pendingLegacy = null;
        });
      }
      setCamera(copyCamera(worldCamera(value, frame())), { from: 'assigned' });
      cameraSource = sourceOf(state.after);
      cameraScope = displayedScope();
    },
  };
  const frameField = key => ({
    get: () => view()[key],
    set(value) {
      store.update(`view.${key}`, current => {
        current.view[key] = value;
      });
      if (pendingLegacy) setCamera(fromLegacy(pendingLegacy, frame()), { from: 'assigned' });
    },
  });

  // ---- Sources, bounds and the fit policy ----
  // The settings key of a model's source: the library's source key (live
  // source path or .brep.json input path). Archived snapshots have none (they
  // share one library group across sources), so each counts as its own
  // source, keyed by its model id, and is never persisted.
  const workspaceModel = modelId => state.workspace?.models?.find(item => item.id === modelId);
  const sourceOf = modelId => (modelId ? app.sourceKey?.(modelId) || modelId : null);
  const displayedIds = () => [...new Set(state.compare ? [state.before, state.after]
    : [state.after])].filter(Boolean);
  const displayedScope = () => [...new Set(displayedIds().map(sourceOf))].sort().join('\n');
  // Bounds of the displayed models: JSON scene, else workspace metadata, else
  // the shared frame the model loader computed.
  // An open workspace node (features/workspace) brings the placed bounds of
  // its visible members.
  function displayedBox() {
    const boxes = displayedIds().map(item => state.scenes.get(item)?.bounds
      ?? ctx.renderer?.bounds?.(item) ?? workspaceModel(item)?.bounds);
    const members = app.workspaceBoxes?.();
    if (members?.length) return unionBox(members);
    const box = unionBox(boxes);
    if (box || !state.center || !(state.extent > 0)) return box;
    return {
      min: state.center.map(value => value - state.extent / 2),
      max: state.center.map(value => value + state.extent / 2),
    };
  }
  const globalProjection = () => (ctx.settings.get('G', 'projection', 'orthographic')
    === 'perspective' ? 'perspective' : 'orthographic');

  // Projection is a global setting; within a session the camera carries it.
  const sessionProjection = () => (provenance === 'initial' ? globalProjection()
    : camera().projection);

  function savedCamera(source) {
    const saved = source ? ctx.settings.get('S', 'camera', null, { source }) : null;
    const valid = isWorldCamera(saved) && [saved.yaw, saved.pitch, saved.height, ...saved.target]
      .every(Number.isFinite) && saved.height > 0;
    return valid ? { ...copyCamera(saved), projection: sessionProjection() } : null;
  }

  function applyModelPolicy() {
    pendingLegacy = null;
    const source = sourceOf(state.after);
    const scope = displayedScope();
    const current = camera();
    if (provenance === 'initial' || cameraSource === null) {
      const saved = savedCamera(source);
      const next = saved ?? defaultCamera(displayedBox(), mainPane(), sessionProjection());
      cameraSource = source;
      cameraScope = scope;
      setCamera(next, { from: saved ? 'restored' : 'policy', reason: 'view.policy' });
      initialDefault = !saved;
      return;
    }
    // Revisions of the shown sources keep the camera exactly (D13); another
    // source, as the model or as the compare before model, is fitted with
    // the orientation kept. In a workspace (one shared frame) switching
    // between its models and assemblies never refits (F still fits).
    if (source === cameraSource && scope === cameraScope) return;
    if (app.workspaceKeepsCamera?.()) {
      if (source !== cameraSource) flushPersist();
      cameraSource = source;
      cameraScope = scope;
      return;
    }
    if (source !== cameraSource) flushPersist();
    cameraSource = source;
    cameraScope = scope;
    setCamera(fit(displayedBox(), current, mainPane()), { from: 'policy', reason: 'view.policy' });
  }

  // Settings arrive after the first model may already show: restore the
  // saved camera if the view is still the untouched first default. Later, a
  // changed projection setting (the Settings dialog) applies at once; the O
  // key writes the same setting, which then already matches the camera.
  let settingsSeen = false;
  let seenProjection = null;
  const applyProjection = projection => {
    if (camera().projection === projection) return;
    setCamera({ ...copyCamera(camera()), projection },
      { from: provenance, reason: 'view.projection' });
  };
  ctx.settings.onChange?.(() => {
    if (!ctx.settings.loaded?.()) return;
    const projection = globalProjection();
    if (settingsSeen) {
      if (projection === seenProjection) return;
      seenProjection = projection;
      applyProjection(projection);
      app.scheduleDraw();
      return;
    }
    settingsSeen = true;
    seenProjection = projection;
    if (initialDefault && provenance === 'policy') {
      const saved = savedCamera(cameraSource);
      if (saved) setCamera(saved, { from: 'restored', reason: 'view.restore' });
    }
    if (!projectionTouched) applyProjection(projection);
    app.scheduleDraw();
  });

  // ---- Persistence (scope S: last camera per source) ----
  let saveTimer = null;
  let pendingSave = null;
  // Sources without a stable path (archived snapshots: the model id) are not
  // persisted, so the settings file does not grow per revision.
  function schedulePersist() {
    if (!cameraSource || MODEL_ID.test(cameraSource)) return;
    pendingSave = { source: cameraSource, camera: copyCamera(camera()) };
    env.clearTimeout(saveTimer);
    saveTimer = env.setTimeout(flushPersist, PERSIST_DELAY_MS);
  }
  function flushPersist({ unloading = false } = {}) {
    env.clearTimeout(saveTimer);
    if (!pendingSave) return;
    const { source, camera: saved } = pendingSave;
    pendingSave = null;
    if (unloading && !ctx.legacy) {
      // The page is going away: a normal request would be cancelled with it.
      // keepalive delivers the same settings patch (PUT /api/settings merges).
      ctx.api.put('/api/settings', { sources: { [source]: { camera: saved } } },
        { keepalive: true }).catch(() => {});
      return;
    }
    ctx.settings.set('S', 'camera', saved, { source });
  }
  const onPageHide = () => flushPersist({ unloading: true });
  env.window.addEventListener?.('pagehide', onPageHide);

  // ---- Commands ----
  const moved = () => {
    app.clearHover();
    app.scheduleDraw();
  };
  function applyPreset(name) {
    setCamera(preset(name, camera()), { presetName: name, reason: 'view.preset' });
    moved();
  }
  function fitView() {
    setCamera(fit(displayedBox(), camera(), mainPane()), { reason: 'view.fit' });
    moved();
  }
  // Whether every corner of the displayed models' box lies inside the main
  // pane at the current camera (null without bounds or a pane).
  function modelFits() {
    const box = displayedBox();
    const pane = mainPane();
    if (!box || !pane || !(pane.width > 0) || !(pane.height > 0)) return null;
    const view = camera();
    for (const x of [box.min[0], box.max[0]]) {
      for (const y of [box.min[1], box.max[1]]) {
        for (const z of [box.min[2], box.max[2]]) {
          const point = project([x, y, z], view, pane);
          if (!(point.x >= pane.x - 1 && point.x <= pane.x + pane.width + 1
            && point.y >= pane.y - 1 && point.y <= pane.y + pane.height + 1)) return false;
        }
      }
    }
    return true;
  }

  function defaultView() {
    setCamera(defaultCamera(displayedBox(), mainPane(), camera().projection),
      { presetName: 'iso', reason: 'view.default' });
    moved();
  }
  function toggleProjection() {
    const next = camera().projection === 'perspective' ? 'orthographic' : 'perspective';
    projectionTouched = true;
    setCamera({ ...copyCamera(camera()), projection: next },
      { presetName: view().preset, reason: 'view.projection' });
    ctx.settings.set('G', 'projection', next);
    moved();
  }
  function toggleEdges() {
    const visible = !store.get().display.edges.visible;
    store.update('display.edges', current => {
      current.display.edges.visible = visible;
    });
    $('#toggle-edges').setAttribute('aria-pressed', String(visible));
    app.scheduleDraw();
  }
  function arrowStep(horizontal, vertical, event = {}) {
    // Mod+Arrow bindings fire in any scope; numpad arrows (NumLock off) are views.
    if (env.document.activeElement !== canvas || /^Numpad/.test(event.code ?? '')) return;
    event.preventDefault?.();
    const fine = event.ctrlKey || event.metaKey;
    if (fine && event.shiftKey) {
      setCamera(panBy(camera(), mainPane(), horizontal * ARROW_PAN_PX,
        -vertical * ARROW_PAN_PX), { reason: 'view.pan' });
    } else {
      const step = (event.shiftKey ? 90 : fine ? 5 : 15) * DEGREE;
      setCamera(orbit(camera(), horizontal * step, vertical * step), { reason: 'view.orbit' });
    }
    moved();
  }

  for (const name of PRESET_NAMES) {
    const digit = digitOf(DIGIT_VIEWS, name);
    commands.register({
      id: `view.${name}`, label: `${VIEWS[name].label} view`,
      keys: [`Digit${digit}`, `Numpad${digit}`, `Shift+Digit${digitOf(SHIFT_VIEWS, name)}`],
      run: () => applyPreset(name),
    });
  }
  commands.register({
    id: 'view.default', label: 'Default view', keys: ['Home', 'Digit0', 'Numpad0'],
    preventDefault: false,
    run: event => {
      if (event?.defaultPrevented) return;
      event?.preventDefault?.();
      defaultView();
    },
  });
  commands.register({ id: 'view.fit', label: 'Fit, keeping the orientation', keys: ['F'],
    run: fitView });
  commands.register({ id: 'view.projection', label: 'Orthographic or perspective', keys: ['O'],
    run: toggleProjection });
  commands.register({
    id: 'view.menu', label: 'Views menu',
    run: event => {
      app.clearHover();
      menu.toggle(event);
    },
  });
  commands.register({ id: 'view.toggleEdges', label: 'Show edges', keys: ['E'], run: toggleEdges });
  commands.register({
    id: 'view.trackpadMode', label: 'Trackpad mode (two-finger scroll pans)',
    run: () => ctx.settings.set('G', 'trackpadMode', !trackpadMode()),
  });
  for (const [key, [horizontal, vertical]] of Object.entries(ARROWS)) {
    commands.register({
      id: `view.orbit.${key}`, label: `Orbit ${key.slice(5).toLowerCase()} 15° (Ctrl 5°,`
        + ' Shift 90°, Ctrl+Shift pans)',
      keys: [key, `Shift+${key}`, `Mod+${key}`, `Mod+Shift+${key}`], scope: 'canvas',
      preventDefault: false, run: event => arrowStep(horizontal, vertical, event),
    });
  }
  commands.bind('#toggle-edges', 'view.toggleEdges');
  commands.bind('#fit-view', 'view.fit');
  commands.bind('#view-presets', 'view.menu');
  commands.bind('#toggle-projection', 'view.projection');
  commands.bind('#projection-legend', 'view.projection');

  // Digit and numpad codes (see the header).
  function onKeydown(event) {
    const match = /^(Digit|Numpad)([0-9])$/.exec(event.code ?? '');
    if (!match || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (keyboard.typing()) return;
    const digit = Number(match[2]);
    // The numpad ignores Shift (Windows sends Shift+Numpad as navigation keys).
    const numpad = match[1] === 'Numpad';
    const name = event.shiftKey && !numpad ? SHIFT_VIEWS[digit] : DIGIT_VIEWS[digit];
    // Unmapped numpad keys (7 and 9; Home/PageUp with NumLock off) do nothing.
    if (!name && !numpad) return;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    if (!name) return;
    menu.close();
    commands.run(`view.${name}`);
  }
  env.window.addEventListener?.('keydown', onKeydown, true);

  // ---- Pointer ----
  const trackpadMode = () => ctx.settings.get('G', 'trackpadMode', false) === true;
  pointer.onNavigate(({ dx, dy, pan }) => {
    const next = pan ? panBy(camera(), mainPane(), dx, dy)
      : orbit(camera(), dx * ORBIT_RATE, -dy * ORBIT_RATE);
    setCamera(next, { reason: pan ? 'view.pan' : 'view.orbit' });
  });

  // Zoom anchor depth. Orthographic: 0 (every point of the cursor ray stays,
  // the orbit pivot keeps its depth). Perspective: the model point under the
  // cursor (display pick, face mode) stays; without a hit, the target plane.
  // Zooming keeps that world point under the cursor, so the pick is reused
  // while the cursor rests and nothing else moved the camera: one pick (and
  // one picker projection) per wheel gesture, not per wheel event.
  let wheelAnchor = null;
  function anchorDepth(point, current) {
    if (current.projection !== 'perspective') return 0;
    const reuse = wheelAnchor && wheelAnchor.camera === view().camera
      && Math.abs(wheelAnchor.x - point.x) < 0.5 && Math.abs(wheelAnchor.y - point.y) < 0.5;
    const world = reuse ? wheelAnchor.world
      : ctx.renderer?.pickDetail?.(point.x, point.y, 'face')?.point ?? null;
    wheelAnchor = world ? { x: point.x, y: point.y, world } : null;
    if (!world) return 0;
    const { toward } = basis(current);
    return world.reduce((sum, value, axis) => sum + (value - current.target[axis]) * toward[axis],
      0);
  }
  pointer.onWheel(event => {
    event.preventDefault();
    app.clearHover();
    const point = pointer.pointFromEvent(event);
    const pane = panes.paneAt(point.x, point.y) ?? mainPane();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const dx = (event.deltaX ?? 0) * unit;
    const dy = (event.deltaY ?? 0) * unit;
    const current = camera();
    if (trackpadMode() && !event.ctrlKey) {
      setCamera(panBy(current, pane, -dx, -dy), { reason: 'view.pan' });
    } else {
      const factor = Math.exp(clamp(dy * (event.ctrlKey ? 0.01 : 0.001), -2, 2));
      const depth = anchorDepth(point, current);
      setCamera(zoomAt(current, pane, point.x, point.y, factor, depth), { reason: 'view.zoom' });
      if (wheelAnchor) wheelAnchor.camera = view().camera;
    }
    app.scheduleDraw();
  });
  new env.ResizeObserver(() => {
    app.clearHover();
    app.scheduleDraw();
  }).observe(canvas);

  // ---- HUD: triad, legend, origin marker, legacy note ----
  let shownOrientation = '';
  let shownLegend = '';
  ctx.onFrame(() => {
    const current = camera();
    const orientation = `${current.yaw}:${current.pitch}`;
    if (orientation !== shownOrientation) {
      shownOrientation = orientation;
      const triad = $('#view-triad');
      triad.innerHTML = triadMarkup(current);
      triad.setAttribute('aria-label', `Axis triad: ${describeAxes(current)}`);
    }
    const perspective = current.projection === 'perspective';
    const named = presetOf(current);
    const legend = `${perspective ? 'Perspective 35°' : 'Orthographic'}`
      + `${named ? ` · ${VIEWS[named].label}` : ''}`;
    if (legend !== shownLegend) {
      shownLegend = legend;
      $('#projection-legend').textContent = legend;
      $('#toggle-projection').setAttribute('aria-pressed', String(perspective));
      menu.setProjection(perspective);
    }
  });
  ctx.overlay.layer({
    id: 'view.origin',
    order: 5,
    render: ({ height }) => (state.after ? originMarkup({
      camera: camera(), panes: panes.viewPanes(), project: panes.project, height,
    }) : ''),
  });
  ctx.overlay.layer({
    id: 'view.legacyNote',
    order: 90,
    render: () => '',
    after() {
      const hidden = state.annotations.filter(annotation => legacyDrawing(annotation) === 'hidden'
        && viewMatches(annotation)).length;
      const note = $('#legacy-drawings-note');
      note.hidden = hidden === 0;
      note.textContent = hidden
        ? `${hidden} ${hidden === 1 ? 'drawing' : 'drawings'} hidden. ${LEGACY_WIPE_NOTE}.`
        : '';
    },
  });

  return {
    api: {
      fit: fitView, modelFits, defaultView, applyPreset, toggleProjection, currentView,
      viewMatches,
      viewCamera: camera, applyCameraPolicy: applyModelPolicy,
      // 'initial' | 'policy' | 'restored' | 'assigned' | 'user' (see above).
      cameraProvenance: () => provenance,
    },
    legacy: {
      harness: { currentView, viewMatches },
      state: {
        camera: cameraField,
        center: frameField('center'),
        extent: frameField('extent'),
        preset: ctx.field('view', 'preset'),
      },
    },
    defaults: {
      view: { camera: defaultCamera(null), center: [0, 0, 0], extent: 1, preset: null },
      'display.edges': { visible: true },
    },
    dispose() {
      flushPersist();
      env.window.removeEventListener?.('keydown', onKeydown, true);
      env.window.removeEventListener?.('pagehide', onPageHide);
      unbindMenu();
      menu.close();
    },
  };
}
