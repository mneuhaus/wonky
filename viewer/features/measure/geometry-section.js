// Exact geometry: the client cache of GET /api/models/:id/geometry, the
// formatters shared by the hover status line and the inspector, and the
// "Exact geometry" inspector section (spec 3.2).
//
// The browser only formats: every value comes from the server's closed forms
// over stored analytic parameters (`exact-parameters`, with the entity
// tolerance t). Values print to the decade of t; directions are unit vectors
// printed to six decimals. Display meshes are never measured here.
import { escape } from '../../core/dom.js';
import {
  exactnessChip, exactnessChipMarkup, formatAngle, formatLength, toleranceDecimals,
} from '../../core/format.js';
import { geometryAlias } from '../../core/scene-records.js';

const MAX_MODELS = 8;
const capitalized = text => text[0].toUpperCase() + text.slice(1);

// Number to `decimals` places without a "-0.000" for values that round to 0.
export function fixed(value, decimals) {
  const text = value.toFixed(decimals);
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
}

export const formatPoint = (point, toleranceMm) => {
  const decimals = toleranceDecimals(toleranceMm);
  return `(${point.map(value => fixed(value, decimals)).join(', ')})`;
};

export const formatDirection = direction => `(${direction
  .map(value => String(Number(fixed(value, 6)))).join(', ')})`;

const length = (value, toleranceMm, prefix = '') => formatLength(value, toleranceMm, { prefix });
const chipText = entry => exactnessChip(entry.exactness === 'unsupported' ? 'unsupported'
  : entry.exactness, entry.toleranceMm).label;

// "8.00000 mm", "90.000°", "yes"; lengths print to the decade of their tolerance.
export function valueText(row) {
  if (typeof row.value === 'boolean') return row.value ? 'yes' : 'no';
  if (typeof row.value === 'string') return row.value;
  if (row.unit === 'deg') return formatAngle(row.value);
  if (row.unit === 'mm') return formatLength(row.value, row.toleranceMm);
  return String(row.value);
}

export const rowChip = row => exactnessChip(row.exactness,
  row.unit === 'mm' ? row.toleranceMm : null);

// Short type and key parameter, e.g. "Cylinder hole Ø4.0000 mm".
export function summaryText(entry) {
  const t = entry.toleranceMm;
  if (entry.kind === 'vertex') return `Point ${formatPoint(entry.point, t)}`;
  if (entry.kind === 'edge') {
    const curve = entry.curve;
    if (curve.type === 'line') return `Line · ${length(entry.lengthMm, t)}`;
    if (curve.type === 'circle') {
      return curve.full ? `Circle ${length(curve.diameterMm, t, 'Ø')}`
        : `Arc R${length(curve.radiusMm, t)} · ${formatAngle(curve.sweepDeg)}`;
    }
    return `${capitalized(curve.type)} edge`;
  }
  const surface = entry.surface;
  if (surface.type === 'plane') {
    return `Plane · normal ${formatDirection(surface.normal)} · offset `
      + `${length(surface.offsetMm, t)}`;
  }
  if (surface.type === 'cylinder') {
    return `Cylinder ${surface.sense} ${length(surface.diameterMm, t, 'Ø')}`;
  }
  if (surface.type === 'cone') {
    const rims = surface.rimRadiiMm.map(radius => length(2 * radius, t, 'Ø')).join(' to ');
    return `Cone ${surface.sense} · half angle ${formatAngle(surface.halfAngleDeg)}`
      + (rims ? ` · ${rims}` : '');
  }
  return `${capitalized(surface.type)} face`;
}

// Status line text: "Cylinder hole Ø4.0000 mm · exact ±0.0003 · B1.F3".
export function hoverText(entry) {
  const unsupported = entry.unsupported ?? entry.surface?.unsupported;
  const logical = entry.kind === 'face' && entry.fragments?.length > 1
    ? ` · ${entry.logical} (${entry.fragments.length} fragments)` : '';
  return [summaryText(entry), unsupported ? `unsupported: ${unsupported}` : chipText(entry)]
    .join(' · ') + ` · ${entry.alias}${logical}`;
}

// [label, value] rows of the Exact geometry section (spec 3.2).
export function exactRows(entry) {
  const t = entry.toleranceMm;
  const point = value => formatPoint(value, t);
  if (entry.kind === 'vertex') return [['Point · mm', point(entry.point)]];
  if (entry.kind === 'edge') {
    const curve = entry.curve;
    if (curve.type === 'line') {
      return [['Start · mm', point(curve.startMm)], ['End · mm', point(curve.endMm)],
        ['Length', length(entry.lengthMm, t)],
        ['Direction', curve.direction ? formatDirection(curve.direction) : 'undefined']];
    }
    if (curve.type === 'circle') {
      return [['Center · mm', point(curve.centerMm)], ['Normal', formatDirection(curve.normal)],
        ['Diameter', length(curve.diameterMm, t, 'Ø')], ['Radius', length(curve.radiusMm, t)],
        ['Sweep', formatAngle(curve.sweepDeg)], ['Arc length', length(entry.lengthMm, t)]];
    }
    if (curve.type === 'ellipse') {
      return [['Center · mm', point(curve.centerMm)],
        ['Major radius', length(curve.majorRadiusMm, t)],
        ['Minor radius', length(curve.minorRadiusMm, t)], ['Sweep', formatAngle(curve.sweepDeg)],
        ['Arc length', `unsupported: ${entry.unsupported}`]];
    }
    return [['Curve', `unsupported: ${entry.unsupported}`]];
  }
  const surface = entry.surface;
  if (surface.type === 'plane') {
    return [['Outward normal', formatDirection(surface.normal)],
      ['Offset along normal', length(surface.offsetMm, t)],
      ['Frame x', formatDirection(surface.frame.x)], ['Frame y', formatDirection(surface.frame.y)],
      ['Origin · mm', point(surface.originMm)]];
  }
  const axis = surface.axis && [['Axis direction', formatDirection(surface.axis.direction)],
    ['Axis point nearest origin · mm', point(surface.axis.pointNearestOriginMm)]];
  if (surface.type === 'cylinder') {
    return [['Kind', capitalized(surface.sense)], ['Diameter', length(surface.diameterMm, t, 'Ø')],
      ['Radius', length(surface.radiusMm, t)], ...axis,
      ['Outward normal', `radial, ${surface.normalSense}`]];
  }
  if (surface.type === 'cone') {
    return [['Kind', capitalized(surface.sense)],
      ['Half angle', formatAngle(surface.halfAngleDeg)],
      ['Rim radii', surface.rimRadiiMm.map(radius => length(radius, t)).join(', ') || 'none'],
      ['Radius at origin', length(surface.radiusAtOriginMm, t)],
      ['Apex · mm', surface.apexMm ? point(surface.apexMm) : 'none'], ...axis];
  }
  return [['Surface', `unsupported: ${surface.unsupported}`]];
}

// Client cache of the geometry API, per model id (at most MAX_MODELS).
export function createGeometryCache(ctx) {
  const { api } = ctx;
  const models = new Map();
  const listeners = new Set();
  const notify = modelId => {
    for (const listener of [...listeners]) listener(modelId);
  };
  const url = (modelId, query) => `/api/models/${encodeURIComponent(modelId)}/geometry?${query}`;

  function record(modelId) {
    if (!models.has(modelId)) {
      models.set(modelId, {
        entities: new Map(), bounds: null, bodies: null, complete: false, loading: null,
        error: null,
      });
      for (const key of [...models.keys()].slice(0, Math.max(0, models.size - MAX_MODELS))) {
        if (!models.get(key).loading) models.delete(key);
      }
    }
    return models.get(modelId);
  }
  function absorb(modelId, data) {
    const model = record(modelId);
    for (const [kind, key] of [['face', 'faces'], ['edge', 'edges'], ['vertex', 'vertices']]) {
      for (const entry of data[key] ?? []) model.entities.set(entry.alias, { kind, ...entry });
    }
    for (const entry of data.logicalFaces ?? []) {
      model.entities.set(entry.alias, { kind: 'face', logical: entry.alias, ...entry });
    }
    model.bounds = data.bounds ?? model.bounds;
    model.bodies = data.bodies ?? model.bodies;
  }
  // Loads every page of a model once (in the background, page by page).
  function loadModel(modelId) {
    const model = record(modelId);
    if (model.complete || model.loading || model.error) return model.loading;
    model.loading = (async () => {
      let pages = 1;
      for (let page = 0; page < pages; page++) {
        const data = await api.json(url(modelId, `page=${page}`));
        absorb(modelId, data);
        pages = data.pages;
        notify(modelId);
      }
      model.complete = true;
    })().catch(error => {
      model.error = error;
      notify(modelId);
    }).finally(() => {
      model.loading = null;
    });
    return model.loading;
  }
  // Fetches the given aliases unless they are cached already.
  async function ensure(modelId, aliases, { signal } = {}) {
    const model = record(modelId);
    const missing = aliases.filter(alias => !model.entities.has(alias));
    if (!missing.length) return;
    const data = await api.json(url(modelId, `aliases=${missing.map(encodeURIComponent)
      .join(',')}`), { signal });
    absorb(modelId, data);
    notify(modelId);
  }
  return {
    loadModel,
    ensure,
    entity: (modelId, alias) => models.get(modelId)?.entities.get(alias) ?? null,
    bounds: modelId => models.get(modelId)?.bounds ?? null,
    error: modelId => models.get(modelId)?.error ?? null,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const rowMarkup = ([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`;

function fragmentMarkup(entry) {
  if (entry.kind !== 'face' || !entry.logical) return '';
  const buttons = entry.fragments.map(alias => `<button class="exact-fragment"`
    + ` data-fragment="${escape(alias)}" aria-pressed="${alias === entry.alias}">`
    + `${escape(alias)}</button>`).join('');
  const noun = entry.fragments.length > 1 ? 'fragments' : 'fragment';
  return `<p class="exact-logical"><span>Logical face <strong>${escape(entry.logical)}</strong>`
    + `</span><span class="exact-fragments">${noun} ${buttons}</span></p>`;
}

export function exactSectionContent(entry, { pending = false, error = null } = {}) {
  if (error) {
    return '<h3>Exact geometry</h3><p class="exact-error">Exact geometry unavailable: '
      + `${escape(error.message ?? String(error))}</p>`;
  }
  if (!entry) {
    return '<h3>Exact geometry</h3>'
      + `<p class="small muted">${pending ? 'Loading exact geometry…' : 'Not loaded'}</p>`;
  }
  const unsupported = entry.unsupported ?? entry.surface?.unsupported;
  const chip = exactnessChipMarkup(unsupported ? 'unsupported' : entry.exactness,
    entry.toleranceMm);
  return `<h3>Exact geometry ${chip}</h3>`
    + `<p class="exact-summary">${escape(summaryText(entry))}</p>${fragmentMarkup(entry)}`
    + `<dl class="properties exact-properties">${exactRows(entry).map(rowMarkup).join('')}</dl>`
    + '<p class="small muted inspector-note">Closed form over the stored analytic parameters;'
    + ' tolerance t is the recorded entity tolerance. The display mesh is not used.</p>';
}

// "Exact geometry" inspector section for the primary selection.
export function registerGeometrySection(ctx, cache) {
  const { slots, app, dom: { $, $$ } } = ctx;
  const aliasOf = ({ scene, reference }) => geometryAlias(scene, reference);
  const key = context => `${context.reference.modelId}:${aliasOf(context)}`;

  function bindFragments(context, entry) {
    for (const button of $$('#exact-geometry .exact-fragment')) {
      button.onclick = () => {
        const index = Number(button.dataset.fragment.split('.F')[1]) - 1;
        app.select({
          modelId: context.reference.modelId, bodyId: entry.bodyId, entityType: 'face',
          entityIndex: index,
        });
      };
    }
  }
  function patch(context) {
    const element = $('#exact-geometry');
    if (!element || element.dataset.key !== key(context)) return;
    const entry = cache.entity(context.reference.modelId, aliasOf(context));
    element.innerHTML = exactSectionContent(entry, { error: entry ? null
      : cache.error(context.reference.modelId) });
    if (entry) bindFragments(context, entry);
  }

  slots.inspector.section({
    id: 'measure.exact',
    order: 20,
    when: ({ reference }) => !!reference && reference.entityType !== 'body',
    render(context) {
      const entry = cache.entity(context.reference.modelId, aliasOf(context));
      return `<section id="exact-geometry" class="inspector-section exact-geometry"`
        + ` data-key="${escape(key(context))}">${exactSectionContent(entry, { pending: true })}`
        + '</section>';
    },
    bind(context) {
      const entry = cache.entity(context.reference.modelId, aliasOf(context));
      if (entry) {
        bindFragments(context, entry);
        return;
      }
      cache.ensure(context.reference.modelId, [aliasOf(context)])
        .then(() => patch(context))
        .catch(error => {
          const element = $('#exact-geometry');
          if (element?.dataset.key === key(context)) {
            element.innerHTML = exactSectionContent(null, { error });
          }
        });
    },
  });
}
