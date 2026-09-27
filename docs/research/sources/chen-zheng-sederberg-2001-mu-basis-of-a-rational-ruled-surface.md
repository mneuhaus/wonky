# Chen, Zheng, Sederberg 2001 — "The mu-basis of a rational ruled surface" (+ Dohm 2007, Sederberg-Saito 1995)

- Kind: paper (CAGD 18 (2001) 61–72). PDF read (pp. 1–5, 8–10): https://archive.ymsc.tsinghua.edu.cn/pacm_download/53/510-jZ-ruledsurface.pdf → `wonky-kernel/tmp/research/pdf/chen-zheng-sederberg-2001-mu-basis-ruled.pdf`.
  - Companion: M. Dohm, "Implicitization of rational ruled surfaces with μ-bases", arXiv math/0702658 (v2 2007), abstract and §1 read → `tmp/research/pdf/arxiv-math-0702658-ruled-mu-basis.pdf`.
  - Predecessor (abstract only, via search): T. W. Sederberg, T. Saito, "Rational-ruled surfaces: implicitization and section curves", GMIP 57(4) 1995, 334–342, https://doi.org/10.1006/gmip.1995.1029 — implicit equation of a degree 1×n rational surface as a determinant of dimension ≤ n.
- Authors: Falai Chen (USTC), Jianmin Zheng (Zhejiang), Thomas W. Sederberg (BYU). 2001.
- License: Elsevier copyright; the author-hosted PDF is public. Algorithms are free to re-implement.
- Status: classic reference; basis of later ruled-surface intersection work (Dohm cites Fioravanti et al. 2005 for ruled/ruled intersection via implicitization).

## What it is
An exact, fast implicitization of any rational ruled surface P(s,t) = P0(s) + t·P1(s) (homogeneous, bidegree (n,1)), and a formula for its implicit degree. Lofts between two profiles with a rational correspondence are exactly such surfaces.

## How it works (DOCUMENTED)
- **Implicit degree (Lemma 1):** with Pi = (ai, bi, ci, di) and 2×2 minors [a,b] = a0·b1 − a1·b0 etc., let g = gcd of the six minors and λ = their max degree. The implicit degree is m = λ − deg g. Since each minor has degree ≤ 2n, m ≤ 2n. Common factors of the minors are base points (parameter values where P0 and P1 coincide projectively).
- **μ-basis:** the module of moving planes L(s) with L·P0 ≡ L·P1 ≡ 0 is free of rank 2; generators p, q (linear in x,y,z,w) have degrees μ and m−μ in s. The rows of an explicit 4×4 matrix of minors divided by partial gcds generate the module (eq. 8); reduction gives p, q.
- **Implicit equation (Theorem 3):** f(X) = Res_s(p·X, q·X) = 0, as a Sylvester determinant or a smaller Bézout form (eq. 18: m−μ rows, μ of them quadratic in X). Cost O(n²) vs O(n³) for moving planes.
- Dohm: for non-injective parameterisations the resultant is the implicit equation to the power of the parameterisation degree; proper reparameterisation is discussed.

## Robustness and guarantees
Exact algebra over the coefficient field; the proof is rigorous for properly parameterised surfaces (Dohm generalises). No floating point analysis: the paper assumes exact coefficients.

## Parallelism and performance
Only asymptotic cost (O(n²) for the μ-basis). For loft faces n ≤ 2 (lines and conics), so every quantity is a tiny fixed-size polynomial computation.

## Known failures, limitations
Needs a rational parameterisation and a rational correspondence between the two directrices. Arc-length or angle-proportional correspondences between a line and an arc (which a B-spline-fitting kernel may use) are not algebraic, and then no implicit equation exists; the surface is only approximable.

## Relevance for wonky (degree table INFERRED from Lemma 1; verified by hand for the circle cases)
Carrier degree of a two-profile ruled loft face, given the correspondence along matched edges:

| profile edge pair | correspondence | implicit degree m | carrier |
|---|---|---|---|
| two coplanar lines | linear | 1 | plane |
| two skew lines | linear | 2 | hyperbolic paraboloid (bilinear patch) — what Onshape produces (see the STEP-evidence note) |
| two arcs on parallel planes, equal spans, same sense (any centres, any radii, any rotation between them) | angle-proportional (a Möbius map of the rational parameter) | 2 | quadric: right cone/cylinder if coaxial, oblique elliptic cone (homothetic) or elliptic cylinder (translated) otherwise, hyperboloid of one sheet if rotated about the common axis |
| line ↔ arc | rational (arc as rational quadratic, line linear) | ≤ 3 (cubic ruled surface) | exact rational bidegree (2,1) B-spline |
| line ↔ arc | angle- or arc-length-proportional | not algebraic | approximation only |
| two arcs, general position or unequal spans | rational | ≤ 4 | quartic ruled surface |

Why the parallel-circle row drops to 2: both circles pass through the circular points I, J at infinity (parallel planes share the line at infinity), and a same-sense angle-proportional correspondence maps I→I and J→J. The six minors then share the factor (1+s²), so m = 4 − 2 (checked by expanding the minors for unit circle vs. circle with centre (cx,cy,h), radius r, rotated by φ).

Uses:
- **Classifier:** Lemma 1 turns "which carrier does this face need" into a gcd/degree computation on small integer polynomials — exact on multi-limb U32 once coordinates are snapped, and cheap.
- **SSI:** every ruled face meets a plane in a curve that is a graph over s (one linear solve per ruling) and meets a quadric in one quadratic per ruling (the Miller/Levin generator idea already planned as brep-booleans P5). Only ruled/ruled pairs need more (Heo-Kim-Elber, or the implicit f from this paper substituted into the other surface's parameterisation).
- **Point classification / inside tests:** the implicit f gives an exact sign test for degree ≤ 3 faces.

Bend fit: polynomial arithmetic of degree ≤ 8 on a handful of coefficients; branchy but tiny; CPU fork-join per face. F32x2 suffices for evaluation; exact decisions (gcd, sign of f at snapped points) need multi-limb integers (degree-3 cubic in coordinates snapped to 2^-20 mm over a 1 m box is < 2^200: about 7 limbs; INFERRED estimate).

## Pointers worth porting or studying
Lemma 1 (degree formula), eq. (8) (module generators), Theorem 3 and eq. (18) (Bézout-form implicit equation), the worked example in §3.

## Verdict: adapt
Use the degree formula as the carrier classifier and the implicitization for degree-3 (line-to-arc) faces if wonky chooses exact rational lofts; quadric cases need only the closed forms in the addendum.
