// Tool rail and pointer tools: select, orbit, comment, arrow, box, pen
// (harness: tool). Drawing tools create a pending annotation while dragging.
// Package: reviews-context.
//
// Markup tools are one-shot (spec D8): after one annotation the rail returns
// to Select. Activating the active tool again (its key pressed twice, or a
// second click) or double-clicking its button locks it; a locked tool stays
// until Escape (an exclusive Escape handler, so that Escape does not also
// clear the selection) or until another tool is chosen.
import { clamp } from '../../core/dom.js';

export const MARKUP_TOOLS = Object.freeze(['comment', 'arrow', 'box', 'pen']);
const LOCK_HINT = 'Double-click the tool to keep it';

export const TOOL_HINTS = Object.freeze({
  select: 'Drag to orbit · Scroll to zoom · Shift-drag to pan',
  orbit: 'Drag to orbit · Shift-drag to pan · Scroll to zoom',
  comment: `Click the model to place a comment · ${LOCK_HINT}`,
  arrow: `Drag to draw an arrow · Alt-drag to orbit · ${LOCK_HINT}`,
  box: `Drag around an area · Alt-drag to orbit · ${LOCK_HINT}`,
  pen: `Draw on the current view · Alt-drag to orbit · ${LOCK_HINT}`,
});

// Hint for the tool rail state: one-shot tools say how to keep them.
export function toolHint(name, locked = false) {
  if (!locked) return TOOL_HINTS[name];
  return `${TOOL_HINTS[name].replace(` · ${LOCK_HINT}`, '')} · Locked · Esc to release`;
}

const button = (tool, pressed, label, key, iconName) => `<button class="tool`
  + `${pressed ? ' active' : ''}" data-tool="${tool}" aria-pressed="${pressed}"`
  + ` title="${label} (${key})" aria-label="${label}" data-icon="${iconName}"></button>`;
const entry = (tool, order, pressed, label, key, iconName) => [tool, order,
  button(tool, pressed, label, key, iconName), key, label];

// [tool, rail order, markup, shortcut, label]
export const TOOL_BUTTONS = Object.freeze([
  entry('select', 10, true, 'Select geometry', 'V', 'cursor'),
  entry('orbit', 20, false, 'Orbit and pan', 'H', 'orbit'),
  entry('comment', 40, false, 'Place a comment', 'C', 'comment'),
  entry('arrow', 50, false, 'Draw an arrow', 'A', 'arrow'),
  entry('box', 60, false, 'Draw a box', 'R', 'box'),
  entry('pen', 70, false, 'Draw freely', 'P', 'pen'),
]);

export function createTools(ctx, { addAnnotation, annotationAt }) {
  const { state, app, pointer, renderer, keyboard, dom: { $, $$ } } = ctx;
  const canvas = $('#model-canvas');
  const normalized = point => [clamp(point.x / Math.max(1, canvas.clientWidth), 0, 1),
    clamp(point.y / Math.max(1, canvas.clientHeight), 0, 1)];
  let releaseEscape = null;

  function renderRail() {
    const locked = state.toolLocked;
    $$('.tool[data-tool]').forEach(element => {
      const active = element.dataset.tool === state.tool;
      element.classList.toggle('active', active);
      element.classList.toggle('locked', active && locked);
      element.setAttribute('aria-pressed', String(active));
    });
    $('#interaction-hint').textContent = toolHint(state.tool, locked);
  }

  function unlock() {
    state.toolLocked = false;
    releaseEscape?.();
    releaseEscape = null;
  }

  // Harness `tool(name)`: selects a tool, one-shot (never locked).
  function tool(name) {
    app.clearHover();
    unlock();
    state.tool = name;
    state.pending = null;
    canvas.dataset.tool = name;
    renderRail();
    app.scheduleDraw();
  }

  // Keeps a markup tool until Escape or another tool.
  function lock(name) {
    if (!MARKUP_TOOLS.includes(name)) {
      tool(name);
      return;
    }
    if (state.tool !== name) tool(name);
    if (state.toolLocked) return;
    state.toolLocked = true;
    releaseEscape = keyboard.pushEscape(() => {
      state.pending = null;
      tool('select');
    });
    renderRail();
  }

  // Key or button: a second activation of the active markup tool locks it.
  function activate(name) {
    if (MARKUP_TOOLS.includes(name) && state.tool === name) lock(name);
    else tool(name);
  }

  // After an annotation: back to Select unless the tool is locked.
  function finish() {
    if (!state.toolLocked && MARKUP_TOOLS.includes(state.tool)) tool('select');
  }

  const cancel = () => {
    state.pending = null;
  };
  pointer.tool({ id: 'select', navigates: true, selects: true });
  pointer.tool({ id: 'orbit', navigates: true });
  pointer.tool({
    id: 'comment',
    cancel,
    up(point, gesture) {
      if (gesture.moved) return;
      addAnnotation(annotationAt('comment', [normalized(point)], renderer.pick(point.x, point.y)));
      finish();
    },
  });
  for (const id of ['arrow', 'box', 'pen']) {
    pointer.tool({
      id,
      cancel,
      down(point) {
        state.pending = annotationAt(id, [normalized(point), normalized(point)],
          renderer.pick(point.x, point.y));
      },
      drag(point) {
        if (!state.pending) return;
        if (id !== 'pen') {
          state.pending.points[1] = normalized(point);
          return;
        }
        const last = state.pending.points.at(-1);
        const far = Math.hypot(point.x - last[0] * canvas.clientWidth,
          point.y - last[1] * canvas.clientHeight) > 1;
        if (state.pending.points.length < 4000 && far) state.pending.points.push(normalized(point));
      },
      up(_point, gesture) {
        if (!state.pending || !gesture.moved) return;
        addAnnotation(state.pending);
        finish();
      },
    });
  }
  return { tool, lock, activate, finish };
}
