# Independent solid-classification validation

The reusable runner compares Bend's point-in-solid results with OpenCascade's
`BRepClass3d_SolidClassifier` reading the exported STEP files. Bend builds or imports
the production bodies, applies the placement, evaluates probe coordinates and
exports STEP. OpenCascade only reads those artifacts and provides independent
observations; it does not build, repair or replace production geometry.

Run from the repository root:

```sh
node scripts/check-solid-classification.mjs
```

All generated models, probes, logs and reports are written to
`out/solid-classification-validation/`. The runner rebuilds the three small
examples and freshly imports frozen P10 on every invocation. It does not reuse a
previous classification result.

## Corpus and observed results

The run completed at `2026-09-21T23:25:01.661Z` with 56/56 matches, zero
mismatches, zero unresolved results, zero oracle-unknown results and zero errors.

| Model | Construction and coverage | Inside | Outside | Boundary | Matches |
|---|---|---:|---:|---:|---:|
| Box | `examples/box.fs`, 40 × 20 × 5 mm; interior, exterior, faces, edge and vertex | 4 | 6 | 6 | 16/16 |
| Concave bracket | `examples/bracket.fs`, L-shaped extrusion, 8 mm thick; both arms, concave notch, faces, edges and vertex | 4 | 6 | 6 | 16/16 |
| Bored spacer | `examples/bored-spacer.fs`, outer radius 5 mm, bore radius 2 mm, height 10 mm; material, bore, exterior, planar and cylindrical boundaries | 4 | 6 | 6 | 16/16 |
| P10 in `g0` | Fresh frozen import and the actual placement in r10b line 215 | 1 | 3 | 4 | 8/8 |
| Total | Deterministic coordinates shared by both classifiers | 13 | 21 | 22 | 56/56 |

The P10 probes are two remote points at ±[500, 500, 500] mm, Bend-evaluated
points on edges 248 and 254, the mean of face 0's referenced vertices with
normal offsets −1, 0 and +1 mm, and transformed source vertex 0. The three face
probes classified as Inside, Boundary and Outside respectively. The two edge
probes and source vertex classified as Boundary. Exact coordinates and selection
metadata are preserved in [probes.json](../out/solid-classification-validation/probes.json).

P10 uses this frozen `g0` transformation, with translation in millimetres:

```text
R = [[1, 0, 0],
     [0, 0.9063077870366499, -0.42261826174069944],
     [0, 0.42261826174069944,  0.9063077870366499]]
t = [0, 85.7915071334, -183.980480768]
```

This is the placed P10 input body. It is not a Boolean result or a completed
`singleStepR10b` assembly.

The existing STEP validation also passed for every model: a valid B-rep,
one solid, expected exported topology and positive volume. The three small
volumes agree with Bend. P10's 189 source face areas were independently checked;
its STEP volume was measured as 275773.8409333894 mm³, without a Bend volume
comparison. P10's exported topology is 189 faces, 529 edges and 348 vertices;
the frozen source contains 189 faces, 513 edges and 316 vertices before the
importer's explicit periodic-edge normalization.

## Optional Python interface

The existing invocation and report fields remain available:

```sh
uv run scripts/validate-step.py out/solid-classification-validation/box
```

Add `--points` to classify points on already exported STEP artifacts:

```sh
uv run scripts/validate-step.py --points out/solid-classification-validation/probes.json \
  out/solid-classification-validation/box \
  out/solid-classification-validation/bracket \
  out/solid-classification-validation/bored-spacer \
  out/solid-classification-validation/p10-g0
```

The input format is:

```json
{
  "schema": "wonky-solid-probes/1",
  "toleranceMm": 1e-7,
  "models": [
    {
      "prefix": "out/solid-classification-validation/box",
      "points": [
        {"id": "box.1", "pointMm": [20, 10, 2.5]}
      ]
    }
  ]
}
```

Prefixes are resolved relative to the working directory. The probe file must
cover every requested prefix exactly once and contain no other prefixes. Every
model needs at least one probe; IDs must be nonempty, globally unique strings.
Each coordinate must be a finite number, with exactly three coordinates per
point. Booleans are rejected as numeric coordinates or tolerances. The tolerance
must be finite and positive. Invalid requests fail instead of skipping probes.

With `--points`, each original STEP report gains `pointClassification` containing
the oracle and package version, tolerance, solid count, per-point state,
per-solid observations and SHA-256 hashes of the STEP, B-rep and probe file.
States are `Inside`, `Outside`, `Boundary` or `Unknown`. The oracle package is
pinned to `cadquery-ocp==8.0.1.0.0`.

For multiple solids the Python API combines their observations as a union:
Inside takes precedence over Outside, and Boundary over Outside. Any Unknown
observation, or a mixture of Inside and Boundary, produces Unknown. The current
comparison corpus requires exactly one solid per model.

## Acceptance and negative control

Only equal, resolved Inside/Outside/Boundary results count as matches. A Bend
`Unresolved` result is incomplete evidence, even if the oracle resolves it;
oracle `Unknown` is also incomplete. Execution errors and mismatches fail the
comparison. A model or suite passes only when every requested probe matches.
The Python command supplies observations; the Node runner performs this
acceptance decision.

The runner exits with 0 for all probes matched, 2 for incomplete evidence, and
1 for a mismatch or execution/input/source-change failure. Bend options for
this corpus are `linear: 1e-7`, `angular: 1e-10`, `inputTolerance: 0`; the STEP
classifier tolerance is `1e-7` mm.

Every run includes a negative control through the same comparison function.
In the recorded run, `box.1` was independently Inside for both classifiers.
Changing its Bend result to Outside produced exactly one mismatch,
`accepted: false` and `status: failed`. This verifies that a deliberately wrong
observation cannot be accepted by the comparison layer.

Focused interface checks also passed: 20 invalid requests were rejected by the
original request-loader function, a valid request was accepted, a real CLI
call rejected an unknown prefix, and the default CLI report exactly matched the
original fields of the corresponding oracle report. Details, method and
validator hash are in [api-checks.json](../out/solid-classification-validation/api-checks.json).
JavaScript and Python syntax checks passed.

## Source binding and limits

The report records hashes of all relevant implementation files, example inputs,
frozen fixture/provenance/manifest inputs and generated artifacts. Implementation
hashes were equal before and after the run. Classification also left each Bend
model unchanged. The Python oracle checks that the input STEP, B-rep and probes
remain byte-identical during validation; the runner checks their hashes and
exact probe IDs/coordinates against its own records.

Recorded SHA-256 values:

| Input | SHA-256 |
|---|---|
| Implementation snapshot | `0f6fbb9f3c5ede853b6d0d65e03fe4fe15959ec49815a26c838c93e5c9344e5f` |
| Kernel snapshot | `e5c4988051583fa8f868a68542482e07f3014d1ce02b3c0c4b6c54d9104dfbe8` |
| Frozen r10b FeatureScript | `219ee9630f37f9e54fe7e1b4e09094ab25748a811ed8f9e8b9ebf4892d8b8349` |
| Frozen P10 source body | `b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9` |
| Probe file | `5ea0487f738bbd5701f8b1f34a2e58c078b58ea65cefc5cabbaf231ee3523d6f` |

The frozen-source check also confirmed r10b's 404086 bytes and 1417 lines
against its provenance. P10's hash agrees with the frozen dependency manifest.
The full observations, per-file hashes, topology/area checks and negative
control are in [report.json](../out/solid-classification-validation/report.json),
with a compact [report.md](../out/solid-classification-validation/report.md) and
the separate [STEP oracle report](../out/solid-classification-validation/step-oracle.json).

These finite probes provide evidence for the recorded bodies, placements,
coordinates and implementation. They do not prove global numerical correctness,
general Boolean support or full r10b acceptance. Unresolved results must remain
visible when the corpus or implementation changes.
