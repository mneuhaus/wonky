// WPy vocabulary vs build123d vocabulary, and bracket size in each form.
//   node scripts/lang/surface-vocab.mjs  -> out/lang/surface/vocab.json
import { readFileSync, writeFileSync } from 'node:fs';
import { Evaluator } from '../../src/lang/surface/eval.mjs';

const b3d = JSON.parse(readFileSync('fixtures/lang/b3d-vocab.json', 'utf8'));
const b3dNames = new Set(Object.keys(b3d.categories));
const ev = new Evaluator({ file: 'vocab' });
const wpy = [...ev.builtins.get('__wonky__').attrs.keys()];
const inB3d = wpy.filter(n => b3dNames.has(n));
const wonkyOnly = wpy.filter(n => !b3dNames.has(n));
// lexical size, same counting rule as out/lang/prior-art/count.mjs (comments stripped)
const count = (path, py) => {
  let src = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  src = py ? src.replace(/"""[\s\S]*?"""/g, '').replace(/#.*$/gm, '') : src.replace(/\/\/.*$/gm, '');
  return { lines: src.split('\n').filter(l => l.trim()).length, lexTokens: (src.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|"[^"]*"|\S/g) || []).length };
};
const out = {
  build123dVersion: b3d.version,
  wpyNames: wpy.length, inBuild123d: inB3d.length, wonkyOnly,
  bracket: {
    featureScript: count('examples/bracket.fs', false),
    build123d: count('out/lang/prior-art/bracket.py', true),
    wpy: count('fixtures/lang/surface/bracket.py', true),
    emittedFeatureScript: count('out/lang/surface/examples/bracket.emitted.fs', false),
  },
};
writeFileSync('out/lang/surface/vocab.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
