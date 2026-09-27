# Miller & Goldman 1995: Geometric algorithms for detecting and calculating all conic sections in the intersection of any two natural quadric surfaces

- Kind: journal paper plus its technical-report and companion papers. All were read in full from the author's site on 2026-09-22:
  - **GMIP 1995 paper** (12 pp.): https://people.eecs.ku.edu/~jrmiller/Papers/DetectAndCalc.pdf, local `tmp/research/pdf/miller-DetectAndCalc.pdf`. DOI https://doi.org/10.1006/gmip.1995.1006.
  - **TR-93-02, Part II: geometric constructions** (28 pp., complete pseudo-code and derivations): https://people.eecs.ku.edu/~jrmiller/Papers/TR-93-02_MillerGoldman.pdf, local `miller-goldman-tr93-02.pdf`.
  - **TR-93-01, Part I: theoretical/algebraic analysis** (35 pp., scanned): https://people.eecs.ku.edu/~jrmiller/Papers/TR-93-01_GoldmanMiller.pdf, local `miller-TR-93-01_GoldmanMiller.pdf`. Downloaded but not text-extractable. Its results are summarised in the Part II and GMIP tables.
  - **Companion: plane/natural quadric**, "Using tangent balls to find plane sections of natural quadrics", IEEE CG&A 12(2) 1992, DOI https://doi.org/10.1109/38.124290: https://people.eecs.ku.edu/~jrmiller/Papers/TangentBalls.pdf, local `miller-TangentBalls.pdf/.txt`.
  - **Companion: non-planar QSIC**, Miller 1987, "Geometric approaches to nonplanar quadric surface intersection curves", ACM TOG 6(4) 274-307, DOI https://doi.org/10.1145/35039.35041: https://people.eecs.ku.edu/~jrmiller/Papers/GeomAppNPQSIC.pdf, local `miller-GeomAppNPQSIC.pdf/.txt`.
  - **SMA'91 short version**, Goldman & Miller, "Combining algebraic rigor with geometric robustness...", DOI https://doi.org/10.1145/112515.112545. Not read.
- Authors/org, year:
  - James R. Miller (Univ. of Kansas; earlier Control Data Corp.) and Ronald N. Goldman (Rice Univ.).
  - GMIP 57(1):55-66, January 1995, received 1994-03-17.
  - Crossref counts 41 citations for GMIP 1995, 20 for CG&A 1992 and 66 for TOG 1987. DOCUMENTED (https://api.crossref.org).
- License and porting implications:
  - Academic Press / IEEE / ACM copyrighted papers, freely hosted by the author. There is no code; the published artefacts are pseudo-code and closed-form formulas.
  - The algorithms are mathematics and freely re-implementable. Do not copy text or figures. A Bend port from the pseudo-code carries no licence obligation. INFERRED.
- Status: historical and foundational. Implemented in C by Miller in the Kansas solid modeller, and later cited as the geometric baseline by:
  - Wang/Goldman/Tu 2003
  - Dupont/Lazard/Lazard/Petitjean 2008 (QI)
  - Shao & Chen 2024 (`tmp/research/pdf/shao-chen-2024-trimmed-quadrics.pdf`)

  DOCUMENTED.

## What it is

A complete, **case-by-case geometric decision procedure** for the pairwise intersection of the natural quadrics: plane, sphere, right circular cylinder and right circular cone. For each pair it:

1. Decides whether the degree-4 intersection degenerates into conics or lines, using a handful of distance and angle tests on the geometric parameters (axis, base point, radius, half-angle).
2. Computes those conics directly as geometric records: circle (C,w,r), ellipse (C,u,v,ru,rv), parabola, hyperbola, line (B,w).
3. Identifies the remaining "line + space cubic" degeneracies.
4. Hands the genuinely non-planar quartic cases to the parameterisation of Miller 1987.

The **algebra (Part I, TR-93-01)** is a one-time "paper analysis": it enumerates every configuration whose pencil Q1 − λQ2 contains a plane pair (rank ≤ 2). The **code** contains only its geometric reinterpretation. The authors claim **completeness**: every configuration with a planar intersection is listed, including the ones that are hard to see. DOCUMENTED (GMIP sec. 1-3, Theorems 1-2; Part II sec. 1).

## How it works

### Representation and primitives (GMIP sec. 3, Part II sec. 2)

Geometric records:

| Record | Parameters |
|---|---|
| Plane | (B, w) |
| Sphere | (C, r) |
| Cylinder | (B, w, r) |
| Cone | (V, w, α), with α the half-angle |

All direction vectors are unit.

Primitives:
- `distance`, `signed_distance_along_line(Q,L) = (Q − L.B)·L.w`, `normalize`, `line`, `plane`.
- Line-line intersection or closest approach (Goldman, Graphics Gems p. 304). The axes are **skew** iff the two closest points differ.
- On-surface tests in implicit geometric form:
  - cylinder: (Q−B)·(Q−B) − ((Q−B)·w)² − r² = 0
  - cone: ((Q−V)·w)² − cos²α (Q−V)·(Q−V) = 0

Every equality test is "within some prespecified tolerance". Because each tested quantity is a spatial distance or an angle cosine, the tolerance has a physical meaning. DOCUMENTED.

**LawOfCosines(d1,d2,d3) → (cosβ, h).** It computes h = (d1² + d2² − d3²)/(2 d2) directly instead of via cosβ·d1, because multiplying and dividing by d1 loses accuracy. DOCUMENTED (Part II sec. 4.1, GMIP sec. 3).

### Planarity conditions (Table 4 of GMIP = Table IV of Part II), verbatim content

| Pair | Condition for planar intersection | Result |
|---|---|---|
| sphere/sphere | always | empty, tangent point, or one circle |
| sphere/cylinder | sphere centre on cylinder axis | empty, tangent circle, or two circles |
| sphere/cone | sphere centre on cone axis | empty, tangent circle, circle + vertex, or two circles |
| cyl/cyl | parallel axes | empty, one tangent line, or two lines |
| cyl/cyl | intersecting axes **and** equal radii | two ellipses |
| cyl/cone | coincident axes | two circles |
| cyl/cone | axes meet at a point at distance d = r/sin α from the cone vertex | two ellipses (same or opposite halves), or ellipse + tangent line |
| cone/cone | parallel axes, same half-angle | ellipse, shared tangential ruling, or hyperbola |
| cone/cone | coincident axes | two circles or single vertex |
| cone/cone | axes meet at I with d1 sin α1 = d2 sin α2 (dᵢ = |Vᵢ − I|; includes coincident vertices) | pairs of conics or tangent line + conic; 1-4 lines if the vertices coincide |

DOCUMENTED. Any pair not matching a row intersects in a non-planar curve: a quartic, or a line plus a cubic (see below).

Observation (INFERRED, mine, checked against the table): for **intersecting axes**, every planar row is exactly the existence of a **common inscribed sphere centred at the axis intersection I**:
- cyl/cyl: equal radii r, so a sphere of radius r at I touches both.
- cyl/cone: |I − V| = r/sin α, so a sphere of radius r at I touches both.
- cone/cone: d1 sin α1 = d2 sin α2, which is the common radius.

This is the classical Dandelin/Monge "common inscribed sphere ⇒ two plane curves" theorem. Miller and Goldman call it "a sufficient but not a necessary condition", because the parallel-axis and coincident-axis rows are planar without such a sphere (GMIP sec. 1).

### Two-point tangencies (Table 3) and isolated tangent points (GMIP sec. 4)

Two-point tangencies occur only in these configurations:

| Pair | Configuration |
|---|---|
| sphere/cone | centre in plane (V,w) at d = r/cos α from V |
| cyl/cone | skew axes at distance d = r sinθ / √(sin²θ − sin²α) |
| cone/cone | perpendicular axes with v = √(1 − tan²α1 tan²α2) cos α1 cot α2 · μ, or a skew case with two more constraints |

The implementation does **not** test these rows. Instead, all isolated tangent points (single and double) fall out of the non-planar algorithm:
- On a ruled parameterisation surface Q1, the curve is a(t)s² + b(t)s + c(t) = 0.
- Tangent rulings are the roots of the discriminant b² − 4ac = 0, a rational quartic.
- Only roots where the discriminant is negative on both sides are tangent points.
- They are located geometrically without solving the quartic (Miller 1987).

The authors state that one-point-tangency configurations are **not** fully characterised. DOCUMENTED (GMIP sec. 2, 4; Part II sec. 3).

**Gap filler (added 2026-09-24).** Shene & Johnstone's manuscript (read in full, see `shene-johnstone-1994-on-the-lower-degree-intersections-of-tw.md`) gives direct isolated-tangency and disjointness tests:
- Lemma 7.1: isolated tangency needs skew axes, with each vertex outside the other surface.
- cyl/cyl: tangent at an isolated point iff the axes are skew and the common perpendicular equals r1 + r2.
- cone/cone (Thm 7.1) and cyl/cone (Cor. 7.1): compare the distances from a point S on one axis to the two bounding planes of the other cone against the inscribed-sphere radius at S (d sin α2, or r for a cylinder).

These decide `TangentPoint` / `Disjoint` up front from the geometric parameters, without the discriminant quartic. DOCUMENTED (Shene-Johnstone manuscript sec. 7).

### Constructions (Part II sec. 4, GMIP sec. 5)

All constructions run in world coordinates, with **no coordinate transformations** and **no nonlinear solves**. The only operations are square roots, normalisations and line intersections. DOCUMENTED (Part II sec. 4 intro: "finding planar intersections between pairs of natural quadric surfaces is inherently a linear problem").

- **Sphere/sphere**, with d = |C2 − C1| and S1.r ≥ S2.r:
  - d > r1 + r2 or d < r1 − r2: empty.
  - Equality: tangent point C1 + r1 ĉ.
  - Otherwise LawOfCosines(r1, d, r2) gives (cosβ, f), and the circle is C = C1 + f ĉ, w = ĉ, r = r1 sinβ.
- **Sphere/cylinder** (centre on the axis):
  - r_s < r_c: empty.
  - Equal radii: tangent circle.
  - Otherwise two circles C = S.C ± √(r_s² − r_c²) w, radius r_c.
- **Sphere/cone** (centre on the axis). With t_d = r/sin α and d = signed distance of the centre along the axis:
  - |d| > t_d: empty.
  - |d| = t_d: tangent circle, h = √(t_d² − r²), C = V + sign(d) h cos α w, radius h sin α.
  - |d| = r: vertex + circle, with h = 2 r cos α.
  - Otherwise two circles: h1 = d cos α, h2 = √(r² − (d sin α)²), C = V + (h1 ± h2) cos α w, radius |h1 ± h2| sin α.
- **Cylinder/cylinder, parallel axes**, with d = distance(C1.B, axis2) and r1 ≥ r2:
  - Empty outside [r1 − r2, r1 + r2].
  - At either end: a tangent line at C1.B + r1 n̂, where n̂ is the unit vector from axis 1 to axis 2.
  - Otherwise LawOfCosines(r1, d, r2) gives f, Q = C1.B + f n̂, h = r1 sinβ, u = w × n̂, and the two lines are Q ± h u.
- **Cylinder/cylinder, intersecting axes, equal r.** The pencil plane pair factors as (sy + (c+1)z − ω(c+1))(sy + (c−1)z − ω(c−1)), with s = sinθ, c = cosθ. From this:
  - n1 = w1 + w2, n2 = w1 − w2. The two planes are perpendicular.
  - I = axis ∩ axis, common minor axis m = n̂1 × n̂2.
  - Ellipse k (k = 1, 2): C = I, u = n̂ of the other plane, v = m, ru = r/(n̂ₖ·w1), rv = r.

  DOCUMENTED (Part II eq. 3, p. 11).
- **Cylinder/cone, coincident axes**: two circles at V ± (r/tan α) w with radius r.
- **Cylinder/cone, intersecting axes** (|I − V| = r/sin α). Pencil factorisation (eq. 7) gives:
  - n1 = w_cyl + F w_con, n2 = w_cyl − F w_con, where F = sec α.
  - Common point Q = V + (cω sin²α/s²) w_cyl + (ω − ω sin²α/s²) w_con, where ω is the signed distance of I along the cone axis. Q is the intersection of the two ellipses' major axes.
  - conic1 = cylinder ∩ plane(Q, n1).
  - If |cosθ| = cos α: conic2 = line(V, w_cyl), the **tangentially shared ruling**. This is detected up front, never inferred from a near-tangent plane/cylinder section.
  - Otherwise conic2 = cylinder ∩ plane(Q, n2).

  DOCUMENTED (Part II pp. 12-15, GMIP pp. 61-62).
- **Cone/cone, parallel axes, same α**:
  - If V2 is on C1: conic = line(V1, V2 − V1).
  - Otherwise ω = (V2 − V1)·w1, Q = midpoint(V1, V2), n = normalize(V2 − V1 − ω F² w1), conic = C1 ∩ plane(Q, n).

  The result is a hyperbola, ellipse or double line according to whether V2 is outside, inside or on C1. DOCUMENTED (Part II sec. 4.6.1).
- **Cone/cone, coincident axes**, with Eᵢ = tan αᵢ and h = |V1 − V2|:
  - Equal α: one circle at the midpoint.
  - Otherwise a = h E1/(E1 + E2), d = h E2/(E1 − E2), and two circles on the same half of C2.

  DOCUMENTED (sec. 4.6.2).
- **Cone/cone, intersecting axes** (d1 sin α1 = d2 sin α2). Pencil factorisation (eqs. 9-17) gives:
  - n1 = F2 w2 + F1 w1, n2 = F2 w2 − F1 w1, with Fᵢ = sec αᵢ.
  - Common point Q = V1 − g w2 + (e1/d1 + c g) w1, where:
    - c = w1·w2, s = √(1 − c²)
    - ω = (V2 − V1)·w1, υ = ((V2 − V1)·w2 − c ω)/s
    - e1 = 2(sω − cυ)/(s F1)
    - e2 = 2(υ(1 − s² F2²) − s c F2² ω)/(s F2)
    - d1 = 2F1, d2 = s² d1, d3 = 2 s² F2
    - g = c e1/d2 + e2/d3
  - Q = V1 if the vertices coincide.
  - The two conics are C1 ∩ plane(Q, n1) and C1 ∩ plane(Q, n2).
  - A final filter drops the redundant "vertex only" conic.

  DOCUMENTED (Part II pp. 18-23, GMIP pp. 63-64).

### Plane/natural quadric via tangent balls (CG&A 1992)

Dandelin spheres give the foci. The final code (DOCUMENTED, TangentBalls sec. "Plane-cylinder" and "Plane-cone") is:

- **Plane/cylinder:**
  - d = signed distance of C.B from the plane, cosθ = C.w·P.w.
  - If cosθ = 0: tangent line, empty, or two lines at Proj(B) ± √(r² − d²)(C.w × P.w).
  - If |cosθ| = 1: circle.
  - Otherwise the ellipse is C = C.B − (d/cosθ) C.w, u = normalize(C.w − cosθ P.w), v = P.w × u, ru = r/|cosθ|, rv = r.

  wonky's `plane_cylinder` already implements exactly this (docs/intersections.md, `CircleSection`/`EllipseSection`/`TwoGenerators`/`TangentGenerator`/`EmptySection`). INFERRED.
- **Plane/cone, vertex off the plane.** Orient so that (V − B)·P.w < 0 and C.w·P.w ≥ 0. Then:
  - t = (P.B − V)·P.w, b = cos²θ − sin²α, h = t/b
  - C = V + h cosθ C.w − h sin²α P.w
  - u = normalize(C.w − cosθ P.w), v = P.w × u
  - ru = |h| sin α cos α, rv = t sin α/√|b|
  - The conic is an ellipse if cosθ > sin α and a hyperbola if cosθ < sin α.
- **Plane/cone, parabola** (cosθ = sin α): V_par = V + d P.w + e f̂ with e = ½ d (tanθ − cotθ), f̂ = normalize(C.w − cosθ P.w), focal length f = ½ d cotθ.
- **Plane/cone, vertex on the plane.** Let diff = sin²α − cos²θ:
  - diff < 0: the vertex only.
  - diff = 0: one line along u.
  - diff > 0: two lines V + (u ± ratio·v) with ratio = √(diff/(1 − sin²α)), taken as the limit of the hyperbola asymptotes.

The authors note that detecting a circle *before* computing ellipse parameters avoids the redundant, mutually inconsistent signals ru = rv, u = 0 and v = 0 ("Redundancy invites inconsistency"). DOCUMENTED.

### Line + space cubic (GMIP sec. 6, Part II sec. 5, with proofs)

- **Theorem 3.** A cylinder/cone intersection is a line plus an irreducible cubic iff all of these hold:
  - θ(axes) = α
  - the cone vertex lies on the cylinder
  - the axes are skew

  The line is line(V, w_cyl).
- **Theorem 4.** A cone/cone intersection is a line plus an irreducible cubic iff all of these hold:
  - each vertex lies on the other cone
  - the vertices are distinct
  - the axes are skew

  The line is line(V1, V2 − V1).
- Sphere and cyl/cyl pairs can never produce this case.

DOCUMENTED.

### Top-level driver (GMIP sec. 7, verbatim structure)

`intersect_two_quadrics(Q1, Q2)`:
1. Test the Table 4 conditions. If one holds, run its construction and return.
2. If a cone is involved, test Theorems 3/4. If one holds, return the line plus the cubic (the cubic is computed by Miller 1987).
3. Otherwise the result is a non-degenerate quartic. Compute it by Miller 1987, detecting single and double tangent points while computing its parametric limits. Tangent points may coexist with disjoint QSIC branches.

### Non-planar curves (Miller 1987, the companion that completes the SSI)

- Parameterise with a ruled surface, always one of the two inputs:
  - cylinder: P(s,t) = γ(t) + s w with γ(t) = B + r(cos t u + sin t v)
  - cone: P(s,t) = B + s(δ(t) + w) with δ(t) = tan α (cos t u + sin t v)
- Substitute into the geometric implicit form of the other surface to get **a(t)s² + b(t)s + c(t) = 0**, where every coefficient has a geometric meaning:
  - cyl/cyl: a = 1 − (w_p·w_o)², which is constant and positive for non-parallel axes; b(t) = 2 b′·(γ(t) − B_o) with b′ = w_p − (w_p·w_o) w_o; c(t) = the other cylinder's implicit equation at γ(t).
  - cyl/sphere: a = 1, b′ = B_p − B_o.
  - cone/sphere: a = tan²α + 1.
  - cyl-param with cone: a = (w_p·w_o)² − cos²α_o.
  - cone-param with cylinder: a(t) = tan²α + 1 − (w_o·(δ(t) + w_p))².
- Each curve point costs **one quadratic solve** (s = (−b ± √(b² − 4ac))/2a), so there is no Newton and no marching.
- Critical t values bound the intervals where the discriminant is ≥ 0. They are found **geometrically without the quartic**:
  - cyl/cyl: the two lines cut from the other cylinder by the plane containing its axis and the common perpendicular. Their intersections with the parameterisation cylinder give the start and end t values and the figure-eight crossing (Table II of Miller 1987).
  - cyl/sphere: circle-circle intersection in the plane through the sphere centre perpendicular to the axis.
  - cone cases: zeros of b(t) come from cone ∩ plane(B_o, b′). Zeros of a come from circle-circle constructions. Discriminant zeros come from tangent planes through the vertex, via a quadratic in the rational parameter.
- The topology is one branch, a figure eight, or two branches, plus branches through infinity for cones. It is decided from radii, axis distance and angle comparisons.
- The **smaller** cylinder as parameterisation surface covers the whole t range with one ± sign per branch. The **larger** cylinder gives both roots on the same branch.

DOCUMENTED (Miller 1987 sec. 2, 6.1-6.3, Tables I-II).

## Robustness and guarantees

- **Completeness of the case analysis** for planar components (GMIP sec. 1) and for line + cubic (Theorems 3/4, with proofs): DOCUMENTED. The completeness proof is the algebraic Part I, which was not re-verified here.
- **Not complete:** one-point tangencies are not characterised. They rely on the discriminant analysis. DOCUMENTED.
- **Numerical robustness is argued, not proven:**
  - every tested quantity is a distance or an angle cosine, which gives meaningful tolerances
  - short formula chains ("the more calculation ... the less accurate")
  - no transformations
  - no classification from implicit coefficients, which Wilson's IGES study showed flips conic type under perturbation (Miller 1987 sec. 2.2)

  DOCUMENTED.
- **Explicit hazard:** after computing two conics on a surface pair, a later conic/conic intersection may miss their known crossing because of "numerical fuzz". The authors recommend returning the conic/conic crossing points computed from the surface data together with the conics. This is the same principle as Jackson 1995 ("do not recompute known contact"). DOCUMENTED (Part II sec. 4.7).
- **Tangent-ruling cases must be detected before building planes.** Otherwise the plane/cylinder section may come out as two close lines, a thin ellipse, or nothing (GMIP sec. 5.1.2). DOCUMENTED.
- **Tolerances are single scalars per comparison**, "(again to within some prespecified tolerance)". There is no error propagation or certified bound. INFERRED: equality tests like `abs(cos_theta) = cos_alpha` need wonky's three-way Resolved / Unresolved-near-degenerate / Rejected discipline.

## Parallelism and performance

- Measured in 1993 on an SGI IRIS 4D/60 (~7 MIPS, ~0.7 MFLOPS):
  - the cyl/cone two-ellipse case of Fig. 5c ran ~480 times per second
  - the cone/cone ellipse + hyperbola case of Fig. 7d ran ~330 times per second

  DOCUMENTED (GMIP sec. 7).
- Each construction is a fixed, short, branch-structured sequence of dot and cross products, a few sqrt/normalize calls and one line intersection. Pairs are independent. INFERRED: this is ideal GPU-uniform or fork-join work, apart from branch divergence across relation types, which can be sorted by pair type first.
- Point evaluation on a non-planar QSIC (Miller 1987) is closed-form per t: one quadratic. That is uniform work per sample, with no iteration count. INFERRED.

## Known failures, limitations, war stories

- Scope is natural quadrics only. There are no tori, so fillet faces need other sources (e.g. Li 2004 torus/natural quadric, already in `tmp/research/pdf`). DOCUMENTED (scope) and INFERRED (gap).
- The half-cone problem: the math describes double cones. Restricting to one nappe is extra work, done either by trimming against plane(V, w) or by interval filtering (Miller 1987 sec. 6.2). CAD kernels use half-cones: Parasolid's XT cone is a half-cone (see the XT note). DOCUMENTED.
- Tolerance-based equality tests are inherently discontinuous near the boundaries of the Table 4 conditions. The paper does not discuss what to return when a configuration is *near* planar, e.g. two cylinders with radii 10 and 10.0000001 and intersecting axes. INFERRED. wonky's `NearTangency`/`NearCircleSection`-style Unresolved results are the right answer; silently snapping to "two ellipses" would violate the no-silent-tolerance rule.
- No issue tracker. The only published "war story" is Wilson's IGES conic-classification drift, cited in Miller 1987 as the motivation. DOCUMENTED.

## Relevance for wonky

- **Direct next step after `plane_cylinder`.** `kernel/intersections.bend` currently returns `UnsupportedSurfacePair` for cylinder/cylinder and cone pairs (docs/intersections.md). This paper plus its two companions is a complete, ported-from-pseudo-code roadmap for the full natural-quadric SSI table:
  - plane × {sphere, cylinder, cone}: TangentBalls
  - quadric × quadric conic cases: Table 4 constructions
  - line + cubic: Theorems 3/4
  - general quartic: Miller 1987's a(t)s² + b(t)s + c(t) = 0

  INFERRED.
- **OCCT covers only a subset of this table in closed form** (DOCUMENTED, code read 2026-09-24: `src/ModelingData/TKGeomBase/IntAna/IntAna_QuadQuadGeo.cxx` at OCCT `3d097a0`, 2026-08-24, local clone `tmp/research/occt-intpatch/occt`).

  | Pair | Closed-form cases in OCCT | Otherwise |
  |---|---|---|
  | cyl/cyl | parallel axes (0/1/2 lines); intersecting axes with equal radii, relative radius tolerance `myEPSILON_CYLINDER_DELTA_RADIUS = 1e-13` (two ellipses built from the directions w1 ± w2, matching Part II eq. 3); skew axes with distance = r1 + r2 (tangent point) | `IntAna_NoGeometricSolution` |
  | cyl/cone | coaxial only (two circles) | `NoGeometricSolution` |
  | cone/cone | coaxial; parallel axes; common apex (0/1/2 lines); "common generatrix", i.e. each apex on the other cone | `NoGeometricSolution` |

  - The cone/cone "common generatrix" branch is literally Shene-Johnstone's Theorem 5.1 construction: characteristic point = foot of the axis-intersection on the common line, then intersect the other two generatrices, then cut with the plane through both.
  - **Missing** relative to Table 4: the intersecting-axes cyl/cone two-ellipse case (|I − V| = r/sin α) and the intersecting-axes cone/cone two-conic case (d1 sin α1 = d2 sin α2). OCCT sends those to its generic `IntAna_IntQuadQuad` path. That path is angle-parameterised: A(θ)v² + B(θ)v + C(θ) = 0, which is Miller 1987 in trigonometric form (see `open-cascade-technology-occt-intpatch-impimpintersection-and.md`). The result is an `IntPatch_ALine`, so a planar conic that exists is never recognised as one.
  - So a full MG port gives wonky strictly more exact curves than OCCT's analytic layer. INFERRED from the code.
- **Exact curve representation without a chart.** For quadric pairs, the non-planar curve can be stored as (parameterisation surface, other surface, t-intervals, ± branch sign) and evaluated in closed form, with one sqrt per point in F32x2. That is cheaper and more exact than a Parasolid-style chart + Newton (see `parasolid-xt-format-reference-v35-intersection-curve-chart-t.md`), and deterministic: no convergence failures. The chart and Newton remain the general fallback for torus and B-spline pairs. INFERRED.
- **Bend fit** (INFERRED):
  - Each relation test is a comparison of an F32x2 quantity against a tolerance band, giving Resolved / Unresolved(Near*) / Rejected exactly as wonky already does.
  - Tests with exact meaning (axes parallel, axes intersecting, vertex on surface) can be escalated to multi-limb U32 predicates when inputs are dyadic F32x2 words. For example, "axes coplanar" is the sign of det[w1, w2, B2 − B1], a degree-3 polynomial in the inputs.
  - Tests involving α are **not** polynomial in stored words if α is stored as an angle (sin α, sec α). Store (cos α, sin α) or tan α as input words, as Parasolid does (it stores sin and cos of the half angle), so that conditions like d1 sin α1 = d2 sin α2 become polynomial and exactly decidable.
  - No mutation or iteration is needed. Constructions are pure functions returning small records, and Miller 1987 point generation is a uniform per-t map, suitable for the GPU tessellator.
- **Hybrid bake-off:** in the leading "mesh decides topology, analytic recovers exact curve" prototype, this table is the **analytic recovery** for all natural-quadric face pairs. Mesh-segment chains are matched to one of the Table 4 conics or to a Miller 1987 branch (identified by t-interval and sign), not re-fitted. INFERRED.
- **g10 blocker (plane/cylinder union with contact):** the relevant relation is `TangentGenerator` / tangent circle. Miller–Goldman's rule "detect the tangent ruling from the input parameters first, construct it directly" is exactly what should feed a Jackson-style imprint pre-pass. INFERRED.
- **LLM ergonomics and naming:** every result carries a semantic relation name (two ellipses, tangent ruling + ellipse, line + cubic) that can become part of provenance and diff output ("the union changed from two ellipses to a tangent ruling + ellipse"). INFERRED.

## Pointers worth porting or studying

1. GMIP Table 4 as the `Relation` enum for quadric pairs, with Table 3 and Theorems 3/4 as separate relations (`TwoPointTangency`, `LinePlusCubic`).
2. Part II pp. 7-23 pseudo-code, one Bend function per row. The cyl/cone and cone/cone cases need the pencil-derived normals n1,2 and the common point Q (Part II eqs. 7, 12-17).
3. TangentBalls plane/cone unified ellipse/hyperbola code, parabola code and vertex-on-plane code (pp. 77-81). This completes `plane_cone` next to the existing `plane_cylinder`.
4. The `LawOfCosines` auxiliary, h = (d1² + d2² − d3²)/(2 d2), as the numerically preferred form.
5. Miller 1987 sec. 6.1.2 and Table II: cyl/cyl topology and critical points via two line/cylinder intersections. This is the exact curve kernel for oblique cylinder pairs, which are the common non-planar case in FDM parts (cross-drilled holes, pipe tees).
6. The Part II sec. 4.7 advice: return conic/conic crossing points from the surface pair itself, so the trimming stage never re-derives them.
7. Parasolid's half-cone convention plus Miller 1987 sec. 6.2 nappe filtering, for restricting results to the modelled half.
8. Cross-check oracle: Shene-Johnstone's axial-plane height test and their Lemma 8.1 projection conic Q1 − Q2 = 0 must reproduce every Table 4 decision for coplanar axes. Their Thm 7.1 / Cor. 7.1 fill this paper's one-point-tangency gap. See `shene-johnstone-1994-on-the-lower-degree-intersections-of-tw.md`.

## Verdict: adopt

Closed-form, short, transformation-free constructions over exactly wonky's surface set. The case analysis is complete for planar components and states its one gap (one-point tangencies). The algorithms were proven in a production modeller. Port the three papers' pseudo-code into `kernel/intersections.bend` as the natural-quadric SSI table. Keep wonky's own Unresolved near-degeneracy bands around every equality test, and use exact integer predicates where the condition is polynomial in the stored words.
