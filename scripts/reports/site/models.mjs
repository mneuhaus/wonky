#!/usr/bin/env node
import { assertNoPrivateTerms } from '../private-terms.mjs';
// Consumer: static Models page. Rebuilds the selected diagnostic model gallery;
// provenance prevents mixing old geometry with a newer kernel or R20 snapshot.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { renderPair, SETTINGS } from './render.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const data = resolve(root, 'out/site/data'), snapshot = resolve(root, 'tmp/r20-studios-snapshot-0925-2041');
const native = resolve(root, '../cad/cad-project-041/single-step-r20');
const rel = p => relative(root, p), hash = b => createHash('sha256').update(b).digest('hex');
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const json = (p, value) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(value, null, 2) + '\n'); };
const scrub = s => s.replaceAll(root, '.').replaceAll(native, 'R20-local-reference').replace(/\/(?:Users|home|private\/tmp)\/[^\s"<>]+/g, '[local-path]').replace(/\b[0-9a-f]{24}\b/gi, '[redacted-id]');
function implementation() {
  const files = [];
  const walk = p => { for (const entry of readdirSync(p, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) { const f = join(p, entry.name); if (entry.isDirectory()) walk(f); else if (/\.(mjs|bend|py)$/.test(f)) files.push([rel(f), hash(readFileSync(f))]); } };
  for (const d of ['src', 'kernel', 'bin', 'python']) walk(resolve(root, d));
  return { revision: execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), sha256: hash(JSON.stringify(files)) };
}
function run(command, args, timeout = 300000) {
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } });
  return { ok: r.status === 0, exitCode: r.status, signal: r.signal, stdout: scrub(r.stdout ?? ''), stderr: scrub(r.stderr ?? ''), error: r.error?.message ? scrub(r.error.message) : null };
}
const commandLine = (cmd, args) => [cmd, ...args.map(x => x.startsWith(root) ? rel(x) : x)].join(' ');
const six = ['box', 'translated-cylinder', 'coaxial-bore', 'planar-union', 'planar-pocket', 'frame-with-tab'];
const manifest = read(resolve(snapshot, 'manifest.json'));
const modes = process.argv.slice(2), selected = modes.length ? modes : ['--references', '--r20', '--build123d', '--render'];
mkdirSync(data, { recursive: true });

if (selected.includes('--references')) {
  const volumes = read(resolve(snapshot, 'r20-modules-volumes.json'));
  const meshManifest = read(resolve(native, 'var/state/tessellate-manifest.json'));
  if (!manifest.params_sha256.startsWith(volumes.params_sha)) throw new Error('R20 volume parameters do not match the source snapshot');
  for (const module of manifest.order) {
    if (hash(readFileSync(resolve(snapshot, module + '.fs'))) !== manifest.studios[module].sha256) throw new Error(`R20 source snapshot hash mismatch: ${module}`);
    if (volumes.module_stamps[module] !== manifest.modules[module].stamp) throw new Error(`R20 volume module stamp mismatch: ${module}`);
  }
  const frozenPath = resolve(data, 'src/onshape/provenance.json');
  const frozen = existsSync(frozenPath) ? read(frozenPath) : null;
  const parts = {};
  for (const [key, row] of Object.entries(volumes.parts)) {
    const module = row.description.match(/module=(\w+)@/)?.[1];
    if (!manifest.modules[module]) throw new Error(`Unknown module for ${key}`);
    const from = resolve(native, 'var/mesh', key + '.stl'), to = resolve(data, 'src/onshape', key + '.stl');
    const sha256 = hash(readFileSync(from));
    if (meshManifest.parts[key]?.sha256 !== sha256) throw new Error(`Native reference hash mismatch: ${key}`);
    if (frozen?.parts[key]?.sha256 && frozen.parts[key].sha256 !== sha256) throw new Error(`Native source changed after freezing: ${key}; keep the original snapshot`);
    mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to);
    parts[key] = { name: row.name, module, volumeMm3: row.volume_mm3_value_min_max[0], volumeIntervalMm3: row.volume_mm3_value_min_max.slice(1), sha256, triangles: meshManifest.parts[key].triangles, path: rel(to), original: `R20 local reference: var/mesh/${key}.stl`, volumeSource: 'tmp/r20-studios-snapshot-0925-2041/r20-modules-volumes.json', meshHashVerified: true };
  }
  json(resolve(data, 'src/onshape/provenance.json'), { schema: 'report-site/onshape-reference/1', source: 'R20 local reference, read-only snapshot; no live API', parametersSha256: manifest.params_sha256, volumeManifestSha256: hash(readFileSync(resolve(snapshot, 'r20-modules-volumes.json'))), meshManifestSha256: hash(readFileSync(resolve(native, 'var/state/tessellate-manifest.json'))), parts });
  console.log(`Frozen native references: ${Object.keys(parts).length}`);
}

if (selected.includes('--r20')) for (const module of manifest.order.filter(m => !process.env.SITE_R20_MODULES || process.env.SITE_R20_MODULES.split(',').includes(m))) {
  const folder = resolve(data, 'src/wonky/r20', module), evidence = resolve(folder, 'run.json'), source = resolve(snapshot, module + '.fs');
  mkdirSync(folder, { recursive: true });
  const before = implementation(), sourceSha256 = hash(readFileSync(source));
  const previous = existsSync(evidence) ? read(evidence) : null;
  if (previous && previous.implementation.sha256 === before.sha256 && previous.sourceSha256 === sourceSha256 && previous.exitCode !== null) { console.log(`Reuse R20 ${module}: ${previous.ok ? 'exported' : 'refused'}`); continue; }
  const args = ['--max-old-space-size=8192', resolve(root, 'bin/wonky.mjs'), source, '--feature', manifest.modules[module].featureType, '--format', 'r20-check', '--deviation', '0.01', '--out', folder, '--param', 'withBlends=false'];
  if (['context', 'probe'].includes(module)) args.push('--modules', resolve(root, `var/onshape-store/manifests/cad-project-041/single-step-r20/build/studios/${module}.fs.json`));
  console.log(`Building R20 ${module}`);
  const timeoutMs = module === 'cores' ? 900000 : 300000;
  const result = run(process.execPath, args, timeoutMs), after = implementation();
  const mf = resolve(folder, 'tessellate-manifest.json'), ef = resolve(folder, 'error.json');
  let parts = null, refusal = null;
  if (result.ok && existsSync(mf)) {
    parts = Object.fromEntries(Object.entries(read(mf).parts).map(([key, p]) => [key, { name: p.name, triangles: p.triangles, sha256: p.sha256, wonky: JSON.parse(scrub(JSON.stringify(p.wonky))) }]));
    json(mf, { schema: 'report-site/wonky-parts/1', parts });
  } else {
    refusal = existsSync(ef) && !result.error ? read(ef) : { class: result.error ? 'execution-failure' : 'export-failure', message: result.error || result.stderr };
    refusal = { class: refusal.class, message: scrub(refusal.message ?? 'Unknown build failure'), line: refusal.line ?? null };
    // Never reuse a previous mesh after a failed or interrupted export.
    for (const name of readdirSync(folder)) if (name.endsWith('.stl') || name === 'tessellate-manifest.json') rmSync(resolve(folder, name));
    json(ef, refusal);
  }
  const previousAttempts = previous ? [...(previous.previousAttempts ?? []), { exitCode: previous.exitCode, signal: previous.signal, error: previous.error, implementation: previous.implementation }] : [];
  json(evidence, { module, command: commandLine('node', args), source: rel(source), sourceSha256, feature: manifest.modules[module].featureType, implementation: before, implementationUnchanged: before.sha256 === after.sha256, timeoutMs, previousAttempts, ...result, parts, refusal });
  console.log(`R20 ${module}: ${result.ok ? Object.keys(parts ?? {}).length + ' parts' : 'refused ' + refusal?.message}`);
}

if (selected.includes('--build123d')) for (const id of six) {
  const source = resolve(root, `fixtures/performance-build123d/cases/${id}.py`), folder = resolve(data, 'src/build123d', id), evidence = resolve(folder, 'run.json');
  mkdirSync(folder, { recursive: true });
  const before = implementation(), sourceSha256 = hash(readFileSync(source));
  if (existsSync(evidence)) { const old = read(evidence); if (old.implementation.sha256 === before.sha256 && old.sourceSha256 === sourceSha256 && old.wonkyRun.ok && old.referenceRun.ok && old.wonky?.stlSha256) { console.log(`Reuse build123d ${id}`); continue; } }
  const refArgs = ['run', '--no-project', '--python', resolve(root, 'out/build123d-performance/reference-venv/bin/python'), 'python', resolve(root, 'scripts/reports/site/reference-export.py'), source, resolve(folder, 'reference.stl')];
  console.log(`Building OCCT reference ${id}`);
  const referenceRun = run('uv', refArgs);
  const wonkyArgs = ['--max-old-space-size=8192', resolve(root, 'scripts/reports/site/wonky-python-export.mjs'), source, resolve(folder, 'wonky.stl')];
  console.log(`Building Wonky ${id}`);
  const wonkyRun = run(process.execPath, wonkyArgs), after = implementation();
  const lastJson = r => r.ok ? JSON.parse(r.stdout.trim().split('\n').at(-1)) : null;
  const reference = lastJson(referenceRun), wonky = lastJson(wonkyRun);
  json(evidence, { source: rel(source), sourceSha256, implementation: before, implementationUnchanged: before.sha256 === after.sha256, commands: [commandLine('uv', refArgs), commandLine('node', wonkyArgs)], referenceRun, wonkyRun, reference, wonky });
  console.log(`build123d ${id}: reference=${referenceRun.ok} wonky=${wonkyRun.ok}`);
}

if (selected.includes('--render')) {
  const models = [], references = read(resolve(data, 'src/onshape/provenance.json'));
  function images(id, referencePath, wonkyPath, expectedReferenceSha256, expectedWonkySha256) {
    const meshSha256 = { reference: hash(readFileSync(resolve(root, referencePath))), wonky: wonkyPath ? hash(readFileSync(resolve(root, wonkyPath))) : null };
    if (expectedReferenceSha256 && meshSha256.reference !== expectedReferenceSha256) throw new Error(`Reference STL changed: ${id}`);
    if (expectedWonkySha256 && meshSha256.wonky !== expectedWonkySha256) throw new Error(`Wonky STL changed: ${id}`);
    const refImage = resolve(root, `out/site/img/${id}-ref.png`), wonkyImage = resolve(root, `out/site/img/${id}-wonky.png`);
    if (!wonkyPath && existsSync(wonkyImage)) rmSync(wonkyImage);
    const metrics = renderPair(resolve(root, referencePath), wonkyPath ? resolve(root, wonkyPath) : null, refImage, wonkyImage);
    return { images: { reference: rel(refImage), wonky: wonkyPath ? rel(wonkyImage) : null }, meshSha256, renderMetrics: metrics };
  }
  for (const id of six) {
    const folder = resolve(data, 'src/build123d', id), runPath = resolve(folder, 'run.json');
    if (!existsSync(runPath)) continue;
    const row = read(runPath), ref = row.reference, w = row.wonky;
    if (!ref) throw new Error(`Reference missing for ${id}`);
    const r = images(id, rel(resolve(folder, 'reference.stl')), w ? rel(resolve(folder, 'wonky.stl')) : null, ref.stlSha256, w?.stlSha256);
    const volume = w?.volumeMm3 ?? r.renderMetrics.wonky?.signedMeshVolumeMm3 ?? null;
    models.push({ id, name: id, kind: 'build123d', module: id, referenceKind: 'build123d/OCCT', referenceVolumeMm3: ref.volumeMm3, wonkyVolumeMm3: volume, relativeDifference: volume === null ? null : (volume - ref.volumeMm3) / ref.volumeMm3, wonkyStatus: w ? (w.exact ? 'exact B-rep' : w.certifiedMesh ? 'certified mesh' : 'approximated B-rep') : 'refused', volumeBasis: w?.volumeMm3 != null ? 'B-rep' : w ? 'STL signed tetrahedral volume' : null, deviationMm: w?.deviationMm ?? null, refusal: w ? null : row.wonkyRun.stderr, sourceSha256: row.sourceSha256, implementation: row.implementation, implementationUnchanged: row.implementationUnchanged, ...r, sources: [row.source, rel(runPath), 'scripts/reports/site/render.mjs'] });
  }
  for (const [key, ref] of Object.entries(references.parts)) {
    const id = `r20-${key.toLowerCase()}`, folder = resolve(data, 'src/wonky/r20', ref.module), runPath = resolve(folder, 'run.json');
    const run = existsSync(runPath) ? read(runPath) : null, part = run?.ok ? run.parts?.[key] : null, w = part?.wonky;
    const r = images(id, ref.path, part ? rel(resolve(folder, key + '.stl')) : null, ref.sha256, part?.sha256);
    const volume = w?.volumeMm3 ?? w?.meshVolumeMm3 ?? null;
    const certified = w?.approximation?.kind === 'certified-mesh' || w?.meshSource === 'certified-mesh';
    const status = !part ? 'refused' : w.exact ? 'exact B-rep' : certified ? 'certified mesh' : 'approximated B-rep';
    models.push({ id, name: ref.name, kind: 'FeatureScript', module: ref.module, referenceKind: 'Onshape native', referenceVolumeMm3: ref.volumeMm3, referenceVolumeIntervalMm3: ref.volumeIntervalMm3, wonkyVolumeMm3: volume, relativeDifference: volume === null ? null : (volume - ref.volumeMm3) / ref.volumeMm3, wonkyStatus: status, volumeBasis: w?.volumeMm3 != null ? (w.volumeLabel ?? (w.exact ? 'exact' : 'stated')) : w ? 'STL signed tetrahedral volume' : null, deviationMm: w?.deviationMm ?? null, achievedDeviationMm: w?.achievedDeviationMm ?? null, approximation: w?.approximation ?? null, refusal: part ? null : run?.refusal ?? { class: 'not-built', message: 'Modul noch nicht gebaut.' }, referenceSha256: ref.sha256, sourceSha256: run?.sourceSha256 ?? null, implementation: run?.implementation ?? null, implementationUnchanged: run?.implementationUnchanged ?? null, ...r, sources: [ref.path, ref.volumeSource, rel(runPath), 'scripts/reports/site/render.mjs'] });
  }
  const statuses = {};
  for (const m of models) statuses[m.wonkyStatus] = (statuses[m.wonkyStatus] ?? 0) + 1;
  const output = { schema: 'report-site/models/1', renderer: { source: 'scripts/reports/site/render.mjs', sha256: hash(readFileSync(resolve(root, 'scripts/reports/site/render.mjs'))), ...SETTINGS, cameraFit: 'Shared projected bounds per reference/Wonky pair; no independent rescaling, alignment or geometry repair.' }, counts: { total: models.length, build123d: models.filter(m => m.kind === 'build123d').length, FeatureScript: models.filter(m => m.kind === 'FeatureScript').length, comparisonPairs: models.filter(m => m.images.wonky).length, referenceOnly: models.filter(m => !m.images.wonky).length, pngImages: models.reduce((s,m) => s + 1 + (m.images.wonky ? 1 : 0), 0), statuses }, countSource: 'models[] in out/site/data/models.json; scripts/reports/site/models.mjs', notes: ['Gezielter Diagnosekorpus, kein vollständiger CAD-Fähigkeitsnachweis.', 'STLs dienen nur der Abbildung. Exact B-rep bezeichnet das Wonky-Modell, nicht die polygonale Anzeige.', 'Relative Differenz = (Wonky − Referenz) / Referenz, nicht Prozent; Volumenbasis je Modell angegeben.', 'Certified mesh: Abstand zu getaggten Trägerflächen zertifiziert, keine Hausdorff-Garantie für das exakte Gesamtergebnis.', 'R20: withBlends=false, sonst Modul-Defaults. Native STLs unverändert kopiert und gegen deren Manifest SHA-256-geprüft.', 'PNG-Hintergrund ist fest hell; Seiten können im Dunkelmodus einen hellen Bildbereich behalten.', 'Keine Live-Onshape-Aufrufe; keine fehlenden Wonky-Modelle durch Referenzgeometrie ersetzt.'], models };
  const text = JSON.stringify(output, null, 2);
  if (/\/(?:Users|home)\/|\b[0-9a-f]{24}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)) throw new Error('Public safety check failed');
  assertNoPrivateTerms(text, 'models.json');
  json(resolve(data, 'models.json'), output);
  console.log(JSON.stringify(output.counts));
}
