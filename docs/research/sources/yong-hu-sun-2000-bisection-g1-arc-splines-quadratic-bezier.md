# Yong, Hu, Sun 2000: bisection algorithms for approximating quadratic Bezier curves by G1 arc splines (and the Walton-Meek line)

- Kind: paper. J.-H. Yong, S.-M. Hu, J.-G. Sun, "Bisection algorithms for approximating quadratic Bézier curves by G1 arc splines", *Computer-Aided Design* 32 (2000) 253-260, doi:10.1016/S0010-4485(99)00100-1. Open PDF: [cg.cs.tsinghua.edu.cn/~shimin/pdf/cad 2000_arc.pdf](https://cg.cs.tsinghua.edu.cn/~shimin/pdf/cad%202000_arc.pdf), local `tmp/research/pdf/yong-hu-sun-2000-bisection-quadratic-bezier-arc-splines.pdf` (read in full). Cited and **not read** (paywalled): D.J. Walton, D.S. Meek, "Approximation of quadratic Bézier curves by arc splines", *J. Comput. Appl. Math.* 54 (1994) 107-120 ([ScienceDirect](https://www.sciencedirect.com/science/article/pii/0377042794903980)); D.S. Meek, D.J. Walton, "Approximating quadratic NURBS curves by arc splines", *CAD* 25 (1993) 371-376; Y.J. Ahn et al., "G1 arc spline approximation of quadratic Bézier curves", *CAD* 30 (1998) 615-620 ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0010448598000165)).
- Organization: Tsinghua University (National CAD Engineering Center).
- License: journal article (Elsevier); algorithms are free to implement.
- Status: classic CNC tool-path literature, 1993-2000; still the reference for "quadratic Bezier → arcs with a tolerance".

## What it is

Algorithms that replace one quadratic Bezier by a G1 chain of circular arcs within a prescribed error ε, with a closed-form upper bound on the number of arcs. Context: CNC controllers only understand lines and arcs.

## How it works

- Split the quad at its curvature extremum (turning point) so each piece has monotone curvature; orient pieces so curvature increases (Sapidis-Frey 1992 cited).
- **Lemma 2/3 (DOCUMENTED):** for a monotone-curvature quad approximated by one arc or one biarc starting with a tangent T0 within the control angle α = ∠b1b0b2, the error E < ½‖b2 − b0‖ tan α < ‖b1 − b0‖ sin α. Maximum curve-to-chord distance of the quad: D_q = ‖b1 − b0‖‖b2 − b1‖ sin θ / (2‖b2 − b0‖).
- **Theorem 2 / Corollary 1 (DOCUMENTED):** splitting the parameter interval uniformly with step h gives E ≤ M h² / (2‖b1 − b0‖² sin² ω); hence an arc count S ≥ (1/(‖b1 − b0‖ sin ω))·√(M/(2ε)) + 1 suffices, M and ω from the control polygon. So this arc-spline family converges like **ε^(−1/2)** (one arc per piece, G1 via tangent carried forward).
- **Algorithm 1:** bisection search on N between 2 and the Corollary-1 bound (O(L log L)). **Algorithm 2:** greedy bisection of parameter intervals so each arc's error is just below ε, last piece a biarc (O(mN)).
- **Results (DOCUMENTED, Table 1):** example 1 (ε = 1e-3): Ahn 15 arcs, Alg. 2 10 arcs; example 2 (ε = 1e-4): 29 vs 14; example 3 (ε = 1e-7): 158 vs 119.

## Robustness and guarantees

Error bounds are proven for monotone-curvature pieces under the tangent condition φ < α; the actual error is computed per arc (Walton-Meek formulas) and checked against ε. Double precision; no exactness claims.

## Parallelism and performance

Per-quad independent; greedy bisection is sequential along one quad but quads are independent (fork-join over segments). Not uniform work.

## Known failures, limitations, war stories

Degenerate (collinear) quads must be detected first (Algorithm 3 step 1). The G1 chain carries a tangent forward, so the error of later arcs depends on earlier choices (sequential dependency).

## Relevance for wonky

This is the "reuse the existing line/arc path" alternative for text. Measured on the actual Onshape text "CORNER POST R10" at H = 4 mm (118 quads, 83 lines; `tmp/research/sktext/arccount.mjs`, equal-chord biarcs with recursive parameter bisection, one-sided sampled error):

| ε (mm) | arcs | arcs per quad | uniform chords (print mesh) |
|---|---|---|---|
| 1e-2 | 256 | 2.2 | 439 |
| 1e-3 | 470 | 4.0 | 1269 |
| 1e-4 | 930 | 7.9 | 3897 |
| 1e-5 | 1870 | 15.8 | 12184 |
| 1e-6 | 4038 | 34.2 | 38418 |

Biarcs roughly double per 10× tolerance (≈ ε^(−0.3), INFERRED consistent with an O(h³) biarc error), single-arc chains per Corollary 1 scale as ε^(−1/2). At a tolerance comparable to Onshape's own (~1 µm) the arc route multiplies the wall-face count by ~4-34× (every arc is a cylindrical face and a vertex pair) and still does not reproduce Onshape's geometry (which keeps parabolas). It is attractive only as a **fallback** when a downstream consumer (G-code, a Boolean that only admits lines/arcs) needs it, with ε recorded as an explicit tolerance, e.g. ε = 1e-3 mm for FDM (invisible at 0.4 mm nozzle, stems are ≥0.28 mm wide).

## Pointers worth porting or studying

- Lemma 2 bound as a cheap certified a-priori test; Corollary 1 as an arc-count budget for admission control (refuse if > N).
- Algorithm 3 (turning-point split) — also useful for exact parabola work: the turning point of a quad is its vertex (curvature maximum), a rational parameter t* = ((p0 − p1)·a)/(a·a) with a = p0 − 2p1 + p2 (INFERRED from the parabola geometry).

## Verdict: learn-from (fallback path only)

Exact parabolas are cheaper in faces and closer to Onshape; keep arc splines as an optional, tolerance-tagged export/Boolean fallback.
