# CavalierContours (C++) and cavalier_contours (Rust): line+arc polyline offset and Booleans

- Kind: open-source libraries + interactive demo.
  - Rust (active): [github.com/jbuckmccready/cavalier_contours](https://github.com/jbuckmccready/cavalier_contours), crate `cavalier_contours` 0.9.0, demo [cavaliercontours.dev](https://www.cavaliercontours.dev/).
  - C++ (frozen): [github.com/jbuckmccready/CavalierContours](https://github.com/jbuckmccready/CavalierContours).
  - Local shallow clones: `tmp/research/cavalier-contours/{rust,cpp}`.
  - Read: Rust `README.md`, `CHANGELOG.md` (0.9.0), `src/core/math/circle_circle_intersect.rs`, `src/core/traits/fuzzy_{eq,ord}.rs`, `src/polyline/pline_types.rs` (options, l.60-110, 290-330), `src/polyline/internal/pline_boolean.rs` (outline l.52-805); C++ `README.md` (algorithm, benchmarks, numeric notes, references).
- Author: Buck McCready (jbuckmccready); 7 contributors (Rust), 5 (C++).
- License: Rust dual **Apache-2.0 / MIT**; C++ **MIT**. Porting ideas or translated code into wonky is unproblematic: keep the copyright/licence notice for translated code.
- Status (gh api, 2026-09-24):
  - Rust: 235 stars, created 2021-03-03, pushed 2026-08-30, last commit 2026-08-20 ("chore: Release"), 8 open issues, 16k lines of Rust in the core crate.
  - C++: 515 stars, created 2019-10-23, last push 2024-08-28, 33 open issues; its README issue #41 says development continues in Rust.

## What it is

A pragmatic library for **2D polylines whose segments are lines or constant-radius arcs**. It provides parallel offset (open, closed, self-intersecting), Booleans (OR/AND/NOT/XOR) between two closed polylines, multi-polyline offset with islands (`Shape`), winding number, containment, area and length. Arcs stay arcs: offsets of arcs are concentric arcs, and joins are exact arcs.

## How it works

- **Representation.** A vertex is `(x, y, bulge)`, with `bulge = tan(θ/4)` of the following segment's sweep. `|bulge| ≤ 1` (at most a half circle; larger arcs must be split, README "Known Limitations"; Rust #15 open since 2021).
  - INFERRED: for rational endpoints and bulge the arc center is rational and r² is rational. So bulge arcs are "rational circles" in the CGAL sense, although the library computes in f64.
- **Offset (C++ README "Offset Algorithm").**
  1. Raw offset segments.
  2. Join them into a raw offset polyline, always with **round joins** (arcs about the source vertex, keeping constant distance).
  3. For open or self-intersecting input, also build the dual offset (negated).
  4. Find all self-intersections (plus dual/end-cap circle intersections).
  5. Slice at the intersections.
  6. Discard slices closer than `offset − offset_dist_eps` to the source.
  7. Stitch the remaining slices.
  - "Collapsing arcs" (radius < offset) become marked lines. Based on Liu et al. 2007 ("An offset algorithm for polyline curves", *Computers in Industry* 58(3)) but without its GCPP clipping, which the author could not make work for large offsets.
- **0.9.0 change (CHANGELOG 2026-08-19):**
  - "Invalid slices are detected and tracked in raw offset creation";
  - "Slices are stitched together using intersect topology rather than global geometric queries", which removed `slice_join_eps`;
  - new options `TouchingLoopBehavior` and `CoincidentSegmentBehavior`;
  - sqrt/trig deferred in low-level intersection code.
- **Booleans (`pline_boolean.rs`).** `process_for_boolean` finds intersections and **overlapping slices** (coincident spans) between the two polylines. `slice_at_intersects` cuts both. `prune_slices` keeps or discards each slice by the **winding number of a slice midpoint** against the other polyline (`winding_number(pt) != 0`, l.423-424), per operation mode. `stitch_slices_into_closed_polylines` joins end to start with a priority selector.
  - Only two closed, **non-self-intersecting** inputs: "not possible with algorithm it uses" (owner, Rust #72).
- **Spatial index:** a static packed Hilbert R-tree (`static_aabb2d_index` crate, a flatbush port) over segment AABBs. It is built once, then queried.
- **Numerics:** f64 with **absolute fuzzy epsilons** passed in option structs (owner decision, Rust #3). Defaults: `pos_equal_eps = 1e-5`, `offset_dist_eps = 1e-4` ("Small enough to not clobber inputs but large enough to avoid inconsistencies across math operations", owner, Rust #23). The C++ README: epsilons 1e-8 or 1e-5 "picked through anecdotal use case trial/error where input values are typically between 0.1 and 1000.0"; users should rescale by 1000 if results are wrong.
- **Circle/circle intersection** (`circle_circle_intersect.rs` l.55-116): Paul Bourke's formula. Outcomes:
  - `NoIntersect` if `d ≥ r1 + r2 + eps` or `d ≤ |r1 − r2| − eps`;
  - tangent at the midpoint if `r1² − a² ≤ 0`, or if the two computed points are within `eps`;
  - otherwise two points.
  - INFERRED: the tolerance is asymmetric. A gap is tolerated linearly (eps on distance), an overlap only through the point separation `2√(2rδ)`. With eps = 1e-5 and r = 10, overlaps above ~1.25e-12 become two points, while gaps up to 1e-5 become a tangency.

## Robustness and guarantees

- No guarantee is claimed. Correctness is heuristic, with fuzzy comparisons and tests; results depend on absolute epsilons (hence scale-dependent).
- The owner's own framing (Rust #21, 2022): the four intersect functions must "agree in as many cases as possible when given the same epsilon value". Consistency across predicates is the recurring failure source.

## Parallelism and performance

- Single-threaded. C++ README benchmarks (i7-6700K, MSVC 2019):
  - with arcs kept: circle offset 0.12 ms, rounded rectangle 0.49 ms, pathological 100-arc profile 85 ms;
  - against Clipper on arc-approximated input (1e-3): 61 ms, 62 ms and 15.8 s respectively. Across both approximation tolerances, Clipper is 8-860× slower than cavc with native arcs on the arc profiles (3.4-8× on the plain square);
  - cavc with arcs approximated: 0.7-19× faster than Clipper.
- Rust 0.9.0 vs 0.8.0 (CHANGELOG, machine not stated): `profile1` 319 → 202 µs; `pathological1` 62.8 → 18.5 ms; `involute_gear` 4.4 → 4.1 ms.
- INFERRED: typical sketch-sized profiles offset in well under a millisecond on one core.

## Known failures, limitations, war stories

- [Rust #23](https://github.com/jbuckmccready/cavalier_contours/issues/23) (26 comments, 2022): wrong Boolean results on pill shapes touching end to end. Root causes, per the owner:
  - numerical instability in `line_circle_intr`;
  - epsilons "not being used correctly (inconsistent between functions)";
  - "squared values being fuzzy compared which are not to scale with the epsilon value, e.g. `length * length < eps` when it should be `length < eps`";
  - after the fixes, results still differed by "+/- 1 vertex that is very close (but not touching according to epsilon values) ... or an additional very small loop/area polyline" when one input's direction was reversed.
  - **Orientation dependence of fuzzy code is the canonical war story for wonky's exact approach.**
- [C++ #71](https://github.com/jbuckmccready/CavalierContours/issues/71) (open, 2025): union is **not commutative** on two arc-capped rectangles.
- [C++ #53](https://github.com/jbuckmccready/CavalierContours/issues/53) (2022): **translating** the input changed the offset result (absolute epsilons); fixed only in Rust.
- [C++ #24](https://github.com/jbuckmccready/CavalierContours/issues/24) (2020): `Exclude` with shapes touching only along a coincident segment returned nothing. Fixed by reworking slice selection for coincident intersects.
- [Rust #35](https://github.com/jbuckmccready/cavalier_contours/issues/35): offset keeps overlapping spans while Boolean merges them, so equal geometry gives different topology. Addressed in 0.9.0 by explicit `CoincidentSegmentBehavior`/`TouchingLoopBehavior` options (offset only; "Boolean ... not yet updated").
- [Rust #79](https://github.com/jbuckmccready/cavalier_contours/issues/79) (2026): offset panics on an `assert_eq!` in `pline_view.rs` for a real 3 mm inward offset, then shows "leaking" (an invalid region kept). Fixed 2026-08-15 by local invalid-segment detection, "without relying on global distance check which may not catch it due to epsilon".
- [Rust #72](https://github.com/jbuckmccready/cavalier_contours/issues/72): Booleans refuse self-intersecting input (by design). [C++ #52](https://github.com/jbuckmccready/CavalierContours/issues/52): nested island offsets missing in C++.

## Relevance for wonky

- **Arc-preserving offset for FDM** (hole compensation, clearances, wall offsets of printed profiles). The algorithm is the pragmatic reference: raw offset with round joins, then intersect, slice, prune by distance, stitch.
  - With 0.9.0 the pruning is topological (invalid-slice tracking). That is closer to what an exact implementation can do: decide invalidity by exact predicates on the raw offset segment (its direction reversed = collapsed), not by distance thresholds.
- **Where it plugs in:**
  - FDM offsets and insets, as a declared-ε operation;
  - 2D Booleans on text/profile outlines;
  - a *test oracle* for wonky's exact offset (compare areas and Hausdorff distance on the demo's JSON cases and the issue repros; Apache/MIT permits vendoring the test polylines).
- **Bend fit (INFERRED).**
  - Raw offset: per-segment map.
  - Intersections: BVH or Hilbert-packed static index (sort by Hilbert key and build levels bottom-up, pure), then pair tests.
  - Slice pruning: per-slice map.
  - Stitching: a matching of endpoints, i.e. sort by endpoint key plus pointer jumping. No mutation needed; balanced fork-join throughout.
  - The f64 fuzzy numerics do **not** transfer. Replace by snapped integer inputs, exact predicates (one-root numbers; see [CGAL note](cgal-arrangement-2-circle-segment-traits-one-root-numbers.md), [Devillers](devillers-fronville-mourrain-teillaud-2002-circle-arc-predicates.md)) and an explicit ε only where the offset leaves the rational field (line offsets carry √(A² + B²)).
- **Semantics lessons for LLM-driven CAD:** make coincident-span and touching-loop behaviour explicit options with named defaults (0.9.0). Require results invariant under input reversal, translation and operand order, and test for it (#23, #53, #71).

## Pointers worth porting or studying

- C++ README "Offset Algorithm and Stepwise Example" (7 steps with images) and "Joining Raw Offset Segments" / "Stitching Open Polylines".
- Rust `polyline/internal/raw_pline_offset.rs` (1,293 lines): raw offset and invalid-slice tracking (0.9.0). `pline_offset.rs` (2,893 lines): slicing and topological stitching.
- Rust `polyline/internal/pline_boolean.rs`: `process_for_boolean` → `prune_slices` (midpoint winding) → `stitch_slices_into_closed_polylines`.
- Rust `pline_types.rs` options: an example of explicit, named tolerances and behaviour switches.
- Test data: `cavalier_contours/tests/test_pline_*.rs`, `benches/test_polylines.rs` (profile1/2, involute gear, floor plan, pathological), and the JSON cases in issues #23, #71, #79.

## Verdict: **adapt** (algorithm and tests), **avoid** (numeric model)

The slice-and-stitch offset with round joins, the 0.9.0 topological invalid-slice tracking and the named behaviour options are worth re-implementing in Bend. The permissive licence even allows translation. The absolute-epsilon f64 core is exactly what wonky must not copy: its issue history is a catalogue of epsilon inconsistency, orientation and translation dependence, and non-commutativity.
