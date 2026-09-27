# Dupont, Lazard, Lazard & Petitjean 2008: Near-optimal parameterization of the intersection of quadrics (Parts I-III)

- Kind: three-part journal paper. Canonical DOIs, all in Journal of Symbolic Computation 43(3), March 2008:
  - Part I, "A general algorithm", pp. 168-191: https://doi.org/10.1016/j.jsc.2007.10.006
  - Part II, "A classification of pencils", pp. 192-215: https://doi.org/10.1016/j.jsc.2007.10.012
  - Part III, "Parameterizing singular intersections", pp. 216-232: https://doi.org/10.1016/j.jsc.2007.10.007
- Open copies (read in full):
  - HAL: https://inria.hal.science/inria-00186089 (I), https://inria.hal.science/inria-00186090 (II), https://inria.hal.science/inria-00186091 (III). They also appeared earlier as INRIA research reports RR-5667, RR-5668 and RR-5669 (2005).
  - Local copies: tmp/research/pdf/dupont2008-quadrics-{I,II,III}.pdf and .txt.
- Authors/org: Laurent Dupont (Nancy 2), Daniel Lazard (Paris 6 / LIP6), Sylvain Lazard and Sylvain Petitjean (INRIA Lorraine / LORIA, VEGAS project, later Gamble).
- License:
  - The papers are copyrighted by Elsevier; the HAL deposits are author versions.
  - The algorithm is mathematics and is not copyrightable, and no patent is known (INFERRED; none is cited in the papers or in the QI paper).
  - Re-implementing from the description is unrestricted. Do not copy text or tables verbatim.
  - The reference implementation QI has a non-commercial licence; see [qi-quadric-intersection-library-loria-gamble.md](qi-quadric-intersection-library-loria-gamble.md). That affects the code only, not the algorithm.
- Status: finished theory. It is the standard reference for exact quadric-quadric intersection and is cited by essentially every later quadric SSI paper, e.g. Shao & Chen 2024 (https://doi.org/10.1007/s11424-024-2519-3) and the Li/Yang/Jia 2026 survey (https://doi.org/10.1016/j.cad.2026.104039) (DOCUMENTED via Crossref reference lists).

## What it is

An algorithm that computes an exact, proper parameterization of the intersection curve of two quadrics given by rational (integer) coefficient matrices (DOCUMENTED, Part I abstract, https://inria.hal.science/inria-00186089). The output is polynomial or rational in the parameters, with the smallest possible number of square roots up to at most one extra square root. It works in P³(R), covers every real intersection type, and includes an exact classification of pencils using only rational arithmetic.

- It improves on Levin's classic pencil method (1976/79).
  - Levin's method produces nested radicals of depth up to five (DOCUMENTED, Part I §3, https://inria.hal.science/inria-00186089).
  - One Levin output computed by hand in Maple "fills up over 100 megabytes of space" (DOCUMENTED, Part I §1).
  - Floating-point versions of Levin give topologically wrong results in degenerate cases (DOCUMENTED, Part I §1).
- Part I handles the generic case of a smooth quartic.
- Part II classifies all real pencils (Segre characteristic plus inertia) and gives rational-only tests for which case applies.
- Part III parameterizes every singular intersection: nodal/cuspidal quartics, cubic plus line, conics, lines, points.

## How it works

### Pencil basics (DOCUMENTED, Part I §2)

- Quadrics QS and QT are given by symmetric 4x4 matrices S and T. The pencil is R(λ,μ) = λS + μT.
- The determinantal equation D(λ,μ) = det R(λ,μ) is a binary quartic form.
- Inertia (σ+, σ−), normalized as (max, min), is a projective congruence invariant (Sylvester's law of inertia).
  - It is constant on each interval between consecutive real roots of D.
  - Non-ruled quadrics (ellipsoid, paraboloids, hyperboloid of two sheets, sphere) have inertia (3,1). Ruled non-singular quadrics have inertia (2,2).
- Finsler's theorem: the real intersection is empty iff the pencil contains a definite matrix. Consequently, when the intersection is empty all roots of D are real (DOCUMENTED, Part I §2 and Part II table 1, https://inria.hal.science/inria-00186090).

### Part I, generic algorithm (DOCUMENTED, Part I §4.2 outline, §4.3-4.5 details, https://inria.hal.science/inria-00186089)

1. **Find a rational pencil quadric QR with det R > 0 if possible, else det R = 0.** Isolate the real roots of D with Uspensky/Descartes and test rational λ between them.
   - If no such R exists, the intersection is two points, which are output directly.
   - If R has inertia (4,0), the intersection is empty.
   - The existence of such a ruled member is Theorem 3, the projective analogue of Levin's theorem (§5).
2. **Diagonalize by Gauss reduction, not eigenvectors.** Completing squares is rational, so the frame change P has rational entries. Levin's eigenvector diagonalization is exactly the step that introduces nested radicals (§3).
3. **Parameterize QR by Table 2.** The parameterizations are linear in one of their parameters, bijective onto the projective quadric, and proven worst-case optimal in the number of square roots (§6).
   - For inertia (2,2), use a rational point to reach a frame where QR is x²+y²−z²−δw², δ ∈ Q. Then
     `X((u,v),(s,t)) = [ut+vs, us−vt, ut−vs, (us+vt)/√δ]`, with (u,v), (s,t) ∈ P¹ (§4.4).
4. **Kill the second radical with Lemma 7.** A (2,2) quadric generally needs two square roots. Approximate a point of QR by a rational point p′ not on the intersection. By Lemma 7 exactly one pencil member passes through p′, and it is rational. If p′ is close enough, that member has the same inertia and can replace QR, with p′ as its rational point. Only √δ remains (§4.3-4.4).
5. **Solve Ω = (PX)ᵀS(PX) = 0.** For inertia (2,2), Ω is a homogeneous biquadratic in ξ = (u,v) and τ = (s,t) (§4.5).
   - Its contents in ξ and in τ are split off by gcds only, and each gives components directly.
   - The remaining factor is solved in a parameter in which it is linear, if any; otherwise it is solved as a quadratic in τ. That gives `X(ξ) = X1(ξ) ± X2(ξ)·√Δ(ξ)` with Δ(ξ) = b² − 4ac of degree 4, over Q(√δ).
   - The domain is {ξ : Δ(ξ) ≥ 0}. The parameterization is proper (injective almost everywhere) because the parameterization of QR is bijective.
6. **Near-optimality (§7).** In the smooth quartic case the curve has genus 1, so √Δ is unavoidable, while √δ may or may not be.
   - Theorem 23: √δ is avoidable iff σ² = det((xᵀTx)S − (xᵀSx)T), with x = (x,y,z,c), has a rational solution. This is a surface of degree up to 8.
   - Deciding whether such rational points exist is "not within the range of problems that can currently been answered by algebraic number theory" (the Hilbert's 10th problem family). Hence the result is "near-optimal": at most one extra square root.
   - The morphology of a smooth quartic follows from Theorem 25 (Tu, Wang, Wang 2002), which reads it off the real roots of D:
     - 4 real roots: two affinely finite components, or empty.
     - 2 real roots: one finite component.
     - 0 real roots: two affinely infinite components.

### Part II, classification of pencils (DOCUMENTED, Part II §2-4, https://inria.hal.science/inria-00186090)

- Classification is by Segre characteristic (e.g. [1111], [211], [(11)11], [(31)], [(22)] ...), refined over R by the inertia of the singular pencil members and a sign.
  - Tables 1, 3 and 4 give about 36 real types, covering the cases D ≢ 0 and D ≡ 0.
  - Each type maps to the real type of intersection in P³(R): smooth quartic, nodal quartic with isolated node, cuspidal quartic, cubic and secant line, two conics, four lines, a point, empty, and so on.
- Theorem II.1: the real intersection is affinely finite (bounded in some affine chart) iff the pencil contains a quadric of inertia (3,1).
- **Every test needed to decide the type uses only rational arithmetic:**
  - The multiplicity structure of the roots of D comes from gcds of D and its partial derivatives.
  - The inertia of a rational singular quadric comes from Descartes' rule of signs on det(R − ωI) and det(R + ωI) (the characteristic polynomial and its mirror). This counts positive and negative eigenvalues without computing them.
  - Two conjugate double roots are handled through the 8x8 matrix `M = [[aS+bT, cT],[T, aS+bT]]`, which lets the inertia test at a pair of complex-conjugate double roots run without leaving Q (DOCUMENTED, Part II §3).
  - If D ≡ 0, all pencil members share a singular point. It is moved to (0,0,0,1) by a rational change of frame, and the problem drops to a pencil of conics (Part II §4, Table 4).

### Part III, singular intersections (DOCUMENTED, Part III §2-4, https://inria.hal.science/inria-00186091)

- **Key design choice:** parameterize with the rational pencil quadric of smallest rank (a cone or a pair of planes at a rational multiple root of D), not a (2,2) quadric.
  - Singular intersection curves are rational (genus 0), so this yields polynomial parameterizations without √Δ.
  - Example: for a nodal quartic, the rational cone of the pencil has its apex at the node. Then Ω becomes linear in s and can be solved rationally.
- Table 1 of Part III lists, per real type, the ring of definition of each component, e.g. Q, Q(√δ) or Q(√δ, √δ′), and whether the result is optimal.
- Regular pencils are treated in §3 and singular pencils (D ≡ 0) in §4. Worst-case examples are given for each type.

### Height of the output (DOCUMENTED, QI paper Table 1, https://inria.hal.science/inria-00000380)

The heights come from the companion implementation paper. With input coefficient height h, the output coefficient heights are asymptotically:

| Case | Output height |
|---|---|
| Smooth quartic | 38h (+50hp for the rational point) |
| Nodal quartic | 22h |
| Cuspidal quartic | 38h |
| Cubic and line | 22 (cubic) and 9 (line) |

The companion paper shows the smallest-rank choice is significantly better than using a (2,2) quadric (bound 27 per component, plus a possibly unnecessary square root).

## Robustness and guarantees

- **Exact.** For rational input the output is exact and proper. The morphology and real type are decided exactly, and the classification never uses floating point (DOCUMENTED, Part I abstract and Part II §1).
- **Complete.** Every pair of quadrics in P³(R), including all degenerate pencils (D ≡ 0, multiple roots, conjugate double roots), falls into one of the classified types (DOCUMENTED, Part II tables 1, 3 and 4).
- **Near-optimal.** The number of square roots is optimal in every case except a documented set where one extra √ may appear. That set is decidable only through a hard rational-point problem (DOCUMENTED, Part I §7 Theorem 23; Part III Table 1).
- **Assumes exact input.** Floating-point input must first be converted to integers, which is exact for dyadic floats but makes coefficients large. There are no tolerances: nearly tangent inputs are classified by their exact (usually generic) type (DOCUMENTED implicitly, QI paper §1 "quadrics with rational or finite floating-point coefficients can be trivially converted to integer form", https://inria.hal.science/inria-00000380).
  - For wonky this is both a feature and a hazard. A near-tangent cylinder pair gets an exact generic smooth-quartic answer with a tiny loop that a modeler usually wants to regularize (INFERRED).
- **Covers the full curve, not trimmed segments.** The result is the full projective curve. Trimming to faces, points at infinity (the affine chart) and endpoint computation are out of scope (DOCUMENTED by omission; Shao & Chen 2024 add exactly this, https://doi.org/10.1007/s11424-024-2519-3).

## Parallelism and performance

- Performance data comes from QI (C++, LiDIA/GMP, 2005 Pentium 4):
  - Smooth quartics with 10-digit coefficients take under 50 ms. 400-digit inputs take about 1 s, and 1000-digit inputs about 5 s.
  - Real CSG scenes cost about 3 ms per quadric pair (DOCUMENTED, QI paper §7, https://inria.hal.science/inria-00000380).
- **Work per pair is branchy but small.** The steps are a 4x4 integer determinant expansion, root isolation of a quartic, a handful of gcds, Descartes sign counts, and one Gauss reduction.
  - Pairs are independent, so the natural parallelism is a map over candidate face pairs. That fits Bend's fork-join (INFERRED).
  - Inside a pair the case analysis has about 36 branches, so it is not uniform GPU work. It should run as a scalar task (INFERRED).
- **The uniform, GPU-friendly part** is evaluating X1(ξ) ± X2(ξ)√Δ(ξ) at many parameter values in F32x2, for sampling, meshing or Newton seeding (INFERRED).
- **Bigint sizes for wonky inputs** (INFERRED):
  - An F32x2 value is a dyadic rational with about 48 significant bits plus exponent. Building an implicit matrix for a cylinder |x−o|² − ((x−o)·a)² − r² from (o, a, r) gives entries of degree ≤ 4 in the data. After a common power-of-two scaling that is roughly 200-bit integers, i.e. about 7 U32 limbs, more if exponents differ widely.
  - D has degree 4 in the entries (~800 bits, ~25 limbs). This is fine for exact classification.
  - Materializing the full exact parameterization would multiply that by 22-38 (tens of thousands of bits). That is too heavy to do routinely.
  - Design implication: decide type and topology exactly, but evaluate geometry approximately with a bound.

## Known failures, limitations, war stories

- Optimality is out of reach in practice. In the smooth quartic case an extra √δ may remain (DOCUMENTED, Part I §7 Theorem 23).
- Heights grow linearly with a large constant (22-38x input height). QI reports gaps between predicted and observed heights that are not understood; e.g. it observed 36 where 38 was predicted (DOCUMENTED, QI paper §4 and conclusion, https://inria.hal.science/inria-00000380).
- The algorithm operates on full quadrics. Planes are not quadrics in this framework. Plane/quadric is trivially a conic and is not handled through pencils. Wonky's plane/cylinder cases do not need DLLP (INFERRED).
- The QI server's example list and the paper's worst-case examples show degenerate types really occur in CAD data. In the SGDL pencil-box scene, 356 of 1830 pairs are nodal quartics and 2797 line components appear (DOCUMENTED, QI paper §7.2). Coaxial and tangent cylinders are the norm in mechanical parts, not the exception.
- Levin war story: a floating-point Levin implementation gives wrong topology, and exact Levin gives over 100 MB of nested radicals (DOCUMENTED, Part I §1).

## Relevance for wonky

- **Direct gap closer.** docs/intersections.md currently states "Cylinder/cylinder and cone pairs return `UnsupportedSurfacePair`". DLLP is the complete, exact answer for cylinder/cylinder, cylinder/cone and cone/cone. It also covers spheres and other quadrics if wonky ever adds them.
- **Fit with the leading hybrid** (mesh Boolean for topology, analytic SSI to recover exact B-rep):
  - The Part II classification tells, exactly and cheaply, how many real components the intersection curve has, whether it has a node or cusp, whether it splits into conics or lines, and whether it is affinely bounded.
  - That is a precise oracle to validate or repair the mesh-derived loop topology before snapping curves to analytic form (INFERRED).
- **Makes coaxial and tangent cases explicit.** Coaxial cylinder/cone pairs, tangent cylinders and equal-radius orthogonal cylinders are classified exactly instead of being guessed from tolerances. The unsupported remainder can fail explicitly by type name (INFERRED).
  - Verified on the live QI server, 2026-09-23 (DOCUMENTED, `tmp/research/qi/server-probes-2026-09-23.txt`; table in [qi-quadric-intersection-library-loria-gamble.md](qi-quadric-intersection-library-loria-gamble.md)):

    | configuration | real type | parameterization |
    |---|---|---|
    | Steinmetz (equal radii, intersecting perpendicular axes) | two secant conics | rational |
    | small cylinder internally tangent to a larger one | nodal quartic | rational |
    | externally tangent, skew axes | one real point | — |
    | parallel touching axes | double line | — |
    | coaxial cylinder/cone | two circles | — |
    | unequal-radius pipe tee (r = 1 into r = 2) | smooth quartic, two components | needs √14 in the coefficients, flagged NEAR-OPTIMAL |

- **Where it plugs in:** `docs/proto-recover.md` currently refuses "non-coaxial quadric pairs: pipe tee, Steinmetz, cross holes". This theory, combined with the trimming and tolerance control of [shao-chen-2024-topologically-correct-intersection-curves-of-.md](shao-chen-2024-topologically-correct-intersection-curves-of-.md), is the exact curve source for those refusals. Tori are outside it; see [li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec.md](li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec.md).
- **Bend fit** (INFERRED):
  - Needed and feasible: bigint determinant, gcd, Descartes and Uspensky root isolation on multi-limb U32. No mutation is needed, since everything is pure functions on small matrices.
  - F32x2 can evaluate the parameterization after the exact stage, with an a posteriori residual bound against both implicit equations.
  - Part III's polynomial parameterizations of singular curves are especially attractive. The singular cases are where tolerance-based tracing fails, and here they come with rational (often low-degree) formulas.
- **Scope grew on 2026-09-24.** `docs/entscheidungen.md` item 2 puts sphere and torus into the production kernel together with the hybrid Boolean. Spheres are quadrics, so sphere/cylinder, sphere/cone and non-concentric sphere/sphere fall inside DLLP too. Viviani's curve (sphere r = 2 vs a cylinder r = 1 whose wall passes through the sphere centre) came back from the QI server as a rational nodal quartic (DOCUMENTED, `tmp/research/qi/server-probes-2026-09-24.txt`).

### The pencil in wonky's own terms: generator chart of a ruled quadric (INFERRED derivation, numerically checked 2026-09-24)

DLLP parameterizes one pencil member QR and substitutes it into the other quadric. For CAD input the obvious QR is the input cylinder or cone itself: it is a singular (rank-3) member of the pencil and wonky already stores its frame. This is the special case of Part I Step 2 with a cone of inertia (2,1). The derivation below is mine, not the paper's; it reproduces the paper's structure (one square root of a quartic).

- **Cylinder A** `x(φ,t) = oA + rA(cos φ e1 + sin φ e2) + t a` against **cylinder B** (axis oB, unit b, radius rB), with `P_b(v) = v − (v·b) b` and `w(φ) = x(φ,0) − oB`:
  - `Q(t) = α t² + 2β(φ) t + γ(φ)`, where `α = |P_b a|² = 1 − (a·b)²`, `β = P_b w · P_b a` and `γ = |P_b w|² − rB²`.
  - `t±(φ) = (−β ± √Δ(φ)) / α`, with `Δ(φ) = β² − αγ`.
  - β is a trigonometric polynomial of degree 1 in φ and γ one of degree 2, so Δ has trigonometric degree ≤ 2. After `u = tan(φ/2)`, `(1+u²)²Δ` is a quartic in u. That is exactly DLLP's `X1 ± X2 √Δ(ξ)` form.
  - **Cone A** (apex p, generators `g(φ) = cos κ a + sin κ (cos φ e1 + sin φ e2)`) against a cylinder, cone or sphere B gives the same shape. α(φ) becomes degree 2, β degree 1, γ constant, so Δ is again of trigonometric degree ≤ 2. α(φ) = 0 marks a generator parallel to an asymptotic direction of B, i.e. a branch through a point at infinity (DLLP's "affinely infinite" cases). Use the homogeneous form of t there.
  - Parallel axes give α ≡ 0 and β ≡ 0, so `Q = γ(φ)`: the intersection is the generator lines at the roots of γ (0, 1 double, or 2 lines). This matches QI's "double line" answer for touching parallel cylinders.
- **Morphology from the real roots of Δ on the circle** (the same statement as Part I Theorem 25):
  - Δ > 0 everywhere: two closed branches t+ and t−. Example: the pipe tee, r = 1 into r = 2, where `t² = 4 − sin² φ`.
  - 2 simple roots: one loop. Example: the offset cross hole.
  - 4 simple roots: two loops.
  - A multiple root is a singular point: the internally tangent pair has `(1+u²)²Δ ∝ 8u²(1 − u²)`, a double root at the node.
  - **Δ a perfect square** (`Δ ∝ sin² φ` for Steinmetz) means the square root disappears. The curve splits into rational pieces, `t = ±sin φ`, i.e. the two ellipses.
  - The decision is root isolation plus gcd(Δ, Δ′) and a squareness test on one quartic with exact coefficients: a few multi-limb U32 operations per pair.
- **This chart beats QI on the pipe tee.**
  - The cylinder's own chart gives `[1 − u², 2u, ±2√(u⁴ + u² + 1), 1 + u²]`: rational coefficients and only √Δ.
  - QI answered with coefficients in Q(√14) and flagged it NEAR-OPTIMAL (`tmp/research/qi/server-probes-2026-09-23.txt`). So the "possible extra square root" of Theorem 23 really occurs on everyday input, and choosing the input ruled quadric as QR avoids it whenever its cross-section has a rational point.
  - For wonky the coefficient field matters less than it seems: evaluation runs in F32x2 from the stored frame anyway. The exact stage only needs the sign and multiplicity structure of Δ.
- **Float sampling cannot decide the degenerate cases.** Check script: `tmp/research/dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz/cyl-generator-chart-check.mjs`. Residuals on both implicit equations are ≤ 1e-15 on all five test pairs. But a 20,000-step float scan of Δ reports 4 spurious "sign changes" for Steinmetz and for the internally tangent pair: Δ only touches 0 there. That is the concrete reason the multiplicity must be decided exactly, not sampled.

### The Steinmetz corners are pencil singular points (INFERRED, checked by hand)

- **What fails today.** `steinmetz-intersect` and `steinmetz-union` are refused with "patches of only 2 distinct carriers meet" (`docs/bakeoff.md`, recovery table; `docs/hybrid-boolean-plan.md` §2.3). The corner is refined by Newton on three carriers, and there are only two.
- **What the corner is.** For `f = x² + y² − 1` and `g = x² + z² − 1`, the pencil member `f − g = y² − z² = (y − z)(y + z)` is a pair of planes. It sits at a multiple root of D and has rank 2.
  - Hence the curve is two plane/cylinder ellipses, a curve pair recovery already supports.
  - The corners are where the double line y = z = 0 of that plane pair meets the cylinder: (±1, 0, 0). Both surfaces are tangent there (∇f = ∇g = (±2, 0, 0)), which is why no third carrier exists.
- **How to compute it exactly.** This is Part III's smallest-rank member rule, and also Shao & Chen 2024 Prop. 3.4 (`λ0 ∇f = ∇g` at the repeated root λ0, rank-2 branch). So a corner of that kind can be computed exactly instead of refused, once the pair is classified as "two secant conics".

## Pointers worth porting or studying

- Part II decision procedure (Tables 1, 3 and 4) as an exact classifier: gcd(D, ∂D) for the multiplicity structure, Descartes on det(R ∓ ωI) for inertia, the 8x8 matrix M for conjugate double roots, and the D ≡ 0 reduction to a conic pencil (https://inria.hal.science/inria-00186090).
- Gauss reduction instead of eigen-decomposition to keep frames rational (Part I §4.2-4.4).
- Table 2 bilinear parameterizations of ruled quadrics, and the Lemma 7 trick of a rational point near QR to kill the second radical (Part I §4.3).
- Part III's rule of taking the smallest-rank rational pencil member, and its per-type formulas for nodal/cuspidal quartics, cubic plus line, and conic pairs (https://inria.hal.science/inria-00186091).
- Worst-case example pairs per type (Part III and the QI server) as a regression corpus.
- Part I Theorem 25 (morphology of a smooth quartic from the real roots of D). The generator-chart version above reads the same information off the real roots of Δ(φ).

## Verdict: adapt

This is the correct mathematical backbone for exact quadric-quadric SSI, and it directly unblocks cylinder/cylinder, cone and (since 2026-09-24) sphere pairs. Port the ideas, not code:
- For the common CAD case, one input is a cylinder or cone. Use its own generator chart as QR: one quadratic per generator, Δ(φ) a quartic in tan(φ/2).
- Decide the root structure of Δ exactly on U32 limbs. Use the Part II classification only when Δ has multiple roots or vanishes identically.
- Take singular points and reducible cases (conic pairs, lines) from the smallest-rank pencil member (Part III). The Steinmetz corners are the first customer.
- Keep geometry evaluation in F32x2 with explicit residual bounds, instead of materializing the full exact parameterization (heights 22-38x input).
- Add trimming and affine handling from later work (Shao & Chen 2024).
