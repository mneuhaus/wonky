#!/usr/bin/env node
// Rendering audit: throwaway measurement of two picking strategies against the
// viewer's current CPU pick, on the same scenes and camera, inside a real
// browser. Nothing here ships; it only produces numbers for docs/viewer/audit-rendering.md.
//
//  A. GPU ID buffer (WebGL2, separate canvas): face IDs packed into RGBA8,
//     positions uploaded relative to the scene center (float64 subtraction on
//     the CPU), scissored to the 1 px under the cursor, then readPixels.
//  B. Typed-array CPU pick: project every vertex once per camera into a
//     Float32Array, then test triangles with a screen-space bounding-box reject.
//
// node scripts/viewer/audit-pick-prototype.mjs --url http://127.0.0.1:4347/viewer/ --models id,id --out out/viewer/audit-rendering
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { probe } from './audit-probe.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const url = option('--url', 'http://127.0.0.1:4347/viewer/');
const out = option('--out', 'out/viewer/audit-rendering');
const models = option('--models', '').split(',').filter(Boolean);
const { chromium } = await import(option('--playwright', join(homedir(), '.dev-browser/node_modules/playwright-core/index.mjs')));

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2 });
await context.route('**/viewer/app.js', async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: (await response.text()) + probe, headers: { ...response.headers(), 'content-type': 'text/javascript; charset=utf-8' } });
});
const page = await context.newPage();
await page.goto(url);
await page.waitForFunction(() => window.__audit && !window.__audit.state.loading && window.__audit.state.workspace.models.length > 0, null, { timeout: 120000 });

const results = [];
for (const id of models) {
  await page.evaluate(id => window.__audit.open(id, { cold: false }), id);
  await page.evaluate(() => window.__audit.setCamera({ yaw: -.65, pitch: -.55, zoom: 1, pan: [0, 0] }));
  await page.evaluate(() => window.__audit.frames(3));
  const row = await page.evaluate(async () => {
    const a = window.__audit, st = a.state, scene = st.scenes.get(st.after), canvas = document.querySelector('#model-canvas');
    const ratio = canvas.width / canvas.clientWidth, W = canvas.width, H = canvas.height, cw = canvas.clientWidth, ch = canvas.clientHeight;
    const points = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) points.push([cw * (0.2 + 0.6 * (c + 0.5) / 12), ch * (0.2 + 0.6 * (r + 0.5) / 8)]);
    const stats = values => { const s = [...values].sort((x, y) => x - y); return { p50: +s[Math.floor(s.length / 2)].toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3), max: +s.at(-1).toFixed(3) }; };

    // Current viewer pick in face mode (reference result + timing).
    const reference = points.map(([x, y]) => { const t0 = performance.now(); const hit = a.pick(x, y, 'face'); return { ms: performance.now() - t0, key: hit ? `${hit.bodyId}#${hit.entityIndex}` : null }; });

    // Shared flattened arrays.
    let t0 = performance.now();
    let triangles = 0; for (const body of scene.bodies) for (const face of body.faces) triangles += face.triangles.length;
    const positions = new Float32Array(triangles * 9), colors = new Uint8Array(triangles * 12), owner = new Uint32Array(triangles), faceKeys = [];
    const [cx, cy, cz] = st.center;
    let p = 0, q = 0, t = 0;
    for (const body of scene.bodies) for (const face of body.faces) {
      const faceId = faceKeys.push(`${body.id}#${face.index}`);
      for (const triangle of face.triangles) {
        owner[t++] = faceId;
        for (const point of triangle.points) { positions[p++] = point[0] - cx; positions[p++] = point[1] - cy; positions[p++] = point[2] - cz; colors[q++] = faceId & 255; colors[q++] = (faceId >> 8) & 255; colors[q++] = (faceId >> 16) & 255; colors[q++] = 255; }
      }
    }
    const flattenMs = performance.now() - t0;

    // A. GPU ID buffer.
    const idCanvas = document.createElement('canvas'); idCanvas.width = W; idCanvas.height = H;
    const gl = idCanvas.getContext('webgl2', { antialias: false });
    const compile = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, `#version 300 es
      in vec3 position; in vec4 id; uniform float extent; uniform vec2 scale, angles, pan; flat out vec4 vid;
      vec3 view(vec3 p){float c=cos(angles.x),s=sin(angles.x);float a=p.x*c-p.y*s,b=p.x*s+p.y*c;return vec3(a,b*sin(angles.y)+p.z*cos(angles.y),b*cos(angles.y)-p.z*sin(angles.y));}
      void main(){vec3 p=view(position);gl_Position=vec4((p.xy+pan*extent)*scale,-p.z/(extent*6.0),1.0);vid=id;}`));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; flat in vec4 vid; out vec4 color; void main(){color=vid;}`));
    gl.linkProgram(program); gl.useProgram(program);
    t0 = performance.now();
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const pl = gl.getAttribLocation(program, 'position'); gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 3, gl.FLOAT, false, 0, 0);
    const cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    const cl = gl.getAttribLocation(program, 'id'); gl.enableVertexAttribArray(cl); gl.vertexAttribPointer(cl, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    const uploadMs = performance.now() - t0;
    const factor = a.cameraFactor();
    const u = name => gl.getUniformLocation(program, name);
    gl.uniform1f(u('extent'), st.extent); gl.uniform2f(u('scale'), 2 * factor / cw, 2 * factor / ch);
    gl.uniform2f(u('angles'), st.camera.yaw, st.camera.pitch); gl.uniform2fv(u('pan'), st.camera.pan);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.SCISSOR_TEST); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0);
    const pixel = new Uint8Array(4);
    const gpuPick = ([x, y]) => {
      const px = Math.floor(x * ratio), py = Math.floor(H - y * ratio - 1);
      gl.scissor(px, py, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, triangles * 3);
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const faceId = pixel[0] | (pixel[1] << 8) | (pixel[2] << 16);
      return faceId ? faceKeys[faceId - 1] : null;
    };
    gpuPick(points[0]);
    const gpu = points.map(point => { const t1 = performance.now(); const key = gpuPick(point); return { ms: performance.now() - t1, key }; });
    // Full-frame ID render once per camera, then 13x13 reads (edge/vertex tolerance window).
    gl.disable(gl.SCISSOR_TEST);
    let t2 = performance.now(); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, triangles * 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const fullFrameMs = performance.now() - t2;
    const window13 = new Uint8Array(13 * 13 * 4);
    const windowReads = points.map(([x, y]) => { const t3 = performance.now(); gl.readPixels(Math.floor(x * ratio) - 6, Math.floor(H - y * ratio - 1) - 6, 13, 13, gl.RGBA, gl.UNSIGNED_BYTE, window13); return performance.now() - t3; });

    // B. Typed-array CPU pick.
    t0 = performance.now();
    const { yaw, pitch, pan } = st.camera, c = Math.cos(yaw), s = Math.sin(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    const n = triangles * 3, sx = new Float32Array(n), sy = new Float32Array(n), sd = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const x = positions[j], y = positions[j + 1], z = positions[j + 2], aa = x * c - y * s, bb = x * s + y * c;
      sx[i] = cw / 2 + (aa + pan[0] * st.extent) * factor; sy[i] = ch / 2 - (bb * sp + z * cp + pan[1] * st.extent) * factor; sd[i] = bb * cp - z * sp;
    }
    const projectMs = performance.now() - t0;
    const cpuPick = ([x, y]) => {
      let best = -Infinity, key = null;
      for (let tri = 0, i = 0; tri < triangles; tri++, i += 3) {
        const ax = sx[i], bx = sx[i + 1], cx2 = sx[i + 2];
        if ((x < ax && x < bx && x < cx2) || (x > ax && x > bx && x > cx2)) continue;
        const ay = sy[i], by = sy[i + 1], cy2 = sy[i + 2];
        if ((y < ay && y < by && y < cy2) || (y > ay && y > by && y > cy2)) continue;
        const den = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2);
        if (Math.abs(den) < 1e-10) continue;
        const w0 = ((by - cy2) * (x - cx2) + (cx2 - bx) * (y - cy2)) / den, w1 = ((cy2 - ay) * (x - cx2) + (ax - cx2) * (y - cy2)) / den, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const depth = sd[i] * w0 + sd[i + 1] * w1 + sd[i + 2] * w2;
        if (depth > best) { best = depth; key = faceKeys[owner[tri] - 1]; }
      }
      return key;
    };
    const cpu = points.map(point => { const t1 = performance.now(); const key = cpuPick(point); return { ms: performance.now() - t1, key }; });
    const agree = list => list.filter((r, i) => r.key === reference[i].key).length;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { label: scene.label, triangles, points: points.length, current: stats(reference.map(r => r.ms)),
      flattenMs: +flattenMs.toFixed(2), gpu: { uploadMs: +uploadMs.toFixed(2), scissoredPick: stats(gpu.map(r => r.ms)), agreeWithCurrent: agree(gpu), fullFrameIdRenderMs: +fullFrameMs.toFixed(3), window13Read: stats(windowReads) },
      cpuTyped: { projectPerCameraMs: +projectMs.toFixed(2), pick: stats(cpu.map(r => r.ms)), agreeWithCurrent: agree(cpu) }, hits: reference.filter(r => r.key).length };
  });
  console.log(JSON.stringify(row));
  results.push(row);
}
await writeFile(join(out, 'pick-prototype.json'), JSON.stringify({ schema: 'wonky.viewer-audit.pick-prototype/1', measuredAt: new Date().toISOString(), results }, null, 2) + '\n');
await browser.close();
