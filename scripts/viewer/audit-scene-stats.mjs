#!/usr/bin/env node
// Rendering audit helper: measures what the review server would send to the
// browser for each model (display triangles, edge polyline segments, payload
// sizes) and how long server-side display preparation takes. Read-only: it
// calls reviewScene() exactly like src/review-server.mjs and writes nothing
// except the optional JSON report given with --out.
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { reviewScene } from '../../src/review-scene.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args.splice(outIndex, 2)[1] : null;
const rows = [];
for (const path of args) {
  const bytes = await readFile(path);
  const model = JSON.parse(bytes);
  const started = performance.now();
  const scene = await reviewScene(model, { id: 'audit', label: path });
  const prepareMs = performance.now() - started;
  const pretty = JSON.stringify(scene, null, 2) + '\n';
  const compact = JSON.stringify(scene);
  // Strip everything the renderer does not need to draw: identity, source,
  // debug, sourceMap. Shows how much of the payload is metadata.
  const drawOnly = JSON.stringify({ bounds: scene.bounds, bodies: scene.bodies.map(body => ({
    id: body.id,
    faces: body.faces.map(face => ({ index: face.index, triangles: face.triangles })),
    edges: body.edges.map(edge => ({ index: edge.index, points: edge.points })),
    vertices: body.vertices.map(vertex => vertex.point),
  })) });
  let triangles = 0, segments = 0, warnings = 0, faces = 0, edges = 0, vertices = 0;
  for (const body of scene.bodies) {
    faces += body.faces.length; edges += body.edges.length; vertices += body.vertices.length;
    for (const face of body.faces) { triangles += face.triangles.length; if (face.displayWarning) warnings++; }
    for (const edge of body.edges) segments += Math.max(0, edge.points.length - 1);
  }
  const binaryBytes = triangles * 3 * 24 + segments * 2 * 24; // current interleaved Float32 layout
  rows.push({
    path, sourceBytes: bytes.length, bodies: scene.bodies.length, faces, edges, vertices,
    boundaryOnlyFaces: warnings, triangles, edgeSegments: segments,
    prepareMs: Math.round(prepareMs),
    sceneJsonPrettyBytes: Buffer.byteLength(pretty), sceneJsonCompactBytes: Buffer.byteLength(compact),
    sceneJsonGzipBytes: gzipSync(pretty).length, drawOnlyJsonBytes: Buffer.byteLength(drawOnly),
    gpuVertexBytes: binaryBytes,
    extent: Math.max(...scene.bounds.max.map((v, i) => v - scene.bounds.min[i])),
    maxAbsCoordinate: Math.max(...scene.bounds.max.map(Math.abs), ...scene.bounds.min.map(Math.abs)),
  });
  console.log(JSON.stringify(rows.at(-1)));
}
if (out) await writeFile(out, JSON.stringify({ schema: 'wonky.viewer-audit.scene-stats/1', measuredAt: new Date().toISOString(), rows }, null, 2) + '\n');
