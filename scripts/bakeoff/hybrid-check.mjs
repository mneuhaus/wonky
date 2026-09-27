#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE: checks that the "hybrid" prototype
// (kernel/hybrid/main.bend) is corefine followed by recover, byte for byte.
//
//   node scripts/bakeoff/hybrid-check.mjs --hybrid <results dir>
//     --corefine <results dir> --recover <results dir> [--out <file.json>]
//
// Every <id>.<target>.result in --hybrid is compared with corefine's result
// of the same case (same target if present, else any target: corefine's four
// targets are byte-identical) and recover's result on it:
//   corefine unresolved      -> the hybrid text is corefine's text;
//   recover ok               -> `exact\n` + recover's text after `ok\n`;
//   recover unresolved <r>   -> recover's text (class `unresolved`: the mesh
//                               is not certified), or `mesh <dev> <r>\n` +
//                               corefine's text after `ok\n` (class `mesh`),
//                               <dev> the job deviation's words.
// The class of a recover refusal is the hybrid's own decision (recover's
// BCert / BNo, kernel/hybrid/recover/topo.bend); it is reported per case.
// The hybrid's targets must agree byte for byte. Nothing is recomputed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = ['cpu1', 'cpuN', 'metal', 'js'];

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  for (const k of ['hybrid', 'corefine', 'recover']) if (!o[k]) throw new Error(`--${k} <results dir> is required`);
  return o;
}

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
function pick(dir, id, target) {
  const own = read(path.join(dir, `${id}.${target}.result`));
  if (own !== null) return { text: own, target };
  for (const t of TARGETS) {
    const x = read(path.join(dir, `${id}.${t}.result`));
    if (x !== null) return { text: x, target: t };
  }
  return null;
}
const firstLine = (s) => s.slice(0, s.indexOf('\n') < 0 ? s.length : s.indexOf('\n'));

// The expected hybrid text(s) of one case, from the two prototypes' results.
export function expectedHybrid(corefine, recover) {
  if (!corefine.startsWith('ok\n')) return { kind: 'corefine-unresolved', texts: [corefine] };
  if (recover === null) return { kind: 'no-recover', texts: [] };
  if (recover.startsWith('ok\n')) return { kind: 'exact', texts: [`exact\n${recover.slice(3)}`] };
  const reason = firstLine(recover).replace(/^unresolved /, '');
  return { kind: 'recover-refused', reason, texts: [recover], meshBody: corefine.slice(3) };
}

export function checkOne(hybrid, corefine, recover) {
  const e = expectedHybrid(corefine, recover);
  if (e.kind !== 'recover-refused') return { kind: e.kind, ok: e.texts.includes(hybrid), cls: e.kind === 'exact' ? 'exact' : 'unresolved' };
  if (hybrid === e.texts[0]) return { kind: e.kind, ok: true, cls: 'unresolved', reason: e.reason };
  const m = /^mesh (\d+) (\d+) (.*)\n/.exec(hybrid);
  const ok = !!m && m[3] === e.reason && hybrid.slice(m[0].length) === e.meshBody;
  return { kind: e.kind, ok, cls: 'mesh', reason: e.reason, dev: m ? [m[1], m[2]] : null };
}

function main(argv) {
  const o = args(argv);
  const files = fs.readdirSync(o.hybrid).filter((f) => f.endsWith('.result')).sort();
  const byCase = new Map();
  for (const f of files) {
    const m = /^(.*)\.(cpu1|cpuN|metal|js)\.result$/.exec(f);
    if (!m) continue;
    if (!byCase.has(m[1])) byCase.set(m[1], {});
    byCase.get(m[1])[m[2]] = fs.readFileSync(path.join(o.hybrid, f), 'utf8');
  }
  const rep = { hybrid: o.hybrid, corefine: o.corefine, recover: o.recover, cases: 0, files: 0, identical: 0, differ: 0, missing: 0,
    targetsDisagree: [], classes: { exact: 0, mesh: 0, 'unresolved-corefine': 0, 'unresolved-recover': 0 }, differences: [], refusals: [] };
  for (const [id, byTarget] of byCase) {
    rep.cases++;
    const texts = Object.values(byTarget);
    if (!texts.every((t) => t === texts[0])) rep.targetsDisagree.push(id);
    let caseCls = null;
    for (const [target, text] of Object.entries(byTarget)) {
      rep.files++;
      const c = pick(o.corefine, id, target);
      const r = pick(o.recover, id, target);
      if (!c) { rep.missing++; rep.differences.push({ id, target, why: 'no corefine result' }); continue; }
      const res = checkOne(text, c.text, r?.text ?? null);
      if (res.ok) rep.identical++;
      else { rep.differ++; rep.differences.push({ id, target, kind: res.kind, hybrid: firstLine(text).slice(0, 160) }); }
      caseCls = res.kind === 'corefine-unresolved' ? 'unresolved-corefine' : res.kind === 'recover-refused' ? (res.cls === 'mesh' ? 'mesh' : 'unresolved-recover') : res.cls;
      if (res.kind === 'recover-refused' && target === Object.keys(byTarget)[0]) rep.refusals.push({ id, class: res.cls, reason: res.reason.slice(0, 200) });
    }
    if (caseCls && rep.classes[caseCls] !== undefined) rep.classes[caseCls]++;
  }
  const line = `${rep.cases} cases, ${rep.files} files: ${rep.identical} identical, ${rep.differ} differ, ${rep.missing} without a corefine result; targets disagree on ${rep.targetsDisagree.length}; classes ${JSON.stringify(rep.classes)}`;
  console.log(line);
  for (const d of rep.differences.slice(0, 20)) console.log('  DIFF', JSON.stringify(d));
  if (o.out) fs.writeFileSync(o.out, JSON.stringify(rep, null, 1) + '\n');
  process.exitCode = rep.differ || rep.missing || rep.targetsDisagree.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2));
