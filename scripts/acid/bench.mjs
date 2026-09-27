#!/usr/bin/env node
// Correctness-qualified, sequential CAD-Acid benchmark. No Bend or network CAD.
// Production: node scripts/acid/bench.mjs --revision <HEAD-sha> --out <directory>
// Functional smoke only: ... --zones AC01 --reps 1 --smoke
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync, execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {ROOT, CATALOG, VARIANTS, isMain, loadCatalog, readJSON, writeJSON, sha256, sourceHashes} from './common.mjs';
import {ADDITIVE_PHASES, phaseDefinitions, selectCases, summarize, aggregate, markdown, geometryDigest, checkOcctRepeat} from './bench-report.mjs';

const PYTHON = path.join(ROOT, 'out/build123d-performance/reference-venv/bin/python');

function parseOptions(args) {
  const options = {out: path.join(ROOT, 'out/cad-acid-perf'), reps: 5, timeout: 180, zones: null, smoke: false, revision: process.env.BENCH_REVISION ?? 'HEAD'};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${arg} needs a value`); return args[++i]; };
    if (arg === '--out') options.out = path.resolve(next());
    else if (arg === '--reps') options.reps = Number(next());
    else if (arg === '--timeout') options.timeout = Number(next());
    else if (arg === '--zones') options.zones = next().split(',');
    else if (arg === '--revision') options.revision = next();
    else if (arg === '--smoke') options.smoke = true;
    else throw new Error(`Unknown argument ${arg}`);
  }
  if (!Number.isInteger(options.reps) || options.reps < 1 || (!options.smoke && options.reps < 5)) throw new Error('At least 5 reps required; --smoke allows 1+ (not performance evidence)');
  if (!Number.isFinite(options.timeout) || options.timeout <= 0) throw new Error('Invalid timeout');
  return options;
}

function execute(command, args, log, timeout) {
  const start = performance.now();
  const child = spawnSync(command, args, {cwd: ROOT, encoding: 'utf8', timeout: timeout * 1000,
    detached: process.platform !== 'win32', killSignal: 'SIGKILL', maxBuffer: 16 << 20,
    env: {...process.env, NODE_OPTIONS: '--max-old-space-size=8192'}});
  const elapsedMs = performance.now() - start;
  if (child.error && child.pid && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  fs.writeFileSync(log, `$ ${[command, ...args].join(' ')}\nexit=${child.status} signal=${child.signal} error=${child.error?.message ?? ''}\n${child.stdout ?? ''}\n--- stderr\n${child.stderr ?? ''}`);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.status !== 0 || child.error) throw new Error(`BENCH_PROCESS_FAILED: ${log}`);
  return {elapsedMs, stdout: child.stdout};
}

export async function bench(options) {
  process.env.NODE_OPTIONS = '--max-old-space-size=8192';
  const {catalog, zonesSha256} = loadCatalog();
  if (options.zones?.some(id => !catalog.zones.some(z => z.id === id))) throw new Error('Unknown zone');
  const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], {encoding: 'utf8'}).trim();
  const revision = git('rev-parse', 'HEAD');
  if (git('rev-parse', '--verify', `${options.revision}^{commit}`) !== revision) throw new Error('REVISION_MISMATCH: benchmark the checked-out revision, not a label');
  const dirty = git('status', '--porcelain', '--untracked-files=normal', '--', 'scripts/', 'src/', 'rust/', 'fixtures/cad-acid/');
  if (dirty && !options.smoke) throw new Error('DIRTY_BENCHMARK_TREE: commit the landed implementation before measuring; --smoke is non-evidence');
  if (!fs.existsSync(PYTHON)) throw new Error('REFERENCE_VENV_UNAVAILABLE');
  // Never mix interrupted/stale samples into a new run.
  if (fs.existsSync(options.out) && fs.readdirSync(options.out).length) throw new Error(`OUTPUT_NOT_EMPTY: ${options.out}`);
  fs.mkdirSync(options.out, {recursive: true});
  const {executeRun} = await import('./execution.mjs');
  const {score, writeScoreboard} = await import('./score.mjs');
  const {codeIdentity} = await import('./evidence.mjs');
  const qualification = await executeRun({out: path.join(options.out, 'qualification'), kernels: ['wonky-rust'],
    zones: options.zones, variants: VARIANTS, noSmoke: true, timeout: options.timeout});
  const scoreboard = score(catalog, qualification, {zonesSha256});
  writeScoreboard(scoreboard, path.join(options.out, 'qualification'));
  if (scoreboard.verification.kernels.occt.status !== 'frozen') throw new Error('FROZEN_OCCT_REFERENCE_NOT_VERIFIED');
  const selection = selectCases(catalog, scoreboard, options.zones);
  const {locateRustBuild, rustStaleCheck} = await import('../../src/native/rust-kernel.mjs');
  const located = locateRustBuild();
  const addon = rustStaleCheck(located);
  const fixtureIdentity = () => sha256(JSON.stringify({
    catalog: sha256(fs.readFileSync(CATALOG)), sources: sourceHashes(catalog),
    errata: sha256(fs.readFileSync(path.join(ROOT, 'fixtures/cad-acid/errata.json'))),
    frozen: sha256(fs.readFileSync(path.join(ROOT, 'fixtures/cad-acid/occt/SHA256SUMS'))),
  }));
  const fixtureHash = fixtureIdentity();
  const addonSha256 = sha256(fs.readFileSync(addon.path));
  const report = {schema: 'wonky/cad-acid-perf/1', startedAt: new Date().toISOString(), revision, dirty,
    smoke: options.smoke, reps: options.reps, warmups: 1, denominator: catalog.zones.length * VARIANTS.length,
    machine: {hostname: os.hostname(), platform: process.platform, release: os.release(), arch: process.arch,
      cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), node: process.version},
    code: qualification.code, addon: {...addon, addonSha256, toolchain: located.manifest.toolchain},
    zonesSha256, sources: qualification.sources, fixtureHash, errata: scoreboard.errata,
    frozenOcct: {provenanceSha256: sha256(fs.readFileSync(path.join(ROOT, 'fixtures/cad-acid/occt/provenance.json')))},
    phases: phaseDefinitions, selection, coldStart: {}, cases: [], failures: [], totals: {}, resourcePeaks: {},
    repeatValidation: 'Rust topology/volume/bbox hash must match live qualification exactly. OCCT real metrics rechecked by existing scorer plus topology/bbox comparison to frozen reference. No per-repetition STEP roundtrip claim.',
    noClaim: options.smoke ? 'No-Claim: functional smoke only, including any MacBook timings. NOT quiet-M4 performance results.'
      : 'No-Claim: this compares only live wonky PASS / verified frozen OCCT PASS cases at this revision, not overall CAD coverage or pure kernel speed. Host quietness/thermal evidence must be reviewed separately. No Bend or Onshape performance claim.'};
  const save = () => {
    const aggregated = aggregate(report.cases);
    report.totals = Object.fromEntries(ADDITIVE_PHASES.map(phase => [phase, aggregated[phase]]));
    report.resourcePeaks = {peakRssMiB: aggregated.peakRssMiB};
    writeJSON(path.join(options.out, 'samples.json'), report);
    fs.writeFileSync(path.join(options.out, 'summary.md'), markdown(report));
  };
  save();
  for (const kernel of ['wonky-rust', 'occt']) {
    const out = path.join(options.out, 'cold', kernel);
    fs.mkdirSync(out, {recursive: true});
    const cold = [];
    for (let rep = 0; rep < options.reps; rep++) {
      const js = `require(${JSON.stringify(addon.path)}); console.log(JSON.stringify({peakRssMiB:process.resourceUsage().maxRSS/1024}));`;
      const py = 'import OCP, resource, sys, json; print(json.dumps({"peakRssMiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/(1024*1024 if sys.platform=="darwin" else 1024)}))';
      const result = execute(kernel === 'occt' ? 'uv' : process.execPath,
        kernel === 'occt' ? ['run', '--no-project', PYTHON, '-B', '-c', py] : ['-e', js],
        path.join(out, `cold-${rep}.log`), options.timeout);
      cold.push({coldStartMs: result.elapsedMs, coldPeakRssMiB: JSON.parse(result.stdout.trim().split('\n').at(-1)).peakRssMiB});
    }
    report.coldStart[kernel] = {samples: cold, summary: summarize(cold, true)};
    save();
  }
  for (const [index, pair] of selection.included.entries()) {
    const group = catalog.groups.find(g => g.zoneIds.includes(pair.zone));
    const caseResult = {...pair};
    try {
      // Alternate order across cases to reduce a systematic warm-cache/order bias.
      const kernels = index % 2 ? ['occt', 'wonky-rust'] : ['wonky-rust', 'occt'];
      caseResult.order = kernels;
      for (const kernel of kernels) {
        const out = path.join(options.out, pair.zone, pair.variant, kernel);
        fs.mkdirSync(out, {recursive: true});
        const source = path.join(ROOT, kernel === 'occt' ? group.b3d : group.fs);
        const request = {...pair, out, reps: options.reps, source, catalog: CATALOG,
          feature: group.featureScript.customFeature,
          parameters: {variant: `AcidVariant.${pair.variant}`, zone: `${group.featureScript.parameters.zone.type.replace('enum ', '')}.${pair.zone}`},
          result: path.join(out, 'warm.json')};
        const manifest = path.join(path.dirname(source), 'modules.json');
        if (fs.existsSync(manifest)) request.moduleManifest = manifest;
        const file = path.join(out, 'request.json');
        writeJSON(file, request);
        execute(kernel === 'occt' ? 'uv' : process.execPath,
          kernel === 'occt' ? ['run', '--no-project', PYTHON, '-B', path.join(ROOT, 'scripts/acid/bench-occt.py'), file]
            : [path.join(ROOT, 'scripts/acid/bench-wonky.mjs'), file], path.join(out, 'warm.log'), options.timeout);
        const warm = readJSON(request.result);
        const qualified = qualification.rows.find(r => r.kernel === kernel && r.zone === pair.zone && r.variant === pair.variant);
        if (warm.samples.length !== options.reps) throw new Error(`INCOMPLETE_SAMPLES: ${kernel}`);
        if (kernel === 'wonky-rust' && warm.backend.sourceHash !== addon.sourceHash) throw new Error('TIMED_ADDON_MISMATCH');
        if (kernel === 'occt' && Object.entries(qualified.versions ?? {}).some(([k, v]) => warm.versions[k] !== v)) throw new Error(`OCCT_VERSION_DIFFERS_FROM_FROZEN: ${JSON.stringify(warm.versions)} vs ${JSON.stringify(qualified.versions)}`);
        // Eligibility comes ONLY from the live scorer and verified frozen scorer.
        // Bind each repeat to that observation; never invent a new AC41 band here.
        const zone = catalog.zones.find(z => z.id === pair.zone);
        for (const sample of [warm.warmup, ...warm.samples]) {
          if (kernel === 'wonky-rust' && (sample.observationSha256 !== geometryDigest(qualified.nativeObservation.metrics)
              || sample.observationSha256 !== geometryDigest(sample.observation))) throw new Error('TIMED_RUST_OBSERVATION_DIFFERS_FROM_LIVE_PASS');
          if (kernel === 'occt') {
            const mismatch = checkOcctRepeat(catalog, zone, qualified, sample.observation, scoreboard.errata);
            if (mismatch) throw new Error(`TIMED_OCCT_OBSERVATION_DIFFERS_FROM_FROZEN_PASS: ${mismatch}`);
          }
          for (const key of ['constructionMs', 'measurementMs', 'exportMs', 'peakRssMiB']) {
            if (!Number.isFinite(sample[key]) || sample[key] < 0) throw new Error(`INVALID_SAMPLE: ${kernel}/${key}`);
          }
        }
        caseResult[kernel] = {...warm, summary: summarize(warm.samples)};
      }
      caseResult.ratios = Object.fromEntries(Object.entries(aggregate([caseResult])).map(([phase, value]) => [phase, value.ratio]));
      report.cases.push(caseResult);
      console.log(`${pair.zone}/${pair.variant}: measured (${options.reps} reps; ${options.smoke ? 'SMOKE ONLY' : 'review quiet-host evidence'})`);
    } catch (error) {
      report.failures.push({...pair, reason: error.message});
      console.error(`${pair.zone}/${pair.variant}: ${error.stack}`);
    }
    save();
  }
  if (codeIdentity().treeSha256 !== qualification.code.treeSha256
      || rustStaleCheck(locateRustBuild()).sourceHash !== addon.sourceHash
      || sha256(fs.readFileSync(addon.path)) !== addonSha256 || fixtureIdentity() !== fixtureHash) {
    report.invalidated = 'BENCHMARK_CODE_OR_FIXTURES_CHANGED';
    report.noClaim = `No-Claim: INVALIDATED, ${report.invalidated}; discard all timings.`;
    save();
    throw new Error(report.invalidated);
  }
  report.finishedAt = new Date().toISOString();
  save();
  if (!report.cases.length || report.failures.length) process.exitCode = 1;
  return report;
}

if (isMain(import.meta.url)) {
  try { await bench(parseOptions(process.argv.slice(2))); }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
