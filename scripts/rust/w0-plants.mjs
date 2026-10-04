#!/usr/bin/env node
// Planted negatives of package W0 (docs/rust-migration.md 6) that need a source
// mutation: each plant edits one file, runs the named tests of
// test/rust-wire.test.mjs, which must FAIL, and restores the file (checked by
// sha256). Consumer: the W0 verifier; deletion: when R3's planted-negative
// runner covers these. The two feature-gated plants run elsewhere:
// `cargo test -p wonky-wire --features plant-count --test count -- --test-threads=1` (must fail)
// and plant-panic (a positive test of test/rust-wire.test.mjs).
//
// Rust-side plants rebuild the addon into a separate cache (tmp/rust/plant-cache)
// so the production cache pointer is never moved. One plant at a time.
//
//   node --max-old-space-size=8192 scripts/rust/w0-plants.mjs [name ...]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const plantCache = join(root, 'tmp/rust/plant-cache');

export const PLANTS = [
  { name: 'fround-on-rust', file: 'src/real.mjs', why: 'Math.fround / F32x2 split back on the rust host path',
    from: "    return { $: 'Real', hi: value, lo: 0 };", to: "    const hi = Math.fround(value);\n    return { $: 'Real', hi, lo: Math.fround(value - hi) };",
    tests: 'plane at 1e10', rust: false },
  { name: 'nan-accepted', file: 'rust/wonky-wire/src/lib.rs', why: 'the Rust decoders accept NaN and +-Inf',
    from: '    if x.is_finite() {\n        Ok(x)', to: '    if true {\n        Ok(x)', tests: 'NaN and \\+-Inf', rust: true },
  { name: 'refusal-unnamed', file: 'src/native/rust-kernel.mjs', why: 'status 6 is not turned into a NativeCapabilityError',
    from: '      if (status === STATUS.UNAVAILABLE) {', to: '      if (status === -1) {', tests: 'does not serve throws NativeCapabilityError', rust: false },
  { name: 'diff-bend-answers', file: 'src/native/rust-kernel.mjs', why: 'B1 gate disabled and rust-diff can claim Bend answers before any port',
    from: "  throw new NativeKernelError('BX_BACKEND', 'WONKY_BACKEND=rust-diff is not available until package B1 ports the first entries');",
    to: '  // plant: bypass the P0 rust-diff gate',
    tests: 'rust-diff and rust-mixed fail', rust: false },
  { name: 'exporters-load-bend', file: 'src/exporters.mjs', why: 'the exporters load the Bend STEP pcurve modules on WONKY_BACKEND=rust',
    from: 'await exportKernels();', to: "await exportKernels('js');", tests: 'try silent', rust: false },
  { name: 'services-load-bend', file: 'src/library.mjs', why: 'loadModelingServices loads the Bend modeling services for the strict rust kernel',
    from: "  if (isStrictRustKernel(kernel)) return Promise.resolve({ faceClassifier: kernel.faceClassifier });\n", to: '',
    tests: 'modeling services select the strict rust kernel classifier', rust: false },
  { name: 'python-fillet-bend', file: 'src/python.mjs', why: 'a Python model loads the Bend production fillet on WONKY_BACKEND=rust',
    from: "shapeSession(kernel, withoutBend(selectBackend()) ? null", to: "shapeSession(kernel, selectBackend() === 'native' ? null",
    tests: 'naming a Bend modeling service', rust: false },
  { name: 'v2-real-rounded', file: 'src/native/rust-wire.mjs', why: 'the JS v2 encoder rounds an F32x2 pair binary64 cannot hold instead of refusing it',
    from: '    if (e !== 0) fail(`Real ${hi} + ${lo} is not exact in binary64`);', to: '    if (false) fail(`Real ${hi} + ${lo} is not exact in binary64`);',
    tests: 'not exact in binary64', rust: false },
  { name: 'identity-fround-on-rust', file: 'src/identity.mjs', why: 'the box_layout corners are F32-rounded on WONKY_BACKEND=rust',
    from: "const corner = binary64Host() ?", to: "const corner = false ?", tests: 'box identity corners', rust: false },
  { name: 'budget-f32-on-rust', file: 'src/construction-history.mjs', why: 'an inherited construction budget must be F32x2 words on WONKY_BACKEND=rust',
    from: "const nativeRealWords = native => binary64Host() ?", to: "const nativeRealWords = native => false ?", tests: 'box identity corners', rust: false },
];

const sha = text => createHash('sha256').update(text).digest('hex');

function runPlant(plant) {
  const path = join(root, plant.file), original = readFileSync(path, 'utf8');
  const hits = original.split(plant.from).length - 1;
  if (hits !== 1) throw new Error(`${plant.name}: '${plant.from}' occurs ${hits} times in ${plant.file}`);
  const t0 = Date.now();
  let run;
  try {
    writeFileSync(path, original.replace(plant.from, plant.to));
    run = spawnSync(process.execPath, ['--test', `--test-name-pattern=${plant.tests}`, join(root, 'test/rust-wire.test.mjs')],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' '), ...(plant.rust ? { WONKY_RUST_CACHE: plantCache } : {}) } });
  } finally {
    writeFileSync(path, original);
  }
  if (sha(readFileSync(path, 'utf8')) !== sha(original)) throw new Error(`${plant.name}: ${plant.file} was not restored`);
  const failed = [...run.stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map(m => m[1]);
  const passed = Number(/^# pass (\d+)/m.exec(run.stdout)?.[1] ?? NaN);
  return { plant: plant.name, why: plant.why, file: plant.file, exitCode: run.status, detected: run.status !== 0 && failed.length > 0, failed, passed, ms: Date.now() - t0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const only = process.argv.slice(2);
  const results = PLANTS.filter(p => !only.length || only.includes(p.name)).map(p => { const r = runPlant(p); console.log(JSON.stringify(r)); return r; });
  process.exitCode = results.every(r => r.detected) ? 0 : 1;
}
