// Section feature (package: section, spec 4, 5, 6 and 9.2).
//
//   X               section on/off: one display clip plane by default, up to
//                   three (plane tabs); position slider and mm field, axis
//                   X/Y/Z (the side facing the camera is cut away), flip,
//                   "From view" (normal = view direction, same plane point)
//   caps            parity (stencil-technique) caps in the body color, labelled
//                   "display section ±<display tolerance>"; bodies with
//                   boundary-only faces are listed "cap unavailable"
//                   (section-caps.js)
//   picking         the renderer and the picker skip the clipped-away side
//                   (style.clipPlanes, composed from display.section)
//   Exact contour   POST /api/models/:id/section through the query worker,
//                   latest wins (a newer request, a moved plane or another
//                   model aborts the older one); kernel contours drawn as
//                   lines, failures shown verbatim with their reason chain
//
// Store: `section` (this feature's state) and `display.section` ({ planes:
// [{ origin, normal }] }, the only style key it writes). Settings: S
// `section` = { on, active, planes: [{ normal, offset, enabled }] } per
// source (spec 6: off; one plane; last plane position).
// Debug and QA handle (window.wonkyViewer.app): sectionState(),
// sectionStats(), setSectionPlanes(planes, options), sectionExact(),
// sectionNormalFromView(), sectionDebugGap(px | null).
import { escape } from '../../core/dom.js';
import { basis } from '../../render/camera.js';
import { MAX_CLIP_PLANES } from '../../render/shaders.js';
import {
  bodyBounds, capAvailability, createCapRenderer, planesMeetBox,
} from './section-caps.js';
import { localPlanes } from '../../render/placement.js';

export const id = 'section';
export const legacy = false;

export const DEFAULT_AXIS = 1;
export const CONTOUR_COLOR = Object.freeze([0.1, 0.33, 0.78]);
export const CONTOUR_WIDTH_PX = 2.5;
const AXIS_NAMES = ['X', 'Y', 'Z'];
const SNAP = 1e-12;
const SAVE_DELAY_MS = 250;

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"'
  + ' stroke-width="1.7" stroke-linejoin="round"><path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z"/>'
  + '<path d="M4 12.5 12 17l8-4.5" stroke-dasharray="2.2 2"/><path d="M12 4v16"/></svg>';
const TOGGLE = '<button id="section-toggle" class="icon-button" type="button"'
  + ' aria-pressed="false" title="Section view (X)" aria-label="Section view">'
  + `${ICON}</button>`;

const PANEL = `<section id="section-panel" class="section-panel" hidden
  aria-label="Section view">
  <div class="section-head">
    <span class="section-title">Section</span>
    <span id="section-tag" class="section-tag"
      title="Clipping and caps come from the display mesh, not from the exact B-rep.">display
      section</span>
    <button id="section-collapse" class="section-icon" type="button"
      data-section-action="collapse" aria-expanded="true"
      aria-label="Collapse section panel" title="Collapse">&minus;</button>
    <button class="section-icon" type="button" data-section-action="off"
      aria-label="Turn section off (X)" title="Section off (X)">&times;</button>
  </div>
  <div id="section-body" class="section-body">
    <div id="section-tabs" class="section-tabs" role="group" aria-label="Section planes"></div>
    <div class="section-row">
      <span class="section-label">Normal</span>
      <div class="section-segment" role="group" aria-label="Plane normal axis">
        <button id="section-axis-x" type="button" data-section-action="axis" data-axis="0"
          aria-pressed="false" title="Normal along X (the side facing the camera is cut)">X</button>
        <button id="section-axis-y" type="button" data-section-action="axis" data-axis="1"
          aria-pressed="false" title="Normal along Y (the side facing the camera is cut)">Y</button>
        <button id="section-axis-z" type="button" data-section-action="axis" data-axis="2"
          aria-pressed="false" title="Normal along Z (the side facing the camera is cut)">Z</button>
      </div>
      <button id="section-from-view" class="section-small" type="button"
        data-section-action="view" title="Normal from view: the plane faces the camera">From
        view</button>
      <button id="section-flip" class="section-small" type="button" data-section-action="flip"
        title="Flip: cut away the other side">Flip</button>
    </div>
    <div class="section-row">
      <input id="section-slider" class="section-slider" type="range" min="0" max="1"
        step="any" value="0" aria-label="Plane position">
      <input id="section-value" class="section-value" type="number" step="any" value="0"
        aria-label="Plane position in mm">
      <span class="section-unit">mm</span>
    </div>
    <p id="section-plane-text" class="section-plane-text"></p>
    <div class="section-row section-plane-actions">
      <label class="section-check"><input id="section-enabled" type="checkbox" checked>
        Plane on</label>
      <button id="section-remove" class="section-small" type="button"
        data-section-action="remove">Remove plane</button>
    </div>
    <div id="section-caps" class="section-caps"></div>
    <div class="section-exact">
      <div class="section-row">
        <button id="section-exact" class="button secondary section-exact-button" type="button"
          data-section-action="exact"
          title="Exact section contours of this plane from the kernel (query worker)">Exact
          contour</button>
        <button id="section-exact-cancel" class="section-small" type="button"
          data-section-action="cancel" hidden>Cancel</button>
        <button id="section-exact-clear" class="section-small" type="button"
          data-section-action="clear" hidden>Clear</button>
      </div>
      <div id="section-exact-status" class="section-exact-status" role="status"
        aria-live="polite"></div>
    </div>
  </div>
</section>`;

// ---- Plane math (pure, tested) ----

const finite = value => typeof value === 'number' && Number.isFinite(value);
const isVector = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const now = () => globalThis.performance?.now?.() ?? Date.now();

// Unit direction with components below 1e-12 snapped to zero, so a preset
// view gives an exact axis.
export function cleanDirection(vector) {
  if (!isVector(vector)) return null;
  const length = Math.hypot(...vector);
  if (!(length > 0)) return null;
  const snapped = vector.map(value => (Math.abs(value / length) < SNAP ? 0 : value / length));
  const again = Math.hypot(...snapped);
  return snapped.map(value => value / again + 0);
}

// { index, sign } when the normal is exactly a principal axis, else null.
export function axisOf(normal) {
  const index = normal.findIndex(value => Math.abs(value) === 1);
  if (index < 0 || normal.some((value, axis) => axis !== index && value !== 0)) return null;
  return { index, sign: Math.sign(normal[index]) };
}

const centerOf = bounds => (bounds?.min && bounds?.max
  ? bounds.min.map((value, axis) => (value + bounds.max[axis]) / 2) : null);

function axisNormal(index, sign) {
  const normal = [0, 0, 0];
  normal[index] = sign;
  return normal;
}

// Plane state { normal, offset, enabled }: the plane is dot(normal, p) =
// offset (mm) and the side dot(normal, p) > offset is cut away. offset null
// means "through the model center" until a model is known.
export function planeState(normal, offset = null, enabled = true) {
  const clean = cleanDirection(normal) ?? axisNormal(DEFAULT_AXIS, -1);
  return { normal: clean, offset: finite(offset) ? offset : null, enabled: enabled !== false };
}

const offsetOf = (plane, bounds) => (finite(plane.offset) ? plane.offset
  : centerOf(bounds) ? dot(plane.normal, centerOf(bounds)) : null);

// World plane { origin, normal } (origin = offset * normal) or null.
export function worldPlane(plane, bounds) {
  const offset = offsetOf(plane, bounds);
  if (!finite(offset)) return null;
  return { origin: plane.normal.map(value => value * offset + 0), normal: [...plane.normal] };
}

// Slider value: the axis coordinate for axis planes, else the offset.
export function positionOf(plane, bounds) {
  const offset = offsetOf(plane, bounds) ?? 0;
  const axis = axisOf(plane.normal);
  return axis ? offset * axis.sign + 0 : offset;
}

export function withPosition(plane, value) {
  const axis = axisOf(plane.normal);
  return { ...plane, offset: axis ? value * axis.sign + 0 : value };
}

// [min, max, step] of the slider: the model bounds projected on the normal
// (in position units), 2 % margin, a decade step near span / 500.
export function sliderRange(plane, bounds) {
  if (!bounds?.min || !bounds?.max) return null;
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(bits => [0, 1, 2].map(axis => ((bits >> axis) & 1
    ? bounds.max[axis] : bounds.min[axis])));
  const axis = axisOf(plane.normal);
  const values = corners.map(corner => dot(plane.normal, corner) * (axis ? axis.sign : 1));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, 1e-6);
  const step = 10 ** Math.floor(Math.log10(span / 500));
  const round = value => Number((Math.round(value / step) * step).toPrecision(12));
  return [round(low - 0.02 * span), round(high + 0.02 * span), step];
}

// Axis plane facing the camera: the half toward the eye is cut away.
export function axisPlane(axisIndex, toward, current, bounds) {
  const sign = (toward?.[axisIndex] ?? 0) > 0 ? 1 : -1;
  const same = current && axisOf(current.normal)?.index === axisIndex;
  const value = same ? positionOf(current, bounds) : centerOf(bounds)?.[axisIndex] ?? null;
  const plane = planeState(axisNormal(axisIndex, sign), null, current?.enabled ?? true);
  return finite(value) ? withPosition(plane, value) : plane;
}

// Normal from view: the plane keeps its point and faces the camera (the
// half toward the eye is cut away).
export function viewPlane(plane, toward, bounds) {
  const normal = cleanDirection(toward);
  if (!normal) return plane;
  const world = worldPlane(plane, bounds);
  return planeState(normal, world ? dot(normal, world.origin) : null, plane.enabled);
}

export const flipPlane = plane => ({
  ...plane, normal: plane.normal.map(value => -value + 0),
  offset: finite(plane.offset) ? -plane.offset + 0 : null,
});

const fixed = value => (Math.abs(value) < 5e-13 ? 0 : value).toFixed(2);
const signed = value => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(3)}`;

// "x = 18.00 mm · normal +X · the +X side is cut away".
export function planeText(plane, bounds) {
  const axis = axisOf(plane.normal);
  const position = positionOf(plane, bounds);
  if (axis) {
    const name = AXIS_NAMES[axis.index];
    const side = `${axis.sign > 0 ? '+' : '−'}${name}`;
    return `${name.toLowerCase()} = ${fixed(position)} mm · normal ${side}`
      + ` · the ${side} side is cut away`;
  }
  const normal = plane.normal.map(signed).join(', ');
  return `n·p = ${fixed(position)} mm · normal (${normal}) · the side along n is cut away`;
}

export const planeKey = world => (world
  ? [...world.origin, ...world.normal].map(value => value.toPrecision(15)).join(',') : '');

// Saved setting -> state (invalid entries dropped), or null.
export function restoreSetting(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const planes = (Array.isArray(saved.planes) ? saved.planes : [])
    .filter(plane => cleanDirection(plane?.normal))
    .slice(0, MAX_CLIP_PLANES)
    .map(plane => planeState(plane.normal, plane.offset, plane.enabled));
  if (!planes.length) planes.push(planeState(axisNormal(DEFAULT_AXIS, -1)));
  const active = Number.isInteger(saved.active)
    ? Math.min(Math.max(saved.active, 0), planes.length - 1) : 0;
  return { on: saved.on === true, planes, active };
}

export const settingOf = section => ({
  on: section.on, active: section.active,
  planes: section.planes.map(({ normal, offset, enabled }) => ({ normal, offset, enabled })),
});

// Short summary of a section API result for the status line.
export function exactSummary(result, text = '') {
  if (!result) return '';
  const counts = result.bodies.filter(body => body.status === 'resolved' && body.contours)
    .map(body => `${body.alias}: ${body.contours}`);
  const total = result.contours.length;
  const where = text ? ` on ${text.split(' · ')[0]}` : '';
  if (result.status === 'resolved') {
    if (!total) return `The plane misses every sectioned body${where} (kernel: Empty).`;
    return `${total} closed contour${total === 1 ? '' : 's'}${where}`
      + (counts.length > 1 ? ` (${counts.join(', ')})` : '');
  }
  const failed = result.bodies.filter(body => body.status !== 'resolved').length;
  const bodies = result.bodies.length;
  return `Kernel section failed for ${failed} of ${bodies} bod${bodies === 1 ? 'y' : 'ies'}`
    + (total ? `; ${total} contour${total === 1 ? '' : 's'} of the other bodies shown` : '')
    + '.';
}

// ---- Feature ----

export function setup(ctx) {
  const { store, state, app, renderer, slots, commands, settings, requests, api, env,
    format: chips, dom: { $ } } = ctx;
  slots.viewActions.button({ id: 'section.toggle', order: 40, html: TOGGLE });
  slots.add('stage', { id: 'section.panel', order: 28, html: PANEL });

  const section = () => store.get().section;
  const displayed = () => [...new Set([state.after, state.compare ? state.before : null])]
    .filter(Boolean);
  const boundsOf = modelId => (modelId ? renderer.model?.(modelId)?.bounds
    ?? renderer.bounds?.(modelId) ?? null : null);
  const bounds = () => boundsOf(state.after);
  const activePlane = () => section().planes[section().active] ?? section().planes[0];
  const stats = {
    requests: 0, completed: 0, superseded: 0, cancelled: 0, failed: 0, errors: 0,
    lastMs: null, lastStatus: null,
  };
  const caps = createCapRenderer();
  const availabilityCache = new WeakMap();
  const boxCache = new WeakMap();
  const boxesOf = model => {
    if (!boxCache.has(model)) boxCache.set(model, bodyBounds(model));
    return boxCache.get(model);
  };
  const availabilityOf = model => {
    if (!model) return [];
    if (!availabilityCache.has(model)) availabilityCache.set(model, capAvailability(model));
    return availabilityCache.get(model);
  };

  // ---- State writes ----
  const worldPlanes = () => {
    const box = bounds();
    return section().on ? section().planes.filter(plane => plane.enabled)
      .map(plane => worldPlane(plane, box)).filter(Boolean) : [];
  };
  function syncDisplay() {
    const planes = worldPlanes();
    const current = store.get().display.section?.planes ?? [];
    if (JSON.stringify(current) === JSON.stringify(planes)) return;
    store.update('display.section', value => {
      value.display.section = { planes };
    });
  }
  const sourceOf = modelId => (modelId ? app.sourceKey?.(modelId) || modelId : null);
  let pendingSave = null;
  function flushSave({ unloading = false } = {}) {
    if (!pendingSave) return;
    env.clearTimeout?.(pendingSave.timer);
    const { source, value } = pendingSave;
    pendingSave = null;
    if (unloading) {
      // A normal request dies with the page; keepalive sends the same patch.
      api.put('/api/settings', { sources: { [source]: { section: value } } },
        { keepalive: true }).catch(() => {});
      return;
    }
    settings.set('S', 'section', value, { source });
  }
  const onPageHide = () => flushSave({ unloading: true });
  env.window?.addEventListener?.('pagehide', onPageHide);
  function persist() {
    const source = sourceOf(state.after);
    if (!source || ctx.legacy) return;
    if (pendingSave && pendingSave.source !== source) flushSave();
    env.clearTimeout?.(pendingSave?.timer);
    pendingSave = { source, value: settingOf(section()),
      timer: env.setTimeout?.(flushSave, SAVE_DELAY_MS) };
  }
  // Planes created before a model was known pass through its center.
  function resolveOffsets() {
    const center = centerOf(bounds());
    if (!center) return;
    for (const plane of section().planes) {
      if (!finite(plane.offset)) plane.offset = dot(plane.normal, center);
    }
  }
  function change(reason, recipe, { save = true } = {}) {
    store.update(reason, current => recipe(current.section));
    resolveOffsets();
    syncDisplay();
    invalidateContour();
    if (save) persist();
    render();
    app.scheduleDraw?.();
  }

  const toward = () => {
    const camera = ctx.panes?.camera?.();
    return camera ? basis(camera).toward : null;
  };

  // ---- Commands ----
  function toggle(force) {
    const on = typeof force === 'boolean' ? force : !section().on;
    if (!on) abortExact('cancelled');
    change('section.toggle', current => {
      current.on = on;
      if (on && !current.planes.length) {
        current.planes.push(axisPlane(DEFAULT_AXIS, toward(), null, bounds()));
      }
    });
    ctx.notify?.(on ? 'Section on: display clip plane (X toggles)' : 'Section off');
  }
  const editActive = (reason, update) => change(reason, current => {
    current.planes[current.active] = update(current.planes[current.active]);
  });
  const setAxis = axisIndex => editActive('section.axis',
    plane => axisPlane(axisIndex, toward(), plane, bounds()));
  function normalFromView() {
    const direction = toward();
    if (!direction) return null;
    editActive('section.view', plane => viewPlane(plane, direction, bounds()));
    return activePlane();
  }
  const flip = () => editActive('section.flip', flipPlane);
  function addPlane() {
    if (section().planes.length >= MAX_CLIP_PLANES) return;
    const used = new Set(section().planes.map(plane => axisOf(plane.normal)?.index));
    const axis = [0, 2, 1].find(index => !used.has(index)) ?? 0;
    change('section.add', current => {
      current.planes.push(axisPlane(axis, toward(), null, bounds()));
      current.active = current.planes.length - 1;
      current.on = true;
    });
  }
  function removePlane() {
    if (section().planes.length <= 1) {
      toggle(false);
      return;
    }
    change('section.remove', current => {
      current.planes.splice(current.active, 1);
      current.active = Math.min(current.active, current.planes.length - 1);
    });
  }
  const selectPlane = index => change('section.select', current => {
    current.active = Math.min(Math.max(index, 0), current.planes.length - 1);
  });
  const setPosition = value => {
    if (finite(value)) editActive('section.position', plane => withPosition(plane, value));
  };
  const setEnabled = enabled => editActive('section.enabled', plane => ({ ...plane, enabled }));

  commands.register({
    id: 'section.toggle', label: 'Section view', keys: ['X'], run: () => toggle(),
  });
  commands.register({ id: 'section.fromView', label: 'Section normal from view',
    run: normalFromView, enabled: () => section().on });
  commands.register({ id: 'section.flip', label: 'Flip section plane', run: flip,
    enabled: () => section().on });
  commands.register({ id: 'section.addPlane', label: 'Add section plane', run: addPlane });
  commands.register({ id: 'section.exact', label: 'Exact section contour', run: () => exact(),
    enabled: () => section().on });
  commands.register({ id: 'section.cancelExact', label: 'Cancel exact contour',
    run: () => abortExact('cancelled') });
  commands.bind('#section-toggle', 'section.toggle');

  // ---- Exact contour (query worker, latest wins) ----
  const scope = requests.scope('section.exact');
  let pending = false;
  function setContour(contour) {
    store.update('section.contour', current => {
      current.section.contour = contour;
    });
    renderExact();
    app.scheduleDraw?.();
  }
  function abortExact(reason) {
    if (!pending) return;
    if (reason === 'superseded') stats.superseded++;
    else stats.cancelled++;
    pending = false;
    scope.abort();
    setContour({ status: reason });
  }
  // A moved or disabled plane, section off or another model make a contour
  // stale: a running request is aborted, a drawn contour removed.
  function invalidateContour() {
    const contour = section().contour;
    if (!contour || !['pending', 'resolved', 'failed'].includes(contour.status)) return;
    const plane = section().planes[contour.planeIndex];
    const world = plane?.enabled && section().on ? worldPlane(plane, bounds()) : null;
    if (contour.modelId === state.after && planeKey(world) === contour.planeKey) return;
    if (contour.status === 'pending') abortExact('superseded');
    else setContour({ status: 'stale' });
  }
  async function exact() {
    const modelId = state.after;
    const plane = activePlane();
    const world = plane?.enabled ? worldPlane(plane, bounds()) : null;
    if (!modelId || !world || !section().on) {
      setContour({ status: 'error', message: 'Turn a section plane on first.' });
      return null;
    }
    if (pending) stats.superseded++;
    const { signal, current } = scope.begin();
    const bodies = renderer.look?.(modelId)?.bodies?.filter(body => body.visible)
      .map(body => body.id);
    const key = planeKey(world);
    const started = now();
    const text = planeText(plane, bounds());
    const context = { modelId, planeIndex: section().active, planeKey: key, planeText: text };
    pending = true;
    stats.requests++;
    setContour({ status: 'pending', ...context, startedAt: started });
    try {
      const result = await api.post(`/api/models/${modelId}/section`, {
        origin: world.origin, normal: world.normal, ...(bodies ? { bodies } : {}),
      }, { signal });
      if (!current()) return null;
      pending = false;
      stats.completed++;
      if (result.status !== 'resolved') stats.failed++;
      stats.lastMs = now() - started;
      stats.lastStatus = result.status;
      setContour({ status: result.status, ...context, result, ms: stats.lastMs });
      return result;
    } catch (error) {
      if (!current() || error?.name === 'AbortError') return null;
      pending = false;
      stats.errors++;
      stats.lastStatus = 'error';
      setContour({ status: 'error', modelId, message: error.message });
      return null;
    }
  }

  // ---- Layers ----
  // QA only: a fixed gap-closing radius in px (null: from the tolerance).
  let debugGap = null;
  const lookCache = new Map();
  function stylesOf(modelId) {
    const version = renderer.styleVersion?.();
    const model = renderer.model?.(modelId);
    const cached = lookCache.get(modelId);
    if (cached?.version === version && cached.model === model) return cached.bodies;
    const bodies = renderer.look?.(modelId)?.bodies ?? [];
    lookCache.set(modelId, { version, model, bodies });
    return bodies;
  }
  // Once per pane member (every model of an open assembly), with the planes
  // in that member's local frame.
  const removeCaps = renderer.addLayer({
    id: 'section.caps', order: 5, perMember: true,
    draw(frame) {
      if (!section().on) return;
      const planes = localPlanes(frame.member?.matrix, renderer.style?.().clipPlanes ?? []);
      if (!planes.length) return;
      caps.draw(frame, {
        planes, styles: stylesOf(frame.pane.modelId), availability: availabilityOf(frame.model),
        boxes: boxesOf(frame.model), toleranceMm: frame.model.toleranceMm, gapPx: debugGap,
      });
    },
  });
  const removeContour = renderer.addLayer({
    id: 'section.contour', order: 6,
    draw(frame) {
      const contour = section().contour;
      if (!section().on || !contour?.result || contour.modelId !== frame.pane.modelId) return;
      for (const ring of contour.result.contours) {
        for (const edge of ring.edges) {
          frame.drawLines({ positions: edge.points, strip: true, color: CONTOUR_COLOR,
            widthPx: CONTOUR_WIDTH_PX, depthBias: 2 });
        }
      }
    },
  });
  const stopLost = renderer.onContextLost?.(() => caps.lost());
  let frameCaps = [];
  ctx.onFrame(() => {
    caps.endFrame();
    frameCaps = caps.stats().lastCaps;
    caps.releaseExcept(section().on ? displayed() : []);
    refreshCaps();
  });

  // ---- Panel ----
  let dragging = false;
  let capsKey = null;
  function render() {
    const panel = $('#section-panel');
    const current = section();
    if (!current) return;
    $('#section-toggle')?.setAttribute('aria-pressed', String(current.on));
    if (!panel) return;
    panel.hidden = !current.on;
    if (!current.on) return;
    const plane = activePlane();
    const box = bounds();
    const tolerance = renderer.model?.(state.after)?.toleranceMm;
    const tag = $('#section-tag');
    if (tag) {
      tag.textContent = tolerance > 0 ? `display section ±${Number(tolerance.toPrecision(3))} mm`
        : 'display section (tolerance not stated)';
    }
    const body = $('#section-body');
    if (body) body.hidden = current.collapsed === true;
    $('#section-collapse')?.setAttribute('aria-expanded', String(current.collapsed !== true));
    const tabs = $('#section-tabs');
    if (tabs) {
      tabs.innerHTML = current.planes.map((item, index) => '<button type="button"'
        + ` class="section-tab" data-section-action="select" data-plane="${index}"`
        + ` aria-pressed="${index === current.active}"`
        + ` title="${escape(planeText(item, box))}">Plane ${index + 1}`
        + `${item.enabled ? '' : ' (off)'}</button>`).join('')
        + (current.planes.length < MAX_CLIP_PLANES ? '<button type="button"'
          + ' class="section-tab section-add" data-section-action="add"'
          + ' title="Add a clip plane (up to 3)">+ Plane</button>' : '');
    }
    const axis = plane ? axisOf(plane.normal) : null;
    ['x', 'y', 'z'].forEach((name, index) => $(`#section-axis-${name}`)
      ?.setAttribute('aria-pressed', String(axis?.index === index)));
    const range = plane ? sliderRange(plane, box) : null;
    const slider = $('#section-slider');
    const field = $('#section-value');
    const position = plane ? positionOf(plane, box) : 0;
    if (slider && range && !dragging) {
      slider.min = String(Math.min(range[0], position));
      slider.max = String(Math.max(range[1], position));
      slider.step = String(range[2]);
      slider.value = String(position);
    }
    if (slider) slider.disabled = !range;
    if (field && env.document?.activeElement !== field) field.value = fixed(position);
    const text = $('#section-plane-text');
    if (text) text.textContent = plane ? planeText(plane, box) : '';
    const enabled = $('#section-enabled');
    if (enabled) enabled.checked = plane?.enabled !== false;
    const remove = $('#section-remove');
    if (remove) remove.textContent = current.planes.length > 1 ? 'Remove plane' : 'Section off';
    capsKey = null;
    refreshCaps();
    renderExact();
  }

  // Cap rows per displayed model and body: body color, capped / unavailable.
  function refreshCaps() {
    const element = $('#section-caps');
    if (!element || !section().on) return;
    const models = displayed();
    const planes = worldPlanes();
    const key = [renderer.styleVersion?.(), JSON.stringify(planes), ...models.map(modelId => {
      const model = renderer.model?.(modelId);
      return model ? `${modelId}:${model.counts?.faces}` : `${modelId}:pending`;
    })].join('|');
    if (key === capsKey) return;
    capsKey = key;
    const rows = [];
    for (const modelId of models) {
      const model = renderer.model?.(modelId);
      if (!model) {
        rows.push('<li class="section-cap pending">Display mesh loading…</li>');
        continue;
      }
      const styles = stylesOf(modelId);
      const side = models.length > 1 ? `${modelId === state.after ? 'after' : 'before'} ` : '';
      const boxes = boxesOf(model);
      for (const entry of availabilityOf(model)) {
        const style = styles[entry.index];
        const meet = planesMeetBox(planes, boxes[entry.index]);
        const status = style?.visible === false ? 'hidden, not capped'
          : meet === 'clipped' ? 'clipped away' : meet === 'whole' ? 'not cut'
            : entry.available ? 'capped' : entry.reason;
        const title = entry.missing.map(item => `${item.alias}: ${item.reason}`).join('\n');
        const open = !entry.available && meet === 'cut';
        const kind = open ? ' unavailable' : meet === 'cut' ? '' : ' idle';
        rows.push(`<li class="section-cap${kind}"`
          + ` data-body="${escape(entry.alias)}" title="${escape(title)}">`
          + `<span class="section-swatch" data-swatch="${escape(modelId)}:${entry.index}"></span>`
          + `<span class="section-cap-name">${escape(side + entry.alias)}`
          + ` <small>${escape(style?.name ?? entry.id)}</small></span>`
          + `<span class="section-cap-status">${escape(status)}</span></li>`);
      }
    }
    element.innerHTML = `<ul class="section-cap-list" aria-label="Section caps">${rows.join('')}`
      + '</ul>';
    for (const node of element.querySelectorAll?.('[data-swatch]') ?? []) {
      const [modelId, index] = node.dataset.swatch.split(':');
      const color = stylesOf(modelId)[Number(index)]?.color;
      if (color) {
        node.style.setProperty('--section-swatch',
          `rgb(${color.map(value => Math.round(value * 255)).join(' ')})`);
      }
    }
  }

  function bodyFailure(body) {
    return `<li class="section-failure"><strong>${escape(body.alias)}</strong>`
      + ` <span class="section-verbatim">${escape(body.message)}</span>`
      + (body.face ? ` <small>(${escape(body.face)})</small>` : '')
      + (body.detail ? `<code class="section-reason">${escape(body.detail)}</code>` : '')
      + (body.kernelReason ? '<details><summary>Kernel reason record</summary>'
        + `<pre>${escape(JSON.stringify(body.kernelReason, null, 1))}</pre></details>` : '')
      + '</li>';
  }

  function renderExact() {
    const element = $('#section-exact-status');
    const contour = section().contour;
    const cancel = $('#section-exact-cancel');
    const clear = $('#section-exact-clear');
    if (cancel) cancel.hidden = contour?.status !== 'pending';
    if (clear) clear.hidden = !['resolved', 'failed', 'error', 'stale'].includes(contour?.status);
    if (!element) return;
    const kernel = chips.exactnessChipMarkup('kernel-resolved');
    const display = chips.exactnessChipMarkup('display-approximation',
      contour?.result?.displayToleranceMm ?? 0.02);
    let markup;
    switch (contour?.status) {
      case 'pending':
        markup = '<p class="section-pending">Computing the exact contour of '
          + `${escape(contour.planeText.split(' · ')[0])} in the query worker…</p>`;
        break;
      case 'resolved':
        markup = `<p>${kernel} ${escape(exactSummary(contour.result, contour.planeText))}</p>`
          + `<p class="section-note">Lines: ${display} polylines of the kernel curves`
          + ` · ${Math.round(contour.ms)} ms</p>`;
        break;
      case 'failed': {
        const failures = contour.result.bodies.filter(body => body.status !== 'resolved');
        markup = `<p class="section-failed">${kernel} ${escape(exactSummary(contour.result))}</p>`
          + `<ul class="section-failures">${failures.map(bodyFailure).join('')}</ul>`
          + '<p class="section-note">The plane is not nudged: move it or choose another'
          + ' plane.</p>';
        break;
      }
      case 'error':
        markup = '<p class="section-failed">Exact contour unavailable: '
          + `<span class="section-verbatim">${escape(contour.message)}</span></p>`;
        break;
      case 'stale':
        markup = '<p class="section-note">The plane or model changed; the contour was removed.'
          + ' Press Exact contour for the current plane.</p>';
        break;
      case 'cancelled':
      case 'superseded':
        markup = `<p class="section-note">Exact contour ${contour.status}.</p>`;
        break;
      default:
        markup = '<p class="section-note">Kernel contours (<code>sectionSolid</code>) of the'
          + ' current plane, on demand.</p>';
    }
    element.innerHTML = markup;
  }

  $('#section-panel')?.addEventListener('click', event => {
    const target = event.target?.closest?.('[data-section-action]');
    if (!target) return;
    const action = target.dataset.sectionAction;
    if (action === 'off') toggle(false);
    else if (action === 'collapse') {
      change('section.collapse', current => {
        current.collapsed = current.collapsed !== true;
      }, { save: false });
    } else if (action === 'axis') setAxis(Number(target.dataset.axis));
    else if (action === 'view') normalFromView();
    else if (action === 'flip') flip();
    else if (action === 'add') addPlane();
    else if (action === 'remove') removePlane();
    else if (action === 'select') selectPlane(Number(target.dataset.plane));
    else if (action === 'exact') exact();
    else if (action === 'cancel') abortExact('cancelled');
    else if (action === 'clear') setContour(null);
  });
  const slider = $('#section-slider');
  slider?.addEventListener('pointerdown', () => {
    dragging = true;
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    render();
  };
  slider?.addEventListener('pointerup', endDrag);
  slider?.addEventListener('change', endDrag);
  slider?.addEventListener('input', () => setPosition(Number(slider.value)));
  const field = $('#section-value');
  field?.addEventListener('change', () => setPosition(Number(field.value)));
  $('#section-enabled')?.addEventListener('change', event => setEnabled(
    event.target?.checked !== false));

  // ---- Settings (S: per source) ----
  let restoredFor = null;
  function restore() {
    if (ctx.legacy || !settings.loaded()) return;
    const source = sourceOf(state.after);
    if (!source || source === restoredFor) return;
    flushSave();
    restoredFor = source;
    const saved = restoreSetting(settings.get('S', 'section', null, { source }));
    abortExact('superseded');
    // A source without a setting starts off, one plane through its center.
    const fresh = { on: false, planes: [planeState(axisNormal(DEFAULT_AXIS, -1))], active: 0 };
    store.update('section.restore', current => {
      Object.assign(current.section, saved ?? fresh, { contour: null });
    });
  }
  const stopSettings = settings.onChange(() => {
    restore();
    resolveOffsets();
    syncDisplay();
    render();
  });
  const stopModel = store.select(current => current.compare?.after ?? null, () => {
    restore();
    resolveOffsets();
    syncDisplay();
    invalidateContour();
    render();
    app.scheduleDraw?.();
  });

  // The store slice exists once setup() returned (defaults merge then).
  queueMicrotask(render);

  const snapshot = () => {
    const current = section();
    const contour = current.contour;
    return JSON.parse(JSON.stringify({
      on: current.on, active: current.active, collapsed: current.collapsed,
      planes: current.planes, world: worldPlanes(),
      contour: contour ? { ...contour, result: contour.result ? {
        status: contour.result.status, reason: contour.result.reason,
        contours: contour.result.contours.length, bodies: contour.result.bodies,
      } : undefined } : null,
    }));
  };

  return {
    api: {
      sectionState: snapshot,
      sectionStats: () => ({
        ...stats, pending, caps: caps.stats(), lastFrameCaps: frameCaps,
        availability: displayed().map(modelId => ({
          modelId, bodies: availabilityOf(renderer.model?.(modelId)),
        })),
      }),
      // QA: replaces the planes ({ normal, offset?, position?, enabled? }).
      setSectionPlanes(planes, { active = 0, on = true } = {}) {
        change('section.debug', current => {
          current.planes = planes.slice(0, MAX_CLIP_PLANES).map(item => {
            const plane = planeState(item.normal, item.offset, item.enabled);
            return finite(item.position) ? withPosition(plane, item.position) : plane;
          });
          current.active = Math.min(active, current.planes.length - 1);
          current.on = on;
        });
        return snapshot();
      },
      sectionExact: exact,
      sectionDebugGap(px = null) {
        debugGap = Number.isInteger(px) ? px : null;
        app.scheduleDraw?.();
        return debugGap;
      },
      sectionNormalFromView: normalFromView,
    },
    defaults: {
      section: {
        on: false, planes: [planeState(axisNormal(DEFAULT_AXIS, -1))], active: 0,
        collapsed: false, contour: null,
      },
      'display.section': { planes: [] },
    },
    dispose() {
      removeCaps();
      removeContour();
      stopLost?.();
      stopSettings();
      stopModel();
      flushSave();
      env.window?.removeEventListener?.('pagehide', onPageHide);
      caps.releaseExcept([]);
    },
  };
}
