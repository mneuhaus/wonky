# AC115: observer re-export erased a representable analytic wall

The defect was in the CAD-Acid observer's OCCT STEP **re-export**, not the native
B-rep or wonky's STEP writer. `STEPControl_Writer.Write` serialized REALs with
12 significant digits. At V1's placement it erased the bore's positive wall;
the second OCCT import then split the cap boundary edges and rings at artificial
contacts. The first import was valid and had the expected topology.

The fix is general: `measure.export_step` transfers through the same OCCT writer
and serializes its model through `StepData_StepWriter` with `%.17g`. It preserves
binary64 values without changing tolerances, healing, geometry or scoring.
AC115 is restored unchanged from its independently derived draft. The exact
previous catalog is retained under its SHA-256 in `catalog-history`. AC115 uses
the existing per-zone `twin` source selection; shared Z1 twin files remain byte
identical, preserving every earlier frozen reference. Only this source selection
metadata is added to the draft, without changing its geometry contract.

## Minimal construction and reproduction

Select only AC115 from `fixtures/cad-acid/fs/acid-ac115.fs`: a 20×16×10 mm
cuboid minus a radius-4 mm cylinder, parallel to z, from z=-1 to z=11, centred at
(10, 4 + 1/1073741824). Transform both operands together before subtraction.
V1 adds the catalog frame translation and the cell (1250,3750,0), giving nominal
world box minimum (66786.25,-29018.5,16384.125). No other zone is constructed.
V4 uses radius 4.025 and is an open groove with its own unchanged contract.

Run `node --test test/rust-step-roundtrip-real.test.mjs` through the mandatory
host runner. It builds real FeatureScript geometry, imports the exported STEP,
reproduces the old OCCT serialization, and checks the corrected second import.
It also mutates an actual full-ring edge into two out-and-back periodic seam
edges in both adjacent loops; the round-trip scorer must reject it. A failed
observer process is reported as infrastructure ERROR, never geometric WRONG. A legal
smooth split into two circular arcs remains equivalent under canonicalization;
it is not that planted defect.

## Exact entities in the isolated V1 output

Native topology: F7 E14 V8, two vertex-free rings, ten loops, genus one.
Wonky STEP: seven `ADVANCED_FACE`, fifteen `EDGE_CURVE`, ten `VERTEX_POINT`.
The difference is exactly one periodic generator seam and the two ring anchor
vertices required by this STEP representation.

```step
#22=CARTESIAN_POINT('',(66786.25,-29018.500000000004,16384.125));
#69=CARTESIAN_POINT('',(66796.25,-29014.499999999072,16384.125));
#73=CYLINDRICAL_SURFACE('',#72,4.0);
#122=CARTESIAN_POINT('',(66796.25,-29014.499999999072,16384.125));
#126=CIRCLE('',#125,4.0);
#127=EDGE_CURVE('',#37,#37,#126,.T.);
#128=CARTESIAN_POINT('',(66796.25,-29014.499999999072,16394.125));
#132=CIRCLE('',#131,4.0);
#133=EDGE_CURVE('',#38,#38,#132,.T.);
#149=SEAM_CURVE('',#136,(#142,#148),.CURVE_3D.);
#150=EDGE_CURVE('',#37,#38,#149,.T.);
```

Both rings are single closed edges, with equal start/end vertices. #150 is used
in both senses on the cylindrical face. There are no ring splits or extra wall
faces. The exact rational difference between the written binary64 y coordinates
of #69 and #22, minus the radius, is **1/1073741824 mm**.

The old OCCT re-export still has full rings #216 and #345, but loses their 3D
offsets (OCCT 7.8, cadquery-ocp 8.0.1.0.0):

```step
#216 = EDGE_CURVE('',#217,#217,#219,.T.);
#222 = CARTESIAN_POINT('',(6.679625E+04,-2.90145E+04,1.6394125E+04));
#229 = CARTESIAN_POINT('',(10.,4.000000000931));
#235 = CARTESIAN_POINT('',(6.679625E+04,-2.90145E+04,1.6384125E+04));
#345 = EDGE_CURVE('',#346,#346,#348,.T.);
#351 = CARTESIAN_POINT('',(6.679625E+04,-2.90145E+04,1.6384125E+04));
```

The 3D centre is now exactly -29014.5, while its planar pcurve #229 retains the
local positive offset. On second import, each full ring becomes arcs with ranges
[0,3π/2] and [3π/2,2π], joined to the front cap edge at
(66796.25,-29018.5,z), z=16384.125 or 16394.125. Those points did not exist in the
original STEP topology. Raw topology grows to E19 V12; canonical topology is
E16 V10, eight loops and no rings. OCCT still reports a valid, closed, positive
solid, so validity alone does not catch this corruption.

| Stage | V0, V2, V3 | V1 | V4 |
|---|---|---|---|
| Native and first STEP import | F7 E14 V8 | F7 E14 V8 | F8 E18 V12 |
| Old 12-digit second import | F7 E14 V8 | F7 E16 V10 | F8 E18 V12 |
| Corrected 17-digit second import | F7 E14 V8 | F7 E14 V8 | F8 E18 V12 |

All measured first and corrected second imports were valid, closed and positive.
The legacy observations and exact STEP files are retained in the builder's
`tmp/studio/tmp/ac115/V*/` diagnostics, not substituted for live gate evidence.

## C9 floor and scope

The wall is 2^-30 mm. At V1's largest coordinate, binary64 spacing is 2^-36 mm:
the wall spans 64 ulps. Its bounding curves are analytic circles and lines, so
the approximated-curve term in `max(binary64 resolution, 4 × declared curve
approximation budget)` is zero. OCCT's 1e-7 mm confusion tolerance is not a C9
floor for the exact kernel. The conservative export-rounding uncertainty is not
an approximated-curve budget. No kernel refusal or tolerance widening is needed.

No Bend, alternate CAD construction kernel, Onshape API capture, R20 run, score
rule, site gate or existing zone contract was changed. This was a solo builder
investigation; live re-execution is verification, not an independent verifier.

Targeted live CAD-Acid: AC115 V0–V4 CORRECT; all five original STEP exports
passed `validate-step.py`. The eight focused tests passed with no skips. Full
final-tree gate results are recorded in the builder checkpoint and final output.
