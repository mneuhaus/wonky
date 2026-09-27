# Campen and Kobbelt 2010: Exact and Robust (Self-)Intersections for Polygonal Meshes

- Kind: peer-reviewed paper (Eurographics 2010). No public code found.
- Canonical URL: https://doi.org/10.1111/j.1467-8659.2009.01609.x
- Other URLs:
  - Author PDF: https://www.graphics.rwth-aachen.de/media/papers/campen_2010_eg_021.pdf (HTTP 200, checked 2026-09-22; local copy in tmp/research/pdf/campen2010.pdf).
  - Companion paper, Pavić, Campen and Kobbelt, "Hybrid Booleans", CGF 29(1), 2010: https://doi.org/10.1111/j.1467-8659.2009.01545.x (Crossref: 35 citations).
  - Direct successor, Nehring-Wirxel, Trettner and Kobbelt 2021, "Fast Exact Booleans for Iterated CSG using Octree-Embedded BSPs": https://arxiv.org/abs/2103.02486, https://doi.org/10.1016/j.cad.2021.103015.
  - Second successor, Trettner, Nehring-Wirxel and Kobbelt 2022, EMBER: https://doi.org/10.1145/3528223.3530181.
- Authors/organization, year: Marcel Campen and Leif Kobbelt, RWTH Aachen (Computer Graphics Group), 2010. DOCUMENTED (paper header).
- Venue: Computer Graphics Forum 29(2), pp. 397–406, May 2010 (Eurographics 2010). Crossref counts 80 citations (https://api.crossref.org/works/10.1111/j.1467-8659.2009.01609.x, queried 2026-09-22). DOCUMENTED.
- License and porting:
  - Paper © the authors / Eurographics / Wiley. No code license exists because no code was published.
  - A GitHub repository search for an implementation ("campen kobbelt BSP boolean", "plane-based BSP boolean octree") returned nothing (gh search, 2026-09-22). INFERRED: this is a re-implementation-from-paper source.
  - The algorithm is compact: 4 Bernstein–Fussell predicates, a BF09 convex clipper, a Naylor BSP merge, an octree, and a flood fill. It is fully specified in the paper.
- Status: finished research. The Aachen group itself superseded it twice: octree-embedded BSPs with integer arithmetic (2021) and EMBER (2022).

## What it is

A framework for **topology modification at (self-)intersections** of polygon meshes. It is exact ("= correctness") and robust ("= completeness") while using **only fixed-precision arithmetic**. DOCUMENTED (abstract, §1, https://www.graphics.rwth-aachen.de/media/papers/campen_2010_eg_021.pdf).

It combines three things:

1. **Bernstein–Fussell plane-based geometry and predicates** (BF09). These need no constructions, so arithmetic depth is fixed.
2. **An exact vertex→plane conversion** with a bit bound that closes BF09's inexact-conversion gap.
3. **Localization by an adaptive octree.** BSP work happens only inside small "critical cells" around the intersection curves. The rest of the mesh stays in the ordinary halfedge representation.

The paper demonstrates three applications from one core:

- Booleans (§5).
- Outer hull construction for repair of self-intersecting meshes (§6).
- An "orientation-sensitive outer hull" for explicit front tracking with merges and splits (§6).

## How it works

### Numeric substrate (§3.1–3.2, DOCUMENTED)

- **Predicates.** The four BF09 predicates are used: plane coincidence, co-orientation, orientation of a plane-triple vertex against a plane, and "three planes meet in a unique point". The last one, negated, also tests whether three planes meet in a common line. They are "implemented using filtering techniques proposed by Shewchuk [She97]", specifically "only single-stage filtered adaptive predicates" (§7).
- **Exact plane construction.** Input vertices have L bits including sign, on a uniform grid over the bounding box. Edges have relative max-norm length δ ≤ 2^(K−1−L), so K bits suffice for edge vectors. Plane coefficients are computed as determinants of p0, p1−p0 and p2−p0:
  - nx, ny, nz are sums of double products.
  - d = −|p0 p1 p2| is a sum of triple products.
  - The worst case needs `M = (L−1) + 2(K−1) + 3 + 1` bits, i.e. **`M ≥ 3L + 2·log2(δ) + 3`**.
- **Worked budgets** (§3.2):

  | Plane-coefficient type | Input precision | Max relative edge length |
  |---|---|---|
  | double (M = 53) | L = 20 | δ ≤ 2^-5 |
  | x87 long double (M = 64) | L = 22 | δ ≤ 2^-2.5 ≈ 0.18 |
  | x87 long double (M = 64) | L = 24 (full IEEE single) | δ ≤ 2^-5.5 ≈ 0.022 |

- **When input violates the budget.** Coordinates are quantized and/or long edges subdivided. Quantization moves vertices by roughly 2^-20 of the box or less, but "the inner topology of the polygon mesh is not affected". The paper contrasts this with BF09, "where vertices are often split into a collection of valence 3 vertices due to round-off error". DOCUMENTED.
- **Polygon representation.** A polygon is a supporting plane (from three of its vertices) plus a circular list of bounding planes. Each bounding plane passes through two consecutive vertices and "an arbitrary third point that does not lie in the supporting plane and is representable with input precision". Non-planar input polygons are triangulated first. DOCUMENTED (§3.3).

### Localization (§4.1, DOCUMENTED)

- **Critical cells.** The goal is a set of disjoint convex cells whose union contains every intersection curve in its interior. **No cell bounding plane may contain an input vertex.**
- **Octree rule.** Start from a root cell around all inputs. Split a cell iff it contains an intersection and more than **m = 17** polygons. m is "the only parameter", chosen because it "consistently resulted in minimal runtimes".
- **Conservative tests are fine.** The intersection test may be conservative. Polygon-vs-cell tests may run against "sufficiently enlarged cells since false-positives are not problematic".
- **Degeneracy avoidance by construction.** The octree is positioned so that "cell boundaries are located between possible vertex coordinates". This removes every special case of geometry lying on a cell face. INFERRED: on an integer grid this means octree planes at half-integers, i.e. odd coordinates after scaling by 2.
- **Complexity claim.** Work per critical cell is O(1), and the number of critical cells is "usually O(√n)" for uniform meshes. Global BSP merging is at least O(n log n); this drops to about O(√n) plus octree construction and joining. The paper warns that non-uniform meshes and long slivers spanning many cells break the estimate.

### BSP inside a cell (§4.2, DOCUMENTED)

- **Nesting.** Polygons are clipped to the convex cell with the BF09 splitting routine. This is why cells must be convex. "No geometric constructions are involved."
- **Extraction.** Boundaries are extracted after Thibault 1987. Each splitting-plane polygon is pushed down both subtrees. Fragments that separate an inside cell from an outside cell are boundary polygons. The result carries no connectivity.
- **Unlabeled BSPs.** For self-intersecting or non-oriented input, the BSP cells are grouped into components by a **flood fill**. It runs on the BSP-cell adjacency graph, which a modified Thibault extraction builds: fragments are dual to the adjacency edges. Graph edges that cross input polygons are deleted first.

### Clip and connect (§4.3, DOCUMENTED)

- **Clipping the rest of the mesh.** Only polygons that touch critical cells are converted to plane form. Each bounding plane is associated with its halfedge. These polygons are clipped against the six planes of each cell with a connectivity-maintaining variant of the BF09 splitter.
- **Local connectivity.** Inside a cell there are few polygons (about m), so every vertex is tested against every other. Two plane-triple vertices coincide iff the orientation predicate says so. The test is exact.
- **Global connectivity.** Links from input polygons to their extracted fragments are kept, so coincidence tests only run among "fragments of the same input polygon". The octree positioning "effectively prevents" the need to connect fragments of adjacent input polygons.
- **T-junctions.** Loops of open halfedges that are completely collinear are found with the exact collinearity predicate. The T-vertices on both sides are ordered along the line with the orientation predicate and inserted as degenerate 180° corners, or the polygon is split.
- **Coordinates last.** Vertex coordinates are computed only at the very end, by intersecting three planes, "to any desired precision" (Priest 1991). Rounding them to input precision "might also lead to microscopic self-intersections": the geometric rounding problem (Li, Pion and Yap 2005). DOCUMENTED.
- **Fragmentation.** BSP work fragments polygons, but only locally. Exactly coplanar fragments can be re-merged by coplanar-only decimation "without impairing accuracy" (Kobbelt, Campagna and Seidel 1998).

### Booleans (§5, DOCUMENTED)

- **Octree split criterion:** a cell is split if it is touched by polygons of different meshes.
- **Per cell:** a labeled BSP is built per operand, with labels taken from polygon orientation. The BSPs are merged by Naylor/Amanatides/Thibault 1990, and the Boolean expression is applied at the leaves.
- **Cleanup:** after connecting, the non-critical parts that stay open-bounded lie inside or outside the result and are deleted.
- **Non-intersecting components:** their nesting is decided by ray shooting through the octree.

### Outer hull and front tracking (§6, DOCUMENTED)

- **Self-intersection test.** It uses Optimized Spatial Hashing (Teschner et al. 2003) with exact triangle-triangle tests. This "outperform[ed] all other advanced self-intersection detection schemes we tried".
- **Deferred labeling.** Labels are unknown locally. Every component per cell is extracted with inward-facing normals. An orientation-reversed copy of the non-critical mesh is added. The global components then assemble, and the outer hull is the one with outward normals and maximal extent.
- **Orientation-sensitive hull.** Components are superimposed where the hull meets back-facing input, and coincident counter-oriented pairs cancel. This relies on "compatible component boundaries": every polygon has an exactly congruent, reversed twin.
- **Multiple components.** Components fully inside another (found by ray shooting) are dropped. The rest are partitioned into equivalence classes of the transitive "intersects" relation.

## Robustness and guarantees

- **Claim.** Correctness and completeness for Booleans on closed oriented polygon meshes, and for outer hulls of self-intersecting meshes, with fixed-precision arithmetic only. DOCUMENTED (abstract, §5, §8).
- **Conditions on the guarantee:**
  1. The input must fit the M-bit budget, or be quantized to fit.
  2. The filtered predicates must be exact. The paper uses Shewchuk-style adaptive filters, which have an exact fallback, so this holds. INFERRED from [She97].
  3. Output coordinates are exact only if emitted at full precision.
- **Exactness test.** 25 models from 36 to 1M faces were taken mesh → planes → BSP → mesh. The Hausdorff distance between input and output vertex sets was zero in every case. DOCUMENTED (§7).
- **Robustness test.** Each model was copied and shifted by one ulp in one coordinate of every vertex, then subtracted. This "always obtained a closed manifold output, free from topological error", matching CGAL to sub-precision. DOCUMENTED (§7).
- **Repair test.** COW (6K faces) and WOMAN (12K faces) outer hulls were verified self-intersection-free by exact pairwise triangle tests. DOCUMENTED (§7).
- **Degenerate contact.** Non-manifold edges and vertices are "handled by our scheme" and can be split into manifold output either way. DOCUMENTED (§7). The paper gives no stress test beyond the shift-by-ulp case.

## Parallelism and performance

**Setup** (§7, DOCUMENTED):

- Intel Core i7 at 2.67 GHz, 6 GB RAM.
- Single-stage filters only. The authors say multi-stage filtering "would probably increase performance".
- INFERRED: single-threaded. Threading is never mentioned.

**IPHIGENIE union with a rotated copy, whole pipeline mesh → mesh at full-precision output** (Figure 7, DOCUMENTED):

| Faces | 30°: cells / LBSP / CGAL | 60°: cells / LBSP / CGAL | 90°: cells / LBSP / CGAL |
|---|---|---|---|
| 25K | 1.7K / 6.9 s / 17.6 s | 0.9K / 4.2 s / 16.9 s | 0.7K / 3.3 s / 16.1 s |
| 100K | 3.3K / 14.0 s / 81.3 s | 1.8K / 8.4 s / 60.5 s | 1.3K / 6.4 s / 60.6 s |
| 200K | 4.7K / 19.1 s / 113.9 s | 2.5K / 11.8 s / 117.0 s | 1.8K / 8.9 s / 114.0 s |
| 3200K | 16.5K / 95.8 s / – | 9.1K / 65.3 s / – | 6.5K / 56.6 s / – |

- **Speed:** "2.5 to 13 times faster than CGAL", extrapolated to about 25× on inputs CGAL could not run.
- **Memory:** above 200K faces CGAL needed about 5.3 GB (above 10 GB for larger inputs). LBSP needed less than 300 MB.
- **Scaling:** critical-cell counts grow roughly as √n, as predicted.
- **Other timings:**
  - Outer hull: COW 1.2 s, WOMAN 1.9 s.
  - Front tracking without events: 15K faces about 100 ms, 50K about 300 ms, 400K about 1600 ms.
  - A 400K step with nine small self-intersections: 5.2 s.
- **Later comparison** (INFERRED, other hardware): in Nehring-Wirxel 2021's iterated-CSG milling benchmark, CK10 is one of the slowest per step. The octree-embedded BSP method reaches "up to 2.5 million mesh-plane cuts per second on a single core" (https://arxiv.org/abs/2103.02486, abstract and Fig. 14).

**Parallel structure** (INFERRED):

- Critical cells are disjoint and processed independently. That is embarrassingly parallel.
- NW21 notes of its own octree that "each octree cell can be merged in parallel with only minimal synchronization … We expect an almost linear speedup" (§6, https://arxiv.org/abs/2103.02486).
- EMBER later used work-stealing over an adaptive recursive subdivision (abstract, https://doi.org/10.1145/3528223.3530181).

## Known failures, limitations, war stories

- **Crashed in iterated CSG.** In Nehring-Wirxel 2021's milling simulation (a rotating drill-bit sweep subtracted about 58K times), "Cork crashes after 17 steps, both mesh-arrangement approaches after 71, and CK10 after 12" (Fig. 14 caption, https://arxiv.org/abs/2103.02486). DOCUMENTED by a third party from the same lab; no cause is given. INFERRED: plausible causes are the precision budget being exceeded as fragmented geometry accumulates, since re-quantization is required between steps, or octree/BSP blow-up on the accumulated slivers.
- **Web-service implementation failed often.** In Zhou et al. 2016's Thingi10K self-union test, "the web-service implementation of [Campen & Kobbelt 2010a] failed to produce a result roughly 40% of the time". The same paper notes that it "assumes single component input" and that CK10 rounds "all input vertices aggressively to ensure exact plane intersections" (§2, §7.2, §7.3, https://www.cs.columbia.edu/cg/mesh-arrangements/). DOCUMENTED (see `zhou-grinspun-zorin-jacobson-2016-mesh-arrangements-for-soli.md`).
- **Conversion conditions are costly to meet.** Cherchi et al. 2020: meeting CK10's conditions "may require a tricky clipping of edges and triangles that can introduce an additional rounding and new intersections" (§2.1, https://doi.org/10.1145/3414685.3417818). DOCUMENTED (see `cherchi-livesu-scateni-attene-2020-fast-and-robust-mesh-arra.md`). INFERRED: wonky avoids this if leaf tessellations are generated directly on the integer grid, so the vertex→plane conversion is exact without re-clipping.
- **Precision limits.** "These guarantees force them to limit the precision of the input mesh" (NW21 §2, https://arxiv.org/abs/2103.02486). DOCUMENTED.
- **Output rounding breaks exactness.** Rounding output vertices to input precision can create "microscopic self-intersections" (§4.3). The exact result is plane-based, and the float mesh is only an approximation of it. DOCUMENTED.
- **Non-uniform meshes.** Long thin polygons that span many small cells cost overhead, and the O(√n) estimate no longer holds (§4.1). DOCUMENTED.
- **BSP merge cost.** BF09-style BSP merge scales poorly for large local BSPs. EMBER: "their solution scales poorly for large inputs which is inherited from the original BSP-merging algorithm", mitigated here only by the octree (https://doi.org/10.1145/3528223.3530181, §2). DOCUMENTED.
- **Outer hull ignores inner voids.** The authors list this as future work (§6.1, §8). DOCUMENTED.
- **Input requirements for Booleans.** Inside/outside comes from polygon orientation, so closed oriented input is needed. Self-intersecting operands have to go through the outer-hull path first (§5, §6). INFERRED from the pipeline description.

## Relevance for wonky

- **Sizes Bend's exact plane arithmetic** (INFERRED; applies to bake-off prototype 2, the EMBER-style exact plane-based Boolean). `M ≥ 3L + 2·log2(δ) + 3` is the formula for choosing the wonky input grid and the limb count.
  - With δ = 1 (any edge length) and L = 26 (EMBER/Blender's SIBits), M = 81. That matches Blender's PCBits 84 plus margin.
  - F32x2 (about 48 bits) could hold exact plane coefficients only for L ≤ 15 at δ = 1, or L ≤ 18 at δ = 2^-5. That is too coarse for CAD (about 4 µm on a 1 m part).
  - So plane coefficients must be multi-limb U32 integers: three limbs for 81 bits. F32x2 can serve only as a semi-static **filter** with an explicit bound over a declared input range. The F32 exponent range caps the size of degree-7 products, so inputs must be pre-scaled.
- **Degeneracy-free localization for free** (INFERRED). Octree planes placed strictly between grid points (half-integers) cannot contain input vertices. Cell clipping then never needs symbolic perturbation, which fits the rule "unsupported cases must fail explicitly".
- **Fork-join shape** (INFERRED). Octree refinement is a recursive 8-way fork with a hard leaf bound (≤ m polygons, unless at max depth).
  - Per-cell BSP work is bounded by a function of m, which gives Bend uniform-ish GPU leaves once padded to the worst case.
  - Balance comes from octree depth, not median splits. Degenerate clusters produce deep chains, so a depth cap with an explicit failure is needed.
- **Exact provenance** (INFERRED; helps bake-off prototype 4, analytic B-rep recovery). Every output polygon's supporting plane *is* an input plane (§3.3). Every output vertex *is* an input plane triple. Face provenance and "which input faces meet here" are therefore exact by construction, not tagged heuristically.
- **Connectivity without hash maps** (INFERRED). Global connectivity restricted to "fragments of the same input polygon" becomes, in affine Bend, a sort by (input polygon id, cell) plus local all-pairs coincidence tests. That is a sort plus a segmented map, both fork-join friendly.
- **Outer hull** (INFERRED). Useful for importing dirty meshes (STL) into wonky: an exact self-intersection repair with no epsilon.
- **Caveat** (INFERRED). The CK10 crash in NW21's iterated benchmark is a warning. wonky runs long parametric CSG chains, so the pipeline must re-quantize exactly and check budgets between operations, or keep results plane-based across operations as NW21 does.
- **Update 2026-09-24: what the bake-off's `exact-plane` prototype took from CK10, and what it measured** (DOCUMENTED from `docs/proto-exact-plane.md` and `docs/hybrid-boolean-plan.md`; comparisons INFERRED).
  - It cites CK10 for plane-based triangles, three-plane vertices and the exact plane-side predicate (`geom.meet`, `geom.side`, `poly.split`, `setup.mk_tri`).
  - Its budget is CK10's formula in integer form. The grid is 2^-24 mm in a ±1024 mm box, so |X| < 2^34 (L = 35 with sign) and edges may span the box (δ = 1): `M ≥ 3L + 3 = 108` bits for the plane offset, matching exact-plane's measured bound |d| < 2^107, with |a|,|b|,|c| < 2^71.
  - Edge planes follow CK10's "third point not in the supporting plane, representable with input precision" rule in its cheapest form: the plane through the edge that **contains the dominant axis direction of the support normal** (edge × axis unit vector), so |n| < 2^36 and |d| < 2^70, far below the face-plane budget.
  - Localization differs. exact-plane uses the input triangle as the cell and bisects it by axis-aligned **integer** planes above 16 cutting candidates. Those planes can contain input vertices, and the exact predicates handle it. CK10's rule (cell planes strictly between grid points) would remove that degenerate case for one extra bit (bisect at odd coordinates of a doubled grid). INFERRED, not measured.
  - CK10's claim that quantization leaves "the inner topology of the polygon mesh" unaffected is about one mesh's own connectivity. Between operands, quantization **does** change the Boolean's topology. Measured on the adversarial suites: rotated coplanar pockets sealed into voids, 1e-9 mm gaps closed into point contacts, sub-micron skins missed by up to 19 %. This is the main reason the judge kept exact-plane as a differential oracle only and chose the Manifold-style corefine plus analytic recovery for production.

## Pointers worth porting or studying

- §3.2: the bit-budget derivation and the "quantize or subdivide long edges" strategy. It generalizes to wonky's homogeneous vertices, following the NW21/EMBER budget tables (https://arxiv.org/abs/2103.02486 §3.2).
- §4.1: the octree rule (intersection and more than m = 17 polygons), conservative enlarged-cell tests, and **cell faces between grid points**.
- §4.2: BSP-cell adjacency graph plus flood fill for components of an unlabeled BSP. It is also relevant to winding-number labeling in the mesh-arrangements family.
- §4.3: exact vertex coincidence via the orientation predicate; T-junction repair via the collinearity predicate and ordering along a line; coordinates computed last.
- §6.2: "compatible component boundaries" and cancellation of counter-oriented coincident pairs. This is a clean exact trick for self-union and repair.
- Follow-ups that supersede the numerics:
  - NW21: fixed-width 128/192/256-bit integers, 4D homogeneous vertices so classification is a dot product, a persistent octree-embedded BSP, and the note that GMP is "at least a 10× slowdown" (https://arxiv.org/abs/2103.02486 §6).
  - EMBER: no global acceleration structure; adaptive recursive subdivision with early outs; work stealing (https://doi.org/10.1145/3528223.3530181).

## Verdict: learn-from

This is the canonical source for **exact plane conversion bounds** and **octree localization of BSP Booleans**. Both transfer directly to Bend: integer limbs, grid-offset cells, recursive fork-join.

There is no code to port. The numerics (floats with adaptive filters plus x87 long double) do not fit Bend, and the method was superseded by the same lab's integer-based NW21 and EMBER. The paper also lost robustness in a third-party iterated-CSG test (crashed after 12 steps).

Use its ideas inside bake-off prototype 2, and its exact provenance argument for prototype 4. Do not implement CK10 as such. Update 2026-09-24: prototype 2 (`exact-plane`) did use CK10's plane-based triangles and bit budget and passed the corpus; it is kept as the differential oracle. The CK10 point worth carrying into the production hybrid is the provenance argument: every output vertex is an input plane triple, which is the same "exact provenance per new edge" that `docs/hybrid-boolean-plan.md` §2.2 lists as the open gap between corefine and recover.
