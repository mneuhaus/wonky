# Kós, Martin, Várady: "Methods to recover constant radius rolling ball blends in reverse engineering" (CAGD 2000)

- **Kind / URLs:** journal paper.
  - Publisher page: https://www.sciencedirect.com/science/article/abs/pii/S0167839699000436 (returned HTTP 403 to automated fetch on 2026-09-23).
  - DOI: https://doi.org/10.1016/S0167-8396(99)00043-6
  - Open author version: https://orca.cardiff.ac.uk/id/eprint/13565/, PDF at https://orca.cardiff.ac.uk/13565/1/blend%20radius.pdf (link from the Semantic Scholar `openAccessPdf` field).
    - Re-checked 2026-09-24: both ORCA URLs now return HTTP 403 to curl, even with a browser User-Agent. This looks like bot protection, not removal (INFERRED). The local PDF copy (740,871 bytes, fetched 2026-09-22) is the reference for this note.
  - I read the whole author version (31 PDF pages, 30 numbered) from the local copy `tmp/research/pdf/kos-martin-varady-2000-blend-radius.pdf`. The text extract is `…/kos-martin-varady-2000-blend-radius.txt`.
  - Precursor tech report: RECCAD Deliverable 4, GML 98/4 (SZTAKI Budapest, 1998). It is cited as [12] and has "fuller results". Not retrieved.
- **Authors / org / year:**
  - Géza Kós (SZTAKI Budapest, visiting Cardiff), Ralph R. Martin (Cardiff University), Tamás Várady (SZTAKI).
  - Published in Computer Aided Geometric Design 17(2):127–160, February 2000.
  - Funding: EU COPERNICUS grant RECCAD 1068. DOCUMENTED: Crossref metadata and the paper's acknowledgements.
- **License:**
  - Elsevier copyright. The ORCA copy is the author's accepted version, deposited "in accordance with publisher policies", with copyright retained by the holders (ORCA cover page).
  - No code was published. The authors "implemented all the methods in C++" (§5.5).
  - Porting implication: the algorithms are mathematics and can be reimplemented freely. Nothing to link, nothing to inherit.
- **Status:** historical. Citation counts on 2026-09-23: 57 (Semantic Scholar), 51 (OpenAlex), 39 (Crossref). It remains the standard reference for blend-radius recovery in the Várady/Martin reverse-engineering line.

## What it is

- A comparison of ways to estimate the radius R of a **constant-radius rolling-ball blend** from measured, triangulated point data that has already been segmented, once the two neighbouring *primary* surfaces have been fitted.
- Once R and the two primaries are known, the blend is fully determined: its spine is the intersection of the two offset surfaces, and the trimlines are the two contact curves. So "recover the blend" reduces to "estimate R, plus which side the ball is on". DOCUMENTED §1, §3.2.
- Explicitly out of scope: segmentation, vertex blends (deferred to Várady–Hoffmann 1998), variable radius, and building a consistent B-rep topology.
- The paper does not give a separate trimline or surface-construction algorithm. It relies on "the whole blending surface once the primary surfaces are known". DOCUMENTED §1.
- Three **general** methods (any primary-surface types) and four **special** methods (blends that are exactly a cylinder or a torus) are compared on simulated ACIS-generated data and on one real scan.

## How it works

Section numbers are the paper's. Everything is DOCUMENTED unless marked otherwise.

### §2 Tools

| Tool | Method | Detail |
|---|---|---|
| Plane / line fit | Least squares | Minimise Σ(n·xᵢ − d)² with \|n\| = 1. This is an eigenproblem. |
| Normal estimation | Implicit quadric fit | Take the 20 nearest mesh neighbours in a local frame at x₀. Fit Q(x) = xᵀAx + n·x with \|n\| = 1, minimising ΣQ(xᵢ)². The normal is n. Better than a plane fit near high curvature, where "too many" blend points lie. Normals are oriented by averaging incident triangle normals. |
| Principal curvatures | Paraboloid fit | Fit z = ax² + 2bxy + cy² in the normal frame. |
| Curvature bias correction | Closed form | k̃₁ = k₁ − (21/128)·r²k₁³ + (3/128)·r²k₂³, and symmetrically for k₂, with r = √((2/N)Σ(xᵢ²+yᵢ²)) and N = 20. It "doubles the number of correct digits". |
| Sphere / circle fit | Pratt quasi-least-squares | Minimise S(c,R) = Σ(((xᵢ−c)² − R²)/(2R))². S is rational in (c, R). The stationarity condition is degree 5 for a sphere and degree 4 for a circle. Parameterise by 1/R so that a plane or line is the degenerate case 1/R = 0. The plain algebraic fit Σ((xᵢ−c)² − R²)² "does not work in practice": on small patches noise drives R too small. |
| Cylinder fit | Lukács–Marshall–Martin | Minimise S = Σ(((u·xᵢ−a)² + (v·xᵢ−b)² − R²)/(2R))². For a fixed axis w, the values a, b, R and the derivatives of S with respect to w are explicit, so Newton runs on w only. Initial w: fit a plane through the origin to the normals at 25 random points. |
| Cone fit | Rotate into a half-plane | 4 parameters (w, a, b). Rotate the points about the candidate axis into a half-plane and fit a line; its residual is the cone residual. Initial axis: plane fit to 100 normals, then project the points and fit a circle to find the axis point. It degenerates to a cylinder or a plane. |
| Torus fit | Rotate into a half-plane | Same as the cone fit, but fit a circle in the half-plane. Slow (see the timings below). |
| Initial torus axis | Modified Pottmann–Randrup | Minimise Σ(δᵢ sin φᵢ)² = Σ((d×nᵢ)·(a−xᵢ))². The residual is **linear** in (a₀ = a×d, d): nᵢ·a₀ + (xᵢ×nᵢ)·d. So the objective is a quadratic form, solved as a generalized eigenproblem after dropping a₀·d = 0. Take the **two** best eigenvectors, refine both by Newton, keep the better. With noise the wrong axis can win when the true axis is far from the data. |

### §3.1 Average principal curvature method (needs no primary surfaces)

- On a canal surface of radius R, the principal direction perpendicular to the spine has |k| = 1/R.
- Algorithm:
  1. Estimate (k₁ ≤ k₂) and the principal directions at every blend point.
  2. Discard "bad" points: those whose average angle to the neighbours' principal directions is ≥ 15° (both directions are checked).
  3. Sort, drop the top and bottom 25%, and compute the mean M and deviation D of the middle half.
  4. Pick the positive or negative case: from the signs of M(k₁) and M(k₂), or else by comparing the ratios |M|/D.
  5. R = 1/|M(k₂)| in the positive case, 1/|M(k₁)| in the negative case.
- It is the worst method (see results). It picks the wrong side on concave blends when noise hides the curvature variation.

### §3.2 Iterative spine reconstruction

- **Spine(R)** = offset(S₁, R) ∩ offset(S₂, R) (Fig. 6). Minimise S(R) = Σᵢ(|c(bᵢ,R) − bᵢ| − R)², where c(b,R) is the closest spine point to the blend point b.
- **Side selection.** For each primary, the sign of the *average* signed distance of all blend points. After that, dᵢ(x) is the signed distance and vᵢ(x) its unit gradient.
- **Initial radius.** Estimate curvature at 25 points. The ball lies on the side that v₁+v₂ points to. R₀ = 1/median of the chosen |k|.
- **Inner projection onto the spine.** Two alternating moves:
  - *Onto the spine:* x ← x + αv₁ + βv₂ with `[1 g; g 1]·[α β]ᵀ = [R−d₁, R−d₂]ᵀ`, where g = v₁·v₂.
  - *Along the spine:* once d₁ ≈ d₂ ≈ R, take t = v₁×v₂/|v₁×v₂|. If |t·(b−x)| is too big, x ← x + (t·(b−x))·t.
- **Outer Newton on R.** It ignores changes in vᵢ.
  - dc/dR = (v₁+v₂)/(1+v₁·v₂)
  - d|c−b|/dR = ((v₁+v₂)·(c−b)) / ((1+v₁·v₂)|c−b|)
  - d²|c−b|/dR² = 2/((1+v₁·v₂)|c−b|) − ((v₁+v₂)·(c−b))² / ((1+v₁·v₂)²|c−b|³)
  - Update: Rₙ₊₁ = Rₙ − S′/S″.
- **Explicit spine.** For plane–plane, plane–sphere, plane–cylinder and plane–cone pairs the spine is a conic and can be computed in closed form. Only plane–cylinder, where the spine is an ellipse, was implemented. The authors call it "messy".
- **Thresholds (§3.2.6).** The aim is at least 5 correct digits, so every step needs 6:
  - |dⱼ/R − 1| < 10⁻⁶
  - |t·(x−b)| < 10⁻⁶
  - stop when |S′| ≤ 10⁻⁶·R·S″

### §3.3 Maximum ball method (the recommended general method)

- For each blend point b, find the **largest sphere through b tangent to both primaries**. The conditions are d₁(c) = d₂(c) = |c−b| = R, with c−b, v₁ and v₂ coplanar. A second root, the minimum ball, also exists (Fig. 11). Average the per-point radii; the paper uses the mean, not the median, because the radii are tightly clustered.
- **Plane–plane closed form.** Write c = b + αv₁ + βv₂. The equations are:
  - d₁ + α + gβ = R
  - d₂ + gα + β = R
  - |αv₁ + βv₂| = R

  These give a quadratic in R; take the larger root.
  - INFERRED explicit form (my elimination): (R−d₁)² − 2g(R−d₁)(R−d₂) + (R−d₂)² = (1−g²)R².
  - Check: perpendicular planes (g = 0) with b at the 45° point of a radius-R₀ blend gives d₁ = d₂ = R₀(1 − 1/√2). The roots are R₀ (maximum) and R₀(1−1/√2)/(1+1/√2) (minimum).
- **General case.** The same alternating iteration as §3.2.3, but the in-plane step solves d₁+α+gβ = d₂+gα+β = |x−b+αv₁+βv₂|, which is again a quadratic. The first step equals the plane–plane solution.
- **Guard (§3.3.3).** Use only points with d₁, d₂ > 0 and 1/10 ≤ d₁/d₂ ≤ 10. Points on the wrong side of a primary, because of noise, have no ball: "the iteration would result in an infinite loop". Points on a primary give a degenerate family of balls along the bisector.

### §4 Special cases: the blend is exactly a cylinder or a torus

The paper gives a ready-made table of support pairs with analytic blends:

| Blend is a… | Support-pair configurations |
|---|---|
| **Cylinder** | plane–plane (any angle); plane–cylinder with axis ∥ plane; cylinder–cylinder with parallel axes. |
| **Torus** | plane–sphere; plane–{cylinder, cone, torus} with axis ⟂ plane; sphere–{cylinder, cone, torus} with the sphere centre on the axis; coaxial {cylinder, cone, torus} pairs. |

Methods:
- **Direct cylinder or torus fit** to the blend points (§2), with no use of the primaries.
- **Simple circle fit.** Project the points along the translation direction, or rotate them about the common axis, into the 2D profile plane and fit a Pratt circle.
- **Constrained circle fit.** In the profile plane the primaries become lines or circles. The circle centre (u,v) must be at distance R from both:
  - a line gives n₁u + n₂v − d = R
  - a circle gives (u−c₁)² + (v−c₂)² = (r±R)², depending on whether the blend is outside or inside
  - The solution set is the bisector: a line (line–line), a parabola (line–circle) or a conic (circle–circle). Minimising the Pratt error along it needs a root of degree 3, 5 or 7 respectively.
  - **Iterative variant** (implemented for all listed pairs):
    1. Rₖ = (d₁+d₂)/2.
    2. If d₁ ≠ d₂: cₖ₊₁ = cₖ + ((d₂−d₁)/|v₁−v₂|²)·(v₁−v₂), a projection onto the bisector.
    3. Otherwise do a line search along the bisector tangent: c(t) = cₖ + t(v₁+v₂), R(t) = Rₖ + (1+v₁·v₂)t, t = −S′/S″.
    4. Stop at |d₁/d₂ − 1| < 10⁻⁶ and |ΔR| < 10⁻⁶R.

### §5 Evaluation setup

- Simulated datasets generated with the **ACIS test harness**: the two primaries plus the blend, triangulated.
- R = 10 mm. Point densities of 5, 10 and 20 points/cm. Gaussian noise on z with σ = 3% of the point spacing ("representative of commercial scanners"). No outliers.
- Primaries were **fitted from the noisy data**, not taken as ground truth.
- Test cases:
  - pp: plane–plane at 90°, 60° and 157°
  - ps
  - pc1–pc5: plane–cylinder, including inside/outside and tilted-axis variants
  - pn: plane–cone
  - pt
  - ct: cylinder–torus in general position
  - nn: coaxial cones
  - cc: perpendicular cylinders, and parallel cylinders with an inside/outside mix
  - ss: sphere–sphere, including a difference
  - st
  - tt: chain-link tori

## Robustness and guarantees

- **Nothing is proven.** All methods are least-squares or Newton heuristics with relative thresholds of 10⁻⁶. The goal is empirical: 5 correct digits on clean data. DOCUMENTED §3.2.6, §3.3.4, §4.3.2.
- **Failure modes the paper names:**
  - The curvature method picks the wrong side on concave blends in noise (pc3a.20, nn1a.10, nn1a.20).
  - Blend points on the wrong side of a primary have no ball (non-termination without the guard).
  - Points near a primary give unstable estimates (degenerate bisector family).
  - Pottmann's axis estimate can lock onto the wrong one of two axes.
  - Torus fitting is very slow.
  - DOCUMENTED §3.1.2, §3.3.3, §2.7.1, §5.4.
- **Accuracy (Tables 2 and 4):**

| Method | Clean avg / max error | Noisy avg / max error |
|---|---|---|
| Curvature estimation | 2.668% / 18.786% | 8.486% / 41.917% |
| Iterative spine | 0.000% / 0.001% | 0.051% / 0.685% |
| Maximum ball | 0.000% / 0.001% | 0.079% / 0.715% |
| Direct cylinder fit (special cases) | 0.000% / 0.000% | 0.081% / 0.269% |
| Direct torus fit (special cases) | 0.000% / 0.001% | 0.072% / 0.336% |
| Simple circle fit (special cases) | 0.000% / 0.000% | 0.092% / 0.761% |
| Constrained circle fit (special cases) | 0.000% / 0.000% | 0.048% / 0.393% |

- **Real data (§5.6, Table 10).** A plastic bottle scanned with a REPLICA scanner at 0.5 mm, sphere–cylinder blends.
  - Upper blend: 2.60–2.77 across all methods.
  - Lower blend: the sphere centre is off the cylinder axis, so the special methods cannot be used. The estimates are 3.29 (curvature), 3.71 (spine) and 4.35 (maximum ball), a 30% spread.
  - The authors blame non-Gaussian scanner error, outliers and imperfect segmentation. So the headline accuracies hold only for simulated data. DOCUMENTED.

## Parallelism and performance

Timings from Tables 6 and 8, on unstated late-1990s hardware; the paper does not give the machine. Times exclude primary fitting and triangulation.

| Method | Clean avg / max | Noisy avg / max |
|---|---|---|
| Curvature estimation | 3.275 s / 13.74 s | 3.273 s / 13.71 s |
| Iterative spine | 0.345 s / 1.57 s | 0.503 s / 2.54 s |
| Maximum ball | 0.076 s / 0.47 s | 0.101 s / 0.63 s |
| Constrained circle fit | 0.013 s | 0.015 s |
| Direct cylinder fit | about 1.8 s | |
| Direct torus fit | 57 s (max 334 s) | 69 s (max 334 s) |

- Maximum ball is about 4× faster than iterative spine.
- On the dense ps1 set the torus fit took 147 s clean and 334 s noisy (Table 7). Explicit spine computation roughly doubles speed for a tilted plane–cylinder pair. DOCUMENTED §5.4, Tables 5–9.
- **Parallel structure.** INFERRED: the paper discusses no parallelism.
  - Maximum ball is embarrassingly parallel: one independent small fixed-point iteration per point, each step a 2×2 solve or a quadratic. That is uniform per-lane GPU work, given a fixed iteration cap and a converged/diverged flag per lane.
  - Spine reconstruction alternates a per-point projection (parallel) with a global Newton step on R. The global step needs a sum reduction of S′ and S″, which is a balanced fork-join tree.
  - Pratt-style fits need only sums of monomials: one parallel reduction, then a tiny scalar solve.

## Known failures, limitations, war stories

- The real-scan spread on the off-axis sphere–cylinder blend (3.29 / 3.71 / 4.35) is the war story. Methods that agree to 0.1% on synthetic data disagree by 30% on real data once segmentation is imperfect. DOCUMENTED Table 10.
- "Implementing the iterative spine reconstruction with explicit spine computation is messy." The explicit constrained circle fit was implemented only for line–line and line–circle. At least four bisector types exist in general. DOCUMENTED §5.5.
- There are no public issue trackers or code. The follow-up work is the same group's region-growing and vertex-blend papers. HEARSAY: this comes from the reference list, not verified here.

## Relevance for wonky

INFERRED throughout, unless noted.

- **Hybrid Boolean (tagged mesh → exact B-rep).**
  - When wonky's own fillet faces go through the mesh stage, their facets carry the fillet face tag. The exact surface (cylinder or torus with known axis and R) is looked up from the tag, not recovered. Neither recognition nor refit is needed, so this paper is **not** on the main path.
  - It covers the **untagged fallback**: meshes without provenance (imported STL, meshes produced by other tools, 3D scans), and any "recognise the blend" feature on imported B-reps whose blends arrive as B-splines.
- **Fillet verification oracle.** This is the most valuable use for wonky.
  - The maximum-ball residual is an independent check that a constructed fillet really is a constant-radius rolling-ball blend between its two supports.
  - Sample points on the tessellated fillet face, compute each point's maximum-ball radius against the two exact support surfaces, and assert |Rᵢ − R| < tol.
  - The ball centres must also lie on the offset-intersection spine, and the contact points must lie on the trimlines.
  - It catches wrong side choice, wrong spine, wrong trim and wrong radius without reusing the construction code. The plane–plane closed form above makes it cheap for the common FDM case.
- **Scan-to-CAD for Marc.** Marc reverse-engineers FDM parts from Revopoint scans and already fits planes, cylinders and cones. The §4 table plus the **constrained circle fit** add fillet radii for the common FDM configurations: plane–plane gives a cylinder fillet; plane–perpendicular cylinder (boss or hole edge) gives a torus. It is fast (about 13 ms in 1999) and the most accurate of the special methods (0.048% average noisy).
- **Defillet / refillet.** Onshape's `opOffsetFace` has `reFillet`, and Parasolid has `PK_FACE_delete_blends`. Both need to recognise existing blends first. On wonky's own B-reps this is exact: an analytic cylinder or torus face tangent to two neighbours with matching R. The paper's methods are only needed for approximated blends in imports.
- **Bend fit.**
  - Everything is small dense linear algebra, Newton or fixed-point iteration, and sum reductions. There are no exact predicates.
  - The 10⁻⁶ relative thresholds sit at the edge of plain F32: 2⁻²⁴ ≈ 6·10⁻⁸ per operation, and accumulating ΣQ² sums loses more. So use **F32x2** for residuals and reductions, and centre the data before forming moment sums.
  - The Pratt 1/R parameterisation keeps planes and lines finite. That is good for F32: no huge R.
  - The side and "has a ball" decisions depend on noise, not exactness. They should be tolerance-classified with an explicit "undecidable" result rather than escalated to multi-limb integers.
  - Replace the paper's unbounded iterations with fixed caps and explicit failure (the paper itself notes an infinite-loop case).
- **Testing.** The §5.1 dataset list (pp/pc/pn/nn/cc/ss/st/tt, R = 10 mm, 5/10/20 pts/cm, σ = 3% of spacing) is a ready-made synthetic benchmark design for any recovery code.

## Pointers worth porting or studying

- §3.3.1–3.3.2: the maximum-ball equations (a closed-form quadratic for plane–plane, an iterative quadratic in general), plus the §3.3.3 admissibility guard (d₁, d₂ > 0 and 1/10 ≤ d₁/d₂ ≤ 10).
- §3.2.3–3.2.4: the spine projection pair of moves, and dc/dR = (v₁+v₂)/(1+v₁·v₂). This formula is also handy for *forward* fillet construction: it is the sensitivity of the spine to R.
- §4 bullet list: the configurations where the rolling-ball blend is exactly a cylinder or torus. Cross-check it with OCCT `ChFiKPart` (see `occt-modeling-algorithms-guide-and-tkfillet-chfi3d-fillets-c.md`) when deciding which exact fillet cases wonky implements first.
- §4.3.2: the iterative constrained-circle fit in 2D, with the bisector projection and the tangent line search.
- §2.3: the curvature-bias correction k̃ = k − (21/128)r²k³ + (3/128)r²k′³.
- §2.4: Pratt fitting with the 1/R parameterisation.
- §2.7.1: Pottmann–Randrup axis estimation as a linear eigenproblem, with its two-candidate caveat.

## Verdict: adapt

- **Adapt narrowly.** Reimplement the maximum-ball residual as a fillet test oracle, and the constrained circle fit (plus the §4 configuration table) for untagged-mesh and scan recovery of cylinder and torus blends. Both are license-free math, small, uniform per-point work, and expressible in F32x2 Bend.
- **Do not put it on the fillet-construction path.** Wonky builds fillets analytically and tags them, so recovery is a lookup there. Skip the curvature-estimation method entirely: the paper shows it is slow and inaccurate.
