# Repros: planar arrangement Boolean refuses F32-built operands

Cluster `boolean-invalid-topology` of the corpus run. The analysis is in
[docs/corpus/cluster-boolean-invalid-topology.md](../../../docs/corpus/cluster-boolean-invalid-topology.md).
Every file is standalone and does not depend on `~/Workspace/cad`.

All were re-checked on 2026-09-23 at 04:13 with the production CLI on the
default JS path (`node bin/wonky.mjs <file> --check [--feature F]`). The
records are in `out/corpus/boolean-invalid-topology/repros-recheck.jsonl`,
with `uptime` per record. These are inputs, not tests: they document current
behaviour.

## After W2 (2026-09-23, 19:25)

Production now builds polygon prisms and their rigid copies in F32x2 in Bend
(`kernel/polygon-prism.bend`, wired in `src/kernel.mjs`; docs/corpus/w2-plan.md task D).
W2 also fixed a false negative in the planar arrangement's plane equality
(`kernel/ports/planar-boolean-arrangement.bend` `plane_equal`): its F32x2 cross filter
required an exactly zero cross, but `R.mul` is not commutative in its last bits, so a
prism side face of `slanted-prism-union.fs` was not equal to itself and the face
ownership map refused (stage 6). The exact certificate still decides.
Re-checked with the production CLI on the JS path (`tmp/w2/wire/repros.sh`):

| File (feature) | Observed after W2 |
|---|---|
| `wedge-union.fs` (`slanted`) | builds: 41 vertices, 79 edges, 40 faces, 319 mm³ |
| `wedge-union.fs` (`diag45`, `square`) | unchanged: 394 mm³, 494 mm³ |
| `slanted-prism-union.fs` | builds: 56 vertices, 106 edges, 52 faces, 206767.2 mm³ |
| `slanted-prism-cut.fs` | builds: 48 vertices, 91 edges, 45 faces, 48766.666667 mm³ |
| `rotated-box-cut.fs` | builds: 8 vertices, 12 edges, 6 faces, 36339.234517 mm³ |
| `slanted-prism-intersection.fs` | builds: 16 vertices, 24 edges, 10 faces, 43659.488134 mm³ |
| `many-vertex-prism-cut.fs` | unchanged: `37:9: … subtraction unresolved: UnsupportedArrangement (stage 1, detail 0)` (input size) |
| `next-blocker-chamfer.fs` (`chamferOnEdge`) | builds: 12 vertices, 20 edges, 10 faces, 2170 mm³ (= 2800 − 14 · 45) |
| `next-blocker-chamfer.fs` (`slantedCut`) | builds: 14 vertices, 23 edges, 11 faces, 2285.694444 mm³ (= 2800 − 14 · 36.736111) |
| `next-blocker-chamfer.fs` (`chamfer45`) | unchanged: 1904 mm³ |

Both chamfers get further than the simulation below predicted (`AmbiguousContact` stage 2
and `UnsupportedArrangement` stage 6): the simulation built line/arc-extruder bodies with
other carrier words, and it ran before the `plane_equal` fix.

## Before W2

The last column is the result with the fix simulated, which builds every
polygon prism and its rigid copies in F32x2
(`node scripts/corpus/diagnose-planar-admission.mjs <file> [feature] --simulate linearc`).

| File (feature) | Stands for | Observed | With the fix simulated |
|---|---|---|---|
| `wedge-union.fs` (`slanted`) | **minimal**: a 3-vertex wedge with a 35° hypotenuse, united with a box | `33:5: Native planar arrangement union unresolved: InvalidTopology (stage 1, detail 0)` | builds, 319 mm³ |
| `wedge-union.fs` (`diag45`) | control: 45° hypotenuse | builds: 41 vertices, 79 edges, 40 faces, 394 mm³ | builds |
| `wedge-union.fs` (`square`) | control: rectangle | builds: 44 vertices, 84 edges, 42 faces, 494 mm³ | builds |
| `slanted-prism-union.fs` | fs95 unions, e.g. `interface-r3.fs#bottomSpoke` | `33:9: … union unresolved: InvalidTopology (stage 1, detail 0)` | builds, 206767.2 mm³ |
| `slanted-prism-cut.fs` | `project-component-4c7a33fe.fs` `noseCut`, fs95 `retainingKey`/`switchBracket` cuts | `33:9: … subtraction unresolved: InvalidTopology (stage 1, detail 0)` | builds, 48766.667 mm³ |
| `rotated-box-cut.fs` | the 8 r10b copies `r10bTransferEdge` (`buildTransferEdge > cut`), unchanged r10b numbers | `35:9: … subtraction unresolved: InvalidTopology (stage 1, detail 0)` | builds, 36339.2345 mm³ |
| `slanted-prism-intersection.fs` | fs95 `bottomSpoke` R4/R5 (`flareClip`) | `33:9: Native convex-tool intersection unresolved: UnsupportedArrangement (tool 0, face 0)` | builds, 43659.488 mm³ |
| `many-vertex-prism-cut.fs` | `channel-bases-r7.fs`: a 384-vertex polygonized arc band | `37:9: … subtraction unresolved: UnsupportedArrangement (stage 1, detail 0)` | unchanged: input size limit (256 vertices) |
| `next-blocker-chamfer.fs` (`chamferOnEdge`) | second level: a slanted face that starts on an existing edge | `37:5: … subtraction unresolved: InvalidTopology (stage 1, detail 0)` | `AmbiguousContact (stage 2, detail 11)` |
| `next-blocker-chamfer.fs` (`slantedCut`) | second level: a slanted cut in general position | `37:5: … subtraction unresolved: InvalidTopology (stage 1, detail 0)` | `UnsupportedArrangement (stage 6, detail 0)` |
| `next-blocker-chamfer.fs` (`chamfer45`) | control: 45° chamfer | builds: 22 vertices, 40 edges, 20 faces, 1904 mm³ | builds |

On the bake-off `recover` route
(`scripts/corpus/boolean-invalid-topology/bakeoff-recover.mjs`):

- with today's F32 operands, the wedge, slanted union, slanted cut and rotated
  cut are refused at leaf intake (`vertex off its surface by 7.7e-7 … 3.6e-5`);
- with F32x2 operands, all four build as OCCT-valid exact B-reps;
- both second-level chamfers build as OCCT-valid exact B-reps from bake-off
  `prism` primitives.

The last column of the table is the expected result once the F32x2
construction exists. `wedge-union.fs` also states it in its header (319 mm³,
that is 175 + 180 − 36).
