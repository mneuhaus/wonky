# Native bridge prototype: the planar vertical slice

Built 2026-09-22; Regression review 2026-09-23 (six verifier findings, section "Regression review"); Regression review 2 2026-09-23 (one
finding: the request decoder's work followed the claimed count, section "Regression review 2"). Bend 2.0.25, Apple M5 Pro (18
logical CPUs), macOS arm64 (Darwin 25.6), Node v22.23.1, Apple clang 17. Decision and plan:
[../native-bridge.md](../native-bridge.md) (section 11). German report: [slice.md](slice.md).

The machine was shared with other workflows. The benchmark after Regression review 2 ran at load averages **17 to 24** on
18 cores (the bench of the first Regression review at 28 to 58, the first bench at 13 to 15). Load averages sit next to every
table. **All times are indicative.** Every number in the measurement tables is rendered from
`out/native-bridge/slice/bench.json`, `churn.json`, `full-surface-build.json` and `count-guard.json` by
`scripts/native-bridge/slice-tables.mjs`.

## Result in short

- **The in-process binding works end to end on real workloads.** With `WONKY_BACKEND=native`, the unchanged CLIs
  `bin/wonky.mjs` and `bin/wonky-python.mjs` run all six planar workloads with the Bend kernel compiled to ARM64 C
  and loaded into the Node process as a plain N-API addon. The Bend JS kernel is never loaded (no `data:` module, no
  Bend compiler `main.ts`, no `.bend` import; checked by a module-load guard in every native test run).
- **Outputs are byte-identical to the JS path**: `brep.json` without its `backend` block, `.step`, `.stl`, `.html`
  and the stdout body lines, in every sample (3 rounds per workload, plus the traced, diff and 6-thread runs).
- **`WONKY_BACKEND=diff` compares every kernel call word for word**: 2,134 calls over the six workloads, zero
  divergences (counted from dump directories and the trace counter, not from exit codes), and the number of compared
  calls per entry equals the profile's count run for every entry.
- **Measured end to end at 1 thread: 8.2x to 11.7x faster** than the JS path at load 18 to 24 (earlier benches: 8.5x
  to 11.4x at load 28 to 58, 7.6x to 12.6x at 13 to 15; projection 7.4x to 9.3x). Native process wall at this load:
  fs-bracket ~0.07 s instead of ~0.85 s, py-planar-union ~0.30 s instead of ~2.7 s, py-frame-with-tab ~1.87 s instead
  of ~15.2 s.
- **Everything outside the 19 entries fails loudly**: `NativeCapabilityError` (an `UnsupportedFeatureError`, so
  `try silent` cannot swallow it), exit 1, without loading the JS kernel. A native-backend failure (bridge error,
  native/JS divergence) now ends the run in both frontends; Python user code can no longer catch it. Nothing ever
  falls back to the JS target.
- **A stale or edited build never loads.** The loader recomputes the build key on every open from the current input
  files, the current `loadKernel()` wiring in `src/kernel.mjs`, the current toolchain (Bend binary, Bend library,
  clang) and the manifest's routing, and checks the binary's sha256 and the codecs' wire hash, all before `dlopen`
  (5.6 to 6.8 ms per open at this load).
- **Per-call native time stays flat in a long-lived process.** Every call now starts on an empty Bend heap. Without
  the per-call heap clear, `identity.boolean_result` degrades from 56 to 112 ms within 40 repeats (up to ~10x after 150
  calls in the verifier's run); with it, it stays at 22 ms.
- **A malformed request costs work in proportion to its length, not to what it claims** (Regression review 2). A count word
  that the rest of the request cannot carry is refused before one element is decoded: 4 bytes claiming 2^25 elements
  took 1.4 s and left 2.1 GiB resident before, now under 0.1 ms and nothing; every build's smoke test checks it.
- **The full 84-entry compat surface builds in under a minute** (bend 17.4 s + clang 34.2 s, 4.2 MB `.node`, first
  load 0.23 s, warm load 0.5 ms; rebuilt in Regression review 2, never opened by the loader).
- **Largest finding, unchanged:** the identity entries (`identity.*`) are *slower* natively than on the JS target,
  because Bend strings are cons lists natively and cross the wire as one word per code point (2.1 M reply words for the
  two `identity.boolean_result` calls in frame-with-tab: 87 ms native + 23 ms decode against 13 ms on the JS target).

## Regression review 2026-09-23

Six defects found by independent verifiers, each fixed at the root and covered by a regression test in
`test/native-bridge-slice.test.mjs`.

| # | finding | root cause | fix | regression test |
|---|---|---|---|---|
| 1 | `WONKY_BACKEND=diff` + Python: a `BackendDivergenceError` reached user code as a catchable `RuntimeError`; `except Exception` swallowed it and the run exited 0. | `src/python.mjs` answers every non-capability error as `GeometryError`, which Python raises as `RuntimeError`; only `UnsupportedFeatureError` is sticky. The bench derived `divergences` from the exit code. | `endsRun(error)` in `src/native/errors.mjs` (`NativeKernelError` or `BackendDivergenceError`). `python.mjs` aborts the Python child with such an error instead of answering the request, so the Python `except` never runs (one added line, default off: only native/diff raise these). The diff kernel makes a divergence sticky (every later slice call throws it) and, if a host still caught it and is about to exit 0, sets exit code 1 with the divergence on stderr. `slice-bench.mjs` counts divergences from the dump directories and the trace counter (`diffEvidence` in `slice-lib.mjs`). This also closes the old gap "NativeKernelError is catchable in Python". | (e) *a native/JS divergence or a bridge error ends the run in both frontends*: fault injection into the unchanged CLIs (`scripts/native-bridge/fault-inject.mjs`): Python + diff + flipped reply word → exit 1, the `except` never ran, 1 dump, trace counter 1; Python + native + refused reply → exit 1 with `BX_WIRE`; FeatureScript + diff → exit 1; an in-process host that catches the divergence → exit 1. |
| 2 | Rewiring a `loadKernel()` namespace in `src/kernel.mjs` kept running the old Bend module with no stale error (different result than JS). | Routing came from `out/native-bridge/surface.json`, whose namespace → module table was hand-kept in `surface-scan.mjs` (`KERNEL_FIELDS`); `src/kernel.mjs` was no build input. | `src/native/kernel-wiring.mjs` parses `loadJsKernel()` strictly (only the statements it has today; anything else throws). The build derives every op's slot from it; the wiring is part of `SOURCE_HASH` and recorded in the manifest; the loader parses the current `src/kernel.mjs` on every open and refuses with the exact change. Only the wiring is parsed, so unrelated edits of `src/kernel.mjs` keep the build valid. `surface-scan.mjs` now takes `KERNEL_FIELDS` from the same parser (a rescan differs from the committed `surface.json` only in new source files and line numbers; `surface.json` was not regenerated). | (c) *a rewired loadKernel() namespace or an unparseable wiring makes the build stale*: `planarBoolean` → `planar-boolean-next.bend` gives `wiring changed: loadKernel().planarBoolean: kernel/ports/planar-boolean.bend -> kernel/ports/planar-boolean-next.bend`; an added field and an unknown statement are refused; parser unit cases. |
| 3 | The loader never re-checked the toolchain part of the key; a Base edit left an outdated binary loading. | `staleCheck` recomputed the hash with `manifest.toolchain`, not the current toolchain. | `currentToolchain()` on every open. Bend binary (64 MB) and Bend library (73 files): file identity (device, inode, size, mtime ns, ctime ns) against the probe recorded at build time; a changed identity re-hashes the bytes. clang: a fingerprint (PATH hit, `DEVELOPER_DIR`/`TOOLCHAINS`/`SDKROOT`, the xcode-select link, Xcode.app presence, identity of the real clang found by `xcrun` at build time); a changed fingerprint spawns `clang --version`. Flags, arch, platform and N-API target come from the loader's constants. The key is recomputed from these values and the manifest's toolchain record must match them too. A cache hit of `build-native.mjs` refreshes an outdated probe (same key, new identities). | (c) *the toolchain is re-checked on every open*: Base edited in a temp root → `toolchain changed: Bend library`; Bend binary replaced → `toolchain changed: Bend binary`; a fake `clang` first on `PATH` (child process) → `toolchain changed: clang --version: "…" -> "fake clang version 99.0.0"`; build test: probe refresh on a cache hit. |
| 4 | The manifest's routing fields and `node.sha256` were not covered: swapping union and subtract ran the wrong op with exit 0; a zeroed `node.sha256` loaded. | `computeSourceHash` covered only `op.spec`; the loader checked only the `.node` size. | `SOURCE_HASH` (key schema 2) covers the op table (id, spec, entry, namespace, key, label), the namespace list, the refusal table and the wiring. Before `dlopen` the loader checks the `.node` sha256 and that the bytes carry the source hash, recomputes the wire hash from `wire.json` + `wire.bend` + `wire.mjs` and requires it in the binary, and pins the binary name. After `dlopen`, `info()` must carry the recomputed source and wire hashes, the set, the op table, the pinned flags and heap mode `clear`. | (c) *the manifest routing, the binary and the codecs are covered*: ten edits (union/subtract swapped, label, namespace, refusal name, wiring record, zeroed `node.sha256`, one flipped byte of the binary, `wire.json`, `wire.mjs`, set) each give `BX_STALE` and nothing is `dlopen`ed. |
| 5 | `WONKY_NATIVE_SET=full` was honoured: the never-validated 84-op build ran the production CLIs under the label "planar slice"; `wonky-compare` wrote a report labelled JavaScript. | `locateBuild()` read `WONKY_NATIVE_SET`. | The loader opens only the `planar` slice build (`SLICE_SET`); `WONKY_NATIVE_SET` with any other value, or an explicit other set, is `BX_BACKEND`. `wonky-compare` needs `kernel.comparison.coaxial`, which is not in the slice, so on native/diff it exits 1 before writing anything. | (i) *only the validated planar slice is ever opened*: `WONKY_NATIVE_SET=full` → exit 1, `BX_BACKEND`, nothing written; `WONKY_NATIVE_SET=planar` still runs; `wonky-compare` on native → exit 1, no report. |
| 6 | Per-call native time degraded up to ~10x within one process after heap churn; RSS stayed flat. | The Bend allocator's free lists (per-lane HOT/COLD chains and per-class banks) keep every cell freed by earlier calls in reuse order; later calls allocate from cells scattered over the whole touched heap instead of fresh sequential pages. Worst for `identity.boolean_result` (0.26 to 2.1 M cons cells per reply). A full `reset()` (re-map) between calls kept the time flat, which located the cause. | `bx_heap_clear()` in the slice driver (`src/native/binding/bx_addon.c`) after every call: bump pointer back to page 1, lane chains and class banks emptied, static image restored as `corpus_setup` lays it; pages stay mapped (no `munmap`, no page faults). Sound because nothing in the heap is live between slice calls: the request list is consumed by `kcall`, the reply list is taken destructively, there are no handles and no parked IO action. Reused pages hold old contents exactly as recycled free-list cells always do. `init({heap: 'keep'})` exists only to measure the old behaviour; the loader refuses an addon whose `info().heap` is not `clear`. | (h) *every native call starts on an empty heap*: three replays of a captured union start at page 1, reach identical pages, give identical replies; a `keep` child shows the second call starting on the first call's leftovers. The build's smoke test replays each captured call twice with the same check. `scripts/native-bridge/slice-churn.mjs` measures it (table below). |

## Regression review 2 (2026-09-23): request decoding is bounded by the request

**Finding (verifier, severity medium).** A malformed request made the Bend-side decoder work and allocate in
proportion to the count it *claimed*, not to its length, before it answered status 1. Reproductions (verifier, before
the fix): `backend.call(6, Uint32Array.of(0x2000000))` (4 bytes claiming 2^25 `Vec3`s) took 1,397 ms and left the host
at 2,103 MiB RSS (55 MiB before), still 2,103 MiB two seconds and one call later; a claim of 2^28 took 14.6 s and
17.2 GB max RSS (load 25.9); a 2^24-character `String` 0.43 s and 460 MB. A claim of 2^32 − 1 would have needed about
270 GB. Only a direct `addon.call` or an encoder bug can send such words (the production encoders write exact counts),
and the result was never a silent wrong answer, but a 4-byte request must not pin gigabytes in the host.

**Root cause.** `gen-wire.mjs` emitted `dec_items_<T>(U32.to_nat(n), c)` and `dec_str_chars(U32.to_nat(n), c)`: the
count word became Nat fuel and the loop decoded n elements unconditionally. Once the words ran out, `take` answered 0
and marked the cursor failed, but the loop went on building zero-valued elements until the fuel was spent, each one
allocating heap cells. The per-call heap clear resets the allocator, not the pages, so the high-water mark stayed
resident (gap 8). The generated JS decoder already refused `n > remaining words`; the Bend decoder had no such check.

**Fix (generator, addon, build).**

- The decoder cursor carries `left`, the words still unread: `start(words)` counts the request once (a U32 walk),
  `take` decrements it. Below 2^32 words it is exact; the addon now refuses longer requests with `BX_ARGS`
  (`bx_addon.c`, 16 GiB), and above that `left` would only ever be smaller than the truth (it is the remainder mod
  2^32), so the check could over-refuse but never admit.
- Every List and String count goes through one generated `count(p, w)`: the count is taken only if the cursor is still
  intact and `n <= left / w`, where `w = minWords(element)` is computed by the generator (the fewest words any value of
  the element type occupies: empty lists and strings, the narrowest constructor; 1 for String). Otherwise the count
  becomes 0 and the cursor fails; after any failure every later count is 0. The loops therefore never run more than
  the remaining words can hold, and decoding work and heap are linear in the request length (times a constant of the types) whatever the counts
  claim.
- The generated JS decoder applies the identical rule (`n * w > remaining` refuses; it had `n > remaining`), so both
  sides refuse at the same boundary. The set of accepted requests is unchanged: a count that breaks the rule can
  never be part of a valid encoding. The generator refuses list element types that can be zero words wide (none exist:
  the codability survey of all kernel types and defs is byte-identical before and after, 335/336 types, 2,148/2,191 defs).
- External users of the generated Bend module no longer build `Cursor{...}` themselves: `start(words)` and
  `done(cursor)` are generated (`binding-kernel.mjs` and `wire-native-emit.mjs` switched to them).
- Every native build now refuses itself if the guard is missing: the smoke test runs the count probes of
  `scripts/native-bridge/wire-probe.mjs` (a sample request of every op, cut at every List/String count word, 214
  probes for the planar set, 456 for the full set) with a claim of 1 and of 2^16 and requires status 1 and identical
  heap pages. Run against the build before the fix (b49c55bd93eb), this smoke check fails on 214 of 214 probes.
  `wire-probe.mjs` is a build input (57 files in `SOURCE_HASH` now).

**After the fix** (build 079288cf6050, load 16 to 25; log in `tmp/native-bridge/fix2/repro.log`): the verifier's
scripts (`tmp/native-bridge/verify/r2/`) answer `BX_WIRE` within 0.1 ms for every claim, including 2^32 − 1 on ops
0, 5 and 6; RSS stays at 55 MiB; the 2^28 case has 57 MB max RSS and reaches 65 heap pages (1 KiB each). On the Bend
JS target a 2^20 claim is refused in 0.03 to 0.28 ms (the old generated codecs: 259 to 3,495 ms and up to 1.2 GB RSS;
`tmp/native-bridge/fix2/js-target-evidence.mjs`). The count-guard table in "Measurements" compares both builds on
1,248 recorded calls per run: every reply identical, kernel time unchanged within noise; decoding pays
the counting walk, about 4 ns per request word (decode-only time of a request with one trailing word, which fails
after decoding everything: the 17,976-word `identity.transform` request 0.41 → 0.48 ms, the 4,419-word
`planar_measures` request 0.071 → 0.084 ms; `tmp/native-bridge/fix2/start-cost.mjs`, two alternating runs per build).

| regression test | what it proves |
|---|---|
| `test/native-bridge-slice.test.mjs` (j) | 214 probes (every List/String count word of the 15 ops that carry one, 13 element types) with claims 1, 2^20 and 2^32 − 1: status 1 and *identical* heap pages for all three; 122 probes of elements at least 2 words wide: a count of 2^16 over 2^16 zero words is refused exactly like an impossible count (the `w` factor); the verifier's reproduction through the backend is `BX_WIRE` with less than 64 MiB max-RSS growth; a valid call afterwards returns the right value. Against the old decoder the same probes reach 3,233 to 18,593 pages for a 2^16 claim. |
| `test/native-bridge-wire.test.mjs` | The JS codec and the Bend JS target accept one `Vec3` in 6 words and refuse two in 8 (the `n * w` boundary, same on both sides); a 2^20 claim is refused in under 250 ms on the Bend JS target (old codecs: 3.5 s), and only then 2^32 − 1 claims (a List, an IdentitySet, a String through `dispatch`); the generator refuses a list of zero-word elements. |
| build smoke test | Every build (planar and full) refuses itself when a 2^16 claim reaches other heap pages than a claim of 1. |

## What was built

| file | role |
|---|---|
| `scripts/native-bridge/slice-ops.mjs` | The 19 slice entries (order = wire op id), their `loadKernel()` slot derived from the `loadJsKernel()` wiring, the six workloads; `--check` verifies the entries are exactly those the workloads call in `out/native-bridge/profile/calls/*.json`. |
| `scripts/native-bridge/build-native.mjs` | Scripted, cached build (below). `--set planar` (19 ops) or `--set full` (84 ops, measurement only; never opened by the loader). Regression review 2: the smoke test runs the count probes. |
| `src/native/build-key.mjs` | `SOURCE_HASH` shared by build and loader: routing, wiring, 57 input files (42 kernel sources + 15 scripts, driver, headers, `bend.lock.json`, `surface.json`), toolchain; the toolchain probe and its fast path; the wire hash. |
| `src/native/kernel-wiring.mjs` | Strict parser of `loadJsKernel()` in `src/kernel.mjs` (namespace → module) and the slot of every kernel entry. New in the Regression review. |
| `scripts/native-bridge/vendor-node-api.mjs` | Copies the four Node-API headers of the running Node into `src/native/include/` with `PROVENANCE.json` (source path, sha256). |
| `src/native/binding/bx_addon.c` | N-API driver. Compile-time switch `BX_SLICE`: only `init`, `call(op, words)`, `info`, `reset`, `stats`; op range check; requests of 2^32 words or more refused (`BX_ARGS`, Regression review 2); per-call heap clear; no handles, IO bridge or `gpuBuild`. The probe/kernel builds of `binding-build.mjs` are unchanged (their test passes). |
| `src/native/native-kernel.mjs` | Loader: pointer, manifest, stale check (below), `process.dlopen`, `init({threads})`, `info()` checks, generated codecs, compat proxy, trace. |
| `src/native/diff-kernel.mjs` | `WONKY_BACKEND=diff`: JS target (`loadJsKernel()`) and native per call, word comparison, `BackendDivergenceError` with field path and replay dump; sticky divergence and exit guard. |
| `src/native/errors.mjs` | `NativeKernelError` (`BX_ARGS`, `BX_WIRE`, `BX_ABI`, `BX_LOAD`, `BX_FAILSTOP`, `BX_POISONED`, `BX_BACKEND`), `NativeKernelStaleError` (`BX_STALE`), `NativeCapabilityError extends UnsupportedFeatureError`, `BackendDivergenceError`, `endsRun`. |
| `src/native/backend.mjs` | `selectBackend`, `openKernel(mode)`, `exportKernels()`, `backendInfo(kernel)`. No side effects on import. |
| `scripts/native-bridge/slice-guard.mjs` | `--import` preload: logs every resolved/loaded module URL and every `process.dlopen`. |
| `scripts/native-bridge/slice-phases.mjs` | `--import` preload for the bench: timestamps kernel ready / build end / exit (in-memory rewrite of three function headers; nothing on disk changes). |
| `scripts/native-bridge/fault-inject.mjs` | `--import` preload for the tests: flips a reply word or answers status 1 for one op of an otherwise untouched addon. New in the Regression review. |
| `scripts/native-bridge/slice-lib.mjs`, `slice-bench.mjs`, `slice-churn.mjs`, `slice-tables.mjs`, `full-surface-report.mjs` | CLI runner, byte comparison and divergence evidence; end-to-end benchmark; long-lived-process benchmark (new); table rendering; full-surface measurement. |
| `scripts/native-bridge/wire-probe.mjs` | Count probes from a wire manifest: a sample request per op (one element per List, one character per String, every constructor across variants), cut at every count word. Used by the build smoke test and test (j). New in Regression review 2. |
| `scripts/native-bridge/count-guard-bench.mjs` | The build before the count guard against the current one in alternating fresh processes: recorded calls (replies compared), count probes (heap pages, ms). New in Regression review 2. |
| `scripts/native-bridge/surface-scan.mjs` (changed) | `KERNEL_FIELDS` now parsed from `src/kernel.mjs` by `kernel-wiring.mjs` instead of a hand-kept table. |
| `scripts/native-bridge/gen-wire.mjs` (changed in both rounds) | First round: faster generated JS string codecs; same words and values (wire test and a 20,000-string fuzz). Regression review 2: the count rule on both sides (`count`, `start`, `done`, `minWords`), refusal of zero-word list elements; `binding-kernel.mjs` and `wire-native-emit.mjs` use `start`/`done`. |
| `test/native-bridge-slice.test.mjs` | 26 tests (below). |

Production touchpoints, all default off (without `WONKY_BACKEND` the behavior and output are today's):

1. `src/kernel.mjs`: today's body is the exported `loadJsKernel()`, unchanged. `loadKernel()` returns it for
   `WONKY_BACKEND` unset or `js`; for any other value it asks `src/native/backend.mjs`, which opens `native` or
   `diff` and throws `BX_BACKEND` for anything else.
2. `src/exporters.mjs`: with `native` or `diff` the two STEP pcurve namespaces come from `exportKernels()` and refuse
   every call (outside the slice; the planar workloads never call them). Otherwise exactly the old `Promise.all`.
3. `src/index.mjs`, `src/python.mjs`: the `brep.json` backend block takes its target fields from `backendInfo(kernel)`
   (`{ target: 'JavaScript' }` on `js`, byte-identical to before). **Deviation (Regression review):** `src/python.mjs` also
   gained one guarded line in its request handler, `if (endsRun(error)) return abort(error);` (finding 1). Only the
   native and diff backends raise such errors, so the default path is unchanged; the Python and Python-CLI tests pass.

### The build

```
node scripts/native-bridge/build-native.mjs --set planar
```

1. Op list, each op's `loadKernel()` slot from the wiring, import closure of the op modules (42 kernel files),
   toolchain probe (hashes the Bend binary and library, runs `clang --version` and `xcrun --find clang`), `SOURCE_HASH`.
2. Cache hit (`tmp/native-bridge/cache/<sourceHash>/manifest.json` whose routing re-hashes to its name, smoke test
   passed, `.node` sha256 as recorded): refresh an outdated toolchain probe, update the `planar.json` pointer, done
   (0.1 to 0.4 s, mostly the Bend binary hash and the clang spawn).
3. Otherwise, under `tmp/native-bridge/cache/.build.lock` (one compile at a time; a dead holder is taken over, a
   live one waited for): `gen-wire.mjs writeGenerated` for the 19 ops, generated `entry.bend`
   (`kcall(op, words) = W.dispatch(op, words)`, `main` reaches it through the unknown-op arm),
   `bend entry.bend -o kernel.c`, generated `kernel_ops.h` (`BX_SLICE`, `BX_KCALL_FID`, hashes, flags, op names),
   one translation unit `bx_pre.h` + unedited `kernel.c` + `kernel_ops.h` + `bx_addon.c`,
   `clang -std=c11 -O3 -fPIC -ffp-contract=off -fno-fast-math ... -bundle`.
4. Loud refusals: generator width warning, bend error or warning, missing `FID_KCALL`, arity mismatch, a signature
   other than `(U32, List<&2, U32>) -> List<&2, U32>`, `BANGS != 0`, smoke-test failure. The smoke test is a child
   process: `info()` hashes, flags, op names and heap mode must match; a malformed request must answer status 1; an
   out-of-range op must throw `BX_ARGS`; the four captured production calls of
   `out/performance/native-build123d/captured.json` must replay bit-exact twice, each starting at heap page 1 and
   reaching the same pages; every count probe of `wire-probe.mjs` must answer status 1 with the same heap pages for a
   claim of 1 and of 2^16 elements (Regression review 2).
5. Atomic rename, `manifest.json` (ops with their slots, namespaces, refusal table, wiring, file hashes, toolchain
   and probe, bend/clang seconds, C and `.node` bytes, first and warm load, load averages), pointer update, the last 3
   builds per set are kept.

### The runtime path

- `WONKY_BACKEND=native` → `loadKernel()` → `openKernel('native')` → `openNativeBackend()`: pointer (always
  `planar.json`) → manifest → **stale check** (below) → `process.dlopen` → `init({threads: WONKY_NATIVE_THREADS ?? 1})`
  → `info()` must carry the recomputed source and wire hashes, API version, set, op table, pinned flags, `bangs == 0`,
  heap mode `clear` and the asked thread count.
- The compat proxy mirrors `loadKernel()`: root (topology spread, `geometry.*`) plus the 17 sub-namespaces. A slice
  entry encodes its arguments with the generated codec, calls `addon.call(op, words)`, checks the status word and
  decodes to exactly the JS target's value shapes. Any other string key is a function that throws
  `NativeCapabilityError` naming the kernel entry, the build and the backend. `then` and symbols are `undefined`.
- One addon per process: the Bend runtime is process-global, so the opened backend is shared by every caller.

### What the stale check covers

Everything in the build key is recomputed from disk on every open, before `dlopen`. Costs are from the six traced
runs of the bench after Regression review 2 (load 18 to 23).

| input | how it is checked | cost |
|---|---|---|
| 57 recorded input files | sha256 of each file | 1.8 to 2.4 ms |
| `loadKernel()` wiring | strict parse of `loadJsKernel()` in `src/kernel.mjs`; the manifest's wiring record must equal it | 0.4 to 0.5 ms |
| Bend binary, Bend library | file identities against the recorded probe; re-hash (~30 ms binary, ~3 ms library) only when an identity changed; values must equal the manifest's record | 1.3 to 1.5 ms (toolchain total) |
| clang | fingerprint against the probe; `clang --version` (~30 ms) only when it changed | included above |
| flags, arch, platform, N-API target | the loader's constants | included above |
| routing (op table, namespaces, refusal names) | part of the recomputed key | 0.2 to 0.7 ms (key) |
| `.node` | sha256 of the bytes, and the bytes must contain the source hash; fixed file name | 1.1 to 1.2 ms (2.0 ms once) |
| codecs | wire hash recomputed from `wire.json` + `wire.bend` + `wire.mjs`, must equal the manifest and be in the binary | 0.35 to 0.5 ms |

The fast path trusts one thing: the file identities recorded in the manifest's probe. `ctime` is set by the kernel
on every write, rename or metadata change and cannot be set from user space, so any change to the toolchain files is
seen. Only a deliberately forged identity record in the manifest, combined with a replaced toolchain, could bypass
the re-hash; the post-`dlopen` `info()` check and the smoke test still bind the binary to its inputs.

```sh
node scripts/native-bridge/vendor-node-api.mjs                 # once per Node version
node scripts/native-bridge/build-native.mjs --set planar       # ~20-45 s cold under load, 0.1-0.4 s cached
WONKY_BACKEND=native node bin/wonky.mjs examples/bracket.fs --out out/bracket
WONKY_BACKEND=native node bin/wonky-python.mjs fixtures/performance-build123d/cases/planar-union.py \
  --python out/build123d-performance/reference-venv/bin/python --out out/planar-union
WONKY_BACKEND=diff node bin/wonky.mjs fixtures/public-boolean-regressions/adapted/cut-h1.fs --format step --out out/cut
WONKY_NATIVE_TRACE=trace.json WONKY_BACKEND=native node bin/wonky.mjs ...     # per-entry timings at exit
node --import ./scripts/native-bridge/slice-guard.mjs ...                      # with WONKY_SLICE_GUARD_LOG=<file>
node scripts/native-bridge/slice-bench.mjs --n 3                                 # out/native-bridge/slice/bench.json (~3-5 min)
node scripts/native-bridge/slice-churn.mjs                                       # out/native-bridge/slice/churn.json (~1.5 min)
node scripts/native-bridge/build-native.mjs --set full && node scripts/native-bridge/full-surface-report.mjs
node scripts/native-bridge/count-guard-bench.mjs --before <sourceHash>          # out/native-bridge/slice/count-guard.json (~15 s)
node --test test/native-bridge-slice.test.mjs                                    # 85-172 s (load 13-114); WONKY_SLICE_TEST_QUICK=1 for 2 workloads
node scripts/native-bridge/slice-tables.mjs [--de]                               # the tables below
```

Environment: `WONKY_BACKEND=js|native|diff` (unset = `js`, anything else is an error), `WONKY_NATIVE_THREADS`
(default 1), `WONKY_NATIVE_CACHE`, `WONKY_NATIVE_TRACE`, `WONKY_DIVERGENCE_DIR`. `WONKY_NATIVE_SET` is refused
unless it is `planar`.

## Measurements

Method: every sample is a fresh CLI process (`/usr/bin/time -l`), js and native alternating per round, `uptime`
before and after each run. Every native, diff and 6-thread run is byte-compared against a js run of the same round.
The traced native run adds the trace and the phase preload; the traced js run adds `count-kernel-calls.mjs` (which
instruments every call, so its wall is slower than a plain run). Buckets: *cold start* = process time origin to
`loadKernel()` resolved (Node start, module graph, the native open or the JS kernel load); *kernel* = sum over entries
(native: encode + native call + decode; js: the count run's inclusive time); *frontend + host* = build end minus
kernel ready minus kernel (parser, interpreter, Python subprocess, host adaptation); *export* = build end to exit
(JSON, STEP, STL, HTML, writes); *process overhead* = external wall minus in-process time. The long-lived-process
table replays 624 recorded calls in one fresh process per heap mode (`slice-churn.mjs`). The count-guard table
(`count-guard-bench.mjs`) replays the same kind of recording on the build before Regression review 2 and on the current build
in alternating fresh processes, and runs the count probes on both. All tables below are from the current build
079288cf6050 (after Regression review 2); the previous bench (build b49c55bd93eb, load 28 to 58) is superseded.

#### Wall time, fresh processes, 1 thread

| workload | js ms (n=3) | native ms (n=3) | median factor | projected factor | deviation | native projected ms | 6 threads ms | outputs identical | load 1m |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| py-planar-union | 2780 / 2681 / 2637 | 302 / 311 / 293 | 8.87x | 8.38x | +6 % | 323 | 233 | yes | 21.17–22.02 |
| py-planar-pocket | 3856 / 3866 / 3842 | 454 / 468 / 478 | 8.23x | 9.32x | -12 % | 458 | 343 | yes | 22.07–23.80 |
| py-frame-with-tab | 14664 / 15236 / 15741 | 1922 / 1867 / 1839 | 8.16x | 8.03x | +2 % | 1725 | 1176 | yes | 21.19–24.30 |
| fs-fuse-g1 | 2394 / 2479 / 2467 | 327 / 221 / 230 | 10.74x | 9.01x | +19 % | 254 | 170 | yes | 19.23–19.60 |
| fs-cut-h1 | 6781 / 6311 / 6391 | 716 / 716 / 726 | 8.92x | 9.23x | -3 % | 673 | 476 | yes | 19.28–20.57 |
| fs-bracket | 888 / 847 / 850 | 74 / 71 / 73 | 11.65x | 7.40x | +57 % | 114 | 75 | yes | 18.22–18.76 |

#### Buckets of one traced run (ms from process time origin)

| workload | backend | cold start to kernel ready | of which stale check / dlopen / init | kernel (native / encode / decode) | frontend + host | export | process overhead | load 1m |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| py-planar-union | native | 41.6 | 5.70 / 0.64 / 0.05 | 197.1 (189.2 / 2.47 / 5.43) | 42.0 | 5.2 | 14.9 | 21.17–21.17 |
| py-planar-union | js (count) | 1010.1 | – | 2245.7 | 54.2 | 5.1 | – | 21.17–22.91 |
| py-planar-pocket | native | 38.1 | 6.04 / 0.60 / 0.06 | 363.2 (352.5 / 2.63 / 8.07) | 43.8 | 8.7 | 15.3 | 22.07–22.07 |
| py-planar-pocket | js (count) | 935.6 | – | 3054.5 | 53.0 | 7.9 | – | 22.07–21.91 |
| py-frame-with-tab | native | 36.6 | 5.64 / 0.64 / 0.06 | 1703.9 (1672.4 / 4.23 / 27.27) | 49.0 | 11.0 | 21.8 | 23.33–22.90 |
| py-frame-with-tab | js (count) | 1082.2 | – | 12945.4 | 69.8 | 8.6 | – | 22.90–20.85 |
| fs-fuse-g1 | native | 40.0 | 6.07 / 0.60 / 0.06 | 155.6 (150.1 / 1.26 / 4.28) | 9.7 | 5.5 | 15.3 | 19.23–19.23 |
| fs-fuse-g1 | js (count) | 956.3 | – | 1558.0 | 14.5 | 4.3 | – | 19.23–19.23 |
| fs-cut-h1 | native | 40.4 | 6.78 / 0.47 / 0.05 | 651.9 (642.6 / 1.74 / 7.49) | 12.0 | 5.8 | 16.9 | 19.28–19.28 |
| fs-cut-h1 | js (count) | 873.5 | – | 5930.8 | 19.6 | 5.8 | – | 19.28–19.00 |
| fs-bracket | native | 41.9 | 5.80 / 0.76 / 0.07 | 2.9 (1.6 / 0.16 / 1.11) | 4.6 | 15.4 | 15.7 | 18.22–18.22 |
| fs-bracket | js (count) | 859.8 | – | 2.3 | 4.9 | 8.7 | – | 18.22–18.22 |

#### Per-entry kernel time, traced runs (ms)

| workload | entry | calls | native | encode | decode | JS target (count run) | words in / out |
| --- | --- | --- | --- | --- | --- | --- | --- |
| py-planar-union | planarBoolean.union | 1 | 167.73 | 0.22 | 0.70 | 2189.55 | 892 / 2441 |
| py-planar-union | curved.audit | 1 | 2.94 | 0.19 | 0.03 | 40.95 | 2128 / 10 |
| py-planar-union | solidIntersection.planar_measures | 1 | 0.11 | 0.06 | 0.04 | 2.95 | 1809 / 15 |
| py-planar-union | identity.boolean_result | 1 | 14.16 | 0.02 | 2.96 | 5.38 | 610 / 350539 |
| py-planar-union | identity.box | 2 | 1.30 | 0.04 | 0.87 | 3.20 | 192 / 35766 |
| py-planar-union | identity.transform | 1 | 1.15 | 1.04 | 0.25 | 0.34 | 17976 / 27753 |
| py-planar-union | analytic.curve_residual | 104 | 0.65 | 0.20 | 0.04 | 1.30 | 1976 / 208 |
| py-planar-pocket | planarBoolean.subtract | 1 | 307.94 | 0.20 | 1.23 | 2930.95 | 892 / 4317 |
| py-planar-pocket | curved.audit | 1 | 14.01 | 0.36 | 0.06 | 104.71 | 3748 / 10 |
| py-planar-pocket | solidIntersection.planar_measures | 1 | 0.22 | 0.10 | 0.04 | 4.22 | 3189 / 15 |
| py-planar-pocket | identity.boolean_result | 1 | 25.25 | 0.03 | 4.91 | 6.82 | 610 / 614059 |
| py-planar-pocket | identity.box | 2 | 1.33 | 0.04 | 1.02 | 3.09 | 192 / 35766 |
| py-planar-pocket | identity.transform | 1 | 1.15 | 0.90 | 0.23 | 0.33 | 17976 / 27753 |
| py-planar-pocket | analytic.curve_residual | 184 | 1.04 | 0.37 | 0.06 | 2.35 | 3496 / 368 |
| py-planar-pocket | analytic.surface_residual | 184 | 1.19 | 0.21 | 0.06 | 0.72 | 4600 / 368 |
| py-frame-with-tab | planarBoolean.union | 1 | 1233.88 | 0.14 | 0.37 | 9800.96 | 3046 / 5937 |
| py-frame-with-tab | planarBoolean.subtract | 1 | 299.50 | 0.20 | 0.80 | 2851.45 | 892 / 3001 |
| py-frame-with-tab | curved.audit | 2 | 41.27 | 0.42 | 0.07 | 262.26 | 7796 / 20 |
| py-frame-with-tab | solidIntersection.planar_measures | 2 | 0.50 | 0.19 | 0.05 | 5.75 | 6630 / 30 |
| py-frame-with-tab | identity.boolean_result | 2 | 86.84 | 0.04 | 23.02 | 13.27 | 1847 / 2106771 |
| py-frame-with-tab | identity.box | 3 | 2.03 | 0.05 | 1.09 | 4.12 | 288 / 53649 |
| py-frame-with-tab | identity.transform | 2 | 2.48 | 1.05 | 1.11 | 0.54 | 35952 / 55506 |
| py-frame-with-tab | analytic.curve_residual | 384 | 2.54 | 1.13 | 0.11 | 3.32 | 7296 / 768 |
| py-frame-with-tab | analytic.surface_residual | 384 | 2.66 | 0.44 | 0.09 | 1.25 | 9600 / 768 |
| py-frame-with-tab | transform | 2 | 0.05 | 0.19 | 0.04 | 1.04 | 342 / 320 |
| fs-fuse-g1 | planarBoolean.union | 1 | 135.60 | 0.22 | 0.74 | 1519.75 | 892 / 1879 |
| fs-fuse-g1 | curved.audit | 1 | 1.48 | 0.18 | 0.03 | 26.71 | 1642 / 10 |
| fs-fuse-g1 | solidIntersection.planar_measures | 1 | 0.08 | 0.06 | 0.03 | 2.50 | 1395 / 15 |
| fs-fuse-g1 | identity.boolean_result | 1 | 10.05 | 0.05 | 2.00 | 3.50 | 547 / 255378 |
| fs-fuse-g1 | identity.box | 1 | 0.66 | 0.03 | 0.54 | 1.67 | 96 / 17883 |
| fs-fuse-g1 | identity.extrusion | 1 | 0.81 | 0.03 | 0.40 | 0.92 | 97 / 22679 |
| fs-fuse-g1 | analytic.curve_residual | 80 | 0.47 | 0.14 | 0.03 | 1.35 | 1520 / 160 |
| fs-cut-h1 | planarBoolean.subtract | 1 | 600.08 | 0.33 | 0.96 | 5802.78 | 1284 / 4320 |
| fs-cut-h1 | curved.audit | 1 | 14.01 | 0.21 | 0.09 | 109.41 | 3748 / 10 |
| fs-cut-h1 | solidIntersection.planar_measures | 1 | 0.23 | 0.12 | 0.05 | 3.71 | 3189 / 15 |
| fs-cut-h1 | identity.boolean_result | 1 | 23.30 | 0.05 | 4.31 | 7.09 | 547 / 577674 |
| fs-cut-h1 | identity.box | 1 | 0.61 | 0.02 | 0.35 | 1.11 | 94 / 17567 |
| fs-cut-h1 | identity.extrusion | 1 | 1.56 | 0.03 | 1.21 | 2.09 | 99 / 44337 |
| fs-cut-h1 | analytic.curve_residual | 184 | 1.16 | 0.35 | 0.06 | 2.65 | 3496 / 368 |
| fs-cut-h1 | analytic.surface_residual | 184 | 1.15 | 0.23 | 0.05 | 0.76 | 4600 / 368 |
| fs-bracket | identity.extrusion | 1 | 1.49 | 0.04 | 0.90 | 1.74 | 111 / 36882 |

#### Differential runs (WONKY_BACKEND=diff)

| workload | exit | compared calls | compared words | divergences | = profile count run | = this count run | outputs = js | wall ms | load 1m |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| py-planar-union | 0 | 253 | 417947 | 0 | yes | yes | yes | 3335 | 22.91–23.80 |
| py-planar-pocket | 0 | 413 | 683663 | 0 | yes | yes | yes | 4171 | 21.91–21.19 |
| py-frame-with-tab | 0 | 839 | 2228042 | 0 | yes | yes | yes | 15450 | 20.85–19.57 |
| fs-fuse-g1 | 0 | 202 | 299009 | 0 | yes | yes | yes | 2619 | 19.23–20.57 |
| fs-cut-h1 | 0 | 422 | 645880 | 0 | yes | yes | yes | 6946 | 19.00–18.76 |
| fs-bracket | 0 | 5 | 37163 | 0 | yes | yes | yes | 785 | 18.22–18.22 |

#### Negative workloads on native

| workload | exit | wall ms | first refused entry | JS kernel loaded | load 1m |
| --- | --- | --- | --- | --- | --- |
| fs-bored-spacer-print | 1 | 58 | `kernel/precise.bend:frame` | no | 18.22–18.22 |
| fs-r10b-strict | 1 | 106 | `kernel/precise.bend:dot` | no | 18.22–18.22 |

#### Loading the addon

| case | dlopen ms | load 1m |
| --- | --- | --- |
| first load after rebuild (build smoke child) | 222.3 | 17.26 |
| second load after rebuild | 0.52 | 17.26 |
| fresh copy, fs-bracket run first (wall 304 ms) | 220.98 | 18.22–18.22 |
| fresh copy, fs-bracket run second (wall 74 ms) | 0.61 | 18.22–18.22 |

#### Builds

| set | ops | bend s | clang s | C MB | .node MB | first dlopen ms | warm dlopen ms | load 1m |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| planar | 19 | 6.6 | 9.0 | 4.56 | 2.29 | 222.3 | 0.52 | 17.66–17.26 |
| full (84) | 84 | 17.4 | 34.2 | 12.07 | 4.16 | 231.5 | 0.54 / 0.51 / 0.55 | 20.79–17.47 |

#### Stale check of the traced native runs (ms)

| workload | total | input files | wiring | toolchain | key | .node sha256 | codecs | load 1m |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| py-planar-union | 5.70 | 1.94 | 0.45 | 1.36 | 0.19 | 1.17 | 0.47 | 21.17–21.17 |
| py-planar-pocket | 6.04 | 2.35 | 0.44 | 1.43 | 0.21 | 1.15 | 0.35 | 22.07–22.07 |
| py-frame-with-tab | 5.64 | 2.03 | 0.42 | 1.37 | 0.20 | 1.12 | 0.39 | 23.33–22.90 |
| fs-fuse-g1 | 6.07 | 1.85 | 0.42 | 1.35 | 0.67 | 1.17 | 0.38 | 19.23–19.23 |
| fs-cut-h1 | 6.78 | 1.81 | 0.41 | 1.47 | 0.57 | 2.03 | 0.37 | 19.28–19.28 |
| fs-bracket | 5.80 | 1.83 | 0.40 | 1.34 | 0.54 | 1.15 | 0.42 | 18.22–18.22 |

#### One long-lived process: per-call time with and without the per-call heap clear

Recorded: 624 calls (cut-h1.fs, fuse-g1.fs), 8 passes, then 40 repeats of the heaviest request per entry; every reply compared with the recording (all exact).

| heap | pass 1 / last pass ms | identity.boolean_result ms (1st → last quarter) | planarBoolean.subtract ms | planarBoolean.union ms | heap pages last call | max RSS MiB | load 1m |
| --- | --- | --- | --- | --- | --- | --- | --- |
| clear (production) | 788 / 794 | 22.2 → 22.1 (0.99x) | 607.9 → 607.8 (1.00x) | 134.1 → 134.7 (1.00x) | 353 | 125 | 16.83–16.95 |
| keep (before the fix) | 783 / 843 | 56.4 → 112.5 (1.99x) | 647.4 → 654.5 (1.01x) | 141.0 → 143.4 (1.02x) | 14017 | 126 | 16.95–17.11 |

#### Count guard: the build before it against this build (fresh processes, alternating)

Builds: b49c55bd93eb (before) / 079288cf6050 (after); 624 recorded calls (cut-h1.fs, fuse-g1.fs) × 2 passes × 3 rounds per build; replies equal to the recording on both builds: all. Load 1m before 16.48–18.72, after 16.52–18.72.

| entry | calls per pass | median ms before | median ms after | after / before |
| --- | --- | --- | --- | --- |
| planarBoolean.subtract | 1 | 645.264 | 635.469 | 0.98x |
| planarBoolean.union | 1 | 147.606 | 143.815 | 0.97x |
| identity.boolean_result | 2 | 17.388 | 17.125 | 0.98x |
| curved.audit | 2 | 7.676 | 7.749 | 1.01x |
| identity.extrusion | 2 | 1.213 | 1.201 | 0.99x |
| identity.box | 2 | 0.634 | 0.633 | 1.00x |
| solidIntersection.planar_measures | 2 | 0.143 | 0.228 | 1.59x |
| real.max | 2 | 0.016 | 0.014 | 0.88x |
| extrude | 4 | 0.015 | 0.015 | 1.00x |
| geometry.frame | 4 | 0.012 | 0.014 | 1.17x |
| geometry.lift_points | 4 | 0.008 | 0.008 | 1.00x |
| geometry.translate | 4 | 0.007 | 0.007 | 1.00x |
| identity.box_layout | 2 | 0.007 | 0.008 | 1.14x |
| faceClassifier.linear_edge | 60 | 0.007 | 0.007 | 1.00x |
| faceClassifier.max_budget | 4 | 0.007 | 0.006 | 0.86x |
| analytic.curve_residual | 264 | 0.006 | 0.006 | 1.00x |
| analytic.surface_residual | 264 | 0.006 | 0.006 | 1.00x |

| count word of | min words per element | probes | heap pages, claim 1 / 2^16, before | heap pages, claim 1 / 2^16, after | max ms of a 2^16 claim, before / after |
| --- | --- | --- | --- | --- | --- |
| `List<precise.bend:Vec3>` | 6 | 17 | 161 / 6305 | 161 / 161 | 11.19 / 0.036 |
| `List<analytic.bend:Edge>` | 16 | 16 | 161 / 18593 | 161 / 161 | 15.66 / 0.053 |
| `List<analytic.bend:Face>` | 21 | 24 | 161 / 18593 | 161 / 161 | 9.61 / 0.032 |
| `List<analytic.bend:Loop>` | 2 | 24 | 161 / 3233 | 161 / 161 | 3.58 / 0.011 |
| `List<topology.bend:Coedge>` | 2 | 25 | 161 / 3233 | 161 / 161 | 2.44 / 0.018 |
| `List<face-classification.bend:DomainChoice>` | 1 | 21 | 161 / 1697 | 161 / 161 | 3.54 / 0.020 |
| `String` | 1 | 71 | 129 / 1665 | 129 / 129 | 3.85 / 0.570 |
| `List<identity.bend:ParentIdentity>` | 4 | 5 | 129 / 4225 | 129 / 129 | 3.69 / 0.083 |
| `List<geometry.bend:Vec3>` | 3 | 5 | 97 / 4097 | 65 / 65 | 3.30 / 0.005 |
| `List<identity.bend:EntityIdentity>` | 10 | 3 | 129 / 10369 | 129 / 129 | 4.70 / 0.008 |
| `List<topology.bend:Edge>` | 2 | 1 | 97 / 3137 | 97 / 97 | 1.79 / 0.006 |
| `List<topology.bend:Face>` | 10 | 1 | 129 / 10337 | 97 / 97 | 3.54 / 0.006 |
| `List<real.bend:Real>` | 2 | 1 | 97 / 3105 | 65 / 65 | 1.84 / 0.004 |

Probes: 214 per run; heap pages that depend on the claim: before 214 / 214 / 214, after 0 / 0 / 0. One heap page is 128 words (1 KiB).

Bench: 2026-09-23T03:05:29.889Z – 2026-09-23T03:08:28.368Z, build 079288cf6050 (cache hit), load 22.02 → 18.22.

### Reading the numbers

- **The factors are stable across three benches at very different loads**: 8.2x to 11.7x at load 18 to 24 (this
  bench), 8.5x to 11.4x at 28 to 58 (first Regression review), 7.6x to 12.6x at 13 to 15 (first bench); projection 7.4x to
  9.3x. The absolute times follow the load: planar-union js 2.7 s here, 5.9 s at load 28 to 58; native 0.30 s and
  0.64 s.
- **The two predicted gains hold.** The JS kernel load disappears: cold start to kernel ready is 37 to 42 ms native
  against 860 to 1,082 ms js. The Booleans run 7.9 to 13x faster than in the js count runs (union 168 against
  2,190 ms in planar-union, 136 against 1,520 ms in fuse-g1, 1,234 against 9,801 ms in frame-with-tab; subtract 308
  against 2,931 ms in planar-pocket, 600 against 5,803 ms in cut-h1, 300 against 2,851 ms in frame-with-tab). The
  count runs instrument every call, so the js side of this comparison is somewhat inflated.
- **Deviation from the projection over 20 %: only fs-bracket (+57 %)**, in the favourable direction: native 73 ms
  against a projected 114 ms (js 850 ms, profiled 841 ms). The projection kept the whole non-kernel remainder of the
  profiled js run, part of which was module loading slowed by the Bend compiler's ESM hooks, which a native process
  never registers (the first bench showed +70 % for the same reason). The other factors are within 20 % (fuse-g1
  +19 %, planar-pocket -12 %, planar-union +6 %, cut-h1 -3 %, frame-with-tab +2 %); the native medians lie within
  -10 % to +8 % of their projections (planar-union 302 against 323 ms, frame-with-tab 1,867 against 1,725 ms).
- **The count guard costs nothing measurable end to end.** Replaying 624 recorded calls on the build before the guard
  and on this one (alternating fresh processes, load 16 to 19): every reply identical, the kernel entries within noise
  (subtract 645 → 635 ms, union 148 → 144 ms, `identity.boolean_result` 17.4 → 17.1 ms). The walk that counts the
  request adds about 4 ns per word; it shows only on small, fast entries with long requests (`planar_measures`,
  1.4 to 3.2 k words: 0.14 → 0.16 to 0.25 ms). A claim of 2^16 elements reached 1,665 to 18,593 heap pages
  (1.6 to 18 MiB) and up to 15.7 ms before the guard, and exactly the pages of a claim of 1 (at most 161) after it.
- **The heap clear costs nothing measurable and removes the drift.** In one process, 40 repeats of the heaviest
  `identity.boolean_result` request after 8 passes over 624 calls: 22.2 → 22.1 ms with the clear, 56.4 → 112.5 ms
  without; the Booleans did not drift in either mode (the verifier saw union 175 → 191 ms after 150 identity calls).
  Max RSS is the same (125 vs 126 MiB): the clear does not return pages, it stops the scatter.
- **Identity costs more natively than on the JS target** (unchanged finding): `identity.boolean_result` takes 10.1
  to 86.8 ms native per run (plus 2.0 to 23.0 ms decode) where the JS target needs 3.5 to 13.3 ms. The identity string
  packing and native revision hash decisions are outside this slice (docs/native-bridge.md, open decisions); this
  measurement says they matter.
- **6 threads** (secondary, one run each): 1.3 to 1.6x faster than the 1-thread median for the five Boolean
  workloads, 1.0x for fs-bracket, outputs identical. The default stays 1 thread (a pool-worker fail-stop still ends
  the process).
- **First load after a rebuild** costs about 0.2 to 0.3 s once (macOS first-use check of a new binary; 3.1 s once at
  load 110), then 0.5 to 0.6 ms. A fresh copy of the same binary pays it again (first fs-bracket run 304 ms with a
  221 ms dlopen, second 74 ms).
- **The stale check** costs 5.6 to 6.8 ms per open: the input-file hashes (1.8 to 2.4 ms), the toolchain (1.3 to
  1.5 ms), the `.node` sha256 (1.1 to 2.0 ms), the wiring parse (0.4 ms), key and codecs (0.2 to 0.7 ms each).

## Loud failures (test/native-bridge-slice.test.mjs, 26 tests)

| case | what happens | test |
|---|---|---|
| entry outside the 19 (bored-spacer: `precise.frame` in the frustum construction) | `NativeCapabilityError` naming entry, build and backend; exit 1; nothing exported; no JS kernel | (a) |
| cylinder extrude inside `try silent` | same error escapes the `try silent`; on js the snippet builds both bodies | (a) |
| r10b | exit 1 in 0.1 to 0.2 s at `precise.dot`; no JS kernel; `r10b.fs` unchanged | (b) |
| build123d `Cylinder` (`translated-cylinder.py`, checked by hand in the first round) | same capability error with the Python source line, exit 1, no JS kernel | – |
| changed input file / edited manifest (toolchain record, routing, wiring record, set) / `.node` bytes or recorded sha256 / codecs | `NativeKernelStaleError` (`BX_STALE`) naming the change and the build command, before any `dlopen` | (c) ×2 |
| rewired or unparseable `loadKernel()` wiring | `BX_STALE` with the exact wiring change | (c) |
| toolchain changed (Bend library, Bend binary, clang) | `BX_STALE` with the changed toolchain field | (c) |
| no build | `NativeKernelError BX_LOAD` with the build command; the CLI exits 1 | (d) |
| malformed request words / unknown op / wrong argument types | `BX_WIRE` (status 1) / `BX_ARGS`; a later valid call succeeds; a value the strict codec cannot carry exactly (0.1 as F32) is `BX_ARGS`, never rounded | (e) |
| a List or String count the rest of the request cannot carry (up to 2^32 − 1) | `BX_WIRE` (status 1) before one element is decoded; heap pages identical to a claim of 1; no RSS growth | (j) |
| divergence or bridge error under a broad Python `except` / in FeatureScript / caught by a host | the run ends with the error, the `except` never runs, exit 1; a host that catches a divergence still exits 1 | (e) |
| per-call heap state | every call starts at heap page 1; `keep` mode demonstrably does not | (h) |
| `WONKY_NATIVE_SET=full`, `wonky-compare` on native | `BX_BACKEND` / capability error, exit 1, nothing written | (i) |
| `WONKY_BACKEND=fast` or `''` | `BX_BACKEND`; the CLI exits 1 | (f) |
| synthetic diff mismatch | `BackendDivergenceError` with op, entry, word index, field path (`result.lo (F32)`), dump of request and both replies | (g) |
| `WONKY_BACKEND` unset | backend block byte-identical to before | default off |

Also covered: build refusals (missing FID, arity, `BANGS`, non-list signature, width warning, smoke failure, lock; the
count-guard smoke check is exercised by running it against the build before Regression review 2, which it refuses),
probe refresh on a cache hit, the six workloads byte-identical with the guard showing no JS kernel, and the diff
counts per entry.

Existing focused tests, run with `WONKY_BACKEND` unset after the Regression review: `native-bridge-wire`,
`planar-boolean-native`, `planar-difference-native`, `python`, `python-cli` (37 tests together),
`native-bridge-binding` (7; rebuilt its probe addon with the changed `bx_addon.c`), and `kernel`, `identity`,
`source-map`, `step-pcurves`, `step-cylinder-pcurves`, `analytic`, `boolean` (68 tests together). All pass. The
full `npm test` was not run on the shared machine.

After Regression review 2 (no production touchpoint changed in that round): `native-bridge-slice` (26 tests, 85 s at load
13 to 16), `native-bridge-wire` (11), `native-bridge-binding` (7; it rebuilt its probe addon for the changed
`bx_addon.c` and its kernel addon for the changed generator), `planar-boolean-native` and `planar-difference-native`
(14 together, `WONKY_BACKEND` unset). All pass.

## Gaps and deviations

1. **Identity is the next native hotspot** (above). Options: packed strings on the wire (4 bytes per word), identity
   on the host, or a native revision hash; each is a decision for Marc.
2. **The negative cases fail at `precise.frame` / `precise.dot`**, not at `analytic.frustum` / `boolean.coaxial` as
   expected: those are the first non-slice entries the frustum construction and the r10b import reach.
3. **`nativeChainExact` stays false by design**: the compat step keeps today's host round trip on both backends, which
   is what makes it bit-identical to today.
4. **`src/python.mjs` changed beyond the backend block** (one guarded line, finding 1). Default behavior is unchanged
   because only the native and diff backends raise `NativeKernelError` or `BackendDivergenceError`.
5. **Paths that bypass `loadKernel()` are not routed.** Viewer and diagnostic adapters that import `.bend` files raw
   (display, intersections, junction, curve-plane, ...) fail on native, because the Bend import hook is never
   registered. The remaining `loadBend` users (section, the boolean ports, `loadSketchArcs`) would still load Bend JS
   if called on native. None of them is reachable from the production paths of `bin/wonky.mjs` and
   `bin/wonky-python.mjs`; the guard proves the absence of any Bend JS for the six workloads and the negative cases.
6. **Code of other workflows still assumes the JS target.** `src/lang/semcore/build.mjs` hard-codes
   `target: 'JavaScript'` and would mislabel a planar model built with `WONKY_BACKEND=native`;
   `src/lang/dataflow/py-trace.mjs` has its own copy of the Python error mapping without `endsRun`. Neither is a
   production CLI and both are outside this slice's writable paths; their owners should take `backendInfo()` and
   `endsRun` from `src/native/`. `src/comparison.mjs` also hard-codes the label, but it cannot run natively (its
   first kernel call is outside the slice).
7. **The toolchain fast path trusts the recorded file identities** (see "What the stale check covers"). After a
   toolchain change with a new identity the loader re-hashes (~30 ms) until the next `build-native.mjs` run refreshes
   the probe.
8. **The heap clear keeps the high-water pages mapped** (RSS does not shrink after a large call). Returning pages
   (`madvise` on reset) is out of scope; a long-lived host holds the largest call's footprint. Since Regression review 2 that
   footprint follows the length of the requests actually sent (a malformed request can no longer claim more), but a
   long valid request still leaves its pages resident.
9. **Every string key of the proxy is a function** (so `typeof kernel.anything === 'function'`). No production code
   enumerates or feature-tests the kernel namespace (checked by grep); a call to an unknown name throws.
10. **`reset()` after a fail-stop** is not exposed through the compat proxy; a CLI run ends with the error. Long-lived
    hosts need a policy first.
11. **The full-surface measurement** (84 entries) was rebuilt in Regression review 2 with the current driver, key schema and
    generator (its smoke test ran 456 count probes); the loader still never opens it.
12. Not in the slice, as planned: `api.bend` and exact carriers, handles, batching, Metal, threads > 1 as default,
    CLI flags, the final cache location under `.tools/`, entries of bored-spacer and other curved models, r10b natively.
13. All timings ran on a shared machine (load averages next to every table); absolute milliseconds are indicative.
14. **The count guard costs a walk over the request** (Regression review 2): `start` counts the words before decoding, about
    4 ns per request word (0.07 ms on the largest slice request, 17,976 words). Passing the length from the addon would
    avoid it, at the price of a second `kcall` signature; not worth it at this size.
15. **The 2^32-word request limit is not exercised by a test**: it would need a 16 GiB `Uint32Array`. The check is
    one comparison in `bx_kcall`; below the limit the counter is exact, and above it the counter could only over-refuse.
16. **A valid request can still ask the kernel for work in proportion to a value.** `identity.extrusion` (`n`) and
    `identity.boolean_result` (`vertices`, `edges`, `faces`) take counts as U32 arguments and build that many identity
    records (`local_roles(U32.to_nat(n), ...)`), so a short, well-formed request with a count of 2^32 − 1 would still
    allocate without bound. That is kernel semantics, identical on the JS target (a native-only limit would break the
    bit-identity with it); the production host passes the real body counts. A bound belongs in the kernel
    (`kernel/identity.bend`, outside this slice's writable paths).

## State after the third verification round (2026-09-23)

Fixed after the workflow ended:

- **Build published edited code under a clean hash.** An input edited during `build-native.mjs` and reverted before the build finished kept its content hash, so the edited binary was cached under the clean source hash. The build now records the identity (inode, size, mtime, ctime) of every input before it starts and refuses to publish if any of them changed (`statInputs`/`touchedInputs` in `src/native/build-key.mjs`, regression test `test/native-bridge-build-guard.test.mjs`).

Still open:

- **medium:** terminating a `worker_thread` during a native kernel call crashes the whole Node process with SIGSEGV. The runtime is process-global; the addon needs a cleanup hook that waits for the call or refuses termination.
- **low:**
  - `--cache` with a relative path fails at the clang step.
  - `WONKY_BACKEND=diff` treats two NaNs with different bit patterns as a divergence.
  - Lone-surrogate `Char` words are accepted natively but throw on the Bend JS target.
  - The count-guard evidence relies on a pre-fix build that no script regenerates.
