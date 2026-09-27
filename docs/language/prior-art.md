# Prior art: code-CAD languages, LLM code-to-CAD, and compiler lessons for wonky

Date: 2026-09-22. Role: prior-art research for the question "should wonky get its own CAD language,
native in Bend, with FeatureScript, build123d and maybe JS as translation layers?".
This chapter does not decide the question. It collects what other projects did, what they later
changed, and what research has measured. Section 6 ("Lessons for wonky") turns that into
constraints and testable claims for the prototype stages.

Evidence labels used below:

- **[D]** documented by the cited source (docs, code, paper, release notes).
- **[M]** measured by me for this chapter (load average recorded next to it).
- **[I]** my inference from the cited evidence.
- **[H]** hearsay or self-reported claim that nobody independently reproduced.

Numbers from different LLM papers use different models, datasets and metrics. They show directions
and effect sizes inside one paper. They are not comparable across papers.

## 1. Short answer

1. Every mature code-CAD system that has several ways in (GUI, several languages, agents) funnels
   them into **one small operation layer**. Examples: Onshape's `op*` functions over a `Context`,
   KCL's "modeling commands" sent to Zoo's engine, Manifold's lazy CSG node DAG, Cadova's hashable
   geometry nodes, Fidget's expression tapes, and Curv's statically typed SubCurv subset.
   Compilers do the same (GHC Core, MLIR, Wasm). [D] An internal core IR is well supported by
   prior art. [I]
2. Only one project built a **new human-facing CAD language** and kept it alive: Zoo's KCL. It took a
   funded team (53 GitHub contributors). The KCL implementation in `kcl-lib` is about 6.1 MB of Rust
   source. KCL went through three language versions with breaking changes. In September 2026 Zoo
   still ships fixes for topology tags that get lost through Booleans. [D] Curv, CADmium and Fornjot
   are archived, and so is the Fornjot kernel. [D]
3. LLMs write **Python (CadQuery/build123d)** much more reliably than CAD languages they rarely saw
   in training. GPT-4 did poorly on raw FeatureScript, so the MIT authors fell back to a mini DSL.
   KCL's own designer writes: "there is not much code to train AI on". CADFS got good results with
   FeatureScript, but only after fine-tuning on 451k cleaned real programs. Its invalid-output rate
   was still 9 % against 3 % for the CadQuery baseline, which the authors attribute to missing
   pretraining data. [D]
4. Several **language properties** measurably help LLMs, and none of them needs new syntax. The
   measured ones are stable deterministic identifiers, explicit parametrization (line endpoints
   rather than origin plus direction), a global coordinate frame, given overall dimensions,
   de-entangled operations, and real kernel measurements fed back to the model. For example,
   standardized FeatureScript had an invalid rate of 10 % against 56 % for raw FeatureScript. Kernel
   measurements in the loop raised median IoU from 0.81 to 0.96. [D]
5. For wonky, the surface-language interpreter is not where the time goes. FeatureScript parsing
   plus interpretation is at most 0.7 % of wall time (r10b: 47 ms of 56 s). The in-process Bend
   binding costs about 0.5 µs per empty call. [D, from docs/native-bridge] So a Bend-native
   *surface* language brings no measured speed benefit. A Bend-evaluated *core IR* could, through
   batching, fork-join over independent subgraphs and content-addressed caching. That still has to
   be measured. [I]
6. Recommended reading of the evidence: build **a core IR evaluated in Bend**, fed by the existing
   FeatureScript and build123d frontends. Give it a canonical text form for tests, diffs and LLM
   inspection, but make it **not** a new authoring language. Design it together with the
   native-binding call surface. The Boolean/r10b critical path stays first. Decide on a new surface
   syntax only after measured LLM and human task results. [I]

## 2. Comparison table: code-CAD systems

Stars, dates and activity are from `gh api` on 2026-09-22. "Topology references" means how the
user names a face or edge for a later operation such as a fillet.

| System | Surface language | Geometry core | Evaluation / internal form | Topology references | Introspection | Status | One lesson for wonky |
|---|---|---|---|---|---|---|---|
| **Zoo KCL** | New DSL: dynamically typed, functional, pipelines `\|>`, keyword args, units in numbers | Proprietary GPU B-rep engine, cloud-hosted | Rust interpreter (WASM in the app) emits modeling commands over WebSocket; AST-diff cache | Tags `$name` on segments, which become faces after extrusion. `START`/`END`, `getOppositeEdge`, named sketch-block segments | Artifact graph with source ranges, snapshots, mock execution | Active. `modeling-app` 1,302★, 53 contributors, `kcl-186` released 2026-09-22 | A new language is a multi-year, team-sized product. Its interpreter/engine split mirrors wonky's JS/Bend split. |
| **Onshape FeatureScript** | Own language (C/JS-like), `defineFeature`, maps as arguments, units `5 * inch` | Parasolid (Onshape servers) | Features are FS functions. They mutate a `Context` through `op*` operations (64 exported in `geomOperations.fs`). The whole feature list regenerates. | **Queries** (`qCreatedBy(id + "extrude1", EntityType.FACE)`), about 77 query types, hierarchical ids | `ev*` functions (`evBox3d`, `evVolume`), `evaluateQuery` | Since 2016. The std library is open (MIT). Behaviour is version-gated. | Ids plus queries are the robust part. Verbosity is the price. |
| **build123d** | Python library. Builder mode (`with BuildPart()`) and algebra mode (`Box() - Cylinder()`) | OCCT | Eager Python calls into OCCT | Geometric selectors (`sort_by`, `filter_by`, `group_by`) plus `Select.LAST/NEW` history | Full OCCT queries (volume, bounding box, …) | Active. 3,182★ (since 2022) | Python host means the largest LLM prior. Selectors are geometric, not semantic. |
| **CadQuery** | Python fluent API (`Workplane(...).box().faces(">Z")`) | OCCT | Eager, with a Workplane stack | String selectors `">Z"`, `"\|Z"`, `"%Plane"` with boolean combinators | Full OCCT | Active. 5,815★ | The dominant LLM research target (section 4). |
| **OpenSCAD** | Own pure functional DSL | Mesh CSG. CGAL, and Manifold by default in development builds since 2025 | CSG tree, evaluated on render | None (no fillets, no faces) | None: no bounding box or size of a child object (issues #586, #1088, #4520, open since 2013/14) | Active. 10,266★ | Missing introspection is a long-lived complaint. The successors (PythonSCAD, µcad) moved to or towards general languages. |
| **JSCAD** | JavaScript functions | Mesh CSG via BSP trees | Eager pure functions | None | `measurements` module | Active. 3,245★ | A host-language DSL costs almost nothing to build. |
| **replicad** | JS/TS library, "inspired by CadQuery" | OCCT via opencascade.js (WASM) | Eager | `EdgeFinder`/`FaceFinder` objects | OCCT | Active. 686★ | Finder objects are selectors as data. |
| **Curv** | New pure functional, dynamically typed language | F-rep (signed distance) | Interpreter evaluates to a shape value. The **SubCurv** static subset compiles to GLSL/C++ | n/a | Records such as `bbox` | GitHub repo archived 2023; maintained on Codeberg | Two stages: dynamic host evaluation, then a static core for the fast engine. |
| **libfive** | Guile Scheme and Python bindings, generated from the C stdlib | F-rep expression trees | C++ core with a C API; Studio live-codes | n/a | Evaluation of trees | Slow (last push 2025-11). 1,665★ | One core, several generated frontends. |
| **Fidget** | Rhai scripts (plus Python via third parties) | F-rep | Math graph with hash-consing, then SSA tape, then bytecode VM **or** JIT, with interval tape simplification | n/a | Point, interval and gradient evaluators | Active. 494★ | JIT is 31× faster than the VM on a 7,867-node expression, but only 25 % faster once tapes are simplified. |
| **ImplicitCAD** | OpenSCAD-like "extopenscad" (Haskell) | F-rep | Interpreter | n/a | Limited | Low activity. 1,577★ | An OpenSCAD clone kept OpenSCAD's language limits (Curv's rationale). |
| **Fornjot** | Rust (models are Rust crates loaded as dynamic libraries) | Own B-rep | Batch kernel. The final design built an approximation plus topology at construction time | Rust values | Weak ("batch kernel with no insight" is called a root mistake) | Archived 2026-06 | Scope and vision drift killed it before language questions mattered. |
| **Manifold** | C++ API with JS/WASM and Python bindings, immutable method chaining | Guaranteed-manifold meshes | **Lazy CSG DAG**: reorders unions, runs Booleans in parallel, flattens, shares cached nodes | `faceID`/`originalID` provenance through Booleans | Mesh properties | Active. 2,284★ | A lazy DAG gives parallelism and caching for free, but only for order-independent operations. |
| **SolveSpace** | GUI; `libslvs` solver API | Own NURBS/mesh | Groups regenerate in order | Handles derived from `(group, request, index)`, `REMAP_TOP/BOTTOM/...` roles. Solid edges have no persistent ids (issue #1236) | Constraints | Active. 4,165★ | Deterministic ids derived from structure. |
| **Dune 3D** | GUI | OCCT plus the SolveSpace solver | Groups | Built to avoid FreeCAD's "perils of referencing things" | Constraints | Active. 2,088★ | Reuse the best solver and kernel, then fix the workflow. |
| **CADmium** | Rust library plus Svelte GUI; JSON `.cadmium` history | truck (Rust B-rep) | History of step messages | Face index instability noted by its author | n/a | Archived | Face indices "jump" when counts change. |
| **Cadova** | Swift result-builder DSL | Manifold | Abstract layer, then a **hashable, Codable `GeometryNode` layer**, then a geometry cache keyed by node | n/a | `measuringBounds { … }` inside the tree | Active. 421★ | A two-layer design: node IR plus content-keyed cache. The compile loop is 35–75 s for a clean build. |
| **Grasshopper** | Visual dataflow in Rhino | Rhino | Component DAG. A change expires all downstream components, which recompute | Data trees | Per-component preview | Commercial | Dataflow gives incremental recompute. Data trees are the usability price. |

Sources for the table are in section 7. Details follow in section 3.

## 3. System notes

### 3.1 Zoo KCL (KittyCAD Language)

**Why a new language.** KCL's language designer Nick Cameron writes that "KCL is very domain-specific;
it is not a general purpose programming language". It is designed "for an audience of CAD users",
and treating them as "beginner software engineers" would be "wildly incorrect". The KCL code "fully
describes the content and is the source of truth" for both GUI and text editing. It is "fully
deterministic". [D] ([KCL part 0](https://www.ncameron.org/blog/kcl-part-0/), 2025-10-22).
The KCL book gives the same reason: "Existing languages require you to learn a bunch of little
details that matter a lot to programmers, but aren't really important to mechanical engineers." [D]
Every GUI click generates KCL. [D] ([kcl-book intro](https://zoo.dev/docs/kcl-book/intro.html)).
GUI edits are AST codemods that honour "the initial KCL intent, whether it was written by a person,
LLM, or generated by another codemod". [D] ([PRINCIPLES.md](https://github.com/KittyCAD/modeling-app/blob/main/PRINCIPLES.md))

**Architecture.** The interpreter runs client-side, written in Rust and compiled to WASM. The engine
is proprietary, GPU-based and cloud-hosted. It receives modeling commands over a WebSocket and
streams video back. [D] (KCL part 0; [kcl-engine-codec](https://docs.rs/kcl-engine-codec/)). Users
note the vendor lock-in: local hosting of the engine "is not planned". [H] ([HN](https://news.ycombinator.com/item?id=46029619)).
The execution cache compares the new AST with the last one. It can only re-execute the diff for
"pure additions". Otherwise it clears the scene and re-executes everything (`CacheResult::ReExecute`,
`CheckImportsOnly`, `NoAction`). [D] ([cache.rs](https://github.com/KittyCAD/modeling-app/blob/main/rust/kcl-lib/src/execution/cache.rs)).
The execution result carries an `artifact_graph`, `operations` and `source_range_to_object`, so a
click in the scene maps back to source. [D] (same file).

**Syntax and semantics, and what changed.** All [D], from Cameron's
[part 3](https://www.ncameron.org/blog/kcl-part-3-look-and-feel/) (2026-08-19),
[part 1](https://www.ncameron.org/blog/kcl-part-1-units/) (2025-10-31),
[part 2](https://www.ncameron.org/blog/kcl-part-2-program-memory/) (2026-02-03) and the
[KCL 3 migration guide](https://github.com/KittyCAD/modeling-app/blob/main/docs/kcl-lang/migrating-to-kcl-3.md):

- **Pipelines.** `x |> f(%)` put the left side into `%`. Because "nearly every function call looked
  like `|> bar(..., %)`", the first unlabeled argument became implicit and `%` was dropped in most
  cases.
- **Arguments.** Struct arguments `foo({ ... })` became keyword arguments. `fn add = (x) => {}`
  became `fn add(@x, delta)`. Magic strings (`"X"`, `"CW"`) became stdlib constants. All numbers
  became floats because `1` versus `1.0` leaked `int()` calls everywhere.
- **Units.** "Numbers in KCL ... always include units, e.g., `42mm`". A file has a default via
  `@settings(defaultLengthUnit = in)`, and types such as `number(Length)`. Before this there was
  "no checking of units", which caused silent errors. Perfect unit tracking is "a non-goal". The
  author names the "ergonomic cliff" where explicit annotations become necessary.
- **Tags.** `tag = $seg` declares a name, and `seg` refers to it. A tagged sketch segment becomes a
  `TaggedFace` after extrusion. There are distinguished `START`/`END` faces and
  `getOppositeEdge`/`getNextAdjacentEdge`. Tags are the one mutable thing in an otherwise immutable
  language. Because every function is a closure, the interpreter first copied all of program memory
  per function declaration. Copy-on-write snapshots and later "epoch" counters fixed this. The tag
  syntax itself was judged "too invasive" to change.
- **Sketch blocks** (present in release notes from April 2026). `sketch(on = XY) { line(...);
  coincident(...); horizontalDistance(...) == width }` with `var` initial guesses and a constraint
  solver, then `region(...)` for closed profiles. This moves KCL from turtle-style pipelines to
  declarative constrained sketches.
- **Versions.** `@settings(kclVersion = 2.0)` and `"3.0-preview"`. The whole program runs under one
  version. KCL 3.0 changes `return`, `if` scoping and evaluation order, and **fillet timing**: "In KCL
  2.0, `fillet` and `chamfer` were deferred until certain other modeling commands or the end of the
  program". In 3.0 they run in order, so "looking up an edge that a fillet or chamfer has already
  consumed ... is an error". Point-and-click editing of KCL 1.0 files was removed on 2026-09-02.
  [D] ([releases](https://github.com/KittyCAD/modeling-app/releases)).
- On 2026-09-22 the release notes still list "Preservation of body.faces tags with union/int...".
  Topology references through Booleans are still being fixed. [D]

**Adoption.** The only public numbers are repository statistics: 1,302★, 126 forks, 53 contributors,
1,281 open issues. The repository was created 2023-01-11. The latest release tag is `kcl-186`
(2026-09-22). The
Rust sources under `rust/kcl-lib/src` total about 6.1 MB in 160 files. For comparison, wonky's
`src/*.mjs` is 340 KB in 5,495 lines. [D/M via `gh api`]

**LLMs and a language without training data.** Cameron: "Since KCL is a new language there is not
much code to train AI on. So models have to already 'be able to program'." He also notes: "The AI
seems to expect some things based on naming (and whatever else) which I wouldn't expect from most
users." [D] Zoo's approach, as far as it is public:

- **Zookeeper** (announced 2026-02-05) "searches for and reads documentation as it works",
  "frequently executes the model to check for errors" and "reviews the geometry via multi-view
  snapshots". [D] ([Zookeeper](https://zoo.dev/research/introducing-text-to-cad)).
- **Zoo's MCP server** has tools for KCL docs search (`kcl_docs.py`, built from zoo.dev's sitemap),
  KCL sample search (`kcl_samples.py`, from the "Aquarium" gallery), and `execute_kcl`. `execute_kcl`
  runs a **mock execution preflight** (interpreter without the geometry engine) before real
  execution. The server also offers snapshots and returns the artifact graph. [D] ([KittyCAD/mcp](https://github.com/KittyCAD/mcp)).
- **Enterprise fine-tuning.** Zoo converts customers' NX/Creo/CATIA/SolidWorks files to KCL and
  trains "a bespoke model". [D] ([Design Studio v1](https://zoo.dev/blog/zoo-design-studio-v1), 2025-05-21).
  No evaluation numbers are published. [D]

### 3.2 Onshape FeatureScript

**Model.** A `Context` stores bodies, their faces, edges and vertices, variables and feature error
states. Features are FS functions `(context, id, definition)`. They call **operations** (`opExtrude`,
`opBoolean`, `opFillet`, …), so `extrude` calls `opExtrude`, `opDraft` and `opBoolean`. The standard
features (Extrude, Fillet, Helix) "are already written as FeatureScript functions". [D] ([FsDoc modeling](https://cad.onshape.com/FsDoc/modeling.html), [intro](https://cad.onshape.com/FsDoc/)).
In practice the `op*` layer is Onshape's core IR over Parasolid. [I]

**Ids.** `newId() + "foo" + "bar"`. "Internally, an `Id` is just an array whose elements are
strings". "The full id hierarchy must reflect creation history". `unstableIdComponent` marks
wildcard parts, for example indices into evaluated queries. [D] ([FsDoc library](https://cad.onshape.com/FsDoc/library.html)).

**Queries.** Queries are "an order form for geometry". They are used "in place of direct references
out of a need for robustness in the face of changes earlier in the feature list". Example: "find
that face again after the user changed the cube's size and drilled a hole through it". [D] (FsDoc
modeling). The std mirror in `tmp/lang/onshape-std/query.fs` defines 77 `QueryType` members and 121
exported `q*` functions. [M, grep]

**Determinism and values.** "At Onshape we believe that models must regenerate the same way every
time, everywhere." "FeatureScript has no concept of undefined behavior, and execution cannot be
influenced by external input, time, or randomness." "Value semantics are used everywhere". `box` is
the explicit reference type. [D] ([FsDoc intro](https://cad.onshape.com/FsDoc/intro.html)).

**Versioning.** Every Feature Studio starts with `FeatureScript <N>;`, and imports pin a version
(`fixtures/r10b/r10b.fs` starts with `FeatureScript 3044;`). The std library keeps old documents
regenerating by gating behaviour changes. The mirror contains **583**
`isAtVersionOrLater(context, FeatureScriptVersionNumber.V…)` checks in 83 files, referencing 371
distinct versions. [M, grep over `tmp/lang/onshape-std`]

**Why it is verbose.** The `context` and `id` plumbing is explicit, arguments are string-keyed maps,
lengths need unit multiplication, a `precondition` exists for the UI, and sketches need solving.
One measured illustration [M]: the same L-bracket (outline 50×40, extruded 8 mm) takes

| Variant | Non-empty lines | Collapsed bytes | Lexical tokens | Executed? |
|---|---:|---:|---:|---|
| FeatureScript (`examples/bracket.fs`, includes `defineFeature` wrapper and one UI parameter) | 34 | 998 | 245 | yes (wonky example) |
| KCL 2.x pipeline | 11 | 304 | 101 | **no** (no Zoo engine access) |
| build123d algebra mode | 4 | 160 | 59 | yes, real build123d 0.10/OCCT: volume 8832.0 mm³ |
| OpenSCAD | 3 | 116 | 51 | yes, OpenSCAD.app: 20 triangles, volume 8832.0 mm³ |

The files and the counting script are in `out/lang/prior-art/` (`verbosity.json`). The build123d run
was at load average 21.50 16.27 14.64. One part is an illustration, not a language benchmark.

**What makes it robust.** Four things, all [I] from the above:
1. Stable hierarchical ids tied to creation history.
2. Queries that describe intent and are re-evaluated on every regeneration.
3. Strict determinism with value semantics.
4. Per-feature error status plus version-gated library semantics.

**LLMs.** GPT-4 "performs poorly when trying to generate Featurescript code directly, which is why
we decided to provide a simplified DSL". [D] (Makatura et al., arXiv 2307.14377, §4.1.5). The
largest parametric CAD corpora come from public Onshape documents: ABC, DeepCAD and CADFS all use
them. CADFS keeps FeatureScript, but a **standardized** dialect (section 4). [D]

### 3.3 build123d and CadQuery

build123d was created because CadQuery's "method chaining (fluent programming)" blocks ordinary
Python control flow. Builder mode uses `with` blocks. Enums replace strings. "String based
selectors have been replaced with standard python filters and sorting". [D]
([introduction](https://build123d.readthedocs.io/en/latest/introduction.html)). Algebra mode is
defined formally: `+`, `-` and `&` form abelian groups on parts, sketches and curves, and placement
is `l * c := c.moved(l)`. [D] ([algebra definition](https://build123d.readthedocs.io/en/latest/algebra_definition.html)).
Topology selection sorts, groups and filters by geometry, plus `Select.LAST`/`Select.NEW` (history).
"A shape that is not the result of an operation ... has no record and raises if asked for
Select.LAST or Select.NEW". [D] ([topology selection](https://build123d.readthedocs.io/en/latest/topology_selection.html)).
CadQuery's string selectors look like `edges("|Z and >Y")` and `">Y[-2]"`. [D]
([selectors](https://cadquery.readthedocs.io/en/latest/selectors.html)).
Geometric selectors are compact and readable. After a parameter change they can silently pick a
different entity, where FS queries would pick the same one. [I]

### 3.4 OpenSCAD and its successors

OpenSCAD is a pure functional CSG language. "Values cannot be modified during run time". The last
assignment to a variable wins. [D] ([manual](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/General)).
There is no way to query the size or bounding box of a child object. Requests for this have been
open since 2013/2014 (#586, #1088, #4520). [D]. Curv's author sums it up: "Functions and shapes are
not first class values. You can't query the properties of a shape." [D]
(`tmp/research/curv/docs/History_and_Rationale.rst`). On 2025-08-17 the nightly builds switched
their default backend from CGAL to Manifold: "After a long time of battle testing, we've now made the
Manifold backend in OpenSCAD the default." [D] ([openscad list](https://lists.openscad.org/empathy/thread/TMJEJCZINIJNYJX2YF7IDNBAPQY66KIF)).
Users report large render speedups. [H]
**PythonSCAD** forks OpenSCAD to use Python natively: the whole ecosystem, faster computation, and
solids as "1st class objects". It adds fillets. [D] ([PythonSCAD](https://pythonscad.org/overview.php)).
**µcad** is a new Rust-based description language (Prototype Fund 2025) and is in an early stage.
[D] ([µcad](https://github.com/Rustfahrtagentur/microcad)).

### 3.5 JSCAD and replicad

JSCAD implements CSG "on meshes elegantly and concisely using BSP trees" as plain JS functions, with
a `measurements` module. [D] ([@jscad/modeling](https://github.com/jscad/OpenJSCAD.org/tree/master/packages/modeling)).
replicad wraps OCCT (opencascade.js) for browser B-reps and credits CadQuery. Its `EdgeFinder` and
`FaceFinder` are selector objects. [D] ([replicad](https://github.com/sgenoud/replicad)).
Both show that a host-language DSL over a kernel is cheap to build, with no parser to maintain. [I]

### 3.6 Implicit/F-rep languages: Curv, libfive, Fidget, ImplicitCAD

- **Curv** has a two-stage design. The dynamically typed interpreter evaluates the program to a
  shape value. The Shape Compiler then compiles its `dist` and `colour` functions, written in
  "a statically typed subset of Curv (called SubCurv)", to GLSL for the GPU or C++ for the CPU.
  "Recursive function calls are not supported." [D] (`tmp/research/curv/docs/language/Shape_Compiler.rst`).
  This is the closest analogue to "JS evaluates, Bend executes a restricted core". [I]
- **libfive** has a C++ core with a C API. "The standard library is parsed and used to generate
  bindings for both Guile Scheme and Python". Studio live-codes and lets users "push and pull on the
  model's surface to change variables in the script". [D] (`tmp/research/libfive/README.md`).
- **Fidget** (same author) pipes a script through a math tree, a hash-consed graph, an SSA tape and
  bytecode, with interval-driven tape simplification. It has a bytecode VM and a hand-written
  aarch64/x86 JIT. On complex text (7,867 expressions, 1024²) the VM took 5.8 s and the JIT 182 ms
  (31×). With interval simplification it was 6 ms against 4.6 ms. [D] ([Fidget writeup](https://mattkeeter.com/projects/fidget/)).
  The README offers "a canonical bytecode format for tapes, for use in other interpreters". The
  author's systems went kokopelli (Python), Antimony (node graph), libfive, MPR and Fidget. [D]
  Lesson: the algorithm (simplification) gave more than the execution backend (JIT). [I]
- **ImplicitCAD** is an OpenSCAD-like language on F-rep in Haskell. Curv: "Still a very limited
  language. You can't define new function representations within the language". [D]

### 3.7 Kernels as libraries: Manifold, Fornjot

- **Manifold** "records the underlying CSG operations and evaluates them lazily". Its optimizations
  are union/intersection reordering (smallest first), parallel Booleans through a priority queue,
  `Compose` for disjoint bounding boxes, n-ary flattening, and "caching and sharing" of reused nodes.
  [D] (`tmp/research/manifold-wiki/Performance-Considerations.md`, `src/csg_tree.h`). Faces carry
  `faceID`/`originalID` provenance through Booleans. [D] (`docs/research/sources/manifold-elalish-manifold.md`).
- **Fornjot**: models were Rust crates built as dynamic libraries. [D] ([fj-host](https://docs.rs/fj-host/)).
  The post-mortem blames going from "code-first CAD application" to "kernel only" ("muddled
  vision"), prototyping too late, and a batch kernel "with no insight into intermediate steps". [D]
  (`docs/research/sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md`).

### 3.8 Constraint sketch systems: SolveSpace, Dune 3D (and KCL sketch blocks)

SolveSpace derives entity handles from structure: `hRequest::entity(i) = (request << 16) | i`, and
group entities set `0x80000000 | (group << 16) | i`. Remap roles (`REMAP_TOP`, `REMAP_BOTTOM`,
`REMAP_LINE_TO_FACE`, …) give generated entities semantic names. [D]
(`tmp/research/solvespace-srf/ss/src/sketch.h`). Solid edges still have "no useful IDs" (issue
[#1236](https://github.com/solvespace/solvespace/issues/1236), open since 2022). [D]
Dune 3D combines OCCT with SolveSpace's solver (patched for speed). It was built because FreeCAD has
"the perils of referencing things in the design" and SolveSpace lacks STEP and fillets. [D]
([Dune 3D README](https://github.com/dune3d/dune3d)). KCL added the same pattern in 2026: solver
constraints inside `sketch { }` blocks (3.1).

### 3.9 CADmium and Cadova

- **CADmium** is Rust on truck, compiled to WASM for the browser. The Rust library was meant to
  provide "all the same functionality as the UI for anyone who prefers code-first CAD", with a
  JSON-based `.cadmium` format. The author's notes: "simple indices aren't sufficient because the
  number of faces will change ... This will cause weird jumps." The repository is marked inactive
  and archived. [D] (`tmp/research/cadmium/README.md`, `Notes.md`).
- **Cadova** is a Swift result-builder DSL on Manifold. Its "Abstract Layer" builds a
  `GeometryNode` layer that is `Hashable`, `Codable` and has a digest. `GeometryCache` "maintains a
  mapping between geometry nodes and concrete geometry to avoid repeated evaluation" and memoizes
  measurements per node. [D] ([Cadova sources](https://github.com/tomasf/Cadova)). `measuringBounds`
  gives in-tree introspection. A clean debug build takes 75 s from source and 35 s with the prebuilt
  binary. Running one model takes 1.63 s in a debug build against 0.27 s. [D] (README). Compiled
  host languages make the edit-run loop long. [I]

### 3.10 Grasshopper (dataflow)

A change marks a component "expired", and "every component downstream of this component will also
be marked as expired". `ExpireSolution` erases caches downstream. Changing objects during a solution
is not allowed, because it can recurse "until Rhino crashes with a stackoverflow exception". [D]
([James Ramsden](http://james-ramsden.com/force-a-component-to-re-compute-in-grasshopper/),
[McNeel API](https://developer.rhino3d.com/api/grasshopper/html/M_Grasshopper_Kernel_GH_DocumentObject_ExpireSolution.htm)).
An explicit DAG gives incremental recompute. A dataflow *user interface* is a separate choice that
Marc's code-first workflow does not need. [I]

## 4. LLM code-to-CAD research

### 4.1 Works and what they measured

| Work (arXiv, venue) | Target representation | What it measured that matters for language design |
|---|---|---|
| Makatura et al. 2023 (2307.14377) | OpenSCAD, OpenJSCAD, a mini-DSL compiled to Onshape | GPT-4 "performs poorly" on raw FeatureScript. Failures came from switching to local sketch frames. Global coordinates fixed them. |
| 3D-PreMise 2024 (2401.06437) | Blender Python | Self-correction through a visual interface. Error taxonomy reused by later work. |
| Query2CAD 2024 (2406.00144) | FreeCAD macros | GPT-4 Turbo: 53.6 % success on the first attempt, +23.1 % with refinement, mostly from the first iteration. |
| Text2CAD, NeurIPS 2024 (2409.17106) | DeepCAD token sequence | 170k models, 660k annotations. The token format is what later code-based work replaced. |
| CAD-Recode 2024 (2412.14042) | CadQuery Python, 1M procedurally generated programs, Qwen2-1.5B | CC3D real scans: mean chamfer distance 0.76 against 14.82 (CAD-SIGNet), IoU 74.2 against 42.6, invalid 0.3 % against 2.5 %. Python output lets GPT-4o answer CAD questions (76.5 % against 63.2 %). |
| CADCodeVerify, ICLR 2025 (2410.05340) | CadQuery | Chose CadQuery because it is Python ("vast amount of Python code") and more concise than OpenSCAD (not measured). VLM verification questions: point-cloud distance −7.3 %, compile rate +5.5 % (GPT-4). 48 % of errors are "structural configuration". |
| CAD-Assistant 2024 (2412.13810) | FreeCAD Python with tools (renderer, cross-sections, sketch parameterizer) | JSON with point-based parametrization: 0.748 accuracy against 0.674 for the implicit format and 0.671 for DXF. Precise render 0.754 against hand-drawn 0.616. |
| Text-to-CadQuery 2025 (2505.06507) | CadQuery, 170k annotations | Exact match 58.8 % to 69.3 %, chamfer distance −48.6 %. Six fine-tuned model sizes, consistent improvements. |
| CAD-Coder, NeurIPS 2025 (2505.19713) | CadQuery with chain-of-thought and GRPO geometric reward | Uses the Python representation to "integrate with existing LLMs". |
| CAD-Llama 2025 (2505.04481) | "Structured Parametric CAD Code" (Python-like) | LLMs "neither encounter parametric sequences during their pretraining" nor see 3D; a code-like format helps. |
| cadrille, ICLR 2026 (2505.22914) | CadQuery | Online RL (GRPO) beats offline. Multi-modal. |
| CAD-RL 2025 (2508.10118) | CadQuery | Rewards for executability, geometric accuracy and external evaluation. |
| ProCAD, ICML 2026 (2602.03045) | CadQuery | Asking clarifying questions before coding: mean chamfer distance −79.9 % against Claude Sonnet 4.5, invalid rate 4.8 % to 0.9 %. |
| CADSmith 2026 (2603.26512) | CadQuery with RAG over API docs (no fine-tuning) | OCCT measurements (bounding box, volume, face counts) plus a VLM judge: execution 95 % to 100 %, median IoU 0.81 to 0.96, mean chamfer distance 28.37 to 0.74. Without vision: mean 18.19. |
| FutureCAD 2026 (2603.11831) | CadQuery plus natural-language B-rep selections resolved by a trained grounding model | Topology selection is the hard part. It moves out of code into a resolver. |
| CADFS, CVPR 2026 (2605.01925) | **Standardized FeatureScript**, 451k real Onshape designs, 15 operations | See 4.2. The strongest evidence on a non-Python target. |
| BenchCAD 2026 (2605.10865) | CadQuery, 17,900 programs, 106 industrial families | Models "replace sweeps, lofts, and twist-extrudes with simpler sketch-and-extrude patterns". Out-of-family generalization is weak. |
| CADBench (MIT) 2026 (2605.10873) | CadQuery | Specialized mesh-to-CAD models "substantially outperform code-generating VLMs". Rankings change across metrics. |
| Text2CAD-Bench 2026 (2605.18430) | CadQuery against DeepCAD command sequences | Command sequences instead of code: invalid rate 13.3 % to 67.3 % (DeepSeek-V3.2, L1). Chamfer distance 88.57 to 194.14 (Gemini 3 Flash, L2). |
| CADTests 2026 (2605.07807) | Executable tests on generated CAD | Test-guided generation "yielding simple baselines that surpass" current methods. |
| FEA-feedback agents 2026 (2605.17448) | CadQuery via Codex (GPT-5.5) and Claude Code (Opus 4.7) | No strict pass on assembled multi-part briefs. Best run met about 20 % of typed requirements. Blueprint schema plus a 21-view renderer: Box-IoU 0.444 to 0.592. |
| Embodied CAD 2026 (2606.31252) | CAD skill library executed in FreeCAD | Failure list: "wrong coordinate frame", "stale local face", wrong hole offsets. Design rule: leave "fragile geometric bookkeeping to deterministic resolvers". |
| Arko-T 2026 (2606.30429) | build123d, 1.3M programs, 4B model | Design state z = (features, named parameters, constraints, history, attachments), backend-agnostic. Programs normalized with parameters at the top, canonical feature idioms and explicit references. |
| SpatialClaw 2026 (2606.13673) | General spatial agents | A stateful Python kernel ("code as the action interface") beats structured JSON tool calls: +11.2 points on 20 benchmarks. |
| build123d-mcp README, June 2026 | build123d through MCP tools (render, measure, snapshots) | CADGenBench score 0.360 to 0.457, validity 88 % to 100 % for the same model. [H] (self-reported) |

All rows [D] from the papers' abstracts, tables or text. Local copies are in
`tmp/research/llm-cad/txt/` and `tmp/lang/prior-art/*.txt`.

### 4.2 CADFS in detail (FeatureScript as an LLM target)

CADFS is the one large study that did **not** use Python. It supports parts of Marc's idea and
argues against others. [D] (`tmp/lang/prior-art/cadfs.txt`)

- **Why FeatureScript.** Token sequences can only refer to earlier operations. Python/CadQuery
  "referencing is unstable under small modeling edits and fails to preserve the construction history
  of geometric entities". FeatureScript is "the native language of a CAD system used by practicing
  engineers".
- **Not raw FeatureScript.** The programs are rebuilt from Onshape's internal representation.
  References become `makeQuery(F5, QueryType.SWEPT_EDGE, EntityType.EDGE, …)`: operation id, then
  topological role, then entity type, then disambiguation.
- **Representation ablation** (Table 5, Qwen3-8B, text-to-CAD). Rows (a) to (c) change both the
  representation and the annotations, so the step from (b) to (c) is not purely a representation
  effect:
  - Deterministic ids ("F0", "E0") instead of random ones: median chamfer distance 124.87 to 97.82.
  - Explicit sketch parametrization ("endpoints rather than ... origin point and direction"): invalid
    rate **24 % to 10 %**.
  - Simplified, de-entangled operations: another −21 % chamfer distance.
  - Precision normalized to two decimals: "minor impact", shorter code.
- **Pairing** (Table 6, Qwen2-VL-2B). Raw FeatureScript with the new annotations: invalid rate
  **56 %**. Standardized FeatureScript: **10 %**. Python with FS-derived annotations: chamfer
  distance 1.93 against 0.06. Annotations and representation must match.
- **Against Python** (Table 2, DeepCAD test). CADFS text-to-CAD chamfer distance 0.06 against
  Cadrille's 0.10, edge chamfer distance 8.2 against 22.5. But the invalid rate is **9 % against
  3 %**, "likely due to the lack of FeatureScript code in the VLM pretraining data compared to
  Python". With the **same** DeepCAD data and annotations (Table 3, row a), FeatureScript was worse
  than Cadrille: chamfer distance 0.40 against 0.10, invalid rate 15 % against 3 %. Cadrille,
  however, trained on 1.17M examples. The gains came from 451k real multi-operation programs plus
  aligned annotations.
- **Scale.** Giving the bounding box in the prompt improved chamfer distance by 76 % and cut the
  invalid rate by 36 %. The authors note that FeatureScript models "directly in a global coordinate
  frame", unlike DeepCAD's normalized sketch frames.

### 4.3 Which language properties measurably help LLMs

| Property | Evidence | Strength |
|---|---|---|
| **Presence in pretraining data** (Python) | CADCodeVerify, CAD-Recode, Text-to-CadQuery, CAD-Coder all cite it. CADFS invalid rate 9 % against 3 %. Makatura: GPT-4 poor at FeatureScript. KCL: "not much code to train AI on". Text2CAD-Bench: command sequences 13 % to 67 % invalid. | Strong, and consistent across independent groups |
| **Explicit, point-based parametrization** | CADFS invalid 24 % to 10 %. CAD-Assistant 0.748 against 0.674 | Strong, two independent groups |
| **Stable, deterministic, compact identifiers** | CADFS median chamfer distance 124.87 to 97.82. Arko-T normalizes names. | Medium (one ablation) |
| **Global frame and absolute scale** instead of local frames | Makatura: local sketch frames broke GPT-4, global coordinates fixed it. CADFS: bounding box −76 % chamfer distance. Embodied CAD's "wrong coordinate frame" failures | Medium to strong |
| **Low entanglement** (one operation per statement, no hidden implicit state) | Raw FeatureScript 56 % invalid against 10 % standardized. CADFS "simplified operations" −21 % | Medium |
| **Verbosity** as such | Only indirect. CADCodeVerify prefers CadQuery for concision (not measured). Precision normalization had "minor impact" | Weak. Entanglement matters more than length. |
| **Feedback from errors, measurements and renders** | CADSmith (IoU 0.81 to 0.96), Query2CAD (+23.1 %), CADCodeVerify, FEA agents (Box-IoU 0.444 to 0.592), build123d-mcp [H] | Strong. Numbers beat pictures for dimensions; vision catches gross outliers. |
| **Introspection in a stateful session** | SpatialClaw +11.2 points. Zoo MCP sessions and snapshots. Cadova `measuringBounds`. OpenSCAD's missing queries | Medium |
| **Executable tests as specification** | CADTests | Medium (one paper) |
| **Semantic references resolved by deterministic code**, not by the LLM | Embodied CAD, FutureCAD, CADFS `makeQuery` roles | Medium, and a clear trend |
| **Ask before coding** | ProCAD −79.9 % chamfer distance | Medium (one paper) |

None of the strong effects needs new syntax. They need a normalized dialect, deterministic ids, an
explicit geometry model, and good kernel feedback. [I]

## 5. Compiler lessons

**One core IR, several frontends.**
- GHC desugars all of Haskell into Core. Core's `Expr` has 10 constructors (`Var`, `Lit`, `App`,
  `Lam`, `Let`, `Case`, `Cast`, `Tick`, `Type`, `Coercion`). [D] ([GHC/Core.hs](https://gitlab.haskell.org/ghc/ghc/-/blob/master/compiler/GHC/Core.hs))
- MLIR asks for "progressive lowering ... in small steps along multiple abstraction levels" and warns
  that "attempts to raise semantics once lowered are fragile". [D] (Lattner et al.,
  [arXiv 2002.11054](https://arxiv.org/abs/2002.11054), local copy `tmp/lang/mlir-paper.txt`)
- Wasm is a small validated core that many languages target. [D]

The CAD equivalents are Onshape's `op*` layer, KCL's modeling commands, Fidget's tapes, Curv's
SubCurv, Cadova's `GeometryNode` and Manifold's `CsgNode`. [D] Lowering is one-way. Topology
identity and semantic roles must therefore exist *in* the core, because they cannot be recovered
from B-rep output. Fornjot found the same for (u,v) data. [I]

**Source spans through desugaring.**
- MLIR makes "source location tracking and traceability" a design requirement. Locations can "keep
  the source program stack trace that produced an Op". [D]
- GHC carries source spans through Core as `Tick (SourceNote …)`. [D] ([Tickish.hs](https://gitlab.haskell.org/ghc/ghc/-/blob/master/compiler/GHC/Types/Tickish.hs))
- rustc attaches a `SyntaxContext` and `ExpnData` to spans of macro-generated and desugared nodes,
  so diagnostics point at user code. [D] ([rustc dev guide](https://rustc-dev-guide.rust-lang.org/macro-expansion.html))
- KCL maps `source_range_to_object`. [D] Wonky already records geometry-to-code provenance
  (`docs/topology-identity.md`). [D]

**Deterministic evaluation.** FeatureScript has no time, randomness or undefined behaviour. KCL is
"fully deterministic". [D] Wasm lists its only nondeterminism: NaN bit patterns, relaxed SIMD,
threads with shared memory, resource exhaustion, host calls, and feature support. [D]
([Nondeterminism.md](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md))
Content-addressed caching is only sound if evaluation is bit-deterministic. For wonky that has to be
checked across the Bend JS target, native CPU with different thread counts, and GPU. [I]

**Content-addressed caching and incremental recompute.**
- Unison: "Each Unison definition is identified by a hash of its syntax tree." [D] ([Unison](https://www.unison-lang.org/docs/the-big-idea/))
- Salsa memoizes queries per revision and can "backdate" a result: "even though the inputs changed,
  the output didn't". This is early cutoff. [D] ([Salsa algorithm](https://salsa-rs.github.io/salsa/reference/algorithm.html))
- Mokhov, Mitchell and Peyton Jones, "Build Systems à la Carte" (ICFP 2018), classify exactly these
  designs: verifying and constructive traces, early cutoff. [D]
- CAD systems: Cadova keys its cache by hashable nodes. Manifold shares reused nodes. Grasshopper
  expires everything downstream. KCL only diffs ASTs and re-executes everything except pure
  additions. [D] KCL's coarse cache shows that fine-grained caching is not free. It needs stable node
  identity across edits, which is the topological-naming problem again at the program level. [I]

**Versioned semantics.** FeatureScript pins the language version per file and gates std behaviour.
KCL has `kclVersion` per program. [D] Any core IR that persists results or caches needs a version
field from day one. [I]

## 6. Lessons for wonky

### 6.1 Marc's claims against the evidence

**Claim A: "A native Bend language makes wonky fast."**
Mostly not supported for the surface language. The native-bridge profile measures FeatureScript
parse plus interpreter at ≤0.7 % of wall time (r10b 47 ms of 56 s). Host adaptation is ≤0.42 %.
Boolean-heavy runs spend 68–98 % in the Bend kernel. Small models spend 82–87 % *loading the JS
kernel*. [D] (`docs/native-bridge/profile.md`). The measured levers are native kernel execution and
not loading the JS kernel. Moving the FeatureScript interpreter into Bend would speed up the ≤0.7 %.
A core IR *could* add speed beyond the binding in three ways:
1. Shipping whole subgraphs per call. This matters little in-process: about 0.5 µs per empty call,
   and r10b's 18,604 calls would cost roughly 25 ms. [D] (`docs/native-bridge/binding.md`,
   `baseline.md`)
2. Evaluating independent branches with fork-join, as Manifold's parallel CSG queue does.
3. Content-addressed reuse after edits.

All three are hypotheses to measure. Evidence so far: none. [I]

**Claim B: "Our own language is better for LLMs."**
Not supported for a *new* syntax. Every large study that works with frontier or open models without
massive fine-tuning uses Python (4.1). KCL's designer names the lack of training data. GPT-4 failed
on raw FeatureScript. CADFS only matched and then beat Python with 451k real programs, and still had
a 3× higher invalid rate. Marc uses frontier models without fine-tuning. Under those conditions the
properties that help are the ones in 4.3, and wonky can provide them through a normalized dialect
and tooling:
- deterministic ids;
- explicit parameters;
- a global frame;
- measurements, renders and executable tests;
- semantic reference resolution.

[I]

**Claim C: "FeatureScript, build123d and JS as translation layers into one core."**
Strongly supported *as an internal IR* (section 5 and table 2). There is one hard constraint.
FeatureScript and build123d programs **query geometry during execution**: `evaluateQuery`, `ev*`,
`try` around failing operations, and volume-driven Python control flow (`docs/python-frontend.md`).
[D] So translation cannot be a one-shot ahead-of-time compile of a whole FS file into a Bend program.
The frontends must stay interpreters that emit IR nodes and read back query results, like KCL's
interpreter against its engine. With the in-process binding this interleaving is cheap. [I]
AGENTS.md also requires unmodified FeatureScript input. The core must therefore be able to express
FeatureScript's id hierarchy and query semantics (`qCreatedBy`, cap/side roles, unstable id
components), not a simplified version. [D/I]

**Claim D: "Implement the language in Bend."**
Split this claim.
- *Evaluating* a core IR in Bend fits: the kernel is there, and fork-join is available. The binding's
  IO bridge can keep state resident in Bend (`Keep`/`Chain`/`Read` in `docs/native-bridge/binding.md`).
- *Parsing and interpreting* a surface language in Bend has costs:
  - no strings beyond `List<Char>`;
  - no F64/I64;
  - no forward references;
  - fuel-bounded recursion;
  - file IO at one list cell per byte;
  - about 1.5 s native compile per program, so it must be a resident interpreter, not a compiler
    per model.

  None of these costs is offset by a measured benefit (Claim A). Curv and Fidget show the working
  split: dynamic evaluation on the host side, a static restricted core on the fast engine. [D/I]

### 6.2 The form this points to

A combination, with clear layers. [I]

1. **Authoring stays FeatureScript (unmodified) and build123d-style Python.** Optionally add a
   *normalized style* for LLM work: parameters on top, explicit endpoints, global frame, named
   features, deterministic ids. It is enforced by a linter or formatter, not by new syntax. This
   follows CADFS and Arko-T.
2. **A core IR** ("wonky core") as the one semantic layer both frontends target:
   - **Operations** mirror FeatureScript's `op*` layer, because FS std features already desugar to
     it. build123d maps onto the same set. Each operation is total or raises an explicit capability
     error. Silent fallback is not allowed.
   - **Ids** are FeatureScript-style hierarchical paths with unstable components. They map onto
     wonky's `originId`/`operationId`.
   - **Topology references** are `(operation id, role, entity kind, disambiguation)`. This is the
     same shape as CADFS `makeQuery`, SolveSpace's `REMAP_*`, KCL tags and wonky's identity roles.
     Geometric filters (build123d selectors) are an explicit, separate reference kind marked
     "revision-local".
   - **Units** are resolved in the frontend. The IR is in mm/rad with explicit tolerances.
   - **Source spans** sit on every node, including nodes created by desugaring (MLIR, GHC, rustc).
   - **Determinism**: no time, no randomness, specified evaluation order. Eager or deferred edge
     operations are *specified*, not implied; KCL 2 to 3 is the cautionary tale.
   - **Version field** per program (FeatureScript, KCL).
   - **Content hash** per node, for memoization and early cutoff (Salsa, Unison, Cadova, Manifold).
   - **Query and measurement nodes** are first-class and return values to the host. OpenSCAD is the
     cautionary tale; Cadova and CADSmith show the benefit.
   - **Mock execution**: type, unit and capability checks without geometry (Zoo MCP preflight).
3. **A canonical text form of the IR** for golden tests, diffs, cache keys, reproducible bug reports
   and LLM *reading*. It is not a new authoring language. If a human or LLM authoring syntax is ever
   added, it is one more frontend.
4. **Evaluation in Bend** behind the native binding. It is a resident interpreter over IR nodes with
   a memo table and fork-join over independent subgraphs. The JS target stays as the reference
   backend behind the same interface.
5. **Dataflow graph = the IR's shape, not a UI.** Grasshopper-style expiry and early cutoff apply
   internally.

### 6.3 Order relative to other work

[I], derived from the evidence above:

1. **Native binding first** (in flight). Its call surface (`docs/native-bridge/surface.md`, not yet
   written) should be designed *as* IR v0: operation names, ids, spans, versions. Otherwise wonky
   builds two host-kernel interfaces.
2. **The Boolean/r10b critical path stays ahead of any language work.** Fornjot stalled on topology
   surgery, not on language design. A new language does not move r10b's 0/9 stages.
3. **Record IR traces from the existing JS frontends.** Every kernel call is already a candidate
   node. Recording them with id, span and input hash is cheap, testable, and gives cache keys and
   determinism tests without new syntax.
4. **Move subgraph evaluation into Bend where a measured workload benefits.** Candidates: parameter
   sweeps, many independent bodies, validation or mesh fan-out.
5. **Surface syntax last and optional.** Only after a small measured study on Marc's real parts:
   pass rate with independent validation, time to correct part, manual interventions. Compare
   build123d plus wonky tools, raw FeatureScript, and the normalized dialect or IR text. KCL, Curv,
   CADmium and Fornjot show how expensive the other order is.

### 6.4 Claims the prototype stages should prove or disprove

| # | Hypothesis | Pass criterion (end-to-end, with correctness checks, load recorded) |
|---|---|---|
| H1 | FS and build123d frontends can target one IR | The same part written in both produces identical IR modulo spans. Unsupported constructs raise capability errors. |
| H2 | Bend evaluation of an IR trace is deterministic | Bit-identical B-rep JSON and identity keys across JS target, native with 1 thread and native with N threads (and GPU, if used). |
| H3 | IR evaluation in native Bend beats today's path | Warm and cold end-to-end time including binding, validation and export, against the JS path, with STEP validation passing. |
| H4 | Content-addressed reuse pays off | After a one-parameter edit, re-evaluation touches only dependent nodes; time and hit counts are measured, and results are identical to a cold run. |
| H5 | Fork-join over independent IR branches scales | Multi-body model: native speedup with thread count, with identical results (Manifold-style). |
| H6 | IR text helps LLM repair more than raw FS | Fixed task set on Marc's parts: success rate with validation, not token counts (CADFS and SpatialClaw suggest it could; nothing measured for wonky). |

## 7. Sources

Web (accessed 2026-09-22):
- KCL: [part 0](https://www.ncameron.org/blog/kcl-part-0/), [part 1 units](https://www.ncameron.org/blog/kcl-part-1-units/),
  [part 2 memory](https://www.ncameron.org/blog/kcl-part-2-program-memory/), [part 3 look and feel](https://www.ncameron.org/blog/kcl-part-3-look-and-feel/);
  [KCL research page](https://zoo.dev/research/introducing-kcl); [kcl-book](https://zoo.dev/docs/kcl-book/intro.html);
  [modeling-app repo](https://github.com/KittyCAD/modeling-app) (PRINCIPLES.md, docs/kcl-lang/*.md, docs/kcl-std/types/*.md,
  rust/kcl-lib/src/execution/cache.rs, releases); [KittyCAD/mcp](https://github.com/KittyCAD/mcp);
  [Zookeeper](https://zoo.dev/research/introducing-text-to-cad); [Design Studio v1](https://zoo.dev/blog/zoo-design-studio-v1);
  [RustConf 2024 talk](https://blog.adamchalmers.com/rustconf-2024/); [HN 46029619](https://news.ycombinator.com/item?id=46029619).
- FeatureScript: [intro](https://cad.onshape.com/FsDoc/intro.html), [modeling](https://cad.onshape.com/FsDoc/modeling.html),
  [library/ids](https://cad.onshape.com/FsDoc/library.html), [variables](https://cad.onshape.com/FsDoc/variables.html);
  std mirror in `tmp/lang/onshape-std/` ([javawizard/onshape-std-library-mirror](https://github.com/javawizard/onshape-std-library-mirror)).
- build123d: [introduction](https://build123d.readthedocs.io/en/latest/introduction.html), [algebra](https://build123d.readthedocs.io/en/latest/algebra_definition.html),
  [selection](https://build123d.readthedocs.io/en/latest/topology_selection.html); CadQuery [selectors](https://cadquery.readthedocs.io/en/latest/selectors.html).
- OpenSCAD: [manual](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/General), issues [#586](https://github.com/openscad/openscad/issues/586),
  [#1088](https://github.com/openscad/openscad/issues/1088), [#4520](https://github.com/openscad/openscad/issues/4520);
  [PythonSCAD](https://pythonscad.org/overview.php); [µcad](https://github.com/Rustfahrtagentur/microcad).
- [JSCAD](https://github.com/jscad/OpenJSCAD.org), [replicad](https://github.com/sgenoud/replicad), [Fidget writeup](https://mattkeeter.com/projects/fidget/),
  [Cadova](https://github.com/tomasf/Cadova), [Dune 3D](https://github.com/dune3d/dune3d), [SolveSpace #1236](https://github.com/solvespace/solvespace/issues/1236),
  Grasshopper [expiry](http://james-ramsden.com/force-a-component-to-re-compute-in-grasshopper/).
- Compilers: [GHC Core.hs](https://gitlab.haskell.org/ghc/ghc/-/blob/master/compiler/GHC/Core.hs), [MLIR paper](https://arxiv.org/abs/2002.11054),
  [Wasm nondeterminism](https://github.com/WebAssembly/design/blob/main/Nondeterminism.md), [rustc expansion](https://rustc-dev-guide.rust-lang.org/macro-expansion.html),
  [Unison](https://www.unison-lang.org/docs/the-big-idea/), [Salsa](https://salsa-rs.github.io/salsa/reference/algorithm.html),
  Mokhov/Mitchell/Peyton Jones, "Build Systems à la Carte", ICFP 2018.
- LLM papers by arXiv id as listed in 4.1 (`https://arxiv.org/abs/<id>`). CADFS is also in the
  [CVPR 2026 open-access proceedings](https://openaccess.thecvf.com/content/CVPR2026/html/Pyatov_CADFS_A_Big_CAD_Program_Dataset_and_Framework_for_Computer-Aided_CVPR_2026_paper.html).

Local (read-only inputs and my artifacts):
- `tmp/research/{curv,libfive,fidget,cadmium,manifold,manifold-wiki,solvespace-srf,llm-cad}` (clones
  from the research team), `docs/research/sources/*.md` (Fornjot, Manifold, vcad, keel notes).
- `docs/native-bridge/{profile,binding,baseline}.md` (other workflow, read-only).
- My artifacts: `out/lang/prior-art/` (bracket in four languages, `count.mjs`, `verbosity.json`), and
  `tmp/lang/prior-art/*.txt` (text extracted from the arXiv PDFs used for the exact numbers above).
