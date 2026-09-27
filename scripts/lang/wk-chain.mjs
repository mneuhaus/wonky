// Chains of dependent Booleans on the WK real-model path (docs/language/prototype.md
// fix round 2, defect "long Boolean chains crash the host identity replay"; fix
// round 3: every PIERCE is its own stage, so a chain of N holes runs N + 1 stages).
//
// A plate with N through holes, each hole a separate opBoolean on the same
// target (the idiom of Marc's plates, e.g. a 300 x 300 mm plate with 60
// holes): a chain of N dependent PIERCE nodes. For each N, in a fresh child
// process with a 4 GB heap limit and /usr/bin/time -l:
//   native  record, native evaluation, body decode, identity + evidence replay
//           (release = true: consumed intermediate bodies are dropped), JSON
//           export; sizes of the final body's identity and operationHistory
//   today   build() of the same file (JS target), JSON export
// A V8 limit reached in the replay is an explicit capability error at the
// node's FS span (real-host.mjs limitError); a heap exhaustion is a crash
// (exit 134), which is what this script measures.
//
//   node scripts/lang/wk-chain.mjs [--sizes 12,20,30,45,60] [--today 12,20,25] [--heap 4096]
// Writes out/lang/wk/real/chain.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync, execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = new URL('../../', import.meta.url).pathname;
const DIR = join(root, 'tmp/lang/wk/chain');
const args = process.argv.slice(2);
const opt = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');

export function plateSource(n) {
  const cols = 20;
  return `FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");
function cylinder(context is Context,id is Id,p is Vector,r is number,h is number) returns Query
{
 var qq=[];var ss=[];
 for(var k=0;k<2;k+=1){var sid=id+("s"~k);var sk=newSketchOnPlane(context,sid,{"sketchPlane":plane((p+vector(0,0,k*h))*millimeter,vector(0,0,1),vector(1,0,0))});
 skCircle(sk,"circle",{"center":vector(0,0)*millimeter,"radius":r*millimeter});skSolve(sk);qq=append(qq,qSketchRegion(sid,true));ss=append(ss,qCreatedBy(sid,EntityType.BODY));}
 opLoft(context,id+"loft",{"profileSubqueries":qq});opDeleteBodies(context,id+"ds",{"entities":qUnion(ss)});return qCreatedBy(id+"loft",EntityType.BODY);
}
annotation {"Feature Type Name":"Plate with holes"}
export const plateHoles=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 fCuboid(context,id+"plate",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(300,300,4.5)*millimeter});
 var plate=qCreatedBy(id+"plate",EntityType.BODY);
 for(var i=0;i<${n};i+=1){
  var x=7.5+(i%${cols})*14.25; var y=7.5+floor(i/${cols})*14.25;
  var t=cylinder(context,id+("h"~i),vector(x,y,-1),1.65+0.01*(i%7),6.5);
  opBoolean(context,id+("b"~i),{"targets":plate,"tools":t,"operationType":BooleanOperationType.SUBTRACTION});
 }
 setProperty(context,{"entities":plate,"propertyType":PropertyType.NAME,"value":"plate"});
});
`;
}

async function child(kind, file) {
  const out = { kind, file, heapMaxMB: 0 };
  const sample = () => { out.heapMaxMB = Math.max(out.heapMaxMB, process.memoryUsage().heapUsed / 1e6); };
  const timer = setInterval(sample, 20);
  try {
    if (kind === 'today') {
      const { build } = await import('../../src/index.mjs');
      let t = performance.now();
      const model = await build(readFileSync(file, 'utf8'), { feature: 'plateHoles', sourcePath: file });
      out.buildMs = performance.now() - t;
      t = performance.now();
      const json = JSON.stringify(model);
      out.exportMs = performance.now() - t; out.modelBytes = json.length;
      out.identityBytes = JSON.stringify(model.bodies[0].identity).length;
      out.historyBytes = JSON.stringify(model.bodies[0].operationHistory ?? null).length;
      out.status = 'ok';
    } else {
      const { loadKernel } = await import('../../src/kernel.mjs');
      const { recordCase, evaluate, assemble, assembleModel, modelJson } = await import('../../src/lang/wk/real-run.mjs');
      const { memoIdentityKernel } = await import('../../src/lang/wk/real-host.mjs');
      const kernel = await loadKernel();
      let t = performance.now();
      const rec = recordCase(file, 'plateHoles');
      out.recordMs = performance.now() - t; out.nodes = rec.graph.nodes.length; out.record = rec.status;
      t = performance.now();
      const ev = await evaluate(rec, { file: `${file}.wkr`, threads: 1 });
      // one stage per chained PIERCE (real-run.mjs evaluateStages): every stage is a native process here
      out.nativeProcessMs = performance.now() - t; out.nativeEvalMs = ev.out.repsUs[0] / 1000; out.stages = ev.stages.length;
      out.stageWallMs = ev.run.wallMs; out.hostBetweenStagesMs = ev.hostDecodeMs;
      t = performance.now();
      const asm = assemble(rec, ev.values, memoIdentityKernel(kernel).kernel, { release: true });
      out.decodeMs = asm.decodeMs; out.identityMs = asm.identityMs; out.assembleMs = performance.now() - t;
      sample();
      out.identityBytes = JSON.stringify(asm.outputs[0].identity).length;
      out.historyBytes = JSON.stringify(asm.outputs[0].operationHistory ?? null).length;
      t = performance.now();
      const json = modelJson(rec, assembleModel(rec, asm));
      out.exportMs = performance.now() - t; out.modelBytes = json.length;
      out.status = 'ok';
    }
  } catch (error) {
    out.status = 'error'; out.error = { name: error.name, message: String(error.message).slice(0, 400), line: error.line ?? null, column: error.column ?? null };
  }
  clearInterval(timer); sample();
  console.log(JSON.stringify(out));
}

const main = import.meta.url === pathToFileURL(process.argv[1] ?? '').href; // importable (plateSource) without running
if (main && args[0] === '--child') await child(args[1], args[2]);
else if (main) {
  const sizes = opt('--sizes', '12,20,30,45,60').split(',').map(Number);
  const today = opt('--today', '12,20,25').split(',').map(Number);
  const heap = Number(opt('--heap', 4096));
  mkdirSync(DIR, { recursive: true });
  const report = { schema: 'wonky-lang-wk-chain/1', heapLimitMB: heap, note: 'indicative timings (shared machine); sizes and statuses are exact', loadStart: load(), rows: [] };
  const run = (kind, n) => {
    const file = join(DIR, `plate-${n}.fs`);
    writeFileSync(file, plateSource(n));
    const before = load(), t0 = performance.now();
    const r = spawnSync('/usr/bin/time', ['-l', process.execPath, `--max-old-space-size=${heap}`, new URL(import.meta.url).pathname, '--child', kind, file],
      { cwd: root, encoding: 'utf8', timeout: 900000, env: { ...process.env, BEND_NO_TELEMETRY: '1' }, maxBuffer: 1 << 26 });
    const line = r.stdout.trim().split('\n').filter(l => l.startsWith('{')).at(-1);
    const row = { kind, n, exit: r.status, signal: r.signal, wallMs: performance.now() - t0, peakRssGB: Number(/(\d+)\s+maximum resident set size/.exec(r.stderr)?.[1] ?? NaN) / 1e9,
      loadBefore: before, loadAfter: load(), ...(line ? JSON.parse(line) : { status: 'crash', stderr: r.stderr.split('\n').filter(l => /FATAL|Error|error/.test(l)).slice(0, 3).join(' | ').slice(0, 300) }) };
    report.rows.push(row);
    console.log(JSON.stringify({ kind, n, status: row.status, exit: row.exit, wallMs: Math.round(row.wallMs), peakRssGB: row.peakRssGB.toFixed(2), identityMB: ((row.identityBytes ?? 0) / 1e6).toFixed(2),
      historyMB: ((row.historyBytes ?? 0) / 1e6).toFixed(2), modelMB: ((row.modelBytes ?? 0) / 1e6).toFixed(2), identityMs: Math.round(row.identityMs ?? 0), stages: row.stages ?? null, nativeEvalMs: row.nativeEvalMs ?? null, nativeProcessMs: Math.round(row.nativeProcessMs ?? 0), error: row.error?.message?.slice(0, 120) ?? row.stderr ?? null, load: before }));
  };
  for (const n of sizes) run('native', n);
  for (const n of today) run('today', n);
  report.loadEnd = load();
  writeFileSync(join(root, 'out/lang/wk/real/chain.json'), JSON.stringify(report, null, 1));
}
