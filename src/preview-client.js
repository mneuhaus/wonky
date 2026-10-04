// Embedded into the standalone HTML by preview.mjs. `bodies` contains numeric
// geometry only. WebGL's depth buffer hides occluded faces and shared edges.
const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl', { antialias: true });
if (!gl) {
  document.querySelector('.hint').textContent = 'WebGL is unavailable. Open the accompanying STEP file in your CAD application.';
  throw new Error('WebGL is unavailable');
}
const vertexSource = `
attribute vec3 position;
attribute vec3 normal;
uniform vec3 center;
uniform float extent;
uniform vec2 scale;
uniform mat3 viewRotation;
varying vec3 shadeNormal;
void main() {
  vec3 p = viewRotation * (position - center);
  gl_Position = vec4(p.xy * scale, -p.z / (extent * 3.0), 1.0);
  shadeNormal = viewRotation * normal;
}`;
const fragmentSource = `
precision mediump float;
uniform bool edgePass;
varying vec3 shadeNormal;
void main() {
  if (edgePass) { gl_FragColor = vec4(0.12, 0.28, 0.22, 1.0); }
  else {
    vec3 n = normalize(shadeNormal);
    float light = 0.65 + 0.35 * abs(dot(n, normalize(vec3(-0.3, 0.5, 0.8))));
    gl_FragColor = vec4(vec3(0.48, 0.71, 0.61) * light, 1.0);
  }
}`;
function shader(type, source) {
  const value = gl.createShader(type);
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
  return value;
}
const program = gl.createProgram();
gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
gl.useProgram(program);
const uniforms = Object.fromEntries(['center', 'extent', 'scale', 'viewRotation', 'edgePass'].map(name => [name, gl.getUniformLocation(program, name)]));
const position = gl.getAttribLocation(program, 'position'), normal = gl.getAttribLocation(program, 'normal');
const all = bodies.flatMap(b => b.vertices);
const min = [0, 1, 2].map(k => Math.min(...all.map(p => p[k]))), max = [0, 1, 2].map(k => Math.max(...all.map(p => p[k])));
const center = min.map((v, i) => (v + max[i]) / 2), extent = Math.max(...max.map((v, i) => v - min[i]));
gl.uniform3fv(uniforms.center, center);
gl.uniform1f(uniforms.extent, extent);
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);
function buffer(data) {
  const value = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, value);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  return { value, count: data.length / 6 };
}
const triangles = buffer(bodies.flatMap(body => body.triangles.flatMap(t => t.vertices.flatMap(i => [...body.vertices[i], ...t.normal]))));
const edges = buffer(bodies.flatMap(body => body.edges.flatMap(edge => edge.flatMap(i => [...body.vertices[i], 0, 0, 0]))));
function renderBuffer(buffer, mode) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer.value);
  gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(normal);
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 24, 12);
  gl.drawArrays(mode, 0, buffer.count);
}
// Same convention-2 rotation as the live viewer: right × up = toward (det +1),
// world +Z up, default Iso eye at (+X, -Y, +Z), above the front (-Y) side.
// Top is yaw=π, pitch=-π/2: +X right, +Y up, +Z toward the eye.
// Only the clip-depth mapping negates Z (nearer = smaller WebGL depth).
let [yaw, pitch] = previewCamera.iso;
let zoom = 1, showEdges = true, drag = null;
function draw() {
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(242 / 255, 241 / 255, 235 / 255, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const factor = Math.min(w, h) * 0.57 / extent * zoom;
  gl.uniform2f(uniforms.scale, 2 * factor / w, 2 * factor / h);
  gl.uniformMatrix3fv(uniforms.viewRotation, false, new Float32Array(previewCamera.normalMatrix({ yaw, pitch })));
  gl.uniform1i(uniforms.edgePass, 0);
  gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
  renderBuffer(triangles, gl.TRIANGLES);
  gl.disable(gl.POLYGON_OFFSET_FILL);
  if (showEdges) { gl.uniform1i(uniforms.edgePass, 1); renderBuffer(edges, gl.LINES); }
}
canvas.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  yaw += (e.clientX - drag[0]) * 0.008; pitch += (e.clientY - drag[1]) * 0.008;
  drag = [e.clientX, e.clientY]; draw();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { drag = null; });
canvas.addEventListener('wheel', e => {
  e.preventDefault(); zoom = Math.max(0.15, Math.min(8, zoom * Math.exp(-e.deltaY * 0.001))); draw();
}, { passive: false });
canvas.addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  if (e.key === 'ArrowLeft') yaw -= 0.12;
  if (e.key === 'ArrowRight') yaw += 0.12;
  if (e.key === 'ArrowUp') pitch -= 0.12;
  if (e.key === 'ArrowDown') pitch += 0.12;
  draw();
});
document.querySelector('#fit').onclick = () => { [yaw, pitch] = previewCamera.iso; zoom = 1; draw(); };
document.querySelector('#edges').onclick = e => { showEdges = !showEdges; e.target.setAttribute('aria-pressed', String(showEdges)); draw(); };
new ResizeObserver(draw).observe(canvas);
draw();

