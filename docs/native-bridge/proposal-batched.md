# Native bridge proposal: batched and parallel

Date: 2026-09-22. Apple M5 Pro (18 logical CPUs), macOS arm64, Node v22.23.1, Bend 2.0.25.
Angle of this proposal: the same in-process binding as the other stages, but the interpreter **records**
kernel operations between true synchronization points and submits whole subgraphs per call. Native Bend
evaluates independent branches with fork-join and routes uniform batches to Metal; parameter sweeps and
configuration variants go through the same path.

Inputs: [profile.md](profile.md), [surface.md](surface.md), [binding.md](binding.md), [baseline.md](baseline.md)
and their artifacts. The one new measurement is the sync-point trace below
(`scripts/native-bridge/sync-trace.mjs` → `out/native-bridge/batched/sync-trace.json`). It ran at load average 11.5 to
15.1 on the shared machine; its milliseconds are indicative, its counts and dependency structure are exact.

## 0. Verdict first

1. **Mechanism: in-process.** binding.md showed Bend-emitted C running inside Node as a plain N-API addon,
   bit-exact with the JS target, 0.5 µs per empty call. Nothing here needs an out-of-process service. Batching
   actually makes the baseline service *cheap* as an optional isolation layer (one round trip per flush instead of
   thousands of calls), which matters for the one hard limit that remains (pool-worker fail-stop, §7).
2. **Sync points, measured.** A *speculative* recorder needs exactly **one flush per build** in every measured
   run. That covers the seven profiled workloads that complete, r10b under both policies up to its known stops, and
   the 8 of 9 r10b subassemblies that record any operation (1,577 operations). Not one of these runs reads geometry to steer control flow. A *conservative*
   recorder that treats every `try` as a barrier is nearly useless on r10b: 79 % of its operations run inside `try`
   (every helper wraps its ops), and TrayArms would still need 674 flushes for 1,066 ops.
3. **Gain on the eight profiled workloads: none measurable from batching.** Every one of them is a single dependent
   chain. Inter-op parallelism W/S (total kernel time over the critical path) is 1.0000 to 1.0010 for all Boolean
   workloads and 1.056 for bored-spacer's 17 ms of kernel. Batching changes their end-to-end time by at most
   0.18 %. Their gain (6.9x to 12.3x, §5) comes entirely from the base binding: native kernel k and **not loading the
   JS kernel**.
4. **Where batching can pay.** (a) r10b-scale programs: the tolerated-policy r10b prefix contains two independent
   curved intersections (`g2` 87.0 s, `g4` 134.7 s on the JS target), so W/S = **1.86**. The recorded whole
   program has 357 Booleans with a longest Boolean chain of 42, an op-count bound of 8.5x (cost-unweighted).
   (b) sweeps and configuration variants: N independent components, plus content-addressed dedup (5 of 9 r10b
   subassemblies read no feature parameter). (c) a record-only pass as an admission lint: it found three host-side
   r10b blockers in under 0.3 s each, without running the kernel.
5. **What stands in the way.** The only measured inter-op win (`g2 ∥ g4`) is on the curved path, which Bend 2.0.25
   cannot emit as C today ("an arity over 255", surface.md). Batching puts more work on pool workers, where a
   fail-stop kills Node. There is no cancellation, so work after the first failure is wasted.
6. **Recommendation.** Build batching as a *policy layer* on top of the coarse handle API from surface.md, not as a
   separate binding. Ship it after native eager works, opt-in (`--batch`) until the differential suite is green on
   both policies. Its first user-visible feature should be sweeps/variants and the record-only lint. Metal stays off
   by default; no measured workload has a uniform batch that qualifies.

## 1. Evidence: how often real models hit sync points

### 1.1 How FeatureScript can observe the kernel at all

Every modeling builtin (`opExtrude`, `opBoolean`, `opPattern`, `fCuboid`, `opLoft`, `skSolve`, `instantiate`) returns
`undefined` to FeatureScript. Queries (`qCreatedBy`, `qUnion`, `qOwnedByBody`, ...) are symbolic until evaluated.
The complete list of channels through which a kernel result can reach FeatureScript control flow is:

| channel | needs | recorder treatment |
|---|---|---|
| `evaluateQuery` over bodies | which records exist: lineage plus **result counts** of Booleans | predicted (one body per Boolean), verified at flush |
| `evaluateQuery` over `qOwnedByBody` edges/faces | topology of the result | **hard sync** |
| `getProperty` NAME/APPEARANCE | record metadata | no sync (metadata moves onto the record, §4) |
| `evVolume`, `evBox3d`, `evLine` | geometry | **hard sync** |
| catchable error (`fail()`, audit failure) inside `try` / `try silent` | success of the op | speculated; replay on failure (§2.5) |
| capability error (`UnsupportedFeatureError`) | success of the op | not catchable, so no sync; report at flush in program order |

The Python shim is already handle-based (`src/python.mjs` returns `shape-N`). Only `volume` and error responses carry
kernel results back to Python.

Host code also reads geometry *inside* builtins. Today these are invisible, but with lazy records each would silently
force a flush per op:

- `src/boolean.mjs:38-107`: Boolean branch selection reads primitives and face and curve types of both operands.
- `src/queries.mjs:144-146` (opPattern): picks `transformAnalytic` or `transformInBend` by `body.geometry`, and names
  the result by `body.id`.
- `src/library.mjs:71`: the 128-body limit counts `this.bodies` (`:45`), which maps every `record.body`.
- `src/library.mjs:268` and `src/queries.mjs:88`: `name`/`appearance` live on the body object.
- `src/source-map.mjs:48,55`: the model trace diffs `engine.bodies` before and after **every** geometric builtin.
- `src/modules.mjs:88`: `instantiate` materializes the frozen import through the `record.body` getter.

§4 lists how each moves (into Bend ops, or onto record metadata).

### 1.2 Method

`scripts/native-bridge/sync-trace.mjs` runs each workload in its own process. It patches prototypes
(`ModelingContext.builtins`, `Interpreter.statement/expression`) and wraps the shared `loadKernel()` object in place;
nothing under `src/`, `kernel/` or `bin/` is edited. Per modeling builtin, in program order, it records:

- kernel ms charged to the builtin;
- the earlier operations whose bodies or sketches it consumes (dataflow by object identity);
- `try` depth;
- reads, and whether they need geometry;
- errors, and whether they are catchable;
- for Booleans, the actual number of result bodies.

Python requests are delimited by their response writes.

Two modes:

- **eager** is the production path with the real JS-target kernel.
- **record** replaces kernel-backed builtins with bookkeeping-only stand-ins. These predict one body per Boolean;
  host checks that need no geometry still run. A geometry read would be fabricated and everything after it flagged
  estimated; this never happened. Only in this mode, `opRevolve` and `opFillet` (not implemented in wonky) get
  stand-ins flagged *hypothetical*, so the rest of r10b becomes visible. `opFillet` was never reached.

The parent replays each event list under three flush policies:

- **eager** is today's behavior: every kernel-backed op completes before the interpreter continues.
- **conservative** flushes:
  - when a read touches a pending body and depends on a Boolean result count or on geometry;
  - when a `try` block that issued ops closes;
  - before an op whose host admission depends on a pending Boolean's result count;
  - at the end.
- **speculative** flushes only for geometry reads of pending bodies, and at the end. It counts Boolean
  mispredictions and catchable errors inside `try` as replays.

`test/native-bridge-batched.test.mjs` (4 tests) locks these semantics.

### 1.3 The measured workloads

Funnel from today's host-to-kernel calls (profile), through coarse API calls (surface), to recorded modeling operations
and flushes (this trace). W is total kernel ms of the build phase; S is the critical path through the dataflow
(JS-target ms, from the eager trace).

| workload | host→kernel calls today | coarse API calls | modeling ops (kernel-backed) | geometry reads | ops inside `try` | flushes eager / conservative / speculative | W ms | S ms | W/S | load |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---|
| fs-bracket | 5 | 1 | 2 (1) | 0 | 0 | 1 / 1 / 1 | 2.2 | 2.2 | 1.000 | 15.1 |
| fs-bored-spacer-print | 96 | 5 | 5 (3) | 0 | 0 | 3 / 1 / 1 | 17.3 | 16.4 | 1.056 | 15.0 |
| fs-fuse-g1 | 202 | 3 | 4 (3) | 0 | 0 | 3 / 1 / 1 | 1463 | 1463 | 1.001 | 15.0 |
| fs-cut-h1 | 422 | 3 | 4 (3) | 0 | 0 | 3 / 1 / 1 | 5801 | 5799 | 1.000 | 14.6-14.7 |
| py-planar-union | 253 | 4 | 4 (4) | 0 | 0 | 4 / 1 / 1 | 1749 | 1747 | 1.001 | 14.2 |
| py-planar-pocket | 413 | 4 | 4 (4) | 0 | 0 | 4 / 1 / 1 | 3384 | 3382 | 1.000 | 14.2 |
| py-frame-with-tab | 839 | 7 | 7 (7) | 0 | 0 | 7 / 2 / 1 | 13892 | 13889 | 1.000 | 14.2-15.1 |
| fs-r10b-strict (exit 1, known stop) | 18,604 | 7 | 7 (6) | 0 | 6 | 6 / 5 / 1 | 54180 | 54178 | 1.000 | 14.7-14.2 |
| fs-r10b-tolerated (exit 1 at `g10`) | – | – | 27 (21) | 0 | 21 | 21 / 21 / 1 | 250826 | 134742 | **1.862** | 11.5-13.3 |

- Bored-spacer's export phase (STEP pcurves, print mesh, 29 ms of kernel per the profile) comes after the final flush
  and is not in W.
- All 11 Boolean results in the eager runs had exactly one body: the prediction held 11 of 11 times. No catchable
  error occurred. The two capability errors (r10b strict `g2`, tolerated `g10`) are uncatchable, so no replay is needed.
- The Boolean workloads are single chains. frame-with-tab is `box, box, translate, subtract, box, translate, union`,
  and `union` consumes `subtract`, so the 2.8 s subtract and the 11.0 s union cannot overlap.
- **r10b tolerated prefix** (the acceptance policy, `--curved-contacts tolerated-regularized --contact-cap-mm 1e-7`):

  | op | inputs | JS kernel ms |
  |---|---|---:|
  | `instantiate` (frozen imports) | – | 54 |
  | `g0` copy | import | 10 |
  | `g2` = `g0` ∩ `g1` (curved) | `g0`, `g1` | 86,966 |
  | `g4` = `g0` ∩ `g3` (curved) | `g0`, `g3` | 134,666 |
  | `g7` union (planar) | `g5`, `g6` | 4,467 |
  | `g9` union (planar) | `g7`, `g8` | 24,617 |
  | `g10` union | `g9`, `g2` | refused at host admission |

  `g2`, `g4` and `g7 → g9` are mutually independent. Dataflow scheduling gives S = 134.7 s against W = 250.8 s. A
  level-synchronous (wave) scheduler would put `g2`, `g4` and `g7` in one wave and `g9` two waves later:
  134.7 s + 3 ms + 24.6 s = 159.3 s, so W/S = 1.57. That is the reason for the series-parallel plan in §2.3.

### 1.4 r10b as a whole program (record mode)

r10b exports its nine subassemblies as separate features, traced one by one (record mode, 45 to 261 ms each, load
13.0). Booleans and Boolean span count Booleans only; clones are `opPattern` identity copies made by the `combine`/`cut`
helpers.

| subassembly | status | ops | ops in `try` | Booleans | longest Boolean chain | components | clones | conservative flushes | speculative flushes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| UpperCore | ok | 77 | 66 (86 %) | 16 | 10 | 1 | 23 | 55 | 1 |
| LowerCore | ok | 97 | 86 (89 %) | 21 | 10 | 1 | 37 | 74 | 1 |
| Carriage | ok | 74 | 63 (85 %) | 16 | 9 | 1 | 27 | 54 | 1 |
| SideDrive | host error at `g0` | 0 | – | – | – | – | – | – | – |
| Frames | host error at `g512` | 12 | 10 | 2 | 2 | 2 | 4 | 8 | 1 |
| TrayArms | host error (line 590) | 1,066 | 838 (79 %) | 246 | 42 | 14 | 284 | 674 | 1 |
| CameraSupports | ok | 209 | 144 (69 %) | 48 | 9 | 5 | 56 | 120 | 1 |
| TransferEdge | ok | 38 | 34 (89 %) | 8 | 7 | 1 | 12 | 28 | 1 |
| RetainedContext | ok | 4 | 2 | 0 | 0 | 2 | 0 | 2 | 1 |
| **sum / max** | | **1,577** | **1,243 (79 %)** | **357** | **42** | | **443** | **1,015** | **1 each** |

- **Zero geometry reads** in 1,577 operations. `roundX`/`filletXWindow` (the only r10b helpers that enumerate edges and
  call `evLine`/`evBox3d`) are never reached, and `finish()`'s `size(evaluateQuery(...)) != 1` branch is a
  count-dependent read the prediction satisfies. With the speculative recorder, **all of r10b is one flush**, as far
  as the program can currently be followed.
- Structure inside a subassembly: a wide first level of independent Booleans (M3 relief unions, the P10
  intersections), then a left-deep join/cut chain. Across subassemblies there are no data dependencies: in the
  `singleStepR10b` record, UpperCore, LowerCore and Carriage form three components with a combined chain of 10.
  CameraSupports is five near-identical components of about 10 Booleans each.
- Op-count bound: 357 Booleans over a longest chain of 42 is **≤ 8.5x** if every Boolean cost the same. They do not:
  the tolerated prefix shows 4.5 s to 134.7 s per Boolean on the JS target. The cost-weighted bound is unknown until
  the kernel runs past `g10`.
- **Side finding:** record mode reached three host-side input rejections that eager runs never get to, because the
  kernel stops first. SideDrive `g0` and TrayArms line 590 fail with "Profile has collinear or nearly collinear
  consecutive edges" (`src/brep.mjs:36`); Frames `g512` fails with "A profile must have 3–256 vertices". They do not
  depend on any kernel result. They are later r10b blockers and belong to whoever owns `validatePolygon`; this stage
  did not touch them.

### 1.5 What the evidence says about the angle

- Sync points are rare in real models, but only if (1) the recorder speculates on Boolean result counts and
  catchable errors, and (2) host admission logic moves into Bend. Without speculation, `try` alone makes batching
  pointless for r10b.
- Batching per se (fewer crossings) is worth microseconds: 1.3 ms per run at most even today (profile). The value is in
  *what the kernel can do with a whole graph*: parallel independent branches, dedup, one plan for Metal. On the
  current test models that value is zero. It appears only on r10b-scale programs, which cannot run natively yet (§13).

## 2. Architecture

```
FeatureScript interpreter (JS) ──┐                     build123d shim (Python) ── src/python.mjs
                                 ▼                                                   │
        ModelingContext: records = metadata + NodeRef (lazy view)   ◄────────────────┘
                                 │  op(opcode, args, source)            read(ref) forces flush
                                 ▼
        KernelSession (src/native/session.mjs)
          policy eager | batch;  Recorder → Graph;  Planner (components, series-parallel plan);
          Dedup (content hash);  Replay (deterministic re-interpretation with result cache)
                                 │  submit(Uint32Array) → Uint32Array    drop(handles)
                                 ▼
        KernelBackend (one interface)
          ├─ native     wonky-kernel.node (N-API) → kernel/service/graph.bend + api.bend (ARM64 pool, optional Metal)
          ├─ reference  the same graph.bend + api.bend compiled to JS by the Bend JS target (lazy-loaded)
          └─ differential  runs both, compares reply words bit for bit
```

### 2.1 Records become lazy

A record keeps what the host legitimately owns: key, kind, lineage (`createdBy`), op id, name, appearance, source
location, and a `NodeRef` (batch node plus output index, later a resident handle). `record.body` becomes a getter that
returns the decoded *view* and forces a flush when the node is still pending. This is the safety property of the
design: **any host code that touches geometry synchronizes automatically.** The only speculation left is the number
of records a Boolean creates. Everything that must not flush (the body limit, names, trace bookkeeping) reads record
metadata instead of `record.body` (§4).

### 2.2 Recorder

In batch policy each kernel builtin performs its host-only checks exactly as today, then calls
`session.op(opcode, args, source)`:

- host checks: `fieldMap`, `claim` (duplicate ids, the 20,000 op limit), `validatePolygon`, orientation by
  `signedArea`, tool counts on *predicted* records;
- `args` are wire words for inline parameters and `NodeRef`s for bodies and profiles;
- `source` holds the location and the FeatureScript call stack.

The session appends a node and returns refs for the predicted outputs: 1 for extrude/loft/cuboid/import/transform,
**1 for Boolean (predicted)**, 1 per instance for `instantiate`. The interpreter continues. A read of a pending node,
a host error, or the end of `build()` flushes.

**Error-triggered flush.** If a host-side check throws while ops are pending, the session flushes first, because an
earlier pending op might fail. The earliest failure in program order wins. On r10b this matters: SideDrive's host error
(recorded later) must not mask UpperCore `g2`'s capability error (earlier).

### 2.3 Planner and native evaluation

The planner runs in JS, on graphs of at most a few thousand nodes; the trace script already does this work.

1. Nodes whose inputs are all resident (earlier flushes, imports) are roots. The batch splits into **weakly connected
   components**. r10b gives one component per subassembly, more for TrayArms (14) and CameraSupports (5).
2. Each component becomes a **series-parallel plan**: `Leaf(node)`, `Seq(a, b)`, `Par(a, b)`. For a sink, the ancestor
   sets of its inputs are compared. Shared ancestors are scheduled first (`Seq`), then the disjoint remainders run as
   `Par`. For the tolerated prefix this yields `Seq(g0, Par(g2-chain, g4-chain, g7→g9))`, exactly the dataflow span
   (134.7 s), not the wave schedule's 159.3 s. A general DAG may lose some parallelism here; the plan is never worse
   than sequential.
3. The plan crosses the boundary with the graph. `graph.bend` interprets it: `Par` is Bend fork-join
   (`let a b = run(x) run(y)`, a balanced tree for n-ary groups), `Seq` threads a register file (a list of Body
   values, shared by reference count with `+`), `Leaf` dispatches to one `api.bend` operation.

The graph is **never rewritten**: no reassociation of Boolean chains, no algebraic shortcuts. Even an identity
transform runs, because `-0 + 0 = +0` changes bits. The only transformation is dedup of *identical* nodes.

**Dedup (hash-consing).** Node hash = sha256(opcode, inline words, input hashes, import blob hashes). Identical hashes
within a batch, or against the session's resident results, collapse to one node. Bend is pure, so this is bit-exact by
construction. It is what makes configuration variants cheap (§2.6).

**Views.** The reply carries a small summary for every node: status, output count, identity triple, counts. Full views
(vertices, edges, faces, validation, evidence) come only for outputs the host still references at flush time. In
r10b, 443 clones and most chain intermediates are consumed and deleted, so they never need a full view.

### 2.4 Handles and residency

Outputs the host keeps become resident handles in the native heap: the C handle table from binding.md, with linear
consumption, `dup` for sharing, and `BX_HANDLE` on stale use. The reference backend keeps the same numbering in a JS
`Map`. `build()` releases every handle at its end, except those retained by a resident session (viewer, review server,
sweep). This is surface.md's handle API; batching only changes *when* handles are created.

### 2.5 Replay: how speculation stays exact

The FeatureScript interpreter is deterministic: no time, no randomness, no I/O inside a feature, and `Map` iteration is
insertion-ordered. When a flush reveals a **misprediction** (a Boolean with 0 or ≥ 2 bodies) or a **catchable error**,
the session discards the recorded state and re-runs the feature from the start in **eager policy**, with the flush's
results as a cache keyed by node hash:

- ops before the divergence hit the cache, so no kernel work repeats;
- at the divergent op, the real count or error is used inline, so `try`/catch runs exactly as eager;
- the rest runs eagerly, or re-enters batch policy after the divergence point.

The replay checks that the op stream matches the recording up to the divergence. A mismatch is a `NativeKernelError`
(an interpreter bug), never silently tolerated. Cost: re-interpretation, at most 0.7 % of any profiled run (profile.md),
plus the wasted speculative work after the divergence. Observed rate on the traced runs: 0 replays in 11 Booleans and
0 catchable errors.

### 2.6 Sweeps and configuration variants

`build(source, { feature, variants: [{ thickness: '6 * millimeter' }, ...] })` parses once and interprets each variant
with its own `ModelingContext`, in record policy. Recording needs no kernel, so variants can be recorded on
`worker_threads` in parallel. The graphs are merged, deduped and submitted as **one** flush: components are variants
minus shared subgraphs. Replies are split per variant. Each variant reports its own status; a failing variant produces
no artifacts, and the sweep exits non-zero if any variant failed (AGENTS.md: no incomplete model reported as success).
CLI: `wonky model.fs --sweep thickness=4mm,6mm,8mm [--sweep ...] --out dir`, a Cartesian product with a manifest.

Grounding for dedup: in r10b only TransferEdge, Frames, TrayArms and RetainedContext read `definition.*` (static scan
of `buildX` functions). UpperCore, LowerCore, Carriage, SideDrive and CameraSupports do not. An `edgeAngle` variant
changes TransferEdge (38 ops) and RetainedContext (4 ops) and shares the other 1,535 of 1,577 recorded ops. A
`catchPitch` variant re-runs TrayArms, the largest part.

## 3. API

### 3.1 JS-facing (library and CLI)

```js
// src/index.mjs, src/python.mjs (existing entry points, new options)
build(source, { feature, parameters, variants?, backend?: 'native'|'reference'|'differential',
                threads?: number, policy?: 'eager'|'batch', gpu?: 'off'|'auto', isolate?: boolean })
  -> model | { variants: [{ parameters, status, model?, error? }] }
buildPython(source, { ..., backend, threads, policy })   // policy 'batch' only if the source has no try/except (§7)
```

CLI flags on `bin/wonky.mjs` and `bin/wonky-python.mjs`: `--backend`, `--threads N`, `--batch`, `--sweep k=v1,v2`,
`--gpu off|auto`, `--isolate`, `--record-only` (admission lint: record, never evaluate, report what would run). The
defaults come from `WONKY_BACKEND` / `WONKY_POLICY`, so tests switch backends without code changes. `brep.json` gains
`backend: { target: 'native-arm64'|'native-metal'|'javascript', apiHash, buildHash, threads, policy, flushes, replays }`.

### 3.2 Session (internal, `src/native/session.mjs`)

```js
openKernel({ backend, threads, gpu, policy, isolate }) -> KernelSession   // loads exactly one backend
session.op(opcode, args, source)  -> NodeRef[]        // record (batch) or execute (eager)
session.view(ref)                 -> View             // forces flush if pending
session.flush(reason)             -> FlushReport      // { nodes, components, planSpanEstimate, ms, replayed }
session.retain(ref) / session.release(refs)
session.hash(ref)                 -> string           // dedup key
session.close()
```

### 3.3 Backend interface (both backends)

```js
interface KernelBackend {
  id: 'native-arm64' | 'native-metal' | 'reference-js';
  abi: { version: 1, apiHash: string, buildHash: string };
  submit(request: Uint32Array): Uint32Array;   // one graph, synchronous
  drop(handles: Uint32Array): void;
  reset(): void;                                // after a BX_FAILSTOP on the calling thread
  stats(): { handles, heapBytes, threads, gpu };
}
```

Native counterpart: the addon from binding.md, reduced to `init({threads, gpu, gpuMB})`, `abi()`, `submit(Uint32Array)`,
`drop(Uint32Array)`, `reset()`, `stats()`. It is implemented with the direct-call path (`corpus_eval` on
`FID_SUBMIT`). The Bend entry has to respect the binding constraints: a def reachable from `main`, and only
`List`-boxed data crosses, so non-recursive ADTs are never split into slots:

```
# kernel/service/graph.bend
def submit(req: List<U32>, held: List<A.Body>) -> List<Out>
type Out is Data:
  Words{w: List<U32>}        # reply words, appended in order
  Keep{b: A.Body}            # becomes handle n (n = running index); the reply refers to it by n
```

The C driver moves handle terms referenced by the request into `held` (`dup` when the request keeps them, consume when
it releases them), evaluates, appends `Words` to the reply buffer and registers `Keep` terms in the handle table. The
reference backend runs the **same** `submit` def compiled to JS. Its `Par` is sequential, since the JS target is
sequential.

### 3.4 Wire layout (little-endian U32, codecs generated by `gen-wire.mjs`)

Request:

| words | content |
|---|---|
| 0 | magic `0x4757_4B57` ("WKWG") |
| 1 | ABI version (1) |
| 2-5 | apiHash, first 128 bits (the C driver rejects a mismatch before Bend sees the request) |
| 6 | flags: bits 0-1 view policy, bits 2-3 GPU policy, bits 8-15 thread hint |
| 7, 8, 9 | node count N, held count H, plan word count P |
| … | H handle numbers (consumed by the C driver, not passed to Bend as words) |
| … | N nodes: `opcode`, `retain` (bit 0 keep handle, bit 1 full view), `argc`, then per argument a kind word and payload: 0 = node ref (`index`, `output`), 1 = held (`index`), 2 = inline (`count`, words in the op's generated parameter codec) |
| … | plan in preorder: 0 = `Leaf(node)`, 1 = `Seq(n, …)`, 2 = `Par(n, …)`, 3 = `Gpu(opcode, n, leaves…)` |

Reply: magic "WKWR", ABI version, status (0 ok, 1 malformed, 2 ABI mismatch, 3 unknown op), N. Then per node:

- node status: 0 ok, 1 refused (capability), 2 failed (catchable), 3 poisoned (an input failed), 4 skipped;
- if ok: output count, and per output the handle number (or `0xFFFFFFFF` if not kept), the summary words and the view
  words;
- if refused or failed: `code`, `stage`, and detail words;
- in every case: evidence words (stats, audits, budgets as Real words).

Every `Real` is exactly two words `bits(hi), bits(lo)`, every F32 its bit pattern (surface.md §7).

### 3.5 Versioning

- **ABI version**: bumps on any change to the header or record layout above.
- **apiHash**: sha256 over the generated wire manifest (opcodes, ADT constructor tags and field layouts). The
  generated JS codec module and the addon both embed it; `openKernel` compares them before the first submit.
- **buildHash**: sha256 over every build input (§10). The addon exports it; the loader recomputes it from the
  sources on disk. Any mismatch is a `NativeKernelError` naming the changed files. It never falls back to the reference
  backend.

## 4. What changes in `src/` and `kernel/`

`src/` (the interpreter, parser, values, queries over views, Python bridge and writers stay JS):

| file | change |
|---|---|
| `src/native/session.mjs` (new) | recorder, planner, dedup, flush, replay, handle lifetime, flush evidence |
| `src/native/backends.mjs` (new) | `openBackend(kind)`: native (hash-checked `require` of the addon), reference (lazy `loadBend` of `kernel/service/graph.bend`), differential |
| `src/native/generated/` (new, generated only) | opcodes, codecs, apiHash from `gen-wire.mjs`; a CI check fails if stale |
| `src/library.mjs` | op builtins call `session.op`; records split into metadata plus `NodeRef`; body limit (`:71`) counts records; name/appearance copied between records, not bodies (`:268`) |
| `src/queries.mjs` | `getProperty` (`:88`) and `setProperty` (`:98`) use record metadata; `opPattern` (`:144-146`) records `transform` without reading the body; `evVolume`/`evBox3d`/`evLine`/owned enumeration read `record.body` (the flush) |
| `src/modules.mjs` | `instantiate` records one `import_brep` node per part (replacing r10b's 18,604 small calls); no eager materialization (`:88`) |
| `src/boolean.mjs`, `analytic.mjs`, `kernel.mjs`, `planar-boolean.mjs`, `curved-intersection.mjs`, `face-classification.mjs`, `identity.mjs` | shrink to view decoders and message tables (e.g. `PIERCE_DECLINES`); branch selection (`boolean.mjs:38-107`), `classificationInput`, residual admission and identity move into `api.bend` |
| `src/source-map.mjs` | trace outputs by record key and `NodeRef`; identity filled in at flush (today `:48,55` diff `engine.bodies`, which would flush every op) |
| `src/python.mjs` | `shapeSession` returns node refs as handles; `volume` and completion flush; batch policy only for sources without `try` |
| `src/index.mjs` | session lifecycle, variants, backend metadata, release at end |
| `src/exporters.mjs` | STEP pcurves through a session op, loaded lazily (today about 110 ms per CLI start, profile.md) |

`kernel/` (no existing algorithm changes):

| file | content |
|---|---|
| `kernel/service/api.bend` (new) | the 16 coarse ops of surface.md over a resident `Body` ADT (`Polyhedral` / `Analytic`, primitive, measures), including Boolean branch selection, admission and folded identity |
| `kernel/service/graph.bend` (new) | request decode, plan interpreter (`Seq`/`Par` fork-join), node status and poisoning, reply encode |
| `kernel/service/generated/wire.bend` (new, generated) | codecs from `gen-wire.mjs` |
| `kernel/service/gpu.bend` (later) | `!` batch entries for eligible op kinds (§9) |

Prerequisite outside this proposal: the r10b curved path (`ports/curved-intersection` → `ports/curved:clip` →
`section:section`) must become emittable as C ("an arity over 255"), by a kernel refactor or an upstream Bend fix.

Scripts and tests: `scripts/native-bridge/build-kernel.mjs` (§10), `scripts/native-bridge/sync-trace.mjs` (this stage),
`test/native-bridge-session.test.mjs` (policy semantics on small FS snippets, both backends),
`test/native-bridge-batched.test.mjs` (this stage).

## 5. Expected end-to-end speedups (arithmetic)

**Base binding (native eager, JS kernel not loaded).** Inputs are the profile's attributed values: T is the
profiled run, K kernel plus the GC it causes, B the Bend JS load, and rest = T − K − B. `rest` is what stays in JS:
Node start, the ESM graph, frontend, host adaptation, export and the Python subprocess wait.

T′ = rest + K/k + L + O, where:

- k is the **measured in-process** native/JS ratio of the dominant calls (binding.md `kernel-t1`/`kernel-t6`: every
  call bit-exact). It is applied to all of K, an assumption covering the remaining 2.2 to 4.3 % of kernel calls.
- L = 0.97 ms is the addon load plus init, warm. It is 287 ms on the first load after a rebuild.
- O is the profile's crossing estimate, at most 1.27 ms.

| workload | T ms | K ms | B ms | rest ms | k (1 thread) | T′ ms | speedup | k (6 threads, intra-op) | speedup | first load after rebuild |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| py-planar-union | 3152 | 2209 | 779 | 164.0 | 9.72 measured | 392.6 | **8.03x** | 14.54 | 9.94x | 4.64x |
| py-planar-pocket | 4597 | 3678 | 782 | 137.0 | 9.18 measured | 539.4 | **8.52x** | 14.35 | 11.64x | 5.57x |
| py-frame-with-tab | 15471 | 14508 | 806 | 157.0 | 8.52 measured | 1862.7 | **8.31x** | 13.25 | 12.34x | 7.20x |
| fs-fuse-g1 | 2680 | 1811 | 760 | 109.0 | 8.52–9.72 assumed | 322.8–296.6 | **8.30–9.04x** | – | – | 4.40x |
| fs-cut-h1 | 6764 | 5914 | 745 | 105.0 | 8.52–9.72 assumed | 800.7–715.0 | **8.45–9.46x** | – | – | 6.22x |
| fs-bracket | 900 | 2.5 | 783 | 114.5 | irrelevant | 115.8 | **7.77x** | – | – | 2.24x |
| fs-bored-spacer-print | 910 | 38.4 | 745 | 126.6 | 8.52–9.72 assumed | 132.2–131.7 | **6.88–6.91x** | – | – | 2.18x |
| fs-r10b-strict | 56111 | 55116 | 755 | – | not buildable natively (arity > 255) | – | – | – | – | – |

Worked example, frame-with-tab: 157.0 + 14508/8.52 + 0.97 + 1.27 = 157.0 + 1702.8 + 2.2 = 1862.0 ms, and
15471/1862 = 8.31x. With 6 threads: 157.0 + 14508/13.25 + 2.2 = 1254.2 ms, so 12.34x.

"Assumed" rows use the lowest and highest measured planar k; fuse-g1 and cut-h1 run the same planar ports but were not
run natively. The 6-thread k is *intra-op* parallelism measured in-process (1.5 to 1.7x over 1 thread). It is part
of the base binding, not of batching. The first-load column uses L = 287 ms (macOS checks a freshly written binary
once).

**Batching increment.** Batched T″ = rest + K/(k·W/S) + L + O′, with O′ ≤ O. The increment is K/k · (1 − S/W):

- planar-union: 227.3 ms × (1 − 1/1.0010) = 0.23 ms of 392.6 ms, or **+0.06 %**;
- bored-spacer (the largest W/S): 4.3 ms × (1 − 1/1.056) = 0.23 ms of 132 ms, or **+0.18 %**;
- every other workload: +0.00 to +0.04 %.

Crossings saved (3 to 6 per run at 0.5 to 1.5 µs) are below 0.01 ms. **Batching does not change any measured
workload's speedup.**

**Where it would show (projections, not measurements):**

- *r10b tolerated prefix*, once the curved path is native. The kernel part shrinks by W/S = 1.86 (250.8 s → 134.7 s
  on the JS-target scale), provided the curved intersection's native k is similar for both calls and the lanes are
  not saturated by intra-op work. Its native k is unknown; no curved kernel runs natively today.
- *Whole r10b.* The op-count bound is 357/42 = 8.5x, capped at 18 lanes. It is cost-unweighted, and the one measured
  prefix shows per-Boolean costs spanning 30x.
- *Sweep of 18 frame-with-tab variants.* Native eager: 18 × 1.54 s (measured in-process kernel per variant)
  + 18 × about 80 ms host = 29.2 s. Batched: 27.7 s / p + 1.4 s. The only measured inter-op scaling for independent
  Booleans is the through-hole batch at 18 threads, p = 10.1 (hardware-performance.md, a different workload).
  With that p: about 4.2 s, 7x over native eager and about 60x over today's JS (≈ 0.9 s + 18 × 14.6 s ≈ 264 s).
  The planar kernel's memory-bandwidth scaling is unmeasured.
- *Sweep of 100 bracket variants.* Host-bound. Per variant: interpreter 3.75 + host adaptation 2.3 + export 5.4 ms
  (profile) against about 0.3 ms native kernel, so ≈ 1.3 s against ≈ 2.3 s in JS today (1.8x). Batching cannot help
  here; parallel recording and export on `worker_threads` could, and that is JS parallelism, not native.
- *Resident session* (viewer, review server): startup paid once. The profile's D-bound approaches k: planar-union
  U = 2286 ms → 2286 − 2209 + 227.3 = 304.3 ms, 7.5x.

## 6. Exactness

1. **Scalars.** F32 crosses as its U32 bit pattern and `Real` as exactly two words, never through a JS double. -0,
   subnormals (no flush-to-zero), infinities and F32x2 pairs round-trip exactly: 695 real values (surface.md) and
   4,096 pair words (binding.md). NaN payload bits are not canonical (clang folds `x*1.0`), so comparisons treat NaN as
   a class, or the kernel canonicalizes.
2. **`nativeChainExact: false` is fixed by residency, on both backends.** The cause is the host round trip
   `number() → real()` (`src/real.mjs:9`, `src/analytic.mjs:132`). Handles remove it: bodies never leave Bend between
   ops, and views are decoded once and never re-encoded. The reference backend runs the same `graph.bend` with the
   same handle semantics, so JS and native stay comparable word for word. This **changes the last bits of multi-op
   models relative to today**: 131 of 9,784 captured result reals change under the old round trip. Golden files get
   a single, explicit, reviewed re-baseline step, never an incidental one.
3. **Batching preserves bits.** Bend evaluation is pure: running independent components in parallel gives the same
   words as running them in sequence. binding.md measured bit-exact planar results at 1, 6 and 18 threads. The planner
   only co-schedules independent nodes and never reorders or reassociates dependent ones, so `(A ∪ B) ∪ C` stays
   `(A ∪ B) ∪ C`. Dedup merges only hash-identical nodes, so purity makes it exact.
4. **Compiler flags.** Pin `-ffp-contract=off` in the native build. The binding build and Bend's own CLI use clang's
   default, which is `on` for C. Bend's emitted C wraps each F32 op in `f32_rewrap(...)`, so frontend contraction is
   unlikely, but F32x2 double-word arithmetic breaks under a fused multiply-add and nothing guarantees against it. Bend's
   Metal path already passes `--fmad=false` to the device compiler. No `-ffast-math`, ever.
5. **Identity.** Identity folds into the ops (native). The revision becomes a hash over view words instead of today's
   sha256 over decoded JSON (`src/identity.mjs:21`), which changes revision strings in `brep.json`. This is a
   deliberate migration, decided by Marc (surface.md open question).

## 7. Failure semantics

| failure | detected | becomes | process |
|---|---|---|---|
| capability refusal in a node | reply status 1 | `UnsupportedFeatureError` at the node's recorded source location and call stack; later nodes discarded; model trace truncated there | runs |
| catchable failure (audit, `fail()`) | reply status 2 | batch policy: replay (§2.5), so `try`/catch behaves exactly as eager; eager policy: thrown inline | runs |
| Boolean count ≠ 1 | reply | replay | runs |
| host-side error while ops are pending | at record time | error-triggered flush; earliest error in program order wins | runs |
| malformed request, unknown op, ABI mismatch, stale binary | driver / loader | `NativeKernelError` (bridge fault) | runs |
| fail-stop on the calling thread (Nat overflow, stack overflow, GPU OOM) | `BX_FAILSTOP` | `NativeKernelError`; session poisoned until `reset()` (0.1 ms CPU, 8 ms Metal) | runs |
| fail-stop on a **pool worker** | – | stderr `bend: …` plus `bend-binding: fail-stop outside a JS call` | **Node exits 1** |
| kernel hang | – | nothing in-process (no cancellation) | hangs |

- **Never a silent fallback.** The backend is chosen once, up front. A native failure is never re-run on the reference
  backend, and a Metal failure is never retried on CPU. The reference backend loads only when selected or in
  differential mode, so the native path pays no 0.75 s JS-kernel load.
- **Batching raises the pool-worker exposure.** Fork-join across components puts most kernel work on pool workers,
  where a fail-stop cannot be turned into an exception. Mitigations, in order of preference:
  1. The runtime change binding.md identified: the CPU variant of the device's cooperative `H_ERROR_CODE` path. It is
     Marc's decision, and possibly an upstream request.
  2. `--isolate`: run submits in the baseline's out-of-process service. baseline.md rejected it for today's call
     pattern (22 to 29 µs per call; r10b's 18,604 calls cost about 0.5 s). With one flush per build it costs one round
     trip plus views: all 18,604 kernel calls of the r10b profile run returned about 101k result nodes in total, roughly
     0.4 MB, so about 10 ms at the measured 26 ms/MB is an upper bound. It
     also buys deadlines for hangs (250 ms SIGSTOP detection measured). The service must then hold the resident
     handles, and a crash loses them, so the whole build fails loudly.
- **No cancellation, so speculative waste.** Fork-join in Bend cannot be cancelled. In batch policy, components that
  run after the first failing node in program order are discarded, and the error arrives when the whole batch
  finishes. Eager policy stops at the first failure. `--batch` therefore stays opt-in, and a `--fail-fast` run is simply
  the eager policy.
- **Python.** A Python program can catch `RuntimeError` from a failed request. Batch policy acknowledges requests
  before they run, so it is only allowed when the source contains no `try` (static check). Capability errors are
  already sticky and fail the run, so they are unaffected.

## 8. Testing

- **One interface, every test on both backends.** `build()`/`buildPython()` read `WONKY_BACKEND` and `WONKY_POLICY`.
  `npm test` stays on `reference` by default. A second job runs focused suites with `native`, and a third with
  `differential`, which submits every graph to both backends and throws on the first differing reply word (node,
  word index, both values).
- **Policy differential.** `brep.json` (minus timings) and STEP bytes must be identical between `eager` and `batch`,
  and between `--threads 1`, 6 and 18.
- **Replay tests** (small FS fixtures):
  - a catchable failure inside `try` that takes the catch path;
  - a capability error inside `try silent` that must still fail;
  - a union producing two disjoint bodies (misprediction);
  - a host error recorded after a failing pending op (ordering);
  - a replay whose op stream diverges (must raise `NativeKernelError`).
- **Flush counts as regression signals.** The eight workloads, and every r10b part in record mode, must report the
  flush counts in §1.3/§1.4 (1 each under `batch`). A hidden sync point (§1.1) shows up as a count change, not as a
  silent slowdown.
- **Record-only lint in CI.** `wonky --record-only fixtures/r10b/r10b.fs --feature <part>` for all nine parts
  (under 0.3 s each) catches host-side admission regressions without a 4-minute kernel run.
- **Frozen inputs.** `fixtures/r10b/r10b.fs` stays byte-for-byte; the trace never writes to it.
- Existing native-bridge tests stay: wire (9), binding (7), baseline (10), batched policy (4, new).

## 9. Metal routing policy

Measured facts: device init 31 to 35 ms once per process, 0.26 to 0.65 ms per dispatch (binding.md). Metal won only on
uniform batches: 262k cylinder comparisons took 2-3 ms against 9 ms on 18 CPU threads, and 16k through-hole Booleans
17 ms against 21 ms. It was 35x slower when badly partitioned (64 × 256). The Metal build of the planar build123d
workload was killed after 911 s (hardware-performance.md, binding.md).

Policy, decided on the host from the plan, before execution, and recorded in evidence:

1. `--gpu off` is the default. `auto` is opt-in; `on` forces eligible groups and fails loudly if Metal is unavailable.
2. A `Par` group is **eligible** only if all of these hold:
   - its op kind has a validated `!` entry in `kernel/service/gpu.bend`. Candidates are the hardware-performance ops
     (`boolean.coaxial`, `comparison.coaxial`, pierce through-holes); no planar or curved Boolean qualifies;
   - its leaves are uniform (same opcode, fixed-width inline words);
   - it can be partitioned inside the measured good range, e.g. 4,096 × 4 or 16,384 × 16 sub-packages.
3. Route only if the estimated CPU time (18 lanes) exceeds dispatch plus, when the device is not yet initialized,
   init by a margin. With the measured numbers that means thousands of leaves per group, and a resident session in
   practice.
4. Each Metal op kind needs a bit-exact CPU/Metal differential test in CI (hardware-performance.md did this for 36
   configurations). There is no CPU retry after a GPU failure.

**Consequence:** no operation in the eight workloads or in r10b is eligible. Metal is for sweeps of primitive checks
(fit and clearance matrices, thousands of coaxial pairs), not for modeling Booleans.

## 10. Native build and caching

`scripts/native-bridge/build-kernel.mjs` generates everything, never by hand, following binding-build.mjs:

1. Resolve the transitive import closure of `kernel/service/graph.bend`.
2. `gen-wire.mjs` writes `kernel/service/generated/wire.bend` and `src/native/generated/*`.
3. Write a root `entry.bend` whose `main` reaches `submit`, so its FID survives Bend's reachability pruning.
4. `bend entry.bend -o api.c`.
5. Generate the translation unit: `bx_pre.h`, unchanged `api.c`, generated tables, `bx_addon.c`.
6. `clang -std=c11 -O3 -ffp-contract=off -fPIC … -bundle`, one compile at a time.
7. Write `manifest.json`.

**buildHash** = sha256 over:

- the sorted `(path, sha256)` of the closure;
- `src/native/binding/*`, the generator scripts, `bend.lock.json`;
- `clang --version`, the flags, and the Metal flag.

Outputs go to `out/native/<buildHash>/wonky-kernel.node` (plus `.gpu` for Metal), so switching branches back reuses
old builds. A pruning script keeps the last N.

**A stale binary never runs.** `openBackend('native')` recomputes the hash once per process:

- fast path: compare a size and mtime manifest, then hash only the changed files;
- about 1 MB of kernel sources, a few ms. This is deliberately *not* the JS loader's 436 ms re-lexing per module.

On mismatch it throws `NativeKernelError: native kernel is stale (kernel/real.bend changed); run node
scripts/native-bridge/build-kernel.mjs or use --backend reference`. There is no auto-rebuild without `--rebuild`, and
no fallback.

Measured build costs (load about 13): planar kernel addon 12 s (bend 4.7 s + clang 7.2 s). Emitting C for the 84-op
generated dispatcher took 16 s (12 MB of C, clang not run). Metal probe: 0.5 s + 0.46 s archive. The first `require`
after a rebuild costs 287 ms.

## 11. Dev loop

- **Editing kernel sources:** `--backend reference` (default in tests). Per-module JS compile is cached (0.16 s
  cached, seconds cold per module). No native build is needed to iterate.
- **Runs and benchmarks:** `--backend native` after `build-kernel.mjs`. The hash check turns "forgot to rebuild" into
  an immediate, specific error.
- **Confidence:** `--backend differential` on the fixture that changed.
- **Whole-program admission:** `--record-only` shows every op r10b would run, and the first host-side rejection, in
  under a second.
- **Evidence:** every `brep.json` states target, apiHash, buildHash, threads, policy, flushes and replays, so a
  benchmark cannot silently mix backends.

## 12. Migration path (each step ships on its own)

| step | ships | user-visible effect | depends on |
|---|---|---|---|
| 0 | `sync-trace.mjs`, this document, policy test | none | – |
| 1 | `KernelSession` + `KernelBackend` with the reference backend, eager policy, existing fine-grained calls | none; all tests pass through the session | – |
| 2 | native eager for the planar ports (binding.md's `kcall`), JS kernel still loaded | planar Booleans 8.3-9.7x in-process; runs bounded by profile A (2.4-5.3x) | 1 |
| 3 | `api.bend` coarse handle ops on both backends, eager; native path no longer loads the JS kernel; lazy exporters | §5 base numbers (6.9-8.5x, 12x with 6 threads); `nativeChainExact` fixed; golden re-baseline | 2 |
| 4 | lazy records + recorder in `record-only` mode (lint only, no evaluation) | `--record-only`; CI admission lint | 3 (host metadata split) |
| 5 | batch policy (speculative, replay, error-triggered flush), sequential evaluation of the whole batch | `--batch`; 1 flush per build; no speed change expected | 4 |
| 6 | planner and `Seq`/`Par` fork-join in `graph.bend` | inter-op parallelism where W/S > 1 (r10b-scale programs) | 5; for r10b also the curved-path emission fix |
| 7 | variants/sweeps with dedup; optional parallel recording on `worker_threads` | `--sweep`, one flush for all variants | 6 |
| 8 | Metal groups for eligible primitive ops | `--gpu auto` for large uniform sweeps | 7 |
| alt | `--isolate` through the baseline service | crash and hang isolation at one round trip per flush | 5 |

Steps 1 to 3 are the base binding every proposal needs. The batched angle begins at step 4. Step 4 alone is useful: it
found three r10b blockers. Steps 5 to 7 should wait until step 3 is in production and r10b's curved path can be
emitted as C. Before that, there is no workload on which they can be measured end to end.

## 13. Risks (and where this angle is weakest)

1. **No measured workload benefits.** All eight profiled runs are dependent chains (W/S ≤ 1.06). Batching adds real
   complexity (lazy records, replay, error ordering) for a gain shown only on a program prefix that cannot run
   natively today. Mitigation: defer steps 5 to 7; keep step 4.
2. **The curved path blocks r10b natively.** "An arity over 255" in `section.bend`; the only measured parallel pair
   (`g2 ∥ g4`, W/S 1.86) is on that path.
3. **Pool-worker fail-stop kills Node, and batching increases the exposure** (§7). A runtime patch or `--isolate` is
   needed before `--batch` becomes a default.
4. **Hidden sync points.** Any host read of `record.body` flushes, which is correct, but a missed one silently turns a
   batch back into per-op flushes. Mitigation: flush counts in evidence and tests. §1.1 lists the six sites found
   today.
5. **Speculation depends on interpreter determinism.** Replay verifies op fingerprints and fails loudly on divergence.
   A future builtin with hidden state (a cache keyed by object identity, anything time-based) would break it.
6. **No cancellation.** Time-to-first-error can grow under `--batch`, and speculative work after a failure is wasted.
7. **Scaling is unmeasured.** Inter-op scaling of *planar* Booleans across lanes was never measured. The only data is
   the through-hole batch (10.1x at 18 threads). Intra-op parallelism already takes 6 lanes for 1.5-1.7x, and both
   compete for 18 lanes and memory bandwidth. Peak memory grows with concurrent components (2 GiB virtual stack per
   pool lane; `reset()` does not return touched stack pages).
8. **Cost-unweighted bounds.** The r10b 8.5x is a Boolean-count ratio; measured Boolean costs span 4.5 s to 134.7 s.
9. **Metal is unlikely to matter** for modeling. The planar Metal build timed out at 911 s; Metal's wins were on uniform
   primitive batches.
10. **Precision migration.** Handles change the last bits of multi-op outputs, and folded identity changes revision
    strings. Both need one reviewed re-baseline.
11. **Measurement caveats.** Every timing ran at load 11.5 to 15.1 on 18 shared cores. Record mode is a simulation of
    the recorder (stand-ins), not the recorder; its predictions were checked only where eager runs exist (11 of 11
    Booleans). opRevolve stand-ins (45 in TrayArms) are hypothetical. TrayArms, Frames and SideDrive were followed only
    up to their host-side rejections.
12. **FP contraction** (§6.4) must be pinned and tested, or double-word arithmetic can diverge between backends without
    any code change.

## 14. Decisions for Marc

- Default policy: `eager` (safe, same speed on every measured model) with `--batch` opt-in, until steps 5 and 6 show a
  measured win?
- Pool-worker fail-stop: patch the runtime (CPU `H_ERROR_CODE`), ask upstream, or require `--isolate` for `--batch`?
- Identity: fold into native ops and accept new revision strings?
- Sweep semantics: Cartesian `--sweep`, per-variant status, non-zero exit if any variant fails?
- The three host-side r10b blockers found by record mode (SideDrive `g0`, Frames `g512`, TrayArms line 590): who owns
  `validatePolygon`'s limits?

## Reproduce

```sh
BEND_NO_TELEMETRY=1 node scripts/native-bridge/sync-trace.mjs                          # 8 workloads eager + record, 9 r10b parts record (~2 min, 1 core)
BEND_NO_TELEMETRY=1 node scripts/native-bridge/sync-trace.mjs --only fs-r10b-tolerated --modes eager   # ~4 min, 1 core
node --test test/native-bridge-batched.test.mjs                                          # 4 tests, no kernel
```

Output: `out/native-bridge/batched/sync-trace.json`. Per run it holds status, failure, load before and after, op
sequence with inputs, kernel ms, `try` depth, errors and Boolean result counts, and the three policies with per-batch
W, S, Boolean count and span. Child results go to `tmp/native-bridge/batched/`.
