# Hybrid Boolean robustness: root causes and fix plan

Status (24 September 2026, after tasks A-D; working tree, not committed):
X1-X4 and X6 are applied (A: X3, X4; C: X6 and the reader side of X5; D:
X1, X2), and the metamorphic harness (B) exists. X5's export side is a
follow-up patch (`tmp/hybrid-robust/followups/goal4-r20-export.patch`),
since `src/r20-export.mjs` was not ours. Measured after D (`local design note`
section 9):
- goal 1: probe passes 612:9 and stops at 307:5 (as predicted, section 8);
  `adv:kt1-rot` PASS; `adv:kt1-rotfar` gets past its ReliefUnion (176:9) and
  now refuses by name at the r20-check export ("snapping broke the mesh",
  `src/hybrid-mesh.mjs` retriangulate orientation, then an unknown corner
  drift): refusal only, still open (follow-up
  `tmp/hybrid-robust/followups/kt1-rotfar-retriangulate-orientation.patch`);
- goal 2: every kt6 adversarial row PASS (rz1e-4, rz30, rz45, rz60, rz89.9,
  rot, rotfar, r90far), kt6-t1e4 refused by the envelope;
- goal 3: `adv:kt1-far` PASS;
- metamorphic sweep (3920 frames): 0 wrong, 4 refusals (all kt6-rz1e-4 in
  inexact translated frames, refused on HEAD too), production 548; probe,
  kt1-rot and kt1-far ReliefUnion build in 112/112 frames each;
- 388 jobs: 18 refusals -> results, 0 regressions.

Integrated (24 September 2026, live tree on HEAD `8d91dfa`, not committed;
worklog local development evidence, section 10 of
`local design note`). Follow-ups applied on top of A-D:
`kt1-rotfar-retriangulate-orientation.patch` (`src/hybrid-mesh.mjs`
retriangulate keeps the ear clipper's order) and
`unify-overflow-recover-statement.patch` (recover's `unified` line and
`src/hybrid.mjs` name the classes past the 32-bit limit; new test in
`test/hybrid-unify-tilted.test.mjs`). Not applied, outside this workflow's
files: `goal4-r20-export.patch` (`src/r20-export.mjs`), so goal 4's export
side is still open. Measured on the integrated tree:
- goal 1: probe still stops at 307:5 (refusal, open); `adv:kt1-rot` PASS;
  `adv:kt1-rotfar` gets past the retriangulate break and now refuses at
  layer 2 ("the distance of a boundary vertex from the exact boundary is
  unknown"): refusal only, still open;
- goal 2: every kt6 row PASS (rz1e-4, rz1, rz7, rz30, rz45, rz60, rz89.9,
  rot, rotfar, r90far, rz45-t1e3, rot-t1e3); kt6-t1e4 refused by the
  envelope, by name;
- goal 3: `adv:kt1-far` PASS;
- goal 4: reader and acceptance side only (the export patch is not applied);
- goal 5: the datums/probe rows check against the Onshape B-rep volumes, and
  now FAIL by name because `build/studios/datums.fs` and `probe.fs` in the
  CAD repository changed after cad-31 measured them (sha 05bc7818, 9a3ce6b6, 70f868c3 during this run
  vs d1e6da7a; probe 509d77e1 vs 354a3895): the check works, the references
  need re-measuring;
- bake-off, corefine and hybrid prototypes, corpus + 4 adversarial suites:
  520 results byte-identical across js / cpu1 / cpuN / Metal; the hybrid
  prototype against HEAD: 2 refusals -> results (both validated), 0 results
  -> refusal;
- JS vs native wonky-hybrid on the 46 frozen R20 jobs: 46 byte-identical.
Regression review 1 (25 September 2026, HEAD `87e3974` + tree, not committed;
worklog local development evidence, `local design note`
section 11): **F1** (section 3) cancels coplanar membranes before
triangulation (`kernel/hybrid/corefine/membrane.bend`). Measured:
- goal 1: the probe **builds** (P01 certified mesh within Onshape's interval
  and 5e-11 mm³ of the closed form, X06 exact); its acceptance row still fails
  by name on the stale reference provenance (`probe.fs` sha changed after
  the B-rep references were measured; the re-measured file matches). All 8
  probe tilts (0.001-89 degrees) build;
- adversarial rows unchanged (16 built and matched, `adv:kt1-rotfar`
  refusal only, `kt6-t1e4` designed refusal, 0 FAIL);
- metamorphic 3920 frames: byte-identical to before (0 violations);
- bake-off: 520/520 identical across js / cpu1 / cpuN / Metal; 3 jobs per
  prototype go from refusal to the correct empty result (intersections of
  face-touching boxes), 0 results -> refusal.


Regression review 2 (25 September 2026, live tree on HEAD `06de4a7`, not committed;
worklog local development evidence "Regression review 2",
`local design note` section 12). Two verify#2 findings, fixed at the root:
F1b (a membrane group is cancelled only when its remainder has one
orientation by exact winding; otherwise its faces stay as produced) and F2
(`unify.bend` axis_exact: a normal with a rounded axis component is no exact
carrier). Measured:
- the 51 correct results F1 had turned into refusals are results again
  (synth2-rot 602/602 identical to pre-F1), 0 results lost against F1 or
  pre-F1 on verify#2's 2983 job frames, 0 volume or closed-form violations;
- the CLI kt6 cross unions (89.9 and 77 degrees) and the probe tilted by 52
  degrees build and match their closed forms; the t52 freecut job builds in
  48/48 axis permutations (F1 and pre-F1: 4);
- acceptance, metamorphic sweep (byte-identical to Regression review 1) and the
  bake-off (520/520 four-target identical, no verdict change) unchanged;
- still open: a mixed remainder whose halfedges cross (u-overhang in
  permutation p7) refuses by name as before F1; `freecut-shear-nu.job` refuses
  by design (its carriers declare two planes).
The design text below is unchanged; where it says "today" it means HEAD.

Base: HEAD `6e2c1a0` + `fbeed88` (R20 gate, `local design note` sections 6-8).
Worklog: local development evidence. Sources: the three diagnoses
local development evidence, `diag-rotation.md`,
`diag-numerics.md`, their scratch diffs (`tmp/hybrid-robust/proposed/`,
`tmp/hybrid-robust/diag-rotation/*.diff`,
`tmp/hybrid-robust/diag-numerics/proposal/`) and the frozen repros
`fixtures/r20/relief-union/` and `fixtures/r20/diag-rotation/`.

Rules that bind every task below:
- all geometry stays in Bend; OCCT/manifold3d are oracles only (via `uv run`);
- a case either builds a correct, correctly stated result or refuses by name;
- no tolerance grows. Where a fix needs a threshold, it is derived from the
  error model, and a job that would need more **reports the needed value**
  instead of the threshold being raised;
- JS and native stay byte-identical (`WONKY_BACKEND=diff`), and the bake-off
  targets js / cpu1 / cpuN / metal stay byte-identical with each other;
- r10b snapshot and `npm run check:r10b` unchanged.

## 1. Summary

| goal | case(s) | root cause | fix |
|---|---|---|---|
| 1 | probe 612:9, kt1-rot, kt1-rotfar (ReliefUnion) | C1: identical **tilted** carriers of different leaves are never a unified class, so rounding (±6.5e-14 mm) decides their coplanar overlap; C2: a tie decided symbolically is still constructed numerically (x12 / x21 of one point 1.4e-14 mm apart) | X1 unify identical non-axis-exact carriers; X2 construct a tie from one value |
| 1 | kt2-rotfar | R2 (translation-variant triangulator), see goal 3 | X4 |
| 2 | kt6 rotated (rz1e-4, rz45, rz60, rz89.9, rot) | planar arm declines correctly (P0); then R1: zip / T-junction splits create sub-eps edges **after** the short-edge collapse | X3 collapse after repair (bounded fixpoint) + invariant check; X1/X2 cover the attached-mesh noise of rz45 at the root |
| 3 | kt1-far (also kt2-rotfar, adv2-sphere-near-coaxial-1e-9) | R2: earclip lengths/dots are differences of F32-rounded **absolute** coordinates (ulp 6.1e-5 mm at 800 mm); R3: flatness is a fixed 1e-7 rad angle, not the construction error | X4 Real differences, then round; distance flatness term with a derived bound |
| 4 | far exports | `packStl` stores float32 but the statement is the unrounded mesh's | X5 state the stored file: mesh deviation + measured float32 displacement |
| 5 | datums, probe references | volume check is mesh-derived | X6 Onshape B-rep volumes (`r20/brep-volumes/v1`), Hausdorff stays against `var/mesh` |

Measured effect of X1-X4 together (scratch trees, JS target; section 5):
388 jobs, 317 byte-identical, 18 refusals become results (8 exact, 10
certified mesh), 0 regressions, every changed same-status result equivalent;
r20 `--adversarial` with X1, X2, X4 (scratch e2e): 10 PASS / 0 REFUSED / 0 FAIL (production 5 / 5 / 0).
Probe then passes 612:9 and stops at **307:5** (freecut subtract, a new
blocker: section 8), so canonical acceptance stays 16/17 until that is
diagnosed.

## 2. Root causes with evidence

### 2.1 C1: identical tilted carriers are not unified (goal 1)

`kernel/hybrid/unify.bend mt.fin` sends bitwise-identical carriers to
`MtSame` ("identical carriers join silently"); a class is *unified* (mask bit,
tz ties in `shadow.bend`) only when it holds non-identical carriers of
different leaves. The implicit assumption is "identical carrier => exactly
coplanar vertices". That holds only for axis-aligned carriers, whose offsets
are input coordinates. On a tilted plane every F32x2-rounded leaf vertex sits
up to 6.5e-14 mm off the plane on either side.

Evidence:
- `tmp/hybrid-robust/cf/ondist.mjs` kt1-rot ReliefUnion: Core entry cap (tag 0,
  leaf 0) and relief cone base (tag 14, leaf 1) have bitwise-identical normal
  and offset; leaf vertices in [-6.5e-14, 4.8e-14] mm of the plane; no
  `unified` record.
- `capgaps.mjs` (exact orient3d in kernel02's frame): canonical KT1 84/84 cap
  vertices exactly on the relief base; kt1-rot and probe 59 above / 25 below.
- `analyze.mjs` kt1-rot: failing faces 421 / 432 are cone-base Q triangles:
  a 28-gon with two holes touching at v516; three outer loops and a hole all
  sharing v309. 0 exact edge crossings: the loops are valid but pinched, and
  the ear clipper / hole bridging refuses.
- Random-frame sweep (`tmp/hybrid-robust/repros/sweep2`, 25 frames x 4
  shapes): boxcyl (identical top carrier) production refuses 18/25, with X1
  0/25.

### 2.2 C2: symbolic tie, numeric construction (goal 1, after C1)

With C1 fixed, probe still refuses: a comparison decided as a tie under
unification still constructs its point from its own operand (`kernel11`
`za`/`zb`, `kernel02` vertex z vs interpolated face z, `shadow01` y). The x12
and x21 constructions of one in-plane crossing come out ~1e-14 mm apart
(v483 / v484: same x, y; z differs by 1.4e-14). They are not joined by an edge,
so weld2's short-edge collapse misses them; zip's T-junction split then makes
a 1.4e-14 mm edge along the face normal, zero-length in projection:
`TRACE ... BAD(484 485 483)`.

Evidence: `nearpairs.mjs`, distinct constructed vertex pairs < 1e-11 mm
(probe / kt1-rot / boxcyl-n12 / boxcyl-n8): production 97 / 85 / 10 / 14,
X1 alone 11 / 11 / 5 / 15, X1 + X2 0 / 0 / 0 / 0. X1 alone *regresses* 3
synthetic relief frames that production builds; X1 + X2 fixes all of them.
So X1 and X2 ship together.

### 2.3 P0: the planar arm declines rotated coplanar input (goal 2, correct)

`kernel/ports/planar-boolean-arrangement.bend unique_planes/plane_equal`
merges planes only on exact certificates. Rotated kt6 tops are 2e-15 to
1.4e-14 mm apart (normals up to 8.9e-16), stay two planes, and `H.side`
returns kind 3: `AmbiguousContact (stage 2, detail = plane 6/12/13/14)`.
This is the right answer for a budget-0 exact arm, and the hybrid runs next.
Unifying there would need the class decision inside `unique_planes`, a new
`H.side` rule, class ownership in `planar-boolean-provenance.bend` (lines
133/253) and a nonzero construction budget, i.e. it would break the arm's
exactness contract. The hybrid already makes this decision once per job,
states it, and is faster on these cases (kt6-rz45 4.3 s hybrid vs kt6-id
7.5 s planar arm). **Decision: the planar arm stays exact and unchanged.**

### 2.4 R1: short edges created after the short-edge collapse (goal 2)

`kernel/hybrid/corefine/boolean.bend fin.clean` runs `W.weld2` (exact weld +
collapse of edges < eps = 2^-36 * S) **before** `Z.apply_splits` and `Z.zip`.
Zip `inside` and the split test `near_seg` insert every vertex within eps of
an edge's line with parameter strictly inside (0, len^2), including one within
eps of an edge **end**. Such a vertex is a second rounding of the end point
(exact crossing (0,0,10) vs the step-1 corner (5.4e-14, -5.7e-14, 10)), so the
insertion leaves an edge of 1e-15 to 3e-12 mm that nothing collapses.

Evidence (`cfdbg2` census, short edges before / after the split): kt6-rot-ab
0 -> 2 (unpaired: "welded / repaired output is not 2-manifold"), rz60 0 -> 1
(recover needle "not clearly oriented"), rz45-attached 0 -> 1 (needle),
rz1e-4 0 -> 1 and rz89.9 0 -> 1 (1.1e-15 / 2.4e-15 mm edge: ear clipper).
Collapsing again after zip makes all five corefine + recover ok (box 8/12/6,
others 22/33/13); byte-neutral on 167 of 168 bake-off jobs. The failure
pattern depends on rounding, not angle (rz7, rz30, rz45-t1e3, rot-t1e3 build
in production).

rz45's near-duplicate comes from the reused attached step-1 mesh, whose
vertices are up to 1.4e-13 mm off **identical** carriers (no unified class):
the same mechanism as C1, which X1 addresses at its source.

### 2.5 R2: the triangulator is not translation invariant (goals 1, 3)

`kernel/hybrid/corefine/earclip.bend` `flen`, `dist2`, `d2f` (sliver-flip
longest edge) and `fdot` (`straight`) subtract F32 approximations of absolute
projected coordinates. At 800 mm the F32 ulp is 6.1e-5 mm, so edges shorter
than ~1e-4 mm get noise lengths, and collinear-run removal, flat-ear
avoidance and the Lawson flips silently stop working.

Evidence:
- kt1-far clearCut has corefine topology identical to canonical KT1 (666
  vertices, 1336 triangles, same loops); only face 911 differs: tri
  [440 441 442] (edges 7.256e-4 / 9.08e-7 / 7.265e-4 mm, altitude
  2.7e-13 mm, noise normal) reaches recover, which refuses.
- kt2-rotfar step 2 face 1940: crossing points on one line 6.6e-6 to
  2.4e-2 mm apart, dents ~1e-12 mm; simplify keeps v1005/v1007 (flen = 0,
  fdot = 0), sliver ear (1126 1005 1007), clockwise fan: refusal.
- Real differences alone: kt2-rotfar exact (brep 1 18 27 12), kt1-far clearCut
  becomes the canonical `mesh` answer ("carriers are not concurrent").
- Synthetic fanplate (108 configurations): origin all build; far frames
  production 5 refusals, Real differences 3, Real differences + distance
  flatness 0; areas equal the origin frame's.

### 2.6 R3: flatness is a fixed angle, not the construction error (goals 1, 3)

`flat` / `flat3` accept only |sin| <= 1e-7. Corners at micrometre edges turn
by up to ~5.6e-7 rad from F32x2 construction rounding alone. After R2, kt1-far
still fails in 10 of 48 permuted frames (1.28e-6 mm edge, altitude
1.2e-12 mm), and the 0.005 mm refinement of kt1-far / r90far / t1e3 keeps a
sliver (5.64e-4 / 6.56e-7 mm, height 3.7e-13) until a distance term is added.

### 2.7 Goal 4: the statement ignores float32 storage

`src/r20-export.mjs packStl` rounds every coordinate with `Math.fround`;
`partStl` states the unrounded mesh's `achievedDeviationMm`. kt2-r90far states
0.0097366 mm, the stored file is up to 6.36e-5 mm further off; kt6 exports at
1e3 mm state 0 and are 4e-5 to 6e-5 mm off. The acceptance statement check
passes only through its fixed `STL_FLOAT_MM = 1e-4` allowance.

### 2.8 What is not the cause (measured, so not in the plan)

- **R.add accuracy (B2, Joldes Alg. 6).** `addbound.mjs` (1e6 random and
  cancellation pairs, bit-exact emulation vs BigInt): R.add worst
  |err|/(|a|+|b|) = 2^-46.83, which is the operand-scaled model every filter
  assumes; only its relative error under cancellation is poor (2^-13.5) and no
  decision uses that. Swapping in Alg. 6 flips verdicts both ways (fixes
  kt2-rotfar step 2 and probe by luck, breaks kt6-rot-t1e3 step 0). The
  offsets of C1 are input rounding of a tilted plane; no arithmetic removes
  them. An accurate add may be added to `kernel/real.bend` additively later;
  this plan does not need it.
- **The 2^-44 unification bound.** 2^-44 -> 2^-42 changes 0 verdicts on 35
  jobs; unified pairs lie at <= 2^-48.4 * scale; identical carriers are at
  distance 0. Latent, not ours: `kernel/polygon-prism.bend framed()` derives
  side normals from two rounded cap origins (`s = far - origin`), about
  2^-42.7 off at 1000 mm (2^-49 at the origin), so analytically coplanar
  prism sides far out are not unified. No failure today; follow-up patch
  (section 8).
- **B3 exact provenance replacing sliver absorption.** 0 slivers absorbed in
  all 24 exact answers; kt1-far fails at recover's per-triangle input check,
  before absorption. X2 is the part of B3's idea the evidence needs (one
  symbolic point, one construction).
- **B11 declared contacts.** No diagnosed failure needs them. Deferred.

## 3. Fixes

### X1: unify identical tilted carriers (C1) — `kernel/hybrid/unify.bend`

`mt.fin`: an identical pair that is not `axis_exact` becomes `MtNear` (unified
when its tags come from different leaves); an identical axis-exact pair stays
`MtSame`, because its vertices are exact input. Coplanarity is a property of
the carriers' provenance, not of rounded coordinates. Base diff:
`tmp/hybrid-robust/proposed/1-unify-identical-tilted.diff`. The header comment
("identical carriers join silently"; "no corpus job has a unified class")
must be rewritten: the corpus now has unified classes (tilted-holes-17deg
gains a stated `unified 4` record, geometry identical).

Side effect to handle in the same change: more classes are unified, so the
32-class mask limit is reached sooner, and classes past it silently keep the
old noise decisions. Make that explicit: the `Unified` record counts the
classes that did not get a bit, and corefine's refusal suffix / recover's
statement name it ("N unified classes past the 32-bit limit"). No behaviour
change below the limit.

Why not the alternatives: making the vertices exactly coplanar (snapping
leaf vertices onto the carrier) moves input and is itself inexact on a tilted
plane; treating identical carriers only inside `shadow.bend` would duplicate
the class decision recover states.

### X2: construct a tie from one value (C2) — `kernel/hybrid/corefine/shadow.bend`

When a comparison is decided as a tie under unification (`rel` and
|p - q| <= tz), the construction uses the same value: `shadow01` y := ay,
`kernel11` zb := za, `kernel02` z := az (helper `tie_canon`). No decision
changes. The x12 and x21 constructions of one symbolic point become bitwise
identical, and the exact weld merges them as it does for axis-aligned input.
Base diff: `tmp/hybrid-robust/proposed/2-shadow-tie-canonical.diff`.

Bound: a canonicalised coordinate moves by |p - q|, at most tz = 2^-36 * S by
the gate, but in fact by the construction noise plus the class's carrier
spread (both <= ~2^-44 * S). The implementation **records the largest
|p - q| it canonicalised** per job (stats line) and the tests assert it stays
<= 2^-42 * S; a job above that is reported, not absorbed. Asymmetric (P's
value wins) but deterministic.

### X3: collapse after repair, as a bounded fixpoint (R1) — `corefine/boolean.bend`, `weld.bend`

The invariant "no edge shorter than eps reaches triangulation" is enforced
after the **last** stage that can create edges. `fin.clean` (False branch):
`zip(apply_splits(...))`, then `W.weld2` again (accessor `W.welded_fh`), and
while the collapse changed something and new split/zip defects appear, repeat
(at most 3 rounds). Then a census: if any edge < eps or any unpaired halfedge
remains, refuse by name ("short edge / unpaired edge survives repair after N
rounds") instead of letting the ear clipper or recover fail later with an
unrelated message. Same eps (2^-36 * S), renames to the lower index, input
vertices never move beyond what the first collapse already allows. Base diffs:
`tmp/hybrid-robust/diag-rotation/recollapse.diff`,
`diag-numerics/proposal/corefine-robust.diff` (a).

Rejected: identifying a near-end vertex with the end inside zip `inside` /
`near_seg`. It is the same equivalence weld2 already implements, but it would
need cross-face consistent renames inside zip (a second weld). Revisit only if
the fixpoint does not converge on the sweeps.

Same file family, same defect class as R2: `zip.bend near_seg` computes the
segment length from F32 absolute coordinates, so a segment shorter than one
F32 ulp has l2 = 0 and its T-junction is never split. Latent (no measured
failure). Fix with Real differences only if the change is byte-neutral on the
corpus; pin with the translation metamorphic test either way.

### X4: translation-invariant triangulator with a derived flatness bound (R2, R3) — `corefine/earclip.bend`

1. `flen`, `dist2`, `d2f`, `fdot`: `R.approx(R.sub(a, b))`, subtract in Real,
   then round (diff helpers `fdx`/`fdy`). Removes R2.
2. `flat(u, v, w)` is also true when the corner lies within delta of the line
   u-w: |cross(u - v, w - v)| <= |u - w| * delta. `flat3` likewise with the
   longest edge. The 1e-7 rad term stays (sharpest-ears-first ordering).

**Derivation of delta** (research backlog B2, "derived bound"):
- S = the job scale corefine already uses for eps (`weld.bend eps2_of`:
  maxabs of the job's vertices, at least 1). A job-wide S, not the local
  |coordinate| of the three points: a point constructed on a long edge from
  far operands carries the operands' error, which the local magnitude can
  underestimate.
- Leaf vertices: F32x2 storage, <= 2^-49 * S per coordinate.
- R arithmetic: <= 2^-46.83 * (|a| + |b|) per add/sub (`addbound.mjs`),
  the same order for mul/div of coordinate-sized operands.
- One interpolation a + lambda (b - a) (shadow01, kernel02) costs about 7
  such operations on operands <= 2S: the point's distance from its analytic
  line is <= ~7 * 2^-46.83 * S ~ 2^-44 * S (the error of lambda only moves the
  point *along* the edge). A kernel11 point (two interpolations) is
  <= 2^-43 * S. So eps_c <= 2^-43 * S.
- A corner v between u and w is displaced from the line through the
  (displaced) u, w by at most eps_v + max(eps_u, eps_w) = 2 * eps_c.
- **delta = 2^-42 * S** (= eps / 64).

The three diagnoses used 2^-44 * local m, 2^-42 * (|u-v|+|w-v|) * m and
2^-40 * local m; each fixed its measured set; the derived value sits in that
range. Measured noise: kt2-rotfar dents 1e-12 mm at 800 mm (2^-49.6 * S),
kt1-far altitudes 2.7e-13 / 1.2e-12 mm at 812 mm (2^-51.4 / 2^-49.3 * S), all far
inside delta. The implementation **records the largest |cross|/|u - w| that
only the delta term accepted** and reports it in units of S; a job that needs
more than 2^-42 * S is a finding about the construction error model, not a
reason to raise delta.

Safety: flatness only chooses diagonals. Collinear runs are re-inserted by
fans with exact CCW checks (`all_ccw`), flips need exact CCW, the output gate
and recover's orientation check are unchanged. A misjudged corner refuses;
it cannot produce a wrong boundary. Base diffs:
`tmp/hybrid-robust/diag-rotation/earclip-scale.diff`,
`tmp/hybrid-robust/proposed/3-earclip-flatness.diff`,
`diag-numerics/proposal/corefine-robust.diff` (b, c); take (1) from any of
them, (2) with the job scale passed in from corefine instead of `tau3`/`fmag3`.

Conservative F32 prefilters (`tri_box` pad 1e-5|x| + 1e-6, grid) stay: they
only widen candidate sets.

### X5: state the stored file (goal 4) — `src/r20-export.mjs`, `scripts/r20/mesh.mjs`

Two-number contract (`diag-numerics/proposal/goal4-float32-statement.diff`,
"v2"): `packStl` measures `float32RoundingMm` = max |fround(p) - p| over the
stored vertices (component differences exact by Sterbenz, hypot rounded up);
`achievedDeviationMm` = meshDeviation + float32Rounding (rounded up); the
manifest also carries `meshDeviationMm` and `float32RoundingMm`. The request
bounds `meshDeviationMm`; the reader (`scripts/r20/mesh.mjs`) checks that and
that the stated total includes the storage term. Stated values then: kt2-r90far
0.009800, kt1-far 0.010042, ks06 0.0100076, kt4 0.0100019. cad-31's
`checks/meshes.py` does not read `achievedDeviationMm`, so the contract change
is ours alone.

Rejected for now: reserving the storage budget at meshing ("v1": re-mesh at
request minus float32) regressed KS06 and KT4 (an attached hybrid mesh cannot
be re-meshed below its own 0.01 job deviation); it would need
`goal4-refine-below-body-deviation.diff` in `src/hybrid-mesh.mjs` and doubles
export time on far parts. **Marc decides** whether "stored <= request" must hold
strictly; then that is a follow-up, and v2's measurement stays as its check.

Acceptance: the statement check uses the stated value (which now contains our
storage term) plus Onshape's chord error plus the **reference's** own float32
rounding measured from the reference STL, instead of the fixed 1e-4 mm; the
volume/bbox/Hausdorff tolerance keeps its float32 allowance for the reference
side.

Ownership note: `src/r20-export.mjs` is in neither ownership list. Task C
applies it only if the maintainer confirms; otherwise it ships the change as
`tmp/hybrid-robust/followups/goal4-r20-export.patch` and the reader side lands
behind `meshDeviationMm ?? achievedDeviationMm`.

### X6: B-rep reference volumes for datums and probe (goal 5) — `scripts/r20/acceptance.mjs`

Read `~/Workspace/cad/cad-project-041/single-step-r20/kernel-cases/r20-datums-probe-volumes.json`
(schema `r20/brep-volumes/v1`, `volume_mm3_value_min_max = [value, min, max]`;
D01/D02 782.884889275, D03 845.316129409, D04 408.407044967, P01
5170.305940728, X06 51873.616020542). Verify `studio_sha256` against
`build/studios/{datums,probe}.fs` and each `mesh_sha256` against
`var/mesh/<key>.stl` (and the tessellate manifest); a mismatch fails the row
by name. The volume check becomes the KT one (inside [min, max] or within
1e-6 relative, basis `onshape-brep`); bbox and Hausdorff stay against
`var/mesh` with the chord allowance. Header comment lines 20-23 updated.

### F1 (Regression review 1): cancel coplanar membranes before triangulation — `corefine/membrane.bend`

Found after the integration (probe 307:5, the R20 freecut subtract; the
same class at the probe tilts 0.001, 5, 10, 20 and 89 degrees, where it also
shows as "result self-intersects (below 2^-36*scale)").

**Root cause (development evidence kept locally).** The
freecut tool's 90-degree side (tag 47) is flush with the tilted plate's -X
side (tag 8), same outward normal: a notch at the plate corner. The two tags
are one plane class. The symbolic perturbation (`shadow.bend`, Manifold's
Boolean3 as of today) gives every element its own tie direction: an edge the
z sum of its two face normals, a face its own normal. Against the tool's
diagonal (0-20, in the plane) the plate's bottom edge (plate faces 8 and 1)
gets direction +0.19 and the plate's side diagonal -1.035, so the tool
diagonal passes above one and below the other: the plate face lies on the
+X side of tool triangle A but on the -X side of the neighbouring tool
triangle B of the same plane. The decisions stay consistent (the output
halfedges pair), but P face 2156 and the flipped tool face 4190 keep the
same quad with opposite orientation: a zero-thickness sheet. Both ear
clippers pick the same diagonal, and the result is refused ("a face
diagonal duplicates an edge"); with other diagonals the gate refuses the
sheet as a self-intersection. Not a unification effect: an exactly coplanar
sheared copy of the job (vertices on the plane by construction) refuses the
same way, also with unification switched off; a copy turned so that the
faces are vertical builds. Manifold removes such sheets after its Boolean
(`edge_op.cpp` RemoveIfFolded); our port had no such step.

**Fix.** Before the face loops are formed (`boolean.bend finish2`), a P face
and a Q face whose tags are in one plane class (`unify.bend` now exports the
class of every plane tag, `Unified.planes`: identical exact carriers or a
unified class) and whose effective normals are opposite, and which share a
pair of opposite halfedges, are a membrane: two coplanar faces meeting at an
edge with opposite orientation fold the surface by 180 degrees, which a
regularized solid never does. Every such group (joined also through coplanar
neighbours of equal orientation) becomes one face; its opposite halfedge
pairs cancel (the weld's in-face cancellation). What remains bounds the
signed sum of the member regions (plate face minus the sheet); its
orientation is read from its signed area (Reals), and the face takes the tag
and normal of a member with that orientation. A net area within 2^-36 of its
scale is refused by name ("a coplanar membrane of P and Q cancels to a
region too small to orient"). (Superseded in Regression review 2, F1b below: a group's
remainder need not have one orientation; it is decided by exact winding,
and a group that is not one-signed is not cancelled. The threshold is gone.) Without a membrane pair the halfedges are
returned unchanged, so every other job is byte-identical (the bake-off
measures it). Cost: one sort of the halfedges per Boolean, not measurable on
the R20 jobs (kt1-far clearCut 539 / 530 ms, probe ReliefUnion 540 / 533 ms,
old / new, JS).

Test: `test/hybrid-membrane.test.mjs` with `fixtures/r20/membrane/`
(`gen.mjs`: the frozen tool leaf word for word plus a tilted 42 x 42 x 3 box
plate with the real plate's bottom fan apex and side-triangle corner order,
which decide the construction). The reduced job must be exact with the
closed-form volume 5292 - 75 pi in the identity and the 16 quick frames, and
the frozen probe job a certified mesh equal to the manifold3d mesh Boolean.

### F1b (Regression review 2): cancel a membrane group only when its remainder has one orientation — `corefine/membrane.bend`

Found by verify-2: F1 turned 51 correct results into named refusals in 2090
synthetic face-contact frames (`tmp/hybrid-robust/verify-2/synth-rot`,
`synth2-rot`), CLI-reachable (`adv3/x-cross-r57m2-89.9`, kt6 cross union,
step 0: "face triangulation failed").

**Root cause (diagnosed, local development evidence "FIX
ROUND 2").** F1 gave a whole group one orientation from its net signed area.
A group can hold faces of both orientations: in a face-contact union P's top
outside the contact (+1) and Q's bottom outside it (-1) lie in one plane,
and a fold joins them into one group (u-overhang: 300 - 100, the -1 loop is
reversed and the ear clipper fails; u-side-partial: 100 - 100, "too small to
orient"). Two relabellings were tried and measured wrong: (a) a surviving
halfedge takes the orientation of the face it came from: members overlap
without cutting each other, so a Q quad's edge inside a P face bounds +1
(reduced probe: loops do not close); (b) every surviving halfedge gets its
own w by an exact winding test after the repair and the group is split into
a +1 and a -1 face: this builds u-overhang and u-side-partial, but in x-cross
the remainder's halfedges cross at a point that is no vertex (the A-top edge
x = -20 crosses the B-bottom edge y = 0), so one halfedge bounds +1 on one
part and -1 on another and no labelling closes.

**Fix.** The group is relabelled and cancelled as in F1, and then decided on
its remainder: every remaining halfedge h gets w on its left, exactly (the
winding number of the group's other remaining halfedges around a point just
left of h: a ray from h's midpoint along its left normal, signed crossings,
half-open; points doubled so that the midpoint is exact; orient2d with an F32
filter trusted above 2^-18 m (|u| + |v|) + 2^-20 |u| |v| and a big-integer
fallback). All voting halfedges w_left = 1: the root's face (F1). All 0: the
face of the root's opposite member (F1). Nothing left: cancelled completely.
Anything else (both signs, |w| > 1, a halfedge doubled or met at its
midpoint, halfedges but no vote) is not cancelled: its members keep their
halfedges as the corefine produced them (pre-F1), and the output gates judge
them. The remainder is not repaired yet: a zero-width spike that the
T-junction repair zips later overlaps an edge the other way, and w changes
along that edge where the overlap ends (corner-notch frames, s-top-half
r2m11). A halfedge that runs against another over more than eps (2^-36 S,
the repair's own tolerance; both ends within eps of its line, in Reals) does
not vote. F1's area threshold (2^-36 of the net area's scale) is gone.

Measured (kernel snapshot `tmp/hybrid-robust/fix2/ksnapC`): verify-2's
job-level frames against F1 and pre-F1 (`fix2/diff3.mjs`): synth2-rot 602/602
identical to pre-F1 (43 F1 refusals back to results), synth-rot 8 F1
refusals back to results and 0 results lost against F1 or pre-F1, rot 0
results lost (4 same-class changes: probe-freecut-reduced and probe-next in
id and rym41, from F2). Judged against verify-2's manifold3d oracles and
closed forms: 0 volume, closed-form or watertightness violations (the only
flags are manifold3d splitting face-contact unions into two bodies across a
rounded 1e-15 mm gap, as for F1). Still open: a mixed remainder whose
halfedges cross (u-overhang in permutation p7) is not cancelled and refuses
by name, as before F1 and under F1; cancelling it needs an arrangement with
constructed crossing points.

### F2 (Regression review 2): a normal with a rounded axis component is no exact carrier — `unify.bend`

Found by verify-2: probe tilted by 52 degrees refused 307:5 ("a face
diagonal duplicates an edge") with and without F1; 44 of its 48 axis
permutations refused.

**Root cause.** The dumped freecut job (`fixtures/r20/membrane/f2-probe-t52-freecut-subtract.job`)
pairs the plate's -Y side, tag 11, n = (0, -1, 0), o.y = -271.00000000000017,
with the flush tool face, tag 45, n = (0, -1.0000000000000053, 0), o.y =
-271: offsets 1.2e-12 mm apart (< tau), normals 5.3e-15 apart (< 2^-44).
`axis_exact` called both exact axis carriers (two components exactly 0), and
two different exact carriers never join (the rule that keeps a real 2e-11 mm
skin over a sealed void). So the flush faces had no plane class, the tool's
rounded vertices 1.7e-13 mm off the plate plane left a sub-tolerance wall,
the weld closed it into a pillow of the two faces, and F1 (plane classes
only) never saw it (the debug dump shows the duplicated diagonal 2100-2102 in
both tags). A normal whose non-zero component is not exactly +-1 is the
rounding of a transform, not a plane of the input as given.

**Fix.** `axis_exact` also requires the non-zero component to be exactly
+-1. Such a carrier pair within the tolerance is unified (MtNear), the flush
faces are one plane class, and F1/F1b cancel the pillow. Measured: the t52
job builds (certified mesh) in 48/48 axis permutations and 16/16 quick
frames (F1 and pre-F1: 36 diagonal duplicates + 8 self-intersects + 4
mesh). The skin rule is unchanged for input axis planes (their normals are
exact unit vectors).

Not fixed, by design: `tmp/hybrid-robust/fix1/freecut-shear-nu.job` (fix
round 1's synthetic variant whose tool carriers were moved 1e-3 mm off its
own coplanar mesh) still refuses. Its carriers declare two planes 1e-3 mm
apart; cancelling on mesh coplanarity would override the carriers, the same
step that would erase a real skin between two exact planes.

Tests: `test/hybrid-membrane.test.mjs` F1b and F2 rows with
`fixtures/r20/membrane/f1b-*.job` and `f2-*.job` (copied from verify-2 with
their origin in `expect.json`; oracle rows from `oracle.py`).

## 4. Tests that pin the fixes

Invariant for every generated job: **never a wrong result** (exact: B-rep
valid, volume equal to the source job's transformed volume within the stated
bound; certified mesh: watertight, stated deviation holds against the source
answer; refusal: a named capability error), and for exact transforms **one
verdict class** (exact / mesh / named refusal) across all frames.

| test | transform | exact on the wire | expectation |
|---|---|---|---|
| axis permutations | 48 signed permutations of hybrid jobs | yes | same verdict class as the identity frame; exact volumes equal to rounding |
| 2^k scaling | k in -3..3 | yes | same class; volume scales by 2^3k |
| translations | +1e3 mm, +1e4 mm (hybrid job level); t1e3 frames at CLI level | no | class stable; volume within stated bound; CLI t1e4 / t1e6 stay the **declared** refusal "Solid exceeds the finite ±10,000 mm coordinate envelope" (`src/brep.mjs:144`), asserted by name |
| rotation sweep | kt6 about Z at 1e-4, 1, 7, 30, 45, 60, 89.9, 90 deg; 37 deg about (1,2,3); rotfar; rz45-t1e3, rot-t1e3 | no | PASS (9600 exact) through the hybrid after the planar arm's named decline |
| relief class | kt1 rot / rotfar / far / r90far / t1e3 / rz45; kt2 rotfar / r90far | no | PASS (kt1 certified mesh, kt2 exact 15406.988685) |
| frozen repros | `fixtures/r20/diag-rotation/repros.json`, `fixtures/r20/relief-union/cases.json` | - | production and fixed expectations as listed there |
| synthetic | fanplate origin/far (108 configs), boxcyl frames, a collinear run of constructed points at 800 mm with 1e-12 mm dents, a T-junction on a segment shorter than one F32 ulp at 800 mm | - | build; areas equal the origin frame's |
| statements | packStl on a far mesh | - | float32RoundingMm equals the exact measured displacement; stated = mesh + storage |
| membranes (F1, F1b, F2) | `test/hybrid-membrane.test.mjs`: reduced probe notch and the probe freecut job; face-contact unions with both orientations (u-overhang rnd3, u-side-partial r2m11, CLI kt6 cross union step 0); probe tilt-52 freecut job; identity + 16 quick frames each | - | exact / certified mesh equal to closed form and manifold3d; u-overhang p7 / p7s-3 may only refuse by name (crossing remainder, open) |

Sources for the permutation/scale sweep: the 35 frozen jobs of
`tmp/hybrid-robust/diag-numerics/jobs` + `meta`, moved to
`fixtures/r20/metamorphic/` with provenance (sha256, origin command). Baseline
census (1680 jobs per tree): production 233 refusals, R1+R2 56, R1+R2+R3 46
(probe 20, kt1-rot 24, kt6-rot-t1e3 step 0 2). Target after wave 2: probe and
kt1-rot at 0 except named symbolic-tie refusals ("inclusion number outside
[-1,1]"), which are listed per frame, and kt6-rot-t1e3 measured and reported.
`npm test` runs a fast subset (a few sources x 8 permutations x 2 scalings);
the full sweep is a script with a completion marker.

## 5. Evidence summary for the combined change

- `tmp/hybrid-robust/cmp4/compare.json` (388 jobs: 38 corpus minus
  fine-spheres-50k, 222 judge2 adversarial, r20 dumps, 96 diag-rotation dumps),
  production vs X1+X2+X4(+X3): 317 identical, 18 refusal -> result (8 exact,
  10 mesh), 0 regressions; changed same-status results equivalent
  (`eqcheck.mjs`: exact lo-word deltas <= 2.6e-11; mesh same V/T, volume,
  area). adv2-sphere-near-coaxial-1e-9 volume 3631.760207460 vs manifold3d
  3631.760207459628; adv-ep2-rot-tri-cylinder-union 2887.808109591683 vs
  2887.808109591685.
- `cmp2` attribution: X4 fixes kt2-rotfar, kt1-far, kt1-rz1e-4 clearCut,
  adv2-sphere; X1 kt1-rot, kt1-rotfar, kt6-rz45; X1+X2 also probe 612:9,
  kt6-rot, rz60, rz89.9; X3 also kt6-rz1e-4.
- r20 end to end (development evidence kept locally):
  kt1, kt2, kt6 PASS; adversarial 10 PASS / 0 REFUSED / 0 FAIL; probe passes
  612:9, the hybrid Cut and 4 grid subtractions, stops at 307:5.
- diag-rotation tree3 (X3 + X4): every in-envelope kt6 frame builds 9600
  exact; r20-check vs the transformed Onshape KT6.stl: bbox <= 5.6e-5 mm,
  Hausdorff <= 6e-5 mm; bake-off corefine (168 jobs) 156 identical incl. all 32
  corpus jobs, 2 refusals -> valid.

All of it ran on the JS target in scratch copies; the native slice and the
cpu1/cpuN/metal targets have not been rebuilt or compared. That is a gate of
tasks A and D, not an assumption.

## 6. Implementation tasks

Waves: A, B, C run in parallel (disjoint files); D runs after all three.
Every task keeps a worklog under local development evidence,
writes long runs to logs with completion markers, does not commit, and uses
its own `--out` directory for acceptance runs (`tmp/hybrid-robust/acc-<task>`),
never `out/r20` concurrently.

### Wave 1

**A. corefine-repair (X3, X4)** — files: `kernel/hybrid/corefine/boolean.bend`,
`kernel/hybrid/corefine/weld.bend`, `kernel/hybrid/corefine/zip.bend`,
`kernel/hybrid/corefine/earclip.bend`, `test/proto-corefine-robust.test.mjs`
(new), `fixtures/r20/diag-rotation/**`, `docs/proto-corefine.md` (steps 6/7),
native slice build outputs.
Acceptance:
- X3 fixpoint (<= 3 rounds) + named census refusal; X4 Real differences and
  delta = 2^-42 * S from the job scale; `near_seg` only if corpus byte-neutral;
- stats report the largest delta-only accepted |cross|/|u-w| and the number of
  repair rounds; no job needs > 2^-42 * S (else reported, delta unchanged);
- `fixtures/r20/diag-rotation/repros.json`: all 5 fixed expectations;
  `fixtures/r20/relief-union` kt2-rotfar step 2 exact brep 1 18 27 12 (read
  only), fanplate far 0 refusals;
- permutation census (diag-numerics harness) <= 46 refusals, none new;
- `npm run check:bend`, `npm test`, `npm run check:r10b` unchanged;
- native: `node scripts/native-bridge/build-native.mjs --set planar`,
  `WONKY_BACKEND=diff` on `test/native-hybrid.test.mjs`,
  `test/native-bridge*.test.mjs`, `test/proto-corefine*.test.mjs`: 0
  divergences;
- bake-off corefine on corpus + the 4 adversarial suites, targets
  js,cpu1,cpuN,metal byte-identical with each other; vs production: corpus
  identical, adversarial changes only refusal -> valid or equivalent;
- `node scripts/r20/acceptance.mjs --adversarial --jobs 3 --out tmp/hybrid-robust/acc-A`:
  canonical 16/17 unchanged; adv:kt6-rot, kt1-far, kt1-r90far, kt2-rotfar PASS.

**B. metamorphic-harness** — files: `scripts/r20/metamorphic.mjs` (new),
`scripts/r20/adversarial.mjs`, `fixtures/r20/metamorphic/**` (new),
`test/hybrid-metamorphic.test.mjs` (new).
Acceptance:
- generator for the exact transforms (48 permutations, 2^k) and the inexact
  ones (translations 1e3 / 1e4 mm) on frozen hybrid jobs; validates every
  answer (never wrong) and reports the verdict-class census per source;
  identity copy byte-identical to the source job;
- frozen sources moved into `fixtures/r20/metamorphic/` with provenance and an
  `expect.json` holding the production baseline and the target class per
  source (from sections 2 and 5);
- `adversarial.mjs`: frames rz1e-4, rz1, rz7, rz45, rz60, rz89.9, t1e3,
  rz45-t1e3, rot-t1e3, t1e4; rows kt6-rz1e-4, kt6-rz45, kt6-rz60, kt6-rz89.9,
  kt6-rotfar, kt1-rotfar, kt1-t1e3, kt6-t1e4 (expected: refused by the
  envelope, by name); the row name splits on the first '-' only;
- the `npm test` subset passes on production (no wrong result; stability rows
  known unstable today are `todo` with the census as the note);
- no Bend file touched.

**C. r20-references-and-statement (X5, X6)** — files: `scripts/r20/acceptance.mjs`,
`scripts/r20/mesh.mjs`, `scripts/r20/references.mjs` (new),
`test/r20-references.test.mjs` (new), `test/r20-export.test.mjs`,
`src/r20-export.mjs` (only if the maintainer confirms ownership; otherwise
`tmp/hybrid-robust/followups/goal4-r20-export.patch`).
Acceptance:
- datums / probe refs from `r20/brep-volumes/v1` with sha checks; D01-D04 PASS
  on the Onshape B-rep volume (interval or 1e-6 relative); Hausdorff/bbox still
  against `var/mesh`;
- two-number statement; reader checks meshDeviation <= request and
  stated >= mesh + storage; statement check uses the reference STL's measured
  float32 rounding instead of the fixed 1e-4 mm; unit test on a far mesh;
- `node scripts/r20/acceptance.mjs --adversarial --jobs 3 --out tmp/hybrid-robust/acc-C`:
  16/17 as before (probe unchanged), all adversarial rows keep their status,
  stated values as in X5.

### Wave 2

**D. relief-class and full gate (X1, X2)** — files: `kernel/hybrid/unify.bend`,
`kernel/hybrid/corefine/shadow.bend`, `test/hybrid-unify-tilted.test.mjs`
(new), `fixtures/r20/relief-union/**`, `fixtures/r20/metamorphic/expect.json`,
`docs/proto-corefine.md` (step 10), `docs/hybrid-boolean-plan.md` (section 8
step 4), `local design note` (new section 9), `docs/hybrid-robust.md` (status),
native slice build outputs.
Acceptance:
- X1 with the explicit 32-class overflow statement; X2 with the recorded max
  canonicalised |p - q| (<= 2^-42 * S on all measured jobs, else reported);
- `fixtures/r20/relief-union/tools/check.mjs`: every case at its `afterFix`
  expectation; synth-relief-m12-identity stays the named "inclusion number"
  refusal;
- cmp4 rerun (388 jobs, `tmp/hybrid-robust/cf/compare.mjs`): 0 regressions,
  >= 18 refusals -> results, changed same-status results equivalent;
- full metamorphic sweep (task B) with the census against the targets in
  section 4; `expect.json` updated to the measured post-fix classes;
- native rebuild + `WONKY_BACKEND=diff` 0 divergences; bake-off corpus + 4
  adversarial suites byte-identical across js/cpu1/cpuN/metal; new baselines
  deliberately recorded with the list of changed jobs;
- `npm test`, `check:bend`, `check:r10b` unchanged;
- `node scripts/r20/acceptance.mjs --adversarial --jobs 3 --out tmp/hybrid-robust/acc-D`:
  canonical 16/17 with probe past 612:9 (first blocker 307:5), all adversarial
  rows PASS including kt1-rot, kt1-rotfar and the new kt6 rows; results
  recorded in `local design note` section 9.

## 7. Risks

- Byte changes are expected (~70 of 388 jobs: lo words <= 2.6e-11, added
  `unified` records, different triangulations of mesh answers). Verdicts are
  the gate; baselines are updated deliberately, with a list.
- X1 makes tilted input as robust as axis-aligned input, including its open
  weakness: the exact shared-vertex symbolic tie (synth-relief-m12-identity;
  1 of 25 random relief-m13 frames) refuses by name.
- X3's fixpoint may not converge in rarer configurations; it then refuses by
  name. kt6-rot-t1e3 step 0 (2/48 permuted frames: a near-coincident pair not
  joined by an edge, 6.4e-13 mm hole-bridge diagonal) may remain; it is
  measured in D and reported.
- Metal: the new F32 ops (abs, max, sqrt, mul, R.approx of R.sub) are IEEE
  deterministic, but byte identity is checked, not assumed.
- The scratch evidence used src/ snapshots from ~19:17-20:13 while fillet-prod
  edited other files; A and D re-measure on the live tree.

## 8. Open after this plan (follow-ups, not tasks here)

- **Probe 307:5** (`fixtures/r20/relief-union/probe-next-freecut-subtract.job`):
  diagnosed and fixed in Regression review 1 (F1, section 3): a coplanar membrane
  from the per-element tie directions, cancelled before triangulation. Regression review 2 (F1b, F2)
  closed its tilt-52 variant and the face-contact regressions of F1.
- **Crossing membrane remainder** (F1b): when the members of a group overlap
  without cutting each other, the remainder's halfedges can cross at a point
  that is no vertex (u-overhang, permutation p7: the notch mouth edge crosses
  the Q bottom's edge at (0, 5)). Such a group is not cancelled and the
  result refuses by name (as before F1). Cancelling it needs the arrangement
  of the group: constructed crossing points (a new vertex kind for
  corefine), then the same winding decision per piece.
- **`adv:kt1-rotfar` print mesh** (found in D; `src/hybrid-mesh.mjs`, not
  ours). The Boolean chain builds; the r20-check export of certified-mesh
  body `model/clearCut` refuses. Layer 1 (diagnosed): `retriangulate`
  re-orients every ear by the sign of its 3D normal although `withHoles`
  already emits it counter-clockwise in the frame its ear test used; on a
  straight plane-cylinder boundary about 800 mm out, the snapped boundary
  vertices of plane face 5 are collinear within rounding, so the near-zero
  ear [290 291 281] is flipped against its loop edge 291->281 ("edge 281,291
  is used twice in the same direction"). Keeping the emitted order fixes
  that layer (patch
  `tmp/hybrid-robust/followups/kt1-rotfar-retriangulate-orientation.patch`,
  checked in a scratch copy; applied in the integrate stage, where the row
  now stops at layer 2). Layer 2 (not diagnosed): the snapped mesh then
  has an unknown drift at corner vertex 227 (plane 5, cylinders 9 and 10),
  already unknown before any move, so the export still refuses ("the
  distance of a boundary vertex from the exact boundary is unknown").
- The exact shared-vertex symbolic tie ("inclusion number outside [-1,1]",
  P edge 54 x Q face 23 crossing number 2 at the shared rim vertex): the
  normal perturbation does not break it. Named refusal today.
- `kernel/polygon-prism.bend` / `src/kernel.mjs` (not ours): derive the sweep in
  binary64 in the sketch frame instead of `far - origin`; written as a patch
  under `tmp/hybrid-robust/followups/` if pursued.
- The ±10,000 mm envelope (`src/brep.mjs:144`) stays; extending it needs an
  audit of every non-conservative F32-absolute test first (X4 removes the
  earclip ones).
- Goal 4 strict variant (budget reservation at meshing): Marc's decision.
