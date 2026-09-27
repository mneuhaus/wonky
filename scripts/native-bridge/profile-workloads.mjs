#!/usr/bin/env node
// Runs the native-bridge profiling workloads one process at a time.
//
//   node scripts/native-bridge/profile-workloads.mjs [--only id,id] [--modes profile,count,plain,startup] [--plain-repeat N]
//
// Modes:
//   profile  node --cpu-prof into out/native-bridge/profile/cpuprofiles/<id>.cpuprofile
//   count    node --import count-kernel-calls.mjs into out/native-bridge/profile/calls/<id>.json
//   plain    the same command without instrumentation (wall/user/sys/max RSS)
//   startup  `node -e 0` and `--help` of both CLIs (process start and CLI module graph)
// Every run records `uptime` load averages before and after. Results merge into
// out/native-bridge/profile/runs.json keyed by mode and workload id.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const profileDirectory = join(root, 'out/native-bridge/profile');
const runsPath = join(profileDirectory, 'runs.json');
const python = join(root, 'out/build123d-performance/reference-venv/bin/python');
const cases = join(root, 'fixtures/performance-build123d/cases');
const outDir = (mode, id) => join(root, 'tmp/native-bridge/runs', mode, id);

const pythonCase = (id, file) => ({ id, frontend: 'python', expectExit: 0, interval: 250,
  args: out => ['bin/wonky-python.mjs', join(cases, file), '--python', python, '--out', join(out, 'model')] });
export const workloads = [
  pythonCase('py-planar-union', 'planar-union.py'),
  pythonCase('py-planar-pocket', 'planar-pocket.py'),
  pythonCase('py-frame-with-tab', 'frame-with-tab.py'),
  { id: 'fs-bracket', frontend: 'featurescript', expectExit: 0, interval: 250,
    args: out => ['bin/wonky.mjs', 'examples/bracket.fs', '--out', join(out, 'model')] },
  { id: 'fs-bored-spacer-print', frontend: 'featurescript', expectExit: 0, interval: 250,
    args: out => ['bin/wonky.mjs', 'examples/bored-spacer.fs', '--format', 'print', '--out', join(out, 'model')] },
  { id: 'fs-fuse-g1', frontend: 'featurescript', expectExit: 0, interval: 500,
    args: out => ['bin/wonky.mjs', 'fixtures/public-boolean-regressions/adapted/fuse-g1.fs', '--format', 'step', '--out', join(out, 'model')] },
  { id: 'fs-cut-h1', frontend: 'featurescript', expectExit: 0, interval: 500,
    args: out => ['bin/wonky.mjs', 'fixtures/public-boolean-regressions/adapted/cut-h1.fs', '--format', 'step', '--out', join(out, 'model')] },
  // r10b uses a 10 ms sampling interval: its deep Bend recursion made a 1 ms
  // profile 1.9 GB, beyond V8's maximum string length for JSON.parse.
  { id: 'fs-r10b-strict', frontend: 'featurescript', expectExit: 1, interval: 10000,
    args: () => ['bin/wonky.mjs', 'fixtures/r10b/r10b.fs', '--feature', 'singleStepR10b', '--check'] },
  { id: 'fs-r10b-tolerated', frontend: 'featurescript', expectExit: 1, interval: 10000, optional: true,
    args: () => ['bin/wonky.mjs', 'fixtures/r10b/r10b.fs', '--feature', 'singleStepR10b', '--check',
      '--curved-contacts', 'tolerated-regularized', '--contact-cap-mm', '1e-7'] },
];

function load() {
  const text = spawnSync('uptime', { encoding: 'utf8' }).stdout.trim();
  const match = /load averages?:\s*([\d.]+),?\s+([\d.]+),?\s+([\d.]+)/.exec(text);
  return { text, one: match ? Number(match[1]) : null, five: match ? Number(match[2]) : null, fifteen: match ? Number(match[3]) : null };
}

function timed(argv, env = {}) {
  const before = load();
  const started = process.hrtime.bigint();
  const child = spawnSync('/usr/bin/time', ['-l', process.execPath, ...argv], { cwd: root, encoding: 'utf8',
    env: { ...process.env, BEND_NO_TELEMETRY: '1', ...env }, maxBuffer: 256 * 1024 * 1024 });
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
  const after = load();
  const stderr = child.stderr ?? '';
  const time = /([\d.]+) real\s+([\d.]+) user\s+([\d.]+) sys/.exec(stderr);
  const rss = /(\d+)\s+maximum resident set size/.exec(stderr);
  return { argv: ['node', ...argv], exitCode: child.status, wallMs, realS: time ? Number(time[1]) : null,
    userS: time ? Number(time[2]) : null, sysS: time ? Number(time[3]) : null, maxRssMiB: rss ? Number(rss[1]) / 2 ** 20 : null,
    loadBefore: before, loadAfter: after, stdoutTail: (child.stdout ?? '').trim().split('\n').slice(-6),
    stderrTail: stderr.replace(/\s+[\d.]+ real[\s\S]*$/, '').trim().split('\n').slice(-4), at: new Date().toISOString() };
}

function save(results) {
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(runsPath, JSON.stringify(results, null, 1) + '\n');
}

function main() {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const only = option('--only')?.split(',');
  const modes = (option('--modes') ?? 'profile,count,plain').split(',');
  const plainRepeat = Number(option('--plain-repeat') ?? 1);
  const results = existsSync(runsPath) ? JSON.parse(readFileSync(runsPath, 'utf8')) : { schema: 'wonky-native-bridge-runs/1', runs: {} };
  results.node = process.version; results.platform = `${process.platform}-${process.arch}`;
  if (modes.includes('startup')) {
    const startup = { nodeEmpty: [], fsHelp: [], pyHelp: [] };
    for (let i = 0; i < 5; i++) {
      startup.nodeEmpty.push(timed(['-e', '0']));
      startup.fsHelp.push(timed(['bin/wonky.mjs', '--help']));
      startup.pyHelp.push(timed(['bin/wonky-python.mjs', '--help']));
    }
    results.runs.startup = startup; save(results);
    console.log('startup', Object.entries(startup).map(([k, v]) => `${k}=${v.map(r => r.wallMs.toFixed(0)).join('/')}ms`).join(' '));
  }
  for (const workload of workloads) {
    if (only ? !only.includes(workload.id) : workload.optional) continue;
    for (const mode of modes.filter(m => m !== 'startup')) {
      const out = outDir(mode, workload.id);
      rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
      let argv, env = {};
      if (mode === 'profile') {
        const directory = join(profileDirectory, 'cpuprofiles');
        mkdirSync(directory, { recursive: true });
        rmSync(join(directory, `${workload.id}.cpuprofile`), { force: true });
        argv = ['--cpu-prof', '--cpu-prof-dir', directory, '--cpu-prof-name', `${workload.id}.cpuprofile`,
          '--cpu-prof-interval', String(workload.interval), ...workload.args(out)];
      } else if (mode === 'count') {
        argv = ['--import', './scripts/native-bridge/count-kernel-calls.mjs', ...workload.args(out)];
        env = { WONKY_NB_COUNT_OUT: join(profileDirectory, 'calls', `${workload.id}.json`) };
      } else if (mode === 'plain') argv = workload.args(out);
      else throw new Error(`Unknown mode ${mode}`);
      const repeats = mode === 'plain' ? plainRepeat : 1;
      const runs = [];
      for (let i = 0; i < repeats; i++) {
        const run = timed(argv, env);
        run.expectedExit = workload.expectExit;
        run.exitMatches = run.exitCode === workload.expectExit;
        if (mode === 'profile') { run.intervalUs = workload.interval; run.cpuprofile = join('out/native-bridge/profile/cpuprofiles', `${workload.id}.cpuprofile`); }
        if (mode === 'count') run.calls = join('out/native-bridge/profile/calls', `${workload.id}.json`);
        runs.push(run);
        console.log(`${mode} ${workload.id}: exit ${run.exitCode} (expected ${workload.expectExit}) wall ${run.wallMs.toFixed(0)} ms ` +
          `user ${run.userS}s sys ${run.sysS}s rss ${run.maxRssMiB?.toFixed(0)} MiB load ${run.loadBefore.one}->${run.loadAfter.one}`);
      }
      results.runs[mode] ??= {};
      results.runs[mode][workload.id] = { frontend: workload.frontend, runs };
      save(results);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
