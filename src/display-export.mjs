import { createHash } from 'node:crypto';
import { createGeometryInspector } from './geometry-summary.mjs';
import { reviewScene } from './review-scene.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a.reduce((sum, v, i) => sum + v*b[i], 0);
const finitePoint = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const words = point => point.map(value => value.toPrecision(17)).join(' ');

// An export of the existing approximate display triangles, never an alternate
// modeling path or manufacturing mesh. Winding/normal normalization below is
// display serialization only; analytic geometry is neither built nor changed.
export async function displayMesh(modelBytes, { toleranceMm = 0.02 } = {}) {
  const bytes = Buffer.from(modelBytes), modelSha256 = hash(bytes), model = JSON.parse(bytes);
  if (model.schema !== 'wonky-brep/1' || model.units !== 'millimeter' || !model.bodies?.length) {
    throw new Error('Display export needs a nonempty millimeter wonky-brep/1 model');
  }
  createGeometryInspector(model, { modelBytes: bytes, modelId: modelSha256 });
  const scene = await reviewScene(model, { id: modelSha256, sha256: modelSha256 }, { toleranceMm });
  const missing = scene.bodies.flatMap(body => body.faces.filter(face => face.displayWarning || !face.triangles.length)
    .map(face => ({ body: body.id, face: face.index, reason: face.displayWarning ?? 'No display triangles' })));
  if (missing.length) throw new Error(`Display export incomplete: ${JSON.stringify(missing)}`);
  const facets = ['solid wonky_display_only'], faces = [];
  let triangleCount = 0;
  for (const body of scene.bodies) for (const face of body.faces) {
    const firstTriangle = triangleCount;
    for (const triangle of face.triangles) {
      const points = triangle.points?.map(p => [...p]);
      if (points?.length !== 3 || !points.every(finitePoint) || !finitePoint(triangle.normal)) throw new Error('Invalid display triangle');
      let normal = cross(sub(points[1], points[0]), sub(points[2], points[0]));
      const length = Math.hypot(...normal);
      if (!Number.isFinite(length) || length === 0 || Math.hypot(...triangle.normal) === 0) throw new Error('Degenerate display triangle');
      if (dot(normal, triangle.normal) < 0) {
        [points[1], points[2]] = [points[2], points[1]];
        normal = normal.map(v => -v);
      }
      normal = normal.map(v => v / length);
      facets.push(`  facet normal ${words(normal)}`, '    outer loop',
        ...points.map(p => `      vertex ${words(p)}`), '    endloop', '  endfacet');
      triangleCount++;
    }
    faces.push({ bodyId: body.id, faceIndex: face.index, surfaceType: face.surfaceType,
      firstTriangle, triangleCount: triangleCount-firstTriangle,
      ...(face.identity ? { identity: face.identity } : {}),
      ...(face.displayTessellation ? { displayTessellation: face.displayTessellation } : {}) });
  }
  facets.push('endsolid wonky_display_only');
  const stl = facets.join('\n') + '\n';
  return { stl, manifest: { schema: 'wonky.display-mesh/1', purpose: 'Approximate display only; not modeling or manufacturing geometry',
    modelSha256, meshSha256: hash(stl), toleranceMm, triangleCount,
    bodyCount: scene.bodies.length, faceCount: faces.length, omittedFaces: 0, faces,
    limits: ['The analytic B-rep remains authoritative', 'Display tessellation is not a watertight manufacturing-mesh guarantee',
      'Tolerance and source allowances follow the existing review-scene/display-cylinder contract'] } };
}
