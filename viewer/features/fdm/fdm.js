// fdm feature (spec 3.6, 5, 6; package fdm): per-body build plate, plate
// relation and overhang shading.
//
//   G         build plate at Z = 0 (grid lines, origin axes; plate-layer.js).
//             Setting S fdmPlate, on by default for live sources.
//   Shift+G   overhang tint (setting S fdmOverhang, default off). The tint
//             appears only once POST /api/models/:id/printability answered
//             for the displayed revision and the current settings; until then
//             the legend says "pending".
//   Shift+B   Print on selected face: the selected planar face's body gets
//             up = −n (exact outward normal from GET …/geometry). Geometry
//             never moves; only the checks change.
//   panel     "Print check" (view action): plate, α_max with β, small-bore
//             exemption, and per body printed + up axis + plate relation.
//
// Settings: G fdmAlphaDeg (45), fdmSmallBore (true), fdmPlateWidthMm and
// fdmPlateDepthMm (256; also listed as settings.item entries);
// S fdmPlate, fdmOverhang; SB fdmPrinted (true), fdmUp ([0, 0, 1]),
// fdmUpFrom (the face alias the up axis came from). SB keys use the body name
// when present and unique in the model, else the body id.
//
// Plate relation: in the status bar when exactly one body is visible,
// otherwise as parts-tree row badges (slots.parts.rowBadge 'fdm.plate') and
// in the panel. Store keys written: fdm (version counters), display.fdm (the
// renderer's overhang flags, see render/style.js). Requests never run under
// the legacy seam (this feature is not in the VS set) and failures stay in
// this feature's own status line and legend.
import { escape } from '../../core/dom.js';
import { resolveBodyStyle } from '../../render/style.js';
import { createPlateLayer } from './plate-layer.js';
import {
  BRIDGE_NOTE, DEFAULT_ALPHA_DEG, DEFAULT_PLATE_MM, DEFAULT_SMALL_BORE_MM, DEFAULT_UP,
  EXEMPT_LABEL, UP_PRESETS, badgeMarkup, betaOf, bodyKey, cleanAlpha, cleanPlate, countsOf,
  degreesText, displayFdm, faceSummary, isVector, legendMarkup, relationOf, resultKey, sameUp,
  statusMarkup, statusView, stripSpanDeg, unitVector, upLabel,
} from './overhang.js';

export const id = 'fdm';
export const legacy = false;

const MAX_MODELS = 8;
const MAX_LABELS = 12;

const svg = paths => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"'
  + ` stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">${paths}</svg>`;
const PLATE_ICON = svg('<path d="M3 15.5 9 9h12l-6 6.5H3Z"/><path d="M6 12.3h12M12 9l-3'
  + ' 6.5M16.5 9l-3 6.5" stroke-width="1.1"/>');
const OVERHANG_ICON = svg('<path d="M4 20V9h9l5-5v6l-5 5H9v5H4Z"/><path d="M9 15 13 15'
  + ' 18 10" stroke-width="2.6" stroke-linecap="round"/>');
const PANEL_ICON = svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7"'
  + ' r="2"/><circle cx="9" cy="17" r="2"/>');

const BUTTONS = [
  ['plate', 40, 'fdm-plate-toggle', 'Build plate 256 × 256 mm at Z = 0 (G)', 'Build plate',
    PLATE_ICON, 'aria-pressed="false"'],
  ['overhang', 41, 'fdm-overhang-toggle', 'Overhang shading (Shift+G)', 'Overhang shading',
    OVERHANG_ICON, 'aria-pressed="false"'],
  ['panel', 42, 'fdm-panel-toggle', 'Print check: plate, overhang threshold, printed bodies and'
    + ' up axes', 'Print check', PANEL_ICON, 'aria-expanded="false" aria-controls="fdm-panel"'],
];

const PANEL = '<div id="fdm-panel" class="fdm-panel" role="dialog" aria-label="Print check"'
  + ' hidden><div class="fdm-panel-head"><h3>Print check</h3><button id="fdm-panel-close"'
  + ' class="icon-button" type="button" aria-label="Close print check">×</button></div>'
  + '<label class="fdm-row"><input id="fdm-plate-input" type="checkbox"> Build plate'
  + ' <kbd>G</kbd></label>'
  + '<div class="fdm-row fdm-indent"><input id="fdm-plate-width" class="fdm-number"'
  + ' type="number" min="10" max="2000" step="1" aria-label="Plate width in mm"> ×'
  + ' <input id="fdm-plate-depth" class="fdm-number" type="number" min="10" max="2000"'
  + ' step="1" aria-label="Plate depth in mm"> mm at Z = 0</div>'
  + '<label class="fdm-row"><input id="fdm-overhang-input" type="checkbox"> Overhang shading'
  + ' <kbd>⇧G</kbd></label>'
  + '<div class="fdm-row fdm-indent"><label class="fdm-nowrap" for="fdm-alpha">α max</label>'
  + '<input id="fdm-alpha" class="fdm-number" type="number" min="1" max="89" step="1">'
  + '<span class="fdm-nowrap">° from vertical</span></div>'
  + '<p id="fdm-beta" class="fdm-note fdm-indent"></p>'
  + '<label class="fdm-row fdm-indent"><input id="fdm-small-bore" type="checkbox"> Small bores'
  + ` Ø ≤ ${DEFAULT_SMALL_BORE_MM} mm exempt (cad-khana)</label>`
  + `<p class="fdm-note fdm-indent">${BRIDGE_NOTE}</p>`
  + '<h4 id="fdm-bodies-title">Bodies</h4><ul id="fdm-bodies" class="fdm-bodies"></ul>'
  + '<button id="fdm-print-face" class="button secondary fdm-print-face" type="button">'
  + 'Print on selected face <kbd>⇧B</kbd></button>'
  + '<p class="fdm-note">Up axes and the printed flag only change the checks; the geometry is'
  + ' never moved.</p></div>';

const STATUS = '<span id="fdm-status" class="fdm-status" role="status" aria-live="polite"'
  + ' hidden></span>';
const LEGEND = '<div id="fdm-legend" class="fdm-legend" role="note"'
  + ' aria-label="Overhang legend" hidden></div>';

const round = value => Math.round(value * 10) / 10;

// Global settings for the settings dialog (help-a11y renders settings.item).
const SETTINGS = [
  { id: 'fdm.alpha', order: 60, label: 'Overhang threshold α max (from vertical)', scope: 'G',
    key: 'fdmAlphaDeg', type: 'number', min: 1, max: 89, step: 1, default: DEFAULT_ALPHA_DEG,
    unit: '°', description: 'Slicer threshold angle β = 90° − α max (cad-khana convention)' },
  { id: 'fdm.smallBore', order: 61, label: `Small-bore exemption (Ø ≤ ${DEFAULT_SMALL_BORE_MM}`
    + ' mm)', scope: 'G', key: 'fdmSmallBore', type: 'boolean', default: true,
  description: 'Hole cylinders up to this diameter are self-supporting (cad-khana)' },
  { id: 'fdm.plateWidth', order: 62, label: 'Build plate width', scope: 'G',
    key: 'fdmPlateWidthMm', type: 'number', min: 10, max: 2000, step: 1,
    default: DEFAULT_PLATE_MM[0], unit: 'mm' },
  { id: 'fdm.plateDepth', order: 63, label: 'Build plate depth', scope: 'G',
    key: 'fdmPlateDepthMm', type: 'number', min: 10, max: 2000, step: 1,
    default: DEFAULT_PLATE_MM[1], unit: 'mm' },
];

export function setup(ctx) {
  const {
    store, state, app, api, settings, slots, commands, renderer, keyboard, requests,
    dom: { $, $$ },
  } = ctx;

  for (const [name, order, domId, title, label, icon, extra] of BUTTONS) {
    slots.viewActions.button({
      id: `fdm.${name}`, order,
      html: `<button id="${domId}" class="icon-button fdm-action" type="button" ${extra}`
        + ` title="${escape(title)}" aria-label="${escape(label)}">${icon}</button>`,
    });
  }
  slots.viewActions.button({ id: 'fdm.panel.body', order: 43, html: PANEL });
  slots.statusBar.item({ id: 'fdm.status', order: 20, html: STATUS });
  // Lower-right column shared with the ghost panel (styles/layout.css).
  slots.viewportHud.item({ corner: 'bottom-right', id: 'fdm.legend', order: 30, html: LEGEND });
  for (const item of SETTINGS) slots.settings.item(item);

  // ---- Settings -------------------------------------------------------------
  const sourceOf = modelId => (modelId ? app.sourceKey?.(modelId) || modelId : null);
  const isLive = modelId => app.revisionOf?.(modelId)?.group?.kind === 'live'
    || !!state.workspace?.models?.find?.(model => model.id === modelId)?.live;
  const globals = () => ({
    alphaDeg: cleanAlpha(settings.get('G', 'fdmAlphaDeg', DEFAULT_ALPHA_DEG)),
    smallBoreMm: settings.get('G', 'fdmSmallBore', true) === false ? null : DEFAULT_SMALL_BORE_MM,
    plateMm: cleanPlate([settings.get('G', 'fdmPlateWidthMm', DEFAULT_PLATE_MM[0]),
      settings.get('G', 'fdmPlateDepthMm', DEFAULT_PLATE_MM[1])]),
  });
  const plateOn = (modelId = state.after) => !!modelId && settings.get('S', 'fdmPlate',
    isLive(modelId), { source: sourceOf(modelId) }) === true;
  const overhangOn = (modelId = state.after) => !!modelId && settings.get('S', 'fdmOverhang',
    false, { source: sourceOf(modelId) }) === true;
  const active = () => plateOn() || overhangOn();
  const displayed = () => [...new Set([state.after, state.compare ? state.before : null])]
    .filter(Boolean);
  const revisionLabel = modelId => {
    const revision = app.revisionOf?.(modelId)?.entry?.revision;
    return Number.isInteger(revision) ? `r${revision}` : '';
  };

  // Per-body settings of a model (from its draw model), or null before it loads.
  function bodiesOf(modelId) {
    const model = renderer.model?.(modelId);
    if (!model) return null;
    const source = sourceOf(modelId);
    return model.bodies.map((body, index) => {
      const key = bodyKey(model.bodies, body);
      const where = { source, body: key };
      const up = settings.get('SB', 'fdmUp', null, where);
      return {
        id: body.id, index, alias: `B${index + 1}`, name: body.name ?? null, key,
        printed: settings.get('SB', 'fdmPrinted', true, where) !== false,
        up: isVector(up) ? unitVector(up) : [...DEFAULT_UP],
        upFrom: settings.get('SB', 'fdmUpFrom', null, where),
      };
    });
  }

  // ---- Printability answers ---------------------------------------------------
  // modelId -> { bodies: Map(bodyId -> { key, data }), meta, error, inflight }
  const models = new Map();
  const entryOf = modelId => {
    if (!models.has(modelId)) {
      models.set(modelId, { bodies: new Map(), meta: null, error: null, inflight: null });
      for (const key of [...models.keys()]) {
        if (models.size <= MAX_MODELS) break;
        if (!displayed().includes(key)) models.delete(key);
      }
    }
    return models.get(modelId);
  };
  const keyOf = body => resultKey({ ...globals(), up: body.up });
  const ready = (modelId, body) => {
    const cached = models.get(modelId)?.bodies.get(body.id);
    return cached && cached.key === keyOf(body) ? cached.data : null;
  };
  const pendingOf = modelId => {
    const bodies = bodiesOf(modelId);
    if (!bodies) return true;
    return bodies.some(body => body.printed && !ready(modelId, body));
  };

  const bump = reason => store.update(reason, current => {
    current.fdm.version++;
  });

  function request(modelId) {
    const bodies = bodiesOf(modelId);
    if (!bodies) return;
    const entry = entryOf(modelId);
    const missing = bodies.filter(body => body.printed && !ready(modelId, body));
    if (!missing.length) {
      if (entry.inflight) requests.scope(`fdm:${modelId}`).abort();
      entry.inflight = null;
      return;
    }
    const { alphaDeg, smallBoreMm, plateMm } = globals();
    const payload = {
      alphaDeg, smallBoreMm, plateMm,
      bodies: missing.map(body => ({ bodyId: body.id, up: body.up, printed: true })),
    };
    const wanted = JSON.stringify(payload);
    if (entry.inflight === wanted || entry.error?.request === wanted) return;
    entry.inflight = wanted;
    entry.error = null;
    const { signal, current } = requests.scope(`fdm:${modelId}`).begin();
    const keys = new Map(missing.map(body => [body.id, keyOf(body)]));
    api.post(`/api/models/${modelId}/printability`, payload, { signal }).then(data => {
      if (!current()) return;
      entry.inflight = null;
      const { bodies: answered, ...meta } = data;
      entry.meta = meta;
      for (const body of answered) {
        entry.bodies.set(body.bodyId, { key: keys.get(body.bodyId), data: body });
      }
      refresh('fdm.answer');
    }).catch(error => {
      if (!current() || error?.name === 'AbortError') return;
      entry.inflight = null;
      entry.error = { request: wanted, message: error.message ?? String(error) };
      refresh('fdm.error');
    });
  }

  // ---- Composition ------------------------------------------------------------
  let lastDisplay = null;
  function composeDisplay() {
    const { alphaDeg } = globals();
    const entries = displayed().map(modelId => ({
      modelId,
      bodies: (bodiesOf(modelId) ?? []).map(body => ({
        bodyId: body.id, up: body.up, printed: body.printed,
        result: body.printed ? ready(modelId, body) : null,
      })),
    }));
    const next = displayFdm({ enabled: overhangOn(), alphaDeg, entries });
    const text = JSON.stringify(next);
    if (text === lastDisplay) return;
    lastDisplay = text;
    store.update('display.fdm', current => {
      current.display.fdm = next;
    });
  }

  // Visible bodies under the composed style (parts tree, isolate); cheap
  // enough for the per-frame check below.
  const visibility = modelId => {
    const style = renderer.style?.() ?? {};
    return (renderer.model?.(modelId)?.bodies ?? []).map((body, index) => [body.id,
      resolveBodyStyle(style, modelId, body, index).visible]);
  };
  const visibleIds = modelId => new Set(visibility(modelId)
    .filter(([, visible]) => visible).map(([bodyId]) => bodyId));

  function resultsOf(modelId) {
    const map = new Map();
    for (const body of bodiesOf(modelId) ?? []) {
      const data = body.printed ? ready(modelId, body) : null;
      if (data) map.set(body.id, data);
    }
    return map;
  }

  function renderStatus() {
    const element = $('#fdm-status');
    if (!element) return;
    const modelId = state.after;
    const bodies = modelId ? bodiesOf(modelId) : null;
    if (!modelId || !active() || !bodies) {
      element.hidden = true;
      return;
    }
    const entry = models.get(modelId);
    const view = statusView({
      bodies, visible: visibleIds(modelId), results: resultsOf(modelId),
      pending: !!entry?.inflight || pendingOf(modelId),
    });
    const html = statusMarkup(view, { revision: revisionLabel(modelId),
      error: entry?.error?.message ?? null });
    element.innerHTML = html;
    element.hidden = !html;
  }

  // Widest display strip of the tinted curved faces (band-edge bound).
  function stripBound(modelId, bodies) {
    const model = renderer.model?.(modelId);
    let widest = null;
    let unbounded = false;
    for (const body of bodies) {
      for (const face of body.faces ?? []) {
        if (face.surface === 'plane' || face.kind !== 'overhang') continue;
        for (const alias of face.fragments) {
          const drawFace = model?.faces?.find(item => item.alias === alias);
          const span = face.surface === 'cylinder'
            ? stripSpanDeg(face.diameterMm / 2, drawFace?.maxChordErrorMm) : null;
          if (span === null) unbounded = true;
          else widest = Math.max(widest ?? 0, span);
        }
      }
    }
    return { widest, unbounded };
  }

  function renderLegend() {
    const element = $('#fdm-legend');
    if (!element) return;
    const modelId = state.after;
    if (!modelId || !overhangOn()) {
      element.hidden = true;
      return;
    }
    const { alphaDeg, smallBoreMm } = globals();
    const entry = models.get(modelId);
    const results = [...resultsOf(modelId).values()];
    const pending = pendingOf(modelId);
    const { widest, unbounded } = stripBound(modelId, results);
    element.innerHTML = legendMarkup({
      alphaDeg, smallBoreMm, pending, revision: revisionLabel(modelId),
      counts: pending ? null : countsOf(results), stripDeg: widest,
      curvedWithoutBound: unbounded && widest === null, error: entry?.error?.message ?? null,
    });
    element.hidden = false;
  }

  function renderButtons() {
    $('#fdm-plate-toggle')?.setAttribute('aria-pressed', String(plateOn()));
    $('#fdm-overhang-toggle')?.setAttribute('aria-pressed', String(overhangOn()));
    const [width, depth] = globals().plateMm;
    $('#fdm-plate-toggle')?.setAttribute('title', `Build plate ${round(width)} × ${round(depth)}`
      + ' mm at Z = 0 (G)');
  }

  // ---- Panel ------------------------------------------------------------------
  const panelOpen = () => $('#fdm-panel') && !$('#fdm-panel').hidden;
  let popEscape = null;

  const setIfIdle = (selector, apply) => {
    const element = $(selector);
    if (element && ctx.env.document.activeElement !== element) apply(element);
  };

  // Printed checkbox, up-axis select and relation badge of one body (panel
  // rows and the parts-tree row expansion).
  function bodyControls(body, modelId = state.after) {
    const relation = body.printed ? relationOf(ready(modelId, body)) : relationOf(body);
    const pending = body.printed && !ready(modelId, body) && active();
    const presets = UP_PRESETS.map(preset => `<option value="${preset.id}"`
      + `${sameUp(preset.up, body.up) ? ' selected' : ''}>${escape(preset.label)}</option>`);
    const custom = UP_PRESETS.some(preset => sameUp(preset.up, body.up)) ? ''
      : `<option value="custom" selected>${escape(body.upFrom ? `−n of ${body.upFrom}`
        : upLabel(body.up))}</option>`;
    return `<label class="fdm-body-printed"><input type="checkbox" data-fdm-printed`
      + `${body.printed ? ' checked' : ''}> printed</label><label class="fdm-body-up">up <select`
      + ` data-fdm-up aria-label="Up axis of ${escape(body.alias)}">${custom}${presets.join('')}`
      + `</select></label>${active() ? badgeMarkup(relation, { pending }) : ''}`;
  }
  function bindBodyControls(element, modelId, bodyId) {
    const printed = element?.querySelector?.('[data-fdm-printed]');
    if (printed) printed.onchange = () => setPrinted(modelId, bodyId, printed.checked);
    const select = element?.querySelector?.('[data-fdm-up]');
    if (select) {
      select.onchange = () => {
        const preset = UP_PRESETS.find(item => item.id === select.value);
        if (preset) setUp(modelId, bodyId, preset.up, null);
      };
    }
  }

  function bodyRow(modelId, body) {
    const name = body.name ? `<span class="fdm-body-name">${escape(body.name)}</span>` : '';
    return `<li class="fdm-body" data-body="${escape(body.id)}"><span class="fdm-body-alias"`
      + ` title="${escape(body.id)}">${escape(body.alias)}</span>${name}`
      + `${bodyControls(body, modelId)}</li>`;
  }

  function renderPanel() {
    if (!panelOpen()) return;
    const { alphaDeg, smallBoreMm, plateMm } = globals();
    setIfIdle('#fdm-plate-input', element => {
      element.checked = plateOn();
    });
    setIfIdle('#fdm-overhang-input', element => {
      element.checked = overhangOn();
    });
    setIfIdle('#fdm-plate-width', element => {
      element.value = String(plateMm[0]);
    });
    setIfIdle('#fdm-plate-depth', element => {
      element.value = String(plateMm[1]);
    });
    setIfIdle('#fdm-alpha', element => {
      element.value = String(alphaDeg);
    });
    setIfIdle('#fdm-small-bore', element => {
      element.checked = smallBoreMm !== null;
    });
    const beta = $('#fdm-beta');
    if (beta) beta.textContent = `slicer threshold β = ${degreesText(betaOf(alphaDeg))}`;
    const modelId = state.after;
    const bodies = modelId ? bodiesOf(modelId) : null;
    const title = $('#fdm-bodies-title');
    if (title) {
      title.textContent = modelId ? `Bodies · ${app.revisionName?.(modelId) || 'model'}`
        : 'Bodies';
    }
    const list = $('#fdm-bodies');
    if (!list) return;
    list.innerHTML = bodies ? bodies.map(body => bodyRow(modelId, body)).join('')
      : '<li class="fdm-muted">Open a model to list its bodies.</li>';
    for (const row of $$('#fdm-bodies .fdm-body')) {
      bindBodyControls(row, modelId, row.dataset.body);
    }
  }

  function closePanel({ focus = false } = {}) {
    const panel = $('#fdm-panel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    $('#fdm-panel-toggle')?.setAttribute('aria-expanded', 'false');
    popEscape?.();
    popEscape = null;
    if (focus) $('#fdm-panel-toggle')?.focus?.();
  }
  function openPanel() {
    const panel = $('#fdm-panel');
    if (!panel) return;
    panel.hidden = false;
    $('#fdm-panel-toggle')?.setAttribute('aria-expanded', 'true');
    popEscape ??= keyboard.pushEscape(() => closePanel({ focus: true }));
    renderPanel();
  }
  const togglePanel = () => (panelOpen() ? closePanel() : openPanel());

  function bindPanel() {
    const on = (selector, event, handler) => {
      const element = $(selector);
      if (element) element[event] = handler;
    };
    on('#fdm-panel-close', 'onclick', () => closePanel({ focus: true }));
    on('#fdm-plate-input', 'onchange', () => commands.run('fdm.plate'));
    on('#fdm-overhang-input', 'onchange', () => commands.run('fdm.overhang'));
    on('#fdm-small-bore', 'onchange', event => {
      settings.set('G', 'fdmSmallBore', !!event.target.checked);
      refresh('fdm.smallBore');
    });
    let alphaTimer = null;
    on('#fdm-alpha', 'oninput', event => {
      ctx.env.clearTimeout(alphaTimer);
      alphaTimer = ctx.env.setTimeout(() => setAlpha(event.target.value), 250);
    });
    on('#fdm-alpha', 'onchange', event => setAlpha(event.target.value));
    const plateSize = () => {
      const size = cleanPlate([Number($('#fdm-plate-width')?.value),
        Number($('#fdm-plate-depth')?.value)]);
      settings.set('G', 'fdmPlateWidthMm', size[0]);
      settings.set('G', 'fdmPlateDepthMm', size[1]);
      refresh('fdm.plateSize');
    };
    on('#fdm-plate-width', 'onchange', plateSize);
    on('#fdm-plate-depth', 'onchange', plateSize);
    on('#fdm-print-face', 'onclick', () => commands.run('fdm.printOnFace'));
  }

  // ---- Actions ------------------------------------------------------------------
  const whereOf = (modelId, bodyId) => {
    const body = (bodiesOf(modelId) ?? []).find(item => item.id === bodyId);
    return body ? { source: sourceOf(modelId), body: body.key, alias: body.alias } : null;
  };

  function setPrinted(modelId, bodyId, printed) {
    const where = whereOf(modelId, bodyId);
    if (!where) return;
    settings.set('SB', 'fdmPrinted', printed ? null : false, where);
    ctx.notify(`${where.alias} ${printed ? 'printed' : 'not printed: excluded from the checks'}`);
    refresh('fdm.printed');
  }

  function setUp(modelId, bodyId, up, fromAlias) {
    const where = whereOf(modelId, bodyId);
    if (!where) return;
    const isDefault = !fromAlias && sameUp(up, DEFAULT_UP);
    settings.set('SB', 'fdmUp', isDefault ? null : [...up], where);
    settings.set('SB', 'fdmUpFrom', fromAlias ?? null, where);
    refresh('fdm.up');
  }

  function setAlpha(value) {
    const alphaDeg = cleanAlpha(value);
    if (alphaDeg === globals().alphaDeg) return;
    settings.set('G', 'fdmAlphaDeg', alphaDeg);
    refresh('fdm.alpha');
  }

  function toggleSetting(key, value) {
    const modelId = state.after;
    if (!modelId) return;
    // A toggle is also the retry of a failed request.
    for (const shown of displayed()) {
      if (models.get(shown)) models.get(shown).error = null;
    }
    settings.set('S', key, value, { source: sourceOf(modelId) });
    refresh(`fdm.${key}`);
    app.scheduleDraw?.();
  }

  // Shift+B: up = −n of the selected planar face (exact outward normal).
  async function printOnFace() {
    const reference = state.selection;
    if (!reference || reference.entityType !== 'face') {
      ctx.notify('Print on selected face: select a planar face first');
      return null;
    }
    const model = renderer.model?.(reference.modelId);
    const bodyIndex = model?.bodyIndexById?.get(reference.bodyId)
      ?? model?.bodies?.findIndex(body => body.id === reference.bodyId);
    if (!model || !(bodyIndex >= 0)) {
      ctx.notify('Print on selected face: the model is not loaded yet');
      return null;
    }
    const alias = `B${bodyIndex + 1}.F${reference.entityIndex + 1}`;
    let face;
    try {
      const data = await api.json(`/api/models/${reference.modelId}/geometry?aliases=`
        + encodeURIComponent(alias));
      face = data.faces?.[0];
    } catch (error) {
      ctx.notify(`Print on selected face: exact geometry unavailable (${error.message})`);
      return null;
    }
    if (!face?.outwardNormal) {
      ctx.notify(`Print on selected face needs a planar face; ${alias} is a`
        + ` ${face?.surface?.type ?? 'non-planar'} face`);
      return null;
    }
    const up = face.outwardNormal.map(value => (value === 0 ? 0 : -value));
    setUp(reference.modelId, reference.bodyId, up, alias);
    ctx.notify(`B${bodyIndex + 1} up = −n of ${alias} ${upLabel(up)} · the geometry is not moved`);
    return up;
  }

  commands.register({
    id: 'fdm.plate', label: 'Build plate', keys: ['G'], enabled: () => !!state.after,
    run: () => toggleSetting('fdmPlate', !plateOn()),
  });
  commands.register({
    id: 'fdm.overhang', label: 'Overhang shading', keys: ['Shift+G'],
    enabled: () => !!state.after, run: () => toggleSetting('fdmOverhang', !overhangOn()),
  });
  commands.register({
    id: 'fdm.printOnFace', label: 'Print on selected face', keys: ['Shift+B'],
    enabled: () => !!state.after, run: () => {
      printOnFace().catch(error => ctx.notify(error.message));
    },
  });
  commands.register({ id: 'fdm.panel', label: 'Print check panel', run: togglePanel });
  commands.bind('#fdm-plate-toggle', 'fdm.plate');
  commands.bind('#fdm-overhang-toggle', 'fdm.overhang');
  commands.bind('#fdm-panel-toggle', 'fdm.panel');
  bindPanel();

  // ---- Parts tree and inspector -------------------------------------------------
  // parts-tree renders these per body row: render({ modelId, bodyId }) -> markup.
  slots.parts.rowBadge({
    id: 'fdm.plate', order: 20,
    render({ modelId, bodyId }) {
      if (!active()) return '';
      const body = (bodiesOf(modelId) ?? []).find(item => item.id === bodyId);
      if (!body) return '';
      if (!body.printed) return badgeMarkup(relationOf(body), { compact: true });
      const data = ready(modelId, body);
      return data ? badgeMarkup(relationOf(data), { compact: true })
        : badgeMarkup(null, { pending: true });
    },
  });
  // Row expansion of the parts tree: printed flag and up axis of the body
  // (parts-tree lists `parts.rowDetail` items and calls bind({ element, … })).
  slots.add('parts.rowDetail', {
    id: 'fdm.print', order: 30,
    render({ modelId, bodyId }) {
      const body = (bodiesOf(modelId) ?? []).find(item => item.id === bodyId);
      return body ? `<div class="fdm-part-detail">${bodyControls(body)}</div>` : '';
    },
    bind({ element, modelId, bodyId }) {
      bindBodyControls(element, modelId, bodyId);
    },
  });

  const faceEntry = (modelId, reference, bodyIndex) => {
    const body = (bodiesOf(modelId) ?? []).find(item => item.id === reference.bodyId);
    const data = body ? ready(modelId, body) : null;
    const alias = `B${bodyIndex + 1}.F${reference.entityIndex + 1}`;
    return { body, data, face: data?.faces?.find(face => face.fragments.includes(alias)) };
  };
  // Inner markup of the inspector's "Print check" section.
  function printSection(reference) {
    const model = renderer.model?.(reference.modelId);
    const bodyIndex = model?.bodyIndexById?.get(reference.bodyId) ?? -1;
    const { body, data, face } = faceEntry(reference.modelId, reference, bodyIndex);
    if (!body) return '<h3>Print check</h3><p class="small fdm-muted">Model not loaded yet</p>';
    const lines = [];
    if (!body.printed) lines.push('not printed: excluded from the checks');
    else if (!data) lines.push('pending: waiting for the printability API');
    else {
      const relation = relationOf(data);
      if (relation) lines.push(`${body.alias} ${relation.text}`);
      if (reference.entityType === 'face') lines.push(faceSummary(face) ?? 'not classified');
    }
    return `<h3>Print check</h3><p class="small">${lines.map(escape).join('<br>')}</p>`
      + '<p class="small fdm-muted">'
      + `up ${escape(body.upFrom ? `−n of ${body.upFrom}` : upLabel(body.up))}`
      + ` · α max ${escape(degreesText(globals().alphaDeg))}</p>`
      + (reference.entityType === 'face' ? '<button id="fdm-print-this-face" type="button"'
        + ' class="button secondary">Print on this face <kbd>⇧B</kbd></button>' : '');
  }
  const bindPrintSection = () => {
    const button = $('#fdm-print-this-face');
    if (button) button.onclick = () => commands.run('fdm.printOnFace');
  };
  // Answers arrive after the inspector rendered: patch only this section.
  function patchInspector() {
    const element = $('#fdm-print');
    const reference = state.selection;
    if (!element || !reference || element.dataset?.reference === undefined) return;
    element.innerHTML = printSection(reference);
    bindPrintSection();
  }
  slots.inspector.section({
    id: 'fdm.print', order: 35,
    when: ({ reference }) => active() && !!reference
      && ['face', 'body'].includes(reference.entityType),
    render: ({ reference }) => '<section id="fdm-print" class="inspector-section fdm-print"'
      + ` data-reference="${escape(reference.modelId)}">${printSection(reference)}</section>`,
    bind: bindPrintSection,
  });

  // "exempt: small bore" labels at the display centre of exempt faces. The
  // anchors (display points, a label position only) are cached per answer
  // version; each overlay render only projects them.
  let anchorCache = { key: null, anchors: [] };
  function exemptAnchors(modelId) {
    const key = `${store.get().fdm.version}|${modelId}`;
    if (anchorCache.key === key) return anchorCache.anchors;
    const anchors = [];
    for (const [bodyId, data] of resultsOf(modelId)) {
      for (const face of data.faces) {
        if (face.kind !== 'exempt-small-bore' || anchors.length >= MAX_LABELS) continue;
        const points = face.fragments.flatMap(alias => renderer.entityPoints?.({
          modelId, bodyId, entityType: 'face', entityIndex: Number(alias.split('.F')[1]) - 1,
        }) ?? []);
        if (!points.length) continue;
        anchors.push({
          center: [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0)
            / points.length),
          text: `${EXEMPT_LABEL} Ø${Number(face.diameterMm.toFixed(3))}`,
        });
      }
    }
    anchorCache = { key, anchors };
    return anchors;
  }
  ctx.overlay.layer({
    id: 'fdm.labels', order: 55,
    render() {
      if (!overhangOn()) return '';
      const labels = [];
      for (const pane of app.viewPanes?.() ?? []) {
        if (!renderer.model?.(pane.modelId)) continue;
        for (const { center, text } of exemptAnchors(pane.modelId)) {
          const at = app.project(center, pane);
          if (!Number.isFinite(at?.x) || at.x < pane.clipX
            || at.x > pane.clipX + pane.clipWidth) continue;
          const width = text.length * 6 + 14;
          labels.push(`<g class="fdm-label" transform="translate(${Math.round(at.x)}`
            + ` ${Math.round(at.y)})"><rect x="${-Math.round(width / 2)}" y="-11"`
            + ` width="${Math.round(width)}" height="20" rx="5"/><text x="0" y="3"`
            + ` text-anchor="middle">${escape(text)}</text></g>`);
        }
      }
      return labels.join('');
    },
  });

  // ---- Refresh ------------------------------------------------------------------
  const perf = { refreshes: 0, frameHookMs: 0, frameHooks: 0 };
  function refresh(reason = 'fdm.refresh') {
    perf.refreshes++;
    if (active()) {
      for (const modelId of displayed()) request(modelId);
    }
    composeDisplay();
    renderButtons();
    renderStatus();
    renderLegend();
    renderPanel();
    patchInspector();
    bump(reason);
    app.renderParts?.();
    app.scheduleDraw?.();
  }

  // Re-check after frames: the draw model and body visibility arrive there.
  let frameKey = null;
  ctx.onFrame(() => {
    const started = globalThis.performance?.now?.() ?? 0;
    const key = displayed().map(modelId => `${modelId}:${!!renderer.model?.(modelId)}:`
      + visibility(modelId).map(([, visible]) => (visible ? 1 : 0)).join('')).join('|')
      + `|${active()}`;
    perf.frameHooks++;
    perf.frameHookMs += (globalThis.performance?.now?.() ?? 0) - started;
    if (key === frameKey) return;
    frameKey = key;
    refresh('fdm.frame');
  });

  const plate = createPlateLayer(ctx, {
    active: () => plateOn(), sizeMm: () => globals().plateMm,
  });
  const stops = [
    settings.onChange(() => refresh('fdm.settings')),
    store.select(current => `${current.compare?.after}|${current.compare?.before}|`
      + `${current.compare?.compare}`, () => refresh('fdm.models')),
    store.select(current => current.selection?.selection ?? null, () => renderPanel()),
  ];

  return {
    api: {
      // Debug and QA handle (window.wonkyViewer.app).
      fdmStatus: () => ({
        plate: plateOn(), overhang: overhangOn(), ...globals(), displayed: displayed(),
        models: displayed().map(modelId => ({
          modelId, revision: revisionLabel(modelId), pending: active() && pendingOf(modelId),
          inflight: !!models.get(modelId)?.inflight, error: models.get(modelId)?.error ?? null,
          bodies: (bodiesOf(modelId) ?? []).map(body => ({
            ...body, relation: relationOf(body.printed ? ready(modelId, body) : body)?.text
              ?? null,
          })),
        })),
        plateLayer: plate.stats(),
        perf: { ...perf },
        legend: $('#fdm-legend')?.hidden ? null : $('#fdm-legend')?.textContent ?? null,
        status: $('#fdm-status')?.hidden ? null : $('#fdm-status')?.textContent ?? null,
      }),
      fdmPrintability: modelId => {
        const entry = models.get(modelId ?? state.after);
        return entry ? { meta: entry.meta, bodies: [...entry.bodies.values()].map(item => item
          .data) } : null;
      },
      fdmSetAlpha: value => setAlpha(value),
      fdmSetPrinted: (bodyId, printed, modelId = state.after) => setPrinted(modelId, bodyId,
        printed),
      fdmSetUp: (bodyId, up, modelId = state.after) => setUp(modelId, bodyId, unitVector(up),
        null),
      fdmPrintOnFace: printOnFace,
    },
    defaults: {
      fdm: { version: 0 },
      'display.fdm': { overhang: null },
    },
    dispose() {
      for (const stop of stops) stop?.();
      plate.dispose();
      closePanel();
    },
  };
}
