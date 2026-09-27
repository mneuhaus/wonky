#!/usr/bin/env node
// Fillet harness TEST INFRASTRUCTURE (verify:fillet-kpart, 24 September 2026):
// runs a prototype on an extra case catalogue in the cases.json format (e.g.
// fixtures/fillet/adversarial-fillet-kpart.json) without touching the main
// catalogue, its jobs or reference.json. It computes no geometry.
//
//   node scripts/fillet/run-adversarial.mjs --file <cases.json> --proto fillet-<name>
//     [--targets js,cpu1,cpuN,metal] [--out <dir>] [--cases a,b] [--timeout s] [--threads N] [--gpu size]
//     [--no-occt] [--no-step]
//
// 1. builds each input with the wonky kernel (fixtures.mjs generateCase) into
//    <out>/jobs (job, sidecar, input STEP);
// 2. runs the prototype on every target with the binaries the main runner
//    built (out/fillet/<proto>/build; their key must match the sources:
//    run scripts/fillet/run.mjs once first);
// 3. validates (validate.mjs: checkResult, OCCT measure, compareMeasures),
//    adds the OCCT oracle (adversarial_oracle.py) and, for valid results
//    written by the prototype's STEP writer (prototypes.mjs stepWriter: the
//    production writer for A; a production export refusal is `step-fail`), the
//    STEP acceptance check `uv run scripts/validate-step.py` against the
//    closed-form volume, and grades (grade.mjs: verdictOf, the tight check
//    with the prototype's claim, the divergence volume; a strict STEP failure
//    is `step-fail` unless --no-step);
// 4. writes <out>/report.json and <out>/summary.md.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bendSources } from '../bakeoff/run.mjs';
import { compileBend } from '../../src/bend-loader.mjs';
import { generateCase } from './fixtures.mjs';
import { prototype } from './prototypes.mjs';
import { decodeJob } from './brepfmt.mjs';
import { closedFormVariants } from './closedform.mjs';
import { gradeResult } from './grade.mjs';
import { checkResult, compareMeasures, occtMeasure, resultStep, resultStepFor } from './validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { version: BEND_VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, 'bend.lock.json'), 'utf8'));
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');

function command(exe, args, timeoutMs) {
  const start = performance.now();
  return new Promise((resolve) => {
    // own process group, so a timeout also kills the children of `uv run`
    const c = spawn(exe, args, { cwd: ROOT, detached: true, env: { ...process.env, BEND_NO_TELEMETRY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    c.stdout.on('data', (b) => { stdout += b; });
    c.stderr.on('data', (b) => { stderr += b; });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-c.pid, 'SIGKILL'); } catch { c.kill('SIGKILL'); } }, timeoutMs);
    c.on('error', (e) => { stderr += e.message; });
    c.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, timedOut, wallMs: performance.now() - start, stdout, stderr }); });
  });
}

// ---------------------------------------------------------------------------
// input.language 'job-prism': a straight prism written directly in the job
// format (no kernel build), for inputs the kernel's builder refuses by design
// (coordinates beyond its ±10 000 mm envelope, features below its F32 sketch
// tolerance). input = {polygon: [[x, y], ...] CCW, height, origin?: [x, y, z],
// shear?: [sx, sy]}: with a shear the top polygon is the bottom one moved by
// (sx, sy, height), an oblique prism whose lateral edges meet the polygon
// edges at oblique angles (the volume stays area × height).
// The body is exact in float64 before the job's F32x2 encoding.

const unit3 = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
export function prismBody(poly, h, o = [0, 0, 0], shear = [0, 0]) {
  const n = poly.length, L = [shear[0], shear[1], h];
  const V = [...poly.map(([x, y]) => [x + o[0], y + o[1], o[2]]), ...poly.map(([x, y]) => [x + o[0] + L[0], y + o[1] + L[1], o[2] + h])];
  const line = (a, b) => ({ start: a, end: b, curve: { type: 'line', origin: V[a], direction: unit3([0, 1, 2].map((k) => V[b][k] - V[a][k])) }, sameSense: true,
    curveRange: [0, Math.hypot(...[0, 1, 2].map((k) => V[b][k] - V[a][k]))] });
  const edges = [];
  for (let i = 0; i < n; i++) edges.push(line(i, (i + 1) % n));
  for (let i = 0; i < n; i++) edges.push(line(n + i, n + ((i + 1) % n)));
  for (let i = 0; i < n; i++) edges.push(line(i, n + i));
  const plane = (origin, normal, x) => ({ type: 'plane', origin, normal, x });
  const faces = [
    { surface: plane(V[0], [0, 0, -1], [1, 0, 0]), sameSense: true, loops: [Array.from({ length: n }, (_, k) => ({ edge: n - 1 - k, forward: false }))], outer: [true] },
    { surface: plane(V[n], [0, 0, 1], [1, 0, 0]), sameSense: true, loops: [Array.from({ length: n }, (_, k) => ({ edge: n + k, forward: true }))], outer: [true] },
  ];
  for (let i = 0; i < n; i++) {
    const d = edges[i].curve.direction;
    faces.push({ surface: plane(V[i], unit3([d[1] * L[2] - d[2] * L[1], d[2] * L[0] - d[0] * L[2], d[0] * L[1] - d[1] * L[0]]), d), sameSense: true, outer: [true],
      loops: [[{ edge: i, forward: true }, { edge: 2 * n + ((i + 1) % n), forward: true }, { edge: n + i, forward: false }, { edge: 2 * n + i, forward: false }]] });
  }
  let A = 0;
  for (let i = 0; i < n; i++) A += poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1];
  return { body: { vertices: V, edges, faces }, volume: (A / 2) * h };
}

async function generateJobPrism(c) {
  const { encodeJob, encodeBrep, quantizationError } = await import('./brepfmt.mjs');
  const { resolveSelection } = await import('./fixtures.mjs');
  const { curvePoint, edgeConvexity, edgeInterval, edgeLength, edgeUses } = await import('./geom.mjs');
  const { body, volume } = prismBody(c.input.polygon, c.input.height, c.input.origin, c.input.shear);
  // the input itself must be a closed, consistent B-rep (validator topology + geometry)
  const self = checkResult(encodeJob({ id: c.id, op: 'chamfer', size: c.size, chamferType: c.chamferType, tangentPropagation: c.tangentPropagation, body, select: [] }),
    ['ok', ...encodeBrep({ ...body, faces: body.faces.map((f) => ({ ...f, role: 'blend' })) }, { result: true }), 'end', ''].join('\n'));
  if (self.status !== 'ok' || self.issues.length) throw new Error(`job-prism input invalid: ${self.issues.slice(0, 3).join('; ')}`);
  const select = resolveSelection(body, c.select), uses = edgeUses(body);
  const job = encodeJob({ id: c.id, op: c.op, size: c.size, chamferType: c.chamferType, tangentPropagation: c.tangentPropagation, body, select });
  const selected = select.map((i) => {
    const e = body.edges[i], cx = edgeConvexity(body, i, uses), { t0, t1 } = edgeInterval(e, body.vertices);
    return { edge: i, curve: e.curve.type, faces: uses[i].map((u) => body.faces[u.face].surface.type), convexity: cx.convexity, dihedralDeg: cx.dihedralDeg, length: edgeLength(e, body.vertices), sample: curvePoint(e.curve, (t0 + t1) / 2) };
  });
  const unexpected = [...new Set(selected.map((e) => e.convexity))].filter((x) => !c.convexity.includes(x));
  if (unexpected.length) throw new Error(`${c.id}: selected edges are ${unexpected.join('/')}, case states ${c.convexity.join('/')}`);
  const sidecar = { id: c.id, jobSha256: sha256(job), jobBytes: job.length, input: 'job-prism (runner-built, not the kernel)', kernel: { closed: true, volumeMm3: volume, areaMm2: null, precision: 'float64 prism', geometry: 'planar' },
    counts: { vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length }, quantizationErrorMm: quantizationError(body), selected };
  return { job, sidecar, step: resultStep(body, c.id) };
}

// generateCase without the kernel's STEP exporter (which can refuse a valid
// input, e.g. cylinder parameter curves far from the origin: ResolutionLimit);
// the oracle's input STEP is then written by validate.mjs resultStep.
async function generateCaseNoKernelStep(c) {
  const { build } = await import('../../src/index.mjs');
  const { encodeJob, quantizationError } = await import('./brepfmt.mjs');
  const { resolveSelection } = await import('./fixtures.mjs');
  const { curvePoint, edgeConvexity, edgeInterval, edgeLength, edgeUses, normaliseBody } = await import('./geom.mjs');
  const model = await build(c.input.source, { feature: 'filletInput', trace: false });
  if (model.bodies.length !== 1) throw new Error(`${c.id}: ${model.bodies.length} bodies`);
  const raw = model.bodies[0], body = normaliseBody(raw), select = resolveSelection(body, c.select), uses = edgeUses(body);
  const job = encodeJob({ id: c.id, op: c.op, size: c.size, chamferType: c.chamferType, tangentPropagation: c.tangentPropagation, body, select });
  const selected = select.map((i) => {
    const e = body.edges[i], cx = edgeConvexity(body, i, uses), { t0, t1 } = edgeInterval(e, body.vertices);
    return { edge: i, curve: e.curve.type, faces: uses[i].map((u) => body.faces[u.face].surface.type), convexity: cx.convexity, dihedralDeg: cx.dihedralDeg, length: edgeLength(e, body.vertices), sample: curvePoint(e.curve, (t0 + t1) / 2) };
  });
  const v = raw.validation ?? {};
  const sidecar = { id: c.id, jobSha256: sha256(job), jobBytes: job.length, input: 'kernel build; input STEP by resultStep (kernel STEP export refused)',
    kernel: { closed: v.closed ?? null, volumeMm3: v.volumeMm3 ?? null, areaMm2: v.areaMm2 ?? null, precision: raw.precision, geometry: raw.geometry ?? 'planar' },
    counts: { vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length }, quantizationErrorMm: quantizationError(body), selected };
  return { job, sidecar, step: resultStep(body, c.id) };
}

function binary(proto, target) {
  const bin = path.join(ROOT, 'out/fillet', proto.name, 'build', target);
  const h = crypto.createHash('sha256').update(`${BEND_VERSION}\n${target}\n`);
  for (const f of bendSources(path.join(proto.dir, 'native.bend'))) h.update(f).update(fs.readFileSync(path.join(ROOT, f)));
  const key = h.digest('hex');
  if (!fs.existsSync(bin) || !fs.existsSync(`${bin}.key`) || fs.readFileSync(`${bin}.key`, 'utf8') !== key) {
    throw new Error(`${path.relative(ROOT, bin)} is missing or stale: run node scripts/fillet/run.mjs --proto ${proto.name} --targets cpu1,metal first`);
  }
  return bin;
}

async function main(argv) {
  const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const file = path.resolve(opt('--file'));
  const proto = prototype(opt('--proto'));
  const targets = opt('--targets', 'js,cpu1').split(',');
  const outDir = path.resolve(opt('--out', path.join(ROOT, 'out/fillet/adversarial', proto.name)));
  const only = opt('--cases') ? opt('--cases').split(',') : null;
  const timeout = Number(opt('--timeout', 120)) * 1000, threads = Number(opt('--threads', os.cpus().length)), gpu = opt('--gpu', proto.gpu);
  const occt = !argv.includes('--no-occt'), stepCheck = !argv.includes('--no-step');
  const cases = JSON.parse(fs.readFileSync(file, 'utf8')).cases.filter((c) => !only || only.includes(c.id));
  const jobsDir = path.join(outDir, 'jobs'), inStepDir = path.join(outDir, 'input-step'), resDir = path.join(outDir, 'results'), stepDir = path.join(outDir, 'step');
  for (const d of [jobsDir, inStepDir, resDir, stepDir]) fs.mkdirSync(d, { recursive: true });
  const bins = {};
  if (targets.some((t) => t === 'cpu1' || t === 'cpuN')) bins.cpu = binary(proto, 'cpu');
  if (targets.includes('metal')) bins.metal = binary(proto, 'metal');
  // the JS worker runs with --stack-size, which a compiler worker refuses: compile (or hit the cache) here first, as run.mjs does
  if (targets.includes('js')) await compileBend(path.join(ROOT, proto.dir, 'main.bend'));
  const rep = { schema: 'wonky-fillet-adversarial-report/1', proto: proto.name, claim: proto.claim, stepWriter: proto.stepWriter, catalogue: path.relative(ROOT, file), capturedAt: new Date().toISOString(), targets, loadavgStart: os.loadavg(), cases: [] };

  // 1. inputs
  const built = {};
  for (const c of cases) {
    try {
      const { job, sidecar, step } = c.input.language === 'job-prism' ? await generateJobPrism(c)
        : await generateCase(c).catch((err) => { if (/STEP/.test(err.message)) { console.log(`input ${c.id}: kernel STEP export refused (${err.message.slice(0, 80)}); input STEP via resultStep`); return generateCaseNoKernelStep(c); } throw err; });
      sidecar.step = path.relative(ROOT, path.join(inStepDir, `${c.id}.step`));
      fs.writeFileSync(path.join(jobsDir, `${c.id}.job`), job);
      fs.writeFileSync(path.join(jobsDir, `${c.id}.json`), JSON.stringify(sidecar, null, 1) + '\n');
      fs.writeFileSync(path.join(ROOT, sidecar.step), step);
      built[c.id] = { job, sidecar };
      console.log(`input ${c.id.padEnd(50)} ${sidecar.counts.faces}f ${sidecar.selected.length} edges vol ${sidecar.kernel.volumeMm3} q ${sidecar.quantizationErrorMm?.toExponential?.(1)}`);
    } catch (err) {
      console.log(`input ${c.id.padEnd(50)} FAILED ${err.message.slice(0, 200)}`);
      rep.cases.push({ id: c.id, expect: c.expect, verdict: 'input-error', reason: err.message.slice(0, 400) });
    }
  }
  // OCCT oracle on the inputs (never writes reference.json)
  // one process per case with a timeout: OCCT can hang on degenerate inputs
  const oracle = {};
  if (occt) {
    const ids = Object.keys(built);
    const one = async (id) => {
      const r = await command('uv', ['run', '--quiet', 'scripts/fillet/adversarial_oracle.py', file, jobsDir, '--cases', id], 90000);
      if (r.timedOut) { oracle[id] = { status: 'timeout' }; return; }
      try { Object.assign(oracle, JSON.parse(r.stdout.trim().split('\n').pop())); } catch { oracle[id] = { status: 'error', error: r.stderr.slice(-300) }; }
    };
    for (let i = 0; i < ids.length; i += 4) await Promise.all(ids.slice(i, i + 4).map(one));
    console.log(`OCCT oracle: ${Object.entries(oracle).map(([k, v]) => `${k}=${v.status}`).join(' ')}`);
  }
  // 2. runs
  const pending = [];
  for (const c of cases) {
    if (!built[c.id]) continue;
    const jobFile = path.join(jobsDir, `${c.id}.job`), { job, sidecar } = built[c.id];
    const entry = { id: c.id, expect: c.expect, targets: {}, inputCounts: sidecar.counts, inputVolume: sidecar.kernel.volumeMm3, quantizationErrorMm: sidecar.quantizationErrorMm, selected: sidecar.selected.length };
    const ref = oracle[c.id];
    entry.oracle = ref ? (ref.status === 'done' ? (ref.result.valid ? 'done' : 'done-invalid') : ref.status) : 'none';
    const outputs = {};
    for (const t of targets) {
      const output = path.join(resDir, `${c.id}.${t}.result`);
      fs.rmSync(output, { force: true });
      let r;
      if (t === 'js') r = await command(process.execPath, ['--stack-size=65500', path.join(ROOT, 'scripts/bakeoff/js-worker.mjs'), path.join(ROOT, proto.dir, 'main.bend'), jobFile, output, '1'], timeout);
      else r = await command(bins[t === 'metal' ? 'metal' : 'cpu'], ['--threads', String(t === 'cpu1' ? 1 : threads), '--gpu', t === 'metal' ? gpu : 'off', '--', jobFile, output], timeout);
      const ran = !r.timedOut && r.code === 0 && fs.existsSync(output);
      entry.targets[t] = ran ? { outcome: 'ran', wallMs: Math.round(r.wallMs) } : { outcome: r.timedOut ? 'timeout' : 'error', code: r.code, signal: r.signal, stderr: r.stderr.slice(-600) };
      if (ran) outputs[t] = fs.readFileSync(output, 'utf8');
    }
    const texts = Object.values(outputs);
    entry.targetsAgree = texts.length === targets.length && texts.every((x) => x === texts[0]);
    entry.resultSha256 = Object.fromEntries(Object.entries(outputs).map(([t, x]) => [t, sha256(x).slice(0, 12)]));
    if (!texts.length) { entry.verdict = Object.values(entry.targets).some((x) => x.outcome === 'timeout') ? 'timeout' : 'error'; rep.cases.push(entry); continue; }
    const text = outputs.cpu1 ?? texts[0];
    const report = checkResult(job, text, c);
    entry.status = report.status;
    Object.defineProperty(entry, '_texts', { value: { jobText: job, resultText: text }, enumerable: false });
    if (report.status === 'ok' && report.valid && occt) {
      const step = path.join(stepDir, `${c.id}.step`);
      // the prototype's writer (prototypes.mjs stepWriter; the production writer for A)
      const written = await resultStepFor(proto.stepWriter, report.body, text, c.id);
      if (written.ok) {
        fs.writeFileSync(step, written.step);
        // validate-step.py sidecar: the result B-rep with the closed-form volume (on the job's geometry where the case states a job form)
        const V0 = sidecar.kernel.volumeMm3, cfV = c.closedForm ? V0 + closedFormVariants(c.closedForm, decodeJob(job)).primary.value : null;
        fs.writeFileSync(path.join(stepDir, `${c.id}.brep.json`), JSON.stringify({ bodies: [{ vertices: written.body.vertices, edges: written.body.edges, faces: written.body.faces, validation: { volumeMm3: cfV } }] }));
        pending.push({ entry, step, report, spec: { ...c, onshape: null, _approxTolMm: Math.max(0, ...report.surfaces.approximated.map((a) => a.tolMm)) }, sidecar, ref });
      } else {
        fs.rmSync(step, { force: true });
        report.comparison = { error: written.error };
        if (stepCheck) entry.validateStep = { ok: false, exportRefused: true, error: written.error };
      }
    }
    delete report.body;
    entry.report = report;
    rep.cases.push(entry);
  }
  if (pending.length) {
    try {
      const ms = await occtMeasure(pending.map((p) => p.step));
      pending.forEach((p, i) => { p.report.comparison = ms[i].error ? { error: ms[i].error } : compareMeasures(ms[i], p.spec, p.sidecar, p.ref, p.entry._texts.jobText); });
    } catch (err) {
      pending.forEach((p) => { p.report.comparison = { error: err.message }; });
    }
    if (stepCheck) {
      for (const p of pending) {
        const prefix = p.step.replace(/\.step$/, '');
        const r = await command('uv', ['run', '--quiet', 'scripts/validate-step.py', path.relative(ROOT, prefix)], 600000);
        p.entry.validateStep = r.code === 0 ? { ok: true, ...(JSON.parse(r.stdout)[0] ?? {}) } : { ok: false, error: (r.stderr.trim().split('\n').pop() ?? '').slice(0, 400) };
      }
    }
  }
  for (const e of rep.cases) {
    if (e.verdict) continue;
    const spec = cases.find((c) => c.id === e.id);
    const g = gradeResult({ spec, onshape: null, ref: oracle[e.id] ?? null, ...e._texts, report: e.report, claim: proto.claim,
      stepStrict: e.validateStep ?? null, stepGate: true, targetsAgree: e.targetsAgree, targetMismatch: 'mismatch-targets' });
    e.verdict = g.verdict;
    e.tight = g.checks.tight;
    e.div = g.checks.div;
    const r = e.report ?? {}, cmp = r.comparison ?? {};
    const note = e.status === 'unresolved' ? `${r.refusal?.class} ${r.refusal?.reason ?? ''}`.slice(0, 110) : (r.issues?.[0] ?? e.tight?.issues?.[0] ?? '').slice(0, 110);
    const cfErr = cmp.closedForm?.primary?.absErr;
    console.log(`${e.id.padEnd(50)} ${String(e.verdict).padEnd(17)} ${e.targetsAgree ? 'agree' : 'DISAGREE'} ${cfErr !== undefined ? 'cf ' + cfErr.toExponential(1) : ''} ${e.validateStep ? (e.validateStep.ok ? 'step ok' : 'STEP ' + e.validateStep.error.slice(0, 80)) : ''} ${note}`);
  }
  rep.counts = rep.cases.reduce((m, c) => ({ ...m, [c.verdict]: (m[c.verdict] ?? 0) + 1 }), {});
  rep.loadavgEnd = os.loadavg();
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(rep, null, 1) + '\n');
  const L = [`# Adversarial run: ${proto.name} on ${rep.catalogue}`, '', `${rep.capturedAt} · targets ${targets.join(', ')}`, '', `Verdicts: ${Object.entries(rep.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`, '',
    `Claim ${proto.claim} (tightcheck.mjs); div = divergence volume (grade.mjs) against the closed form on the job's geometry, else the OCCT oracle.`, '',
    '| case | expect | verdict | targets agree | refusal / first issue | faces | vol err vs closed form | vol err vs OCCT | div vol err | OCCT oracle | tight | validate-step |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const e of rep.cases) {
    const r = e.report ?? {}, cmp = r.comparison ?? {};
    const note = e.status === 'unresolved' ? `${r.refusal?.class}: ${(r.refusal?.reason ?? '').slice(0, 90)}` : (r.issues?.[0] ?? e.reason ?? '').slice(0, 90);
    const cfErr = cmp.closedForm ? Math.min(...Object.values(cmp.closedForm).map((v) => v.absErr)) : null;
    const dv = e.div, divTxt = !dv ? '-' : dv.status !== 'ok' ? dv.status : `${Math.min(...(dv.forms ? Object.values(dv.forms).filter((x) => x.used).map((x) => x.absErr) : [dv.absErr])).toExponential(1)}${dv.ok ? '' : ' FAIL'}`;
    L.push(`| ${e.id} | ${e.expect} | ${e.verdict} | ${e.targetsAgree ?? '-'} | ${note.replace(/\|/g, '/')} | ${r.topology?.faces ?? '-'} | ${cfErr === null ? '-' : cfErr.toExponential(1)} | ${cmp.occt ? cmp.occt.volumeAbsErr.toExponential(1) : '-'} | ${divTxt} | ${e.oracle} | ${e.tight?.status === 'ok' ? (e.tight.ok ? 'ok' : e.tight.issues[0].slice(0, 60)) : '-'} | ${e.validateStep ? (e.validateStep.ok ? 'ok' : e.validateStep.error.slice(0, 60)) : '-'} |`);
  }
  fs.writeFileSync(path.join(outDir, 'summary.md'), L.join('\n') + '\n');
  console.log(`verdicts ${JSON.stringify(rep.counts)}\nwrote ${path.relative(ROOT, outDir)}/report.json and summary.md`);
}

// Run only as a script: tests import prismBody.
if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((err) => { console.error(err.stack ?? err.message); process.exit(1); });
