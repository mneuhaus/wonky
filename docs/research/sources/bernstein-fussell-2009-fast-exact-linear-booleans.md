# Bernstein and Fussell 2009: Fast, Exact, Linear Booleans

- Kind: peer-reviewed paper (Eurographics Symposium on Geometry Processing 2009). No public code.
- Canonical URL: https://doi.org/10.1111/j.1467-8659.2009.01504.x
- Other URLs:
  - Author PDF: http://www.gilbertbernstein.com/resources/booleans2009.pdf (2.8 MB)
  - Project page: http://www.gilbertbernstein.com/projects/boolean.html
  - Sculpting movie: http://www.gilbertbernstein.com/resources/bunsculpt.mov
  - Author's later, unrelated float library Cork: https://github.com/gilbo/cork
- Authors/organization, year: Gilbert Bernstein and Don Fussell, University of Texas at Austin, 2009. DOCUMENTED (paper header).
- Venue: Computer Graphics Forum 28(5), pp. 1269–1278, July 2009 (SGP 2009). Crossref counts 45 citations (https://api.crossref.org/works/10.1111/j.1467-8659.2009.01504.x, queried 2026-09-22). DOCUMENTED.
- License and porting:
  - Paper © the authors / Eurographics. The algorithms are unencumbered as far as the paper states.
  - The original code is available only "if you would like a copy of my old code for this project, please e-mail me" (project page). There is no public repository. DOCUMENTED.
  - Porting means re-implementing from the paper. That is feasible, because the whole substrate is 4 predicates plus 2 polygon routines.
- Status: finished research. It became the direct ancestor of Campen and Kobbelt 2010 (octree-localized BSP), Nehring-Wirxel, Trettner and Kobbelt 2021 (octree-embedded BSPs with fixed-width integers, https://arxiv.org/abs/2103.02486), and EMBER 2022.
- Cork (gilbo/cork, 444 stars, LGPL with Qt exception, last commit 2016-03-29) is explicitly "not an implementation of the BSP technique presented in this paper" (project page). DOCUMENTED.

## What it is

An exact Boolean system for linear 3D polyhedra built on plane-based BSP trees. Its central claim: if you "use planes, not points" (after Sugihara and Iri 1989), a linear Boolean needs **no constructions**, only predicates. Predicates on input planes have a fixed arithmetic depth, so fixed-precision static filters can decide every branch exactly. Every degeneracy is then handled explicitly by the BSP merge, without symbolic perturbation. DOCUMENTED (§2.1, §3, http://www.gilbertbernstein.com/resources/booleans2009.pdf).

Target application: interactive sculpting by iterated Booleans. Headline result: "16-28× faster at performing iterative computations than CGAL's Nef Polyhedra … while being only twice as slow as the non-robust modeler Maya" (abstract). DOCUMENTED.

## How it works

### Numeric substrate (§3.1, DOCUMENTED)

- A plane is a quadruple `(a,b,c,d)` of **single-precision floats**.
- A "point" is a triple of planes `(p,q,r)`. Lines are never used.
- There are exactly four predicates:
  1. **coincidence:** all 2×2 minors of `[p;q]` are zero.
  2. **coincident orientation:** all products `pa·qa, pb·qb, pc·qc, pd·qd` are ≥ 0.
  3. **point validity:** `det3(normals of p,q,r) ≠ 0`.
  4. **orientation of point (p,q,r) against plane s:** `sign(det3(pqr normals) · det4(p,q,r,s))`.
- The 4×4 determinant is computed as a Plücker-coordinate dot product of the lines p∧q and r∧s rather than by cofactor expansion. This gives a shallower arithmetic tree and a tighter static error bound.
- Inputs are f32 and the computation is f64. Quote: "This allows us to guarantee the absence of exponent overflow/underflow, and allows us to tighten our static error bounds."
- "We only use single stage filters, for simplicity's sake." The paper does not say what happens when the filter is inconclusive (re-read 2026-09-24 in `tmp/research/pdf/bernstein2009.txt`, lines 237-252; the only other mention of error handling is the Priest remark for I/O in §3.4). INFERRED: an exact fallback (or input restricted so the filter always decides) is required for the exactness claim. The text leaves this gap. It matters most for **true zeros**: a static filter can never certify a zero, and coplanar or touching CAD input produces zeros all the time (see "Sizing" below).

### Sizing the four predicates in wonky's integers (INFERRED, cross-checked against `docs/proto-exact-plane.md`)

Take integer planes with |a|,|b|,|c| < 2^α and |d| < 2^β.

- Plücker coordinates of p∧q are the six 2×2 minors of `[p;q]`: three normal×normal minors (< 2^(2α+1)) and three normal×offset minors (< 2^(α+β+1)).
- `det4(p,q,r,s)` = Plücker(p∧q) · dual-Plücker(r∧s) pairs each normal×normal minor with a normal×offset minor: |det4| < 6·2^(3α+β+2), so about **3α+β+5 bits**.
- `det3(normals)` < 6·2^(3α): about **3α+3 bits**.
- Never form the product: `sign(det3·det4) = sign(det3)·sign(det4)`. The widest intermediate is det4.

With exact-plane's face planes at B = 34-bit grid coordinates (α = 2B+3 = 71, β = 3B+5 = 107): det4 needs 3·71+107+5 = **325 bits**, det3 216 bits. That equals exact-plane's own worst case for the cached-vertex plane-side test (9B+19 = 325 bits, 21 limbs of 16 bits). So BF09's "no constructions" form and EMBER's "cache the homogeneous vertex (X,Y,Z,W)" form have the same worst-case width; they differ in work and memory. BF09 recomputes 6 minors and 6 products per test and stores 3 plane ids per vertex; exact-plane stores four Big integers per vertex (observed up to 192/160 bits) and pays a 4-term dot product per test. INFERRED: in Bend, where exact-plane's arrangement turned out allocation-heavy (variable-length Bigs in lists), the BF09 form is worth a benchmark for vertices that are tested only a few times.

**Symbolic zeros come free with plane triples.** If s is one of p, q, r, the orientation is zero by identity, with no arithmetic. exact-plane measured why this matters: on `hex-nut` 1.07M signs were certified by the float filter, 85,456 were exact zeros and only 20 were exact non-zeros; the exact zeros are 7 % of signs but cost about as much as all filtered signs together. Its "symbolic zero" path (the plane is one of the vertex's three defining planes, known by id) already removes 459 of them on that case, and its doc names "more symbolic zeros" as the next speed-up. DOCUMENTED (wonky measurement), INFERRED link to BF09.

### Geometric substrate (§3.2, DOCUMENTED)

**Convex polygon.** A polygon is a support plane `s` plus bounding planes `b_i` in CCW order. Vertex `v_i = (s, b_{i-1}, b_i)`.

**Plane to polygon.** Clip the plane against a fixed "very large box" (x±, y±, z±). The box's axes are chosen from the dominant normal component, and z± is then clipped with the splitter.

**Polygon splitting.** This is a Sutherland–Hodgman-style clipper that decides whether to *emit a plane*, not whether to emit a vertex:
- Each step classifies three consecutive vertices `v_{i-1}, v_i, v_{i+1}` against the clip plane h (27 codes).
- A lookup table (Table 1) says whether to output `b_i` (B), `h` (H), or both in order (HB).
- Two pitfalls are handled:
  - H is emitted only when re-entering the positive halfspace.
  - If edge `b_i` lies in h, `b_i` is dropped.
- Three vertices are needed because two cannot distinguish a hexagon clipped along a diagonal from a triangle clipped at a vertex (Fig. 2).
- No line–plane intersection is ever constructed.

### BSP set operations (§3.3, DOCUMENTED)

- The scaffold is the Naylor, Amanatides and Thibault 1990 "merge": repeatedly split one tree by the other's root partition. Each step reduces the set operation to two smaller instances.
- Leaves are coloured IN/OUT per operand, and the Boolean result follows by table lookup.
- Splitting a subtree T by plane S only needs to classify T.shp against S ∩ T.region. There are 7 arrangements (Fig. 6), found by splitting T.shp by S and S ∩ T.region by T.hp.
- The boundary is stored as convex plane-based polygons at internal nodes. **Overlapping boundary fragments are allowed.** A non-redundant boundary is rebuilt from the tree only for output.
- Tree reduction from Thibault and Naylor 1987 was "very important for saving both time and space".

### I/O (§3.4, DOCUMENTED)

- **point soup → plane soup:** fit a support plane to each polygon. For each edge, fabricate a bounding plane through the edge and orthogonal to s. Clip the big polygon by these planes. This step is **inexact** (float fitting).
- **plane soup → BSP:** Murali and Funkhouser 1997 BSP mesh repair, used because the soup may not be watertight. A standard Thibault–Naylor build works when the soup is known to be watertight.
- **BSP → plane soup:** tree traversal.
- **plane soup → point soup:** approximate the 3-plane intersections.
- **Connectivity recovery:** exact, via the orientation predicate. Points (a,b,c) and (x,y,z) are incident iff (a,b,c) lies on x, y and z.

## Robustness and guarantees

- **Exact internally.** "Our solution is exact in that it is unconditionally robust given consistent input", and it is fixed-precision because avoiding constructions bounds arithmetic depth a priori (§2.1). DOCUMENTED.
- **Degeneracies.** Coplanar and other degenerate configurations are handled explicitly by the BSP merge; "we do not rely on symbolic perturbations" (§2.2). DOCUMENTED.
- **Conversion is not exact.**
  - "We make no strong guarantees about the accuracy of our conversions (e.g. topology preservation)" (§1).
  - Roundoff during input "will break every non-trihedral vertex (with degree k > 3) into k − 2 nearly coincident, but distinct vertices, potentially introducing micropolygons and/or splinter-like polygons". The suggested fix is a mesh simplification pass (§3.4).
  - Plane-native input, such as sculpting with primitive polyhedra, is 100% accurate.
  - DOCUMENTED.
- **No rotations.** "Rotation arithmetic induces roundoffs, inadvertently altering the arrangement of geometry." Workaround: convert to plane soup, rotate, then rebuild via mesh repair (§5.2). DOCUMENTED.
- **Validity is always ensured, accuracy is not.** "The proposed I/O path always ensures validity. Therefore the program will not crash or fail." DOCUMENTED.

## Parallelism and performance

**Hardware and setup:** single-threaded, 1.83 GHz Intel Core Duo (32-bit) MacBook Pro. CGAL used `Exact_predicates_exact_constructions` Nef polyhedra. Maya 2009 trial (§4.1). DOCUMENTED.

**Octoball** (lumpy ball minus octopus; 11,444 + 33,872 faces at 1.0×):
- No system failed.
- BSP was about 1.5× slower than Maya and 3–6× faster than CGAL.
- Memory: 30 MB vs CGAL 50 MB at 0.1×; 250 MB vs 270 MB at 1.0×.
- Input conversion: 20 s and 6 min at 0.1× and 1.0×, vs CGAL's 6 min and 2 h.
- Input trees had 4× as many nodes as input faces, "due to microscopic and near degenerate polygons".
- DOCUMENTED (§4.2).

**Heatsink** (n × n slabs → n² rods, O(n²) output), seconds:

| n | BSP | CGAL | Maya |
|---|---|---|---|
| 15 | 0.2 | 9.3 | 0.7 |
| 40 | 1.3 | 87.4 | 34.1 |
| 50 | 2.0 | n/a | 93.9 |
| 100 | 8.1 | n/a | n/a |

Maya "produced incorrect results". BSP averaged 50× faster than CGAL. DOCUMENTED (results table).

**Random boxes** (iterated union/difference):
- Maya failed after about 90 operations.
- Rebuilding the tree from plane soup every 20 operations gave a 2–3× speedup and kept trees under 20k nodes instead of more than 100k.
- BSP was 22–28× faster than CGAL.
- DOCUMENTED.

**Sculpt bunny** (250 and about 850 dodecahedron subtractions):
- Maya failed after 25 operations on the larger set.
- BSP with rebuild was 2× slower than Maya and 16–17× faster than CGAL.
- The Fig. 1 bunny (about 9000 subtractions) took about 3 h at about 1 Hz, extrapolated to at least 3 days in CGAL.
- DOCUMENTED.

**Parallelism:** none discussed. INFERRED:
- The merge recursion is naturally fork-join, because the positive and negative subtrees are independent after a split. It is **unbalanced**, though: tree shape is data-dependent, and trees degrade under iterated operations. That is why Campen–Kobbelt and Nehring-Wirxel later bounded BSP size with an octree.
- The 27-case clip table is branch-free, table-driven work that suits GPU lanes.

## Known failures, limitations, war stories

- The authors list these limits (§5.2):
  - slow conversion ("a few seconds to a few minutes");
  - verbose, ill-conditioned output ("microscopic and near degenerate polygons");
  - linear geometry only;
  - no rotations.

  They recommend a separate "BSP tree mode". DOCUMENTED.
- BSP merging "scales poorly with the size of the input BSP". This was the motivation for Campen and Kobbelt's octree embedding (Nehring-Wirxel et al. 2021, §2, https://arxiv.org/abs/2103.02486). DOCUMENTED (secondary source).
- Nehring-Wirxel et al. found filtered floating point "too slow or having insufficient resolution" for this workload. They switched to fixed-width integers (128/192/256 bit) with precomputed homogeneous vertices, so classification becomes a 4D dot product instead of a 4×4 determinant (§3 of arXiv 2103.02486). DOCUMENTED.
- Third-party test of the original code: Zhou et al. 2016 (who thank Bernstein "for sharing code") report that "the no-longer-maintained implementation of [Bernstein & Fussell 2009] failed on most examples" in their Thingi10K self-union test (§7.2, https://www.cs.columbia.edu/cg/mesh-arrangements/). They also classify the method as needing a conversion pre-process whose accepted input range is "not precisely defined" (§2). DOCUMENTED (see `zhou-grinspun-zorin-jacobson-2016-mesh-arrangements-for-soli.md`). INFERRED: the failures most likely come from the inexact point→plane conversion and BSP mesh-repair front end, not from the exact core. Wonky must supply its own exact conversion.
- The author's later library Cork uses a different, perturbation-based float approach and has open robustness issues. Examples: "Degenerate case that fails" (https://github.com/gilbo/cork/issues/21), "Instability in intersection calculation" (https://github.com/gilbo/cork/issues/43), "Sequential execution of any operation leads to different results" (https://github.com/gilbo/cork/issues/47). The README says "there are a number of known problems with Cork" (https://github.com/gilbo/cork). DOCUMENTED. INFERRED: the exact BSP route was more robust than the author's own later, easier float route.

## Relevance for wonky

1. **The substrate fits Bend.** The system consists of 4 predicates, 1 constructor and 1 splitter, all fixed-depth. That is the smallest complete exact substrate for linear Booleans in the literature I have read.
2. **Filter first, integers second.** Bernstein's f32-in / f64-compute filter maps closely onto Bend's F32 scalars plus F32x2 (about 48-bit mantissa). INFERRED:
   - An F32x2 static filter decides most signs.
   - Because the F32x2 exponent range equals F32's, the degree-7 predicate (det3 × det4) needs an explicit input magnitude range. Bernstein relied on f64's wider exponent for this.
   - For guaranteed exactness, add a multi-limb U32 fallback on integer-quantized planes, the Nehring-Wirxel/EMBER route. Bernstein's single-stage-filter gap must not be copied.
3. **Emit planes, not points.** The table-driven convex clip is the key trick for prototype 2 (EMBER-style) and for any plane-based representation. The 27-code table is uniform work, ideal for GPU call trees. INFERRED.
4. **Explicit degeneracy handling.** The 7-case split classification is an alternative to SoS. It requires no perturbation bookkeeping, but only works because BSP semantics tolerate overlapping fragments. INFERRED: for wonky's hybrid (prototype 4), SoS on a tagged mesh gives cleaner output topology; a BSP gives cleaner exactness.
5. **Exact connectivity recovery.** Incidence via the orientation predicate on plane triples is precisely the exact output-assembly step Blender's EMBER port lacked (see blender-issue-114476 note). Reuse it.
6. **What wonky must not repeat.** Inexact point→plane conversion splits high-valence vertices into slivers. For wonky, planes should come from exact integer-quantized vertex triples (cross products on U32 limbs) so trihedral consistency is preserved. INFERRED. (Done this way in `kernel/proto/exact-plane`: support plane = cross product of exact grid edge vectors; edge planes contain the dominant axis direction of the support normal.)
7. **"No rotations" is the limitation wonky actually hit** (update 2026-09-24). BF09 §5.2 warns that "rotation arithmetic induces roundoffs, inadvertently altering the arrangement of geometry". The bake-off measured exactly this: after a rigid transform rounded to F32x2, analytically coplanar faces of two operands agree only to about 1e-14 mm (offsets at most 2^-50.2·scale). exact-plane's 2^-24 mm quantization then decided those cases arbitrarily (sealed rotated coplanar pockets into voids), and corefine produced self-intersecting slivers until two fixes: an exact self-intersection gate (plan step 1) and **carrier unification** of plane tags whose normals and offsets agree within 2^-44·scale, derived from the rounding bound of one rigid transform, with exactly axis-aligned carriers never unified (`kernel/hybrid/unify.bend`; `docs/proto-corefine.md` step 10; a verifier found the first tolerance 2^-40·scale too loose, it merged real 1e-11 mm skins). DOCUMENTED (wonky docs). INFERRED: the principled BF09-style fix is upstream of the Boolean: transform the *analytic carrier* once and derive every coplanar face's plane from that one rounded carrier, so coplanarity is shared by plane id and never has to be rediscovered numerically.

## Pointers worth porting or studying

- §3.1: the four plane predicates, and the Plücker form of the 4×4 determinant (shallower tree, tighter bound).
- §3.2, Table 1: the 27-code clip table plus the two pitfalls (emit H once; drop `b_i` when coplanar with h).
- §3.3, Fig. 6: 7-case subtree/plane classification for the BSP merge.
- §3.4: exact incidence test between plane-triple points, for output welding.
- §4: periodic tree rebuild (every 20 ops, 2–3× speedup). This is a practical rule for iterated CSG.
- Follow-up to read together with this paper: Nehring-Wirxel et al. 2021 (local `tmp/research/pdf/nehringwirxel2021-octree-bsp.pdf`), which gives bit budgets for integer versions of the same predicates.

## Verdict: learn-from

Study it and take its core design over into prototype 2: planes not points, no constructions, a four-predicate substrate, and the plane-emitting clip table. Do not adopt the whole system. The BSP merge is unbalanced and degrades under iteration, conversion is inexact and produces slivers, the single-stage f64 filter has no stated exact fallback, and there is no public code. The Bend-native version is the later integer formulation (Nehring-Wirxel 2021 / EMBER) with an F32x2 filter in front of it. Update 2026-09-24: wonky built that version (`kernel/proto/exact-plane`), and it is now the independent differential oracle, not the production Boolean. Two BF09 ideas are still open wins for it: evaluating orientation from plane triples without caching homogeneous vertices (same 325-bit worst case, less memory), and more symbolic zeros by plane identity. BF09's "no rotations" warning is the best one-line summary of the rotated-coplanar failures the bake-off found.
