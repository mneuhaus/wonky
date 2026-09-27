#!/usr/bin/env node
// Rendering audit: estimated size of an indexed binary display payload
// (f32 positions, oct16 normals, u32 face ids, u32 indices, edge points) versus
// the current non-indexed Float32 buffers. node scripts/viewer/audit-indexed-size.mjs a.brep.json ...
import { readFile } from 'node:fs/promises';
import { reviewScene } from '../../src/review-scene.mjs';
for (const path of process.argv.slice(2)) {
  const scene = await reviewScene(JSON.parse(await readFile(path, 'utf8')), { id: 'x' });
  let triangles = 0, vertices = 0, segments = 0, edgePoints = 0, seamEdges = 0;
  for (const body of scene.bodies) {
    for (const face of body.faces) {
      const unique = new Set(); for (const t of face.triangles) for (const p of t.points) unique.add(p.join(','));
      triangles += face.triangles.length; vertices += unique.size;
      seamEdges += face.displayTessellation?.seamEdges?.length ?? 0;
    }
    for (const edge of body.edges) { segments += edge.points.length - 1; edgePoints += edge.points.length; }
  }
  // positions f32x3 (12) + oct normal i16x2 (4) + face id u32 (4) per vertex, u32 index per corner, edge points f32x3 + u32 edge id per point
  const indexed = vertices * 20 + triangles * 3 * 4 + edgePoints * 16;
  const current = triangles * 3 * 24 + segments * 2 * 24;
  console.log(JSON.stringify({ path, triangles, indexedVertices: vertices, cornersPerVertex: +(triangles * 3 / vertices).toFixed(2), segments, edgePoints, seamEdges, currentGpuBytes: current, indexedBinaryBytes: indexed }));
}
