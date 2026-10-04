// Full workspace gate: nextest executes libtest binaries; Cargo executes doctests.
// --measure establishes the Cargo baseline on this exact source tree and host.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {codeIdentity} from '../acid/evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'out/rust-gate');
const common = ['--offline', '--locked', '--manifest-path', 'rust/Cargo.toml', '--workspace'];
function run(args, label, {json = false} = {}) {
  const start = performance.now();
  const result = spawnSync('cargo', args, {cwd:root, encoding:'utf8', maxBuffer:128 << 20, stdio:['ignore', 'pipe', 'inherit']});
  if (!json) process.stdout.write(result.stdout ?? '');
  fs.writeFileSync(path.join(out, `${label}.stdout`), result.stdout ?? '');
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`RUST_GATE_COMMAND_FAILED: cargo ${args.join(' ')} (exit ${result.status})`);
  return {stdout:result.stdout, seconds:(performance.now() - start) / 1000};
}
export function cargoCounts(stdout) {
  const rows = [...stdout.matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;/g)];
  if (!rows.length) throw new Error('RUST_GATE_COUNT_MISSING');
  return {passed:rows.reduce((n,r) => n + Number(r[1]), 0), ignored:rows.reduce((n,r) => n + Number(r[3]), 0)};
}
export function compareTests(cargoList, nextestList) {
  const cargo = cargoList.split('\n').filter(line => line.endsWith(': test') || line.endsWith(': benchmark')).map(line => line.replace(/: (test|benchmark)$/, '')).sort();
  const nextest = Object.values(nextestList['rust-suites']).flatMap(suite => Object.keys(suite.testcases)).sort();
  if (!cargo.length || JSON.stringify(cargo) !== JSON.stringify(nextest)) throw new Error(`RUST_GATE_TEST_SET_MISMATCH: Cargo=${cargo.length}, nextest=${nextest.length}`);
  return cargo.length;
}
export function junitCounts(xml) {
  const rows = [...xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)];
  if (!rows.length) throw new Error('RUST_GATE_NEXTEST_COUNT_MISSING');
  const ignored = rows.filter(r => /<skipped\b/.test(r[2] ?? '')).length;
  if (/<(?:failure|error)\b/.test(xml)) throw new Error('RUST_GATE_NEXTEST_FAILURE');
  return {passed:rows.length - ignored, ignored};
}
export function checkCounts(expected, actual) {
  if (expected.passed !== actual.passed || expected.ignored !== actual.ignored) throw new Error(`RUST_GATE_EXECUTED_COUNT_MISMATCH: Cargo=${JSON.stringify(expected)}, nextest+doc=${JSON.stringify(actual)}`);
}
export function main() {
  fs.mkdirSync(out, {recursive:true});
  const code = codeIdentity(root);
  const baselinePath = path.join(out, 'cargo-baseline.json');
  const measure = process.argv.includes('--measure');
  if (process.argv.slice(2).some(arg => arg !== '--measure')) throw new Error('Usage: node scripts/rust/gate-tests.mjs [--measure]');
  let baseline = null;
  if (measure) {
    // Build first, so both timed runners use the same warm binaries. Build time
    // is reported separately rather than charging only Cargo for a cold cache.
    const build = run(['test', '--profile', 'gate', ...common, '--no-run'], 'build');
    const cargo = run(['test', '--profile', 'gate', ...common], 'cargo');
    baseline = {code, host:os.hostname(), buildSeconds:build.seconds, seconds:cargo.seconds, ...cargoCounts(cargo.stdout)};
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
  }
  const cargoList = run(['test', '--profile', 'gate', ...common, '--lib', '--tests', '--', '--list'], 'cargo-list');
  const nextestList = run(['nextest', 'list', '--cargo-profile', 'gate', ...common, '--message-format', 'json'], 'nextest-list', {json:true});
  const listed = compareTests(cargoList.stdout, JSON.parse(nextestList.stdout));
  const ignoredList = run(['test', '--profile', 'gate', ...common, '--lib', '--tests', '--', '--list', '--ignored'], 'cargo-ignored');
  const ignored = ignoredList.stdout.split('\n').filter(line => /: (test|benchmark)$/.test(line)).length;
  const config = path.join(out, 'nextest.toml');
  fs.writeFileSync(config, '[profile.default.junit]\npath = "out/rust-gate/nextest.xml"\n');
  const xmlPath = path.join(process.env.CARGO_TARGET_DIR ?? path.join(root, 'rust/target'), 'nextest/default/out/rust-gate/nextest.xml');
  // nextest resolves JUnit paths relative to its profile store under target.
  fs.rmSync(xmlPath, {force:true});
  const nextest = run(['nextest', 'run', '--config-file', config, '--cargo-profile', 'gate', ...common], 'nextest');
  const doc = run(['test', '--doc', '--profile', 'gate', ...common], 'doc');
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const counts = junitCounts(xml), docs = cargoCounts(doc.stdout);
  checkCounts({passed:listed - ignored, ignored}, counts);
  if (baseline) checkCounts(baseline, {passed:counts.passed + docs.passed, ignored:counts.ignored + docs.ignored});
  const slowest = [...xml.matchAll(/<testcase\b([^>]*)/g)].map(r => Object.fromEntries([...r[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1],a[2]]))).sort((a,b) => Number(b.time) - Number(a.time)).slice(0,10);
  const inventorySeconds = cargoList.seconds + nextestList.seconds + ignoredList.seconds;
  const report = {code, host:os.hostname(), baseline, listed, inventorySeconds, checkedGateSeconds:inventorySeconds + nextest.seconds + doc.seconds, nextest:{seconds:nextest.seconds, ...counts}, doctests:{seconds:doc.seconds,...docs}, gateSeconds:nextest.seconds+doc.seconds, speedup:baseline ? baseline.seconds/(inventorySeconds+nextest.seconds+doc.seconds) : null, slowest};
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
