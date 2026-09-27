// Display section caps (package: section).
//
// The renderer clips faces, edges and points against up to three planes
// (render-look, style.clipPlanes; geometry with dot(n, p - origin) > 0 is
// cut away). This module closes the cut with a cap per plane and body, drawn
// from the display mesh, never from new geometry. It is the stencil-cap
// technique with the parity kept in an offscreen R8 target instead of the
// stencil buffer, because WebGL2 cannot sample stencil and the cap shader
// needs the neighbours (gap closing, below):
//
//   1. parity: the body's display triangles, clipped by this plane only, are
//      drawn without depth test into the parity target, each fragment
//      toggling the pixel (blend ONE_MINUS_DST_COLOR, ZERO). A pixel ends at
//      1 where the ray crosses the body's remaining surface an odd number of
//      times, i.e. where the plane point is inside the body.
//   2. cap: the plane polygon (plane ∩ model bounds) is drawn on the canvas
//      where the parity is 1, clipped by the other planes, depth-tested
//      against the model, filled in the body color with a hatch.
//
// Gap closing: the display mesh is not watertight. A cylinder and its planar
// neighbour are sampled independently, so seams carry slivers (gaps or
// overlaps) up to the display tolerance wide, and a ray through one flips
// the parity: a hairline leak. A pixel with parity 0 is still capped when,
// along one of four directions, parity-1 pixels lie on both sides within
// `gap` px; gap is the display tolerance at the current zoom in device px,
// rounded up (1 to 6 px). This closes openings up to 2 gap - 1 px, about
// twice the display tolerance and at least one pixel: the seams, and any
// real slit that narrow. It never extends a convex outline; a concave corner
// of the cut can be blunted by up to gap px.
//
// Bodies with boundary-only faces (display warning, no triangles) have an
// open mesh, so their cap is not drawn and they are reported "cap
// unavailable" (capAvailability).
import { pixelsPerMm } from '../../render/camera.js';
import { MAX_CLIP_PLANES } from '../../render/shaders.js';

export const HATCH_PX = 7;
export const HATCH_SHADE = 0.78;
export const MIN_GAP_PX = 1;
export const MAX_GAP_PX = 6;
// Plane polygons use the model bounds grown by this fraction of the
// diagonal, so a body touching its bounds is fully covered.
export const BOUNDS_MARGIN = 1e-3;
const PARITY_UNIT = 5;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]];
const unit = vector => {
  const length = Math.hypot(...vector);
  return length > 0 ? vector.map(value => value / length) : null;
};

// Any unit vector perpendicular to `normal` (a stable choice).
export function perpendicular(normal) {
  const axis = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(normal, axis));
}

const BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7]];

// Convex polygon (world points, counter-clockwise about the normal) where
// the plane { origin, normal } cuts the box, or null when it misses.
export function planeBoxPolygon(plane, bounds, margin = BOUNDS_MARGIN) {
  const normal = unit(plane?.normal ?? []);
  if (!normal || !bounds?.min || !bounds?.max) return null;
  const grow = margin * Math.hypot(...sub(bounds.max, bounds.min)) + 1e-9;
  const min = bounds.min.map(value => value - grow);
  const max = bounds.max.map(value => value + grow);
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(bits => [
    bits & 1 ? max[0] : min[0], bits & 2 ? max[1] : min[1], bits & 4 ? max[2] : min[2]]);
  const side = corners.map(corner => dot(normal, sub(corner, plane.origin)));
  const points = corners.filter((_corner, index) => side[index] === 0);
  for (const [a, b] of BOX_EDGES) {
    if ((side[a] < 0 && side[b] > 0) || (side[a] > 0 && side[b] < 0)) {
      const t = side[a] / (side[a] - side[b]);
      points.push(corners[a].map((value, axis) => value + t * (corners[b][axis] - value)));
    }
  }
  const size = Math.hypot(...sub(max, min));
  const unique = [];
  for (const point of points) {
    if (!unique.some(other => Math.hypot(...sub(point, other)) <= 1e-9 * size)) unique.push(point);
  }
  if (unique.length < 3) return null;
  const u = perpendicular(normal);
  const v = cross(normal, u);
  const center = [0, 1, 2].map(axis => unique.reduce((sum, point) => sum + point[axis], 0)
    / unique.length);
  const angle = point => Math.atan2(dot(v, sub(point, center)), dot(u, sub(point, center)));
  return unique.sort((a, b) => angle(a) - angle(b));
}

// [nx, ny, nz, w] of a world plane relative to a draw origin (the shaders
// discard dot(n, p) > w for model-relative p, like the renderer).
export function relativePlane(plane, center) {
  const normal = unit(plane.normal);
  return [...normal, dot(normal, sub(plane.origin, center))];
}

// Gap-closing radius in device px: the display tolerance at this zoom,
// rounded up, 1..MAX_GAP_PX. A radius of g px closes openings up to 2g - 1 px.
export function gapRadius(toleranceMm, pxPerMm, ratio = 1) {
  const width = (toleranceMm > 0 ? toleranceMm : 0) * pxPerMm * ratio;
  if (!Number.isFinite(width)) return MIN_GAP_PX;
  return Math.min(MAX_GAP_PX, Math.max(MIN_GAP_PX, Math.ceil(width)));
}

// The gap rule on a parity grid (tests and documentation of the shader):
// get(x, y) -> 0/1; returns 1 when the pixel is capped.
export function capCovers(get, x, y, gap) {
  if (get(x, y)) return 1;
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let ahead = false;
    let behind = false;
    for (let step = 1; step <= gap; step++) {
      ahead ||= !!get(x + step * dx, y + step * dy);
      behind ||= !!get(x - step * dx, y - step * dy);
    }
    if (ahead && behind) return 1;
  }
  return 0;
}

// World bounds { min, max } of every body's display vertices.
export function bodyBounds(model) {
  const { positions } = model.arrays;
  return model.bodies.map(body => {
    const [start, end] = body.vertexRange ?? [0, 0];
    if (end <= start) return null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let vertex = start; vertex < end; vertex++) {
      for (let axis = 0; axis < 3; axis++) {
        const value = model.center[axis] + positions[3 * vertex + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
    return { min, max };
  });
}

// How the planes meet a box: 'clipped' (wholly on a removed side), 'cut'
// (some plane crosses it) or 'whole' (untouched).
export function planesMeetBox(planes, box) {
  if (!box) return 'whole';
  let cut = false;
  for (const plane of planes) {
    const normal = unit(plane.normal);
    let low = Infinity;
    let high = -Infinity;
    for (let bits = 0; bits < 8; bits++) {
      const corner = [0, 1, 2].map(axis => ((bits >> axis) & 1 ? box.max : box.min)[axis]);
      const side = dot(normal, sub(corner, plane.origin));
      low = Math.min(low, side);
      high = Math.max(high, side);
    }
    if (low > 0) return 'clipped';
    if (high > 0) cut = true;
  }
  return cut ? 'cut' : 'whole';
}

// Device-pixel rectangle [x0, y0, x1, y1] (inclusive) of a world box under a
// model-relative column-major view-projection, grown by `margin` and cut to
// `clip`; the whole clip when a corner lies behind a perspective eye; null
// when empty.
export function boxRect(matrix, center, box, viewport, clip, margin = 0) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let bits = 0; bits < 8; bits++) {
    const p = [0, 1, 2].map(axis => ((bits >> axis) & 1 ? box.max : box.min)[axis]
      - center[axis]);
    const clipAt = row => matrix[row] * p[0] + matrix[4 + row] * p[1] + matrix[8 + row] * p[2]
      + matrix[12 + row];
    const w = clipAt(3);
    if (!(w > 1e-9)) return [...clip];
    const x = viewport[0] + (clipAt(0) / w + 1) / 2 * viewport[2];
    const y = viewport[1] + (clipAt(1) / w + 1) / 2 * viewport[3];
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const rect = [Math.max(clip[0], Math.floor(x0 - margin)), Math.max(clip[1], Math.floor(y0
    - margin)), Math.min(clip[2], Math.ceil(x1 + margin)), Math.min(clip[3], Math.ceil(y1
    + margin))];
  return rect[0] <= rect[2] && rect[1] <= rect[3] ? rect : null;
}

const faceAlias = face => face.alias ?? `B${face.body + 1}.F${face.index + 1}`;

// Which bodies of a draw model can be capped. A body's display mesh is open
// when a face has a display warning (boundary-only face) or no triangles.
export function capAvailability(model) {
  return (model?.bodies ?? []).map(body => {
    const [first, last] = body.faceRange ?? [0, 0];
    const missing = [];
    for (let face = first; face < last; face++) {
      const record = model.faces[face];
      const [start, end] = record?.indexRange ?? [0, 0];
      if (record?.displayWarning || end <= start) {
        missing.push({ alias: faceAlias(record), reason: record?.displayWarning
          ?? 'No display triangles' });
      }
    }
    const triangles = ((body.indexRange?.[1] ?? 0) - (body.indexRange?.[0] ?? 0)) / 3;
    const available = !missing.length && triangles > 0;
    const count = missing.length;
    return {
      index: body.index, id: body.id, alias: `B${body.index + 1}`, available, missing,
      reason: available ? null : count
        ? `cap unavailable: ${count} boundary-only face${count === 1 ? '' : 's'}`
          + ` (${missing.map(item => item.alias).join(', ')})`
        : 'cap unavailable: no display triangles',
    };
  });
}

const PLANE_VERTEX = `#version 300 es
layout(location = 0) in vec3 position;
uniform mat4 viewProjection;
out vec3 relative;
void main() {
  relative = position;
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

const PARITY_FRAGMENT = `#version 300 es
precision highp float;
in vec3 relative;
uniform vec4 plane;
out vec4 fragColor;
void main() {
  if (dot(plane.xyz, relative) > plane.w) discard;
  fragColor = vec4(1.0);
}`;

const OTHERS = MAX_CLIP_PLANES - 1;
const CAP_FRAGMENT = `#version 300 es
precision highp float;
in vec3 relative;
uniform int otherCount;
uniform vec4 others[${OTHERS}];
uniform sampler2D parity;
uniform ivec4 clipRect;
uniform int gap;
uniform vec3 color;
uniform float alpha;
uniform float hatchPx;
uniform float hatchWidth;
uniform float hatchShade;
out vec4 fragColor;
bool inside(ivec2 p) {
  return texelFetch(parity, clamp(p, clipRect.xy, clipRect.zw), 0).r > 0.5;
}
void main() {
  for (int i = 0; i < ${OTHERS}; i++) {
    if (i < otherCount && dot(others[i].xyz, relative) > others[i].w) discard;
  }
  ivec2 p = ivec2(gl_FragCoord.xy);
  bool covered = inside(p);
  ivec2 directions[4] = ivec2[4](ivec2(1, 0), ivec2(0, 1), ivec2(1, 1), ivec2(1, -1));
  for (int d = 0; d < 4; d++) {
    if (covered) break;
    bool ahead = false;
    bool behind = false;
    for (int step = 1; step <= ${MAX_GAP_PX}; step++) {
      if (step > gap) break;
      ahead = ahead || inside(p + directions[d] * step);
      behind = behind || inside(p - directions[d] * step);
    }
    covered = ahead && behind;
  }
  if (!covered) discard;
  float stripe = mod(gl_FragCoord.x + gl_FragCoord.y, hatchPx);
  float shade = stripe < hatchWidth ? hatchShade : 1.0;
  fragColor = vec4(color * shade, alpha);
}`;

function compile(gl, vertex, fragment, uniforms) {
  const shader = (type, source) => {
    const item = gl.createShader(type);
    gl.shaderSource(item, source);
    gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(item);
      gl.deleteShader(item);
      throw new Error(`Section cap shader failed to compile: ${log}`);
    }
    return item;
  };
  const program = gl.createProgram();
  const shaders = [shader(gl.VERTEX_SHADER, vertex), shader(gl.FRAGMENT_SHADER, fragment)];
  for (const item of shaders) gl.attachShader(program, item);
  gl.linkProgram(program);
  for (const item of shaders) gl.deleteShader(item);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Section cap program failed to link: ${log}`);
  }
  return {
    program,
    uniforms: Object.fromEntries(uniforms.map(name => [name, gl.getUniformLocation(program,
      name)])),
  };
}

// GL side of the caps. draw(frame, { planes, styles, availability,
// toleranceMm }) runs inside a renderer layer; styles are
// renderer.look(modelId).bodies.
export function createCapRenderer() {
  let resources = null;
  let current = [];
  const counters = {
    frames: 0, parityDraws: 0, capDraws: 0, unavailableSkips: 0, hiddenSkips: 0,
    buffersCreated: 0, buffersDeleted: 0, bytes: 0, targetBytes: 0, error: null,
    lastCaps: [], lastGapPx: null,
  };

  function ensure(gl) {
    if (resources?.gl === gl) return resources;
    resources = null;
    const parity = compile(gl, PLANE_VERTEX, PARITY_FRAGMENT, ['viewProjection', 'plane']);
    const cap = compile(gl, PLANE_VERTEX, CAP_FRAGMENT, ['viewProjection', 'otherCount',
      'others', 'parity', 'clipRect', 'gap', 'color', 'alpha', 'hatchPx', 'hatchWidth',
      'hatchShade']);
    const polygonVao = gl.createVertexArray();
    const polygonBuffer = gl.createBuffer();
    gl.bindVertexArray(polygonVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, polygonBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 3 * 16 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    counters.buffersCreated++;
    resources = { gl, parity, cap, polygonVao, polygonBuffer, models: new Map(), target: null };
    return resources;
  }

  // Parity target: one R8 texture of the drawing-buffer size.
  function ensureTarget(gl) {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const target = resources.target;
    if (target?.width === width && target.height === height) return target;
    if (target) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      resources.target = null;
      throw new Error(`Section cap parity target incomplete (0x${status.toString(16)})`);
    }
    counters.targetBytes = width * height;
    resources.target = { width, height, texture, framebuffer };
    return resources.target;
  }

  // Position and index buffers of a draw model (its own copy while the
  // section is on; released by releaseExcept()).
  function modelBuffers(gl, model) {
    const cached = resources.models.get(model.id);
    if (cached?.model === model) return cached;
    if (cached) deleteModel(gl, cached);
    const { positions, indices } = model.arrays;
    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const bytes = positions.byteLength + indices.byteLength;
    const entry = { model, vao, vertexBuffer, indexBuffer, bytes };
    resources.models.set(model.id, entry);
    counters.buffersCreated += 2;
    counters.bytes += bytes;
    return entry;
  }

  function deleteModel(gl, entry) {
    gl.deleteVertexArray(entry.vao);
    gl.deleteBuffer(entry.vertexBuffer);
    gl.deleteBuffer(entry.indexBuffer);
    counters.buffersDeleted += 2;
    counters.bytes -= entry.bytes;
    resources.models.delete(entry.model.id);
  }

  function parityPass(gl, target, entry, plane, matrix, range) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(resources.parity.program);
    gl.uniformMatrix4fv(resources.parity.uniforms.viewProjection, false, matrix);
    gl.uniform4fv(resources.parity.uniforms.plane, plane);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ZERO);
    gl.bindVertexArray(entry.vao);
    gl.drawElements(gl.TRIANGLES, range[1] - range[0], gl.UNSIGNED_INT, range[0] * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    counters.parityDraws++;
  }

  function drawPlaneCaps(gl, frame, entry, index, context) {
    const { planes, styles, availability, relative, gap, clip, viewport, boxes, target } = context;
    const { model } = frame;
    const polygon = planeBoxPolygon(planes[index], model.bounds);
    if (!polygon) return;
    const flat = new Float32Array(polygon.flatMap(point => sub(point, model.center)));
    const others = new Float32Array(4 * OTHERS);
    relative.filter((_plane, other) => other !== index)
      .forEach((plane, slot) => others.set(plane, 4 * slot));
    const matrix = new Float32Array(frame.viewProjection);
    for (const body of model.bodies) {
      const style = styles[body.index];
      if (style && style.visible === false) {
        counters.hiddenSkips++;
        continue;
      }
      if (!availability[body.index]?.available) {
        counters.unavailableSkips++;
        continue;
      }
      if (body.indexRange[1] <= body.indexRange[0]) continue;
      const box = boxes[body.index];
      if (!box || planesMeetBox([planes[index]], box) !== 'cut') continue;
      const rect = boxRect(frame.viewProjection, model.center, box, viewport, clip, gap + 2);
      if (!rect) continue;
      gl.scissor(rect[0], rect[1], rect[2] - rect[0] + 1, rect[3] - rect[1] + 1);
      parityPass(gl, target, entry, relative[index], matrix, body.indexRange);
      const alpha = Math.min(1, Math.max(0, style?.opacity ?? 1));
      const { program, uniforms } = resources.cap;
      gl.useProgram(program);
      gl.uniformMatrix4fv(uniforms.viewProjection, false, matrix);
      gl.uniform1i(uniforms.otherCount, planes.length - 1);
      gl.uniform4fv(uniforms.others, others);
      gl.activeTexture(gl.TEXTURE0 + PARITY_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.uniform1i(uniforms.parity, PARITY_UNIT);
      gl.uniform4iv(uniforms.clipRect, new Int32Array(rect));
      gl.uniform1i(uniforms.gap, gap);
      gl.uniform3fv(uniforms.color, style?.color ?? [0.75, 0.8, 0.75]);
      gl.uniform1f(uniforms.alpha, alpha);
      gl.uniform1f(uniforms.hatchPx, HATCH_PX * frame.ratio);
      gl.uniform1f(uniforms.hatchWidth, Math.max(1, frame.ratio));
      gl.uniform1f(uniforms.hatchShade, HATCH_SHADE);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(alpha >= 1);
      if (alpha < 1) {
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA);
      } else gl.disable(gl.BLEND);
      gl.bindVertexArray(resources.polygonVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.polygonBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, flat);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, polygon.length);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      counters.capDraws++;
      current.push({ modelId: model.id, body: `B${body.index + 1}`, plane: index,
        side: frame.pane.side });
    }
  }

  function draw(frame, {
    planes, styles = [], availability = [], boxes = [], toleranceMm = null, gapPx = null,
  }) {
    if (!planes?.length || !frame?.model) return;
    const { gl } = frame;
    let target;
    try {
      ensure(gl);
      target = ensureTarget(gl);
    } catch (error) {
      counters.error = error.message;
      return;
    }
    counters.frames++;
    const entry = modelBuffers(gl, frame.model);
    const relative = planes.map(plane => relativePlane(plane, frame.model.center));
    const { pane, ratio } = frame;
    // The renderer's pane viewport and scissor (drawPane), restored below.
    const viewportLeft = Math.round(pane.x * ratio);
    const viewport = [viewportLeft, 0, Math.round((pane.x + pane.width) * ratio) - viewportLeft,
      target.height];
    const left = Math.max(0, Math.round(pane.clipX * ratio));
    const right = Math.min(target.width, Math.round((pane.clipX + pane.clipWidth) * ratio));
    const clip = [left, 0, Math.max(left, right - 1), target.height - 1];
    const gap = Number.isInteger(gapPx) ? Math.min(MAX_GAP_PX, Math.max(0, gapPx))
      : gapRadius(toleranceMm, pixelsPerMm(frame.camera, pane), ratio);
    counters.lastGapPx = gap;
    const context = { planes, styles, availability, relative, gap, clip, viewport, boxes, target };
    try {
      for (let index = 0; index < planes.length; index++) {
        drawPlaneCaps(gl, frame, entry, index, context);
      }
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.scissor(left, 0, right - left, target.height);
      gl.disable(gl.BLEND);
      gl.colorMask(true, true, true, true);
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
      gl.bindVertexArray(null);
      gl.useProgram(null);
    }
  }

  return {
    draw,
    // Called after every frame: the caps of that frame become lastCaps.
    endFrame() {
      counters.lastCaps = current;
      current = [];
    },
    // Deletes model buffers except those of `keep` (model ids); with nothing
    // to keep the parity target goes too.
    releaseExcept(keep = []) {
      if (!resources) return;
      const wanted = new Set(keep);
      for (const entry of [...resources.models.values()]) {
        if (!wanted.has(entry.model.id)) deleteModel(resources.gl, entry);
      }
      if (!wanted.size && resources.target) {
        resources.gl.deleteFramebuffer(resources.target.framebuffer);
        resources.gl.deleteTexture(resources.target.texture);
        resources.target = null;
        counters.targetBytes = 0;
      }
    },
    // After a context loss every handle is gone; nothing to delete.
    lost() {
      resources = null;
      counters.bytes = 0;
      counters.targetBytes = 0;
    },
    stats: () => ({
      ...counters, lastCaps: [...counters.lastCaps],
      models: resources ? [...resources.models.keys()] : [],
    }),
  };
}
