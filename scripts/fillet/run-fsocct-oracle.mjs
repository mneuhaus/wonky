// Run the FeatureScript oracle probe (scripts/fillet/fsocct_probe.py on a copy of
// Marc's fsocct in tmp/fillet/fsocct) over every (file, exported feature) of the FS
// corpus files with a reachable opFillet/opChamfer site (tmp/fillet/static.json).
// The FS source is COPIED to tmp/fillet/fs-src/; in the copy, Onshape document
// imports (`NS::import(path : "<doc id>", ...)`) are commented out because fsocct
// cannot fetch them: a feature that uses NS::build then fails at its use site,
// which the record reports. At most 3 processes, 300 s each; resumable.
//
// Usage: node scripts/fillet/run-fsocct-oracle.mjs [--only substr] [--rerun]
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const args = process.argv.slice(2);
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const only = opt('--only'), rerun = args.includes('--rerun');
const targets = JSON.parse(readFileSync(join(REPO, 'out/corpus/targets.json'), 'utf8'));
const { sites } = JSON.parse(readFileSync(join(REPO, 'tmp/fillet/static.json'), 'utf8'));
const files = [...new Set(sites.filter(s => s.frontend === 'fs' && s.reachable).map(s => s.path))].filter(p => !only || p.includes(only));
const SRC = join(REPO, 'tmp/fillet/fs-src'), OUT = join(REPO, 'tmp/fillet/fsocct-out'), FSO = join(REPO, 'tmp/fillet/fsocct');
mkdirSync(join(OUT, 'brep'), { recursive: true });

const jobs = [];
for (const rel of files) {
  const f = targets.files.find(x => x.path === rel);
  const raw = readFileSync(join(targets.corpusRoot, rel), 'utf8');
  const stripped = raw.replace(/^(\s*)(\w+::import\s*\([^;]*\)\s*;)/gm, '$1// [fillet-probe: Onshape import removed] $2');
  const copy = join(SRC, rel); mkdirSync(dirname(copy), { recursive: true }); writeFileSync(copy, stripped);
  // implied UI defaults (Onshape valueBounds.fs defaults as in src/scalars.mjs; file-local specs parsed)
  const STD = { LENGTH_BOUNDS: '25*millimeter', NONNEGATIVE_LENGTH_BOUNDS: '25*millimeter', NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS: '25*millimeter',
    ZERO_DEFAULT_LENGTH_BOUNDS: '0*millimeter', NONNEGATIVE_ZERO_DEFAULT_LENGTH_BOUNDS: '0*millimeter', ANGLE_360_BOUNDS: '30*degree',
    POSITIVE_COUNT_BOUNDS: '2', POSITIVE_REAL_BOUNDS: '1' };
  const specs = {};
  for (const m of raw.matchAll(/const\s+(\w+)\s*=\s*\{\s*\((millimeter|meter|centimeter|inch|degree|radian)\)\s*:\s*\[\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*\]/g)) specs[m[1]] = `${m[4]}*${m[2]}`;
  const params = {};
  for (const m of raw.matchAll(/is(?:Length|Angle|Integer|Real)\(\s*definition\.(\w+)\s*,\s*(\w+)\s*\)/g)) { const v = specs[m[2]] ?? STD[m[2]]; if (v) params[m[1]] = v; }
  for (const m of raw.matchAll(/definition\.(\w+)\s+is\s+boolean/g)) params[m[1]] = 'false';
  for (const feature of f.features ?? []) {
    const slug = (rel + '#' + feature).replace(/[^A-Za-z0-9]+/g, '_');
    const out = join(OUT, slug + '.json');
    if (!rerun && existsSync(out)) continue;
    jobs.push({ rel, feature, copy, out, log: join(OUT, slug + '.log'), family: f.family, params });
  }
}
console.log(`${jobs.length} units`);
let running = 0, idx = 0, done = 0;
await new Promise(resolve => {
  const next = () => {
    if (idx >= jobs.length && running === 0) return resolve();
    while (running < 3 && idx < jobs.length) {
      const j = jobs[idx++]; running++;
      const t0 = Date.now();
      const p = spawn('uv', ['run', '--offline', '--frozen', '--quiet', 'python', join(REPO, 'scripts/fillet/fsocct_probe.py'), j.copy, j.feature, j.out, join(OUT, 'brep')], { cwd: FSO, env: { ...process.env, FILLET_PARAMS: JSON.stringify(j.params) } });
      let log = '';
      p.stdout.on('data', d => { log += d; }); p.stderr.on('data', d => { log += d; });
      const timer = setTimeout(() => { log += '\n[timeout 300s]\n'; p.kill('SIGKILL'); }, 300000);
      p.on('close', code => {
        clearTimeout(timer); running--; done++;
        writeFileSync(j.log, log);
        if (!existsSync(j.out)) writeFileSync(j.out, JSON.stringify({ path: j.copy, feature: j.feature, status: 'crashed', exitCode: code, records: [], logTail: log.slice(-1500) }));
        console.log(`[${done}/${jobs.length}] ${j.rel}#${j.feature} ${((Date.now() - t0) / 1000).toFixed(1)}s ${log.trim().split('\n').pop()?.slice(0, 220)}`);
        next();
      });
    }
  };
  next();
});
console.log('DONE');
