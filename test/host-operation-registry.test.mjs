// Host-op collisions must fail even before an operation gains a dispatch arm.
// Parse the actual Rust sources, not a second handwritten list of constants.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import registry from '../rust/wonky-ops/host-operations.json' with {type: 'json'};
import {HOST_OP} from '../src/native/rust-host.mjs';
import {HOST_OPERATIONS, RUST_PORTED} from '../src/native/host-ops.mjs';
import {generatedHostSource} from '../scripts/native-bridge/gen-host-ops.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hostPath = 'rust/wonky-ops/src/host.rs';
const hostSource = fs.readFileSync(path.join(root, hostPath), 'utf8');
const jsOperations = Object.entries(HOST_OP).filter(([name]) => !['MAGIC', 'VERSION'].includes(name));

function uniqueNumbers(entries, side) {
  assert.ok(entries.length > 0, `${side}: empty host operation registry`);
  const seen = new Map();
  for (const [name, number] of entries) {
    assert.ok(Number.isInteger(number) && number > 0 && number <= 0xffffffff, `${side}: invalid host op ${name}=${number}`);
    assert.ok(!seen.has(number), `${side}: duplicate host op ${number}: ${seen.get(number)} and ${name}`);
    seen.set(number, name);
  }
}

function rustConstants(source) {
  return [...source.matchAll(/\bconst\s+(OP_[A-Z][A-Z_0-9]*)\s*:\s*u32\s*=\s*([^;]+);/g)].map(([, name, value]) => {
    assert.match(value.trim(), /^\d+$/, `${name}: host op numbers must be generated decimal literals`);
    return [name.slice(3), Number(value.trim())];
  });
}
const rustOperations = rustConstants(hostSource);
const ordered = entries => [...entries].sort(([a], [b]) => a.localeCompare(b));

function rustSources(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return ['target', 'vendor'].includes(entry.name) ? [] : rustSources(file);
    return entry.isFile() && entry.name.endsWith('.rs') ? [file] : [];
  });
}

test('JS host operation numbers are unique, including raw registry entries', () => {
  const entries = registry.operations.map(({name, number}) => [name, number]);
  for (const [name] of entries) assert.match(name, /^[A-Z][A-Z_0-9]*$/);
  assert.equal(new Set(entries.map(([name]) => name)).size, entries.length, 'duplicate host op name in registry');
  uniqueNumbers(entries, 'registry');
  uniqueNumbers(jsOperations, 'JS HOST_OP');
});

test('Rust host operation numbers are unique and no crate defines its own numbers', () => {
  const entries = [];
  for (const file of rustSources(path.join(root, 'rust'))) {
    const constants = rustConstants(fs.readFileSync(file, 'utf8'));
    if (path.relative(root, file) !== hostPath) assert.deepEqual(constants, [], `host op defined outside registry: ${path.relative(root, file)}`);
    entries.push(...constants);
  }
  uniqueNumbers(entries, 'Rust');
});

test('JS HOST_OP exactly matches the Rust OP_* constants parsed from host.rs', () => {
  assert.equal(new Set(rustOperations.map(([name]) => name)).size, rustOperations.length, 'duplicate Rust host op name');
  assert.deepEqual(ordered(jsOperations), ordered(rustOperations), 'JS/Rust host operation mismatch');
  for (const name of ['MAGIC', 'VERSION']) {
    const value = hostSource.match(new RegExp(`pub const ${name}: u32 = ([^;]+);`))?.[1];
    assert.ok(value, `Rust protocol ${name} missing`);
    assert.equal(HOST_OP[name], Number(value.replaceAll('_', '')), `JS/Rust protocol ${name} mismatch`);
  }
});

test('Rust host.rs registry block is current with the one source of truth', () => {
  assert.equal(hostSource, generatedHostSource(hostSource, registry), 'HOST_OPERATIONS_STALE: run node scripts/native-bridge/gen-host-ops.mjs');
});

test('registry generator can be imported by a stdin tooling script', () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-'], {
    cwd: root, encoding: 'utf8',
    input: `import fs from 'node:fs';
      import {generatedHostSource} from './scripts/native-bridge/gen-host-ops.mjs';
      const source = fs.readFileSync('${hostPath}', 'utf8');
      const registry = JSON.parse(fs.readFileSync('rust/wonky-ops/host-operations.json', 'utf8'));
      process.stdout.write(generatedHostSource(source, registry));`,
  });
  if (run.error) throw run.error;
  if (run.stderr) process.stderr.write(run.stderr);
  assert.equal(run.status, 0, 'stdin importer must not execute the generator CLI or resolve stdin as a file');
  assert.equal(run.stdout, hostSource);
});

test('host family and ported tables come from the registry, with the null-prototype boundary intact', () => {
  assert.deepEqual({...HOST_OPERATIONS}, registry.hostOperations);
  assert.equal(Object.getPrototypeOf(HOST_OPERATIONS), null);
  assert.equal(HOST_OPERATIONS.toString, undefined);
  assert.ok(Object.isFrozen(HOST_OPERATIONS));
  assert.ok(Object.isFrozen(HOST_OP));
  assert.ok(Object.isFrozen(RUST_PORTED));
  assert.deepEqual(RUST_PORTED, registry.rustPorted);
  assert.equal(new Set(RUST_PORTED).size, RUST_PORTED.length, 'duplicate Rust ported builtin');
  for (const name of RUST_PORTED) assert.ok(Object.hasOwn(HOST_OPERATIONS, name), `ported builtin ${name} lacks a host family`);
  for (const family of Object.values(HOST_OPERATIONS)) assert.equal(typeof family, 'string');
});

test('host operation registry test is registered in the explicit Rust JS lane', () => {
  const lane = fs.readFileSync(path.join(root, 'scripts/test-rust.list'), 'utf8');
  assert.match(lane, /^test\/host-operation-registry\.test\.mjs$/m);
});

function scratchCheck(mutate) {
  const copy = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-host-operations-')));
  try {
    for (const name of ['src', hostPath, 'rust/wonky-ops/host-operations.json', 'scripts/native-bridge/gen-host-ops.mjs', 'test/host-operation-registry.test.mjs']) {
      fs.mkdirSync(path.dirname(path.join(copy, name)), {recursive: true});
      fs.cpSync(path.join(root, name), path.join(copy, name), {recursive: true});
    }
    const check = () => {
      const env = {...process.env, WONKY_BACKEND: 'rust'};
      // This is a fresh runner over scratch sources, not a nested node:test worker.
      delete env.NODE_TEST_CONTEXT;
      const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^(JS host operation numbers|Rust host operation numbers|JS HOST_OP exactly)', 'test/host-operation-registry.test.mjs'], {
        cwd: copy, encoding: 'utf8', env,
      });
      if (run.error) throw run.error;
      if (run.stderr) process.stderr.write(run.stderr);
      return {status: run.status, output: run.stdout + run.stderr};
    };
    const control = check();
    assert.equal(control.status, 0, `scratch control must pass before planting: ${control.output}`);
    assert.match(control.output, /^# pass 3$/m, 'all three control checks must actually execute');
    mutate(copy);
    const planted = check();
    assert.equal(planted.status, 1, `planted source must fail assertions, not setup: ${planted.output}`);
    return planted.output;
  } finally { fs.rmSync(copy, {recursive: true, force: true}); }
}

test('scratch duplicate opcode fails both JS and parsed Rust uniqueness checks', () => {
  const output = scratchCheck(copy => {
    const file = path.join(copy, 'rust/wonky-ops/host-operations.json');
    const planted = JSON.parse(fs.readFileSync(file, 'utf8'));
    planted.operations.push({name: 'PLANTED_DUPLICATE', number: planted.operations[0].number});
    fs.writeFileSync(file, JSON.stringify(planted));
    fs.writeFileSync(path.join(copy, hostPath), generatedHostSource(hostSource, planted));
  });
  assert.match(output, /not ok \d+ - JS host operation numbers/);
  assert.match(output, /not ok \d+ - Rust host operation numbers/);
  assert.match(output, /duplicate host op 1/);
});

test('scratch JS-only renumbering fails the Rust mismatch check while uniqueness passes', () => {
  const output = scratchCheck(copy => {
    const file = path.join(copy, 'src/native/rust-host.mjs');
    const source = fs.readFileSync(file, 'utf8');
    const original = '[name, number]';
    assert.equal(source.split(original).length, 2, 'one JS opcode mapping to mutate');
    const next = Math.max(...registry.operations.map(({number}) => number)) + 1;
    fs.writeFileSync(file, source.replace(original, `[name, name === 'CURVE_REGION' ? ${next} : number]`));
  });
  assert.match(output, /^ok \d+ - JS host operation numbers/m);
  assert.match(output, /^ok \d+ - Rust host operation numbers/m);
  assert.match(output, /not ok \d+ - JS HOST_OP exactly/);
  assert.match(output, /JS\/Rust host operation mismatch/);
});
