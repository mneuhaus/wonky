# Martínez-Rueda-Feito polygon Boolean (plane sweep with in/out flags) and its JS/TS ports

- Kind: papers + reference C++ code + open-source ports.
  - Papers: F. Martínez, A. J. Rueda, F. R. Feito, "A new algorithm for computing Boolean operations on polygons", *Computers & Geosciences* 35(6):1177-1185, 2009. F. Martínez, C. Ogayar, J. R. Jiménez, A. J. Rueda, "A simple algorithm for Boolean operations on polygons", *Advances in Engineering Software* 64:11-19, 2013 ([ScienceDirect S0965997813000379](http://www.sciencedirect.com/science/article/pii/S0965997813000379)). Both paywalled; **not read**.
  - Author page with the C++ code (`cageo144.zip` 2009, `bop12.zip` 2013 with CGAL): [www4.ujaen.es/~fmartin/bool_op.html](https://www4.ujaen.es/~fmartin/bool_op.html). It states the code handles "concave polygons, polygons with holes, polygons with several components and self-intersecting polygons" and that the "implementation is no longer supported". No license stated.
  - Port read: [w8r/martinez](https://github.com/w8r/martinez) (TypeScript, local `tmp/research/martinez/w8r`, 1,244 lines in `src/`). Files read: `compute_fields.ts`, `edge_type.ts`, `segment_intersection.ts`, `subdivide_segments.ts`, `compare_segments.ts`, `connect_edges.ts`.
  - Related port: [mfogel/polygon-clipping](https://github.com/mfogel/polygon-clipping) (issues only), successor [luizbarboza/polyclip-ts](https://github.com/luizbarboza/polyclip-ts).
- Authors: Francisco Martínez et al. (Univ. Jaén); ports by Alexander Milevski, Vladimir Ovsyannikov (w8r), Mike Fogel.
- License: w8r/martinez MIT (© 2018 A. Milevski); polygon-clipping MIT; polyclip-ts MIT; the original C++ has no stated license (treat as all rights reserved).
- Status (gh api, 2026-09-24): w8r/martinez 775 stars, pushed 2026-04-10, 38 open issues; polygon-clipping 641 stars, last push 2024-04-19, 46 open issues (issue #157 suggests deprecating it in favour of polyclip-ts); polyclip-ts 48 stars, pushed 2025-11-09.

## What it is

The standard **sweep-line baseline** for 2D polygon Booleans: one Bentley-Ottmann style pass that subdivides edges at intersections and labels each subdivided edge with in/out information, followed by a contour-connection pass. Polygons only (straight edges).

## How it works (from the w8r code; DOCUMENTED at the code level)

- **Events:** each edge contributes a left and a right sweep event. The queue is sorted by x, then y, then left/right.
- **Status line:** a balanced tree ordered by `compareSegments`. It uses the exact `orient2d` from `robust-predicates` (`signed_area.ts`), but tests collinearity with `!== 0` on that result.
- **Per left event,** `computeFields(event, prev)` sets:
  - `inOut`: does this edge bound its own polygon from outside to inside (upward);
  - `otherInOut`: is the region just below this edge outside the *other* polygon;
  - both are derived from the predecessor in the status line (`compute_fields.ts` l.17-40). This is **a parity walk down the status line**, i.e. a winding computation in disguise.
- **Result membership:** `inResult` by operation, e.g. union keeps `otherInOut` edges, intersection keeps `!otherInOut`, difference keeps subject edges outside the clip and clip edges inside the subject.
- **Overlapping edges** get types NON_CONTRIBUTING, SAME_TRANSITION or DIFFERENT_TRANSITION (`edge_type.ts`), so that coincident edges count once.
- **Intersections:** `possibleIntersection` computes the crossing of status-line neighbours with Schneider-Eberly in plain doubles (`segment_intersection.ts`; the EPS constant is commented out), then splits both segments (`divide_segment.ts`) and pushes new events.
- **Output:** `connectEdges` collects result edges, bubble-sorts them again "due to overlapping edges the resultEvents array can be not wholly sorted" (`connect_edges.ts`), and walks contours; hole/parent assignment by depth.

## Robustness and guarantees

- Exact orientation predicates, **inexact constructed intersection points** (double). After a split, the new vertices are rounded, so later orientation tests are consistent with the rounded geometry but not with the original. That is the classic source of sweep inconsistency.
- No published guarantee. The 2013 paper claims handling of overlapping edges and self-intersections; the ports' issue trackers show the limits.

## Parallelism and performance

- Sequential. w8r README (JS, machine not stated): "Hole_Hole" 29,530 ops/s against JSTS 2,051; "Asia union" 9.19 ops/s against 7.60; "States clip" 227 ops/s against 100.
- The sweep is O((n + k) log n) (standard; INFERRED).

## Known failures, limitations, war stories

- [w8r #98](https://github.com/w8r/martinez/issues/98) (open): **infinite loop** in `subdivide` for a self-intersecting input. A commented-out line in the code reads "that disallows self-intersecting polygons, did cost us half a day, so I'll leave it out of respect".
- [w8r #102](https://github.com/w8r/martinez/issues/102) (open): the intersection result depends on "minor difference in coordinates" (+0.0001 fixes it).
- [w8r #153](https://github.com/w8r/martinez/issues/153) (open): the collinearity test `=== 0` in `compareSegments` is "likely not very robust"; a reimplementer got bogus unions until he replaced it.
- [w8r #95](https://github.com/w8r/martinez/issues/95): intersection throws, but works with the operands swapped. [#85](https://github.com/w8r/martinez/issues/85), [#74](https://github.com/w8r/martinez/issues/74): heap out of memory. [#35](https://github.com/w8r/martinez/issues/35) (open since 2017): "Overlapping edges still a problem".
- polygon-clipping: "Unable to complete output ring" ([#139](https://github.com/mfogel/polygon-clipping/issues/139)-[#141](https://github.com/mfogel/polygon-clipping/issues/141), [#172](https://github.com/mfogel/polygon-clipping/issues/172)), "Unable to find segment #N in SweepLine tree" ([#115](https://github.com/mfogel/polygon-clipping/issues/115), [#148](https://github.com/mfogel/polygon-clipping/issues/148)), infinite loop in union ([#153](https://github.com/mfogel/polygon-clipping/issues/153)), "too many sweep line segments" for 4 valid polygons ([#173](https://github.com/mfogel/polygon-clipping/issues/173), 2026).
- Pattern (INFERRED): almost every failure is a **status-line consistency failure** after inexact splits (tree lookup fails, ring cannot close, event loops). Exact orientation alone does not suffice when constructions are rounded.

## Relevance for wonky

- **Baseline, not target.** The sweep is the textbook algorithm the task brief names as the baseline. Its core idea transfers: every arrangement edge carries, per operand, the in/out state of the region on each side. Its sequential status line does not.
- **Bend-friendly replacement (INFERRED).**
  1. Candidate pairs via BVH or all-pairs (sketches are small).
  2. Exact pair intersections with implicit (unconstructed) vertices.
  3. Per-edge sorted split parameters.
  4. Per-vertex angular sort.
  5. Face tracing by next-halfedge pointers (pointer jumping or per-cycle min-label propagation).
  6. Per-face winding numbers / in-out labels by exact ray parity against the original curves, or by propagation across the face adjacency tree.
  - Every step is a map, a sort or a fork-join reduction, and nothing is decided on rounded constructed points.
- **Arcs:** Martinez is polygon-only. Its in/out labelling is unchanged for arcs (it only needs "which side of this edge"), and the numeric parts are replaced by one-root predicates ([CGAL note](cgal-arrangement-2-circle-segment-traits-one-root-numbers.md)).
- **Testing:** the ports' issue trackers are a free adversarial corpus (JSON/GeoJSON coordinates in issues #95, #98, #102, #153 and polygon-clipping #139-#173). The MIT ports allow copying the test fixtures.

## Pointers worth porting or studying

- `compute_fields.ts` (parity propagation `inOut` / `otherInOut`, `prevInResult`) and `edge_type.ts` (overlap classification): the semantic core in ~80 lines.
- `connect_edges.ts`: contour assembly and hole/parent depth, including its re-sort workaround (a symptom to avoid).
- The polyclip-ts issue #1 test import (per polygon-clipping #157) as a ready regression suite.

## Verdict: **learn-from**

Use its labelling semantics (in/out per operand per edge side; overlap edge types) and its issue trackers as tests. Do not port the sweep: inexact splits plus a sequential status line are the documented failure mode, and neither fits Bend.
