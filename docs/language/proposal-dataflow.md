# Proposal from the dataflow angle: WGraph, a content-addressed feature graph between the frontends and the Bend kernel

Date: 2026-09-22. Role: language architect, dataflow-graph angle. Machine: Apple M5 Pro (18 logical CPUs), macOS
arm64, Node v22.23.1, Bend 2.0.25. The machine was shared with other workflows. The one-minute load average was
**12.5 to 19.9** during the measurements below; it is recorded next to every run in the JSON outputs. All timings are
**indicative**. The correctness checks (hashes, op sequences) are exact.

Evidence labels: **[M]** measured for this proposal (script and output named), **[O]** measured by another stage
(cited), **[D]** documented by a cited source, **[I]** my inference.

Inputs: [prior-art.md](prior-art.md), [corpus.md](corpus.md), [semantic-core.md](semantic-core.md),
[bend-feasibility.md](bend-feasibility.md), [../native-bridge/](../native-bridge/) (profile, binding, surface, the
three proposals) and the decision document [../native-bridge.md](../native-bridge.md). `docs/research/` contained
only source excerpts at the time of writing.

## 0. Verdict

**Marc's idea from this angle:** the model is an explicit feature DAG with content-addressed nodes, incremental
re-evaluation, fork-join over independent branches, and graph diffs as the introspection tool. The frontends produce
and edit the graph. Geometric queries are graph nodes evaluated in Bend, so sync points disappear. Sweeps run as
parallel graph evaluations.

**What I recommend:**

1. **Build WGraph, but as an execution-trace IR, not as a language.** A WGraph is what one run of a frontend asked
   the kernel to do. Each node is one kernel operation (or a kernel-side selection or check) with concrete,
   unit-exact arguments and edges to the nodes that produced its input bodies. The graph is concrete: parameters,
   loops and helper functions stay in the FeatureScript or Python source. An edit means: re-run the cheap frontend,
   diff the new graph against the old one by content hash, and recompute only the dirty nodes. This is a verifying
   trace in the sense of "Build Systems à la Carte", not a new source language.
2. **It sits on top of the native binding and does not replace it.** WGraph nodes are the binding's coarse
   operations ([surface.md](../native-bridge/surface.md)). Caching needs only a host-side map from content hash to
   carrier or handle, and no Bend change. Fork-join needs a batched entry into Bend (one call per graph), because the
   runtime serializes calls: a JS host cannot run two kernel calls at the same time
   ([binding.md](../native-bridge/binding.md)).
3. **Do not build a new authoring language, and do not evaluate FeatureScript or Python in Bend.** The graph is a
   poor authoring form (no parameters or loops; r10b's graph is 777 KB of text). Moving the evaluator into Bend buys
   no speed. It would also turn FS binary64 arithmetic into F32x2 arithmetic
   ([bend-feasibility.md](bend-feasibility.md) §8).

**What the prototype proves [M]:**

- **The frontends produce the graph, faithfully.** Real builds and the graph tracer produce the same kernel
  operation ids and source lines for 11 programs and for the executed prefix of the frozen r10b fixture.
- **All of r10b traces without a kernel.** The frozen fixture yields a 2,037-node graph in 1.0 s, with 0 graph breaks
  and 38 kernel-verified count checks. It has 433 Boolean nodes in 27 independent components, and the longest
  Boolean chain is 42. That is the whole acceptance target, including the parts the real build never reaches.
- **Incremental reuse is large on real parameter edits.** Changing `catchPitch`, `catchHeight` or
  `innerWallThickness` dirties 15 of r10b's 433 Booleans (3.5 %, all in TrayArms). `edgeAngle` dirties 8 (1.8 %).
  Over Marc's corpus, a random single-literal edit dirties a median of 31 % of a file's heavy operations (unique
  files; families 19 %). A top-level constant edit dirties a median of 53 %.
- **Fork-join potential is modest for typical parts and large for assemblies.** The corpus median of heavy work
  divided by span is 2.7 (op-count bound; p90 8.1). r10b's bound is 10.3. Many single parts are one long Boolean
  chain on the main body.
- **Native measurements on the emittable planar path (spike binary, no new build):**
  - One-parameter edit of frame-with-tab: the second Boolean is recomputed in 1,061 ms instead of 1,316 ms, a
    **1.24x** gain. An edit of the opening gains nothing (1.0x), because both Booleans are dirty.
  - A 4-variant sweep takes 6,318 ms naively and 5,320 ms hash-consed (1.19x). Hash-consed with fork-join it takes
    2,261 ms at 4 threads (**2.8x**). Load was 18 to 19 during these runs.
  - Every variant's B-rep hash equals its stand-alone run.
- **Sync points do not all disappear.**
  - With speculation plus kernel-side check nodes, **60 % of the corpus files that reach a graph outcome trace
    without a break** (51 % of families).
  - Every observed first break sits at a static level-2 check or a level-5 declarative selection. Two small lowering
    idioms in the FS frontend would remove them. Level-7 programs keep real host round trips.
  - In-process, a host round trip costs microseconds anyway. Sync points cost time only in one case: they prevent
    whole-graph submission, and with it parallelism.

**What it disproves or bounds [M, O]:**

- **"The graph language makes wonky fast."** It does not. Cold single-part speed comes from the native kernel. The
  graph-lowered frame-with-tab takes 1,522 ms against 1,494 to 1,508 ms for the spike and for direct kernel calls,
  with the same hash.
- **"Sync points disappear."** They do not in general: 2 to 11 % of families need a host round trip.
- **"The graph is the program."** It is not. The graph is always concrete, so parameters and loops are not in it.

**Order:**

1. Boolean/r10b kernel path and native binding slice first, unchanged. They are the critical path.
2. Ship the tracer now as a lint/preflight and graph-diff tool. It needs no kernel.
3. Add a host-side content-hash cache over the binding's carriers. This gives incremental rebuilds in a resident
   session.
4. Add a batched `evaluate(graph)` entry in Bend with fork-join. Do this only after the runtime's pool-worker
   fail-stop is fixed. First users: sweeps and multi-part files.
5. Add the two lowering idioms to the FS frontend.
6. No surface syntax.

## 1. What was built

| File | What it is |
|---|---|
| `src/lang/dataflow/graph.mjs` | WGraph/0: node model, Merkle hashing (`geom` without ids, `full` with ids), canonical text printer and parser, analysis (work, span, components), diff (content-addressed reuse), hash-consing merge for sweeps |
| `src/lang/dataflow/canon.mjs` | Exact canonical text for FS values. A length prints as `18mm` only when `18 * 0.001` reproduces the stored binary64 bit for bit; otherwise it prints in meters. Maps print with sorted keys |
| `src/lang/dataflow/fs-trace.mjs` | FeatureScript to WGraph by **mock execution**. wonky's unmodified parser and interpreter run the FS value layer. Every modeling builtin is replaced by a symbolic one over a lineage store. No kernel is loaded |
| `src/lang/dataflow/fs-values.mjs` | 28 pure FS std value functions wonky lacks (`atan2`, `mirrorAcross`, `rotationAround`, `min`/`max`, ...), from their std semantics |
| `src/lang/dataflow/py-trace.mjs` | build123d to WGraph through wonky's own shim (`python/runner.py`, via `uv run`). The host answers requests lazily with node names instead of B-reps. `volume()` is a graph break |
| `src/lang/dataflow/lower-spike.mjs` | Lowers WGraph stages to a program for the native Bend spike (`out/lang/spike/build/main`): one `let` per node, one balanced `par` tree per level of independent heavy nodes, reuse of already-evaluated content hashes across stages |
| `scripts/lang/dataflow-corpus.mjs` | Traces every unique FS modeling file of Marc's corpus, every exported feature, plus r10b with its real parameters, and runs edit experiments. Output: `out/lang/dataflow/corpus.json` |
| `scripts/lang/dataflow-fidelity.mjs` | Real build vs tracer: operation-id sequences and source lines. Output: `out/lang/dataflow/fidelity.json` |
| `scripts/lang/dataflow-native.mjs` | Native cold, incremental and sweep runs with hash checks. Output: `out/lang/dataflow/native.json` |
| `scripts/lang/dataflow-examples.mjs` | Worked examples. Output: `out/lang/dataflow/examples/*.wg`, `examples.json` |
| `test/lang-dataflow.test.mjs` | 10 focused tests, including r10b, the build123d shim and a native bracket run (10/10 pass, about 2.4 s) |

```sh
node --test test/lang-dataflow.test.mjs                 # 10 tests, ~2.4 s
node scripts/lang/dataflow-corpus.mjs --edits 8         # corpus + r10b, ~30 s, read-only on ~/Workspace/cad
node scripts/lang/dataflow-fidelity.mjs                 # real builds on the JS target, ~70 s (r10b strict ~52 s)
node scripts/lang/dataflow-native.mjs --samples 3       # native runs, ~2.5 min, 1/2/4 threads
node scripts/lang/dataflow-examples.mjs                 # worked examples
```

No file outside my writable paths was changed. There was no new Bend compile: the native runs use the spike binary
built by the feasibility stage (sha256 `9a394315…`, recorded in `native.json`).

## 2. The model

### 2.1 Nodes

```
node   ::= [kind] name = op(args)  @line:column
kind   ::= (op) | meta | select | check
name   ::= operation id path (FS Id, e.g. model/TrayArms/g17/op) | op@line[#k] (Python call site)
args   ::= canonical, exact values; input references are names of earlier nodes
```

| Kind | Ops (prototype vocabulary) | Evaluated by | Cost class |
|---|---|---|---|
| op | `sketch`, `extrude`, `revolve`, `loft`, `sweep`, `cuboid`/`cylinder`/`cone`, `pattern`, `transform`, `boolean.union/subtract/intersect`, `fillet`, `chamfer`, `offsetFace`, `deleteFace`, `splitPart`, `import`, `import.select`, `input.*` | kernel | heavy for Booleans and face or blend operations (76 to 99.9 % of kernel time in [profile.md](../native-bridge/profile.md)); medium for loft, revolve and sweep; light otherwise |
| select | `select.body/face/edge([candidates] where …)` for queries that need geometry (`qGeometry`, `qContainsPoint`, `qLargest`, face and edge sets) | kernel | light |
| check | `expect.count([…] == n)` and, planned, `expect.volume ≈ v ± tol` and `expect.bbox within` | kernel, after its inputs | light |
| meta | `property.name`, `property.appearance` | host | none. The geometry hash passes through, so renaming a part never dirties geometry |

Store semantics: FeatureScript mutates one context. The tracer turns each mutation into a new **version** of a body
record, SSA-style, and resolves `qCreatedBy`, `qUnion`, `qSubtraction` and `qBodyType` against the lineage at that
point of the trace. This is exactly FS's sequential semantics. A Boolean on `targets` produces a new version of the
target record, and later queries of that record read the Boolean's node
(test: `qCreatedBy(id + "a")` after `u1` resolves to `model/u1`). `opDeleteBodies` on a lineage query only changes
the live set and creates no node. On a geometric selection it becomes a `delete` node, and every candidate may be
gone afterwards.

### 2.2 Values and units

- Arguments are the **host's exact values**. FS binary64 in SI units is printed in mm or deg only when that is
  bit-exact (`canon.mjs`). Python values are floats in mm.
- The graph never does FS arithmetic. The value layer ran on the host, in binary64, before the graph existed. So the
  F32x2-vs-double divergence ([bend-feasibility.md](bend-feasibility.md) §8) does not reach the graph. The kernel
  boundary converts exactly as today; the polyhedral extrude uses `Math.fround`, reported as precision F32.
- One exception is planned: measure arithmetic and predicate nodes evaluated in Bend. These are level 4 and 5 in
  corpus.md: FS 3.9 % and 38 % of families, build123d 8.5 % and 43 %. They compare F32x2 measurements against
  binary64 thresholds. That is safe when the tolerance window is far larger than 2^-48 relative, which holds in the
  corpus (1500 mm³, 0.001 on unit normals, 0.2 mm on bounding boxes). Otherwise either run the arithmetic on the host
  (a graph break) or implement soft binary64 for that small vocabulary.

### 2.3 Identity: names and hashes

Two hashes per node, `hashGraph` in `graph.mjs`:

- `geom` hashes (version, kind, op, args, input `geom` hashes). It is the cache key when operation ids do not
  matter, as for Python's positional names.
- `full` adds the node name and the input `full` hashes, because `kernel/identity.bend` derives topology names from
  the operation id. It is the conservative cache key for FS.

Spans and call stacks are metadata and are never hashed: moving code does not invalidate anything.

FS names are the user's own `Id` paths, so they are stable across edits that do not change control flow. Python
names are `op@line#k`, which stays stable until lines above the call move. Caches for Python should key on `geom`,
with identity re-derived per run. [semantic-core.md](semantic-core.md) §7 already requires stable Python operation
ids for kernel naming. A content-addressed cache makes this requirement concrete: it holds when names are derived
from content or from explicit ids, never from session counters (`python/N`).

### 2.4 Queries and sync points

The tracer handles every place where the host reads geometry:

| Host construct | Graph form | Status in the prototype |
|---|---|---|
| Lazy query consumed by an op (`opFillet(entities: qGeometry(qOwnedByBody(b, EDGE), LINE))`) | `select` node, evaluated by the kernel | implemented |
| Body-level `evaluateQuery` whose count follows from lineage | host resolves it without geometry | implemented |
| Body count after a Boolean (which may split or remove bodies), e.g. `if (size(evaluateQuery(q)) != 1) throw` | **speculate** on the lineage count and add a `check expect.count` node verified by the kernel. A wrong guess is an explicit error at evaluation, followed by re-tracing with the real value (the "replay" in [proposal-batched.md](../native-bridge/proposal-batched.md) §2.5) | implemented (speculation and check); replay not built |
| `ev*` whose value feeds only a `throw` (level 2) | `check expect.volume/bbox` node | not built: today a graph break |
| Loop over `evaluateQuery(q)` with a range/direction predicate collecting bodies (level 5a, e.g. `abs(evVolume(q) - v) < 1500`) | `select.body(q where volume ≈ v ± 1500)` plus the program's own count check | not built: today a graph break |
| Loop applying ops per evaluated body (level 6) | unrolled when the count follows from lineage; a map node otherwise | lineage case works (guide-r2 cutters) |
| Sequential control flow on geometry (level 7: fillet fallbacks, re-query loops) | **graph break**: flush the pending graph, return values, continue | break detected and reported |
| `try` around ops with a real recovery path | `orElse(op-subgraph, recovery-subgraph)` or a break | not built: the tracer records the success path |

### 2.5 Errors with source spans

Every node carries its call span and the FS call stack of user functions (`fs-trace.mjs` `currentStack`). A kernel
error, capability error or failed check at a node maps back through that span exactly as today's
`FeatureScriptError.format`. Example of the planned message for a failed speculation:

```
guide-r2.fs:78:5: expect.count failed at model/left.count: kernel found 2 bodies, the trace assumed 1
  selection: select.body(model/guides/source where box3d.max.y < 0mm)   guide-r2.fs:75:5
  called from universalFunnelBracket (guide-r2.fs:69)
  re-tracing with the kernel's value takes the program's own error path: "Source guide: Expected one left source guide"
```

Unsupported input stays a capability error at its source location. Examples: a missing std function (`'makeId' is
not defined`), an unfrozen import (`Unresolved Onshape module 'base'`), a builtin with no kernel op
(`op 'cylinder' has no builtin in the spike kernel set`). Nothing is approximated. The tracer never invents a
measurement; it stops with `GraphBreak` and the site. In study mode it models unknown inputs as explicit `input.*`
or `import.opaque` nodes and never guesses their contents: `getProperty(NAME)` of an opaque import is a capability
error.

### 2.6 Determinism

- **Frontends.** The tracer is deterministic: it has no clock and no randomness, and it uses sorted map keys in the
  canonical text. FS is deterministic by design [D].
- **Kernel.** Bend is pure, so hash-consing and caching are bit-exact by construction, provided the key covers every
  input. That includes the kernel version and the FP flags that the native-bridge decision pins
  (`-ffp-contract=off`).
- **Measured.** Every native run was repeat-identical. The 4 sweep variants have the same B-rep hash stand-alone,
  inside a naive sequence, hash-consed and sequential, and hash-consed with `par` at 1, 2 and 4 threads
  (`native.json` `checks`: 10 of 10 true).
- **Not a rewrite.** Graph reuse is not the same thing as rewriting the graph.
  [proposal-batched.md](../native-bridge/proposal-batched.md) points out that even an identity transform changes
  `-0` to `+0`. r10b has 541 identity clones among its 583 `pattern` nodes. Eliminating them, or reassociating
  Boolean chains, would change bits and topology names. That is allowed only as an explicit, validated
  optimization, never silently.

## 3. Example programs

### 3.1 `examples/bracket.fs` (34 lines of FS, [prior-art.md](prior-art.md) §3.2)

The original is the ordinary `defineFeature` with a precondition, a sketch, `skPolyline` of 7 points and a blind
`opExtrude` of `definition.thickness`. The tracer's graph (`out/lang/dataflow/examples/bracket.wg`):

```
wgraph/0 frontend="featurescript" source="examples/bracket.fs" feature="bracket"
model/profile = sketch(plane([0,0,0]mm,[0,0,1],[1,0,0]),[skPolyline("outline",{points:[[0,0]mm,[50,0]mm,[50,12]mm,[18,12]mm,[18,40]mm,[0,40]mm,[0,0]mm]})])  @30:9
model/extrusion = extrude(direction:[0,0,1],endBound:"BoundingType.BLIND",endDepth:8mm,entities:region(model/profile,filterInnerLoops=false))  @31:9
out model/extrusion
```

- The parameter `thickness` is gone: the graph holds its value, `8mm`. With `thickness = 10 mm` the diff marks
  exactly `model/extrusion` dirty and reuses the sketch (test 4).
- Lowered to the spike, the bracket runs natively in under 1 ms, with volume 8832 mm³ and 0 kernel errors (test 10).
- One visible host-side fact: `18 * millimeter` is `0.018000000000000002` m, so the kernel receives 18.000000000000004
  mm. The lowering rounds it to F32 explicitly, exactly as `src/kernel.mjs` does today.

### 3.2 build123d frame-with-tab

Original (`fixtures/performance-build123d/cases/frame-with-tab.py`):

```python
stock = Box(50, 40, 10, align=Align.MIN)
opening = Pos(8, 8, -1) * Box(34, 24, 12, align=Align.MIN)
frame = stock - opening
tab = Pos(48, 10, 0) * Box(12, 20, 10, align=Align.MIN)
result = frame + tab
```

The graph, traced by running this file through wonky's own shim in CPython in 38 ms:

```
wgraph/0 frontend="build123d" source="frame-with-tab.py"
box@3 = box(size=[50,40,10]mm,align=[MIN,MIN,MIN])  @3:0
box@4 = box(size=[34,24,12]mm,align=[MIN,MIN,MIN])  @4:0
translate@4 = translate(box@4,by=[8,8,-1]mm)  @4:0
boolean.subtract@5 = boolean.subtract(box@3,translate@4)  @5:0
box@6 = box(size=[12,20,10]mm,align=[MIN,MIN,MIN])  @6:0
translate@6 = translate(box@6,by=[48,10,0]mm)  @6:0
boolean.union@7 = boolean.union(boolean.subtract@5,translate@6)  @7:0
out boolean.union@7
```

The lowered native program (`frame-with-tab.lowered.core`) is the spike's hand-written case. Translations are folded
into placed boxes, and unused origin boxes are never built:

```
(let s0n0 (box 0 0 0 50 40 10))  (let s0n1 (box 8 8 -1 42 32 12))  (let s0n2 (subtract s0n0 s0n1))
(let s0n3 (box 48 10 0 60 30 10))  (let s0n4 (union s0n2 s0n3))
```

It gives hash 3141504600, 13840 mm³ and 64 faces, identical to the spike and the kernel-only benchmark, in 1,522 ms
at 1 thread (load 12.6 to 12.9). The two Booleans form one chain (work = span = 2), so fork-join adds nothing here.

### 3.3 fs-simple: `cad-project-039/hopper-corner-inserts-r1/inserts.fs` (55 lines, SHA-256 pinned)

The original, abridged:

```
for (var x in [-120,-95,-72,-51,-44,-36.5]) { ... sections = append(sections, fillSection(context, id + ("section" ~ x), x, r, n)); ... }
opLoft(context, id + "loft", {"profileSubqueries": sections}); var left = qCreatedBy(id + "loft", EntityType.BODY);
trimOutside(context, id + "side", left, n, vector(-51,0,0) - n*0.3);        // sketch, extrude 500 mm, subtract, delete sketch
... opBoolean(context, id + "floorCut", {"targets": left, "tools": qCreatedBy(id + "floorTool", ...), SUBTRACTION});
opPattern(context, id + "mirror", {"entities": left, "transforms": [mirrorAcross(plane(...))], ...});
setProperty(...NAME...); setProperty(...APPEARANCE...); opTransform(context, id + "pose", {"bodies": qUnion([left, right]), ...});
```

The graph traces in 6 ms in strict mode: 19 nodes, of which 2 are heavy, 1 medium and 4 meta. It is abridged here;
the full text is `fs-simple.wg`:

```
model/section-120 = sketch(plane([-120,0,0]mm,[1,0,0],[0,1,0]),[skLineSegment("bottom",…),skLineSegment("blunt",…),skArc("chute",…),skLineSegment("rear",…)])
… five more sections …
model/loft = loft(profileSubqueries:[model/section-120,model/section-95,model/section-72,model/section-51,model/section-44,model/section-36.5])  @38:2
model/side/s = sketch(plane([-50.792029868625484,0.18724667778641388,0.1081069198248492]mm,[-0.6932337712483952,…],[…]),[skRectangle("rect",…)])  @23:112
model/side/ex = extrude(direction:[-0.6932337712483952,-0.6241555926213797,-0.360356399416164],…,endDepth:500mm,entities:region(model/side/s,…))  @24:2
model/side/cut = boolean.subtract(operationType:…SUBTRACTION,targets:[model/loft],tools:[model/side/ex])  @25:2
model/floorSk = sketch(…) ; model/floorTool = extrude(…)
model/floorCut = boolean.subtract(…,targets:[model/side/cut],tools:[model/floorTool])  @46:2
model/mirror = pattern(entities:[model/floorCut],instanceNames:["right"],transforms:[xf([[-1,0,0],[0,1,0],[0,0,1]],[0,0,0]mm)])  @48:2
meta model/floorCut/name = property.name(model/floorCut,"P01 Hopper rounded corner L R1 - glue in")  @49:2
… appearance …
model/pose = transform(bodies:[model/floorCut/name/appearance,model/mirror/name/appearance],transform:xf([[1,0,0],[0,0.5,-0.8660254037844386],…],[77.1263837814323,-498.4724643754777,-184.5128995194368]mm))  @53:2
```

- What the graph shows at a glance: the loop and `fillSection` helper disappear into six sketch nodes in global
  coordinates.
- Parallelism: the six sketches are independent. The heavy chain `loft → side/cut → floorCut` is sequential
  (span 2, work 2).
- Incremental reuse: editing a trim plane recomputes one subtract and the pose, and keeps the loft.
- wonky cannot build this file today: `opLoft` supports only two coaxial circles. The graph exists anyway. This is
  the preflight value: the missing capability (`loft` over line/arc sections) is visible before any kernel work.

### 3.4 fs-medium: `cad-project-002/funnel-holder-r2/guide-r2.fs` (111 lines, level 6)

The original (key lines):

```
var original = source(context, id + "guides", Guides::build, qBodyType(qEverything(EntityType.BODY), BodyType.SOLID));
var left = [];
for (var body in evaluateQuery(context, original))
    if (evBox3d(context, { "topology" : body, "tight" : true }).maxCorner[1] < 0 * millimeter) left = append(left, body);
if (size(left) != 1) throw regenError("Expected one left source guide");
...
for (var face in evaluateQuery(context, qGeometry(qOwnedByBody(guide, EntityType.FACE), GeometryType.PLANE))) {
    var p = evPlane(context, { "face" : face }); var bb = evBox3d(...);
    if (abs(dot(p.normal, RAIL_AXIS)) < 0.001 && ... && bb.maxCorner[1] <= -59.999 * millimeter) faces = append(faces, face);
}
...
for (var i = 0; i < size(cutters); i += 1)
    opBoolean(context, id + ("cut" ~ i), { "targets" : guide, "tools" : cutters[i], "operationType" : BooleanOperationType.SUBTRACTION });
```

What the tracer produces (study mode). The `Guides` document import has no frozen snapshot, so it becomes an
explicit opaque input:

```
model/guides/source = import.opaque("Guides","651610df74efbe36ad793aa1","a097c1094ad5072c3034ddc9",all)  @19:5
check expect@75:22 = expect.count([model/guides/source] == 1)  @75:22
GraphBreak at 76:13: evBox3d returns a measured value to the host
```

With the two lowering idioms of §2.4 applied, the feature becomes one graph. This excerpt is hand-lowered and not
machine-checked:

```
select model/left = select.body([model/guides/source] where box3d.max.y < 0mm)
check  model/left.count = expect.count([model/left] == 1)                           ; "Expected one left source guide"
model/matchingEdge = pattern(entities:[model/left],transforms:[mirror across WIDTH plane])
model/joinEdges = boolean.intersect(tools:[model/left,model/matchingEdge])
select model/seatClearance.q0 = select.face([model/joinEdges] where plane and |n·RAIL|<0.001 and ||n.y|-√½|<0.001 and box3d.y in [-65.001,-59.999]mm)
check  model/seatClearance.count = expect.count([model/seatClearance.q0] in 2..4)
model/seatClearance = offsetFace(moveFaces:model/seatClearance.q0,offsetDistance:-0.1mm)
model/core/source = import.select("Core",…,where qLargest(solid bodies)) ; model/corePosition = transform(…)
model/chuteFit/envelope = pattern(8 translations) ; model/chuteFit/oppositeFit = pattern(mirror)
model/chuteFit/cut0 = boolean.subtract(targets:[model/seatClearance],tools:[model/corePosition]) … cut17   ; a chain of 18
… funnel: import.select, transform, 2 patterns, funnelFit/cut0 … cut17 (chain of 18) ; label sketch, text extrude, engrave subtract
check  model/final = expect.count(all solids == 1)
```

What this example teaches:

- **The level-6 loop needs no map node.** The cutter count (9 bodies, mirrored to 18) follows from lineage, so the
  tracer unrolls it.
- **There is nearly no parallelism.** The 39 heavy nodes are all chained on one body: 1 intersect, 1 offset,
  36 subtracts and 1 engrave. The cutter construction is parallel but light. A rewrite to one n-ary subtract of a
  union of tools would parallelize it, but it changes the B-rep and its names, so it is opt-in at most (§2.6).
- **The graph still helps as a cache.** Changing `FIT.funnel` dirties only the last 19 heavy nodes.

### 3.5 The other pinned cases

- **fs-hard `drive-purpose.fs`** (915 lines): it does not reach the tracer. wonky's parser rejects line 222 (`Expected
  '(', found ','`). The cause appears to be the map value string `"function"`, which the parser treats as the
  `function` keyword. That is a parser bug to report, outside this stage's paths. The file's selection idiom,
  `selectVolume` (a volume window over imported bodies plus a count check), is the most common break in the corpus
  (§5.1).
- **py-medium `project-component-d98e059b.py`** and **py-hard `cad-project-046/mount.py`**: the shim lacks `Sketch` and `Part`, so both
  stop with capability errors before the first request. The graph frontend is exactly as capable as the shim
  ([semantic-core.md](semantic-core.md): 1 of 294 build123d files fits today's shim).

## 4. Translating FeatureScript and build123d

### 4.1 FeatureScript: mock execution is the frontend

- **How it works.** Unmodified FS runs in wonky's interpreter, as AGENTS.md requires. Only the modeling builtins are
  replaced. The graph is a by-product of ordinary execution.
- **The hard parts are the ones the interpreter already has**, plus four tracer-specific ones:
  1. **Store versions and lineage** (§2.1). The tracer inherits wonky's exact-match `qCreatedBy`. Onshape includes
     sub-operations (semantic-core probe `qCreatedByPrefix`); study mode uses prefix semantics, because guide-r2
     depends on it.
  2. **Count speculation.** 5,246 `expect.count` checks in 101 of the 116 heavy graphs of the corpus. Nearly every
     helper validates its result.
  3. **Host admission checks.** wonky's eager path rejects some profiles before the kernel runs (`validatePolygon`,
     "collinear consecutive edges"). The tracer does not run these checks, so it follows r10b past three rejections
     that the batched stage's record mode hit (SideDrive, Frames, TrayArms). In the graph model they belong to the
     kernel op and are reported as node errors.
  4. **`try` with recovery.** 11 of the 123 complete or partial corpus traces come from files with a `try-recover`
     site. Their graphs hold the success path only. An `orElse` node, or a replay, is needed before trusting them on
     failure.
- **Coverage over Marc's corpus** [M, `corpus.json`, 329 unique FS modeling files, 129 families, 762 exported
  features]:

  | outcome (unique files; families) | count | meaning |
  |---|---|---|
  | wonky's parser rejects the file | 43 (13 %); 28 | parser gaps (`try {` without catch, `catch {`, map `for-in`, fragments). Semantic-core found the same 101 of 385 |
  | traced | 285; 101 | |
  | complete or partial (at least one feature complete) | **123 (43 % of traced)**; 34 | a WGraph of the whole feature |
  | graph break (first break) | 82 (29 %); 33 | host needs a measurement: `evVolume` 127, `evBox3d` 42, `evaluateQuery` over faces/edges 37 (feature counts) |
  | capability error | 46 (16 %); 23 | imports without frozen snapshots whose part names are needed (`base`, `SourceR11`, ...), `makeId`, `unitless` |
  | program error | 34 (12 %); 11 | features written for a Part Studio that already holds derived geometry, wonky frontend gaps (`AngleBoundSpec`, precondition forms) |

  - Among graph outcomes, **60 % of unique files (51 % of families) trace break-free**.
  - Of the 391 complete features, 354 need no assumption (strict). 37 use study-mode inputs: UI defaults for
    parameters, `import.opaque` for unfrozen imports, `input.context` for existing geometry.
  - Every one of the 206 first-break sites classifies as a static level-2 check (38) or a level-5 declarative
    selection (168, none complex) in the corpus scan. That is the two idioms of §2.4.
  - Static levels 6 and 7 never produced a break of their own, because an earlier level-5 site breaks first.
- **Projected coverage with the two idioms** [I, from [corpus.md](corpus.md)]: the lazy-IR bucket plus the plain
  graph, **about 98 % of FS families**. The general-language remainder stays at 1.2 % of unique files (2.3 % of
  families), and those files use graph breaks.

### 4.2 build123d: tracing through the shim

- **What it already does.** The shim's request stream is a straight-line WGraph (`py-trace.mjs`). CPython keeps
  full Python semantics. Every value Python reads back is a graph break: `volume()` today, and later `bounding_box()`,
  `center()` and selector comprehensions.
- **What break-free build123d needs.** Lazy `ShapeList` proxies (`edges().filter_by(Axis.Z)` as a `select` node) and
  a restricted comprehension compiler for the dominant idiom
  `[e for e in s.edges().filter_by(Axis) if abs(e.center().Z - h) < eps]` (28 of 82 families).
- **Coverage today** is bounded by the shim (1 of 294 files), not by the graph.
- **Projected** [I, corpus.md]: the plain graph covers 48 to 52 %. Lazy selectors reach about 89 % of families. The
  10 to 11 % with level-7 fallbacks (project-component-d98e059b, cad-project-046) keep host round trips.

### 4.3 JavaScript

A JS frontend would be the easiest of the three: host objects that append nodes. It is not needed for Marc's corpus.

## 5. Evidence: what gets faster, and by how much

### 5.1 Graph shape of real parts [M, `corpus.json`, load 18.3 to 19.9, 29.6 s for the whole corpus]

| metric | unique files | families |
|---|---|---|
| heavy graphs (complete traces with Booleans or blends) | 116 | 30 to 33 |
| heavy nodes per file, median / p90 / max | 50 / 130 / 199 | 34 / 122 / 199 |
| work / span (op-count bound on fork-join speedup), median / p25 / p75 / p90 | **2.69** / 1.62 / 3.40 / 8.09 | 2.56 / 1.17 / 4.00 / 18 |
| files with work / span ≥ 2 | 69 % | 53 % |
| independent heavy components, median / p90 | 2 / 13 | 2 / 32 |
| share of heavy work in the largest component, median | 75 % | |
| trace time per feature, median / max (JS, no kernel) | 9.7 ms / 44 ms | |

Examples at both ends:

- `cad-project-039/archive-r7/hopper.fs`: 199 heavy nodes, span 10, 38 components, bound 19.9.
- `c-channel-bases-arcs-r6`: 151 heavy nodes, span 52, 2 components, bound 2.9. One main-body chain.

Caveat: this is an **op-count** bound. The r10b tolerated prefix shows Boolean costs from 4.5 s to 135 s on the JS
target ([proposal-batched.md](../native-bridge/proposal-batched.md) §1.3). A cost-weighted bound can be much lower.

**r10b** (frozen fixture, strict, `corpus.json` `r10b`):

- The graph has 2,037 nodes:
  - Booleans: 233 union, 182 subtract, 18 intersect.
  - Medium: 64 revolve, 7 loft.
  - Light: 583 pattern (541 of them identity clones), 371 extrude, 449 sketch, 16 import.
  - Other: 38 check and 76 meta nodes.
- Heavy nodes by part: TrayArms 261, Frames 55, CameraSupports 48, LowerCore 21, UpperCore 16, Carriage 16,
  SideDrive 8, TransferEdge 8.
- Work/span is 433/42 = **10.3** (op-count), in 27 independent heavy components; the largest has 111 heavy nodes.
- Host costs:
  - trace: 1.0 s (2.54 M interpreter steps);
  - canonical text: 777 KB;
  - hashing: 4 ms;
  - diff: 9.7 ms.

### 5.2 Incremental re-evaluation

| edit | heavy nodes recomputed | source |
|---|---|---|
| r10b `catchPitch` 4 → 5 mm, `catchHeight` 0.5 → 0.75 mm, `innerWallThickness` 3.2 → 4.2 mm | **15 of 433 (3.5 %)**, all in TrayArms | [M] `corpus.json` |
| r10b `edgeAngle` K15 → K20 | **8 of 433 (1.8 %)**, TransferEdge | [M] |
| corpus, one numeric literal × 1.05 (509 edits in 99 files) | median per-file mean **31 %** (p25 14 %, p75 49 %); 54 % of edits ≤ 25 %; 6.5 % dirty everything | [M] |
| same, families (145 edits in 28 files) | median **19 %** | [M] |
| corpus, one top-level constant (134 edits in 43 files) | median **53 %**; 21 % dirty everything | [M]. Global dimensions are used everywhere |
| frame-with-tab, tab moved | 1 of 2. Native: v2 costs **1,061 ms instead of 1,316 ms (1.24x)** in one process | [M] `native.json`, load 12.7 to 12.9 |
| frame-with-tab, opening narrowed | 2 of 2. Native: 1,586 vs 1,541 ms (no gain, noise) | [M] |

Reading:

- A cache pays in proportion to how local the edit is and where the cost sits. On a two-Boolean part it is 0 to
  24 %. On r10b-scale assemblies with part-local parameters it is more than 25x fewer heavy operations. This is
  counted in operations, not measured end to end; r10b cannot run natively yet.
- The floor is the host re-trace, 1.0 s for all of r10b. 40 % of those CPU samples are in wonky's `append`, which
  copies the whole array on every call (`src/scalars.mjs:19`), and 19 % are garbage collection. A persistent array
  or per-feature trace caching would cut it. Today 1.0 s is comparable to one or two native planar Booleans.

### 5.3 Fork-join and sweeps (native, spike binary, `native.json`)

| run (4 tab positions of frame-with-tab) | threads | median eval ms | vs naive |
|---|---:|---:|---:|
| each variant alone | 1 | 1,302 to 1,593 | |
| naive sequence (every variant recomputes the frame) | 1 | 6,318 | 1.00x |
| hash-consed, sequential (frame subtract shared once) | 1 | 5,320 | 1.19x |
| hash-consed + `par` | 1 | 5,235 | 1.21x |
| hash-consed + `par` | 2 | 3,265 | 1.94x |
| hash-consed + `par` | 4 | **2,261** | **2.79x** |

- Load was 15.1 at the naive run and rose to 18.1 to 19.0 during the `par` runs. RSS was 3.7 to 6.1 MB.
- Every variant's hash is identical across all rows.
- The scaling is below the spike's 3.8x for four independent pockets ([bend-feasibility.md](bend-feasibility.md)
  §4). The shared subtract is a serial prefix, the four unions differ in cost, and the machine was loaded.

**r10b sweep, structural** [M]:

- Three `catchPitch` variants need 1,299 Boolean nodes naively and **463** hash-consed (−64 %), at the same span of
  42.
- At 18 threads, Brent's bound gives about 463/18 + 42 ≈ 68 Boolean-steps against 1,299 sequential. That is a bound,
  not a measurement: runs above 4 threads were not made on the shared machine, and the r10b Booleans are not
  natively emittable.

### 5.4 Where the time actually goes, end to end

| cost | today (JS path) | with the native binding (functional slice) | added by WGraph |
|---|---|---|---|
| cold build of one planar part (frame-with-tab) | 12.9 to 13.9 s [O] | about 1.5 s native kernel [M, O]; 1.7 to 1.9 s projected end to end ([native-bridge.md](../native-bridge.md)) | **0**. Graph-lowered 1,522 ms vs spike 1,494 ms and direct calls 1,508 ms. The graph layer (hash, lower, encode) costs about 1 ms |
| small models (bracket) | 0.84 s, 87 % JS kernel load [O] | about 7.4x from not loading the JS kernel [O] | 0 |
| one-parameter edit, resident session | full rebuild | full rebuild | recompute dirty nodes only: 1.24x on frame-with-tab, up to >25x fewer Booleans on r10b-like edits (structural) |
| sweeps, variants, multi-part files | sequential | sequential (the binding serializes calls) | hash-consing plus fork-join inside one batched call: 2.8x at 4 threads measured; r10b bound 10x+ |
| host sync points | µs each in-process [O] | µs each | removing them buys batching, not latency |

## 6. The Bend side

### 6.1 Architecture of a graph evaluator under Bend's rules

Much simpler than the spike's language evaluator: no closures, no environments of names, no user recursion.

```
type Node is Data: N{op: U32, words: List<&2, U32>, inputs: List<&2, U32>}         # wire words as in surface.md
type Level is Data: L{nodes: List<&2, Node>}                                        # nodes of one level are independent
def eval_nodes(nodes, env) -> List<Out>:      # divide and conquer; let a b = eval_nodes(left, env) eval_nodes(right, env)
def eval_graph(levels, env) -> Env:           # structural recursion over the level list, no fuel needed
def dispatch(op, words, args) -> Out:         # match on op -> the coarse operations of kernel/service/api.bend
```

- **Termination:** structural recursion over lists, so no fuel (`@unsafe` never needed). Kernel internals keep their
  own fuel.
- **Mutual recursion:** none. Dispatch is one `match` in the style of the spike's `step`.
- **Errors:** `Out = Ok{body} | Failed{code, node}`. Downstream nodes of a failed node are skipped; independent
  branches still finish. That yields the partial results the LLM loop wants ("these 3 features failed, 40 built").
- **Parallelism:** Bend fork-join, exactly the spike's `par`. The planner (levels, or series-parallel as in
  [proposal-batched.md](../native-bridge/proposal-batched.md) §2.3) runs in JS on graphs of at most a few thousand
  nodes.
- **Memory:** bodies are reference-counted Bend values. The measured runs peaked at 3.4 to 6.1 MB RSS. Planar
  results are 2.4k to 6k wire words ([binding.md](../native-bridge/binding.md)). r10b-scale caches need a size bound
  (LRU by hash) and an explicit `release`.

### 6.2 Parse in JS or in Bend

**In JS.** The graph is built on the host by definition, since frontends trace. It crosses the binding as U32 words
in the wire format of [surface.md](../native-bridge/surface.md) §7. At 6 to 7 ns per word, even a 200k-word r10b
graph is about 1.5 ms one way. The canonical text is for humans, tests, diffs and LLMs, and never crosses the
binding. Parsing FS in Bend is not needed and does not pay ([bend-feasibility.md](bend-feasibility.md) §6).

### 6.3 Linking the kernel, compile cost

- **Linking.** The graph evaluator is a few hundred lines. It is linked into the same kernel addon as the binding's
  dispatcher, and reuses the generated codecs (`gen-wire.mjs`) and the coarse operations.
- **Compile cost.** It is dominated by the kernel: 12 s for the binding's kernel addon, 17.9 s + 8.9 s and 7.07 GB
  for the spike with the kernel [O]. The evaluator changes only when an operation is added, which rebuilds the
  kernel anyway. That is the opposite of a language interpreter in Bend, which changes often and pays the full
  relink every time ([bend-feasibility.md](bend-feasibility.md)).

## 7. Relationship to the native binding

**It builds on the binding and complements it. It replaces nothing.** The native-bridge decision chose a stateless
`call(op, words)` API with exact carriers. It deferred batching and sweeps "until a natively emittable workload
shows W/S > 1.2 or sweeps are really needed" ([native-bridge.md](../native-bridge.md) §4). This proposal adds three
things to that decision:

1. **New evidence.** The eight profiled workloads were single chains, with W/S from 1.000 to 1.056. Marc's real
   files are not: median op-count W/S 2.7, 69 % of heavy graphs at 2 or more, r10b 10.3. On the emittable planar
   path, a hash-consed sweep measured **2.8x at 4 threads** with bit-identical results. That meets the decision's
   own criterion for sweeps. For single multi-part files the criterion is met structurally but not yet measured
   natively.
2. **Caching needs no Bend change.** The host keeps `Map<full hash, carrier words>`. A clean node passes its carrier
   to the next call; the decision measured ≤ 0.2 ms per op for carriers. This is step 3 of the order (§10) and gives
   incremental rebuilds on the functional API as decided.
3. **Parallelism needs the batched entry.** One call per graph, with fork-join inside. The only obstacle is the
   runtime's pool-worker fail-stop, which kills Node ([binding.md](../native-bridge/binding.md) §6). A graph
   evaluator makes pool execution the normal case, so the cooperative CPU error path requested upstream becomes a
   prerequisite.

The tracer itself is the batched stage's "record-only lint", generalized to the whole corpus and without kernel or
host admission. It is cheap enough to run on every save.

## 8. Dev loop and error messages

- **On save:** mock-trace (10 ms median per feature, 1 s for r10b), diff against the last graph, show what changed
  (`diffGraphs` names the dirty nodes, e.g. `model/TrayArms/...` for `catchPitch`), evaluate only dirty nodes, update
  the viewer. The graph diff is a code review of the geometry: which operations an edit touches, before any kernel
  work.
- **Preflight without geometry,** like Zoo's mock execution ([prior-art.md](prior-art.md) §3.1): missing std
  functions, unfrozen imports, capability gaps (`loft` over arcs), parser gaps, parameter defaults, all at their
  source lines. On the corpus, the preflight names every blocker class of §4.1 in 30 s.
- **Errors** map node to span to FS call stack (§2.5). Speculation failures name the assumption and the check.
- **Cost of the loop's pieces:** re-trace 1 to 1,000 ms, hash plus diff < 10 ms, per-node kernel work as measured.
  Bend compiles do not appear in the loop, because the evaluator changes rarely.

## 9. LLM-friendliness

- **As a reading and feedback format, WGraph has the properties the literature measured as helpful**
  ([prior-art.md](prior-art.md) §4.3): explicit deterministic ids, a global frame, concrete absolute values with
  units, one operation per line, and semantic references (`qCreatedBy` lineage turned into edges). A graph diff
  ("your edit changed 15 Booleans in TrayArms; `model/left.count` failed: 2 bodies") is precisely the kind of
  kernel feedback that CADSmith-style loops use.
- **As a writing format it is poor.** It has no parameters, loops or functions, it needs 777 KB for r10b, and there
  is no pretraining data. LLMs should keep writing build123d (largest prior) or normalized FS, and read graphs,
  diffs and measurements back. Hypothesis H6 of [prior-art.md](prior-art.md) §6.4 ("IR text helps repair more than
  raw FS") is untested; the prototype makes it testable (graph text plus diff as the tool output).

## 10. Incremental path (every step ships on its own)

| # | step | ships | depends on | measure of success |
|---|---|---|---|---|
| 0 | (running) Boolean/r10b kernel work; native binding slice (functional, compat, bit-exact) | native speed | – | per [native-bridge.md](../native-bridge.md) §11 |
| 1 | **Tracer as a tool**: `wonky graph file.fs [--diff old.fs]`, preflight lint in CI over the corpus | graph text, diffs, blocker lists | nothing (this prototype) | fidelity suite (op ids and lines equal to real builds) stays green |
| 2 | **Hashes on real traces**: attach `geom`/`full` to today's source-map operations; determinism tests (same hash → same B-rep on JS target, native 1 thread, native N threads) | cache keys, H2 of prior-art | 0 | bit-identical across targets |
| 3 | **Host-side cache over carriers** in a resident session (viewer, review server, `--watch`) | incremental rebuilds | binding carriers | end-to-end edit latency vs full rebuild, results identical to cold |
| 4 | **Batched `evaluate(graph)` in Bend** with level or series-parallel fork-join; sweeps API `--sweep p=a,b,c` with hash-consing | parallel components and variants | runtime cooperative fail-stop; binding API step with `api.bend` | measured speedup ≥ 1.2x on a real multi-part file or sweep, identical hashes |
| 5 | **Two FS lowering idioms** (check-only `ev*` → `expect.*`; volume/bbox/direction selection loops → `select.*`), plus replay for failed speculation | break-free whole-feature graphs for about 98 % of families (projected) | 3 | corpus break rate from 40 % toward the level-7 remainder |
| 6 | Lazy build123d selectors in the shim | break-free build123d for level ≤ 6 | shim growth | same, on build123d files |
| – | Persistent on-disk cache, opt-in rewrites (clone elimination, n-ary Boolean rebalancing) | only with a measured need | 3, 4 | validated, never silent |

## 11. Risks, and what not to build

**Risks:**

1. **Cost weighting.** Op-count bounds overstate parallel gains when one Boolean dominates. The r10b prefix has
   single Booleans of 87 s and 135 s on the JS target. Real gains must be measured per workload.
2. **Most single parts are chains.** guide-r2 has 39 chained heavy nodes and c-channel-bases a span of 52 of 151.
   Fork-join helps sweeps and multi-part files, not typical single parts.
3. **Speculation needs replay.** 5,246 count checks in the corpus traces are cheap to verify, but a wrong guess must
   re-trace. That protocol is designed ([proposal-batched.md](../native-bridge/proposal-batched.md) §2.5) but not
   built.
4. **The trace is only as good as the tracer's semantics.** It follows wonky's interpreter, including its
   divergences from Onshape (qCreatedBy prefix, closure capture, transactions:
   [semantic-core.md](semantic-core.md) §4.3). It skips host admission checks. It records success paths inside
   `try`.
5. **Topological naming.** Content reuse is sound for geometry. Names derive from operation ids, so a cache hit
   under a different id must re-derive identity. kernel/identity.bend has no API for that yet.
6. **The frontend is the new floor.** At 1.0 s per r10b re-trace, a fast kernel plus a small edit is
   frontend-bound. Fix `append` or cache traces per feature.
7. **Runtime maturity.** Pool-worker fail-stop, one runtime per process, calls serialized
   ([binding.md](../native-bridge/binding.md)). A graph evaluator depends on the first being fixed.
8. **Kernel numerics in predicate nodes.** F32x2 against binary64 thresholds, §2.2.

**What NOT to build:**

- **No new authoring language** and no graph-editing UI. The graph is concrete, so it cannot hold parameters.
  Grasshopper-style dataflow UIs are a separate product ([prior-art.md](prior-art.md) §3.10). KCL shows the cost of
  a new language.
- **No FS or Python evaluator in Bend.** It brings no speed, changes numerics, and costs a relink per change.
- **No "static graph only" frontend** that rejects programs needing geometry. Graph breaks are cheap in-process and
  required for 2 to 11 % of families.
- **No silent graph rewrites.** No clone elimination, reassociation or subtract-chain → union-of-tools without
  explicit opt-in and validation (§2.6).
- **No graph below the operation level** (Fidget-style tapes). Kernel operations are coarse; one Boolean is 0.1 to
  100 s.
- **No persistent cache before identity is content-addressed**, and no Metal routing: planar Booleans have no `!`
  path.
- **No Bend JS target as a graph runtime.** It is 5 to 35x slower than native and its IO needs Bun.

## 12. The angle's claims against the evidence

| claim of the dataflow angle | verdict | evidence |
|---|---|---|
| The frontends can produce an explicit feature DAG | **holds** | FS mock execution: 391 complete corpus features, all of r10b (2,037 nodes), op ids and lines identical to real builds for 12 programs; build123d through the shim |
| Content-addressed, incremental re-evaluation | **holds**, with the gain set by edit locality | r10b real parameters 1.8 to 3.5 % recompute; corpus median 19 to 31 % per literal edit, 53 % per constant edit; native 1.24x / 1.0x on frame-with-tab, results bit-identical |
| Fork-join over independent branches | **holds but modest for single parts** | median op-count bound 2.7x; many parts are one chain; native sweep 2.8x at 4 threads |
| Geometric queries as Bend nodes → sync points disappear | **partly** | checks and op-consumed selections yes (implemented); host selections need 2 idioms (not built); level 7 keeps breaks; 60 % of unique files break-free today |
| Removing sync points makes wonky faster | **no** | in-process sync is µs; the benefit is batching for parallelism and a host-free evaluation unit |
| Parameter sweeps on 18 cores | **plausible, partly measured** | hash-consing −64 % Boolean work on an r10b sweep; 2.8x at 4 threads native; > 4 threads not measured (shared machine) |
| Diff and introspection as graph diff | **holds, cheap** | r10b hash 4 ms, diff 9.7 ms; dirty node names per edit |
| The graph as the language, or the core language of wonky | **fails** | the graph is a concrete trace (no parameters or loops, 777 KB for r10b); authoring stays FS/build123d; the core semantics live in the host (WCore, [semantic-core.md](semantic-core.md)) with WGraph as its effect trace |

WCore and WGraph compose. WCore (semantic-core) is the host's value-and-control core for FS. Its effect handler
emits WGraph nodes. WGraph is what crosses into Bend.

## 13. Limits of this study

- **The native runs cover only the planar subset the spike links:** extrude, union and subtract. Every r10b and
  corpus statement about parallelism and reuse is **structural** (operation counts from traces), not measured
  kernel time.
- **Corpus traces are mock executions.** Speculated counts are unverified until a kernel runs them. Study-mode
  inputs (UI defaults, opaque imports, existing-context bodies) are assumptions, labelled per feature
  (`corpus.json`: `mode`, `inputs`). Success paths inside `try` are assumed.
- **Edit experiments multiply one literal by 1.05.** Edits that break the program are counted as failed and
  excluded. Literal edits are a proxy for design changes, not a sample of Marc's real edit history.
- **Thread scaling ran at load 15 to 19 on a shared machine, with at most 4 threads.** No Metal. No binding-level
  batched evaluator was built; the spike binary served as the executor.
- **Unmeasured claims:** the fidelity of the corpus graphs beyond the programs wonky can build; the value of WGraph
  text for LLM repair (H6).
