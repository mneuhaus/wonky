// WebGL2 shader sources (GLSL ES 3.00) and the look constants (render-look).
//
// Positions arrive relative to the draw model's center (float64 subtraction
// on the server), and the view-projection matrix maps model-relative
// coordinates, so float32 stays precise far from the origin. Normals arrive
// oct16-encoded per vertex (exact for planes, cylinders and cones).
//
// Two programs:
//
//   face program (VERTEX_SHADER, FRAGMENT_SHADER; compiled by gl.js) draws
//   body triangles and B-rep points. Lighting: hemisphere ambient keyed to
//   world +Z, one view-space key light, a weak fill and a low Blinn-Phong
//   specular, computed in linear space with sRGB output. Two-sided through the
//   outward winding and gl_FrontFacing (no abs()).
//
//   line program (LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER; compiled by
//   renderer.js) draws fat lines: one instanced screen-space quad per segment
//   (4 strip vertices), width in device px, moved toward the eye by a depth
//   bias of `biasPx` CSS px of view depth (camera depthPerPixel). It draws the
//   B-rep edges per class and pass, and the layer lines of frame.drawLines().
//
// Per-entity data lives in textures read with texelFetch, 1024 texels per row:
//
//   states      R8UI per face / per edge (gl.js). Bit 0 hover, bit 1 selected.
//               Faces: bits 2-4 overhang flag (OVERHANG). Edges: bits 2-4 edge
//               class (EDGE_CLASS), bit 5 bed outline, bit 6 exempt outline.
//   entityBody  R16UI per face: body index.
//   bodyStyles  RGBA32F, two texels per body: [linear r, g, b, opacity] and
//               [up x, y, z, printed]. Colors are converted from sRGB on the
//               CPU, so the fragment shader lights and mixes in linear space.
//
// Clip planes: up to 3 uniforms (normal, offset) in model-relative
// coordinates; a fragment with dot(n, p) > offset is discarded (the same
// half-space the picker skips).
export const STATE_TEXTURE_WIDTH = 1024;
export const STATE_HOVER = 1;
export const STATE_SELECTED = 2;
export const NO_ENTITY = 0xffffffff;
export const MAX_CLIP_PLANES = 3;

export const ATTRIBUTES = Object.freeze({ position: 0, normal: 1, entity: 2 });
// Line program: per-instance segment end points and edge id.
export const LINE_ATTRIBUTES = Object.freeze({ pointA: 0, pointB: 1, edge: 2 });

// Edge class codes (src/viewer/edge-classes.mjs, draw payload edgeClass).
export const EDGE_CLASS = Object.freeze({
  sharp: 0, tangent: 1, seam: 2, subdivision: 3, unresolved: 4,
});
export const OUTLINE_BED = 1;
export const OUTLINE_EXEMPT = 2;

// Per-face overhang flag codes (face state bits 2-4).
export const OVERHANG = Object.freeze({
  none: 0, ok: 1, overhang: 2, bed: 3, exempt: 4, curved: 5, unsupported: 6,
});

// Line passes.
export const PASS = Object.freeze({ base: 0, soft: 1, accent: 2, layer: 3, hidden: 4 });

// Lighting constants (linear-space factors). Chosen so that every shade of
// the viewer palette keeps >= 4.5:1 against the edge color and the three
// principal iso faces differ by >= 1.3:1 (test/viewer-render-look.test.mjs).
const unit = vector => {
  const length = Math.hypot(...vector);
  return Object.freeze(vector.map(value => value / length));
};
export const LIGHTING = Object.freeze({
  sky: 0.77,
  ground: 0.57,
  key: 0.58,
  keyDirection: unit([-0.40, 0.54, 0.74]),
  fill: 0.12,
  fillDirection: unit([0.08, 0.31, 0.95]),
  specular: 0.05,
  shininess: 40,
});

// Colors are sRGB 0..1. Face is the pre-foundation face color (the first
// viewer palette color); hover is a warm tint with CIE76 dE >= 20 against it,
// selection keeps today's orange.
export const COLORS = Object.freeze({
  face: [0.65, 0.76, 0.66],
  edge: [0x1d / 255, 0x27 / 255, 0x21 / 255],
  hover: [0.98, 0.78, 0.26],
  hoverMix: 0.6,
  hoverEdge: [0.84, 0.52, 0.02],
  select: [0.80, 0.55, 0.35],
  selectEdge: [0.78, 0.40, 0.10],
  overhang: [0.90, 0.22, 0.28],
  overhangMix: 0.6,
  bed: [0.05, 0.47, 0.62],
  exempt: [0.45, 0.30, 0.70],
});

// Edge look: widths in CSS px, opacity per class and pass.
export const EDGE_LOOK = Object.freeze({
  widthPx: 1.5,
  minWidthPx: 1,
  maxWidthPx: 3,
  accentWidthPx: 2.5,
  biasPx: 1,
  tangentAlpha: 0.45,
  dimmedAlpha: 0.3,
  hiddenAlpha: 0.22,
});
// Per-body rank depth offset (CSS px of view depth toward the eye) against
// coplanar z-fighting: rank = body index mod RANK_LEVELS.
export const RANK_PX = 0.05;
export const RANK_LEVELS = 8;

const float = value => {
  const text = String(value);
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
};
const vec3 = values => `vec3(${values.map(float).join(', ')})`;

// Shared GLSL: depth bias toward the eye and the clip-plane test.
const BIAS_GLSL = `
uniform vec3 toward;
uniform vec3 eye;
uniform bool perspective;
uniform float eyeDistance;
uniform float mmPerPx;

vec3 towardEye(vec3 p) {
  return perspective ? normalize(eye - p) : toward;
}

// mm of view depth per CSS px at p (orthographic: everywhere the same).
float pxAt(vec3 p) {
  return perspective ? mmPerPx * max(dot(eye - p, toward), 1e-6) / eyeDistance : mmPerPx;
}`;

const CLIP_GLSL = `
uniform int clipCount;
uniform highp vec4 clipPlanes[${MAX_CLIP_PLANES}];

bool clipped(highp vec3 p) {
  for (int i = 0; i < ${MAX_CLIP_PLANES}; i++) {
    if (i < clipCount && dot(clipPlanes[i].xyz, p) > clipPlanes[i].w) return true;
  }
  return false;
}`;

const TEXEL_GLSL = `
ivec2 texel(uint index) {
  int i = int(index);
  return ivec2(i & ${STATE_TEXTURE_WIDTH - 1}, i >> 10);
}`;

export const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec3 position;
layout(location = 1) in vec2 normal;
layout(location = 2) in uint entity;
uniform mat4 viewProjection;
uniform mat3 normalMatrix;
uniform highp usampler2D states;
uniform highp usampler2D entityBody;
uniform highp sampler2D bodyStyles;
uniform bool useStates;
uniform bool useBodies;
uniform float pointSize;
uniform float rankPx;
uniform bool overhangEnabled;
${BIAS_GLSL}
out vec3 viewNormal;
out vec3 worldNormal;
out vec3 relative;
flat out uint state;
flat out vec4 bodyColor;
flat out vec4 bodyUp;
${TEXEL_GLSL}

vec3 octDecode(vec2 e) {
  vec3 v = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  if (v.z < 0.0) {
    vec2 signs = vec2(v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0);
    v.xy = (1.0 - abs(v.yx)) * signs;
  }
  return normalize(v);
}

void main() {
  state = 0u;
  uint body = 0u;
  bool known = entity != ${NO_ENTITY}u;
  if (useStates && known) state = texelFetch(states, texel(entity), 0).r;
  if (useBodies && known) body = texelFetch(entityBody, texel(entity), 0).r;
  bodyColor = texelFetch(bodyStyles, texel(body * 2u), 0);
  bodyUp = overhangEnabled ? texelFetch(bodyStyles, texel(body * 2u + 1u), 0) : vec4(0.0);
  vec3 p = position;
  float rank = float(body % ${RANK_LEVELS}u);
  if (useBodies) p += towardEye(p) * (rank * rankPx * pxAt(p));
  relative = position;
  gl_Position = viewProjection * vec4(p, 1.0);
  worldNormal = octDecode(normal);
  viewNormal = normalMatrix * worldNormal;
  gl_PointSize = pointSize;
}`;

export const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform vec3 color;
uniform bool useBodyColor;
uniform float alpha;
uniform vec3 hoverColor;
uniform vec3 selectColor;
uniform float hoverMix;
uniform bool hoverEnabled;
uniform bool highlightOnly;
uniform bool unlit;
uniform bool pointPass;
uniform bool overhangEnabled;
uniform float overhangSin;
uniform vec3 overhangColor;
uniform float overhangMix;
${CLIP_GLSL}
in vec3 viewNormal;
in vec3 worldNormal;
in highp vec3 relative;
flat in uint state;
flat in vec4 bodyColor;
flat in vec4 bodyUp;
out vec4 fragColor;

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 shade(vec3 albedo, vec3 n, vec3 nv) {
  float hemi = ${float(LIGHTING.ground)} + ${float(LIGHTING.sky - LIGHTING.ground)}
    * (0.5 + 0.5 * n.z);
  vec3 key = ${vec3(LIGHTING.keyDirection)};
  vec3 fill = ${vec3(LIGHTING.fillDirection)};
  float diffuse = hemi + ${float(LIGHTING.key)} * max(dot(nv, key), 0.0)
    + ${float(LIGHTING.fill)} * max(dot(nv, fill), 0.0);
  vec3 halfway = normalize(key + vec3(0.0, 0.0, 1.0));
  float specular = ${float(LIGHTING.specular)}
    * pow(max(dot(nv, halfway), 0.0), ${float(LIGHTING.shininess)});
  return albedo * diffuse + specular;
}

void main() {
  if (clipped(relative)) discard;
  if (pointPass && length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
  bool selected = (state & 2u) != 0u;
  bool hovered = hoverEnabled && (state & 1u) != 0u;
  if (highlightOnly && !selected && !hovered) discard;
  vec3 n = normalize(worldNormal);
  vec3 nv = normalize(viewNormal);
  if (!gl_FrontFacing) {
    n = -n;
    nv = -nv;
  }
  vec3 base = useBodyColor ? bodyColor.rgb : color;
  float opacity = alpha * (useBodyColor ? bodyColor.a : 1.0);
  uint flag = (state >> 2) & 7u;
  if (overhangEnabled && bodyUp.w > 0.5) {
    bool planar = flag == ${OVERHANG.overhang}u;
    bool curved = flag == ${OVERHANG.curved}u && dot(-n, bodyUp.xyz) > overhangSin;
    if (planar || curved) base = mix(base, overhangColor, overhangMix);
  }
  base = selected ? selectColor : hovered ? mix(base, hoverColor, hoverMix) : base;
  vec3 lit = unlit ? base : shade(base, n, nv);
  fragColor = vec4(toSrgb(lit), opacity);
}`;

export const UNIFORMS = Object.freeze([
  'viewProjection', 'normalMatrix', 'states', 'entityBody', 'bodyStyles', 'useStates',
  'useBodies', 'pointSize', 'rankPx', 'toward', 'eye', 'perspective', 'eyeDistance', 'mmPerPx',
  'color', 'useBodyColor', 'alpha', 'hoverColor', 'selectColor', 'hoverMix', 'hoverEnabled',
  'highlightOnly', 'unlit', 'pointPass', 'overhangEnabled', 'overhangSin', 'overhangColor',
  'overhangMix', 'clipCount', 'clipPlanes',
]);

export const LINE_VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec3 pointA;
layout(location = 1) in vec3 pointB;
layout(location = 2) in uint edge;
uniform mat4 viewProjection;
uniform vec2 viewport;
uniform highp usampler2D states;
uniform bool useStates;
uniform int pass;
uniform float classAlpha[5];
uniform bool hoverEnabled;
uniform float widthPx;
uniform float accentWidthPx;
uniform float biasPx;
uniform vec4 lineColor;
uniform vec3 edgeColor;
uniform vec3 hoverColor;
uniform vec3 selectColor;
uniform vec3 bedColor;
uniform vec3 exemptColor;
${BIAS_GLSL}
out vec3 relative;
flat out vec4 color;
${TEXEL_GLSL}

vec4 clipOf(vec3 p) {
  return viewProjection * vec4(p + towardEye(p) * (biasPx * pxAt(p)), 1.0);
}

void main() {
  uint state = useStates && edge != ${NO_ENTITY}u ? texelFetch(states, texel(edge), 0).r : 0u;
  uint kind = (state >> 2) & 7u;
  uint outline = (state >> 5) & 3u;
  bool hovered = hoverEnabled && (state & 1u) != 0u;
  bool selected = (state & 2u) != 0u;
  bool accent = hovered || selected || outline != 0u;
  float width = widthPx;
  color = vec4(edgeColor, 0.0);
  if (pass == ${PASS.layer}) {
    color = lineColor;
  } else if (pass == ${PASS.accent}) {
    if (accent) {
      vec3 rgb = selected ? selectColor : hovered ? hoverColor
        : outline == ${OUTLINE_BED}u ? bedColor : exemptColor;
      color = vec4(rgb, 1.0);
      width = accentWidthPx;
    }
  } else if (!accent) {
    color.a = classAlpha[int(min(kind, 4u))];
  }
  relative = (gl_VertexID & 1) == 1 ? pointB : pointA;
  vec4 a = clipOf(pointA);
  vec4 b = clipOf(pointB);
  if (color.a <= 0.0 || a.w <= 0.0 || b.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 halfViewport = viewport * 0.5;
  vec2 d = b.xy / b.w * halfViewport - a.xy / a.w * halfViewport;
  float length2 = dot(d, d);
  vec2 direction = length2 > 1e-12 ? d * inversesqrt(length2) : vec2(1.0, 0.0);
  vec2 across = vec2(-direction.y, direction.x);
  bool atB = (gl_VertexID & 1) == 1;
  float side = (gl_VertexID & 2) == 2 ? 1.0 : -1.0;
  float halfWidth = 0.5 * width;
  vec2 offset = across * side * halfWidth
    + direction * (atB ? halfWidth : -halfWidth);
  vec4 corner = atB ? b : a;
  gl_Position = corner + vec4(offset / halfViewport * corner.w, 0.0, 0.0);
}`;

export const LINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
${CLIP_GLSL}
in vec3 relative;
flat in vec4 color;
out vec4 fragColor;

void main() {
  if (clipped(relative)) discard;
  fragColor = color;
}`;

export const LINE_UNIFORMS = Object.freeze([
  'viewProjection', 'viewport', 'states', 'useStates', 'pass', 'classAlpha', 'hoverEnabled',
  'widthPx', 'accentWidthPx', 'biasPx', 'lineColor', 'edgeColor', 'hoverColor', 'selectColor',
  'bedColor', 'exemptColor', 'toward', 'eye', 'perspective', 'eyeDistance', 'mmPerPx',
  'clipCount', 'clipPlanes',
]);

// ---- JS mirror of the lighting (tests, docs, legend) ----

export const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = c => {
  const value = Math.min(1, Math.max(0, c));
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
};
// WCAG relative luminance of a linear RGB color.
export const luminance = linear => 0.2126 * linear[0] + 0.7152 * linear[1]
  + 0.0722 * linear[2];
export const contrastRatio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Linear RGB of an sRGB albedo lit with the shader's model: `normal` in
// world coordinates, `viewNormal` in view coordinates (x right, y up, z toward
// the eye), both on the lit side. Clamped like the framebuffer.
export function shadeLinear(albedo, normal, viewNormal) {
  const hemi = LIGHTING.ground + (LIGHTING.sky - LIGHTING.ground) * (0.5 + 0.5 * normal[2]);
  const diffuse = hemi + LIGHTING.key * Math.max(0, dot3(viewNormal, LIGHTING.keyDirection))
    + LIGHTING.fill * Math.max(0, dot3(viewNormal, LIGHTING.fillDirection));
  const halfway = unit([LIGHTING.keyDirection[0], LIGHTING.keyDirection[1],
    LIGHTING.keyDirection[2] + 1]);
  const specular = LIGHTING.specular * Math.max(0, dot3(viewNormal, halfway))
    ** LIGHTING.shininess;
  return albedo.map(channel => Math.min(1, srgbToLinear(channel) * diffuse + specular));
}
