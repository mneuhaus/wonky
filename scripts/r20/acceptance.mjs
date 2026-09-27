#!/usr/bin/env node
// R20 stage-1 acceptance gate ("Probefahrt"): runs every R20 case through the
// production CLI (bin/wonky.mjs) and compares the parts against cad-31's
// Onshape references. See local design note.
//
//   node scripts/r20/acceptance.mjs [--cases kt1,ks0] [--deviation 0.01] [--jobs 4]
//        [--r20 <single-step-r20 dir>] [--out out/r20] [--format auto|r20-check|print]
//        [--timeout 900] [--samples 20000] [--source <id>=<file.fs>] [--adversarial [a,b,...]]
//   --source replaces a case's source for diagnosis (a scratch copy with a blocker stubbed);
//   such rows are marked "override" and never count as acceptance evidence.
//   --adversarial adds rigid copies of KT cases (scripts/r20/adversarial.mjs: rotated,
//   far from the origin, both, or turned 90 degrees and moved), compared with the
//   Onshape references after the same transform; each must build within tolerance
//   (PASS) or refuse by name with a capability error (REFUSED); a row with a declared
//   refusal (adversarial.mjs DECLARED, judged by its judgeDeclared) must stop with exactly
//   that name (REFUSED); anything else fails.
//
// Cases (the R20 project is read only):
//   KT1-KT6  kernel-cases/kt*/case.fs, reference.json + <Key>.stl   expect: build
//   KS01-09  kernel-cases/ks*/case.fs                                expect: build if no blend,
//            otherwise stop at the first opFillet/opChamfer with a capability error naming it
//   datums   build/studios/datums.fs (r20Datums)                     expect: build, D01-D04
//   probe    build/studios/probe.fs (r20Probe) + frozen import       expect: build, P01, X06
//            (datums/probe references: Onshape B-rep volumes from
//             kernel-cases/r20-datums-probe-volumes.json, schema r20/brep-volumes/v1, read by
//             scripts/r20/references.mjs; its studio_sha256 must match build/studios/<studio>.fs
//             and each mesh_sha256 var/mesh/<key>.stl and var/state/tessellate-manifest.json,
//             else the row fails naming the mismatch. Bbox and Hausdorff use var/mesh/<key>.stl.)
//
// Per part: volume against Onshape's B-rep volume (inside its [min, max], or within 1e-6
// relative of its value; basis onshape-brep for every case), bounding box and sampled
// symmetric Hausdorff distance against the Onshape STL, both within tol = deviation +
// Onshape's own chord error + 1e-4 mm (float32 STL), and a statement check: the Hausdorff
// distance within the part's own statement about its stored file (r20 manifest
// achievedDeviationMm = meshDeviationMm + float32RoundingMm, src/r20-export.mjs; a row
// without float32RoundingMm states the mesh only, and the float32 bound of our stored STL
// is added) + Onshape's chord error + the reference STL's own float32 storage bound (read
// from its coordinates), with no fixed float32 allowance. In r20-check mode the export
// directory is also read back by readR20Export (mirrors checks/meshes.py), including
// wonky's side of the contract (src/r20-export.mjs: part_studio, fingerprint, the per-part
// 'wonky' row), and a refusal is read from <out>/error.json. Writes out/r20/acceptance.json
// and prints a table.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readStl, measure, hausdorff, readR20Export, sha256File, partKey, float32StorageBoundMm } from './mesh.mjs';
import * as adversarialRows from './adversarial.mjs';
import { studioReferences } from './references.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'bin/wonky.mjs');
// Onshape tessellatedfaces with angleTolerance 0.05 rad (tools/tessellate.py):
// measured on KT2, rings carry about one vertex per 0.05 rad, so its chord error
// on a radius R is R(1 - cos 0.025). R is bounded by the part's half diagonal.
const ONSHAPE_ANGLE_RAD = 0.05;
// Float32 storage of both STLs in the tolerance (volume/bbox/Hausdorff); the
// statement check uses the measured and stated terms instead (statementCheck).
const STL_FLOAT_MM = 1e-4;
const EXACT_RELATIVE = 1e-6;

function parseArgs(argv) {
  const opts = { r20: process.env.R20_ROOT ?? path.join(os.homedir(), 'Workspace/cad/cad-project-041/single-step-r20'),
    out: path.join(ROOT, 'out/r20'), deviation: 0.01, jobs: 4, format: 'auto', timeout: 900, samples: 20000, cases: null, overrides: {}, adversarial: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], next = () => { if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`); return argv[++i]; };
    if (arg === '--r20') opts.r20 = path.resolve(next());
    else if (arg === '--out') opts.out = path.resolve(next());
    else if (arg === '--deviation') opts.deviation = Number(next());
    else if (arg === '--jobs') opts.jobs = Number(next());
    else if (arg === '--format') opts.format = next();
    else if (arg === '--timeout') opts.timeout = Number(next());
    else if (arg === '--samples') opts.samples = Number(next());
    else if (arg === '--source') { const [id, file] = next().split('='); opts.overrides[id.toLowerCase()] = path.resolve(file); }
    else if (arg === '--cases') opts.cases = next().split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    else if (arg === '--adversarial') opts.adversarial = argv[i + 1] && !argv[i + 1].startsWith('--') ? next().split(',').map(s => s.trim()).filter(Boolean) : adversarialRows.ADVERSARIAL_DEFAULT;
    else if (arg === '--help' || arg === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0]); process.exit(0); }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!(opts.deviation > 0)) throw new Error('--deviation expects a positive number (mm)');
  if (!['auto', 'r20-check', 'print'].includes(opts.format)) throw new Error('--format expects auto, r20-check or print');
  return opts;
}

// --- case table -------------------------------------------------------------------

const BLEND = /\bop(Fillet|Chamfer)\b/;

export function discoverCases(r20) {
  const kc = path.join(r20, 'kernel-cases');
  const cases = [];
  for (const dir of fs.readdirSync(kc).filter(d => /^k[ts]\d/.test(d)).sort()) {
    const source = path.join(kc, dir, 'case.fs'), text = fs.readFileSync(source, 'utf8');
    const feature = text.match(/export const (\w+) = defineFeature/)?.[1];
    const reference = JSON.parse(fs.readFileSync(path.join(kc, dir, 'reference.json'), 'utf8'));
    // A blend case calls a fillet/chamfer (directly or through the ks helpers)
    // in its feature body; the helpers themselves are defined in every case.
    const blend = /\b(ks|op)(Fillet|Chamfer)\s*\(/.test(text.slice(text.indexOf('defineFeature')));
    cases.push({ id: dir.split('_')[0], dir, source, feature, modules: null,
      expect: blend ? 'blend-stop' : 'build',
      note: dir.startsWith('ks05') ? 'Onshape refuses this chamfer; stage 1 stops at it, a later blend stage must refuse it by name' : undefined,
      refs: reference.parts.map(p => ({ key: p.key, name: p.name, stl: path.join(kc, dir, `${p.key}.stl`), sha256: p.sha256,
        volume: { value: p.volume_mm3_value_min_max[0], min: p.volume_mm3_value_min_max[1], max: p.volume_mm3_value_min_max[2], basis: 'onshape-brep' },
        bbox: p.mesh_bbox_mm })) });
  }
  // Onshape B-rep volumes (r20/brep-volumes/v1) with var/mesh for bbox and
  // Hausdorff; a studio-level problem (source hash, missing file) concerns
  // every part of the studio.
  const brepRefs = (studio, keys) => {
    const { problems, refs } = studioReferences(r20, studio, keys);
    return refs.map(r => ({ ...r, problems: [...problems, ...r.problems] }));
  };
  cases.push({ id: 'datums', dir: 'build/studios', source: path.join(r20, 'build/studios/datums.fs'), feature: 'r20Datums', modules: null,
    expect: 'build', refs: brepRefs('datums', ['D01', 'D02', 'D03', 'D04']) });
  cases.push({ id: 'probe', dir: 'build/studios', source: path.join(r20, 'build/studios/probe.fs'), feature: 'r20Probe',
    modules: path.join(ROOT, 'var/onshape-store/manifests/cad-project-041/single-step-r20/build/studios/probe.fs.json'),
    expect: 'build', refs: brepRefs('probe', ['P01', 'X06']) });
  return cases;
}

// Reference problems of a case (hash mismatches, missing B-rep entries),
// each naming its part; they fail the row whatever the build does.
const referenceProblems = c => c.refs.flatMap(r => r.problems ?? []).filter((p, i, all) => all.indexOf(p) === i);

// --- running the CLI -----------------------------------------------------------------

function cliSupportsR20() {
  try { return execFileSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }).includes('r20-check'); } catch { return false; }
}

function run(args, timeoutS) {
  return new Promise(resolve => {
    const started = process.hrtime.bigint();
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env } });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutS * 1000);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, seconds: Number(process.hrtime.bigint() - started) / 1e9 });
    });
  });
}

// "file:line:col: message" -> { line, column, message }; the CLI prints one
// such line per FeatureScript error (FeatureScriptError.format).
function parseError(stderr, source) {
  const lines = stderr.trim().split('\n').filter(Boolean);
  for (const text of lines) {
    const m = text.match(/^(.*?):(\d+):(\d+): ([\s\S]*)$/);
    if (m && path.resolve(m[1]) === path.resolve(source)) return { line: Number(m[2]), column: Number(m[3]), message: m[4] };
  }
  return lines.length ? { line: null, column: null, message: lines.at(-1) } : null;
}

// --- comparison -------------------------------------------------------------------------

function onshapeChordMm(bbox) {
  const halfDiagonal = Math.hypot(...[0, 1, 2].map(i => bbox[1][i] - bbox[0][i])) / 2;
  return halfDiagonal * (1 - Math.cos(ONSHAPE_ANGLE_RAD / 2));
}

const transformed = (triangles, frame) => (frame ? triangles.map(t => t.map(p => [0, 1, 2].map(i => frame.R[i][0] * p[0] + frame.R[i][1] * p[1] + frame.R[i][2] * p[2] + frame.T[i]))) : triangles);

// The part's own statement about its stored file against the reference's
// stored file: Hausdorff <= stated (mesh deviation + our float32 storage) +
// Onshape's chord error + the reference STL's float32 storage bound. No fixed
// float32 allowance: the export states its storage term (float32RoundingMm);
// a row from before that contract (no float32RoundingMm) states the mesh
// only, so the float32 bound of our stored STL is added here. Without any
// statement (print mode) the check is the tolerance check.
export function statementCheck(ours, { hausdorffMm, chordMm, refFloat32Mm, tolMm }) {
  const stated = ours.achievedDeviationMm ?? null;
  if (stated === null) return { ok: hausdorffMm <= tolMm, statedDeviationMm: null, allowedMm: tolMm, basis: 'no statement: the tolerance' };
  const storage = ours.float32RoundingMm != null
    ? { mm: ours.float32RoundingMm, basis: 'stated (included in achievedDeviationMm)' }
    : { mm: float32StorageBoundMm(ours.triangles), basis: 'float32 bound of the stored STL (legacy row: the statement covers the mesh only)' };
  const statedTotal = ours.float32RoundingMm != null ? stated : stated + storage.mm;
  const allowed = statedTotal + chordMm + refFloat32Mm;
  return { ok: hausdorffMm <= allowed, statedDeviationMm: stated, meshDeviationMm: ours.meshDeviationMm ?? stated,
    float32RoundingMm: storage.mm, float32RoundingBasis: storage.basis, onshapeChordMm: chordMm, refFloat32Mm, allowedMm: allowed };
}

export function compare(ours, ref, opts) {
  const refSolids = readStl(ref.stl), refStored = refSolids.flatMap(s => s.triangles);
  const refTriangles = transformed(refStored, ref.transform), refMeasure = measure(refTriangles);
  const refShaOk = !ref.sha256 || sha256File(ref.stl) === ref.sha256;
  const chordMm = onshapeChordMm(refMeasure.bbox);
  const tolMm = opts.deviation + chordMm + STL_FLOAT_MM;
  // The reference's float32 storage bound in its own (stored) frame; a rigid
  // transform keeps distances.
  const refFloat32Mm = float32StorageBoundMm(refStored);
  const oursMeasure = measure(ours.triangles);
  // Volume: the exact B-rep value when the kernel states one, else the mesh's;
  // the reference is always Onshape's B-rep volume (none: the check fails).
  const volume = ours.volumeMm3 ?? oursMeasure.volumeMm3, volumeBasis = ours.volumeMm3 != null ? (ours.exact ? 'exact' : 'stated') : 'mesh';
  let volumeCheck;
  if (ref.volume) {
    const rel = Math.abs(volume - ref.volume.value) / ref.volume.value;
    const inInterval = volume >= ref.volume.min && volume <= ref.volume.max;
    volumeCheck = { ok: inInterval || rel <= EXACT_RELATIVE, oursMm3: volume, basis: volumeBasis, refMm3: ref.volume.value,
      refBasis: ref.volume.basis ?? 'onshape-brep', interval: [ref.volume.min, ref.volume.max], inInterval, relative: rel };
  } else {
    volumeCheck = { ok: false, oursMm3: volume, basis: volumeBasis, refMm3: null, refBasis: null, relative: null,
      reason: `no Onshape B-rep volume for ${ref.key}` };
  }
  const refBox = refMeasure.bbox;
  const bboxDelta = Math.max(...[0, 1].flatMap(s => [0, 1, 2].map(i => Math.abs(oursMeasure.bbox[s][i] - refBox[s][i]))));
  const h = hausdorff(ours.triangles, refTriangles, { extra: opts.samples });
  const problems = ref.problems ?? [];
  const checks = {
    volume: volumeCheck,
    bbox: { ok: bboxDelta <= tolMm, maxDeltaMm: bboxDelta, ours: oursMeasure.bbox, ref: refBox },
    hausdorff: { ok: h.hausdorffMm <= tolMm, mm: h.hausdorffMm, meanOursToRefMm: h.oursToRef.mean, meanRefToOursMm: h.refToOurs.mean,
      worstAt: h.oursToRef.max >= h.refToOurs.max ? { side: 'ours', point: h.oursToRef.at } : { side: 'ref', point: h.refToOurs.at } },
    statement: statementCheck(ours, { hausdorffMm: h.hausdorffMm, chordMm, refFloat32Mm, tolMm }),
    mesh: { ok: oursMeasure.watertight && oursMeasure.components === 1, watertight: oursMeasure.watertight, components: oursMeasure.components,
      triangles: oursMeasure.triangles },
    reference: { ok: refShaOk && !problems.length, sha256Matches: refShaOk, triangles: refMeasure.triangles, float32BoundMm: refFloat32Mm,
      ...(problems.length ? { problems } : {}) },
  };
  return { key: ref.key, name: ref.name, oursName: ours.name, toleranceMm: tolMm, exact: ours.exact ?? null,
    approximation: ours.approximation ?? null, ok: Object.values(checks).every(c => c.ok), checks };
}

// "KEY check (detail)" for every failed check of a row's parts.
const failedChecks = parts => parts.flatMap(p => Object.entries(p.checks).filter(([, c]) => !c.ok)
  .map(([name, c]) => `${p.key} ${name}${c.problems ? ` (${c.problems.join('; ')})` : c.reason ? ` (${c.reason})` : ''}`));

// Our parts of one successful run: from the r20 export (by key) or, in print
// mode, from the per-body ASCII STL plus brep.json / print.json (by volume).
function oursFromPrint(prefix) {
  const solids = readStl(`${prefix}.stl`);
  const brep = JSON.parse(fs.readFileSync(`${prefix}.brep.json`, 'utf8'));
  const print = fs.existsSync(`${prefix}.print.json`) ? JSON.parse(fs.readFileSync(`${prefix}.print.json`, 'utf8')) : null;
  return solids.map((s, i) => {
    const body = brep.bodies[i], row = print?.bodies?.[i];
    const volume = body?.validation?.volumeMm3 ?? row?.exactVolumeMm3 ?? null;
    return { name: body?.name ?? body?.id ?? s.name, triangles: s.triangles, volumeMm3: volume,
      exact: volume != null && !body?.approximation, approximation: body?.approximation ?? null };
  });
}

function oursFromR20(dir) {
  const read = readR20Export(dir, { wonky: true });
  const parts = Object.values(read.parts).map(p => ({ key: p.key, name: p.name, triangles: p.triangles,
    volumeMm3: p.row.wonky?.volumeMm3 ?? null, exact: p.row.wonky?.exact ?? null, approximation: p.row.wonky?.approximation ?? null,
    achievedDeviationMm: p.row.wonky?.achievedDeviationMm ?? null, meshDeviationMm: p.row.wonky?.meshDeviationMm ?? null,
    float32RoundingMm: p.row.wonky?.float32RoundingMm ?? null }));
  return { parts, reader: { ok: read.ok, problems: read.problems, schema: read.manifest.schema, keys: Object.keys(read.parts) } };
}

function matchParts(ours, refs, byKey) {
  const pairs = [], unmatched = [];
  // Print mode: bodies named by setProperty NAME carry their key in brep.json.
  if (!byKey && ours.every(p => p.name && refs.some(r => r.key === partKey(p.name)))) { ours.forEach(p => { p.key = partKey(p.name); }); byKey = true; }
  if (byKey) {
    for (const ref of refs) { const hit = ours.find(p => p.key === ref.key); if (hit) pairs.push([hit, ref]); else unmatched.push(ref.key); }
    return { pairs, unmatched, extra: ours.filter(p => !refs.some(r => r.key === p.key)).map(p => p.key), method: 'key' };
  }
  const pool = [...ours];
  for (const ref of refs) {
    if (!pool.length) { unmatched.push(ref.key); continue; }
    const target = ref.volume?.value ?? measure(readStl(ref.stl).flatMap(s => s.triangles)).volumeMm3;
    pool.sort((x, y) => Math.abs((x.volumeMm3 ?? measure(x.triangles).volumeMm3) - target) - Math.abs((y.volumeMm3 ?? measure(y.triangles).volumeMm3) - target));
    pairs.push([pool.shift(), ref]);
  }
  return { pairs, unmatched, extra: pool.map(p => p.name), method: 'volume (print mode has no part names)' };
}

// A reference problem (hash mismatch, missing B-rep volume) fails the row by
// name, whatever the build did: the reference is not the one it claims to be.
export function withReferenceProblems(row, c) {
  const problems = referenceProblems(c);
  if (problems.length) {
    row.referenceProblems = problems;
    row.reason = `${row.status === 'FAIL' ? `${row.reason}; ` : ''}reference mismatch: ${problems.join('; ')}`;
    row.status = 'FAIL';
  }
  return row;
}

async function runCase(c, opts, mode) {
  return withReferenceProblems(await runCaseBuild(c, opts, mode), c);
}

async function runCaseBuild(c, opts, mode) {
  const caseOut = path.join(opts.out, 'cases', c.id);
  fs.rmSync(caseOut, { recursive: true, force: true });
  fs.mkdirSync(caseOut, { recursive: true });
  const prefix = path.join(caseOut, c.id);
  const args = [c.source, '--feature', c.feature, ...(c.modules ? ['--modules', c.modules] : [])];
  if (mode === 'r20-check') args.push('--format', 'r20-check', '--deviation', String(opts.deviation), '--out', path.join(caseOut, 'r20'));
  else args.push('--format', 'print', '--deviation-mm', String(opts.deviation), '--out', prefix);
  const result = await run(args, opts.timeout);
  fs.writeFileSync(path.join(caseOut, 'cli.log'), `$ node bin/wonky.mjs ${args.join(' ')}\nexit ${result.code}${result.timedOut ? ' (timeout)' : ''}\n--- stdout\n${result.stdout}\n--- stderr\n${result.stderr}`);
  const row = { id: c.id, ...(c.override ? { override: c.source } : {}), dir: c.dir, feature: c.feature, expect: c.expect, note: c.note, mode, seconds: +result.seconds.toFixed(2),
    exitCode: result.code, timedOut: result.timedOut, command: `node bin/wonky.mjs ${args.map(a => a.replace(ROOT + '/', '')).join(' ')}` };
  const built = result.code === 0 && !result.timedOut;
  if (!built) {
    const error = parseError(result.stderr, c.source) ?? { message: result.timedOut ? `timeout after ${opts.timeout} s` : `exit ${result.code}` };
    const errorJson = path.join(caseOut, 'r20', 'error.json');
    if (fs.existsSync(errorJson)) Object.assign(error, JSON.parse(fs.readFileSync(errorJson, 'utf8')));
    const sourceLine = error.line ? fs.readFileSync(c.source, 'utf8').split('\n')[error.line - 1] ?? '' : '';
    error.sourceLine = sourceLine.trim();
    error.atBlend = BLEND.test(sourceLine) && BLEND.test(error.message);
    row.error = error;
    // An adversarial row with a declared refusal (scripts/r20/adversarial.mjs
    // judgeDeclared) must stop with exactly that name.
    const declared = adversarialRows.judgeDeclared?.(c, { built, timedOut: result.timedOut, error });
    if (declared) Object.assign(row, declared);
    else if (c.expect === 'blend-stop' && error.atBlend && error.class !== undefined && error.class !== 'UnsupportedFeatureError') {
      row.status = 'FAIL'; row.reason = `stops at the blend, but with ${error.class}, not a capability error`;
    } else if (c.expect === 'blend-stop' && error.atBlend) { row.status = 'PASS'; row.reason = 'stops at its first blend with a capability error naming it'; }
    else if (c.expect === 'build-or-refuse' && !result.timedOut && (error.class === 'UnsupportedFeatureError' || /UnsupportedFeatureError/.test(result.stderr) || error.class === undefined && /not (implemented|available|certified)|refus|unresolved|not supported|supports /i.test(error.message))) {
      row.status = 'REFUSED'; row.reason = 'refused by name (a capability error)';
    }
    else { row.status = 'FAIL'; row.reason = 'blocked before the expected end'; }
    return row;
  }
  const declared = adversarialRows.judgeDeclared?.(c, { built, timedOut: result.timedOut });
  if (declared) return Object.assign(row, declared);
  let ours, byKey = false;
  try {
    if (mode === 'r20-check') { const r = oursFromR20(path.join(caseOut, 'r20')); ours = r.parts; row.reader = r.reader; byKey = true; }
    else ours = oursFromPrint(prefix);
  } catch (error) {
    row.status = 'FAIL'; row.reason = `built, but the export could not be read: ${error.message}`; return row;
  }
  const { pairs, unmatched, extra, method } = matchParts(ours, c.refs, byKey);
  row.matching = { method, unmatched, extra };
  row.parts = pairs.map(([o, r]) => compare(o, r, opts));
  const readerOk = !row.reader || row.reader.ok;
  const partsOk = row.parts.every(p => p.ok) && !unmatched.length && !extra.length;
  const failed = [...failedChecks(row.parts), ...unmatched.map(k => `${k} not built`), ...extra.map(k => `extra part ${k}`),
    ...(readerOk ? [] : row.reader.problems.map(p => `reader: ${p}`))].join('; ');
  if (c.expect === 'blend-stop') { row.status = 'FAIL'; row.reason = 'built although the case has a blend stage 1 does not implement'; }
  else if (c.expect === 'build-or-refuse') { row.status = partsOk && readerOk ? 'PASS' : 'FAIL'; row.reason = partsOk && readerOk ? 'built; every part within tolerance and its statement' : `built, but a comparison failed (a wrong or misstated result): ${failed}`; }
  else { row.status = partsOk && readerOk ? 'PASS' : 'FAIL'; row.reason = partsOk && readerOk ? 'built; every part within tolerance and its statement' : `built; a comparison failed: ${failed}`; }
  return row;
}

async function pool(items, jobs, fn) {
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, items.length)) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); process.stderr.write(`  ${items[i].id}: ${results[i].status}\n`); }
  }));
  return results;
}

// --- report ---------------------------------------------------------------------------------

const fmt = (x, digits = 3) => (x == null || !Number.isFinite(x) ? '-' : Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : x.toFixed(digits));
const short = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

function table(rows) {
  const out = ['| case | expect | status | s | first blocker / result | part: vol (ours / ref, rel) | bbox Δ | Hausdorff / tol |', '|---|---|---|---:|---|---|---:|---:|'];
  for (const r of rows) {
    const blocker = r.error ? `${r.error.line ?? '?'}:${r.error.column ?? '?'} ${short(r.error.message.replace(/\|/g, '/'), 110)}` : r.reason;
    const parts = r.parts?.length ? r.parts : [null];
    parts.forEach((p, i) => {
      const v = p?.checks.volume;
      out.push(`| ${i ? '' : r.id + (r.override ? ' (override)' : '')} | ${i ? '' : r.expect} | ${i ? '' : r.status} | ${i ? '' : r.seconds} | ${i ? '' : blocker} | ${p ? `${p.key}: ${fmt(v.oursMm3)} / ${fmt(v.refMm3)} (${fmt(v.relative)}, ${v.basis} vs ${v.refBasis ?? '-'}) ${v.ok ? 'ok' : 'FAIL'}` : '-'} | ${p ? `${fmt(p.checks.bbox.maxDeltaMm, 4)} ${p.checks.bbox.ok ? 'ok' : 'FAIL'}` : '-'} | ${p ? `${fmt(p.checks.hausdorff.mm, 4)} / ${fmt(p.toleranceMm, 4)} ${p.checks.hausdorff.ok ? 'ok' : 'FAIL'}${p.checks.statement && !p.checks.statement.ok ? ` (over its stated ${fmt(p.checks.statement.statedDeviationMm, 4)}: FAIL)` : ''}` : '-'} |`);
    });
  }
  return out.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let cases = discoverCases(opts.r20);
  for (const c of cases) if (opts.overrides[c.id]) { c.source = opts.overrides[c.id]; c.override = true; }
  if (opts.cases) cases = cases.filter(c => opts.cases.some(sel => c.id.startsWith(sel) || c.dir.startsWith(sel)));
  if (opts.adversarial?.length) cases = [...cases, ...adversarialRows.adversarialCases(opts.r20, opts.out, discoverCases(opts.r20), opts.adversarial, { declaredRefusals: true })];
  const supported = cliSupportsR20();
  if (opts.format === 'r20-check' && !supported) throw new Error('the CLI does not offer --format r20-check yet');
  const mode = opts.format === 'auto' ? (supported ? 'r20-check' : 'print') : opts.format;
  fs.mkdirSync(opts.out, { recursive: true });
  process.stderr.write(`r20 acceptance: ${cases.length} cases, mode ${mode}, deviation ${opts.deviation} mm, jobs ${opts.jobs}\n`);
  const rows = await pool(cases, opts.jobs, c => runCase(c, opts, mode));
  const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } };
  const gate = rows.filter(r => !r.id.startsWith('adv:')), adversarial = rows.filter(r => r.id.startsWith('adv:'));
  const summary = {
    pass: gate.filter(r => r.status === 'PASS').length, fail: gate.filter(r => r.status !== 'PASS').length,
    ...(adversarial.length ? { adversarial: { pass: adversarial.filter(r => r.status === 'PASS').length, refused: adversarial.filter(r => r.status === 'REFUSED').length,
      fail: adversarial.filter(r => r.status === 'FAIL').length, rows: adversarial.map(r => `${r.id}:${r.status}`) } } : {}),
    kt: rows.filter(r => r.id.startsWith('kt')).map(r => `${r.id}:${r.status}`), ks: rows.filter(r => r.id.startsWith('ks')).map(r => `${r.id}:${r.status}`),
  };
  const report = { schema: 'wonky/r20-acceptance/1', generatedAt: new Date().toISOString(), head: git('rev-parse', '--short', 'HEAD'),
    dirtyFiles: git('status', '--porcelain')?.split('\n').filter(Boolean).length ?? null, r20: opts.r20, mode,
    deviationMm: opts.deviation, tolerance: `deviation + half-diagonal*(1-cos(${ONSHAPE_ANGLE_RAD}/2)) + ${STL_FLOAT_MM} mm; volume in Onshape's B-rep [min,max] or within ${EXACT_RELATIVE} relative (datums/probe: r20/brep-volumes/v1)`,
    statement: `Hausdorff <= stated deviation of the stored file (mesh + float32RoundingMm) + half-diagonal*(1-cos(${ONSHAPE_ANGLE_RAD}/2)) + the reference STL's float32 bound`,
    summary, cases: rows };
  fs.writeFileSync(path.join(opts.out, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  const md = table(rows);
  fs.writeFileSync(path.join(opts.out, 'acceptance.md'), md + '\n');
  console.log(md);
  console.log(`\n${summary.pass}/${gate.length} PASS  (mode ${mode}; ${path.relative(ROOT, path.join(opts.out, 'acceptance.json'))})`);
  if (summary.adversarial) console.log(`adversarial: ${summary.adversarial.pass} PASS, ${summary.adversarial.refused} REFUSED by name, ${summary.adversarial.fail} FAIL`);
  process.exitCode = summary.fail || summary.adversarial?.fail ? 1 : 0;
}

// Run as a script; imported (tests), only the exports.
const invoked = process.argv[1] && fs.existsSync(process.argv[1]) ? fs.realpathSync(process.argv[1]) : null;
if (invoked === fs.realpathSync(fileURLToPath(import.meta.url)))
  main().catch(error => { console.error(`r20 acceptance: ${error.stack ?? error.message}`); process.exitCode = 2; });
