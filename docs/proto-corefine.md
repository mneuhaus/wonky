# Bake-off prototype `corefine`: a tagged symbolic-perturbation mesh Boolean

Status: 23 September 2026. Code: `kernel/hybrid/corefine/` (Bend, about 7,300
lines, of which `gate.bend` 1,900) and the carrier-unification decision it
shares with recover, `kernel/hybrid/unify.bend` (about 480 lines). Since 24
September (plan step 5) this is the mesh stage of the production hybrid entry
`kernel/hybrid/main.bend`; the bake-off prototype `corefine` is the thin entry
`kernel/proto/corefine/main.bend` plus its native driver `native.bend` there. Tests:
`test/proto-corefine.test.mjs` (JS target, about 22 s).
Harness: `docs/bakeoff.md`. Run it with

```sh
npm run bakeoff -- --proto corefine                       # all cases, js,cpu1,cpuN,metal
npm run bakeoff -- --proto corefine --cases hex-nut --targets cpu1,cpuN --repeat 5
node --test test/proto-corefine.test.mjs
```

## Result in one paragraph

All 38 corpus cases are handled correctly. The 36 `solid`/`empty` cases pass,
all of them in the "exact" tier: the volume error against manifold3d on the
same fixture meshes is at most 3.6e-14 relative. Components and Euler
characteristic match manifold3d, and every triangle lies on its tagged
analytic surface within the fixture deviation. The two `non-manifold-contact`
cases are refused with an explicit reason. JS, native CPU (1 and 18 threads)
and the Metal build produce byte-identical results. The algorithm is Manifold's
Boolean3 (shadow predicates, inclusion numbers, halfedge assembly), ported to
Bend over F32x2 Reals. On top of it sit exact-position repairs for the
degeneracies the perturbation leaves, a robust face triangulator and a CSG
layer that flattens unions and subtract spines.

## Algorithm

One Boolean `P op Q` of two closed, consistently oriented triangle meshes
(`boolean.bend`):

1. **Operand preparation** (`prep.bend`, both operands in a parallel let).
   Halfedges are paired by sorting (the operand must be a closed, oriented
   2-manifold, otherwise it is refused). F32 face normals and area-weighted
   vertex normals are computed; they serve only as symbolic tie-break
   directions and never move a vertex. Each vertex, edge and face gets a
   record (`S.VRec`, `S.ERec`, `S.FRec`) and a conservative F32 box, padded by
   1e-6 relative plus 1e-6 mm.
2. **Broad phase** (`inter.bend`). A BVH over each operand's faces is built
   bottom-up over the faces sorted by the Morton code of their box centres.
   Candidate (edge, face) pairs come from a balanced fork tree over 64 chunks
   of edges.
3. **Decisions** (`shadow.bend`, `inter.decide`). For every candidate pair,
   `kernel12` decides whether the edge crosses the face, the sign of the
   crossing (x12 / x21) and the crossing point. It is built from `shadow01`
   (vertex vs edge), `kernel11` (edge vs edge) and `kernel02` (vertex vs
   face), exactly as in Manifold. Every comparison of two coordinates is exact
   on Reals, and an exact tie is broken by the sign of a perturbation
   direction (vertex normal, the edge's summed face normals, face normal).
   Union expands P along its normals, subtract and intersect contract it, and
   Q is always expanded (Manifold's `expandP`). The pairs are decided in a
   balanced fork tree over 4096 chunks. That tree is the prototype's `!`
   device call.
4. **Winding numbers** (Manifold `Winding03`). Vertices joined by an edge that
   crosses no face of the other operand share a winding number (union-find
   over the unbroken edges). One vertical ray per component root (a `kernel02`
   sum over the faces above it) gives the number.
5. **Assembly** (`assemble.bend`, Manifold `Boolean3::Result`):
   - Inclusion numbers follow from the windings and crossings (Manifold's
     `c1`, `c2`, `c3`).
   - Partial edges are paired along each broken edge by sorting (`PairUp`).
   - New edges come from each (P face, Q face) group, sorted along the group's
     longest box axis.
   - Whole edges are copied.
   - Every output halfedge is emitted together with its twin, so the polygon
     mesh is closed and manifold by construction.
   - Output faces are traced into vertex loops (`AssembleHalfedges`).
   - Inclusion numbers outside [-1, 1] are refused.
6. **Exact-position repair** (`weld.bend`, `zip.bend`). Degenerate inputs
   (coplanar faces, edge-on-edge, shared vertices) make the perturbation emit
   distinct vertices at the same exact position, zero-length edges,
   zero-width faces and T-junctions. The repairs are:
   - exact weld (rename to the smallest index at the identical Real
     position);
   - collapse of edges shorter than `2^-36 · max|coordinate|` into the
     lower-numbered vertex (input vertices never move);
   - cancellation of opposite halfedges inside one face;
   - zipping of faces whose vertices all lie on one line;
   - splitting of face edges that run through a vertex of their own face,
     then cutting pinched loops.

   No vertex is ever moved. After the repairs, every directed edge must again
   be paired exactly once, otherwise the result is refused. These are
   Manifold's `CollapseEdge` / `RemoveDegenerates` responsibilities, done
   here by exact position instead of an epsilon collapse. The detection is
   per face, over a fork tree of face chunks. Large faces use a sorted sweep
   instead of the all-pairs test; its prefilter (`near_seg`) takes the
   differences `p - b` and `a - b` in Reals before rounding, so a segment
   shorter than one F32 ulp far from the origin still gets its T-junction.

   **Repair rounds** (`boolean.bend` `rep.*`, 24 September 2026,
   docs/hybrid-robust.md X3). Splitting and zipping insert every vertex
   within eps of an edge's line strictly inside the edge, also one within eps
   of an edge's *end* (a second rounding of that end, e.g. an exact crossing
   and a step-1 corner 8e-14 mm apart), after the short-edge collapse ran;
   the edge left behind is shorter than eps (kt6 turned by 1e-4, 45, 60, 89.9
   degrees or 37 degrees about (1, 2, 3): "welded / repaired output is not
   2-manifold", an ear-clipper refusal, or a needle recover refuses). So a
   repair round is split + zip + short-edge collapse (`weld.bend collapse`:
   the collapse alone, over both halfedge directions because an insertion on
   only one of an edge's halfedges leaves them unpaired until the collapse).
   If the collapse renamed a vertex, the pairing is checked (an unpaired
   edge is refused by name: "an unpaired edge survives the short-edge
   collapse ..."), the loops are rebuilt and the round repeats while
   T-junctions, zero-width faces or short edges remain, at most 3 rounds;
   after the last one a census refuses an edge shorter than eps by name ("an
   edge shorter than the short-edge tolerance (2^-36 * scale) survives
   repair (after N repair round(s))"). Same eps,
   renames to the lower index (input vertices never move). A round whose
   collapse finds nothing is the single repair of earlier versions, with its
   result and messages byte for byte.

   **Coplanar membranes** (`membrane.bend`, 25 September 2026,
   docs/hybrid-robust.md F1; Manifold `RemoveIfFolded`). Before the loops
   are formed, a P face and a Q face of one plane class (`unify.bend`
   `Unified.planes`) with opposite orientation that share an opposite
   halfedge pair are a zero-thickness sheet left by the per-element tie
   directions (probe 307:5). Each such group, with its coplanar neighbours
   of equal orientation, becomes one face whose opposite pairs cancel. The
   rest is decided on its exact winding (Regression review 2, F1b): every remaining
   halfedge gets w on its left (ray from its doubled midpoint, big-integer
   orient2d; a halfedge running against another over more than eps, a
   spike the repair zips later, does not vote). All +1: the root's face; all
   0: the opposite member's face; empty: cancelled; otherwise the group is
   not cancelled and its members stay as produced. Without such a pair the
   halfedges are unchanged. A normal whose axis component is not exactly
   +-1 is no exact carrier (unify.bend axis_exact, F2), so a rounded flush
   face joins the exact plane it lies on.
7. **Face triangulation** (`earclip.bend`, Manifold `Face2Tri`):
   - Each output face lies in one input triangle, so it is planar. It is
     projected on the axis-aligned plane closest to its normal
     (`GetAxisAlignedProjection`); coordinates are copied, never rounded.
   - Collinear boundary runs (split points on straight sides, flat within
     1e-7 rad or within delta of their chord, below) are removed first and
     put back afterwards by fanning the triangle that owns their edge.
   - Lengths, dot products and the sliver flips' longest edge use the F32 of
     the Real coordinate *difference* (subtract, then round). Rounding the
     absolute coordinates first made them quantisation noise far from the
     origin (ulp 6.1e-5 mm at 800 mm; kt1-far, kt2-rotfar), so the
     triangulator was not translation invariant (docs/hybrid-robust.md R2).
   - **Flatness** (X4): a corner is flat when it turns by less than ~1e-7 rad
     or lies within delta of the line through its neighbours,
     `|(u - v) x (w - v)| <= |u - w| * delta` (the longest edge for the flip
     test), with the derived construction error delta = 2^-42 * S, S the
     job scale of the short-edge tolerance (largest |coordinate| of the
     Boolean's output vertices, at least 1): input vertices are F32x2
     (<= 2^-49 S), a point interpolated on an edge lies within ~2^-44 S of its
     analytic line (about 7 R operations of <= 2^-46.8 each), two
     interpolations 2^-43 S, and a corner is off the line through its two
     (displaced) neighbours by at most twice that. Flatness only chooses
     diagonals; every emitted triangle is still checked counter-clockwise
     exactly.
   - Holes are bridged rightmost-first (Eberly's construction, as in earcut)
     to the nearest vertex that is exactly visible and inside both sectors.
   - The polygon is ear-clipped with a vertex grid, backing up one corner
     after every clip.
   - Remaining slivers are removed by Lawson flips.
   - `orient2d` is evaluated in Reals with an a-priori bound, falling back to
     exact big-integer evaluation of the Real inputs (`robust-predicates.bend`).
   - Every output triangle is checked counter-clockwise exactly, and a face
     that cannot be triangulated is refused.

   Each triangle inherits the tag of the input triangle its face was cut
   from.
8. **Final guarantee**. All output triangles are checked once more: every
   directed edge must occur exactly once together with its reverse. Unused
   vertices are then dropped (compaction).
9. **Output gate** (`gate.bend`, added 23 September 2026, plan step 1).
   Every Boolean's result (the intermediate ones of a CSG tree too) must
   pass two more checks, or the Boolean is refused:
   - **vertex links**: the triangles around every vertex form one fan (the
     link edges of its corners are one cycle), else
     "non-manifold contact (point)". This catches point contacts (two
     solids touching in one vertex, a cone apex on a face, spheres touching
     pole to pole), which pass the edge pairing;
   - **exact self-intersection**: no two triangles with different tags meet
     outside their shared vertices or edge (the harness validator's closed
     test, touching counts), else "result self-intersects (below
     2^-36*scale)"; a degenerate triangle is "result has a degenerate
     triangle". This caught the rotated coplanar pockets and touching
     unions the judge found; step 10 now decides those as exactly coplanar.

   Candidate pairs come from a BVH self-join over Morton-sorted triangles
   (the structure of recover's `clear.bend`), run as one flat fork tree of
   join tasks. Like `clear.bend`, pairs within one tag (one input face,
   recover's patch) are not tested and one-tag subtrees are skipped whole.
   Each pair is decided exactly in three tiers: F32 tests on local
   differences of the Real words with certified error bounds (plane sides,
   projected orientations, 9 edge x edge axes, 10 planes through a shared
   vertex); structure (a triangle on one closed side of the other's plane
   meets it only in the hull of its corners on that plane; axis-aligned
   triangles know their plane exactly, zeros included); then the validator's
   test with a Real filter and big integers. The gate never changes a
   triangle: an accepted result is byte-identical to the ungated one (all 38
   corpus results are).

   Measured (23 September 2026, M5 Pro, loaded machine): on the four
   adversarial suites the 10 point contacts and the 4 rotated coplanar
   results that were `ok` with an invalid mesh are now refused, all four
   targets byte-identical; every other result is unchanged. The cpu18
   compute sum over the corpus grows by 10.6-10.8 % (interleaved medians of
   5), mostly `plate-hole-grid-10x10` (+243 ms: slivers of the plate top
   against 100 hole walls) and `fine-spheres-50k` (+126 ms: building the
   triangle records).

10. **Carrier unification** (`kernel/hybrid/unify.bend`, `unify.bend`,
    added 23 September 2026, plan step 4). A rigid transform rounded to
    F32x2 moves analytically coplanar faces of two leaves apart by about
    1e-14 mm: a rotated block with a flush pocket, a rotated box standing on
    another. The shadow predicates then decided the overlap of those faces
    from the rounding, and the results had membranes, slivers,
    self-intersections or point contacts (refused by the gate since step 1).
    - **Decision** (once per job, exact, on the face table only). Two plane
      tags are in one class when, with both normals oriented alike, every
      normal component differs by at most 2^-44 and the offsets n.o differ
      by at most 2^-44·scale; scale is the smallest power of two at or above
      the largest |coordinate| of the leaf meshes. (2^-40 until the fix of
      24 September 2026, below.) Both tests use the big
      integers of `kernel/robust-predicates.bend` after an F32 prefilter.
      Tags are swept in offset order and each joins the first class whose
      representative passes, so every member is within the tolerance of its
      representative. A class is *unified* when a pair that is not two
      exact carriers joins tags of different leaves (identical tilted
      carriers included since 24 September 2026, below); unified classes get
      one bit each, at most 32. The file is shared with recover, which
      states the decision in its output.
    - **Identical tilted carriers are unified** (24 September 2026,
      `docs/hybrid-robust.md` X1). Until then bitwise identical carriers
      joined silently (`MtSame`, no bit), on the assumption that identical
      carriers mean exactly coplanar vertices. That holds for axis-aligned
      carriers only, whose offsets are input coordinates. On a tilted plane
      every F32x2 leaf vertex is a rounded point: in the probe's ReliefUnion
      (612:9, `r20Probe`, 15 degree tilt) and in `adv:kt1-rot` the Core cap
      and the relief cone base share one carrier, and the cap vertices lie
      up to 6.5e-14 mm above and below it (59 above / 25 below; canonical
      KT1: 84/84 exactly on it). The shadow predicates decided that
      rounding, and the cone-base faces came out as loops pinched at one
      vertex ("face triangulation failed (no valid ear or hole bridge)").
      Now an identical pair is `MtNear` unless both carriers are
      `axis_exact` (then `MtSame`, as before: their vertices are exact).
      Coplanarity is a property of the carriers' provenance, not of the
      rounded vertices.
    - **A tie is constructed from one value** (`shadow.bend tie_canon`,
      24 September 2026, X2). A comparison decided as a tie under
      unification (the elements touch a common unified class and
      |p - q| <= 2^-36·scale) used to construct its point from its own
      operand, so the x12 and x21 constructions of one symbolic crossing
      came out about 1e-14 mm apart (probe: v483 / v484, z differs by
      1.4e-14 mm), not joined by an edge, and zip's T-junction split then
      made a 1.4e-14 mm edge along the face normal. Now the construction
      takes the compared value: `shadow01` y := ay, `kernel11` zb := za,
      `kernel02` z := az. No decision changes; the two constructions are
      bitwise identical and the exact weld joins them. X1 alone regresses
      frames that production builds (`synth-boxcyl-n8-frame3`), so X1 and
      X2 ship together. A canonicalised coordinate moves by |p - q|; the
      diagnostic entry `fixtures/r20/relief-union/tools/tiegap.bend`
      records the largest one of a job's root Boolean: probe 2^-52.98·S
      (1197 ties), kt1-rot 2^-46.69·S (1248), boxcyl frames 2^-46.41 to
      2^-47.94·S, probe 307:5 2^-50.76·S (S = max(1, largest leaf
      |coordinate|)); `tools/check.mjs --tiegap` asserts <= 2^-42·S on these
      repros. Over the 388 jobs of the comparison 47 have ties and 4 exceed
      the 2^-42·S target: kt6-rz1e-4 union step 2 2^-38.29·S, kt6-rz89.9
      steps 0 and 2 2^-40.60 and 2^-41.20·S, `adv-ep2-sweep-pocket-4`
      2^-41.67·S (`tmp/hybrid-robust/impl-d/tiegap388/`). All four build the
      right answer (exact), and every gap is below the tie tolerance
      2^-36·S, so no decision changes; the target is missed there, not
      widened.
    - **Past 32 classes.** A unified class beyond the 32-bit mask keeps the
      decisions without unification. `Unified.classes` counts all unified
      classes and `Unified.over` the ones without a bit; the refusal suffix
      names them ("(34 classes; 2 past the 32-bit class limit, decided
      without unification)").
    - **Exact carriers are never unified** (fix of 23 September 2026, hybrid
      gate verifier). A pair whose two normals are both exactly axis-aligned
      (two components exactly 0) stays apart, identical or not. No rotation
      rounded such carriers; their offsets are the leaf coordinates as
      given, so two of them that differ are two planes of the input. Before
      the fix, a sealed void 2e-11 mm under the top face of an axis-aligned
      block (below the then 2^-40·scale = 2.9e-11 mm at scale 32), and the same void
      at 1000 mm under a 5e-10 mm skin, came back `ok` as an opened pocket
      (1 component, area 1840 instead of 2040), with no stated tolerance in
      the mesh. Regression cases `adv-skin-void-2e-11` and
      `adv-skin-void-5e-10-at-1000` (adv-corefine suite) and a test in
      `test/proto-corefine.test.mjs`.
    - **The tolerance is the rounding of one rigid transform** (fix of 24
      September 2026, hybrid gate verifier #2). 2^-40·scale was about 1000
      times the rounding it absorbs, so real skins of tilted or rotated input
      were merged: a triangular prism minus a sealed pocket whose tilted face
      (normal (1,1,0)/sqrt2, not axis-aligned) lies 1e-11 mm under the
      tilted outer face, and a rotated block minus an equally rotated sealed
      pocket 1e-11 mm under its top, came back `ok` with 1 component (the
      void opened; area 1269.02 and 1840 instead of 1472.67 and 2040). The
      wire carries F32x2 values (<= 2^-49 relative per coordinate); a
      rotated point computed in doubles and rounded to F32x2 is off by less
      than 2^-48·scale, so analytically coplanar carriers of equally
      transformed leaves differ in n.o by at most about 6·2^-49·scale
      (2^-46.4·scale), and in their normals by about 2^-48. Measured on
      every rotated coplanar job of the corpus, the four suites and the
      verifiers' extra cases: normals identical, offsets at most
      2^-50.2·scale (2.4e-14 mm at scale 32). Real separations in the same
      census are at least 2^-41.7·scale. 2^-44·scale (1.8e-12 mm at scale
      32) keeps a factor of at least 5 over the rounding bound and a factor
      of 5 below the thinnest real skin found. Both 1e-11 mm cases now give 2
      components with the exact area, byte-identical to the HEAD kernel;
      regression cases `adv-skin-void-prism-tilted-1e-11` and
      `adv-skin-void-rot-1e-11` (adv-corefine suite) and tests in
      `test/proto-corefine.test.mjs`, including the boundary (a rotated
      pocket top moved by 1e-12 mm is unified, by 4e-12 mm it is not). r10b's
      frozen faces (normals (0, 1, 0) and (0, -1, 2.5e-13), 3.7e-11 mm apart
      at scale 128, 2^-41.7·scale) are no longer unified; its corefine bytes
      never depended on it.
    - **Use.** Each vertex record carries the bits of its triangles' tags
      (`VRec.k`, `FRec.k`). A comparison between two elements that touch a
      common unified class, and whose values differ by at most 2^-36·scale
      (the scale of the short-edge collapse), counts as an exact tie, and the
      symbolic perturbation decides it as for exactly coplanar input: the z
      comparisons of `kernel02` and `kernel11` (the faces become coplanar)
      and the y comparison of `shadow01` (vertices on edges inside the
      plane, such as a pocket corner on the block top's diagonal). No vertex
      moves.
    - **Crossing points are clamped to their bracket** (`shadow.intersect`,
      `isect.clamp`; R20 gate Regression review 2, 24 September 2026). A tie decided
      symbolically (or within the unification tolerance) leaves the two y
      gaps of the bracketing points with the same sign, or both rounding
      noise; `lambda = dy / (dyL - dyR)` then lands far outside [0, 1].
      KT6 turned 30 degrees about Z (verify#2 `kt6-rz30`): D's side edges
      lie in A's rotated side plane, and their crossing points came out up
      to 7 mm off the edges' own ends, so the output face loops crossed
      themselves and the ear clipper refused ("no valid ear or hole
      bridge"). The crossing lies between the bracketing points by
      construction, so lambda is clamped to [0, 1] from the left point and
      [-1, 0] from the right one; a lambda inside is unchanged. Bake-off
      (cpu1, against the pre-clamp hybrid run): corpus, adv-sdf and
      adv-recover byte-identical; 1 of 34 adv-corefine and 14 of 44
      adv-exact-plane results (rotated coplanar and sweep cases) change in
      the lo word of F32x2 coordinates only (at most 13 ulp of lo, about
      1e-15 relative); every verdict is unchanged.
    - **Refusals.** A refusal of a job with unified classes ends with
      "; coplanar plane carriers unified within 2^-44*scale (N classes)".
    - **Without a unified class** every mask is 0 and every predicate and
      construction is unchanged. Between the 2^-44 fix and X1 no corpus job
      had a unified class (before, `r10b-g10-union` had one, with no effect
      on its result bytes). With X1, `tilted-holes-17deg` has 4 (identical
      tilted carriers); its recovered B-rep gains the `unified 4` record and
      is otherwise byte-identical. On the 388 jobs of the hybrid-robust
      comparison (corpus, the four judge2 suites, R20 dumps, rotated KT6
      frames) no answer has more than 6 unified classes.

    Measured (24 September 2026, X1 + X2 on top of X3 + X4; JS target,
    `tmp/hybrid-robust/cmp5`, HEAD kernel vs the fixed one): 388 jobs, 317
    byte-identical, 18 refusals become results (8 exact, 10 certified
    mesh), 0 results become refusals; every changed exact answer keeps its
    B-rep header, lo words move by at most 2.6e-11 (3 answers only gain the
    `unified` record); every changed mesh answer keeps its volume and area.

    Measured (23 September 2026, M5 Pro, machine loaded by other agents;
    runs under `out/bakeoff/step4-unify/judge/`): all 14 rotated coplanar
    cases of the exact-plane suite (the 6 flush pockets, the 6 touching
    unions of the sweep, the rotated pocket and the rotated intersection)
    are valid `ok` meshes with one component and the exact volume and area
    (before: 7 refusals, and 7 `ok` meshes of which 4 carried 5 to 25 mm^2
    of extra area, thin slivers between the coplanar faces that the
    harness scorer does not flag: 2 of them scored `pass`). On the four
    suites 17 result files change, all on jobs with a unified class; every
    other result is byte-identical to step 1. Scored by `judge.mjs` with the
    step-3 arbiter: 196 good (177 pass + 19 expected refusals), 13 refusals,
    3 wrong (the grazing cases of plan step 2), 4 `ambiguous` (rotated
    coplanar cases whose oracles the input rounding splits; corefine gives
    the unified answer), 0 errors; step 1 under the same scorer: 190 / 21 /
    3 / 2 ambiguous. All four targets agree on 216/216 and on the corpus,
    whose 152 result files are byte-identical to step 1. Corpus compute,
    interleaved against the step-1 binary: cpu18 +0.8 % and +5.2 % (two
    runs), cpu1 -2.0 %; CPU time -1.9 %, +0.1 %, -0.7 %: within noise.

The CSG layer (`main.bend`) works as follows:

- **Leaf meshes.** Each leaf mesh is moved into its tree leaf once, and its
  box and triangle count are measured then.
- **Union chains** are flattened into operand lists.
- **Subtract spines.** A left spine of subtractions becomes one subtraction
  of a union: (A − B) − C = A − (B ∪ C), exact for regularized solids.
- **Union rounds.** The operands of a union are combined in rounds. A greedy
  set of operands whose padded boxes are pairwise strictly apart is
  concatenated, since they share no point. That set is then joined to the
  running result by one Boolean.
- **Shortcuts.** Empty operands and operands with strictly separated boxes
  are answered without a Boolean.

This is the idea of Manifold's CSG-tree flattening and box-disjoint batch
compose. The effect on the corpus:

- `pin-array-chain-20`: 20 Booleans become 1 (cpu1: 1.3 s before, 0.11 s after on a quiet machine, 0.17 s in the loaded final run).
- `plate-hole-grid-10x10`: the 99 unions of disjoint cylinders become one
  concatenation. Together with the triangulator changes (collinear runs,
  back-stepping clip, sorted T-junction sweep), cpu1 went from 3.9 s to 1.6 s
  on a quiet machine.

## Upstream sources and licenses

Manifold (github.com/elalish/manifold, Apache-2.0, Emmett Lalish and the
Manifold authors) is re-implemented, not linked or translated line by line.
The attribution is in `shadow.bend` and in the module headers.

| Manifold | corefine |
|---|---|
| `src/shared.h` `Shadows`, `Interpolate`, `Intersect` | `util.shadows`, `shadow.interpolate`, `shadow.intersect` |
| `src/boolean3.cpp` `Shadow01`, `Kernel11`, `Kernel02`, `Kernel12` | `shadow.shadow01`, `kernel11`, `kernel02`, `kernel12` |
| `boolean3.cpp` `Intersect12` (expanded / non-expanded) | `inter.side_pre` + `inter.decide` (`eP`) |
| `boolean3.cpp` `Winding03` (flood fill + ray) | `inter.side.*` (union-find + `kernel02` rays) |
| `src/boolean_result.cpp` `AddNewEdgeVerts`, `PairUp`, `AppendPartialEdges`, `AppendNewEdges`, `AppendWholeEdges`, `Boolean3::Result` | `assemble.xhs`, `pairup`, `partial_edges`, `new_edges`, `whole`, `boolean.assemble` |
| `src/face_op.cpp` `AssembleHalfedges`, `Face2Tri`, projection | `assemble.loops`, `boolean.faces_par`, `earclip.proj_of` |
| `src/edge_op.cpp` `CollapseEdge`, `RemoveDegenerates`, `SplitPinchedVerts` | exact-position counterparts in `weld.bend`, `zip.bend` (`split_loops`) |
| `src/collider.h` (Karras radix tree over Morton codes) | `inter.bvh` (bottom-up pairing of Morton-sorted boxes, simpler) |
| CSG tree flattening / batch compose (`csg_tree.cpp`) | `main.union_ops`, `sub_spine`, `union_rounds` |

earcut (mapbox, ISC) inspired the hole-bridging order (Eberly's rightmost
vertex) and the ear test. The code is original Bend with exact predicates.
Manifold's own polygon triangulator was not ported. Everything is original
Bend code. No upstream source file was copied into the repository.

## Numeric model and guarantees

- **Positions** are `R.Real` F32x2 pairs (about 48 significand bits, F32
  exponent range). Input vertices are the exact wire values. Comparing two
  Reals is exact, because Reals are canonical and (hi, lo) compares
  lexicographically.
- **Constructed intersection points** use Manifold's formulas (the
  better-conditioned endpoint) in Real arithmetic. Their relative error is
  about 2^-44 of the operand magnitude. They are snapped to double
  representability (`util.snap`, a change below 2^-52 relative), so equal
  Reals are equal doubles on the wire.
- **Topology.** Every decision about an (edge, face) pair or an (edge, edge)
  pair is a pure function of that pair's records. The records are built
  identically from both sides (F32 addition is commutative), so a decision
  evaluated from several places always gets the same answer. All topology
  (crossings, inclusion, pairing, face loops) is derived from these decisions
  and never from computed positions. This is Manifold's key property: the
  polygon mesh is closed and 2-manifold by construction, even though
  positions are rounded.
- **What is guaranteed** (checked in the kernel; a failure is an explicit
  refusal):
  - the result is closed and consistently oriented (every directed edge
    paired once);
  - every vertex has a single fan (no point contact);
  - no two triangles with different tags intersect (exact, touching
    counts), and no triangle is degenerate;
  - operands are closed oriented 2-manifolds;
  - inclusion numbers are in [-1, 1];
  - every triangulated face is exactly counter-clockwise in its projection.
- **What is not guaranteed.** Nothing is guaranteed about decisions on
  constructed values closer than about 1e-13 relative. The decision is then
  consistent but may differ from exact arithmetic. A self-intersection
  between two tags that results is refused by the output gate; one between
  two triangles of the same tag (cut from one input face) is not tested, as
  in recover's clearance join. The harness validator tests everything, and
  all 36 corpus results pass it with exact predicates.
- **Tolerances.** No vertex is ever moved. Each tolerance only decides a
  topological repair and scales with the part size:
  - the short-edge collapse, at `2^-36 · max|coordinate|` (1.5e-9 mm for a
    100 mm part), again after every repair round (at most 3; step 6);
  - zero-width faces and T-junctions, within the same eps;
  - the flatness of the triangulator's collinear runs and deferred slivers:
    1e-7 rad, or a corner within delta = `2^-42 · max|coordinate|` (= eps / 64,
    the derived construction error, step 7) of its chord. A job that would
    need more is a finding about the error model, not a reason to raise
    delta: `kernel/hybrid/corefine/stats.bend` reports the largest distance
    only the delta term accepted, and `stats_k(job, k)` reruns the
    triangulation with 2^-k to measure what a refused job would need
    (measured 24 September 2026 on 1680 axis-permuted hybrid jobs and 108
    far fan plates: at most 2^-47.85 S, and no refusal that a larger delta
    up to eps would build; 984 of the 1680 jobs ran one repair round, 184 of
    them re-collapsed, none needed a second);
  - carrier unification (algorithm step 10): plane carriers of different
    leaves within 2^-44·scale (normals within 2^-44) are one class (except pairs of exactly
    axis-aligned carriers, which are exact input and stay apart), and
    comparisons within 2^-36·scale between elements touching such a class
    are ties. A job's refusal names it; an `ok` mesh does not (recover's
    B-rep states it in its `unified` record, and its refusals name it).
- **Accuracy against the analytic CSG.** The result is the exact Boolean of
  the tessellated leaves, up to the Real rounding of the constructed points.
  Each output triangle lies in the plane of the input triangle it came from,
  so its corners are within the fixture `deviation` of the tagged analytic
  surface. The validator checks this for every corner. The volume error
  against OCCT stays inside the harness bound `area × deviation` in every
  case.
- **Tags.** Every output triangle carries the tag of its source input
  triangle, so per-tag areas equal manifold3d's face-ID areas (tested, and
  reported per case by the runner). Where coplanar faces of two leaves merge,
  either tag is correct.

## Parallel structure

| stage | structure |
|---|---|
| operand preparation | parallel let (P and Q); halfedge sort = parallel merge sort |
| broad phase | Morton sort (parallel), BVH bottom-up; balanced fork tree over 64 edge chunks per side |
| decisions | balanced fork tree over 4096 pair chunks per side (`eval_par!`), both sides in a parallel let |
| winding | union-find (sequential), rays for component roots over a fork tree |
| assembly, weld | sequential walks + parallel sorts |
| defect detection | fork tree over 64 face chunks |
| triangulation | fork tree over 64 face chunks |
| final pairing check | parallel sort |
| gate: vertex links | corners dealt into per-vertex buckets (one Array pass), fork tree over the buckets |
| gate: triangles | corners attached in one owned Array pass, triangle records over a fork tree of 64 chunks, Morton bucket sort |
| gate: join | flat list of >= 1024 self / cross tasks, fork tree of 256 chunks |

`util.sort` is a parallel stable merge sort: lists of 4096 elements or more
are split into halves that are sorted in a parallel let (up to 2^6 leaves) and
merged. A stable sort's output is unique, so every target produces identical
bytes.

Two findings about Bend 2.0.25's CPU pool determine the structure:

1. **Sharing kills scaling.** A value used after an owned use becomes shared,
   and every later read of it in a parallel phase pays an atomic count. The
   CSG layer therefore never duplicates a mesh: it measures each mesh once and
   routes operands by matches.
2. **Forking before a Boolean kills scaling.** Once a frame has made a
   non-tail self call whose callee forked, every parallel let later in that
   frame runs sequentially. `tmp/corefine/prof/micro.bend`, mode `nontail`,
   reproduces it: 188 ms at 1 thread and 190 ms at 18, against 190 / 35 ms
   without the call. The CSG evaluator therefore evaluates operand subtrees
   one after the other and keeps the parallelism inside each Boolean.

   After flattening, the corpus trees are dependency chains, so nothing is
   lost on the corpus. A level-synchronous scheduler (all ready Booleans of
   one level in one fork tree, a tail-recursive driver between levels) would
   restore subtree parallelism.

**Metal.** A `!` that follows host forks in the same evaluation falls back
to the CPU pool. The native driver therefore runs the root Boolean in stages
with IO steps between them (`main.stage`/`begin`, `decide`, `finish`):
preparation and broad phase, then `IO.now`, then the two decision trees
(`eval_par!`), then `IO.now`, then the rest. With `--gpu 1GB` the decisions
run on the device, and the runtime counts 2 passes per case. With
`--gpu off` the same call runs on the CPU pool. `solve` (the JS target) runs
the same stages without IO, and all targets produce identical bytes. Booleans
below the root run inside the tree evaluation, so their `!` runs on the CPU
pool.

The decision stage alone, measured with an IO step before it
(`tmp/corefine/prof/prof.bend`, built by `tmp/corefine/metal-build.mjs`):

| | fine-spheres-50k (10,237 pairs) | grid subtract (33,600 pairs) |
|---|---|---|
| Metal (2 passes) | 62–67 ms | 73–87 ms |
| CPU pool, 18 threads | 4–5 ms | 7 ms |
| CPU, 1 thread | 13–16 ms | 39–42 ms |

The device is slower here for three reasons:

- About 35 ms of each Metal pass is fixed cost.
- The decision kernel is divergent: short-circuiting predicates, small
  per-pair lists and wide nested Real records (about 60 words per pair).
- It is only 1–3 % of a Boolean. The rest is sort- and list-heavy host work,
  where a P-core beats a lane by about 75x (SHADERS.md).

The Metal target therefore shows real device execution at a cost of about
70–100 ms per case. A device kernel that pays would need flat scalar records
(SoA pairs of F32 words, no lists), batched decisions of all Booleans of a
level in one pass, and a GPU sort for the broad phase.

## Supported and refused

Supported:

- any closed, consistently oriented triangle-mesh operands, including several
  components, internal voids and frozen B-rep leaves;
- union, subtract and intersect trees of any shape and depth;
- coplanar, touching and coincident faces (identical operands `A ∪ A`,
  `A − A`, `A ∩ A`) and shared vertices;
- empty results (`ok` / `mesh 0 0`) and disjoint components.

Refused with a reason (`unresolved <reason>`):

- results that touch themselves along a curve (`cylinder-tangent-box-face`,
  `hole-tangent-edge`: "triangulated result is not 2-manifold" or "face
  triangulation failed");
- results that touch themselves in a point ("non-manifold contact
  (point)") or whose rounded constructions make two tags intersect ("result
  self-intersects (below 2^-36*scale)");
- open or non-manifold operands;
- inclusion numbers outside [-1, 1] (self-overlapping operands);
- predicate inconsistency (no bracketing pair);
- repairs that do not re-pair;
- untriangulable faces;
- jobs without meshes (`.csg.job`) and malformed jobs.

## Measured results (Apple M5 Pro, 18 cores)

Run: 2026-09-22T22:08:04.760Z, targets js, cpu1, cpuN, metal, repeat 3 (native: median per phase over 3 processes; JS: median of 3 warm runs). Verdicts: 36 pass, 2 expected-refusal. All targets byte-identical: yes.
Machine load during the run (uptime before / after): 111.90 94.38 72.86 / 61.26 83.33 76.65; the machine was shared with other jobs, so absolute times are inflated and noisy.

Compute times in ms (parse / serialize are separate: see report.json). Metal = `--gpu 1GB`, the root Boolean's decisions run on the device (passes counted by the runtime).

| case | verdict | tris out | vol rel err vs manifold3d | |V - V_OCCT| / bound | JS | cpu1 | cpu18 | cpu1/cpu18 | Metal (passes) |
|---|---|---|---|---|---|---|---|---|---|
| leaf-cylinder | pass | 224 | 3.2e-15 | 2.8e+0 / 6.8e+0 | 0.3 | 0 | 0 | - | 0 (0) |
| box-union-overlap | pass | 48 | 0.0e+0 | 0.0e+0 / 3.2e+1 | 27.6 | 12 | 3 | 4.0x | 87 (2) |
| box-subtract-overlap | pass | 40 | 2.8e-16 | 2.7e-12 / 2.7e+1 | 39.0 | 10 | 5 | 2.0x | 59 (2) |
| box-intersect-overlap | pass | 24 | 0.0e+0 | 0.0e+0 / 8.0e+0 | 18.5 | 4 | 5 | 0.8x | 69 (2) |
| box-rotated-intersect | pass | 80 | 3.0e-16 | 9.1e-13 / 1.8e+1 | 69.9 | 5 | 5 | 1.0x | 78 (2) |
| box-coplanar-union | pass | 36 | 2.0e-16 | 0.0e+0 / 2.8e+1 | 32.7 | 2 | 23 | 0.1x | 60 (2) |
| box-coplanar-subtract | pass | 24 | 1.5e-16 | 2.7e-12 / 2.2e+1 | 41.0 | 1 | 2 | 0.5x | 102 (2) |
| box-touching-merge | pass | 20 | 2.3e-16 | 2.3e-13 / 1.0e+1 | 30.0 | 2 | 4 | 0.5x | 59 (2) |
| box-touching-partial | pass | 32 | 2.0e-16 | 2.3e-13 / 7.2e+0 | 32.1 | 2 | 2 | 1.0x | 74 (2) |
| plate-through-hole | pass | 344 | 6.2e-16 | 6.6e-1 / 3.1e+1 | 253.6 | 37 | 11 | 3.4x | 141 (2) |
| plate-blind-hole | pass | 234 | 4.8e-15 | 3.0e-1 / 2.6e+1 | 121.6 | 11 | 9 | 1.2x | 75 (2) |
| plate-blind-pocket | pass | 40 | 1.8e-16 | 9.1e-13 / 3.3e+1 | 18.5 | 2 | 2 | 1.0x | 58 (2) |
| plate-counterbore | pass | 704 | 0.0e+0 | 6.6e-1 / 2.9e+1 | 734.2 | 51 | 49 | 1.0x | 315 (2) |
| plate-countersink | pass | 1316 | 1.6e-15 | 5.4e-1 / 2.6e+1 | 1260.6 | 114 | 65 | 1.8x | 121 (2) |
| plate-4-holes | pass | 1068 | 2.3e-16 | 9.3e-1 / 4.8e+1 | 836.7 | 69 | 35 | 2.0x | 90 (2) |
| plate-hole-grid-10x10 | pass | 22892 | 4.3e-15 | 1.8e+1 / 8.1e+1 | 12906.5 | 2253 | 1595 | 1.4x | 2201 (2) |
| tilted-holes-17deg | pass | 1068 | 9.8e-16 | 2.0e+0 / 4.4e+1 | 767.1 | 50 | 32 | 1.6x | 108 (2) |
| pipe-tee | pass | 2088 | 6.4e-15 | 2.0e+0 / 3.4e+1 | 851.8 | 163 | 84 | 1.9x | 220 (2) |
| steinmetz-intersect | pass | 616 | 1.2e-15 | 2.4e+0 / 4.0e+0 | 574.7 | 48 | 17 | 2.8x | 81 (2) |
| steinmetz-union | pass | 1040 | 2.6e-15 | 5.2e+0 / 1.2e+1 | 468.7 | 59 | 48 | 1.2x | 123 (2) |
| coaxial-cylinder-stack | pass | 638 | 4.5e-16 | 4.8e+0 / 1.2e+1 | 307.9 | 30 | 34 | 0.9x | 152 (2) |
| sphere-minus-box | pass | 6202 | 3.3e-14 | 4.7e+0 / 1.1e+1 | 1630.0 | 360 | 242 | 1.5x | 462 (2) |
| sphere-intersect-cylinder | pass | 6000 | 3.8e-15 | 5.5e+0 / 9.9e+0 | 2586.4 | 448 | 236 | 1.9x | 350 (2) |
| box-minus-sphere-cavity | pass | 5226 | 3.6e-14 | 2.8e+0 / 1.8e+1 | 1221.4 | 294 | 184 | 1.6x | 295 (2) |
| hex-nut | pass | 1168 | 1.4e-15 | 7.8e-1 / 6.4e+0 | 827.3 | 101 | 62 | 1.6x | 149 (2) |
| enclosure-shell | pass | 2362 | 9.5e-15 | 1.1e+1 / 1.9e+2 | 1248.4 | 164 | 137 | 1.2x | 249 (2) |
| gear-48-bore | pass | 1344 | 5.0e-15 | 1.1e+0 / 6.2e+1 | 374.9 | 65 | 65 | 1.0x | 116 (2) |
| cylinder-tangent-box-face | expected-refusal | - | - | - / - | 67.6 | 5 | 23 | 0.2x | 53 (2) |
| hole-tangent-edge | expected-refusal | - | - | - / - | 177.3 | 16 | 11 | 1.5x | 109 (2) |
| self-union | pass | 208 | 2.8e-15 | 1.9e+0 / 4.7e+0 | 504.5 | 48 | 24 | 2.0x | 103 (2) |
| self-subtract | pass | 0 | 0.0e+0 | 0.0e+0 / 0.0e+0 | 441.2 | 27 | 16 | 1.7x | 71 (2) |
| self-intersect | pass | 208 | 3.2e-15 | 1.9e+0 / 4.7e+0 | 437.4 | 30 | 34 | 0.9x | 75 (2) |
| internal-void | pass | 24 | 7.8e-16 | 8.2e-12 / 3.0e+1 | 12.9 | 1 | 3 | 0.3x | 62 (2) |
| disjoint-union | pass | 204 | 2.4e-15 | 1.4e+0 / 9.5e+0 | 0.6 | 0 | 0 | - | 0 (0) |
| pin-array-chain-20 | pass | 2940 | 1.2e-14 | 5.0e+0 / 3.3e+1 | 1165.0 | 172 | 111 | 1.5x | 197 (2) |
| fine-spheres-50k | pass | 39588 | 2.6e-15 | 3.7e+0 / 7.0e+0 | 8580.7 | 2131 | 1137 | 1.9x | 1573 (2) |
| torus-minus-box | pass | 7200 | 2.6e-15 | 2.7e+0 / 1.2e+1 | 2313.1 | 416 | 300 | 1.4x | 414 (2) |
| r10b-g10-union | pass | 1306 | 1.7e-16 | 8.7e+0 / 4.2e+2 | 232.4 | 35 | 33 | 1.1x | 100 (2) |

Builds: cpu 26.4 s, metal 31.6 s, js 0.1 s.

## What a hybrid should take from corefine

1. **Shared-decision symbolic perturbation as the topology oracle.**
   - All topology comes from one `kernel12` decision per (edge, face) pair and
     never from rounded positions. The mesh is closed and manifold by
     construction, and coplanar or touching inputs resolve deterministically.
   - Every output face is a subset of exactly one input triangle. That is
     exact tag provenance for free: the pair (tag of P face, tag of Q face)
     of every new edge names the two analytic surfaces whose exact
     intersection curve the recover stage must compute.
   - The remaining degeneracies need only exact-position repairs (weld, zip,
     T-junction split), never an epsilon collapse.
2. **A CSG layer in front of any Boolean engine.**
   - Flatten unions, rewrite subtract spines, answer empty and box-separated
     operands directly, and concatenate greedy box-disjoint independent sets.
   - This turns O(n) Booleans into about the colouring number of the overlap
     graph, and it is engine-independent. It also belongs in front of an
     exact B-rep fuse.
3. **Bend engineering rules for parallel geometry.**
   - Put balanced fork trees over fixed-width chunks for per-pair and
     per-face work, and use a parallel stable merge sort for everything
     sort-based (deterministic across targets).
   - Keep strict single ownership of big data: sharing, and forks in frames
     before heavy parallel work, silently serialize the CPU pool.
   - Keep list-heavy divergent geometry on the CPU. The GPU only pays for
     flat numeric kernels.

## Limitations and next steps

- **Triangle count.** Output meshes have about 1–2x manifold3d's triangle
  count; for example 22,892 against 11,612 on the grid. Split points on
  straight edges are kept, because no vertex is ever moved. A collinear-edge
  collapse pass (Manifold `CollapseEdge` restricted to exactly collinear,
  unshared vertices) would reduce it.
- **Remaining costs.** Faces with many holes are the most expensive part (hole
  bridging scans all edges for visibility, and ear clipping is quadratic in
  the worst case). The winding union-find, the assembly and the weld are
  sequential.
- **Scaling.** From 1 to 18 threads it is about 1.5–2x on large cases. It is
  limited by the sequential stages and by atomic counts on the shared
  read-only tables of a Boolean (read by every chunk of the fork trees).
- **Tangent contacts** are refused. A non-manifold output format, or a
  Manifold-style perturbation that separates the contact, would be needed to
  answer them.
- **Accuracy.** The result is exact only for the tessellated leaves. Analytic
  accuracy is the recover stage's job, and corefine hands it tags and
  provenance.
