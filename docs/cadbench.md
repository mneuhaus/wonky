# CADBench and public CAD regression probes

This integration runs **real Rust-kernel geometry** from explicitly adapted public
specifications and test sequences. The harness accepts only exact, closed,
validated Rust WC0 bodies that the kernel itself re-measures
(`exactRustBodies` in `scripts/cadbench.mjs`): a model without such geometry
fails whatever backend it names. Results from the retired Bend kernel below are
frozen history. It does not run an AI agent, construct
geometry with FreeCAD/build123d/OCCT, or claim an official CADBench score.
OpenCascade only reads and independently checks already exported STEP files
through the project's existing `scripts/validate-step.py`.

## Run locally

```sh
# Offline fixture/hash checks; no Python data packages needed.
node scripts/cadbench-sources.mjs

# Five public-spec FeatureScript cases, including unsupported operations.
node scripts/cadbench.mjs

# Ten geometry/API probes adapted from real build123d tests (parked: the Python
# frontend is not ported to the Rust kernel, so all ten fail closed by name).
node scripts/cadbench-build123d.mjs --out out/cadbench/build123d

# Focused harness checks. The root integration also runs npm test.
node --test test/cadbench.test.mjs test/cadbench-build123d.test.mjs

# Optional provenance reproduction: re-download pinned metadata and 1.91 MB
# Parquet, verify hashes, and re-extract with pyarrow==21.0.0 via uv.
node scripts/cadbench-sources.mjs --verify-upstream
```

Both complete probe runners currently exit **1**, because their selected cases
include real capability gaps. This is intentional failure reporting, not a
harness crash. Their JSON reports retain every attempted case. Missing or
unsupported operations are never counted as passes. `--skip-step-validation`
is available for local diagnosis; it cannot produce a validated pass.

The CADBench runner also supports `--list`, `--out <directory>`, and repeatable
`--case <id>`. A subset preserves both denominators: five local pilot cases and
100 official tasks. Normal runs use frozen local data and require no accounts,
paid model API, Docker images, network requests, submissions, or uploads.
Independent export checks require the same `uv`/OCP environment as the existing
project validation workflow.

## What the official benchmark requires

Sources inspected on 2026-09-22:

- [CADBench](https://cadbench.ai/) and its [v2 release](https://cadbench.ai/news/cad-bench-v2): v2 is current; v1 is frozen.
- [Run contract](https://cadbench.ai/benchmark): 100 tasks, exactly one attempt per task, retries disabled, failures retained as zero reward.
- [Pinned machine-readable v2 policy](https://github.com/gNucleus-AI/cad-bench-submission/blob/6b85cbafd00961c105b1fbc2173163a9b595bbdd/benchmarks/v2.json): dataset digest `sha256:ab2e040d0adcfd2779b4f1ad554890cd98b5aa19845e00162933ba165144fe56`; all 100 task digests are vendored unchanged.
- [Harbor v2 task suite](https://hub.harborframework.com/datasets/gnucleus-ai/cad-bench/v2): FreeCAD 1.1.0, Harbor schema 1.2. The reference geometry, structured specification, and validator live in an isolated verifier image.
- [Pinned submission contract](https://github.com/gNucleus-AI/cad-bench-submission/blob/6b85cbafd00961c105b1fbc2173163a9b595bbdd/CONTRIBUTING.md): editable `answer.FCStd` and its generating `answer.py`, full trajectories, public job receipts, and matching digests are required. A STEP export alone cannot satisfy it.

The v2 release identifies `gnucleus-freecad-validator` **0.4.0**. Its
[pinned README](https://github.com/gNucleus-AI/freecad-validator/blob/3dce2442e574f93ea6548f373f723c6e65517796/README.md#scoring)
documents the default geometry score as
`0.10 × surface_types + 0.35 × volume + 0.40 × surface_area + 0.15 × bbox`, with
a solid-count mismatch yielding zero. The default specification score is the
fraction of consistent parameters. Their default combination is the harmonic
mean `2gs/(g+s)`. The cohort score is the mean continuous task reward, including
failed/unscored tasks as zero. These are published defaults; this integration
does not execute the official verifier or establish any container-specific
overrides. The newer validator repository releases are not silently substituted
for the benchmark's declared release.

Our report therefore always records **0/100 official tasks scored**,
`reward: null`, `submissionEligible: false`. Reading public specifications and
manually authoring local kernel tests is a different experiment from a held-out
agent evaluation. No local pass fraction is presented as CADBench accuracy.

## Frozen data, license, and adaptations

The public [cad-gen-freecad dataset](https://huggingface.co/datasets/gnucleus-ai/cad-gen-freecad)
is pinned to `a0e2f69b58d857b631ac1b746ff08e70c1240d8a`.
Its README explicitly licenses the Parquet, images, meshes, edge data, and FCStd
files under **Apache-2.0**, copyright gNucleus AI, Inc. The benchmark submission
repository is also Apache-2.0. The source dataset can be read anonymously.

`fixtures/cadbench/upstream/public-corpus.json` contains all 100 original
description/parameter/path rows, extracted from the 1,907,996-byte Parquet
whose SHA-256 is
`b656c7b551dbd00b9567a9f4bd6d4a397be294820e66e0c1e1d682c1481de6ee`.
Image data were omitted. No reference FCStd, mesh, or edge geometry was used to
construct the local cases. The unchanged dataset README, license, task policy,
source hashes, extraction recipe, and modification notices are retained under
`fixtures/cadbench/`. The source inventory is checked against all 100 official
task IDs before any model is built. The optional upstream verifier reproduces
the metadata byte-for-byte from the pinned Parquet.

`pilot.json` describes the selection bias, coordinate conventions, changes,
analytic expected volume/bounds, and inside/outside probes for every case.
All input programs are ordinary FeatureScript. The five source specifications
are geometrically complete within their stated nominal dimensions; material
properties and washer manufacturing grade are outside this test's scope.

| Local case | Public source ID | Geometry exercised | Rust kernel (2026-09-28) | Bend era (frozen, 2026-09-22) |
|---|---|---|---|---|
| `washer` | `21d1517841` | Analytic annulus, coaxial subtraction | Passed | Passed |
| `cup` | `1b9f95801c` | Open cavity, coincident nominal upper plane | Passed | Passed after kernel fix |
| `frustum` | `f3e10795e7` | Analytic conical loft | Unsupported: `loft/planar-line-profiles-required` (circle-to-circle `opLoft`) | Passed |
| `stairs` | `0f27beedee` | Full nonconvex five-tier profile extrusion | Passed | Passed |
| `square-washer` | `3582a53285` | Square plate minus circular bore | Passed | Unsupported general subtraction |

The Rust run (`node scripts/cadbench.mjs`, M4 mini runner, Rust addon
`sourceHash` `c5d53a0763dd`) reports **4 passed, 1 unsupported**, with
independent STEP validation passed for all four exports (OCCT validity, kernel
topology preserved, volume, and all 14 occupancy probes of those cases). It
exits 1 because of the frustum. The frustum is a named capability refusal of
the Rust `opLoft`, which lofts planar line profiles only; it is the first
kernel-gap candidate from this pilot, never a pass or an approximation. From
`main` onward, `test/cadbench.test.mjs` pins these statuses in the Rust test
lane (`scripts/test-rust.mjs`).

These deliberately small cases do not establish broad coverage of the source
dataset's gears, splines, flanges, rounds, joints, or complex assemblies. The
other 95 source rows remain explicitly `not-attempted` in every complete pilot
report.

The local checks cover native closed topology, solid count, independently
specified nominal volume and axis-aligned bounds, and analytic surface
families. Raw native face/edge/vertex counts are recorded. Independent STEP
checks require exact CurveOnSurface validity, preservation of the exported
topology, positive volume matching the known value, and all occupancy probes.
They do not measure the official FCStd parameter consistency, full surface-area
score, or full shape equivalence.

Face subdivision is deliberately not forced to match a minimal conceptual
model. A coaxial arrangement can split one cylindrical or planar support into
several valid faces. The initial local oracle mistakenly required minimal face
counts; oracle revision 2 corrected that assumption while retaining analytic
types, native/STEP topology checks, volume, bounds, and probes. The initial
post-fix false-failure report is preserved separately.

## Preserved Bend-era baseline and the cup regression (frozen history)

The original run is frozen in
`out/cadbench/baseline-2026-09-22/`, with all file hashes in
`out/cadbench/baseline-manifest.json`: **3 passed, 2 unsupported**.
The unmodified cup uses an outer cylinder ending at `z=120`, while the cavity's
independently evaluated endpoint is `120.00000000000001`. The original native
coaxial admission rejected the tiny exterior interval even though it contained
no retained material. `out/cadbench/cup-diagnostic.json` preserves the original
source, operands, native arguments, and failure result.

The root's material-interval fix was evaluated using the **same five
FeatureScript SHA-256 values**. The validated rerun at
`out/cadbench/after-material-interval-fix/report.json` reports
**4 passed, 1 unsupported**, including all **16** independent occupancy probes.
`out/cadbench/comparison.json` checks that the frozen baseline and source
programs remain unchanged and records the separate local oracle correction.
No cutter was extended, no coordinate was snapped, and the pilot policy stays
strict. Both runs have stable implementation snapshots. The square washer
remains an explicit unmet operation, so the whole pilot still exits 1.

## Reused build123d test sequences

The official [gumyr/build123d repository](https://github.com/gumyr/build123d)
is pinned to `bc19b031cad4bda9568c6ed3f86c51ba17c97fe5`.
It is **Apache-2.0**; its contributor/CadQuery attribution `NOTICE` and license
are preserved alongside unchanged
[`tests/test_algebra.py`](https://github.com/gumyr/build123d/blob/bc19b031cad4bda9568c6ed3f86c51ba17c97fe5/tests/test_algebra.py).

`fixtures/cadbench/build123d/manifest.json` identifies ten selected methods out
of the 95 test methods in that file. It lists every adaptation and omitted
assertion. **Parked since 2026-09-28** (docs/python-frontend.md): the Python frontend
still calls the legacy Bend-era kernel op table, which the Rust kernel does not
serve, and it is not being ported. On Rust every probe fails closed as
`not-ported` (`kernel entry … is not ported to the Rust kernel`); none passes,
and `test/cadbench-build123d.test.mjs` pins that. The table below is the frozen
Bend-era result. In that era the runner sent the adapted programs through
**Wonky's own Python compatibility shim and Bend kernel**. It does not install or import the real
build123d implementation. Original unittest/class-identity assertions,
edge-lineage queries, and vectorized-versus-sequential branches are not silently
treated as tested. Some exact modeling sequences currently fail before geometry
is reached, which is reported as `unsupported-api`.

| Selected sequence | Reused expectation / remaining gap | Bend-era observed status (frozen) |
|---|---|---|
| `ObjectTests.test_box_min` | Exact dimensions/alignment and upstream bounds; analytic volume added | Adapted geometry passed |
| `ObjectTests.test_cylinder_` | Original centered cylinder/bounds; analytic volume added | Adapted geometry passed |
| `AlgebraTests.test_part_plus` | Full box–cylinder union; upstream bounds, analytic volume | Unsupported geometry |
| `AlgebraTests.test_part_minus` | Full box–cylinder subtraction; upstream bounds, analytic volume | Unsupported geometry |
| `AlgebraTests.test_part_and` | Constructed volume/STEP valid; native tight-bounds oracle absent | Incomplete oracle |
| `AlgebraTests.test_compound_minus`, `split_cut` subcase | Two solids and volume 3; equivalent centered Box inputs | Adapted geometry passed |
| `OperationsTests.test_fillet_3d` | Original radius and volume 5.804696 ± 0.0001 | Unsupported API (`Shape.edges`) |
| `AlgebraTests.test_empty_plus_overlapping_parts` | Original sequential nine-box union; full-union analytic mass/bounds added | Unsupported geometry |
| `AlgebraTests.test_empty_plus_mixed_curved_parts` | Original mixed box/cylinder sequence; vectorized/mass/area equivalence still required | Unsupported geometry |
| `AlgebraTests.test_empty_plus_rotated_parts` | Original rotations/placements of five boxes | Unsupported API (`Rot`) |

The last Bend-era run is `out/cadbench/build123d-after-difference-arcs/report.json`: **3 adapted geometry
passes, 4 geometry capabilities missing, 2 API capabilities missing, 1 incomplete
oracle**. All four constructed exports pass the existing independent STEP
validator. `wrong-geometry`, `execution-error`, and `validation-error` are
separate statuses. The original suite was not executed; original-test pass
count is `null`. This report is separate from CADBench coverage.

This is a useful next optimization target because the difficult sequences are
already concrete and licensed: preserve their complete operands and all
failures while adding the missing API/geometry paths, then restore the omitted
edge-lineage and batch-equivalence assertions. A missing oracle must be filled
before promoting its case to a pass.

## Harder public B-rep / Boolean corpus

The most direct supplementary corpus found is the official
[Open-Cascade-SAS/OCCT repository](https://github.com/Open-Cascade-SAS/OCCT), pinned
for this investigation to `3d097a0328e71b826377d4814ab05ec3c3d23871`.
Its [Boolean regression folders](https://github.com/Open-Cascade-SAS/OCCT/tree/3d097a0328e71b826377d4814ab05ec3c3d23871/tests/boolean)
include `bcommon_complex`, `bfuse_complex`, `bcut_complex`, `cells_test`,
`splitter`, and others. These describe real operations and checks rather than
only supplying unrelated shape meshes. The repository is distributed under
**LGPL-2.1 with the OCCT exception**, not Apache-2.0.

A small immutable sample is already downloaded to
`out/cadbench/corpus-samples/occt/` (560,402 bytes total including notices):

- `data/occ/CrankArm.brep`, 383,605 bytes.
- `data/occ/Pump_TopCover.brep`, 144,669 bytes.
- `tests/boolean/bcommon_complex/C2`, its exact intersection command and
  expected surface area `16681.4`.
- Original README, LGPL text, exception, and a manifest with immutable URLs
  and SHA-256 hashes.

**Availability matters:** C2 references `CTO900_cts21453a.rle` and
`CTO900_cts21453b.rle`; those inputs are absent from the inspected public
`data/occ` listing. The downloaded CrankArm/Pump files are separate shape
samples, not substitute operands for C2. No OCCT regression has been executed
or credited here. Wonky also needs an admitted native import path for these
B-reps before testing them; loading a sample in OpenCascade and using its
constructed shape as production geometry would violate the project boundary.

For the next small corpus slice, prefer a regression with both original
operands present, its explicit union/intersection/difference command, tolerances,
and original mass/topology checks. Keep raw reference data and transforms
immutable. Supplement the upstream checks with:

- Valid closed solids, expected component/shell counts, native incidence and
  source-budget invariants, and independent exported STEP validity.
- Known volume/area/bounds and robust inside/outside probes; ambiguous contacts
  remain unresolved rather than being rounded into a pass.
- Idempotence, operand-order checks where applicable, rigid-transform
  invariance, and volume identities for union/intersection/difference. Passing
  mass identities alone is not full shape equivalence.
- Explicit exact-touch, near-touch, thin retained material, disconnected
  islands, and nonconvex cases. Separate rejection, wrong result, timeout,
  missing input, and unsupported representation.

[ABC](https://deep-geometry.github.io/abc-dataset/) has a large STEP/B-rep
collection, but its site says model copyright belongs to the creators and
requires a separate source-rights review. The processing repository's MIT license should not be
assumed to license every model. The
[Fusion 360 Gallery dataset](https://github.com/AutodeskAILab/Fusion360GalleryDataset)
offers rich construction/assembly data under its
[custom non-commercial research license](https://github.com/AutodeskAILab/Fusion360GalleryDataset/blob/master/LICENSE.md),
including redistribution conditions. Neither corpus was downloaded wholesale
or represented as a permissively licensed Boolean regression suite.

These runners measure correctness and coverage, not throughput. They make no
CPU/GPU/native speed claims. Use the existing phase-separated
`scripts/benchmark.mjs` workflow for startup, warmed Bend/interop, frontend,
validation, and export performance before optimizing a measured bottleneck.
