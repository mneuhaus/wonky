# OpenSCAD in wonky: frontend and differential test corpus

Status: design, 24 September 2026, **revised the same day after an
adversarial review** ([review.md](review.md); every finding and what was
done about it: section 15). Nothing here is implemented. This is the
architect's synthesis of four studies and two measurement rounds:

| input | what it contributes |
|---|---|
| [semantics.md](semantics.md) | language and geometry semantics, per construct, with the two-mode mapping |
| [oracle.md](oracle.md) | reference baselines from the installed OpenSCAD, tolerances, triage, storage |
| [corpus.md](corpus.md) | the 806-file primary corpus, 60 oracle runs, licences |
| [prior-art.md](prior-art.md) | other OpenSCAD interpreters, test corpora, Manifold |
| [review.md](review.md) | the adversarial review (1 blocker, 8 major, 12 minor findings) |
| `tmp/openscad/architect/` | this document's first measurements (section 0.2, items 1-3) |
| `tmp/openscad/revise/` | the revision's measurements (section 0.2, items 4-6) |

The German summary for Marc is [../openscad.md](../openscad.md).

## 0. Evidence

### 0.1 Labels

- **MEASURED**: run on this machine; the artifact path is given.
- **READ**: read in code, docs or a source; `file:line` or URL given.
- **INFERRED**: a design conclusion or proposal nothing above proves.

Numbers from the four studies keep their original label and are cited to the
study. Nothing was installed, committed or changed outside `docs/openscad*`
and `tmp/openscad/`.

**Oracle invocation.** Every `.csg`, `.echo` and `.ast` in this design is
dumped with `--render`. Without it OpenSCAD evaluates those formats with
`$preview = true` while STL, OFF and nef3 get false (READ `[S]
openscad.cc:422`, `:468`; MEASURED review r05; oracle.md §4.1). The first
measurement round had missed this; items 4-6 below redo it.

### 0.2 New measurements for this design (MEASURED)

1. **OpenSCAD reproduces its own evaluated tree.** Rendering the flat `.csg`
   that OpenSCAD dumped for a model gives the same solid as the model itself
   in 3 of 4 cases (two byte-identical binary STLs; one with equal volume and
   triangle count, Hausdorff 1.7e-11 mm). The fourth, `torus-customizer.scad`
   (360 rotated cubes), differs by 7.9e-5 mm Hausdorff and 2.9e-7 relative
   volume, because `.csg` prints matrices with 6 significant digits.
   Consequence: a test that feeds OpenSCAD's `.csg` to wonky must use the
   render of that `.csg` as its reference ("csg-self reference"), not the
   render of the original `.scad`. Evidence:
   `tmp/openscad/architect/rerender/compare.json` (script `compare.mjs` next
   to it; timings in the `.log` files: 0.03 s to 5.25 s). These four trees
   are byte-identical when re-dumped with `--render` (item 4), so the result
   stands. With `--render`, the same holds for `cable_clip` (relative volume
   −1.5e-7, Hausdorff 1.5e-5 mm) and `gridfinity-rebuilt-bins` (1.0e-8,
   4.6e-5 mm); their preview trees were off by 147 % and 4.75 mm (MEASURED
   `tmp/openscad/revise/rerender/compare.json`, review
   `tmp/openscad/review/rerender/`).
2. **The language layer is cheap to test.** OpenSCAD's `.csg` dump of the 60
   census cases took 12.0 s in total (median 0.06 s, max 2.1 s), against
   515.7 s for their STL renders. 53 of 60 dumps had no error. With
   `--render` and `.echo` added: 18.7 s for the 60, 53 error-free again
   (MEASURED `tmp/openscad/revise/csg-render.json`), and 78 s for 269
   permissive-licence files (267 error-free, `perm-dump.json`).
3. **Capability tiers of real evaluated trees.** A static scan of the 46
   OpenSCAD-evaluated trees that produced a mesh classifies every node
   (primitive, transform class by determinant and orthogonality, extrusion
   kind, 2D Booleans including implicit unions under extrusions, hull,
   Minkowski, import, text). The first scan
   (`tmp/openscad/architect/csg-scan.mjs`, `coverage.mjs`) read preview
   trees and is **superseded** by item 5.
4. **The census trees re-dumped with `--render`** (MEASURED,
   `tmp/openscad/revise/csg-render.mjs` → `csg-render.json`, `runs/`). 56 of
   60 are byte-identical to the preview dumps. Three differ because of
   `$preview`: NopSCADlib `cable_clip` (strict reference), kennetek
   `gridfinity-rebuilt-bins` and NopSCADlib `rod` (status `empty`; a 17 MB
   preview tree, an empty render tree). dotSCAD `packing_circles` differs
   by unseeded `rand()`. `$preview` is in the dependency closure of 14 of
   the 60 runs.
5. **Revised capability scan and coverage** (MEASURED node counts, INFERRED
   package sets; `tmp/openscad/revise/csg-scan2.mjs` → `csg-scan2.json`,
   `coverage2.mjs` → `coverage2.json`; section 10). New in the scan: exact
   signed-permutation matrices are told apart from 6-digit rotations (with
   the worst orthonormality defect), the include/use closure is recorded
   (library files mean the geometry lane needs S4), and the reference log
   is classified (missing file, unknown module, undefined value, float32
   fallback).
6. **A named, committable csg-lane list for S1b** (MEASURED
   `tmp/openscad/revise/s1refs/s1refs.json`): the 269 permissive files were
   dumped and scanned; the candidates that need only S1b's capabilities were
   rendered, and every reference is clean (0 warnings, admitted mesh). For
   the four both-mode files the csg-self render equals the `.scad` render
   within 5.2e-13 mm or byte-identically; for `example019` it differs by
   4.2e-5 mm and for the rotated CC0 examples by up to 1.25e-4 mm (6-digit
   numbers), which is why the csg lane uses csg-self references. The list
   is in section 12, S1b.

## 1. Summary

1. **One frontend, two contracts.** wonky reads unmodified `.scad` files with
   its own JS parser and evaluator, next to the FeatureScript and Python
   frontends. The evaluator produces OpenSCAD's own intermediate form, a flat
   CSG node tree, and a mode-specific lowering turns that tree into Bend
   operations.
   - **faceted** builds exactly the polyhedra OpenSCAD builds (its fragment
     rules, per dialect). Every face is planar, every body is an exact planar
     B-rep, and the result is comparable with OpenSCAD's mesh to about 1e-7
     relative. This is the default for corpus testing.
   - **intent** builds exact cylinders, cones, spheres and tori. It is what
     one would print or export as STEP, and the proposed default for Marc's
     own modeling (G2; no original Marc model is in the corpus yet, section
     7). Deliberate polygons (small resolved `$fn`) stay polygons, by a
     stated per-leaf rule.
2. **Three test lanes, cheapest first.**
   - **csg lane:** OpenSCAD's own `.csg` dump (with `--render`) goes
     straight into wonky. It tests the geometry without the interpreter,
     from the first package on. Its 6-digit matrices are affine, not rigid
     (section 5).
   - **language lane:** wonky's evaluated tree against OpenSCAD's `.csg` and
     `.echo`. No geometry at all, so it can reach far more files than the
     kernel lanes, long before the kernel does (at most the 633 distinct
     model contents of the primary corpus; section 10).
   - **geometry lane:** the full `.scad` through wonky against OpenSCAD's
     reference mesh (faceted), and against OCCT's exact CSG of wonky's own
     full-precision tree (intent). It needs the evaluator (S3a-b), and the
     library layer (S4) for files that include libraries.
3. **The first differential tests come from packages S1a and S1b** (section
   12): the parser, a literal evaluator, cube, cylinder, straight
   extrusion, exact axis transforms and the three Booleans in both modes, a
   minimal reference tool and a comparator. With existing kernel operations
   only, it reaches about 12 own fixtures plus a **named list of
   permissively licensed csg-lane files**: four in both modes (CC0
   `example003`, BSD-2 `Shapes3d-001`, `Shapes3d-029` and `Mutators-039`, a
   union of 1000 cubes that stresses long Boolean chains) and two more in
   intent mode (CC0 `example002`, `example019`). Only one of the 21 strict
   census references is in reach (`Shapes3d-001`, a single cube); the
   earlier claim of two counted `torus-customizer`, which needs affine
   transforms and a 359-step hybrid chain (now S6a and S12).
4. **The kernel gaps are few and ordered.** In payoff order: a Bend
   polyhedral solid constructor (S5), affine transform push-down and
   faceted leaves (S6a-c), a 2D subsystem (S8a-c), an exact 3D convex hull
   and Minkowski (S9a-b), mesh and heightmap ingress (S10a-b). After all of
   them, the faceted lanes cover **18 of the 21 strict references**. The
   25 other meshed census runs (8 clean with an unadmitted mesh, 7 warned,
   10 quarantined for missing files or unknown modules) are reported
   separately and never gate. `text()` and
   `projection()` remain refused (section 10).
5. **Every unsupported construct refuses by name**, in both modes and in
   strict and compat evaluation. Faceted bodies are labelled faceted, never
   exact analytic; intent bodies say which leaves stayed polygonal.

## 2. Goals and non-goals

### 2.1 Goals

- **G1 Differential test corpus.** Run arbitrary OpenSCAD files from the
  internet and from Marc's archive through OpenSCAD for reference baselines,
  then through wonky, and triage every difference to one owner: interpreter,
  faceting, Boolean, export, or the oracle itself.
- **G2 A second authoring language for Marc.** `wonky view part.scad` with
  live rebuild, exact STEP, khana checks, as for `.fs` and `.py`. This goal
  comes from Marc's idea of 2026-09-24 (the frontend should also be useful
  for his own work), not from corpus evidence: the `.scad` files under `~/Workspace/cad` are third-party
  downloads (corpus.md §2.1), and the three `cad-project-039` files
  are copies of the downloaded `lock_openlock.scad` (MEASURED
  `inventory.json`).
- **G3 Kernel pressure from real CSG.** OpenSCAD models are long CSG chains
  over many coplanar and near-coplanar faces. wonky has never run more than 6
  Boolean steps in a chain (READ `docs/research/synthesis.md` §4.1). The
  render trees have up to 943 Boolean children (`dancing_cubes`), 360
  (`torus-customizer`), 319 (`ScaleExtrudeHorns`) and 208 (`cable_clip`;
  445 in its preview tree); the permissive `Mutators-039` has 2,999
  (MEASURED `tmp/openscad/revise/csg-scan2.json`).
- **G4 Export checks.** Every compared case also round-trips wonky's STEP and
  STL through independent readers (`scripts/validate-step.py`,
  `scripts/r20/mesh.mjs`).

### 2.2 Non-goals

- **No OpenSCAD in production.** OpenSCAD, OCCT and manifold3d are oracles
  only, run through the CLI or `uv` (AGENTS.md:4). wonky never shells out to
  OpenSCAD to evaluate a user's file, never imports its meshes as results,
  and ships no GPL code. Its rules are restated from reading, not copied
  (semantics.md §0). Faceted mode must reproduce some GPL algorithms bit
  for bit (the slice and diagonal rules of `[S]
  GeometryEvaluator.cc:840-1060`, the `rotate_extrude` rules); writing that
  code while reading the GPL source risks a derivative work. The proposed
  guard is a clean-room split (decision D11): one agent writes a
  behavioural specification from probes and prose, another implements it
  without reading `[S]` or `[M]`. wonky itself is `"private": true` with no
  LICENSE file (READ `package.json:4`), so the licence of the kernel is
  also still open.
- **No translation to FeatureScript.** OpenSCAD sources are read unmodified,
  as AGENTS.md:3 requires for FS inputs.
- **No silent polygonization** (AGENTS.md:8) and **no silent mesh fallback**
  in intent mode. scad123d's mesh fallback is the counterexample (READ,
  prior-art.md §3).
- **Not a preview renderer.** No `$vpr`, camera, colors beyond body
  appearance, `%` preview geometry, or animation (`$t` stays 0).
- **Not in v1:** `text()` (needs a font engine and pinned fonts), `roof()`,
  experimental `object()`, OpenSCAD's Python mode, 2D-only top-level output
  (a 2D result refuses as "2D output"; a later DXF/SVG export can lift this).
- **No automatic intent guessing.** A threshold rule for deliberate polygons
  exists, but it is explicit, configurable and recorded per leaf
  (section 3.3). prior-art.md §1 and §7 warn against heuristic intent.

## 3. The two modes

### 3.1 Definitions

| | faceted | intent |
|---|---|---|
| contract | the exact polyhedron OpenSCAD defines for this file under dialect D | the ideal solid the author meant: circles are circles |
| curved primitives | n-gons, ring polyhedra, faceted revolutions (semantics.md §7.3, §7.8) | exact cylinder, cone, sphere, torus carriers |
| every face | planar | plane, cylinder, cone, sphere, torus |
| body label | `openscad.mode: faceted`, exactness `exact planar B-rep of an OpenSCAD tessellation` | `openscad.mode: intent`, per-leaf `kept-polygon` flags |
| reference | OpenSCAD's mesh (tight: δ_snap + δ_format, oracle.md §5; wider for the float32 fallback) | OCCT exact CSG of the same numbers at 1e-7 relative (wonky's full-precision tree on the geometry lane, `ref.csg` on the csg lane); OpenSCAD within per-leaf symmetric-difference allowances (oracle.md §6) |
| what it tests | interpreter, faceting, planar and hybrid Booleans, exporters | analytic leaves, curved Booleans, STEP |

Both modes share the parser, the evaluator, the node tree, transforms and
Boolean dispatch. Only leaf lowering and a few operations (hull, minkowski,
offset, twist) differ (semantics.md §9.1).

### 3.2 Which mode by default

| use | default | why |
|---|---|---|
| corpus and differential tests | faceted, then intent as a second lane | faceted is directly comparable with the oracle; intent needs OCCT and allowances |
| Marc's own modeling, `wonky view`, STEP export | intent | exact STEP and khana checks on real bores; OpenSCAD's defaults are coarse (r = 1 is a pentagon with 24 % area deficit, oracle.md §3.4) |
| reproducing a downloaded STL exactly | faceted | the file's literal geometry |

The CLI flag is `--mode faceted|intent`; the viewer shows the mode in its
trust indicator.

### 3.3 Deliberate polygons in intent mode

`cylinder(r = 3, $fn = 6)` is a hexagon nut trap, not a coarse circle. The
census finds literal `$fn` values 3 to 6 in 27 of 806 files and `$fn = 8` 61
times (MEASURED, corpus.md §3.3); the downloaded OpenLOCK pin library
(`lock_openlock.scad`, third-party, copied into Marc's research folders) uses
`r = 0.75, $fn = 8` 52 times (MEASURED, semantics.md §9.5).

Rule (INFERRED, decision D3): in intent mode a circle-type leaf stays a
polygon when its **resolved** specials give the fragment count through `$fn`
(`$fn > 0`) and that count is at most `N` (default 8,
`--intent-polygon-max N`). Counts from `$fa`/`$fs` and larger `$fn` become
exact circles. The rule reads only the leaf's resolved `($fn, $fa, $fs)`,
which a `.csg` file carries per leaf too, so it classifies identically on
the csg lane and on the geometry lane, whether `$fn` was set globally or at
the call site (prior-art.md §1 item 2 notes that `.csg` cannot tell them
apart; the rule deliberately does not try). What differs by lane is only
the provenance record: on the geometry lane wonky's interpreter knows where
`$fn` was set, so the record says "leaf at part.scad:12:5: kept 6-gon
(explicit $fn = 6 at part.scad:12:30)"; on the csg lane it names the `.csg`
node. A difference in kept-polygon sets between the lanes can only come from
a different resolved `$fn` and is therefore a language-lane diff. The CLI
prints one summary line with the count of kept polygons; the viewer lists
them.

## 4. Architecture

### 4.1 Pipeline

```
.scad source (+ include/use closure, pinned by sha256)
  │ src/openscad/lexer.mjs, parser.mjs        grammar [M] with dialect flags (semantics.md §1-2)
  ▼
AST with source spans
  │ src/openscad/evaluate.mjs, builtins.mjs, values.mjs, files.mjs
  │   values, scopes, $-dynamic scope, functions, modules, children, include/use,
  │   strict | compat diagnostics ledger (semantics.md §3-6)
  ▼
OpenSCAD node tree  ───────────────►  --dump-csg (OpenSCAD .csg syntax), .echo   ← language lane
  │ (evaluated with $preview = false)   --dump-tree (17 digits)                  ← OCCT intent oracle
  │ (builtin primitives, multmatrix, CSG, extrusions, hull, ...; resolved $fn/$fa/$fs,
  │  source span per node; identical in shape to OpenSCAD's .csg dump)
  │ src/openscad/lower.mjs  + lower-faceted.mjs | lower-intent.mjs
  │   fragment counts (dialect), transform push-down, pattern recognition (intent hull),
  │   preflight: every refusal named before any kernel call
  ▼
op records (WK/0 once it exists; today direct calls as in src/python.mjs)
  │ extrudeInBend, circularFrustumInBend, sweepInBend, transformInBend/Analytic,
  │ polyhedral constructor (new, S5), 2D module (new, S8a-c), hull (new, S9a), opBoolean
  ▼
Bend kernel → bodies → brep.json (+ openscad block), STEP, STL, 3MF
```

The csg lane enters at the second box: a `.csg` file is valid OpenSCAD
source with literal arguments only, so the same parser reads it and a
literal-only evaluator suffices (package S1a).

### 4.2 Why the node tree is the pivot

- **It is OpenSCAD's own intermediate form.** OpenSCAD evaluates in two
  phases: instantiation into a node tree, then geometry (READ semantics.md
  §4.1). The CLI dumps that tree as `.csg`, and its test suite keeps 241
  `.csg` goldens (READ prior-art.md §2). Matching it is a precise,
  geometry-free contract.
- **No geometry feeds back into the language.** Unlike FeatureScript,
  OpenSCAD has no geometric queries: the whole tree exists before the first
  kernel call. So preflight can name every capability refusal of a file with
  its source line before building anything, and subtrees can be hashed and
  cached (OpenSCAD itself caches geometry per subtree). `resize()` is the one
  node that needs a child's geometry (its bounding box), and it is a geometry
  node, not a language value (semantics.md §7.4).
- **It isolates bugs.** Language bugs show up as tree diffs; geometry bugs
  show up with an identical tree. Re-running wonky on OpenSCAD's own `.csg`
  confirms which (oracle.md §7 step 1; prior-art.md §1).

### 4.3 Code layout (INFERRED)

| path | content |
|---|---|
| `src/openscad/lexer.mjs`, `parser.mjs` | tokens, EBNF of semantics.md §2, spans, dialect switches (`openscad-2022.05`, `openscad-master`) |
| `src/openscad/values.mjs` | seven runtime types, operators, `ToPrecision(6)` formatter, degree trig (semantics.md §3, §7.2) |
| `src/openscad/evaluate.mjs` | scopes, assignment rules, `$` stack, modules, `children()`, control, recursion limits |
| `src/openscad/builtins.mjs` | builtin functions (semantics.md §4.8), `rands` with mt19937 |
| `src/openscad/files.mjs` | include/use search, library roots, provenance, asset resolution |
| `src/openscad/tree.mjs`, `dump-csg.mjs` | node types, `.csg` writer |
| `src/openscad/faceting.mjs` | fragment counts per dialect; facet point sets (decision D1) |
| `src/openscad/lower*.mjs` | mode lowering, push-down, patterns, refusals |
| `src/openscad/index.mjs` | `buildScad(source, options)` like `buildPython` |
| `bin/wonky-scad.mjs` | CLI (oracle.md §11), recognized by `bin/wonky-view.mjs` |
| `scripts/openscad/` | `reference.mjs`, `compare.mjs`, `corpus.mjs`, `csg-diff.mjs`, OCCT and manifold3d `uv` scripts |
| `fixtures/openscad/` | own and permissive cases, `cases.json`, `reference.json`, `arbiter.json`, `provenance.json` (oracle.md §9) |
| `test/openscad-*.test.mjs` | never runs OpenSCAD |

The FS frontend is `src/parser.mjs` (329 lines) plus `src/interpreter.mjs`
(403 lines) plus `src/library.mjs`; the Python frontend lowers protocol
requests in `src/python.mjs` (READ). The OpenSCAD lowering follows
`src/python.mjs`: finite-argument checks, one function per operation, named
`UnsupportedFeatureError`s, source-map records.

### 4.4 Where WK/0 fits

WK/0 is the planned host-side, content-addressed graph IR of kernel
operations, recorded from unmodified frontends (READ `docs/language.md:30-35`,
`:61-63`; `src/lang/wk/` is still empty). The OpenSCAD lowering emits exactly
those op records:

- the lowered tree is a first-order graph with no queries, the easiest
  frontend WK/0 will ever see;
- WK/0's preflight, graph hash and graph diff then work for `.scad` for free:
  the hash is the cache key of a subtree, and a diff after an edit rebuilds
  only dirty subtrees;
- until WK/0 lands, the lowering calls the kernel functions directly, as
  `src/python.mjs` does, through one narrow adapter that becomes the recorder
  later.

### 4.5 The Bend boundary (decision D1)

AGENTS.md:4 puts the geometry kernel in Bend. semantics.md §9.2 and this
section now state the same split (review m3); which variant to build is
Marc's decision D1.

What the frontend (JS) may compute:

- fragment counts, slice counts, ring counts, start angles: pure arithmetic
  on language values, needed anyway for the `.csg` and allowance bookkeeping;
- **language-defined coordinates**: the facet point sets whose coordinates
  the OpenSCAD language defines by formula (circle n-gons, sphere rings,
  frustum rings, revolution rings, the unrefined slice outlines), computed
  with OpenSCAD's degree trig in binary64, just as the points of a
  `polygon()` literal that a user computes with `cos()` and `sin()`;
- **combinatorial face lists**: which ring index joins which, fixed by the
  primitive's definition and independent of the coordinates.

What Bend decides, always: every geometric **predicate** and every solid.
That includes the shorter-diagonal choice of twisted and scaled slices,
outline refinement by longest edge, collinearity and planarity, the
`resize()` bounding box, the centre vertices of `surface()` cells, and then
building each solid, fitting every face plane, checking closedness,
orientation, manifoldness and self-intersection, computing volume and
bounds, and every Boolean, hull and offset. The FS precedent the first
version cited (JS computes sketch points) covers user-computed points only,
not builtin tessellation decisions (READ `src/library.mjs:280-290`
computes transforms, not solids).

The alternative is a Bend constructor per primitive from `(r, n)`. It is
more literal to AGENTS.md but duplicates the faceting formulas in Bend,
where F32x2 (about 48 bits, READ `docs/language.md` §1) cannot reproduce
binary64 degree trig bit for bit. The difference is 1e-14 relative and below
every tolerance either way (semantics.md §9.2).

### 4.6 Boolean routing

- The existing dispatch tries exact arms first and the hybrid last (READ
  `src/boolean.mjs:41-60`, `:199-260`). OpenSCAD's faceted cylinders go
  beyond the planar arrangement at once: it admits at most 32 support planes
  and 256 faces per input (READ `docs/planar-boolean.md:36-38`), and
  `$fn = 200` occurs 337 times in the local research mirrors (MEASURED
  semantics.md §9.5).
  Z-axis n-gon prisms with common caps fit the exact prism arm
  (`src/prism-boolean.mjs:1-40`); everything else reaches the hybrid.
- corefine meshes planar faces exactly, so on faceted input the hybrid's
  deviation is zero on every face (INFERRED from the tagging in
  `src/hybrid.mjs:101-148`). Faceted OpenSCAD models are therefore exact
  inputs for corefine+recover and a clean stress test of it.
- **N-ary operations.** OpenSCAD's implicit unions and `for` loops create
  wide nodes (up to 943 children, MEASURED `csg-scan.json`). The lowering
  folds them as balanced trees, applies the FS frontend's 1 µm separation
  rule (READ `src/library.mjs:76`, `:191`) so disjoint bodies skip the kernel,
  and records each Boolean with its tree path. A later option (S12) sends a
  whole subtree as one hybrid job: the job format already carries a CSG tree
  (READ `src/hybrid.mjs:122-158`, bake-off format `docs/bakeoff.md:164-177`).
- Intent 2D CSG under a straight `linear_extrude` becomes 3D CSG of extruded
  exact leaves (extrusion distributes over Booleans, semantics.md §9.3). The
  prism arm already Booleans such right prisms exactly as a 2D line/arc
  region Boolean in Bend (READ `src/prism-boolean.mjs:1-10`).
- **Dense n-gons and profile merging** (review m5). `extrudeInBend` merges
  near-collinear profile vertices: `PROFILE_MERGE.allowRegularized` is a
  global `true` (READ `src/kernel.mjs:84`, used at `:171`) and the
  tolerance is max(floor, 2^-20·|x|max) (READ
  `kernel/profile-ring.bend:95`, floor 1e-5 mm at `:83-84`). An n-gon
  loses vertices when r·(1 − cos 2π/n) ≤ tol: `$fn = 360` for r ≤ 0.066
  mm, `$fn = 1000` for r ≤ 0.5 mm, and `$fn = 200` for r ≤ 0.97 mm if the
  profile sits 500 mm from its sketch origin. Faceted lowering therefore
  (1) puts the sketch origin at the leaf centre and applies the placement
  afterwards, and (2) calls with `allowRegularized = false`, so Bend's
  face-loop admission refuses such a vertex (READ `src/kernel.mjs:80-82`),
  which the frontend reports as the named refusal "faceted n-gon below the
  profile tolerance". Today the flag is global; a per-call option is a
  one-line change to `src/kernel.mjs` that has to be coordinated (section
  11). A fixture covers it (S1b).

### 4.7 Strict and compat evaluation

OpenSCAD continues after almost every problem: `cylinder(r = undef)` becomes
an r = 1 pentagon cylinder, `cube(-3)` vanishes, exit code 0 (MEASURED
oracle.md §3.2).

- **strict** (default for Marc): a geometry-affecting warning raises a named
  error with its source span (AGENTS.md:7).
- **compat** (`--compat`, default in corpus runs): OpenSCAD's substitution
  is emulated, every warning is recorded with its span, and the result is
  labelled **degraded**, never plain success. A `warned` reference is never a
  PASS gate (oracle.md §4.4).

### 4.8 Dialects

The installed binary is a development snapshot, `2022.05.16 (git
6aae79634)`, not a release (MEASURED semantics.md §0.1). Fragment rounding
(`trunc` vs `ceil` of `$fn`), `rotate_extrude` section counts and start
angle, and a few tokens differ from current master (READ semantics.md §7.1,
§7.8; MEASURED prior-art.md: `$fn = 3.7` gives 3 segments here). Every run
carries `--dialect`; every reference carries the oracle's version and git
hash; a baseline is compared only with a run of the same dialect.

### 4.9 Provenance and sandbox

Every included, used, imported and surface file is recorded with its
absolute path, library root and sha256; libraries are resolved only from
declared roots (the file's directory, `OPENSCADPATH`-style roots given on the
command line, pinned snapshots). `~/Workspace/cad` stays read only, as for
Python (READ `docs/python-frontend.md` "Read-only roots"). A `.scad` file can
name arbitrary paths in `import()`; paths outside the roots refuse
(prior-art.md §4).

## 5. Feature coverage per mode

"Now" means an existing wonky operation suffices (READ `src/kernel.mjs:169`,
`:218`; `src/analytic.mjs:140`, `:201`, `:337`). Package numbers refer to
section 12. Everything not listed as supported raises
`UnsupportedFeatureError` with the construct, its source span and the missing
capability.

**Matrices differ by lane** (review M5). On the geometry lane wonky builds
every `rotate`/`translate` matrix itself in binary64 with degree trig, so a
rotation is orthonormal to about 1e-16 (INFERRED), well inside the rigid
budget of `polygonPrism.transform`, which refuses any rotation that is not
orthonormal within `10·angular_guard = 1e-11` with `NonRigidRotation`
(READ `kernel/polygon-prism.bend:92-93`, `:142-148`, `:352-366`;
`kernel/intersections.bend:51`). On the csg lane the matrices come from
`ref.csg` at 6 significant digits: 14 of the 46 meshed census trees (6 of
the 21 strict) contain rotations with orthonormality defects of 5.0e-7 to
1.13e-6 (MEASURED `tmp/openscad/revise/coverage2.json`), which the prism
arm refuses; `transformAnalytic` would apply them unchecked (READ
`kernel/analytic.bend:102`), leaving carriers inconsistent with their
vertices. Orthonormalizing moves points by about 1e-6·|x|, above δ against
the csg-self reference. So:

- csg lane: every `multmatrix` is **affine**. Exact signed permutations
  plus a translation (the common case: 19 of 46 trees have nothing else)
  are rigid and work now. Anything else is pushed down to the leaf points
  in faceted mode (S6a: the affine image of a cube or n-gon prism is a
  planar oblique prism, built from the mapped profile along the mapped axis
  with a binary64 Gram-Schmidt frame, or by the S5 constructor); in intent
  mode it is refused, or regularized with the stated deviation
  defect·|x|max entering δ (S7a).
- geometry lane: rigid lowering is fine; a matrix a user writes literally
  with rounded numbers is not rigid and takes the csg-lane path.

| construct | faceted | intent | refusal (both modes unless stated) |
|---|---|---|---|
| language core (values, scopes, functions; modules, `children`, control) | S3a, S3b | S3a, S3b | `object()` and experimental features by name |
| `include`/`use`, library roots, all builtins, parameters | S4 | S4 | paths outside the declared roots |
| `cube`, `square`, `polygon` (simple) | now (prism, S1b) | now (S1b) | non-positive size in strict mode |
| `polygon` with paths (even-odd) | S8a | S8a | self-overlap the 2D module cannot resolve |
| `circle`, `cylinder` r1 = r2 | now (n-gon prism, S1b) | now (exact, S1b) | faceted: n-gon below the profile tolerance (section 4.6) |
| `cylinder` frustum | S6a (via S5) | now (`circularFrustumInBend`, S1b) | none |
| `cylinder` with apex | S6a | S7a (`sweepInBend` triangle profile) | none |
| `sphere` | S6a (ring polyhedron) | S7a (`sweepInBend` half disc) | none |
| `polyhedron` | S5/S6a | S5/S6a (the mesh is the intent) | open shell, non-manifold, self-intersection; non-planar faces without a reproduced triangulation rule (oracle.md §5) |
| `translate`, `rotate` (geometry lane), exact signed-permutation `multmatrix` (both lanes) | now (S1b) | now (S1b) | none |
| 6-digit rotation `multmatrix` (csg lane) | S6a (affine push-down) | S7a (regularized, deviation in δ) or refused | intent: "non-rigid matrix" until S7a |
| `mirror`, reflecting `multmatrix` | S6a (push-down, reversed faces) | S6a (push-down, reflected frames) | none |
| `scale`, `resize`, affine `multmatrix` | S6a (push-down to points; the `resize` bbox decided in Bend) | S6a when circles stay circles | intent: elliptic result ("elliptic carriers not in Bend") |
| `union`, `difference`, `intersection`, implicit unions, `intersection_for` | now (prism arm, hybrid) | now | whatever the hybrid refuses, by its reason |
| 2D Booleans | S8a (Clipper-compatible) | S7a when under an extrusion (lifted), else S8a for lines | intent: 2D arc Booleans outside extrusions until an exact 2D arc Boolean exists |
| `offset(r)`, `offset(delta)`, `chamfer` | S8b | refused in v1 | intent: "exact 2D offset with topology change" |
| `linear_extrude` straight | now (prism, S1b) | now (S1b) | none |
| `linear_extrude` uniform `scale` | S6c | refused in v1 | intent: "tapered extrusion" (planes plus cones; later) |
| `linear_extrude` twist or non-uniform scale | S6c (OpenSCAD's slices; diagonal choice in Bend) | never | intent: "helicoidal/ruled surfaces have no Bend carrier" |
| `rotate_extrude` | S6b (dialect counts and start) | S7a (`sweepInBend`) | profile across the axis (OpenSCAD errors too); intent: spindle case refused by `sweep` |
| `hull()` 2D and 3D | S8c (2D), S9a (3D exact convex hull) | S9c and later, one pattern per run (semantics.md §9.4) | intent: patterns outside the list |
| `minkowski()` | S8c (2D), S9b (convex ⊕ convex) | S9c and later (rounded polytope, rounded box) | faceted: non-convex operand until convex decomposition; intent: others |
| `import()` STL/OFF/3MF | S10a (via S5) | S10a, labelled "mesh input, exact to its facets" | non-closed or self-intersecting mesh, `.nef3`, paths outside roots |
| `import()` DXF/SVG | S10b (tessellated per `$fn`) | S10b lines and arcs | Bézier/spline entities in intent |
| `surface()` | S10b (centre vertices decided in Bend) | S10b (same heightmap) | none after pinning |
| `projection()` | later | later | "projection needs section caps" (READ `docs/section.md`) |
| `text()` | never in v1 | never in v1 | "text() needs a font engine and pinned fonts" |
| `color`, `render`, `#`, `%`, `!`, `*`, `convexity` | metadata, pruning | same | none |
| `$preview` | evaluated as `false` (the `--render` reference) | same | none |
| `roof()`, `$fe`, Python mode | never in v1 | never in v1 | by name |

## 6. Oracle harness and triage

The harness is specified in [oracle.md](oracle.md); this section fixes how
the design uses it.

### 6.1 References

- One pinned CLI (version, git hash, binary sha256), CGAL backend, run on
  copies under `tmp/` or `out/`, with a timeout and process-group kill, at
  most 3 processes (oracle.md §4.1; the census used 2, MEASURED corpus.md §4).
- **`--render` on every call** that writes `.csg`, `.echo` or `.ast`
  (review B1; oracle.md §4.1). `meta.json` records `render: true` and the
  `$preview` value (false); a cached reference without them is stale.
- Per case and dialect: `ref.bin.stl` with vertices snapped to the exact
  `.nef3` vertices, `ref.nef3`, `ref.csg`, `ref.echo`, `ref.deps`,
  `summary.json`, `run.log`, `meta.json` (oracle.md §4.2-4.3).
- **csg-self reference** for the csg lane: OpenSCAD's render of its own
  `ref.csg` (section 0.2). It removes the 6-digit rounding from the
  comparison.
- Status derived from log and outputs, never from the exit code alone: `ok`,
  `warned`, `non-manifold`, `empty`, `error`, `timeout`, `non-hermetic`,
  and since the review `openscad:float32-fallback` (log `CGAL error` /
  `nonplanar faces`), `inverted` (negative signed volume) and
  `exit0-error` (exit 0 with `ERROR:` lines) (oracle.md §4.4). The census
  adds a strict mesh admission (edge incidence, vertex links, no zero-area
  or duplicate triangles): 37 of 46 meshes pass, 21 of 60 runs are fully
  clean (MEASURED corpus.md §4). The census classified the float32-fallback
  run 018 as `success`; the revised scan flags it (MEASURED
  `tmp/openscad/revise/csg-scan2.json`).
- **Quarantine**: a reference whose log reports a missing file (`Can't open
  … file`, `couldn't be opened`) or an unknown module is quarantined, as
  corpus.md §5 asks; it is reported but never scored as a pass or a fail.
- Cache key: sha256 over source, dependency closure, parameters, oracle
  identity (including `--render`), backend, features and formats; cache
  under `out/openscad/cache/<key>/` (oracle.md §4.5).

### 6.2 Comparisons

| lane | compared | tolerance |
|---|---|---|
| language | `--dump-csg` vs `ref.csg`, both with `$preview = false`: structure exact, `group()` wrappers normalized, numbers parsed and compared within one unit of the 6th significant digit (never as strings, review m11); `.echo` lines after the same number rule; warning set | exact after normalization |
| csg faceted | wonky on `ref.csg` (matrices affine, section 5) vs the csg-self reference: volume, area, bbox, sampled Hausdorff; hard topology: shells, genus; advisory: Nef `facets`, V, E | δ = δ_snap + δ_format + 1e-9·L (oracle.md §5); δ_snap widened for `float32-fallback` references |
| geometry faceted | wonky on `.scad` vs `ref.bin.stl` | same |
| csg intent | wonky intent on `ref.csg` vs OCCT exact CSG of the same `ref.csg` (affine `gp_GTrsf`) | 1e-7 relative, bbox 1e-6 mm, shells equal (oracle.md §6.4) |
| geometry intent | wonky intent on `.scad` vs OCCT exact CSG of **wonky's full-precision tree** (`--dump-tree`, 17 digits); the language lane separately proves that tree equals `ref.csg` at 6 digits. Never wonky-on-`.scad` vs OCCT-on-`ref.csg` (2.9e-7 relative and 7.9e-5 mm apart from rounding alone, MEASURED section 0.2) | 1e-7 relative, bbox 1e-6 mm, shells equal |
| intent vs OpenSCAD | volume within Σ D_i with **D_i = V(A_i Δ A_i′)** or a sound bound of it (the net deficit only for provably inscribed leaves; `rotate_extrude` and `offset(r < 0)` are not inscribed, MEASURED review r03); Hausdorff within ε for ∪, hull, Minkowski and transforms, advisory for ∩ and − | per leaf from `$fn/$fa/$fs` of the `--render` `ref.csg` (oracle.md §6.1-6.2) |
| export | the mesh side from `brep.json` with a planar triangulation in the harness, or from `--format print` (prism-arm and hybrid results are `geometry: 'analytic'` even when planar, and `toStl` refuses them, READ `src/analytic.mjs:120`, `src/hybrid.mjs:420`, `src/exporters.mjs:191`); STEP via OCCT (`scripts/validate-step.py`); both against wonky's own `brep.json` | as the corpus runner (oracle.md §2) |

Rules from the measurements:

- faceted comparisons need OpenSCAD's triangulation of non-planar faces,
  because the diagonal choice moves the volume at first order (t07:
  +1.33 %, MEASURED oracle.md §3.4). The rule is per source and CGAL path
  (oracle.md §5, review m2): `linear_extrude` slices use the
  shorter-diagonal rule (S6c, decided in Bend); a convex polyhedron operand
  becomes the hull of its snapped points (READ `[S] cgalutils.cc:46-60`); a
  non-convex one with non-planar faces takes the float32 fallback with
  libtess2 (READ `[S] PolySetUtils.cc:103-110`; SGI-B licence, portable).
  Without a reproduced rule such a face is `semantics:triangulation` unless
  it is planar within δ;
- snap-decided topology (a feature below 2·δ_snap ≈ 3.3e-6 mm, or below the
  widened δ of a float32-fallback reference) is scored `ambiguous`,
  reported separately (MEASURED oracle.md §3.6);
- the Nef facet count is advisory: the snap splits rotated planar faces
  (MEASURED review r02: 18 facets where the exact B-rep has 12). It may be a
  hard check only when every leaf matrix is an exact signed permutation and
  every leaf face is axis-aligned or a wall of a straight Z prism;
- an `inverted` reference is compared on |V| and expects wonky's named
  reorientation warning.

### 6.3 Triage

In order, first match wins (oracle.md §7):

1. **language**: tree diff → `wonky-wrong:evaluation`, or `semantics:lenient`
   if the reference is `warned`; rerun wonky on `ref.csg` to confirm.
2. **faceting**: per-leaf diff against single-leaf OpenSCAD renders →
   `semantics:faceting` / `:triangulation` / `:version`.
3. **Boolean**: manifold3d 3.5.3 via `uv` on wonky's own faceted leaves
   (`--dump-job`, bake-off format) → `wonky-wrong:boolean` if manifold3d
   agrees with OpenSCAD; minimize into `fixtures/bakeoff/adversarial-*`.
4. **export**: `brep.json` right, STL or STEP wrong → `wonky-wrong:export`.
5. **oracle**: `openscad:snap` (ambiguous), `:float32-fallback` (widened δ,
   ambiguous below it), `:export-precision` (rederive from nef3),
   `:non-manifold` (expected refusal), `:backend`.
6. **intent only**: faceted passes, intent exceeds the allowance →
   `semantics:faceting-sensitive` (info).

Scores: `PASS`, `REFUSED` (named capability error), `FAIL:<class>`,
`ambiguous`, `unarbitrated`, `info`, `ref-invalid`, `ref-timeout`, plus
`degraded` for compat runs of warned files.

### 6.4 In `npm test` and at night

- `npm test` runs `test/openscad-*.test.mjs` on committed own cases and never
  starts OpenSCAD; a stale reference (source sha differs) fails the test
  (oracle.md §10).
- `node scripts/openscad/reference.mjs --check` regenerates references with
  the pinned CLI; without it the result is `oracle-unavailable`, never a
  pass.
- `node scripts/openscad/corpus.mjs` is the nightly, resumable corpus run in
  the pattern of `scripts/corpus/run.mjs`: units are file × parameter set ×
  mode, labels and `compare.mjs` regressions (exit 2), at most 3 processes.
  Corpus results are trend data, not a gate.

## 7. Corpus and licences

Details: [corpus.md](corpus.md).

- **Primary corpus: 806 files** (MEASURED): 395 local copies from
  `~/Workspace/cad` (314 distinct contents, 392 of them research mirrors,
  mostly archived terrain-model downloads; the other 3, in
  `cad-project-039`, are copies of the downloaded
  `lock_openlock.scad`; none is an original Marc design), 387 public
  originals from 10 repositories at pinned commits, 24 BOSL2 tutorial
  extracts. A supplementary census covers all 2,550 acquired files; their
  per-file source URL and licence record is
  `tmp/openscad/corpus-census/inventory.json`. 667 entries are models or
  geometry tests, with 633 distinct contents (MEASURED `census.json`).
- **Seed set: 21 strict references**, diagnostics-free with admitted meshes
  (20 public, 1 local). The other 39 runs are kept as negative and triage
  cases, not discarded (corpus.md §4).
- **Tiers** (prior-art.md §6, INFERRED): A = own cases and CC0 OpenSCAD
  examples; B = licensed public repositories and ThingiCSG (324 `.scad`
  files at a pinned commit, a corpus made for testing CSG engines, READ);
  C = community and dataset sources after per-file licence and dependency
  audit.
- **Units** are file × parameter set × mode. Customizer parameter sets count
  like FS features. Library tests that need an explicit entrypoint
  (NopSCADlib preview-only programs) get a separate invocation manifest,
  never hidden wrappers (corpus.md §6).
- **Licences** (oracle.md §9): commit sources and reference meshes only for
  own, CC0, MIT, BSD, ISC, zlib, Apache-2.0 and CC-BY files, with notices.
  GPL, LGPL and CC-BY-SA files stay in `tmp/openscad/corpus/` unless Marc
  decides otherwise (decision D5). NC, unlicensed and unknown files are never
  committed; only numbers and hashes about them are. The census found 293 of
  806 selected files without a resolved licence, 284 of them local mirrors
  (READ corpus.md §7). A reference mesh is a derivative and follows its
  source's row.

## 8. Results into khana, the viewer and WK/0

### 8.1 brep.json

Each body gets an `openscad` block: mode, dialect, per leaf the primitive,
parameters, resolved specials, fragments, rings, transform, tree path,
source span, `kept-polygon`, and the allowances ε and D as the frontend
computed them. The harness recomputes the allowances independently from
`ref.csg` and compares (oracle.md §11). A comparison run adds a `reference`
block: cache key, status, the measures of section 6.2, verdict and class.

### 8.2 khana

- OpenSCAD bodies are ordinary wonky bodies, so khana's checks run on them
  unchanged through the frontend-neutral check spec `wonky-checks/1` sidecar
  (READ `docs/khana/design.md` §6.1). An OpenSCAD language API for checks is
  not planned in v1.
- Printability checks should run on **intent** bodies. Faceted bores are
  prisms: C10 (bores and teardrops) sees planar faces, and C6 overhang bands
  change with the facet orientation (INFERRED from the check definitions in
  `docs/khana/design.md` §5.7, §5.11). In faceted mode the viewer says so.
- The differential verdicts use khana's result vocabulary: `pass` only with a
  stated bound, `fail` only with a witness (the Hausdorff witness point, the
  differing tree node), otherwise `unresolved`/`ambiguous`
  (`docs/khana/design.md` §3.1). The OCCT measurement script is shared with
  khana's parity harness K2.
- A dispute or `wonky-wrong:boolean` case that minimizes cleanly becomes an
  adversarial Boolean fixture, the same way bake-off cases feed the hybrid
  gate.

### 8.3 Viewer

- `wonky view part.scad` rebuilds on save, with the include/use/import
  closure watched, like `.fs` modules (READ `docs/viewer-ui.md`).
- Mode switch faceted/intent; kept polygons listed; picking a face shows the
  leaf's source span, `$fn`, and its allowance.
- **Reference overlay** (new layer, INFERRED): the cached OpenSCAD reference
  mesh drawn as a ghost with the diff-overlay's depth rules (READ
  `docs/viewer/diff-overlay.md`), the Hausdorff witness as a marker, and the
  triage class as a chip. No reference is ever shown as current if its cache
  key is stale.
- Refusals appear as "unsupported: …" with the source line, as today.

### 8.4 WK/0

See section 4.4: the lowered tree is recorded as WK/0 op records; preflight
lists every refusal of a `.scad` file without a kernel call; the graph hash
serves as the per-subtree cache key.

## 9. Performance expectations

- **Oracle.** CGAL render: median 0.50 s, p90 23.3 s, max 93.0 s successful,
  one timeout at 120 s over 60 cases; 515.7 s in total (MEASURED corpus.md
  §4). `--enable=fast-csg` was 11× faster on the 100-hole plate and on
  openforge bases (MEASURED oracle.md §3.2, semantics.md §8.3), but its
  topology is triangle-level, so it is a fallback lane only. A Manifold
  nightly would add a faster lane (author-reported 0.8 s vs 50 s CGAL on one
  example, READ prior-art.md §5); it was not measured here.
- **Language lane.** OpenSCAD's own `.csg` dumps take 0.06 s median
  (MEASURED section 0.2). wonky's parser and evaluator run in JS; in the FS
  frontend they are at most 0.7 % of wall time (READ `docs/language.md` §1).
  The whole 806-file language lane should run in minutes (INFERRED).
- **Geometry.** Unknown and to be measured from S1b on, with frontend, kernel,
  comparison and export timed separately (AGENTS.md:10). Hints: the hybrid's
  corpus compute was 31.0 s on JS and 6.2 s on one native CPU for 35 cases
  (READ `docs/hybrid-boolean-plan.md` §1); the native binding gives 7.6 to
  12.6× end to end (READ `docs/language.md` §1). A `$fn = 200` cylinder has
  202 faces; the 360-box `torus-customizer` union is 359 Booleans and `Mutators-039` folds 1000 cubes. Expect the long chains, not
  single Booleans, to dominate (INFERRED).
- **Budgets.** The corpus runner's timeouts apply; a wonky timeout is a
  classified result (`wonky-timeout`), never dropped.

## 10. Value: how much of the corpus becomes a differential test

Revised after the review (M6, B1). All counts are INFERRED planning sets from
MEASURED node scans of OpenSCAD's **`--render`** trees
(`tmp/openscad/revise/csg-scan2.json`, `coverage2.json`; the first version's
`tmp/openscad/architect/coverage.json` read preview trees and is
superseded). They assume every Boolean on the way succeeds; hybrid refusals
and wrong answers will lower them, which is exactly what the tests are for.

**Two lanes, counted separately.**

- **csg lane**: wonky reads OpenSCAD's own `.csg`. No evaluator needed; its
  6-digit rotations need the affine push-down (S6a, section 5).
- **geometry lane**: wonky reads the `.scad`. It needs the evaluator (S3b)
  for every file and the library layer (S4) for files whose include/use
  closure contains library files: 11 of the 21 strict references (MEASURED
  `coverage2.json` `libraries`). Its matrices are binary64, so rotations
  are rigid from S1b on.

**Headline: the 21 strict references** (diagnostics-free, admitted mesh),
cumulative after each package in the planned order:

| after | csg faceted | csg intent | geometry faceted | geometry intent |
|---|---|---|---|---|
| S1b | 1 | 1 | 0 | 0 |
| S3b | 1 | 1 | 1 | 1 |
| S4 | 1 | 1 | 2 | 2 |
| S6a (needs S5) | 6 | 3 | 6 | 4 |
| S6b | 6 | 3 | 6 | 4 |
| S6c | 7 | 3 | 7 | 4 |
| S7a | 7 | 7 | 7 | 7 |
| S8a | 8 | 7 | 8 | 7 |
| S8b | 9 | 7 | 9 | 7 |
| S8c | 10 | 7 | 10 | 7 |
| S9a | 14 | 7 (+ hull patterns) | 14 | 7 (+ hull patterns) |
| S9b | 15 | 7 | 15 | 7 |
| S10a-b | 18 | 10 | 18 | 10 |

- Faceted, in order of arrival: S1b `Shapes3d-001` (one cube); S6a `CSG`,
  `polyhedron-cube`, `Transforms-019`, `knot`, `torus-customizer`; S6c
  `linear_extrude`; S8a `Rounding_the_Cube-021`; S8b
  `gridfinity-rebuilt-baseplate`; S8c `cable_clip`; S9a `hull`,
  `rounded_cylinder`, `gridfinity-spiral-vase`, OpenForge
  `bases-wall-primary.scad` (a third-party Apache-2.0 download in Marc's
  research folder, not his design); S9b `minkowski3-tests`; S10
  `example010`, `example007`, `CutNut`.
- The 3 strict cases beyond S10a-b use `text()` (2) or `projection()` (1).
- On the geometry lane, `torus-customizer` arrives with S3b (no library,
  rigid binary64 rotations) and `Shapes3d-001` with S4 (BOSL2).

**Reported separately, never gating** (25 more meshed runs of the 46):

| bucket | runs | faceted after S10 (csg = geometry lane) | intent after S10 |
|---|---|---|---|
| clean, mesh not admitted (non-manifold or degenerate reference mesh) | 8 | 8 | 3 |
| warned (undefined values, overridden assignments, argument conflicts) | 7 | 6 | 2 |
| quarantined (missing import/include/DXF file or unknown module; corpus.md §5) | 10 | 10 (would build, but from an incomplete model) | 10 |

The float32-fallback run `spring_handle` (018) is in the first bucket and
carries the `openscad:float32-fallback` status.

**Marc's local folders** (16 meshed runs, all third-party downloads): 1
strict (`bases-wall-primary`, after S9a), 2 clean with an unadmitted mesh
(two `bases.scad` copies), 4 warned (undefined variables in the OpenForge
`bases-*` files) and 9 quarantined (missing import files or unknown
modules). Only 045, 050 and 053 are clean. Local files are triage material,
not gates.

**Permissively licensed trees** (committable sources; csg lane only;
references rendered only for the S1b list): 124 of the 269 BSD-2, CC0, MIT
and Apache-2.0 files produce a 3D tree without errors or quarantine flags
(MEASURED `perm-dump.json`, `csg-scan2.json`). Cumulative csg-lane coverage,
faceted: S1b 4, S6a 36, S6b 37, S6c 38, S8a 46, S8b 50, S8c 51, S9a 108,
S9b 109, S10 111; intent: S1b 6, S6a 16, S7a 43, S10 46 (MEASURED node
scan, INFERRED sets). This is the largest pool of committable corpus tests
and the source of S1b's named list.

**Transform facts** (MEASURED, `coverage2.json`): 19 of the 46 meshed trees
use only exact signed-permutation matrices (the hard face-count check is
possible only there, and only for axis-aligned or Z-prism faces); 14 (6
strict) contain 6-digit rotations with defects of 5.0e-7 to 1.13e-6; 41 of
the 124 permissive trees do.

**Language lane** (no geometry). 53 of the 60 sampled runs produced an
error-free `.csg` with `--render` (MEASURED). The sample is purposive and
stratified (corpus.md §2.2), so no rate is extrapolated. The upper bound is
the **633 distinct model contents** among the 667 model entries of the
primary corpus (MEASURED `census.json` roles and sha256); the real figure
comes from running S3b and S4 over them.

**Extrapolation to the 806 files** (INFERRED): the census's static
include-closure screen found 102 candidates with today's operations and 133
with faceted ingress (corpus.md §8). It overstates library requirements
(unused helper code counts), so the dynamic tree scans above are the better
guide.


## 11. Risks

| risk | effect | mitigation |
|---|---|---|
| hybrid Boolean under many coplanar and near-coplanar faces | wrong `ok` or refusals dominate the geometry lane; 3 wrong `ok` of corefine alone remain on adversarial input (READ `docs/development record.md`) | manifold3d second oracle on the same leaves, triage class `wonky-wrong:boolean`, minimized fixtures; faceted input keeps corefine exact |
| long chains in F32x2 | never run beyond 6 steps (READ synthesis §4.1) | S1b includes `Mutators-039` (1000 cubes, 2,999 Boolean children); S2 records chain length per case; balanced folding; the 359-step `torus-customizer` chain moves to S12 |
| oracle quirks | snap merges 5e-7 mm gaps, edge-touching unions are non-manifold with exit 0 (MEASURED oracle.md §3.6, §3.2); the float32 fallback moves vertices by up to ½ float32 ulp and exits 0 (MEASURED review r04) | fail-closed statuses including `openscad:float32-fallback`, `inverted`, `exit0-error`; `ambiguous` class; arbiter file |
| wrong reference tree | `.csg`/`.echo` dumped without `--render` describe the preview model (MEASURED: `cable_clip` 8490.97 vs 3433.17 mm³) | `--render` on every such call; `render` and `$preview` in the cache key and `meta.json`; own fixtures r05, r05b (S2) |
| two OpenSCAD dialects | fragment counts and revolve starts differ | dialect in every key; 2022.05 first; master when a nightly is installed |
| language breadth | BOSL2 uses nearly every language feature | the language lane measures coverage before geometry depends on it |
| intent coverage of hull/minkowski | pattern share unknown; 268 hull calls in 61 local files, all third-party downloads (MEASURED corpus.md §3) | faceted hull first (S9a); intent patterns one per run (S9c and later), measured against faceted and OCCT before promising more |
| licences of corpus files | third-party GPL/NC/unlicensed files | tiers, facts-only commits, `inventory.json` per file; acceptance tests on own re-authored equivalents (section 12) |
| GPL derivative work | reproducing OpenSCAD's faceting and slice rules bit for bit while reading `[S]` risks a derivative (review m4); wonky has no licence yet (`package.json:4`) | clean-room split per faceting package (decision D11) |
| scope creep into rendering | preview features, fonts | non-goals of section 2.2 |
| concurrent kernel work | S5, S8a-c and S9a-b touch `kernel/` while r20-gate and fillet work is active; a new Bend module is only usable after it is registered in `loadJsKernel` (READ `src/kernel.mjs:20-54`), a file those workflows edit; the per-call `allowRegularized` option (section 4.6) and a planar-analytic STL path (`src/exporters.mjs`) are also shared-file changes | new Bend modules in new files; host code only under `src/openscad/`, `scripts/openscad/`, `fixtures/openscad/`, `test/openscad-*`; each shared-file change is one small, separately agreed edit (one `loadBend` line per module, one option), sent to the r20-gate and fillet owners before the package starts and applied by whoever holds the file |
| performance of the oracle | CGAL timeouts on large models | fast-csg lane marked `mesh-backend`; optional Manifold nightly |

## 12. Work packages

Revised after the review (M7, M8, m9). Each package is one checkpointed
workflow run with a worklog, a self-contained acceptance test and
`npm test` green, in line with the "small agents" rule (Marc, 2026-09-23).
Sizes: S ≈ a short run, M ≈ one run of moderate scope; there is no L any
more, and a package whose run stalls is split at the named split point.
Order: first real differential tests as early as possible, then the
language lane (large coverage, no kernel work), then kernel ingress by
payoff.

**Acceptance cases must be committable** (review m9). Every gate below
uses own re-authored cases in `fixtures/openscad/cases/` or permissively
licensed files (CC0, BSD-2, MIT, Apache-2.0 with notices). Corpus files
under GPL, LGPL, CC-BY-SA or an unresolved licence (`polyhedron-cube`,
`minkowski3-tests`: GPL-2.0; `knot`, `text_tower`: LGPL-3.0;
`cable_clip`, `rounded_cylinder`, `legends`: GPL-3.0; `CutNut`: CC-BY-SA;
`torus-customizer`: unresolved; MEASURED `inventory.json`) run from
`tmp/openscad/corpus/` as a **report** next to the gate, never as the gate.

**Own fixtures from the review** (own content, `tmp/openscad/review/`, to
be copied into `fixtures/openscad/cases/` by the package named; nothing is
written to `fixtures/` now because other workflows are editing it): r05 and
r05b (`$preview` per export; S1b for the dump side, S2 for the oracle
side), r02/r02b (Nef facet split; S2), r04 (float32 fallback; S2), r03
(non-inscribed revolution; S6b faceted, S7b allowance).

| id | title | depends on | size | first differential value |
|---|---|---|---|---|
| S1a | parser (both dialects, spans), literal evaluator, `.csg` reader, node tree, `--dump-csg` writer, parse report | none | M | parse report over the 806 files; `.csg` round trip on the 56 census render trees |
| S1b | lowering of cube, cylinder, straight extrusion and exact-axis CSG in both modes; CLI; `brep.json` block; minimal `reference.mjs` and `compare.mjs`; ~12 own fixtures | S1a | M | own fixtures + the named permissive csg-lane list (section 0.2 item 6), both modes |
| S2 | oracle harness: cache, statuses, nef3 snapping, second oracle, corpus runner | S1b | M | 60 census cases scored, triage automated |
| S3a | values, operators, formatter, ranges, scopes, `$` stack, functions, closures, comprehensions | S1a | M | language probes for expressions and functions |
| S3b | modules, `children()`, control, `echo`/`assert`, recursion limits, modifiers, diagnostics ledger, strict/compat, `.echo` writer | S3a | M | language lane on files without include/use; the geometry lane opens |
| S4 | files, libraries, builtins, parameters, dialect grammar | S3b | M | language lane on the whole corpus; geometry lane for library files |
| S5 | Bend polyhedral solid constructor | none | M (split point: S5a admission and validation, S5b self-intersection and reorientation) | own polyhedra build and validate |
| S6a | faceted sphere, frustum, apex cone, polyhedron; affine push-down in both modes | S1b, S5 | M | 6 of 21 strict (csg faceted) |
| S6b | faceted `rotate_extrude` | S6a | S | r03 and own revolutions |
| S6c | `linear_extrude` with scale and twist | S6a | M | `linear_extrude.scad` |
| S7a | intent leaves, polygon rule, regularized 6-digit matrices | S6a | M | 7 of 21 strict (csg intent) |
| S7b | OCCT intent oracle: `--dump-tree`, `uv` OCCT script, symmetric-difference allowances | S7a, S2 | M | intent compared at 1e-7 against OCCT |
| S8a | Bend 2D module: even-odd sanitizing, non-zero Booleans | S1b, S5 | M | `Rounding_the_Cube-021` |
| S8b | `offset` with Clipper-compatible joins | S8a | M | `gridfinity-rebuilt-baseplate` |
| S8c | 2D hull and 2D Minkowski | S8a | S | 10 of 21 strict (csg faceted) |
| S9a | exact 3D convex hull in Bend | S6a | M | 14 of 21 strict |
| S9b | faceted Minkowski of convex operands | S9a | S | 15 of 21 strict |
| S9c, S9d, S9e | one intent pattern per run: congruent spheres/circles (rounded polytope), parallel equal-height cylinders, cube ⊕ Z-cylinder (rounded box) | S9a, S7a | S each | one pattern fixture and one near-miss refusal each |
| S10a | `import()` of STL, OFF and 3MF with pinned assets | S4, S5 | M | `CutNut` (report) |
| S10b | `import()` of DXF/SVG and `surface()` | S10a, S8a | M | 18 of 21 strict |
| S11 | viewer, khana hookup, corpus scale-up (ThingiCSG, OpenSCAD test lane) | S2, S6a | M | nightly trend over hundreds of units |
| S12 | Boolean throughput: whole-subtree hybrid jobs | S2 | M | `torus-customizer` (359 chained unions) and other long chains within budget |

S1a and S5 can run in parallel; S3a can start when S1a lands. The
faceting packages S6a-c and S8b follow the clean-room split of decision
D11 if Marc accepts it: a spec run writes the behavioural rules from probes
and prose, the implementation run does not read `[S]` or `[M]`.

### S1a: parser, csg reader, dump

- **Scope.** `src/openscad/lexer.mjs`, `parser.mjs` (full grammar of
  semantics.md §2, both dialects, spans); a literal evaluator for builtin
  instantiations with literal arguments (enough for any `.csg` file);
  `tree.mjs`, `dump-csg.mjs` (OpenSCAD's number formatter, `$preview =
  false` recorded in the dump header); a parse report over the primary
  corpus.
- **Acceptance.** (1) Every `.csg` of the 56 census render trees
  (`tmp/openscad/revise/runs/`) parses and dumps back to an equal tree
  (numbers within one unit of the 6th digit). (2) Report, not gate: the
  parser accepts every primary-corpus file that OpenSCAD parses and rejects
  the ones OpenSCAD rejects with a parser error (4 of the 60 sampled runs,
  corpus.md §4).

### S1b: lowering, compare, fixtures

- **Scope.** Fragment counts for `openscad-2022.05`; lowering of `cube`,
  `cylinder` (faceted r1 = r2 as an n-gon prism through `extrudeInBend`
  with the sketch origin at the leaf centre and `allowRegularized = false`,
  section 4.6; intent through `circularFrustumInBend`, including frusta),
  `linear_extrude` of one `square`/`circle`/`polygon` without 2D CSG,
  `multmatrix` that is an exact signed permutation plus a translation (any
  other matrix refuses by name until S6a),
  `union`/`difference`/`intersection`/`group`/`render`/`color`, balanced
  n-ary folding; named refusals for everything else; `bin/wonky-scad.mjs`
  (`--mode`, `--dialect`, `--compat`, `--dump-csg`, `--format`, `--out`);
  the `openscad` block in `brep.json`; `scripts/openscad/reference.mjs`
  minimal (`--render`, binary STL, `.csg`, `.echo`, `-d`, log status,
  csg-self render) and `compare.mjs` (the section 6.2 faceted checks with
  the face count advisory, and intent allowances; the mesh side measured
  from `brep.json`, section 6.2 export row); about 12 own fixtures (t01,
  t09, t10 of oracle.md §3.1, flush and overlapping box unions, n-gon holes
  with `$fn` 3 to 64, a dense n-gon below the profile tolerance that must
  refuse by name, r05 and r05b for the dump side).
- **Corpus goal: a named csg-lane list** (MEASURED
  `tmp/openscad/revise/s1refs/s1refs.json`; all dumped with `--render`,
  exact-integer or axis matrices only, references clean):

  | file | licence | content | modes |
  |---|---|---|---|
  | OpenSCAD `examples/Old/example003.scad` | CC0-1.0 | 7 leaves, 6 Booleans, 192 triangles | both |
  | BOSL2 tutorial `Shapes3d-001` | BSD-2-Clause | one 100 mm cube (also a strict census reference) | both |
  | BOSL2 tutorial `Shapes3d-029` | BSD-2-Clause | one cylinder, 116 triangles | both |
  | BOSL2 tutorial `Mutators-039` | BSD-2-Clause | 1000 cubes, 2,999 Boolean children, unioned into one 100 mm cube (15 s in CGAL) | both |
  | OpenSCAD `examples/Old/example002.scad` | CC0-1.0 | frusta, 6 leaves | intent (faceted after S6a) |
  | OpenSCAD `examples/Old/example019.scad` | CC0-1.0 | 41 frusta, 40 Booleans | intent (faceted after S6a) |

  Source URLs and sha256 are in `tmp/openscad/revise/perm-dump.json`.
  These files may be committed with their notices (decision D5).
- **Acceptance.** (1) Every fixture passes in both modes or refuses by
  name, against committed references, in `npm test` without OpenSCAD. (2)
  The named list runs through the csg lane against csg-self references in
  its stated modes and is scored, with frontend, kernel and compare times
  recorded separately; `Mutators-039` records its chain length and time.
  (3) `wonky --dump-csg` of r05 and r05b equals OpenSCAD's `--render`
  dump.

### S2: oracle harness

- **Scope.** oracle.md §4-§10 in full: `--render` on every tree export,
  cache key and `out/openscad/cache/`, fail-closed statuses including
  `openscad:float32-fallback`, `inverted` and `exit0-error`, quarantine of
  missing files and unknown modules, nef3 vertex snapping of the binary
  STL, `--summary` facet counts (advisory), per-leaf single-leaf renders
  for triage step 2, `--dump-job` and a manifold3d `uv` script (pin 3.5.3)
  for step 3, `fixtures/openscad/arbiter.json`,
  `scripts/openscad/corpus.mjs` with labels and `compare.mjs`, ingestion of
  `tmp/openscad/corpus-census/inventory.json` as units with licence class,
  the fast-csg fallback lane.
- **Acceptance.** `reference.mjs --check` is byte-stable on the fixtures;
  the nightly run over the 60 census cases reproduces the census statuses,
  plus `openscad:float32-fallback` for run 018; own fixtures r02/r02b
  (facet count advisory), r04 (float32 fallback, widened δ), r05/r05b
  (`--render` consistency across `.csg`, `.echo` and STL) and t08 (edge
  touch, expected refusal) score as expected, and the 5e-7 mm gap as
  `ambiguous`; a mutation self-test (flipped triangle, shifted leaf, wrong
  `$fn` rule, a preview-mode `.csg`) is caught.

### S3a: values, scopes, functions

- **Scope.** semantics.md §3 and §4.1-4.5: values and operators, the
  6-digit formatter, degree trig, ranges, scopes (one binding per scope,
  assignments first), three namespaces, dynamic `$` scope, `$preview =
  false`, functions, closures, defaults in the defining context, list
  comprehensions, builtin functions needed by the probes.
- **Acceptance.** Own re-authored versions of the expression and function
  probes of `tmp/openscad/semantics/tests/` match OpenSCAD's `--render`
  `.echo` exactly (numbers within one unit of the 6th digit).

### S3b: modules, children, control, diagnostics

- **Scope.** semantics.md §4.6-4.9 and §6: modules, `children()`,
  `$children`, control structures, `echo`, `assert`, recursion limits (1e6
  tail steps exactly; a fixed non-tail depth, decision D7), modifiers,
  diagnostics ledger with spans, strict and compat; `.echo` writer.
- **Acceptance.** The remaining semantic probes match OpenSCAD's `--render`
  `.csg` and `.echo`; on corpus files without `include`/`use`,
  `--dump-csg` matches `ref.csg` for at least 90 % of the files whose
  OpenSCAD dump has no error, and every mismatch has a class.

### S4: files, libraries, builtins, parameters

- **Scope.** include/use semantics and search order with provenance and
  declared roots (semantics.md §5), a pinned BOSL2 snapshot root, all builtin
  functions (semantics.md §4.8) including `search`, `lookup`, `str`, `chr`,
  `ord`, `version`, `rands` (mt19937 plus libc++'s distribution; unseeded
  calls labelled non-reproducible, as dotSCAD `packing_circles` shows),
  `-D`, customizer `-p/-P`, the master dialect's grammar additions.
- **Acceptance.** Language lane over all primary files: at least 85 % of
  the files with an error-free `--render` `.csg` match; the 24 BOSL2
  tutorial extracts (BSD-2) match or are classified; the NopSCADlib tests
  are a report.

### S5: Bend polyhedral solid constructor

- **Scope.** A Bend entry that takes points and indexed faces and returns
  an exact planar B-rep: planes fitted in Bend, planarity within a stated
  bound, closedness, vertex links, consistent orientation (a closed, wrongly
  wound shell is reoriented with a named warning, as CGAL does inside CSG,
  semantics.md §7.3), exact self-intersection test (corefine's output gate
  can be reused, READ `docs/hybrid-mesh-bodies.md` §1), budgets, named
  refusals, exactness label. **Non-planar faces** (review m2): a face that
  is not planar within the bound refuses by name ("non-planar polyhedron
  face") unless the caller passes a triangulation; the OpenSCAD lowering
  passes one only where oracle.md §5 names OpenSCAD's rule (hull for a
  convex operand; libtess2 once ported), otherwise the case is
  `semantics:triangulation`. The Onshape body import already builds
  plane/line B-reps from explicit topology (READ `src/analytic.mjs:23-60`)
  and may share its decoding. New Bend file, registered in `loadJsKernel`
  by one coordinated line (section 11).
- **Acceptance.** Own cases: a re-authored cube polyhedron, an own
  generated torus-knot polyhedron of about 2,500 triangles (in place of the
  LGPL `knot.scad`, which stays a report), faceted spheres `$fn` 3 to 128
  with volumes equal to the faceting formula within 1e-12 relative, the
  wrongly wound tetrahedron (reoriented with the named warning; its
  top-level OpenSCAD reference is `inverted`, compared on |V|), the
  self-touching-vertex case (refuses by name), a non-planar face (refuses
  by name); the hybrid's `roundTripInput` returns each body unchanged.
  Report: `polyhedron-cube` (GPL-2.0), `knot` (LGPL-3.0).

### S6a: faceted leaves and affine push-down

- **Scope.** Faceted sphere, frustum, apex cone and polyhedron (points in
  JS, every predicate and solid in Bend, decision D1); `mirror`, `scale`,
  `resize` (bbox decided in Bend) and affine `multmatrix` pushed down to
  leaf points in faceted mode (face order reversed for det < 0; the image
  of a cube or n-gon prism built as a planar oblique prism from the mapped
  profile along the mapped axis with a binary64 Gram-Schmidt frame, or by
  S5), including the 6-digit rotations of the csg lane (section 5); in
  intent mode, push-down to frames and radii with the elliptic refusal.
- **Acceptance.** Per-leaf faceting diff is zero (within δ) against
  single-leaf OpenSCAD renders over a generated grid of at least 100 own
  leaves (primitive × r × `$fn/$fa/$fs`); the committable strict cases in
  reach (`CSG`, CC0; `Transforms-019`, BSD-2) and the permissive rotated
  CC0 examples (`assert.scad`, `example014`, `example024`) pass in faceted
  mode on the csg lane, with times recorded. Report: `polyhedron-cube`,
  `knot`, `torus-customizer`.

### S6b: faceted `rotate_extrude`

- **Scope.** 2022.05 section counts, start on −X for full turns, partial
  angles (semantics.md §7.8).
- **Acceptance.** Own revolution fixtures including r03's torus match
  single-leaf OpenSCAD renders within δ.

### S6c: `linear_extrude` with scale and twist

- **Scope.** Slice counts, outline refinement by longest edge and the
  shorter-diagonal rule (semantics.md §7.7), with the refinement and the
  diagonal decided in Bend (decision D1).
- **Acceptance.** Own twist and scale fixtures (t07 and variants) match
  OpenSCAD within δ; `linear_extrude.scad` (CC0) passes faceted.

### S7a: intent leaves

- **Scope.** Exact sphere and apex cone through `sweepInBend` (admissible
  per `docs/revolve.md`, not yet run for these profiles, semantics.md open
  item), exact `rotate_extrude` with arcs from circles, 2D CSG lifted under
  extrusions to the prism arm, the deliberate-polygon rule of section 3.3,
  6-digit csg-lane rotations regularized with the deviation defect·|x|max
  stated and entered into δ (or refused by name), intent refusals
  (elliptic, twist, taper, offset).
- **Acceptance.** Own intent fixtures agree with closed forms at 1e-7
  relative; sphere and apex-cone STEP exports validate in OCCT; `CSG`,
  `Transforms-019` and `Rounding_the_Cube-021` build in intent mode on the
  csg lane.

### S7b: OCCT intent oracle

- **Scope.** `--dump-tree` (17 significant digits, `--dump-job` format); a
  `uv` OCCT script (cadquery-ocp, as `scripts/corpus/measure.py`) that
  builds the exact CSG from that tree on the geometry lane and from
  `ref.csg` (affine `gp_GTrsf`) on the csg lane (section 6.2); the
  symmetric-difference allowances of oracle.md §6.1 in `compare.mjs`.
- **Acceptance.** Own fixtures and the committable cases of S7a agree with
  OCCT at 1e-7 relative volume and area and 1e-6 mm bbox, on the matching
  lane pairs only; against OpenSCAD they stay within Σ V(A_i Δ A_i′) and ε;
  r03 passes with the symmetric-difference D and is shown to fail with the
  net deficit (a self-test of the allowance).

### S8a: 2D Booleans

- **Scope.** A Bend 2D polygon module: even-odd sanitizing of `polygon()`
  paths, non-zero Booleans with exact intersections, feeding the existing
  prism constructor. The prism arm's region Boolean
  (`kernel/prism-boolean.bend`) is the starting point.
- **Acceptance.** Own 2D CSG fixtures match OpenSCAD within δ;
  `Rounding_the_Cube-021` (BSD-2) passes faceted.

### S8b: offset

- **Scope.** `offset` with Clipper-compatible joins (round, miter, square;
  semantics.md §7.6).
- **Acceptance.** Own offset fixtures match OpenSCAD within δ, including
  the triangle where `offset(r)` differs from `minkowski` with a circle
  (65.293 vs 64.799, MEASURED semantics.md §7.6) and the chamfered default
  corner (volume 142); `gridfinity-rebuilt-baseplate` (MIT) passes faceted.

### S8c: 2D hull and 2D Minkowski

- **Acceptance.** Own 2D hull and Minkowski fixtures match OpenSCAD within
  δ. Report: `cable_clip` (GPL-3.0).

### S9a: 3D convex hull

- **Scope.** An exact 3D convex hull in Bend (robust predicates; the hull
  of the faceted children, as OpenSCAD takes it, semantics.md §7.9).
- **Acceptance.** Own hull fixtures (spheres, cylinders, mixed) match
  OpenSCAD within δ; `hull.scad` (CC0), `gridfinity-spiral-vase` (MIT) and
  OpenForge `bases-wall-primary.scad` (Apache-2.0, a third-party file)
  pass faceted. Report: `rounded_cylinder` (GPL-3.0).

### S9b: faceted Minkowski

- **Scope.** Minkowski of convex operands as the hull of pairwise vertex
  sums; non-convex operands refuse ("convex decomposition").
- **Acceptance.** Own Minkowski fixtures (t05 and variants) match OpenSCAD
  within δ. Report: `minkowski3-tests` (GPL-2.0).

### S9c, S9d, S9e: one intent pattern each

- **Scope.** One pattern of semantics.md §9.4 per run: congruent
  circles/spheres (rounded polytope), parallel equal-height cylinders
  (extruded 2D hull of circles), cube ⊕ Z-cylinder (rounded box); each
  recognized on the pushed-down tree, recorded, and verified against the
  faceted build and OCCT where it has a path. Order by corpus value
  (review m7), measured on the permissive and census trees before each run.
- **Acceptance.** Per pattern, one fixture passes against a closed form or
  OCCT, and one near-miss fixture refuses by name.

### S10a: mesh `import()`

- **Scope.** Asset manifest (path, root, sha256); STL (binary and ASCII),
  OFF and 3MF readers in JS as data parsers, solids built by S5.
- **Acceptance.** Own imported meshes (a committed small STL and OFF)
  pass faceted; missing assets refuse by name and never produce a smaller
  solid (the census found OpenSCAD exporting incomplete STLs in that case,
  MEASURED corpus.md §5). Report: `CutNut` (CC-BY-SA).

### S10b: DXF/SVG `import()` and `surface()`

- **Scope.** DXF/SVG lines and arcs (tessellated in faceted mode, exact in
  intent, Béziers refused in intent); `surface()` from `.dat` and PNG
  (semantics.md §7.10), with the cell centre vertices decided in Bend.
- **Acceptance.** `example007` and `example010` (CC0) pass faceted.

### S11: viewer, khana, corpus scale-up

- **Scope.** `.scad` in `wonky view` with closure watching, the reference
  overlay layer and triage chips (section 8.3), khana sidecar checks on
  `.scad` bodies, ThingiCSG at a pinned commit with a per-file licence table,
  an OpenSCAD test-suite lane with dialect quarantine (577 `.scad` files and
  241 `.csg` goldens at the pinned master commit, READ prior-art.md §2), a
  nightly benchmark label.
- **Acceptance.** A live edit of a `.scad` file in the viewer shows the new
  build and a fresh or stale-marked reference overlay; the nightly run over
  at least 300 units produces a trend report with classes.

### S12: Boolean throughput

- **Scope.** Send a whole subtree as one hybrid job (the job format carries
  a tree already), with per-subtree caching by graph hash. Motivated by
  `torus-customizer`: 359 chained unions of Z-rotated boxes with different
  cap heights, which the prism arm declines (it needs equal caps for a
  union, READ `src/prism-boolean.mjs:29`, decline 10), so today it would be
  an unmeasured 359-step hybrid chain.
- **Acceptance.** `Mutators-039` (committable) and, as a report,
  `torus-customizer` and `cable_clip` finish within the corpus budget with
  results identical to the chained evaluation.


## 13. Decisions for Marc

Each with a recommendation.

- **D1 Bend boundary.** Two variants (section 4.5; semantics.md §9.2 now
  states the same split). (a) JS computes only language-defined facet
  coordinates with OpenSCAD's degree trig and purely combinatorial face
  lists; Bend makes every geometric decision (diagonal choice, outline
  refinement, collinearity, planarity, `resize` bbox, heightmap centre
  vertices) and builds and validates every solid. (b) One Bend constructor
  per primitive from `(r, n)`. Recommended: (a); it keeps predicates in
  Bend and avoids re-deriving degree trig in F32x2.
- **D2 Default modes.** Faceted for corpus tests, intent for modeling.
  Recommended. Note: no original design of yours is in the corpus yet
  (the local `.scad` files are downloads), so the intent default rests on
  your stated wish, not on measured use.
- **D3 Deliberate polygons.** In intent mode, a leaf whose resolved `$fn`
  is ≤ 8 stays a polygon, configurable, recorded per leaf; the rule reads
  only resolved specials, so it behaves the same on the csg and geometry
  lanes. Recommended.
- **D4 Dialect.** Target `openscad-2022.05` (installed) first; add
  `openscad-master` when a nightly is installed side by side. Recommended:
  install a current nightly next to 2022.05 as a second, faster oracle
  (Manifold, exact ASCII STL); keep CGAL 2022.05 pinned as the faceted
  reference.
- **D5 Licences.** Commit only own and permissive files (and CC-BY with
  attribution); GPL, LGPL and CC-BY-SA as facts only; acceptance tests use
  own re-authored cases or permissive files. Recommended.
- **D6 Strictness.** Strict by default; `--compat` for the corpus, with
  degraded labels. Recommended.
- **D7 Recursion.** A fixed non-tail depth of 10,000 frames instead of
  OpenSCAD's stack-dependent limit (9,000 works, 10,000 fails on this Mac,
  MEASURED semantics.md §4.6). Recommended.
- **D8 `text()`.** Refused in v1 (0 uses in your files, 29 public files).
  Recommended; revisit with pinned fonts if you need engraved text.
- **D9 Ambiguous cases.** Reported separately, not in the pass rate, as in
  the bake-off; this includes topology below the widened δ of
  float32-fallback references. Recommended.
- **D10 Order.** S1a, then S1b; S5 in parallel; then S2, S3a, S3b, S4,
  S6a. Recommended.
- **D11 Clean room for the faceting rules** (review m4). Faceted mode must
  reproduce GPL algorithms bit for bit (slice, diagonal, revolution rules).
  Options: (a) clean-room split, where one run writes a behavioural spec
  from probes and prose (it may read `[S]`) and a separate run implements
  it without reading `[S]` or `[M]`; (b) accept the risk and implement
  from reading. wonky has no licence yet (`package.json` is private).
  Recommended: (a) for S6a-c and S8b.
- **D12 Shared-file edits** (review m5, m8, m10). Four small changes
  outside `src/openscad/` are needed: one `loadBend` registration per new
  Bend module in `src/kernel.mjs`, a per-call `allowRegularized` option on
  `extrudeInBend`, and a planar-analytic STL path in `src/exporters.mjs`
  (optional; the harness can triangulate `brep.json` instead).
  Recommended: agree each one with the r20-gate and fillet owners before
  the package that needs it starts.


## 14. Evidence index

| artifact | content |
|---|---|
| `tmp/openscad/architect/csg-scan.mjs`, `csg-scan.json` | first node scan of 46 evaluated trees (preview dumps; superseded by `revise/csg-scan2.json`) |
| `tmp/openscad/architect/coverage.mjs`, `coverage.json` | first coverage per package (superseded by `revise/coverage2.json`) |
| `tmp/openscad/architect/rerender/` | csg-self reference measurement (its 4 trees are unchanged under `--render`) |
| `tmp/openscad/review/` | review probes r01-r05b, rerenders of census trees, probe tooling (review.md §5) |
| `tmp/openscad/revise/csg-render.mjs`, `csg-render.json`, `runs/` | the 60 census trees re-dumped with `--render` (`.csg`, `.echo`) |
| `tmp/openscad/revise/rerender/` | OpenSCAD's render of the render and preview trees of `cable_clip` and `gridfinity-rebuilt-bins` vs the reference STLs |
| `tmp/openscad/revise/perm-dump.mjs`, `perm-dump.json`, `perm/` | `--render` dumps of the 269 permissive-licence inventory files |
| `tmp/openscad/revise/csg-scan2.mjs`, `csg-scan2.json` | revised node scan: matrix classes and defects, library closure, `$preview` in closure, log classes |
| `tmp/openscad/revise/coverage2.mjs`, `coverage2.json` | revised coverage: lanes × modes × buckets over the split packages |
| `tmp/openscad/revise/s1refs/` | references and csg-self renders of the S1b named list |
| `tmp/openscad/corpus-census/` | corpus, oracle runs, licences (corpus.md); `inventory.json` is the per-file URL and licence record |
| `tmp/openscad/oracle/` | precision, replica, allowances, manifold3d probe (oracle.md) |
| `tmp/openscad/semantics/tests/` | ~45 semantic probes (semantics.md) |
| `tmp/openscad/prior-art/` | project and corpus profiles (prior-art.md) |
| local development evidence, `review.md`, `revise.md` | worklogs of design, review and revision |

## 15. Review disposition

Every finding of [review.md](review.md) was fixed in the documents; none
was rejected. "Where" names the changed sections (d = this document, o =
oracle.md, s = semantics.md, g = ../openscad.md).

| id | finding | disposition | where | evidence |
|---|---|---|---|---|
| B1 | `.csg`, `.echo`, `.ast` evaluated with `$preview = true` | **Fixed.** `--render` on every oracle call that writes them; wonky evaluates, dumps and echoes with `$preview = false`; `render` and `$preview` in the cache key and `meta.json`; census trees re-dumped (56/60 identical; `cable_clip`, `gridfinity-rebuilt-bins`, `rod` changed by `$preview`, `packing_circles` by unseeded `rand()`); `csg-scan`, coverage and the rerender study regenerated; r05, r05b assigned as own fixtures (S1b, S2); semantics §4.4 corrected | d §0.1, §0.2, §6.1-6.2, §10, §12; o §1, §3.7, §4.1, §4.3-4.5, §7, §11; s §4.4, §10.1, §10.3 | MEASURED `tmp/openscad/revise/csg-render.json`, `rerender/compare.json` (render tree of `cable_clip` −1.5e-7, of `gridfinity-rebuilt-bins` 1.0e-8 relative; its preview tree 4.75 mm off) |
| M1 | float32 fallback and neighbour-cell merge | **Fixed.** Snap restated as truncation plus neighbour-cell merging; new status `openscad:float32-fallback` with δ = δ_snap + ½·ulp_f32(\|x\|max) and `ambiguous` below it; r04 in the probe set and as an S2 fixture; the revised scan flags census run 018 | d §6.1-6.3, §11; o §1, §3.3, §3.7, §4.4, §5, §7 | READ `[S] cgalutils.cc:33-103`, `PolySetUtils.cc:76`, `Grid.h:104-140`; MEASURED review r04, `revise/csg-scan2.json` |
| M2 | Nef facet count fails correct results | **Fixed.** Face count advisory like V and E; hard only when every leaf matrix is an exact signed permutation and every leaf face is axis-aligned or a Z-prism wall (19 of 46 trees qualify on the matrix side); shells and genus stay hard | d §6.2; o §1, §5 | MEASURED review r02/r02b (18 vs 12 facets), `revise/coverage2.json` |
| M3 | Σ D_i not sound for non-inscribed leaves | **Fixed.** D_i := V(A_i Δ A_i′) or a sound bound (ε-tube, Weyl's formula plus an edge term); the net deficit only for provably inscribed leaves; `rotate_extrude`, `offset(r < 0)` and the offset idiom marked not inscribed; one-sided form restricted; r03 as S6b/S7b fixture and allowance self-test | d §6.2, S7b; o §1, §6.1, §6.2; s §10.2 | MEASURED review r03 (\|ΔV\| 75.77 vs 35.67); tube bound 646 ≥ 75.77 (computed in o §6.1) |
| M4 | OCCT on 6-digit `ref.csg` vs binary64 wonky | **Fixed.** Geometry lane: OCCT reads wonky's `--dump-tree` (17 digits) and the language lane proves it equals `ref.csg` at 6 digits; csg lane: OCCT and wonky both on `ref.csg` (affine `gp_GTrsf`); the mixed pairing is forbidden | d §3.1, §4.1, §6.2, S7b; o §1, §6.4, §8, §11 | MEASURED architect `rerender/compare.json` (2.9e-7, 7.9e-5 mm), review `rerender/` (Transforms-019 2.86e-7) |
| M5 | 6-digit matrices are not rigid on the csg lane | **Fixed.** Every csg-lane `multmatrix` is affine: exact signed permutations work now; others are pushed down to leaf points in faceted mode (S6a: oblique prisms with a binary64 Gram-Schmidt frame, or S5) and regularized with a stated deviation or refused in intent mode (S7a); rigid lowering only on the geometry lane; S1b accepts only exact-permutation matrices | d §5, §12 S1b, S6a, S7a | READ `kernel/polygon-prism.bend:92-93`, `:142-148`, `:352-366`, `kernel/analytic.bend:102`; MEASURED 14/46 trees, defects 5.0e-7 to 1.13e-6 (`revise/coverage2.json`) |
| M6 | coverage optimistic and mislabelled | **Fixed.** Recomputed on `--render` trees with separate csg and geometry lanes (the geometry lane gated on S3b and, for the 11 library-using strict files, S4); headline on the 21 strict references only; clean-unadmitted (8), warned (7) and quarantined (10) reported separately; local files listed as 1 strict, 2 clean, 4 warned, 9 quarantined; the language-lane figure replaced by the upper bound of 633 distinct model contents, no extrapolation | d §1, §10; g §1, §5 | MEASURED `revise/coverage2.json`, `census.json` |
| M7 | S1 yields almost no corpus test | **Fixed.** S1's corpus goal is a named list of permissive csg-lane files with clean references: `example003`, `Shapes3d-001`, `Shapes3d-029`, `Mutators-039` in both modes, `example002`, `example019` in intent; the affine push-down stays in S6a; `torus-customizer` moved to S12 as a report; the summary reworded | d §0.2 item 6, §1, §12 S1b, S12; g §1 | MEASURED `revise/perm-dump.json`, `revise/s1refs/s1refs.json` |
| M8 | packages too large | **Fixed.** Split into S1a/S1b, S3a/S3b, S6a/S6b/S6c, S7a/S7b, S8a/S8b/S8c, S9a/S9b/S9c-e, S10a/S10b; no L sizes; S5 has a named split point | d §12; g §6 | Marc's "small agents" rule (memory `workflow-checkpointing`) |
| m1 | negative volume and exit-0 errors have no status | **Fixed.** Statuses `inverted` (compare \|V\|, expect the named reorientation warning) and `exit0-error` | d §6.1-6.2, S5; o §4.4 | MEASURED semantics.md §7.3 (−166.67); READ `[S] cgalutils.cc:69` |
| m2 | no triangulation rule for non-planar polyhedron faces | **Fixed.** Rule per path: hull of snapped points on the convex path, libtess2 on the float32 fallback (SGI-B, portable); S5 refuses non-planar faces unless a named rule supplies a triangulation; otherwise `semantics:triangulation` unless planar within δ | d §6.2, S5; o §5 | READ `[S] cgalutils.cc:46-60`, `PolySetUtils.cc:103-110` |
| m3 | D1 contradicts semantics §9.2; geometric decisions in JS | **Fixed.** Both docs state one split: JS computes language-defined coordinates and combinatorial face lists only; every predicate (diagonal, refinement, collinearity, planarity, bbox, heightmap centres) in Bend; the choice is D1 | d §4.5, §5, §13; s §9.2, §11 | READ `src/library.mjs:280-290` |
| m4 | GPL derivative risk | **Fixed** as a decision: clean-room split proposed (D11), risk row added | d §2.2, §11, §12, §13 | READ `package.json:4` (private, no LICENSE) |
| m5 | `extrudeInBend` merges dense n-gon vertices | **Fixed.** Faceted lowering centres the sketch origin and calls with `allowRegularized = false`, so Bend refuses; named refusal; S1b fixture; the per-call option is a coordinated shared-file change (D12) | d §4.6, §5, §11, S1b, §13 | READ `src/kernel.mjs:80-84`, `:171`, `kernel/profile-ring.bend:83-84`, `:95` |
| m6 | deliberate-polygon rule differs between lanes | **Fixed** by definition: D3 reads only resolved per-leaf specials, which `.csg` carries, so both lanes classify identically; only the provenance record differs; a kept-set difference is a language-lane diff | d §3.3, §13 | READ prior-art.md §1 item 2 |
| m7 | Marc's files are third-party downloads | **Fixed.** Wording corrected (`bases-wall-primary` is an OpenForge Apache-2.0 download, OpenLOCK pins are the downloaded `lock_openlock.scad`); G2 and D2 state that no original Marc design is in the corpus; intent patterns ordered by corpus value | d §1, §2.1, §3.3, §7, §10, §12, §13; g §2, §5, §8 | MEASURED `inventory.json`, corpus.md §2.1 |
| m8 | new Bend modules must be registered in `src/kernel.mjs` | **Fixed.** One coordinated `loadBend` line per module, agreed with the r20-gate and fillet owners (D12, risk row) | d §11, S5, §13 | READ `src/kernel.mjs:20-54` |
| m9 | acceptance depends on non-committable files | **Fixed.** Every gate uses own re-authored or permissive cases; GPL, LGPL, CC-BY-SA and unresolved files are reports | d §12 | MEASURED `inventory.json` licences of the 21 strict references |
| m10 | analytic-labelled planar results cannot be exported as STL | **Fixed.** The harness measures the mesh side from `brep.json` with a planar triangulation, or from `--format print`; a planar-analytic STL path is an optional coordinated change (D12) | d §6.2, S1b, §13; o §7 step 4 | READ `src/exporters.mjs:191`, `src/analytic.mjs:120`, `src/hybrid.mjs:420` |
| m11 | 6-digit string comparison flips | **Fixed.** Numbers parsed and compared within one unit of the 6th significant digit | d §6.2; o §7; s §10.1 | INFERRED (rounding-boundary argument) |
| m12 | wrong manifest path | **Fixed.** `tmp/openscad/corpus-census/inventory.json` (2,550 entries; all 2,155 non-local entries have `sourceUrl` and `license`) | o §1, §9, §10; d §7 | MEASURED here |

Not done, by rule: nothing was written to `fixtures/`, `src/` or `kernel/`
(other workflows are editing them), so the review's own fixtures are
assigned to packages instead of committed now.
