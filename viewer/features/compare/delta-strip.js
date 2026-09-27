// Delta strip in the model bar and the revision-delta drawer.
// Owner: model-first-compare.
//
// Single mode: the displayed revision against the previous revision of the
// same source. Compare mode: before against after. Data from
// GET /api/compare (cached per pair; revisions are immutable). The strip
// never opens a wipe by itself. Kept off the legacy path (VS): no request,
// strip hidden. Failures show in the strip itself, never in #global-error.
import { escape } from '../../core/dom.js';
import { exactnessChipMarkup, number, toleranceDecimals } from '../../core/format.js';

const MINUS = '−';

// "5, 7, 9-12" (same rule as lineRanges in src/viewer/source-diff.mjs).
export function lineRanges(lines) {
  const sorted = [...new Set(lines)].sort((left, right) => left - right);
  const parts = [];
  for (let index = 0; index < sorted.length; index++) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
    parts.push(end > index ? `${sorted[index]}-${sorted[end]}` : String(sorted[index]));
    index = end;
  }
  return parts.join(', ');
}

export const signed = (value, digits = 2) => {
  if (!Number.isFinite(value)) return 'not evaluated';
  const text = number(Math.abs(value), digits);
  if (text === '0') return '0';
  return `${value > 0 ? '+' : MINUS}${text}`;
};

const plural = (count, word) => `${word}${count === 1 ? '' : 's'}`;

export function countText(label, value) {
  if (!value || value.before === null || value.after === null) return `${label} not evaluated`;
  if (value.delta === 0) return `${label} ${value.after}`;
  return `${label} ${value.before} → ${value.after}`;
}

export function facesText(deltas) {
  const raw = countText('faces', deltas.faces);
  const logical = deltas.logicalFaces;
  if (!logical || logical.status === 'unavailable' || logical.before === null) {
    return `${raw} (logical unavailable)`;
  }
  const value = logical.delta === 0 ? `${logical.after}` : `${logical.before} → ${logical.after}`;
  return `${raw} (logical ${value})`;
}

// Digits for a bounds delta: recorded values to 0.001 mm, display values to
// the decade of their tolerance.
const boundsDigits = bounds => (bounds.exactness === 'display-approximation'
  ? toleranceDecimals(bounds.toleranceMm) : 3);

export function boundsText(bounds) {
  if (!bounds || bounds.status !== 'evaluated') return 'bounds not evaluated';
  const digits = boundsDigits(bounds);
  return `bounds Δ ${bounds.delta.size.map(value => signed(value, digits)).join(' × ')} mm`;
}

export const sizeText = (box, digits = 3) => (box
  ? `${box.size.map(value => number(value, digits)).join(' × ')} mm` : 'not evaluated');

export function volumeText(volume) {
  if (!volume || volume.status !== 'evaluated') return 'volume not evaluated';
  return `volume ${signed(volume.delta, 1)} mm³`;
}

const fileName = path => String(path ?? '').split(/[/\\]/).at(-1);

// "imports: dims.py changed, extra.py added" from sourceLines.modules, or ''.
export function modulesText(modules) {
  if (!modules) return '';
  const parts = [['changed', modules.changed], ['added', modules.added],
    ['removed', modules.removed]].filter(([, paths]) => paths?.length)
    .map(([verb, paths]) => `${paths.map(fileName).join(', ')} ${verb}`);
  return parts.length ? `imports: ${parts.join(', ')}` : '';
}

export function sourceText(sourceLines) {
  const top = topLevelText(sourceLines);
  const imports = modulesText(sourceLines?.modules);
  return imports ? `${top} · ${imports}` : top;
}

function topLevelText(sourceLines) {
  const status = sourceLines?.status;
  if (status === 'unchanged') return 'source unchanged';
  if (status === 'different-files') return 'source: different files';
  if (status !== 'changed') return 'source: not comparable';
  const parts = [];
  const push = (lines, verb) => {
    if (lines?.length) parts.push(`${plural(lines.length, 'line')} ${lineRanges(lines)} ${verb}`);
  };
  push(sourceLines.changed, 'changed');
  push(sourceLines.added, 'added');
  push(sourceLines.removed, sourceLines.changed?.length || sourceLines.added?.length
    ? 'removed (before numbering)' : 'removed');
  if (!parts.length) return 'source: only the final line ending differs';
  return `source: ${parts.join(', ')}${sourceLines.coarse ? ' (coarse)' : ''}`;
}

const chip = (exactness, toleranceMm) => (exactness
  ? exactnessChipMarkup(exactness, toleranceMm) : '');

// Strip items: [{ key, text, chip, title, changed }].
export function deltaItems(result) {
  const { deltas, sourceLines } = result;
  const changed = value => !!value && value.delta !== 0 && value.delta !== null;
  const bounds = deltas.bounds;
  return [
    { key: 'bodies', text: countText('bodies', deltas.bodies), changed: changed(deltas.bodies) },
    {
      key: 'faces', text: facesText(deltas),
      changed: changed(deltas.faces) || changed(deltas.logicalFaces),
      title: deltas.logicalFaces?.reason ?? 'Stored B-rep faces; logical faces join fragments'
        + ' across exact subdivision edges',
    },
    { key: 'edges', text: countText('edges', deltas.edges), changed: changed(deltas.edges) },
    {
      key: 'volume', text: volumeText(deltas.volumeMm3), chip: chip('recorded'),
      changed: changed(deltas.volumeMm3),
      title: deltas.volumeMm3.status === 'evaluated'
        ? `${number(deltas.volumeMm3.before, 2)} → ${number(deltas.volumeMm3.after, 2)} mm³`
        : `Recorded volume is null for the ${(deltas.volumeMm3.notEvaluated ?? []).join(' and ')}`
          + ' revision',
    },
    {
      key: 'bounds', text: boundsText(bounds), chip: chip(bounds.exactness, bounds.toleranceMm),
      changed: bounds.status === 'evaluated' && bounds.delta.size.some(value => value !== 0),
      title: bounds.status === 'evaluated'
        ? `${sizeText(bounds.before, boundsDigits(bounds))} → `
          + `${sizeText(bounds.after, boundsDigits(bounds))}`
        : 'No recorded or display bounds',
    },
    {
      key: 'source', text: sourceText(sourceLines),
      changed: sourceLines.status === 'changed' || !!sourceLines.modulesChanged,
      title: [sourceLines.reason ?? sourceLines.after?.file,
        ...(sourceLines.modules?.changed ?? [])].filter(Boolean).join('\n'),
    },
  ];
}

export const itemMarkup = item => `<span class="delta-item${item.changed ? ' changed' : ''}"`
  + `${item.title ? ` title="${escape(item.title)}"` : ''}>${escape(item.text)}`
  + `${item.chip ?? ''}</span>`;

// ---------------------------------------------------------------------------
// Drawer: the complete comparison with labels.

const cell = value => `<td>${escape(value ?? '–')}</td>`;
const countRow = (label, value) => `<tr><th>${escape(label)}</th>${cell(value?.before)}`
  + `${cell(value?.after)}${cell(Number.isInteger(value?.delta) ? signed(value.delta, 0) : null)}`
  + '<td></td></tr>';

function boxRows(bounds) {
  if (bounds.status !== 'evaluated') {
    return '<tr><th>Bounds</th><td colspan="3">not evaluated</td><td></td></tr>';
  }
  const digits = boundsDigits(bounds);
  const triple = value => value.map(entry => number(entry, digits)).join(', ');
  const deltaTriple = value => value.map(entry => signed(entry, digits)).join(', ');
  const label = chip(bounds.exactness, bounds.toleranceMm);
  return ['size', 'min', 'max'].map(key => `<tr><th>Bounds ${key} (mm)</th>`
    + `${cell(triple(bounds.before[key]))}${cell(triple(bounds.after[key]))}`
    + `${cell(deltaTriple(bounds.delta[key]))}<td>${label}</td></tr>`).join('');
}

function volumeRow(volume) {
  const value = side => (volume[side] === null ? 'not evaluated' : number(volume[side], 2));
  return `<tr><th>Volume (mm³)</th>${cell(value('before'))}${cell(value('after'))}`
    + `${cell(volume.status === 'evaluated' ? signed(volume.delta, 2) : 'not evaluated')}`
    + `<td>${chip('recorded')}</td></tr>`;
}

function bodyRows(matches) {
  return matches.map(row => `<tr><th>${escape(row.name ?? row.bodyId)}`
    + `<small>${escape([row.alias.before, row.alias.after].filter(Boolean).join(' → '))}</small>`
    + `</th><td>${escape(row.status)}</td>${cell(countText('', row.faces).trim())}`
    + `${cell(countText('', row.edges).trim())}`
    + `${cell(row.volumeMm3.status === 'evaluated' ? `${signed(row.volumeMm3.delta, 2)} mm³`
      : 'not evaluated')}`
    + `${cell(row.bounds.status === 'evaluated'
      ? row.bounds.delta.size.map(value => signed(value, 3)).join(' × ') : 'not evaluated')}`
    + '</tr>').join('');
}

const excerptLine = (kind, line, text) => `<span class="delta-line ${kind}">`
  + `<span class="line-number">${line}</span><span class="line-mark">`
  + `${kind === 'removed' ? MINUS : '+'}</span><code>${escape(text ?? '')}</code></span>`;

// Changed lines as old/new pairs, added lines, in after order; lines removed
// without replacement at the end (before numbering). Without the frozen
// texts, the line numbers alone.
export function sourceExcerpt(sourceLines, texts = {}) {
  const before = String(texts.before ?? '').split('\n');
  const after = String(texts.after ?? '').split('\n');
  const from = sourceLines.changedFrom ?? [];
  const rows = [
    ...sourceLines.changed.map((line, index) => ({ line, pair: from[index] })),
    ...sourceLines.added.map(line => ({ line })),
  ].sort((left, right) => left.line - right.line);
  const markup = rows.map(({ line, pair }) => (pair && texts.before !== undefined
    ? excerptLine('removed', pair, before[pair - 1]) : '')
    + excerptLine('changed', line, after[line - 1]))
    .concat(sourceLines.removed.map(line => excerptLine('removed', line, before[line - 1])));
  return `<pre class="delta-source">${markup.join('')}</pre>`;
}

export function detailsMarkup(result, { names, texts = {} }) {
  const { deltas, sourceLines } = result;
  const source = sourceLines.status === 'changed'
    ? (texts.after === undefined ? '<p class="small muted">Frozen source text unavailable;'
      + ' line numbers only.</p>' : '') + sourceExcerpt(sourceLines, texts)
    : `<p class="small muted">${escape(sourceLines.reason ?? sourceText(sourceLines))}</p>`;
  const file = sourceLines.after?.file ?? sourceLines.before?.file;
  return '<div class="delta-report">'
    + `<p class="small muted">${escape(result.scope ?? '')}</p>`
    + `<table class="delta-table"><thead><tr><th></th><th>${escape(names.before)}</th>`
    + `<th>${escape(names.after)}</th><th>Δ</th><th>Label</th></tr></thead><tbody>`
    + countRow('Bodies', deltas.bodies) + countRow('Faces (stored)', deltas.faces)
    + countRow('Faces (logical)', deltas.logicalFaces) + countRow('Edges', deltas.edges)
    + countRow('Vertices', deltas.vertices) + volumeRow(deltas.volumeMm3)
    + boxRows(deltas.bounds) + '</tbody></table>'
    + '<h3>Bodies <small>matched by body id</small></h3>'
    + '<table class="delta-table bodies"><thead><tr><th>Body</th><th>Status</th><th>Faces</th>'
    + '<th>Edges</th><th>Volume Δ</th><th>Size Δ (mm)</th></tr></thead><tbody>'
    + `${bodyRows(deltas.bodyMatches)}</tbody></table>`
    + `<h3>Source <small>${escape(sourceText(sourceLines))}</small></h3>`
    + (file ? `<p class="small muted"><code>${escape(file)}</code></p>` : '')
    + `${source}</div>`;
}

// ---------------------------------------------------------------------------
// Controller.

export function createDeltaStrip(ctx) {
  const { state, app, api, dom: { $ } } = ctx;
  const results = new Map();
  const failures = new Map();
  const pending = new Map();
  const pairKey = (before, after) => `${before}:${after}`;

  // { mode: 'previous' | 'compare' | 'choose' | 'first', before?, after }
  function target() {
    if (!state.after) return null;
    if (state.compare) {
      if (!state.before || state.before === state.after) return { mode: 'choose' };
      return { mode: 'compare', before: state.before, after: state.after };
    }
    const previous = app.previousRevision?.(state.after);
    return previous ? { mode: 'previous', before: previous, after: state.after }
      : { mode: 'first', after: state.after };
  }

  function fetchPair(before, after) {
    const key = pairKey(before, after);
    if (results.has(key) || pending.has(key)) return;
    const path = `/api/compare?before=${encodeURIComponent(before)}`
      + `&after=${encodeURIComponent(after)}`;
    const request = api.json(path).then(data => {
      results.set(key, data);
      failures.delete(key);
    }, error => {
      failures.set(key, error.message);
    }).finally(() => {
      pending.delete(key);
      render();
    });
    pending.set(key, request);
  }

  // Single mode names the previous revision ("Δ vs r2 · 14:03"); in compare
  // mode the selectors right above name both models.
  const lead = next => (next.mode === 'previous'
    ? `Δ vs ${app.revisionText?.(next.before) || 'previous'}` : 'Δ before → after');

  function render() {
    const element = $('#delta-strip');
    if (!element) return;
    const next = ctx.legacy ? null : target();
    element.hidden = !next;
    if (!next) return;
    element.dataset.mode = next.mode;
    if (next.mode === 'first') {
      element.innerHTML = '<span class="delta-note">No earlier revision of this source · no'
        + ' delta</span>';
      return;
    }
    if (next.mode === 'choose') {
      element.innerHTML = '<span class="delta-note">Choose a before model to see the'
        + ' delta</span>';
      return;
    }
    const key = pairKey(next.before, next.after);
    const data = results.get(key);
    if (!data) {
      if (failures.has(key)) {
        element.innerHTML = `<span class="delta-note failed">Delta unavailable: `
          + `${escape(failures.get(key))}</span>`;
      } else {
        element.innerHTML = `<span class="delta-note">${escape(lead(next))} · comparing…</span>`;
        fetchPair(next.before, next.after);
      }
      return;
    }
    element.innerHTML = `<button id="delta-details" class="delta-button" type="button"`
      + ' title="Show every delta with its label">'
      + `<span class="delta-lead">${escape(lead(next))}</span>`
      + `${deltaItems(data).map(itemMarkup).join('<span class="delta-sep">·</span>')}</button>`;
    const button = $('#delta-details');
    button.onclick = () => openDetails(next).catch(ctx.showError);
    // A fade marks a strip cut by the column width; the drawer has everything.
    button.classList.toggle('overflowing', button.scrollWidth > button.clientWidth + 1);
  }

  async function openDetails(next) {
    const data = results.get(pairKey(next.before, next.after));
    if (!data) return;
    const names = {
      before: app.revisionName?.(next.before) || 'Before',
      after: app.revisionName?.(next.after) || 'After',
    };
    const lines = data.sourceLines;
    await ctx.drawer.open({
      title: `${names.before} → ${names.after}`, eyebrow: 'Revision delta',
      load: async signal => {
        const texts = {};
        if (lines.status === 'changed') {
          const read = side => api.json(`/api/source/${lines[side].sha256}`, { signal })
            .then(value => {
              texts[side] = value.text;
            }, () => {});
          await Promise.all([read('before'), read('after')]);
        }
        return texts;
      },
      render: texts => {
        $('#report-drawer .eyebrow').textContent = 'Revision delta';
        $('#report-content').innerHTML = detailsMarkup(data, { names, texts });
      },
    });
  }

  return { render, target, results };
}
