# Bake-off prototype `recover`: exact B-rep recovery from a tagged mesh

Status: 23 September 2026, second round, plus the step-2 gate of
`docs/hybrid-boolean-plan.md` (section "Plan step 2: no silent topology below
the deviation" below). Prototype, not production. All geometry is computed in
Bend (`kernel/hybrid/recover/`; until plan step 5 on 24 September
`kernel/proto/recover/`, which now holds only the bake-off entry `main.bend`
and the native driver). JS only reads, writes, re-indexes and checks.
OpenCascade and manifold3d are used only as independent test oracles, through
`uv run`.

`recover` is the second half of the leading hybrid. A robust tagged mesh
Boolean decides the topology. Recovery turns its tagged output back into an
exact analytic B-rep in the kernel's own body format, the format
`decodeAnalytic` produces and `src/exporters.mjs` consumes, so the existing
exporter writes exact STEP.

## Headline results

Measured on an M5 Pro while other teams were running (load average 15 to 30).

- **The hybrid works end to end with this project's own mesh Booleans.**
  - The tagged result meshes of `corefine` and `exact-plane` (both Bend) go
    through recovery unchanged.
  - Each source gives **32 of 38 corpus cases as exact STEP**. OpenCascade
    finds them valid (BRepCheck with exact CurveOnSurface, and the
    `BOPAlgo_ArgumentAnalyzer` self-interference check). Their volume and area
    match the exact OCCT CSG to at most 2e-14 relative, apart from the two
    reference artefacts explained below.
  - That is the same coverage as with the manifold3d oracle inputs.
  - The other 6 cases are 4 named refusals, plus the 2 tangent-contact cases
    that the sources already refuse.
  - Tool: `scripts/bakeoff/recover-hybrid.mjs`.
- **Corpus, manifold3d inputs: 32 exact, 2 expected refusals, 4 named
  refusals.** New this round: recovery refuses `cylinder-tangent-box-face` by
  itself through the clearance certificate. It no longer returns two touching
  solids.
- **Soundness fixes from the adversarial verifier's findings.** The verifier
  (`out/bakeoff/adversarial-recover`) flagged 10 bad outputs in round 1. Its
  63 cases (`scripts/bakeoff/recover-adversarial.mjs`) now give 29 exact,
  2 exact-empty, 12 expected refusals and 13 other refusals. Each refusal
  names its reason; 10 of the 13 are tolerance-level topology and 3 are
  missing curve types. The remaining 3 flagged outputs are STEP-export
  limitations, not wrong B-reps:
  - two sphere faces bounded by oblique arcs need parameter curves in STEP;
  - the kernel exporter's cylinder parameter-curve planner refuses 40 m
    coordinates. The same B-rep written with 3D curves only is valid and
    exact under OCCT (volume error 0).

  No output is wrong geometry anymore.
- **New exact topologies:** a full sphere (a sealed spherical void, a lone
  ball), a full torus, a torus band between two meridians (a U handle), and
  blister slivers (a cone rim lying on a ball).
- **Extra cases: 14 of 14 reach their expected verdict**, and **round trips:
  13 of 13 are exact.**
- **All four targets produce byte-identical output** on all 38 corpus cases:
  JS, native CPU at 1 and 18 threads, and Metal with one confirmed device
  pass each.
- **Cost relative to the mesh Boolean.** Recovery compute takes 31 ms for
  r10b, 190 ms for the 10×10 hole grid and 288 to 441 ms for fine-spheres
  (38,824 triangles), all native. That is roughly 5 to 25 % of the mesh
  Boolean it follows: `corefine` needs 35 ms, 1.6 to 2.3 s and 1.1 to 2.1 s
  for the same three cases.

## What changed this round (and why)

The adversarial verifier found outputs that OCCT rejected or that were
geometrically wrong. In every case the mesh decided a topology below its own
deviation, and recovery then made that topology exact. Three new
certificates (items 1 to 3) and a sliver fix (item 4) close those holes;
items 5 and 6 are new face types, and item 7 tightens the test tooling.

1. **Near-tangent leaves** (`tangent.bend`, before any mesh work).
   - Take two faces of different leaves whose carriers are within the
     clearance of tangency or coincidence, but not exactly tangent. Examples
     are a boss 0.005 mm wider than its bar, and a lip 1e-7 mm above the top
     it should be flush with.
   - If the tessellations of those two faces also come within the clearance,
     the pair is refused. The mesh Boolean cannot decide their topology.
   - This fixes `adv-boss-pokes-within-dev`, where the exact CSG has two
     0.005 mm slivers that the mesh lost, and the 1e-6 to 1e-9 coplanar
     perturbations, which OCCT rejected as self-intersecting.
2. **Clearance** (`clear.bend`, at assembly).
   - Every recovered face lies within h of its mesh patch: h is the deviation
     on curved carriers and the measured vertex residual on planes.
   - Two patches that share no mesh vertex must stay more than h + h' +
     1e-6 mm apart. Otherwise their exact faces may touch or cross, as with a
     bore breaking a top face by 0.005 mm, a wall thinner than the tolerance,
     or two bodies touching.
   - Implementation: a bounding-volume tree whose items carry their own
     geometry, a forked self-join, and an exact F32 triangle/triangle
     distance.
   - This fixes `adv-hole-near-tangent-1e-9`, `cylinder-tangent-box-face`
     and the concatenated-shell mutations.
3. **Nested solid shells.**
   - Each solid component must have a total winding number of 0 with respect
     to all other components. A solid inside a void inside a solid gives
     1 - 1 = 0 and is fine.
   - A solid shell inside another solid is refused as overlapping bodies
     (`mut2-void-reversed`, which was accepted before).
4. **Sliver targets.**
   - An absorbed sliver now merges into its largest non-sliver neighbour. A
     two-piece blister is no longer swapped between its own pieces.
   - A second pass absorbs fragments whose neighbours were all slivers.
   - Single-neighbour blisters count as slivers when the vertices, edge
     midpoints and centroids of all their triangles are within the
     deviation. A real small face, such as a pin top, has interior points far
     from its neighbours and is kept.
   - This fixes `adv2-cone-sphere-rotated` and the axis-aligned ice-cream
     cone control, both refused before.
5. **Closed carriers without boundary.** A full sphere gets two pole vertices
   and a pole-to-pole meridian seam. A full torus gets one vertex and two
   closed seams (the outer equator and a meridian).
6. **Torus band between meridian rims.** Meridian circles now carry their
   seam vertex on the outer equator. The band seam is the outer-equator arc
   that enters the face, and the STEP frame starts at rim 0.
7. **Stricter test infrastructure.**
   - `recover-step.py` now runs `BOPAlgo_ArgumentAnalyzer` (self-interference
     and small edges). `recover-check`, `recover-extra`, `recover-roundtrip`
     and `recover-adversarial` grade with it.
   - A tangent case that recovers to an ok output is now scored
     `contact-accepted`, never `info`.

## Algorithm

**Input.** Recover mode (docs/bakeoff.md): the job text immediately followed by
a tagged result mesh. A triangle's tag is a row of the face table, which gives
the exact carrier surface of the leaf face it came from. The stages are in
`kernel/hybrid/recover/topo.bend`; geometry is in `geom.bend`, the clearance
certificate in `clear.bend` and the near-tangency pre-check in
`tangent.bend`.

0. **Undecided near contacts** (`tangent.bend`, the pre-certificate; plan
   step 2). This replaced the closed-form gap list of round 2, which covered
   plane/cylinder only when parallel or perpendicular within 1e-12 and no
   cones, tori or crossed cylinders.
   - **Distance test for every carrier pair.** Every triangle of every leaf
     tessellation is a `clear.bend` item whose patch is the carrier class of
     its tag and whose h is the deviation on curved carriers and 0 on planes.
     One forked self-join (`C.close`) returns every pair of triangles from
     different leaves that come within h1 + h2 + 1e-6 mm, flagged when they
     touch or cross (distance within the F32 rounding of the local frame).
     Triangles of one leaf are never compared, and neither are faces of
     different leaves on one carrier (coplanar tops, a self-union's twins).
   - **Decided or not.** A face pair whose tessellations touch or cross
     somewhere has a crossing the mesh Boolean decided. It passes even when
     a third operand removed that crossing from the result (a bore through a
     counterbore floor), unless the removal is itself undecided (the second
     rule below). A pair that only comes close, never touching, is
     undecided unless the result mesh has an edge between the two carrier
     classes (an exact tangent contact line such as a slot end). Otherwise
     the job is refused, naming the carriers, tags, distance and clearance:
     - "the result is empty although ...": an empty result whose operands
       come within h + h' (the shaving that a mesh intersection loses);
     - "... and one of them contributes no triangle to the result": a tool
       face whose tessellation comes within h + h' of the other operand but
       has no triangle in the result (a tilted plane, a cone or torus shave);
     - "... and the result has no edge between them": both faces are in the
       result, but not their contact (crossed rods grazing each other).
   - **Crossings the result does not keep** (24 September 2026). A touching
     pair on a curved carrier whose result has no edge between the two
     classes goes through a second, bipartite join (`C.close2`): the
     result's triangles of each class against the other class's leaf
     triangles of other leaves. A pair whose result triangles come within
     h + h' + 1e-6 mm of the other's leaf triangles without ever touching or
     crossing them is refused ("... cross only where the result does not
     keep them, and the result's faces on one of them come within ..."): a
     plane grazing a rod whose only crossings a third operand removed. A
     pair whose result faces cross the other's leaf is a transversal crossing
     through the result's interior (a tee's branch bore through the main
     pipe's wall, inside the branch) and passes. Details in "Plan step 2".
   - Exactly tangent faces that only touch (a rod resting on a face) pass
     here and are refused by the clearance certificate at assembly.
1. **Carrier classes.**
   - Every tag gets the class of the first tag with the same unoriented
     carrier: same plane, same cylinder axis line and radius, same cone apex,
     axis and half-angle, same sphere, same torus.
   - Tolerances are 1e-7 mm, and 1e-10 in 1 - |cos|. Directions are first
     renormalized in F32x2.
   - One forked search per tag.
2. **Per-triangle checks** (the banged, forked kernel).
   - The face key is class × 2 + orientation, the sign of the triangle normal
     dotted with the carrier normal.
   - A triangle is refused if |cos| < 0.5 (ambiguous), if a vertex lies more
     than the deviation + 1e-9 mm off its tag's carrier, or if an index is out
     of range.
   - Coincident distinct vertices mean the mesh touches itself; that is
     refused too.
3. **Twins.** Half-edges are bucket-sorted by undirected edge. Each group must
   be exactly one pair with opposite directions. Same-key pairs become
   unions; cross-key pairs are the boundary candidates.
   - **Vertex links** (plan step 2, defence in depth). Twin half-edges join
     the triangle corners at both of their ends; a union-find over the 3T
     corners counts the corner cycles, one per fan. Their number must equal
     the number of used vertices. Otherwise a vertex's link is not one cycle
     and the job is refused ("the Boolean mesh touches itself at a point").
     This catches point contact from any source, including corefine's welded
     contact vertex, which passed the edge pairing and the coincident-vertex
     check (`contact-accepted` in the judge round).
4. **Patches:** connected components of equal face key, by union-find.
5. **Slivers.**
   - A candidate is a patch of at most 16 triangles, with at least one
     neighbouring carrier class.
   - **Never between planes** (plan step 2): a patch whose carrier and
     neighbour carriers are all planes is never a candidate. Planar
     tessellations have deviation 0, so there is no tessellation mismatch to
     repair, and such a patch is a real face (a corner chip, the tip of a
     bump).
   - It is absorbed when every triangle has its vertices, edge midpoints and
     centroid within the deviation of every neighbouring carrier.
   - It joins the non-sliver neighbour with which it shares the most boundary
     half-edges. A second pass runs only when the first absorbed something.
   - **Area bound** (plan step 2): a fragment between two differently
     tessellated copies of one curve is at most the deviation wide, so its
     area is at most deviation × its perimeter. An absorbed patch with a
     larger area is a real face narrower than the deviation (a cone tip
     dimple or bump) and the job is refused with that area.
   - The count is reported.
6. **Corners** are the mesh vertices where 3 or more patches meet.
   - Each is refined to the exact intersection of three carriers by 8 Newton
     steps from the mesh seed, using the triple with the largest |det| of unit
     gradients.
   - Checks: |det| ≥ 1e-6; the residual over all carriers is at most 1e-7 mm;
     the drift from the seed is at most min(3·dev/|det|, 10·dev).
   - A drift beyond 10·dev but within 3·dev/|det| at a corner whose carriers
     are pairwise transversal (sin of half the angle between any two tangent
     planes ≥ 0.1, so the mesh vertex, within dev of each carrier, lies within
     10·dev of every pair's curve) is open only through the triple's
     conditioning (three curves meeting at a small angle, e.g. the KT1 relief:
     |det| 0.088, drift 0.065 mm at dev 0.005). It refuses the exact recovery
     (BNo) once every later check has passed; any later certificate failure
     still refuses the mesh. The same deferral holds at a vertex decided by
     a contact helper (step 8). Any other drift beyond the bound is a
     certificate failure (BCert). A deferred corner is kept apart from the
     running refusal, so it stops nothing: the remaining corner, edge, face
     and assembly checks run as they would without it, in any order of the
     corners.
7. **Boundary loops** are walked from next pointers (a sort-join); a pinch is
   refused. **Runs** are loop pieces between corners. **Edges** pair each run
   with its reverse.
8. **Exact curves** come from the two carriers only, never from the polyline:

   | carrier pair | exact curve |
   |---|---|
   | plane/plane | line |
   | plane/cylinder | circle, generator line (incl. the tangent contact line), or ellipse |
   | plane/cone ⊥ | circle |
   | plane/cone through the apex at the half-angle | the tangent contact generator |
   | cylinder/cylinder, exactly parallel axes | generator line through a circle/circle point, or the tangent contact line |
   | cone/cone, exactly parallel axes, equal half-angles, tangent along a generator | that generator (the contact line) |
   | plane/sphere, sphere/sphere | circle (sphere/sphere in the radical plane) |
   | sphere/cylinder, sphere/cone (coaxial) | circle |
   | plane/torus ⊥ axis | circle R ± √(r² − h²), or the tangent circle |
   | plane/torus through the axis | meridian circle (seam vertex on the outer equator) |
   | torus/cylinder, cylinder/cone, cone/cone (coaxial) | circle |

   Pairs meeting in two parallel lines (plane/cylinder, parallel cylinders)
   are a tangent contact line when their radial gap is small (below 1e-6 mm
   for a plane and a cylinder; within the wire band below for two
   cylinders), unless
   the edge's first mesh point lies on one of the two lines, within a quarter
   of their distance: carriers that cross at a grazing angle (three-point
   arcs of a profile that share an end point) pass the radial test although
   their edge is the line through the shared point. Such a grazing edge is
   accepted only when every mesh point stays within the deviation of its
   line and within a quarter of the distance between the lines. At a vertex
   of a tangent pair the three normals are dependent; a helper plane through
   the contact line (normal: line direction x surface normal) decides it.
   "Exactly parallel" is decided on the represented numbers (the cross
   product of the axes vanishes in integer arithmetic): axes tilted by any
   angle, 1e-12 rad included, meet in a space quartic and are refused as one.
   Contact between two cylinders, two cones or a plane and a cone is decided
   on the wire values (geom.bend wire_band): the contact conditions (gap of
   the cross-section circles; apex distance and angle mismatch for a plane
   and a cone) are evaluated exactly in integer arithmetic and must lie
   within band = 2^-44·M, M the largest magnitude entering them. Carriers
   built tangent upstream agree to at most 0.6 band (R20 return plate, KT1
   core, test ovals). Beyond the band the exact sign decides: carriers that
   do not meet get no contact line (a radius moved 1e-10 mm off tangency is
   refused), cylinders that cross meet in two lines. Cones need a unit axis
   exactly (|a|² = 1) or both reference circles in one cross-section.
   A drift beyond the bound at a helper-decided vertex refuses only the
   exact recovery (BNo, the mesh stands), deferred as in step 6: it does not
   stop the recovery, the remaining checks run as they would without it,
   and a certificate failure among them still refuses the mesh (BCert),
   whatever tangent component the same input holds and in whichever order
   its corners come.

   Everything else is refused with the missing curve named: space quartics,
   spiric sections, plane/cone hyperbolas and parabolas, and oblique ellipses.

   **Certification of every run:**
   - every mesh boundary vertex lies within τ of the exact curve, and every
     segment midpoint within τ + dev;
   - the polyline sweeps the arc once and monotonically;
   - the exact end vertices lie on the curve within 1e-6 mm.
9. **Faces.** There is one face per patch.
   - **Planar faces:** outer and inner loops are decided by signed area.
   - **Cylinder and cone faces:** plain bands get an explicit seam; periodic
     faces with holes, or with rims that carry vertices, keep their loops.
   - **Sphere faces:**
     - a cap bounded by a circle, or a cap bounded by a loop with vertices;
     - a band between two coaxial circles, with a meridian seam;
     - **a full sphere:** two poles and a meridian seam.
   - **Torus faces:**
     - a band between latitude rims, with a meridian seam;
     - **a band between meridian rims**, with an outer-equator seam;
     - **a full torus:** two closed seams.
10. **Assembly and certificates.**
    - Components are found by union-find.
    - **Winding numbers:**
      - A void must lie inside exactly one solid (winding 1).
      - A solid component must have a total winding of 0 with respect to all
        other components. Otherwise it is refused as overlapping bodies.
    - **Euler identity:** 2V − 2E + 4F − 2L = 2V_mesh − T.
    - **Clearance** (`clear.bend`):
      - Each triangle becomes a work item that carries its patch, vertex ids,
        exact positions, h, and an F32 box inflated by h + 1e-6 mm.
      - Items are bucket-sorted along a 30-bit Morton curve of their box
        centres. A balanced tree is built by forked halving.
      - The tree is joined with itself. Subtrees inside one patch are
        skipped, and the top 5 levels fork.
      - Triangle pairs of patches that share a mesh vertex are skipped
        through a hash table of related patch pairs.
      - Every other pair gets a separating-plane quick reject and then the
        exact F32 triangle/triangle distance: 9 segment pairs, 6
        vertex/face projections and 6 segment/triangle crossings. Coordinates
        are local to the first vertex, taken from the F32x2 positions, with a
        rounding allowance of 1e-6 × the local extent.
      - A pair closer than h + h' + 1e-6 mm is refused, naming the two
        carrier kinds and the distance.

## Output format (`kernel/hybrid/recover/main.bend` header)

The output starts with `ok`, then a `brep <bodies> <V> <E> <F>` line, then the
vertex, edge and face records:

- **`v x y z`**: an exact vertex.
- **`e start end curve reals seam dev bound ranged t0 t1`**
  - `curve` is `line o d | circle o n x r | ellipse o n x major minor`.
  - `seam 1` marks a periodic seam, not a mesh boundary. It is one of:
    - a generator line (cylinder or cone band);
    - a meridian arc (sphere or torus band between latitude rims, or pole to
      pole on a full sphere);
    - an outer-equator arc (torus band between meridian rims);
    - the two closed seams of a full torus.
  - `dev` is the measured distance of the mesh boundary from the curve;
    `bound` is the certified tolerance.
  - `[t0, t1]` is the range of an open arc.
- **`f body shell sense surface reals tag nloops`**, followed by its loops.
  - `surface` is `plane o n x | cylinder o a x r | cone o a x r angle |
    sphere o a x r | torus o a x major minor`.
  - Spheres and tori carry the axis and seam direction of their STEP frame.
    They are not in the kernel body format yet.
- **`l outer n (edge forward)*`**: one loop.

A final `stats` line carries mesh, patch, corner and seam counts, the
certificate maxima and the number of slivers absorbed. When the job has
unified plane classes (plan step 4, section "Plan step 4" below), a
`unified <classes> <tolerance>` record follows. The output ends with
`end`. Every real is an F32x2 bit pair. Refusals are `unresolved <reason>`
then `end`.

Refusal classes (plan step 5, 24 September; the text is the same for both).
In Bend a refusal is `BCert` when the tagged mesh itself is not certified as
the Boolean's solid, and `BNo` when only the exact recovery is refused
(`kernel/hybrid/recover/topo.bend`, type `Out`). The hybrid entry
`kernel/hybrid/main.bend` answers a `BCert` refusal `unresolved` and keeps
the mesh as a certified approximation (`mesh <dev> <reason>`) for a `BNo`
refusal.
- `BCert`: every stage-1 refusal (the pre-certificate in `tangent.bend`, a
  malformed job, an unresolved source), the input checks (a bad index or tag,
  coincident vertices, a triangle not clearly oriented against its carrier, a
  vertex farther than dev x 1.000001 + 1e-9 mm from its carrier), the
  2-manifold and vertex-link checks, nested solid shells or a void inside
  more than one outer shell, the clearance certificate, and the four checks
  that measure the mesh against the exact geometry beyond their certified
  bound (a `Cert` reason in `topo.bend`: a corner's exact vertex farther from
  the mesh than its bound, unless open only through its triple's conditioning
  or decided by a contact helper (steps 6 and 8); a mesh boundary, or a
  boundary segment midpoint, leaving its exact curve; a boundary that does not traverse its curve once).
- `BNo`: everything else: sliver absorption, degenerate, two-carrier or
  non-concurrent corners, pinches, boundary runs, loops, curve and face types,
  seam splits, the Euler check.

JS side (test infrastructure):
- `scripts/bakeoff/recover-brep.mjs` decodes the text into kernel bodies.
- Kernel-format bodies go through `validateAnalytic` and `toStep`.
- Sphere, torus and void bodies go through `scripts/bakeoff/recover-stepx.mjs`,
  a 3D-only serializer with `SPHERICAL_SURFACE`, `TOROIDAL_SURFACE` and
  `BREP_WITH_VOIDS`.

## Numeric model and guarantees

- **Carriers** are the exact F32x2 face-table surfaces.
- **Curves** are exact functions of the carriers.
- **Vertices** are Newton solutions with a residual of at most 1e-7 mm over
  all meeting carriers. The observed residual is at most 1e-12 mm.
- **What is certified (each with a stated tolerance and a named refusal):**
  - The topology is the mesh's: Euler identity plus pairwise edge matching.
  - Every mesh boundary lies within its stated bound τ of its exact curve.
  - Every vertex is an exact carrier intersection.
  - Shells are nested consistently: voids lie in exactly one solid, and no
    solid lies inside another (F32 winding numbers with a 0.25 window).
  - Patches that share no mesh vertex are separated by more than h + h' +
    1e-6 mm, so their exact faces cannot touch. This is the stated
    local-feature-size assumption. The recovered solid is therefore also
    free of contact between bodies.
  - Every pair of leaf faces whose tessellations come within h + h' either
    touches or crosses (a crossing the mesh Boolean decided) or has its
    contact as an edge of the result, for every carrier kind. This is where
    a mesh Boolean decides topology below its deviation.
  - Every vertex link is one cycle (no point contact).
  - Planar patches are never absorbed as slivers, and an absorbed patch
    deletes at most deviation × its perimeter of area.
- **What is not certified:**
  - That the input mesh is the right Boolean away from near-tangencies. That
    is the mesh engine's job.
  - That an absorbed sliver was not a real feature narrower than the
    deviation, below the area bound. The count is reported.
  - That the tessellations crossing somewhere decide the topology of the
    whole contact. A tool that crosses a target's tessellation in one place
    and grazes it elsewhere passes the pre-certificate; the per-run curve
    certification (bound τ, single monotone sweep) is the check there.
  - Clearance between adjacent patches away from their common edge. Pairs
    that share a vertex are skipped.
  - That a general sphere cap's seam meridian avoids its own loop. OCCT
    checks this in the tests.

## Parallel structure and target behaviour

- **Fork-join maps** (`util.bend` `par.map`, 32 leaves) run the per-tag
  classes, per-triangle checks, corner refinement, per-edge curves and
  certification, and per-face assembly.
- **The pre-certificate** runs the same tree and forked self-join over all
  leaf triangles (items keyed by carrier class) before any recovery work.
- **The clearance tree** is built by forked halving. Its self-join forks the
  top 5 levels (up to 4 lanes per level) and runs sequentially below.
  - Forking every level made the join 5× *slower* at 18 threads, because the
    upper tree nodes are shared by every lane: fine-spheres went from 20 to
    106 ms, the 10×10 grid from 56 to 210 ms.
  - With the fork limit the join takes 23 ms and 45 ms at 18 threads.
  - Its items carry their own geometry, so the leaf work reads no shared
    table except the small related-pair hash.
- **Sequential stages:** union-find, the loop walks, the sort-joins, the
  winding folds, and building the clearance items (6 table reads per
  triangle).
- **Metal:** only the per-triangle map is banged. The native driver runs
  prep, map and finish as separate IO steps.

**Stage profile**, native, ms, from `tmp/recover/prof2.bend` (scratch, not
committed), on a loaded machine:

| stage | fine-spheres cpu1 | cpu18 | 10×10 grid cpu1 | cpu18 |
|---|---|---|---|---|
| per-triangle map | 73-81 | 47-55 | 15-19 | 16-19 |
| half-edge sort + pairing | 23-52 | 20-21 | 6 | 7 |
| slivers (both passes) | 17-19 | 15-17 | 24-36 | 35-48 |
| clearance items / sort / tree / join | 42-48 / 3-5 / 7-8 / 20-22 | 40 / 4 / 3 / 23 | 11 / 1 / 2-3 / 56 | 12-14 / 1 / 1-2 / 45 |

## Supported and unsupported

**Supported.**
- **Carriers:** planes, cylinders, cones, spheres and tori.
- **Curves:** lines, circles and ellipses, including every circle section of
  spheres and tori, generator lines and tangent contacts.
- **Topologies:**
  - planar faces with holes;
  - cylinder and cone bands and windows;
  - sphere caps and bands, and full spheres;
  - torus bands (latitude or meridian rims) and full tori;
  - several bodies;
  - void shells and islands in voids;
  - empty results;
  - tessellation slivers and blisters.

**Refused, each with a named reason.**
- **Missing curves:** non-coaxial quadric pairs (pipe tee, Steinmetz, cross
  holes), spiric sections, plane/cone hyperbolas and parabolas.
- **Vertex and face topology:**
  - degenerate tangent vertices (hex nut: the chamfer circle tangent to a
    flat);
  - periodic faces with one winding loop or more than two;
  - sphere faces with more than two loops;
  - torus faces with loops that are not two rims;
  - pinched boundaries.
- **Tolerance-level topology:** near-tangent leaves, patches closer than the
  clearance, and slivers or chamfers narrower than the deviation that have
  loops of their own (`adv2-sphere-flat-within-dev`).
- **Invalid meshes:** non-manifold, mis-wound, off-carrier, self-touching,
  overlapping shells, or a void outside every solid.

## Plan step 2: no silent topology below the deviation

23 September 2026, evening. `docs/hybrid-boolean-plan.md` section 8, step 2,
closes the recover defects of the judge round (plan section 7). Four changes,
all in `kernel/proto/recover/`:

- **General pre-certificate** (`tangent.bend`, algorithm step 0): a leaf-mesh
  distance test for every carrier pair from different leaves, with three
  named refusals for pairs that come within h + h' without touching and
  without a result edge between them (empty result; a face that contributes
  no triangle; no shared edge). `clear.bend` gained `close` (all close
  pairs, flagged when touching) and tests segment/triangle crossings first;
  `check` answers are unchanged.
- **Slivers** (step 5): never between planes; an absorbed area above
  deviation × perimeter is refused.
- **Vertex links** (step 3): recovery counts the fans at every vertex itself.

**Measured** (judge round 2 suites and meshes, `run.mjs` on all four
targets, graded by `judge-recover.mjs`; raw reports under
`out/bakeoff/step2-recover/final2/`):

| input meshes | wrong before | wrong after | exact before -> after |
|---|---|---|---|
| adv-recover, corefine / exact-plane / manifold3d | 15 / 14 / 15 | 0 / 0 / 0 | 30 -> 35 / 31 -> 36 / 30 -> 35 |
| adv-corefine, same sources | 1 / 1 / 0 (contact-accepted) | 0 / 0 / 0 | 13 -> 15 / 15 -> 16 / 14 -> 16 |
| adv-sdf, same sources | 1 / 1 / 0 (contact-accepted) | 0 / 0 / 0 | 37 / 35 / 36, unchanged |
| adv-exact-plane, same sources | 1 / 1 / 1 | 1 / 1 / 1 (the OCCT oracle error on `adv-ep2-rot-sphere-minus-cone`, section "Results" of `docs/bakeoff.md`) | 11 -> 12 / 11 -> 12 / 12 -> 13 |
| corpus, same sources | 0 | 0 | 32 / 32 / 32, recover output byte-identical to the judge round |

- Of the 15 wrong adv-recover outputs, the 4 planar chips and bumps are now
  exact (volume error at most 7e-15); the 2 cone tips, the 7 grazing shaves
  (tilt 1e-8 and 1e-5 rad, parallel and crossed rods, cone, rotated cone,
  torus) and the 2 empty intersections are named refusals.
- `contact-accepted` is 0 on every source; exact-plane's
  `adv-ep2-r1-cube-vertex-gap-1e-9` (OCCT self-interference before) is
  refused as well.
- Newly exact: `adv3-micro-bridge`, `adv-pocket-lid-1e-6`,
  `adv-wedge-sliver-1e-5deg`, `adv-ep2-box-union-overlap-1e-6` (all planar,
  volume and area within 6e-16 of OCCT). No case that was exact was lost.
- All four targets agree byte for byte on every run.
- **Cost** (interleaved A/B against the judge-round binary on the 36 corpus
  inputs, median of 3 processes each, machine loaded by other agents, 1-minute
  load 24-30): compute sum 4,039 -> 4,531 ms (+12.2 %) at 1 thread and
  3,694 -> 4,093 ms (+10.8 %) at 18 threads
  (development evidence kept locally). The pre-check
  join is most of it: about 4-15 ms on small jobs and 100-150 ms on
  fine-spheres and the 10×10 grid at 1 thread; the vertex-link check is about
  1 %.

**Fix of 24 September 2026 (hybrid gate verifier #2): crossings a third
operand removed.** The pre-certificate kept every close pair whose leaf
tessellations touch or cross somewhere. `advn2-graze-crossing-removed` (a
rod minus a plane tilted 5e-4 along the axis, 0.005-0.015 mm inside the
surface, minus the half z < 12 that holds every crossing of the facets)
passed it, and recover wrote an exact plain cylinder segment (628.3185 mm^3)
where the exact result keeps a 0.45-0.6 mm flat strip (628.2986 mm^3), on
corefine and manifold3d meshes alike. The plane face contributes no triangle
to the result, so the boundary certificate never saw the graze either.

- **New rule** (`tangent.bend`): a touching close pair on a curved carrier
  (h + h' > 0) whose result has no edge between the two classes goes through
  a second join: the result's triangles of each class against the other
  class's leaf triangles of other leaves (`clear.bend close2`, a bipartite
  join of two trees; one worker below 4096 items). Aggregated per pair as in
  the first join: a pair whose result triangles come within h + h' + 1e-6 mm
  of the other's leaf triangles and never touch or cross them is refused
  ("leaf faces on a cylinder carrier and a plane carrier (the carriers of
  tags 0 and 3) cross only where the result does not keep them, and the
  result's faces on one of them come within ... mm of the other's leaf faces
  (clearance ... mm) without touching them or an edge between them: ...").
  A pair whose result faces do cross the other's leaf is a transversal
  crossing through the result's interior, where a third operand swallowed
  the other face (`pipe-tee`: the branch bore crosses the main pipe's outer
  wall inside the branch), and stays decided. The earlier refusals come
  first and keep their text.
- **Half-edge sort** (shared by both rules): only triangles of classes in
  an open pair, or in a candidate whose two classes both have result
  triangles, are sorted; a class without result triangles has no edge.
- **Measured** (`out/bakeoff/fix2/judge/recover`, all four targets): the
  regression case `adv-graze-crossing-removed` is a named refusal on
  corefine and manifold3d meshes (exact-plane has no source for it); the
  control `adv-transversal-crossing-removed` (a 30° cut removed the same
  way) is exact. No grade of any old case changes on any source (corpus and
  four suites, corefine / exact-plane / manifold3d meshes), and the outputs
  are byte-identical to fix 1 except the `unified` statements (plan step 4
  fix of the same day). Test in `test/proto-recover.test.mjs`.
- **Cost** (interleaved A/B against the same code without the rule, 36
  corpus inputs, medians of 5, outputs identical, 1-minute load about 10):
  compute sum 3,388 -> 3,563 ms (+5.2 %) at 1 thread and 3,094 -> 3,353 ms
  (+8.4 %) at 18 threads; mostly the half-edge sort on jobs whose touching
  curved pairs are both in the result (fine-spheres, the 10×10 grid) and the
  second join on `pipe-tee` (+14 ms). Scripts and logs:
  local development evidence.


## Plan step 4: carrier unification is stated in the output

23 September 2026, evening. `docs/hybrid-boolean-plan.md` section 8, step
4. The judge found that recover refused most rotated coplanar input
(finding 3 of `docs/bakeoff.md` "Results"). The cause was not recover's
carrier classes: they already merge planes within 1e-7 mm. The corefine
meshes of those cases had membranes, slivers and point contacts, because
corefine decided the ~1e-14 mm offsets between the rotated faces from their
rounding. Step 4 therefore decides the topology in corefine
(`docs/proto-corefine.md`, algorithm step 10), and recover states the
decision:

- **The decision** is `kernel/hybrid/unify.bend`, shared by corefine and
  recover: plane carriers of different leaves whose normals agree within
  2^-44 per component and whose offsets n.o agree within 2^-44·scale (scale:
  the smallest power of two at or above the largest leaf |coordinate|),
  tested exactly on the face-table values. The tolerance was 2^-40 until 24
  September 2026; the hybrid gate verifier #2 showed that it merged real
  1e-11 mm skins over sealed voids on a tilted prism face and on a rotated
  block (corefine opened the void, recover wrote the opened pocket with
  `unified 1`). 2^-44·scale bounds the F32x2 rounding of one rigid
  transform with a margin (`docs/proto-corefine.md`, algorithm step 10). Pairs whose two normals are both
  exactly axis-aligned are never unified (fix of 23 September 2026): no
  rotation rounded them, so two such planes that differ are distinct input.
  Before the fix a sealed void 2e-11 mm under an axis-aligned top face came
  from corefine as an opened pocket, and recover wrote an 11-face, one-shell
  "exact" B-rep of it with `unified 1 2^-35`; now corefine keeps both shells
  and recover refuses the 2e-11 mm skin by name (the clearance
  certificate), with no `unified` record (test in
  `test/proto-recover.test.mjs`).
- **Output.** When the job has unified classes, the B-rep ends with
  `unified <classes> <tolerance>` before `end`; tolerance is 2^-44·scale
  in mm (2^-39 at scale 32). A recovered face lies on the first carrier of its class, so the
  other carriers of a unified class are within that tolerance of it.
  `scripts/bakeoff/recover-brep.mjs` reads the record into
  `stats.unifiedClasses` / `stats.unifiedToleranceMm`.
- **Refusals.** Recovery's own refusals in such a job end with "; coplanar
  plane carriers unified within 2^-44*scale (N classes)". A refused source
  mesh already carries corefine's suffix.
- **Classes are unchanged.** Recover's carrier classes still use their 1e-7
  mm / 1e-10 rule, which contains the step-4 classes for parts below 1e5 mm
  (2^-44·scale <= 1e-7). Above that, corefine can unify planes that recover
  keeps apart. Recover should then refuse the adjacent parallel patches by
  name ("parallel planes are adjacent"); no suite case exercises this yet.
  Nothing else in recovery changed.

**Measured** (recover on step-4 corefine meshes, `run.mjs` on js, cpu1,
cpuN and Metal, graded by `judge-recover.mjs`; raw reports under
`out/bakeoff/step4-unify/judge/recover/`):

| input | exact before (step 2) -> after | wrong B-reps after |
|---|---|---|
| corpus | 32 -> 32 | 0 |
| adv-corefine | 15 -> 15 | 0 |
| adv-exact-plane | 12 -> 23 | 1: the OCCT oracle error on `adv-ep2-rot-sphere-minus-cone` |
| adv-sdf | 37 -> 38 | 0 |
| adv-recover | 35 -> 35 | 0 |

- All 14 rotated coplanar cases of the exact-plane suite (6 flush pockets, 6
  touching unions, the rotated pocket and the rotated intersection) are
  exact, with strict `validate-step.py`; `adv2-sdf-countersink-rot` is
  newly exact too. Before, 3 of the 14 were exact and the rest were refused
  ("patches of only 2 distinct carriers meet", "parallel planes are
  adjacent") or had no source.
- No exact case was lost. The point contacts that were `expected-refusal` in
  recover are now `no-source`, because corefine refuses them since step 1.
- Corpus output is byte-identical to the judge round except
  `r10b-g10-union`, which gains the line `unified 1 <2^-33>` (two frozen
  faces 3.7e-11 mm apart at scale 128). Since the 2^-44 fix (24 September
  2026) that pair is no longer unified and r10b's output is the judge
  round's again.
- All four targets agree on every run (220 recover runs).

### Corpus

Commands: `node scripts/bakeoff/run.mjs --proto recover --targets js,cpu1,cpuN,metal --repeat 3`,
then `node scripts/bakeoff/recover-check.mjs`.

**Verdicts.** exact: the OCCT STEP is valid (BRepCheck exact and
interference-free) and its volume and area are within 1e-7 of the exact OCCT
CSG.

**Error columns.**
- *recovered vol err*: the OCCT volume of the recovered STEP against the OCCT
  CSG.
- *mesh vol err*: the input mesh against the same CSG.

**Timing columns.**
- `compute` is in ms: JS is the warm median, native values are medians of 3
  whole-millisecond `IO.now` samples.
- Metal includes about 40 ms of device start and one confirmed device pass
  per case.
- All four targets agree byte for byte.
- Builds: CPU 20.7 s, Metal 20.2 s, JS compile 8.8 s.

| case | verdict | F/E/V | surfaces | recovered vol err | mesh vol err | JS | cpu1 | cpu18 | Metal |
|---|---|---|---|---|---|---|---|---|---|
| leaf-cylinder | exact | 3/3/2 | cylinder 1, plane 2 | 0 | 2.1e-3 | 22 | 3 | 4 | 45 |
| box-union-overlap | exact | 12/30/20 | plane 12 | 3.5e-16 | 0 | 14 | 2 | 3 | 42 |
| box-subtract-overlap | exact | 10/24/16 | plane 10 | 2.8e-16 | 1.4e-16 | 10 | 2 | 2 | 42 |
| box-intersect-overlap | exact | 6/12/8 | plane 6 | 0 | 0 | 6 | 1 | 2 | 44 |
| box-rotated-intersect | exact | 12/30/20 | plane 12 | 0 | 4.6e-16 | 15 | 2 | 3 | 36 |
| box-coplanar-union | exact | 10/24/16 | plane 10 | 2.0e-16 | 2.0e-16 | 11 | 2 | 3 | 40 |
| box-coplanar-subtract | exact | 8/18/12 | plane 8 | 6.1e-16 | 3.0e-16 | 10 | 2 | 2 | 35 |
| box-touching-merge | exact | 6/12/8 | plane 6 | 6.8e-16 | 3.4e-16 | 8 | 2 | 3 | 40 |
| box-touching-partial | exact | 11/24/16 | plane 11 | 2.0e-16 | 0 | 11 | 1 | 3 | 38 |
| plate-through-hole | exact | 7/15/10 | plane 6, cylinder 1 | 0 | 1.1e-4 | 22 | 2 | 3 | 42 |
| plate-blind-hole | exact | 8/15/10 | plane 7, cylinder 1 | 0 | 5.6e-5 | 18 | 2 | 3 | 51 |
| plate-blind-pocket | exact | 11/24/16 | plane 11 | 1.8e-16 | 0 | 11 | 1 | 3 | 41 |
| plate-counterbore | exact | 9/18/12 | plane 7, cylinder 2 | 1.3e-16 | 9.4e-5 | 31 | 4 | 5 | 50 |
| plate-countersink | exact (36 slivers) | 8/17/11 | plane 6, cylinder 1, cone 1 | 1.7e-16 | 1.0e-4 | 47 | 8 | 9 | 67 |
| plate-4-holes | exact | 10/24/16 | plane 6, cylinder 4 | 2.3e-16 | 1.2e-4 | 46 | 8 | 8 | 59 |
| plate-hole-grid-10x10 | exact | 106/312/208 | plane 6, cylinder 100 | 0 | 2.6e-3 | 750 | 190 | 192 | 366 |
| tilted-holes-17deg | exact (ellipses) | 10/24/16 | plane 6, cylinder 4 | 1.7e-14 | 2.2e-4 | 50 | 9 | 10 | 45 |
| pipe-tee | unresolved: cylinder/cylinder space quartic | - | - | - | - | 39 | 6 | 6 | 46 |
| steinmetz-intersect | unresolved: 2-carrier vertex (quartic) | - | - | - | - | 11 | 2 | 2 | 34 |
| steinmetz-union | unresolved: 2-carrier vertex (quartic) | - | - | - | - | 25 | 3 | 5 | 40 |
| coaxial-cylinder-stack | exact | 3/3/2 | cylinder 1, plane 2 | 3.0e-16 | 1.6e-3 | 30 | 4 | 5 | 47 |
| sphere-minus-box | exact | 2/1/1 | sphere 1, plane 1 | 0 | 1.6e-3 | 188 | 58 | 53 | 140 |
| sphere-intersect-cylinder | exact | 3/3/2 | sphere 2, cylinder 1 | 1.9e-15 | 2.1e-3 | 167 | 50 | 44 | 127 |
| box-minus-sphere-cavity | exact | 7/13/9 | plane 6, sphere 1 | 3.9e-16 | 1.2e-3 | 152 | 50 | 45 | 125 |
| hex-nut | unresolved: degenerate tangent vertex | - | - | - | - | 23 | 3 | 5 | 41 |
| enclosure-shell | exact | 33/63/42 | plane 24, cylinder 9 | 3.8e-16 | 5.5e-4 | 130 | 21 | 21 | 70 |
| gear-48-bore | exact | 243/723/482 | plane 242, cylinder 1 | 4.2e-16 | 8.8e-5 | 283 | 53 | 55 | 110 |
| cylinder-tangent-box-face | expected refusal (clearance: plane and cylinder within 0 mm) | - | - | - | - | 30 | 3 | 4 | 77 |
| hole-tangent-edge | expected refusal (touching mesh) | - | - | - | - | 11 | 1 | 2 | 39 |
| self-union | exact | 3/3/2 | plane 2, cylinder 1 | 1.4e-16 | 2.4e-3 | 21 | 3 | 4 | 38 |
| self-subtract | exact (empty) | - | - | - | - | 1 | 0 | 0 | 32 |
| self-intersect | exact | 3/3/2 | cylinder 1, plane 2 | 0 | 2.4e-3 | 28 | 3 | 3 | 41 |
| internal-void | exact (void shell) | 12/24/16 | plane 12 | 6.5e-16 | 3.9e-16 | 10 | 2 | 4 | 37 |
| disjoint-union | exact (2 bodies) | 9/15/10 | plane 8, cylinder 1 | 1.5e-16 | 9.5e-4 | 26 | 4 | 4 | 51 |
| pin-array-chain-20 | exact | 46/72/48 | plane 26, cylinder 20 | 0 | 1.5e-3 | 119 | 30 | 32 | 88 |
| fine-spheres-50k | exact (OCCT CSG off by 7.8e-10) | 2/1/1 | sphere 2 | 7.8e-10 | 5.6e-4 | 1064 | 441 | 288 | 885 |
| torus-minus-box | exact (meridian seam) | 2/3/2 | torus 1, plane 1 | 1.7e-15 | 2.5e-3 | 250 | 81 | 64 | 183 |
| r10b-g10-union | exact | 68/187/124 | plane 58, cylinder 10 | 1.2e-10 | 1.0e-4 | 176 | 31 | 31 | 76 |

**Phase times** (ms: read + parse / compute / serialize, startup, whole
process):

| case | target | read + parse | compute | serialize | startup | whole process |
|---|---|---|---|---|---|---|
| fine-spheres-50k | cpu1 | 50 | 441 | 0 | 9 | 541 |
| fine-spheres-50k | cpu18 | 51 | 288 | 0 | 8 | 389 |
| fine-spheres-50k | Metal | 56 | 885 | 0 | 47 | 1053 |
| fine-spheres-50k | JS warm | 282 | 1064 | 0.1 | module load 65 | - |

The two reference artefacts:
- **fine-spheres-50k.** The recovered B-rep matches the closed-form volume
  to 4e-16. OCCT's own sphere/sphere fuse is off by 7.8e-10.
- **r10b-g10-union.** The reference fuses the frozen, tolerant source bodies,
  giving 1.2e-10.

**r10b.** The two operand bodies of r10b meet across a 0.01 mm gap between
parallel planar faces, at the tessellation deviation. Clearance treats planes
by their measured residual (1e-12), not by the deviation, so that gap is
certified and r10b stays exact.

### The hybrid end to end (`node scripts/bakeoff/recover-hybrid.mjs --source corefine|exact-plane --native`)

The inputs are the actual tagged result meshes of the two Bend mesh-Boolean
prototypes. Grading is identical to the corpus table.

| source | exact | unresolved (named) | source refused | recover cpu1 ms: countersink / 10×10 grid / fine-spheres / r10b / gear |
|---|---|---|---|---|
| corefine | 32 | 4 (pipe-tee, 2 × Steinmetz, hex nut) | 2 (the tangent cases) | 50 / 1208 / 372 / 24 / 52 |
| exact-plane | 32 | 4 (same) | 2 (the tangent cases) | 39 / 685 / 653 / 35 / 54 |

The 10×10 grid costs more than with manifold3d inputs because both sources
emit more boundary triangles there.

### Adversarial replay (`node scripts/bakeoff/recover-adversarial.mjs --native`)

These are the verifier's 63 cases and mutations, graded with its rules.

| outcome | cases |
|---|---|
| exact (29) | rotated plate/boxes, 1e-3 scale, iterated hole, three rotated bodies, stadium (exactly tangent), 5 µm corner chip, star of 6 boxes, crossing slivers, rotated countersink, **full sphere void, full sphere next to a box**, sphere near-coaxial 1e-9, **rotated half torus**, rotated torus minus box, two voids, island in void, sphere at 1e-3 and 1e3 scale, iterated sphere, dome on box, **rotated ice-cream cone**, axis-aligned ice-cream control, and the jitter / shuffle / rim / sliver mutations |
| exact-empty (2) | empty intersect, empty subtract |
| expected refusal (12) | tangent holes, tangent spheres, double shell, inside-out, **overlap concat (clearance)**, T-junction, vertex over dev, **reversed sphere void and reversed box void (winding)**, **overlapping sphere pair (clearance)**, void in void, void outside |
| refused, tolerance-level topology (10) | **boss pokes 0.005, bore breaks top 0.005** (near-tangent leaves), coplanar lip 1e-9 / 1e-7 / 1e-6, **thin tube 1 µm**, hole 1 µm / 1e-9 from a face, void wall 1 µm, sphere flat 0.005 deep |
| refused, missing curve or topology (3) | off-axis sphere/cylinder quartic (at 2 mm and at 1e-6 mm off axis), torus tangent to a plane (tangent carriers along a non-contact edge) |
| STEP export limits (3, not wrong geometry) | ball with two flats and with a rotated corner: OCCT needs parameter curves for oblique arcs on a sphere (valid under the sampled check, volume 3.4e-6 / 3.4e-7 off); 40 m plate: the kernel's cylinder parameter-curve planner refuses the coordinates (`InvalidSource`), while the same B-rep in 3D-only STEP is valid with volume error 0 |

Round 1 had 10 bad outputs; bold marks cases whose verdict changed this round (fixed bad outputs, and new exact topologies that were refused before).

### Extra cases (`node scripts/bakeoff/recover-extra.mjs [--native]`)

These are FDM-relevant face topologies outside the corpus. The inputs are
manifold3d Booleans with face provenance, and the reference is the OCCT CSG.

| case | verdict | F/E/V | notes |
|---|---|---|---|
| x-tube-window, x-tube-window-y | exact | 8/16/12 | cylinder faces with a hole (reader adds seams) |
| x-boss-slot | exact | 7/13/9 | rim with 8 edges |
| x-d-shaft | exact | 4/6/4 | partial cylinder |
| x-sphere-octant | valid-sampled (expected) | 4/6/4 | oblique great-circle arcs; OCCT pcurves approximated, volume 8e-8 off |
| x-sphere-band | exact | 3/3/2 | meridian seam |
| x-torus-cyl | exact | 2/4/2 | torus/cylinder circles |
| x-sphere-cone | exact | 3/3/2 | sphere/cone circle |
| x-torus-tilted | refused as expected | - | spiric section |
| x-rod-cross-hole | refused as expected | - | cylinder/cylinder quartic |
| **x-torus-half** | exact | 3/3/2 | U handle: band between two meridians, outer-equator seam |
| **x-icecream** | exact | 3/3/2 | cone rim on a ball: blister slivers absorbed |
| **x-thin-wall** | refused as expected | - | bore 0.005 mm from a face: near-tangent leaves |
| **x-pins-touching** | refused as expected | - | two pins touching along a line |

### Round trip (`node scripts/bakeoff/recover-roundtrip.mjs [--native]`, deviation 0.01 mm)

Kernel bodies (FeatureScript examples, pierced plates with 1, 4 and 9 holes,
and revolves) are meshed by `src/print-mesh.mjs` with face tags, recovered and
compared with the original. **13 of 13 are exact.** Surfaces, radii, angles,
curve families and face counts match. The OCCT volume and area of the
original and the recovered STEP agree to at most 5.5e-15 for F32x2 sources.
F32 polyhedral sources agree to at most 5e-8, because their vertices sit
about 1e-6 mm off their own planes.

**Lone leaves:** a single sphere, torus and frustum each recover to a valid
exact STEP. The volume error against the closed form is 0, 2.9e-16 and
2.6e-16.

## Upstream sources, adaptation and licences

No third-party code was copied; everything is written from scratch in Bend.

- **Pipeline shape.** The pipeline segments by primitive, extracts patch
  boundaries, intersects neighbouring surfaces, computes vertices and
  assembles the B-rep. This follows:
  - T. Várady, R. Martin, J. Cox, "Reverse engineering of geometric models:
    an introduction", CAD 29(4), 1997;
  - R. Bénière et al., "A comprehensive process of reverse engineering from
    3D meshes to CAD models", CAD 45(11), 2013.

  Tags carry the exact surfaces, so no surface fitting is needed.
- **Algorithms:**
  - union-find: Tarjan (1975);
  - half-edge pairing by sort: the standard halfedge builder idea (OpenMesh,
    CGAL);
  - conic and circle sections of quadrics and tori (textbook; `geom.bend`
    `plane_cone`, `plane_sphere`, `sphere_sphere`, `plane_torus`,
    `torus_meridian`, `torus_cyl`);
  - generalized winding numbers: A. Jacobson, L. Kavan, O. Sorkine-Hornung,
    SIGGRAPH 2013, with the triangle solid angle of Van Oosterom and Strackee,
    IEEE TBME 30(2), 1983 (`topo.bend` `solid_angle`, `solid.one`,
    `void.one`);
  - segment/segment closest points: C. Ericson, *Real-Time Collision
    Detection*, 2005, section 5.1.9 (`clear.bend` `seg_seg2`, branches turned
    into selections with guarded divisions);
  - Morton-ordered bounding-volume trees: T. Karras, "Maximizing parallelism
    in the construction of BVHs, octrees and k-d trees", HPG 2012, here as a
    bucket sort plus balanced halving (`clear.bend` `morton_sort`,
    `bv.build`);
  - the fuzzy-tolerance idea behind the near-tangency pre-check: OCCT's
    Boolean "fuzzy value" (`BOPAlgo_Options::SetFuzzyValue`, LGPL-2.1). Only
    the concept is used; the gap formulas are textbook.
- **Derived here:**
  - the tube distance bound (`edge.checked`);
  - the cap-pole, meridian and outer-equator seam side rules (`face.cap`,
    `band.arc.g`);
  - the clearance model h = deviation or plane residual;
  - the reader-refinement rule (`recover-check.mjs refinementOk`).
- **Project code reused:** `kernel/analytic.bend`, `real.bend`,
  `precise.bend`, `kernel/hybrid/mesh*.bend`.
- **Oracles (tests only):** OCCT through cadquery-ocp (LGPL-2.1, `uv run`),
  and manifold3d (Apache-2.0, through `reference.py`).

## Three ideas a hybrid should take from this

1. **Tags make the mesh Boolean's topology sufficient for exact geometry, and
   the two halves compose.**
   - With per-triangle provenance, patches, corners and carrier pairs
     determine every curve and vertex; no fitting is needed.
   - Both Bend mesh Booleans feed recovery unchanged, and 32 of 38 cases come
     out as exact, OCCT-valid STEP. Recovery costs 5 to 25 % of the mesh
     Boolean.
   - The mesh engine only has to be robust and tagged, not exact.
2. **Certify the topology decisions a mesh makes below its deviation, and
   refuse by name.** Exactness is only honest with certificates that catch
   what a tessellation cannot see:
   - the carrier-gap test for near-tangent leaves, which is O(F²) on the face
     table and independent of the mesh, so the mesh engine should run it as
     a pre-pass and fail early;
   - the clearance between unrelated faces, with h = deviation on curved
     carriers and the measured residual on planes (which is what keeps
     r10b's 0.01 mm gap);
   - winding-number shell nesting.

   Every accepted edge carries its measured deviation and bound.
3. **Let data ride with the work, and fork only at the top.**
   - Work items that carry their own geometry (the clearance tree) run
     without shared-table reads.
   - Forking every level of a tree join puts every lane on the same shared
     upper nodes and was 5× slower at 18 threads; forking the top 5 levels
     fixed it.
   - The mesh Boolean should emit triangle soup plus index, with coordinates
     and tags inline, so recovery's per-triangle maps become pure compute,
     which also suits Metal.
   - Never branch with `Bool.pick` around expensive calls: it evaluates both
     sides.

## Limitations and shared-contract needs

- **Body format and exporter:**
  - sphere and torus surfaces with a frame;
  - multi-shell solids (`BREP_WITH_VOIDS`);
  - ranged meridian and equator seam arcs;
  - closed seams with start = end (full torus);
  - **parameter curves for sphere faces bounded by oblique arcs.** OCCT's
    own writer emits B-spline pcurves; without them OCCT is only valid in
    sampled mode. They would be computed in Bend with a stated bound.

  `scripts/bakeoff/recover-stepx.mjs` shows the 3D serialization.
- **Kernel exporter at large coordinates.** The cylinder parameter-curve
  planner refuses a 40 m plate (`InvalidSource`). The recovered B-rep itself
  is exact.
- **Curves.** Non-coaxial quadric intersections, spiric sections and
  plane/cone hyperbolas need a B-spline or intersection-curve entity with a
  stated bound. The body format has none.
- **Hex nut.** It needs the tangent degenerate vertex (the chamfer circle
  tangent to a flat) and plane/cone hyperbolas.
- **Recover output scoring.** `run.mjs` scores recover output by its status
  line only. `recover-check.mjs` exports `checkVerdict` and `gradeRows`, which
  the runner could call for `output: 'brep'`.
- **Shared parser.** `mesh-io.bend` is used unchanged; nothing was copied.
- **Tolerance semantics.** The clearance and near-tangency certificates
  assume a local feature size of at least the deviation on curved faces.
  Features thinner than that are refused, such as the 1 µm walls, even when
  the exact CSG is valid. A hybrid that must accept them has to tessellate
  finer or decide such contacts exactly.
- **Scaling.** CPU scaling from 1 to 18 threads is 1.0 to 1.5×, and Metal is
  slower than the CPU. The finish stage is dominated by sequential list
  passes: sorts, union-find and the clearance item build.

## Commands

```sh
npm run bakeoff:reference                                   # oracle dumps (recover input source)
node scripts/bakeoff/run.mjs --proto recover --targets js,cpu1,cpuN,metal --repeat 3
node scripts/bakeoff/recover-check.mjs [--target cpu1]      # kernel validation + STEP + OCCT (+ interference)
node scripts/bakeoff/recover-hybrid.mjs --source corefine [--native]     # the hybrid end to end
node scripts/bakeoff/recover-hybrid.mjs --source exact-plane [--native]
node scripts/bakeoff/recover-adversarial.mjs [--native]     # verifier cases, verifier rules
node scripts/bakeoff/recover-extra.mjs [--native]           # extra FDM cases (manifold3d inputs via uv)
node scripts/bakeoff/recover-roundtrip.mjs [--native]       # kernel body -> tagged mesh -> recovery
node --test test/proto-recover.test.mjs                     # 19 tests, about 25 s (4 need uv or generated inputs)
```
