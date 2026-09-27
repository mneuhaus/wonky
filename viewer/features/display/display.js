// Display feature (render-look): the single caller of renderer.setStyle().
// It composes the display.* store keys of every feature (render/style.js)
// into the renderer style table, owns the look keys, and adds:
//
//   Shift+E   seam and subdivision edges shown dimmed (G setting hiddenEdges)
//   T         x-ray: every body 50 % transparent, hidden edges faint
//             (S setting xray, per source; view action #xray-toggle)
//   legend    status bar: display tolerance and active display-only features
//   settings  edge width 1..3 CSS px (G edgeWidthPx); feature edges E (G
//             featureEdges, the view feature's display.edges toggle)
//
// Store keys written here: display.look, display.xray, display.debug.
// Debug and QA handle (window.wonkyViewer.app): displayStyle(), bodyColors(id),
// setEdgeWidth(px), debugStyle(patch | null), debugLayer(options | null).
import { EDGE_LOOK } from '../../render/shaders.js';
import { composeStyle } from '../../render/style.js';
import { createLegend, LEGEND_MARKUP } from './legend.js';

export const id = 'display';
export const legacy = false;

const XRAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"'
  + ' stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">'
  + '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/>'
  + '<path d="m4 7.5 8 4.5 8-4.5M12 12v9" stroke-dasharray="2 2"/></svg>';
const XRAY_BUTTON = '<button id="xray-toggle" class="icon-button" type="button"'
  + ' aria-pressed="false" title="X-ray: all bodies 50 % transparent (T)"'
  + ` aria-label="X-ray">${XRAY_ICON}</button>`;

const SETTINGS = [
  { id: 'display.edgeWidth', order: 40, label: 'Edge width', scope: 'G', key: 'edgeWidthPx',
    type: 'number', min: EDGE_LOOK.minWidthPx, max: EDGE_LOOK.maxWidthPx, step: 0.25,
    default: EDGE_LOOK.widthPx, unit: 'CSS px' },
  { id: 'display.hiddenEdges', order: 41, label: 'Seam and subdivision edges (Shift+E)',
    scope: 'G', key: 'hiddenEdges', type: 'boolean', default: false,
    description: 'Shows the hidden edge classes dimmed' },
];

const clampWidth = value => Math.min(EDGE_LOOK.maxWidthPx, Math.max(EDGE_LOOK.minWidthPx,
  Number(value)));

export function setup(ctx) {
  const { store, renderer, commands, slots, settings, state, app, dom: { $ } } = ctx;
  slots.viewActions.button({ id: 'display.xray', order: 12, html: XRAY_BUTTON });
  slots.statusBar.item({ id: 'display.legend', order: 70, html: LEGEND_MARKUP });
  for (const item of SETTINGS) slots.settings.item(item);

  const display = () => store.get().display;
  let applied = null;
  function apply() {
    const next = composeStyle(display());
    const key = JSON.stringify(next);
    if (key === applied) return;
    applied = key;
    renderer.setStyle(next);
    $('#xray-toggle')?.setAttribute('aria-pressed', String(next.xray));
    app.scheduleDraw?.();
  }
  const update = (reason, recipe) => store.update(reason, current => recipe(current.display));

  // ---- Settings (G: look, feature edges; S: x-ray per source) ----
  const sourceOf = modelId => (modelId ? app.sourceKey?.(modelId) || modelId : null);
  let restored = false;
  function restoreXray() {
    const source = sourceOf(state.after);
    const on = source ? settings.get('S', 'xray', false, { source }) === true : false;
    if (display().xray.on !== on) update('display.xray', current => {
      current.xray.on = on;
    });
  }
  // Applies the saved look on load and on every later change (the Settings
  // dialog writes these keys directly, so a one-shot restore left them
  // unapplied until a reload). Each value is applied only when it differs
  // from the store, so the feature's own writes come back as no-ops.
  function restore() {
    if (!settings.loaded()) return;
    restored = true;
    const width = Number(settings.get('G', 'edgeWidthPx', EDGE_LOOK.widthPx));
    const edgeWidthPx = Number.isFinite(width) ? clampWidth(width) : EDGE_LOOK.widthPx;
    const hidden = settings.get('G', 'hiddenEdges', false) === true;
    const look = display().look;
    if (look.edgeWidthPx !== edgeWidthPx || look.hiddenEdges !== hidden) {
      update('display.look', current => {
        current.look.edgeWidthPx = edgeWidthPx;
        current.look.hiddenEdges = hidden;
      });
    }
    const edges = settings.get('G', 'featureEdges', true) !== false;
    const visible = display().edges?.visible;
    if (edges ? visible === false : visible !== false) commands.run('view.toggleEdges');
    restoreXray();
  }
  const stopSettings = settings.onChange(restore);
  const stopSource = store.select(current => current.compare?.after ?? null, () => {
    if (restored) restoreXray();
  });
  const stopEdges = store.select(current => current.display.edges?.visible, visible => {
    if (restored && typeof visible === 'boolean') settings.set('G', 'featureEdges', visible);
  });

  // ---- Commands ----
  function toggleHiddenEdges() {
    const hidden = !display().look.hiddenEdges;
    update('display.look', current => {
      current.look.hiddenEdges = hidden;
    });
    settings.set('G', 'hiddenEdges', hidden);
    ctx.notify?.(hidden ? 'Seam and subdivision edges shown dimmed'
      : 'Seam and subdivision edges hidden');
  }
  function toggleXray() {
    const on = !display().xray.on;
    update('display.xray', current => {
      current.xray.on = on;
    });
    const source = sourceOf(state.after);
    if (source) settings.set('S', 'xray', on, { source });
  }
  function setEdgeWidth(px) {
    const width = clampWidth(px);
    if (!Number.isFinite(width)) throw new Error('Edge width must be a number of CSS px');
    update('display.look', current => {
      current.look.edgeWidthPx = width;
    });
    settings.set('G', 'edgeWidthPx', width);
    return width;
  }
  commands.register({
    id: 'display.hiddenEdges', label: 'Seam and subdivision edges (dimmed)', keys: ['Shift+E'],
    run: toggleHiddenEdges,
  });
  commands.register({ id: 'display.xray', label: 'X-ray', keys: ['T'], run: toggleXray });
  commands.bind('#xray-toggle', 'display.xray');

  // ---- Legend ----
  const displayed = () => [...new Set([state.after, state.compare ? state.before : null])]
    .filter(Boolean);
  const legend = createLegend({
    element: () => $('#display-legend'),
    facts: () => displayed().map(modelId => renderer.look?.(modelId)),
    style: () => renderer.style?.() ?? {},
    key: () => [renderer.styleVersion?.(), ...displayed().map(modelId => {
      const model = renderer.model?.(modelId);
      return model ? `${modelId}:${model.source}:${model.counts.faces}` : modelId;
    })].join('|'),
  });
  ctx.onFrame(() => legend.update());

  // ---- Debug handle ----
  let removeDebugLayer = null;
  const debug = { lines: 0, bodies: 0 };
  function debugStyle(patch) {
    update('display.debug', current => {
      current.debug = patch ? { ...current.debug, ...patch } : {};
    });
    return renderer.style();
  }
  // A layer that draws `lines` (frame.drawLines options) and optionally
  // `bodies` (frame.drawBodies options); null removes it.
  function debugLayer(options) {
    removeDebugLayer?.();
    removeDebugLayer = null;
    if (!options) return null;
    removeDebugLayer = renderer.addLayer({
      id: 'display.debug', order: 95,
      draw(frame) {
        if (frame.pane.side !== 'after' && options.allPanes !== true) return;
        if (options.bodies) debug.bodies = frame.drawBodies(options.bodies);
        if (options.lines) debug.lines = frame.drawLines(options.lines);
      },
    });
    app.scheduleDraw?.();
    return debug;
  }

  // Apply once every feature has added its display.* defaults.
  apply();
  const stopStyle = store.select(current => JSON.stringify(current.display), apply);
  queueMicrotask(apply);

  return {
    api: {
      displayStyle: () => renderer.style(),
      bodyColors: modelId => renderer.look?.(modelId)?.bodies ?? [],
      displayLegend: () => legend.items(),
      setEdgeWidth,
      debugStyle,
      debugLayer,
    },
    defaults: {
      'display.look': { edgeWidthPx: EDGE_LOOK.widthPx, hiddenEdges: false },
      'display.xray': { on: false },
      'display.debug': {},
    },
    dispose() {
      stopStyle();
      stopSettings();
      stopSource();
      stopEdges();
      removeDebugLayer?.();
    },
  };
}
