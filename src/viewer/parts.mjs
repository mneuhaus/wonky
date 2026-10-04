// Parts table for GET /api/models/:id/parts (spec 9.2). Package: parts-tree.
//
// Frozen signature:
//   partsOf(model, { logical }) -> { bodies: [{ alias, id, name, appearance, representation,
//                                               counts, volumeMm3, boundsMm, operation,
//                                               provenance }] }
//
// `logical` is a function model -> logicalFaces(model) (the default,
// src/viewer/logical-faces.mjs). Nothing here computes new geometry: counts
// are the stored B-rep topology, logical face counts are the exact
// subdivision grouping of topology-classes, volume and bounds are the
// recorded build-time values (null stays "not evaluated", never 0), and
// appearance, name, operation and provenance are recorded model data.
//
// Each body also carries the keys the viewer needs:
//   label        name, else body id (what the parts tree shows)
//   settingsKey  the SB settings key (spec section 6): the body name when it
//                is present and unique in the model, else the body id
//   color        { rgb, hex, source: 'appearance' } from the appearance
//                record, or null (the viewer then uses its palette and says
//                "viewer color"; that color is not model data)
import { logicalFaces as defaultLogicalFaces } from './logical-faces.mjs';
import { viewerRecord } from './model-record.mjs';
import { rustBodyFacts } from './rust-facts.mjs';

export const PARTS_SCHEMA = 'wonky.viewer-parts/1';

export const PARTS_SCOPE = 'Counts are the stored B-rep topology; logical faces join fragments'
  + ' across exact subdivision edges. Volume and bounds are recorded build-time values (null:'
  + ' not evaluated). Name, appearance, operation and provenance are recorded model data.';

export const PARTS_EXACTNESS = Object.freeze({
  counts: 'recorded',
  logicalFaces: 'exact-parameters',
  volumeMm3: 'recorded',
  boundsMm: 'recorded',
  appearance: 'recorded',
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp01 = value => Math.min(1, Math.max(0, value));
const triple = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const copy = value => (value === undefined ? null : structuredClone(value));
const nameOf = body => (typeof body.name === 'string' && body.name.length ? body.name : null);

// [r, g, b] in 0..1 from an appearance record, with the same rule as the
// renderer (viewer/render/style.js appearanceColor): {red, green, blue} in
// 0..1 (0..255 when a channel exceeds 1) or {color: {red, green, blue}} in
// 0..255. Anything else is null.
export function appearanceRgb(appearance) {
  if (!appearance || typeof appearance !== 'object') return null;
  if (Array.isArray(appearance)) {
    return appearance.length >= 3 && appearance.slice(0, 3).every(finite)
      ? appearance.slice(0, 3).map(clamp01) : null;
  }
  const nested = appearance.color && typeof appearance.color === 'object';
  const source = nested ? appearance.color : appearance;
  const channels = [source.red, source.green, source.blue];
  if (!channels.every(finite)) return null;
  const scale = nested || channels.some(value => value > 1) ? 255 : 1;
  return channels.map(value => clamp01(value / scale));
}

export const rgbHex = rgb => `#${rgb.map(value => Math.round(clamp01(value) * 255)
  .toString(16).padStart(2, '0')).join('')}`;

// SB settings key of every body: the name when present and unique, else the id.
export function settingsKeys(bodies) {
  const names = new Map();
  for (const body of bodies) {
    const name = nameOf(body);
    if (name) names.set(name, (names.get(name) ?? 0) + 1);
  }
  return bodies.map(body => {
    const name = nameOf(body);
    return name && names.get(name) === 1 ? name : body.id;
  });
}

function logicalCounts(model, logical) {
  try {
    const result = logical(model);
    const counts = model.bodies.map((_body, index) => result?.bodies?.[index]?.groups?.length);
    if (!counts.every(Number.isInteger)) throw new Error('logicalFaces returned no groups');
    return { counts, reason: null };
  } catch (error) {
    return { counts: model.bodies.map(() => null), reason: error.message };
  }
}

const validBox = value => !!value && triple(value.min) && triple(value.max)
  && value.min.every((entry, index) => entry <= value.max[index]);

function boundsOf(body) {
  const bounds = body.validation?.boundsMm;
  if (!validBox(bounds)) return null;
  return {
    min: [...bounds.min], max: [...bounds.max],
    size: bounds.max.map((value, index) => value - bounds.min[index]),
  };
}

// The recorded operation that produced the body: identity operation id and
// type, the FeatureScript call name from the source map, and its source point.
function operationOf(model, body) {
  const identity = body.identity ?? null;
  const recorded = identity?.operation ?? null;
  const id = recorded?.id ?? identity?.operationId ?? null;
  const mapped = id ? model.sourceMap?.operations?.find(entry => entry.operationId === id) : null;
  const source = recorded?.source ?? mapped?.source ?? body.debug?.source ?? null;
  if (!id && !source) return null;
  return {
    id,
    type: recorded?.type ?? null,
    name: mapped?.name ?? null,
    source: source ? {
      file: source.file ?? null, sha256: source.sha256 ?? null, span: copy(source.span ?? null),
    } : null,
  };
}

function partOf(model, body, index, { logicalFaces, settingsKey, kernel }) {
  const facts = kernel ? rustBodyFacts(kernel, body) : null;
  const rgb = appearanceRgb(body.appearance);
  const volume = body.validation?.volumeMm3;
  const name = nameOf(body);
  return {
    index,
    alias: `B${index + 1}`,
    id: body.id,
    name,
    label: name ?? body.id,
    settingsKey,
    appearance: copy(body.appearance ?? null),
    color: rgb ? { rgb, hex: rgbHex(rgb), source: 'appearance' } : null,
    representation: {
      geometry: body.geometry ?? 'planar',
      precision: body.precision ?? model.backend?.precision ?? null,
      closed: typeof body.validation?.closed === 'boolean' ? body.validation.closed : null,
    },
    counts: {
      faces: body.faces.length,
      logicalFaces,
      edges: body.edges.length,
      vertices: body.vertices.length,
    },
    volumeMm3: finite(volume) ? volume : null,
    boundsMm: boundsOf(body),
    validationScope: body.validation?.scope ?? null,
    toleranceMm: finite(body.validation?.toleranceMm) ? body.validation.toleranceMm : null,
    operation: operationOf(model, body),
    identity: body.identity ? {
      role: body.identity.role ?? null, stability: body.identity.stability ?? null,
    } : null,
    provenance: copy(body.provenance ?? null),
    ...(facts ? { kernelFacts: facts } : {}),
  };
}

export function partsOf(model, { logical = defaultLogicalFaces, kernel = null } = {}) {
  model = viewerRecord(model);
  if (model?.schema !== 'wonky-brep/1' || !Array.isArray(model.bodies)) {
    throw new TypeError('partsOf needs a wonky-brep/1 model');
  }
  const logicalResult = logicalCounts(model, logical);
  const keys = settingsKeys(model.bodies);
  const bodies = model.bodies.map((body, index) => partOf(model, body, index, {
    logicalFaces: logicalResult.counts[index], settingsKey: keys[index], kernel,
  }));
  const sum = key => bodies.reduce((total, body) => (total === null
    || body.counts[key] === null ? null : total + body.counts[key]), 0);
  return {
    totals: {
      bodies: bodies.length, faces: sum('faces'), logicalFaces: sum('logicalFaces'),
      edges: sum('edges'), vertices: sum('vertices'),
    },
    logicalFacesReason: logicalResult.reason,
    bodies,
  };
}

// The route body: schema, model id, scope and exactness around partsOf().
export function partsDocument(model, modelId, options) {
  return {
    schema: PARTS_SCHEMA,
    modelId,
    scope: PARTS_SCOPE,
    exactness: { ...PARTS_EXACTNESS },
    ...partsOf(model, options),
  };
}
