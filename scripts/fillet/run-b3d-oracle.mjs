// Run the build123d oracle probe (scripts/fillet/b3d_probe.py) over every build123d
// corpus file with a reachable fillet/chamfer site (tmp/fillet/static.json).
// Each file runs from a MIRROR under tmp/fillet/mirror/ (the corpus is read only),
// via `uv run --no-project --offline` (python3 is never called directly), at most
// 3 processes at once, 600 s per file. Resumable: files with an output are skipped
// unless --rerun. Output: tmp/fillet/b3d/<slug>.json (+ .log), BREPs in tmp/fillet/b3d/brep/.
//
// Usage: node scripts/fillet/run-b3d-oracle.mjs [--only substr] [--rerun] [--concurrency N]
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const CORPUS = '~/Workspace/cad';
const args = process.argv.slice(2);
const opt = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const only = opt('--only'), rerun = args.includes('--rerun');
const conc = Math.min(3, Number(opt('--concurrency') ?? 3));
const TIMEOUT = Number(opt('--timeout') ?? 600) * 1000;

const { sites } = JSON.parse(readFileSync(join(REPO, 'tmp/fillet/static.json'), 'utf8'));
const files = [...new Set(sites.filter(s => s.frontend === 'py' && s.reachable && s.dim === '3d').map(s => s.path))]
  .filter(p => !only || p.includes(only));
const MIRROR = join(REPO, 'tmp/fillet/mirror'), OUT = join(REPO, 'tmp/fillet/b3d');
mkdirSync(MIRROR, { recursive: true }); mkdirSync(join(OUT, 'brep'), { recursive: true });

function projectRoot(rel) {
  let d = dirname(join(CORPUS, rel));
  while (d.startsWith(CORPUS) && d !== CORPUS) { if (existsSync(join(d, 'pyproject.toml'))) return d; d = dirname(d); }
  return dirname(join(CORPUS, rel));
}
const mirrored = new Set();
function mirror(srcDir) {
  if (mirrored.has(srcDir)) return;
  const dst = join(MIRROR, srcDir.slice(CORPUS.length + 1));
  mkdirSync(dst, { recursive: true });
  const r = spawnSync('rsync', ['-a', '--max-size=20m', '--prune-empty-dirs',
    '--exclude=.venv', '--exclude=venv', '--exclude=node_modules', '--exclude=.git', '--exclude=__pycache__',
    '--exclude=.pytest_cache', '--include=*/', '--include=*.py', '--include=*.json', '--include=*.toml',
    '--include=*.yaml', '--include=*.yml', '--include=*.txt', '--include=*.csv', '--include=*.step', '--include=*.stp',
    '--include=*.stl', '--include=*.svg', '--include=*.dxf', '--include=*.ttf', '--include=*.otf', '--include=*.png',
    '--exclude=*', srcDir + '/', dst + '/'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`rsync ${srcDir}: ${r.stderr}`);
  mirrored.add(srcDir);
}
// shared libraries the models import: cad_khana, pruefstand
mirror(join(CORPUS, 'cad-khana/src'));
mirror(join(CORPUS, 'cad-project-043/pruefstand/src'));
const EXTRA = [join(MIRROR, 'cad-khana/src'), join(MIRROR, 'cad-project-043/pruefstand/src'), join(REPO, 'scripts/fillet/stubs')].join(':');

const jobs = files.map(rel => {
  const root = projectRoot(rel);
  const slug = rel.replace(/[^A-Za-z0-9]+/g, '_');
  return { rel, root, slug, out: join(OUT, slug + '.json'), log: join(OUT, slug + '.log') };
}).filter(j => rerun || !existsSync(j.out));

console.log(`${jobs.length} files to run (of ${files.length})`);
let running = 0, idx = 0, done = 0;
await new Promise(resolve => {
  const next = () => {
    if (idx >= jobs.length && running === 0) return resolve();
    while (running < conc && idx < jobs.length) {
      const j = jobs[idx++]; running++;
      mirror(j.root);
      const model = join(MIRROR, j.rel);
      const env = { ...process.env, FILLET_MIRROR_ROOT: join(MIRROR, j.root.slice(CORPUS.length + 1)), FILLET_EXTRA_PATHS: EXTRA, MPLBACKEND: 'Agg' };
      const argv = ['run', '--no-project', '--offline', '--quiet', '--with', 'build123d==0.13.0', '--with', 'numpy', '--with', 'trimesh',
        '--with', 'pyyaml', '--with', 'scipy', '--with', 'bd_warehouse', '--with', 'pytest', '--with', 'pillow', '--with', 'typer',
        'python', join(REPO, 'scripts/fillet/b3d_probe.py'), model, j.rel, j.out, join(OUT, 'brep')];
      const t0 = Date.now();
      const p = spawn('uv', argv, { env, cwd: dirname(model) });
      let log = '';
      p.stdout.on('data', d => { log += d; }); p.stderr.on('data', d => { log += d; });
      const timer = setTimeout(() => { log += `\n[timeout ${TIMEOUT / 1000}s]\n`; p.kill('SIGKILL'); }, TIMEOUT);
      p.on('close', code => {
        clearTimeout(timer); running--; done++;
        writeFileSync(j.log, log);
        if (!existsSync(j.out)) writeFileSync(j.out, JSON.stringify({ path: j.rel, status: 'crashed', exitCode: code, wallS: (Date.now() - t0) / 1000, records: [], logTail: log.slice(-1500) }));
        console.log(`[${done}/${jobs.length}] ${j.rel} exit=${code} ${((Date.now() - t0) / 1000).toFixed(1)}s ${log.trim().split('\n').pop()?.slice(0, 200)}`);
        next();
      });
    }
  };
  next();
});
console.log('DONE');
