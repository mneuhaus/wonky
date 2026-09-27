# OCCT Modeling Algorithms guide and TKFillet/ChFi3d (fillets, chamfers, offsets)

- Kind: user guide plus kernel source. Canonical URL: https://occt3d.com/dev/doc/overview/html/occt_user_guides__modeling_algos.html
- Other URLs: https://github.com/Open-Cascade-SAS/OCCT/tree/master/src/ModelingAlgorithms/TKFillet/ChFi3d ; https://github.com/Open-Cascade-SAS/OCCT/tree/master/src/ModelingAlgorithms/TKFillet (ChFiKPart, BRepBlend, BlendFunc, ChFiDS, FilletSurf, ChFi2d) ; https://github.com/Open-Cascade-SAS/OCCT/tree/master/src/ModelingAlgorithms/TKOffset
- Read: guide snapshot `tmp/research/occt-docs/modeling_algos.{html,txt}`; source at commit `3d097a0328e71b826377d4814ab05ec3c3d23871` (`tmp/research/occt-intpatch/occt/src/ModelingAlgorithms/TKFillet`, `TKOffset`; older excerpts in `tmp/research/occt-fillet/`). Link base: `https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/`.
- Authors/organization: Matra Datavision (ChFiKPart files "Created on: 1994-02-03, Isabelle GRIGNON"), OPEN CASCADE SAS. 1994-2026.
- License: LGPL-2.1 with the OCCT exception. Implication (INFERRED): the closed-form fillet constructions are textbook geometry (offset surfaces intersected, then a torus or cylinder built from the result) and can be re-derived freely. Translated code would be LGPL-derived.
- Status: active. TKFillet is ~63k lines (ChFi3d alone ~36k: `ChFi3d_Builder_0.cxx` 6,072, `_C1` 5,421, `_2` 3,972, `_CnCrn` 3,895); TKOffset `BRepOffset` ~29k lines. There are many open 2025-2026 fillet issues (below).

## What it is

- **Fillets** (`BRepFilletAPI_MakeFillet` → `ChFi3d_FilBuilder`): rolling-ball blends of constant or evolving radius along edges shared by two faces. **Chamfers** (`BRepFilletAPI_MakeChamfer` → `ChFi3d_ChBuilder`): symmetric, two-distance, or distance-angle ruled blends. **2D fillets and chamfers** on planar faces (`BRepFilletAPI_MakeFillet2d`, `ChFi2d`).
- **Offsets** (`BRepOffsetAPI_MakeOffsetShape`: `PerformByJoin` = analytic continuation plus intersection of offset faces, arc or intersection joins; `PerformBySimple` = map each face to its offset surface independently and let tolerances cover the gaps), **thick solids and shelling** (`BRepOffsetAPI_MakeThickSolid::MakeThickSolidByJoin/BySimple`), draft angles (`BRepOffsetAPI_DraftAngle`, planar, cylindrical and conical faces only), pipes, evolved shapes.

## How it works

### User-level contract (DOCUMENTED, guide "Fillets and Chamfers", "Offset computation")
- "A fillet description contains an edge and a radius. The edge must be shared by two faces. The fillet is automatically extended to all edges in a smooth continuity with the original edge." (tangent-chain propagation). Adding a fillet twice is allowed; the last one wins. Corners and apexes with different radii and different concavity are addressed.
- Filling-surface section: "If the radius of the fillet on one edge is different from that of the fillet on another, it becomes impossible to sew together all the edges of the resulting surfaces. This leaves a gap", which is filled by `GeomFill` (Stretch, Coons or Curved, from 2-4 boundary curves) or `GeomPlate` (thin-plate variational surface, then `MakeApprox` to a B-spline).
- Offsets: "the simple algorithm … leads, in general case, to tolerance increasing. The tolerances have to grow in order to cover the gaps between the neighbor faces", and the growth "depends on the offset distance and the quality of joints". `PerformByJoin(S, Offset, Tol, Mode = Skin, Intersection = false, SelfInter = false, Join = GeomAbs_Arc, RemoveIntEdges = false)`.

### Pipeline of `ChFi3d_Builder::Compute` (DOCUMENTED from source layout and headers; INFERRED ordering from file names)
1. Build **spines**: maximal tangent-continuous edge chains (`ChFiDS_Spine`, `ChFiDS_FilSpine` with a radius law).
2. For each spine element, decide **"particular" (closed-form) versus walking**: `ChFi3d_KParticular` (`TKFillet/ChFi3d/ChFi3d_Builder_0.cxx` L598-L680, called at `ChFi3d_Builder_2.cxx:3127`).
3. Particular: `ChFiKPart_ComputeData::Compute` (`ChFiKPart/ChFiKPart_ComputeData.cxx` ~L51-L212) builds an exact elementary surface plus pcurves and 3D contact curves. General: `BRepBlend_Walking` marches the rolling-ball system (`BlendFunc_ConstRad`, `BlendFunc_EvolRad`, chamfer functions) and approximates the stripe as B-spline surfaces (`BRepBlend_AppSurf`).
4. **Corners** (vertex ends of stripes): `ChFi3d_Builder_C1.cxx` (one stripe ending), `_C2` (two), `ChFi3d_Builder_CnCrn.cxx` (n ≥ 3 stripes, filled with `GeomPlate_BuildPlateSurface` and approximation), plus special analytic corners `ChFiKPart_Sphere` (three equal-radius plane/plane fillets meeting: spherical corner) and `ChFiKPart_MakeRotule` (a toroidal "ball joint" for a plane/plane/plane configuration).
5. Topological reconstruction via `TopOpeBRepDS` (the old Boolean data structure, not the GFA).

### Closed-form eligibility table (DOCUMENTED, `ChFi3d_KParticular`)
Closed form is used only if **all** of these hold:
- radius constant on the element;
- one face is a **plane**;
- the other face is plane, cylinder or cone;
- the spine element is a line or circle;
- and one of:
  - plane/plane with a line edge → **cylinder** fillet (`FilPlnPln`);
  - plane/cylinder with a line edge and the plane normal ⊥ cylinder axis (axis parallel to the plane) → **cylinder** fillet (`FilPlnCyl`, line overload);
  - plane/cylinder with a circle edge and the plane normal ∥ cylinder axis (end cap of a cylinder, boss or hole) → **torus** fillet (or **sphere** if the torus major radius vanishes) (`FilPlnCyl`, circle overload);
  - plane/cone with a circle edge and the plane normal ∥ cone axis → **torus** (or sphere) (`FilPlnCon`).

  Parallelism tests use `Precision::Angular()` = 1e-12.
- Everything else, including **cylinder/cylinder, cylinder/cone, any B-spline, and any variable radius**, goes through walking. Chamfers mirror this: plane/plane → plane (`ChPlnPln`), plane/cylinder → cone or plane (`ChPlnCyl`), plane/cone → cone (`ChPlnCon`), with asymmetric variants.

### Closed-form constructions (DOCUMENTED, code)
- **Plane/plane** (`ChFiKPart_ComputeData_FilPlnPln.cxx` L40-L120). `Pv` = point on the plane/plane intersection line at the spine start. `D1`, `D2` = the face normals oriented toward the material side of the fillet, `θ = ∠(D1, D2)`. Axis point `C = Pv + (R / cos(θ/2)) · normalize(D1 + D2)`, axis direction = spine direction, and the cylinder has radius `R`. Frame X = `−D1`, Y flipped so it points away from `D2`.
- **Plane/cylinder, line edge** (`FilPlnCyl.cxx` L52-L275). Offset the plane by `R` along its oriented normal. Offset the cylinder radius to `r + R` (convex side: face forward with direct cylinder, or reversed with indirect) or `r − R` (concave), failing if `R ≥ r` in the concave case ("the fillet does not pass"). The fillet axis is the line from `IntAna_QuadQuadGeo(offsetPlane, offsetCylinder)`; with two solutions, take the one closest to the spine start. The result is a cylinder of radius `R` about that line.
- **Plane/cylinder, circle edge** (`FilPlnCyl.cxx` L283-L560). The center is the cylinder axis point on the plane, offset by `R` along the oriented plane normal (`Or = cPln + R·Dp`). "dedans" (inside) is decided by the sign of `Dx·Dc` (the radial direction versus the oriented cylinder normal). Inside: major `= r − R`; if `|r − R| ≤ Precision::Confusion()` the fillet is a **sphere** of radius `R`; if `r − R < 0` it fails. Outside: major `= r + R`. The result is a torus `(major, minor = R)` with axis ∥ cylinder axis. A seam guard (`acote = 1e-7`) handles a spine start exactly on the cylinder seam.
- **Rolling ball (general)** (`BlendFunc/BlendFunc_ConstRad.cxx` L283-L335). The unknowns are `X = (u1,v1,u2,v2)` at spine parameter `t`, with guide point `G(t)`, section-plane normal `nplan = G'(t)/|G'(t)|`, contact points `P_i = S_i(u_i,v_i)` and surface normals `n_i` (oriented):
  - `E1 = nplan · (P1 + P2)/2 − nplan · G(t) = 0`: the midpoint of the contacts lies in the section plane;
  - `E2..4 = P1 + R·(nplan·n1 · nplan − n1)/|nplan × n1| − P2 − R·(nplan·n2 · nplan − n2)/|nplan × n2| = 0`: the ball centers computed from both contacts coincide, using the normals projected into the section plane.

  A singular surface (`|nplan × n_i| ≤ Eps`) sets the inverse to 1 ("Unsatisfactory, but it is not necessary to crash"). The walker (`BRepBlend_Walking`) marches `t` with a Newton solve per step.

### Failure reporting API (DOCUMENTED, `ChFi3d_Builder.hxx`, `ChFiDS/ChFiDS_ErrorStatus.hxx`)
- `IsDone()`, `NbFaultyContours()` / `FaultyContour(i)`, `NbFaultyVertices()` / `FaultyVertex(i)`, `HasResult()` / `BadShape()` (a partial result), and `StripeStatus(IC)` ∈ {`ChFiDS_Ok`, `ChFiDS_Error`, `ChFiDS_WalkingFailure`, `ChFiDS_StartsolFailure`, `ChFiDS_TwistedSurface`}.
- Unimplemented variants `throw Standard_Failure("PerformSurf Not Implemented")` (`ChFi3d_Builder_NotImp.cxx`). A particular case not written throws `Standard_NotImplemented("particular case not written")` (`ChFiKPart_ComputeData.cxx` ~L211).
- Offsets report `BRepOffset_Error` ∈ {NoError, UnknownError, BadNormalsOnGeometry, C0Geometry, NullOffset, NotConnectedShell, CannotTrimEdges, CannotFuseVertices, CannotExtentEdge, UserBreak, MixedConnectivity (faces along an edge partially C0 and tangent)}.

## Robustness and guarantees

- Closed-form cases are exact up to f64 evaluation, but their *eligibility* and *orientation* decisions are 1e-12 angle and 1e-7 distance tests (DOCUMENTED). The walking path is numeric marching with approximated B-spline output. Its tolerance comes from `approx.TolReached`, and nothing is certified.
- Documented weak spots: corners with different radii leave gaps filled by approximate Plate/Coons surfaces; tangent-chain propagation can pull unexpected edges into a fillet; "simple" offsets grow tolerances.
- The public API exposes failure localization (faulty contours and vertices, stripe status), which is better than the Boolean's IsDone. The issue tracker shows it is not reliable either (#1371 below).

## Parallelism and performance

- No parallel paths in ChFi3d were found (INFERRED from code: no `OSD_Parallel`/`BOPTools_Parallel` in TKFillet). `BlendFunc_ConstRad::ComputeValues` keeps "per-thread scratch" (comment L141), which suggests thread-safety work but not internal parallelism.
- No measured numbers are published in the guide. #1495 (below) documents a non-terminating loop, and #847 (closed 2025-11) a hang in `MakeFillet::Add`.

## Known failures, limitations, war stories

- **#1177 (open, 2026-03-31): fillets and chamfers cannot reach opposite edges.** On a 10 mm box, a fillet or chamfer of 10 fails while 9.999 works. Two R5 fillets on opposite edges of a 10 mm face (a full round) fail while 4.99 works and leaves a sliver face. https://github.com/Open-Cascade-SAS/OCCT/issues/1177 — directly relevant to FDM (fully rounded plate ends, slot ends).
- #1371 (open, 2026-07-14): `MakeFillet` on a closed rational B-spline rim reports full success (`IsDone`, 0 faulty contours and vertices) and returns a self-intersecting solid. The defect clusters at the seam vertex of the closed spine. https://github.com/Open-Cascade-SAS/OCCT/issues/1371
- #1495 (open, 2026-08-23): `ChFi3d_Builder::StoreData` searches for a parameter with non-degenerate normals by `VFirst + Δ/aDenom` for `aDenom = 2, 3, …` (an int) with exit `Δ/aDenom ≤ tolget2d` (~4.9e-15). When no such parameter exists, the exit needs more steps than an int can count, so the fillet never returns. https://github.com/Open-Cascade-SAS/OCCT/issues/1495
- #1430 (open, 2026-08-05, from FreeCAD #25868): crashes and self-intersections; #1421 crash on a failing fillet; #1427 failing fillet on a tapered surface; #1217 chamfer fails at a B-spline corner; #736/#737 artifacts and a fillet bending the wrong way; #1163 segfault in `IntersectMoreCorner`. https://github.com/Open-Cascade-SAS/OCCT/issues?q=fillet
- #191 (open): `BRepOffsetAPI_MakeOffset` failure; #1521: defeaturing cannot remove a corner round.

## Relevance for wonky

- **The eligibility table is the FDM fillet table** (INFERRED): printable parts are dominated by plane/plane edges (box edges → cylinder), plane/cylinder cap edges (bosses, holes, standoffs → torus or sphere), plane/cylinder axial edges (cylinder meeting a flat wall → cylinder), and plane/cone circle edges (countersinks, chamfered holes → torus). OCCT's own closed-form set covers these. wonky can implement exactly this set natively and **fail explicitly** on everything else: cylinder/cylinder, variable radius, B-spline, and corners of three or more stripes with unequal radii. Everything outside the set is walking plus Plate in OCCT, i.e. approximation without certificates.
- **wonky currently has no torus surface.** The plane/cylinder cap fillet (the most common FDM fillet) and the plane/cone fillet require one. Add `Torus(center, axis, frame, major R, minor r)` with the OCCT parameterization (see the BRep-format note) before fillets. The sphere degenerate case (major = 0) needs `Sphere` or an explicit failure.
- **Exact constructions reduce to things wonky already has** (INFERRED): offsetting a plane or a cylinder is exact (a plane shifted by R; a coaxial cylinder of radius r ± R). Their intersection is `IntPCy`/`IntPP` from the ImpImp note, giving the fillet axis. The contact curves are lines or circles (cylinder fillet: two lines; torus fillet: two circles, one on the plane of radius `major`, one on the cylinder of radius `r` at axial offset `R`). So a plane/cylinder fillet is **one SSI of offset quadrics plus conic bookkeeping**, all expressible with exact predicates for "does the fillet fit" (`R < r` concave, `R` versus face widths) and F32x2 constructions.
- **Explicit failure at the documented weak spots:** (a) corners of three or more stripes, except the equal-radius plane/plane/plane sphere corner; (b) a fillet consuming a whole face (#1177), which should be supported as a *topology change* (the face disappears and the fillet meets the opposite fillet or edge), because FDM full rounds are common; (c) seams on closed spines (#1371); (d) degenerate normals (#1495). For each, wonky should return `Unresolved{reason}` with the stripe or vertex ID, mirroring OCCT's `FaultyContour`/`FaultyVertex`/`StripeStatus` API but with honest statuses.
- **Rolling-ball residual** `E1..E4` is a compact, uniform per-sample system: 4 unknowns, surface evaluation and normals. It is a good fit for a GPU batch of spine samples (uniform work) *if* wonky ever does general blends. The marching (continuation) is sequential per stripe, and could be replaced by a sampled solve at fixed `t` plus a certified interpolant (INFERRED).
- **Offsets:** the documented split between "join" (exact continuation plus intersection) and "simple" (tolerance growth) mirrors the fillet split. For FDM (shelling, wall thickness, clearance offsets) the exact path is offsetting planes, cylinders, cones, tori and spheres (all offsets of elementary surfaces are elementary of the same type, with a cone keeping its angle and a shifted apex) plus the existing Boolean/SSI machinery. The `BRepOffset_Error` list (C0 geometry, mixed connectivity, …) is a good starting enumeration of explicit failure reasons.
- **LLM ergonomics:** OCCT's "tangent-chain auto-propagation" is convenient but surprising. wonky should make propagation explicit in the FeatureScript result (report which edges were added to the chain) so an LLM can verify intent.

## Pointers worth porting or studying

- `TKFillet/ChFi3d/ChFi3d_Builder_0.cxx` L598-L680 (`ChFi3d_KParticular`, the eligibility table).
- `TKFillet/ChFiKPart/ChFiKPart_ComputeData.cxx` ~L51-L212 (dispatch), `ChFiKPart_ComputeData_FilPlnPln.cxx` L40-L120 (cylinder fillet formula), `ChFiKPart_ComputeData_FilPlnCyl.cxx` L52-L275 (line spine) and L283-L560 (circle spine: torus or sphere, inside/outside), `ChFiKPart_ComputeData_FilPlnCon.cxx` (cone), `ChFiKPart_ComputeData_Sphere.cxx`, `ChFiKPart_ComputeData_Rotule.cxx` (corners), `ChFiKPart_ComputeData_ChPlnCyl.cxx` / `ChPlnCon.cxx` / `ChPlnPln.cxx` (chamfers → cone or plane).
- `TKFillet/BlendFunc/BlendFunc_ConstRad.cxx` L283-L335 (rolling-ball residuals), `BRepBlend/BRepBlend_Walking*` (marching), `ChFi3d/ChFi3d_Builder_CnCrn.cxx` (Plate corners), `ChFiDS/ChFiDS_ErrorStatus.hxx`, `ChFi3d/ChFi3d_Builder.hxx` (failure API).
- `TKOffset/BRepOffset/BRepOffset_Error.hxx`, `BRepOffset_Analyse.cxx` (edge concavity classification `ChFiDS_TypeOfConcavity`), `BRepOffset_Offset.cxx` (offset surfaces of elementary types).
- Guide sections "Fillets and Chamfers", "Filling a contour" (gap between unequal-radius fillets), "Offset computation", "Shelling", "Draft Angle".

## Verdict: adapt

Adopt OCCT's closed-form fillet and chamfer set (plane/plane → cylinder; plane/cylinder → cylinder or torus/sphere; plane/cone → torus/sphere; chamfers → plane or cone) as wonky's complete initial fillet feature. Re-derive it as offset-quadric SSI with exact fit predicates. Add a torus surface type first, and fail explicitly (with stripe and vertex IDs) for walking-only cases, unequal-radius corners, and seam or degenerate-normal cases. Study the walking and Plate machinery only as a map of what not to promise.
