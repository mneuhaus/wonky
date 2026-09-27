# Exact 2D arrangements of sketch curves (lines, arcs, conics) with Onshape region semantics, plus arc-preserving 2D offset

Research addendum, 2026-09-24. Gap filler. Read-only research; no kernel code was changed.

Labels: **DOCUMENTED** (primary source or file evidence), **INFERRED** (my reasoning from evidence), **HEARSAY** (forums, secondhand), **MEASURED** (grep/count run in this session).

Per-source notes (all new, in `docs/research/sources/`):

- [onshape-sketch-regions-sksolve-qsketchregion-semantics](../sources/onshape-sketch-regions-sksolve-qsketchregion-semantics.md): the contract
- [cgal-arrangement-2-circle-segment-traits-one-root-numbers](../sources/cgal-arrangement-2-circle-segment-traits-one-root-numbers.md)
- [devillers-fronville-mourrain-teillaud-2002-circle-arc-predicates](../sources/devillers-fronville-mourrain-teillaud-2002-circle-arc-predicates.md)
- [cgal-2d-circular-kernel-emiris-et-al-2004](../sources/cgal-2d-circular-kernel-emiris-et-al-2004.md)
- [cgal-arr-conic-traits-and-bezier-traits-hanniel-wein](../sources/cgal-arr-conic-traits-and-bezier-traits-hanniel-wein.md)
- [cgal-boolean-set-operations-2-and-minkowski-offset-wein-2007](../sources/cgal-boolean-set-operations-2-and-minkowski-offset-wein-2007.md)
- [cavalier-contours-cpp-and-rust](../sources/cavalier-contours-cpp-and-rust.md)
- [held-vroni-arcvroni-arc-voronoi-offsetting](../sources/held-vroni-arcvroni-arc-voronoi-offsetting.md) (also covers Held & Mann 2011, floating point vs exact)
- [martinez-rueda-feito-polygon-clipping](../sources/martinez-rueda-feito-polygon-clipping.md)
- [freecad-facemaker-unified-and-solvespace-loop-nesting](../sources/freecad-facemaker-unified-and-solvespace-loop-nesting.md)

Local artifacts:

- clones `tmp/research/cgal-arrangements/` (sparse CGAL, `4abd208`), `tmp/research/cavalier-contours/{rust,cpp}`, `tmp/research/martinez/w8r`, `tmp/research/freecad-facemaker/`;
- PDFs in `tmp/research/pdf/`: `devillers-2002-cgta-hal.pdf`, `emiris-2004-open-curved-kernel.pdf`, `held-mann-2011-float-vs-exact-cccg.pdf`.

## 0. The answer in brief

1. **Onshape regions are faces of the curve arrangement, not loops (DOCUMENTED).**
   - Onshape's architecture VP: "the sketch faces are (small rectangle, large rectangle minus small rectangle), not two overlapping rectangles" (forum 5904).
   - `qSketchRegion(id, true)` removes every face "fully contained" in another face's outer boundary without touching it. That is one nesting level, not even-odd parity (std `query.fs` l.1776).
   - Whole-sketch extrude behaves like `true` (Onshape staff, forum 11934). Construction geometry never splits faces.
   - FreeCAD's new 2026 default (FaceMakerUnified) uses **even-odd** instead, and SolveSpace **refuses** crossings. These are different semantics, and FS input needs Onshape's.
2. **Demand (MEASURED, `~/Workspace/cad`, 606 `.fs`).**
   - `qSketchRegion` in 486 files (3,132 calls); 230 calls with explicit `filterInnerLoops = true` (217 files).
   - `skText` in 174 files, always extruded with `true`. Glyphs have holes, and glyph pairs can overlap.
   - `construction: true` in 14 files; spline/Bézier/conic-segment sketch entities in 0 files; `skEllipse` in 24.
   - wonky today admits exactly one closed walk (`docs/sketch-lines.md` l.45-53, `docs/sketch-arcs.md` l.20-60). The corpus repro `fixtures/corpus-repro/kernel-sketch-and-ops/line-arc-sketch-with-holes.fs` is blocked.
3. **Number model: lines and circles need only one-root numbers `α + β√γ` (DOCUMENTED, CGAL).** With rational (after snapping: integer) circle centers, squared radii and line coefficients, every arrangement vertex has one-root coordinates sharing one √γ. Every decision is the sign of a fixed polynomial in the integer inputs.
   - Devillers et al. 2002 prove the hardest ordering predicate (x-order of two circle-arc intersection points) needs degree **≤ 12**, usually 5-7, via a Descartes sign table.
4. **Precision mapping (INFERRED).**
   - Snap each sketch to a sketch-local dyadic grid of about F32x2 precision (2^(e−47) for extent 2^e). Coordinates become 48-bit integers.
   - Every exact predicate on center-radius circles and lines is then a fixed-size integer sign of ≤ ~600 bits: 19 U32 limbs or ~50 of wonky's base-4096 digits. That is fixed width, hence uniform GPU work.
   - F32x2 is only a filter. Its binding limit is the **F32 exponent range**, not the mantissa: degree-12 terms span far more than 2^±127. So filters run on locally translated, power-of-two-normalized inputs and fall through to exact digits (wonky's `robust-predicates.bend` already restricts its filter to an exponent window for the same reason).
5. **Exactness alone does not reproduce Onshape (INFERRED, key risk).** Onshape/Parasolid are tolerant (FS `zeroLength` 1e-8 m = 1e-5 mm). Exact arithmetic on rounded input turns intended tangencies into two crossings plus a sliver face. The tolerance layer must be explicit, exact and reported:
   - merge vertices within tol;
   - collapse crossing pairs whose **lens width** (sagitta) is ≤ tol into one tangential contact;
   - treat near-coincident supports as overlaps;
   - refuse ambiguous cases with the tolerance they would need.
6. **Algorithm: batch, not sweep (INFERRED from the failure record).**
   - Martinez-style sweeps and CGAL's surface sweep are sequential; the JS sweeps fail by status-line inconsistency after inexact splits (w8r #98, #102, #153; polygon-clipping #115, #139-#173).
   - A Bend pipeline replaces the sweep by batch passes: candidate pairs → exact pair intersections (implicit vertices) → per-curve sort → per-vertex angular sort → cycle tracing by pointer jumping → nesting by exact ray parity → face selection rule. All passes are maps, sorts or balanced reductions.
7. **Arc-preserving offset.**
   - Offsets of line/arc profiles stay lines and arcs. The raw offset uses round joins; the result is extracted from the arrangement of the raw cycle by nonzero winding (CGAL Minkowski/Wein 2007; CavalierContours slice-and-stitch).
   - The *exact* offset leaves the one-root field: line constants gain √(A² + B²), and a three-point arc with irrational R becomes R ± d. So offset is an **ε-declared** operation: round those constants one-sidedly to the grid (or use CGAL's rational tangent points) and report ε.
   - CavalierContours (MIT/Apache, Rust 0.9.0 of 2026-08) is the practical reference and a test oracle. Its f64 absolute-epsilon core is the anti-pattern: non-commutative unions, translation-dependent offsets, reversal-dependent vertex counts (C++ #71, #53; Rust #23).
8. **Conics and text.**
   - Quadratic Bézier glyph segments are parabolic arcs, i.e. conics with small integer coefficients. Exact quad/quad needs degree-4 roots (Emiris et al.: comparisons of degree 8-13).
   - Onshape itself replaces near-circular quads by arcs within ~1 µm, so a declared arc-spline approximation is compatible.
   - Ellipse/line is one-root; ellipse/curve is degree 4: refuse explicitly first.
9. **Ranked proposals** (§7): R1 region-semantics fixtures and an Onshape probe; R2 exact line/circle arrangement in Bend; R3 explicit tolerance layer; R4 face selection, nesting and stable naming; R5 ε-declared arc offset with a Cavalier oracle; R6 text via declared arc-spline, exact parabolas later; R7 ellipses (refuse, then exact line/ellipse); R8 medial axis deferred.

## 1. What wonky must reproduce

### 1.1 Current admission

`kernel/sketch-lines.bend` and `kernel/sketch-arcs.bend` accept one closed walk: every endpoint degree two, no crossings, no touching, no holes, no nested loops, no construction geometry (`docs/sketch-lines.md` l.45-53; `docs/sketch-arcs.md` l.20-60).

The arc path already contains three building blocks the general arrangement needs:

- exact endpoint incidence at a fixed native resolution `angular_guard() · max(1, |coord|)` (1e-12 relative);
- analytic finite-domain line/line, line/circle and circle/circle pair tests;
- the rule that "a square-root neighbourhood is used only to conservatively reject uncertain trim exclusions".

`kernel/profile-ring.bend` applies the host tolerance `max(1e-5, 2^-20·max|coord|)` with exact base-4096 decisions. That is the pattern the tolerance layer (R3) should follow.

### 1.2 The Onshape contract (DOCUMENTED, details in the [Onshape note](../sources/onshape-sketch-regions-sksolve-qsketchregion-semantics.md))

- `skSolve`: all edges become WIRE bodies. "Any regions enclosed in the sketch will become SURFACE bodies." Isolated points and circle centers become POINT bodies.
- `qSketchRegion(id)`: all bounded faces. With `true`: drop any face lying inside the outer boundary of another face without a shared vertex or edge on that boundary.
- Faces, not loops: overlapping rectangles give "small rectangle, large minus small". Two overlapping circles give three faces.
- Construction entities do not form regions. `newSketch` on a face imprints its edges unless `disableImprinting` (corpus: 3 files use `newSketch(`, 500 use `newSketchOnPlane`, 0 use `disableImprinting`).
- Versioned behaviour: `V87_SKETCH_REGION_ORDERING`, `V140_SKETCH_REGION_VIA_FLOOD_FILL`, `V244_SKETCH_REGION_UPDATE`, `V1073_REFINE_SKETCH_INTERSECTIONS`. Region order is not a contract.
- Unknown: the region builder's tolerance, and whether `V244` changed the nesting rule. Users report that `true` drops islands in "©"/"ʘ", which matches the documented rule (forum 5302).

### 1.3 Same input, three semantics

From the [FreeCAD/SolveSpace note](../sources/freecad-facemaker-unified-and-solvespace-loop-nesting.md). FreeCAD values come from `TestFaceMakerUnifiedPlanar.py`; the Onshape columns are INFERRED from the documented rule and need the R1 probe.

| input | Onshape `(id)` | Onshape `(id, true)` | FreeCAD Unified (2026) | SolveSpace |
|---|---|---|---|---|
| rectangle + 4 hole circles | 5 faces | 1 (plate with 4 holes) | 1 | 1 |
| two concentric circles | 2 | 1 (ring) | 1 (ring) | 1 |
| three nested squares | 3 | 1 (outer ring only) | 2 (even-odd) | 2 |
| two overlapping circles | 3 | 3 | 3 | refused ("contour is self-intersecting!") |
| circle + chord line | 2 | 2 | 2 | refused |
| circle + dangling radius | 1 | 1 | 1 | refused ("not closed contour") |
| "ʘ" (ring + island) | 3 | 1 (island dropped) | 2 | 2 |

## 2. Landscape

| source | kind | activity / venue | license | what it contributes | verdict |
|---|---|---|---|---|---|
| Onshape std `sketch.fs`/`query.fs` + staff answers | spec | FS 3083 mirror 2026-09-22 | MIT (std) | the region contract | **adopt** (spec) |
| CGAL `Arr_circle_segment_traits_2` | library | CGAL 6.2.1, 2026-09 | GPL-3.0+/commercial | one-root numbers, rational circles, overlap and tangency handling | **adapt** (ideas only) |
| Devillers et al. 2002 | paper (CGTA) | historical | paper | degree ≤ 12 circle-arc ordering, radical-axis endpoints, filters with measured failure rates | **adopt** (predicate design) |
| CGAL `Circular_kernel_2`, Emiris et al. 2004 | library + paper (SoCG) | maintenance | GPL-3.0+ | algebraic-kernel separation, points remember defining curves, degree-4 roots for conics | learn-from |
| CGAL conic + Bézier traits, Hanniel & Wein | library + paper | active; open bugs | GPL-3.0+ | fixed-degree conic resultants; filter failures on degenerate Béziers | learn-from |
| CGAL Boolean_set_operations_2 + Minkowski offsets (Wein 2007) | library + paper | active | GPL-3.0+ | convolution cycle + winding offsets, ε-approximate rational offsets, operand validity contract | **adapt** |
| CavalierContours (C++, Rust) | library | Rust 0.9.0 2026-08; C++ frozen | MIT; Apache-2.0/MIT | practical line+arc offset and Booleans; tests; war stories | **adapt** (algorithm, tests), avoid (numerics) |
| VRONI/ArcVRONI (Held, Huber) + Held & Mann 2011 | closed code + papers | industrial | proprietary | arc Voronoi offsets and medial axis; float-vs-exact measurements | learn-from / unreachable |
| Martinez-Rueda-Feito + JS ports | papers + code | w8r 2026-04 | MIT (ports) | in/out labelling semantics; sweep failure catalogue | learn-from |
| FreeCAD face makers, SolveSpace | CAD code | FreeCAD 2026-06 | LGPL-2.1 / GPL-3.0 | alternative region semantics, 42 test cases | learn-from |

Already covered elsewhere and not repeated: Clipper2 (integer polygons; [fdm-geometry](../fdm-geometry.md) l.206, 266), hot-pixel snap rounding ([robust-numerics](../robust-numerics.md) P10), the skText lattice ([skText note](../sources/onshape-sktext-layout-measured-from-step-export.md)).

## 3. State of the art by layer

### 3.1 Number models

| curve pair | vertex coordinates | exact representation | hardest predicate degree | source |
|---|---|---|---|---|
| line/line | rational | integers over one determinant | 3-4 | standard |
| line/circle, circle/circle (rational circles) | one-root `α + β√γ`, x and y share γ | `_One_root_number`, `Sqrt_extension` | ≤ 12 (x-order of two circle intersections) | CGAL; Devillers 2002 |
| conic/conic | degree-4 algebraic | root + isolating interval; resultants of degree 4 | 8-13 (comparing roots of two quartics) | Emiris et al. 2004, Prop. 1 |
| Bézier/Bézier (degree n) | roots of degree n² resultants | CORE algebraics + subdivision filter | unbounded in n | Hanniel & Wein; CGAL issues #4951, #9176, #8849 |

- **Why circles are cheap (DOCUMENTED, CGAL manual l.4553-4592).** Each subset `Q(√γ)` is a field. Identical-extension arithmetic costs about as much as rationals; comparisons across different γ need at most two squarings (`One_root_number.h` l.412-525).
- **Why Devillers' representation matters (DOCUMENTED, §2).** Represent an arc endpoint as "left or right intersection of its circle with a line". Cutting by another circle uses the radical axis `C − C1`, whose coefficients stay at degree 1 and 2. The representation is closed under splitting, so degrees never grow through the arrangement.
- **What fails in practice (DOCUMENTED).**
  - Double evaluation of the circle ordering predicate is wrong in 83-95 % of degenerate cases (Devillers table p.26).
  - The CGAL Bézier filter fails on collinear linear pieces (#8849), misses a cubic self-intersection (#4951) and segfaults in release (#9176).
  - CGAL's interval filters crash under WebAssembly because they need rounding-mode control (#9062). That warns about wonky's JS and Metal targets: filters must be built from error-free transformations and certified bounds, never from rounding modes.

### 3.2 Arrangement construction

- **Sweep** (Bentley-Ottmann; Martinez; CGAL `Surface_sweep_2`): O((n + k) log n), sequential status line. Every failure in the JS Martinez ports is a status-line inconsistency after inexact splits ("Unable to find segment in SweepLine tree", "Unable to complete output ring", infinite loops). CGAL avoids those with exact constructions but stays sequential.
- **Incremental zone insertion** (CGAL): sequential, mutation-heavy.
- **Batch (INFERRED, for Bend).** Sketches are small (sketch-arcs admits ≤ 1,024 entities; a 15-glyph text line has a few hundred quads). All-pairs candidate generation is ≤ 5·10^5 uniform pair tests; a BVH or Hilbert-packed static index (as CavalierContours uses) handles larger inputs.
  - After pair intersections, everything is local: per-curve sorting, per-vertex angular sorting, cycle tracing by pointer jumping, nesting by exact ray parity.
  - This is the structure of mesh-arrangement codes (Zhou 2016, Cherchi 2020; see [mesh-booleans](../mesh-booleans.md) §3.2) transposed to 2D curves.
- **Face labelling for Booleans.** Martinez's `inOut`/`otherInOut` is a parity walk down the status line (`compute_fields.ts` l.17-40). In batch form, every face gets a winding/in-out vector per operand, and Booleans, even-odd fill and nonzero fill become *selection rules* on the same face set (as in Zhou et al.'s winding-number extraction).

### 3.3 Region semantics

- **Loop nesting** (SolveSpace, FreeCAD Bullseye/Cheese) needs closed, non-crossing loops and decides outer/hole by containment parity, computed on chord polylines (SolveSpace `FixContourDirections`).
- **Arrangement faces** (Onshape, FreeCAD BuildFace) accept crossings, overlaps, dangling edges and chords.
- **Arrangement + fill rule** (FreeCAD Unified 2026: even-odd) makes regions of a different shape.
- One arrangement with an explicit, named selection rule serves all three. FS input uses Onshape's rule. Changing the rule is a topological-naming event (FreeCAD needed a Toponaming fix for its new face maker, #29043).

### 3.4 Exact arithmetic versus tolerant semantics (the crux)

- Held & Mann 2011 (DOCUMENTED): a GMP verifier reading FIST's inputs as decimals flagged 4.92 % of triangulations; reading the stored binary64 values it flagged 0 %. **The exact input is the stored binary value.** wonky already keeps the SI binary64 words.
- Exact arithmetic on those values faithfully reproduces *the numbers*, not the *intent*. CAD sketches are degenerate by design (shared endpoints, tangent slots, concentric holes, collinear edges). Intended tangencies computed with `sin`/`cos`, or snapped to any grid, are not exactly tangent.
  - Line/circle near-tangency: a line through an arc endpoint whose direction is off by θ crosses the circle again at chord `2r·sin θ`. The lens between the crossings has sagitta `r(1 − cos θ) ≈ rθ²/2`.
  - With binary64 inputs θ ≈ 1e-16, so chord ≈ 1e-15 mm.
  - With a 2^-17 mm grid and a 1 mm line, θ ≈ 7.6e-6: at r = 100 mm the chord is 1.5e-3 mm, while the sagitta is 3e-9 mm. Parasolid sees tangency (gap far below 1e-5 mm); an exact arrangement sees two crossings and a sliver face (INFERRED).
- Therefore:
  1. keep the snapping grid fine (sketch-local, ~48-bit);
  2. decide Onshape-semantics contacts by **gap measures** (vertex distance, lens sagitta, support distance and angle), each an exact polynomial comparison against a rational tol, not by the distance of a constructed point from a vertex.
- CavalierContours shows the anti-pattern. Its `circle_circle_intr` (`circle_circle_intersect.rs` l.55-116) tolerates a gap linearly (eps on distance) but an overlap only through point separation `2√(2rδ)`. That asymmetry is exactly the kind of inconsistency behind its issue #23 (INFERRED).
- VRONI's answer (DOCUMENTED): topology before numerics, with thresholds relaxed automatically. wonky's rule "approximations need explicit tolerances; unsupported cases must fail explicitly" instead requires a *stated* tol, exact decisions against it, and refusal where a decision would be ambiguous.

### 3.5 Offsets

| method | arcs preserved | exactness | handles self-intersection | Bend fit | source |
|---|---|---|---|---|---|
| convolution cycle + arrangement + nonzero winding | yes | exact only with conic traits (CORE); ε-approximate with rational tangent points | yes | good (map + batch arrangement) | CGAL Minkowski_sum_2, Wein 2007 |
| raw offset + intersect + slice + prune by distance + stitch | yes | f64 heuristic | yes (dual offset for open/self-intersecting input) | good (maps + endpoint matching) | CavalierContours; Liu et al. 2007 |
| Voronoi / medial axis, then offset per cell | yes | float engineering; exact arc bisectors are conics | inherently | poor (incremental, sequential) | VRONI/ArcVRONI |
| polygonize + integer offset | no | exact on the polygon | yes | good | Clipper2 |

- Irrationality (DOCUMENTED, CGAL manual l.450-480): the offset of `Ax + By + C = 0` is `Ax + By + C ± r√(A² + B²) = 0`.
- INFERRED addition: for three-point arcs (rational R², irrational R) the offset radius `R ± r` makes the squared radius irrational too. Only center-radius circles with rational R offset exactly.
- CGAL's `approximated_offset_2` replaces each irrational offset edge by two rational segments tangent at rational points of the vertex circles. It obtains them via `t ≈ tan(φ/2)`, `sin = 2t/(1+t²)`, `cos = (1−t²)/(1+t²)`, with error ≤ ε and the approximation lying outside the exact offset (`Approx_offset_base_2.h` l.404-450).
- CavalierContours 0.9.0 moved from global distance checks to local invalid-slice tracking during raw-offset construction (CHANGELOG 2026-08-19; issue #79: "without relying on global distance check which may not catch it due to epsilon"). In exact form that check is "the raw offset segment reversed direction" or "the arc radius became ≤ 0". Both are exact sign tests.

## 4. Precision mapping for wonky (INFERRED)

### 4.1 Input normalization

- Per sketch, take the extent `2^e ≥ max |coordinate|` (mm, sketch frame). Snap every input number to the grid `g = 2^(e−47)`; this is an exact power-of-two scale plus one rounding.
- Record per-point deviations (≤ g/2 ≈ 3.6e-15·extent) as provenance. For a 200 mm sketch g ≈ 1.4e-12 mm, eight orders below `zeroLength`.
- Entities, all coefficients integers:
  - line: two grid endpoints;
  - center-radius circle (`skCircle`): grid center, grid radius R, so R² is exact;
  - three-point arc (`skArc`): three grid points. Circle `D(x² + y²) − Ex − Fy + G = 0` with D = 2·cross (degree 2), E, F (degree 3), G (degree 4).
- Alternative for arcs (Devillers representation): snap the circumcenter to the grid, recompute R² from one endpoint, and represent the other endpoint (and the adjacent line's endpoint) as circle ∩ adjacent-line one-root points. Smaller integers. Near tangent joints the endpoint moves up to ≈ √(2 r g) (about 5e-6 mm at r = 10 mm, g = 1.4e-12 mm), still below tol. Choose by measurement (R2 acceptance).

### 4.2 Degree and size budget

48-bit coordinates, center-radius circles; the unit "degree 1" ≈ 48 bits.

| predicate | degree (Devillers units) | bits (≈) | base-4096 digits | U32 limbs |
|---|---:|---:|---:|---:|
| line/line orientation, incidence | 2-3 | 150 | 13 | 5 |
| line meets circle (`I = B² − AC`) | 4 | 200 | 17 | 7 |
| circles meet (`2d²(r1² + r2²) − (Δ² + d⁴)`) | 4 | 200 | 17 | 7 |
| one-root point vs line side | ~8 | 400 | 34 | 13 |
| order of two intersection points on one curve / in x (J, K, J', D, P4) | 5-12 | ≤ 600 | ≤ 50 | ≤ 19 |
| lens sagitta ≤ tol (line/circle, circle/circle) | 4 (rational R) / one squaring more (irrational R) | ≤ 400 | ≤ 34 | ≤ 13 |
| ray parity sample vs arc (nesting) | ~4-8 | ≤ 400 | ≤ 34 | ≤ 13 |

Three-point-arc circles roughly triple these sizes when kept in `D, E, F, G` form. They are still fixed per predicate and still uniform.

### 4.3 Filters

- Wonky's existing filter (`kernel/robust-predicates.bend`, `docs/robust-predicates.md`) admits only F32 exponents 87-167, so that products stay normal, and falls back to exact base-4096 digits.
- A degree-12 filter must therefore evaluate on inputs translated to a local origin and scaled by a power of two to magnitude ≤ 1. The error bound scales with the absolute-value polynomial (Devillers' semi-static filter: τ(Z) per polynomial, ~1e-15 for P4 in double, ~1e-13 expected in F32x2).
- Near-degenerate inputs (the common CAD case) fail the filter by design and take the exact path. Hence the fixed-size budget above matters more than filter speed.
- No filter may depend on rounding-mode control (CGAL #9062).

## 5. Bend pipeline (INFERRED design)

Records are immutable and fixed size. Every pass is a map, a parallel sort, a segmented scan or a balanced fork-join reduction.

1. **P0 normalize:** map FS entities to curve records `{kind, integer coefficients, endpoints, source id, construction}`; drop construction entities and isolated points (kept as POINT output only).
2. **P1 vertex merge within tol:** sort endpoints by grid key; union-find by pointer jumping over neighbour windows. Lines and three-point arcs are redefined through merged endpoints, so incidence is exact afterwards. Report every merge with its distance.
3. **P2 candidate pairs:** all pairs (n ≤ ~1,000) or a Hilbert-packed static BVH (sort keys, build levels bottom-up).
4. **P3 exact pair classification:** disjoint, 1 or 2 crossings, tangent (multiplicity 2), overlap interval.
   - Vertices are implicit: `(curve a, curve b, root index)`, radical-axis form for circle pairs.
   - Tolerance rules (R3), each an exact comparison:
     - (a) lens sagitta ≤ tol and one crossing is an existing vertex → keep only that vertex (tangent joint);
     - (b) lens sagitta ≤ tol with no anchor → refuse `NearTangentContact{needed_tol}` unless the policy opts into a tangent contact;
     - (c) supports within tol in distance and angle (collinear lines, cocircular arcs) → overlap interval;
     - (d) any other vertex inside a collapsed lens → refuse `AmbiguousContact`.
5. **P4 split:** group vertices by curve (sort by curve id), sort along the curve with the exact order predicate (merge sort), emit edges. Overlap intervals become one shared edge carrying both source ids.
6. **P5 vertex stars:** sort incident half-edges by tangent direction, ties broken by signed curvature (exact: tangents at one vertex share one √γ).
7. **P6 cycles:** `next(h) = twin(h)` rotated at its head vertex; label cycles by the minimum half-edge id via pointer jumping, O(log n) rounds. Classify each cycle by an exact turn test at its lexicographically smallest vertex (CCW = outer boundary of a bounded face).
8. **P7 nesting:** for every CW cycle and every candidate CCW cycle, exact ray parity from a rational sample point against the original curves (one-root predicates). Reduce to the innermost enclosing CCW cycle. Dangling edges and chords are handled because faces come from cycles, not from input loops.
9. **P8 faces and selection:** bounded face = CCW cycle + assigned holes. Selection rules:
   - `all` (Onshape `false`);
   - `filterInnerLoops` v1 (Onshape `true`: drop F if some G's outer boundary strictly contains F without contact);
   - `even-odd` and `nonzero` (text, build123d, Booleans), from per-face winding vectors.
10. **P9 identity:** face id = hash of the sorted multiset of (source entity id, side, piece index along the entity). It is independent of traversal order, input permutation and entity reversal.

**Uniformity.** P3-P7 are uniform per item apart from the exact fallback, whose cost is bounded by §4.2. Per-curve sort sizes vary (few vertices per curve); pad to the maximum or group by size class.

**Validation.** Hand every output region to the existing `ports/curved-validate.bend` path via extrusion. Keep OCCT as a read-only STEP oracle, as sketch-arcs does. Optionally, test-only: OCCT `BOPAlgo_BuilderFace` on the same curves (the FreeCAD BuildFace route) as an independent face-count and area oracle.

## 6. Where it plugs in

- **Sketch:** replaces the single-walk admission of `sketch-lines.bend`/`sketch-arcs.bend` for the multi-loop cases; the single-walk path becomes the degenerate case.
- **Extrude:** caps with inner loops (plates with holes), which the B-rep already has for pierced plates (corpus cluster doc l.585-590).
- **Text:** glyph regions (R6), `filterInnerLoops`, and cross-glyph lens faces.
- **2D Booleans and FDM:** per-layer section Booleans (the fdm-geometry chapter's "2D Boolean with arcs is real work", l.743) and offsets (R5); the same engine serves `section.bend` output.
- **Naming and diff:** region ids from source entities (P9); region diffs between microversions.
- **LLM ergonomics:** refusal messages name the entities, the contact type and the tolerance that would be needed. Region reports list faces, holes, nesting and what `filterInnerLoops` removed.

## 7. Ranked proposals

### R1. Region-semantics fixtures and one Onshape probe (S; first)

- **Idea.**
  - Encode §1.3 as wonky fixtures: re-derive FreeCAD's 42 planar case names, add slot, rectangle + 4 holes, "©", "ʘ", overlapping text glyphs, construction lines, dangling lines.
  - Build one probe Part Studio in Marc's Onshape account with these sketches. Record per case `size(evaluateQuery(qSketchRegion(id, b)))` and areas for b ∈ {false, true}, and export STEP.
- **Plugs in:** `fixtures/`, `test/`; no kernel change.
- **Benefit:** settles the open semantics questions (nesting rule since `V244`, tangency tolerance, dangling edges) before code exists.
- **Risk:** Onshape API budget (a handful of reads; see onshape-bridge rules).
- **First acceptance test:** probe results for "ʘ" and three nested squares are recorded. The expected-value table is DOCUMENTED instead of INFERRED.

### R2. Exact line/circle arrangement in Bend (M-L; core)

- **Idea:** §5 P0-P8 for lines, center-radius circles and three-point arcs on the sketch-local 48-bit grid, with one-root implicit vertices, Devillers-style ordering, F32x2 filter and base-4096 exact fallback.
- **Plugs in:** a new `kernel/sketch-arrangement.bend` beside `sketch-arcs.bend`, sharing its pair-test vocabulary; `src/library.mjs` skSolve admission.
- **Bend fit:** maps, sorts, pointer jumping; fixed-size exact integers.
- **Benefit:** unblocks `line-arc-sketch-with-holes.fs` (hopper rear wall), all 217 files with `filterInnerLoops = true` that need holes, overlapping circles and slots.
- **Risk:** the tangent-direction tie-break at vertices (curvature comparison) and overlap handling are the classic bug sources (CGAL #8468, Cavalier #23).
- **First acceptance test:**
  - `line-arc-sketch-with-holes.fs` extrudes, validates, and its volume matches the closed form within 1e-9 relative;
  - two overlapping circles r = 10, d = 12 give 3 faces whose areas match the closed-form lens and crescents;
  - results are invariant under entity permutation and reversal (face ids identical).

### R3. Explicit tolerance layer (M; with R2)

- **Idea:** P1 and P3 rules (a)-(d) at tol = FS `zeroLength` (1e-5 mm, configurable). Each rule is an exact comparison against a rational tol; every application is reported. Refusals carry `needed_tol`.
- **Plugs in:** the same module; the report format joins the existing sketch reports.
- **Benefit:** Onshape-compatible behaviour on degenerate-by-design CAD input without fuzzy floats; closes the "numbers versus intent" gap of §3.4.
- **Risk:** a rule set that is too permissive merges real features; one that is too strict refuses real sketches. Both are measurable on the corpus.
- **First acceptance test:**
  - a slot built from `sin`/`cos` endpoints yields exactly one face, and the report shows two anchored tangent joints;
  - a line crossing a circle with sagitta 2e-5 mm yields two crossings and three faces;
  - with sagitta 5e-6 mm and no anchor it refuses with `needed_tol ≥ 5e-6 mm`.

### R4. Face selection, nesting and stable region naming (M; with R2)

- **Idea:** P7-P9 with the selection rules `all`, `filterInnerLoops-v1`, `even-odd`, `nonzero`; winding vectors per operand for 2D Booleans (Martinez's labels in batch form).
- **Plugs in:** `qSketchRegion` in `src/library.mjs`, region provenance in `identity.bend`, the diff viewer.
- **Benefit:** FS semantics plus Booleans and fills from one structure; region ids survive reorderings (Onshape changed region order once, `V87`).
- **Risk:** the rule must match the R1 probe. Face ids must not depend on the grid snapping.
- **First acceptance test:** §1.3 table reproduced for all rows; region ids identical after reversing every entity and shuffling their order.

### R5. ε-declared arc-preserving offset with an external oracle (M)

- **Idea:**
  - Raw offset per segment (lines shifted, arcs concentric) with round joins at convex vertices (the convolution cycle).
  - Round line constants `s ± r√(p² + q²)` and irrational radii one-sidedly to the grid (or rational tangent points, CGAL-style), with ε ≤ 1e-6 mm reported.
  - Build the R2 arrangement of the raw cycle and keep faces with nonzero winding (outset) or apply the clockwise convention (inset).
  - Mark collapsed pieces by exact direction reversal (Cavalier 0.9.0's local invalid-slice idea).
- **Plugs in:** FDM compensation and clearance helpers, `opOffsetFace` cross-sections of prismatic parts (81 corpus calls are 3D, but their planar/cylindrical cases are 2D offsets of profiles; INFERRED), and later sketch offset tools.
- **Bend fit:** per-segment maps plus the R2 pipeline.
- **Benefit:** arcs stay arcs (Cavalier with native arcs ran 8-860× faster than Clipper on the same profiles polygonized to 1e-2/1e-3, C++ README tables), exact topology, explicit ε.
- **Risk:** multi-offset families and islands (Cavalier `Shape` is still pre-0.9.0); open profiles need end caps.
- **Oracle:** run CavalierContours offline (Rust, MIT/Apache; license permits vendoring its test polylines) on the same inputs. Compare areas and Hausdorff distance, plus the issue repros (Cavalier #23, #71, #79; C++ #53).
- **First acceptance test:**
  - ±0.2 mm offsets of the r10b line/arc profile agree with Cavalier within 1e-5 mm Hausdorff;
  - a circle offset is exact;
  - union results are identical under operand swap and translation by (1000.1, −333.3) mm.

### R6. Text regions (M, after R2/R4)

- **Idea:** first a declared arc-spline (biarc) approximation of glyph quads within 1 µm, matching Onshape's own ~1 µm quad→arc substitution measured in the skText note, then R2/R4 with `filterInnerLoops-v1`. Exact parabola arcs (conic degree-4 predicates on small lattice integers) later, if a case needs them.
- **Benefit:** unblocks 174 FS files.
- **Risk:** the approximation must keep glyph contours non-crossing wherever the exact contours do not cross. Guard it with a certified separation check or fall back to exact parabolas.
- **First acceptance test:** "CORNER POST R10" engraving area within 2e-5 relative of the skText note's Onshape measurement (53.3575 mm²), with lens faces for overlapping `KA` produced and extruded.

### R7. Ellipses: refuse, then exact ellipse/line (S, then M)

- **Idea:** 24 files use `skEllipse`. Admit an ellipse alone and ellipse/line intersections (one-root after substitution). Refuse ellipse/circle and ellipse/ellipse crossings with a named error until a degree-4 kernel exists.
- **Benefit:** explicit behaviour instead of wrong regions.
- **First acceptance test:** an ellipse with a chord line gives 2 faces with exact line endpoints; an ellipse crossing a circle refuses with `UnsupportedConicPair`.

### R8. Medial axis / Voronoi: defer (learn-from)

VRONI-class arc Voronoi diagrams are proprietary, sequential, and their exact predicates are heavy (conic bisectors). For FDM thin-wall checks use the R5 "opening" test (inset by w/2, outset by w/2, compare areas) instead.

## 8. Open questions

- Onshape's region-builder tolerance, and whether `filterInnerLoops` changed after forum 5302 (R1 probe).
- Whether intended tangencies in the corpus are anchored at shared endpoints (rule a) or free (rule b). Count them with a corpus scan once R3 exists.
- Three-point arcs in `D, E, F, G` form versus the Devillers endpoint representation: measure exact-path frequency and digit counts on the corpus sketches.
- Whether any corpus sketch relies on dangling-edge behaviour or imprinting (grep shows `newSketch(` in 3 files only).

## 9. Sources

- Onshape: [FS std library docs](https://cad.onshape.com/FsDoc/library.html); std mirror [yepher/feature_script_std](https://github.com/yepher/feature_script_std) (`sketch.fs` l.40-46, 142-159; `query.fs` l.1773-1793); forum [5904](https://forum.onshape.com/discussion/5904/qsketchregion-with-filterinnerloops), [11934](https://forum.onshape.com/discussion/11934/featurescript-how-to-extrude-outermost-regions-of-text-sketch-without-including-interior-cutouts), [5302](https://forum.onshape.com/discussion/5302/text-sketching-qsketchregion-filterinnerloop-detection-bug), [22826](https://forum.onshape.com/discussion/22826/trying-to-extrude-text-but-cant-filter-out-inner-loops); help [Extrude](https://cad.onshape.com/help/Content/PartStudio/extrude.htm), [Construction](https://cad.onshape.com/help/Content/Sketch/construction.htm).
- CGAL: [2D Arrangements manual](https://doc.cgal.org/latest/Arrangement_on_surface_2/index.html), [2D Circular Kernel](https://doc.cgal.org/latest/Circular_kernel_2/index.html), [Boolean set operations](https://doc.cgal.org/latest/Boolean_set_operations_2/index.html), [Minkowski sums/offsets](https://doc.cgal.org/latest/Minkowski_sum_2/index.html), repo [CGAL/cgal](https://github.com/CGAL/cgal); issues [#9281](https://github.com/CGAL/cgal/issues/9281), [#4951](https://github.com/CGAL/cgal/issues/4951), [#9176](https://github.com/CGAL/cgal/issues/9176), [#8849](https://github.com/CGAL/cgal/issues/8849), [#4818](https://github.com/CGAL/cgal/issues/4818), [#7226](https://github.com/CGAL/cgal/issues/7226), [#9062](https://github.com/CGAL/cgal/issues/9062), [#8468](https://github.com/CGAL/cgal/issues/8468).
- Papers:
  - Devillers, Fronville, Mourrain, Teillaud, CGTA 22 (2002) [HAL inria-00166709](https://inria.hal.science/inria-00166709v1);
  - Emiris, Kakargias, Pion, Teillaud, Tsigaridas, SoCG 2004 [HAL inria-00344433](https://inria.hal.science/inria-00344433);
  - Hanniel & Wein, [IEEE 4982559](https://ieeexplore.ieee.org/document/4982559/) (not read);
  - Wein, CAD 39(6) 2007 [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0010448507000279) (not read);
  - Held & Huber, CAD 41(5) 2009 [DOI](https://dx.doi.org/10.1016/j.cad.2008.08.004) (not read);
  - Held & Mann, [CCCG 2011](http://2011.cccg.ca/PDFschedule/papers/paper77.pdf);
  - Fogel, Halperin, Wein, *CGAL Arrangements and Their Applications*, Springer 2012 [DOI](https://doi.org/10.1007/978-3-642-17283-0) (metadata only).
- Code:
  - [jbuckmccready/cavalier_contours](https://github.com/jbuckmccready/cavalier_contours) (issues [#3](https://github.com/jbuckmccready/cavalier_contours/issues/3), [#21](https://github.com/jbuckmccready/cavalier_contours/issues/21), [#23](https://github.com/jbuckmccready/cavalier_contours/issues/23), [#35](https://github.com/jbuckmccready/cavalier_contours/issues/35), [#72](https://github.com/jbuckmccready/cavalier_contours/issues/72), [#79](https://github.com/jbuckmccready/cavalier_contours/issues/79));
  - [jbuckmccready/CavalierContours](https://github.com/jbuckmccready/CavalierContours) ([#24](https://github.com/jbuckmccready/CavalierContours/issues/24), [#52](https://github.com/jbuckmccready/CavalierContours/issues/52), [#53](https://github.com/jbuckmccready/CavalierContours/issues/53), [#71](https://github.com/jbuckmccready/CavalierContours/issues/71));
  - [VRONI page](https://www.cosy.sbg.ac.at/~held/projects/vroni/vroni.html); [aewallin/openvoronoi](https://github.com/aewallin/openvoronoi);
  - [w8r/martinez](https://github.com/w8r/martinez) ([#98](https://github.com/w8r/martinez/issues/98), [#102](https://github.com/w8r/martinez/issues/102), [#153](https://github.com/w8r/martinez/issues/153)); [mfogel/polygon-clipping](https://github.com/mfogel/polygon-clipping) ([#157](https://github.com/mfogel/polygon-clipping/issues/157), [#173](https://github.com/mfogel/polygon-clipping/issues/173)); [Martínez author page](https://www4.ujaen.es/~fmartin/bool_op.html);
  - FreeCAD [PR #28788](https://github.com/FreeCAD/FreeCAD/pull/28788) and `src/Mod/Part/App/FaceMaker*.{h,cpp}`;
  - SolveSpace `src/srf/curve.cpp`, `src/polygon.cpp` (local clone).
