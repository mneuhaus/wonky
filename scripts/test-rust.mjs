// Explicit, sequential Rust/JS lane. Never fall back to node --test discovery.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = [
  'test/benchmark-build123d.test.mjs',
  'test/cad-acid.test.mjs',
  'test/cad-acid-probes.test.mjs',
  'test/cad-acid-tolerance.test.mjs',
  'test/cad-acid-witness.test.mjs',
  'test/r20-references.test.mjs',
  'test/render-publication.test.mjs',
  'test/rust-host.test.mjs',
  'test/rust-addon-freshness.test.mjs',
  'test/rust-pattern.test.mjs',
  'test/rust-planarops.test.mjs',
  'test/rust-revolve.test.mjs',
  'test/rust-box.test.mjs',
  'test/rust-planar-boolean.test.mjs',
  'test/rust-fillet.test.mjs',
  'test/rust-chamfer.test.mjs',
  'test/rust-fillet-step.test.mjs',
  'test/rust-cylinder.test.mjs',
  'test/rust-bicylinder.test.mjs',
  'test/rust-cli-export.test.mjs',
  'test/rust-arcs.test.mjs',
  'test/rust-query.test.mjs',
  'test/rust-sphere.test.mjs',
  'test/rust-axial.test.mjs',
  'test/rust-lens.test.mjs',
  'test/rust-observation.test.mjs',
  'test/rust-wire.test.mjs',
  'test/viewer-camera-navigation.test.mjs',
  'test/viewer-camera.test.mjs',
  'test/viewer-core.test.mjs',
  'test/viewer-exact-measure.test.mjs',
  'test/viewer-help-a11y.test.mjs',
  'test/viewer-parts-tree.test.mjs',
  'test/viewer-state.test.mjs',
  'test/viewer-thickness-probe.test.mjs',
];
if (!files.length || files.some(file => !fs.statSync(path.join(root, file)).isFile())) throw new Error('RUST_TEST_FILES_MISSING');
const out = path.join(root, 'out/test-rust');
fs.mkdirSync(out, {recursive:true});
for (const file of files) {
  const guardLog = path.join(out, `${path.basename(file)}.guard.json`);
  fs.rmSync(guardLog, {force:true});
  console.log(`\nRust lane: ${file}`);
  // node:test executes on direct invocation too. One process per file means the
  // guard observes the actual test imports, not a test-runner parent process.
  const run = spawnSync(process.execPath, ['--import', path.join(root, 'scripts/r20/bend-guard.mjs'), path.join(root, file)], {
    cwd:root, stdio:'inherit', env:{...process.env, WONKY_BACKEND:'rust', NODE_OPTIONS:'--max-old-space-size=8192', WONKY_BEND_GUARD_LOG:guardLog},
  });
  const guarded = fs.existsSync(guardLog) && JSON.parse(fs.readFileSync(guardLog, 'utf8')).summary?.bendLoaded === false;
  if (run.status !== 0 || !guarded) {
    console.error(`RUST_TEST_FAILED: ${file}; exit=${run.status}; Bend-free=${guarded}`);
    process.exitCode = 1;
    break;
  }
}

if (!process.exitCode) {
  console.log('\nRust lane: scripts/acid/test_status_page.py');
  const pageTest = spawnSync('uv', ['run', '--no-project', 'python', 'scripts/acid/test_status_page.py'], {cwd:root, stdio:'inherit'});
  if (pageTest.error) throw pageTest.error;
  if (pageTest.status !== 0) {
    console.error(`RUST_TEST_FAILED: scripts/acid/test_status_page.py; exit=${pageTest.status}`);
    process.exitCode = 1;
  }
}
