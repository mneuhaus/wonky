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

{{Runs}}

The count run times each outer kernel call directly. Its kernel share agrees with the profile's attributed
kernel share within 0 to 4 points (for example 68.4 % against 70.1 % for planar-union and 98.2 % against
98.2 % for r10b).

### Where the time goes

{{Bucket shares, GC and idle}}

{{Bucket milliseconds, raw}}

{{Where GC and idle go}}

GC is 3 to 16 % of raw wall time. In the Boolean workloads 71 to 99.7 % of it follows kernel samples (the rest
follows Bend loading), so it is mostly allocation churn of the JS kernel. That fits the emitted code: cons cells,
V3/Real objects, and `f32_bits` allocating two typed arrays per call. Allocation itself was not profiled. In the
small models GC follows Bend loading. Idle time is about 95 to 140 ms in every run.
Most of it (77 to 102 ms) is the main thread waiting on the ESM hooks worker thread while Bend modules load. About
23 to 41 ms in the Python cases is waiting for the Python subprocess, and 7 to 13 ms is output I/O (under export).

### Startup: the fixed cost of the JS kernel

{{Startup phases}}

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

{{Kernel self time by Bend source file}}

{{Kernel time by host entry module}}

{{Top-20 self-time functions, Boolean set}}

{{Top-20 self-time functions, fs-r10b-strict}}

{{Top-20 self-time functions, fs-bracket}}

{{Top Bend definitions by inclusive time, Boolean set}}

{{Top Bend definitions by inclusive time, fs-r10b-strict}}

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

{{Host adaptation, interpreter, frontend and export sub-buckets}}

Everything the JS host does around the kernel adds up to 2 to 16 ms per run (54 ms for r10b, which imports
frozen Onshape bodies with about 190 faces). The largest items are analytic-surface glue (`analytic.mjs`),
topology identity (`identity.mjs`), the `Real`/`V3` encoders and `validateSolid`. The FeatureScript parser needs
1.1 to 1.5 ms for the examples and 33 ms for r10b.

### Kernel calls and argument sizes

{{Host -> kernel calls}}

{{Kernel entry points across all workloads}}

{{Entry points by call count}}

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

{{A. Kernel}}

{{B. Kernel and host}}

{{C. Native CLI}}

{{D. Resident session}}

{{A (pessimistic)}}

{{Projection inputs}}

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
