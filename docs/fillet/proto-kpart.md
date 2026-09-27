---
title: Fillet prototype A "fillet-kpart"
status: stage 1 (the per-edge ladder), stage 2 (the corner network) and stage 3 (the B-rep surgery, overflow as notch) built and measured, 2026-09-24; fix:fillet-kpart (sphere-corner frame, setback mitres) the same day
---

# Fillet prototype A: `fillet-kpart`

Prototype A of the fillet bake-off ([fillet.md](../fillet.md) §5.1): analytic
blends first, then local surgery. Stages are appended below. Each stage
records its design, its evidence and its open items.

Labels as in [harness.md](harness.md): MEASURED (run here, command named),
DOCUMENTED (source named), INFERRED (derived here).

## Stage A1: the per-edge ladder (2026-09-24)

**Scope.** Stage A1 resolves the selection, classifies every selected edge
and solves each edge on its own (a rung of the ladder). The result is the
exact blend stripe: its carrier, spine, contact (spring) curves and existence
bounds. The vertex census names what happens at every stripe end.
Configurations outside v1 are refused with a typed class
([entscheidungen.md](../entscheidungen.md), 2026-09-24).

Stage A1 builds no B-rep. `run(job)` therefore always answers a typed
refusal, never `ok`:
- when the ladder refuses the case: its own class and reason;
- when it admits every stripe, bound and vertex:
  `unresolved not-implemented stage-1 ladder admits all <n> stripes (edge:carrier ...); B-rep assembly is stage 2`.

The stripes as data come from a second export, `ladder(job)`. The native
driver writes them to `<result>.ladder`.

### Files

| file | lines | content |
|---|---|---|
| `kernel/proto/fillet-kpart/job.bend` | 655 | job reader (harness job format). Its carriers include sphere and torus and live in the proto directory, as `kernel/proto/recover` did |
| `kernel/proto/fillet-kpart/geom.bend` | 543 | F32x2 scalars and vectors, the 2D section frame (`Tra` translation, `Rot` meridian), face normals, edge tangents, edge/face incidence, adjacency, decimal text for reasons |
| `kernel/proto/fillet-kpart/ladder.bend` | 656 | classification, tangent propagation, section primitives, the 2D solver, chamfer setbacks, blend carriers, `stripe(task, edge)` |
| `kernel/proto/fillet-kpart/bounds.bend` | 629 | width bounds (obstacles per face, four metrics), vertex census, corners, per-stripe post-processing |
| `kernel/proto/fillet-kpart/main.bend` | 572 | selection, fork-join over stripes, merges, verdict, ladder text; `run`, `parse`, `solve`, `show`, `ladder` |
| `kernel/proto/fillet-kpart/native.bend` | 118 | harness driver (copy of the null driver); also writes `<result>.ladder` |
| `scripts/fillet/ladder.mjs` | 436 | independent float64 checker of the ladder data (test infrastructure) |
| `test/fillet-a1-ladder.test.mjs` | 173 | 11 focused tests |

In total the Bend code is about 3.2k lines. That is at the top of the
1.5k to 2.5k estimate for the ladder in fillet.md §5.1: the verbosity comes
from Bend 2.0.25 (no `if`, no mutual recursion, matches only on parameters in
binder order, definitions before use).

### Pipeline

1. **Selection** (`main.bend resolve`):
   - indices are sorted and deduplicated (`note duplicate-ignored n`);
   - an index out of range gives `invalid-input`;
   - seam edges (used twice by one face) are ignored with
     `note seam-ignored e`;
   - with `tangentPropagation` the G1 chains are added
     (`note propagated e`).

   The stripe order is ascending edge index and is written to the data
   (`order n e1 … en`). That is the deterministic, recorded multi-edge order.
2. **Propagation** (`ladder.bend propagate`): passes to a fixpoint (at most
   E passes). A pass adds every unselected edge y at an end vertex v of a
   chain edge x when:
   - the out-tangents of x and y at v are anti-parallel (G1 continuation);
   - y is a manifold, non-seam, non-smooth edge;
   - y has the same convexity as x (ACIS situation 1; a convexity change
     stops the chain, situation 2; theory §7).
3. **Classification** (`classify`):
   - F1 is the face that uses the edge forward, so its coedge runs along the
     edge; F2 uses it reversed;
   - the outward normals n1 and n2 are taken at the start vertex;
   - convex iff (n1 × n2)·t > 0 (theory §1.2);
   - |n1 × n2| < 1e-9 means a smooth edge, refused as `tangent-edge`. That is
     Onshape's `FILLET_FAIL_SMOOTH` (probe FP12).
4. **Family** (theory §4.1):
   - translation: a line edge, both supports invariant along it (planes that
     contain the direction, cylinders with a parallel axis);
   - rotation: a circle edge, both supports coaxial with it (planes ⟂ axis,
     coaxial cylinders, cones and tori, spheres centred on the axis);
   - anything else is `unsupported-surface` (a pipe blend, not analytic);
     ellipse edges are `unsupported-edge`.
5. **2D solve, per edge in a fork-join tree** (`fillet2d`, theory §4.2). Each
   support becomes a primitive in the section plane: a line through the
   corner with ball-side normal m (m = −n convex, +n concave, theory §1.3),
   or a circle with the ball outside or inside.
   - line/line: c = e + r(m1 + m2)/(1 + m1·m2), no trigonometry;
   - line/circle: a quadratic on the offset line, root nearest the corner;
   - circle/circle: intersection of the offset circles, root nearest the
     corner.
   - Failures are typed: offset radius ≤ 0 (`radius-too-large`, curvature
     bound r < ρ), offsets that miss (`radius-too-large`, no spine), a
     contact behind the edge.
6. **Carrier** (`carrier`):
   - translation fillet: a cylinder of radius r on the spine line;
   - rotation fillet: a torus with major ρ_c and minor r. At |ρ_c| ≤ 1e-9 it
     is a sphere. ρ_c < 0 is `radius-too-large`. A spindle torus whose used
     arc crosses the axis is `self-intersection` (theory §4.6: the bound is
     r < ρ, not r ≤ ρ/2).
   - chamfer: a plane (translation), or a plane, cylinder or cone (rotation)
     through the two setback points.
   - `sense` records the orientation: for a fillet, whether the outward
     normal is the carrier's natural normal (convex edge) or reversed
     (concave edge); for a chamfer, the face points away from the material.
7. **Chamfer semantics:** Onshape `EQUAL_OFFSETS` measures the distance
   along each support face (probe FP-a, [entscheidungen.md](../entscheidungen.md)
   correction of 2026-09-24). So each contact is e + d·τ_i, with τ_i the
   in-face direction away from the edge (n1 × t and t × n2). The task text
   still said "face offset". It was written before the correction, and the
   correction wins. The face-offset contacts would be exactly the fillet
   contacts with r = d; they are not emitted. A setback along a curved
   section (a cylinder support of a line edge) is `not-implemented`.
8. **Width bounds** (`bounds.bend`, theory §2.3 condition 5, §10.3-10.4).
   Per stripe side, w is the contact's distance from the edge, measured in
   the face. W is the smallest distance, over the edge's extent, of an
   obstacle on the same face. Obstacles are:
   - boundary edges of the face that share no vertex with the blended edge;
   - springs of other stripes on the face;
   - the axis, for a spring moving inward on a disk.

   Four metrics cover the families:
   - `TP`: translation, plane face. λ along τ over the slab 0 ≤ d·(X−e) ≤ len;
     segments are clipped exactly, circles in the plane are solved exactly;
   - `TC`: translation, cylinder face. Arc length ρ·angle; generator lines
     are the obstacles;
   - `RP`: rotation, plane ⟂ axis. Radial distance from the axis, using the
     exact point-segment distance and |d_q ∓ R| for circles;
   - `RL`: rotation, cylinder or cone face. Distance along the meridian line;
     coaxial circles and generator segments are the obstacles.

   The status compares w with W:

   | condition | status | treatment |
   |---|---|---|
   | w < W − 1e-9 | `inside` | admitted |
   | abs(w − W) ≤ 1e-9 | `consumed` | admitted (the face shrinks to a curve) |
   | w > W + 1e-9, W from a boundary edge | `overflow` | refused |
   | w > W + 1e-9, W from a spring | `blend-overlap` | refused |

   Every refusal names the needed and the available width, as the "no silent
   tolerance growth" decision requires. An obstacle without an exact bound
   yet (for example a non-coaxial circle on a cylinder, or sphere or torus
   supports) makes the side `unknown` and the case `not-implemented`.
9. **Full rounds:** a side consumed by another stripe's spring, where both
   carriers are the same surface, gives `merge k j full-round` (theory
   §10.3, the OCCT #1177 case). A side consumed by a boundary edge (r equal
   to the face width) or by the axis (the sphere dome at r = ρ) is admitted
   as `consumed`.
10. **Vertex census** per stripe end (theory §6-7). Unselected smooth edges,
    such as the coplanar fragments a planar union leaves, are not counted as
    vertex edges.

    | at the vertex | end | treatment |
    |---|---|---|
    | closed edge | `closed` | admitted |
    | no other selected edge, valence 3 | `cap` | admitted |
    | unselected G1 continuation | refused | `vertex-blend` (the `tangentPropagation: false` slot) |
    | one other selected edge, G1 | `chain` | admitted |
    | one other selected edge, same convexity, valence 3 | `mitre` | admitted: `trimmed`, or `extended` when the third edge has the opposite convexity (see below) |
    | one other selected edge, opposite convexity | refused | `mixed-convexity` |
    | three selected edges of one convexity, valence 3 | `corner` | admitted: a sphere (three planes, centre from the 3×3 plane solve) or, for chamfers, Onshape's triangle through the three setback points (probe FP-b) |
    | anything else | refused | `vertex-blend` or `mixed-convexity` |
11. **Verdict:** the first refusal in a fixed order: stripes by edge, then
    width bounds, then vertex census, then corners. With no refusal the case
    is admitted.

**The extended mitre (FP08).** Take two blends of one convexity that meet at
a vertex whose third, unselected edge has the opposite convexity. Examples
are concave root fillets around a boss, or convex top-edge chamfers at a
reflex outline corner. The ACIS/theory §6.3 reading is a horn torus.
Onshape instead extends both blends until they meet (MEASURED, probe FP08,
`hard-boss-root-concave-mitres-r1`):
- 4 cylinders and 11 planes, no torus;
- the plate top face has 456 mm² = 600 − 100 − (40·r + 4·r²), exactly the
  extended-mitre footprint;
- each cylinder face measures 16.8466 mm² on the mesh, against
  (π/2)·10 + 2(π/2 − 1) = 16.8496 mm² for the extended mitre (INFERRED);
- the extended-mitre closed form is ΔV = 40·r²(1 − π/4) + 4·r³(5/3 − π/2) =
  8.9675 mm³. Onshape reports 8.9641 mm³, with a mass-property range of
  [8.217, 9.711].

The ladder therefore admits these ends as `mitre … extended`. The r22 outline
chamfer (`ok`) is the same configuration; it would have been declined under
the horn-torus rule.

### The ladder data (`wonky-fillet-ladder 1`)

One record per line. Reals are F32x2 words, as in the job format, so every
target's output can be compared byte for byte:

```
wonky-fillet-ladder 1
case <id>
op fillet|chamfer
size <real>
chamfer-def setback-along-faces|none
propagate 0|1
note seam-ignored <e> | duplicate-ignored <n> | propagated <e>
order <n> <e>...
stripe <e> ok faces <f1> <f2> convex|concave sin <real> cos <real> carrier <kind> sense 0|1
section translation <e> <d> <u> <w> <len> | rotation <o> <a> <r> <closed>
corner2 <p2> centre2 <p2>
surface <plane|cylinder|cone|sphere|torus ...>
spine line <o> <d> <len> | circle <o> <n> <x> <r> | none
side <i> face <f> support <kind> contact <vec> width <real> bound inside|consumed|overflow|unknown limit <0|1> <real> by none|edge|spring|axis <id>
spring <i> line … | circle …
end closed | cap <v> | chain <v> <e> | mitre <v> <e> trimmed|extended | corner <v> | refused <v> <class> <reason>
stripe <e> refused <class> <reason>
corner <v> sphere <centre> <r> | triangle <p> <p> <p> | refused <class> <reason>
merge <e1> <e2> full-round
verdict admit <n> | refuse <class> <reason>
end
```

### Evidence

Commands:

```sh
node scripts/fillet/run.mjs --proto fillet-kpart --targets js,cpu1,cpuN,metal   # harness, all four targets
node scripts/fillet/ladder.mjs --probes                                          # stripe checker + FP15/FP16
node --test test/fillet-a1-ladder.test.mjs                                       # 11 tests
```

**Harness** (MEASURED, `out/fillet/fillet-kpart/summary.md`,
local development evidence):
- verdicts: `declined` 52 and `expected-refusal` 18. `declined` is correct
  for stage 1: an `ok` case can only pass with a B-rep;
- all four targets give identical result bytes on all 70 cases;
- the checker compared the native `.ladder` sidecars with the JS ladder text:
  identical on 70 of 70 cases for cpu1, cpuN and Metal.

**Admission against the expectations** (MEASURED,
`out/fillet/fillet-kpart/ladder/summary.md`, 70 cases plus the two chamfer
probes):

| group | admitted | refused correctly | notes |
|---|---|---|---|
| core (40, all `ok`) | 40 | – | no case declined |
| corpus (12) | 10 (9 `ok` and notch-r1.5) | notch-r6 (`must-refuse`, `overflow`); notch-r3 (`either`, `blend-overlap`) | |
| hard (18) | 3 `ok`, 4 `either` | 3 `must-refuse`, 8 `either` | FP12 tangent edge refused as Onshape does |
| probes FP15, FP16 | 2 | – | chamfer semantics |

- **The ladder admits no `must-refuse` case and declines no `ok` case.**
- Admitted: 217 stripes (140 cylinders, 14 tori, 1 sphere, 39 planes, 23
  cones) and 19 corners.
- Ends: 217 cap, 57 corner, 54 trimmed mitre, 10 extended mitre, 40 chain,
  28 closed.
- Bounds: 427 inside, 7 consumed.

**The `must-refuse` and `either` cases against Onshape** (Onshape probes
MEASURED by the cad-31 session, read-only in
`~/Workspace/cad/cad-project-041/single-step-r20/kernel-cases/fp-*`):

| case | expect | ladder | Onshape | stripe-sum ΔV |
|---|---|---|---|---|
| corpus-notch-trial-r6 | must-refuse | `overflow` (needs 6, face 5) | not probed | – |
| hard-single-edge-r-too-large-r12 | must-refuse | `overflow` (needs 12, face 10) | not probed | – |
| hard-chamfer-exceeds-both-faces-d5 | must-refuse | `overflow` (needs 5, face 4) | not probed | – |
| pc-post-top-rim-too-large-r6 | must-refuse | `radius-too-large` (torus major −1) | not probed | – |
| corpus-notch-trial-r1.5 | either | admit, full-round merge | built, +5.7942, 1 cylinder | +5.794249588 (Onshape −4e-14) |
| hard-single-edge-r-equals-width-r10 | either | admit, both sides consumed | built, −214.6018 | −214.601836603 (3e-13) |
| hard-full-round-r5 | either | admit, full-round merge | built, −107.3009, 1 cylinder | −107.300918301 (2e-13) |
| hard-near-tangent-ridge-178.9-r2 | either | admit | built, −2.3589e-5 | −2.35889e-5 (1.2e-10 abs) |
| hard-boss-root-concave-mitres-r1 | either | admit, 8 extended mitres | built, +8.9641, 4 cylinders | – (mitres) |
| hard-tangent-edge-selection-r1 | either | `tangent-edge` | **ERROR FILLET_FAIL_SMOOTH** | – |
| corpus-notch-trial-r3 | either | `blend-overlap` | built, +20.834, 2 cylinders | – |
| hard-overlapping-blends-thin-wall-r1 | either | `blend-overlap` | built, −8.4789 | – |
| hard-short-edge-in-loop-r1 | either | `blend-overlap` | built, −12.3948 | – |
| hard-overflow-narrow-ledge-r0.4 | either | `overflow` (0.4 vs 0.125) | built, +0.2492 | – |
| hard-overflow-convex-small-face-r2 | either | `overflow` (0.828 vs 0.566) | built, −0.8468 | – |
| hard-concave-rim-overflow-r6.5 | either | `overflow` (6.5 vs 6) | built, +310.39, torus + 2 cylinders | – |
| hard-mixed-convexity-corner-r1 | either | `mixed-convexity` | built, −7.2797, 3 cylinders + torus | – |
| fl-slot-one-line-no-propagate-r1 | either | `vertex-blend` (unselected G1 continuation) | built, −4.8786, 3 cylinders | – |
| probe FP15 (120° chamfer, d = 1) | ok | admit | built, −8.6603, 9 planes | −8.660254038 (9e-13) |
| probe FP16 (box corner chamfer) | ok | admit, corner triangle area 0.8660 | built, −29.3333, triangle 0.866 mm² | – (corner) |

Every admitted `either` case that Onshape probed has the same verdict as
Onshape. Where the stripes are independent, the ΔV matches Onshape's to
≤ 3e-13 (the ridge to 1.2e-10 absolute, see below).

Onshape builds eight `either` cases that the ladder refuses:
- overflow: notch, cliff and smooth-overflow variants;
- blend overlap;
- the mixed-convexity corner (a torus);
- the unselected G1 continuation.

These are the later-stage work ("overflow: notch first").

**Stripe geometry** (MEASURED, `scripts/fillet/ladder.mjs`, float64,
independent of the Bend code): 0 issues on all 72 cases. Every admitted
stripe passes these checks:
- contacts on the support (≤ 1e-9 mm) and on the carrier;
- fillets: carrier radius = r (≤ 1e-12), G1 with each support (≤ 1e-9 rad),
  ball centre at contact + r·m (≤ 1e-9 mm), spine at distance r from both
  supports;
- chamfers: both contacts at setback d from the edge (≤ 1e-9 mm);
- sphere corners at distance r from every face at the vertex;
- chamfer triangles at setback d along the edges;
- every carrier kind is in the case's `blendTypes`.

**Stripe-sum volume** (MEASURED): 46 admitted cases have only caps, chains or
closed ends, no corner and no mitre. For them the ladder's stripes give the
volume change directly: section area × length, or Pappus × the swept angle.
- 46 of 46 agree with a closed form within the validator's tolerance
  (1e-7 × the input volume).
- 40 have an OCCT result. They agree with OCCT to ≤ 8.5e-12 relative.
- The angled prisms (60°, 30°, 120°, 150°, 240°, 300°) differ from their
  nominal closed forms by up to 1.4e-7 relative but from OCCT by ≤ 7e-13:
  the kernel-built inputs sit at the nominal angle only to about 1e-8.
- The 178.9° ridge differs from the closed form and Onshape by 1.2e-10 mm³
  on 2.4e-5 mm³. The sliver goes as θ³, so an input angle about 3e-8 rad
  off nominal explains it. INFERRED; OCCT cannot build this case.
- `ch-convex-60-d1` and `ch-cone-rim-0.42` match their `inSupport`
  alternatives, as the setback semantics predicts. FP15 matches Onshape
  (−8.660254038).

**Timing** (MEASURED, run 2, Apple M5 Pro, compute phase):

| case | js ms | cpu1 ms | cpuN ms | Metal ms |
|---|---|---|---|---|
| perf-comb-vertical-edges-r0.5 (50 stripes) | 68 | 29 | 64 | 1065 |
| perf-hole-grid-rims-0.42 (16) | 12 | 2 | 5 | 155 |
| pp-box-all-edges-r2 (12 + 8 corners) | 8 | 2 | 2 | 120 |

- All 70 cases take 271 ms on JS, 53 ms on cpu1 and 128 ms on cpuN.
- The fork-join (balanced halves over stripes, then over post-processing)
  does not pay at this size. One rung costs about 0.5 ms, and the shared `+`
  body costs reference-count atomics per read (Bend guide, "Parallelism").
- Metal is 20 to 40 times slower on this divergent graph work, as the guide
  predicts.
- A first version ran the propagation for E passes whatever happened. It
  now stops at the fixpoint, which took the comb from 1539 ms to 68 ms on JS.

### Decisions taken in this stage (to confirm)

1. Chamfers use setback-along-faces (Onshape FP-a) instead of the task
   text's "face offset" (stale; the correction wins).
2. A mitre beside an opposite-convexity third edge is extended (Onshape
   FP08), not a horn torus.
3. Exact consumption (r equal to the face width, the full round, the dome at
   r = ρ) is admitted, as Onshape builds it (FP02, FP03, FP04). Overflow
   and overlap are refused.
4. Decision band: widths within 1e-9 mm count as equal, and the sphere
   replaces the torus at |ρ_c| ≤ 1e-9 mm. Inputs are F32x2 (≤ 1.8e-14 mm
   quantization, harness.md), so exact configurations land about 1e-13 from
   the boundary and real near-misses such as r = 9.999 land at 1e-3. There
   is no filtered or exact predicate yet, and no "undecidable" answer between
   the bands (fillet.md §5.1 risk). Every refusal reports the numbers.

### Open items and limits

- **No B-rep yet.** Stage 2 builds it: caps, mitre curves (ellipses),
  sphere-corner octants, the chamfer triangle, face consumption and
  full-round merging, and the surgery.
- Width bounds leave out adjacent edges (sharing a vertex); the vertex
  census stands in for them. A spring leaving its face through a neighbour
  that is not perpendicular (an acute face corner at a cap) is not caught in
  stage 1. Stage 2's trim must catch it or refuse.
- Circle arcs count as full circles in the width bound. That is
  conservative: it can over-refuse, never under-refuse. (The prototype
  only; the production bounds, `kernel/fillet/bounds.bend`, measure the
  arc and, for a rotation on a plane, only the edge's wedge:
  docs/fillet-plan.md, "Fix: obstacle extent in the width bound".)
- Supports that are spheres or tori have section primitives, but no width
  metric yet: `not-implemented` (wonky cannot build such inputs today). The
  same applies to a chamfer on a line edge of a cylinder support.
- Cylinder/cylinder translation pairs (parallel axes) go through the 2D
  circle/circle solve. No harness case exercises them.
- The sliver of a nearly smooth edge is admitted from 1e-9 rad on. Whether
  stage 2's Boolean pre-certificate accepts slivers this thin is open
  (theory §10.6).
- The two chamfer probes are checked as ad-hoc jobs
  (`tmp/fillet/a1/probes`). They are not in the case catalogue, and the
  Onshape verdicts are not yet in `fixtures/fillet/reference.json` as an
  `onshape` oracle. Both belong to the harness owner.

## Stage A2: the corner network (2026-09-24)

**Scope.** Stage A2 builds on the stage-1 stripes. At every vertex where
selected edges end or meet it computes the exact end of each stripe and the
corner patches (fillet.md §5.1 step 4):
- caps: a terminal edge ending on an unselected face;
- mitres: two blends meeting at a vertex of valence 3;
- chains: G1 continuations;
- sphere corners and chamfer corners;
- face consumption: full rounds, r equal to the face width, the dome.

It also names what it cannot build yet: setback corners, curved caps,
pinched faces and mitres that are not planar conics. Each gets a typed class
and reason.

The B-rep surgery (trimming the support faces, inserting the blend and
corner faces, new loops) is stage 3. So `run(job)` is still always a typed
refusal, never a wrong `ok`:
- the ladder's refusal, or the network's (corners first, then tips in stripe
  order, then consumed faces);
- when everything is admitted: `unresolved not-implemented stage-2 corner
  network admits <n> stripes, <t> tips, <c> corners, <m> consumed faces
  (edge:carrier ...); B-rep surgery is stage 3`.

The network as data comes from a third export, `network(job)`. The native
driver writes it to `<result>.network`.

### Files

| file | lines | content |
|---|---|---|
| `kernel/proto/fillet-kpart/corners.bend` | 1.1k | tips (cap, mitre, chain, corner), end curves (circle, ellipse, segment), corners (sphere with the exact rank test, chamfer triangle), consumption, the network verdict |
| `kernel/proto/fillet-kpart/main.bend` | 705 | stage 1 plus: the network once the ladder admits, the network text, `network(job)`, the stage-2 `run()` answer |
| `kernel/proto/fillet-kpart/bounds.bend` | 594 | stage 1; the corner construction moved to corners.bend |
| `kernel/proto/fillet-kpart/native.bend` | 122 | also writes `<result>.network` |
| `scripts/fillet/network.mjs` | 480 | independent float64 checker of the network, the cell volumes, and four constructed stage-2 cases (test infrastructure) |
| `scripts/fillet/ladder.mjs` | extended | exports the section integrals, checks the corrected chamfer triangle, and accepts the stage-2 `run()` answer |
| `test/fillet-a2-corners.test.mjs` | 167 | 8 focused tests |

The corner network adds about 1.2k Bend lines, inside the 1k to 2k estimate
for it in fillet.md §5.1.

### Design: every stripe end is a planar cut

A *tip* ends a stripe at a vertex. In v1 every tip is the stripe cut by a
plane:
- the cut plane;
- the two spring end points p1 (on support 1) and p2 (on support 2), each
  attached to an input edge it lies on or to a face;
- the exact end curve, which is carrier ∩ cut plane from p1 to p2 as a
  ranged curve of the format.

A stripe's spring (contact curve) on support i runs between the p_i of its
two tips. A closed edge (a rim) has no tips.

| end | cut plane | end curve | checks, refusals |
|---|---|---|---|
| cap | the cap face's plane | fillet: circle when the plane is ⟂ the spine, else an ellipse (minor r along d × n, major r/\|n·d\|); chamfer: segment. Rotation stripes: a meridian plane only (circle or segment) | the cap face must be a plane (a curved cap meets the blend in a space quartic: `not-implemented`); each spring must end on its cap edge (`overflow` past its far end, `vertex-blend` behind the vertex or off the edge); the far end itself is admitted (the cap edge is consumed) |
| mitre | fillets: through the spines' meeting point C, normal d_k − d_j (the bisector of two equal-radius cylinders with meeting axes). Chamfers: through the springs' meeting point on the shared face, containing the line where both chamfer planes meet | fillet: ellipse, centre C, minor r, major r / sin(θ/2) along d_k + d_j; chamfer: segment | both stripes translation, the shared face a plane (`not-implemented` otherwise: the mitre curve is not a planar conic). The springs on the shared face meet at P; the outer springs must end at the same point X of the third edge, else the mitre needs a setback patch (`vertex-blend`, the gap is named). Superseded for fillets with a trimmed mitre by the setback mitre (section "Fix: sphere-corner frame and setback mitres") |
| chain | through the vertex, ⟂ the tangent (a meridian plane for rotation stripes) | circle about the spine point, or segment | both stripes must give the same section (`vertex-blend` otherwise) |
| sphere corner | through the ball centre C, ⟂ the spine | great arc of the corner ball: the cylinder and the ball share it | the feet must lie on the springs |
| chamfer corner | through the two feet Q_a, Q_b of the stripe, as close to ⟂ the edge as the segment allows | segment Q_a → Q_b | – |

The same construction covers the trimmed and the extended mitre (FP08).
Stage 1 told them apart only by the third edge's convexity: the extended
ellipse arc lies beyond the vertex, and X still sits on the third edge (at
the boss root, 1 mm up the boss's vertical edge).

**Sphere corners.** Take three plane faces with outward unit normals n_i and
one convexity. The ball centre solves n_i·(C − v) = ∓r:
C = v ∓ r (n2×n3 + n3×n1 + n1×n2)/det. Before the solve, the rank of the
three faces' normals is tested exactly:
- det(n1, n2, n3) is computed on the job's own F32x2 words with
  `kernel/robust-predicates.bend` (signed base-4096 integers, every F32 word
  an integer times 2⁻¹⁴⁹);
- an exact zero is refused as `vertex-blend` (rank < 3, no unique ball).

A genuine trihedral vertex cannot have rank < 3, so no catalogue case reaches
the refusal. The test calls `det3` directly: (1,2,3), (4,5,6), (7,8,9) gives
exactly 0, and a determinant of 1e-13 gives +.

The feet T_i = C ± r n_i are the corner's vertices. Each stripe ends in the
great arc between its two feet.

**Chamfer corners follow Onshape (probe FP-b), which corrects stage 1.**
Stage 1 put the triangle's points on the three edges at distance d from the
vertex. That triangle has the right side (√2) and area (0.866 mm²) but the
wrong place. The FP-b face areas settle it:
- each chamfer face is 26.870 mm² = √2 × 19, a rectangle ending 1 mm before
  the corner;
- each box face at the corner is 361 = 19 × 19;
- ΔV = −29.3333 = −29.25 − d³/12.

So the triangle runs through the points Q_f where the two springs on each
face f meet (for the box, (19, 19, 20) and its two rotations, side √2). Each
chamfer ends in the segment between its two Q's. The three chamfer planes
would meet in a point (the catalogue's primary closed form, −29.25). The
triangle cuts off that point's tetrahedron, d³/12 (the `cornerTriangle`
alternative, which OCCT also builds). The stage-1 ladder text now carries the
corrected points as well.

**Face consumption.** A side whose width bound is `consumed` makes its face
vanish. A2 checks that the face is covered exactly:
- **merge (full round):** the other stripe has the same carrier; both
  springs end at the same points at every tip; the face has no other edge
  than the two stripes' edges and the cap edges their tips sit on. One blend
  face replaces both stripes (FP02 notch, FP04 full round: one cylinder
  each);
- **edge (r = face width):** the spring ends at the boundary edge's two
  vertices (a closed spring must be that circle edge: coaxial, same height,
  same radius). That edge becomes the blend's boundary (FP03: 5 faces);
- **axis (the dome at r = ρ):** a closed stripe whose face is the disc it
  closes;
- anything else, such as a spring that touches the far edge at one point
  only, is refused as `face-consumed` (the face would be pinched).

**Coplanar fragments.** A planar union leaves coplanar faces split by smooth
edges. Both the fragments case (plate top around the boss foot) and the boss
root have them at the vertex. Caps and mitres therefore accept "the same face
or a coplanar plane face with the same outward side" (`same_pf`). A tip point
on such a plane is attached to the stripe's own support face. The surgery
has to find the fragment that contains it.

### The network data (`wonky-fillet-network 1`)

```
wonky-fillet-network 1
case <id>
op fillet|chamfer
size <real>
tip <e> closed
tip <e> <v> cap|mitre|chain|corner-sphere|corner-triangle <with> cut <o> <n> p1 <vec> edge|face <id> p2 <vec> edge|face <id> curve <curve> range <t0> <t1> [trim <side> face <f> pm <vec> cut <o> <n> curve <curve> range <t0> <t1>]
tip <e> <v> refused <class> <reason>
corner <v> sphere <centre> <r> faces <f> <f> <f> feet <vec> <vec> <vec>
corner <v> triangle <o> <n> faces <f> <f> <f> feet <vec> <vec> <vec>
corner <v> refused <class> <reason>
consumed <f> merge <k> <j> | edge <k> <x> | axis <k> | refused <class> <reason>
verdict admit <n> stripes, <t> tips, <c> corners, <m> consumed faces | refuse <class> <reason>
end
```

- `with` is the cap face (cap), the partner edge (mitre, chain) or the
  vertex (corners);
- curves are those of the job format (`line o d`, `circle o n x r`,
  `ellipse o n x a b`), run from p1 at t0 to p2 at t1 (t0 < t1, the short
  arc);
- the triangle's normal points away from the material;
- reals are F32x2 words, so every target's network can be compared byte for
  byte.

### Evidence

Commands:

```sh
node scripts/fillet/network.mjs --probes --constructed    # network checker, 76 cases
node scripts/fillet/ladder.mjs --probes                   # stage-1 checker (unchanged cases, corrected triangle)
node --test test/fillet-a2-corners.test.mjs test/fillet-a1-ladder.test.mjs
node scripts/fillet/run.mjs --proto fillet-kpart --targets js,cpu1,cpuN,metal
```

**Network geometry** (MEASURED, `scripts/fillet/network.mjs`, float64,
independent of the Bend code; `out/fillet/fillet-kpart/network/summary.md`).
There are 0 issues on 76 cases: the 70 catalogue cases, the two Onshape
chamfer probes and the four constructed cases. Every admitted tip passes
these checks:
- its curve starts at p1 and ends at p2;
- 17 samples lie on the stripe's carrier and in the cut plane;
- p1 and p2 lie on their support faces and on the edge or face they are
  attached to, inside the edge's extent;
- fillet ends are G1 with the supports and sweep less than π;
- caps lie in the cap face;
- mitre and chain curves also lie on the partner stripe's carrier, with the
  same end points as the partner's tip;
- sphere-corner arcs lie on the corner ball, whose centre is at r from all
  three faces;
- chamfer-triangle feet lie on their faces and in the triangle's plane, and
  the triangle faces away from the material.

Counts:
- tips: 225 cap, 64 mitre, 40 chain, 51 sphere corner, 6 chamfer corner, 28
  closed edges;
- end curves: 274 circles, 20 ellipses (18 mitres, 2 oblique caps), 92
  segments;
- corners: 17 spheres, 2 triangles;
- consumed faces: 2 merges, 2 edges, 1 axis.

**Cell volumes** (MEASURED). The checker adds up the volume change from the
network alone:
- each stripe: the section area × the length between its two cut planes,
  taken along the generator through the section centroid. A prism cut by two
  planes has exactly that volume;
- rotation stripes: Pappus × the swept angle between their meridian cut
  planes;
- each sphere corner: (r/3) × Σ (the three face quads v, E_k, T, E_j) − Ω r³/3.
  Here E_k is where a stripe's cut plane meets its edge and Ω is the solid
  angle of the spherical triangle of the feet;
- each chamfer corner: the tetrahedra from the vertex over the three end
  triangles (E_k, Q_a, Q_b) and the corner triangle.

The cells tile the removed (or added) region because adjacent stripes share
their cut planes (mitres, chains) or end on the corner cell's faces.

Results:
- all 61 admitted cases agree with a closed form within the validator's
  1e-7 × input volume;
- the 51 with an OCCT result agree to ≤ 2.2e-11 × input volume;
- on the mitre cases the cells equal the closed form to 4e-15, while OCCT is
  3e-8 off (OCCT's own approximation of the mitre volume).

| case | ends / corners | cell ΔV | closed form | Onshape |
|---|---|---|---|---|
| pp-box-two-of-three-mitre-r2 | 2 cap, 2 mitre | −23.268443 | primary (3.6e-15) | – |
| pp-box-top-loop-r2 | 8 mitre (ellipses a = r√2) | −82.772884 | primary | – |
| pp-box-corner-3-r2 | 3 cap, 1 sphere | −50.165207 | primary; corner cell −r³(1 − π/6) | – |
| pp-box-all-edges-r2, corpus-probestab-all-edges-r1 | 8 spheres each | −154.100336, −60.466095 | primary (Steiner) | – |
| ch-plate-top-loop-0.42, ch-plate-both-loops-0.42 | 8, 16 mitre segments | −12.249216, −24.498432 | primary | – |
| ch-box-corner-3-d1 | 3 cap, 1 triangle | −29.333333 | `cornerTriangle` (not the primary −29.25) | FP16: −29.3333 (1.2e-12) |
| corpus-outline-chamfer-lines-arcs-0.42, corpus-r22-guide-outline-chamfer-0.42 | mitres + plane/cone chains | −13.645258, −14.107058 | primary | – |
| fl-slot-outline-r1 | 8 chains | −15.024803 | primary | – |
| hard-full-round-r5, corpus-notch-trial-r1.5 | caps, 1 merge | −107.300918, +5.794250 | primary | 2.4e-13, 4.4e-14 |
| hard-single-edge-r-equals-width-r10 | 2 caps, 2 faces consumed by edges | −214.601837 | primary | 2.6e-13 |
| pc-post-top-rim-sphere-r5 | closed, the top disc to the axis | −130.899694 | primary | – |
| hard-boss-root-concave-mitres-r1 | 8 extended mitres | +8.967555 | extended mitre, derived here: 40 r²(1 − π/4) + 4 r³(5/3 − π/2) | FP08: +8.9641, inside Onshape's range [8.217, 9.711]; OCCT's result is BRepCheck-invalid |

**Constructed stage-2 cases** (`A2_CASES` in network.mjs, built by the
kernel into `tmp/fillet/a2/cases`):

| case | what it drives | result |
|---|---|---|
| a2-oblique-cap-parallelogram-r2 | fillet ending on slanted side walls: ellipse caps (minor 2, major 2/\|n·d\| = √5) | admitted; −17.168147 = −20 r²(1 − π/4) (parallel walls keep the length 20) |
| a2-oblique-cap-parallelogram-d1 | the same chamfer: segment caps | admitted; −10 = −20 d²/2 |
| a2-setback-mitre-wedge-r1 | triangular prism: a 45° and a 90° edge meet on the bottom face | `vertex-blend`: the outer springs end 0.8195 apart on the third edge (setback patch). Since fix:fillet-kpart: admitted as a setback mitre, −26.468982 (slice integral) |
| a2-pinched-trapezoid-r5 | the spring reaches the trapezoid top's slanted back edge only at its end | `face-consumed`: face pinched at a point |
| (D-flat top edge, select edited in the test) | a line edge ending on the cylinder wall | `not-implemented`: curved cap |

**Admission** is unchanged against stage 1: no `must-refuse` case admitted,
no `ok` case declined, and the same five `either` cases admitted. All of
them are cases Onshape builds, and FP12's tangent edge is refused as Onshape
refuses it.

**Harness and timing** (run 3, final code, `node scripts/fillet/run.mjs
--proto fillet-kpart --targets js,cpu1,cpuN,metal`, Apple M5 Pro, load 6.6
at the start and 31 at the end because other workflows built at the same
time):

- Verdicts: declined 52, expected-refusal 18. `run()` still returns a typed
  refusal and never `ok`, because stage 2 builds no B-rep. All 70 cases ran
  on all four targets.
- The native `.network` sidecars from cpu1, cpuN and Metal are byte-identical
  to the JS network text on 70 of 70 cases (checked by `network.mjs`).
- Builds: cpu 19.2 s, Metal 765.8 s (stage 1: about 180 s; a C2 Metal build
  ran in parallel).
- Compute summed over the 70 cases: js 341 ms, cpu1 97 ms, cpuN 164 ms,
  Metal 8696 ms. The largest case is perf-comb (50 stripes): js 85 ms, cpu1
  45 ms, cpuN 77 ms, Metal 2519 ms.
- Run 2 hit a Metal `memory fault (machine stack overflow?)` on perf-comb.
  Making `tips`, `eats`, `corner_list` and the list searches in
  `corners.bend` tail-recursive (accumulators, `rev_onto`) fixed it. The JS
  network text is identical before and after on all 76 cases.

Checkers on the final code: `node scripts/fillet/network.mjs --probes
--constructed` finds 0 geometry issues on 76 cases; `node
scripts/fillet/ladder.mjs --probes` finds 0; `node --test
test/fillet-a2-corners.test.mjs test/fillet-a1-ladder.test.mjs` passes 19 of
19.

### Decisions taken in this stage (to confirm)

1. Tips are planar cuts only. Curved caps (quartics), mitres against
   rotation blends or on a curved shared face, and caps of rotation blends
   off a meridian plane are `not-implemented`, never approximated.
2. A mitre whose outer springs do not end at one point of the third edge
   needs a setback patch. That is refused (`vertex-blend`) with the gap
   named. (fix:fillet-kpart builds it for fillets with a trimmed mitre; see
   the last section.)
3. The chamfer corner is Onshape's FP-b triangle through the springs'
   meeting points. This corrects stage 1's placement on the edges.
4. A face is consumed only when it is covered exactly: a full round of one
   carrier, a spring on the whole boundary edge, or the dome. A face pinched
   at a point is refused (`face-consumed`); Onshape was not probed for it.
5. Coplanar fragments of one plane count as one face for caps and mitres.

### Open items and limits

- **No B-rep yet (stage 3, the surgery).** The network gives every new
  curve and point:
  - springs between the tips' p_i;
  - end curves: caps, mitres, chains and corner arcs, each shared by the
    stripes meeting there;
  - corner patches;
  - consumed faces.

  Stage 3 must:
  - cut the support faces' loops at the tip points: a cap edge is shortened
    to p_i; a mitre's third edge starts at X; the vertex is replaced by P, T
    or Q;
  - insert the blend faces (one per stripe, one per full-round merge) and
    the corner faces (sphere octant, triangle);
  - drop consumed faces and edges;
  - dedupe the shared curves into single edges.
- **Coplanar fragments.** A tip point on a fragmented plane is attached to
  the stripe's own support face, not to the fragment that contains it (at the
  boss root, P lies in the corner fragment). Stage 3 must locate the fragment
  or merge the fragments first.
- **Refused and later:**
  - setback corners (vertex blends): the triangular-prism mitre, mixed
    convexity (FP14 builds 3 cylinders and a torus), valence above 3;
  - caps on curved faces (quartics);
  - mitres against rotation blends;
  - faces pinched at a point.

  The overflow, notch and overlap cases Onshape builds (FP01, FP05, FP06,
  FP07, FP09, FP11, FP13) are still refused, as in stage 1.
- **Decisions without exact predicates.** Apart from the rank test, the
  decisions still use the 1e-9 mm band in F32x2: the mitre gap, spring on or
  past a cap edge, consumption coverage, chain agreement. The fillet.md §5.1
  risk stands. Every refusal names its numbers.
- **Full-round symmetry.** A merge is recorded from the lower edge index and
  assumes the partner sees the same consumption (it is the same metric, so
  it does in exact arithmetic).
- **The extended-mitre closed form is INFERRED here.** Onshape's FP08 value
  (+8.9641) is a mesh-based mass property; the cells' +8.967555 lies 3.5e-3
  away, inside Onshape's stated range. OCCT's result for this case is
  BRepCheck-invalid.
- **Harness owner (unchanged):**
  - the Onshape verdicts are not yet an `onshape` oracle in
    `fixtures/fillet/reference.json`;
  - FP15/FP16 are not catalogue cases;
  - the checkers read the probes directly (read only).

## Stage A3: the B-rep surgery (2026-09-24)

**Scope.** Stage A3 turns the admitted stripes (stage 1) and their corner
network (stage 2) into the result body (fillet.md §5.1 step 5):
- trims the support faces at the springs and the cap faces at the end
  curves;
- inserts one blend face per stripe (one per full round) and the corner
  patches (sphere octant, chamfer triangle);
- drops consumed faces (r equal to the face width, full rounds, the dome,
  and the faces a notch consumes);
- resolves overflow as a notch (Marc's decision of 2026-09-24): the blend
  keeps its surface and is trimmed by the neighbouring face or by the other
  blend;
- emits the body in the harness result format with every face exact
  (`tol 0`).

`run(job)` now answers `ok` with the B-rep when the ladder, the network and
the surgery admit the case. Otherwise it answers the first typed refusal. A
surgery that cannot close the shell answers `unresolved not-implemented
stage-3 surgery: <reason>`, never a wrong `ok` (see "Internal certificate").

### Files

| file | lines | content |
|---|---|---|
| `kernel/proto/fillet-kpart/surgery.bend` | 1788 | unify, support-face rewrite, blend and corner faces, full-round merge, valence-2 joins, vertex sweep, geometric edge pairing, result text |
| `kernel/proto/fillet-kpart/notch.bend` | 413 | overflow as notch: face notch (line or circle) and meet (two blends), their conditions and refusals |
| `kernel/proto/fillet-kpart/main.bend` | 792 | `solve = finish(solve0(j))`: solve0 is stages 1-2 plus the notch records, finish is the surgery; the bounds verdict consults the notches; `Out` carries the surgery input and result |
| `kernel/proto/fillet-kpart/corners.bend` | 1223 | cap tips of notched sides attach to the next cap edge (face notch) or the cap face (meet) |
| `kernel/proto/fillet-kpart/native.bend` | 126 | the Metal device call is `solve0`; `finish` (the surgery) runs on the CPU in the same compute phase |
| `scripts/fillet/crosscheck.mjs` | 69 | cross-check of two prototypes' harness reports (volumes, face counts, blend types) |
| `scripts/fillet/onshape-oracle.mjs` | 86 | the Onshape oracle in `fixtures/fillet/reference.json` (see "Harness changes") |
| `test/fillet-a3-surgery.test.mjs` | 280 | 10 focused tests |

Stage 3 adds about 2.3k Bend lines (surgery and notch) to the 3.2k of stage
1 and the 1.2k of stage 2.

### Design: faces as pieces, edges by pairing

Every output face is written as loops of oriented curve pieces, each with its
own end points: `Sg{curve, t0, t1, a, b}` runs along the curve from `a` at
`t0` to `b` at `t1`. The surgery never tracks edge indices through the
change. The vertices and edges are found at the end:
- **vertices:** all end points, sorted by x and swept with a window of
  1e-9 mm (the decision band of stages 1 and 2). Points within 1e-9 mm are
  one vertex;
- **edges:** the pieces are grouped by their vertex pair. Each piece is
  paired with the one piece that runs back over the same curve: reversed end
  vertices, and the points at a quarter and three quarters of the one equal
  to the points at three quarters and a quarter of the other (within
  1e-7 mm). Each pair is one edge, numbered in the order of its first piece.

So an edge computed twice, once from each side, becomes one edge. This works
because both sides compute it from the same data (the same tip points, the
same input curve). Geometric pairing also covers consumption by itself: when
r equals the face width, the blend's spring on the vanished face coincides
with the far edge of the neighbouring face and pairs with it.

**Unify.** A planar union leaves coplanar faces split by smooth edges, and
cap or mitre points can land in a neighbouring fragment (the stage-2 open
item). The surgery first merges coplanar plane faces joined by such edges
(same plane, same outward side; `C.same_pf`):
- the faces reachable through these edges form one group;
- the group's remaining uses are chained into loops. Exactly one candidate
  must continue each loop, else the merge is refused (two regions touching
  at a vertex);
- the outer loop is the one with positive signed area about the outward
  normal (∮ p × dp, exact for lines, circle and ellipse arcs). Exactly one
  loop must be outer.

The fragments case merges eight plate-top fragments into one face with the
boss footprint as its inner loop. The boss-root case does the same for the
face that holds its mitre points.

**Support faces.** Each loop of a (merged) input face is rewritten use by
use:
- a selected edge becomes its spring on that face. The face that used the
  edge forward is side 1, and the spring runs between the stripe's tip
  points at the use's two vertices. A closed stripe's spring is the full
  circle through its point on the meridian of the rim vertex;
- an unselected edge keeps its input curve, with each end moved to a new
  point (`newpt`), in this order:
  1. a notch point (see below);
  2. a tip point at that vertex attached to this edge (caps, mitres);
  3. a tip point at that vertex that lies on the edge: a chain's springs
     end on the smooth edge between two walls;
  4. a closed stripe's seam point on the edge (a cylinder's seam line below
     a filleted rim);
  5. the vertex itself.
- where the end of one piece differs from the start of the next at vertex v,
  the cap curve of a cap tip at v whose end points are exactly these two
  joins them (either way round). If there is none, the face is refused (the
  trimmed boundary does not close);
- pieces of zero length are dropped: an edge consumed by a spring at the
  face boundary, the dome's spring at the axis, a notch's collapsed edge;
- consumed faces (the network's `consumed` records) are dropped. A consumed
  face that is one of several merged fragments is refused.

Faces that received a cap curve get role `cap`, the others `support`.

**Blend faces.** For stripe k with start vertex vs and end vertex ve, the
loop is:
1. spring 2 from vs to ve;
2. the end tip's curve from p2 to p1;
3. spring 1 back from ve to vs;
4. the start tip's curve from p1 to p2.

The supports use spring 1 along the edge and spring 2 against it, as they
used the edge, so every spring pairs. A closed stripe (rim) gets a seam, the
section arc (a segment for a chamfer) on the meridian through the rim's
vertex: `[spring 1 reversed, seam S1→S2, spring 2, seam S2→S1]`, as the
input's cylinder faces and C2's tori do. The dome (the sphere at r = ρ) drops
its degenerate spring on the axis and keeps `[seam, spring, seam back]`.

Surfaces are the stage-1 carriers. Cylinders are re-framed with x pointing
away from the edge (from the edge towards the ball centre), so the
parameter seam lies outside the blend (the same point set). Tori keep x on
the rim vertex's meridian, where their seam edge is.

**Full rounds are one face.** A merge (stage-2 `consumed f merge k j`) joins
the two blend loops where the consumed face's springs were:
- blend k's loop without its spring on f, from that spring's end back to its
  start;
- then blend j's loop likewise.

That gives Onshape's single cylinder (FP02: 10 faces, FP04: 6).

**Corner faces.**
- The sphere octant is the three stripes' corner arcs, each run against its
  blend and chained. The sphere is framed on its bounding arcs (fix:fillet-kpart,
  last section): at an orthogonal corner one arc is the equator and the
  other two are meridians meeting at the pole, a corner of the patch; x points
  away from the patch, so the seam lies on the far side. (The first frame, x
  away from the vertex and the axis perpendicular to it, left two of the three
  arcs off the iso-lines.) The face sense comes from the foot normals
  (convex: natural).
- The chamfer triangle is the plane through the three Q points, with the
  network's normal pointing away from the material.

**Valence-2 joins.** Two pieces on one line (collinear, same sense) or one
circle (same centre, radius, axis and sense) that meet at a vertex of valence
2 become one piece before the pairing. Such vertices remain:
- where merged fragments leave collinear boundary edges (the fragments case
  goes from 56 to 36 edges and has no vertex of valence 2);
- where a full round's two cap quarter arcs meet (one semicircle).

**Lines** are written with a unit direction and arc-length parameters. The
STEP serializer writes `LINE` directions as unit vectors with magnitude 1, so
the first harness run, with `[0, 1]` parameters, had 41 wrong volumes.

### Overflow as notch (notch.bend)

A side whose contact leaves its face (stage-1 bound `overflow`, or
`blend-overlap` against another stripe's spring) keeps its blend surface.
The side is then bounded by the curve where the blend meets the
neighbouring geometry:

| kind | when (v1) | notch curve | consumed | neighbour |
|---|---|---|---|---|
| face notch, translation | contact passes the bound edge b (a line along the spine) of a strip support; N = the other face of b is a plane containing the spine direction | line: the section circle ∩ N's trace | the support strip | N is trimmed back (convex) or grows (concave) to the line |
| face notch, rotation | a full rim; b a coaxial circle bounding an annulus support; N a coaxial cylinder; the rim's and b's seams on one meridian | circle at the height where the section circle reaches N's radius | the annulus | N grows (concave rim) or is trimmed |
| meet | two fillets of equal radius with parallel spines overlap on the strip between them | line: the two section circles' crossing nearer the strip | the strip | none: the two blends share the line as an edge |

The notch point is the first crossing of the blend's section arc, from the
kept contact towards the overflowing one. Notched stripes must end in caps
(or be closed rims). The notch point then ends each end in its cap plane:
- the cap tip's point on the notched side attaches to the next cap edge (the
  cap face's edge at the far vertex w of the consumed support's cap edge).
  For a convex blend it must lie inside that edge; for a concave one on its
  extension behind w, because N grows;
- a meet attaches to the cap face.

In the surgery a notch end collapses the consumed support's cap edge onto
the notch point. For a face notch it also moves N's other edges at w there.
The bound edge b becomes the notch line or circle.

Still refused, with the stage-1 class and the reason:
- both contacts of one stripe overflowing: the must-refuse r12 and notch r6
  cases, and the chamfer d5;
- chamfer overflow;
- overlaps next to mitres (the short edge in a loop);
- neighbours that are not planes along the blend or coaxial cylinders;
- supports that are not a strip or an annulus.

### Internal certificate

The surgery never answers `ok` for a shell it could not close. These are
typed refusals (`not-implemented stage-3 surgery: …`, naming the piece or
vertex):
- a piece without exactly one partner running back over the same curve;
- a support loop whose trimmed ends cannot be joined by a cap curve;
- merged fragments that do not chain into one outer loop;
- a face that loses its outer loop in the trim;
- a consumed face among merged fragments.

The harness validator then checks the result independently: topology,
geometry on both faces, exact types, G1 springs, and OCCT's volume against
the closed form and the oracles.

### Evidence

Commands:

```sh
node scripts/fillet/run.mjs --proto fillet-kpart --targets js,cpu1,cpuN,metal   # harness, 71 cases, all four targets
node --test test/fillet-a3-surgery.test.mjs                                      # 10 tests (2 need uv for OCCT)
node scripts/fillet/network.mjs --probes --constructed                           # stage-2 checker, now notch-aware
node scripts/fillet/crosscheck.mjs --a fillet-kpart --b fillet-rollingball-tori  # A against C
```

**Harness** (MEASURED, final run on the final code,
local development evidence, `out/fillet/fillet-kpart/summary.md`;
Apple M5 Pro at a load around 6):

| | cases | pass | expected-refusal | declined / wrong / invalid / mismatch |
|---|---|---|---|---|
| `ok` | 53 | 53 | – | 0 |
| `must-refuse` | 4 | – | 4 | 0 |
| `either` | 14 | 10 | 4 | 0 |
| all | 71 | 63 | 8 | 0 |

- Every result is exact: no face states a tolerance, and every blend type is
  in the case's `blendTypes`.
- Worst geometric deviations: vertices off their curves 2.3e-13 mm, edges
  off their faces 1.6e-13 mm, spring angle 3.3e-8 rad (the resolution of
  `acos` near 1).
- js, cpu1, cpuN and Metal ran all 71 cases, and their result bytes agree on
  71 of 71. The native `.ladder` and `.network` sidecars equal the JS texts
  (checked by `ladder.mjs` and `network.mjs`, 0 issues).
- Volumes, as OCCT reads the result STEP:
  - all 57 cases with a closed form agree with it, 52 with an OCCT result
    agree with OCCT;
  - the largest deviations, 4.5e-9 × V, are on the all-edges boxes (8
    sphere corners). They are OCCT's integration of the trimmed sphere
    patches: the stage-2 cell volumes of the same network are exact, and the
    geometry is exact to 2e-13 mm.

**Against Onshape** (the primary oracle where probed; MEASURED ΔV errors on
the kernel's input):

| probe | case | A | ΔV error | faces A / Onshape |
|---|---|---|---|---|
| FP01 | corpus-notch-trial-r3 | pass (meet) | 2.7e-12 | 11 / 11 |
| FP02 | corpus-notch-trial-r1.5 | pass (full round) | 9.1e-13 | 10 / 10 |
| FP03 | hard-single-edge-r-equals-width-r10 | pass (both supports consumed) | 3.4e-13 | 5 / 5 |
| FP04 | hard-full-round-r5 | pass (full round) | 5.7e-13 | 6 / 6 |
| FP05 | hard-overlapping-blends-thin-wall-r1 | pass (meet) | 1.1e-13 | 7 / 7 |
| FP06 | hard-short-edge-in-loop-r1 | `blend-overlap` (next to mitres) | – | – / 11 |
| FP07 | hard-overflow-narrow-ledge-r0.4 | pass (notch, riser grows) | 1.1e-13 | 12 / 12 |
| FP08 | hard-boss-root-concave-mitres-r1 | pass (extended mitres) | 3.5e-3, inside Onshape's bounds | 15 / 15 |
| FP09 | hard-overflow-convex-small-face-r2 | pass (notch line) | 8.3e-8 (F32-rounded input) | 7 / 7 |
| FP10 | hard-near-tangent-ridge-178.9-r2 | pass | 1.2e-10 (input off nominal) | 8 / 8 |
| FP11 | fl-slot-one-line-no-propagate-r1 | `vertex-blend` | – | – / 7 |
| FP12 | hard-tangent-edge-selection-r1 | `tangent-edge`, as Onshape | – | refused / refused |
| FP13 | hard-concave-rim-overflow-r6.5 | pass (notch circle) | 6.8e-12 | 5 / 5 |
| FP14 | hard-mixed-convexity-corner-r1 | `mixed-convexity` | – | – / 12 |
| FP15 | ch-convex-120-hex-d1 | pass | 2.7e-12 | 9 / 9 |
| FP16 | ch-box-corner-3-d1 | pass (corner triangle) | 9.1e-13 | 10 / 10 |

A builds 12 of the 15 configurations Onshape builds, with Onshape's face
counts on all 12. It refuses FP12 as Onshape does. The three it refuses are
vertex blends or an overlap next to mitres, outside Marc's v1 scope.
OCCT builds 3 of these 15.

**Against prototype C** (MEASURED, `scripts/fillet/crosscheck.mjs` on the
final reports):
- **C tori:** both build 38 cases, and all 38 volumes agree (max |ΔV|
  5.9e-12 mm³). Face counts are the same on 37. The exception is
  `pc-post-base-concave-r1`, where A merges the coplanar bottom disc and
  annulus that the stepped union leaves (6 faces against C's 7).
- **C spline:** the same 38, and every volume agrees within C's stated
  approximation (max 1.5e-3 mm³).
- A builds 24 cases C refuses: mitres, corners, chains, fragments, full
  rounds, consumption and the notches. C builds none that A refuses.

**Stage-2 constructed cases:**
- the oblique ellipse caps give valid results: the parallelogram prism,
  fillet −17.168147 and chamfer −10.000000, both as closed form and by OCCT;
- the setback mitre and the pinched trapezoid stay refused (`vertex-blend`,
  `face-consumed`).

**Tests** (MEASURED): `node --test test/fillet-*.test.mjs` passes 44 of 44
(A1 11, A2 8, A3 10, C1 7, C2 8). The A1 and A2 tests and checkers were
updated for stage 3:
- `run()` now answers `ok`;
- the thin wall's overlap is a meet;
- notched sides end on their neighbour, not on their support.

**Timing** (MEASURED, final run, compute phase; the surgery runs in
`finish` on the CPU, also on the Metal target):

| case | js ms | cpu1 ms | cpuN ms | Metal ms |
|---|---|---|---|---|
| perf-comb-vertical-edges-r0.5 (50 stripes, 102 faces out) | 162 | 79 | 113 | 2565 |
| perf-hole-grid-rims-0.42 (16 rims) | 35 | 8 | 10 | 240 |
| pp-box-all-edges-r2 (12 stripes, 8 corners) | 26 | 5 | 8 | 222 |
| hard-fillet-after-boolean-fragments-r1 (unify) | 27 | 6 | 7 | 222 |
| all 71 cases | 835 | 176 | 244 | 9883 |

- Builds: cpu 43.6 s. Metal 1019.8 s: the device program is still stages
  1-2 (`solve0`), and the build time grows with machine load (stage 2
  measured 765.8 s).
- Against stage 2, the surgery costs about twice the stage-1/2 compute on
  JS (341 → 835 ms for all cases) and on cpu1 (97 → 176 ms).

### Harness changes made in this stage (for the harness owner)

The task text asked for the Onshape oracle and the chamfer probes as cases.
Stages A1 and A2 left both to the harness owner, and nobody else had done
them, so this stage did (all under `fixtures/fillet/**` and
`scripts/fillet/**`, extensions only):
- `fixtures/fillet/reference.json` has an `onshape` section
  (`scripts/fillet/onshape-oracle.mjs`, `--check` verifies it against the
  probes). The verdict rules use it; see harness.md "Onshape oracle" and
  "Verdicts".
- New case `ch-convex-120-hex-d1` (FP15). The catalogue now has 71 cases;
  the regenerated `cases.json` differs only by this case. Its fixture is
  built, and its OCCT oracle entry was written with `uv run
  scripts/fillet/reference.py --cases ch-convex-120-hex-d1 --dump
  out/fillet/oracle-occt/results` (OCCT −8.660254, agrees). FP16 maps to the
  existing identical case `ch-box-corner-3-d1` instead of a duplicate.
- Two validator refinements, both of rules that could not judge a correct
  result:
  - the "at least one G1 spring" rule is waived when no result face lies on
    a rolled-on surface any more (both supports consumed, FP03);
  - "no-op" needs a closed-form change above the volume tolerance (the
    ridge's −2.4e-5 mm³ is below 1e-7 × 6043 mm³).
- The validator self-test still gets 15 of 15 verdicts right.
- The runner summary shows the Onshape probe and the volume error against
  Onshape.

These change C's scores too: C2's ridge result becomes a pass instead of a
no-op, and C's results on `ch-box-corner-3-d1` must now be the corner
triangle. Please confirm.

### Decisions taken in this stage (to confirm)

1. **Faces as pieces, edges by geometric pairing** within the stage-1/2
   decision band (vertices 1e-9 mm, pairing samples 1e-7 mm). Every piece
   must pair exactly once, else the case is a typed refusal.
2. **Coplanar fragments are merged** before the surgery (only faces joined
   by smooth plane-plane edges of the same plane and side), and collinear or
   co-circular pieces meeting at a vertex of valence 2 are joined. The
   result has Onshape's face counts, not the input's fragments. The merge
   applies to every such fragment of the body, not only those at a blend:
   `pc-post-base-concave-r1` also loses the split between its bottom disc
   and annulus.
3. **A full round is one blend face** (Onshape FP02, FP04).
4. **Overflow as notch** as in the table above. Its limits in v1: planar or
   coaxial-cylinder neighbours, strip or annulus supports, cap ends only,
   fillets only, one overflowing side per stripe. Chamfer overflow, both
   sides overflowing and overlaps next to mitres stay refused with the
   stage-1 class.
5. **Blend surfaces are re-framed** (cylinder x away from the edge) so their
   parameter seams lie outside the face. Tori keep the seam on the rim
   vertex's meridian, where the result has its seam edge.

### Open items and limits

- **Refused and later** (all four are `either`, Onshape builds three):
  - vertex blends: FP11, the unselected G1 continuation; FP14, the mixed
    convexity corner (a torus); the setback mitre;
  - the overlap of a loop with a short edge (FP06: overlap next to mitres);
  - FP12 tangent edge (Onshape refuses too).
  Marc's v1 scope refuses vertex blends. The notch variants above are
  natural next steps (notch next to a mitre, chamfer notch).
- **Decision band.** The surgery adds two more decisions without exact
  predicates: the vertex merge (1e-9 mm) and the pairing (1e-7 mm). Exact
  configurations land about 1e-13 mm from their partners. A near-coincidence
  closer than 1e-9 mm that is not exact would be merged. Stages 1-2 already
  carry the same fillet.md §5.1 risk.
- **Onshape FP08.** A's boss-root volume is the extended-mitre closed form
  (+8.967555). Onshape reports +8.964084, which is 3.5e-3 away but inside its
  mass-property bounds [8.217, 9.711]; the face areas agree with the
  extended mitre (stage A2). OCCT's own result is BRepCheck-invalid.
  Unresolved; a finer Onshape mass-property query would settle it.
- **Kernel inputs off nominal.** Two fixture inputs carry F32-rounded sketch
  coordinates (the small face at y = 9.6000003815, the 178.9° ridge). That is
  why their ΔV differs from Onshape's by 8.3e-8 and 1.2e-10 while all others
  agree to ≤ 7e-12. The fix belongs to the fixture builder, not the
  prototype.
- **Performance.** The surgery is list work: an O(n log n) vertex sweep and
  pairing by sort, but O(n) list searches per use for tips, stripes and
  notch ends. It runs on the CPU after the device call.
- **No independent JS volume.** Volumes come from OCCT reading the STEP (as
  for every prototype), cross-checked against the closed forms, Onshape and
  prototype C. The network checker's cell volumes (stage A2) remain the
  Bend-independent check for the non-notch cases. (Closed by
  fix:fillet-kpart: `scripts/fillet/divvolume.mjs` computes every result's
  volume from its exact B-rep; see the last section.)

## Fix: sphere-corner frame and setback mitres (fix:fillet-kpart, 2026-09-24)

The independent verification (verify:fillet-kpart) found two defects. Both
are fixed at the root; each repro is in
`fixtures/fillet/adversarial-fillet-kpart.json`.

### 1. Corner balls framed on their arcs

**Defect.** `corner_sphere` set the axis to w × (foot − centre), with w the
direction to the vertex. Two of the three bounding great arcs were then no
iso-lines of the sphere. The STEP writer emits no pcurves, so OCCT's reader
builds them by projection: pcurve deviation 7.29e-7 > 1e-7 on
pp-box-corner-3-r2. Every sphere-corner result failed `validate-step.py`
(exact CurveOnSurface), and the STEP volume moved by 4.5e-9 V. The Bend
geometry itself was exact.

**Fix** (`surgery.bend`, `sph_axis3`, `corner_sphere`). Each corner tip's cut
plane is its arc's plane. The axis is chosen as follows:
- If one arc normal is perpendicular to the other two (every box or prism
  corner), that normal is the axis. Its arc is the equator. The other two
  arcs are meridians and meet at the pole, their common foot (a corner of
  the patch). OCCT frames its box-corner balls the same way (on
  pp-box-corner-3-r2: axis [0, −1, 0], x [0, 0, 1]).
- Otherwise (an oblique corner) the axis is the line where two arc planes
  meet, so those two arcs are meridians meeting at the pole. The pair is the
  one that leaves the third arc closest to the equator. No single frame makes
  all three arcs iso-lines here: meridians need their normal perpendicular to
  the axis, the equator its normal along it.

The axis is turned towards the patch; x is the patch's mid direction off the
axis, reversed, so the parameter seam lies on the far side of the ball.

The first draft of the fix used "the most nearly perpendicular normal" as
the oblique fallback. That put the pole near the non-iso arc: pcurve
deviation 5.9e-4 on the sheared box. The pair rule gives 4.6e-7. OCCT's own
blend of the same box, through the same writer, gives 6.5e-7
(`tmp/fillet/fix-kpart/occt_dump.py`), so the oblique case is a writer
limit (no pcurves), not a frame choice.

### 2. Setback mitres

**Defect.** Take a trimmed mitre of two fillets (the third edge has their
convexity) whose supports meet the shared face S at different angles, such
as the drafted prism's top loop. It was refused as `vertex-blend` ("outer
springs end 0.471478 apart"). Plane/plane mitres are in Marc's v1 scope, and
an exact result exists.

**Geometry** (`corners.bend` "Setback mitres", INFERRED here, confirmed by
the volumes below):
- Both spines lie r from S. So a point of the mitre curve (the ellipse in
  the bisector plane) has the same arc angle from S on both carriers.
- The blend with the smaller sweep (the short one) reaches its outer spring
  first, at P, inside its outer face F. The short blend ends in the mitre
  ellipse from the S point to P.
- The long blend runs over the same ellipse to P. Past P it meets F itself:
  it goes on over its carrier ∩ F's plane (a cap-type ellipse or circle) to
  Q, where its outer spring meets F on the third edge.
- F gains the trim edge P–Q.

This is the intersection semantics of the plain mitre: each slice parallel to
S is the input slice shrunk by the blends' offsets, with sharp mitred
corners. With equal sweeps P = Q = X.

**Network.** A long blend's tip carries `tr: Tr{f, side, pm, cut, arc}`: the
trim curve on the short blend's outer face f, from pm = P to the tip's point
on side `side`. The network text appends
`trim <side> face <f> pm <vec> cut <o> <n> curve <c> range <t0> <t1>` to the
tip line. Side 2: the tip curve runs p1 → pm, the trim pm → p2. Side 1: the
trim runs p1 → pm, the tip curve pm → p2.

**Checks.** Each is refused with the gap named:
- equal sweeps with a gap;
- a P outside the partner's outer face (`beyond`);
- a Q off the third edge (`tip_on`).

**Still refused** (typed `vertex-blend`, gap named):
- chamfer setback mitres: Onshape's chamfer mitre with unequal setback depth
  is not probed;
- extended setback mitres (third edge of opposite convexity, e.g. a drafted
  boss root): the trim would lie behind the vertex.

**Surgery.** The blend loop takes one or two pieces per tip (`tip_sgs`). The
short blend's outer face closes its loop at the vertex over the trim piece
(`conn` offers trim curves beside cap curves).

### Independent volume: `scripts/fillet/divvolume.mjs`

The previous open item "no independent JS volume" is closed.
`divvolume.mjs` computes a result's volume from its exact B-rep (divergence
theorem). Each face integral is reduced to Gauss-Legendre integrals over the
exact edges, for planes, cylinders, spheres and tori. Checked on:
- the input boxes (6e-12);
- the plain mitres (9e-13, 2.7e-12);
- the sphere corners (1e-11).

`network.mjs` uses it for every ok case:
- where the cells apply and nothing is notched, it compares the B-rep volume
  with the cells;
- for setback mitres, whose trims the cells do not cover, it compares with
  the closed forms;
- for every case with an Onshape probe, it checks the probe's range.

The notch cases are compared with Onshape only. Stage-2 cells do not model
notches; their B-rep volumes equal Onshape's to ≤ 3e-12.

### Evidence (MEASURED, 2026-09-24)

- **Catalogue, four targets:** `node scripts/fillet/run.mjs --proto
  fillet-kpart --targets js,cpu1,cpuN,metal --out out/fillet/fix-kpart/full4`
  gives 63 pass and 8 expected refusals; the targets agree on 71 of 71.
  Against the verification run, results change only for the three
  sphere-corner cases (byte comparison of the JS results).
- **STEP:** `node scripts/fillet/verify-step.mjs --run
  out/fillet/fix-kpart/full4` passes 60 of 63 (verification: 57 of 63). The
  three fixed cases are pp-box-corner-3-r2, pp-box-all-edges-r2 and
  corpus-probestab-all-edges-r1. The remaining three are the mitre-ellipse
  pcurve artefact of the writer: OCCT's own blends fail the same way.
- **Adversarial catalogue, four targets:** `node
  scripts/fillet/run-adversarial.mjs --file
  fixtures/fillet/adversarial-fillet-kpart.json --proto fillet-kpart
  --targets js,cpu1,cpuN,metal --out out/fillet/fix-kpart/adv4` (31 cases).
  - Totals: 15 pass, 10 expected refusals (all typed), 6 step-fail, 0 wrong;
    the targets agree on 31 of 31.
  - The three sphere-corner repros now pass including validate-step:
    adv-right-triangle-all-edges-20deg-r1,
    adv-pentagon-all-edges-flat-vertex-0.01deg-r1 and
    adv-far-1e4-box-all-edges-r2. The new adv-rotated-box-all-edges-r1 passes
    as well.
  - The trapezoid repro adv-trapezoid-top-loop-r1 is built: 10 faces (6
    planes, 4 cylinders), ΔV −11.1076260032 by divvolume (closed form
    −11.107626003199, error 2.2e-12).
  - The 6 step-fails are 5 mitre-ellipse cases (the trapezoid, far-1e6 top
    loop, L outline, wedge and pocket; pcurve deviation 2.2e-7) and the
    sheared box (its oblique-corner arc, see above). In all six the validator
    and the tight check are clean, and all faces are exact.
- **New repro cases** (generator `tmp/fillet/fix-kpart/gen-adv.mjs`, closed
  forms INFERRED here):

  | case | expect | closed form | result (divvolume error) |
  |---|---|---|---|
  | adv-wedge-setback-mitre-r1 | ok | −26.468981543859, slice integral | built (1.5e-12) |
  | adv-drafted-pocket-floor-loop-r1 | ok | +5.526396674091, slice integral (concave setback) | built (6e-13) |
  | adv-rotated-box-all-edges-r1 | ok | −31.280244880340, Steiner | built (1e-11), STEP exact-valid |
  | adv-sheared-box-all-edges-r1 | ok | −38.781969666860, Steiner | built (4.6e-12); STEP: oblique arc pcurve 4.6e-7 |
  | adv-trapezoid-top-loop-d1 | either | – | `vertex-blend` (chamfer setback) |
  | adv-drafted-boss-root-loop-r1 | either | – | `vertex-blend` (extended setback) |

  The Steiner calculator (`tmp/fillet/fix-kpart/steiner.mjs`) reproduces the
  verifier's right-triangle form exactly.
- **Network:** `node scripts/fillet/network.mjs --constructed --probes` finds
  0 issues on 77 cases. B-rep volumes: 54 of 59 ok cases agree with a closed
  form, and 12 of 12 lie inside Onshape's range. 10 of those 12 are within
  3e-12 of Onshape. The exceptions are the FP08 boss root (3.5e-3, the known
  extended mitre) and the small face (8.3e-8, its F32 input).
  a2-setback-mitre-wedge-r1 is admitted: its B-rep volume equals the slice
  integral to 2.1e-14.
- **Tests:** `node --test test/fillet-kpart-fixes.test.mjs` passes 4 of 4.
  With the pre-fix sources, 3 of the 4 fail (the chamfer refusal is
  unchanged by design). `node --test test/fillet-a1-ladder.test.mjs
  test/fillet-a2-corners.test.mjs test/fillet-a3-surgery.test.mjs` passes 29
  of 29.
- **Builds:** cpu 45.7 s; Metal 1322 s, under load from parallel builds.

### Open items

- **STEP pcurves (writer, not kpart).** The result STEP carries no pcurves,
  so OCCT's reader projects them. Two kinds of edge fail the exact
  CurveOnSurface check, in OCCT's own blends too:
  - ellipses on cylinders (mitres, setback trims);
  - an oblique corner's third arc.

  The fix belongs to the STEP writer (`src/`, owned by r20-gate): write
  pcurves.
- **Setback semantics are INFERRED.** Onshape was not probed for mitres of
  unequal sweep. The intersection semantics are those of Onshape's plain
  mitres, and the slice integrals confirm the B-rep, not Onshape. Proposed
  probes: the trapezoid top loop and the drafted pocket floor loop.
- **Still refused (typed):** chamfer setback mitres and extended setback
  mitres.
- **Trim containment.** The trim is checked at its ends only: P inside the
  partner's outer face, Q on the third edge. kpart does not check that the
  arc between them stays inside F. On the repro cases it is short and near
  the vertex. A very narrow F could let it cross another edge of F. The
  harness validator would see that, kpart itself would not. An exact
  arc-in-face test belongs with the setback checks.
