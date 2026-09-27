# Native bridge: where wonky's wall time goes, and the ceiling for a native kernel binding

Date: 2026-09-22. Apple M5 Pro (18 logical CPUs), macOS arm64 (Darwin 25.6.0), Node v22.23.1, Bend 2.0.25.
Production path today: FeatureScript and build123d frontends in JS, geometry kernel as Bend compiled to JavaScript and
loaded from the Bend JS compile cache. All numbers below were measured on that path with a warm Bend cache.

The machine was shared. The one-minute load average was 11.6 to 14.7 during every measured run (18 cores). Treat
absolute milliseconds as indicative; the shares and call counts are the robust part. Nothing here measures a native
or GPU kernel. The speedups in the last section are **Amdahl bounds for a hypothetical kernel speedup k**, not
predictions.

## Answer in short

1. **Two regimes.** Boolean-heavy runs (build123d planar-union, planar-pocket, frame-with-tab; FeatureScript
   fuse-g1, cut-h1; r10b up to its known unsupported step) spend **68 to 98 %** of wall time executing the Bend
   kernel (JS GC caused by kernel allocation included; 64 to 86 % without GC). Small models (bracket, bored-spacer
   with print mesh) spend **0.3 to 4 %** in the kernel and **82 to 87 %** loading the Bend-compiled JS kernel.
2. **Loading the JS kernel costs 0.75 to 0.81 s per CLI process** (warm cache, GC and idle waits included):
   cache validation that re-hashes the Bend compiler tree and re-lexes every module's import closure (0.44 s),
   importing 4.8 MiB of emitted JS (0.15 s), and importing the Bend compiler's `main.ts`, which also registers ESM
   hooks that every later import then waits on (about 0.16 to 0.18 s).
3. **What stays in JS is small.** FeatureScript parse plus interpreter: at most 0.7 % (r10b: 47 ms of 56 s).
   Python bridge JS side 3 to 4 ms, plus 23 to 41 ms waiting for the Python subprocess. Host adaptation
   (encoders, `decodeSolid`, `validateSolid`, identity, construction history, queries): **at most 0.42 %**, at most
   16 ms outside r10b (54 ms there). Export at most 2.1 %. Node start plus the src/bin module graph: about 75 to 80 ms.
4. **The kernel API can be coarse.** Normal runs make 5 to 839 host-to-kernel calls, r10b 18,604. In every
   Boolean workload one or two calls (`planarBoolean.union/subtract`, `curvedIntersection.intersect`) carry 76 to
   99.9 % of kernel time. With the binding stage's measured in-process cost (about 1 us per call, 1.5 to 1.7 ns per
   byte), crossing the boundary would add at most 1.3 ms per run (r10b: 25 ms, 0.04 %). Per-call overhead does not
   matter at today's granularity.
5. **Amdahl ceiling with the JS kernel still loaded** (kernel k times faster, everything else unchanged): heavy runs
   reach 2.4 to 6.7x at k = 7.5, 2.8 to 17.5x at k = 25, 3.0 to 32x at k = 75. The k -> infinity limits range from 3.1x
   to 56x. Small models stay at 1.00 to 1.04x for any k. Also moving host adaptation behind the binding raises these
   bounds by at most 1.7 % at k = 25 (3.2 % at k = 75, r10b).
6. **The larger lever for everyday runs is not loading the JS kernel at all** when the native backend is selected.
   If the addon replaces the Bend JS load (probe addon load plus init measured at about 1 ms warm), the CLI bound
   becomes 6.9 to 7.7x for every workload at k = 7.5. Heavy runs reach 12 to 23x at k = 25 and 16 to 56x at k = 75;
   small models plateau at 7.1 to 7.8x. In a resident session that already paid startup, heavy runs approach k (6.2 to
   7.4x / 14 to 24x / 22 to 63x).

## Workloads and method

| id | command (production path, unchanged sources) | exercises |
|---|---|---|
| py-planar-union | `node bin/wonky-python.mjs fixtures/performance-build123d/cases/planar-union.py --python out/build123d-performance/reference-venv/bin/python --out …` | build123d shim, planar union |
| py-planar-pocket | same, `planar-pocket.py` | planar subtraction |
| py-frame-with-tab | same, `frame-with-tab.py` | several planar Booleans |
| fs-bracket | `node bin/wonky.mjs examples/bracket.fs --out …` | extrusion, all exports (B-rep JSON, STEP, STL, HTML) |
| fs-bored-spacer-print | `node bin/wonky.mjs examples/bored-spacer.fs --format print --out …` | cylinder bore, STEP pcurves, print mesh |
| fs-fuse-g1 | `node bin/wonky.mjs fixtures/public-boolean-regressions/adapted/fuse-g1.fs --format step --out …` | planar union |
| fs-cut-h1 | `node bin/wonky.mjs fixtures/public-boolean-regressions/adapted/cut-h1.fs --format step --out …` | planar subtraction |
| fs-r10b-strict | `node bin/wonky.mjs fixtures/r10b/r10b.fs --feature singleStepR10b --check` | frozen Onshape imports, curved intersection; exits 1 at the known unsupported curved union (`UnsupportedArrangement (tool 1, face 2)`), profiled up to that point |

`bin/wonky-python.mjs` calls `buildPython` from `src/python.mjs` with the same reference Python environment and
`trace: true`, which is the path `scripts/benchmark-build123d.mjs` times, with CLI startup and export added.

Tools, all under `scripts/native-bridge/`. None of them edits `src/`, `kernel/` or `bin/`:

- `profile-workloads.mjs` runs each workload in its own process, one at a time, in four modes. `startup`:
  `node -e 0` and both `--help` commands, five times each. `profile`: `node --cpu-prof`, sampling at 250 us for the
  Python cases, bracket and bored-spacer; 500 us for fuse-g1 and cut-h1; 10 ms for r10b, because a 1 ms r10b profile
  was 1.9 GB, beyond V8's string limit for `JSON.parse`. `count`: the preload below. `plain`: uninstrumented, two
  repeats. Every run records `uptime` before and after, wall, user/sys and max RSS (`/usr/bin/time -l`).
- `count-kernel-calls.mjs` is a `node --import` preload. A synchronous `registerHooks` load hook rewrites only the
  final `export default {` statement of each Bend `data:` module, so every exported kernel function is wrapped
  in place. It records outer host-to-kernel calls, inclusive wall time, a duration histogram, the calling host
  frame, and argument/result object-graph sizes: nodes, cons cells, V3, Real, solids with vertex/edge/face counts,
  and how many argument nodes came from earlier kernel results. The size walks run outside the timed region, in a
  separate run from the profile.
- `analyze-profiles.mjs` attributes every sample (one call stack) to a bucket. Any frame of a Bend `data:` module
  other than its top-level body makes the sample **kernel**. Otherwise the leaf-most meaningful frame decides by
  project file (table in the script). ESM loader internals count as module loading unless they run under
  `src/bend-loader.mjs`. `data:` URL decoding, the TypeScript stripper for the Bend compiler's `main.ts`, the ESM
  hooks worker that `main.ts` registers, and `.tools/` all count as **Bend JS load**. Emitted JS maps back to Bend
  definitions without extra instrumentation: each profiled `data:` script is matched to its cache artifact in
  `.tools/bend-js-cache/` by (function name, line), and every sample frame goes to its enclosing top-level JS
  function. The export key (for example `"../real.add"`) then gives the Bend file and definition. Unexported
  `$Type$...` names map to Base, and `run_loop`/`f32_bits` and similar to the Bend JS runtime. All 8 profiles
  matched every script.
- `startup-phases.mjs` times the startup phases directly in fresh processes (5 runs).
- `profile-tables.mjs` renders every table below from the JSON outputs; no number in the tables was typed by hand.

Attribution caveats:

- The primary basis re-attributes each GC and idle sample to the bucket of the preceding non-GC, non-idle sample.
  This follows from how V8 reports them: GC runs in the allocating code, and idle here means waiting on the ESM hooks
  worker or on Python. In the Boolean workloads 71 to 99.7 % of GC follows kernel samples; the rest follows Bend
  loading. The raw table keeps GC and idle separate, and a pessimistic projection leaves GC in JS.
- V8 caps sampled stacks (the deepest r10b sample has 261 frames). For about 14 % of r10b kernel time the host caller
  is cut off. These samples still count as kernel, because their leaf frames are Bend frames, but inclusive times of
  outer Bend definitions are lower bounds there.
- Profiled runs are 1 to 17 % slower than plain runs, so the projections use shares, not absolute profile times.
- The CPU profile starts about 14 ms after process start (the time to the first script line), so the Node start
  bucket misses that part. `node -e 0` takes 24 ms in total.
- An interrupted earlier attempt (runs at load 17 to 23) is kept in `tmp/native-bridge/runs-previous-attempt.json`.
  Its shares agree within a few points; all numbers here come from the refresh between 20:54 and 21:00.

## Results

### Wall time and direct kernel timing

#### Runs

| workload | plain wall ms (2 runs) | profiled ms | count-run kernel ms | kernel / count-run wall | user s | max RSS MiB | load 1m | exit |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| py-planar-union | 2733 / 2683 | 3157 | 1863 | 68.4% | 3.11 | 231 | 11.63-12 | 0 (exp. 0) |
| py-planar-pocket | 4175 / 4351 | 4602 | 3042 | 77.7% | 4.48 | 232 | 12-13.61 | 0 (exp. 0) |
| py-frame-with-tab | 13945 / 13758 | 15476 | 12921 | 93.1% | 14.29 | 237 | 13.61-13.47 | 0 (exp. 0) |
| fs-bracket | 856 / 825 | 905 | 2.30 | 0.3% | 0.83 | 228 | 13.47-13.27 | 0 (exp. 0) |
| fs-bored-spacer-print | 878 / 867 | 914 | 30.5 | 3.5% | 0.89 | 225 | 13.27-13.27 | 0 (exp. 0) |
| fs-fuse-g1 | 2356 / 2227 | 2684 | 1451 | 63.8% | 2.77 | 230 | 13.27-13.94 | 0 (exp. 0) |
| fs-cut-h1 | 6282 / 6140 | 6769 | 5389 | 87.0% | 6.78 | 229 | 13.94-13.78 | 0 (exp. 0) |
| fs-r10b-strict | 55165 / 55779 | 56104 | 53353 | 98.2% | 54.64 | 267 | 13.78-14.65 | 1 (exp. 1) |

The count run times each outer kernel call directly. Its kernel share agrees with the profile's attributed
kernel share within 0 to 4 points (for example 68.4 % against 70.1 % for planar-union and 98.2 % against
98.2 % for r10b).

### Where the time goes

#### Bucket shares, GC and idle re-attributed to the preceding bucket (primary basis)

| workload | Node start | ESM modules | Bend JS load | parse / Py bridge | interpreter | **kernel** | host adapt. | export | V8 (program) | other |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| py-planar-union | 0.3% | 2.5% | 24.7% | 0.1% | 0.0% | **70.1%** | 0.3% | 0.4% | 0.2% | 1.5% |
| py-planar-pocket | 0.2% | 1.5% | 17.0% | 0.6% | 0.0% | **80.0%** | 0.2% | 0.3% | 0.1% | 0.2% |
| py-frame-with-tab | 0.1% | 0.5% | 5.2% | 0.2% | 0.0% | **93.8%** | 0.1% | 0.1% | 0.1% | 0.1% |
| fs-bracket | 0.8% | 9.2% | 87.0% | 0.1% | 0.4% | **0.3%** | 0.3% | 1.4% | 0.4% | 0.2% |
| fs-bored-spacer-print | 1.0% | 7.7% | 81.9% | 0.1% | 0.5% | **4.2%** | 0.4% | 2.1% | 0.9% | 1.1% |
| fs-fuse-g1 | 0.3% | 2.9% | 28.4% | 0.1% | 0.2% | **67.6%** | 0.2% | 0.4% | 0.1% | 0.0% |
| fs-cut-h1 | 0.1% | 1.0% | 11.0% | 0.0% | 0.1% | **87.4%** | 0.1% | 0.1% | 0.1% | 0.0% |
| fs-r10b-strict | 0.0% | 0.2% | 1.3% | 0.1% | 0.0% | **98.2%** | 0.1% | 0.0% | 0.1% | 0.0% |

#### Bucket milliseconds, raw (GC and idle as their own buckets)

| workload | Node start | ESM modules | Bend JS load | parse / Py bridge | interpreter | kernel | host adapt. | export | GC | idle | other |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| py-planar-union | 9.04 | 67.8 | 665 | 3.29 | 0.00 | 2069 | 8.38 | 3.67 | 176 | 139 | 10.1 |
| py-planar-pocket | 8.54 | 68.0 | 658 | 2.96 | 0.00 | 3424 | 8.29 | 4.46 | 286 | 129 | 7.34 |
| py-frame-with-tab | 8.46 | 66.7 | 674 | 4.25 | 0.42 | 13343 | 15.8 | 8.50 | 1196 | 142 | 11.8 |
| fs-bracket | 6.79 | 71.4 | 657 | 1.13 | 3.75 | 2.46 | 2.33 | 5.38 | 41.0 | 103 | 5.29 |
| fs-bored-spacer-print | 8.25 | 68.6 | 639 | 1.13 | 5.00 | 37.3 | 3.79 | 11.1 | 30.3 | 95.7 | 9.50 |
| fs-fuse-g1 | 6.54 | 72.0 | 638 | 1.50 | 4.42 | 1711 | 5.25 | 3.00 | 140 | 95.3 | 3.46 |
| fs-cut-h1 | 7.33 | 66.3 | 623 | 1.46 | 5.13 | 5534 | 7.54 | 3.75 | 414 | 97.2 | 5.42 |
| fs-r10b-strict | 0.00 | 78.3 | 656 | 32.8 | 13.8 | 46264 | 54.3 | 4.88 | 8875 | 106 | 25.3 |

#### Where GC and idle go (ms re-attributed by preceding bucket)

| workload | raw GC ms | GC share | GC -> kernel | idle ms | idle -> Bend load | idle -> ESM | idle -> Py bridge |
|---|---:|---:|---:|---:|---:|---:|---:|
| py-planar-union | 176 | 5.6% | 140 | 139 | 79.3 | 9.71 |  |
| py-planar-pocket | 286 | 6.2% | 254 | 129 | 93.1 |  | 22.9 |
| py-frame-with-tab | 1196 | 7.7% | 1164 | 142 | 102 | 3.38 | 22.8 |
| fs-bracket | 41.0 | 4.5% | 0.00 | 103 | 86.1 | 9.38 |  |
| fs-bored-spacer-print | 30.3 | 3.3% | 1.09 | 95.7 | 77.5 | 0.79 |  |
| fs-fuse-g1 | 140 | 5.2% | 100 | 95.3 | 84.3 | 3.58 |  |
| fs-cut-h1 | 414 | 6.1% | 380 | 97.2 | 90.6 |  |  |
| fs-r10b-strict | 8875 | 15.8% | 8852 | 106 | 92.6 |  |  |

GC is 3 to 16 % of raw wall time. In the Boolean workloads 71 to 99.7 % of it follows kernel samples (the rest
follows Bend loading), so it is mostly allocation churn of the JS kernel. That fits the emitted code: cons cells,
V3/Real objects, and `f32_bits` allocating two typed arrays per call. Allocation itself was not profiled. In the
small models GC follows Bend loading. Idle time is about 95 to 140 ms in every run.
Most of it (77 to 102 ms) is the main thread waiting on the ESM hooks worker thread while Bend modules load. About
23 to 41 ms in the Python cases is waiting for the Python subprocess, and 7 to 13 ms is output I/O (under export).

### Startup: the fixed cost of the JS kernel

#### Startup phases (fresh processes, warm Bend cache, medians of 5)

| phase | ms |
|---|---:|
| `node -e 0` (profile-workloads startup mode, min of 5) | 23.9 |
| `bin/wonky.mjs --help` (min of 5) | 160 |
| `bin/wonky-python.mjs --help` (min of 5) | 156 |
| process start to first script line | 14.3 |
| import src/index.mjs graph (before hooks) | 9.20 |
| registerBendImports() (Bend compiler main.ts, TypeScript strip, hooks) | 81.8 |
| 18 x compileBend() cache hit (fingerprint, read, verify) | 436 |
| 18 x import() of data: module | 145 |
| **loadKernel() total** | **665** |
| spawn reference Python `-I -S -B -u -c pass` | 12.7 |

| Bend module (loadKernel order) | emitted JS KiB | compileBend ms | import ms |
|---|---:|---:|---:|
| kernel/topology.bend | 15 | 28.0 | 7.19 |
| kernel/analytic.bend | 69 | 17.7 | 2.79 |
| kernel/real.bend | 12 | 14.8 | 1.23 |
| kernel/precise.bend | 17 | 15.5 | 1.30 |
| kernel/boolean.bend | 99 | 18.4 | 3.68 |
| kernel/comparison.bend | 21 | 14.7 | 1.28 |
| kernel/identity.bend | 33 | 14.9 | 1.58 |
| kernel/face-classification.bend | 205 | 20.9 | 6.31 |
| kernel/halfspace.bend | 365 | 26.2 | 9.97 |
| kernel/sketch-lines.bend | 141 | 18.7 | 4.63 |
| kernel/sketch-arcs.bend | 602 | 36.0 | 15.8 |
| kernel/ports/solid-intersection.bend | 673 | 36.9 | 16.8 |
| kernel/ports/curved.bend | 689 | 36.7 | 16.9 |
| kernel/ports/curved-intersection.bend | 1119 | 52.4 | 27.2 |
| kernel/ports/planar-boolean.bend | 681 | 36.4 | 16.5 |
| kernel/revolve.bend | 82 | 15.8 | 2.80 |
| kernel/tessellate.bend | 20 | 12.9 | 1.21 |
| kernel/pierce.bend | 98 | 16.0 | 3.25 |

Load averages during the phase runs: 12.88, 12.73, 12.73, 12.73, 12.73.

`--help` already costs 160 ms against 24 ms for `node -e 0`, because `src/exporters.mjs` loads the
`step-pcurves` and `step-cylinder-pcurves` Bend modules at import time (about 110 ms of the 150 ms profiled). A
modeling run then adds `loadKernel()`, which takes 665 ms:

- `registerBendImports()`, 82 ms. It imports the Bend compiler's `main.ts` through Node's TypeScript stripper and
  registers ESM customization hooks. Every later import, including the 18 kernel `data:` modules, then makes a
  synchronous round trip to the hooks worker. That wait is the 77 to 102 ms of idle attributed to Bend load above.
- 18 cache hits of `compileBend()`, 436 ms. Each call fingerprints the whole compiler directory (96 files, re-read
  and re-hashed) and re-lexes every `.bend` file in the module's import closure for foreign-JS imports
  (`foreignJsPaths` is the single hottest function in the small models). All of this happens twice per module,
  before and after (`assertStable`).
- 18 `import()` calls of 4.8 MiB of emitted JS, 145 ms.

This is a property of the JS reference backend, not of the binding. A native production path should not pay it at
all (section C below). The JS path could also memoize the compiler fingerprint per process. That fix lies outside this
stage's writable paths and was not measured.

### Kernel execution

#### Kernel self time by Bend source file (share of each workload's kernel time; workloads with > 50 ms kernel)

| Bend file | py-planar-union | py-planar-pocket | py-frame-with-tab | fs-fuse-g1 | fs-cut-h1 | fs-r10b-strict |
|---|---:|---:|---:|---:|---:|---:|
| kernel/solid-classification.bend | 3.2% | 5.9% | 5.1% | 2.7% | 3.6% | 93.6% |
| kernel/real.bend | 20.4% | 20.4% | 21.1% | 22.5% | 23.4% | 0.7% |
| bend-js-runtime | 16.9% | 18.7% | 19.6% | 20.1% | 18.8% | 2.0% |
| kernel/intersections.bend | 17.9% | 18.1% | 19.4% | 17.4% | 18.9% | 0.8% |
| kernel/face-classification.bend | 10.4% | 10.0% | 11.4% | 11.5% | 11.0% | 0.4% |
| kernel/curve-plane.bend | 10.7% | 9.4% | 10.3% | 9.4% | 10.4% | 0.1% |
| Base (bend2/base.bend) | 7.7% | 5.9% | 4.3% | 4.5% | 4.5% | 0.9% |
| kernel/precise.bend | 4.4% | 5.4% | 5.1% | 6.2% | 5.1% | 0.2% |
| kernel/halfspace.bend | 1.9% | 2.0% | 0.9% | 1.3% | 1.4% | 0.7% |
| kernel/ray.bend | 1.4% | 1.2% | 1.1% | 1.3% | 0.7% |  |
| kernel/analytic.bend | 2.7% | 0.5% | 0.4% | 0.6% | 0.3% | 0.1% |
| kernel/ports/planar-boolean-arrangement.bend | 0.4% | 0.5% | 0.2% | 0.4% | 0.3% |  |
| kernel/ports/planar-boolean-selection.bend | 0.3% | 0.4% | 0.1% | 0.5% | 0.2% |  |
| kernel/ports/occt-planar.bend | 0.2% | 0.3% | 0.2% | 0.4% | 0.1% |  |
| kernel/boundary.bend | 0.2% | 0.2% | 0.1% | 0.2% | 0.5% | 0.1% |
| kernel/ports/planar-boolean-provenance.bend | 0.3% | 0.2% | 0.3% | 0.2% | 0.2% |  |

#### Kernel time by host entry module and host call site

| workload | kernel ms | top entry module (share of run) | top host call site (share of run) | kernel under export |
|---|---:|---|---|---:|
| py-planar-union | 2069 | kernel/ports/planar-boolean.bend (63.5%) | src/boolean.mjs:booleanInBend:27 (63.5%) | 0 |
| py-planar-pocket | 3424 | kernel/ports/planar-boolean.bend (71.0%) | src/boolean.mjs:booleanInBend:27 (71.0%) | 0 |
| py-frame-with-tab | 13343 | kernel/ports/planar-boolean.bend (84.0%) | src/boolean.mjs:booleanInBend:27 (83.9%) | 0 |
| fs-fuse-g1 | 1711 | kernel/ports/planar-boolean.bend (62.0%) | src/boolean.mjs:booleanInBend:27 (62.0%) | 0 |
| fs-cut-h1 | 5534 | kernel/ports/planar-boolean.bend (79.5%) | src/boolean.mjs:booleanInBend:27 (79.4%) | 0 |
| fs-r10b-strict | 46264 | kernel/ports/curved-intersection.bend (82.2%) | src/boolean.mjs:booleanInBend:27 (68.3%) | 0 |

#### Top-20 self-time functions, Boolean set summed (py-planar-union, py-planar-pocket, py-frame-with-tab, fs-fuse-g1, fs-cut-h1)

| # | function (Bend file:definition or JS file:function:line) | bucket | ms | share |
|---:|---|---|---:|---:|
| 1 | `bend-js-runtime:run_loop` | kernel | 3326 | 10.2% |
| 2 | `(native):(garbage collector)` | gc | 2211 | 6.8% |
| 3 | `kernel/real.bend:renorm` | kernel | 2178 | 6.7% |
| 4 | `bend-js-runtime:f32_bits` | kernel | 1490 | 4.6% |
| 5 | `kernel/real.bend:mul` | kernel | 848 | 2.6% |
| 6 | `kernel/intersections.bend:scalar_valid` | kernel | 827 | 2.5% |
| 7 | `kernel/intersections.bend:magnitude` | kernel | 726 | 2.2% |
| 8 | `kernel/real.bend:abs` | kernel | 616 | 1.9% |
| 9 | `(native):(idle)` | idle | 603 | 1.8% |
| 10 | `kernel/real.bend:add` | kernel | 491 | 1.5% |
| 11 | `src/bend-loader.mjs:foreignJsPaths:66` | bendLoad | 484 | 1.5% |
| 12 | `kernel/curve-plane.bend:line_root` | kernel | 479 | 1.5% |
| 13 | `Base (bend2/base.bend):List/get` | kernel | 478 | 1.5% |
| 14 | `kernel/solid-classification.bend:count_uses` | kernel | 468 | 1.4% |
| 15 | `(native):lstat` | bendLoad | 446 | 1.4% |
| 16 | `kernel/face-classification.bend:vertex_clear` | kernel | 421 | 1.3% |
| 17 | `kernel/precise.bend:sub` | kernel | 391 | 1.2% |
| 18 | `kernel/intersections.bend:exact_product` | kernel | 377 | 1.2% |
| 19 | `Base (bend2/base.bend):Bool/pick` | kernel | 375 | 1.1% |
| 20 | `kernel/intersections.bend:input_scale` | kernel | 357 | 1.1% |

#### Top-20 self-time functions, fs-r10b-strict

| # | function | bucket | ms | share |
|---:|---|---|---:|---:|
| 1 | `kernel/solid-classification.bend:count_uses` | kernel | 23221 | 41.4% |
| 2 | `kernel/solid-classification.bend:count_faces` | kernel | 12361 | 22.0% |
| 3 | `(native):(garbage collector)` | gc | 8875 | 15.8% |
| 4 | `kernel/solid-classification.bend:plus_uses` | kernel | 4942 | 8.8% |
| 5 | `kernel/solid-classification.bend:count_loops` | kernel | 2774 | 4.9% |
| 6 | `bend-js-runtime:run_loop` | kernel | 794 | 1.4% |
| 7 | `Base (bend2/base.bend):List/get` | kernel | 356 | 0.6% |
| 8 | `kernel/intersections.bend:magnitude` | kernel | 148 | 0.3% |
| 9 | `kernel/face-classification.bend:edges_scale` | kernel | 118 | 0.2% |
| 10 | `(native):(idle)` | idle | 106 | 0.2% |
| 11 | `kernel/halfspace.bend:touches_uses` | kernel | 100 | 0.2% |
| 12 | `kernel/real.bend:mul` | kernel | 99.4 | 0.2% |
| 13 | `src/bend-loader.mjs:foreignJsPaths:66` | bendLoad | 93.9 | 0.2% |
| 14 | `(native):RegExp: [A-Za-z0-9_]` | bendLoad | 81.6 | 0.1% |
| 15 | `node:internal/modules/esm/utils:compileSourceTextModule:344` | moduleLoading | 78.3 | 0.1% |
| 16 | `(native):lstat` | bendLoad | 73.5 | 0.1% |
| 17 | `kernel/real.bend:renorm` | kernel | 72.1 | 0.1% |
| 18 | `bend-js-runtime:f32_bits` | kernel | 70.2 | 0.1% |
| 19 | `kernel/intersections.bend:grow_words` | kernel | 70.2 | 0.1% |
| 20 | `bend-js-runtime:run_jump` | kernel | 66.3 | 0.1% |

#### Top-20 self-time functions, fs-bracket (startup-dominated)

| # | function | bucket | ms | share |
|---:|---|---|---:|---:|
| 1 | `src/bend-loader.mjs:foreignJsPaths:66` | bendLoad | 103 | 11.5% |
| 2 | `(native):(idle)` | idle | 103 | 11.5% |
| 3 | `(native):lstat` | bendLoad | 91.3 | 10.1% |
| 4 | `(native):open` | bendLoad | 77.3 | 8.6% |
| 5 | `node:internal/modules/esm/utils:compileSourceTextModule:344` | moduleLoading | 59.6 | 6.6% |
| 6 | `(native):(garbage collector)` | gc | 41.0 | 4.6% |
| 7 | `node:internal/modules/esm/hooks:makeSyncRequest:598` | bendLoad | 35.5 | 3.9% |
| 8 | `(native):RegExp: [A-Za-z0-9_]` | bendLoad | 33.3 | 3.7% |
| 9 | `src/bend-loader.mjs:visit:104` | bendLoad | 31.8 | 3.5% |
| 10 | `node:internal/crypto/hash:update:132` | bendLoad | 27.6 | 3.1% |
| 11 | `(native):RegExp: \s` | bendLoad | 25.0 | 2.8% |
| 12 | `node:internal/modules/esm/hooks:waitForWorker:519` | bendLoad | 24.7 | 2.7% |
| 13 | `src/bend-loader.mjs:space:69` | bendLoad | 17.8 | 2.0% |
| 14 | `(native):read` | bendLoad | 15.8 | 1.8% |
| 15 | `(native):RegExp: [A-Za-z_]` | bendLoad | 14.6 | 1.6% |
| 16 | `node:fs:realpathSync:2715` | bendLoad | 12.6 | 1.4% |
| 17 | `(native):readdir` | bendLoad | 8.67 | 1.0% |
| 18 | `src/bend-loader.mjs:readArtifact:210` | bendLoad | 8.46 | 0.9% |
| 19 | `node:internal/deps/amaro/dist/index:__require:8` | bendLoad | 8.13 | 0.9% |
| 20 | `src/bend-loader.mjs:(anonymous):52` | bendLoad | 6.25 | 0.7% |

#### Top Bend definitions by inclusive time, Boolean set summed

| # | Bend definition | ms | share |
|---:|---|---:|---:|
| 1 | `kernel/ports/planar-boolean.bend:arranged` | 23170 | 70.9% |
| 2 | `kernel/ports/planar-boolean-selection.bend:select` | 23170 | 70.9% |
| 3 | `kernel/ports/planar-boolean-selection.bend:classify_cell` | 22979 | 70.3% |
| 4 | `kernel/solid-classification.bend:after_boundary` | 22221 | 68.0% |
| 5 | `kernel/solid-classification.bend:cast_lines` | 22207 | 68.0% |
| 6 | `kernel/solid-classification.bend:line_faces` | 22169 | 67.9% |
| 7 | `kernel/solid-classification.bend:membership_face` | 21824 | 66.8% |
| 8 | `kernel/solid-classification.bend:count_roots` | 21400 | 65.5% |
| 9 | `kernel/face-classification.bend:classify_rays` | 16844 | 51.6% |
| 10 | `kernel/face-classification.bend:ray_directions` | 16536 | 50.6% |
| 11 | `kernel/face-classification.bend:ray_loops` | 15261 | 46.7% |
| 12 | `kernel/face-classification.bend:ray_edges` | 15199 | 46.5% |

#### Top Bend definitions by inclusive time, fs-r10b-strict

| # | Bend definition | ms | share |
|---:|---|---:|---:|
| 1 | `kernel/solid-classification.bend:count_faces` | 43872 | 78.2% |
| 2 | `kernel/halfspace.bend:connectivity_pass` | 43837 | 78.1% |
| 3 | `kernel/halfspace.bend:touches_loops` | 43769 | 78.0% |
| 4 | `kernel/halfspace.bend:touches_uses` | 43765 | 78.0% |
| 5 | `kernel/halfspace.bend:connectivity_steps` | 37588 | 67.0% |
| 6 | `kernel/halfspace.bend:connected` | 32030 | 57.1% |
| 7 | `kernel/ports/curved-intersection.bend:clip_body` | 31658 | 56.4% |
| 8 | `kernel/ports/curved-intersection.bend:clip_bodies` | 31556 | 56.2% |
| 9 | `kernel/ports/curved-intersection.bend:clip_faces` | 31516 | 56.2% |
| 10 | `kernel/ports/curved-intersection.bend:selected` | 31349 | 55.9% |
| 11 | `kernel/solid-classification.bend:count_loops` | 30176 | 53.8% |
| 12 | `kernel/solid-classification.bend:count_uses` | 26644 | 47.5% |

Reading the kernel profile:

- **Planar Booleans** (all five Boolean-set workloads): about 70 % of wall time sits under
  `planar-boolean-selection.bend:classify_cell`. It classifies arrangement cells by casting rays
  (`solid-classification.bend:count_roots`, `face-classification.bend:classify_rays`). The self time is double-word
  arithmetic in `real.bend` (`renorm`, `mul`, `add`, `abs`: about 21 % of kernel self time) and exact expansion
  arithmetic in `intersections.bend` (about 18 %). The Bend JS runtime takes 17 to 20 % of kernel self time: the
  `run_loop` trampoline is 10 % of the whole Boolean-set wall time, and `f32_bits` allocates two typed arrays per
  call. That runtime overhead exists only on the JS target.
- **r10b**: 94 % of kernel self time is in four `solid-classification.bend` list folds (`count_uses`,
  `count_faces`, `plus_uses`, `count_loops`). They are reached from `halfspace.bend:connectivity_pass` ->
  `touches_uses`. For every edge use of every face, that pass calls `count_faces` over all known faces, and
  `connectivity_steps` repeats the pass. This is an algorithmic hotspot. A native kernel divides it by k but does not
  change how it grows with face count.
- No workload runs meaningful kernel time from export. The largest case is bored-spacer, where STEP cylinder pcurves
  and print-mesh rings take 29 ms, 3.2 % of its run.

### Host adaptation, frontend and export

#### Host adaptation, interpreter, frontend and export sub-buckets (ms, raw)

| bucket | source | py-planar-union | py-planar-pocket | py-frame-with-tab | fs-bracket | fs-bored-spacer-print | fs-fuse-g1 | fs-cut-h1 | fs-r10b-strict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| hostAdaptation | analytic.mjs (kernel glue) | 2.46 | 1.50 | 4.58 |  | 2.58 | 0.75 | 3.00 | 24.0 |
| frontendParse | FeatureScript parser |  |  |  | 1.13 | 1.13 | 1.50 | 1.46 | 32.8 |
| hostAdaptation | identity.mjs (topology identity) | 2.42 | 2.00 | 4.25 |  | 0.75 |  | 1.54 | 19.5 |
| export | bin/wonky.mjs (CLI body: serialize + write) |  |  |  | 0.71 | 6.21 | 2.25 | 2.42 | 4.88 |
| interpreter | source-map.mjs (model trace) |  |  | 0.42 |  | 0.46 |  | 0.75 | 13.8 |
| hostAdaptation | real.mjs (Real/V3 encoders) | 0.42 | 1.13 | 1.42 |  |  |  | 0.79 | 10.8 |
| export | bin/wonky-python.mjs (CLI body: serialize + write) | 2.79 | 3.29 | 6.96 |  |  |  |  |  |
| frontendParse | Python bridge (JSON lines, session) | 3.29 | 2.96 | 4.25 |  |  |  |  |  |
| interpreter | library.mjs (std builtins) |  |  |  | 1.92 | 1.88 | 1.50 | 2.25 |  |
| interpreter | interpreter.mjs |  |  |  | 1.04 | 2.29 | 2.92 | 0.79 |  |
| hostAdaptation | brep.mjs (validateSolid) | 1.21 | 0.46 | 1.92 | 1.54 |  | 0.75 | 0.71 |  |
| export | exporters.mjs (STEP/STL text) | 0.88 | 1.17 | 1.54 | 0.83 | 0.42 | 0.75 | 0.63 |  |
| export | preview.mjs (HTML) |  |  |  | 3.83 |  |  |  |  |
| export | print-mesh.mjs |  |  |  |  | 3.71 |  |  |  |
| hostAdaptation | planar-boolean.mjs (kernel glue) | 0.33 | 0.75 | 0.79 |  |  | 0.75 | 0.75 |  |
| hostAdaptation | boolean.mjs (kernel glue) | 0.38 | 0.42 | 1.04 |  |  | 1.46 |  |  |
| hostAdaptation | kernel.mjs (list/array/vector/decodeSolid) | 0.42 | 1.29 | 0.33 | 0.79 |  |  |  |  |
| hostAdaptation | face-classification.mjs (kernel glue) | 0.75 | 0.75 | 0.38 |  |  | 0.75 |  |  |
| hostAdaptation | construction-history.mjs |  |  | 1.13 |  | 0.46 |  | 0.75 |  |
| interpreter | index.mjs (build driver) |  |  |  | 0.42 | 0.38 |  | 0.58 |  |
| export | bin/wonky.mjs |  |  |  |  | 0.42 |  | 0.71 |  |
| hostAdaptation | queries.mjs (walk decoded bodies) |  |  |  |  |  | 0.79 |  |  |

Everything the JS host does around the kernel adds up to 2 to 16 ms per run (54 ms for r10b, which imports
frozen Onshape bodies with about 190 faces). The largest items are analytic-surface glue (`analytic.mjs`),
topology identity (`identity.mjs`), the `Real`/`V3` encoders and `validateSolid`. The FeatureScript parser needs
1.1 to 1.5 ms for the examples and 33 ms for r10b.

### Kernel calls and argument sizes

#### Host -> kernel calls (separate instrumented run)

| workload | calls | entries | <10 us | <100 us | <1 ms | <10 ms | >=10 ms | largest call | arg / result nodes | est. wire KiB in / out | args from earlier kernel results | est. binding overhead ms |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| py-planar-union | 253 | 17 | 164 | 77 | 6 | 4 | 2 | `ports/planar-boolean.bend:union` 1812 ms (97.2% of kernel) | 7432 / 2744 | 62 / 19 | 41.1% | 0.38 |
| py-planar-pocket | 413 | 17 | 303 | 97 | 7 | 4 | 2 | `ports/planar-boolean.bend:subtract` 2912 ms (95.7% of kernel) | 11326 / 3999 | 95 / 28 | 40.2% | 0.61 |
| py-frame-with-tab | 839 | 18 | 722 | 98 | 8 | 7 | 4 | `ports/planar-boolean.bend:union` 9872 ms (76.4% of kernel) | 25244 / 8104 | 211 / 57 | 38.2% | 1.27 |
| fs-bracket | 5 | 5 | 0 | 3 | 1 | 1 | 0 | `identity.bend:extrusion` 1.81 ms (78.7% of kernel) | 49 / 292 | 1 / 2 | 63.3% | 0.01 |
| fs-bored-spacer-print | 96 | 21 | 17 | 65 | 10 | 3 | 1 | `step-cylinder-pcurves.bend:for_cylinders_domains` 14.6 ms (47.8% of kernel) | 1495 / 1528 | 14 / 12 | 10.4% | 0.14 |
| fs-fuse-g1 | 202 | 16 | 112 | 81 | 4 | 3 | 2 | `ports/planar-boolean.bend:union` 1414 ms (97.5% of kernel) | 5952 / 2097 | 50 / 15 | 43.2% | 0.31 |
| fs-cut-h1 | 422 | 16 | 346 | 65 | 5 | 4 | 2 | `ports/planar-boolean.bend:subtract` 5272 ms (97.8% of kernel) | 12848 / 4027 | 108 / 29 | 42.6% | 0.64 |
| fs-r10b-strict | 18604 | 29 | 17846 | 731 | 17 | 9 | 1 | `ports/curved-intersection.bend:intersect` 53275 ms (99.9% of kernel) | 357235 / 101418 | 3139 / 798 | 24.5% | 24.9 |

#### Kernel entry points across all workloads (by inclusive ms)

| entry (Bend module:export) | workloads | calls | ms | mean ms | max arg nodes/call | max faces in/call |
|---|---:|---:|---:|---:|---:|---:|
| `ports/curved-intersection.bend:intersect` | 1 | 1 | 53275 | 53275 | 15133 | 195 |
| `ports/planar-boolean.bend:union` | 3 | 3 | 13099 | 4366 | 2373 | 38 |
| `ports/planar-boolean.bend:subtract` | 3 | 3 | 10920 | 3640 | 907 | 16 |
| `ports/curved.bend:audit` | 5 | 6 | 556 | 92.7 | 2379 | 48 |
| `identity.bend:boolean_result` | 6 | 7 | 36.0 | 5.15 | 5 | 0 |
| `analytic.bend:curve_residual` | 7 | 7244 | 24.2 | 0.00 | 16 | 0 |
| `ports/solid-intersection.bend:planar_measures` | 5 | 6 | 19.3 | 3.22 | 1894 | 48 |
| `identity.bend:transform` | 4 | 8 | 16.4 | 2.06 | 4037 | 0 |
| `step-cylinder-pcurves.bend:for_cylinders_domains` | 1 | 1 | 14.6 | 14.6 | 236 | 4 |
| `identity.bend:box` | 5 | 9 | 11.7 | 1.30 | 0 | 0 |
| `analytic.bend:surface_residual` | 7 | 9296 | 11.4 | 0.00 | 18 | 0 |
| `analytic.bend:transform` | 1 | 3 | 11.1 | 3.70 | 13698 | 189 |
| `identity.bend:from_source` | 1 | 1019 | 8.88 | 0.01 | 3 | 0 |
| `tessellate.bend:ring` | 1 | 4 | 7.35 | 1.84 | 13 | 0 |
| `identity.bend:extrusion` | 4 | 4 | 5.16 | 1.29 | 0 | 0 |
| `analytic.bend:plane` | 1 | 163 | 4.30 | 0.03 | 8 | 0 |
| `analytic.bend:with_seams` | 1 | 1 | 3.35 | 3.35 | 13489 | 189 |
| `precise.bend:normalize` | 2 | 707 | 2.95 | 0.00 | 4 | 0 |

#### Entry points by call count (the chatty ones)

| entry | calls | ms | mean us |
|---|---:|---:|---:|
| `analytic.bend:surface_residual` | 9296 | 11.4 | 1.2 |
| `analytic.bend:curve_residual` | 7244 | 24.2 | 3.3 |
| `identity.bend:from_source` | 1019 | 8.88 | 8.7 |
| `precise.bend:distance` | 962 | 2.58 | 2.7 |
| `precise.bend:dot` | 709 | 0.86 | 1.2 |
| `precise.bend:normalize` | 707 | 2.95 | 4.2 |
| `analytic.bend:cylinder_line_residual` | 164 | 2.18 | 13.3 |
| `analytic.bend:plane` | 163 | 4.30 | 26.4 |
| `face-classification.bend:linear_edge` | 156 | 1.80 | 11.5 |
| `analytic.bend:axis_x` | 53 | 0.26 | 4.9 |

Per-workload, per-entry-point lists (calls, inclusive ms, histogram, argument and result sizes, calling host
frame) are in `out/native-bridge/profile/summary.json` under `workloads.<id>.calls.entries`, and complete in
`analysis/<id>.json`.

The estimated binding overhead is `calls x 1 us + wire bytes in x 1.51 ns + wire bytes out x 1.73 ns`. The
constants come from the binding stage's in-process N-API probe
(`out/native-bridge/binding/latency-t1.json`, u32 packing, 64 B and 1 MB rows). Wire bytes assume one 32-bit
word per number and per object node (tag or cons cell). The count run's instrumented graph walk, a heavier stand-in
for a JS-side encoder (it deduplicates through a `Set`), took 0.3 to 8 ms per run and 81 ms for r10b (177 to
880 ns per node).

What this says about the binding API:

- Granularity: calls at today's kernel entry points (one call per modeling operation) are fine. The hot calls are
  few and long (1 to 4 calls of 10 ms or more per heavy run). The chatty calls (`analytic.surface_residual`,
  `curve_residual`, `identity.from_source`, `precise.*`, 1 to 26 us each in JS) add up to under 60 ms across all
  eight runs. Batching them is optional.
- Residency: in the Boolean workloads 24 to 43 % of argument nodes are earlier kernel results passed back in. Keeping solids as native
  handles would avoid re-marshaling them. At these sizes (at most 3.1 MiB of arguments per run) that is a design
  choice for exactness and simplicity, not a performance requirement.
- Exactness: the binding must carry `Real` as its two F32 words, not through a JS double. The existing host round
  trip already changes low F32x2 words (`nativeChainExact: false` in `out/performance/native-build123d/captured.json`).

### Ceiling for a native kernel binding (Amdahl)

Symbols, from one profiled run per workload (attributed basis):

- T is the total sampled time.
- K is kernel execution plus the GC that follows it.
- H is host adaptation.
- B is the Bend JS load, including its hooks waits and GC.
- S_start is Node start plus ESM module graph plus B.
- U = T − S_start is the resident-session work.
- L is the addon load plus init. It is the median of the binding stage's six measured loads, 0.97 ms; the first load
  after a rebuild took 287 ms.
- O is the estimated binding overhead above.

k is a free parameter. The values 7.5, 25 and 75 are the native/JS ratios measured in `docs/hardware-performance.md`
on other workloads: 16k through-hole Booleans at 1 ARM64 thread (7.45x), 262k cylinder comparisons at 1 thread
(25.3x), and the Boolean batch at 18 threads (75x). `docs/build123d-performance.md` states explicitly that those
ratios cannot be carried over to the planar cases. They only span a plausible range here. The hot calls in these
workloads are single large Booleans, so an 18-thread k would need fork-join parallelism inside one Boolean, which
nothing measured so far shows.

The primary basis counts kernel-caused GC as kernel time. The measured k values compare whole JS runs (GC included)
with native runs, and a native kernel allocates no JS objects. The last table leaves GC in JS as a pessimistic
bound.

Worked arithmetic, py-frame-with-tab (T = 15471 ms, K = 14508 ms, B = 806 ms, S_start = 886 ms, L = 0.97 ms, O = 1.27 ms):

- A, k = 25: T − K + K/k = 963.3 + 580.3 = 1543.6 ms, so S = 15471 / 1543.6 = **10.02x**. The limit is
  15471 / 963.3 = 16.06x.
- C, k = 25: 963.3 + 580.3 − 806.2 + 0.97 + 1.27 = 739.6 ms, so S = **20.92x**.
- D, k = 25: U = 15471 − 886 = 14585.6 ms; U − K + K/k = 77.8 + 580.3 = 658.1 ms, so S = **22.16x**.

fs-bracket (T = 900 ms, K = 2.5 ms, B = 782.5 ms):

- A: 897.4 + 0.1 = 897.5 ms, so S = **1.00x** for any k.
- C: 897.4 + 0.1 − 782.5 + 0.97 + 0.01 = 116.0 ms, so S = **7.76x**. The kernel plays no role; this is the JS
  kernel load disappearing.
- With L = 287 ms (first load after a rebuild), C drops to 2.24x.

fs-r10b-strict (T = 56111 ms, K = 55116 ms):

- A, k = 7.5: 995.1 + 7348.8 = 8343.9 ms, so S = **6.72x**.
- A, k = 75: 995.1 + 734.9 = 1730.0 ms, so S = **32.43x**.
- If GC stays in JS (raw basis, K = 46264 ms), the limit is **5.70x**, because 8.9 s of GC would remain.

#### A. Kernel k times faster, everything else unchanged: S = T / (T - K + K/k)

| workload | T ms | k = 7.5 | k = 25 | k = 75 | k -> inf |
|---|---:|---:|---:|---:|---:|
| py-planar-union | 3152 | 2.55x | 3.06x | 3.24x | 3.34x |
| py-planar-pocket | 4597 | 3.26x | 4.31x | 4.75x | 5.00x |
| py-frame-with-tab | 15471 | 5.34x | 10.02x | 13.38x | 16.06x |
| fs-bracket | 900 | 1.00x | 1.00x | 1.00x | 1.00x |
| fs-bored-spacer-print | 910 | 1.04x | 1.04x | 1.04x | 1.04x |
| fs-fuse-g1 | 2680 | 2.41x | 2.85x | 3.00x | 3.08x |
| fs-cut-h1 | 6764 | 4.13x | 6.22x | 7.28x | 7.95x |
| fs-r10b-strict | 56111 | 6.72x | 17.54x | 32.43x | 56.39x |

#### B. Kernel and host adaptation k times faster: S = T / (T - K - H + (K+H)/k)

| workload | T ms | k = 7.5 | k = 25 | k = 75 | k -> inf |
|---|---:|---:|---:|---:|---:|
| py-planar-union | 3152 | 2.56x | 3.08x | 3.27x | 3.38x |
| py-planar-pocket | 4597 | 3.28x | 4.35x | 4.80x | 5.06x |
| py-frame-with-tab | 15471 | 5.37x | 10.12x | 13.56x | 16.33x |
| fs-bracket | 900 | 1.00x | 1.00x | 1.00x | 1.00x |
| fs-bored-spacer-print | 910 | 1.04x | 1.05x | 1.05x | 1.05x |
| fs-fuse-g1 | 2680 | 2.42x | 2.86x | 3.02x | 3.10x |
| fs-cut-h1 | 6764 | 4.14x | 6.26x | 7.34x | 8.03x |
| fs-r10b-strict | 56111 | 6.76x | 17.83x | 33.47x | 59.64x |

#### C. Native CLI: kernel k times faster and the addon replaces the Bend JS load: S = T / (T - K + K/k - B + L + O)

| workload | T ms | k = 7.5 | k = 25 | k = 75 | k -> inf |
|---|---:|---:|---:|---:|---:|
| py-planar-union | 3152 | 6.85x | 12.43x | 16.18x | 19.07x |
| py-planar-pocket | 4597 | 7.31x | 16.10x | 24.52x | 33.21x |
| py-frame-with-tab | 15471 | 7.39x | 20.92x | 43.86x | 97.13x |
| fs-bracket | 900 | 7.74x | 7.76x | 7.76x | 7.76x |
| fs-bored-spacer-print | 910 | 6.85x | 7.04x | 7.10x | 7.13x |
| fs-fuse-g1 | 2680 | 7.62x | 14.69x | 19.97x | 24.36x |
| fs-cut-h1 | 6764 | 7.56x | 19.71x | 36.45x | 63.39x |
| fs-r10b-strict | 56111 | 7.37x | 22.71x | 56.03x | 210.57x |

#### D. Resident session (startup already paid): S = U / (U - K + K/k), U = T - S_start

| workload | U ms | k = 7.5 | k = 25 | k = 75 | k -> inf |
|---|---:|---:|---:|---:|---:|
| py-planar-union | 2286 | 6.17x | 13.89x | 21.64x | 30.00x |
| py-planar-pocket | 3738 | 6.80x | 18.09x | 34.42x | 62.76x |
| py-frame-with-tab | 14586 | 7.25x | 22.16x | 53.78x | 187.57x |
| fs-bracket | 27.9 | 1.08x | 1.09x | 1.09x | 1.10x |
| fs-bored-spacer-print | 85.2 | 1.64x | 1.76x | 1.80x | 1.82x |
| fs-fuse-g1 | 1836 | 6.89x | 18.83x | 37.32x | 73.29x |
| fs-cut-h1 | 5944 | 7.26x | 22.30x | 54.64x | 198.58x |
| fs-r10b-strict | 55260 | 7.38x | 23.52x | 62.85x | 382.77x |

#### A (pessimistic). Raw buckets, GC stays in JS: S = T / (T - K + K/k)

| workload | T ms | k = 7.5 | k = 25 | k = 75 | k -> inf |
|---|---:|---:|---:|---:|---:|
| py-planar-union | 3152 | 2.32x | 2.70x | 2.84x | 2.91x |
| py-planar-pocket | 4597 | 2.82x | 3.51x | 3.77x | 3.92x |
| py-frame-with-tab | 15471 | 3.96x | 5.81x | 6.71x | 7.27x |
| fs-bracket | 900 | 1.00x | 1.00x | 1.00x | 1.00x |
| fs-bored-spacer-print | 910 | 1.04x | 1.04x | 1.04x | 1.04x |
| fs-fuse-g1 | 2680 | 2.24x | 2.58x | 2.70x | 2.77x |
| fs-cut-h1 | 6764 | 3.44x | 4.66x | 5.19x | 5.50x |
| fs-r10b-strict | 56111 | 3.50x | 4.80x | 5.36x | 5.70x |

#### Projection inputs (ms, attributed basis)

| workload | T | K kernel | H host | B Bend load | S_start | O binding est. | L addon |
|---|---:|---:|---:|---:|---:|---:|---:|
| py-planar-union | 3152 | 2209 | 9.60 | 779 | 866 | 0.38 | 0.97 |
| py-planar-pocket | 4597 | 3678 | 10.4 | 782 | 860 | 0.61 | 0.97 |
| py-frame-with-tab | 15471 | 14508 | 15.8 | 806 | 886 | 1.27 | 0.97 |
| fs-bracket | 900 | 2.50 | 2.30 | 783 | 872 | 0.01 | 0.97 |
| fs-bored-spacer-print | 910 | 38.4 | 3.80 | 745 | 824 | 0.14 | 0.97 |
| fs-fuse-g1 | 2680 | 1811 | 5.30 | 760 | 844 | 0.31 | 0.97 |
| fs-cut-h1 | 6764 | 5914 | 7.50 | 745 | 821 | 0.64 | 0.97 |
| fs-r10b-strict | 56111 | 55116 | 54.3 | 755 | 851 | 24.9 | 0.97 |

Applied to the plain wall times, the kernel-only bound at k = 25 would take py-frame-with-tab from 13.9 s to
about 1.4 s and py-planar-union from 2.7 s to about 0.9 s. With the JS kernel load also gone (C) they would reach
about 0.66 s and 0.22 s. Even then, the kernel part of frame-with-tab alone (14.5 s / 75 = about 0.19 s at k = 75)
stays about 20 times above real build123d/OCCT's warmed build of 9.4 ms (`docs/build123d-performance.md`). Closing
that gap takes algorithmic work (face count, per-cell ray classification), not only native execution.

## Consequences for the binding design

1. **Keep the interpreter, the Python shim and host adaptation in JS.** Together they are at most 1.1 % of any run.
   Moving host adaptation behind the binding raises no bound by more than 1.7 % at k = 25 (B against A).
2. **A coarse, operation-level API is sufficient.** Mirror today's entry points (extrude, transform, the Boolean
   ports, identity, analytic residuals). Per-call cost of the in-process addon (about 1 us) and marshaling (at most
   25 ms even for r10b's 18.6k calls) are irrelevant against kernel time. Handles for resident solids are optional
   for speed; carry `Real` bit-exactly.
3. **The native backend must not load the JS kernel.** With the JS kernel still loaded, every CLI run keeps a
   0.75 to 0.81 s floor, and small models gain nothing (1.00 to 1.04x). Load the reference backend lazily, only for
   differential testing or when explicitly selected, and fail loudly instead of falling back. The exporters' STEP
   pcurve modules belong to the kernel too; they currently load at import time.
4. **The kernel dominates everything else**, and inside it the planar Boolean's cell classification and r10b's
   connectivity folds. Native execution multiplies them down by k. Intra-Boolean parallelism would be needed to reach
   multi-thread k values, and r10b's connectivity pass is algorithmically expensive regardless of backend.
5. **For resident use (viewer, review server, test runs in one process)** startup is paid once, and the bound
   approaches k for every Boolean workload: 6.2 to 7.4x at k = 7.5, 14 to 24x at k = 25.

## Open questions

- Load and init time of a full-kernel addon. Only the 1.2 MB probe addon has been measured: 0.7 to 2.5 ms warm,
  287 ms on the first load after a rebuild (macOS code checks).
- The real k for these workloads (single large planar and curved Booleans, F32x2 arithmetic, list folds). It has to
  be measured end to end with correctness checks once native entry points exist. The JS-target overheads visible
  here (`run_loop`, `f32_bits`, BigInt `Nat`) say nothing quantitative about native speed.
- Whether production still needs `registerBendImports()` (82 ms plus 77 to 102 ms of hooks waits per run) once the
  cache path is used everywhere.
- r10b stops at the known unsupported curved union, so its full-model profile is unknown.

## Reproduce

```sh
BEND_NO_TELEMETRY=1 node scripts/native-bridge/profile-workloads.mjs --modes startup,profile,count,plain --plain-repeat 2
BEND_NO_TELEMETRY=1 node scripts/native-bridge/startup-phases.mjs --repeat 5
node --max-old-space-size=14000 scripts/native-bridge/analyze-profiles.mjs
node scripts/native-bridge/profile-tables.mjs --render scripts/native-bridge/profile-report.template.md docs/native-bridge/profile.md
```

Outputs: `out/native-bridge/profile/summary.json` (per-workload buckets, kernel breakdown, top-20 lists, call
summaries, projections, `headline`), `out/native-bridge/profile/analysis/<id>.json` (full detail),
`out/native-bridge/profile/calls/<id>.json` (raw call counts), `out/native-bridge/profile/cpuprofiles/<id>.cpuprofile`
(open in Chrome DevTools), `out/native-bridge/profile/runs.json` and `startup-phases.json` (timings with load
averages).
