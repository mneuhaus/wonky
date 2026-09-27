# Proposal from the core-IR angle: WK, a staged core IR between the frontends and the Bend kernel

Date: 2026-09-22. Role: language architect, angle "core IR first". FeatureScript and build123d stay the languages
Marc and LLMs write. JS frontends stage them into a small core calculus that a Bend evaluator runs natively,
together with the kernel. A human-facing syntax comes later, if ever.

Machine: Apple M5 Pro (18 logical CPUs), macOS arm64, Node v22.23.1, Bend 2.0.25. The machine was shared with three
other workflows. The one-minute load average was **12 to 29** during the runs below. It is recorded in every JSON
report and next to each timing here. All timings are **indicative**. Correctness checks (B-rep hashes, F32x2 volume
words, geometry revisions, body JSON) are exact.

Evidence labels: **[M]** measured for this proposal (script and output named), **[O]** measured by another stage
(cited), **[D]** documented by a cited source, **[I]** my inference.

Inputs: [prior-art.md](prior-art.md), [corpus.md](corpus.md), [semantic-core.md](semantic-core.md),
[bend-feasibility.md](bend-feasibility.md), [../native-bridge.md](../native-bridge.md) and
[../native-bridge/](../native-bridge/) (profile, binding, surface, slice, the three bridge proposals). The sibling
proposals [proposal-dataflow.md](proposal-dataflow.md) and [proposal-surface.md](proposal-surface.md) appeared while
this one was being written; where they measured the same thing, I cite them as a cross-check. `docs/research/` held
only source notes.

## 0. Verdict

**Build the core IR. Build it as an internal IR, not as a language, and on top of the native binding.** Start on the
host now. Add the native whole-graph evaluator only when a real workload asks for it. Do not build a new
human-facing syntax, and do not move FeatureScript or Python evaluation into Bend.

The IR is **WK/0**, the wonky kernel graph:

- first-order SSA over immutable values;
- one node per binding-level kernel operation (`extrude_polygon`, `frustum`, `boolean`, `transform`, `pattern`,
  `import`, ...), measurement or query;
- a small set of *structured regions* (`select`, `map`, `index`, `reduce`, `fold`, `when`) and combinators (`choose`,
  `expect`, `or_else`, `optional`) that keep kernel-dependent logic inside the graph;
- stable ids, source spans with call stacks, and Merkle content hashes that exclude ids and spans;
- a canonical text form.

Frontends **stage** programs into WK. All value-level FS and Python runs on the host in binary64, exactly as today.
Only kernel work, and values that depend on kernel results, become nodes. If a program forces such a value in a way
no region covers, the frontend ends the graph there. That *graph break* is the only host↔kernel synchronization.

What the prototype proves [M]:

- **One IR for both frontends (H1).** FeatureScript and build123d versions of frame-with-tab stage into the
  *identical* canonical graph, with the same output content hash `f55dec6f28652498`.
- **Staging preserves meaning (H2, JS target).** On 11 of 12 runnable programs, the staged WK graph run by a JS
  reference evaluator gives bodies bit-identical to `build()`: the same geometry revisions and the same full body JSON,
  identity included. The twelfth fails loudly on a known gap: `sketch_lines` is not in the reference evaluator.
- **Most real FS lowers to one graph with zero synchronization.** Over Marc's corpus:
  - **241 of 329 unique FS files (73 %) and 78 of 129 families (60 %)** stage into exactly one WK graph.
  - That is **92 % / 90 %** of the files the prototype frontend can process to the end.
  - The rest are wonky parser gaps (43 / 27), graph breaks (21 / 9), value-level gaps (12 / 7) and model errors
    (11 / 7).
  - r10b, the frozen acceptance fixture, stages into one 5,412-node graph with 513 heavy operations.
- **A native Bend evaluator runs staged graphs with the production kernel, bit-exactly.**
  - It is a dedicated first-order evaluator of 521 lines of Bend, with no fuel except fork depth.
  - frame-with-tab from the FS source gives hash `3141504600` and volume words `1180188672 / 739621607`, the spike's
    direct-kernel reference. The result is identical on 1 and 4 threads.
  - It takes 1.50 to 1.81 s on 1 thread over two runs at load 16 to 20 (1.50 to 1.53 s in the quieter run),
    against 1.50 to 1.53 s for the spike's direct kernel calls. The evaluator's overhead is within noise.
- **Fork-join falls out of the dataflow (H5).** Eight independent pocketed blocks in plain FeatureScript, with no
  parallel construct in the source, take 2.45 to 3.50 s on 1 thread and 0.32 to 0.39 s on 8 threads. That is about
  6.6 to 10x, with identical results, at load 13 to 26.
- **Content-hash reuse works across graphs (H4).** Moving the tab of frame-with-tab by 1 mm reuses 3 of 5 nodes. The
  edited graph evaluates in 1.19 to 1.25 s instead of 1.47 to 1.53 s cold, with an identical result.

What the evidence disproves or bounds [M, O]:

- **"The core IR makes wonky fast."** It does not. The speed comes from running the kernel natively, which the
  binding already delivers: 7.6 to 12.6x end to end, measured in the slice
  [O, [slice.md](../native-bridge/slice.md)].
  - WK adds speed only where independent heavy work exists. In Marc's corpus the heavy-op parallelism bound has a
    median of 3.0 (unique) / 2.8 (families), and that bound assumes all heavy ops cost the same, which they do not.
  - Its other gains are incremental reuse and whole-graph residency.
- **"No host↔kernel synchronization at all."** This holds only for most files, not for all:
  - 21 unique files still break on loops that no region covers.
  - Structured regions make graphs big. 12 % of the staged feature graphs exceed 1,000 nodes, and Marc's generated
    total-Boolean helpers produce up to 11,118 nodes.
  - A graph break costs microseconds in-process. So "zero sync" is worth having only because of what whole-graph
    submission enables, not as a goal of its own.
- **"Bend is a good place to run the language."** Only the first-order kernel graph belongs there. Measured costs
  of running more of the program in Bend:
  - FeatureScript arithmetic is binary64. The graphs carry a median of 21 residual value nodes (p90 315, max
    4,228) that Bend could evaluate only in F32x2 or in a soft binary64.
  - Bend's fork-join ran only 2-way when forking on computed arguments.
  - Every evaluator change costs a 15 to 18 s rebuild at 3 to 5 GB.

Order:

1. **Now, host-side only:** WK text, staging as a mock-execution preflight, graph diff and content-hash cache keys.
   This needs no Bend change.
2. **In parallel with the bridge:** make the binding's coarse operation set *the* WK op set, so that it is designed
   once.
3. **Later, gated:** a batched `run_graph` entry in Bend with fork-join and a memo. Gate it on the pool-worker
   fail-stop fix and on a real multi-part workload showing W/S > 1.2.
4. **Never, or only after a measured LLM study:** new syntax.

## 1. What was built

| File | Lines | What it is |
|---|---:|---|
| `src/lang/wk/ir.mjs` | 228 | WK/0 graph, regions, canonical text, Merkle content hashes, structure metrics (levels, heavy work and span, exclusive `when` arms) |
| `src/lang/wk/stage-fs.mjs` | 1,137 | FS → WK staging: the semantic-core evaluator ([semantic-core.md](semantic-core.md)) with a symbolic kernel and a symbolic FS store; check, choose, if-conversion, regions, failure combinators, graph breaks; pure std value functions wonky lacks |
| `src/lang/wk/idioms-fs.mjs` | 148 | AST rewrite of FS loop idioms (select, map, index, reduce, foreach, foreach-index) and of checks that compute a diagnostic before throwing |
| `src/lang/wk/stage-py.mjs` | 103 | build123d → WK: the unchanged shim and runner, with requests answered by symbolic handles; stable call-path ids |
| `src/lang/wk/canon.mjs` | 79 | Bit-preserving canonicalization (signed zero, xy-plane normal form, translation folding, canonical order) |
| `src/lang/wk/eval-js.mjs` | 80 | JS reference evaluator over today's kernel adapters (the oracle for "staging preserves meaning") |
| `src/lang/wk/encode-bend.mjs` | 146 | Lowering to the native op subset, F32 input contract with a rounding report, preflight capability errors, integer stream |
| `kernel/lang/wk/main.bend` | 521 | Native evaluator: decoder, level-wise fork-join over a balanced tree, memo across graphs, checks, JSON results |
| `scripts/lang/wk-census.mjs` | | Dynamic staging census of the corpus → `out/lang/wk/census.json` |
| `scripts/lang/wk-check.mjs` | | Staged WK vs `build()` on the JS target → `out/lang/wk/check.json` |
| `scripts/lang/wk-native.mjs` | | End-to-end native runs (frame-with-tab from both frontends, 4 and 8 pockets, memo, errors) → `out/lang/wk/native.json` |
| `scripts/lang/wk-examples.mjs` | | Canonical texts of the example programs → `out/lang/wk/examples/` |
| `kernel/lang/wk/cases/` | | `frame-with-tab.fs` (FS twin of the build123d fixture), `four-pockets.fs` |
| `test/lang-wk.test.mjs` | | 8 focused tests, 2.5 s, all pass (native and Python tests skip when their binary or venv is missing) |

```sh
node --test test/lang-wk.test.mjs                      # 8 tests, ~2.5 s
node scripts/lang/wk-census.mjs                          # ~95 s, read-only on ~/Workspace/cad
node scripts/lang/wk-check.mjs                           # ~50 s (JS target builds)
node --stack-size=8000 scripts/lang/wk-examples.mjs      # ~3 s (r10b staging 2.7 s)
cd out/lang/wk/build && bend ../../../../kernel/lang/wk/main.bend -o wk-native.c && clang -std=c11 -O3 wk-native.c -o wk-native -lpthread -lm
node scripts/lang/wk-native.mjs --reps 3                 # ~1 min of native runs, 1/2/4/8 threads
```

The staging evaluator reuses `src/lang/semcore/` (desugarer and core evaluator) unchanged. It overrides only the
effect handler, `if`, `try` and the container primitives.

## 2. The design: WK/0

### 2.1 Layers

```
 FeatureScript (unmodified)      build123d (CPython, shim)        [JS later: same pattern]
        │ parse (src/parser.mjs)          │ run, requests
        ▼                                 ▼
 WCore/0 (semantic-core) ── staged evaluation on the host, IEEE binary64, FS units ──┐
        │  kernel effects become nodes; kernel-dependent values become symbols      │
        ▼                                                                           │ graph break:
 WK/0 graph  (text, hashes, spans, ids)  ── canonicalize ── preflight ──────────────┤ run the graph
        │                                                                           │ so far, read the
        ▼                                                                           │ value back,
 native binding: call(op, words) today ── later: run_graph(words) ──► Bend evaluator + kernel
                                                     (JS target = reference backend, same interface)
```

The host keeps parsing, value semantics, units, std-library functions, diagnostics and the span table. This follows
the measured split: parse plus interpreter is at most 0.7 % of wall time [O, profile.md], and a Bend-side language
costs numeric fidelity and relink time [O, bend-feasibility.md]. The kernel side receives only what the kernel must
do.

### 2.2 Values, units and numbers

- **Host values stay FS values.** Staging runs FeatureScript arithmetic in binary64 with FS units (`Quantity` in SI),
  through wonky's own value layer.
- **A WK literal is the kernel input the host would pass today.** Lengths are in mm, produced by the same
  `length()` conversion `library.mjs` uses. Angles are in rad. Other dimensions keep SI with a unit tag.
- **Every op declares its input precision.** Since the W2 re-baseline (2026-09-23) every kernel op of the WK
  real-model evaluator takes F32x2, exactly like production:

  | op | contract | production adapter | kernel entries (`kernel/lang/wk/real.bend`) |
  |---|---|---|---|
  | `extrude_polygon` | F32x2 (`precision="F32x2"`) | `src/kernel.mjs` `extrudeInBend`: `src/real.mjs` `vector()` = `real()` per coordinate, points too | `profile-ring.simplify` (policy word = `PROFILE_MERGE.allowRegularized`), then `polygon-prism.extrude(kept points, origin, normal, x, shift = start offset, delta)` |
  | `frustum` | F32x2 | `src/analytic.mjs` `circularFrustumInBend`: `real()` | `precise.*`, `analytic.frustum` and its measures |
  | `transform` of a polyhedral body | F32x2 | `transformInBend`: the decoded body re-split by `real()`, rotation columns and offset by `real()` | `polygon-prism.transform` on the round-tripped body (`rt0`: decode `number(x) + 0`, then `real()`) |
  | `transform` (identity rotation) of an extrusion or of such a copy | F32x2 | `transformInBend` (W2 integrate fix): the extrusion's binary64 cap origins plus the offset (`translatedPrismInputs`), split once | op 1 on those inputs and the source's points (`real-host.mjs` `foldedTranslations`); construction cloned from the source |
  | `transform` of an analytic body | F32x2 | `transformAnalytic`: `real()` | `analytic.transform` and the measure carry-over |
  | `boolean` | (operands) | `booleanInBend`: polyhedral operands re-split by `real()` in `classificationInput` | per method, unchanged |

  The canonical literal of a number (what the content key covers) is its `real()` word pair `[hi, lo]`, so two
  binary64 literals with the same pair get one key. The encoder reports every number whose pair does not sum back
  to it. `examples/bracket.fs`'s `vector(18, 12) * millimeter` is 18.000000000000004 mm in binary64 and keeps that
  value exactly (`[18, 2^-48]`); under the earlier F32 contract (`Math.fround`, before W2) it became 18, and
  `four-pockets.fs`'s 208.00000000000003 became 208 (6 rounded numbers in that graph). A `real()` precondition
  failure (non-finite, above 1e20, F32 underflow) is today's `RangeError` before the node is sent.

  The graph keeps the binary64 value either way.
- **Signed zero is part of canonical form.** build123d's `Align.MIN` yields a plane origin of −0 (`-size * 0`);
  FeatureScript's `fCuboid` yields +0. `polygon-prism.extrude` uses the origin only through
  `precise.add(origin, shift)`, and `real.bend` `add` renormalizes an all-zero sum to (+0, +0) whatever the signs
  of the zero words, so a −0 origin cannot reach a vertex, for every start offset (the F32 path needed a +0 offset).
  Normalizing it is bit-preserving; `test/lang-wk-real.test.mjs` checks the built words on a straight and a tilted
  plane. It is the kind of rule an IR must state, not discover in a golden diff.
- **Residual value computation** means arithmetic on measured values, comparisons, `choose`, `format` for error
  messages and `get` on measured records. These nodes are FS binary64 semantics. The corpus graphs contain a median
  of 21 of them (p90 315, max 4,228) [M, census]. Where they run is a decision (§5.6).

### 2.3 Node set

| Group | Ops | Notes |
|---|---|---|
| Kernel construction | `extrude_polygon`, `frustum`, `sketch_lines`, `sketch_arcs`, `sketch`, `extrude_profile`, `loft`, `import`, `import_context` | Equal to the binding facade's coarse ops ([native-bridge.md](../native-bridge.md) §5.4) where they exist; the rest are staged as the facade grows |
| Kernel modification | `boolean{kind, targets, tools, keepTools}`, `transform`, `pattern`, `op{fn, definition}` | `op` is a generic node for kernel functions the prototype does not model yet (`opFillet`, `opOffsetFace`, ...). It keeps its inputs, so the dependency structure stays complete, and it fails with a capability error when executed |
| Store bookkeeping | `difference`, `rebind`, `replace`, `set_property` | Needed only when a symbolic body set meets FS's record store (§2.5). They are set operations on body sets |
| Queries and measures | `evaluate`, `entities`, `query{name}`, `count`, `nth`, `measure{fn}`, `property` | `measure` mirrors FS `ev*`; `query` stands for std queries the prototype stages generically (`qGeometry`, `qLargest`, ...) |
| Residual values | `arith`, `cmp`, `not`, `math`, `get`, `format`, `choose` | FS semantics (binary64, units) |
| Checks and failures | `expect{cond, message}`, `or_else{value, fallback}`, `optional{value}` | `expect` is a deferred FS check (`if (c) throw`). `or_else` and `optional` come from `try silent` / `try(expr)` around kernel work |
| Regions | `select`, `map`, `index`, `reduce`, `fold`, `when` | Sub-graphs with parameters, evaluated per element or conditionally. `fold` and `when` carry FS store records as loop or branch state |
| Inputs | `input{name}` | A UI-selected query, or the pre-existing Part Studio for features that run after earlier Onshape features |
| Provenance (not nodes) | `id`, `span`, `stack`, `attrs.decorate`, `attrs.primitive`, `attrs.invalid` | Outside the content hash |

The node count is small because the binding already defines the coarse kernel ops. The corpus needs 35 kernel
functions for 80 % of families and 49 for 95 % [O, corpus.md]. WK adds 6 region kinds and about 15 small value and
check nodes on top.

### 2.4 Staging: how a program becomes a graph

The staging evaluator is wonky's semantic core with a different effect handler. Every kernel builtin appends a node
and returns a *symbol*: a reference to the node plus a static type (bodies, entities, list, number with units,
record, ...). Symbols flow through ordinary FS code. Arithmetic on them builds `arith`/`cmp`/`math` nodes. Member
access builds `get`. `size()` of a symbolic list builds `count`. The interesting part is what happens when a program
*forces* a symbol:

| The program does | WK gets | Why it is exact |
|---|---|---|
| `if (c) throw regenError(m)` with symbolic `c` (84 % of FS families contain a check [O]) | `expect(not c, m)`. `m` can be a `format` node. A check whose branch first builds a diagnostic message goes through `__wk_message` | The throw aborts the feature. Later nodes may run speculatively, but the reported error is the one FS would raise (§2.6) |
| `a && b`, `a \|\| b`, `c ? x : y` with pure branches | `choose(c, x, y)` | Both branches are side-effect free |
| `if (c) { kernel ops }` or early `return` on a symbolic `c` (empty guards, generated total-Boolean helpers) | Two `when` regions, one per arm, with the FS store as carried state. Records, join arguments and return values are merged with `choose` | if-conversion. Each arm is traced until it leaves the `if`: through the join point, or by producing the function value (an early return is retraced through its continuation). Ids claimed in one arm may be reused in the other, since only one runs |
| `for (x in E) if (P) acc = append(acc, x)`, with leading per-element declarations allowed | `select(E, x → P)` | AST idiom (`idioms-fs.mjs`), the corpus's dominant host-selection form [O] |
| `for (x in E) acc = append(acc, F)` | `map(E, x → F)`. The identity map (`makeRobustQuery(ctx, x)`) keeps element owners | |
| `for (x in E) M[K] = x` | `index(E, x → K)`; lookups `M["name"]` become `get` | The generated name-table pattern (`n_base[getProperty(...)] = b`) |
| `for (x in E) { … }` assigning outer variables, no effects | `reduce(E, init, (x, acc…) → acc…)` | Sums and argmax (`keepMain`) |
| `for (x in E)` or `for (i = 0; i < size(L); i += 1)` with kernel ops and no outer assignments | `fold(E, init: {record: value}, (i, records…) → records…)` with templated ids `model/chuteFit/cut⟨$i⟩` | The store is the loop state |
| `try silent { ops }`, `try(expr)` | `or_else(new, old)` per changed record, `optional(new)` per created record | Atomic best effort, as FS intends and semantic-core's transactions implement |
| `try { … } catch (e) { throw regenError(p ~ e) }` | `attrs.decorate` on the body's nodes | The host formats the message when a node fails (see the caveat in §13) |
| Anything else: branch or loop on a kernel result that no rule covers, type tests on kernel values, assignment into kernel results | **graph break** with kind and span | The prototype stops. A production frontend submits the graph so far through the binding, reads the value and continues |

With a concrete collection, every idiom builtin simply runs the loop in order. The rewrite changes meaning for no
program, so it is applied everywhere.

**Static cardinality** removes many symbolic counts. An extrusion makes exactly one body, so
`size(evaluateQuery(qCreatedBy(id + "ex")))` is concrete 1 at staging time. The check folds away, and a loop over
such bodies unrolls.

**Feature inputs.** Parameters the Onshape UI would supply take std defaults: `LENGTH_BOUNDS` defaults to 0.025 m
and `ANGLE_360_BOUNDS` to 30°, per `valueBounds.fs`. Precedence is std default < `defineFeature` defaults map <
annotation `Default`. A UI-selected `Query` becomes an `input` node over a symbolic Part Studio. The prototype first
got this precedence wrong: it staged `bracket.fs` with 25 mm instead of 8 mm. The failing test is kept.

### 2.5 Topology naming and stable ids

- **FS ids are the node ids**: `model/extrusion`, `model/side/cut`. They are hierarchical and derived from
  creation history, as FsDoc requires [D].
- **Ids inside regions are templates**: `model/chuteFit/cut⟨%70⟩`, where `%70 = format("cut", $i)`. They are unique
  per iteration by construction.
- **build123d ids** are call paths plus an occurrence counter: `py/L4#2` means the second request from line 4. This
  replaces today's session-serial `python/N`, which semantic-core flagged as unstable (case 18).
- **Lineage is static.** Records, `createdBy` sets and deletions depend on ids, not on geometry. So
  `qCreatedBy`, `qEverything` and `qAllModifiableSolidBodies` resolve at staging time to the nodes that produce the
  bodies. After a union, the surviving record's lineage is the union of the tools' lineages, as in `library.mjs`.
  The prototype first forgot this, the census exposed it, and it is fixed.
- **`makeRobustQuery` freezes.** FsDoc says a robust query resolves to the entities of its input *at the time of the
  call*. Staging snapshots the record set. Lazy resolution was a real bug found on guide-r2: later folds subtracted
  from every solid in the studio.
- **Entity references are values.** An evaluated entity refers to the node that produced its body at evaluation
  time. After the body changes, the reference still names the old value, so staleness is explicit, not silent. Today
  wonky silently rebinds a stale index to a different edge (semantic-core probe `staleTransientReference`). The
  build123d fallback in project-component-d98e059b.py (§3.5) shows the other side: filleting a new solid with edges of the old one
  needs persistent-identity resolution (`kernel/identity.bend`) or an explicit error. WK makes the choice visible; it
  does not solve it.
- **Identity is outside the content hash.** Hashes cover `(op, args)` with Merkle references. Two frontends asking
  for the same geometry get the same hash. The ids affect only identity labels, which should become a separate cheap
  pass keyed by `(hash, id)`. The slice's finding supports this: identity strings are the largest native cost after
  the Booleans, 120 ms for frame-with-tab [O, slice.md].

### 2.6 Errors with source spans

- Every node carries a span id, the call-site stack and, inside `try`, decoration templates. The span table stays on
  the host.
- **Staging errors** are the FS errors of today, raised at the same span by the same value layer: units, types,
  preconditions.
- **Graph breaks** carry a kind (`branch`, `loop`, `value-use`, `failure-handler`) and a span. For example,
  "loop over a kernel result that is not a recognised select/map/foreach idiom at 32:5". The frontend can show them
  as a lint before anything runs.
- **Preflight (mock execution)** rejects any op the chosen backend cannot run, before submission, with its span
  [M, native.json]: `extrude_polygon at %0 is outside the native subset (xy plane, +Z extrusion)` →
  `frame-with-tab.py:3:1`.
- **Native errors** come back as values `{error, span, message, trace}` and map to source. In the prototype, a
  deliberately ill-typed check produces code 2 at span 4, which maps to `frame-with-tab.fs:15:9` [M].
- **Deferred checks.** Several nodes can fail in one graph. The reported error is the failing node with the
  smallest index, and nodes downstream of a failure propagate it. That reproduces the FS error for a sequential
  program even when independent nodes ran in parallel. The prototype's native `expect_single` and the spike's error
  values already behave this way.

### 2.7 Determinism

- Staging is deterministic: FS semantics, the value order of map keys, no clocks.
- Canonical order is a post-order walk from the outputs with sorted argument keys. The order in which a frontend
  emitted independent nodes does not matter.
- Native results were identical across 1, 2, 4 and 8 threads for every measured graph (frame-with-tab, four and
  eight pockets), and across repetitions [M]. The GPU was not tested.
- Content hashes are sound for caching only if every op is a pure function of its arguments. In Bend it is. On the
  host side, identity labels must stay out of the cached value (§2.5).

### 2.8 Canonical text

One line per node, regions indented, provenance after `;`:

```
%4 = boolean kind="union" targets=[] tools=[%2, %3] keepTools=false   ; @id py/L7#1  @ frame-with-tab.py:7:1  #f55dec6f28652498
```

This is the form for golden tests, graph diffs, cache keys, bug reports and LLM *reading*. It is not an authoring
language: r10b is 5,412 lines of it.

## 3. Example programs, in the original and in WK

All WK texts below are produced by the prototype (`scripts/lang/wk-examples.mjs`, full files in
`out/lang/wk/examples/`), except §3.5, which is written by hand and marked as such. Hashes and long argument lists
are shortened.

### 3.1 `examples/bracket.fs` (34 lines, 245 tokens)

The FS source is the ordinary `defineFeature` with a precondition, a sketch polyline and an `opExtrude`
([prior-art.md](prior-art.md) §3.2 counts it). Staged (0.8 ms):

```
wonky-kernel-graph/0 frontend=featurescript
%0 = extrude_polygon points=[[0, 0], [50, 0], [50, 12], [18.000000000000004, 12], [18.000000000000004, 40], [0, 40]]
       plane={normal: [0, 0, 1], origin: [0, 0, 0], x: [1, 0, 0]} delta=[0, 0, 8] offset=null precision="F32x2"
       ; @id model/extrusion  @ bracket.fs:31
out %0
```

Sketch creation, polyline and solve disappear into one kernel op, because the sketch content is concrete at staging
time. The `8 mm` comes from the `defineFeature` defaults map, and the `18.000000000000004` shows the binary64 input
that the F32x2 contract keeps (the F32 contract before W2 rounded it to 18). Through the JS reference evaluator this graph gives the same geometry revision and
body JSON as `build()` [M, check.json].

### 3.2 frame-with-tab: build123d and its FeatureScript twin (H1)

```python
stock = Box(50, 40, 10, align=Align.MIN)
opening = Pos(8, 8, -1) * Box(34, 24, 12, align=Align.MIN)
frame = stock - opening
tab = Pos(48, 10, 0) * Box(12, 20, 10, align=Align.MIN)
result = frame + tab
```

The FS twin, `kernel/lang/wk/cases/frame-with-tab.fs`, uses three `fCuboid` calls and two `opBoolean` calls.
build123d staging produces 7 nodes; canonicalization folds both `Pos * Box` translations (exact in binary64 and F32)
and normalizes the −0 origins. Both frontends then give:

```
%0 = extrude_polygon points=[[0, 0], [50, 0], [50, 40], [0, 40]] plane={…origin: [0, 0, 0]…} delta=[0, 0, 10] …  #583cd03302cb3f98
%1 = extrude_polygon points=[[8, 8], [42, 8], [42, 32], [8, 32]] plane={…origin: [0, 0, -1]…} delta=[0, 0, 12] …  #3da6c597215b4e97
%2 = boolean kind="subtract" targets=[%0] tools=[%1] keepTools=false                                          #346447b3e2bde570
%3 = extrude_polygon points=[[48, 10], [60, 10], [60, 30], [48, 30]] plane={…origin: [0, 0, 0]…} delta=[0, 0, 10] …  #d46bb2a0dd38342c
%4 = boolean kind="union" targets=[] tools=[%2, %3] keepTools=false                                            #f55dec6f28652498
```

The only differences are provenance: `@id py/L4#2 @ frame-with-tab.py:4:1` against
`@id model/opening @ frame-with-tab.fs:11:9`, plus the output name `result`. Natively, the graph gives the
direct-kernel reference bit for bit (§5.2). Staging takes 1.5 to 5.8 ms for FS and 30 ms for build123d, most of it
CPython start.

### 3.3 fs-simple: `hopper-corner-inserts-r1/inserts.fs` (55 lines, SHA-256 pinned, matches)

The source builds six line/arc sections in a literal-array loop, lofts them, trims with two half-space extrusions,
mirrors with `opPattern`, and names, colours and poses both parts (full source in corpus.md §6). Staged in 6.5 ms,
14 nodes, zero breaks:

```
%0..%5 = sketch_arcs entities=[{…"bottom"…}, {…"blunt"…}, {type: "arc", id: "chute", mid: […]…}, {…"rear"…}]
           plane={normal: [1, 0, 0], origin: [-120, 0, 0]…}         ; @id model/section-120 … model/section-36.5
%6  = loft profiles=[%0, %1, %2, %3, %4, %5]                        ; @id model/loft  @ inserts.fs:38:2
%7  = extrude_polygon points=[[-500, -500]…] plane={normal: [-0.6932…, -0.6241…, -0.3603…]…} delta=[-346.6…, …]
%8  = boolean kind="subtract" targets=[%6] tools=[%7]               ; @id model/side/cut  @ inserts.fs:25:2
%9  = extrude_polygon points=[[-300, 300], [-51.00000000000001, 300]…] plane={…origin: [0, 0, 0.3]…} delta=[0, 0, -100]
%10 = boolean kind="subtract" targets=[%8] tools=[%9]               ; @id model/floorCut
%11 = transform bodies=%10 transform={linear: [[1, 0, 0], [0, 0.5, -0.866…]…], translation: [77.126…, -498.47…, -184.51…]}
%12 = pattern bodies=%10 transforms=[{linear: [[-1, 0, 0]…]…}] names=["right"]
%13 = transform bodies=%12 transform={…same pose…}
out %11 name="P01 Hopper rounded corner L R1 - glue in" appearance={red: 0.28, green: 0.64, blue: 0.53, alpha: 1}
out %13 name="P02 Hopper rounded corner R R1 - glue in" appearance={…}
```

The whole value layer, including `atan2`, `sqrt` and the per-section parameter formulas, ran on the host and left
only the resulting coordinates. The loop over `[-120, -95, …]` unrolled. `setProperty` became output metadata.
Executing the graph needs `sketch_arcs`, `loft` and general planes in the kernel; the native subset rejects it at
preflight.

### 3.4 fs-medium: `funnel-holder-r2/guide-r2.fs` (111 lines, static level 6, SHA-256 pinned, matches)

This is the harder real case: three Part Studio imports, a left/right split by bounding box, face selection by
normal and a bbox window, a fold of Booleans over a runtime-length list, a guarded engraving, and a `try/catch` that
decorates errors with a stage name. Staged in 7.1 ms, 97 nodes, **zero breaks**, 4 idioms, 4 checks. Excerpts:

```fs
for (var body in evaluateQuery(context, original))
    if (evBox3d(context, { "topology" : body, "tight" : true }).maxCorner[1] < 0 * millimeter)
        left = append(left, body);
if (size(left) != 1) throw regenError("Expected one left source guide");
```

```
%0  = import source={document: "651610df…", member: "build", version: "a097c109…"} part={bodyType…everything…}  ; @id model/guides
%1  = evaluate query=%0
%2  = select list=%1 ($x) {
  %3 = measure fn="evBox3d" of=$x options={tight: true}
  %4 = get of=%3 key="maxCorner"
  %5 = get of=%4 key=1
  %6 = cmp op="<" a=%5 b=0
  yield [%6]
}
%9  = not x=%8      (%8 = cmp("!=", count(%2), 1))
%10 = expect cond=%9 message="Expected one left source guide"   ; @ guide-r2.fs:78:5
```

The chute-seat face selection (`abs(dot(p.normal, RAIL_AXIS)) < 0.001 && … && bb.minCorner[1] >= -65.001 * millimeter …`)
becomes a `select` region with two `measure` nodes and three `choose` nodes for the `&&` chain. The envelope loop:

```fs
for (var i = 0; i < size(cutters); i += 1)
    opBoolean(context, id + ("cut" ~ i), { "targets" : guide, "tools" : cutters[i], "operationType" : SUBTRACTION });
```

```
%69 = fold list=%68 init={r0: %61, r1: %62, r2: %64, r3: %65, r4: %66} ($i $r0 $r1 $r2 $r3 $r4) {
  %70 = format parts=["cut", $i]
  %71 = get of=%68 key=$i
  %72 = boolean kind="subtract" targets=[$r0, $r1] tools=[%71] keepTools=false   ; @id model/chuteFit/⟨%70⟩
  %73 = difference a=$r2 b=%71        (the consumed tool bodies leave their records)
  …
}
```

`makeRobustQuery` freezes `guide` to the records at call time, so the fold subtracts from the guide only. The last
`if (size(evaluateQuery(... qEverything ...)) != 1) throw` becomes `expect`. This graph is structurally faithful.
Its execution is **not** verified: it needs imports, `opOffsetFace`, `skText` and entity selection in the kernel.

### 3.5 py-medium: `cad-project-035/project-component-d98e059b.py` (396 lines, static level 7), hand-written lowering

The prototype cannot stage this file: the shim has no `edges()`, `filter_by`, `fillet` or `chamfer`, and only 1 of
294 unique build123d files fits today's shim [O, semantic-core.md §5]. The idiom it would need, written by hand:

```python
vert = [x for x in solid.edges().filter_by(Axis.Y) if x.center().Z > 60]
try:
    solid = fillet(vert, R_BIG)
except Exception:
    for x in list(vert):                        # fall back to one at a time
        try:
            solid = fillet([x], R_BIG)
        except Exception:
            pass
```

```
%e  = entities of=%solid kind="EDGE"
%v  = select list=%e ($x) { %d = measure fn="direction" of=$x; %c = measure fn="center" of=$x;
                             yield [and(parallel(%d, Y), gt(get(%c, "z"), 60))] }
%f  = fillet bodies=%solid edges=%v radius=8
%g  = fold list=%v init={s: %solid} ($x $s) { %t = fillet bodies=$s edges=[$x] radius=8   ← $x names an edge of %solid, not of $s
                                              yield {s: or_else(%t, $s)} }
%r  = or_else value=%f fallback=%g
```

Everything here is a region or a combinator except one thing: after the first successful fallback fillet, `$x`
names an edge of the *old* solid. OCCT tolerates this through shared TopoDS edges. WK must resolve it through
persistent identity or fail explicitly. This is the stale-reference case in its real form, and the reason entity
references need a revision (§2.5). The `cad-project-046/mount.py` case (py-hard) adds OCP adjacency maps and a sacrificial
subprocess for OCC segfaults. It stays a graph-break program by design.

### 3.6 r10b (the acceptance fixture)

`fixtures/r10b/r10b.fs` (SHA-256 `219ee963…`, unchanged), feature `singleStepR10b`:

- It stages into **one graph** of 5,412 nodes in 2.66 s: parse 38 ms, desugar 37 ms, staging 2.58 s, 6.2 M core
  steps.
- The graph has 16 imports, 11 import contexts with name tables, 433 Booleans, 583 patterns, 173 frustums,
  64 generic ops and 38 checks.
- Heavy work is 513 ops with a heavy critical path of 42 [M, examples/summary.json]. The dataflow angle measured 433
  Booleans and a longest Boolean chain of 42 with a different tracer [O, proposal-dataflow.md]. The two agree.
- Today the interpreter stops at operation 12 (strict) or 44 (acceptance policy) [O, semantic-core.md]. The staged
  graph describes the whole feature, including the parts the kernel cannot yet run. As a preflight it would list
  every unsupported op in one pass.
- 3,219 of the 5,412 nodes are `difference` bookkeeping from dynamic deletions: my store model is bloated here. The
  dataflow tracer's 2,037 nodes show the lower bound.

## 4. Translating FeatureScript and build123d

### 4.1 FeatureScript: staged interpretation

FS translation is *not* a compiler from FS syntax to WK. It is the existing FS evaluator (wonky's semantic core)
running with a symbolic kernel. That matters for three reasons:

1. **Unmodified FS input is automatic.** Whatever the frontend parses, it stages.
2. **There is one FS semantics to maintain.** The same evaluator with an eager effect handler is today's interpreter.
   A graph break is simply "run eagerly for a moment". The production form should be one evaluator with two
   handlers, not an interpreter plus a stager.
3. **Value-level FS stays binary64.** Only kernel-dependent values cross into WK.

Hard cases and how the prototype handles them:

| Case | Evidence | Handling |
|---|---|---|
| Checks on kernel results (84 % of families) | corpus.md | `expect` nodes; the message becomes a `format` node when it contains kernel values |
| Empty guards and generated total-Boolean helpers (`cp`, `combine`, `subtract`, `keepMain` in 25 to 38 families each) | corpus.md §2 | if-conversion into two `when` regions plus `choose`. Correct, but big: the fixed-frame-r30 family stages into up to 11,118 nodes with 924 conversions in 2.8 s. **The cheaper fix is in the kernel:** a total Boolean (empty operand → identity/empty) makes these guards dead, and Marc's generator could drop them |
| Selection loops, name tables, argmax, per-element Booleans | levels 5 and 6 | the six region kinds |
| `try silent` best effort | 12 % of files | `or_else` / `optional`. Handlers with their own effects are a graph break |
| Features that expect existing Part Studio bodies ("Derive … into a NEW Part Studio first") | 49 unique files | symbolic `input` for the pre-existing studio |
| UI parameters | preconditions | std bound defaults; `Query` parameters become `input` nodes |
| Missing pure std functions (`toWorld`, `rotationAround`, `coordSystem`, `makeId`, `min`, `atan2`, `mirrorAcross`, ...) | semantic-core §4.1 | implemented in the stager from std semantics. They belong in `src/scalars.mjs` regardless of WK. After them, only 12 unique files still hit value-level gaps (`toString` 8, `mergeMaps` 2, `println`, `acos`) |
| FS type tags wonky lacks (`is Color`, `as AngleBoundSpec`) | semantic-core case 8 | accepted structurally (any map); a documented divergence |
| Stale transient references | semantic-core case 5 | explicit: a reference names the value it was taken from |
| Remaining graph breaks | 21 unique files | loops whose bodies append in nested conditions, `append` to a kernel-derived list, `is Cylinder` type tests on surfaces, assignment into a table keyed by kernel results. All sit at static levels 5 and 6 |

### 4.2 build123d: tracing through the shim

build123d runs in CPython. WK staging answers the shim's requests with symbolic handles: `box` becomes
`extrude_polygon`, `Pos *` becomes `transform`, operators become `boolean`. Everything Python does stays in Python.
This is exact and cheap (30 ms, mostly process start), and it is how H1 was shown. Its limits:

- **Coverage is the shim's, not WK's.** The shim covers boxes, cylinders, translation and Booleans. Selectors,
  fillets, sketches and `Location` algebra are missing, so 1 of 294 unique files runs today. Extending the shim is
  frontend work that WK does not change.
- **Read-backs are graph breaks.** `shape.volume`, `bounding_box()` and `center()` return concrete numbers to Python.
  A production frontend flushes, reads, continues. The corpus's dominant idiom,
  `[e for e in s.edges().filter_by(Axis.Y) if abs(e.center().Z - h) < eps]` (28 of 82 families [O]), would need the
  shim to return *lazy* entity lists with overloaded comparisons. That is the WPy direction of
  [proposal-surface.md](proposal-surface.md). WK can host its output unchanged.
- **Stable ids** come from the Python call path plus an occurrence counter (§2.5).

### 4.3 Coverage, from the corpus

| | FS unique files | FS families |
|---|---:|---:|
| modeling files | 329 | 129 |
| static estimate (corpus.md): plain graph + lazy IR, no general language | 98.8 % | 97.7 % |
| **dynamic, measured: one WK graph, zero graph breaks** | **241 (73.3 %)** | **78 (60.5 %)** |
| of these, needing a symbolic pre-existing Part Studio | 49 | 22 |
| staged to the end (single graph or first break) | 262 | 87 |
| single graph as a share of staged | **92.0 %** | **89.7 %** |
| graph break | 21 | 9 |
| wonky parser cannot read the file (fragments, `try silent {`, `for (k, v in map)`, ...) | 43 | 27 |
| value-level gap in the prototype | 12 | 7 |
| model error on staging (a real FS error with std inputs, e.g. an explicit unsupported-input check) | 11 | 7 |

[M, `out/lang/wk/census.json`, 762 staged features, load 16 to 19, 93 s wall.]

By static level, single graph / break (unique files): level 1 17/0, level 2 82/0, level 3 55/0, level 5 66/14,
level 6 18/7, level 7 2/0. Both parseable level-7 files (the per-core fold with face selection by normal) stage
completely. **Every** remaining break sits at level 5 or 6. The corpus chapter's claim that a lazy IR covers levels
0 to 6 holds for 90 % or more of the stageable files. The dataflow angle, with a speculative recorder and no
regions, reports 60 % of files / 51 % of families that reach a graph outcome without a break [O]. The regions are
what closes most of that gap. Their price is graph size: 87 of 710 feature graphs (12 %) exceed 1,000 nodes, almost
all from if-converted helper layers.

**build123d:** no dynamic number. The static estimate is 89 % of families without a general language [O], but the
shim reaches 1 of 294 files today.

### 4.4 Staging cost

Per feature over the corpus: median 18 ms, p90 179 ms, p99 2.5 s, max 2.8 s [M, census]. For comparison, wonky's
interpreter takes 20 to 36 ms to parse r10b and at most 0.7 % of wall time overall [O]. Staging walks *both* arms of
every converted `if`, which makes the large generated files slow. r10b takes 2.66 s. None of this is optimized
(queries are re-resolved per use, and store bookkeeping emits nodes eagerly), and none of it is on the critical path
next to kernel seconds. Still, it is a real cost of the staged form, and an argument for kernel-side totality over
frontend if-conversion.

## 5. The Bend implementation

### 5.1 Evaluator architecture

`kernel/lang/wk/main.bend` is a first-order graph evaluator of 521 lines:

- **Input:** a session of graphs; each graph is a list of levels, each level a list of independent nodes, plus
  output references. Numbers arrive as exact F32 words; references are distances into an environment list.
- **Evaluation:** per level, a balanced binary `Tree` is built over the level's nodes and evaluated with fork-join on
  its fields (`x y = run_tree(a, …) run_tree(b, …)`). Results are prepended to the environment.
- **Memo:** a list of `(hashHi, hashLo, value)` shared across the graphs of a session. A node whose content hash is
  present is not evaluated.
- **Kernel ops** are the language spike's builtins (`kernel/lang/spike/kernel-ops.bend`): production
  `topology.extrude`, `planar-boolean` union/subtract and `planar_measures`, with capability errors carrying the
  span. Checks are `expect_single` and `expect_range`.
- **No fuel is needed for evaluation.** Every loop is structural in a list or a count. Only the tree construction
  takes a depth fuel (64). This compares with the spike's dynamic evaluator, which needs fuel on every step. A
  first-order IR avoids that entirely.

Bend's rules shaped the code as follows, all measured by compile errors, not assumed:

- **No mutual recursion, and no `match` on computed values.** Every loop receives the previous step's result as a
  *parameter*. For example, `nodes_loop(n, r: NodeRes, acc)` destructures `r`, then decodes the next node.
- **"Scrutinees follow binder order"** (GUIDE.md). A def must match its parameters in declaration order. A binder
  bound by an outer pattern cannot be matched inside another match. Both produced the error "this name is a def or a
  consumed binder" until the matches were reordered.
- **Linearity.** Fork branches need `case 1n+ +f:` and `+` parameters for anything used twice.

### 5.2 Native results [M, `out/lang/wk/native.json`, load 18 to 21 unless noted]

| Run | Result | Time |
|---|---|---|
| frame-with-tab from **FS** and from **build123d** (identical graph), 1 thread | hash `3141504600`, volume words `1180188672/739621607`, 64 faces: **equal to the spike's direct kernel calls** (`refValue` in out/lang/spike/run-2) | eval 1.50 to 1.53 s (quieter run) and 1.58 to 1.81 s (load 19 to 20); process 1.51 to 1.84 s. Spike direct calls: 1.50 to 1.53 s [O] |
| same, 4 threads | identical | 0.98 to 1.00 s (the kernel's internal fork; spike 0.93 s [O]) |
| four pockets (plain FS loop, 12 nodes, levels 8/4/8), 1 / 2 / 4 threads | identical across threads; pocket 0 equals the spike's planar-pocket hash `1451706507` | 1.21 to 1.40 s / 0.60 to 1.49 s / 0.46 to 0.56 s (noisy under load; an earlier run gave 1.21 / 0.61 s) |
| **eight pockets**, 1 / 2 / 4 / 8 threads | identical across threads | 2.45 to 3.50 s / 1.23 to 1.36 s / 0.62 to 0.65 s / 0.32 to 0.39 s: **3.9 to 5.6x at 4, 6.6 to 10x at 8** (the high end is against loaded 1-thread runs; the kernel's internal fork also gets cores once threads exist) |
| memo: frame-with-tab, tab moved 1 mm, session of old + new graph | 3 of 5 nodes reused, identical result | 1.19 to 1.25 s against 1.47 to 1.53 s cold (**about 19 % saved**; an edit of the opening would save nothing) |
| host side per run | staging 1.5 to 30 ms, encoding 0.2 to 0.9 ms, 137 tokens | process start about 5 ms |

### 5.3 A Bend runtime constraint worth knowing

My first evaluator split each level with `x y = par(f, take(ns, h), …) par(f, drop(ns, h), …)`, forking on
*computed* arguments. It ran exactly **2-way at 2, 4 and 8 threads**: eight pockets took 2,448 / 1,233 / 1,246 /
1,241 ms, at load 13 to 14, where the spike had measured 3.8x at 4 threads.

- Putting each level into its own IO step changed nothing (2,459 / 1,233 / 1,237 / 1,248 ms).
- Building a balanced `Tree` first and forking on its **fields** scaled: 2,560 / 1,362 / 653 / 390 ms at load 24.

GUIDE.md calls the scheduler "a contention-free, binary fork-join machine: every task is handed to a core exactly
once and never moved afterwards". I did not establish the mechanism. The practical rule is: **fork on data, not on
calls that compute the data.** Any future `run_graph` must build its fork tree first.

### 5.4 Parse in JS or in Bend

Parse in JS. The native FS tokenizer is exact and 1.6x faster than V8 [O, bend-feasibility.md]. But parsing is at
most 0.7 % of wall time, and in WK the kernel side never sees FS source at all. It gets a flat integer stream: 137
tokens for frame-with-tab. The spike's AST decoder runs at about 36 ns per int [O]. A host-free CLI can replay a
cached `.wk` file keyed by source hash; that needs neither a Bend parser nor host staging.

### 5.5 Linking the kernel, compile time, memory

The evaluator imports the spike's `core.bend` (for `Value`), `frontend.bend` (number words, JSON printing, file
reading), `kernel-ops.bend` and `scripts/build123d-workload.bend`. Builds [M, `out/lang/wk/build/builds.json`]:

| Build | bend → C | clang -O3 | Output | Load |
|---|---|---|---|---|
| first | 7.1 s, 3.0 GB peak | 7.4 s, 0.86 GB | 4.1 MB C, 2.25 MB binary | 18 to 20 |
| final (tree fork) | 7.6 s, 4.9 GB | 8.5 s, 0.81 GB | same size | 24 to 26 |
| spike, for comparison | 17.9 s, 7.07 GB | 8.9 s | 4.9 MB C, 2.37 MB | [O] |

A first-order evaluator is less than half the spike's Bend-to-C time, because it links only the planar kernel and
has no tokenizer. Every evaluator change still costs about 15 s and 3 to 5 GB. That is fine for a small, stable
evaluator and wrong for anything that changes often, such as a language. `bend --check-only` takes 0.3 s and caught
every error above. Native process RSS for these runs is a few MB [O, spike]. The evaluator adds an environment list
and a memo list per session.

### 5.6 Numbers inside Bend

The native subset takes F32x2 inputs (the `real()` word pairs of §2.2; the polygon extrusion took F32 before the
W2 re-baseline) and returns F32x2 results. The residual value nodes
(§2.2) are the open decision. There are three honest options:

- **(a) Evaluate them on the host.** A graph break per read-back; microseconds in-process. This is the default
  today, because the native subset has no residual nodes.
- **(b) A soft-binary64 in Bend for about 15 ops** (`+ − × ÷`, comparisons, `abs`, `sqrt`, `dot`, `norm`). The
  counts are small: median 21 per graph. They are not per-vertex work, so speed is irrelevant, and correctness can
  be tested exhaustively against JS.
- **(c) F32x2 with a stated tolerance.** This is risky, because the nodes decide branches: a bbox window
  `>= -65.001 * millimeter` evaluated in F32x2 can flip on a boundary value.

Recommendation: (a) now, and (b) only if a measured workload needs whole-graph submission of such graphs. Never (c)
for control decisions.

## 6. Relationship to the native binding: build on it

The bridge decision is a stateless `call(op, words) → words` with exact carriers, generated compat entries first and
a narrow facade later. Residency and batching come only with evidence [O, native-bridge.md §4]. WK fits that plan as
follows:

1. **WK's kernel ops are the facade's coarse ops.** `extrudePolygon`, `frustum`, `sketchLines`, `sketchArcs`,
   `extrudeProfile`, `transform`, `boolean`, `importBrep`: the same names and argument records. The facade *is* WK
   op-at-a-time. Design the argument records once, for both.
2. **Graph breaks are ordinary facade calls.** An FS frontend with an eager handler is today's interpreter over the
   facade. Staging only changes *when* the calls happen. The binding's 0.5 µs per call makes the eager path cheap
   [O, binding.md].
3. **Caching needs no Bend change.** A host map from content hash to the carrier returned by the facade gives
   incremental rebuilds in a resident session. §5.2's 19 % comes from exactly this reuse, measured natively.
4. **Fork-join and whole-graph residency need one new entry, `run_graph(words)`.** The runtime is one per process and
   serializes calls, so a JS host cannot run two kernel calls at once [O, binding.md]. The kernel-evaluator code in
   `kernel/lang/wk/main.bend` is that entry, minus the IO wrapper. Its gates:
   - the pool-worker fail-stop fix, since today a fail-stop on a worker thread ends Node;
   - a *real* workload with W/S > 1.2. The bridge's batched proposal measured W/S 1.00 to 1.06 on the eight profiled
     workloads [O], which are chains. My eight-pocket file shows 6.6 to 10x, but it is synthetic. The corpus bound
     (median 3.0 by op count) says real multi-part files are the candidates.
5. **WK does not replace the binding.** It uses the binding's mechanism (N-API addon, wire codecs, carriers) and its
   decision rules (no silent fallback, JS target as reference behind the same interface).

## 7. Dev loop and error messages

- **Edit FS or Python, stage, read the canonical text.** A graph diff between two stagings shows exactly which kernel
  work an edit touches. In the frame-with-tab edit, 3 nodes are unchanged and 2 changed. The same diff drives the
  cache.
- **Preflight before geometry.** Staging lists graph breaks, capability gaps and unsupported ops with spans in
  milliseconds (median 18 ms per feature), with no kernel loaded. The bridge's batched proposal found three r10b
  blockers in under 0.3 s with a record-only lint [O]. WK staging is the same idea with regions.
- **Error text.** Staging errors are today's FS errors. Kernel errors return a span id and are formatted by the host
  exactly as today (`file:line:column: message`, source excerpt, call stack from `node.stack`). Decorated messages
  (`stage ~ ": " ~ error`) come from node attributes.
- **Cost of changing the native evaluator:** about 15 s rebuild. Kernel changes follow the bridge's build-and-cache
  rules. The WK host side has no build step.

## 8. LLM-friendliness

WK is not meant to be written by LLMs, and nothing here measures LLM behaviour (H6 is untested). What the design does
for LLM work, grounded in prior art [O, prior-art.md §4.3]:

- LLMs keep writing build123d-style Python or FS, the languages with training data. CADFS needed 451k programs to
  make FS competitive and still had a 3x invalid rate.
- The properties that measurably help LLMs come from the IR and its tools, not from syntax:
  - deterministic ids (CADFS: median chamfer distance 124.87 → 97.82);
  - explicit geometry (endpoint parametrization: invalid 24 % → 10 %);
  - kernel feedback before and after execution (CADSmith: IoU 0.81 → 0.96).

  WK provides stable ids, a preflight with spans, per-node measurements and checks, and a canonical text that shows
  exactly which kernel work a program asks for.
- A canonical graph is a good *reading* format for an agent debugging a part: it is flat, explicit and global-frame.
  It is a poor writing format: no parameters or loops, and r10b is 5,412 lines. An LLM-facing authoring surface
  should be a Python dialect that stages into WK, as proposal-surface.md argues, not WK text.

## 9. What gets faster, and by how much

| Path | frame-with-tab (one chain) | 8 independent pockets | Source |
|---|---|---|---|
| today, JS target (FS `build()` / `buildPython`) | 12.5 to 13.9 s / 12.9 to 13.6 s | not measured (4 pockets: 11.2 to 11.3 s) | [M, check.json]; [O] spike, slice |
| binding slice, native kernel, interpreter in JS, 1 thread | 1.79 s end to end (6 threads: 1.19 s) | not measured | [O, slice.md] |
| **WK staged, native evaluator, 1 thread** | eval 1.50 to 1.81 s (process 1.51 to 1.84 s) | 2.45 to 3.50 s eval | [M, native.json] |
| **WK, 4 threads** | 0.99 to 1.00 s process | 0.62 to 0.65 s | [M] |
| **WK, 8 threads** | not measured | 0.32 to 0.39 s | [M] |
| WK, one-parameter edit with memo, 1 thread | 1.19 to 1.25 s (upstream reused) | | [M] |

Reading the table honestly:

- **Single chains gain nothing from WK beyond the binding.** frame-with-tab through WK is as fast as direct kernel
  calls, and within 15 % of the slice. The slice does real identity, audit and export work that my prototype skips,
  so that gap is not a WK advantage.
- **Parallel structure gains, if it exists.** Up to 6.6 to 10x at 8 threads on independent parts, on top of the
  kernel's native speed. That is the one gain the binding's serial re-entry cannot give.
- **How much independent heavy work is there in Marc's parts?** The staged corpus graphs have a heavy-op
  parallelism bound (heavy ops / heavy critical path, `when` arms counted exclusively) with a median of **3.0** for
  unique files and **2.8** for families (p90 11.6 / 19.7). 57 % / 59 % of graphs are at 2 or more [M, census]. The
  dataflow angle measured 2.7 [O]. These bounds assume equal op costs. Real costs are skewed: in r10b's executed
  prefix one curved intersection took 53 of 56 s [O, profile.md]. Expect less than the bound.
- **Incremental edits** save the upstream part of the graph: 19 % here. The dataflow angle measured 3.5 % of r10b's
  Booleans dirty after real parameter edits, and a median of 31 % of heavy ops dirty after a random literal edit
  over the corpus [O]. The saving is real, and it needs only the host-side cache, not WK in Bend.

## 10. Incremental path (every step ships on its own)

| Step | Content | Ships | Needs |
|---|---|---|---|
| 0 | Keep the bridge slice and step 1 (compat backend) first, and the Boolean/r10b kernel work | the measured 7.6 to 12.6x | nothing from WK |
| 1 | Land WK host-side: `ir.mjs`, canonical text, `stage-fs.mjs` as a **preflight** (`wonky --stage`: graph breaks, capability gaps, unsupported ops with spans, no kernel loaded) | a lint that finds all of r10b's gaps in one pass | the stager's store model reviewed; census as regression |
| 2 | Fix the semantic questions staging exposed: `try` handler visibility (§13), stale references, `qCreatedBy` prefixes (semantic-core §7), total Booleans in the kernel | fewer if-conversions, correct decorations | kernel and semantic-core owners |
| 3 | Make the facade's op records the WK op records (one design); add the missing pure std functions to `src/scalars.mjs` | one host↔kernel contract | the bridge's step 2 |
| 4 | One FS evaluator with two effect handlers: eager (today, over the facade) and staged (WK). Replace the interpreter only when the equivalence tests (examples, r10b trace) stay green, as semantic-core showed for WCore | graph + incremental cache in the interpreter | step 3 |
| 5 | Host-side content-hash cache over carriers in a resident session (viewer, watch mode) | incremental rebuilds | step 4 |
| 6 | `run_graph` in the binding: the WK evaluator (tree fork, memo) as a batched entry, planar subset first, JS-target twin as reference, `diff` mode | fork-join for multi-part files | pool-worker fail-stop fix; a real workload with W/S > 1.2 |
| 7 | Regions natively (`select`, `when`, `fold`, measures), as the facade gains queries and measures | fewer graph breaks per submission | kernel query/measure ops; decision on §5.6 |
| never, or after a study | new syntax; FS/Python evaluation in Bend; Bend-side parsing | | a measured LLM task study (H6) |

## 11. Risks, and what not to build

Risks:

1. **Graph size from if-conversion.** 12 % of feature graphs exceed 1,000 nodes, up to 11,118. The fix is kernel
   totality, simplification passes, or allowing graph breaks there. Blind whole-graph submission of such graphs
   would move host cost into the kernel for no gain.
2. **The stager is a second FS semantics until step 4.** It already caught four store-model bugs (union lineage, set
   union, robust queries, owners of symbolic sets) and one precedence bug, all through the census or tests. Only
   top-level planar graphs are checked for execution equivalence (11 examples). Regions are structurally checked,
   not executed.
3. **The numeric domain** (§5.6). Residual nodes are binary64 semantics. Any native evaluation of them needs soft
   binary64 or stays on the host.
4. **Bend runtime:** a fail-stop on a pool worker kills Node [O]. Fork-join must fork over pre-built data (§5.3).
   There is no library mode, and each evaluator change costs about 15 s and 3 to 5 GB.
5. **Identity.** Content hashes exclude ids, but today's kernel identity labels depend on ids. A cache must store
   geometry and apply identity separately, or cache hits carry wrong labels.
6. **build123d coverage** is bounded by the shim (1 of 294 files). WK does not help until the shim, or a WPy-style
   lazy dialect, grows.
7. **Timings are from a machine at load 12 to 29.** Ratios repeated within runs; absolute values vary by 10 to 40 %.

Do not build:

- a new human-facing syntax;
- an FS or Python interpreter in Bend (binary64 semantics, the 146k-line std, and a relink per change);
- a Bend-side parser;
- a general dynamic language in Bend (the spike's evaluator): a first-order graph is simpler, needs no fuel and
  builds in half the time;
- GPU paths for these workloads;
- native regions before the kernel has queries and measures on real B-reps;
- whole-graph submission as a goal in itself.

## 12. The angle's claims against the evidence

| Claim of the core-IR angle | Verdict | Evidence |
|---|---|---|
| FS and build123d stay the languages; JS frontends emit a core IR with spans | **Holds.** Staging is the existing FS evaluator with a symbolic kernel, and the shim with symbolic handles | H1 identical graph; 11/12 bit-identical replays; spans and ids on every node |
| One small core calculus is enough | **Holds for FS** at 92 % of stageable files, with about 40 node kinds, 6 of them regions | census |
| A Bend evaluator runs the IR natively with the kernel | **Holds for the planar subset**, bit-exact, with evaluator overhead within noise; regions are not native yet | native.json |
| So there is no host↔kernel synchronization at all | **Mostly.** 73 % / 60 % of all files, 92 % / 90 % of stageable ones. The rest break, cheaply. Zero sync matters only for parallelism and residency | census; binding 0.5 µs per call |
| This makes wonky fast | **No.** The kernel does. WK adds fork-join where parts are independent (6.6 to 10x on 8 synthetic parts; corpus bound median about 3) and incremental reuse (19 % on one edit) | §9 |
| A human surface syntax only later, if ever | **Agreed.** No evidence for one; strong evidence against a new syntax for LLMs | prior-art.md |

## 13. Findings for other stages

1. **WCore/0's `try` desugaring gives the handler the variables' values at `try` entry.** Probe:
   `var stage = "first"; try { stage = "second"; throw … } catch (e) { throw regenError(stage ~ ": " ~ e); }`.
   The interpreter says `second: inner`, which is FS semantics; semcore says `first: inner` [M,
   `tmp/lang/wk/probe-try.mjs`]. This is exactly Marc's error-decoration idiom (guide-r2's `stage` variable). WK's
   decorations inherit the bug: the template is evaluated once at try entry. The fix belongs in the desugarer: pass
   the current values of assigned variables to the handler at each throw point.
2. **`addInstance` returns the instance's query, and the instance id is `instantiator id + name`** (std
   `instantiator.fs`). Marc's generated files depend on this (`var all = addInstance(...)`).
3. **`makeRobustQuery` must snapshot** (FsDoc). Lazy resolution changes results after later operations.
4. **Signed zero** in extrusion origins is harmless today only because of the +0 start offset in `extrudeInBend`.
   If the facade drops that translate, the rule must move with it.
5. **Marc's generated total-Boolean helpers** are the largest source of graph size and staging time. A total Boolean
   in the kernel, plus dropping the guards in his generators, removes both.
6. **Bend fork-join:** fork over pre-built data (§5.3).

## 14. Limits of this study

- Native evaluation covers only the planar subset: polygon extrusion along +Z, union, subtract, volume, faces and
  two checks. No imports, sketches, frustums or regions run natively.
- Execution equivalence is shown for 11 runnable examples on the JS target and for frame-with-tab and pockets
  natively. The corpus results are *staging* results: they show that a graph exists and what it contains, not that
  it executes correctly.
- build123d staging uses today's shim. No dynamic build123d coverage number is given.
- The if-conversion and store model are prototype quality. Node counts would shrink with simplification passes; the
  dataflow tracer's r10b graph has 2,037 nodes against my 5,412.
- Four-pocket timings are noisy under load. Eight-pocket speedups are relative to loaded 1-thread runs.
- LLM effects (H6) and GPU are not measured.

## 15. Artifacts

- Code: `src/lang/wk/`, `kernel/lang/wk/main.bend`, `kernel/lang/wk/cases/`, `scripts/lang/wk-*.mjs`,
  `test/lang-wk.test.mjs`.
- Results: `out/lang/wk/census.json` (corpus staging, per file and feature), `out/lang/wk/check.json` (JS-target
  equivalence), `out/lang/wk/native.json` (native runs), `out/lang/wk/examples/*.wk.txt` and `summary.json`
  (canonical texts, r10b), `out/lang/wk/build/builds.json` (compile cost), `out/lang/wk/build/wk-native` (binary).
- Scratch: `tmp/lang/wk/` (session files, probes).
