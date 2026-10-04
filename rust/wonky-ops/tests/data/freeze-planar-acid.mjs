#!/usr/bin/env node
// Freezes tests/data/acid-planar-wc0.txt for tests/model_planar.rs (boolean3d strand G1): the WC0 v3
// words of every body with only plane carriers that the wonky-rust kernel builds, in variants V0-V3,
// for the CAD-Acid zones a scoreboard lists CORRECT. The Rust test decodes and audits each body,
// converts the planar families' bodies to Models and checks G1-G8 and V0-V3 canonical identity.
//
//   WONKY_BACKEND=rust node rust/wonky-ops/tests/data/freeze-planar-acid.mjs <scoreboard.json> \
//     [--acid-out <acid run out dir>] [--zones AC18,AC21,...] [--all-surfaces]
//     [--out <fixture.txt>] [--consumer <test path>]
// The optional filters also freeze curved adapter inputs without a second freezer.
//
// Needs the addon of this tree (node scripts/rust/build-node.mjs). With --acid-out (an acid run of a
// tree with the same Rust bodies), every frozen body's sha256 must equal that cell's model.brep.json
// wc0Sha256, so the fixture is byte-identical to the acid run's bodies. Refused builds (the expected
// refusals of AC12, AC13, AC15) are reported on stderr and contribute no body.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
let OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'acid-planar-wc0.txt');
const {loadCatalog, twinSource, sourceHashes, sha256, readJSON, VARIANTS} = await import(path.join(ROOT, 'scripts/acid/common.mjs'));
if (process.env.WONKY_BACKEND !== 'rust') throw new Error('WONKY_BACKEND=rust required');
const args = process.argv.slice(2);
const take = flag => {
  const at = args.indexOf(flag);
  if (at < 0) return null;
  if (!args[at + 1] || args[at + 1].startsWith('--')) throw new Error(`${flag} needs a value`);
  return args.splice(at, 2)[1];
};
const acidPath = take('--acid-out');
const acidOut = acidPath ? path.resolve(acidPath) : null;
const requestedZones = take('--zones');
const output = take('--out');
if (output) OUT = path.resolve(output);
const consumer = take('--consumer') ?? 'rust/wonky-ops/tests/model_planar.rs (boolean3d strand G1)';
const allAt = args.indexOf('--all-surfaces');
const allSurfaces = allAt >= 0;
if (allSurfaces) args.splice(allAt, 1);
if (args.length !== 1) throw new Error('one scoreboard path required');
const scoreboardFile = path.resolve(args[0] ?? '');
if (!fs.existsSync(scoreboardFile)) throw new Error('usage: freeze-planar-acid.mjs <scoreboard.json> [--acid-out <dir>]');

const {catalog, zonesSha256} = loadCatalog();
const scoreboard = readJSON(scoreboardFile);
if (scoreboard.zonesSha256 !== zonesSha256) throw new Error(`scoreboard catalog ${scoreboard.zonesSha256} is not ${zonesSha256}`);
const available = scoreboard.zones.filter(z => z.kernel === 'wonky-rust' && z.status === 'CORRECT').map(z => z.zone);
const correct = requestedZones ? requestedZones.split(',') : available;
for (const id of correct) if (!available.includes(id)) throw new Error(`${id}: not CORRECT in baseline`);
const sources = sourceHashes(catalog);
const {build} = await import(path.join(ROOT, 'src/index.mjs'));
const rust = await import(path.join(ROOT, 'src/native/rust-host.mjs'));

const lines = [];
const used = new Set();
let addon = null, matched = 0;
for (const zoneId of correct) {
  const zone = catalog.zones.find(z => z.id === zoneId);
  const group = catalog.groups.find(g => g.id === zone.group);
  for (const variant of VARIANTS) {
    const source = twinSource(catalog, group, zone, 'wonky-rust', variant);
    const relative = path.relative(ROOT, source);
    used.add(relative);
    if (sha256(fs.readFileSync(source)) !== sources[relative]) throw new Error(`SOURCE_CHANGED: ${relative}`);
    const parameters = {variant: `AcidVariant.${variant}`, zone: `${group.featureScript.parameters.zone.type.replace('enum ', '')}.${zoneId}`};
    const sibling = path.join(path.dirname(source), 'modules.json');
    let model;
    try {
      model = await build(fs.readFileSync(source, 'utf8'), {feature: group.featureScript.customFeature, parameters, sourcePath: source,
        moduleManifest: fs.existsSync(sibling) ? sibling : undefined, maxSteps: 20_000_000});
    } catch (error) {
      console.error(`${zoneId} ${variant}: refused ${error.name}: ${error.message}`);
      if (requestedZones) throw error;
      continue;
    }
    if (!rust.rustModel(model)) throw new Error(`${zoneId} ${variant}: not a Rust model`);
    addon ??= model.backend?.sourceHash ?? null;
    const kernel = rust.rustModelKernel(model);
    let recorded = null;
    if (acidOut) {
      const cell = path.join(acidOut, 'wonky-rust', group.id, variant, zoneId, 'model.brep.json');
      recorded = readJSON(cell).bodies.map(b => b.wc0Sha256);
    }
    model.bodies.forEach((body, index) => {
      const wc0 = rust.describeRustBody(kernel, body).body;
      const sha = rust.rustBodySha256(body);
      if (recorded) {
        if (recorded[index] !== sha) throw new Error(`${zoneId} ${variant} body ${index}: sha ${sha} differs from the acid run's ${recorded[index]}`);
      }
      if (!allSurfaces && !wc0.surfaces.every(s => s.geometry.kind === 'Plane')) return;
      if (recorded) matched++;
      const hex = Array.from(rust.rustBodyWords(body), w => w.toString(16).padStart(8, '0')).join('');
      lines.push(`${zoneId} ${variant} ${index} ${body.name} ${sha} ${hex}`);
    });
  }
}
const header = [
  allSurfaces ? '# wonky/acid-curved-wc0/1' : '# wonky/acid-planar-wc0/1',
  `# consumer: ${consumer}; regenerate only with the script below`,
  `# how: WONKY_BACKEND=rust node rust/wonky-ops/tests/data/freeze-planar-acid.mjs ${path.relative(ROOT, scoreboardFile)}${acidOut ? ` --acid-out ${path.relative(ROOT, acidOut)}` : ''}${requestedZones ? ` --zones ${requestedZones}` : ''}${allSurfaces ? ' --all-surfaces' : ''}${output ? ` --out ${path.relative(ROOT, OUT)}` : ''}${consumer === 'rust/wonky-ops/tests/model_planar.rs (boolean3d strand G1)' ? '' : ` --consumer ${JSON.stringify(consumer)}`}`,
  `# zonesSha256: ${zonesSha256}`,
  `# scoreboard: ${path.relative(ROOT, scoreboardFile)} sha256 ${sha256(fs.readFileSync(scoreboardFile))}`,
  `# correct zones (wonky-rust): ${correct.join(' ')}`,
  ...[...used].sort().map(f => `# source: ${f} sha256 ${sources[f]}`),
  `# addon sourceHash: ${addon}`,
  acidOut ? `# acid run: ${path.relative(ROOT, acidOut)}; ${matched}/${lines.length} frozen bodies equal the run's wc0Sha256` : '# acid run: not compared',
  '# line: <zone> <variant> <body index> <body name> <wc0 sha256> <WC0 v3 words, 8 hex digits each>',
];
fs.writeFileSync(OUT, [...header, ...lines].join('\n') + '\n');
console.log(`${lines.length} bodies from ${correct.length} CORRECT zones -> ${path.relative(ROOT, OUT)} (${fs.statSync(OUT).size} bytes)`);
