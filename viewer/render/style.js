// Style table (spec 7.3). features/display/display.js is the only caller of
// renderer.setStyle(); it composes the display.* store keys with
// composeStyle(). Features write only their own key:
//
//   display.edges    { visible }                           view (E)
//   display.look     { edgeWidthPx, hiddenEdges }          display (Shift+E)
//   display.xray     { on }                                display (T)
//   display.parts    { bodies: { [bodyId]: BodyStyle },    parts-tree
//                      models: { [modelId]: { bodies: { [bodyId]: BodyStyle } } } }
//   display.section  { planes: [{ origin, normal, enabled? }] }        section
//   display.fdm      { overhang: { enabled, alphaDeg,                   fdm
//                        models: { [modelId]: { faces: { [alias]: kind },
//                          bodies: { [bodyId]: { up, printed } } } } } }
//   display.ghost    { modelId, opacity }                  diff-overlay
//   display.debug    { clipPlanes, overhang, bodies }      display (QA handle)
//
// BodyStyle = { visible?, opacity? (0..1), color? ([r, g, b] sRGB 0..1) }.
// Styles are keyed by body id, which carries visibility and color across
// revisions, with optional per-revision overrides keyed by model id plus
// body id (resolveBodyStyle). The composed style keeps the shapes the picker
// reads: style.bodies[bodyId].visible and style.clipPlanes [{ origin, normal }].
import {
  COLORS, EDGE_LOOK, MAX_CLIP_PLANES, OUTLINE_BED, OUTLINE_EXEMPT, OVERHANG,
} from './shaders.js';

// Viewer palette for bodies without an appearance. It is not model data and
// is labelled "viewer color" wherever a body color is named. Every color keeps
// >= 4.5:1 against the edge color on every lit shade (tested).
export const VIEWER_PALETTE = Object.freeze([
  COLORS.face,
  [0.64, 0.75, 0.86],
  [0.85, 0.78, 0.60],
  [0.78, 0.73, 0.87],
  [0.58, 0.80, 0.78],
  [0.78, 0.80, 0.58],
  [0.88, 0.72, 0.77],
  [0.73, 0.75, 0.80],
].map(color => Object.freeze(color)));

export const XRAY_OPACITY = 0.5;
export const DEFAULT_UP = Object.freeze([0, 0, 1]);

export const DEFAULT_STYLE = Object.freeze({
  edges: true,
  edgeWidthPx: EDGE_LOOK.widthPx,
  hiddenEdges: false,
  xray: false,
  bodies: Object.freeze({}),
  models: Object.freeze({}),
  clipPlanes: Object.freeze([]),
  overhang: null,
  ghost: null,
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isVector = value => Array.isArray(value) && value.length === 3 && value.every(finite);

// [r, g, b] sRGB 0..1 from a color array or an appearance record. Accepts
// {red, green, blue} in 0..1 and {color: {red, green, blue}} in 0..255 (the
// two forms Bend models carry); anything else is null.
export function appearanceColor(appearance) {
  if (!appearance || typeof appearance !== 'object') return null;
  if (Array.isArray(appearance)) {
    return appearance.length >= 3 && appearance.slice(0, 3).every(finite)
      ? appearance.slice(0, 3).map(value => clamp(value, 0, 1)) : null;
  }
  const nested = appearance.color && typeof appearance.color === 'object';
  const source = nested ? appearance.color : appearance;
  const channels = [source.red, source.green, source.blue];
  if (!channels.every(finite)) return null;
  const scale = nested || channels.some(value => value > 1) ? 255 : 1;
  return channels.map(value => clamp(value / scale, 0, 1));
}

// Opacity 0..1 of an appearance record, or null when it states none.
export function appearanceOpacity(appearance) {
  if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance)) return null;
  if (finite(appearance.alpha)) return clamp(appearance.alpha, 0, 1);
  if (finite(appearance.opacity)) {
    return clamp(appearance.opacity > 1 ? appearance.opacity / 255 : appearance.opacity, 0, 1);
  }
  return null;
}

function cleanBodyStyle(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const result = {};
  if (typeof entry.visible === 'boolean') result.visible = entry.visible;
  if (finite(entry.opacity)) result.opacity = clamp(entry.opacity, 0, 1);
  const color = entry.color ? appearanceColor(entry.color) : null;
  if (color) result.color = color;
  return Object.keys(result).length ? result : null;
}

function mergeBodies(...maps) {
  const result = {};
  for (const map of maps) {
    for (const [id, entry] of Object.entries(map ?? {})) {
      const clean = cleanBodyStyle(entry);
      if (clean) result[id] = { ...result[id], ...clean };
    }
  }
  return result;
}

function mergeModels(...maps) {
  const result = {};
  for (const map of maps) {
    for (const [modelId, entry] of Object.entries(map ?? {})) {
      const bodies = mergeBodies(result[modelId]?.bodies, entry?.bodies);
      if (Object.keys(bodies).length) result[modelId] = { bodies };
    }
  }
  return result;
}

// Unit normal and origin of a plane record, or null.
export function cleanPlane(plane) {
  if (!plane || plane.enabled === false || !isVector(plane.origin) || !isVector(plane.normal)) {
    return null;
  }
  const length = Math.hypot(...plane.normal);
  if (!(length > 0)) return null;
  return { origin: [...plane.origin], normal: plane.normal.map(value => value / length) };
}

function cleanOverhang(...entries) {
  const active = entries.filter(entry => entry && typeof entry === 'object');
  if (!active.length) return null;
  const enabled = active.some(entry => entry.enabled !== false);
  const alphaDeg = active.map(entry => entry.alphaDeg).filter(finite).at(-1) ?? 45;
  const models = {};
  for (const entry of active) {
    for (const [modelId, model] of Object.entries(entry.models ?? {})) {
      const target = (models[modelId] ??= { faces: {}, bodies: {} });
      Object.assign(target.faces, model?.faces ?? {});
      for (const [bodyId, body] of Object.entries(model?.bodies ?? {})) {
        target.bodies[bodyId] = {
          up: isVector(body?.up) && Math.hypot(...body.up) > 0 ? [...body.up] : [...DEFAULT_UP],
          printed: body?.printed !== false,
        };
      }
    }
  }
  return { enabled, alphaDeg: clamp(alphaDeg, 0, 90), models };
}

// The renderer style table from the display.* store keys.
export function composeStyle(display = {}) {
  const look = display.look ?? {};
  const debug = display.debug ?? {};
  const width = finite(look.edgeWidthPx) ? look.edgeWidthPx : EDGE_LOOK.widthPx;
  const planes = [...(display.section?.planes ?? []), ...(debug.clipPlanes ?? [])]
    .map(cleanPlane).filter(Boolean).slice(0, MAX_CLIP_PLANES);
  const ghost = display.ghost?.modelId ? {
    modelId: display.ghost.modelId,
    opacity: finite(display.ghost.opacity) ? clamp(display.ghost.opacity, 0, 1) : 0.35,
  } : null;
  return {
    edges: display.edges?.visible ?? DEFAULT_STYLE.edges,
    edgeWidthPx: clamp(width, EDGE_LOOK.minWidthPx, EDGE_LOOK.maxWidthPx),
    hiddenEdges: look.hiddenEdges === true,
    xray: display.xray?.on === true,
    bodies: mergeBodies(display.parts?.bodies, debug.bodies),
    models: mergeModels(display.parts?.models, debug.models),
    clipPlanes: planes,
    overhang: cleanOverhang(display.fdm?.overhang, debug.overhang),
    ghost,
  };
}

// Resolved style of one body: color with its source, opacity, visibility.
//   colorSource: 'override' (parts tree), 'appearance' (model data) or
//   'viewer-palette' (VIEWER_PALETTE[index % 8], not model data)
export function resolveBodyStyle(style, modelId, body, index = body?.index ?? 0) {
  const shared = style?.bodies?.[body?.id] ?? {};
  const own = style?.models?.[modelId]?.bodies?.[body?.id] ?? {};
  const override = own.color ?? shared.color ?? null;
  const appearance = appearanceColor(body?.appearance);
  const color = override ?? appearance ?? VIEWER_PALETTE[index % VIEWER_PALETTE.length];
  const colorSource = override ? 'override' : appearance ? 'appearance' : 'viewer-palette';
  let opacity = own.opacity ?? shared.opacity ?? appearanceOpacity(body?.appearance) ?? 1;
  if (style?.xray) opacity = Math.min(opacity, XRAY_OPACITY);
  const visible = (own.visible ?? shared.visible) !== false && opacity > 0;
  return { color: [...color], colorSource, opacity: visible ? opacity : 0, visible };
}

// Overhang up axis and printed flag of a body (defaults +Z, printed).
export function bodyPrint(style, modelId, bodyId) {
  const entry = style?.overhang?.models?.[modelId]?.bodies?.[bodyId];
  return { up: entry?.up ?? [...DEFAULT_UP], printed: entry?.printed !== false };
}

// Opaque, transparent and hidden body indices of a model under a style.
export function bodyPasses(model, style, modelId = model?.id) {
  const opaque = [];
  const transparent = [];
  const hidden = [];
  for (const body of model?.bodies ?? []) {
    const { visible, opacity } = resolveBodyStyle(style, modelId, body);
    if (!visible) hidden.push(body.index);
    else if (opacity < 1) transparent.push(body.index);
    else opaque.push(body.index);
  }
  return { opaque, transparent, hidden };
}

// Merges consecutive bodies' [start, end) ranges into as few ranges as possible.
export function mergedRanges(bodies, indices, rangeOf) {
  const ranges = [];
  for (const index of indices) {
    const [start, end] = rangeOf(bodies[index]);
    if (end <= start) continue;
    const last = ranges.at(-1);
    if (last && last[1] === start) last[1] = end;
    else ranges.push([start, end]);
  }
  return ranges;
}

// Stable key of the parts of a style that change GPU state (body textures,
// face flags), per model.
export function styleKey(style, modelId) {
  return JSON.stringify([
    style?.xray, style?.bodies, style?.models?.[modelId], style?.overhang?.enabled,
    style?.overhang?.models?.[modelId],
  ]);
}

// ---- Per-entity flags (face and edge state bits, see shaders.js) ----

const CURVED = new Set(['cylinder', 'cone']);
const KIND_CODES = Object.freeze({
  ok: OVERHANG.ok, overhang: OVERHANG.overhang, bed: OVERHANG.bed,
  'exempt-small-bore': OVERHANG.exempt, exempt: OVERHANG.exempt,
  'overhang-band': OVERHANG.curved, unsupported: OVERHANG.unsupported,
});

// Global face indices named by an alias: a fragment (B1.F3) or a logical
// face (B1.L3, all its fragments). Unknown aliases give [].
export function facesOfAlias(model, alias) {
  const match = /^B(\d+)\.([FL])(\d+)$/.exec(String(alias));
  if (!match) return [];
  const body = model.bodies[Number(match[1]) - 1];
  if (!body) return [];
  const number = Number(match[3]) - 1;
  if (match[2] === 'L') {
    const group = model.logicalFaces.find(item => item.alias === alias);
    return group ? [...group.fragments] : [];
  }
  const [start, end] = body.faceRange;
  const guess = start + number;
  if (guess < end && model.faceLocal[guess] === number) return [guess];
  for (let face = start; face < end; face++) if (model.faceLocal[face] === number) return [face];
  return [];
}

// Overhang code per global face of a model (Uint8Array) from the style, or
// null when overhang shading is off or the model has no flags. A planar
// 'overhang' is exact (whole face tinted); on a cylinder or cone, or with
// bandsDeg, it becomes 'curved' (tinted where the exact per-vertex normal,
// interpolated over the display triangles, exceeds the threshold).
export function overhangCodes(model, style, modelId = model?.id) {
  const overhang = style?.overhang;
  const flags = overhang?.enabled ? overhang.models?.[modelId]?.faces : null;
  if (!flags || !model) return null;
  const codes = new Uint8Array(model.counts.faces);
  for (const [alias, entry] of Object.entries(flags)) {
    const kind = typeof entry === 'string' ? entry : entry?.kind;
    const code = KIND_CODES[kind] ?? OVERHANG.none;
    for (const face of facesOfAlias(model, alias)) {
      const curved = CURVED.has(model.faces[face]?.surfaceType) || !!entry?.bandsDeg;
      codes[face] = code === OVERHANG.overhang && curved ? OVERHANG.curved : code;
    }
  }
  return codes;
}

// Adds the look bits to highlight states (in place): edge class (bits 2-4),
// overhang code per face (bits 2-4), bed / exempt outlines on the boundary
// edges of flagged faces (bits 5, 6). Returns the number of accented edges
// (hover, selection or outline), which the renderer's accent pass needs.
export function composeLookStates(model, states, codes = null) {
  const { faces, edges } = states;
  const classes = model.arrays.edgeClass;
  for (let edge = 0; edge < edges.length; edge++) edges[edge] |= (classes[edge] & 7) << 2;
  if (codes) {
    const { faceEdgeOffsets, faceEdges } = model.arrays;
    for (let face = 0; face < faces.length; face++) {
      const code = codes[face];
      if (!code) continue;
      faces[face] |= code << 2;
      const outline = code === OVERHANG.bed ? OUTLINE_BED << 5
        : code === OVERHANG.exempt ? OUTLINE_EXEMPT << 5 : 0;
      if (!outline) continue;
      for (let item = faceEdgeOffsets[face]; item < faceEdgeOffsets[face + 1]; item++) {
        edges[faceEdges[item]] |= outline;
      }
    }
  }
  let accented = 0;
  for (let edge = 0; edge < edges.length; edge++) if (edges[edge] & 0x63) accented++;
  return accented;
}
