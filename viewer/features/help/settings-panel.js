// Settings dialog content: renders every slots.settings.item entry.
// Pure: markup and value parsing only, so it is tested directly.
//
// An item: { id, order, label, scope, key, type, default, description?,
//   choices? (strings or { value, label }), min?, max?, step?, unit? }.
// Types: boolean (checkbox), choice (select), number (number input, clamped
// to min..max). Scope G items are editable; other scopes need a source or a
// body and are listed read-only with the reason. Unknown types say so.
import { escape } from '../../core/dom.js';

const CHOICE_LABELS = Object.freeze({
  light: 'Light', dark: 'Dark', system: 'System',
  orthographic: 'Orthographic', perspective: 'Perspective',
  zed: 'Zed', vscode: 'VS Code', cursor: 'Cursor',
});

const capitalized = text => text.charAt(0).toUpperCase() + text.slice(1);
export const choiceOf = choice => (typeof choice === 'object' && choice !== null
  ? { value: String(choice.value), label: String(choice.label ?? choice.value) }
  : { value: String(choice), label: CHOICE_LABELS[choice] ?? capitalized(String(choice)) });

// Current value of an item: the stored G value, else its default.
export const valueOf = (item, read) => read(item.key, item.default);

// Parses the control value of `item`; returns { ok, value } or { ok: false }.
export function parseSettingValue(item, input) {
  if (item.type === 'boolean') return { ok: true, value: input === true || input === 'true' };
  if (item.type === 'choice') {
    const choices = (item.choices ?? []).map(choiceOf).map(choice => choice.value);
    return choices.includes(String(input)) ? { ok: true, value: String(input) } : { ok: false };
  }
  if (item.type === 'number') {
    const number = Number(input);
    if (input === '' || !Number.isFinite(number)) return { ok: false };
    const min = Number.isFinite(item.min) ? item.min : -Infinity;
    const max = Number.isFinite(item.max) ? item.max : Infinity;
    return { ok: true, value: Math.min(max, Math.max(min, number)) };
  }
  return { ok: false };
}

// attributes: id, name, data-setting and aria-describedby of the control.
const control = (item, value, attributes) => {
  if (item.type === 'boolean') {
    return `<input type="checkbox" ${attributes}${value ? ' checked' : ''}>`;
  }
  if (item.type === 'choice') {
    const options = (item.choices ?? []).map(choiceOf).map(choice => `<option`
      + ` value="${escape(choice.value)}"${choice.value === String(value) ? ' selected' : ''}>`
      + `${escape(choice.label)}</option>`).join('');
    return `<select ${attributes}>${options}</select>`;
  }
  if (item.type === 'number') {
    const bound = key => (Number.isFinite(item[key]) ? ` ${key}="${item[key]}"` : '');
    const unit = item.unit ? `<span class="setting-unit">${escape(item.unit)}</span>` : '';
    return `<span class="setting-number"><input type="number" inputmode="decimal" ${attributes}`
      + ` value="${escape(value)}"${bound('min')}${bound('max')}${bound('step')}>${unit}</span>`;
  }
  return `<span class="setting-unsupported">Unsupported setting type “${escape(item.type)}”</span>`;
};

function row(item, read) {
  const name = `setting-${String(item.id).replace(/[^a-z0-9_-]/gi, '-')}`;
  if (item.scope !== 'G') {
    return '<div class="setting-row setting-readonly"><span class="setting-copy"><span'
      + ` class="setting-label">${escape(item.label)}</span><span class="setting-description">`
      + 'Stored per source or body; change it where it applies.</span></span></div>';
  }
  const description = item.description
    ? `<span class="setting-description" id="${name}-note">${escape(item.description)}</span>`
    : '';
  const attributes = `id="${name}" name="${name}" data-setting="${escape(item.id)}"`
    + (item.description ? ` aria-describedby="${name}-note"` : '');
  return `<div class="setting-row" data-setting-row="${escape(item.id)}">`
    + `<span class="setting-copy"><label class="setting-label" for="${name}">`
    + `${escape(item.label)}</label>${description}`
    + `</span><span class="setting-control">${control(item, valueOf(item, read), attributes)}`
    + '</span></div>';
}

// items: slots.list('settings.item'); read(key, fallback) reads scope G.
export function settingsMarkup(items, read) {
  const list = [...items].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  if (!list.length) return '<p class="help-empty">No settings are registered.</p>';
  return list.map(item => row(item, read)).join('');
}
