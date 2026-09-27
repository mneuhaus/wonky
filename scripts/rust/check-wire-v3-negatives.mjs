// Run ONLY in the isolated remote runner copy. No production mutation flags.
// Every mutant must compile and fail its named public-contract test. Always
// restore the original bytes, even if an assertion or cargo command fails.
import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const root = process.cwd();
assert.match(root, /\/wonky-remote\/wt\//, 'mutants must run in a remote runner copy');
const cases = [
  {
    name: 'drop-hyperbola-branch',
    path: 'rust/wonky-wire/src/v3/mod.rs',
    before: 'Ok(match r.take()? { $($tag => Self::$variant',
    after: 'Ok(match { let tag = r.take()?; if stringify!($name) == "HyperbolaBranch" { 1 } else { tag } } { $($tag => Self::$variant',
    test: 'generated_all_variant_roundtrips_are_bit_exact',
  },
  {
    name: 'invent-v2-provenance',
    path: 'rust/wonky-wire/src/v3/legacy.rs',
    before: 'provenance: Provenance::None {},',
    after: 'provenance: Provenance::Construction { node: NodeId(0) },',
    test: 'v2_import_is_real_legacy_payload_without_invented_provenance',
  },
  {
    name: 'drop-rigid-angle',
    path: 'rust/wonky-brep/src/placement.rs',
    before: 'angle: Binary64::new(self.angle)?,',
    after: 'angle: Binary64::new(0.0 * self.angle)?,',
    test: 'transformed_source_incidence_survives_wire_and_json_export',
  },
];
for (const mutation of cases) {
  const file = resolve(root, mutation.path);
  const original = readFileSync(file, 'utf8');
  assert.equal(original.split(mutation.before).length, 2, `${mutation.name}: unique mutation site`);
  try {
    writeFileSync(file, original.replace(mutation.before, mutation.after));
    const run = spawnSync('/usr/bin/time', ['-l', 'cargo', 'test', '--offline', '--locked', '-p', 'wonky-wire', '--test', 'v3_contract', mutation.test, '--', '--exact'], { cwd: resolve(root, 'rust'), encoding: 'utf8', maxBuffer: 8 << 20 });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    process.stdout.write(output);
    assert.equal(run.error, undefined);
    assert.equal(run.status, 101, `${mutation.name}: must fail`);
    assert.match(output, new RegExp(`test ${mutation.test} \\.\\.\\. FAILED`), `${mutation.name}: test ran, not a compile error`);
    assert.match(output, /assertion `left == right` failed/, `${mutation.name}: intended retained-data assertion`);
    console.log(`KILLED ${mutation.name}: ${mutation.test}`);
  } finally {
    writeFileSync(file, original);
    // Cargo fingerprints include mtimes; force rebuilding the restored producer.
    const now = new Date(Date.now() + 2000);
    utimesSync(file, now, now);
    // Rebuild immediately: later rsync can restore an older source mtime while
    // preserving Cargo's mutant artifact, so touching alone is insufficient.
    const restored = spawnSync('cargo', ['test', '--offline', '--locked', '-p', 'wonky-wire', '--test', 'v3_contract', mutation.test, '--', '--exact'], { cwd: resolve(root, 'rust'), encoding: 'utf8', maxBuffer: 8 << 20 });
    process.stdout.write(`${restored.stdout ?? ''}${restored.stderr ?? ''}`);
    assert.equal(restored.error, undefined);
    assert.equal(restored.status, 0, `${mutation.name}: restored producer must pass`);
    console.log(`RESTORED ${mutation.name}: ${mutation.test}`);
  }
}
// Complement the compile_fail doctest with its well-typed neighbor. A doctest
// failing because the public type disappeared is not a valid negative control.
const args = ['test', '--offline', '--locked', '-p', 'wonky-contract', '--doc'];
const doc = spawnSync('cargo', args, { cwd: resolve(root, 'rust'), stdio: 'inherit' });
assert.equal(doc.status, 0, 'Estimate -> EnclosureClaim compile_fail doctest must pass');
console.log(`PASS ${cases.length} producer/codec mutants killed; Estimate/EnclosureClaim compile-time negative passed`);
