#!/usr/bin/env node
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from '../src/index.mjs';
import { loadKernel } from '../src/kernel.mjs';
import { compareBodiesInBend } from '../src/comparison.mjs';
import { toStep } from '../src/exporters.mjs';
import { serializeModel } from '../src/construction-history.mjs';

const help = `wonky-compare — geometric changes and interference measured in Bend

Usage: node bin/wonky-compare.mjs <before.fs> <after.fs> [options]

  --out <prefix>              Output prefix (default: out/comparison)
  --feature-before <name>     Exported feature in the first file
  --feature-after <name>      Exported feature in the second file
  --tolerance <mm>            Classification tolerance (default: 1e-7 mm)
  --geometry                 Also export added/removed/common STEP and B-rep
  --help                     Show this help

Current scope: one coaxial cylinder primitive per input. Existing placements
are compared directly; no automatic alignment. General B-reps fail explicitly.
Without --geometry, only the measurements are produced. Fully enclosed void
shells are not yet supported by the optional Boolean geometry export.
`;

try {
  const args = process.argv.slice(2), inputs = [];
  if (!args.length || args.includes('--help')) { console.log(help); process.exit(0); }
  let out = 'out/comparison', beforeFeature, afterFeature, toleranceMm = 1e-7, includeGeometry = false;
  const value = (i, name) => {
    if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`${name} requires a value`);
    return args[i+1];
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--out') { out = value(i,arg); i++; }
    else if (arg === '--feature-before') { beforeFeature = value(i,arg); i++; }
    else if (arg === '--feature-after') { afterFeature = value(i,arg); i++; }
    else if (arg === '--tolerance') { toleranceMm = Number(value(i,arg)); i++; }
    else if (arg === '--geometry') includeGeometry = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option '${arg}'`);
    else inputs.push(arg);
  }
  if (inputs.length !== 2) throw new Error('Pass exactly two FeatureScript files');
  const sources = await Promise.all(inputs.map(path => readFile(path,'utf8')));
  const models = [];
  for (let i = 0; i < 2; i++) {
    const manifest = resolve(dirname(inputs[i]),'modules.json');
    models.push(await build(sources[i], { feature: i === 0 ? beforeFeature : afterFeature, moduleManifest: existsSync(manifest) ? manifest : undefined }));
  }
  if (models.some(m => m.bodies.length !== 1)) throw new Error('Comparison currently requires one cylinder body per input; select a suitable exported feature');
  const { geometry, ...report } = compareBodiesInBend(await loadKernel(), models[0].bodies[0], models[1].bodies[0], {toleranceMm,includeGeometry});
  report.inputs = inputs.map((path,i) => ({ path:resolve(path), feature:models[i].source.feature, sha256:createHash('sha256').update(sources[i]).digest('hex') }));
  const prefix = resolve(out), files = [], emptySteps = [];
  if (geometry) {
    report.geometryArtifacts = {};
    for (const [kind,bodies] of Object.entries(geometry)) {
      const model = { schema:'wonky-brep/1',units:'millimeter',backend:models[0].backend,bodies };
      const brep = `${prefix}.${kind}.brep.json`, step = `${prefix}.${kind}.step`;
      files.push([brep,serializeModel(model)]);
      if (bodies.length) files.push([step,toStep(model,kind)]);
      else emptySteps.push(step);
      report.geometryArtifacts[kind] = { bodies:bodies.length,brep,step:bodies.length ? step : null };
    }
  }
  files.push([`${prefix}.json`,JSON.stringify(report,null,2)+'\n']);
  await mkdir(dirname(prefix),{recursive:true});
  for (const path of emptySteps) await rm(path,{force:true});
  for (const [path,contents] of files) {
    const temporary = `${path}.${process.pid}.tmp`;
    try { await writeFile(temporary,contents); await rename(temporary,path); }
    finally { await rm(temporary,{force:true}); }
  }
  console.log(`${report.relation}; added ${report.volumesMm3.added.toFixed(6)} mm³; removed ${report.volumesMm3.removed.toFixed(6)} mm³; common ${report.volumesMm3.common.toFixed(6)} mm³; minimum distance ${report.minimumDistanceMm} mm`);
  console.log(`${prefix}.json`);
} catch (error) {
  console.error(`wonky-compare: ${error.message}`); process.exitCode = 1;
}
