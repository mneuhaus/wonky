// Enumerate Marc's CAD corpus (~/Workspace/cad, strictly read-only).
// Skips vendored/generated trees: hidden directories (.venv, .deps, .git, ...),
// node_modules, vendor, site-packages, __pycache__, venv.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

export const CORPUS_ROOT = process.env.WONKY_CORPUS_ROOT ?? join(homedir(), 'Workspace', 'cad');
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'site-packages', '__pycache__', 'venv', 'dist-packages']);

export function listCorpus(extensions, root = CORPUS_ROOT) {
  const out = [];
  const visit = dir => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) visit(path); continue; }
      if (!e.isFile()) continue;
      const ext = extensions.find(x => e.name.endsWith(x));
      if (ext) out.push(path);
    }
  };
  visit(root);
  return out.sort().map(path => {
    const source = readFileSync(path, 'utf8');
    const stat = statSync(path);
    const rel = relative(root, path);
    return {
      path: rel, abs: path, project: rel.split('/')[0], source,
      sha: createHash('sha256').update(source).digest('hex').slice(0, 16),
      lines: source.length ? source.split('\n').length : 0, mtime: stat.mtimeMs,
    };
  });
}

// Near-duplicate clustering (design families): Jaccard similarity of token
// 5-shingles, union-find with the given threshold. Revisions of the same part
// (r19 -> r20, variant copies) collapse into one family.
export function clusterFamilies(files, tokensOf, threshold = 0.6) {
  const shingles = files.map(f => {
    const toks = tokensOf(f);
    const set = new Set();
    for (let i = 0; i + 5 <= toks.length; i++) set.add(toks.slice(i, i + 5).join('\u0001'));
    if (!set.size && toks.length) set.add(toks.join('\u0001'));
    return set;
  });
  const parent = files.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const unite = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let i = 0; i < files.length; i++) {
    const a = shingles[i]; if (!a.size) continue;
    for (let j = i + 1; j < files.length; j++) {
      const b = shingles[j]; if (!b.size) continue;
      const small = a.size < b.size ? a : b, large = small === a ? b : a;
      if (small.size / large.size < threshold) continue; // Jaccard upper bound
      let inter = 0;
      for (const x of small) if (large.has(x)) inter++;
      const jac = inter / (a.size + b.size - inter);
      if (jac >= threshold) unite(i, j);
    }
  }
  return files.map((_, i) => find(i));
}
