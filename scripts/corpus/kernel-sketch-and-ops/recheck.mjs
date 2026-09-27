// Re-check of cluster kernel-sketch-and-ops (docs/corpus/cluster-kernel-sketch-and-ops.md, section 0).
// Three job kinds, at most 3 processes at once, 180 s per job, uptime at start and end:
//   cli      every repro case through the production CLI (node bin/wonky.mjs <file> --check)
//   linearc  the cap-normal and follow-on repros with polygon prisms built by the existing F32x2
//            line/arc extruder (scripts/corpus/diagnose-planar-admission.mjs --simulate linearc,
//            the simulation of the boolean-invalid-topology fix; in-memory, diagnosis only)
//   hybrid   the two Boolean follow-on repros on the bake-off route (corefine + recover prototypes,
//            WONKY_CORPUS_STUB=hybrid-all scripts/corpus/boolean-probe.mjs; test only), then
//            OCCT validation of the written STEP (uv run scripts/validate-step.py)
// Nothing under src/, kernel/ or bin/ changes. Output: out/corpus/cluster-kernel-sketch-and-ops.recheck.jsonl
// Usage: node scripts/corpus/kernel-sketch-and-ops/recheck.mjs
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadavg } from 'node:os';

const REPO = new URL('../../../', import.meta.url).pathname;
const OUT = join(REPO, 'out/corpus/cluster-kernel-sketch-and-ops.recheck.jsonl');
const R = 'fixtures/corpus-repro/kernel-sketch-and-ops';
const HYB = 'tmp/corpus/kso/hybrid';
const uptime = () => execSync('uptime').toString().trim();

const cli = (file, feature) => ({ kind: 'cli', id: `${file}${feature ? '#' + feature : ''}`,
  argv: ['bin/wonky.mjs', `${R}/${file}`, '--check', ...(feature ? ['--feature', feature] : [])] });
const linearc = (file, feature) => ({ kind: 'linearc', id: `${file}${feature ? '#' + feature : ''}`,
  argv: ['scripts/corpus/diagnose-planar-admission.mjs', `${R}/${file}`, feature ?? '', '--simulate', 'linearc'] });
const hybrid = (file, name, expectVolumeMm3) => ({ kind: 'hybrid', id: file, name, expectVolumeMm3,
  argv: ['scripts/corpus/boolean-probe.mjs', `${R}/${file}`],
  env: { WONKY_CORPUS_STUB: 'hybrid-all', WONKY_CORPUS_STEP: `${HYB}/${name}` } });

const JOBS = [
  cli('cap-normal-far-from-origin.fs', 'tiltedOctagonFar'),
  cli('cap-normal-far-from-origin.fs', 'tiltedRectangleFar'),
  cli('cap-normal-far-from-origin.fs', 'tiltedOctagonNear'),
  cli('through-hole-tilted-panel.fs'),
  cli('loft-two-polygons.fs', 'prismatoid'),
  cli('loft-two-polygons.fs', 'twistedOctagon'),
  cli('loft-two-polygons.fs', 'squareToCircle'),
  cli('loft-tapered-slot.fs', 'taperedSlot'),
  cli('loft-tapered-slot.fs', 'slotExtrudeControl'),
  cli('collinear-polyline-vertex.fs'),
  cli('profile-over-256-vertices.fs'),
  cli('line-arc-sketch-with-holes.fs'),
  cli('next-pierce-after-copy.fs'),
  cli('next-tilted-pocket-subtraction.fs'),
  linearc('cap-normal-far-from-origin.fs', 'tiltedOctagonFar'),
  linearc('cap-normal-far-from-origin.fs', 'tiltedRectangleFar'),
  linearc('cap-normal-far-from-origin.fs', 'tiltedOctagonNear'),
  linearc('through-hole-tilted-panel.fs'),
  linearc('next-tilted-pocket-subtraction.fs'),
  // Closed form: panel 280 x 70 x 3.2 minus an R1.7 hole through 3.2 mm; box 64 x 20 x 6 minus the
  // 40.4 x 6 pocket over the 1.5 mm it overlaps the foot.
  hybrid('through-hole-tilted-panel.fs', 'tilted-panel', 280 * 70 * 3.2 - Math.PI * 1.7 ** 2 * 3.2),
  hybrid('next-tilted-pocket-subtraction.fs', 'tilted-pocket', 64 * 20 * 6 - 40.4 * 6 * 1.5),
];

function run(argv, env = {}, cmd = 'node') {
  return new Promise(done => {
    const t0 = Date.now();
    const child = spawn(cmd, argv, { cwd: REPO, env: { ...process.env, ...env }, detached: true });
    let out = '', err = '';
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 180_000);
    child.on('close', (code, signal) => { clearTimeout(timer); done({ code, signal, out, err, wallMs: Date.now() - t0 }); });
  });
}
const lastJson = text => { for (const line of text.trim().split('\n').reverse()) { try { return JSON.parse(line); } catch {} } return null; };

mkdirSync(join(REPO, HYB), { recursive: true });
writeFileSync(OUT, JSON.stringify({ meta: 'start', at: new Date().toISOString(), uptime: uptime(), jobs: JOBS.length }) + '\n');
let next = 0;
async function worker() {
  while (next < JOBS.length) {
    const job = JOBS[next++];
    const load = loadavg()[0];
    const res = await run(job.argv, job.env);
    const row = { kind: job.kind, id: job.id, argv: job.argv, loadAtStart: +load.toFixed(2), wallMs: res.wallMs, exit: res.code, timedOut: res.signal === 'SIGKILL' };
    if (job.kind === 'cli') row.output = (res.out + res.err).trim().split('\n').filter(Boolean).at(-1) ?? '';
    else row.result = lastJson(res.out) ?? { raw: (res.out + res.err).slice(-600) };
    if (job.kind === 'hybrid') {
      row.expectVolumeMm3 = job.expectVolumeMm3;
      const prefix = `${HYB}/${job.name}`;
      if (existsSync(join(REPO, `${prefix}.step`))) {
        const v = await run(['run', '--quiet', 'scripts/validate-step.py', prefix], {}, 'uv');
        const report = (() => { try { return JSON.parse(v.out)[0]; } catch { return { raw: (v.out + v.err).slice(-600) }; } })();
        row.occt = { valid: report.valid, faces: report.faces, edges: report.edges, vertices: report.vertices, volumeMm3: report.volumeMm3, raw: report.raw };
        if (Number.isFinite(report.volumeMm3)) row.volumeRelErr = Math.abs(report.volumeMm3 - job.expectVolumeMm3) / job.expectVolumeMm3;
      }
    }
    appendFileSync(OUT, JSON.stringify(row) + '\n');
    const summary = row.output ?? (row.result?.ok ? `ok${row.result.stepError ? ' (STEP: ' + row.result.stepError + ')' : ''}${row.occt ? ` occt valid=${row.occt.valid} V=${row.occt.volumeMm3} relErr=${row.volumeRelErr?.toExponential(2)}` : ''}` : row.result?.message ?? JSON.stringify(row.result).slice(0, 200));
    console.log(`${job.kind.padEnd(7)} ${job.id.padEnd(52)} ${String(summary).slice(0, 220)} (${res.wallMs} ms)`);
  }
}
await Promise.all([worker(), worker(), worker()]);
appendFileSync(OUT, JSON.stringify({ meta: 'end', at: new Date().toISOString(), uptime: uptime() }) + '\n');
