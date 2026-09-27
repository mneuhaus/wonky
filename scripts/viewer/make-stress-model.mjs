#!/usr/bin/env node
// Rendering-audit stress input. Copies every body of a real wonky-brep/1 model
// onto a grid (or translates it far from the origin) by rigid translation of
// vertices, surface origins and curve origins. Nothing is re-modelled: the
// display pipeline (review-scene / display-cylinder) still tessellates every
// copy from its analytic data. Identity/debug metadata is dropped from copies
// because its geometry revision hash would be stale after translation; the
// output is labelled synthetic and must never be used as a kernel result.
//
// node scripts/viewer/make-stress-model.mjs <in.brep.json> <out.brep.json> --grid 4x4 [--spacing 300]
// node scripts/viewer/make-stress-model.mjs <in.brep.json> <out.brep.json> --offset 20000,20000,0
import { readFile, writeFile } from 'node:fs/promises';

const [input, output, ...rest] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: make-stress-model.mjs in.brep.json out.brep.json --grid NxM | --offset x,y,z');
const option = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const model = JSON.parse(await readFile(input, 'utf8'));
if (model.schema !== 'wonky-brep/1') throw new Error('Expected wonky-brep/1');

const move = (point, offset) => point.map((value, axis) => value + offset[axis]);
function translated(body, offset, suffix) {
  const copy = structuredClone(body);
  copy.id = `${body.id}${suffix}`;
  if (copy.name) copy.name = `${copy.name}${suffix}`;
  delete copy.identity; delete copy.debug; delete copy.operationHistory;
  copy.vertices = copy.vertices.map(point => move(point, offset));
  for (const edge of copy.edges) if (edge.curve && typeof edge.curve === 'object' && edge.curve.origin) edge.curve.origin = move(edge.curve.origin, offset);
  for (const face of copy.faces) if (face.surface?.origin) face.surface.origin = move(face.surface.origin, offset);
  if (copy.validation?.boundsMm) copy.validation.boundsMm = { min: move(copy.validation.boundsMm.min, offset), max: move(copy.validation.boundsMm.max, offset) };
  return copy;
}

let bodies;
if (option('--grid')) {
  const [columns, rows] = option('--grid').split('x').map(Number);
  const spacing = Number(option('--spacing') ?? 300);
  bodies = [];
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    for (const body of model.bodies) bodies.push(translated(body, [column * spacing, row * spacing, 0], ` #${row * columns + column + 1}`));
  }
} else if (option('--offset')) {
  const offset = option('--offset').split(',').map(Number);
  bodies = model.bodies.map(body => translated(body, offset, ' (far)'));
} else throw new Error('Pass --grid NxM or --offset x,y,z');

const result = { schema: model.schema, units: model.units, backend: model.backend,
  synthetic: { purpose: 'Viewer rendering audit stress input; rigid translations of real bodies, not a kernel result', from: input, options: rest },
  bodies };
await writeFile(output, JSON.stringify(result));
console.log(`${output}: ${bodies.length} bodies, ${bodies.reduce((n, b) => n + b.faces.length, 0)} faces`);
