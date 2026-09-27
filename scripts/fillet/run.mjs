#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE: the runner (docs/fillet/harness.md).
//
//   node scripts/fillet/run.mjs --proto <name> [--cases a,b] [--group core|corpus|hard]
//     [--targets js,cpu1,cpuN,metal] [--repeat k] [--timeout s] [--threads N]
//     [--rebuild] [--no-validate] [--no-occt] [--no-step] [--step-gate|--no-step-gate] [--out <dir>] [--gpu <size>]
//
// Builds the prototype's native binaries when their sources changed, runs every
// selected job on every target with a per-case timeout, checks that the
// targets agree byte for byte, validates the result (scripts/fillet/validate.mjs),
// measures valid B-reps with OpenCascade (one uv batch), grades every result
// (scripts/fillet/grade.mjs: tight check with the prototype's claim,
// divergence volume against the closed forms on the job's geometry) and
// checks the valid results' STEP strictly (uv run scripts/validate-step.py,
// 4 at a time; --no-step skips it). It writes out/fillet/<proto>/report.json
// and summary.md. It computes no geometry.
//
// The STEP of a valid result comes from the prototype's writer
// (prototypes.mjs stepWriter): the production writer for A (src/exporters.mjs
// on the production types, docs/fillet-plan.md §8 step 1), else the harness
// writer (validate.mjs resultStep via scripts/bakeoff/recover-stepx.mjs, no
// pcurves). Strict STEP gates the verdict (`step-fail`, also for a
// production export refusal) for the production writer, or with --step-gate;
// --no-step-gate only reports it.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileBend } from '../../src/bend-loader.mjs';
import { bendSources, checkGpuMem, metalVariant } from '../bakeoff/run.mjs';
import { ROOT, loadCases } from './cases.mjs';
import { jobPath, readSidecar } from './fixtures.mjs';
import { prototype } from './prototypes.mjs';
import { DIV_REL, gradeResult } from './grade.mjs';
import { decodeResult } from './brepfmt.mjs';
import { divVolume } from './divvolume.mjs';
import { checkResult, compareMeasures, occtMeasure, resultStepFor } from './validate.mjs';
import { strictStep } from './verify-step.mjs';

const { version: BEND_VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, 'bend.lock.json'), 'utf8'));
const BEND = path.join(ROOT, `.tools/bend-${BEND_VERSION}/bin/bend`);
const ALL_TARGETS = ['js', 'cpu1', 'cpuN', 'metal'];
const PHASES = ['readMs', 'parseMs', 'computeMs', 'serializeMs', 'writeMs'];
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

function parseArgs(argv) {
  const o = { targets: ['js', 'cpu1'], repeat: 1, timeout: 120, threads: os.cpus().length, validate: true, occt: true, step: true, stepGate: null, rebuild: false, gpuMem: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--proto') o.proto = next();
    else if (a === '--cases') o.cases = next().split(',').filter(Boolean);
    else if (a === '--group') o.group = next();
    else if (a === '--targets') o.targets = next().split(',').filter(Boolean);
    else if (a === '--repeat') o.repeat = Math.max(1, Number(next()));
    else if (a === '--timeout') o.timeout = Number(next());
    else if (a === '--threads') o.threads = Number(next());
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '--gpu' || a === '--gpu-mem') o.gpuMem = checkGpuMem(next(), '--gpu');
    else if (a === '--rebuild') o.rebuild = true;
    else if (a === '--no-validate') o.validate = false;
    else if (a === '--no-occt') o.occt = false;
    else if (a === '--no-step') o.step = false;
    else if (a === '--step-gate') o.stepGate = true;
    else if (a === '--no-step-gate') o.stepGate = false;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  for (const t of o.targets) if (!ALL_TARGETS.includes(t)) throw new Error(`unknown target ${t}`);
  return o;
}

function command(exe, args, timeoutMs = 300000) {
  const start = performance.now();
  return new Promise((resolve) => {
    const c = spawn(exe, args, { cwd: ROOT, env: { ...process.env, BEND_NO_TELEMETRY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    c.stdout.on('data', (b) => { stdout += b; });
    c.stderr.on('data', (b) => { stderr += b; });
    const timer = setTimeout(() => { timedOut = true; c.kill('SIGKILL'); }, timeoutMs);
    c.on('error', (e) => { stderr += e.message; });
    c.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut, wallMs: performance.now() - start, stdout, stderr }); });
  });
}

// ---------------------------------------------------------------------------
// Builds (same scheme as scripts/bakeoff/run.mjs: key = Bend version + target
// + the native.bend import closure; Metal = marked call turned into `!`).

const METAL_PASS = 'static void gpu_pass(u32 f) {\n  @autoreleasepool {';
const METAL_DONE = '  io_sync();\n  return code;';

async function buildNative(proto, target, rebuild) {
  const dir = path.join(ROOT, 'out/fillet', proto.name, 'build');
  fs.mkdirSync(dir, { recursive: true });
  const binary = path.join(dir, target), keyFile = `${binary}.key`;
  const native = path.join(ROOT, proto.dir, 'native.bend');
  if (!fs.existsSync(native)) throw new Error(`${proto.dir}/native.bend is missing`);
  const h = crypto.createHash('sha256').update(`${BEND_VERSION}\n${target}\n`);
  for (const f of bendSources(native)) h.update(f).update(fs.readFileSync(path.join(ROOT, f)));
  const key = h.digest('hex');
  if (!rebuild && fs.existsSync(binary) && fs.existsSync(keyFile) && fs.readFileSync(keyFile, 'utf8') === key) return { binary, cached: true, ms: 0 };
  const t0 = performance.now(), logs = [];
  const step = async (exe, args, label) => {
    const r = await command(exe, args, 3600000);
    logs.push(`$ ${exe} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
    fs.writeFileSync(`${binary}.build.log`, logs.join('\n'));
    if (r.code !== 0) throw new Error(`${label} failed (code ${r.code}); see ${path.relative(ROOT, binary)}.build.log`);
  };
  if (target === 'cpu') {
    await step(BEND, [native, '-o', binary], 'bend native build');
  } else {
    const variant = path.join(ROOT, proto.dir, '.fillet-native-metal.bend');
    fs.writeFileSync(variant, metalVariant(fs.readFileSync(native, 'utf8')));
    const cfile = `${binary}.c`;
    try {
      await step(BEND, [variant, '-o', cfile], 'bend C emit');
    } finally {
      fs.rmSync(variant, { force: true });
    }
    let c = fs.readFileSync(cfile, 'utf8');
    if (!c.includes(METAL_PASS) || !c.includes(METAL_DONE)) throw new Error('pinned Metal runtime instrumentation anchors changed');
    c = c.replace(METAL_PASS, 'static unsigned long wonky_metal_passes = 0;\nstatic void gpu_pass(u32 f) {\n  wonky_metal_passes++;\n  @autoreleasepool {')
      .replace(METAL_DONE, '  io_sync();\n  fprintf(stderr, "wonky_metal_passes=%lu\\n", wonky_metal_passes);\n  return code;');
    fs.writeFileSync(cfile, c);
    await step('clang', ['-DBEND_METAL=1', '-x', 'objective-c', '-fobjc-arc', '-fmodules', '-std=c11', '-O3', cfile, '-lpthread', '-lm', '-o', binary], 'clang Metal build');
    await step(binary, ['--gpu-build'], 'Metal device build');
  }
  fs.writeFileSync(keyFile, key);
  return { binary, cached: false, ms: performance.now() - t0 };
}

async function runNative(binary, target, input, output, o) {
  const threads = target === 'cpu1' ? 1 : o.threads, gpu = target === 'metal' ? o.gpuMem : 'off';
  const samples = [];
  for (let i = 0; i < o.repeat; i++) {
    fs.rmSync(output, { force: true });
    const r = await command(binary, ['--threads', String(threads), '--gpu', gpu, '--', input, output], o.timeout * 1000);
    if (r.timedOut) return { outcome: 'timeout', wallMs: r.wallMs };
    if (r.code !== 0 || !fs.existsSync(output)) return { outcome: 'error', code: r.code, signal: r.signal, stderr: r.stderr.slice(-2000) };
    const line = r.stdout.split('\n').reverse().find((l) => l.trim().startsWith('{'));
    let t;
    try { t = JSON.parse(line); } catch { return { outcome: 'error', reason: 'no phase-timing JSON line on stdout' }; }
    const sum = PHASES.reduce((s, k) => s + (t[k] ?? 0), 0);
    const passes = /wonky_metal_passes=(\d+)/.exec(r.stderr);
    samples.push({ ...t, processWallMs: r.wallMs, startupMs: Math.max(0, r.wallMs - sum), metalPasses: passes ? Number(passes[1]) : null });
  }
  const timing = {};
  for (const k of [...PHASES, 'processWallMs', 'startupMs']) timing[k] = median(samples.map((s) => s[k]));
  const out = { outcome: 'ran', threads, gpu, timing, samples: samples.length };
  if (target === 'metal') out.metalEvidence = Math.min(...samples.map((s) => s.metalPasses ?? 0)) > 0;
  return out;
}

async function runJs(proto, input, output, o) {
  fs.rmSync(output, { force: true });
  const r = await command(process.execPath, ['--stack-size=65500', path.join(ROOT, 'scripts/bakeoff/js-worker.mjs'), path.join(ROOT, proto.dir, 'main.bend'), input, output, String(o.repeat)], o.timeout * 1000);
  if (r.timedOut) return { outcome: 'timeout', wallMs: r.wallMs };
  const line = r.stdout.split('\n').reverse().find((l) => l.trim().startsWith('{'));
  if (r.code !== 0 || !line || !fs.existsSync(output)) return { outcome: 'error', code: r.code, stderr: r.stderr.slice(-2000) };
  const t = JSON.parse(line);
  return { outcome: 'ran', timing: { loadMs: t.loadMs, coldMs: t.coldMs, ...t.warm, processWallMs: r.wallMs }, phased: t.phased, deterministic: t.deterministic };
}

// ---------------------------------------------------------------------------

const fmt = (x, d = 1) => (x === null || x === undefined ? '-' : typeof x === 'number' ? x.toFixed(d) : String(x));
const e1 = (x) => (x === null || x === undefined ? '-' : x.toExponential(1));

function summary(rep) {
  const L = [`# Fillet harness: ${rep.proto}`, ''];
  L.push(`${rep.capturedAt} · Bend ${rep.environment.bend} · ${rep.environment.cpu} · targets ${rep.targets.join(', ')} · repeat ${rep.repeat}`, '');
  const count = (xs) => Object.entries(xs.reduce((m, c) => ({ ...m, [c.verdict]: (m[c.verdict] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ');
  L.push(`Verdicts: ${count(rep.cases)}`, '');
  for (const g of ['core', 'corpus', 'hard']) {
    const cs = rep.cases.filter((c) => c.group === g);
    if (cs.length) L.push(`- ${g}: ${count(cs)}`);
  }
  L.push('');
  const ck = rep.checks;
  L.push(`Checks of the valid results (grade.mjs; claim ${rep.claim}; STEP writer ${rep.stepWriter}): tight ${ck.tight.ok} ok / ${ck.tight.fail} fail; divergence volume ${ck.div.ok} ok / ${ck.div.fail} fail / ${ck.div.unsupported} unsupported / ${ck.div.noReference} without reference${ck.div.jobFormErrors ? ` / ${ck.div.jobFormErrors} JOB-FORM ERRORS (harness)` : ''}, worst ${e1(ck.div.worstRel)} × V on the closed forms (tolerance ${ck.div.tolRel} × V); strict STEP ${ck.step.ok} ok / ${ck.step.fail} fail${ck.step.fail ? ` (${ck.step.failed.join(', ')})` : ''}${rep.stepGate ? ', gating' : ', reported (--step-gate gates it)'}.`, '');
  L.push(`| case | expect | verdict | refusal / issues | faces (blend types) | max spring angle rad | vol err vs closed form | vol err vs OCCT | OCCT oracle | Onshape oracle | vol err vs Onshape | div vol err | tight | strict STEP | ${rep.targets.map((t) => `${t} ms`).join(' | ')} |`);
  L.push(`|${'---|'.repeat(14 + rep.targets.length)}`);
  for (const c of rep.cases) {
    const r = c.report ?? {};
    const note = (c.status === 'unresolved' ? `${r.refusal?.class ?? ''}${r.refusal?.knownClass === false ? ' (unknown class)' : ''}` : (r.issues?.[0] ?? c.checks?.tight?.issues?.[0] ?? '').slice(0, 60)).replace(/\|/g, '/');
    const dv = c.checks?.div, divTxt = !dv ? '-' : dv.status !== 'ok' ? dv.status : `${e1(Math.min(...(dv.forms ? Object.values(dv.forms).filter((x) => x.used).map((x) => x.absErr) : [dv.absErr])))}${dv.ok ? '' : ' FAIL'}`;
    const tightTxt = c.checks?.tight?.status === 'ok' ? (c.checks.tight.ok ? 'ok' : 'FAIL') : '-';
    const stepTxt = c.stepStrict ? (c.stepStrict.ok ? 'ok' : 'FAIL') : '-';
    const faces = r.topology ? `${r.topology.faces} (${(r.surfaces?.exactBlendTypes ?? []).join('+')})` : '-';
    const cf = r.comparison?.closedForm ? Math.min(...Object.values(r.comparison.closedForm).map((v) => v.absErr)) : null;
    const times = rep.targets.map((t) => {
      const x = c.targets[t];
      if (!x) return '-';
      if (x.outcome !== 'ran') return x.outcome;
      if (!x.timing) return x.replayed ? 'replay' : '-';
      return fmt(t === 'js' ? (x.timing.computeMs ?? x.timing.totalMs) : x.timing.computeMs, t === 'js' ? 3 : 0);
    });
    const on = r.comparison?.onshape;
    const onErr = on ? `${e1(on.absErr)}${on.ok ? '' : on.inRange ? ' (in range)' : ' (out of range)'}` : '-';
    L.push(`| ${c.id} | ${c.expect} | ${c.verdict} | ${note} | ${faces} | ${e1(r.tangency?.maxSpringAngleRad)} | ${e1(cf)} | ${e1(r.comparison?.occt?.volumeAbsErr)} | ${c.oracle} | ${c.onshape ?? '-'} | ${onErr} | ${divTxt} | ${tightTxt} | ${stepTxt} | ${times.join(' | ')} |`);
  }
  L.push('', 'Verdicts (docs/fillet/harness.md): pass / pass-approx (valid, volume matches the closed form (the forms the Onshape probe agrees with, where one exists) or, without one, the Onshape value or bounds, else OCCT volume and area), expected-refusal (typed refusal where expect is must-refuse or either), declined (refusal where expect is ok), wrong (a result where the case must refuse), invalid, no-op, mismatch (also: targets disagree), unverified (valid, nothing to compare with), unmeasured, error, timeout; after a pass (grade.mjs): tight-fail (tightcheck.mjs), div-mismatch (divergence volume off the reference), step-fail (strict STEP, with --step-gate).');
  return L.join('\n') + '\n';
}

// Strict STEP of the valid results (verify-step.mjs strictStep, 4 at a time):
// the expected volume is the matching closed form on the job's geometry, else
// Onshape's value where it matches, else a valid OCCT oracle's that matches,
// else the result's own divergence volume (exact, independent of OCCT and
// STEP: then the check is that the STEP carries the same solid). Never an
// oracle volume the result does not match (FP08: Onshape only in range, OCCT's
// blend invalid).
async function strictSteps(pending) {
  const one = async (p) => {
    const cmp = p.report.comparison ?? {};
    const cf = cmp.closedForm ? Object.values(cmp.closedForm).find((v) => v.ok) : null;
    const occt = cmp.occt?.occtValid && cmp.occt.volumeOk ? cmp.occt.volume : null;
    const expected = cf?.expected ?? (cmp.onshape?.ok ? cmp.onshape.expected : null) ?? occt ?? divVolume(decodeResult(p.entry._texts.resultText).body).volume ?? null;
    p.entry.stepStrict = await strictStep(p.step.replace(/\.step$/, ''), p.body, expected);
  };
  for (let i = 0; i < pending.length; i += 4) await Promise.all(pending.slice(i, i + 4).map(one));
}

function checkCounts(cases) {
  const out = { tight: { ok: 0, fail: 0 }, div: { ok: 0, fail: 0, unsupported: 0, noReference: 0, jobFormErrors: 0, worstRel: 0, tolRel: DIV_REL }, step: { ok: 0, fail: 0, failed: [] } };
  for (const c of cases) {
    const t = c.checks?.tight, d = c.checks?.div;
    if (t?.status === 'ok') out.tight[t.ok ? 'ok' : 'fail']++;
    if (d) {
      if (d.status === 'ok') {
        out.div[d.ok ? 'ok' : 'fail']++;
        if (d.forms) out.div.worstRel = Math.max(out.div.worstRel, Math.min(...Object.values(d.forms).filter((x) => x.used).map((x) => x.absErr)) / Math.max(1, Math.abs(d.inputVolume)));
      } else if (d.status === 'unsupported') out.div.unsupported++;
      else if (d.status === 'no-reference') out.div.noReference++;
      else if (d.status === 'job-form-error') out.div.jobFormErrors++;
    }
    if (c.stepStrict) { out.step[c.stepStrict.ok ? 'ok' : 'fail']++; if (!c.stepStrict.ok) out.step.failed.push(c.id); }
  }
  return out;
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help || !o.proto) {
    console.log('usage: node scripts/fillet/run.mjs --proto <name> [--cases a,b] [--group g] [--targets js,cpu1,cpuN,metal] [--repeat k] [--timeout s] [--threads N] [--rebuild] [--no-validate] [--no-occt] [--no-step] [--step-gate|--no-step-gate] [--out dir] [--gpu size]');
    process.exit(o.help ? 0 : 2);
  }
  const proto = prototype(o.proto);
  o.gpuMem ??= proto.gpu;
  o.stepGate ??= proto.stepWriter === 'production';
  const all = loadCases();
  const cases = o.cases ? o.cases.map((id) => all.find((c) => c.id === id) ?? (() => { throw new Error(`unknown case ${id}`); })()) : all.filter((c) => !o.group || c.group === o.group);
  const reference = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/fillet/reference.json'), 'utf8'));
  const outDir = o.out ?? path.join(ROOT, 'out/fillet', proto.name);
  const resDir = path.join(outDir, 'results'), stepDir = path.join(outDir, 'step');
  fs.mkdirSync(resDir, { recursive: true });
  const targets = proto.results ? ['cpu1'] : o.targets;
  const rep = {
    schema: 'wonky-fillet-report/1', proto: proto.name, description: proto.description, claim: proto.claim, stepWriter: proto.stepWriter, capturedAt: new Date().toISOString(),
    targets, repeat: o.repeat, timeoutS: o.timeout, gpuMem: o.gpuMem, stepGate: o.stepGate, loadavgStart: os.loadavg(),
    environment: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, threadsN: o.threads, platform: `${os.platform()} ${os.release()}`, node: process.version, bend: BEND_VERSION },
    builds: {}, cases: [],
  };
  const bins = {};
  if (!proto.results) {
    for (const [target, wanted] of [['cpu', targets.some((t) => t === 'cpu1' || t === 'cpuN')], ['metal', targets.includes('metal')]]) {
      if (!wanted) continue;
      if (target === 'metal' && os.platform() !== 'darwin') { rep.builds.metal = { error: 'Metal builds need macOS' }; continue; }
      process.stdout.write(`build ${target} … `);
      try {
        const b = await buildNative(proto, target, o.rebuild);
        bins[target] = b.binary;
        rep.builds[target] = { cached: b.cached, ms: b.ms };
        console.log(b.cached ? 'cached' : `${(b.ms / 1000).toFixed(1)} s`);
      } catch (err) {
        rep.builds[target] = { error: err.message };
        console.log(`FAILED: ${err.message}`);
      }
    }
    if (targets.includes('js')) {
      const t0 = performance.now();
      try { rep.builds.js = { cached: (await compileBend(path.join(ROOT, proto.dir, 'main.bend'))).cacheHit, ms: performance.now() - t0 }; } catch (err) { rep.builds.js = { error: err.message }; }
    }
  }
  const pending = [];
  for (const c of cases) {
    const job = jobPath(c.id), side = readSidecar(c.id);
    const entry = { id: c.id, group: c.group, rank: c.rank, expect: c.expect, targets: {} };
    const ref = reference.cases[c.id];
    entry.oracle = ref ? (ref.status === 'done' ? (ref.result.valid ? 'done' : 'done-invalid') : ref.status) : 'none';
    const onshape = reference.onshape?.cases?.[c.id] ?? null;
    if (onshape) entry.onshape = onshape.verdict === 'built' ? `${onshape.code} built` : `${onshape.code} ${onshape.verdict} ${onshape.error ?? ''}`.trim();
    if (!fs.existsSync(job) || !side || sha256(fs.readFileSync(job, 'utf8')) !== side.jobSha256) {
      entry.verdict = 'error';
      entry.reason = 'job missing or stale: run node scripts/fillet/fixtures.mjs';
      rep.cases.push(entry);
      continue;
    }
    if (ref && ref.jobSha256 !== side.jobSha256) entry.oracle = 'stale';
    const outputs = {};
    for (const t of targets) {
      const output = path.join(resDir, `${c.id}.${t}.result`);
      let r;
      if (proto.results) {
        const src = path.join(ROOT, proto.results, `${c.id}.cpu1.result`);
        r = fs.existsSync(src) ? { outcome: 'ran', replayed: path.relative(ROOT, src) } : { outcome: 'no-source', reason: 'no replayed result (the source did not produce one)' };
        if (r.outcome === 'ran') fs.copyFileSync(src, output);
      } else if (t === 'js') r = rep.builds.js?.error ? { outcome: 'error', reason: 'js build failed' } : await runJs(proto, job, output, o);
      else {
        const bin = bins[t === 'metal' ? 'metal' : 'cpu'];
        r = bin ? await runNative(bin, t, job, output, o) : { outcome: 'error', reason: `${t} build failed` };
      }
      if (r.outcome === 'ran') {
        outputs[t] = fs.readFileSync(output, 'utf8');
        r.resultSha256 = sha256(outputs[t]);
      }
      entry.targets[t] = r;
    }
    const texts = Object.entries(outputs);
    // Every selected target must have produced the same text: a target that
    // errored or timed out while another ran is a disagreement, not a skip
    // (as run-adversarial.mjs counts it).
    entry.targetsAgree = texts.length === targets.length && texts.every(([, x]) => x === texts[0]?.[1]);
    if (!texts.length) {
      const outs = Object.values(entry.targets).map((r) => r.outcome);
      entry.verdict = outs.includes('timeout') ? 'timeout' : outs.every((x) => x === 'no-source') ? 'no-source' : 'error';
    } else {
      const [first, text] = texts[0];
      entry.scoredTarget = first;
      const jobText = fs.readFileSync(job, 'utf8');
      const report = checkResult(jobText, text, c);
      entry.status = report.status;
      Object.defineProperty(entry, '_texts', { value: { jobText, resultText: text }, enumerable: false });
      if (report.status === 'ok' && report.valid && o.validate && o.occt) {
        fs.mkdirSync(stepDir, { recursive: true });
        const step = path.join(stepDir, `${c.id}.step`);
        const written = await resultStepFor(proto.stepWriter, report.body, text, c.id);
        if (written.ok) {
          fs.writeFileSync(step, written.step);
          pending.push({ entry, step, report, body: written.body, jobText, spec: { ...c, onshape, _approxTolMm: Math.max(0, ...report.surfaces.approximated.map((a) => a.tolMm)) }, side, ref });
        } else {
          fs.rmSync(step, { force: true });
          report.comparison = { error: written.error };
          entry.stepStrict = { ok: false, exportRefused: true, error: written.error };
        }
      }
      delete report.body;
      entry.report = report;
    }
    rep.cases.push(entry);
  }
  if (pending.length) {
    process.stdout.write(`OCCT measure of ${pending.length} result(s) … `);
    try {
      const ms = await occtMeasure(pending.map((p) => p.step));
      pending.forEach((p, i) => { p.report.comparison = ms[i].error ? { error: ms[i].error } : compareMeasures(ms[i], p.spec, p.side, p.ref, p.jobText); });
      console.log('done');
    } catch (err) {
      pending.forEach((p) => { p.report.comparison = { error: err.message }; });
      console.log(`FAILED: ${err.message}`);
    }
    if (o.step) {
      process.stdout.write(`strict STEP of ${pending.length} result(s) … `);
      await strictSteps(pending);
      console.log('done');
    }
  }
  for (const e of rep.cases) {
    if (e.verdict) continue;
    const spec = cases.find((c) => c.id === e.id);
    const g = gradeResult({ spec, onshape: reference.onshape?.cases?.[e.id] ?? null, ref: reference.cases[e.id], ...e._texts, report: e.report,
      claim: proto.claim, stepStrict: e.stepStrict ?? null, stepGate: o.stepGate, targetsAgree: e.targetsAgree, targetMismatch: 'mismatch' });
    e.verdict = g.verdict;
    e.checks = g.checks;
    const t = targets.map((x) => `${x} ${e.targets[x]?.outcome ?? '-'}`).join(' ');
    const why = e.verdict !== g.base ? `  (${g.base} -> ${e.verdict}: ${(e.verdict === 'tight-fail' ? g.checks.tight.issues[0] : e.verdict === 'div-mismatch' ? JSON.stringify(g.checks.div.forms ?? g.checks.div.absErr) : e.stepStrict?.error ?? '').slice(0, 160)})` : '';
    console.log(`${e.id.padEnd(44)} ${String(e.verdict).padEnd(17)} ${t}${e.targetsAgree ? '' : '  TARGETS DISAGREE'}${why}`);
  }
  rep.checks = checkCounts(rep.cases);
  rep.loadavgEnd = os.loadavg();
  rep.counts = rep.cases.reduce((m, c) => ({ ...m, [c.verdict]: (m[c.verdict] ?? 0) + 1 }), {});
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(rep, null, 1) + '\n');
  fs.writeFileSync(path.join(outDir, 'summary.md'), summary(rep));
  console.log(`verdicts ${JSON.stringify(rep.counts)}\nwrote ${path.relative(ROOT, outDir)}/report.json and summary.md`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.stack ?? err.message);
    process.exit(1);
  });
}
