# SISL (SINTEF Spline Library)

- **Kind:** C library (NURBS modelling and interrogation) plus a 384-page reference manual.
- **Canonical URL:** https://github.com/SINTEF-Geometry/SISL
- **Other URLs:**
  - Product page: https://www.sintef.no/en/software/sisl/
  - Manual `SISL_4.7_manual.pdf` in the repo root, dated 16 March 2021. Local text: `tmp/research/pdf/sisl-4.7-manual.txt`.
  - Shallow clone: `tmp/research/sisl` (commit e0a82b1a, 2026-09-21).
  - Companion note: `gotools-sintef-spline-geometry-library-with-intersections-co.md`. GoTools wraps SISL for its elementary-surface and spline SSI (`s1851`-`s1859`, `s1310`, `s1314`-`s1318`).
- **Authors/org:** SINTEF Digital, Mathematics and Cybernetics (Oslo): Tor Dokken, Vibeke Skytt, Arne Laksaa, Ulf J. Krystad, B.O. Hoset, Jan B. Thomassen, Sverre Briseid and others. Routine headers date from 1988-1994 (e.g. `sh1859` "Vibeke Skytt, SI, 88-10"). Releases:
  - 4.4 (2005);
  - 4.5 (2010, CMake);
  - 4.6 (2013, relicensed to AGPL/commercial);
  - 4.7 (2021, documentation update).
  - DOCUMENTED (ChangeLog, file headers).
- **License:**
  - AGPL-3.0, with a section 7(b) clause: "a covered work must retain the producer line in every data file that is created or manipulated using SISL".
  - A commercial license is also available.
  - Tor Dokken on the intent: AGPL was chosen "to avoid commercial cloud services being built on SISL without commercial licenses" (https://github.com/SINTEF-Geometry/SISL/issues/3).
  - Porting implication: transliterating any routine makes wonky a covered work, with network-use obligations. **Study-only.** Re-derive from the manual's documented semantics and from textbooks (Patrikalakis-Maekawa-Cho). INFERRED.
- **Status (gh api, 2026-09-22):**
  - 216 stars, 72 forks, 23 open issues, 5 contributors.
  - Last commit 2026-09-21 ("Bug fix in old-style prototype", PR #64). Before that, CMake export fixes (2025-10/11).
  - Tags: SISL_4_0, SISL_4_5_0, SISL-4.6.0. No GitHub releases.
  - 615 source files, about 192k lines of C.
  - Maintained but dormant: build and doc fixes only. The issue tracker is mostly usage questions.

## What it is

A classic procedural NURBS toolkit in K&R-compatible C. There are seven modules: curve and surface definition, interrogation, utilities, and data reduction. Coverage:

- interpolation, approximation, lofting, blending (3-6-sided), offsets;
- intersections: curve/point, curve/line-plane, curve/circle-sphere, curve/cylinder, curve/cone, curve/torus, curve/curve, surface/line, surface/curve, surface/implicit quadric, surface/surface;
- silhouettes;
- closest points, extremals;
- curvature analysis (Gaussian, mean, principal, "Mehlum" curvatures);
- bounding boxes and normal cones.

Intersections work in two stages (DOCUMENTED, manual §8.1):

1. **Topology routines** find all intersections as *guide points*: parameter pairs on each intersection branch plus isolated points. Examples: `s1859` (surface/surface), `s1851` (surface/plane), `s1853` (surface/cylinder), `s1369` (surface/torus).
2. **Marching routines** turn guide points into B-spline curves: `s1310` (surface/surface), `s1314` (plane), `s1316` (cylinder) and others.

The result object is `SISLIntcurve`. It holds:

- `ipoint` guide points, with `epar1` and `epar2` parameter arrays;
- optional `pgeom` (3D B-spline) and `ppar1`/`ppar2` (pcurves in each parameter plane);
- `itype`:

  | itype | Meaning |
  |---|---|
  | 1 | straight line |
  | 2 | closed loop without singularity |
  | 4 | open curve without singularity |
  | 5, 6, 7 | open curve with a singularity at the start, the end, or both |
  | 3, 8 | "not used" |

## How it works

### Tolerance model

DOCUMENTED (manual §2, `include/sislP.h`).

- **One absolute geometry resolution `epsge`**: "The geometric tolerance tells when two points are regarded as equal." The computational resolution `epsco` is "included from historical reasons and no longer used".
- The manual warns: "In surface-surface intersections … a large tolerance [implies] a large area around an intersection curve where the two surfaces are closer than the tolerance, which may lead to unstability in tangential situations." It suggests stricter tolerances for intersections and that "the intersection tolerance must reflect the accuracy in which the associated geometry entities are constructed".
- Examples use `epsge = 1e-6` for SSI topology and `1e-5` for marching.
- **Hard-coded globals:**
  - `AEPSGE = 1e-6`;
  - `REL_COMP_RES = 1e-15`;
  - `REL_PAR_RES = 1e-12`, used by `DEQUAL(a,b)`: `|a-b| ≤ 1e-12·max(|a|,|b|,1)`;
  - `ANGULAR_TOLERANCE = 0.01` rad;
  - `MAXIMAL_RADIUS_OF_CURVATURE = 1e4`.
- Everything is IEEE double. There are no interval, exact or rational predicates anywhere. INFERRED from reading core routines and the absence of such types.

### Rational representation

DOCUMENTED (manual §6.1.1).

- NURBS vertices are passed **pre-multiplied by weights**: `(w1 p1, w1, w2 p2, w2, …)`, stored in `rcoef`, with a separate `ecoef` for the Euclidean control points.
- This non-standard convention is a known stumbling block. Issue https://github.com/SINTEF-Geometry/SISL/issues/7 is a circle "not evaluating in plane" because the weights were not pre-multiplied.

### Recursive intersection engine

`sh1761` → `sh1762`, the "sh" family, with a mutable `SISLIntdat` pool. DOCUMENTED (headers of `sh1859.c`, `sh1761.c`, `sh1762.c`):

1. **Entry.** `s1859` → `sh1859` wraps both surfaces as `SISLObject`s and calls `sh1761`. Post-processing follows:
   - `sh6degen` (degenerate curves become points);
   - `int_join_per` (join curves across periodic seams);
   - optional `refine_all` / `make_tracks`;
   - `hp_s1880` (output format).
2. **`sh1761` handles the boundary.**
   - A point/point intersection is decided directly.
   - Otherwise it runs the box test `sh1790` with an expanded box.
   - It recursively intersects each edge curve (`s1435`) or endpoint (`s1438`) of one object with the other object, **before** the interior.
   - The edge results go into the pool (`sh6idnpt`, `sh6idalledg`).
   - It then calls `sh1762` for the interior.
3. **`sh1762` handles the interior**, 9,808 lines. Per subproblem:
   - box test `sh1790`;
   - simple-case test `s1741`;
   - iteration (`s1770` curve/curve, `s1771` point/curve, `s1772` curve/surface, `s1773` point/surface; Newton in 2-4 parameters);
   - or subdivision (`s1231` curves, `s1711` surfaces) at a "good" parameter (`s1792`, matched to knot insertion feasibility in `s1791`), then recursion through `sh1761` on the pieces.
4. **Box test `sh1790` statuses:**

   | Status | Meaning |
   |---|---|
   | 0 | no overlap |
   | 1 | overlap as open sets |
   | 2 | overlap as closed sets only |
   | 3 | both boxes inside geometry resolution (micro case) |
   | 4 | one box collapsed to a point |
   | 5 | danger of shadow area in point intersection |

   Box kinds: unexpanded, totally expanded by `epsge`, or "expanded in the inner of the object and reduced along the edges".
5. **Simple-case test `s1741`**, surface/surface (Sinha-style normal cones):
   - `s1990` builds each surface's **normal cone**: centre direction plus half-angle `aang`, from normals at the corners of each control-net patch, grown incrementally. `igtpi` flags a cone wider than π.
   - With `tang` the angle between the cone axes, the case is simple iff `tang + aang1 + aang2 < π` and `aang1 + aang2 < tang`. Then neither the cones nor their mirrors intersect, so there can be no closed loop and no singularity inside, and the intersection is determined by the boundary points.
   - A refined test `s1795` (rotated/projected cones) is tried when `ANGULAR_TOLERANCE < tang < π − ANGULAR_TOLERANCE` and both cones are ≤ 1.3·tang.
   - Curve/curve uses the same test on tangent cones (`s1991`, `s1796`), with `small_tang = min(tang, π−tang)` for the refined branch.
   - DOCUMENTED (s1741.c lines 120-330).
6. **Singularities:** `sh1795` checks whether a singular point at a corner is isolated and, if so, returns segmentation parameters bounding a "tangential zone" (status 1 or 2: "entire surface within tangential zone").
7. **Intersection point record** (`SISLIntpt`, sislP.h):
   - parameters in both objects and a distance `adist`;
   - `iinter` ∈ {ordinary, singular, trim} × {main, help};
   - per-curve `pnext` links and `curve_dir`;
   - **pretopology** `left_obj_1/2`, `right_obj_1/2` ∈ {`SI_UNDEF`, `SI_IN`, `SI_OUT`, `SI_ON`, `SI_AT`} for each curve through the point. That is, whether the region to the left/right of the intersection branch on one object lies inside, outside or on the other. This is the local in/out information a Boolean needs.

### Implicit-vs-parametric path (plane, sphere, cylinder, cone, torus)

DOCUMENTED (s1851, s1853, s1320 headers; sh1853.c lines 240-275).

- "The vertices of the surface are put into the equation of the [plane|cylinder] achieving a surface in the one-dimensional space. Then the zeroes of this surface is found."
- For quadrics, `s1320` forms F(s,t) = (P(s,t),1)ᵀ A (P(s,t),1) "by sampling enough points to use interpolation for reproduction". This is exact up to floating point, because the product spline's degree and knots are known.
- The zero set is found by the same `sh1761` engine as a point-vs-1D-surface problem.
- **Tolerance conversion:** cylinder `eps_1d = 2·radius·epsge`. If max |coef| > 10, the 1D surface and eps_1d are divided by the maximum ("normalize to get angle tolerances correct", UJK 1993).

### Marching `s1310` (surface/surface)

DOCUMENTED (s1310.c, s1311.c, s9iterate.c).

- **Maximum step** = the largest bounding-box extent of either surface (optionally capped by `maxstep`).
- **Start point:** a non-singular guide point is chosen, maximizing the minimum angle between the curve tangent `N1×N2` and the partial derivatives, with thresholds of `5·ANGULAR_TOLERANCE`.
- **March** in both directions from it:
  - Each step is a cubic Hermite segment.
  - The candidate endpoint is iterated onto the curve by `s9iterate`: intersection of *both surfaces and a plane* through the predicted point, normal to the tangent.
  - The segment **midpoint** is iterated too. The segment is accepted iff the midpoint distance ≤ `aepsge2` and (angle error ≤ `ANGULAR_TOLERANCE` or step ≤ `aepsge2`).
- **Branch-jump guards:** reject a step if the normalized `N1×N2` at the two ends have dot product ≤ 0.5 ("jumped to another branch or passed a singularity"), or if either parameter-plane direction reverses.
- **Step length** (`s1311`), from the radius of curvature r of the intersection curve:
  - `α = π·(ε/r)^(1/6) / 0.4879`;
  - `step = min(α·r, r/2)`;
  - `100·ε` if r = 0.
- **On rejection:** `tnew = min(step/2, step / (2·max(dist/ε,1)^(1/4)))`, or step/10 on divergence. Stop if the step no longer changes `tmax + step`.
- **Guide points** are passed through or snapped to. A curve is closed when the start point is reached again.
- **Output:** `pgeom` and optionally both pcurves as B-splines.
- **stat = 3:** "Iteration stopped due to singular point or degenerate surface. A part of an intersection curve may have been traced out."
- **Silent tolerance growth:** when an iterated point falls outside a parameter domain, the local tolerance is inflated: `aepsge2 = max(aepsge2, dist(spnt, sipnt))` (lines 645-650, 1072-1078). DOCUMENTED (code).

## Robustness and guarantees

- **Nothing is certified.**
  - Box and cone exclusion tests are conservative only as far as control-polygon bounds are. The corner-normal cone in `s1990` is built from normals at control-patch corners. INFERRED: that is a heuristic enclosure, not the rigorous hodograph bound over all pairwise derivative cross products.
  - All decisions are double comparisons against `epsge`, `REL_PAR_RES` and `ANGULAR_TOLERANCE`.
- **Completeness of loops** rests on the simple-case (normal cone) theorem at the leaves of the subdivision. It is correct in exact arithmetic with rigorous cones. In SISL it is only as good as the floating cone enclosure. INFERRED.
- **Tangential and overlapping cases:**
  - tangential zones are bounded and segmented (`sh1795`);
  - degenerate curves collapse to points (`sh6degen`);
  - the documented itype codes for singular cases (3, 8) are "not used";
  - marching explicitly stops at singularities with partial output (stat 3).

  The manual itself warns about instability in tangential situations with large `epsge`. DOCUMENTED.
- **Status convention:** negative = error, 0 = ok, positive = warning. `s1859` returns 10 if the intersection contains *surfaces* (coincident regions, `jsurf > 0`) and otherwise 0. That is an explicit signal for overlap. DOCUMENTED (s1859.c).

## Parallelism and performance

- No published benchmarks: none in the manual or on the product page. DOCUMENTED absence.
- **Serial by construction:**
  - Recursion shares a mutable `SISLIntdat` pool (`sh6idnpt`, `sh6idkpt`, `sh6idcon`) and mutates object caches (`pdir`, `pbox` stored on the curve or surface structs).
  - Siblings are not independent tasks as written.
  - Memory is manual (`newIntcurve`/`freeIntcurve`; the manual warns "strange errors might result" if structures are not freed).
  - DOCUMENTED (manual §2, code).

## Known failures, limitations, war stories

- **Issues** are few and mostly usage questions:
  - #20: wrong ordering of intersection points from `s1850` (https://github.com/SINTEF-Geometry/SISL/issues/20);
  - #27: out-of-bounds access in `s1323`, fixed (https://github.com/SINTEF-Geometry/SISL/issues/27);
  - #31: null dereference in `s1251`, open (https://github.com/SINTEF-Geometry/SISL/issues/31);
  - #7: rational-weight convention confusion (https://github.com/SINTEF-Geometry/SISL/issues/7).
- **Code smells** that matter for trust:
  - commented-out alternatives and "VSK 0417"-style patches in `s1310`;
  - `debug_flag` / FILE writes in `sh1762`;
  - "UJK sept 93" normalization hacks in `sh1853`.

  The heuristics were tuned case by case over 30 years. DOCUMENTED (code).
- **No solid modelling.** SISL has no B-rep, no Booleans, no trimming topology. GoTools adds those layers and still has no general solid Boolean (see the GoTools note). DOCUMENTED.

## Relevance for wonky

INFERRED unless marked.

- **Today, analytic plane/cylinder/cone:** limited. Wonky should solve these pairs in closed form (conics, quadric-quadric curves). The useful SISL piece is the **tolerance conversion for the implicit route**:
  - for a unit-normal plane, |F| = distance;
  - for a cylinder, F = ρ² − r² = 2rd + d² exactly (ρ = distance to the axis, d = ρ − r), so |d| ≤ ε ⇔ |F| ≤ 2rε + ε². SISL uses the first-order 2rε. In wonky, this becomes a *certified* function-space band for F32x2 interval evaluation;
  - for a cone, the conversion depends on the local radius, so bound it with the gradient norm.
- **Tomorrow, fillets, blends and tori (spline or procedural faces):** SISL's two-level intersection design is the right contract:
  - **guide points (topology) → marched curves with pcurves**, where marching may fail with partial output (stat 3);
  - wonky's hybrid Boolean already has the topology stage: the tagged mesh Boolean yields intersection polylines with source-face tags, i.e. guide points plus branch connectivity;
  - the recovery stage for non-closed-form pairs would then be a SISL-like marcher. Its concrete, portable-as-idea parameters are the step formula (α = π(ε/r)^(1/6)/0.4879, step ≤ r/2), the midpoint acceptance test, the plane-constrained Newton corrector (`s9iterate`: two surfaces plus a normal plane, 4 unknowns), and the branch-jump guard (dot of successive N1×N2 ≤ 0.5).
  - Wonky must replace the silent `aepsge2` inflation with an explicit failure or a recorded tolerance event.
- **Normal-cone simple-case test:** useful for proving "no closed loop inside" on a patch pair before trusting the mesh-derived topology. For Bend:
  - build cones as a reduction over control-net quads (fixed-size, uniform, GPU-friendly);
  - make them rigorous with all pairwise derivative-control-point cross products and F32x2 interval angles;
  - the test itself is two inequalities.
  - For planes the cone is a point, and for cylinders and cones it is a great-circle arc, both closed-form.
- **Pretopology (`SI_IN/OUT/ON/AT` left/right per branch):** the per-branch in/out labelling is exactly what a B-rep Boolean needs at each recovered intersection edge. Wonky's recovery should attach, per recovered edge, the side classification of each face with respect to the other solid, derived exactly from the tagged mesh's patch classification.
- **Bend fit:** poor as code, good as ideas.
  - The recursion must be restructured as in the GoTools note: compute the shared boundary intersections *before* splitting and pass them to both children immutably, then merge by id.
  - Double-precision constants are mostly compatible with F32x2 (about 2⁻⁴⁸ ≈ 3.6e-15 relative). REL_COMP_RES = 1e-15 is **below** F32x2 resolution and must be loosened or replaced by certified error bounds.
  - The F32 exponent range is not a problem for mm-scale CAD, but the high-degree products in `s1320` substitutions (degree up to 2·(k−1) per direction) should be evaluated in normalized Bernstein form to keep low words from underflowing.
- **LLM ergonomics:** the SISL API (numbered functions like `s1859`, out-parameters, status ints) is the anti-pattern. The two-stage *semantics* are worth mirroring in a typed, self-describing result: `IntersectionTopology{points, branches}` → `IntersectionCurve{geom, pcurve1, pcurve2, tolerance, status}`.

## Pointers worth porting or studying

- Manual:
  - §2 (tolerance semantics);
  - §8.1 (SISLIntcurve two-level representation, itype codes);
  - §8.3.7 `s1859`, §8.5.7 `s1310` (API contracts, status meanings);
  - §8.3.1-8.3.6 / §8.5.1-8.5.6 (implicit surfaces: plane, sphere, cylinder, cone, elliptic cone, torus);
  - §8.12 (normal cone object).
- Code, for ideas only (AGPL):
  - `src/s1741.c`: simple-case cone inequalities;
  - `src/s1990.c`: surface normal cone construction;
  - `src/sh1790.c`: box-test status taxonomy;
  - `src/sh1761.c`, `src/sh1762.c`: boundary-first recursion;
  - `src/s1310.c`: marching, acceptance tests, branch guards;
  - `src/s1311.c`: step formula;
  - `src/s9iterate.c`: two-surface-plus-plane corrector;
  - `src/sh1853.c` lines 240-275: tolerance conversion to function space;
  - `src/s1320.c`: implicit substitution by sampling and interpolation;
  - `include/sislP.h` `SISLIntpt`: pretopology fields;
  - `include/sisl.h` line 290: `SI_IN/OUT/ON/AT` enum.

## Verdict: learn-from

SISL is a compact, well-documented example of the classic subdivision-plus-marching SSI with an explicit geometric resolution. Worth mining:

- the two-level intersection contract;
- the marching acceptance, step and branch-jump rules;
- the normal-cone simple case;
- the implicit-substitution tolerance conversion;
- per-branch pretopology.

These matter when wonky moves beyond closed-form quadric pairs (fillets, tori, splines).

Do not port: AGPL code, all-double heuristics without certification, a mutable shared pool, and silent tolerance inflation.
