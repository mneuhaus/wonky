// Measurement of the multi-selection (spec 3.3) and the composition of the
// measure feature (the entry measure.js delegates to setupExactMeasure).
//
// With two or more selected entities the inspector shows "Measurement": the
// closed-form rows of POST /api/models/:id/measure (label, value, exactness
// chip, note, method and inputs), unsupported rows with their reason, and
// "Copy measurement", which archives every revision involved first so each
// copied wonky-inspect command resolves after the server stops. Requests are
// latest-wins and never run in the legacy seam (measure is not a legacy
// feature).
import { escape } from '../../core/dom.js';
import { short } from '../../core/format.js';
import { geometryAlias } from '../../core/scene-records.js';
import { createDimensionLayer } from './dimension-layer.js';
import {
  createGeometryCache, registerGeometrySection, rowChip, valueText,
} from './geometry-section.js';
import { createHoverStatus } from './hover-status.js';

const MAX_RESULTS = 24;
const INSPECTABLE = /^B[1-9][0-9]*\.[FEV][1-9][0-9]*$/;

export const referenceKey = reference => [reference.modelId, reference.bodyId,
  reference.entityType, reference.entityIndex].join('|');
export const selectionKey = references => references.map(referenceKey).join(';');

const inputText = (input, full = false) => (full ? input
  : input.replace(/@([a-f0-9]{8})[a-f0-9]{56}$/, '@$1'));

export const unsupportedText = item => `unsupported: ${item.reason}`;

// Entities of a selection set as measure inputs ({ modelId, alias }).
export function measureInputs(scenes, references) {
  return references.map(reference => {
    const scene = scenes.get(reference.modelId);
    return {
      modelId: reference.modelId,
      alias: scene ? geometryAlias(scene, reference)
        : `${reference.bodyId} ${reference.entityType} ${reference.entityIndex}`,
    };
  });
}

const pairLabel = (data, [i, j]) => `${data.entities[i].alias} ↔ ${data.entities[j].alias}`;
const isValue = row => typeof row.value === 'number';
const chipMarkup = chip => `<span class="exactness-chip exactness-${chip.tone}"`
  + ` title="${escape(chip.title)}">${escape(chip.label)}</span>`;

function valueRowMarkup(row, primary) {
  const note = row.note ? `<small class="measure-note">${escape(row.note)}</small>` : '';
  return `<div class="measure-row${primary ? ' measure-primary' : ''}"`
    + ` title="${escape(row.method ?? '')}"><div class="measure-line"><span class="measure-label">`
    + `${escape(row.label)}</span><span class="measure-value">${escape(valueText(row))}</span>`
    + `</div><div class="measure-meta">${chipMarkup(rowChip(row))}${note}</div></div>`;
}

// Decisions and flags of a pair in one line: "Parallel yes · Coplanar no".
function factsMarkup(rows) {
  if (!rows.length) return '';
  const facts = rows.map(row => `<span title="${escape(row.method ?? '')}">`
    + `${escape(row.label)} <strong>${escape(valueText(row))}</strong></span>`).join(' · ');
  return `<p class="measure-facts">${facts} ${chipMarkup(rowChip(rows[0]))}</p>`;
}

function detailMarkup(rows, inputs) {
  const tolerance = rows.find(row => row.toleranceMm)?.toleranceMm;
  const angular = rows[0]?.angularToleranceRad;
  const methods = rows.map(row => `<li><strong>${escape(row.label)}</strong>: `
    + `${escape(row.method ?? 'closed form')}</li>`).join('');
  const limits = [tolerance ? `t = ${tolerance} mm` : '', angular ? `angular ${angular} rad` : '']
    .filter(Boolean).join(', ');
  return '<details class="measure-detail"><summary>Methods and inputs</summary><p>Inputs: '
    + `${inputs.map(input => `<code>${escape(inputText(input))}</code>`).join(', ')}</p>`
    + `${limits ? `<p>Decisions: ${escape(limits)}</p>` : ''}<ul>${methods}</ul></details>`;
}

const unsupportedMarkup = item => '<li><span class="measure-unsupported-reason">'
  + `${escape(unsupportedText(item))}</span></li>`;

function pairMarkup(data, pair, rows, unsupported) {
  const values = rows.filter(([row]) => isValue(row));
  const facts = rows.filter(([row]) => !isValue(row)).map(([row]) => row);
  const inputs = rows[0]?.[0].inputs ?? unsupported[0]?.inputs ?? [];
  return `<div class="measure-pair"><h4>${escape(pairLabel(data, pair))}</h4>`
    + values.map(([row, primary]) => valueRowMarkup(row, primary)).join('')
    + factsMarkup(facts)
    + (unsupported.length ? `<ul class="measure-unsupported">${unsupported
      .map(unsupportedMarkup).join('')}</ul>` : '')
    + (rows.length || inputs.length ? detailMarkup(rows.map(([row]) => row), inputs) : '')
    + '</div>';
}

function entitiesMarkup(references, data) {
  const items = references.map((reference, index) => {
    const entity = data?.entities?.[index];
    const alias = entity?.alias ?? '…';
    const kind = entity ? `${entity.hole === true ? 'hole ' : entity.hole === false ? 'boss '
      : ''}${entity.type}` : reference.entityType;
    const other = index > 0 && reference.modelId !== references[0].modelId
      ? ` <small class="measure-foreign">rev ${escape(short(reference.modelId))}</small>` : '';
    return `<li><span class="measure-entity">${escape(alias)}</span> <span class="muted">`
      + `${escape(kind)}</span>${other}<button class="measure-remove" data-index="${index}"`
      + ` aria-label="Remove ${escape(alias)} from the measurement" title="Remove">×</button></li>`;
  }).join('');
  return `<ol class="measure-entities">${items}</ol>`;
}

export function measurementContent(references, entry, { message } = {}) {
  const data = entry?.status === 'ok' ? entry.data : null;
  let body = '';
  if (!entry || entry.status === 'pending') {
    body = '<p class="small muted measure-status">Measuring…</p>';
  } else if (entry.status === 'error') {
    body = `<p class="measure-error">Measurement failed: ${escape(entry.error.message)}</p>`;
  } else {
    const pairs = new Map();
    const pairOf = pair => {
      const key = pair.join(':');
      if (!pairs.has(key)) pairs.set(key, { pair, rows: [], unsupported: [] });
      return pairs.get(key);
    };
    data.measurements.forEach((row, index) => {
      pairOf(row.pair).rows.push([row, index === data.primary]);
    });
    const loose = [];
    for (const item of data.unsupported) {
      if (item.pair) pairOf(item.pair).unsupported.push(item);
      else loose.push(item);
    }
    body = [...pairs.values()].map(group => pairMarkup(data, group.pair, group.rows,
      group.unsupported)).join('');
    if (loose.length) {
      body += `<ul class="measure-unsupported">${loose.map(unsupportedMarkup).join('')}</ul>`;
    }
    if (!data.measurements.length && !data.unsupported.length) {
      body += '<p class="small muted">No closed-form relation for this selection.</p>';
    }
  }
  const primaryNote = data && data.primary !== null
    ? '<p class="small muted inspector-note">The highlighted row is drawn in the viewport.'
      + ' Its value is the closed form; only the line position comes from the display.</p>' : '';
  return `<h3>Measurement <span class="count">${references.length}</span></h3>`
    + entitiesMarkup(references, data) + body
    + '<div class="measure-actions"><button id="copy-measurement" class="button secondary"'
    + `${data ? '' : ' disabled'}>Copy measurement</button></div>`
    + (message ? `<p class="measure-message">${escape(message)}</p>` : '')
    + primaryNote
    + '<p class="small muted inspector-note">Closed forms over the stored analytic parameters'
    + ' (kernel.precise); decisions use the angular tolerance and the larger entity tolerance.'
    + ' Shift-click or ⌘-click adds or removes entities.</p>';
}

// Plain-text measurement for the clipboard with resolvable detail commands.
export function measurementText(data, { archives = {}, labels = {} } = {}) {
  const lines = ['Measurement (wonky viewer, closed forms over stored analytic parameters)'];
  const models = [...new Set(data.entities.map(entity => entity.modelId))];
  for (const modelId of models) {
    lines.push(`Model ${labels[modelId] ?? 'revision'}: ${modelId}`);
  }
  lines.push(`Entities: ${data.entities.map(entity => `${entity.alias} (${entity.type})`)
    .join(', ')}`, '');
  for (const row of data.measurements) {
    const chip = rowChip(row).label;
    lines.push(`${row.label}: ${valueText(row)} · ${chip}${row.note ? ` · ${row.note}` : ''}`,
      `  method: ${row.method ?? 'closed form'}; inputs: ${row.inputs.join(', ')}`);
  }
  for (const item of data.unsupported) {
    lines.push(`${unsupportedText(item)}${item.inputs?.length
      ? ` (${item.inputs.join(', ')})` : ''}`);
  }
  const commands = [];
  for (const entity of data.entities) {
    const alias = entity.face ?? entity.alias;
    const path = archives[entity.modelId];
    if (!path || !INSPECTABLE.test(alias)) continue;
    commands.push(`node bin/wonky-inspect.mjs ${JSON.stringify(path)} --revision`
      + ` ${entity.modelId} --detail ${alias}`);
  }
  if (commands.length) {
    lines.push('', 'Archived snapshots (resolvable after the viewer stops):',
      ...Object.entries(archives).map(([modelId, path]) => `${modelId}: ${path}`),
      'Exact entity data (run in the wonky-kernel checkout):', ...new Set(commands));
  }
  return lines.join('\n') + '\n';
}

export function createMeasurement(ctx, cache) {
  const { state, app, api, slots, requests, dom: { $, $$ } } = ctx;
  const results = new Map();
  const scope = requests.scope('measure.request');
  let message = null;

  const currentEntry = () => (state.selectionSet.length < 2 ? null
    : results.get(selectionKey(state.selectionSet)) ?? null);

  function patch() {
    const element = $('#measurement-section');
    if (!element || element.dataset.key !== selectionKey(state.selectionSet)) return;
    element.innerHTML = measurementContent(state.selectionSet, currentEntry(), { message });
    bind();
  }

  function request(references) {
    const key = selectionKey(references);
    if (results.has(key)) return results.get(key);
    const { signal, current } = scope.begin();
    const entry = { key, set: [...references], status: 'pending', data: null, error: null };
    results.set(key, entry);
    for (const old of [...results.keys()].slice(0, Math.max(0, results.size - MAX_RESULTS))) {
      results.delete(old);
    }
    const path = `/api/models/${encodeURIComponent(references[0].modelId)}/measure`;
    const entities = measureInputs(state.scenes, references).map((input, index) => ({
      ...input, alias: ctx.renderer.alias(references[index]) ?? input.alias,
    }));
    api.post(path, { entities }, { signal })
      .then(data => {
        entry.status = 'ok';
        entry.data = data;
      })
      .catch(error => {
        if (!current() || error?.name === 'AbortError') {
          results.delete(key);
          return;
        }
        entry.status = 'error';
        entry.error = error;
      })
      .finally(() => {
        patch();
        app.scheduleDraw();
      });
    return entry;
  }

  async function copy() {
    const entry = currentEntry();
    if (entry?.status !== 'ok') return;
    const modelIds = [...new Set(entry.data.entities.map(entity => entity.modelId))];
    let archives;
    try {
      archives = Object.fromEntries(await Promise.all(modelIds.map(async modelId => [modelId,
        (await api.post(`/api/models/${encodeURIComponent(modelId)}/archive`, {})).path])));
    } catch (error) {
      message = `Not copied: the revision could not be archived (${error.message})`;
      patch();
      return;
    }
    message = null;
    const labels = Object.fromEntries(modelIds.map(modelId => [modelId,
      state.scenes.get(modelId)?.label ?? 'revision']));
    await ctx.copyText(measurementText(entry.data, { archives, labels }), 'Measurement copied');
    patch();
  }

  function bind() {
    const copyButton = $('#copy-measurement');
    if (copyButton) copyButton.onclick = () => copy();
    for (const button of $$('#measurement-section .measure-remove')) {
      button.onclick = () => {
        const index = Number(button.dataset.index);
        app.select(state.selectionSet.filter((_reference, other) => other !== index));
      };
    }
  }

  slots.inspector.section({
    id: 'measure.measurement',
    order: 25,
    when: () => state.selectionSet.length >= 2,
    render() {
      message = null;
      return '<section id="measurement-section" class="inspector-section measurement-section"'
        + ` data-key="${escape(selectionKey(state.selectionSet))}">`
        + `${measurementContent(state.selectionSet, currentEntry())}</section>`;
    },
    bind() {
      if (!currentEntry()) request(state.selectionSet);
      bind();
    },
  });

  return {
    current: currentEntry,
    copy,
    refresh: () => (state.selectionSet.length >= 2 ? request(state.selectionSet) : null),
    dispose() {
      scope.abort();
    },
  };
}

// Starts the background geometry load of the displayed models and refreshes
// the overview once a model's recorded bounds arrive.
function createPreload(ctx, cache) {
  const { state, store, app } = ctx;
  let last = '';
  const shown = new Set();
  const run = () => {
    if (state.loading) return;
    const ids = [...new Set(state.compare ? [state.before, state.after] : [state.after])]
      .filter(modelId => modelId && (state.scenes.has(modelId) || ctx.renderer.model(modelId)));
    const key = ids.join(',');
    if (key === last) return;
    last = key;
    for (const modelId of ids) cache.loadModel(modelId);
  };
  const stops = [
    store.subscribe(run),
    cache.onChange(modelId => {
      if (shown.has(modelId) || !cache.bounds(modelId)) return;
      shown.add(modelId);
      if (!state.selection && modelId === state.after) app.renderInspector();
    }),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

// The measure feature: exact geometry section, hover status line,
// measurement section, dimension line and model bounds for the overview.
export function setupExactMeasure(ctx) {
  const cache = createGeometryCache(ctx);
  registerGeometrySection(ctx, cache);
  const measurement = createMeasurement(ctx, cache);
  const hover = createHoverStatus(ctx, cache);
  const dimension = createDimensionLayer(ctx, measurement);
  const stopPreload = createPreload(ctx, cache);
  return {
    api: {
      exactGeometry: cache.entity,
      modelBounds: cache.bounds,
      measureSelection: measurement.refresh,
      copyMeasurement: measurement.copy,
    },
    dispose() {
      stopPreload();
      hover.dispose();
      dimension.dispose();
      measurement.dispose();
    },
  };
}

