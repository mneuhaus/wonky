# How Marc actually uses fillets and chamfers

Date: 2026-09-23, 22:20 to 23:20 local. Part 1 of the fillet landscape (survey, usage, harness,
prototype selection). This chapter answers one question: **which blend configurations do Marc's real
parts need, how often, and how much of that is covered by the simple analytic cases?**

Machine-readable result: [`out/fillet/corpus.json`](../../out/fillet/corpus.json). Per-call records:
`tmp/fillet/primary-calls.json`. Scripts: `scripts/fillet/` (see [Reproduce](#9-reproduce)).
The shared machine ran at load average 36 to 75 on 18 cores during the runs; no timing here is a
performance claim.

Labels: **MEASURED** = produced by a run recorded here; **INFERRED** = derived by reasoning or by
reconstruction from indirect evidence; **DOCUMENTED** = stated by a source file or doc;
**HEARSAY** = unverified.

## Answer in short

1. **Population (MEASURED, static).** 94 unique modeling files in 53 design families contain a
   reachable fillet/chamfer call. 3D blends: 93 files, 52 families. FeatureScript: 55 files,
   21 families, 88 call sites. build123d: 39 files, 32 families, 136 call sites. Fillets are in
   38 families and chamfers in 25. Another 58 call sites in 37 files are dead: they sit in
   generated helper preludes (`roundX`, `filletXWindow`) that nothing calls. The acceptance anchor
   `fixtures/r10b/r10b.fs` is one of these files, so **r10b needs no fillet**.
   [corpus-triage.md](../corpus-triage.md) K12 gives "108 files / 53 families". That count comes
   from static std names and most likely includes the dead helpers (INFERRED; the raw count of files
   with any call site, dead or not, is 116 files / 60 families).
2. **Parameters are trivial (MEASURED).**
   - Every blend has constant size and mm units. FS always writes `* millimeter`; build123d uses
     bare mm.
   - Chamfers are always equal-offset. No call uses `TWO_OFFSETS`, `OFFSET_ANGLE`, `length2` or
     `angle`.
   - No call uses a variable radius, a full round, a setback or a cross-section option.
   - The dominant sizes are **0.42 mm chamfer** (the FDM "deburr", 17 families), **2 mm fillet**
     (12), **4.2 mm fillet** (11), **3 mm fillet** (10) and **1 mm fillet** (4).
3. **Edge selection is host-side and axis-bound (MEASURED, static).** The two common FS idioms are:
   - loop over `qOwnedByBody(body, EDGE)`, keep straight lines with
     `abs(direction[axis]) > 0.999`, optionally inside a coordinate window, then call
     `opFillet(qUnion(chosen))`;
   - chamfer the edge loop of one face.

   build123d does the same with `edges().filter_by(Axis.Z)`, `group_by(Axis.Z)[-1]` and
   comprehensions over `e.center()` windows. Blends often sit inside a retry: 41 sites are in
   `try`/`try silent`, 30 in loops, and radius fallbacks are common.
4. **wonky reaches almost none of these calls today (MEASURED, production CLI).** None of the
   91 FS units with a reachable blend gets as far as its first blend. They stop earlier:
   `qGeometry` is missing (24), imported curves (7), `newSketch` (6), Boolean admission and others.
   Of the 38 build123d files with a 3D blend, 7 reached at least one blend in some run (6 in the
   final run). The probe captured wonky's pre-blend B-rep for 10 calls in those 6 files.
5. **Where wonky reaches a call, its geometry agrees with the oracle (MEASURED).** When no earlier
   blend had to be omitted, wonky's pre-blend solid gives the same configuration as build123d/OCCT
   in **8 of 8 calls**: same edge count, edge classes and end-vertex classes. The 2 calls that
   differ ran after omitted blends, so they had different topology.
6. **Geometry was measured for 39 of the 52 families (70 files, 891 blend invocations).**
   | source | files | calls |
   |---|---:|---:|
   | build123d oracle, with `Mixin3D.fillet/chamfer` wrapped | 34 | 500 |
   | FeatureScript oracle through Marc's `fsocct` | 31 | 381 |
   | wonky production probe | 6 | 10 |
   | reconstruction from post-blend STEP exports | 5 | 10 (INFERRED) |

   13 families have no geometry. They need Onshape Part Studio imports or Part-Studio input, a
   missing input file, or a CLI argument.
7. **The ranking is dominated by one configuration** (MEASURED): straight plane/plane edges with
   free ends capped by perpendicular faces. It is the 90° convex "rounded vertical box edge"
   (21 families, 46 files) and its concave twin, the 270° root fillet (12 families, 18 files).
   Next come:
   - edge-loop chamfers of a face that mitre at two-edge corners (chamfer corner-2-of-3: 15
     families);
   - circular rim chamfers of holes and bosses (circle plane/cylinder: 15 families);
   - G1 chains of lines and arcs in chamfered outlines (12 families);
   - non-90° plane/plane dihedrals (obtuse 8, shallow concave 8, acute 4, deep concave 4 families).

   True 3-edge vertex blends are rare: corner-3 occurs in 2 fillet families and 2 chamfer families.
   Mixed convexity at a vertex occurs in **one** family.
8. **Analytic share (MEASURED classification on MEASURED/INFERRED geometry).** Strict analytic
   means: plane/plane lines, plane/cylinder rim circles, perpendicular caps, closed loops, G1
   chains of those, same-convexity 3-edge corners, chamfer mitres, and no face consumed. By that
   definition, strict analytic covers:
   - **619 of 891 calls (69 %)**, or 544 of 634 (86 %) without cad-project-046's radius-trial loop;
   - **50 of 70 files (71 %)**;
   - **23 of 39 families (59 %)**.

   Adding the "extended analytic" cases raises the family share to **30 of 39 (77 %)**. Those cases
   are cylinder-generator lines, cone sections, oblique planar caps and two-edge fillet mitres.
   Chamfers alone: 18 of 18 families are analytic (12 strict, 6 extended).
9. **The remaining 9 families have three concrete problems (MEASURED):**
   - **Face consumption.** The blend is wider than an adjacent face: slivers down to 0.05 mm next
     to 0.4 to 10 mm fillets. This affects 5 families: cad-project-046 ×2, the cad-project-003 rail/root
     family, the preload coupon and the project-component-d98e059b. OCCT sometimes succeeds and sometimes fails.
   - **Fillets along B-spline edges** of extruded spline profiles (cad-project-003 leg roots, 2
     families).
   - **One all-edges fillet with mixed-convexity corners** (`project-component-4c7a33fe.fs`).

   Two further artifacts are not real demand. Fillets on G1 (tangent) edges, where Marc's
   `filter_by(Axis.Z)` catches the tangent seam between a flat and a round face, are degenerate
   no-ops (2 families). One STEP-reconstruction artifact accounts for the rest.
10. **OCCT fails on Marc's parts too (MEASURED).**
    - The build123d oracle failed 170 of its 500 invocations, in 4 files. 154 of these are
      cad-project-046's deliberate 6 → 3 → 1.5 mm radius trials; the rest are project-component-d98e059b (3), the
      tripod adapter (12) and one cad-project-003 root fillet.
    - fsocct/OCCT **fails a strict-analytic case.** `r22-planar-guides.fs` chamfers the 0.42 mm
      outer face loop: 20 plane/plane and rim edges, all corner-2-of-3, no face consumption.
      Include it in the bake-off test set.

**For part 2:** an analytic Bend fillet, with the pieces listed below, already covers most of
Marc's families. The pieces are cylinder/torus rolling-ball surfaces on plane/plane lines and
plane/cylinder rims, plane-cap trimming, planar chamfer mitres, G1 chaining and the spherical
3-edge corner. The hard residue is not exotic vertex blends. It is **overflow** (blend wider than a
neighbouring face), **B-spline spines** and one **mixed-convexity** case. A fillet-by-Boolean
approach on top of the corefine + recover hybrid should be judged mainly on overflow.

## 1. Population and method

### 1.1 Files and families (MEASURED)

The population is the unique modeling files of [`out/corpus/targets.json`](../../out/corpus/targets.json):
423 files (332 FS, 91 build123d), deduplicated by SHA-256. Families are clusters under union-find
over Jaccard ≥ 0.6 of token 5-shingles, the same as [the language census](../language/corpus.md).
`scripts/fillet/corpus-static.mjs` lexes each file (comments and strings masked) and finds every call
of `opFillet opChamfer fFillet fChamfer opVariableFillet opFullRoundFillet` (FS) and
`fillet( chamfer(` (build123d, function and method form). It then marks reachability:

- **FS:** call graph from `defineFeature` bodies. Helper parameters are traced back to their call
  sites to resolve the radius.
- **Python:** the enclosing `def` is referenced outside itself, is a `test_*` function, or the call
  is at module level.

| | sites | files | families |
|---|---:|---:|---:|
| any fillet/chamfer call site | 282 | 116 | 60 |
| **reachable** | **224** | **94** | **53** |
| reachable 3D (not 2D vertex fillets of sketches) | 216 | 93 | 52 |
| FeatureScript | 88 | 55 | 21 |
| build123d | 136 | 39 | 32 |
| fillet (3D) | 131 | 76 | 38 |
| chamfer (3D) | 85 | 34 | 25 |
| 2D vertex fillets (`vertices()` of sketches) | 8 | 5 | |
| dead (defined in helper preludes, never called) | 58 | 37 | |

Revision copies inflate file counts (for example `fs560`, the project-component-1c8dacbe, has 21 files).
Families are therefore the primary unit. The dead sites are the generated `roundX`/`filletXWindow`
prelude of the single-step R10 family (`fs541`, `fs542`, `fs543`, `fs544`, `fs549`, `fs517`), including
`fixtures/r10b/r10b.fs`. Those files define the helpers but call neither of them (MEASURED by call
graph, checked by hand on r10b).

### 1.2 Geometry sources

A static scan cannot tell a convex from a concave edge. The configuration of the selected edges was
therefore measured on the solid **right before** the blend, wherever some kernel could build that
solid. All measurements use one analyzer, `scripts/fillet/edge_config.py`. It runs on OCP through
`uv run` and only measures; it builds no wonky geometry. Per selected edge it records:

- curve type;
- adjacent surface types and their analytic relation (e.g. a circle that is a cross-section of the
  cylinder; a line that is a cylinder generator);
- convexity and the material wedge angle α at 3 samples along the edge (α < 180° convex,
  > 180° concave, ≈ 180° tangent);
- width of each adjacent face across the edge, and size/width;
- length.

Per end vertex it records:

- valence and the number of selected incident edges;
- G1 continuity between selected edges (chains);
- mixed convexity;
- for free ends, whether the capping face is perpendicular to the edge.

Self-test: `tmp/fillet/selftest/t1.py`. Box vertical, all and top-loop edges, a concave L at 270°,
a hole rim, a boss root and a 26.6° wedge are all classified as expected.

| source | what runs | label | license (oracle only, nothing ported) |
|---|---|---|---|
| **wonky production** | `bin/wonky-python.mjs` on a copy of the model. A generated wrapper `exec`s the unmodified source with `build123d.fillet/chamfer` rebound. The K-th call prints wonky's edge records and stops the model with the owner solid as `result`. Wonky writes the STEP, which OCP analyses; edges are matched by their wonky records. Calls before K are omitted (recorded). `scripts/fillet/wonky-probe.mjs`, `wonky_analyze.py` | MEASURED | wonky (own) |
| **build123d oracle** | The model runs as `__main__` from a mirror in `tmp/fillet/mirror/`, with `Mixin3D.fillet/chamfer` wrapped. The wrapper records the pre-blend solid (`.brep`) and the configuration, then runs the real operation. `scripts/fillet/b3d_probe.py`, `run-b3d-oracle.mjs` | MEASURED (oracle) | build123d 0.13.0 Apache-2.0; cadquery-ocp-novtk 8.0.1 Apache-2.0, wrapping OCCT (LGPL-2.1 with exception) |
| **FeatureScript oracle** | Marc's `cad-project-043/fsocct` (FS interpreter on OCP), copied to `tmp/fillet/fsocct/`, with `opFillet` wrapped. It has no `opChamfer`, so the probe adds one on `BRepFilletAPI_MakeChamfer` (equal offsets). The copied sources have their Onshape `NS::import` lines commented out. UI defaults of precondition parameters come from their bound specs, with the same values as `src/scalars.mjs`. `makeRobustQuery` is the identity and `qAdjacent` is FACE → EDGE. `scripts/fillet/fsocct_probe.py`, `run-fsocct-oracle.mjs` | MEASURED (oracle; inputs adapted as listed) | fsocct: Marc's code, no license file; cadquery-ocp 7.9.3.1.1 |
| **STEP reconstruction** | Post-blend STEP exports (Onshape: CAx-IF header and document-id name; or FreeCAD/OCCT re-exports). Blend faces are recognized: cylinder/torus/sphere of the known radius, bounded by G1 rails, not a full revolution. Planar/conical chamfer faces are recognized by symmetric neighbour angles and width 2·w·sin(α/2). The original edge, convexity, dihedral and end caps are reconstructed. `scripts/fillet/step_blends.py`, validated on `tmp/fillet/selftest/t2.py` | INFERRED | (measurement only) |

The report takes one geometry source per file: oracle first (it has the complete call sequence),
then wonky, then STEP reconstruction for families with nothing else.

Limits of the STEP route (MEASURED on `cad-project-026/plate.py`, where oracle and STEP both exist):

- the fillet counts and classes agree;
- 2D sketch roundings of radius r look exactly like 3D fillets in the final solid;
- the 0.8 mm chamfers the oracle sees were not found (the exported STEP is probably an older
  revision).

The STEP route is used for 5 FS files only.

## 2. Static profile

### 2.1 Sizes (MEASURED; resolved through helper parameters and constants)

| blend | size (mm) | families | files | calls |
|---|---:|---:|---:|---:|
| chamfer | 0.42 | 17 | 20 | 42 |
| fillet | 2 | 12 | 33 | 89 |
| fillet | 4.2 | 11 | 25 | 68 |
| fillet | 3 | 10 | 34 | 35 |
| fillet | 1 | 4 | 20 | 34 |
| fillet | 0.4 / 4 / 0.5 | 4 each | 10 / 6 / 4 | |
| fillet | 0.8 | 3 | 9 | 9 |
| fillet | 1.2, 1.5, 0.6, 5, 8 | 2 to 3 each | | |
| chamfer | 0.4, 2, 1.2, 0.3, 0.8 | 2 each | | |
| long tail | 1.699, 1.65, 0.65, 1.55, 1.4, 0.6, 0.55, 0.5, 2.5, 0.45, 10 | 1 each | | |

All FS sizes are `N * millimeter`. build123d sizes are unitless mm. No size is inch-based.
`tangentPropagation`: 30 FS sites set `false` and 58 leave the default `true` or set it explicitly.
In the measured FS selections `false` never mattered. fsocct raises an explicit error when OCCT would
propagate a fillet to an unselected tangent edge, and no run raised it (MEASURED).

### 2.2 Edge selection (MEASURED classes by regex over the selecting code, hand-checked)

| frontend | selection idiom | families | files | sites |
|---|---|---:|---:|---:|
| build123d | comprehension/predicate over `e.center()`, radius or position windows | 22 | 29 | 85 |
| FS | straight lines only (`qGeometry(LINE)` / `evLine`) | 12 | 43 | 70 |
| build123d | `filter_by(Axis.X/Y/Z)` | 12 | 12 | 36 |
| FS | all edges of a body (`qOwnedByBody(b, EDGE)`) then filtered | 10 | 36 | 62 |
| build123d | extremal plane loop (`group_by(Axis.Z)[-1]`, `sort_by(...)[0].edges()`) | 10 | 11 | 30 |
| FS | axis-parallel direction test `abs(direction[i]) > 0.999` | 9 | 39 | 60 |
| FS | coordinate window on the edge midpoint or bbox | 6 | 11 | 12 |
| FS | per-edge `try silent` retry / radius fallback | 6 | 11 | 14 |
| FS | point picks (`qContainsPoint`, `qClosestTo`) | 4 | 6 | 8 |
| both | face loop (`qAdjacent(face, EDGE)`, `outer_wire().edges()`) | 2 + 2 | 4 + 3 | 5 + 17 |
| build123d | single-edge retry `[e]` | 3 | 3 | 3 |

Control context: 41 sites inside `try`, 30 inside loops and 31 inside `if` (empty guards). The corpus
language chapter already flags these fallback loops as the main reason for geometry-dependent control
flow ([corpus.md §2](../language/corpus.md)). A kernel whose blend succeeds, or fails as a value,
removes most of them (INFERRED).

## 3. How far wonky gets (MEASURED, production CLI, working tree of 2026-09-23 ~23:00)

- **FS.** In the latest recorded corpus run of each of the 91 units (`out/corpus/runs.jsonl` and
  `bench/*`), **0 units reach an `opFillet`/`opChamfer`**. The first blockers:

  | first blocker | units |
  |---|---:|
  | `qGeometry` missing | 24 |
  | imported curve `icurve` | 7 |
  | `newSketch` | 6 |
  | through-hole Boolean admission | 5 |
  | profile solving with nested loops | 4 |
  | edit-in-place source body | 3 |
  | `opTransform` | 3 |
  | others | 39 |

  A probe inside FS would therefore see nothing yet. The FS geometry above comes from fsocct and
  STEP.
- **build123d.** `wonky-probe.mjs` ran all 38 files with a 3D blend. **7 reached at least one blend** in production (6 in the final run):

  | file | probed calls |
  |---|---:|
  | `kalibrier.py` | 1 |
  | `cad-project-017/base.py` | 1 |
  | `extruder_stub.py` | 1 |
  | `cad-project-026/plate.py` | 1 |
  | `cad-project-033/case.py` | 4 |
  | `cad-project-035/project-component-d98e059b.py` | 2 |
  | `project-component-abeb2fd3.py` | the first probe run captured the `_stud` rim chamfer; the rerun stopped earlier, in a planar-arrangement subtraction (`AmbiguousContact`) in `tray()`; other workflows were changing the kernel meanwhile, cause not investigated |

  The others stop first at:
  - unavailable packages (`bd_warehouse`, `numpy`, `yaml`, `hardware_refs`);
  - `Text`, `offset` or `Sketch + Sketch`;
  - `import_step`;
  - planar-arrangement `AmbiguousContact`;
  - coaxial/through-hole Boolean admission.
- **Agreement with the oracle:** 8 of 8 calls without omitted blends agree exactly (edge count, edge
  classes, vertex classes). The 2 calls after omitted blends differ, because the selection then runs
  over different topology (`cad-project-033/case.py:200`, `project-component-d98e059b.py:231`).
- **Seam edges.** OCCT/build123d periodic faces carry a seam edge. "All edges" selections pick it up:
  12 selected edges in `cad-project-033` and `project-component-4c7a33fe.fs`. Parasolid/Onshape has no seam edges, so the
  report drops them. wonky's cylinders also have a seam edge (3 faces / 3 edges in
  `out/corpus/reference.json`). **A wonky blend must ignore selected seams**, or the queries must
  never return them (INFERRED requirement).

## 4. Ranked configurations (MEASURED unless the source is STEP reconstruction)

Ranking is by families, then files, then calls. "class" is the analytic level from §5.

### 4.1 Edge configurations

| # | kind | edge (curve: adjacent surfaces) | convexity | dihedral α | families | files | calls | edges | class |
| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | fillet | `line:plane/plane` | convex | 90° | 21 | 46 | 291 | 1633 | strict |
| 2 | chamfer | `line:plane/plane` | convex | 90° | 17 | 22 | 190 | 2405 | strict |
| 3 | chamfer | `circle:cylinder-section/plane` (hole/boss rim) | convex | 90° | 15 | 15 | 63 | 438 | strict |
| 4 | fillet | `line:plane/plane` | concave | 270° | 12 | 18 | 80 | 127 | strict |
| 5 | fillet | `line:plane/plane` | concave | 180 to 270° | 8 | 10 | 253 | 997 | strict |
| 6 | fillet | `line:plane/plane` | convex | 90 to 180° | 8 | 8 | 36 | 242 | strict |
| 7 | fillet | `line:plane/plane` | concave | > 270° | 4 | 6 | 10 | 21 | strict |
| 8 | fillet | `line:plane/plane` | convex | < 90° | 4 | 5 | 10 | 22 | strict |
| 9 | fillet | `circle:cylinder-section/plane` | convex | 90° | 3 | 3 | 15 | 455 | strict |
| 10 | chamfer | `circle:cone-section/plane` | convex | obtuse | 3 | 3 | 3 | 4 | extended |
| 11 | fillet | `bspline:extrusion/plane` (extruded spline profile) | concave | > 270° | 2 | 5 | 14 | 28 | general |
| 12 | fillet | `bspline:extrusion/plane` | concave | 180 to 270° | 2 | 5 | 14 | 28 | general |
| 13 | fillet | `line:cylinder-generator/plane` | **tangent** | 180° | 2 | 2 | 2 | 26 | general (degenerate selection) |
| 14 | fillet | `line:cylinder-generator/plane` | concave | 180 to 270° | 1 | 1 | 16 | 17 | extended |
| 15 | fillet | `bspline:extrusion/plane` | concave | 270° | 1 | 1 | 4 | 4 | general |
| 16 | chamfer | `line:cylinder-generator/plane` | convex | 90° | 1 | 1 | 4 | 8 | extended |
| 17 | fillet | `circle:cylinder-section/plane` | concave | 270° | 1 | 1 | 1 | 8 | strict |
| 18 | fillet | `circle:plane/torus` | **tangent** | 180° | 1 | 1 | 1 | 15 | general (degenerate selection) |
| 19 | fillet | `line:cylinder-generator/plane` | convex | obtuse | 1 | 1 | 1 | 2 | extended |
| 20 | fillet | `line:plane/plane/plane` (STEP artifact: split support) | convex | 90° | 1 | 1 | 1 | 2 | general |

No edge between two curved faces, no cone/cone or cylinder/cylinder fillet and no ellipse appears as a selected
edge. The only sphere or torus support is one degenerate tangent edge (row 18) (MEASURED, 39 families).

### 4.2 End-vertex configurations

| # | kind | vertex class | families | files | calls | class |
| ---: | --- | --- | ---: | ---: | ---: | --- |
| 1 | fillet | `free-end/perpendicular-cap`: the blend runs out into a face perpendicular to the edge | 27 | 58 | 642 | strict |
| 2 | chamfer | `corner-2-of-3`: two chamfered edges meet, the third edge stays sharp (mitre) | 15 | 20 | 106 | strict |
| 3 | chamfer | `tangent-chain`: G1 line/arc chain | 12 | 12 | 44 | strict |
| 4 | chamfer | `closed-loop-seam`: closed circle | 9 | 9 | 17 | strict |
| 5 | chamfer | `free-end/perpendicular-cap` | 6 | 11 | 85 | strict |
| 6 | fillet | `corner-2-of-3` (two fillet cylinders mitre, third edge sharp) | 5 | 5 | 12 | extended |
| 7 | fillet | `free-end/curved-cap` | 3 | 3 | 20 | extended |
| 8 | fillet | `free-end/oblique-planar-cap` | 3 | 3 | 14 | extended |
| 9 | chamfer | `free-end/curved-cap` | 3 | 3 | 8 | extended |
| 10 | fillet | `tangent-chain` | 2 | 2 | 6 | strict |
| 11 | chamfer | `corner-3` | 2 | 2 | 5 | strict |
| 12 | fillet | `corner-3` (spherical corner, same convexity) | 2 | 2 | 4 | strict |
| 13 | fillet | `closed-loop-seam` | 1 | 1 | 8 | strict |
| 14 | chamfer | `free-end/oblique-planar-cap` | 1 | 1 | 4 | extended |
| 15 | fillet | `corner-3/mixed` (mixed convexity) | 1 | 1 | 2 | general |

Not seen in any measured selection:

- vertices with 4 or more blended edges;
- setback situations with unequal radii at one vertex;
- a blend ending on a face that is itself being blended in the same call, apart from the chains and
  corners above.

### 4.3 Whole blend calls (top 15)

| # | configuration (edges ‖ end vertices) | families | files | calls | class |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | fillet: plane/plane lines, convex ‖ perpendicular caps | 17 | 42 | 306 | strict |
| 2 | fillet: plane/plane lines, concave ‖ perpendicular caps | 11 | 17 | 306 | strict |
| 3 | chamfer: plane/plane lines + rim arcs ‖ mitres + G1 chains (outline of a rounded plate) | 9 | 9 | 28 | strict |
| 4 | chamfer: closed rim circle ‖ closed loop | 5 | 5 | 13 | strict |
| 5 | chamfer: plane/plane lines ‖ perpendicular caps | 4 | 9 | 72 | strict |
| 6 | chamfer: plane/plane lines ‖ mitres (face loop) | 3 | 8 | 57 | strict |
| 7 | chamfer: lines + arcs ‖ mitres + caps + chains | 3 | 3 | 4 | strict |
| 8 | fillet: B-spline extrusion/plane, concave ‖ perpendicular caps | 2 | 5 | 18 | general |
| 9 | chamfer: lines + arcs ‖ mitres | 2 | 2 | 4 | strict |
| 10 | fillet: plane/plane lines, convex ‖ mitres (top loop of a box) | 2 | 2 | 2 | extended |
| 11 | chamfer: lines + arcs ‖ curved caps + chains | 2 | 2 | 2 | extended |
| 12 | chamfer: cone section + rim + lines ‖ loop + mitres + chains | 2 | 2 | 2 | extended |
| 13 | fillet: plane/plane lines, concave ‖ mitres | 2 | 2 | 2 | extended |
| 14 | fillet: convex + concave plane/plane lines ‖ perpendicular caps (not at one vertex) | 2 | 2 | 2 | strict |
| 15 | fillet: cylinder-generator/plane, concave ‖ curved caps | 1 | 1 | 15 | extended |

The full table (42 rows) is in `out/fillet/corpus.json` → `geometry.rankCalls`.

### 4.4 Counts and proportions

- **Edges per blend call:** median 4, max 462. Chamfering every edge of a machined part happens:
  `wasteboard.py` and `cad-project-033`.
- **Size relative to the adjacent faces**, as size/width across the face at the edge midpoint:
  - most blends are small against their faces (median 0.12);
  - **5 families contain faces narrower than the blend**, the face-consumption/overflow case:
    - cad-project-046 `mount.py`: 1,702 edge samples, dominated by its per-edge radius-trial loop;
    - `tripod_adapter.py`: 50;
    - the cad-project-003 hands/rail family: 4;
    - the preload coupon: 16;
    - project-component-d98e059b: 5, down to 0.05 mm faces.
  - Checked by hand on a coupon BREP: a 0.125 × 2.4 mm face next to a 0.4 mm concave root fillet.
- **Chains:** the G1 chains are line–arc–line outlines of rounded plates (chamfered top and bottom
  outlines). Long fillet chains along curved spines do not occur (MEASURED).

### 4.5 Per family

| family | representative file | files | calls | source | strict/ext/general calls | dominant edges | dominant end vertices |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| fs560 | `cad-project-040/archive/r1/snapshot/z-axis.fs` | 21 | 352 | fsocct | 352/0/0 | plane/plane convex ×1604 | perpendicular caps ×2360; chamfer mitres ×424 |
| py175 | `cad-project-003/overnight-2026-09-05/.../family_snapshot.py` | 7 | 23 | build123d | 10/0/13 | B-spline/plane concave ×48; plane/plane concave ×23 | perpendicular caps ×142 |
| fs473 | `cad-project-041/archiv/gt2-linie/single-stage-gt2-mini-r1/mini-stage.fs` | 5 | 12 | fsocct | 12/0/0 | plane/plane convex ×44 | perpendicular caps ×88 |
| fs476 | `cad-project-041/archiv/gt2-linie/single-stage-gt2-r1/single-stage.fs` | 2 | 4 | fsocct | 4/0/0 | plane/plane convex ×16 | perpendicular caps ×32 |
| py4464 | `cad-project-046/mount.py` | 1 | 285 | build123d | 97/21/167 | plane/plane convex ×1192, concave ×971; cylinder-generator/plane concave ×17 | perpendicular ×2206; oblique planar ×832; mitres ×480 |
| py4466 | `cad-project-046/tripod_adapter.py` | 1 | 39 | build123d | 17/0/22 | plane/plane convex ×94; rim ×44; plane/plane concave ×40 | perpendicular ×156; chains ×44; mitres ×44 |
| py326 | `cad-project-013/wasteboard.py` | 1 | 30 | build123d | 23/6/1 | rim ×686; plane/plane convex ×632; tangent seam ×24 | chains ×664; mitres ×596; closed loops ×78 |
| py177 | `cad-project-003/.../preload_z/coupon.py` | 1 | 24 | build123d | 8/0/16 | plane/plane concave ×24 | perpendicular ×48 |
| py1668 | `cad-project-033/case.py` | 1 | 23 | build123d + wonky | 19/4/0 | plane/plane convex ×230; rim ×36 | mitres ×198; perpendicular ×60; chains ×36 |
| py1674 | `cad-project-035/project-component-d98e059b.py` | 1 | 15 | build123d + wonky | 11/1/3 | plane/plane convex ×62; rim ×23; concave ×10 | perpendicular ×64; chains ×30; mitres ×26 |
| fs556 | `cad-project-043/fsocct/cases/workspace/project-component-4c7a33fe.fs` | 1 | 10 | fsocct | 8/0/2 | plane/plane convex ×116; concave ×16; rim ×16 | corner-3 ×64; **corner-3 mixed ×24** |
| py199 | `cad-project-003/.../preload_family.py` | 1 | 9 | build123d | 3/0/6 | B-spline/plane concave ×12 | perpendicular ×30 |
| py1595 | `cad-project-026/plate.py` | 1 | 8 | build123d + wonky | 6/2/0 | plane/plane convex ×45; concave ×8; rim ×6 | mitres ×48; perpendicular ×14 |
| py69 | `cad-project-003/project-component-abeb2fd3.py` | 1 | 6 | build123d | 6/0/0 | plane/plane convex ×24; rim ×9; concave ×8 | mitres ×24; perpendicular ×16 |
| py1594 | `cad-project-026/bar.py` | 1 | 6 | build123d | 5/1/0 | plane/plane convex ×32; rim ×8 | perpendicular ×24; mitres ×16 |
| fs479 | `cad-project-041/archiv/rocking-tray-r1-r6c/.../r4-native.fs` | 1 | 6 | STEP (FreeCAD re-export) | 3/2/1 | plane/plane convex ×31, concave ×7, at many angles | perpendicular ×84; oblique ×9 |
| py70 | `cad-project-003/kalibrier.py` | 1 | 5 | build123d + wonky | 5/0/0 | rim ×5 | closed loops ×5 |
| py72 | `cad-project-003/neustart/robot.py` | 1 | 4 | build123d | 4/0/0 | plane/plane concave ×16 | perpendicular ×32 |
| py4186 | `cad-project-014/.../make_probestaebe.py` | 1 | 4 | build123d | 4/0/0 | plane/plane convex ×48 | corner-3 ×32 |
| py4236 | `cad-project-043/pruefstand/tests/test_form.py` | 1 | 3 | build123d | 3/0/0 | plane/plane convex ×28 | corner-3 ×16 |
| py184, py312, py1471, fs475, py170, py280, py1468, py1473, py1596, py1662, py1664, py1665, fs425, fs504, fs364 | 1 file each | | 1 to 2 | various | all strict | plane/plane lines, rims | caps, mitres, chains |
| py279, py1660, fs511, fs286 | 1 file each | | 1 | build123d / STEP | extended | mitred fillet loop, cone chamfer, cylinder-generator | mitres, caps |

Families with reachable blends but **no measured geometry** (13). Their static profile matches the
measured classes (INFERRED): 0.42 mm deburr chamfers on face loops and axis-parallel line fillets.

| family | why there is no geometry |
|---|---|
| fs2, fs6, fs20 (funnel holder) | edit in place on an existing Onshape guide body (needs Part-Studio input / imports) |
| fs16, fs19 (SC15 adaptation) | `Arms/Flap/Coupling/Connectors::build`, precondition on imported parts |
| fs276 (central drive, 5 mm motor-root fillets, point-picked) | needs the housing body |
| fs415 (base templates) | `newSketch` |
| fs481, fs489, fs491 (rocking tray r5 to r6c; `roundX`/`filletXWindow` 2 to 4.2 mm) | `R4/R5/R6::build` imports, no STEP export in the corpus |
| py4279 (`style_tile.py`) | argparse CLI, needs arguments |
| py1670 (`debug_edges.py`) | stale against `case.py` |
| py3778 (`build_exact.py`) | its input file is missing from the corpus |

## 5. Analytic share

**Definition.** Every call gets the worst level of its edges and end vertices.

- **strict** (the analytic cases from the brief):
  - every edge is a plane/plane line or a plane/cylinder rim circle (the circle is a cross-section
    of the cylinder), convex or concave, at any dihedral;
  - every end vertex is a free end with a perpendicular cap, a closed loop, a G1 chain, a
    same-convexity 3-edge corner (sphere) or, for chamfers, a two-edge mitre;
  - no blend is at least as wide as an adjacent face.

  The blend surfaces are then cylinders and tori (fillet) or planes and cones (chamfer), trimmed
  by planes. The only vertex patch is a sphere.
- **extended:** strict, plus:
  - cylinder-generator lines and cone/cylinder sections;
  - oblique planar or curved caps;
  - two-edge fillet mitres (two cylinders meeting in an intersection curve, analytic surfaces).
- **general:** everything else:
  - mixed-convexity vertices;
  - B-spline spines;
  - tangent (degenerate) edges;
  - face consumption / overflow;
  - STEP artifacts.

| unit | strict | extended | general | total | strict share | strict+extended share |
|---|---:|---:|---:|---:|---:|---:|
| blend calls | 619 | 41 | 231 | 891 | 69 % | 74 % |
| blend calls without cad-project-046's radius-trial loop | 544 | 26 | 64 | 634 | 86 % | 90 % |
| files (worst call) | 50 | 7 | 13 | 70 | 71 % | 81 % |
| **families (worst call)** | **23** | **7** | **9** | **39** | **59 %** | **77 %** |
| families, fillets only | 16 | 5 | 9 | 30 | 53 % | 70 % |
| families, chamfers only | 12 | 6 | 0 | 18 | 67 % | 100 % |

What keeps the 9 general families out:

| reason | families | calls | OCCT |
|---|---:|---:|---|
| face consumption (blend wider than an adjacent face) | 5 | 208 | 154 of the 167 cad-project-046 loop calls failed; the coupon's 16 succeeded |
| fillet along a B-spline edge (extruded spline leg roots, concave) | 2 | 18 | all succeeded |
| fillet on a tangent (G1) edge, a degenerate selection | 2 | 2 | succeeded (no-op) |
| mixed-convexity 3-edge corner (all-edges fillet of `project-component-4c7a33fe`) | 1 | 2 | succeeded |
| STEP-reconstruction artifact (blend face against a split support) | 1 | 1 | n/a |

## 6. Test candidates for the bake-off (MEASURED)

Every pre-blend solid the oracles saw is saved:

- build123d: `tmp/fillet/b3d/brep/<hash>.brep` with edge indices in `config.edges[].edge`
  (TopExp map order);
- fsocct: `tmp/fillet/fsocct-out/brep/`;
- wonky: `tmp/fillet/wonky/out/<file>/k<K>/model.step`.

These are ready-made fixtures for part 2. Candidates, by configuration:

| configuration | fixture source | why |
|---|---|---|
| box vertical edges, convex 90°, perpendicular caps | `cad-project-017/base.py` k1 (wonky STEP and build123d BREP) | the dominant case; wonky builds the input today |
| rim chamfer, closed circle | `cad-project-003/kalibrier.py` k1 (wonky and build123d) | top-3 chamfer, closed loop without vertices |
| outline chamfer, lines + arcs, mitres + G1 chains | `cad-project-032/project-component-32f60153.py`, `cad-project-033/case.py` | top-3 chamfer call |
| face-loop chamfer that **OCCT fails** (strict class) | `cad-project-039/r22-planar-guides.fs` (fsocct BREP) | 20 edges, no face consumption, OCCT "could not build chamfer" |
| concave 270° root fillets | `cad-project-003/neustart/robot.py`, `cad-project-026/plate.py` (fillet 3 mm, 8 edges, mitres) | concave twin of the top case |
| non-90° dihedrals (26.6° to 165°) | top plates `fs286`/`fs364` (STEP), rocking tray R4 (STEP), cad-project-046 | obtuse/acute plane/plane |
| 3-edge sphere corners | `cad-project-043/pruefstand/tests/test_form.py`, `make_probestaebe.py` | strict corner-3 |
| mixed-convexity corners | `cad-project-043/fsocct/cases/workspace/project-component-4c7a33fe.fs` (fsocct BREP) | only occurrence |
| overflow / face consumption | `preload_z/coupon.py` (OCCT ok), `project-component-d98e059b.py` (OCCT fails), cad-project-046 `_fillet_notches` (6 → 3 → 1.5 mm trials) | the main hard case in the corpus |
| B-spline spine | cad-project-003 `family_snapshot.py` / `preload_family.py` rail and leg roots | the only non-analytic spine |

## 7. What this means for part 2 (INFERRED from §4 and §5)

- **Must have** (strict: 23 of 39 families on their own, 30 with the extended pieces):
  - rolling-ball cylinder on plane/plane lines at any dihedral, convex and concave;
  - torus on plane/cylinder rims;
  - planar/conical equal-offset chamfers;
  - trimming by perpendicular and oblique planar caps;
  - chamfer mitres;
  - fillet mitres, which need cylinder/cylinder trimming;
  - G1 line–arc chains;
  - the spherical 3-edge corner;
  - ignoring seam edges.

  This is the analytic core. Onshape, Parasolid and OCCT all special-case it (see the
  implementation notes in `docs/research/sources/`).
- **Decides the remaining families:** overflow, where the blend rolls over or consumes an adjacent
  face. It is the dominant reason in 5 of the 9 general families and the reason for most OCCT
  failures here. A fillet-by-Boolean approach (blend solid = swept ball or offset-surface wedge,
  combined with the corefine + recover hybrid) handles overflow naturally. So overflow is the
  criterion on which to compare a Boolean-based prototype with a surface-patching (ChFi3d-style)
  one.
- **Low priority:**
  - B-spline spines (2 families; wonky has no B-spline curves yet, see `python/build123d.py` gaps);
  - mixed-convexity vertex blends (1 family);
  - variable radius, setbacks and two-distance chamfers (0 uses).
- **Robustness as a value.** 41 sites wrap blends in `try` and fall back to smaller radii. A blend
  that reports "cannot" as a structured capability error, per AGENTS.md, keeps Marc's fallback
  idiom working unchanged.

## 8. Limitations

- **The oracles are not Onshape.**
  - fsocct runs with the Onshape imports removed and UI defaults implied. Features that use
    imported bodies fail at the use site and are excluded, not approximated.
  - OCCT topology adds seam edges, which the report drops.
  - Onshape's own edge selection on Parasolid topology can differ in counts (for example seams, or
    split periodic faces).
- **Revision copies.** fs560 contributes 352 calls from 21 revision copies. Families are the
  primary unit for this reason.
- **Calls are invocations, not source sites.** The cad-project-046 loop alone contributes 257
  single-edge trial calls. Shares are given with and without it.
- **Width measure.** Width is marched from the edge midpoint across each face and projected onto
  the surface, so it is approximate on curved faces. Runs before 23:50 capped the march at 100 mm,
  because OCP 8 does not bind `Bnd_Box.Get`; `edge_config.py` now uses `CornerMin/Max`. This
  affects only widths above 100 mm, which do not change any "consumed" verdict.
- **STEP reconstruction** (5 FS files) cannot tell 2D sketch roundings from 3D fillets and depends
  on the export revision.
- **Static regex classes** (§2.2) are heuristic and hand-checked on the helpers listed. The
  geometric classes (§4) do not depend on them.
- **wonky reach** was measured on a working tree that other workflows were changing. For example,
  `project-component-abeb2fd3.py` reached a blend in one run and stopped earlier in a later one.

## 9. Reproduce

```sh
node scripts/fillet/corpus-static.mjs                      # tmp/fillet/static.json (static census)
node scripts/fillet/run-b3d-oracle.mjs                      # build123d oracle, mirror in tmp/fillet/mirror (uv run --offline)
(cd tmp/fillet/fsocct && uv sync --offline --frozen --no-dev)   # copy of ~/Workspace/cad/cad-project-043/fsocct
node scripts/fillet/run-fsocct-oracle.mjs                   # FS oracle
node scripts/fillet/wonky-probe.mjs                         # wonky production probe (bin/wonky-python.mjs)
uv run --no-project --offline --with build123d==0.13.0 python scripts/fillet/wonky_analyze.py
uv run --no-project --offline --with build123d==0.13.0 python scripts/fillet/step_blends.py <step> <out.json> --fillet 2 --chamfer 0.42
node scripts/fillet/corpus-report.mjs                       # out/fillet/corpus.json, tmp/fillet/primary-calls.json
node scripts/fillet/corpus-tables.mjs > tmp/fillet/tables.md
```

All runners are resumable. The corpus (`~/Workspace/cad`) is only read. Python runs through
`uv run` only. The worklog is local development evidence.
