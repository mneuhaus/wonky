// Re-checks every fs-missing-builtin repro against the production CLI and
// against the prototype harness, and compares with the expected result stated
// in the repro headers and docs/corpus/cluster-fs-missing-builtin.md.
// At most 3 processes, per-invocation timeout, uptime at start and end.
// Default JS path: WONKY_BACKEND is removed from the child environment.
//
//   node scripts/corpus/fs-missing-builtin/verify-repros.mjs
//     -> out/corpus/cluster-fs-missing-builtin-verify.json
//        tmp/corpus/fs-missing-builtin/run-meta.jsonl (appended)
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dir = 'fixtures/corpus-repro/fs-missing-builtin';
const tmp = join(root, 'tmp/corpus/fs-missing-builtin/verify');
const TIMEOUT_S = 240, CONCURRENCY = 3;
const vol = (expected, tol = 1e-6) => got => Array.isArray(got) && got.length === expected.length && got.every((v, i) => Math.abs(v - expected[i]) <= tol * Math.max(1, expected[i]));

// kind 'cli': production `node bin/wonky.mjs`; expect.text is a substring of the output (with exit 0: of a body line).
// The 'cli' rows state the production result since W1 (docs/corpus/w1.md); the pre-W1 result is in each row's comment.
// kind 'harness': scripts/corpus/fs-missing-builtin/harness.mjs with HARNESS_ROOT=root.
const cases = [
  { id: 'op-transform', kind: 'cli', file: 'fixtures/corpus-repro/op-transform.fs', expect: { text: ":9:9: 'opTransform' is not defined" } },
  { id: 'op-transform-pose', kind: 'cli', file: `${dir}/op-transform-pose.fs`, expect: { text: ":24:9: 'opTransform' is not defined" } },
  { id: 'robustEverything', kind: 'cli', file: `${dir}/std-queries.fs`, feature: 'robustEverything', expect: { exit: 0, text: 'model/a: 8 vertices · 12 edges · 6 faces · 1000 mm³' } /* W1; before: 23:19 'makeRobustQuery' is not defined */ },
  { id: 'containsPoint', kind: 'cli', file: `${dir}/std-queries.fs`, feature: 'containsPoint', expect: { exit: 0, text: 'model/a: 8 vertices · 12 edges · 6 faces · 1000 mm³' } /* W1; before: 34:19 'qContainsPoint' is not defined */ },
  { id: 'idFromString', kind: 'cli', file: `${dir}/std-queries.fs`, feature: 'idFromString', expect: { exit: 0, text: 'model/a: 8 vertices · 12 edges · 6 faces · 1000 mm³' } /* W1; before: 43:28 'makeId' is not defined */ },
  { id: 'revolve-sleeve', kind: 'cli', file: `${dir}/op-revolve.fs`, feature: 'sleeve', expect: { text: ":21:9: 'opRevolve' is not defined" } },
  { id: 'revolve-reliefCone', kind: 'cli', file: `${dir}/op-revolve.fs`, feature: 'reliefCone', expect: { text: ":32:9: 'opRevolve' is not defined" } },
  { id: 'atan2Angle', kind: 'cli', file: `${dir}/pure-values.fs`, feature: 'atan2Angle', expect: { exit: 0, text: 'model/box: 8 vertices · 12 edges · 6 faces · 192 mm³' } /* W1; before: 24:17 'atan2' is not defined */ },
  { id: 'rotatedCopy', kind: 'cli', file: `${dir}/pure-values.fs`, feature: 'rotatedCopy', expect: { exit: 0, text: 'model/spin/quarter/model/cube: 8 vertices · 12 edges · 6 faces · 8 mm³' } /* W1; before: 38:33 'rotationAround' is not defined */ },
  { id: 'mirroredCopy', kind: 'cli', file: `${dir}/pure-values.fs`, feature: 'mirroredCopy', expect: { text: ':54:9: Only proper rigid transforms are implemented' } /* W1; before: 55:33 'mirrorAcross' is not defined */ },
  { id: 'integerBound', kind: 'cli', file: `${dir}/integer-bound.fs`, feature: 'integerBound', expect: { exit: 0, text: 'model/cube: 8 vertices · 12 edges · 6 faces · 2 mm³' } /* W1; before: 18:25 'unitless' is not defined */ },
  { id: 'integerBound-plainBox', kind: 'cli', file: `${dir}/integer-bound.fs`, feature: 'plainBox', expect: { exit: 0, text: 'model/cube: 8 vertices · 12 edges · 6 faces · 1 mm³' } /* W1; before: 18:25 'unitless' is not defined */ },
  { id: 'next-countersink', kind: 'cli', file: `${dir}/next-countersink-breakout.fs`, feature: 'countersink', expect: { text: ':57:9: opBoolean supports coaxial cylinder primitives' } },
  { id: 'next-countersink-hole', kind: 'cli', file: `${dir}/next-countersink-breakout.fs`, feature: 'hole', expect: { exit: 0, text: '1067.162397' } },
  { id: 'next-headPilot', kind: 'cli', file: `${dir}/next-pierced-web-step.fs`, feature: 'headPilot', expect: { text: ':56:9: opBoolean through holes need a tool axis perpendicular to exactly two faces' } },
  { id: 'next-footHole-step', kind: 'cli', file: `${dir}/next-pierced-web-step.fs`, feature: 'footHole', extra: ['--format', 'step', '--out', join(tmp, 'footHole/model')], expect: { exit: 1, text: 'STEP cylindrical parameter curves unresolved: InvalidSource' } },
  { id: 'H op-transform-pose', kind: 'harness', file: `${dir}/op-transform-pose.fs`, expect: { bodies: 1, faces: 7, volumes: vol([884.7623916933765]) } },
  { id: 'H robustEverything', kind: 'harness', file: `${dir}/std-queries.fs`, feature: 'robustEverything', expect: { bodies: 1 } },
  { id: 'H containsPoint', kind: 'harness', file: `${dir}/std-queries.fs`, feature: 'containsPoint', expect: { bodies: 1 } },
  { id: 'H idFromString', kind: 'harness', file: `${dir}/std-queries.fs`, feature: 'idFromString', expect: { bodies: 1 } },
  { id: 'H revolve-sleeve', kind: 'harness', file: `${dir}/op-revolve.fs`, feature: 'sleeve', expect: { bodies: 1, faces: 4, volumes: vol([13571.68026350788]) } },
  { id: 'H revolve-reliefCone', kind: 'harness', file: `${dir}/op-revolve.fs`, feature: 'reliefCone', expect: { message: 'Revolve of a profile touching the axis is not implemented' } },
  { id: 'H atan2Angle', kind: 'harness', file: `${dir}/pure-values.fs`, feature: 'atan2Angle', expect: { bodies: 1, volumes: vol([192]) } },
  { id: 'H rotatedCopy', kind: 'harness', file: `${dir}/pure-values.fs`, feature: 'rotatedCopy', expect: { bodies: 2, volumes: vol([8, 8]) } },
  { id: 'H mirroredCopy', kind: 'harness', file: `${dir}/pure-values.fs`, feature: 'mirroredCopy', expect: { message: 'Only proper rigid transforms are implemented' } },
  { id: 'H integerBound', kind: 'harness', file: `${dir}/integer-bound.fs`, feature: 'integerBound', expect: { message: 'Expected IntegerBoundSpec' } },
];

function run(c) {
  const script = c.kind === 'cli' ? 'bin/wonky.mjs' : 'scripts/corpus/fs-missing-builtin/harness.mjs';
  const argv = [script, c.file, ...(c.feature ? ['--feature', c.feature] : []), ...(c.kind === 'cli' ? (c.extra ?? ['--check']) : [])];
  const env = { ...process.env, ...(c.kind === 'harness' ? { HARNESS_ROOT: root } : {}) };
  delete env.WONKY_BACKEND;
  const t0 = Date.now();
  return new Promise(resolve => {
    const child = spawn('node', argv, { cwd: root, env, detached: true });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} resolve({ timeout: true, ms: Date.now() - t0 }); }, TIMEOUT_S * 1000);
    child.on('close', exit => { clearTimeout(timer); resolve({ exit, out, err, ms: Date.now() - t0 }); });
  });
}

function judge(c, r) {
  if (r.timeout) return { pass: false, observed: `timeout after ${TIMEOUT_S} s` };
  const e = c.expect;
  if (c.kind === 'cli') {
    const text = `${r.out}\n${r.err}`.trim();
    const lines = text.split('\n').filter(Boolean);
    const observed = (e.exit === 0 ? lines.find(l => l.includes(e.text)) : null) ?? lines.at(-1) ?? '';
    const pass = text.includes(e.text) && (e.exit === undefined ? r.exit !== 0 : r.exit === e.exit);
    return { pass, observed: observed.replace(root + '/', '').slice(0, 400), exit: r.exit };
  }
  let j; try { j = JSON.parse(r.out.trim().split('\n').pop()); } catch { return { pass: false, observed: `harness crash: ${(r.err || r.out).slice(-300)}` }; }
  const checks = [];
  if (e.bodies !== undefined) checks.push(j.bodies === e.bodies);
  if (e.faces !== undefined) checks.push(j.faces === e.faces);
  if (e.volumes) checks.push(e.volumes(j.volumesMm3));
  if (e.message) checks.push(String(j.message ?? '').includes(e.message));
  else checks.push(j.ok === true);
  const observed = j.ok ? `ok: ${j.bodies} bodies, ${j.faces} faces, volumes ${JSON.stringify(j.volumesMm3)}, proto ${JSON.stringify(j.protoCalls)}` : `${j.line}:${j.column}: ${j.message}`;
  return { pass: checks.every(Boolean), observed };
}

mkdirSync(tmp, { recursive: true });
const meta = { pass: 'verify-repros', start: new Date().toISOString(), uptimeStart: execSync('uptime').toString().trim(), cases: cases.length, concurrency: CONCURRENCY, timeoutS: TIMEOUT_S,
  node: process.version, backend: 'js (WONKY_BACKEND unset)' };
try { meta.head = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch {}
const results = new Array(cases.length);
let next = 0;
async function worker() {
  while (next < cases.length) {
    const i = next++, c = cases[i];
    const r = await run(c);
    const verdict = judge(c, r);
    results[i] = { id: c.id, kind: c.kind, file: c.file, feature: c.feature ?? null, ms: r.ms, ...verdict };
    console.log(`${verdict.pass ? 'PASS' : 'FAIL'} ${c.id.padEnd(24)} ${String(r.ms).padStart(6)} ms  ${verdict.observed.slice(0, 150)}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
meta.end = new Date().toISOString(); meta.uptimeEnd = execSync('uptime').toString().trim();
meta.passed = results.filter(r => r.pass).length;
writeFileSync(join(root, 'out/corpus/cluster-fs-missing-builtin-verify.json'), JSON.stringify({ meta, results }, null, 2) + '\n');
appendFileSync(join(root, 'tmp/corpus/fs-missing-builtin/run-meta.jsonl'), JSON.stringify(meta) + '\n');
console.log(`${meta.passed}/${cases.length} as expected; ${meta.uptimeEnd}`);
process.exitCode = meta.passed === cases.length ? 0 : 1;
