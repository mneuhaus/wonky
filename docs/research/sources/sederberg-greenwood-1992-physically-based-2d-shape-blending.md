# Sederberg & Greenwood 1992 — "A Physically Based Approach to 2-D Shape Blending" (vertex correspondence and the local self-intersection test)

- Kind: paper, SIGGRAPH '92, Computer Graphics 26(2) 25–34. PDF (public course copy) read pp. 1–8: https://www.cs.drexel.edu/~deb39/Classes/Papers/p25-sederberg.pdf → `wonky-kernel/tmp/research/pdf/sederberg-greenwood-1992-shape-blending.pdf` (ACM page not fetched).
  - Related, metadata only: Sederberg, Gao, Wang, Mu 1993, "2-D shape blending: an intrinsic solution to the vertex path problem", SIGGRAPH '93, https://dl.acm.org/doi/10.1145/166117.166118 ; Fuchs, Kedem, Uselton 1977, "Optimal surface reconstruction from planar contours", CACM 20(10), https://doi.org/10.1145/359842.359846 (the directed-graph idea the paper builds on; ACM PDF blocked by Cloudflare).
- Authors: Thomas W. Sederberg, Eugene Greenwood (BYU), 1992.
- License: ACM copyright; algorithms free to re-implement.
- Status: classic; still the reference for polygon correspondence with vertex insertion.

## What it is
An O(mn) algorithm that decides where to insert vertices in two polygons and which vertices correspond, so that the linear interpolation between them ("the family of blend polygons … forming a ruled surface in (x, y, t) space", Fig. 6) is well behaved. That ruled surface is exactly a loft between two profiles on parallel planes.

## How it works (DOCUMENTED)
- **Blend:** P(t) = (1−t)P⁰ + tP¹ vertex by vertex (eq. 1–2). Different vertex insertions give different blends (Figs. 8–11); "the principal task in shape blending is that of adding vertices to each polygon such that each polygon ends up with the same number of vertices, and the resulting vertex correspondences produce the desired blend".
- **Local inversion test:** at vertex i, with Bᵏ = P_{i−1}ᵏ − P_iᵏ and Fᵏ = P_{i+1}ᵏ − P_iᵏ, tan θ_i(t) = (y0(1−t)² + 2y1 t(1−t) + y2 t²)/(x0(1−t)² + 2x1 t(1−t) + x2 t²) with x0 = F⁰·B⁰, x1 = (F¹·B⁰ + F⁰·B¹)/2, x2 = F¹·B¹ and y analogously with cross products (eqs. 6–8). So θ_i(t) is the angle of a quadratic Bézier Q(t) with control points Q0, Q1, Q2 (eq. 9). "θ_i(t) = 0 only if Q(t) intersects the positive x axis" (local self-intersection at that vertex). Monotonicity of θ_i holds iff d(t) = d0(1−t)² + 2d1 t(1−t) + d2 t² (d0 = Q0×Q1, d1 = Q0×Q2/2, d2 = Q1×Q2) has no root in [0,1] (eq. 10); the angle change exceeds 180° iff d1² − d0d2 < 0 and triangle Q0Q1Q2 contains the origin (eq. 11).
- **Work model:** stretching work per corresponding segment pair (eq. 15, constants k_s, c_s, e_s) and bending work per vertex triple (eq. 17, k_b, m_b, e_b, and a penalty p_b if θ goes to zero).
- **Least-work correspondence (§4):** correspondences are monotone staircase paths in the (m+1)×(n+1) grid from [0,0] to [m,n] with East, South or South-East steps ("[i,j] → [i−1,j], [i,j−1] or [i−1,j−1]"; no 90° turns in the simplified version). Dynamic programming over the grid gives the globally minimal work in O(mn) time and two rows of memory; trying all starting correspondences costs O(mn ln n) (citing their ref. [8]).

## Robustness and guarantees
The correspondence is globally optimal for the chosen work function. The θ = 0 test is exact algebra (quadratics with dot/cross products of input coordinates) but detects only **local** inversions at a vertex, not collisions between non-adjacent edges. Constants are user-tuned.

## Parallelism and performance
O(mn) DP, two rows of memory; each row (or anti-diagonal) is a data-parallel update. No measured timings in the pages read.

## Known failures, limitations
Ambiguity is inherent (Figs. 8–11: four plausible blends of the same pair); commercial tools of 1992 produced self-intersecting blends (Figs. 4–5). The method does not certify global simplicity of intermediate polygons.

## Relevance for wonky
- **Vertex matching for unequal counts:** the staircase-path structure is the same as Parasolid's legality rules for explicit loft matches (each intermediate vertex matched once, no crossing paths). A DP with a geometric cost (e.g. squared distance of matched points after barycentre alignment, plus Sederberg's inversion penalty) gives a deterministic, optimal, explainable matching. For the corpus it only matters for square-to-circle, but it is the principled replacement for OCCT's ray casting.
- **Twist certificate, local part:** for parallel-plane lofts the side polygon at height t is exactly P(t), so eq. 6–11 give an exact per-vertex check that no corner of any cross-section folds. Inputs are corner coordinates; the predicates are quadratics in t with coefficients of degree 2 in coordinates, exact on multi-limb integers.
- **Twist certificate, global part (INFERRED extension):** two non-adjacent edges of P(t) cross for some t ∈ [0,1] only if an orientation predicate orient(a(t), b(t), c(t)) of linearly moving points changes sign; each is a quadratic in t. O(n²) uniform pairs → a GPU/fork-join map with exact integer evaluation.
- Bend fit: DP is a wavefront over a small grid (n ≤ ~50 profile vertices in the corpus), fine on CPU fork-join; predicate batches are uniform work.

## Pointers worth porting or studying
Eqs. 6–11 (θ(t) as a quadratic Bézier; θ = 0 and monotonicity tests), §4 recurrences (eqs. 20–28), the starting-point search (§4.2).

## Verdict: adapt
Take the staircase DP for matching and the quadratic inversion test for twist checking; replace the physical work model with a geometric cost suited to CAD.
