// Shortcut list of the help overlay, generated from the command registry
// (keyboard.describe()). Pure: no DOM access, so it is tested directly.
//
//   shortcutGroups(bindings, { enabled, mac }) -> [{ id, label, rows }]
//   shortcutsMarkup(groups, { filter, singleKeys }) -> markup
//
// A row is one command with every key bound to it, its scope and whether it
// fires right now (single-key shortcuts off, or the command unavailable).
import { escape } from '../../core/dom.js';
import { keyLabel } from '../../core/keyboard.js';

// Command id prefix -> group, in display order. Unknown prefixes follow.
const GROUPS = [
  ['help', 'Help'], ['app', 'General'], ['view', 'View and camera'], ['display', 'Display'],
  ['tool', 'Review tools'], ['annotations', 'Review tools'], ['reviews', 'Review'],
  ['parts', 'Parts'], ['columns', 'Columns'], ['fdm', 'Print check'], ['section', 'Section'],
  ['thickness', 'Thickness'], ['measure', 'Measure'], ['selection', 'Selection'],
  ['compare', 'Compare'], ['diff', 'Compare'], ['live', 'Live'], ['library', 'Library'],
  ['inspector', 'Inspector'], ['drawer', 'Drawer'],
];

export const SCOPE_LABELS = Object.freeze({
  global: 'Anywhere',
  canvas: 'Viewport focused',
  dialog: 'In a dialog',
});

// Keys handled by focused controls rather than commands (not in the registry).
export const FOCUSED_KEYS = Object.freeze([
  { keys: ['←', '→', 'Home', 'End'], label: 'Move between tabs', scope: 'Tab list focused' },
  { keys: ['←', '→'], label: 'Move the wipe divider', scope: 'Divider focused' },
  { keys: ['Enter', 'Space'], label: 'Select the geometry of a source line',
    scope: 'Source line focused' },
  { keys: ['Tab', 'Shift+Tab'], label: 'Move focus; stays inside an open dialog or drawer',
    scope: 'Dialog or drawer' },
]);

// Pointer gestures of core/pointer.js (a press that moves less than 4 CSS px is a click).
export const MOUSE = Object.freeze([
  { keys: ['Click'], label: 'Select a face, edge or point' },
  { keys: ['Shift-click', '⌘/Ctrl-click'], label: 'Add to or remove from the selection' },
  { keys: ['Drag'], label: 'Orbit' },
  { keys: ['Shift-drag', 'Middle drag', 'Right drag'], label: 'Pan' },
  { keys: ['Wheel'], label: 'Zoom' },
  { keys: ['Alt-drag'], label: 'Orbit while a markup tool is active' },
]);

const capitalized = text => text.charAt(0).toUpperCase() + text.slice(1);
const groupOf = id => {
  const prefix = String(id).split('.')[0];
  const index = GROUPS.findIndex(([name]) => name === prefix);
  return index >= 0
    ? { id: GROUPS[index][1], label: GROUPS[index][1], order: index }
    : { id: capitalized(prefix), label: capitalized(prefix), order: GROUPS.length };
};

// bindings: [{ id, label, key, scope, character, active }] in registration order.
// enabled(id) -> false when the command cannot run right now.
export function shortcutGroups(bindings, { enabled = () => true, mac = false } = {}) {
  const rows = new Map();
  for (const binding of bindings) {
    const row = rows.get(binding.id) ?? {
      id: binding.id, label: binding.label, scope: binding.scope,
      scopeLabel: SCOPE_LABELS[binding.scope] ?? capitalized(binding.scope),
      keys: [], available: enabled(binding.id) !== false,
    };
    row.keys.push({
      key: binding.key, label: keyLabel(binding.key, { mac }), character: binding.character,
      active: binding.active !== false,
    });
    rows.set(binding.id, row);
  }
  const groups = new Map();
  for (const row of rows.values()) {
    const group = groupOf(row.id);
    if (!groups.has(group.id)) groups.set(group.id, { ...group, rows: [] });
    groups.get(group.id).rows.push(row);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order)
    .map(({ id, label, rows: list }) => ({ id, label, rows: list }));
}

const matchesFilter = (filter, ...texts) => !filter
  || texts.join(' ').toLowerCase().includes(filter.toLowerCase());

const kbd = label => `<kbd>${escape(label)}</kbd>`;

function commandRow(row) {
  const keys = row.keys.map(key => `<span class="help-key${key.active ? '' : ' help-key-off'}"`
    + `${key.active ? '' : ' title="Single-key shortcuts are off"'}>${kbd(key.label)}`
    + `${key.active ? '' : '<span class="help-off">off</span>'}</span>`).join('');
  const state = row.available ? '' : '<span class="help-state">not available now</span>';
  return `<tr data-command="${escape(row.id)}" data-scope="${escape(row.scope)}"><th scope="row">`
    + `${escape(row.label)}${state}</th><td class="help-keys">${keys}</td>`
    + `<td class="help-scope">${escape(row.scopeLabel)}</td></tr>`;
}

const staticRow = item => `<tr><th scope="row">${escape(item.label)}</th><td class="help-keys">`
  + `${item.keys.map(kbd).join('')}</td><td class="help-scope">${escape(item.scope ?? '')}</td>`
  + '</tr>';

// Every group is its own table; the colgroup keeps the columns aligned.
const table = (caption, rows) => `<table class="help-table"><caption>${escape(caption)}</caption>`
  + '<colgroup><col class="help-col-action"><col class="help-col-keys"><col class="help-col-scope">'
  + '</colgroup><thead><tr><th scope="col">Action</th><th scope="col">Keys</th><th scope="col">'
  + `Scope</th></tr></thead><tbody>${rows}</tbody></table>`;

export function shortcutsMarkup(groups, { filter = '', singleKeys = true } = {}) {
  const sections = groups.map(group => {
    const rows = group.rows.filter(row => matchesFilter(filter, group.label, row.label,
      row.scopeLabel, ...row.keys.map(key => key.label)));
    return rows.length ? table(group.label, rows.map(commandRow).join('')) : '';
  });
  const focused = FOCUSED_KEYS.filter(item => matchesFilter(filter, item.label, ...item.keys));
  const mouse = MOUSE.filter(item => matchesFilter(filter, item.label, ...item.keys));
  const extra = [
    focused.length ? table('Focused controls', focused.map(staticRow).join('')) : '',
    mouse.length ? table('Mouse', mouse.map(item => staticRow({ ...item, scope: 'Viewport' }))
      .join('')) : '',
  ];
  const body = [...sections, ...extra].join('');
  const note = singleKeys ? '' : '<p class="help-note" role="note">Single-key shortcuts are'
    + ' off: letter, digit and symbol keys do nothing. Shortcuts with ⌘ or Ctrl, Escape, Home'
    + ' and the arrow keys still work.</p>';
  return note + (body || `<p class="help-empty">No shortcut matches “${escape(filter)}”.</p>`);
}

// Number of registered bindings (keys), for the heading and tests.
export const bindingCount = groups => groups
  .reduce((sum, group) => sum + group.rows.reduce((rows, row) => rows + row.keys.length, 0), 0);
