# Rossignac & Requicha, "Offsetting operations in solid modelling" (CAGD 1986)

- **Kind:** journal paper, plus its free technical-memo twin and the underlying PhD thesis.
- **Canonical URL:** https://dl.acm.org/doi/10.1016/0167-8396(86)90017-8 (DOI 10.1016/0167-8396(86)90017-8; Elsevier page https://www.sciencedirect.com/science/article/abs/pii/0167839686900178, paywalled).
- **Other URLs:**
  - Semantic Scholar: https://www.semanticscholar.org/paper/Offsetting-operations-in-solid-modelling-Rossignac-Requicha/ace482153ca4f053783340ac9ffbbe6884088079
  - **Full text read, as TM-53** (June 1985, 40 pp., the preprint of the CAGD paper): University of Rochester URResearch, https://urresearch.rochester.edu/institutionalPublicationPublicView.action?institutionalItemVersionId=25940 (file `TM_53.pdf`, 15.12 MB). Local copies: `tmp/research/pdf/rossignac-requicha-1986-offsetting.pdf` and `.txt`. The scan is **missing printed pages 20–21 and 26–27** (Algorithm 4 `ClassEdge`, the end of §4.4 and §5 "An experimental implementation").
  - **Also read: the PhD thesis** J. R. Rossignac, "Blending and offsetting solid models", TM-54, Univ. of Rochester 1985, 183 pp.: https://urresearch.rochester.edu/institutionalPublicationPublicView.action?institutionalItemVersionId=985 (file `TM-54.pdf`). Local copy: `tmp/research/pdf/rossignac-1985-TM54-blending-offsetting-thesis.pdf` (a scan with no text layer; read chapters 2, 3.5 and 10–11 as images). The paper's "proofs … can be found in [Rossignac 85]", which is this thesis.
- **Authors / organization:** Jaroslaw R. Rossignac and Aristides A. G. Requicha, Production Automation Project (PADL-2 group), University of Rochester. NSF grants ECS-81-04646 and ECS-84-03882.
- **Publication:** Computer Aided Geometric Design 3(2):129–148, August 1986. OpenAlex counts 233 citations and Semantic Scholar 283 (queried 2026-09-23). OpenAlex marks it closed access; the TM is openly downloadable.
- **License:** the paper is © Elsevier. The TM and thesis are freely downloadable from the university repository, with no licence stated.
  - Porting implication: the content is mathematics and algorithms, with no code. The definitions, identities and algorithms can be reimplemented freely. Do not copy figures or text. INFERRED; not legal advice.

## What it is

The foundational definition of **solid offsetting** (growing and shrinking by a distance r) for r-sets. It shows that **constant-radius blending is a composition of two offsets**:

- rounding `R_r(S) = (S↓r)↑r`, the morphological *opening*;
- filleting `F_r(S) = (S↑r)↓r`, the *closing*.

It then describes how to support offsets in a dual CSG/B-rep modeller (PADL-2 lineage):

- CSG trees with offset nodes ("CSGO");
- boundary evaluation by generate-and-test;
- point and curve classification against offset nodes;
- approximation of the new canal-surface geometry by piecewise-circular curves (PCC).

The thesis adds three things:

- a semantic analysis of why blend specification is ill-posed;
- a Boolean-based recipe for *local* blends ("blend primitives");
- the algebra of the rounding and filleting operators (idempotence, max-convexity radius, a regularity fix).

## How it works

Labels: DOCUMENTED from the TM-53 page numbers ("p.") or thesis page numbers ("th.p."), unless marked otherwise.

### Definitions (p.3–4; thesis notation page)

- **Positive offset (grow):**
  - `S↑r = {p : ∃q ∈ S, ‖p − q‖ ≤ r}`
  - `= ⋃_{p∈S} B(p, r)`
  - `= {p : d(p, S) ≤ r}`

  i.e. the volume swept by a ball whose centre moves through S.
- **Negative offset (shrink):** `S↓r = c*((c*S)↑r)`, the complement of the grown complement (regularized complement `c*`).
- **Closure:** regular sets are closed under offsetting. Boundedness is preserved. Semi-analyticity is conjectured ("we have no formal proof", p.5).
- **Inclusion is preserved:** `A ⊂ B ⇒ A↑r ⊂ B↑r` and `A↓r ⊂ B↓r` (p.4).
- **Rigid motions commute with offsets** (p.5).
- **Boolean identities** (p.5–6). Only these distribute:
  - `(c*S)↑r = c*(S↓r)` and `(c*S)↓r = c*(S↑r)`
  - `(A ∪* B)↑r = A↑r ∪* B↑r`
  - `(A ∩* B)↓r = A↓r ∩* B↓r`
  - `(A −* B)↓r = A↓r −* B↑r`

  The remaining ones are only inclusions:
  - `(A ∩* B)↑r ⊂ A↑r ∩* B↑r`
  - `(A ∪* B)↓r ⊃ A↓r ∪* B↓r`

  So "s-offsetting primitives in a CSG representation … and combining them yields S↑r only in very special cases", e.g. union-only trees for growing.
- **Additivity:** `(S↑a)↑b = S↑(a+b)` and the same for ↓. But grow and shrink are *not* inverses: `(S↓r)↑r ⊂ S ⊂ (S↑r)↓r` (p.6).

### Blending operators (p.6–7; thesis §2.4, §3.5, th.p.25–59)

- **Rounding:** `R_r(S) = (S↓r)↑r = ⋃{B(Q, r) : B(Q, r) ⊂ S}`. It is the region swept by a ball that stays inside S. It "rounds the convex edges and vertices".
- **Filleting:** `F_r(S) = (S↑r)↓r = c(R_r(c S))`. It is the region a ball staying *outside* S cannot reach. It fillets concave edges and vertices (Property 3.35, th.p.54).
- **Proven properties** (th.p.53–58):
  - `R_r(S) ⊂ S ⊂ F_r(S)`.
  - Rounding and filleting are **idempotent**: `R_r(R_r S) = R_r S`. For `a ≤ r`, `R_a(R_r S) = R_r S`, so re-rounding with a smaller radius has no effect (Properties 3.39–3.40).
  - `S = R_r(S) ⇔ ∃A: S = A↑r` (Property 3.39).
  - **Radius of maximum convexity** `R̂(S) = sup{r : S = R_r(S)}` and of maximum concavity `Ř(S) = R̂(c S)`. `r < R̂(S) ⇒ R_r(S) = S`, and `R̂(S↑r) ≥ R̂(S) + r` (Properties 3.41–3.43).
- **Regularity caveat** (th.p.58–59):
  - `F_r` on a regular set can yield a non-regular set. Fig. 3.11: three triangles grown and then shrunk leave an isolated point.
  - `F_r` gives counter-intuitive results. Fig. 3.12: a slot narrower than 2r is filled up to where an outside ball can reach, instead of getting a round bottom.
  - Fix: the **modified fillet** `F′_r(S) = c*(R_r(c* S))`, equal to `k(F_r(iS))` for closed S (Def. 3.8 and Prop. 3.44). There are also regularized variants `R*_r = (S↓*r)↑r` and `F*_r`.
- **Global semantics and its side effects** (thesis §2.4, th.p.25–28):
  - Figure 2.14: global rounding **disconnects** a part whose thin junction is narrower than 2r.
  - Figure 2.16: `F∘R ≠ R∘F`, and neither is smooth in general.
  - Figure 2.2: `F_r` of two *disjoint* spheres closer than 2r creates a bridging neck even though "the solid has no edges". Global blends are not edge-local.

### Local blends via Booleans: the "blend primitive" recipe (thesis §2.3, th.p.21–24, Fig. 2.11)

1. The user picks a simple sub-solid Q containing the edge: "Typically, Q is the union of two half-spaces for concave-edge blends or the intersection of two half-spaces for convex-edge blends."
2. An **oversized fillet** is formed: `B = F_r(Q) − Q` for concave edges, and INFERRED dual `B = Q − R_r(Q)` for convex edges. For a plane/plane wedge, B is the sliver bounded by the two planes and one cylinder of radius r.
3. B is trimmed to size "by intersecting B with a box or another simple solid", giving the blend primitive P.
4. Combine: `S ∪ P` (fillet) or `S − P` (round).

The thesis claims three advantages:

- blended solids stay CSG-compatible and parameterisable;
- "only a relatively small number of low-level geometric utilities is needed";
- end conditions and blend interference are resolved *explicitly* by the order of operations and the trimming, rather than inferred ("to provide users with facilities to define blends unambiguously, rather than to infer users' intentions from ambiguous specifications", th.p.23).

### Why blend specification is ill-posed (thesis §2.2, th.p.14–21)

1985's list of issues, which is the same list as Parasolid's fault classes 15 years later:

- **End conditions:** how blends end at complex vertices (Fig. 2.4 shows 4 "obviously wrong" endings).
- **Blend interference:** two blends meeting (Fig. 2.5).
- **Obliteration of details:** a fillet swallowing a hole (Fig. 2.6).
- **Blend sequencing:** order matters, and blends can be blended further.
- **Non-smooth blend surface:** "when the radius of the rolling-sphere exceeds the radius of curvature of the trajectory", plus global self-intersection of the sweep envelope (Fig. 2.7).
- **Non-smooth junctions** (Fig. 2.8): "the specification of too large a blending radius is one of the major causes of non-smoothness".
- Fig. 2.3: PADL-2 blending six edges at a vertex with tori gave a *non-smooth* corner.
- The conclusion: "a reliable modeller must associate a valid solid object with any user specification that is not recognized as an error", while guaranteeing smoothness "seems neither easy nor cheap".

### Boundary of offset solids (p.8–11)

- `∂(S↑r) ⊂ {p : d(p, S) = r}`. The inclusion is strict in general (Fig. 3). The same holds for shrinking against `c*S`.
- The superset is built from **normal offsets ("n-offsets")** of the pieces of ∂S:
  - smooth faces F give `F‖r = {q + r·n(q)}`, which may self-intersect or degenerate (a sphere of radius r shrunk by r becomes a point);
  - singular (G¹-breaking) curves E give **canal/tube surfaces**, circles of radius r in the normal planes along the spine E;
  - singular points give spheres.
- **Surface zoo closure (p.11):** "n-offsetting a standard surface [plane, cylinder, cone, sphere, torus] produces a surface of the same type", but "n-offsetting an edge of intersection of two standard surfaces produces a canal surface". Therefore "only a new type of surface — a canal surface — must be introduced", but its spine may itself be an intersection of canal surfaces and "closed form equations … can be obtained readily only in very simple special cases".
- **Pruning** (p.17–18). A smaller tentative set suffices:
  - drop inward n-offsets of faces when growing (and outward ones when shrinking);
  - drop concave edges when growing (convex edges when shrinking);
  - never offset edges between tangent faces;
  - but *include* hidden singular points such as a cone apex (use "dummy edges");
  - n-offsetting *superfaces* (simpler supersets of faces) is allowed.

### Algorithms in a CSGO modeller (p.11–25)

- **Representation:** CSG trees with offset nodes (left child the solid, right child r). Canal surfaces are stored "indirectly (and exactly)" and also as an approximation used for all numerics. Edges are stored as parameterised **PCC** approximations plus references to the host surfaces "to refine the approximations when needed" (p.12–13).
- **Display and mass properties:** ray casting with `ClassEdge` (Algorithm 1) and cell classification with `ClassPoint`.
- **Boundary evaluation (Algorithms 2–3):** generate tentative faces, intersect pairwise into tentative edges, classify, keep `EonS`. For an offset node, the tentative faces are the n-offsets above.
- **Surface/surface intersection** (p.18–19):
  1. Intersect a grid of u *and* v generators (lines and circles on standard surfaces) of one face with the other face. These are algebraic equations of degree ≤ 4, solved analytically. Both families are needed or near-parallel intersections are missed.
  2. Match the points cell by cell in (u,v), subdividing a cell until it holds two intersections or a minimum resolution is reached.

  "It does not ensure that the topology of the intersection is correct, but such errors have never caused us any difficulties." Tangents come from `n1 × n2`.
- **Point classification** against `X↑r` (Algorithm 6): `in` if p is in or on X; otherwise compare `Dist(p, ∂X)` with r (`<` means in, `>` means out, `=` means on, if the neighbourhood is "PartFull").
- **Distance** (Algorithm 7): the minimum over singular points, normal projections onto singular curves, and normal projections onto the host surfaces of superfaces, *keeping only projection points classified `onS`*.
- **Neighbourhoods at `= r`** come from intersecting the n-offsets of the faces, curves and points where the distance is attained (Fig. 8). Ambiguous on/on cases need 3-D vertex neighbourhoods ("rather unwieldy").
- **PCC** (thesis ch. 7–9):
  - Edges are approximated by G¹ chains of circular arcs ("twisted bi-arcs", th.§8.2).
  - Canal surfaces are therefore approximated by **G¹-joined pieces of tori and cylinders**.
  - Accuracy is controlled by the maximum grid-cell size s: "the distance between the two end-points of an arc is less than √2·s", and intersection edges smaller than s may be missed (th.p.151).
  - Circle/surface intersections against plane, cylinder, cone, sphere and torus are worked out in th.§9.5.

## Robustness and guarantees

- **Proven** (thesis ch. 3): the closure, inclusion, distributivity, idempotence and regularity statements above.
- **Heuristic:**
  - the SSI point matching;
  - PCC accuracy, a grid-size bound only, with small intersection loops missable;
  - `= r` classification, which in floating point is a tolerance test.
- No certified numerics. The canal-surface "exact" representation is indirect and is not used for computation.
- The semantic guarantee is the valuable one. `R_r` and `F′_r` of an r-set are well-defined r-sets for every r, with no "blend fails" outcome. Failures become *side effects* (disconnection, filled slots, lost details), not errors.

## Parallelism and performance

From the 1985 thesis, th.p.151–155 (hardware unspecified, VAX-era):

- a torus/cylinder intersection edge in "three seconds";
- complex wireframes "in a couple of minutes";
- offsetting was the bottleneck: a solid with p patches, v vertices and e edges (b bi-arcs each) has an offset bounded by `p + v + b·e` patches, and all pairwise patch intersections are needed;
- shading needs "hundreds of thousands" of point classifications against offsets;
- "the efficiency of boundary evaluation for offset and blended solids must be improved significantly".

INFERRED Bend view:

- CSGO point classification is a textbook balanced fork-join: `Combine(ClassPoint(p, L), ClassPoint(p, R))`, uniform per point and per ray, so GPU-friendly.
- Algorithm 7's distance is a fixed enumeration over singular points, curves and superfaces: uniform work per query point.
- Pairwise tentative-face SSI is O(n²) independent tasks.
- No mutation is needed anywhere.

## Known failures, limitations, war stories

- The authors report heuristic SSI topology (p.19), non-smooth PADL-2 vertex blends with tori (thesis Fig. 2.3), global side effects (Figs. 2.14, 2.16, 3.11, 3.12) and slow boundary evaluation (th.p.152). DOCUMENTED.
- The canal-surface indirection "nightmare" (p.13) is why exact CSGO offsets never became a production B-rep approach. INFERRED; production kernels do local rolling-ball blends instead (see the Parasolid note).
- INFERRED: exact offsets of solids whose edges are ellipses or quartics (e.g. plane cutting a cylinder obliquely, or cylinder/cylinder) need **pipe surfaces around non-circular spines**. These are *outside* the plane/cylinder/cone/sphere/torus zoo. The "same surface zoo as the analytic tier" only holds when every offset edge is a line or a circle.

## Relevance for wonky

- **Semantics and test oracle (adopt):**
  - For a constant-radius circular fillet on edge e, away from its ends (more than r from any end vertex or neighbouring feature), the local B-rep fillet must equal the boundary of `R_r(Q)` (convex) or `F_r(Q)` (concave) for the local wedge Q at e.
  - Point-membership oracle, with no B-rep of the offset needed: `p ∈ R_r(S) ⇔ ∃q: ‖p − q‖ ≤ r ∧ d_S(q) ≤ −r`. This is checkable by sampling ball centres, or in closed form for planar wedges.
  - Closed-form volume tests (INFERRED from the Steiner formula):
    - `R_r(box a×b×c) = (box shrunk by r) ⊕ ball`, with `V = a′b′c′ + 2r(a′b′ + b′c′ + a′c′) + πr²(a′ + b′ + c′) + (4/3)πr³`, where `a′ = a − 2r` etc. This equals a box with all 12 edges filleted at r and 8 sphere corners, which is exactly what Parasolid produces for three equal blends at a vertex.
    - Filleting only the 4 X-parallel edges (Marc's `roundX`): `V = abc − (4 − π)·r²·a`.
  - Property tests on any wonky fillet implementation: idempotence (re-rounding with `a ≤ r` changes nothing), `R_r(S) ⊂ S ⊂ F_r(S)`, and "r below the max-convexity radius means no change".
- **First implementation strategy for local fillets (adapt):** the blend-primitive recipe turns a fillet into *Boolean with an analytic tool body*.
  - For plane/plane the tool is the wedge sliver bounded by 2 planes and 1 cylinder, trimmed by the end-cap planes. For plane/cylinder cap edges it is a torus sliver.
  - This reuses wonky's Boolean/SSI tier and keeps all surfaces analytic.
  - **But** the tool shares its planar faces *exactly* with S (coplanar overlap by construction). The Boolean must treat identical plane objects as on/on, i.e. Rossignac's neighbourhood problem. INFERRED: with shared plane records (the same identity and coefficients), exact predicates make this robust; with recomputed planes it is a classic failure.
  - End conditions are the trim box: correct for Marc's `roundX` (edges ending at planar faces perpendicular to the edge), wrong in general. Parasolid's capping rules decide the rest.
- **SDF prototype (libfive-style):**
  - Opening and closing are the *natural* SDF operations. But `f + r` is an exact shrink only if f is an exact Euclidean distance; after min/max CSG, f is only a bound, so `((f + r) − r)` does nothing and fake roundings appear. INFERRED.
  - A correct opening needs exact distance (Algorithm 7 style, or re-distancing a grid). Use the SDF path as a *visual/approximate* oracle, not a production fillet.
- **Mesh-recovery hybrid:** the same identities give a mesh-level cross-check. Hausdorff distance between the recovered fillet and a dense sampling of `∂R_r(Q)` stays within the stated tolerance. INFERRED.
- **Compare, clearance and interference** (wonky's missing "general compare/interference") are defined here (p.30), DOCUMENTED:
  - **approximate equality** `X↓ε ⊂ Y ⊂ X↑ε`;
  - **clearance** of at least 2r iff `(X↑r) ∩* (Y↑r) = ∅`.

  INFERRED: implement them as distance queries, not by building offsets. The definitions fix the semantics and the tolerances explicitly, which is what the project rules require. For FDM this is the print-in-place clearance check, e.g. `(X↑0.1) ∩ (Y↑0.1) = ∅` for a 0.2 mm gap.
- **Shell and offset semantics:** Rossignac's offset is the *Euclidean* (arc-join) offset. Convex edges grow into cylinders; concave edges shrink into cylinders.
  - Parasolid's hollow/offset is **not** Euclidean. DOCUMENTED in the Parasolid v12 Functional Description, ch. 19 "Local Ops: Hollowing & Offsetting" (http://www.q-solid.com/Parasolid_Docs/chapters/fd_chap.20.html, local copy `tmp/research/parasolid-blend/fd_chap.20.{html,txt}`):
    - `PK_BODY_hollow_2(body, offset, tolerance)`: "A positive distance offsets outwards, creating a slightly larger hollowed body. A negative distance offsets inwards, creating a hollowed body the same size as the original." This is exactly `opShell`'s sign convention (positive = outward).
    - "Parasolid created new edge geometry where the offset surfaces intersected. For outward offsets (positive) this can mean extending the underlying surface(s) so that the offset surfaces meet" (Fig. 19-4): intersection-join, sharp edges, like OCCT `GeomAbs_Intersection`.
    - Opening faces are **pierce faces** (offset 0): "each pierce face is reduced in size by performing a local boolean using any shared edges in their pre-offset and offset positions". Per-face offsets are allowed (`offset_faces`/`offset_values`), and tangent pierce faces need side faces along smooth boundary edges.
    - Self-intersecting offset surfaces: `PK_offset_method_accurate_c` (default; cut at the self-intersection, "may leave sharp edges") vs `_approximate_c` (replace locally by an approximate offset within tolerance; Parasolid recommends it for new work).
    - `offset_step`: optional side "step" faces perpendicular to the offset face along smooth boundary edges.
  - INFERRED: since Onshape runs Parasolid and `opShell` has the same sign convention, Onshape shells are intersection-joined. wonky's `opShell` must be sharp, not Rossignac. Consequence for tests: at a convex edge with normal angle θ, the outward sharp shell's outer edge lies `t/cos(θ/2)` from the original edge, not `t`; so "wall thickness ≥ t everywhere" holds, but "outer surface = S↑t" does not. The Euclidean version remains the right semantics for clearance, interference and minimum-wall checks.
- **PCC:** approximating non-circular spines by G¹ bi-arcs gives canal-surface approximations made of *exact tori and cylinders*, with a stated tolerance. That matches wonky's rules ("approximations need explicit tolerances") and exports to STEP as toroidal/cylindrical surfaces. INFERRED. It is a candidate for the "offset of an elliptic edge" tier, instead of B-splines.
- **Precision:** normal projections onto the standard surfaces are closed-form (sqrt). Circle/standard-surface intersection is degree ≤ 4 (th.§9.5): feasible in F32x2 with isolation plus refinement. The `= r` decisions need exact or perturbed predicates. INFERRED.

## Pointers worth porting or studying

- TM-53 p.3–7: definitions and identities, for property tests.
- TM-53 p.8–11: n-offset superset construction and surface-zoo closure.
- TM-53 p.17–18: pruning rules for tentative faces.
- TM-53 p.18–19: generator-grid SSI and cell matching; compare with wonky's own SSI.
- TM-53 p.22–25: Algorithms 5–7 (point classification against offsets, distance, neighbourhoods).
- TM-53 p.30: tolerance-equality and clearance definitions.
- Thesis th.p.14–21: the blend-semantics issue list, which serves as the design doc for wonky's fillet error policy.
- Thesis th.p.21–24 (Fig. 2.11): the blend-primitive recipe, the first-implementation candidate.
- Thesis th.p.53–59: the operator algebra, the max-convexity radius and `F′_r`.
- Thesis ch. 8 (th.p.111–129): twisted bi-arcs and the PCC representation.
- Thesis §9.5 (th.p.134–141): closed-form circle/surface intersections.
- Thesis th.p.151–152: performance lessons.

## Verdict: adapt

Adopt the definitions and algebra as wonky's semantic spec and test oracle for fillets, rounds, clearance and approximate equality. Adapt the blend-primitive recipe (analytic tool body plus Boolean) as the first local-fillet implementation for plane/plane and plane/cylinder edges, taking care with the coplanar faces. Do not build a general CSGO canal-surface modeller: the paper itself shows it is slow and only heuristically correct. Keep PCC in reserve for offsets of non-circular edges.
