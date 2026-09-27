// Splits a law area (LAWS.bend + PROOF.bend) into its header and per-law blocks,
// so one law can be checked in isolation (timing, proof size, mutant attribution).
//
// LAWS.bend: the header is everything before the first `law`; a law block runs
//   from `law name:` to the first blank line.
// PROOF.bend: the header is everything before the first `def Laws.`; a proof
//   block runs from `def Laws.name(` to the next top-level `def Laws.` or `# ---`
//   separator (trailing blank lines dropped).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function splitLaws(text) {
  const lines = text.split('\n');
  const first = lines.findIndex(l => /^law /.test(l));
  const header = lines.slice(0, first).join('\n');
  const laws = new Map();
  for (let i = first; i < lines.length; i++) {
    const m = /^law (\w+):/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== '') j++;
    laws.set(m[1], lines.slice(i, j).join('\n'));
    i = j;
  }
  return { header, laws };
}

export function splitProof(text) {
  const lines = text.split('\n');
  const first = lines.findIndex(l => /^def Laws\./.test(l));
  const header = lines.slice(0, first).join('\n');
  const proofs = new Map();
  for (let i = first; i < lines.length; i++) {
    const m = /^def Laws\.(\w+)\(/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !/^def Laws\./.test(lines[j]) && !/^# ---/.test(lines[j])) j++;
    let end = j;
    while (end > i && lines[end - 1].trim() === '') end--;
    proofs.set(m[1], lines.slice(i, end).join('\n'));
    i = j - 1;
  }
  return { header, proofs };
}

// Writes <outDir>/LAWS.bend and <outDir>/PROOF.bend holding only `names`.
// outDir must sit at the same depth as the source area so relative imports resolve.
export function writeSubset(srcDir, outDir, names) {
  const { header: lh, laws } = splitLaws(readFileSync(join(srcDir, 'LAWS.bend'), 'utf8'));
  const { header: ph, proofs } = splitProof(readFileSync(join(srcDir, 'PROOF.bend'), 'utf8'));
  for (const n of names) {
    if (!laws.has(n)) throw new Error(`no law ${n} in ${srcDir}/LAWS.bend`);
    if (!proofs.has(n)) throw new Error(`no proof def Laws.${n} in ${srcDir}/PROOF.bend`);
  }
  const bodies = names.map(n => proofs.get(n)).join('\n\n');
  // Bend checks every definition of every imported module, so a lemma module
  // the chosen proofs never use would still be checked (and blamed). Drop those.
  const header = ph.split('\n').filter(line => {
    const m = /^import \S*lemmas\.bend as (\w+)$/.exec(line);
    return !m || new RegExp(`\\b${m[1]}\\.`).test(bodies);
  }).join('\n');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'LAWS.bend'), `${lh}\n${names.map(n => laws.get(n)).join('\n\n')}\n`);
  writeFileSync(join(outDir, 'PROOF.bend'), `${header}\n${bodies}\n`);
}
