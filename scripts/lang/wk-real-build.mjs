// Build of the WK real-model evaluator (kernel/lang/wk/main.bend + real.bend,
// docs/language/spike-real-model.md): Bend -> C, then clang, each timed with
// /usr/bin/time -l (wall, peak RSS) and the load average before and after.
// Exactly one native compile at a time (this script runs the two steps in
// sequence; never start it twice). Writes out/lang/wk/real/build/wk-real and
// appends the measurement to out/lang/wk/real/build/builds.json.
//   node scripts/lang/wk-real-build.mjs
import { spawnSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const dir = join(root, 'out/lang/wk/real/build');
mkdirSync(dir, { recursive: true });
const bend = join(root, '.tools/bend-2.0.25/bin/bend');
const load = () => execSync('uptime').toString().trim().replace(/.*load averages?: /, '');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
const timed = (label, cmd, args, cwd) => {
  const before = load();
  const t0 = performance.now();
  const r = spawnSync('/usr/bin/time', ['-l', cmd, ...args], { cwd, encoding: 'utf8', env: { ...process.env, BEND_NO_TELEMETRY: '1' }, maxBuffer: 1 << 28 });
  const wallS = (performance.now() - t0) / 1000;
  const rss = Number(/(\d+)\s+maximum resident set size/.exec(r.stderr)?.[1] ?? NaN);
  const out = { label, command: [cmd, ...args].join(' '), exit: r.status, wallS, peakRssGB: rss / 1e9, loadBefore: before, loadAfter: load(),
    log: (r.stdout + r.stderr).split('\n').filter(l => l && !/^\s+\d+\s+[a-z]/.test(l)).slice(-15) };
  console.log(JSON.stringify({ label, exit: out.exit, wallS: out.wallS.toFixed(1), peakRssGB: out.peakRssGB.toFixed(2), load: [out.loadBefore, out.loadAfter] }));
  if (r.status !== 0) { console.error(r.stdout, r.stderr); throw new Error(`${label} failed`); }
  return out;
};
const sources = ['kernel/lang/wk/main.bend', 'kernel/lang/wk/real.bend', 'kernel/lang/wk/now_us.c'].map(f => ({ file: f, sha256: sha(join(root, f)) }));
const bendStep = timed('bend -> C', bend, [join(root, 'kernel/lang/wk/main.bend'), '-o', join(dir, 'wk-real.c')], join(root, 'kernel/lang/wk'));
const clangStep = timed('clang -O3', 'clang', ['-std=c11', '-O3', join(dir, 'wk-real.c'), '-o', join(dir, 'wk-real'), '-lpthread', '-lm'], dir);
const record = { builtAt: new Date().toISOString(), sources, cBytes: statSync(join(dir, 'wk-real.c')).size, binaryBytes: statSync(join(dir, 'wk-real')).size,
  binarySha256: sha(join(dir, 'wk-real')), steps: [bendStep, clangStep], note: 'indicative: shared machine, see load averages' };
const file = join(dir, 'builds.json');
const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { schema: 'wonky-lang-wk-real-builds/1', builds: [] };
all.builds.push(record);
writeFileSync(file, JSON.stringify(all, null, 1));
console.log(JSON.stringify({ cBytes: record.cBytes, binaryBytes: record.binaryBytes, binarySha256: record.binarySha256 }));
