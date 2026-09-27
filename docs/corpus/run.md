# Corpus run: Marc's real CAD code through the production CLIs

Date: 2026-09-22, 23:26 to 23:38 local. Machine shared with benchmark
workflows: load average 15.4 to 23.5 on 18 cores during the run (`uptime` at
every start and end is in `out/corpus/run-meta.jsonl`). Node v22.23.1, Python
3.13.3 via `uv run`, repository HEAD `79bbfeec` plus the uncommitted working
tree of that moment. Default JS path (`WONKY_BACKEND` unset), CLI default
modeling policy (`strict`), at most 3 wonky processes at once.

Machine-readable results:

- `out/corpus/runs.jsonl`: one record per run unit, appended, resumable.
- `out/corpus/summary.json`: totals, clusters, successes, reference comparison.
- `out/corpus/targets.json`: the ordered run list, families, duplicates.
- `out/corpus/reference.json`: reference matching and measurements.

Scripts are in `scripts/corpus/` (see [Reproduce](#8-reproduce)).

## Answer in short

1. **One of 423 unique modeling files builds completely, and 7 of 1,279 run
   units build.** FeatureScript: 1 of 332 files, 7 of 1,188 feature units
   (3 of 131 families have at least one working feature). build123d: 0 of 91
   files. No run timed out and nothing crashed.
2. **The corpus is blocked before the kernel, not in it.** 71 % of units (913)
   stop with a frontend error and 21 % (268) with an explicit capability error.
   Only 7 % (91) reach a kernel error. The median unit fails after 0.93 s (p99
   1.5 s, max 5.9 s), so JS kernel speed is not what limits the corpus today.
   The r10b anchor is the exception at 58.7 s.
3. **The largest blocker is FeatureScript module imports (96 files, 38
   families).** 92 of those files import Part Studio bodies (`NS::build`) from
   Onshape documents. The frozen-snapshot mechanism supports that, but no
   snapshot exists for any corpus file. 4 files import Feature Studio code,
   which wonky cannot load at all.
4. **The next blocker is the Boolean (65 files, 17 families).** These units
   run 10 to 213 modeling calls, then `opBoolean` leaves the admitted paths:
   general trimmed-face Booleans, through-hole and arity limits. A further 24
   files (4 families) get `InvalidTopology` from the planar arrangement, the
   same failure class as the viewer audit's cad-project-012 shaft port.
5. **Cheap frontend gaps block many files.**
   - Feature parameter defaults, annotation `Filter` expressions and type tags:
     58 files.
   - Ten missing std builtins: 43 files. `opTransform` alone blocks 29
     units, including one file after 537 successful calls.
   - Parser gaps (`try silent { }`, `for (var k, v in m)`, the string
     `"function"`): 15 files.

   Repros are in [`fixtures/corpus-repro/`](../../fixtures/corpus-repro/README.md).
6. **Python is blocked at the door.** Imports fail in 49 of 91 files, because
   the runner uses `-I -S`: 17 are project-local modules and 32 are installed
   packages (numpy, pytest, cad_khana, ...). 40 of the other 42 files use
   build123d API outside the Box/Cylinder/Pos shim (`Compound`, `Part`, `Text`,
   `RectangleRounded`, sketches); 2 are argparse tools. No corpus file binds `result`, so even a
   complete API would need that convention or a different entry contract.
7. **Reference agreement: 2 of 7 successes have a matched reference, and both
   agree.** Both are simple cylinders (a drive shaft and a coupling
   reference). Volume and extents agree to 2e-16 relative and 0 mm, and the
   position to 3e-13 mm. The matched STEP files were exported with FreeCAD
   (OpenCascade 7.8), not Onshape. The other 5 successes have no matched
   reference. No agreement is claimed for them.

## 1. What ran

### Population

The inventory from [the language chapter](../language/corpus.md) was re-scanned
with the same scanners (`scripts/lang/scan-fs.mjs`, `scan-py.mjs`) into
`tmp/corpus/facts/`. The corpus had changed slightly since that scan:

| | inventory (`out/lang/corpus.json`) | this run |
|---|---:|---:|
| FS modeling files / unique / families | 457 / 329 / 129 | 460 / 332 / 131 |
| build123d modeling files / unique / families | 129 / 91 / 82 | 129 / 91 / 82 |

The three new FS files are `cad-project-041/single-step-r10/jobs/r10b/pass3/camera/r10b.fs`
and `cad-project-041/single-step-r20/fs/modules/{datums,probe}.fs`. Dedup (SHA-256)
and families (union-find over Jaccard ≥ 0.6 of token 5-shingles, most recently
modified member represents the family) follow the inventory unchanged.

### Run units and order

- **Units.** One unit per (file, exported feature). The FS CLI builds one
  feature per invocation, and 79 unique FS files declare more than one
  feature (up to 27). A file with exactly one declared feature gets an explicit
  `--feature`, because files that also export helper functions make the CLI
  refuse to pick. The first pass let the CLI pick. That affected 9 units,
  which were re-run with `--feature`. Python files are one unit each.
  Total: 1,188 FS units and 91 Python units.
- **Order.** Family representatives first (337 units), then the remaining
  unique files (942 units). Smaller files go first within each group.
- **Budgets.** 180 s per unit, and 480 s for known-heavy paths:
  - r10b/r20 cad-project-041;
  - fsocct cases;
  - the distributor interface studios;
  - cad-project-012 and lego-beam;
  - any file over 1,500 lines.

  `--retry-timeouts` re-runs timeouts with 2.5× the budget. It was not needed,
  because no unit came near its budget.
- **Anchor.** The frozen acceptance fixture `fixtures/r10b/r10b.fs`
  (`singleStepR10b`, with its frozen `modules.json`). It is reported separately
  and is not counted in the corpus totals.

### Invocation (recorded per unit in `invocation`)

| Case | Invocation | Why |
|---|---|---|
| FS file | `node bin/wonky.mjs <corpus path> --format step --out tmp/corpus/out/<slug>/model [--feature F]`, cwd = repo | The CLI reads only the file and an optional sibling `modules.json`, and writes only to `--out`. The corpus stays untouched. |
| FS Onshape document import (`NS::import(path: "<doc>/<ws>/<elem>" or "<elem>", version: "<mv>")`) | same | The only resolution path is a frozen `modules.json` (schema `wonky-onshape-inputs/1`) next to the file. It must be bound to the source SHA-256, with captured body snapshots. No corpus file has one: the one corpus `modules.json` (`single-step-r20/tools`) is a different schema, and no corpus copy of r10b is byte-identical to the frozen fixture. Imports therefore fail on first use, as the CLI intends. |
| FS local library import (`version: "local"`, fsocct convention) | same | No supported mechanism. |
| FS header-less include (`geometry-body.fs`, `*-include.fs`, `*.fragment.fs`) | same | These are spliced by generators into a headed twin, e.g. `machine-interface-r7/geometry-body.fs` into `interface-r7.fs`. The inventory classifies them as modeling files, but they cannot run standalone. |
| build123d file | `node bin/wonky-python.mjs tmp/corpus/src/<path> --python tmp/corpus/uv-python --timeout-ms <budget-15 s> --out tmp/corpus/out/<slug>/model`, cwd = `tmp/corpus/work/<slug>` | Model code can write next to `__file__` (output folders, exports). So each project's `.py` and small text data files (≤ 1 MiB) are mirrored to `tmp/corpus/src/` and run from there. `uv-python` is `exec uv run --no-project --quiet python "$@"`, so `python3` is never invoked directly. |
| build123d multi-file project | same, no working variant | The runner starts Python with `-I -S -B` (`src/python.mjs`). The script directory, `PYTHONPATH` and site-packages are excluded, so `from params import ...` fails. Files that do `sys.path.insert(0, Path(__file__).parent)` themselves can import local modules; 8 unique files do that. No CLI option adds a search path. Changing that is a production change and outside this run. |

**Failure probe.** The CLIs print only `file:line:col: message`. Every failure
is therefore re-run once through `scripts/corpus/probe.mjs`, which calls the
same production entrypoints with the same options (`src/index.mjs build`,
`src/python.mjs buildPython`). The probe records:

- the JS error class;
- the failing modeling call and its call chain, from the production
  source-map trace;
- the number of completed modeling calls;
- the source line;
- the Python traceback.

In all 1,272 failures the probe message matches the CLI message.

### Status vocabulary

- `ok`: exit code 0 and a `brep.json`.
- `frontend`: parse, import, unknown builtin, type/semantic errors, or a
  missing Part Studio input. A `regenError` in the model's own code before any
  modeling call counts as a missing Part Studio input.
- `capability`: an explicit `UnsupportedFeatureError`.
- `kernel`: `InvalidTopology`, sketch/profile validation, or a model check
  after geometry.
- `crash`: a JS `TypeError`/`RangeError`, a signal or an abort.
- `timeout`: the runner killed the process group.

Rules: `scripts/corpus/lib.mjs` `classify()`, refined in
`scripts/corpus/summarize.mjs` `normalize()`. A decorated re-throw
(`prism model/g0: <kernel message>`) is attributed to the failing modeling call
recorded by the trace.

## 2. Totals

| | FS | build123d | total |
|---|---:|---:|---:|
| unique files run | 332 | 91 | 423 |
| files fully ok | 1 | 0 | 1 |
| families run | 131 | 82 | 213 |
| families with a fully ok file | 1 | 0 | 1 |
| families with any ok unit | 3 | 0 | 3 |
| units run | 1,188 | 91 | 1,279 |
| units ok / frontend / capability / kernel | 7 / 862 / 228 / 91 | 0 / 51 / 40 / 0 | 7 / 913 / 268 / 91 |
| timeouts / crashes | 0 / 0 | 0 / 0 | 0 / 0 |

Wall time per unit, CLI only: p50 0.93 s, p90 1.09 s, p99 1.49 s, max 5.87 s.
The sum over all units is 16.1 min at concurrency 3 under load 15 to 23.
Probes are not included.

## 3. Failure clusters

Clusters are keyed by error kind, failing operation and normalized message
pattern (numbers, ids, quoted names and paths masked). They were merged after
reading examples.

- **files / families:** unique files and families with at least one unit in
  the cluster. Multi-feature files can appear in several clusters.
- **primary:** a partition. Each failed file counts once, under the cluster
  that holds most of its failing units. The primary counts add up to 422
  files.

| # | cluster | status | units | files | families | primary files / families |
|---:|---|---|---:|---:|---:|---:|
| 1 | FS module imports cannot be resolved | frontend | 274 | 96 | 38 | 89 / 37 |
| 2 | opBoolean outside the admitted paths | capability | 174 | 65 | 17 | 50 / 15 |
| 3 | Interpreter semantic gaps | frontend | 67 | 58 | 13 | 55 / 13 |
| 4 | Feature expects existing Part Studio parts | frontend | 51 | 51 | 27 | 49 / 25 |
| 5 | Python imports fail in the isolated runner | frontend | 49 | 49 | 43 | 49 / 43 |
| 6 | Sketch/profile validation and other op limits | capability 51, kernel 37 | 88 | 45 | 10 | 17 / 6 |
| 7 | Onshape std builtins not implemented | frontend | 56 | 43 | 19 | 25 / 15 |
| 8 | build123d API outside the Bend shim | capability | 40 | 40 | 39 | 40 / 39 |
| 9 | Header-less include fragments | frontend | 293 | 28 | 17 | 28 / 17 |
| 10 | Planar arrangement returns InvalidTopology | kernel 54, capability 3 | 57 | 24 | 4 | 2 / 2 |
| 11 | FS syntax the parser rejects | frontend | 120 | 15 | 12 | 15 / 12 |
| 12 | Other | frontend | 3 | 3 | 2 | 3 / 2 |

Each unit reports only its **first** blocker. Fixing one cluster reveals the
next blocker in those files. The table is therefore an ordering of work, not a
forecast of how many files would then build.

### 1. FS module imports (96 files, 38 families)

`Unresolved Onshape module 'Parts': d9c8543f… at version 188904c7…. Supply its
frozen source or B-rep snapshot.` Example: `cad-project-040/src/buildplate-r16-rear.fs:9:19`.

- **Part Studio bodies** (`NS::build`) account for 257 units in 92 files. Of
  these, 142 units import from another document (`doc/ws/elem`) and 115 from
  the same document (`elem`). The existing frozen-module path
  (`src/modules.mjs`) supports this, but it needs a capture from Onshape per
  source revision, like `fixtures/r10b/modules.json`.
- **Feature Studio code** (`NS::someFunction`) accounts for 17 units in 4
  files. One of them is an fsocct `version: "local"` path library. wonky has
  no code-import mechanism.

This cluster includes every r10b-family copy in the corpus. They are
byte-different from the frozen fixture, so the fixture manifest refuses them
by design (source SHA binding).

### 2. opBoolean outside the admitted paths (65 files, 17 families)

These are real modeling programs that fail late:

- `cad-project-039/r21-expanded-hopper.fs:50:5` completes 213 calls;
- the hopper family (fs421) completes 53 to 127 calls.

| message | units |
|---|---:|
| `opBoolean supports coaxial cylinder primitives, admitted planar arrangement unions/subtractions, plane/cylinder intersections with a convex tool and a round through hole in a planar body; general trimmed-face booleans are not implemented` | 133 |
| `opBoolean through holes need a tool axis perpendicular to exactly two faces of the target` | 23 |
| `opBoolean currently requires two tools for union/intersection, or one target and one tool for subtraction` | 13 |
| `opBoolean through hole must land in material; this axis misses the face it would pierce` | 5 |

Call chains show the helper layer from the language chapter, e.g.
`hybridHopper > cut@102:1`, `bore@80:260 > cut@63:2` and
`plate@173:48 > rrect@79:8 > join@62:5 > combine@22:82`. The 13 arity refusals
come from `unite` helpers that pass more than two tools in one `opBoolean`.

**Relation to the bake-off.** The `recover` prototype
([proto-recover.md](../proto-recover.md)) recovers exact B-reps from robust
mesh Booleans for most planar and cylindrical cases. The through-hole and
general planar/cylinder cases here are in its declared scope, but it is not in
production. This run makes no claim about which of these units it would
build.

### 3. Interpreter semantic gaps (58 files, 13 families)

- **Feature parameter defaults (36 units).** `isLength(definition.x,
  LENGTH_BOUNDS)` gets no default (`Expected a length with units`), and
  `definition.flag is boolean` gets no `false` (`Feature precondition
  failed`). Examples: `cad-project-040/archive/r*/snapshot/z-axis.fs`,
  `cad-project-020/lochwand/topo-native/source.fs:270`.
- **Annotation `Filter` expressions (16 units).** `"Filter" : EntityType.BODY
  && BodyType.SOLID` is evaluated as a boolean condition. Example:
  `cad-project-039/r20-axle.fs:70:47`. These features also take a UI
  query pick.
- **Type tags (11 units).** `as AngleBoundSpec` (9) and `Color` values (2).
- **Units (4 units).** `Incompatible units in expression`, in the fsocct
  `corner_ramp` cases. Not diagnosed; this may be a genuine source error.

### 4. Feature expects existing Part Studio parts (51 files, 27 families)

The model's own check throws before any geometry, for example:

- `Derive exactly one unchanged R25 178-mm side into a NEW Part Studio first`;
- `Use a copy of R30 top plate`;
- `Expected exactly the declared current TOP source body; matching count=0`.

These features modify parts that already exist in an Onshape Part Studio.
They are not standalone models. They need either a Part Studio snapshot input,
like cluster 1, or they belong outside the build-from-source ladder.

### 5. Python imports in the isolated runner (49 files, 43 families)

`-I -S` removes both the script directory and site-packages.

| type | modules |
|---|---|
| project-local, 17 units | `params` ×5, `hardware_refs` ×5, `project-component-32f60153` ×3, `case`, `bar`, `family`, `lego_test_helpers` |
| installed, 32 units | `numpy` ×18, `pytest` ×6, `cad_khana` ×5, `bd_warehouse` ×2, `trimesh` |

`cad_khana` is Marc's own wrapper (corpus project `cad-khana/`). Local means
the module exists as `.py` or as a package in the same project.

### 6. Sketch/profile validation and other operation limits (45 files, 10 families)

| blocker | units |
|---|---:|
| `opLoft currently requires two coaxial circular profiles` | 49 |
| `Profile has collinear or nearly collinear consecutive edges` (skPolyline) | 15 |
| `A profile must have 3–256 vertices` | 12 |
| `Face vertices do not lie on the analytic plane` (opExtrude) | 7 |
| `Plane frame is not orthonormal` (opExtrude) | 3 |
| `A line/arc sketch cannot mix entities with rectangle, polyline or circle profiles` | 2 |

The collinear-edge refusals come through decorated re-throws, e.g. `prism
model/g0: …` in `r10b.fs#r10bSideDrive`, with the chain `buildSideDrive@378:116
> yz@354:8 > prism@44:9`. Onshape accepts these profiles, so each refusal is
either a tolerance question or a real kernel gap. That needs one look per
case.

### 7. Onshape std builtins not implemented (43 files, 19 families)

| builtin | units |
|---|---:|
| `opTransform` | 29 |
| `makeId` | 6 |
| `qContainsPoint` | 5 |
| `makeRobustQuery` | 5 |
| `qEverything` | 4 |
| `opRevolve` | 2 |
| `atan2` | 2 |
| `isInteger`, `skText`, `unitless` | 1 each |

`cad-project-043/fsocct/cases/workspace/hot_wire.fs:54:3` completes 537 modeling calls
before `opTransform` stops it.

### 8. build123d API outside the shim (40 files, 39 families)

| API | units |
|---|---:|
| `Compound` | 11 |
| `Part` | 8 |
| `Text` | 4 |
| `RectangleRounded` | 4 |
| `Sketch` (wildcard `NameError`) | 3 |
| `import_step` | 2 |
| `GeomType` | 2 |
| `FontStyle` | 2 |
| `Color` | 2 |
| `Solid`, `import_brep` | 1 each |

This confirms the known cad-project-025 failure (`beam_frame.py:30`:
`build123d.Part is not implemented`). Six files reach an unexported wildcard
name. They fail as a Python `NameError` rather than as a capability error,
because `from build123d import *` binds only the shim's names.

### 9. Header-less include fragments (28 files, 17 families)

`Expected 'FeatureScript', found 'function' | 'const' | 'annotation' | 'export'`.
These fragments come from generators and are spliced into a headed twin. They
are not runnable inputs, and 293 feature units come from their feature lists.
The inventory classifier should move them to the fragment role, and they
should leave the ladder.

### 10. Planar arrangement InvalidTopology (24 files, 4 families)

| message | units |
|---|---:|
| `Native planar arrangement union unresolved: InvalidTopology (stage 1, detail 0)` | 30 |
| `Native planar arrangement subtraction unresolved: InvalidTopology (stage 1, detail 0)` | 24 |
| `UnsupportedArrangement` | 3 |

Examples:

- `interface-r3.fs#bottomSpoke`, via `unite@162:4`;
- `project-component-4c7a33fe.fs#project-component-4c7a33fe`, via `build@171:18 > body@153:2 > cut@44:2`;
- `pass3/camera/r10b.fs#r10bTransferEdge`, via
  `buildTransferEdge@1364:3 > cut@1282:4`.

This is the cad-project-012 shaft signature from the viewer audit. The cad-project-012
project itself is Fusion (`fusion_khana`) code and is outside the FS/build123d
population. These planar cases are the ones the bake-off `recover` route
targets.

### 11. FS syntax the parser rejects (15 files, 12 families)

| syntax | units | notes |
|---|---:|---|
| the string `"function"` lexed as the keyword | 79 | 3 files; `declarePurpose(context, {"kind": "function", ...})` in the bottom-drive family |
| `try silent { ... }` / `try { ... }` statements | 36 | 7 files |
| `for (var k, v in map)` | 4 | 4 files |
| `\u` string escape | 1 | 1 file |

Parser gaps are cheap to close. The repros are the first four files in
`fixtures/corpus-repro/`.

### 12. Other (3 files)

- `native-helpers.fs` exports no feature (library only).
- Two `style_tile.py` scripts are argparse CLIs (`SystemExit: 2`), not models.

## 4. Successes and reference comparison

| unit | bodies | faces / edges | volume mm³ | bbox mm | reference |
|---|---:|---:|---:|---|---|
| `…/top-full-module-r4/module-r4.fs#driveShaftReferenceR4` | 1 | 3 / 3 | 2010.6193 | (141.2,−4,711.3)–(149.2,4,751.3) | **agree** |
| `…/top-full-module-r4/module-r4.fs#driveCouplingReferenceR4` | 1 | 4 / 6 | 5277.8757 | (135.2,−10,700.1)–(155.2,10,720.1) | **agree** |
| `…/native/module-r4-upload.fs#driveShaftReferenceR4` | 1 | 3 / 3 | 2010.6193 | same as above | no reference (score 7.5 < 9) |
| `…/native/module-r4-upload.fs#driveCouplingReferenceR4` | 1 | 4 / 6 | 5277.8757 | same as above | no reference (score 7.5 < 9) |
| `…/pre-retention-static/module-r4.fs#driveShaftReferenceR4` | 1 | 3 / 3 | 2010.6193 | same as above | no reference (score 6.5 < 9) |
| `…/pre-retention-static/module-r4.fs#driveCouplingReferenceR4` | 1 | 4 / 6 | 5277.8757 | same as above | no reference (score 6.5 < 9) |
| `cad-project-039/belt-fixed-r29/top-clearance-r29/top-clamp-washers-r29.fs` | 4 | 16 / 24 | 219.1261 | (−74,−175.88,678.0)–(74,−150.88,679.0) | no reference |

> **Verifikation (2026-09-23), see [§9](#9-verifikation-independent-re-check-2026-09-23):** `top-clamp-washers-r29.fs` does have a matching Onshape reference that the name matcher missed (`native/washers-native.step`, built by Onshape from the byte-identical source). It agrees. So 3 of 7 successes have a matched reference, one of them from Onshape.

The only fully successful file is `top-clamp-washers-r29.fs`. The others are
single working features of files whose remaining features fail.

**Matching** (`scripts/corpus/reference.mjs`). Candidates are all
`.step`/`.stp`/`.stl` files in the unit's project. Names are the source stem,
the feature name and the body names, compared as lowercase alphanumerics.

| component | score |
|---|---:|
| exact name equality | 10 |
| name containment (both sides ≥ 5 characters) | 6 |
| reference in or below the source directory | +3 |
| reference elsewhere under the parent directory | +1 |
| STEP reference | +0.5 |

A match needs a score of 9 or more. Ties go to the nearest path. The two
accepted matches are `top-full-module-r4/local/driveShaftReference.step` and
`driveCouplingReference.step`. Their names contain `driveShaftReference`, and
they sit below the source directory. The three copies in sibling directories
score below the threshold. They produce identical numbers, but they are not
counted as agreeing.

**Measurement.** `scripts/corpus/measure.py` runs through `uv run` with
`cadquery-ocp==8.0.1.0.0`, the same pin as `scripts/validate-step.py`. It
measures the reference and wonky's own exported STEP the same way: summed
solid volume (`BRepGProp`), optimal bbox (`BRepBndLib.AddOptimal`), and unique
face and edge counts. STL references are parsed in pure Python (signed volume,
vertex bbox). OpenCascade is only an oracle here.

**Tolerance.**

| reference | volume (relative) | bbox extents | position |
|---|---:|---:|---:|
| STEP | 0.1 % | 0.05 mm | 0.05 mm |
| STL | 1 % | 0.2 mm | 0.2 mm |

A result that matches size and volume but sits at a different position would
be reported as `agree-shifted`. None occurred.

| unit | ΔV rel | Δextent | Δposition | faces/edges wonky vs ref |
|---|---:|---:|---:|---|
| `driveShaftReferenceR4` | 0 | 0 mm | 2.3e-13 mm | 3/3 vs 3/3 |
| `driveCouplingReferenceR4` | 1.7e-16 | 0 mm | 3.4e-13 mm | 4/6 vs 4/6 |

Provenance: the reference STEP headers name FreeCAD and the Open CASCADE STEP
processor 7.8, dated 2026-09-13, from that project's native-port tooling. They
are independent of wonky, but they are not Onshape exports.

## 5. Anchor: frozen r10b

`node bin/wonky.mjs fixtures/r10b/r10b.fs --format step --out … --feature singleStepR10b`
fails after 58.7 s and 11 completed modeling calls:

```
fixtures/r10b/r10b.fs:25:2: Native curved convex-tool intersection unresolved: UnsupportedArrangement (tool 1, face 2)
  opBoolean model/UpperCore/g2/op via buildUpperCore@1408:1 > intersect@217:8 > combine@33:87
```

This matches the status document. The default `strict` policy refuses the
P10 contact at `g2`. The acceptance run used `--curved-contacts
tolerated-regularized --contact-cap-mm 1e-7` and reached `g10`. The corpus run
keeps the CLI default and did not repeat the acceptance mode.

## 6. Known failures, cross-checked

| audit finding | this run |
|---|---|
| cad-project-025, Python: `build123d.Part` | confirmed (`beam_frame.py:30`, cluster 8) |
| cad-project-012 hex shaft union: `InvalidTopology` | the corpus project is Fusion code and not in the population. The same signature blocks 24 FS files (cluster 10). |
| multi-file Python fails under `-I -S` | confirmed: 17 local-module units, plus 32 installed-package units (cluster 5) |
| JS target slow | holds for r10b (58.7 s). Corpus units fail before heavy Boolean work (p99 1.5 s), so speed is not the first blocker for the corpus. |

## 7. Limitations

- **First blocker only.** Clusters 1, 3, 4, 7, 9 and 11 hide whatever the
  kernel would do next. The `nearest` list in `summary.json` shows the 20
  units that got furthest; the top ones completed 537, 213 and 127 modeling
  calls.
- **Heuristic classifier.** Two rules are heuristics:
  - a user throw before any modeling call is read as a missing Part Studio
    input;
  - kernel-validation messages are recognized by text.

  Each record keeps the raw class, message, source line and trace, so it can
  be re-classified without re-running (`summarize.mjs`).
- **Family blocking is "at least one unique file".** Representative-only
  counts are in `summary.json` (`representativeFamilies`).
- **Mirror scope.** The Python mirror copies only the unit's own project.
  Cross-project path tricks (e.g. `core_geometry.py` → `cad-project-043/skills`)
  would not resolve. No run got that far.
- **Probe cost.** Every failure runs twice (CLI + probe). Both passes are fast
  here, except the anchor.

## 8. Reproduce

```sh
node scripts/corpus/targets.mjs            # re-scan into tmp/corpus/facts (--rescan) and write out/corpus/targets.json
node scripts/corpus/run.mjs                # resumable; appends to out/corpus/runs.jsonl; max 3 processes
node scripts/corpus/run.mjs --phase 0      # r10b anchor
node scripts/corpus/run.mjs --retry-timeouts
node scripts/corpus/reference.mjs          # match + measure references (uv run scripts/corpus/measure.py)
node scripts/corpus/summarize.mjs          # out/corpus/summary.json
```

Other options: `--phase 1|2`, `--only <substring>`, `--keys-file <file>`,
`--rerun`, `--limit N`. The runner refuses to start with `WONKY_BACKEND` set.

## 9. Verifikation (independent re-check, 2026-09-23)

An independent verifier re-ran the claims in fresh processes. The numbers
above are unchanged. Corrections are listed here and linked from §4. The
German summary is in [corpus-triage.md §7](../corpus-triage.md).

**Setup.** `node scripts/corpus/verify/verify.mjs` (repro table:
`scripts/corpus/verify/repros.mjs`). Production CLIs, default JS path
(`WONKY_BACKEND` unset), at most 3 wonky processes, per-file timeout (the
unit's budget, 300 s per repro). Run 2026-09-23 05:11 to 05:12, HEAD
`79bbfeec` plus working tree, load 16.6 / 18.0 / 20.5 (`uptime` at start and
end in `out/corpus/verify/meta.jsonl`). Results:
`out/corpus/verify/results.jsonl`.

| checked | count | result |
|---|---:|---|
| corpus units, stratified (all 7 successes, the 3 furthest failures, 2–4 per cluster with distinct patterns, representative and not, `cad-project-025/beam_frame.py`, the r10b anchor; 8 Python) | 45 | all 45 same exit code and same message incl. line:col; successes same bodies/faces/edges and bit-identical volume; no source SHA changed; Python mirrors identical |
| anchor `fixtures/r10b/r10b.fs#singleStepR10b` | 1 | same `UpperCore/g2` `UnsupportedArrangement (tool 1, face 2)`, 58.0 s (run: 58.7 s) |
| documented repro invocations under `fixtures/corpus-repro/` | 99 | all 99 as documented (64 cluster, 25 next-blocker, 10 controls); every cluster repro hits a message pattern of its cluster (two differ only in text: `modify-existing-part.fs`, `local-path/main.fs`) |
| OCCT validity of the fresh success exports (`uv run scripts/validate-step.py`) | 7 | all valid, volume equals kernel volume (`out/corpus/verify/validate-successes.json`) |
| OCCT validity of the bake-off hybrid STEPs (`tmp/corpus/boolean-capability/hybrid-all{,-linearc}-step`) | 10 | all valid (`out/corpus/verify/validate-hybrid.json`) |

No timeouts exist in the run (max corpus unit 5.9 s), so that stratum is
empty. No record has a JS `TypeError`/`RangeError` class, and every probe
message matches its CLI message.

**Corrections.**

1. **`top-clamp-washers-r29.fs` has an Onshape reference, and it agrees.**
   §4 says "no reference" and "not Onshape exports". Wrong for this file:
   `belt-fixed-r29/top-clearance-r29/native/washers-native.step` has
   `originating_system 'ONSHAPE BY PTC INC, 1.220'` and the same body names,
   and `native/washers-state.json` records `builtHash` = `uploadedHash` =
   SHA-256 of the corpus file. Measured with `scripts/corpus/measure.py`
   (`out/corpus/verify/washer-reference.json`): 4 solids, 16 faces, 24 edges
   on both sides, ΔV 2.6e-16 relative, Δbbox ≤ 1e-7 mm. So 3 of 7 successes
   have a matched reference, all agree, and fs365 agrees with Onshape.
   `reference.mjs` matches names only and misses the
   `native/<stem>-native.step` + `<stem>-state.json` (`builtHash`) convention.
2. **More Onshape references exist.** `node scripts/corpus/verify/onshape-built-index.mjs`
   finds 34 Onshape build states whose `builtHash` equals a corpus file; 18
   units have an Onshape STEP next to it (`out/corpus/verify/onshape-built-index.json`).
   `top-m5x25-reference-r30.fs`, built only through the bake-off hybrid,
   agrees with `top-clearance-r30/native/m5x25-native.step`: 11/23
   faces/edges, ΔV 8.3e-8 (F32 operands) and 1.1e-14 (simulated F32x2).
   fs289 and fs332 have Onshape builds of the identical source with Onshape
   volume and bounds per body (`belt-fixed-r29/native/wall-*.json`,
   `hardware-*.json`), but no STEP.
3. **fs361 needs F32x2 for a valid STEP.** On the hybrid route alone,
   `dual-hardware-r25.fs` builds 37 bodies but STEP export refuses
   (`InvalidSource`); the OCCT-valid STEP (37 solids, 6273.66 mm³) exists only
   with simulated F32x2. `direct-mount-r26.fs` (fs273) exports valid STEP
   without it.
4. **No built unit is an FDM part.** The 7 production successes are
   purchased-hardware reference bodies (M5 washers, OD8 steel shaft, coupling;
   `METAL_REFERENCE`). The hybrid-built units are screws, washers and nuts,
   plus 5 idler spacers in `dual-hardware-r25.fs`.
5. **Family ≠ part.** fs365 groups 14 files: 13 different TOP-clearance parts
   and, as representative, `native-helpers.fs`, a library without a feature
   (cluster 12). "1 family with a fully ok file" is 1 of those 13 parts.
6. **"kernel" is a label, not an error class.** The 54 `InvalidTopology`
   units are raised as `UnsupportedFeatureError` (explicit refusal of the
   planar arrangement admission). By error class the kernel share would be 37
   units (2.9 %), not 91 (7 %). Clusters are unaffected.

**Not re-checked:** the bake-off counts (722/769 Booleans, 6 units to the
end), the cluster prototype harnesses and the backlog greedy.

**False successes:** none found.
