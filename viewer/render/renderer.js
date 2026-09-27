// WebGL2 renderer behind a narrow interface (packages render-transport and
// render-look):
//
//   init()                     start WebGL2 (throws RenderCapabilityError with
//                              the user-facing message when it is missing)
//   available(), unavailableReason()
//   loadModel(id, { signal })  fetch + decode + upload the draw payload
//   prepareScene(scene)        legacy JSON path: draw the JSON adapter now and
//                              fetch the draw payload in the background
//   model(id), bounds(id)      draw model and its display bounds (no JSON)
//   setStyle(style)            only features/display/display.js calls this
//                              (style table: render/style.js)
//   style(), styleVersion()    current style and its change counter
//   look(id)                   display facts of a model for the
//                              legend (tolerance, edge classes, body colors)
//   setHighlights({ hover, hoverPane, selection: [references] })
//   addLayer({ id, order, draw(frame) })  frame.drawLines / frame.drawBodies
//   draw()                     one frame (called from the scheduled frame)
//   project(point, pane)       same matrix math as the shader
//   pick(x, y, mode)           typed-array picker (render/picking.js)
//   pickDetail(x, y, mode)     { reference, point, exactness }: display hit point
//   entityPoints(reference)    display points of an entity in world mm (edge
//                              polyline, vertex, face triangle corners, body
//                              B-rep vertices) from the draw model
//   alias(reference)           geometry alias (B1.F3) from the draw model
//   summary(id)                model overview from the draw model (bodies,
//                              counts, display bounds, warnings, diagnostic)
//   onContextLost(fn), onContextRestored(fn)
//   stats(), highlightState(modelId)   debug counters and highlight bytes
//
// Rendering, picking and hover use the draw model of the scene cache: the
// binary payload, or the JSON adapter until the payload is there. Highlight
// is a per-entity state texture read in the shader; a face expands to its
// logical face, any number of entities can be selected, and a hover change
// is drawn at once (same frame as the pick). After `webglcontextlost` the
// typed arrays stay in the cache; `webglcontextrestored` recompiles the
// programs and re-uploads on the next frame.
//
// Frame (render-look), per pane:
//   1. opaque bodies: body colors (appearance, override or viewer palette),
//      rank depth offset, clip planes, overhang tint
//   2. their edges: base pass (sharp, unresolved; opaque), soft pass (tangent
//      45 %, seam and subdivision dimmed with Shift+E; stencil bit 0x80 so a
//      pixel blends once), accent pass (hover, selection, bed and exempt
//      outlines; wider, drawn whatever the class)
//   3. transparent bodies (opacity < 1, x-ray) back to front by bounds center,
//      back faces then front faces, depthMask(false); then their depth with
//      stencil bit 0x40 on the front surface
//   4. their edges: faint hidden pass (depth GREATER inside bit 0x40), then
//      base, soft, accent
//   5. highlighted B-rep points, then the layers
// Per-model look resources (segment instances, face-to-body texture, body
// style texture) hang on the cache entry's gpu object and are released with
// it; they are counted as look* in stats().gpu.
import {
  basis, depthPerPixel, eyeDistance, unionBox, viewProjection,
} from './camera.js';
import { createCounters, createGl, releaseModel, setupGl, uploadModel, writeStates } from './gl.js';
import { edgeWorldPoints, worldPoint } from './draw-decode.js';
import {
  bodyOptions, createLayers, lineOptions, packModelSegments, SEGMENT_BYTES, segmentsFrom,
} from './layers.js';
import { cameraFor } from './picking.js';
import {
  ATTRIBUTES, COLORS, EDGE_CLASS, EDGE_LOOK, LINE_ATTRIBUTES, LINE_FRAGMENT_SHADER,
  LINE_UNIFORMS, LINE_VERTEX_SHADER, MAX_CLIP_PLANES, NO_ENTITY, OVERHANG, PASS, RANK_PX,
  srgbToLinear, STATE_HOVER, STATE_SELECTED, STATE_TEXTURE_WIDTH,
} from './shaders.js';
import {
  bodyPasses, bodyPrint, composeLookStates, DEFAULT_STYLE, mergedRanges, overhangCodes,
  resolveBodyStyle, styleKey,
} from './style.js';
import { sameReference } from '../core/scene-records.js';
import {
  applyPoint, isIdentity, localDirection, localPlanes, placeBox, placedMatrix,
} from './placement.js';

const SEAM = 2;
const SUBDIVISION = 3;
const INTERRUPTED_TITLE = '3D display was interrupted';

// Global index of an entity with local index `local` in `range`.
function globalIndex(locals, range, local) {
  const guess = range[0] + local;
  if (guess < range[1] && locals[guess] === local) return guess;
  for (let index = range[0]; index < range[1]; index++) if (locals[index] === local) return index;
  return -1;
}

// Highlight bytes of one model: bit 0 hover, bit 1 selected. Faces expand
// to their logical face; the hover also outlines the logical face (its
// boundary edges, not seams or subdivision edges). Faces without display
// triangles light their boundary edges instead.
export function highlightStates(model, { hover = null, selection = [] } = {}, modelId = model.id) {
  const faces = new Uint8Array(model.counts.faces);
  const edges = new Uint8Array(model.counts.edges);
  const points = new Map();
  const { faceEdgeOffsets, faceEdges, edgeClass } = model.arrays;
  const hasTriangles = face => model.faces[face].indexRange[1] > model.faces[face].indexRange[0];
  const markBoundary = (face, bit, outline) => {
    for (let item = faceEdgeOffsets[face]; item < faceEdgeOffsets[face + 1]; item++) {
      const edge = faceEdges[item];
      if (outline && (edgeClass[edge] === SEAM || edgeClass[edge] === SUBDIVISION)) continue;
      edges[edge] |= bit;
    }
  };
  const mark = (reference, bit) => {
    if (!reference || reference.modelId !== modelId) return;
    const bodyIndex = model.bodyIndexById.get(reference.bodyId);
    if (bodyIndex === undefined) return;
    const body = model.bodies[bodyIndex];
    const index = reference.entityIndex;
    if (reference.entityType === 'body') {
      for (let face = body.faceRange[0]; face < body.faceRange[1]; face++) {
        faces[face] |= bit;
        if (!hasTriangles(face)) markBoundary(face, bit, false);
      }
    } else if (reference.entityType === 'face') {
      const face = globalIndex(model.faceLocal, body.faceRange, index);
      if (face < 0) return;
      const logical = model.logicalOf[face];
      const start = model.logicalOffsets[logical];
      const end = model.logicalOffsets[logical + 1];
      for (let item = start; item < end; item++) {
        const fragment = model.logicalFragments[item];
        faces[fragment] |= bit;
        if (!hasTriangles(fragment)) markBoundary(fragment, bit, false);
        else if (bit === STATE_HOVER) markBoundary(fragment, bit, true);
      }
    } else if (reference.entityType === 'edge') {
      const edge = globalIndex(model.edgeLocal, body.edgeRange, index);
      if (edge >= 0) edges[edge] |= bit;
    } else if (reference.entityType === 'vertex') {
      const point = globalIndex(model.arrays.vertexIndex, body.pointRange, index);
      if (point >= 0) points.set(point, (points.get(point) ?? 0) | bit);
    }
  };
  mark(hover, STATE_HOVER);
  for (const reference of selection) mark(reference, STATE_SELECTED);
  return { faces, edges, points: [...points] };
}

// Display points (world mm) of a reference in a draw model.
export function entityPoints(model, reference) {
  const bodyIndex = model?.bodyIndexById.get(reference?.bodyId);
  if (bodyIndex === undefined) return [];
  const body = model.bodies[bodyIndex];
  const { positions, indices, vertexPoints, faceEdgeOffsets, faceEdges } = model.arrays;
  const bodyPoints = () => {
    const points = [];
    for (let index = body.pointRange[0]; index < body.pointRange[1]; index++) {
      points.push(worldPoint(model, vertexPoints, index));
    }
    return points;
  };
  if (reference.entityType === 'body') return bodyPoints();
  if (reference.entityType === 'vertex') {
    const point = globalIndex(model.arrays.vertexIndex, body.pointRange, reference.entityIndex);
    return point < 0 ? [] : [worldPoint(model, vertexPoints, point)];
  }
  if (reference.entityType === 'edge') {
    const edge = globalIndex(model.edgeLocal, body.edgeRange, reference.entityIndex);
    return edge < 0 ? [] : edgeWorldPoints(model, edge);
  }
  const face = globalIndex(model.faceLocal, body.faceRange, reference.entityIndex);
  if (face < 0) return [];
  const [start, end] = model.faces[face].indexRange;
  if (end > start) {
    const seen = new Set();
    const points = [];
    for (let item = start; item < end; item++) {
      const vertex = indices[item];
      if (seen.has(vertex)) continue;
      seen.add(vertex);
      points.push(worldPoint(model, positions, vertex));
    }
    return points;
  }
  const points = [];
  for (let item = faceEdgeOffsets[face]; item < faceEdgeOffsets[face + 1]; item++) {
    points.push(...edgeWorldPoints(model, faceEdges[item]));
  }
  return points;
}

// Alias of a reference (same rule as core/scene-records.js geometryAlias).
export function entityAlias(model, reference) {
  const bodyIndex = model?.bodyIndexById.get(reference?.bodyId);
  if (bodyIndex === undefined) return null;
  const letters = { face: 'F', edge: 'E', vertex: 'V' };
  const entity = reference.entityType === 'body' ? ''
    : `.${letters[reference.entityType]}${reference.entityIndex + 1}`;
  return `B${bodyIndex + 1}${entity}`;
}

// Model overview without the JSON scene. Bounds are display bounds
// (edge polylines and vertices, tolerance toleranceMm).
export function modelSummary(model, id = model?.id) {
  if (!model) return null;
  const count = range => range[1] - range[0];
  return {
    id, source: model.source, bounds: model.bounds, boundsExactness: 'display-approximation',
    toleranceMm: model.toleranceMm ?? null,
    bodies: model.bodies.map(body => ({
      id: body.id, name: body.name ?? body.id, appearance: body.appearance ?? null,
      faces: count(body.faceRange), edges: count(body.edgeRange), points: count(body.pointRange),
    })),
    faces: model.counts.faces, logicalFaces: model.logicalFaces.length,
    edges: model.counts.edges, points: model.counts.points,
    displayWarnings: model.faces.flatMap(face => (face.displayWarning
      ? [{ body: face.body, index: face.index, warning: face.displayWarning }] : [])),
    notes: model.notes ?? [], diagnostic: model.diagnostic ?? null,
  };
}

const indexOf = (values, predicate) => {
  const list = [];
  values.forEach((value, index) => {
    if (predicate(value)) list.push(index);
  });
  return list;
};

// Stencil bits the renderer uses inside a pane (zero again when a layer runs).
export const STENCIL = Object.freeze({ dedupe: 0x80, front: 0x40 });
const TIMING_SAMPLES = 240;
// The face program lights and mixes in linear space (shaders.js).
const linear = rgb => rgb.map(srgbToLinear);
const LINEAR = Object.freeze({
  face: linear(COLORS.face), hover: linear(COLORS.hover), select: linear(COLORS.select),
  overhang: linear(COLORS.overhang),
});
const CURVED = new Set(['cylinder', 'cone']);

// Display facts of a draw model (legend, debug): cached per model object.
const factsCache = new WeakMap();
export function modelFacts(model) {
  if (!model) return null;
  if (factsCache.has(model)) return factsCache.get(model);
  const classes = { sharp: 0, tangent: 0, seam: 0, subdivision: 0, unresolved: 0 };
  const names = Object.keys(EDGE_CLASS);
  for (const code of model.arrays.edgeClass) classes[names[code] ?? 'unresolved']++;
  let smoothFaces = 0;
  let curvedFaces = 0;
  for (const face of model.faces) {
    if (!CURVED.has(face.surfaceType)) continue;
    curvedFaces++;
    if (face.normalSource === 'exact') smoothFaces++;
  }
  const facts = {
    source: model.source, toleranceMm: model.toleranceMm ?? null, edgeClasses: classes,
    curvedFaces, smoothFaces, bodies: model.bodies.length,
  };
  factsCache.set(model, facts);
  return facts;
}

// Clip-plane uniforms relative to a model center: [nx, ny, nz, offset] each.
export function clipUniforms(planes = [], center = [0, 0, 0]) {
  const data = new Float32Array(4 * MAX_CLIP_PLANES);
  const list = planes.slice(0, MAX_CLIP_PLANES);
  list.forEach((plane, index) => {
    const offset = plane.normal[0] * (plane.origin[0] - center[0])
      + plane.normal[1] * (plane.origin[1] - center[1])
      + plane.normal[2] * (plane.origin[2] - center[2]);
    data.set([...plane.normal, offset], 4 * index);
  });
  return { count: list.length, data };
}

// View uniforms of a camera for a model-relative draw.
export function viewUniforms(camera, pane, bounds, center = [0, 0, 0]) {
  const { right, up, toward } = basis(camera);
  const distance = eyeDistance(camera);
  const eye = [0, 1, 2].map(axis => camera.target[axis] + toward[axis] * distance
    - center[axis]);
  return {
    toward, eye, eyeDistance: distance,
    perspective: camera.projection === 'perspective',
    mmPerPx: depthPerPixel(camera, pane, bounds),
    normalMatrix: new Float32Array([right[0], up[0], toward[0], right[1], up[1], toward[1],
      right[2], up[2], toward[2]]),
  };
}

// View uniforms of a placed member in its local frame: the eye, the view
// direction and the normal basis rotated by Rᵀ (identity: unchanged).
export function localView(view, matrix) {
  if (isIdentity(matrix)) return view;
  const n = view.normalMatrix;
  const right = localDirection(matrix, [n[0], n[3], n[6]]);
  const up = localDirection(matrix, [n[1], n[4], n[7]]);
  const toward = localDirection(matrix, [n[2], n[5], n[8]]);
  return {
    ...view,
    toward: localDirection(matrix, view.toward),
    eye: localDirection(matrix, view.eye),
    normalMatrix: new Float32Array([right[0], up[0], toward[0], right[1], up[1], toward[1],
      right[2], up[2], toward[2]]),
  };
}

// The members a pane draws: its workspace members (an assembly, or a placed
// model; none when all are hidden), else its one model at identity.
export const paneMembers = pane => (pane.members ? pane.members
  : [{ instance: null, key: null, modelId: pane.modelId, matrix: null }]);

// Body indices back to front (farthest bounds center first) along `toward`.
export function backToFront(centers, indices, toward) {
  const depth = index => centers[3 * index] * toward[0] + centers[3 * index + 1] * toward[1]
    + centers[3 * index + 2] * toward[2];
  return [...indices].sort((a, b) => depth(a) - depth(b) || a - b);
}

// Bounds centers (model-relative) of every body from its display vertices.
export function bodyCenters(model) {
  const centers = new Float64Array(3 * model.bodies.length);
  const { positions } = model.arrays;
  model.bodies.forEach((body, index) => {
    const [start, end] = body.vertexRange;
    if (end <= start) return;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let vertex = start; vertex < end; vertex++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = positions[3 * vertex + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
    for (let axis = 0; axis < 3; axis++) centers[3 * index + axis] = (min[axis] + max[axis]) / 2;
  });
  return centers;
}

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

function compileProgram(gl, vertexSource, fragmentSource) {
  const failed = detail => new Error('The 3D renderer could not start'
    + (detail ? `: ${detail}` : '') + '.');
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw failed(gl.getShaderInfoLog?.(shader));
    }
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw failed(gl.getProgramInfoLog?.(program));
  }
  return program;
}

export function createRenderer({ env, canvas, state, cache, panes, picker }) {
  let context = null;
  let lines = null;
  let unavailable = null;
  let lost = false;
  let style = { ...DEFAULT_STYLE };
  let styleVersion = 0;
  const highlight = { hover: null, hoverPane: null, selection: [] };
  const layers = createLayers();
  const lostListeners = new Set();
  const restoredListeners = new Set();
  const counters = Object.assign(createCounters(), {
    lookPrograms: 0, lookBuffersCreated: 0, lookBuffersDeleted: 0, lookTexturesCreated: 0,
    lookTexturesDeleted: 0, lookVertexArrays: 0, lookBytes: 0,
  });
  const frames = { draws: 0, hoverDraws: 0, lastDrawAt: 0, lastHoverDrawAt: 0, lastHover: null };
  const timings = [];
  const warnings = [];

  cache.configure({ fetch: (...args) => env.fetch(...args) });
  cache.pinSource('displayed', () => [state.after, state.compare ? state.before : null]);
  cache.pinSource('highlight', () => [highlight.hover?.modelId,
    ...highlight.selection.map(reference => reference.modelId)]);
  cache.pinSource('ghost', () => [style.ghost?.modelId]);
  // Revisions referenced by the open review's annotations stay cached.
  cache.pinSource('annotations', () => (state.annotations ?? []).flatMap(annotation => [
    annotation.target?.modelId, annotation.view?.before, annotation.view?.after,
  ]));
  cache.onEvict(item => {
    if (item.gpu && context && !lost) releaseGpu(item.gpu);
  });
  cache.onModel(() => requestDraw());

  let drawRequested = false;
  function requestDraw() {
    if (!context || drawRequested) return;
    drawRequested = true;
    env.requestAnimationFrame(() => {
      drawRequested = false;
      api.draw();
    });
  }

  // ---- GPU resources ----

  // Line program and shared instance VAO of a (new) context;
  // sampler units of the face program.
  function setupLines() {
    const { gl: g, program: faceProgram, uniforms: faceUniforms } = context;
    const program = compileProgram(g, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
    counters.lookPrograms++;
    const uniforms = Object.fromEntries(LINE_UNIFORMS.map(name => [
      name, g.getUniformLocation(program, name),
    ]));
    g.useProgram(program);
    g.uniform1i(uniforms.states, 0);
    const vao = g.createVertexArray();
    counters.lookVertexArrays++;
    g.bindVertexArray(vao);
    for (const location of Object.values(LINE_ATTRIBUTES)) {
      g.enableVertexAttribArray(location);
      g.vertexAttribDivisor(location, 1);
    }
    g.bindVertexArray(null);
    g.useProgram(faceProgram);
    g.uniform1i(faceUniforms.states, 0);
    g.uniform1i(faceUniforms.entityBody, 1);
    g.uniform1i(faceUniforms.bodyStyles, 2);
    // The layer buffer is created on the first frame.drawLines().
    lines = { program, uniforms, vao, layerBuffer: null };
  }

  function lookTexture(internalFormat, format, type, data, width, height) {
    const { gl: g } = context;
    const handle = g.createTexture();
    counters.lookTexturesCreated++;
    g.bindTexture(g.TEXTURE_2D, handle);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texImage2D(g.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
    return handle;
  }

  // Look resources of an uploaded model: segment instances, face -> body
  // (R16UI) and body styles (RGBA32F, two texels per body).
  function createLook(model) {
    const { gl: g } = context;
    const segments = packModelSegments(model);
    const buffer = g.createBuffer();
    counters.lookBuffersCreated++;
    g.bindBuffer(g.ARRAY_BUFFER, buffer);
    g.bufferData(g.ARRAY_BUFFER, segments.buffer, g.STATIC_DRAW);
    const width = STATE_TEXTURE_WIDTH;
    const faceRows = Math.max(1, Math.ceil(model.counts.faces / width));
    const faceBody = new Uint16Array(width * faceRows);
    faceBody.set(model.faceBody);
    const entityBody = lookTexture(g.R16UI, g.RED_INTEGER, g.UNSIGNED_SHORT, faceBody, width,
      faceRows);
    const styleRows = Math.max(1, Math.ceil(2 * model.bodies.length / width));
    const styleData = new Float32Array(4 * width * styleRows);
    const bodyStyles = lookTexture(g.RGBA32F, g.RGBA, g.FLOAT, styleData, width, styleRows);
    const bytes = segments.buffer.byteLength + faceBody.byteLength + styleData.byteLength;
    counters.lookBytes += bytes;
    return {
      segments: buffer, segmentCount: segments.count, entityBody, bodyStyles, styleData,
      styleRows, styleKey: null, passes: null, centers: null, accented: 0, bytes,
    };
  }

  function releaseLook(look) {
    if (!look) return;
    const { gl: g } = context;
    g.deleteBuffer(look.segments);
    counters.lookBuffersDeleted++;
    for (const texture of [look.entityBody, look.bodyStyles]) {
      g.deleteTexture(texture);
      counters.lookTexturesDeleted++;
    }
    counters.lookBytes -= look.bytes;
  }

  function releaseGpu(gpu) {
    releaseModel(context, gpu);
    releaseLook(gpu.look);
  }

  function applyStates(id, gpu) {
    const states = highlightStates(gpu.model, highlight, id);
    const codes = overhangCodes(gpu.model, style, id);
    gpu.look.accented = composeLookStates(gpu.model, states, codes);
    writeStates(context, gpu.faceStates, states.faces);
    writeStates(context, gpu.edgeStates, states.edges);
    gpu.highlightPoints = states.points;
  }

  // GPU buffers of the model currently in the cache for `id` (uploads the
  // draw model, or the JSON adapter, on first use and after a swap).
  function ensureGpu(id) {
    if (!context || lost || !id) return null;
    const model = cache.model(id);
    if (!model) return null;
    let item = cache.entry(id);
    if (!item) {
      cache.touch(id);
      item = cache.entry(id);
    }
    if (item.gpu?.model === model) return item.gpu;
    if (item.gpu) releaseGpu(item.gpu);
    const gpu = uploadModel(context, model);
    gpu.model = model;
    gpu.look = createLook(model);
    cache.setGpu(id, gpu, gpu.bytes + gpu.look.bytes);
    applyStates(id, gpu);
    return gpu;
  }

  function refreshStates(ids) {
    if (!context || lost) return;
    for (const id of ids) {
      const item = cache.entry(id);
      if (item?.gpu) applyStates(id, item.gpu);
    }
  }

  const highlightIds = () => [highlight.hover?.modelId,
    ...highlight.selection.map(reference => reference.modelId)].filter(Boolean);

  // Body passes and draw ranges of a model under the current style (cached
  // per style version); body style texels re-uploaded when their key changes.
  function lookFor(gpu, modelId) {
    const { look, model } = gpu;
    if (look.passes?.version !== styleVersion || look.passes.modelId !== modelId) {
      const passes = bodyPasses(model, style, modelId);
      const triangles = body => [body.indexRange[0] / 3, body.indexRange[1] / 3];
      const segments = body => body.segmentRange;
      look.passes = {
        version: styleVersion, modelId, ...passes,
        opaqueTriangles: mergedRanges(model.bodies, passes.opaque, triangles),
        opaqueSegments: mergedRanges(model.bodies, passes.opaque, segments),
        transparentTriangles: mergedRanges(model.bodies, passes.transparent, triangles),
        transparentSegments: mergedRanges(model.bodies, passes.transparent, segments),
        hiddenMask: passes.hidden.length ? new Uint8Array(model.bodies.length) : null,
      };
      for (const index of passes.hidden) look.passes.hiddenMask[index] = 1;
    }
    const key = styleKey(style, modelId);
    if (look.styleKey !== key) {
      const data = look.styleData;
      data.fill(0);
      model.bodies.forEach((body, index) => {
        const resolved = resolveBodyStyle(style, modelId, body, index);
        const print = bodyPrint(style, modelId, body.id);
        data.set([...linear(resolved.color), resolved.opacity], 8 * index);
        data.set([...print.up, print.printed ? 1 : 0], 8 * index + 4);
      });
      const { gl: g } = context;
      g.bindTexture(g.TEXTURE_2D, look.bodyStyles);
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, STATE_TEXTURE_WIDTH, look.styleRows, g.RGBA,
        g.FLOAT, data);
      look.styleKey = key;
    }
    return look;
  }

  // ---- Drawing ----

  function drawRanges(g, mode, ranges, perItem) {
    for (const [start, end] of ranges) {
      if (end > start) g.drawElements(mode, (end - start) * perItem, g.UNSIGNED_INT,
        start * perItem * 4);
    }
  }

  function pointSegments(g, buffer, start) {
    const offset = start * SEGMENT_BYTES;
    g.bindBuffer(g.ARRAY_BUFFER, buffer);
    g.vertexAttribPointer(LINE_ATTRIBUTES.pointA, 3, g.FLOAT, false, SEGMENT_BYTES, offset);
    g.vertexAttribPointer(LINE_ATTRIBUTES.pointB, 3, g.FLOAT, false, SEGMENT_BYTES,
      offset + 12);
    g.vertexAttribIPointer(LINE_ATTRIBUTES.edge, 1, g.UNSIGNED_INT, SEGMENT_BYTES, offset + 24);
  }

  function drawSegments(g, buffer, ranges) {
    for (const [start, end] of ranges) {
      if (end <= start) continue;
      pointSegments(g, buffer, start);
      g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, end - start);
    }
  }

  // Default GL state between passes and layers.
  function resetState(g) {
    g.enable(g.DEPTH_TEST);
    g.depthFunc(g.LEQUAL);
    g.depthMask(true);
    g.colorMask(true, true, true, true);
    g.disable(g.BLEND);
    g.disable(g.CULL_FACE);
    g.disable(g.STENCIL_TEST);
    g.stencilMask(0xff);
    g.disable(g.POLYGON_OFFSET_FILL);
  }

  function blend(g) {
    g.enable(g.BLEND);
    g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
  }

  function clearStencil(g, bits) {
    g.stencilMask(bits);
    g.clear(g.STENCIL_BUFFER_BIT);
    g.stencilMask(0xff);
  }

  function setViewUniforms(g, uniforms, view, clip) {
    g.uniform3fv(uniforms.toward, view.toward);
    g.uniform3fv(uniforms.eye, view.eye);
    g.uniform1i(uniforms.perspective, view.perspective ? 1 : 0);
    g.uniform1f(uniforms.eyeDistance, view.eyeDistance);
    g.uniform1f(uniforms.mmPerPx, view.mmPerPx);
    g.uniform1i(uniforms.clipCount, clip.count);
    g.uniform4fv(uniforms.clipPlanes, clip.data);
  }

  // Face program with the pane's matrix, view, clip planes and textures.
  function useFaces(pass, gpu, { lit = true, color = null, alpha = 1, clip = pass.clip } = {}) {
    const { gl: g, program, uniforms } = context;
    g.useProgram(program);
    g.uniformMatrix4fv(uniforms.viewProjection, false, pass.matrix32);
    g.uniformMatrix3fv(uniforms.normalMatrix, false, pass.view.normalMatrix);
    setViewUniforms(g, uniforms, pass.view, clip);
    g.uniform1f(uniforms.rankPx, RANK_PX);
    g.uniform1i(uniforms.useStates, 1);
    g.uniform1i(uniforms.useBodies, 1);
    g.uniform1i(uniforms.useBodyColor, color ? 0 : 1);
    g.uniform3fv(uniforms.color, color ? linear(color) : LINEAR.face);
    g.uniform1f(uniforms.alpha, alpha);
    g.uniform1i(uniforms.hoverEnabled, highlight.hoverPane === pass.pane.side ? 1 : 0);
    g.uniform3fv(uniforms.hoverColor, LINEAR.hover);
    g.uniform3fv(uniforms.selectColor, LINEAR.select);
    g.uniform1f(uniforms.hoverMix, COLORS.hoverMix);
    g.uniform1i(uniforms.unlit, lit ? 0 : 1);
    g.uniform1i(uniforms.highlightOnly, 0);
    g.uniform1i(uniforms.pointPass, 0);
    const overhang = style.overhang;
    g.uniform1i(uniforms.overhangEnabled, overhang?.enabled ? 1 : 0);
    g.uniform1f(uniforms.overhangSin, Math.sin((overhang?.alphaDeg ?? 45) * Math.PI / 180));
    g.uniform3fv(uniforms.overhangColor, LINEAR.overhang);
    g.uniform1f(uniforms.overhangMix, COLORS.overhangMix);
    g.activeTexture(g.TEXTURE0 + 1);
    g.bindTexture(g.TEXTURE_2D, gpu.look.entityBody);
    g.activeTexture(g.TEXTURE0 + 2);
    g.bindTexture(g.TEXTURE_2D, gpu.look.bodyStyles);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, gpu.faceStates.texture);
    g.bindVertexArray(gpu.faces);
  }

  // Line program with the pane's matrix and view; `states` is a state texture
  // (model edges) or null (layer lines).
  function useLines(pass, states, clip = pass.clip) {
    const { gl: g } = context;
    const { uniforms } = lines;
    g.useProgram(lines.program);
    g.uniformMatrix4fv(uniforms.viewProjection, false, pass.matrix32);
    g.uniform2f(uniforms.viewport, pass.viewport[0], pass.viewport[1]);
    setViewUniforms(g, uniforms, pass.view, clip);
    g.uniform1i(uniforms.useStates, states ? 1 : 0);
    g.uniform1i(uniforms.hoverEnabled, highlight.hoverPane === pass.pane.side ? 1 : 0);
    g.uniform1f(uniforms.widthPx, style.edgeWidthPx * pass.ratio);
    g.uniform1f(uniforms.accentWidthPx, EDGE_LOOK.accentWidthPx * pass.ratio);
    g.uniform1f(uniforms.biasPx, EDGE_LOOK.biasPx);
    g.uniform3fv(uniforms.edgeColor, COLORS.edge);
    g.uniform3fv(uniforms.hoverColor, COLORS.hoverEdge);
    g.uniform3fv(uniforms.selectColor, COLORS.selectEdge);
    g.uniform3fv(uniforms.bedColor, COLORS.bed);
    g.uniform3fv(uniforms.exemptColor, COLORS.exempt);
    g.activeTexture(g.TEXTURE0);
    if (states) g.bindTexture(g.TEXTURE_2D, states);
    g.bindVertexArray(lines.vao);
  }

  // Edge passes of one body set (see the header).
  function drawEdges(pass, gpu, ranges, { transparent = false } = {}) {
    const { look, model } = gpu;
    if (!ranges.length || !look.segmentCount) return;
    const { gl: g } = context;
    const { uniforms } = lines;
    const classes = modelFacts(model).edgeClasses;
    useLines(pass, gpu.edgeStates.texture);
    g.depthMask(false);
    const run = (kind, alphas) => {
      g.uniform1i(uniforms.pass, kind);
      g.uniform1fv(uniforms.classAlpha, alphas);
      drawSegments(g, look.segments, ranges);
    };
    const dedupe = (func, ref, mask) => {
      g.enable(g.STENCIL_TEST);
      g.stencilFunc(func, ref, mask);
      g.stencilOp(g.KEEP, g.KEEP, g.INVERT);
      g.stencilMask(STENCIL.dedupe);
    };
    const done = () => {
      g.disable(g.STENCIL_TEST);
      clearStencil(g, STENCIL.dedupe);
      g.disable(g.BLEND);
    };
    if (style.edges) {
      const dim = style.hiddenEdges ? EDGE_LOOK.dimmedAlpha : 0;
      if (transparent) {
        const faint = EDGE_LOOK.hiddenAlpha;
        g.depthFunc(g.GREATER);
        blend(g);
        dedupe(g.EQUAL, STENCIL.front, STENCIL.front | STENCIL.dedupe);
        run(PASS.hidden, [faint, faint * EDGE_LOOK.tangentAlpha, faint * dim, faint * dim, faint]);
        done();
        g.depthFunc(g.LEQUAL);
      }
      run(PASS.base, [1, 0, 0, 0, 1]);
      if (classes.tangent || (dim && (classes.seam || classes.subdivision))) {
        blend(g);
        dedupe(g.EQUAL, 0, STENCIL.dedupe);
        run(PASS.soft, [0, EDGE_LOOK.tangentAlpha, dim, dim, 0]);
        done();
      }
    }
    if (look.accented) run(PASS.accent, [0, 0, 0, 0, 0]);
    g.depthMask(true);
  }

  // One pass per member: the shared camera and depth range (the union of
  // every member's placed bounds), the member's placement folded into its
  // matrix, view uniforms and clip planes in its local frame.
  function memberPass(pane, ratio, camera, bounds, viewportSize, member, gpu) {
    const { model } = gpu;
    const origin = applyPoint(member.matrix, model.center);
    const world = viewProjection(camera, pane, bounds, { relativeTo: origin });
    const matrix = placedMatrix(world, member.matrix);
    return {
      pane, ratio, camera, bounds, matrix, matrix32: new Float32Array(matrix),
      view: localView(viewUniforms(camera, pane, bounds, origin), member.matrix),
      clip: clipUniforms(localPlanes(member.matrix, style.clipPlanes), model.center),
      viewport: viewportSize, member, origin,
    };
  }

  // 1-2. Opaque bodies and their edges.
  function drawOpaque({ gpu, look, pass }) {
    const { gl: g } = context;
    useFaces(pass, gpu);
    g.enable(g.POLYGON_OFFSET_FILL);
    g.polygonOffset(1, 1);
    drawRanges(g, g.TRIANGLES, look.passes.opaqueTriangles, 3);
    drawEdges(pass, gpu, look.passes.opaqueSegments);
    g.disable(g.POLYGON_OFFSET_FILL);
  }

  // 3-4. Transparent bodies, their depth and front mark, their edges.
  function drawTransparent({ gpu, look, pass }) {
    const { gl: g } = context;
    const { model } = gpu;
    const passes = look.passes;
    if (!passes.transparent.length) return;
    g.enable(g.POLYGON_OFFSET_FILL);
    g.polygonOffset(1, 1);
    look.centers ??= bodyCenters(model);
    useFaces(pass, gpu);
    blend(g);
    g.depthMask(false);
    g.enable(g.CULL_FACE);
    for (const index of backToFront(look.centers, passes.transparent, pass.view.toward)) {
      const range = [[model.bodies[index].indexRange[0] / 3,
        model.bodies[index].indexRange[1] / 3]];
      g.cullFace(g.FRONT);
      drawRanges(g, g.TRIANGLES, range, 3);
      g.cullFace(g.BACK);
      drawRanges(g, g.TRIANGLES, range, 3);
    }
    g.disable(g.CULL_FACE);
    g.disable(g.BLEND);
    g.colorMask(false, false, false, false);
    g.depthMask(true);
    g.enable(g.STENCIL_TEST);
    g.stencilFunc(g.ALWAYS, STENCIL.front, STENCIL.front);
    g.stencilOp(g.KEEP, g.KEEP, g.REPLACE);
    g.stencilMask(STENCIL.front);
    drawRanges(g, g.TRIANGLES, passes.transparentTriangles, 3);
    g.colorMask(true, true, true, true);
    g.disable(g.STENCIL_TEST);
    g.stencilMask(0xff);
    drawEdges(pass, gpu, passes.transparentSegments, { transparent: true });
    clearStencil(g, STENCIL.front);
    g.disable(g.POLYGON_OFFSET_FILL);
  }

  // 5. Highlighted B-rep points.
  function drawPoints({ gpu, look, pass }) {
    const { gl: g } = context;
    const { model } = gpu;
    const hidden = look.passes.hiddenMask;
    const points = (gpu.highlightPoints ?? []).filter(([index, bits]) => !hidden?.[
      model.arrays.bodyOfPoint[index]] && (bits & STATE_SELECTED
      || highlight.hoverPane === pass.pane.side));
    if (!points.length) return;
    const { uniforms } = context;
    useFaces(pass, gpu, { lit: false });
    g.bindVertexArray(gpu.points);
    g.vertexAttrib2f(ATTRIBUTES.normal, 0, 0);
    g.vertexAttribI4ui(ATTRIBUTES.entity, NO_ENTITY, 0, 0, 0);
    g.uniform1i(uniforms.useStates, 0);
    g.uniform1i(uniforms.useBodies, 0);
    g.uniform1i(uniforms.useBodyColor, 0);
    g.uniform1i(uniforms.pointPass, 1);
    for (const [index, bits] of points) {
      const selected = bits & STATE_SELECTED;
      g.uniform3fv(uniforms.color, selected ? LINEAR.select : LINEAR.hover);
      g.uniform1f(uniforms.pointSize, (selected ? 9 : 7) * pass.ratio);
      g.drawArrays(g.POINTS, index, 1);
    }
    g.uniform1i(uniforms.pointPass, 0);
  }

  // Layers get the member-relative matrix and its origin; `matrixFor(origin)`
  // gives the same camera relative to another origin (in the member's local
  // frame). Layers run once with the active member (the pane's model), or
  // once per member when they set `perMember: true` (section caps).
  function layerFrame(entry, g) {
    const { gpu, pass } = entry;
    const { model } = gpu;
    const member = pass.member;
    const pane = member.instance ? { ...pass.pane, modelId: member.modelId } : pass.pane;
    return {
      gl: g, pane, panes: panes.viewPanes(), ratio: pass.ratio, viewProjection: pass.matrix,
      origin: model.center, camera: pass.camera, model, bounds: pass.bounds,
      member: member.instance ? member : null,
      matrixFor: origin => placedMatrix(viewProjection(pass.camera, pass.pane, pass.bounds,
        { relativeTo: applyPoint(member.matrix, origin) }), member.matrix),
      drawLines: options => drawLayerLines(pass, model, options),
      drawBodies: options => drawLayerBodies(pass, gpu, options),
    };
  }

  function drawPane(pane, ratio) {
    const { gl: g } = context;
    if (pane.clipWidth <= 0 || pane.width <= 0) return;
    const entries = paneMembers(pane).map(member => ({ member, gpu: ensureGpu(member.modelId) }))
      .filter(entry => entry.gpu);
    if (!entries.length) return;
    const left = Math.round(pane.x * ratio);
    const right = Math.round((pane.x + pane.width) * ratio);
    const clipLeft = Math.round(pane.clipX * ratio);
    const clipRight = Math.round((pane.clipX + pane.clipWidth) * ratio);
    g.viewport(left, 0, right - left, canvas.height);
    g.scissor(clipLeft, 0, clipRight - clipLeft, canvas.height);
    resetState(g);
    const camera = cameraFor(state, panes, pane);
    const ghost = style.ghost?.modelId ? cache.model(style.ghost.modelId) : null;
    const boxes = entries.map(({ member, gpu }) => placeBox(member.matrix, gpu.model.bounds));
    const bounds = unionBox([...boxes, ghost?.bounds].filter(Boolean)) ?? entries[0].gpu.model
      .bounds;
    const viewportSize = [right - left, canvas.height];
    for (const entry of entries) {
      entry.pass = memberPass(pane, ratio, camera, bounds, viewportSize, entry.member, entry.gpu);
      entry.look = lookFor(entry.gpu, entry.member.modelId);
    }
    for (const entry of entries) drawOpaque(entry);
    for (const entry of entries) drawTransparent(entry);
    for (const entry of entries) drawPoints(entry);
    g.bindVertexArray(null);
    resetState(g);

    const active = entries.find(entry => entry.member.modelId === pane.modelId) ?? entries[0];
    const activeFrame = layerFrame(active, g);
    for (const layer of layers.list()) {
      for (const entry of layer.perMember ? entries : [active]) {
        layer.draw?.(entry === active ? activeFrame : layerFrame(entry, g));
        resetState(g);
      }
    }
  }

  // frame.drawLines(options): fat layer lines (render/layers.js).
  function drawLayerLines(pass, model, options = {}) {
    const { gl: g } = context;
    const settings = lineOptions(options);
    const { buffer, count } = segmentsFrom(options.positions, {
      origin: model.center, strip: options.strip === true, closed: options.closed === true,
    });
    if (!count) return 0;
    const { uniforms } = lines;
    useLines(pass, null, settings.clip ? pass.clip : clipUniforms());
    g.uniform1i(uniforms.pass, PASS.layer);
    g.uniform4fv(uniforms.lineColor, settings.color);
    g.uniform1f(uniforms.widthPx, settings.widthPx * pass.ratio);
    g.uniform1f(uniforms.biasPx, settings.depthBias);
    if (!lines.layerBuffer) {
      lines.layerBuffer = g.createBuffer();
      counters.lookBuffersCreated++;
    }
    g.bindBuffer(g.ARRAY_BUFFER, lines.layerBuffer);
    g.bufferData(g.ARRAY_BUFFER, buffer, g.DYNAMIC_DRAW);
    if (settings.depthTest) g.enable(g.DEPTH_TEST);
    else g.disable(g.DEPTH_TEST);
    g.depthMask(false);
    blend(g);
    drawSegments(g, lines.layerBuffer, [[0, count]]);
    resetState(g);
    g.bindVertexArray(null);
    return count;
  }

  // frame.drawBodies(options): triangles of a model with explicit GL state.
  function drawLayerBodies(pass, paneGpu, options = {}) {
    const { gl: g } = context;
    const settings = bodyOptions(options);
    const paneModel = pass.member?.modelId ?? pass.pane.modelId;
    const id = settings.modelId ?? paneModel;
    const gpu = id === paneModel ? paneGpu : ensureGpu(id);
    if (!gpu) return 0;
    const { model } = gpu;
    const look = lookFor(gpu, id);
    const wanted = settings.bodies ? new Set(settings.bodies) : null;
    const indices = wanted ? model.bodies.filter(body => wanted.has(body.id))
      .map(body => body.index) : [...look.passes.opaque, ...look.passes.transparent].sort(
      (a, b) => a - b);
    const ranges = mergedRanges(model.bodies, indices,
      body => [body.indexRange[0] / 3, body.indexRange[1] / 3]);
    const own = gpu === paneGpu;
    const matrix = own ? pass.matrix
      : viewProjection(pass.camera, pass.pane, pass.bounds, { relativeTo: model.center });
    const local = own ? pass : {
      ...pass, matrix, matrix32: new Float32Array(matrix),
      view: viewUniforms(pass.camera, pass.pane, pass.bounds, model.center),
      clip: clipUniforms(style.clipPlanes, model.center),
    };
    useFaces(local, gpu, {
      lit: settings.lit, color: settings.color, alpha: settings.alpha,
      clip: settings.clip ? local.clip : clipUniforms(),
    });
    blend(g);
    if (settings.cull === 'none') g.disable(g.CULL_FACE);
    else {
      g.enable(g.CULL_FACE);
      g.cullFace(settings.cull === 'front' ? g.FRONT : g.BACK);
    }
    g.colorMask(...settings.colorMask);
    g.depthMask(settings.depthMask);
    if (settings.depthTest) g.enable(g.DEPTH_TEST);
    else g.disable(g.DEPTH_TEST);
    g.depthFunc(g[settings.depthFunc]);
    if (settings.stencil) {
      const { func, ref, mask, fail, zfail, zpass, writeMask } = settings.stencil;
      g.enable(g.STENCIL_TEST);
      g.stencilFunc(g[func], ref, mask);
      g.stencilOp(g[fail], g[zfail], g[zpass]);
      g.stencilMask(writeMask);
    }
    g.enable(g.POLYGON_OFFSET_FILL);
    g.polygonOffset(...settings.polygonOffset);
    drawRanges(g, g.TRIANGLES, ranges, 3);
    resetState(g);
    g.bindVertexArray(null);
    return ranges.reduce((sum, [start, end]) => sum + end - start, 0);
  }

  function onLost(event) {
    event.preventDefault?.();
    lost = true;
    counters.contextLosses++;
    counters.liveBytes = 0;
    counters.lookBytes = 0;
    // GPU handles died with the context; the typed arrays stay cached.
    for (const item of cache.entries()) if (item.gpu) cache.setGpu(item.id, null, 0);
    for (const listener of [...lostListeners]) listener(event);
  }

  function onRestored(event) {
    try {
      context = setupGl(context.gl, counters);
      setupLines();
    } catch (error) {
      unavailable = error.message;
      return;
    }
    lost = false;
    counters.contextRestores++;
    const title = env.document?.querySelector?.('#viewport-message-title');
    const message = env.document?.querySelector?.('#viewport-message');
    if (message && title?.textContent === INTERRUPTED_TITLE) message.hidden = true;
    api.draw();
    for (const listener of [...restoredListeners]) listener(event);
  }

  const api = {
    init() {
      try {
        context = createGl(canvas, counters);
        setupLines();
      } catch (error) {
        unavailable = error.message;
        context = null;
        throw error;
      }
      unavailable = null;
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);
      return context;
    },
    available: () => !!context && !lost,
    unavailableReason: () => unavailable,
    gl: () => context?.gl,
    onContextLost(listener) {
      lostListeners.add(listener);
      return () => lostListeners.delete(listener);
    },
    onContextRestored(listener) {
      restoredListeners.add(listener);
      return () => restoredListeners.delete(listener);
    },
    // Loads the binary draw payload of a revision (no JSON scene).
    async loadModel(id, { signal } = {}) {
      const model = await cache.loadDraw(id, { signal });
      ensureGpu(id);
      return model;
    },
    model: id => cache.model(id),
    bounds: id => cache.bounds(id),
    // Legacy JSON path: the scene is drawn through the JSON adapter at once;
    // the draw payload replaces it when it arrives (WebGL only, so the VS
    // harness never requests it).
    prepareScene(scene) {
      if (!scene?.id) return;
      if (cache.scenes.get(scene.id) !== scene) cache.scenes.set(scene.id, scene);
      if (!context) return;
      ensureGpu(scene.id);
      if (cache.entry(scene.id)?.model) return;
      cache.loadDraw(scene.id).catch(error => {
        warnings.push(`Draw payload for ${scene.id.slice(0, 12)} unavailable: ${error.message}`);
        env.window?.console?.warn?.(warnings.at(-1));
      });
    },
    // The composed style table (render/style.js composeStyle); only
    // features/display/display.js calls this.
    setStyle(next) {
      const overhangBefore = JSON.stringify(style.overhang);
      style = { ...style, ...next };
      styleVersion++;
      picker.setStyle?.(style);
      if (JSON.stringify(style.overhang) !== overhangBefore) {
        refreshStates(cache.entries().filter(item => item.gpu).map(item => item.id));
      }
    },
    style: () => ({ ...style }),
    // Increments with every setStyle() (cache key for style-derived views).
    styleVersion: () => styleVersion,
    // Display facts of a model for the legend and the parts tree: tolerance,
    // edge classes, smooth-normal faces, and every body's resolved color with
    // its source ('appearance', 'override', 'viewer-palette').
    look(id) {
      const model = cache.model(id);
      if (!model) return null;
      const codes = overhangCodes(model, style, id);
      return {
        modelId: id, ...modelFacts(model),
        curvedOverhangFaces: codes ? codes.filter(code => code === OVERHANG.curved).length : 0,
        bodies: model.bodies.map((body, index) => ({
          id: body.id, alias: `B${index + 1}`, name: body.name ?? body.id,
          ...resolveBodyStyle(style, id, body, index),
        })),
      };
    },
    // `selection` accepts any number of references (multi-selection).
    setHighlights({ hover, hoverPane, selection } = {}) {
      const before = highlightIds();
      const previousHover = highlight.hover;
      const previousPane = highlight.hoverPane;
      if (hover !== undefined || hoverPane !== undefined) {
        if (hover !== undefined) highlight.hover = hover;
        highlight.hoverPane = hoverPane ?? null;
      }
      if (selection !== undefined) {
        highlight.selection = [selection].flat().filter(Boolean);
      }
      refreshStates(new Set([...before, ...highlightIds()]));
      const hoverChanged = !sameReference(previousHover, highlight.hover)
        || previousPane !== highlight.hoverPane;
      if (hoverChanged && context && !lost) {
        api.draw();
        frames.hoverDraws++;
        frames.lastHoverDrawAt = frames.lastDrawAt;
        frames.lastHover = highlight.hover;
      }
    },
    highlights: () => ({
      hover: highlight.hover, hoverPane: highlight.hoverPane, selection: [...highlight.selection],
    }),
    // Debug: highlighted face, edge and point indices of a cached model.
    highlightState(modelId) {
      const model = cache.model(modelId);
      if (!model) return null;
      const states = highlightStates(model, highlight, modelId);
      return {
        faces: indexOf(states.faces, value => value),
        hoverFaces: indexOf(states.faces, value => value & STATE_HOVER),
        selectedFaces: indexOf(states.faces, value => value & STATE_SELECTED),
        edges: indexOf(states.edges, value => value),
        points: states.points,
      };
    },
    addLayer: layer => {
      const remove = layers.add(layer);
      requestDraw();
      return () => {
        remove();
        requestDraw();
      };
    },
    layers: () => layers.list().map(layer => layer.id),
    draw() {
      if (!context || lost) return;
      const started = globalThis.performance?.now() ?? Date.now();
      const { gl: g } = context;
      const ratio = Math.min(env.window.devicePixelRatio ?? 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      g.viewport(0, 0, width, height);
      g.disable(g.SCISSOR_TEST);
      g.clearColor(0, 0, 0, 0);
      g.clearStencil(0);
      g.stencilMask(0xff);
      g.depthMask(true);
      g.colorMask(true, true, true, true);
      g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT | g.STENCIL_BUFFER_BIT);
      g.enable(g.SCISSOR_TEST);
      for (const pane of panes.viewPanes()) drawPane(pane, ratio);
      g.disable(g.SCISSOR_TEST);
      frames.draws++;
      frames.lastDrawAt = globalThis.performance?.now() ?? Date.now();
      timings.push(frames.lastDrawAt - started);
      if (timings.length > TIMING_SAMPLES) timings.shift();
    },
    project: (point, pane) => panes.project(point, pane),
    pick: (x, y, mode) => picker(x, y, mode),
    pickDetail: (x, y, mode) => picker.detail?.(x, y, mode) ?? null,
    entityPoints: reference => entityPoints(cache.model(reference?.modelId), reference),
    alias: reference => entityAlias(cache.model(reference?.modelId), reference),
    summary: id => modelSummary(cache.model(id), id),
    stats: () => ({
      available: !!context && !lost,
      unavailable,
      gpu: { ...counters },
      cache: cache.stats(),
      pick: picker.stats?.() ?? null,
      frames: {
        ...frames, cpuSamples: timings.length, lastCpuMs: timings.at(-1) ?? null,
        medianCpuMs: median(timings),
      },
      warnings: [...warnings],
    }),
  };
  return api;
}
