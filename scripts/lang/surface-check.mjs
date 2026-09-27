// End-to-end evidence for docs/language/proposal-surface.md (WPy prototype).
//
//   node scripts/lang/surface-check.mjs [--skip-python] [--skip-native] [--out out/lang/surface/report.json]
//
// 1. equivalence on the JS target (same kernel functions, geometry revisions compared):
//      bracket.py (WPy)       vs examples/bracket.fs (FeatureScript frontend)
//      frame-with-tab.py      vs buildPython (CPython + build123d shim, today's path)
//      WPy -> emitted FS      vs WPy directly (FS emitter round trip)
// 2. native: WPy graph -> spike core AST -> native binary (1 thread), hashes vs the spike
// 3. incremental: edit one parameter, diff the graph, rebuild with the warm node cache
// 4. stable ids: insert an unrelated statement; WPy ids vs session-serial python/N ids
// 5. error messages with spans for representative mistakes
// Every timing records `uptime` load averages; timings are indicative (shared machine).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { build } from '../../src/index.mjs';
import { buildPython } from '../../src/python.mjs';
import { geometryRevision } from '../../src/identity.mjs';
import { buildWpy, preflightWpy } from '../../src/lang/surface/index.mjs';
import { JsBackend } from '../../src/lang/surface/backend-js.mjs';
import { emitFeatureScript } from '../../src/lang/surface/emit-fs.mjs';
import { runNative } from '../../src/lang/surface/backend-native.mjs';
import { diffGraphs } from '../../src/lang/surface/graph.mjs';
import { WpyError } from '../../src/lang/surface/values.mjs';

const args = process.argv.slice(2);
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'out/lang/surface/report.json';
const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
const ex = name => readFileSync(`fixtures/lang/surface/${name}`, 'utf8');
const report = { schema: 'wonky-wpy-report/1', generatedAt: new Date().toISOString(), machine: 'Apple M5 Pro, 18 logical CPUs, shared', equivalence: [], native: [], incremental: null, stableIds: null, errors: [] };
const save = () => { mkdirSync('out/lang/surface', { recursive: true }); writeFileSync(outPath, JSON.stringify(report, null, 1)); };
const revs = bodies => bodies.map(geometryRevision);
const timed = async f => { const l = load(), t = performance.now(); const r = await f(); return { r, ms: +(performance.now() - t).toFixed(1), load: l }; };

// ---- 1. equivalence on the JS target
{
  const wpy = await timed(() => buildWpy(ex('bracket.py'), { file: 'bracket.py' }));
  const fs = await timed(() => build(readFileSync('examples/bracket.fs', 'utf8'), { feature: 'bracket' }));
  const emitted = emitFeatureScript(wpy.r.graph, { feature: 'wpyBracket' });
  writeFileSync('out/lang/surface/examples/bracket.emitted.fs', emitted);
  const viaFs = await timed(() => build(emitted, { feature: 'wpyBracket' }));
  const a = revs(wpy.r.bodies), b = revs(fs.r.bodies), c = revs(viaFs.r.bodies);
  report.equivalence.push({ case: 'bracket', wpy: { revisions: a, volume: wpy.r.bodies[0].validation.volumeMm3, faces: wpy.r.bodies[0].faces.length, ms: wpy.ms, hostMs: wpy.r.timings.hostMs, load: wpy.load, checks: wpy.r.checks },
    featureScript: { file: 'examples/bracket.fs', revisions: b, ms: fs.ms, load: fs.load }, emittedFs: { file: 'out/lang/surface/examples/bracket.emitted.fs', revisions: c, ms: viaFs.ms },
    wpyEqualsFs: a.join() === b.join(), emittedEqualsWpy: c.join() === a.join() });
  save();
  console.log('bracket', report.equivalence.at(-1).wpyEqualsFs, report.equivalence.at(-1).emittedEqualsWpy);
}
{
  const wpy = await timed(() => buildWpy(ex('frame-with-tab.py'), { file: 'frame-with-tab.py' }));
  const a = revs(wpy.r.bodies);
  const entry = { case: 'frame-with-tab', wpy: { revisions: a, volume: wpy.r.bodies[0].validation.volumeMm3, faces: wpy.r.bodies[0].faces.length, ms: wpy.ms, hostMs: wpy.r.timings.hostMs, kernelMs: wpy.r.timings.kernelMs, load: wpy.load } };
  const emitted = emitFeatureScript(wpy.r.graph, { feature: 'wpyFrameWithTab' });
  writeFileSync('out/lang/surface/examples/frame-with-tab.emitted.fs', emitted);
  const viaFs = await timed(() => build(emitted, { feature: 'wpyFrameWithTab' }));
  entry.emittedFs = { file: 'out/lang/surface/examples/frame-with-tab.emitted.fs', revisions: revs(viaFs.r.bodies), volume: viaFs.r.bodies[0].validation.volumeMm3, faces: viaFs.r.bodies[0].faces.length, ms: viaFs.ms, load: viaFs.load };
  entry.emittedEqualsWpy = entry.emittedFs.revisions.join() === a.join();
  if (!args.includes('--skip-python')) {
    const py = await timed(() => buildPython(ex('frame-with-tab.py'), { filename: 'frame-with-tab.py', python: 'out/build123d-performance/reference-venv/bin/python', timeoutMs: 600000 }));
    entry.buildPython = { revisions: revs(py.r.bodies), volume: py.r.bodies[0].validation.volumeMm3, faces: py.r.bodies[0].faces.length, requests: py.r.execution.requests, ms: py.ms, load: py.load };
    entry.wpyEqualsBuildPython = entry.buildPython.revisions.join() === a.join();
  }
  report.equivalence.push(entry);
  save();
  console.log('frame-with-tab', entry.emittedEqualsWpy, entry.wpyEqualsBuildPython);
}

// ---- 2. native (existing spike binary, no compile), 1 thread
if (!args.includes('--skip-native')) {
  for (const f of ['bracket.py', 'frame-with-tab.py', 'pockets.py']) {
    const g = preflightWpy(ex(f), { file: f }).graph;
    const l = load();
    const r = await runNative(g, { threads: 1 });
    report.native.push({ file: f, threads: 1, parallel: true, load: l, ...r });
    save();
    console.log('native', f, r.evalMs, r.outputs.map(o => o.hash).join(','));
  }
}

// ---- 3. incremental: one-parameter edit of frame-with-tab (tab width 12 -> 14)
{
  const before = ex('frame-with-tab.py');
  const after = before.replace('Box(12, 20, 10', 'Box(14, 20, 10');
  const backend = await JsBackend.create({ file: 'frame-with-tab.py' });
  const cold = await timed(() => buildWpy(before, { file: 'frame-with-tab.py', backend }));
  const s0 = { ...backend.stats };
  const warm = await timed(() => buildWpy(after, { file: 'frame-with-tab.py', backend }));
  const s1 = { ...backend.stats };
  const fresh = await timed(async () => buildWpy(after, { file: 'frame-with-tab.py', backend: await JsBackend.create({ file: 'frame-with-tab.py' }) }));
  const diff = diffGraphs(cold.r.graph, warm.r.graph);
  report.incremental = {
    edit: 'tab = Pos(48, 10, 0) * Box(12 -> 14, 20, 10, align=Align.MIN)', target: 'Bend JS target (reference backend)',
    graphDiff: diff,
    cold: { ms: cold.ms, kernelMs: cold.r.timings.kernelMs, evaluated: s0.evaluated, load: cold.load },
    warmAfterEdit: { ms: warm.ms, kernelMs: warm.r.timings.kernelMs, evaluated: s1.evaluated - s0.evaluated, cacheHits: s1.cacheHits - s0.cacheHits, load: warm.load },
    freshAfterEdit: { ms: fresh.ms, kernelMs: fresh.r.timings.kernelMs, load: fresh.load },
    warmEqualsFresh: revs(warm.r.bodies).join() === revs(fresh.r.bodies).join(),
    volumes: { before: cold.r.bodies[0].validation.volumeMm3, after: warm.r.bodies[0].validation.volumeMm3 },
  };
  save();
  console.log('incremental', JSON.stringify(report.incremental.graphDiff), report.incremental.warmAfterEdit, report.incremental.warmEqualsFresh);
}

// ---- 4. stable ids: insert an unrelated operation at the top
{
  const base = ex('frame-with-tab.py');
  const inserted = base.replace('stock = ', 'washer = Pos(100, 0, 0) * Box(5, 5, 2)\nstock = ');
  const g0 = preflightWpy(base, { file: 'a.py' }).graph, g1 = preflightWpy(inserted, { file: 'b.py' }).graph;
  const d = diffGraphs(g0, g1);
  // what session-serial ids (src/python.mjs: python/N per request) would do: the request order shifts every later id
  const serial = g => g.nodes.filter(n => ['box', 'move', 'subtract', 'union'].includes(n.op)).map((n, k) => ({ id: n.id, serial: `python/${k + 1}` }));
  const s0 = serial(g0), s1 = serial(g1);
  const renamed = s0.filter(x => s1.find(y => y.id === x.id)?.serial !== x.serial).length;
  report.stableIds = { edit: 'insert `washer = Pos(100, 0, 0) * Box(5, 5, 2)` before `stock`', wpy: { unchanged: d.unchanged.length, changed: d.changed.length, added: d.added, removed: d.removed },
    sessionSerial: { operations: s0.length, renamed } };
  save();
  console.log('stable ids', JSON.stringify(report.stableIds));
}

// ---- 5. error messages
const errorCases = [
  ['typo in a name', 'from wonky import *\nplate = Box(40, 30, 5)\nhole = Pos(10, 10, 0) * Cylindr(3, 5)\nresult = plate - hole\n'],
  ['wrong argument type, two calls deep', 'from wonky import *\ndef lug(w):\n    return Box(w, 10, 4)\ndef bracket(w):\n    return lug(w) + lug("10")\nresult = bracket(20)\n'],
  ['outside the subset', 'import numpy as np\nfrom wonky import *\nresult = Box(float(np.pi), 1, 1)\n'],
  ['kernel capability (preflight)', 'from wonky import *\npart = Box(20, 20, 10)\nedges = [e for e in part.edges() if e.center().Z > 9]\nresult = fillet(edges, 1.0)\n'],
  ['failed check', 'from wonky import *\nplate = Box(40, 30, 5)\nexpect(40 * 30 * 5 == 6001, "plate volume")\nresult = plate\n'],
  ['syntax', 'from wonky import *\nresult = Box(40, 30 5)\n'],
];
for (const [label, src] of errorCases) {
  let text = null, gaps = null;
  try {
    const r = preflightWpy(src, { file: 'part.py' });
    gaps = r.report.kernelGaps;
    if (r.report.failedChecks.length) text = r.report.failedChecks.map(c => `part.py:${c.line}: check error: ${c.message}`).join('\n');
    else if (gaps.length) text = gaps.map(g => `part.py:${g.line}:${g.col}: capability error: '${g.op}' is not implemented by the wonky kernel (node ${g.id})`).join('\n');
  } catch (e) {
    text = e instanceof WpyError ? e.format(src) : e.format ? `${e.message} at ${JSON.stringify(e.span)}` : String(e);
    if (e.name === 'WpySyntaxError') text = `part.py:${e.span.line}:${e.span.col}: syntax error: ${e.message}\n  ${src.split('\n')[e.span.line - 1]}\n  ${' '.repeat(e.span.col - 1)}^`;
  }
  report.errors.push({ label, source: src, message: text });
}
save();
console.log(report.errors.map(e => `--- ${e.label}\n${e.message}`).join('\n'));
