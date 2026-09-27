# Review: exactness and Bend feasibility of the khana design

Workflow `khana-design`, task `review-exactness`, 2026-09-24. Adversarial
review of [design.md](design.md) and [../khana.md](../khana.md) (with the
inputs [kernel-gaps.md](kernel-gaps.md), [inventory-printability.md](inventory-printability.md),
[doctrine-draft.md](doctrine-draft.md), local design note).
Lens: claims of exactness that cannot hold, primitives that cannot be written
under Bend 2.0.25, refusal semantics, AGENTS.md, parity-oracle soundness,
hidden dependencies on the uncommitted r20-gate work, package size.

Nothing outside `docs/khana/review-exactness.md` and the worklog was written.
No Python ran; the only computations were `git`, `grep`/`sed`/`diff` reads and
two `node -e` arithmetic checks.

**Revision 2 (resumed run, same day).** A second pass checked every citation
against the files. It changed four things: M1 is now blocker **B2**, because
the "seam rescue" it assumed for v1 carriers does not hold (two cylinders give
a counterexample, measured). The K4 row of M7 is withdrawn: `clear.bend` is
committed at HEAD. The K7/K16 row of M7 is downgraded to an acceptance note.
`src/volume.mjs` is marked [U] in m1. M10 gained one point (design.md:887-889).
design.md and khana.md have not changed since the first pass (mtimes 10:33 and
10:32, review 10:56).

**Labels.** **[C]** read in code or a document at the cited `file:line`
(line numbers of the working tree unless marked `HEAD:`; files marked [U] are
modified or untracked in `git status --short`). **[M]** measured by a command
named in the worklog local development evidence. **[I]**
my inference.

## Verdict

**Fixable.** The architecture (all predicates in Bend, tri-state verdicts,
witnesses with identities, labels, a length tolerance instead of a volume
epsilon) survives the review. But two things at the base of C1 do not work on
the geometry wonky actually produces: `touching` cannot be certified on placed
parts (B1), and the adopted crossing detection misses overlapping curved
faces and would give a wrong `pass` (B2). Several "exact" and "complete"
claims are false as written, K14 and K15 depend on uncommitted r20 print-mesh
code although the plan marks them "r20: no", and five packages are too large
for one checkpointed run. None of this needs a different architecture; all of
it needs to be fixed in the design before K3/K4 start.

| severity | count |
| --- | ---: |
| blocker | 2 |
| major | 11 |
| minor | 10 |

## Findings

### B1 (blocker). `touching` cannot be certified on placed parts; `overlapping` has no working definition

**Claim.** design.md:257-258: "two boundaries closer than [`contact_mm`],
with a certified non-crossing configuration, are `touching`";
design.md:410: touching = "`d ≤ contact_mm` and the contact certificate
proves disjoint interiors"; design.md:411: overlapping = "the boundaries cross
transversally (interiors intersect deeper than `contact_mm`)";
design.md:448 expects a face-touching pair rotated together by 7° … 89.9° to
read `touching`, "the rotation's regularization bound enters `contact_mm`";
design.md:526 "the transform's regularization bound is part of the distance
interval, never hidden".

**What the code does.**

- The contact certificates are exact zero tests of expansions on the
  represented words: `coincidence_certificate` and `tangency_certificate`
  (`kernel/intersections.bend:253-266` [C]). There is no tolerant variant.
- Placing a part moves its words in F32x2. Every rotation, and every
  translation of a body that is not a freshly extruded prism (a Boolean
  result, a clone, an import), takes the F32x2 transform; the comment records
  a 2.9e-14 mm offset that made the planar arrangement refuse a flush contact
  (`src/kernel.mjs:137-148`, `:214-235` [C]). One unit in the last place of
  F32x2 at 10 mm is 3.55e-14 mm [M].
- No transform bound exists: "Rigid copies carry both fields unchanged
  (transformInBend, transformAnalytic)" (`src/exactness.mjs:15-16` [C]);
  `transformAnalytic` records no rounding (`src/analytic.mjs:140-166` [C]).
- A cone stores its half-angle as the output of the 20-term `R.atan` series
  (`HEAD:kernel/analytic.bend:16`, `:354-355` [C]), so a cone's normal is
  never exactly the design normal and an exact cone-plane tangency certificate
  practically never fires.
- The oracle probe that design.md:448 cites rotates both boxes with one joint
  (`tmp/khana/oracle/probe/numerics2.py:24-31` [C]); in wonky the two contact
  planes are then two independently rounded planes.

**Consequence [I].** A flush contact between two placed Boolean results (lid
on housing, part on plate, the pose ghosts) typically differs by 1e-14 mm.
The certificate says "not coincident", so the pair is not `touching`; the
crossing is far shallower than `contact_mm`, so by design.md:411 it is not
`overlapping` either; the pair falls to `unresolved`. The same happens to
every cylinder or cone tangency that was not built from the same literal.
`assert_no_interference` (183 customer sites) and `expect_contact` would be
`unresolved` on most real assemblies, and C2, C3, C4 inherit it. If an
implementer instead reads "crossing" as `overlapping`, the same pairs become
false `fail`s. "Depth" is only defined for "analytic families"
(design.md:411), so "deeper than `contact_mm`" is undecidable for a general
crossing.

**Fix.**

1. Define the relations by witnesses under the one stated tolerance:
   - `overlapping` iff there is a certified point `p` inside both solids
     with `dist(p, ∂A) > contact_mm` and `dist(p, ∂B) > contact_mm` (a witness
     ball). Q4 plus the point-to-body distance of Q6 certify it; the witness is
     reported.
   - `touching` iff the boundary distance is `≤ contact_mm` and a *tolerant*
     contact family proves that no such witness exists: near-coplanar opposed
     faces whose signed separation over the overlap region stays within
     `±contact_mm` (evaluated at the overlap region's vertices, closed form
     for planes), near-tangent cylinder/cone/plane pairs with `|d − r| ≤
     contact_mm` along the contact line. Report "touching within
     `contact_mm`", not "certified disjoint".
   - everything else `unresolved`.
2. Evaluate every pair in the frame of one of the two parts through the
   relative transform. Parts moved by the same joint or `Location` then have
   an exactly identity relative transform and the rotated probe becomes exact.
3. Where a real relative rotation remains, derive its bound in Bend
   (orthonormality defect of the F32x2 matrix times the coordinate magnitude
   plus the translation rounding) and add it to that pair's `contact_mm`.
   Put the derivation into K4's scope and a test into K5's acceptance (the
   rotated row of design.md:448 plus translated Boolean results with
   decimal offsets).

### B2 (blocker; M1 in the first pass). Crossing detection misses overlapping curved faces: wrong `pass` in v1

**Claim.** design.md:415-419 adopts kernel-gaps.md §6-7: "the distance (Q6)
decides `separated`; for zero distance one membership test per direction
(Q4) decides `contained` against crossing". kernel-gaps.md:598-606 does not
enumerate "continua" and argues that the minimum of a continuum is also
attained on a lower stratum ("its relative boundary lies on a trim
boundary"); kernel-gaps.md:607-610 then decides `Nested` against `Separated`
with one vertex membership test when `lo > 0`. K4's acceptance
(design.md:1282-1285) plans property tests of this "lower-strata argument".

**Why it fails.** A transversal crossing along a *closed* intersection curve
that lies in the interior of both faces touches no edge. No lower stratum then
has distance 0, `lo > 0`, the vertex test finds every vertex outside the other
body, and the pair is `Separated`: a wrong `pass` of `assert_no_interference`
(183 customer sites, design.md:132).

The first pass of this review claimed that v1 carriers are rescued because
full periodic faces carry an explicit seam edge (`HEAD:kernel/analytic.bend:289`,
working tree `:317` [C]) and every plane/cylinder/cone intersection curve
crosses a seam. That is false. Counterexample, all v1 carriers [M, `node -e`,
worklog step 8]:

- A: boss, cylinder r = 10, axis z, z ∈ [−10, 10]. B: pin, cylinder r = 3,
  axis x at y = 11, z = 0, x ∈ [−20, 20]. The pin clips 2 mm into the boss.
- Overlap is real: (0, 9, 0) lies inside both, 1 mm from both boundaries.
- The intersection is one closed loop with |x| ≤ 6, |z| ≤ 2.83. On B it spans
  the angles 109.5° to 250.5° (measured from +y); on A it spans 53.1° to 126.9°
  (measured from +x). It winds around neither axis.
- With A's seam at +x and B's seam at +z, every lower stratum stays away: A's
  seam is 8.0 mm from B, B's seam is 1.0 mm from A, A's rims are 7.05 mm from
  B, B's rims are 11.54 mm from A.
- With the seams at +y (A) or −y (B), a seam pierces the other face and the
  crossing is found. So the verdict depends on the seam direction, which is
  not a geometric property.

The same holds for any cylinder, cone or (in K17) sphere and torus pair where
one face partially penetrates the side of the other: a pin clipping a boss, a
screw head clipping a rounded rib, a sphere cap cut by a plane whose seam
meridian and poles lie outside the cap.

**Fix.** Add an explicit face-face crossing test before the nesting test in
K4: for every face pair whose conservative bounds overlap (Q2), intersect the
carriers and test a point of each intersection component against both trims.
Plane with plane, cylinder or cone: closed-form lines, circles, ellipses, and
hyperbola or parabola arcs. Cylinder-cylinder and pairs with cones: the
existing `kernel/intersections.bend` families where they apply, otherwise a
1-D search of the second carrier's implicit function along a parametrized
curve of the first: a sign change proves a crossing, exclusion (as in M8)
proves its absence. A pair whose crossing cannot be decided is `unresolved`,
never `separated`. Replace "property tests of the
lower-strata argument" in K4's acceptance by named cases: the boss and pin
above with both seam placements, a pin through a plate without a hole, a
cylinder through a tube wall.

### M2. Cone-cone and cone-torus distances are not 1-D problems

design.md:339 labels Q6 "`bounded` (certified 1-D search)" wherever no closed
form exists, following kernel-gaps.md:660-664: "1-D over one generator angle
with the line-X closed form". For X = cone or torus there is no closed-form
line-X distance (kernel-gaps.md's own table lists line-circle as a quartic and
edge-cone as a 1-D search), so the interior face-face minimum is a 2-D search.
Cone faces are everywhere in the house style: the 0.42 mm chamfer ring on a
circular edge is a cone (doctrine-draft.md, section 7 table), so two parts
with chamfered rims near contact produce cone-cone cell pairs [I].

**Fix.** Either a nested certified search (outer over the generator angle with
Lipschitz constant `ρ_max`, inner over the line parameter with the point-cone
closed form, both with fuel) with its width in the record, or an explicit
`unresolved` for face-interior cone-cone and cone-torus pairs in v1, listed in
K4's coverage table. Correct kernel-gaps.md:662-664.

### M3. The bridge width (Q10) is the wrong quantity

design.md:601-602 defines the bridge width as "the minimal width of R
projected on the plane normal to `u`", computed by "rotating calipers over
line and arc boundaries" (design.md:343). Rotating calipers give the width of
the convex hull.

- **Short horizontal bores fail.** The projected ceiling band of a horizontal
  bore is a rectangle chord × bore length. When the bore is shorter than its
  chord, the minimal width runs along the axis, and both ends of that width
  are the bore mouths (air), so the band is a cantilever and fails
  (design.md:603-608, "A cantilever … is never a bridge"). A Ø6 bore through a
  3 mm wall has a 4.24 mm chord at α_max = 45° [M]: every horizontal screw
  hole through a thin side wall becomes a false `fail`, which cad_khana's
  exemption passes. design.md:610-617 silently assumes long bores;
  khana.md §5 claims "für … jede Lage richtig".
- **Non-convex regions fail.** An L-shaped or arc-shaped 6 mm slot ceiling,
  or an annular ring, has a convex-hull width far above its local span: false
  `bridge-too-long`.

**Fix.** Define a bridge by an anchored direction: R is a bridge iff there is
a direction `d` such that every chord of R parallel to `d` ends on anchored
boundary at both ends and is at most the span. For a cylinder or cone band `d`
is circumferential (chord `2r sin(half band)`, independent of the bore
length); for a planar ceiling the candidate directions are the normals of
anchoring edge pairs (closed form for line and arc anchors). This also removes
the heaviest Bend module of K3 (convex hulls of arcs). Define "anchor length"
(edge length or material depth; the 0.4 mm wall example of design.md:637
uses wall thickness, which is a C7 quantity, so K8 would depend on K9).

### M4. The wall decision is not complete: adjacent and self face pairs stay `unresolved`

design.md:655-672 bounds every wall chord from A to B below by the distance
between A and B and claims "Coverage is complete by construction". The
distance is 0 for two faces that share an edge and for a face with itself.
The design resolves only knife edges (dihedral below 60°, design.md:679) and
the convex cylinder's own diameter.

- A full-round rib or fin tip, a U-bend, a rounded latch hook: the
  half-cylinder is tangent to both side planes, its normals span 180°, so it
  is "not provably on the outward side" and its normal cone allows opposition
  (design.md:657-659). Distance 0 on the shared edge → "minimum on an edge"
  → `unresolved`, with no ray channel by default [I].
- A cone's own chords (tapered pins, pointed tips) have no closed form in the
  list.
- K9's acceptance "coverage complete on all v1 parts" cannot hold.

The fail witness is also not certified: "after Q4 checks that it runs through
material" (design.md:663-666) tests a point, not the segment; another face may
cut the double normal.

The knife-zone width contradicts the design's own chord definition: a chord
along A's inward normal gives `0.5 / tan θ` = 0.50 mm for a 45° knife, the
bisector formula `0.25 / tan(θ/2)` of design.md:683 gives 0.60 mm [M].

**Fix.** Restrict B to its *opposed sub-band* with respect to A's normal cone
before the distance bound (the same angular band machinery as C6; for a
tangent half-round the opposed band starts 120° from the shared edge and the
distance is positive and closed form). Add closed-form self chords for cones.
Certify a fail witness with Q5 segment hits on trimmed faces (exact for v1).
Pick one knife-zone definition. The same sub-band fix removes false zero air
gaps at V-grooves (design.md:689).

### M5. Motion cannot prove pairs in persistent contact

design.md:512-519 proves an interval clear if `lo − displacement ≥ min −
decide`. For a pair that stays in contact over the range (flush knuckle faces
perpendicular to a hinge axis, a lid sliding on a rim, a slider on a rail) the
distance is 0 everywhere, so no interval is ever proven. The result is
`unresolved` after the fuel runs out, although nothing collides [I]. The
doctrine maps the insertion path to C4 (doctrine-draft.md, section 4 table),
and insertion paths are exactly such sliding contacts.

Q11 is also over-specified: design.md:344 promises `exact` maximum distance
from an axis including "circle extremes", which is a quartic for a circle
that is not coaxial or perpendicular to the axis [I]. The motion bound only
needs an upper bound (`dist(centre, axis) + r`, box corners).

**Fix.** Before bisecting, remove contact families that the joint leaves
invariant (a plane perpendicular to a revolute axis, a cylinder or cone
coaxial with it, a plane parallel to a prismatic direction) with their own
certificate, and apply the displacement bound to the rest. Otherwise say
explicitly that sliding contacts are out of v1 scope. Make Q11 an upper bound.

### M6. Plane sections (Q9) do not cover cones

design.md:342 lists Q9 as existing, `exact`, with v1 coverage "all".
`kernel/face-plane.bend:156-167` (`prepare_surface`) and `:669-688`
(`face_supported`, `face_allowed`; `HEAD:` `:156-167`, `:665-672`) accept only
planes and cylinders and answer
`UnsupportedSurface` otherwise; `kernel/section.bend:192-203` knows
orientation families only for planes and cylinders [C]. The first-layer
islands of C6 (design.md:594-596), C11 and the drawings (K19) refuse on every
part with a chamfer ring on a circular bottom edge, which the house style puts
on almost every part. A cone cut by a tilted plane also gives hyperbola or
parabola arcs, which the curve set `Line | Circle | Ellipse` cannot hold
(`kernel/analytic.bend:8-11` [C]).

**Fix.** Put cone sections (circle, ellipse; hyperbola and parabola refused by
name) into K3 or K8 and correct the table.

### M7. Hidden dependencies on uncommitted r20 work

The plan says only K17 and K18 need the r20-gate (design.md:1203-1224). Not so:

| package | dependency | evidence |
| --- | --- | --- |
| K14, K15 | the per-part certified print mesh and its achieved deviation (design.md:1095, :1400) | committed `HEAD:src/print-mesh.mjs:128-150` covers only bands and discs (refuses trimmed arcs, straight edges on curved faces, other edge types); the broader coverage is the uncommitted task-7 work (`git diff --stat src/print-mesh.mjs`: 558 insertions, 124 deletions) [C] |
| K17 | the "spherical void" rows (design.md:704, K17 acceptance) | not r20 at all: a void needs a multi-shell body format (kernel-gaps.md P7, open question O7); `HEAD:src/boolean.mjs:205` refuses enclosed voids |

Not a hidden dependency, but path coupling (corrected in revision 2): K4's
BVH and join are "from `clear.bend`" (kernel-gaps.md:592, `:723`). The first
pass called that file untracked. It is committed at
`HEAD:kernel/proto/recover/clear.bend` (699 lines, commit `aa84b76`), and the
untracked `kernel/hybrid/recover/clear.bend` is byte-identical to it (`diff`
empty [M]). The r20 work deletes the committed path (`git status`:
` D kernel/proto/recover/clear.bend`), so K4 must copy the Morton tree
(`:255-355`) and the join (`cross`, `:519-560`) into `kernel/measure/` and
must not import either path.

Acceptance note: K7 and K16 name R20 geometry ("T01 ±50 against R59B-Mitte",
an R20 scene subset). Both already scope that to geometry that builds
(design.md:1325, :1425-1426), so they are not hidden dependencies. They do need
one non-R20 fixture each so that the package can be accepted before r20
lands.

**Fix.** Mark K14 and K15 as r20-dependent, or scope them to the committed
print mesh with named refusals. K4 copies the BVH code as above. Give K7 and
K16 a non-R20 acceptance fixture. Move the void rows to a body-format
package.

### M8. Torus overhang and torus ray roots are not exact

design.md:589 states "spheres a cap and tori a band (K17)". The source
(inventory-printability.md, section 5.2 torus bullet) says that only holds for
`u` parallel to the torus axis; for a tilted `u` the region is a level set of
a trigonometric polynomial that needs quadrature. Under design.md:229-243
quadrature is `estimate` and can never pass, so a torus fillet in any
non-axial orientation (every C11 candidate but one) stays `unresolved`.

Q5's torus roots (design.md:338, "certified roots") rest on kernel-gaps.md:710-711
("search sign changes of the implicit function along the line"). A sign-change
search misses a tangent (double) root and two roots within one interval; a
ray-parity membership test then flips inside and outside [I].

**Fix.** State torus coverage as "axis parallel to up" (otherwise `refused`)
until a proven quadrature bound exists. Isolate roots by exclusion (`|f(mid)| >
L·w/2` drops an interval) and report intervals that can be neither excluded
nor shown to change sign as `unresolved`.

### M9. The parity oracle compares different geometry and has an open escape hatch

design.md:1136-1194:

- It compares wonky's values on wonky-built geometry with OCCT's values on
  OCCT-built geometry from the same script. The two bodies differ (F32x2
  placements, F32-quantized sketch profiles, `src/exactness.mjs:20-30` [C]),
  so a mismatch cannot be attributed. AGENTS.md line 4 allows OCCT only "to
  independently validate exported test artifacts"; OCCT numbers on OCCT's own
  geometry are neither.
- "Intended differences" can absorb any mismatch with a reason string.
- Hand-written expectations were already wrong once: `O/oracle.py:104` said
  5.0 where the exact wall is 2.0 (inventory-printability.md, section 7
  correction [C]).
- G2 is an uncommitted upstream worktree. Its provenance is the frozen copy
  `tmp/khana/oracle/printability/src_g2/`, not "tool version" (design.md:1191-1193).

**Fix.** Make the primary oracle the independently derived closed forms the
case tables already state (0.25, 157.08, 2.0, 8.485): every intended
difference must name the closed-form value that replaces cad_khana's. As the
secondary oracle, let OCCT measure wonky's *own exported STEP* (distance,
volume, area), which AGENTS.md allows and which compares the same geometry.
Keep cad-khana's JSON as a behavioural reference only. Freeze the `src_g2`
tree hash with the fixtures.

### M10. Refused values become `None` in Python, weaker than today's `NotRun`

design.md:547, :1023, :1797 and Appendix A: refused facts are `null` in the
JSON and `null`-valued fields on the Python records. Today a result that does
not exist raises a latched capability error at *any* use
(`python/cad_khana/_wonky.py:58-111`, `src/python.mjs:1009` [C]). With
`None`, `if diag.parts["lid"].volume_mm3:` silently takes the "falsy" branch
and arithmetic raises a `TypeError` instead of a capability error: an invented
falsy result [I].

The verdict itself is also blurred at the Python API (revision 2):
design.md:887-889 gives a check whose primitives do not cover the geometry
the verdict `refused` but `.status == "unresolved"`. The JSON and the exit
code (2, design.md:1080-1081) keep `refused` apart, but a model that branches
on `.status` cannot tell "wonky cannot answer this" from "the answer lies
inside the tolerance band". AGENTS.md line 6 wants unsupported functionality
to surface as a capability error [C].

**Fix.** A latched `Refused` value object in Python, built like `NotRun`
(JSON keeps `null` plus the capability entry). `.status == "refused"` for a
refused check, never `"unresolved"`. The FeatureScript wrappers
(`evDistance` and so on, design.md:946-952) raise the capability error
for a `refused` result and for a `bounded` one wider than the query
tolerance.

### M11. Geometric measurement and comparison in the host

design.md:319 and :393 say "every comparison of a geometric quantity against
a threshold happens in Bend" and "the host never computes a distance, an angle
or an area". But:

- K1 serves "the part facts that exist today" (design.md:1233-1235). For
  polyhedral bodies these are the JS binary64 triangulation sums of
  `src/brep.mjs:184-194` (volume, area, bounds) [C], and they would be
  labelled `exact`. `assert_interference(max_mm3=)` would gate on them.
- The host compares waiver budgets and their growth (design.md:787-791),
  diffs within tolerance (section 8), builds the orientation Pareto set
  (design.md:768-770) and predicts fits from calibration (design.md:573-577).

design.md:542 is also too pessimistic: committed Bend already measures planar
Boolean results (`HEAD:kernel/halfspace.bend:599` `volume`, `:918`
`measured`; `kernel/boolean.bend:263`; `kernel/ports/curved-metrics.bend:185`
[C]), and `transformAnalytic` preserves those volumes (`src/analytic.mjs:152-166`).

**Fix.** Source C5 facts from the Bend measurements. Label the
`src/brep.mjs` values `estimate`, or move them into Bend, before anything
gates on them. Restate the rule as "every predicate and measurement in Bend;
the host only combines Bend-issued verdicts and intervals", or pass the budget
comparison into Bend (it is trivial).

### M12. Five packages are larger than one checkpointed run

Each change of a Bend evaluator module costs 15 to 27 s and 3 to 7 GB to
compile (`docs/language.md:54` [C]). Modules must be split by pair family
because of the arity limit (`docs/hybrid-boolean-plan.md:292-295` [C]).

| package | why it is too large | split |
| --- | --- | --- |
| K3 | six primitives (Q1, Q2, Q3, Q4 cone classifier, Q10, Q11) in at least four new modules; the cone classifier alone is comparable to `cylinder-classification.bend` (458 lines, kernel-gaps.md:725) | K3a face facts and bounds (Q1, Q2, upper-bound Q11); K3b convexity (Q3); K3c cone membership (Q4); Q10 is replaced by M3's anchored-direction test inside K8 |
| K4 | foot, search, pairs, cells/BVH, distance, contact, solid semantics, native wiring, plus B1's tolerant contact and transform bound and B2's face-face crossing test | K4a point and edge closed forms plus the 1-D search; K4b cells, B&B join, face-face crossing test, body distance with nesting; K4c tolerant contact, relative frames, transform bound; K4d native ops |
| K8 | bands with trim clipping, bridge and anchor, bed, first-layer islands (needs M6's cone sections) | K8a bands, trims, bed; K8b bridges and islands |
| K9 | pair enumeration, opposed sub-bands (M4), double normals, knife edges, air gaps, ray channel | K9a walls with sub-bands; K9b knife edges, air gaps, ray witnesses |
| K17 | curved INTERSECTION volumes, volume moments, sphere and torus in Q1 to Q6, C6 and C7 | three packages: volumes and centroids; sphere and torus primitives; sphere and torus in C6 and C7 |

K7 is "M: one Bend module over K4" (design.md:1327), but with M5's invariance
certificates and B1's transform bound it is at least L [I].

### Minor findings

- **m1. "Exact" is an allowance, not a proof.** `kernel/real.bend:1-155` has
  no interval type and no directed rounding. `atan`, `sin` and `cos` are
  truncated series with no remainder term (`:89-155`), and there is no `asin`
  or `acos`. The kernel's precedent is a stated allowance
  (`src/volume.mjs:121` [U, untracked r20 work], "2^-38 x the summed face flux
  magnitudes"; committed: the construction allowance of `src/kernel.mjs:212`
  `requiredMm <= allowanceMm`). So the
  "certified"/"proven" wording of design.md:66 and :151 overstates what
  `exact` (design.md:234-238) delivers. Practical risk is low (decide_mm =
  1e-6 is about six orders above the F32x2 error) [I]. Fix: derive the
  allowance per primitive (double-single operation bounds, series
  remainders, the 48-bit π in `reduce_angle`). Keep gate predicates
  polynomial where possible (`−n·u` against `sin α_max`, squared distances,
  expansions), and write "closed form + stated allowance".
- **m2. Clearance at a tiny `min_mm` passes overlapping parts.**
  design.md:428 passes `assert_clearance` when `lo ≥ min − decide`. With
  solid distance 0 for overlapping and contained pairs, any
  `min_mm ≤ decide_mm = 1e-6` (including 0.0, as in the probe
  `numerics2.py:30`) passes an overlap. Fix: add "relation is `separated` or
  `touching`" to the pass rule. Related: design.md:445 "each gap exactly" is
  wrong, because `Location((10 + g, 0, 0))` (`numerics.py:84-86`) is not
  exact in F32x2. The pass comes from `decide_mm`, and gaps at or below
  `contact_mm` read `touching`.
- **m3. Exact signs near tangency.** Q3's "exact sign from (n1 × n2)·t"
  (design.md:336) almost never yields an exact zero on F32x2-built tangent
  fillet edges, so "smooth" needs a stated angular tolerance, and C8's "sharp"
  or "not filleted" needs an angle threshold. The same holds for Q12 exact
  coaxiality (design.md:345): coaxial bores computed separately will not
  group.
- **m4. Existing bounds are overlooked.** design.md:335 says Q2 exists only
  for frusta and polyhedra. The committed `kernel/face-bounds.bend`
  (conservative directional face bounds) and `kernel/curve-band.bend` exist
  [C], and they are exactly what the C2 broad phase needs.
- **m5. Void citations are inconsistent.** design.md:205 and :738 cite
  `src/boolean.mjs:78-81`, the uncommitted recovered-body refusal. The
  committed guards are `HEAD:src/boolean.mjs:205` and
  `HEAD:src/analytic.mjs:280` [C]. design.md:704 ("block with a spherical
  void: exact after K17") contradicts "voids cannot exist".
- **m6. Legacy switch-offs stay silent in `.status`.** Compat part-scope
  waivers (design.md:796-801) still give `.status == "ok"` to the 26 readers
  while hiding real area (directive item 4). Fix: at least print a stderr
  WAIVED line with the hidden area on every run, and make `--strict` the
  default on a date.
- **m7. Exports after a failing check are not marked.** Run to completion
  (design.md:873-882) lets model code after a failing `inspect()` write its
  STL, where cad_khana's `SystemExit` stopped it. Fix: record the part's
  verdict per export in `.wonky-run.json` and in the stderr summary.
- **m8. C9 checks only against the main body.** C9 classifies extra bodies
  "against the main one" (design.md:731-733). Fix: classify all pairs of bodies in
  the part.
- **m9. The bridge anchor is undefined.** It is unclear whether the anchor is
  an edge length or a material depth (see M3).
- **m10. `status ok` on waived `unresolved`.** Waiving an `unresolved` record
  (design.md:223) lets a waiver hide an undecided result as green. Fix:
  record it as `waived-unresolved` and do not count it as `pass` in the chip.

## What holds (checked)

- Enclosed voids cannot exist on committed HEAD (`HEAD:src/boolean.mjs:205`,
  `HEAD:src/analytic.mjs:280`), so "0 by construction" is true for bodies that
  build.
- Point membership exists for plane and cylinder only
  (`kernel/solid-classification.bend:145-152`), as the design says. A cone
  classifier is new work.
- Cylinder and cone overhang candidates are a single angular band with
  closed-form limits for any up direction (inventory-printability.md,
  section 5.2). Sphere caps are bounded by circles. The chord numbers are
  right: Ø12 gives 8.485 and Ø20 gives 14.142 [M].
- The coaxial pin and bore gap 1.75 − 1.5 = 0.25 is exact in F32x2 for
  unmoved or dyadically placed bodies [I].
- The revolute displacement bound `2R sin(Δθ/4)` over a half interval is
  correct, and distance is 1-Lipschitz in rigid displacement [I].
- Capability errors are latched host-side, so catching them in Python cannot
  make a run green (`src/python.mjs:1009`). A `refused` verdict with exit
  code 2 keeps that property.
- Quadrature labelled `estimate` rather than `bounded` (design.md:242-247)
  correctly overrides kernel-gaps.md section 5.
- The committed planar and convex-tool INTERSECTION arms exist
  (`HEAD:src/boolean.mjs:92-125`). Q8 for polyhedral pairs therefore does not
  need r20.
- OCCT read-back of exported STEP in K14 is artifact validation and complies
  with AGENTS.md.

## Required changes before K3 and K4 start

1. B1: witness-based `overlapping`, tolerant `touching`, relative frames, a
   transform bound (K4/K5 scope and acceptance).
2. B2, M2: an explicit face-face crossing test before the nesting test (the
   lower-strata argument is dropped; boss-and-pin case with both seam
   placements in K4's acceptance); cone-cone and cone-torus coverage decided.
3. M3, M4, M6: anchored-direction bridges, opposed sub-bands, cone sections.
4. M7, M12: K14/K15 marked r20 or scoped to the committed print mesh; K4
   copies the BVH from `HEAD:kernel/proto/recover/clear.bend`; package splits.
5. M9, M10, M11: oracle on the same geometry; latched `Refused`; facts only
   from Bend.
