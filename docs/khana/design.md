# cad_khana in wonky: design of the native check core

Workflow `khana-design`, task `architect`, 2026-09-24; revised the same day
by task `revise` after two reviews: [review-exactness.md](review-exactness.md)
(2 blockers, 11 major, 10 minor) and the workflow review (10 findings, returned
as a structured result; its probes are under `tmp/khana/review-workflow/`).
Section 16 records how each finding was disposed. English, technical. The
German summary for Marc is [../khana.md](../khana.md). The revised design
doctrine that the checks verify is [doctrine-draft.md](doctrine-draft.md).

This document is a design. Nothing in the kernel, the host, the Python package
or the viewer was changed by this workflow, and nothing was committed.
`tmp/khana/architect/design-0N.md` are the architect's parts; after the
revision they are stale, and this file is the only current version.

## 0. Scope, inputs and evidence

**Binding brief.** local design note (product owner,
2026-09-24 10:00) overrides the original task where they conflict:

- redesign the checks from first principles and reduce them to a small core
  whose verdicts can be trusted (directive item 1);
- every cad_khana name still gets a disposition (`kept`, `replaced by X`,
  `compat stub`, `dropped`), but the mapping is not the goal (item 2);
- compatibility is a thin layer (item 3);
- fix the known weaknesses: whole-part waivers, `status ok` next to overlaps,
  the ≤ Ø12 bore exemption and the two-probe bridge test, checks on proxies,
  uncertified clearance values (item 4);
- tooling and design style are in scope; the doctrine and the checks verify
  the same rules from one printer profile (items 5, 6);
- AGENTS.md stays binding; packages that need the r20-gate hybrid Boolean are
  marked; the first package must be useful on its own (item 7).

**Inputs** (all read completely):

| input | what it contributed |
| --- | --- |
| [review-exactness.md](review-exactness.md), workflow review (`tmp/khana/review-workflow/`) | the findings disposed in section 16 |
| [inventory-mechanism.md](inventory-mechanism.md) | assembly model, assertions, `check()`, `mechanism.json` 0.2, OCCT numerics (volume epsilon, clearance ulp failures, containment false pass), pick, corpus use of the mechanism side |
| [inventory-printability.md](inventory-printability.md) | G0/G1/G2 generations, every threshold, the tessellation dependence, measured false positives and negatives, exact analytic versions, 175 real outputs |
| [inventory-tooling.md](inventory-tooling.md) | CLI, `watch.py`, OCP push, drawings, STEP/GLB/animated GLB, diff, status, output layout, wonky's viewer as it is |
| [kernel-gaps.md](kernel-gaps.md) | which Bend primitives exist, their exactness, speed and coverage; the minimum-distance and contact design |
| local design note → `tmp/khana/corpus-usage/findings.json`, `usage-addendum.json` | 734 customer call sites in 74 files of 14 projects; result consumption; 10 priority flows; stored outputs; package policy |
| [prior-art.md](prior-art.md) → `tmp/khana/prior-art/literature-synthesis.json` | 41 sources, 12 ranked ideas, the list of things not to adopt, the volume-bound guard |
| `~/.claude/skills/cad-khana/**`, `~/.claude/skills/cad-fdm-design/**` (read only) | the agent conventions and Marc's design doctrine |
| `~/Workspace/cad/cad-project-041/single-step-r20/checks/` (read only) | Marc's own check library for the FeatureScript R20 customer (see 6.3) |

**Evidence labels** used below: **[C]** read in code or a document at the
cited `file:line`; **[M]** measured by a command whose log is named (all
measurements come from the sibling inventories or the oracle runs under
`tmp/khana/oracle/`); **[I]** inference or design proposal. Paths are relative
to the repository root unless they start with `~` or `U/` (=
`~/Workspace/cad/cad-khana/src/cad_khana/`, read only). `R20/` =
`~/Workspace/cad/cad-project-041/single-step-r20/` (read only).

## 1. Summary

1. **One check engine, in Bend, for every frontend.** Every verdict (does it
   collide, is the gap big enough, does this face overhang, is this wall thick
   enough) is a geometric decision and is computed in Bend check modules on
   top of Bend query primitives. The host only loads the check spec and the
   printer profile, schedules, caches, writes reports and draws overlays.
   Python models (through the cad_khana compat package), FeatureScript models
   (through a sidecar check spec, since Onshape has no checks), WK/0, the CLI
   and the viewer all call the same engine [I].
2. **A small core of eleven checks** replaces cad_khana's 30-odd functions
   (section 2.3). Four are relational (pair relation, all-pairs coverage,
   poses, motion over a joint range), one is bookkeeping (part facts), five are
   per printed part (overhang with bridges and bed, walls with knife edges,
   edge and house-style audit, lumps, bores as data) and one is advisory
   (orientation). Each has a stated definition, a tri-state verdict and a
   witness.
3. **Verdicts are tri-state and never optimistic.** `pass` needs a value on
   the right side of the threshold, computed in closed form with a stated
   allowance or enclosed by a verified procedure; `fail` needs a witness on
   the wrong side; everything else is `unresolved` with the reason.
   `not-run`, `refused` (capability error), `waived` and `waived-unresolved`
   are separate states. A report is `ok` only if every verdict is `pass` or
   `waived` (section 3); a waived `unresolved` never counts as green.
4. **Contact is a first-class answer.** The pair relation distinguishes
   separated, touching, overlapping, contained and unresolved. The relations
   are defined by witnesses under one stated length tolerance `contact_mm`:
   `overlapping` needs a point deeper than `contact_mm` inside both parts,
   `touching` needs a tolerant contact family within `contact_mm`, anything
   else is `unresolved`. Pairs are evaluated in one part's frame, so parts
   moved together have an identity relative transform. This replaces
   cad_khana's 0.001 mm³ volume, whose depth meaning depends on the contact
   area (1e-5 mm on a 10 × 10 contact, 0.025 mm on 0.2 × 0.2)
   [M, inventory-mechanism.md §10].
5. **Clearance is solid distance with an enclosure.** A part buried in
   another has distance 0 (cad_khana reports 8.0 and passes a 5 mm clearance
   [M]); the nominal Ø3 pin in a Ø3.5 bore measures 0.25 within the stated
   allowance and passes `min_mm=0.25` through the decision tolerance
   (cad_khana: 0.24999999999999983, fails [M]). The users' `-1e-6`
   workarounds (`coupons.py:135`, `snap_coupon.py:59`) become unnecessary.
   Fit classes are measured on declared interfaces (face sets or regions), not
   as the global minimum of the pair, because a seated slider touches its stop
   while its guide flanks keep their play (5.1).
6. **`status ok` next to an overlap cannot happen.** `check()` classifies every
   pair and every overlap component. An overlap component that no assertion
   expects fails the report. Expected overlaps are bound to a region and
   bounds; a second collision of the same pair outside that region still
   fails. Alternate states of a part are poses with their own API (7 of 39
   stored `mechanism.json` files have 25 overlaps under `status: ok`
   [M, corpus-usage]).
7. **Waivers are local, reasoned and visible.** A waiver names a check, a
   stable wonky id (face, edge, logical face or part pair), a reason and
   optionally an area budget; it shows in every report, alarms when its hidden
   area grows and turns into an ordinary finding when its target no longer
   exists. Whole-part threshold switch-offs (`overhang_max_deg=91` in 52 of
   175 outputs, `wall_min_mm ≤ 0.05` in 17 [M]) are still accepted from old
   files, but every run prints a `WAIVED` line with the area they hide, and
   `--strict` becomes the default on a date Marc sets (decision 14.6).
8. **The printability rules come from the geometry, not from a mesh.** Overhang
   bands are exact per face (a 45° countersink passes like a 45° planar
   chamfer); the bore exemption and the two-probe bridge test are replaced by
   one bridge rule along an anchored direction (every chord of the region in
   that direction ends on anchored material and is within the profile's span;
   a horizontal bore's chord is circumferential, independent of the bore
   length). v1 is a geometric pre-check; a support-free release additionally
   needs the layer-and-anchor test of K8b (5.7). Wall thickness is the
   distance between opposed faces with certified witnesses, and knife edges
   are reported as what they are instead of as a 0.05 mm "wall".
9. **One printer profile drives both the doctrine and the checks.** Fit classes
   (0.2 mm per side sliding, 0.1 mm at rib line contacts), minimum walls, the
   overhang angle, bridge span and anchor length, first-layer height, house
   style radii: every number the doctrine states is a profile field, with its
   provenance (`starter`, not yet calibrated, or `calibrated` from a coupon).
10. **Two call contracts, both honest.** The compat `check()`/`inspect()` keep
    cad_khana's exception contract by default: the host records the result,
    writes the JSON, then raises `SystemExit` on a failing record, because
    Marc's files depend on it (the cad-project-046 fingerprint cache drops an entry
    only on `SystemExit`; with a non-raising return its second run skips all
    five failed checks [M, `tmp/khana/review-workflow/consumer-probe.json`]).
    Run to completion is opt-in (`--collect`, or `options.collect` in the
    spec) for files that do not depend on the exception. Either way the host
    reports every record it made, marks exports written after a failing check,
    and flags reused JSON files whose status is not `ok`. The compat JSON keeps
    schema `0.2` only when every value is representable in 0.2; otherwise it is
    written as the versioned extension `0.2+wonky.1` (7.2).
11. **Tooling becomes one loop, step by step.** `wonky view` (already better
    than OCP plus `watch.py`) runs the main block with checks and shows
    verdicts and witnesses live; it replaces `khana view`, `watch.py` and
    `khana check`. The separate slicer-export script is replaced only once a
    manufacturing declaration (part definition, variant, print pose, count,
    target path, checked revision) is in place and tested on a real project
    (5.15, K6b); until then `uv run <part>.py` stays. STEP keeps names, colors
    and the assembly tree (khana's STEP loses all three [M]); GLB needs no
    external binary; `wonky diff` compares revisions including checks within
    each value's tolerance.
12. **Order of work.** 34 packages (section 11), each sized for one
    checkpointed run. K17a to K17c and K18 need the r20-gate hybrid Boolean;
    K14 and K15 use only the committed print mesh (bands and discs) and refuse
    other faces by name until r20's print-mesh work lands; enclosed voids need
    a multi-shell body format (K21), not r20. K1a and K1b are a bounded pilot:
    the check contract and the live loop on models that build today
    (`pin_hinge/assembly.py`, the cad-project-003 coupons), not a replacement of
    Marc's daily loop. K3 to K5 then deliver the mechanism assertions for
    plane, cylinder and cone parts. Marc's own projects switch only when their
    modeling prerequisites (fillets and chamfers for `cad-project-033` and
    `cad-project-026`) exist, which is kernel work outside these packages
    (section 12).

## 2. First principles: what Marc needs

### 2.1 What the evidence says Marc actually does

| observation | numbers | source |
| --- | --- | --- |
| Named assemblies with pairwise no-collision declarations dominate | `with_part` 202, `assert_no_interference` 183, `Assembly` 57, `check` 54, `assert_clearance` 22, `assert_interference` 14 customer sites | [M] `tmp/khana/corpus-usage/usage-addendum.json` `customer_counts.by_name` |
| Every `check()` return is ignored; the JSON, exports and exit matter | 54 of 54 | [M] corpus-usage findings `result_consumption` |
| `inspect()` returns are read only for `.status` | 26 of 73 sites; 2 reread the JSON after `except SystemExit` | [M] ibid.; `cad-project-003/overnight-2026-09-05/experiments/lateral_preload.py:89-91` [C] |
| Failing printability is mostly the wall check | 61 of 175 outputs fail: wall only 55, overhang only 2, both 4 | [M] corpus-usage `stored_outputs.printability_metrics` |
| The checks are switched off globally when they are noisy | overhang threshold ≥ 90° in 52 of 175; wall ≤ 0.05 mm in 17; 30 outputs report a wall < 0.1 mm, almost all at the 0.05 sliver floor | [M] inventory-printability.md §8 |
| Advisory output is mostly edge warnings and bore notes | rim warnings in 149, sharp vertical in 118, 1980 bore records, 0 pins, 0 voids, 0 floating solids | [M] ibid. |
| Overlaps hide behind `ok` | 7 of 39 `mechanism.json` with 25 overlap rows, 5 asserted, 20 not; several are alternate poses of one part | [M] inventory-mechanism.md §13 |
| Motion is checked by hand-rolled sweeps, always linear | `coupons.py:165-168`, `neustart/robot.py:194-200`, `preload_z/coupon.py:120-124` | [C] ibid. |
| Checks run on proxies while detailed parts are exported | `cad-project-046/assembly.py:128-148`, `project-component-d753d790 README:603-604` | [C] corpus-usage |
| The FeatureScript customer has its own mesh check library | PASS/FAIL/UNRESOLVED, revolute/prismatic/path/coupled joints, certified sweep bounds, fit rules, keep-outs | [C] `R20/checks/README.md:12-75`, `status.py:6-19`, `rules.py:1-19`, `clearance.py:1-18` |

### 2.2 What makes a verdict trustworthy

A check earns its place only if all of these hold [I, following prior-art
rank 1 and the `R20/checks/errors.py:1-5` rule "a geometric violation is never
an exception; a raised error means no result"]:

1. **Defined quantity.** It measures something with a definition that does
   not depend on a mesh, a sample density or a probe offset.
2. **Sound decision.** `pass` only when the value is on the right side of
   the threshold in closed form with a stated allowance or by a verified
   enclosure; a missing capability or an undecided interval is never `pass`,
   and a waiver never turns an undecided result into one.
3. **Witness.** Every `fail` and every measured value names where: the stable
   wonky ids of the faces, edges or pair involved and exact points.
4. **Scale-free tolerance.** Tolerances are lengths or angles stated in the
   report, never a volume epsilon whose meaning changes with part size.
5. **Few false alarms.** A rule that flags correct geometry trains the user to
   switch it off (52 of 175 overhang switch-offs). A heuristic that cannot
   meet 1 to 4 becomes an advisory with its own label, or it is dropped.
6. **Locally waivable.** A known exception can be accepted at the place it
   occurs, with a reason, without disabling the rule for the rest of the part.

### 2.3 The core

| # | check | question it answers | verdict | replaces in cad_khana | trust basis |
| --- | --- | --- | --- | --- | --- |
| C1 | **pair relation** | how do two placed parts (or two declared interfaces of them) relate: separated (distance), touching (contact kind, faces), overlapping (witness point, components, depth where closed form, volume), contained, unresolved | gate (through assertions) | `a & b` + volume epsilon, `distance_to`, `NoInterference`, `Clearance`, `ExpectedInterference`, `_interference`, `face_relations.min_distance_mm` | witness-based relations under one length tolerance in the relative frame; closed forms and certified 1-D search for plane/cylinder/cone cells (kernel-gaps.md §6); an explicit face-face crossing test; face-interior cone-cone pairs `unresolved` in v1; solid semantics |
| C2 | **assembly coverage** | is every overlap component of every pair covered by an assertion bound to its region | gate | `compute()` all-pairs interference list; `status` rule | C1 over all pairs with broad phase |
| C3 | **poses** | is each alternate state of a part clear of the rest | gate | pose ghosts as extra parts, per-pose `check()` calls | C1 per pose; an explicit base pose; assertions bind to one pose unless they say `@*` |
| C4 | **motion** | does the pair stay clear over the whole declared joint range | gate | sampled `factory(t)` + `check()`, hand-rolled lifts | joint-invariant contact families removed by certificate, then C1 lower bounds minus a displacement upper bound, subdivision (as `R20/checks/clearance.py:9-16`) |
| C5 | **part facts** | volume, bounds, area, centroid, counts, lumps, validity of each part | data | `PartDiagnostics`, `compute()` part rows, `is_valid` | Bend measurements with labels; host triangulation sums only as `estimate` |
| C6 | **overhang, bridges, bed** | which downward regions of a printed part need support in this orientation | gate (v1: geometric pre-check; support-free release after K8b) | `detect_overhang`, `self_supporting`, bore and bridge exemptions, plate test | exact per-face bands, anchored-direction chords, defined anchors, exact bed level; layer-and-anchor test in K8b |
| C7 | **walls and thin features** | is every wall at least the profile's minimum; where are knife edges | gate (walls, knife edges) | `min_wall` ray sampling, `detect_pins` diameter note | distances between opposed sub-bands of faces; fail witnesses certified by segment hits; coverage stated; dihedral angles in closed form |
| C8 | **edge and house-style audit** | which edges break the doctrine (sharp vertical edges, undeburred rims, feather edges, unfilleted notches) | advisory, feather edges gate | `sharp_vertical_edges`, `sharp_rim_edges` | convexity and dihedral angle on every edge type, smooth versus sharp under a stated angle tolerance |
| C9 | **lumps** | is a printed part one connected solid | gate | `floating_solids`, `enclosed_voids` | topology; all body pairs of the part through C1 |
| C10 | **bores as data** | which holes exist, their axis relative to up, and which fit-critical horizontal bores are not teardropped | data plus doctrine advisory | `detect_bores` notes | carrier data, grouped under a stated coaxiality tolerance |
| C11 | **orientation** | which up directions trade support, bed contact, bore quality and height how | advisory | `suggest_orientation`, `score_orientation` | exact moments on the admitted faces; ties reported |

**Dropped or merged, with the reason:**

- **The volume epsilon as a verdict** (`INTERFERENCE_VOLUME_EPSILON_MM3`): not
  scale-free (2.2 rule 4). Replaced by C1's contact tolerance; the volume
  stays a reported value.
- **Pins as their own check** (`detect_pins`): zero findings in 175 real
  outputs [M]; a thin pin is a thin wall (a cylinder's diameter is an
  opposed-face distance of C7). The compat `pins[]` array is generated from
  C7's thin-feature findings.
- **Slenderness `L/D ≥ 8`**: never fired, no physical calibration; kept only
  as a note on a C7 thin-feature finding, never a gate.
- **The ray-sampled minimum wall as a gate**: it can prove a thin wall but
  never a thick one, and its self-hits, sagitta errors and the 0.05 floor
  produce the false alarms that made Marc disable it [M]. It survives only as
  an optional `estimate` channel in C7 that can add a violation witness.
- **The ≤ Ø12 small-bore exemption**: unconditional, orientation-blind,
  exempts inner fillets and slots [C, M]. Replaced by C6's bridge rule applied
  to bore ceilings.
- **The two-probe bridge test**: fails on thin walls and rotated slots [M].
  Replaced by C6's anchored chord families with defined anchors (5.7).
- **Tessellation types and constants** (`Triangle`, `tessellate_tagged`,
  `TESSELLATION_*`): no check reads triangles. The certified print mesh stays
  for display and exports.
- **Enclosed voids as a separate check**: a committed wonky body is one
  connected shell and a Boolean that would create a void is refused
  (`HEAD:src/analytic.mjs:280` "disconnected shells", `HEAD:src/boolean.mjs:205`
  "enclosed void shells are not implemented" [C]), so the answer is "0 by
  construction" with that reason recorded; C9 covers lumps. If a multi-shell
  body format ever arrives (K21), void checks come with it.
- **OCCT-index pick** (`describe_*`, `face_relations` on OCCT indices):
  replaced by the viewer's exact measurement on revision-bound aliases (section 8, row `khana pick`).
- **Regex hints over OCCT text** (`match_hint`): replaced by hints keyed on
  wonky's structured capability codes.

## 3. Result model

### 3.1 Verdicts

| verdict | meaning | compat `passed` | counts as ok |
| --- | --- | --- | --- |
| `pass` | on the right side of the threshold: closed form with its stated allowance, or a verified enclosure (3.2) | `true` | yes |
| `fail` | a witness on the wrong side, itself certified (a witness point, a segment with certified hits) | `false` | no |
| `unresolved` | the interval straddles the threshold after refinement, or coverage is incomplete (some faces have no admitted partner) | `false` | no |
| `refused` | a capability error: a primitive does not cover the geometry (for example a torus face before r20); names the stage and the entity | `false` | no |
| `not-run` | the user chose `--checks=skip` (decision 12 semantics, 6.2) | `false` | no |
| `waived` | would be `fail`, but a matching waiver with a reason covers every witness and its budget holds | `true` | yes, listed |
| `waived-unresolved` | would be `unresolved`, and a waiver covers the undecided cells | `false` | no: counted apart in the chip, exit code 2 |

Aggregation: `fail` beats `unresolved` beats `waived-unresolved` beats
`refused` beats `not-run` beats `waived` beats `pass`; an empty set is
`unresolved` (nothing was proven), the rule of `R20/checks/status.py:9-19` [C]
extended by wonky's states. A waiver can turn a proven violation into an
accepted one; it can never turn an undecided result green.

In Python the compat `.status` carries the aggregate: `ok` (pass and waived
only), `assertion_failed` (a `fail`), `unresolved` (an `unresolved` or
`waived-unresolved`), `refused` (a `refused`, nothing worse), `not-run`. A
model that branches on `.status` can therefore tell "wonky cannot answer
this" from "the answer lies inside the tolerance band" (review M10).

### 3.2 Values and exactness labels

Every number is an interval `[lo, hi]` with one label [I, extending
kernel-gaps.md §5 and keeping `src/volume.mjs`'s labels]:

| label | meaning | may decide a gate |
| --- | --- | --- |
| `exact` | closed form in `R.Real` (F32x2) plus a stated arithmetic allowance derived for that primitive (`lo`, `hi` differ by that allowance only) | yes |
| `bounded` | an enclosure from a verified procedure (1-D branch and bound with a Lipschitz bound, certified mesh with proven two-sided deviation), plus the same arithmetic allowance | yes |
| `estimate` | a numerical estimate without a proof (today's `kernel/volume.bend` quadrature error, sampled rays, the host's binary64 triangulation sums of `src/brep.mjs:184-194`) | only to prove a violation through a certified witness, never to pass |
| `approximation` | computed on a certified-mesh body (`geometry: 'mesh'`); deviation stated | like `bounded` if the deviation is proven, else like `estimate` |
| `refused` | no value; capability code and entity | no |

**What `exact` means.** `kernel/real.bend:1-155` has no interval type and no
directed rounding; `atan`, `sin` and `cos` are truncated series without a
remainder term, and there is no `asin` or `acos` [C]. `exact` is therefore
"closed form plus a stated allowance", the same kind of guarantee the kernel
already gives (`src/kernel.mjs:212`, `requiredMm <= allowanceMm` [C]), not a
machine-checked proof. Each primitive of 4.2 states its allowance in its K
package: the double-single operation error bounds of the words it combines,
the remainder of every series it evaluates, and the 48-bit π of
`reduce_angle`. Gate predicates are kept polynomial wherever possible
(compare `−n·u` with `sin α_max`, squared distances, expansion signs) so that
no series enters a verdict. The practical margin is large: `decide_mm = 1e-6`
is about six orders above the F32x2 error at part scale [I, review m1].

The guard from prior-art.md applies: the current `Measured.bound` of
`kernel/volume.bend` is built from whole-versus-halves quadrature estimates
(`kernel/volume.bend:666-736`) and sampled pole guards (`:840-901`) [C], so
volumes from quadrature carry `estimate`, not `bounded`, until an enclosure is
proven. Closed-form volumes of plane, cylinder and cone bodies are `exact`;
committed Bend already measures planar Boolean results
(`HEAD:kernel/halfspace.bend:599` `volume`, `:918` `measured`;
`HEAD:kernel/boolean.bend:263`; `HEAD:kernel/ports/curved-metrics.bend:185`
[C]), and `transformAnalytic` carries those volumes along
(`src/analytic.mjs:152-166` [C]). C5 takes its facts from these Bend
measurements.

Each record also carries the input bodies' own labels (`exact`, `regularized`,
`quantized`, `approximate` from `src/exactness.mjs:1-17` [C]): a distance
between two `quantized` bodies is exact for the bodies as represented, and the
report says so.

### 3.3 Tolerances

Stated tolerances, all written into every record:

- **Contact tolerance** `contact_mm`, per pair: `max(1e-6 mm, deviation(A) +
  deviation(B)) + transform(A, B)`. The deviation is what the bodies state
  (`construction.profileQuantization.maxDeviationMm`, regularization, hybrid
  `boundaryDeviationMm`); 1e-6 mm is build123d's `TOLERANCE` and cad_khana's
  `EPS` [C, inventory-printability.md §3]; the second term keeps a designed
  flush contact between two F32-quantized profiles (up to about 1.6e-6 mm,
  `src/exactness.mjs:20-30` [C]) from reading as an overlap.
  `transform(A, B)` is the rounding bound of the *relative* placement of B in
  A's frame, derived in Bend (K4c): the orthonormality defect of the F32x2
  rotation matrix times the largest coordinate magnitude of B, plus the
  translation rounding. It is 0 only when the relative placement is the
  identity (both parts carry the same placement). Today no such bound exists: rigid copies carry their
  exactness fields unchanged (`src/exactness.mjs:15-16`, `src/analytic.mjs:140-166`
  [C]), and a 2.9e-14 mm transform offset already made a flush contact refuse
  in the planar arrangement (`src/kernel.mjs:137-148` [C]).
- **Decision tolerance** `decide_mm` (or `decide_deg`) for thresholds:
  `pass` iff `lo ≥ threshold − decide`, `fail` iff `hi < threshold − decide`,
  else refine and then `unresolved`. Default `1e-6 mm` and `1e-6°`, so design
  intent that lands on a threshold passes (cad_khana's documented intent,
  `inspect.py:28` [C]) and the 0.25 pin/bore gap passes `min_mm=0.25`.
- **Smooth-edge tolerance** `smooth_deg` (default 0.5°): an edge whose
  interior dihedral angle is within `smooth_deg` of 180° is tangent (smooth);
  F32x2-built fillet edges never give an exact zero test (review m3).
- **Coaxiality tolerance** `coaxial_mm` and `coaxial_deg` (defaults 1e-4 mm,
  1e-3°): axes closer than that are one bore group (C10). Separately computed
  coaxial bores do not pass an exact coincidence certificate.

Neither `contact_mm` nor `decide_mm` is a manufacturing allowance. Process
effects (hole shrinkage, elephant foot, sag) live in the printer profile
(5.6), never in these numbers (prior-art `doNotAdopt[0]`).

**Relative frames.** Every pair is evaluated in the frame of one of its two
parts: B's words are mapped through the relative placement `P_A⁻¹ P_B`, and
the Bend call receives that placement, not two world placements. Parts moved
together by one `Location`, one joint or one pose (the rotated probe of
`tmp/khana/oracle/probe/numerics2.py:24-31` [C]) then have an identity
relative placement, and their flush contact is evaluated on the words as
built.

### 3.4 Witnesses and identity

A witness is `{bodyId, alias, identity, point}` per side: `alias` is the
viewer's revision-bound alias (`B1.F3`, logical face `B1.L2`, edge `B1.E7`),
`identity` the entity's `originId`/`instanceId` from
`kernel/identity.bend:6-19` and `docs/topology-identity.md` [C]. Aliases are
bound to the model hash, not to a push (inventory-tooling.md §11 row 12). A
waiver or a review comment refers to the identity; the viewer carries it to
the next revision with `POST /resolve` or reports why it cannot
(`docs/viewer/thickness-probe.md` "New revision" [C]). OCCT topology indices
are never produced.

### 3.5 Coverage

Every check states what it covered: pairs examined versus pruned, faces with
an admitted partner versus faces without, the joint interval proven versus
unresolved sub-intervals. Incomplete coverage turns a would-be `pass` into
`unresolved`, never into `pass` (prior-art rank 4: "unsampled pinches cannot
produce a certified pass").

## 4. Architecture

### 4.1 Layers

```text
 frontends                    host (src/, JS)                         kernel (kernel/, Bend)
 ─────────                    ───────────────                         ──────────────────────
 Python model  ─┐             check spec   (wonky-checks/1)           check modules  kernel/check/*.bend
  cad_khana     │  records    printer profile (wonky-print-profile/1)   pair · motion · overhang · wall
  compat pkg    ├──────────▶  name → body resolution, poses, joints      edges · bores · orientation
 FeatureScript  │             scheduler, pair cache, waivers   ──calls─▶        │ uses
  + sidecar     │             report writer (brep.json checks,                  ▼
 WK/0 records  ─┘              compat JSON, stderr, exit code)         query primitives kernel/measure/*.bend
                              viewer query worker `checks`               face facts · bounds · convexity
 CLI / viewer  ─────────────▶ overlays (witness lines, regions)          membership · ray hits · distance
                                                                         contact · crossing · placement bound
```

The split follows AGENTS.md line 4 ("the geometry kernel must remain entirely
in Bend") and the prior-art boundary "Bend owns geometric facts; host owns
schema, presentation, profile selection and coordination"
(`literature-synthesis.json` rankedIdeas[0].implementationBoundary [C]).
The rule: **every geometric predicate, measurement and threshold decision is
made in Bend; the host only combines Bend-issued verdicts and intervals.** The
host passes thresholds, tolerances, waiver targets with their budgets and the
profile's calibration offsets in, and receives a verdict, an interval and
cells (vertex, edge, face indices of the Bend body). Waiver budgets, their
growth against the previous revision's Bend-issued area and fit predictions
from calibration are therefore decided in the Bend check call, not in the
host. The host maps cells to identities, matches waivers by identity (a set
operation), aggregates verdicts, and for `wonky diff` and the advisory
orientation Pareto set only orders and overlaps Bend-issued intervals. It
never computes a distance, angle, area or volume. Today's host facts of
`src/brep.mjs:184-194` (binary64 sums over a triangulation of polyhedral
bodies) are labelled `estimate` and never gate.

### 4.2 Bend query primitives

"Exists" cites the sibling audit; module names are proposals. "v1" means
plane, cylinder and cone faces bounded by lines, circles and ellipses, the
production surface set on committed HEAD (`kernel/analytic.bend:21-26`;
Sphere and Torus are uncommitted r20 work [C, kernel-gaps.md §3.1]).

| id | primitive | module | exists today | exactness | v1 coverage | r20 needed for |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 | outward normal at a point, face area, area centroid, angular extent (winding about an axis) | `kernel/measure/face.bend` | carrier data only; `ring_area` for plane/cylinder returns 0 for other carriers (`kernel/ports/curved-metrics.bend:144-151`) [C] | `exact` on plane (lines, arcs, ellipse arcs), cylinder (rulings, parallels, plane sections), cone (rulings, parallels); cone plane sections `bounded` by certified 1-D search | plane, cylinder, cone | sphere (quadrature), torus |
| Q2 | support function `h(body, e) = max p·e`, face and body bounds along any direction | `kernel/measure/bounds.bend` | conservative directional face bounds exist and are committed (`kernel/face-bounds.bend`, `kernel/curve-band.bend` [C]; "an exclusion filter", `face-bounds.bend:9-11`); tight bounds for frusta and polyhedra only, curved bodies refused in Python (`src/python.mjs:95-101`) [C]; the viewer's `boundEdgePlaneBand` edge extremes (`src/viewer/printability.mjs:26-28`) [C] | conservative bounds reuse `face-bounds.bend` for the C2 broad phase; tight `exact` bounds from edge extremes plus interior critical points (kernel-gaps.md P10) | plane, cylinder, cone | sphere, torus |
| Q3 | edge convexity and interior dihedral angle range | `kernel/measure/convexity.bend` | fillet proto only, one point per edge (`kernel/proto/fillet-kpart/ladder.bend:31-40`, uncommitted) [C] | sign of `(n1 × n2)·t` with coedge orientation, `smooth` when the angle is within `smooth_deg` of 180° (3.3; no exact zero test is relied on); angle range closed form for lines and coaxial circles, closed-form extremes on ellipses, `bounded` otherwise | all edges between v1 faces | edges on sphere, torus |
| Q4 | point membership in a trimmed face and in a solid | `kernel/cone-classification.bend` (new), `kernel/solid-classification.bend` (extend `supported`, `:145-152`) | plane and cylinder only; cone answers `Unresolved UnsupportedSurface` [M, kernel-gaps.md P4]; 6 to 11 ms per point on JS | decision with stated allowance, or `Unresolved` | plane, cylinder, cone | sphere, torus |
| Q5 | ray and segment hits on trimmed faces, sorted, with contact kind | `ray_hits` next to `kernel/ray.bend` | supporting-surface roots only (`kernel/ray.bend:312-335`), no trims [C] | closed-form roots (plane linear, cylinder and cone quadratic); roots from a search are isolated by exclusion (an interval is dropped only if `\|f(mid)\| > L·w/2`), and an interval that is neither excluded nor sign-changing is `unresolved`, so a tangent double root never flips a parity test | plane, cylinder, cone | sphere (quadratic), torus (quartic, by exclusion) |
| Q6 | minimum distance between two bodies, two faces of one body, or a body and an axis; solid semantics; witnesses as cells | `kernel/measure/{foot,search,pairs,cells,distance}.bend` | nothing; the Morton tree and join of `HEAD:kernel/proto/recover/clear.bend` (`:255-355`, `cross` `:519-560`, a triangle threshold join) are copied into `kernel/measure/` (the r20 work deletes that path and adds a byte-identical untracked `kernel/hybrid/recover/clear.bend`; K4b imports neither) [C, M] | `exact` where every surviving cell pair is closed form, else `bounded` (certified 1-D search, kernel-gaps.md §6.5); face-interior cone-cone and cone-torus pairs are `unresolved` in v1 (no closed-form line-cone distance exists, so they are 2-D searches; see 5.1 coverage) | plane, cylinder, cone cells except cone-cone interiors | sphere, torus cells; certified-mesh bodies (K18); nested certified search for cone-cone (later) |
| Q7 | tolerant contact families: the boundary distance is at most `contact_mm` and no overlap witness can exist | inside `distance.bend` | none; the exact certificates of `kernel/intersections.bend:253-266` are zero tests with no tolerant variant, and the hybrid refuses face-touching intersections by design (`docs/hybrid-boolean-plan.md:304`) [C] | closed form: opposed near-coplanar planes whose signed separation at every vertex of the overlap region lies in `±contact_mm`; plane with cylinder or cone, and parallel cylinders, with `\|d − r\| ≤ contact_mm` along the contact ruling; coaxial cylinders with `\|r_A − r_B\| ≤ contact_mm`; coaxial cones with equal half-angle whose apexes differ by at most `contact_mm` along the axis (a countersunk head in its countersink) | those families | sphere tangencies |
| Q8 | overlap volume of two bodies | INTERSECTION Boolean plus Bend volume | planar INTERSECTION committed (`HEAD:src/boolean.mjs:92-125` [C]); curved arms and `kernel/volume.bend` are uncommitted (`src/boolean.mjs:307-350`, `kernel/volume.bend` [U]) | `exact` closed form on plane, cylinder, cone results; quadrature is `estimate` (3.2) | polyhedral pairs | every curved pair (K17a) |
| Q9 | plane section of a body | `kernel/section.bend`, `kernel/face-plane.bend` | planes and cylinders only: `prepare_surface` answers `UnsupportedSurface` for other carriers (`kernel/face-plane.bend:156-167`), `orientation_family` knows planes and cylinders (`kernel/section.bend:192-203`) [C] | `exact` contours on planes and cylinders; cone sections (circle, ellipse) new in K3d; hyperbola and parabola sections are refused by name, because the curve set is `Line \| Circle \| Ellipse` (`kernel/analytic.bend:8-11` [C]) | plane, cylinder, cone after K3d | sphere, torus |
| Q10 | anchored-direction chord test of a planar region: for a direction `d`, is every chord of the region parallel to `d` ended by anchored boundary at both ends and at most a span | `kernel/check/overhang.bend` (inside C6, not a separate primitive) | none | closed form for line and arc boundaries (chord lengths along `d` are piecewise linear or square-root in the sweep parameter; extremes at vertices and arc tangencies) | lines, circles, ellipses | |
| Q11 | upper bound of a body's distance from an axis | `kernel/measure/bounds.bend` | none | upper bound only: vertices, `dist(centre, axis) + r` for circles, box corners; no exact maximum is needed (C4 uses it as a displacement bound) | plane, cylinder, cone | sphere, torus |
| Q12 | coaxiality and equal-radius predicates | reuse `kernel/intersections.bend` certificates (`perpendicular_certificate :243`, `coincidence_certificate :253`) [C] as the exact case, plus a tolerant test under `coaxial_mm`/`coaxial_deg` (3.3) | exact certificates exist | tolerant decision with stated allowance | all carriers | |
| Q13 | face-face crossing: do the interiors of two trimmed faces cross | `kernel/measure/crossing.bend` | none | for each face pair whose conservative bounds overlap: intersect the carriers (closed form for plane with plane, cylinder or cone: lines, circles, ellipses, and hyperbola or parabola arcs held inside the module; the `kernel/intersections.bend` families for cylinder-cylinder; otherwise a 1-D search of the second carrier's implicit function along a parametrization of the first, where a sign change proves a crossing and exclusion proves its absence) and test one point of each component against both trims (Q4). Undecided is `unresolved`, never "no crossing" | plane, cylinder, cone | sphere, torus (K17b) |
| Q14 | rounding bound of a relative rigid placement | `kernel/measure/placement.bend` | none (`src/exactness.mjs:15-16` [C]) | stated bound: orthonormality defect of the F32x2 matrix times the coordinate magnitude plus the translation rounding; 0 for the identity | all | |

### 4.3 Bend check modules

One module per rule. Each takes bodies, the relevant profile fields and the
decision tolerances, and returns a record `{verdict, value [lo, hi], label,
cells, coverage, refusals}`. No module reads a mesh.

| module | check | built on |
| --- | --- | --- |
| `kernel/check/pair.bend` | C1 pair relation, overlap components, the assertion verdicts including region-bound interference and interface fits | Q2, Q4, Q6, Q7, Q8, Q13, Q14 |
| `kernel/check/broad.bend` | C2 broad phase: `apart(a, b, margin)` on conservative boxes | Q2 |
| `kernel/check/motion.bend` | C4 clearance over a joint interval, joint-invariant contact families | Q6, Q7, Q11, Q14 |
| `kernel/check/overhang.bend` | C6 overhang regions, anchored bridges, bed, first layer, layer-and-anchor test | Q1, Q2, Q3, Q9, Q10 |
| `kernel/check/wall.bend` | C7 walls on opposed sub-bands, air gaps, knife edges | Q1, Q3, Q4, Q5, Q6 |
| `kernel/check/edges.bend` | C8 edge and house-style audit | Q1, Q3 |
| `kernel/check/bores.bend` | C10 bore inventory | Q1, Q2, Q12 |
| `kernel/check/orientation.bend` | C11 per-candidate metrics | C6, Q1, Q2 |

C3 (poses), C5 (facts), C9 (lumps) need no module of their own: C3 and C9
are C1 applied to specific pairs, C5 is a bundle of Q1, Q2 and Q8 calls.

Bend constraints that shape these modules (kernel-gaps.md §3.4 [C]): names
defined above use, no mutual recursion, fuel-bounded loops with a capability
refusal on exhaustion, `IdVec` tables, and module arity below the 255 limit
of the C emitter (`docs/hybrid-boolean-plan.md:292-295`). Pair families are
split across modules for that reason.

### 4.4 Host

| module (proposal) | role |
| --- | --- |
| `src/check/spec.mjs` | validate `wonky-checks/1` (6.1), resolve part names and paths to bodies, reject unknown and ambiguous names at the declaring line |
| `src/check/inputs.mjs` | one loader for every frontend: sidecar check spec, waiver file, printer profile, with the precedence of 6.1; returns the files it read with their SHA-256 so the live session watches them (K6a) |
| `src/check/profile.mjs` | validate `wonky-print-profile/1` (5.6), apply per-call overrides (`FDM(...)`), record provenance |
| `src/check/engine.mjs` | schedule Bend calls, broad phase over parts, pair cache keyed by `(body revision A, body revision B, relative placement, query kind, tolerances, kernel fingerprint)`, legacy and collect modes (6.2) |
| `src/check/waivers.mjs` | match findings to waivers by identity (set operation), orphans; budgets and growth are decided in the Bend call (4.1) |
| `src/check/manufacture.mjs` | the manufacturing declaration (5.15): targets, their checked revision, proxy relations, stale and unchecked exports |
| `src/check/report.mjs` | `brep.json` `checks` block, stderr lines, exit code, run manifest |
| `src/check/compat-khana.mjs` | `mechanism.json`, `<name>-printability.json`, `<name>-orientation.json`: legacy 0.2 or extended `0.2+wonky.1` (7.2) |
| `src/viewer/checks.mjs` | query-worker kind `checks` for the viewer (6.6) |

The bridge op `khana_check` already routes every Python `check()`/`inspect()`
to the host (`src/python.mjs:86`, `:858-880`, `:1005` [C]); it becomes the
entry into `engine.mjs` instead of the not-run recorder.

### 4.5 AGENTS.md compliance

| rule (AGENTS.md) | how the design meets it |
| --- | --- |
| geometry kernel entirely in Bend (line 4) | every predicate, measurement and threshold decision is a Bend module (4.2, 4.3); the host only combines Bend-issued verdicts and intervals (4.1). The viewer's existing JS overhang classification (`src/viewer/printability.mjs:1-33`, closed forms evaluated in the host through `src/real.mjs`) is display logic today; its verdicts move into `kernel/check/overhang.bend` (K8a) and the viewer keeps only the tint |
| OpenCascade only validates exported artifacts (line 4) | the primary oracle is closed-form values derived by hand; the secondary oracle lets OCCT measure wonky's own exported STEP (artifact validation); cad-khana's JSON on its own geometry is a behavioural reference only and never feeds the kernel (section 10); STEP read-back of names, colors and tree through `uv run scripts/validate-step.py` is artifact validation (K14) |
| unsupported functionality is an explicit capability error, also inside `try` (line 7) | a primitive outside its coverage returns `refused` with a code and the entity; the verdict is `refused`, never `pass`; in Python a refused value is a latched `Refused` object that raises the capability error at any use, like today's `NotRun` (`python/cad_khana/_wonky.py:58-111` [C]); dropped calls raise a latched capability error naming the replacement (`_wonky.py:38-48` [C]) |
| no silent polygonization (line 8) | no check reads triangles; the only mesh path (K18, certified-mesh bodies) states its deviation and carries the `approximation` label |
| r10b snapshot byte-identical (line 6) | nothing here touches `fixtures/r10b/` |
| `npm test` and STEP validation (line 9) | every package lists its tests; export packages validate with `scripts/validate-step.py` |
| benchmark stages separately (line 10) | K4a to K4d and K8a acceptance include separate JS and native timings, cold and warm |

## 5. The core checks

### 5.1 C1: pair relation and the mechanism assertions

**Definition.** For placed parts A and B (closed solids), evaluated in A's
frame through the relative placement (3.3), with `contact_mm` of that pair.
The relations are defined by witnesses, so each one is decidable on the words
wonky actually produces (review B1):

| relation | condition | reported |
| --- | --- | --- |
| `separated` | solid distance `d > contact_mm` | `d` as `[lo, hi]`, witness points and cells on both parts |
| `overlapping` | there is a witness point `p` inside both solids with `dist(p, ∂A) > contact_mm` and `dist(p, ∂B) > contact_mm` (a witness ball); certified by Q4 and the point-to-body distance of Q6 | the witness point and radius, the overlap components (connected sets of crossing face pairs from Q13, each with its faces and a witness), depth where the configuration is a closed-form family (plane offset, radial offset of coaxial cylinders), overlap volume when Q8 covers the pair |
| `contained` | one part lies inside the other: solid distance 0, no crossing (Q13), and a vertex of the inner part inside the outer (Q4) | which one, the inner part's volume |
| `touching` | boundary distance `≤ contact_mm`, no crossing (Q13), and every near-contact cell pair belongs to a tolerant contact family (Q7), which rules out a witness ball | "touching within `contact_mm`", contact kind (face, edge, vertex, line, circle), contact faces, contact area where closed form |
| `unresolved` | none of the above can be certified: a near-contact outside the tolerant families, an undecided crossing, a face-interior cone-cone pair, a pair outside coverage | the interval and the undecided cells |

**Algorithm** (Bend). Conservative boxes (Q2, `kernel/face-bounds.bend`)
prune separated pairs. The distance (Q6) decides `separated`. Otherwise the
explicit face-face crossing test (Q13) runs on every face pair whose bounds
overlap; a crossing component with a witness ball gives `overlapping`. With no
crossing, one vertex membership test per direction (Q4) decides `contained`.
The remaining zero-distance cell pairs must all fall into a tolerant contact
family (Q7) for `touching`; otherwise the pair is `unresolved`. No Boolean
runs unless a volume is requested and the pair overlaps.

The crossing test replaces the "lower-strata argument" of kernel-gaps.md
§6-7, which decided `Separated` against `Nested` with one vertex membership
test when `lo > 0`. That argument fails for a crossing along a closed curve
inside both faces: a boss (cylinder r 10, axis z, z ∈ [−10, 10]) and a pin
(cylinder r 3, axis x at y = 11) overlap around (0, 9, 0) with a 1 mm witness
ball, yet with the seams at +x (boss) and +z (pin) every edge stays at least
1.0 mm from the other body, so the vertex test would give a wrong `pass`
[M, review-exactness.md B2].

**v1 coverage of cell pairs** (K4a to K4c; anything not listed is
`unresolved` with the cells named):

| cell pair | distance | crossing | contact family |
| --- | --- | --- | --- |
| vertex with any v1 face or edge | closed form | n/a | n/a |
| line edge with plane, cylinder, cone face | closed form | closed form | plane/plane, ruling on cylinder or cone |
| circle or ellipse edge with plane | closed form | closed form | circle on plane |
| circle or ellipse edge with cylinder, cone | certified 1-D search | 1-D search | coaxial circle on cylinder |
| plane with plane, cylinder, cone face | closed form | closed form (line, circle, ellipse, hyperbola or parabola arc) | near-coplanar, tangent ruling |
| cylinder with cylinder | closed form (parallel, coaxial), else 1-D search | `intersections.bend` families, else 1-D search | parallel tangent, coaxial equal radius |
| cylinder with cone | 1-D search over the cone's generator angle (closed-form line-to-cylinder inner function) | 1-D search | coaxial circle |
| cone with cone, face interiors | `unresolved` in v1 (2-D: no closed-form line-cone distance) | 1-D search | coaxial |

**Assertions** (the compat names keep their meaning; the verdict no longer
depends on a volume epsilon):

| assertion | pass | fail | new |
| --- | --- | --- | --- |
| `assert_no_interference(a, b)` | `separated` or `touching` | `overlapping` or `contained` (certain, with the witness, depth or volume when available) | no |
| `assert_clearance(a, b, min_mm)` | relation `separated` or `touching`, and `lo ≥ min − decide` (and `hi ≤ max + decide` when `max_mm` is given) | `overlapping`, `contained`, or `hi < min − decide` (or `lo > max + decide`), witness segment | `min_mm` may be a fit class name resolved from the profile (5.6); optional `max_mm` turns it into a gap range (R20 `guided_gap`, `R20/checks/rules.py:5-7`) |
| `assert_fit(a, b, fit, faces_a=, faces_b=, region=, direction=)` | C1 restricted to the declared interfaces: the distance between the selected face sets (or both parts clipped to a box `region`) is within the fit class; with `direction`, the free play along that direction is within the fit class's range | outside the range, with the witness segment | yes: fit classes are verified on interfaces, never as the global minimum of the pair (a seated slider has distance 0 at its stop while the guide flanks keep 0.2 mm; `cad-project-003/overnight-2026-09-05/manufacturing/coupons.py:169-173` clips a middle slice by hand for exactly this reason [C]) |
| `assert_interference(a, b, reason, within=, max_depth_mm=, max_mm3=)` | the overlap components inside `within` (face selectors on either part, or a box) exist and respect the bounds | no component inside `within` ("expected overlap absent: reason"), or beyond the bound | `within` binds the expected overlap to its region: components outside it stay `unasserted-overlap` (C2). Without `within` (every legacy call) the assertion covers the whole pair, and the record says "pair-wide expected overlap (legacy), N components" (5.2) |
| `expect_contact(a, b, reason=None, within=)` | `touching` (inside `within` when given) | `separated` (gap witness) or `overlapping` | yes: the lid on the rim, the flange on the plate (`R20/checks/rules.py:8` `flange_contact`) |

A passed `assert_clearance` states the minimum distance of the pair only; the
report never presents it as proof of play or of freedom from wobble. Play is
what `assert_fit` with a `direction` measures.

The overlap volume is a reported value, not the verdict. Where Q8 does not
cover the pair yet (every curved pair before K17a), an `overlapping` verdict
is still certain (it rests on the witness ball) and the volume is `refused`
with the reason.

**Cases it must reproduce** (acceptance of K4a to K4c and K5; oracle rows from
`tmp/khana/oracle/probe/probe.json`, probe2.json [M]; expected values are the
closed forms, section 10):

| case | cad_khana | wonky |
| --- | --- | --- |
| face, edge, vertex touch of 10 mm cubes | volume 0, distance 0 | `touching`, kind face/edge/vertex; `no_interference` pass, `clearance(min>0)` fail with gap 0 |
| 5 mm overlap | 500 mm³ | `overlapping`, depth 5, volume 500 |
| 4 mm cube inside a 20 mm cube | Part distance **8.0**, clearance(min 5) **passes** | `contained`, distance 0, clearance fails |
| Ø3 pin concentric in a Ø3.5 bore | 0.24999999999999983, clearance(0.25) **fails** | `separated`, 0.25 within its allowance, passes |
| gaps 1e-6 … 1e-3 mm placed with `Location((10 + g, 0, 0))` | each measured slightly below itself | each gap within its placement allowance (`10 + g` is not exact in F32x2); passes at `min_mm = gap` through `decide_mm`; a gap at or below `contact_mm` reads `touching` |
| overlap depth 2e-5 on a 10 × 10 contact | fails (0.002 mm³) | `overlapping` (witness ball of radius > `contact_mm`) |
| overlap depth 1e-3 on a 1 × 1 contact | passes (0.001 mm³) | `overlapping`: fails. Intended difference: the tolerance is a length (3.3) |
| `assert_clearance(min_mm=0.0)` on an overlapping pair | passes (distance 0 ≥ 0) | fails: the relation is `overlapping` |
| face-touching pair rotated together by 7°, 30°, 33.3°, 45°, 60°, 89.9° | never interferes | `touching`: the relative placement is the identity (3.3) |
| the same pair where only B is rotated by those angles, and Boolean results translated by decimal offsets (6.73 mm, the case of `src/kernel.mjs:140-144`) | n/a | `touching` within `contact_mm` including the Q14 transform bound; never `unresolved` or `overlapping` |
| boss r 10 and pin r 3 clipping 2 mm (B2), seams at +x/+z and at +y/−y | n/a | `overlapping` with the witness (0, 9, 0) in both seam placements |
| pin through a plate without a hole; cylinder through a tube wall | n/a | `overlapping` |
| a countersunk head in its countersink (coaxial cones, equal half-angle); two chamfer rings (cones on different axes) 0.1 mm apart face to face | n/a | `touching` (coaxial cone family); `unresolved` naming the cone-cone cells (v1 coverage) |

### 5.2 C2: assembly coverage and the report status

`check(assembly)` classifies every pair of placed parts, not only the
asserted ones (cad_khana does the same in `compute()`,
`U/mechanism/diagnostics.py:114-123` [C]). Rules:

1. Coverage is per overlap component, not per pair. An `overlapping` or
   `contained` component that no `assert_interference` covers is a finding
   `unasserted-overlap` with verdict `fail`. An assertion with `within=`
   covers only the components inside its region, so a correct snap tooth
   overlap plus a second, unintended collision between the same two parts
   still fails on the second one (the doctrine's "check all remaining
   neighbour pairs", `cad-fdm-design/references/fit-and-snap-review.md:63-68`
   [C]). A legacy `assert_interference` without `within=` covers the whole
   pair and is reported as such, with the component count, so the reader sees
   what it hides; `--strict` refuses pair-wide expected overlaps. Therefore a
   report with an unexpected overlap is never `ok` (directive item 4). Pairs
   of two poses of one part are excluded (C3).
2. `touching` pairs are listed as information; they never fail. An
   `unresolved` pair without an assertion is an `unresolved` coverage record.
3. A degenerate part (zero volume, a face or shell instead of a solid,
   refused validation) is a finding `degenerate-part` (`fail`), instead of
   cad_khana's silent exemption (`face_as_part` in `probe.json` [M]).
4. Names are validated when declared: an assertion naming an unknown part
   fails at the assertion's own line; two parts with the same path fail at
   the second `with_part` line; a leaf name that is ambiguous across
   sub-assemblies must be written path-qualified (`arm.lever`). cad_khana
   raised `KeyError` at `check()` time with `hint: null` and let duplicates
   self-interfere [M, inventory-mechanism.md §2].
5. When the two parts of an unasserted overlap were built from the same
   shape object, the finding carries the hint "looks like two poses of one
   part: declare it with `with_pose`" (the pose ghosts of
   `cad-project-048`, `cad-project-033`, `cad-project-035` [M]).

The broad phase is Bend's `apart(a, b, margin)` on conservative boxes with
`margin = max(contact_mm, the largest clearance asserted for that pair)`;
cad_khana's O(n²) Booleans ("fine up to about 20 parts", skill `SKILL.md:622`
[C]) become O(n²) box tests plus narrow calls on candidates, cached per pair
of body revisions, so an edit re-checks only pairs with a changed part.

### 5.3 C3: poses

`Assembly.with_pose(part, pose, location)` adds an alternate placement of an
existing part, named `part@pose` (for example `lid@mid_slide`). The placement
given in `with_part` is the base pose, addressable as `lid` or `lid@base`.
Rules:

- each pose is checked against every other part of the assembly, not against
  the part's own placement or its other poses;
- an assertion names exactly the poses it means: `lid` (or `lid@base`) is the
  base pose only, `lid@mid_slide` that pose only, `lid@*` every pose
  including the base;
- the most specific assertion wins: for a pair and pose, an assertion naming
  that pose replaces one naming `@*`; two assertions of contradictory kinds
  (`no_interference` and `interference`) on the same pair, pose and region
  are an error at the second declaration's line;
- a pose pair without an assertion is classified by C2 like any other pair,
  so an overlap in an unasserted pose fails;
- the report groups rows by pose.

This replaces the ghost parts (`slider`, `slider_pushed`,
`slider_pushed_far`) and the per-pose `check()` calls into separate
directories (`preload_z/coupon.py:120-124` [C]). It also expresses
`cad-project-033/assembly.py:36-83` [C] without contradiction: `hood`/`lid`
no interference at the seat, `hood`/`lid@entry` no interference,
`hood`/`lid@mid_slide` and `hood`/`lid@near_seat` expected interference
`within` the detent region (the designed 0.35 mm elastic squeeze), all
other pairs classified. Calling `check()` once per pose keeps working; each
call is a record labelled `sampled pose`.

### 5.4 C4: motion over a joint range

**Joints.** `RevoluteJoint` is kept; `PrismaticJoint(axis, offset_mm)` is
new, because every hand-rolled sweep in the corpus is linear
(`coupons.py:165-168`, `neustart/robot.py:194-200`,
`preload_z/coupon.py:120-124` [C]) and R20's motion spec has `prismatic`
joints (`R20/checks/README.md:58-75` [C]). Joints are recorded in the model
metadata (path, type, axis point and direction in the parent frame, value,
optional limits), which also fixes the tooling gap that no joint reaches the
viewer or an export (`python/cad_khana/mechanism/assembly.py:237-247` [C]).

**Assertions.** `assert_clearance_over(joint, range, a, b, min_mm)` and
`assert_no_interference_over(joint, range, a, b)`, where `joint` is the
dotted sub-assembly path and `range` is `(start, end)` in degrees or mm.

**Algorithm** (`kernel/check/motion.bend`), the sound form of
`R20/checks/clearance.py:9-16` [C], in two steps:

1. **Joint-invariant contacts first.** Contact families that the joint leaves
   invariant are removed with their own certificate before any bisection:
   a plane perpendicular to a revolute axis (flush hinge knuckles), a
   cylinder or cone coaxial with a revolute axis (a pin in its bore), a plane
   parallel to a prismatic direction (a lid sliding on a rim, a slider on a
   rail). The certificate is Q7's tolerant family plus the invariance test
   (normal against axis within `decide_deg`, coaxiality under Q12); the
   record lists each removed contact as "sliding contact within
   `contact_mm` over the whole range".
2. **Displacement bound on the rest.** On an interval `[t0, t1]` of the joint
   value, the distance of the remaining cells at the midpoint is C1's
   `[lo, hi]`; the largest displacement of any point of the moving part over
   half the interval is at most `2 R sin(Δθ/4)` for a revolute joint (R an
   upper bound of the part's distance from the axis, Q11) or `Δs/2` for a
   prismatic joint. The interval is clear if `lo − displacement ≥ min −
   decide`; the pair fails if some sample has `hi < min − decide` or an
   overlap witness (witness: that joint value); otherwise bisect with fuel.

Output: `pass` with the proven range, or `fail` with the first failing joint
value and the minimum found, or `unresolved` with the undecided
sub-intervals. Without step 1 a pair in persistent contact (distance 0 over
the whole range) could never be proven and would end `unresolved` after the
fuel runs out, although nothing collides (review M5). Contacts that are
persistent but not joint-invariant (a cam, a detent ramp) are `unresolved` in
v1 and named as such. Only one varying joint per chain is admitted in v1;
more is `refused` (the same limit as `R20/checks/README.md:72-73`).

Posed bodies are rigid transforms of exact bodies. A rotation by an arbitrary
angle is not exact in F32x2; the Q14 bound of the relative placement at each
sample enters that sample's `contact_mm` and distance interval, never hidden.

`factory(t)` loops that call `check()` per sample keep working; each record
says `sampled`, and the report never calls them continuous (prior-art rank 7).

### 5.5 C5: part facts

Per part: `bbox` (Q2, `exact`), `volume_mm3`, `surface_area_mm2` (Q1 summed),
`center_of_mass_mm`, face/edge/vertex counts (topology), lumps (C9) and the
validation scope that stands in for `is_valid` (a body that fails validation
is never created, `src/analytic.mjs:223-287` [C]).

| fact | v1 | later |
| --- | --- | --- |
| bbox | exact on plane/cylinder/cone bodies (Q2) | sphere, torus (K17b) |
| volume | Bend measurements only: constructor volumes (`validation.volumeMm3`), planar Boolean results (`HEAD:kernel/halfspace.bend:599`, `:918`; `HEAD:kernel/boolean.bend:263`), coaxial arrangements (`HEAD:kernel/ports/curved-metrics.bend:185`), carried through rigid copies (`src/analytic.mjs:152-166`) [C]; curved Boolean results `refused` until `kernel/volume.bend` is committed | K17a: closed form `exact`, quadrature `estimate` |
| surface area | exact on v1 faces (Q1) | K17b |
| center of mass | `refused` (needs the volume moments of `volume.bend`) | K17a |
| counts, lumps, validity | exact (topology) | |
| host sums of `src/brep.mjs:184-194` | `estimate`, reported next to the Bend value for comparison, never used by a gate or by `assert_interference(max_mm3=)` | removed once every body has a Bend measurement |

A refused fact is `null` in the JSON with the capability entry in the
`wonky` block, never a silent 0. In Python it is a latched `Refused` object
(6.2), so `if diag.parts["lid"].volume_mm3:` raises the capability error
instead of taking the falsy branch.

### 5.6 The printer profile, fits and doctrine rules

One profile, `wonky-print-profile/1`, is the single source of every number
the doctrine states and every check reads. Fields (from prior-art
`dfam-checker-rules.profileRecommendation` and the doctrine
[C, `~/.claude/skills/cad-fdm-design/SKILL.md:154-196`]):

| group | fields (starter values) | read by |
| --- | --- | --- |
| identity | `id`, `version`, `provenance: starter \| calibrated`, printer, nozzle 0.4, filament, slicer | every record |
| layers | line width 0.45, layer 0.2, first layer 0.2 | C6, C11 |
| walls | `wall_min_mm` 1.5 (cad_khana default, three perimeters, skill `SKILL.md:567-572`), `feature_min_mm` 0.8, `min_web_mm` 1.0 (doctrine "≥ 1 mm web", `SKILL.md:85-87`), `opposed_min_deg` 120, `pin_min_diameter_mm` 2.0 | C7 |
| overhang | `alpha_max_deg` 45 (from vertical; slicer β = 90° − α), `bridge.max_span_mm` 10, `bridge.min_anchor_mm` 0.4 (the length of anchoring boundary measured along the anchor edge, 5.7) | C6 |
| fits (per side) | `sliding` 0.2 (range 0.2 to 0.35 for `assert_fit` play), `rib_line_contact` 0.1, `moving_min` 0.2, `press` (uncalibrated, no default) | C1 via `assert_fit(fit=)` on interfaces, or `min_mm="sliding"` |
| holes | vertical undersize 0.1 to 0.3, horizontal sag 0.1 to 0.2, elephant foot 0.2 | C10 notes, fit predictions |
| style | vertical edge fillet 4.2, deburr chamfer 0.42, feather thickness 0.5, knife angle 60°, notch fillet 2 to 6, overlap skirt 1.0 | C7, C8, C9 |
| calibration | list of `{feature, orientation, printer, material, measured, date, coupon}` | fit predictions |

`FDM(up_axis, wall_min_mm, overhang_max_deg)` is kept and becomes a per-call
override of the profile; the record lists every override. A profile marked
`starter` says so in every report: a fit that passes on nominal geometry is
"nominally clear, not calibrated", never "prints to fit" (prior-art rank 3,
acceptance "no calibration means no guaranteed production-fit pass").

For coaxial pairs the fit row adds the radial and diametral gap (the
viewer's exact-measure rows already compute them, `docs/viewer/exact-measure.md`
hole/boss table [C]) and, with a calibrated profile, the predicted printed
clearance interval. The prediction is computed in the Bend check call from
the calibration offsets the host passes in (4.1).

The profile is loaded by the shared input loader of 6.1 for every frontend,
and the file actually used is a watched input of the live session, so editing
the profile re-runs the checks without touching the model (K6a).

### 5.7 C6: overhang, bridges and bed

**Definitions.** Up `u`, outward normal `n` (carrier normal times
`same_sense`), overhang angle `α = asin(max(0, −n·u))` (vertical wall 0°,
ceiling 90°; the convention of cad_khana and of `src/viewer/printability.mjs:8-12`
[C]). Bed level `h0 = min p·u` over the part (Q2, exact for every up
direction, not the bbox-corner bound of `U/printability/overhangs.py:25-37`).

**Regions.** Per face, the candidate set `{p : α(p) > α_max}` is exact:
planes all or nothing; cylinders and cones one angular sub-band with
closed-form limits for any up direction; sphere caps bounded by circles (K17c);
a torus gives a closed-form band only when `u` is parallel to its axis, so
torus faces are covered for that case only and `refused` otherwise until a
proven quadrature bound exists (K17c) [inventory-printability.md §5.2].
Candidates are clipped by the face's own trim (the viewer already does this
with the face's circle edges, `src/viewer/printability.mjs:21-25` [C]).

**Supported by the bed.** Points with `p·u − h0 ≤ first_layer` are supported
by the plate. The bed contact itself (planar faces with `n = −u` at `h0`) and
the first-layer islands (Q9 section at `h0 + first_layer`) are reported. The
section needs cone sections (K3d): the house style puts a 0.42 mm chamfer
ring, a cone, on almost every circular bottom edge, and today's sections
refuse cones (`kernel/face-plane.bend:156-167` [C]).

**Anchors.** A portion of the boundary of a connected candidate region R is
*anchored* if, across it, the material continues into support: a face that is
not a candidate and goes down from the shared edge (the edge is concave, Q3),
a bed-supported region, or, for a band on a cylinder or cone, the same face
below the band limit. Its anchor length is measured along that boundary
portion; portions shorter than `bridge.min_anchor_mm` do not count. The
anchor length is a property of the boundary, not of the wall behind it, so
C6 does not depend on C7: a 6 mm bridge between 0.4 mm walls is anchored
along the full wall length, and C7 separately reports the 0.4 mm walls.

**Bridges** replace both the ≤ Ø12 bore exemption and the two-probe test.
They are decided on the projection of R on the plane normal to `u`, by chord
families (Q10), not by a convex-hull width:

1. **Pass (bridge).** R is covered by admitted chord families whose chords end
   on anchored boundary at both ends and are at most `bridge.max_span_mm`
   long. Admitted families in v1: parallel chords between two parallel line
   anchors (a slot ceiling in any rotation), radial chords between concentric
   arc anchors (an annular ceiling), and circumferential chords across a
   cylinder or cone band (a horizontal bore, chord `2r sin(half band)`). A
   region may be split into pieces with different families (an L-shaped slot:
   the two legs and the corner), but a chord never ends on a split line.
2. **Fail.** Two provable cases, each with a witness point: (a) `cantilever`:
   all anchored boundary of R lies on one straight line, so no chord through
   an interior point can end on anchors at both ends; (b) `bridge-too-long`:
   some point of R is farther than `max_span_mm / 2` from every anchored
   boundary portion (closed form for line and arc portions), so no admissible
   chord passes through it. `overhang` is a region with no anchor at all.
3. **Otherwise `unresolved`**, naming the piece that no admitted family covers.

The horizontal bore is the important consequence. Its ceiling band is
anchored on both sides along its whole length (the bore wall below the band),
and its circumferential chord `2r sin(half band)` does not depend on the bore
length: at α_max = 45° a Ø12 bore has an 8.485 mm chord and passes a 10 mm
span, a Ø20 bore has 14.142 mm and fails (the centre of its ceiling is
7.07 mm from both band limits, more than 5), the same results cad_khana's
exemption gives for these two sizes, but now from the profile's span, for
slots and inner fillets too, and in every orientation. A Ø6 hole through a
3 mm wall (a screw hole in a thin side wall) has a 4.24 mm chord and passes,
although the band is shorter than its chord; a convex-hull width would have
run along the axis and called it a cantilever [M, review-exactness.md M3].
A teardrop's 45° flanks are not candidates and its apex is a narrow bridge.

**Layer and anchor reachability (K8b).** The surface criterion above does
not prove that an anchor exists when the bridge is printed. K8b adds a narrow
test: an anchored portion at the bridge's lowest height `h` is *reachable* if
the plane section at `h − layer` (Q9) contains a strip of width `line_width`
on the material side along the whole portion, and the material of that strip
has no failing C6 region below `h` (checked in order of height, so there is
no cycle). An anchor that is not reachable does not count, and the bridge is
re-decided. Where the section or the strip test is not covered (sphere,
torus, hyperbola and parabola sections) the bridge is `unresolved`. Until
K8b lands, C6's bridge pass is a geometric pre-check: the record says
`support_free: not certified (layer test pending)`, and no report calls the
part support-free (directive item 4: "layer sections, anchor reachability").

**Verdict.** `fail` if an unwaived region is neither bed-supported nor a
bridge and one of the fail cases proves it; `unresolved` if it is undecided.
Each finding lists face ids, exact area (or a bounded one on cone plane
sections), the α range, the height range above the bed, the reason
(`overhang`, `cantilever`, `bridge-too-long`, `anchor-too-short`,
`anchor-unreachable`) and the witness point.

**Coverage.** v1 covers plane, cylinder and cone faces; sphere faces and
non-axial torus faces are `refused` until K17c, which makes the part's verdict
`refused`, not `pass`.

**Cases** (acceptance of K8a and K8b, from `tmp/khana/oracle/printability/out_g2/`
and `probes.json` [M]; expected values are the closed forms of section 10):

| part | cad_khana G2 | wonky |
| --- | --- | --- |
| `cone_inv_45`, countersink 45° from below | 54.0 mm² / 45.94° and 28.1 / 46.1: **fail** | no candidate: pass |
| `cone_inv_46`, `cone_inv_50` | 276.2 / 46.93, 325.9 / 50.88 | 277.11 / 46, 326.97 / 50 exact, fail |
| `chamfer45_bottom` | pass | pass |
| 6 mm slot rotated 45° in plan | 491 / 90: **fail** | bridge (parallel family, chord 6): pass |
| 6 mm bridge between 0.4 mm walls | 120 / 90: **fail** | bridge, anchored along the wall length: pass (C7 reports the 0.4 mm walls) |
| `cantilever6` | 120 / 90: fail | cantilever (anchors on one line): fail, 120 exact |
| `slot20_bridge` | 800 / 90: fail | bridge too long (centre 10 mm from the anchors > 5): fail, 800 |
| `ell_ledge` | 200 / 90 | 200, fail |
| `cyl_horizontal_r5` lying | 164.4 → 152.1 (non-monotone) | band 157.08 exact minus the first-layer strip |
| `bores_v5_h5_h20` | Ø20 top flagged, Ø5 exempt | Ø20 chord 14.142: fail; Ø5 chord 3.54: bridge |
| ledge with r2 inner fillet | 160 (fillet treated as a Ø4 bore) | 200 minus the fillet's non-candidate part, no bore exemption |
| Ø6 horizontal hole through a 3 mm wall (new) | n/a | bridge, chord 4.24: pass |
| L-shaped 6 mm slot ceiling; annular ceiling 4 mm wide (new) | n/a | bridge: pass (split families; radial family) |
| 6 mm bridge whose anchor wall starts at the bridge height as its own cantilever; the same bridge on walls from the bed; a bridge anchored on a lower bridge (new, K8b) | n/a | `anchor-unreachable`: fail; pass; pass |

### 5.8 C7: walls, air gaps and knife edges

**Definition.** A wall chord of printed part P is a segment from `p` on face
A along the inward normal `−n_A(p)` to the first boundary point `q` on face B,
where the outward normals are *opposed*: the angle between `n_A(p)` and
`n_B(q)` is at least `opposed_min_deg` (120°). Its length is the wall
thickness at `p`. Chords between faces that are not opposed are corners, not
walls. The check passes if every wall chord is at least `wall_min` (or the
stricter `min_web_mm` where the doctrine applies it).

**Sound decision without sampling.** For every ordered pair of faces (A, B)
of P, including A = B and faces that share an edge:

1. **Opposed sub-bands.** Restrict A and B to the sub-bands A′, B′ whose
   normals can be opposed at all (for each point of B′ some normal of A′ is at
   least 120° away, and vice versa). This is the angular band machinery of
   C6: planes are all or nothing, cylinder and cone sub-bands have
   closed-form limits. Faces that share an edge but meet at less than 60°
   (a knife edge) are handled by the knife rule below; for all others the
   sub-bands keep away from the shared edge, so their distance is positive.
   Example: the side plane of a rib and its full-round tip (a half-cylinder
   tangent to both sides) give a sub-band starting 120° from the tangent
   line, at distance `√3 r`, not 0 (review M4).
2. **Bound.** Every wall chord from A′ to B′ is at least as long as the
   distance between A′ and B′ (Q6 on two faces of one body). If that distance
   is at least `wall_min − decide`, the pair passes.
3. **Refine.** If A is a plane, all its chords run in the one direction
   `−n_A`, and their length onto a plane, cylinder or cone B′ is the ray
   height field of B′ over A's trim along that direction: its minimum is in
   closed form (at trim vertices, along trim edges, or at the one interior
   critical point). Self chords are closed form too: a convex cylinder's
   chord along the inward normal is its diameter `2r`, a convex cone's is
   `2ρ cos β` at radius ρ with half-angle β (smallest at the face's smallest
   radius). This decides the full-round tip exactly (the chord is the rib
   thickness `2r`).
4. **Fail.** A chord below `wall_min − decide` is a `fail` only with a
   certified witness: the segment from `p` along `−n_A(p)` to `q` is checked
   with segment hits on all trimmed faces of P (Q5), so no other face cuts
   it, and its midpoint lies inside P (Q4). A double normal found by Q6
   (closest points interior to both faces) is the usual candidate.
5. **Otherwise `unresolved`**, with the pair, the interval and the reason; the
   optional ray channel (Q5 from surface points, labelled `estimate`) may find
   a violating chord, which then goes through step 4.

Enumeration is complete (no face pair is skipped), so a thin wall can never
pass unseen; what can remain is `unresolved`, and K9a's acceptance lists the
case families where it still does. The closed forms give the typical walls
exactly: parallel planes, plane and cylinder with the axis parallel to the
plane (the bore crown: 0.5), parallel cylinders (the web between two bores:
0.4), coaxial cylinders (a tube wall), and a convex cylinder's own diameter (a
pin) [inventory-printability.md §5.1].

**Knife edges.** Two adjacent faces whose convex interior dihedral angle θ is
below `style.knife_deg` (60°, the complement of the opposition rule) produce
wall chords that shrink to zero at the edge. Such an edge is reported as a
knife edge with its angle, length and the width of the zone thinner than
`style.feather_mm`, measured on A from the edge with the chord definition
above: `feather_mm / tan θ` for a straight wedge (0.50 mm at 45°). The wall
minimum excludes that zone explicitly. Following the doctrine "no feather
edges, ever" (`cad-fdm-design/SKILL.md:174-178` [C]) a knife edge is a
`fail` unless waived. This replaces the 0.05 to 0.06 mm "walls" that
cad_khana reports at knife edges and self-hits [M].

**Air gaps.** The same pair enumeration over faces whose outward normals face
each other across air gives the narrowest slot inside a part, reported
separately (advisory, compared with `feature_min_mm`), so a slot is never
mistaken for a wall and vice versa (prior-art `wall-thickness.nativeAdvantages`).
The opposition rule and the sub-bands keep a V-groove's two flanks from
reading as a zero-width slot at the groove root.

**Thin features and pins.** A convex cylinder with a full winding (Q1) whose
diameter is below `pin_min_diameter_mm` is a thin-feature finding with its
exact length; the compat `pins[]` array is this list. The slenderness note
(`L/D ≥ 8`) stays a note.

**Cases** (acceptance of K9a and K9b [M, inventory-printability.md §5.1 and §7];
expected values are the closed forms of section 10):

| case | cad_khana | wonky |
| --- | --- | --- |
| 20 mm plate with Ø60 / Ø100 through bore | 0.0746 / 0.1243 (self-hit) | 20 (the plate thickness; no self-hit exists by construction) |
| bore crown 0.5 below the top | 0.514 → 0.5006 | 0.5 |
| 0.4 mm web between two Ø10 bores | 0.4277 → 0.4008 | 0.4, fail with a certified chord |
| Ø1.5 pin at `wall_min 1.5` | 1.4977: **fail** | 1.5: pass |
| Ø10 boss | 9.984 | 10 |
| cone frustum with a 45° knife rim | 0.0596 | knife edge, 45°, zone thinner than 0.5 mm 0.50 mm wide: fail unless waived |
| `bores_v5_h5_h20` | 2.043 | 2.0 |
| 1.6 mm rib with a full-round tip at `wall_min 1.5` (new) | n/a | 1.6 from the plane refinement: pass, not `unresolved` |
| 90° V-groove in a 5 mm plate (new) | n/a | no air-gap finding (the flanks are 90° apart, not opposed), instead of a 0 mm slot at the root |

The spherical-void case of the printability oracle is not a wall case any
more: a void cannot be built in a committed wonky body (5.10); it moves to
the body-format package K21.

### 5.9 C8: edge and house-style audit

For every edge: convexity and the interior angle range (Q3), classified
against the up axis. An edge within `smooth_deg` of tangent is smooth (a
fillet boundary); only edges beyond it can be "sharp" or "not filleted".
Findings (advisory unless stated):

| finding | rule (doctrine) | cad_khana | wonky |
| --- | --- | --- | --- |
| sharp vertical edge | vertical convex edges get R4.2 (`cad-fdm-design/SKILL.md:79-80`) | LINE edges between two planes only, convexity by two 0.2 mm probes (`U/printability/structure.py:51-97`) | line edges along `u`, convex beyond `smooth_deg` (3.3), not filleted |
| undeburred rim | other non-critical edges get a 0.42 chamfer ring (`SKILL.md:81-83`) | LINE edges only; cylinder rims never counted (Ø20 cylinder: 0) [M] | lines and circles: boss rims, bore mouths |
| knife or feather edge | "no feather edges, ever" (`SKILL.md:174-178`) | reported as a 0.05 mm wall | C7 knife edge: **fail** |
| unfilleted notch | re-entrant junctions get R2 to R6 (`SKILL.md:104-108`) | none | concave edges without a fillet face; later (K10 option) |

Repeated identical micro features (slide ribs) are grouped into one finding
with a count, which answers the skill's "noisy on slide ribs" caveat
(`SKILL.md:232-233`). Dimension-critical edges that must stay sharp ("function
beats style", `SKILL.md:84-87`) are waived per edge chain with that reason.

### 5.10 C9: lumps and voids

A printed part should be one connected solid (the fit-and-snap review's first
state, `references/fit-and-snap-review.md:57-59` [C]). If a part has more than
one body, C1 classifies every pair of its bodies (not only against the main
one, so two floating lumps are also checked against each other): `overlapping`
is a missing union (modeling error), `touching` is the "tangent-contact
Boolean lottery" the doctrine warns about ("give every glued-on body ≥ 1 mm of
overlap skirt", `SKILL.md:139-142`), `separated` is a floating lump. Each is a
`fail` unless the part is declared multi-body. Enclosed voids cannot exist in
a committed wonky body (`HEAD:src/boolean.mjs:205` refuses the Boolean that
would create one, `HEAD:src/analytic.mjs:280` refuses disconnected shells
[C]), so `enclosed_voids()` answers 0 with that reason recorded. Void checks
belong to a multi-shell body format (K21), not to this check.

### 5.11 C10: bores as data

Concave cylinder faces (from `same_sense`, no probe) grouped by coaxiality
and radius under the stated `coaxial_mm`/`coaxial_deg` tolerance (Q12, 3.3), full versus partial (a fillet is partial and
tangent to its neighbours), axis class against `u` (vertical, horizontal,
slanted with cad_khana's thresholds for the label), through or blind, depth,
and the lowest point against the bed. Doctrine notes, only where they apply:

- a horizontal bore that takes part in a declared fit (a clearance assertion
  with a fit class, or a coaxial pin in an assertion) and has no teardrop:
  "teardrop it, round bores sag 0.1 to 0.2" (`SKILL.md:181-183`);
- a vertical fit bore: expected undersize from the profile;
- a bore that starts in the first layer: "elephant foot: chamfer the bottom
  edge".

The compat `bores[]` array keeps its four fields; `at` becomes the midpoint of
the bore axis instead of cad_khana's uv midpoint on the wall (an intended
difference, section 10).

### 5.12 C11: orientation (advisory)

Candidates: the six `CANDIDATES` axes, `−n` of large planar faces (lay flat),
and the axes of fit-critical bores, deduplicated under `decide_deg`. Per candidate,
exact where the faces are covered: C6 overhang area and support demand
(`∫ (p·u − h0) dA` over non-bridge, non-bed regions: a first moment, closed
form on planes and on cylinder and cone bands), bed contact area and
first-layer islands, footprint, height, risky bores (horizontal or slanted fit
bores), lumps. The metrics are Bend intervals; the host only orders them
(4.1). The result is a Pareto set plus cad_khana's lexicographic
winner for compatibility; exact ties are reported as ties instead of being
broken by candidate order (the sphere case, where cad_khana's "best" axis is
mesh noise [M]). Orientation is advice; it never rotates geometry and never
gates.

### 5.13 Waivers

```json
{"check": "overhang", "target": {"identity": "wk1/…", "alias": "B1.L4"},
 "scope": "face", "reason": "countersink mouth, first 0.2 mm above the plate",
 "max_area_mm2": 1.0}
```

- **Scopes:** face, logical face, edge chain, region (a face plus a height
  band), part pair (mechanism), part (compat only).
- **Matching:** a finding is `waived` only if every witness lies in waived
  targets; otherwise it stays a finding and names the waiver that did not
  cover it.
- **Waived undecided results:** a waiver that covers the cells of an
  `unresolved` record gives `waived-unresolved`, which is never green (3.1).
- **Budgets and growth:** decided in the Bend check call, which receives the
  waiver targets, their budgets and the previous revision's Bend-issued
  hidden area (4.1). Waived area above `max_area_mm2` is a `fail`; a waiver
  whose hidden area grew prints a warning (the field-notes request, `~/Workspace/cad/cad-khana/field-notes.md:230-236`,
  inventory-tooling.md §13 idea 6).
- **Orphans:** a waiver whose target identity is absent in this revision is
  reported as orphaned, and whatever it used to cover is a finding again.
- **Declaration:** in Python (`assembly.waive(...)`, `inspect(...,
  waivers=[...])`), in the sidecar check spec (6.1), or from the viewer
  ("waive this region" writes the sidecar). The shared input loader (6.1,
  K6a) merges them for every frontend, Python included, with a fixed
  precedence, and the sidecar is a watched input of the live session.
- **Compat part-scope waivers:** `FDM(overhang_max_deg ≥ 90)` and
  `wall_min_mm ≤ 0.05` are honoured as inputs but recorded as part-scope
  waivers with the reason "compat threshold disables the check" and the area
  or the minimum they hide (evaluated at the profile's value). They never
  stay silent: every run prints one `WAIVED` stderr line per part-scope
  waiver with the hidden area or minimum, also when `.status` is `ok` for
  the 26 readers. `--strict` refuses part-scope waivers, and becomes the
  default on a date Marc sets (decision 14.6).

### 5.14 Proxies and fidelity

Each check record stores the body revisions it examined; each export records
the body revisions it wrote (decision 13 already writes Python exports from
Bend geometry with provenance, `docs/entscheidungen.md:40` [C]). The link
between what is printed and what was checked is **declared**, not guessed
from names: a name match finds none of the relations in
`cad-project-046/assembly.py`, where the checked `thumbscrew` is placed as
`screw1`, `screw2`, `screw3` and the checked `link100` as `link` (`:60-68`,
`:128-148` [C]). The manufacturing declaration of 5.15 names, for each printed
target, its assembly instances and its check record. A target whose exported
body revision differs from its checked revision needs a declared relation:

- `inspect(proxy, ..., proxy_for="thumbscrew", reason="threads refused by the ray wall check")`,
  or the two fidelity tiers of `with_detailed_geometry`, whose tier is
  recorded per check and per export. The report then says "checked on proxy"
  with the reason;
- otherwise the target is `unchecked` (a `fail` by default), never silently
  green.

This answers the thread-free proxies of `cad-project-046/assembly.py:128-148` and
the field-notes incident of a broken threaded export next to a clean
un-threaded check (`~/Workspace/cad/cad-khana/field-notes.md:161-172`,
inventory-tooling.md §13 idea 7). Since wonky refuses `bd_warehouse` threads
today, the real threaded part is checked whenever it builds; until then the
relation must be declared.

### 5.15 Manufacturing declaration

Marc's slicer files do not come from the assembly: `cad-project-033/case.py:424-449`
and `cad-project-026/bar.py:273-284` write `out/*.stl` and `out/*.step` in
their own `__main__` blocks, which do not run when `assembly.py` imports them
[C]. The files also carry meaning a generic "export every assembly part"
cannot know: `out/hood.stl` is deliberately the 60 mm variant, `hood-40.stl`
the legacy one, and the assembly additionally holds hardware, reference parts
and test poses (`cad-project-033/case.py:428-444`, `assembly.py:38-53` [C]).

So wonky adds an explicit declaration (a wonky extension, recorded in the
check spec as `manufacture[]`):

```python
assembly.print_target("hood", case.build_hood(60), out="out/hood.stl",
                      variant="60 mm fan", up=(0, 0, -1), count=1,
                      instances=["hood60"], checked_as="hood60")
```

Each target records: part definition (body revision), variant label, print
pose (up axis or location), count, target path, the assembly instances it
stands for, and the check record that covers it (or a declared proxy
relation, 5.14). `wonky build` and the live loop write every declared target
from the checked revision; a target that cannot be written (a refused
export, a failing check under the legacy contract) is listed as stale with
the revision it still holds. Files in `out/` that no target declares are
listed as undeclared, never deleted. Until a project declares its targets,
its separate export script stays the source of its slicer files, and nothing
claims to replace it (section 12).

## 6. One check API for every frontend

### 6.1 The check spec `wonky-checks/1`

All frontends produce the same normalized declaration, recorded in
`brep.json` and hashed for the cache. JSON, no new dependency:

```json
{
  "schema": "wonky-checks/1",
  "profile": {"ref": "wonky-print-profile.json", "overrides": {}},
  "tolerances": {"contact_mm": "auto", "decide_mm": 1e-6, "decide_deg": 1e-6},
  "parts": {
    "housing": {"select": {"name": "housing"}, "printed": true, "up": [0, 0, 1]},
    "lid":     {"select": {"name": "lid"}, "printed": true, "up": [0, 0, -1],
                "poses": {"mid_slide": {"translate": [0, 12, 0]}}},
    "hopper_keepout": {"volume": {"type": "box", "min": [-60, 40, 150], "max": [60, 160, 232]}}
  },
  "joints": {"lever": {"type": "revolute", "point": [0, 0, 20], "direction": [1, 0, 0], "parts": ["lever"]}},
  "assertions": [
    {"kind": "no_interference", "a": "lid", "b": "housing"},
    {"kind": "clearance", "a": "pin", "b": "housing", "min_mm": "sliding"},
    {"kind": "interference", "a": "screw", "b": "nut", "reason": "thread engagement", "max_depth_mm": 0.6},
    {"kind": "contact", "a": "lid", "b": "housing"},
    {"kind": "clearance_over", "joint": "lever", "range": [-50, 50], "a": "lever", "b": "housing", "min_mm": 6}
  ],
  "printability": [{"part": "housing", "name": "housing", "fdm": {"wall_min_mm": 0.8}, "out": "outputs"}],
  "orientation": [{"part": "housing"}],
  "waivers": [{"check": "overhang", "target": {"identity": "wk1/…"}, "reason": "…", "max_area_mm2": 1.0}],
  "manufacture": [{"name": "hood", "part": "hood60", "out": "out/hood.stl", "variant": "60 mm fan", "up": [0, 0, -1], "count": 1, "checked_as": "hood60"}],
  "options": {"strict": false, "collect": false}
}
```

Each declaration keeps its source location (`file`, `line`, `column`) so
every stderr line and viewer row points at the line that declared it.

**One input loader for every frontend** (`src/check/inputs.mjs`, K6a). A run
merges, in this order, later entries overriding earlier ones only where the
schema allows it: (1) the printer profile (`--profile`, else the first
`wonky-print-profile.json` found upward from the model directory, else the
built-in starter); (2) the sidecar spec `<model>.checks.json` next to the
source (FeatureScript: the whole spec; Python: waivers, profile reference,
options and extra assertions); (3) declarations made by the model's own
calls (Python `check()`, `inspect()`, `waive()`, `print_target()`); (4) the
CLI options. Assertions and waivers are unions keyed by source location;
two declarations of the same assertion kind on the same pair, pose and
region with different parameters are an error naming both lines. Profile
fields are overridden only by `FDM(...)` per call and are listed as
overrides. Every file the loader read is returned with its SHA-256, recorded
in `brep.json`, and registered as a watched input of the live session next
to the Python modules it already watches (`src/viewer/live/session.mjs:183-205`
[C]), so editing only the sidecar, the waiver or the profile re-runs the
checks.

### 6.2 Python (the cad_khana compat package)

The compat package stays thin: it turns calls into declarations and asks the
host to evaluate, through the existing `khana_check` bridge op
(`src/python.mjs:86`, `:1005` [C]). The host holds the authoritative record
and hands Python a copy, as decision 12 already does for not-run records
(`docs/python-khana.md:154-160` [C]); a model cannot rewrite a verdict.

| call | behaviour |
| --- | --- |
| `Assembly()` builder, `with_part`, sub-assemblies, joints, materials, detail overrides | unchanged (already provided, `docs/python-khana.md:19-30` [C]); names validated at the declaring line (5.2) |
| `assert_no_interference`, `assert_clearance`, `assert_interference` | recorded as before, now evaluated by `check()`; optional new keyword arguments (`min_mm="sliding"`, `max_mm`, `max_depth_mm`, `max_mm3`) |
| `check(assembly, out=, export=)` | evaluates C1 to C5 for the assembly, writes `mechanism.json` (7.2) to `resolve_out(out)`, exports when `export` resolves true; returns a real `CheckResult(exports, diagnostics)`, or raises `SystemExit` on a failing record under the legacy contract (below) |
| `inspect(part, method=, out=, name=)` | evaluates C5 to C10 for the part, writes `<name>-printability.json`; returns a real `PrintabilityDiagnostics` whose `.status` is `ok`, `assertion_failed`, `unresolved`, `refused` or `not-run` (3.1), or raises `SystemExit` on a failing record under the legacy contract |
| a value the kernel cannot give (a refused fact, a refused metric) | a latched `Refused` object built like `NotRun` (`python/cad_khana/_wonky.py:58-111` [C]): any attribute, truth value, comparison, arithmetic, length or item raises the capability error naming the stage and the entity; `str()` names it. The JSON keeps `null` plus the capability entry |
| `suggest_orientation`, `score_orientation` | C11, writes `<name>-orientation.json`, returns the ranked `OrientationScore` tuple |
| `detect_overhang`, `detect_bores`, `detect_pins`, `min_wall`, `min_wall_mm`, `floating_solids`, `enclosed_voids`, `sharp_*_edges`, `compute`, `evaluate` | views over the same records (Appendix A) |
| `viewer.push` | no-op, recorded as a display request (the live server shows every build) |

**Two call contracts.** The architect's first draft made both calls
non-raising by default and claimed all consumers stay correct. The workflow
review disproved that: `cad-project-046/assembly.py:150-163` [C] stores its
success fingerprint right after `inspect()` and removes it only on
`SystemExit`; with a non-raising `assertion_failed` return, the first run
caches all five failing checks and the second run calls `inspect()` zero
times [M, `tmp/khana/review-workflow/consumer-probe.json`]. So:

- **Legacy contract (default for the compat package).** The host evaluates
  the call, records it, writes the JSON, and then, for a record whose
  verdict is not `pass` or `waived`, raises `SystemExit` exactly where
  cad_khana did (after the JSON is written). That includes `refused` and
  `unresolved`: under this contract nothing that is not proven lets the
  script continue as if it passed, the same guarantee today's default
  refusal gives. The live viewer treats this `SystemExit` as "stopped at a
  failing check", not as a build failure. Consumers that catch
  `SystemExit` (`coupons.py:149-152`, `family.py:338-344`,
  `neustart/robot.py:224-233`, the unifi cache) and
  `lateral_preload.py:89-91`, which rereads the JSON [C], keep their
  meaning. The runner reports every record made before the stop and names
  the calls that did not run because the script stopped.
- **Collect contract (opt-in: `--collect` or `options.collect`).** No call
  raises; every call of the run is evaluated; the exit code comes at the end
  (7.4). This is the native mode and removes "first failure hides the rest"
  (inventory-tooling.md §2.1 [M]), but it is only correct for files that do
  not branch on the exception, so a project switches to it deliberately
  (the doctrine's script structure is written for it).
- **Caches that skip calls.** A model can skip a call before the host sees
  it. The run manifest therefore validates every compat JSON file in the
  output directories that this run did not rewrite: its run stamp, its
  source hash and its status. A reused file whose status is not `ok`, or
  whose source hash differs, is a stderr warning and a `stale-check` record
  (7.3).

K1a's acceptance contains the two-run test of the extracted unifi loop in
both contracts: under the legacy contract the second run calls `inspect()`
again for every failing part; under `--collect` the manifest reports the
five reused failing records.

**Decision 12 changes meaning.** Today `--khana-checks refuse|skip`
(`bin/wonky-python.mjs:20`, `:75-78` [C]) chooses between a capability error
and a not-run record. With native checks:

- `--checks=run` (new default): every call is evaluated. A check whose
  primitives do not cover the geometry is **not** a not-run: it is a real
  result with verdict `refused` (`.status == "refused"`, never
  `"unresolved"`) or `unresolved`, and the capability entry names the stage
  and the face.
- `--checks=skip`: exactly decision 12's semantics (host-recorded `not-run`
  entries, the latched `NotRun` object of `python/cad_khana/_wonky.py:58`
  [C], "this build is not checked").
- `--khana-checks=skip` stays an alias for one release; `refuse` is obsolete
  and answers with a message that names `--checks=skip`.

**New names** (wonky extensions on the compat classes, documented as such; a
model that uses them no longer runs under the real cad-khana):
`Assembly.with_pose`, `Assembly.expect_contact`,
`Assembly.assert_clearance_over`, `Assembly.assert_no_interference_over`,
`Assembly.assert_fit`, `Assembly.waive`, `Assembly.print_target`,
`PrismaticJoint`, the keyword arguments `within=`, `max_depth_mm=`,
`max_mm3=` on `assert_interference`, `max_mm=` on `assert_clearance`, and
`waivers=`, `proxy_for=`, `reason=` on `inspect`.

**Live mode.** `wonky view` passes the same options as the CLI to its Python
workers: checks mode, read-only roots, working directory = the model's
project directory. Today it passes none (`src/viewer/live/build-worker.mjs:85-93`
[C]), so an `assembly.py` with `check()` in its main block fails live
(inventory-tooling.md §1 item 8). The live session also watches the files
the input loader read (6.1). Under the legacy contract a failing check still
stops the main block; the viewer then shows the model (bound before the main
block), the records made so far and "stopped at the first failing check";
under `--collect` it shows all of them.

### 6.3 FeatureScript models (R20)

FeatureScript input stays unmodified Onshape syntax (AGENTS.md line 3), and
Onshape has no assertion or printability API, so a FeatureScript model's
checks live in a sidecar `wonky-checks/1` file: `wonky check r20.fs --feature
singleStepR20 --checks r20.checks.json`, or `<model>.checks.json` next to the
source by convention, loaded by the shared input loader of 6.1. Parts are selected by body name, by the creating
operation id or by identity (`{"operation": "…"}`, `docs/topology-identity.md`
[C]).

**R20 already has this shape.** Marc's own check library for R20
(`R20/checks/`, read only) declares a scene (`r20/checks-scene/v1`, parts,
motion spec, interfaces, keep-outs), uses PASS/FAIL/UNRESOLVED
(`status.py:6-19`), never turns a violation into an exception
(`errors.py:1-5`), and proves sweeps with a displacement bound and bisection
(`clearance.py:9-16`) [C]. It runs on STL meshes through fcl, trimesh,
manifold3d and rtree (`clearance.py:24-26`, `README.md:12`, `:21`, `:24` [C]). The
common subset maps onto the wonky spec:

| R20 concept | wonky |
| --- | --- |
| parts with mesh, primitive or derived clip | parts selected from the build; primitives and keep-out volumes become exact Bend bodies |
| motion spec joints `revolute`, `prismatic`, `path`, `coupled` | `revolute`, `prismatic` in v1 (C4); `path` and `coupled` `refused` until needed |
| motions with range and step, poses | `clearance_over` ranges (continuous, no step needed); poses (C3) |
| rule `moving_min` | `clearance_over` |
| rules `guided_gap`, `x_play` | `clearance` with `min_mm` and `max_mm` (x_play's witness direction later) |
| rule `flange_contact` | `contact` with `max_mm3` |
| `static_overlaps` (`tol_mm3: 0.001`) | C2 coverage with a length tolerance |
| `contained`, `parts` (shells, bodies), `bed` | C1 `contained`, C9 lumps, C5 bounds in the print pose |
| `keepouts` | keep-out volumes as bodies plus `no_interference`/`clearance` |
| `fall_rays`, `shadowed`, `envelopes`, swept free-space bodies | project-specific; stay in R20's library (decision 14.7) |

K16 builds an importer for that subset, so R20's scene files can run against
wonky's exact bodies and be compared with the mesh results (the mesh results
are an external comparison, never kernel input).

Separately, the FeatureScript evaluation queries that overlap with these
primitives (`evDistance`, `evArea`, `evEdgeConvexity`,
`evFaceTangentPlane`, `evSurfaceDefinition`) are unimplemented today
(`src/lang/dataflow/fs-trace.mjs:375-376` [C, kernel-gaps.md §3.3]); they
become thin wrappers over Q6, Q1 and Q3 when a FeatureScript model needs them.
A wrapper raises the capability error for a `refused` result and for a
`bounded` result whose interval is wider than the query's tolerance, so a
model never branches on an undecided number. That is modeling support, not
the check API.

### 6.4 WK/0

WK/0 is the host-side content-addressed graph IR (`docs/language.md:30-35`,
`:61` [C]). Check declarations become non-geometric `check.*` records in the
graph that reference body nodes. Their hash covers the referenced body
nodes, the profile and the tolerances, which gives the cache key and lets the
WK/0 preflight list checks whose primitives cannot cover the geometry (for
example a torus face before K17b) before anything runs.

### 6.5 CLI

`wonky check <model>` evaluates without exports, `wonky build <model>` with
exports, both for `.py` and `.fs` (section 8). Output: the `brep.json` check
block, the compat JSON files for Python calls, one stderr line per non-pass
record, the exit code of 7.4.

### 6.6 Viewer

A query-worker kind `checks` runs the engine on the displayed revision, the
pattern the viewer already uses for printability and thickness
(`docs/viewer/fdm.md` "Printability API", `docs/viewer/thickness-probe.md`
"Method" [C]). Layers:

- pair relations: crossing faces of an overlap in red (the overlap solid
  itself after K17a), contact faces outlined, the clearance witness segment
  with value and label;
- overhang regions, bridges with their span, bed contact and first-layer
  islands (tinting stays display; the classification comes from Bend);
- wall witnesses, knife edges with their feather zone, air gaps;
- style findings as edge highlights; bores as badges in the parts tree;
- an assertions panel (verdict, detail, click focuses the pair) and a chip
  next to the trust indicator: "checks: 12 pass · 1 fail · 2 unresolved ·
  1 waived · 1 waived-unresolved" (the last one is never counted green);
- joint sliders that scrub poses as rigid transforms and show C4's worst pose;
- "waive this region" writes a waiver with a required reason into the sidecar
  spec; since the sidecar is a watched input (6.1), the edit alone triggers
  the next check run, which shows it as `waived`, for Python models too.

Findings carry revision-bound aliases, so a review note ("B1.L4 is fine") and
a waiver survive rebuilds through identity instead of per-push indices.

## 7. Reports

### 7.1 `brep.json`

A top-level `checks` block (`wonky-checks-result/1`): the normalized spec with
source locations, the profile (id, version, provenance, overrides), the
tolerances in effect, one record per evaluated declaration (verdict, value
interval, label, witnesses with identities, coverage, refusals, waivers
applied), the summary (status, counts per verdict) and cache hits. Under
`--checks=skip` the existing `model.source.khanaChecks` not-run record stays
as it is.

Putting results into `brep.json` changes the model id when only a check
changes. That is intended: the file describes the build's result. Geometry
identity for caches and diffs is the per-body `identity.revision`
(`docs/topology-identity.md` [C]), so "checks changed, geometry unchanged" is
visible in a diff. (Alternative with a sidecar keyed by model id: decision
14.9.)

### 7.2 Compat JSON: documented supersets

**Two contracts, chosen per file.** A key-for-key superset is not a type
superset: 0.2 fields are numbers, and the real `khana diff` formats and
subtracts `Interference.volume_mm3` without a `None` check
(`U/diff.py:113-130` [C]). Three probes against a copy of it raise
`TypeError` for an added `null` overlap volume, an unchanged one and a
number that became `null` [M, `tmp/khana/review-workflow/consumer-probe.json`].
Therefore:

- **Legacy 0.2** is written only when every value of the file is
  representable in 0.2: no `null` in a numeric field, only the 0.2 status
  values `ok`, `assertion_failed`, `error`. Such a file is read correctly by
  the installed `khana diff` and by every model that rereads it.
- **Extended `0.2+wonky.1`** is written otherwise (a refused volume, an
  `unresolved` or `refused` status). Same keys, order and types except that
  numeric fields may be `null` and the status enum is wider. The installed
  `khana diff` rejects it with its own schema-mismatch message
  (`U/diff.py:34-41` [C]), a clean refusal instead of a `TypeError`. That is
  the remaining, named break; `wonky diff` (K1b for compat files, K13 in
  full) reads both.
- No invented numbers: a refused volume is never written as 0 and a refused
  overlap is never left out to keep a file on 0.2.

**`mechanism.json`** keeps every schema 0.2 key, its order and types
(inventory-mechanism.md §6) and no `kind` key (the mechanism marker,
`U/diff.py:22-23` [C]). Differences:

| key | wonky content |
| --- | --- |
| `schema_version` | `"0.2"` or `"0.2+wonky.1"` as above |
| `status` | `ok`, `assertion_failed`, `error`; extended: `unresolved`, `refused` (never written when a `fail` exists) |
| `parts` | leaf names, path-qualified when ambiguous; refused facts are `null` (extended) |
| `interferences` | every `overlapping` or `contained` pair, asserted or not, except pose pairs; `volume_mm3` and `centroid` `null` when refused |
| `assertions` | all declared assertions, then synthetic rows `unasserted_overlap:a/b` and `degenerate_part:name`; `detail` keeps cad_khana's formats ("interference volume …mm^3", "clearance …mm below min …mm", "expected interference absent …; reason: …") and appends depth and exactness |
| `exports` | as before |
| `wonky` (new, last) | `schema: "wonky-mechanism/1"`, `run` (id, model id, source SHA-256, time), tolerances, profile, `pairs[]` with relation, distance interval, label, witnesses, contact kind, depth, volume; poses; motion; findings; waivers; coverage; refusals |

**`<name>-printability.json`** keeps the 17 G2 keys in order
(inventory-printability.md §6.1) with `kind: "printability"` and
`schema_version` `"0.2"` or `"0.2+wonky.1"` by the same rule:

| key | wonky content |
| --- | --- |
| `status` | `ok`, `assertion_failed`; extended: `unresolved`, `refused` |
| `min_wall_mm`, `min_wall_at` | the minimum wall (closed form or bounded) and its witness point on face A; `null` only when refused (extended) |
| `overhang` | `{area_mm2, max_angle_deg}` over unwaived regions that are neither bed-supported nor bridges, or `null` |
| `bores`, `pins` | views of C10 and C7 (`at` on the bore axis) |
| `warnings` | cad_khana's English strings for the corresponding findings (sharp vertical edges, undeburred rims, floating solids), plus new strings (knife edges, checked proxy, part-scope waiver) |
| `assertions` | `wall_min:<v>` and `overhang_max:<v>` as before, plus `knife_edges`, `lumps`, `checked_proxy` rows when they apply |
| `wonky` (new, last) | findings with ids and exactness per metric, bridges, bed and first-layer data, waivers, profile, coverage, run stamp |

**`<name>-orientation.json`** keeps `kind`, `name`, `ranked`,
`best_up_axis`; adds `wonky` with `schema: "wonky-orientation/1"`, the Pareto
set, ties and candidate sources. No top-level `schema_version` is added
(khana diff would misclassify the file anyway, `U/diff.py:22-23` [C]);
`wonky diff` reads the `wonky` block.

Float formatting: values are written from the interval midpoint with the
interval in the `wonky` block; exact values print without float dust
(`0.25`, not `0.24999999999999983`).

### 7.3 File layout and staleness

Files go exactly where the script asks (`resolve_out`, unchanged), so Marc's
existing paths (`outputs/mechanism.json`) keep working. Each file carries the
run stamp. Each output directory gets `.wonky-run.json`: the run id, model
id, source SHA-256, the files this run wrote, and files of earlier runs in
that directory that this run did not rewrite, each validated: a reused
compat JSON whose run stamp belongs to another source hash, or whose status
is not `ok`, is a `stale-check` record and a stderr warning, so a model-side
cache that skipped `inspect()` cannot hide a failing result (6.2). Two scripts writing the
same file (`cad-project-026/assembly.py:68` and `scissor_assembly.py:122` both
write `outputs/mechanism.json` [M, inventory-tooling.md §8]) produce a
stderr warning naming both. Per-script folders are an opt-in (decision
14.10).

Exported slicer files (`out/*.stl`, `*.step`) carry the model id in the
manifest together with the verdict of every check record of the part they
contain at the moment of writing, so an STL written after a failing
`inspect()` under `--collect` is marked as such in `.wonky-run.json` and in
the stderr summary. `wonky check` lists exports built from an older revision
(fdm-skill `SKILL.md:59-61`: "the slicer files in out/ go stale silently"),
and the declared print targets that are stale, unchecked or checked on a
proxy (5.14, 5.15).

### 7.4 Console and exit codes

One stderr line per record that is not `pass`, in declaration order, with the
declaring source line:

```text
assembly.py:42: FAIL no_interference lid/housing: overlapping, depth 0.100 mm (exact), faces B2.F5 / B1.F9
assembly.py:57: UNRESOLVED wall_min:0.8 housing: faces B1.F12/B1.F30 distance [0.72, 0.81] mm, minimum on an edge
assembly.py:61: WAIVED overhang housing B1.L4: countersink mouth (0.83 of 1.0 mm²)
```

Every part-scope compat waiver prints its `WAIVED` line on every run (5.13).
The summary line lists exports written after a failing record.

Exit codes: 0 all `pass` or `waived`; 1 at least one `fail`; 2 no `fail` but
`unresolved`, `waived-unresolved` or `refused`; 3 build error. Under the
legacy contract a failing check ends the script with `SystemExit`; the exit
code is still computed from all records made (1). `--checks=skip` exits 0 with the
"not checked" line (decision 12 behaviour, `bin/wonky-python.mjs:50-51` [C]).

## 8. Tooling unification

| cad_khana / Marc's loop | problem measured | wonky replacement | package |
| --- | --- | --- | --- |
| `khana build SCRIPT` | first failure ends the run, nothing on stderr, stale JSON (inventory-tooling.md §2.1 [M]) | `wonky build <model.py\|.fs>`: checks plus exports, every record reported (all calls under `--collect`), stderr lines, exit code | K1a, K13 |
| `khana check SCRIPT` | "no export" but every pairwise Boolean still runs [M] | `wonky check <model>`: checks only; pair cache | K1a, K5, K13 |
| `khana view` + `watch.py` + OCP viewer on 3939 | three processes; `watch.py` skips the main block, re-pushes every 5 s, keeps no failure state (inventory-tooling.md §3 [C]) | `wonky view <model>`: already rebuilds on save, watches the import closure, keeps the last good model and shows failures (`docs/viewer/live-server.md:31-38` [C]); adds live checks and watches the check inputs (6.1) | K1b (wiring), K6a (inputs), K12 (layers) |
| `viewer.push()` | only called by the 13 watchers | compat no-op; a push repeated inside one build answers "watch loops are replaced by `wonky view <model>`" | K1b, K13 |
| `uv run <part>.py` for slicer files | stale `out/` files [C]; the files come from `__main__` blocks that `assembly.py` does not run (`cad-project-033/case.py:424-449`, `cad-project-026/bar.py:273-284` [C]) | the manufacturing declaration (5.15): targets with variant, print pose, count, path and checked revision, written from the checked revision; until a project declares them, its export script stays | K6b, K13, K14 |
| `khana draw` | HLR PNG with 48-sample curves, no common scale, unknown `--format` writes nothing and exits 0 [M] | `wonky draw` from Bend (exact conic arcs in SVG, one scale, scale bar, model id); until then the viewer's PNG export and a capability error naming it | K19 |
| `export_assembly` STEP | no names, no colors, only the NAUO tree [M] | STEP with assembly tree, product names, `COLOUR_RGB` styling, material as property; validated by OCCT read-back of the artifact | K14 |
| `export_assembly` STL | whole-assembly mesh at build123d defaults | per-part certified print mesh with stated deviation, limited to the committed coverage of bands and discs (`HEAD:src/print-mesh.mjs:128-150` [C]) with named refusals for other faces until r20's print-mesh work lands; optional 3MF with one named object per part | K14 |
| `export_glb` | needs the external `gltf-transform`; writes an unjoined file, then raises [M]; Marc monkeypatches `_gltf_transform_join` (`cad-project-013/camera_mount_assembly.py:358-373` [C]) | JS GLB writer (JSON and binary chunks, no external tool): one node per part, names, sRGB colors converted to linear baseColor, the achieved deviation in `extras`; `_gltf_transform_join` stays as an inert name so the monkeypatch keeps working; `draco=True` is a capability error naming `draco=False` | K15 |
| `export_animated_glb` | sampled keyframes, joint axis and limits lost [M] | from recorded joints: one pivot node per joint whose rotation or translation channel is exact (glTF LINEAR rotation is slerp, exact about one fixed axis for keyframes under 180° apart); `factory(t)` still accepted for motion that is not a joint | K15 (needs K7) |
| `khana diff` | exact float equality, float dust as changes, counts and bores not diffed, exit 0 on regression [M] | `wonky diff` over two `brep.json` or two revisions: geometry delta (the viewer's compare) plus check delta, compared within each value's interval and label, identity-aware ("B1.L4 overhang grew 0.3 mm²"), text and JSON, `--fail-on-regression`; reads old 0.2 files too | K13 |
| `khana status` | probes only the OCP viewer port [M] | `wonky status`: Bend lock and version, Node, the uv Python, running viewer servers (read, never touching ports 4310/4311), kernel fingerprint, schema versions, profile in effect | K13 |
| `khana pick` (uncommitted) | OCCT indices per push; 2° tilt called coplanar; cylinders without axis or radius [M] | viewer selection plus `wonky pick <model> --alias B1.F3,B1.F7` answering from exact-measure rows (parallel, coplanar as maximum deviation over the face, offsets, axes, radii, face distance) with stated tolerances | K13 |
| `match_hint` | regexes over OCCT text; one hint is wrong for Parts [C] | hint catalog keyed on wonky capability and error codes, written into the compat `hint` field | K13 |
| hand-made check caches (`cad-project-046/assembly.py:114-161` [C]) | rounded volume/count fingerprints | pair and part caches keyed by body revision, relative placement, profile, tolerances and kernel fingerprint; the run manifest validates reused JSON files (7.3) | K1a, K5 |
| `khana` command name | Marc's habit and the old skill | `wonky khana <build\|check\|view\|diff\|status\|pick>` translates; a `khana` bin on PATH is decision 14.8 | K13 |

## 9. Improvements over cad_khana, ranked by value for Marc's FDM work

Ranked by how often the problem hits Marc's real files (section 2.1) and how
much a wrong verdict costs (a reprint, an unassemblable mechanism). "v1" means
inside packages that do not need r20; "later" means K17a or beyond.

| rank | improvement | fixes (evidence) | version |
| --- | --- | --- | --- |
| 1 | checks run in the live viewer loop, report every record, print why; run to completion opt-in | assembly files fail live today; silent exit 1; stale JSON (inventory-tooling.md §1, §2.1 [M]) | v1 (K1a, K1b, K12) |
| 2 | wall thickness as opposed-face distance with exact witnesses and knife edges reported separately | 59 of 61 failures are walls; 30 outputs at the 0.05 floor; 17 files switch the wall check off [M] | v1 for plane/cylinder/cone (K9a, K9b) |
| 3 | exact per-face overhang with the bridge rule instead of the bore exemption and probes | 45° cones and countersinks fail; rotated slots and thin-wall bridges fail; 52 of 175 runs disable overhang [M] | v1 (K8a, K8b); sphere, torus later (K17c) |
| 4 | unasserted overlap components fail; expected overlaps bound to regions; pose sets with a base pose; fits on interfaces | 20 unasserted overlap rows under `status: ok` [M]; pair-wide expected overlaps hide second collisions; global minimum distance cannot express a fit | v1 (K5) |
| 5 | contact as a first-class relation, length tolerance, solid distance | volume epsilon depends on contact area; containment false pass; nominal 0.25 gap fails [M]; flush contacts of placed parts must not become `unresolved` | v1 (K4a to K4c, K5) |
| 6 | local waivers with reasons, budgets, orphans and growth alarm | global switch-offs hide real defects (field notes `:230-236`) | v1 (K6a) |
| 7 | one printer profile shared by doctrine and checks, fit classes, calibration provenance | fit numbers scattered in comments and FDM arguments; `min_mm=0.20-1e-6` hacks [C] | v1 (K6a) |
| 8 | motion clearance over a joint range with a displacement bound and joint-invariant sliding contacts; prismatic joints | hand-rolled linear sweeps; sampled `factory(t)` misses collisions between samples [C] | v1 (K7) |
| 9 | manufacturing declaration, declared proxy relations and fidelity tiers in every record | thread-free proxies certified a broken threaded export (field notes `:161-172`); slicer files come from separate `__main__` blocks | v1 (K6b) |
| 10 | edge audit on circle edges, grouped micro features, convexity with a stated smooth tolerance | cylinder rims never counted; probe convexity wrong in G1; rim and sharp-edge noise [M] | v1 (K10) |
| 11 | lumps with the reason (missing union, tangent lottery, floating) | the doctrine's "≥ 1 mm overlap skirt" rule has no check [C] | v1 (K10) |
| 12 | STEP with names, colors and tree; GLB without external tools; exact joint animation | STEP loses names and colors; GLB needs gltf-transform and a monkeypatch [M] | v1 for bodies the committed print mesh covers (K14, K15); broader print meshes with r20 |
| 13 | revision diff including checks, within tolerance and identity-aware | float dust, no exit code, counts and bores not diffed [M] | v1 (K13) |
| 14 | stale export detection and run manifest | `out/` goes stale silently; colliding `outputs/mechanism.json` [M] | v1 (K1a, K6b, K13) |
| 15 | fit-aware bore notes (teardrop only where a fit needs it) | 1980 bore notes, mostly noise [M] | v1 (K10) |
| 16 | orientation from exact moments with lay-flat and bore-axis candidates, Pareto set and ties | a sphere's best axis is mesh noise; only six axes [M] | v1 (K11) |
| 17 | stable review references (aliases, identities) instead of per-push indices | "re-push and re-quote" rule (upstream skill `:119-137`) | v1 (K12, K13) |
| 18 | overlap volumes and centroids for curved pairs, sphere and torus coverage, bounded volumes | only planar volumes before r20 | later (K17a, K17b) |
| 19 | certified-mesh distance for recovered bodies | bodies from the hybrid | later (K18) |
| 20 | measured drawings from Bend | 48-sample curves, no scale [M] | later (K19) |
| 21 | anchor reachability of bridges through layer sections | directive item 4; a surface criterion does not prove the anchor exists when the bridge prints | v1 (K8b), narrow |
| 22 | general layer-by-layer overhang against the previous layer, first-layer adhesion indicators, pinned slicer evidence | prior-art ranks 5, 6, 11 | later |
| 23 | general penetration depth, medial-axis thickness, arc-overhang certification, nested cone-cone distance search | prior-art rank 12: defer; review M2 | later, research |

## 10. The parity oracle

**Purpose.** Show, case by case, that wonky's values are right, that it
reproduces cad_khana where cad_khana is right, and document every place where
it deliberately differs. The oracle never feeds the kernel (AGENTS.md line 4).

**Three oracles, in this order of authority** (review M9):

1. **Primary: closed forms derived independently.** Each case states its
   expected value from geometry, by hand and in the case file: 0.25 (pin in
   bore), 157.08 (lying r5 cylinder band), 2.0 (the `bores_v5_h5_h20` wall),
   8.485 (the Ø12 chord), 500 (the 5 mm cube overlap), and so on. wonky's
   interval must contain the closed form. Hand values are reviewed like
   code: one was already wrong once (`tmp/khana/oracle/printability/oracle.py:104`
   expected 5.0 where the wall is 2.0, inventory-printability.md:624
   correction [C]).
2. **Secondary: OCCT on wonky's own exported STEP.** `uv run` measures
   distance, volume and area of the STEP that wonky wrote for the case. This
   compares the same geometry and is the artifact validation AGENTS.md line 4
   allows.
3. **Behavioural reference: cad_khana's JSON on its own geometry.** cad_khana
   builds its bodies in OCCT from the same script; wonky builds them in Bend
   (F32x2 placements, F32-quantized sketch profiles, `src/exactness.mjs:20-30`
   [C]). The two bodies differ, so a numeric mismatch cannot be attributed.
   The reference is used for verdicts, record shapes and the kinds of
   findings, never as the value a number must match.

**Reference sources** (all runs on copies under `tmp/khana/oracle/`):

| generation | what | how it runs | used for |
| --- | --- | --- | --- |
| G0 | installed `khana` 0.0.2 (build123d 0.10.0, OCCT 7.8) | `khana build/check/diff/status` on copies [M, inventory-mechanism.md §0, inventory-tooling.md §0] | CLI and mechanism behaviour, mechanism.json shape |
| G2 | Marc's upstream worktree (G1 = `22f0ad0` plus uncommitted floating-solid, rim and probe changes), the version all 175 real outputs come from; provenance is the frozen copy `tmp/khana/oracle/printability/src_g2/`, whose tree hash K2 records with the fixtures (an uncommitted worktree has no tool version) | copies of the source run with the tool's interpreter: `uv run --no-project --python ~/.local/share/uv/tools/cad-khana/bin/python <script>` [M, inventory-printability.md §7] | printability behaviour and schema |
| pick | uncommitted `pick.py` copied next to a probe | same interpreter [M, `tmp/khana/oracle/pick/`] | the questions a pick answers, not its JSON shape |

**Case sets.**

1. Mechanism probes: `tmp/khana/oracle/{ok,fail,error,keyerror,check-mode}/`
   and `probe/probe.json`, `probe2.json` (contact, overlap depth and gap
   sweeps, containment, rotation) [M], plus the new cases of 5.1 (rotated B,
   decimal offsets, boss and pin, pin through plate, cone contacts).
2. Printability parts: 22 synthetic parts, the G1/G2 runs, three tessellation
   levels (`tessellation-sensitivity.json`) and the probes (`probes.json`,
   `concave-self-hit.json`) under `tmp/khana/oracle/printability/` [M], plus
   the new cases of 5.7 and 5.8.
3. The skill's `pin_hinge` example (G0 outputs under
   `tmp/khana/oracle/printability/pin_hinge_g0/`).
4. Consumer probes: the extracted unifi cache loop and the installed `khana
   diff` against both schema contracts (`tmp/khana/review-workflow/consumer_probe.py`,
   `upstream_diff.py` [M]).
5. Marc's stored outputs (39 mechanism, 175 printability, 9 orientation,
   `tmp/khana/corpus-usage/outputs.json` [M]) become cases only when their
   model builds in wonky and the output is not older than its source (stale
   outputs are skipped with the reason; corpus-usage `open` notes).

**Comparison rules.** wonky's value is an interval `[lo, hi]` with a label.

| quantity | primary (closed form `c`) | secondary (OCCT on wonky's STEP, `s`) | behavioural (cad_khana `k`) |
| --- | --- | --- | --- |
| verdicts | from the closed form and the threshold | n/a | equal, or an intended difference |
| volume, area, bbox of plane/cylinder/cone bodies | `c ∈ [lo, hi]` | `\|mid − s\| ≤ 1e-6 · max(1, \|s\|)` plus OCCT's shape tolerance | reported, not compared |
| distance | `c ∈ [lo, hi]` | `s ∈ [lo − 1e-6, hi]` | `k` below `lo` by at most 1e-6 is expected (OCCT measures slightly below the gap [M]) |
| overlap volume | `c ∈ [lo, hi]`; touching pairs `touching` | as volume | `k = 0` for touching pairs |
| overhang area, max angle | `c ∈ [lo, hi]` | n/a | the three tessellation levels move toward `c`; otherwise intended |
| wall | `c ∈ [lo, hi]` | n/a | convex faces `k ≤ c`, concave `k ≥ c`, within the coarsest sagitta; self-hits and knife edges intended |
| bores | same set, diameters `c ∈ [lo, hi]` | n/a | same set after grouping; `at` intended |
| counts (faces, edges, vertices) | between wonky revisions only | n/a | not compared (seams and face splits differ) |
| warnings | by finding kind | n/a | by finding kind, not string or count |

**Intended differences** are one reviewed file with one entry per case. Each
entry names the closed-form value that replaces cad_khana's, the reason and
the evidence; an entry without a closed form (or, for pure behaviour such as
"pose ghosts leave `interferences`", without the rule that decides it) is
rejected by the harness. The list starts with: containment distance (8.0 →
0), nominal clearance ulp failures (0.2499… → 0.25), volume-epsilon passes
and fails that the length tolerance decides differently, cone and countersink
overhang false positives, rotated-slot and thin-wall bridge false positives,
the small-bore exemption on inner fillets, ray self-hits and the 0.05 floor,
knife edges reported as edges, bore `at` on the axis, circle rims in the edge
audit, orientation ties, pose ghosts leaving `interferences`.

**Where it lives.** K2 freezes the reference JSON with provenance (tool
version for G0; the `src_g2` tree hash for G2; build123d and OCCT versions;
script SHA-256), the closed-form case file and the STEP-measure script under
a fixtures directory, and adds `test/khana-parity.test.mjs`; every later
package adds its cases and moves them from "refused" to "pass" or "intended".

## 11. Work packages

Each package is sized for one checkpointed workflow run (the worklog
protocol of this workflow). Every change of a Bend evaluator module costs 15
to 27 s and 3 to 7 GB to compile (`docs/language.md:54` [C]), and modules are
split per pair family because of the C emitter's arity limit
(`docs/hybrid-boolean-plan.md:292-295` [C]); the architect's K3, K4, K8, K9
and K17 did not fit one run and are split here (review M12). Sizes: **S** a
few hours, **M** one run, **L** a full run at the limit of one. "r20" marks
packages that need the r20-gate hybrid Boolean and its uncommitted kernel work
committed first; "partial" means the package works on committed code and
refuses the rest by name until r20 lands.

| id | title | depends on | r20 | size |
| --- | --- | --- | --- | --- |
| K1a | check contract, legacy and collect contracts, `Refused`, compat JSON (legacy 0.2 / extended), run manifest, exit codes | – | no | M |
| K1b | live wiring, pilot on models that build, compat-file `wonky diff` | K1a | no | M |
| K2 | parity oracle harness (closed forms, STEP measurement, references) | K1a | no | M |
| K3a | face facts and bounds (Q1, Q2 reusing `face-bounds.bend`, Q11 upper bound) with stated allowances | – | no | M |
| K3b | convexity and dihedral angles (Q3, `smooth_deg`) | K3a | no | M |
| K3c | cone membership (Q4 cone classifier, cone support in `solid-classification.bend`) | – | no | L |
| K3d | cone plane sections (Q9: circle, ellipse; hyperbola and parabola refused by name) | K3a | no | M |
| K3e | ray and segment hits on trimmed faces (Q5, root isolation by exclusion) | K3c | no | M |
| K4a | point and edge closed forms, certified 1-D search (`foot`, `search`) | K3a | no | L |
| K4b | cells, BVH join (copied), face-face crossing test (Q13), body distance with nesting | K4a, K3c | no | L |
| K4c | tolerant contact families (Q7), relative frames, transform bound (Q14) | K4b | no | M |
| K4d | native ops for K3 and K4, or `NativeCapabilityError` | K4c | no | M |
| K5 | mechanism assertions, per-component coverage, poses, interface fits | K1a, K4c | no | L |
| K6a | printer profile, shared input loader and watched inputs, waivers | K1a | no | M |
| K6b | manufacturing declaration, declared proxy relations, stale and unchecked targets | K1a, K6a | no | M |
| K7 | motion over joint ranges, invariant contacts, prismatic joint | K5 | no | L |
| K8a | overhang bands, trims, bed | K3a, K3b, K6a | no | M |
| K8b | bridges (chord families), first-layer islands, layer-and-anchor test | K8a, K3d | no | L |
| K9a | walls on opposed sub-bands, plane refinement, self chords, certified witnesses | K4c, K3e, K6a | no | L |
| K9b | knife edges, air gaps, thin features, ray estimate channel | K9a, K3b | no | M |
| K10 | edge and house-style audit, lumps, bores | K3b, K5, K6a | no | M |
| K11 | orientation | K8b, K10 | no | M |
| K12 | viewer check layers and waiver authoring | K5, K6a, K8a | no | L |
| K13 | CLI, full diff, status, pick, hints | K1b, K5 | no | M |
| K14 | STEP with tree, names, colors; per-part print STL; 3MF | K1a, K6b | partial | M |
| K15 | GLB and animated GLB | K7, K14 | partial | M |
| K16 | FeatureScript sidecar, WK/0 records, R20 scene import | K5, K6a, K7 | no | M |
| K17a | curved overlap volumes, volumes and centroids of curved Boolean results | r20-gate, K5 | **yes** | L |
| K17b | sphere and torus in Q1 to Q7 and Q13 | r20-gate, K4c | **yes** | L |
| K17c | sphere and torus in C6 and C7 | K17b, K8b, K9a | **yes** | L |
| K18 | certified-mesh distance path | r20-gate, K4b | **yes** | L |
| K19 | drawings from Bend | K3d, K3e | no | L |
| K20 | skill and doctrine switch | K1b, K5, K6a, K6b, K8b, K9a, K12, K13, K14, a real-project acceptance | no | S |
| K21 | multi-shell bodies: enclosed voids and their checks | kernel body format (kernel-gaps.md P7, O7) | no | L |

### K1a: check contract, call contracts, reports

- **Scope.** `src/check/{spec,report,compat-khana}.mjs`; the `khana_check`
  op evaluates instead of recording not-run; `--checks=run|skip`
  (`--khana-checks` alias); the legacy contract (record, write the JSON,
  then `SystemExit` on a failing record) as default and `--collect` (6.2);
  real result objects in Python filled from host records; the latched
  `Refused` object; `.status` values of 3.1; name validation at the
  declaring line; facts only from committed Bend measurements (5.5), the
  `src/brep.mjs` sums labelled `estimate`; every other verdict `refused` with
  a capability code; `brep.json` `checks` block; the legacy 0.2 and extended
  `0.2+wonky.1` writers (7.2); run manifest with reused-file validation and
  per-export verdicts (7.3); stderr lines including `WAIVED`; exit codes;
  joints recorded in `_wonky_metadata`.
- **Acceptance.** `fixtures/corpus-repro/py-khana/check-in-main/` writes a
  `mechanism.json` whose verdicts are `refused` with codes; the installed
  `khana diff` reads every legacy 0.2 file wonky writes and refuses every
  extended file with its schema-mismatch message, never a `TypeError` (the
  three probes of `tmp/khana/review-workflow/consumer-probe.json` rerun on
  wonky's files); the extracted unifi cache loop run twice: under the legacy
  contract the second run calls `inspect()` again for every failing part,
  under `--collect` the manifest reports the reused failing records;
  `Refused` raises at truth value, arithmetic and comparison; `npm test`
  passes.
- **Size M:** host and Python plumbing, no Bend.

### K1b: live wiring, pilot, compat-file diff

- **Scope.** `wonky view` passes the checks mode, cwd and read-only roots to
  its Python workers (`src/viewer/live/build-worker.mjs:85-93` [C]); a
  minimal records list in the viewer; `wonky diff` for two compat JSON files
  of either contract (the full revision diff is K13).
- **Acceptance (a bounded pilot, not a replacement of Marc's loop).** On the
  models that build today (`docs/python-khana.md:248-283` [C]):
  `pin_hinge/assembly.py` shows the model and its check records live instead
  of a main-block failure; the cad-project-003 coupons repro gets past
  `coupons.py:149` with its records (it may stop later at a kernel gap);
  `wonky diff` compares a legacy and an extended file without error.
- **Size M.**

### K2: parity oracle harness

- **Scope.** The closed-form case file (section 10) with every expected value
  derived by hand; the STEP-measurement script (`uv run`, OCCT on wonky's own
  exports); the frozen reference JSON with provenance and the `src_g2` tree
  hash; the intended-differences file whose entries must name their
  closed-form value; `test/khana-parity.test.mjs` reporting pass / intended /
  refused per case.
- **Acceptance.** Every case appears once with a status; all are `refused`
  except K1a's facts; the harness fails when a case silently changes status
  or an intended entry lacks its closed form.
- **Size M:** JSON, one script, one test runner.

### K3a: face facts and bounds

- **Scope.** Q1 (normal, area, centroid, angular extent), Q2 (reuse of
  `kernel/face-bounds.bend` and `kernel/curve-band.bend` for conservative
  bounds, tight support function), Q11 as an upper bound; the stated
  allowance of each primitive (3.2); Python `bounds` stops refusing curved v1
  bodies; compat facts `bbox` and `surface_area_mm2`.
- **Acceptance.** Closed-form tests: box, cylinder, cone frustum, bored
  plate, plane-cut cylinder (ellipse edge); each allowance written next to
  its test; JS and native timings recorded separately.
- **Size M.**

### K3b: convexity and dihedral angles

- **Scope.** Q3 with coedge orientation and `smooth_deg`.
- **Acceptance.** Sign fixed by a box test; boss rims and bore mouths; the
  plane-cylinder edges of an obround (stadium) prism read smooth; a 1°
  crease reads sharp.
- **Size M.**

### K3c: cone membership

- **Scope.** `kernel/cone-classification.bend` and cone support in
  `kernel/solid-classification.bend` (`supported`, `:145-152` [C]).
- **Acceptance.** A cone frustum and a countersunk plate classify instead of
  `UnsupportedSurface`; timings per point on JS.
- **Size L:** comparable to `cylinder-classification.bend` (458 lines,
  kernel-gaps.md:725).

### K3d: cone plane sections

- **Scope.** Cone sections in `kernel/face-plane.bend` and
  `kernel/section.bend`: circle and ellipse; hyperbola and parabola refused by
  name (`UnsupportedSection` naming the conic).
- **Acceptance.** A chamfer ring cut at the first-layer height gives two
  circles; a cone cut by a tilted plane gives an ellipse; a cut parallel to a
  generator is refused with the name "parabola".
- **Size M.**

### K3e: ray and segment hits on trimmed faces

- **Scope.** Q5: closed-form roots on plane, cylinder, cone, trimmed by Q4;
  root isolation by exclusion for searched roots; contact kind.
- **Acceptance.** A ray tangent to a cylinder reports the double root (not two
  misses); a parity membership test along such rays never flips; segment
  hits on a bored plate.
- **Size M.**

### K4a: point and edge closed forms, 1-D search

- **Scope.** `kernel/measure/foot.bend`, `search.bend` per kernel-gaps.md
  §6.5: point to face, edge to face closed forms, the certified 1-D search
  with Lipschitz bound, fuel and the interval width in the record.
- **Acceptance.** Closed-form tests for every "closed form" cell of the 5.1
  coverage table; the 1-D search brackets the circle-cylinder distance of a
  skewed pin at stated width.
- **Size L.**

### K4b: cells, join, crossing test, body distance

- **Scope.** `kernel/measure/{cells,pairs,crossing,distance}.bend`; the
  Morton tree and join copied from `HEAD:kernel/proto/recover/clear.bend`
  (`:255-355`, `cross` `:519-560`) into `kernel/measure/`, importing neither
  that path nor `kernel/hybrid/recover/clear.bend`; Q13; solid semantics
  (`contained` by vertex membership after the crossing test); face-interior
  cone-cone pairs `unresolved`.
- **Acceptance.** Named cases instead of a property test of the lower-strata
  argument: the boss and pin of 5.1 with seams at +x/+z and at +y/−y (both
  `overlapping` with the witness (0, 9, 0)); a pin through a plate without a
  hole; a cylinder through a tube wall; the 4 mm cube in the 20 mm cube;
  separate JS timings on the 24-box assembly (cad_khana `compute`: 0.17 s
  [M]).
- **Size L.**

### K4c: tolerant contact, relative frames, transform bound

- **Scope.** Q7 families (3.3, 4.2), Q14 with its derivation in Bend,
  evaluation in the relative frame, `contact_mm` per pair.
- **Acceptance.** Every row of the 5.1 case table, including the rotated
  pair where only B is rotated and Boolean results translated by decimal
  offsets (6.73 mm): all `touching`, none `unresolved` or `overlapping`; the
  transform bound is 0 for the identity and covers the measured
  2.9e-14 mm offset.
- **Size M.**

### K4d: native ops

- **Scope.** Native ops for K3 and K4 services where the arity limit allows,
  else a `NativeCapabilityError`; the classifiers do not load on the native
  backend today (`src/index.mjs:15-22` [C]).
- **Acceptance.** Native and JS agree on the K4c case table; separate cold
  and warm timings.
- **Size M.**

### K5: mechanism assertions, coverage, poses, interface fits

- **Scope.** `kernel/check/pair.bend`, `broad.bend`; the assertions of 5.1
  including `assert_fit`, `within=`, `expect_contact` and interference
  bounds; per-component coverage with `unasserted-overlap` and
  `degenerate-part`; `with_pose` with base pose and specificity (5.3); pair
  cache by body revision and relative placement; `mechanism.json` for plane,
  cylinder and cone parts.
- **Acceptance.** Oracle mechanism cases pass or are intended; the
  `cad-project-033` pattern rebuilt as a repro with base pose, `@entry`,
  `@mid_slide` and `@near_seat` (the elastic squeeze bound `within` the detent
  region) passes, and the same repro with an extra collision outside that
  region fails on it; the cad-project-003 slide coupon with its seat contact:
  `assert_fit(fit="sliding", faces=guide flanks)` passes while
  `assert_clearance(min_mm=0.2)` on the whole pair fails with the seat
  witness; an unasserted overlap makes the status `assertion_failed`;
  `assert_clearance(min_mm=0.0)` on an overlapping pair fails; the 0.25
  pin/bore clearance passes without `-1e-6`.
- **Size L:** region-bound components and interfaces on top of K4.

### K6a: printer profile, shared inputs, waivers

- **Scope.** `wonky-print-profile/1` with the starter values of 5.6 and
  provenance; `src/check/inputs.mjs` (6.1) for every frontend, with
  precedence and the read files registered as watched inputs of the live
  session; `FDM(...)` as recorded overrides; fit classes; waivers (5.13)
  including compat part-scope waivers, `WAIVED` lines, `waived-unresolved`,
  budgets passed into the Bend calls, and `--strict`.
- **Acceptance.** `min_mm="sliding"` resolves to 0.2 and says `starter`; a
  waiver on a face alias survives a parameter change that keeps the identity
  and becomes orphaned when the face disappears; `FDM(overhang_max_deg=91)`
  prints its `WAIVED` line with the hidden area on every run; editing only
  the sidecar JSON, only the waiver or only the profile of a Python model,
  without touching the Python, changes the verdict in the next live run.
- **Size M.**

### K6b: manufacturing declaration and proxy relations

- **Scope.** `print_target` and `manufacture[]` (5.15), `proxy_for` and
  fidelity tiers (5.14), writing targets from the checked revision, stale,
  undeclared and unchecked targets in the manifest and on stderr.
- **Acceptance.** Negative test with the real unifi names: checked
  `thumbscrew` and `link100`, exported `screw1..3` and `link`; without
  declarations the targets are `unchecked`; with them "checked on proxy"
  with the reason. A repro with the structure of `cad-project-033`'s `out/`
  (hood.stl = the 60 mm variant, hood-40.stl legacy, lid.stl, reference parts
  not printed) reproduces the file set and its meaning; the same test on the
  real project once it builds (section 12).
- **Size M.**

### K7: motion over joint ranges

- **Scope.** `PrismaticJoint`; joint records; `assert_clearance_over`,
  `assert_no_interference_over`; `kernel/check/motion.bend` (5.4) with
  joint-invariant contact families and the Q11 upper bound; Q14 per sample;
  refusal for more than one varying joint per chain.
- **Acceptance (non-R20 fixtures first).** A hinge whose end poses are clear
  but which collides at an intermediate angle fails with that angle; a hinge
  with flush knuckles perpendicular to the axis passes (sliding contact
  removed by certificate); a slider on a rail passes over its travel; the
  `coupons.py:165-168` lift sweep as `assert_no_interference_over` on a
  prismatic joint passes with the proven range. R20's golden value "T01 ±50
  against R59B-Mitte" is bracketed when that geometry builds
  (`R20/checks/README.md:123-132` [C]).
- **Size L:** invariance certificates and the transform bound come on top
  of one Bend module.

### K8a: overhang bands, trims, bed

- **Scope.** `kernel/check/overhang.bend` regions (5.7), bed level and
  first-layer band; findings per region; `detect_overhang`, the `overhang`
  key; the viewer's printability handler switches its classification to this
  module and keeps only the tint.
- **Acceptance.** The band rows of the 5.7 table (cones, countersinks,
  chamfer, lying cylinder, ledge with fillet); the viewer's FDM QA fixtures
  (`scripts/viewer/qa/fixtures/chamfer-45.fs`, `cross-bore-16.fs`) give the
  same classifications as before or documented changes.
- **Size M.**

### K8b: bridges, islands, layer and anchor

- **Scope.** Anchors (5.7), chord families (Q10), the two fail criteria,
  first-layer islands through Q9 including cone sections, the
  layer-and-anchor test.
- **Acceptance.** The bridge rows of the 5.7 table, including the Ø6 hole
  through a 3 mm wall, the L-shaped slot, the annular ceiling and the three
  anchor-reachability rows; first-layer islands of a part with a chamfer ring
  on its bottom edge.
- **Size L.**

### K9a: walls

- **Scope.** `kernel/check/wall.bend` (5.8): face-pair enumeration including
  adjacent and self pairs, opposed sub-bands, plane refinement, cone and
  cylinder self chords, fail witnesses certified by Q5 segment hits.
- **Acceptance.** The wall rows of the 5.8 table including the full-round
  rib; no oracle part reports a wall below 0.1 mm unless it has a real wall
  or a knife edge there; the families that still end `unresolved` are listed
  in the package report.
- **Size L.**

### K9b: knife edges, air gaps, thin features

- **Scope.** Knife edges with the zone width `feather_mm / tan θ`, air gaps
  with the opposition rule, thin features and the `pins[]` view, the optional
  `estimate` ray channel.
- **Acceptance.** The 45° knife rim reports a 0.50 mm zone; the V-groove
  gives no zero slot; the Ø1.5 pin is a thin feature below
  `pin_min_diameter_mm` only if the profile says so.
- **Size M.**

### K10: edge and house-style audit, lumps, bores

- **Scope.** `kernel/check/edges.bend`, `bores.bend`; C8 findings with
  grouping and style waivers; C9 over all body pairs; C10 with coaxiality
  tolerance and fit-aware notes; compat `warnings`, `bores`,
  `floating_solids`, `enclosed_voids`, `sharp_*_edges`.
- **Acceptance.** Oracle G2 warnings reproduced by kind; Ø20 cylinder rims
  reported; the slide-rib plate grouped into one finding; three floating
  lumps are classified pairwise; two separately built coaxial bores group;
  `hollow_cube` is refused at the Boolean with that reason.
- **Size M.**

### K11: orientation

- **Scope.** `kernel/check/orientation.bend` (5.12); `suggest_orientation`,
  `score_orientation`, `CANDIDATES`; orientation JSON.
- **Acceptance.** The six-entry ranked list keeps cad_khana's order on the
  oracle parts except for listed ties; the sphere reports a six-way tie (after
  K17c); the `cad-project-026` carriage case gives exact support values once it
  builds.
- **Size M.**

### K12: viewer check layers and waiver authoring

- **Scope.** Query-worker kind `checks`; the layers and panel of 6.6; joint
  sliders; waiver authoring into the sidecar through K6a's loader; the checks
  chip including `waived-unresolved`.
- **Acceptance.** Browser QA on the oracle assemblies: every failing record
  can be focused; a waiver made in the viewer shows as `waived` in the next
  run of a Python model without touching the Python; the live loop shows a
  changed verdict within one rebuild. QA uses a scratch port, never 4310 or
  4311.
- **Size L:** UI plus worker.

### K13: CLI, diff, status, pick, hints

- **Scope.** `wonky check|build|view|diff|status|pick` for `.py` and `.fs`;
  `wonky khana …` translation; revision diff over `brep.json` with
  tolerance- and identity-aware check deltas and `--fail-on-regression`;
  `wonky status`; `wonky pick` over exact-measure rows; hint catalog;
  stale-export listing; friendly refusal of watch loops.
- **Acceptance.** Diffing two revisions of a parameter change reports no
  float dust and names the changed faces; `wonky status` works with no viewer
  running and never touches ports 4310/4311; `wonky pick` reports a 2° tilt
  as not coplanar with its maximum deviation.
- **Size M.**

### K14: STEP with tree, names, colors; per-part STL; 3MF

- **Scope.** Assembly structure (`NEXT_ASSEMBLY_USAGE_OCCURRENCE` per placed
  part and sub-assembly), product names, `STYLED_ITEM`/`COLOUR_RGB`,
  material property; per-part print STL and 3MF from the committed print
  mesh (`HEAD:src/print-mesh.mjs:128-150` [C]: bands and discs), with a named
  refusal for every other face ("r20 print mesh required"); `export_assembly`
  native; declared print targets (K6b).
- **Acceptance.** `uv run scripts/validate-step.py` reads back names, colors
  and tree (OCCT as independent artifact validation); geometry unchanged
  against the single-product export; a part with a trimmed arc face is
  refused by name for STL, not approximated.
- **Size M.** Partial r20: the broader print-mesh coverage is the
  uncommitted r20 task-7 work (`git diff --stat src/print-mesh.mjs`: 558
  insertions, 124 deletions [M, review-exactness.md M7]).

### K15: GLB and animated GLB

- **Scope.** JS GLB writer (inventory-tooling.md §12.7): nodes = tree,
  names, linear baseColor, deviation in `extras`; animated GLB from joint
  records; `export_glb`, `export_animated_glb`, inert `_gltf_transform_join`,
  `draco=True` refused with a message. Meshes from the same committed print
  mesh as K14, with the same named refusals.
- **Acceptance.** The project-component-0e791726 study's checks (`cad-project-022/concept-02/study.py:386-387`,
  count animations and channels) pass on a repro; the project-component-d753d790 call runs with
  its monkeypatch untouched; a glTF validator run is clean.
- **Size M.** Partial r20, as K14.

### K16: FeatureScript sidecar, WK/0 records, R20 scene import

- **Scope.** `--checks` for `.fs` through K6a's loader; part selectors by
  name, operation and identity; WK/0 `check.*` records and preflight; an
  importer for the common subset of `r20/checks-scene/v1`, the motion spec
  and the interfaces spec (6.3).
- **Acceptance.** A non-R20 FeatureScript fixture with a sidecar gives the
  same records as the equivalent Python assembly; an R20 scene subset runs
  on the bodies that build and reports the rest as `refused` with reasons.
- **Size M.**

### K17a (r20): curved overlap volumes, volumes and centroids

- **Scope.** Q8 through the hybrid INTERSECTION and `kernel/volume.bend`
  (task 10, `local design note` [C, kernel-gaps.md §9]); volume moments for
  centroids; labels per 3.2 (quadrature stays `estimate` until an enclosure
  is proven).
- **Acceptance.** Curved overlap volumes of the oracle move from `refused` to
  labelled values; `center_of_mass_mm` filled.
- **Size L.**

### K17b (r20): sphere and torus primitives

- **Scope.** Sphere and torus in Q1 to Q7 and Q13; torus ray roots by
  exclusion (Q5).
- **Acceptance.** Oracle sphere and torus facts and distances move from
  `refused` to labelled values.
- **Size L.**

### K17c (r20): sphere and torus in C6 and C7

- **Scope.** Sphere caps; torus bands for `u` parallel to the axis, other
  torus orientations `refused` until a proven quadrature bound exists (5.7).
- **Acceptance.** An axial torus fillet gives a closed-form band; a tilted
  one is refused by name.
- **Size L.**

### K18 (r20): certified-mesh distance path

- **Scope.** kernel-gaps.md §6.4: per-face certified meshes with proven
  two-sided deviation (open question O6), the BVH minimum join, final
  candidates in F32x2 (O4), refinement; `approximation` label.
- **Acceptance.** Distances to certified-mesh bodies bracket the exact answer
  on bodies where both paths apply.
- **Size L.** Needs r20 committed (certified-mesh bodies are r20 task 11).

### K19: drawings from Bend

- **Scope.** Orthographic projection, silhouettes, visibility by Q5 and Q4,
  exact conic arcs in SVG, one scale, scale bar, model id; `wonky draw`,
  `draw()`.
- **Acceptance.** The ten cad_khana view presets on the oracle assemblies;
  unknown formats are errors.
- **Size L.** Low priority.

### K20: skill and doctrine switch

- **Scope.** Write the `wonky-cad` skill from doctrine-draft.md and section
  12; retire `watch.py` in the skill.
- **Acceptance.** One representative real project passes the full loop in
  wonky with Marc's go: edit, check, viewer, manufacturing export of its
  declared targets, slicer verification of those files. The prerequisites
  per project are listed in section 12.
- **Size S.**

### K21: multi-shell bodies and voids

- **Scope.** A body format with inner shells (kernel-gaps.md P7, open
  question O7), the Boolean that creates them, and C9 void findings. Not r20:
  `HEAD:src/boolean.mjs:205` refuses enclosed voids independently of the
  hybrid [C].
- **Acceptance.** The printability oracle's `hollow_cube` and spherical-void
  cases build and report their void; walls to the void are C7 walls.
- **Size L.** Kernel work; a separate decision.

**Early value.** K1a and K1b give Marc honest check records and the live
loop on the models that build today, and they keep his exception-based
scripts working. K3a to K5 (with K3c) give the mechanism checks he uses most
(183 no-interference and 22 clearance sites) for plane, cylinder and cone
parts. K6a, K8a/K8b and K9a/K9b then fix the two checks he switches off most.

## 12. The Claude skill

The skills stay untouched until K20 (directive item 6). What carries over
from `~/.claude/skills/cad-khana/SKILL.md` and
`~/.claude/skills/cad-fdm-design/SKILL.md` into a later `wonky-cad` skill:

| convention | source | in the wonky skill |
| --- | --- | --- |
| four script sections, pure part functions, explicit `Location`s, coordinate frame in the docstring | cad-khana `SKILL.md:144-158`, `:229-318` | kept |
| assert every candidate pair ("over-assert") | `:173-181` | changed: coverage is automatic (C2); assertions state intent: fit classes, expected contacts, expected overlaps with reasons, motion ranges |
| clearance ≥ 0.2 mm for moving pairs, a real number | `:178-181` | a fit class from the profile (`min_mm="sliding"`) |
| check until green, then draw | `:182-186` | `wonky view` plus the checks panel; `wonky draw` only for shape questions (K19) |
| read `hint` first, then assertions and interferences | `:628-643` | read the stderr lines and the `wonky` block; `unresolved` and `refused` are never green; `estimate` never proves a pass |
| loop cap 3 to 5 and `HUMAN_REVIEW` | `:661-694` | kept |
| two fidelity tiers, do not inspect bought parts | `:273-304` | tiers recorded; bought parts `printed: false`; proxies declared |
| `khana pick` review loop with per-push indices | upstream skill `:119-137`; cad-fdm-design `SKILL.md:64-73` | viewer aliases and `wonky pick`, stable across rebuilds |
| `watch.py` + OCP viewer, `uv run <part>.py` after geometry changes | cad-fdm-design `SKILL.md:53-62` | `wonky view`; declared print targets (5.15) written from the checked revision; until declared, the export script stays |
| waivers "tight and documented" | cad-fdm-design `SKILL.md:228-231` | per-region waivers with reasons (5.13) |
| field notes | cad-khana `SKILL.md:740-754` | a wonky field-notes file |
| design doctrine (house style, Formschluss, FDM rules, three states) | cad-fdm-design | doctrine-draft.md, each rule linked to its check and profile field |

The switch criterion is practical, not a date: K1b, K5, K6a, K6b, K8b, K9a,
K12, K13 and K14 done, the parity report accepted, and one representative
real project passing the whole loop in wonky (edit, check, viewer,
manufacturing export of its declared targets, slicer verification) with
Marc's approval. A pilot on a model that builds is not that acceptance.

**What each candidate project still needs** (measured blockers from
`docs/python-khana.md:248-283` and the sources [C]; the modeling gaps are
kernel milestones outside the K packages):

| project | modeling | frontend | checks | exports |
| --- | --- | --- | --- | --- |
| `cad-project-033` | fillets and chamfers of solid edges (`case.py:170-179`, `:243-267`; refused as a kernel gap, `python/build123d.py:114-151`); the paused fillet work | none known | K5 (poses, `within`), K6a, K8b, K9a | K6b declarations for `out/hood.stl` (60 mm), `hood-40.stl`, `lid.stl`, STEP; K14 |
| `cad-project-026` | fillets and chamfers (`bar.py:132`, `:146`, `:151`, `:240`) | none known | K5, K6a, K9a, K11 (`suggest_orientation`, `assembly.py:77` [C]) | K6b for `bar.stl`, `bar-test.stl`, `carriage.stl`, `endcap.stl`, STEP (`bar.py:273-284`); K14 |
| cad-project-003 coupons | `coupons.py` reaches `inspect()` at `:149`, later steps unverified; the family files stop at Boolean refusals of arc-edged shells | none | K5 (`assert_fit` on the slide coupon), K6a, K7 (lift sweep) | K6b; K14 |
| `pin_hinge` (skill example) | builds | none | K5, K7 | K14 |

The first real switch candidate is therefore whichever project's modeling
gap closes first; `pin_hinge` and the coupons serve as pilots before that.

## 13. Dependency policy for the other corpus packages (recommendation)

Separate from cad_khana, current state: only the standard library, project
modules and wonky's own `build123d`, `cad_khana`, `ocp_vscode` are importable
(`docs/python-khana.md:171-194` [C]). Recommendation, by what a package does,
not by its name (corpus counts direct / with project modules / first
blocker, `docs/python-khana.md:206-219` [C]):

| lane | packages | policy | reason |
| --- | --- | --- | --- |
| geometry authority | OCP (4/7/1), trimesh (9/10/2), shapely (2/2/0), scipy.spatial hulls, manifold3d, fcl, rtree, ocp_tessellate (1/1/1), bd_warehouse construction (3/7/7) | refuse in modeling, always; port the needed capability to Bend (threads, 2-D region Booleans and offsets, hulls, the tessellation and pick needs covered by K3a to K3e and K13) | AGENTS.md line 4; a second geometry kernel would decide results |
| numeric and data | numpy (18/19/18), yaml `safe_load` (2/4/4), scipy optimization such as `linear_sum_assignment` | allow pinned versions in modeling, as long as the value feeds parameters and never replaces a geometric query | these compute numbers, not shapes; numpy is the largest single blocker |
| reports | matplotlib (2/2/0), PIL (1/1/0) | allow in a separate report lane (a script that reads `brep.json` and the check records), not inside the modeling run | output only |
| tests | pytest (13/13/6) | allow in a test runner lane; a test module is not a model | 5 corpus files are test modules |
| transport | httpx (0/1/1) | refuse in deterministic modeling | no remote geometry fallback |

R20's check library uses fcl, trimesh, manifold3d and rtree
(`R20/checks/clearance.py:24-26`, `README.md:12`, `:21`, `:24` [C]); under this policy it stays an external
comparison tool, and its common subset moves onto wonky's exact checks (K16).

## 14. Decisions for Marc

Each with the recommended option first.

1. **Unexpected overlaps fail the report** (recommended), or only warn.
   Recommended because `status ok` next to an overlap is the weakness the
   directive names; it turns 7 of the 39 stored `mechanism.json` red until the
   pose ghosts become `with_pose` and the real overlaps get assertions.
2. **Contact tolerance is a length** (recommended: 1e-6 mm plus the bodies'
   stated deviations), or keep cad_khana's 0.001 mm³ for parity. The volume
   rule lets a 25 µm overlap pass on a small patch and fails 20 nm on a big
   one.
3. **Clearance is solid distance** (recommended: a buried part has distance 0),
   or OCCT's boundary distance for parity (8.0 for the nested cube).
4. **Two call contracts** (recommended): the compat calls keep cad_khana's
   `SystemExit` on a failing record by default, because the unifi cache and
   the `except SystemExit` readers depend on it; run to completion is
   opt-in per run or project (`--collect`). Alternative: collect by default
   and migrate the exception-based files first. (Revised: the first draft
   recommended "never stop"; the workflow review measured that it breaks
   the unifi cache.)
5. **The ray-sampled minimum wall is no longer a gate** (recommended: the
   certified opposed-face wall decides, the ray number is an optional
   estimate), or reproduce cad_khana's number for comparability.
6. **Old whole-part switch-offs** (`overhang_max_deg=91`, `wall_min_mm ≤
   0.05`) are accepted, reported as part-scope waivers with the area they
   hide, and print a `WAIVED` line on every run (recommended), or refused at
   once. `--strict` refuses them; Marc sets the date from which strict is
   the default (proposal: when K8b and K9a are done, since they remove the
   false alarms that caused the switch-offs).
7. **R20's check library** stays as is for now; wonky imports its common
   subset (clearances, motions, contacts, keep-outs) and runs it on exact
   bodies side by side (recommended). Moving fall rays, shadowing and swept
   free-space bodies into wonky is a later decision.
8. **No `khana` alias on PATH** until the skill switch (recommended);
   `wonky khana …` translates meanwhile. An alias would shadow the installed
   tool that other sessions use today.
9. **Check results live in `brep.json`** (recommended; geometry identity stays
   per body revision), or in a sidecar keyed by model id.
10. **Output files stay where the script writes them**, plus a run manifest and
    stale detection (recommended); per-script folders only as an option.
11. **Knife edges below 60° fail** unless waived (recommended, the doctrine's
    "no feather edges, ever"), or are only advisory.
12. **Adopt the starter profile** of 5.6, labelled `starter`, and calibrate the
    fit classes first with coupons (recommended). Until calibrated, fits
    report "nominally clear, not calibrated".
13. **New API as extension methods on the compat `Assembly`** (`with_pose`,
    `expect_contact`, `assert_fit`, `assert_clearance_over`, `waive`,
    `print_target`) (recommended), or a
    separate `wonky` Python module.
14. **Prismatic joints and explicit pose sets in v1** (recommended); `path` and
    `coupled` joints later; pose ghosts are not inferred silently (a hint
    only).
15. **Parity references:** closed forms first, OCCT on wonky's own STEP
    second; G2 (your worktree, frozen by tree hash) for printability
    behaviour, the installed 0.0.2 for the CLI, and the uncommitted `pick.py`
    only for the questions a pick answers (recommended).
16. **Fits on interfaces** (recommended): fit classes are verified with
    `assert_fit` on declared faces or regions and directions; a global
    `assert_clearance` stays a minimum-distance check and is never reported
    as play. Alternative: keep only the global minimum (cannot express a
    seated slider).
17. **Expected overlaps bound to a region** (recommended): new code writes
    `assert_interference(..., within=...)`; legacy pair-wide calls stay
    accepted and show their component count; `--strict` refuses them.
18. **Manufacturing declaration** (recommended): print targets are declared
    (`print_target`), including variant, print pose, count, path and the
    check that covers them; proxies are declared, never inferred from names.
    Alternative: keep the separate export scripts indefinitely.
19. **Compat JSON contract per file** (recommended): legacy 0.2 only when
    fully representable, else `0.2+wonky.1`, which the installed `khana diff`
    refuses cleanly. Alternative: always 0.2 with `null`s (crashes the
    installed diff) or invented numbers (rejected).
20. **Face-interior cone-cone distances `unresolved` in v1** (recommended),
    with a nested certified search as later research. Two chamfer rings
    facing each other within the threshold then need an `assert_fit` on
    other faces, a waiver or the later search.

## 15. Risks and open points

- `kernel/volume.bend` and the curved INTERSECTION arms are uncommitted r20
  work (kernel-gaps.md §9 [C]); until they land, volumes of Boolean results,
  overlap volumes of curved pairs and centres of mass are `refused`. The
  verdicts do not depend on them, the reports show `null` with a reason.
- The classifiers never load on the native backend (`src/index.mjs:15-22`
  [C]); K4d must wire them or refuse natively. Performance of the distance
  path, the crossing test and the chord families is inferred, not measured
  (kernel-gaps.md §6.6).
- Waivers and review references rely on identities surviving edits. Where the
  identity is only revision-local (`docs/topology-identity.md` `stability`
  [C]), a waiver becomes orphaned and its finding reappears. That is the
  honest behaviour, but it may be noisy until identity stability improves.
- Arbitrary rotations are rounded in F32x2 and no bound exists today
  (`src/exactness.mjs:15-16` [C]). K4c derives it (Q14) and evaluates pairs
  in the relative frame; until then, rotated flush contacts are exactly the
  pairs that would end `unresolved`. The cases are in the 5.1 table.
- `exact` rests on stated allowances, not on directed rounding
  (`kernel/real.bend:1-155` [C], 3.2). A wrong allowance would be a wrong
  verdict; each K package therefore writes its allowance next to its tests.
- v1 leaves named gaps `unresolved`, not green: face-interior cone-cone
  distances, persistent contacts that are not joint-invariant, bridges no
  admitted chord family covers, wall pairs the refinement cannot decide.
  Parts with many chamfer rings near other chamfer rings may show several
  `unresolved` records until the nested search exists.
- The legacy exception contract keeps "first failure hides the rest" for
  files that do not opt into `--collect`. The runner names the calls that
  did not run, but only migration removes the effect.
- Most corpus models do not build in wonky yet (first blockers,
  `docs/python-khana.md:248-283` [C]); parity on Marc's real outputs arrives
  after the kernel gaps close, so early parity rests on the synthetic cases.
  Marc's two named switch projects need fillets and chamfers first
  (section 12).
- Every change of a Bend evaluator module costs 15 to 27 s and 3 to 7 GB to
  compile (`docs/language.md:54` [C]); section 11 splits the kernel
  packages accordingly, and the sizes remain estimates.
- The hybrid refuses face-touching intersections by design
  (`docs/hybrid-boolean-plan.md:304` [C]). Nobody needs to change that: C1
  decides contact in the distance module and never asks the Boolean about a
  touching pair.

## 16. Review disposition

Two reviews of the architect's draft: [review-exactness.md](review-exactness.md)
(verdict "fixable": 2 blockers, 11 major, 10 minor) and the workflow review
(10 findings: 9 major, 1 minor; delivered as a structured result; probes in
`tmp/khana/review-workflow/`, worklog local development evidence).
Every finding was accepted; none is rejected. Where the fix differs from the
review's proposal, the column says how and why. Both blockers are resolved in
the design; they become real only when K4b and K4c pass their named cases.

### 16.1 review-exactness

| id | finding (short) | disposition | where |
| --- | --- | --- | --- |
| B1 | `touching` cannot be certified on placed parts; `overlapping` undefined | fixed as proposed: witness-ball `overlapping`, tolerant contact families for `touching`, else `unresolved`; relative frames; Q14 transform bound derived in Bend (K4c) with the rotated-B and decimal-offset cases | 1 item 4, 3.3, 4.2 Q7 Q14, 5.1, K4c |
| B2 | lower-strata argument misses closed crossing loops (boss/pin) | fixed as proposed: explicit face-face crossing test Q13 before the nesting test; the property test replaced by named cases (both seam placements, pin through plate, cylinder through tube wall) | 4.2 Q13, 5.1, K4b; correction note in kernel-gaps.md §6 |
| M2 | cone-cone and cone-torus face distances are 2-D | fixed by the review's second option: face-interior cone-cone pairs are `unresolved` in v1 and listed in the 5.1 coverage table; the nested search is later research (decision 14.20); cone-torus goes with K17b | 4.2 Q6, 5.1, 9 rank 23; correction note in kernel-gaps.md §6.5 |
| M3 | Q10 convex-hull width is the wrong quantity | fixed and generalized: anchored chord families (parallel, radial, circumferential) instead of one direction, plus two certified fail criteria (anchors on one line; a point farther than span/2 from every anchor), otherwise `unresolved`; the Ø6-through-3-mm hole, L-slot and annulus are cases. Generalized because a single direction cannot cover an L-shaped ceiling | 4.2 Q10, 5.7, K8b |
| M4 | wall decision incomplete for adjacent and self pairs; knife zone formula | fixed as proposed (opposed sub-bands, cone self chords `2ρ cos β`, Q5-certified fail witnesses, one knife-zone definition `feather/tan θ` = 0.50 mm at 45°), plus a closed-form plane refinement so the full-round rib tip is decided exactly; "coverage complete" replaced by "enumeration complete, remaining `unresolved` families listed" | 5.8, K9a, K9b |
| M5 | motion cannot prove persistent contacts; Q11 over-specified | fixed as proposed: joint-invariant contact families removed by certificate before bisection; non-invariant persistent contacts `unresolved` and named; Q11 is an upper bound | 4.2 Q11, 5.4, K7 |
| M6 | plane sections do not cover cones | fixed: cone sections (circle, ellipse; hyperbola and parabola refused by name) in K3d; the Q9 row corrected | 4.2 Q9, 5.7, K3d |
| M7 | hidden r20 dependencies | fixed: K14/K15 marked "partial" and scoped to the committed print mesh with named refusals; K4b copies the Morton tree and join from `HEAD:kernel/proto/recover/clear.bend` and imports neither path; K7 and K16 got non-R20 fixtures; voids moved to K21 (body format, not r20) | 4.2 Q6, 5.8, 11 |
| M8 | torus overhang and torus ray roots not exact | fixed as proposed: torus coverage only for `u` parallel to the axis, else `refused`; roots isolated by exclusion, undecided intervals `unresolved` | 4.2 Q5, 5.7, K3e, K17c |
| M9 | parity oracle compares different geometry | fixed as proposed: closed forms primary, OCCT on wonky's own STEP secondary, cad-khana JSON behavioural only; intended differences must name their closed form; `src_g2` tree hash frozen | 10, K2 |
| M10 | refused values become `None`; `.status` blurs refused | fixed as proposed: latched `Refused` object, `.status == "refused"`, FeatureScript `ev*` wrappers raise for refused and for too-wide bounded results | 3.1, 5.5, 6.2, 6.3 |
| M11 | host computes geometry (brep.mjs facts, budgets, fits) | fixed: rule restated ("predicates and measurements in Bend; the host combines Bend-issued verdicts and intervals"); `src/brep.mjs` sums labelled `estimate` and never gate; budgets, growth and fit predictions decided in the Bend call; committed Bend volumes cited and used | 3.2, 4.1, 4.5, 5.5 |
| M12 | five packages too large | fixed: K3a–K3e (K3d and K3e added for M6 and Q5), K4a–K4d, K8a/K8b, K9a/K9b, K17a–K17c; K7 resized to L; K1 split into K1a/K1b for the workflow findings | 11 |
| m1 | "exact" is an allowance | fixed: `exact` defined as closed form plus a stated allowance per primitive; gate predicates polynomial where possible; "certified/proven" wording removed from the summary | 1 item 3, 2.2, 3.1, 3.2 |
| m2 | clearance passes overlaps at `min_mm ≤ decide`; gaps not exact | fixed: pass needs `separated` or `touching`; gap row reworded; `min_mm=0.0` on an overlap is a case | 5.1, K5 |
| m3 | exact zero tests near tangency | fixed: `smooth_deg` (0.5°) and `coaxial_mm`/`coaxial_deg` stated; defaults are proposals for K3b and K10 to confirm | 3.3, 4.2 Q3 Q12, 5.9, 5.11 |
| m4 | existing conservative bounds overlooked | fixed: `kernel/face-bounds.bend` and `kernel/curve-band.bend` cited and reused for the broad phase | 4.2 Q2, 5.1, 5.2, K3a |
| m5 | void citations point at uncommitted code | fixed: `HEAD:src/boolean.mjs:205`, `HEAD:src/analytic.mjs:280`; the spherical-void wall row moved to K21 | 2.3, 5.8, 5.10, K21 |
| m6 | legacy switch-offs silent in `.status` | fixed: `WAIVED` stderr line with the hidden area on every run; Marc sets the strict date (proposal: after K8b and K9a) | 1 item 7, 5.13, 7.4, 14.6 |
| m7 | exports after a failing check unmarked | fixed: per-export verdicts in `.wonky-run.json` and the stderr summary | 7.3, 7.4 |
| m8 | C9 only against the main body | fixed: all body pairs | 5.10, K10 |
| m9 | bridge anchor undefined | fixed: anchor length measured along the anchoring boundary; no dependency on C7 | 5.6, 5.7 |
| m10 | waiving `unresolved` turns it green | fixed: `waived-unresolved`, never counted as pass, exit code 2 | 3.1, 5.13, 6.6, 7.4 |

### 16.2 workflow review

| id | finding (short) | disposition | where |
| --- | --- | --- | --- |
| W1 | expected overlap exempts the whole pair | fixed as proposed: coverage per overlap component, `within=` binds expected overlaps and contacts to a region; legacy pair-wide assertions reported with their component count, refused under `--strict`; acceptance: correct snap overlap plus an extra collision outside the region fails | 5.1, 5.2, K5, 14.17 |
| W2 | non-raising `inspect` breaks the unifi cache (measured) | fixed: the legacy `SystemExit` contract stays the default for the compat package, run to completion is opt-in (`--collect`); the run manifest validates reused JSON files; the two-run unifi test is K1a acceptance in both contracts | 1 item 10, 6.2, 7.3, K1a, 14.4 |
| W3 | 0.2 "superset" not type compatible (installed diff crashes on `null`) | fixed as proposed: legacy 0.2 only for fully representable files, otherwise versioned `0.2+wonky.1`, which the installed diff refuses cleanly; no invented numbers; a compat-file `wonky diff` early in K1b; K1a accepts with the real diff on wonky's files. The name census was re-checked independently and was *not* complete: 4 type-checking-only imports and 15 private names were missing (Appendix A) | 7.2, K1a, K1b, A.2, A.4 |
| W4 | global minimum distance cannot check fit classes | fixed as proposed: `assert_fit` on declared faces, regions and directions with profile fit classes; a passed global clearance is never reported as play; acceptance on the cad-project-003 slide coupon with its seat contact | 5.1, 5.6, K5, 14.16 |
| W5 | live loop does not replace the export scripts | fixed as proposed: manufacturing declaration (variant, print pose, count, path, checked revision); the claim that the separate script is replaced is removed until a project declares its targets; the project-component-a8102813 `out/` set is a K6b case | 1 item 11, 5.15, 8, K6b, 12 |
| W6 | proxy detection by name misses the unifi relations | fixed as proposed: proxy relations are declared through print targets, independent of display names and poses; unmatched printed targets are `unchecked`; the real unifi names are the K6b negative test | 5.14, K6b |
| W7 | viewer waivers and profile edits do not reach Python runs | fixed as proposed: one input loader for all frontends with a fixed precedence; spec, waiver and profile files are hashed watch inputs; K12 depends on K6a; acceptance: change only JSON, the next run shows the new verdict | 6.1, 5.13, 6.6, K6a, K12 |
| W8 | early value and skill switch not tied to real prerequisites | fixed as proposed: K1a/K1b are a bounded pilot on models that build; a per-project prerequisite table (fillets and chamfers for project-component-a8102813 and LEGO, K11 for LEGO, K14 exports); K20 needs a full real-project loop acceptance | 1 item 12, 11, 12 |
| W9 | layer sections and anchor reachability deferred | fixed: a narrow layer-and-anchor test in K8b with tests for anchors on differently supported material; until then C6's bridge pass is labelled a geometric pre-check, never "support-free" | 1 item 8, 5.7, 9 rank 21, K8b |
| W10 | pose inheritance contradicts project-component-a8102813's pose-specific assertions | fixed as proposed: explicit base pose, `@*` for all poses, the most specific assertion wins, contradictions are an error at declaration; K5 accepts the real project-component-a8102813 pattern (seat, entry, elastic mid-slide and near-seat squeeze) | 5.3, K5 |

W1 to W10 follow the order of the findings in the revision task (W10 is the
minor one).

### 16.3 Corrections found while revising

- AGENTS.md line numbers: capability errors are line 7, polygonization
  line 8, the r10b snapshot line 6, benchmarking line 10 (the draft and
  review-exactness M10 cited 6, 7, 5, 11). Corrected in 4.5.
- `coupons.py` line citations: the lift sweep is `:165-168`, the middle-slice
  fit distance `:169-173`.
- kernel-gaps.md §6 (lower-strata argument, edge-cone 1-D claim for
  cone-cone) is corrected by a dated note in that file; its measurements
  stand.
- `tmp/khana/architect/design-0N.md` and `mapping.mjs` are stale; this file
  is the only current version.

## Appendix A. Disposition of every cad_khana name

Source of the name list: `tmp/khana/corpus-usage/public-api-enriched-declarations.json` (upstream worktree, 246 own public declarations: 48 functions, 42 constants, 25 classes, 114 fields, 13 methods, 4 properties; plus 199 imported module attributes). Generated by `tmp/khana/architect/mapping.mjs`, which fails when a name has no disposition. **Re-checked in the revision** by an independent AST walk of `U/` that also descends into `if TYPE_CHECKING:` blocks and class bodies (`tmp/khana/revise/census.py` → `census.json`, run with `uv run --no-project --python ~/.local/share/uv/tools/cad-khana/bin/python`) [M]: it confirms all 246 declarations of A.1 and the workflow review's independent count (`tmp/khana/review-workflow/source-contracts.json`: 246 and 199), and it finds what both earlier counts missed: 4 import bindings that exist only under `if TYPE_CHECKING:` (A.4 is now 203), 12 public-named fields of the private classes `_Polyline` and `_EllipseArc`, and 15 private names that A.2 lacked, plus 2 it listed under the wrong owner; all are added or corrected below. After the revision this appendix is maintained by hand; `mapping.mjs` is stale. Dispositions: `kept` (real behaviour), `replaced by X`, `compat stub` (thin, for existing model files), `dropped` (access raises a capability error naming the replacement, or `AttributeError` for private names as today, `python/cad_khana/_wonky.py:139-155`).

### A.1 Public declarations (246)

**`cad_khana._paths`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `resolve_out` | FunctionDef | kept | same anchoring semantics (`python/cad_khana/_paths.py:9-16`) |

**`cad_khana.cli`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `app` | constant-or-binding | replaced by the `wonky` CLI | `bin/wonky.mjs` with subcommands (K13); importing `cad_khana.cli` stays a capability error naming it |
| `build` | FunctionDef | replaced by `wonky build <model>` | checks plus exports, every record reported, run to completion with `--collect` (K1a, K13) |
| `check` | FunctionDef | replaced by `wonky check <model>` | checks without exports (K1a, K13) |
| `DiagArg` | constant-or-binding | dropped | typer argument type; no Python CLI in wonky |
| `diff` | FunctionDef | replaced by `wonky diff` | tolerance- and identity-aware, reads 0.2 files (K13) |
| `draw` | FunctionDef | replaced by `wonky draw <model>` | Bend HLR drawings (K19) |
| `main` | FunctionDef | replaced by the `wonky` CLI | console entry; `wonky khana <cmd>` translates (K13, decision 14.8) |
| `OutOpt` | constant-or-binding | dropped | typer option type |
| `pick` | FunctionDef | replaced by `wonky pick <model> --alias …` | exact-measure rows on revision-bound aliases (K13) |
| `ScriptArg` | constant-or-binding | dropped | typer argument type |
| `status` | FunctionDef | replaced by `wonky status` | K13 |
| `view` | FunctionDef | replaced by `wonky view <model>` | live server with checks (K1b, K12) |

**`cad_khana.core.tessellation`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `TESSELLATION_ANGULAR_TOLERANCE` | constant-or-binding | compat stub | value kept, no effect |
| `TESSELLATION_TOLERANCE_MM` | constant-or-binding | compat stub | value kept, no effect: no check reads triangles; wonky states the achieved deviation of its certified mesh |
| `Triangle` | ClassDef | dropped | no check reads triangles; the certified print mesh (`src/print-mesh.mjs`) serves display and export; access names the `--format print` export |
| `Triangle.area` | field | dropped | field of `Triangle` |
| `Triangle.centroid` | field | dropped | field of `Triangle` |
| `Triangle.normal` | field | dropped | field of `Triangle` |

**`cad_khana.diff`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `Diag` | constant-or-binding | dropped | type alias of the diff module |
| `diff` | FunctionDef | replaced by `wonky diff` | K13 |

**`cad_khana.draw`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `auto_enabled` | FunctionDef | compat stub | inert toggle |
| `auto_fmt` | FunctionDef | compat stub | inert toggle |
| `auto_out` | FunctionDef | compat stub | inert toggle |
| `auto_part` | FunctionDef | compat stub | inert toggle |
| `auto_themeable` | FunctionDef | compat stub | inert toggle |
| `auto_views` | FunctionDef | compat stub | inert toggle |
| `CAMERA_DISTANCE_FACTOR` | constant-or-binding | compat stub | value |
| `CURVE_SAMPLES` | constant-or-binding | compat stub | value only: wonky draws exact conic arcs, no curve sampling |
| `DEFAULT_VIEW_NAMES` | constant-or-binding | compat stub | data kept |
| `draw` | FunctionDef | replaced by `wonky draw` (K19) | until K19 a capability error naming the viewer PNG export |
| `HIDDEN_COLOR` | constant-or-binding | compat stub | value |
| `IMAGE_SIZE_PX` | constant-or-binding | compat stub | value |
| `LINE_WIDTH_PX` | constant-or-binding | compat stub | value |
| `MARGIN_FRACTION` | constant-or-binding | compat stub | value |
| `Point` | constant-or-binding | dropped | internal type alias |
| `Segment` | constant-or-binding | dropped | internal type alias |
| `set_auto` | FunctionDef | compat stub | inert toggle (already provided, `python/cad_khana/draw.py:5-40`) |
| `STANDARD_VIEWS` | constant-or-binding | compat stub | data kept |
| `SUPERSAMPLE` | constant-or-binding | compat stub | value |
| `View` | ClassDef | compat stub | record type accepted; drawing refused until K19 |
| `VIEW_PRESETS` | constant-or-binding | compat stub | data kept, used by K19 |
| `View.look_from` | field | compat stub | field of `View` |
| `View.look_up` | field | compat stub | field of `View` |
| `View.name` | field | compat stub | field of `View` |
| `VISIBLE_COLOR` | constant-or-binding | compat stub | value |

**`cad_khana.environment`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `EnvironmentReport` | ClassDef | replaced by the `wonky status` JSON | versions of wonky, the build123d shim, Python, Bend; viewer servers; schema versions; profile |
| `EnvironmentReport.bd_warehouse` | field | replaced by the `wonky status` JSON | field of `EnvironmentReport` |
| `EnvironmentReport.build123d` | field | replaced by the `wonky status` JSON | field of `EnvironmentReport` |
| `EnvironmentReport.cad_khana` | field | replaced by the `wonky status` JSON | field of `EnvironmentReport` |
| `EnvironmentReport.ocp_vscode` | field | replaced by the `wonky status` JSON | field of `EnvironmentReport` |
| `EnvironmentReport.python` | field | replaced by the `wonky status` JSON | field of `EnvironmentReport` |
| `EnvironmentReport.schema_version` | field | replaced by the `wonky status` JSON | field of `EnvironmentReport` |
| `EnvironmentReport.status` | field | replaced by the `wonky status` JSON | field of `EnvironmentReport` |
| `probe` | FunctionDef | replaced by `wonky status` | K13 |
| `ViewerStatus` | ClassDef | replaced by the viewer section of `wonky status` | running live servers, read only; ports 4310/4311 untouched |
| `ViewerStatus.error` | field | replaced by the viewer section of `wonky status` | field of `ViewerStatus` |
| `ViewerStatus.importable` | field | replaced by the viewer section of `wonky status` | field of `ViewerStatus` |
| `ViewerStatus.reachable` | field | replaced by the viewer section of `wonky status` | field of `ViewerStatus` |

**`cad_khana.export`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `export_animated_glb` | FunctionDef | kept | from joint records with exact pivot channels; `factory(t)` still accepted (K15) |
| `export_assembly` | FunctionDef | kept | native STEP with tree, names, colors plus per-part print STL from the committed print mesh, other faces refused by name until r20 (K14) |
| `export_glb` | FunctionDef | kept | native JS GLB writer, no gltf-transform; `draco=True` is a capability error naming `draco=False` (K15) |

**`cad_khana.mechanism.assembly`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `Assembly` | ClassDef | kept | provided today (`python/cad_khana/mechanism/assembly.py:110-216`); names validated at declaration (5.2) |
| `Assembly.assert_clearance` | method | kept | evaluated by C1: pass needs `separated` or `touching` and the distance bound; `min_mm` may be a fit class, optional `max_mm`; fits on interfaces use the new `assert_fit` (5.1) |
| `Assembly.assert_interference` | method | kept | evaluated by C1 per overlap component; optional `within=` region, `max_depth_mm`, `max_mm3`; without `within` a pair-wide legacy assertion (5.1, 5.2) |
| `Assembly.assert_no_interference` | method | kept | evaluated by C1: pass on separated or touching (5.1) |
| `Assembly.assertions` | field | kept | field; records now evaluated |
| `Assembly.compound` | property | kept | property; flat compound as today |
| `Assembly.parts` | field | kept | field |
| `Assembly.placed_parts` | property | kept | property |
| `Assembly.subassemblies` | field | kept | field |
| `Assembly.with_detailed_geometry` | method | kept | fidelity tier recorded per check and export (5.14) |
| `Assembly.with_joint` | method | kept | joints recorded in metadata (K1a, K7) |
| `Assembly.with_joint_angle` | method | kept |  |
| `Assembly.with_materials` | method | kept |  |
| `Assembly.with_part` | method | kept | duplicate paths fail at this line |
| `Assembly.with_subassembly` | method | kept |  |
| `DetailOverride` | ClassDef | kept | record |
| `DetailOverride.color` | field | kept | field of `DetailOverride` |
| `DetailOverride.location` | field | kept | field of `DetailOverride` |
| `DetailOverride.material` | field | kept | field of `DetailOverride` |
| `DetailOverride.part` | field | kept | field of `DetailOverride` |
| `PlacedPart` | ClassDef | kept | record; fields name, part, location, color, material |
| `PlacedPart.color` | field | kept | field of `PlacedPart` |
| `PlacedPart.location` | field | kept | field of `PlacedPart` |
| `PlacedPart.material` | field | kept | field of `PlacedPart` |
| `PlacedPart.name` | field | kept | field of `PlacedPart` |
| `PlacedPart.part` | field | kept | field of `PlacedPart` |
| `RevoluteJoint` | ClassDef | kept | exact identity at angle 0 (`docs/python-khana.md:24`); `PrismaticJoint` added (5.4) |
| `RevoluteJoint.angle_deg` | field | kept | field of `RevoluteJoint` |
| `RevoluteJoint.axis` | field | kept | field of `RevoluteJoint` |
| `RevoluteJoint.transform` | property | kept | property |
| `RevoluteJoint.with_angle` | method | kept |  |
| `SubAssembly` | ClassDef | kept | record |
| `SubAssembly.assembly` | field | kept | field of `SubAssembly` |
| `SubAssembly.effective_location` | property | kept | property |
| `SubAssembly.joint` | field | kept | field of `SubAssembly` |
| `SubAssembly.location` | field | kept | field of `SubAssembly` |
| `SubAssembly.name` | field | kept | field of `SubAssembly` |

**`cad_khana.mechanism.assertions`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `Assertion` | constant-or-binding | kept | type alias |
| `Clearance` | ClassDef | kept | record |
| `Clearance.a` | field | kept | field of `Clearance` |
| `Clearance.b` | field | kept | field of `Clearance` |
| `Clearance.evaluate` | method | kept | host pair engine (C1) |
| `Clearance.min_mm` | field | kept | field of `Clearance` |
| `Clearance.name` | field | kept | field of `Clearance` |
| `evaluate` | FunctionDef | kept | evaluates every assertion of an assembly through the engine |
| `ExpectedInterference` | ClassDef | kept | record; optional bounds |
| `ExpectedInterference.a` | field | kept | field of `ExpectedInterference` |
| `ExpectedInterference.b` | field | kept | field of `ExpectedInterference` |
| `ExpectedInterference.evaluate` | method | kept | host pair engine (C1) |
| `ExpectedInterference.name` | field | kept | field of `ExpectedInterference` |
| `ExpectedInterference.reason` | field | kept | field of `ExpectedInterference` |
| `NoInterference` | ClassDef | kept | record |
| `NoInterference.a` | field | kept | field of `NoInterference` |
| `NoInterference.b` | field | kept | field of `NoInterference` |
| `NoInterference.evaluate` | method | kept | evaluated by the host pair engine (C1) |
| `NoInterference.name` | field | kept | field of `NoInterference` |

**`cad_khana.mechanism.check`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `check` | FunctionDef | kept | C1 to C5, writes `mechanism.json` (legacy 0.2 or `0.2+wonky.1`, 7.2); legacy contract raises `SystemExit` on a failing record after writing, `--collect` never raises (6.2) |
| `CheckResult` | ClassDef | kept | real result object: exports, diagnostics |
| `CheckResult.diagnostics` | field | kept | field of `CheckResult` |
| `CheckResult.exports` | field | kept | field of `CheckResult` |

**`cad_khana.mechanism.diagnostics`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `AssertionResult` | ClassDef | kept | record |
| `AssertionResult.detail` | field | kept | field of `AssertionResult` |
| `AssertionResult.name` | field | kept | field of `AssertionResult` |
| `AssertionResult.passed` | field | kept | field of `AssertionResult` |
| `BBox` | ClassDef | kept | record |
| `BBox.max` | field | kept | field of `BBox` |
| `BBox.min` | field | kept | field of `BBox` |
| `compute` | FunctionDef | kept | C2 all-pairs classification plus C5 facts |
| `Diagnostics` | ClassDef | kept | record plus the `wonky` extension |
| `Diagnostics.assertions` | field | kept | field of `Diagnostics` |
| `Diagnostics.error` | field | kept | field of `Diagnostics` |
| `Diagnostics.exports` | field | kept | field of `Diagnostics` |
| `Diagnostics.hint` | field | kept | field of `Diagnostics` |
| `Diagnostics.interferences` | field | kept | field of `Diagnostics` |
| `Diagnostics.parts` | field | kept | field of `Diagnostics` |
| `Diagnostics.schema_version` | field | kept | field of `Diagnostics` |
| `Diagnostics.status` | field | kept | field of `Diagnostics` |
| `Interference` | ClassDef | kept | record; `volume_mm3`, `centroid` `null` in the JSON when refused (extended schema only), a latched `Refused` in Python |
| `INTERFERENCE_VOLUME_EPSILON_MM3` | constant-or-binding | compat stub | value kept; no longer the verdict (length tolerance, 3.3); reported as the legacy flag |
| `Interference.a` | field | kept | field of `Interference` |
| `Interference.b` | field | kept | field of `Interference` |
| `Interference.centroid` | field | kept | field of `Interference` |
| `Interference.volume_mm3` | field | kept | field of `Interference` |
| `PartDiagnostics` | ClassDef | kept | record; a refused fact is `null` in the JSON (extended schema) and a latched `Refused` in Python (5.5) |
| `PartDiagnostics.bbox` | field | kept | field of `PartDiagnostics` |
| `PartDiagnostics.center_of_mass_mm` | field | kept | field of `PartDiagnostics` |
| `PartDiagnostics.edge_count` | field | kept | field of `PartDiagnostics` |
| `PartDiagnostics.face_count` | field | kept | field of `PartDiagnostics` |
| `PartDiagnostics.is_valid` | field | kept | field of `PartDiagnostics` |
| `PartDiagnostics.surface_area_mm2` | field | kept | field of `PartDiagnostics` |
| `PartDiagnostics.vertex_count` | field | kept | field of `PartDiagnostics` |
| `PartDiagnostics.volume_mm3` | field | kept | field of `PartDiagnostics` |
| `SCHEMA_VERSION` | constant-or-binding | kept | "0.2"; files that are not representable in 0.2 carry `"0.2+wonky.1"` (7.2); `wonky.schema` carries wonky's version |

**`cad_khana.mechanism.hints`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `match_hint` | FunctionDef | replaced by the wonky hint catalog | keyed on capability and error codes; the function returns catalog hints for wonky error text (K13) |

**`cad_khana.mechanism.pick`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `describe_edge` | FunctionDef | replaced by `wonky pick` / viewer exact-measure | as above |
| `describe_face` | FunctionDef | replaced by `wonky pick` / viewer exact-measure | OCCT indices cannot be reproduced (kernel-gaps.md P12); the Python call raises a capability error naming `wonky pick` |
| `describe_vertex` | FunctionDef | replaced by `wonky pick` / viewer exact-measure | as above |
| `face_relations` | FunctionDef | replaced by `wonky pick` relation rows | parallel/coplanar with stated tolerances, coplanarity as maximum deviation over the face |

**`cad_khana.printability.holes`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `Bore` | ClassDef | kept | record of the C10 view; `at` on the bore axis |
| `bore_face_radius` | FunctionDef | replaced by `detect_bores` (C10) | concavity from `same_sense`; the call raises a capability error naming `detect_bores` |
| `Bore.at` | field | kept | field of `Bore` |
| `Bore.axis` | field | kept | field of `Bore` |
| `Bore.diameter_mm` | field | kept | field of `Bore` |
| `Bore.note` | field | kept | field of `Bore` |
| `BRIDGE_MAX_MM` | constant-or-binding | compat stub | value; starter default of the profile `bridge.max_span_mm` |
| `CEILING_DOT` | constant-or-binding | compat stub | value only; bridges come from exact region geometry |
| `detect_bores` | FunctionDef | kept | exact C10 inventory |
| `FaceTag` | ClassDef | dropped | per-triangle mesh tag; replaced by per-face findings with identities |
| `FaceTag.bbox_max` | field | dropped | field of `FaceTag` |
| `FaceTag.bbox_min` | field | dropped | field of `FaceTag` |
| `FaceTag.bore_diameter_mm` | field | dropped | field of `FaceTag` |
| `FaceTag.planar_normal` | field | dropped | field of `FaceTag` |
| `HORIZONTAL_DOT` | constant-or-binding | compat stub | value; used for the bore axis label |
| `PLATE_TOUCH_MM` | constant-or-binding | compat stub | value only; replaced by the first-layer band |
| `self_supporting` | FunctionDef | replaced by C6 region reasons (bed, bridge, cantilever) | call raises a capability error naming `detect_overhang` and the report |
| `SMALL_BORE_MM` | constant-or-binding | compat stub | value only; the exemption is replaced by the bridge rule (5.7) |
| `tessellate_tagged` | FunctionDef | dropped | no check reads triangles; certified print mesh with tags for display |
| `VERTICAL_DOT` | constant-or-binding | compat stub | value; used for the bore axis label |

**`cad_khana.printability.inspect`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `EPS` | constant-or-binding | compat stub | value kept; replaced by the stated decision tolerance (3.3) |
| `inspect` | FunctionDef | kept | C5 to C10, writes `<name>-printability.json` (7.2); legacy contract raises `SystemExit` on a failing record after writing, `--collect` never raises (6.2) |
| `PrintabilityDiagnostics` | ClassDef | kept | record with the 17 G2 fields plus `wonky` |
| `PrintabilityDiagnostics.assertions` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.bbox` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.bores` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.center_of_mass_mm` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.is_valid` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.kind` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.method` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.min_wall_at` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.min_wall_mm` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.name` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.overhang` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.pins` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.schema_version` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.status` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.surface_area_mm2` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.volume_mm3` | field | kept | field of `PrintabilityDiagnostics` |
| `PrintabilityDiagnostics.warnings` | field | kept | field of `PrintabilityDiagnostics` |

**`cad_khana.printability.methods`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `FDM` | ClassDef | kept | per-call overrides of the printer profile (5.6); fields up_axis, wall_min_mm, overhang_max_deg |
| `FDM.overhang_max_deg` | field | kept | field of `FDM` |
| `FDM.up_axis` | field | kept | field of `FDM` |
| `FDM.wall_min_mm` | field | kept | field of `FDM` |

**`cad_khana.printability.orientation`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `CANDIDATES` | constant-or-binding | kept | six axes; missing in the compat package today, added (K11) |
| `OrientationScore` | ClassDef | kept | record, 8 fields |
| `OrientationScore.contact_vs_footprint` | field | kept | field of `OrientationScore` |
| `OrientationScore.height_mm` | field | kept | field of `OrientationScore` |
| `OrientationScore.overhang_area_mm2` | field | kept | field of `OrientationScore` |
| `OrientationScore.plate_contact_mm2` | field | kept | field of `OrientationScore` |
| `OrientationScore.risky_bores` | field | kept | field of `OrientationScore` |
| `OrientationScore.self_bridging_mm2` | field | kept | field of `OrientationScore` |
| `OrientationScore.support_demand_mm3` | field | kept | field of `OrientationScore` |
| `OrientationScore.up_axis` | field | kept | field of `OrientationScore` |
| `PLATE_TOL_MM` | constant-or-binding | compat stub | value only; exact bed level |
| `score_orientation` | FunctionDef | kept | exact metrics (C11) |
| `suggest_orientation` | FunctionDef | kept | Pareto set, ties, lexicographic winner for compatibility (C11) |

**`cad_khana.printability.overhangs`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `BUILD_PLATE_EPSILON_MM` | constant-or-binding | compat stub | value only; replaced by the first-layer band |
| `detect_overhang` | FunctionDef | kept | exact per-face C6 |
| `Overhang` | ClassDef | kept | record: area and max angle of unwaived non-bridge regions |
| `Overhang.area_mm2` | field | kept | field of `Overhang` |
| `Overhang.max_angle_deg` | field | kept | field of `Overhang` |

**`cad_khana.printability.pins`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `detect_pins` | FunctionDef | compat stub | view over C7 thin-feature findings (K9b) |
| `FULL_SWEEP_RAD` | constant-or-binding | compat stub | value only; full sweep decided by exact winding |
| `MIN_PIN_DIA_MM` | constant-or-binding | compat stub | value; starter default of `walls.pin_min_diameter_mm` |
| `Pin` | ClassDef | compat stub | record type of the `pins[]` view |
| `Pin.at` | field | compat stub | field of `Pin` |
| `Pin.diameter_mm` | field | compat stub | field of `Pin` |
| `Pin.length_mm` | field | compat stub | field of `Pin` |
| `Pin.note` | field | compat stub | field of `Pin` |
| `SLENDER_RATIO` | constant-or-binding | compat stub | value; note only |

**`cad_khana.printability.structure`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `enclosed_voids` | FunctionDef | compat stub | returns 0 with the reason: a void cannot exist in a committed wonky body (5.10); real void findings come with K21 |
| `floating_solids` | FunctionDef | kept | C9 lumps (count, volume) |
| `HORIZONTAL_DOT` | constant-or-binding | compat stub | value |
| `MIN_EDGE_LEN_MM` | constant-or-binding | compat stub | value |
| `SHARP_INTERIOR_DEG` | constant-or-binding | compat stub | value; style thresholds come from the profile |
| `sharp_rim_edges` | FunctionDef | compat stub | view over C8 findings, now including circle rims |
| `sharp_vertical_edges` | FunctionDef | compat stub | view over C8 findings (count, length); C8 replaces the rule |
| `VERTICAL_DOT` | constant-or-binding | compat stub | value |

**`cad_khana.printability.wall`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `min_wall` | FunctionDef | kept | minimum over opposed sub-bands with a certified witness, or `unresolved` (C7) |
| `min_wall_mm` | FunctionDef | kept | thickness of `min_wall` |
| `RAY_OFFSET_MM` | constant-or-binding | compat stub | value; used only by the optional estimate channel |
| `SLIVER_HIT_DISTANCE_MM` | constant-or-binding | compat stub | value; no sliver floor in the certified wall |

**`cad_khana.viewer`**

| name | kind | disposition | wonky equivalent / note |
| --- | --- | --- | --- |
| `auto_enabled` | FunctionDef | compat stub | inert toggle |
| `push` | FunctionDef | compat stub | no-op recorded as a display request; the live server shows every build |
| `set_auto` | FunctionDef | compat stub | inert toggle |

Totals over the 246 declarations: kept 144, replaced 31, dropped 16, compat stub 55.

### A.2 Private names that matter

| module | names | disposition |
| --- | --- | --- |
| `mechanism.assembly` | methods `Assembly._swap_detail` (`U/mechanism/assembly.py:247`), `Assembly._all_part_names` (`:266`) | kept (provided today) |
| `draw` | module state `_auto_enabled`, `_auto_out`, `_auto_fmt`, `_auto_themeable`, `_auto_views`, `_auto_part` (`U/draw.py:13-18`) | compat stub (provided today, `python/cad_khana/draw.py:5-10`), read by nothing in wonky |
| `viewer` | module state `_auto_enabled` (`U/viewer.py:7`) | compat stub (provided today, `python/cad_khana/viewer.py:5`) |
| `draw` | type alias `_Primitive` (`U/draw.py:196`); fields of the private classes `_Polyline.samples` and `_EllipseArc.center`, `.rx`, `.ry`, `.rotation_rad`, `.start`, `.end`, `.mid`, `.quarter`, `.three_quarter`, `.closed`, `.samples` (`U/draw.py:176-193`) | dropped with their classes (public-named, but members of private classes) |
| private import aliases | `cli._draw` (= `cad_khana.draw`), `cli._pkg_version` and `environment._pkg_version` (= `importlib.metadata.version`), `cli._set_export_default` (= `mechanism.check._set_export_default`), `printability.holes._triangle`, `printability.wall._tessellate` (= `core.tessellation`), `printability.inspect._bbox` (= `mechanism.diagnostics._bbox`) | dropped; each target is disposed in its own module's row |
| `mechanism.check` | `_export_default`, `_set_export_default` | compat stub (inert; `wonky check` means export off) |
| `export` | `_gltf_transform_join` | compat stub: an inert name, so the monkeypatch in `cad-project-013/camera_mount_assembly.py:358-373` keeps working; the native writer never calls it |
| `export` | `_structural_groups`, `_gltf_transform`, `_gltf_transform_draco`, `_align_quaternion_hemispheres`, `_quat_mul`, `_quat_rotate`, `_relative_trajectory`, `_inject_animation_into_glb`, `_DEFAULT_LINEAR_TOLERANCE_MM`, `_DEFAULT_ANGULAR_TOLERANCE_RAD`, `_DEFAULT_DRACO_LEVEL`, `_EPS_POS_MM`, `_EPS_QUAT` | dropped (internals of the OCCT/gltf-transform pipeline) |
| `mechanism.assertions` | `_intersection_volume`, `_placed` | dropped |
| `mechanism.diagnostics` | `_placed`, `_bbox`, `_part_diagnostics`, `_interference` | dropped |
| `mechanism.hints` | `_PATTERNS` | dropped (hint catalog) |
| `mechanism.pick` | `_EPS_DOT`, `_EPS_MM`, `_vec`, `_face`, `_edge`, `_vertex` | dropped (tolerances stated in each pick row) |
| `core.tessellation` | `_triangle`, `_tessellate` | dropped |
| `printability.inspect` | `_wall_assertion`, `_overhang_assertion` | dropped |
| `printability.wall` | `_wall_thickness_at` | dropped (optional estimate channel uses `ray_hits`) |
| `printability.overhangs` | `_overhang_angle_deg`, `_build_plate_level`, `_on_build_plate` | dropped |
| `printability.holes` | `_horizontal_span_dir`, `_axis_label` | dropped |
| `printability.structure` | `_convex_sharp_line_edges` | dropped |
| `cli` | `_run_script`, `_write_error_diagnostics`, `_version_callback`, `_root` | dropped (`python/runner.py` and the host crash record) |
| `draw` | `_sample`, `_segments`, `_edge_key`, `_split_edges`, `_Polyline`, `_EllipseArc`, `_arc_primitive`, `_primitive`, `_primitives`, `_bounds`, `_transform`, `_to_px`, `_rasterize`, `_classify_arc`, `_arc_d`, `_polyline_points`, `_emit_svg_element`, `_to_svg`, `_scoped_compound`, `_bbox_extent`, `_camera_look_from`, `_resolve_views`, `_drawing`, `_draw_view`, `_draw_view_svg` | dropped |
| `diff` | `_pct`, `_delta`, `_kind`, `_status_section`, `_require_current_schema`, `_assertions_section`, `_PART_SCALAR_FIELDS`, `_mech_part_changes`, `_mech_parts_section`, `_pair_key`, `_interferences_section`, `_diff_mechanism`, `_scalar_line`, `_overhang_section`, `_bbox_section`, `_diff_printability` | dropped |
| `environment` | `_pkg`, `_is_listening`, `_probe_viewer`, `_VIEWER_DEFAULT_PORT`, `_VIEWER_PROBE_TIMEOUT_S` | dropped |

Private names come from the sibling inventories (inventory-mechanism.md §17,
inventory-printability.md §1, inventory-tooling.md §10).

### A.3 Command line

| cad_khana | disposition | wonky |
| --- | --- | --- |
| `khana build SCRIPT [--out]` | replaced | `wonky build <model>` |
| `khana check SCRIPT [--out]` | replaced | `wonky check <model>` |
| `khana view SCRIPT` | replaced | `wonky view <model>` |
| `khana draw SCRIPT [--views-dir --format --themeable --view --part]` | replaced | `wonky draw` (K19) |
| `khana pick SCRIPT --part [--faces --edges --vertices]` (uncommitted) | replaced | `wonky pick <model> --alias …` |
| `khana status` | replaced | `wonky status` |
| `khana diff BEFORE AFTER` | replaced | `wonky diff` |
| `khana --version` | replaced | `wonky --version` |
| `khana` console script | replaced | `wonky khana <cmd>` translation; PATH alias only after K20 (decision 14.8) |

### A.4 Imported module attributes (203)

Incidental names that a module exposes because it imports them (typing,
build123d, OCP, PIL, standard library, other cad_khana modules). None is a
cad_khana API; no customer file uses one (inventory-printability.md §1
"import-through" note). Disposition: **dropped**; access raises the compat
module's capability error, as today (`docs/python-khana.md:114-117`).
Exception: `mechanism.assembly` re-exports `Assertion`, `Clearance`,
`ExpectedInterference`, `NoInterference`, which wonky already provides
there (kept).

| module | count | names |
| --- | ---: | --- |
| `_paths` | 3 | `Path`, `annotations`, `sys` |
| `cli` | 11 | `Annotated`, `Diagnostics`, `Path`, `asdict`, `compute_diff`, `environment`, `json`, `runpy`, `traceback`, `typer`, `viewer` |
| `core.tessellation` | 4 | `Part`, `Vector`, `annotations`, `dataclass` |
| `diff` | 3 | `Any`, `SCHEMA_VERSION`, `annotations` |
| `draw` | 11 | `Assembly`, `Compound`, `Drawing`, `Edge`, `GeomType`, `Image`, `ImageDraw`, `Path`, `annotations`, `dataclass`, `math` |
| `environment` | 6 | `PackageNotFoundError`, `SCHEMA_VERSION`, `annotations`, `dataclass`, `platform`, `socket` |
| `export` | 25 | `Assembly`, `BRepMesh_IncrementalMesh`, `Callable`, `Message_ProgressRange`, `Path`, `Quantity_Color`, `Quantity_ColorRGBA`, `Quantity_TypeOfColor`, `RWGltf_CafWriter`, `Rot`, `Sequence`, `TColStd_IndexedDataMapOfStringString`, `TCollection_AsciiString`, `TCollection_ExtendedString`, `TDataStd_Name`, `TDocStd_Document`, `XCAFApp_Application`, `XCAFDoc_ColorType`, `XCAFDoc_DocumentTool`, `annotations`, `export_step`, `export_stl`, `shutil`, `struct`, `subprocess` |
| `mechanism.assembly` | 12 | `Assertion`, `Axis`, `Clearance`, `Color`, `Compound`, `ExpectedInterference`, `Location`, `NoInterference`, `Part`, `annotations`, `dataclass`, `replace` |
| `mechanism.assertions` | 8 | `AssertionResult`, `INTERFERENCE_VOLUME_EPSILON_MM3`, `Part`, `TYPE_CHECKING`, `annotations`, `dataclass`; under `if TYPE_CHECKING:` only (absent at run time, `U/mechanism/assertions.py:13-14`): `Assembly`, `PlacedPart` |
| `mechanism.check` | 14 | `Assembly`, `Diagnostics`, `Path`, `annotations`, `asdict`, `compute`, `dataclass`, `draw`, `evaluate_assertions`, `export_assembly`, `json`, `replace`, `resolve_out`, `viewer` |
| `mechanism.diagnostics` | 8 | `Part`, `TYPE_CHECKING`, `annotations`, `combinations`, `dataclass`, `field`; under `if TYPE_CHECKING:` only (`U/mechanism/diagnostics.py:9-10`): `Assembly`, `PlacedPart` |
| `mechanism.hints` | 3 | `Pattern`, `annotations`, `re` |
| `mechanism.pick` | 12 | `Edge`, `Face`, `Shape`, `Vector`, `Vertex`, `acos`, `annotations`, `combinations`, `degrees`, `get_edges`, `get_faces`, `get_vertices` |
| `printability.holes` | 9 | `BRepAdaptor_Surface`, `GeomType`, `Part`, `TESSELLATION_ANGULAR_TOLERANCE`, `TESSELLATION_TOLERANCE_MM`, `Triangle`, `Vector`, `annotations`, `dataclass` |
| `printability.inspect` | 23 | `AssertionResult`, `BBox`, `Bore`, `FDM`, `Overhang`, `Part`, `Path`, `Pin`, `SCHEMA_VERSION`, `annotations`, `asdict`, `dataclass`, `detect_bores`, `detect_overhang`, `detect_pins`, `enclosed_voids`, `field`, `floating_solids`, `json`, `min_wall`, `resolve_out`, `sharp_rim_edges`, `sharp_vertical_edges` |
| `printability.methods` | 2 | `annotations`, `dataclass` |
| `printability.orientation` | 13 | `Part`, `Path`, `Vector`, `annotations`, `asdict`, `asin`, `dataclass`, `degrees`, `detect_bores`, `json`, `resolve_out`, `self_supporting`, `tessellate_tagged` |
| `printability.overhangs` | 9 | `Part`, `Triangle`, `Vector`, `annotations`, `asin`, `dataclass`, `degrees`, `self_supporting`, `tessellate_tagged` |
| `printability.pins` | 7 | `BRepAdaptor_Surface`, `GeomType`, `Part`, `Vector`, `annotations`, `bore_face_radius`, `dataclass` |
| `printability.structure` | 13 | `Edge`, `Face`, `GeomType`, `Part`, `TopAbs_EDGE`, `TopAbs_FACE`, `TopExp`, `TopTools_IndexedDataMapOfShapeListOfShape`, `TopoDS`, `Vector`, `acos`, `annotations`, `degrees` |
| `printability.wall` | 4 | `Axis`, `Part`, `Triangle`, `annotations` |
| `viewer` | 3 | `Assembly`, `annotations`, `show` |

Total: 203 (199 run-time attributes plus 4 type-checking-only bindings).

## Appendix B. Evidence index

| evidence | path | kind |
| --- | --- | --- |
| product-owner directive | `local design note` | binding brief |
| mechanism inventory, OCCT probes | `docs/khana/inventory-mechanism.md`; `tmp/khana/oracle/{ok,fail,error,keyerror,check-mode,probe,pick}/` | [C], [M] |
| printability inventory, G0/G1/G2 oracle runs | `docs/khana/inventory-printability.md`; `tmp/khana/oracle/printability/` (`oracle-g2.done`, `out_g2/`, `out_g2_probes/`) | [C], [M] |
| tooling inventory, CLI and export probes | `docs/khana/inventory-tooling.md`; `tmp/khana/tooling/` | [C], [M] |
| kernel audit, distance and contact design | `docs/khana/kernel-gaps.md`; `tmp/khana/kernel-gaps/perf-probe.mjs` | [C], [M] |
| corpus usage | `tmp/khana/corpus-usage/findings.json`, `usage-addendum.json`, `call-ledger-validated.json`, `outputs.json` | [M] static census |
| public-name census | `tmp/khana/corpus-usage/public-api-enriched-declarations.json` | [M] |
| prior art | `tmp/khana/prior-art/literature-synthesis.json`, `findings.json` | sources with URLs |
| R20 check library (read only) | `~/Workspace/cad/cad-project-041/single-step-r20/checks/README.md:12-140`, `status.py:6-19`, `errors.py:1-35`, `rules.py:1-19`, `keepouts.py:1-16`, `clearance.py:1-26` | [C] read by the architect |
| design doctrine (read only) | `~/.claude/skills/cad-fdm-design/SKILL.md` and `references/*`; `~/.claude/skills/cad-khana/SKILL.md` | [C] |
| wonky code cited here | `src/python.mjs:86,858-880,928-959,1005`; `bin/wonky-python.mjs:17-20,50-51,73-78`; `src/viewer/live/build-worker.mjs:85-93`; `python/cad_khana/mechanism/assembly.py:237-247`; `python/cad_khana/_wonky.py:38-48,58,113-120,139-155`; `src/viewer/printability.mjs:1-33`; `src/exactness.mjs:1-60`; `docs/language.md:30-35,54,61`; `package.json:10-16` | [C] verified by the architect on 2026-09-24 |
| name mapping generator | `tmp/khana/architect/mapping.mjs` → `design-05.md`, `mapping.json` (246 mapped, 0 missing; stale after the revision) | [M] |
| architect worklog | local development evidence | checkpoint |
| reviews | `docs/khana/review-exactness.md`; workflow review probes `tmp/khana/review-workflow/{consumer-probe.json,source-contracts.json,consumer_probe.py,upstream_diff.py}` | [C], [M] |
| revision census | `tmp/khana/revise/census.py`, `census_check.py` → `census.json` (246 public declarations, 203 import bindings, 107 private names; all dispositioned) | [M] |
| wonky code verified in the revision | `HEAD:src/boolean.mjs:205`; `HEAD:src/analytic.mjs:280`; `HEAD:src/print-mesh.mjs:126-152`; `src/brep.mjs:180-196`; `kernel/face-bounds.bend:1-25`; `kernel/face-plane.bend:156-167`; `kernel/section.bend:192-203`; `HEAD:kernel/halfspace.bend:599,918`; `HEAD:kernel/boolean.bend:263`; `HEAD:kernel/ports/curved-metrics.bend:185`; `src/kernel.mjs:135-150,208-214` [U]; `src/analytic.mjs:138-168` [U]; `src/exactness.mjs:12-30`; `src/viewer/live/session.mjs:183-205`; `src/viewer/live/build-worker.mjs:85-112,335-346`; `python/build123d.py:110-152`; `python/cad_khana/_wonky.py:50-111`; `python/cad_khana/viewer.py:1-20`; `python/cad_khana/draw.py:5-16`; git tracking of `kernel/proto/recover/clear.bend` (tracked, deleted in the worktree), `kernel/hybrid/recover/clear.bend`, `kernel/volume.bend`, `src/volume.mjs` (untracked) | [C] verified on 2026-09-24 by the revision |
| customer sources verified in the revision (read only) | `cad-project-046/assembly.py:56-70,110-165`; `cad-project-033/assembly.py:20-110`, `case.py:170-180,240-268,420-450`; `cad-project-026/assembly.py:60-82`, `bar.py:270-285`; `cad-project-003/overnight-2026-09-05/manufacturing/coupons.py:125-175`; `cad-khana/src/cad_khana/diff.py:15-45,105-135`; `~/.claude/skills/cad-fdm-design/references/fit-and-snap-review.md:55-70`, `bambu-preparation.md:78-98` | [C] |
| revision worklog | local development evidence | checkpoint |
