# Corpus: what Marc's real CAD code needs from a core language

Date: 2026-09-22. Corpus: `~/Workspace/cad` (read only), final scan 21:33 to 21:34. Load average 14.2 to 15.0 on 18
cores (shared machine). Scanner run times: FeatureScript 18.3 s, Python 30.4 s. They are indicative only and are
not a performance claim.

Machine-readable result: [`out/lang/corpus.json`](../../out/lang/corpus.json). All numbers below come from that
file. Scanners: `scripts/lang/` (see [Reproduce](#8-reproduce-and-limitations)).

The question for this chapter: what must a core language express to cover Marc's real work? The key sub-question
is how often modeling control flow depends on geometric query results. A frontend in one language with a kernel
in another has to synchronize with the kernel at each of those points.

## Answer in short

1. **The corpus is FeatureScript plus algebra-mode build123d. There is no CadQuery.** Scanned: 565 `.fs` files
   (457 modeling files, 329 unique, 129 design families) and 4,419 `.py` files. Of the Python files, 129 are
   build123d modeling files (91 unique, 82 families). There are 205 build123d check scripts, 91 Fusion scripts
   and 189 Python files that generate FeatureScript. 0 files import `cadquery`.
2. **Almost every file reads geometry back from the kernel, but mostly to check it.** 88 % of FS families call
   `evaluateQuery` or `ev*`. 84 % contain a geometry check, mostly `size(evaluateQuery(q)) != 1 -> throw`.
   38 % skip an operation when a selection is empty.
3. **Real geometry-dependent control flow is rare.** Here that means a branch or a sequential loop over kernel
   results that changes which geometry operations run. It occurs in **1.2 % of unique FS files (2.3 % of
   families)** and **5.5 % of unique build123d files (6.1 % of families)**. Complex host-side predicates
   (arbitrary code over geometry) occur in 0 FS files and in 5 build123d files. Together that is the "needs a
   general language next to the kernel" share: **FS 1.2 % / 2.3 %, build123d 9.9 % / 11 %** (unique /
   families).
4. **The large middle is a lazy IR, not a language.** The second bucket is FS 46 % / 41 % and build123d 42 % /
   37 %. These files need one of four things:
   - declarative selection predicates (FS 38 % of families, build123d 43 %);
   - map regions over a query result (FS 5 %, build123d 2 %);
   - arithmetic on measured values (FS 4 %, build123d 9 %);
   - best-effort or fallback combinators for kernel failures (both 8.5 %).

   All of this fits into one submitted program if the IR has these node types. No host round trip is needed.
   **53 % / 57 % of FS files** and **48 % / 52 % of build123d files** need only a plain operation graph with
   check nodes.
5. **The selection predicates are simple.** FS unique files contain 273 host-side selection predicates. By kind:
   - 171 axis-aligned range windows (bounding box, volume ≈ value, point within radius);
   - 85 direction tests (`abs(dot(normal, AXIS)) > 0.999`);
   - 15 mixed range/direction/type;
   - 2 geometry-type tests;
   - 0 needing general code.

   In build123d, 156 of 170 predicates are range, type or direction tests. The 14 complex ones are `is_inside`
   probes, OCP adjacency maps and user callbacks, almost all in one file (`cad-project-046/mount.py`). A small
   predicate vocabulary evaluated in the kernel would cover them: centroid/bbox window, length/area/volume ≈ v,
   parallel-to-axis, geometry type, part name.
6. **Marc's FeatureScript is first-order and loop-light.** In 329 unique files, the counts of the following are
   all 0: first-class lambdas (other than feature bodies), capturing closures, recursion, boxes, and
   type/predicate/operator declarations. 89 % of 5,256 loops iterate over program-determined collections (literal
   arrays, ranges). Those loops can be unrolled or evaluated before any kernel call. Map literals appear in 99 % of
   files, mostly as argument records.
7. **The kernel vocabulary is small and narrow.** The corpus uses 60 distinct `op*/sk*/f*/q*/ev*` functions.
   **35 cover 80 % and 49 cover 95 % of design families.** Parameters are equally narrow:
   - `opExtrude` is always `BLIND` with an explicit direction and depth;
   - `opBoolean` has 3 modes plus `keepTools`;
   - fillet and chamfer have one size parameter each;
   - there are no sketch constraints.

   Full construct curves (syntax, all std calls, units) are flat: 118 of 155 constructs for 80 % of FS families,
   142 of 199 for 80 % of build123d families. The long tail is cheap value-level builtins (trig, vector algebra,
   strings), not kernel semantics.
8. **FeatureScript is already a compilation target in Marc's workflow.** 128 FS modeling files are generated:
   67 are marked as generated, 53 contain generated blocks and 8 are unmarked SSA output (`id + "g12"`).
   189 Python files emit FS. `cad-project-041/single-step-r10/src/core_geometry.py` defines `Trace`. `Trace` is a
   working dual-backend mini IR: box, cylinder, prism, cone, hex, M3 hole tools, join/cut/intersect, rigid move,
   named source import, finish. Every operation runs in build123d and also appends one straight-line FS
   statement. Handwritten FS helper layers converge on the same vocabulary: `prism` (73 families), `cut`,
   `clone`, `combine`, `cylinder`, `profile`, `subtract`, `roundBody`, `unite`, `keepMain`, `finish`.

**For the language decision:**

- The corpus supports an **internal core IR** first: a lazy operation graph with typed queries, check nodes, a
  small predicate vocabulary, map regions and failure combinators. It covers about 98 % of FS families and
  about 89 % of build123d families without a host round trip.
- The corpus does **not** show demand for a new human-facing language. The remaining 2 to 11 % needs general
  control flow over kernel results. The in-process binding (about 0.5 to 1 µs per call,
  [binding.md](../native-bridge/binding.md)) handles that synchronously today at negligible cost.
- A Bend-native language only pays off there if those loops must run in parallel or on the GPU.

## 1. Corpus and method

### Populations

| FeatureScript | files | unique (SHA-256) | families |
|---|---:|---:|---:|
| all `.fs` | 565 | | |
| feature files (`defineFeature`) | 454 | | |
| library files (functions only) | 3 | | |
| **modeling files (feature + library)** | **457** | **329** | **129** |
| evaluation lambdas (`function(context, queries)` snippets) | 37 | | |
| fragments (header-less helper snippets) | 52 | | |
| splice fragments (intentionally incomplete, do not parse) | 19 | | |

Modeling files by origin: 329 handwritten, 67 generated (header marker), 53 with generated blocks, 8 unmarked SSA
output. 181,024 lines in total. The median modeling file has 265 lines.

| Python | files | unique | families |
|---|---:|---:|---:|
| all `.py` (without `.venv`, `node_modules`, `site-packages`, `__pycache__`, hidden directories) | 4,419 | | |
| **build123d modeling** (≥ 5 modeling calls; check-like names need 2× more modeling than measuring) | **129** | **91** | **82** |
| build123d checks and audits (import + measure) | 205 | 170 | 162 |
| build123d tooling (watch, render, assembly glue) | 35 | | |
| FeatureScript generators (Python that writes FS) | 182 (189 contain FS text) | | |
| Fusion 360 (`fusion_khana` / `adsk`) | 91 | | |
| mesh or numeric only (trimesh, numpy, OCP, shapely) | 1,835 | | |
| other tooling | 1,941 | | |
| `import cadquery` | **0** | | |

build123d modeling code has 38,511 lines. The median file has 201 lines. `cad_khana` (Marc's diagnostics
wrapper) is imported by 24 % of the modeling families. The FS-on-OCCT predecessor `cad-project-043/fsocct` (4,850 lines,
2026-09-21) is tooling and is not counted as modeling code.

**Families.** Marc keeps revisions as copies (r19, r20, archive, snapshots). One 51-member FS family would
dominate per-file counts. Near-duplicates are clustered with union-find over Jaccard ≥ 0.6 of token 5-shingles.
The most recently modified member represents the family. Tables give **families** first and unique files second.

### Scanners

- **FeatureScript:** `scripts/lang/fs-parse.mjs` is a tolerant parser for the full surface syntax: fragments,
  `try silent`, type and predicate declarations, boxes, namespaced imports. It parses 546 of 565 files. The 19
  failures are the splice fragments. `scripts/lang/fs-analyze.mjs` counts constructs and std calls. It then runs
  an interprocedural taint analysis:
  - TOPO: `evaluateQuery`, `isQueryEmpty`;
  - MEASURE: `ev*`;
  - META: `getProperty`, `getVariable`, ...;
  - FAIL: try results.

  From that it classifies every place where control or data flow depends on a kernel result. Lazy `q*` queries
  and `op*` results stay symbolic. Only reachable code counts: feature bodies, evaluation lambdas and whatever
  they call.
- **Python:** `scripts/lang/py-facts.py` uses the stdlib `ast` module, run through `uv run`. It gets the
  build123d 0.12.0 vocabulary with categories from `scripts/lang/b3d-vocab.py`, written to
  `fixtures/lang/b3d-vocab.json`. Taint bits:
  - TOPO: selector results;
  - SELPRED: entities chosen by a host-side predicate;
  - MEASURE: `volume`, `bounding_box`, `center()` on shapes, ...;
  - FAIL: failures.

  Shape-valued expressions stay symbolic: constructors, algebra, and helpers annotated `-> Part`. Placement
  arithmetic (`Pos * Rot`, `.inverse()`) is not a measurement.
- `scripts/lang/corpus-report.mjs` aggregates everything into `out/lang/corpus.json`: ladder, requirements,
  tables, coverage curves, test cases, verification.

### Hand verification

I hand-read one file per stratum: 9 FS files and 7 Python files, about 175 reported sites. Each reported site was
compared with the source, and the source was grepped for missed read-backs. The read found 8 classifier defects.
Each was fixed before the final scan:

- metadata-only writes were counted as modeling;
- `ev*` results inherited the entity taint of their arguments;
- unmarked SSA output was not detected as generated;
- the Python module scope descended into function bodies, which double-counted sites;
- entity lists chosen by a predicate were counted as measured numbers;
- a subscript assignment tainted the loop index;
- `Location` arithmetic was counted as a measurement;
- literal-length loops were counted as geometry iteration.

The per-file record is in `corpus.json` → `verification`. `test/lang-corpus.test.mjs` pins the resulting rules
with 9 minimal real-pattern cases (`node --test test/lang-corpus.test.mjs`, 9/9 pass).

## 2. The crucial number: where modeling depends on kernel results

### The ladder

Every read-back site gets a level. A file takes the maximum level of its sites. The level says what a core
representation must contain so that the program can be submitted once and never has to wait on the host.

| level | name | typical real code | what the IR needs |
|---|---|---|---|
| 0 | none | pure CSG | an operation graph |
| 1 | lazy query | `qCreatedBy`, inline `edges().filter_by(Axis.Z)` | symbolic queries resolved inside ops |
| 2 | check | `if (size(evaluateQuery(q)) != 1) throw ...`, `assert part.is_valid`, report loops | check/assert nodes (can be deferred) |
| 3 | empty guard | `if (size(es) > 0) opFillet(...)`, `if roots: fillet(roots, r)` | total (empty-tolerant) ops or a conditional node |
| 4 | measured dataflow | `part.moved(Location((0, 0, -bb.min.Z)))`, sizing a new box from a measured bbox | arithmetic nodes over measurements |
| 5 | host selection | loop over evaluated faces/bodies, keep those whose bbox/normal/volume matches | predicate queries (5a declarative, 5b general code) |
| 6 | per-entity map | `for (b in evaluateQuery(q)) if (evVolume(b) < eps) opDeleteBodies(b)` | map region over a query result |
| 7 | geometry control flow | fillet each edge with fallback radii and re-query after each success, `try silent` chamfer per edge | sequential control flow over kernel results |

Failure handling is tracked separately:

- FS: `try silent`, and `try/catch` with a working handler;
- Python: `try/except` around modeling with a non-trivial handler.

A re-throw that only adds a message is error decoration. 42 % of FS files do that, and it is not counted.

### Results

| file share (unique / families) | FS (329 / 129) | build123d (91 / 82) |
|---|---:|---:|
| max level 0 none | 0.9 / 2.3 % | 20.9 / 23.2 % |
| max level 1 lazy query | 8.8 / 11.6 % | 9.9 / 11.0 % |
| max level 2 check | 27.7 / 27.9 % | 17.6 / 18.3 % |
| max level 3 empty guard | 17.9 / 20.2 % | 1.1 / 1.2 % |
| max level 4 measured dataflow | 0 / 0 % | 2.2 / 2.4 % |
| max level 5 host selection | 35.6 / 31.8 % | 40.7 / 35.4 % |
| max level 6 per-entity map | 7.9 / 3.9 % | 2.2 / 2.4 % |
| max level 7 geometry control flow | **1.2 / 2.3 %** | **5.5 / 6.1 %** |
| has failure handling | 10.6 / 8.5 % | 8.8 / 8.5 % |

| verdict (unique / families) | FS | build123d |
|---|---:|---:|
| **plain graph** (levels 0 to 3, no failure handling) | **52.9 / 56.6 %** | **48.4 / 52.4 %** |
| **lazy IR** (measure arithmetic, declarative predicates, map regions, failure combinators) | **45.9 / 41.1 %** | **41.8 / 36.6 %** |
| **general language needed** (level 7 or a complex predicate) | **1.2 / 2.3 %** | **9.9 / 11.0 %** |

The table below lists requirements per file. They are not exclusive, so a file can count in several rows.

| needs at least once (families) | FS | build123d |
|---|---:|---:|
| checks | 83.7 % | 45.1 % |
| empty guards | 38.0 % | 12.2 % |
| arithmetic on measurements | 3.9 % | 8.5 % |
| declarative selection predicates | 38.0 % | 42.7 % |
| map region over a query result | 5.4 % | 2.4 % |
| failure combinators (`optional(op)`, `orElse(a, b)`) | 8.5 % | 8.5 % |
| general predicates (arbitrary code over geometry) | 0 % | 6.1 % |
| general control flow over geometry | 2.3 % | 6.1 % |

Static read-back sites at level 4 or higher per file (families): FS median 0, p90 7, max 18. build123d median 0,
p90 8, max 51.

### What the sites are

- **Checks dominate FS.** Marc's house style validates every result: "Expected one connected solid", "Use an
  empty Part Studio", "Unexpected source side geometry". It also validates imported sources by exact volume and
  bounding box. A core IR needs first-class `expect count(q) == n`, `expect volume ≈ v ± tol` and
  `expect bbox within`. These are evaluated after the build, so they never block construction.
- **Empty guards are mostly "total Booleans".** The generated helper layer (`cp`, `combine`, `subtract`,
  `keepMain`, 25 to 38 families each) wraps `opBoolean` in `if (size(evaluateQuery(a)) == 0) return ...`
  because Onshape throws on empty inputs. They disappear if the core's Boolean with an empty operand is defined
  as identity or empty.
- **Host selection** has four common forms:
  - Find the imported source body by volume: `abs(evVolume(b) - 394932) < 1500`.
  - Split a pattern result into left and right by bbox.
  - Collect faces whose normal is parallel to an axis and whose bbox lies in a window.
  - Build a name table from an imported Part Studio. `Trace` emits this form in every generated file:
    `n_base[getProperty(b, NAME)] = b`.

  build123d has one dominant idiom, in 28 of 82 families (34 %):
  `[e for e in s.edges().filter_by(Axis.Y) if abs(e.center().Z - h) < eps]`, then `if roots: fillet(roots, r)`.
- **Level 7 is a short list.** FS has 4 unique files:
  - `r10-source.fs` "Sliver Purge": `try silent` chamfer per edge;
  - `skirt_split.fs`: loop bound from a selection, `try silent` inside;
  - `r6d.fs` and its copy `base-source-before.fs`: a per-core fold that selects faces by normal (with
    `try silent` around `evPlane`), extrudes them and cuts the result into the accumulating body.

  build123d has 5 unique files:
  - `cad-project-046/mount.py`: fillet and deburr loops that re-query topology after each success, up to 24
    passes, with radius fallback and a sacrificial subprocess for OCC segfaults;
  - `cad-project-035/project-component-d98e059b.py`: fallback to one edge at a time;
  - `cad-project-033/debug_edges.py`, `rack-drive-module/geometry.py`, `brep_audit.py`.

  Almost all of these exist to work around **kernel failures on fillets and chamfers**. The corpus does not use
  control flow as a design idiom.
- **Failure handling** in FS is `try silent { opBoolean | opFillet | opChamfer | setProperty }`, which means
  "best effort, keep going". There is one real `try/catch` recovery: a diagnostic body when the rotor build
  fails. In Python it is "batch fillet, else one edge at a time or smaller radius". Both are combinators on a
  failure value, provided the kernel returns failure as a value (`docs/native-bridge/binding.md`: kernel error
  values become exceptions on the calling thread).

**Static versus dynamic.** These are static site counts. One level-5 loop over 200 edges costs 200 `ev*` calls at
run time. With the in-process binding (about 0.5 µs per empty call and 1 µs per production call) and a synchronous
interpreter, 200 synchronous calls cost roughly 0.2 ms. Removing sync points therefore buys architecture freedom
(parallel batches, GPU, a resident kernel-side session). It does not buy wall time on today's single-threaded
path. The native-bridge profile puts parse plus interpreter at ≤ 0.7 % of wall time
([profile.md](../native-bridge/profile.md)).

## 3. FeatureScript: what is used

### Calls by category (329 unique modeling files)

| category | distinct functions used | calls | families using any |
|---|---:|---:|---:|
| geometry values (`vector`, `plane`, `transform`, `matrix`, ...) | 15 | 159,271 | 99.2 % |
| lazy queries `q*` | 20 | 30,400 | 97.7 % |
| value / std library (`size`, `append`, trig, ...) | 24 | 22,919 | 98.4 % |
| feature API / context (`defineFeature`, `setProperty`, instantiator, `regenError`) | 16 | 16,830 | 100 % |
| kernel operations `op*` | 15 | 15,017 | 95.3 % |
| sketch `sk*` | 8 | 8,942 | 86.8 % |
| `evaluateQuery` (topology read-back) | 1 | 3,327 | 88.4 % |
| measurements `ev*` | 11 | 674 | 56.6 % |
| std primitive features `f*` (`fCuboid`, `fCylinder`, `fCone`) | 3 | 639 | 5.4 % |

### Most used functions (share of families / unique files, total calls)

| function | fam. | uniq. | calls | | function | fam. | uniq. | calls |
|---|---:|---:|---:|---|---|---:|---:|---:|
| `defineFeature` | 99 % | 100 % | 1,855 | | `color` | 78 % | 90 % | 4,716 |
| `vector` | 99 % | 100 % | 127,976 | | `qBodyType` | 78 % | 90 % | 1,242 |
| `plane` | 92 % | 97 % | 17,910 | | `skCircle` | 71 % | 84 % | 1,022 |
| `opDeleteBodies` | 90 % | 95 % | 5,753 | | `transform` | 71 % | 80 % | 6,076 |
| `qCreatedBy` | 89 % | 96 % | 15,003 | | `skPolyline` | 59 % | 66 % | 1,114 |
| `setProperty` | 89 % | 96 % | 4,546 | | `qAllModifiableSolidBodies` | 58 % | 54 % | 1,852 |
| `size` | 88 % | 95 % | 3,686 | | `skLineSegment` | 53 % | 54 % | 1,770 |
| `evaluateQuery` | 88 % | 94 % | 3,327 | | `opPattern` | 52 % | 55 % | 321 |
| `qUnion` | 88 % | 92 % | 6,825 | | `qSubtraction` | 52 % | 48 % | 742 |
| `newSketchOnPlane` | 87 % | 95 % | 2,917 | | `skArc` | 47 % | 48 % | 1,797 |
| `skSolve` | 87 % | 95 % | 2,959 | | `opLoft` | 46 % | 55 % | 2,135 |
| `regenError` | 87 % | 93 % | 4,137 | | `instantiate` / `addInstance` | 42 % | 48 % | 792 / 1,161 |
| `qSketchRegion` | 84 % | 92 % | 2,950 | | `evVolume` | 39 % | 46 % | 224 |
| `opExtrude` | 82 % | 91 % | 3,531 | | `evBox3d` | 37 % | 38 % | 257 |
| `opBoolean` | 81 % | 90 % | 1,915 | | `opTransform` | 35 % | 50 % | 988 |

Other operations, by share of families:

| operation | families |
|---|---:|
| `opFillet` | 17 % |
| `opRevolve` | 9 % |
| `opChamfer` | 6 % |
| `opSweep` | 2 families |
| `opThicken` | 1 family |

No sketch constraint API (`skConstraint`) appears anywhere. Every sketch is explicit coordinates solved with
`skSolve`.

### Operation parameter surface (calls in unique files)

| op | parameters used |
|---|---|
| `opExtrude` (2,570) | `entities`, `direction`, `endBound`, `endDepth` on every call; `endBound` is always `BoundingType.BLIND` |
| `opBoolean` (1,299) | `tools`, `operationType` (UNION in 285 files, SUBTRACTION 290, INTERSECTION 157), `targets` (669), `keepTools` (121) |
| `opLoft` (1,567) | `profileSubqueries`; `bodyType` 8 times. Mostly frustums and cylinders as two-circle lofts |
| `opPattern` (233) | `entities`, `transforms`, `instanceNames`. Used as clone and mirror, not as a UI pattern |
| `opTransform` (670) | `bodies`, `transform` |
| `opFillet` (117) / `opChamfer` (25) | `radius` / `width`, `tangentPropagation`; chamfer only `EQUAL_OFFSETS` |
| `opRevolve` (57) | `entities`, `axis`, `angleForward` |
| `opOffsetFace` (54), `opDeleteFace` (19), `opSplitPart` (6), `opSweep` (2), `opThicken` (1), `opMoveFace` (1) | minimal parameter sets |

### Language constructs (share of unique / families)

| used | not used |
|---|---|
| loops 94 / 87 %; 89 % of 5,256 loops over program-determined collections | first-class lambdas other than feature bodies (0) |
| map literals 99 / 98 % (argument records, lookup tables) | capturing closures (0) |
| user functions 91 / 83 % | recursion (0) |
| `if` 94 %, ternary 66 %, string `~` 91 % (unique) | `box` / `[]` unboxing (0) |
| document imports 47 / 43 %, instantiator 48 / 42 % | `type` / `predicate` / `operator` declarations (0) |
| any `try` 45 / 35 %, `try silent` 12 / 15 % | `while`: 9 uses in 8 files, 1 family |
| non-empty preconditions 25 / 16 % | `getVariable` / `setVariable` 1 %, attributes 1 % |
| `enum` declarations 2 % | |

Units: `millimeter` everywhere, `degree` in 42 % of families, `foot`, `radian` and `meter` rarely.

### Helper vocabularies converge

The most frequent user function names across FS families all belong to one CSG helper layer that Marc's agents
re-invented again and again. The figures are the number of families defining each name:

| helper | families |
|---|---:|
| `prism` | 73 |
| `cut` | 45 |
| `clone` | 41 |
| `combine` | 38 |
| `cylinder` | 37 |
| `profile` | 30 |
| `subtract` | 29 |
| `roundBody` | 28 |
| `unite` | 26 |
| `cp` | 25 |
| `keepMain` | 25 |
| `curvedProfile` | 24 |
| `finish` | 22 |
| `join` | 21 |
| `block` | 18 |
| `yz` | 17 |
| `mark` | 16 |
| `polygon` | 14 |
| `copyBody` | 14 |
| `intersect` | 13 |
| `bore` | 9 |
| `loft` | 7 |
| `frustum` | 5 |
| `m3HybridHole` / `m3ClearanceTool` | 5 |

`Trace` (Python) and the FS `native-helpers.fs` libraries expose the same set. It amounts to:

- polygon prism on a plane, box, cylinder, frustum;
- M3 hybrid hole and clearance tools;
- join, cut, intersect;
- rigid transform, clone and mirror;
- keep the largest body, delete the fragments;
- finish: name, colour, assert one solid.

This is the de-facto core operation set.

## 4. build123d: what is used (82 families)

### Modes

| style | families |
|---|---:|
| algebra mode only (`Pos(...) * Box(...)`, `a - b`) | 76.8 % |
| mixed builder and algebra | 12.2 % |
| builder mode only (`with BuildPart()`) | 3.7 % |
| direct API only (`Solid.make_box`, `Face(Wire.make_polygon(...))`) | 7.3 % |
| placement by multiplication (`Pos * Rot * shape`) | 70.7 % |
| `BuildSketch` / `BuildLine` | 12.2 % / 3.7 % |
| `mode=Mode.SUBTRACT` | 3.7 % |
| `filter_by(Axis/GeomType)` / `sort_by`, `group_by` / `filter_by(lambda)` | 17.1 % / 12.2 % / 1.2 % |
| ShapeList operators (`>`, `<`, `>>`, `|`) / `Select.LAST` | 0 % / 0 % |
| exports (`export_stl` / `export_step`) | 67.1 % |
| `import_step` (reference geometry) | 17.1 % |
| direct OCP | 4.9 % |

### Vocabulary (share of families)

| name | cat. | fam. | | name | cat. | fam. |
|---|---|---:|---|---|---|---:|
| `Pos` | location | 71 % | | `Location` | location | 27 % |
| `Box` | part | 70 % | | `Circle` | sketch | 26 % |
| `Cylinder` | part | 67 % | | `chamfer` | op | 22 % |
| `export_stl` | export | 62 % | | `Polygon` | sketch | 17 % |
| `Plane` | geometry | 54 % | | `import_step` | import | 17 % |
| `export_step` | export | 52 % | | `BuildPart` | builder | 15 % |
| `extrude` | op | 48 % | | `Text` | sketch | 13 % |
| `Rot` | location | 41 % | | `RectangleRounded` | sketch | 12 % |
| `Compound` | shape | 37 % | | `make_face` | op | 11 % |
| `Align` | enum | 33 % | | `offset` | op | 10 % |
| `Cone` | part | 30 % | | `Polyline` | line | 10 % |
| `fillet` | op | 30 % | | `Sphere` / `Torus` | part | 7 % / 2 % |
| `Axis` | geometry | 30 % | | `loft` / `revolve` / `sweep` | op | 5 % / 1 % / 1 % |

The most used methods (list methods such as `append` excluded):

| method | families |
|---|---:|
| `.bounding_box()` | 49 % |
| `.edges()` | 43 % |
| `.solids()` | 35 % |
| `.center()` | 33 % |
| `.filter_by()` | 18 % |
| `.moved()` | 17 % |
| `.fuse()` | 15 % |
| `.offset()` | 13 % |
| `.cut()` | 13 % |
| `.group_by()` | 12 % |
| `.rotate()` | 12 % |

Measured properties: `.volume` 50 %, `.is_valid` 33 %, `.geom_type` 16 %.

Python features in modeling files, by family share:

| feature | families |
|---|---:|
| functions | 96 % |
| comprehensions | 74 % |
| comprehension filters | 45 % |
| type hints | 60 % |
| f-strings | 66 % |
| `math` | 45 % |
| try/except | 23 % |
| nested functions | 24 % |
| numpy | 20 % |
| lambdas | 17 % |
| classes | 7 % |
| dataclasses | 4 % |
| recursion | 4 % |
| `while` | 5 % |
| subclassing build123d | 0 % |
| `match` | 0 % |

Check scripts (162 families) use a small measurement vocabulary:

- `.volume`
- `.bounding_box()`
- `.solids()`
- `.is_valid`
- `.faces()`
- `.area`
- `.center()`
- `.intersect()`
- `.distance_to()`
- `.normal_at()`
- `.geom_type`

That is exactly what the core's check nodes and validation need.

## 5. Coverage curves

A file is covered by a construct set S when every construct it uses is in S. Two orderings are reported:

- Frequency ordering: a prefix of the constructs sorted by file frequency.
- Greedy: repeatedly add the missing constructs of the uncovered file that covers the most new files per added
  construct.

Sets and curves are in `corpus.json` → `coverage`.

| universe | distinct | 50 % | 80 % | 95 % | 100 % |
|---|---:|---:|---:|---:|---:|
| FS kernel vocabulary (`op/sk/f/q/ev`, `evaluateQuery`), families, greedy | 60 | 25 | **35** | **49** | 60 |
| FS kernel vocabulary, unique files, greedy | 60 | | 36 | 44 | 60 |
| FS all constructs (syntax + all std calls + units), families, greedy | 155 | 90 | 118 | 138 | 155 |
| FS all constructs, unique files, greedy | 156 | | 112 | 135 | 156 |
| build123d (names, enum members, methods, measured properties, Python control constructs), families, greedy | 199 | 103 | 142 | 181 | 199 |

Frequency ordering needs a few more constructs: for example FS kernel 26 / 36 / 53 and build123d 116 / 166 / 194
for 50 / 80 / 95 % of families.

**FS kernel core for 80 % of families (35):**

- Operations: `opDeleteBodies`, `opExtrude`, `opBoolean`, `opPattern`, `opLoft`, `opTransform`, `opFillet`,
  `opRevolve`, `opChamfer`, `fCylinder`, `fCuboid`.
- Queries: `qCreatedBy`, `qUnion`, `qBodyType`, `qAllModifiableSolidBodies`, `qSubtraction`, `qOwnedByBody`,
  `qEverything`, `qNothing`, `qContainsPoint`, `qGeometry`, `qNthElement`, `qSketchRegion`.
- Sketch: `newSketchOnPlane`, `skSolve`, `skCircle`, `skPolyline`, `skLineSegment`, `skArc`, `skText`,
  `skRectangle`.
- Read-back: `evaluateQuery`, `evVolume`, `evBox3d`, `evLine`.

**Added for 95 % (14):** `evPlane`, `opOffsetFace`, `qAdjacent`, `evSurfaceDefinition`, `opDeleteFace`,
`opSplitPart`, `qClosestTo`, `opSweep`, `qLargest`, `evArea`, `fCone`, `opMoveFace`, `qIntersection`, `qSplitBy`.

**Tail (1 to 3 families each):** `evEdgeTangentLine`, `qCompressed`, `skEllipse`, `evApproximateCentroid`,
`evDistance`, `evFaceTangentPlane`, `evLength`, `opThicken`, `qCoincidesWithPlane`, `qEdgeConvexityTypeFilter`.

The full-construct curves are flat: the first 64 constructs cover only 28 % of FS families. Real files are 200
to 900 lines and each one touches a broad but shallow value vocabulary (trig, vector algebra, string concatenation,
maps). The expensive semantics are narrow: 35 to 49 kernel functions, 3 Boolean modes, blind extrude. The cheap
semantics are broad. For a new core language this means the value layer must be complete from day one. The kernel
layer can start small.

## 6. Design test cases

These five real files serve as acceptance cases for any core form: IR, language or graph. The corpus is read only
and changes over time (it grew by 4 FS files during this stage), so each case is pinned by SHA-256 in
`corpus.json` → `testCases`.

| id | file | lines | sha256 (prefix) | ladder | why |
|---|---|---:|---|---|---|
| **fs-simple** | `cad-project-039/hopper-corner-inserts-r1/inserts.fs` | 55 | `ba2fb8d600079acb` | 1 lazy query | Handwritten. Parametric line/arc sections in a literal-array loop, `opLoft` over 6 profiles, half-space trims, mirror via `opPattern`, name/colour, final pose. No read-back. The baseline every core form must pass. |
| **fs-medium** | `cad-project-002/funnel-holder-r2/guide-r2.fs` | 111 | `6fa65ec71cd8f15a` | 6 map | Three namespaced Part Studio imports plus instantiator. Selects the left source body by `evBox3d`. Selects chute-seat faces by `evPlane` normal and a bbox window. `opOffsetFace`, `opPattern` envelopes, a boolean per evaluated body, engraved `skText`, try/rethrow with stage names, final solid-count assert. |
| **fs-hard** | `cad-project-014/bottom-drive-purpose-2026-09-19/src/drive-purpose.fs` | 915 | `73795e9477436d87` | 5 selection + failure | Module with generated blocks, 27 features and 35 helper functions, a purpose registry through `getVariable`/`setVariable`, `setAttribute`, reference-body selection by measured volume, face selection by bbox window, loft routes, a `try/catch` that builds a diagnostic body. |
| **py-medium** | `cad-project-035/project-component-d98e059b.py` | 396 | `59c3d61218c9c842` | 7 (fallback loop) + failure | Algebra-mode part with the dominant corpus idiom 11 times: `edges().filter_by(Axis)` plus a comprehension over `e.center()` windows, then `if roots: fillet/chamfer`, with a one-edge-at-a-time fallback when the batch fillet fails. |
| **py-hard** | `cad-project-046/mount.py` | 962 | `9f0747f12f168688` | 7 + complex predicates + failure | Builder and algebra mode, OCP edge-to-face adjacency maps, concave-edge classification through face normals and `is_inside` probes, iterative fillet with topology re-query (up to 24 passes) and radius fallback, deburr in a sacrificial subprocess, print-bed placement from measured bounding boxes. |

Secondary references (also pinned in `corpus.json`):

- `cad-project-047/ei.py`: the simplest real build123d part (pure algebra CSG with splines);
- `cad-project-041/single-step-r10/src/core_geometry.py`: the `Trace` dual-backend IR;
- `cad-project-028/sorter.fs`: 740 lines of machine-emitted SSA FS with zero read-back, which is what
  compiled output looks like.

## 7. Implications for the language decision

1. **Order: an internal core IR first, no new surface language yet.** A lazy operation graph covers the plain-graph
   and lazy-IR buckets: about 98 % of FS families and about 89 % of build123d families. It needs:
   - typed symbolic queries;
   - check nodes;
   - total Booleans;
   - arithmetic over measurements;
   - a small declarative predicate vocabulary (range window, direction, type, name);
   - map regions over query results;
   - `optional` / `orElse` combinators on kernel failure values.

   Prior art points the same way ([prior-art.md](prior-art.md), section 1). So does Marc's own practice: `Trace`,
   the FS helper layers, 128 generated FS files.
2. **FeatureScript stays the input; it is effectively first-order.** No closures, no recursion, no boxes, no types.
   89 % of loops are static. A partial evaluator can unroll the frontend's value-level work and emit the graph,
   and it can stay in JS: parse plus interpreter is ≤ 0.7 % of wall time according to profile.md. The rule "FS
   input stays unmodified" costs nothing here. The frontend keeps the full value layer and lowers only kernel
   semantics.
3. **build123d is a direct fit for a graph IR.** Algebra mode is operation-graph construction with operator
   syntax. Selector chains are lazy queries. The dominant host-side filter is a range window that the IR can
   express.
4. **Where a general language would matter:**
   - 2 to 11 % of families (mostly one project, `cad-project-046`, and fillet/chamfer fallback loops);
   - fork-join over independent features ([bend-feasibility.md](bend-feasibility.md) item 5: the binding
     re-enters Bend serially).

   For the first case, the cheaper fix is often in the kernel: robust fillets, failure as a value. For the rest,
   synchronous in-process calls cost microseconds.
5. **Check the claims against this corpus:**
   - a core form must run the five test cases (§6) end to end;
   - its IR must express every level ≤ 6 site in `corpus.json` without a host round trip;
   - any claimed speedup has to be measured end to end on these files, not inferred from the JS target.

## 8. Reproduce and limitations

```sh
# ~18 s and ~30 s at load 14 to 15; read-only on ~/Workspace/cad
uv run --no-project --offline --with build123d python scripts/lang/b3d-vocab.py fixtures/lang/b3d-vocab.json
node scripts/lang/scan-fs.mjs tmp/lang/fs-facts.json
node scripts/lang/scan-py.mjs tmp/lang/py-facts.json
node scripts/lang/corpus-report.mjs out/lang/corpus.json
node --test test/lang-corpus.test.mjs
```

Limitations:

- **Static counts.** A site inside a loop counts once. The dynamic number of kernel calls is higher. See §2 for
  why that matters little with in-process calls.
- **Wrapper layers are invisible to role detection.** 26 Python files model through wrappers (`Trace` `t.box` /
  `t.sub`, `core_geometry` `G.*`). They can land in the check or tooling roles, and the build123d population may
  miss some modeling files.
- **Over-approximations.** The following errors all push towards more synchronization, never less:
  - dict-of-parts loops whose container comes from a function return count as maps (level 6);
  - FS entity-selection data sites inside helpers inherit caller taint, which over-counts sites but does not
    change file levels;
  - Python model and check roles use a threshold heuristic.
- **Families** are a similarity heuristic (Jaccard ≥ 0.6). Numbers are given for unique files as well.
- **The corpus is live.** Counts moved by a few files during the stage: FS 561 → 565, Python 4,410 → 4,419. The
  final snapshot is the one in `corpus.json` (`scanners.scannedAt`).
