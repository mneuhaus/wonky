import { assertNoPrivateTerms } from './private-terms.mjs';
// scripts/reports/lib.mjs — zero-dependency report kit for postplan.dev drafts.
//
// Output: ONE self-contained HTML file, inline CSS only, no JavaScript
// (postplan CSP is script-src 'none'). Light + dark (prefers-color-scheme),
// phone-friendly, printable. Interactivity is CSS-only (<details>, SVG <title>).
//
// Visual convention (the "signature"): evidence is always labelled.
//   solid fill / ■  = gemessen        hatched fill / ▨ = geschätzt
//   hollow ○        = offen           ◆               = Entscheidung
//   ✕               = fehlgeschlagen
//
// ── API ──────────────────────────────────────────────────────────────────────
// Text rules: short props (title, label, value, note, caption, cell text) are
// PLAIN TEXT with inline markup `code` and **bold**; they are HTML-escaped.
// `body` props and section blocks are HTML strings (compose with p(), ul(), …).
// Every figure/card/tile accepts `src` (string | string[]) → a "Quelle" line.
//
//   page({title, kicker?, date, meta?: [[label, value]], lede?, sections, footer?}) → html
//   section(title | {title, id?, note?}, ...blocks)      → <section> (auto TOC entry)
//   p(text) · ul(items) · esc(s) · inline(s) · badge(kind) · source(...paths)
//   tiles([{label, value, unit?, note?, kind?, src?}])   → key-number tiles
//   grid(...blocks) / grid({wide: true}, ...blocks)      → responsive card grid (17rem / 24rem min columns)
//   card({title, eyebrow?, kind?, body, src?})
//   callout(kind, title, body, {src?})                   kind: gemessen|geschätzt|offen|entscheidung|fehlgeschlagen
//   table({columns, rows, caption?, src?})               columns: [string | {key?, label, align?, format?}]
//   details(summary, body, {open?})
//   image(repoRelPath, {alt, caption?, maxKB = 400, maxWidth?, jpeg?})  → data-URI figure
//   barChart({title, sub?, unit?, data: [{label, value, kind?, highlight?, note?}], format?, max?, src?})
//   stackedBar({title, sub?, keys: [{key, label, neutral?}], rows: [{label, values: {key: n}}], format?, src?})
//   beforeAfter({title, sub?, unit?, data: [{label, before, after, kind?}], labels?, better?: 'lower'|'higher', format?, src?})
//   diagram({title, sub?, nodes: [{id, label, sub?, col, row, kind?}], edges: [{from, to, label?, planned?}], src?})
//   fmt.num(v, digits?) · fmt.auto(v) · fmt.pct(share, digits?) · fmt.ms(v) · fmt.bytes(n)   (de-DE)
//   readJson(repoRelPath) · readJsonl(repoRelPath) · REPO                    (data loading)
//   writeReport(fileName, html) → {path, bytes}   writes out/reports/<fileName>
//
// page() refuses to render public-unsafe content (absolute /Users paths, email
// addresses, 24-hex Onshape-style ids, key/token assignments). See README.md.

import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir, platform } from 'node:os';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(REPO, 'out/reports');

// ── text helpers ─────────────────────────────────────────────────────────────
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Escape, then allow `code` and **bold**. */
export const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

export const p = (text) => `<p>${inline(text)}</p>`;
export const ul = (items) => `<ul>${items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;

const LOCALE = 'de-DE';
export const fmt = {
  num: (v, digits = 0) =>
    v == null || Number.isNaN(v) ? '–' : Number(v).toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  pct: (share, digits = 0) => (share == null ? '–' : `${fmt.num(share * 100, digits)} %`),
  ms: (v) => (v == null ? '–' : v >= 1000 ? `${fmt.num(v / 1000, v >= 10000 ? 0 : 1)} s` : `${fmt.num(v, v >= 100 ? 0 : v >= 10 ? 1 : 2)} ms`),
  /** Magnitude-aware precision: 1.234 → 1,23 · 12.34 → 12,3 · 1234 → 1.234 · 0.0125 → 0,013. */
  auto: (v) => (v == null ? '–' : v === 0 ? '0' : fmt.num(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : Math.abs(v) >= 1 ? 2 : Math.min(4, 1 - Math.floor(Math.log10(Math.abs(v)))))),
  bytes: (n) => (n >= 1048576 ? `${fmt.num(n / 1048576, 1)} MB` : n >= 1024 ? `${fmt.num(n / 1024, 0)} KB` : `${n} B`),
};

// ── data loading ─────────────────────────────────────────────────────────────
export const readJson = (rel) => JSON.parse(readFileSync(join(REPO, rel), 'utf8'));
export const readJsonl = (rel) =>
  readFileSync(join(REPO, rel), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// ── evidence kinds ───────────────────────────────────────────────────────────
const KINDS = {
  gemessen: { label: 'gemessen', cls: 'k-mess' },
  geschaetzt: { label: 'geschätzt', cls: 'k-schaetz' },
  offen: { label: 'offen', cls: 'k-offen' },
  entscheidung: { label: 'Entscheidung', cls: 'k-ent' },
  fehlgeschlagen: { label: 'fehlgeschlagen', cls: 'k-fail' },
};
const kindOf = (k) => {
  if (!k) return null;
  const key = String(k).toLowerCase().replace('ä', 'ae');
  const hit = KINDS[key];
  if (!hit) throw new Error(`reports/lib: unknown kind "${k}" (use ${Object.keys(KINDS).join(', ')})`);
  return hit;
};
export const badge = (kind) => {
  const k = kindOf(kind);
  return k ? `<span class="badge ${k.cls}"><i aria-hidden="true"></i>${esc(k.label)}</span>` : '';
};

export const source = (...paths) => {
  const list = [...new Set(paths.flat().filter(Boolean))];
  if (!list.length) return '';
  const html = list.map((x) => inline(x.includes('`') ? x : `\`${x}\``).replace(/<code>([^<]*)<\/code>/g, (_, c) => `<code>${c.replaceAll('/', '/<wbr>')}</code>`));
  return `<p class="src"><span>Quelle</span> ${html.join(', ')}</p>`;
};
const srcOf = (src) => (src ? source(...[src].flat()) : '');

// ── layout components ────────────────────────────────────────────────────────
let tocSeq = 0;
export function section(head, ...blocks) {
  const h = typeof head === 'string' ? { title: head } : head;
  const id = h.id || `s${++tocSeq}-${h.title.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '')}`;
  return `<section id="${esc(id)}" data-toc="${esc(h.title)}"><h2>${inline(h.title)}</h2>${h.note ? `<p class="section-note">${inline(h.note)}</p>` : ''}${blocks.join('\n')}</section>`;
}

export function tiles(items) {
  return `<div class="tiles">${items
    .map((t) => {
      const k = kindOf(t.kind);
      return `<div class="tile${k ? ` ${k.cls}` : ''}"><div class="tile-label">${inline(t.label)}</div><div class="tile-value">${inline(t.value)}${t.unit ? `<span class="tile-unit">${inline(t.unit)}</span>` : ''}</div>${t.note ? `<div class="tile-note">${inline(t.note)}</div>` : ''}${k ? badge(t.kind) : ''}${srcOf(t.src)}</div>`;
    })
    .join('')}</div>`;
}

export function grid(first, ...rest) {
  const opts = typeof first === 'object' && first !== null && !Array.isArray(first) ? first : null;
  const blocks = opts ? rest : [first, ...rest];
  const cls = opts?.wide ? ' grid-wide' : '';
  return `<div class="grid${cls}">${blocks.flat().join('')}</div>`;
}

export function card({ title, eyebrow, kind, body = '', src }) {
  const k = kindOf(kind);
  return `<article class="card${k ? ` ${k.cls}` : ''}">${eyebrow || k ? `<div class="card-eyebrow">${eyebrow ? inline(eyebrow) : ''}${k ? badge(kind) : ''}</div>` : ''}${title ? `<h3>${inline(title)}</h3>` : ''}${body}${srcOf(src)}</article>`;
}

export function callout(kind, title, body = '', { src } = {}) {
  const k = kindOf(kind);
  return `<aside class="callout ${k.cls}"><div class="callout-head">${badge(kind)}${title ? `<strong>${inline(title)}</strong>` : ''}</div>${body ? `<div class="callout-body">${body}</div>` : ''}${srcOf(src)}</aside>`;
}

export function table({ columns, rows, caption, src }) {
  const cols = columns.map((c, i) => (typeof c === 'string' ? { key: i, label: c } : { key: c.key ?? i, ...c }));
  const cell = (row, c, i) => {
    const raw = Array.isArray(row) ? row[i] : row[c.key];
    const v = c.format ? c.format(raw, row) : raw;
    return `<td${c.align === 'right' ? ' class="num"' : ''}>${inline(v ?? '')}</td>`;
  };
  return `<figure class="tbl"><div class="tbl-scroll"><table>${caption ? `<caption>${inline(caption)}</caption>` : ''}<thead><tr>${cols
    .map((c) => `<th${c.align === 'right' ? ' class="num"' : ''}>${inline(c.label)}</th>`)
    .join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c, i) => cell(r, c, i)).join('')}</tr>`).join('')}</tbody></table></div>${srcOf(src)}</figure>`;
}

export const details = (summary, body, { open = false } = {}) =>
  `<details class="more"${open ? ' open' : ''}><summary>${inline(summary)}</summary><div class="more-body">${body}</div></details>`;

// ── images (data URI) ────────────────────────────────────────────────────────
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' };

/**
 * Embed a repo image as a data URI. Files over maxKB are downscaled with macOS
 * `sips` (OS tool, not a dependency) to maxWidth (default 1400 px) and, with
 * jpeg: true, re-encoded as JPEG. Still too big → throws.
 */
export function image(rel, { alt, caption, maxKB = 400, maxWidth, jpeg = false, src } = {}) {
  if (!alt) throw new Error(`reports/lib: image(${rel}) needs alt text`);
  const abs = resolve(REPO, rel);
  if (!existsSync(abs)) throw new Error(`reports/lib: image not found: ${rel}`);
  let file = abs;
  let mime = MIME[extname(abs).toLowerCase()];
  if (!mime) throw new Error(`reports/lib: unsupported image type: ${rel}`);
  let tmp = null;
  const needsWork = statSync(abs).size > maxKB * 1024 || maxWidth || jpeg;
  if (needsWork) {
    if (platform() !== 'darwin') throw new Error(`reports/lib: ${rel} is ${fmt.bytes(statSync(abs).size)} > ${maxKB} KB and sips is only on macOS`);
    tmp = mkdtempSync(join(tmpdir(), 'wonky-report-'));
    file = join(tmp, jpeg ? 'img.jpg' : `img${extname(abs)}`);
    const args = ['--resampleWidth', String(maxWidth || 1400)];
    if (jpeg) args.push('-s', 'format', 'jpeg', '-s', 'formatOptions', '78');
    // --resampleWidth only ever shrinks when we pass a width below the source; guard against upscaling.
    const width = Number(execFileSync('sips', ['-g', 'pixelWidth', abs], { encoding: 'utf8' }).match(/pixelWidth: (\d+)/)?.[1] || 0);
    if (width && width <= (maxWidth || 1400)) args.splice(0, 2);
    execFileSync('sips', [...args, abs, '--out', file], { stdio: 'ignore' });
    if (jpeg) mime = 'image/jpeg';
  }
  const buf = readFileSync(file);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (buf.length > maxKB * 1024) throw new Error(`reports/lib: ${rel} still ${fmt.bytes(buf.length)} > ${maxKB} KB — pass maxWidth / jpeg: true or raise maxKB`);
  const relPath = relative(REPO, abs);
  // No loading="lazy": the bytes are inline anyway, and lazy images stay blank in print and full-page captures.
  return `<figure class="img"><img src="data:${mime};base64,${buf.toString('base64')}" alt="${esc(alt)}" decoding="async">${caption ? `<figcaption>${inline(caption)}</figcaption>` : ''}${srcOf(src ?? relPath)}</figure>`;
}

// ── charts (inline SVG, CSS-var colours, % geometry so text never scales) ───
// Horizontal charts use width="100%" SVGs with percentage x/width: bars stretch
// with the column, labels stay at their real pixel size on phones.
let chartSeq = 0;
const SLOTS = 4; // validated categorical slots (see README): blue, orange, aqua, yellow
const approxW = (text, size = 12) => String(text).length * size * 0.56;
// Row labels must fit a 360 px phone (chart track ≈ 300 px). Longer labels wrap
// onto extra lines on every viewport; SVG text cannot reflow, so this is decided
// at build time. labelW uses a tighter factor calibrated on system-ui at 13 px.
const PHONE_TRACK = 300, LINE_H = 15;
const labelW = (text) => String(text).length * 6.5;
/** Greedy word wrap to lines of at most maxPx (a single long word stays whole). */
function wrapWords(text, maxPx) {
  const lines = [];
  let cur = '';
  for (const word of String(text).split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && labelW(next) > maxPx) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
/** Row label as <text> with one tspan per line; note is muted, on the last line if it fits. */
function rowLabel(label, note, y, maxPx = PHONE_TRACK) {
  const lines = wrapWords(label, maxPx).map((t) => ({ t, note: '' }));
  if (note) {
    const last = lines[lines.length - 1];
    if (labelW(`${last.t} · ${note}`) <= maxPx) last.note = ` · ${note}`;
    else lines.push({ t: '', note });
  }
  const spans = lines.map((l, i) => `<tspan x="0"${i ? ` dy="${LINE_H}"` : ''}>${esc(l.t)}${l.note ? `<tspan class="t-muted">${esc(l.note)}</tspan>` : ''}</tspan>`);
  return { html: `<text x="0" y="${y}" class="t-label">${spans.join('')}</text>`, extra: (lines.length - 1) * LINE_H };
}
/** Share of the track to keep free for value labels at the bar tip (min 20 %). */
const tipReserve = (labels) => Math.min(0.45, Math.max(0.2, (Math.max(...labels.map((l) => approxW(l))) + 10) / PHONE_TRACK));

function hatchDefs(uid, slots) {
  return `<defs>${slots
    .map((s) => `<pattern id="${uid}-h${s}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" class="f-${s}-wash"/><rect width="2" height="5" class="f-${s}"/></pattern>`)
    .join('')}</defs>`;
}
const markFill = (uid, slot, estimated) => (estimated ? `fill="url(#${uid}-h${slot})"` : `class="f-${slot}"`);

/** Bar with a 4px rounded data end and a square baseline end, in % units. */
function hbar(uid, y, h, frac, slot, estimated) {
  if (!(frac > 0)) return '';
  const w = `${(frac * 100).toFixed(3)}%`;
  const square = frac > 0.015 ? `<rect x="0" y="${y}" width="4" height="${h}" ${markFill(uid, slot, estimated)}/>` : '';
  return `<rect x="0" y="${y}" width="${w}" height="${h}" rx="4" ${markFill(uid, slot, estimated)}/>${square}`;
}

function figure({ title, sub, svg, legend = '', tableHtml, src, cls = '' }) {
  return `<figure class="chart ${cls}"><figcaption><strong>${inline(title)}</strong>${sub ? `<span>${inline(sub)}</span>` : ''}</figcaption>${legend}${svg}${tableHtml ? details('Werte als Tabelle', tableHtml) : ''}${srcOf(src)}</figure>`;
}

const legendHtml = (items) =>
  `<ul class="legend">${items.map((i) => `<li><i class="sw ${i.cls}" aria-hidden="true"></i>${inline(i.label)}${i.value ? ` <b>${inline(i.value)}</b>` : ''}</li>`).join('')}</ul>`;
const estLegend = (any) => (any ? [{ cls: 'sw-hatch', label: 'schraffiert = geschätzt' }] : []);

export function barChart({ title, sub, unit = '', data, format, max, src }) {
  const uid = `c${++chartSeq}`;
  const f = format || ((v) => `${fmt.auto(v)}${unit ? ` ${unit}` : ''}`);
  if (data.some((d) => d.value < 0)) throw new Error('barChart: negative values not supported');
  const anyHi = data.some((d) => d.highlight);
  // Domain leaves ≥ 20 % of the track (enough for the widest value label on a phone) at the bar tip.
  const domain = max ?? (Math.max(...data.map((d) => d.value)) / (1 - tipReserve(data.map((d) => f(d.value)))) || 1);
  const rowH = 44, barH = 14;
  let y = 0;
  const rows = data.map((d) => {
    const slot = anyHi && !d.highlight ? 'n' : 's1';
    const frac = Math.min(1, d.value / domain);
    const est = kindOf(d.kind) === KINDS.geschaetzt;
    const tip = `${d.label}: ${f(d.value)}${est ? ' (geschätzt)' : ''}${d.note ? ` · ${d.note}` : ''}`;
    const lbl = rowLabel(d.label, d.note, y + 13);
    const b = y + lbl.extra; // bar baseline shifts down by the wrapped lines
    const g = `<g class="row"><title>${esc(tip)}</title><rect x="0" y="${y}" width="100%" height="${rowH + lbl.extra}" class="hit"/>${lbl.html}${hbar(uid, b + 20, barH, frac, slot, est)}<text x="${(frac * 100).toFixed(3)}%" dx="6" y="${b + 31.5}" class="t-value">${esc(f(d.value))}</text></g>`;
    y += rowH + lbl.extra;
    return g;
  });
  const h = y;
  const anyEst = data.some((d) => kindOf(d.kind) === KINDS.geschaetzt);
  const svg = `<svg class="hchart" width="100%" height="${h}" role="img" aria-label="${esc(title)}">${hatchDefs(uid, ['s1', 'n'])}<line x1="0.5" x2="0.5" y1="18" y2="${h - 8}" class="axis"/>${rows.join('')}</svg>`;
  const tableHtml = table({ columns: ['Eintrag', { label: 'Wert', align: 'right' }, 'Status'], rows: data.map((d) => [d.label, f(d.value), kindOf(d.kind)?.label ?? '']) });
  const legend = anyEst ? legendHtml(estLegend(true)) : '';
  return figure({ title, sub, svg, legend, tableHtml, src });
}

export function stackedBar({ title, sub, keys, rows, format, src }) {
  const uid = `c${++chartSeq}`;
  let s = 0;
  const slotOf = keys.map((k) => (k.neutral ? 'n' : `s${Math.min(++s, SLOTS)}`));
  if (s > SLOTS) throw new Error(`stackedBar: max ${SLOTS} coloured keys — fold the rest into a neutral "sonstige" key`);
  const f = format || ((v) => fmt.num(v));
  const rowH = rows.length > 1 ? 50 : 30, barH = 18;
  const single = rows.length === 1;
  let shift = 0; // extra height from wrapped row labels above this row
  const body = rows.map((r, i) => {
    const nTxt = `n = ${f(keys.reduce((a, k) => a + (r.values[k.key] || 0), 0))}`;
    const lbl = single ? { html: '', extra: 0 } : rowLabel(r.label, '', 0, PHONE_TRACK - approxW(nTxt) - 16);
    shift += lbl.extra;
    const y = i * rowH + (single ? 0 : 20) + shift;
    const total = keys.reduce((a, k) => a + (r.values[k.key] || 0), 0) || 1;
    let acc = 0;
    const segs = [], gaps = [];
    keys.forEach((k, j) => {
      const v = r.values[k.key] || 0;
      if (!v) return;
      const x = acc / total, w = v / total;
      segs.push(`<rect x="${(x * 100).toFixed(3)}%" y="${y}" width="${(w * 100).toFixed(3)}%" height="${barH}" class="f-${slotOf[j]}"><title>${esc(`${r.label ? `${r.label} · ` : ''}${k.label}: ${f(v)} (${fmt.pct(w)})`)}</title></rect>`);
      // Label inside only if it fits at a 320 px phone track.
      const lbl = fmt.pct(w);
      if (w * 320 >= approxW(lbl, 11) + 12) segs.push(`<text x="${((x + w / 2) * 100).toFixed(3)}%" y="${y + 12.5}" text-anchor="middle" class="t-in on-${slotOf[j]}">${esc(lbl)}</text>`);
      if (acc > 0) gaps.push(`<rect x="${(x * 100).toFixed(3)}%" y="${y}" width="2" height="${barH}" class="f-surface"/>`);
      acc += v;
    });
    const top = y - 7 - lbl.extra; // first label line; wrapped lines run down to just above the bar
    const label = single ? '' : `${rowLabel(r.label, '', top, PHONE_TRACK - approxW(nTxt) - 16).html}<text x="100%" y="${top}" text-anchor="end" class="t-muted">${esc(nTxt)}</text>`;
    return `<g clip-path="url(#${uid}-clip${i})">${segs.join('')}${gaps.join('')}</g>${label}<clipPath id="${uid}-clip${i}"><rect x="0" y="${y}" width="100%" height="${barH}" rx="4"/><rect x="0" y="${y}" width="50%" height="${barH}"/></clipPath>`;
  });
  const h = rows.length * rowH + (single ? 0 : 20) - (single ? 12 : 26) + shift;
  const svg = `<svg class="hchart" width="100%" height="${Math.max(h, barH)}" role="img" aria-label="${esc(title)}">${body.join('')}</svg>`;
  const totals = (k) => rows.reduce((a, r) => a + (r.values[k.key] || 0), 0);
  const grand = keys.reduce((a, k) => a + totals(k), 0) || 1;
  const legend = legendHtml(keys.map((k, j) => ({ cls: `f-${slotOf[j]}`, label: k.label, value: single ? `${f(totals(k))} · ${fmt.pct(totals(k) / grand)}` : '' })));
  const tableHtml = table({
    columns: [...(single ? [] : ['Zeile']), ...keys.map((k) => ({ label: k.label, align: 'right' }))],
    rows: rows.map((r) => {
      const t = keys.reduce((a, k) => a + (r.values[k.key] || 0), 0) || 1;
      return [...(single ? [] : [r.label]), ...keys.map((k) => `${f(r.values[k.key] || 0)} (${fmt.pct((r.values[k.key] || 0) / t)})`)];
    }),
  });
  return figure({ title, sub, svg, legend, tableHtml, src });
}

export function beforeAfter({ title, sub, unit = '', data, labels = { before: 'vorher', after: 'nachher' }, better = 'lower', format, src }) {
  const uid = `c${++chartSeq}`;
  const f = format || ((v) => `${fmt.auto(v)}${unit ? ` ${unit}` : ''}`);
  const domain = Math.max(...data.flatMap((d) => [d.before, d.after])) / (1 - tipReserve(data.flatMap((d) => [f(d.before), f(d.after)]))) || 1;
  const rowH = 58, barH = 10;
  let yAcc = 0;
  const rows = data.map((d) => {
    const y = yAcc;
    const est = kindOf(d.kind) === KINDS.geschaetzt;
    const delta = d.before ? (d.after - d.before) / d.before : null;
    const good = delta == null || delta === 0 ? null : (delta < 0) === (better === 'lower');
    const dTxt = delta == null ? '' : `${delta > 0 ? '▲ +' : delta < 0 ? '▼ −' : '± '}${fmt.pct(Math.abs(delta), Math.abs(delta) >= 0.95 && Math.abs(delta) < 1 ? 1 : 0)}`;
    const fb = d.before / domain, fa = d.after / domain;
    // The label shares its first line with the right-aligned delta.
    const lbl = rowLabel(d.label, '', y + 13, PHONE_TRACK - approxW(dTxt) - 16);
    const b = y + lbl.extra;
    yAcc += rowH + lbl.extra;
    return `<g class="row"><title>${esc(`${d.label}: ${labels.before} ${f(d.before)} → ${labels.after} ${f(d.after)}${est ? ' (geschätzt)' : ''}`)}</title><rect x="0" y="${y}" width="100%" height="${rowH + lbl.extra}" class="hit"/>${lbl.html}<text x="100%" y="${y + 13}" text-anchor="end" class="t-delta ${good == null ? '' : good ? 'good' : 'bad'}">${esc(dTxt)}</text>${hbar(uid, b + 20, barH, fb, 'n', false)}<text x="${(fb * 100).toFixed(3)}%" dx="6" y="${b + 28.5}" class="t-value t-muted">${esc(f(d.before))}</text>${hbar(uid, b + 33, barH, fa, 's1', est)}<text x="${(fa * 100).toFixed(3)}%" dx="6" y="${b + 41.5}" class="t-value">${esc(f(d.after))}</text></g>`;
  });
  const h = yAcc - 10;
  const anyEst = data.some((d) => kindOf(d.kind) === KINDS.geschaetzt);
  const svg = `<svg class="hchart" width="100%" height="${h}" role="img" aria-label="${esc(title)}">${hatchDefs(uid, ['s1'])}<line x1="0.5" x2="0.5" y1="18" y2="${h}" class="axis"/>${rows.join('')}</svg>`;
  const legend = legendHtml([{ cls: 'f-n', label: labels.before }, { cls: 'f-s1', label: labels.after }, ...estLegend(anyEst)]);
  const tableHtml = table({
    columns: ['Eintrag', { label: labels.before, align: 'right' }, { label: labels.after, align: 'right' }, { label: 'Δ', align: 'right' }],
    rows: data.map((d) => [d.label, f(d.before), f(d.after), d.before ? fmt.pct((d.after - d.before) / d.before) : '–']),
  });
  return figure({ title, sub: sub ?? (better === 'lower' ? 'kleiner ist besser' : 'größer ist besser'), svg, legend, tableHtml, src });
}

/** Box-and-arrow diagram on a col/row grid. kind: default | accent | muted | planned. */
export function diagram({ title, sub, nodes, edges = [], colW = 214, rowH = 92, boxW = 158, boxH = 54, src }) {
  const uid = `c${++chartSeq}`;
  const pad = 8;
  const pos = new Map(nodes.map((n) => [n.id, { x: pad + n.col * colW, y: pad + n.row * rowH, n }]));
  const W = pad * 2 + Math.max(...nodes.map((n) => n.col)) * colW + boxW;
  const H = pad * 2 + Math.max(...nodes.map((n) => n.row)) * rowH + boxH;
  for (const n of nodes) if (approxW(n.label, 13) > boxW - 16) console.warn(`diagram: label "${n.label}" may overflow its box`);
  const edgeSvg = edges.map((e) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) throw new Error(`diagram: unknown edge ${e.from} → ${e.to}`);
    let d, lx, ly;
    if (a.n.row === b.n.row) {
      const dir = b.x > a.x ? 1 : -1;
      const x1 = dir > 0 ? a.x + boxW : a.x, x2 = dir > 0 ? b.x : b.x + boxW, yy = a.y + boxH / 2;
      d = `M${x1} ${yy} H${x2 - dir * 2}`; lx = (x1 + x2) / 2; ly = yy - 7;
    } else if (a.n.col !== b.n.col) {
      const dir = b.x > a.x ? 1 : -1;
      const x1 = dir > 0 ? a.x + boxW : a.x, x2 = dir > 0 ? b.x : b.x + boxW, y1 = a.y + boxH / 2, y2 = b.y + boxH / 2;
      const mx = (x1 + x2) / 2;
      d = `M${x1} ${y1} H${mx} V${y2} H${x2 - dir * 2}`; lx = mx + 6; ly = (y1 + y2) / 2 + 4;
    } else {
      const dir = b.y > a.y ? 1 : -1;
      const x1 = a.x + boxW / 2, y1 = dir > 0 ? a.y + boxH : a.y, x2 = b.x + boxW / 2, y2 = dir > 0 ? b.y : b.y + boxH;
      const my = (y1 + y2) / 2;
      d = x1 === x2 ? `M${x1} ${y1} V${y2 - dir * 2}` : `M${x1} ${y1} V${my} H${x2} V${y2 - dir * 2}`;
      lx = x1 === x2 ? x1 + 6 : (x1 + x2) / 2; ly = my - 5;
    }
    const lab = e.label ? `<text x="${lx}" y="${ly}" text-anchor="${a.n.row !== b.n.row ? 'start' : 'middle'}" class="t-edge">${esc(e.label)}</text>` : '';
    return `<path d="${d}" class="edge${e.planned ? ' planned' : ''}" marker-end="url(#${uid}-arr)"/>${lab}`;
  });
  const nodeSvg = nodes.map((n) => {
    const { x, y } = pos.get(n.id);
    const k = n.kind || 'default';
    const ty = n.sub ? y + boxH / 2 - 3 : y + boxH / 2 + 4.5;
    return `<g class="node node-${k}"><rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="6"/><text x="${x + boxW / 2}" y="${ty}" text-anchor="middle" class="t-node">${esc(n.label)}</text>${n.sub ? `<text x="${x + boxW / 2}" y="${ty + 16}" text-anchor="middle" class="t-node-sub">${esc(n.sub)}</text>` : ''}</g>`;
  });
  const svg = `<div class="dg-scroll"><svg class="dg${W > 520 ? ' dg-wide' : ''}" viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="${esc(title)}"><defs><marker id="${uid}-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" class="arrow"/></marker></defs>${edgeSvg.join('')}${nodeSvg.join('')}</svg></div>`;
  const anyPlanned = edges.some((e) => e.planned) || nodes.some((n) => n.kind === 'planned');
  const legend = anyPlanned ? legendHtml([{ cls: 'sw-line', label: 'besteht' }, { cls: 'sw-line planned', label: 'geplant' }]) : '';
  return figure({ title, sub, svg, legend, src, cls: 'diagram' });
}

// ── public-safety guard ──────────────────────────────────────────────────────
const UNSAFE = [
  [/\/Users\/[^\s"'<]+/, 'absolute /Users path'],
  [/\/home\/[a-z][^\s"'<]*/, 'absolute /home path'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'email address'],
  [/\b[0-9a-f]{24}\b/, '24-hex id (Onshape document/workspace/element?)'],
  [/\b(?:api[_-]?key|secret|access[_-]?key|token|password)\b\s*[:=]\s*\S{8,}/i, 'credential-like assignment'],
  [/\b(?:sk|pk|ghp|gho|xox[bp])[-_][A-Za-z0-9_-]{16,}/, 'API-key-like string'],
];
export function assertPublicSafe(html) {
  const text = html.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/g, 'data:');
  assertNoPrivateTerms(text, 'public report');
  const hits = UNSAFE.flatMap(([re, what]) => {
    const m = text.match(re);
    return m ? [`${what}: "${m[0].slice(0, 60)}"`] : [];
  });
  if (hits.length) throw new Error(`reports/lib: refusing public-unsafe content →\n  ${hits.join('\n  ')}`);
}

// ── page ─────────────────────────────────────────────────────────────────────
export function page({ title, kicker = 'wonky · Bericht', date, meta = [], lede, sections = [], footer }) {
  if (!date) throw new Error('page: date is required (Stand)');
  const bodyHtml = sections.join('\n');
  const toc = [...bodyHtml.matchAll(/<section id="([^"]+)" data-toc="([^"]*)"/g)];
  const tocHtml = toc.length > 2 ? `<nav class="toc" aria-label="Inhalt"><span>Inhalt</span>${toc.map(([, id, t]) => `<a href="#${id}">${t}</a>`).join('')}</nav>` : '';
  const metaCells = meta.map(([k, v]) => `<div class="tb-cell"><span class="tb-k">${inline(k)}</span><span class="tb-v">${inline(v)}</span></div>`).join('');
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(/^wonky\b/.test(title) ? title : `${title} · wonky`)}</title>
<style>${CSS}</style>
</head>
<body>
<main class="sheet">
<header class="titleblock">
  <div class="tb-main"><span class="tb-kicker">${inline(kicker)}</span><h1>${inline(title)}</h1></div>
  <div class="tb-cell tb-date"><span class="tb-k">Stand</span><span class="tb-v">${inline(date)}</span></div>
  ${metaCells ? `<div class="tb-meta">${metaCells}</div>` : ''}
  <div class="tb-cell tb-legend"><span class="tb-k">Legende</span><span class="tb-v">${['gemessen', 'geschaetzt', 'offen', 'entscheidung', 'fehlgeschlagen'].map(badge).join('')}</span></div>
</header>
${lede ? `<p class="lede">${inline(lede)}</p>` : ''}
${tocHtml}
${bodyHtml}
<footer class="colophon">${footer ? inline(footer) : `Erzeugt aus Repo-Daten von <code>scripts/reports/</code>. Zahlen ohne Kennzeichnung stammen aus der jeweils genannten Quelle.`}</footer>
</main>
</body>
</html>
`;
  assertPublicSafe(html);
  return html;
}

const POSTPLAN_MAX_BYTES = 512 * 1024;
export function writeReport(fileName, html) {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, fileName);
  writeFileSync(path, html);
  const bytes = Buffer.byteLength(html);
  console.log(`wrote ${relative(REPO, path)} (${fmt.bytes(bytes)})`);
  // Postplan rejects drafts above 512 KiB (client and server check the UTF-8 byte length).
  if (bytes > POSTPLAN_MAX_BYTES) console.warn(`  warning: ${fmt.bytes(bytes)} > Postplan limit ${fmt.bytes(POSTPLAN_MAX_BYTES)}, upload will be rejected`);
  else if (bytes > POSTPLAN_MAX_BYTES * 0.9) console.warn(`  warning: within 10 % of the Postplan limit (${fmt.bytes(POSTPLAN_MAX_BYTES)})`);
  return { path, bytes };
}

// ── stylesheet ───────────────────────────────────────────────────────────────
// Tokens: drafting-paper palette. Chart slots are the dataviz reference
// categorical order, validated against these surfaces (README.md).
const CSS = `
:root{
  color-scheme:light;
  --page:#eef1f3; --surface:#fcfdfd; --surface-2:#f4f6f7;
  --ink:#111417; --ink-2:#48525a; --muted:#6f7a82; --rule:#d6dce0; --rule-strong:#111417;
  --accent:#1d5fb4; --accent-wash:rgba(29,95,180,.08);
  --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --n:#a3acb2;
  
  --on-s1:#fff; --on-s2:#111417; --on-s3:#111417; --on-s4:#111417; --on-n:#111417;
  --good:#006300; --bad:#b42323; --warn:#9a6700; --warn-line:#fab219; --fail:#d03b3b;
  --font-display:"DIN Alternate","DIN Next","Bahnschrift","D-DIN","Roboto Condensed","Arial Narrow",system-ui,sans-serif;
  --font-body:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  --font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --hatch:repeating-linear-gradient(135deg,var(--accent) 0 1.6px,transparent 1.6px 5px);
}
@media (prefers-color-scheme:dark){:root{
  color-scheme:dark;
  --page:#0d1012; --surface:#171b1e; --surface-2:#1d2226;
  --ink:#eef1f3; --ink-2:#b8c1c7; --muted:#8a959c; --rule:#2b3237; --rule-strong:#8a959c;
  --accent:#6fa3e8; --accent-wash:rgba(111,163,232,.1);
  --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --n:#59636a;
  
  --on-s1:#fff; --on-s2:#0d1012; --on-s3:#0d1012; --on-s4:#0d1012; --on-n:#eef1f3;
  --good:#3fbf3f; --bad:#f07070; --warn:#f4c25a; --warn-line:#fab219; --fail:#e66767;
}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--ink);font:16px/1.55 var(--font-body);font-feature-settings:"kern","liga"}
.sheet{max-width:1040px;margin:0 auto;padding:clamp(12px,3vw,40px) clamp(14px,4vw,48px) 64px;background:var(--surface);min-height:100vh;border-left:1px solid var(--rule);border-right:1px solid var(--rule)}
p,ul,ol{margin:0 0 .9em;max-width:70ch}
li{margin:.2em 0}
a{color:var(--accent);text-underline-offset:2px}
a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
code{font:.86em/1.3 var(--font-mono);background:var(--surface-2);border:1px solid var(--rule);border-radius:3px;padding:.05em .3em;overflow-wrap:anywhere}
strong{font-weight:620}

/* title block — the drawing-sheet Schriftfeld */
.titleblock{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1.5px solid var(--rule-strong);margin:0 0 28px}
.titleblock>*{border-right:1px solid var(--rule);border-bottom:1px solid var(--rule);padding:8px 12px;min-width:0}
.tb-main{grid-column:1 / 4;padding:14px 16px 16px}
.tb-date{grid-column:4}
.tb-legend{grid-column:1 / -1;border-bottom:0}
.titleblock>.tb-meta{grid-column:1 / -1;display:flex;flex-wrap:wrap;padding:0;border-right:0}
.tb-meta>.tb-cell{flex:1 1 11rem;padding:8px 12px;border-right:1px solid var(--rule);margin-bottom:-1px;border-bottom:1px solid var(--rule)}
.tb-kicker,.tb-k{display:block;font:600 11px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.tb-v{display:block;font-size:14px;margin-top:2px;overflow-wrap:anywhere}
.tb-date .tb-v{font:600 18px/1.3 var(--font-display);letter-spacing:.02em}
.tb-legend .tb-v{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:4px}
h1{font:700 clamp(28px,5vw,44px)/1.05 var(--font-display);letter-spacing:-.005em;margin:6px 0 0}
h2{font:700 clamp(21px,3vw,26px)/1.2 var(--font-display);letter-spacing:.005em;margin:0 0 14px;padding-top:12px;border-top:1.5px solid var(--rule-strong)}
h3{font:640 16px/1.3 var(--font-body);margin:0 0 8px}
.lede{font-size:clamp(17px,2.2vw,19px);line-height:1.5;color:var(--ink);max-width:62ch;margin-bottom:22px}
.toc{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:14px;padding:10px 0;margin:0 0 36px;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.toc span{font:600 11px/1.9 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.toc a{text-decoration:none;color:var(--ink-2)} .toc a:hover{color:var(--accent);text-decoration:underline}
section{margin:0 0 48px}
section:target h2{border-top-color:var(--accent)}
.section-note{color:var(--ink-2);margin-top:-6px}

/* evidence badges */
.badge{display:inline-flex;align-items:center;gap:6px;font:600 11px/1 var(--font-display);letter-spacing:.07em;text-transform:uppercase;color:var(--ink-2);white-space:nowrap}
.badge i{width:11px;height:11px;flex:none;display:inline-block}
.badge.k-mess i{background:var(--accent)}
.badge.k-schaetz i{background:var(--hatch);box-shadow:inset 0 0 0 1px var(--accent)}
.badge.k-offen i{border:1.6px solid var(--warn-line);border-radius:50%}
.badge.k-ent i{background:var(--ink);transform:rotate(45deg) scale(.82)}
.badge.k-fail i{background:linear-gradient(45deg,transparent 42%,var(--fail) 42% 58%,transparent 58%),linear-gradient(-45deg,transparent 42%,var(--fail) 42% 58%,transparent 58%)}

/* tiles */
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,11.5rem),1fr));gap:0;border:1px solid var(--rule);margin:0 0 22px}
.tile{position:relative;padding:14px 16px 12px;border-right:1px solid var(--rule);border-bottom:1px solid var(--rule);margin:0 -1px -1px 0;display:flex;flex-direction:column;gap:4px}
.tile::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--accent)}
.tile.k-schaetz::before{background:var(--hatch)}
.tile.k-offen::before{background:var(--warn-line)}
.tile.k-ent::before{background:var(--ink)}
.tile.k-fail::before{background:var(--fail)}
.tile:not([class*=" k-"])::before{background:var(--rule)}
.tile-label{font-size:13px;color:var(--ink-2);line-height:1.35}
.tile-value{font:620 clamp(26px,4vw,32px)/1.1 var(--font-body);letter-spacing:-.01em}
.tile-unit{font-size:.5em;font-weight:500;color:var(--ink-2);margin-left:.3em;letter-spacing:0}
.tile-note{font-size:12.5px;color:var(--muted);line-height:1.35}
.tile .badge{margin-top:auto;padding-top:6px}
.tile .src{margin-top:2px}

/* cards & grid */
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:14px;margin:0 0 22px}
.grid-wide{grid-template-columns:repeat(auto-fit,minmax(min(100%,24rem),1fr))}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:6px;padding:14px 16px 12px;min-width:0}
.card p,.card ul{font-size:15px}
.card>:last-child{margin-bottom:0}
.card-eyebrow{display:flex;justify-content:space-between;gap:8px;align-items:center;font:600 11px/1.3 var(--font-display);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.card.k-ent{border-color:var(--ink);box-shadow:inset 0 3px 0 var(--ink)}
.card.k-fail{box-shadow:inset 0 3px 0 var(--fail)}
.card.k-offen{box-shadow:inset 0 3px 0 var(--warn-line)}

/* callouts */
.callout{border:1px solid var(--rule);border-left:4px solid var(--accent);background:var(--surface-2);padding:12px 16px;margin:0 0 22px;border-radius:0 6px 6px 0;max-width:78ch}
.callout.k-schaetz{border-left-color:transparent;background:linear-gradient(var(--surface-2),var(--surface-2)) padding-box,var(--hatch) border-box}
.callout.k-offen{border-left-color:var(--warn-line)}
.callout.k-ent{border-left-color:var(--ink);background:var(--surface)}
.callout.k-fail{border-left-color:var(--fail)}
.callout-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;margin-bottom:4px}
.callout-head strong{font-size:16px}
.callout-body>:last-child{margin-bottom:0}
.callout-body p,.callout-body ul{font-size:15px}

/* tables */
.tbl{margin:0 0 22px}
.tbl-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:14px}
caption{text-align:left;font-weight:620;padding:0 0 6px}
th{font:600 11px/1.3 var(--font-display);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:left;padding:6px 10px 6px 0;border-bottom:1.5px solid var(--rule-strong);white-space:nowrap}
td{padding:7px 10px 7px 0;border-bottom:1px solid var(--rule);vertical-align:top}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tbody tr:hover td{background:var(--accent-wash)}

/* details */
.more{margin:0 0 18px;border-top:1px solid var(--rule)}
.more summary{cursor:pointer;list-style:none;padding:8px 0;font-size:14px;color:var(--ink-2);display:flex;gap:8px;align-items:center}
.more summary::-webkit-details-marker{display:none}
.more summary::before{content:"";width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s}
.more[open]>summary::before{transform:rotate(45deg)}
.more summary:hover{color:var(--accent)}
.more-body{padding:4px 0 8px}
.chart .more{margin:10px 0 0}
.chart .more .tbl{margin:0}

/* sources */
.src{font-size:12px;color:var(--muted);margin:8px 0 0;line-height:1.4;max-width:none}
.src span{font:600 10.5px/1 var(--font-display);letter-spacing:.09em;text-transform:uppercase;margin-right:4px}
.src code{font-size:11.5px;background:none;border:0;padding:0;color:var(--ink-2)}

/* figures */
figure{margin:0 0 26px}
.chart{border:1px solid var(--rule);border-radius:6px;padding:14px 16px 12px;background:var(--surface)}
.chart figcaption{display:flex;flex-direction:column;gap:2px;margin-bottom:12px}
.chart figcaption strong{font-size:15px}
.chart figcaption span{font-size:13px;color:var(--muted)}
.img img{display:block;max-width:100%;height:auto;border:1px solid var(--rule);border-radius:4px;background:var(--surface-2)}
.img figcaption{font-size:13px;color:var(--ink-2);margin-top:6px}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;list-style:none;padding:0;margin:0 0 12px;font-size:13px;color:var(--ink-2)}
.legend li{display:flex;align-items:center;gap:6px;margin:0}
.legend b{font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}
.sw{width:12px;height:12px;border-radius:2px;display:inline-block;flex:none}
.sw.f-s1{background:var(--s1)} .sw.f-s2{background:var(--s2)} .sw.f-s3{background:var(--s3)} .sw.f-s4{background:var(--s4)} .sw.f-n{background:var(--n)}
.sw-hatch{background:repeating-linear-gradient(135deg,var(--s1) 0 2px,color-mix(in srgb,var(--s1) 20%,var(--surface)) 2px 5px)}
.sw-line{height:0;width:18px;border-top:2px solid var(--ink-2);border-radius:0}
.sw-line.planned{border-top-style:dashed}

/* svg chart marks */
.hchart{display:block;overflow:visible;font-family:var(--font-body)}
.f-s1{fill:var(--s1)} .f-s2{fill:var(--s2)} .f-s3{fill:var(--s3)} .f-s4{fill:var(--s4)} .f-n{fill:var(--n)} .f-surface{fill:var(--surface)}
.f-s1-wash{fill:color-mix(in srgb,var(--s1) 20%,var(--surface))} .f-n-wash{fill:color-mix(in srgb,var(--n) 25%,var(--surface))}
.on-s1{fill:var(--on-s1)} .on-s2{fill:var(--on-s2)} .on-s3{fill:var(--on-s3)} .on-s4{fill:var(--on-s4)} .on-n{fill:var(--on-n)}
.axis{stroke:var(--rule);stroke-width:1}
.hit{fill:transparent}
.row:hover .hit{fill:var(--accent-wash)}
.t-label{font-size:13px;fill:var(--ink)}
.t-muted{fill:var(--muted);font-size:12px}
.t-value{font-size:12px;font-weight:600;fill:var(--ink);font-variant-numeric:tabular-nums}
.t-value.t-muted{font-weight:500}
.t-in{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.t-delta{font-size:12px;font-weight:600;fill:var(--ink-2);font-variant-numeric:tabular-nums}
.t-delta.good{fill:var(--good)} .t-delta.bad{fill:var(--bad)}

/* diagram */
.dg-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.dg{display:block;max-width:100%;height:auto;font-family:var(--font-body)}
.dg.dg-wide{min-width:520px}
.node rect{fill:var(--surface);stroke:var(--ink-2);stroke-width:1.2}
.node-accent rect{fill:var(--accent-wash);stroke:var(--accent);stroke-width:1.6}
.node-muted rect{fill:var(--surface-2);stroke:var(--rule)}
.node-planned rect{fill:none;stroke:var(--muted);stroke-dasharray:5 4}
.t-node{font-size:13px;font-weight:620;fill:var(--ink)}
.t-node-sub{font-size:11px;fill:var(--muted)}
.node-muted .t-node{fill:var(--ink-2);font-weight:500}
.edge{fill:none;stroke:var(--ink-2);stroke-width:1.4}
.edge.planned{stroke:var(--muted);stroke-dasharray:5 4}
.arrow{fill:var(--ink-2)}
.t-edge{font-size:11px;fill:var(--ink-2);paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round}

.colophon{margin-top:56px;padding-top:12px;border-top:1px solid var(--rule);font-size:12px;color:var(--muted)}

@media (max-width:640px){
  body{font-size:15.5px}
  .sheet{border:0}
  .titleblock{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tb-main{grid-column:1 / -1}
  .tb-date{grid-column:1 / -1}
  .tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tile{padding:12px}
  .chart{padding:12px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media print{
  :root{--page:#fff;--surface:#fff}
  body{background:#fff;font-size:10.5pt}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{max-width:none;padding:0;border:0}
  .toc{display:none}
  section,figure,.card,.callout,.tile{break-inside:avoid}
  h2{break-after:avoid}
  details::details-content{content-visibility:visible;display:block}
  .more summary::before{display:none}
  a{color:inherit;text-decoration:none}
}
`;
