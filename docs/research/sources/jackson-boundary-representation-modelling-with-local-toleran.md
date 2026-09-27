# David J. Jackson, "Boundary Representation Modelling with Local Tolerances" (SMA '95)

- Kind: peer-reviewed conference paper, Proceedings of the Third ACM Symposium on Solid Modeling and Applications (SMA '95), Salt Lake City, May 1995. ACM 0-89791-672-7/95/0005. Printed pages 247-253 (the 8-page PDF ends with a blank page; Crossref lists "247-254", 9 references, 23 citing works, checked 2026-09-24 at https://api.crossref.org/works/10.1145/218013.218067).
- Canonical URL: https://dl.acm.org/doi/10.1145/218013.218067 (DOI 10.1145/218013.218067). ACM returned HTTP 403 to curl on 2026-09-22.
- Readable copy: https://ftp.cs.wisc.edu/pub/users/prem/jackson-SM-95.pdf (HTTP 200, 561,709 bytes, re-checked 2026-09-24; byte size identical to the local copy). The paper was read in full (re-read 2026-09-24) from the local copy `tmp/research/pdf/jackson-sm95-local-tolerances.pdf` (the same file also exists as `jackson-1995-local-tolerances.pdf` and `jackson_sm95_local_tolerances.pdf`).
- Sibling note from another research batch on the same paper: `jackson-1995-boundary-representation-modelling-with-local-to.md`.
- Companion primary sources (Siemens, public PDFs) showing how the idea shipped: Parasolid Overview V35 §3.6 (http://www.q-solid.com/Parasolid_Docs_V35/pdf/ov.pdf) and the Parasolid XT Format Reference V35 §4.3.8-4.3.10 and §5.2.1.6 (local copy `tmp/research/pdf/parasolid-xt-v35.pdf`).
- Author and organization: David J. Jackson, Parasolid Business Unit, EDS Unigraphics, Cambridge, UK. Published 1995. DOCUMENTED (paper header).
- License: ACM copyright on the text; no code. INFERRED: the paper mentions no patent. The ideas (per-entity tolerances, tolerant edges carried by per-face pcurves) have long been reimplemented elsewhere (OCCT has vertex, edge and face tolerances). Porting implication: reimplementing the published model and algorithm order from the math is unproblematic. Nothing from Parasolid itself can be linked or copied; it is proprietary (Siemens).
- Status: finished, historical (1995). DOCUMENTED: the paper names this as the model behind Parasolid's tolerant modelling. DOCUMENTED: 27 years later, Parasolid V35 (2022) still calls tolerant modelling "intrinsic to Parasolid" (ov.pdf §3.6.1, text line ~1311).

## What it is

The paper introduces local tolerances into a B-rep kernel. Parasolid then ran with a single global tolerance of 5.0e-9 m, "chosen to be below the smallest realistic tolerance for most mechanical parts" (§2.3). The motivation (DOCUMENTED, §1-2, Figs. 1-2):
- Imported models from other kernels (lower precision, different SSI) do not meet at Parasolid's resolution. Surfaces that meet smoothly (tangentially) are the typical case; they cannot simply be extended and re-intersected (Fig. 1).
- A small global tolerance forces blend surfaces to carry "a large amount of defining data"; a large one "prevents the creation of small features anywhere on that model" (§2.3).
- Some operations cannot be done at a fixed tolerance. A short edge under 4x the tolerance cannot be split without creating edges that are too short or do not meet (Fig. 2).

The answer is to attach a tolerance to individual topological entities and let it grow locally, only where needed.

Why a tolerance is used at all (DOCUMENTED, §2.2, the three stated benefits):
1. set "several orders of magnitude above the floating point precision", it makes the modeller "largely unaffected by rounding error";
2. it prevents tiny faces and edges that serve no purpose and hurt downstream applications;
3. "Consistent use of tolerances to guide decisions ... can avoid inconsistent decisions leading to conflict between topology and geometry."

The paper criticizes the alternatives (DOCUMENTED, §2.1, references [1]-[7]):
- Exact rational arithmetic ([1] Benouamer, Michelucci, Peroche, CAD 26(6), 1994, lazy rationals): growing number complexity, and it "may create small undesirable features in the model which do not correspond to any design intent".
- Perturbation / SoS ([2] Edelsbrunner-Mücke 1988): "creates small edges and faces, and removes coincidences which were probably intentional".
- Symbolic reasoning ([3] Hoffmann-Hopcroft-Karasick 1989; [4] Stewart 1994): describing all consistency requirements in general is unsolved, "so far this is limited to special cases".
- [5] Zhu, Fang, Bruderlin (SMA 1993): hybrid CSG/B-rep that avoids redundancy, still with a global tolerance.
- Adaptive tolerances on points, curves and surfaces ([6] Fang, Bruderlin, Zhu, CAD 25(9), 1993, CSG/B-rep; [7] Segal, SIGGRAPH 1990, polyhedral only): on ambiguity, tolerances are increased and "some or all of the algorithm re-run". These are the closest relatives; Jackson differs by attaching tolerances to *topology* and by resolving ambiguity locally instead of re-running.

## How it works

### Representation (§3.1). DOCUMENTED.
- A vertex tolerance is a sphere around the vertex point. The default is 5e-9 m.
- A tolerant edge has no single 3D curve. It is a collection of SP-curves (pcurves), one per face that meets at the edge. Its tolerance tube is centred on one arbitrarily chosen but fixed pcurve.
- An edge whose tolerance equals the default is *not* tolerant and keeps a single 3D curve. A manifold solid edge that is tolerant has exactly two pcurves.
- Faces also carry a tolerance, "which define[s] the 'thickness' of the face". "In Parasolid faces currently always have the default tolerance" (§3.1). §7.1 lists non-default face tolerances as future work: not needed for validity, but useful when two surfaces are "approximately coincident, or approximately tangent", where SSI "will be very difficult as many complex curves may result".
- Monotonicity: vertex tolerance ≥ tolerance of connected edges ≥ tolerance of connected faces (§3.1).
- The curves bounding a face "need not meet exactly end-to-end, as long as they are within vertex tolerance" (§3.2).
- Shipped form (DOCUMENTED, XT V35):
  - §4.3.9: an edge's `curve` field is null when the edge is tolerant.
  - §4.3.8: each fin (half-edge) then carries a trimmed SP-curve that deviates at most the edge tolerance from the other fins' curves, with ends inside the vertex tolerance.
  - §4.3.9 / §4.3.10: a null-double tolerance means "accurate", which is half the linear resolution.

### Validity (§3.2). DOCUMENTED.
0. Base rule: "two entities intersect if they approach within the sum of their tolerances". With that reading "the usual b-rep consistency rules apply": vertices lie on connected edges and faces, edges lie on connected faces, and edges and faces only intersect where topology exists.
1. Pcurve ends lie inside their vertex spheres.
2. Every connected component of the intersection of two edge tubes must contain a common vertex.
3. Every connected component of a face-face "tolerance intersection" must be contractible onto common edges or vertices (Fig. 4).
4. Implied invariant: vertex tolerance ≥ tolerance of incident edges, and edge tolerance ≥ tolerance of incident faces.

### Principles (§3.3). DOCUMENTED.
- Three stated reasons for local tolerances:
  1. importing B-rep or surface models "built in other systems, whatever their accuracy";
  2. modelling techniques such as blending "which generate approximated surfaces", without compromising the rest of the model;
  3. "By identifying areas which have been approximated, to avoid performing numerical computations to inappropriately high accuracy, which would be slow and unreliable."
- Tolerances belong to topology, not geometry. Points, curves, surfaces and pcurves are exact.
- If an operation cannot proceed with the current tolerances, it increases the local tolerance and removes the now-redundant topology (merges vertices, collapses edges) until the model is consistent again.

### Boolean (§4). DOCUMENTED.
Three phases: imprint, join, select.

1. **Imprint** compares entities of both bodies in ascending dimension order:
   - vertex-vertex;
   - vertex-edge: split the edge; the new vertex inherits the edge tolerance;
   - edge-edge: "areas of coincidence" are found as parameter ranges and tested against the sum of the two tolerances;
   - vertex-face;
   - edge-face;
   - face-face last.

   Intersector contracts, quoted from §4.3 (p. 251). These are the most portable specs in the paper:
   - **Curve-curve (edge-edge):** "an intersection is returned for each area of coincidence, to tolerance, between the two curves". Coincidence areas are parameter ranges on each edge. "Intersections which represent an area of coincidence which contains a vertex can be ignored, as they will have been found by vertex-edge comparisons."
   - **Edge-face:** "Since the edge has already been compared with edges of the face, we need only consider coincidence, or intersections interior to the face and edge." Coincidence adds an edge-to-face correspondence; intersections add vertices.
   - **Surface-surface (face-face):** the intersector "needs to return curves and point contacts, sufficient to divide areas of surface which are on one side of the other surface from those on the other side; and to represent each area of contact or coincidence. It need not consider curves (i.e. contact areas) already known to be common by virtue of edge-edge or edge-face comparison. This can be important, since computation of near-tangent intersection curves can be very unstable."

     The curves are then trimmed against both faces' boundaries. Sections on both faces become new edges.

   Rules within imprint:
   - Coincidence is always judged against the sum of the entities' tolerances.
   - The face-face SSI only has to return enough curves and point contacts to separate the sides. It skips contacts that are already known from the edge comparisons. This is how near-tangent, numerically unstable SSI is avoided.
   - Split edges are re-compared, but only against edges that already share vertices with them.
   - A vertex of one body may correspond to an edge, a face or a cell of the other.
   - Imprinting can collapse thin faces (Fig. 5).
2. **Join** merges corresponding entities using the larger of the two tolerances. It compresses topology until the two imprinted models correspond 1:1.
3. **Select** classifies inside/outside and keeps the required parts. Options include removing lower-dimensional topology, splitting into components, and returning manifold sub-models.

Two further details (DOCUMENTED, §4.2-4.4):
- Imprint's output is a *correspondence list*: topologies on one body with matching topologies on the other. Join then compresses. Example: if a vertex of one model coincides with an edge of the other "so that the edge is entirely contained within the tolerance sphere of the vertex, then that edge needs to be removed, and its ends combined, before the models can be joined".
- Join produces one model that "will in general be non-manifold and composed of a number of regions or cells bounded by faces". Select then works on cells; this is possible "because regions must be unambiguously inside or outside after the imprint phase".

Worked example (Fig. 6, §4.6): a 2D B-spline sheet whose tolerant edges approximately lie on two block faces is subtracted from a block to make a blend.
1. Edge-edge splits the long sheet edges into three.
2. Edge-face finds two of the pieces coincident, within tolerance, with block faces; new edges divide those faces in two.
3. Face-face intersects the sheet with the block's end faces, creating the blend's end faces.
4. Join and select split the block into two solids.

### Other operations (§5-6). DOCUMENTED.
- Blending (§5): the user supplies a tolerance for constructing the blend surface; it "determines how closely it fits the neighbouring faces". The blend's edges get a tolerance derived from it "without affecting tolerances elsewhere in the model". The blend face is sewn in along those tolerant edges (Fig. 7, variable-radius blend on a cube edge).
- Sewing (§6.1) is the vertex/edge matching part of the Boolean, with the face-face and edge-face stages omitted, "a faster way of combining models when they are known to abut". Input may be sheets or solids; if the faces enclose a volume, a solid results. Gaps give "a thin hole", closed by assigning larger edge tolerances and re-sewing.
- STEP (§6.2): STEP "uncertainty" values were then new. Local tolerances were to be attached to topology in the STEP file, and "If geometry types not supported by STEP need to be transferred, they can be approximated providing the approximation tolerance is attached to the relevant faces or edges."

## Robustness and guarantees

- DOCUMENTED:
  - The guarantee is structural. The model remains a valid tolerant B-rep: validity rules 1-3 hold after each operation because tolerances grow and redundant topology is compressed.
  - There is no proof, no error bound on tolerance growth and no benchmark.
  - Tolerance growth "should be contained" but this is "not always achievable" (§7.3).
  - General recursive compression is not fully implemented; only a practical subset is (§7.2).
- INFERRED:
  - The robustness comes from ordering decisions by dimension and reusing lower-dimensional decisions in higher-dimensional ones. This gives consistent topology decisions without exact arithmetic.
  - Correctness of geometry is traded for validity of topology: an entity may end up with a tolerance much larger than the geometric error the user expects.

## Parallelism and performance

Not discussed in the paper. DOCUMENTED (ov.pdf §17.2.3): Parasolid's SMP today parallelizes only the "face-face clashing portion" of Booleans, with at most 8 threads. The ordered imprint cascade stays sequential.

DOCUMENTED (Parasolid V35 Functional Description §114.2.5, http://www.q-solid.com/Parasolid_Docs_V35/chapters/fd_chap.115.html, fetched 2026-09-24): with SMP on, a Boolean that returns several bodies does not guarantee their order, nor "which resultant body inherits the value of the target body tag". Parasolid's parallel clash therefore leaks scheduling into results.

INFERRED:
- The vertex-vertex and vertex-edge stages are embarrassingly parallel per pair.
- Edge-edge and face-face stages depend on prior results and need a deterministic reconciliation step.
- In fork-join form this is one parallel map per stage, then a deterministic merge sorted by stable entity ids. Wonky's byte-identical output across JS, native 1/18 threads and Metal (`docs/proto-recover.md`) must survive this; Parasolid shows what happens when it does not.

## Known failures, limitations, war stories

- Unbounded or cascading tolerance growth (§7.3). DOCUMENTED. INFERRED: this is the classic "tolerance creep" known from OCCT/Parasolid-imported models.
- Recursive compression is incomplete (§7.2). DOCUMENTED.
- Without face tolerances, near-coincident or near-tangent SSI remains a hazard (§7.1). DOCUMENTED.
- Thin faces can collapse during imprint (Fig. 5). This is a feature, but it changes topology relative to user intent. DOCUMENTED.
- Tolerant edges have no 3D curve. Downstream consumers (export, meshing) must pick a pcurve or build nominal geometry. DOCUMENTED: Parasolid later added "nominal geometry" for exactly this (ov.pdf §3.6.2; PK check states `PK_EDGE_state_*_nmnl_c`).

## Relevance for wonky

1. **Imprint order is the missing "operation-scoped record".**
   - `docs/boolean-strategy.md` asks for one operation-scoped record of shared decisions (accepted contacts, overlap intervals, split parameters) that all incident faces consume.
   - Jackson's V-V → V-E → E-E → V-F → E-F → F-F cascade is exactly such a schedule.
   - For the production-path blocker (plane/cylinder union, first failure at `fixtures/r10b/r10b.fs:25:2`; still "r10b unchanged at 25:2" in `docs/hybrid-boolean-plan.md` plan step 7 on 2026-09-24, because the hybrid refuses an operand the print mesh does not cover): resolve vertex and edge coincidences first. Then the plane-cylinder SSI only has to produce the new lines/ellipses and may skip contacts already decided on edges. This removes the near-tangent re-derivation that yields contradictory roots. (INFERRED)
2. **Tolerances on topology, exact geometry.**
   - Fits wonky's rule "retain original source geometry; generated entities get a representative point and bounded incidence errors".
   - Wonky's rule "no silent tolerance increase" forbids Jackson's implicit growth. Since 2026-09-24 this is a recorded product decision: "kein stilles Toleranzwachstum, stattdessen die nötige Toleranz melden" (`docs/entscheidungen.md`, item 10). The adaptation:
     - growth only up to an explicit per-operation budget (the ACIS fuzz plays the same role; see the ACIS Booleans note);
     - every growth is recorded on the entity;
     - exceeding the budget is an explicit failure that *names the tolerance that would have been needed* (this is what the decision asks for, and Jackson's algorithm computes that number anyway).
   - INFERRED.
3. **Tolerant edge = per-face pcurves.**
   - Matches wonky's requirement "shared 3D curve and per-face parameter-space representation" (boolean-strategy.md item 3). Wonky already exports pcurves in STEP (`docs/step-pcurves.md`).
   - A cylinder/plane intersection line or ellipse has an exact analytic 3D curve. So wonky can keep a 3D curve plus pcurves, using pcurve-only edges only when approximations are involved. (INFERRED)
   - For intersections without a closed form (space quartics), Parasolid does not fall back to a tolerant edge either. XT V35 §5.2.1.5 stores an exact procedural *intersection* curve: two surfaces, an ordered chart of points with chordal and angular error, and help/terminator limits. Evaluation is a three-surface Newton solve. DOCUMENTED. Wonky should prefer that route and keep tolerant edges for imported or approximated data. See the Zoo note for details.
4. **Numeric scale.**
   - DOCUMENTED (ov.pdf §3.6): Parasolid's session precision is 1e-8 m in a 1000 m box, a ratio of 1e11.
   - INFERRED:
     - F32x2 (about 48-bit mantissa, relative 3.6e-15) gives roughly 11 bits of headroom over that ratio for FDM-sized parts (≤ 1 m).
     - Wonky's current tolerated-regularized contact bound of 1e-7 mm (`local design note`) is 100x tighter than Parasolid's default 1e-8 m = 1e-5 mm.
   - DOCUMENTED (verified 2026-09-23; Onshape std library 2960, `math.fs` lines 35-42, MIT-licensed; public mirror https://github.com/javawizard/onshape-std-library-mirror/blob/main/math.fs):

     ```
     TOLERANCE = { zeroAngle: 1e-11, zeroLength: 1e-8, g1Angle: 0.1 deg,
                   booleanDefaultTolerance: 1e-5 /* meter */, computational: 1e-13 }
     ```

     `zeroLength` and `zeroAngle` equal Parasolid's session precisions. `booleanDefaultTolerance` (1e-5 m = 0.01 mm) is used in std for tolerant edge matching when joining surfaces (`boolean.fs` `filterOverlappingEdges`, gated by `V607_HOLE_FEATURE_FIT_UPDATE`) and as a minimum section depth (`sectionpart.fs`).

     INFERRED: FeatureScript code implicitly assumes Parasolid tolerances. Wonky's strict 1e-7 mm contact bound may therefore reject contacts that Onshape accepts. Such cases need an explicit, recorded contact budget up to the FeatureScript `zeroLength` of 1e-5 mm, never a silent one.
   - Cross-kernel calibration (all DOCUMENTED):

     | System | Linear resolution | Box / range | Other |
     |---|---|---|---|
     | Parasolid (ov.pdf §3.6) | 1e-8 (m) | 1e3 (ratio 1e11) | angular 1e-11 |
     | ACIS R17, "Tolerance Variables" (http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/SPAacisuser_totol.htm) | `SPAresabs` 1e-6 model units | 1e4 (`SPAresnor` 1e-10) | `SPAresfit` 1e-3, `SPAresmch` 1e-11; "at least an order of magnitude guard band" |
     | Onshape FeatureScript std | `zeroLength` 1e-8 m | | `booleanDefaultTolerance` 1e-5 m, `computational` 1e-13 |
     | Zoo KCL (`std-solid-subtract.md`) | CSG/fillet `tolerance` default 1e-7 mm | | see the Zoo note |
     | wonky | contact bound 1e-7 mm | | |
5. **Execution model.** No mutation. Tolerance growth and topology compression must be expressed as pure rebuilds. Each stage takes a pair list and returns decisions, then a new B-rep is built. The per-stage structure makes this feasible. (INFERRED)
6. **Wonky's `recover` already emits Jackson-style tolerances; Jackson's rules show its certificate gap.** (DOCUMENTED facts from `docs/proto-recover.md`, mapping INFERRED.)
   - Each recovered edge record `e start end curve ... dev bound ...` carries `dev` (measured distance of the mesh boundary from the exact curve) and `bound` (the certified tolerance). That is a Jackson edge tolerance whose tube is centred on an *exact* 3D curve instead of a pcurve.
   - Vertices are Newton solutions with residual ≤ 1e-7 mm over all meeting carriers: a vertex sphere.
   - The `unified <classes> <tolerance>` record (carrier unification of near-coplanar planes, plan step 4) is a join-phase tolerance merge made explicit.
   - The clearance certificate refuses non-adjacent patches closer than h + h' + 1e-6 mm. That is Jackson's base rule (entities that come within the sum of their tolerances intersect, so they must share topology), applied as a refusal instead of a merge.
   - Gap: proto-recover lists "Clearance between adjacent patches away from their common edge" as *not certified* (pairs sharing a vertex are skipped). Jackson's rules 2 and 3 are exactly this missing check: every connected component of the tube/region intersection of two adjacent entities must contain, or contract onto, their *common* vertex or edge. A per-pair check "distance ≥ tol sum outside a neighbourhood of the shared vertex/edge" would close it.
7. **Approximated SSI curves with a stated bound = §6.2.** `docs/hybrid-boolean-plan.md` plan step 9 schedules "space quartics of cylinder/cylinder as B-spline curves with a stated bound computed in Bend". Jackson's model is the representational slot for that: an approximated curve is admissible if "the approximation tolerance is attached to the relevant faces or edges". Concretely, a quartic edge becomes a tolerant edge (tolerance = certified bound) with one pcurve per face, and its two end vertices get spheres ≥ that bound (monotonicity rule). The XT exact procedural curve (item 3) remains the alternative that needs no tolerance. INFERRED.
8. **Sewing for mesh/exact mixtures.** Sewing is "the Boolean without face-face and edge-face". When wonky chains `CertifiedMesh` operands with exact bodies (plan step 8), joining an exact patch to a mesh patch along a known seam is a sewing job: compare only vertices and edges within the sum of tolerances (mesh deviation + exact bound). INFERRED.

## Pointers worth porting or studying

- §3.2's three validity rules, as the definition of a checker for tolerant B-reps. They combine well with the PK/ACIS fault taxonomies (see the sibling notes).
- §4 imprint cascade:
  - order by dimension;
  - sum-of-tolerances coincidence test;
  - SSI skips known contacts;
  - re-compare split edges only against edges with a common vertex.
- §4 join rule: take the larger tolerance and compress to a 1:1 correspondence.
- §6.1 sewing, as the degenerate Boolean (no face-face stage). Useful for STEP import of other kernels' data.
- XT V35 §4.3.8-4.3.10, the concrete field-level encoding: null curve on a tolerant edge, fin SP-curves, null-double = half resolution. A good template for wonky's own entity records.
- Port sketch of the cascade under wonky's constraints (INFERRED; names are illustrative, not from the paper):

  ```
  imprint(A, B, budget) -> Result (Record, A', B') | Refuse(reason, needed_tol)
    R0 = empty record                                   -- immutable, append-only
    S1 = pmap over broad-phase pairs (vA, vB)           -- boxes inflated by tA + tB
           keep |pA - pB| <= tA + tB  -> Match(vA, vB)
    S2 = pmap over (v, e) with v not already matched to an end of e
           closest param t on e; if dist <= tv + te -> Split(e, t, tol := te)
    (A1, B1) = rebuild(A, B, S2)                        -- pure; new vertices get new ids
    S3 = pmap over (eA, eB)                             -- CCI, or CCS in a shared face's (u,v)
           coincidence ranges within tA + tB, minus ranges containing a matched vertex
    S4 = pmap over (v, f)  -> interior vertex matches
    S5 = pmap over (e, f)  -> only coincidence or intersections interior to both
    S6 = pmap over (fA, fB) -> SSI with known contacts from S3/S5 passed in as
           "already explained"; must return enough curves/points to separate sides
    re-compare only split edges against edges sharing a vertex (local, small)
    any merge that needs tol > budget -> Refuse("tolerance", needed_tol)
  ```

  Each `pmap` is a uniform map over a candidate array (balanced fork-join). S1 and S2 are fixed-cost point queries against analytic curves and so GPU-able; S4's surface-distance part is fixed-cost too, but its "interior of the face" test needs a point-in-loop pass whose cost depends on the loop size. Decisions are sorted by (stage, stable id pair) before `rebuild`, so thread count cannot change the result. Distances compare as F32x2; the accept/reject of a *coincidence* against a tolerance is a comparison of a computed distance to a stored F32 tolerance, which needs an error bound on the distance, not exact arithmetic. Whether two carriers are *identical* (plane equality, coaxiality) should instead use exact multi-limb predicates.

## Verdict: adapt

The algorithm skeleton (dimension-ordered imprint with shared decisions, tolerances on topology, pcurve-carried edges, sewing as a sub-Boolean) maps directly onto wonky's documented Boolean contracts and its current plane/cylinder blocker. Wonky's `recover` stage has already converged on per-edge `dev`/`bound` records, which are Jackson tolerances in all but name; Jackson's validity rules 2-3 name the one clearance check `recover` still skips.

The one core mechanism that conflicts with wonky's rules is implicit, unbounded local tolerance growth. It must become explicit, budgeted and recorded, with explicit failure. That makes this "adapt", not "adopt".

The source is a paper, so there is no code to port; the ideas are free to reimplement.
