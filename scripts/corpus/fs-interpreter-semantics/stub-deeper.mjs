// Second-level next-blocker probe for the two largest follow-up blockers of
// cluster fs-interpreter-semantics. Copies family representatives to
// tmp/corpus/fs-interpreter-semantics/stub-deeper/ and replaces, in the COPY only:
//   qGeometry(qOwnedByBody(q,EntityType.EDGE),GeometryType.LINE)
//     -> lineEdgesStub(context, qOwnedByBody(q,EntityType.EDGE)), an FS helper
//        that keeps the edges evLine accepts (same set as the LINE filter);
//   toString(v) -> an FS helper returning "" ~ v (FS toString of bool/number);
//   lochwand only (case.skipCuts): lwCut deletes its tool and returns the target
//     unchanged, so every subtraction is skipped (geometry is then NOT the
//     model's; the run only shows what else, besides the cut, blocks the build).
// Then runs the production build entrypoint with the prototype fix in memory
// (./prototype/register.mjs) through ./probe-params.mjs. One process at a time.
//
// Usage: node scripts/corpus/fs-interpreter-semantics/stub-deeper.mjs
// Writes out/corpus/fs-interpreter-semantics/stub-deeper.jsonl; appends uptime to run-meta.jsonl.
import { spawnSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadavg } from 'node:os';
import { REPO, CORPUS_ROOT, TMP_DIR, OUT_DIR } from '../lib.mjs';

const here = join(REPO, 'scripts/corpus/fs-interpreter-semantics');
const dir = join(TMP_DIR, 'fs-interpreter-semantics', 'stub-deeper');
const outDir = join(OUT_DIR, 'fs-interpreter-semantics');
mkdirSync(dir, { recursive: true }); mkdirSync(outDir, { recursive: true });
const uptime = () => { try { return execSync('uptime', { encoding: 'utf8' }).trim(); } catch { return null; } };
const meta = record => appendFileSync(join(outDir, 'run-meta.jsonl'), JSON.stringify({ at: new Date().toISOString(), runner: 'fs-interpreter-semantics/stub-deeper', ...record }) + '\n');

const zAxisPs = { position: '61.28756 * millimeter', railLength: '160 * millimeter', pitchX: '15 * millimeter', pitchZ: '16 * millimeter', railEnd: '10 * millimeter',
  driveCenters: '144 * millimeter', probeClearance: '3.3 * millimeter', beltAdjust: '3 * millimeter', hardware: 'true', probeDeployed: 'false' };
const cases = [
  { path: 'cad-project-043/fsocct/cases/workspace/sparky_z.fs', family: 'fs560', params: zAxisPs, note: 'representative of fs560 (21 files), Part Studio parameter values' },
  { path: 'cad-project-040/archive/r12/before-wagon-web-r13/z-axis-live.fs', family: 'fs560', params: zAxisPs, note: 'live r12 revision, Part Studio parameter values' },
  { path: 'cad-project-041/archiv/gt2-linie/single-stage-gt2-mini-r3/native/pcb-final-checked.fs', family: 'fs473', params: {}, note: 'representative of fs473' },
  { path: 'cad-project-041/archiv/gt2-linie/single-stage-gt2-r1/single-stage.fs', family: 'fs476', params: {}, note: 'representative of fs476' },
  { path: 'cad-project-041/archiv/gt2-linie/single-stage-gt2-r1/archive/fixed-rails-first-native.fs', family: 'fs475', params: {}, note: 'representative of fs475' },
  { path: 'cad-project-020/lochwand/topo-native/source.fs', family: 'fs233', params: {}, note: 'representative of fs233, all lwCut subtractions skipped', skipCuts: true },
  { path: 'cad-project-043/fsocct/cases/workspace/lochwand.fs', family: 'fs554', params: {}, note: 'copy of lochwand/job/source.fs, all lwCut subtractions skipped', skipCuts: true },
];
const helpers = `
// --- stub-deeper helpers (tmp copy only) ---
function lineEdgesStub(context is Context, q is Query) returns array
{
 var out = [];
 for (var e in evaluateQuery(context, q)) { var l = try silent(evLine(context, { "edge" : e })); if (l != undefined) out = append(out, e); }
 return out;
}
function toString(v) { return "" ~ v; }
`;
const onlyArg = process.argv.indexOf('--only'); const only = onlyArg >= 0 ? process.argv[onlyArg + 1] : null;
if (only) cases.splice(0, cases.length, ...cases.filter(c => c.path.includes(only)));
const results = [];
meta({ event: 'start', cases: cases.length, uptime: uptime(), loadavg: loadavg() });
for (const c of cases) {
  let text = readFileSync(join(CORPUS_ROOT, c.path), 'utf8');
  const q = /evaluateQuery\(context,qGeometry\(qOwnedByBody\(q,EntityType\.EDGE\),GeometryType\.LINE\)\)/g;
  const nGeometry = (text.match(q) ?? []).length;
  text = text.replace(q, 'lineEdgesStub(context,qOwnedByBody(q,EntityType.EDGE))');
  const nToString = (text.match(/\btoString\(/g) ?? []).length;
  let nCuts = 0;
  if (c.skipCuts) {
    const cut = /(function lwCut\(context is Context, ?id is Id, ?a is Query, ?b is Query\) returns Query\s*\{)\s*opBoolean\([^;]*\);\s*return [^;]*;\s*\}/;
    if (!cut.test(text)) throw new Error(`lwCut not found in ${c.path}`);
    text = text.replace(cut, '$1 opDeleteBodies(context, id, { "entities" : b }); return a; }'); nCuts = 1;
  }
  const importEnd = text.indexOf(';', text.indexOf('import(')) + 1;
  text = text.slice(0, importEnd) + helpers + text.slice(importEnd);
  const file = join(dir, c.path.replace(/\//g, '__'));
  writeFileSync(file, text);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--import', join(here, 'prototype/register.mjs'), join(here, 'probe-params.mjs'), file, '', JSON.stringify(c.params)],
    { cwd: REPO, encoding: 'utf8', timeout: 480_000, killSignal: 'SIGKILL', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'WONKY_BACKEND' && k !== 'NODE_OPTIONS')) });
  let probe; try { probe = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { probe = { ok: null, note: r.error ? String(r.error) : `no JSON (status ${r.status})`, stderrTail: (r.stderr ?? '').slice(-600) }; }
  const row = { ...c, stubbed: { qGeometry: nGeometry, toString: nToString, lwCut: nCuts }, file: file.replace(REPO + '/', ''), wallMs: Date.now() - t0, loadavgAtStart: +loadavg()[0].toFixed(2), ...probe };
  results.push(row);
  console.log(`${c.path.slice(-70).padEnd(70)} ${row.ok ? `OK bodies=${row.bodies}` : `done=${row.trace?.completed ?? '-'} ${row.line ?? ''}: ${(row.message ?? row.note ?? '').slice(0, 120)} [${row.trace?.failedOperation?.name ?? '-'} ${(row.trace?.failedOperation?.callChain ?? []).join('>')}]`}`);
}
writeFileSync(join(outDir, only ? 'stub-deeper.partial.jsonl' : 'stub-deeper.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n');
meta({ event: 'end', done: results.length, uptime: uptime(), loadavg: loadavg() });
