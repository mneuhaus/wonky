import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("lang-surface.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { existsSync, readFileSync } = await import("node:fs");
const { parse } = await import("../src/lang/surface/parse.mjs");
const { checkModule } = await import("../src/lang/surface/check.mjs");
const { evaluateWpy } = await import("../src/lang/surface/eval.mjs");
const { preflightWpy, buildWpy } = await import("../src/lang/surface/index.mjs");
const { diffGraphs } = await import("../src/lang/surface/graph.mjs");
const { emitFeatureScript } = await import("../src/lang/surface/emit-fs.mjs");
const { floatRepr, formatValue, pyRound, WpyError } = await import("../src/lang/surface/values.mjs");
const { build } = await import("../src/index.mjs");
const { geometryRevision } = await import("../src/identity.mjs");
const { NATIVE_BINARY, runNative } = await import("../src/lang/surface/backend-native.mjs");
// Focused tests of the WPy prototype (docs/language/proposal-surface.md).
// Fast: no Boolean kernel runs; the bracket extrusion is the only JS-target
// kernel call, and the native case is skipped when the spike binary is absent.














const run = src => evaluateWpy(`from wonky import *\n${src}`, { file: 't.py' });
const value = (src, name = 'x') => run(src).module.vars.get(name);

test('parser: full Python statement grammar with spans, WPy subset decided separately', () => {
  const ast = parse('class A:\n    pass\nwith BuildPart() as p:\n    Box(1, 2, 3)\nx = [e for e in s if e.center().Z > 2]\nf"{x!r:>10}"\n');
  assert.deepEqual(ast.body.map(s => s.k), ['ClassDef', 'With', 'Assign', 'Expr']);
  assert.equal(ast.body[2].span.line, 5);
  const checked = checkModule(ast);
  assert.equal(checked.verdict, 'reject');
  assert.deepEqual(Object.keys(checked.rules).sort(), ['builder', 'class']);
  assert.equal(checkModule(parse('from build123d import *\nimport math\nif __name__ == "__main__":\n    import os\n')).verdict, 'accept');
});

test('value layer follows CPython: ints, floats, floor division, round, repr, format', () => {
  assert.equal(value('x = 7 // -2'), -4n);
  assert.equal(value('x = -7 % 3'), 2n);
  assert.equal(value('x = -7.5 % 2'), 0.5);
  assert.equal(value('x = 2 ** 64'), 18446744073709551616n);
  assert.equal(value('x = 0.1 + 0.2'), 0.30000000000000004);
  assert.equal(value('x = round(2.5)'), 2n);
  assert.equal(value('x = round(2.675, 2)'), 2.67);
  assert.equal(value('x = f"{1e16} {3.0} {0.1 + 0.2:.3f} {12:>5}|"'), '1e+16 3.0 0.300    12|');
  assert.equal(value('x = str([1, 2.0, "a", (3,)])'), "[1, 2.0, 'a', (3,)]");
  assert.equal(floatRepr(1e-5), '1e-05');
  assert.equal(floatRepr(123456789012345680), '1.2345678901234568e+17');
  assert.equal(formatValue(1234567.891, ',.2f'), '1,234,567.89');
  assert.equal(pyRound(0.125, 2), 0.12);
  // aliasing and closures behave as in Python
  assert.equal(value('a = []\nb = a\nb.append(1)\nx = len(a)'), 1n);
  assert.equal(value('def mk():\n    n = 1\n    def get():\n        return n\n    n = 2\n    return get\nx = mk()()'), 2n);
});

test('stable ids: binding names and loop indices, independent of unrelated insertions', () => {
  const base = 'stock = Box(50, 40, 10, align=Align.MIN)\nfor i in range(2):\n    stock -= Pos(10 + 20 * i, 5, 5) * Box(5, 5, 20)\nresult = stock\n';
  const g0 = run(base).graph, g1 = run(`washer = Box(5, 5, 2)\n${base}`).graph;
  assert.deepEqual(g0.nodes.map(n => n.id), ['stock/box', 'stock[0]/box', 'stock[0]/move', 'stock[0]/subtract', 'stock[1]/box', 'stock[1]/move', 'stock[1]/subtract']);
  const d = diffGraphs(g0, g1);
  assert.equal(d.changed.length + d.removed.length, 0);
  assert.deepEqual(d.added, ['washer/box']);
  // a parameter edit changes hashes only downstream of the edit
  const g2 = run(base.replace('10 + 20 * i', '12 + 20 * i')).graph;
  assert.deepEqual(diffGraphs(g0, g2).unchanged, ['stock/box', 'stock[0]/box', 'stock[1]/box']);
});

test('comprehension filters over edges lower to declarative in-kernel predicates', () => {
  const g = run('p = Box(20, 20, 10)\nroots = [e for e in p.edges().filter_by(Axis.Y) if abs(e.center().X) < 3 and 2 < e.center().Z < 9]\nresult = fillet(roots, 1)\n').graph;
  const sel = g.nodes.find(n => n.op === 'select');
  assert.equal(sel.params.predicate.op, 'and');
  assert.equal(g.syncPoints.length, 0);
  assert.deepEqual(g.nodes.map(n => n.op), ['box', 'entities', 'filter', 'select', 'fillet']);
  // helper functions are evaluated symbolically, so the predicate still lowers
  const h = run('def high(e):\n    return e.center().Z > 1\np = Box(20, 20, 10)\nroots = [e for e in p.edges() if high(e)]\nresult = p\n').graph;
  assert.equal(h.syncPoints.length, 0);
  assert.equal(h.nodes.find(n => n.op === 'select').params.predicate.cmp, '>');
  // a predicate outside the declarative vocabulary is kept opaque and reported as a sync point
  const k = run('p = Box(20, 20, 10)\nroots = [e for e in p.edges() if e.center().Z in (0, 10)]\nresult = p\n').graph;
  assert.equal(k.syncPoints.length, 1);
  assert.equal(k.nodes.find(n => n.op === 'select').params.predicate.op, 'host');
});

test('measures stay lazy inside expect(); total Booleans need no emptiness guards', () => {
  const g = run('p = Box(10, 10, 10)\nexpect(abs(p.volume - 1000) < 1e-9, "volume")\nacc = Part()\nfor k in range(2):\n    acc += Pos(20 * k, 0, 0) * p\nresult = acc\n').graph;
  assert.equal(g.checks.length, 1);
  assert.equal(g.syncPoints.length, 0);
  assert.equal(g.nodes.filter(n => n.op === 'union').length, 1);
});

test('errors carry spans, call traces and hints; capability errors are never caught', () => {
  const src = 'from wonky import *\ndef lug(w):\n    return Box(w, 10, 4)\ntry:\n    result = lug("ten")\nexcept Exception:\n    result = Box(1, 1, 1)\nimport numpy\n';
  assert.throws(() => evaluateWpy(src, { file: 'p.py' }), e => e instanceof WpyError && e.kind === 'capability' && e.span.line === 8 && /numpy-lite/.test(e.hint));
  try { evaluateWpy('from wonky import *\ndef lug(w):\n    return Box(w, 10, 4)\nresult = lug("ten")\n', { file: 'p.py' }); assert.fail(); }
  catch (e) {
    assert.equal(e.kind, 'model');
    assert.match(e.format('from wonky import *\ndef lug(w):\n    return Box(w, 10, 4)\nresult = lug("ten")\n'), /p\.py:3:12: model error: expected a number, got str[\s\S]*in lug called at 4:10/);
  }
});

test('unmodified build123d frame-with-tab is WPy; bracket.py equals examples/bracket.fs up to FeatureScript\'s mm conversion noise, and its emitted FeatureScript builds the FS bracket', async () => {
  const fwt = readFileSync('fixtures/performance-build123d/cases/frame-with-tab.py', 'utf8');
  const g = preflightWpy(fwt, { file: 'frame-with-tab.py' }).graph;
  assert.deepEqual(g.nodes.map(n => `${n.id}:${n.op}`), ['stock/box:box', 'opening/box:box', 'opening/move:move', 'frame/subtract:subtract', 'tab/box:box', 'tab/move:move', 'result/union:union']);
  const wpy = await buildWpy(readFileSync('fixtures/lang/surface/bracket.py', 'utf8'), { file: 'bracket.py' });
  const fs = await build(readFileSync('examples/bracket.fs', 'utf8'), { feature: 'bracket' });
  assert.equal(wpy.bodies[0].validation.volumeMm3, 8832);
  assert.equal(fs.bodies[0].validation.volumeMm3, 8832);
  assert.deepEqual(wpy.failedChecks, []);
  // Since the W2 re-baseline the polyhedral path is F32x2 and keeps every host
  // coordinate exactly. FeatureScript's 18 * millimeter is 18.000000000000004 mm
  // in binary64 (the metre -> mm conversion); WPy's 18 is 18. The F32 contract
  // used to round both to 18, so the revisions were equal; now they differ by
  // exactly that conversion noise and nothing else.
  const dx = (a, b) => a.vertices.flatMap((v, i) => v.map((x, k) => Math.abs(x - b.vertices[i][k])));
  assert.equal(wpy.bodies[0].vertices.length, fs.bodies[0].vertices.length);
  assert.deepEqual([...new Set(dx(wpy.bodies[0], fs.bodies[0]))].sort(), [0, 18.000000000000004 - 18]);
  assert.ok(fs.bodies[0].vertices.some(v => v[0] === 18.000000000000004) && wpy.bodies[0].vertices.some(v => v[0] === 18));
  // the emitted FeatureScript is FeatureScript again: it builds today's FS bracket exactly
  const emitted = await build(emitFeatureScript(wpy.graph, { feature: 'wpyBracket' }), { feature: 'wpyBracket' });
  assert.equal(geometryRevision(emitted.bodies[0]), geometryRevision(fs.bodies[0]));
});

test('native backend: WPy graph runs on the existing spike binary without a Bend compile', { skip: !existsSync(NATIVE_BINARY) }, async () => {
  const g = preflightWpy(readFileSync('fixtures/lang/surface/bracket.py', 'utf8'), { file: 'bracket.py' }).graph;
  const r = await runNative(g, { threads: 1 });
  assert.equal(r.outputs[0].volume, 8832);
  assert.equal(r.outputs[0].faces, 8);
  const pockets = preflightWpy(readFileSync('fixtures/lang/surface/pockets.py', 'utf8'), { file: 'pockets.py' }).graph;
  const { program } = await import('../src/lang/surface/backend-native.mjs').then(m => m.lowerGraph(pockets));
  assert.match(program, /^\(par \(par /m);
});

}
