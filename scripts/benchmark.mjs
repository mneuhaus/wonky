import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadKernel, extrudeInBend } from '../src/kernel.mjs';
import { build } from '../src/index.mjs';
import { parse } from '../src/parser.mjs';
import { toStep } from '../src/exporters.mjs';
import { validateSolid } from '../src/brep.mjs';
import { Interpreter } from '../src/interpreter.mjs';
import { ModelingContext } from '../src/library.mjs';
import { real, vector as preciseVector } from '../src/real.mjs';
import { halfspaceInput } from '../src/halfspace.mjs';
import { intersectionTolerance } from '../src/intersections.mjs';
import { validateAnalytic } from '../src/analytic.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Walks subdirectories. Listing kernel/ one level deep made readFileSync trip
// over kernel/ports with EISDIR, so this digest could not be taken at all and
// the benchmark it gates could not run -- and had it not thrown, every file
// under kernel/ports would simply have been missing from the hash it claims to
// cover. scripts/benchmark-build123d.mjs already walks this way.
const walk = directory => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? (entry.name === '__pycache__' ? [] : walk(`${directory}/${entry.name}`)) : [`${directory}/${entry.name}`]);
function implementationDigest(){
  const files=['bend.lock.json','package-lock.json','PROOF.bend','LAWS.bend','scripts/benchmark.mjs',...['src','kernel'].flatMap(walk)].sort();
  const digest=createHash('sha256');for(const file of files)digest.update(file).update(readFileSync(join(root,file)));
  return digest.digest('hex');
}
const sourceSha256Before=implementationDigest();
const stats = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * 0.95)], samples: sorted.length };
};
let checksum = 0;
async function measure(fn, batch = 10, samples = 40, minimumWarmups = 100) {
  const warmStart = performance.now(); let warmupCalls = 0;
  while (warmupCalls < minimumWarmups || performance.now() - warmStart < 200) { await fn(); warmupCalls++; }
  const values = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    for (let j = 0; j < batch; j++) await fn();
    values.push((performance.now() - start) / batch);
  }
  return { ...stats(values), batch, warmupCalls };
}
const sources = ['box', 'bracket', 'tilted-plate'].map(name => [name, readFileSync(join(root, `examples/${name}.fs`), 'utf8')]);
function freshCli(cache) {
  const start = performance.now();
  const child = spawnSync(process.execPath, ['bin/wonky.mjs', 'examples/bracket.fs', '--check'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, WONKY_BEND_CACHE: cache ? '1' : '0' },
  });
  if (child.status !== 0) throw new Error(child.stderr);
  return performance.now() - start;
}
// Compilation and reuse are deliberately separate populations. Fresh Node
// processes still have warm OS file caches; no disk-cold claim is made.
const coldCompile = Array.from({ length: 5 }, () => freshCli(false));
const cachePreparationMs = freshCli(true);
const cold = Array.from({ length: 10 }, () => freshCli(true));
const kernel = await loadKernel();
const vec = (x, y, z) => ({ $: 'V3', x, y, z });
const list = values => values.reduceRight((tail, head) => ({ $: 'Con', head, tail }), { $: 'Nil' });
const geometries = [
  ['rectangle-4', [[0, 0], [40, 0], [40, 20], [0, 20]]],
  ['concave-6', [[0, 0], [50, 0], [50, 12], [18, 12], [18, 40], [0, 40]]],
  ...[64, 256].map(n => [`polygon-${n}`, Array.from({ length: n }, (_, i) => [50 * Math.cos(i * Math.PI * 2 / n), 50 * Math.sin(i * Math.PI * 2 / n)])]),
];
const bendExtrusion = {};
for (const [name, points] of geometries) {
  const input = list(points.map(([x, y]) => vec(x, y, 0)));
  bendExtrusion[name] = await measure(() => { const result = kernel.extrude(input, vec(0, 0, 8)); checksum += result.vertices.head.x; }, 30);
}
const booleanInput = [preciseVector([0,0,0]),preciseVector([0,0,10]),real(5),preciseVector([0,0,-1]),preciseVector([0,0,11]),real(2),2];
const bendCoaxialBoolean = await measure(() => {
  const result=kernel.boolean.coaxial(...booleanInput);
  if(!result.supported)throw new Error('Boolean benchmark is outside the supported geometry');
  checksum+=result.bodies.head.volume.hi;
},20);
const comparisonInput = [preciseVector([0,0,0]),preciseVector([0,0,10]),real(5),preciseVector([0,0,4]),preciseVector([0,0,14]),real(3),real(1e-7)];
const bendCoaxialComparison = await measure(() => {
  const result=kernel.comparison.coaxial(...comparisonInput);
  if(!result.supported)throw new Error('Comparison benchmark is outside the supported geometry');
  checksum+=result.symmetric_difference.hi;
},100);
const boxFrame = { origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0] };
const firstConvex = extrudeInBend(kernel, 'benchmark-a', [[0,0],[40,0],[40,30],[0,30]], boxFrame, [0,0,12]);
const secondConvex = extrudeInBend(kernel, 'benchmark-b', [[10,-5],[50,-5],[50,22],[10,22]], { ...boxFrame, origin: [0,0,4] }, [0,0,16]);
const ca = halfspaceInput(firstConvex, kernel.faceClassifier), cb = halfspaceInput(secondConvex, kernel.faceClassifier);
const convexTolerance = intersectionTolerance();
const bendConvexIntersection = await measure(() => {
  const result = kernel.halfspace.intersect(ca.solid, cb.solid, convexTolerance, ca.sourceBudget, cb.sourceBudget);
  if (result.$ !== 'Solid' || Math.abs(result.volume.hi + result.volume.lo - 5280) > 1e-8) throw new Error('Convex intersection benchmark changed');
  checksum += result.volume.hi;
}, 5, 30);
const convexSource = readFileSync(join(root, 'examples/convex-intersection.fs'), 'utf8');
const convexModel = await build(convexSource);
const convexPipeline = {
  featureScriptToValidatedBrep: await measure(async () => { checksum += (await build(convexSource)).bodies[0].validation.volumeMm3; }, 5, 30),
  validationOnly: await measure(() => { checksum += validateAnalytic(convexModel.bodies[0], kernel).faces; }),
  stepIncludingValidation: await measure(() => { checksum += toStep(convexModel).length; }),
};
const pipeline = {};
for (const [name, source] of sources) {
  const model = await build(source);
  pipeline[name] = {
    parse: await measure(() => { checksum += parse(source).version; }),
    featureScriptToValidatedBrep: await measure(async () => { checksum += (await build(source)).bodies.length; }),
    featureScriptToValidatedBrepWithoutSourceTrace: await measure(async () => { checksum += (await build(source,{trace:false})).bodies.length; }),
    validationOnly: await measure(() => { checksum += validateSolid(model.bodies[0]).volumeMm3; }),
    stepIncludingValidation: await measure(() => { checksum += toStep(model).length; }),
  };
}
const fixture = readFileSync(join(root, 'fixtures/r10b/r10b.fs'), 'utf8');
const r10bParse = await measure(() => { checksum += parse(fixture).declarations.length; }, 2, 25);
const r10bProgram = parse(fixture);
let helperSteps, helperResultSha256;
const r10bScalar = await measure(() => {
  const interpreter = new Interpreter(new ModelingContext(kernel).builtins());
  for (const declaration of r10bProgram.declarations) interpreter.statement(declaration, interpreter.global);
  const points = interpreter.call(interpreter.global.get('r10bTrayInside'), [4, 0.5, 3.2]);
  helperSteps = interpreter.steps;
  helperResultSha256 = createHash('sha256').update(JSON.stringify(points)).digest('hex');
  if (helperResultSha256 !== '7f54945c81d4dd454e5bba141538891ea3df35e78b982dc241d8eeba44f79f0d') throw new Error('r10b scalar helper result changed');
  checksum += points.length;
}, 1, 7, 3);
const r10bRetained = await measure(async () => {
  checksum += (await build(fixture, {feature:'r10bRetainedContext',moduleManifest:join(root,'fixtures/r10b/modules.json')})).bodies.length;
}, 1, 20, 3);
const sourceSha256After=implementationDigest();
const report = {
  capturedAt: new Date().toISOString(), environment: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, platform: platform(), architecture: arch(), node: process.version },
  backend: 'Bend 2.0.25 → JavaScript, single thread, no native/GPU measurements', sourceSha256: sourceSha256After,
  sourceSha256Before,implementationStable:sourceSha256Before===sourceSha256After,
  method: 'Warm measurements: at least 100 calls and 200 ms of warmup per case unless noted, per-operation median/p95 of timed batches. Fresh CLI: separate compilation-disabled-cache and prepared-cache populations; OS disk caches may be warm. Bend extrusion includes JS boundary conversion and fully materialized B-rep, excludes frontend and host validation.',
  coldCli: {...stats(cold), rawMs:cold, method:'Ten fresh Node processes after separate cache preparation, WONKY_BEND_CACHE=1. Includes cache validation and loading, frontend and host validation; excludes STEP.'},
  coldCliFreshCompilation: {...stats(coldCompile), rawMs:coldCompile, method:'Five fresh Node processes, WONKY_BEND_CACHE=0: no persistent cache reads or writes, official compiler/checker rerun for every required module; same bracket build and validation.'},
  cachePreparationMs, bendExtrusion,
  bendCoaxialBoolean:{...bendCoaxialBoolean,method:'F32x2 through-bore subtraction of two coaxial cylinders; Bend arrangement, B-rep, analytic volume and bounds, JS interop. Excludes FeatureScript, host validation and STEP.'},
  bendCoaxialComparison:{...bendCoaxialComparison,method:'F32x2 comparison of two coaxial cylinders; volume differences, clearance, cap contact and classification in Bend with JS interop. Excludes FeatureScript, geometry export and general body comparisons.'},
  bendConvexIntersection:{...bendConvexIntersection,method:'Intersection of two overlapping convex planar boxes: native operand and result validation, clipping, shared boundary construction, volume and bounds in Bend. Pre-encoded inputs; JS call/result guard included, host decoding/IDs/trace/STEP excluded.'},
  convexPipeline,
  pipeline, r10bParse,
  pipelineScope:'Default builds include topology identity and source tracing. The separately measured trace:false builds retain identity metadata and disable only source tracing. Kernel-only rows exclude both host metadata paths.',
  r10bScalar: {...r10bScalar, steps:helperSteps, resultSha256:helperResultSha256, method:'Original r10bTrayInside(4,0.5,3.2), 3 warmups, 7 timed calls; includes interpreter/global initialization, excludes parsing. Every 122-point result matches the pre-optimization reference hash.'},
  r10bRetained: {...r10bRetained, method:'Original r10bRetainedContext feature, 3+ warmups, 20 timed calls; includes source parsing, frozen input file reads/checksums, Bend import/rigid transforms, topology validation. Excludes STEP and full singleStepR10b.'},
  checksum,
};
const target = join(root, 'out/benchmark.json'); mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.implementationStable) process.exitCode = 1;
