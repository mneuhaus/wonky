# Adversarial review of the OpenSCAD frontend design

Status: review, 24 September 2026. Reviewed: [../openscad.md](../openscad.md),
[design.md](design.md), [semantics.md](semantics.md), [oracle.md](oracle.md),
[corpus.md](corpus.md) and [prior-art.md](prior-art.md). Nothing in `src/`,
`kernel/` or `fixtures/` was changed, nothing was committed, nothing was
installed. The probes are in `tmp/openscad/review/`. They were run with the
installed OpenSCAD 2022.05.16 CLI, on copies only, with `timeout`. The
worklog is local development evidence.

Labels: **MEASURED** means run here, with the artifact named. **READ** means
read in code or in a doc, with `file:line`. `[S]` is the OpenSCAD snapshot
tree `tmp/openscad/semantics/snap/src` (git 6aae79634, the installed
binary). **INFERRED** means a conclusion that nothing above proves.

## 0. Verdict

**Fixable.** The architecture holds up. That covers the node tree as the
pivot, the faceted/intent split, OpenSCAD as an oracle only, strict and
compat evaluation, refusal by name and the fail-closed statuses.

What does not hold up is several load-bearing claims about the oracle:

- One export setting produces the wrong evaluated tree for any model that
  reads `$preview` (B1).
- The faceted tolerance model misses a float32 path inside CGAL (M1).
- One "exact" topology check fails correct results (M2).
- The intent volume bound is not sound (M3).
- The intent OCCT comparison mixes 6-digit and binary64 inputs (M4).
- The "rigid transforms work now" assumption fails on the `.csg` lane's own
  matrices (M5).

The coverage numbers and the promised early value of S1 are too optimistic
(M6, M7). Several packages are too large for one checkpointed run (M8). Each
finding below has a fix. None requires a new architecture.

## 1. Blocker

### B1. `.csg` and `.echo` references are evaluated with `$preview = true`

**Where.** oracle.md §4.1 (lines 320-326, the reference command) and §4.3.
design.md §0.2 item 1, §4.2, §6.1 (csg-self reference), §6.2 (language
lane), §10 (coverage from the census `.csg`). semantics.md §4.4
(lines 296-302).

**Problem.** In 2022.05, `$preview` is true for every "previewable" export
format unless the renderer is set. That includes `.csg`, `.echo` and `.ast`
(READ `[S] openscad.cc:422`, `:468`). STL, OFF and nef3 always get false.
semantics.md noticed this for `.echo` and PNG but not for `.csg`.

MEASURED:

- `tmp/openscad/review/r05_preview.scad` uses `$fn = $preview ? 8 : 64`. Its
  `.csg` contains `cylinder($fn = 8, ...)`, its `.echo` says
  `preview = true`, and its binary STL has 66 facets (`$fn = 64`).
- The same happens with several `-o` in one invocation (`r05_multi.*`), so
  the oracle.md §4.1 command is affected too.
- `-D '$preview=false'` does **not** fix it. The CLI appends `-D` lines at
  the end of the main file (semantics.md §1). File-scope assignments before
  that line still see `true`: `r05b_preview_early.scad` dumps
  `cube([1, 1, 1])` while its echo says `preview = false`.
- `--render` fixes it (READ `[S] openscad.cc:952`, `:1038-1040`). With
  `--render`, `r05_render.csg` has `$fn = 64`, `r05b_render.csg` has width
  2, and `r05_multi3.*` is consistent over nef3, `.csg` and `.echo`.

**Impact (MEASURED on the census).** `$preview` occurs in the dependency
closure of 14 of the 60 oracle runs and of 7 of the 21 strict references
(019, 020, 021, 023, 024, 030, 032).

For the strict reference `cable_clip` (024), `$preview` is read in
NopSCADlib's `tests/cable_clip.scad:46` (`if($preview)`), `bom.scad:49` and
`global_defs.scad:47`.

- The census `expanded.csg` renders to V = 8490.97 mm³, with 47 volumes, a
  non-manifold warning and 50 s of CGAL time.
- The reference STL is V = 3433.17 mm³.
- A `.csg` dumped with `--render` renders to 3433.1675 (relative −1.5e-7,
  6-digit rounding).

Evidence: `tmp/openscad/review/rerender/`.

This single setting breaks four things for every `$preview`-dependent file:

- **csg lane.** It tests the preview model. The csg-self reference is then
  not the model the `.scad` exports.
- **Language lane.** It must reproduce a preview-mode tree while geometry
  runs in render mode.
- **Allowances.** The per-leaf allowances "read from the reference's own
  `.csg`" (oracle.md §6.1) use the wrong `$fn`.
- **OCCT intent oracle.** Built from `ref.csg`, it builds a different model.

The census `.csg` files feed `csg-scan.json` and `coverage.json`. So the
tiers and the G3 figure "445 Boolean children in cable_clip"
(design.md:108) come from preview trees. The render tree of cable_clip has
no `rotate_extrude` and no top-level cylinders at all.

**Fix.**

- Add `--render` to every oracle invocation that writes `.csg`, `.echo` or
  `.ast`.
- Have wonky's `--dump-csg` and `.echo` evaluate with `$preview = false`.
- Record the `$preview` value in `meta.json`.
- Regenerate the census `expanded.csg`, `csg-scan.json`, `coverage.json` and
  the architect's rerender study.
- Add `r05_preview.scad` and `r05b_preview_early.scad` as own fixtures.
- Correct semantics.md §4.4.

## 2. Major findings

### M1. The faceted tolerance misses CGAL's float32 fallback and its neighbour-cell merge

**Where.** oracle.md §1 item 4 (line 60), §3.3 (lines 218-225), §4.4 status
table, §5 (line 423).

**Problem (READ).** The claim is that "δ_snap = √3·2^-20, snap by
truncation". That holds only on the main path.

`createNefPolyhedronFromPolySet` (`[S] geometry/cgal/cgalutils.cc:33-103`)
works as follows:

- It quantizes the operand.
- It triangulates it with `PolySetUtils::tessellate_faces`, which casts
  every vertex to float (`[S] geometry/PolySetUtils.cc:76`,
  `v.cast<float>()`).
- For a non-convex operand whose faces are not planar (after snapping), the
  Nef constructor throws.
- The "alternate construction" then uses those **float32** vertices.

Separately, `Grid3d::align` (`[S] geometry/Grid.h:104-140`) snaps a vertex
into an occupied neighbour cell (±1 per axis) when its own cell is empty.
Inside one operand a vertex can therefore move by up to two cells.

MEASURED with `tmp/openscad/review/r04_nonplanar_poly.scad` (a non-convex
L-prism with one raised vertex, at 50-230 mm):

- The log prints `CGAL error: assertion violation! ... PolySet has nonplanar
  faces. Attempting alternate construction`, and the exit code is 0.
- All 12 polyhedron vertices in the nef3 are float32 values:
  100.123456789 → 100.123458862 (+2.07e-6 mm, more than δ_snap = 1.65e-6).
  This is round to nearest, not truncation.
- At 128-256 mm, half a float32 ulp is 7.6e-6 mm.

The census hit this path once, in BOSL2 `spring_handle.scad` (run 018). It
was classified `success` with `warningCount 0`, because the status rule only
looks for `ERROR:` and `WARNING:` prefixes (oracle.md §4.4). BOSL2 and
dotSCAD sweeps produce non-planar quads routinely (INFERRED).

**Impact.** Correct wonky results fail the Hausdorff and bbox checks at
δ. Coordinates that coincide in float32 are merged in that path
(`Reindexer<Vector3f>`), which can change topology at scales far above
2·δ_snap. The `ambiguous` rule does not cover that.

**Fix.**

- Classify the log lines `CGAL error` and `PolySet has nonplanar faces` as
  `openscad:float32-fallback`.
- For such cases set δ = δ_snap + ½·ulp_f32(|x|max), and score topology
  below that as `ambiguous`.
- Restate the snap as "truncation, plus merging into occupied neighbour
  cells within one operand".
- Add `r04_nonplanar_poly.scad` to the probe set.

### M2. "planar face count = Nef facets" fails correct results

**Where.** oracle.md §5 table (line 436); design.md §6.2 (the csg and
geometry faceted rows).

**Problem (MEASURED).**

- `r02_rotated_cubes.scad` (a rotated `cube(10)` united with a small
  cube): Nef facets = 18.
- `r02b_axis_cubes.scad` (the same without rotation): 12.

Snapping each vertex separately makes the rotated faces non-planar. The
convex path then builds each operand as a hull of the snapped points (READ
`[S] cgalutils.cc:46-60`), which splits every face into triangles. An exact
planar B-rep of the rotated cube has 6 faces, not 12.

`r01_nonconvex_rotated.scad` shows the same effect: 21 facets. Rotations
are everywhere in the corpus. 12 of the 46 meshed trees carry general
rotation matrices (M5). The face count check is a hard check in oracle.md
§5, so it would FAIL correct results widely.

**Fix.** Make the face count advisory, like V and E. Alternatively, compare
it only when every leaf matrix is an exact signed permutation plus a
translation. Keep shells and genus as the hard topology checks.

### M3. The intent volume bound Σ D_i is not sound

**Where.** oracle.md §1 item 5 (line 71), §6.1 (line 459, "D ≥ 0; the
faceted leaf is inscribed"; the rotate_extrude row), §6.2 (line 478, "holds
for every CSG tree"; line 483, the one-sided form); design.md §6.2 ("sound
for any ∪ ∩ − tree"); S7 acceptance.

**Problem.** The symmetric-difference lemma gives
`|ΔV| ≤ Σ V(A_i Δ A_i′)`. That equals Σ D_i only when each faceted leaf is
**inside** its exact leaf.

A faceted `rotate_extrude` is not inscribed. Between two rings the section
is the profile scaled radially by cos(π/n) **toward the axis**, so an
off-axis profile bulges into the hole.

MEASURED with `tmp/openscad/review/r03_*`:

- torus R = 10, r = 2, revolution `$fn = 12`, tube `$fn = 256`:
  - faceted V = 753.907;
  - exact V = 789.568;
  - D_torus = 35.66.
- `difference()` with `cylinder(r = 10, h = 6, $fn = 1024)` (D = 0.012):
  - OpenSCAD 352.525;
  - exact outer half 4π(10π + 8/3) = 428.297;
  - |ΔV| = 75.77, which is **2.1 × Σ D_i = 35.67**. The inner half gains
    +40.1 mm³.
- The bbox-clipped variant gives no relief: the bbox contains the whole
  torus.

A correct intent result would FAIL.

The same applies, INFERRED from the geometry:

- `offset(r < 0)` arcs (concave, circumscribed);
- the common `offset(-r) offset(+r)` rounding idiom (neither inscribed nor
  circumscribed);
- the one-sided form's proof, which uses the same inscribed assumption.

**Fix.**

- Define D_i := V(A_i Δ A_i′), or a sound upper bound such as the volume
  of the ε_i tube around ∂A_i (about 2·ε_i·area(∂A_i) plus a curvature
  term).
- Keep 1 − sin x/x only for leaves that are provably inscribed (circle,
  cylinder, cone, sphere, straight or uniformly scaled extrusions of those).
- Add r03 as a fixture.

### M4. The intent geometry lane compares binary64 wonky with a 6-digit OCCT tree at 1e-7

**Where.** design.md §6.2 (the row "geometry intent: wonky intent vs OCCT
exact CSG of `ref.csg` | 1e-7 relative, bbox 1e-6 mm"); oracle.md §1 item 5
(line 81), §6.4 (line 520), §8; S7 acceptance.

**Problem.** `ref.csg` prints 6 significant digits (oracle.md §4.3). wonky
on the `.scad` computes in binary64. The architect's own measurement is
already over the tolerance:

- torus-customizer, `.scad` vs `.csg` render: relative volume 2.9e-7,
  Hausdorff 7.9e-5 mm (`tmp/openscad/architect/rerender/compare.json`);
- Transforms-019: relative volume 2.86e-7, and the bbox differs
  (`tmp/openscad/review/rerender/`).

Translations such as −29.5125 carry up to 5e-5 mm of rounding, against a
bbox tolerance of 1e-6 mm.

**Fix.** Give OCCT a full-precision tree dumped by wonky (17 significant
digits, in the `--dump-job` format). The language lane separately proves
that wonky's tree equals `ref.csg` at 6 digits. Otherwise, compare OCCT on
`ref.csg` only with wonky on `ref.csg` (the csg lane).

### M5. On the csg lane, "rigid `multmatrix`: now" is false

**Where.** design.md §5 (line 366), §12 S1 scope ("rigid `multmatrix`") and
acceptance (2); coverage.mjs, where S1 assumes rigid transforms.

**Problem.** `.csg` matrices have 6 digits. MEASURED over the census trees:

- 12 of 46 meshed `.csg` (7 of 21 strict: 007, 020, 024, 029, 032, 036,
  040) contain rotation matrices with an orthonormality defect of 5e-7 to
  1.1e-6.
- torus-customizer: 1082 matrices, worst defect 1.13e-6.

`transformInBend` hands the rows to `polygonPrism.transform`
(`src/kernel.mjs:218-245`). That refuses any rotation that is not
orthonormal to `frame_budget = 10 · angular_guard = 1e-11` (READ
`kernel/polygon-prism.bend:92-93`, `:142-148`, `:352-366`;
`kernel/intersections.bend:51-52`). The result is `NonRigidRotation`.

`transformAnalytic` applies the matrix unchecked
(`kernel/analytic.bend:102-104`), which leaves carriers inconsistent with
their vertices at about 1e-6·r (INFERRED).

Orthonormalizing does not help either: it moves points by about 1e-6·|x|
(3e-5 mm at 30 mm), which is above δ against the csg-self reference.

**Fix.**

- On the csg lane, treat every `multmatrix` as affine.
- In faceted mode, push it down to the leaf points: an affine image of a
  cube or n-gon prism is a planar oblique prism. It can be built as a prism
  of the mapped profile along the mapped axis, with an orthonormal frame
  from Gram-Schmidt in binary64, or with the S5 constructor.
- In intent mode, refuse it, or regularize it with a stated deviation that
  enters δ.
- Rigid-only lowering is fine on the geometry lane, where degree trig gives
  matrices that are orthonormal to about 1e-16.

### M6. The coverage numbers are optimistic and partly mislabelled

**Where.** design.md §10 (line 573 onward) and §12 "first differential
value"; openscad.md §1 item 4 (line 46, "42 von 46") and §5 (line 130, "S10:
16 von 16", "550 bis 600").

**Problems (MEASURED from `tmp/openscad/corpus-census/oracle-results.json`,
`tmp/openscad/architect/coverage.json` and the run `dependencies.d`):**

1. **Wrong lane.** The table is headed "Geometry lane", but `coverage.mjs`
   classifies OpenSCAD's own `.csg`, which is the csg lane. The geometry
   lane also needs S3 (evaluator), and for 11 of the 21 strict references
   S4 (BOSL2, NopSCADlib, dotSCAD, gridfinity and OpenForge libraries).
   Neither appears in the S6 to S10 dependencies. On the geometry lane,
   "after S6: 12 of 46 / 7 of 21" is 0 until S3 lands.
2. **Warned references counted.** "42 of 46" is 26 `success` plus 16
   `geometry-with-warnings`. A `warned` reference is never a PASS gate
   (oracle.md §4.4). 9 of the 16 have missing assets or unknown modules,
   which corpus.md §5 says to quarantine. The honest ceiling is 26 (or 18
   strict).
3. **Local files.** "16 von 16" includes:
   - 049, 051 and 056 (`Can't open import file`);
   - 052 (missing surface file);
   - 047 (missing include, unknown module);
   - 054, 057, 058 and 059 (undefined variables).

   Only 045, 050 and 053 are clean; only 045 is strict.
4. **Preview trees.** The `$preview` cases were scanned in their preview
   trees (B1).
5. **The language-lane estimate** `667 × 53/60 ≈ 590` scales a purposive,
   stratified sample (corpus.md §2.2 disclaims random coverage) to all
   model files. It includes 13 runs with warnings, and it counts duplicate
   local paths (395 paths, 314 distinct contents).

**Fix.**

- Relabel the columns "csg lane".
- Add a geometry-lane column gated on S3 and S4.
- Headline only `ok`/strict references; list `warned` and quarantined cases
  separately.
- State the language-lane figure as an upper bound over distinct contents,
  or drop it.
- Regenerate everything after B1.

### M7. S1 yields almost no corpus differential test

**Where.** design.md §1 item 3, §12 S1 acceptance (2); openscad.md §1
item 3 (line 40).

**Problem.** The "2 of 21 strict references" of S1 are:

- `Shapes3d-001`: a single 100 mm cube, 12 triangles, need-set empty
  (MEASURED `csg-scan.json`, `rerender/compare.json` V = 1e6);
- `torus-customizer`: licence unresolved, so tmp only.

torus-customizer is blocked by M5 (6-digit rotations, refused). Past that,
it is 359 chained unions of Z-rotated boxes with different cap heights
(`expanded.csg`). That is outside the prism arm, which needs equal caps for
a union (READ `src/prism-boolean.mjs:29`, decline 10). So it runs as a
359-step hybrid chain whose cost is unmeasured.

In practice the early value of S1 is its own ~12 fixtures. They are
valuable, but they are not the corpus result the summary promises.

**Fix.**

- Rescope S1's corpus goal to a named list of CC0/BSD/MIT csg-lane files
  (dumped with `--render`) that have exact-integer or axis matrices.
- Alternatively, move the affine prism push-down of M5 into S1.
- Move torus-customizer to S12.
- Reword openscad.md §1 item 3.

### M8. Several packages are too large for one checkpointed run

**Where.** design.md §12.

The sizes conflict with the recorded working rule "small agents" (Marc,
2026-09-23; workflow checkpointing):

| package | why it is too large |
|---|---|
| S1 | full grammar in both dialects, csg reader, dump writer, fragment rules, lowering in two modes, CLI, `brep.json` block, `reference.mjs`, `compare.mjs`, 12 fixtures, and an 806-file parser report |
| S3 | the entire language: values, scopes, `$` stack, closures, modules, `children`, comprehensions, recursion limits, diagnostics, strict/compat, `.csg`/`.echo` writers |
| S6 | labelled M, but it holds seven faceting algorithms, some with intricate tie rules (`splitOutlineByFs`/`splitOutlineByFn`, reproduced bit for bit, READ `[S] geometry/GeometryEvaluator.cc:840-1060`), push-down in both modes, and a 300-leaf grid |
| S8 | a Bend 2D Boolean, Clipper-compatible offsets with three join types, 2D hull and 2D Minkowski |
| S9 | an exact 3D hull in Bend, Minkowski, and three intent patterns that each need new rounded-polytope B-reps |

**Fix.** Split them:

- S1a: parser, csg reader, dump, parse report. S1b: lowering, compare,
  fixtures.
- S3a: values, scopes, functions. S3b: modules, `children`, control,
  diagnostics.
- S6a: sphere, cone, polyhedron and push-down. S6b: `rotate_extrude`.
  S6c: `linear_extrude` scale and twist.
- S8a: Booleans and even-odd. S8b: offset. S8c: 2D hull and Minkowski.
- S9a: 3D hull. S9b: faceted Minkowski. S9c and after: one intent pattern
  per run.

## 3. Minor findings

| id | where | problem | fix |
|---|---|---|---|
| m1 | oracle.md §4.4, design.md S5 | A wrongly wound polyhedron at top level exports with **negative** volume (MEASURED semantics.md:544). The census mesh admission has no sign check (`mesh-check.mjs`), and there is no status for it, so S5's reorientation would "fail". Exit-0 runs with `ERROR:` lines (e.g. `The given mesh is not closed!`, `[S] cgalutils.cc:69`) also match no status row. | Add statuses `inverted` (signed volume < 0) and `exit0-error`; compare \|V\| with an expected warning. |
| m2 | oracle.md §5, design.md S5 | Non-planar polyhedron faces: OpenSCAD triangulates with libtess2 on the float32 fallback path (`[S] PolySetUtils.cc:103-110`) and by `convex_hull_3` on the convex path (`[S] cgalutils.cc:46-60`). oracle.md points to `primitives.cc`/linear_extrude instead. The S5 "caller-given triangulation" has no specified rule. | Specify the rule per path, or class such faces `semantics:triangulation` unless they are planar within δ. libtess2 is SGI-B licensed, so it may be ported. |
| m3 | design.md §4.5 / D1 vs semantics.md §9.2, §11 Q1 | The two docs disagree: semantics "assumes Bend", design recommends JS. S6 then puts geometric *decisions* in JS: the shorter-diagonal choice, outline refinement by longest edge, the resize bbox, heightmap centre vertices. The FS precedent (design.md:278) is user-computed points, not builtin tessellation (READ `src/library.mjs:280-290` computes transforms, not solids). | Limit JS to language-defined coordinates plus explicit face lists. Every predicate (diagonal choice, collinearity, planarity, bbox) goes to Bend. Reconcile both docs, and put the choice to Marc as D1. |
| m4 | design.md §2.2, S6 | Faceted mode must reproduce GPL algorithms bit for bit (`[S] GeometryEvaluator.cc:840-1060`, the rotate_extrude rules). Translating them risks a derivative work. wonky is `"private": true` with no LICENSE (`package.json:4`), and "ships no GPL code" is a stated goal. | Clean-room split: one agent writes a behavioural spec from probes and prose, another implements without reading `[S]`/`[M]`. Or make it an explicit decision for Marc. |
| m5 | design.md S1, §4.3 | `extrudeInBend` merges near-collinear vertices (`PROFILE_MERGE.allowRegularized = true`, `src/kernel.mjs:84`; tol = max(1e-5 mm, 2^-20·\|x\|max), `kernel/profile-ring.bend:17-27`, `:95`). Dense n-gons therefore lose vertices when r·(1 − cos 2π/n) ≤ tol: `$fn = 360` for r ≤ 0.066 mm, `$fn = 1000` for r ≤ 0.5 mm, `$fn = 200` for r ≤ 0.97 mm when the profile sits 500 mm from its origin. | Faceted lowering puts the sketch origin at the leaf centre and uses `allowRegularized = false`, with a named refusal below the limit. Add a fixture. |
| m6 | design.md §3.3 / D3 | A `.csg` file cannot tell a global `$fn` from a call-site one (prior-art.md §1 item 2), so the deliberate-polygon rule behaves differently on the csg lane and the geometry lane. | Define the csg-lane behaviour and report differences between the lanes. |
| m7 | design.md §10, S9; openscad.md §5, §8 item 3 | "Marc's `bases-wall-primary.scad`", "deine OpenLOCK-Stifte" and "Deine lokalen Dateien": the census found these are third-party downloads (corpus.md §2.1). The 3 `cad-project-039` files are copies of `lock_openlock.scad` (`inventory.json`). So the case for intent mode in Marc's own modeling (G2, D2) rests on zero original files. | Fix the wording. Prioritise S7 by corpus value. |
| m8 | design.md §11 (line 620) | "New Bend modules in new files" is not enough: each module must be registered in `src/kernel.mjs:20-54`, a file the other workflows are editing. | Plan a coordinated one-line registration per module. |
| m9 | design.md S5, S8, S9, S10 acceptance | Acceptance depends on files that cannot be committed: polyhedron-cube (GPL-2.0), knot (LGPL-3.0), cable_clip and rounded_cylinder (GPL-3.0), minkowski3-tests (GPL-2.0), CutNut (CC-BY-SA). They live only in `tmp/`, so the acceptance is not reproducible later. | Write committed equivalents; keep the tmp cases as a report. |
| m10 | design.md §6.2 and oracle.md §4.1 export row; S1 compare | The prism-arm and hybrid results are `geometry: 'analytic'` even when every face is planar (`src/analytic.mjs:120`, `src/hybrid.mjs:420`). `toStl` refuses every analytic body (`src/exporters.mjs:191`). So "wonky's STL via `mesh.mjs`" fails for most faceted Boolean results. | Compare from `brep.json` (planar triangulation in the harness) or `--format print`; coordinate an exporter change with the owners of `src/`. |
| m11 | design.md §6.2 (language row) | "Exact after normalization, numbers at 6 significant digits": a string comparison flips at rounding boundaries when wonky's binary64 differs from OpenSCAD's in the last ulp. | Compare parsed numbers within one unit of the 6th digit. |
| m12 | oracle.md §9 (line 645) | The manifest is placed at `tmp/openscad/corpus/manifest.json`. The actual per-file URL and licence record is `tmp/openscad/corpus-census/inventory.json`: 2,550 entries, every non-local one with `sourceUrl` and `license` (MEASURED). | Correct the path. |

## 4. Checked and not refuted

- **Fragment rules, circle and sphere phases, the 2022.05 `trunc($fn)`, and
  the rotate_extrude start at −X.** Consistent between semantics.md and the
  oracle replica, which matches OpenSCAD to within the snap (oracle.md
  §3.4). Not re-derived here.
- **2D precision.** Clipper's grid is 2^-(60−exp), about 2^-53 mm at
  100 mm (semantics.md §7.6). It is far below every tolerance. Only the
  scanner treats a 3D rotation about X on 2D input as rigid (`csg-scan.mjs`
  `classifyMatrix`); OpenSCAD drops z and squashes the shape (semantics.md
  §7.4). That case is rare.
- **The csg-self reference** removes the 6-digit issue *within* the csg lane
  (design.md §0.2), once B1 is fixed.
- **OpenSCAD as an oracle only.** No production path shells out to
  OpenSCAD. The viewer overlay (S11) must only read the cache that
  `reference.mjs` fills and must never export it (INFERRED guard).
- **Licence policy** (oracle.md §9). The permissive/copyleft/NC split is
  sound. `tmp/` is gitignored (`.gitignore:8`), so the GPL snapshot and the
  third-party corpus cannot be committed by accident. Reading GPL source to
  restate facts is not copying (see m4 for porting).
- **The synthesis claim** "never more than 6 Boolean steps"
  (`docs/research/synthesis.md:748`) and **the planar arrangement limits**
  (`docs/planar-boolean.md:36-38`) are quoted correctly.

## 5. Evidence (all under `tmp/openscad/review/`)

| file | shows |
|---|---|
| `r01_nonconvex_rotated.*` | a rotated non-convex operand: Nef facets 21; snapped vertices |
| `r02_rotated_cubes.*`, `r02b_axis_cubes.*` | Nef facets 18 vs 12 (M2) |
| `r03_torus*.stl`, `r03_cyl.stl` | V 753.907 / 1884.944 / 352.525 against exact 789.568 / 1884.956 / 428.297 (M3) |
| `r04_nonplanar_poly*.log`, `.nef3` | the `CGAL error` line and float32 vertices (M1) |
| `r05_preview*`, `r05b_*`, `r05_multi*` | `$preview` per export, `-D` vs `--render` (B1) |
| `rerender/*.csg`, `*.stl`, `024-render.*` | census `.csg` rerenders against the reference STLs (B1, M4) |
| `nefcheck.mjs`, `nefdump.mjs`, `vol.mjs` | the probe tooling (uses `scripts/r20/mesh.mjs` read-only) |
