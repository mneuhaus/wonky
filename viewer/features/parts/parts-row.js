// Markup and small pure helpers of the parts tab (package parts-tree). No
// DOM access here; parts.js renders the strings and binds the handlers.
//
// A row is { part, style, selected, expanded, badges, details, actions }:
//   part      a body of GET /api/models/:id/parts (alias, id, label, counts, …)
//   style     { visible, opacity, hex, colorSource: override | appearance |
//             viewer-palette } as the renderer resolves it
//   badges    trusted markup from parts.rowBadge slot items (FDM badge slot),
//             shown on the second line so a wide badge never hides the name
//   details   trusted markup from parts.rowDetail slot items
//   actions   parts.rowAction slot items ({ id, label, icon })
import { escape } from '../../core/dom.js';
import { exactnessChipMarkup, number } from '../../core/format.js';
import { CHEVRON, EYE, EYE_OFF, icon } from '../../core/icons.js';

export { CHEVRON, EYE, EYE_OFF };

export const COLOR_SOURCE = Object.freeze({
  appearance: { label: 'appearance', title: 'Appearance color recorded in the model' },
  'viewer-palette': {
    label: 'viewer color', title: 'Viewer palette color; the model records no appearance',
  },
  override: { label: 'custom color', title: 'Custom color (viewer setting, not model data)' },
});

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// "12 faces (9 logical)"; a missing logical count says so.
export function countsText(counts) {
  const faces = plural(counts?.faces ?? 0, 'face');
  const logical = counts?.logicalFaces;
  return Number.isInteger(logical) ? `${faces} (${logical} logical)`
    : `${faces} (logical unavailable)`;
}

const clampChannel = value => Math.min(255, Math.max(0, Math.round(value * 255)));
export const rgbToHex = rgb => `#${rgb.map(value => clampChannel(value).toString(16)
  .padStart(2, '0')).join('')}`;
const HEX = /^#([0-9a-f]{6})$/i;
export const isHex = value => typeof value === 'string' && HEX.test(value);
export function hexToRgb(hex) {
  if (!isHex(hex)) return null;
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(channel => channel / 255);
}

// Case-insensitive filter over label, alias, id and name.
export function matchesPart(part, text) {
  if (!text) return true;
  const haystack = [part.label, part.alias, part.id, part.name ?? ''].join(' ').toLowerCase();
  return haystack.includes(text.toLowerCase());
}

export const percent = opacity => `${Math.round(opacity * 100)} %`;

export function swatchMarkup(style) {
  const opacity = style.visible ? Math.max(0.15, style.opacity) : 0.25;
  return '<svg class="part-swatch" viewBox="0 0 14 14" aria-hidden="true">'
    + `<rect x="0.5" y="0.5" width="13" height="13" rx="3.5" fill="${escape(style.hex)}"`
    + ` fill-opacity="${opacity.toFixed(2)}" stroke="#1d272133"/></svg>`;
}

function colorTitle(style) {
  const source = COLOR_SOURCE[style.colorSource] ?? COLOR_SOURCE['viewer-palette'];
  return `${source.title} (${style.hex})`;
}

function mainLine(row) {
  const { part, style } = row;
  const alias = escape(part.alias);
  const name = escape(part.label);
  const eyeLabel = style.visible ? `Hide ${part.label} (Y)` : `Show ${part.label}`;
  const source = COLOR_SOURCE[style.colorSource] ?? COLOR_SOURCE['viewer-palette'];
  return '<div class="part-main">'
    + `<button class="part-eye" type="button" data-part-eye="${alias}"`
    + ` data-focus-key="part-eye-${alias}" aria-pressed="${style.visible}"`
    + ` title="${escape(eyeLabel)}" aria-label="${escape(eyeLabel)}">`
    + `${style.visible ? EYE : EYE_OFF}</button>`
    + `<span class="part-swatch-wrap" title="${escape(colorTitle(style))}">`
    + `${swatchMarkup(style)}</span>`
    + `<button class="part-name" type="button" data-part-select="${alias}"`
    + ` data-focus-key="part-name-${alias}" title="${escape(`Select ${part.label} (${part.id})`)}">`
    + `<span class="part-label">${name}</span><code class="part-alias">${alias}</code>`
    + '</button>'
    + `<button class="part-expand" type="button" data-part-expand="${alias}"`
    + ` data-focus-key="part-expand-${alias}" aria-expanded="${row.expanded}"`
    + ` title="${row.expanded ? 'Hide details' : 'Opacity, color, export'}"`
    + ` aria-label="${escape(`${row.expanded ? 'Hide' : 'Show'} details of ${part.label}`)}">`
    + `${CHEVRON}</button></div>`
    + `<div class="part-meta"><span>${escape(countsText(part.counts))}</span>`
    + `<span class="part-color-source" title="${escape(colorTitle(style))}">`
    + `${escape(source.label)}</span>`
    + (style.visible && style.opacity < 1 ? `<span>${escape(percent(style.opacity))}</span>` : '')
    + (style.visible ? '' : '<span class="part-hidden-note">hidden</span>')
    + (row.badges ? `<span class="part-badges">${row.badges}</span>` : '')
    + '</div>';
}

const sizeText = size => size.map(value => value.toFixed(3)).join(' × ');
const basename = path => String(path ?? '').split(/[/\\]/).at(-1);

function facts(part) {
  const rows = [];
  rows.push(['Volume', part.volumeMm3 === null ? 'not evaluated'
    : `${number(part.volumeMm3, 2)} mm³`, exactnessChipMarkup('recorded')]);
  rows.push(['Size', part.boundsMm ? `${sizeText(part.boundsMm.size)} mm` : 'not evaluated',
    exactnessChipMarkup('recorded')]);
  const operation = part.operation;
  if (operation) {
    const line = operation.source?.span?.line;
    const file = basename(operation.source?.file) || 'source';
    const where = Number.isInteger(line) ? ` · ${file}:${line}` : '';
    rows.push(['Operation', `${operation.name ?? operation.type ?? operation.id}${where}`, '']);
  }
  rows.push(['Body id', part.id, '']);
  return '<dl class="part-facts">' + rows.map(([key, value, chip]) => `<dt>${escape(key)}</dt>`
    + `<dd><span>${escape(value)}</span>${chip}</dd>`).join('') + '</dl>';
}

function detailsMarkup(row) {
  const { part, style } = row;
  const alias = escape(part.alias);
  const opacity = Math.round(style.opacity * 100);
  const source = COLOR_SOURCE[style.colorSource] ?? COLOR_SOURCE['viewer-palette'];
  const reset = style.colorSource === 'override'
    ? `<button class="part-link" type="button" data-part-color-reset="${alias}">Reset</button>`
    : '';
  const actions = row.actions.map(action => `<button class="button secondary part-action"`
    + ` type="button" data-part-action="${escape(action.id)}" data-part="${alias}">`
    + `${icon(action.icon ?? 'cube')}<span>${escape(action.label)}</span></button>`).join('');
  return `<div class="part-details" id="part-details-${alias}">`
    + '<label class="part-control"><span>Opacity</span>'
    + `<input type="range" min="10" max="100" step="5" value="${opacity}"`
    + ` data-part-opacity="${alias}" data-focus-key="part-opacity-${alias}"`
    + ` aria-label="${escape(`Opacity of ${part.label}`)}">`
    + `<output data-part-opacity-value="${alias}">${escape(percent(style.opacity))}</output>`
    + '</label>'
    + '<label class="part-control"><span>Color</span>'
    + `<input type="color" value="${escape(style.hex)}" data-part-color="${alias}"`
    + ` data-focus-key="part-color-${alias}" aria-label="${escape(`Color of ${part.label}`)}">`
    + `<span class="part-color-source" title="${escape(source.title)}">`
    + `${escape(source.label)}</span>${reset}</label>`
    + facts(part)
    + (row.details ?? '')
    + (actions ? `<div class="part-actions">${actions}</div>` : '')
    + '</div>';
}

export function rowMarkup(row) {
  const { part, style } = row;
  const classes = ['part-row', style.visible ? '' : 'is-hidden', row.selected ? 'is-selected' : '',
    row.expanded ? 'is-expanded' : ''].filter(Boolean).join(' ');
  return `<li class="${classes}" data-part-row="${escape(part.alias)}"`
    + ` data-body-id="${escape(part.id)}">${mainLine(row)}`
    + (row.expanded ? detailsMarkup(row) : '') + '</li>';
}

// Summary line over the list: "4 bodies · 63 faces (28 logical) · 1 hidden".
export function summaryText(document, hidden) {
  const totals = document?.totals;
  if (!totals) return '';
  const bodies = `${totals.bodies} ${totals.bodies === 1 ? 'body' : 'bodies'}`;
  const parts = [bodies, countsText(totals)];
  if (hidden) parts.push(`${hidden} hidden`);
  return parts.join(' · ');
}

// ---- Revisions of the current source (below the tree) ----

// entries: [{ id, text, title, open, before }], newest first. live: null or
// { revision, status, text, failure } for the latest attempt when it has no
// revision in the list (building, failed, cancelled).
export function revisionsMarkup({ label, entries, live, limit, showAll }) {
  if (!entries.length && !live) return '';
  const shown = showAll ? entries : entries.slice(0, limit);
  const hidden = entries.length - shown.length;
  const liveRow = live ? `<div class="parts-live-row parts-live-${escape(live.status)}">`
    + `<span class="revision-tag">r${escape(live.revision ?? '?')}</span>`
    + `<span>${escape(live.text)}</span>`
    + (live.failure ? '<button class="part-link" type="button" data-parts-live-details>'
      + 'Details</button>' : '')
    + '</div>' : '';
  const rows = shown.map(entry => `<button class="parts-revision${entry.open ? ' is-open' : ''}"`
    + ` type="button" data-part-revision="${escape(entry.id)}"`
    + ` data-focus-key="part-revision-${escape(entry.id)}" title="${escape(entry.title)}">`
    + `<span class="revision-tag">${escape(entry.text)}</span>`
    + (entry.before ? '<span class="item-badge before-badge">Before</span>' : '')
    + (entry.open ? '<span class="item-badge">Open</span>' : '')
    + '</button>').join('');
  const fold = hidden > 0 || showAll && entries.length > limit
    ? `<button class="revision-fold" type="button" data-parts-revisions-fold>`
      + `${showAll ? 'Show fewer' : `${hidden} earlier`}</button>` : '';
  return `<section class="parts-revisions" aria-label="${escape(`Revisions of ${label}`)}">`
    + '<h3 class="parts-heading"><span>Revisions</span>'
    + `<span class="parts-source" title="${escape(label)}">${escape(basename(label))}</span>`
    + `<span class="count">${entries.length}</span></h3>`
    + liveRow + `<div class="parts-revision-list">${rows}</div>${fold}</section>`;
}
