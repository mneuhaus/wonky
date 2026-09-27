# CGAL `Boolean_set_operations_2` with `Gps_circle_segment_traits_2`, and `Minkowski_sum_2` offsets (Wein 2007)

- Kind: library packages + paper.
  - Manuals: [2D Regularized Boolean Set-Operations](https://doc.cgal.org/latest/Boolean_set_operations_2/index.html) and [2D Minkowski Sums, §"Offsetting a Polygon"](https://doc.cgal.org/latest/Minkowski_sum_2/index.html#mink_secoffset).
  - Code: [Boolean_set_operations_2](https://github.com/CGAL/cgal/tree/main/Boolean_set_operations_2), [Minkowski_sum_2](https://github.com/CGAL/cgal/tree/main/Minkowski_sum_2). Local `tmp/research/cgal-arrangements/`: `Minkowski_sum_2/include/CGAL/Minkowski_sum_2/Approx_offset_base_2.h`, `Exact_offset_base_2.h`, `Offset_conv_2.h`; manuals `Boolean_set_operations_2.txt` l.1-130, 479-560, 715-770 and `Minkowski_sum_2.txt` l.383-640 read.
  - Paper: R. Wein, "Exact and approximate construction of offset polygons", *Computer-Aided Design* 39(6):518-527, 2007 ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0010448507000279), paywalled, not read). Claims below come from the CGAL manual and code that implement it.
- Authors: Ron Wein, Efi Fogel, Baruch Zukerman, Ophir Setter, Guy Zucker and others (Tel-Aviv University), 2006-2026.
- License: GPL-3.0-or-later OR commercial (CGAL). Ideas only.
- Status: shipped, maintained. Open [#9638](https://github.com/CGAL/cgal/issues/9638) (2026-09-08: `General_polygon_set_2` copy keeps pointing at the source's traits) shows ongoing maintenance.

## What it is

- **Booleans:** regularized union, intersection, difference, symmetric difference and complement of "general polygons" whose edges are x-monotone curves of any arrangement traits. With `Gps_circle_segment_traits_2` the edges are line segments and circular arcs, computed exactly with rational arithmetic plus one-root numbers.
- **Offsets:** `offset_polygon_2(P, r, conic_traits)` (exact, conic arcs via CORE); `approximated_offset_2(P, r, ε)` (circle-segment output with a guaranteed error bound ε); `inset_polygon_2` and `approximated_inset_2` for inner offsets.

## How it works

- **Polygon model (DOCUMENTED, Boolean manual l.66-130).** Operands are *relatively simple* polygons: edges disjoint in their interiors, vertex degree > 2 allowed, and an outer boundary traversable without crossing a curve. Outer boundaries run counter-clockwise, holes clockwise. Results are regularized closed sets (lower-dimensional parts removed).
- **Engine:** operands are overlaid in an arrangement; faces are labelled in/out per operand; the result is extracted by the label rule. Aggregated `join`/`intersection` over a range build one arrangement with a single sweep. The manual also describes, as the alternative, **divide-and-conquer union** (bisect, recurse, merge) and incremental union (l.479-510).
- **Exact offset of a polygon (Minkowski manual l.415-448).** Convolution cycle of P with the disc: shift each edge outward by r; join consecutive shifted edges by arcs of radius r centered at the vertices (angle 180° − ∠ at convex vertices, 180° + ∠ at reflex vertices). Then build the arrangement of the cycle, compute **winding numbers** of its faces and keep the faces with nonzero winding. The inset uses the clockwise traversal.
- **Why exact offsets leave the rationals (DOCUMENTED, l.450-480).** The offset line of `Ax + By + C = 0` is `Ax + By + C ± r·√(A² + B²) = 0`, generally irrational. (The manual's formula prints `√(A/B+1)`, a typo.) The exact offset therefore needs the conic traits (the line pair is a degenerate conic), i.e. CORE algebraic numbers, and is "considerably slower".
- **Approximate offset with a guaranteed bound (DOCUMENTED, l.496-530; code `Approx_offset_base_2.h` l.73-89, 404-450).**
  - Pick rational points o'1, o'2 on the two vertex circles, bracketing the exact tangent direction φ.
  - Rational points come from a rational `t ≈ tan(φ/2)`, via `sin φ = 2t/(1+t²)`, `cos φ = (1−t²)/(1+t²)`. The code rounds with denominator `⌊1/√ε⌋`.
  - Intersect the two rational tangent lines at q'; the two rational segments o'1q' and q'o'2 replace the offset edge.
  - The distance of q' from the exact edge is ≤ ε. The output stays inside the fast circle-segment traits, and the result lies *outside* the exact offset.

## Robustness and guarantees

- Booleans: exact with an exact-constructions kernel. With inexact kernels, "(nearly) degenerate configurations may result in abnormal termination of the program or even incorrect results" (manual l.715-725).
- Approximate offset: one-sided Hausdorff bound ε per offset edge, by construction (manual).
- Operand validity (orientation, relative simplicity) is a **precondition**, checked only by an explicit validity call. Invalid input is undefined behaviour in release builds (INFERRED from the manual's precondition wording and #7226 below).

## Parallelism and performance

- No measured numbers in the manuals; qualitative only ("exact offset ... considerably slower").
- Divide-and-conquer union is documented as an option, not parallelized (INFERRED from the code: no TBB paths in these packages).

## Known failures, limitations, war stories

- [#7226](https://github.com/CGAL/cgal/issues/7226) (open since 2023): `approximated_inset_2` asserts in the sweep (`sl_iter != m_statusLine.end()`) on user polygons; segfault with `NDEBUG`. G. Bathgate: "when assertions are off and the assertion isn't met, the behaviour is undefined".
- [#9062](https://github.com/CGAL/cgal/issues/9062): `approximated_offset_2` of a two-point polygon throws `Uncertain_conversion_exception` under WebAssembly (rounding-mode-dependent interval filters), but works natively.
- [#8468](https://github.com/CGAL/cgal/issues/8468): partially overlapping circular-arc polycurves broke insertion (fixed 2024).
- [#371](https://github.com/CGAL/cgal/issues/371) (open since 2015): `offset_polygon_2()` (Minkowski) versus `create_offset_polygons_2()` (straight skeleton, mitred) naming confusion. Two different offset semantics coexist in one library.

## Relevance for wonky

- **Arc-preserving offset semantics (INFERRED, important).**
  - Offsetting a line/arc profile by r keeps arcs as circles (same center, radius R ± r) and lines as lines. The *exact* offset leaves the one-root field twice:
    1. line offsets carry `√(A² + B²)`;
    2. a three-point arc with rational R² but irrational R offsets to radius `R ± r`, so the new squared radius `R² ± 2rR + r²` is irrational.
  - With **snapped** input, a rational-direction trick keeps everything rational within an explicit ε. CGAL's tan-half-angle construction is one such trick; another is to snap the offset line's constant to the grid, with a reported deviation ≤ half a grid step.
  - For FDM, an ε of 1e-5 mm (FS `zeroLength`) is 4-5 orders below printer resolution. A declared ε-approximate offset is honest; claiming exactness is not.
- **Semantics choice:** the Minkowski (round-join) offset is what FDM compensation and clearance need. The straight-skeleton (mitred) offset is what CAD sketch-offset tools sometimes produce. Name them differently from day one (lesson of #371).
- **Winding-number extraction** after building the arrangement of the raw offset cycle is the robust way to handle self-intersecting raw offsets. It works on the same face structure as the sketch-region arrangement, so one engine serves sketch regions, 2D Booleans and offsets (INFERRED).
- **Bend fit (INFERRED).** Convolution-cycle construction is a pure per-edge map. Arrangement + winding numbers reuse the batch arrangement. Union by divide-and-conquer is balanced fork-join. The sequential sweep is not needed.
- **Booleans for sketch regions:** Onshape regions are *not* Booleans of loops; they are faces of the arrangement ([Onshape note](onshape-sketch-regions-sksolve-qsketchregion-semantics.md)). Booleans are needed for text (glyph union), FDM layers and offset cleanup, and the arrangement face labels give them for free.

## Pointers worth porting or studying

- Minkowski manual l.415-448: convolution cycle + winding numbers (the whole algorithm in two paragraphs).
- `Approx_offset_base_2.h` l.404-450: tan-half-angle rational points and tangent-line construction with error bound `2·d·ε·(d − |dy|)/|dx|` (l.262-275).
- Boolean manual l.66-130: relatively simple polygons and orientation rules. A precise validity contract worth copying into wonky's refusal messages.

## Verdict: **adapt**

Adopt the offset algorithm (convolution cycle, arrangement, winding-number filter) and the one-sided ε-approximation principle with rational tangent points. Adopt the "relatively simple, oriented" operand contract. Skip the conic-traits exact offset (CORE) and the sequential sweep; reuse wonky's batch arrangement for extraction.
