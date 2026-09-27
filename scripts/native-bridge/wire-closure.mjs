#!/usr/bin/env node
// Scale proof for scripts/native-bridge/gen-wire.mjs: generate exact U32 wire
// codecs plus a dispatcher for EVERY production host -> kernel entry point
// that scripts/native-bridge/surface-scan.mjs finds, compile the generated
// Bend with the JS target, then replay real production values through it.
//
// Values are captured in-process while the unchanged production adapters run
// real FeatureScript models, a frozen Onshape import, STEP/print export, the
// comparison path and the review scene. Every captured argument and result is
// checked word for word (Bend encoder == JS encoder) and value for value
// (Bend decoder and JS decoder return the original, with -0 and every F32x2
// low word intact). Cheap calls are also re-executed through the generated
// Bend dispatcher on their wire frame and compared with the direct result.
//
// JS target only: this proves the generated surface type-checks and is
// bit-exact. It measures nothing about native speed.
//
//   node scripts/native-bridge/wire-closure.mjs [--out out/native-bridge/wire-closure.json] [--dispatch-ms 250]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { writeGenerated, kernelRoot, projectRoot } from './gen-wire.mjs';
import { scan } from './surface-scan.mjs';

process.env.BEND_NO_TELEMETRY = '1';
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const outFile = resolve(projectRoot, arg('--out', 'out/native-bridge/wire-closure.json'));
const dispatchMs = Number(arg('--dispatch-ms', '250'));
const genDir = join(projectRoot, 'tmp/native-bridge/surface/closure');
const cacheDir = join(projectRoot, 'tmp/native-bridge/surface/closure-cache');
const load = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
const report = { schema: 'wonky-native-wire-closure/1', generator: 'scripts/native-bridge/wire-closure.mjs', target: 'Bend JavaScript target (reference); no native code runs here', loadBefore: load() };

// ---------------------------------------------------------------- generate
const surface = scan();
const production = surface.entries.filter(entry => entry.production);
const specs = production.map(entry => entry.entry.replace(/^kernel\//, ''));
let t = performance.now();
const generated = writeGenerated({ types: [], ops: specs, outDir: genDir });
report.generation = { ms: Math.round(performance.now() - t), ops: generated.manifest.ops.length, adts: generated.manifest.adts.length,
  bendLines: generated.bendLines, jsLines: generated.jsLines, dir: relative(projectRoot, genDir) };
const { loadBend } = await import('../../src/bend-loader.mjs');
t = performance.now();
const bend = await loadBend(join(genDir, 'wire.bend'), { cacheDirectory: cacheDir });
report.compile = { ms: Math.round(performance.now() - t), note: 'JS-target compile of the generated module and its kernel import closure (cold unless the cache under tmp/ already holds it)', load: load() };
const { codecs, ops } = await import(pathToFileURL(join(genDir, 'wire.mjs')).href + `?t=${Date.now()}`);
const opByName = new Map(ops.map(op => [op.name, op]));

// ---------------------------------------------------------------- capture
const { loadKernel } = await import('../../src/kernel.mjs');
const { registerBendImports } = await import('../../src/bend-loader.mjs');
const kernel = await loadKernel();
await registerBendImports();
const samples = new Map(); // op name -> [{args, result, ms, source}]
const calls = new Map();
let depth = 0, workload = null;
const MAX = 2;
function wrap(ns, moduleFile) {
  if (Object.isFrozen(ns)) throw new Error(`cannot instrument frozen namespace ${moduleFile}`);
  for (const key of Object.keys(ns)) {
    const fn = ns[key];
    if (typeof fn !== 'function' || fn.__nbWrapped) continue;
    const entry = production.find(e => e.exposedAs.some(x => x === `kernel/${moduleFile}` && e.entry.endsWith(`:${key}`)) ||
      e.exposedAs.includes(`kernel/${moduleFile} as '${key}'`));
    if (!entry) continue;
    const name = entry.entry.replace(/^kernel\//, '');
    const wrapped = function (...args) {
      if (depth) return fn.apply(this, args);
      depth++;
      const started = performance.now();
      try {
        const result = fn.apply(this, args);
        const ms = performance.now() - started;
        calls.set(name, (calls.get(name) ?? 0) + 1);
        const list = samples.get(name) ?? [];
        if (list.length < MAX) { list.push({ args: structuredClone(args), result: structuredClone(result), ms, source: workload }); samples.set(name, list); }
        return result;
      } finally { depth--; }
    };
    wrapped.__nbWrapped = true;
    ns[key] = wrapped;
  }
}
wrap(kernel, 'topology.bend');
for (const [field, file] of Object.entries({ analytic: 'analytic.bend', real: 'real.bend', precise: 'precise.bend', boolean: 'boolean.bend',
  comparison: 'comparison.bend', identity: 'identity.bend', faceClassifier: 'face-classification.bend', halfspace: 'halfspace.bend',
  sketchLines: 'sketch-lines.bend', sketchArcs: 'sketch-arcs.bend', solidIntersection: 'ports/solid-intersection.bend', curved: 'ports/curved.bend',
  curvedIntersection: 'ports/curved-intersection.bend', planarBoolean: 'ports/planar-boolean.bend', revolve: 'revolve.bend',
  tessellate: 'tessellate.bend', pierce: 'pierce.bend' })) wrap(kernel[field], file);
const { loadStepPCurves } = await import('../../src/step-pcurves.mjs');
const { loadStepCylinderPCurves } = await import('../../src/step-cylinder-pcurves.mjs');
const { loadSketchArcs } = await import('../../src/sketch-arcs.mjs');
wrap(await loadStepPCurves(), 'step-pcurves.bend');
wrap(await loadStepCylinderPCurves(), 'step-cylinder-pcurves.bend');
wrap(await loadSketchArcs(), 'sketch-arcs.bend');
for (const file of ['display.bend', 'curve-plane.bend', 'cylinder-classification.bend'])
  wrap((await import(pathToFileURL(join(kernelRoot, file)).href)).default, file);

const { build } = await import('../../src/index.mjs');
const { toStep } = await import('../../src/exporters.mjs');
const { toPrintStl } = await import('../../src/print-mesh.mjs');
const { reviewScene } = await import('../../src/review-scene.mjs');
const { compareBodiesInBend } = await import('../../src/comparison.mjs');
const { importOnshapeBody, transformAnalytic } = await import('../../src/analytic.mjs');
const workloads = [];
const run = async (name, fn) => {
  workload = name;
  const started = performance.now();
  try { await fn(); workloads.push({ name, ok: true, ms: Math.round(performance.now() - started) }); }
  catch (error) { workloads.push({ name, ok: false, ms: Math.round(performance.now() - started), error: String(error.message).slice(0, 300) }); }
};
const models = {};
const FS = ['examples/box.fs', 'examples/bracket.fs', 'examples/line-sketch.fs', 'examples/conical-spacer.fs', 'examples/tilted-plate.fs',
  'examples/bored-spacer.fs', 'examples/convex-intersection.fs', 'examples/concave-intersection.fs', 'examples/compare-before.fs', 'examples/compare-after.fs',
  'fixtures/public-boolean-regressions/adapted/fuse-g1.fs', 'fixtures/public-boolean-regressions/adapted/cut-h1.fs'];
for (const file of FS) {
  await run(`build ${file}`, async () => { models[file] = await build(readFileSync(join(projectRoot, file), 'utf8'), { sourcePath: join(projectRoot, file) }); });
  if (models[file]) await run(`toStep ${file}`, () => toStep(models[file], basename(file, '.fs')));
}
const arcModel = `FeatureScript 3044;
import(path:"onshape/std/common.fs",version:"3044.0");
export function main(context is Context,id is Id,definition is map) {
  var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1),vector(1,0,0))});
  skArc(s,"round",{"start":vector(2,0)*millimeter,"mid":vector(0,2)*millimeter,"end":vector(-2,0)*millimeter});
  skLineSegment(s,"base",{"start":vector(-2,0)*millimeter,"end":vector(2,0)*millimeter});
  skSolve(s);
  opExtrude(context,id+"ex",{"entities":qSketchRegion(id+"s",false),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":5*millimeter});
}`;
await run('build line/arc semicircle (test/sketch-arcs-integration.test.mjs template)', async () => { models.arc = await build(arcModel); });
if (models.arc) await run('toStep line/arc semicircle', () => toStep(models.arc, 'semicircle'));
// Frozen Onshape bodies from fixtures/r10b: circles, a cone, ellipses and an
// 'other' plane/cylinder curve cover every import helper.
for (const file of ['carrier/RxXD.body.json', 'base/Z76DD.body.json', 'camera/ZL%2BED.body.json', 'base/Z2qDD.body.json']) {
  await run(`importOnshapeBody fixtures/r10b/modules/${file} + transformAnalytic`, () => {
    const raw = JSON.parse(readFileSync(join(projectRoot, 'fixtures/r10b/modules', file), 'utf8'));
    const body = importOnshapeBody(kernel, raw.bodies[0], file, { document: 'fixture', element: 'fixture', microversion: 'fixture' });
    transformAnalytic(kernel, body, `moved/${file}`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 2, 3]);
  });
}
// Rigid patterns of Boolean and frustum results re-derive their measures in
// Bend (rim_bounds, halfspace.bounds, point_transform); a round through hole
// drives kernel/pierce.bend (template from test/pierce.test.mjs).
const header = 'FeatureScript 3044;\nimport(path : "onshape/std/geometry.fs", version : "3044.0");\n';
const rect = (name, x0, y0, x1, y1, z0, h) => `
    var ${name}s = newSketchOnPlane(context, id + "${name}s", { "sketchPlane" : plane(vector(0,0,${z0})*millimeter, vector(0,0,1)) });
    skRectangle(${name}s, "r", { "firstCorner" : vector(${x0},${y0})*millimeter, "secondCorner" : vector(${x1},${y1})*millimeter });
    skSolve(${name}s);
    opExtrude(context, id + "${name}", { "entities" : qSketchRegion(id + "${name}s"), "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : ${h}*millimeter });`;
const disk = (name, r, z0, h) => `
    var ${name}s = newSketchOnPlane(context, id + "${name}s", { "sketchPlane" : plane(vector(0,0,${z0})*millimeter, vector(0,0,1)) });
    skCircle(${name}s, "c", { "center" : vector(0,0)*millimeter, "radius" : ${r}*millimeter });
    skSolve(${name}s);
    opExtrude(context, id + "${name}", { "entities" : qSketchRegion(id + "${name}s"), "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : ${h}*millimeter });`;
const pattern = source => `
    opPattern(context, id + "pattern", { "entities" : qCreatedBy(id + "${source}", EntityType.BODY), "transforms" : [transform(vector(60,0,0)*millimeter)], "instanceNames" : ["copy"] });`;
const subtract = (target, tool, name) => `
    opBoolean(context, id + "${name}", { "targets" : qCreatedBy(id + "${target}", EntityType.BODY), "tools" : qCreatedBy(id + "${tool}", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });`;
const union = (a, b, name) => `
    opBoolean(context, id + "${name}", { "tools" : qUnion([qCreatedBy(id + "${a}", EntityType.BODY), qCreatedBy(id + "${b}", EntityType.BODY)]), "operationType" : BooleanOperationType.UNION });`;
const intersect = (a, b, name) => `
    opBoolean(context, id + "${name}", { "tools" : qUnion([qCreatedBy(id + "${a}", EntityType.BODY), qCreatedBy(id + "${b}", EntityType.BODY)]), "operationType" : BooleanOperationType.INTERSECTION });`;
const part = body => `${header}export function part(context is Context, id is Id, definition is map)\n{${body}\n}`;
const snippets = {
  'pierced plate + pattern': part(rect('plate', -20, -15, 20, 15, 0, 5) + disk('tool', 4, -1, 7) + subtract('plate', 'tool', 'bore') + pattern('plate')),
  'coaxial bore + pattern': part(disk('outer', 10, 0, 8) + disk('inner', 4, -1, 10) + subtract('outer', 'inner', 'bore') + pattern('outer')),
  'planar union + pattern': part(rect('a', 0, 0, 20, 10, 0, 5) + rect('b', 10, 5, 30, 20, 0, 5) + union('a', 'b', 'join') + pattern('a')),
  'frustum pattern': part(disk('rod', 3, 0, 12) + pattern('rod')),
  'polyhedral pattern': part(rect('slab', 0, 0, 10, 10, 0, 2) + pattern('slab')),
  'box/cylinder intersection': part(rect('blk', -5, -5, 5, 5, 0, 10) + disk('rod', 3, -1, 12) + intersect('blk', 'rod', 'common')),
};
for (const [name, source] of Object.entries(snippets)) {
  await run(`build ${name}`, async () => { models[name] = await build(source, { feature: 'part' }); });
  if (models[name]) await run(`toStep ${name}`, () => toStep(models[name], 'snippet'));
}
if (models['examples/bored-spacer.fs']) await run('toPrintStl examples/bored-spacer.fs', () => toPrintStl(kernel, models['examples/bored-spacer.fs'], { deviationMm: 0.02 }));
if (models['examples/compare-before.fs'] && models['examples/compare-after.fs']) await run('compareBodiesInBend compare-before/after', () =>
  compareBodiesInBend(kernel, models['examples/compare-before.fs'].bodies[0], models['examples/compare-after.fs'].bodies[0], { includeGeometry: true }));
for (const file of ['examples/bored-spacer.fs', 'examples/conical-spacer.fs']) if (models[file]) await run(`reviewScene ${file}`, () => reviewScene(models[file], {}));
report.workloads = workloads;
report.loadAfterCapture = load();

// ---------------------------------------------------------------- replay
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const toList = words => { let out = { $: 'Nil' }; for (let i = words.length - 1; i >= 0; i--) out = { $: 'Con', head: words[i], tail: out }; return out; };
const fromList = xs => { const out = []; for (; xs.$ === 'Con'; xs = xs.tail) out.push(xs.head); if (xs.$ !== 'Nil') throw new Error('bad list'); return out; };
function same(a, b, path = '$') {
  if (typeof a === 'number' || typeof b === 'number') { if (!Object.is(a, b)) throw new Error(`${path}: ${a} !== ${b}`); return; }
  if (typeof a !== 'object' || a === null) { if (a !== b) throw new Error(`${path}: ${String(a)} !== ${String(b)}`); return; }
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) throw new Error(`${path}: keys ${ka} vs ${kb}`);
  for (const key of ka) same(a[key], b[key], `${path}.${key}`);
}
const { real, number } = await import('../../src/real.mjs');
// What today's host decode/re-encode (src/real.mjs number() then real()) does
// to every Real in a value: words kept, words changed, or refused (> 1e20 or
// F32 underflow). A changed Real is a chain break if it is fed back in.
const hostRoundTrip = value => {
  const out = { reals: 0, changed: 0, refused: 0 }; const stack = [value];
  while (stack.length) {
    const v = stack.pop(); if (!v || typeof v !== 'object') continue;
    if (v.$ === 'Real' && typeof v.hi === 'number') {
      out.reals++;
      try { const r = real(number(v)); if (!Object.is(r.hi, v.hi) || !Object.is(r.lo, v.lo)) out.changed++; } catch { out.refused++; }
      continue;
    }
    for (const k of Object.keys(v)) if (k !== '$') stack.push(v[k]);
  }
  return out;
};
const lowWords = value => { // count Real limbs with a non-zero low word, the ones src/real.mjs number() can lose
  let n = 0; const stack = [value];
  while (stack.length) { const v = stack.pop(); if (!v || typeof v !== 'object') continue; if (v.$ === 'Real' && v.lo !== 0) n++; for (const k of Object.keys(v)) if (k !== '$') stack.push(v[k]); }
  return n;
};
function roundTrip(label, value) {
  const codec = codecs[label];
  if (!codec) throw new Error(`no codec for ${label}`);
  let t0 = performance.now();
  const words = codec.encode(value);
  const jsEncodeUs = (performance.now() - t0) * 1000;
  const bendWords = fromList(bend[`encode_${codec.key}`](value));
  if (bendWords.length !== words.length || bendWords.some((w, i) => w !== words[i])) throw new Error(`${label}: Bend and JS encoders disagree`);
  t0 = performance.now();
  const back = codec.decode(words);
  const jsDecodeUs = (performance.now() - t0) * 1000;
  same(back, value, `${label} (JS decode)`);
  const decoded = bend[`decode_${codec.key}`](toList([...words]));
  if (decoded.$ !== 'Some') throw new Error(`${label}: Bend decoder rejected its own encoding`);
  same(decoded.value, value, `${label} (Bend decode)`);
  return { words: words.length, jsEncodeUs, jsDecodeUs, nonZeroLowWords: lowWords(value), hostRoundTrip: hostRoundTrip(value) };
}
const entries = [];
let checkedValues = 0, dispatched = 0;
for (const entry of production) {
  const name = entry.entry.replace(/^kernel\//, '');
  const op = opByName.get(name);
  const row = { entry: entry.entry, opId: op.id, calls: calls.get(name) ?? 0, samples: [] };
  for (const sample of samples.get(name) ?? []) {
    const out = { source: sample.source, callMs: Math.round(sample.ms * 1000) / 1000 };
    try {
      out.args = op.params.map((label, i) => roundTrip(label, sample.args[i]));
      out.result = roundTrip(op.result, sample.result);
      checkedValues += out.args.length + 1;
      out.requestWords = op.encode(sample.args).length;
      if (sample.ms <= dispatchMs) {
        const started = performance.now();
        const frame = fromList(bend.dispatch(op.id, toList([...op.encode(sample.args)])));
        out.dispatchMs = Math.round((performance.now() - started) * 1000) / 1000;
        const expected = [0, ...codecs[op.result].encode(sample.result)];
        if (frame.length !== expected.length || frame.some((w, i) => w !== expected[i])) throw new Error('dispatch frame differs from the direct call');
        same(op.decode(Uint32Array.from(frame)), sample.result, 'dispatch decode');
        out.dispatch = 'identical';
        dispatched++;
      } else out.dispatch = `skipped (direct call took ${Math.round(sample.ms)} ms > ${dispatchMs} ms)`;
      out.ok = true;
    } catch (error) { out.ok = false; out.error = String(error.message).slice(0, 400); }
    row.samples.push(out);
  }
  entries.push(row);
}
const covered = entries.filter(e => e.samples.length);
report.replay = {
  productionEntries: production.length, entriesWithSamples: covered.length, samples: covered.reduce((n, e) => n + e.samples.length, 0),
  valuesRoundTripped: checkedValues, dispatchReplays: dispatched,
  failures: entries.flatMap(e => e.samples.filter(s => !s.ok).map(s => `${e.entry}: ${s.error}`)),
  valuesWithNonZeroLowWords: entries.flatMap(e => e.samples.flatMap(s => [...(s.args ?? []), ...(s.result ? [s.result] : [])])).filter(v => v.nonZeroLowWords > 0).length,
  resultRealsThroughHostRoundTrip: entries.flatMap(e => e.samples.filter(s => s.result).map(s => s.result.hostRoundTrip)).reduce((a, b) => ({ reals: a.reals + b.reals, changed: a.changed + b.changed, refused: a.refused + b.refused }), { reals: 0, changed: 0, refused: 0 }),
  entriesWhoseResultsChangeThroughHostRoundTrip: entries.filter(e => e.samples.some(s => s.result && s.result.hostRoundTrip.changed + s.result.hostRoundTrip.refused > 0)).map(e => e.entry),
  largestRequestWords: Math.max(0, ...covered.flatMap(e => e.samples.map(s => s.requestWords ?? 0))),
  largestResultWords: Math.max(0, ...covered.flatMap(e => e.samples.map(s => s.result?.words ?? 0))),
  notExercised: entries.filter(e => !e.samples.length).map(e => e.entry),
};
report.entries = entries;
report.loadAfter = load();
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ out: relative(projectRoot, outFile), generation: report.generation, compile: report.compile.ms, ...report.replay, notExercised: report.replay.notExercised.length,
  workloadsFailed: workloads.filter(w => !w.ok).map(w => `${w.name}: ${w.error}`) }, null, 1));
if (report.replay.failures.length) process.exitCode = 1;
