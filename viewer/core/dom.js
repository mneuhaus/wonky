// DOM helpers bound to one document, plus escaping, small value helpers and
// focus handling (help-a11y):
//
//   patch(element, markup)             replace markup, keep keyboard focus
//   preserveFocus(root, render)        the same around any render function
//   focusables(container)              visible, enabled, tabbable elements
//   trapFocus(container, options)      Tab cycles inside; release() returns focus
//
// A focused element is found again after a re-render by, in this order: its
// id, its data-focus-key, its form-control name, or (inside the patched
// root only) its position when tag and text are unchanged. The text-input
// caret and the root's scroll position are restored as well.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const RAW = Symbol('raw html');

export const escape = value => String(value ?? '')
  .replace(/[&<>"']/g, character => ESCAPES[character]);
export const clone = value => JSON.parse(JSON.stringify(value));
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Marks trusted markup for html``.
export const raw = markup => ({ [RAW]: String(markup) });

const part = value => {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(part).join('');
  if (typeof value === 'object' && RAW in value) return value[RAW];
  return escape(value);
};

// Escaping template: interpolated values are escaped unless wrapped in raw();
// arrays are joined. html`<b>${name}</b>` returns a raw() markup object.
export function html(strings, ...values) {
  let markup = strings[0];
  values.forEach((value, index) => {
    markup += part(value) + strings[index + 1];
  });
  return raw(markup);
}

export const markupOf = value => part(value);

export function createDom(document) {
  return {
    document,
    $: selector => document.querySelector(selector),
    $$: selector => [...document.querySelectorAll(selector)],
  };
}

// ---- Focus ----

const TABBABLE = ['a[href]', 'area[href]', 'button', 'input:not([type="hidden"])', 'select',
  'textarea', 'summary', 'iframe', '[tabindex]', '[contenteditable="true"]'].join(',');
const TEXT_INPUT = /^(text|search|url|tel|password|email|number)?$/;

const quoted = value => `"${String(value).replace(/["\\]/g, '\\$&')}"`;

const query = (root, selector) => {
  try {
    return root?.querySelector?.(selector) ?? null;
  } catch {
    return null;
  }
};

const contains = (root, node) => !!node && !!root?.contains?.(node);

// Position of `element` below `root` as a :scope child chain, or null.
function pathOf(element, root) {
  const steps = [];
  for (let node = element; node && node !== root; node = node.parentElement) {
    const parent = node.parentElement;
    if (!parent) return null;
    const index = [...parent.children].indexOf(node) + 1;
    steps.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
  }
  return steps.length ? `:scope > ${steps.join(' > ')}` : null;
}

// A selector that finds `element` again after its root re-rendered, or null.
// With a `root` element the structural position is the last resort.
export function focusKey(element, root = null) {
  if (!element?.getAttribute) return null;
  if (element.id) return { selector: `[id=${quoted(element.id)}]` };
  const key = element.dataset?.focusKey;
  if (key) return { selector: `[data-focus-key=${quoted(key)}]` };
  const name = element.getAttribute('name');
  if (name && element.tagName) {
    return { selector: `${element.tagName.toLowerCase()}[name=${quoted(name)}]` };
  }
  const path = root?.nodeType === 1 ? pathOf(element, root) : null;
  if (!path) return null;
  return { selector: path, tag: element.tagName, text: element.textContent?.trim() ?? '' };
}

const findKey = (root, key) => {
  const found = key ? query(root, key.selector) : null;
  if (!found || !key.tag) return found;
  // Structural matches must be the same control, not whatever moved there.
  const same = found.tagName === key.tag && (found.textContent?.trim() ?? '') === key.text;
  return same ? found : null;
};

// Snapshot of the focus inside `root` (null when focus is elsewhere).
export function captureFocus(root, document = root?.ownerDocument) {
  const active = document?.activeElement;
  if (!contains(root, active) || active === root) return null;
  const snapshot = { key: focusKey(active, root), scrollTop: root.scrollTop };
  if (typeof active.selectionStart === 'number' && TEXT_INPUT.test(active.type ?? '')) {
    snapshot.selection = [active.selectionStart, active.selectionEnd, active.selectionDirection];
  }
  return snapshot;
}

// Focuses the element of a snapshot again; returns it (or null).
export function restoreFocus(root, snapshot) {
  if (!snapshot) return null;
  const element = findKey(root, snapshot.key);
  if (typeof snapshot.scrollTop === 'number' && root.scrollTop !== snapshot.scrollTop) {
    root.scrollTop = snapshot.scrollTop;
  }
  if (!element?.focus) return null;
  element.focus({ preventScroll: true });
  if (snapshot.selection && typeof element.setSelectionRange === 'function') {
    try {
      element.setSelectionRange(...snapshot.selection);
    } catch {
      // Input types without a caret (number in some engines).
    }
  }
  return element;
}

// Runs render() and keeps keyboard focus on the same control inside `root`.
export function preserveFocus(root, render, document = root?.ownerDocument) {
  const snapshot = captureFocus(root, document);
  const result = render();
  restoreFocus(root, snapshot);
  return result;
}

// Replaces an element's markup and restores keyboard focus (see above).
export function patch(element, markup, document = element.ownerDocument) {
  preserveFocus(element, () => {
    element.innerHTML = markupOf(markup);
  }, document);
}

const visible = element => {
  if (element.closest?.('[hidden],[inert]')) return false;
  if (typeof element.getClientRects === 'function' && !element.getClientRects().length) {
    return false;
  }
  const view = element.ownerDocument?.defaultView;
  return view?.getComputedStyle?.(element).visibility !== 'hidden';
};

// Tabbable elements of `container` in DOM order: visible, enabled, tabIndex >= 0.
export function focusables(container) {
  const list = [...(container?.querySelectorAll?.(TABBABLE) ?? [])];
  return list.filter(element => !element.disabled && element.tabIndex >= 0 && visible(element));
}

// Keeps Tab and Shift+Tab inside `container` while focus is in it, moves
// focus to `initial` (else the first tabbable, else the container) and
// returns { release({ restore }) }. release() gives focus back to the opener
// (or its re-rendered copy, else `fallback`) when focus is still inside the
// container or was lost to <body>; focus moved elsewhere on purpose stays.
export function trapFocus(container, { initial = null, opener, fallback = null } = {}) {
  const document = container.ownerDocument;
  const origin = opener === undefined ? document.activeElement : opener;
  const originKey = origin && origin !== document.body ? focusKey(origin) : null;
  const onKeydown = event => {
    if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey) return;
    const list = focusables(container);
    const active = document.activeElement;
    const inside = contains(container, active);
    if (!list.length) {
      event.preventDefault();
      container.focus?.({ preventScroll: true });
      return;
    }
    const target = event.shiftKey
      ? (!inside || active === list[0] || active === container) && list.at(-1)
      : (!inside || active === list.at(-1)) && list[0];
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
  };
  container.addEventListener('keydown', onKeydown);
  const first = initial ?? focusables(container)[0] ?? container;
  first?.focus?.({ preventScroll: true });
  let released = false;
  return {
    container,
    opener: origin,
    release({ restore = true } = {}) {
      if (released) return null;
      released = true;
      container.removeEventListener('keydown', onKeydown);
      if (!restore) return null;
      const active = document.activeElement;
      const lost = !active || active === document.body || contains(container, active);
      if (!lost) return null;
      const back = origin?.isConnected ? origin : findKey(document, originKey);
      const target = back ?? fallback;
      target?.focus?.({ preventScroll: true });
      return target ?? null;
    },
  };
}
