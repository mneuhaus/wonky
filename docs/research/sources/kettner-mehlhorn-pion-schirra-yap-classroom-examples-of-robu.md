# Kettner, Mehlhorn, Pion, Schirra, Yap: Classroom examples of robustness problems in geometric computations

- Kind: paper, explicit adversarial inputs and educational C++ algorithm. Canonical [journal DOI](https://doi.org/10.1016/j.comgeo.2007.06.003); reachable [author PDF](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf); [ESA 2004 predecessor](https://link.springer.com/chapter/10.1007/978-3-540-30140-0_62); [NYU historical bibliography](https://cs.nyu.edu/~exact/doc/index-old.html).
- Authors: Lutz Kettner, Kurt Mehlhorn, Sylvain Pion, Stefan Schirra, Chee Yap; MPI Informatik, INRIA Sophia Antipolis, University of Magdeburg, NYU.
- Publication: DOCUMENTED [Crossref metadata](https://api.crossref.org/works/10.1016/j.comgeo.2007.06.003): Computational Geometry 40(1), pp. 61–78, May 2008. Preliminary ESA 2004 version, LNCS 3221, pp. 702–713. Read the complete **22-page author manuscript dated 2008-06-17**, not the shorter conference paper. Page references below use that manuscript.
- License: scholarly paper, not a software license. Crossref links Elsevier user-license records, not a permissive license for the appendix/companion code. INFERRED: independently implement the mathematical experiments and cite the work; do not assume available PDF/source means MIT-style redistribution rights.
- Status: historical, no relevant current GitHub repository/release/star/contributor metrics established. Author PDF returned HTTP 200, 206814 bytes. Both advertised companion locations, [ClassroomExamples](https://www.mpi-inf.mpg.de/departments/d1/ClassroomExamples/) and [NonRobust](https://people.mpi-inf.mpg.de/~kettner/proj/NonRobust/), returned 404 (first after redirect) during this pass. PDF contains complete numerical examples and an incremental-hull appendix; downloadable companion programs/binary fixtures were not recovered.

## What it is

DOCUMENTED: an unusually concrete demonstration that tiny predicate errors create **large combinatorial errors and nontermination**, not merely a slightly displaced surface. It studies planar orientation and an incremental 2D convex hull in detail, then a 3D Delaunay **point-location walk**. It explicitly does not exhaustively analyze Delaunay initialization, outside-hull insertion or all in-sphere/update failures. [Paper §§1, 4–5](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).

The transferable testing method is to enumerate the truth conditions required by an algorithm, systematically search nearby floating-point inputs for violations, then retain small witnesses that explain a whole-geometry failure. This is more useful for wonky than another large random-model corpus. INFERRED from the experiments in §§3–5.

## How it works

### Numerical model and orientation experiment

DOCUMENTED ground rules (§2): IEEE binary64 operations, rounded to nearest with fixed tie rule, 53-bit significand, finite exponent range; subnormals excluded from the experiments. Numeric input decimals are chosen to round-trip, and companion binary little-endian fixtures were offered to avoid parser ambiguity. The appendix explicitly forces intermediate results to ordinary double rather than x87 extended precision. [Paper pp. 3–4, 21](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).

DOCUMENTED equations (1)–(2):

`orient(p,q,r) = sign(det([[1,px,py],[1,qx,qy],[1,rx,ry]]))`

`D = (qx-px)*(ry-py) - (qy-py)*(rx-px)`

A direct floating implementation can (a) round a true nonzero sign to zero, (b) perturb exact zero to a nonzero sign, or (c) invert the sign. **All three are different failure classes** and should be counted separately. [Paper §3, p. 4](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).

DOCUMENTED grid construction (§3.1): keep q and r fixed; take `p(X,Y)=(px+X*ux, py+Y*uy)` for X,Y=0…255, where ux and uy are adjacent floating-point spacings near p. Compute a 256×256 sign array. Figure 2(a) uses p=(0.5,0.5), q=(12,12), r=(24,24), ux=uy=2^-53. Exact collinearity is the diagonal; the floating classifications form broken blocks, islands and sign reversals, not a smooth narrow strip. Figure 2(b) uses p=(0.50000000000002531,0.5000000000000171), q=(17.300000000000001,17.300000000000001), r=(24.00000000000005,24.000000000017765). [Paper pp. 4–5](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).

DOCUMENTED mechanism: subtracting coordinates at different exponent scales discards low bits in blocks; subtracting from 12 and from 24 produces differently shifted plateaus. Their product difference then has a fractured zero/sign structure. Changing determinant pivot changes the failures but does not remove them; Figure 3 tests all three pivots. 80-bit extended arithmetic with 64-bit mantissa still has exploitable failures (Figure 4). A Sterbenz-lemma argument explains why a restricted factor-of-two coordinate range eliminates subtraction rounding and limits this particular calculation's error types, **under the paper's arithmetic assumptions**, not a blanket guarantee for all CAD arithmetic. [Paper pp. 6–7](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).

### Algorithm-level contracts and minimal failure categories

DOCUMENTED incremental hull state (§4.1): a circular CCW list of current extreme points; an edge is visible from new point r when orientation(edgeStart,edgeEnd,r)<0, weakly visible when <=0. Locate one visible edge, walk both ways to the two tangent boundaries, replace the visible chain by r. Correctness needs:

- **A:** r is outside the convex hull iff r sees at least one edge.
- **B:** for outside r, weakly visible edges form a nonempty consecutive chain, and non-weakly-visible edges also form a nonempty consecutive chain.

Four local failure classes are constructed: A1 outside point sees none; A2 inside point sees an edge; B1 outside point sees every edge; B2 outside point sees a disconnected set of edges. Effects respectively include dropping true extremes, producing nonconvex hulls, nontermination/destructive traversal, and self-intersection/wrong chain deletion. [Paper pp. 8–12, appendix pp. 21–22](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).

DOCUMENTED compact A1 witness (§4.2), binary64 decimals to preserve exactly for a historical reference lane:

- p1=(7.3000000000000194, 7.3000000000000167)
- p2=(24.000000000000068, 24.000000000000071)
- p3=(24.00000000000005, 24.000000000000053)
- p4=(0.50000000000001621, 0.50000000000001243)

The first three initialize a CCW triangle. Floating orientation says p4 is left of every edge, incorrectly discarding this exterior point. Additional p5=(8,4), p6=(4,9), p7=(15,27), p8=(26,25), p9=(19,11) turn the early numerical mistake into a visually large omitted extreme. The search procedure starts with a very skinny triangle, probes the exterior wedge on a ULP grid, masks candidates that break correct initialization, and selects a witness satisfying the desired inconsistent signs. [Paper pp. 9–10](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).

DOCUMENTED §4.3 strengthens the lesson: the ratio of true to computed hull area can be made arbitrarily large by omitting a far extreme; a tiny earlier concavity can become visibly wrong after later insertions even when those later predicate evaluations are correct. Checking only the final near-degenerate neighborhood misses the causal prefix. [Paper pp. 13–15](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).

### Delaunay walk generator

DOCUMENTED §5: orient3d is the sign of the 4×4 determinant with rows `[1,x,y,z]`. Positively oriented tetrahedra test each facet against query u; if a facet separates the query, walk to its neighbor. Exact Delaunay geometry provides an acyclicity/termination property for an interior query. The remembered incoming tetrahedron prevents immediate two-cell backtracking but does not prevent a three-cell cycle. Generate five random points until their Delaunay triangulation is three tetrahedra around one central edge; approximately interpolate a query near that edge; test for a cycle caused by inconsistent facet signs. A full six-point witness is printed on p. 17. [Paper pp. 15–17](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).

INFERRED direct CAD analogy: classification walks, edge-loop assembly, surface-intersection branch following and cavity traversal can cycle or splice incompatible chains when independently computed signs disagree. Add structural invariants and work budgets even when using exact-filter escalation.

## Robustness and guarantees

DOCUMENTED §6 rejects two fixes: choosing a more round initial hull does not prevent later failures, and replacing exact-zero comparison by an absolute/relative epsilon only widens the zero region while preserving fractured boundaries. Figure 12 explicitly uses epsilon 1e-10. This is **not** a claim that all properly specified tolerant or controlled-perturbation algorithms fail; §7 distinguishes exact computation, algorithms proved correct for inexact predicates, and controlled perturbation with its own guarantee. [Paper pp. 17–19](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).

INFERRED key correction to the task brief: a finite grid sweep **tests conformance; it does not certify a predicate for all inputs**. A filter needs a proved roundoff bound and safe escalation contract. Passing many million cases cannot replace proving that `certain` implies the exact sign under the actual backend's arithmetic, overflow/underflow and contraction behavior. A small undecided fraction is a performance goal, not a correctness requirement; adversarial data may legitimately force exact evaluation almost everywhere.

## Parallelism and performance

DOCUMENTED: the paper's grid is 256×256 (65,536 independent predicate evaluations) and it illustrates binary64 versus extended arithmetic. It does **not** publish GPU timings, Bend results or a meaningful predicate throughput benchmark. The selected hull/walk algorithms are sequential educational examples, not recommended production parallel designs. [Paper §§3–5](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).

INFERRED: grid cells are excellent uniform GPU work; use a balanced tree over integer cell IDs to generate coordinates, compare signs and reduce counters. Keep a fixed kernel per predicate/precision tier; queue uncertain cases into a second fixed-width exact pass instead of mixing variable-depth exact fallback into every GPU call tree. If exact limb width is not bounded by the input-domain specification, return a capacity failure rather than truncating.

## Known failures, limitations, war stories

DOCUMENTED primary failures are fully worked paper examples, not anecdotal bug tickets. They cover lost extremes, interior-point insertion, disconnected visibility, non-simple/nonconvex hulls, unbounded area error, crashes/nontermination and three-tetrahedron point-location cycles. No modern implementation was tested here. [Paper §§4–5](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/classroomExamplesNonrobustness.pdf).

The companion source/data URLs are currently unavailable as checked above. The 2008 program assumes binary64 evaluation order without silently extended intermediates; directly casting its fixtures to F32 merges many distinct input coordinates and does not reproduce the same experiment. Port the **generator and invariant checks**, not only the printed decimals.

## Relevance for wonky

INFERRED concrete predicate-conformance harness:

1. **Specify represented inputs.** Store F32 raw U32 bit patterns. For F32x2 store both hi/lo patterns and define the exact reference input as their dyadic sum; it is not the original unrounded decimal or ideal analytic intersection. Reject NaN/Inf unless an explicit input-rejection test.
2. **Independent exact oracle.** Decode each finite F32 into sign, integer significand and power-of-two exponent; align exponents, compute determinant products/sums in signed multi-limb U32 integers. Implement 32×32 multiplication from safe smaller partial products/carries, not forbidden U64. For F32x2 combine hi/lo dyadics before the determinant. Keep oracle implementation independent of the tested filter's expansion routines to reduce correlated bugs.
3. **F32-native ULP sweeps.** Start with the paper's easy geometry p≈(0.5,0.5), q=(12,12), r=(24,24), but enumerate F32 neighbors using ordered float bit patterns (the forward step at 0.5 is 2^-24, not 2^-53). Regenerate skinny-triangle and exponent-gap examples at each target precision. Handle negative numbers, signed zero and binade boundaries explicitly instead of assuming constant ULP everywhere.
4. **Record outcomes:** exact sign, fast sign, certain/uncertain, filter error bound, fallback tier, overflow/underflow/refusal, backend and witness input bits. Assert every certain result equals the exact sign, including claimed zero. Count false-zero, false-nonzero and opposite-sign separately; false certainty must be zero in tested cases.
5. **Metamorphic properties:** orientation changes sign under odd permutations and preserves it under cyclic permutations; repeated input points give exact zero. Translation/scaling tests must preserve the represented geometry exactly (e.g. verified power-of-two scaling without over/underflow), otherwise recompute the exact oracle for transformed inputs instead of asserting an invalid invariance.
6. **Backend controls:** test JS's intentional F32 rounding versus native C/Metal, FMA contraction settings, subnormal/flush-to-zero behavior and intermediate range. The paper does not cover GPU semantics; derive bounds for the operations actually emitted, not idealized algebra. F32x2 does not buy binary64's exponent range or universal exactness.
7. **Whole-algorithm invariants:** instrument convex/arrangement chain updates, point-in-cell walks and Boolean classification; assert coherent visibility/inside relations and bounded traversal. Preserve earliest failing feature/predicate plus a minimized geometry witness. Refuse inconsistent/uncertain classification rather than repairing it with an arbitrary epsilon.
8. **Scope boundary:** exact predicates on rounded coordinates do not make SSI constructions, curved intersections, fillets or offsets exact. Connect predicate certificates to construction provenance and explicit geometric error bounds. This paper directly improves Boolean/arrangement/sketch triangulation testing; it does not supply a general B-rep validation algorithm or FDM fit tolerance.

## Pointers worth porting or studying

Author manuscript §2 for reproducibility, equations (1)–(3), Figures 2–4 for pivot/precision grids, Properties A/B and failures A1/A2/B1/B2 in §4, §5.1 and Figure 11 for a three-tetrahedron loop generator, §6/Figure 12 for epsilon non-solutions, appendix for exact control flow needed to reproduce historical failures. Local PDF `<repo>/tmp/research/pdf/classroom-examples-robustness-2008.pdf`.

## Verdict: adopt

Adopt the ULP-neighborhood stress methodology, exact-oracle comparisons and invariant-driven shrinking immediately as **test design**, independently reimplemented for F32/U32/F32x2. Do not adopt the intentionally unreliable hull code, claim finite testing proves universal correctness, or use its binary64 examples as unmodified F32 golden cases. Open work is implementation and bounded-domain proof of wonky's actual filters, not further high-level reading.

