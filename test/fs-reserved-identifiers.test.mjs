// Onshape refuses reserved FeatureScript words as names (observed for `box`, and
// the keywords are documented as reserved). wonky must refuse the same class
// with the stable code `fs/reserved-identifier`, so source that passes here
// also compiles there. The tables below are literal on purpose: they do not
// read src/fs-reserved.mjs, so dropping a word from that list fails its row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, tokenize } from '../src/parser.mjs';
import { RESERVED_IDENTIFIERS, RESERVED_IDENTIFIER_CODE } from '../src/fs-reserved.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const CODE = 'fs/reserved-identifier';

// FsDoc tokens.html keywords, the future-use words, the grammar keywords the
// doc list omits, and the builtin type names.
const KEYWORDS = ['annotation', 'enum', 'export', 'function', 'import', 'operator', 'precondition', 'predicate',
  'returns', 'type', 'typecheck', 'typeconvert', 'as', 'is', 'new', 'break', 'const', 'continue', 'for', 'in',
  'return', 'var', 'while', 'false', 'inf', 'true', 'undefined', 'catch', 'throw', 'try', 'assert', 'case',
  'default', 'do', 'switch', 'if', 'else', 'silent'];
const TYPE_NAMES = ['box', 'builtin', 'boolean', 'number', 'string', 'array', 'map'];
const ALL = [...KEYWORDS, ...TYPE_NAMES];

const NEAR_MISSES = ['boxBody', 'myBox', 'box3d', 'boxes', 'Box', 'BOX', 'box_', '_box', 'mapping', 'numbers', 'stringy',
  'arrayOf', 'typeName', 'types', 'isValid', 'inside', 'newBody', 'asPlane', 'returnsValue', 'variable', 'constant',
  'functions', 'import2', 'iff', 'elseif', 'doIt', 'cases', 'defaults', 'silently', 'builtins', 'booleanOp',
  'plane', 'line', 'Query', 'Vector', 'context', 'id', 'definition', 'evBox3d', 'box3dValue', 'point', 'circle'];

const feature = body => `FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");
annotation { "Feature Type Name" : "t" }
export const t = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
${body}
    });
`;

const rejection = source => {
  try { parse(source); } catch (error) { return error; }
  return null;
};

test('the literal tables cover exactly the shipped reserved list', () => {
  assert.deepEqual([...RESERVED_IDENTIFIERS].sort(), [...ALL].sort());
  assert.equal(RESERVED_IDENTIFIER_CODE, CODE);
});

for (const name of ALL) {
  test(`reserved word '${name}' is refused as a variable name with ${CODE}`, () => {
    const error = rejection(feature(`        var ${name} = 1;`));
    assert.ok(error, `'${name}' was accepted as a variable name`);
    assert.equal(error.code, CODE);
    assert.match(error.message, new RegExp(`'${name}' is a reserved FeatureScript word`));
    assert.match(error.hint, /Rename it/);
    assert.equal(error.line, 7);
  });
}

for (const name of ['box', 'if', 'map', 'default']) {
  const positions = {
    'a constant': feature(`        const ${name} = 1;`),
    'a function parameter': feature(`        var f = function(${name}) { return 1; };`),
    'a typed function parameter': `FeatureScript 3000;\nfunction f(${name} is number) returns number { return 1; }\n`,
    'a top-level function name': `FeatureScript 3000;\nfunction ${name}(context is Context) returns number { return 1; }\n`,
    'a for-in variable': feature(`        for (var ${name} in [1, 2]) { }`),
    'a for-in key': feature(`        for (var ${name}, v in { "a" : 1 }) { }`),
    'a for-in value': feature(`        for (var k, ${name} in { "a" : 1 }) { }`),
    'a catch variable': feature(`        try { var x = 1; } catch (${name}) { }`),
    'an import namespace': `FeatureScript 3000;\n${name}::import(path : "a.fs", version : "1");\n`,
    'an enum name': `FeatureScript 3000;\nexport enum ${name} { A, B }\n`,
    'an enum member': `FeatureScript 3000;\nexport enum E { ${name}, B }\n`,
  };
  for (const [position, source] of Object.entries(positions)) {
    test(`'${name}' is refused as ${position} with ${CODE}`, () => {
      const error = rejection(source);
      assert.ok(error, `'${name}' was accepted as ${position}`);
      assert.equal(error.code, CODE);
      assert.match(error.message, new RegExp(`'${name}' is a reserved FeatureScript word`));
    });
  }
}

for (const name of NEAR_MISSES) {
  test(`near miss '${name}' stays accepted in every naming position`, () => {
    const source = feature(`        var ${name} = 1;
        const ${name}Const = 2;
        var f = function(${name}Arg) { return ${name}Arg; };
        for (var ${name}Item in [1, 2]) { }
        try { var y = 1; } catch (${name}Error) { }
        var m = { "${name}" : 1, ${name}Key : 2 };
        var v = m.${name}Key;`);
    assert.doesNotThrow(() => parse(source));
    assert.doesNotThrow(() => parse(feature(`        var ${name} = 1;`)));
    assert.doesNotThrow(() => parse(`FeatureScript 3000;\nfunction ${name}(context is Context) returns number { return 1; }\n`));
    assert.doesNotThrow(() => parse(`FeatureScript 3000;\nexport enum E { ${name}, B }\n`));
  });
}

test('keywords are refused as unquoted dot operands and map keys, quoted forms stay accepted', () => {
  for (const name of KEYWORDS) {
    const dot = rejection(feature(`        var m = {}; var v = m.${name};`));
    assert.ok(dot, `m.${name} was accepted`);
    assert.equal(dot.code, CODE);
    assert.match(dot.hint, new RegExp(`x\\["${name}"\\]`));
    const key = rejection(feature(`        var m = { ${name} : 1 };`));
    assert.ok(key, `{ ${name} : 1 } was accepted`);
    assert.equal(key.code, CODE);
    assert.doesNotThrow(() => parse(feature(`        var m = { "${name}" : 1 }; var v = m["${name}"];`)));
  }
});

test('type names stay usable as unquoted members and keys, only bindings are refused', () => {
  for (const name of TYPE_NAMES) {
    assert.doesNotThrow(() => parse(feature(`        var m = { ${name} : 1 }; var v = m.${name};`)));
  }
});

test('reserved words stay usable in their own syntax', () => {
  assert.doesNotThrow(() => parse(feature(`        if (definition.width is number) { var d = 2; } else { var e = 3; }
        try silent { var f = 4; }
        for (var i = 0; i < 2; i += 1) { if (i == 1) continue; }
        var g = definition.value is map;`)));
});

// Every FeatureScript file the repo ships or captures must keep parsing: the
// reserved list may only reject genuinely refusable names.
const fsFiles = () => {
  const found = [];
  const walk = directory => {
    for (const entry of readdirSync(directory)) {
      if (['node_modules', '.git', 'target', 'tmp', '.tools'].includes(entry)) continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path); else if (path.endsWith('.fs')) found.push(path);
    }
  };
  for (const directory of ['fixtures', 'examples', 'kernel', 'workspaces', 'docs', '.claude', 'scripts', 'test']) {
    if (existsSync(join(root, directory))) walk(join(root, directory));
  }
  return found.sort();
};

test('no shipped .fs file (fixtures, examples, kernel cases, skills) trips the reserved-identifier refusal', () => {
  const files = fsFiles();
  assert.ok(files.length > 100, `expected the repo .fs corpus, found ${files.length}`);
  const tripped = [];
  for (const file of files) {
    try { parse(readFileSync(file, 'utf8')); } catch (error) {
      if (error.code === CODE) tripped.push(`${file}: ${error.message}`);
    }
  }
  assert.deepEqual(tripped, []);
});

test('the Onshape standard library never binds a reserved word (counter-evidence for the list)', t => {
  const std = process.env.WONKY_STD_DIR ?? resolve(root, 'tmp/research/onshape-std-3083/repo');
  const mainRepoStd = resolve(root, '../../research/onshape-std-3083/repo');
  const directory = [std, mainRepoStd].find(existsSync);
  if (!directory) return t.skip('Onshape std sources are not checked out here (set WONKY_STD_DIR)');
  const files = readdirSync(directory).filter(name => name.endsWith('.fs'));
  assert.ok(files.length > 100, `expected the std sources, found ${files.length}`);
  // wonky's parser does not read every std file, so a token scan covers the rest
  // (wonky's own lexer, so comments and strings never match; std's builtin-call
  // marker `@` is blanked because that lexer does not accept it): a reserved word
  // declared, taken as a typed parameter or catch variable, or a keyword written
  // unquoted after a dot or as a map key.
  const tripped = []; let parsed = 0;
  for (const name of files) {
    const text = readFileSync(join(directory, name), 'utf8');
    try { parse(text); parsed += 1; } catch (error) {
      if (error.code === CODE) tripped.push(`${name}: ${error.message}`);
    }
    const tokens = tokenize(text.replaceAll('@', ' '));
    tokens.forEach((token, i) => {
      if (token.kind !== 'name' || i === 0) return;
      const before = tokens[i - 1], after = tokens[i + 1], symbol = (t, ...values) => t?.kind === 'symbol' && values.includes(t.value);
      const where = `${name}:${token.line} '${token.value}'`;
      if (ALL.includes(token.value)) {
        if (before.kind === 'name' && ['var', 'const', 'function'].includes(before.value)) tripped.push(`${where} declared`);
        if (symbol(before, '(', ',') && after?.kind === 'name' && after.value === 'is') tripped.push(`${where} as a typed parameter`);
        if (symbol(before, '(') && tokens[i - 2]?.value === 'catch') tripped.push(`${where} as a catch variable`);
      }
      if (KEYWORDS.includes(token.value)) {
        if (symbol(before, '.')) tripped.push(`${where} as an unquoted dot operand`);
        if (symbol(before, '{', ',') && symbol(after, ':')) tripped.push(`${where} as an unquoted map key`);
      }
    });
  }
  assert.deepEqual(tripped, []);
  assert.ok(parsed >= 100, `only ${parsed} of ${files.length} std files parsed`);
});

test('the CLI reports the reserved identifier with a stable code and a specific hint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-reserved-'));
  try {
    const path = join(dir, 'reserved.fs');
    writeFileSync(path, feature('        var box = 1;'));
    const run = spawnSync(process.execPath, ['bin/wonky.mjs', path, '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 1);
    const report = JSON.parse(run.stdout);
    assert.equal(report.status, 'error');
    const [refusal] = report.refusals;
    assert.equal(refusal.code, CODE);
    assert.equal(refusal.location.line, 7);
    assert.match(refusal.message, /'box' is a reserved FeatureScript word/);
    assert.match(refusal.hint, /Rename it, for example 'boxValue' or 'myBox'/);
    assert.notEqual(refusal.hint, 'Check the input and the selected backend.');
    assert.match(run.stderr, /wonky: fs\/reserved-identifier /);
    assert.match(run.stderr, /hint=Rename it/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
