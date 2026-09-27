# Cluster boolean-invalid-topology: the planar Boolean refuses operands built in F32

Date: 2026-09-23, in three passes:

1. 2026-09-22 23:48 to 00:10: the first pass, interrupted.
2. 00:20 to 01:05: the second pass. It re-checked the first pass's scripts,
   per-unit diagnosis and five repros, and used them.
3. 04:11 to 04:50: the third pass.
   - It re-ran all 11 repro variants (`repros-recheck.jsonl`: unchanged
     results).
   - It re-verified every code reference.
   - It extended the next-blocker run (section 5.3) from 16 to all 57 units.
   - It ran the frozen anchor `fixtures/r10b/r10b.fs#r10bTransferEdge` and
     the neighbouring cluster's `next-tilted-pocket-subtraction.fs` through the
     simulated fix (`followup.jsonl`).
   - It took four real second-level refusals through `recover`.
   - It recorded the shared decision with the kernel-sketch-and-ops and
     boolean-capability clusters (section 4.1).

   No file under `src/`, `kernel/`, `bin/` or `scripts/bakeoff/` had changed
   since the second pass.

Input: [the corpus run](run.md) (`out/corpus/runs.jsonl`, cluster 10).

Setup:

- HEAD `79bbfeec` plus the working tree of that moment, Node v22.23.1;
- the default JS path (`WONKY_BACKEND` unset), `strict` modeling policy;
- at most 3 wonky processes, 300 to 900 s per unit.

The machine was shared with benchmarks, with a load average of 10 to 105.
`uptime` is recorded:

- per pass in `out/corpus/boolean-invalid-topology/run-meta.jsonl`;
- in every record of `repros-cli.jsonl`, `repros-recheck.jsonl`,
  `dumps.jsonl`, `repros-next-blocker.jsonl`, `followup.jsonl` and
  `next-linearc-pass-all.jsonl`;
- in `bakeoff-recover.json`.

No production file was changed.

Machine-readable results are in `out/corpus/boolean-invalid-topology/`:

- `files.json`: every cluster file with each unit's first blocker;
- `summary.json`: per unit, why the admission refuses, and what the unit hits with the fix simulated;
- `next-table.json`: per unit, the first non-Boolean blocker with the fix simulated and every Boolean refusal stubbed, and the refusals stubbed on the way;
- `followup.jsonl`: the frozen anchor's `r10bTransferEdge` and the tilted pocket;
- `bakeoff-recover.json`: the repros and four real second-level refusals on the bake-off `recover` route.

Repros: `fixtures/corpus-repro/boolean-invalid-topology/`. Scripts:
`scripts/corpus/diagnose-planar-admission.mjs`,
`scripts/corpus/diagnose-cluster.mjs`, `scripts/corpus/summarize-admission.mjs`
and `scripts/corpus/boolean-invalid-topology/`.

## Answer in short

1. **The Boolean is not what fails. Its operands are built in single
   precision.** Every polygon prism (`skPolyline`, `skRectangle`, line-only
   `skLineSegment` sketches, `fCuboid`) is extruded by `kernel/topology.bend`
   on `kernel/geometry.bend`, whose coordinates are `F32`. Every rigid copy of
   such a prism (`opPattern`) is also computed in F32. A slanted side face gets
   its plane from its first vertex and an F32-rounded normal, so its other
   vertices miss that plane by 5e-8 to 3.2e-6 mm. A rotated copy rounds each
   vertex separately, so the faces stop being planar (up to 7.3e-6 mm).

   The planar arrangement admits an operand only if every vertex lies on its
   face planes within `1e-12 × model scale`, which is 3e-11 to 7e-10 mm here.
   The gap is four to five orders of magnitude.
   - No existing setting touches this admission. `src/boolean.mjs` passes
     the modeling policy (`strict`, or the acceptance run's
     `tolerated-regularized`) to the planar arrangement only as evidence.
   - Widening the resolution would make every polygon model an approximation
     under the `AGENTS.md` rules.

   Axis-aligned faces
   are exact in F32. So, by symmetry, are 45° faces. That is why boxes, the
   r10b `g7`/`g9` operations and the 45° controls build.
2. **Minimal repro:** `wedge-union.fs`, a 3-vertex wedge united with a box.
   With the hypotenuse at 35°, the CLI fails with
   `InvalidTopology (stage 1, detail 0)`. At 45° and for a rectangle it
   builds.
3. **The fix is in the kernel:** build polygon prisms and their rigid copies in
   F32x2, the same way `kernel/sketch-arcs.bend` already builds line/arc
   profiles. Build the prism in the sketch's own frame, where every carrier is
   exact. Then apply one F32x2 rigid transform to world, and check the result
   with the existing `curved-validate` audit.
   - Effort **M** (about 3 to 4 days including one re-baseline).
   - Risk **medium**. The last bits of every polygon model change, pinned
     test values must be re-baselined, and the native-bridge plan changes the
     same seam.

   I simulated the fix with the existing F32x2 line extruder. On that path,
   all five carrier repros build, and 56 of the 57 cluster units pass the
   admission. The 57th exceeds the arrangement's input size.

   Further points (section 4 and 4.1):
   - The fix must keep **oblique sweeps**. The print-package r10b snapshot's
     `nose` needs one, and the simulation's `sketch-arcs` path refuses it
     (`NonNormalSweep`).
   - It subsumes the kernel-sketch-and-ops "cap normal" fix (variant B).
   - It settles boolean-capability's F4 question in favour of F32x2
     construction rather than tolerance admission.
   - Land it with one re-baseline together with the native slice and the
     language work's F32 precision contract.
4. **The fix alone makes no unit build.** With the fix simulated, the 57 units
   stop at these blockers:

   | next blocker | units | cluster |
   |---|---:|---|
   | planar arrangement `UnsupportedArrangement (stage 6)`, face ownership | 17 | this one, second level |
   | planar arrangement `AmbiguousContact (stage 2)` | 14 | this one, second level |
   | planar arrangement input size (384 vertices > 256) | 1 | this one, resource limit |
   | `skText` | 13 | fs-missing-builtin |
   | `opLoft` with non-circular profiles | 8 | kernel-sketch-and-ops |
   | general trimmed-face Boolean (M3 hole cuts in `r10bTransferEdge`) | 4 | boolean-capability |

   Two second-level refusals turn up even on a plain chamfer
   (`next-blocker-chamfer.fs`):
   - `AmbiguousContact` when a slanted face starts exactly on an existing
     edge. Its F32x2 carrier cannot contain the exact edge vertices.
   - Face ownership (stage 6) for a slanted cut in general position.

   45° cuts build.

   With every remaining Boolean refusal also stubbed (all 57 units, section
   5.3):
   - The fix alone clears every planar refusal of 25 units: `retainingKey` 13,
     `motorBracket` 8, and 4 `r10bTransferEdge` revisions.
   - The first non-Boolean blockers:
     - `opTransform`: 20;
     - `skText`: 15;
     - `opLoft`: 9;
     - end of the feature: 7, all `r10bTransferEdge`;
     - `opFillet`: 2;
     - collinear profile: 1;
     - oblique sweep: 1;
     - JS timeout at 900 s: 2.
   - No cluster file builds completely even then.
5. **Overlap with the bake-off: `recover` does not solve the cluster by
   itself.** The harness's own leaf intake refuses today's F32 operands with
   `vertex off its surface by 7.7e-7 … 3.6e-5` (limit 1e-9 mm). Given the
   same operands in F32x2 (the simulated fix), `recover` builds exactly the
   four repro Booleans it was given (wedge, slanted union, slanted cut, rotated
   cut) and both next-blocker chamfers: OCCT-valid STEP, volume error at most
   5.4e-14. It also produces 11 faces where the planar
   arrangement makes 40.

   The third pass added four *real* second-level refusals with F32x2
   operands:
   - the frozen anchor's `apronCrest` cut;
   - the project-component-4c7a33fe `noseCut`;
   - the tilted pocket;
   - the first `upperRafter` union.

   `recover` rebuilt all four as exact, OCCT-valid B-reps, within 7.9e-14 of
   an independent mesh-Boolean volume.

   So the F32x2 construction is a prerequisite for both Boolean routes, and
   the second-level refusals belong to the bake-off.

   The native binding is bit-identical by design and changes nothing here.
   Its step 3 (`extrudePolygon`/`transform` "with carriers") is the same seam
   and must be sequenced with this fix.
6. **First blocker per file.**
   - This cluster is the only blocker of 2 files (3 units): `project-component-4c7a33fe.fs` and
     `channel-bases-r7.fs`.
   - In the other 22 files it is the first blocker of 1 to 4 units, while
     other units stop elsewhere, mostly at module imports and
     boolean-capability.
   - `r10bTransferEdge` in the 8 r10b copies is the same code that the frozen
     anchor `fixtures/r10b/r10b.fs#singleStepR10b` runs after its cores
     (`buildTransferEdge`). This cluster therefore sits on the r10b
     acceptance path.
   - Checked directly: `node bin/wonky.mjs fixtures/r10b/r10b.fs --check
     --feature r10bTransferEdge` fails today at `30:27` with this cluster's
     `InvalidTopology (stage 1, detail 0)`.
   - After the fix, the anchor's transfer edge needs two more things:
     - 2 `AmbiguousContact` Booleans (`apronCrest`, `apronUnion`); `recover`
       builds `apronCrest` exactly;
     - the 2 M3 hole cuts (boolean-capability).

     With those stubbed, the feature reaches its end (1 body, 56 faces).

## 1. The cluster

57 units, 24 files, 4 families:

| family | files | units | features | corpus message |
|---|---:|---:|---|---|
| fs95 distributor interface (R3 to R12, review copies) | 14 | 46 | `upperRafter` 14, `retainingKey` 13, `switchBracket` 8, `motorBracket` 8, `bottomSpoke` 3 | union InvalidTopology 30, subtraction InvalidTopology 14, convex-tool intersection UnsupportedArrangement 2 |
| fs549 r10b copies | 8 | 8 | `r10bTransferEdge` | subtraction InvalidTopology |
| fs556 project-component-4c7a33fe toy car (fsocct) | 1 | 2 | `project-component-4c7a33fe`, `project-component-4c7a33fe` | subtraction InvalidTopology |
| fs381 C3/C4 channel bases R7 | 1 | 1 | single feature | subtraction UnsupportedArrangement (stage 1) |

Every unit fails in its first planar Boolean (no planar Boolean succeeds
before it), after 10 to 15 completed modeling calls.

## 2. Repros

All repros are in `fixtures/corpus-repro/boolean-invalid-topology/`, are
independent of `~/Workspace/cad`, and were re-run on 2026-09-23 with
`node bin/wonky.mjs <file> --check [--feature F]`
(`out/corpus/boolean-invalid-topology/repros-cli.jsonl`, `dumps.jsonl`,
`repros-next-blocker.jsonl`). All 11 variants were run again at 04:13
(`repros-recheck.jsonl`), with identical results. The directory has a
`README.md` with the same table.

| file | stands for | observed today | with the fix simulated (`--simulate linearc`) |
|---|---|---|---|
| `wedge-union.fs --feature slanted` | minimal: 3-vertex wedge ∪ box | `33:5: Native planar arrangement union unresolved: InvalidTopology (stage 1, detail 0)`; wedge vertex 7.7e-7 mm off its carrier | builds, 319 mm³ (closed form 175 + 180 − 36) |
| `wedge-union.fs --feature diag45` / `square` | controls | build: 394 mm³ / 494 mm³ | build |
| `slanted-prism-union.fs` | fs95 unions, e.g. `interface-r3.fs#bottomSpoke` (`unite@162:4`), real numbers | `33:9: … union unresolved: InvalidTopology (stage 1, detail 0)`; 3.2e-6 mm | builds, 206767.2 mm³ |
| `slanted-prism-cut.fs` | `project-component-4c7a33fe.fs` `noseCut`, fs95 `retainingKey`/`switchBracket` cuts | `33:9: … subtraction unresolved: InvalidTopology (stage 1, detail 0)`; 1.07e-6 mm | builds, 48766.667 mm³ |
| `rotated-box-cut.fs` | the 8 `r10bTransferEdge` copies (`buildTransferEdge > cut`), unchanged r10b numbers | `35:9: … subtraction unresolved: InvalidTopology (stage 1, detail 0)`; rotated 600 mm box non-planar by 7.3e-6 mm, 3.6e-5 mm off its carriers | builds, 36339.2345 mm³ |
| `slanted-prism-intersection.fs` | fs95 `bottomSpoke` R4/R5 (`flareClip`) | `33:9: Native convex-tool intersection unresolved: UnsupportedArrangement (tool 0, face 0)` | builds, 43659.488 mm³ |
| `many-vertex-prism-cut.fs` | `channel-bases-r7.fs` (`subtract@78:9`) | `37:9: … subtraction unresolved: UnsupportedArrangement (stage 1, detail 0)` | unchanged: input size limit |
| `next-blocker-chamfer.fs --feature chamferOnEdge` | the second-level `AmbiguousContact` | `37:5: … InvalidTopology (stage 1, detail 0)` | `AmbiguousContact (stage 2, detail 11)` |
| `next-blocker-chamfer.fs --feature slantedCut` | the second-level face ownership refusal | `37:5: … InvalidTopology (stage 1, detail 0)` | `UnsupportedArrangement (stage 6, detail 0)` |
| `next-blocker-chamfer.fs --feature chamfer45` | control | builds, 1904 mm³ | builds |

## 3. Root cause

### 3.1 Construction in F32

- `opExtrude` sends every polygon profile to `ModelingContext.body`
  (`src/library.mjs:70`), then to `extrudeInBend` (`src/kernel.mjs:56`).
  Only a sketch that contains an arc goes to the F32x2 line/arc extruder.
- `src/kernel.mjs:42` serializes every coordinate with `Math.fround`, so 93.3
  enters as 93.30000305.
- `kernel/topology.bend:76` `extrude` computes on `kernel/geometry.bend`
  (`V3{x: F32, y: F32, z: F32}`):
  - `geometry.frame`/`lift_points` place the profile in world coordinates;
  - `side_face` (`topology.bend:52`) gives each side face the origin `a` (its
    first vertex) and the normal `normalize(cross(normalize(b − a), delta))`,
    all in F32;
  - top and bottom get `normalize(area_vector)` in F32.

  For a face that is not axis-aligned, the rounded normal is off by about one
  F32 ulp (6e-8 relative). The vertices `b`, `a + delta` and `b + delta`
  therefore miss the stored plane by about 6e-8 × the edge length.
- `opPattern` (`src/queries.mjs:146`) copies a polyhedral body with
  `transformInBend` (`src/kernel.mjs:80`), which calls `topology.bend:101`
  `transform`. Each vertex and each face frame is rotated separately in F32.
  After a rotation that is not axis-aligned, the four vertices of a face are
  no longer coplanar. In r10b's 600 mm cutter box they miss a common plane by
  7.3e-6 mm and their stored carriers by 3.6e-5 mm.

### 3.2 Admission in F32x2 at 1e-12 × scale

- `src/boolean.mjs:45` sends two all-plane, all-line operands to
  `kernel/ports/planar-boolean.bend`.
  - `budget_checked`/`family_checked` (`:188`) refuse other families and
    operands over 256 vertices, 512 edges or 256 faces with
    `UnsupportedArrangement (stage 1, detail 0)`.
  - `sources_checked` (`:174`) refuses with `InvalidTopology (stage 1, detail 0)`
    unless `source_valid` (`:168`) holds for both operands:
    - `occt-planar.valid`, whose `face_valid` prepares each loop against its
      plane at `resolution`;
    - the vertex-link check;
    - `curved-validate.audit`, which needs every edge on its face carriers
      within `allowance = source_budget + resolution`.
- `resolution = angular_guard × scale` (`kernel/ports/curved-validate.bend:29`,
  `kernel/intersections.bend:51`, `angular_guard = 1e-12`). The scale is the largest
  vertex, curve or surface magnitude, so the resolution is 3e-11 mm for
  `retainingKey` and 4.9e-10 mm for r10b.
- The convex-tool intersection (`kernel/ports/solid-intersection.bend:181`
  `tool_valid`) uses the same `occt-planar.valid`. With F32 carriers neither
  operand qualifies, so it reports `UnsupportedArrangement (tool 0, face 0)`.

Measured on every unit, in float64, for diagnosis only
(`admission.jsonl`, `summarize-admission.mjs`):

| operand defect | units | size of the defect vs. the admitted resolution |
|---|---:|---|
| slanted F32 carriers on one or both operands; the vertices themselves are coplanar in float64 (≤ 4e-15) | 46 | 5.2e-8 to 3.2e-6 mm vs. 3e-11 to 7e-10 mm |
| rotated F32 copy: the vertices are not coplanar | 8 | 7.3e-6 mm (fit) and 3.6e-5 mm (carrier) vs. 4.9e-10 mm |
| convex-tool intersection, the same carriers | 2 | as the first row |
| 384 vertices / 576 edges (a 192-point arc band) plus F32 carriers | 1 | size limit 256/512/256 |

The admission is doing its job: it refuses inexact input explicitly and
does not snap it. The refusal code is misleading, though. The input-size
refusal of `channel-bases-r7.fs` uses the same
`UnsupportedArrangement (stage 1, detail 0)` as a family refusal.

### 3.3 Why a carrier-only fix is not enough

The first pass tried the cheapest fix (`--simulate carriers,transform`,
`simulate-carriers-transform.jsonl`). It recomputed each face plane in float64
from its F32 vertices and ran rigid copies in float64. That admits the slanted
prisms, but the F32-rounded vertices remain. With exact F32x2 construction
(`--simulate linearc`), 8 `motorBracket` units get past both planar Booleans.
With the carrier-only fix, those same units still fail in the face-ownership
stage. The vertices have to be exact too, so the construction itself must move
to F32x2.

## 4. Fix design

**Where:** the kernel (`kernel/topology.bend`, or a new
`kernel/polygon-prism.bend` on `kernel/precise.bend`), plus a thin adapter in
`src/kernel.mjs` (`extrudeInBend`, `transformInBend`, `decodeSolid`).

**What:**

1. **An F32x2 polygon prism.**
   - Take the profile as F32x2 points (`src/real.mjs` `vector`, not
     `Math.fround`).
   - Build the solid in the sketch frame: bottom at z = 0, top at z = depth.
     A side face's carrier is the plane through its own edge with normal
     `cross(tangent, +z)`. That is exact up to F32x2 rounding, as in
     `sketch-arcs.bend:505` `side_surface_curve` and `local_solid`.
   - Map the solid to world with one F32x2 rigid transform (`A.transform`,
     as `sketch-arcs.bend:578` `construct_frame` does).
   - Check the result with `curved-validate.audit`. Refuse explicitly if the
     required incidence exceeds the allowance.
   - **Oblique sweeps must be kept.** Today's F32 extruder supports them
     (extrusion direction not along the sketch normal), but `sketch-arcs`
     refuses them (`NonNormalSweep`).
     - One cluster unit needs one right after its Booleans:
       `cad-project-041/single-step-r10/dist/R10b_Print_Package/r10b-uploaded-snapshot.fs#r10bTransferEdge`.
       Its `nose` prism (`buildTransferEdge@1383 > prism@1364`) sweeps along
       `(1, sin 25°·k, cos 25°·k)` from a plane with normal `(1, 0, 0)`.
     - The frozen anchor is nose-free ("All K05/K10/K15/K20 variants are
       nose-free").
     - Build it in the sketch frame with the sweep vector expressed in that
       frame. The caps are the sketch plane and its translate. Each side is a
       parallelogram whose F32x2 carrier has the normal
       `cross(edge tangent, sweep)`.
     - Refusing oblique sweeps would take away a construction that the F32
       extruder handles today. Any corpus prism that builds today with an
       oblique sweep would regress.
2. **An F32x2 rigid transform for polygon bodies.** Rotate vertices and face
   frames with `precise.rotate`/`A.transform` instead of `topology.bend:101`.
   `opPattern` already does that for analytic bodies (`transformAnalytic`).
3. **Keep the body format.** Keep polyhedral bodies (edge `curve: 'line'`, no
   `curveRange`) and set `precision: 'F32x2'`. Everything downstream
   (`booleanInBend` gates, the pierce admission, identity, print mesh) keeps
   working unchanged. The simulation used the `sketch-arcs` extruder, whose
   bodies carry `curveRange` on every edge. Routing production through it
   would switch those gates off: `pierceable` requires `!edge.curveRange`
   (`src/boolean.mjs:107`). It would also cost O(n²) admission: the
   192-point band repro took 29 s instead of 1.1 s, both under load.
4. **Split the stage-1 refusal:** family (`UnsupportedArrangement`) versus
   input size (for example `ResolutionLimit` with detail 1). Then
   `channel-bases-r7` reports what is really missing. This is a small,
   separate kernel change.

**Effort M, about 3 to 4 days:**

- the Bend extruder (normal and oblique sweeps) and the transform, with their
  audit: about 1.5 days;
- the adapters and precision tagging: half a day;
- tests and one re-baseline for kernel, identity, native slice and language
  goldens: 1.5 to 2 days.

**Risk: medium.**

- **Last-bit changes.** Every polygon body changes in the last bits
  (93.30000305 becomes 93.3), and so does every result built from one.
  Pinned values move in `test/kernel.test.mjs`, `test/python.test.mjs`,
  `test/planar-boolean-native.test.mjs`,
  `test/planar-boolean-integration.test.mjs` and
  `test/boolean-stress.test.mjs`. They include the r10b `g7`/`g9` freeze
  volumes 51985.642486572266 and 56948.083435058594 mm³.
- **Acceptance re-run.** The r10b acceptance run (`g10`) must be re-run.
  STEP exports must be re-validated with `uv run scripts/validate-step.py`.
- **Speed.** F32x2 construction is slower than F32. That matters little next
  to the Booleans, but should be measured.
- **Native bridge.** Its roadmap step 3 (`extrudePolygon`, `transform` "mit
  Carriern", `docs/native-bridge.md` section 12) is the same API seam and
  also wants a golden list for last-bit changes. Do one re-baseline, not two.
- **Language work.** The WK precision contract (`src/lang/wk/real-host.mjs`,
  `docs/language/proposal-core-ir.md` §2.2) states `extrude_polygon` = F32 and `transform`
  of a polyhedral body = F32. `real-oracle.mjs`, `eval-js.mjs` and
  `surface/backend-js.mjs` call `extrudeInBend`/`transformInBend` directly.
  After the fix, every kernel input is F32x2, which simplifies the contract.
  But the contract table, the content-key canonicalization (two literals that
  round to the same F32 currently share a key) and `test/lang-wk-real.test.mjs`
  / `test/lang-surface.test.mjs` must change in the same step.

### 4.1 One construction fix for three clusters

The F32 prism is also the root cause of refusals in two neighbouring
clusters. Their reports hand the decision to this one:

- **kernel-sketch-and-ops, cause 2.1 "cap normal"** (10 units, plus 12
  through-hole units of boolean-capability). `extrude` takes the cap normal
  from an F32 area vector of absolute coordinates, 1e-5 rad off at 560 mm
  from the origin. That report proposes "variant B": pass the sketch frame to
  `extrude` and use its normal for both caps (S). The F32x2 prism above
  builds in the sketch frame, so its caps *are* that frame. It subsumes
  variant B, and its side faces are exact as well. That cluster's repro
  `next-tilted-pocket-subtraction.fs` lands in this cluster today
  (`InvalidTopology`, stage 1). With the fix, it reaches stage 6, which
  `recover` builds exactly (section 6).
- **boolean-capability, F4 "F32 planar carriers"**. It asks for either
  (a) admission against the body's stated tolerance or (b) F32x2 planar
  construction. **Decision: (b).**
  - (a) cannot work for the planar arrangement. Its predicates are exact
    (`halfspace.bend` `side`: exactly on the plane, or clearly off it).
    Section 3.3 shows that exact carriers over F32-rounded vertices still fail
    at stage 6.
  - (a) would also be a tolerance mode. `AGENTS.md` allows one only with a
    stated tolerance and results that stay distinguishable from exact
    geometry, so every polygon model would become "approximate" for a defect
    that construction can remove.
  - The bake-off `recover` leaf intake has the same 1e-9 mm precondition
    (section 6).

Recommended sequencing: land variant B only if the F32x2 prism slips by more
than a few days. Otherwise, go straight to the F32x2 prism, with one
re-baseline covering the kernel, identity, native-bridge and language golden
values.

## 5. What each file hits next

### 5.1 First blocker per file

"Cluster units" are the units whose first blocker is this cluster. The other
units of the same file stop elsewhere (`files.json`).

| family | file | units | cluster units | other units' first blockers |
|---|---|---:|---|---|
| fs381 | `cad-project-039/c-channel-bases-onepiece-r7/channel-bases-r7.fs` | 1 | the single feature | none |
| fs556 | `cad-project-043/fsocct/cases/workspace/project-component-4c7a33fe.fs` | 2 | `project-component-4c7a33fe`, `project-component-4c7a33fe` | none |
| fs549 | 8 r10b copies (`cad-project-041/single-step-r10/…/r10b*.fs`, `cad-project-043/fsocct/cases/r10b/r10b.fs`) | 9 to 10 each | `r10bTransferEdge` | fs-module-import 7 to 8, kernel-sketch-and-ops 1 (`r10bSideDrive`) |
| fs95 | `…/Sorter_V2_Printed_Interface_R3/Source/interface-r3.fs` | 16 | `bottomSpoke`, `upperRafter`, `switchBracket` | boolean-capability 6, fs-module-import 4, kernel-sketch-and-ops 2, fs-missing-builtin 1 |
| fs95 | `machine-interface-r4/interface-r4.fs`, `…/interface-r5.fs` | 19 each | `bottomSpoke`, `upperRafter`, `switchBracket`, `retainingKey` | boolean-capability 7, fs-module-import 5, kernel-sketch-and-ops 2, fs-missing-builtin 1 |
| fs95 | `…/interface-r6.fs`, `machine-interface-r7/interface-r7.fs`, `machine-interface-r8/interface-r8.fs` | 22 to 24 | `upperRafter`, `switchBracket`, `retainingKey` | boolean-capability 8 to 9, fs-module-import 7 to 8, kernel-sketch-and-ops 3, fs-missing-builtin 1 |
| fs95 | `…/interface-r9.fs`, `…/interface-r10.fs` | 24 each | `motorBracket`, `upperRafter`, `switchBracket`, `retainingKey` | boolean-capability 8, fs-module-import 8, kernel-sketch-and-ops 3, fs-missing-builtin 1 |
| fs95 | `interface-r11.fs`, `interface-r11-prepared.fs`, 4 `bottom-drive-review-2026-09-19/*/native-source.fs` | 26 each | `motorBracket`, `upperRafter`, `retainingKey` | fs-module-import 9, boolean-capability 7 to 8, kernel-sketch-and-ops 5 to 6, fs-missing-builtin 1 |

### 5.2 With the fix simulated

Run: `diagnose-cluster.mjs --extra "--simulate linearc"` over all 57 units
(`simulate-linearc.jsonl`, 00:25 to 00:33, load 18 to 42). The linearc path
builds every polygon prism with the existing native F32x2 line extruder and
uses the analytic F32x2 transform for copies.

| feature (units) | planar Booleans that now pass | next blocker |
|---|---|---|
| `retainingKey` (13) | 1 (its only one) | `skText` (the `mark` lettering helper), fs-missing-builtin |
| `motorBracket` (8) | 2 | `opLoft currently requires two coaxial circular profiles` (`motorBeamWingR9 > twoProfileLoft`), kernel-sketch-and-ops |
| `r10bTransferEdge` (4 of 8 revisions: `edge-pinion`, `ee691ede-reconstructed`, both `r10b-uploaded-snapshot.fs`) | 2: the edge cut and the apron union | general trimmed-face `opBoolean`, the two M3 clearance-hole cuts, boolean-capability |
| `r10bTransferEdge` (other 4 revisions: `camera`, `tray-gap/r10b.fs`, `tray-gap/base-5d2d586d.fs`, `cad-project-043/fsocct/cases/r10b`; the frozen anchor has the same `buildTransferEdge` as the first three) | 2: the edge cut and the apron clip (convex-tool intersection) | `AmbiguousContact (stage 2)` in the apron crest cut |
| `upperRafter` (14) | 0 | `UnsupportedArrangement (stage 6)` in the first rib union |
| `switchBracket` (8) | 0 | `AmbiguousContact (stage 2)` 6, `UnsupportedArrangement (stage 6)` 2 |
| `bottomSpoke` (3) | 1: R4/R5 the convex-tool intersection, R3 the first union | `AmbiguousContact (stage 2)` 2 (R4/R5), `UnsupportedArrangement (stage 6)` 1 (R3) |
| `project-component-4c7a33fe`, `project-component-4c7a33fe` (2) | 0 | `AmbiguousContact (stage 2)` in `noseCut` |
| `channel-bases-r7` (1) | 0 | input size: a 384-vertex polygonized arc band |

`AmbiguousContact` comes from `kernel/halfspace.bend:375` `side`, called by
`planar-boolean-arrangement.bend:169`. An arrangement vertex must lie
**exactly** on a plane (exact expansion arithmetic on the stored F32x2 words)
or further than `resolution` from it.

A vertex that lies on a slanted plane by design is neither. Two examples:

- the chamfer that starts on an existing edge (`next-blocker-chamfer.fs
  #chamferOnEdge`);
- the project-component-4c7a33fe nose, whose slanted face starts on the body's top edge.

The vertex was constructed exactly from axis-aligned planes, but the
slanted carrier through it is rounded. Its distance is about 1e-15 mm: not
zero, and not clear.

Stage 6 is the face-ownership audit
(`planar-boolean-provenance.bend`, `docs/planar-boolean.md`: "no additional
curtain planes are currently inserted"). With exact carriers it still refuses
a slanted cut in general position (`#slantedCut`), while the 45° cut builds.
Both are properties of the planar arrangement, not of its inputs.

### 5.3 After every Boolean

Run: `WONKY_CORPUS_STUB=pass-all` with `--simulate linearc`
(`next-linearc-pass-all.jsonl`, aggregated by
`scripts/corpus/boolean-invalid-topology/next-table.mjs` into
`next-table.json`).

- The stub returns the first operand unchanged for every refused Boolean.
  The geometry is then wrong by construction. The stub only finds the first
  blocker that is not a Boolean.
- The second pass covered 16 units. It stopped the full run because single
  units took up to 437 s at load 65.
- The third pass ran the other 42 units (the killed R4 `bottomSpoke`
  included) at 3 processes. It used 600 s per unit for the light features and
  900 s for `upperRafter`/`bottomSpoke`, from 04:13 to 04:41 at load 20
  to 105 (`run-meta.jsonl`).

Result: all 57 units. "pl" = planar-arrangement refusals that remain after
the fix (this cluster, second level). "cap" = boolean-capability refusals
(general trimmed-face, through hole, coaxial).

| first non-Boolean blocker | units | owner cluster | remaining refusals stubbed on the way |
|---|---:|---|---|
| `opTransform` missing | 20 | fs-missing-builtin | `upperRafter` ×13: 19 to 22 pl, 1 to 7 cap each; `switchBracket` ×7: 3 to 4 pl, 3 to 5 cap |
| `skText` missing (the `mark` lettering helper) | 15 | fs-missing-builtin | `retainingKey` ×13: none; R3 `switchBracket` 7 pl / 10 cap; R3 `bottomSpoke` 5 pl / 2 cap |
| `opLoft` with non-circular profiles | 9 | kernel-sketch-and-ops | `motorBracket` ×8: none; `channel-bases-r7`: 4 pl (all input size, stage 1) |
| **reaches the end** (the geometry is wrong wherever a Boolean was stubbed) | 7 | none | `r10bTransferEdge`: always the 2 M3 hole cuts (cap), plus 2 pl (`AmbiguousContact`) in 4 of the 7 revisions |
| `opFillet` missing | 2 | fs-missing-builtin | `project-component-4c7a33fe`, `project-component-4c7a33fe`: 5 pl each (`AmbiguousContact`) |
| `Profile has collinear or nearly collinear consecutive edges` | 1 | kernel-sketch-and-ops (cause "collinear") | R3 `upperRafter`: 22 pl / 7 cap; `plateEnvelope`, vertex `[-154.20679, -299.19131]` on a straight edge |
| `NonNormalSweep` | 1 | this fix (see 4, item 1) | print-package snapshot `r10bTransferEdge`: 2 cap; its oblique `nose` prism |
| not reached within 900 s | 2 | JS speed | R4/R5 `bottomSpoke`: killed during refused Booleans on 116/118-vertex operands (`AmbiguousContact`, then `ResolutionLimit (stage 2)`, then stage 6 on every cut) |

Findings:

- **The F32x2 fix alone clears every planar refusal of 25 of the 57 units**
  before their first non-Boolean blocker:
  - `retainingKey` (13);
  - `motorBracket` (8);
  - 4 `r10bTransferEdge` revisions: `edge-pinion`, `ee691ede-reconstructed`,
    both `r10b-uploaded-snapshot.fs`.
- **For 30 units, the planar arrangement's own second level decides.**
  - `AmbiguousContact (stage 2)`: 27 units, 167 refusals.
  - Face ownership, `UnsupportedArrangement (stage 6)`: 23 units, 155
    refusals.
  - `ResolutionLimit (stage 2)`, the 512-cell limit: in the two
    `bottomSpoke` units that were killed.
  - The input-size limit (`channel-bases-r7`): 4 refusals.
  - `upperRafter` alone needs about 20 of them per unit.
- **Boolean-capability refusals come after this cluster's** in 31 units (81
  refusals). Most are the general trimmed-face Boolean. That arm belongs to the
  bake-off.
- **No file builds completely, even with every Boolean stubbed.**
  - fs95: all of its 46 cluster units, over 14 files, stop at `opTransform`,
    `skText`, `opLoft`, or collinear-profile validation.
  - `project-component-4c7a33fe.fs` stops at `opFillet`.
  - The 7 r10b units that reach the end only close their own feature. The
    other 8 to 9 units of those files stop at module imports.
- **The frozen anchor** `fixtures/r10b/r10b.fs#r10bTransferEdge`
  (`followup.jsonl`) has a `buildTransferEdge` byte-identical to the camera,
  tray-gap and base-5d2d586d copies.
  - Production: `30:27: … subtraction unresolved: InvalidTopology (stage 1, detail 0)`.
  - With the fix: the edge cut and the apron clip pass. Then:
    1. `AmbiguousContact (stage 2, detail 8)` in the `apronCrest` cut;
    2. `AmbiguousContact` in the `apronUnion`;
    3. the 2 M3 hole cuts (boolean-capability).
  - With those stubbed, it reaches the end: 1 body, 56 faces.
- **The neighbouring cluster's `next-tilted-pocket-subtraction.fs`** fails
  today with `27:9: … InvalidTopology (stage 1, detail 0)`. With the fix, it
  reaches `UnsupportedArrangement (stage 6)`.

| family, file | units | cluster units | next blocker per cluster unit (fix simulated, Booleans stubbed) |
|---|---:|---:|---|
| fs381 `channel-bases-r7.fs` | 1 | 1 | `opLoft` (after 4 input-size refusals) |
| fs556 `project-component-4c7a33fe.fs` | 2 | 2 | `project-component-4c7a33fe`, `project-component-4c7a33fe`: `opFillet` |
| fs549 `jobs/r10b/pass3/camera/r10b.fs`, `…/tray-gap/r10b.fs`, `…/tray-gap/base-5d2d586d.fs`, `cad-project-043/fsocct/cases/r10b/r10b.fs` | 10 each | 1 each | end, after 2 `AmbiguousContact` + 2 M3 hole cuts |
| fs549 `…/pass3/edge-pinion/r10b.fs`, `…/tray-gap/ee691ede-reconstructed.fs`, `jobs/r10b/r10b-uploaded-snapshot.fs` | 10 each | 1 each | end, after the 2 M3 hole cuts only |
| fs549 `dist/R10b_Print_Package/r10b-uploaded-snapshot.fs` | 9 | 1 | the oblique `nose` sweep, which the F32x2 fix must support |
| fs95 `interface-r3.fs` | 16 | 3 | `bottomSpoke`, `switchBracket`: `skText`; `upperRafter`: collinear profile |
| fs95 `interface-r4.fs`, `interface-r5.fs` | 19 each | 4 each | `retainingKey`: `skText`; `switchBracket`, `upperRafter`: `opTransform`; `bottomSpoke`: timeout |
| fs95 `interface-r6.fs`, `interface-r7.fs`, `interface-r8.fs` | 22 to 24 | 3 each | `retainingKey`: `skText`; `switchBracket`, `upperRafter`: `opTransform` |
| fs95 `interface-r9.fs`, `interface-r10.fs` | 24 each | 4 each | `motorBracket`: `opLoft`; `retainingKey`: `skText`; `switchBracket`, `upperRafter`: `opTransform` |
| fs95 `interface-r11.fs`, `interface-r11-prepared.fs`, 4 × `bottom-drive-review-2026-09-19/*/native-source.fs` | 26 each | 3 each | `motorBracket`: `opLoft`; `retainingKey`: `skText`; `upperRafter`: `opTransform` |

### 5.4 Units of other clusters that land here

This cluster is also the next blocker behind other clusters' fixes. Figures
are from their reports:

- **boolean-capability:** 25 units reach the planar arrangement's
  `InvalidTopology`/`UnsupportedArrangement` once all of that cluster's
  refusals are answered (its section 5).
- **kernel-sketch-and-ops:** 18 `InvalidTopology` + 1
  `UnsupportedArrangement` units, across its fixes. Among them:
  - 9 `feederMounts` units after its cap-normal fix
    (`next-tilted-pocket-subtraction.fs`);
  - 8 units after a planar-sided loft.

A unit has exactly one first blocker, so these units are distinct from the 57
here. The F32x2 construction is therefore on the path of up to about 100
corpus units (57 + 25 + 19). The neighbouring figures come from stubbed runs,
and some of those units may stop at this cluster's second level rather than
at stage 1.

## 6. Overlap with work in flight

- **Bake-off `recover`** (`scripts/corpus/boolean-invalid-topology/bakeoff-recover.mjs`,
  `bakeoff-recover.json`). The run uses the harness's own `buildCase`, the
  `recover-extra.py` oracle, `kernel/proto/recover` on the JS target and
  `recover-check.mjs`. Everything was written under
  `tmp/corpus/boolean-invalid-topology/recover`.

  | case | leaves | result |
  |---|---|---|
  | wedge, slanted union, slanted cut, rotated cut | today's wonky operands (F32) | refused at leaf intake: `brep: vertex off its surface by 7.7e-7 / 3.2e-6 / 1.07e-6 / 3.6e-5` (`scripts/bakeoff/tessellate.mjs:488`, limit 1e-9 mm) |
  | the same four | wonky operands from the simulated fix (F32x2) | exact: 11/13/11/6 faces, OCCT valid, `validate-step.py` ok, volume error 2.1e-15 / 1.4e-16 / 1.5e-16 / 5.4e-14 |
  | wedge | bake-off `prism` primitives | exact, 11 faces, error 5.4e-16 |
  | chamfer on the edge, slanted cut in general position | `prism` primitives | exact: 2170 mm³ and 2285.6944 mm³, OCCT valid |
  | third pass, real second-level refusals: anchor `r10b.fs#r10bTransferEdge` `apronCrest` cut (`AmbiguousContact`), `project-component-4c7a33fe.fs` `noseCut` (`AmbiguousContact`), `next-tilted-pocket-subtraction.fs` (stage 6), `interface-r4.fs#upperRafter` first rib union (stage 6) | wonky operands from the simulated fix (F32x2, at most 2.5e-12 mm off their carriers), dumped with `dump-operands.mjs --linearc` | exact: 13/19/11/18 faces, OCCT valid, `validate-step.py` ok; OCCT volumes 1648.155344 / 132241.597523 / 7316.4 / 85766 mm³, within 7.9e-14 (relative) of the harness's independent mesh-Boolean volume. The OCCT exact-CSG oracle needs `out/bakeoff/brep/*.step`, which belongs to the bake-off, so it was not run for these brep leaves. 12 to 26 ms each on the JS target |

  **Conclusions:**
  - `recover` does not touch the root cause: it has the same exact-input
    precondition as the planar arrangement.
  - Once operands are exact, it handles every second-level case tried that
    the planar arrangement refuses (`AmbiguousContact`, stage 6). That
    includes four real ones, among them the frozen anchor's `apronCrest` cut
    on the r10b acceptance path. It also produces far fewer faces: 11 against
    40 for the wedge union, 13 against 52 and 11 against 45.
  - `ResolutionLimit (stage 2)` (R4/R5 `bottomSpoke`) and the input-size
    limit (`channel-bases-r7`) were not tried on `recover`. Their operands
    are 116 to 384 vertices, and building them to that point takes
    minutes on the JS target.
  - For this cluster, the route is therefore: F32x2 construction (this fix)
    first, then `recover` (or the bake-off's final choice) as the arm for
    the planar arrangement's second-level refusals. The alternative is to
    teach the arrangement exact on-plane certification for constructed
    incidences, curtain planes for stage 6, and coplanar-cell merging. That
    duplicates what `recover` already does.
  - The fragmentation matters for chained Booleans, because the arrangement
    admits at most 32 distinct planes and 256 faces per operand.
  - **The bake-off moved during this pass.**
    - `kernel/proto/recover/{geom,topo}.bend` changed at 04:44,
      `clear.bend` at 04:47, and `scripts/bakeoff/recover-*.mjs` from 04:43
      to 04:47.
    - I re-ran all 15 cases after those changes. The results were identical
      (the backup of the earlier run is in
      `tmp/corpus/boolean-invalid-topology/bakeoff-recover.pass3a.json`).
    - The `exact-plane` prototype (exact integer mesh Boolean,
      `docs/proto-exact-plane.md`) also feeds `recover`
      (`recover-hybrid.mjs --source exact-plane`). But leaves reach any mesh
      engine through the same B-rep intake (`scripts/bakeoff/tessellate.mjs:488`,
      1e-9 mm, unchanged since 2026-09-22 21:16).
    - So whichever mesh engine wins, F32 operands are refused at intake,
      and F32x2 construction remains the prerequisite.
- **Native binding** (`src/native/**`, `docs/native-bridge.md`).
  - `WONKY_BACKEND=native` runs the same Bend, bit-identical to JS, so the
    failure is identical. This run used only the JS path.
  - Its step 3 (`extrudePolygon`, `frustum`, `transform` with carriers, exact
    bodies from construction) is the natural home of this fix's API. Both
    need one agreed golden list for the last-bit changes.
- **Language work:** it does not solve or change the failure. But its WK
  precision contract encodes today's F32 construction, and its oracle calls
  the same adapters, so it must move with the fix (see 4, Risk).
- **Viewer:** no overlap. The refusal is raised in the
  kernel and reported correctly by the CLI.

## 7. Side findings

- **The planar arrangement over-fragments faces.** It publishes convex cells
  without merging coplanar neighbours. The wedge ∪ box has 11 faces, but it
  makes 40. The controls that build today show the same: 40 faces for the 45°
  wedge union and 42 for the rectangle union. Chains of Booleans exhaust the
  32-plane and 256-face limits early. `upperRafter` needs about 20 Booleans on
  one body.
- **Refused Booleans are slow on the JS target.** With the fix simulated, the
  R4/R5 `bottomSpoke` units spend over 900 s in 8 Booleans on 116-vertex
  operands, most of them refusals (`ResolutionLimit`, stage 6). An
  `upperRafter` unit takes 165 to 400 s. The refusal comes only after the
  arrangement has been built, so it costs as much as a success. This is the
  "JS target is slow" item of the viewer audit, seen from this cluster.
- **Polygonized arcs.** `channel-bases-r7.fs` is generated code, with arcs
  written as 96 to 192-point polylines. In the planar arrangement it can never
  fit (≤ 32 distinct planes). In the source, `skArc`, which wonky's line/arc
  extruder supports, would be the better form.
- **The stage-1 refusal code conflates family and size** (see 4, item 4).
- **A slip while writing the scripts.** One shell command contained a bare
  `python3 --version` check, redirected to `/dev/null`. It ran no model code,
  and all Python work in this pass went through `uv run`.

## 8. Reproduce

```sh
# repros on the production CLI (at most 3 processes, uptime per record)
node scripts/corpus/boolean-invalid-topology/run-cmds.mjs --jobs <jobs.jsonl> --out <out.jsonl> --timeout 300
node bin/wonky.mjs fixtures/corpus-repro/boolean-invalid-topology/wedge-union.fs --check --feature slanted
# admission diagnosis and the simulated fix on one file
node scripts/corpus/diagnose-planar-admission.mjs <file.fs> [feature] [--simulate linearc|carriers,transform]
# the whole cluster (reads ~/Workspace/cad in place, read only)
node scripts/corpus/diagnose-cluster.mjs --out out/corpus/boolean-invalid-topology/simulate-linearc.jsonl --timeout 480 --extra "--simulate linearc"
WONKY_CORPUS_STUB=pass-all node scripts/corpus/diagnose-cluster.mjs --out out/corpus/boolean-invalid-topology/next-linearc-pass-all.jsonl \
  --script scripts/corpus/boolean-invalid-topology/next-blockers.mjs --extra "--simulate linearc" [--keys <file>] [--skip-done]
node scripts/corpus/summarize-admission.mjs
node scripts/corpus/boolean-invalid-topology/files.mjs
node scripts/corpus/boolean-invalid-topology/summarize.mjs
# operands and the bake-off recover route
node scripts/corpus/boolean-invalid-topology/dump-operands.mjs <file.fs> [feature] --out tmp/corpus/boolean-invalid-topology/operands/<name>.json.gz [--call N] [--linearc]
node scripts/corpus/boolean-invalid-topology/bakeoff-recover.mjs
# third pass: the next-blocker table over all 57 units, the anchor and the tilted pocket
node scripts/corpus/boolean-invalid-topology/next-table.mjs
node scripts/corpus/boolean-invalid-topology/run-cmds.mjs --jobs tmp/corpus/boolean-invalid-topology/followup-jobs.jsonl \
  --out out/corpus/boolean-invalid-topology/followup.jsonl --timeout 600 --env WONKY_CORPUS_STUB=pass-all
```
