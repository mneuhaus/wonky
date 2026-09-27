// Warm-process worker. Only bench.mjs selects/scorers cases; this never mints PASS evidence.
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {readJSON, writeJSON} from './common.mjs';
import {geometryDigest} from './bench-report.mjs';
import {nativeObservation, assertValidTimedNativeObservation} from './native-observation.mjs';

process.env.WONKY_BACKEND = 'rust';
const request = readJSON(process.argv[2]);
const {guardSummary} = await import('../r20/bend-guard.mjs');
const {build} = await import('../../src/index.mjs');
const {loadKernel} = await import('../../src/kernel.mjs');
const {toStep} = await import('../../src/exporters.mjs');
const rust = await import('../../src/native/rust-host.mjs');
const backend = rust.rustHostOf(await loadKernel());
const addon = backend.addon;
const source = fs.readFileSync(request.source, 'utf8');
const catalog = readJSON(request.catalog);
const zone = catalog.zones.find(z => z.id === request.zone);

// Time the actual synchronous N-API entry points, not the JS host adapters.
// Includes N-API copying, decode, audits and encode; NOT pure Rust algorithm time.
let boundary = null;
const originals = new Map();
for (const key of ['hostOp', 'call']) {
  if (typeof addon[key] !== 'function') continue;
  const original = addon[key];
  originals.set(key, original);
  const wrapper = function (...args) {
    if (!boundary) return original.apply(addon, args);
    const label = `${key}:${key === 'hostOp' ? args[0][2] : args[0]}`;
    const start = performance.now();
    try { return original.apply(addon, args); }
    finally {
      const entry = boundary[label] ??= {calls: 0, ms: 0};
      entry.calls++;
      entry.ms += performance.now() - start;
    }
  };
  addon[key] = wrapper;
  if (addon[key] !== wrapper) throw new Error(`NATIVE_TIMING_WRAPPER_UNAVAILABLE: ${key}`);
}

// Scored and timed builds share their native observation; only timing and
// repeat binding happen here, never catalog expected-answer scoring.
function observe(model) {
  return nativeObservation(model, rust, catalog, zone, request.variant);
}

try {
  const samples = [];
  let warmup;
  for (let i = -1; i < request.reps; i++) {
    boundary = {};
    const start = performance.now();
    const model = await build(source, {
      feature: request.feature, parameters: request.parameters, sourcePath: request.source,
      moduleManifest: request.moduleManifest, maxSteps: 20_000_000,
    });
    const constructionMs = performance.now() - start;
    const nativeCalls = boundary;
    boundary = null;
    const measurementStart = performance.now();
    const observed = observe(model);
    const measurementMs = performance.now() - measurementStart;
    assertValidTimedNativeObservation(observed, zone);
    const exportStart = performance.now();
    const step = toStep(model, `acid-perf-${request.zone}-${request.variant}`);
    fs.writeFileSync(path.join(request.out, 'model.step'), step);
    const exportMs = performance.now() - exportStart;
    if (!step.includes('ISO-10303-21;')) throw new Error('TIMED_STEP_EXPORT_INVALID');
    const {topology, volume, bbox, measurements, measurementErrors} = observed.metrics;
    const observation = {topology, volume, bbox, measurements, measurementErrors,
      measurementEvidence: observed.measurementEvidence};
    const sample = {
      observationSha256: geometryDigest(observation), observation,
      constructionMs, measurementMs, exportMs,
      warmPipelineMs: constructionMs + measurementMs + exportMs,
      nativeBoundaryMs: Object.values(nativeCalls).reduce((sum, x) => sum + x.ms, 0),
      kernelOnlyMs: null, nativeCalls,
      peakRssMiB: process.resourceUsage().maxRSS / 1024,
      bodies: model.bodies.length,
      volume,
      stepBytes: Buffer.byteLength(step),
    };
    if (i < 0) warmup = sample;
    else samples.push(sample);
  }
  if (guardSummary().bendLoaded) throw new Error('STRICT_BACKEND_BEND_LEAK');
  writeJSON(request.result, {kernel: 'wonky-rust', backend: {sourceHash: backend.sourceHash}, warmup, samples, guard: guardSummary()});
} finally {
  boundary = null;
  for (const [key, original] of originals) addon[key] = original;
}
