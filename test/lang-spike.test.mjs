import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("lang-spike.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { execFileSync } = await import("node:child_process");
const { existsSync, readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const { compile, compileToStream, encode, explainError, splitReal, CoreCompileError } = await import("../src/lang/spike-compile.mjs");
const { evaluate } = await import("../src/lang/spike-eval.mjs");
const { tokenSummary } = await import("../src/lang/token-summary.mjs");
const { tokenize } = await import("../src/parser.mjs");
// Focused tests of the Bend core-language spike (docs/language/bend-feasibility.md).
// The native checks run only when out/lang/spike/build/main exists (built by
// `node scripts/lang/spike-bench.mjs --build`); they are skipped explicitly
// otherwise, never faked.










const root = fileURLToPath(new URL('../', import.meta.url));
const native = `${root}out/lang/spike/build/main`;
const example = name => readFileSync(`${root}kernel/lang/spike/examples/${name}.core`, 'utf8');
const f32 = bits => { const b = Buffer.alloc(4); b.writeUInt32LE(bits >>> 0); return b.readFloatLE(); };
const run = (...args) => JSON.parse(execFileSync(native, ['--threads', '1', '--gpu', 'off', '--', ...args], { env: { ...process.env, BEND_NO_TELEMETRY: '1' } }).toString().trim().split('\n').at(-1));

test('numbers are encoded as exact F32x2 words', () => {
  for (const x of [0, 1, -1, 0.1, 12.5, -1e-3, 2666466670000, 1 / 3]) {
    const { hi, lo } = splitReal(x);
    const ints = encode({ t: 'num', v: x });
    assert.equal(ints[0], 0);
    const word = (s, m, e) => (s ? -1 : 1) * m * 2 ** (e - 200);
    assert.equal(word(...ints.slice(1, 4)), hi);
    assert.equal(word(...ints.slice(4, 7)), lo);
    assert.ok(Math.abs(hi + lo - x) <= Math.abs(x) * 2 ** -44);
  }
});

test('names resolve to de Bruijn indices; recursion binds itself below the arguments', () => {
  const { ast } = compile('(def f (a b) (- a b)) (f 5 3)');
  assert.deepEqual(ast.x, { t: 'rec', arity: 2, body: { t: 'prim', span: 1, op: 1, args: [{ t: 'var', i: 1 }, { t: 'var', i: 0 }] } });
  assert.throws(() => compile('(g 1)'), CoreCompileError);
  assert.throws(() => compile('(def a () (b)) (def b () 1) (a)'), /unbound name 'b'/);
});

test('the JS reference evaluator runs the example programs', () => {
  assert.equal(evaluate(compile(example('fib')).ast).value, 17711);
  // 500 instead of 5000 elements: the JS reference recurses on the JS stack
  // (the Bend evaluator has no C stack and runs the 5000 case natively).
  const small = example('lists').replace('(range 0 5000)', '(range 0 500)').replace('(nth xs 4999)', '(nth xs 499)');
  assert.deepEqual(evaluate(compile(small).ast).value, [500, 41541750, 249001]);
});

test('an evaluation error maps back to its source span and call trace', () => {
  const { ast, spans } = compile('(def g (x) (+ x "a"))\n(def h (x) (g x))\n(h 1)');
  const { value } = evaluate(ast);
  const e = explainError(value, spans);
  assert.equal(e.kind, 'type');
  assert.deepEqual([e.at.line, e.at.column, e.at.label], [1, 12, '+']);
  assert.deepEqual(e.trace.map(s => s.label), ['h', 'g']);
});

test('token summary equals the JS tokenizer on a real fixture', () => {
  const source = readFileSync(`${root}fixtures/cadbench/adapted/cup.fs`, 'utf8');
  const s = tokenSummary(source, tokenize(source));
  assert.equal(s.tokens, tokenize(source).length - 1);
});

test('native evaluator agrees with the JS reference and the direct kernel calls', { skip: existsSync(native) ? false : 'native spike not built' }, () => {
  const fib = compileToStream(example('fib'));
  const v = run('pure-arg', fib.text, '100000000', '1').value;
  assert.equal(f32(v.hi) + f32(v.lo), 17711);
  const prelude = example('prelude');
  const union = compileToStream(`${prelude}\n${example('planar-union')}`);
  const got = run('eval-arg', union.text, '100000000', '1').value.at(-1).body;
  const ref = run('ref', '3', '1').value.body;
  assert.deepEqual(got, ref);
  assert.equal(f32(got.hiBits) + f32(got.loBits), 15500.000000000007);
  const bad = compileToStream(`${prelude}\n${example('error-type')}`, { file: 'error-type.core' });
  const e = explainError(run('eval-arg', bad.text, '100000000', '1').value, bad.spans);
  assert.equal(e.kind, 'type');
  assert.equal(e.at.label, 'union');
  assert.deepEqual(e.trace.map(s => s.label), ['build', 'tab']);
});

test('native tokenizer reproduces src/parser.mjs tokens', { skip: existsSync(native) ? false : 'native spike not built' }, () => {
  const file = `${root}fixtures/cadbench/adapted/cup.fs`;
  const source = readFileSync(file, 'utf8');
  const { bad, ...got } = run('tokenize', file, '1').summary;
  assert.equal(bad, 0);
  assert.deepEqual(got, tokenSummary(source, tokenize(source)));
});

}
