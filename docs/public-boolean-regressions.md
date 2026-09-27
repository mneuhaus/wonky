# Public OCCT Boolean regression slice

Six complete public OCCT cases are frozen at revision
`3d097a0328e71b826377d4814ab05ec3c3d23871` and adapted to real FeatureScript.
Wonky evaluates their full operands, transforms and final Boolean through Bend.
OpenCascade/OCP only reads and measures the exported test STEP files.

The current [report](../out/public-boolean-regressions/after-difference/report.json)
has **4 adapted geometry passes and 2 Unsupported cases**. The four outputs pass
independent STEP validity, original surface-area values, derived volume/bounds,
and all **21 executed occupancy probes**. The other 9 planned probes are not
executed because their Boolean results do not exist. This is not a result for
the complete OCCT suite: the original Tcl/DRAW harness and visual `checkview`
assertions were not executed.

## Frozen sources and adaptations

[The manifest](../fixtures/public-boolean-regressions/manifest.json) records direct
upstream URLs, SHA-256 hashes, individual adaptations, original numeric oracles,
and derivations for all added oracles. Ten upstream files are unchanged: the six
Tcl cases, their Boolean-suite setup, README, LGPL 2.1 license and OCCT exception.
See [the notice](../fixtures/public-boolean-regressions/NOTICE.md).

Every selected operand is fully defined in its original Tcl. No case needs an
external BREP/RLE file. Historical path comments in the scripts are retained;
they do not load operands. Missing operands from other OCCT regressions were
not replaced with convenient public sample parts.

One original coordinate unit becomes one millimeter. Tcl vertex/edge/wire/plane
construction becomes a closed sketch on the same plane, with the same ordered
vertices and extrusion vector. Tcl box dimensions become opposite cuboid
corners. Rotations retain the original axis, center and angle using one rigid
`opPattern` copy followed by deletion of the unrotated body. None of the expected
result shapes is used to construct an operand or bypass a failed Boolean.

| Local case / original source | Original area | Added volume | Geometric coverage | Current result |
| --- | ---: | ---: | --- | --- |
| [common-e1](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/tests/boolean/bcommon_simple/E1) | 4 | 0.5 | Half-width box contained in a cube; coincident cap/side planes | Pass |
| [common-g1](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/tests/boolean/bcommon_simple/G1) | 4.41421 | 0.5 | Side-face extrusion, 45° rotation, diagonal contact | Unsupported: native InvalidTopology |
| [common-h1](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/tests/boolean/bcommon_simple/H1) | 2.12132 | 0.1464466094… | −45° about (0, 0.5, 0), height clipping | Unsupported: native InvalidTopology |
| [fuse-g1](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/tests/boolean/bfuse_simple/G1) | 170 | 141 | Exact top-face contact; nonconvex union | Pass |
| [fuse-g7](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/tests/boolean/bfuse_simple/G7) | 152 | 121 | Exact side-face contact; nonconvex union | Pass |
| [cut-h1](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/tests/boolean/bcut_simple/H1) | 68 | 22 | Original nonconvex U-prism, active one-tangent-face cutting box | Pass |

## Oracles and acceptance

The original printed `checkprops result -s` value is checked against independent
STEP area with an explicit absolute tolerance of `5e-6 mm²`, accounting for the
rounded upstream decimal. This local numeric comparison does not claim the
original DRAW checker ran. A second area check uses independently derived exact
values with `3e-6 mm²` tolerance. Volumes use `2e-6 mm³`, bounds `1e-6 mm`, and
point classification `1e-7 mm`. These are test comparisons; they do not enlarge
Bend's construction or contact tolerances.

The derivations are simple enough to audit independently:

- Common G1 is a triangular prism over `(0,0), (1,1), (0,1)`, height 1:
  volume `1/2`, area `3 + sqrt(2)`.
- Common H1 retains the rotated rectangular footprint and clips height 1.5 to 1:
  volume `1/2 − sqrt(2)/4`, area `3sqrt(2)/2`, maximum x/y `1 − sqrt(2)/4`.
- Both unions add a unit cube at one unit-square face. Their volumes add and
  surface areas add minus twice the contact area. Probes require the former
  shared-face interior to classify Inside and the neighboring reentrant gap
  to remain Outside.
- Cut H1 starts with profile area 12, perimeter 22 and height 2. Its active tool
  removes two unit cubes from the upper legs, leaving volume 22. Removed and
  newly exposed surface areas balance at 68. The original notch stays empty.

Native checks require the expected closed-solid count, planar surfaces, line
edges, volume and tight bounds. Native area is compared when available.
[`measure-step.py`](../fixtures/public-boolean-regressions/measure-step.py) reuses
[`validate-step.py`](../scripts/validate-step.py) for exact CurveOnSurface validity,
native-to-STEP topology preservation, volume and point classification, adding
only independent surface area and optimal geometric bounds. It is pinned to
`cadquery-ocp==8.0.1.0.0`; it neither constructs nor repairs production shapes.

The unions currently have 22 vertices, 40 edges and 20 faces each. Segmentation
is recorded, not compared with an imagined minimal face count. Original tests
do not assert simplification; independent area, occupancy and topology
preservation still reject retained internal contact faces or duplicate solids.

Reports distinguish `unsupported-api`, `unsupported-geometry`, `wrong-geometry`,
`incomplete-oracle`, `validation-error` and `execution-error`. `kernel-passed`
is preliminary. Only `passed-adapted-geometry` includes independent checks.
`accepted` requires every selected case to pass and an unchanged implementation
snapshot across the run. The full six-case cohort currently has `accepted:false`.
The runner deletes old case exports before execution, so an Unsupported case
cannot inherit a previous successful STEP. Current constructed exports with a
failed oracle remain diagnostic artifacts and never acquire pass status.

## Rotation diagnostics

[Frozen operand diagnostics](../out/public-boolean-regressions/operand-diagnostics/report.json)
retain the exact adapted source hashes, operand-only FeatureScript copies,
host B-reps, STEP files, native F32x2 serialization and native admission results.
The final Boolean is omitted only in those explicitly labeled diagnostic copies;
these exports cannot count as regression passes.

Both rotated cases have closed host shells and separately pass independent STEP
read validation as two input solids. Native convex admission rejects the rotated
operand: G1 faces 1/2 and H1 faces 3/4. The unrotated cube is admitted in each case.
An [isolated G1 transform experiment](../out/planar-transform/common-g1-diagnostic.json)
using the existing Bend F32x2 transform admits the transformed operand but still
returns `AmbiguousContact(vertex 2)` in intersection: the preceding F32 extrusion
already introduced near contacts. This evidence does not establish a production
fix. A continuous F32x2 construction path needs separate validation; fixture
coordinates, operations and tolerances remain unchanged.

## Run

```sh
node scripts/public-boolean-regressions.mjs
node scripts/public-boolean-regressions.mjs --case common-e1 --out out/public-boolean-regressions/control
node --test test/public-boolean-regressions.test.mjs
```

`--case` may repeat. `--skip-step-validation` produces preliminary native results
and cannot make `accepted` true. The default output is
`out/public-boolean-regressions/run/`; a nonzero exit currently reflects the two
real capability gaps. Reported scope and counts always accompany the outputs.

The three focused tests cover source pinning, actual full-cohort Bend execution,
stale-export removal, independent validation of Common E1, and rejection of wrong
area, missing measurements, missing probes and Unknown point classifications.
They do not freeze the current Unsupported count, so valid capability improvements
can turn those cases into passes. Global `npm test` remains part of integration.
