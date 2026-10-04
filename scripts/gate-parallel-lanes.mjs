// Landing-gate lever: the JS lane (scripts/test-rust.mjs) and the live acid run
// (scripts/acid/run.mjs) touch disjoint files (out/test-rust/* vs the given --out
// dir; the addon .node and fixtures/cad-acid/zones.json are read-only to both) and
// neither depends on the other's output, so they can run concurrently instead of
// back-to-back. Measured on the Studio (2026-09-28, this worktree, warm target
// dir): sequential js_lane 1223s + acid_run 380s = 1603s; concurrent wall time
// 1166s (job total 1222s including a 56s addon rebuild before this script) --
// about 27% faster on this phase. Both lanes passed with results identical to a
// sequential run (0 outcome diffs across all 576 acid rows vs main HEAD; see
// local-development-evidence).
//
// ORDERING CAVEAT (found the hard way): running `cargo test --workspace --profile
// gate` before this script -- without an intervening `node scripts/rust/
// build-node.mjs` -- makes the cached release addon look stale to
// src/native/rust-kernel.mjs's rustStaleCheck (BX_STALE: "rust/Cargo.toml
// changed"), and BOTH lanes fail immediately. A plain `cargo test --workspace
// --release` run in between does NOT trigger this. Root cause not fully isolated
// (not our claim to make); the reliable fix is to rebuild the addon right before
// calling this script whenever a `--profile gate` cargo test ran since the last
// build. CARGO_BUILD_JOBS/RUST_TEST_THREADS are already capped by the runner so
// running both lanes at once does not oversubscribe the box. The JS lane itself
// runs its files in a bounded pool (WONKY_LANE_JOBS): alone on the Studio it took
// 418 s instead of 1109 s sequential (local-development-evidence).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {acidJobs, splitPoolBudget} from './acid/pool.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const acidOut = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'out/gate-acid';

function run(name, command, args, extraEnv = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], env: {...process.env,...extraEnv} });
    child.once('exit', (code, signal) => resolve({ name, code: code ?? (signal ? 128 : 1) }));
    child.once('error', error => { console.error(`${name} failed to start: ${error.message}`); resolve({ name, code: 1 }); });
  });
}

const jsLaneArgs = [path.join(root, 'scripts/test-rust.mjs'), '--gate'];
// --list exercises the gate's actual mandatory selection without launching CAD.
if (process.argv.includes('--list')) {
  const result = await run('js-lane', process.execPath, [...jsLaneArgs, '--list']);
  process.exit(result.code);
}

const warm = await run('closed-forms-warm', process.execPath, [path.join(root, 'scripts/acid/closed-forms-cache.mjs')]);
if (warm.code !== 0) process.exit(warm.code);

// The runner's allowance belongs to this job, not separately to each nested pool.
const cores = os.availableParallelism();
const total = process.env.CARGO_BUILD_JOBS === undefined ? Math.max(1,cores-2) : Number(process.env.CARGO_BUILD_JOBS);
const requestedJs = process.env.WONKY_LANE_JOBS ? Number(process.env.WONKY_LANE_JOBS) : Math.max(1,Math.min(6,Math.floor(cores/3)));
const allocation = splitPoolBudget(total,[requestedJs,acidJobs()]);
console.log(`Parallel gate worker allowance ${total}: JS ${allocation.jobs[0]}, acid ${allocation.jobs[1]}, concurrent=${allocation.concurrent}`);
const lanes = [
  () => run('js-lane', process.execPath, jsLaneArgs, {WONKY_LANE_JOBS:String(allocation.jobs[0])}),
  () => run('acid-run', process.execPath, [path.join(root, 'scripts/acid/run.mjs'), '--out', acidOut, '--kernels', 'wonky-rust', '--json-only'], {WONKY_ACID_JOBS:String(allocation.jobs[1])}),
];
const [jsLane, acidRun] = allocation.concurrent ? await Promise.all(lanes.map(start => start())) : [await lanes[0](),await lanes[1]()];

for (const r of [jsLane, acidRun]) console.log(`${r.name}: exit ${r.code}`);
if (jsLane.code !== 0 || acidRun.code !== 0) {
  console.error('GATE_PARALLEL_LANES_FAILED');
  process.exit(1);
}
console.log('GATE_PARALLEL_LANES_OK');
