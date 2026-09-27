#!/usr/bin/env node
// Deterministic, dependency-free comparison renderer. Geometry is never repaired,
// rescaled per engine or imported from a reference into Wonky. STL units are mm.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

export const SETTINGS = Object.freeze({ width: 480, height: 360, background: [238, 241, 243], material: [51, 127, 186], camera: [1, -1, 1], light: [0.3, -0.5, 1], margin: 26 });
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => a.map(v => v / Math.hypot(...a));
const eye = unit(SETTINGS.camera), right = unit([1, 1, 0]), up = cross(eye, right), light = unit(SETTINGS.light);
const project = p => [dot(p, right), dot(p, up), dot(p, eye)];

export function readStl(path) {
  const b = readFileSync(path), triangles = [];
  const n = b.length >= 84 ? b.readUInt32LE(80) : 0;
  if (b.length === 84 + n * 50) {
    for (let i = 0; i < n; i++) triangles.push(Array.from({ length: 3 }, (_, j) => Array.from({ length: 3 }, (_, k) => b.readFloatLE(84 + i * 50 + 12 + j * 12 + k * 4))));
  } else {
    const text = b.toString('utf8');
    if (!/^\s*solid\b/i.test(text)) throw new Error('Invalid binary/ASCII STL');
    const vertices = [...text.matchAll(/\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)].map(m => m.slice(1).map(Number));
    if (vertices.length % 3) throw new Error('Incomplete ASCII STL triangle');
    for (let i = 0; i < vertices.length; i += 3) triangles.push(vertices.slice(i, i + 3));
  }
  if (!triangles.length || triangles.some(t => t.some(p => p.some(v => !Number.isFinite(v))))) throw new Error('Empty or non-finite STL');
  return triangles;
}

export function meshMetrics(triangles) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles) for (const p of t) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
  const origin = min.map((v, k) => (v + max[k]) / 2);
  // Translation around the bbox center limits cancellation for off-origin parts.
  let sum = 0, compensation = 0;
  for (const t of triangles) {
    const [a, b, c] = t.map(p => sub(p, origin));
    const v = dot(a, cross(b, c)) / 6 - compensation, next = sum + v;
    compensation = (next - sum) - v; sum = next;
  }
  return { triangles: triangles.length, signedMeshVolumeMm3: sum, boundsMm: [min, max] };
}

export function fitCamera(meshes, settings = SETTINGS) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) for (const triangle of mesh) for (const p of triangle) {
    const q = project(p);
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
  }
  if (!Number.isFinite(lo[0])) throw new Error('Cannot fit camera to empty meshes');
  return { center: lo.map((v, i) => (v + hi[i]) / 2), scale: Math.min((settings.width - 2 * settings.margin) / Math.max(hi[0] - lo[0], 1e-9), (settings.height - 2 * settings.margin) / Math.max(hi[1] - lo[1], 1e-9)), projectedBounds: [lo, hi] };
}

// PNG RGB8, filter 0. No timestamp or machine-dependent metadata.
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function chunk(type, payload) {
  const data = Buffer.concat([Buffer.from(type), payload]); let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const out = Buffer.alloc(payload.length + 12); out.writeUInt32BE(payload.length, 0); data.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4); return out;
}
export function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const scan = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 3, width * 3).copy(scan, y * (width * 3 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scan, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function render(mesh, camera = fitCamera([mesh]), settings = SETTINGS) {
  const { width, height, background, material } = settings;
  const pixels = new Uint8Array(width * height * 3), depth = new Float64Array(width * height).fill(-Infinity);
  for (let i = 0; i < width * height; i++) pixels.set(background, i * 3);
  const edge = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  let drawnPixels = 0;
  for (const tri of mesh) {
    const pts = tri.map(p => { const q = project(p); return [width / 2 + (q[0] - camera.center[0]) * camera.scale, height / 2 - (q[1] - camera.center[1]) * camera.scale, q[2] - camera.center[2]]; });
    const [a, b, c] = pts, area = edge(a, b, c[0], c[1]);
    if (Math.abs(area) < 1e-12) continue;
    let normal = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
    const len = Math.hypot(...normal); if (len === 0) continue;
    normal = normal.map(v => v / len);
    const intensity = 0.40 + 0.60 * Math.max(0, dot(normal, light));
    const rgb = material.map(v => Math.round(v * intensity));
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[0])))), x1 = Math.min(width - 1, Math.ceil(Math.max(...pts.map(p => p[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p[1])))), y1 = Math.min(height - 1, Math.ceil(Math.max(...pts.map(p => p[1]))));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const wa = edge(b, c, x + 0.5, y + 0.5) / area, wb = edge(c, a, x + 0.5, y + 0.5) / area, wc = 1 - wa - wb;
      if (wa < -1e-10 || wb < -1e-10 || wc < -1e-10) continue;
      const z = wa * a[2] + wb * b[2] + wc * c[2], i = y * width + x;
      if (z > depth[i]) { if (!Number.isFinite(depth[i])) drawnPixels++; depth[i] = z; pixels.set(rgb, i * 3); }
    }
  }
  if (!drawnPixels) throw new Error('Mesh did not cover any image pixels');
  return { png: encodePng(width, height, pixels), drawnPixels, camera };
}

export function renderPair(referencePath, wonkyPath, referenceImage, wonkyImage) {
  const ref = readStl(referencePath), wonky = wonkyPath ? readStl(wonkyPath) : null;
  const camera = fitCamera(wonky ? [ref, wonky] : [ref]);
  const r = render(ref, camera); mkdirSync(dirname(referenceImage), { recursive: true }); writeFileSync(referenceImage, r.png);
  let w = null; if (wonky) { w = render(wonky, camera); mkdirSync(dirname(wonkyImage), { recursive: true }); writeFileSync(wonkyImage, w.png); }
  return { camera, reference: { ...meshMetrics(ref), bytes: r.png.length, drawnPixels: r.drawnPixels }, wonky: w ? { ...meshMetrics(wonky), bytes: w.png.length, drawnPixels: w.drawnPixels } : null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node scripts/reports/site/render.mjs input.stl output.png');
  const mesh = readStl(input), result = render(mesh); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, result.png);
  console.log(JSON.stringify({ ...meshMetrics(mesh), drawnPixels: result.drawnPixels }));
}
