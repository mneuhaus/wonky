# CGAL Nef_polyhedron_3 and Hachenberger, Kettner & Mehlhorn, "Boolean operations on 3D selective Nef complexes" (CGTA 2007)

- **Kind:** journal paper plus the CGAL package that implements it.
- **Canonical URL:** https://doi.org/10.1016/j.comgeo.2006.11.009. CGTA 38(1-2):64-99, 2007; 83 citations per Semantic Scholar.
- **Other URLs:**
  - CGAL manual: https://doc.cgal.org/latest/Nef_3/index.html and the sphere-map package https://doc.cgal.org/latest/Nef_S2/index.html
  - Source: https://github.com/CGAL/cgal/tree/main/Nef_3 and `.../Nef_S2`. Sparse clone at `tmp/research/cgal-sparse/{Nef_3,Nef_S2}`, commit 4abd208f (2026-09-21).
  - Predecessor: Granados, Hachenberger, Hert, Kettner, Mehlhorn, Seel, "Boolean Operations on 3D Selective Nef Complexes: Data Structure, Algorithms, and Implementation", ESA 2003, LNCS 2832:654-666, https://doi.org/10.1007/978-3-540-39658-1_59
  - Optimization paper: Hachenberger & Kettner, SPM 2005, pp. 163-174, https://doi.org/10.1145/1060244.1060263
  - **What was actually read:** Peter Hachenberger's dissertation (Saarbrücken 2006; Kettner and Mehlhorn as referees). It is the long form of the CGTA paper: same data structure, algorithms, experiments and the ACIS comparison. https://publikationen.sulb.uni-saarland.de/bitstream/20.500.11880/25961/1/Dissertation_1778_Hach_Pete_2006.pdf. Local copy: `tmp/research/pdf/hachenberger2006-thesis.pdf` (+ `.txt`, 155 pages).
  - The CGTA PDF itself (ScienceDirect, "bronze" open access) and the listed mirror `cadcamcae.eafit.edu.co` could not be fetched: 403 bot wall and DNS failure. Claims below cite the thesis and the CGAL code and manual.
- **Authors/org:** Peter Hachenberger, Lutz Kettner, Kurt Mehlhorn (MPI Informatik). The code builds on Michael Seel's planar and spherical Nef polyhedra (CGAL 2.3, 2001) and Miguel Granados' work. Released in CGAL 3.1 (Dec 2004). Manual authors: Hachenberger and Kettner. DOCUMENTED (thesis §1.3, manual).
- **License:**
  - Nef_3 and Nef_S2 headers: `GPL-3.0-or-later OR LicenseRef-Commercial`, copyright Max-Planck-Institute Saarbrücken.
  - The paper is academic (Elsevier).
  - Porting implication: **study-only** for code. The representation (sphere maps, SNC, selection marks, simplification rules, Plücker-keyed synthesis) is published and can be re-implemented from the paper and thesis. INFERRED.
- **Status:**
  - Maintained, but the algorithm is frozen since about 2006. It is inside CGAL (6,054 stars, last push 2026-09-21).
  - Recent Nef_3 commits are docs and small features: "Nef_3: clip-plane cap per volume" (2026-07-28), doc corrections (2026-06).
  - A `gh search issues "Nef_polyhedron_3"` returns 20 open issues (a few unrelated), e.g. assertions in `convex_decomposition_3`.
  - DOCUMENTED (gh api / gh search, 2026-09-22).

## What it is

A fully exact B-rep for **3D Nef polyhedra**. These are all point sets generated from finitely many open halfspaces by complement and intersection. The class is closed under:

- union, intersection, difference, symmetric difference, complement;
- interior, closure, boundary, regularization;
- rigid transformations.

It can therefore represent non-manifold edges and vertices, open and closed boundaries, lower-dimensional features and unbounded sets. DOCUMENTED (manual "Definition", thesis ch. 2).

Using exact arithmetic, the implementation handles **all degeneracies explicitly** and "always produce[s] the correct mathematical result". Previous exact approaches "work in a less general modeling space". DOCUMENTED (thesis §1.2).

## How it works

### Theory

- **Local pyramid.** For a point x and a polyhedron P, pyr_P(x) is the cone x + R⁺((P ∩ U(x)) − x) for a small enough neighborhood U(x).
- **Faces.** They are the equivalence classes of points with equal local pyramids. They are relatively open and need not be connected.
- **Representation.** A Nef polyhedron with bounded boundary is determined by the local pyramids of its vertices (Bieri-Nef). The **reduced Würzburg structure is unique**, so "two point sets of Nef polyhedra are equal if and only if the representations are equal". CGAL's `==`, `<=` and friends are therefore trivial. DOCUMENTED (manual).

### Data structure (Selective Nef Complex, SNC)

DOCUMENTED (thesis §3.1-3.2, manual).

- **Sphere map per vertex.** Conceptually, intersect the local pyramid with an ε-sphere. The result is a 2D Nef polyhedron on S². It is stored as a halfedge structure with a selection mark on every item.
  - **svertex:** an edge leaving the vertex.
  - **sedge (shalfedge pair):** a great-arc piece, i.e. a facet passing through the vertex.
  - **sloop:** a facet through the vertex with no edge there, a full great circle. There is at most one per vertex.
  - **sface:** a volume sector.
  - Svertices keep their outgoing shalfedges in **counterclockwise order**. That order *is* the radial order of facets around the edge, which is how non-manifold edges are represented without a radial-edge structure.
- **Global incidences on top of the sphere maps:**
  - halfedge pairs (edge = svertex plus the opposite svertex in the other sphere map);
  - edge-uses = shalfedges;
  - halffacets as cycles of edge-uses (one outer cycle plus hole cycles; a single vertex can be a trivial hole cycle via an shalfloop);
  - shells (connected sets of boundary items reachable by traversal);
  - volumes (one outer shell plus inner shells).
- Every vertex, edge, facet and volume carries a **label**. The default label is a bool "selected" mark; any type with `&&`, `||`, `!` works (§4.2).
- **Infimaximal box** (§3.3). Unbounded sets are clipped to [−R, R]³ with R symbolic ("finite but larger than any concrete number"). Coordinates become polynomials in R.
  - Lemma 3.1: coordinates stay **linear in R even under iterated constructions**. Predicate signs come from leading coefficients.
  - This is optional: "standard" kernels restrict to bounded boundaries and are "considerably faster".

### Binary operation

Thesis ch. 4, code `Nef_3/include/CGAL/Nef_3/Binary_operation.h`, DOCUMENTED:

1. **Candidate vertex locations.** These are:
   - every vertex of A and of B;
   - every edge-edge and edge-facet intersection point between A and B.

   Intersections are found with `Box_intersection_d` on edge and facet boxes (streamed segment tree, `binop_intersection_test_segment_tree`), or with the kd-tree in an alternative compile path.
2. **Point location.** Each vertex of A is located in B (vertex, edge, facet or volume) with a kd-tree `SNC_point_locator` / `K3_tree`, and vice versa.
3. **Local overlay per location.** Build the sphere map of A and of B at that point. Where the point is not a vertex of an operand, the sphere map is *synthesized on the fly*:
   - in a volume: one sface;
   - on a facet: two sfaces separated by an sloop;
   - on an edge: two antipodal svertices plus one half-circle sedge per incident facet.

   Overlay the two sphere maps (map overlay on the sphere, §4.1), apply the Boolean to the marks (**selection**, §4.2), then **simplify** on the sphere (§4.3). Simplification uses three rules:
   - (1) delete an sedge separating two sfaces with its own mark;
   - (2) delete an svertex between two sedges on one great circle with equal marks;
   - (3) delete an isolated svertex inside an sface of the same mark.

   Face merging uses union-find, so the cost is O(n·α(n)).
4. **Drop redundant sphere maps.** These are vertices absorbed into an edge, facet or volume of the result. They are recognizable by the special structure above (§4.5).
5. **Synthesize the SNC from the surviving sphere maps** (§4.6). This is where global topology is rebuilt:
   - **Edges:** key each svertex (source vertex s, direction v) by **normalized Plücker coordinates** of the line through s and s+v:
     - homogeneous: divide by the gcd and fix the sign;
     - Cartesian: divide by the first coordinate.

     Group by key, sort lexicographically along the line, and pair consecutive svertices. The tie rule is that e⁻ goes before e⁺.
   - **Facet cycles:** at each edge, match shalfedges of the two end sphere maps lying in **oppositely oriented equal planes**, then walk the ccw and cw orders simultaneously to link previous/next pairs.
   - **Facets:** hole nesting per supporting plane uses *one planar sweep per oriented plane*. All halffacets on one plane are resolved in a single sweep, keyed by normalized plane equation.
   - **Shells:** graph traversal with a visitor.
   - **Volumes:** a shell is outer or inner according to a point location of direction (−1,0,0) in the sphere map of the shell's lexicographically smallest vertex. Nesting uses **ray shooting** from that vertex in −x against the kd-tree of the result.
6. **Optimizations** that matter (§9.1):
   - Overlays for "vertex inside a volume" and "edge crosses facet" are done **by hand**: the structure is fixed and there are no degeneracies. The general half-sphere sweep then runs only for edge-edge intersections and vertex-on-vertex/edge/facet contacts, i.e. only in degenerate situations. The sweep had used ">50% of the running time".
   - A vertex located inside a volume where `bop(true, mark(c)) == bop(false, mark(c))` is skipped entirely.
   - A sphere map entirely on one half-sphere is swept once instead of being cut in two.

### Sphere overlay details (§4.1.4)

- The sweep line is a half great circle pinned at the ±y poles, rotating around the sphere. `compare_xy` is built from 3D orientation tests only: no normalization, no trigonometry.
- Full-sphere sweeps are ill-posed: two points do not determine a great arc, and there is no start position. So every sphere map is cut at the equator z = 0, half-circles are split, and the two half-spheres are swept separately and rejoined. The added equator edges are later removed by simplification rule (1).

### Numeric model

- CGAL homogeneous kernel with integers (`leda_integer` is the fastest), or EPECK (filtered lazy rationals). EPECK "in non-degenerate scenarios … is faster" and handles OFF files with float coordinates. DOCUMENTED (manual "File I/O").
- **Exact constructions are mandatory.** The algorithm assumes all vertices of a facet are exactly coplanar. Inexact kernels fail even on simple inputs. DOCUMENTED (maintainer, https://github.com/CGAL/cgal/issues/5490).
- **Bit growth** (§9.5), DOCUMENTED:
  - "Consecutive binary operations on Nef polyhedra do not increase the bit complexity, since binary operations do not introduce new plane coordinates."
  - Only constructing new primitives from computed vertices grows bits. Example: 30-bit input coordinates give 93-bit planes, and an edge-plane intersection vertex needs up to 158 bits.
  - Runtime grew by 39-41% (one operand grown) and by 99-114% (both grown) going from 30 to 162 bits in the ROTCYLINDER experiment. Coordinates up to 10^107 (355 bits) were tested.
- **Floating-point filters do not help and even slow it down** (§9.6.3). The synthesis step keeps testing *equality* (same supporting line, same plane) of near-identical objects, where filters always fall back to exact arithmetic.
  - The fix proposed there is to pair items by **indices propagated through the operations** instead of by geometry.
  - CGAL later shipped this as `SNC_indexed_items`: "For effective filtering we had to change some concepts … must be activated by using the SNC_indexed_items". DOCUMENTED (thesis, manual).
- **Rotations:** only rational rotation matrices are exact. `rational_rotation_approximation` (Farey-sequence based) takes 0.01 s at α = 10⁻¹°, 4.47 s at 10⁻⁴° and 450 s at 10⁻⁶° (Table 6.1, Pentium III). A rotation also forces a kd-tree rebuild and, with extended kernels, a re-clip at the infimaximal box. DOCUMENTED.

## Robustness and guarantees

- **Proven/structural** (DOCUMENTED): with exact arithmetic, every predicate is decided correctly. All degenerate configurations (coplanar, collinear, vertex-on-edge and so on) are handled by the general overlay path. The result is the exact Nef set. Closure under all operations means *no operation can fail for representational reasons*: non-manifold results are valid values.
- **Uniqueness:** the representation is canonical, so equality is structural. DOCUMENTED.
- **Heuristic parts** are only performance:
  - the kd-tree has worst-case O(k²) construction;
  - box intersection has worst-case O(nm).

  Correctness does not depend on them. DOCUMENTED (ch. 7).
- **Not robust to inexact input handling.** Rotations and float I/O must be rationalized first. Otherwise assertions such as `normalized(cet->circle()) == normalized(ce->circle().opposite())` fire inside the SNC synthesis. Example: malformed halfspaces in https://github.com/CGAL/cgal/issues/2781, still open.

## Parallelism and performance

- **Complexity** (Table 7.3), for inputs of size n and m, result size k, and c result shells:
  - expected O((n+m) log³(n+m) + k log(n+m) + c·k^(1/3) log k);
  - worst case includes nm (box intersection, point location) and k²·k^(1/3) log k (ray shooting and kd-tree).
  - "Not sensitive to small areas of concern": subtracting a tiny object still re-synthesizes the whole result and rebuilds the kd-tree (§9.6.2).
  - DOCUMENTED.
- **Measured on 2005 hardware** (Pentium III 846 MHz, DOCUMENTED Tables 9.6-9.9):

  | Test | Nef | ACIS R13 |
  |---|---|---|
  | TETGRID, 23,883 result vertices | 67.3 s | 22.8 s |
  | TETGRID, 131,304 result vertices | 413 s | swapped from 70k vertices on (256 MB RAM) |
  | COMPLEX MINUS SIMPLE, 8,235 result vertices | 19.4 s | 3.2 s (about 6x faster) |
  | ROTCYLINDER, n = 2000 | wins slightly | **fails** ("not executable") for rotation angles ≤ 10⁻⁴°. Nef ran down to 10⁻⁷° (3219 s at n = 10000) and in §9.5 to angles of about 10⁻⁴⁰ |

  - kd-tree construction and planar sweeps are each about a quarter of runtime. In the quadratic-result experiment the kd-tree dominates.
- **Later comparisons** (DOCUMENTED in the cited sources and existing notes):
  - Bernstein-Fussell 2009: 16-28x slower than their BSP for iterated edits (`bernstein-fussell-2009-fast-exact-linear-booleans.md`).
  - Campen-Kobbelt 2010: 2.5-13x slower and about 5.3 GB at 200k faces versus <300 MB (`campen-kobbelt-2010-exact-and-robust-self-intersections-for--mesh-bool.md`).
  - OpenSCAD fast-csg (corefinement) vs Nef: 5x-178x (https://gist.github.com/ochafik/2db96400e3c1f73558fcede990b8a355).
  - Solidean iterated-cube-grid: Nef 280 s vs Solidean 0.98 s, but Nef *canonical*, whereas CGAL corefine declined at op 5 (https://solidean.com/blog/2026/iterated-cube-grid-benchmark/). Vendor-run, HEARSAY until reproduced.
- **Parallelism:** none in the implementation. The EPECK lazy DAG is shared mutable state (issue https://github.com/CGAL/cgal/issues/6141: CORE number types are not thread-safe; EPECK objects are reference-counted and thread-safe but not atomic). DOCUMENTED.
- **Structural parallelism is high** (INFERRED): steps 1-4 are independent per candidate location. Each sphere-map overlay reads only the local pyramids of A and B at one point. Synthesis is sort/group-by (Plücker keys, plane keys) plus connected components plus independent ray queries.

## Known failures, limitations, war stories

- **Exact constructions required.** Inexact kernels break the coplanarity invariant. A "fuzzy double" kernel attempt "explodes in Convex_decomposition_3". https://github.com/CGAL/cgal/issues/5490
- **Memory growth from repeated transforms** through the EPECK DAG. The maintainer suggests forcing `exact()`, but bits still grow. https://github.com/CGAL/cgal/issues/8074
- **Assertions in derived algorithms**, all open:
  - `convex_decomposition_3` "ray should hit vertex, edge, or facet": https://github.com/CGAL/cgal/issues/8447
  - segfault or infinite loop: https://github.com/CGAL/cgal/issues/5711, https://github.com/CGAL/cgal/issues/5703
  - Minkowski sum union assertion: https://github.com/CGAL/cgal/issues/6973
  - "not possible to decide which one is a visible facet": https://github.com/CGAL/cgal/issues/7271
  - Correctness bugs remain in the large exact code base despite exactness.
- **Thesis self-assessment** (§9.6): weaknesses are the kd-tree on polyhedra with linear-size facets, full re-synthesis for local edits, and coordinate growth.
- **Ecosystem outcome:** OpenSCAD's slow renders were due to Nef. It moved to corefinement (fast-csg, 2022) and then to Manifold. INFERRED from PR https://github.com/openscad/openscad/pull/4087 plus common knowledge; the Manifold switch is documented in the Manifold note.

## Relevance for wonky

INFERRED throughout.

1. **Vertex-local classification, "sphere maps" as the degeneracy oracle.** The Nef insight is that every hard Boolean case is decided **locally at a point** by overlaying two local pyramids and applying the Boolean to marks. Cases include knife-edges, shared edges, a vertex on a face, coplanar faces, and cubes touching at an edge. This is exactly the tool for the cases SolveSpace's BSP and the mesh prototypes get wrong. For wonky's recovery step:
   - at each result vertex, build the directions of incident edges and the great-circle arcs of incident planar faces (a planar face at a vertex is a great arc of its plane);
   - overlay, select, simplify.

   **Caveat for curved faces:** a cylinder or cone through a vertex contributes its *tangent plane* as a great circle only to first order. Tangential contacts, such as a plane tangent to a cylinder or equal-radius cylinders, have coincident first-order pyramids. They need second-order tie-breaks, i.e. curvature, as in the Patrikalakis 6.4 classifier. A pure Nef-style sphere map is **not** sufficient for wonky's curved cases. Detect "coincident first-order sectors" and either escalate to the second-order classifier or fail explicitly.
2. **Labels generalize to CSG trees.** Selection with arbitrary label algebras means a cell can carry the vector of leaf memberships and evaluate the whole CSG tree at once. `kernel/proto/exact-plane/classify.bend` already does this per piece ("CSG tree evaluated with leaf i inside at q- and outside at q+"). Nef adds **exact regularization** as a separate topological operation: interior followed by closure. It is a clean definition of what "regularized Boolean" means when wonky's result has dangling faces.
3. **Canonical form, and so geometric diff.** Uniqueness of the reduced representation gives a canonical form, and two models are equal iff their canonical forms are equal. The Nef simplification rules are the exact analogue of OCCT's `UnifySameDomain`:
   - merge same-mark faces on one plane;
   - merge collinear edges;
   - drop absorbed vertices.

   For wonky's diff/review tooling, running these rules exactly (same plane decided by exact predicates on analytic plane data) gives a *history-independent* canonical B-rep to compare, next to the provenance-based diff. For a single valid solid this is cheap: marks are just in/out.
4. **Pair by provenance, not by geometry** (thesis §9.6.3). Nef's own authors found that synthesizing topology by *geometric equality tests* defeats floating filters, and switched to propagated indices (`SNC_indexed_items`). Wonky's tagged mesh and provenance records are that index. In recovery:
   - edges between faces come from `(tagA, tagB)` pairs;
   - coplanar faces are grouped by source-plane id;
   - exact geometric equality is used only as a checked assertion.
5. **Keep planes primary to bound bits.** "Binary operations do not introduce new plane coordinates." A plane-based representation, where every vertex is the intersection of three input planes and every predicate is a fixed-degree polynomial in input plane coefficients, keeps bit sizes constant through any CSG chain. This is the EMBER / exact-plane design, and wonky's `big.bend` sizes (≤ 325 bits, 21 16-bit limbs) are the bounded version of Nef's growing rationals. Chained Booleans must never re-derive planes from rounded vertices; that is what makes Nef's growth example climb from 30 to 158 bits.
6. **Rotations are approximations with explicit tolerance.** Nef shows the cost of pretending otherwise: 450 s for one exact rotation at 10⁻⁶°. Wonky's inputs are F32x2 dyadic rationals. A rotated primitive should be rounded once onto the input grid, recording the deviation bound, and then treated as exact input.
7. **Bend fit of the algorithm skeleton.** Surprisingly good, unlike the implementation:
   - candidate locations: a map over edge/facet pairs from the broad phase;
   - local overlay per location: a map; small per-vertex problems of bounded size in CAD models. Not GPU-uniform because degrees vary, but CPU fork-join;
   - synthesis: sort by key (Plücker or plane), then zip pairs;
   - shells: connected components by label propagation;
   - volumes: independent exact ray queries.

   No step needs mutation once sphere maps are values. The expensive parts, kd-tree construction and planar sweeps, can be replaced by a BVH query (as in wonky's corefine prototype) and by a sort-based nesting of hole cycles.
8. **Cost warning.** Exact rational *constructions* everywhere (EPECK DAGs, GMP) are why Nef is 2-6x slower than ACIS in 2005 and 100-300x slower than modern mesh Booleans. Wonky should use exact **predicates** on bounded-degree symbolic nodes, and constructions only as F32x2 approximations with certified error.

## Pointers worth porting or studying

- Thesis:
  - §3.1-3.2: sphere maps and the SNC item list (Figures 3.2-3.3);
  - §3.3 plus Lemma 3.1: infimaximal box, linearity in R;
  - §4.1.4: half-sphere sweep and why full-sphere sweeps fail;
  - §4.3: the three simplification rules plus union-find;
  - §4.4: synthesizing local pyramids for volume, facet and edge locations;
  - §4.6.1: Plücker-keyed edge pairing with the e⁻/e⁺ tie rule, worked example Fig. 4.11;
  - §4.6.2: facet-cycle linking via opposite planes, Fig. 4.13;
  - §4.6.4: outer/inner shell decision via the smallest vertex plus direction (−1,0,0);
  - §9.1.3: by-hand overlays for the common cases;
  - §9.5: bit-growth analysis;
  - §9.6.3: indices versus geometric equality.
- Code:
  - `Nef_3/include/CGAL/Nef_3/Binary_operation.h`: the driver, callbacks `Intersection_call_back` for edge-edge / edge-facet;
  - `SNC_external_structure.h`: synthesis (`build_after_binary_operation`, Plücker pairing, facet cycles);
  - `SNC_simplify.h`;
  - `SNC_constructor.h`: sphere maps for edges, facets and volumes on the fly;
  - `Nef_S2/include/CGAL/Nef_S2/SM_overlayer.h`: sphere overlay, selection, simplification, 2,465 lines;
  - `K3_tree.h`: kd-tree.
- Manual sections "Definition" (local pyramid, faces), "Regularized Set Operations", "File I/O" (kernel recommendations and `SNC_indexed_items`).

## Verdict: learn-from

Nef is the reference design for "never wrong on degeneracies" in the polyhedral domain. Its vertex-local overlay-select-simplify, its canonical form, its bounded bit growth when planes stay primary, and its authors' own lesson to pair by propagated indices rather than geometric equality all map well onto wonky's exact-plane and recovery work. The skeleton is fork-join friendly.

Do not port: GPL code, mandatory exact rational constructions, an EPECK DAG and GMP model incompatible with Bend, 2-300x slower than alternatives, and a first-order-only local model that does not decide wonky's tangential curved contacts.
