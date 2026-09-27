# CGAL 2D Circular Geometry Kernel (`Circular_kernel_2`) and Emiris, Kakargias, Pion, Teillaud, Tsigaridas 2004, "Towards an open curved kernel"

- Kind: library package + founding paper.
  - Manual: [CGAL "2D Circular Geometry Kernel"](https://doc.cgal.org/latest/Circular_kernel_2/index.html).
  - Code: [CGAL/cgal Circular_kernel_2](https://github.com/CGAL/cgal/tree/main/Circular_kernel_2) and [Algebraic_kernel_for_circles](https://github.com/CGAL/cgal/tree/main/Algebraic_kernel_for_circles). Local: `tmp/research/cgal-arrangements/Circular_kernel_2`, `.../Algebraic_kernel_for_circles`.
  - Paper: SoCG 2004, pp. 438-446 ([HAL inria-00344433](https://inria.hal.science/inria-00344433); local `tmp/research/pdf/emiris-2004-open-curved-kernel.pdf`, pp. 2-14 read).
- Authors: package by Pedro Machado Manhães de Castro, Sylvain Pion, Monique Teillaud (manual header); paper by I. Z. Emiris, A. Kakargias, S. Pion, M. Teillaud, E. P. Tsigaridas (INRIA, Univ. Athens).
- License: package `GPL (v3 or later)` (`package_info/Circular_kernel_2/license.txt`), dual commercial via GeometryFactory. Same implications as the [arrangement note](cgal-arrangement-2-circle-segment-traits-one-root-numbers.md): ideas yes, code no.
- Status: in CGAL since 3.2/3.3 (INFERRED from the manual's history: prototype 2003, efficiency work 2006, additions 2008). Last commit touching the package 2026-01-15 (spelling). Maintenance mode.

## What it is

A CGAL kernel extension that adds `Circular_arc_2`, `Line_arc_2` and `Circular_arc_point_2` (points that are endpoints or intersections of arcs) with predicates and constructions sufficient to build arrangements of circular arcs and segments. It is parameterized by a linear kernel and an **algebraic kernel** (`AlgebraicKernelForCircles`) that owns all number handling. Three traits classes plug it into the arrangement package: `Arr_circular_arc_traits_2`, `Arr_line_arc_traits_2`, `Arr_circular_line_arc_traits_2` (manual; code listing).

## How it works

- **Separation of concerns (DOCUMENTED, manual "Software Design").** Geometry (arcs, splitting, `compare_y_to_right`, `has_on`) is written against an algebraic kernel concept with `RootOf_d` numbers (d ≤ 4 in the paper), `solve(Pol_2_2, Pol_2_2)`, `x_critical_points`, `sign_at`.
- **Points keep their defining curves** (paper §3.1): an endpoint is stored as the two intersecting curves *plus* its algebraic coordinates. Equality can first be filtered by comparing the defining curves; the coordinates are only compared when the curves differ. This is a cheap combinatorial filter.
- **Degree-2 numbers.** `Root_for_circles_2_2` holds `Root_of_2` x and y (`Root_for_circles_2_2.h` l.33-60). Comparisons are coordinate-wise `compare(r1.x(), r2.x())` (`internal_functions_comparison_root_for_circles_2_2.h`), delegated to `Sqrt_extension`, which caches a double interval and decides by filtered repeated squaring (`Sqrt_extension_type.h` l.282-350).
- **Degree ≤ 4 (paper §5.1, conics).** `Root_of` = polynomial + index + rational isolating interval. Rational isolating points come from Lemma 1 (roots of `A = B·P' + C·P` separate adjacent roots), via static Sturm sequences. Comparing two roots of two quartics needs algebraic degree 8 to 13 (Proposition 1). `solve` builds the resultants R_x, R_y (degree 4) and a grid of ≤ 4×4 boxes, then `sign_at` via bivariate Sturm-Habicht sequences (last polynomial degree 8), with Maple-generated straight-line code (1/3 of the operations).
- **Integer lifting (§5.2):** multiply quadratic equations through by their denominators and work on multi-precision integers instead of rationals, which "prevents the explosion of these numbers".
- **`Filtered_bbox_circular_kernel_2`:** a bounding-box layer that answers many predicates from double boxes before the algebraic kernel is called (file listing; the manual's todo list admits memory leaks in it: "memory leaks in Filtered_bbox_circular_kernel_2").

## Robustness and guarantees

- Exact if the algebraic kernel is exact; the paper handles "all inputs, including degeneracies" for conics in SYNAPS (abstract).
- The paper's traits still evaluated one predicate approximately: `curves_compare_y_at_x_to_right` when p is not a common point (footnote 7, p.10). So "exact" had a documented hole in 2004. Whether the CGAL release closed it: not checked.

## Parallelism and performance

Table 1 (paper p.13; P4 2.5 GHz, g++ 3.3.2, CGAL 3.0; seconds, sweep-line arrangement; 16-bit random inputs):

| input | arcs | vertices | best CK time | CGAL conic traits + `leda_real` |
|---|---:|---:|---:|---:|
| random full circles (RFC) | 150 | 10,340 | 39 s (`Root_of_2<MP_Float>` or `mpz`) | 56.8 s |
| RFC | 500 | 92,664 | 372 s | 2,689 s |
| grid circles (G) | 500 | 1,000 | 5 s | 5.12 s |
| random non-monotone arcs (RNMA) | 500 | 24,819 | 86 s | 395 s |

- `CORE::Expr` and `Lazy` configurations ran out of memory on the large inputs ("-").
- Roughly **4 ms per vertex** for exact circle arrangements on 2004 hardware (INFERRED from 372 s / 92,664 vertices).
- The CGAL package ships a DXF benchmark (`benchmark/README_benchmark_CK2.txt`: `cad_l1.dxf`, `mask1.dxf`, `painttrack.dxf`, ...), i.e. real CAD drawings were a design target.

## Known failures, limitations, war stories

- Manual todo list inside the shipped doc (`Circular_kernel_2.txt`): "echecs de filtres", "memory leaks in Filtered_bbox_circular_kernel_2", IO routines not recomputing bboxes. The package carries visible unfinished business.
- Two parallel traits families (`Arr_circle_segment_traits_2` vs `Arr_circular_line_arc_traits_2`) with an unresolved manual todo "What is the difference and what are possible conditions under which I should choose one over the other" (Arrangement manual l.4715-4725). Duplicate designs are a maintenance cost.

## Relevance for wonky

- **Design lessons (INFERRED):**
  1. Keep the *defining curves* on every constructed point (provenance and a free equality filter). That matches wonky's topology identity and provenance goals.
  2. Separate the algebraic kernel from arrangement code, so that the F32x2 filter and U32-limb exact layers can be swapped and tested independently, including against a BigInt oracle.
  3. Lift rationals to integers by clearing denominators once.
- **Performance sanity:** sketches have 10-1000 curves, not 10^5 vertices. Even the 2004 exact numbers (ms per vertex) would be acceptable; a filtered, batched Bend version should be far below interactive thresholds (INFERRED).
- **Conics:** skEllipse appears in 24 corpus FS files. Ellipse/ellipse vertices need degree-4 roots (8-13 degree predicates per Proposition 1). That is a much larger exact core than circles; defer or handle ellipses separately (see [conic/Bezier note](cgal-arr-conic-traits-and-bezier-traits-hanniel-wein.md)).
- **Bend fit:** straight-line predicate programs and isolating-interval tables are fine. SYNAPS-style dynamic Sturm sequences are not uniform work.

## Pointers worth porting or studying

- Paper §3.2 (primitives `make_x_monotone`, `nearest_intersection_to_right`, `compare_y_to_right`, `compare_y_at_x`) as the minimal predicate list for a sweep, and §4 for the algebraic-kernel concept.
- Paper §5.1 Lemma 1 and Proposition 1 (rational isolating points for degree ≤ 4).
- `Algebraic_kernel_for_circles/include/CGAL/Root_for_circles_2_2.h`, `internal_functions_on_roots_and_polynomials_2_2.h` (solve for two circles).

## Verdict: **learn-from**

The architecture (algebraic kernel concept, points remember their curves, integer lifting) is worth copying as design. The implementation is GPL, partly unfinished, sweep-based and slower than the specialized one-root traits. For wonky, [Devillers et al.](devillers-fronville-mourrain-teillaud-2002-circle-arc-predicates.md) plus the [one-root traits](cgal-arrangement-2-circle-segment-traits-one-root-numbers.md) are the better starting points.
