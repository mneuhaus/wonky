# Corpus repros

Minimal inputs that reproduce the root causes found by the corpus run
([docs/corpus/run.md](../../docs/corpus/run.md)). Each file names the corpus
files it stands for. All were checked on 2026-09-22 with the production CLIs on
the default JS path; the observed output is listed below. These are inputs, not
tests: they document the behavior at the time of the check and need no change to stay valid.
The W1 frontend sweep (2026-09-23) changed the result of every parser,
semantics and pure-builtin row; the current results are in
[After W1](#after-w1-2026-09-23) below and in [docs/corpus/w1.md](../../docs/corpus/w1.md).

| File | Cluster | Observed before W1 (`node bin/wonky.mjs <file> --check`) |
|---|---|---|
| `string-function-keyword.fs` | fs-parser-syntax | `10:57: Expected '(', found '}'` (the string `"function"` is lexed as the keyword) |
| `try-block-statement.fs` | fs-parser-syntax | `10:20: Expected '(', found '{'` (`try silent { ... }` statement form) |
| `for-in-key-value.fs` | fs-parser-syntax | `10:19: Expected ';', found ','` (`for (var k, v in map)`) |
| `annotation-filter-and.fs` | fs-interpreter-semantics | `10:50: FeatureScript conditions must be boolean` (`"Filter" : EntityType.BODY && BodyType.SOLID`) |
| `feature-parameter-defaults.fs` | fs-interpreter-semantics | `12:9: Expected a length with units` (no default from `LENGTH_BOUNDS`; boolean parameters also get no `false` default) |
| `op-transform.fs` | fs-missing-builtin | `9:9: 'opTransform' is not defined or not implemented by this prototype` |
| `fs-missing-builtin/op-transform-pose.fs` | fs-missing-builtin | `24:9: 'opTransform' is not defined ...` (the corpus idiom `opTransform(toWorld(coordSystem(...)))` before a through-hole cut) |
| `fs-missing-builtin/std-queries.fs --feature robustEverything` | fs-missing-builtin | `23:19: 'makeRobustQuery' is not defined ...` |
| `fs-missing-builtin/std-queries.fs --feature containsPoint` | fs-missing-builtin | `34:19: 'qContainsPoint' is not defined ...` |
| `fs-missing-builtin/std-queries.fs --feature idFromString` | fs-missing-builtin | `43:28: 'makeId' is not defined ...` |
| `fs-missing-builtin/op-revolve.fs --feature sleeve` | fs-missing-builtin | `21:9: 'opRevolve' is not defined ...` |
| `fs-missing-builtin/op-revolve.fs --feature reliefCone` | fs-missing-builtin | `32:9: 'opRevolve' is not defined ...` (profile edge on the axis, which `kernel/revolve.bend` also refuses) |
| `fs-missing-builtin/pure-values.fs --feature atan2Angle` | fs-missing-builtin (checked 2026-09-23) | `24:17: 'atan2' is not defined ...` |
| `fs-missing-builtin/pure-values.fs --feature rotatedCopy` | fs-missing-builtin (checked 2026-09-23) | `38:33: 'rotationAround' is not defined ...` |
| `fs-missing-builtin/pure-values.fs --feature mirroredCopy` | fs-missing-builtin, later blocker (checked 2026-09-23) | `55:33: 'mirrorAcross' is not defined ...`; with the builtin, production `opPattern` refuses the reflection |
| `fs-missing-builtin/integer-bound.fs` (any `--feature`) | fs-missing-builtin (checked 2026-09-23) | `18:25: 'unitless' is not defined ...` (a top-level const, so it blocks every feature of the file) |
| `fs-missing-builtin/next-countersink-breakout.fs --feature countersink` | fs-missing-builtin, next blocker (checked 2026-09-23) | `57:9: opBoolean supports coaxial cylinder primitives, ... general trimmed-face booleans are not implemented` (the fs95 countersink breaks out through the bar end face; `--feature hole` builds, 1067.162397 mm³) |
| `fs-missing-builtin/next-pierced-web-step.fs --feature headPilot` | fs-missing-builtin, next blocker (checked 2026-09-23) | `56:9: opBoolean through holes need a tool axis perpendicular to exactly two faces of the target` (a blind pilot hole) |
| `fs-missing-builtin/next-pierced-web-step.fs --feature footHole --format step --out <prefix>` | fs-missing-builtin, after-next blocker (checked 2026-09-23) | builds (12 faces, 116252.854131 mm³), then `wonky: no .step written: STEP cylindrical parameter curves unresolved: InvalidSource`, exit 1 |
| `fs-module-import/part-studio-import.fs` | fs-module-import | `13:23: Unresolved Onshape module 'Parts': d9c8543f… at version 188904c7…. Supply its frozen source or B-rep snapshot.` (more repros, including a snapshot, in [`fs-module-import/`](fs-module-import/README.md)) |
| `fs-headerless-include/geometry-body.fs` | fs-headerless-include | `6:1: Expected 'FeatureScript', found 'function'` (a generator include fragment; `interface.fs`, the same text after the header, builds; more in [`fs-headerless-include/`](fs-headerless-include/README.md)) |
| `python-local-import/part.py` | py-imports | builds `6 faces · 1000 mm³` since the W5 runner (model directory on `sys.path`, 2026-09-23); before: `5: ModuleNotFoundError: No module named 'params'` (run: `node bin/wonky-python.mjs fixtures/corpus-repro/python-local-import/part.py --check --python tmp/corpus/uv-python`) |
| `py-api-surface/named-import.py` | py-api-surface | `9:10: build123d.Part is not implemented by the Python frontend` since the W5 name table (the import binds sentinels; the first use fails); before: `7:1: build123d.Compound …` at the import line |
| `py-api-surface/wildcard-annotation.py` | py-api-surface | builds `800 mm³` since the W5 name table (`from build123d import *` binds all 203 names; `-> Sketch` builds nothing); before: `11: NameError: name 'Sketch' is not defined` |
| `py-api-surface/submodule-import.py` | py-api-surface (side finding) | `8: NameError: name 'Box' is not defined` (the file's own bug) since the W5 name table registers the submodules; before: `6: ModuleNotFoundError: No module named 'build123d.exporters'` |
| `py-api-surface/next-box-chain.py` | py-api-surface, next blocker (checked 2026-09-23) | builds: `114 faces · 10869.511374 mm³ · closed topology`, about 34 s CPU; the solid has 11 faces (planar arrangement over-fragmentation behind `project-component-abeb2fd3.py` `tray()`; the bake-off `recover` route gives 11 faces) |

The `fs-missing-builtin/` files state in their header what each feature should
produce once the builtins exist. The expected values were checked with the
prototype harness `scripts/corpus/fs-missing-builtin/harness.mjs` (run with
`HARNESS_ROOT=$PWD`); see [the cluster report](../../docs/corpus/cluster-fs-missing-builtin.md).
`node scripts/corpus/fs-missing-builtin/verify-repros.mjs` re-checks every
`fs-missing-builtin` row of this table, plus the harness results, in one run.

`annotation-filter-and.fs` also declares a query parameter. The feature never
resolves it, so it builds. An unpicked query parameter is not resolved by this
feature; a feature that resolves one gets an explicit capability error (supply
it with --param, e.g. part=qNothing()), like its corpus originals (see the
fs-needs-partstudio-input cluster).

## After W1 (2026-09-23)

Same command, production CLI after the W1 frontend sweep (parser, interpreter
semantics, pure std builtins, std queries I, N-ary `opBoolean`). Rows not
listed here are unchanged.

| File | After W1 |
|---|---|
| `string-function-keyword.fs` | builds, 1 body, 1000 mm³ |
| `try-block-statement.fs` | builds, 1 body, 1000 mm³ |
| `for-in-key-value.fs` | builds, 2 bodies, 1000 mm³ and 8000 mm³ |
| `annotation-filter-and.fs` | builds, 1 body, 1000 mm³ (only the annotation's `Default` is evaluated) |
| `feature-parameter-defaults.fs` | builds, 1 body, 3500 mm³ (position 25 mm from `LENGTH_BOUNDS`, review = false) |
| `op-transform.fs`, `fs-missing-builtin/op-transform-pose.fs` | unchanged: `opTransform` is W6 |
| `fs-missing-builtin/std-queries.fs --feature robustEverything` | builds, 1 body, 1000 mm³ |
| `fs-missing-builtin/std-queries.fs --feature containsPoint` | builds, 1 body, the cube at x 0..10 (Bend point-in-solid classifier) |
| `fs-missing-builtin/std-queries.fs --feature idFromString` | builds, 1 body, 1000 mm³ |
| `fs-missing-builtin/op-revolve.fs` (both features) | unchanged: `opRevolve` is W6 |
| `fs-missing-builtin/pure-values.fs --feature atan2Angle` | builds, 1 body, 192 mm³ |
| `fs-missing-builtin/pure-values.fs --feature rotatedCopy` | builds, 2 bodies of 8 mm³; the copy spans x -2..0, y 5..7 |
| `fs-missing-builtin/pure-values.fs --feature mirroredCopy` | `54:9: Only proper rigid transforms are implemented` (production `opPattern` refuses the reflection) |
| `fs-missing-builtin/integer-bound.fs --feature integerBound` | builds, 2 mm³ (IntegerBoundSpec default 2) |
| `fs-missing-builtin/integer-bound.fs --feature plainBox` | builds, 1 mm³ |
| `fs-missing-builtin/next-*.fs` | unchanged |
| `fs-needs-partstudio-input/catch-without-binding.fs` | builds, 2 bodies of 1000 mm³ |
| `fs-headerless-include/next-string-minus.fs` | builds, 1 body, 1000 mm³ |
| `boolean-capability/nary-union.fs` (both features) | builds, 1 body, 15000 mm³ |
| `fs-interpreter-semantics/*.fs` | see [its README](fs-interpreter-semantics/README.md); `units-source-error.fs` still fails at 15:22 (source error) |

The cluster analysis for fs-interpreter-semantics added one repro per
sub-cause, plus two next-blocker repros (a through hole and a blind
pilot bore after earlier planar cuts), in
[`fs-interpreter-semantics/`](fs-interpreter-semantics/README.md).

The cluster analysis for boolean-invalid-topology (planar arrangement
refuses F32-built slanted or rotated prisms) has its repros, a minimal one
included, in
[`boolean-invalid-topology/`](boolean-invalid-topology/README.md).

The cluster analysis for kernel-sketch-and-ops (opLoft limits, collinear and
over-256-vertex profiles, F32 cap normals of far tilted extrusions, line/arc
sketches with holes) has its repros in
[`kernel-sketch-and-ops/`](kernel-sketch-and-ops/README.md).
