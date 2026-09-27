#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE: the runner (docs/bakeoff.md).
//
//   node scripts/bakeoff/run.mjs --proto <name> [--cases id,...]
//     [--targets js,cpu1,cpuN,metal] [--repeat k] [--timeout s]
//     [--threads N] [--rebuild] [--no-validate] [--source oracle-manifold|<proto>|<dir>]
//     [--suite <dir>] [--out <dir>] [--gpu <size>]
//
// --suite runs an extra case set (e.g. the adversarial cases) prepared by
// scripts/bakeoff/suite.mjs: <dir>/cases.json, <dir>/jobs/<id>.{job,csg.job},
// <dir>/reference.json and the manifold3d result dumps <dir>/results/.
// --out writes report.json, summary.md and results/ there instead of
// out/bakeoff/<name>/ (so subset runs do not overwrite the full report).
// --gpu sets the Metal target's device heap (e.g. 8GB); the default is the
// prototype's own `gpu` in prototypes.mjs (--gpu-mem is an alias).
// Disputed cases (OCCT and manifold3d disagree) are scored with the oracle
// arbitration in fixtures/bakeoff/arbiter.json (scripts/bakeoff/arbiter.mjs).
//
// Builds the prototype's native binaries when their sources changed, runs
// every selected case on every target with a per-case timeout, validates the
// result mesh (scripts/bakeoff/validate.mjs), compares it with the oracles in
// fixtures/bakeoff/reference.json and writes out/bakeoff/<name>/report.json
// and summary.md. It computes no geometry itself.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileBend } from '../../src/bend-loader.mjs';
import { arbiterFor, loadArbiter, oracleDispute } from './arbiter.mjs';
import { ROOT, ensureJobs, loadCases } from './fixtures.mjs';
import { decodeHybrid, decodeResult } from './jobfmt.mjs';
import { prototype } from './prototypes.mjs';
import { validateResult } from './validate.mjs';

const { version: BEND_VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, 'bend.lock.json'), 'utf8'));
const BEND = path.join(ROOT, `.tools/bend-${BEND_VERSION}/bin/bend`);
const DEVICE_MARK = '@bakeoff-device-call';
const ALL_TARGETS = ['js', 'cpu1', 'cpuN', 'metal'];
// Mesh-level agreement with manifold3d on the same input meshes.
export const VOLUME_EXACT = 1e-7;
export const VOLUME_AGREE = 1e-4;

const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

// Jobs of a prepared suite directory (scripts/bakeoff/suite.mjs); same shape
// as ensureJobs, the sidecar reduced to the job hash the reference must match.
function suiteJobs(dir, ids) {
  const out = {};
  for (const id of ids) {
    const job = path.join(dir, 'jobs', `${id}.job`);
    const csg = path.join(dir, 'jobs', `${id}.csg.job`);
    if (!fs.existsSync(job) || !fs.existsSync(csg)) throw new Error(`suite ${dir}: job files of ${id} missing (run scripts/bakeoff/suite.mjs)`);
    out[id] = { job, csg, sidecar: { jobSha256: sha256(fs.readFileSync(job, 'utf8')) } };
  }
  return out;
}

function parseArgs(argv) {
  const opts = { targets: ALL_TARGETS, repeat: 1, timeout: 120, threads: os.cpus().length, validate: true, rebuild: false, source: 'oracle-manifold', gpuMem: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--proto') opts.proto = next();
    else if (a === '--cases') opts.cases = next().split(',').filter(Boolean);
    else if (a === '--targets') opts.targets = next().split(',').filter(Boolean);
    else if (a === '--repeat') opts.repeat = Math.max(1, Number(next()));
    else if (a === '--timeout') opts.timeout = Number(next());
    else if (a === '--threads') opts.threads = Number(next());
    else if (a === '--source') opts.source = next();
    else if (a === '--suite') opts.suite = path.resolve(next());
    else if (a === '--out') opts.out = path.resolve(next());
    else if (a === '--gpu' || a === '--gpu-mem') opts.gpuMem = next();
    else if (a === '--rebuild') opts.rebuild = true;
    else if (a === '--no-validate') opts.validate = false;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  for (const t of opts.targets) if (!ALL_TARGETS.includes(t)) throw new Error(`unknown target ${t} (known: ${ALL_TARGETS.join(',')})`);
  if (opts.gpuMem !== null) checkGpuMem(opts.gpuMem, '--gpu');
  return opts;
}

// A device heap as the Bend runtime's --gpu takes it for the metal target:
// `on` (the runtime default, 2GB on Metal) or a size like 512MB or 8GB
// (KB and lower-case units are rejected by the runtime). `off` is not a
// heap: run the CPU targets instead of metal.
export function checkGpuMem(value, source) {
  if (!/^(on|[1-9][0-9]*(MB|GB))$/.test(value)) throw new Error(`${source}: metal device heap must be 'on' or a size like 512MB or 8GB, got '${value}'`);
  return value;
}

// The Metal heap for a run: --gpu wins, else the prototype's registry value.
export function gpuMemFor(proto, cliValue) {
  if (cliValue) return { gpuMem: checkGpuMem(cliValue, '--gpu'), gpuSource: 'cli' };
  return { gpuMem: checkGpuMem(proto.gpu, `prototypes.mjs ${proto.name}.gpu`), gpuSource: 'prototype' };
}

function command(executable, args, { timeoutMs = 300000, cwd = ROOT } = {}) {
  const start = performance.now();
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd, env: { ...process.env, BEND_NO_TELEMETRY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', (e) => { stderr += e.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, wallMs: performance.now() - start, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Builds

// The prototype's native.bend and everything it imports (transitively), as
// ROOT-relative paths. Other teams' or unrelated kernel edits do not change
// the key, so they no longer force a rebuild.
export function bendSources(entry) {
  const seen = new Set();
  const visit = (abs) => {
    const rel = path.relative(ROOT, abs);
    if (seen.has(rel)) return;
    seen.add(rel);
    for (const m of fs.readFileSync(abs, 'utf8').matchAll(/^\s*import\s+(\.{1,2}\/\S+?\.bend)\s+as\s/gm)) {
      visit(path.resolve(path.dirname(abs), m[1]));
    }
  };
  visit(path.resolve(ROOT, entry));
  return [...seen].sort();
}

function buildKey(proto, target) {
  const h = crypto.createHash('sha256').update(`${BEND_VERSION}\n${target}\n`);
  for (const f of bendSources(path.join(proto.dir, 'native.bend'))) h.update(f).update(fs.readFileSync(path.join(ROOT, f)));
  return h.digest('hex');
}

// The Metal driver is native.bend with the call on the marked line turned
// into a `!` (device) call. Without a marked line the source is used as is
// (the prototype places its own `!` calls). Returns the variant source text.
export function metalVariant(source) {
  const lines = source.split('\n');
  const marked = lines.map((l, i) => [l, i]).filter(([l]) => l.includes(DEVICE_MARK) && !l.trimStart().startsWith('#'));
  if (marked.length === 0) return source;
  if (marked.length !== 1) throw new Error(`native.bend may mark at most one code line with ${DEVICE_MARK} (found ${marked.length})`);
  const [line, i] = marked[0];
  const eq = line.indexOf('=');
  const m = /([A-Za-z_][A-Za-z0-9_.]*)\(/.exec(line.slice(eq + 1));
  if (eq < 0 || !m) throw new Error(`cannot find the call on the ${DEVICE_MARK} line: ${line.trim()}`);
  const at = eq + 1 + m.index + m[1].length;
  lines[i] = `${line.slice(0, at)}!${line.slice(at)}`;
  return lines.join('\n');
}

const METAL_PASS = 'static void gpu_pass(u32 f) {\n  @autoreleasepool {';
const METAL_DONE = '  io_sync();\n  return code;';

async function buildNative(proto, target, log) {
  const dir = path.join(ROOT, 'out/bakeoff', proto.name, 'build');
  fs.mkdirSync(dir, { recursive: true });
  const binary = path.join(dir, target);
  const keyFile = `${binary}.key`;
  const key = buildKey(proto, target);
  if (!log.rebuild && fs.existsSync(binary) && fs.existsSync(keyFile) && fs.readFileSync(keyFile, 'utf8') === key) {
    return { binary, cached: true, ms: 0 };
  }
  const native = path.join(ROOT, proto.dir, 'native.bend');
  if (!fs.existsSync(native)) throw new Error(`${proto.dir}/native.bend is missing`);
  const t0 = performance.now();
  const logs = [];
  const step = async (exe, args, label) => {
    const r = await command(exe, args, { timeoutMs: 1800000 });
    logs.push(`$ ${exe} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
    fs.writeFileSync(`${binary}.build.log`, logs.join('\n'));
    if (r.code !== 0) throw new Error(`${label} failed (code ${r.code}${r.timedOut ? ', timeout' : ''}); see ${path.relative(ROOT, binary)}.build.log`);
  };
  if (target === 'cpu') {
    await step(BEND, [native, '-o', binary], 'bend native build');
  } else {
    const variant = path.join(ROOT, proto.dir, '.bakeoff-native-metal.bend');
    fs.writeFileSync(variant, metalVariant(fs.readFileSync(native, 'utf8')));
    const cfile = `${binary}.c`;
    try {
      await step(BEND, [variant, '-o', cfile], 'bend C emit');
    } finally {
      fs.rmSync(variant, { force: true });
    }
    let c = fs.readFileSync(cfile, 'utf8');
    if (!c.includes(METAL_PASS) || !c.includes(METAL_DONE)) throw new Error('pinned Metal runtime instrumentation anchors changed');
    // Host-only counter proving that the Metal command path ran (same
    // instrumentation as scripts/benchmark-hardware.mjs).
    c = c.replace(METAL_PASS, 'static unsigned long wonky_metal_passes = 0;\nstatic void gpu_pass(u32 f) {\n  wonky_metal_passes++;\n  @autoreleasepool {')
      .replace(METAL_DONE, '  io_sync();\n  fprintf(stderr, "wonky_metal_passes=%lu\\n", wonky_metal_passes);\n  return code;');
    fs.writeFileSync(cfile, c);
    await step('clang', ['-DBEND_METAL=1', '-x', 'objective-c', '-fobjc-arc', '-fmodules', '-std=c11', '-O3', cfile, '-lpthread', '-lm', '-o', binary], 'clang Metal build');
    await step(binary, ['--gpu-build'], 'Metal device build');
  }
  fs.writeFileSync(keyFile, key);
  return { binary, cached: false, ms: performance.now() - t0 };
}

// ---------------------------------------------------------------------------
// Running

const PHASES = ['readMs', 'parseMs', 'computeMs', 'serializeMs', 'writeMs'];

async function runNative(binary, target, input, output, opts) {
  const threads = target === 'cpu1' ? 1 : opts.threads;
  const gpu = target === 'metal' ? opts.gpuMem : 'off';
  const samples = [];
  for (let i = 0; i < opts.repeat; i++) {
    fs.rmSync(output, { force: true });
    const r = await command(binary, ['--threads', String(threads), '--gpu', gpu, '--', input, output], { timeoutMs: opts.timeout * 1000 });
    if (r.timedOut) return { outcome: 'timeout', wallMs: r.wallMs };
    if (r.code !== 0 || !fs.existsSync(output)) {
      return { outcome: 'error', code: r.code, signal: r.signal, stderr: r.stderr.slice(-2000), stdout: r.stdout.slice(-500) };
    }
    const line = r.stdout.split('\n').reverse().find((l) => l.trim().startsWith('{'));
    let t = {};
    try {
      t = JSON.parse(line);
    } catch {
      return { outcome: 'error', reason: 'no phase-timing JSON line on stdout', stdout: r.stdout.slice(-500) };
    }
    const phaseSum = PHASES.reduce((s, k) => s + (t[k] ?? 0), 0);
    const passes = /wonky_metal_passes=(\d+)/.exec(r.stderr);
    samples.push({ ...t, processWallMs: r.wallMs, startupMs: Math.max(0, r.wallMs - phaseSum), metalPasses: passes ? Number(passes[1]) : null });
  }
  const timing = {};
  for (const k of [...PHASES, 'processWallMs', 'startupMs']) timing[k] = median(samples.map((s) => s[k]));
  const out = { outcome: 'ran', threads, gpu, timing, samples: samples.length };
  if (target === 'metal') {
    out.metalPasses = Math.min(...samples.map((s) => s.metalPasses ?? 0));
    out.metalEvidence = out.metalPasses > 0;
  }
  return out;
}

async function runJs(proto, input, output, opts) {
  const worker = path.join(ROOT, 'scripts/bakeoff/js-worker.mjs');
  const entry = path.join(ROOT, proto.dir, 'main.bend');
  fs.rmSync(output, { force: true });
  const r = await command(process.execPath, ['--stack-size=65500', worker, entry, input, output, String(opts.repeat)], { timeoutMs: opts.timeout * 1000 });
  if (r.timedOut) return { outcome: 'timeout', wallMs: r.wallMs };
  const line = r.stdout.split('\n').reverse().find((l) => l.trim().startsWith('{'));
  if (r.code !== 0 || !line || !fs.existsSync(output)) return { outcome: 'error', code: r.code, stderr: r.stderr.slice(-2000) };
  const t = JSON.parse(line);
  return { outcome: 'ran', timing: { loadMs: t.loadMs, coldMs: t.coldMs, ...t.warm, processWallMs: r.wallMs }, phased: t.phased, deterministic: t.deterministic, samples: t.runs };
}

// ---------------------------------------------------------------------------
// Scoring

// `arb` is the case's oracle arbitration (scripts/bakeoff/arbiter.mjs,
// fixtures/bakeoff/arbiter.json) when OCCT and manifold3d disagree on it: the
// third reference then replaces the overruled oracle (see verdictOf). A
// dispute without an entry is recorded as `unarbitrated`: neither oracle
// decides it alone.
export function compare(report, ref, arb = null) {
  if (!ref && !arb) return null;
  const out = {};
  ref ??= {};
  const m = ref.manifold;
  if (m && !m.error) {
    out.manifoldVolume = m.volume;
    out.volumeRelErrVsManifold = Math.abs(report.volume - m.volume) / Math.max(Math.abs(m.volume), 1e-12);
    out.volumeAbsErrVsManifold = Math.abs(report.volume - m.volume);
    out.componentsMatch = report.components === m.components;
    // manifold3d: genus = 1 - chi/2 over the whole mesh.
    out.eulerMatch = report.euler === 2 - 2 * m.genus;
    out.areaRelErrVsManifold = Math.abs(report.area - m.area) / Math.max(m.area, 1e-12);
    if (m.tagArea && report.tagArea) {
      const tags = new Set([...Object.keys(m.tagArea), ...Object.keys(report.tagArea)]);
      let worst = 0;
      for (const t of tags) worst = Math.max(worst, Math.abs((m.tagArea[t] ?? 0) - (report.tagArea[t] ?? 0)));
      out.tagAreaMaxAbsErrVsManifold = worst;
      out.tagAreaMaxRelErrVsManifold = worst / Math.max(m.area, 1e-12);
    }
    // A lost or invented feature can hide inside the volume bound (a thin fin
    // is little volume): the result's bbox must match manifold3d's to within
    // two deviations (both meshes lie within one deviation of the exact
    // surface) plus rounding. manifold3d, not OCCT: BRepBndLib's "optimal"
    // box is loose on trimmed spheres (2.5 mm on adv2-sphere-rotated-corner).
    if (m.bbox && report.bbox) {
      const extent = Math.max(...m.bbox.max.map((x, k) => x - m.bbox.min[k]), 0);
      out.bboxMaxAbsErrVsManifold = Math.max(...[0, 1, 2].flatMap((k) => [Math.abs(report.bbox.min[k] - m.bbox.min[k]), Math.abs(report.bbox.max[k] - m.bbox.max[k])]));
      out.bboxTolerance = 2 * ref.deviationMm + 1e-6 * (1 + extent);
      out.bboxMatch = out.bboxMaxAbsErrVsManifold <= out.bboxTolerance;
    }
  }
  const o = ref.occt;
  if (o && !o.error) {
    out.occtVolume = o.volume;
    out.volumeAbsErrVsOcct = Math.abs(report.volume - o.volume);
    // A mesh within `deviation` of the exact surface differs in volume by at
    // most area x deviation (first order).
    out.analyticBound = o.area * ref.deviationMm;
    out.withinAnalyticBound = out.volumeAbsErrVsOcct <= out.analyticBound;
    out.occtShellsMatch = report.components === (o.shells ?? o.solids);
  }
  if (!arb) {
    const why = oracleDispute(ref);
    if (why) out.unarbitrated = why;
  }
  if (arb) {
    const R = arb.reference;
    out.arbiter = { decision: arb.decision, class: arb.class };
    out.referenceVolume = R.volume;
    out.volumeAbsErrVsReference = Math.abs(report.volume - R.volume);
    out.referenceTolerance = R.volumeTolAbs;
    out.withinReference = out.volumeAbsErrVsReference <= R.volumeTolAbs;
    if (arb.decision === 'ambiguous') {
      out.admissibleTopology = arb.admissible.some((a) => a.shells === report.components && a.euler === report.euler);
    } else if (arb.decision !== 'expectation') {
      // Topology from the third reference; the overruled oracle's volume
      // criterion no longer counts.
      out.componentsMatch = report.components === R.shells;
      out.eulerMatch = report.euler === R.euler;
    }
  }
  return out;
}

function tagAreas(mesh) {
  const areas = {};
  for (const [a, b, c, tag] of mesh.triangles) {
    const A = mesh.vertices[a], B = mesh.vertices[b], C = mesh.vertices[c];
    if (!A || !B || !C) continue; // bad indices are reported by the validator
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const ar = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
    areas[tag] = (areas[tag] ?? 0) + ar;
  }
  return areas;
}

// verdict: pass | mismatch | invalid | unresolved | expected-refusal |
//          info (valid mesh for a non-manifold-contact case) |
//          ambiguous (the oracles disagree and the arbiter found the case
//                     undecidable on the rounded input; the answer has one
//                     of the admissible topologies and the reference volume) |
//          unarbitrated (the oracles disagree, the case has no arbiter entry,
//                        and the answer agrees with one of them: not scored
//                        right or wrong until the dispute is arbitrated) |
//          error | timeout
// An `ok` mesh that the validator rejects is `invalid` for every expectation,
// including non-manifold-contact (an invalid mesh is never an answer).
export function verdictOf(expect, status, report, cmp) {
  if (status === 'unresolved') return expect === 'non-manifold-contact' ? 'expected-refusal' : 'unresolved';
  if (!report || !report.valid) return 'invalid';
  if (expect === 'non-manifold-contact') return 'info';
  if (expect === 'empty') return report.triangles === 0 ? 'pass' : 'mismatch';
  if (report.triangles === 0) return 'mismatch';
  if (!cmp) return 'pass';
  if (cmp.unarbitrated) {
    // Either oracle may be the wrong one; an answer that matches neither is
    // wrong either way.
    const byManifold = cmp.componentsMatch !== false && cmp.eulerMatch !== false && (cmp.volumeRelErrVsManifold ?? Infinity) <= VOLUME_AGREE && cmp.bboxMatch !== false;
    const byOcct = cmp.occtShellsMatch === true && cmp.withinAnalyticBound === true;
    return byManifold || byOcct ? 'unarbitrated' : 'mismatch';
  }
  const decision = cmp.arbiter?.decision;
  if (decision === 'ambiguous') return cmp.admissibleTopology && cmp.withinReference && cmp.bboxMatch !== false ? 'ambiguous' : 'mismatch';
  const topo = cmp.componentsMatch !== false && cmp.eulerMatch !== false;
  // An arbitrated case drops the overruled oracle's volume criterion and
  // accepts the third reference's.
  const byManifold = decision !== 'occt' && decision !== 'reference' && (cmp.volumeRelErrVsManifold ?? Infinity) <= VOLUME_AGREE;
  const byOcct = decision !== 'manifold' && decision !== 'reference' && cmp.withinAnalyticBound === true;
  const vol = byManifold || byOcct || cmp.withinReference === true;
  return topo && vol && cmp.bboxMatch !== false ? 'pass' : 'mismatch';
}

export function tier(cmp) {
  const e = cmp?.volumeRelErrVsManifold;
  if (e === undefined) return null;
  return e <= VOLUME_EXACT ? 'exact' : e <= VOLUME_AGREE ? 'agree' : 'off';
}

// ---------------------------------------------------------------------------

function fmt(x, digits = 1) {
  if (x === null || x === undefined) return '-';
  if (typeof x !== 'number') return String(x);
  return x.toFixed(digits);
}

function summaryMarkdown(rep) {
  const L = [];
  L.push(`# Bake-off: ${rep.proto}`, '');
  L.push(`${rep.capturedAt} · Bend ${rep.environment.bend} · ${rep.environment.cpu} (${rep.environment.logicalCpus} logical) · targets ${rep.targets.join(', ')} · repeat ${rep.repeat}`, '');
  const counts = {};
  for (const c of rep.cases) counts[c.verdict] = (counts[c.verdict] ?? 0) + 1;
  L.push(`Verdicts: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`, '');
  const ts = rep.targets;
  L.push(`| case | expect | verdict | tris | vol rel err vs manifold (tier) | vs OCCT / bound | ${ts.map((t) => `${t} compute ms`).join(' | ')} | parse ms (cpu1) |`);
  L.push(`|${'---|'.repeat(7 + ts.length)}`);
  for (const c of rep.cases) {
    const cmp = c.comparison ?? {};
    const vs = cmp.volumeRelErrVsManifold !== undefined ? `${cmp.volumeRelErrVsManifold.toExponential(1)} (${c.tier})` : '-';
    const oc = cmp.volumeAbsErrVsOcct !== undefined ? `${cmp.volumeAbsErrVsOcct.toExponential(1)} / ${cmp.analyticBound.toExponential(1)}` : '-';
    const times = ts.map((t) => {
      const r = c.targets[t];
      if (!r) return '-';
      if (r.outcome !== 'ran') return r.outcome;
      const ms = t === 'js' ? (r.timing.computeMs ?? r.timing.totalMs) : r.timing.computeMs;
      return `${fmt(ms)}${t === 'metal' && !r.metalEvidence ? ' (no Metal pass)' : ''}`;
    });
    const reason = c.status === 'unresolved' ? ` (${c.reason.slice(0, 60)})` : '';
    L.push(`| ${c.id} | ${c.expect} | ${c.verdict}${reason} | ${c.report?.triangles ?? '-'} | ${vs} | ${oc} | ${times.join(' | ')} | ${fmt(c.targets.cpu1?.timing?.parseMs)} |`);
  }
  L.push('');
  L.push('Native times are medians of IO.now (whole milliseconds) inside the binary; startup = process wall minus the phases. JS times are warm medians (performance.now) after one cold run in a fresh process.');
  if (rep.builds) {
    L.push('', `Builds: ${Object.entries(rep.builds).map(([k, b]) => `${k} ${b.cached ? 'cached' : `${fmt(b.ms / 1000, 1)} s`}`).join(', ')}`);
  }
  return L.join('\n') + '\n';
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help || !opts.proto) {
    console.log('usage: node scripts/bakeoff/run.mjs --proto <name> [--cases id,...] [--targets js,cpu1,cpuN,metal] [--repeat k] [--timeout s] [--threads N] [--rebuild] [--no-validate] [--source oracle-manifold|<proto>|<dir>] [--suite <dir>] [--out <dir>] [--gpu <size>]');
    process.exit(opts.help ? 0 : 2);
  }
  const proto = prototype(opts.proto);
  Object.assign(opts, gpuMemFor(proto, opts.gpuMem));
  const arbiter = loadArbiter();
  if (!fs.existsSync(path.join(ROOT, proto.dir, 'main.bend'))) throw new Error(`${proto.dir}/main.bend does not exist yet`);
  const allCases = opts.suite ? JSON.parse(fs.readFileSync(path.join(opts.suite, 'cases.json'), 'utf8')).cases : loadCases();
  const cases = opts.cases ? opts.cases.map((id) => {
    const c = allCases.find((x) => x.id === id);
    if (!c) throw new Error(`unknown case ${id}`);
    return c;
  }) : allCases;
  const jobs = opts.suite ? suiteJobs(opts.suite, cases.map((c) => c.id)) : ensureJobs(cases.map((c) => c.id));
  const refPath = opts.suite ? path.join(opts.suite, 'reference.json') : path.join(ROOT, 'fixtures/bakeoff/reference.json');
  const reference = fs.existsSync(refPath) ? JSON.parse(fs.readFileSync(refPath, 'utf8')) : null;
  const manifoldDumps = opts.suite ? path.join(opts.suite, 'results') : path.join(ROOT, 'out/bakeoff/oracle-manifold');

  const outDir = opts.out ?? path.join(ROOT, 'out/bakeoff', proto.name);
  const resDir = path.join(outDir, 'results');
  fs.mkdirSync(resDir, { recursive: true });

  const rep = {
    schema: 'wonky-bakeoff-report/1',
    proto: proto.name,
    input: proto.input,
    output: proto.output,
    capturedAt: new Date().toISOString(),
    targets: opts.targets,
    repeat: opts.repeat,
    timeoutS: opts.timeout,
    suite: opts.suite ? path.relative(ROOT, opts.suite) : null,
    source: proto.input === 'recover' ? opts.source : undefined,
    gpuMem: opts.gpuMem,
    gpuSource: opts.gpuSource,
    loadavgStart: os.loadavg(),
    environment: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, threadsN: opts.threads, platform: `${os.platform()} ${os.release()}`, node: process.version, bend: BEND_VERSION },
    thresholds: { volumeExact: VOLUME_EXACT, volumeAgree: VOLUME_AGREE },
    builds: {},
    cases: [],
  };

  const binaries = {};
  const wantCpu = opts.targets.some((t) => t === 'cpu1' || t === 'cpuN');
  for (const [target, wanted] of [['cpu', wantCpu], ['metal', opts.targets.includes('metal')]]) {
    if (!wanted) continue;
    if (target === 'metal' && os.platform() !== 'darwin') {
      rep.builds.metal = { error: 'Metal builds need macOS' };
      continue;
    }
    process.stdout.write(`build ${target} … `);
    try {
      const b = await buildNative(proto, target, { rebuild: opts.rebuild });
      binaries[target] = b.binary;
      rep.builds[target] = { cached: b.cached, ms: b.ms };
      console.log(b.cached ? 'cached' : `${(b.ms / 1000).toFixed(1)} s`);
    } catch (err) {
      rep.builds[target] = { error: err.message };
      console.log(`FAILED: ${err.message}`);
    }
  }
  if (opts.targets.includes('js')) {
    const t0 = performance.now();
    try {
      const c = await compileBend(path.join(ROOT, proto.dir, 'main.bend'));
      rep.builds.js = { cached: c.cacheHit, ms: performance.now() - t0 };
    } catch (err) {
      rep.builds.js = { error: err.message };
    }
  }

  for (const c of cases) {
    const job = jobs[c.id];
    let input = proto.input === 'csg' ? job.csg : job.job;
    const entry = { id: c.id, category: c.category, expect: c.expect ?? 'solid', deviationMm: c.deviationMm, input: path.relative(ROOT, input), targets: {} };
    if (proto.input === 'recover') {
      // Source: manifold3d dumps, a prototype name (out/bakeoff/<proto>/results)
      // or a results directory (<id>.<target>.result).
      const srcDir = opts.source === 'oracle-manifold' ? null
        : opts.source.includes('/') ? path.resolve(opts.source) : path.join(ROOT, 'out/bakeoff', opts.source, 'results');
      const src = srcDir === null
        ? path.join(manifoldDumps, `${c.id}.result`)
        : ['cpu1', 'cpuN', 'js', 'metal'].map((t) => path.join(srcDir, `${c.id}.${t}.result`)).find((p) => fs.existsSync(p));
      if (!src || !fs.existsSync(src) || !fs.readFileSync(src, 'utf8').startsWith('ok')) {
        entry.verdict = 'no-source';
        entry.reason = src && fs.existsSync(src)
          ? `source ${opts.source}: ${fs.readFileSync(src, 'utf8').split('\n', 1)[0].slice(0, 160)}`
          : `no ok tagged mesh from ${opts.source} (run uv run scripts/bakeoff/reference.py --dump out/bakeoff/oracle-manifold)`;
        rep.cases.push(entry);
        console.log(`${c.id.padEnd(28)} no-source`);
        continue;
      }
      input = path.join(outDir, 'inputs', `${c.id}.recover.job`);
      fs.mkdirSync(path.dirname(input), { recursive: true });
      fs.writeFileSync(input, fs.readFileSync(job.job, 'utf8') + fs.readFileSync(src, 'utf8'));
      entry.input = path.relative(ROOT, input);
      entry.source = path.relative(ROOT, src);
    }
    const outputs = {};
    for (const t of opts.targets) {
      const output = path.join(resDir, `${c.id}.${t}.result`);
      let r;
      if (t === 'js') r = rep.builds.js?.error ? { outcome: 'error', reason: 'js build failed' } : await runJs(proto, input, output, opts);
      else {
        const bin = binaries[t === 'metal' ? 'metal' : 'cpu'];
        r = bin ? await runNative(bin, t, input, output, opts) : { outcome: 'error', reason: `${t} build failed` };
      }
      if (r.outcome === 'ran') {
        const text = fs.readFileSync(output, 'utf8');
        r.resultSha256 = sha256(text);
        r.resultBytes = text.length;
        outputs[t] = text;
      }
      entry.targets[t] = r;
    }
    // Determinism across targets.
    const texts = Object.entries(outputs);
    entry.targetsAgree = texts.every(([, x]) => x === texts[0]?.[1]);
    if (!texts.length) {
      const outs = Object.values(entry.targets).map((r) => r.outcome);
      entry.verdict = outs.includes('timeout') ? 'timeout' : 'error';
    } else {
      const [firstTarget, text] = texts[0];
      entry.scoredTarget = firstTarget;
      try {
        if (proto.output === 'brep') {
          const first = text.split('\n', 1)[0].trim();
          entry.status = first === 'ok' ? 'ok' : first.startsWith('unresolved') ? 'unresolved' : 'malformed';
          if (entry.status === 'unresolved') entry.reason = first.slice('unresolved'.length).trim();
          entry.verdict = entry.status === 'malformed' ? 'error' : entry.status === 'ok' ? 'info' : 'unresolved';
        } else if (proto.output === 'hybrid') {
          // exact: the B-rep's grade is judge-recover.mjs's; mesh: scored as
          // a mesh answer (mesh-pass, mesh-mismatch, ...); unresolved as usual.
          const h = decodeHybrid(text);
          entry.status = h.status;
          if (h.status === 'unresolved' || h.status === 'mesh') entry.reason = h.reason;
          if (h.status === 'exact') entry.verdict = 'exact';
          else if (h.status === 'unresolved') entry.verdict = verdictOf(entry.expect, 'unresolved', null, null);
          else {
            entry.deviationMm = h.deviationMm;
            if (opts.validate) {
              const v = validateResult(fs.readFileSync(job.job, 'utf8'), h.okText);
              entry.report = { ...v.report, tagArea: tagAreas(h.mesh) };
              const arb = arbiterFor(arbiter, c.id, job.sidecar.jobSha256);
              entry.comparison = compare(entry.report, reference?.cases?.[c.id]?.jobSha256 === job.sidecar.jobSha256 ? reference.cases[c.id] : null, arb);
              entry.tier = tier(entry.comparison);
              if (entry.report.issues.length > 10) entry.report.issues = entry.report.issues.slice(0, 10);
            }
            entry.verdict = `mesh-${verdictOf(entry.expect, 'ok', entry.report, entry.comparison)}`;
          }
          if (!entry.targetsAgree && (entry.verdict === 'exact' || entry.verdict === 'mesh-pass')) entry.verdict = 'mismatch';
        } else {
          const decoded = decodeResult(text);
          entry.status = decoded.status;
          if (decoded.status === 'unresolved') entry.reason = decoded.reason;
          if (decoded.status === 'ok' && opts.validate) {
            const v = validateResult(fs.readFileSync(job.job, 'utf8'), text);
            entry.report = { ...v.report, tagArea: tagAreas(decoded.mesh) };
            const arb = arbiterFor(arbiter, c.id, job.sidecar.jobSha256);
            entry.comparison = compare(entry.report, reference?.cases?.[c.id]?.jobSha256 === job.sidecar.jobSha256 ? reference.cases[c.id] : null, arb);
            entry.tier = tier(entry.comparison);
            if (entry.report.issues.length > 10) entry.report.issues = entry.report.issues.slice(0, 10);
          }
          entry.verdict = verdictOf(entry.expect, decoded.status, entry.report, entry.comparison);
          if (!entry.targetsAgree) entry.verdict = entry.verdict === 'pass' ? 'mismatch' : entry.verdict;
        }
      } catch (err) {
        entry.status = 'malformed';
        entry.verdict = 'error';
        entry.reason = `malformed result: ${err.message}`;
      }
    }
    rep.cases.push(entry);
    const tt = opts.targets.map((t) => {
      const r = entry.targets[t];
      return `${t} ${r?.outcome === 'ran' ? `${fmt(t === 'js' ? (r.timing.computeMs ?? r.timing.totalMs) : r.timing.computeMs)}ms` : r?.outcome}`;
    }).join('  ');
    console.log(`${c.id.padEnd(28)} ${String(entry.verdict).padEnd(16)} ${tt}${entry.targetsAgree ? '' : '  TARGETS DISAGREE'}`);
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(rep, null, 1) + '\n');
  }
  rep.loadavgEnd = os.loadavg();
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(rep, null, 1) + '\n');
  fs.writeFileSync(path.join(outDir, 'summary.md'), summaryMarkdown(rep));
  console.log(`wrote ${path.relative(ROOT, outDir)}/report.json and summary.md`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.stack ?? err.message);
    process.exit(1);
  });
}
