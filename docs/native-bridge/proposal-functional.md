# Native bridge proposal: a narrow, stateless functional kernel module

Date: 2026-09-22. Role: architect, angle "narrow functional module". Machine: Apple M5 Pro (18 logical CPUs), macOS
arm64, Node v22.23.1, Bend 2.0.25, Apple clang 17.0.0.

This is a design, not an implementation. It builds only on measurements already taken in
[profile.md](profile.md), [surface.md](surface.md), [binding.md](binding.md) and [baseline.md](baseline.md). I added
just two small new numbers, both labelled where they appear: 2.4 ms to hash the kernel sources, and one clang codegen
check. Every speedup below is a **projection** assembled from those measurements, and the arithmetic is scripted
(`scripts/native-bridge/proposal-projection.mjs`, output in `out/native-bridge/proposal-functional/projection.json`).
None of it is an end-to-end native measurement. All source measurements ran on a shared machine at load average 11.6
to 15, so they are indicative.

## Decision in short

1. **In-process works and is the mechanism.** The binding stage ran Bend-emitted C inside Node as a plain N-API
   addon with no npm dependencies. It is built by scripts from unedited emitted C. On real captured production
   planar Booleans it was bit-exact against the JS target and 8.3 to 9.7x faster at 1 thread. The out-of-process
   service works but is clearly worse: about 20x the per-call cost, 26 ms/MB, and it needs a blocking client. It
   stays only as optional isolation (section 5). There is nothing to "pretend" here: the preferred mechanism is
   proven.
2. **One backend interface, one function:** `call(op: number, request: Uint32Array) -> Uint32Array`. The native
   backend implements it with one bound Bend def (`kcall(op, words)`, the exact shape the binding stage proved on
   the real kernel). The JS reference backend implements it with the same generated codecs around the Bend JS
   target. A diff backend runs both and compares replies word for word.
3. **Stateless, body in / body out.** The addon holds no handles and no state between calls. Bodies cross as exact
   flat U32 encodings (F32 as bit patterns, `Real` as two F32 words). The host keeps each result body's exact words
   as an opaque, module-private **carrier** next to its decoded binary64 **view**. When a body is an operand again,
   the carrier's words are copied verbatim into the request. The view is for queries, JSON and export only and is
   never re-encoded. This alone fixes `nativeChainExact: false`, with no resident handles and no lifetimes to
   manage.
4. **End state: 12 coarse ops** (`extrudePolygon`, `frustum`, `sketchLines`, `sketchArcs`, `extrudeProfile`,
   `transform`, `boolean`, `importBrep`, `identify`, `stepPcurves`, `printMesh`, `compareCoaxial`) plus `info`. They
   are implemented once in `kernel/service/api.bend` and compiled for both targets. The host adaptation that loses
   F32x2 words moves into Bend: `classificationInput`, the Boolean branch argument preparation, `validateAnalytic`
   residuals, the transform measure carry-over and `importOnshapeBody`'s numerics.
5. **Being skeptical about my own angle:** narrowing buys **exactness and a smaller surface, not speed**. The
   profile bounds everything the host does around the kernel at 0.42 % of a run. So the first shippable step is
   deliberately *not* narrow. It is a generated, fine-grained **compat backend** that serves today's 84 emittable
   production entry points natively, bit-identical to today. That is where the measured speed lands: about 7 to 9x
   end to end on every workload except r10b. The narrow ops then replace compat rows group by group, each step
   shipping alone.
6. **r10b gains nothing natively yet.** `ports/curved-intersection.bend:intersect` cannot be emitted as C (Bend
   2.0.25 "an arity over 255", inside the kernel itself). On the native backend it raises a capability error. It is
   never silently run on JS.

## 1. What the design stands on

| fact | value | source |
|---|---|---|
| Kernel share of wall, Boolean-heavy runs | 68 to 98 % (GC re-attributed) | profile.md |
| Bend JS kernel load per CLI run | 0.75 to 0.81 s; small models spend 82 to 87 % there | profile.md |
| Frontend + host adaptation + export | at most 1.1 % of any run; host adaptation at most 0.42 % (2 to 16 ms, r10b 54 ms) | profile.md |
| Dominant calls | 1 to 4 calls carry 76 to 99.9 % of kernel time | profile.md |
| In-process call floor / marshaling | 0.5 us; about 6 ns/word in, 7 ns/word out (one Bend cons cell per word) | binding.md |
| Native vs JS target, same captured calls, in process | 168.6 / 307.3 / 292.3 / 1249 ms vs 1639 / 2820 / 2703 / 10424 ms (1 thread); bit-exact at 1, 6 and 18 threads | binding.md, `kernel-t1.json` |
| 6 threads | 112.7 / 196.5 / 177.1 / 813.5 ms (1.50 to 1.65x over 1 thread); 18 threads adds nothing | binding.md |
| Addon load / init | 0.65 to 0.87 ms / 0.07 to 0.12 ms (1.2 MB probe); 287 ms on the first load of a freshly written `.node` | binding.md |
| Soak | 300 planar unions identical; RSS flat with forced GC | binding.md |
| Out of process | 22 to 29 us per call, 26 ms/MB, blocking client needed; r10b pattern costs 0.5 s of transport | baseline.md |
| Surface today | 85 production entries, 108 call sites in 16 JS files, 121 wire ADTs, 27 precision sites | surface.md |
| Generated codecs | 695 real values round-trip bit-exactly; 153/153 dispatch replays word-identical; 84/85 entries emit as C | surface.md |
| Host round trip loses words | 131 of 9,784 result Reals change under `real(number(x))` | surface.md |
| Source hash cost (new, mine) | sha256 over all 71 kernel `.bend` files (891,263 B): 2.39 ms at load 13.9 | this document |
| FMA contraction (new, mine) | clang -O3 fuses a bare `a*b+c` into `fmadd`, but Bend's `f32_rewrap(f32_unbox(..)*..)` pattern stays `fmul` + `fadd`; Bend's Metal path passes `--fmad=false` | 5-line reproduction; `kgen/kernel.c:135545` |

## 2. Architecture

```
FeatureScript interpreter, build123d shim, queries, exporters        (JS, unchanged role, synchronous)
      |  typed calls: kernel.boolean({a, b, operation, ...}) -> {bodies, ...} | refusal
src/native/kernel-api.mjs      facade: encode request, call, decode reply, attach views + carriers
      |  generated codecs  (<cache>/<sourceHash>/wire.mjs, from kernel/service/api.bend declarations)
      |
      |  call(op: number, request: Uint32Array) -> Uint32Array        <- the ONE backend interface
      +-- native: wonky-kernel.node   = bx_pre.h + unedited Bend C + generated op table + bx_addon.c
      |           N-API call -> kcall(op, words) in the Bend heap -> reply words
      +-- js:     api.bend on the Bend JS target (loadBend cache) + the same JS codecs
      +-- diff:   both; replies must be equal word for word, else BackendDivergenceError
```

- **Process model.** One Bend runtime per process: the heap, allocators and pool are process-global statics. It is
  initialized once with `init({threads})`, and calls are serialized by the addon's mutex. Parallelism happens
  *inside* a call through Bend fork-join on the pool, which persists across calls. `worker_threads` may call in,
  but they serialize (binding: 159 ms concurrent vs 114 ms sequential).
- **The native backend never loads the Bend JS kernel.** Nothing on the native path imports `bend-loader.mjs`'s
  compiler hooks or calls `loadKernel()`. That 0.75 to 0.81 s is the entire gain for small models.
- **Selection is explicit** (`--backend native|js|diff`, `WONKY_BACKEND`). It is never inferred from what happens to
  be installed. A missing or stale addon is an error, not a reason to run on JS (section 5).
- **What stays in JS:** parser, interpreter, values and units, record/lineage bookkeeping, queries over views,
  FeatureScript input rules (`validatePolygon`, orientation by `signedArea`, `plane()` normalization), identity
  metadata and the revision hash, operation-evidence JSON, message tables for refusal codes, STEP/STL/HTML text
  writers, the Python bridge.

## 3. The API

### 3.1 Backend interface (JS, internal)

```js
// src/native/backend-*.mjs: all three implement exactly this
interface KernelBackend {
  readonly kind: 'native' | 'js' | 'diff';
  readonly info: { target: 'arm64' | 'JavaScript', api: number, wireHash: string, sourceHash: string,
                   bend: '2.0.25', threads: number };
  call(op: number, request: Uint32Array): Uint32Array;   // synchronous; reply = [status, ...payload]
}
```

- `NativeBackend.call` is `addon.call(op, request)`.
- `JsBackend.call` does: generated JS decoder on `request` -> call the JS-target def -> generated JS encoder -> reply.
  A decode failure gives `[1]` and an unknown op gives `[2]`, the same statuses as the Bend dispatcher.
  So both backends always see bit-identical inputs.
- `DiffBackend.call` calls both and compares. On success it returns the (identical) reply.

### 3.2 Native addon (C) and Bend entry

The production driver is the binding stage's `bx_addon.c`, trimmed to what a stateless module needs. Handles
(`read`, `dup`, `drop`), the IO bridge (`run`) and `gpuBuild` stay in the probe tooling and out of the production
addon.

```c
init({ threads: number })          -> { heapReservedBytes }   // once per process; second call: BX_ONCE
call(op: number, req: Uint32Array) -> Uint32Array             // evaluates kcall(op, words); reply [status, ...]
info()                             -> { api, wireHash, sourceHash, bend, clang, napi, threads, target }
reset()                            -> undefined               // only after BX_FAILSTOP (0.10-0.13 ms)
stats()                            -> { calls, poisoned, rssKiB }
```

```
# generated entry (never hand-edited; lives in the build cache)
def kcall(op: U32, words: List<&2, U32>) -> List<&2, U32>      # status word ++ encoded reply
def main() -> ...                                              # only makes kcall reachable; never run
```

A single bound def sidesteps the fragility the binding stage found. Bend inlines small defs (their FID vanishes) and
splits non-recursive Data parameters into slots (a `KOut` became 12 slots, `WL_RESW` 51). `List<U32> -> List<U32>`
survives both, as the real-kernel build showed. The driver range-checks `op` because Bend compiles `match` on U32 to
if/else and would silently run the last arm. Generated dispatchers also end in an explicit "unknown op" arm.

### 3.3 The JS facade and the 12 ops (end state)

```js
// src/native/kernel-api.mjs (hand-written, about 300 lines; the codecs underneath are generated)
export async function openKernel({ backend = process.env.WONKY_BACKEND ?? 'js', threads, build } = {}): Kernel

kernel.info                                                        // { backend, target, api, wireHash, sourceHash, threads }
kernel.extrudePolygon({ points, plane: {origin, normal, x}, delta, offset, box })       -> Built
kernel.frustum({ first: Circle, second?: Circle, delta?: Vec3, offset })              -> Built | Refused
kernel.sketchLines(segments)                         -> { profile: Profile, points, uses } | Refused
kernel.sketchArcs(entities)                          -> { profile: Profile, view } | Refused
kernel.extrudeProfile({ profile, plane, delta, offset })                             -> Built | Refused
kernel.transform(body, { rows, offset })                                             -> Built
kernel.boolean({ a, b, operation, method, policy, tolerance })
                                   -> { bodies: Built[], provenance, stats, sourceBudget } | Refused
kernel.importBrep(onshapeSolid)                                                      -> Built | Refused
kernel.identify(kind, { namespace, operation, occurrence, revision, ...kindArgs })  -> IdentitySet
kernel.stepPcurves(body, budget)                                                     -> PCurves
kernel.printMesh(body, deviation)                                                    -> Rings
kernel.compareCoaxial(a, b, tolerance)                                               -> Comparison
// Built   = { view: BodyView (today's body JSON shape), audit }  + module-private exact carrier
// Refused = { refused: { method, code, stage, detail } }  -> the caller maps codes to its message table
```

| op | Bend def in `kernel/service/api.bend` | absorbs (today's host code / entries) | wire today (in / out words) |
|---|---|---|---|
| `extrudePolygon` | `op_extrude_polygon(points, frame, delta, offset, box) -> Built` | `extrudeInBend` (frame, lift_points, translate, extrude), `box_layout` admission, `decodeSolid` measures | 22 / 227 |
| `frustum` | `op_frustum(first, second?, delta?, offset) -> BuiltOrRefused` | `circularFrustumInBend`: precise.* chatter, 1e-10 height and 1 - 1e-6 coaxiality admission, `applyFrustumMeasures` | 22 / 164 |
| `sketchLines` / `sketchArcs` | `op_sketch_lines`, `op_sketch_arcs` | `sketchLines.solve`, `solveSketchArcs` | 100 / 222; 255 / 541 |
| `extrudeProfile` | `op_extrude_profile(profile, ...)` | `extrudeSketchArcs` + its decode checks, `precise.add` of the offset | 255 / 541 |
| `transform` | `op_transform(body, rotation, offset) -> Built` | `transformInBend`, `transformAnalytic`, the `construction.method` switch for measure carry-over (`point_transform`, `rim_bounds`, `halfspace.bounds`) | 3,510 / 3,486 |
| `boolean` | `op_boolean(a, b, operation, method, policy, tolerance) -> BooleanReply` | per-branch argument prep (`classificationInput`: `linear_edge`, `max_budget`, domain choices; pierce axis/reach/radius; coaxial primitive), `halfspace -> solid-intersection` fallback, `curved.audit`, `planar_measures`, `bore_depth`, `pierced_volume`, `real.max` | 892 / 2,440 (union); with carriers the request is the two carriers verbatim |
| `importBrep` | `op_import_brep(source) -> BuiltOrRefused` | `importOnshapeBody` numerics: 13 `analytic.*` constructors, residual gates, periodic seams, tolerance accumulation (r10b: 18,604 calls become about one per part) | 3,342 / 3,486 |
| `identify` | `op_identify(kind, ...strings, args) -> IdentitySet` | 11 `identity.*` entries | up to 142,741 / 190,974 |
| `stepPcurves` | `op_step_pcurves(body, budget)` | `fullBandPCurve`, `cylinderPCurves` without re-encoding the body | 302 / 399 |
| `printMesh` | `op_print_mesh(body, deviation)` | `tessellate.*` (the file `src/print-mesh.mjs` belongs to the bake-off; coordinate) | 21 / 217 |
| `compareCoaxial` | `op_compare_coaxial(a, b, tolerance)` | `comparison.coaxial` | 30 / 22 |
| `info` | `api_version()` + generated hashes | | 0 / 20 |

Compared with the surface stage's 16 handle-based operations, `release`, `view` and `measure` disappear. The view is
decoded in JS from the reply, which already carries the measures. `display_mesh` also disappears: the viewer
(`wonky-view`) explicitly opens the JS reference backend and says so. It is interactive, not a batch hot path.

`boolean` takes a `method` word (`PLANAR`, `CONVEX`, `CURVED`, `PIERCE`, `COAXIAL`) that JS still selects with
today's predicates. Those predicates read only discrete types from the view (plane/cylinder, line/circle), primitive
presence and an exact-zero budget test, so they lose nothing. Bend re-checks admission and refuses otherwise. This
keeps every branch migratable on its own. `method: AUTO`, with selection inside Bend, can come later and is optional.

### 3.4 Data layout

Wire rules (unchanged from surface.md section 7, proven by 695 bit-exact round trips):

| value | words |
|---|---|
| `U32` | 1 |
| `F32` | 1, the IEEE bit pattern (`-0`, subnormals, infinities, NaN payloads preserved; no flush to zero) |
| `Bool` | 1, 0 or 1; anything else is a decode error |
| `Real` (F32x2) | exactly 2: `bits(hi), bits(lo)`. **Never** binary64 |
| ADT | a tag word if more than one constructor, then the fields in declaration order |
| `List<T>`, `String` | a count, then the elements (`String`: one word per code point, at most 0x10FFFF) |
| `Maybe<T>` | tag (0 None, 1 Some) + value |
| refused by the generator | `Nat`, `Cmp`, closures, arrays, generics, recursive types; none is on the production surface |

Request: `op` is a separate argument, and `request` holds the op's parameters in order. Reply:
`[status, ...payload]`, where status 0 = ok, 1 = malformed request, 2 = unknown op. Domain refusals are **values**
inside the payload (`Refused{...}` constructors), not statuses.

The body type the ops exchange (new, in `api.bend`):

```
type Body is Data:
  Polyhedral{solid: T.Solid, measures: Measures}                     # F32 path (topology.bend), as today
  Analytic{solid: A.Solid, domains: List<&2, F.DomainChoice>, budget: R.Real,
           tolerances: List<&2, R.Real>, primitive: Primitive, measures: Measures}
type Primitive is Data:
  NoPrimitive{}
  Frustum{bottom: P.Vec3, top: P.Vec3, r0: R.Real, r1: R.Real}     # kept exact for coaxial / pierce / compare
type Measures is Data:
  Measures{volume: Maybe<&2, R.Real>, bounds: Maybe<&2, A.Bounds>, rule: U32}   # rule = carry-over under transform
type Built is Data:
  Built{body: Body, audit: Audit}                                   # audit: residual maxima, closure, tolerances
```

**Carriers.** The generator gets one extension: for every value of type `Body` (and sketch `Profile`), the JS
decoder records its `[start, end)` word range in the reply. The facade keeps `reply.subarray(start, end)` as that
body's carrier in a module-private `WeakMap<view, Uint32Array>`, so nothing outside the facade can reach or mutate
it. The request encoder copies a carrier with `TypedArray.prototype.set` (memcpy). It never rebuilds a `Body` from a
view. The only exception is an explicit input serialization (a body read back from `brep.json`, for example in
`wonky-compare`), which is labelled `exact: false` in its evidence.

**Zero-copy, honestly.**

- In: `napi_get_typedarray_info` hands the addon a pointer into V8's buffer, and Bend list cells are built straight
  from it. There is no JS-side or intermediate copy. The facade reuses one growing scratch `Uint32Array` per process,
  which is safe because calls are synchronous and the addon does not retain the buffer.
- Out: the driver today does `bx_list_take` (malloc) plus a `memcpy` into a fresh `ArrayBuffer`. It should count the
  list, allocate the `ArrayBuffer` once and fill it while sinking the cells. Carriers are `subarray` views into that
  buffer.
- The Bend heap representation (one cons cell per word, about 6 to 7 ns) is the one materialization per direction
  that N-API cannot avoid. A packed buffer type in Bend's interface would remove it. It is not needed at today's
  sizes: 3,000 words cost about 20 us.

### 3.5 Versioning

- `API_VERSION` (a `U32` def in `api.bend`, bumped on semantic changes) and `WIRE_HASH` (sha256 of the generated
  manifest: types, layouts, op table) are baked into both the addon (`info()`) and the generated `wire.mjs`.
  `openKernel` requires both to be equal. There is no cross-version compatibility to maintain, because both sides
  come out of the same generator run.
- `SOURCE_HASH` identifies a build (section 11). It is recorded in `brep.json` as
  `backend: { language: 'Bend', version: '2.0.25', target: 'arm64' | 'JavaScript', api, sourceHash }`. Today
  `src/index.mjs` hard-codes `target: 'JavaScript'`.
- Model outputs of the two backends are identical except for `backend`. Cross-backend golden comparisons ignore that
  one field.

## 4. Exactness guarantees

1. **F32 and F32x2 cross bit-exactly** in both directions (binding `exact.json`: 21 special values, 4096 F32x2 words;
   every result word of the four real kernel calls equal to the JS target).
2. **Chains are exact.** An op's operand bodies are the previous replies' words, copied verbatim. On today's host
   path `decodeAnalytic` collapses `hi + lo` into binary64 and `encodeAnalytic` re-splits it (`src/real.mjs:9`,
   `src/analytic.mjs:132`). That round trip is removed from every production path. That is the cause of
   `nativeChainExact: false`, and it is fixed without handles. The acceptance check is the frame-with-tab chain: the
   `union` request must contain the `subtract` reply's body words byte-for-byte, and the native and JS chains must be
   identical.
3. **Both backends agree bit for bit.** They run the same Bend source, see the same request words and are compared
   word for word in diff mode. This held even on today's lossy host path, and it continues to hold.
4. **Where binary64 legitimately remains:**
   - *Input serialization.* FeatureScript and Onshape numbers are binary64 by language. `real()` splits them once
     on entry (`hi = fround(x)`, `lo = fround(x - hi)`). That is input rounding, not a round trip.
   - *Views.* Views are binary64 for queries, JSON and export text.
   - *Values that pass through FeatureScript user code* (for example an `evLine` result used to build a new
     sketch) re-enter as binary64 inputs. This is inherent to the language and stays documented.
5. **The F32 polyhedral path stays F32** and is reported as such, exactly as today (`src/kernel.mjs:32`). The native
   F32 input is `Real.hi`, which is bit-identical to today's `Math.fround`.
6. **FMA.** The emitted pattern does not contract (see the table in section 1). The build still pins
   `-ffp-contract=off -fno-fast-math` and puts the flags into the source hash, as defense in depth. Metal already
   gets `--fmad=false` from Bend.
7. **NaN.** Signalling-NaN quieting differs (binding: clang folds `x*1.0`). Geometry must be finite, so the view
   decoder rejects non-finite `Real`/`F32` in body geometry with `NativeKernelError`. Diff mode compares raw words,
   and a NaN in any other field is reported as a divergence.
8. **Deliberate one-time change.** Once a narrowing step routes a chain through carriers, multi-operation models
   change in their last bits relative to today (131 of 9,784 Reals changed in the surface replay). This changes
   revision hashes and possibly printed STEP digits. It happens in the same commit for both backends, with a
   reviewed golden update, one op group at a time (section 13).
9. **A lint enforces it.** `surface-scan.mjs`'s precision-site table becomes a check: after the migration no
   `refeed` site may remain in a production path.

## 5. Failure semantics

| situation | reaches JS as | process | notes |
|---|---|---|---|
| Domain refusal (`Refused{method, code, stage, detail}`, decline codes, unresolved arrangement) | `UnsupportedFeatureError` at the FeatureScript source location, message from the host table (`PIERCE_DECLINES` etc.) | runs | not catchable by FeatureScript `try`/`try silent` (`catchable()` in `interpreter.mjs`) |
| Failed kernel audit (`audit.valid = false`) | `fail()`, as today | runs | today's semantics kept; changing them is not binding work |
| Malformed request / unknown op / wire or API mismatch | `NativeKernelError{code: 'WIRE' \| 'OP' \| 'VERSION'}` | runs | a bug, never a capability; not a `FeatureScriptError`, so FeatureScript cannot catch it |
| Op not in the native build (curved intersection) | `UnsupportedFeatureError('... not available in the native kernel: Bend 2.0.25 cannot emit it (arity over 255); use --backend js')` | runs | loud refusal; no re-run on JS |
| Runtime fail-stop on the calling thread (Nat overflow, stack overflow, heap/GPU OOM) | `NativeKernelError{code: 'FAILSTOP', reason}`; runtime poisoned | runs | the build fails; a resident process calls `reset()` (0.1 ms) before its next build. RSS after a stack overflow stays at about 2 GB (`reset` lacks `madvise`) |
| Runtime fail-stop on a pool worker (threads > 1, or any `!` in the module) | nothing: stderr `bend: <reason>` + `bend-binding: fail-stop outside a JS call` | **exits 1** | unavoidable without a runtime change (a CPU variant of the device's cooperative `H_ERROR_CODE` path). Loud, but the FeatureScript context is lost |
| Addon missing, stale, or built for another Node-API/arch | `NativeKernelStaleError` listing changed files and the build command | runs | never loads a stale binary; never switches to JS |
| Divergence in diff mode | `BackendDivergenceError{op, wordIndex, fieldPath}` plus a request/reply dump for replay | runs | |
| Runaway op | none (in-process calls cannot be interrupted) | Ctrl-C ends the CLI | a long-lived server that needs deadlines uses the out-of-process service as isolation (baseline: crash detected in 1 to 5 ms, restart 2 ms) |

**No fallback, anywhere.** No error path of the native backend calls the JS backend. The JS kernel is loaded only
when `backend` is `js` or `diff`. A test asserts that `bend-loader.mjs`'s `registerBendImports` is never invoked in a
native-only process.

## 6. What changes in `src/` and `kernel/`

`kernel/`:

| path | change |
|---|---|
| `kernel/service/api.bend` (+ `kernel/service/api/*.bend` per op group) | **new**, hand-written Bend: `Body`, `Measures`, `Primitive`, reply ADTs, `api_version`, the `op_*` defs. It imports existing modules and does not change them. My estimate is 1,000 to 2,000 lines at the end state, written under Bend's constraints: no forward references, staged defs, match only on parameters |
| generated `entry.bend`, `wire.bend` | produced into the build cache by the build script, never committed, never hand-edited |
| existing kernel modules | untouched by the binding. **Separate track:** make `ports/curved-intersection` -> `ports/curved.clip` -> `section.section` emittable (narrow or box wide records held across non-tail calls), or get an upstream compiler fix |

`src/` (per migration step; section 13):

| file | change |
|---|---|
| `src/native/kernel-api.mjs`, `backend-native.mjs`, `backend-js.mjs`, `backend-diff.mjs`, `cache.mjs` | **new**: facade, three backends, source-hash manifest and stale check |
| `src/native/binding/bx_addon.c`, `bx_pre.h` | the production driver trimmed (no handles, no bridge); single-pass reply fill |
| `src/native/include/` | **new**: vendored, pinned Node-API headers with provenance. Today the build reads them from `~/Library/Caches/node-gyp/<version>`, which only exists if node-gyp once ran |
| `src/kernel.mjs` | `loadKernel({backend})`: returns the generated compat proxy on native (step 1), later only the internal JS reference; `extrudeInBend`/`transformInBend`/`decodeSolid` replaced by facade calls |
| `src/index.mjs`, `src/python.mjs` | `openKernel()`; `backend` block from `kernel.info` |
| `src/boolean.mjs` | selection stays; per-branch argument preparation deleted; `method` word + facade call; message tables stay |
| `src/planar-boolean.mjs`, `solid-intersection.mjs`, `curved-intersection.mjs`, `halfspace.mjs` | shrink to view building plus JS integer checks of provenance indices (kept as an independent second check) |
| `src/analytic.mjs` | `importOnshapeBody` -> `importBrep` + message table; `decodeAnalytic` -> view builder without kernel calls; `encodeAnalytic` leaves production (kept for explicit input serialization); `validateAnalytic` keeps its pure topology checks, residuals come from the Bend audit |
| `src/face-classification.mjs` | `classificationInput` leaves production (diagnostic `classifyPlanarFace` keeps it) |
| `src/identity.mjs`, `comparison.mjs`, `sketch-arcs.mjs`, `library.mjs` (skSolve/opExtrude), `modules.mjs`, `queries.mjs` (opPattern) | call the facade |
| `src/exporters.mjs`, `step-pcurves.mjs`, `step-cylinder-pcurves.mjs` | no Bend load at import time (today 110 ms of every `--help`); `toStep(model, name, kernel)`; pcurves from carriers |
| `src/print-mesh.mjs` | owned by the bake-off. The compat proxy serves `kernel.tessellate.*` without edits; `printMesh` is adopted when the bake-off agrees |
| `src/real.mjs` | `number()` for views, `real()` for input serialization only |
| `bin/wonky.mjs`, `wonky-python.mjs`, `wonky-compare.mjs` | `--backend`, `--threads`; `--help` loads no kernel |
| `scripts/native-bridge/build-kernel.mjs` | **new** (extends `binding-build.mjs`): generate -> `bend -o .c` -> clang -> smoke test -> atomic publish into the cache |
| `scripts/native-bridge/gen-wire.mjs` | + carrier ranges, + op table read from `api.bend`'s `op_*` defs, + `WIRE_HASH` |

## 7. Expected end-to-end speedups

**Method** (scripted: `node scripts/native-bridge/proposal-projection.mjs`):

```
W      = mean of the two plain (uninstrumented) CLI wall times                        profile runs.json
T,K,B  = profiled total, kernel incl. kernel-caused GC, Bend JS load                   profile, attributed basis
s      = W / T                    (scales profiled buckets to plain wall time)
stay   = s * (T - B - K)          Node start, src module graph, parse + interpreter, host adaptation,
                                  Python bridge, export: everything that stays in JS
f      = dominant-call ms / kernel ms of the count run                                 profile calls
N      = native in-process p50 of the SAME captured call(s)                            binding kernel-t1/t6
rest   = s * K * (1 - f)          all other kernel calls, divided by k_rest = 9.48 (median measured ratio), pessimistic 1
L      = 5 ms                     ASSUMED warm addon load + init (probe 0.97 ms; full-kernel addon unmeasured)
O      = 1 to 5 ms (r10b 30)      ASSUMED crossing + JS codec per run (measured: < 1.5 ms per big call)
W_nat  = stay + N + rest / k_rest + L + O,   speedup = W / W_nat
```

`N` is measured for the three build123d cases. For fuse-g1 and cut-h1 (no captured native call) it is the count-run
JS time divided by the median measured native ratio, 9.48x at 1 thread (range 8.18 to 10.75) and 14.82x at 6
threads (12.73 to 16.08). r10b's dominant call cannot be built natively, so its row is hypothetical.

**Worked example, py-frame-with-tab.**

- Inputs: W = 13,851 ms; T = 15,471.1, K = 14,507.8, B = 806.2, so s = 0.8953.
- What stays in JS: stay = 0.8953 x 157.1 = 140.7 ms.
- Dominant calls in the count run: union 9,872.3 + subtract 2,736.3 = 12,608.6 of 12,921 kernel ms, so f = 0.9758.
- Everything else: rest = 0.8953 x 14,507.8 x 0.0242 = 313.9 ms, mostly `curved.audit` (282 ms).
- Native time of the same two calls: N = 292.3 + 1,249.4 = 1,541.7 ms at 1 thread and 177.1 + 813.5 = 990.6 ms at
  6 threads.
- 1 thread: W_nat = 140.7 + 1,541.7 + 313.9 / 9.48 + 5 + 5 = 1,725.4 ms, so **8.03x**.
- 6 threads: 140.7 + 990.6 + 33.1 + 10 = 1,174.3 ms, so **11.8x**.
- With the rest left at JS speed: 2,006 ms, so 6.90x.

| workload | W today ms | load | stays in JS ms | dominant call JS ms | native N 1t / 6t ms | **S 1 thread** | S 1t, rest at 1x | S 6 threads | first run after a rebuild (+287 ms) | only dominant call native, JS kernel still loaded |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| py-planar-union | 2,708 | 11.9-12.0 | 140.9 | 1,812 | 168.6 / 112.7 | **8.38x** | 7.32x | 10.1x | 4.44x | 2.61x |
| py-planar-pocket | 4,263 | 12.3-13.6 | 126.9 | 2,912 | 307.3 / 196.5 | **9.32x** | 7.24x | 12.3x | 5.73x | 3.24x |
| py-frame-with-tab | 13,851 | 13.5-14.1 | 140.7 | 12,609 | 1,541.7 / 990.6 | **8.03x** | 6.90x | 11.8x | 6.88x | 5.08x |
| fs-bracket | 841 | 13.3-13.5 | 107.3 | none | - | **7.40x** | 7.27x | 7.40x | 2.10x | 0.99x |
| fs-bored-spacer-print | 873 | 13.3 | 121.4 | none | - | **6.60x** | 5.28x | 6.60x | 2.08x | 0.99x |
| fs-fuse-g1 | 2,291 | 13.3-13.9 | 92.9 | 1,414 | 149 / 95 (extrapolated) | **9.0x** (8.2-9.7) | 7.92x | 11.4x | 4.23x | 2.44x |
| fs-cut-h1 | 6,211 | 13.2-13.8 | 96.4 | 5,272 | 556 / 356 (extrapolated) | **9.2x** (8.2-10.2) | 7.98x | 13.1x | 6.47x | 4.25x |
| fs-r10b-strict | 55,472 | 13.9-14.7 | 237.9 | 53,275 | not buildable | **n/a**: refused at the curved intersection | | | | |

Reading the table, skeptically:

- **Speed comes from two things only:** the kernel runs natively, and the JS kernel is no longer loaded. The last
  column shows the second one matters. If only the dominant call goes native and the JS kernel still loads, heavy
  runs reach 2.4 to 5.1x and small models 0.99x.
- **Small models are then bounded by JS that stays: about 107 to 121 ms.** That is Node start (about 24 ms), the
  `src/` module graph (about 70 ms) and CLI body plus export. Further gains there are not binding work.
- **Narrowing the API changes these numbers by less than the noise.** Host adaptation is at most 16 ms (profile,
  B vs A: at most +1.7 %). The compat step (13.1) and the end state project the same speed.
- **Threads:** 6 threads gave 1.50 to 1.65x per call, measured at load 14 to 15. An older standalone run showed no
  thread gain. This must be re-measured on a quiet machine before it is claimed.
- **Still slow next to OCCT:** even at 6 threads, frame-with-tab's kernel is about 1 s against OCCT's 9.4 ms. The
  binding does not close that gap. The planar cell classification (about 70 % under `classify_cell`) is algorithmic
  work.
- **r10b is the acceptance target and gains nothing until its curved path is emittable.** If it were, the same
  arithmetic with the planar ratio gives about 9.4x (5.9 s). That is not a prediction: its hotspot is list folds,
  not F32x2 arithmetic, and 16 % of its JS time is GC.
- **Every number above must be re-measured end to end with correctness checks** once each step exists (AGENTS.md).
  They are projections from measured parts on a shared machine.

## 8. Testing

- **One interface, every model test on both backends.** Everything that goes through `build()`, `buildPython()` or
  the CLIs goes through `openKernel`/`loadKernel`. Those test files run unchanged under
  `WONKY_BACKEND=native node --test test/<file>` and under `=diff`. In the compat phase (step 1) that also covers
  test files that call `loadKernel()` and one of the 84 production entries directly, because the proxy has the same
  namespace.
- **What does not run natively, and says so.** Counted by grep over the 70 test files:
  - 26 go through `build()`, `buildPython()` or a CLI (11 only that way, 15 also call Bend directly);
  - 33 call Bend only directly (`loadKernel`, `loadBend`, `registerBendImports`);
  - 12 do neither.

  Direct callers that reach the 84 production entries through `loadKernel()` run natively in the compat phase.
  Files that `loadBend` a module to unit-test definitions off the production surface (section, the port adapters,
  ray, junction, robust predicates, ...) test Bend semantics, not the binding, and stay on the JS target.
  `test/native-bridge-matrix.json` lists each test file as `both`, `js-only (non-production Bend defs)` or
  `native-refuses (curved intersection)`. A test checks that the list is complete. Optionally and later, `gen-wire`
  (2,148/2,191 defs encodable) can build per-module native test addons for a nightly job. It is not claimed here.
- **Differential bit-exact mode** (`WONKY_BACKEND=diff`): every op runs on both backends. Replies must match word
  for word, and a mismatch throws with the op, first word index and decoded field path, and writes
  `request.u32` / `reply-native.u32` / `reply-js.u32` for replay.
- **Replay corpus:** `WONKY_CAPTURE=<dir>` during a model-test run records every request.
  `scripts/native-bridge/diff-replay.mjs` replays the corpus on both backends. The corpus is pinned by hash and
  re-captured on API changes.
- **Exactness tests:**
  - the frame-with-tab carrier chain (section 4.2);
  - `nativeChainExact` recomputed from the new chain;
  - codec round trips (existing `test/native-bridge-wire.test.mjs`);
  - non-finite geometry rejected.
- **Failure tests:** stale binary refused, missing addon, version or wire mismatch, malformed request, unknown op,
  `FAILSTOP` plus `reset`, capability refusal visible through `try silent`, curved intersection refused on native, a
  pool-worker fail-stop exiting 1 (subprocess), and no `registerBendImports` in a native process.
- **Performance** runs separately, per AGENTS.md: cold start (with and without the first-load cost of a new
  binary), warm op per op (native vs JS, results compared), frontend, validation and export. Each step reports
  `uptime` next to every timing.

## 9. Metal routing policy

- **Off.** No production op contains a `!` call, so Metal has nothing to run. Device init costs 31 to 35 ms per
  process and each dispatch 0.26 to 0.65 ms. The Metal build of the kernel workload timed out after 911 s in another
  workflow, and a small workload took 18.97 s to compile.
- **An op may use Metal only when all four hold:**
  - its Bend code contains an explicit `!` batch site;
  - it is bit-identical against CPU and JS in the diff suite (Metal already builds with `--fmad=false`);
  - an end-to-end benchmark shows a gain after the 31 to 35 ms device init for CLI runs;
  - a Metal build finishes within a set budget.
- **Build and runtime rules.** Metal is a separate addon variant (`wonky-kernel.metal.node` + `.gpu` archive next to
  it, `bx_exec_path`), selected per process with `--gpu`. Device init happens once. GPU OOM becomes `FAILSTOP` +
  `reset()` (8 ms) and is never retried on CPU or JS.
- **Likely first candidates** are batch shapes like the 262k cylinder comparisons (Metal 2 to 3 ms vs 9 ms on 18
  threads), not single Booleans.

## 10. Threads policy

- `init({threads})` is fixed per process. **The CLI defaults to 6** (the measured sweet spot; 18 adds nothing). A
  pool-worker fail-stop then ends the process with exit 1 and a stderr reason. That is loud, and the CLI would exit
  on the error anyway.
- **Long-lived processes default to 1** (review server, an in-process test harness). With 1 thread and no `!` in the
  module, all work runs on the calling thread, so every fail-stop becomes a catchable `NativeKernelError`.
- The proper fix is a small Bend runtime change: CPU workers post to the existing cooperative `H_ERROR_CODE` path
  instead of `_exit`. It belongs upstream or in a scripted, versioned patch to the pinned runtime, never in
  hand-edited emitted C. With it, the default can be 6 everywhere.

## 11. Native build and caching

- **Command:** `node scripts/native-bridge/build-kernel.mjs [--threads-default N] [--metal] [--dev]`. It runs one
  compile at a time (lock file) and is fully scripted, with no hand edits:
  1. Resolve `api.bend`'s import closure.
  2. Compute `SOURCE_HASH` = sha256 over:
     - sorted (path, sha256) of the closure files;
     - `gen-wire.mjs`, `build-kernel.mjs`, `bx_pre.h`, `bx_addon.c`;
     - the vendored Node-API headers;
     - `bend.lock.json`;
     - `clang --version`, the exact flags (`-O3 -ffp-contract=off -fno-fast-math ...`), arch and the Node-API version.
  3. Cache hit: `.tools/wonky-native-cache/<hash>/` exists with a verified manifest, so stop.
  4. Generate `wire.bend`, `wire.mjs`, `wire.json` and `entry.bend` (about 12 ms).
  5. `bend entry.bend -o kernel.c`, then clang `-bundle`.
  6. **Smoke test in a child process**: `info()` hashes match, and one golden request per op gives the recorded reply.
  7. Atomic rename into the cache. A binary that fails its smoke test never becomes loadable.
  8. Keep the last 3 builds, so switching branches does not force a rebuild.
- **A stale binary never runs.** Every `openKernel({backend: 'native'})`:
  - reads `manifest.json`;
  - re-hashes the recorded closure and tools (the kernel sources alone take 2.4 ms, so about 3 to 5 ms in total;
    today's JS cache validation takes 436 ms);
  - compares the result with the manifest, then `info().sourceHash` with the manifest, and `WIRE_HASH` and
    `API_VERSION` with the generated `wire.mjs`.

  Any mismatch raises `NativeKernelStaleError`. A changed import set always changes some closure file, so the check
  is complete. A process loads at most one kernel addon.
- **Build time.** Planar-only addon: 12 s (bend 4.7 s + clang 7.2 s, 3.9 MB of C). The full production surface
  emitted 12 MB of C in 16 s. Its clang time is **unmeasured** (my estimate: 20 to 60 s). `--dev` builds at `-O1`
  under a separate key; FP semantics do not depend on `-O`, so the results stay bit-identical.

## 12. Dev-loop ergonomics

- **Editing Bend:** the JS target stays the default backend. No C toolchain is needed, and unit tests of Bend defs run
  there as today.
- **Running or benchmarking natively:** `--backend native`. After a kernel edit the loader reports exactly which
  files make the addon stale and prints the build command. `WONKY_NATIVE_BUILD=auto` rebuilds synchronously first,
  with progress on stderr, and never runs the stale binary.
- The first load of each new binary pays macOS's one-time check (287 ms). Later loads cost about 1 ms.
- **Checking a change on both backends:** `WONKY_BACKEND=diff node --test test/<file>`.
- **Flipping the CLI default to native** is Marc's decision, after the diff suite is green. After the flip, a fresh
  clone without a build gets a clear error, not a silent JS run.
- Independent of the binding, the JS reference could itself lose about 0.4 s per start by memoizing its compiler
  fingerprint (profile.md). That is outside this design.

## 13. Migration path (every step ships on its own)

| step | ships | changes | gate | bits vs today |
|---|---|---|---|---|
| **0 Groundwork** | `--backend` plumbing (default `js`), `backend` block in `brep.json`, `--help` without Bend (about 110 ms off), vendored headers, cache + stale check, `build-kernel.mjs` | bin/, index, python, exporters (lazy), src/native/ | full test suite on `js` | identical |
| **1 Native compat backend** | **the whole measured speedup (section 7)** on every workload except r10b | generated dispatcher for the 84 emittable production entries behind `kcall`; `loadKernel({backend:'native'})` returns a generated proxy with today's namespace shape (`exposedAs` from `surface.json`); `JsBackend` routes the same calls through the same codecs; curved intersection refuses loudly | model tests green on `native` and `diff` (the curved ones refuse as listed); build123d and FS cases measured end to end; `brep.json` and STEP byte-identical to `js` except `backend` | **identical** (the host round trip stays on both sides) |
| **2 `boolean` (PLANAR) + carriers** | exact planar chains (frame-with-tab: subtract then union) | `api.bend` v1 with `Body`, `op_boolean` for union/subtract incl. `classificationInput`, audit and measures; facade + carriers for its outputs; planar compat rows removed | diff green; the chain test proves verbatim carrier reuse; reviewed golden update for chained planar models | last bits of chained planar results |
| **3 constructors + `transform`** | exact bodies from the start; the pattern/translate chain exact | `extrudePolygon`, `frustum`, `transform` (measure carry-over by `Measures.rule` instead of `construction.method` strings) | same | chained transforms |
| **4 remaining `boolean` methods** | exact coaxial, pierce (axis, reach and radius from exact primitives) and convex; the halfspace -> solid-intersection decision moves into Bend | `op_boolean` methods; CURVED refuses natively until the arity fix | same | pierce/coaxial chains |
| **5 sketches** | `sketchLines`, `sketchArcs`, `extrudeProfile` with exact profile carriers | library skSolve/opExtrude | same | sketch-arc extrusions in chains |
| **6 export + compare** | `stepPcurves` from carriers, `compareCoaxial`, `printMesh` (with the bake-off's agreement) | exporters, comparison, print-mesh | STEP validated with `uv run scripts/validate-step.py` | pcurve words |
| **7 `importBrep`** | r10b import: 18,604 calls become about one per part; imported bodies get carriers | modules.mjs, analytic.mjs | r10b on `js` unchanged up to its known refusal; import golden diffed | imported chains |
| **8 `identify`, delete compat** | the narrow end state: 12 ops, compat table gone, `loadKernel()` internal to the JS reference; optional default flip | identity.mjs; generator drops the fine surface | lint: no `refeed` precision site left | identical |
| parallel, not binding work | r10b natively; threads 6 safe everywhere | curved path emittable (kernel refactor or upstream); cooperative CPU fail-stop; `madvise` in `reset` | | |

Steps 2 to 8 are justified by exactness and a smaller, cleaner surface, not by speed. If Marc only wants speed,
step 1 delivers it, and the rest can wait until `nativeChainExact` matters.

## 14. Risks, and where this angle is weak

1. **Statelessness re-marshals bodies on every op.** At today's sizes (at most about 30k words per request, the r10b
   curved intersection) that is at most 0.2 ms. A 1M-word body would cost about 13 ms per direction plus JS decoding
   *per op*. Handles would then win for cheap ops on huge bodies (transform, measure). Mitigation: carriers are
   opaque to all host code, so a handle can later replace a carrier inside the facade without API changes. The
   binding stage has already proven residency.
2. **No cross-op caches in the kernel.** Anything prepared (face contexts, BVH) must be recomputed per op or carried
   in the blob. The stalled prepared-solids work is intra-op, so it is not blocked.
3. **Moving host logic into Bend is real work** under Bend's constraints: no forward references, staged defs, match
   only on parameters, fuel for recursion. It is 1 to 2k lines. Bugs there are not caught by the diff (both backends
   run the same Bend), only by golden and model tests.
4. **Exact chains change outputs in the last bits** (revision hashes, possibly STEP digits). This is staged per op
   group with reviewed golden updates. It is a one-time cost, but real churn.
5. **r10b, the acceptance target, cannot run natively** until the curved path fits Bend's 255-word limit. The native
   backend refuses it loudly. Until then r10b gains nothing.
6. **A pool-worker fail-stop kills the process** when threads > 1. It is loud but loses context. The fix needs a
   runtime change (section 10).
7. **The compat step builds a wide surface** (84 entries, 121 ADTs, about 12 MB of C) that the design intends to
   delete. If narrowing stalls, the wide surface stays. It is fully generated and tested, so this is a maintenance
   risk, not a correctness risk. Its clang time and addon load time are unmeasured.
8. **The generated codecs are stricter than the JS target.** They reject non-F32 numbers where Bend expects `F32`
   (surface: `0.1` as F32 is refused). Latent host bugs of that kind now fail loudly on both backends. That is
   desired but may surface work.
9. **JS-target compile time of `api.bend` on a cold cache is unknown.** The generated full closure took 394 s. The
   generated codecs therefore stay out of the JS target: the reference uses JS codecs around direct def calls.
10. **Bend C backend quirks:** inlining and unboxing (mitigated by a single bound def) and a silent last-arm dispatch
    (range check plus an explicit bad-op arm). Upgrading beyond 2.0.25 requires re-running the binding test suite.
11. **FMA and NaN:** today's emission does not contract, and the flags pin that. NaN payloads are not canonical, so
    finite geometry is enforced.
12. **Toolchain:** Apple clang only (no npm, no node-gyp), vendored Node-API headers, the macOS first-load cost per
    new binary, a 2 GB RSS residue after a stack overflow.
13. **Identity payload:** up to about 190k words per call, one word per code point. Projected at about 2 ms per call
    in marshaling, which is not measured. Pack strings 4 bytes per word only if a measurement shows it matters.
14. **Threads gain** (1.5 to 1.65x) was measured under load 14 to 15. An older standalone run showed none. It is not
    a claim until re-measured.
15. **The speedups in section 7 are projections.** Only the component timings are measured. Nothing here is an
    end-to-end native run.

## 15. Decisions for Marc

1. Ship step 1 (compat, fine-grained) first to get the speed, then narrow for exactness? Or skip straight to the
   narrow ops at the cost of a longer path to the first speedup?
2. CLI default threads: 6 (fastest, a pool-worker fail-stop exits the process) or 1 (every failure catchable) until
   the runtime patch exists? And pursue that patch upstream?
3. Accept the one-time last-bit change of multi-operation models when chains become exact (steps 2 to 7)?
4. When to flip the CLI default from `js` to `native` (a missing or stale build then becomes an error)?
5. Who owns making the curved intersection emittable (kernel refactor vs an upstream Bend request)? Without it r10b
   stays on JS.
6. Identity: keep it as one word per code point for now, and pack only on evidence?

## Reproduce the projection

```sh
node scripts/native-bridge/proposal-projection.mjs            # table in section 7
node scripts/native-bridge/proposal-projection.mjs --json     # -> out/native-bridge/proposal-functional/projection.json
```

Inputs: `out/native-bridge/profile/summary.json`, `out/native-bridge/profile/runs.json`,
`out/native-bridge/binding/kernel-t1.json` and `kernel-t6.json`. The only typed constants are the assumptions L = 5 ms
and O = 1 to 5 ms per run (30 ms for r10b). Load average while writing this document: 10.9 to 15.0 (18 CPUs).
