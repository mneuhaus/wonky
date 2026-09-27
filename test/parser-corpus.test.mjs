import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("parser-corpus.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync } = await import("node:fs");
const { parse, parseExpression, tokenize } = await import("../src/parser.mjs");
const { build } = await import("../src/index.mjs");
const { FeatureScriptError, UnsupportedFeatureError } = await import("../src/errors.mjs");
// Parser gaps found by the corpus run (docs/corpus/run.md §3.11, W1 package
// "parser" in docs/corpus-triage.md §6). Syntax follows the Onshape FsDoc
// language reference: tokens.html (string escapes), exceptions.html (try
// statement forms) and syntax.html (for-in over arrays and maps).







const header = 'FeatureScript 2909; import(path:"onshape/std/geometry.fs",version:"2909.0");';
const feature = body => `${header} export function main(context is Context,id is Id,definition is map){${body}}`;
const box = 'fCuboid(context,id+"b",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(10,20,30)*millimeter});';
const bodyOf = source => parse(feature(source)).declarations[0].value.body.statements;
const repro = name => readFileSync(new URL(`../fixtures/corpus-repro/${name}`, import.meta.url), 'utf8');
const volumes = model => model.bodies.map(body => Math.round(body.validation.volumeMm3));

test('string literals that spell keywords or operators stay string values', () => {
  const kinds = tokenize('"function" \'-\' "try" function -').map(t => [t.kind, t.value]);
  assert.deepEqual(kinds.slice(0, 5), [['string', 'function'], ['string', '-'], ['string', 'try'], ['name', 'function'], ['symbol', '-']]);
  const map = parseExpression('{ "id" : "a", "kind" : "function" }');
  assert.deepEqual(map.fields.map(([key, value]) => [key.value, value.kind, value.value]), [['id', 'literal', 'a'], ['kind', 'literal', 'function']]);
  const call = parseExpression('join("a", "-", "b")');
  assert.deepEqual(call.args.map(arg => arg.value), ['a', '-', 'b']);
  // A leading string "-" is a literal operand, not unary minus.
  const joined = parseExpression('"-" ~ "x"');
  assert.deepEqual([joined.kind, joined.operator, joined.left.kind, joined.left.value, joined.right.value], ['binary', '~', 'literal', '-', 'x']);
  // Keywords still work where the grammar needs them.
  assert.equal(parseExpression('function(x) { return -x; }').kind, 'function');
});

test('string escapes: C escapes and \\u with exactly four hex digits', () => {
  const value = source => tokenize(source)[0].value;
  assert.equal(value(String.raw`"Smile \u263A"`), 'Smile \u263A');
  assert.equal(value(String.raw`"M5x16_\u041c5\u044516"`), 'M5x16_\u041c5\u044516');
  assert.equal(value(String.raw`"\uD83D\uDE00"`), '\u{1F600}');
  assert.equal(value(String.raw`'a\tb\nc\rd\be\ff\\g\'h\"i'`), 'a\tb\nc\rd\be\ff\\g\'h"i');
  assert.throws(() => tokenize(String.raw`"\u12"`), /exactly four hex digits/);
  assert.throws(() => tokenize(String.raw`"\u12G4"`), /exactly four hex digits/);
  assert.throws(() => tokenize(String.raw`"\x41"`), /Unsupported string escape \\x/);
  assert.throws(() => tokenize('"abc\\'), FeatureScriptError);
});

test('try statement forms parse per FsDoc exceptions.html', () => {
  const [plain, silent, unbound, silentCatch, bound] = bodyOf(
    'try { a(); } try silent { a(); } try { a(); } catch { b(); } try silent { a(); } catch (e) { b(); } try { a(); } catch (error) { b(); }');
  for (const node of [plain, silent, unbound, silentCatch, bound]) assert.equal(node.kind, 'try');
  assert.deepEqual([plain.silent, plain.name, plain.handler.kind, plain.handler.statements.length], [false, null, 'block', 0]);
  assert.deepEqual([silent.silent, silent.name, silent.handler.statements.length], [true, null, 0]);
  assert.deepEqual([unbound.silent, unbound.name, unbound.handler.statements.length], [false, null, 1]);
  assert.deepEqual([silentCatch.silent, silentCatch.name, silentCatch.handler.statements.length], [true, 'e', 1]);
  assert.deepEqual([bound.silent, bound.name], [false, 'error']);
  // The expression forms are unchanged.
  const [statement] = bodyOf('try silent(a()); var x = try(b());');
  assert.equal(statement.value.kind, 'tryExpression');
  assert.equal(statement.value.silent, true);
  assert.throws(() => bodyOf('try { a(); } catch ( { b(); }'), /Expected an identifier/);
});

test('try statements catch modeling errors and continue, but never missing implementation', async () => {
  const model = await build(feature(`
    var reached = 0;
    try silent { throw regenError("expected"); }
    reached += 1;
    try { throw regenError("expected"); }
    reached += 1;
    var handled = false;
    try { throw regenError("expected"); } catch { handled = true; }
    if (!handled || reached != 2) throw regenError("try statement semantics");
    ${box}`));
  assert.deepEqual(volumes(model), [6000]);
  for (const body of [
    'try silent { notImplementedByWonky(context); }',
    'try { notImplementedByWonky(context); }',
    'try { notImplementedByWonky(context); } catch { }',
    'try silent { opSweep(context, id, {}); } catch (e) { }',
  ]) await assert.rejects(build(feature(body + box)), UnsupportedFeatureError, body);
});

test('for-in with one or two loop variables', () => {
  const [one, two] = bodyOf('for (var x in xs) f(x); for (var k, v in m) { f(k, v); }');
  assert.deepEqual([one.kind, one.key, one.name, one.values.name], ['for', null, 'x', 'xs']);
  assert.deepEqual([two.kind, two.key, two.name, two.values.name], ['for', 'k', 'v', 'm']);
  // The C-style loop still parses.
  assert.equal(bodyOf('for (var i = 0; i < 3; i += 1) f(i);')[0].kind, 'forC');
  assert.throws(() => bodyOf('for (var k, v, w in m) f(k);'), FeatureScriptError);
});

test('corpus repros: string "function", try statements and catch without binding build', async () => {
  assert.deepEqual(volumes(await build(repro('string-function-keyword.fs'))), [1000]);
  assert.deepEqual(volumes(await build(repro('try-block-statement.fs'))), [1000]);
  assert.deepEqual(volumes(await build(repro('fs-needs-partstudio-input/catch-without-binding.fs'))), [1000, 1000]);
});

// The parser gives the key and value bindings; the interpreter iterates the
// map in key order (FsDoc relational.html), so "a" (10 mm) comes before "b".
test('corpus repro: for (var k, v in map) builds one cuboid per entry', async () => {
  assert.deepEqual(volumes(await build(repro('for-in-key-value.fs'))), [1000, 8000]);
});

}
