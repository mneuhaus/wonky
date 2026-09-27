// Fake browser environment for viewer state tests (VS harness and core
// tests). Every querySelector() result is a lazily created element keyed by
// its selector, so tests can drive handlers through ui.node('#id').
// Elements keep one handler per event name (like `onclick` properties), so
// the viewer registers exactly one listener per element and event.
// requestAnimationFrame queues callbacks until flushFrames(); timers never
// fire. fetch() answers through `dispatch(path, options)` with ok: true; an
// ArrayBuffer or typed array answer is a binary body (arrayBuffer()).
export function createFakeEnvironment({ dispatch = () => ({}), hash = '' } = {}) {
  const nodes = new Map();
  const history = { url: '', replaceState(_state, _title, url) { this.url = url; } };
  const clipboard = { text: '' };
  const frames = [];
  let document;
  const element = () => {
    const handlers = new Map();
    const classes = new Set();
    const attributes = new Map();
    return {
      value: '', textContent: '', innerHTML: '', hidden: false, dataset: {}, style: {},
      clientWidth: 1000, clientHeight: 600,
      addEventListener(name, handler) { handlers.set(name, handler); },
      emit(name, values = {}) {
        handlers.get(name)?.({
          preventDefault() {}, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', ...values,
        });
      },
      classList: {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
        contains: value => classes.has(value),
        toggle(value, enabled) {
          if (enabled) classes.add(value);
          else classes.delete(value);
        },
      },
      setAttribute(name, value) { attributes.set(name, value); },
      getAttribute: name => attributes.get(name),
      scrollIntoView() {},
      getBoundingClientRect() {
        return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
      },
      focus() { document.activeElement = this; },
      blur() { document.activeElement = null; },
      setPointerCapture() {},
      append(child) { this.innerHTML += child.innerHTML; },
    };
  };
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  document = {
    ...element(), querySelector: node, querySelectorAll: () => [], createElement: element,
  };
  const window = element();
  const env = {
    document, window, history,
    ResizeObserver: class { observe() {} },
    location: { hash }, URLSearchParams,
    setTimeout: () => 0, clearTimeout() {},
    requestAnimationFrame: callback => frames.push(callback),
    navigator: { clipboard: { async writeText(value) { clipboard.text = value; } } },
    fetch: async (path, options) => {
      const data = await dispatch(path, options);
      if (ArrayBuffer.isView(data) || data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(ArrayBuffer.isView(data) ? data.buffer : data,
          data.byteOffset ?? 0, data.byteLength);
        return { ok: true, arrayBuffer: async () => bytes.slice().buffer };
      }
      return { ok: true, json: async () => structuredClone(data) };
    },
  };
  return {
    env, node, document, window, history, clipboard,
    flushFrames() {
      while (frames.length) frames.shift()();
    },
  };
}
