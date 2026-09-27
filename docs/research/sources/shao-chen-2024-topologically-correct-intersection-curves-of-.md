# Shao & Chen 2024: Topologically correct intersection curves of two trimmed quadrics with tolerance control

- Kind: journal paper. Journal of Systems Science and Complexity 37(5):2207-2239, October 2024 (online 2024-08-30). DOI https://doi.org/10.1007/s11424-024-2519-3
  - Springer page: https://link.springer.com/article/10.1007/s11424-024-2519-3. It blocks curl with a JS challenge; Crossref, Semantic Scholar and Unpaywall list it as closed.
  - The full text was obtained in an earlier session and read in full for this note: `tmp/research/pdf/shao-chen-2024-trimmed-quadrics.pdf/.txt` (33 pages).
- Authors/org: SHAO Wenbing and CHEN Falai (corresponding), Department of Mathematics, University of Science and Technology of China, Hefei. Received 2022-12-30, revised 2023-04-11. Funded by NSFC grant 61972368.
- License: Springer/JSSC copyright. The method is freely re-implementable (INFERRED). No code, no implementation language and no repository are mentioned.
- Status: new, low visibility. Crossref shows 0 citations and 59 references (checked 2026-09-24).
  - The same authors have a companion classification paper: Shao & Chen, "Topological classification of the intersection curves of two quadrics using a set of discriminants", CAGD 2023, https://doi.org/10.1016/j.cagd.2023.102244 (Crossref: 1 citation). No OA copy per Unpaywall, no arXiv version found (2026-09-24). Not read.
  - Both papers are cited in the Li/Yang/Jia 2026 SSI survey.

## What it is

An algorithm for the intersection curve segments of two **trimmed** quadrics, i.e. quadrics restricted by a conjunction of half-spaces `a_i x + b_i y + c_i z + d_i ≤ 0`. Its output has two guarantees (DOCUMENTED, abstract):
- **Correct topology.**
- **Endpoint error below a user tolerance ε.**

It builds on the exact DLLP quadric intersection parameterization (see [dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md](dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md)) and the Tu/Wang/Mourrain signature-sequence classification (CAGD 2009, https://doi.org/10.1016/j.cagd.2008.08.004; local `tmp/research/pdf/hku-qsic-2009.pdf`). It closes the gap those leave open: trimming, points at infinity, and tolerance-controlled endpoints.

## How it works

### Setup (DOCUMENTED, §2.1)

- Quadrics are `X^T A X = 0` and `X^T B X = 0` with A, B real symmetric 4×4 and X = (x, y, z, 1).
- Pencil `λA − B`. Characteristic polynomial `f(λ) = det(λA − B)`.
- Trimmed quadrics TQ_A and TQ_B are each the quadric intersected with its own list of half-spaces, and are assumed bounded.

### Step 1: oriented bounding box per trimmed quadric (DOCUMENTED, §3.1, Lemma 3.1, Thm 3.3)

- **Box axes:** N_1, N_2, N_3 are orthonormal eigenvectors of the 3×3 block A_u.
- **Extents:** `t_min/max^i = min/max N_i·X` over TQ_A, solved through the KKT conditions. The candidates are the finitely many solutions of four system families, depending on how many trim planes are active:
  - (I^i) no active plane: `f = 0`, `∇f × N_i = 0`;
  - (I_j^i) one plane: `f = 0`, `n_j·X = d_j`, `(∇f × n_j)·N_i = 0`;
  - (I_jk^i) two planes: `f = 0` plus two planes, i.e. a line;
  - (I_jkl^i) three planes: a vertex.

  Each family reduces to one quadratic plus linear equations, so "exact solutions can be computed" (Remark 3.2).
- **Rejection:** if the two boxes are disjoint, stop (empty result).

### Step 2: classification (DOCUMENTED, §3 intro)

- Use the signature-sequence classification of Tu, Wang, Mourrain & Wang (refs [24, 39]).
- 12 of its cases have a non-planar intersection. Case 2 is empty. Case 7 is an isolated singular point: compute it and test the trims.

### Step 3: singular points (DOCUMENTED, §3.2)

- A repeated root λ0 of f(λ) gives the singular point via `λ0 ∇f = ∇g` (Prop. 3.4, from Chen/Xu/Wang 2009). Two repeated roots give two singular points.
- The case split is on `rank(λ0 A_u − B_u)`:
  - rank 3: a unique linear solution; check it against f = g = 0;
  - rank 2: a line of solutions, so two quadratics in t;
  - rank 1: conic/conic intersection, a quartic by resultant.
- The parameter value of a singular point (x0, y0, z0) on a branch P(t) is a root of `gcd(x(t) − x0 w(t), y(t) − y0 w(t), z(t) − z0 w(t))`.

### Step 4: parameterization (DOCUMENTED, §3.4, from DLLP)

- **Non-degenerate** (f has no repeated root): the curve is a smooth quartic with two sheets:

  `P±(t) = (x1 ± x2√Δ, y1 ± y2√Δ, z1 ± z2√Δ) / (w1 ± w2√Δ)`

  x1…w1 are cubics, x2…w2 are linear, and Δ is a square-free quartic.
  - P+ and P− meet at the real roots of Δ.
  - Δ has 4 or 0 real roots: two closed loops. Δ has 2 real roots: one loop (Fig. 5, citing Hemmer's thesis).
- **Degenerate with non-planar parts:** a rational curve `(x, y, z)/w` of degree ≤ 4.
- **Planar-only** (§3.5): some pencil member splits into two planes, found by congruence transformation. Plane ∩ quadric gives conics, which are handled the same way.

### Step 5: trimming as a univariate inequality system (DOCUMENTED, §3.3-3.4)

- **Constraints.** Substituting P±(t) into each trim plane gives:
  - `Δ(t) ≥ 0`
  - `(f_i ± g_i √Δ)(w1 ± w2 √Δ) ≤ 0`, with f_i = a_i x1 + b_i y1 + c_i z1 + d_i w1 (degree 3) and g_i the same combination of the linear parts (degree 1).

  The rational case needs only `f_i(t) w(t) ≤ 0`.
- **Solver (Problems 3.6 / 3.9):**
  1. Make every polynomial square-free (`f/gcd(f, f′)`) and pairwise coprime (divide out common gcds).
  2. **Root isolation** by Descartes' rule of signs with the Möbius map `g(x) = (x+1)^n f(1/(x+1))` and bisection (Collins-Akritas / Rouillier-Zimmermann, [53-55]) for every polynomial in Σ. For the radical case:

     `Σ = {Δ, w1, w2, w1² − w2²Δ} ∪ {f_i, g_i, f_i² − g_i²Δ}` (degrees ≤ 6).
  3. **Interval separation:** halve δ until isolating intervals of different polynomials do not overlap.
  4. **Sign verification:**
     - On root-free gaps, evaluate at a midpoint.
     - At an isolated root α of p, get sign q(α) from the Sturm-Habicht (signed subresultant) Cauchy index `S(p, q; a, b)` (Theorem 2.6).
     - Get the sign of `a + b√c` from the signs of a, b, c and `a² − b²c` (Lemma 3.8, Fig. 4 flowchart).
  5. Merge adjacent feasible intervals.
- **Unbounded intervals** are reparameterized with `t = ±s/(1−s)` on s ∈ [0,1]. Two tails (−∞, a] and [b, ∞) that meet at P(∞) are merged via `t = ((a+b)s − b)/(2s − 1)` (§3.4.3).

### Step 6: tolerance control (DOCUMENTED, §3.4.4)

- For an interval endpoint a known only to lie in an isolating interval of width δ: `‖P(a) − P(ã)‖ ≤ M δ`, where `M = max_I ‖P′(t)‖` is bounded by interval arithmetic.
- Choose `δ < ε/M`, then shrink each isolating interval until its own `M̃ δ ≤ ε`.
- The examples use ε = 1e-3 with M = 25 and M = 2, which give δ ≤ 4e-5 and 5e-4.

### Step 7: approximation for downstream use (DOCUMENTED, §3.4.5)

A non-rational branch can be approximated by a cubic spline within ε. This is deferred to the literature, ref [19], Patrikalakis-Maekawa.

### Worked examples (DOCUMENTED, §4)

- **4.1:** paraboloid ∩ cone, trimmed. A crunode (two loops at a node). Rational `P(t) = (2t³ + 6t, 4t², 2t³ − 6t)/(t⁴ + 9)`, with singular parameter t = 0 and t = ∞.
- **4.2:** cubic plus line through two rational singular points. The trim yields four cubic segments, two of which join at P(±∞), and one line segment `t ∈ [−265/29, 12731/653]`.
- **4.3:** a smooth quartic whose coefficients lie in Q(√166). Two loops, trimmed to one closed loop plus one open segment.
- **4.4:** disjoint boxes, so the result is empty.

## Robustness and guarantees

- **DOCUMENTED claims:** correct topology, and endpoint error ≤ ε.
- **What makes the topology exact:**
  - the exact classification (signature sequences);
  - the exact DLLP parameterization;
  - exact sign determination (Descartes isolation, gcds, Sturm-Habicht, the Lemma 3.8 radical sign rule).
- **The curve between endpoints is exact.** P(t) lies on both quadrics. The only approximation is where each segment starts and ends in t. That makes a clean contract: exact carrier curve, certified parameter interval (INFERRED from the construction).
- **Caveats (INFERRED from the text):**
  - **Exact arithmetic is assumed but never specified.** The paper states that algebraic methods "suffer from the robustness problem if ... implemented based on floating-point arithmetic" (§1). Example 4.3 shows the Σ polynomials have coefficients in Q(√166), so a real implementation needs arithmetic in Q(√δ), or squaring, or a sign-of-algebraic-number routine. No implementation, language or timing is reported (DOCUMENTED by absence: grep for time, implementation or Maple finds nothing).
  - **The box stage is floating unless done carefully.** Eigenvectors of A_u are generally irrational. If rounded boxes are too tight, a touching pair could be rejected, so the box must be made conservative (outward-rounded extents).
  - **Only half-space trimming.** Real B-rep faces are bounded by curved edges and can be non-convex with holes. A conjunction of half-spaces cannot describe a cylinder face trimmed by another cylinder or a face with a hole.
  - **Not covered:** coincident quadrics (A ∝ B), and tangency of the curve with a trim plane (only implicit, via square-free reduction).
  - **Classification dependency.** Topology correctness relies on the external classification being implemented exactly. The paper uses it, it does not re-prove it.

## Parallelism and performance

- No measurements (DOCUMENTED by absence).
- **Structure (INFERRED):**
  - Per candidate face pair the work is scalar and branchy: case dispatch, gcds, root isolation of polynomials of degree ≤ 6 (the squared terms `f_i² − g_i²Δ` and `w1² − w2²Δ` are the degree-6 ones), and Sturm-Habicht sign queries. That means fork-join over pairs on the CPU.
  - The uniform parts are evaluating P±(t) at many t (meshing, sampling, the M bound) and interval refinement per endpoint. Both are GPU-friendly.
- **Bigint cost (INFERRED):**
  - DLLP output heights are 22-38× the input height (QI paper).
  - Squaring for `f_i² − g_i²Δ` roughly doubles that again.
  - With about 48-bit F32x2 dyadic inputs (plus exponent alignment), coefficients reach several thousand bits (~100 U32 limbs) in the worst case. That is heavy but bounded.
  - A cheaper wonky variant: run the same pipeline with interval-F32x2 coefficients, and fall back to exact limbs, or refuse by name, whenever a sign is undecided.

## Known failures, limitations, war stories

- The paper is a method paper with four examples and no stress test, benchmark or comparison against OCCT/ACIS/QI.
- The spline approximation of non-rational branches is only referenced, not specified, so the end-to-end tolerance on a *stored approximating curve* is not covered.
- The unexplained Q(√166) coefficient polynomials in Example 4.3 (with a stray variable u) show how quickly the algebra becomes opaque. They are also a hint that implementation detail was left out.

## Relevance for wonky

- **It fills the exact gap `recover` names.** `docs/proto-recover.md` refuses "non-coaxial quadric pairs: pipe tee, Steinmetz, cross holes" and "three space quartics" in the corpus. Shao & Chen supply what is missing once the mesh has fixed the topology:
  - an exact curve for every cylinder/cylinder, cylinder/cone and cone/cone pair;
  - its segment structure (loops, sheets joined at roots of Δ, branches meeting at singular points);
  - certified parameter intervals for each edge.

  Recovery would then match each mesh run to one (sheet, t-interval) segment and verify the run lies within τ of it, the same certification `recover` already does for circles.
- **Trimming adaptation (INFERRED).** In `recover` the endpoints are vertices known approximately from the mesh and exactly as common points of three carriers. So the relevant step is §3.3 (isolate the roots of `plane_or_quadric_k(P(t))` near the mesh vertex and certify sign structure), not the half-space conjunction.
  - Substituting P(t) into a third quadric gives a polynomial in t and √Δ, so Problem 3.9 applies unchanged, with higher degree.
- **A clean interface for Bend (INFERRED):**
  - Exact stage: classify, parameterize and isolate on multi-limb U32. It runs once per pair and is pure and small.
  - Evaluation stage: F32x2 with the §3.4.4 bound `‖P(a) − P(ã)‖ ≤ Mδ`. That is exactly wonky's "approximation with explicit tolerance".
- **Singular points are exact and often rational** (Example 4.2: p1 = (248/47, 659/235, −9/5)). Tangent-cylinder and pipe-tee nodes then become exact vertices, which fixes the class of "degenerate tangent vertex" refusals.
  - **Worked on wonky's own refusal: the Steinmetz corners** (INFERRED, hand computation 2026-09-24, following §3.2 as printed). Recovery refuses `steinmetz-intersect` and `steinmetz-union` with "patches of only 2 distinct carriers meet" (`docs/bakeoff.md`).
    1. With `f = x² + y² − 1` and `g = x² + z² − 1`: `det(λA − B) = λ(λ − 1)²`. The repeated root is λ0 = 1.
    2. `λ0 A_u − B_u = diag(0, 1, −1)` has rank 2, so this is case 2). The linear system λ0∇f = ∇g reduces to y = 0, z = 0, i.e. the line (t, 0, 0).
    3. Substituting into f and g gives the common roots t = ±1. So the corners are exactly (±1, 0, 0), where the two cylinders are tangent (∇f ∥ ∇g).
    - That tangency is why recovery's three-carrier Newton has nothing to work with.
    - The same pencil member (y − z)(y + z) splits the curve into the two plane/cylinder ellipses recovery already supports. So Steinmetz needs this 10-line exact step, not a quartic curve type.
- **The generator chart is the cheap front end** (INFERRED; derivation and check script in [dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md](dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md)).
  - For cylinder or cone pairs, P±(t) is simply the ± root of one quadratic per generator of the input ruled surface, with Δ(φ) a quartic in tan(φ/2).
  - Shao & Chen's Problem 3.9 (sign conditions on polynomials in t and √Δ) then applies to that chart unchanged. The trim polynomials become `plane_k(x(φ, t±(φ)))`, i.e. `a + b√Δ` with a, b polynomial in u.
- **STEP export (INFERRED):** a quartic QSIC is not a STEP analytic curve. Export a certified B-spline approximation (with pcurves) as the SURFACE_CURVE geometry. Keep the exact parametric form internally for diff, provenance and re-evaluation.
- **Test fixtures:** Examples 4.1-4.3 have exact published answers. The [QI server](qi-quadric-intersection-library-loria-gamble.md) generates more. It was verified alive on 2026-09-23 and again on 2026-09-24 with sphere/cylinder and cone/cylinder probes.

## Pointers worth porting or studying

- Lemma 3.8 / Fig. 4: sign of `a + b√c` from four signs. Tiny, exact, and directly portable.
- §3.3: square-free/coprime preprocessing, then isolation, separation and verification. This is a generic certified univariate sign-condition solver, reusable for curve/face trimming and edge/face incidence.
- Theorem 2.6 (Sturm-Habicht sign at an isolated root). §2.2 Descartes with the Möbius transform.
- §3.2: rank-based singular point computation from the repeated pencil root.
- §3.4.3: reparameterization of unbounded tails and merging at P(∞).
- §3.4.4: the endpoint error bound. §3.1 KKT box, as a template for exact extents of trimmed analytic faces.

## Verdict: adapt

This is the best-matching recipe found so far for wonky's quadric FF stage. It gives exact curves, exact topology, explicit endpoint tolerance, and explicit case names. Adapt it as follows:
- keep the exact core (classification, DLLP parameterization, certified univariate sign solving, Lemma 3.8);
- replace half-space trimming with vertex/trim-surface isolation driven by the mesh topology;
- use interval F32x2 with exact-limb fallback;
- refuse by name whatever the exact stage cannot decide.

Needs its own implementation. There is no code to port.
