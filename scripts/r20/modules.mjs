// R20 module gate (package G0, docs/rust-migration.md sections 3.4 and 6): the
// 8 studios of the frozen R20 snapshot (fixtures/r20-modules, withBlends=false)
// built end to end by the production CLI and compared part by part with the
// frozen Onshape references.
//
//   node scripts/r20/modules.mjs [--only datums,context] [--blends] [--fixtures <dir>]
//        [--out out/r20-modules] [--deviation 0.01] [--samples 20000]
//        [--timeout 900] [--reuse-builds] [--require-no-bend]
//        [--baseline <file>] [--write-baseline <file>]
//
// The kernel backend is WONKY_BACKEND (src/native/backend.mjs), passed through
// unchanged; the runner never picks or switches one.
//
// 1. Provenance (verifyFixture), before anything is built. Every frozen file
//    must have the sha256 and size in provenance.json, the studios must match
//    the snapshot's SHA256SUMS, and the references must belong to the frozen
//    sources: Onshape built exactly these studio bytes (onshape-state.json
//    featureStudios.<m>.uploadedSha) with these module and parameter hashes,
//    the meshes were fetched for that state (tessellate fingerprint =
//    sha256 of the state's canonical JSON, R20 tools/tessellate.py), and the
//    B-rep volumes carry the same module stamps. A module with a problem is
//    not built (status PROVENANCE) and its parts count as not checked.
// 2. Build: `node bin/wonky.mjs studios/<m>.fs --feature <f> [--param
//    withBlends=false] --format r20-check --deviation-mm 0.01 --out ...
//    [--modules <import manifest>]`, one module at a time, under the
//    bend-guard preload (scripts/r20/bend-guard.mjs).
// 3. Per part, scripts/r20/acceptance.mjs compare(): volume inside Onshape's
//    B-rep [min, max] (or 1e-6 relative), bbox and sampled symmetric Hausdorff
//    within deviation + Onshape's chord error + 1e-4 mm, the part's own
//    deviation statement, one watertight body, the reference STL's sha256;
//    plus `stamp`: the built part's description stamp (params, module hash,
//    live values) equals the reference part's, so both were built from the
//    same module with the same parameters. Every failed check is reported.
// 4. With --require-no-bend (default when WONKY_BACKEND=rust) a module whose
//    process loaded Bend in any form fails, whatever it built.
//
// Module status: PASS (built, every part passes every check), FAIL, REFUSED
// (stopped with a named capability error: error.json class
// UnsupportedFeatureError), PROVENANCE (not built). Exit code: with
// --baseline, 1 iff something regressed against it or a provenance problem
// exists; without, 1 iff a module is not PASS.
//
// Test tooling only: nothing here constructs geometry.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readR20Export } from './mesh.mjs';
import { compare } from './acceptance.mjs';
import { normalizeModelingPolicy } from '../../src/modeling-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'bin/wonky.mjs');
export const GUARD = path.join(ROOT, 'scripts/r20/bend-guard.mjs');
export const FIXTURE_DIR = path.join(ROOT, 'fixtures/r20-modules');
export const PROVENANCE_SCHEMA = 'wonky/r20-modules-provenance/1';
export const BLENDS_SCHEMA = 'wonky/r20-modules-blends/1';
export const BASELINE_SCHEMA = 'wonky/r20-modules-baseline/1';
export const IMPORT_MANIFEST_DIR = 'onshape-store/manifests/cad-project-041/single-step-r20/build/studios';
// Files in the fixture directory that provenance.json does not list.
const UNLISTED = new Set(['provenance.json', 'baseline-bend-js.json']);
const CHECKS = ['volume', 'bbox', 'hausdorff', 'statement', 'mesh', 'reference', 'stamp'];

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const moduleOfDescription = description => String(description ?? '').match(/\bmodule=(\w+)@[0-9a-f]+/)?.[1] ?? null;
const stampOf = description => String(description ?? '').split(' | ')[0];

// --- canonical JSON as Python's json.dumps(sort_keys=True, ensure_ascii=False,
// separators=(",", ":")) (R20 tools/r20common.py sha256_json) ----------------

const PY_FLOAT = Symbol('pyFloat');
// Parses JSON keeping which numbers were floats in the text (Python reads
// "3.0" as a float and writes it back as "3.0"; JavaScript would write "3").
export function parsePythonJson(text) {
  return JSON.parse(text, (key, value, context) => (typeof value === 'number' && /[.eE]/.test(context?.source ?? '') ? { [PY_FLOAT]: value } : value));
}
function pyFloat(x) {
  if (!Number.isFinite(x)) throw new Error(`canonical JSON: non-finite float ${x}`);
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  // Python's repr switches to exponent notation outside [1e-4, 1e16); fail closed there.
  if (Math.abs(x) < 1e-4 || Math.abs(x) >= 1e16) throw new Error(`canonical JSON: float ${x} is outside the range this reimplementation writes like Python`);
  const s = String(x);
  return s.includes('.') ? s : `${s}.0`;
}
export function pythonCanonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) throw new Error(`canonical JSON: integer ${value} is not exact`); return String(value); }
  if (Array.isArray(value)) return `[${value.map(pythonCanonicalJson).join(',')}]`;
  if (typeof value === 'object' && PY_FLOAT in value) return pyFloat(value[PY_FLOAT]);
  if (typeof value === 'object') {
    // Python sorts str keys by code point; JavaScript's default sort compares UTF-16 units (equal below U+10000).
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${pythonCanonicalJson(value[k])}`).join(',')}}`;
  }
  throw new Error(`canonical JSON: unsupported value ${typeof value}`);
}
// R20 tools/tessellate.py state_fingerprint.
export const tessellateFingerprint = stateText => {
  const state = parsePythonJson(stateText);
  return sha256(Buffer.from(pythonCanonicalJson({ partStudio: state.partStudio, featureStudios: state.featureStudios, features: state.features }), 'utf8'));
};

// --- provenance ------------------------------------------------------------------

function walkFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walkFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')]);
}

// Returns { ok, dir, problems (whole fixture), modules: {m: {problems}},
// provenance, refs: {m: [ref]} }. Never throws on a damaged fixture: every
// problem is a sentence naming the file (and module) it concerns.
export function verifyFixture(dir = FIXTURE_DIR) {
  const problems = [], modules = {}, refs = {};
  const result = () => ({ ok: !problems.length && Object.values(modules).every(m => !m.problems.length), dir, problems, modules, provenance, refs });
  let provenance = null;
  try { provenance = JSON.parse(fs.readFileSync(path.join(dir, 'provenance.json'), 'utf8')); }
  catch (error) { problems.push(`provenance.json unreadable: ${error.message}`); return result(); }
  if (provenance.schema !== PROVENANCE_SCHEMA) problems.push(`provenance.json schema ${JSON.stringify(provenance.schema)}, expected ${PROVENANCE_SCHEMA}`);
  const order = Object.keys(provenance.modules ?? {});
  for (const m of order) modules[m] = { problems: [] };
  const blame = (list, message) => { for (const m of list?.length ? list : order) (modules[m] ??= { problems: [] }).problems.push(message); };

  // 1. every file byte-identical to what was frozen, nothing unlisted
  const listed = new Map((provenance.files ?? []).map(f => [f.path, f]));
  for (const f of listed.values()) {
    const file = path.join(dir, f.path);
    if (!path.resolve(file).startsWith(path.resolve(dir) + path.sep)) { problems.push(`${f.path}: outside the fixture`); continue; }
    if (!fs.existsSync(file)) { blame(f.modules, `${f.path}: missing`); continue; }
    const bytes = fs.readFileSync(file), digest = sha256(bytes);
    if (digest !== f.sha256 || bytes.length !== f.bytes)
      blame(f.modules, `${f.path}: sha256 ${digest.slice(0, 12)} (${bytes.length} bytes) differs from provenance ${String(f.sha256).slice(0, 12)} (${f.bytes} bytes)`);
  }
  // The independently frozen blended variant owns its own provenance and hashes.
  for (const rel of walkFiles(dir)) if (!rel.startsWith('blends/') && !UNLISTED.has(rel) && !listed.has(rel)) problems.push(`${rel}: not listed in provenance.json`);
  const moduleOfFile = rel => listed.get(rel)?.modules ?? order;

  const text = rel => fs.readFileSync(path.join(dir, rel), 'utf8');
  const json = rel => { try { return JSON.parse(text(rel)); } catch (error) { blame(moduleOfFile(rel), `${rel}: unreadable (${error.message})`); return null; } };
  // 2. the snapshot's own checksums
  try {
    for (const line of text('studios/SHA256SUMS').split('\n').filter(Boolean)) {
      const m = line.match(/^([0-9a-f]{64}) {2}(\S+)$/);
      if (!m) { blame(order, `studios/SHA256SUMS: malformed line ${JSON.stringify(line)}`); continue; }
      const rel = `studios/${m[2]}`, file = path.join(dir, rel);
      if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== m[1]) blame(moduleOfFile(rel), `${rel}: differs from the snapshot's SHA256SUMS`);
    }
  } catch (error) { blame(order, `studios/SHA256SUMS unreadable (${error.message})`); }

  // 3. the references belong to the frozen sources
  const manifest = json('studios/manifest.json'), volumes = json('studios/r20-modules-volumes.json');
  const state = json('onshape-state.json'), tessellate = json('mesh/tessellate-manifest.json');
  if (!manifest || !volumes || !state || !tessellate) return result();
  if (JSON.stringify(manifest.order) !== JSON.stringify(order)) problems.push(`provenance modules ${order.join(',')} differ from manifest order ${manifest.order?.join(',')}`);
  let fingerprint = null;
  try { fingerprint = tessellateFingerprint(text('onshape-state.json')); } catch (error) { blame(order, `onshape-state.json: no fingerprint (${error.message})`); }
  if (fingerprint && fingerprint !== tessellate.fingerprint)
    blame(order, `mesh/tessellate-manifest.json fingerprint ${String(tessellate.fingerprint).slice(0, 12)} is not the hash ${fingerprint.slice(0, 12)} of onshape-state.json: the meshes were fetched for another Onshape state`);
  if (tessellate.part_studio !== state.partStudio?.id || volumes.part_studio !== state.partStudio?.id)
    blame(order, `part studio differs: meshes ${tessellate.part_studio}, volumes ${volumes.part_studio}, state ${state.partStudio?.id}`);
  if (!String(manifest.params_sha256).startsWith(String(volumes.params_sha)) || !volumes.params_sha)
    blame(order, `volumes params_sha ${volumes.params_sha} is not the manifest's ${String(manifest.params_sha256).slice(0, 16)}`);
  for (const m of order) {
    const entry = provenance.modules[m], mod = manifest.modules?.[m], studio = state.featureStudios?.[m], feature = state.features?.[m];
    const own = message => blame([m], message);
    if (!mod) { own(`studios/manifest.json has no module ${m}`); continue; }
    let source = null;
    try { source = sha256(fs.readFileSync(path.join(dir, entry.source))); } catch (error) { own(`${entry.source}: unreadable (${error.message})`); }
    if (entry.source !== `studios/${m}.fs` || entry.feature !== mod.featureType) own(`provenance module entry ${entry.source}#${entry.feature} is not studios/${m}.fs#${mod.featureType}`);
    if (source && studio?.uploadedSha !== source)
      own(`${entry.source} sha256 ${source.slice(0, 12)} is not the source Onshape built (onshape-state featureStudios.${m}.uploadedSha ${String(studio?.uploadedSha).slice(0, 12)}): the references are stale for this module`);
    if (source && manifest.studios?.[m]?.sha256 !== source) own(`${entry.source} sha256 ${source.slice(0, 12)} differs from manifest.json studios.${m}.sha256`);
    if (feature?.moduleSha !== mod.module_sha256) own(`Onshape feature ${m} was built from module ${String(feature?.moduleSha).slice(0, 12)}, the manifest has ${String(mod.module_sha256).slice(0, 12)}`);
    if (feature?.paramsSha !== manifest.params_sha256) own(`Onshape feature ${m} was built with params ${String(feature?.paramsSha).slice(0, 12)}, the manifest has ${String(manifest.params_sha256).slice(0, 12)}`);
    if (feature?.status !== 'OK') own(`Onshape feature ${m} status is ${feature?.status}`);
    if (volumes.module_stamps?.[m] !== mod.stamp) own(`B-rep volumes were measured on ${volumes.module_stamps?.[m]}, the manifest stamp is ${mod.stamp}`);
    refs[m] = [];
  }
  const keys = Object.keys(volumes.parts ?? {}).sort(), meshKeys = Object.keys(tessellate.parts ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(meshKeys)) blame(order, `volume parts [${keys}] differ from mesh parts [${meshKeys}]`);
  for (const key of keys) {
    const row = volumes.parts[key], mesh = tessellate.parts[key], m = moduleOfDescription(row.description);
    if (!order.includes(m)) { problems.push(`part ${key}: description names no known module (${JSON.stringify(stampOf(row.description))})`); continue; }
    const own = message => blame([m], `part ${key}: ${message}`);
    const [value, min, max] = row.volume_mm3_value_min_max ?? [];
    if (![value, min, max].every(Number.isFinite) || !(value > 0 && min <= value && value <= max)) own(`volume_mm3_value_min_max ${JSON.stringify(row.volume_mm3_value_min_max)} is not [value, min, max]`);
    if (!stampOf(row.description).startsWith(`${manifest.modules[m].stamp} live=`)) own(`description stamp ${JSON.stringify(stampOf(row.description))} is not module ${m}'s ${manifest.modules[m].stamp}`);
    if (!mesh) { own('no reference mesh'); continue; }
    if (mesh.name !== row.name || mesh.part_id !== row.part_id) own(`mesh row ${mesh.part_id} ${JSON.stringify(mesh.name)} is not the volume row ${row.part_id} ${JSON.stringify(row.name)}`);
    const stl = path.join(dir, 'mesh', `${key}.stl`);
    if (!fs.existsSync(stl)) { own(`mesh/${key}.stl missing`); continue; }
    const bytes = fs.readFileSync(stl);
    if (sha256(bytes) !== mesh.sha256) own(`mesh/${key}.stl sha256 differs from mesh/tessellate-manifest.json`);
    if (!(bytes.length >= 84 && bytes.readUInt32LE(80) === mesh.triangles && bytes.length === 84 + 50 * mesh.triangles)) own(`mesh/${key}.stl is not a binary STL of ${mesh.triangles} triangles`);
    (refs[m] ??= []).push({ key, name: row.name, stl, sha256: mesh.sha256, description: row.description,
      volume: { value, min, max, basis: 'onshape-brep' } });
  }
  for (const m of order) {
    const parts = (refs[m] ?? []).map(r => r.key).sort();
    if (JSON.stringify(parts) !== JSON.stringify([...(provenance.modules[m].parts ?? [])].sort())) blame([m], `provenance parts [${provenance.modules[m].parts}] differ from the references' [${parts}]`);
    if (!parts.length) blame([m], 'no reference parts');
  }
  // 4. the import manifests' own checksums (the loader checks them again)
  for (const m of order) {
    const rel = provenance.modules[m].importManifest;
    if (!rel) continue;
    const doc = json(rel);
    if (!doc) continue;
    const store = path.resolve(path.dirname(path.join(dir, rel)), doc.store ?? '.');
    if (!store.startsWith(path.resolve(dir) + path.sep)) { blame([m], `${rel}: store ${doc.store} resolves outside the fixture`); continue; }
    const walk = o => {
      if (!o || typeof o !== 'object') return;
      if (typeof o.file === 'string') {
        const file = path.join(store, o.file);
        if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== o.sha256) blame([m], `${rel}: ${o.file} missing or not its recorded sha256`);
      }
      Object.values(o).forEach(walk);
    };
    walk(doc.modules);
  }
  return result();
}

// Each configured reference is a separate, read-only Onshape evaluation. Never
// fall back to the unblended STL for a module that declares withBlends.
export function verifyBlendFixture(base, dir = path.join(base.dir, 'blends')) {
  const modules = Object.fromEntries(Object.keys(base.provenance.modules).map(m => [m, { problems: [] }]));
  const problems = [], refs = Object.fromEntries(Object.entries(base.refs).map(([m, rows]) => [m, [...rows]]));
  const fail = (m, text) => modules[m].problems.push(text);
  const blended = Object.keys(modules).filter(m => base.provenance.modules[m].liveParams.includes('withBlends'));
  let provenance;
  try { provenance = JSON.parse(fs.readFileSync(path.join(dir, 'provenance.json'), 'utf8')); }
  catch (error) {
    for (const m of blended) fail(m, `blends/provenance.json missing or invalid: ${error.message}`);
    return { ok: false, problems, modules, refs, provenance: null };
  }
  if (provenance.schema !== BLENDS_SCHEMA) problems.push(`blends schema ${provenance.schema}, expected ${BLENDS_SCHEMA}`);
  if (provenance.baseProvenanceSha256 !== sha256(fs.readFileSync(path.join(base.dir, 'provenance.json'))) ||
      provenance.baseStateSha256 !== sha256(fs.readFileSync(path.join(base.dir, 'onshape-state.json'))))
    problems.push('blends frozen G0 provenance or state hash mismatch');
  if (provenance.document !== base.provenance.onshape.document || provenance.workspace !== base.provenance.onshape.workspace ||
      provenance.element !== base.provenance.onshape.partStudio.id || !/^[a-f0-9]{24}$/.test(provenance.microversion ?? ''))
    problems.push('blends document/workspace/element/microversion does not identify the frozen Onshape source');
  const recorded = provenance.modules ?? {};
  for (const m of Object.keys(recorded)) if (!blended.includes(m)) problems.push(`unexpected blended module ${m}`);
  // A baseline is a comparison result, not Onshape source evidence.
  const accounted = new Set(['provenance.json', 'baseline-bend-js.json']);
  for (const m of blended) {
    const source = base.provenance.onshape.featureStudios[m];
    const entry = recorded[m];
    if (!entry) { fail(m, `blends module ${m} missing`); continue; }
    if (entry.configuration !== 'withBlends=true' || entry.sourceSha256 !== source.uploadedSha ||
        entry.sourceMicroversion !== source.sourceMicroversion)
      fail(m, `blends module ${m}: configuration or frozen Feature Studio hash/microversion mismatch`);
    const expected = base.provenance.modules[m].parts;
    if (JSON.stringify(Object.keys(entry.parts ?? {}).sort()) !== JSON.stringify(expected))
      fail(m, `blends module ${m}: parts differ from frozen [${expected}]`);
    refs[m] = [];
    for (const key of expected) {
      const p = entry.parts?.[key], rel = `mesh/${key}.stl`;
      if (!p) { fail(m, `${rel} missing metadata`); continue; }
      if (accounted.has(rel)) { fail(m, `${rel} duplicate`); continue; }
      accounted.add(rel);
      if (p.configuration !== entry.configuration || !Number.isFinite(Date.parse(p.fetchedAt)) ||
          !['parts', 'tessellatedfaces', 'massproperties', 'boundingboxes'].every(k => {
            const endpoint = p.endpoints?.[k];
            if (typeof endpoint !== 'string' || !endpoint.startsWith('/api/')) return false;
            const url = new URL(endpoint, 'https://fixture.invalid');
            const prefix = k === 'parts' ? '/api/parts' : '/api/partstudios';
            const suffix = `/d/${provenance.document}/m/${provenance.microversion}/e/${provenance.element}`;
            return url.pathname === `${prefix}${suffix}${k === 'parts' ? '' : `/${k}`}` &&
              url.searchParams.get('configuration') === entry.configuration;
          }))
        fail(m, `${rel}: configuration, fetch time or immutable read-only endpoint missing`);
      if (p.name !== base.refs[m].find(r => r.key === key)?.name ||
          !stampOf(p.description).startsWith(`${base.provenance.modules[m].stamp} live=`) ||
          !stampOf(p.description).includes('withBlends:true'))
        fail(m, `${rel}: name or blended live-parameter stamp mismatch`);
      const [value, min, max] = p.volume_mm3_value_min_max ?? [];
      if (![value, min, max].every(Number.isFinite) || !(value > 0 && min <= value && value <= max))
        fail(m, `${rel}: invalid B-rep volume uncertainty range`);
      if (!Array.isArray(p.bbox_mm) || p.bbox_mm.length !== 6 || !p.bbox_mm.every(Number.isFinite) ||
          ![0, 1, 2].every(i => p.bbox_mm[i] <= p.bbox_mm[i + 3]))
        fail(m, `${rel}: invalid B-rep bounding box`);
      let bytes;
      try { bytes = fs.readFileSync(path.join(dir, rel)); }
      catch { fail(m, `${rel} missing`); continue; }
      if (sha256(bytes) !== p.sha256 || bytes.length !== p.bytes || bytes.length < 84 ||
          bytes.readUInt32LE(80) !== p.triangles || bytes.length !== 84 + 50 * p.triangles)
        fail(m, `${rel}: sha256, size or binary STL triangle count mismatch`);
      else {
        const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < p.triangles; i++) for (let vertex = 0; vertex < 3; vertex++)
          for (let axis = 0; axis < 3; axis++) {
            const x = bytes.readFloatLE(84 + 50 * i + 12 + 12 * vertex + 4 * axis);
            low[axis] = Math.min(low[axis], x);
            high[axis] = Math.max(high[axis], x);
          }
        if (JSON.stringify([...low, ...high]) !== JSON.stringify(p.bbox_mm))
          fail(m, `${rel}: bbox_mm does not match the frozen STL vertices`);
      }
      refs[m].push({ key, name: p.name, stl: path.join(dir, rel), sha256: p.sha256,
        description: p.description, volume: { value, min, max, basis: 'onshape-brep' } });
    }
  }
  for (const rel of walkFiles(dir)) if (!accounted.has(rel)) problems.push(`blends/${rel}: unlisted file`);
  return { ok: !problems.length && Object.values(modules).every(v => !v.problems.length), problems, modules, refs, provenance };
}

// --- running one module --------------------------------------------------------------

function git(...args) { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }); } catch { return null; } }
// What the build of a module depends on besides the fixture: the code at HEAD
// plus uncommitted changes of bin/, src/ and kernel/ (untracked files by content).
function codeState() {
  const head = git('rev-parse', 'HEAD')?.trim() ?? null;
  const diff = git('diff', 'HEAD', '--binary', '--', 'bin', 'src', 'kernel') ?? '';
  const untracked = (git('ls-files', '--others', '--exclude-standard', '--', 'bin', 'src', 'kernel') ?? '').split('\n').filter(Boolean)
    .map(f => `${f}:${sha256(fs.readFileSync(path.join(ROOT, f)))}`);
  return { head, dirty: Boolean(diff || untracked.length), sha256: sha256(`${head}\n${diff}\n${untracked.join('\n')}`) };
}

function spawnCli(args, env, timeoutS) {
  return new Promise(resolve => {
    const started = process.hrtime.bigint();
    const child = spawn(process.execPath, ['--import', GUARD, CLI, ...args], { cwd: ROOT, env: { ...env, NODE_OPTIONS: env.NODE_OPTIONS ?? '--max-old-space-size=8192' } });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }, timeoutS * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code, signal, timedOut, stdout, stderr, seconds: +(Number(process.hrtime.bigint() - started) / 1e9).toFixed(2) });
    });
  });
}

const relative = p => (p.startsWith(ROOT + path.sep) ? path.relative(ROOT, p) : p);

export const isNamedCapabilityRefusal = error =>
  ['UnsupportedFeatureError', 'NativeCapabilityError', 'RustCapabilityError'].includes(error?.class);

export async function runModule(m, fixture, opts) {
  const entry = fixture.provenance.modules[m], moduleDir = path.join(opts.out, m);
  const exportDir = path.join(moduleDir, 'r20'), guardLog = path.join(moduleDir, 'bend-guard.json'), buildFile = path.join(moduleDir, 'build.json');
  const args = [path.join(fixture.dir, entry.source), '--feature', entry.feature,
    ...(entry.liveParams.includes('withBlends') ? ['--param', `withBlends=${opts.blends ? 'true' : 'false'}`] : []),
    ...(opts.modelingPolicy?.curvedContacts === 'tolerated-regularized' ? ['--curved-contacts','tolerated-regularized','--contact-cap-mm',String(opts.modelingPolicy.contactCapMm)] : []),
    '--format', 'r20-check', '--deviation-mm', String(opts.deviation), '--out', exportDir,
    ...(entry.importManifest ? ['--modules', path.join(fixture.dir, entry.importManifest)] : [])];
  const row = { module: m, feature: entry.feature, backend: opts.backend, command: `node --import ${relative(GUARD)} bin/wonky.mjs ${args.map(relative).join(' ')}`,
    parts: [], expectedParts: fixture.refs[m]?.map(r => r.key) ?? entry.parts };
  if (fixture.modules[m]?.problems.length) return { ...row, status: 'PROVENANCE', reason: fixture.modules[m].problems.join('; ') };

  const key = sha256(JSON.stringify({ provenance: sha256(fs.readFileSync(path.join(fixture.dir, 'provenance.json'))), fixture: path.resolve(fixture.dir), m, args: args.map(relative), backend: opts.backend, code: opts.code.sha256 }));
  let build = null;
  if (opts.reuseBuilds && fs.existsSync(buildFile)) {
    const recorded = JSON.parse(fs.readFileSync(buildFile, 'utf8'));
    if (recorded.key === key && fs.existsSync(guardLog)) build = { ...recorded, reused: true };
  }
  if (!build) {
    fs.rmSync(moduleDir, { recursive: true, force: true });
    fs.mkdirSync(moduleDir, { recursive: true });
    const env = { ...process.env, WONKY_BEND_GUARD_LOG: guardLog };
    const run = await spawnCli(args, env, opts.timeout);
    fs.writeFileSync(path.join(moduleDir, 'cli.log'), `$ ${row.command}\nexit ${run.exitCode}${run.signal ? ` signal ${run.signal}` : ''}${run.timedOut ? ' (timeout)' : ''}\n--- stdout\n${run.stdout}\n--- stderr\n${run.stderr}`);
    build = { key, exitCode: run.exitCode, signal: run.signal, timedOut: run.timedOut, seconds: run.seconds, stderrTail: run.stderr.trim().split('\n').slice(-3), code: opts.code, at: new Date().toISOString() };
    fs.writeFileSync(buildFile, JSON.stringify(build, null, 1) + '\n');
  }
  Object.assign(row, { exitCode: build.exitCode, timedOut: build.timedOut, seconds: build.seconds, reused: Boolean(build.reused) });

  // the Bend guard
  let guard = null;
  try { guard = JSON.parse(fs.readFileSync(guardLog, 'utf8')).summary; } catch (error) { guard = { error: `bend-guard log unreadable: ${error.message}` }; }
  row.guard = { ...guard, required: opts.requireNoBend, ok: !guard.error && (!opts.requireNoBend || guard.bendLoaded === false) };

  const built = build.exitCode === 0 && !build.timedOut;
  if (!built) {
    const errorJson = path.join(exportDir, 'error.json');
    const error = fs.existsSync(errorJson) ? JSON.parse(fs.readFileSync(errorJson, 'utf8')) : { message: build.timedOut ? `timeout after ${opts.timeout} s` : `exit ${build.exitCode}${build.signal ? ` (${build.signal})` : ''}: ${build.stderrTail.join(' / ')}` };
    row.error = { class: error.class ?? null, file: error.file ? relative(error.file) : null, line: error.line ?? null, column: error.column ?? null,
      operation: error.operation?.id ?? null, message: error.message,
      ...(error.regularization ? {regularization:error.regularization} : {}) };
    // Only typed capability refusals are named; runtime failures must stay FAIL.
    const named = isNamedCapabilityRefusal(error);
    row.status = named && row.guard.ok ? 'REFUSED' : 'FAIL';
    const location = row.error.line != null ? ` at ${path.basename(row.error.file ?? '?')}:${row.error.line}:${row.error.column}` : '';
    row.reason = !row.guard.ok ? `${build.timedOut ? `build timed out after ${opts.timeout}s; ` : ''}${guard.error ? 'Bend-free guard evidence unavailable' : 'Bend was loaded'}: ${JSON.stringify(guard.markers ?? guard)}` : named ? `refused by name${location}: ${row.error.message}` : `stopped without a named capability error: ${row.error.class ?? 'no error.json'}`;
    return row;
  }

  let read;
  try { read = readR20Export(exportDir, { wonky: true }); }
  catch (error) { return { ...row, status: 'FAIL', reason: `built, but the export could not be read: ${error.message}` }; }
  row.reader = { ok: read.ok, problems: read.problems };
  for (const ref of fixture.refs[m]) {
    const p = read.parts[ref.key];
    if (!p) { row.parts.push({ key: ref.key, name: ref.name, built: false, ok: false }); continue; }
    const ours = { key: p.key, name: p.name, triangles: p.triangles, volumeMm3: p.row.wonky?.volumeMm3 ?? null, exact: p.row.wonky?.exact ?? null,
      approximation: p.row.wonky?.approximation ?? null, achievedDeviationMm: p.row.wonky?.achievedDeviationMm ?? null,
      meshDeviationMm: p.row.wonky?.meshDeviationMm ?? null, float32RoundingMm: p.row.wonky?.float32RoundingMm ?? null };
    const c = compare(ours, ref, { deviation: opts.deviation, samples: opts.samples });
    const oursStamp = stampOf(p.row.description), refStamp = stampOf(ref.description);
    c.checks.stamp = { ok: oursStamp === refStamp && p.name === ref.name, ours: oursStamp, ref: refStamp };
    c.ok = CHECKS.every(k => c.checks[k].ok);
    row.parts.push({ built: true, ...c });
  }
  row.extraParts = Object.keys(read.parts).filter(k => !fixture.refs[m].some(r => r.key === k));
  const failed = row.parts.flatMap(p => (p.built ? CHECKS.filter(k => !p.checks[k].ok).map(k => `${p.key} ${k}`) : [`${p.key} not built`]));
  const ok = !failed.length && !row.extraParts.length && read.ok && row.guard.ok;
  row.status = ok ? 'PASS' : 'FAIL';
  row.reason = ok ? 'built; every part passes every check' : [...failed, ...row.extraParts.map(k => `extra part ${k}`),
    ...read.problems.map(p => `reader: ${p}`), ...(row.guard.ok ? [] : [`${build.timedOut ? `build timed out after ${opts.timeout}s; ` : ''}${guard.error ? 'Bend-free guard evidence unavailable' : 'Bend was loaded'}: ${JSON.stringify(guard.markers ?? guard)}`])].join('; ');
  return row;
}

// --- summary, baseline --------------------------------------------------------------------

export function summarize(rows) {
  const parts = rows.flatMap(r => r.expectedParts.map(key => r.parts.find(p => p.key === key) ?? { key, built: false }));
  const count = check => parts.filter(p => p.built && p.checks[check].ok).length;
  return {
    modules: { total: rows.length, built: rows.filter(r => r.exitCode === 0 && !r.timedOut).length,
      ...Object.fromEntries(['PASS', 'FAIL', 'REFUSED', 'PROVENANCE'].map(s => [s.toLowerCase(), rows.filter(r => r.status === s).length])) },
    parts: { total: parts.length, built: parts.filter(p => p.built).length, allChecks: parts.filter(p => p.ok).length,
      ...Object.fromEntries(CHECKS.map(k => [k, count(k)])) },
  };
}

// Compact per-part record: which checks passed and the numbers behind them.
export function baselineOf(report) {
  return { schema: BASELINE_SCHEMA, generatedAt: report.generatedAt, backend: report.backend, blends: report.blends ?? false, code: report.code,
    fixture: report.fixture, deviationMm: report.deviationMm, samples: report.samples, summary: report.summary,
    modules: Object.fromEntries(report.modules.map(r => [r.module, { status: r.status, seconds: r.seconds, error: r.error ?? null,
      bendLoaded: r.guard?.bendLoaded ?? null,
      parts: Object.fromEntries(r.expectedParts.map(key => {
        const p = r.parts.find(x => x.key === key);
        if (!p?.built) return [key, { built: false }];
        return [key, { built: true, ok: p.ok, checks: Object.fromEntries(CHECKS.map(k => [k, p.checks[k].ok])),
          volumeMm3: p.checks.volume.oursMm3, volumeBasis: p.checks.volume.basis, volumeRelative: p.checks.volume.relative,
          bboxDeltaMm: p.checks.bbox.maxDeltaMm, hausdorffMm: p.checks.hausdorff.mm, toleranceMm: p.toleranceMm,
          statementAllowedMm: p.checks.statement.allowedMm, exact: p.exact, approximation: p.approximation }];
      })) }])) };
}

// Everything that was fine in the baseline and is not now.
export function regressions(baseline, rows) {
  if (baseline?.schema !== BASELINE_SCHEMA) throw new Error(`baseline schema ${baseline?.schema}, expected ${BASELINE_SCHEMA}`);
  const now = baselineOf({ modules: rows }).modules, out = [];
  for (const r of rows) {
    const before = baseline.modules[r.module];
    if (!before) continue;
    if (before.status === 'PASS' && r.status !== 'PASS') out.push(`${r.module}: PASS -> ${r.status}`);
    if (before.status === 'REFUSED' && !['PASS', 'REFUSED'].includes(r.status)) out.push(`${r.module}: REFUSED -> ${r.status}`);
    for (const [key, b] of Object.entries(before.parts)) {
      const n = now[r.module].parts[key];
      if (b.built && !n?.built) { out.push(`${r.module}/${key}: built -> not built`); continue; }
      for (const [check, ok] of Object.entries(b.checks ?? {})) if (ok && !n.checks[check]) out.push(`${r.module}/${key}: ${check} ok -> failed`);
    }
  }
  return out;
}

// --- report ----------------------------------------------------------------------------

const fmt = (x, d = 6) => (x == null ? '-' : Number.isFinite(x) ? (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : x.toFixed(d).replace(/\.?0+$/, '')) : String(x));
function table(rows) {
  const out = ['| module | status | s | part | volume ours / Onshape (rel, basis) | bbox Δ mm | Hausdorff / tol mm | failed checks |', '|---|---|---:|---|---|---:|---:|---|'];
  for (const r of rows) {
    const lines = r.expectedParts.map(key => r.parts.find(p => p.key === key) ?? { key, built: false });
    lines.forEach((p, i) => {
      const head = i ? '| | | |' : `| ${r.module} | ${r.status}${r.reused ? ' (reused build)' : ''} | ${r.seconds ?? '-'} |`;
      if (!p.built) { out.push(`${head} ${p.key} | not built${i ? '' : `: ${r.reason}`} | - | - | - |`); return; }
      const v = p.checks.volume;
      out.push(`${head} ${p.key} | ${fmt(v.oursMm3)} / ${fmt(v.refMm3)} (${fmt(v.relative)}, ${v.basis}${p.approximation ? ` ${p.approximation.kind ?? 'approximation'}` : ''}) | ${fmt(p.checks.bbox.maxDeltaMm, 4)} | ${fmt(p.checks.hausdorff.mm, 4)} / ${fmt(p.toleranceMm, 4)} | ${CHECKS.filter(k => !p.checks[k].ok).join(', ') || '-'} |`);
    });
  }
  return out.join('\n');
}

function parseArgs(argv) {
  const backend = process.env.WONKY_BACKEND ?? 'js';
  const opts = { fixtures: FIXTURE_DIR, out: path.join(ROOT, 'out/r20-modules'), only: null, deviation: 0.01, samples: 20000, timeout: 900,
    reuseBuilds: false, requireNoBend: backend === 'rust', baseline: null, writeBaseline: null, backend, blends: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], next = () => { if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`); return argv[++i]; };
    if (arg === '--blends') opts.blends = true;
    else if (arg === '--fixtures') opts.fixtures = path.resolve(next());
    else if (arg === '--out') opts.out = path.resolve(next());
    else if (arg === '--only') opts.only = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--deviation') opts.deviation = Number(next());
    else if (arg === '--samples') opts.samples = Number(next());
    else if (arg === '--timeout') opts.timeout = Number(next());
    else if (arg === '--reuse-builds') opts.reuseBuilds = true;
    else if (arg === '--require-no-bend') opts.requireNoBend = true;
    else if (arg === '--curved-contacts') opts.curvedContacts = next();
    else if (arg === '--contact-cap-mm') opts.contactCapMm = Number(next());
    else if (arg === '--baseline') opts.baseline = path.resolve(next());
    else if (arg === '--write-baseline') opts.writeBaseline = path.resolve(next());
    else if (arg === '--help' || arg === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0]); process.exit(0); }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!(opts.deviation > 0) || !(opts.samples >= 0) || !(opts.timeout > 0)) throw new Error('--deviation, --samples and --timeout expect positive numbers');
  if (opts.blends && !argv.includes('--out')) opts.out = path.join(ROOT, 'out/r20-modules-blends');
  opts.modelingPolicy = normalizeModelingPolicy({curvedContacts:opts.curvedContacts ?? 'strict',
    ...(opts.contactCapMm === undefined ? {} : {contactCapMm:opts.contactCapMm})});
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const fixture = verifyFixture(opts.fixtures);
  if (!fixture.provenance) throw new Error(`fixture ${opts.fixtures} unusable: ${fixture.problems.join('; ')}`);
  if (opts.blends) {
    const variant = verifyBlendFixture(fixture);
    fixture.refs = variant.refs;
    fixture.problems.push(...variant.problems);
    for (const [m, row] of Object.entries(variant.modules)) fixture.modules[m].problems.push(...row.problems, ...variant.problems);
    fixture.blendsProvenanceSha256 = variant.provenance ? sha256(fs.readFileSync(path.join(opts.fixtures, 'blends/provenance.json'))) : null;
    fixture.ok = fixture.ok && variant.ok;
  }
  const all = Object.keys(fixture.provenance.modules);
  const unknown = (opts.only ?? []).filter(m => !all.includes(m));
  if (unknown.length) throw new Error(`unknown module(s) ${unknown.join(', ')}; the fixture has ${all.join(', ')}`);
  const selected = opts.only ? all.filter(m => opts.only.includes(m)) : all;
  opts.code = codeState();
  fs.mkdirSync(opts.out, { recursive: true });
  process.stderr.write(`r20 modules: ${selected.join(', ')}; blends ${opts.blends}; backend ${opts.backend}; deviation ${opts.deviation} mm; require-no-bend ${opts.requireNoBend}; fixture ${relative(opts.fixtures)} (${fixture.ok ? 'provenance ok' : 'PROVENANCE PROBLEMS'})\n`);
  for (const p of fixture.problems) process.stderr.write(`  provenance: ${p}\n`);
  const rows = [];
  for (const m of selected) {
    const row = await runModule(m, fixture, opts);
    process.stderr.write(`  ${m}: ${row.status}${row.reused ? ' (reused build)' : ''} ${row.seconds ?? '-'} s: ${row.reason}\n`);
    rows.push(row);
  }
  const report = { schema: 'wonky/r20-modules-report/1', generatedAt: new Date().toISOString(), backend: opts.backend, blends: opts.blends, requireNoBend: opts.requireNoBend, modelingPolicy:opts.modelingPolicy,
    code: opts.code, fixture: { dir: relative(opts.fixtures), provenanceSha256: sha256(fs.readFileSync(path.join(opts.fixtures, 'provenance.json'))), blendsProvenanceSha256: fixture.blendsProvenanceSha256 ?? null, problems: fixture.problems },
    deviationMm: opts.deviation, samples: opts.samples, selected, summary: summarize(rows), modules: rows };
  if (opts.baseline) {
    const baseline = JSON.parse(fs.readFileSync(opts.baseline, 'utf8'));
    if (Boolean(baseline.blends) !== opts.blends ||
        baseline.fixture?.provenanceSha256 !== report.fixture.provenanceSha256 ||
        (opts.blends && baseline.fixture?.blendsProvenanceSha256 !== report.fixture.blendsProvenanceSha256))
      throw new Error('baseline belongs to a different configuration or frozen fixture');
    report.regressions = regressions(baseline, rows);
  }
  fs.writeFileSync(path.join(opts.out, 'report.json'), JSON.stringify(report, null, 1) + '\n');
  const md = table(rows);
  fs.writeFileSync(path.join(opts.out, 'report.md'), md + '\n');
  if (opts.writeBaseline) fs.writeFileSync(opts.writeBaseline, JSON.stringify(baselineOf(report), null, 1) + '\n');
  console.log(md);
  const s = report.summary;
  console.log(`\nmodules: ${s.modules.pass} PASS, ${s.modules.refused} REFUSED, ${s.modules.fail} FAIL, ${s.modules.provenance} PROVENANCE (built ${s.modules.built}/${s.modules.total})`);
  console.log(`parts: built ${s.parts.built}/${s.parts.total}; ${CHECKS.map(k => `${k} ${s.parts[k]}`).join(', ')}; all checks ${s.parts.allChecks}`);
  if (report.regressions) console.log(`regressions against ${relative(opts.baseline)}: ${report.regressions.length ? report.regressions.join('; ') : 'none'}`);
  console.log(`report: ${relative(path.join(opts.out, 'report.json'))}`);
  const provenanceProblems = fixture.problems.length > 0 || rows.some(r => r.status === 'PROVENANCE');
  process.exitCode = report.regressions ? (report.regressions.length || provenanceProblems ? 1 : 0) : rows.every(r => r.status === 'PASS') && !fixture.problems.length ? 0 : 1;
}

const invoked = process.argv[1] && fs.existsSync(process.argv[1]) ? fs.realpathSync(process.argv[1]) : null;
if (invoked === fs.realpathSync(fileURLToPath(import.meta.url)))
  main().catch(error => { console.error(`r20 modules: ${error.stack ?? error.message}`); process.exitCode = 2; });
