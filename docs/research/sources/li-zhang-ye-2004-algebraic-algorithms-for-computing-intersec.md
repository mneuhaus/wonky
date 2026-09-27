# Li, Zhang & Ye 2004: Algebraic algorithms for computing intersections between torus and natural quadrics (plus the torus SSI cluster)

- Kind: conference-journal paper. Computer-Aided Design & Applications 1(1-4):459-467, 2004. DOI https://doi.org/10.1080/16864360.2004.10738288 (Crossref: 3 citations).
  - Open PDF (verified 200, 2026-09-23): https://www.cad-journal.net/files/vol_1/CAD_1(1-4)_2004_459-467.pdf. Local copy: `tmp/research/pdf/li2004-torus-natural-quadrics.pdf/.txt`, read in full.
- Companion sources covered in this note:
  - **Kim, Kim & Oh 1998**, "Torus/Sphere Intersection Based on a Configuration Space Approach", Graphical Models and Image Processing 60(1):77-92, https://doi.org/10.1006/gmip.1997.0451. Closed access; the abstract is elided in Crossref, Semantic Scholar and Unpaywall.
    - The abstract was recovered on 2026-09-24 from an archived CiteSeerX page: http://web.archive.org/web/20130620220612/http://citeseerx.ist.psu.edu/viewdoc/summary?doi=10.1.1.29.7019 (content summarized below).
    - The preprint it links, `http://www.cgvr.postech.ac.kr/mskim/ftp/tsi.ps`, is dead and not in the Wayback Machine (404, 2026-09-24).
    - **Full text not read.**
  - **K.-J. Kim 2012**, "Circles in torus–torus intersections", J. Computational and Applied Mathematics 236(9):2387-2397, https://doi.org/10.1016/j.cam.2011.11.025. Elsevier open archive (Unpaywall: bronze OA), but ScienceDirect blocks non-browser clients, including headless Chrome (2026-09-24). **Not read.**
    - A search-engine summary (HEARSAY) says it "compute[s] all the circles in the intersection curve of two tori, based on the geometric properties of the circles embedded in a torus", using geometric constraints.
  - **Liu, Liu, Yong & Paul 2011**, "Torus/Torus Intersection", CAD&A 8(3):465-477, https://doi.org/10.3722/cadaps.2011.465-477. Open PDF: https://www.cad-journal.net/files/vol_8/CAD_8(3)_2011_465-477.pdf, local `tmp/research/pdf/liu2011-torus-torus.pdf/.txt`. Read.
  - **Gonzalez-Vega, Caravantes, Diaz-Toca & Fioravanti 2025**, "Tools for analyzing the intersection curve between a torus and a quadric through projection and lifting", arXiv:2503.08924, https://arxiv.org/abs/2503.08924. Local `tmp/research/pdf/arxiv-2503.08924-torus-quadric.pdf`. Skimmed for main results.
  - **Jia et al. 2013**, "Topological classification of non-degenerate intersections of two ring tori", CAGD. Title only, from the Li/Yang/Jia 2026 reference list ([li-yang-jia-2026-advances-and-challenges-in-surface-surface-.md](li-yang-jia-2026-advances-and-challenges-in-surface-surface-.md)). Not read.
- Authors/org: Qiang Li, Sanyuan Zhang and Xiuzi Ye, Zhejiang University. Funded by China NSF and MOST.
- License: journal copyright (CAD Solutions LLC / Taylor & Francis). Methods are freely re-implementable (INFERRED). No code was published.
- Status: historical. Low impact (3 citations). The authors list torus/torus as future work, which Liu et al. 2011 and Kim 2012 later addressed.

## What it is

Closed-form or semi-closed-form intersection of a torus with the three natural quadrics used in CAD: cylinder, cone and sphere (DOCUMENTED, abstract). The paper has three ingredients:

1. A local coordinate system (LCS) that puts the torus in standard form.
2. For cylinder and cone: parameterize the quadric by its generator lines, so each line/torus intersection is a quartic in the line parameter t.
3. Geometric detection of the special configurations whose intersection contains circles (profile, cross-sectional/meridian, Villarceau). Other cases produce sampled points that are sorted into polylines. Torus/sphere gets an explicit two-branch algebraic parameterization.

## How it works

### Torus in the LCS (DOCUMENTED, eq. 2.1)

Centre P0, unit axis A0 (taken as x), major radius R0 and minor radius r0:

`(x² + y² + z² + R0² − r0²)² = 4 R0² (y² + z²)`

### Torus/cylinder, non-parallel axes (DOCUMENTED, §2.1)

- **Frame:** `A0* = A0`, `A1* = A0×A1/|A0×A1|`, `A2* = A0*×A1*`, so the cylinder axis direction has no A1* component: `A1 = a0 A0* + a2 A2*`, with a0² + a2² = 1.
- **Cylinder by generators:** `x(θ,t) = v0 + a0 t + c0 R1 sinθ`, `y = v1 + R1 cosθ`, `z = v2 + a2 t + c2 R1 sinθ`.
- **Per θ, a monic quartic** `t⁴ + a t³ + b t² + c t + d = 0` with p = p(θ,0):
  - `a = 4(a0 x + a2 z)`
  - `g = |p|² + R0² − r0²`
  - `b = 4(a0 x + a2 z)² + 2g − 4 a2² R0²`
  - `c = 4(a0 x + a2 z) g − 8 a2 R0² z`
  - `d = g² − 4R0² (y² + z²)`

  The printed OCR is garbled. These coefficients were re-derived and agree with the paper's layout: expand `s = |p0 + t d|² + R0² − r0²` with |d| = 1, d_y = 0 (INFERRED re-derivation).
- **Solver:** Ferrari's formula via the resolvent cubic `y³ − a2 y² + (a1 a3 − 4a4) y + (4 a2 a4 − a3² − a1² a4)` (appendix).
- Each θ gives 0, 2 or 4 points.

### Parallel, non-collinear axes (DOCUMENTED, eqs. 2.6-2.9)

- With d the axis distance: `z² = R1² − (y−d)²` and `ρ² = y² + z² = R1² + 2yd − d²`.
- This gives an explicit parameterization by y: `x² = r0² − (ρ ∓ R0)²`, i.e. `x² = r0² − R0² − ρ² ± 2R0ρ`.
- Domain: x² ≥ 0 and z² ≥ 0.

### Collinear axes (DOCUMENTED)

- `x² = r0² − (R0 − R1)²`.
- Result: one profile circle if |R0 − R1| = r0 (tangent), two if it is smaller, empty if larger.

### Circle cases, cylinder (DOCUMENTED, §2.1)

- (a) Collinear axes: profile circles.
- (b) Meridian circle. Let Q be the intersection of the plane {P0; A1} with the cylinder axis. Conditions: A0 ⊥ A1, P0Q ⊥ A0, |P0Q| = R0 and R1 = r0. The cylinder axis is then tangent to the core circle at Q, and the cylinder contains the cross-sectional circle at Q (centre Q, radius r0, plane {Q; A1}).
- (c) Villarceau circle. Let Q be the intersection of the plane {P0; A0} with the cylinder axis. Conditions: P0Q ⊥ A1, |P0Q| = r0, R1 = R0 and `(A0·A1)² = 1 − r0²/R0²`. Result: a Villarceau circle of radius R0 in plane {Q; A1}.
- The paper spells it "Yvone-Villiaroeau".

### Torus/cone (DOCUMENTED, §2.2)

- Identical scheme with generators `P1 + t A1 + t tanβ (cosθ B1 + sinθ C1)`.
- Circle cases (a)-(c) carry over with |P1Q| tanβ = r0 (meridian) and |P1Q| tanβ = R0 (Villarceau).

### Sorting the samples (DOCUMENTED, §3)

1. Step θ by Δθ. Start at θ*, the angle with the most roots.
2. Between consecutive θ, match sorted roots by minimising Σ|t0[i] − t1[j]| over the (n,m) ∈ {2,4} combinations. Unmatched roots start or end curves.
3. Merge polylines whose ends are within a parameter threshold ε. Ties go to "minimal angular span", used only for self-crossing curves.
4. The result is at most eight polylines.

### Torus/sphere (DOCUMENTED, §4)

- **Frame:** with V = P1 − P0, `dx = A0·V` and `dz = −|V|√(1 − cos²φ)` (the sphere centre lies in the torus's xz half-plane).
- **Curve:** substituting gives a quadratic in x with z-dependent coefficients:
  - `a(z) = 4dx² + 4R0²`
  - `b(z) = −8R0² dx + 4 dx f(z)`
  - `c(z) = −4R0² [−dx² − dz² + R1² + 2z dz] + f(z)²`
  - `f(z) = −dx² − dz² − r0² + R0² + R1² + 2z dz`

  Hence `x = (−b ± √Δ)/2a` and `y² = R1² − (x − dx)² − (z − dz)²` over −R0 − r0 ≤ z ≤ R0 + r0, restricted to y² ≥ 0 and Δ ≥ 0.
- **Circle cases:**
  - (a) dz = 0, i.e. the sphere centre is on the torus axis: profile circles.
  - (b) dx = 0, dz = −R0, R1 = r0: one cross-sectional circle (tangential; the sphere is a tube ball).
  - (c) dx = 0, R1 > r0, dz² = R1² − r0² + R0²: two cross-sectional circles.
  - (d), (e): two Villarceau circles.

### Liu, Liu, Yong & Paul 2011: torus/torus with topology resolution (DOCUMENTED, §2-5)

- **Pre-image curve:** substitute torus T1's parameterization into T2's implicit equation. This gives F(u,v) = 0 in T1's parameter space. With half-angle substitution it is a polynomial of degree ≤ 4 in each of tan(u/2) and tan(v/2).
- **Characteristic points:**
  - boundary points (u = 0 or v = 0 edges, in left-right and top-bottom pairs);
  - u-turning points (`F = F_v = 0`, `F_u ≠ 0`);
  - singular points (`F_u = F_v = 0`). These are classified by the discriminant `F_uv² − F_uu F_vv`: negative is an isolated point, zero a cusp, positive a branch point with two slopes.
- Characteristic points are found with the Interval Projected Polyhedron solver.
- **Theorem 1:** removing all characteristic points splits the pre-image into C¹ one-valued segments v = g_i(u) that never cross. Segments are wired by root-count changes (single/double start and end points) and by second-derivative tests; degenerate derivatives are handled by bilateral perturbation of u0.
- **Refinement:** insert the exact midpoint (a closed-form quartic solve on an iso-circle) while the point-to-chord distance exceeds ε/1.22.
  - The 1.22 factor is empirical: "the real error is 22% larger than the approximate error we estimate".
  - So the precision is not a proven bound.
- **Circles** (§4) are detected up front and divided out:
  - a minor circle of T1 coinciding with a minor circle of T2;
  - a minor circle of T1 coinciding with a profile circle of T2.
- **Timings:** 0.17-14 ms for ε = 1e-2 to 1e-4 on an E5300 2.6 GHz (VC++ 2005, Tab. 1). A fixed-step tracer is about as fast but has no error control.

### Gonzalez-Vega et al. 2025 (DOCUMENTED, arXiv:2503.08924 §1-3)

- **Cutcurve:** for a ring torus T (centred, axis z) and an irreducible quadric Q, project T ∩ Q to z = 0 with the resultant `Sres0(x,y) = Res_z(T,Q)`, of total degree ≤ 8.
- **Lifting:** use the first subresultant, `z = −sres1,0/sres1,1` wherever sres1 ≠ 0.
- **Theorem 3.17:** every multiple component of T ∩ Q is a parallel or a meridian circle.
- Also: real algebraic curves on a ring torus have even degree. The paper characterizes singularities of the intersection and of its projection without assuming generic position.

### Kim, Kim & Oh 1998 (abstract only; DOCUMENTED via the archived CiteSeerX page above)

- The paper claims "an efficient and robust geometric algorithm that classifies and detects all possible types of torus/sphere intersections, including all degenerate conic sections (circles) and singular intersections".
- Method: treat one surface as an obstacle and the other as the envelope of a moving ball.
  - The configuration-space obstacle is the constant-radius offset of the obstacle, with the ball radius as the offset.
  - Intersecting that C-space obstacle with the trajectory of the ball's centre detects "all the intersection loops and singular contact point/circle".
- Output: "exactly one starting point (for numerical curve tracing) on each connected component".
- "All required computations involve vector/distance computations and circle/circle intersections."
- So it is a topology-plus-seed method with numerical tracing afterwards, not a closed-form curve (INFERRED from the abstract).

### Derived for wonky: meridian-plane chart for torus/sphere and plane/torus (INFERRED derivation, numerically checked 2026-09-24)

This derivation is mine, not from the papers above. It is in the spirit of Kim/Kim/Oh's "only circle/circle intersections". It gives a closed-form topology decision and a one-square-root chart for the two torus pairs that are not quartic per slice.

**Key fact.** On a ring torus (R0 > r0), every point lies on the meridian circle of its own azimuth θ: the circle with centre R0·e(θ) and radius r0, in the half-plane spanned by e(θ) and the axis A0. Hence T ∩ S is the union over θ of (meridian circle θ) ∩ S, and this is a planar problem for every θ.

**Torus/sphere.**
- Setup: `V = P1 − P0`, `b = V·A0`, and `s = |V − b A0|` (the distance of the sphere centre from the torus axis). Measure θ from the direction of V − bA0, and let `c = cos θ`.
- In the meridian half-plane with coordinates (ρ, z):
  - the meridian circle has centre (R0, 0) and radius r0;
  - the sphere section has centre (s c, b) and `ρs² = R1² − s² sin²θ`.
- `d² − ρs² = |V|² + R0² − R1² − 2R0 s c` is **linear in c**. Hence the circle/circle condition `K = 4r0²ρs² − (d² − r0² − ρs²)² ≥ 0` becomes a **quadratic in c**:

  `K(c) = −4s²(R0² − r0²) c² + 4αR0 s c + 4r0²(R1² − s²) − α²`, with `α = |V|² + R0² − R1² − r0²`.

- The two intersection points per θ are the standard circle/circle points: one √K, uniform F32x2 work.
- **Topology (s > 0).** The leading coefficient is negative, so {K ≥ 0} is a single c-interval. The signs of `K(±1) = (2r0R1)² − (α ∓ 2R0 s)²` and the vertex `c* = αR0 / (2s(R0² − r0²))` decide everything:

  | K(1) | K(−1) | other condition | topology |
  |---|---|---|---|
  | > 0 | > 0 | | two closed curves winding once around the axis |
  | > 0 | < 0 | | one loop around θ = 0 |
  | < 0 | > 0 | | one loop around θ = π |
  | < 0 | < 0 | max K > 0 and \|c*\| < 1 | two mirror-image loops |
  | < 0 | < 0 | otherwise | empty |

- **Degenerate cases:**
  - A zero of K(±1), or a double root of K, is a singular contact where loops or branches touch. It is a named degenerate case, to be decided exactly.
  - s = 0 (centre on the axis) makes K constant: two profile circles, one tangent circle, or empty. This is Li/Zhang/Ye case (a).
  - d = 0 with ρs = r0 at some θ means the meridian circle lies on the sphere: cross-sectional circle cases (b)/(c). K = 0 there but the chart is undefined, so test this before charting.
  - Villarceau circles (cases (d)/(e)) are not meridian circles. The chart traces them as ordinary components, so recognizing them as exact circles needs a separate exact test.
- **Exactness.** s is a square root of `|V|² − b²`, so exact predicates are signs of `A + B·√S`. That is Shao & Chen's Lemma 3.8 rule: four signs, multi-limb U32 friendly.

**Plane/torus, the spiric sections that recovery refuses today.**
- Setup: the plane is `N·(p − P0) = e`, with unit `N = m e⊥ + nz A0`, m ≥ 0, and θ measured from e⊥.
- In the meridian half-plane the plane is the line `m c ρ + nz z = e`. It meets the meridian circle iff

  `Kp(c) = −m²(R0² − r0²) c² + 2R0 m e c + r0² nz² − e² ≥ 0`.

  This is the same concave-quadratic structure, so the same case table applies.
- **Checks:**
  - m = 0 (plane ⊥ axis) makes Kp constant: two circles R0 ± √(r0² − e²). That is the case already supported.
  - A plane containing the axis degenerates the line at θ = ±π/2, giving the meridian circles. That case is also supported.
  - A plane parallel to the axis at distance e has roots `c = e/(R0 ± r0)`, which gives the classic spiric sequence:

    | distance e | section |
    |---|---|
    | 0 < e < R0 − r0 | two ovals |
    | e = R0 − r0 | crossing point at the inner equator |
    | R0 − r0 < e < R0 + r0 | one loop |
    | e = R0 + r0 | tangent point |

**Numerical check.**
- Scripts: `tmp/research/li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec/torus-{sphere,plane}-meridian-check.mjs`.
- Method: 320,000 random (torus, sphere or plane, θ) samples each.
- Results:
  - the sign of K (Kp) agrees with direct circle/circle (circle/line) existence in every sample with |K| > 1e-9;
  - the constructed points satisfy both implicit equations to 3e-14 (sphere) and 8e-15 (plane).
- This is not a proof. The algebra is short and should be re-checked with a CAS before porting.

**Limits:**
- Horn and spindle tori (R0 ≤ r0) break the key fact. The meridian circle then crosses the axis into the opposite half-plane, and for R0 = r0 the leading coefficient vanishes. The fillet decisions of 2026-09-24 mention horn-torus probes, so handle those separately.
- Oblique torus/cylinder and torus/cone do not reduce. A cylinder cuts a meridian plane in a conic, so circle ∩ conic stays quartic per θ, as in the §2.1 generator chart.
- The exception is a cylinder whose axis is parallel to the torus axis. It cuts each meridian plane in lines parallel to the axis, so it is two nested quadratics per θ; this is Li/Zhang/Ye eqs. 2.6-2.9 in another chart.

## Robustness and guarantees

- **Li/Zhang/Ye claim "efficient and robust" with no evidence (DOCUMENTED by absence).** There are no timings, no error analysis and no tolerance model beyond Δθ and a merge threshold ε.
- **Circle tests are float equalities.** They are stated as exact equalities (|P0Q| = R0, R1 = r0, (A0·A1)² = 1 − r0²/R0²) with no tolerance semantics.
- **Sampling misses features (INFERRED from the method).** A fixed Δθ lattice can miss small loops and mis-connect branches near tangencies and branch points. Liu 2011 states this as the known weakness of lattice methods: it is "difficult to find out the intersection curves of all small loops and singular points" (DOCUMENTED, Liu 2011 §1).
- **Ferrari is ill-conditioned (INFERRED, standard numerical analysis).** In floating point, Ferrari's formula near multiple roots gives errors of order √ε for double roots.
- **Liu 2011 gives the right structure but heuristic numerics.** Topology via characteristic points is the correct structure. However, the solver is interval-based but not certified end-to-end, degenerate cases are handled by perturbation, and the output precision uses an empirical 22% fudge factor.
- **Gonzalez-Vega 2025 is exact symbolic theory** (resultants and subresultants), not a certified numeric algorithm.

## Parallelism and performance

- Li/Zhang/Ye: no numbers.
- Liu 2011: 0.17-14 ms per torus pair depending on ε (DOCUMENTED, Tab. 1).
- **Structure (INFERRED):**
  - The generator-line chart is ideal *uniform* work: each θ sample solves one quartic with the same code path, so it fits a Bend GPU call tree if the quartic solver has fixed iteration counts (e.g. Sturm or Descartes bisection to a fixed depth in F32x2, or fixed-count Newton polishing).
  - Topology (characteristic points, branch wiring) is branchy, per-pair scalar work, so it belongs on the CPU with fork-join across face pairs.
  - The meridian-plane chart for torus/sphere and plane/torus is cheaper still. Each θ costs one circle/circle or circle/line solve with a single square root, with no iteration, so it maps to fixed-cost, uniform GPU work. Its topology stage is a constant number of exact sign tests per pair.

## Known failures, limitations, war stories

- Circle-case detection covers only specific configurations. For example, a Villarceau circle on a cone needs an extra tanβ condition, and oblique planes are not treated.
- Plane/torus spiric sections (degree 4) are not covered at all.
- The paper's own figures (Fig. 2-3) show "irregular" self-crossing curves, where the heuristic merge rule (3) is used. That is exactly the case where heuristic sorting fails.
- Liu 2011 needs perturbation for vanishing derivatives (§3.4) and an empirical precision factor (§3).
- The full texts of Kim 1998 and Kim 2012 could not be read (paywall or Cloudflare; retried 2026-09-24 with curl, headless Chrome, CiteSeerX, Wayback and Semantic Scholar).
  - Kim 1998 is known from its archived abstract.
  - Kim 2012 is known only from a search summary.

## Relevance for wonky

- **Current state** (`docs/proto-recover.md`, 2026-09-22):
  - Recovery supports torus carriers with plane ⊥ axis (two circles R ± √(r² − h²) or the tangent circle), plane through axis (meridian) and coaxial torus/cylinder (circle).
  - It **refuses** spiric plane/torus sections and non-coaxial pairs (`x-torus-tilted`: "unresolved: spiric section (quartic)").
  - "When a pair meets in two candidate circles, the mesh seed picks one."
  - Since 2026-09-24, torus and sphere are production face types coupled to the hybrid Boolean (`docs/entscheidungen.md` item 2). Torus/sphere and plane/torus are now in scope, not future work.
- **Most direct fix: the meridian-plane chart above.**
  - For the spiric refusal (`x-torus-tilted`) and for torus/sphere, the topology follows from the signs of a quadratic in cos θ: K(±1), vertex and discriminant.
  - The curve is a closed-form chart θ ↦ two points with one square root each.
  - Recovery can certify a mesh run against that chart exactly as it certifies circles today: every boundary vertex within τ of the chart point at its own azimuth.
  - STEP still needs a B-spline approximation with a stated bound, since spiric and torus/sphere curves are not STEP analytic curves.
- **Circle-case list to add** as exact predicates, each a named case that yields an exact circle:
  - torus/sphere with the centre on the axis (two profile circles; this pair is missing from the recover table);
  - torus/cylinder and torus/cone meridian-circle cases (b);
  - Villarceau cases (c)-(e);
  - Liu's torus/torus minor/minor and minor/profile coincidences.
- **All the tests are polynomial identities** in the input data if axis vectors are not normalized, e.g. `R0²(A0·A1)² = (R0² − r0²)|A0|²|A1|²`. With F32x2 (dyadic, about 48-bit) inputs they are exactly decidable on multi-limb U32 (INFERRED: degree ≤ 6, so about 300 bits, about 10 limbs).
  - Exact equality is the correct semantics for "is this configuration special". FDM-typical designs create these configurations deliberately (a fillet ring meeting a pin, an O-ring groove), not by accident.
- **General case: store a procedural curve, not samples.** The generator-line chart gives a natural procedural curve representation for torus/cylinder and torus/cone: "the k-th root of quartic(θ) on the generator at θ", for θ in given intervals. For torus/sphere the chart is z → x±(z), y±(z).
  - Evaluation is uniform F32x2 work.
  - Topology must come from certified characteristic points (turning and singular points of the pre-image, à la Liu 2011, or of the cutcurve, à la Gonzalez-Vega), not from a Δθ lattice.
  - Without certified characteristic points, refuse the pair by name (wonky rule), as `recover` already does.
- **Precision note (INFERRED):** quartic coefficients involve 4th powers of coordinates. F32x2 (48-bit mantissa) is ample for mm-scale parts away from tangency. At double roots the error grows to about √ε_rel × scale ≈ 6e-8 × 1000 mm = 6e-5 mm, still below FDM resolution. Topology decisions at such points must nevertheless be exact or refused.
- **Tori are outside the quadric pencil theory**, so [dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md](dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md) and [shao-chen-2024-topologically-correct-intersection-curves-of-.md](shao-chen-2024-topologically-correct-intersection-curves-of-.md) do not apply. The torus/quadric intersection has degree ≤ 8 (Bézout; DOCUMENTED as "at most 8" in Gonzalez-Vega 2025 §3). In general it is not rational. No general single-radical parameterization theory comparable to DLLP exists for it (INFERRED; none of the sources gives one).

## Pointers worth porting or studying

- Li/Zhang/Ye:
  - §2.1 LCS construction and the quartic coefficients (re-derived above; verify with a CAS before use).
  - §2.1-2.2 circle cases (b)/(c) and the cone variants.
  - §4 torus/sphere quadratic-in-x parameterization and circle cases (a)-(e).
- Liu 2011:
  - §2.2 characteristic point taxonomy and discriminant classification.
  - Theorem 1 (one-valued segments).
  - §2.3 wiring rules by root-count change.
  - §4 circle pre-detection.
  - Tab. 1 test configurations, as fixtures.
- Gonzalez-Vega 2025: §2.1 cutcurve plus subresultant lifting (Prop. 2.3, 2.5), Theorem 3.17 (multiple components are only parallel or meridian circles), §5 examples, as a torus/quadric regression corpus.
- This note's meridian-plane derivation: `K(c)` for torus/sphere, `Kp(c)` for plane/torus, the case table, and the two check scripts. Port only after a CAS re-derivation.
- Still to fetch through a library or a signed-in browser:
  - Kim 2012, the complete torus/torus circle catalogue;
  - Kim/Kim/Oh 1998, the configuration-space torus/sphere algorithm. Compare its case list with the K(c) table above.

## Verdict: learn-from

- Use the circle-case catalogue as exact, named special cases in the carrier-pair table.
- For the curve representation:
  - torus/sphere and plane/torus: the meridian-plane chart (one square root, topology from a quadratic in cos θ);
  - oblique torus/cylinder and torus/cone: the generator-line chart (a quartic per generator).
- Take the topology method for the quartic pairs from Liu 2011 or Gonzalez-Vega 2025, with certified solving.
- Do not port the Δθ sampling, the heuristic root matching, or float Ferrari. They violate wonky's explicit-tolerance and explicit-failure rules.
