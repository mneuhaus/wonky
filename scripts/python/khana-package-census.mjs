// Census of the non-stdlib Python packages the corpus imports, and how many
// corpus files each one blocks under wonky's import policy (docs/python-khana.md).
//
// Static scan, read only. Inputs: the unique Python corpus files of
// out/corpus/runs.jsonl (frontend "py") under $WONKY_CORPUS_ROOT (default
// ~/Workspace/cad). For each file, imports are resolved like the runner does:
//   stdlib (sys.stdlib_module_names of `uv run --no-project python`), then
//   wonky-provided modules (top-level entries of python/ that the runner serves),
//   then project-local modules on the model's sys.path (model directory, then
//   the nearest ancestor holding a pyproject.toml), recursively,
//   else an external package.
// "Imports" counts every import statement, including ones inside functions,
// try/except blocks and `if __name__ == "__main__":`. "First blocker" is the
// first external package in source order (depth first through project
// modules): the capability error a run reports when nothing earlier fails.
// build123d's external-geometry readers (import_step, import_stl, ...) are
// counted by call sites, directly or in project modules.
//
// Usage: node scripts/python/khana-package-census.mjs [--json out.json]
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = process.env.WONKY_CORPUS_ROOT ?? join(homedir(), 'Workspace', 'cad');
const RUNS = join(REPO, 'out/corpus/runs.jsonl');
const READERS = ['import_step', 'import_stl', 'import_brep', 'import_svg', 'import_dxf'];
// cad_khana callables that wonky's cad_khana refuses (python/cad_khana/).
const DIAGNOSTICS = ['check', 'inspect', 'suggest_orientation', 'score_orientation', 'push', 'draw', 'export_assembly',
  'export_glb', 'export_animated_glb', 'detect_overhang', 'detect_bores', 'detect_pins', 'bore_face_radius',
  'tessellate_tagged', 'self_supporting', 'min_wall', 'min_wall_mm', 'enclosed_voids', 'floating_solids',
  'sharp_vertical_edges', 'sharp_rim_edges', 'describe_face', 'describe_edge', 'describe_vertex', 'face_relations',
  'compute', 'evaluate', 'match_hint', 'diff', 'probe'];

const stdlib = new Set(spawnSync('uv', ['run', '--no-project', '--quiet', 'python', '-c',
  'import sys; print("\\n".join(sorted(sys.stdlib_module_names)))'], { encoding: 'utf8' }).stdout.trim().split('\n'));
if (stdlib.size < 100) throw new Error('Could not read sys.stdlib_module_names through uv');
const provided = new Set(['build123d', ...readdirSync(join(REPO, 'python')).filter(n => !/^[_.]/.test(n)).flatMap(n => {
  const path = join(REPO, 'python', n);
  if (n.endsWith('.py') && !['runner.py', 'build123d.py'].includes(n)) return [n.slice(0, -3)];
  return statSync(path).isDirectory() && existsSync(join(path, '__init__.py')) ? [n] : [];
})]);

const files = [...new Map(readFileSync(RUNS, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  .filter(run => run.frontend === 'py').map(run => [run.path, run])).keys()].sort();

function projectRoots(file) {
  const roots = [dirname(file)];
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'pyproject.toml'))) { if (!roots.includes(dir)) roots.push(dir); break; }
    if (dirname(dir) === dir) break;
  }
  return roots;
}

// Absolute import statements in source order: [{module, line}]. Relative imports are package-internal.
function imports(source) {
  const found = [];
  source.split('\n').forEach((text, index) => {
    const code = text.replace(/#.*/, '');
    let match = code.match(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/);
    if (match) { found.push({ module: match[1], line: index + 1 }); return; }
    match = code.match(/^\s*import\s+(.+)$/);
    if (match) for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+/)[0];
      if (/^[A-Za-z_][\w.]*$/.test(name)) found.push({ module: name, line: index + 1 });
    }
  });
  return found;
}

function local(module, roots) {
  const parts = module.split('.');
  for (const root of roots) {
    for (let n = parts.length; n >= 1; n--) {
      const base = join(root, ...parts.slice(0, n));
      if (existsSync(`${base}.py`)) return `${base}.py`;
      if (existsSync(join(base, '__init__.py'))) return join(base, '__init__.py');
    }
    if (existsSync(join(root, parts[0])) && statSync(join(root, parts[0])).isDirectory()) return join(root, parts[0]);
  }
  return null;
}

// Module names defined somewhere in a top-level corpus project (any depth).
const projectIndex = new Map();
function projectNames(top) {
  if (!projectIndex.has(top)) {
    const names = new Set(), walk = dir => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        if (item.name.startsWith('.') || ['node_modules', '__pycache__', 'venv', 'site-packages'].includes(item.name)) continue;
        if (item.isDirectory()) { if (existsSync(join(dir, item.name, '__init__.py'))) names.add(item.name); walk(join(dir, item.name)); }
        else if (item.name.endsWith('.py')) names.add(item.name.slice(0, -3));
      }
    };
    walk(top);
    projectIndex.set(top, names);
  }
  return projectIndex.get(top);
}
const projectOf = file => join(CORPUS, file.slice(CORPUS.length + 1).split('/')[0]);
const corpusProjects = readdirSync(CORPUS, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.'))
  .map(d => join(CORPUS, d.name));
function unresolvedKind(entry, name) {
  if (projectNames(projectOf(entry)).has(name)) return 'project-module-off-path';
  if (corpusProjects.some(top => projectNames(top).has(name))) return 'module-of-another-project';
  return 'installed-package';
}

function scan(entry) {
  const roots = projectRoots(entry), visited = new Set(), external = [], readers = new Set(), diagnostics = new Set();
  let khana = false;
  const visit = file => {
    if (visited.has(file) || !file.endsWith('.py')) return;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const name of READERS) if (new RegExp(`\\b${name}\\s*\\(`).test(source)) readers.add(name);
    const fromKhana = [...source.matchAll(/^\s*from\s+cad_khana[\w.]*\s+import\s+(\([^)]*\)|[^\n]+)/gm)]
      .flatMap(m => m[1].replace(/[()]/g, '').split(',').map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean));
    for (const name of fromKhana) {
      const called = new RegExp(`^(?!\\s*(?:def|from|import)\\b).*\\b${name}\\s*\\(`, 'm').test(source);
      if (DIAGNOSTICS.includes(name) && called) diagnostics.add(name);
    }
    for (const { module, line } of imports(source)) {
      const top = module.split('.')[0];
      if (top === 'cad_khana') khana = true;
      if (stdlib.has(top) || provided.has(top)) continue;
      const path = local(module, roots);
      if (path) { visit(path); continue; }
      external.push({ package: top, file: file.slice(CORPUS.length + 1), line,
        kind: unresolvedKind(entry, top) });
    }
  };
  visit(entry);
  return { external, readers: [...readers], khana, diagnostics: [...diagnostics], direct: new Set(
    imports(readFileSync(entry, 'utf8')).map(i => i.module.split('.')[0])) };
}

const rows = files.map(path => ({ path, ...scan(join(CORPUS, path)) }));
const packages = new Map();
const entry = (name, kind) => packages.get(name) ?? packages.set(name, { kind, direct: 0, transitive: 0, first: 0 }).get(name);
for (const row of rows) {
  const seen = new Map(row.external.map(e => [e.package, e.kind]));
  for (const [name, kind] of seen) { const e = entry(name, kind); e.transitive++; if (row.direct.has(name)) e.direct++; }
  if (row.external.length) entry(row.external[0].package, row.external[0].kind).first++;
}
const readerCounts = Object.fromEntries(READERS.map(name => [name, rows.filter(r => r.readers.includes(name)).length]));
const khanaRows = rows.filter(r => r.khana);
const summary = {
  schema: 'wonky-python-package-census/1', corpusRoot: CORPUS, files: rows.length,
  provided: [...provided].sort(),
  filesWithExternalPackage: rows.filter(r => r.external.length).length,
  filesWithReader: rows.filter(r => r.readers.length).length,
  filesBlockedByPackageOrReader: rows.filter(r => r.external.length || r.readers.length).length,
  packages: Object.fromEntries([...packages].sort((a, b) => b[1].transitive - a[1].transitive || a[0].localeCompare(b[0]))),
  readers: readerCounts,
  cadKhana: {
    files: khanaRows.length,
    callingRefusedDiagnostics: khanaRows.filter(r => r.diagnostics.length).length,
    pytestModules: khanaRows.filter(r => /\/tests?\//.test(r.path)).length,
    diagnostics: Object.fromEntries(DIAGNOSTICS.map(name => [name, khanaRows.filter(r => r.diagnostics.includes(name)).length]).filter(([, n]) => n)),
    withoutOtherExternalPackage: khanaRows.filter(r => !r.external.length).length,
  },
  rows: rows.map(({ path, external, readers, khana, diagnostics }) => ({ path, external, readers, khana, diagnostics })),
};
const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(summary, null, 1) + '\n');
const { rows: _rows, ...short } = summary;
console.log(JSON.stringify(short, null, 1));
