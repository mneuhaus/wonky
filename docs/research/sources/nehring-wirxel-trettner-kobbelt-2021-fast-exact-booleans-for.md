# Nehring-Wirxel, Trettner, Kobbelt 2021: Fast Exact Booleans for Iterated CSG using Octree-Embedded BSPs

- Kind: journal paper. Canonical: https://doi.org/10.1016/j.cad.2021.103015 (Computer-Aided Design 135, 103015, June 2021; Crossref lists 34 citations as of 2026-09-22).
  - Preprint: https://arxiv.org/abs/2103.02486 (v1, 3 Mar 2021). Group page: https://www.graphics.rwth-aachen.de/publication/03331/.
  - Local copy: tmp/research/pdf/nehringwirxel2021-octree-bsp.pdf (text: nehringwirxel2021.txt).
- Authors/org: Julius Nehring-Wirxel, Philip Trettner, Leif Kobbelt (RWTH Aachen, Lehrstuhl für Informatik 8). Trettner later founded Shaped Code GmbH (EMBER, Solidean).
- License: paper © Elsevier, with a free arXiv preprint. **No official code** (no code link on arXiv or the RWTH page, checked 2026-09-22).
  - An unofficial reimplementation exists: https://github.com/quadmotor/hypercut ("HyperCutter"). It has 5 stars, was created 2024-07-29, and was last pushed 2024-08-12. It has **no licence file**, so all rights are reserved and its code must not be copied.
  - Its README says "This repo only implement the bsp tree and limit to 128bit". Local clone: tmp/research/nehring-wirxel-trettner-kobbelt-2021-fast-exact-booleans-for/hypercut (DOCUMENTED).
  - Porting implication: implement clean-room from the paper. Equations and algorithms are free to reimplement.
- Status: historical. It is the arithmetic foundation of EMBER (2022) and Solidean (DOCUMENTED, EMBER section 3: "Our method uses the fixed size integer construction of [Nehring-Wirxel et al. 2021]").

## What it is

A volumetric, exact representation for *iterated* CSG (a long chain of small tools against one growing workpiece). It has three parts:
- A global persistent octree whose cells each hold a small BSP tree with integer plane coefficients and in/out leaf labels.
- Exact fixed-width (128/192/256-bit) integer predicates on plane-based geometry, with vertices stored as homogeneous 4D integers.
- A fast exact plane-vs-convex-polyhedron cutting routine. BSP merge (Booleans), boundary extraction (mesh output) and BSP simplification are all formulated in terms of it.

## How it works

### Arithmetic foundation (section 3.2, DOCUMENTED)
- **Planes.** Integer (a,b,c,d), with n = (a,b,c) and d = −vᵀn for an input vertex v.
- **Predicates:**
  - coplanar iff n_p × n_q = 0 (eq. 1);
  - three planes meet in a unique point iff |n_p n_q n_r| ≠ 0 (eq. 2);
  - Bernstein-Fussell classification is sign|p q r s| · sign|n_p n_q n_r| (eq. 3), which costs a 4×4 determinant per test.
- **New in this paper: homogeneous vertices** (eq. 4-6). Solve the 3×3 system by Cramer: x = (|A1|, |A2|, |A3|, |A|), four 3×3 determinants computed once per vertex. Then classify(x,s) = sign(xᵀs) · sign(x4), a 4D dot product per test.
  - Classification is far more frequent than construction, so this split is the main speed-up.
  - xᵀs equals |p q r s|, so the bound analysis is unchanged.
- **Bit budget:**
  - Hadamard: a 4×4 determinant with entries in [−1,1] is at most 16. Three columns are bounded by n+ and one by d+, so |p q r s| ≤ 16·n+³·d+. Estimate d+ ≤ 3·v+·n+.
  - **Overflow-free exactness with b-bit integers:** n+⁴ · v+ ≤ (1/48) · 2^(b−1) (eq. 7). This general form lets normal and position bits be chosen separately, which is useful when planes are constructed directly.
  - Normals computed from triangle edges: n+ = 2e+² = 8v+², which gives v+⁹ ≤ 2^(b−1)/(8⁴·48) (eq. 8), i.e. **v+ ≤ 0.239 · 2^(b/9) ≈ 2^(b/9−2)** (eq. 9).
  - Fig. 2 limits: 256 bit → 8.73·10⁷ ("slightly above 26 bit"); 192 bit → 6.31·10⁵; 128 bit → 4.57·10³; 64 bit → 33.
  - On a 1 m³ box that is 11.5 nm (256), 1.58 µm (192) or 0.22 mm (128).
  - The most permissive setting is 256 bit with 27-bit positions and 55-bit normals (section 4.6).
- **Implementation.** Chains of `_addcarry_u64` for 64·k-bit add, and `_mulx_u64` (64×64→128) schoolbook multiplication, "well suited for integers consisting of only a few 64 bit blocks".
  - GMP and Shewchuk filters were rejected as "either too slow or having insufficient resolution".
  - plane-from-points includes a gcd normalisation that is needed only if normals could exceed the limits.

### Exact mesh cutting (section 3.3, figs. 3-4, DOCUMENTED)
- Input: a strictly convex polyhedron as a half-edge mesh with homogeneous 4D integer vertices, plus a cut plane.
- **Edge descent.** From a start half-edge, walk greedily to the neighbour vertex with the smallest distance to the plane (GJK-like). Stop at a vertex on the other side, or at a vertex on the plane. A global minimum on the wrong side proves there is no proper intersection, where "proper" means both parts have non-zero volume; a coplanar face is not proper.
- **Marching.** Walk around the cut ring, splitting faces. There are only two cases: an edge with endpoints on opposite sides (split it), or a vertex exactly on the plane (duplicate it and insert cut edges).
- Modification is in place and touches only a fraction of the mesh. Per-cut cost grows sub-linearly with mesh size (empirical, fig. 9). Exactness keeps both halves perfectly convex.
- **Guarantee** (section 4.6): a strictly convex input (no coplanar faces) yields two strictly convex outputs, or the unchanged mesh.

### Boundary extraction (section 3.4, figs. 5-6)
1. Cut a bounding-box mesh recursively by every inner BSP node. This gives one convex cell per in-leaf. Every new cut face is annotated with the BSP node on the opposite side. Out-leaves are discarded.
2. Clip each face against its opposite subtree (2D polygon clipping). Keep only in→out pieces and drop in→in pieces.
3. Repeat the procedure to subdivide edges by the opposite BSP. This adds valence-2 vertices so that there are no one-sided T-junctions.
- The result is an exact polygon mesh of the BSP surface.

### BSP Boolean by cutting (section 3.5)
- Naylor-style merge with a label merge function f_m(s_a, s_b); union returns out only if both inputs are out. The recursion runs on A only:
  1. If A or B is a leaf, emit in, out, A, B or a leaf-inverted copy.
  2. Otherwise cut A's plane against the current cell mesh. If the intersection is proper, recurse into both children with B. Otherwise recurse into the child that contains the cell.
- B is copied, never recursed. So the result's cell is then additionally cut by B's planes, which feeds the redundancy removal step.

### Import, simplification, octree (sections 3.6-3.9)
- **BSP import** (Naylor). Insert faces one at a time: split at inner nodes, replace a leaf by the face's plane, discard coplanar faces. Insertion order is random, because octree-bounded BSP size makes balancing heuristics pointless.
  - No re-triangulation: clipped polygons have fractional corners, and new planes would need more bits.
- **Redundancy removal.** Extract the boundary and rebuild the BSP after *every* merge. This is only feasible because extraction is exact and fast.
- **Octree-embedded BSP:**
  - each cell holds a BSP; the maximum BSP size (100-200 nodes, figs. 11-12) is the subdivision criterion;
  - subdividing a cell = intersecting its BSP with the child boxes;
  - combining 8 children = an "axis-BSP" (3 levels of axis planes) with the child BSPs in its leaves, followed by redundancy removal;
  - pathological case: a valence-250 vertex at a fractional coordinate can never be split below 250 nodes.
- **Octree import:**
  1. build a triangle octree by triangle count;
  2. clip triangles to their cells exactly (homogeneous corners);
  3. build a BSP per cell;
  4. subdivide by BSP size;
  5. flood-fill in/out labels into empty cells.
- **Memory** (section 4.4):
  - BSP = flat node array (child indices plus a plane-palette index);
  - a plane takes 20 B in 128-bit mode or 40 B in 256-bit mode ("plane coefficients are significantly smaller than the largest intermediate result");
  - the temporary half-edge mesh needs about 600-850 B per BSP node, and can grow quadratically in pathological cases;
  - import overhead is under 50 B per input face.

## Robustness and guarantees

- **"Our core algorithms, BSP mesh extraction and BSP merging, are unconditionally stable and correct"** for any BSP with integer planes within the limits. Fuzzing random BSPs until the machine ran out of memory produced no failure (DOCUMENTED, section 4.6). The guarantee extends to the octree, which is a union of BSPs.
- **Only import and export can break correctness** (DOCUMENTED, section 4.6):
  - Float export needs rounding. Even correctly rounded output can self-intersect, and topology-preserving rounding is NP-hard (Milenkovic-Nackman 1990).
  - Import of **non-watertight** input produces "superfluous microgeometry and misclassified cells".
  - Import guarantee: a watertight mesh that stays self-intersection-free under any relative perturbation ≤ 1e-8 is imported to a BSP within 1e-8 relative Hausdorff distance.
- **Input requirement:** watertight and self-intersection-free. The authors call this easy to lift via Campen-Kobbelt 2010 or winding numbers, and EMBER later lifted it (DOCUMENTED, section 6).
- No tolerances anywhere inside.

## Parallelism and performance

- **Setup:** single thread, i7-7700K 4.2 GHz, Clang 7 -O2 (DOCUMENTED, section 4).
- **Table 1, CPU cycles per elementary operation** (CGAL = Lazy_exact_nt<Quotient<MP_Float>>; GMP and CGAL show 5-10% variance from allocation):

  | operation | 128b | 192b | 256b | CGAL | gmp |
  |---|---|---|---|---|---|
  | plane from points (with gcd) | 226 | 512 | 761 | 2770 | 9100 |
  | are planes parallel | 5 | 15 | 15 | 910 | 1840 |
  | signed distance | 4 | 5 | 11 | 530 | 1360 |
  | to double position | 5 | 62 | 88 | 31 | 120 |
  | intersect 3 planes | 23 | 160 | 402 | 4200 | 6380 |
  | classify vertex | 13 | 103 | 142 | 710 | 1540 |

- **Throughput:**
  - Up to **2.5 M mesh-plane cuts/s per core**; about **40-50 M output BSP nodes/s** via CSG; exact extraction is "almost two orders of magnitude" faster than before (abstract; sections 4.2-4.3).
  - For random BSPs the output size is roughly quadratic in the input size (fig. 10).
- **Iterated CSG applications** (section 5):
  - Gear swept along a Bézier curve: 764,501 unions in 281 s (max BSP 300, fig. 12).
  - Milling: a drill bit with 4° sweep steps, 90 sweeps per revolution, 3 revolutions, 270 tool subtractions and 58,472 BSP subtractions, took **29 s** (fig. 13).
  - **Only this method and CGAL Nef finished the milling chain.** Cork crashed after 17 steps, Zhou 2016 and Cherchi 2020 after 71, and Campen-Kobbelt 2010 after 12 (fig. 14).
  - Also reproduced: the 10,000-dodecahedra bunny carve (Bernstein-Fussell) and the David milling (Zhou 2016).
- **Parallelism:** the implementation is single-threaded. The authors expect "almost linear speedup" by merging octree cells in parallel (DOCUMENTED, section 6).
- EMBER later beat this method on the same milling case even when rebuilding its subdivision each step (DOCUMENTED, EMBER fig. 14).

## Known failures, limitations, war stories

- **Fixed precision.** Input must be rounded to integers first. A GMP fallback is "always possible but causes at least a 10× slowdown". The authors propose per-plane precision tracking with dispatch to different fixed widths (DOCUMENTED, section 6).
- **Merge cost.** Large BSP-BSP merges stay superlinear, so the method suits "complex workpiece vs simple tool". For one-shot merges of two complex objects, a Campen-Kobbelt-style temporary octree is more appropriate (DOCUMENTED, section 6).
- **Output quality.** Faces are split at octree cell borders, so the output has more faces than CGAL Nef (fig. 14b). There are valence-2 vertices, and non-triangulated convex polygons.
- **hypercut** (INFERRED from reading src/bsp/bsp.cpp):
  - `plane_from_points` computes the cross product in `int32` (Eigen `Vector3i`), so coordinates above roughly 2^15 overflow silently.
  - `BspPlane` is {int32 a,b,c; int64 d} with 128-bit homogeneous points.
  - This is a cautionary example of the paper's bit budget being ignored in a reimplementation.

## Relevance for wonky

**The bit-budget rule is directly reusable** (INFERRED unless noted):
- **General form.** With classify ≤ 48·n+⁴·v+, the cost in bits is about 4·N + B + 6 for N-bit normals and B-bit positions. The special case n+ = 8v+² gives 9·B + ~18.
  - wonky's `kernel/proto/exact-plane` already states "9 B + 19 bits … 325 bits at B = 34 … 21 limbs" for vertex-derived planes (DOCUMENTED, big.bend header).
- **Directly quantized planes are much cheaper.** For analytic *planar* B-rep faces whose planes are quantized directly, N = B = 24 would need only about 126 bits (8 16-bit limbs) instead of 235.
  - Caveat: independently quantized planes do not meet at shared vertices of valence > 3. The paper's own motivation is that "six planes should intersect in a single point, something extraordinarily unlikely" with floats.
  - So direct plane input only works for plane-based B-reps whose every vertex is *defined* as a 3-plane intersection (Sugihara-Iri 1990 style). Tessellated curved faces need vertex-derived planes.
- **Cost model for Bend.** Table 1 is the only published per-operation cycle count for fixed-width exact geometry.
  - Bend's U32 multiply returns only the low word (DOCUMENTED, verified 2026-09-24 in the Bend clone ff7a40c): `u32_mul` lowers to `(u64)((u32)a * (u32)b)` in C and `Math.imul(a, b) >>> 0` in JS (bend2/comp.ts:187-190). README.md:227 says "no U64, I64 or F64".
  - Limbs must therefore be 16-bit. A 256-bit multiply then costs 16 limbs × 16 limbs = 256 products vs 4 × 4 = 16 `mulx` in the paper: **16×, not 4×**. The 4× figure would hold only for 32-bit limbs with a mul-hi. One Karatsuba level brings 256 down to 192 (INFERRED). A U32 mul-hi builtin in Bend would restore the 4× ratio, which makes it worth an upstream request.
  - **Measured in wonky** (DOCUMENTED, docs/proto-exact-plane.md "Bit widths…", `tmp/exact-plane/pred-bench.bend`, native, 1 thread, M5 Pro; variable-length `List<U32>` 16-bit-limb Bigs):

    | plane-side evaluation | wonky filtered (F32x2) | wonky exact Big | NW2021 Table 1, 256-bit (i7-7700K 4.2 GHz) |
    |---|---|---|---|
    | grid point (34-bit, W = 1) vs face plane | 0.10 µs | 1.3 µs | signed distance 11 cycles ≈ 3 ns |
    | constructed vertex (W up to 192 bits) vs face plane | 0.20 µs | 6.0 µs | classify vertex 142 cycles ≈ 34 ns |

    - Ratio (INFERRED, different CPUs and clock rates, so an order of magnitude only): wonky's exact path is about 175× NW2021's fixed-width 256-bit classify, and even its F32x2 filter is about 6× slower than NW2021's *exact* classify.
    - The gap is far above the 16× limb-count penalty. The rest is variable-length lists (allocation per limb, length branches) and runtime overhead. Fixed-width limb records are the first optimization. The prototype's own profile agrees: exact zeros (7 % of signs on hex-nut) cost as much as all filtered signs.
  - **Bit growth per grid bit** (INFERRED). In wonky's exact-plane, face-plane normals are ≈ 2B+3 bits (|n| < 2^71 at B = 34) and edge-plane normals ≈ B+2 bits (< 2^36). Axis planes are tiny. W = n1·(n2×n3) therefore grows by a different amount per grid bit for each vertex type:
    - one face plane, one edge plane and one axis plane: W ≈ 3B+5, i.e. 3 bits;
    - one face plane and two edge planes: about 4 bits;
    - three face planes: W ≈ 6B+11 (the documented |W| < 2^215 at B = 34), i.e. 6 bits.

    The classify predicate grows by 9 bits per grid bit in the worst case (9B+19). docs/proto-exact-plane.md's "each extra bit of grid resolution adds 3 bits to a vertex W" is true only for the first vertex type. Size limbs from the worst case.

**Persistent octree vs Bend immutability** (INFERRED):
- A persistent tree is idiomatic in an immutable language. An operation rebuilds only the cells overlapping the tool's box and shares all others (path copying). Per-feature cost is then proportional to the modified region, the property the paper argues iterated CSG needs.
- The in-place half-edge cutting (edge descent) does not port directly. For octree-bounded cells (≤ 100-300 planes), a functional convex cell works instead: a list of faces as (supporting plane, cyclic list of edge planes / homogeneous corners), cut by "classify all vertices".
  - That costs O(cell size) per cut. It loses the sub-linear edge descent, which fig. 9 shows matters for deep BSPs, but depth is bounded by the octree.
  - Affine arrays could reintroduce adjacency for edge descent later.
- Fork-join: octree children merge independently, so an 8-way split becomes three balanced binary fork levels. Work per cell is non-uniform, so this suits the CPU target, while the fixed-width predicates can be GPU-batched.

**Beyond Booleans: exact volumetric queries** for wonky's missing "general compare/interference" (INFERRED):
- point-in-solid = BSP descent with at most depth classifications;
- interference = merge(A ∩ B) with early exit on the first non-empty in-cell;
- exact equality/diff = A xor B empty;
- exact volumes and centroids = sums over convex in-cells.
- Structural sharing between feature steps gives a Merkle-style octree for cheap model diffs: unchanged cells are identical subtrees. This ties into wonky's diff/provenance goals.
- The current plan answers interference with corefine intersect (volume > 0 plus components). A face-touching intersect is refused rather than returned empty, and zero-volume contact comes back as a refusal or an empty mesh (DOCUMENTED, docs/hybrid-boolean-plan.md section 5). An exact BSP/octree membership structure is the natural upgrade *if* contact vs overlap must be decided exactly, e.g. for print-in-place clearance classes. Until then it is not needed (INFERRED).

**FDM:** iterated CSG is a natural fit for toolpath- or slicer-style carving simulations. For a print mesh, the octree-split faces and T-junction-free extraction still need cleanup and a stated rounding tolerance.

## Pointers worth porting or studying

- Eq. 4-6 (homogeneous vertex plus dot-product classify) and eq. 7-9 plus fig. 2 (bit budgets). Adopt them verbatim as the sizing rule for every exact-plane type in wonky.
- Table 1: the target cost per predicate for a Bend benchmark.
- Section 3.3 plus figs. 3-4: exact convex cutting (edge descent, marching, the two face cases).
- Sections 3.4-3.5 plus fig. 6: extraction by "opposite subtree" clipping and merge-by-cutting.
- Section 3.7: simplification by exact extract/re-import, a pattern for canonicalising any exact result.
- Section 3.8 plus fig. 8: octree subdivide/combine expressed as BSP operations (the axis-BSP trick).
- Section 4.6: the import guarantee statement (relative 1e-8), a model for how wonky should phrase its own import contract.
- Fig. 14: the milling crash table (Cork 17, Zhou/Cherchi 71, Campen-Kobbelt 12) as evidence for why iterated-CSG tests belong in the bake-off.

## Verdict: learn-from

Adopt the arithmetic part outright: homogeneous vertices, the dot-product classify, the eq. 7-9 bit-budget rule and Table 1 as the cost yardstick. That part is already the basis of wonky's exact-plane prototype and of EMBER. Measured against Table 1, wonky's variable-length Bigs are about two orders of magnitude slower per exact classify, so fixed-width 16-bit-limb records (or a Bend mul-hi) are the first thing to fix if exact predicates ever move into the production path.

The octree-embedded BSP is not the right primary Boolean for wonky: EMBER supersedes it for single operations, and its cutting core is mutation-heavy. It is, however, a strong candidate structure for exact point membership, interference, diff and incremental iterated CSG. Prototype it later as a functional persistent octree if those features need exact answers.

Do not reuse the hypercut code, which is unlicensed and ignores the overflow bounds.
