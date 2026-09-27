#!/usr/bin/env node
// Rendering audit: time of exact kernel sections (src/section.mjs) per body at
// two mid planes, to size a section/cap feature. node scripts/viewer/audit-section-timing.mjs model.brep.json
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { sectionSolid } from '../../src/section.mjs';
const model = JSON.parse(await readFile(process.argv[2], 'utf8'));
for (const [label, plane] of [['z-mid', { origin: [0, 0, null], normal: [0, 0, 1] }], ['x-mid', { origin: [null, 0, 0], normal: [1, 0, 0] }]]) {
  for (const body of model.bodies) {
    const min = [0, 1, 2].map(i => Math.min(...body.vertices.map(v => v[i]))), max = [0, 1, 2].map(i => Math.max(...body.vertices.map(v => v[i])));
    const origin = plane.origin.map((v, i) => v ?? (min[i] + max[i]) / 2 + 0.123);
    const t0 = performance.now();
    let status;
    try { const r = await sectionSolid(body, { origin, normal: plane.normal }, { linear: 1e-7, angular: 1e-10 }); status = r.$ ?? r.status ?? Object.keys(r)[0]; if (r.contours) status += ` contours=${r.contours.length ?? '?'}`; }
    catch (e) { status = 'error: ' + e.message.slice(0, 120); }
    console.log(label, body.id, body.faces.length, 'faces', (performance.now() - t0).toFixed(0), 'ms', status);
  }
}
