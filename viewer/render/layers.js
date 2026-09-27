// Ordered GL layers and the pure helpers behind frame.drawLines() and
// frame.drawBodies() (render-look).
//
//   renderer.addLayer({ id, order, draw(frame) })
//   frame = { gl, pane, panes, ratio, viewProjection, origin, camera, model,
//             matrixFor(origin), drawLines(options), drawBodies(options) }
//
// frame.drawLines({ positions, color, widthPx, depthBias, depthTest, strip,
//   closed, clip }) draws fat screen-space lines (the edge program):
//   positions  world mm, [[x, y, z], …] or a flat array; pairs are segments,
//              or a polyline with `strip: true` (`closed` joins the ends)
//   color      [r, g, b] or [r, g, b, a], sRGB 0..1 (default edge color)
//   widthPx    CSS px (default 1.5), depthBias CSS px of view depth toward
//              the eye (default 1), depthTest (default true), clip: apply the
//              style's clip planes (default false)
//
// frame.drawBodies({ modelId, bodies, color, alpha, lit, clip, cull,
//   colorMask, depthMask, depthTest, depthFunc, stencil, polygonOffset })
//   draws the triangles of a model (default: the pane's) with the given GL
//   state and restores the defaults afterwards:
//   bodies     body ids (default: every visible body of the style)
//   color      flat sRGB color instead of the body colors; alpha multiplies
//   cull       'none' (default), 'back' or 'front'
//   colorMask  [r, g, b, a] booleans; depthMask boolean (default false)
//   depthFunc  'less', 'lequal' (default), 'equal', 'greater', 'gequal',
//              'always', 'never', 'notequal'
//   stencil    { func, ref, mask, fail, zfail, zpass, writeMask }; func and
//              ops by name ('always', 'equal', 'keep', 'replace', 'invert',
//              'incr-wrap', 'decr-wrap', …)
// Stencil bits 0x80 and 0x40 are used by the renderer inside a pane (soft
// edge dedupe, transparent front mark) and are zero whenever a layer runs.
import { COLORS, EDGE_LOOK, NO_ENTITY } from './shaders.js';

export function createLayers() {
  const layers = [];
  return {
    add(layer) {
      if (layers.some(item => item.id === layer.id)) throw new Error(`Layer ${layer.id} exists`);
      layers.push({ order: 50, ...layer });
      layers.sort((a, b) => a.order - b.order);
      return () => {
        const index = layers.findIndex(item => item.id === layer.id);
        if (index >= 0) layers.splice(index, 1);
      };
    },
    list: () => [...layers],
  };
}

const finite = value => typeof value === 'number' && Number.isFinite(value);

// Flat float64 xyz list of world points.
function flatPoints(positions) {
  if (!positions?.length) return [];
  if (Array.isArray(positions[0]) || ArrayBuffer.isView(positions[0])) {
    return positions.flatMap(point => [point[0], point[1], point[2]]);
  }
  return Array.from(positions);
}

// Line instances: 7 words per segment, [ax, ay, az, bx, by, bz] float32
// (relative to the draw origin) and the global edge id as uint32 (NO_ENTITY
// for layer lines). One layout for model edges and layer lines.
export const SEGMENT_WORDS = 7;
export const SEGMENT_BYTES = SEGMENT_WORDS * 4;

// Instances of every segment of a draw model (positions are already relative
// to the model center).
export function packModelSegments(model) {
  const { edgePoints, edgeSegments, edgeOfSegment } = model.arrays;
  const count = model.counts.segments;
  const buffer = new ArrayBuffer(count * SEGMENT_BYTES);
  const floats = new Float32Array(buffer);
  const words = new Uint32Array(buffer);
  for (let segment = 0; segment < count; segment++) {
    const a = 3 * edgeSegments[2 * segment];
    const b = 3 * edgeSegments[2 * segment + 1];
    const at = segment * SEGMENT_WORDS;
    floats[at] = edgePoints[a];
    floats[at + 1] = edgePoints[a + 1];
    floats[at + 2] = edgePoints[a + 2];
    floats[at + 3] = edgePoints[b];
    floats[at + 4] = edgePoints[b + 1];
    floats[at + 5] = edgePoints[b + 2];
    words[at + 6] = edgeOfSegment[segment];
  }
  return { buffer, count };
}

// Instances of layer lines from world points: segment pairs, or a polyline
// with `strip` (`closed` joins the ends). Float64 subtraction of `origin`,
// then float32.
export function segmentsFrom(positions, options = {}) {
  const { origin = [0, 0, 0], strip = false, closed = false } = options;
  const flat = flatPoints(positions);
  if (flat.length % 3) throw new Error('drawLines positions need x, y, z per point');
  if (!flat.every(finite)) throw new Error('drawLines positions must be finite numbers');
  const count = flat.length / 3;
  const pairs = [];
  if (strip) {
    for (let index = 1; index < count; index++) pairs.push([index - 1, index]);
    if (closed && count > 2) pairs.push([count - 1, 0]);
  } else {
    if (count % 2) throw new Error('drawLines without strip needs point pairs');
    for (let index = 0; index < count; index += 2) pairs.push([index, index + 1]);
  }
  const buffer = new ArrayBuffer(pairs.length * SEGMENT_BYTES);
  const floats = new Float32Array(buffer);
  const words = new Uint32Array(buffer);
  pairs.forEach(([a, b], segment) => {
    const at = segment * SEGMENT_WORDS;
    for (let axis = 0; axis < 3; axis++) {
      floats[at + axis] = flat[3 * a + axis] - origin[axis];
      floats[at + 3 + axis] = flat[3 * b + axis] - origin[axis];
    }
    words[at + 6] = NO_ENTITY;
  });
  return { buffer, count: pairs.length };
}

// Normalized drawLines options.
export function lineOptions(options = {}) {
  const color = options.color ?? COLORS.edge;
  if (!Array.isArray(color) || color.length < 3 || !color.every(finite)) {
    throw new Error('drawLines color must be [r, g, b] or [r, g, b, a] in 0..1');
  }
  const width = finite(options.widthPx) ? options.widthPx : EDGE_LOOK.widthPx;
  return {
    color: [color[0], color[1], color[2], color.length > 3 ? color[3] : 1],
    widthPx: Math.min(16, Math.max(0.5, width)),
    depthBias: finite(options.depthBias) ? options.depthBias : EDGE_LOOK.biasPx,
    depthTest: options.depthTest !== false,
    clip: options.clip === true,
  };
}

export const DEPTH_FUNCS = Object.freeze({
  never: 'NEVER', less: 'LESS', equal: 'EQUAL', lequal: 'LEQUAL', greater: 'GREATER',
  notequal: 'NOTEQUAL', gequal: 'GEQUAL', always: 'ALWAYS',
});
export const STENCIL_OPS = Object.freeze({
  keep: 'KEEP', zero: 'ZERO', replace: 'REPLACE', incr: 'INCR', decr: 'DECR',
  invert: 'INVERT', 'incr-wrap': 'INCR_WRAP', 'decr-wrap': 'DECR_WRAP',
});

const named = (table, value, fallback, what) => {
  const key = String(value ?? fallback).toLowerCase();
  if (!table[key]) throw new Error(`Unknown ${what} ${value}`);
  return table[key];
};

// Normalized drawBodies options (GL enum names, resolved by the renderer).
export function bodyOptions(options = {}) {
  const cull = options.cull ?? 'none';
  if (!['none', 'back', 'front'].includes(cull)) throw new Error(`Unknown cull ${cull}`);
  const mask = options.colorMask ?? [true, true, true, true];
  if (!Array.isArray(mask) || mask.length !== 4) throw new Error('colorMask needs 4 booleans');
  const color = options.color ?? null;
  if (color && (!Array.isArray(color) || color.length < 3 || !color.every(finite))) {
    throw new Error('drawBodies color must be [r, g, b] in 0..1');
  }
  const stencil = options.stencil ? {
    func: named(DEPTH_FUNCS, options.stencil.func, 'always', 'stencil func'),
    ref: finite(options.stencil.ref) ? options.stencil.ref : 0,
    mask: finite(options.stencil.mask) ? options.stencil.mask : 0xff,
    fail: named(STENCIL_OPS, options.stencil.fail, 'keep', 'stencil op'),
    zfail: named(STENCIL_OPS, options.stencil.zfail, 'keep', 'stencil op'),
    zpass: named(STENCIL_OPS, options.stencil.zpass, 'keep', 'stencil op'),
    writeMask: finite(options.stencil.writeMask) ? options.stencil.writeMask : 0xff,
  } : null;
  return {
    modelId: options.modelId ?? null,
    bodies: options.bodies ? [options.bodies].flat() : null,
    color: color ? color.slice(0, 3) : null,
    alpha: finite(options.alpha) ? Math.min(1, Math.max(0, options.alpha)) : 1,
    lit: options.lit !== false,
    clip: options.clip !== false,
    cull,
    colorMask: mask.map(Boolean),
    depthMask: options.depthMask === true,
    depthTest: options.depthTest !== false,
    depthFunc: named(DEPTH_FUNCS, options.depthFunc, 'lequal', 'depth func'),
    stencil,
    polygonOffset: Array.isArray(options.polygonOffset) ? options.polygonOffset : [1, 1],
  };
}
