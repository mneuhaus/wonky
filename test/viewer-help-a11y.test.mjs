// help-a11y: keyboard (single-key setting, event.code matching, modal scope,
// out-of-band guard), focus helpers (preserveFocus, trapFocus), the help
// overlay and settings models, the help feature wiring, the inspector section
// order, the design-token contrast contract and the contrast script's colour
// math. Run: nice node --test test/viewer-help-a11y.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommands } from '../viewer/core/commands.js';
import {
  createKeyboard, isCharacterBinding, isCharacterEvent, keyLabel, matches, parseKey,
} from '../viewer/core/keyboard.js';
import {
  captureFocus, focusables, focusKey, preserveFocus, restoreFocus, trapFocus,
} from '../viewer/core/dom.js';
import {
  bindingCount, shortcutGroups, shortcutsMarkup,
} from '../viewer/features/help/shortcuts.js';
import { parseSettingValue, settingsMarkup } from '../viewer/features/help/settings-panel.js';
import * as help from '../viewer/features/help/help.js';
import { sectionBands } from '../viewer/features/inspector/inspector.js';
import { createViewer } from '../viewer/app.js';
import { loadFeatures } from '../viewer/core/feature-loader.js';
import { LEGACY_FEATURES } from '../viewer/features/index.js';
import { createFakeEnvironment } from '../scripts/viewer/test-support/fake-env.mjs';
import { blend, contrastRatio, failures, staticScan } from '../scripts/viewer/qa/contrast.mjs';

// ---- A minimal DOM for the focus helpers (element tree, a few selectors) ----

function createDocument() {
  const document = { activeElement: null, body: null };
  const matchesCompound = (element, compound) => {
    const not = [];
    let rest = compound.replace(/:not\(([^)]*)\)/g, (match, inner) => {
      not.push(inner);
      return '';
    });
    let nth = null;
    rest = rest.replace(/:nth-child\((\d+)\)/, (match, index) => {
      nth = Number(index);
      return '';
    });
    const attributes = [];
    rest = rest.replace(/\[([a-z-]+)(?:="((?:[^"\\]|\\.)*)")?\]/g, (match, name, value) => {
      attributes.push([name, value?.replace(/\\(.)/g, '$1')]);
      return '';
    });
    if (rest && rest !== '*' && element.tagName !== rest.toUpperCase()) return false;
    if (nth !== null && element.parentElement?.children.indexOf(element) + 1 !== nth) {
      return false;
    }
    for (const [name, value] of attributes) {
      if (!element.hasAttribute(name)) return false;
      if (value !== undefined && element.getAttribute(name) !== value) return false;
    }
    return not.every(inner => !matchesCompound(element, inner));
  };
  const matchesSelector = (element, selector, scope) => selector.split(',').some(part => {
    const steps = part.trim().split(/\s*>\s*/);
    if (steps[0] !== ':scope') return matchesCompound(element, steps[0]);
    let node = element;
    for (let index = steps.length - 1; index >= 1; index--) {
      if (!node || !matchesCompound(node, steps[index])) return false;
      node = node.parentElement;
    }
    return node === scope;
  });
  const TABBABLE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']);
  class Element {
    constructor(tag, attributes = {}, text = '') {
      this.tagName = tag.toUpperCase();
      this.attributes = new Map(Object.entries(attributes));
      this.children = [];
      this.parentElement = null;
      this.text = text;
      this.nodeType = 1;
      this.ownerDocument = document;
      this.listeners = new Map();
      this.scrollTop = 0;
      this.disabled = false;
      this.hidden = false;
      this.value = attributes.value ?? '';
      this.type = attributes.type ?? '';
    }

    get id() {
      return this.attributes.get('id') ?? '';
    }

    get dataset() {
      const key = this.attributes.get('data-focus-key');
      return key === undefined ? {} : { focusKey: key };
    }

    get tabIndex() {
      if (this.attributes.has('tabindex')) return Number(this.attributes.get('tabindex'));
      return TABBABLE_TAGS.has(this.tagName) ? 0 : -1;
    }

    get textContent() {
      return this.text + this.children.map(child => child.textContent).join('');
    }

    get isConnected() {
      let node = this;
      while (node.parentElement) node = node.parentElement;
      return node === document.body;
    }

    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }

    hasAttribute(name) {
      return name === 'hidden' ? this.hidden : this.attributes.has(name);
    }

    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
      }
      return this;
    }

    replaceChildren(...children) {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
      return this.append(...children);
    }

    contains(node) {
      for (let current = node; current; current = current.parentElement) {
        if (current === this) return true;
      }
      return false;
    }

    descendants() {
      return this.children.flatMap(child => [child, ...child.descendants()]);
    }

    querySelectorAll(selector) {
      return this.descendants().filter(node => matchesSelector(node, selector, this));
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }

    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (matchesSelector(node, selector, null)) return node;
      }
      return null;
    }

    getClientRects() {
      return this.closest('[hidden]') ? [] : [{}];
    }

    focus() {
      document.activeElement = this;
    }

    addEventListener(name, handler) {
      this.listeners.set(name, handler);
    }

    removeEventListener(name, handler) {
      if (this.listeners.get(name) === handler) this.listeners.delete(name);
    }

    // Dispatches a keydown from the focused element up through its ancestors.
    key(key, extra = {}) {
      const event = {
        key, shiftKey: false, defaultPrevented: false, ...extra,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      for (let node = document.activeElement; node; node = node.parentElement) {
        node.listeners.get('keydown')?.(event);
      }
      return event;
    }

    setSelectionRange(start, end, direction) {
      Object.assign(this, {
        selectionStart: start, selectionEnd: end, selectionDirection: direction,
      });
    }
  }
  document.body = new Element('body');
  document.activeElement = document.body;
  document.querySelector = selector => document.body.querySelector(selector);
  const h = (tag, attributes, ...children) => {
    const text = children.filter(child => typeof child === 'string').join('');
    return new Element(tag, attributes ?? {}, text)
      .append(...children.filter(child => typeof child !== 'string'));
  };
  return { document, h };
}

// ---- keyboard ----

test('character-key classification follows WCAG 2.1.4', () => {
  for (const key of ['E', 'Shift+E', '?', '[', 'Digit1', 'Numpad5', 'Shift+Digit2']) {
    assert.ok(isCharacterBinding(key), key);
  }
  for (const key of ['Mod+S', 'Mod+Z', 'Alt+[', 'Escape', 'Home', 'ArrowLeft',
    'Shift+ArrowLeft']) {
    assert.ok(!isCharacterBinding(key), key);
  }
  assert.ok(isCharacterEvent({ key: 'e' }));
  assert.ok(isCharacterEvent({ key: '?', shiftKey: true }));
  assert.ok(!isCharacterEvent({ key: 's', metaKey: true }));
  assert.ok(!isCharacterEvent({ key: ' ' }), 'Space activates buttons, it is no shortcut');
  assert.ok(!isCharacterEvent({ key: 'Enter' }));
});

test('digit bindings match event.code; arrow bindings only Arrow* codes', () => {
  const digit = parseKey('Digit1');
  assert.ok(matches(digit, { key: '1', code: 'Digit1' }));
  assert.ok(matches(digit, { key: '!', code: 'Digit1', shiftKey: true }), 'QWERTY Shift+1');
  assert.ok(matches(digit, { key: '&', code: 'Digit1' }), 'AZERTY number row');
  assert.ok(!matches(digit, { key: '1', code: 'Numpad1' }));
  assert.ok(matches(parseKey('Shift+Digit2'), { key: '"', code: 'Digit2', shiftKey: true }));
  assert.ok(!matches(parseKey('Shift+Digit2'), { key: '2', code: 'Digit2' }));
  const arrow = parseKey('ArrowDown');
  assert.ok(matches(arrow, { key: 'ArrowDown', code: 'ArrowDown' }));
  assert.ok(!matches(arrow, { key: 'ArrowDown', code: 'Numpad2' }), 'NumLock off is no arrow');
  assert.ok(matches(arrow, { key: 'ArrowDown' }), 'events without a code fall back to key');
  assert.ok(matches(parseKey('Home'), { key: 'Home', code: 'Home' }));
  assert.ok(!matches(parseKey('Home'), { key: 'Home', code: 'Numpad7' }), 'NumLock off 7');
  assert.ok(matches(parseKey('Numpad2'), { key: 'ArrowDown', code: 'Numpad2' }),
    'numpad digits match by code with NumLock on or off');
  assert.ok(matches(parseKey('E'), { key: 'e' }));
  assert.ok(matches(parseKey('?'), { key: '?', shiftKey: true }));
});

test('key labels for the help overlay', () => {
  assert.equal(keyLabel('Mod+S', { mac: true }), '⌘S');
  assert.equal(keyLabel('Mod+S'), 'Ctrl+S');
  assert.equal(keyLabel('Shift+Digit2', { mac: true }), '⇧2');
  assert.equal(keyLabel('Numpad5'), 'Num 5');
  assert.equal(keyLabel('ArrowLeft'), '←');
  assert.equal(keyLabel('Mod+Shift+ArrowUp'), 'Ctrl+Shift+↑');
  assert.equal(keyLabel('Escape'), 'Esc');
  assert.equal(keyLabel('Alt+['), 'Alt+[');
});

function keyboardHarness() {
  const listeners = { document: null, capture: null };
  const canvas = { tagName: 'CANVAS', closest: () => null };
  const env = {
    document: {
      activeElement: null,
      addEventListener: (name, handler) => {
        listeners.document = handler;
      },
    },
    window: {
      addEventListener: (name, handler, capture) => {
        if (capture) listeners.capture = handler;
      },
    },
  };
  const commands = createCommands({ dom: { $: () => null } });
  const ran = [];
  const add = (id, keys, extra = {}) => commands.register({
    id, keys, run: () => ran.push(id), ...extra,
  });
  add('tool.comment', ['C']);
  add('view.fit', ['F']);
  add('help.shortcuts', ['?']);
  add('view.front', ['Digit1']);
  add('view.default', ['Home']);
  add('reviews.save', ['Mod+S'], { allowWhileTyping: true });
  add('annotations.undo', ['Mod+Z']);
  add('parts.library', ['Alt+[']);
  add('view.orbit', ['ArrowLeft'], { scope: 'canvas' });
  add('dialog.close', ['?'], { scope: 'dialog' });
  const keyboard = createKeyboard({ env, dom: {}, commands, canvas });
  keyboard.install();
  const press = (key, extra = {}) => listeners.document({ key, preventDefault() {}, ...extra });
  return { env, keyboard, ran, press, canvas, listeners };
}

test('single keys off: character keys do nothing; ⌘S, Alt, arrows and Home still work', () => {
  const { keyboard, ran, press, env, canvas } = keyboardHarness();
  press('c');
  press('?', { shiftKey: true });
  press('1', { code: 'Digit1' });
  assert.deepEqual(ran, ['tool.comment', 'help.shortcuts', 'view.front']);
  ran.length = 0;
  keyboard.setSingleKeyShortcuts(false);
  assert.equal(keyboard.singleKeyShortcuts(), false);
  for (const key of ['c', 'f', 'C']) press(key);
  press('?', { shiftKey: true });
  press('1', { code: 'Digit1' });
  assert.deepEqual(ran, [], 'letters, ? and digits are off');
  press('s', { metaKey: true });
  press('z', { ctrlKey: true });
  press('[', { altKey: true });
  press('Home');
  env.document.activeElement = canvas;
  press('ArrowLeft', { code: 'ArrowLeft' });
  assert.deepEqual(ran, ['reviews.save', 'annotations.undo', 'parts.library', 'view.default',
    'view.orbit']);
  const described = keyboard.describe();
  assert.equal(described.find(item => item.id === 'tool.comment').active, false);
  assert.equal(described.find(item => item.id === 'reviews.save').active, true);
  assert.equal(described.find(item => item.id === 'view.orbit').scope, 'canvas');
  assert.equal(described.length, 10, 'describe lists every binding once');
});

test('inside an open modal dialog only dialog-scope bindings fire', () => {
  const { ran, press, env } = keyboardHarness();
  env.document.activeElement = {
    tagName: 'BUTTON', closest: selector => (selector === '[aria-modal="true"]' ? {} : null),
  };
  press('c');
  press('?', { shiftKey: true });
  press('s', { metaKey: true });
  assert.deepEqual(ran, ['dialog.close', 'reviews.save']);
});

test('the window guard stops character keys from reaching out-of-band listeners', () => {
  const { keyboard, listeners, env } = keyboardHarness();
  const stopped = (key, target = { closest: () => null }, extra = {}) => {
    const event = {
      key, target, stopped: false, ...extra,
      stopImmediatePropagation() {
        this.stopped = true;
      },
    };
    listeners.capture(event);
    return event.stopped;
  };
  assert.equal(stopped('1'), false, 'single keys on: nothing is stopped');
  keyboard.setSingleKeyShortcuts(false);
  assert.equal(stopped('1'), true);
  assert.equal(stopped('?'), true);
  assert.equal(stopped('s', undefined, { metaKey: true }), false);
  assert.equal(stopped('ArrowDown'), false);
  assert.equal(stopped(' '), false);
  const menuItem = { closest: selector => (selector.includes('role="menu"') ? {} : null) };
  assert.equal(stopped('1', menuItem), false, 'focus-scoped widgets keep their keys');
  env.document.activeElement = { tagName: 'INPUT' };
  assert.equal(stopped('a'), false, 'typing is never blocked');
});

// ---- focus helpers ----

test('preserveFocus finds the control again by id, focus key, name or position', () => {
  const { document, h } = createDocument();
  const root = h('div');
  document.body.append(root);
  const render = () => root.replaceChildren(
    h('select', { id: 'inspect-entity' }),
    h('button', { 'data-focus-key': 'model-a' }, 'bracket'),
    h('input', { name: 'setting-x', type: 'number' }),
    h('ul', {}, h('li', {}, h('button', {}, 'First')), h('li', {}, h('button', {}, 'Second'))),
  );
  render();
  for (const selector of ['[id="inspect-entity"]', '[data-focus-key="model-a"]',
    'input[name="setting-x"]']) {
    root.querySelector(selector).focus();
    const before = document.activeElement;
    preserveFocus(root, render);
    assert.notEqual(document.activeElement, before, 'the element was replaced');
    assert.equal(document.activeElement, root.querySelector(selector), selector);
  }
  root.querySelectorAll('button')[2].focus();
  assert.equal(focusKey(document.activeElement, root).selector,
    ':scope > ul:nth-child(4) > li:nth-child(2) > button:nth-child(1)');
  preserveFocus(root, render);
  assert.equal(document.activeElement.textContent, 'Second', 'structural match, same text');
  // A different control at the same position is not focused.
  root.querySelectorAll('button')[2].focus();
  const snapshot = captureFocus(root);
  root.replaceChildren(h('select', { id: 'inspect-entity' }), h('button', {}, 'Other'),
    h('input', {}), h('ul', {}, h('li', {}, h('button', {}, 'x')),
      h('li', {}, h('button', {}, 'Changed'))));
  assert.equal(restoreFocus(root, snapshot), null);
  // Focus outside the root is left alone.
  const outside = h('button', { id: 'elsewhere' });
  document.body.append(outside);
  outside.focus();
  preserveFocus(root, render);
  assert.equal(document.activeElement, outside);
});

test('preserveFocus restores the caret of a text input', () => {
  const { document, h } = createDocument();
  const root = h('div', {}, h('input', { id: 'help-filter', type: 'search' }));
  document.body.append(root);
  const input = root.querySelector('[id="help-filter"]');
  input.focus();
  input.setSelectionRange(2, 4, 'forward');
  preserveFocus(root, () => root.replaceChildren(h('input', {
    id: 'help-filter', type: 'search',
  })));
  assert.equal(document.activeElement.selectionStart, 2);
  assert.equal(document.activeElement.selectionEnd, 4);
});

test('trapFocus cycles Tab inside the container and returns focus on release', () => {
  const { document, h } = createDocument();
  const opener = h('button', { id: 'open-source' }, 'Open frozen source');
  const drawer = h('section', { id: 'report-drawer' },
    h('button', { id: 'close-report' }), h('button', { id: 'hide-code' }),
    h('button', {}, 'disabled'), h('a', { href: '#l1' }, 'line 1'));
  drawer.children[2].disabled = true;
  document.body.append(opener, drawer);
  opener.focus();
  const trap = trapFocus(drawer, { initial: drawer.children[0] });
  assert.equal(document.activeElement.id, 'close-report');
  assert.deepEqual(focusables(drawer).map(node => node.id || node.textContent),
    ['close-report', 'hide-code', 'line 1']);
  drawer.children[3].focus();
  const forward = drawer.key('Tab');
  assert.ok(forward.defaultPrevented);
  assert.equal(document.activeElement.id, 'close-report', 'Tab from the last goes to the first');
  const backward = drawer.key('Tab', { shiftKey: true });
  assert.ok(backward.defaultPrevented);
  assert.equal(document.activeElement.textContent, 'line 1');
  drawer.children[0].focus();
  const inner = drawer.key('Tab');
  assert.ok(!inner.defaultPrevented, 'inner Tab is left to the browser');
  trap.release();
  assert.equal(document.activeElement, opener);
});

test('trapFocus finds a re-rendered opener by id and keeps deliberate focus moves', () => {
  const { document, h } = createDocument();
  const panel = h('div', {}, h('button', { id: 'open-source' }));
  const drawer = h('section', {}, h('button', { id: 'close-report' }));
  const canvas = h('canvas', { id: 'model-canvas', tabindex: '0' });
  document.body.append(panel, drawer, canvas);
  panel.children[0].focus();
  let trap = trapFocus(drawer, { fallback: canvas });
  panel.replaceChildren(h('button', { id: 'open-source' }, 'new'));
  trap.release();
  assert.equal(document.activeElement, panel.children[0], 'the re-rendered opener');
  trap = trapFocus(drawer, { fallback: canvas });
  panel.replaceChildren();
  trap.release();
  assert.equal(document.activeElement, canvas, 'fallback when the opener is gone');
  panel.append(h('input', { id: 'review-title' }));
  trap = trapFocus(drawer, { opener: canvas });
  panel.children[0].focus();
  trap.release();
  assert.equal(document.activeElement.id, 'review-title', 'focus moved away stays');
});

// ---- help overlay and settings models ----

const BINDINGS = [
  { id: 'help.shortcuts', label: 'Keyboard shortcuts', key: '?', scope: 'global',
    character: true, active: true },
  { id: 'view.front', label: 'Front view', key: 'Digit1', scope: 'global', character: true,
    active: false },
  { id: 'view.front', label: 'Front view', key: 'Numpad1', scope: 'global', character: true,
    active: false },
  { id: 'view.orbit.ArrowLeft', label: 'Orbit <left>', key: 'ArrowLeft', scope: 'canvas',
    character: false, active: true },
  { id: 'reviews.save', label: 'Save review', key: 'Mod+S', scope: 'global',
    character: false, active: true },
  { id: 'zeta.custom', label: 'Custom', key: 'Q', scope: 'list', character: true,
    active: true },
];

test('shortcutGroups groups commands with every key and its scope', () => {
  const groups = shortcutGroups(BINDINGS, { mac: true, enabled: id => id !== 'reviews.save' });
  assert.deepEqual(groups.map(group => group.label), ['Help', 'View and camera', 'Review',
    'Zeta']);
  const front = groups[1].rows[0];
  assert.deepEqual(front.keys.map(key => key.label), ['1', 'Num 1']);
  assert.equal(front.scopeLabel, 'Anywhere');
  assert.equal(groups[1].rows[1].scopeLabel, 'Viewport focused');
  assert.equal(groups[2].rows[0].keys[0].label, '⌘S');
  assert.equal(groups[2].rows[0].available, false);
  assert.equal(groups[3].rows[0].scopeLabel, 'List');
  assert.equal(bindingCount(groups), BINDINGS.length);
});

test('shortcutsMarkup lists every row, escapes labels, filters and marks off keys', () => {
  const groups = shortcutGroups(BINDINGS);
  const markup = shortcutsMarkup(groups, { singleKeys: false });
  for (const id of new Set(BINDINGS.map(binding => binding.id))) {
    assert.ok(markup.includes(`data-command="${id}"`), id);
  }
  assert.match(markup, /Orbit &lt;left&gt;/);
  assert.equal((markup.match(/help-key-off/g) ?? []).length, 2);
  assert.match(markup, /Single-key shortcuts are off/);
  assert.match(markup, /<caption>Focused controls<\/caption>/);
  assert.match(markup, /<caption>Mouse<\/caption>/);
  const filtered = shortcutsMarkup(groups, { filter: 'save' });
  assert.match(filtered, /reviews\.save/);
  assert.doesNotMatch(filtered, /view\.front/);
  assert.doesNotMatch(filtered, /Single-key shortcuts are off/);
  assert.match(shortcutsMarkup(groups, { filter: '<zz>' }), /No shortcut matches “&lt;zz&gt;”/);
});

test('settings values are parsed and clamped; the markup covers every type', () => {
  const number = { type: 'number', min: 1, max: 3 };
  assert.deepEqual(parseSettingValue(number, '2.5'), { ok: true, value: 2.5 });
  assert.deepEqual(parseSettingValue(number, '9'), { ok: true, value: 3 });
  assert.deepEqual(parseSettingValue(number, ''), { ok: false });
  assert.deepEqual(parseSettingValue(number, 'abc'), { ok: false });
  assert.deepEqual(parseSettingValue({ type: 'boolean' }, false), { ok: true, value: false });
  const choice = { type: 'choice', choices: ['light', { value: 'dark', label: 'Night' }] };
  assert.deepEqual(parseSettingValue(choice, 'dark'), { ok: true, value: 'dark' });
  assert.deepEqual(parseSettingValue(choice, 'neon'), { ok: false });
  const items = [
    { id: 'b', order: 2, label: 'Edges <b>', scope: 'G', key: 'edges', type: 'boolean',
      default: true, description: 'Shows "edges"' },
    { id: 'a', order: 1, label: 'Theme', scope: 'G', key: 'theme', ...choice,
      default: 'light' },
    { id: 'c', order: 3, label: 'Width', scope: 'G', key: 'width', ...number, step: 0.25,
      default: 1.5, unit: 'CSS px' },
    { id: 'd', order: 4, label: 'Visible', scope: 'SB', key: 'visible', type: 'boolean' },
    { id: 'e', order: 5, label: 'Odd', scope: 'G', key: 'odd', type: 'matrix' },
  ];
  const stored = { theme: 'dark', edges: false };
  const markup = settingsMarkup(items, (key, fallback) => stored[key] ?? fallback);
  assert.ok(markup.indexOf('Theme') < markup.indexOf('Edges'), 'sorted by order');
  assert.match(markup, /<option value="dark" selected>Night<\/option>/);
  assert.match(markup, /type="checkbox" id="setting-b"[^>]*aria-describedby="setting-b-note"/);
  assert.doesNotMatch(markup, /id="setting-b"[^>]* checked/);
  assert.match(markup, /value="1.5" min="1" max="3" step="0.25"/);
  assert.match(markup, /Edges &lt;b&gt;/);
  assert.match(markup, /Shows &quot;edges&quot;/);
  assert.match(markup, /Stored per source or body/);
  assert.match(markup, /Unsupported setting type “matrix”/);
});

// ---- help feature wiring (fake environment) ----

const legacy = await loadFeatures(LEGACY_FEATURES);

function helpViewer() {
  let document = { schema: 'wonky.viewer-settings/1', global: {}, sources: {}, bodies: {} };
  const dispatch = (path, options = {}) => {
    if (path !== '/api/settings') return {};
    if (options.method === 'PUT') {
      const patch = JSON.parse(options.body);
      document = { ...document, global: { ...document.global, ...patch.global } };
    }
    return document;
  };
  const fake = createFakeEnvironment({ dispatch });
  fake.document.documentElement = { dataset: {} };
  const viewer = createViewer(fake.env, {
    features: [...legacy.features, help], log: () => {},
    seams: { scheduleDraw() {}, renderInspector() {}, renderAnnotations() {} },
  });
  return { fake, viewer, stored: () => document };
}

test('the help feature registers ?, its settings, and applies theme and single keys', async () => {
  const { fake, viewer, stored } = helpViewer();
  const { commands, keyboard, settings, slots } = viewer.ctx;
  assert.deepEqual(commands.get('help.shortcuts').keys, ['?']);
  assert.equal(commands.get('help.close').scope, 'dialog');
  assert.deepEqual(commands.conflicts(), []);
  const items = slots.list('settings.item').map(item => item.id);
  assert.ok(items.includes('help.theme') && items.includes('help.singleKeys'));
  assert.equal(fake.document.documentElement.dataset.theme, 'system', 'follows the system by default');
  assert.equal(keyboard.singleKeyShortcuts(), true);
  await settings.load();
  await settings.set('G', 'singleKeyShortcuts', false);
  assert.equal(keyboard.singleKeyShortcuts(), false);
  assert.equal(stored().global.singleKeyShortcuts, false, 'saved to the settings document');
  const state = viewer.harness.state;
  const tool = state.tool;
  fake.document.emit('keydown', { key: 'c' });
  assert.equal(state.tool, tool, 'C does nothing with single keys off');
  await settings.set('G', 'theme', 'dark');
  assert.equal(fake.document.documentElement.dataset.theme, 'dark');
  await settings.set('G', 'theme', 'neon');
  assert.equal(fake.document.documentElement.dataset.theme, 'system', 'unknown themes fall back to the system theme');
  await settings.set('G', 'theme', 'light');
  assert.equal(fake.document.documentElement.dataset.theme, 'light');
  await commands.run('help.toggleSingleKeys');
  assert.equal(keyboard.singleKeyShortcuts(), true);
  fake.document.emit('keydown', { key: 'c' });
  assert.equal(state.tool, 'comment', 'C selects the comment tool again');
});

// ---- inspector host ----

test('inspector sections follow the spec order around identity and Browse geometry', () => {
  const bands = sectionBands([{ id: 'x', order: 20 }, { id: 'y', order: 35 },
    { id: 'z', order: 40 }, { id: 'w', order: 60 }, { id: 'v' }]);
  assert.deepEqual(bands.early.map(item => item.id), ['x']);
  assert.deepEqual(bands.middle.map(item => item.id), ['y', 'z']);
  assert.deepEqual(bands.late.map(item => item.id), ['w', 'v']);

  const probe = {
    id: 'probe', legacy: false,
    setup(ctx) {
      for (const [id, order] of [['exact', 20], ['measurement', 25], ['print', 35],
        ['later', 60]]) {
        ctx.slots.inspector.section({ id, order, render: () => `<section>[${id}]</section>` });
      }
      return {
        api: {
          modelBounds: () => ({ minMm: [0, 0, 0], maxMm: [50, 40, 8], exactness: 'recorded' }),
        },
      };
    },
  };
  const fake = createFakeEnvironment({
    dispatch: () => {
      throw new Error('no requests');
    },
  });
  const viewer = createViewer(fake.env, {
    features: [...legacy.features, probe], legacy: true, log: () => {},
    seams: { scheduleDraw() {}, renderAnnotations() {}, renderLibrary() {}, renderSaved() {} },
  });
  const ui = viewer.harness;
  const id = 'a'.repeat(64);
  const source = { file: 'bracket.fs', sha256: 'c'.repeat(64), span: { line: 3, column: 1 } };
  const scene = {
    id, label: 'bracket', bounds: { min: [0, 0, 0], max: [50, 40, 8] },
    bodies: [{
      id: 'part', edges: [], vertices: [],
      faces: [{ index: 0, surfaceType: 'plane', edgeIndices: [], triangles: [], source }],
    }],
  };
  ui.state.scenes.set(id, scene);
  ui.state.after = id;
  ui.renderInspector();
  const overview = fake.node('#selection-content').innerHTML;
  assert.match(overview, /50 × 40 × 8 mm/);
  assert.match(overview, /recorded/, 'the overview size carries its exactness label');
  assert.match(overview, /data-focus-key="body-part"/);
  ui.state.selection = { modelId: id, bodyId: 'part', entityType: 'face', entityIndex: 0 };
  ui.renderInspector();
  const markup = fake.node('#selection-content').innerHTML;
  const order = ['id="inspector-heading"', '[exact]', '[measurement]', 'Identity scope',
    'id="copy-selection"', '[print]', 'Operation source', 'Browse geometry', '[later]',
    '<h3>Reference</h3>', 'LLM context'].map(text => [text, markup.indexOf(text)]);
  for (const [text, index] of order) assert.ok(index >= 0, `${text} is rendered`);
  const positions = order.map(([, index]) => index);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), JSON.stringify(order));
});

// ---- design tokens and the contrast script ----

const tokens = readFileSync(new URL('../viewer/styles/tokens.css', import.meta.url), 'utf8');
const pairs = Object.fromEntries([...tokens.matchAll(
  /--([a-z-]+):\s*light-dark\((#[0-9a-f]{3,8}),\s*(#[0-9a-f]{3,8})\)/g)]
  .map(([, name, light, dark]) => [name, { light, dark }]));
const rgb = hex => {
  const value = hex.length === 4 ? [...hex.slice(1)].map(c => c + c).join('') : hex.slice(1);
  return [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
};

test('every text token reaches 4.5:1 on every surface token in both themes', () => {
  const texts = ['ink', 'ink-soft', 'muted', 'green', 'copper', 'danger', 'blue', 'amber'];
  const surfaces = ['paper', 'surface', 'sunken', 'field', 'canvas', 'chip', 'green-soft',
    'copper-soft', 'danger-soft', 'blue-soft', 'amber-soft'];
  for (const theme of ['light', 'dark']) {
    for (const text of texts) {
      for (const surface of surfaces) {
        assert.ok(pairs[text] && pairs[surface], `${text} and ${surface} are light-dark tokens`);
        const ratio = contrastRatio(rgb(pairs[text][theme]), rgb(pairs[surface][theme]));
        assert.ok(ratio >= 4.5, `${theme}: --${text} on --${surface} is ${ratio.toFixed(2)}:1`);
      }
    }
    for (const fill of ['green-strong', 'blue-strong']) {
      const ratio = contrastRatio([255, 255, 255], rgb(pairs[fill][theme]));
      assert.ok(ratio >= 4.5, `${theme}: --on-green on --${fill} is ${ratio.toFixed(2)}:1`);
    }
  }
  const sizes = [...tokens.matchAll(/--text-[a-z]+:\s*(\d+(?:\.\d+)?)px/g)]
    .map(match => Number(match[1]));
  assert.ok(sizes.length >= 5 && sizes.every(size => size >= 11), `sizes ${sizes}`);
  assert.match(tokens, /:root\[data-theme="dark"\]\s*\{\s*color-scheme: dark;/);
  assert.match(tokens, /:root\[data-theme="system"\]\s*\{\s*color-scheme: light dark;/);
});

test('contrast script: WCAG ratios, compositing, failures and the static scan', () => {
  assert.equal(Math.round(contrastRatio([255, 255, 255], [0, 0, 0]) * 10) / 10, 21);
  assert.ok(Math.abs(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255]) - 4.54) < 0.01);
  assert.deepEqual(blend([0, 0, 0, 0.5], [255, 255, 255]), [127.5, 127.5, 127.5]);
  const failing = { path: 'p', text: 't', contrastOk: false, sizeOk: true, exempt: false,
    placeholder: false };
  const report = {
    themes: {
      light: {
        overview: [failing],
        help: [failing, { path: 'q', text: 'u', contrastOk: true, sizeOk: true,
          exempt: false }],
      },
    },
  };
  assert.deepEqual(failures(report).map(item => item.states), [['overview', 'help']]);
  const directory = mkdtempSync(join(tmpdir(), 'wonky-contrast-'));
  writeFileSync(join(directory, 'a.css'), '.a {\n  font-size: 10px;\n  color: #999;\n'
    + '  --tone: #fff;\n  background: var(--surface);\n}\n');
  const findings = staticScan(directory);
  assert.deepEqual(findings.map(item => [item.line, item.kind, item.value]),
    [[2, 'size', '10px'], [3, 'literal', '#999']]);
});
