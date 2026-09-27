# ACIS blending documentation (R17 user-guide technical articles; R10 BLND and ABL PDFs)

## Source

- **Kind:** vendor documentation for Spatial ACIS: the standard Blending Component (BLND) and the Advanced Blending Component (ABL).
- **Canonical URL (R17 HTML, Blending overview):** http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/SPAacisuser_moblnd.htm
  - The 26 linked subpages are `SPAacisuser_moblnd{cr,ad,si,ro,bg,bt,ca,se,re,st,ve,br,lo,sh,ba,sm,er}.htm` (standard) and `…moblnd{abf,abc,aba,abp,aeb,aee,teb,asc}.htm` (advanced).
  - All were read in full from local copies in `tmp/research/acis-r17/moblnd*.htm|txt`.
  - "Sequences of blended edges" is `SPAacisuser_moblndse.htm`.
- **R10 PDFs (Arizona mirror):**
  - BLND Component chapter 1: http://www-isl.ece.arizona.edu/ACIS-docs/PDF/BLND/01CMP.PDF (62 pp., the whole standard-blending manual chapter including the error table and explanations on pp. 50–62; local `tmp/research/pdf/acis-blnd-01cmp.pdf`). Its content matches the R17 HTML almost verbatim, except for the chamfer definition (see §2).
  - ABL Component chapter 1: http://www-isl.ece.arizona.edu/ACIS-docs/PDF/ABL/01CMP.PDF (13 pp; local `tmp/research/pdf/acis-abl-01cmp.pdf`).
  - ABL Appendix C "Error Messages": http://www-isl.ece.arizona.edu/ACIS-docs/PDF/ABL/CERR.PDF (local `acis-abl-cerr.pdf`).
  - All returned HTTP 200 on 2026-09-23 and were read in full.
  - Re-checked 2026-09-24: the R17 overview page and the BLND `01CMP.PDF` still return HTTP 200.
- **Current vendor portal:** https://doc.spatial.com/ serves only portal navigation to anonymous clients (see the ACIS Booleans note).
- **Organization and dates:**
  - Spatial Corp., "a Dassault Systèmes company".
  - The R17 pages carry "© 1989-2007". DOCUMENTED (page footers).
  - The R10 PDFs are headed "Blending R10" and "Advanced Blending R10". The R10 release year (around 2001) is HEARSAY.
- **Provenance:**
  - The content is DOCUMENTED: vendor text, consistent across two independent mirrors.
  - Both hosts are third-party mirrors (q-solid.com; an Arizona university lab). Whether they are authorized or complete is HEARSAY.
  - Some R17 figures are missing (`src="#"` on the stopped-blend page).
- **License:**
  - Proprietary documentation, read-only reference. ACIS is a closed commercial kernel.
  - The concepts (rolling ball, spine and spring curves, capping, setbacks, miters, Gregory vertex patches) are generic and published in the literature, so they are free to reimplement.
  - Do not copy text, API names or option names into wonky's public surface. INFERRED.
- **Status:** a 2001–2007 documentation snapshot. ACIS is still sold, but these pages are historical. The behaviour described is long-lived architecture. INFERRED.

## What it is

The user-level and architecture-level description of how the second big commercial kernel (after Parasolid) does edge blending. It covers:

- The pipeline: attributes, then a blend sheet, then attach.
- Blend geometry: round, chamfer, vertex n-sided patch, variable radius.
- The topological classification of edges and vertices.
- Capping (end caps and side caps), sequences (bi-blends, miters, closed sequences), remote blending, stopped blends.
- Vertex blend ordering, blend reordering, local vs global interference checking, sheet blends, smooth-edge-sequence prediction.
- A complete error catalogue.
- ABL: entity-entity blends with roll-on/cap instructions, extra cross sections and radius laws, three-entity blends.

## How it works

All of this section is DOCUMENTED at the page named in each item, unless marked otherwise. Page names are shortened: `…bg` means `SPAacisuser_moblndbg.htm`.

### 1. Pipeline (`…cr`, `…ba`, `…abp`, `…si`)

- A blend is made in **two stages**:
  - **Stage 1** builds a **blend sheet**: a temporary sheet body of single-sided faces carrying the blend surfaces, cross curves and caps.
  - **Stage 2** attaches the sheet to the body: "trimming or extending the original faces and replacing portions of original surfaces with surfaces from the blend sheet".
- The capping page says stage 1 annotates the sheet with "attributes that aid the Booleans in blend stage two (by avoiding the recalculation of the intersections)". So stage 2 is Boolean-like and reuses stage-1 intersections.
- **Requests are attributes on the model:**
  - `ATTRIB_BLEND` on edges and vertices of the body ("implicit" blends) records what was requested.
  - `ATTRIB_BLINFO` on the sheet records how the sheet relates to the blank body.
  - Picking one attributed entity fixes the **whole connected network** of attributed entities in one operation.
  - Only attribute calls are allowed between setting and fixing. Failed attributes must be removed, because their state "is not guaranteed". Customers are told to prefer the one-shot APIs (`api_blend_edges`, `api_chamfer_edges`, …).
- **Processing is a worklist** (`…abp`):
  - Primary attributes are processed in list order.
  - Processing one can create new primary attributes, which are appended, or remove pending ones.
  - A **failed attribute is moved to the end for reconsideration**, or dropped.
  - Single-stepping APIs expose this loop: `api_init_blend_ss`, `api_do_one_blend_ss` repeated, then `api_concl_blend_ss`.
- Blend attribute classes have separable methods for the spine, spring curves, blend surface and cross curve. "One might adopt the standard method of finding spring curves but construct a different blend surface through them" (`…ba`).
- Rolling-ball blends whose spine or spring curves are "simple" (straight lines or ellipses) are recognised as simple, "leading to economies in storage space and compute times, and to improved numerical stability" (`…ba`).

### 2. Geometry (`…bg`, `…ro`, BLND R10 PDF pp. 6–14, ABL R10 PDF)

**Vocabulary.** The *spine* is the path of the ball centre. The *spring curves* are the two contact curves. The *cross section* is the shortest curve on the blend from one support to the other, and it is perpendicular to both.

**Constant radius.**
1. Offset both support surfaces by r.
2. **Intersect the offsets to get the spine.**
3. **Project the spine onto each support to get the spring curves.**

- The surface type is `rb_blend_spl_sur`. Older releases used `pipe_spl_sur`, recoverable via option `rb_replace_pipe`, which is "strongly discouraged".
- **Analytic simplification:** a straight-line spine gives a cylinder, a circular-arc spine a torus, a point spine a sphere.
- Corresponding spine and spring points lie in a plane perpendicular to the spine.
- A round is "the portion of the pipe between the spring curves with smaller arc length".

**Variable radius.**
- Offset-intersection "works only for constant-radius blends, because a variable offset is ill-defined on a surface".
- The radius function is parameterised by the **edge curve parameter** v. The ball of radius r(v) has its centre in the plane perpendicular to the edge at v.
- The surface is **marched** and approximated. "Analytic surfaces cannot be used to represent even simple variable radius blends."
- Three surface definitions:
  - *snapshot*;
  - *envelope* (since R5): smooth across smooth but not curvature-continuous edges, and offsets better;
  - *sliding disc* (ABL).
- Snapshot and sliding disc leave "a slight crease" when the radius varies across a G1-but-not-G2 edge, which causes near-tangency problems when offset.
- `blend_make_simple`: equal end radii produce a constant-radius blend.

**Geometric limit (`…bg`).**
- When a support is convex with a curvature radius smaller than the blend radius, and the blend is convex too, "the upper spring curve … form[s] a loop and the blend surface … self-intersect[s]". ACIS detects this and fails.
- If the support is concave while the blend is convex, a small support radius is fine.
- See the offset-surface condition (1 + rκ) in the Patrikalakis note.

**Chamfer: two definitions across releases.** Parasolid v12 uses a third phrasing: "offset surfaces … intersected; the resulting curves … projected onto the underlying surface", with ranges (`tmp/research/parasolid-blend/fd_chap.30.txt` §29.2.2).

| Release | Definition | Notes |
|---|---|---|
| R10 BLND | A chamfer is the ruled surface between the two contact points of the rolling ball. An **asymmetric chamfer uses two balls of different radii rolling together**. | Rationale given: for orthogonal faces the radii equal the offsets along the faces, and as the dihedral angle goes to π the chamfer width goes to 0, whereas a depth measured normal to the chamfer blows up. Standard chamfer surfaces are limited to **plane and cone**. |
| R17 standard | Size is given by an **"in-support" distance** per support: the distance *in the support* from the edge to the contact line. | |
| R17 advanced | Uses **ball ranges** again: range₁ and range₂ are radii of balls that each define one contact point, joined by a straight line. | |

- Onshape exposes both families as `ChamferMethod.FACE_OFFSET` and `APEX_RANGE` (see the Onshape note). This mapping is INFERRED.

**ABL extra cross sections:**
- elliptical (major, minor, rotation);
- rounded chamfer (a chamfer plus a bulge; bulge 0 gives a plain chamfer);
- thumbweights (left and right fullness while staying tangent);
- the cross-section plane can be "lofted to align with a given orientation".

**ABL radius laws:**
- radius values at positions;
- (parameter, radius) pairs;
- an arbitrary function;
- **fixed width**: the radius varies with the dihedral angle to keep the chord width constant;
- **holdline**: the radius is implied by a prescribed spring curve on one support;
- automatic smoothing of discrete radius data.

**Three-entity blend** (`…teb`): the radius is implicit, chosen so the blend is tangent to three supports. The centre face is discarded. This is Onshape's full-round fillet. INFERRED.

### 3. Topology classification (`…bt`, `…se`)

**Edges.**
- An edge is **smooth** (G1 across) or non-smooth, and **convex or concave**. Convexity must be uniform along the whole edge. Otherwise `BL_NON_U_CVXTY`: split the edge where the convexity changes.
- A convex blend removes material (a *round*). A concave blend adds material (a *fillet*) (`…ad`).
- "Blending operations may fail on non-G1 surfaces."

**Vertices.**
- **Terminal:** exactly one blended edge.
- **Internal:** two or more blended edges.

**Sequences.**
- **Bi-blend:** an internal vertex where two blended edges meet tangentially with compatible attributes. Any number of *smooth* unblended edges may also meet there. The two blend surfaces "mate exactly".
- **Mitered:**
  - The two edges meet non-tangentially, or there are non-smooth unblended edges at the vertex.
  - A miter surface is used to compute the cross curves. It is a *curved* miter for constant rounds on coplanar straight or circular edges.
  - Both edges must have the **same convexity**.
  - At most two other edges may meet there, and they must be non-smooth and separated by the blended pair.
- **Complex miter:** the two sheets do not match at their ends, for example because the radii differ, or because a common side surface is not perpendicular to the intervening edge. Then "one of the side surfaces must be extended as a partial end cap".
- **Closed sequence:** a loop with no end caps. It may contain miters. A *periodic* sequence is a closed one without miters or vertex blends.

### 4. Capping (`…ca`, `…se`)

- The blend terminates where the ball does not roll onto the new entities it meets. The sheet is then trimmed by intersecting the blend surface with existing body faces **or extensions of them**. This is **capping**.
  - An **end cap** terminates the sequence.
  - A **side cap** trims only one side, and the blend continues past it.
- Multiple capping faces are allowed.
- At a **mixed-convexity vertex** (the blended edge meets edges of the other convexity), capping faces may need extending. Spline capping faces get explicit extensions "so that the blend surface is guaranteed to intersect".
- **Special-case capping** for the two simplest mixed-convexity cases:
  - (a) the simple mixed-convexity corner;
  - (b) the capping intercept is not on a body edge.
  - It computes the capping surface and edges directly and gives a **2× speedup of the capping phase**.
- `bl_how_roll_on`: prefer **edge-face blends instead of side caps**, which keeps the supporting face's straight edges. ACIS falls back to side caps when the alternative "may not work", for example when non-tangent edges meet. There is limited edge-edge support.

### 5. Remote and stopped blends; reordering (`…re`, `…st`, `…br`)

**Remote blending.** When the ball does not fit on the two adjacent faces, for example when the radius is larger than a step height, blending can switch to remote face-face, **edge-face** or **edge-edge** blends. If *all* blends in a sequence are remote, this is "restricted to blend networks without vertex blends or miters".

**Stopped blend.**
- Terminates before the edge's end vertex. It is specified by a **setback distance** and a **stop angle**, the angle between the edge direction and the capping plane through the cross-section endpoints.
- Stop angle 180° puts the plane through the end vertex.
- **Setback difference** Δ (only with stop angle 90°): right spring curve setback = s + Δ/2, left spring curve setback = s − Δ/2.
- Entity-entity blends cannot be stopped.

**Blend reordering.** A new blend between two existing smaller-radius blends "is made up as though the larger radius blend had been done before the smaller radius blends". INFERRED: this is internal defillet → blend → refillet.

### 6. Vertex blends: ordering, setbacks and patches (`…ve`, `…bg`, BLND R10 pp. 10–14)

**Order controls the result.**
- *Smooth continuity:* blend one edge first, then the other two form a smooth sequence.
- *Mitered:* miter two edges, then blend the third with a smaller radius so it "roll[s] through the miter arc".
- *Mixed-convexity miter:* "may not produce a unique valid solution", so **ACIS refuses to fix it in one operation**. The user must blend in steps, and different orders give different valid results (block-on-block figures).
- *Single blend:* override smooth propagation, then extend, intersect and cap against nearby faces.

**Setbacks.**
- A plane perpendicular to the edge at distance s from the vertex cuts the edge blend. For a constant round the cross curve is a circular arc.
- **Oblique setbacks** give left and right different values.

**Auto-setback algorithm.**
1. Compute the average blend size at the vertex.
2. For each edge, look at the clockwise and counter-clockwise neighbours and find the setback that gives a spring curve of radius close to the average.
3. Take the larger of the two.

- It treats the vertex as polyhedral (normals and tangents at the vertex only). It works if the blend sizes are similar and non-zero, the edge angles are not near 0 or π, and the edges are not highly curved.
- It never produces oblique setbacks.
- The `autoblend` variant also allows simple surfaces.

**No setback given.**
- Intersect each edge's spring curves with the neighbours' spring curves. **Take the intersection farther from the vertex.** This yields the "smallest practical" non-oblique setback.
- At a reflex angle (> π) only one side yields a point.
- Then awkward curves are "improved", sometimes into oblique curves.
- With no setbacks, **spheres and tori are used when possible**. Auto-setback always yields an n-sided patch.

**Vertex surface.**
- Sphere or torus when possible. Otherwise an **n-sided Gregory patch** (`VBL_SURF`) with a **bulge** factor in [0, 2], default 1. Bulge only affects the interior, and 0 is suggested for mixed convexity.
- A uniform-convexity vertex gives an n-sided face. A mixed-convexity vertex gives more sides, including "spring edges".
- Export via `api_make_VBL_output_surfaces`, which approximates the n-sided patch by **n four-sided B-spline patches**.
- A setback larger than the edge is invalid (`BL_SETBACK_TOO_LARGE`). Example: a 100³ block with setback 200.

### 7. Local vs global interference checking (`…lo`)

- **Default is local:** "intersecting the spring curves of the sheet with geometry local to the blend".
- **Global** (`bl_remote_ints`) intersects the sheet *surfaces* with all body geometry. It is off by default because local is "dramatically" faster, "especially thin walled parts".
- The doc's four cases that need global checking. These are Scheme scripts with exact coordinates, usable as regression fixtures:
  1. **Vertex blend with univex side capping.**
     - Body: cube [−30,30]³ minus a law-swept sheet from the wire (30,−30,30) → (30,−10,30) → (30,20,10) → (30,−30,10), sweep 60.
     - Blends: rounds 13, 7 and 2 with setbacks 2, 5 and 3, plus a vertex blend with setback 3.
     - It **fails** without global checking.
  2. **Convex block with hole.**
     - Body: cube [−30,30]³ minus a cylinder of r = 5 along z at (20,0).
     - Blend: round 20 on the top edge at x = 30, z = 30 (picked by a ray from (30,0,0) along +z).
     - The blend surface reaches the non-adjacent hole wall.
  3. **Pocket lost.**
     - Body: the same cube minus a cylinder of r = 5, z ∈ [−10,10], moved by (20,0,20), which gives a blind pocket from the top.
     - Blend: round 20 on the same edge.
     - With local checking "the cylindrical pocket gets lost". The operation *succeeds with a wrong result*.
  4. **Tunnel / different edge and face topology.**
     - Body: cube1 minus a shifted cube2, united with cube3 minus a thin cube4 tunnel.
     - Blend: round 15.
     - It fails without global checking.

### 8. Sheet blends and smooth-edge sequencing (`…sh`, `…sm`)

**Sheet blends.**
- At a sheet boundary no capping face exists. The end curve is built **in the blend surface's parameter space** between the spring-curve endpoints:
  - a straight line for chamfers;
  - end-tangent-matching for rounds;
  - a 3D line or circle recognised when possible;
  - position-only at boundary vertices.
- Non-manifold edges are not blendable.

**Smooth-edge sequence prediction** (`api_smooth_edge_seq`). Extend head and tail from a seed edge. At each vertex:

| Situation | Configuration at the vertex | Result |
|---|---|---|
| 1 | Exactly two tangent-continuing non-smooth edges of the same convexity | Continue. The vertex disappears from the blend. |
| 2 | Two tangent-continuing edges of *different* convexity (a convexity-change vertex) | Stop. |
| 3 | Two non-smooth edges that are not tangent-continuing, which needs a G1-discontinuous face without a crease edge | Unsupported. |
| 4 | More than two edges: the two same-convexity edges continue and the rest are smooth "slant" edges | Continue. The blend faces join G1 across iso-parametric cross edges where the spring curves hit the lateral edges. |
| 5 | As 4, but some remaining edges are non-smooth | Stop. The blend faces are mitered where the spring curves meet the unblended edges. |
| 6 | No tangent-continuing edge | Stop. |

- Stated limitation: in the "edge-based blending paradigm … one-to-one correspondence between blended edges and blend faces often cannot be established". This happens with slant lateral edges, and with supports that differ along the edge vs along the spring curve.

### 9. ABL entity-entity blends (`…aee`, ABL R10 PDFs)

- Start from a pair of entities. The blend propagates as the ball rolls, reading **instructions** (`roll on` or `cap`) from the entities its contact points run into. Positioned instructions apply at the nearest intercept.
- **Default transition table:**

| Currently on | Runs into | Default |
|---|---|---|
| Face | Smooth edge | Roll onto the next face |
| Face | Sharp edge | Cap (side or end) |
| Face | Vertex with a smooth face | Roll onto it |
| Face | Vertex without a smooth face | Cap |
| Edge | Face | Roll onto the face |
| Edge | Vertex with a tangent edge | Roll onto that edge |
| Edge | Vertex without a tangent edge | Cap |

- **Restrictions:**
  - Transitions happen only when a spring curve *leaves* a face after being inside it. **Grazing contacts are unsupported**, as are transitions at seam edges and vertices embedded in a face.
  - A blend may not follow an edge when it could roll onto the interior face ("concave blends add material and convex ones remove it").
  - The only allowed stationary blend is the **osculating torus** of a plane against a line normal to it.
  - Vertex-face geometry is only the torus against a plane. No vertex-edge or vertex-vertex geometry exists.
  - One entity-entity sequence at a time. Entity-entity blends are never mitered and never bound vertex blends.
  - `abl_require_on_support` (default on) makes it an error if a spring curve does not touch its support over a finite interval.
- **Cap classification** (end vs side) assumes cap endpoints lie on the boundaries of the blended entities. It becomes unreliable when about six or more body edges lie between the cap endpoints, and on periodic blend surfaces.

### 10. Error catalogue (`…er`, ABL CERR PDF)

**Standard codes.** About 55 `BL_*` codes, each classified by *type* × *area*:
- Types:
  - **PROG**: program error
  - **APPL**: application error
  - **USER**: user error
  - **LIMT**: current limitation
  - **IMPS**: impossible specification
- Areas: CAPP, MITR, GEOM, BLN1, DEFN, GENR, COMP, VTBL, SVRS.

Representative codes:

| Code | Type:area | Meaning |
|---|---|---|
| `BL_BLEND_TOO_BIG` | USER:GEOM | Too big for the adjacent face or the edge curvature |
| `BL_BAD_SPINE` | PROG:GEOM | Spine iteration fails to converge |
| `BL_CHAMF_ERR` | | Cannot find a spine for the chamfer |
| `BL_NO_X_CURVE` | | Cannot find a cross curve at an open end |
| `BL_NO_CAP`, `BL_NO_CAP_EXTN`, `BL_NO_CLEAN_INT`, `BL_BAD_INTERCEPT`, `BL_END_TOO_CMPLX` | | Capping failures |
| `BL_MITRE_TOO_CMPLX`, `BL_NO_MITRE_MIXED` | IMPS | Miter failures; mixed convexity cannot be mitered |
| `BL_NON_U_CVXTY` | USER | Non-uniform convexity along the edge |
| `BL_NON_MAN_VERT` | LIMT | Non-manifold vertex |
| `BL_CUSP_GEOM_TOO_CMPLX` | | Cuspate vertex too complex |
| `BL_NOT_IMPLEM` | | Not implemented, e.g. a vertex blend at a **cone apex** |
| `BL_SETBACK_TOO_LARGE` | | Setbacks longer than the edge |
| `BL_BAD_VBL_BNDRY`, `BL_NO_SPR_CUR_INT`, `BL_NO_MATE` | | Vertex-blend failures |
| `BL_BAD_SLICES`, `BL_MARCH_FAILED`, `BL_RADIUS_CALIBRATION`, `BL_GEOM_CONSTRUCTION_FAILED` | | Variable-radius failures; the last covers a self-intersecting surface after marching |

- The most frequent suggestion is "Try with a smaller blend radius".

**ABL codes (`ABL_*`):**
- Bad start point: `EE`, `EF`, `FF`.
- No geometry: `ABL_NO_GEOM_{EE,EF,FF,VF}`.
- `ABL_RADIUS_SMALL` / `ABL_RADIUS_BIG` (only for simple constant-round geometries).
- Not implemented: `ABL_GEOM_NOT_IMPL_{VE,VF,VV}`.
- `ABL_GEOM_EDGE_STAT`.
- Change-point too complex: `ABL_CHG_PT_COMPLEX_{EDGE,FACE,VERT}`.
- `ABL_TRANS_COMPLEX_*`.
- Cap failures: `ABL_{END,SIDE}CAP_{FAIL,COMPLEX}`.
- `ABL_OFF_SUPPORT`.
- `ABL_NO_SEGMS`, `ABL_INCONS_SEGMS`.
- `ABL_INTERNAL_ERROR`.

## Robustness and guarantees

- **No formal guarantees.**
  - The claims are qualitative: blends are "created, evaluated, and attached with a high degree of precision. Wherever possible, analytic surfaces are used" (`…bt`), and "The capping algorithm is robust and can handle a large number of cases" (`…ca`).
  - Tolerances are not stated in these pages. ACIS uses `SPAresabs` elsewhere, see the ACIS Booleans and checker notes. HEARSAY here.
- **Admitted silent wrong results.** With the default local interference checking, the "pocket lost" example completes but drops a feature (`…lo`). A default that trades correctness for speed is the single most important warning in these docs for wonky. DOCUMENTED.
- **Admitted non-uniqueness.**
  - Mixed-convexity miters have multiple valid solutions, so ACIS forces the user to sequence them (`…ve`).
  - Edge-based blending cannot always map edges one-to-one to faces (`…sm`).
- **Admitted geometric failure modes:**
  - Spring-curve loops when a convex support's radius is smaller than r (`…bg`).
  - Creases in variable-radius snapshot surfaces.
  - Grazing contacts unsupported (`…aee`).
  - Stationary blends unsupported except the osculating torus (CERR PDF).
- **Heuristics with stated domains:** autosetback works only for similar sizes, moderate angles and low edge curvature (`…bg`). Cap classification is unreliable with about six or more intervening edges (`…aee`).
- **Parasolid cross-check** (v12 functional description, local `tmp/research/parasolid-blend/fd_chap.30–34.txt`). DOCUMENTED there.
  - The same attribute model: "unfixed" blends are sketched and checked, then "fixed".
  - The same simplification to cylinders and tori.
  - The same rule at a three-edge vertex: two blended edges must share convexity, and blending all three simultaneously inserts a vertex face.
  - The same "offsets must intersect to define a spine" legality rule.
  - Parasolid names its end handling differently. "Overflow" comes in four kinds: smooth, cliff, cliff-end and notch. The attempt order is **smooth → cliff → notch**. When no allowed overflow type works, the blend fails.
  - ACIS instead speaks of end and side caps, roll-on edge-face blends and remote blends.
  - Both kernels special-case: capping at mixed-convexity vertices, vertex-blend ordering, convexity uniformity per edge, and analytic simplification. INFERRED from reading both.

## Parallelism and performance

- Nothing is documented about threading.
- The only numbers are the **2× capping-phase speedup** from the special-case capping algorithm (`…ca`) and "dramatically" faster local vs global interference checking (`…lo`). DOCUMENTED, not quantified further.
- INFERRED:
  - The worklist with requeue-on-failure (`…abp`) is inherently sequential and order-dependent.
  - Independent sequences (disjoint networks) could be processed in parallel, but ACIS fixes a whole connected network at once.
  - The spine and spring computation for analytic pairs is closed-form per sequence and parallel.

## Known failures, limitations, war stories

- **Pocket lost** with default local interference (`…lo`, figure "Pocket Lost without Global Checking").
- **`ABL_GEOM_EDGE_STAT`** (CERR PDF):
  - The *same* block geometry works as an analytic body (osculating torus special case) but fails after `splconvert` to splines, because the generic spline path forbids stationary blends.
  - Lesson: losing analytic type information turns solvable cases into failures. This matches wonky's "keep analytic surfaces" rule.
- **`ABL_CHG_PT_COMPLEX_EDGE`** example (CERR PDF):
  - A cube imprinted with a 5°-rotated box. A convex entity-entity blend of r = 10 fails because the change point sits on a smooth edge.
  - "Small tweaks to the radius do not help". It works from r = 15, when the point has moved off the edge.
  - The fix is to make the edge slightly non-smooth: a genuine degeneracy, not a precision bug.
- **Mixed-convexity miters:** refused in one step; order-dependent results (`…ve`).
- **Vertex blend at a cone apex:** `BL_NOT_IMPLEM` (`…er`).
- **Autosetback breaks down** with dissimilar radii, near-0 or near-π angles, or curved edges (`…bg`).

## Relevance for wonky

INFERRED throughout.

- **Architecture fit.** "Build blend sheet, then attach" matches a pure-functional kernel well.
  - Stage 1 is a pure function from (body, edge set, radii) to new analytic faces with spring and cross curves.
  - Stage 2 produces a new body. It can be done either by the hybrid Boolean, using the sheet plus caps as a closed tool, or by local Euler-style surgery (see the HP/CoCreate patents note).
  - ACIS's own stage 2 reuses stage-1 intersections as hints to its Boolean. That is the same idea as passing face tags and known intersection curves into wonky's Boolean.
- **Attribute model vs immutability.** ACIS keeps blend requests as mutable attributes on entities and warns that they are fragile. Wonky already has the request as an immutable FeatureScript `opFillet` or `opChamfer` map keyed by queries. Keep it that way: resolve the queries to persistent edge IDs and never store requests on the B-rep.
- **Minimal FDM subset, closed-form and uniform:**
  - constant round and chamfer on plane/plane (cylinder or plane result);
  - plane/cylinder and plane/cone with circular edges (torus or cone result);
  - bi-blend chains, needed for `tangentPropagation`;
  - terminal vertices capped by the third face or its extension;
  - the equal-radius three-plane corner as a sphere.
  - Everything else fails explicitly: miters with a complex miter, mixed-convexity vertices, n-sided patches, variable radius and remote blends.
- **Tangent propagation.** The six smooth-edge-sequence situations in §8 are a precise, testable rule set for implementing `tangentPropagation: true` in `opFillet` and `opChamfer`.
- **Chamfer semantics.** Wonky must decide which chamfer "distance" it implements. Onshape offers `FACE_OFFSET` and `APEX_RANGE`, and the ACIS ball-range and in-support definitions show that the two differ off 90°. Plane/plane gives a plane either way. Plane/cylinder gives a cone or plane only in special configurations, as in the ACIS standard chamfer limit of plane/cone.
- **Interference: always global.** Correctness beats speed for wonky. The four `…lo` Scheme scripts should become FeatureScript regression tests with their exact coordinates, especially "pocket lost", whose correct answer keeps the pocket.
- **Error model.** Adopt the *two-axis classification* (type × area), mapped onto Onshape's `ErrorStringEnum` names:
  - IMPS: the request is geometrically impossible;
  - LIMT: wonky can't do it yet;
  - USER: bad selection;
  - PROG: an internal bug.
  - This is exactly what an LLM needs to decide whether to change the model, change the radius or report a bug. Pair each error with the offending entity IDs and the measured quantity, for example "support radius 3.0 < blend radius 4.0 on convex support face #F12".
- **Bend fit.**
  - Spine and spring computation for quadric pairs is closed-form F32x2 arithmetic, uniform across edges, and GPU-able.
  - The decisions (convexity sign, whether the ball fits, whether the spring curve leaves the face) are sign tests near tangency. Route them to exact multi-limb predicates when the F32x2 filter is inconclusive, and return LIMT when degenerate. The osculating and grazing cases are where ACIS itself gives up.
  - Capping, sequencing and vertex classification are irregular graph work: Bend fork-join on the CPU path, not GPU.
- **Provenance and naming.** ACIS's `ATTRIB_BLINFO`, which records the sheet's relationship to the blank body, is the provenance wonky needs for blend faces: which edge, which supports and which cap faces each blend face came from.

## Pointers worth porting or studying

- `…bg` (Blend Geometry): the offset-intersect-project definition, spine-type → analytic-surface table, the geometric radius limit, the chamfer definitions, and the setback, autosetback and no-setback algorithms.
- `…se` (Sequences): bi-blend, miter and complex-miter conditions. Use them as preconditions for which vertex configurations wonky accepts.
- `…sm` (Smooth Edge Sequencing): the six-situation propagation table.
- `…lo`: four regression fixtures with exact coordinates.
- `…er` and ABL `CERR.PDF`: the error taxonomy and suggested remedies.
- `…ca`: the two special-case capping configurations. These are the most common FDM cases, for example a fillet ending at a perpendicular wall.
- BLND R10 PDF p. 9 (chamfer as two rolling balls, with its rationale) and ABL R10 `01CMP.PDF` Table 1-1 (standard vs advanced feature matrix).
- `…aee`: the entity-entity transition tables, useful if wonky ever implements face blends (`opFaceBlend`).

## Verdict: learn-from

This is a proprietary but unusually concrete behavioural specification of a commercial blending engine: pipeline, classification rules, special cases, admitted failures, and a full error taxonomy. There is no code to port.

Use it to:
- scope wonky's fillet subset;
- define explicit failure codes;
- implement tangent propagation;
- decide chamfer semantics;
- seed regression tests (the global-interference fixtures).

Reject its default of local-only interference checking, because it silently produces wrong results.
