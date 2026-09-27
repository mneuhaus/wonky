# CGAL 2D Arrangements with `Arr_circle_segment_traits_2` (one-root numbers)

- Kind: library package (C++ header-only) + manual. Canonical: [CGAL manual, 2D Arrangements, "A Traits Class for Circular Arcs and Line Segments"](https://doc.cgal.org/latest/Arrangement_on_surface_2/index.html#arr_sssectr_circ_seg); code [github.com/CGAL/cgal/tree/main/Arrangement_on_surface_2](https://github.com/CGAL/cgal/tree/main/Arrangement_on_surface_2). Local sparse clone: `tmp/research/cgal-arrangements/` (commit `4abd208`, 2026-09-21).
- Files read: `Arrangement_on_surface_2/include/CGAL/Arr_circle_segment_traits_2.h` (822 lines), `Arr_geometry_traits/Circle_segment_2.h` (1969), `Arr_geometry_traits/One_root_number.h` (528), manual `doc/Arrangement_on_surface_2/Arrangement_on_surface_2.txt` l.4530-4760; `Number_types/include/CGAL/Sqrt_extension/Sqrt_extension_type.h` (filtered `compare`).
- Authors: Ron Wein, Baruch Zukerman (circle-segment traits, one-root numbers; header copyright Tel-Aviv University 2006-2011); package lead Efi Fogel. Book: Fogel, Halperin, Wein, *CGAL Arrangements and Their Applications*, Springer 2012 ([DOI 10.1007/978-3-642-17283-0](https://doi.org/10.1007/978-3-642-17283-0); not read, metadata only).
- License: header SPDX `GPL-3.0-or-later OR LicenseRef-Commercial` (DOCUMENTED, `One_root_number.h` l.8). Copying or translating code into wonky would make wonky GPL (or require a GeometryFactory commercial licence). Algorithms, equations and representation ideas from the manual and papers are free to reimplement (INFERRED; ideas are not copyrightable, clean-room re-derivation advised).
- Status: CGAL repo 6,055 stars, pushed 2026-09-21, latest release v6.2.1 (2026-09-04), 691 open issues (gh api, 2026-09-24). Last change to `Circle_segment_2.h`: 2025-12-09 ("Added Do_intersect functor"). Mature; in CGAL since 3.2 (2006, INFERRED from copyright years).

## What it is

A geometry-traits model for CGAL's generic `Arrangement_2` (a DCEL of vertices, halfedges, faces with outer and inner CCBs) that handles **line segments, circular arcs and full circles exactly**, without general algebraic numbers. Its central idea: if every circle is *rational* (center and **squared** radius rational) and every line has rational coefficients, then every vertex of the arrangement has coordinates of the form `α + β√γ` with rational α, β, γ (a *one-root* or *square-root-extension* number), and both coordinates of one point share the same γ (DOCUMENTED, manual l.4553-4592).

## How it works

- **Numbers.** `_One_root_number<NT>` stores `m_alpha, m_beta, m_gamma` plus `m_is_rational` (`One_root_number.h` l.42-47). Sign (l.179-206): if α and β have the same sign, that sign; else compare α² with β²γ. Comparison of two numbers with *different* extensions (l.412-525): first an optional double-interval filter (`to_interval`), then exact: sign of `a1−a2` versus sign of `b2√c2 − b1√c1`, and when these agree, square once more and take the sign of the one-root number `((a1−a2)² − (b1²c1 + b2²c2)) + 2·b1·b2·√(c1c2)`. So a comparison is at most two squarings deep: **degree 4 in the one-root coefficients**, which themselves are rational functions of the input (INFERRED from the code).
- **Circle/circle intersection** (`Circle_segment_2.h` l.1737-1795): with `d² = |c2−c1|²`, `Δ = r1² − r2²`, the discriminant is `disc = 2d²(r1² + r2²) − (Δ² + d⁴)`; `x = x_base ± (dy/(2d²))·√disc`, `y = y_base ∓ (dx/(2d²))·√disc`, with `x_base = ((x1+x2) + dx·Δ/d²)/2`. `disc = 0` gives a tangency point with multiplicity 2 and rational coordinates. Line/circle and line/line are analogous (`_circ_line_intersect`, `_lines_intersect` l.1592).
- **Curves.** `Curve_2` is a segment, a circle, or an arc given by supporting circle + two endpoints (which may be one-root points) + orientation, or by three rational points (then circle center and r² are rational) (manual l.4662-4700). `Make_x_monotone_2` splits arcs at the vertical tangency points `x0 ± √(r²)` (`Arr_circle_segment_traits_2.h` l.575-636); a zero radius becomes an isolated point.
- **Overlaps.** Two x-monotone pieces on the *same supporting curve* are tested by `_compute_overlap` and reported as one overlapping sub-curve (l.943-969); otherwise intersections of the supporting curves are computed once and filtered by `_is_between_endpoints` on both arcs (l.1013-1019).
- **Intersection cache.** Each input curve gets an atomic serial index; intersection lists are memoized per `(min id, max id)` pair in a `std::map` (l.64-86, `Circle_segment_2.h` l.975-1008). Off by default (`use_intersection_caching = false`).
- **Arrangement construction** (generic `Arrangement_2`): aggregated insertion runs a Bentley-Ottmann style surface sweep (`Surface_sweep_2/`), incremental insertion walks the zone of each curve. Faces carry an outer CCB and any number of inner CCBs (holes) and isolated vertices: the **exact structure of Onshape's sketch regions** (a region = bounded face; holes = inner CCBs; INFERRED mapping).
- The traits models `AosTraits_2` and `AosDirectionalXMonotoneTraits_2` (so it drives `Boolean_set_operations_2`), but **not** `AosLandmarkTraits_2` (no landmark point location), DOCUMENTED manual l.4594-4604.

## Robustness and guarantees

- Exact Geometric Computation: every predicate is decided exactly given a rational kernel (`Exact_predicates_exact_constructions_kernel` recommended, manual l.4604); the arrangement is combinatorially correct for the **given rational input**, including tangencies (multiplicity 2), overlaps and triple points (manual Fig. "circles": vertex (4,3) where three circles meet has six incident edges).
- Nothing is proven about fidelity to the *intended* geometry: input that is almost tangent in the designer's mind but not exactly tangent in rationals yields two intersection points and a sliver face (INFERRED; standard EGC consequence).
- Input restrictions: circles must have rational center and rational r². A circle with irrational radius but rational r² is fine; an *offset* of such a circle (radius √(r²)+d) is not (INFERRED, see [the Minkowski offset note](cgal-boolean-set-operations-2-and-minkowski-offset-wein-2007.md)).

## Parallelism and performance

- No parallel code paths in the traits; the sweep is sequential (DOCUMENTED by code structure; `get_index` uses `std::atomic` only for thread-safe ids).
- Manual claim (qualitative): one-root operations with identical extension run "comparable to the running times of the corresponding arithmetic operations of rational-number types"; different extensions "only slightly larger" (manual l.4566-4577). No numbers in the manual.
- For measured numbers on circle arrangements with related number types see [Emiris et al. 2004](cgal-2d-circular-kernel-emiris-et-al-2004.md) (150 random circles, 10,340 vertices: 39-73 s on a 2.5 GHz P4 with exact types).

## Known failures, limitations, war stories

- [#8468](https://github.com/CGAL/cgal/issues/8468) (2024, closed): inserting two partially **overlapping polycurves of circular arcs** threw `boost::bad_get`; Fogel: the polycurve intersection code "was developed only with polylines ... in mind". Overlapping arcs are exactly what Onshape sketches produce when two circles share an arc (slots drawn twice).
- [#9062](https://github.com/CGAL/cgal/issues/9062) (2025): `approximated_offset_2` with `Gps_circle_segment_traits_2` crashes in WebAssembly with `Uncertain_conversion_exception` while native works: the interval filters depend on FPU rounding-mode control that Wasm does not provide. Directly relevant to wonky's JS and Metal targets (no directed rounding).
- [#7226](https://github.com/CGAL/cgal/issues/7226) (2023, open): `approximated_inset_2` hits a sweep assertion (`sl_iter != m_statusLine.end()`), segfault with `NDEBUG`.
- No Landmark point location with this traits (manual); point location falls back to walk/naive strategies.

## Relevance for wonky

- **Where it plugs in:** the sketch arrangement (skSolve regions), 2D Booleans for text and FDM layers, offsets. It is the reference design for "lines + circular arcs, exact, no general algebraic numbers".
- **Precision mapping (INFERRED).**
  - Inputs from FeatureScript are binary64, therefore dyadic rationals; skCircle (center, radius) gives rational center and r²; skArc three-point arcs give a rational circle with a degree-2 denominator (`2·cross(p2−p1, p3−p1)`).
  - Snapped to a grid of 2^-17 mm (7.6 nm, below Parasolid/FS `zeroLength` 1e-8 m = 1e-5 mm, see [commercial-kernels](../commercial-kernels.md) l.318-320) within ±10,000 mm, a coordinate fits a signed 32-bit integer (10^4·2^17 ≈ 2^30.3). Then α, β, γ of a circle/circle vertex are integers over a common denominator with bounded bit lengths. Comparisons are fixed-size multi-limb U32 products, at most ~12× the input bit length (Devillers degree 12: ≈ 400 bits = 13 limbs).
  - Caveat: a coarse grid turns exact-by-construction tangencies into grid-scale near-tangencies. A line of length L tangent to an arc of radius r then crosses it a second time about `2r·grid/L` away (r = 100 mm, L = 1 mm: 1.5 µm). A sketch-local grid near F32x2 precision (2^(e−47) for extent 2^e, 48-bit coordinates, ≈ 600 bits for degree 12) keeps this negligible. The tolerance rule for Onshape semantics must still be stated separately; see the [addendum](../addenda/exact-2d-arrangements-of-sketch-curves-lines-arcs-conics-wit.md) §4.
  - The one-root representation does not need √ at all: every decision is a sign of a polynomial in the integers. That fits wonky's "multi-limb U32 exact predicates" exactly; F32x2 serves only as a filter.
  - The binding constraint for F32x2 filters is the **F32 exponent range**, not the mantissa: a degree-12 polynomial in 32-bit integers spans up to 2^384, beyond F32's 2^127. Filters must work on locally translated, power-of-two normalized inputs and fall through to exact limbs on underflow (INFERRED).
- **Bend fit (INFERRED).** The algebra fits (pure functions, fixed-size limbs, uniform work per pair). The CGAL *algorithms* around it (surface sweep with a mutable status line, zone walks, `std::map` caches) do not; replace them by batch passes: all-pairs (or BVH) candidate pairs, exact pair intersections, per-curve sort of split points, per-vertex angular sort, face tracing, nesting.
- **LLM ergonomics:** the overlap-as-one-subcurve rule and multiplicity-2 tangencies give clean, explainable diagnostics ("arc A and arc B share 37°").

## Pointers worth porting or studying

- `One_root_number.h` l.179-206 (`_sign`) and l.412-525 (`compare` with two squarings): the whole exact comparison in ~100 lines; re-derive, do not copy (GPL).
- `Circle_segment_2.h` l.1737-1795 (`_circs_intersect`): discriminant and root formulas; `_is_between_endpoints` l.1797ff (arc membership via "upper/lower" half and x-range, never via angles).
- `Arr_circle_segment_traits_2.h` l.575-636: x-monotone split and degenerate circle as isolated point.
- Manual l.4553-4592: why one-root numbers suffice for rational circles and lines.

## Verdict: **adapt**

Adopt the number model (one-root numbers over snapped integers, exact sign by at most two squarings) and the arrangement data model (faces with outer + inner CCBs, overlaps as shared sub-curves, tangency multiplicity). Do not port code (GPL) and do not port the sweep; re-derive the predicates for multi-limb U32 with F32x2 filters and replace the sweep by fork-join batch passes.
