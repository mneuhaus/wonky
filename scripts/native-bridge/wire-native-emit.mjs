#!/usr/bin/env node
// Native C emission check for the generated wire surface (Bend 2.0.25 CPU C
// emitter, `bend entry.bend -o entry.c`; no clang, no binary is built or run).
//
// The JS target type-checks everything; the C emitter additionally flattens
// ADTs into words and refuses "an arity over 255" when a wide value is held
// across a non-tail call (still open upstream, see the 2.0.25 CHANGELOG). This
// script records which parts of the production surface pass that emitter:
//   1. the generated codecs + dispatcher for every production entry except
//      ports/curved-intersection.bend:intersect,
//   2. the same entry alone, through the generator,
//   3. that entry and kernel/section.bend:section called directly from a
//      hand-free entry (no generated code), to separate kernel from generator,
//   4. one generated encoder that hits the limit by itself (section PairResolution).
//
//   node scripts/native-bridge/wire-native-emit.mjs [--out out/native-bridge/wire-native-emit.json]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeGenerated, projectRoot } from './gen-wire.mjs';
import { scan } from './surface-scan.mjs';

const i = process.argv.indexOf('--out');
const outFile = resolve(projectRoot, i > 0 ? process.argv[i + 1] : 'out/native-bridge/wire-native-emit.json');
const { version } = JSON.parse(readFileSync(join(projectRoot, 'bend.lock.json'), 'utf8'));
const bend = join(projectRoot, `.tools/bend-${version}/bin/bend`);
const work = join(projectRoot, 'tmp/native-bridge/surface/native-emit');
const load = () => execFileSync('uptime', { encoding: 'utf8' }).trim();
const kernelImport = dir => relative(dir, join(projectRoot, 'kernel'));

function emit(name, entrySource) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'entry.bend'), entrySource(dir));
  const started = performance.now(), loadBefore = load();
  try {
    execFileSync(bend, ['entry.bend', '-o', 'entry.c'], { cwd: dir, env: { ...process.env, BEND_NO_TELEMETRY: '1' }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
    return { name, ok: true, ms: Math.round(performance.now() - started), cBytes: statSync(join(dir, 'entry.c')).size, loadBefore };
  } catch (error) {
    return { name, ok: false, ms: Math.round(performance.now() - started), error: String(error.stderr || error.message).trim().split('\n').pop(), loadBefore };
  }
}

// A main that reaches the generated dispatcher (so nothing is dead code).
const dispatcherEntry = dir => `import Base\nimport ./wire.bend as W\n\ndef main() -> IO(Unit):\n  IO.print(U32.show(U32.from_nat(List.length(&2, U32, W.dispatch(0, [1065353216, 0, 1073741824, 0])))))\n`;
function generated(name, types, ops) {
  const dir = join(work, name);
  const { manifest } = writeGenerated({ types, ops, outDir: dir });
  return { ...emit(name, dispatcherEntry), ops: manifest.ops.length, adts: manifest.adts.length };
}

const production = scan().entries.filter(entry => entry.production).map(entry => entry.entry.replace(/^kernel\//, ''));
const curved = 'ports/curved-intersection.bend:intersect';
const results = [];
results.push({ case: 'generated codecs + dispatcher, all production entries except curved-intersection', ...generated('all-but-curved', [], production.filter(spec => spec !== curved)) });
results.push({ case: 'generated codecs + dispatcher, curved-intersection alone', ...generated('curved-only', [], [curved]) });
results.push({ case: 'kernel only: ports/curved-intersection.bend:intersect called directly (no generated code)', ...emit('direct-curved', dir => `import Base
import ${kernelImport(dir)}/real.bend as R
import ${kernelImport(dir)}/analytic.bend as A
import ${kernelImport(dir)}/intersections.bend as I
import ${kernelImport(dir)}/ports/curved-intersection.bend as CI

def tag(p: CI.IntersectionResult) -> U32:
  match p:
    case CI.Bodies{_, _, _, _}:
      0
    case CI.Unresolved{_, _, _, _, _, _}:
      1

def main() -> IO(Unit):
  +z = R.from_f32(0.0)
  IO.print(U32.show(tag(CI.intersect(A.Solid{[], [], []}, [], z, A.Solid{[], [], []}, [], z, I.Tolerance{R.from_f32(0.0000001), R.from_f32(0.0000000001)}, CI.StrictTransverse{}))))
`) });
results.push({ case: 'kernel only: section.bend:section called directly (reached by ports/curved.bend:clip)', ...emit('direct-section', dir => `import Base
import ${kernelImport(dir)}/real.bend as R
import ${kernelImport(dir)}/precise.bend as G
import ${kernelImport(dir)}/analytic.bend as A
import ${kernelImport(dir)}/intersections.bend as I
import ${kernelImport(dir)}/section.bend as S

def tag(p: S.SectionResult) -> U32:
  match p:
    case S.Resolved{_, _, _, _, _, _, _}:
      0
    case S.Failed{_, _}:
      1

def main() -> IO(Unit):
  IO.print(U32.show(tag(S.section(A.Solid{[], [], []}, [], G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 1.0), I.Tolerance{R.from_f32(0.0000001), R.from_f32(0.0000000001)}, R.from_f32(0.0)))))
`) });
results.push({ case: 'generated encoder alone: section.bend:PairResolution (two nested EndpointRef held across a non-tail call)', ...(() => {
  const dir = join(work, 'encoder-pair');
  writeGenerated({ types: ['section.bend:PairResolution'], ops: [], outDir: dir });
  return emit('encoder-pair', () => `import Base\nimport ./wire.bend as W\nimport ${kernelImport(dir)}/section.bend as K\n\ndef fst(p: K.PairResolution & W.Cursor) -> K.PairResolution:\n  (x, _) = p\n  x\n\ndef main() -> IO(Unit):\n  IO.print(U32.show(U32.from_nat(List.length(&2, U32, W.enc_section_PairResolution(fst(W.dec_section_PairResolution(W.start([0, 0, 0, 0]))), Nil{})))))\n`);
})() });
const report = { schema: 'wonky-native-wire-emit/1', generator: 'scripts/native-bridge/wire-native-emit.mjs', bend: version, emitter: 'bend <entry> -o <entry>.c (CPU C emission only; nothing compiled with clang or run)', results, loadAfter: load() };
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(report, null, 1) + '\n');
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${String(r.ms).padStart(6)} ms  ${r.case}${r.ok ? ` (${r.cBytes} bytes C)` : `: ${r.error}`}`);
