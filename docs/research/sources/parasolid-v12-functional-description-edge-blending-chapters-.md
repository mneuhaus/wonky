# Parasolid v12 Functional Description: Edge Blending chapters (overview, options, overflows, error codes)

- **Kind:** vendor documentation (Parasolid Functional Description, HTML).
- **Canonical URL:** http://www.q-solid.com/Parasolid_Docs/chapters/fd_chap.30.html (HTTP 200 on 2026-09-23).
- **Other URLs:**
  - http://www.q-solid.com/Parasolid_Docs/chapters/fd_chap.31.html (Edge Blending Functions and Options)
  - http://www.q-solid.com/Parasolid_Docs/chapters/fd_chap.32.html (Edge Blend Overflows)
  - http://www.q-solid.com/Parasolid_Docs/chapters/fd_chap.33.html (Interpreting Edge Blending Error Codes)
  - Also read: http://www.q-solid.com/Parasolid_Docs/chapters/fd_chap.34.html (Face-Face Blending), because it is the model behind Onshape's `opFaceBlend`.
  - Local copies (HTML + text): `tmp/research/parasolid-blend/fd_chap.30–34.{html,txt}`.
  - The file numbers are offset by one from the chapter numbers: `fd_chap.30` holds chapter 29, `fd_chap.33` holds chapter 32.
- **Authors / organization:** EDS/UGS, now Siemens Digital Industries Software. The page titles say "Parasolid v12.0" (about 2000).
  - The text also mentions "enhancements added at Parasolid V13.0" and an `update` option to reproduce "Parasolid V12.1" results (fd_chap.31, §30.3.10). INFERRED: the pages are a v13-era edit carried under a v12 title.
  - The q-solid.com mirror's provenance is unknown (HEARSAY that it is an authorised copy). The content itself is DOCUMENTED.
- **License:** proprietary documentation, read-only.
  - The taxonomy, the option semantics and the fault classes are functional facts that wonky can re-express in its own words and names.
  - Do not copy text or figures. INFERRED; not legal advice.
- **Status:** historical. The concepts are still current: Onshape's FeatureScript error enum reproduces 12 of these fault codes verbatim, see the Onshape std-library note. Parasolid itself is at V38 (see `overview-of-parasolid-v35-july-2022.md`).

## What it is

These are Parasolid's own user docs for edge blending: the vocabulary and failure model of the kernel that (INFERRED, via the matching error strings) sits under Onshape. There are four chapters:

1. **Overview (ch. 29):**
   - fixed vs unfixed blends;
   - blend types and ranges;
   - limitations as "rules of thumb" by vertex configuration;
   - variable-radius rules;
   - blend surface output;
   - deleting blends.
2. **Functions and options (ch. 30):**
   - attach, enquire, check, remove, fix;
   - propagation;
   - cliffedge, Y-shaped and setback blends;
   - tracking (`vx_twin`), local checking, preserving overlapped topology, notch preservation, vertex blending;
   - per-blend properties (overflow tokens, propagation, tolerance, linear variation) and update control.
3. **Overflows (ch. 31):** definitions, the four overflow types, the defaults, and eight worked internal/external cases.
4. **Error codes (ch. 32):** 15 fault codes in three classes, with recovery advice.

## How it works

Everything in this section is DOCUMENTED on the pages named in brackets, unless labelled otherwise.

### Two-stage model: unfixed attributes, then fix (ch. 29.2, 30.2)

- **Attach.** `PK_EDGE_set_blend_constant`, `PK_EDGE_set_blend_chamfer` or `PK_EDGE_set_blend_variable` attaches a *system attribute* to an edge. The body geometry is not changed. "Simple checks are made to ensure the parameters have sensible values."
- **Edit while unfixed.** An unfixed blend "can be sketched, checked and modified" or removed (`PK_EDGE_remove_blend`). "Once a blend has been fixed it may not be possible to restore the original edge, except by using roll-back."
- **Enquire.**
  - `PK_EDGE_ask_blend` returns the type, the left/right faces, the shape, the properties and the cliff edge.
  - `PK_EDGE_find_blend_topol` returns "the faces and edges which are guaranteed to be affected by the unfixed blend".
- **Check.** `PK_EDGE_check_blends` has two levels:
  - `PK_blend_check_vertex_c`: consistency at vertices;
  - `PK_blend_check_full_c`: additionally, legal blend boundaries.

  The docs warn: **"PK_EDGE_check_blends is not foolproof, the only guaranteed test of a blend is to FIX it."**
- **Fix.** `PK_BODY_fix_blends` turns every attributed edge into faces, optionally with local checks (`local_check`, default false).
- **Propagation during fix (§30.2.6).** If a blend can only be fixed by spreading onto a *nearly tangent*, not user-blended edge, the `propagate` option chooses one of three behaviours:
  - propagate (the default);
  - call a user callback;
  - fail with `PK_blend_fault_edge_c` plus the tag of that edge.

  A threshold angle is configurable.
- **Practical advice:** "it is best to make and fix blends in small groups" (§29.4).

### Blend types and ranges (ch. 29.2)

- **Rolling ball** (constant radius): the envelope of a sphere rolled along the two adjacent surfaces.
- **Chamfer.** "The extent of chamfer blends is determined by the offset surfaces being intersected; the resulting curves being projected onto the underlying surface; between which the chamfer blend is constructed."
  - Consequence: for fixed ranges, the chamfer width shrinks as the dihedral angle opens.
  - "In extreme cases, if there is a great difference between the ranges on the two faces it is possible that the chamfer is not defined at all" (Fig. 29-5).
  - Closed form for a plane/plane edge (INFERRED, derived here from the offset-intersect-project definition; not in the docs): let α be the interior dihedral angle, and offset face 1 by `d1` and face 2 by `d2` into the material. The spine is where the offsets meet; its foot on face 1 lies at distance `t1 = (d2 + d1·cos α) / sin α` from the edge, and on face 2 at `t2 = (d1 + d2·cos α) / sin α`. Checks: at α = 90° `t1 = d2`, `t2 = d1` (the range offset of one face sets the contact distance on the *other* face); for `d1 = d2 = d`, `t = d·cot(α/2)`, which → 0 as α → 180° (the "width shrinks" remark). The chamfer is undefined when `t1 ≤ 0` or `t2 ≤ 0`, i.e. `cos α ≤ −d2/d1` (or `−d1/d2`), which is only possible for obtuse α and very unequal ranges: the Fig. 29-5 case. An exact-predicate version needs only `n1·n2` and `|n1×n2|` of the two plane normals, so it can be decided with rational/multi-limb arithmetic for rational normals.
  - "In general, chamfer blends are not tangent continuous with the faces adjoining the original edge."
- **Variable rolling ball (VRB):**
  - Equal ranges with all rho = 0 give a circular section. Unequal ranges with rho = 0 give an elliptical section.
  - rho ∈ (0, 0.5) is elliptical ("as rho approaches zero the blend becomes flatter"), rho = 0.5 is parabolic, rho ∈ (0.5, 1) is hyperbolic ("more and more L-shaped"). "A value of rho equal to 1 is not allowed."
  - Rho must be zero at every point or non-zero at every point.
  - Radii must be defined at ≥ 2 distinct points, including both vertices.
  - "VRBs can have zero radius at one or both ends, but not in the middle."
  - A VRB is not allowed on an edge with no vertices.
- **Output (§29.6):**
  - Internally there is "only one type of blend surface, the blended edge". Its data are `geom_1`, `geom_2` (the two original surfaces), `radii[2]`, `spine` ("the curve defining the center of the rolling ball") and `spine_ext`.
  - **"Wherever possible, Parasolid simplifies fixed rolling ball blends to tori and cylinders."**
  - Fixed chamfers are "always planes, cylinders, cones or B-surfaces".
  - For a block with three equal-radius edges at one vertex, fixing creates "four faces … (one for each edge and a piece of sphere at the vertex)" (§30.3.4).

### Limitation rules by configuration (ch. 29.3–29.4)

- **General:**
  - An edge ending at a point tangency can be blended, except with an asymmetric chamfer or an asymmetric conic.
  - The range must be consistent with the face geometry: "it must be possible to move away from all points in the second face by at least the distance specified by the given range".
  - "The offsets, by the relevant ranges, of the surfaces … must not self intersect and must intersect to define a spine curve for the blend." One exception is pictured: a small rolling ball next to a larger blend.
- **One edge at a 3-edge vertex:** normally possible. It fails when "the end surface is undefined" (Fig. 29-9).
- **One edge at a vertex with more than 3 edges:** possible if the ranges are small enough that "the sides of the blend end on other edges at the same vertex" and the end can be capped "with existing faces, extending at most two of the adjoining faces".
- **Two of three edges at a vertex:** "both blends must add material or both blends must remove material".
- **Three of three:** "an extra blend face is added to smooth out the vertex". They must be fixed as a group.
- **Two edges at a 4-edge vertex:** the other pair must be tangent, or not share a face and have the same convexity. The convexity must not change at the vertex, and both must be picked before either is fixed.
- **B-surfaces (§29.5.1):** extending the third face to terminate the blend may be impossible, and "It may not be possible to extend the offsets of B-surfaces far enough to define the spine curve."

### Options (ch. 30.3)

- **Cliffedge blend:** tangent to only one face; it "runs along an edge in the other" face. Not allowed with `propagate`.
- **Y-shaped blends:** at a vertex with ≥ 3 edges where two adjacent blends of *different convexity* meet. Rules:
  - one or two Y-blends per vertex;
  - the Y edges are adjacent and meet smoothly (unless meeting another Y);
  - other edges carry no blend or a Y-blend.

  A smooth unblended edge is extended to end the patch if possible; otherwise Parasolid "creates suitable geometry automatically". Y-blends "tend to create faces with a lower curvature".
- **Setbacks:**
  - "the blend is trimmed back by approximately the specified distance. The remaining gap is then patched smoothly by a collection of faces."
  - Only allowed when **all** edges at a vertex with ≥ 3 edges are blended; not available for chamfers.
  - "Specifying a zero setback on an edge ensures that no setback blending occurs on that edge", which is different from supplying no setback. With no setback, "Parasolid tries to create the best surface possible", which may itself be a setback blend.
  - Setbacks are passed at fix time, with `which_end`.
- **Tracking:** `PK_BODY_fix_blends` returns the blend faces plus a parallel `edges` array of originating (dead) edge tags. With **`vx_twin`**, vertex-derived faces report the dead *vertex* tag instead. This is provenance at the API level.
- **Local checking:** new surfaces are checked for self-intersection, invalid faces and face-face inconsistency.
- **`transfer` (preserve overlapped topology):** by default "any topology in the region completely overlapped by the blend is deleted". With `transfer`, a hole overlapped by a large blend is moved into the blend face, provided it is deep enough to intersect the blend.
- **`preserve_notch`** (sheets only): projects notch edges normally onto the blend.
- **Vertex blending (`vx_blend_data`):** further smooths blended edges at vertices, "past sharp edges of opposite convexity". It may produce more than one surface.
- **Per-blend properties:** ribs; overflow tokens; `draw_fix`; `propagate` ("over tangent edges, or past other blends if the resultant three edge vertex would otherwise be invalid"); `tolerance` (chamfer/VRB); `vary` (linear range variation; the default constrains the variation so that a VRB meets neighbouring blends tangentially at the vertices).
- **`update`:** reproduce the V12.1 behaviour or enable the V13 "advanced capping techniques". This is an early example of version-pinned regeneration semantics, the same pattern as Onshape's `isAtVersionOrLater`.

### Deleting blends (§29.7)

- `PK_FACE_delete_blends` "takes into account topological changes that occur during blending … as close to an inverse blend as possible", but "cannot recreate any topology that was completely destroyed".
- It assumes that the faces were created by blending.
- `PK_FACE_delete_facesets` also removes constant-radius rolling-ball blends.

### Overflows (ch. 31)

- **Definition:** an overflow occurs when the blend "as defined by its basic parameters, would leave one or both of the faces adjacent to the edge being blended".
  - It is **internal** if the blend lies in an adjacent face on both sides of the overflow, and **external** if it happens at one end.
  - **Bounds** are the edges bounding the overflow region; **overflow edges** are the other edges at vertices between the bounds.
  - **Convexity** is the convexity of the bounds relative to the blended edge.
- **The four types:**
  - **Smooth:** the blend is replaced by an equivalent blend on the overflow face(s). Requires all bounds and overflow edges to be smooth.
  - **Cliff:** a series of cliffedge blends runs around the overflow region. The overflow edges must be smooth; the bounds need not be.
  - **Cliff-end:** "cliff and overflow" at the ends of edges.
  - **Notch:** "the blend surface remains the same, and the blend is trimmed using the faces in the notch".
- **Default attempt order:** smooth, then cliffedge, then notch. Tokens `PK_blend_ov_{smooth,cliff,cliff_end,notch}_*` prevent or allow each type. "When no allowed overflow type can be created, the blend operation fails."
- **Internal overflows** need exactly one overflow edge per vertex (all vertices between the bounds are 3-valent). Smooth internal overflows may run more than one face away.
- **Worked defaults** (Figs. 31-10 to 31-35):

| case | default |
|---|---|
| internal, sharp bound of **opposite** convexity | cliffedge, which becomes a **notch** as the radius grows and "the cliffedge becomes unstable" |
| internal, smooth bound, opposite convexity | smooth (a notch is impossible) |
| internal, sharp bound, same convexity | notch (smooth impossible) |
| internal, smooth bound, same convexity | notch (smooth or cliff on request) |
| external, sharp, opposite | notch |
| external, smooth, opposite | smooth |
| external, sharp, same | notch |
| external, smooth, same | notch |

- External cliff overflows always need `cliff_end_yes`.

### Fault codes (ch. 32)

1. **Severe** (the edge can never be blended in this configuration):
   - `PK_blend_fault_vertex_c`: "configuration of edges at vertex too complex". Two or more edges blended at some 4-edge vertices and at vertices with ≥ 5 edges. "A vertex can usually be blended if all of the edges meeting at the vertex are blended."
   - `PK_blend_fault_unknown_c`: an unclassified numerical failure; "may be possible … if the blend radius is changed".
2. **General configuration.** "It should always be possible to recover … by changing the blend radius, applying appropriate blends to other edges, removing blends from some edges."
   - `PK_blend_fault_bsurf_c`: invalid B-surface extension, or offsets too short to define a spine.
   - `PK_blend_fault_range_c`: range inconsistent with an adjacent blended edge; the example has a tangent third edge.
   - `PK_blend_fault_edge_c`: adjoining edge not blended (an illegal two-of-three configuration).
   - `PK_blend_fault_loop_c`: the blend completely overlaps an edge loop.
   - `PK_blend_fault_overlap_edge_c`: an unblended edge is overlapped because face F cannot be extended to meet the blend.
   - `PK_blend_fault_face_c`: range on face too large, i.e. "no edge can be found to terminate the boundary curve of a blend".
   - `PK_blend_fault_other_edge_c`: an illegal blend elsewhere on the face prevented the full check.
3. **Overlapping blends** (blends reaching non-adjacent faces):
   - `PK_blend_fault_overlap_c`: overlapping blends fixed simultaneously; they succeed when fixed one after another (Fig. 32-8 vs 32-9);
   - `PK_blend_fault_overlap_end_c`: illegal overlap on an end boundary;
   - `PK_blend_fault_end_c`: illegal end boundary;
   - `PK_blend_fault_edge_intsec_c`: an end boundary intersects an unblended edge;
   - `PK_blend_fault_face_face_c` and `PK_blend_fault_self_int_c`: only reported when the optional checks are on. "The blend is fixed to the body", meaning the result is kept even though it is flagged.
- "In practice blending almost certainly involves a degree of trial and error."

### Face-face blending (ch. 33, background for `opFaceBlend`)

- A face-face blend joins two walls (face sets that need not be adjacent or in one body). It is created and fixed in one call.
- Three independent choices define it:
  1. **Cross-section plane:**
     - rolling ball: orthogonal to the walls;
     - disc: orthogonal to a supplied *parameter spine*;
     - isoparameter: from isolines of the left wall.
  2. **Contact points:**
     - a constant radius;
     - variable ranges as 1-D law curves;
     - a constant width with a ratio (rolling ball only);
     - or holdlines: tangent, conic, double-conic.
     - Cliffedges locally constrain the boundary without tangency.
  3. **Cross-section shape:** conic (circular, elliptic, hyperbolic), chamfer, or curvature-continuous.
- Further controls: trimming (blend faces, walls, to a plane), propagation, notches and multiple solutions (keep all or one).
- **"Blend ribs"** are a graceful-failure output: when no surface can be made, Parasolid returns curves and points describing the intended blend "to a more general surface-creation package".
- INFERRED: Onshape's `opFaceBlend` parameters map one-to-one onto these concepts:
  - `side1`/`side2` are the walls;
  - `SWEPT_PROFILE` + `spine` is the disc cross-section;
  - the hold lines, cliff edges and caps are the same concepts;
  - `helpPoint` is "multiple solutions";
  - `detach` is making the sheet without attaching it.

## Robustness and guarantees

- **No guarantees are claimed.** The docs call the limitation rules "rules of thumb which apply in the majority of cases", and they say it "is not possible to lay down hard and fast rules which can always be guaranteed". DOCUMENTED, §29.3.
- The checker is explicitly incomplete ("not foolproof"). Only fixing decides.
- The self-intersection and face-face checks are optional. When they fire, "the blend is fixed to the body" anyway: the result is kept and flagged. DOCUMENTED §32.4.5–6.
- No numeric tolerances are stated in these chapters, except a per-blend `tolerance` for chamfers and VRBs. INFERRED: tolerances come from Parasolid's global session precision (see the XT/overview notes).

## Parallelism and performance

None documented. There are no timings in these chapters. INFERRED: the attach/check/fix split exists partly for interactivity (sketching unfixed blends), not for throughput.

## Known failures, limitations, war stories

These are the docs' own admissions, all DOCUMENTED:

- vertices with ≥ 5 edges or certain 4-edge vertices are unblendable unless every edge is blended;
- B-surface offsets may be too short to define a spine;
- mixed convexity at two-of-three vertices is illegal;
- cliffedge overflows turn into notches as the radius grows;
- blends that succeed one at a time fail when fixed together (`overlap_c`);
- "trial and error" is the expected workflow.

The Onshape FeatureScript enum still carries these exact codes 25 years later (`FILLET_*`, `CHAMFER_*`, `EDGEBLEND_*`). INFERRED: this taxonomy survived because it maps to real, persistent geometric impossibilities.

## Relevance for wonky

- **Error enum (adopt the taxonomy):**
  - wonky's `FilletFault` should reproduce the 15 classes, named after Onshape's `FILLET_*` strings (see the Onshape note) so FS code sees familiar errors.
  - Add wonky-only reasons for things it refuses by design: `UnsupportedSurfacePair`, `NeedsOverflow{type}`, `UnsupportedVertexConfig{valence, convexities}`, `VariableConvexityEdge`.
  - Every fault carries the offending edge, vertex or face identity, as Parasolid returns tags.
- **Architecture fit with Bend (INFERRED):** the attach-check-fix split maps naturally onto immutable data. A blend spec is plain data keyed by edge identity. The fix is a pure function `fix(body, specs) -> Result<body, [Fault]>`. Wonky should follow Parasolid's own conclusion and make **fix the check**: compute the result, validate it (watertightness, face-face and self-intersection checks, certified deviation), and fail explicitly. A separate predictive checker that can be wrong is not worth having.
- **Parallel structure (INFERRED):**
  - per-edge geometry (offset-surface intersection → spine → spring curves): uniform work per edge, GPU-batchable;
  - per-vertex classification (valence, number of blended edges, convexities, smoothness): a table-driven U32 classifier implementing §29.3–29.4 plus the fault codes;
  - per-face range and overflow detection (do the spring curves stay inside the face?): fork-join over faces;
  - rebuild: a functional face-graph rewrite (see the Braid note).
- **First-cut policy (INFERRED):**
  - support terminal vertices (one blended edge ends at a 3-edge vertex and is capped by the third face, which covers Marc's `roundX`);
  - support three-of-three equal-radius convex (or all-concave) plane corners with a **sphere** vertex face, which is exactly what Parasolid produces;
  - support smooth tangent chains (bi-blend);
  - reject everything else with the matching fault;
  - **reject all overflow** and report which overflow type Parasolid would default to (the table above), so the user knows what Onshape would have done.
  - Later tiers, in rising difficulty: notch (the blend surface is unchanged and trimmed by the notch faces, i.e. a Boolean trim of analytic surfaces), cliff (for straight edges on planes, a cliffedge blend is a cylinder tangent to one plane that contains the cliff line, still analytic), smooth overflow (re-rolling onto a new face pair).
- **Provenance and diff:**
  - The `vx_twin` idea (vertex faces map to the dead vertex) is a direct model for wonky's naming: blend faces carry `(source edge | source vertex, spec)`.
  - `PK_FACE_delete_blends` shows why this matters: an inverse blend needs the tracking; recognition alone is lossy.
  - wonky's identity layer makes defillet and diffs exact. INFERRED.
- **Testing:** the figures in ch. 29–32 amount to a regression checklist. Build one fixture per case:
  - one edge at a 3-edge vertex;
  - two of three at a vertex (same convexity OK, mixed convexity → `edge_c`);
  - three of three (sphere corner);
  - two edges at a 4-edge vertex (legal and illegal variants);
  - range too large on a face (`face_c`);
  - a blend overlapping a hole (default delete vs `transfer`);
  - the eight overflow cases;
  - overlapping blends fixed together vs sequentially;
  - a chamfer whose ranges differ too much to be defined.
- **FDM:**
  - Most printed-part blends are plane/plane and plane/cylinder at 3-valent vertices (boxes, bosses, holes), so the first-cut policy covers them.
  - Overflow cases appear when a fillet on a thin rib is larger than the rib thickness. That should fail clearly (`FILLET_FACE_RANGE_TOO_LARGE`) and suggest a radius bound, computable as `r·tan(θ/2) ≤ face width`.

## Pointers worth porting or studying

- `fd_chap.30` §29.2.2 (chamfer range rule), §29.3–29.4 (the vertex-configuration rules: encode them as a classifier), §29.5 (VRB rules), §29.6 (the blend-surface record `geom_1, geom_2, radii, spine, spine_ext`, a good shape for wonky's internal blend-surface type before it is simplified to a cylinder or torus), §29.7 (delete blends).
- `fd_chap.31` §30.2.6 (propagation policy and failure), §30.3.2 (Y-blend rules), §30.3.3 (setback semantics, including "zero setback ≠ no setback"), §30.3.4 (`vx_twin` tracking), §30.3.6 (`transfer`).
- `fd_chap.32` §31.2 (overflow definitions) and §31.4 (defaults table): reproduce as data.
- `fd_chap.33` whole chapter: the fault taxonomy and recovery advice.
- `fd_chap.34` §33.2–33.5 (face-face concepts), §33.10 (ribs as a failure artefact). This is the reference when `opFaceBlend` support is ever considered.

## Verdict: learn-from

This is the best public statement of *why* blends fail and what a production kernel does about it. Adopt its taxonomy (as Onshape-named enums), its configuration rules (as a classifier) and its overflow defaults (as documented diagnostics). Nothing can be copied and there is no algorithmic detail on how spines or caps are computed, so it is not a porting source; the geometry comes from OCCT ChFiKPart-style closed forms and Rossignac-style offset semantics.
