// Per-file table for the corpus cluster "py-imports"
// (docs/corpus/cluster-py-imports.md). Joins, for each of the cluster's files:
//   - the first blocker from out/corpus/runs.jsonl,
//   - the next blocker from out/corpus/py-imports-next.jsonl (both variants),
//   - the blocker after both frontend fixes (this cluster + py-api-surface stage 1)
//     from out/corpus/py-imports-next-deep.jsonl (variant dir+env+lazy), if present,
//     overridden by py-imports-next-deep-inplace.jsonl for files the mirror cannot run,
//   - the file's role (part model, tool, helper module, test),
//   - the build123d names it and its project-local modules use that the shim
//     does not implement (from tmp/corpus/facts/py-facts.json).
// Also lists the hidden members found by --rest (a caught ImportError that the
// corpus run classified elsewhere).
//
// Usage: node scripts/corpus/py-imports-files.mjs   (writes out/corpus/py-imports-files.json)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { OUT_DIR, TMP_DIR, RUNS } from './lib.mjs';

const jsonl = file => readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const latest = new Map();
for (const r of jsonl(RUNS)) latest.set(r.key, r);
const next = jsonl(join(OUT_DIR, 'py-imports-next.jsonl')).slice(1);
const deepFile = join(OUT_DIR, 'py-imports-next-deep.jsonl');
const deep = existsSync(deepFile) ? jsonl(deepFile).slice(1) : [];
// Files whose data inputs the mirror lacks (> 1 MiB, .step, .brd) were re-run in place
// (sandboxed, read-only: py-imports-next.mjs --in-place); those results take precedence.
const inplaceFile = join(OUT_DIR, 'py-imports-next-deep-inplace.jsonl');
const inplace = existsSync(inplaceFile) ? jsonl(inplaceFile).slice(1) : [];
const rest = existsSync(join(OUT_DIR, 'py-imports-next-rest.jsonl')) ? jsonl(join(OUT_DIR, 'py-imports-next-rest.jsonl')).slice(1) : [];
const facts = new Map(JSON.parse(readFileSync(join(TMP_DIR, 'facts/py-facts.json'), 'utf8')).files.map(f => [f.path, f]));

// Names the shim implements. Sentinels (Rot, Location, extrude, ...) import but fail on use.
const IMPLEMENTED = new Set(['Align', 'Mode', 'Shape', 'Box', 'Cylinder', 'Pos']);
// Scanner noise: names in the build123d namespace that these files use as stdlib modules, numpy or a local alias.
const NOT_API = new Set(['math', 'Path', 'G', 'os', 'json', 'np']);

// Roles that path rules cannot tell; each read by hand.
const ROLE = {
  'cad-project-033/debug_edges.py': ['tool', 'debug script: probes which edges fail to chamfer, prints a report'],
  'cad-project-003/overnight-2026-09-05/design-review/extract_lilypad.py': ['tool', 'extracts a PCB outline from an Eagle .brd and exports STEP/SVG'],
  'cad-project-003/overnight-2026-09-05/design-review/lilypad_helpers.py': ['helper', 'helper module (PCB envelopes), no entry point'],
  'cad-project-041/tray-repeat-study-2026-09-20/review/bound-concept-builder.py': ['tool', 'review concept builder over an imported source tray (argparse)'],
  'cad-project-041/archiv/studien/tray-flip-study-2026-09-19/review/source/build_concepts.py': ['tool', 'archived copy of the concept builder'],
  'cad-project-014/bottom-drive-review-2026-09-19/tool-improvement/worktree/pruefstand/src/pruefstand/region.py': ['helper', 'package module (relative import), not an entry point'],
};
const SNAPSHOT_BROKEN = /No module named 'hardware_refs'/;
// Files that also fail in plain CPython with the project environment, for a reason in
// the file itself (checked by hand against ~/Workspace/cad, read only).
const BROKEN = {
  'cad-project-041/single-step-r10/jobs/camera-correction/pivot-study/inputs/core_geometry.py':
    'older snapshot copy of src/core_geometry.py; its ROOT/FEEDER are derived from __file__, so FEEDER/tray-repeat-study-2026-09-20/simulation/oval-geometry.json resolves below jobs/camera-correction/, where it does not exist',
  'cad-project-033/debug_edges.py': 'stale debug script: case.PORT_H no longer exists in case.py',
};

function roleOf(path) {
  if (ROLE[path]) return ROLE[path];
  if (/\/tests\//.test(path)) return ['test', 'pytest module'];
  return ['model', 'builds printable or reference geometry in a main block'];
}

// b3d names of a file plus its project-local modules (same directory, transitively).
function apiNames(path, seen = new Set()) {
  if (seen.has(path)) return {};
  seen.add(path);
  const f = facts.get(path);
  if (!f) return {};
  const names = { ...f.b3dNames };
  for (const mod of f.imports ?? []) {
    const sibling = join(dirname(path), `${mod}.py`);
    if (facts.has(sibling)) for (const [n, c] of Object.entries(apiNames(sibling, seen))) names[n] = (names[n] ?? 0) + c;
  }
  return names;
}

const brief = r => r && { status: r.status, kind: r.kind, message: r.message.slice(0, 160), line: r.line, sourceLine: r.sourceLine ?? null, env: r.env, completedRequests: r.completedRequests ?? 0 };
const rows = [];
for (const r of latest.values()) {
  if (r.frontend !== 'py' || r.kind !== 'python-import') continue;
  const module = (r.message.match(/No module named '([^'.]+)/) ?? [])[1];
  const f = facts.get(r.path);
  const [role, roleNote] = roleOf(r.path);
  const names = apiNames(r.path);
  const missing = Object.keys(names).filter(n => !IMPLEMENTED.has(n) && !NOT_API.has(n)).sort();
  const nd = next.find(n => n.key === r.key && n.variant === 'dir');
  const ne = next.find(n => n.key === r.key && n.variant === 'dir+env');
  const nl = inplace.find(n => n.key === r.key) ?? deep.find(n => n.key === r.key);
  rows.push({
    path: r.path, family: r.family, representative: r.representative, lines: r.lines, role, roleNote,
    first: { module, line: r.location?.line ?? null, message: r.message },
    moduleKind: f?.imports && existsSync(join(TMP_DIR, 'src', dirname(r.path), `${module}.py`)) ? 'sibling' : null,
    nextDir: brief(nd), nextDirEnv: brief(ne), nextDirEnvLazy: nl && { ...brief(nl), source: inplace.includes(nl) ? 'in-place' : 'mirror' },
    cpythonAlsoFails: SNAPSHOT_BROKEN.test(ne?.message ?? '') || Boolean(BROKEN[r.path]),
    brokenNote: BROKEN[r.path] ?? (SNAPSHOT_BROKEN.test(ne?.message ?? '') ? 'hardware_refs.py exists only under design-review/snapshots/*/' : null),
    externalImports: (f?.imports ?? []).filter(m => ['numpy', 'scipy', 'trimesh', 'cad_khana', 'bd_warehouse', 'OCP', 'ocp_vscode', 'pytest', 'shapely', 'matplotlib', 'yaml'].includes(m)),
    b3dMissing: missing,
  });
}
const hidden = rest.filter(r => r.status !== 'frontend' && /SystemExit/.test(r.firstBlocker.message)).map(r => ({
  path: r.path, family: r.family, first: r.firstBlocker, nextDirEnv: brief(r),
  note: 'import yaml fails inside try/except ImportError, which exits with status 2; the corpus run filed it under "other" as an argparse CLI',
}));
const count = (xs, key) => xs.reduce((m, x) => { const k = key(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const out = {
  schema: 'corpus-py-imports-files/1', generatedAt: new Date().toISOString(),
  files: rows.length, byRole: count(rows, r => r.role),
  nextDir: count(rows, r => `${r.nextDir?.status}/${r.nextDir?.kind}`),
  nextDirEnv: count(rows, r => `${r.nextDirEnv?.status}/${r.nextDirEnv?.kind}`),
  nextDirEnvModels: count(rows.filter(r => r.role === 'model'), r => r.nextDirEnv?.message.replace(/^NameError: name '([^']+)'.*/, 'build123d.$1 (wildcard NameError)').replace(/ is not implemented.*| is disabled.*/, '')),
  nextDirEnvLazy: count(rows, r => `${r.nextDirEnvLazy?.status}/${r.nextDirEnvLazy?.kind}`),
  nextDirEnvLazyModels: count(rows.filter(r => r.role === 'model'), r => r.nextDirEnvLazy ? r.nextDirEnvLazy.message.replace(/ is not implemented.*| is disabled.*/, '') : '(not run)'),
  rows, hidden,
};
writeFileSync(join(OUT_DIR, 'py-imports-files.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ files: out.files, byRole: out.byRole, nextDir: out.nextDir, nextDirEnv: out.nextDirEnv, nextDirEnvModels: out.nextDirEnvModels, nextDirEnvLazy: out.nextDirEnvLazy, nextDirEnvLazyModels: out.nextDirEnvLazyModels, hidden: hidden.length }, null, 1));
