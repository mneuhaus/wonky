# Shene & Johnstone 1994: On the lower degree intersections of two natural quadrics

- Kind: journal paper. Canonical: https://doi.org/10.1145/195826.197316 (ACM TOG 13(4):400-424, October 1994).
- **Full text read (2026-09-24)** from the author-hosted manuscript "On the Lower Degree Intersections of Two Natural Quadrics I: Algorithms", 25 pp., scanned: https://sites.uab.edu/jkj/files/2019/12/naturalQuadricIntersection.pdf (linked from https://sites.uab.edu/jkj/implicit-curves-and-surfaces/). Local copy `tmp/research/pdf/johnstone-naturalQuadricIntersection.pdf`. It has no text layer; it was read page by page as images.
  - **Manuscript vs. published version.** The manuscript carries the JHU address, NSF grant IRI-8910366, 40 references, and sections on tangency and disjointness. The TOG abstract on Crossref (41 references) instead ends with "a simple method for determining the types of conic in a degenerate intersection without actually computing the intersection, and an enumeration of all possible conic types". That material is **not in the manuscript**: it announces a Part II, "Characterization Theorems", as "in preparation". So the published paper was reorganised. Everything below is DOCUMENTED from the manuscript. The conic-type enumeration is known only from the TOG abstract. DOCUMENTED (Crossref abstract, https://api.crossref.org/works/10.1145/195826.197316; manuscript title page and refs [37], [38]).
  - The ACM DL copy is behind a Cloudflare human-verification checkbox, and scripted curl gets HTTP 403. It was not bypassed. Semantic Scholar lists the paper as `CLOSED`.
- Companions:
  - Johnstone & Shene 1992, "Computing the intersection of a plane and a natural quadric", Computers & Graphics 16(2):179-186, https://doi.org/10.1016/0097-8493(92)90045-W (JHU TR 91-04). Not read: ScienceDirect returns 403 to scripts.
  - Shene & Johnstone, "On the planar intersection of natural quadrics", SMA'91 pp. 233-242, https://doi.org/10.1145/112515.112546. Not read.
  - Shene's PhD thesis, "Planar intersection and blending of natural quadrics", JHU 1992. Not read.
  - Shene 2000, "Do blending and offsetting commute for Dupin cyclides?", https://pages.mtu.edu/~shene/PUBLICATIONS/2000/blend.pdf (local `shene-2000-blend.pdf`). Read earlier; it restates the axial-plane quadrilateral and the Pitot-type condition.
- Authors/org, year: Ching-Kuang Shene and John K. Johnstone, Dept. of Computer Science, Johns Hopkins University. Shene was later at Michigan Tech; Johnstone later at UAB. Preliminary results were presented at SMA'91. Crossref: 29 citations, 41 references. Semantic Scholar: 51 citations. DOCUMENTED.
- License: ACM copyright for the TOG text; the manuscript is posted by the author. There is no code; the mathematics and pseudo-code are freely re-implementable. Do not copy figures or text. INFERRED.
- Status: historical. It is one of the three classic geometric treatments of natural-quadric degeneracies, with Miller & Goldman 1991/1995 and Miller 1987. DOCUMENTED (citing surveys, e.g. Wang/Goldman/Tu 2003 sec. 1.2).

## What it is

A purely geometric (non-pencil) method to detect and compute the **degenerate** intersections of two natural quadrics: sphere, circular cylinder, right circular cone. It covers:
- conics
- linear intersections: lines, double lines
- isolated tangency points
- disjointness

The central idea: the problem reduces to **2D line intersections in the "axial plane"** H containing both axes, plus a comparison of two "heights" measured perpendicular to H. It also gives a short algebraic proof of the common-inscribed-sphere criterion. DOCUMENTED (manuscript abstract, sec. 1, 9).

Table 1 of the manuscript lists the possible degenerate intersection types of two natural quadrics:

| Conics | Lines | Points |
|---|---|---|
| 2 | 0 | 0 |
| 1 | 1 | 0 |
| 0 | 1, 2, 3 or 4 | 0 |
| 0 | 0 | 1 or 2 |

A common tangent line counts as a linear intersection. DOCUMENTED (Table 1, Def. 3.2).

## How it works

Notation: C(V, ℓ, α) is a cone with vertex V, axis ℓ and half-angle α; Z(ℓ, r) is a cylinder; S(O, r) is a sphere. A cylinder's "vertex" is the point at infinity along its axis. **All cones are double cones.** DOCUMENTED (sec. 3, Fig. 3, footnote 4).

### Structural lemmas (sec. 4.1-4.2)

- **Lemma 4.1** (via the Dandelin sphere, Thm 4.1). If a plane P cuts an axial quadric in a conic, the plane through the conic's major axis and the quadric's axis is perpendicular to P.
- **Lemma 4.2.** If two axial natural quadrics have a conic intersection, their **axes are coplanar**. If the intersection contains a circle, the axes coincide.

  This is **necessary only**, not iff. Shao & Chen 2024 misquote it as "iff".
- **Definition 4.1.** For distinct coplanar axes, the **axial plane** H contains both. H cuts each surface in a **skeletal pair** of lines: two generators for a cone, two parallels for a cylinder.
- **Lemma 4.3.** The four skeletal lines form a **complete quadrilateral** (six intersection points, working in the projective plane) iff V1 ∉ S2 and V2 ∉ S1, i.e. neither vertex lies on the other surface's skeletal lines.
- **Lemma 4.4.** If coplanar, distinct-axis quadrics have a conic intersection, each conic lies in a plane **through a diagonal of the quadrilateral and perpendicular to H**. Only diagonals that do not contain a vertex are considered.

DOCUMENTED (sec. 4).

### Height test (sec. 4.3)

- For a point U in H, the **height** h is the distance from U to the surface along the normal of H. It is well defined by mirror symmetry about H.
- Computation, with K the foot of the perpendicular from U to the axis ℓ and d1 = |UK|:
  - cone: d2 = |VK|, squared height h² = (d2 tan α)² − d1²
  - cylinder: h² = r² − d1²
  - h² < 0 means U lies outside the surface's cross-section circle, i.e. an imaginary height.

  DOCUMENTED (Fig. 6).
- **Equal height ⇒ equal conic.** On a diagonal d with endpoints R, S (both finite), both sections share the major axis RS and are symmetric about H. With a = |RS|/2, the origin at the midpoint of RS and U at x = u, each section is x²/a² + Bᵢ y² = 1 with Bᵢ = (a² − u²)/(a² hᵢ²). So h1² = h2² ⇔ C1 = C2. DOCUMENTED (Fig. 5).
- If one of R, S is at infinity, the section is a **parabola**. Take R as the vertex and d, d⊥ as the axes. Then y² = 4fx with f = h_u²/(4u). DOCUMENTED.
- **One comparison decides both conics.** Evaluate the heights at X, the **intersection of the two diagonals**. Heights do not depend on which diagonal is used, so equality at X certifies both diagonal planes at once, with two squared-height computations in total. If the diagonals are parallel, test a point on each diagonal separately. DOCUMENTED (sec. 4.3, end).

### Algorithm Conic-Intersection, non-degenerate case (p. 10, verbatim structure)

1. If the axes are not coplanar, there is no conic intersection. Otherwise let H be the axial plane.
2. If ℓ1 = ℓ2 and V1 ≠ V2: two circles. If ℓ1 = ℓ2 and V1 = V2: the common vertex or the entire surface.
3. Skeletal pairs in H: ℓ11, ℓ12 (from Q1) and ℓ21, ℓ22 (from Q2).
4. If V1 ∈ ℓ21 ∪ ℓ22 or V2 ∈ ℓ11 ∪ ℓ12: degenerate case (sec. 5).
5. P1 = ℓ11∩ℓ21, P2 = ℓ11∩ℓ22, P3 = ℓ22∩ℓ12, P4 = ℓ21∩ℓ12.
6. X = P1P3 ∩ P2P4, the diagonal intersection. If the diagonals are parallel, go to 10.
7. Compute the squared heights h1², h2² to both surfaces at X.
8. If h1² = h2², the intersection is conic.
9. If P1 and P3 are finite, the conic on P1P3 is central. If P3 is at infinity, it is a parabola. Likewise for P2P4.
10. With parallel diagonals, test with any point of P1P3, then any point of P2P4.

DOCUMENTED.

### Degenerate cases (sec. 5-6)

- **Exactly one vertex on the other surface** (V1 ∈ S2, V2 ∉ S1, or vice versa). There is no conic and no linear intersection: "the intersection curve is a space quartic with one isolated point". DOCUMENTED (Lemma 5.1).
- **Double line + conic** (V1 ∈ S2, V2 ∈ S1, V1 ≠ V2, cones; the cylinder/cone case is analogous, cyl/cyl is purely linear).
  - The common skeletal line V1V2 is a **double line**, because the plane through it perpendicular to H is tangent to both surfaces. By Bézout the residue is a conic.
  - **Parallel axes** (equal cone angles): the double line plus a circle at infinity, so the only finite component is V1V2.
  - **Intersecting axes**, with O = ℓ1∩ℓ2: the distance from O to V1V2 is d = d1 sin α1 = d2 sin α2, which is the radius of the **common inscribed sphere** (Lemma 5.2).
  - **Theorem 5.1.** Let P be the intersection of the other two skeletal lines and Q the foot of the perpendicular from O to V1V2 (the sphere's tangent point). Then the residual conic lies in the plane through PQ perpendicular to H. The proof factors the pencil in normalised coordinates as (y + r)(y − 2x/(c+d) + r) = 0 with c = tan α1, d = tan α2, using c²u² = r²(1 + c²).
  - Algorithm:
    - If P is finite: the conic is central with major axis PQ, centre X = midpoint(P, Q), semi-major |PQ|/2, and semi-minor √|h_X²| along the normal of H. It is an ellipse if h_X² > 0 and a hyperbola otherwise.
    - If P is at infinity: a parabola with vertex Q, with the focal length from the sec. 4.3 height formula.

  DOCUMENTED (sec. 5.2, Figs. 9-11).
- **Common vertex** (V1 = V2 = V, distinct axes; only possible for cone/cone, since for cylinders it means parallel axes: empty, one tangent line or two lines).
  - Construction: take P11, P12 on ℓ1 at distance cos α1 from V, and P21, P22 on ℓ2 at distance cos α2. The lines in H through them, perpendicular to their axes, form a **parallelogram ABCD** with diagonals L1 = AC and L2 = BD.
  - **Lemma 6.1.** A point P ≠ V of H lies on L1 ∪ L2 iff the ratio of the distances from V to P's perpendicular feet on ℓ1 and ℓ2 is cos α1 / cos α2.
  - **Theorem 6.1.** Two cones with a common vertex always meet in lines, lying in the planes through Lᵢ perpendicular to H. At T ∈ Lᵢ, both squared heights equal t² − p² with p = |VT|.
  - Algorithm, using the heights at A and at D:
    - h_A² > 0: two lines, from V through the points A ± h_A·n_H
    - h_A² = 0: one double line VA
    - h_A² < 0: imaginary, so only V
    - repeat with D

    This gives at most 4 lines.

  DOCUMENTED (sec. 6, Figs. 12-13).

### Tangency and disjointness (sec. 7), which Miller-Goldman leave open

- **Lemma 7.1.** If two axial quadrics with distinct vertices are tangent at an **isolated** point, their axes are **skew** and each vertex lies **outside** the other surface.
- **Cylinder/cylinder:** tangent at an isolated point iff the axes are skew and the common-perpendicular length equals r1 + r2.
- **Definition 7.1, bounding planes.** For a cone C and a line v through its vertex, outside C: the two planes through v tangent to C. They split space into four quadrants, and the two containing C are the bounding regions B(C, v).
- **Lemma 7.2.** If V1 is outside C2, V2 is outside C1, and ℓ2 ∩ B(C1, V1V2) ≠ ∅, the cones intersect transversally.
- **Theorem 7.1 (cone/cone tangency and disjointness).** Preconditions: V1 outside C2, V2 outside C1, ℓ2 outside B(C1, V1V2).
  - Take any S ∈ ℓ2, S ≠ V2, and d = |SV2|.
  - Let T1, T2 be the bounding planes of C1 w.r.t. V1V2, touching C1 along the lines t1, t2.
  - Let dᵢ be the distance from S to Tᵢ, with Sᵢ the foot of the perpendicular. d sin α2 is the radius of the sphere at S inscribed in C2.
  - Outcomes:
    1. d1, d2 > d sin α2: disjoint.
    2. d1 > d2 = d sin α2: tangent at t2 ∩ V2S2, or disjoint if that point does not exist.
    3. d2 > d1 = d sin α2: tangent at t1 ∩ V2S1, or disjoint.
    4. d1 = d2 = d sin α2: tangent at up to both points.
    5. d1 < d sin α2 or d2 < d sin α2: transversal.

  DOCUMENTED (sec. 7, Fig. 14).
- **Corollary 7.1 (cylinder/cone).** Replace V1V2 by the line v through the cone vertex parallel to the cylinder axis, and compare d1, d2 against the cylinder radius r in the same five cases. The printed case 5 reads "d1 < r or d1 < r". That is a typo for d2. DOCUMENTED (text), INFERRED (typo).

### Necessary and sufficient condition (sec. 8)

- **Lemma 8.1.** Put H as the xy-plane. By symmetry every axial quadric with its axis in H has the form Qᵢ(x, y) + z² = 0. Eliminating z gives the **projection of the intersection curve onto H**, the degree-2 curve Q1(x, y) − Q2(x, y) = 0. The intersection is conic or linear iff this projection conic **factors**. DOCUMENTED.
- **Theorem 8.1 (common inscribed sphere).** Intersecting, distinct axes give a conic intersection iff there is a common inscribed sphere.
  - Proof: with c = tan α1, d = tan α2, u and v the vertex distances from O, and θ the axis angle, the projection conic's discriminant is Δ = sin²θ (1 + c²)(1 + d²) [d²v²/(1 + d²) − c²u²/(1 + c²)].
  - The inscribed radii are r1² = c²u²/(1 + c²) and r2² = d²v²/(1 + d²), so Δ = 0 ⇔ r1 = r2.
- **Corollary 8.1.** This gives exactly Miller-Goldman's conditions: cones d1 sin α1 = d2 sin α2; cone/cylinder d1 sin α1 = r; cylinders r1 = r2.
- **Theorem 8.2 (parallel axes).** Conic iff equal cone angles, since Δ = −v²(c² − d²). Remark 8.1: this is the inscribed sphere with its centre at infinity.

DOCUMENTED (sec. 8).

## Robustness and guarantees

- Proven, with short geometric or algebraic proofs:
  - coplanar axes are necessary
  - conic planes lie through diagonals perpendicular to H
  - the height-equality test
  - the common-vertex line theorem
  - the tangency/disjointness classification for cone/cone and cylinder/cone (distinct vertices, preconditions above)
  - the inscribed-sphere iff

  DOCUMENTED.
- The paper does not discuss floating-point behaviour or tolerances. Every decision is an **equality of two squared lengths** (h1² = h2², dᵢ = d sin α2) or an **incidence** (vertex on skeletal line, axes coplanar or parallel). INFERRED: each needs an explicit tolerance band in F32x2, and each is polynomial in the inputs if cones are stored with tan α (or sin/cos) rather than α. For example, the cone squared height is (d2 c)² − d1² with c = tan α. So each can be decided exactly with multi-limb U32 arithmetic when the inputs are dyadic.
- Scope gaps:
  - Spheres are not treated by the axial-plane machinery. INFERRED: they are trivial, since h² = r² − |UO|² for a centre in H.
  - All cones are **double cones**. The half-cone restriction that CAD kernels need (Parasolid XT stores half-cones) must be applied afterwards. DOCUMENTED (figures) and INFERRED (consequence).
  - Isolated tangency is characterised only for pairs with distinct vertices, and for cone/cone only under the Theorem 7.1 preconditions. Other configurations are routed to Lemma 7.2 (transversal) or to the vertex cases.

## Parallelism and performance

No measurements. Each case is O(1): at most a handful of 2D line intersections in H, two or four squared heights, and comparisons. That is fixed work per pair and branch-light, and it vectorises trivially over many surface pairs once they are sorted by pair type. INFERRED.

## Known failures, limitations, war stories

- **Manuscript vs. TOG:** the published version's conic-type predicate and the conic-type enumeration are not in the reachable manuscript. Part II ("Characterization Theorems") appears as "in preparation" and was not located. DOCUMENTED (absence).
- Typos to watch for when transcribing:
  - Corollary 7.1 case 5 (d1 vs. d2). INFERRED.
  - The later Shene 2000 restatement of the quadrilateral test has an apparently inverted condition: "if abs(V1R − V1S) = abs(V2R − V2S) then the half-cones do not intersect in an ellipse". INFERRED.
- Near-degenerate configurations are discontinuous, e.g. a vertex almost on a skeletal line, or h1² ≈ h2². The paper returns either "conic" or "quartic" with no middle ground. INFERRED; wonky must return Unresolved inside a tolerance band.
- No code and no issue tracker.

## Relevance for wonky

- **A second, independent derivation of the natural-quadric degeneracy table.** Miller-Goldman (see `miller-goldman-1995-geometric-algorithms-for-detecting-and-c.md`) is the primary port because it has world-coordinate pseudo-code for every row. Shene-Johnstone gives the same conditions (Cor. 8.1 = MG Table 4 intersecting-axis rows, Thm 8.2 = MG parallel-axis rows) via a different construction, **2D line arrangements in the axial plane**. Two derivations that must agree make a strong **property-test oracle** for `kernel/intersections.bend`. INFERRED.
- **It closes a gap Miller-Goldman admit.** MG state that one-point tangencies are not characterised and rely on discriminant analysis. Shene-Johnstone Thm 7.1 and Cor. 7.1 plus the cyl/cyl skew-distance rule give **direct isolated-tangency and disjointness tests** for cone/cone, cone/cylinder and cylinder/cylinder:
  - For wonky these become `TangentPoint` and `Disjoint` relations decided before any curve construction.
  - This is the "decide contact from the analytic parameters first" rule the g10 contact blocker needs (see `jackson-1995-boundary-representation-modelling-with-local-to.md`).

  INFERRED.
- **An exact curve form for all coplanar-axis pairs, not just the degenerate ones** (INFERRED, mine, from Lemma 8.1). The whole intersection curve of any two natural quadrics with coplanar axes (spheres with centre in H included) is the **lift of the 2D conic Q1 − Q2 = 0 in H by z = ±√(−Q1(x, y))**. Consequences:
  - The lift's branch turning points (z = 0) are where the projection conic meets Q1's skeletal lines, i.e. the quadrilateral vertices P1..P4. So branch topology is a 2D arrangement question: an exact-predicate-friendly, uniform-work, one-sqrt-per-point evaluator.
  - Example, the FDM "tee": two perpendicular cylinders with intersecting axes and radii r1 ≠ r2. The projection is the hyperbola y² − x² = r1² − r2². The curve is (x, y, ±√(r1² − y²)). For r1 = r2 the hyperbola degenerates into y = ±x, which gives the two ellipses.
  - Skew axes (offset cross holes) still need Miller 1987's ruled-surface form or a chart.
- **Fillets.** The same paper line (Shene's thesis, Shene 1998) proves that two cones or cylinders are cyclide-blendable essentially iff they meet in conics. So the conic detector here is also the **gate for exact Dupin-cyclide or torus fillets** (see `dupin-cyclide-blends-shene-1998-two-cones-and-foufou-et-al-2.md`). INFERRED.
- **Bend fit** (INFERRED):
  - Pure functions over small records.
  - All primitives are 2D line intersections and dot products in F32x2.
  - Fork-join or GPU lanes over surface pairs.
  - Exact escalation via multi-limb U32 for the incidence and equal-height predicates.
  - No iteration, no mutation.

## Pointers worth porting or studying

1. Algorithm Conic-Intersection (p. 10) and the single-point X height test (sec. 4.3): a cheap cross-check of MG's Table 4 decisions.
2. Theorem 7.1 and Corollary 7.1 (pp. 17-19): isolated tangency and disjointness for cone/cone and cylinder/cone, plus the cyl/cyl skew rule (p. 17). Port these as wonky's `TangentPoint` / `Disjoint` relations; MG has no equivalent.
3. Section 6: common-vertex cones yield up to 4 lines via the parallelogram diagonals and heights at A and D. MG cover this (cone/cone, coincident vertices, 1-4 lines), but this construction is simpler.
4. Theorem 5.1: double line plus residual conic through P and Q. **OCCT implements exactly this construction** in the cone/cone "common generatrix" branch of `IntAna_QuadQuadGeo::Perform(Cone, Cone)`: the characteristic point is the foot of the axis intersection on the common generatrix, then the two other generatrices in the maximal plane are intersected, and the cone is cut with the plane through both points. Location: `src/ModelingData/TKGeomBase/IntAna/IntAna_QuadQuadGeo.cxx` ~L1759-1885 at OCCT `3d097a0`. OCCT also has the cyl/cyl skew tangent-point rule (d = r1 + r2). It lacks this paper's cone/cone and cyl/cone isolated-tangency tests. DOCUMENTED (code).
5. Lemma 8.1: the projection conic Q1 − Q2 = 0 in the axial plane, as the basis for an exact lifted-conic representation of coplanar-axis QSICs (see Relevance).
6. For the missing conic-type enumeration, check the TOG version through an interactive ACM DL session, or Shene's JHU thesis.

## Verdict: adapt

The paper is now fully read (author manuscript). It is not the primary implementation source: Miller-Goldman has more complete world-coordinate pseudo-code for construction. But three pieces are worth porting into wonky's natural-quadric SSI table, each with a tolerance band and an exact integer fallback:
- the isolated-tangency and disjointness theorems (Thm 7.1, Cor. 7.1, cyl/cyl skew rule), which fill Miller-Goldman's stated gap
- the axial-plane height test, as an independent oracle
- the Lemma 8.1 projection view, which yields an exact lifted-conic curve form for coplanar-axis pairs
