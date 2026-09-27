# Fillets in commercial kernels: Parasolid, ACIS, CGM, C3D, Granite, ShapeManager

Part 1 of the fillet landscape (survey). This file covers what the commercial
kernels and the CAD systems on top of them do with blends, from public
documentation, patents, help pages and forums. It also covers the Onshape
FeatureScript contract (Marc's corpus is FeatureScript) and FDM practice.

Worklog: local development evidence. Raw downloads:
`tmp/fillet/commercial/` (Parasolid V35 chapters, Siemens patents as text).

Evidence labels:

- **DOCUMENTED**: stated in a vendor document, patent or help page, cited.
- **MEASURED**: counted or run by us; command and path given.
- **INFERRED**: our reasoning from documented facts.
- **HEARSAY**: forum posts, blogs, search-engine snippets, Wikipedia without
  a primary source.

## 0. Summary

1. **Every commercial kernel runs the same basic scheme.** INFERRED from the
   Parasolid, ACIS, CGM, SMLib and C3D docs.
   1. Store the request as data on edges.
   2. Offset the two support surfaces by the radius and intersect the offsets.
      That gives the ball-centre curve (the *spine*).
   3. Project the spine onto the supports. That gives the two contact curves
      (the *spring curves* or *rails*).
   4. Build the blend surface. Where the spine is a line, circle or point,
      replace it with a cylinder, torus or sphere.
   5. Handle the ends: cap with the third face, overflow, or build a vertex
      patch.
   6. Attach the result to the body with a Boolean-like trim.

   The differences between kernels are almost entirely in steps 5 and 6.
2. **None of them claims completeness.**
   - Parasolid calls its own rules "rules of thumb" and says "the only
     guaranteed test of a blend is to FIX it". DOCUMENTED.
   - ACIS ships a default (local interference checking) that it documents as
     silently losing a pocket. DOCUMENTED.
   - SMLib names the "standard assumptions" that every algorithm makes and
     then adds special handlers for each violation. DOCUMENTED.
3. **Order dependence is real, and no vendor has solved it.** All of them
   expose it as a knob or as advice:
   - Parasolid: `vx_order_data`, `ov_order`, "make and fix blends in small
     groups".
   - ACIS: a worklist that requeues failed attributes; mixed-convexity miters
     are refused and must be done in steps.
   - C3D: `CornerForm`.
   - SolidWorks: FilletXpert tries solve orders until one works.
   - The published user advice contradicts itself: "big radius before small"
     (SolidWorks, Onshape) against "small first, then increase" (Fusion
     forums).
4. **Onshape = Parasolid for fillets.** INFERRED, strong.
   - Onshape's `FILLET_*`, `CHAMFER_*` and `EDGEBLEND_*` error enums match
     Parasolid's `PK_blend_fault_*` codes almost word for word.
   - Parasolid V35 added `rho_too_large` and `apex_range` faults and
     apex-range chamfers. Onshape has `FILLET_RHO_TOO_LARGE` and
     `ChamferMethod.APEX_RANGE`.
   - So Marc's FS corpus implicitly relies on Parasolid's blend behaviour,
     including its defaults: overflow allowed, notch overlap allowed, and
     tolerance growth on failure.
5. **Marc's corpus uses a tiny, well-defined subset.** MEASURED, §10.
   - Keys used: `entities`, `radius`, `tangentPropagation`, and chamfers with
     `EQUAL_OFFSETS` and `width`. Nothing else: no conic, G2, variable,
     partial, overflow or corner options.
   - `allowEdgeOverflow` is never set, so it is always the default `true`.
   - Edges are picked mostly as straight lines filtered by direction.
   - The corpus already codes the classic workaround: try a radius, then a
     fallback radius.
6. **FDM changes the priorities.**
   - Chamfers matter as much as fillets. A 45° chamfer on bed-facing edges
     prints; a fillet curls into an overhang.
   - Marc's house style is R4.2 on vertical edges, then a *continuous* 0.42 mm
     chamfer ring on every other edge, applied last.
   - Chamfer rings around arcs are plane/cylinder chamfers, i.e. cones.
     Fillet/chamfer junctions are mixed blend types at one vertex, which
     Parasolid refuses to fix in one call.

## 1. Who runs which kernel

| CAD system | Kernel | Evidence |
|---|---|---|
| Onshape | Parasolid | INFERRED (error enums, §0.4); HEARSAY: Wikipedia "Parasolid" user list, marked "citation needed" |
| SolidWorks, Solid Edge, NX | Parasolid | HEARSAY: Wikipedia; widely known |
| Fusion, Inventor, AutoCAD | ShapeManager, forked from ACIS 7.0 in Nov 2001, first shipped in Inventor 5.3 in Feb 2002 | HEARSAY: https://en.wikipedia.org/wiki/ShapeManager ; machinedesign.com archive |
| CATIA V5/V6, 3DEXPERIENCE | CGM (CATIA Geometric Modeler), sold by Spatial as "CGM Modeler" | DOCUMENTED: https://www.engineering.com/spatial-acis-cgm-and-the-future-of-geometric-modeling-kernels/ , https://www.spatial.com/solutions/3d-modeling/cgm-modeler |
| Many third-party apps | ACIS (Spatial / Dassault) | DOCUMENTED: Spatial |
| Creo Parametric (Pro/E) | Granite | DOCUMENTED: PTC Granite topic sheet https://support.ptc.com/images/cs/articles/2020/06/1593411762dEcH/PTC_Creo_Granite_Interoperability_Kernel._Final.pdf |
| Creo Elements/Direct (ex-HP SolidDesigner, CoCreate) | own kernel | DOCUMENTED in the HP patents (see `docs/research/sources/hp-cocreate-...md`) |
| KOMPAS-3D and others | C3D Modeler (C3D Labs / ASCON) | DOCUMENTED: https://c3dlabs.com/products/c3d-toolkit/modeler/ ; the KOMPAS link is HEARSAY (Wikipedia) |
| FreeCAD, build123d, CadQuery | OCCT | covered in `docs/research/sources/occt-modeling-algorithms-guide-and-tkfillet-chfi3d-fillets-c.md` |
| (SDK) | SMLib (IntegrityWare, now NVIDIA) | DOCUMENTED: https://docs.nvidia.com/smlib/manual/smlib/fillets ("Copyright © 2026 NVIDIA Corporation") |

SMLib is not on the brief's list. It is included because its manual is the
most explicit public statement of *which* corner and overflow cases a
production fillet framework has to handle (§4, §5).

## 2. The common architecture

| Stage | Parasolid | ACIS / ShapeManager | CGM | C3D | SMLib |
|---|---|---|---|---|---|
| Request | Attributes on edges, "unfixed"; set with `PK_EDGE_set_blend_{constant,chamfer,chain}` | `ATTRIB_BLEND` on edges and vertices; a whole connected network is fixed at once | `CATDynFillet` operator with one or more `CATDynEdgeFilletRibbon`s, each holding edges and a `CATDynFilletRadius` law | `FilletSolid(solid, MbShellFilletValues)`; per-edge `SmoothValues` | `SmFilletExecutive` + one solver and one cross-section generator per edge |
| Geometry | Offset supports by the ranges, intersect to get the spine | Offset, intersect, project; "simple" spines are recognised | Not public | Not public | "offset-intersection" for starting points, then marched rails |
| Surface record | One internal type, "blended edge" (`geom_1, geom_2, radii, spine, spine_ext`), simplified "wherever possible" to cylinder or torus | `rb_blend_spl_sur`; line spine → cylinder, circle → torus, point → sphere | Not public | circular, elliptic, parabolic, hyperbolic (`conic` 0.05–0.95, 0 = circle) | exact rational circle **or** an approximation, accuracy "as a percent of radius" |
| Attach | `PK_BODY_fix_blends` | Stage 1: build a blend *sheet*; stage 2: attach it with Boolean-like trimming, reusing stage-1 intersections | Ribbons, with `SetSegmentationMode` / `CATDynTrim` | Not public | Trimming, then "topology sewing" |
| Check | `PK_EDGE_check_blends` ("not foolproof"); optional local checks after fixing | Local interference checking by default, global optional | Not public | `strict = false`: "round at least what is possible" | Test the resulting B-rep |

Sources (all DOCUMENTED):

- Parasolid v12: `docs/research/sources/parasolid-v12-...md`.
- Parasolid V35: `tmp/fillet/commercial/ps35_fd_chap.075.txt` and `.076.txt`, from http://www.q-solid.com/Parasolid_Docs_V35/chapters/fd_chap.075.html and `fd_chap.076.html`.
- ACIS: `docs/research/sources/acis-blending-...md`.
- CGM: https://www.maruf.ca/files/caadoc/CAATopUseCases/CAATopAllFillets.htm (CAA use case, © 2000 Dassault Systèmes).
- C3D: https://c3d.ascon.net/doc/math/struct_smooth_values.html and https://c3dlabs.com/doc/group___solid___modeling.html
- SMLib: https://docs.nvidia.com/smlib/manual/smlib/fillets

Granite has no public blend documentation. Everything known about it comes
from Creo's feature layer (§3, §4). The same is true of ShapeManager beyond
its ACIS 7.0 heritage (Fusion's feature layer, §3). DOCUMENTED absence.

**The two-stage "sheet, then attach" split is the part that matters for
wonky.** INFERRED.

- ACIS says it outright: stage 2 is a Boolean that reuses the stage-1
  intersections.
- The HP/CoCreate patents do stage 2 with Euler operators and a DFS over
  intersection curves.
- Marc's own FDM skill already does it by hand: "Build fillets as geometry
  when OCC would choke: posts = `Cylinder(R+r,h) - Torus(R+r,r)`; straight
  walls = `Box(r,L,r) - Cylinder(r)`; then `& footprint`". Source:
  `~/.claude/skills/cad-fdm-design/SKILL.md`.

Fillet-by-Boolean with blend solids is therefore not exotic. It is ACIS
stage 2 with wonky's hybrid Boolean.

## 3. Blend types

### 3.1 Matrix

"✓" means documented as supported in a source cited below. "✓*" means a
well-known UI feature that was not verified in this pass (HEARSAY). "–" means
not found in public documentation; that is not proof of absence.

| Type | Parasolid | ACIS / ABL | CGM (CATIA) | C3D | Creo (Granite) | SolidWorks | Fusion (ShapeManager) | Onshape (FS) |
|---|---|---|---|---|---|---|---|---|
| Constant rolling ball | ✓ | ✓ | ✓ | ✓ | ✓ Rolling Ball | ✓ | ✓ | `CIRCULAR` |
| Normal-to-spine / disc / swept profile | face-face "disc" | ABL, with the cross-section plane lofted to an orientation | ✓ (ribbon on spine; CATIA UI) | – | ✓ Normal to Spine | – | – | `opFaceBlend` `SWEPT_PROFILE` |
| Conic (rho) | ✓ (V12 rho; V35 default `xs_shape_conic`) | ABL elliptical | ✓* conic parameter (CATIA UI) | ✓ `conic` 0.05–0.95 | ✓ Conic, D1×D2 Conic | ✓* conic rho | – | `CONIC`, `rho` ∈ [0, 0.99999] |
| Curvature continuous (G2) | ✓ `xs_shape_g2` (V35); constant-width G2 since V38 | ABL thumbweights | ✓* | – | ✓ C2 Continuous, shape factor 0–0.95 | ✓* curvature continuous | ✓ G2 | `CURVATURE`, `magnitude` |
| Chamfer, face offset | ✓ default | ✓ (R10: two rolling balls) | ✓* | ✓ distance1/2 | ✓* | ✓* | ✓* | `FACE_OFFSET` (default) |
| Chamfer, apex range / in-support | ✓ apex-range and angle size types (V35) | ✓ R17 "in-support distance" | ? | – | ? | ? | ? | `APEX_RANGE` ("Tangent") |
| Asymmetric / two distances | ✓ ranges | ✓ | ✓* | ✓ distance1≠distance2 | ✓ D1×D2 (conic rounds) | ✓* | ✓* | `TWO_OFFSETS`, `OFFSET_ANGLE`, `isAsymmetric` |
| Constant width (chord) | ✓ (re-blend since V38) | ABL "fixed width" radius law | ? | – | ? | ✓* | ✓ Chord Length | `blendControlType: WIDTH` |
| Variable radius | ✓ VRB, zero only at ends | ✓ snapshot, envelope, sliding disc | ✓ radius law per ribbon | ✓ | ✓* | ✓* | ✓* | `isVariable`, `vertexSettings`, `pointOnEdgeSettings` |
| Cliff edge (tangent to one face only) | ✓ | edge-face remote blends | – | – | – | – | – | `opFaceBlend` `cliffEdges` |
| Full round / three-face | ✓ three-face blending | ✓ `…teb` | ✓* tritangent (CATIA UI) | ✓ `FullFilletSolid` | ✓ Full Round | ✓* | ✓* | `opFullRoundFillet` |
| Stopped / partial | limits (vertex, edge, overlap limits; trim to face or plane) | ✓ setback plus stop angle | limiting elements | `begLength` / `endLength` | Stop at reference | – | – | `partialFilletBounds` |
| Setback vertex blend | ✓ (all edges at the vertex, not for chamfers) | ✓ plus autosetback, n-sided Gregory patch with bulge | "blend corner" (CATIA UI) | – | Patch, Corner Sphere | Setback parameters, FilletXpert Corner | Setback corner type | none explicit; `smoothCorners` (see §10) |

Sources, all DOCUMENTED unless marked:

- Parasolid: V35 `fd_chap.075`/`076`; V38 and V39 release blogs https://blogs.sw.siemens.com/plm-components/whats-new-in-parasolid-v-38-0/ and https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/ ("Re-blending of constant-width blends … Includes complex configurations, such as overflows"; "constant-width blend can have a G2 cross-section"; V39 "change the size, shape and type of a blend when reblending").
- Creo: https://support.ptc.com/help/creo/creo_pma/r12/usascii/part_modeling/part_modeling/About_Creation_Methods_and_Cross_Section_Shapes.html (via search snippet) and https://support.ptc.com/help/creo/creo_pma/r9.0/usascii/part_modeling/part_modeling/Round_Transition_Types.html
- CATIA UI: https://www.staff.city.ac.uk/~ra600/ME2105/Catia%20course/CATIA%20Tutorials/prtug_C2/prtugbt0606.htm (a university mirror of the V5 user guide).
- Fusion: https://www.cadedllc.com/post/fusion-fillets-a-deep-dive-into-how-they-work (Brad Tallis, 2026-07-31; HEARSAY-grade blog) and the Fusion API property `FilletFeature.isRollingBallCorner`, https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/FilletFeature_isRollingBallCorner.htm
- SolidWorks: search snippets of the SolidWorks help "Fillet Overview", "FilletXpert Corner PropertyManager" and "Example: Overflow Type". The help pages load by JavaScript and our fetch only returned navigation, so treat the details as HEARSAY-strength although the source is the vendor.

### 3.2 The chamfer "distance" problem

There are at least four definitions of chamfer size in the commercial
kernels. They agree only for two planes at 90°. DOCUMENTED; the comparison
is INFERRED.

| Definition | Who | What the distance is |
|---|---|---|
| Face offset | Parasolid default (`PK_blend_size_face_offset_c`), Onshape `FACE_OFFSET` | Offset each support by d, intersect the offsets, project the intersection onto both supports. The chamfer is the chord between the two projections. For two planes the contact lines lie d / tan(φ/2) from the edge (φ = interior angle), derived below. |
| Apex range | Parasolid V35 `PK_blend_size_apex_range_c`, Onshape `APEX_RANGE` ("from the intersection of the tangent of the two adjacent faces") | Distance from the edge (the apex), measured in each support. |
| Angle | Parasolid V35 `PK_blend_size_angle_c`, Onshape `OFFSET_ANGLE` | "the angle made by the chord between the contact points and the tangent plane of the contact point on the other side" |
| Ball ranges | ACIS R10 and R17 advanced | Two rolling balls of radii r₁ and r₂; their contact points are joined by a line. |

- Parasolid's own warning: with face offsets, "if there is a great
  difference between the ranges on the two faces it is possible that the
  chamfer is not defined at all". V35 added the fault
  `PK_blend_fault_apex_range_c` and a report for "chamfers that have been
  extended outside their original range" (`report_extended`). DOCUMENTED,
  `fd_chap.076` §75.3.25, `fd_chap.080` §79.3.9.
- For wonky, INFERRED:
  - `EQUAL_OFFSETS` with `FACE_OFFSET` is the only chamfer in Marc's corpus.
  - On plane/plane it gives a plane.
  - On plane/cylinder around a circular edge (the chamfer ring around a
    hole or arc) it gives a cone. This holds for both definitions, but the
    cone apex differs between them unless the angle is 90°.

The face-offset row, derived (INFERRED; plane/plane convex edge, interior
material angle φ between the faces). It agrees with Onshape's manipulator
formula `r·tan(θ/2)` for θ = π − φ, the angle between the normals
(`edgeBlendCommon.fs`, see the Onshape FS note):

- The offset planes meet at the point at distance d/sin(φ/2) from the edge
  along the bisector.
- Its foot on each face lies at distance **d / tan(φ/2)** from the edge.
- For φ = 90° that is d, as expected.
- For an obtuse φ (for example 135°) it is 0.41·d, so the chamfer shrinks.
  That is the "width shrinks as the dihedral opens" behaviour Parasolid
  documents.

## 4. Vertices and corners

### 4.1 What the kernels say about configurations

**Parasolid** (V35 `fd_chap.075` §74.5–74.6 and `fd_chap.076` §75.3.2–75.3.9). DOCUMENTED.

| Vertex (valence × blended) | Rule |
|---|---|
| 3 × 1 | Normally possible. Fails if "the end surface is undefined". |
| n>3 × 1 | Possible if the ranges are small enough that the blend sides end on edges at the same vertex, and the end can be capped with existing faces, "extending at most two of the adjoining faces". |
| 3 × 2, same convexity | OK. |
| 3 × 2, mixed convexity | OK only if the blend on the odd edge is constant radius, and never with chamfers. V35 relaxed this; v12 required both blends to add material or both to remove it. |
| 3 × 3 | "An extra blend face is added to smooth out the vertex." The edges must be fixed as a group. Equal radii at a convex corner give "a piece of sphere". |
| 4 × 2 | The other pair must be tangent, or not share a face and have the same convexity. Convexity must not change at the vertex. Both edges must be set before either is fixed. |
| ≥5, or bad 4-edge cases | `PK_blend_fault_vertex_c`, "configuration of edges at vertex too complex". "A vertex can usually be blended if all of the edges meeting at the vertex are blended." |
| Mixed-convexity 3-edge vertex with all three blended | `vx_order_data` chooses concave first, convex first, minority first, majority first or unset. "Parasolid blends all specified edges of the same convexity simultaneously." |
| Y-blend | Two adjacent blends of different convexity at a vertex with ≥3 edges. |
| Setback | Only when *all* edges at a vertex with ≥3 edges are blended; not for chamfers. Default patch `collar_all` (a collar face per edge). A zero setback is not the same as no setback. |
| Vertex blending (`vx_blend_data`) | Smooths "past sharp edges of opposite convexity"; may create more than one surface. Off by default. Not for G2 or chamfers. |

**ACIS** (see `docs/research/sources/acis-blending-...md` §3, §6). DOCUMENTED.

- Terminal vs internal vertices; bi-blends; miters (same convexity only);
  complex miters with partial end caps.
- Mixed-convexity miters "may not produce a unique valid solution", so ACIS
  refuses to do them in one operation. The user must sequence them.
- Autosetback is a heuristic that treats the vertex as polyhedral. It works
  for similar radii, moderate angles and low edge curvature.
- Without setbacks, spheres and tori are used when possible. Otherwise an
  n-sided Gregory patch with a bulge factor.

**SMLib** (https://docs.nvidia.com/smlib/manual/smlib/fillets). DOCUMENTED.
An explicit N×M taxonomy (N edges at the vertex, M of them filleted), each
case with its own handler class:

- `Nx1ClosedCorner`: a closed edge meets the vertex twice.
- **3×1** (`SmFilletNx1Corner`), three subcases:
  - univex;
  - mixed convexity, with the filleted edge of the opposite convexity;
  - mixed convexity, with the filleted edge of the same convexity.
- **3×2** (`SmFilletNx2Corner`): tangent edges with matching radius; univex
  "with bevel creation"; mixed convexity "with corner patches".
- **N×N same convexity** (`SmFilletConvexNxNCorner`): "all of the rail curves
  intersect". It "may produce analytical surface (Sphere)"; for N > 3 it uses
  several four-sided patches.
- **N×N mixed** (`SmFilletConcaveNxNCorner`): "not all of the rail curves
  intersect". It builds blend curves between the rails and may produce a
  torus.
- Open-shell corners, tangent-surface corners (the fillet degenerates), and
  degenerate rails (for example "filleting the top of a cylinder with a
  radius the same as the cylinder").

**C3D** `SmoothValues.smoothCorner` (`CornerForm`). DOCUMENTED:

- `ec_pointed`: "Processing of corner is missing".
- `ec_either`: three edges at a point are processed "in the order of internal
  indexation".
- `ec_uniform`: for two convex edges and one concave (or the reverse), "the
  concave (convex) edge is processed at the first".
- `ec_sharp`: the plural variant of the same rule.
- Also `equable`: "In corners of the joint insert toroidal surface (for
  stamping sheet solid)".

**Creo round transitions**
(https://support.ptc.com/help/creo/creo_pma/r9.0/usascii/part_modeling/part_modeling/Round_Transition_Types.html).
DOCUMENTED. Creo exposes the corner as an *editable object* ("transitions are
filler geometry that connects round pieces"):

- Stop Cases 1–3 (the default, "configured based on the geometrical
  context"); Stop at Reference;
- Blend; Continue ("as if the round was placed first, and then geometry was
  cut away");
- Corner Sphere (three pieces overlap; the radius defaults to the largest);
- Intersect (extend until they merge "forming a sharp boundary");
- Intersect at Surface;
- Patch (3 or 4 pieces);
- Round Only 1/2 (different radii, same or mixed convexity).

**CATIA** "blend corners" with setback distances, and "trim ribbons" for
overlapping fillets (CATIA V5 user guide mirror). DOCUMENTED at UI level only.

**SolidWorks** has "Setback parameters" per vertex. FilletXpert's Corner tab
manages corners "where exactly three filleted edges meet at one vertex" and
offers alternative corner solutions (search snippet of
https://help.solidworks.com/2023/english/SolidWorks/sldworks/HIDD_FILLET_MGR_CORNER.htm).
HEARSAY-strength.

**Fusion** offers the corner types Rolling Ball (the default) and Setback. A
forum thread reports that Setback silently produced a rolling-ball corner:
https://forums.autodesk.com/t5/fusion-design-validate-document/trying-to-use-setback-fillet-but-it-creating-rolling-ball-fillet/td-p/9681024
HEARSAY.

### 4.2 Synthesis: the corner cases that recur in every kernel

INFERRED from the above. The rows are ordered by how often an FDM part meets
them; that ordering is INFERRED from the corpus selection idioms in §10.

| # | Case | Usual result | Notes for wonky |
|---|---|---|---|
| C1 | 3×1, univex, planar third face | Cap with the third face (plane ∩ cylinder = ellipse or line) | `roundX` in `r10b.fs`: box edges parallel to X end at ±X faces |
| C2 | 3×1, mixed convexity (fillet runs into a wall of the other convexity) | Cap with the third face **extended**; ACIS has special-case capping for it | Fillet on a slot edge running into the slot floor |
| C3 | 3×3 univex, equal radii | Sphere octant | "all edges of a box" (`cad-project-030.fs` fillets all body edges) |
| C4 | 3×3 univex, unequal radii | Setback patch or a torus plus a Round-Only-style compound; there is no analytic single answer | R4.2 vertical + a different radius on the top edges |
| C5 | 3×2 same convexity | Two blends, bevelled or patched against the unblended edge | Vertical R4.2 fillets meeting the top edge ring before the ring exists |
| C6 | 3×2 or 3×3 mixed convexity | Order-dependent (`vx_order`, C3D `ec_uniform`, ACIS refuses a single step) | Concave notch fillet meeting a convex edge round |
| C7 | Fillet meets chamfer at a vertex | Parasolid will not fix chamfers and rolling balls in one call. Marc's rule: fillets first, then one chamfer ring pass | See §11 |
| C8 | n≥4 × k | Mostly `vertex_c`-type failure unless all edges are blended | Where many small features meet |

## 5. Overflow, cliff, notch and caps

Overflow means the blend at its nominal size would leave one or both adjacent
faces.

**Parasolid** (v12 ch. 31; V35 ch. 76, `fd_chap.077`). DOCUMENTED.

- Four overflow types:
  - **smooth**: re-roll onto the next face; all bounds must be smooth;
  - **cliff**: a cliff-edge blend runs along the obstructing edge;
  - **cliff-end**;
  - **notch**: "the blend surface remains the same, and the blend is trimmed
    using the faces in the notch".
- Default attempt order: smooth, then cliff, then notch.
- "When no allowed overflow type can be created, the blend operation fails."
- A cliff overflow "becomes unstable" as the radius grows and turns into a
  notch by default.
- The eight-case default table is in `docs/research/sources/parasolid-v12-...md`
  and is unchanged in V35.
- **Overlapping chains** (V35 §75.3.22):
  - `ov_notch` default **yes**, `ov_smooth` default **no**, `ov_order`
    default **convex first**.
  - "the order in which blends are applied can be significant."
  - Explicit cliff edges can force a cliff on one side and a notch on the
    other (§76, Fig. 76-10).

**ACIS**: end caps, side caps, remote face-face / edge-face / edge-edge
blends, roll-on instructions (ABL). With default *local* interference
checking, a pocket under a large blend is silently lost. DOCUMENTED.

**SMLib**. DOCUMENTED.
- Self-intersecting rails ("the radius of the fillet is larger than that of
  one of the original base surfaces"): "the fillet is trimmed back from
  intersection and a blend surface is inserted".
- Cliff rollover: the fillet "gets trimmed by an extension of the cliff
  face".
- Explicit handlers for fillet/feature interactions: positive fillet around a
  boss; negative fillet cutting into a hole; negative fillet meeting a boss,
  which "gets extended down to meet the fillet"; positive fillet over a hole,
  where "the hole surface gets extended and the fillet gets trimmed";
  fillet/fillet intersections.
- Users can subclass a handler to change the default "to cutting the fillet,
  rolling a ball along the edge, or just quitting".

**CAD systems' user options**:

| System | Option | Meaning |
|---|---|---|
| Onshape | `allowEdgeOverflow` (default **true**), `keepEdges` | "Allow `opFillet` to modify nearby edges to maintain the fillet profile" / edges not to modify. DOCUMENTED, `geomOperations.fs` doc block. Help: "the fillet can modify edges on the face created by the fillet to make a smooth, continuous surface". |
| SolidWorks | Overflow type: Default / Keep edge / Keep surface | "Keep edge": the neighbouring edges stay and the fillet surface is split. "Keep surface": one continuous fillet surface, and the neighbouring edges bend. HEARSAY-strength (search snippets of https://help.solidworks.com/2019/english/SolidWorks/sldworks/c_Example_Overflow_Type.htm and https://www.engineersrule.com/advanced-breakdown-solidworks-fillet-featuretool/). |
| CATIA | Edges to keep; limiting elements; trim ribbons | "the application detects these edges and stops the fillet to these edges". DOCUMENTED, CATIA V5 user guide mirror. |
| C3D | `keepCant` (`ThreeStates`: auto / surface saving / boundary saving); `prolong` ("Prolong along the tangent"); `strict` | DOCUMENTED, `SmoothValues`. |

- INFERRED mapping:
  - SolidWorks "keep edge" ≈ C3D "boundary saving" ≈ Parasolid cliff/notch
    ≈ Onshape `keepEdges`.
  - "Keep surface" ≈ "surface saving" ≈ Parasolid smooth overflow.
- A blog claims that fillets which only work thanks to SolidWorks' keep-surface
  overflow fail after transfer to other kernels:
  https://cadshift.com/blog/fillet-kernel-comparison-solidworks-inventor-freecad/
  HEARSAY. The article is marketing-grade and gives no geometric examples.

## 6. Order of operations

### 6.1 Inside one operation (kernel behaviour)

| Kernel | Mechanism | Evidence |
|---|---|---|
| Parasolid | Same-convexity edges at a vertex are blended simultaneously. `vx_order_data` sets the order at mixed 3-edge vertices. `ov_order` (default convex first) orders overlapping chains. Chamfers and rolling balls, G2 and non-G2, and face-offset and apex-range chamfers must not be mixed in one fix call. Blends that fail together can succeed one after another (`PK_blend_fault_overlap_c`, v12 Fig. 32-8/9). "It is best to make and fix blends in small groups." | DOCUMENTED, V35 §74.3, §75.2.1.1, §75.2.3, §75.3.9, §75.3.22; v12 §29.4 |
| ACIS | Worklist: a failed attribute is moved to the end for reconsideration. A whole connected network is fixed in one operation. "Blend reordering": a new large blend between two existing smaller ones is built "as though the larger radius blend had been done before the smaller radius blends". Mixed-convexity miters are refused in one step. | DOCUMENTED, `…abp`, `…br`, `…ve` |
| C3D | `CornerForm` picks which convexity goes first at 3-edge vertices, or "internal indexation". | DOCUMENTED |
| Creo | Auto Round splits the job into Auto Round Members (chains per member, config `autoround_max_n_chains_per_feat`). "You cannot modify the order in which the ARMs are created". Edges that could not be rounded are excluded and the Troubleshooter says why. | DOCUMENTED via search snippet of https://support.ptc.com/help/creo/creo_pma/r11.0/usascii/part_modeling/part_modeling/About_the_Auto_Round_Feature.html |
| SolidWorks | FilletXpert "manages, organizes, and reorders symmetric constant radius fillets" and "automatically calls the FeatureXpert when it has trouble placing a fillet". It tries solve orders until one works. | HEARSAY-strength (search snippets of https://help.solidworks.com/2022/english/SolidWorks/sldworks/c_FilletXpert_Overview.htm , GoEngineer blog) |

### 6.2 Across features (user advice)

| Source | Advice | Label |
|---|---|---|
| SolidWorks help "Fillet Overview" (2013–2026) | "Add larger fillets before smaller ones. When several fillets converge at a vertex, create the larger fillets first." "Add drafts before fillets." "Save cosmetic fillets for last." | DOCUMENTED via search snippet |
| Onshape tech tip, 2022-07-12, https://www.onshape.com/en/resource-center/tech-tips/how-and-when-to-use-fillets-in-onshape | "Create structural fillets before finish fillets", "Create shell features after fillets", "Create draft features before fillets", "Create big radius fillets before small ones". Width fillets need continuous edges. | DOCUMENTED |
| Onshape forum (snippet attributed to an Onshape product-design lead) | Reorder the fillets to *after* the shell for control over the inner radii | HEARSAY. It contradicts the tech tip above, which is the point: both orders are "right" for different intents. |
| Fusion forums, cadin360 | Leave fillets to the end; "fillets can often be worked around by changing the order fillets are applied in or adding a small radius one and then increasing its radius"; "apply a chamfer first, then convert it to a fillet"; join bodies before filleting | HEARSAY (https://forums.autodesk.com/t5/fusion-support-forum/problem-with-fusion-360-fillet/td-p/9439638 , https://cadin360.com/blog/fusion-360/how-to-fix-fillet-error-in-fusion-360/) |
| Marc's own rule (`cad-fdm-design` SKILL) | "Edge-treatment ORDER: raw → notch fillets → blends → ONE deburr pass at the end. Never pre-chamfer pieces that later union." | DOCUMENTED (Marc's practice) |

INFERRED conclusion.

- "Large before small" exists because a later large blend needs a clean
  spine across the region where the small blends would sit. ACIS
  internalises exactly this ("blend reordering").
- "Small first, then increase" is a user-level homotopy: grow the radius
  until the topology changes. It works in Fusion because the edit is
  interactive.
- Neither is a law. A kernel that wants order-independence has to fix a
  canonical order itself (deterministic, documented), as Parasolid does for
  convexity classes, or search orders, as FilletXpert does. A search is
  non-deterministic in effort and must stay out of a pure regeneration
  kernel unless its result is recorded.

## 7. Tolerances

| Kernel | Global | Blend-specific | Label |
|---|---|---|---|
| Parasolid | Session precision 1e-8 (m), angular 1e-11, in a 1e3 box | Surface `tolerance` per blend. In `PK_BODY_fix_blends`: `tolerance` "Maximum allowed tolerance for any blend", **default 1.0e-5**; "we recommend a tolerance value in the region of 1/1000th of the blend radius"; `set_tol` **default yes**: "Apply a tolerance to the blend if this would make the blend succeed where it would otherwise fail"; `improve_tolerance` (default standard) | DOCUMENTED, V35 §75.2.1.3, §75.3.11; `overview-of-parasolid-v35-july-2022.md` |
| ACIS | `SPAresabs` 1e-6, `SPAresnor` 1e-10, `SPAresfit` 1e-3 (fit tolerance of procedural approximations) | Not stated in the blend docs | DOCUMENTED (`acis-r17-user-guide-booleans-technical-article.md`) |
| CGM | "tolerant modeling — designed in from the start" | Not public | DOCUMENTED marketing (engineering.com) |
| SMLib | – | "Tolerance value for the offset-intersection"; approximate circle "accuracy … as a percent of radius" | DOCUMENTED |
| C3D | – | Not on the `SmoothValues` page | – |
| Onshape FS | `TOLERANCE.zeroLength` 1e-8, `zeroAngle` 1e-11 (the Parasolid values) | "Tolerant radius" is a manufacturing annotation (±), not geometry | DOCUMENTED (`overview-of-parasolid-...md` §188, Onshape help) |

INFERRED consequences for wonky.

- Parasolid's default is **tolerance growth on failure**, up to 1e-5 m
  (10 µm) per blend edge. Onshape very likely inherits it, so some of Marc's
  fillets may "succeed" in Onshape only because of it.
  - wonky's rules forbid silent tolerance growth.
  - A wonky fillet that is exact where Onshape was tolerant is fine.
  - A wonky fillet that fails where Onshape silently widened a tolerance must
    report the needed tolerance, as Parasolid's `report` option does,
    instead of pretending.
- Rolling-ball blends between planes, cylinders, cones and spheres whose spine
  is a line or circle are exact cylinders, tori and spheres. They need no fit
  tolerance at all. Every commercial kernel simplifies to these "wherever
  possible".

## 8. Failure taxonomy

### 8.1 Kernel codes (DOCUMENTED)

Parasolid V35 `PK_blend_fault_*` (`fd_chap.080`) has 17 codes. The 15 v12
codes plus `rho_too_large_c` and `apex_range_c`:

- **Severe:** `vertex_c`, `unknown_c`.
- **Configuration:** `bsurf_c`, `range_c`, `edge_c`, `loop_c`,
  `overlap_edge_c`, `face_c`, `rho_too_large_c`, `other_edge_c`,
  `apex_range_c`.
- **Overlap:** `overlap_c`, `overlap_end_c`, `end_c`, `edge_intsec_c`.
- **Post-checks:** `face_face_c`, `self_int_c`. For these two, "the blend is
  fixed to the body" anyway.

Onshape's `FILLET_*` enum is the same list; see
`docs/research/sources/onshape-featurescript-std-...md`. ACIS has about 55
`BL_*` codes classified by type (PROG/APPL/USER/LIMT/IMPS) and area. Its most
frequent advice: "Try with a smaller blend radius".

### 8.2 What users report

| Failure | Mechanism | Evidence |
|---|---|---|
| "Radius of fillet on face too large" | The spring curve leaves the face; thin walls and ribs | Onshape forum https://forum.onshape.com/discussion/31157/issue-filleting-wing-loft-to-fuselage-loft (2026-06-08): 5 mm → this error. HEARSAY. The same thin-wall claim for SolidWorks is on cadshift.com, HEARSAY. |
| "Fillet produces a self-intersecting surface" | Radius larger than the local support curvature radius (a sharp airfoil trailing edge) | Same thread: 1 mm → this error. The author gave up on filleting and modelled the transition as a surface (loft + boundary surfaces). Another user proposed a variable fillet going to 0 at the trailing-edge vertex. HEARSAY. |
| Propagation into unwanted regions | Tangent propagation or overflow walks into a slot whose arc is not tangent to its sides | https://forum.onshape.com/discussion/17933/fillet-failures (2022-03); fixed "using Boolean subtraction", i.e. a fillet built as geometry. HEARSAY. |
| Over-selection | A face picked by mistake adds all its edges; turning off tangent propagation or overflow helps | https://forum.onshape.com/discussion/20012/why-arent-i-able-to-fillet-these-edges (2023-01). HEARSAY. |
| Complex vertices | ≥3 blended edges of mixed convexity, unequal radii | Parasolid and ACIS docs (DOCUMENTED); forums, generic |
| Order dependence | Works one way, fails the other | §6 |
| Silent wrong result | Local interference check loses a pocket | ACIS `…lo` (DOCUMENTED) |
| Silent no-op | build123d/OCCT: edges without `topo_parent` → "Nothing to chamfer", swallowed by try/except | Marc's `cad-fdm-design` SKILL (DOCUMENTED practice); Marc's FS code: "Ein still wirkungsloses Fillet faellt spaeter am Volumen auf" (`tray_r2.fs:56`) |
| Crash | Batch chamfer on tangent-rich parts segfaults OCC | Marc's SKILL (DOCUMENTED practice). The OCCT tracker "#25478 10-year-old" claim comes from cadshift.com, HEARSAY. |
| Fillet between separate bodies | Kernels fillet one body | Fusion forums, generic. HEARSAY. |

## 9. Workarounds, and what a kernel should do instead

| User workaround | Where it shows up | What it tells the kernel designer (INFERRED) |
|---|---|---|
| Lower the radius | ACIS error advice; all forums; **Marc's corpus** `try rad, then fallback` (MEASURED, §10) | Report the largest feasible radius per edge (`r·tan(θ/2) ≤ face width` for planes), so the user or LLM picks it deliberately. Never lower it silently. |
| Reorder features: large before small, draft before fillet, shell before or after | §6.2 | Offer one documented canonical order inside a multi-edge op (for example: same convexity together, concave before convex, large before small), and say which one. |
| Split into several fillet features | Parasolid "small groups"; `overlap_c` succeeds sequentially | Sequential application inside one op, with the order recorded, can replace user splitting. |
| Turn off tangent propagation or overflow | Onshape forums | Make overflow an explicit, reported outcome ("notch overflow used on edge E"), not a silent topology change. |
| Variable radius to zero at the problem vertex | Onshape wing thread | Out of scope for FDM tier 1. |
| Delete the corner faces and use a fill surface | Onshape tech tip 2022-04-05 https://www.onshape.com/en/resource-center/tech-tips/how-to-blend-fillets-using-the-fill-surface-feature | Vertex patches (n-sided) are the commercial answer; setback plus patch is the principled version. |
| Build the fillet as geometry: `Cylinder − Torus`, `Box − Cylinder`, Boolean subtraction | Marc's SKILL; Onshape forum 17933 | **Fillet by Boolean with blend solids** is a real, working user practice. It is ACIS stage 2. It is a prime prototype candidate. |
| Sketch-level fillets | Marc's SKILL: "Tangent blends become SKETCH VERTEX FILLETS (exact tangency, no boolean lottery)" | 2D fillets on profiles before extrusion avoid 3D blending for vertical edges entirely. The kernel could recognise "fillet on an edge parallel to the extrusion direction of a prism" and do it in 2D. |
| Chamfer first, convert to fillet | Fusion forums (HEARSAY) | – |

## 10. Onshape options and FeatureScript semantics

The full parameter contract is in
`docs/research/sources/onshape-featurescript-std-library-mirror-opfillet-opchamfer-.md`
and `onshape-help-fillet-and-face-blend.md`. The std library is MIT licensed
(© PTC), so wonky may reuse the wrappers verbatim with the notice. This
section adds the semantics, the INFERRED Parasolid mapping and the corpus
usage.

### 10.1 `opFillet` (std 2960, `tmp/research/onshape-std/geomOperations.fs` l.680–721)

| Parameter | Default (op / UI) | Semantics (DOCUMENTED) | Parasolid mapping (INFERRED) | Corpus use (MEASURED) |
|---|---|---|---|---|
| `entities` | – | Edges; a face means all its edges | Edges to `PK_EDGE_set_blend_*` | 191 call sites |
| `radius` | – / 5 mm | Bounds [0.01 mm, 500 m] (`BLEND_BOUNDS`) | constant range | yes (literals 0.6–8 mm, mostly variables) |
| `tangentPropagation` | **false** / true (UI) | "propagate the fillet along edges tangent to those passed in" | `PK_EDGE_find_g1_edges` before setting, or the `propagate` fix option | 101× false, 5× true (106 of 191) |
| `crossSection` | `CIRCULAR` | `CIRCULAR`, `CONIC` (rho), `CURVATURE` (magnitude); hidden `CHAMFER` | `xs_shape` conic / G2 / chamfer | 0 |
| `rho`, `magnitude` | – | rho in [0, 0.99999]; magnitude in [0, 0.999] | conic rho; G2 | 0 |
| `blendControlType` / `width` (hidden, feature-level) | `RADIUS` | Constant chord width | constant-width blend (V38+) | 0 |
| `isAsymmetric`, `otherRadius`, `flipAsymmetric` (hidden) | false | Two ranges | ranges | 0 |
| `partialFilletBounds` | – | `{boundaryEdge, boundaryParameter, isFlipped}` | blend limits (§75.3.14) | 0 |
| `isVariable`, `vertexSettings`, `pointOnEdgeSettings`, `smoothTransition` | false | VR; zero only at chain ends (`VRFILLET_INTERNAL_ZERO`) | `PK_EDGE_set_blend_chain` VRB rules (zero at ends only) | 0 |
| `allowEdgeOverflow` | **true** | "Allow `opFillet` to modify nearby edges to maintain the fillet profile" | overflow tokens left at their defaults (smooth → cliff → notch) | **never set, so always true** |
| `keepEdges` | none | "Edges you do not want `opFillet` to modify" | probably explicit cliff edges / notch prevention | 0 |
| `smoothCorners`, `smoothCornerExceptions` | false | "smooth all suitable corners and prevent creation of sharp edges"; help: "a rounded vertex between two filleted edges" | `vx_blend_data` vertex blending ("all suitable vertices" when none are given). This is a good match in wording. | 0 |
| `createDetachedSurface` | false | Output the fillet surface only | sheet previews (§75.3.20) | 0 |
| (`CURVATURE`) | – | Forces `allowEdgeOverflow = true` | – | – |

### 10.2 `opChamfer` (std 2960, l.285)

| Parameter | Default | Semantics | Corpus use (MEASURED) |
|---|---|---|---|
| `chamferType` | – | `EQUAL_OFFSETS` (`width`), `TWO_OFFSETS` (`width1/2`, `oppositeDirection`), `OFFSET_ANGLE` (`width`, `angle` [0.1°, 179.9°]) | `EQUAL_OFFSETS` only: 37 of 37 sites. Widths are 0.42 mm (Marc's deburr), 1.55 mm, or a variable. |
| `chamferMethod` (feature-level) | `FACE_OFFSET` | `FACE_OFFSET` ("Offset", edge-dependent) or `APEX_RANGE` ("Tangent", "from the intersection of the tangent of the two adjacent faces") | never set, so `FACE_OFFSET` |
| `tangentPropagation` | false (UI true) | as for fillets | set explicitly; the edge-break rings use it |
| `directionOverrides` | – | Per-edge side for asymmetric types | 0 |

### 10.3 Corpus usage in detail (MEASURED)

Commands: `grep -rl 'opFillet\|opChamfer' --include='*.fs' ~/Workspace/cad`
and key tallies. Read only. The counts include archive and copied files
(`archive/`, `cad-project-043/`, `var/`); 63 of the 99 files are outside those
folders.

- **Scale:** 99 FS files; 154 `opFillet` and 37 `opChamfer` call sites.
  No `fillet(` or `chamfer(` feature calls; everything goes through `op*`.
- **Edge selection:**
  - 75 of 99 files use `evLine` and 44 use `qGeometry`. Most blended edges
    are **straight lines picked by direction or position**, for example
    `r10b.fs` `roundX` (edges with `|dir.x| > 0.99999`) and `tray_r2.fs`
    `filletAtZ` (horizontal lines at height z).
  - 1 file filters by `EdgeConvexityType.CONVEX`; none by `evEdgeConvexity`.
  - 4 call sites fillet **every edge of a body**
    (`qOwnedByBody(b, EntityType.EDGE)`): `cad-project-030/src/cad-project-030.fs:56` (R0.65)
    and `:129` (R0.8), plus two copies in `cad-project-043/`. These hit sphere
    corners (C3) and mixed-convexity vertices (C6).
- **Failure handling:** 41 files use `try silent`, 77 use `try {`, 80 use
  `catch`. These are not all around fillets; 18 `try … opFillet/opChamfer`
  sites were matched.
- **Explicit radius fallback:**
  `cad-project-041/rocking-photo-tray-r6d-bereinigung/var/native/tray_r2.fs:66-67`
  does
  `try { opFillet(… rad …); return bb; } catch(e) {}` and then
  `try { opFillet(… fallback …); return bb; } catch(e) {}`. The comment reads
  "Erst mit rad, bei Kernelfehler mit fallback."
- **Propagation true** in 5 places, for example
  `cad-project-039/belt-central-r28/central-drive-r28.fs:312`
  (`rootBlend`, R5) and the 0.42 mm `edgeBreak` chamfer rings in
  `cad-project-002/*`.

INFERRED consequences:

- **Tier 1 (covers most of the corpus):** constant circular fillets and
  equal-offset face-offset chamfers on straight edges and circular edges
  between planes and cylinders; tangent propagation; 3×1 caps (C1, C2); 3×3
  equal-radius univex spheres (C3); an explicit fault otherwise.
- **The silent `allowEdgeOverflow: true` default is the biggest semantic
  risk.** Onshape may have overflowed (notched or cliffed) some of Marc's
  fillets without him ever knowing. wonky must either implement notch
  overflow (a Boolean trim of the unchanged blend surface, the easiest
  overflow type) or fail with a fault that names the overflow type Parasolid
  would have chosen.
- `try … catch` around fillets means a wonky failure changes the model
  *silently* at the FS level: the catch branch runs. A wonky `regenError`
  therefore must fail only where Onshape also fails, or Marc's parts change
  shape without an error. This is a strong argument for **Onshape-parity
  testing on the actual fillet call sites** (a Part 2 harness task).

## 11. FDM practice

| Rule | Source | Label |
|---|---|---|
| Printers "can cleanly print overhanging structures with an angle between 45 and 60 degrees"; newer Prusa machines up to 75° | Prusa KB https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135 | DOCUMENTED (vendor) |
| Fillets oriented toward the bed create "a very steep overhang"; "use chamfer instead if a perfect part finish is a priority" | Prusa KB | DOCUMENTED (vendor) |
| 45° chamfer or radius on edges touching the build plate against elephant's foot, and to ease removal | Protolabs/Hubs FDM guide https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/ | DOCUMENTED via search snippet |
| A fillet's top tangent approaches horizontal and violates the 45° rule; a 45° chamfer does not | Snapmaker and others | HEARSAY (blogs) |
| **Marc's house style:** pick the bed face first; vertical edges R4.2 fillet; all other non-critical edges a 0.42 mm chamfer "run as CONTINUOUS rings including corner arcs — a chamfer dead-ending into a fillet leaves >45° blend patches"; dimension-critical edges stay sharp; where R4.2 would eat a wall, use "the largest radius that keeps ≥1 mm web" | `~/.claude/skills/cad-fdm-design/SKILL.md` | DOCUMENTED (Marc's practice) |
| Every re-entrant junction gets a notch fillet R2–6, via "a generic notch-fillet pass (scan concave plane/cyl line edges, fillet with radius fallback)" | same | DOCUMENTED (Marc's practice) |
| Order: raw → notch fillets → blends → one deburr pass | same | DOCUMENTED (Marc's practice) |
| "No feather edges": chamfers wrapping arcs into walls taper below about 0.5 mm and print as fuzz | same | DOCUMENTED (Marc's practice) |
| Horizontal bores: teardrop with the 45° apex up | same | DOCUMENTED (Marc's practice) |

INFERRED kernel requirements from FDM practice:

1. **Chamfer rings are first class.** A 0.42 mm ring around a profile with
   arcs is a chain of plane/plane chamfers (planes) and plane/cylinder
   chamfers (cones), tangent-continuous where the profile is. That means
   chamfer tangent propagation along smooth edge chains (the ACIS
   smooth-edge-sequence table), and cones as exact output.
2. **Vertical R4.2 then chamfer ring**: the ring runs over the top and bottom
   edges of the R4.2 cylinders, so it is a plane/cylinder chamfer, a cone.
   This is sequential by design (fillet feature first, then chamfer feature),
   so Parasolid's "no chamfer + rolling ball in one fix" rule never bites.
   wonky needs chamfers that run *over* existing fillet faces (plane/cylinder,
   plane/torus at corners).
3. **Largest-feasible-radius query**: Marc's "largest radius that keeps ≥1 mm
   web" and his fallback radii ask for a kernel query ("max r for this edge
   set") more than for a smarter fillet.
4. Bottom-edge chamfer vs fillet is a *design* rule, not a kernel rule. A
   linter can flag bed-facing fillets once the bed face is known. Out of
   scope for the kernel.

## 12. Wheat and chaff

**Adopt** (INFERRED unless noted):

- The attribute → spine/spring → sheet → attach pipeline. The sheet-attach
  step should be done by wonky's corefine + recover Boolean: "fillet by
  Boolean with blend solids". ACIS does it, SMLib calls it trimming plus
  sewing, and Marc does it by hand.
- Analytic simplification as the *primary* path, not an optimisation:
  line spine → cylinder, circle spine → torus, point → sphere. Plane/plane,
  plane/cylinder, cylinder/cylinder coaxial and plane/cone cover the corpus.
- Parasolid's configuration rules as a vertex classifier (valence ×
  blended × convexity), and SMLib's N×M naming for the handler table.
- Parasolid fault taxonomy with Onshape names, plus ACIS's type axis
  (USER / IMPS / LIMT / PROG), because the FS `try/catch` sites depend on it.
- Overflow as an explicit, typed outcome (smooth / cliff / notch), with
  notch first to implement because it keeps the blend surface and only trims
  it.
- Documented deterministic ordering (convexity classes, then radius),
  recorded in the result, as Parasolid does with `vx_order`.
- Provenance of blend faces (Parasolid `edges` / `vx_twin` / `unders`
  tracking). wonky's identity layer makes this exact.
- A "largest feasible radius" diagnostic, as ACIS's "try a smaller radius"
  made precise.

**Reject:**

- Silent tolerance growth (Parasolid `set_tol` default yes, up to 1e-5 m).
- Local-only interference checking that loses features (ACIS default).
- Kept-but-flagged self-intersecting results (Parasolid `face_face_c` /
  `self_int_c`: "the blend is fixed to the body").
- Mutable blend attributes stored on the B-rep (the ACIS warnings). Wonky
  keeps requests as immutable FS maps.
- Order *search* (FilletXpert) inside regeneration, unless the chosen order
  is recorded and replayed deterministically.
- `strict = false` ("round at least what is possible", C3D; Creo Auto Round
  "exclude edges that could not be rounded") as a *default*. Partial success
  must be an explicit mode with a list of skipped edges, never implicit.

**Patents** (DOCUMENTED on Google Patents, local copies in `tmp/research/`):

| Patent | Subject | Status | Implication |
|---|---|---|---|
| US5615317A (HP, Freitag, 1993) | Shrink-only blend integration with Euler ops | Expired (2014) | Free to implement |
| US6133922A (HP, Opitz, 1996) | Gap closing via trimming-path DFS | Expired (2017) | Free to implement |
| US9690878B2 (Siemens; Mattson, King, Sanders) | "Geometric modeling with mutually dependent blends": blend ribbons, ribbon breakers, reblending | **Active, expires 2036-04-24** | About reblending existing blends (direct edit). Do not implement ribbon-breaker reblending; wonky's provenance makes it unnecessary. |
| US8935130B2 (Siemens; Mawby, Yu, Mao) | "Notch blends in BRep models": recognise notch/cliff blends, chain and label them | **Active, expires 2032-12-15** | About *recognition* of notch blends. Creating notch overflows is documented Parasolid behaviour, but check claims before shipping anything that recognises and chains notch blends in imported models. Not legal advice. |

**Licenses:**

- None of the commercial kernels (Parasolid, ACIS, ShapeManager, CGM, C3D,
  Granite, SMLib) has code that can be ported. All are proprietary, and
  their docs are read-only references: re-express in our own words, copy
  nothing.
- The Onshape std library is MIT (© PTC). It can be copied with the notice;
  it contains no geometry.
- OCCT (LGPL 2.1 with exception) is covered elsewhere. It is oracle only;
  `AGENTS.md` forbids it in production.

## 13. Prototype candidates this survey points to (for Part 2)

1. **Analytic closed-form tier plus Boolean attach**, "fillet by Boolean with
   blend solids": for each edge build the exact blend "sweep" solid
   (cylinder, torus or cone wedge) and subtract or add it with the hybrid
   Boolean; corners as sphere octants (C3); caps come for free from the
   Boolean.
   - Closest to Marc's manual practice and to ACIS stage 2.
   - Risks: tangent (G1) contacts are exactly the Boolean's hardest case.
     The blend solid touches the supports tangentially along the spring
     curves.
2. **Local topological surgery** (HP/CoCreate, expired patents; Parasolid-style
   fix):
   - compute spring curves analytically;
   - kill or trim edges around each end vertex;
   - insert blend faces;
   - classify vertices by the Parasolid/SMLib table.
   - Avoids tangent Booleans, but needs its own robust trimming.
3. **OCCT ChFi3d-style port** (ideas only, oracle for comparison). See the
   OCCT note; mentioned here for completeness.
4. **Overflow add-on**: notch overflow as a Boolean trim of the unchanged
   blend surface, to match `allowEdgeOverflow: true` defaults on the corpus.
5. **Chamfer track**: face-offset chamfers (planes and cones) with tangent
   propagation rings. The corpus's second most common blend, and FDM-critical.

## 14. Open questions

- Is Onshape's `smoothCorners` really Parasolid `vx_blend_data`? The wording
  matches; not verified. It could be tested with an Onshape document through
  the bridge (onshape-bridge skill), budget permitting.
- What does Onshape do on the corpus fillet sites: were any overflowed,
  tolerant, or face-range-limited? This needs an Onshape-parity run of the
  corpus fillet call sites (Part 2, harness).
- Granite and ShapeManager internals: nothing public beyond the feature
  layers. No further effort planned; the Parasolid and ACIS docs cover the
  design space.
- The SolidWorks help texts could only be read through search snippets. The
  statements are plausible and consistent across years (2013–2026 page
  titles), but unverified in full text.

## 15. Sources

Accessed 2026-09-23 unless noted. The license column applies to reuse of
content or code.

| Source | Kind | License | Label |
|---|---|---|---|
| Parasolid V35 Functional Description ch. 74–80, http://www.q-solid.com/Parasolid_Docs_V35/chapters/fd_chap.074.html … `fd_chap.080.html`; local `tmp/fillet/commercial/ps35_fd_chap.*` | vendor docs (third-party mirror; provenance HEARSAY) | proprietary, read-only | DOCUMENTED |
| Parasolid v12 edge blending, see `docs/research/sources/parasolid-v12-functional-description-edge-blending-chapters-.md` | vendor docs | proprietary | DOCUMENTED |
| Parasolid V38/V39 blogs (Siemens, S. Peruch); local `tmp/research/vendor-blogs/parasolid-v3{8,9}.txt` | vendor blog | proprietary | DOCUMENTED |
| ACIS R17/R10 blending, see `docs/research/sources/acis-blending-documentation-r17-technical-articles-r10-blnd-.md` | vendor docs | proprietary | DOCUMENTED |
| CGM CAA "Creating Fillets", https://www.maruf.ca/files/caadoc/CAATopUseCases/CAATopAllFillets.htm | vendor dev docs (mirror) | proprietary | DOCUMENTED |
| CATIA V5 Edge Fillet user guide, https://www.staff.city.ac.uk/~ra600/ME2105/Catia%20course/CATIA%20Tutorials/prtug_C2/prtugbt0606.htm | vendor docs (mirror) | proprietary | DOCUMENTED |
| C3D `SmoothValues`, https://c3d.ascon.net/doc/math/struct_smooth_values.html ; Solid Modeling group, https://c3dlabs.com/doc/group___solid___modeling.html | vendor API docs | proprietary | DOCUMENTED |
| SMLib fillets, https://docs.nvidia.com/smlib/manual/smlib/fillets | vendor manual | proprietary | DOCUMENTED |
| Creo round transitions, https://support.ptc.com/help/creo/creo_pma/r9.0/usascii/part_modeling/part_modeling/Round_Transition_Types.html ; Auto Round and creation methods (search snippets) | vendor help | proprietary | DOCUMENTED / snippet |
| ShapeManager, https://en.wikipedia.org/wiki/ShapeManager | encyclopedia | CC BY-SA | HEARSAY |
| Onshape std library mirror, https://github.com/javawizard/onshape-std-library-mirror ; local `tmp/research/onshape-std/` | source code | **MIT** (© PTC) | DOCUMENTED |
| Onshape help Fillet, https://cad.onshape.com/help/Content/fillet.htm | vendor help | proprietary | DOCUMENTED |
| Onshape tech tips (2022-07-12, 2022-04-05) | vendor articles | proprietary | DOCUMENTED |
| Onshape forum 31157, 17933, 20012, 25916 | user forum | – | HEARSAY |
| SolidWorks help (Fillet Overview, Overflow Type, FilletXpert), via search snippets | vendor help | proprietary | HEARSAY-strength |
| Fusion: cadedllc.com (2026-07-31), Autodesk forums, cadin360.com | blogs, forums | – | HEARSAY |
| cadshift.com fillet kernel comparison | marketing blog | – | HEARSAY (low quality) |
| Prusa KB, Protolabs/Hubs FDM guide | vendor guides | proprietary | DOCUMENTED |
| US5615317A, US6133922A (expired); US9690878B2, US8935130B2 (active); local `tmp/research/blend-patents/`, `tmp/research/US*.html`, text in `tmp/fillet/commercial/US*.txt` | patents | patent text public; claims enforceable while active | DOCUMENTED |
| Marc's corpus `~/Workspace/cad/**/*.fs` (read only) | code | Marc's | MEASURED |
| Marc's `~/.claude/skills/cad-fdm-design/SKILL.md` | practice notes | Marc's | DOCUMENTED |
