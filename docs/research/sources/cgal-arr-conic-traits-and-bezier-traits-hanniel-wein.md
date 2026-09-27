# CGAL `Arr_conic_traits_2` and `Arr_Bezier_curve_traits_2` (Hanniel & Wein, arrangements of Bézier curves)

- Kind: library traits + paper.
  - Manual: [CGAL 2D Arrangements, "A Traits Class for Conic Arcs" and "A Traits Class for Planar Bézier Curves"](https://doc.cgal.org/latest/Arrangement_on_surface_2/index.html#arr_sssectr_conic).
  - Code: [Arrangement_on_surface_2/include/CGAL](https://github.com/CGAL/cgal/tree/main/Arrangement_on_surface_2/include/CGAL). Local `tmp/research/cgal-arrangements/`: `Arr_conic_traits_2.h` (4,222 lines), `Arr_geometry_traits/Conic_arc_2.h`, `Conic_x_monotone_arc_2.h`, `Conic_intersections_2.h`, `Arr_Bezier_curve_traits_2.h`, `Bezier_cache.h`, `Bezier_bounding_rational_traits.h`, `Bezier_x_monotone_2.h`; manual l.4745-4860 and l.5098-5175 read.
  - Paper: I. Hanniel, R. Wein, "An exact, complete and efficient computation of arrangements of Bézier curves", SPM 2007 and [IEEE T-ASE (IEEE Xplore 4982559)](https://ieeexplore.ieee.org/document/4982559/). PDF not obtained; claims about it are from CGAL code and manual only.
- Authors: Ron Wein (conics, Bézier), Iddo Hanniel (Bézier), Efi Fogel (maintainer; conic traits rewritten into the functor style in recent releases, INFERRED from its 4,222-line single header).
- License: `GPL-3.0-or-later OR LicenseRef-Commercial` (same as the arrangement package). Ideas only.
- Status: shipped in CGAL 6.2.1 (2026-09-04). Open issues listed below.

## What it is

Two exact geometry traits for `Arrangement_2`:

- **Conic arcs:** bounded arcs of `r x² + s y² + t xy + u x + v y + w = 0` with rational coefficients: full ellipses, or `⟨κ, p_s, p_t, orientation⟩`. Special constructors: three-point circular arc, five-point conic, and arcs whose endpoints are given *approximately* plus two auxiliary conics that define them exactly (manual l.4855-4860).
- **Bézier curves** of arbitrary degree with rational control points, including self-intersecting ones; the traits also model `AosDirectionalXMonotoneTraits_2`, so 2D Booleans on Bézier polygons work (manual l.5171-5175).

## How it works

- **Conics (DOCUMENTED, manual l.4765-4775; code `Conic_intersections_2.h`).**
  - Intersections of two rational conics have algebraic coordinates of **degree 4**; vertical-tangency split points have degree 2. Input endpoints may therefore also be algebraic.
  - `compute_resultant_roots` eliminates y from the two conics to a degree ≤ 4 integer polynomial in x and solves it with the `Nt_traits` (CORE: `Integer`, `Rational`, `Algebraic`, root extraction). Line/conic reduces to a quadratic.
  - The recommended number type is `CORE_algebraic_number_traits` (exact, lazy, separation-bound based).
- **Bézier (DOCUMENTED, manual l.5145-5160; code).**
  - Intersections are parameter pairs (s, t) with `X1(s) = X2(t)`, `Y1(s) = Y2(t)`. `Bezier_cache::_compute_resultant` eliminates one parameter; an identically zero resultant means overlap (`Bezier_cache.h` l.616-626).
  - **Geometric filtering first:** `Bezier_bounding_rational_traits` subdivides curves by de Casteljau (`de_Casteljau_2.h`) with rational control points and bounds each point by a parameter interval `[t_min, t_max]` plus the control polygon whose hull contains it (`_Bez_point_bound`, types `RATIONAL_PT`, `VERTICAL_TANGENCY_PT`, `INTERSECTION_PT`). Only unresolved cases go to exact resultants. "Most arrangement vertices are therefore associated with approximated points. You cannot access the coordinates of such points as algebraic numbers."
  - Vertical tangencies (roots of X'(t)) and intersections are cached per curve and per curve pair (`Bezier_cache` maps).

## Robustness and guarantees

- EGC: exact with CORE, complete in principle (the paper title claims "exact, complete").
- Practice disagrees in corners (issues below). The Bézier filter decides subdivision overlap with angular-span tests that fail on degenerate linear or collinear input.

## Parallelism and performance

- Sequential; CORE numbers are heap-allocated expression DAGs. No measured numbers in the manual.
- Users call the conic traits slow for plain intersection work ([#9281](https://github.com/CGAL/cgal/issues/9281), 2026). Fogel's answer: exact number types are "a deliberate architectural necessity" of EGC; he suggests `Arr_algebraic_segment_traits_2` or a hand-made inexact arithmetic kernel.
- [#4818](https://github.com/CGAL/cgal/issues/4818): lower envelope of Bézier curves taken from an arrangement took ~10 min (debug) versus 0.069 s for the same curves made x-monotone directly (closed).

## Known failures, limitations, war stories

- [#4951](https://github.com/CGAL/cgal/issues/4951) (open since 2020): a self-intersecting cubic `(0,0) (−100,100) (100,100) (−50,0)` yields V=4, E=3, F=1 instead of 5 vertices and 2 faces. **The self-intersection is silently missed.**
- [#9176](https://github.com/CGAL/cgal/issues/9176) (open, 2025-12): inserting a cubic with a double-valued control point (−0.1996, 0.2003) triggers an assertion in debug and a **segfault in release**.
- [#8849](https://github.com/CGAL/cgal/issues/8849) (open, 2025): two collinear, connected *linear* Bézier segments produce an invalid arrangement ("Found two vertices with the same geometric point"). Fogel confirms that `Bezier_bounding_rational_traits::_angular_spans_overlap()` fails when all four directions coincide.
- Takeaway (INFERRED): even in the flagship exact library, the **filter layer** (not the exact core) is where Bézier arrangements break, on exactly the degenerate inputs CAD produces (collinear pieces, cusps, loops).

## Relevance for wonky

- **Corpus demand (MEASURED this session, `~/Workspace/cad`, 606 `.fs`):**
  - `skEllipse` in 24 files; `skSpline`, `skBezier`, `skConicSegment` and `skEllipticalArc` in 0 files.
  - `skText` in 174 files. Its glyphs are integer-lattice **quadratic Béziers**, per the [skText note](onshape-sktext-layout-measured-from-step-export.md). Glyph pairs can intersect (`KA`, `fT` ...), so text regions need a real arrangement with lens faces.
- **Quadratic Béziers are parabolic arcs, i.e. conics** with rational implicit coefficients (INFERRED; standard implicitization of a degree-2 polynomial curve). With integer control points below 2^17 half-units, the implicit coefficients stay small: degree ≤ 4 in the control points, well under 2 limbs. A quad/quad intersection is a degree-4 resultant.
  - So the exact text arrangement is the *conic* problem restricted to parabolas, not the general Bézier problem.
  - A cheaper alternative: Onshape itself replaces near-circular quads by arcs within ~1 µm (skText note). Text regions do not need exactness beyond the stated tolerance; an arc-spline or fine-polyline approximation with certified deviation is legitimate if declared.
- **Ellipses (24 files):** ellipse/line needs degree 2 (one-root numbers suffice when the conic coefficients are rational). Ellipse/circle and ellipse/ellipse need degree 4, with predicates of degree 8-13 per [Emiris et al.](cgal-2d-circular-kernel-emiris-et-al-2004.md). Pragmatic path: support ellipse/line exactly and refuse or approximate ellipse/curve crossings with an explicit, reported tolerance.
- **Bend fit (INFERRED).** Resultants of fixed degree (≤ 4) with fixed-size limbs are straight-line code, fine. Arbitrary-degree Bézier resultants, CORE lazy DAGs and adaptive subdivision are not uniform work. Keep them out of the GPU path; if ever needed, run them on the native CPU path with explicit refusal on unresolved cases.

## Pointers worth porting or studying

- `Conic_intersections_2.h` `compute_resultant_roots` (degree ≤ 4 resultant of two conics in integer coefficients): a compact reference for a fixed-degree exact kernel.
- `Bezier_bounding_rational_traits.h` `_Bez_point_bound` and the subdivision filter: a model of "approximate first, exact on demand". Also an example of where filters fail (`_angular_spans_overlap`).
- Manual l.4855-4860: endpoints specified approximately plus exact auxiliary conics. This is the right interface for "user gives decimals, kernel keeps exact definitions".

## Verdict: **learn-from** (conics restricted to parabolas and ellipse/line: **adapt** ideas)

The general conic/Bézier machinery depends on CORE-style algebraic numbers and adaptive subdivision. Its open issues show the filter layer failing on CAD-typical degeneracies. For wonky, the useful parts are the fixed-degree conic resultant (for glyph quads and ellipse/line) and the exact-auxiliary-curve endpoint interface. General Bézier arrangements are out of scope for the corpus.
