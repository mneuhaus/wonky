# OpenSolid (Ian Mackenzie)

- Kind: CAD kernel library (Haskell, with C++ for bytecode evaluation and CDT, plus Python bindings via FFI).
- URLs:
  - Canonical: https://github.com/ianmackenzie/opensolid
  - PyPI: https://pypi.org/project/opensolid/
  - Older lineage: the Elm package https://github.com/opensolid/geometry and the GitHub org https://github.com/opensolid
- Shallow clone: `tmp/research/opensolid-ian-mackenzie/` (head `b62ffae0`, 2026-09-16).
- Authors: Ian Mackenzie (5,325 commits) and `w0rm` (78). The repo starts 2022-08-30; the OpenSolid name goes back to the earlier Elm/Scala libraries.
- License: MPL-2.0 (file-level weak copyleft).
  - Porting ideas is free.
  - Copying or translating a file keeps that file under MPL-2.0, with its source disclosed if distributed. Wonky can stay private and unlicensed, but any transliterated module should be kept separate and marked. Clean-room re-implementation of the algorithms below is simple, because they are short.
- Status (`gh api`, 2026-09-22, re-checked 2026-09-24): 5,403+ commits, 18 stars, 0 forks, 40 open issues. Releases 0.7.0 (2025-06) to 0.10.0 (2025-12-01). Last commit 2026-09-23 (`b40c4d06`, "Update Surface3D.flip ..."); 50 commits between 2026-09-15 and 2026-09-23, mostly type-level refactors (orthonormal-only transforms, `Bisection.map`, space coercions). The README says "not really ready to be used yet". About 50k lines in `opensolid-core` (Haskell plus C++ headers).
- Provenance: human-written. There is a `CLAUDE.md`, but the history is one author over four years.

## What it is
A strongly typed geometry library with an unusual numeric core:
- Every curve and surface function is a symbolic expression (`Bytecode/Ast.hs`). It is compiled to straight-line bytecode, and one templated C++ interpreter (`Bytecode/bytecode.cpp`) evaluates it on either doubles or `Bounds` (intervals).
- All geometric queries (curve/curve intersection, zeros of a surface function, tangent points, meshing, bounds) are recursive-subdivision solvers driven by those bounds, with Newton-Raphson for the final polish.

Implemented:
- 2D curves and regions; the medial axis (partial).
- 3D bodies from bounding surfaces: `Body3D.block`, `sphere`, `cylinder`, `extruded`, `revolved`, `boundedBy`, with seams matched by geometry.
- Watertight meshing; STL, glTF and Mitsuba output; minimal STEP/AP242.

Not implemented (DOCUMENTED in `TODO.txt` and open issues):
- 3D Booleans. `Csg.hs` is a 5-line enum.
- Region2D Booleans (#50), fillets, curve/surface intersection, and surface/surface intersection ("Implement Surface3D-Surface3D intersection...").

## How it works
Expression and bytecode layer (DOCUMENTED):
- `Ast1D/2D/3D` GADTs cover `T`, `U`, `V`, sum, product, quotient, sqrt, sin, cos, `BezierCurve{1,2,3}D`, dot, cross, magnitude, affine transforms, projections, `Arc2D` and `Involute2D` (for gears).
- Smart constructors simplify algebraically (`Ast.hs:553-870`: `0+x=x`, `x*1=x`, `x*0=0`, ...).
- Partial derivatives are symbolic. Each `SurfaceFunction1D` carries lazily built `(dfdu, dfdv)` and second derivatives, so bounds on `f`, `fu`, `fv`, `fuu`, `fuv`, `fvv` are all available.
- Compilation (`Bytecode/Compile.hs`) is a state monad with hash-consing. `Map Instruction VariableIndex` deduplicates identical sub-expressions (CSE), and `Map (NonEmpty Number) ConstantIndex` deduplicates constants.
- Output format: a header (`uint16` constant count, `uint16` variable count, padding), then a `double` constants table, then `uint16` opcode/operand words, then `Return`. At most 65,536 variables and constants. About 110 opcodes (`bytecode.h`), with fused forms such as `MultiplyVariableConstant3D` and `Bezier3D n`.
- Evaluation: `evaluate(words, constants, variables, dimension, out)` runs sequentially and writes each result into a register slot. The same template instantiates for `double` and `Bounds` (`opensolid_curve_value`, `opensolid_curve_bounds`, and surface variants).
- Bezier bounds over a parameter interval `[t0,t1]` use blossoming. `cubicBezier(p, Bounds t)` evaluates the blossom at `(t0,t0,t0)`, `(t0,t0,t1)`, `(t0,t1,t1)` and `(t1,t1,t1)`, i.e. the control points of the sub-segment, and takes their hull (convex-hull property). Degrees 1-5 are unrolled, with a general `bezierBlossom` for higher degrees (`bytecode.cpp:209-520`).
- Interval semantics (DOCUMENTED): `bounds.h` `Bounds` and Haskell `Interval` use plain double arithmetic with no directed rounding. Sin and cos bounds check for an extremum inside the interval via `floor((x - loc)/2pi)`.

Tolerance and decisions (DOCUMENTED):
- Tolerance is an implicit parameter: `type Tolerance units = ?tolerance :: Quantity units`, set with `Tolerance.using`. Tests run at `Length.nanometer`. `Tolerance.unitless = 1e-9` is used for parameters and directions.
- `value ^ interval` means `exclusion(value, interval) <= ?tolerance`, so intersection tests are tolerance-inflated.
- Resolution (`Interval.hs:601-618`): `resolution [lo,hi] = lo/hi` if `lo > 0`, `-hi/lo` if `hi < 0`, else 0. An interval is "resolved" when `|resolution| >= 0.5`, meaning it excludes zero and is at most 2x wide relative to its distance from zero. So sign decisions demand relative separation, not merely exclusion of zero. This keeps subsequent Newton steps well conditioned.
- `Fuzzy a = Resolved a | Unresolved`. `Unresolved` always means "subdivide further", never "guess".
- `Estimate` (`Estimate.hs`) is a lazily refinable value with cached bounds. `refine` fails with `RefinementStalled` after 10 non-shrinking steps. `resolve :: (Interval -> Fuzzy a) -> Estimate -> a` refines until the predicate decides. Sums refine the wider operand first (the factor-2 rule). This is the "exact computation paradigm" in miniature: decisions such as sign, min, max or `within tol` pull exactly as much precision as they need.

Subdivision domain (DOCUMENTED, `Domain1D.hs`):
- Parameter sub-intervals are exact dyadic rationals `Domain1D{n, i, j}`, meaning `[i/n, j/n]` with `n` a power of two. They are stored in doubles but compared by cross-multiplication. `bisect` doubles `n`; `half` gives the middle half `[(4i+d)/4n, (4j-d)/4n]`.
- `interior` shrinks by 1/8 of the width on non-boundary sides. It is used to demand that a found feature lies strictly inside, not on the cell border.
- `isAtomic` is `width <= epsilon`.

`Solve2D.search` (DOCUMENTED, `Solve2D.hs`), an overlapping 9-way subdivision with exclusions:
- A work queue holds `(Domain2D, context, RecursionType)` entries, with recursion types Quadrant, Row, Column and Central.
- A Quadrant cell spawns 9 children: 4 quadrants, 2 Column strips (middle half in u, lower or upper half in v), 2 Row strips and 1 Central cell (middle half in both). Row, Column and Central cells spawn only 3 or 1 children along their free axis.
- Effect: any feature small relative to the cell lies strictly inside some child, even when it straddles a bisection line. This is the classic fix for losing roots on cell boundaries.
- The callback returns `Return solution` (the cell becomes an exclusion zone), `Recurse ctx` or `Pass`. Cells whose convergence domain is contained in an existing exclusion are skipped. Cells overlapping an exclusion get `SomeExclusions`; the GADT then forbids returning a solution there, so they can only recurse or pass.
- Reaching an atomic cell raises `InfiniteRecursion`, an explicit failure.
- `Solve2D.unique` first checks that `fBounds(box)` contains zero, then runs Newton from the box centre (at most 10 iterations; a step clamped back into bounds along its direction; stop when `|f|` no longer decreases; accept if `f ~= 0`), and otherwise bisects into 4.

Zeros of a surface function, `SurfaceFunction1D.zeros` (DOCUMENTED, `SurfaceFunction1D.hs:523-833`, `SurfaceFunction1D/*`):
- This is the kernel of a future SSI: `f(u,v) = 0` where `f` is, for example, surface B's implicit form composed with surface A's parameterization. The output type `Zeros{crossingCurves, crossingLoops, tangentPoints :: [(UvPoint, Sign)], saddlePoints}` is a full topological classification of the zero set.
- Per cell, a `Subproblem` holds the corner values, the `f` range, and the `fu`, `fv`, `fuu`, `fuv`, `fvv` ranges.
- `isZeroCandidate` requires `f` range to meet 0 and a `tightRange` to meet 0. The tight range is sharpened by `curveRangeAt` along edges using derivative bounds.
- If `fu` or `fv` is resolved (sign-definite over the cell), the zero set in the cell is a graph `v(u)` or `u(v)`:
  - Diagonal case (both resolved): read the corner sign pattern and connect the edge crossings.
  - Horizontal or vertical case: read the edge-range signs.
  - The crossing segment is accepted only if the resulting curve's bounds stay inside the cell's `interior`; otherwise it is `Unresolved` and subdivided.
- If neither is resolved, look at the Hessian determinant `fuu*fvv - fuv^2` over the cell:
  - Positive (resolved): find the unique critical point with `Solve2D.unique` on grad f. If `f ~= 0` there, it is a tangent point with the sign of `fuu`.
  - Negative: a saddle region with a local quadratic model (`SaddleRegion.quadratic`).
  - Unresolved: "TODO check for tangent curves", so recurse.
- Crossing curves are not fitted. `HorizontalCurve.new f dvdu uStart uEnd boxes` builds a procedural `Curve2D`: at parameter `t`, `u = lerp(uStart, uEnd, t)`, and `v` comes from a monotone 1D solve `solveMonotonicSurfaceV` in bytecode (bisection plus Newton, `bytecode.cpp:1319-1370`) inside the per-`u` range of the covering boxes (`ImplicitCurveRange`). Its derivative is `(du/dt, du/dt * dvdu(u,v))` with `dvdu = -fu/fv`, and its bounds come from the slope range. The curve is exact to solver tolerance wherever it is evaluated.
- `PartialZeros.finalize` stitches segments into curves and loops across cell boundaries using the dyadic `Boundary` keys.
- Failure: `InfiniteRecursion` becomes `throw HigherOrderZero`, an explicit failure for degenerate zero sets such as tangent curves (f and grad f vanishing along a curve), and `IsZero` if `f ~= 0` identically.

Bisection trees and clusters, the newer solver architecture (DOCUMENTED at `b62ffae0`: `Bisection.hs` 162 lines, `Intersection.hs` 46 lines, `Curve/Nondegenerate/Intersections.hs`, `Surface3D/Nondegenerate/FindPoint.hs`; issue #69 "Switch `SurfaceFunction1D` solving over to using bisection and clusters ... Then should be able to remove `Solve2D` module", open since 2026-07-30):
- `Bisection.Tree domain segment = Tree {subdomain, segment, children :: ~(NonEmpty Tree)}`. It is an infinite, lazily built tree: a curve bisects `t` into two children, a surface splits its uv box into four. Each node's `segment` holds lazily computed bounds for that subdomain. The tree is stored as a field of the `Nondegenerate` curve or surface, so every query reuses the bounds already forced (memoization through laziness).
- `Bisection.pairwise tree1 tree2` is the product tree for two-object problems: domain `(t1-range, t2-range)`, segment pair, children = Cartesian product (2x2 = 4 for curve/curve).
- `Curve.Segment.new` (`Curve/Segment.hs`) is where bound quality comes from. It computes the value range `R0 = f([t1,t2])` from bytecode bounds and also a mean-value enclosure from the endpoints: `hull([p1, p1 + (w/2)*D], [p2 - (w/2)*D, p2])` with `D` the derivative range and `w` the interval width. It keeps the intersection of the two, and errors on "Curve bounds and derivative bounds are inconsistent" if they are disjoint. It also caches the derivative range, second-derivative range, tangent-direction bounds and curvature-vector bounds, plus a degeneracy flag for endpoint singularities.
- `resolve existing callback tree`: skip subtrees contained in an existing exclusion; otherwise `callback subdomain segment` returns `Resolved Nothing` (prune), `Resolved (Just tag)` (keep this cell as a candidate) or `Unresolved` (recurse into children).
- `clusters`: collect the candidate cells, build the graph whose edges join cells with tolerance-overlapping subdomains (`Set.clusters` then `Data.Graph.components`), and drop clusters that touch already known boundary solutions. This replaces the 9-way overlapping subdivision of `Solve2D`. A root that straddles a cell border simply yields a cluster of neighbouring cells instead of being lost or duplicated.
- `find callback cluster`: breadth-first search over the cluster's subtrees (a queue) until the callback returns a solution.
- `Intersection.solveInterior` fixes the solve order: tangent candidates first (`resolveTangent`), then crossing candidates with all tangent clusters as exclusions, and in both passes clusters that touch boundary solutions of the same kind are discarded.
- Dimension-ordered solving: both `Curve.Nondegenerate.intersections` and `Surface3D.findPoint` solve on the boundary first (curve endpoints, surface vertices, then edges via curve `findPoint`) and pass those solutions as exclusions to the interior search. Endpoint coincidences that are `Indistinguishable` switch to an overlap analysis (`findOverlappingIntersections`: 2 or 4 overlap endpoints, a unique overlap sign, else `Nothing`).
- The crossing resolver is two lines: `areDistinct` (value bounds do not overlap) prunes, `haveCrossingTangents` (tangent-direction bounds independent) certifies at most one transversal root. The solver then runs Newton from the cell centre and requires the result to lie inside the cell and classify as `Crossing`; otherwise `Unresolved`.
- Newton rule (`NewtonRaphson/Surface.hs`): there is no iteration cap. Keep stepping while `|f(x_{k+1})|^2 < 0.25*|f(x_k)|^2` (the residual at least halves). When it stops, accept only if the last step length is at most `Tolerance.unitless` (1e-9). The 3D variant solves the Gauss-Newton normal equations `[uu uv; uv vv] step = -[f.fu; f.fv]` in closed form. Surface point inversion uses the same machinery with uniqueness certified by `Segment.isMonotonic` (resolved derivative bounds).

Curve/curve intersection predicates, used by the bisection pipeline above (DOCUMENTED, `Curve/CrossingSolver.hs`, `TangentSolver.hs`, `Segment.hs`): segment pairs are processed as follows.
- If the segment bounds are separated (`areDistinct`), there is no intersection.
- If the tangent-direction bounds are independent (`haveCrossingTangents` via `DirectionBounds.areIndependent`), there is at most one transversal crossing. It is found by 2D Newton and classified by `continuityAt` as Crossing, Tangent sign, or Indistinguishable.
- Tangent intersections additionally require distinct curvature-vector bounds (`haveDistinctCurvatures`).
- Overlaps are returned as `OverlappingSegments sign [(Interval, Interval)]`. Degenerate cases are typed errors: `DegenerateCoincident`, `DegenerateFirstOnSecond`, `DegenerateSecondOnFirst`.

B-rep structure (DOCUMENTED, `Body3D.hs:280-360`): a body is a `Set3D` (bounding-volume tree) of trimmed `Surface3D`. `boundedBy` matches half-edges to seams geometrically within tolerance and fails with `EmptyBody`, `BoundaryHasGaps` or `BoundaryIntersectsItself`. Meshing shares leading-edge vertices per seam so that it is watertight, uses per-surface uv segment sets, and triangulates with CDT (C++ `CDT/*`, with its own copy of Shewchuk `predicates.h`).

## Robustness and guarantees
- Certified in the interval sense, but only up to rounding (INFERRED from code). The logic is sound: bounds decide, Newton only polishes inside a region already proven to contain at most one solution. But the bounds use round-to-nearest doubles with no outward rounding, and `^` is tolerance-inflated, so "certified" means certified modulo ulp-level and tolerance-level effects.
- Explicit failure instead of silent wrong answers: `HigherOrderZero`, `InfiniteRecursion`, `RefinementStalled`, the typed curve-intersection degeneracies, and the `BoundedBy` errors. This matches wonky's "unsupported must fail explicitly" rule.
- Known holes (DOCUMENTED TODOs in `SurfaceFunction1D.hs:565-567, 619-621`): zeros on the unit-domain boundary (including curves emanating from a boundary saddle) and tangent curves are not handled. The latter matters for CAD: tangent and coincident face pairs, and fillet-tangent faces, are exactly where SSI is hardest, and here they would end in `HigherOrderZero`.
- The author is replacing the queue-based `Solve2D` with "bisection and clusters" (#69, 2026-07-30). Curve/curve intersection and surface point inversion already use the new `Bisection` module; `SurfaceFunction1D.zeros` (the future SSI kernel) still uses `Solve2D`. So the zeros algorithm described above is not final (DOCUMENTED: `grep` finds `Solve2D` only in `SurfaceFunction1D.hs` and `Solve2D.hs`).
- The cluster step is a trust point (INFERRED from code): the "at most one root" certificate is per cell, but `find` returns a single `Maybe solution` per cluster. If two distinct roots sit in adjacent candidate cells, they merge into one cluster and only one is returned. The code does not argue why the tangent-direction predicate would exclude this geometrically. A port should either certify uniqueness over the cluster's union (re-run the predicate on the hull of the cluster) or return all solutions found in the cluster and deduplicate (as `Curve1D/Bisection.deduplicate` does in 1D).

## Parallelism and performance
- No benchmark numbers are published (none found in the repo or README; searched 2026-09-22).
- The geometry algorithms are sequential Haskell. Only `IO/Parallel.hs` (`Control.Concurrent.Async`) exists for IO-level concurrency, and the executables use `-threaded -N`. Issue #37 ("Profile with ThreadScope to check for parallelization issues") suggests parallel use is intended.
- The performance strategy is to compile once, evaluate many times: bytecode in C++ via FFI, unboxed `Double#` fields, a custom `primops.cmm`, and an open issue #39 on optimizing bytecode and AST simplification.

## Known failures, limitations, war stories
- No 3D Booleans, fillets or SSI (TODO.txt). The seam matching in `boundedBy` assumes that the user-supplied surfaces already meet exactly.
- `Solve2D`'s global exclusion list is scanned linearly per cell (`List.filter (Domain2D.overlaps subdomain)`, with "TODO optimize"). The worst case is quadratic in the number of solutions.
- Newton-Raphson in `Solve2D` is capped at 10 iterations (the newer `NewtonRaphson.Surface` uses the residual-halving rule instead). Neither has a Krawczyk or Kantorovich uniqueness proof; uniqueness comes from resolved-sign derivative bounds (for curves, independent tangent-direction bounds).

## Relevance for wonky
Architectural twin in spirit: pure-functional, geometry as expressions, decisions by bounds, explicit failure. Concrete fits with Bend:
- Dyadic domains `(level, index)` map perfectly onto U32 pairs: exact, no floating-point comparisons, cheap containment and adjacency tests. Adopt as the cell identity for all subdivision solvers (SSI, meshing, point location).
- The 9-way overlapping subdivision is a balanced tree of independent cell evaluations, ideal for Bend fork-join and for GPU level-by-level expansion with uniform per-cell work.
  - The sequential exclusion list must be restructured (INFERRED): expand level by level in parallel, collect `Return` cells, then deduplicate in a join step by dyadic containment (sort by level and index). Once a cell is excluded, its overlapping descendants get the `SomeExclusions` treatment.
- The newer bisection-plus-clusters design fits Bend better than the 9-way queue (INFERRED):
  - Bend has no lazy infinite trees or memoization, so materialize the tree level by level with a U32 depth budget. Recomputing a cell's bounds is uniform work (one bytecode or ADT evaluation per cell) and therefore GPU-friendly.
  - `resolve` is a pure fork-join recursion (`Unresolved` forks into 2 or 4 children, the others return a leaf list), with no shared queue or global exclusion list.
  - Clustering becomes a divide-and-conquer merge: dyadic cells from the left and right subtrees are adjacent only across the split line, so components are merged at each join by comparing boundary cells. Wonky can key cells by `(level, index)` U32 pairs and test adjacency exactly, without the tolerance-inflated `^` overlap OpenSolid uses.
  - The two-pass order (boundary solutions first, then tangent clusters, then crossing clusters with tangent exclusions) is a fixed pipeline of such recursions.
  - Take `Curve.Segment.new`'s bound tightening (intersect the direct range with the mean-value enclosure from the endpoints) as-is: it costs one extra derivative bound per cell and removes most of the overestimation of plain interval evaluation.
  - The Newton rule "continue while the residual halves, then accept if the last step is at most tol" needs no iteration cap and terminates in floating point. In F32x2, tol must sit well above the double-word ulp (about 2^-44 relative), not at 1e-9 absolute for large parameters.
- The bytecode idea maps onto Bend only partly. Bend cannot JIT or load code at runtime, and the native build is a standalone program.
  - Options (INFERRED): (a) interpret a small instruction list with a register tuple/tree in Bend (uniform work per instruction, GPU-friendly if every lane runs the same program over different cells, which is exactly the subdivision case); (b) keep the expression tree as a Bend ADT and evaluate it recursively with sharing via `let`, relying on interaction-net sharing for CSE; (c) have wonky's JS frontend emit specialized Bend source per model (staged compilation) for the native and Metal builds.
  - The same interpreter must run on F32x2 scalars and on F32x2 intervals (one evaluator, two numeric instances, exactly as OpenSolid's C++ template does).
- Wonky must add what OpenSolid omits: outward-rounded interval arithmetic in F32x2. The cheap option is to widen each result by a relative bound of about 2^-44 plus an absolute underflow floor. Without it, the certification story does not survive F32x2 (INFERRED).
- The zeros algorithm is the certified SSI candidate for wonky's blocked plane/cylinder and future quadric pairs. For quadrics, `f` is B's implicit polynomial composed with A's (cos u, sin u, v) parameterization, so bounds are tight and cheap.
  - Output: crossing curves as procedural implicit curves, evaluated to any precision by a monotone 1D solve. This is a natural "exact B-rep edge" representation for wonky's analytic-recovery hybrid: store (face A, face B, uv box chain, monotone axis) instead of a fitted spline.
  - Tangent points and saddles come out as explicit, typed topology rather than as sampling accidents. That answers the "marching SSI gives point dust" problem: topology is decided by bounds; marching is replaced by a certified 1D solve per evaluation.
- `Estimate` with `resolve` is a clean pattern for lazily precise decisions (volume sign, nearest face, which root is smaller) under fuel limits. In Bend it is a recursive refine with a U32 fuel counter.
- The resolution criterion `lo/hi >= 0.5` is a cheap, scale-free "well-separated sign" test worth adopting for subdivision termination.
- LLM ergonomics: units and space as phantom types, typed errors, and `Fuzzy` versus `Result` separation. Wonky's FeatureScript frontend already has units, but the Resolved/Unresolved/Err trichotomy is a good internal API discipline.

## Pointers worth porting or studying
- `opensolid-core/src/OpenSolid/Bisection.hs` (whole file, 162 lines: `Tree`, `pairwise`, `resolve`, `clusters`, `touching`, `find`), `Intersection.hs` (`solveInterior`, the tangent-then-crossing order), `Curve/Nondegenerate/Intersections.hs` (boundary-first, overlap analysis), `Surface3D/Nondegenerate/FindPoint.hs` (surface point inversion on the same scheme), `Curve/Segment.hs:new` (mean-value bound tightening), `NewtonRaphson/Surface.hs` (residual-halving Newton, closed-form Gauss-Newton in 3D), `Curve.hs:207-219` and `SurfaceFunction3D.hs:223-235` (`buildBisectionTree`).
- `opensolid-core/src/OpenSolid/Solve2D.hs` (whole file, 287 lines, slated for removal by #69): `process`, `recurseInto` (9-way), `convergenceDomain`, `solveUnique`, `solveNewtonRaphson`, `boundedStep`.
- `opensolid-core/src/OpenSolid/Domain1D.hs`, `Domain2D.hs` (dyadic domains, `interior`, `half`).
- `opensolid-core/src/OpenSolid/SurfaceFunction1D.hs:523-833` (`zeros`, `findZeros`, `findTangentSolutions`, `crossingCurve`, `diagonalCrossingCurve`, `horizontalCurve`) and `SurfaceFunction1D/{Subproblem,PartialZeros,SaddleRegion,HorizontalCurve,VerticalCurve,ImplicitCurveRange,Internal}.hs`.
- `opensolid-core/src/OpenSolid/Bytecode/{Ast,Compile,Instruction}.hs`, `bytecode.h`, `bytecode.cpp` (blossom bounds `209-520`, `newtonRaphson`/`solveMonotonic` `1319-1370`, the C ABI), `bounds.h`.
- `opensolid-core/src/OpenSolid/Interval.hs:601-618` (resolution), `Estimate.hs`, `Fuzzy.hs`.
- `opensolid-core/src/OpenSolid/Curve/{CrossingSolver,TangentSolver,Segment,Intersections}.hs`.
- `opensolid-core/src/OpenSolid/Body3D.hs:280-360` (`boundedBy`, seam registration, watertight meshing).

## Verdict: adapt
The subdivision solver design is small, clean and very close to Bend's execution model:
- dyadic cells;
- bisection trees with cached per-cell bounds, resolved by a pure recursion and grouped into clusters (the current direction; the older 9-way overlapping recursion with exclusions is the fallback reference);
- boundary-first, tangent-before-crossing solve order with lower-dimensional solutions as exclusions;
- resolved-sign derivative tests for graph-like zero sets;
- the Hessian test for tangent points and saddles;
- procedural implicit curves;
- one evaluator over scalars and intervals, with blossom bounds for Beziers.

Re-implement it clean-room in Bend, with outward-rounded F32x2 intervals and a parallel level-by-level queue. Do not expect finished 3D Booleans, fillets or SSI from this source: those are TODO, and tangent-curve zero sets end in explicit failure. MPL-2.0 permits reading, and file-level copying only with MPL obligations.
