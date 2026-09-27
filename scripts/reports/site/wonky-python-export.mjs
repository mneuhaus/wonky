#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPython } from '../../../src/python.mjs';
import { loadKernel } from '../../../src/kernel.mjs';
import { toPrintStl } from '../../../src/print-mesh.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const [source, target] = process.argv.slice(2);
const model = await buildPython(readFileSync(source, 'utf8'), { filename: source, python: resolve(root, 'scripts/reports/site/uv-python.sh'), timeoutMs: 240000, trace: true });
const exported = toPrintStl(await loadKernel(), model, { deviationMm: 0.01 });
writeFileSync(target, exported.stl);
const volumeMm3 = model.bodies.every(b => Number.isFinite(b.validation?.volumeMm3)) ? model.bodies.reduce((s, b) => s + b.validation.volumeMm3, 0) : null;
const exact = volumeMm3 !== null && model.bodies.every(b => b.geometry !== 'mesh' && !b.approximation && !b.exactness);
const certifiedMesh = model.bodies.some(b => b.geometry === 'mesh') && model.bodies.every(b => b.geometry === 'mesh' ? b.approximation?.kind === 'certified-mesh' : !b.approximation && !b.exactness);
const stlSha256 = createHash('sha256').update(exported.stl).digest('hex');
console.log(JSON.stringify({ volumeMm3, exact, certifiedMesh, stlSha256, solids: model.bodies.length, deviationMm: 0.01, bodies: exported.manifest.bodies }));
