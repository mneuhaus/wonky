#!/usr/bin/env node
// Compile every ```bend block of the wonky Bend docs with the pinned compiler and
// compare the outcome with the block's leading directive comments.
//
//   node docs/bend/check-snippets.mjs                       all docs
//   node docs/bend/check-snippets.mjs docs/bend/guide.md    one doc
//
// Directives (comment lines at the top of a block, any order):
//   # expect: ok                    --check-only prints exactly "All terms check." (the default)
//   # expect: error <text>          --check-only fails and its output contains <text>
//   # expect: unsafe <text>         exit 0, verdict "... on unsafe or foreign code" contains <text>
//   # expect-c: ok | error <text>   also emits C with `-o out/<name>.c`
//   # expect-run: <text>            also runs `bend <file>` (JS lane); stdout contains <text>
//   # expect-native: <text>         also builds `-o out/<name>` and runs `--threads 1 --gpu off`
// Imports written `import ./x.bend as X` resolve as if the block lived in kernel/
// (the path is rewritten to the real kernel file).
// Blocks are written to tmp/bend-docs-check/<doc>-<nn>.bend and the report to
// tmp/bend-docs-check/results.txt (BEND_DOCS_CHECK_OUT=<dir> picks another directory;
// full compiler output per check goes to <dir>/full.txt). The loader cache (.tools/bend-js-cache) is never
// touched: this calls the pinned compiler binary only.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const bend = join(root, '.tools', 'bend-2.0.25', 'bin', 'bend');
const outDir = process.env.BEND_DOCS_CHECK_OUT ? resolve(process.env.BEND_DOCS_CHECK_OUT) : join(root, 'tmp', 'bend-docs-check');
mkdirSync(join(outDir, 'out'), { recursive: true });
const docs = process.argv.slice(2).length ? process.argv.slice(2) : [
  'docs/bend/guide.md', 'docs/bend/syntax.md', '.claude/skills/wonky-bend/SKILL.md'];
const env = { ...process.env, BEND_NO_TELEMETRY: '1' };
const kernelRel = relative(outDir, join(root, 'kernel'));

function run(args, opts = {}) {
  const r = spawnSync(args[0], args.slice(1), { cwd: outDir, env, encoding: 'utf8', timeout: 180000, ...opts });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function directives(src) {
  const d = {};
  for (const line of src.split('\n')) {
    const m = line.match(/^# (expect(?:-c|-run|-native)?): ?(.*)$/);
    if (m) d[m[1]] = m[2].trim(); else if (line.trim() && !line.startsWith('#')) break;
  }
  d.expect ??= 'ok';
  return d;
}

function rewrite(src) {
  return src.replace(/^import \.\/(\S+\.bend) as (\S+)$/gm, (all, path, alias) => {
    const target = join(root, 'kernel', path);
    return existsSync(target) ? `import ${kernelRel}/${path} as ${alias}` : all;
  });
}

function judge(want, res) {
  if (want === 'ok') return res.code === 0 && res.out.split('\n').at(-1) === 'All terms check.';
  const [kind, ...rest] = want.split(' ');
  const text = rest.join(' ');
  if (kind === 'error') return res.code !== 0 && res.out.includes(text);
  if (kind === 'unsafe') return res.code === 0 && res.out.includes('on unsafe or foreign code') && res.out.includes(text);
  return false;
}

let bad = 0, total = 0;
const log = [], full = [];
for (const doc of docs) {
  const text = readFileSync(join(root, doc), 'utf8');
  const blocks = [...text.matchAll(/```bend\n([\s\S]*?)```/g)].map(m => m[1]);
  const tag = basename(doc, '.md').toLowerCase();
  blocks.forEach((src, i) => {
    total++;
    const name = `${tag}-${String(i + 1).padStart(2, '0')}`;
    const file = `${name}.bend`;
    writeFileSync(join(outDir, file), rewrite(src));
    const d = directives(src);
    const checks = [];
    const chk = run([bend, file, '--check-only']);
    checks.push(['check', d.expect, judge(d.expect, chk), chk.out]);
    if (d['expect-c']) {
      const c = run([bend, file, '-o', `out/${name}.c`]);
      checks.push(['emit-c', d['expect-c'], d['expect-c'] === 'ok' ? c.code === 0 : judge(d['expect-c'], c), c.out]);
    }
    if (d['expect-run']) {
      const r = run([bend, file]);
      checks.push(['run-js', d['expect-run'], r.code === 0 && r.out.includes(d['expect-run']), r.out]);
    }
    if (d['expect-native']) {
      const b = run([bend, file, '-o', `out/${name}`]);
      const r = b.code === 0 ? run([join(outDir, 'out', name), '--threads', '1', '--gpu', 'off']) : b;
      checks.push(['run-cpu1', d['expect-native'], r.code === 0 && r.out.includes(d['expect-native']), r.out]);
    }
    for (const [what, want, ok, out] of checks) {
      if (!ok) bad++;
      const first = out.split('\n').filter(l => /^- (expected|observed|message)|All terms|^Error|^bend:/.test(l) || !l.startsWith(' ')).slice(0, 3).join(' | ');
      log.push(`${ok ? 'PASS' : 'FAIL'} ${doc} ${name} ${what} [${want}] ${first.slice(0, 200)}`);
      full.push(`===== ${name} ${what} [${want}] ${ok ? 'PASS' : 'FAIL'}\n${out}`);
    }
  });
}
const report = `${log.join('\n')}\n${total} blocks, ${bad} failing checks\n`;
writeFileSync(join(outDir, 'results.txt'), report);
writeFileSync(join(outDir, 'full.txt'), `${full.join('\n')}\n`);
process.stdout.write(report);
process.exit(bad ? 1 : 0);
