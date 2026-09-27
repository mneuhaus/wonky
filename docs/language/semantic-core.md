# Semantic core: what wonky's frontends already reduce to, and a core IR both can desugar into

Date: 2026-09-22. Role: semantics analyst for the question "should wonky get its own CAD language, native in
Bend, with FeatureScript, build123d and maybe JS as translation layers?". Machine: Apple M5 Pro, 18 logical CPUs,
shared with three other workflows (one-minute load average 12 to 15 during every run below). All timings are
indicative. Nothing here measures a native or GPU Bend evaluator; the core evaluator in this study is a JS
reference implementation.

Evidence labels: **[M]** measured by me for this chapter (script and output file named), **[O]** measured by
another workflow report (cited), **[D]** documented by the cited source, **[I]** my inference.

Related chapters: [prior-art.md](prior-art.md) (other systems, LLM results),
[../native-bridge/profile.md](../native-bridge/profile.md) (where wall time goes),
[../native-bridge/binding.md](../native-bridge/binding.md) (in-process Bend binding).

## 1. Answer in short

1. **Both frontends already reduce to the same small core.** Under the syntax there are: pure value computation
   (numbers with units, vectors, matrices, strings, arrays, maps), a store of immutable B-rep values, about ten
   kernel effects (sketch, extrude, loft, primitive, Boolean, rigid transform/pattern, delete, property, import),
   lazy queries plus measures that read geometry back, and provenance metadata (operation id, source span, call
   stack, evidence). The Python frontend's bridge protocol is literally a straight-line trace of six request
   kinds (`box`, `cylinder`, `translate`, `boolean`, `volume`, `unsupported`). [M, code reading]
2. **A 16-node expression core (WCore/0) is sufficient for everything wonky's FeatureScript parser accepts.**
   I built it as a prototype: a desugarer (FS AST to WCore/0, 339 lines) and a JS reference evaluator
   (304 lines) that reuses wonky's value operations and modeling builtins as its effect handler. Results [M]:
   - 10 of 10 examples produce bit-identical bodies (geometry revision hash, body id, identity origin id);
   - the project's language test cases (ported into the new test) give identical results or identical errors;
     only the step-budget error reports a different span, because the core counts steps differently;
   - the r10b scalar helpers give the same SHA-256 digest as the interpreter (122-point tray profile);
   - the frozen r10b fixture produces an **identical modeling-operation trace** through the core as through the
     interpreter: under the default strict policy all 12 calls with the same ids, spans, outputs and the same
     first failure; under the acceptance policy (tolerated-regularized contacts, cap 1e-7 mm) all 44 calls up
     to the same first failure at `model/UpperCore/g10/op` (`25:2`), the state the acceptance report records;
   - all 284 corpus FeatureScript files that wonky's parser accepts desugar without error (0.81 s for 19.1 MB).
3. **The hard parts are semantic, not syntactic.** Four things decide whether a Bend-native core is faithful:
   numeric semantics (FeatureScript is IEEE binary64; Bend has only F32 and the F32x2 `Real`), FeatureScript's
   dynamic features (overload resolution, type tags, boxes, the 146k-line standard library), the store's
   transaction rules (atomic operations, feature rollback, transient-reference invalidation), and the fact that
   build123d is executed by CPython, so it can only be traced or compiled from a restricted subset, not
   desugared from arbitrary source.
4. **Probes found five places where wonky today differs from documented or expected FeatureScript semantics**
   and that a core must decide explicitly: live instead of value capture in closures, non-atomic operations
   under `try` (`opPattern` leaves half its output), no rollback of failed nested features (std `defineFeature`
   aborts them), a failed operation keeps its id claimed, and a transient entity reference silently names a
   different edge after a Boolean. The prototype implements the first four the FeatureScript way (transactions
   behind an option) and lists the fifth as a hard case. [M]
5. **Form.** Make WCore an *internal core IR* and the contract between frontends and evaluator, with its effect
   catalog equal to the (handle-based) host-to-kernel surface the native binding is designing. Do not make a new
   human-facing language first. A pure dataflow graph is not enough as the core: 64 of 129 FeatureScript file
   families in Marc's corpus branch or loop on geometry or on operation failure (§4.4). [M over O's data]
6. **Where to parse.** Parse and desugar on the host (JS for FS, CPython tracing for build123d) and ship the IR
   with a span table. Shipping r10b's IR means about 226k U32 words, roughly 1.5 ms in-process by the binding
   stage's per-word cost, against 20 to 36 ms JS parse, 20 ms desugar and 55 to 255 s of r10b run time on the
   JS target, almost all of it kernel.
   Error messages lose nothing: runtime errors return a span id and the host formats them exactly as today.
   Parsing in Bend buys only a host-free CLI and costs a second parser plus all diagnostics in `List<Char>`.
7. **Order.** First fix the semantic decisions (§7), move geometric decisions that still run in JS into Bend
   kernel ops (needed for the binding anyway), adopt WCore in JS as the frontends' target, and only then port the
   WCore evaluator to Bend if a measured need appears. The interpreter is at most 0.7 % of wall time today [O].

## 2. Evidence base and how to reproduce

| Artifact | What it is |
|---|---|
| `src/lang/semcore/ir.mjs` | WCore/0 node set, primitive list, span table, S-expression printer, exact U32 word-encoding size |
| `src/lang/semcore/desugar-fs.mjs` | FeatureScript AST (from `src/parser.mjs`) to WCore/0 |
| `src/lang/semcore/eval.mjs` | JS reference evaluator (oracle); proper tail calls for join points; optional transactions |
| `src/lang/semcore/build.mjs` | Same inputs and outputs as `src/index.mjs build()`, via WCore/0 |
| `test/lang-semantic-core.test.mjs` | 6 focused tests: equivalence with the interpreter and the intended semantic changes |
| `scripts/lang/semantic-core-check.mjs` | IR sizes, corpus desugar census, r10b trace comparison (`--r10b`, `--tolerated`) |
| `scripts/lang/semantic-evidence.mjs` | 21 semantic probes through interpreter and core, AST sizes, builtin inventory, std boundary, sync-site aggregate |
| `scripts/lang/semantic-census.mjs` | Lexical census of `~/Workspace/cad` (read-only), reused from the interrupted earlier attempt |
| `out/lang/semantic-core-check.json`, `out/lang/semantic-evidence.json`, `out/lang/semantic-census.json` | The outputs cited below |

```sh
node --test test/lang-semantic-core.test.mjs                   # ~3 s, JS target
node scripts/lang/semantic-evidence.mjs                        # probes, ~15 s
node scripts/lang/semantic-core-check.mjs                      # IR + corpus census, ~25 s
node scripts/lang/semantic-core-check.mjs --r10b               # + r10b trace comparison, two ~55 s runs
node scripts/lang/semantic-core-check.mjs --r10b --tolerated   # acceptance policy, two ~4 min runs
```

Inputs read but not written: `src/*.mjs`, `python/*.py`, `fixtures/r10b/*` (unchanged), the Onshape standard
library mirror in `tmp/lang/onshape-std` (MIT, github.com/javawizard/onshape-std-library-mirror), the corpus
scan `tmp/lang/fs-facts.json` produced by `scripts/lang/scan-fs.mjs` (another stage), and Marc's corpus
`~/Workspace/cad` (read only).

## 3. What the two frontends call today

### 3.1 FeatureScript path

`src/parser.mjs` (298 lines) tokenizes and parses a bounded FS subset into a plain AST with token locations.
`src/interpreter.mjs` (270 lines) walks it with environments; `src/values.mjs` (165 lines) defines the value
domain and operators; `src/library.mjs`, `src/queries.mjs`, `src/modules.mjs` and `src/scalars.mjs` provide
71 builtins; `src/source-map.mjs` observes calls; `src/errors.mjs` defines the two error classes. [M]

| Category | wonky builtins (71 in total) | Where the work happens |
|---|---|---|
| Kernel operations (6) | `fCuboid`, `opExtrude`, `opLoft`, `opBoolean`, `opPattern`, `opDeleteBodies` | Bend (extrude, frustum, transform, five Boolean algorithms); the choice between the Boolean algorithms is made in JS (`src/boolean.mjs`) |
| Sketch (7) | `newSketchOnPlane`, `skRectangle`, `skPolyline`, `skLineSegment`, `skArc`, `skCircle`, `skSolve` | Accumulated in a mutable JS `Sketch`; line and line/arc profile assembly in Bend (`sketchLines.solve`, `sketch-arcs`) |
| Query constructors (7) | `qCreatedBy`, `qAllModifiableSolidBodies`, `qUnion`, `qSubtraction`, `qBodyType`, `qOwnedByBody`, `qSketchRegion` | Pure data (`TopologyQuery`), resolved later against the store |
| Query evaluation and measures (5) | `evaluateQuery`, `evBox3d`, `evLine`, `evVolume`, `evOwnerSketchPlane` | JS over decoded B-reps; planar volume from the JS validator `validateSolid` |
| Properties (2) | `setProperty`, `getProperty` | JS store fields |
| Imports (3) | `newInstantiator`, `addInstance`, `instantiate` | Frozen snapshot modules (`src/modules.mjs`); bodies transformed in Bend |
| Feature machinery (4) | `defineFeature`, `isLength`, `regenError`, `unstableIdComponent` | JS |
| Value and math (22) | `vector`, `plane`, `matrix`, `transform`, `inverse`, `dot`, `cross`, `norm`, `normalize`, `sin`/`cos`/`tan`, `sqrt`, `floor`/`ceil`/`round`, `abs`, `append`, `size`, `line`, `color`, `identityTransform` | JS binary64 |
| Units and constants (10), enums (5) | `meter` ... `foot`, `degree`, `radian`, `PI`, bound specs; `EntityType`, `BodyType`, `BooleanOperationType`, `PropertyType`, `BoundingType` | JS |

The modeling store (`ModelingContext`) holds `records` (key to `{kind: solid|sketch, body, createdBy: Set<IdKey>,
name, appearance}`), `sketches`, claimed operation `ids`, `operationEvidence`, a read-only flag for imported
contexts and the modeling policy. Operations mutate it in place.

### 3.2 build123d path

`src/python.mjs` starts real CPython (`-I -S -B`) with `python/runner.py` and the shim `python/build123d.py`
(221 lines). The shim executes the user program eagerly. Every constructor or operator sends one JSON request
over a private pipe; the host builds the B-rep in Bend immediately and returns an opaque handle. The six request
kinds are `box`, `cylinder`, `translate`, `boolean`, `volume` and `unsupported`. Python control flow, functions
and libraries run in CPython; only these requests reach wonky. Capability errors are latched by the host, so
`except BaseException: pass` cannot turn them into success. Shape ids are session-serial (`python/1`, ...),
therefore not stable when operations are inserted. [M, code; D, `docs/python-frontend.md`]

### 3.3 The shared layers below both frontends

| Layer | Implementation today | Used by |
|---|---|---|
| Unit arithmetic | `values.mjs` `Quantity(value, lengthPower, anglePower)` in SI, checked in `binary()` | FS only (Python uses bare millimeter floats) |
| Kernel constructors | `extrudeInBend`, `circularFrustumInBend`, `transformInBend`/`transformAnalytic`, `booleanInBend` | both |
| Identity and naming | `src/identity.mjs` marshals; `kernel/identity.bend` derives framed origin and instance keys from namespace, operation id, role and parent identities | both (FS ids are user ids; Python ids are serial) |
| Construction history | `src/construction-history.mjs`: operation evidence, construction budget, transform chain | both |
| Validation | `validateSolid` (JS: closure, orientation, planar volume and area) plus Bend audits in the analytic and Boolean paths | both |
| Source map | `callObserver` on geometric builtins (FS: line and column, parameters, call stack); Python: frame inspection (line only) | both |
| Export | `src/exporters.mjs` (STEP, STL), `src/preview.mjs` (HTML), `src/print-mesh.mjs` (Bend tessellation) | both |

The JS host calls about 65 distinct Bend functions directly (grep of `kernel.*(` call sites and their local
aliases in `src/*.mjs`). [M]
That is the host-to-kernel surface the native binding has to carry today.

### 3.4 Observations that matter for any core

- **Geometric decisions still run in JS.** `opBoolean` picks one of five Bend algorithms in `src/boolean.mjs`
  by classifying the operands in JS; `plane()` normalizes and orthogonalizes in JS; `body()` computes tolerance,
  extrusion height and profile orientation (`signedArea`) in JS; the pierce path computes axis and reach with
  `Math.hypot`; planar volumes come from the JS validator. These are not language semantics. They belong in
  Bend kernel operations regardless of the language decision, and the binding's surface gets cleaner if they
  move. [M, code reading; I]
- **Numbers cross from binary64 to F32/F32x2 at the kernel boundary** (`src/real.mjs`: `hi = fround(x)`,
  `lo = fround(x - hi)`, magnitude at most 1e20, no F32 underflow). `lineSketchPoint` additionally carries the
  original binary64 bits as four U32 words for identity. FS arithmetic itself is binary64 in JS. [M]
- **The interpreter is cheap.** FS parse plus interpreter is at most 0.7 % of wall time; r10b spends 47 ms in it
  out of 56 s [O, profile.md]. Warm, the interpreter-only share is 0.01 to 8.6 % of build time, the 8.6 % being
  0.15 ms of a 1.6 ms box [O, `out/lang/frontend-share.json`].

## 4. FeatureScript-specific semantics

### 4.1 Onshape's own core boundary

Onshape's standard library is itself FeatureScript. The local mirror has 265 files, 146,219 lines, 6.9 MB and
1,768 exported declarations; 131 exported function names are overloaded. It reaches the host through 266
distinct `@name(...)` builtins: 66 `@op*`, 47 `@ev*`, 19 `@sk*`, 3 feature transactions
(`@startFeature`, `@endFeature`, `@abortFeature`), 10 context-state builtins (variables, attributes,
properties) and 121 others (math, strings, matrices, pattern transforms, reporting). Queries are pure FS maps
tagged `Query` (`qCreatedBy` returns `{queryType: CREATED_BY, featureId, entityType} as Query`); only
`@evaluateQuery` touches the host. [M, `out/lang/semantic-evidence.json` stdBoundary]

Of the calls that Marc's corpus makes and wonky lacks, 26 names (487 file mentions) are pure FS in std
(`qEverything`, `qNothing`, `coordSystem`, `qGeometry`, `qContainsPoint`, `rotationAround`, `qClosestTo`,
`makeId`, ...), 15 names (554 mentions) wrap kernel builtins (`opTransform`, `skText`, `opFillet`,
`opOffsetFace`, `opRevolve`, `evPlane`, ...), 9 wrap value builtins, and 30 are Marc's own library functions.
[M] Roughly half of the missing surface is "language plus data", not kernel work.

### 4.2 Constructs and their semantics

| Construct | FeatureScript semantics | wonky today | WCore handling |
|---|---|---|---|
| Values | binary64 numbers, strings, arrays, maps, boxes, functions, builtins, undefined [D, FsDoc variables] | same subset except boxes | same; numbers binary64 (§6.7) |
| Value semantics | "values always behave as if copied on assignment" [D] | copy-on-write paths, tested | assignment is rebinding of an updated value; exact |
| Closures | capture undocumented; lambda equality compares "bound values (values captured from an enclosing block scope)" [D, FsDoc relational] | live binding: probe returns `closure sees 2` | value capture (probe returns 1); **verify in Onshape** |
| Context | one modeling context passed to every operation; operations mutate it | mutable JS store | implicit store threaded by the evaluator; `Context` is a handle |
| Ids | `Id` is an array of strings; `id + "x"` extends it; operation ids must be unique | same; uniqueness per build | same; ids are the key for kernel naming |
| `qCreatedBy(featureId)` | "all the entities created by a feature or operation"; split and merged results count as created by all creators [D, std query.fs] | exact id match only: with a sub-operation `id + "a"`, `qCreatedBy(id)` finds 0 bodies | expected to include sub-operation ids; **verify in Onshape**, then implement as query semantics |
| Features | `defineFeature` wraps the body in `startFeature`/`endFeature`; on error `@abortFeature` rolls back and rethrows for non-top-level ids [D, std feature.fs] | no rollback: probe keeps the failed sub-feature's body (2 bodies) | a feature call is a transaction (probe: 1 body) |
| Operation failure | undocumented; `try` around operations is common in the corpus | `opPattern` commits instance 1 before failing on instance 2 (2 bodies) | every effect is atomic (probe: 1 body) |
| `try` / `try silent` | a failed `try(expr)` yields `undefined`; every raised exception is reported in the notices flyout unless `try silent`; statement and expression forms [D, FsDoc exceptions] | expression form only (statement `try silent {` is a parse error); no notices | `handle` node with a silent flag; notices as a write-only log |
| Capability errors | not an Onshape concept | `UnsupportedFeatureError` passes through every `try` (AGENTS.md) | separate, uncatchable error class |
| Exceptions as values | "language errors are usually strings and library errors are usually maps with a `message` field" [D] | `catch (e)` binds a JS error object; `e.message` fails | `raise` carries a value; `regenError` should produce a map |
| Preconditions, annotations | parameter validation predicates and UI metadata | precondition statements must evaluate to `true`; defaults from `Default` annotations and `isLength` bounds | explicit `precondition` checks; defaults as function metadata |
| Overloads | most specific satisfying overload by arity and parameter types, otherwise an exception [D, FsDoc top-level] | `Duplicate declaration 'f'` | needs a dispatch node over guarded closures (§7) |
| Type tags, `is`, `as`, enums | `as` adds or removes a type tag; an enum value is the string with the enum's type tag [D] | ad-hoc classes; `BoundingType.BLIND` is a plain string, so `is BoundingType` is false | tagged values `T<v>`; enums as tagged strings |
| Boxes | `new box(v)`, `b[]`, identity equality [D] | parse error | heap cells; 45 uses in 21 std files, 0 in Marc's corpus: capability error until std is interpreted |
| Maps | any value as key; deterministic key order; `for (var k, v in map)` iterates in key order [D] | insertion order; map `for-in` is a parse error | ordered by FS value order; iteration defined |
| Lambdas `x => e` | valid [D] | parse error | sugar for `fn` |
| Versioning | `FeatureScript N;` header, std version gates (`isAtVersionOrLater`) | header required, versions not interpreted | frontend concern; the IR is versionless |
| Execution limits | not documented | 20M steps, call depth 64, 20k operations, 128 bodies | explicit budgets, equal to the Bend evaluator's fuel; resource errors (§6.6) |

### 4.3 Probe results

All probes are in `scripts/lang/semantic-evidence.mjs`; each runs through the interpreter and through the core
(transactions on). Full messages are in `out/lang/semantic-evidence.json`. [M]

| Probe | wonky interpreter | WCore reference | FeatureScript reference |
|---|---|---|---|
| valueSemantics | `a0=1 b0=9` | same | documented: same |
| closureCapture | `closure sees 2` | `closure sees 1` | undocumented, value capture implied |
| overloadByType | `Duplicate declaration 'f'` | same | documented: dispatch |
| arrowLambda, mapForInKeyValue, boxReference, trySilentStatementForm | parse errors | same | documented: valid |
| exceptionIsValue | member access on the error fails | same | documented: map with `message` |
| enumIsTypeTagged | `enum value is not tagged` | same | documented: tagged |
| trySilentCapability, undefinedNameInTry | `UnsupportedFeatureError` escapes | same | wonky policy (intended) |
| tryExpressionUndefined | `v is undefined: true` | same | documented: same |
| qCreatedByPrefix | `prefix bodies 0` | same | expected 1, to verify |
| nestedFeatureRollback | `bodies 2` | `bodies 1` | std source: 1 |
| opPatternPartialCommit | `bodies 2` | `bodies 1` | atomic expected |
| failedOpKeepsIdClaim | `Duplicate operation ID 'model/d'` | succeeds (`bodies 1`) | std notes that aborted ids should not be reused |
| staleTransientReference | `same edge after union: false, resolved: true`: edge 3 of the first cube now names a different edge of the union (stand-alone run `tmp/lang/semcore/stale-ref.mjs`: before `(0,10,0)` direction `(0,-1,0)`, after `(5,5,10)` direction `(0,1,0)`), no error | same | std: transient queries "are only valid until the context is modified again" |
| selfRecursiveConstLambda | works (depth 50) | works (compiled as `letrec`) | undocumented |
| recursionDepth | `Function call depth exceeded (64)` | same | undocumented |
| binary64Numbers | `(2^53+1)==2^53` is true, `0.1+0.2` prints `0.30000000000000004` | same | binary64 documented; formatting undocumented |
| unitsMismatch | `Incompatible units in expression` | same | documented error |

### 4.4 How often programs need geometry during evaluation

The corpus scan of another stage (`tmp/lang/fs-facts.json` from `scripts/lang/fs-analyze.mjs`, heuristic
classification) marks *geometry-synchronization sites*: places where control or data flow depends on a value
only the kernel can produce. Aggregated over 129 file families (revisions clustered) [M over O's data]:

| Family class | Families |
|---|---|
| no reachable sync site | 12 |
| only checks (assertions and emptiness guards on query results) | 53 |
| genuinely dynamic: loops over evaluated entities, measure-driven decisions, entity selection, measured parameters, topology decisions | 52 |
| failure-driven only (`try` rethrow or recover, `try silent` blocks) | 12 |

Checks can become check nodes in a static graph. The other 64 families (50 %) need either geometry-dependent
control flow in the core or a graph that expands during evaluation. That rules out a pure static DAG as *the*
core language. A trace of executed operations is still a DAG and remains useful for caching (§8.4). [I]

### 4.5 Corpus coverage of today's parser

Of 384 unique FeatureScript files at census time (562 with copies; the live corpus had 385 in the final run),
wonky's parser accepts 283. Of the 101 failures, 84 are
header-less fragments and evaluation lambdas (`function`, `var`, `const`, `annotation` or `export` as first
token), 9 are `try {` without `catch` or `try silent {`, 4 are `for (var k, v in map)`, 1 is a `\u` escape and
3 are other syntax. [M, `tmp/lang/parse-fail-detail.mjs`] Fragments are an input form the FS frontend should
accept as a separate entry point; they add no new semantics.

## 5. build123d-specific semantics

| Construct | build123d semantics | Core mapping | Hard part |
|---|---|---|---|
| Algebra objects `Box`, `Cylinder`, ... | immutable shape values created eagerly | pure kernel functions returning body values (no store) | none; this is the simplest part of the core |
| Operators `+ - &` on shapes | union, subtraction, intersection | Boolean kernel function on values | operand lists (compounds) |
| `Pos(...) * shape`, `Rot`, `Location`, `Plane * ...` | location composition, then placement | transform values and a transform kernel function | general rotations; `Location` algebra |
| Builders `with BuildPart() as p:` | an implicit context stack; objects created inside add themselves to the innermost builder according to `mode=` | explicit accumulator threading, the same pattern as an FS context | implicit dynamic scope must become explicit |
| `Locations`, `GridLocations`, `PolarLocations` | objects created inside are placed at every active location | a loop over locations inside the accumulator update | the multiplication of objects is implicit |
| `mode=Mode.ADD/SUBTRACT/INTERSECT/REPLACE/PRIVATE` | how a new object combines with the builder's result | Boolean or replace on the accumulator | none |
| Selectors `.edges()`, `.faces()`, `filter_by`, `sort_by`, `group_by`, `>`, `<`, `>>`, `<<`, `\|`, `[i]` | eager lists of concrete shapes, sorted, grouped or filtered by geometric properties; `>>` is the last group, `<<` the first [D, build123d docs] | `query.evaluate` plus measures plus pure list operations | deterministic tie-breaking and grouping tolerance; the result is an entity reference that must stay valid |
| `Select.LAST` / `Select.NEW` | "the features the last operation brought in or created" [D] | same as `qCreatedBy(lastOperationId)` | needs stable operation ids |
| Units | none; floats in millimeters by convention | dimensionless numbers | FS and build123d disagree on units; the core must keep both |
| Host language | arbitrary Python: functions, classes, comprehensions, exceptions, libraries | trace (today) or a restricted-subset compiler | see below |

Marc's build123d corpus [M, `out/lang/semantic-census.json`]: 294 unique files; 275 use only Algebra mode and 19
use builders. Python host features are everywhere: numpy in 99 files, list comprehensions in 162, f-strings in
176, lambdas in 62, classes in 33, dataclasses in 22, `try/except` in 59, Marc's `cad_khana` wrapper in 69.
Selectors appear in 54 (`.edges()`), 44 (`.faces()`), 17 (`filter_by`), 10 (`group_by`) and 61 (indexing)
files. Only 1 file stays within today's shim surface (`Box`, `Cylinder`, `Pos`, no method calls).

Consequences [I]:

- build123d cannot be *desugared from source* into a Bend core in general, because its meaning includes
  CPython. Today's frontend already does the only general thing: it runs CPython and **traces** the kernel
  requests. A trace is a valid WCore program (a straight line of `let x = call(kernel-op, literals)`), but it
  has lost the parametric structure: re-running with other parameters means re-running Python.
- A **restricted Python compiler** (functions, loops, arithmetic, lists, Algebra objects, builders, selectors)
  could produce real WCore programs, for example for LLM-written parts, and must reject everything else at
  compile time with a capability error at the Python span. Its own hard cases: unbounded Python integers,
  insertion-ordered dicts, exceptions, `with` blocks, keyword arguments.
- Traced build123d needs **stable operation ids** derived from the source (for example call-site span plus
  call path plus occurrence counter) instead of `python/N`. Otherwise kernel naming (`kernel/identity.bend`)
  cannot preserve identities across edits; `docs/topology-identity.md` already requires stable frontend ids.

## 6. The proposed core calculus (WCore/0)

WCore/0 is what `src/lang/semcore/` implements. It is deliberately small; §6.9 lists what later versions need.

### 6.1 Values

```
v ::= undefined | true | false | n            -- n: IEEE binary64
    | s                                        -- string
    | q = <n, d>                               -- quantity, d = exponent vector (today: length, angle)
    | [v, ...]                                 -- array; Vector and Id are tagged arrays
    | {v: v, ...}                              -- map, ordered by FeatureScript value order
    | T<v>                                     -- type-tagged value (enums, Query, LengthBoundSpec, user types)
    | clo(fn, rho)                             -- closure: code plus captured *values*
    | builtin(b)                               -- operation from the effect catalog
    | handle(h)                                -- store-resident object: Context, Sketch, body, entity reference
    | box(l)                                   -- heap cell (reserved; capability error in WCore/0)
```

The prototype reuses wonky's JS classes for these values (`Quantity`, `Vector`, `KeyedMap`, `EnumValue`, ...),
which is why its results are bit-identical.

### 6.2 Terms

Sixteen node kinds, all expressions (JSON arrays whose first element is the tag):

```
e ::= lit v | undef | var x | glob g
    | let x = e in e | letrec (x = fn)* in e | fn(x*) e
    | call e(e*) | prim p(e*) | if e then e else e
    | list [e*] | map {e: e}* | ctor #t(e*) | case e of (#t(x*) -> e)*
    | handle e with x -> e [silent] | raise e
```

`prim` covers the operators (`+ - * / % ^ == != < <= > >= ~ neg not`), `index`, `update` (a value-semantic
path update), `is`/`as`, `enum`, and explicit runtime checks (`check-type`, `precondition`, `fail`). Nodes that
can fail carry a span id. There are no statements, no mutable variables and no loops.

### 6.3 Desugaring FeatureScript

| FeatureScript | WCore/0 |
|---|---|
| `var x = e; ...` / `const` | `let x.1 = e in ...` |
| `x = e`, `x += e`, `a.b[i] = e` | `let x.2 = e` / `let x.2 = x.1 + e` / `let a.2 = update(a.1, ["b", i], e)`; evaluation order as in the interpreter (keys last-first, root, value, target) |
| `if (c) A else B; rest` | `let j = join(vars assigned in A or B) -> rest in if c then A; j(...) else B; j(...)` |
| `while`, `for (;;)`, `for (var x in a)` | `letrec loop(i, assigned vars) = if c then body; next(...) else after(...)`; `next` runs the increment |
| `break` / `continue` / `return e` | call of `after` / call of `next` / the value `e` in tail position |
| `try { B } catch (e) { H }; rest` | `B` and `H` end in `#N(vars)`, `#R(v)`, `#B(vars)` or `#C(vars)`; a `case` after the `handle` continues, returns, breaks or continues, so exceptions raised in `rest` are never caught by this `try` |
| `try(e)`, `try silent(e)` | `handle e with _ -> undefined [silent]` |
| `throw e` | `raise e` |
| `f(x is T) returns R precondition {...} {...}` | parameter `check-type`s, `precondition` checks, `check-type` on every return |
| top level | ordered global definitions, late-bound (`glob`); duplicate names fail as today |
| lambdas | `fn`, capturing values; `const f = function ... f(...)` becomes `letrec` |

Only variables assigned inside a construct flow through its join points; everything else is captured where the
join point is defined. This cut the corpus IR by about a quarter against threading every mutable variable. Example, a loop
with `continue` (printed with `printIR`; the `rhs`/`cur` temporaries of `+=` are elided):

```
(fn (n.0)
  (let _param.18 (check-type n.0 "number")
  (let total.1 0
  (let i.6 1
  (let after.2 (join (total.5) (check-type total.5 "number"))
  (letrec ([loop.3 (join (total.7 i.8)
             (if (<= i.8 n.0)
               (let join.9 (join () (let total.12 (+ total.7 i.8) (next.4 total.12 i.8)))
               (if (== i.8 3) (next.4 total.7 i.8) (join.9)))
               (after.2 total.7)))]
           [next.4 (join (total.13 i.14) (let i.17 (+ i.14 1) (loop.3 total.13 i.17)))])
  (loop.3 total.1 i.6)))))))
```

Source: `function sumTo(n is number) returns number { var total = 0; for (var i = 1; i <= n; i += 1)
{ if (i == 3) continue; total += i; } return total; }`.

### 6.4 Binding, functions and closures

- All bindings are immutable; names are unique after desugaring (a Bend encoder would use de Bruijn indices,
  as the spike's compiler `src/lang/spike-compile.mjs` does).
- A closure captures the **values** of the locals it references at creation. This makes the translation of
  mutable locals into rebinding exact, and it matches FeatureScript's value semantics and its documented lambda
  equality. It differs from wonky today only when a captured variable is reassigned after the lambda was
  created, or assigned from inside the lambda.
- Recursion: top-level functions are late-bound globals (mutual recursion allowed); local recursion uses
  `letrec`. Join points and loops are `letrec` functions called in tail position; the reference evaluator runs
  them as proper tail calls and does not count them against the FS call-depth limit.

### 6.5 Effects: the store and the kernel

The prototype treats every builtin in the effect catalog as an effect on one implicit store, handled by
wonky's `ModelingContext`. The design this points to has two layers [I]:

1. **Pure kernel functions on immutable values**: `extrude(profile, plane, delta, offset)`, `frustum(...)`,
   `box(...)`, `transform(body, rigid)`, `boolean(kind, bodies...) -> bodies`, `measure.*(body) -> value`,
   `select(query, bodies) -> entity refs`. Deterministic, cacheable by input hash, parallelizable. build123d's
   Algebra mode needs nothing else.
2. **Store bookkeeping** for FeatureScript: a persistent map from creation id to body plus lineage
   (`createdBy`), sketches, claimed ids, properties, notices and evidence. `opBoolean(context, id, def)` is
   "resolve the queries, call `boolean` on values, update the map".

Rules the core fixes (the first two implemented in the reference evaluator with `transactions: true`):

- **Atomic effects.** An effect either completes or leaves the store unchanged (snapshot and restore; with a
  persistent store in Bend this is free: keep the old value).
- **Feature transactions.** Calling a `defineFeature` value is begin, body, commit; a model exception aborts
  and rethrows, mirroring std's `startFeature`/`@abortFeature`.
- **Queries are data**, evaluated against the current store at `evaluateQuery` or operation time.
- **Entity references carry the body revision.** Using a reference after its body changed must resolve through
  persistent identity (`kernel/identity.bend` instance ids) or fail explicitly. Index-based resolution silently
  picks a different edge today (probe `staleTransientReference`). Not implemented in the prototype.
- **Notices** (reported exceptions of non-silent `try`) are a write-only log, never control flow.

In the r10b runs the transactional evaluator made 13 (strict) and 45 (acceptance policy) store snapshots with
one rollback each (the failing operation); both traces were unchanged.

### 6.6 Errors with source spans

| Class | Raised by | Catchable by `try`/`handle` | Carries |
|---|---|---|---|
| Model exception | `raise`, `regenError`, operation failure, type, arity and precondition checks, units | yes | value, span id |
| Capability error | missing kernel or library capability, unsupported syntax or import | never (also not by `try silent`) | message, span id |
| Resource error | step budget, call depth, operation and body limits | should be never | budget, span id |

Every error also carries the stack of call-site span ids (the source map's `callStack` today). The host maps
span ids to file, line, column and excerpt exactly as `src/source-map.mjs` does. Wonky's step and depth limits
are currently ordinary, catchable `FeatureScriptError`s: a caught depth error lets execution continue.

### 6.7 Determinism

- Strict left-to-right evaluation; the evaluation order of assignments is the interpreter's.
- Map iteration by FS value order, not insertion order.
- Query results ordered by record creation, then entity index, frozen as part of the specification.
- Numbers: IEEE binary64 for `+ - * / %`, comparisons and `sqrt`; transcendental functions come from one pinned
  implementation (V8 today), so results are reproducible for wonky but not guaranteed bit-equal to Onshape.
- Number-to-string conversion (`~`) is part of the semantics because strings become ids and names; today it is
  JavaScript's shortest round-trip format.
- No clocks, randomness or environment; imports only from hash-pinned frozen snapshots (as `src/modules.mjs`
  already enforces).
- Parallel evaluation is allowed only for effect-free subterms or effects on disjoint bodies, and must give the
  sequential result.

### 6.8 Budgets

The interpreter's step budget becomes the evaluator's fuel. Bend requires fuel for non-structural recursion
anyway, so one number bounds both the object program and the Bend evaluator. Step counts of the core differ
from the interpreter's (join points, lets), so budgets are comparable, not equal (r10b: 2,141 core steps up to
its first failure under the strict policy, 4,643 under the acceptance policy).

### 6.9 What WCore/0 does not cover yet

Overload dispatch (a guarded-closure node), type tags for user types (`typecheck` predicates), boxes, map
iteration, notices, stable Python operation ids, revision-checked entity references, and the numeric-domain
decision for a Bend evaluator (§7, case 1).

## 7. Hard translation cases

| # | Case | Evidence | Handling |
|---|---|---|---|
| 1 | Numeric domain: FS binary64 vs Bend F32 and F32x2 (about 48 significand bits, magnitude at most 1e20) | FsDoc; `kernel/real.bend` header; `src/real.mjs` | Keep FS arithmetic binary64. In JS this is free. A Bend evaluator needs a soft-float binary64 over U32 pairs (feasible, the arithmetic count is small) or a documented divergence with a tolerance; control decisions near thresholds make the latter risky |
| 2 | Number formatting in `~` feeds ids and names | probe `binary64Numbers` | Specify shortest round-trip formatting; implement it in every evaluator |
| 3 | Closure capture (value vs live) | probe `closureCapture` | Value capture in the core; verify in Onshape before freezing |
| 4 | Operation atomicity, feature rollback, id claims | probes `opPatternPartialCommit`, `nestedFeatureRollback`, `failedOpKeepsIdClaim`; std feature.fs | Transactions in the core (implemented); the r10b trace is unchanged by them |
| 5 | Stale transient references | probe `staleTransientReference`; std query.fs | Revision-checked entity references resolved through persistent identity, otherwise an explicit error |
| 6 | `qCreatedBy` sub-operation semantics | probe `qCreatedByPrefix` | Verify in Onshape; then a query-semantics change, independent of syntax |
| 7 | Overload resolution by type | 131 overloaded std names; probe `overloadByType` | Dispatch node over guarded closures; specificity order computed by the frontend; ambiguity is a model error |
| 8 | Type tags and `typecheck` predicates; enums as tagged strings | probe `enumIsTypeTagged` | `T<v>` values; `as` adds or removes tags |
| 9 | Boxes | 45 uses in std, 0 in the corpus | Heap cells behind a capability error until the std library is interpreted |
| 10 | Standard library (146k lines, 1,768 exports, 266 `@` builtins) | §4.1 | Either keep reimplementing std functions natively, or interpret the MIT std source over the `@` boundary; the latter needs cases 7 to 9 and version gates first |
| 11 | Map key order and map `for-in` | FsDoc; 4 corpus files fail to parse | FS value order; one parser rule plus one desugaring rule |
| 12 | Capability errors inside `try silent` | AGENTS.md; probes | Separate uncatchable class (implemented) |
| 13 | Header-less fragments and evaluation lambdas | 84 of 101 parse failures | A second FS entry point; no new semantics |
| 14 | Geometry-dependent control flow | 64 of 129 families | Full language with effects, not a static graph |
| 15 | build123d as CPython | corpus: numpy in 99 files, classes in 33, `cad_khana` in 69 | Trace (today) or a restricted compiler with compile-time capability errors |
| 16 | build123d builders (implicit context), `Locations`, `mode=` | 19 builder files | Explicit accumulator threading in the compiler; the same mechanism as the FS store |
| 17 | build123d selectors and grouping tolerance | 54, 44, 17 and 10 files | Query plus measure plus list primitives with specified tie-breaking and tolerance |
| 18 | Stable operation ids for traced Python | `python/N` today; topology-identity.md | Ids from call-site span, call path and occurrence counter |
| 19 | Resource errors are catchable today | `interpreter.mjs` uses `fail()` for limits | Own class, not catchable |
| 20 | Deep IR nesting from long straight-line blocks | one corpus file has a 1,636-statement block (IR depth 2,426) | Evaluators and encoders must not recurse on `let` bodies (the JS evaluator loops; the desugarer builds straight-line runs iteratively after the first version overflowed the JS stack on exactly this file) |

## 8. Where to parse, and what it means for error messages

### 8.1 Measurements [M, `out/lang/semantic-core-check.json`, `out/lang/semantic-evidence.json`]

| Input | Source | AST | WCore/0 | Parse (JS) | Desugar (JS) |
|---|---|---|---|---|---|
| `fixtures/r10b/r10b.fs` | 404,086 B | 43,924 nodes (19,173 number literals, 8,146 arrays) | 45,937 nodes, 19,244 numbers, 43,765 spans, 226,312 U32 words = 905 KB, depth 507 | 20 to 36 ms | 20 to 21 ms |
| 10 examples | 0.6 to 1.7 KB | 52 to 229 nodes | similar | 0.02 to 0.07 ms | < 1 ms |
| 284 parseable corpus files (final run) | 19.1 MB | | 3.1 M nodes, 62 MB of words (3.3 B per source byte) | | 0.81 s in total |

r10b end to end (frozen imports, feature `singleStepR10b`), interpreter vs WCore reference, JS target:

| Policy | Operations | Trace | First failure | Wall (interpreter / core) | Load average |
|---|---|---|---|---|---|
| strict (default) | 12 / 12 | identical (name, operation id, status, span, error, outputs, removed bodies) | same: `g2` at `25:2`, curved convex-tool intersection unresolved | 54.8 s / 57.2 s | 12.7 to 14.4 |
| tolerated-regularized, cap 1e-7 mm (acceptance) | 44 / 44 | identical | same: `g10` at `25:2`, general trimmed-face Boolean not implemented | 254.9 s / 252.9 s | 13.2 to 14.8 |

The word encoding (`irStats`) is deliberately naive: every node tag, every number as two words of binary64 bits,
every span as two words, strings interned. Spans are 39 % of r10b's words and numbers 17 %; packed numeric
array literals and delta-coded spans would shrink it several times. [M, I]

Cost of shipping, derived from other stages' measurements [O, I]: the in-process binding costs about 0.5 us per
call and 6 to 7 ns per U32 word and direction (Bend cons lists) [binding.md], so r10b's IR is about 1.5 ms one
way. Through the out-of-process baseline service it would be about 29 ms per MB [baseline.md]. For comparison,
r10b runs 55 s (strict) to 255 s (acceptance policy) on the JS target, almost all of it in the kernel; even a
25x faster kernel would leave 2 to 10 s.

### 8.2 Option A: the host parses and desugars, Bend evaluates a serialized IR (recommended once Bend evaluates)

- One parser per surface language stays on the host, next to editor tooling, the viewer and the source map.
  Precise error feedback is one of the strongest measured levers for LLM-written CAD code (prior-art.md
  §4.3); host-side parsing and formatting keep that feedback at full quality.
- Runtime errors come back as `{class, span id, message or value, span-id stack}`. The host formats them with
  today's `FeatureScriptError.format` (`file:line:column: message`) and the source-map excerpt. Nothing is lost,
  because the span table never has to leave the host.
- What the evaluator still owns: value formatting for `~` and for error payloads, including binary64 printing.
- build123d fits the same contract: CPython (or a restricted compiler) on the host emits WCore.

### 8.3 Option B: parse in Bend too

- Buys a host-free native CLI that can run `.fs` files directly.
- Costs a second parser that must agree with the host parser (tooling still needs one), written without mutual
  recursion (an explicit-stack parser, as `kernel/lang/spike/tokenize.bend` starts to do), and all diagnostics
  built from `List<Char>`.
- Does not help build123d at all.
- A standalone CLI can instead load a cached IR file keyed by the source hash, so option B is not needed for
  that either. [I]

### 8.4 A dataflow graph as a derived view

The executed operation trace (ids, parameters, parent ids) is a DAG. It is the right structure for caching
kernel results by input hash and for incremental rebuilds, and it is what the build123d frontend produces today.
It should be derived from evaluation, not be the source language (§4.4). [I]

## 9. Recommendation: form and order

**Form.** A combination:

1. **WCore as the internal core IR** and the stable contract between frontends and evaluator. It is small
   (16 node kinds), shown sufficient for wonky's FS subset, and it makes the semantic decisions explicit.
2. **Its effect catalog equals the host-to-kernel surface** the native binding designs: coarse, handle-based
   kernel functions on immutable bodies plus store bookkeeping. Design these once.
3. **No new human-facing language now.** prior-art.md finds that only one new CAD language survived (with a
   funded team), that LLMs write Python (build123d, CadQuery) far more reliably than languages with little
   training data, and that even FeatureScript needed fine-tuning in CADFS. If an LLM-facing surface is wanted
   later, it is one more frontend over WCore.
4. **A dataflow graph** only as a derived view (§8.4).

**Order.**

1. Decide the semantic questions in §7 (closure capture, transactions, stale references, `qCreatedBy`
   prefixes, resource errors) and check the open ones in Onshape through the session bridge. The probe sources
   in `scripts/lang/semantic-evidence.mjs` are ready-made test features.
2. Move geometric decisions from JS into Bend kernel operations (Boolean dispatch, plane normalization,
   orientation, planar volume). A clean native binding needs this anyway.
3. Finish the native binding with resident handles (in flight; binding.md shows residency works).
4. Replace the AST interpreter by desugaring to WCore plus the JS evaluator. The prototype already reproduces
   all examples and the r10b trace; add overloads, type tags, map iteration and notices. Let the Python tracer
   emit WCore traces with stable ids.
5. Port the WCore evaluator to Bend only for a measured reason (resident native sessions without JS, parallel
   evaluation of independent features, a host-free CLI). Prerequisites: the numeric-domain decision (soft
   binary64 or a stated divergence), map order and number formatting in Bend.
6. Decide the std-library strategy (reimplement vs interpret the MIT source over `@` builtins) after step 4,
   when overloads and type tags exist.

## 10. What this study does not show

- It does not evaluate WCore in Bend; the Bend feasibility spike (`kernel/lang/spike/`,
  `src/lang/spike-compile.mjs`) covers that.
- It does not desugar build123d; the mapping in §5 is analysis, and the trace path is today's frontend.
- It proves equivalence only for the FeatureScript subset wonky's parser accepts. Overloads, boxes, type
  declarations and map iteration are rejected exactly as today.
- The r10b comparison covers the operations up to r10b's first failure under each policy, not a complete build
  (wonky does not yet accept the fixture).
- The corpus sync-site classification is another stage's heuristic; the numbers in §4.4 inherit its accuracy.
