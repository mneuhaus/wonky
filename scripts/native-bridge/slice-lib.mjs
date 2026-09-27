// Shared by slice-bench.mjs and test/native-bridge-slice.test.mjs: run a CLI in
// a fresh process with uptime before/after, and byte-compare the outputs of a
// js run and a native run of the same workload.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './slice-ops.mjs';

export { root };
export const guardPreload = join(root, 'scripts/native-bridge/slice-guard.mjs');
export const phasesPreload = join(root, 'scripts/native-bridge/slice-phases.mjs');
export const countPreload = join(root, 'scripts/native-bridge/count-kernel-calls.mjs');

export function uptime() {
  const text = spawnSync('uptime', { encoding: 'utf8' }).stdout.trim();
  const m = /load averages?:\s*([\d.]+),?\s+([\d.]+),?\s+([\d.]+)/.exec(text);
  return { text, one: m ? Number(m[1]) : null, five: m ? Number(m[2]) : null, fifteen: m ? Number(m[3]) : null };
}

// Environment for a backend: 'js' leaves WONKY_BACKEND unset (the default path).
export function backendEnv(backend, extra = {}) {
  const env = { ...process.env, BEND_NO_TELEMETRY: '1', ...extra };
  delete env.WONKY_BACKEND;
  if (backend !== 'js') env.WONKY_BACKEND = backend;
  return env;
}

// One fresh process under /usr/bin/time -l (wall, user/sys, max RSS).
export function runCli({ argv, backend, env = {}, preloads = [], timeoutMs = 10 * 60 * 1000 }) {
  const before = uptime();
  const started = process.hrtime.bigint();
  const child = spawnSync('/usr/bin/time', ['-l', process.execPath, ...preloads.flatMap(p => ['--import', p]), ...argv],
    { cwd: root, encoding: 'utf8', env: backendEnv(backend, env), maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs });
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
  const after = uptime();
  const stderr = child.stderr ?? '';
  const num = re => { const m = re.exec(stderr); return m ? Number(m[1]) : null; };
  return {
    exitCode: child.status, signal: child.signal, wallMs,
    userS: num(/([\d.]+) user/), sysS: num(/([\d.]+) sys/), maxRssMiB: (num(/(\d+)\s+maximum resident set size/) ?? 0) / 1048576,
    stdout: child.stdout ?? '', stderr: stderr.replace(/\n\s+[\d.]+ real[\s\S]*$/, '').trim(),
    load: { before, after },
  };
}

// FeatureScript and Python CLIs print one summary line per body.
export const bodyLines = stdout => stdout.split('\n').filter(line => /^\S+: \d+ vertices · \d+ edges · \d+ faces · /.test(line));

// brep.json as written by the CLIs (JSON.stringify(model, null, 2)): drop the
// top-level "backend" block as text, leaving every other byte in place.
export function withoutBackend(text) {
  const stripped = text.replace(/\n  "backend": \{\n(?:    .*\n)*?  \},\n/, '\n');
  if (stripped === text) throw new Error('brep.json has no top-level backend block');
  return stripped;
}

export function backendBlock(text) {
  return JSON.parse(text).backend;
}

// Byte comparison of every output file the js run wrote, plus stdout body lines.
export function compareOutputs({ jsDir, nativeDir, jsStdout, nativeStdout, prefix = 'model' }) {
  const files = {};
  for (const ext of ['brep.json', 'step', 'stl', 'html', 'print.json']) {
    const a = join(jsDir, `${prefix}.${ext}`), b = join(nativeDir, `${prefix}.${ext}`);
    if (!existsSync(a) && !existsSync(b)) continue;
    if (!existsSync(a) || !existsSync(b)) { files[ext] = { identical: false, reason: `${existsSync(a) ? 'native' : 'js'} run wrote no .${ext}` }; continue; }
    let x = readFileSync(a), y = readFileSync(b);
    if (ext === 'brep.json') { x = Buffer.from(withoutBackend(x.toString('utf8'))); y = Buffer.from(withoutBackend(y.toString('utf8'))); }
    files[ext] = { identical: x.equals(y), bytes: y.length };
  }
  const bodies = { js: bodyLines(jsStdout), native: bodyLines(nativeStdout) };
  const stdoutIdentical = bodies.js.length > 0 && JSON.stringify(bodies.js) === JSON.stringify(bodies.native);
  const identical = stdoutIdentical && Object.keys(files).length > 0 && Object.values(files).every(f => f.identical) && Boolean(files['brep.json']) && Boolean(files.step);
  return { identical, files, stdoutBodies: { identical: stdoutIdentical, lines: bodies.native.length } };
}

// Divergence evidence of a WONKY_BACKEND=diff run, never inferred from its exit
// code: the dump directories the comparator wrote (one per divergence) and the
// counter in the diff trace (null when the run wrote no trace).
export function diffEvidence({ dumpDir, traceFile }) {
  const dumps = existsSync(dumpDir) ? readdirSync(dumpDir).sort() : [];
  const trace = existsSync(traceFile) ? JSON.parse(readFileSync(traceFile, 'utf8')) : null;
  return { divergences: dumps.length, dumps, divergencesInTrace: trace?.divergences ?? null, trace };
}
