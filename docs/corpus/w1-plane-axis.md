# W1 fix: the x axis of `plane(origin, normal)`

Date: 2026-09-23. Defect: the "high" item in [w1.md](w1.md), "Open after the
third verification round". It was found by verifier round 3, and it had
been there since the initial import (cd9ba68).

## What std does

- `surfaceGeometry.fs:86`:
  `plane(origin, normal) = plane(origin, normal, perpendicularVector(normal))`.
- `vector.fs:339` `perpendicularVector(vec)`:
  - It drops units and returns `(1, 0, 0)` for a vector shorter than
    `TOLERANCE.zeroLength`.
  - It picks a helper axis `different`:
    - Z when `|x| > 1.0366…·|y|` and `|x| > 0.9517…·|z|`.
    - Y when `|x| > 1.0366…·|y|` but not `|x| > 0.9517…·|z|`.
    - X when `|x| ≤ 1.0366…·|y|` and `|y| > 0.9204…·|z|`.
    - Y otherwise.
  - It returns `normalize(cross(different, vec))`.
- `surfaceGeometry.fs:216` `planeToWorld(plane, p) = origin + x·p[0] + cross(normal, x)·p[1]`.
  This is how sketch coordinates reach the world.

**Refix 1 (24.09.2026):** `perpendicularVector` gets the normal as the caller
passed it. The first version of this fix normalized it first, so a normal
shorter than `TOLERANCE.zeroLength` got a ratio-picked axis instead of
`(1, 0, 0)`: (0, 5e-9, 0) gave x = (0, 0, 1) where std gives (1, 0, 0). For
such a normal std's `as Plane` (`canBePlane`: |x · normal| <
`TOLERANCE.zeroAngle`) then fails unless the normal is perpendicular to
(1, 0, 0), e.g. (5e-9, 0, 0) or (3e-9, 4e-9, 0). wonky now raises the same
catchable error there. Test: `plane-axis-corpus` "plane(origin, normal) with a
normal shorter than TOLERANCE.zeroLength ...". The verifier oracle
`tmp/w1-fix-verify/plane-axes.fs` (6 features) matches std.

Before the fix, wonky projected (1, 0, 0) onto the plane, or (0, 1, 0) when
|n.x| ≥ 0.9. For the axis normals this gives:

| normal | std x | old wonky x |
|---|---|---|
| +Z | (1, 0, 0) | (1, 0, 0) |
| −Z | (−1, 0, 0) | (1, 0, 0) |
| +Y | (0, 0, 1) | (1, 0, 0) |
| −Y | (0, 0, −1) | (1, 0, 0) |
| +X | (0, 1, 0) | (0, 1, 0) |
| −X | (0, −1, 0) | (0, 1, 0) |

Most oblique normals differ too.

## Change

`src/library.mjs`:
- New `perpendicularVector()`, a verbatim port of the std function.
- The two-argument branch of `plane()` now uses it.
- `perpendicularVector` is also exported as a std value builtin. No corpus
  file calls it today.
- The three-argument `plane()` is unchanged.

Only `plane()` builds a Plane without an explicit x. The Plane constructions
in `values.mjs` (casts, `Transform * Plane`) always carry one.

`src/lang/surface/eval.mjs:1355` has the old rule too, but that is the
build123d `Plane` (OCCT semantics), not Onshape std. It is outside W1.

## Which models change

The before/after comparison ran with a temporary switch in `plane()`, now
removed. The switch rebuilt each unit with the old and the new axis, and it
logged every evaluated plane whose axis differs. The harness is under
local development evidence: `plane-axis-audit.mjs`, `plane-axis-driver.mjs`,
`audit-*.jsonl` and the `*.log` files.

- **examples/*.fs and every fixture .fs except r10b** (111 units): all 111
  are identical in bodies, volumes, bounds and a vertex fingerprint, or fail
  with the same error. Three units evaluate a changed axis:
  - `through-hole-admission.fs#obliqueHole`
  - `next/blind-pilot-in-stepped-body.fs`
  - `next/lochwand-hole-in-notched-panel.fs`

  All three sketch a circle centred on the plane origin. That profile does
  not depend on the in-plane axis, so the result is unchanged.
- **r10b.** `npm run check:r10b` fails with the same error before and after:
  `fixtures/r10b/r10b.fs:25:2 Native curved convex-tool intersection unresolved: UnsupportedArrangement (tool 1, face 2)`.
  - It takes 97.2 s and 95.9 s CPU.
  - No changed axis is evaluated before that stop.
  - `scripts/check-r10b-inputs.mjs` also gives the same output before and
    after, and evaluates no changed axis. It stops at a pre-existing STEP
    exporter refusal: `STEP cylindrical parameter curves unresolved: InvalidSource`.
  - `fixtures/r10b/r10b.fs` is untouched.
- **Corpus units that build today** (16 FS units, status ok in the labels
  `w2`, `w1-verify3` and `w1-r3`): all 16 are identical, and none evaluates
  a changed axis.
  - The two Onshape STEP references (`module-r4.fs` `driveShaftReferenceR4`
    and `driveCouplingReferenceR4`) keep their agreement.
- **Tests** (the 54 test files that reach the FS frontend): no test encodes
  the old axis.
  - `test/lang-wk-real.test.mjs` traces real corpus files through the
    library `plane()` and evaluates 371 changed axes. All of its tests pass.
  - The failures seen in these runs fail with the old axis too, or have
    nothing to do with `plane()`:
    - Python execution timeouts under load 100 to 220.
    - `python.test.mjs:26`.
    - A native-bridge divergence count in a shared work directory.
- **The rest of the corpus** (fails today, so it cannot be diffed yet): the
  verifier's scan (`tmp/w1-verify/semantic3/scan-plane-normals.mjs`) finds
  two-argument planes with these normals:
  - (0, −1, 0): 94 sites in 7 files.
  - (0, 1, 0): 31 sites in 8 files.
  - Non-literal: 445 sites.

  In every sample checked (`central-spur-r26`, `tray_r1` with its
  `tray-r1-native.step`, the r10b cylinder helper), only circles centred on
  the plane origin are sketched on these planes. The fix moves the circle
  seam to where Onshape puts it, and the solids stay the same.

## Why the new geometry is the right one

No Onshape-exported STEP covers a changed result: no building unit changes.
The reference is the std source, evaluated by hand in
`test/plane-axis-corpus.test.mjs`:

- `plane(o, n).x` and `perpendicularVector(n)` are checked for:
  - the six axis normals;
  - (0, 0, 7), which is not normalized;
  - (1, 1, 0) and (0, 1, 1);
  - the threshold pairs (1.04, 1, 0) / (1.03, 1, 0) around 1.0366,
    (0, 0.9, 1) around 0.9204, and (1, 0, 1.06) around 0.9517.
- A 10 × 2 mm rectangle extruded 3 mm on each axis plane gives the std
  boxes. For example, −Y gives [0, −3, −10]..[2, 0, 0] (the old axis gave
  [0, −3, 0]..[10, 0, 2]).
- The verifier's `xAxisValue` probe gives 8 mm³, as Onshape does (the old
  axis gave 64 mm³).
- With the old rule, 3 of the 4 tests fail.

A direct Onshape evaluation of `tmp/w1-verify/semantic3/plane-x.fs` would add
an independent check. It needs a live Onshape session and was not run.
