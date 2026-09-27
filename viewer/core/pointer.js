// Pointer router for the viewport canvas. It owns the only canvas pointer and
// wheel listeners and turns events into gestures:
//
//   pointer.tool({ id, navigates, selects, down, drag, up, cancel })
//   pointer.onHover(fn(point))        pointer.onNavigate(fn({ dx, dy, pan }))
//   pointer.onClick(fn(point, { additive, event }))
//   pointer.onWheel(fn(event))        pointer.onLeave(fn())
//   pointer.cancel()
//
// Every press, with or without Shift, ⌘/Ctrl or Alt, has one drag threshold
// (spec section 5): a press that moved less than DRAG_THRESHOLD_PX CSS px is
// a click, at or beyond it a drag. Navigation (orbit, or pan with Shift /
// middle / right button) runs for tools that navigate, and for any tool with
// Alt, Shift or a non-primary button. A primary click of a selecting tool
// reports `additive` when Shift, ⌘ or Ctrl was held (add to / remove from
// the multi-selection), so a jittery Shift-click never pans.
export const DRAG_THRESHOLD_PX = 4;

export const isDrag = (start, point) => Math.hypot(point.x - start.x, point.y - start.y)
  >= DRAG_THRESHOLD_PX;

export function createPointer({ env, canvas, state, scheduleDraw, clearHover }) {
  const tools = new Map();
  const hooks = { hover: [], navigate: [], click: [], wheel: [], leave: [] };
  let gesture = null;

  const call = (name, ...args) => {
    for (const hook of hooks[name]) hook(...args);
  };
  const currentTool = () => tools.get(state.tool) ?? { navigates: true };
  const pointFromEvent = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const reset = () => {
    gesture = null;
    for (const tool of tools.values()) tool.cancel?.();
    canvas.classList.remove('dragging');
  };

  canvas.addEventListener('pointerdown', event => {
    if (!state.after || state.loading) return;
    clearHover();
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    const tool = currentTool();
    const navigate = !!tool.navigates || event.altKey || event.shiftKey || event.button !== 0;
    gesture = {
      start: point, previous: point, moved: false, navigate,
      pan: event.shiftKey || event.button === 1 || event.button === 2,
      select: !!tool.selects && !event.altKey && event.button === 0,
      additive: !!(event.shiftKey || event.metaKey || event.ctrlKey),
    };
    if (!navigate) tool.down?.(point, gesture, event);
  });

  canvas.addEventListener('pointermove', event => {
    if (!gesture) {
      if (event.buttons || event.pointerType === 'touch') clearHover();
      else call('hover', pointFromEvent(event));
      return;
    }
    const point = pointFromEvent(event);
    const dx = point.x - gesture.previous.x;
    const dy = point.y - gesture.previous.y;
    if (isDrag(gesture.start, point)) gesture.moved = true;
    if (gesture.navigate && gesture.moved) {
      canvas.classList.add('dragging');
      call('navigate', { dx, dy, pan: gesture.pan });
    } else if (!gesture.navigate) currentTool().drag?.(point, gesture, event);
    // Below the threshold the press stays a click: the start point is kept,
    // so the first navigation step after it includes the whole movement.
    if (gesture.moved || !gesture.navigate) gesture.previous = point;
    scheduleDraw();
  });

  canvas.addEventListener('pointerup', event => {
    if (!gesture) return;
    const point = pointFromEvent(event);
    if (isDrag(gesture.start, point)) gesture.moved = true;
    if (gesture.navigate) {
      if (!gesture.moved && gesture.select) {
        call('click', point, { additive: gesture.additive, event });
      }
    } else currentTool().up?.(point, gesture, event);
    reset();
    scheduleDraw();
  });

  canvas.addEventListener('pointerleave', () => {
    clearHover();
    call('leave');
  });
  for (const name of ['pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, () => {
      clearHover();
      reset();
      scheduleDraw();
    });
  }
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('wheel', event => call('wheel', event), { passive: false });

  return {
    tool(definition) {
      if (tools.has(definition.id)) {
        throw new Error(`Pointer tool ${definition.id} is registered twice`);
      }
      tools.set(definition.id, definition);
    },
    tools: () => [...tools.keys()],
    onHover: fn => hooks.hover.push(fn),
    onNavigate: fn => hooks.navigate.push(fn),
    onClick: fn => hooks.click.push(fn),
    onWheel: fn => hooks.wheel.push(fn),
    onLeave: fn => hooks.leave.push(fn),
    gesture: () => gesture,
    // Escape / tool change: drop the current gesture and any pending drawing.
    cancel() {
      gesture = null;
      for (const tool of tools.values()) tool.cancel?.();
    },
    pointFromEvent,
    env,
  };
}
