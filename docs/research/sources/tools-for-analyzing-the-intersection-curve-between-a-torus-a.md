# Gonzalez-Vega, Caravantes, Diaz-Toca, Fioravanti 2025: "Tools for analyzing the intersection curve between a torus and a quadric through projection and lifting" (arXiv 2503.08924, CAGD 2026), with the quadric/quadric predecessor (Trocado and Gonzalez-Vega, arXiv 1903.06983, JCAM 2021)

- Kind: two papers. Both were read in full from arXiv.
  - Torus paper: https://arxiv.org/abs/2503.08924, v1 of 2025-03-11 (math.AG).
    - Published version: Computer Aided Geometric Design 126 (2026) 102533, doi:10.1016/j.cagd.2026.102533 (Crossref, issued 2026-04; PII S0167839626000269).
    - Author order differs: arXiv lists Gonzalez-Vega, Caravantes, Diaz-Toca, Fioravanti; the CAGD version lists Caravantes, Diaz-Toca, Fioravanti, Gonzalez-Vega (Crossref). Cite the CAGD order.
    - License: Crossref tags the *version of record* (content-version "vor", from 2026-03-12) as CC BY-NC 4.0, and OpenAlex reports `oa_status: hybrid`. So the journal version is open access (DOCUMENTED metadata).
    - The CAGD full text was **not** read: sciencedirect.com and the Elsevier text-mining API return Cloudflare HTTP 403 to non-browser clients (2026-09-24). arXiv still has only v1 (arXiv API, 2026-09-24), so possible corrections in the journal version are unverified.
    - Local: tmp/research/pdf/arxiv-2503.08924-torus-quadric.pdf and arxiv-2503.08924.txt.
  - Predecessor: A. Trocado and L. Gonzalez-Vega, "Computing the intersection of two quadrics through projection and lifting", https://arxiv.org/abs/1903.06983 (v2 of 2019-06-25, cs.CG).
    - Published as "Tools for analyzing the intersection curve between two quadrics through projection and lifting", J. Computational and Applied Mathematics 393 (2021) 113522, doi:10.1016/j.cam.2021.113522.
    - Local: tmp/research/pdf/arxiv-1903.06983-quadric-quadric.pdf and arxiv-1903.06983.txt.
- Authors/organization:
  - Laureano Gonzalez-Vega (CUNEF), Jorge Caravantes (Alcalá), Gema M. Diaz-Toca (Murcia), Mario Fioravanti (Cantabria).
  - 2019: Alexandre Trocado (Universidade Aberta) and Gonzalez-Vega (Cantabria).
  - Funding: Spanish grants PID2020-113192GB-I00 and MTM2017-88796-P.
- License:
  - arXiv default licence (non-exclusive distribution); the journal versions are Elsevier, the 2026 one possibly CC BY-NC.
  - No code is released. The 2019 paper reports a Maple implementation that was not published.
  - The mathematics can be reimplemented freely.
- Status:
  - New: 2025 preprint, 2026 journal.
  - arXiv v1 still contains an author comment in Spanish in a footnote ("creo que esto lo decimos nosotros en algún momento, pero por si acaso", §3 proof of Theorem 3.17), so it is a draft. Cite the CAGD version.
  - Another note covers this paper briefly as part of the torus literature: [li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec.md](li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec.md).

## What it is

- It is a set of exact algebraic *tools*, not a complete algorithm with complexity or timings. They analyze the real curve C_R = T ∩ Q, where:
  - T is a ring torus (0 < r < R) centered at the origin with axis z;
  - Q is a real irreducible quadric (not a double plane or a plane pair) with non-zero z² coefficient c.
- Method: project C_R to z = 0 (the "cutcurve"), describe it semialgebraically, characterize its singular points and those of C_R, and lift points back to 3D via the first subresultant (DOCUMENTED, abstract and §1).
- Unlike general space-curve topology algorithms, it does **not** assume generic or pseudo-generic position. The z-projection may be non-injective, which is typical for torus configurations (DOCUMENTED, introduction).
- The 2019 predecessor does the same for two quadrics, with a 6-step procedure and a Maple implementation benchmarked on 50 pairs, most of them from the QI server.

## How it works

### Torus/quadric (2025)

- Normal forms (DOCUMENTED, §1):
  - T(x,y,z) = z⁴ + p2·z² + p0, with p2 = 2(R² − r² + x² + y²) > 0 and p0 = ((R+r)² − x² − y²)·((R−r)² − x² − y²).
  - Q = z² + q1·z + q0, with q1 = e·x + f·y + i (linear) and q0 = a·x² + b·y² + d·xy + g·x + h·y + j.
- Resultant (eq. 3):
  - S̃0(x,y) = Res_z(T, Q) = (q0·q1² + p2·q0 − q0² − p0)² + q1²·(q1² + p2 − 2q0)·(p0 − q0²).
  - Total degree ≤ 8. It factors as S̃0 = T(x,y,z1)·T(x,y,z2), where z1, z2 are the two roots of Q in z.
- Silhouettes: Δ_T = p0 (the discriminant of T in z is 4096·Δ_T·R⁴·(x² + y²)²) and Δ_Q = q1² − 4q0.
- **Theorem 2.1 (cutcurve):** Π_z(C_R) = { Ŝ0 = 0, Δ_T ≤ 0, Δ_Q ≥ 0 }, where Ŝ0 is the square-free part. The projection is a semialgebraic subset of the resultant curve, not all of it.
- **First subresultant (Lemma 2.4):** Sres1 = q1·(q1² + p2 − 2q0)·z + (q0·q1² + p2·q0 − q0² − p0).
  - Where sres1 ≠ 0 there is a unique real lift: z0 = −sres1,0/sres1 (Prop 2.3).
- **Proposition 2.5 and Lemma 2.6:** on real cutcurve points, p2 + q1² − 2q0 > 0. So sres1 = 0 exactly on the line q1 = 0, and sres1 ≡ 0 iff q1 ≡ 0, i.e. Q is symmetric in z.
  - This conic factor can be removed: S0 = Ŝ0 / gcd(Ŝ0, p2 + q1² − 2q0) (Def 2.7).
- Lifting rules:
  - q1 ≢ 0 and q1(x0, y0) ≠ 0: one lift, via the Prop 2.3 formula.
  - q1(x0, y0) = 0: two lifts, (x0, y0, ±√(−q0)).
  - q1 ≡ 0: all lifts are symmetric pairs ±√(−q0).
- **Proposition 2.8 / Corollary 2.9:** if q1 ≢ 0, gcd(q1, S0) = 1 and the cutcurve is one-dimensional, then the cutcurve equals the zero set of S0, up to isolated points. If deg q1 = 1 and q1 divides S0, add the part of the line q1 = 0 inside A_{T,Q} = {Δ_T ≤ 0, Δ_Q ≥ 0}.
- **Singularities (§3), summarized as a decision diagram in the paper:**
  - Theorem 3.8: a singular point of C_R with z0 ≠ 0 projects to a singular point of S0.
  - Prop 3.4: a cone vertex lying on the torus is a singular point of C_R.
  - q1 ≡ 0:
    - Prop 3.9: a singular cutcurve point off Δ_T lifts to two singular points.
    - Theorem 3.12: (x0, y0, 0) is singular iff Δ_Q and S0 meet non-transversally there and Δ_Q is not a component of S0.
  - q1 ≢ 0:
    - Prop 3.10 / Cor 3.11: a cutcurve point never lifts to two singular points.
    - Prop 3.13: points on Δ_T with q1 ≠ 0 are regular.
    - Theorem 3.14: (x0, y0, 0) has Jacobian rank 1 iff Δ_T and Δ_Q meet non-transversally at (x0, y0). The explicit determinant is eq. 7.
    - Cor 3.18 and Remark 3.19 separate "two regular lifts" from "one singular plus one regular lift" by the multiplicity of the cutcurve point.
  - **Theorem 3.17:** a multiple component of T ∩ Q, i.e. tangency along a whole curve, is only ever a *parallel* or *meridian* circle. It is never a Villarceau circle and never an irreducible quartic. The proof uses the Bottema-Primrose classification of curves on the torus.
  - Prop 3.15: if q1² divides S̃0 with f = k·q1, then q1(0,0) = 0 and the segment of the line q1 = 0 in A_{T,Q} is the projection of a meridian circle.
- **Computational identities (§4):**
  - Lemma 4.1: S̃0 = Q1·Δ_T + Q2·Δ_Q + q0²·(p2 + q0)².
    - Q1 = p0 − 2p2·q0 + p2·q1² + 2q0² − 4q0·q1² + q1⁴ and Q2 = p2·q0².
    - I checked the remainder term against eq. (3) at Δ_T = Δ_Q = 0.
  - Lemma 4.2: S̃0 = R1·q1² + R2·q0 + p0².
    - R1 = p0·(p2 − 4q0 + q1²) + p2·q0² and R2 = (q0 − p2)·(2p0 − p2·q0 + q0²).
    - The PDF text extraction garbles the last term. p0² follows from eq. (3) at q0 = q1 = 0 (INFERRED check).
  - Prop 4.3: {S̃0 = Δ_T = Δ_Q = 0} ⟺ {q1 = q0 = p0 = 0}.
  - Prop 4.6: cutcurve ∩ Δ_T ⟺ {q0 = 0, Δ_T = 0}. This is a conic against two concentric circles.
  - Prop 4.7: cutcurve ∩ Δ_Q ⟺ {16·p0 + 4·p2·q1² + q1⁴ = 0, Δ_Q = 0}. This is a quartic against a conic.
  - If q1(x0, y0) = 0 on the cutcurve, x0 is a root of an explicit univariate quartic (§4.1).
  - The homogeneous parts of S̃0 are given explicitly. The degree-8 part is the square of a quartic, and R and r first appear in the degree-6 part.
- **Closed form (§4.3):** for the torus against an origin-centered, axis-aligned ellipsoid x²/A + y²/B + z²/C = 1:
  - S̃0 = S0², and S0 is a conic in X = x², Y = y². It is a parabola if A ≠ B and two parallel lines if A = B.
  - This gives a piecewise, non-rational parameterization via (±√X, ±√Y).
- 14 worked examples (§5) cover:
  - coaxial sphere: two parallel circles;
  - coaxial cone tangent along a parallel;
  - one-sheet hyperboloid with singular points at z = 0;
  - ellipsoids with singular cutcurve points that lift to regular pairs;
  - sphere giving two Villarceau circles (Ex 5.6);
  - elliptic cylinder containing a meridian circle (Ex 5.8);
  - cylinder tangent along a meridian (Ex 5.9);
  - two-sheet hyperboloid with an isolated point (Ex 5.10);
  - cones through special points (Ex 5.11, 5.14).
  - Each example states which theorem it exercises.

### Quadric/quadric predecessor (2019)

- With f = z² + p1·z + p0 and g = z² + q1·z + q0:
  - S0 = Res_z = (p0 − q0)² − (p1 − q1)·(p0·q1 − q0·p1), degree ≤ 4.
  - Sres1 = g − f = (q1 − p1)·z + (q0 − p0), so z = (p0 − q0)/(q1 − p1) (Theorem 5.13).
- Theorem 4.1: cutcurve = {S0 = 0, Δ_E1 ≥ 0, Δ_E2 ≥ 0}. The region is bounded by conic arcs.
- Lemma 5.6: 16·S0 = (p1 − q1)⁴ + (Δ_E1 − Δ_E2)² − 2·(p1 − q1)²·(Δ_E1 + Δ_E2).
- Singular cutcurve points come from two sources:
  - Theorem 5.3 and Cor 5.7: points on the line p1 = q1. They also lie on the conic p0 = q0 and are found by intersecting Δ_E1 − Δ_E2 = 0 with that line, i.e. one quadratic.
  - Theorem 5.4 and Cor 5.5: projections of tangential intersection points (common tangent plane). They are found via subresultants of S0 with ∂S0/∂x and ∂S0/∂y (Theorem 5.10, polynomial Ω).
- Prop 5.11: cutcurve ∩ silhouette ⟺ 2·(p0 + q0) = p1·q1 together with Δ_Ei = 0, a conic/conic system. Cor 5.12: cutcurve and silhouettes do not meet off the line p1 = q1.
- Procedure (§6):
  1. Compute S0.
  2. Compute the region A_{E1,E2}.
  3. Singular points on p1 = q1: three quadratic equations; lift via f or g.
  4. Singular points off the line: via Theorem 5.10; lift via S1.
  5. Regular points on the silhouettes: via Prop 5.11. These are the branch endpoints.
  6. Branches: closed forms with radicals, or discretize by solving the quartic S0(α, y) = 0 at sample α values and lifting with S1.
- The authors say it "is not intended to classify the intersection curve"; the goal is a topologically correct description (DOCUMENTED, §7).

## Robustness and guarantees

- The theorems are exact statements over R. Correct results require:
  - exact arithmetic for resultants, subresultants, gcds and square-free parts;
  - certified root isolation for event points.
- The papers do not discuss floating point.
- Degenerate inputs are *included* (tangency along circles, isolated points, non-injective projection) and handled by the case diagram, not by perturbation (DOCUMENTED).
- Hypotheses to respect (DOCUMENTED):
  - The torus is centered at the origin with axis z.
  - The quadric is irreducible.
  - c ≠ 0, i.e. Q has a z² term. In §1 this is normalized to c = 1; in §4 c ≠ 0 is stated.
  - In 2019 both quadrics are monic in z²; the authors say "the general case is very easy to derive".
- The 2019 discretization lifts sampled points from numeric roots of S0(α, y). The topology is correct because all event points are computed first; the branch points are approximate samples.

## Parallelism and performance

- The 2025 paper has no implementation and no timings (DOCUMENTED absence).
- 2019 Maple implementation, 50 examples, Table 1 (DOCUMENTED; time unit not stated, presumably seconds):
  - Undiscretized cases take 0.14-1.2.
  - Discretized cases take 0.4-6.5 with 40-1894 lifted points.
  - The slowest are Examples 48-49: 5.8 and 6.5 with about 1600-1900 points, with tangential intersections.
- Cost structure (INFERRED):
  - Per pair, the work is a constant number of symbolic eliminations of bounded degree: 8 for torus/quadric, 4 for quadric/quadric.
  - The expensive, input-dependent part is finding singular points off the special line, i.e. the bivariate system S0 = ∂xS0 = ∂yS0 = 0 via subresultants. With degree 8 that means univariate resultants of degree up to about 56.
  - The event points on special loci are cheap: univariate quartics or conic/circle systems.

## Known failures, limitations, war stories

- Requires a rigid motion into the torus frame (INFERRED issue for exact arithmetic):
  - For a torus whose axis is not a coordinate axis, an orthonormal rotation introduces √|n|².
  - Workaround: use an orthogonal but *non-normalized* rational basis {n, e1 = n × k, e2 = n × e1}. In it, |p − c|² = |n|²w² + |e1|²u² + |e2|²v², and T stays even in w. The torus equation then has the same z⁴ + p2·z² + p0 shape with anisotropic (u, v) coefficients.
  - The paper's statements that use the explicit circle form of p0 and p2 would need re-checking under that scaling. Positivity of p2 is preserved (INFERRED).
- Excluded inputs:
  - Planes (reducible quadrics, so plane/torus is not covered; it is classical, see OCCT IntAna and the Li-Zhang-Ye note).
  - Quadrics without a z² term, i.e. c = 0. Example: a cylinder parallel to the torus axis, (x − a)² + (y − b)² = ρ².
  - In that case the intersection lies over a circle in the xy-plane and each point lifts through the biquadratic T(x, y, z) = 0. It is easy but must be a separate branch (INFERRED).
  - Such "vertical" configurations are common in CAD, e.g. a hole through a filleted flange ring, so wonky needs the special case.
  - Closed form for the vertical cylinder (INFERRED, derived here and not in the paper):
    - Write the torus as (ρ² + z² + R² − r²)² = 4R²ρ² with ρ² = x² + y². Then z² = r² − (ρ − R)². The other root, r² − (ρ + R)², is negative for a ring torus. For a spindle torus (r > R) it can be positive, but it belongs to the inner sheet that wonky's `Torus` excludes, so the same formula holds for wonky.
    - On a cylinder at axis distance d from the torus axis with radius ρc, ρ(θ)² = d² + ρc² + 2ρc·d·cos(θ − φ). The curve is z = ±√(r² − (ρ(θ) − R)²).
    - Real points need |ρ(θ) − R| ≤ r. The branch endpoints (z = 0) solve ρ(θ)² = (R ± r)². Each is a condition cos(θ − φ) = const, so there are at most two roots per sign, in closed form.
    - Topology:
      - Each θ-interval where the condition holds carries one closed loop: the upper and lower branches join at the z = 0 endpoints.
      - If the condition holds on the whole circle, the upper and lower branches are two separate loops.
      - When the maximum or minimum of ρ(θ), i.e. d ± ρc, equals R ± r exactly, the curve has a tangency. That is a singular point at z = 0, and a vertex must go there.
    - All decisions compare d ± ρc with R ± r, or solve linear conditions in (cos θ, sin θ). With dyadic inputs they are exact in multi-limb integers after squaring.
- No algorithm is given for *connecting* branches. The paper gives event points and lifting rules; ordering branches between events (a CAD-style sweep) is left to the user (DOCUMENTED by absence).
- The draft state of v1 (Spanish footnote, "Figure 6.2 y 6.9 en la versión que yo tengo") suggests checking the CAGD version for corrected statements.

## Relevance for wonky

- **Where tori come from:** constant-radius fillets along circular edges (plane/cylinder fillets are torus patches) and revolves of arcs. So Booleans of filleted FDM parts need torus/plane, torus/cylinder, torus/cone and torus/torus.
- **wonky status (working tree, 2026-09-24; this supersedes the earlier "no torus yet"):**
  - `kernel/analytic.bend` now has `Sphere{origin, axis, x, radius}` and `Torus{origin, axis, x, major, minor}` surfaces. A spindle torus keeps only the sheet on the tube-centre side, which is all that revolve builds. The file was modified 2026-09-24 and is uncommitted.
  - The hybrid recover stage (`kernel/hybrid/recover/geom.bend`) handles only two torus pairs:
    - `plane_torus`: axis-perpendicular planes give circles; planes through the axis give meridian circles. Every other plane is refused as a "spiric curve (quartic; curve type missing)".
    - `torus_cyl`: coaxial cylinders give circles. Off-axis cylinders are refused as a "space curve (curve type missing)".
    - Torus/cone, torus/sphere and torus/torus fall through to "no analytic curve implemented".
  - docs/fillet.md lists torus and sphere in production as a prerequisite for most fillets. Edge fillets at holes and bosses are torus patches.
- **Which wonky cases the paper covers** (INFERRED from its hypothesis c ≠ 0, where c is the z² coefficient of Q in the torus frame):
  - For a cylinder with unit axis direction v, c = 1 − v_z². So c = 0 **exactly when the cylinder is parallel to the torus axis**, e.g. a vertical hole drilled through a filleted flange ring. That is the most common FDM case, and the paper excludes it. It needs the separate "circle in xy, biquadratic lift" branch described above.
  - Skew and perpendicular cylinders (c > 0) are covered. Work with c as a factor instead of normalizing c = 1, so no division is needed in exact arithmetic.
  - For a cone with half-angle θ, c = v_z² − cos²θ (up to sign). So c = 0 exactly when one generator is parallel to the torus axis; those cones are excluded.
  - A sphere has c = 1 and is covered, including the Villarceau example.
  - Planes are not quadrics here. Plane/torus (the spiric section) is simpler anyway: substitute the plane into T to get a plane quartic with a unique lift.
  - This paper matters as soon as the fillet work produces tori that meet non-coaxial features.
- **What it supplies:** certified *event points* for a torus/quadric curve before tracing:
  - singular points (crunode, acnode, cusp);
  - points where the lift count changes (silhouette contacts Δ_T and Δ_Q);
  - points where the projection is 2:1 (the q1 = 0 line);
  - whole-circle tangencies (Theorem 3.17 limits them to parallels and meridians, which are both exact circles).
  - This is exactly what a Parasolid-style chart needs: terminators and branch structure. See [parasolid-xt-format-reference-v35-intersection-curve-chart-t.md](parasolid-xt-format-reference-v35-intersection-curve-chart-t.md).
  - wonky could store each branch as an exact procedural curve: the implicit pair plus a lifting rule, e.g. z = −sres1,0/sres1 over the projected branch, with F32x2 chart points and exact endpoints.
- **Hybrid Boolean:**
  - The mesh Boolean proposes loops. The cutcurve analysis certifies the number of branches, the singular points to snap to, and whether a loop hides a doubled circle (tangency).
  - A doubled circle must be emitted as one exact circle edge with explicit tangency, never as two nearly coincident mesh loops (INFERRED).
- **Bend fit** (INFERRED):
  - S̃0, sres1, sres1,0, Δ_T, Δ_Q and the Prop 4.6/4.7 systems are explicit closed-form polynomial expressions. They can be computed with exact bivariate polynomial arithmetic over multi-limb U32 integers from dyadic inputs: pure functions, no mutation.
  - Evaluating S̃0 or the lift on a batch of sample points is uniform work and GPU-friendly.
  - Root isolation and the degree-≈56 singular-point elimination are irregular. Run them on CPU fork-join, per pair.
  - A cheaper certified alternative for singular points off q1 = 0 is interval Newton on the 2x2 system in F32x2 (or multi-limb) intervals, seeded by the mesh, with exact confirmation or an explicit `Unresolved` when no unique root is proven.
- **Quadric/quadric (2019):** the lifting formula z = (p0 − q0)/(q1 − p1) and Lemma 5.6 give wonky a cheap *certified lift and event locator* for cylinder/cone pairs. It complements DLLP-style parameterization. The special-line singular points need only quadratics (INFERRED usefulness).
- **LLM ergonomics and testing:** the 14 torus examples and the 50 quadric pairs (2019 Annex, mostly from the QI server) are a ready regression corpus with known topology.

## Pointers worth porting or studying

- 2025, eq. (3): the closed-form resultant. Lemma 2.4: sres1 and sres1,0. Prop 2.5: the lift-count rule.
- 2025, Theorem 2.1 and Def 2.7: the semialgebraic cutcurve.
- 2025, §3 decision diagram (page 7 of the arXiv PDF): the singularity case table, directly usable as a classifier skeleton.
- 2025, Theorem 3.17: the only possible tangency curves are parallels and meridians. Use it as a snap rule and as an assertion.
- 2025, Props 4.3, 4.6, 4.7: low-degree subsystems for the silhouette events.
- 2025, §4.3: closed form for the coaxial ellipsoid/sphere family.
- 2025, §5: 14 examples as fixtures. Coefficients are given, with rational R and r.
- 2019, Lemma 5.6, Theorems 5.3, 5.4 and 5.10, Prop 5.11, the §6 procedure, and the Table 1 and Annex data.

## Verdict: learn-from

- These are correct, exact and compact tools. They give the certified event structure that torus SSI needs before tracing, and they suit exact multi-limb arithmetic.
- It is not a complete algorithm: no branch connection, no implementation, no timings. It requires the torus frame and excludes planes and c = 0 quadrics, and c = 0 includes wonky's most common case (a hole parallel to the torus axis).
- wonky now has a torus surface type, but its recover stage refuses every non-coaxial torus pair. When torus/quadric SSI is built, adapt the lifting formulas, the singularity diagram and the Theorem 3.17 tangency rule. Add the special cases for c = 0 and for planes (spiric sections).
