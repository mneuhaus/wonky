# WK/0 real-model spike: prototype notes

Date: 2026-09-23 (Regression reviews 2 and 3 included). Apple M5 Pro (18 logical CPUs), macOS arm64, Node v22.23.1, Bend 2.0.25.
Task: [../language.md](../language.md) section 12. German report with the full discussion:
[spike-real-model.md](spike-real-model.md). §7 lists the eight defects of the first verification, §8 the six of the
second (Regression review 3) and how each was fixed.

**Measurement conditions.** The machine was shared, and in Regression review 3 heavily: the 1-minute load average was
**20 to 120** (build 14; workloads 20 to 35 on the final run, 58 to 124 on a first one; the repeated gate matrix 25 to
40; edits 30; chains 31 to 37; failures, regression and first errors 55 to 81; tests 27 to 33), against 15 to 24 in
Regression review 2. Every timing is **indicative**. Hashes, F32x2 words, node values, op sequences, JSON texts and error
spans are exact. Every number below is rendered from `out/lang/wk/real/*.json` by
`node scripts/lang/wk-real-report.mjs` (output `out/lang/wk/real/tables.md`), except where a row is marked as fix
round 2.

## 1. Outcome

| Claim | Result |
|---|---|
| 1. A WK/0 graph recorded by the unmodified FS interpreter from a real part runs natively with the production kernel, and its results equal today's JS path (geometry and identity) | **Confirmed as far as today's kernel can build the part, at the level of the whole model JSON, now without any tolerance.** washers (the one real part that builds today), frame-with-tab, 9 regression programs and the fixtures: the native model (bodies with identity, construction and `operationHistory`; the model's `operationEvidence`; the source map) is **byte-identical** to today's build. dual-hardware node by node against today's adapters: **104 of 104 body nodes byte-identical** (+ 10 count checks, 28 error nodes equal); mounting 26 of 26, direct-mount 28 of 28. Round 2's one difference (node 93, 2.27e-13 mm³, "flagged") and its stated tolerance are gone: the verifiers showed that tolerance did not bound the non-aligned and large-plate cases (up to 0.034 mm³); PIERCE now gets today's binary64 inputs from the host (§8). 100 of the verifiers' 105 round-3 cases give today's model or today's first error exactly; 2 are the same parse error on both paths; 3 are the specified loud gaps (§8.4) |
| 2. Whole-graph fork-join beats serial native execution of the same ops by at least 1.2x, cost-weighted | **Rejected on the gate workload:** washers gate ratio **0.82**, **0 of 10** repeated runs pass (0.55 to 1.01). Of the partial graphs of real multi-part parts only **dual-hardware passes robustly**, also in the staged form Regression review 3 needs (2 stages): **2.22**, 10 of 10 runs (1.63 to 2.35). mounting-r26 (2 stages) reaches 1.20 in the workloads matrix but 0 of 10 repeated runs (0.73 to 1.16); direct-mount-r26 0.80 and 0 of 10 (0.90 to 1.17). Where a pass holds it saves about 2 ms per build |
| Secondary: host cache after a real literal edit | **Confirmed.** 4 edits; every node and output equals a cold build of the edited file, identity included; where the part builds today, the whole model also equals today's build of the edited file byte for byte |

**Decision by the rule of language.md §11/§12: no `run_graph` now.** Unchanged by Regression reviews 2 and 3. Regression review 3 adds
a constraint on any future `run_graph`: a graph with PIERCE nodes is not one native call but one per PIERCE depth,
unless the kernel computes the PIERCE inputs itself (§6).

**Two blockers matter more than the execution form:**

- **Kernel capability.** None of the 4 named candidates and the control builds today; 1 of 30 checked features does
  (PIERCE admission, Booleans without a method, `opTransform`).
- **Today's identity and evidence labels grow about cubically with the length of a chain of dependent Booleans**
  (§4.9). A plate with 20 holes, one `opBoolean` each, can no longer be exported by today's build (V8 string limit);
  30 holes crash it (heap). The WK path reproduces the labels exactly while they fit and stops with an explicit
  capability error beyond. This is inherited from production (`kernel/identity.bend` nests instance ids,
  `src/construction-history.mjs` nests histories), not caused by the graph path.

## 2. What was built

All code lives in the language workflow's paths. Production code is only imported.

| File | Role |
|---|---|
| `src/lang/wk/record-fs.mjs` | Recorder (Regression review 3: replays a recording with known kernel failures, §2.1). `src/parser.mjs` and `src/interpreter.mjs` run unchanged; only the kernel-calling builtins (`opExtrude`, `opLoft`, `opBoolean`, `opPattern`, `ModelingContext.body`, `skSolve`, `evaluateQuery`) are swapped, as in `src/lang/dataflow/fs-trace.mjs`. Emits `extrude_polygon` on any plane, circle extrusion or circle loft as `frustum`, `transform`, `boolean{kind, method, components}` and `expect_count`. `annotateMethods` predicts the Boolean method with the predicates of `src/boolean.mjs` on symbolic body classes. Records `name` / `appearance` as production's body objects hold them when an op runs (`attrs.props`, output `props`) |
| `src/lang/wk/real-host.mjs` | Encoder (sealed stream, levels, constants as F32x2 words and exact binary64 thresholds, ±Infinity / NaN words, `real()` precheck, PIERCE host inputs `pierceInputs`), native process runner, strict output parser, body decoder to today's body JSON (incl. planar provenance and the complete PIERCE construction), identity + operation-evidence replay through today's entries (`release`, heap guard), precision contract, geom and full hashes |
| `src/lang/wk/real-run.mjs` | Glue: record, staged evaluation (`evaluateStages`), try replay (`evaluate`), materialize (host decode errors as node values), assemble, `assembleModel`, `modelJson`, whole-JSON comparison (`deepDiff`, `compareLists`, `compareModels`), `gateRatios`, cost weighting, first error incl. record-time errors (`firstErrorOverall`), host cache |
| `src/lang/wk/real-oracle.mjs` | Today's adapters applied node by node, errors as values: the reference for graphs today's build stops on |
| `kernel/lang/wk/real.bend` | Native node evaluator: strict stream decoding with a seal, the six ops (below), planar provenance in the output, exact binary64 comparisons (Regression review 3) |
| `kernel/lang/wk/main.bend` | Entry point. `fork`, `seq` and `serial` run real graphs; the session mode (one argument, the earlier spike's stream) is sealed and checked strictly since Regression review 3; a malformed stream exits 3, bad `reps` exits 2 |
| `kernel/lang/wk/now_us.c`, `now_us.js` | µs clock as a foreign effect (`IO.now` has ms resolution) |
| `kernel/lang/wk/cases/*.fs` | Fixtures: `curved-intersection`, `split-count` (loud failures); new: `pierce` (aligned and tilted holes), `planar-small` (planar subtraction + union), `query-reference` (`evaluateQuery` results as op arguments), `masked-error` (kernel failure before a record-time error), `far-pattern` (host errors around the kernel call); Regression review 3: `round3` (12 features from the verifiers' reproductions) |
| `scripts/lang/wk-real-select.mjs` | Step 0: selection with kernel-entry counting |
| `scripts/lang/wk-real.mjs` | Measurement driver; phases `workloads`, `edits`, `failures`, `partial`, `regression`, `gate`; the native matrix runs every stage file of a graph |
| `scripts/lang/wk-real-js.mjs` | Today's path as a child process, bucketed, with the SHA-256 of every op's argument snapshot |
| `scripts/lang/wk-chain.mjs` | Chains of dependent Booleans (plate with N holes), native vs today, child processes with a 4 GB heap |
| `scripts/lang/wk-real-build.mjs` | Evaluator build with wall time, peak RSS and load |
| `scripts/lang/wk-real-report.mjs` | Tables and `summary.json` |
| `test/lang-wk-real.test.mjs` | 24 focused tests (8 original, 11 for Regression review 2, 5 for Regression review 3) |

### 2.1 Recorder details

- **Speculation.** Every recorded Boolean assumes one result body. The node carries `components: 1`, which the
  evaluator checks; where the program observes a body count (`evaluateQuery` over speculative bodies), an
  `expect_count` node records the observed count at that FS span.
- **Kernel ops inside `try`** (Regression review 3) are recorded speculatively with `attrs.try = {mode, at}` (`rethrow` for
  Marc's decorate idiom `try { ... } catch (e) { throw ...; }`, `speculate` for every other form). When the first
  failing node of an evaluation is a catchable failure (code 2) inside a try, `evaluate` **replays** the recording:
  `recordFeatureScript(source, {failures})` maps the attempt number of that kernel call (every recording builtin
  call counts, also the ones that throw) to today's error object, and the recording builtin throws exactly that
  (`FeatureScriptError`, today's message, today's location: none for most adapters, the call location for polygon
  extrusions as `library.mjs` `body()` adds it, the opBoolean location for the Boolean adapters' own checks). The
  unchanged interpreter then runs the real handler: the decorate idiom rethrows today's decorated message at today's
  location, `try silent` continues, a fallback handler builds something else. Node values are reused by geom hash;
  the loop repeats until the first failure is not caught. A replay that does not reach the same call (op, id,
  location) is an internal error (`ReplayDivergence`), never a result. Not replayed: native residual-check failures,
  whose text is a summary rather than today's per-vertex message (they stay a located try-speculation error).
- **Graph breaks** stay explicit: a builtin that reads a symbolic body on the host (`evVolume`, `evBox3d`, owned
  entities) throws `GraphBreak` at its span. Line/arc sketch solving is a capability error. Whatever the production
  library lacks (`opTransform`, `skText`) fails exactly as in the production build.
- **What the recorder must not change** (Regression review 2). The engine is the `owner` of every `evaluateQuery`
  reference, and the source-map snapshot of an operation's arguments walks it into
  `identity.operation.parameters`. The `body` override is therefore non-enumerable, a handle's prototype
  `constructor` is `Object`, and the engine keeps one evidence entry per Boolean as a **count placeholder**
  (`{recorded: true}`) because the snapshot lists one truncated entry per element. The placeholders are never
  output: `assembleModel` returns the evidence the host replay built.

### 2.2 Native evaluator (`kernel/lang/wk/real.bend`)

| Op | Kernel functions (exactly those of today's adapters) |
|---|---|
| 1 `extrude_polygon` | `geometry.frame`, `geometry.lift_points`, `geometry.translate`, `topology.extrude` (F32 inputs, like `vector()`) |
| 2 `frustum` | `precise.frame/lift/add/sub/dot/normalize`, `analytic.frustum`, `frustum_bounds`, `frustum_volume_between`, plus the residual checks of `decodeAnalytic` |
| 3 `transform` | `topology.transform` (polyhedral) or `analytic.transform`, `point_transform`, the frustum measures, `boolean.rim_bounds` and `halfspace.bounds` for Boolean results |
| 4 `boolean` | COAXIAL: `boolean.coaxial`. PLANAR: `face-classification.linear_edge/max_budget`, `planar-boolean.union/subtract`, `curved.audit`, `solid-intersection.planar_measures`, plus the provenance (stats, face and edge origins, the audit, the input budgets and `real.max` of them). PIERCE: `pierce.pierce`, `bore_depth`, `pierced_volume` with the host inputs the node carries (below). CURVED, PLANAR_INTERSECT, NONE and unknown codes are capability errors |
| 5 `expect_count` | count check |
| 6 `literal` | a body list the host cache sends back unchanged (every word must be consumed) |

- **Method re-check.** The evaluator recomputes the host's method predicate on the real operands and refuses a
  mismatch; it never switches methods.
- **Host round trips.** Where today's host turns a kernel `Real` into a JS number and back (`decodeAnalytic`, then
  `real()`), `rt` emulates that binary64 round trip exactly in F32 arithmetic.
- **PIERCE and host binary64** (Regression review 3; round 2 emulated these in F32x2 and flagged them, which the verifiers
  showed to be off by up to 0.034 mm³). Today's adapter computes three inputs in binary64 on the host, from the
  decoded operands: the tool axis (`Math.hypot`, divisions), the tool's reach along it (the projections, then
  `real(min)`, `real(max)`) and the target volume `real(a.validation.volumeMm3)` (for a polyhedral target a
  `validateSolid` integral). The evaluator derives none of them. The host computes them with today's code
  (`real-host.mjs pierceInputs`) on the operand bodies decoded by today's decoders and sends the `real()` words with
  the node, plus a status in today's order: 1 `length === 0` (`Pierce tool has no length`), 2 a `real()`
  RangeError before the kernel call, 3 the volume's RangeError, which today raises only after the pierce and the
  decode (the host raises it there). The classification input and the admission stay native. A PIERCE node sent
  without host inputs is malformed. So a PIERCE node runs one **stage** after the operands it depends on (§2.3).
- **Exact binary64 comparisons** (Regression review 3). Where today's host compares `number(x)` (binary64) with a constant or
  with another number, the evaluator evaluates that comparison exactly instead of comparing F32x2 pairs: `v64`
  computes the binary64 value (an exact two-sum renormalization, then the `rt` round trip) and `sign_c` / `sign_v`
  the exact sign of the difference as a floating-point expansion grown by two-sums (Shewchuk). The constants travel as
  three F32 words that sum to the binary64 value exactly (`b64Words`). Used for the coaxial-normal check
  (`|dot| < 1 − 1e-6`), the height² floor (`<= 1e-10`), the Real residual tolerance (`> 0.0003`), planar interval
  and bound order and the planar volume sign; non-finite values compare like JS numbers (NaN never).
- **Errors are values** `VErr{code, span, message}`: 1 capability, 2 kernel failure, 3 speculation or expect,
  4 malformed node payload, 5 a `real()` RangeError (PIERCE status 2). Dependent nodes carry the input's error
  unchanged. Host-side: 5 for a `real()` RangeError (precheck, PIERCE status 3), and decode failures with
  production's code (2 for `FeatureScriptError`).
- **The stream** (Regression reviews 2 and 3). Decimal U32 tokens, whitespace-separated, nothing else. An F32 word is
  (s, m, e) = (−1)^s · m · 2^(e−200); e = 999 encodes ±Infinity (m = 0) and NaN (m = 1), the values the F32 contract
  (`Math.fround`) produces from binary64 input above the F32 range. Eleven constant reals lead the program. The first two tokens are a
  seal: the number of tokens after them and their sum mod 2^32. Every count must match its tokens, no token may be
  left over, the file must be read completely (`File.size`), and `reps` must be a number >= 1. Any violation
  rejects the program before evaluation (exit 3, reason on stderr, no node lines).
- **Modes.** `fork`: each level by fork-join over a pre-built balanced tree. `seq`: the same `run_levels` without
  fork (the serial baseline W). `serial`: like `seq`, every node timed with the µs clock.

### 2.3 Host side

- **Body JSON.** `bodyJson` reproduces the adapters' decode (`decodeSolid`, `decodeAnalytic`) and every field they
  set, including the PIERCE construction (`radiusMm` = the tool primitive's `r0`, `depthMm`, `admission`,
  `subdivision`) and the planar construction (`stats`, `ownership`, `subdivision`, `faceOrigins`, `edgeOrigins`,
  and for subtractions the contributor orientations) with `decodePlanarBoolean`'s reference checks.
- **Replay.** In record order: today's identity entries, then per Boolean the operation evidence
  (`operationEvidence` / `attachOperationEvidence`, each method in the order `booleanInBend` uses), then opBoolean's
  name / appearance copy, then the source-map tracker's metadata. The model-level `operationEvidence` and the
  source map's output identity summaries come out of the replay.
- **Errors around the kernel call.** A node whose F32x2 inputs fail `real()`'s precondition is not sent and carries
  today's RangeError; a body that today's decoders reject (`validateSolid`, analytic structure) becomes that node's
  error value. Dependents carry it.
- **Bounded host memory.** `release` drops a consumed intermediate body once its last consumer is replayed; identity
  memo keys are SHA-256 digests; a V8 limit in the replay or a heap in use above 0.6 of the V8 limit is an explicit
  capability error at the Boolean's FS span; so is an export beyond V8's string limit (`modelJson`).
- **Stages** (Regression review 3, `evaluateStages`). stage(n) = the largest stage of its evaluated operands, plus 1 if n is a
  PIERCE node or an operand has a non-finite F32 kernel input (`nonFiniteInputs`: such a body must reach today's
  decoder, which rejects it, before any other native op consumes it). Stage s sends its nodes, their operands from
  earlier stages or the cache as `literal` nodes, and each PIERCE node's host inputs; before it the host decodes
  everything evaluated so far (incremental `materialize`). A node whose operand failed is not sent and inherits the
  error. A graph without PIERCE nodes is one stage, as before; every measured part is one or two. Each stage is a
  native process here; with the in-process binding it would be a call. Per repetition the stage times add up.
- **Try replay** (Regression review 3, `evaluate`): §2.1.
- **First error location** (Regression review 3). An error today's build raises too carries today's location in
  `line` / `column` (none where today's adapter raises without one: `circularFrustumInBend`, the transforms,
  `decodeAnalytic`, `validateSolid`, `real()`; the call location for polygon extrusions; the opBoolean location for
  the Boolean adapters' own checks), and `at` always holds the op's FS span. Errors only the WK path raises
  (CURVED / PLANAR_INTERSECT not in the evaluator, method or count speculation, unknown op, malformed) stay at the
  span.

## 3. How to run

```sh
node scripts/lang/wk-real-select.mjs                    # step 0 (reads ~/Workspace/cad, read-only)
node scripts/lang/wk-real-build.mjs                     # one native compile, ~35 to 45 s, up to 11 GB
node scripts/lang/wk-real.mjs --n 3                     # all phases (~3.5 min at load 15 to 18)
node scripts/lang/wk-real.mjs --n 3 --phases partial    # one phase (workloads|edits|failures|partial|regression)
node scripts/lang/wk-real.mjs --n 3 --phases gate --runs 10   # the gate matrix repeated (~1 min)
node scripts/lang/wk-chain.mjs --sizes 5,10,15,20,25,30,45,60 --today 5,10,15,20,25,30   # chains (up to 8 GB RSS)
node scripts/lang/wk-real-report.mjs > out/lang/wk/real/tables.md
node --test test/lang-wk-real.test.mjs                  # 24 tests, ~35 s
node --test test/lang-wk.test.mjs                       # the earlier WK tests (8), session mode included
```

Regression review 3 was verified against production at git HEAD `12037b8` because another workflow edits the FS frontend in
the working tree since 06:15 (§8.3): `tmp/lang/r3/sync.sh` copies this workflow's code into `tmp/lang/r3/head`
(production `src/` from `git archive HEAD`, everything else linked); the commands above run the same there from
`tmp/lang/r3/head`.

A single graph can be run directly: `out/lang/wk/real/build/wk-real --threads 4 --gpu off -- fork 20 <file.wkr>`.
The output is `D <decode µs>`, `R <µs per rep>...`, in serial mode `T <node> <µs>`, then `N <node> <value>`.

## 4. Results

### 4.1 Step 0: selection

Data: `out/lang/wk/real/selection.json` (load 16 to 19, first version of this stage).

| Role | Feature | Bound | Today's JS path |
|---|---|---:|---|
| primary | dual-hardware-r25 `dualHardware25` | 21 | capability at 35:5 (PIERCE admission), after 17 ops |
| substitute 1 | interface-r11 `fasteners` | 15.5 | capability at 45:6 (no Boolean method), 17 ops |
| substitute 2 | hopper.fs `hybridHopper` | 10.7 | capability at 50:5 (PIERCE admission), 54 ops |
| substitute 3 | r21-expanded-hopper `expandedRearHopper21` | 8.5 | capability at 50:5 (PIERCE admission), 214 ops |
| control | central-drive-r27 `centralShafts26` | 2 | capability at 283:1 (`opTransform`), 0 ops |

No named candidate builds, so the rule falls through to the 25 other corpus features whose graph uses only the spike
op set. Exactly one builds: **`top-clamp-washers-r29.fs` `topClampWashersR29`** (4 COAXIAL subtractions, bound 4),
the gate workload. dual-hardware, mounting-r26 and direct-mount-r26 are measured as partial graphs against the
oracle.

### 4.2 Fidelity and correctness

Comparison level (Regression review 2): the **complete body JSON** of every node (every field, numbers with `Object.is`, key
sets), and byte-identical JSON (key order) reported separately; for the outputs the whole exported model (bodies,
`operationEvidence`, source map). The fidelity check compares op id, name, span and the SHA-256 of every op's
argument snapshot (it becomes `identity.operation.parameters`). Regression review 3, against production at git HEAD; these
are exact results, the load (20 to 120) only affects the timings.

| Workload | Nodes | Heavy / span | Op-count bound | Methods | Record ms | Op sequence (recorded / today, equal prefix) | Oracle: body nodes byte-identical / error nodes equal | Differences | Stages (PIERCE) | Model vs today |
|---|---:|---:|---:|---|---:|---|---|---|---|---|
| washers | 12 | 4 / 1 | 4 | COAXIAL 4 | 4.3 | 76 / 76, 76 (full) | 12 / 0 of 12 | none | 1 | 4 of 4 bodies, evidence, source map: byte-identical |
| dual-hardware | 142 | 42 / 2 | 21 | COAXIAL 16, PIERCE 15, NONE 11 | 16.6 | 544 / 17, 17 (prefix) | **104 of 104** (+ 10 count checks) / 28 | **none** (node 93 differed by −2.27e-13 mm³ before Regression review 3) | 2 (0 + 15) | no model today |
| mounting-r26 | 30 | 10 / 2 | 5 | COAXIAL 6, NONE 2, PIERCE 2 | 3.4 | 116 / 17, 17 (prefix) | 26 (+ 2 checks) / 2 of 30 | none | 2 (0 + 2) | no model today |
| direct-mount-r26 | 36 | 12 / 2 | 6 | COAXIAL 8, NONE 4 | 2.8 | 128 / 17, 17 (prefix) | 28 (+ 4 checks) / 4 of 36 | none | 1 | no model today |
| frame-with-tab | 5 | 2 / 2 | 1 | PLANAR 2 | 0.4 | 5 / 5, 5 (full) | 5 / 0 of 5 | none | 1 | byte-identical |

- **PIERCE** (Regression review 3). Every PIERCE node gets today's binary64 inputs from the host, so its result is exact by
  construction; there is no tolerance and no flag any more. All 9 successful PIERCE nodes of dual-hardware and both
  of mounting (construction, `operationHistory`, volume) are byte-identical to today's adapter. The verifiers'
  cases that differed before (10 non-aligned tools in tilted plates, 24 tilted plates up to 165 mm, aligned tools in
  300 mm plates) now give today's whole model byte for byte (§8.4).
- **Fixtures** (tests, whole model byte-identical to today's build): `pierce.fs` aligned holes (a chain of three,
  4 stages) and a hole along (0, 0.6, 0.8) in a tilted plate; `round3.fs` `tiltedHole`, `bigTiltedPlate`,
  `bigPlate`, `trySilentHuge`, `fallback`; `planar-small.fs`; `query-reference.fs`; a plate with 5 chained holes.
  The regression suite: 9 programs byte-identical, the two intersection examples fail loudly with PLANAR_INTERSECT at
  the opBoolean span, line-sketch stops loudly in the recorder at `skSolve`.
- **Determinism.** Node outputs are identical over `fork` / `seq` / `serial`, 1 / 2 / 4 threads, 3 processes each
  and 1 to 50 reps: 22 runs per workload (every stage), compared as SHA-256 over all `N` lines.

### 4.3 First error (Regression reviews 2 and 3)

The partial graph is evaluated even when the recorder stops; its first native error precedes the recorder's stop.
Over all 30 step-0 candidates (`out/lang/wk/real/partial.json`, Regression review 3): **30 of 30 report today's first error**
(line, column and message). 14 of them would have reported the recorder's later stop instead (e.g. interface-r11:
recorder stops at 53:2 `opTransform`, first error 45:6 no Boolean method, as today). Host errors around the kernel
call (`far-pattern.fs`: `validateSolid`'s coordinate envelope; `real()`'s magnitude) carry today's message and,
since Regression review 3, today's location (none: today raises them without one), with the op span in `at`. A kernel
failure inside `try` is replayed (§2.1): Marc's decorate idiom now reports today's decorated message at today's
location (`round3.fs` `decorated`: 42:75 `decorated: the loft failed`; `decoratedMessage`:
`R4 build: Circular loft/extrusion has zero or unresolved height`).

### 4.4 Speed gate

Warm evaluation in ms (median of reps 2..R in a process, median over 3 processes; for a staged graph the sum of its
stages). Regression review 3, load 20 to 35.

| Workload | Stages | Reps | seq@1 | seq@2 | seq@4 | fork@1 | fork@2 | fork@4 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| washers | 1 | 50 | 0.206 | 0.211 | 0.207 | 0.213 | 0.255 | 0.242 |
| dual-hardware | 2 | 20 | 4.078 | 4.791 | 4.851 | 4.194 | 2.780 | 1.802 |
| mounting-r26 | 2 | 20 | 0.872 | 1.468 | 1.350 | 0.879 | 0.784 | 0.725 |
| direct-mount-r26 | 1 | 20 | 0.545 | 0.862 | 0.898 | 0.549 | 0.596 | 0.609 |
| frame-with-tab | 1 | 1 | 4051 | 3235 | 2668 | 4953 | 6784 | 5863 |

frame-with-tab ran during a load burst (round 2 at load 15: 1582 / 1048 ms for seq@1 / fork@4); a chain with cost
bound 1, it cannot gain from fork in either case.

**Gate** (Regression review 2, defect 3). Per configuration two statistics of the warm reps: the median over processes of the
per-process median, and the mean over every warm rep. For each, W_best = the best serial time over 1 / 2 / 4 threads,
T4 = fork@4. **The gate ratio is the smaller of the two W_best / T4** (`gateRatios`). A pass must also hold in every
one of 10 repeated runs of the whole matrix (`--phases gate`, load 25 to 40).

| Workload | W_best/T4 median | W_best/T4 mean | **gate ratio** | repeated runs passing (min – max) | robust | cost-weighted bound | op-count bound | serial work |
|---|---:|---:|---:|---|---|---:|---:|---:|
| **washers (gate)** | 0.85 | 0.82 | **0.82** | 0 of 10 (0.55 – 1.01) | reject | 4.91 | 4.00 | 0.21 ms |
| dual-hardware (partial, 2 stages) | 2.26 | 2.22 | **2.22** | 10 of 10 (1.63 – 2.35) | **yes** | 15.95 | 21.00 | 4.02 ms |
| mounting-r26 (partial, 2 stages) | 1.20 | 1.21 | **1.20** | 0 of 10 (0.73 – 1.16) | no | 3.60 | 5.00 | 0.86 ms |
| direct-mount-r26 (partial) | 0.89 | 0.80 | **0.80** | 0 of 10 (0.90 – 1.17) | no | 7.47 | 6.00 | 0.56 ms |
| frame-with-tab (chain) | 0.45 | 0.48 | **0.45** | – | reject | 1.00 | 1.00 | 4312 ms |

- **The decision does not change.** Round 2 at load 15 to 18: washers 0.90 (0 of 10), dual-hardware 2.51 (10 of 10),
  mounting 1.28 (8 of 10), direct-mount 1.28 (7 of 10). Only dual-hardware's partial graph passes robustly, in both
  rounds and in the verifiers' run.
- **Staging costs little here.** dual-hardware's 15 PIERCE nodes are its heaviest (158 µs each) and depend on no
  other PIERCE, so they form one fork-join stage of 15 independent nodes; the stage boundary costs a second process
  (and, with a binding, a second call) and the host decode of the operands (4.3 ms), not parallelism. mounting's
  second stage has only 2 PIERCE nodes, which is part of why it no longer passes even occasionally.

**Per-node cost** (timed serial mode, 1 thread): `frustum` 10 to 11 µs, `extrude_polygon` 2 to 16 µs, COAXIAL 31 to
52 µs, PIERCE 158 to 227 µs, NONE (immediate capability error) 0.5 to 1.5 µs, `expect_count` < 1 µs, PLANAR
(frame-with-tab) 0.8 s at load 15 (2.2 s in this run's load burst).

- **Cost-weighted vs op-count bound:** within a factor 0.7 to 1.25, so the "factor > 2" trigger of language.md §11
  does not fire. The achieved speedup stays far below both (2.2 against 16 at 4 threads): nodes of 10 to 250 µs are
  dominated by the cost of handing work to pool workers.
- **Op-at-a-time native** (`WONKY_BACKEND=native`): not available in this round (the binding's build for the set
  `planar` was absent, `BX_LOAD`); round 2: it refused all four cylinder parts (`BX_UNAVAILABLE` for
  `kernel/precise.bend:frame`) and built frame-with-tab in 1664 ms at 1 thread.

### 4.5 Buckets

Median over 3 processes, in ms. Regression review 3, load 20 to 35 (frame-with-tab in a load burst; round 2 in brackets).

| | washers | dual-hardware | frame-with-tab |
|---|---:|---:|---:|
| **today:** process | 968 | 896 (stops) | 23458 (13996) |
| kernel load (JS target) | 830 | 792 | 1179 |
| build cold / warm | 31.0 / 14.0 | 25.5 (to op 17) | 22168 (13143) |
| of which kernel entries (counted run) | 19.7 | 12.2 | (12912) |
| export | 1.1 | – | 6.4 |
| **native graph:** record | 4.3 | 16.6 | 0.4 |
| encode | 0.9 | 6.4 | 0.6 |
| stages (native processes) | 1 | 2 | 1 |
| host decode between stages | – | 4.3 | – |
| evaluation fork@4 (warm, one rep, all stages) | 0.24 | 1.80 | 5863 (1042) |
| stream decode in Bend | 0.05 | 0.97 | 0.06 |
| process start + text output in Bend | 6.6 | 29.1 | 39.7 |
| parse / body decode (host) | 1.4 / 1.4 | 21.8 / 2.9 | 16.6 / 4.9 |
| identity + evidence cold / memoized | 9.3 / 0.9 | 40.9 / 11.1 | 39.4 / 13.4 |
| export (model JSON) | 1.7 | 13.6 | 10.0 |

- **washers:** 0.24 ms native against 20 ms of JS-target kernel entries; without kernel load the native graph path
  costs about 25 ms, level with today's warm build plus kernel entries.
- **dual-hardware:** identity + evidence replay (41 ms), Bend process start and text output of the two stages
  (29 ms) and output parsing (22 ms) cost many times the kernel work (4 ms). The second stage adds a process start,
  the literal operands (encode 6.4 ms, stream decode 1 ms) and 4.3 ms of host decoding.
- **frame-with-tab:** only the kernel matters (round 2: 13.1 s today against 1.04 s natively).

### 4.6 Incremental edits with the host cache

Cache key: geom hash (op, contract-rounded arguments and input hashes, no ids); value: the raw native words. Dirty
nodes are evaluated, clean inputs of dirty nodes travel as `literal` nodes, other clean nodes are not sent. Errors
are never cached (their span id can go stale). Identity and evidence are replayed for every node; identity-entry
calls are memoized by the SHA-256 of their arguments (ids included). The incremental run passes every clean node's
value as `known` (`planIncremental(...).known`), so the PIERCE stage can decode clean operands. fork@4, n = 3, fix
round 3, load 30 (a second sample during a load burst gave 5.7 against 5.8 ms for dual-hardware:
`tmp/lang/r3/edits-0654.json`).

| Edit (line:column) | changed (heavy) | re-evaluated / all | literals | incremental eval, warm (first rep) | cold-graph eval, warm (first rep) | process inc. / cold | identity calls inc. / cold | equal to cold | today's build of the edited file |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| dual-hardware 88:116 `27.357265589908167` → `28.7251288694` | 2 (1) | 30 / 142 | 35 | 1.21 ms (3.18) | 2.89 ms (4.66) | 57 / 110 ms | 2 / 104 | 142/142, yes | capability (as unedited) |
| washers 70:89 `.6` → `0.63` (colour) | 0 (0) | 0 / 12 | 0 | 0 | 0.35 ms (0.79) | 0 / 30 ms | 0 / 12 | 12/12, yes | whole model byte-identical |
| washers 49:40 `0` → `0.5` (circle centre) | 12 (4) | 12 / 12 | 0 | 0.29 ms (0.65) | 0.28 ms (0.66) | 25 / 25 ms | 12 / 12 | 12/12, yes | whole model byte-identical |
| frame-with-tab 14:59 `48` → `47` (tab) | 2 (1) | 2 / 5 | 1 | 1689 ms | 2607 ms | 1709 / 2627 ms | 3 / 8 | 5/5, yes | whole model byte-identical |

### 4.7 Loud failures

| Case | Kind | FS span | Message |
|---|---|---|---|
| CURVED method (box ∩ cylinder; today builds it) | capability | curved-intersection.fs:19:9 | Boolean method CURVED (native Bend curved convex-tool intersection) is not in the WK native evaluator |
| split into two bodies (today returns 2) | speculation | split-count.fs:15:9 | count speculation failed: this Boolean produced 2 bodies, the recorded program assumed 1 |
| unknown op (a washers `frustum` renamed, op code 99) | capability | top-clamp-washers-r29.fs:50:2 | WK op code 99 is not in the native evaluator (only that washer fails) |
| deliberately wrong count speculation (dual-hardware) | speculation | dual-hardware-r25.fs:42:14 | count speculation failed: the program observed 2 bodies here; the graph produced 1 |
| malformed streams (Regression review 2): cut, altered digit, depth ± 1, trailing tokens, non-numeric or oversized token, empty | stream | – | exit 3 before evaluation, e.g. "the seal does not match (token count or checksum)", "tokens are left over after the last level" |
| missing / repeated / foreign output lines | host | – | `MalformedNativeOutput` (never "no error") |
| session mode (Regression review 3): the verifier's real-mode stream, cut, level or point count 2^32 − 1 (resealed), trailing token, unsealed | stream | – | exit 3 in milliseconds, empty stdout, e.g. "a graph, level, node or output count does not match the tokens ..." |
| a PIERCE node sent without its host inputs | host | – | the encoder refuses ("needs its host inputs"); the evaluator would answer "malformed boolean node" |
| a replay that does not reach the same kernel call | host | – | `ReplayDivergence`, thrown out of the recording |
| a native residual failure inside a try (not replayed: its text is not today's) | try-speculation | the op span | the native message with the note "not replayed" |

### 4.8 Regression

- frame-with-tab from both frontends: recorder graph, old stager graph and build123d graph identical after
  `canonicalize` (output hash `f55dec6f28652498`); the earlier native evaluator (the binary's session mode, now
  sealed and strict) gives hash **3141504600** on the recorder graph (volume words 1180188672/739621607, 64 faces).
  Regression review 3 re-ran this: identical (`out/lang/wk/real/regression.json`), after `stage-py.mjs` learnt the runner's
  new result shape (§8.2).
- WK check suite (12 programs, `out/lang/wk/real/regression.json`): op sequences equal for 11; the whole model
  byte-identical to `build()` for 9; the two intersection examples fail loudly with PLANAR_INTERSECT at the
  opBoolean span; line-sketch stops loudly in the recorder at `skSolve`.

### 4.9 Chains of dependent Booleans (Regression review 2, defect 8)

`scripts/lang/wk-chain.mjs`: a 300 x 300 mm plate with N holes, each a separate `opBoolean` on the plate (the idiom
of Marc's plates), N PIERCE nodes in one chain. Child processes with a 4 GB heap.

**Regression review 3 (staged, load 31 to 37).** Every PIERCE of the chain is its own stage: N + 1 native processes.

| N | stages | native eval ms (sum of stages) | native processes ms (all stages, incl. host work between) | host decode between stages ms | identity replay ms | model JSON MB | native path | today's build |
|---:|---:|---:|---:|---:|---:|---:|---|---|
| 5 | 6 | 9.8 | 81 | 4 | 54 | 6.3 | ok (whole model byte-identical: test "fix 2.8") | ok, 6.3 MB |
| 10 | 11 | 12.3 | 180 | 7 | 279 | 62.7 | ok | ok, 62.7 MB |
| 15 | 16 | 37.5 | 310 | 9 | 953 | 296 | ok | not run |
| 30 | 31 | 127.6 | 629 | 16 | – | – | the same explicit capability error at `model/b25` (heap above 0.6 of the limit) | not run |

A stage costs a process start (about 15 to 30 ms here, the eval column is the in-process part); with the binding it
would be a call. The labels, not the stages, remain the limit.

**Regression review 2 (single stage, emulated PIERCE inputs; load 21 to 24):**

| N | native eval ms | identity MB | operationHistory MB | model JSON MB | identity replay ms (native) | native path | today's build |
|---:|---:|---:|---:|---:|---:|---|---|
| 5 | 1.4 | 1.2 | 1.7 | 6.3 | 31 | ok, whole model byte-identical (test) | ok |
| 10 | 5.5 | 5.3 | 14.4 | 62.6 | 122 | ok | ok |
| 15 | 11.7 | 14.2 | 56.5 | 295 | 416 | ok | ok |
| 20 | 25.3 | 29.7 | 155 | > 512 (V8 string limit) | 1266 | explicit capability error at export | RangeError at export |
| 25 | 39.7 | 53.6 | 348 | > 512 | 3444 | explicit capability error at export | RangeError at export |
| 30 | 66.1 | – | – | – | – | explicit capability error at node %52 (`model/b25`, opBoolean span): heap above 0.6 of the limit | **crash**: V8 heap out of memory (7.9 GB peak RSS) |
| 45 / 60 | 192 / 442 | – | – | – | – | the same explicit error at `model/b25` | not run |

- Sizes are identical on both paths; the growth is roughly N³ (model 6 → 63 → 295 MB for N = 5 → 10 → 15).
- **Cause, inherited from production:** every topology entry of a Boolean result carries an instance id that nests
  its parents' instance ids (82 KB per face entry at N = 12), and `operationHistory` clones the inputs' identity and
  history into each evidence (`evidence.inputs[0].history` holds 20 of 26 MB at N = 12).
- The native evaluation itself is not the limit: 442 ms for 60 holes (one process, fork@1), growing about
  quadratically because each hole is bored into a target with more faces.
- The first version's "identity 44 ms is the next bottleneck" understated this: for long chains identity and
  evidence are not a cost to shave but a representation that must change (content-addressed references instead of
  nested copies) before hole-heavy plates can be modeled at all, on either path.

### 4.10 Build cost

| Build | Step | Wall | Peak RSS | Load before → after |
|---|---|---:|---:|---|
| first version | bend → C | 25.0 s | 11.04 GB | 58 → 49 |
| | clang -O3 | 22.8 s | 1.49 GB | 49 → 43 |
| Regression review 2 (strict decoding, provenance, exact axis) | bend → C | 22.4 s | 11.44 GB | 17 → 23 |
| | clang -O3 | 21.8 s | 1.48 GB | 23 → 24 |
| Regression review 2 (plus the seal) | bend → C | 16.1 s | 6.50 GB | 16 → 16 |
| | clang -O3 | 17.2 s | 1.48 GB | 16 → 15 |

| Regression review 3 (exact comparisons, PIERCE host inputs, ±Infinity/NaN words, strict session mode) | bend → C | 18.5 s | 12.72 GB | 13.7 → 13.9 |
| | clang -O3 | 19.1 s | 1.62 GB | 13.9 → 14.2 |

C source 9.7 MB, binary 3.25 MB (sha256 prefix `c20b656050a32d8d`); `bend --check-only` 1.5 s. Every evaluator
change costs 35 to 60 s and up to 13 GB (the evaluator links the curved, pierce, halfspace and planar-boolean
modules). `out/lang/wk/build/wk-native` is a copy of this binary (§8.1, defect 5).

## 5. Gaps

- **Only one real part builds end to end today**, and it is small. The multi-part evidence comes from partial graphs
  whose remaining nodes fail loudly today.
- **Host binary64 in PIERCE** is no longer emulated (Regression review 3): the host computes it with today's code between
  two native stages. The price is a stage boundary at every PIERCE node: one extra native process per PIERCE depth
  here (an extra call with the binding), and PIERCE nodes cannot share a fork-join level with their operands. A soft
  binary64 in Bend would remove the boundary; it is out of scope.
- **`real()` between native ops:** the precondition (|x| <= 1e20, no F32 underflow) is applied to host inputs;
  kernel values between two native ops are not re-checked, where today's host would re-encode them.
- **Long Boolean chains** (§4.9): beyond about 15 to 20 dependent Booleans neither path can represent today's
  labels; the WK path stops explicitly, today's build fails at export or crashes.
- **Not in the evaluator** (loud capability errors): CURVED, PLANAR_INTERSECT, sketch profiles, lofts other than
  circle frusta, imports, regions (`select`, `map`, `fold`, `when`).
- **No replay after a failed count speculation** (a Boolean that splits, an `evaluateQuery` count): an explicit
  speculation error. Try speculation is replayed (Regression review 3), except for native residual-check failures, whose
  message is not today's per-vertex text (an explicit, located try-speculation error).
- **Error order inside one analytic decode:** today's `validateAnalytic` interleaves structural checks (host here)
  with residual checks (native here). A body failing both would report the other one first; never observed.
- **Identity** runs on the JS target, as today, not natively.
- **Heap guard:** it compares the heap in use (garbage included) with 0.6 of the V8 limit, so it may stop somewhat
  earlier than strictly necessary; it never lets a result through that it could not build.
- **Timing noise.** Sub-millisecond timings are noisy; hence the two statistics and the repeated runs.
- **Not measured:** more than 4 threads, GPU.
- **Production is a moving target.** The recorder mirrors the kernel-calling builtins of `src/library.mjs` /
  `src/queries.mjs`; the concurrent FS-frontend work (§8.3) changes those files. Checked against git HEAD and, at
  06:38, against the working tree (both 24 of 24 tests); later changes there need the mirror to follow.

## 6. Consequences for the plan (details in the German report, §12)

1. **Keep `run_graph` gated.** Re-evaluate when a real part builds natively with at least 100 ms of kernel work
   spread over independent components (several planar arrangement Booleans in separate bodies). Only dual-hardware's
   partial graph passes robustly today, worth about 2 ms per build.
2. **Kernel capability first for Marc's cylinder parts:** PIERCE admission for non-prismatic targets, the NONE
   cases, `opTransform`, then `skText` and line/arc sketches.
3. **Identity and evidence need a content-addressed representation** before long Boolean chains (plates with many
   holes) are modeled on any path: hashed instance ids and evidence that references its inputs by revision instead of
   nesting their identity and history. This is a production change outside this workflow.
4. **The binding needs the frustum/coaxial/pierce entries** (bridge steps 3/4). The pierce entry takes today's
   host-computed inputs (axis, reach, target volume); today's op-at-a-time path already has them. A future
   `run_graph` over PIERCE nodes needs either a host callback between stages or the kernel computing those inputs
   (the target volume as a kernel measure on today's path too, the axis from primitive words); both change what
   today's adapter computes, so both are production decisions (Regression review 3).
5. **The host cache works without a Bend change;** errors stay out of it.
6. **For the binding:** sequential Bend code slows down with 2 or 4 threads on small calls, and text output costs more
   than evaluation, so entries must return words; a sealed, strictly checked transport is cheap (the seal adds two
   tokens).
7. **Every host comparison is part of the semantics.** The threshold defect (Regression review 3) came from a binary64
   comparison emulated in F32x2. A native core has to evaluate the host's comparisons exactly (as `sign_c` /
   `sign_v` do) or move them into the kernel on today's path as well.

## 7. Regression review 2: the verified defects

Independent verifiers reproduced eight defects in the first version of this stage. Each is fixed at its cause in the
language workflow's own paths and has a regression test in `test/lang-wk-real.test.mjs` (tests named "fix 2.x";
all 19 tests pass, 19.3 s at load 12 to 15; the identity-leak test was checked to fail on the old recorder).
Production code is unchanged.

| # | Defect (verifier) | Root cause | Fix | Regression test |
|---|---|---|---|---|
| 1 | PIERCE bodies differ beyond node 93: `construction.depthMm` on 5 of 9, `radiusMm` / `admission` / `subdivision` missing; `compareLists` ignored `construction`, so "8 of 9 bit for bit" was overstated | (a) the comparison hashed B-rep fields only; (b) the host decoder did not publish the adapter's construction fields; (c) the evaluator normalised the pierce axis in F32x2 (`R.sqrt`, `R.div`) where the adapter uses binary64 `Math.hypot` | (a) `compareLists` / `compareModels` diff the **complete** body JSON and report byte-identical JSON separately; (b) the PIERCE construction is published exactly as `src/boolean.mjs` builds it; (c) the axis of an axis-aligned tool is reproduced bit for bit (`exact_axis`); other axes and polyhedral target volumes stay F32x2 and are **flagged** (`axisExact`, `volumeExact`). *Superseded in Regression review 3 (§8): the flagged emulation was not bounded by the stated tolerance; the host now supplies those inputs* | "fix 2.1 comparison ...", "fix 2.1 PIERCE ...", "fix 2.1 dual-hardware ..." |
| 2, 5 | `operationHistory` missing on every Boolean result and on transforms of them; PLANAR provenance (`stats`, `ownership`, `subdivision`, `faceOrigins`, `edgeOrigins`) missing; placeholder `operationEvidence` entries undisclosed | the host replay produced identity only; the evaluator returned no planar provenance | the evaluator returns planar provenance as words (`pu`) and the full audit and input budgets (`extra`); the host rebuilds today's objects with `decodePlanarBoolean`'s checks; the replay calls today's `operationEvidence` / `attachOperationEvidence` in each method's order; `assembleModel` returns the model's `operationEvidence` and the source map. The placeholders are documented (§2.1): count mirrors, never output | "fix 2.2 planar Booleans ...", the washers whole-model test |
| 3 | Partial-graph gate passes (mounting 1.24, direct-mount 1.37) were median-based and did not reproduce | the statistic ignored the heavy tail of fork@4 | `gateRatios`: the smaller of the median and mean ratios; `--phases gate` repeats the matrix; a robust pass must hold in every run | "fix 2.3 gate ..." |
| 4 | Identity labels differ for any op whose argument is an `evaluateQuery` result | `engine.body = function ...` was an own enumerable property of the context, the `owner` of every reference query, walked by the source-map snapshot | non-enumerable override; handle prototype `constructor` = `Object`; the fidelity check compares a SHA-256 of every op's argument snapshot | "fix 2.4 identity ..." (fails with the old recorder) |
| 6 | Record-time capability errors masked an earlier kernel error (14 of 30 candidates) | only complete graphs were evaluated | the partial graph is always evaluated; `firstErrorOverall` puts its native errors before the recorder's stop | "fix 2.6 first error ..." (fixture and two real parts); `--phases partial`: 30 of 30 |
| 7 | Malformed or inconsistent streams partially decoded without error; missing node lines read as "no error" | the decoder dropped undecodable nodes, ignored leftover tokens and skipped non-digits; `reps` defaulted silently; the host never checked which lines came back | Bend: strict tokenizer, seal (count + checksum), every count checked, no leftover, complete read via `File.size`, `reps` >= 1, exit 3 before evaluation. Host: strict `parseOutput`; `nodeValues` requires exactly the sent nodes; `mergeRaw` every dirty node | "fix 2.7 malformed streams ..." |
| 8 | Long chains of dependent Booleans crash the host identity replay (OOM at about 45 to 50) | inherited label growth (§4.9); in addition the host kept every intermediate body and keyed the memo by full argument JSON | `release`; SHA-256 memo keys; V8 limits and a heap above 0.6 of the limit become an explicit capability error at the Boolean's span; `modelJson` does the same for exports; growth measured and documented | "fix 2.8 Boolean chains ..." |

**Also found and fixed by a broader check** (51 of the 58 verifier break cases through the whole-model comparison, the
7 large chain and corpus copies skipped;
`tmp/lang/wk/fix2/cases.mjs`; the remaining differences are the specified loud failures: graph breaks, count and
try speculation):

- **Host errors around the kernel call.** Today's adapters reject some results on the host (`validateSolid`:
  coordinate envelope, collapsed edges; analytic structure) and some inputs before the kernel runs (`real()`).
  The WK path reported a different error or none. Now the same error, at the op's span (test "fix 2.6 host
  errors ...").
- **Error origin with a shared call span.** The origin was found by span; a helper called inside and outside a
  `try` shares one span, so a failure inside `try silent` was reported as a plain failure. The origin is now the
  failing node itself (same test).
- **name / appearance at the time an operation ran.** `setProperty` writes into the body object in place; a Boolean
  result or a pattern copy copies it when it runs. The recorder records these properties (`attrs.props`, output
  `props` in insertion order), so replay and oracle copy exactly what production held, and the key order matches
  (pattern copies of named washers were deep-equal but not byte-identical before).

## 8. Regression review 3: the verified defects

A second independent verification found six defects in the round-2 version. Each is fixed at its cause in the
language workflow's own paths and has a regression test in `test/lang-wk-real.test.mjs` (tests "fix 3.x"; fixtures
`kernel/lang/wk/cases/round3.fs`, 12 features taken from the verifiers' reproductions). Production code is unchanged.

### 8.1 The defects

| # | Defect (verifier, severity) | Root cause | Fix | Regression test |
|---|---|---|---|---|
| 1 | Non-aligned PIERCE into a tilted polyhedral plate: `validation.volumeMm3` off by up to 3.5e-5 mm³ (7 of 10 fuzz cases), far outside the stated 2.3e-13; the exactness flags lived only in a host WeakMap (medium) | the evaluator emulated inputs that today's adapter computes in host binary64 (tool axis and reach: `Math.hypot`, divisions; target volume: `validateSolid`) in F32x2, and a stated tolerance covered it | no emulation: `pierceInputs` runs today's code on the operands decoded by today's decoders and the node carries the `real()` words; a PIERCE node runs one stage after its operands (`evaluateStages`); flags and tolerance removed, the result is exact by construction | "fix 3.1 / 3.3 PIERCE" (`tiltedHole` = verifier case 1, `bigTiltedPlate`, `bigPlate`), "fix 2.1 / 3.3 dual-hardware" |
| 3 | PIERCE into polyhedral targets: up to 0.034 mm³ with no error (23 of 23 tilted plates; axis-aligned big plates 7.5e-9) (high) | the same: `planar_measures` in F32x2 on the lifted polyhedron instead of today's binary64 tetra sum | the same (the target volume is today's `real(a.validation.volumeMm3)`) | the same; dual-hardware node 93 (−2.27e-13 before) is now byte-identical |
| 2 | Loft/extrusion axis check: the WK path built a tilted loft that today refuses (`|dot|` equal to the F32x2 rounding of 1 − 1e-6) (high) | today compares `Math.abs(number(dot)) < 1 - 1e-6` in binary64; the evaluator compared F32x2 pairs against the F32x2 rounding of the constant, 1.1e-16 below it | every host comparison of `number(x)` with a constant or another number is evaluated exactly (`v64`, `sign_c`, `sign_v`: two-sum renormalization, the `rt` round trip, the exact sign of an F32 expansion); the constants travel as three exact F32 words (`b64Words`); applied to the normal check, the height² floor, the Real residual tolerance, planar intervals, bounds and volume sign | "fix 3.2 thresholds" (`axisThreshold` = verifier `axis-threshold-y5`) |
| 4 | Inputs above the F32 range in F32-contract nodes crash the host encoder with a raw RangeError: no location, the whole graph aborts, `try silent` ignored (medium) | `Math.fround` of such a value is ±Infinity, which the stream word format could not express; the precheck covered only F32x2 | the stream carries ±Infinity and NaN (e = 999); the kernel computes with them as the JS target does and today's decoder rejects the body with today's message; a node with a non-finite F32 input is a stage boundary, so no other native op consumes its body; `try silent` works through the replay (defect 6) | "fix 3.4" (`hugeDepth`, `hugeOffset`, `hugeConsumed`, `trySilentHuge`) |
| 5 | The binary's one-argument session mode ran away on a malformed file: 33 GB RSS in 30 s (high) | the earlier spike's lenient decoder used a token (the seal's checksum) as the level count and kept pushing empty levels | the session stream is sealed like the real one (`encodeSession`); strict tokens, complete read, seal, and the whole grammar checked before decoding by loops that stop at the first violation; exit 3. `out/lang/wk/build/wk-native` is now the same strict binary; the old lenient one was deleted | "fix 3.5" (the verifier's real-mode stream, cut, 2^32 − 1 level and point counts, trailing token, unsealed: exit 3 in milliseconds, empty stdout) |
| 6 | Under the decorate idiom `try { op } catch (e) { throw regenError(..) }` the first error differed from today in message and location (239 + 123 uses in the corpus) (medium) | kernel ops inside `try` were recorded speculatively and the handler never ran | the try replay (§2.1): the recording is repeated with the failing kernel call throwing today's error object; the unchanged interpreter runs the real handler | "fix 3.6" (`decorated` = the verifier case, `decoratedMessage` with `"R4 build: " ~ e`, `fallback`) |

### 8.2 Also found and fixed

- **Key order of transformed Boolean results.** A pattern copy of a planar-Boolean result had `constructionBudget`
  before `construction` (today: after, `transformConstructionHistory` sets it last): deep-equal, not byte-identical
  (verifier cases `planar-pocket-edit`, `planar-pocket-edit2`, `planar-pocket-pattern`). The decoder no longer sets a
  transform's budget; the replay does, as today.
- **build123d stager.** `python/runner.py` (production, changed by the concurrent build123d work at 06:26) now
  reports the result as `outputs` instead of `handle`; `stage-py.mjs` accepts both and fails loudly without a result.
  The frame-with-tab frontend regression holds again (graph hash `f55dec6f28652498` from FS and build123d).
- **First error location.** Errors today's build raises too now carry today's location (none where today has none);
  `at` keeps the op span (§2.3).

### 8.3 Verification, and a moving production tree

Since 06:15 another workflow edits the FS frontend in the working tree (`src/parser.mjs`, `src/interpreter.mjs`,
`src/library.mjs`, `src/values.mjs`, `src/scalars.mjs`, `src/modules.mjs`, `src/queries.mjs`, `python/`); at 06:24
today's `build()` threw `this.binaryBoolean is not a function`. So the round was verified against production at git
HEAD `12037b8` in a snapshot (`tmp/lang/r3/head`, §3), and the focused tests were run on the working tree as well.
The byte-comparison test of `src/parser.mjs` / `src/interpreter.mjs` against HEAD no longer says anything about this
workflow; it was replaced by what the recorder guarantees (no file of this workflow writes or patches them, and a
recording leaves the `Interpreter` class unchanged), with the HEAD comparison as a diagnostic.

### 8.4 Results of the round

- **Tests** (`node --test test/lang-wk-real.test.mjs test/lang-wk.test.mjs`): 32 of 32 pass against production at
  git HEAD (40 s, load 31) and 32 of 32 on the working tree at 06:58 (51 s, load 28 to 33). The five "fix 3.x" tests
  cover the six defects; the replaced unchanged-frontend test and the updated round-2 tests (dual-hardware now
  without any differing node, the first error's today location) are part of the 32.
- **The verifiers' round-3 cases** (every `tmp/lang/verify/r2/cases/*.fs` except four huge chain / polygon copies,
  plus the 10 tilt-fuzz cases; log `out/lang/wk/real/round3-verifier-cases.log`): 105 cases, **100 give today's
  whole model byte for byte or today's first error (message, line, column)**; 2 are the same parse error on both
  paths; 3 are the specified loud gaps (PLANAR_INTERSECT not in the evaluator; two Booleans whose result is 0 or 2
  bodies: count speculation). The verifiers' own harness (`tmp/lang/verify/r2/run-case.mjs`, working tree) reports
  PASS json-identical or SAME ERROR for the twelve reproductions named in the defects.
- **Real parts** (§4.2): dual-hardware 104 of 104 body nodes byte-identical to today's adapters (round 2: 103); the
  gate decision is unchanged (§4.4).
- **Build:** one native compile (bend → C 18.5 s, 12.7 GB; clang 19.1 s, 1.6 GB; load 14).
