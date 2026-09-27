# Repros: sketch/profile validation and operation limits

Cluster `kernel-sketch-and-ops` of the corpus run. The analysis is in
[docs/corpus/cluster-kernel-sketch-and-ops.md](../../../docs/corpus/cluster-kernel-sketch-and-ops.md).
Every file is standalone: it does not depend on `~/Workspace/cad`. All were checked
on 2026-09-23 with the production CLI on the default JS path
(`node bin/wonky.mjs <file> --check [--feature F]`), first at 00:10 and again at 04:20
(`node scripts/corpus/kernel-sketch-and-ops/recheck.mjs`, output in
`out/corpus/cluster-kernel-sketch-and-ops.recheck.jsonl`). The observed output is below.

These are inputs, not tests. They document current behaviour.

## After W2 (2026-09-23, 19:25)

Production now builds every polygon prism with the Bend profile ring merge and the F32x2
polygon prism (`kernel/profile-ring.bend`, `kernel/polygon-prism.bend`, wired in
`src/kernel.mjs` `extrudeInBend`/`transformInBend`; docs/corpus/w2-plan.md task D).
Re-checked with the production CLI on the JS path; the table further down is the record
from before W2.

| File (feature) | Observed after W2 |
|---|---|
| `cap-normal-far-from-origin.fs` (`tiltedOctagonFar`) | builds: 16 vertices, 24 edges, 10 faces, 7677.8832 mm³ |
| `cap-normal-far-from-origin.fs` (`tiltedRectangleFar`) | builds: 8 vertices, 12 edges, 6 faces, 1454.4 mm³ (the key pocket, 40.4 × 6 × 6) |
| `cap-normal-far-from-origin.fs` (`tiltedOctagonNear`) | unchanged: 7677.8832 mm³ |
| `through-hole-tilted-panel.fs` | builds: 10 vertices, 15 edges, 7 faces, 62690.946551 mm³ (= 280 · 70 · 3.2 − π · 1.7² · 3.2) |
| `collinear-polyline-vertex.fs` | builds: 8 vertices, 12 edges, 6 faces, 1600 mm³; vertex 2 merged exactly (deviation 0) |
| `profile-over-256-vertices.fs` | builds: 600 vertices, 900 edges, 302 faces, 2513.090386 mm³ (= 120000 · sin 1.2°) |
| `next-tilted-pocket-subtraction.fs` | `27:9: Native planar arrangement subtraction unresolved: UnsupportedArrangement (stage 6, detail 0)` |
| `next-pierce-after-copy.fs` | builds: 3959.787614 mm³, then 3919.575228 mm³ (pierce gate, W2 task A) |
| `loft-*.fs`, `line-arc-sketch-with-holes.fs` | unchanged (not in W2's scope) |

Near-collinear vertices (0 < deviation ≤ the profile tolerance) are merged too and recorded
as a regularization (`construction.profileMerge`, `exactness: 'regularized'`);
`src/kernel.mjs` `PROFILE_MERGE` switches that off. Whether it stays on under `strict` is
Marc's decision.

## Before W2

| File (feature) | Cause | Observed |
|---|---|---|
| `cap-normal-far-from-origin.fs` (`tiltedOctagonFar`) | cap normal | `19:5: Face vertices do not lie on the analytic plane` |
| `cap-normal-far-from-origin.fs` (`tiltedRectangleFar`) | cap normal | `19:5: Plane frame is not orthonormal` |
| `cap-normal-far-from-origin.fs` (`tiltedOctagonNear`) | control | builds: 16 vertices, 24 edges, 10 faces, 7677.88 mm³ |
| `through-hole-tilted-panel.fs` | cap normal, seen by the through-hole Boolean | `23:9: opBoolean through holes need a tool axis perpendicular to exactly two faces of the target` |
| `loft-two-polygons.fs` (`prismatoid`) | loft, planar sides | `27:9: opLoft currently requires two coaxial circular profiles` |
| `loft-two-polygons.fs` (`twistedOctagon`) | loft, twisted sides | `36:9: opLoft currently requires two coaxial circular profiles` |
| `loft-two-polygons.fs` (`squareToCircle`) | loft, polygon to circle | `47:9: opLoft currently requires two coaxial circular profiles` |
| `loft-tapered-slot.fs` (`taperedSlot`) | loft, lines and concentric arcs (next blocker of 10 fs398 channel-base units) | `32:9: opLoft currently requires two coaxial circular profiles`; exact result 4140 + 798π = 6646.990938 mm³ |
| `loft-tapered-slot.fs` (`slotExtrudeControl`) | control | builds: 8 vertices, 12 edges, 6 faces, 7865.574951 mm³ |
| `collinear-polyline-vertex.fs` | collinear vertex | `13:9: Profile has collinear or nearly collinear consecutive edges` (after W2 task C, before D: `15:9: Face loop has collinear or nearly collinear consecutive edges`) |
| `profile-over-256-vertices.fs` | vertex limit | `16:9: A profile must have 3–256 vertices` |
| `line-arc-sketch-with-holes.fs` | inner loops | `18:9: A line/arc sketch cannot mix entities with rectangle, polyline or circle profiles` |
| `next-pierce-after-copy.fs` | next blocker (not this cluster) | `wonky: Bend Real serialization requires a finite magnitude <= 1e20 without F32 exponent underflow` (JS RangeError, no source location) |
| `next-tilted-pocket-subtraction.fs` | next blocker (cluster boolean-invalid-topology) | `27:9: Native planar arrangement subtraction unresolved: InvalidTopology (stage 1, detail 0)` |

With the analysis harness (`scripts/corpus/kernel-sketch-and-ops/harness.mjs`,
analysis stubs only, no production change), these build:

- `--stub frame`: both far cap-normal features and the tilted-panel hole;
- `--stub loftplanar`: `prismatoid`, with volume 3626.6667 mm³ (the exact
  prismatoid volume);
- `--stub collinear`: `collinear-polyline-vertex.fs`;
- `--stub pvol`: `next-pierce-after-copy.fs`.

Other in-flight fixes, simulated in memory (04:20 re-check):

- **F32x2 polygon prism** (the boolean-invalid-topology fix,
  `scripts/corpus/diagnose-planar-admission.mjs --simulate linearc`): both far
  cap-normal features build (7677.8832 mm³). The tilted pocket moves from
  `InvalidTopology (stage 1)` to `UnsupportedArrangement (stage 6, detail 0)`.
  The tilted-panel hole reports the general-Boolean refusal, because the
  simulation's bodies carry curve ranges that the through-hole arm does not
  take. That result is a limit of the simulation.
- **Bake-off route** (`WONKY_CORPUS_STUB=hybrid-all scripts/corpus/boolean-probe.mjs`,
  corefine and recover prototypes, test only):
  - The tilted pocket is recovered from the F32 operands. OCCT reports it
    valid, with 11 faces and 7316.39927 mm³ against the closed-form
    7316.4 mm³ (relative error 1.0e-7).
  - The tilted-panel hole is recovered and the kernel validator accepts it,
    but STEP export refuses it: `STEP cylindrical parameter curves unresolved:
    InvalidSource`.

The cap-normal failures depend on how the F32 coordinates round. The
coordinates are therefore computed exactly as in the corpus source. A
hand-rounded origin can make the same prism build.
