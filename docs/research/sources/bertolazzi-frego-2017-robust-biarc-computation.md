# Bertolazzi and Frego 2017: A note on robust biarc computation

- Kind: paper (preprint). E. Bertolazzi, M. Frego, "A Note on Robust Biarc Computation", arXiv:1711.00935 [math.NA], 2017 ([arXiv](https://arxiv.org/abs/1711.00935)); local `tmp/research/pdf/arxiv-1711.00935-robust-biarc.pdf` (read in full, 10 pp. incl. pseudo-code).
- Organization: University of Trento.
- License: arXiv preprint; algorithm free to implement. The authors' C++ library (Clothoids, BSD-2, per their other work; HEARSAY, not checked) contains it.
- Status: preprint; cited in path-planning and CNC literature.

## What it is

A case-free algebraic construction of the biarc (two tangent-continuous circular arcs) interpolating G1 Hermite data (p0, ϑ0, p1, ϑ1), fixing the free parameter like MATLAB `rscvn` (joint tangent angle ϑ* = 2α − (ϑ0 + ϑ1)/2, α the chord angle).

## How it works

- Normalize to p0 = (0,0), p1 = (1,0). Each arc is written with sinc(x) = sin x / x and cosc(x) = (1 − cos x)/x, evaluated by Taylor series for |x| < 0.002 (error < 1e-20 per the paper).
- Lemma 2.2: the unknown arc lengths (s, t) solve one **2×2 linear system** A (s,t)ᵀ = (1,0)ᵀ with columns R(θi)·(sinc θ*^i, cosc θ*^i); curvatures κ0 = θ*^0/s, κ1 = −θ*^1/t.
- Singular configurations (ϑ0 = ϑ1, determinant D(x,x) = 0) are handled by the **2×2 pseudoinverse** (Algorithm 4), which returns the least-squares solution and stays continuous in the data.
- Existence (Lemma 2.5): solution exists for θ0 ≠ θ1; in the singular case only if θ* = −θ and θ ∈ (−π, π).

## Robustness and guarantees

Proves existence and continuity of the chosen solution; demonstrates MATLAB `rscvn` failures near singular angles (Fig. 4: returns a line segment or wrong C-shape). No error bound against a target curve (that is the job of the approximation scheme around it).

## Parallelism and performance

Constant work per biarc (a few trig evaluations and a 2×2 solve): ideal uniform GPU work.

## Known failures, limitations, war stories

MATLAB `rscvn` selects non-natural or wrong solutions near singular configurations (DOCUMENTED, Figs. 3-4). The Taylor thresholds assume doubles.

## Relevance for wonky

If wonky ever needs the arc-spline fallback for text (see `yong-hu-sun-2000-bisection-g1-arc-splines-quadratic-bezier.md`), this is the branch-free biarc kernel to use: fixed work, no case analysis, continuous in the data, which fits Bend's uniform-work GPU style. Precision: sinc/cosc series and a 2×2 solve are well-conditioned in F32x2 (~48-bit mantissa) away from the singular configuration; the pseudoinverse branch is a data-dependent `pick`, cheap in Bend. The biarc's arcs must still be verified against the parabola with a certified bound (e.g. the Lemma-2 style bound, or sampling plus a curvature bound), otherwise the tolerance is not explicit.

## Pointers worth porting or studying

Appendix A: Algorithm 1 (biarc), 2-3 (Sinc/Cosc series), 4 (2×2 pseudoinverse); eq. (4) for ϑ*; Lemma 2.3 closed forms D(x,y) = sinc y cosc x − sinc x cosc y, K(x,y) = −2 sin((x+y)/2) sinc((x−y)/2).

## Verdict: learn-from (adopt only if the arc fallback is built)
