# Kettner et al. 2008, Classroom examples of robustness problems in geometric computations

- Kind: research paper and adversarial-example methodology. Canonical [journal page](https://www.sciencedirect.com/science/article/pii/S0925772107000697), [DOI](https://dl.acm.org/doi/10.1016/j.comgeo.2007.06.003), working [author manuscript PDF](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).
- Authors: Lutz Kettner, Kurt Mehlhorn, Sylvain Pion, Stefan Schirra, Chee Yap; MPI Informatik, INRIA Sophia-Antipolis, Universität Magdeburg, NYU. Computational Geometry 40(1), 2008, pp. 61–78; preliminary ESA 2004 version. The downloaded 22-page author manuscript is dated June 17, 2008. DOCUMENTED, manuscript title page and [journal metadata](https://nyuscholars.nyu.edu/en/publications/classroom-examples-of-robustness-problems-in-geometric-computatio-2).
- License: no permissive software license found in the manuscript. Treat article text/listings as copyrighted; independently implement experiments and cite the numerical examples. Companion-source reuse would require a separate license check. No kernel linking is proposed.
- Status: historical peer-reviewed paper; repository activity metrics do not apply. Availability correction as of 2026-09-24: the MPI author PDF is reachable, despite the task seed's 404 warning. The two historical companion-site addresses below return 404. All 22 manuscript pages, including the C++ appendix, were read. Local PDF: `<repo>/tmp/research/pdf/classroom-examples-robustness-2008.pdf`.

## What it is

DOCUMENTED: a systematic demonstration that tiny floating predicate errors can cause arbitrarily large geometric errors, self-intersections, crashes and nontermination. Its main examples are planar incremental convex hull and the point-location walk in a 3D Delaunay triangulation. It is not a new exact predicate algorithm or a benchmark establishing that one particular hull library is defective. It supplies explicit inputs, construction recipes, invariant violations and a reference C++ hull implementation ([PDF](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf), §§1, 4–7 and appendix).

## How it works

DOCUMENTED numeric contract: all studied arithmetic is IEEE binary64, rounding each operation to nearest, with fixed tie handling. Decimal-to-binary reproduction matters; the authors supplied little-endian binary data because historical C++ decimal I/O guarantees were inadequate. Subnormals play no role in these experiments (§2).

**Orientation-map recipe.** DOCUMENTED: evaluate `sign((qx-px)*(ry-py) - (qy-py)*(rx-px))` with the displayed grouping. Hold q and r fixed and vary p on a 256×256 grid of adjacent representable values: `(px + X*ux, py + Y*uy)`, `0 <= X,Y <= 255`. At `(px,py)=(0.5,0.5)` binary64 has `ux=uy=2^-53`. Figure 2(a)'s exceptionally simple seed is `q=(12,12), r=(24,24)`. The exact line is `x=y`, yet the computed sign map has broken zero bands and wrong signs, not slightly shifted straight boundaries. Compare all three pivot choices (Figure 3), and variants retaining extended precision in different intermediates (Figure 4). Three error classes matter separately: nonzero rounded to zero, exact zero perturbed to nonzero, and outright sign inversion ([PDF](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf), §3, Eqs. 1–2, Figures 2–4).

DOCUMENTED mechanism: subtracting a coordinate near 0.5 from coordinates near 12 or 24 loses different low bits. A whole block of neighboring p values therefore shares one rounded difference; multiplication introduces another pattern. This creates discontinuous, interlocking regions of classification. When all relevant coordinates satisfy the same-sign factor-of-two conditions for Sterbenz exact subtraction, their argument rules out sign inversion for this unfused expression but still allows false zero. More precision or another pivot can shrink/change the defects without restoring exactness (§3.1).

**Convex hull invariants.** DOCUMENTED: maintain a CCW circular vertex list; a query sees an edge if its orientation is negative, weakly sees it if nonpositive. Correctness uses (A) outside iff some edge is visible, and (B) visible/weakly visible and invisible chains are consecutive and nonempty. The paper constructs all four fundamental violations: A1 outside but sees none; A2 inside but sees an edge; B1 outside but sees all; B2 outside but sees disconnected edge sets. The appendix's two tangent-search while loops rely on B and can loop forever under B1. Online deletion may instead crash. Later correct predicates do not repair earlier discarded vertices (§4 and appendix).

DOCUMENTED ready-made binary64 B1 fixture, in insertion order (manuscript p. 11):
```text
p1=( 200.0,              49.200000000000003)
p2=( 100.0,              49.600000000000001)
p3=(-233.33333333333334, 50.93333333333333 )
p4=( 166.66666666666669, 49.333333333333336)
```
The naive predicate reports the first triangle CCW, then reports p4 on the visible side of all three edges. The third edge classification is wrong. This fixture is for the paper's binary64 evaluation order, not an asserted F32 reproducer. Source: [PDF](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf), §4.2.

**3D walk-cycle generator.** DOCUMENTED: generate five random points, keep configurations whose Delaunay triangulation consists of three tetrahedra around a common edge, then construct a query approximately on that edge. Rounding can classify it across the next facet in each tetrahedron, creating a three-cycle even when immediate backtracking is disabled. The failure is in `orient3d`-based point location, not necessarily in the in-sphere update. An explicit six-point dataset is on manuscript p. 17. Source: [PDF](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf), §5, Figure 11 and Eq. 3.

## Robustness and guarantees

DOCUMENTED: these are counterexamples, not probabilistic assertions. §4.3 makes the ratio between true and computed hull areas arbitrarily large by moving an omitted point far away. An implementation cannot claim a small geometric error merely because each failed predicate was numerically close to zero. The paper distinguishes exact geometric computation, algorithms proved meaningful with inaccurate predicates, and controlled perturbation that guarantees correct evaluation for perturbed input ([PDF](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf), §§4.3, 7).

DOCUMENTED non-solutions: start with a rounder initial hull; select a different pivot; use extended precision without a proof; compare determinant magnitude to an ad hoc epsilon. Figure 12 uses absolute `epsilon=10^-10`: the zero region widens, but its boundary remains fractured and A1 can persist. Intentional collinearity in CAD is specifically cited as a reason the examples are realistic (§6).

## Parallelism and performance

DOCUMENTED: no throughput/speedup table or GPU measurement. Each sign map contains 65,536 evaluations; the paper reports geometry and failure behavior, not elapsed time. INFERRED: map construction is an ideal fixed-work balanced fork-join workload for Bend/Metal and can compare naive, filtered, exact and SoS outputs from the same immutable bit-pattern input arrays. The sequential hull is a *test harness* for consequences, not a proposed parallel kernel architecture. Source basis: [PDF](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf), §§3–5.

## Known failures, limitations, war stories

- DOCUMENTED: all four hull-invariant failures occur; a visually negligible first defect can become a visibly concave or self-intersecting polygon on later insertion (Figure 10). Choosing a different starting edge can select a different bad result (§4.3).
- DOCUMENTED: higher intermediate precision can change reproducibility and still fail; the appendix explicitly forces 64-bit rather than x87 80-bit intermediates. Evaluation order is therefore part of a fixture, not merely its coordinate list (§3.1, appendix).
- DOCUMENTED availability: [old department companion page](https://www.mpi-inf.mpg.de/departments/d1/ClassroomExamples/) and [old Kettner companion page](https://people.mpi-inf.mpg.de/~kettner/proj/NonRobust/) returned 404 in this pass. The working PDF includes coordinates, pseudocode and C++ but not every original binary fixture or the separate gift-wrapping report. There is no issue tracker attached to the paper.

## Relevance for wonky

INFERRED: adopt the *experimental methodology*, not decimal casting of the binary64 examples. For binary32 use `u_x=2^-24` at 0.5 and adjacent U32 bit patterns, then regenerate adversarial cases. Binary32 has 29 fewer significand bits than binary64, so same-binade spacing is `2^29` larger. **That does not prove that failure-region width/area or failure rate is exactly `2^29` larger**; maps depend on exponent alignment, products, contraction and pivot. Many near-distinct published binary64 vertices collapse into one F32 vertex if simply cast. Source basis: [PDF](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf), §2 and grid construction in §3.1.

INFERRED implementation plan:
1. Decode F32 bit patterns into exact dyadic integers and use the U32 multi-limb determinant as oracle; F32x2 is not itself the oracle. Store exact inputs, target, compiler flags, operation grouping and expected sign.
2. Test all six orient2d permutations: cyclic permutations preserve sign, odd permutations negate it, and genuine zero stays zero in the unperturbed API. A SoS API gets separate expectations.
3. Replay the 256×256 sweep on JS, native C and Metal with their actual F32 semantics; explicitly include FTZ-boundary and overflow cases as *new tests*, not as claims covered by this paper.
4. Lift predicate failures into Boolean-region invariants: closed loops, opposite half-edge orientation, consistent shared-face classification, no disconnected visibility chain, and bounded traversal with a diagnostic on cycles. A traversal cap detects failure but does not repair geometry.
5. Use independent per-cell work and immutable result arrays; exact fallback can be a separate bounded-limb batch for uniform GPU work. F32-only production and no FFI are compatible; no CGAL/LEDA linking is needed.

This primarily strengthens Boolean classification, planar arrangements, triangulation, point location and differential testing. It does not provide SSI, fillet or offset construction formulas. For FDM it explains why a visually plausible mesh is insufficient evidence of valid topology. Source rationale: [PDF](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf), §§4–7.

## Pointers worth porting or studying

- [Primary PDF](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf), §3.1 / Figures 2–4: adjacent-float map, pivot variation, extended-precision variants.
- Same PDF, §4.2 pp. 9–12: A1/A2/B1/B2 explicit coordinate sets and semi-systematic search recipe; §4.3 / Figure 10: amplify local defects into global failures.
- Same PDF, §5 / Figure 11: 3D walk-cycle generator and full dataset; §6 / Figure 12: epsilon-tweaking counterexample.
- Same PDF, appendix pp. 21–22: the exact C++ predicate order and tangent-walking logic needed to reproduce the original failures.

## Verdict: adopt

Adopt the invariant-driven adversarial corpus and neighboring-float sweeps as a numerical acceptance gate. Re-derive F32 inputs and use an exact integer oracle; do not claim the published binary64 fixtures automatically reproduce on Metal. No tests or builds were executed in this research pass.

Sources: [author PDF](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf), [journal DOI](https://dl.acm.org/doi/10.1016/j.comgeo.2007.06.003), [NYU publication record](https://nyuscholars.nyu.edu/en/publications/classroom-examples-of-robustness-problems-in-geometric-computatio-2).
