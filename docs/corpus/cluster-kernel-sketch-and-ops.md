# Cluster analysis: sketch/profile validation and operation limits

Cluster `kernel-sketch-and-ops` of the [corpus run](run.md): 88 run units, 45
unique FS files, 10 families.

- **First pass:** 2026-09-23, 00:13 to 00:26 local.
- **Re-check:** 04:11 to 04:22 ([section 0](#0-re-check-0411-to-0422)).
  - It confirmed every result of the first pass.
  - It checked the fix design against the neighbouring cluster analyses that
    were written after the first pass.
  - It added the loft demand from outside this cluster.

All production code was left unchanged. Both passes used the default JS path,
the CLI's `strict` policy and at most 3 wonky processes. The machine was shared
with benchmark workflows:

- load averages of 15 to 85 during the first pass;
- 10 to 88 during the re-check.

`uptime` at every start and end is in `out/corpus/cluster-kernel-sketch-and-ops.jsonl`
and `out/corpus/cluster-kernel-sketch-and-ops.recheck.jsonl`.

Artifacts:

| Path | Content |
|---|---|
| `fixtures/corpus-repro/kernel-sketch-and-ops/` | 9 standalone repro files (14 cases) for the production CLI, with a [README](../../fixtures/corpus-repro/kernel-sketch-and-ops/README.md) listing observed output |
| `scripts/corpus/kernel-sketch-and-ops/` | `extract.mjs`, `harness.mjs`, `drive.mjs`, `report.mjs`, `cap-normal-error.mjs`, `recheck.mjs` |
| `out/corpus/cluster-kernel-sketch-and-ops.jsonl` | every harness run, with pass label and uptime |
| `out/corpus/cluster-kernel-sketch-and-ops.recheck.jsonl` | re-check: CLI repros, F32x2 simulation, bake-off route, OCCT |
| `out/corpus/cluster-kernel-sketch-and-ops.summary.json` | per-unit and per-file results, the cross-cluster table, and the loft demand outside the cluster (`outsideLofts`) |

## Answer in short

1. **The cluster has five separate root causes.** Each needs its own fix.

   | Cause | Units | Files | Families | Where | Fix | Effort |
   |---|---:|---:|---:|---|---|---|
   | opLoft admits only two coaxial circles | 49 | 27 | 3 | `src/library.mjs:235`, frustum only | phase 1: exact ruled loft with planar sides; phase 1b: lines plus concentric arcs (planes and cones); phase 2: ruled/B-spline surfaces | M / M / XL |
   | collinear consecutive profile edges | 15 | 15 | 3 | `src/brep.mjs:36` | merge collinear vertices in Bend, with provenance | S |
   | profile over 256 vertices | 12 | 12 | 2 | `src/brep.mjs:29` | raise the host limit | S |
   | cap normal of a far, tilted extrusion | 10 | 10 | 3 | `kernel/topology.bend:80-82` | caps take the sketch frame, best as part of the F32x2 polygon prism of cluster boolean-invalid-topology | 0 extra inside that fix, S alone |
   | line/arc sketch with inner circles | 2 | 2 | 2 | `src/library.mjs:177`, `:207` | line/arc region with holes in Bend | M–L |

2. **The cap-normal defect is worth fixing, but only once.**
   - `topology.extrude` computes the cap normal from an F32 area vector of
     absolute coordinates. About 560 mm from the origin, that normal is off by
     about 1e-5 rad. The JS validator correctly rejects the result, in 10
     units.
   - The same error makes the through-hole Boolean refuse holes that are
     exactly perpendicular. With a fix emulated, 12 through-hole units of
     cluster boolean-capability get 60 to 400 modeling calls further. All are
     in the hopper families, including the current `hopper_r19.fs` and
     `r21-hopper-current.fs`.
   - **New:** the fix that cluster boolean-invalid-topology proposes would
     build polygon prisms in F32x2, in the sketch frame. It uses the same seam
     (`topology.extrude`, native roadmap step 3). Simulated, it builds both
     far-foot repros. So the cap fix belongs inside that change. A separate F32
     cap-frame patch (S) only pays if the F32x2 prism slips by more than a few
     days, because it costs a second re-baseline of every pinned polygon value.
   - **New:** the bake-off route does not remove the need for this fix. It
     recovers the tilted-panel hole, but STEP export then refuses it: the F32
     caps lie about 5e-7 mm off the recovered rim.
3. **Lofts are wanted beyond this cluster, and more of them are exact than
   first counted.**
   - Inside the cluster, an exact planar-sided loft moves 11 of the 49 loft
     units past the loft stage. The other 38 need one of these:
     - twisted ruled sides (20 units);
     - square-to-circle transitions (14 units);
     - multi-section skins (4 units).
   - **New:** 34 more units hit `opLoft` right after the fixes of clusters
     boolean-capability and boolean-invalid-topology:
     - phase 1 takes 14 of them past every loft;
     - a tapered line/arc slot (phase 1b: planes and cones, surfaces the
       kernel already has) takes 10 fs398 channel-base units past;
     - 8 `motorBracket` units need a twisted loft;
     - 2 units need multi-section lofts.
   - The loft is the next blocker of the channel bases, but not in `roundBody`
     (that loft of two coaxial circles is admitted). The failing lofts are a
     planar hexagon prismatoid and the tapered slot.
4. **This cluster is on the r10b path.** `fixtures/r10b/r10b.fs#r10bSideDrive`
   is part of `singleStepR10b` (line 1411). Three of its first five blockers
   belong to this cluster, in this order:
   1. collinear vertex (this cluster);
   2. cap normal (this cluster);
   3. a JS `RangeError` in the Boolean glue (not this cluster);
   4. the 256-vertex limit (this cluster);
   5. the general Boolean (not this cluster).

   The re-check reproduced the chain exactly.
5. **First blocker.** This part is unchanged; the re-check reproduced all 88
   units.
   - In 17 of the 45 files, this cluster holds every failing unit.
   - The other 28 files are multi-feature files whose remaining units fail on
     imports, Booleans or missing builtins.
   - With the exact fixes emulated, one file builds completely: the archived
     `archive-strip-only.fs`.
   - For the other 86 units, the next blocker is one of these:
     - a loft this cluster cannot build yet (38 units);
     - the planar-arrangement Boolean (18 `InvalidTopology`, 1
       `UnsupportedArrangement`);
     - `qClosestTo` (12 units);
     - the pierce-after-copy crash (7 units);
     - the through-hole admission (6 units);
     - the Boolean arity limit (3 units);
     - the general Boolean (1 unit).
6. **Overlap with work in flight.**
   - None of the five causes is a Boolean.
   - Both Boolean follow-ons of this cluster were run on the bake-off route:
     - the tilted pocket (9 units' next blocker) is recovered, OCCT-valid;
     - the tilted-panel hole is recovered, but its STEP export is refused.
   - The native binding runs the same Bend `extrude` bit for bit, so it fails
     in the same places.
   - The language work duplicates the opLoft admission in
     `src/lang/wk/record-fs.mjs:164`. Any loft fix has to be mirrored there.
   - Side finding: the print mesh refuses every body with a trimmed arc, even
     a plain line/arc extrusion. Details are in [section 2.2](#22-oploft-admits-only-two-coaxial-circles-49-units).

## 0. Re-check (04:11 to 04:22)

The first pass ended at 00:26. Several neighbouring cluster reports were last
saved after it: fs-missing-builtin (00:33), boolean-invalid-topology (00:53)
and boolean-capability (00:58). The native, viewer and language files also
changed after it. The re-check asked two questions:

- Does every result still hold?
- Do the new reports change the fix design?

| check | result |
|---|---|
| production code | Unchanged since the first pass. `src/library.mjs`, `brep.mjs`, `boolean.mjs`, `analytic.mjs`, `kernel.mjs`, `kernel/topology.bend`, `geometry.bend`, `pierce.bend` and `sketch-lines.bend` were last modified on 2026-09-21/22. Only native, viewer and language files changed. |
| the 12 repro cases of the first pass, plus the 2 new ones, through the CLI (`recheck.mjs`) | the 12 with identical output; 0.9 to 1.4 s each |
| all 88 units, `diag` pass (`diag-recheck`) | 88 of 88 with the same message and line, no timeout |
| r10b SideDrive chain | identical: 1, 11, 18, 20 and 31 calls with the same blockers; fixture SHA-256 `219ee963…` matches `provenance.json` |
| F32x2 polygon prism (`--simulate linearc`, the boolean-invalid-topology fix) | both far cap-normal features build (7677.8832 mm³); the tilted pocket moves from `InvalidTopology (stage 1)` to `UnsupportedArrangement (stage 6)` |
| bake-off route (`WONKY_CORPUS_STUB=hybrid-all`) | tilted pocket recovered from F32 operands, OCCT-valid, 11 faces, 7316.39927 mm³ against a closed-form 7316.4 (relative error 1.0e-7); tilted-panel hole recovered, but STEP export refuses it with `cylindrical parameter curves unresolved: InvalidSource` |
| loft demand outside the cluster (`xloft-rerun`, `xloft-motor`) | 34 units, [section 2.2](#22-oploft-admits-only-two-coaxial-circles-49-units) |
| new repro | `loft-tapered-slot.fs` |
| side finding | `--format print` refuses a plain line/arc extrusion |

## 1. Method

- **Selection.** `extract.mjs` applies the normalization and cluster rules of
  `scripts/corpus/summarize.mjs` to `out/corpus/runs.jsonl`. It selects the 88
  units, all 45 files with every one of their units, and 78 cross-cluster units.
  The cross-cluster units are:
  - the through-hole refusals;
  - the planar-arrangement failures.
- **Harness.** `harness.mjs` calls the production `build()` from
  `src/index.mjs`, with the options the CLI uses. It adds in-process hooks
  around `ModelingContext` builtins and the loaded kernel object, and changes
  no file under `src/`, `kernel/` or `bin/`.
  - It records every opLoft call: profile kinds, vertex counts, plane relation,
    and the worst side-quad non-planarity under index correspondence.
  - It records every refused profile: collinear corners, deviation in mm,
    backtracking, and edge lengths.
  - Optional stubs let a unit continue past a blocker.
- **Stubs.** "Exact" stubs model a proposed fix. "Proxy" stubs change the
  geometry and only serve to reach later calls.

  | stub | kind | models |
  |---|---|---|
  | `frame` | exact | cap faces take the sketch frame (fix 2.1, variant B) |
  | `area` | exact | cap normal from the area vector about the first point (variant A) |
  | `collinear` | exact when the deviation is 0 | collinear vertices dropped |
  | `loftplanar` | exact | two equal-count polygons with planar side quads: planar ruled solid (fix 2.2, phase 1) |
  | `loft` | proxy | any other loft: extrusion of the first profile |
  | `maxverts` | proxy | profiles over 256 vertices decimated |
  | `mixed` | proxy | circles in a line/arc sketch dropped |
  | `pvol` | exact | rigid copies keep the volume of a pierced source (not this cluster) |
  | `boolean` | proxy | a refused opBoolean is skipped, with production-like lineage |

- **Passes** (`drive.mjs`, 3 processes, per-unit timeout of the corpus run,
  180 s or 480 s):

  | pass | stubs | units | question |
  |---|---|---:|---|
  | `diag` (re-run as `diag-recheck`) | none | 88 | classify the failures (loft shapes, deviations) |
  | `next` | frame, collinear, loftplanar, maxverts, mixed | 88 | first blocker after this cluster's fixes |
  | `deep` | all | 88 | how far these files could get |
  | `xframe`, `xarea` | frame / area | 78 | effect of the cap-normal fix outside this cluster |
  | `r10b-sidedrive-chain` | cumulative | 5 | blocker chain of the frozen anchor feature |
  | `xloft-rerun` | frame, collinear, loftplanar, maxverts, mixed, pvol, boolean | 26 | boolean-capability units whose next blocker is `opLoft` (from its `probe-pass-all.jsonl`) |
  | `xloft-motor` | as `xloft-rerun` | 8 | boolean-invalid-topology `motorBracket` units whose next blocker is `opLoft` |

  Harness wall time per unit was 1 to 4.7 s. No run timed out.
- **Re-check** (`recheck.mjs`, 3 processes, 180 s per job) covers three job
  kinds:
  - the CLI repros;
  - the F32x2 simulation of the neighbouring cluster
    (`scripts/corpus/diagnose-planar-admission.mjs --simulate linearc`);
  - the bake-off hybrid (`scripts/corpus/boolean-probe.mjs` with
    `WONKY_CORPUS_STUB=hybrid-all`), then `uv run scripts/validate-step.py`.

  All of these tools are in-memory diagnosis scripts of other corpus analyses.
  They were run, not edited.

## 2. Root causes

### 2.1 Cap normal of a far, tilted extrusion (10 units)

The messages:

- `Face vertices do not lie on the analytic plane` (7 units);
- `Plane frame is not orthonormal` (3 units).

All 10 units are the 2020-rail foot of `feederMounts` in `cad-project-039`
integration r7 to r14 and `r22-current-guides.fs`, plus
`hopper-corner-inserts-r2/.../archive-strip-only.fs`. Repro:
`cap-normal-far-from-origin.fs`.

**Root cause.** `kernel/topology.bend:76` `extrude` builds its two cap faces
from the lifted F32 points:

- the normal is `normalize(area_vector(points, first))` (line 80);
- the x axis is the direction of the first edge (line 82).

`geometry.bend:73` `area_vector` sums `cross(p_i, p_i+1)` over absolute
coordinates. `first` only closes the ring. About 560 mm from the origin, each
term is about 3e5 mm², while the foot's area is 1.3e3 mm². F32 cancellation
then tilts the normal. The validator (`src/brep.mjs:105-107`, double)
requires:

- `|n·x| ≤ 1e-5`;
- every vertex within `eps = max(1e-5, |x|·2^-20)` of the cap plane
  (4.6e-4 mm here).

The foot misses the second condition by about 45 %.

| cap normal for the foot prism (`cap-normal-error.mjs`) | angle to the sketch normal | max vertex distance from the cap plane |
|---|---:|---:|
| production (absolute F32 area vector) | 1.0e-5 rad | 6.7e-4 mm (> eps) |
| variant A: area vector about the first point | 0.9–1.3e-7 rad | 1.1e-5 mm |
| variant B: the sketch frame's normal | F32 rounding of the frame | 1.2–1.4e-5 mm |
| F32x2 prism in the sketch frame (`--simulate linearc`) | F32x2 rotation of +z | builds; the validator accepts it |

The validator is right. The kernel builds a cap plane that is not the sketch
plane. Whether a unit fails depends on F32 rounding luck:

- the rectangular foot builds but the chamfered octagon does not;
- a hand-rounded copy of the plane origin can build.

**Cross-cluster effect.** The through-hole Boolean admits a hole only when the
tool axis is parallel to two face normals within `1e-7` (`src/boolean.mjs:116`,
`kernel/pierce.bend:109`). The tool axis is the same sketch normal, but the cap
normal is 1e-5 rad off, so the admission fails with
`opBoolean through holes need a tool axis perpendicular to exactly two faces of
the target`. Repro: `through-hole-tilted-panel.fs`, a 280 × 70 mm panel about
500 mm from the origin with an M3 hole. It builds with the `frame` stub.

The boolean-capability report finds the same defect in the hopper plates. There
the error is smaller, 1e-7 to 5.4e-7 rad, but it still exceeds the 1e-7 gate.

Of the 78 cross-cluster units, the fix moves 12, all of them through-hole units
of cluster 2. The 55 planar-arrangement failures do not change.

| unit (cad-project-039) | family | calls before | variant A | variant B |
|---|---|---:|---:|---:|
| `archive-r7/hopper.fs` | fs269 | 10 | 127 | 406 |
| `archive-r8/hopper.fs` | fs269 | 10 | 53 | 375 |
| `hopper_r19.fs`, `r21-hopper-current.fs` | fs421 | 53 | 53 | 191 |
| `archive-r16`, `archive-r17`, `archive-r10/hopper.fs` | fs421 | 53 | 53–189 | 189 |
| `archive-r11`, `hopper-r12`, `archive-r13`, `archive-r14` | fs421 | 127 | 189 | 189 |
| `archive-before-open-hopper/hopper.fs` | fs244 | 41 | 41 | 177 |

Variant A helps 8 units and variant B helps 12. Variant B also gets further,
because the cap normal and the tool axis then come from the same F32 words.
The other 11 through-hole units do not change and are genuine cluster-2
limits.

**Fix.** The cap must carry the sketch frame's normal and x axis instead of
values derived from F32 absolute coordinates. There are two ways to deliver
that.

- **Recommended: inside the F32x2 polygon prism** (cluster
  boolean-invalid-topology, [its section 4](cluster-boolean-invalid-topology.md#4-fix-design),
  M, about 3 days).
  - That fix builds each polygon prism in its sketch frame, where the caps are
    exactly ±z. It then maps the prism to world with one F32x2 rigid
    transform.
  - The cap normal becomes the F32x2 image of +z, which is the frame's
    normal. Simulated with the existing F32x2 line extruder, both far-foot
    features build.
  - This cluster adds three requirements to that fix:
    - keep the caps on the frame's normal and x axis, not on a recomputed
      area vector;
    - keep the bodies polyhedral, so that the through-hole arm still admits
      them (the simulation's curve ranges switch that arm off);
    - add `cap-normal-far-from-origin.fs` and `through-hole-tilted-panel.fs`
      to that fix's acceptance set.
  - Marginal effort for this cluster: none beyond those tests.
- **Fallback: variant B in F32 (S)**, only if the F32x2 prism is more than a
  few days away.
  - `extrude` receives the sketch frame (or its normal and x axis).
  - The top cap uses `±frame.normal`, oriented along the sweep. The bottom cap
    uses the opposite normal.
  - Both caps use `x = frame.x`. Side faces stay as they are.
  - `src/kernel.mjs:57-60` already builds that frame and only has to pass it
    on. The polygon orientation check stays in the host (`signedArea`).

**Risk.**

- Either way, every extrusion's cap frame changes in the last bits, so pinned
  snapshots must be re-baselined after `npm test`: identity, acceptance and
  native-bridge bit equality.
- Doing variant B first and the F32x2 prism later means re-baselining twice.
- `topology.bend:extrude` is one of the 19 native entries
  (`docs/native-bridge.md`, section 11). A changed signature needs the slice's
  entry list regenerated, so coordinate with the native binding. Its roadmap
  step 3 (`extrudePolygon`/`transform` "mit Carriern") is the same seam.

**The bake-off does not make the fix unnecessary.** On the hybrid route
(corefine, then recover), the tilted-panel hole is recovered and the kernel
validator accepts the body. STEP export then refuses it with
`STEP cylindrical parameter curves unresolved: InvalidSource`: recover places
the rim circle on the F64 axis, 5e-7 mm off the F32 cap. The
boolean-capability report shows the same for its `obliqueHole`. With caps on
the frame normal, the fast exact pierce arm admits the hole instead
(`frame` stub), and recover is not needed.

**Next.**

- 9 units: the key-pocket cut refuses with `Native planar arrangement
  subtraction unresolved: InvalidTopology`. Repro:
  `next-tilted-pocket-subtraction.fs`. It fails at the origin too, so it
  belongs to cluster `boolean-invalid-topology`.
  - With F32x2 prisms (simulated), it moves to `UnsupportedArrangement
    (stage 6)`, the face-ownership refusal that the invalid-topology report
    assigns to the bake-off.
  - On the hybrid route it is recovered from today's F32 operands: OCCT-valid,
    11 faces, 7316.39927 mm³ against a closed-form 7316.4 mm³. The relative
    error of 1.0e-7 comes from the F32 input.
- `archive-strip-only.fs` builds: 58 calls, 2 bodies.

### 2.2 opLoft admits only two coaxial circles (49 units)

**Where.** `src/library.mjs:235-244`. The gate refuses any loft without exactly
two profiles, or with a profile that is not a circle. The only constructor is
`circularFrustumInBend`, which also demands coaxial circles. The corpus lofts
polygons.

| first failing loft (`diag`) | units | examples |
|---|---:|---|
| two polygons, planar side quads | 17 | corner-post column (same shape, a prism), `fixedCableClamp`, `switchBracket` dovetails (`twoProfileLoft`) |
| two polygons, twisted side quads | 14 | `upperPost`: neck octagon to chamfered square, sides 3.0 mm out of plane |
| polygon to circle | 14 | `upperRotor` throat: square to circle |
| 5 to 13 sections | 4 | `feederOfframp`: line/arc or polygon skin |

Repros: `loft-two-polygons.fs` (`prismatoid`, `twistedOctagon`,
`squareToCircle`) and `loft-tapered-slot.fs`.

After an exact planar-sided loft (`loftplanar`), 11 units get past the loft
stage:

- `fixedCableClamp` ×6 and `switchBracket` ×2 then hit `InvalidTopology` on
  subtraction (cluster 10);
- `Corner_Post_R3/R4/R6` then hit the opBoolean arity limit (three bodies in
  one `unite`, cluster 2).

38 stay blocked:

- 20 by twisted pairs, such as the corner-post shoulder from `hollowNeck` to an
  octagon (2.6 mm) and `upperPost`;
- 14 by polygon to circle;
- 4 by multi-section lofts.

The Onshape exports of the same family agree with this split. In
`machine-interface-r6/STEP/`:

- `cableClamp_R6.step` has no B-spline face;
- the other parts carry 42 to 334 `B_SPLINE_SURFACE_WITH_KNOTS` each, from
  lofts and engraved text.

**Loft demand outside this cluster** (re-check). The neighbouring analyses
report 34 more units whose next blocker is `opLoft` once their Booleans are
fixed. The harness ran them with the Boolean proxy and recorded every loft
they reach (`summary.json`, `outsideLofts`).

| units (source cluster) | lofts reached | with an exact planar loft | then |
|---|---|---|---|
| 4 `switchBracket`, 2 `bottomSpoke` (fs95), 1 `fixedCollar` (fs88) (boolean-capability) | polygon pairs, all side quads planar | past all lofts | `opTransform` 5, `skText` 2 |
| 2 channel bases fs386 (`channel-bases-r2.fs`, `native-all-r2.fs`) (boolean-capability) | 25 coaxial-circle lofts (admitted), 6 hexagon prismatoids | past all lofts | reach the end (with the Boolean proxy) |
| 5 channel bases (4 fs550, fs398 `variant-v2-wedge`) (boolean-capability) | coaxial circles, 3 hexagon prismatoids | past all lofts | `Prototype limit: 128 bodies per feature` (`src/library.mjs:71`) |
| 10 channel bases fs398 (`c-channel-bases-arcs-r6/*`, `c-channel-bases-clean-r5/*`) (boolean-capability) | coaxial circles, 3 hexagon prismatoids, then loft `n141`: a stadium of lines and arcs, R13 to R10 | blocked at `n141` | tapered slot, phase 1b |
| 8 `motorBracket` (fs95) (boolean-invalid-topology) | 2 planar quad lofts, then a pentagon pair twisted by 1.29 mm | blocked | twisted loft, phase 2 |
| hopper fs244, `archive-r11/integration.fs#feederOfframp` (boolean-capability) | 3 and 5 polygon sections | blocked | multi-section, phase 2 |

- The hexagon prismatoid (`n111`/`n117`/`n45`) has corresponding edges that are
  parallel. Its side quads are planar to 4e-13 mm.
- The boolean-capability report says the channel bases stop at `opLoft` "in
  `roundBody` (two equal circles)". The harness shows otherwise: the
  `roundBody` lofts are admitted (25 to 51 per file). The failing lofts are
  the prismatoid and the tapered slot.
- The 128-body limit is a host resource limit. The proxy deletes consumed
  bodies as production does, so it is probably real. It cannot be confirmed
  until the Booleans are.

Combined demand: 83 loft units. Phase 1 takes 25 of them past their lofts,
phase 1b another 10. 48 need phase 2: 28 twisted, 14 polygon to circle and
6 multi-section.

**Fix, phase 1 (M): exact ruled loft between two polygons.**

- **Bend constructor.** Add `ruled(bottom, top)` with the extrusion layout:
  2n vertices, 3n edges, n+2 faces. Each side face frame comes from its quad.
  The cap frames come from the two sketch frames, as in 2.1. Build it on the
  F32x2 path of 2.1, not in F32.
- **Bend admission.** Admit only when:
  - the vertex counts are equal and the orientation is the same;
  - every side quad is planar within the kernel tolerance;
  - on parallel planes, corresponding edges are parallel. This pins the
    vertex correspondence up to symmetry;
  - the solid passes the existing validation.

  Everything else raises an explicit capability error that names the reason:
  "twisted by 3.0 mm", "polygon to circle", "N sections".
- **Host.** Add a branch in `opLoft`, and mirror it in
  `src/lang/wk/record-fs.mjs:164`.

The harness prototype reproduces the exact prismatoid volume: 3626.6667 mm³
for the repro.

**Fix, phase 1b (M): lines and concentric arcs on parallel planes.** This is
the channel bases' `n141`, a tapered slot.

- **Admission:**
  - same entity sequence in both profiles;
  - corresponding lines parallel, so their side quads are planar;
  - corresponding arcs coaxial: centres on one line along the plane normal,
    same angular span;
  - radii may differ.
- **Exact result.** The sides are planes, and cone patches with half-angle
  `atan((r0 − r1)/h)`. Equal radii give cylinders.
- **Construction.** Generalize the line/arc extruder in
  `kernel/sketch-arcs.bend` (`local_solid`, `side_surface_curve`), which
  already builds plane and cylinder sides in the sketch frame in F32x2. Cones
  are already accepted by `validateAnalytic`, STEP (`CONICAL_SURFACE`) and the
  print-mesh orientation.
- **Repro.** `loft-tapered-slot.fs`, with closed-form volume
  4140 + 798π = 6646.990938 mm³. Its control, the R13 slot extruded, builds.
- **Next.** The channel base unites the slot with cylinders (`n142`). That is
  a general Boolean on cone patches, which the bake-off `recover` route
  covers.

**Side finding: print output of line/arc bodies.** `src/print-mesh.mjs:130`
refuses every face bounded by a trimmed arc. The control feature
`loft-tapered-slot.fs#slotExtrudeControl` is a plain line/arc extrusion of a
slot:

- `--format step` writes it;
- `--format print` answers `no .stl written: Print mesh needs full circles;
  face 3 is bounded by a trimmed arc`.

Every slot or rounded outline made of lines and arcs therefore reaches STEP
but not a print mesh. That matters for FDM adoption: it is the likely
after-next blocker of phase 1b and of 2.5. It is not documented as a print
limitation yet.

**Phase 2 (XL): general ruled and skinned lofts.** These need:

- bilinear and B-spline surfaces in `analytic.bend`;
- tessellation, STEP export and validation;
- Boolean support for these surfaces.

Neither the planar arrangement nor the bake-off `recover` route has that
support. `recover` covers planes, cylinders, cones, spheres and tori
([proto-recover.md](../proto-recover.md)). Every loft in this cluster is
followed by a `unite` or `cut`, so phase 2 without general Booleans would
unblock nothing. Defer it.

**Risks.**

- Onshape chooses its own vertex matching for lofts. Before any agreement is
  claimed, compare against `cableClamp_R6.step`.
- A later loft in the same feature can still be twisted. The corner-post ribs
  are out of plane by 0.35 mm. `motorBracket` passes two planar lofts and then
  meets one twisted by 1.29 mm.

**Deep.** With proxies for every loft and Boolean, 44 of the 88 units stop at
`opTransform` and 17 at `skText` (cluster 7).

### 2.3 Collinear consecutive profile edges (15 units)

**Where.** `src/brep.mjs:36`, in `validatePolygon`:

- `addProfile` calls it for `skPolyline` and `skRectangle`
  (`src/library.mjs:67`);
- `validateSolid` calls it again for every face loop.

The Bend line-sketch assembler has the same rule (`CollinearCorner`,
`kernel/sketch-lines.bend:350`). Repro: `collinear-polyline-vertex.fs`.

| units | source | deviation of the middle vertex |
|---:|---|---|
| 8 | r10b SideDrive rack `g0`: 147 or 168 vertices, straight back edge | 0 mm (exactly collinear) |
| 6 | `bottomSpoke` (distributor interface r11/r12) | 1.8e-9 mm (collinear up to arithmetic) |
| 1 | `archive-r15/hopper.fs`: generated arc polygon with 0.008 mm segments | 1.3e-4 to 2.9e-4 mm, below eps |

None of these corners backtracks. Onshape extrudes all of them.

**Fix (S).**

- Merge collinear, non-backtracking vertices before extrusion. Do it in Bend:
  a ring simplification that returns the kept indices, so provenance can name
  the merged sketch vertices.
- At a deviation of 0 or up to 1e-9 mm, the merge is exact. That covers 14 of
  the 15 units.
- A near-collinear merge changes the geometry, although by less than the
  kernel's own F32 resolution. It must either be recorded with its deviation
  as a stated-tolerance regularization, or stay refused under `strict`. That
  follows the `curvedContacts` policy pattern.
- The line-segment sketch path should get the same rule. So should the future
  F32x2 polygon prism: it will run through the same profile check. This fix
  does not depend on carrier precision and can land first.

Keeping the vertex and allowing straight angles in face loops is riskier. It
touches `validateSolid` and the planar arrangement, which would then see
coplanar adjacent faces.

**Next.**

- `r10bSideDrive` ×7 needs the 2.1 fix first. Then it hits a JS `RangeError`
  on the second pierce (see [section 3](#3-the-r10b-anchor-r10bsidedrive)).
- `bottomSpoke` ×6: a genuine through-hole refusal (cluster 2).
- `R10b_Print_Package`: `UnsupportedArrangement` on a union.
- `hopper.fs` r15: `InvalidTopology`.

### 2.4 Profile over 256 vertices (12 units)

**Where.** `src/brep.mjs:29`. This is a host resource limit, documented in
`README.md:266`, and it is checked again for every face loop.

- `topology.extrude` itself has no limit.
- Both F32x2 sketch paths do: `sketch-lines.bend:487` and
  `sketch-arcs.bend:452`.
- The planar arrangement admits at most 256 vertices, 512 edges and 256 faces
  per input (`docs/planar-boolean.md:36`).

Repro: `profile-over-256-vertices.fs`.

All 12 units extrude the same 470-vertex ribbon-cable loop:
`ribbonReference` ×11 and `cableReferenceR4` ×1. The features name it a
"kinematic reference", not a printed part. The r10b SideDrive pinion (384
vertices) is the fourth blocker of `r10bSideDrive`.

**Fix (S).**

- Raise the limit, for example to 4096.
- Keep the O(n²) self-intersection test, or replace it with a sweep.
- Tests.

Booleans on such prisms still exceed the planar-arrangement limits and refuse
explicitly.

On the F32x2 path, measure before raising the limit. The boolean-invalid-topology
report measured a 192-point band through the line/arc extruder at 29 s instead
of 1.1 s, both under load. At 470 vertices that O(n²) admission would take
minutes on the JS target.

**Value is low.**

- All 12 units then stop at the missing `qClosestTo` (cluster 7).
- The bodies are reference geometry.
- For r10b, the next blocker after the limit is a general plane/cylinder union.

### 2.5 Line/arc sketch with inner circles (2 units, one design)

**Where.**

- `src/library.mjs:177` refuses `skCircle` in a sketch that already has line
  or arc entities (the checks at `:64` and `:166` are the same rule);
- `skSolve` admits exactly one closed profile (`:207`).

The unit is `hopper-rear-wall-r29.fs` and its fsocct twin `rear_wall.fs`: an
18-edge line/arc outline plus four M3.4 holes, extruded as a region with holes.
Repro: `line-arc-sketch-with-holes.fs`.

The workaround does not help. With the holes turned into separate cylinder cuts
(`tmp/corpus/kso/variants/`), the result is `general trimmed-face booleans are
not implemented`. A line/arc extrusion has arc edges with curve ranges, and
the through-hole path refuses those (`pierceable` in `src/boolean.mjs`).

**Fix (M–L), either of:**

- a line/arc region with inner circle loops in Bend (`sketch-arcs.bend`
  assembly plus containment checks), extruded to caps with inner loops and
  cylindrical walls, which the B-rep already has for pierced plates;
- pierce admission for targets with arc edges, which needs arc/circle
  clearance on the pierced faces. This is pierce v2 in the boolean-capability
  report.

**Next.**

- With the holes dropped (a proxy), the rear wall builds. The twin then hits a
  general Boolean.
- For a printed part, the wall would then stop at the print mesh's
  trimmed-arc refusal ([section 2.2](#22-oploft-admits-only-two-coaxial-circles-49-units)).

## 3. The r10b anchor: r10bSideDrive

Frozen fixture, unchanged: `fixtures/r10b/r10b.fs#r10bSideDrive`, SHA-256
`219ee963…`, which matches `provenance.json`. The acceptance feature
`singleStepR10b` calls `buildSideDrive` after the upper core, lower core and
carriage. The acceptance run stops earlier, at UpperCore g10, so this chain
matters once that is solved. The re-check reproduced the chain exactly.

| stubs (cumulative) | calls | blocker | cluster |
|---|---:|---|---|
| none | 1 | `g0` rack prism: collinear edges | this (2.3) |
| collinear | 11 | `g2` cut: through hole not perpendicular | this (2.1, cap normal) |
| + frame | 18 | `g4` cut: `RangeError` in `real()` | glue bug, see below |
| + pvol | 20 | `g5` pinion prism: 384 vertices | this (2.4) |
| + maxverts (proxy) | 31 | `g7` join: general trimmed-face Boolean | cluster 2 |

**The `g4` crash** (repro: `next-pierce-after-copy.fs`).

- r10b's `cut()` clones its target with `opPattern` before every Boolean.
- `transformAnalytic` (`src/analytic.mjs:139`) keeps `validation.volumeMm3`
  only for a list of construction methods. That list does not include
  `native Bend through-hole pierce`, so the copy's volume is `null`.
- The second pierce serializes `real(null)` (`src/boolean.mjs:126`). That
  throws a JS `RangeError` without a source location, where the result should
  be exact or an explicit capability error follows.

The fix is S:

- add the pierce method to the rigid-transform list;
- guard `volumeMm3` in the pierce path.

This is not this cluster, but it is the next blocker for 7 corpus units and
the frozen anchor.

## 4. Files and first blockers

"Sole" means that every failing unit of the file is in this cluster. The next
column lists the distinct next blockers after the exact fixes (`next` pass).
The re-check reproduced the first blocker of all 88 units.

| file | family | units in cluster / all | other clusters in the file | causes | next |
|---|---|---:|---|---|---|
| `cad-project-039/belt-fixed-r29/wall-r29/archive-before-part26-clearance/hopper-rear-wall-r29.fs` | fs289 | 1/1 | sole | inner loops | builds only without holes (proxy) |
| `cad-project-043/fsocct/cases/workspace/rear_wall.fs` | fs558 | 1/1 | sole | inner loops | general Boolean |
| `cad-project-039/archive-r10/integration.fs` | fs397 | 2/2 | sole | loft, cap normal | multi-section loft; InvalidTopology |
| `cad-project-039/archive-before-open-hopper/integration.fs` | fs397 | 2/2 | sole | loft, cap normal | multi-section loft; InvalidTopology |
| `cad-project-039/archive-r7/integration.fs` | fs397 | 2/2 | sole | loft, cap normal | multi-section loft; InvalidTopology |
| `cad-project-039/archive-r8/integration.fs` | fs397 | 2/2 | sole | loft, cap normal | multi-section loft; InvalidTopology |
| `cad-project-014/frame-joints-r13/reference/post-current.fs` | fs126 | 1/1 | sole | loft | twisted loft |
| `cad-project-014/deliverables/project-component-af20769e_R3/source/Corner_Post_R3.fs` | fs126 | 1/1 | sole | loft | Boolean arity |
| `…/project-component-af20769e_R4/source/Corner_Post_R4.fs` | fs126 | 1/1 | sole | loft | Boolean arity |
| `…/project-component-af20769e_R6/source/Corner_Post_R6.fs` | fs126 | 1/1 | sole | loft | Boolean arity |
| `…/project-component-af20769e_R7/source/Modular_Corner_Post_R7.fs` | fs126 | 1/1 | sole | loft | twisted loft |
| `…/project-component-af20769e_R8/source/Corner_Post_R8.fs` | fs126 | 1/1 | sole | loft | twisted loft |
| `cad-project-014/post-r9/corner-post-r9.fs` | fs126 | 1/1 | sole | loft | twisted loft |
| `cad-project-014/post-r10/corner-post-r10.fs` | fs126 | 1/1 | sole | loft | twisted loft |
| `cad-project-014/post-r10/archive-curved-trial/corner-post-r10.fs` | fs126 | 1/1 | sole | loft | twisted loft |
| `cad-project-039/hopper-corner-inserts-r2/archive/rejected-strips/archive-strip-only.fs` | fs552 | 1/1 | sole | cap normal | **builds** |
| `cad-project-039/archive-r15/hopper.fs` | fs421 | 1/1 | sole | collinear (near) | InvalidTopology |
| `cad-project-039/r22-current-guides.fs` | fs422 | 1/3 | boolean-capability 2 | cap normal | InvalidTopology |
| `cad-project-039/{archive-r11/integration, integration-r12, archive-r13/integration-r13, archive-r14/integration}.fs` (4 files) | fs422 | 1/3 each | boolean-capability 2 | cap normal | InvalidTopology |
| `cad-project-014/machine-interface-r11/top-full-module-r4/native/module-r4-upload.fs` | fs84 | 1/17 | imports 10, Boolean 2, builtins 2 (2 ok) | vertex limit | `qClosestTo` |
| distributor interface r3, r4, r5 (3 files) | fs95 | 2/16–19 | imports, Booleans, builtins | loft ×2 | twisted; polygon to circle |
| distributor interface r6, r7, r8, r9, r10 (5 files) | fs95 | 3/22–24 | imports, Booleans, builtins | loft ×2, vertex limit | twisted; polygon to circle; `qClosestTo` |
| interface r11 baseline, bottom-drive baseline (2 files) | fs95 | 6/26 | imports 9, Booleans 10, builtins 1 | loft ×4, collinear, vertex limit | InvalidTopology; through hole; twisted; polygon to circle; `qClosestTo` |
| interface-r11-prepared, bottom-drive r12-0, r12-1, candidate (4 files) | fs95 | 5/26 | imports 9, Booleans 11, builtins 1 | loft ×3, collinear, vertex limit | same as above |
| r10b copies: `pass3/camera`, `pass3/edge-pinion`, `pass3/tray-gap/{r10b, base-5d2d586d, ee691ede-reconstructed}`, `jobs/r10b/r10b-uploaded-snapshot`, `cad-project-043/fsocct/cases/r10b` (7 files) | fs549 | 1/10 | imports 8, InvalidTopology 1 | collinear | pierce-after-copy `RangeError` |
| `cad-project-041/single-step-r10/dist/R10b_Print_Package/r10b-uploaded-snapshot.fs` | fs549 | 1/9 | imports 7, InvalidTopology 1 | collinear | UnsupportedArrangement |

The per-unit rows, including the `deep` pass, are in
`out/corpus/cluster-kernel-sketch-and-ops.summary.json`.

**Families and current revisions.**

- `r22-current-guides.fs` (fs422) is the current integration studio. Its foot
  needs 2.1 and then the tilted-pocket Boolean.
- The fs95 representative (`bottom-drive-purpose-full-2026-09-19`) is not in
  this cluster. Its predecessors are.
- The fs126 corner posts need twisted lofts from R7 onward.
- The channel-base families (fs386, fs398, fs550) are outside this cluster.
  Their loft is their second blocker, after the Booleans (section 2.2).

## 5. Overlap with work in flight

- **Bake-off / `recover`.**
  - None of the five causes is a Boolean, so no bake-off route can solve them.
  - The two Boolean follow-ons were run on the hybrid route
    (`scripts/corpus/boolean-probe.mjs`, `WONKY_CORPUS_STUB=hybrid-all`: tagged
    tessellation, corefine, recover, `validateAnalytic`). This needed no
    change to the bake-off's case catalogue.
    - The tilted pocket (the next blocker of 9 units) is recovered from F32
      operands. OCCT reports it valid, at 7316.39927 mm³ (relative error
      1.0e-7).
    - The tilted-panel hole is recovered, but STEP export refuses it because
      of the F32 caps (2.1).
  - `recover` grades F32 extrusions at 1e-6 mm, because their vertices sit
    about 1e-6 mm off their own planes ([proto-recover.md](../proto-recover.md),
    round trip). Far, tilted caps are 6.7e-4 mm off, so fix 2.1 also improves
    `recover` inputs. The invalid-topology report found that `recover`'s own
    B-rep leaf intake refuses today's F32 operands at 1e-9 mm. The F32x2
    prism is a prerequisite for both Boolean routes.
  - Loft phase 1b produces cone patches, which `recover` covers. Phase 2
    surfaces (bilinear, B-spline) are outside every Boolean route.
- **Neighbouring corpus clusters.**
  - boolean-invalid-topology owns the F32x2 polygon prism that should carry
    fix 2.1 (section 2.1).
  - boolean-capability's pierce v2 would also admit the hopper holes by a
    tolerance rule. With caps on the sketch frame, those holes need no
    tolerance.
  - The channel-base statement in the boolean-capability report
    ("`roundBody`, two equal circles") is corrected in section 2.2.
- **Native binding.**
  - `topology.bend:extrude`, `geometry.bend:frame` and `lift_points` are
    native entries (19 in the slice), and the native output is bit-identical
    to JS (`docs/native-bridge.md`). The failures are therefore the same.
  - The native files changed after the first pass. The slice still has 19
    entries.
  - Fix 2.1 lives in Bend and carries over, but a signature change needs the
    slice's entry list regenerated. The loft constructors would be new
    entries.
- **Language work.**
  - `src/lang/wk/record-fs.mjs:164-172` duplicates the opLoft admission and
    records `frustum` nodes.
  - `stage-fs.mjs:525` calls `validatePolygon`.
  - A new loft kind needs a WK node. The collinear merge must happen in the
    shared path.
- **Viewer and frontend.** Not involved.
  - 2.1, 2.2 and 2.5 are kernel geometry in Bend.
  - 2.3 and 2.4 are host checks of kernel preconditions in `src/brep.mjs`.
  - The print-mesh finding (2.2) is an export limit in `src/print-mesh.mjs`.

## 6. Recommended order

1. **2.3 exact collinear merge (S).** 14 units, and the first blocker of
   r10b's SideDrive. It is independent of carrier precision.
2. **2.1 cap normal, inside the F32x2 polygon prism (M, shared with cluster
   boolean-invalid-topology).**
   - It moves 10 units of this cluster.
   - It moves 12 through-hole units of cluster 2, among them the current
     hopper revisions.
   - It is the second blocker of r10b's SideDrive.
   - It is a prerequisite for both Boolean routes.
   - Fallback: variant B in F32 (S), only if the F32x2 prism is more than a
     few days away.
3. **The pierce-after-copy crash (S, not this cluster).** It turns a crash into
   an exact result for r10b and 6 corpus copies.
4. **2.2 phase 1, planar-sided loft (M).** 11 units of this cluster and 14
   outside it reach their next blocker. It is a prerequisite for the corner
   posts, dovetails and channel bases.
5. **2.2 phase 1b, lines and concentric arcs (M).** 10 fs398 channel-base
   units. Pair it with print-mesh support for trimmed arcs, or the parts reach
   STEP but not a printer.
6. **2.4 vertex limit (S).** Low value: reference bodies. Measure the F32x2
   path first.
7. **2.5 line/arc region with holes (M–L).** One design.
8. **2.2 phase 2 (XL).** 48 units (28 twisted, 14 polygon to circle, 6
   multi-section). Only after general Booleans.

## 7. Reproduce

```sh
node scripts/corpus/kernel-sketch-and-ops/extract.mjs         # units, files, cross units -> tmp/corpus/kso/
node scripts/corpus/kernel-sketch-and-ops/drive.mjs diag
node scripts/corpus/kernel-sketch-and-ops/drive.mjs next --stub frame,collinear,loftplanar,maxverts,mixed
node scripts/corpus/kernel-sketch-and-ops/drive.mjs deep --stub frame,collinear,loftplanar,loft,maxverts,mixed,pvol,boolean
UNITS=tmp/corpus/kso/xunits.json node scripts/corpus/kernel-sketch-and-ops/drive.mjs xframe --stub frame
UNITS=tmp/corpus/kso/xunits.json node scripts/corpus/kernel-sketch-and-ops/drive.mjs xarea --stub area
# loft demand outside the cluster; the unit lists come from out/corpus/boolean-capability/probe-pass-all.jsonl
# (opLoft rows) and out/corpus/boolean-invalid-topology/admission.jsonl (#motorBracket)
UNITS=tmp/corpus/kso/xloft-units.json node scripts/corpus/kernel-sketch-and-ops/drive.mjs xloft-rerun --stub frame,collinear,loftplanar,maxverts,mixed,pvol,boolean
UNITS=tmp/corpus/kso/xloft-motor-units.json node scripts/corpus/kernel-sketch-and-ops/drive.mjs xloft-motor --stub frame,collinear,loftplanar,maxverts,mixed,pvol,boolean
node scripts/corpus/kernel-sketch-and-ops/cap-normal-error.mjs
node scripts/corpus/kernel-sketch-and-ops/report.mjs          # summary.json + tables
node scripts/corpus/kernel-sketch-and-ops/recheck.mjs         # repros: CLI, F32x2 simulation, bake-off hybrid, OCCT
node bin/wonky.mjs fixtures/corpus-repro/kernel-sketch-and-ops/<file>.fs --check [--feature F]
```

## 8. Limitations

- Stubs are emulations in the harness, not the proposed Bend code.
  - The `next` pass uses two proxies: vertex decimation for the 12
    vertex-limit units, and dropped holes for the 2 inner-loop units.
  - The `deep` pass uses proxies throughout, so its blockers are only a guide.
  - The outside-loft passes use the Boolean proxy. Their loft classification
    is exact, because lofts read only sketches. What follows the lofts (the
    128-body limit, reaching the end) can change once the Booleans are real.
- "Past the loft stage" means past every loft that runs before the next
  non-loft blocker. Later lofts can still be twisted.
- The claim that the F32x2 prism also admits the tilted-panel hole is
  inferred, not observed. The simulation's line/arc bodies carry curve ranges,
  and the through-hole arm does not take those. The `frame` stub shows that a
  cap on the sketch normal is enough.
- The vertex correspondence of Onshape's loft was not checked against a
  reference export.
- `npm test` was not run, because no production code changed. The risk notes
  in section 2 name what a real change must re-baseline.
