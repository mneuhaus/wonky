// Freezes the R20 module gate's inputs into fixtures/r20-modules/ (package G0,
// docs/rust-migration.md section 6) and writes their provenance. Byte copies
// only, nothing is regenerated or rewritten:
//
//   studios/        the 8 FeatureScript studios, manifest.json,
//                   r20-modules-volumes.json (Onshape B-rep volumes) and
//                   SHA256SUMS of the studio snapshot (default
//                   tmp/r20-studios-snapshot-0925-2041 of the main checkout)
//   mesh/           the 33 Onshape reference STLs and tessellate-manifest.json
//                   (R20 project var/mesh, var/state)
//   onshape-state.json
//                   the R20 project's var/state/onshape.json: which studio
//                   bytes Onshape built, with which live parameters; the
//                   tessellation fingerprint is a hash of it
//   onshape-store/  the context/probe import manifests at their original
//                   relative location (so their `store: "../../../../.."`
//                   still resolves) plus exactly the files they reference
//   provenance.json origin path, sha256 and bytes of every file above, the
//                   modules that depend on it, the Onshape document, studios
//                   and parameters
//
//   node scripts/r20/freeze-modules.mjs [--snapshot <dir>] [--r20 <dir>]
//        [--store <var/onshape-store>] [--out fixtures/r20-modules] [--force]
//
// It refuses to write when the snapshot's SHA256SUMS fail or when the frozen
// tree does not verify (scripts/r20/modules.mjs verifyFixture: a reference
// that belongs to another revision is reported, not frozen as current).
// Reads the R20 project read-only; never calls Onshape.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyFixture, PROVENANCE_SCHEMA, IMPORT_MANIFEST_DIR, moduleOfDescription } from './modules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAIN_CHECKOUT = path.resolve(ROOT, fs.existsSync(path.join(ROOT, '.git')) && fs.statSync(path.join(ROOT, '.git')).isFile()
  ? fs.readFileSync(path.join(ROOT, '.git'), 'utf8').match(/gitdir: (.*)\/\.git\/worktrees\//)?.[1] ?? ROOT : ROOT);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function parseArgs(argv) {
  const opts = { snapshot: path.join(MAIN_CHECKOUT, 'tmp/r20-studios-snapshot-0925-2041'),
    r20: path.join(os.homedir(), 'Workspace/cad/cad-project-041/single-step-r20'), store: path.join(MAIN_CHECKOUT, 'var/onshape-store'),
    out: path.join(ROOT, 'fixtures/r20-modules'), force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], next = () => { if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`); return path.resolve(argv[++i]); };
    if (arg === '--snapshot') opts.snapshot = next();
    else if (arg === '--r20') opts.r20 = next();
    else if (arg === '--store') opts.store = next();
    else if (arg === '--out') opts.out = next();
    else if (arg === '--force') opts.force = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return opts;
}

function checkSums(dir) {
  const lines = fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8').split('\n').filter(Boolean);
  const bad = lines.map(l => l.match(/^([0-9a-f]{64}) {2}(.+)$/)).filter(m => !m || sha256(fs.readFileSync(path.join(dir, m[2]))) !== m[1]);
  if (bad.length || !lines.length) throw new Error(`${dir}/SHA256SUMS does not verify (${bad.length} of ${lines.length} lines)`);
  return lines.map(l => l.slice(66));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (fs.existsSync(opts.out) && !opts.force) throw new Error(`${opts.out} exists; pass --force to refreeze it`);
  const snapshotFiles = checkSums(opts.snapshot);
  const manifest = JSON.parse(fs.readFileSync(path.join(opts.snapshot, 'manifest.json'), 'utf8'));
  const volumes = JSON.parse(fs.readFileSync(path.join(opts.snapshot, 'r20-modules-volumes.json'), 'utf8'));
  const order = manifest.order;
  const partModule = Object.fromEntries(Object.entries(volumes.parts).map(([key, row]) => [key, moduleOfDescription(row.description)]));

  const staging = fs.mkdtempSync(path.join(path.dirname(opts.out), '.r20-modules-'));
  const files = [];
  const copy = (from, rel, modules) => {
    const to = path.join(staging, rel), bytes = fs.readFileSync(from);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, bytes);
    files.push({ path: rel, origin: from, sha256: sha256(bytes), bytes: bytes.length, modules });
  };
  // studios: a studio file concerns its module, everything else every module
  for (const name of [...snapshotFiles, 'SHA256SUMS'])
    copy(path.join(opts.snapshot, name), `studios/${name}`, order.includes(name.replace(/\.fs$/, '')) && name.endsWith('.fs') ? [name.replace(/\.fs$/, '')] : order);
  const tessellate = JSON.parse(fs.readFileSync(path.join(opts.r20, 'var/state/tessellate-manifest.json'), 'utf8'));
  for (const key of Object.keys(tessellate.parts).sort())
    copy(path.join(opts.r20, 'var/mesh', `${key}.stl`), `mesh/${key}.stl`, partModule[key] ? [partModule[key]] : order);
  copy(path.join(opts.r20, 'var/state/tessellate-manifest.json'), 'mesh/tessellate-manifest.json', order);
  copy(path.join(opts.r20, 'var/state/onshape.json'), 'onshape-state.json', order);
  const imports = {};
  for (const module of order) {
    const rel = `${IMPORT_MANIFEST_DIR}/${module}.fs.json`, from = path.join(opts.store, rel.replace(/^onshape-store\//, ''));
    if (!fs.existsSync(from)) continue;
    copy(from, rel, [module]);
    imports[module] = rel;
  }
  // the files the import manifests reference, once, with every module using them
  const referenced = new Map();
  for (const [module, rel] of Object.entries(imports)) {
    const doc = JSON.parse(fs.readFileSync(path.join(staging, rel), 'utf8'));
    const walk = o => { if (o && typeof o === 'object') { if (typeof o.file === 'string') referenced.set(o.file, [...(referenced.get(o.file) ?? []), module]); Object.values(o).forEach(walk); } };
    walk(doc.modules);
  }
  for (const [file, modules] of [...referenced].sort(([a], [b]) => a.localeCompare(b)))
    copy(path.join(opts.store, file), `onshape-store/${file}`, [...new Set(modules)]);

  const state = JSON.parse(fs.readFileSync(path.join(opts.r20, 'var/state/onshape.json'), 'utf8'));
  const provenance = {
    schema: PROVENANCE_SCHEMA,
    frozenAt: new Date().toISOString(),
    frozenBy: 'scripts/r20/freeze-modules.mjs (package G0, docs/rust-migration.md section 6)',
    origin: { snapshot: opts.snapshot, r20Project: opts.r20, onshapeStore: opts.store },
    onshape: {
      document: state.document, workspace: state.workspace, partStudio: state.partStudio,
      featureStudios: Object.fromEntries(order.map(m => [m, (({ id, name, uploadedSha, uploadedAt, sourceMicroversion }) => ({ id, name, uploadedSha, uploadedAt, sourceMicroversion }))(state.featureStudios[m])])),
      tessellation: { fingerprint: tessellate.fingerprint, tool: 'R20 project tools/tessellate.py (tessellatedfaces, angleTolerance 0.05 rad)' },
      volumes: { note: volumes.note, paramsSha: volumes.params_sha },
    },
    blends: 'withBlends=false (decision E1, Marc 2026-09-26): passed to every module that declares it; the Onshape references were built with it',
    modules: Object.fromEntries(order.map(m => [m, {
      source: `studios/${m}.fs`, feature: manifest.modules[m].featureType, stamp: manifest.modules[m].stamp,
      liveParams: manifest.modules[m].live, onshapeValues: state.features[m].values,
      importManifest: imports[m] ?? null,
      parts: Object.keys(partModule).filter(k => partModule[k] === m).sort(),
    }])),
    files,
  };
  fs.writeFileSync(path.join(staging, 'provenance.json'), JSON.stringify(provenance, null, 1) + '\n');
  const verified = verifyFixture(staging);
  const problems = [...verified.problems, ...Object.entries(verified.modules).flatMap(([m, v]) => v.problems.map(p => `${m}: ${p}`))];
  if (problems.length) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new Error(`the frozen tree does not verify; nothing written:\n  ${problems.join('\n  ')}`);
  }
  fs.rmSync(opts.out, { recursive: true, force: true });
  fs.renameSync(staging, opts.out);
  console.log(`froze ${files.length} files (${(files.reduce((s, f) => s + f.bytes, 0) / 1e6).toFixed(2)} MB) into ${path.relative(ROOT, opts.out)}; verified: 0 problems`);
}

try { main(); } catch (error) { console.error(`freeze-modules: ${error.message}`); process.exitCode = 1; }
