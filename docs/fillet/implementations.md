# Open-source fillet and chamfer implementations: a code-level study

Part 1 of the fillet landscape (survey, 2026-09-23). This document studies the **code** of open-source fillet/chamfer implementations. The theory papers and the commercial kernels are covered elsewhere (`docs/research/sources/*`). It builds on and does not repeat the deep-read notes for OCCT, monstertruck, remus, keel, vcad, libfive, curv and Manifold. It adds code sizes, the corner machinery, the failure record, licences and a Bend portability estimate for each source.

Evidence labels:

- **DOCUMENTED**: read in source, docs or the issue tracker, with a pointer.
- **MEASURED**: run here, on this machine.
- **INFERRED**: my reasoning from the above.
- **HEARSAY**: forum or landing-page claims I did not verify.

Source snapshots:

| Source | Where | Revision |
|---|---|---|
| OCCT | `tmp/research/occt-intpatch/occt` (sparse: TKFillet, TKOffset, TKBO, TKTopAlgo) | `3d097a03` (2026-08-24) |
| OCCT oracle binary | `cadquery-ocp-novtk 8.0.1.0.0` via `uv run --with build123d==0.13.0` | OCCT 8.0.1 |
| FreeCAD | `tmp/fillet/src/freecad/` (4 files, `main` as of 2026-09-23) | main |
| build123d / CadQuery | uv cache, build123d 0.13.0, cadquery 2.7.0 | releases |
| monstertruck | `tmp/research/monstertruck/repo` | `e6520c2` (2026-09-19) |
| truck | `tmp/research/truck-ricosjp-…` | `8d03d8f` (2026-09-07) |
| remus | `tmp/research/remus-esaueng-remus` | `1dc3763` (2026-09-21) |
| keel | `tmp/research/keel-redwoodrhetorica-keel` | `f8b68bb` (2026-06-30) |
| vcad | `tmp/research/vcad/repo` | `eba7a2e` (2026-09-17) |
| BREP_kernel (brep.io) | `tmp/fillet/src/brep_kernel/BREP_kernel-0.5.0` (crates.io tarball; the GitHub repo returns 404) | 0.5.0 (2026-09-11) |
| Manifold | `tmp/research/manifold` | `36d0aab` (2026-09-22) |
| Blender bevel | `tmp/fillet/src/blender/bmesh_bevel.cc` (`main`, 2026-09-23) | main |
| BRL-CAD | `tmp/research/brlcad-libbrep/brlcad` | `97920fb` (2026-09-21) |
| sdfx, libfive, curv, hg_sdf, SISL | `tmp/research/*` | as cloned |

The OCCT probe script is `tmp/fillet/occt-probe.py`, and its log is local development evidence.

---

## 0. Summary

**Only one open-source code base has production fillets used by many people: OCCT TKFillet.** FreeCAD, CadQuery, build123d, Replicad, CascadeStudio, Salome, Gmsh and most other "open CAD" tools wrap it. Every other open kernel with fillets is 2025–2026 work, mostly LLM-assisted and single-maintainer: remus, keel, vcad, BREP_kernel and monstertruck. None of them has a user base or a track record yet.

**The architecture is the same everywhere (DOCUMENTED).** Every serious B-rep implementation has the same five stages. They differ only in how many of the stages are exact:

1. **Spine / chain building.** Tangent-continuous edge chains, convexity per edge, and the vertex classification (free end, 2-edge "miter", 3+-edge "star", mixed convexity).
2. **Stripe (section) construction** per edge pair:
   - a **closed-form "KPart" ladder** for plane/plane, plane/cylinder, plane/cone (plus sphere pairs in remus);
   - otherwise a **rolling-ball walker**: Newton on the 4-unknown contact system, then a NURBS fit of the sections.
3. **Corner construction** at vertices:
   - exact sphere or torus when the radii are equal and the supports are planar;
   - otherwise a filling surface (Coons/Gregory/Plate), or a refusal.
4. **Topology surgery.** Trim the support faces along the contact rails, insert the blend faces and heal. OCCT does this with the *old* TopOpeBRep Boolean data structure. The newer kernels do direct surgery, or fall back to "tool solid + Boolean".
5. **Validation / fallback.** OCCT reports `IsDone`, faulty contours and faulty vertices. The newer kernels have typed refusals. The wrappers (build123d, FreeCAD) add a `BRepCheck` validity pass on top.

**Where the failures come from (DOCUMENTED plus MEASURED).** Almost none of the recorded failures are in the stripe geometry of the analytic cases. They cluster in:

- **(a) topology changes caused by large radii.** A face is consumed and neighbouring fillets meet ("full round"): OCCT #1177, #172 (Mantis 25478, open for 10+ years), FreeCAD #5561. MEASURED on OCCT 8.0.1: two R5 fillets on opposite edges of a 10 mm box fail, while R4.99 leaves a sliver face.
- **(b) corners** with unequal radii, mixed convexity, or more than 3 edges.
- **(c) periodic seams and closed spines**: OCCT #1507, #1371.
- **(d) tangent terminations and tangent-chain propagation**: OCCT #1537, FreeCAD #20071.
- **(e) degenerate normals and non-termination**: OCCT #1495.
- **(f) input from upstream**, i.e. bad Boolean output or inside-out solids: build123d #1462, monstertruck #24, SolveSpace #1291.

**For wonky (INFERRED), the wheat:**

- the **ChFiKPart ladder**, re-derived as "offset surfaces → SSI → canal surface", which gives exact cylinder, torus, sphere and cone results for the FDM-dominant pairs;
- the **corner-ball-first network** idea: solve every corner before cutting anything (BREP_kernel's `network.rs`, remus `spherical_triangle.rs`, keel `fillet_corner_octant`);
- **explicit topology-change handling** for consumed faces, which is the #1 open failure class in OCCT;
- **typed refusals** (remus/keel);
- **"fillet by Boolean with blend solids"** as a second route on top of the corefine+recover hybrid.

**The chaff:**

- the walking + Plate/Coons path, which is 60k+ lines of numerics with no certificate;
- smooth-min SDF blends: constant thickness, not constant radius;
- mesh bevel / Minkowski, which throws away analytic geometry;
- silent no-op "success" paths (remus, vcad, monstertruck);
- env-var strictness.

---

## 1. Landscape table

Port sizes are wonky Bend lines excluding tests. They are INFERRED order-of-magnitude estimates, explained in §13.

| Implementation | Licence (portability) | Fillet code size | Exact cases | Corners | Failure contract | Port-worthy part | Rough Bend port |
|---|---|---|---|---|---|---|---|
| **OCCT TKFillet** (ChFi3d, ChFiKPart, BRepBlend, BlendFunc, ChFiDS) | LGPL-2.1 + OCCT exception. Oracle only; re-derive algorithms, never translate code | 75,616 `.cxx` lines. With headers: ChFi3d 38.4k, BRepBlend 18.0k, BlendFunc 10.6k, ChFiKPart 6.0k, ChFiDS 5.8k, ChFi2d 5.6k, BRepFilletAPI 2.2k. Plus GeomPlate/GeomFill/TopOpeBRep (not in the sparse checkout) | plane/plane→cylinder, plane/cyl→cylinder or torus/sphere, plane/cone→torus/sphere; chamfers →plane/cone (sym., 2-dist., dist-angle) | 3 equal radii→sphere (`ChFiKPart_Sphere`), torus corner (`ToricCorner`), torus "rotule" (3 planes), else GeomFill/GeomPlate | `IsDone`, `NbFaultyContours/Vertices`, `StripeStatus` ∈ {Ok, Error, WalkingFailure, StartsolFailure, TwistedSurface}; exceptions caught per stripe/vertex | KPart formulas (re-derived), eligibility table, ChFiDS vocabulary, vertex dispatch | KPart ladder ~1.5–2.5k |
| **FreeCAD** PartDesign/Part Fillet | LGPL-2.1+ | ~950 lines of feature glue (`FeatureFillet.cpp` 184, `FeatureChamfer.cpp` 327, `FeatureDressUp.cpp` 439) + `TopoShape::makeElementFillet` | = OCCT | = OCCT | catch-all message + `BRepAlgo::IsValid` + `ShapeFix_ShapeTolerance` | failure record (528 issues mention fillet) | 0 (UX lessons only) |
| **build123d / CadQuery** | Apache-2.0 | ~100 lines each around `BRepFilletAPI_MakeFillet(2d)/MakeChamfer` | = OCCT | = OCCT | `ValueError("try a smaller value or use max_fillet()")`; `is_valid` gate | `max_fillet()` semantics, edge-selector idioms | ~100 (API semantics) |
| **Replicad** | MIT | thin wrapper over opencascade.js | = OCCT | = OCCT | JS exception | per-edge radius *function* API | API idea only |
| **monstertruck** `monstertruck-fillet` + truck `rbf_surface` | Apache-2.0 | 5,193 (crate incl. tests) + 1,675 (decorators) | none exact: everything becomes an approximate NURBS (≈3 % of r in its own accuracy test) | none | `FilletError`, but silently skips failed edges | contact-circle solver (3×3 + Gauss-Newton), Leibniz derivatives, adaptive fit | solver ~400; fit ~800 |
| **remus** `crates/blend` + `operations/src/fillet` | Apache-2.0 (≤ brepkit v2.129.15; later brepkit is AGPL) | blend 19.4k non-test (analytic.rs 5.4k), operations/fillet 5.5k, blend_ops 1.7k, chamfer 1.9k | 9 fillet pairs incl. sphere pairs and parallel cyl/cyl → Cylinder/Torus; chamfers → Plane/Cone | 3+ stripes equal radius → exact sphere triangle; else `UnsupportedVertexBlend` | typed `BlendError` with stable codes, `fillet_cascade` transactions; but two silent no-op layers | analytic pair list + convexity table + radius bounds; failure codes | covered by the KPart port |
| **keel** `blend.rs` | GPL-3.0-or-later: ideas only (clean-room) | 7,847 lines | plane/plane cylinder, cap-rim torus, chamfer cone, partial-span cone runout, mitre ellipse, octant sphere | octant sphere (equal r, 3 planes), Varady–Rockwood setback + Charrot–Gregory (6 certified bicubic quads) | DECLINE-never-WRONG `Err(TopoError::Precondition)` | the ladder decomposition, mitre-ellipse and setback recipes | ideas only |
| **vcad** `vcad-kernel-fillet` | Apache-2.0 | 5,822 lines | plane/plane (whole convex planar solids), plane/cyl, coaxial cyl/cyl; NURBS rolling ball otherwise | vertex-by-vertex setbacks `r/tan(θ/2)` on convex polyhedra | `FilletResult{Success, Unsupported, RadiusTooLarge, DegenerateGeometry}`; unchecked API returns input unchanged | all-edges-of-convex-polyhedron planner | ~500 |
| **BREP_kernel / brep.io** (mmiscool) | custom "Autodrop3d" licence: modifications must be assigned back to the company. **Not portable**; read for ideas only | 159.9k lines total; `src/blending` 20.8k (network.rs 2.9k, corner/* 4.1k, chain/* 2.7k, edge/* 4.4k, stations 1.1k, fillet/* 3.4k) | cylinder / surface of revolution where stations are rigid translates/rotations; else fitted | **stripe network**: corner ball solved first; star → sphere patch, miter → marched seam, re-entrant → horn torus; refusals by name | named refusals; env-var debug switches; "tool + Boolean" fallback lane | corner-ball-first ordering; tool-solid fallback as a *documented* lane | ideas only |
| **SolveSpace** | GPL-3.0 | none (WIP #1501 abandoned) | — | — | — | the Boolean tangent-fillet regression scenarios (#1291) | — |
| **Fornjot** | 0BSD | none (project shut down) | — | — | — | — | — |
| **BRL-CAD** | LGPL-2.1 / BSD | none; TODO lists "edge feature edit objects" and "SDF blending" | — | — | — | — | — |
| **CGAL** | GPL-3/LGPL-3 (per package) | no 3D fillet; exact 2D `offset_polygon_2` (conic arcs), `approximated_offset_2`, Nef Minkowski | 2D offsets exact (rational r) | — | — | exact 2D rounded offset for sketch/profile fillets | ~300 for arc-line offset |
| **Manifold** | Apache-2.0 | `minkowski.cpp` 200, `smoothing.cpp` 869, `CrossSection::Offset` (Clipper2) | none (mesh) | — | status codes | robust mesh Minkowski as a clearance oracle | not for fillets |
| **OpenSCAD / BOSL2 / JSCAD** | GPL-2 / BSD-2 / MIT | `minkowski()`, `offset(r)`, BOSL2 `rounding.scad` (`round_corners`, `offset_sweep`, `rounded_prism`, `join_prism`, edge masks), JSCAD `expand`, `roundedCuboid` | 2D offsets only | — | — | "construct the rounding in the profile" idiom (FDM!) | profile-fillet API ~200 |
| **Blender bevel** `bmesh_bevel.cc` | GPL-2.0+: ideas only | 8,485 lines | mesh: superellipse/custom profiles | vmesh kinds NONE/POLY/ADJ/TRI_FAN/CUTOFF, cube-corner and tri-corner special cases | clamp-overlap offset limiting | collision-limit formulas (`geometry_collide_offset`) | ~200 (as a max-radius predictor) |
| **SDF family**: sdfx, libfive, curv, hg_sdf, fidget | MIT / MPL-2 (+GPL-2 studio) / Apache-2 / **CC BY-NC** / MPL-2 | a few lines each (`RoundMin`, `ChamferMin`, `PolyMin`, `blend_expt`, `lib.blend` 593 lines) | exact quarter circle only for exact-distance fields meeting at 90° | automatic (field) | none | cheap visual/volume oracle in `kernel/proto/sdf` | ~100–300 |
| **SISL** | AGPL-3.0: ideas only | 2D fillet curves (s1607–s1611…), n-sided blend surfaces | circular fillets in 2D | 3–6-sided G1 blend (7.1.11) | — | — | — |

---

## 2. OCCT TKFillet (the reference implementation)

### 2.1 Architecture (DOCUMENTED, code)

Front ends:

- `BRepFilletAPI_MakeFillet`: `Add(R,E)`, `Add(R1,R2,E)`, `Add(Law_Function,E)`, `Add(UandR[],E)`, `SetRadius(…, IC, IinC)`, `SetFilletShape(Rational|QuasiAngular|Polynomial)`, `SetParams(Tang,Tesp,T2d,TApp3d,TolApp2d,Fleche)`, `SetContinuity`, `Simulate`, `NbSurfaces`, `NbFaultyContours`, `FaultyVertex`, `HasResult`, `BadShape`, `StripeStatus` (`BRepFilletAPI_MakeFillet.hxx:65-380`).
- `BRepFilletAPI_MakeChamfer`: `Add(d,E)`, `Add(d1,d2,E,F)`, `AddDA(d,angle,E,F)`.
- `BRepFilletAPI_MakeFillet2d` on `ChFi2d`: an analytic algorithm for lines and arcs (`ChFi2d_AnaFilletAlgo`, 1,101 lines) and an iterative Newton algorithm for arbitrary planar curves (`ChFi2d_FilletAlgo`, 977 lines).

Data model (`ChFiDS`, 5.8k lines):

- `ChFiDS_Spine` / `FilSpine` (radius law) / `ChamfSpine`: a maximal G1 edge chain with start/end `ChFiDS_State` ∈ {OnSame, OnDiff, AllSame, BreakPoint, FreeBoundary, Closed, Tangent}.
- `ChFiDS_ElSpine`: the elementary guideline actually walked.
- `ChFiDS_Stripe`: the ordered `SurfData` sequence of one spine plus face orientations and a side "choix".
- `ChFiDS_SurfData` (`ChFiDS_SurfData.hxx:155-179`) holds:
  - the fillet surface index in the DS;
  - two `ChFiDS_FaceInterference` records (contact curve 3D + pcurve on the face + pcurve on the fillet + parameters);
  - four `ChFiDS_CommonPoint` records (first/last on S1/S2, with "on arc" data when the contact runs onto an edge);
  - spine parameter range, extension lengths and twist flags.
- `ChFiDS_TypeOfConcavity` ∈ {Concave, Convex, Tangential, FreeBound, Other, Mixed}.
- `ChFiDS_ErrorStatus` ∈ {Ok, Error, WalkingFailure, StartsolFailure, TwistedSurface}.

Driver (`ChFi3d_Builder::Compute`, `ChFi3d_Builder.cxx:162-330`):

1. Map vertices to the stripes that end there (`myVDataMap`), and extend free ends (`ExtentOneCorner`).
2. `ExtentAnalyse`.
3. `PerformSetOfSurf` per stripe inside `try/catch`. Failures go to `badstripes` with a status.
4. Only if every stripe succeeded: `PerformFilletOnVertex(j)` per vertex, again inside `try/catch`, collecting `badvertices`.
5. Pairwise `ChFi3d_StripeEdgeInter` checks (fillet/fillet intersection, "OCC119").
6. `ChFi3d_FilDS` to push each stripe into a `TopOpeBRepDS` data structure.
7. `CompleteDS`, then reconstruction by `TopOpeBRepBuild`, i.e. the pre-GFA Boolean machinery.

PRs #1293 and #1449 (2026) inserted `ChFi3d_RemoveConsumedFaces` here. DOCUMENTED: https://github.com/Open-Cascade-SAS/OCCT/pull/1293, https://github.com/Open-Cascade-SAS/OCCT/pull/1449

### 2.2 KPart: the closed-form cases (DOCUMENTED, `ChFiKPart_ComputeData.cxx`)

The per-stripe dispatch is `ChFiKPart_ComputeData::Compute`, called from `ChFi3d_Builder_2.cxx:3142` after `ChFi3d_KParticular` (eligibility, `ChFi3d_Builder_0.cxx` L598-680) says yes. The eligibility table and the plane/plane, plane/cylinder (line and circle spine) and plane/cone formulas are in `docs/research/sources/occt-modeling-algorithms-guide-and-tkfillet-chfi3d-fillets-c.md`.

The file inventory (5,389 `.cxx` lines) shows exactly which cases exist:

| File | Lines | Output surface |
|---|---|---|
| `FilPlnPln` | 174 | cylinder |
| `FilPlnCyl` | 599 | cylinder (axis ∥ plane, line spine) / torus or sphere (cap rim, circle spine) |
| `FilPlnCon` | 341 | torus or sphere (circle spine, axis ⊥ plane) |
| `ChPlnPln`, `ChAsymPlnPln` | 272, 266 | plane |
| `ChPlnCyl`, `ChAsymPlnCyl` | 595, 656 | plane (line spine) / cone (circle spine) |
| `ChPlnCon`, `ChAsymPlnCon` | 409, 708 | cone |
| `Sphere` | 207 | sphere corner patch, "contours not all isos" |
| `Rotule` | 172 | torus "ball joint" between three planes |
| `CS` / `Fcts` | 73 / 155 | helpers (pcurves, spine circle) |

Every other pair (`Compute`, L51-632) ends in `throw Standard_NotImplemented("particular case not written")`. That throw is unreachable in practice because `KParticular` gates the call. INFERRED: the gate and the dispatch are two separate switch statements that must agree, a classic drift hazard. remus's exhaustive `match` with a compile error for new variants is the better pattern (`blend/src/analytic.rs:108-217`).

### 2.3 Corners (DOCUMENTED, `ChFi3d_Builder.cxx:602-724`, `ChFi3d_FilBuilder_C2/C3.cxx`, `ChFi3d_Builder_C1.cxx`, `_CnCrn.cxx`)

`PerformFilletOnVertex` dispatches on the number of stripes `i` ending at the vertex and on the number of sharp edges `nba`:

| Stripes at vertex | nba ≤ 3 | nba > 3 |
|---|---|---|
| 1 | `PerformOneCorner` (the fillet runs into the end face; three sub-cases in the header comment, "22/07/94 only 1st is implemented"), or `PerformMoreSurfdata` | `PerformIntersectionAtEnd` |
| 2 | `PerformTwoCorner` | `PerformMoreThreeCorner` (Plate) |
| 3 | `PerformThreeCorner` | `PerformMoreThreeCorner` |
| ≥ 4 | `PerformMoreThreeCorner` | same |
| degenerate (all stripes collapse at the point) | `PerformSingularCorner` | "Last chance…" `PerformMoreThreeCorner` |

`PerformThreeCorner` (`FilBuilder_C3.cxx:227`):

- If the three spine ends meet at a point (`c1pointu`), test `ToricCorner` (`:205`): equal end radii, and the pivot face a plane whose X/Y axes are ⊥ the end tangent. If it passes, build an **exact torus corner** through `ComputeCorner(…, minRad, majRad, …)`.
- Otherwise, if all three radii are equal within `tolapp3d`, build an **exact sphere corner** (`ChFiKPart_Sphere`).
- Otherwise, compute a **circular guideline** (`ChFi3d_CircularSpine`) and walk a fillet along it ("Numerous problems with loops and half-turns connected to the curvature of the guideline !!!!!!", source comment).
- If that fails, use `GeomFill_ConstrainedFilling(8,20)` from 3–4 `GeomFill_Boundary` pieces.
- Several base faces, or several `SurfData` on the pivot, send it to Plate.

`PerformTwoCorner` (`FilBuilder_C2.cxx:131`) uses `ToricRotule` → `ChFiKPart_MakeRotule` (a torus between three **planes** only), else `GeomFill_ConstrainedFilling`. The comment "If two edges to rounded are tangent GeomPlate is called" (`:177`) marks the next fallback.

`PerformMoreThreeCorner` (`CnCrn.cxx:1229`, 3,895 lines) builds `GeomPlate_BuildPlateSurface(degree, nbcurvpnt, nbiter, tol2d, tolapp3d, angular)` from `GeomPlate_CurveConstraint`s (`:2706-2735`), then approximates it with `GeomPlate_MakeApprox` into a B-spline. There is no certificate beyond the approximation tolerance.

INFERRED consequence: OCCT's corners are exact only for (a) three equal-radius stripes (sphere), (b) the torus corner with a planar pivot, and (c) the planar torus joint. Every other corner (unequal radii, mixed convexity, 4+ edges, curved pivots) is a numeric filling surface. That matches its bug record.

### 2.4 What I measured (MEASURED, OCCT 8.0.1 through build123d 0.13.0, `occt-probe.log`)

| Case | r | Result |
|---|---|---|
| 10 mm box, two opposite top edges | 4.99 | OK, 2 CYLINDER + 6 PLANE: a 0.02 mm sliver of the top face survives |
| same | 5.0 (full round) | **NOT DONE**, faultyVertices = 2 (the #1177 / #172 class, still present) |
| 10 mm box, all 12 edges | 1 | OK: 12 CYLINDER + 8 SPHERE (corner = `ChFiKPart_Sphere`), volume 975.5870 = closed form 1000 − 12(1−π/4)·8 − 8(1−π/6) = 975.587 |
| same | 4.99 | OK (volume 525.169) |
| same | 5.0 | NOT DONE, faultyContours = 1 |
| single box edge | 9.999 / 10.0 | OK (volume 785.44 = 1000 − (1−π/4)·100·10) / NOT DONE |
| Ø10 boss on plate, concave rim | 1, 3 | OK → TORUS (plane/cyl circle spine) |
| Ø10 cylinder, convex cap | 1 / 4.999 | OK → TORUS |
| same | 5.0 (= R_cyl) | OK → **SPHERE**; the top plane is consumed and the result is valid. So the circle-spine KPart handles face consumption, while the plane/plane case does not. |
| T of two perpendicular cylinders, intersection edge | 1 | OK → 1 **BSPLINE** face (walking path), 27.7 ms |

All analytic cases run in 1–13 ms. INFERRED: the analytic ladder is cheap; the time is in walking and topology.

### 2.5 Why it fails: the issue record (DOCUMENTED)

The GitHub tracker only covers 2024 onward; the older Mantis tracker holds the long tail. `repo:Open-Cascade-SAS/OCCT fillet` gives 47 issues/PRs, 23 open (gh search, 2026-09-23). They group into:

- **Consumed faces / full rounds.**
  - #172 (2024, citing Mantis 25478 from about 2015): "fillets touch each other directly … OCCT thrown … 'BRep_API: command not done'". The reporter calls it "the most important problem now in FreeCAD".
  - #1177 (open): R10 on a 10 mm box fails, R9.999 works.
  - PRs #1293 and #1449 add `ChFi3d_RemoveConsumedFaces`, tangential-vs-transversal intersection acceptance, merging of coincident curve endpoints and marking of collapsed edges as degenerate. They were not effective in my 8.0.1 probe; whether 8.0.1 includes them is not checked (INFERRED).
- **Periodic seams and closed spines.**
  - #1507 (open PR): the walker "treated the seam as a geometric boundary while downstream reconstruction received unsplit pcurves spanning discontinuous UV charts" (FreeCAD #28544).
  - #1371: a closed rational B-spline rim reports `IsDone` and returns a self-intersecting solid.
  - #1501: closure continuity of a periodic spine.
- **Tangent terminations.** #1537 (open PR, 2026-09-14): a fillet ending tangent to a cylinder "always fails leaving self-intersecting geometry" (FreeCAD #29476). The fix registers the end on the existing tangent boundary edge instead of adding an overlapping extension.
- **Degenerate normals / non-termination.** #1495: `StoreData` halving loop with an `int` counter. #847: `Add` hangs.
- **Crashes.** #1421, #1430, #1163 (`IntersectMoreCorner` segfault on stale topology), #725/#738 (ellipse), #690–#693 and #899/#900 (sweeps with fillets).
- **Misc.** #1427 tapered surface; #736/#737 artefacts and "bending the wrong way"; #1494 progress range ignored; #1522/#1521 defeaturing cannot remove a corner round.

### 2.6 Portability to Bend (INFERRED)

- **Translate nothing.** The licence (LGPL) and the style (mutable handles, exceptions as control flow, `TopOpeBRepDS`) both rule it out.
- **Re-derive:**
  - the KPart constructions: offset plane/cylinder/cone → closed-form SSI → cylinder/torus/sphere with conic contact rails;
  - the eligibility table;
  - the vertex dispatch vocabulary (1/2/3/n stripes × nba);
  - the corner special cases: sphere at 3 equal radii, the torus corner, the rotule.

  These are pure functions of a few `Vec3` and `Real` values: F32x2-friendly, no iteration, trivially fork-join across stripes.
- **Do not port** walking + GeomPlate + TopOpeBRep, which is about 65k lines plus dependencies. The residual system `BlendFunc_ConstRad` (E1..E4) is worth keeping only as the spec for a future general-pair solver (§6).

---

## 3. FreeCAD (OCCT consumer, failure record)

**Code (DOCUMENTED, `tmp/fillet/src/freecad/FeatureFillet.cpp`).** `Fillet::execute`:

1. edges = `UseAllEdges ? all : getContinuousEdges(base)`. Face selections are expanded to edges in `DressUp`.
2. `TopoShape::makeElementFillet` → `BRepFilletAPI_MakeFillet.Add(r, r, E)` for each edge (`TopoShapeExpansion.cpp:4148`).
3. On Linux, a `Base::SignalException` guard around the call, because OCCT can segfault.
4. If `BRepAlgo::IsValid` fails, `ShapeFix_ShapeTolerance::LimitTolerance(Confusion)`. The invalid result is **kept**, with tolerances patched.
5. The optional refine (`refineShapeIfActive`).
6. The single-solid rule.
7. `catch(...)` → "The selected edges may contain geometry that cannot be filleted together. Try filleting edges individually or with a smaller radius."

Chamfer passes `(d1,d2)` or `AddDA(d, angle)` with a reference face (the `Flip` option picks the other adjacent face).

**Failure record (DOCUMENTED, gh search 2026-09-23).** 528 issues mention "fillet", 197 have it in the title.

- Top threads by comments:
  - #25134 fillet crash regression in 1.1 (41 comments);
  - #5723 variable-radius request (37);
  - #8549 "Fillet is bumpy on edge of cylinder" (30);
  - #21173 fillet after a subtractive pipe (21);
  - #5634 Pad → Fillet → Thickness gives invalid geometry (21);
  - #20071 fillets/chamfers "automatically propagated to edges tangent to selection" (19);
  - #5561 "Fillet can not round a face" (17);
  - #31868 "no suitable edges" on a suitable edge (16);
  - #26152 fillet bends inside (16);
  - #20889 STEP export wrong for fillets (16);
  - #29476 connected faces disappear (14);
  - #21665 tapered surfaces depending on angle (12);
  - #16654 fails on a refined shape where it works before refinement (12).
- Error text reported by users: `BRep_API: command not done` (#19255: "not a clear or actionable error message").
- User workarounds (HEARSAY-level, from issue threads and search): reduce the radius; fillet edges one by one; fillet before Booleans; select faces instead of edges; re-sketch the rounding into the profile.

**Lessons for wonky (INFERRED):**

1. A fillet must report *which* edge or vertex failed and *why*, in the result.
2. Tangent-chain propagation must be explicit and reported (#20071).
3. Refine (unify same-domain faces) changes fillet feasibility (#16654), so wonky's topology must keep faces merged canonically *before* fillet.
4. Keeping an invalid result with patched tolerances, as FreeCAD does, is exactly the silent-wrong behaviour wonky forbids.

---

## 4. CadQuery, build123d, Replicad (OCCT wrappers; semantics)

**build123d 0.13.0 (Apache-2.0), DOCUMENTED from `topology/three_d.py:222-380, 548-625`:**

- `Solid.fillet(radius, edge_list)` → `BRepFilletAPI_MakeFillet`, `Add(radius, e)` for each edge. Afterwards `_make_3d_result`, then `if not new_shape.is_valid: raise Standard_Failure`, so an **invalid result is rejected** (unlike FreeCAD). Error: `ValueError("Failed creating a fillet with radius of {r}, try a smaller value or use max_fillet() …")`.
- `chamfer(length, length2, edge_list, face)` measures `length` on the given face, or on the *first* ancestor face from `MapShapesAndAncestors` when none is given. INFERRED: an asymmetric chamfer's side is effectively arbitrary without `face`.
- `max_fillet(edges, tolerance=0.1, max_iterations=10)` is a **binary search** over `[0, 2·bbox.diagonal]` that calls the full fillet each time. INFERRED: it assumes success is monotone in r, which the failure record does not guarantee: fillets fail at *specific* radii (Zoo #12429: a 2 mm fillet works on a 20 mm box but not on 18/19/21/22; see the Zoo note). Wonky should compute `max_radius` analytically per stripe (face widths, `r < r_cyl` bounds, collision offsets à la Blender, §10) and return it in the refusal, as remus's `RadiusTooLarge{max_radius}` and vcad's do.
- The 2D `fillet(vertices)` on sketches/faces uses `BRepFilletAPI_MakeFillet2d` (ChFi2d).
- Issue #1224 (open, 2026-02) prototypes a fallback that re-runs each edge individually to find which ones fail. Users need per-edge diagnostics OCCT does not give reliably.
- #1462: an outward `offset` returned a REVERSED-flagged solid that `fillet` cannot handle. The fix, `_forward_solid`, normalises orientation before filleting. Lesson: input orientation normalisation is part of the fillet contract.
- Selection idioms seen in the corpus (DOCUMENTED in build123d docs; INFERRED to be common): `part.edges().filter_by(Axis.Z)`, `.group_by(Axis.Z)[-1]`, `edges(Select.LAST)` (edges created by the last operation). The corpus triage K12 lists these as the path into fillet.

**CadQuery 2.7.0 (Apache-2.0).** `Mixin3D.fillet(radius, edgeList)` (`occ_impl/shapes.py:3717`) and `chamfer` are the same wrapper without the validity gate. `Wire.fillet` (`:2954`) fillets 3D wire corners itself. `Sketch.fillet/chamfer` use `MakeFillet2d`. Workplane `.edges("|Z").fillet(r)` is the common idiom.

**Replicad (MIT; opencascade.js).** `fillet(radiusConfig, filter?)`: `radiusConfig` is a number, a **function `(edge) => radius | null`**, or `{filter: EdgeFinder, radius}`. Finders include `inDirection`, `ofCurveType`, `ofLength`, `containsPoint`, `atAngleWith`, `parallelTo`, `inPlane` (DOCUMENTED, replicad.xyz API). INFERRED: the per-edge radius function is the right primitive for LLM-written code, and maps to FeatureScript's per-edge radius overrides.

Portability: these are API semantics only, ~100–200 Bend/JS lines (selector → edge set → per-edge radius → one kernel call returning a typed per-edge report).

---

## 5. truck / monstertruck (Apache-2.0)

Detailed in `docs/research/sources/monstertruck-truck-fork-monstertruck-fillet-crate.md`. Code-level additions:

- **Upstream truck** (`8d03d8f`) has only the geometry decorators: `truck-geometry/src/decorators/rbf_surface/{mod,algo,contact_circle}.rs` and `af_surface.rs`, plus the `filleted-cube` example. There is no operation. monstertruck extracted the operation into `monstertruck-fillet` (5,193 lines incl. tests: `edge_select.rs` 740, `ops.rs` 642, `geometry.rs` 633, `topology.rs` 399, `convert.rs` 169). The decorators are 1,675 lines.
- **Exact cases:** none. Every blend becomes an approximate NURBS, even plane/plane.
- **Corners:** none; only planar-box multi-edge fixtures.
- **Failure modes:**
  - swallowed per-edge failures (`edge_select.rs:575`, checkpoint restore at `:700-701`);
  - 64×64 bilinear surface fallback;
  - `flip_side` tries both orientations;
  - `unwrap` on contact existence;
  - the flagship example cannot get through its own Boolean (#24).
- **Quality:** small and readable Rust. The decorator math is the best-documented general rolling-ball code in the open (Leibniz derivative recursion, closed-form sphere/sphere oracle test).
- **Bend portability** (INFERRED):
  - the contact-circle solve (3×3 linear system + 2×2 Gauss-Newton projection, bounded iterations): ~300–400 Bend lines;
  - the adaptive section fit: ~600–800, but it needs a NURBS/rational-Bezier surface type wonky does not have.

  Uniform per-station work, fork-join friendly. Existence and side decisions need exact predicates.

---

## 6. remus (Apache-2.0, LLM-built, 0 external users)

Detailed in `docs/research/sources/remus-esaueng-remus.md`. Code-level additions (DOCUMENTED):

**Sizes** (non-test): `crates/blend` 19,444 lines. Largest files:

| File | Lines |
|---|---|
| `analytic.rs` | 5,374 |
| `fillet_builder.rs` | 3,481 |
| `trimmer.rs` | 1,701 |
| `corner.rs` | 1,261 |
| `builder_utils.rs` | 1,241 |
| `walker.rs` | 1,120 |
| `blend_func.rs` | 1,013 |
| `chamfer_builder.rs` | 989 |
| `query.rs` | 625 |
| `spherical_triangle.rs` | 504 |
| `face_face.rs` | 461 |
| `radius_law.rs` | 431 |
| `g1_chain.rs` | 404 |
| `spine.rs` | 374 |

Plus `operations/src/fillet/` 5.5k (the v1 `rolling_ball.rs` is 3,770), `blend_ops.rs` 1,660 and `chamfer.rs` 1,925. The analytic tests alone are 5,780 lines.

**Exact ladder** (`analytic.rs:108-217`, exhaustive `match`):

| Pair | Function | Output |
|---|---|---|
| plane/plane | `plane_plane_fillet` :470 | `Cylinder` :570 |
| plane/cylinder | `plane_cylinder_fillet` :758 | `Torus` :1040 |
| plane/cone | :1394 | `Torus` :1632 |
| plane/sphere | :1996 | `Torus` :2231 |
| sphere/sphere | :2580 | `Torus` |
| sphere/cylinder | :2849 | `Torus` |
| sphere/cone | :3123 | `Torus` |
| cylinder/cylinder, **parallel axes only** | :4294 | `Cylinder` :4491 |
| coaxial cone/cone | :4547 | `Torus` |

Matching chamfers produce `Plane`/`Cone`. Everything with a torus or NURBS operand, and non-parallel cylinder or cone pairs, returns `Ok(None)` → walker → NURBS.

**Corners** (`corner.rs`, `spherical_triangle.rs`):

- `MultiEdge(n≥3)` → an exact sphere patch bounded by rational great-circle arcs (`build_spherical_corner`, `build_n_edge_corner`), or a triangle fan.
- The two-edge case is a "simple triangular fill".
- Otherwise `UnsupportedVertexBlend{vertex, stripes}`.
- The sphere centre is computed from the vertex, the normal sum and r. The code tolerates "actual sphere radius may differ from the fillet radius when the faces are not [orthogonal]" (`spherical_triangle.rs:52-115`). INFERRED: that is an approximation for non-orthogonal trihedra, unlike keel's and BREP_kernel's corner-ball solve (the intersection of three offset planes/surfaces).

**Engine cascade** (`blend_ops.rs:1095-1240`, skill `fillet-blend`): v2 walking (tries the v1 rolling-ball rebuild first for planar-line selections) → v1 rolling ball → per-group split, each attempt transactional. The result discloses `BlendResult::engine`.

**War stories** (skill `fillet-blend/reference.md`):

- **Silent no-op.** `try_fillet` / `fillet_solid` return the input solid as success when every edge is filtered out or every engine fails. "'Ran without error' plus 'solid verifies' both green-light a no-op." The detection recipe is to assert that (F,E,V) and volume changed.
- **Closed rounded-rect rim.** Filleting all peak edges leaves free edges (open bug).
- **Trimmer.** `split_edge_at` can leave a shared cap edge unsplit (latent).
- **Straight-edge fillets degrading to NURBS** are treated as a regression.

**Numbers that are useful as-is:**

- the plane/cylinder convexity table: `convex = plane_bounded == material_inside_cylinder`;
- the inward radius bound `r < r_c − ε` (instead of keel's `r_c > 2r`), with its spindle-torus argument (`analytic.rs:816-868`);
- `dihedral_half_angle = (π − ∠(n1,n2))/2` (`:361`). The wrong half-angle put contacts ≈100·r away on a 178.9° ridge.

**Bend portability** (INFERRED): the analytic pair set maps 1:1 onto the KPart ladder port (§13, P1). The sphere pairs are only needed once wonky has spheres; FDM parts rarely fillet against a sphere. The walker and trimmer are OCCT-shaped mutable-arena code; take ideas only. The failure-code vocabulary can be adopted directly (Apache-2.0, attribution in NOTICE).

---

## 7. keel (GPL-3.0-or-later: clean-room ideas only)

`crates/keel-topo/src/blend.rs`, 7,847 lines (DOCUMENTED, doc comments at the listed lines). It is a **ladder of narrowly scoped local operations**. Each is a separate public function that DECLINEs outside its scope:

| Function | Construction |
|---|---|
| `blend_cylinder_for_edge` (:145) | plane/plane cylinder: spine = SSI(offset planes) |
| `blend_torus_for_edge` (:445) | cap-rim torus |
| `blend_chamfer_cone_for_edge` (:523) | chamfer cone |
| `fillet_cap_rim` (:1102), `chamfer_cap_rim` (:1308) | cap rims |
| `fillet_edge` (:1765) | box-like: both end vertices must be simple degree-3 corners; convex and concave share one pipeline, forking only on the offset sign |
| `remove_fillet` (:2207) | unblend |
| `fillet_edge_variable` (:2483) | linear radius → exact cone |
| `fillet_edge_g2` (:2621), `fillet_edge_conic` (:2780) | G2 and conic cross-sections |
| `fillet_edge_hold_line` (:2935), `blend_face_face` (:3093) | hold line, face-face blend |
| `fillet_edge_cliff` (:3290) | stop at cliff |
| `fillet_edge_partial` (:3531) | radius tapers to 0 → exact cone runout; square stop face |
| `fillet_edge_chain` (:3753), `fillet_edge_notch` (:3988) | chains, notches |
| `mitre_fillet_corner` (:4389) | two equal-radius cylinders meet on an **exact ellipse** in the bisector plane, `E(θ) = M + (W−M)cosθ + (X−M)sinθ` |
| `fillet_corner_octant` (:4770) | three planar supports, all convex, equal r: the three spines pass through the common point M of the three inward offset planes; a sphere patch about M. Non-perpendicular dihedrals are supported |
| `fillet_corner_setback` (:5117) | unequal radii: Varady–Rockwood setbacks, a hexagonal hole filled by a Charrot–Gregory patch split into 6 bicubic quads, **each fit certified** against the evaluator and DECLINED if out of tolerance |
| `recognize_blends` / `unblend` (:5760-5869) | recognition and removal |

INFERRED assessment:

- The *decomposition* is the most honest in the open-source landscape. Every rung names its exact surface and its precondition.
- The API does not compose: filleting all 12 box edges declines at the first 3-edge corner (keel note, CAPABILITIES §4).
- Code must not be ported (GPL-3). The recipes (mitre ellipse, octant, certified setback patch) are textbook geometry and can be re-derived.

---

## 8. vcad (Apache-2.0)

`crates/vcad-kernel-fillet`, 5,822 lines (DOCUMENTED):

| File | Lines |
|---|---|
| `fillet_curved.rs` | 1,263 |
| `blend_loft.rs` | 968 |
| `lib.rs` | 741 |
| `fillet_subset.rs` | 605 |
| `rolling_ball.rs` | 534 |
| `trim.rs` | 428 |
| `fillet_planar.rs` | 417 |
| `closest_point.rs` | 221 |
| `topology.rs` | 211 |
| `chamfer.rs` | 166 |

- `classify_fillet_case` (`lib.rs:165`): PlanePlane, PlaneCylinder, CylinderCylinderCoaxial (axis dot > 1−1e-10, offset < 1e-6), CylinderCylinderSkew, GeneralCurved (NURBS rolling ball).
- `fillet_all_edges` on convex planar solids: per-edge setback `r/tan(θ/2)` capped at 8r. A knife edge refuses the whole solid. It refuses when trimmed faces would invert: "the rebuilt shell is watertight but *wrong* (it can even gain volume)" (`fillet_planar.rs`).
- The unchecked variant returns the input unchanged ("use `fillet_all_edges_checked` to learn why nothing happened"). This is the silent no-op pattern again.
- `FilletResult{Success, Unsupported{reason}, RadiusTooLarge{max_radius}, DegenerateGeometry}` per edge.
- Known issue #902: tangent fillet rims leave 100–180 unpaired edges (vcad note).

Portability (INFERRED): the per-edge report type and the inversion check ("trimmed face keeps orientation and area > 0") are worth copying, ~100 lines. The rest overlaps the KPart port.

---

## 9. BREP_kernel / brep.io (custom licence: NOT portable, ideas only)

The crate tarball is from crates.io. The GitHub repository `mmiscool/NURBS_BREP_kernel` returns 404 (2026-09-23).

**Licence (DOCUMENTED, `LICENSE.md`).** MIT-like, plus: "Any modifications made to the Software must be submitted to Autodrop3d LLC with an irrevocable assignment of the copyright … Failure to contribute back modifications … voids all permissions." INFERRED: incompatible with wonky; do not copy code.

**Architecture (DOCUMENTED, `src/blending/fillet.rs` doc and `blend/network.rs` doc).**

- Rolling-ball march "with direct topology surgery":
  - the tangency system is solved station by station (`blend/stations.rs`, sagitta-adaptive, "span/16 step keeps continuation inside the tangency Newton solver's convergence basin");
  - the surface is fitted "exactly, as a cylinder patch or a revolution, where the stations are rigid translates or rotations of one section".
- **Stripe network** (`network.rs`, 2,906 lines): "Blending one edge at a time means every blend after the first is built against a solid the previous ones have already cut … That is the origin of both classic failures." Instead:
  - every stripe is marched against the ORIGINAL solid;
  - every corner is solved first (`solve_corner_ball`, `corner/ball.rs`: the residual is each face's offset centre minus the first face's, 3(N−1) rows);
  - each stripe is trimmed at the station where its ball *is* the corner ball;
  - star → corner-sphere patch (exactly tangent, "nothing to intersect"); miter → the blends are trimmed against each other along a marched seam (`miter.rs`); re-entrant → horn torus; tangent pair → flush join; unselected tangent continuation → cap;
  - "Configurations the lane does not construct refuse BY NAME", for example mixed-convexity corners and no-common-ball stars.
- **Fallback lane** (`fillet/tool.rs`, 692 lines):
  - build the cross-section tool;
  - extrude or revolve it along the edge;
  - `Subtract` (convex) or `Union` (concave) through the kernel's Boolean;
  - the same-surface merge is disabled because it "mishandles the resulting ring topology".
  - Remaining corner closures ("mixed-convexity torus sectors and the N≥4 no-common-ball Coons fill") reconstruct the corner from the cutter's output. "Both are on their way out."
- It cites Golovanov's *Geometric Modeling* (§4.9, §6.9–6.11). N. Golovanov is a C3D Labs author, so this is the closest open trace of the **C3D** approach (INFERRED).

INFERRED significance: this is the only open code base that has *tried both* "fillet by Boolean with tool solid" and "direct network surgery", and it records why it is moving away from the Boolean lane: cutters overshooting, corners reconstructed from leftovers by distance heuristics, and order dependence. That is direct evidence for Part 2's bake-off design. The "fillet by Boolean with blend solids" candidate must include the corner pieces in the tool (a tool per *network*, not per edge) to avoid exactly those failures.

---

## 10. Mesh approaches: Manifold, OpenSCAD/BOSL2, JSCAD, CGAL, Blender

- **Manifold (Apache-2.0).**
  - `MinkowskiSum/Difference` (`src/minkowski.cpp`, 200 lines): if either operand is convex, one hull of the vertex-sum cloud; otherwise per-triangle-pair `Hull` of 6 points, unioned by `BatchBoolean`.
  - `SmoothOut(minSharpAngle=52.5, minSmoothness)` / `SmoothByNormals` + `Refine` (`smoothing.cpp`, 869): Bezier-triangle tangent smoothing. This is subdivision rounding, **not** constant radius.
  - `CrossSection::Offset(delta, JoinType::Round)` (Clipper2) gives 2D rounded offsets with arc tolerance.
  - INFERRED: useful as a robust clearance/offset oracle; irrelevant for exact fillets.
- **OpenSCAD (GPL-2).** `minkowski()` (Nef/CGAL, now Manifold-backed), `offset(r=)` 2D, `hull()`.
- **BOSL2 (BSD-2)** `rounding.scad`: `round_corners` (circle / "smooth" continuous-curvature 4th-order Bezier / chamfer), `offset_sweep` (rounded or teardrop extrusion ends), `rounded_prism`, `join_prism` (filleted prism-to-object joints), plus edge masks subtracted along edges.

  INFERRED: the OpenSCAD community's answer to missing fillets is (1) **round in the 2D profile before extruding** and (2) **subtract a mask solid**, i.e. fillet-by-Boolean. Both idioms are FDM-native. (1) is exact and cheap in wonky today: 2D arcs already exist (`sketch-arcs.bend`).
- **JSCAD (MIT).** `expand` (hull of spheres/cylinders around mesh edges), `roundedCuboid`, `roundedCylinder`. No edge fillet (INFERRED from API; not re-read today).
- **CGAL (GPL/LGPL).** No 3D fillet. `offset_polygon_2(P, r, traits)` gives an **exact** offset with conic arcs (rational r); `approximated_offset_2(P, r, ε)` uses circular-arc segments with a guaranteed error ε; `inset_polygon_2` likewise (DOCUMENTED, doc.cgal.org Minkowski_sum_2). INFERRED: the exact-offset idea (the Minkowski sum with a disc, arcs at convex vertices) is the correct model for wonky's 2D profile fillets/offsets. It is small (~300 Bend lines for line/arc profiles).
- **Blender bevel (GPL-2.0+, ideas only)**, `bmesh_bevel.cc` 8,485 lines.
  - Vertex-patch kinds `M_NONE/M_POLY/M_ADJ/M_TRI_FAN/M_CUTOFF` (:257).
  - `adj_vmesh` + `cubic_subdiv` (:4388, :4664).
  - Special cases `make_cube_corner_square(_in)` / `make_cube_corner_adj_vmesh` (:4843-4918) and `tri_corner_test` / `tri_corner_adj_vmesh` (:5002-5050).
  - `pipe_adj_vmesh` (:5197).
  - Superellipse profiles with even-chord spacing (:7627-7787).
  - **Clamp overlap:** `geometry_collide_offset` (:8012) computes, by trigonometry per edge, the offset at which a beveled edge's parallel clone collapses or slides into an adjacent vertex. `bevel_limit_offset` (:8186) clamps globally.

  INFERRED: Blender's collision formulas are the cleanest open statement of "maximum radius before topology changes". Wonky should compute that bound per stripe and use it either to switch to the topology-changing construction (consumed face) or to refuse with `max_radius`.

---

## 11. Implicit/SDF smooth blends: libfive, curv, sdfx, hg_sdf, fidget

- Operators (DOCUMENTED):
  - sdfx `sdf/utils.go:127-170`: `RoundMin(k)` = `max(k, min(a,b)) − |max((k−a, k−b), 0)|`, `ChamferMin`, `ExpMin`, `PowMin` ("weird results, is this correct?"), `PolyMin`;
  - hg_sdf `fOpUnionRound`, `fOpUnionChamfer`, `Columns`, `Stairs`, `Soft`, `Pipe`, `Groove`, `Tongue` (licence **CC BY-NC**: ideas only);
  - libfive `blend_expt`, `blend_rough`, `blend_difference` (`libfive_stdlib.h:50-65`);
  - curv `lib/curv/lib/blend.curv` (593 lines, 14+ kernels) and the article `docs/articles/const_max_thickness_blends.rst`.
- INFERRED geometry: `RoundMin` is an exact quarter-circle fillet of radius k **only** where both inputs are exact Euclidean distances to planes meeting at 90°. At other dihedral angles the round is a circle in (a,b) field space, which in 3D is an ellipse-like section. Curv's article states the general point: SDF blends are constant *maximum thickness*, B-rep fillets are constant *radius*. After min/max CSG the fields are only distance bounds, so blend size varies further.
- Failure modes: none reported as errors. Blends are always "successful", and non-local (they affect everything within k).
- Portability: trivial (~20 lines per operator). `kernel/proto/sdf` already exists, so a smooth-min blend there gives a **visual and approximate-volume oracle** for fillet tests at 90° dihedrals, where it coincides with the exact fillet. It must never be used as the fillet itself.

---

## 12. Kernels without fillets, and why

- **SolveSpace (GPL-3.0).**
  - No 3D fillet. #577 (2020, open, 24 comments) asks for chamfer/fillet tools.
  - #1501 (WIP by maintainer phkahler) planned edge duplication and trim moves; the later update: "my attempt last year didn't pan out and I wasn't even able to make partial shell modifications without problems … Next time I might limit myself to flat surfaces only."
  - Users model fillets as Boolean differences with sketched tools, which is why #1291 (tangent fillet cut, open 4 years, 25 comments) and #1731/#1755/#1760 dominate its Boolean bug tracker.
  - INFERRED root cause: no topology-editing layer (shells are rebuilt from Booleans) and no offset surfaces (only rational Bezier patches ≤ cubic, `solvespace-nurbs…` note). A rolling-ball fillet between curved faces is not a rational Bezier, and partial shell surgery was never built.
- **Fornjot (0BSD).** Never shipped Booleans beyond disjoint groups (#42–#44 closed "not actionable"), so fillets were out of reach. Shut down in 2026. The author's earlier rejection of SDF was motivated by fillet/chamfer-by-edge selection (fornjot notes). INFERRED: a fillet needs working Booleans *and* face surgery; Fornjot had neither.
- **BRL-CAD (LGPL/BSD).** A CSG-primitive (implicit ray-traced) system; B-rep (`libbrep`/openNURBS) is for import and conversion. `TODO:1944-1956` lists "edge feature edit objects … rounds/fillets, cuts/chamfers, and scallops/beads" as a wish. `TODO:2068-2070` says "SDF blending … would then allow automatic implicit blending, chamfer/bevel, rounding, and filleting". INFERRED: without a modifiable B-rep there is nowhere to put a fillet; the TODO's only route is implicit.
- **CADmium / truck-based apps (ELv2).** #53 asked for chamfer/fillet; none existed when the project stalled. HN: "Once Truck (and CADmium) lands stable fillets (surprisingly one of the hardest features to make stable)" (HEARSAY, cadmium note).
- **OpenSolid (MPL-2.0).** Fillets and SSI are TODO. Tangent zero sets end in `HigherOrderZero` (opensolid note).
- **gitcad forge (see note).** Chamfer = intersection with one half-space per convex edge (planar only). A corner-facet volume bug of d³/12 per corner lived in "every chamfer this kernel ever produced" until an invariant test caught it. Early "fillets" were a composite `RoundedPlanar` whose volume came from a formula, without curved B-rep. INFERRED lesson: the half-space chamfer is exact and tiny for convex planar solids, but corners need their own facet logic.

**Common pattern (INFERRED).** Fillets arrive only after (1) a Boolean that survives tangent contact, (2) local face surgery with stable topology, and (3) torus/sphere (or general offset) surfaces. Kernels that lacked any of the three never shipped fillets.

---

## 13. Portability to Bend: constraints and port sizes

### 13.1 Constraints (INFERRED from `kernel/*.bend`)

- **Numbers.** `Real = {hi: F32, lo: F32}` double-word (~48 bits, `kernel/real.bend`). Closed-form KPart constructions (normalisations, one `sqrt` for the offset intersection, conic frames) are fine. Iterative walkers are self-correcting and also fine. *Decisions* are not fine at F32x2 near-zero values and need filtered/exact predicates, like the Boolean does:
  - convex vs concave (sign of `(n1×n2)·t`);
  - "ball fits" (`r < r_cyl`, `r < face width`);
  - "face consumed" (setback ≥ face extent);
  - "corner radii equal" (OCCT uses `tolapp3d`).
- **Surfaces.** Production `Surface` is `Plane | Cylinder | Cone` only (`kernel/analytic.bend:13-16`). `kernel/proto/recover/geom.bend:52` has an `STorus`. **Torus and Sphere are prerequisites** for the plane/cylinder cap rim (the most common FDM fillet) and for sphere corners. That means evaluation, STEP export (`TOROIDAL_SURFACE`, `SPHERICAL_SURFACE`), tessellation, classification, and Boolean support for Part 2's Boolean route. INFERRED: this surface work is likely larger than the fillet constructions themselves (~1–2k Bend lines across display, STEP, classification).
- **No mutation, fork-join.** Every stripe's section geometry is independent given the solid, so compute all stripes and all corner balls in parallel, then do one topology rebuild. BREP_kernel's "nothing is cut until everything is known" rule is also the natural Bend shape; OCCT's sequential DS mutation is not.
- **Topology surgery.** Wonky has `topology.bend`, `identity.bend` and the Boolean's face splitting. The fillet rebuild is "replace faces F_i by trimmed F_i', add blend faces, add corner faces, re-derive loops". That is a pure function from (solid, stripe set, corner set) to solid, which suits Bend.

### 13.2 Candidate ports (INFERRED sizes in Bend lines, excluding tests)

| ID | What | Sources (ideas) | Size | Depends on |
|---|---|---|---|---|
| **P1 KPart ladder** | Exact stripe geometry: plane/plane→cylinder; plane/cyl axial→cylinder; plane/cyl cap→torus (sphere when R=r_cyl); plane/cone cap→torus; coaxial cyl/cyl and cone/cone→torus/cylinder; chamfers →plane/cone (symmetric, two-distance, distance-angle); convexity table; `max_radius` bounds | OCCT ChFiKPart, remus analytic.rs, keel | 1.5–2.5k | Torus + Sphere surfaces |
| **P2 Corner-ball network** | Classify vertices (free / miter / star / mixed); solve the corner ball (3 offset planes → a point); equal-radius star → sphere patch; 2-edge miter of equal-radius cylinders → exact ellipse seam; everything else refuses by name | BREP_kernel network, keel octant/mitre, OCCT ThreeCorner/Rotule, remus spherical_triangle | 1.5–2.5k | P1, Sphere |
| **P3 Consumed-face / full-round** | Detect setback ≥ face extent; drop the face; join neighbouring stripes tangentially (full round of a slot or plate end = one half-cylinder) | OCCT #1293/#1449 intent, Blender collide offsets | 0.5–1k | P1, P2 |
| **P4 Fillet by Boolean with blend solids** | Per selection, build the tool body (edge wedge minus cylinder / torus sector per stripe, plus corner pieces) and subtract/union with the corefine+recover hybrid; recover analytic faces | BREP_kernel `tool.rs`, BOSL2 masks, Zoo (INFERRED "edge cut"), SolveSpace user practice | 0.8–1.5k | Boolean must handle cylinder/torus/sphere tangency (hard!) |
| **P5 General-pair walker** | Contact-circle solve + certified adaptive rational fit for cyl/cyl skew, cone/cyl, … | monstertruck, OCCT BlendFunc_ConstRad residuals, remus walker | 1.5–2.5k | a NURBS/rational surface type (absent) |
| **P6 2D profile fillets** | Exact arc insertion at sketch vertices and exact rounded offsets of line/arc profiles | CGAL `offset_polygon_2`, OCCT `ChFi2d_AnaFilletAlgo`, BOSL2 `round_corners` | 0.3–0.6k | existing sketch arcs |
| **P7 SDF oracle** | smooth-min blend in `kernel/proto/sdf` for visual/volume cross-checks at 90° dihedrals | sdfx `RoundMin` | ~0.1k | proto/sdf |
| — (reject) | GeomPlate/Coons corners, mesh bevel, Minkowski fillets | OCCT CnCrn, Blender, Manifold | — | — |

---

## 14. Failure-mode catalogue (the checklist for Part 2 fixtures)

Each row is a documented failure somewhere. A wonky fillet port must either build the case exactly or refuse it by name. INFERRED: these are the fixtures `fixtures/fillet/` needs; the Boolean bake-off's PASS/DECLINE/WRONG oracle fits unchanged.

| # | Failure class | Where seen | Minimal fixture |
|---|---|---|---|
| F1 | Radius consumes a face (full round, fillets meet tangentially) | OCCT #1177, #172/Mantis 25478, FreeCAD #5561; MEASURED on OCCT 8.0.1 | 10 mm box, two opposite top edges, R5 |
| F2 | Radius > edge length / face width | OCCT single edge R10; monstertruck `DegenerateEdge` (edge < 2r is wrong for chains) | box single edge R10; short edge in a chain |
| F3 | Corner with 3 equal radii (sphere) | OCCT `ChFiKPart_Sphere` (MEASURED OK), keel octant, remus | box all 12 edges R1 |
| F4 | Corner with unequal radii | OCCT GeomFill/Plate, keel setback, remus refuses | box corner R1/R2/R3 |
| F5 | Mixed-convexity corner (pocket edge meets outer edge) | BREP_kernel refuses "by name"; OCCT one-corner sub-cases 2/3 not implemented (header comment) | L-shaped block, fillet both convex and concave edges at the notch vertex |
| F6 | Two-edge miter (third edge sharp) | keel mitre ellipse, BREP_kernel miter seam, OCCT `PerformTwoCorner`/Rotule | box, fillet 2 of 3 edges at a corner |
| F7 | Tangent-chain propagation (unexpected edges pulled in) | FreeCAD #20071, OCCT doc | slot outline (lines + arcs), select one line |
| F8 | Closed spine / periodic seam | OCCT #1507, #1371, #1501; remus rounded-rect rim free edges | cylinder cap rim; rounded-rectangle boss rim |
| F9 | Fillet ending tangent to a cylinder | OCCT #1537, FreeCAD #29476 | plate edge meeting a boss tangentially |
| F10 | Concave rim with R ≥ r_cyl (spindle torus) | remus bound `r < r_c`, keel `r_c > 2r`, OCCT "the fillet does not pass" | Ø10 hole rim, R 4.9 / 5 / 6 |
| F11 | Degenerate or near-tangent faces (dihedral ≈ 180°) | remus `dihedral_half_angle` war story; OCCT #1495 | 178.9° ridge |
| F12 | Tapered supports (plane/cone at angle) | OCCT #1427, FreeCAD #21665 | drafted boss rim |
| F13 | Upstream orientation / validity | build123d #1462, monstertruck `flip_side` | reversed solid from offset |
| F14 | Fillet after Boolean with tangent/coincident faces | monstertruck #24, SolveSpace #1291, vcad #902 | fillet on the output of a coplanar union |
| F15 | Silent no-op success | remus (2 layers), vcad unchecked, monstertruck swallowed edges | assert (F,E,V) and volume change |
| F16 | Non-monotone feasibility in r | Zoo #12429 (DOCUMENTED in KittyCAD/modeling-app, see the Zoo note); build123d `max_fillet` assumes monotone | radius sweep with an F/E/V/volume log |

---

## 15. Wheat and chaff (verdict for Part 2)

**Wheat (port as ideas/algorithms, re-derived in Bend):**

1. **The KPart exact ladder** (OCCT, cross-checked by remus and keel). It covers the FDM-dominant fillets exactly and cheaply (1–13 ms in OCCT, MEASURED). The prerequisite is Torus + Sphere surfaces.
2. **Corner-ball-first, whole-selection construction** (BREP_kernel network; keel octant/mitre; OCCT's sphere/torus corners). It removes order dependence and the "reconstruct the corner from leftovers" failure class.
3. **Explicit topology-change support for consumed faces** (F1). This is the longest-standing open OCCT bug (10+ years) and the most common FDM request (full-round plate ends, slot ends).
4. **Typed refusals with `max_radius`**, a per-edge/per-vertex report and a disclosed engine (remus `BlendError` codes, vcad `FilletResult`, keel DECLINE). No silent no-op, ever.
5. **Blender-style collision bounds** as the analytic `max_radius` predictor, instead of build123d's bisection.
6. **2D profile rounding** (CGAL exact offset, OCCT ChFi2d analytic, BOSL2): the cheapest high-value "fillet" for FDM, and already expressible with wonky's sketch arcs.

**Chaff:**

- OCCT walking + GeomFill/GeomPlate corners + TopOpeBRep reconstruction: huge, uncertified, and the source of most bugs.
- monstertruck's all-NURBS approximation of cases that have closed forms.
- SDF smooth-min as a "fillet": wrong radius semantics.
- Mesh bevel and Minkowski: lose analytic geometry.
- Try-both-orientations hacks.
- Env-var strictness.
- Keeping invalid results with patched tolerances (FreeCAD).

**Recommended prototype candidates for the Part 2 bake-off** (INFERRED):

- **A. KPart-direct.** P1 + P2 + P3 as direct B-rep surgery (pure function over the solid).
- **B. Blend-solid Boolean.** P1 geometry turned into tool solids per *network* (stripes + corner pieces), applied through the corefine+recover hybrid. It tests whether the Boolean can already carry fillets, with BREP_kernel's known pitfalls as explicit fixtures.
- **C. General walker.** P5 limited to the parts the corpus actually needs, only if the corpus site analysis (`scripts/fillet/corpus-*.mjs`) shows non-analytic pairs matter.
- **Oracles.** OCCT via `uv run` (build123d) for volume, face types and failure; P7 SDF for 90° visual checks; closed-form volumes (Pappus) as in §2.4.
