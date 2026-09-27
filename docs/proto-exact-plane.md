# Bake-off prototype `exact-plane`: exact plane-based mesh Boolean (EMBER-style)

Status: 23 September 2026. This is a prototype for the Boolean bake-off
(docs/bakeoff.md). Its input is `mesh` (`<case>.job`: the CSG tree, the face
table and the tagged leaf meshes). Bend computes all the geometry
(`kernel/proto/exact-plane/*.bend`). JS only runs, validates and reports;
`tools/stats.mjs` is a reporting tool.

**What "exact" means here.** Input vertices are quantized once to an integer
grid of 2^-24 mm (measured displacement below 2.98e-8 mm). After that, every
plane, every constructed vertex and every predicate is exact integer
arithmetic. Vertices are never rounded during the Boolean, so iterated CSG
accumulates no error; the 20-operand chain and the 100-hole plate are covered
by the corpus. There is one other approximation: the exact vertices are
rounded once onto the F32x2 wire format, as a floor onto the 2^-36 mm grid.
That displacement is below 1.46e-11 mm per coordinate; it is measured and
printed with every result. Nothing else is merged, snapped or perturbed. If
the rounded mesh fails the exact orientation check or the closed-2-manifold
check, the job is refused and the reason is given.

**Result.** Every one of the 38 cases runs on all four targets (JS, native CPU
at 1 and 18 threads, Metal), with byte-identical outputs across targets:
36 pass and 2 expected refusals.
- The 36 passing cases (35 solids plus the empty self-subtract) are valid
  according to the validator: watertight, consistently oriented, free of
  self-intersections and tag-valid.
- Their volume matches manifold3d on the same fixture meshes within 5.5e-9
  relative (the 2^-24 mm input quantization). Component count and Euler
  characteristic are equal.
- The two tangent-contact cases are refused as non-manifold contact, which is
  the expected answer.
- The Metal build runs one device pass per case (the certified pair filter).
- cpu1 -> cpu18 speed-up is 1.7-4x on the cases above 100 ms (shared
  machine; small cases are dominated by fixed costs). Metal is slower than
  cpu18 on every case. Timings: see "Measured results".

## Algorithm

`main.bend`: `run = show(solve(parse(job)))`, with
`solve = post(dev(pre(p)))`. The three stages are:

1. **pre, on the host** (`setup.bend`, `geom.bend`, `main.pre`).
   - *Quantization.* Every leaf vertex coordinate `x = hi + lo` is rounded to
     the nearest integer `X = round(x 2^24)`, in exact arithmetic on the
     F32x2 bits (`geom.quantize`). The box is |x| < 1024 mm (|X| < 2^34);
     anything outside it is refused.
   - *Plane-based triangles* (Campen & Kobbelt 2010). Each triangle becomes
     its support plane `a x + b y + c z + d = 0` with integer coefficients
     (the cross product of its edge vectors) and three edge planes. Each edge
     plane goes through its edge, contains the dominant axis direction of the
     support normal, and is oriented so that the triangle lies on its
     negative side. The triangle also keeps its exact grid corners.
   - *Plane ids.* Every input plane gets a unique id: 4 t for the support
     plane of triangle t, 4 t + 1..3 for its edges.
   - *BVH forest.* One BVH per leaf, built in parallel. Each is a parallel
     median split over F32 boxes, padded to contain the exact boxes. The
     per-leaf roots are joined by a balanced tree. A query for "the other
     leaves" skips the subtree of its own leaf at that leaf's root
     (`setup.find_other`). Before this change, every query walked its own,
     densely overlapping leaf; on `fine-spheres-50k` the stage went from
     2.35 s to 0.87 s at 1 thread.
   - *Candidate lists.* A balanced fork over the triangles produces, for each
     triangle t, the list of triangles of other leaves whose boxes meet t's
     box. The same fork tree carries the flat F32 jobs of the device filter.
2. **dev, the device pass** (`device.bend`, `main.dev`: `D.dmap!(dt)`). This
   is a *certified pair filter*. For each candidate pair (t, b), the float
   filter of the plane-side predicate is evaluated on flat F32 hi/lo words
   (no Big integers). It uses exactly the arithmetic and error bound of
   `geom.side.filtered`, for two tests:
   - the three corners of b against t's support plane;
   - the three corners of t against b's support plane.

   If either triple is certified strictly on one side, t and b are disjoint
   as closed sets. The pair is then dropped. The filter never certifies a
   zero, so a pair with a shared vertex or a coplanar pair is never dropped
   (the unit test checks this against BigInt determinants). Dropping is a
   pure shortcut: a disjoint b cannot split t. The second test is new
   compared with the one-sided "b apart from t's plane" test. On
   `fine-spheres-50k` it certifies 7,510 of 11,620 pairs and raises the
   number of free triangles from 48,735 to 49,673. It also cuts the exact
   arrangement and classification work there from about 500 ms to 50 ms at
   18 threads.
3. **post, on the host**:
   - *Relations, once per triangle* (`arrange.kinds`). The remaining
     candidates are classified exactly against t's support plane: coplanar,
     strictly straddling, edge in the plane, vertex touching, or strictly
     apart. If every candidate is strictly apart, or there are none, t is
     **free**: its closure is at positive distance from all other surfaces,
     so it stays one uncut piece.
   - *Local arrangement per triangle* (`arrange.bend`, `poly.bend`).
     EMBER's local-arrangement "cell" is here one input triangle: the
     triangle's own plane is the arrangement plane. A triangle with more than
     16 cutting candidates is subdivided adaptively by axis-aligned integer
     planes, which bisect the longest side of the cell box. This is EMBER's
     adaptive octree, restricted to the triangle. Each cell is arranged
     independently, in a fork.

     Pieces are convex: a support plane plus a cyclic list of edge planes,
     with start vertices cached as exact homogeneous points `(X, Y, Z, W)`,
     W > 0. They are split exactly in two situations:
     - *Coplanar candidate.* If a coplanar candidate b of another leaf
       overlaps the piece (exact separating-axis test with edge planes), the
       piece is clipped by b's three edge planes. Coincident regions
       therefore become identical pieces.
     - *Straddling candidate: a segment-bounded cut.* This applies when the
       intersection segment of b with t's plane reaches the piece interior.
       For every segment end strictly inside the piece, the piece is first
       split by the edge planes of b through that end; the part outside b is
       final. The remainder is then split by b's support plane.

       Cutting the whole piece by b's plane (an unbounded BSP cut) produced
       hair-thin wedges between the nearly parallel cuts of two almost
       coplanar neighbours of b (sphere tessellations). The 2^-36 mm export
       grid could not represent those wedges without flipping triangles.
       Bounded cuts removed all of them and halved the piece count.

     Split planes are always input planes (face, edge or axis planes), never
     derived ones. Every vertex is therefore an intersection of three input
     planes, and integer widths stay bounded (see "Numeric model").
   - *Classification* (`classify.bend`). Within a triangle, no other leaf's
     surface crosses a piece's interior, so the parity of every other leaf is
     constant just above and just below the piece.
     - *Interior point.* A dyadic point q is chosen: the centroid, or a mix of
       centroid and a vertex, at 2^-8, 2^-24 or 2^-40 grid units. It is
       verified strictly inside with exact predicates.
     - *Ray.* An exact axis ray along the dominant axis is cast against the
       other leaves' triangles (a BVH query over the ray box, with the own
       leaf skipped). Each test is an exact 2D orientation of the projected
       point (filtered) plus a plane-side test.
     - *Parity.* A crossing flips the leaf parity on both sides. A coplanar
       triangle flips it only on the side the ray leaves through. A coplanar
       triangle of a lower-numbered leaf marks the piece as a duplicate, so
       only one of two coincident faces is kept.
     - *Degenerate cases.* Any touching configuration (q on a projected edge,
       the ray lying in a plane) is degenerate, and the next candidate point
       is tried. If none is left, the result is `unresolved`.
     - *Decision.* The CSG tree is evaluated with the piece's own leaf inside
       below the piece and outside above it. The piece is kept if the two
       results differ, and flipped if the result above is inside.
   - *Free components* (`comps.bend`). Free triangles are grouped by
     union-find over triangle and vertex nodes; leaf meshes share vertex
     indices along seams. A vertex-connected set of free triangles lies at
     positive distance from all other surfaces, so the whole set gets one
     keep/flip decision. One exact ray per component, in a fork, classifies
     all its members.
   - *Assembly* (`assemble.bend`).
     - *Points.* Kept pieces become triangles on shared output points. Every
       exact vertex is rounded once: floor of X 2^12 / W on the 2^-36 mm
       grid, using a float quotient estimate plus an exact remainder
       correction. Grid points (W = 1) are copied exactly.
     - *Deduplication.* Points are sorted by rounded position with a parallel
       merge sort (`psort.bend`) and deduplicated. An exact identity check
       counts distinct exact points that round onto one grid point.
     - *T-junctions*, resolved exactly. Every output point lying on the open
       edge of a kept piece is inserted into that edge, ordered exactly along
       it. "On the open edge" means on the piece's support plane and edge
       plane, and strictly inside the neighbouring edge planes (exact tests).
     - *Triangulation.* Each augmented convex polygon is ear-clipped at
       strict corners only, best-shaped ear first. If a greedy triangle would
       flip after rounding, an O(m^3) max-min-height triangulation takes
       over. Every triangle's orientation is checked exactly on the rounded
       coordinates, projected along the piece's dominant axis.
     - *Tags* are the input triangle tags. Every output triangle lies on its
       source triangle's plane, hence on the tagged analytic surface within
       the fixture deviation.
   - *Finish* (`finish.bend`). Triangles collapsed by rounding are dropped
     and counted. The mesh must have every directed edge exactly once, with
     its reverse exactly once (two edge-key sorts, in parallel), and no
     flipped triangle. If a check fails although nothing moved at export (no
     collision, no flip, no collapsed triangle), the *exact* result itself is
     not a closed 2-manifold: its surface touches itself. The job is then
     refused as `non-manifold contact`. Otherwise it is refused as a rounding
     failure. Neither happens in the corpus, except for the two
     tangent-contact cases, which must be refused.

After `end`, the result carries one deterministic report line, which the
result parsers ignore (example: `hex-nut`):

```
exact-plane grid_mm 2^-24 export_grid_mm 2^-36 quantization_max_fm 27937 export_rounding_max_fm 15 pieces 5291 device_pairs 21276 device_disjoint 1742 predicates_filtered 1068884 exact_nonzero 20 exact_zero 85456 symbolic_zero 459 vertices_built 9030
```

The two deviations are in femtometres (1e-12 mm), rounded up. The counters
cover all phases. Because `device_disjoint` is part of the result text, the
byte-identical results across targets also show that the Metal pass
certified exactly the same pairs as the CPU pool and the JS target.

## Upstream sources and license

No third-party code was copied or ported. The implementation was written in
Bend from the published descriptions, so the only obligation is citation.

| idea | source | where |
|---|---|---|
| plane-based polygons (support plane + edge planes); vertices as intersections of three planes; exact plane-side predicate; no rounding during the Boolean | Campen & Kobbelt, "Exact and Robust (Self-)Intersections for Polygonal Meshes", CGF 29(2), Eurographics 2010 | `geom.meet`, `geom.side`, `poly.split`, `setup.mk_tri` |
| integer grid quantization of the input; bounded bit widths because split planes are input planes only; float filter with exact fallback; local arrangements in adaptive cells; per-piece classification by exact rays | Trettner, Nehring-Wirxel, Kobbelt, "EMBER: Exact Mesh Booleans via Efficient & Robust Local Arrangements", ACM TOG 41(4), SIGGRAPH 2022 | `geom.quantize`, `arrange.cell/prep`, `classify.classify` |
| iterated CSG without error accumulation; BSP-style restricted cuts inside cells | Nehring-Wirxel, Trettner, Kobbelt, "Fast Exact Booleans for Iterated CSG using Octree-Embedded BSPs", CAD 135, 2021 | `arrange.cut_one/cut_str` (with the segment-bounded pre-cut added here) |
| filtered predicates (static error bound, exact fallback) | Shewchuk 1997 (the idea only); `kernel/robust-predicates.bend` of this repo | `geom.side`, `device.fside`, `classify.orient`, `geom.parallel.f` |
| signed multi-limb integers | structure of the Big integer in `kernel/robust-predicates.bend` (this repo); the radix 2^16, the division and the approximations are new | `big.bend` |
| balanced fork tree ending in flat loops; one device pass between IO steps | `.tools/bend-2.0.25/guide/SHADERS.md`; the staging pattern of `kernel/proto/corefine` (this repo) | `device.dmap`, `main.pre/dev/post`, `native.bend` |

How this differs from EMBER:
- The cell is a triangle, with an axis-aligned subdivision inside it, rather
  than a global octree cell holding all polygons.
- Classification is per piece by ray casting, rather than by propagating
  winding numbers from a cell corner. Propagation is done only for provably
  free components.
- The output is a triangulated mesh on the 2^-36 mm F32x2 grid.

## Numeric model and guarantees

- **Quantization**, the one geometric approximation of the input:
  `X = round(x 2^24)`, |x| < 1024 mm. Displacement is at most 2^-25 mm =
  2.98e-8 mm per coordinate (measured maximum 2.98e-8 mm). Fixture vertices
  lie on their surfaces within 5e-12 mm, so quantized vertices lie within
  5.2e-8 mm of the analytic surfaces, far below the 0.004-0.01 mm
  tessellation deviation. This is the source of the 0 to 5.5e-9 relative
  volume difference against manifold3d, which Booleans the unquantized
  double-precision meshes (the difference is at most area x 3e-8 mm). A finer
  grid costs bits, not correctness: each extra bit of grid resolution adds 3
  bits to a vertex W. A triangle that is degenerate after quantization is
  refused.
- **Planes.**
  - Input face planes: |a|, |b|, |c| < 2^71 and |d| < 2^107 (B = 34-bit
    coordinates).
  - Input edge planes: |n| < 2^36 and |d| < 2^70.
  - Axis planes are tiny.
- **Vertices.** `X_i = -(d1 (n2 x n3) + ...)` and `W = n1 . (n2 x n3)`. In the
  worst case |W| < 2^215 and |X| < 2^251.
- **Predicate widths.** The plane-side predicate `a X + b Y + c Z + d W` then
  needs at most 9 B + 19 = 325 bits (21 limbs of 16 bits). The observed
  maxima are in the statistics table below:
  - vertex X/Y/Z up to 192 bits, W up to 160 bits;
  - plane normals 64 bits, plane offsets 96 bits;
  - so about 256-bit predicates.

  Most vertices are much smaller: grid points are 34-bit with W = 1.
- **Big integers** (`big.bend`) are signed and variable length, stored as
  little-endian 16-bit limbs in U32 words. A limb product plus carry stays
  below 2^32, so there is no U32 overflow. Variable length was kept over
  fixed-width arrays because typical operands are 1-4 limbs (axis-aligned CAD
  input) and the worst case is 21 limbs.
- **Float filter** (`geom.side`, and the identical arithmetic in
  `device.fside`).
  - *Scaling.* Each Big is approximated by an F32x2 (about 48-bit mantissa)
    after scaling by a power of 2^16 shared by the plane (or by the vertex),
    so the F32 exponent never overflows.
  - *Certification.* The sign is certified when
    |f| > 2^-40 M + 2^-44 S + 1e-28, where M is the sum of term magnitudes
    and S the sum of operand magnitudes. The true error of the
    approximations and of the F32x2 operations is below 2^-44 of those
    terms, so the bound holds with a wide margin.
  - *Device arithmetic.* The bound relies on IEEE F32 rounding without
    contraction (Dekker products in `real.bend`). The Metal runtime of Bend
    2.0.25 compiles with `MTLMathModeSafe`, and CUDA with `--fmad=false`. The
    certified-pair counts are identical on all targets (see the report line).
  - *Zeros.* The filter never certifies a zero. A zero is either **symbolic**
    (the plane is one of the three input planes that define the vertex, known
    by id, so exact by construction) or computed exactly.
  - The same scheme filters the 2D orientation in classification and the
    parallelism test of plane normals.
- **Export.** Coordinates are floor(X 2^12 / W) 2^-36 mm (|X/W| < 2^35 grid
  units, so the quotient fits the F32x2 mantissa exactly). Displacement is
  below 2^-36 mm = 1.46e-11 mm per coordinate; the measured maximum is printed
  with every result. The Hausdorff distance of the output from the exact
  Boolean of the quantized input is below sqrt(3) 2^-36 mm = 2.5e-11 mm. From
  the Boolean of the fixture meshes, it is additionally at most 2.98e-8 mm
  (quantization).
- **Determinism.** The fork structure depends only on the input sizes, and
  the device filter only drops pairs that the exact path would not cut
  anyway. Every target produces byte-identical results; the runner checks
  this as `targetsAgree`.
- **Refusals**, all with a reason:
  - malformed job;
  - coordinate outside the +-1024 mm box;
  - triangle degenerate after quantization;
  - degenerate construction, including an internal stage-shape mismatch;
  - no generic interior point for a piece;
  - T-junction ambiguity;
  - rounding failure;
  - non-manifold contact of the exact result.

### Bit widths, filter hit rate, and the cost of exact fallbacks

`node kernel/proto/exact-plane/tools/stats.mjs` produced the table below,
native at 18 threads. Column notes:
- *device pairs / disjoint*: the pairs sent to the device filter, and those
  it certified disjoint.
- *filter hit*: filtered signs among all decided signs, with and without the
  symbolic zeros.
- *max bits*: the largest integers among the kept pieces.

| case | input tris | device pairs / disjoint | pieces | free tris / comps | predicates | filter hit (all / arithmetic) | exact != 0 | exact = 0 | symbolic = 0 | built vertices | max bits X / W / n / d | T-junctions | export | quant err mm | export rounding mm |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| leaf-cylinder | 224 | 0 / 0 | 224 | 224 / 1 | 3 | 100.000% / 100.000% | 0 | 0 | 0 | 0 | 32 / 16 / 64 / 80 | 0 | ok | 2.85e-8 | 0.00e+0 |
| box-union-overlap | 24 | 48 / 0 | 53 | 12 / 2 | 1336 | 85.404% / 85.919% | 0 | 187 | 8 | 57 | 176 / 144 / 64 / 96 | 15 | ok | 0.00e+0 | 1.46e-11 |
| box-subtract-overlap | 24 | 48 / 0 | 53 | 12 / 2 | 1320 | 85.833% / 86.094% | 0 | 183 | 4 | 57 | 176 / 144 / 64 / 96 | 11 | ok | 0.00e+0 | 1.46e-11 |
| box-intersect-overlap | 24 | 48 / 0 | 53 | 12 / 2 | 1292 | 86.610% / 86.610% | 0 | 173 | 0 | 57 | 176 / 144 / 64 / 96 | 4 | ok | 0.00e+0 | 1.46e-11 |
| box-rotated-intersect | 24 | 144 / 40 | 129 | 0 / 0 | 4722 | 90.640% / 90.986% | 0 | 424 | 18 | 204 | 176 / 144 / 64 / 96 | 23 | ok | 2.46e-8 | 1.46e-11 |
| box-coplanar-union | 24 | 64 / 0 | 46 | 10 / 2 | 1504 | 80.652% / 81.029% | 0 | 284 | 7 | 42 | 176 / 144 / 64 / 96 | 9 | ok | 0.00e+0 | 1.46e-11 |
| box-coplanar-subtract | 24 | 160 / 0 | 36 | 4 / 1 | 2215 | 64.289% / 64.347% | 0 | 789 | 2 | 18 | 176 / 144 / 64 / 96 | 2 | ok | 0.00e+0 | 1.46e-11 |
| box-touching-merge | 24 | 168 / 0 | 24 | 4 / 2 | 1322 | 59.758% / 59.758% | 0 | 532 | 0 | 0 | 32 / 16 / 64 / 96 | 0 | ok | 0.00e+0 | 0.00e+0 |
| box-touching-partial | 24 | 40 / 0 | 35 | 12 / 2 | 1009 | 81.962% / 81.962% | 0 | 182 | 0 | 20 | 144 / 112 / 64 / 96 | 10 | ok | 0.00e+0 | 0.00e+0 |
| plate-through-hole | 172 | 640 / 32 | 692 | 88 / 3 | 21637 | 90.766% / 91.557% | 0 | 1811 | 187 | 1040 | 176 / 144 / 64 / 96 | 184 | ok | 2.84e-8 | 1.46e-11 |
| plate-blind-hole | 156 | 288 / 8 | 392 | 82 / 3 | 9966 | 90.548% / 91.531% | 0 | 835 | 107 | 470 | 176 / 144 / 64 / 96 | 86 | ok | 2.75e-8 | 1.46e-11 |
| plate-blind-pocket | 24 | 32 / 0 | 46 | 14 / 3 | 1010 | 87.030% / 87.637% | 0 | 124 | 7 | 44 | 176 / 144 / 64 / 96 | 14 | ok | 0.00e+0 | 1.46e-11 |
| plate-counterbore | 300 | 5568 / 80 | 1812 | 40 / 2 | 159659 | 88.525% / 88.720% | 0 | 17970 | 351 | 2954 | 176 / 144 / 64 / 96 | 412 | ok | 2.65e-8 | 1.46e-11 |
| plate-countersink | 380 | 4000 / 352 | 2313 | 80 / 3 | 135907 | 92.981% / 93.423% | 4 | 8892 | 643 | 3854 | 176 / 144 / 64 / 96 | 518 | ok | 2.97e-8 | 1.46e-11 |
| plate-4-holes | 524 | 2048 / 256 | 2100 | 264 / 9 | 74314 | 91.603% / 91.956% | 0 | 5955 | 285 | 3152 | 176 / 144 / 64 / 96 | 518 | ok | 2.65e-8 | 1.46e-11 |
| plate-hole-grid-10x10 | 11212 | 44800 / 4576 | 46767 | 5608 / 201 | 2498189 | 94.840% / 95.234% | 0 | 118564 | 10331 | 71030 | 176 / 144 / 64 / 96 | 8786 | ok | 2.89e-8 | 1.46e-11 |
| tilted-holes-17deg | 524 | 2048 / 184 | 2152 | 264 / 9 | 127557 | 95.660% / 95.958% | 0 | 5140 | 396 | 3244 | 176 / 144 / 64 / 96 | 466 | ok | 2.97e-8 | 1.46e-11 |
| pipe-tee | 784 | 10880 / 128 | 4539 | 228 / 4 | 356588 | 90.666% / 90.808% | 0 | 32728 | 555 | 7422 | 176 / 144 / 64 / 80 | 1034 | ok | 2.97e-8 | 1.46e-11 |
| steinmetz-intersect | 416 | 2432 / 0 | 1248 | 208 / 4 | 58768 | 92.026% / 92.026% | 0 | 4686 | 0 | 1544 | 160 / 144 / 64 / 80 | 96 | ok | 2.97e-8 | 1.46e-11 |
| steinmetz-union | 416 | 2432 / 0 | 1248 | 208 / 4 | 59216 | 91.708% / 91.708% | 0 | 4910 | 0 | 1544 | 160 / 144 / 64 / 80 | 208 | ok | 2.97e-8 | 1.46e-11 |
| coaxial-cylinder-stack | 512 | 3136 / 64 | 896 | 128 / 2 | 51962 | 75.376% / 75.376% | 32 | 12763 | 0 | 640 | 160 / 144 / 64 / 80 | 0 | ok | 2.51e-8 | 1.46e-11 |
| sphere-minus-box | 9812 | 800 / 168 | 10456 | 9610 / 3 | 23661 | 91.898% / 92.800% | 0 | 1687 | 230 | 1282 | 160 / 144 / 64 / 96 | 212 | ok | 2.97e-8 | 1.46e-11 |
| sphere-intersect-cylinder | 10040 | 4096 / 1408 | 11910 | 9520 / 5 | 92336 | 91.130% / 91.452% | 0 | 7865 | 325 | 3740 | 160 / 128 / 64 / 80 | 436 | ok | 2.97e-8 | 1.46e-11 |
| box-minus-sphere-cavity | 6900 | 672 / 120 | 7432 | 6730 / 3 | 19695 | 91.643% / 91.773% | 0 | 1618 | 28 | 1058 | 160 / 144 / 64 / 96 | 186 | ok | 2.98e-8 | 1.46e-11 |
| hex-nut | 596 | 21276 / 1742 | 5291 | 45 / 2 | 1154819 | 92.559% / 92.595% | 20 | 85456 | 459 | 9030 | 176 / 144 / 64 / 96 | 690 | ok | 2.79e-8 | 1.46e-11 |
| enclosure-shell | 1332 | 9216 / 592 | 4963 | 370 / 13 | 310268 | 90.956% / 91.061% | 1 | 27701 | 359 | 7110 | 192 / 160 / 64 / 96 | 1088 | ok | 2.91e-8 | 1.46e-11 |
| gear-48-bore | 1148 | 784 / 80 | 1736 | 1046 / 3 | 29545 | 91.389% / 91.793% | 0 | 2414 | 130 | 1176 | 176 / 144 / 64 / 96 | 256 | ok | 2.95e-8 | 1.46e-11 |
| cylinder-tangent-box-face | 220 | 48 / 8 | 222 | 210 / 2 | 520 | 89.231% / 89.749% | 0 | 53 | 3 | 4 | 176 / 144 / 64 / 96 | 8 | refused | 2.97e-8 | 1.46e-11 |
| hole-tangent-edge | 172 | 656 / 88 | 656 | 86 / 3 | 23777 | 91.008% / 91.242% | 0 | 2077 | 61 | 964 | 176 / 144 / 64 / 96 | 204 | refused | 2.56e-8 | 1.46e-11 |
| self-union | 416 | 14688 / 128 | 1392 | 0 / 0 | 389800 | 85.445% / 85.448% | 32 | 56688 | 16 | 1952 | 112 / 80 / 64 / 80 | 736 | ok | 2.97e-8 | 1.45e-11 |
| self-subtract | 416 | 14688 / 128 | 1392 | 0 / 0 | 385576 | 85.833% / 85.833% | 32 | 54592 | 0 | 1952 | 0 / 0 / 0 / 0 | 0 | ok | 2.97e-8 | 0.00e+0 |
| self-intersect | 416 | 14688 / 128 | 1392 | 0 / 0 | 389800 | 85.445% / 85.448% | 32 | 56688 | 16 | 1952 | 112 / 80 / 64 / 80 | 736 | ok | 2.97e-8 | 1.45e-11 |
| internal-void | 24 | 0 / 0 | 24 | 24 / 2 | 27 | 100.000% / 100.000% | 0 | 0 | 0 | 0 | 32 / 16 / 64 / 96 | 0 | ok | 0.00e+0 | 0.00e+0 |
| disjoint-union | 204 | 0 / 0 | 204 | 204 / 2 | 20 | 100.000% / 100.000% | 0 | 0 | 0 | 0 | 32 / 16 / 64 / 96 | 0 | ok | 2.87e-8 | 0.00e+0 |
| pin-array-chain-20 | 1932 | 3840 / 300 | 4990 | 970 / 41 | 199476 | 93.904% / 94.511% | 0 | 10879 | 1282 | 6112 | 176 / 144 / 64 / 96 | 862 | ok | 2.75e-8 | 1.46e-11 |
| fine-spheres-50k | 50560 | 11620 / 7510 | 53200 | 49673 / 4 | 156190 | 94.849% / 94.948% | 33 | 7850 | 162 | 5249 | 144 / 128 / 48 / 80 | 849 | ok | 2.98e-8 | 1.45e-11 |
| torus-minus-box | 13900 | 3968 / 736 | 14482 | 12906 / 3 | 62312 | 81.410% / 81.761% | 0 | 11316 | 268 | 1158 | 176 / 144 / 64 / 80 | 278 | ok | 2.98e-8 | 1.46e-11 |
| r10b-g10-union | 1294 | 136 / 0 | 1301 | 1275 / 2 | 1884 | 89.066% / 89.208% | 0 | 203 | 3 | 14 | 176 / 144 / 64 / 96 | 10 | ok | 2.97e-8 | 1.46e-11 |

The cost of one plane-side evaluation, measured by `tmp/exact-plane/pred-bench.bend`
(native, 1 thread, 20,000 random evaluations per row, all of which the filter
certified):

| operands | filtered path | exact Big path | ratio |
|---|---|---|---|
| grid point (34-bit, W = 1) vs face plane | 0.10 us | 1.3 us | 13x |
| constructed vertex (meet of 3 face planes, W up to 192 bits) vs face plane | 0.20 us | 6.0 us | 30x |

The exact evaluations in the corpus are almost all zeros; a float filter can
never certify a zero. There are at most 33 exact nonzero signs per job. Most
zeros come from coplanar and touching CAD input. On `hex-nut`, 1.07M filtered
signs cost an estimated 0.1-0.2 s, and 85k exact zeros cost an estimated
0.1-0.5 s. So exact fallbacks, only 7 % of the signs, take about as much
predicate time as all the filtered ones together. The next speed-up would
therefore come from more *symbolic* zeros (for example, carrying "vertex lies
on plane p" facts through splits) and from fixed-width limbs for the common
1-4-limb operands, not from a sharper filter.

## Parallel structure

Every parallel step is a balanced fork of interleaved halves
(`a b = f(x) g(y)`, halves of equal length):

| phase | fork | leaf task |
|---|---|---|
| input triangles | per leaf, depth log2(n/64) (<= 10) | 64 plane-based triangles |
| BVH forest | per leaf (balanced over the leaves), then per node (median split) | <= 4 triangles |
| candidate lists + device jobs | over triangles, depth log2(n/32) (<= 12) | 32 triangles |
| **device pair filter** | the same tree (`D.dmap`, one `!` call) | flat loop over the leaf's jobs and their candidates |
| arrangement + classification | the same tree again (`post.par`) | 32 triangles; inside them, adaptive cells (fork per cell) and pieces (fork, 8 per task) |
| free components | classification fork over component representatives; member faces fork (64 per task) | one ray / 64 faces |
| points sort, edge-key sorts | parallel merge sort (`psort`, <= 64 leaf sorts of >= 4096); the two key sorts in parallel | Base `List.sort` |
| output faces | over kept pieces, depth log2(n/32) | 32 pieces |

The following parts are sequential, and they bound CPU scaling on large,
mostly free inputs: the union-find over free triangles, the deduplication of
the sorted points, the top merges of the sorts, the point search tree walk
(built by a fork), and the final merges.

On `fine-spheres-50k` at 18 threads, the "plumbing" phases take about
1.1 s: input 128 ms, BVH 146, candidates 117, free components 160,
points/uniq 199, face assembly 212, checks 188. The exact arrangement and
classification take only 52 ms. On `hex-nut` the arrangement dominates, and
scaling flattens after about 4 threads (684, 427, 334, 296, 274 ms at 1, 2,
4, 8, 18 threads).
In a probe, one input triangle there carried 1,531 of about 5,100 pieces
and had 258 cutting candidates. That triangle alone takes 80 ms at 18 threads, so it is
not the whole limit. The arrangement is allocation-heavy (variable-length Big
integers in lists), and the machine was shared during all measurements.

**Metal.** The device kernel is the certified pair filter:
- flat F32 records (26 words per triangle);
- the fork tree of the candidate stage;
- one flat loop per leaf over its triangles and their candidates;
- no Big integers, no data-dependent structure.

The native driver runs `pre`, `IO.now`, `dev` (the `!` call), `IO.now`,
`post`, because a device call that follows host forks in one evaluation
would run on the CPU pool. With `--gpu 1GB` the runtime counts exactly one
Metal pass per case. With `--gpu off` the same call runs on the CPU pool, and
on JS sequentially. The Metal build takes about 30 s. The earlier variant,
which banged the whole solve, did not finish the Metal device build within
the runner's 30-minute build timeout.

Measured on the device (M5 Pro, direct runs):

| case | pairs | device pass (Metal) | same call on the CPU pool (18 thr) |
|---|---|---|---|
| hex-nut | 21,276 | 61 ms | 0-1 ms |
| fine-spheres-50k | 11,620 | 35 ms | 1 ms |

The pass is essentially the fixed dispatch cost (about 35 ms). Two further
observations:
- The work per pair is about 60 F32 operations, so even 10^6 pairs would
  cost only milliseconds on either side.
- With `--gpu 1GB`, the *host* stages of the same binary ran slower than
  with `--gpu off`: pre 713 -> 1386 ms on fine-spheres, post 238 -> 407 ms on
  hex-nut. The reason was not isolated; the runtime's shared device heap is
  the likely one.

The Metal column below is therefore slower than cpu18 throughout. It shows
real device execution, not a win.

## Measured results (Apple M5 Pro, 18 cores)

Run: 2026-09-23T03:04:16.639Z, targets js, cpu1, cpuN, metal, repeat 3 (native: median per phase over 3 processes; JS: median of 3 warm runs after one cold run). Verdicts: 36 pass, 2 expected-refusal. All targets byte-identical: yes.
Machine load during the run (uptime load averages before / after): 13.28 17.91 21.63 / 17.06 17.96 20.33. The machine was shared with other jobs (other bake-off teams, a browser at about 7 cores), so absolute times are inflated and noisy, cpu18 most of all.

Compute times in ms (read, parse and serialize are separate: see report.json). cpuN = 18 threads. Metal = `--gpu 1GB` with the pair filter on the device (passes counted by the runtime). Volume error vs OCCT is reported against the bound area x deviation.

| case | verdict | tris out | vol rel err vs manifold3d | abs vol err vs OCCT / bound | JS | cpu1 | cpu18 | cpu1/cpu18 | Metal (passes) |
|---|---|---|---|---|---|---|---|---|---|
| leaf-cylinder | pass | 224 | 1.8e-9 | 2.8e+0 / 6.8e+0 | 54 | 6 | 7 | 0.9x | 49 (1) |
| box-union-overlap | pass | 68 | 0.0e+0 | 0.0e+0 / 3.2e+1 | 35.3 | 4 | 5 | 0.8x | 44 (1) |
| box-subtract-overlap | pass | 56 | 0.0e+0 | 9.1e-13 / 2.7e+1 | 33.4 | 4 | 4 | 1.0x | 45 (1) |
| box-intersect-overlap | pass | 32 | 0.0e+0 | 0.0e+0 / 8.0e+0 | 34.3 | 4 | 5 | 0.8x | 48 (1) |
| box-rotated-intersect | pass | 120 | 2.4e-10 | 1.4e-6 / 1.8e+1 | 77.8 | 10 | 10 | 1.0x | 53 (1) |
| box-coplanar-union | pass | 54 | 0.0e+0 | 1.8e-12 / 2.8e+1 | 31.8 | 4 | 5 | 0.8x | 48 (1) |
| box-coplanar-subtract | pass | 24 | 0.0e+0 | 1.8e-12 / 2.2e+1 | 31.3 | 3 | 4 | 0.8x | 48 (1) |
| box-touching-merge | pass | 20 | 2.3e-16 | 2.3e-13 / 1.0e+1 | 24 | 2 | 2 | 1.0x | 44 (1) |
| box-touching-partial | pass | 42 | 0.0e+0 | 0.0e+0 / 7.2e+0 | 25.9 | 2 | 3 | 0.7x | 44 (1) |
| plate-through-hole | pass | 728 | 5.8e-11 | 6.6e-1 / 3.1e+1 | 317.5 | 49 | 22 | 2.2x | 65 (1) |
| plate-blind-hole | pass | 414 | 3.1e-11 | 3.0e-1 / 2.6e+1 | 192.2 | 26 | 23 | 1.1x | 61 (1) |
| plate-blind-pocket | pass | 56 | 0.0e+0 | 0.0e+0 / 3.3e+1 | 37.8 | 5 | 5 | 1.0x | 46 (1) |
| plate-counterbore | pass | 1500 | 6.1e-12 | 6.6e-1 / 2.9e+1 | 1143.4 | 189 | 68 | 2.8x | 135 (1) |
| plate-countersink | pass | 1920 | 9.4e-11 | 5.4e-1 / 2.6e+1 | 1395.3 | 240 | 76 | 3.2x | 134 (1) |
| plate-4-holes | pass | 2238 | 2.2e-10 | 9.3e-1 / 4.8e+1 | 988.3 | 179 | 77 | 2.3x | 113 (1) |
| plate-hole-grid-10x10 | pass | 45532 | 1.3e-9 | 1.8e+1 / 8.1e+1 | 28556.2 | 6398 | 1837 | 3.5x | 2145 (1) |
| tilted-holes-17deg | pass | 2130 | 1.2e-10 | 2.0e+0 / 4.4e+1 | 1000.6 | 185 | 71 | 2.6x | 105 (1) |
| pipe-tee | pass | 4590 | 5.5e-9 | 2.0e+0 / 3.4e+1 | 2722.8 | 543 | 140 | 3.9x | 221 (1) |
| steinmetz-intersect | pass | 808 | 2.3e-9 | 2.4e+0 / 4.0e+0 | 800.6 | 136 | 36 | 3.8x | 89 (1) |
| steinmetz-union | pass | 1456 | 1.3e-9 | 5.2e+0 / 1.2e+1 | 845.6 | 143 | 42 | 3.4x | 93 (1) |
| coaxial-cylinder-stack | pass | 768 | 3.5e-10 | 4.8e+0 / 1.2e+1 | 478.2 | 83 | 26 | 3.2x | 68 (1) |
| sphere-minus-box | pass | 6654 | 5.0e-10 | 4.7e+0 / 1.1e+1 | 1908.7 | 408 | 199 | 2.1x | 252 (1) |
| sphere-intersect-cylinder | pass | 7012 | 7.9e-10 | 5.5e+0 / 9.9e+0 | 2794.6 | 559 | 228 | 2.5x | 299 (1) |
| box-minus-sphere-cavity | pass | 5598 | 7.0e-10 | 2.8e+0 / 1.8e+1 | 1608.1 | 316 | 179 | 1.8x | 234 (1) |
| hex-nut | pass | 4050 | 2.3e-9 | 7.8e-1 / 6.4e+0 | 3471.2 | 712 | 265 | 2.7x | 387 (1) |
| enclosure-shell | pass | 4662 | 7.4e-10 | 1.1e+1 / 1.9e+2 | 3047.9 | 564 | 150 | 3.8x | 232 (1) |
| gear-48-bore | pass | 1864 | 3.8e-10 | 1.1e+0 / 6.2e+1 | 554.8 | 96 | 49 | 2.0x | 111 (1) |
| cylinder-tangent-box-face | expected-refusal | - | - | - | 66.2 | 16 | 13 | 1.2x | 46 (1) |
| hole-tangent-edge | expected-refusal | - | - | - | 306.7 | 52 | 28 | 1.9x | 69 (1) |
| self-union | pass | 1920 | 1.5e-9 | 1.9e+0 / 4.7e+0 | 955.2 | 189 | 72 | 2.6x | 165 (1) |
| self-subtract | pass | 0 | 0.0e+0 | 0.0e+0 / 0.0e+0 | 718.6 | 193 | 75 | 2.6x | 185 (1) |
| self-intersect | pass | 1920 | 1.5e-9 | 1.9e+0 / 4.7e+0 | 905.7 | 189 | 59 | 3.2x | 137 (1) |
| internal-void | pass | 24 | 3.9e-16 | 5.5e-12 / 3.0e+1 | 10.1 | 1 | 2 | 0.5x | 42 (1) |
| disjoint-union | pass | 204 | 1.1e-9 | 1.4e+0 / 9.5e+0 | 50.1 | 5 | 6 | 0.8x | 41 (1) |
| pin-array-chain-20 | pass | 5078 | 1.7e-9 | 5.0e+0 / 3.3e+1 | 1995.9 | 369 | 161 | 2.3x | 242 (1) |
| fine-spheres-50k | pass | 41304 | 8.4e-11 | 3.7e+0 / 7.0e+0 | 16639.6 | 4600 | 2066 | 2.2x | 2219 (1) |
| torus-minus-box | pass | 7794 | 1.8e-9 | 2.7e+0 / 1.2e+1 | 2580.2 | 677 | 409 | 1.7x | 416 (1) |
| r10b-g10-union | pass | 1310 | 3.1e-10 | 8.7e+0 / 4.2e+2 | 271.1 | 47 | 29 | 1.6x | 71 (1) |

Builds: cpu 26.8 s (in the spot-check run just before; cached here), metal 27.5 s, js cached.

## Supported and unsupported

**Supported.**
- Any closed, consistently oriented, watertight tagged leaf meshes: planar,
  tessellated curved, or the frozen r10b B-rep bodies.
- Any binary CSG tree over them: union, subtract, intersect, and chains.
- Coplanar and coincident faces, touching faces, internal voids, disjoint
  components, identical operands (A u A, A - A = empty, A n A), and rotated
  inputs.

**Unsupported or refused.**
- Results whose exact regularized surface touches itself, i.e. tangent
  contact along a line or at a point (`cylinder-tangent-box-face`,
  `hole-tangent-edge`). They are refused as `non-manifold contact`, which is
  the expected answer.
- Coordinates beyond +-1024 mm, the grid box. A wider box costs bits, not
  correctness.
- Self-intersecting leaf meshes are not detected; the harness fixtures are
  valid. Open or non-manifold input meshes give undefined parity.
- The result is a mesh on the input tessellation. Exact analytic curves are
  not recovered; that is the `recover` prototype's job, and the tags are
  carried for it. Coplanar pieces of one input triangle are not merged, so
  the output has more triangles than corefine's (for example, 68 vs 48 on
  `box-union-overlap`).
- Performance limits:
  - The JS target runs every case, but slowly: about 30 s for
    `plate-hole-grid-10x10`.
  - Serialize times of the largest cases (0.4-1 s) are mostly deferred
    memory reclamation of the compute's intermediate data. In a probe, a 3M
    element allocation right after `post` took 289 ms, and a second
    serialization of the same mesh took 48 ms instead of 605 ms.

## Three ideas a hybrid should take from this approach

1. **An exact plane-based arrangement with symbolic zeros as the topology
   oracle.**
   - *Method.* Quantize once, keep vertices as intersections of three input
     planes, and never round during the Boolean.
   - *Filter.* The float filter certifies 60-100 % of all signs (85-96 % on most
     cases; the low values are coplanar box cases), and nonzero
     exact fallbacks are rare (at most 33 per case). Zeros, the unavoidable
     exact cases of coplanar and touching input, are either known by
     construction (plane ids) or are cheap integer evaluations.
   - *Result.* The Boolean has no tolerance parameters. It handles coplanar,
     coincident and touching input exactly, and its only approximation is one
     stated export rounding. It matches manifold3d on all 36 solid cases of
     the corpus (volume within 1e-8 relative, from the quantization) on all
     four targets, byte-identical.
   - *Fit for the hybrid.* This is the right core for the hybrid's "tagged
     mesh Boolean as topology oracle". Tags survive exactly, and every output
     vertex is an exact intersection of three known planes, i.e. of three
     known analytic faces via their tags. That is exactly the input the
     analytic recovery step needs.
2. **Segment-bounded cuts and exact T-junction resolution instead of
   unbounded BSP cuts or snapping.**
   - Cutting a piece only as far as the other triangle reaches (a pre-cut by
     its edge planes at the segment ends) removed every sliver that broke
     export rounding on sphere and near-tangent inputs, and it halved the
     piece count.
   - Inserting exactly-on-edge points and triangulating with exact
     orientation checks on the rounded coordinates gives a watertight mesh
     without any epsilon merge.
   - A hybrid that exports certified STL/3MF can use the same discipline:
     exact result, one rounding, exact re-check, otherwise refuse.
3. **Certified disjointness first, exact work only near the intersection
   curves.**
   - *The test.* Triangles whose closure touches no other surface are free.
     The test is two-sided and certified: b is strictly on one side of t's
     plane, or t is strictly on one side of b's plane.
   - *Propagation.* Free triangles are grouped by shared vertices and
     classified by one exact ray per component.
   - *Effect.* On typical CAD inputs most triangles are free: 98 % on
     `fine-spheres-50k`, 50 % on the hole plates. The exact machinery only
     runs near the intersection curves.
   - *The CPU/GPU split.* The certified pair filter is uniform F32 work over
     flat records (the Metal kernel here), and the exact part stays on the
     CPU. On this corpus, however, the pass costs more to dispatch than it
     computes. A GPU pays only when it does the whole broad phase (pairs from
     a uniform grid, not BVH walks per triangle) for many Booleans in one
     pass.

## Files and commands

| file | role |
|---|---|
| `kernel/proto/exact-plane/main.bend` | entry (`parse`, `pre`, `dev`, `post`, `solve`, `show`, `run`); fork over triangles and pieces; refusals; report line |
| `native.bend` | native driver (copy of `null/native.bend`): the three stages with IO steps, per-stage times (`preMs`, `devMs`, `postMs` beside the harness phases) |
| `device.bend` | the device kernel: certified pair filter on flat F32 records |
| `big.bend` | signed multi-limb integers (16-bit limbs) |
| `geom.bend` | planes, homogeneous vertices, filtered/symbolic/exact plane side, meet, quantization, export rounding |
| `poly.bend` | convex plane-based polygons, exact split, predicate counters |
| `setup.bend` | quantized input, plane-based triangles (parallel), BVH forest (one subtree per leaf), `find_other` |
| `arrange.bend` | per-triangle relations, adaptive cells, segment-bounded cuts, coplanar clipping |
| `classify.bend` | interior points, exact axis rays, CSG evaluation |
| `comps.bend` | free triangles: union-find components, one ray per component |
| `assemble.bend` | output points, T-junctions, triangulation with exact orientation checks, self-check |
| `finish.bend` | final exact checks |
| `psort.bend` | parallel merge sort (tail-recursive lengths for the JS stack) |
| `stats.bend`, `tools/stats.mjs` | diagnostics: counters, bit widths, deviations, phase times (`out/bakeoff/exact-plane/stats.{json,md}`) |
| `test/proto-exact-plane.test.mjs` | Big vs BigInt; filter vs exact determinants (including constructed and symbolic zeros); device pair filter vs exact disjointness (never on shared-vertex or coplanar pairs); quantization/rounding; 12 cases end to end on JS against the validator and manifold3d; refusals (about 20 s) |

```sh
npm run bakeoff -- --proto exact-plane                       # all cases, all targets
npm run bakeoff -- --proto exact-plane --cases hex-nut --targets cpu1,cpuN --repeat 5
node kernel/proto/exact-plane/tools/stats.mjs [--cases a,b]  # predicate/bit-width statistics
node --test test/proto-exact-plane.test.mjs
```

Notes for the shared contract:
- The harness takes the native timing phases only, so the extra
  `preMs/devMs/postMs` keys are not in `report.json`.
- Two things that other Bend code with long lists should know:
  - On the JS target, Base's `List.length` and `List.sort` recurse non-tail.
    Beyond about 50k elements they overflow the 8 MB main-thread stack; the
    runner's `--stack-size=65500` turns that into SIGSEGV (exit 139) instead
    of a RangeError. The prototype uses its own tail-recursive length, and
    leaf sorts of at most a few thousand elements.
  - The runtime charges deferred reclamation of a phase's garbage to the next
    allocating phase, which inflates `serializeMs` for large results.
