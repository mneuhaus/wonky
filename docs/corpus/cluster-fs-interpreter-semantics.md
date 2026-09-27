# Cluster fs-interpreter-semantics: interpreter semantic gaps

Date: 2026-09-22/23. Input: cluster 3 of the corpus run
([run.md](run.md), `out/corpus/runs.jsonl`). 67 units, 58 unique files,
13 families, all `frontend`, all failing before the feature body runs.
Default JS path, CLI default policy (`strict`), at most 3 wonky processes.
The machine was shared with benchmark workflows. Load average was 73 to 140
on 18 cores (`uptime` at every start and end is in
`out/corpus/fs-interpreter-semantics/run-meta.jsonl`), so the times below
only show order of magnitude.

Re-checked on 2026-09-23 at 04:12. The interpreter files (`src/interpreter.mjs`,
`values.mjs`, `scalars.mjs`, `library.mjs`, `queries.mjs`) had not changed
since the first pass, and all six repros gave the same results with the
production CLI and with the prototype. The same pass added §4.4: the
next-blocker Booleans run through the bake-off route
(`scripts/corpus/fs-interpreter-semantics/next-bakeoff.mjs`). Load average
was 10 at the start of the re-check and 90 to 116 during the bake-off run.

## Answer in short

1. **The cluster has four causes. Three are wonky frontend gaps and one is a
   source error in Marc's files.** All four sit in the FeatureScript
   frontend: `src/interpreter.mjs`, `src/values.mjs`, `src/scalars.mjs` and
   `src/library.mjs`. None is in the kernel or the library's geometry.

   | cause | units | files | families | repro |
   |---|---:|---:|---:|---|
   | UI parameter defaults: `isLength(definition.x, LENGTH_BOUNDS)` gets no value (21); a boolean parameter without a `"Default"` annotation gets no `false` (15) | 36 | 36 | 2 | `length-bounds-default.fs`, `boolean-default.fs` |
   | Annotation maps evaluated as runtime expressions: `"Filter" : EntityType.BODY && BodyType.SOLID` | 16 | 7 | 4 | `annotation-filter-and.fs` |
   | Type tags wonky does not know: `as AngleBoundSpec` (9), `c is Color` (2) | 11 | 11 | 6 | `angle-bound-spec.fs`, `color-type-tag.fs` |
   | **Source error, wonky is right:** a unitless vector plus a length vector | 4 | 4 | 1 | `units-source-error.fs` |

   The repros are in
   [`fixtures/corpus-repro/fs-interpreter-semantics/`](../../fixtures/corpus-repro/fs-interpreter-semantics/README.md).
2. **The fix is one change: read the feature dialog the way Onshape does.**
   Evaluate only an annotation's `"Default"` entry. Give every parameter its
   std UI default: the bound-spec default, `false`, the first enum member,
   `""`. Represent the std bound specs and the `Color` type as tagged values.
   The fix is about 120 lines of frontend code, effort **S**, risk low. A
   prototype applies the fix in memory, without touching `src/`
   (`scripts/corpus/fs-interpreter-semantics/prototype/`). With it:
   - all 63 gap units get past their first blocker;
   - the 4 source-error units still fail, as they should;
   - the regression over 689 other units in 216 files changes nothing
     unintended (see §4.3);
   - the language, semantic-core and CLI test files pass.
3. **No file builds completely from this fix alone.** The next blockers are:
   - missing std builtins (41 units): `qGeometry` 24, `opSplitPart` 9,
     `toString` 4, `opTransform` 4;
   - Boolean capability (19 units): a round hole in a planar body that
     already carries cuts. 18 are through holes and 1 is a blind pilot bore.
     All 19 fail the hole admission because the planar arrangement leaves
     split coplanar faces and ranged line edges (subcause `pierce-admission`).
     The bake-off's recover route builds all five tested operand sets exactly
     (§4.4);
   - a UI selection only a Part Studio can supply (3 units);
   - for the source-error files, once corrected, the planar-face frame check
     (4 units).
4. **Behind that it gets deeper.** Marc's current Z-axis
   (`cad-project-040/src/z-axis.fs`, byte-identical to the fsocct case
   `sparky_z.fs`) and its 20 archived revisions go: this cluster, then
   `qGeometry`, then `opChamfer`/`opFillet` (not implemented in wonky), then
   three Part Studio imports. The lochwand family goes: this cluster, then the
   notched-plate hole, then a line/arc sketch refusal (topo-native) or a
   non-coaxial cylinder union (the job version, after 628 successful calls).
5. **Overlap.**
   - The language work's staging prototype (`src/lang/wk/stage-fs.mjs`)
     already implements nearly the same semantics, but outside production.
   - The semantic-core evaluator (`src/lang/semcore/`) mirrors the production
     interpreter and must change with it.
   - The bake-off, the native binding and the viewer do not touch this
     cluster itself. The bake-off's recover route does solve the Boolean that
     19 units hit next: it builds all five tested operand sets exactly,
     OCCT-valid, with a volume error of at most 3.2e-16 (§4.4). The
     production answer for 18 of the 19 is the boolean-capability cluster's
     "pierce v2". The blind pilot bore also needs a blind-pocket arm.

## 1. The cluster

`node scripts/corpus/fs-interpreter-semantics/units.mjs` recomputes the
cluster from `out/corpus/runs.jsonl` with the same normalization and cluster
rules as `summarize.mjs`: 67 units, 58 files, 13 families. That matches
`summary.json`.

| family | files | units | cause | example |
|---|---:|---:|---|---|
| fs560 project-component-1c8dacbe | 21 | 21 | `LENGTH_BOUNDS` default | `cad-project-040/archive/r1/snapshot/z-axis.fs:65:72` |
| fs233 project-component-9eb7ee7f lochwand | 15 | 15 | boolean default (`definition.returnView is boolean`) | `cad-project-020/lochwand/topo-native/source.fs:270:56` |
| fs16 alternate-chute SC15 | 4 | 12 | annotation `Filter` | `cad-project-002/sc15-adaptation/sc15.fs:281:51` |
| fs12 alternate-chute funnels | 1 | 1 | annotation `Filter` | `cad-project-002/sc15-adaptation/funnels.fs:52:57` |
| fs417 sorter r19 hatch | 1 | 1 | annotation `Filter` | `cad-project-039/r19-hatch.fs:129:63` |
| fs418 sorter r20 axle | 1 | 2 | annotation `Filter` | `cad-project-039/r20-axle.fs:70:47` |
| fs473, fs475, fs476 cad-project-041 gt2 | 8 | 8 | `as AngleBoundSpec` | `cad-project-041/archiv/gt2-linie/single-stage-gt2-r1/single-stage.fs:9:14` |
| fs555 mini camera | 1 | 1 | `as AngleBoundSpec` | `cad-project-043/fsocct/cases/workspace/mini_camera.fs:11:14` |
| fs161, fs554 lochwand R1/R2 | 2 | 2 | `c is Color` | `cad-project-043/fsocct/cases/workspace/lochwand.fs:103:13` |
| fs552 hopper corner inserts | 4 | 4 | source unit error | `cad-project-043/fsocct/cases/workspace/corner_ramp.fs:30:41` |

The unique files have 11 byte-identical copies elsewhere in the corpus. Some
of them are live sources:

- `cad-project-043/fsocct/cases/workspace/sparky_z.fs` = `cad-project-040/src/z-axis.fs`;
- `lochwand.fs` = `cad-project-020/lochwand/job/source.fs`;
- `mini_camera.fs` = `cad-project-041/archiv/gt2-linie/single-stage-gt2-mini-camera-r4/camera.fs`;
- `corner_ramp.fs` = `cad-project-039/hopper-corner-inserts-r3/inserts-r3.fs`.

A census over all 287 parseable unique FS files
(`param-forms.mjs` → `tmp/corpus/fs-interpreter-semantics/param-forms.json`)
shows how common the triggering forms are:

| precondition form | occurrences | files |
|---|---:|---:|
| `isLength(definition.x, LENGTH_BOUNDS)` without `"Default"` | 126 | 21 |
| `isLength(definition.x, <user LengthBoundSpec>)` | 247 | 60 |
| `definition.x is boolean` without `"Default"` | 85 | 44 |
| `definition.x is boolean` with `"Default"` | 33 | 24 |
| `definition.x is <enum>` (all have `"Default"`) | 17 | 9 |
| `definition.x is Query` (all with `"Filter"`, none with `"Default"`) | 32 | 7 |
| `isAngle(definition.x, <AngleBoundSpec>)` | 8 | 8 |
| `isInteger(definition.x, <IntegerBoundSpec>)` | 2 | 2 |
| `definition.x is string` | 2 | 1 |

Only 21 of the 44 files with a default-less boolean are in this cluster. The
other 23 have a different first blocker before the precondition runs:
Part Studio imports, a parse error, or an earlier-reported cause. They would
reach the boolean after that blocker is gone. The fix covers them too.

## 2. Root causes

### 2.1 Feature parameter defaults (36 units)

`Interpreter.run` (`src/interpreter.mjs:65`) calls `featureDefaults` (`:70`)
and passes the result as the definition map. `featureDefaults` knows two
sources of a default:

- the `"Default"` entry of an annotation (`:79-82`);
- `isLength(definition.x, bounds)`, but only when the bound spec evaluates to a
  `KeyedMap`, i.e. a literal `{ (millimeter) : [...] } as LengthBoundSpec`
  (`:83-86`).

The std constants are not bound specs in wonky. `src/library.mjs:94` binds
`LENGTH_BOUNDS: 'LENGTH_BOUNDS'` as a plain string, which the `isLength`
builtin special-cases (`:117-125`). So `definition.position` stays
`undefined`, and `length()` (`src/values.mjs:45`) fails with "Expected a
length with units". A `definition.flag is boolean` without a `"Default"`
annotation also stays `undefined`. `undefined is boolean` is `false`, so the
precondition statement fails (`src/interpreter.mjs:194`).

Onshape's feature dialog supplies every parameter:

- **Lengths and angles:** the bound spec's default. `valueBounds.fs`:
  `LENGTH_BOUNDS` is `{(meter): [-500, 0.025, 500], (millimeter): 25.0, ...}`,
  so 25 mm in a millimeter document. `ANGLE_360_BOUNDS` defaults to 30°.
- **Booleans:** `false`.
- **Enums:** the first member.
- **Strings:** `""`.
- **Query parameters:** an empty selection.

The std `defineFeature` documentation (`feature.fs`) says the defaults map
"does NOT control the user-visible default value when creating this feature.
To change the user-visible default for booleans, enums, and strings, use the
"Default" annotation. To change the user-visible default for a length,
angle, or number, see the `valueBounds` module."

Marc's files rely on these defaults. The z-axis declares ten parameters and no
`"Default"`. The lochwand declares `returnView` and `folded` without one.
fsocct's own frozen workspace case passes `returnView: "false"` explicitly
(`cad-project-043/fsocct/cases/workspace/manifest.json`), and implements the same std
defaults in `fsocct/runtime.py`.

With explicit `--param` values, production builds both repros today.

### 2.2 Annotation `Filter` expressions (16 units)

`featureDefaults` evaluates each annotation map as a whole
(`this.expression(annotation, ...)`, `src/interpreter.mjs:80`) just to read
its `"Default"`. The `"Filter"` entry is written in Onshape's query-filter
notation, for example `EntityType.BODY && BodyType.SOLID`. The std library
uses the same notation in its own dialogs, e.g. `extrude.fs`:
`"Filter" : (EntityType.FACE && GeometryType.PLANE && ConstructionObject.NO ...)`.
Annotations are static UI metadata in FeatureScript and are not evaluated at
regeneration. wonky evaluates the `&&`, `truth()` rejects the enum operand
(`src/values.mjs:41`), and the build stops with "FeatureScript conditions must
be boolean". This happens even for features whose body never reads the
parameter.

All 16 units belong to features that take a UI pick (`definition.x is Query`)
of an existing body. After the fix they still need that selection (§4).

### 2.3 Type tags (11 units)

`matchesType` and `cast` (`src/values.mjs:122-156`) know one tagged map type,
`LengthBoundSpec`. Every other type name falls through to `default: return
false`, then to `checkType`'s "Expected <type>".

- **`AngleBoundSpec`, 9 units.** `const TILT = { (degree) : [60, 65, 70] } as
  AngleBoundSpec;` fails at declaration. In the eight cad-project-041 files and
  `mini_camera.fs` the constant is declared at top level. The feature that
  uses it (`isAngle(definition.inclination, TILT)`) is behind it, and
  `isAngle` is not a wonky builtin either. `IntegerBoundSpec`, `RealBoundSpec`,
  `isInteger`, `isReal` and `unitless` are missing in the same way. Two files
  in the fs-missing-builtin cluster fail on exactly these (`isInteger`,
  `unitless`).
- **`Color`, 2 units.** `color()` (`src/scalars.mjs:59-62`) returns an
  untagged map, so a parameter typed `c is Color` rejects it. Onshape's
  `color()` returns `{...} as Color` (`properties.fs`, typecheck
  `canBeColor`).

### 2.4 `Incompatible units in expression` (4 units): a source error

The four hopper-corner-insert files write
`var q0=vector(77.1263837814323,-498.4724643754777,-184.5128995194368);` without
`* millimeter`, then `plane(q0+uphill*(-3)*millimeter, ...)`. That adds a
unitless vector to a length vector. FeatureScript rejects it too.

fsocct's frozen run records the same case as "Source unit error"
(`cad-project-043/fsocct/cases/workspace/results.json`, `corner_ramp-cornerInsertsR3`).
wonky's message is correct. `corner_ramp.fs` is a byte copy of the current
`cad-project-039/hopper-corner-inserts-r3/inserts-r3.fs`, so Marc's
live r3 source has the error. The fix belongs in the source (`vector(...) *
millimeter`), not in wonky. After that edit (stub run, §4) the four files reach
`opExtrude` and fail on "Plane frame is not orthonormal" (`src/brep.mjs:105`),
the kernel-sketch-and-ops cluster.

The triage classifier should move these units from "frontend gap" to "source
error".

## 3. Fix design

**Where.** Only the frontend: `src/interpreter.mjs`, `src/values.mjs`,
`src/scalars.mjs`, `src/library.mjs`, and one line in `src/queries.mjs`. The
kernel, the Bend code and the exports do not change.

**What and how.** The prototype
(`scripts/corpus/fs-interpreter-semantics/prototype/patches.mjs`) is an exact
edit list against the current `src/`. Each edit must match exactly once, or
loading fails. A production change can start from it.

1. **Feature parameter spec** (`Interpreter.featureDefaults`). Walk the
   precondition, including nested blocks and `if` branches. For each statement
   that constrains `definition.<key>`:
   - **Annotations:** evaluate only the `"Default"` entry's expression, found
     in the annotation map's AST fields, and never the whole map. `"Filter"`,
     `"UIHint"`, `"MaxNumberOfPicks"` and the rest stay unevaluated metadata.
   - **Bound specs:** for `isLength`/`isAngle`/`isInteger`/`isReal(definition.k,
     SPEC)`, the default is SPEC's default. wonky's document units are
     millimeter and degree, so the `(millimeter)`/`(degree)` entry wins when
     SPEC lists one. Otherwise the first `[min, default, max]` entry wins
     (valueBounds.fs: "The default value for a unit that is not listed is the
     default value of the first unit").
   - **Type-implied UI defaults** for parameters without the above:
     - `is boolean` → `false`;
     - `is string` → `""`;
     - `is <enum>` → the first member;
     - `is Query` → see decision (a).
   - **Precedence, weakest first:** type-implied defaults < `defineFeature`
     defaults map < annotation `"Default"` < bound-spec default < `--param`.
     The order of the last four is unchanged from today. r10b's definition map
     is identical before and after (checked: `edgeAngle` K15, `overrideNose`
     false, `noseLength` 0, `catchPitch` 4 mm, `catchHeight` 0.5 mm,
     `innerWallThickness` 3.2 mm).
2. **Bound specs as values** (`values.mjs` `matchesType`/`cast`, `scalars.mjs`):
   - `LengthBoundSpec`, `AngleBoundSpec`, `IntegerBoundSpec` and
     `RealBoundSpec` are tagged `KeyedMap`s. The cast checks std's
     `canBeBoundSpec`: each value is a per-unit default number or `[min,
     default, max]` with `min <= default <= max`, and the keys have the right
     quantity. `IntegerBoundSpec`/`RealBoundSpec` take one `(unitless)` entry.
   - The std constants become real specs with the std values: `LENGTH_BOUNDS`,
     `NONNEGATIVE_LENGTH_BOUNDS`, `NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS`,
     the three `*_ZERO_DEFAULT_*` length bounds, `ANGLE_360_BOUNDS` and
     variants, `POSITIVE_COUNT_BOUNDS`, `POSITIVE_REAL_BOUNDS`.
   - `lengthBoundRows` skips per-unit number entries.
   - `isAngle`, `isInteger` and `isReal` check the first `[min, default, max]`
     entry, like std `verifyBounds`. `unitless = 1`.
   - Keep wonky's `POSITIVE_LENGTH_BOUNDS` string alias. It is not in Onshape
     std and has no UI default, and `examples/box.fs`/`bracket.fs` take their
     value from the defaults map.
3. **Tagged plain maps** (`values.mjs`). A map can carry a non-enumerable type
   tag:
   - `color()` returns a `Color`-tagged map;
   - `is Color` checks the tag;
   - `as Color` runs std `canBeColor`;
   - `clone` keeps the tag.

   JSON export ignores the tag, so `appearance` in `brep.json` is unchanged.
4. **`qNothing()`** (`queries.mjs`): an empty query. It is a std function
   anyway.

**Decisions for Marc.**

- **(a) A `Query` parameter with no value.** The prototype passes an empty
  query, which is Onshape's behavior. The model's own check then reports the
  problem, e.g. r19-hatch's "Select original Skirt Part 1". Other features
  give misleading downstream errors instead: r20's `solidDriveAxle20` gets an
  `opBoolean` arity refusal, and `solidModularAxles20` gets "The feature
  produced no solid bodies".

  **Recommended for production:** an explicit error before the body runs,
  e.g. `UnsupportedFeatureError: feature parameter 'axles' is a UI selection
  (Query); supply it with --param or a Part Studio input`. An explicit
  `--param 'axles=qNothing()'` keeps the Onshape behavior available. This
  matches AGENTS.md's explicit-error rule and lands all 16 `Filter` units in
  fs-needs-partstudio-input, where they belong.
- **(b) The defaults map against implied defaults.** In the cad-project-041 gt2
  files, `defineFeature(..., {"hardware": true})` meets `definition.hardware is
  boolean` without `"Default"`. Onshape's dialog would insert `false`; the
  map applies only to FeatureScript calls. The prototype lets the map win,
  consistent with the language proposal (`proposal-core-ir.md` §2.4: std
  default < defaults map < annotation `"Default"`) and with how wonky's own
  examples use the map. If the CLI should mean "insert the feature as in
  Onshape", the map must lose instead. Nothing in the corpus depends on this
  except the gt2 `hardware` flag.
- **(c) Defaults are not Marc's values.** A build with UI defaults is the
  feature as first inserted, not Marc's Part Studio instance. For example,
  the z-axis `position` is 25 mm by default and 61.28756 mm in his Part
  Studio (`cad-project-040/archive/r7/source-before-r8/build.mjs`, and the
  r12 feature list). Reference comparisons must pass the instance's values
  with `--param`. `next-blocker.mjs` does this for fs560 (variant `fix+ps`).

**Tests** (`test/language.test.mjs`):

- each repro builds, with the expected volume (25 mm cube for
  `LENGTH_BOUNDS`) or the expected body;
- `units-source-error.fs` still fails with "Incompatible units";
- `--param` still wins;
- r10b's definition map is unchanged;
- an `AngleBoundSpec` out of range fails the precondition;
- `color()` passes `is Color`;
- the Query decision (a).

`src/lang/semcore/eval.mjs` and `desugar-fs.mjs` mirror `featureDefaults`
(desugar-fs.mjs says so in a comment). They must follow, or the core-IR
parity tests only cover the old behavior. That code belongs to the language
work.

**Effort: S.** The production delta is about 120 lines plus tests. The
prototype already covers the corpus. Mirroring the change in semcore is a
separate small task for the language work.

**Risk: low.**

- Measured: 689 units in 216 files that use the touched constructs changed
  only where intended (§4.3). The language, semantic-core and CLI test files
  pass with the prototype. The full `npm test` was not run with the prototype
  (shared CPU).
- Remaining risks:
  - Implied defaults could let a malformed feature run with values nobody
    chose. They are std-defined, documented UI defaults, not fallbacks, and
    Query parameters stay explicit under (a).
  - Member assignment on a `Color` map drops the tag. No corpus file does
    that.
  - The per-unit default depends on the document unit, fixed to mm/deg here.

## 4. First blocker and next blockers

Every one of the 67 units reports this cluster as its first blocker. For 55
files it is the first blocker of every unit. The other 3 files are
`sc15.fs`, `sc15-before-review-r1.fs` and `r2-before-edge-review-sc15.fs` in
`cad-project-002/sc15-adaptation/`. They also export
`loadSc15Bracket/Flap/Coupling`, whose first blocker is an unresolved Part
Studio import (cluster 1), and they count as primary in cluster 1 (a 3:3 tie
broken by cluster order).

`node scripts/corpus/fs-interpreter-semantics/next-blocker.mjs` re-runs every
unit through the production build entrypoint (`probe-params.mjs`, same
options as `scripts/corpus/probe.mjs`), in four variants:

- `current`: production as is. It reproduced all 67 recorded first blockers.
- `fix`: production plus the prototype, loaded in memory by a Node module
  hook.
- `fix+ps`: `fix` plus Marc's Part Studio parameter values for fs560.
- `stub`: `fix` on a copy under `tmp/corpus/` whose source error is
  corrected.

Results are in `out/corpus/fs-interpreter-semantics/next-blocker.jsonl`.
Everything ran on 159 jobs at concurrency 2, 4:55 min wall.

### 4.1 Next blocker after the fix

| next blocker | cluster | units | files | families | where |
|---|---|---:|---:|---:|---|
| `'qGeometry' is not defined` | fs-missing-builtin | 24 | 24 | 3 | fs560 z-axis (21, also with Part Studio values), fs475/fs476 gt2-r1 (3); `qGeometry(qOwnedByBody(q, EDGE), GeometryType.LINE)` selects edges for fillets and chamfers |
| opBoolean general trimmed-face (subcause `pierce-admission`, §4.4) | boolean-capability | 19 | 19 | 5 | lochwand fs233 (15), fs161, fs554: `holeCut0`, a round through hole in a panel with an exit notch, after 30 to 32 calls. gt2 mini-r1: a through hole in the retaining plate (`plateRetain-1/cut`, 22 calls). mini_camera: a **blind** pilot bore with a 1 mm floor (`clampPilot52/cut`, 30 calls) |
| `'opSplitPart' is not defined` | fs-missing-builtin | 9 | 5 | 2 | SC15 bracket/flap, funnels; applied to the picked body |
| `'toString' is not defined` | fs-missing-builtin | 4 | 4 | 1 | gt2 mini r2/r3 (`side~toString(upper)` in ids) |
| `'opTransform' is not defined` | fs-missing-builtin | 4 | 4 | 1 | SC15 coupling |
| UI selection missing | fs-needs-partstudio-input | 3 | 2 | 2 | r19-hatch ("Select original Skirt Part 1"), r20-axle (no bodies; arity refusal on the empty pick) |
| source error, then (after correcting it) `Plane frame is not orthonormal` | kernel-sketch-and-ops | 4 | 4 | 1 | hopper corner inserts, `opExtrude` after 7 to 25 calls |

Under decision (a) the 13 SC15/funnel units would stop at the missing UI
selection first. All 16 `Filter` units are features that modify bodies the
user picks. So they need Part Studio input (cluster 1 for the SC15 imports,
cluster 4) before `opSplitPart`/`opTransform` matter.

The minimal repro for the lochwand hole is
`fixtures/corpus-repro/fs-interpreter-semantics/next/lochwand-hole-in-notched-panel.fs`.
Production refuses `holeCut0`. The same hole in the panel without the notch
builds (7 faces, closed).

### 4.2 One level deeper (stubs in tmp copies)

`node scripts/corpus/fs-interpreter-semantics/stub-deeper.mjs` copies family
representatives to `tmp/corpus/fs-interpreter-semantics/stub-deeper/`,
replaces the construct that failed in the copy only, and runs them with the
prototype fix. Results are in `out/corpus/fs-interpreter-semantics/stub-deeper.jsonl`.

- **`qGeometry`** is replaced by an FS helper that keeps the edges `evLine`
  accepts. That is the same set as the `LINE` filter.
- **`toString`** is replaced by `"" ~ v`.
- **Lochwand:** `lwCut` deletes its tool and returns the target, so every
  subtraction is skipped. The geometry is then not Marc's; the run only shows
  what else blocks.

| file | family | then fails on | cluster |
|---|---|---|---|
| `sparky_z.fs` (= current `cad-project-040/src/z-axis.fs`), Part Studio values | fs560 | `'opChamfer' is not defined` (`productCorners`, 5 calls done) | fs-missing-builtin, but a kernel feature |
| `archive/r12/before-wagon-web-r13/z-axis-live.fs`, Part Studio values | fs560 | `'opFillet' is not defined` | same |
| gt2-r1 `single-stage.fs`, `fixed-rails-first-native.fs` | fs476, fs475 | `'opFillet' is not defined` | same |
| gt2 mini-r3 `pcb-final-checked.fs` | fs473 | opBoolean general trimmed-face in `pilot > bore > cut`, 30 calls | boolean-capability |
| lochwand `topo-native/source.fs`, cuts skipped | fs233 | `skSolve`: `Native line/arc sketch unsupported: SelfIntersectionOrTouch` (`lwRoundedPrism`), 44 calls | kernel-sketch-and-ops |
| `lochwand.fs` (= `lochwand/job/source.fs`), cuts skipped | fs554 | opBoolean union needs coaxial cylinders (`lwJoin`), after **628** calls | boolean-capability |

After the chamfers, the current z-axis also instantiates three Part Studios
without a guard (`Retained::build`, `Home::build`, `OriginalX::build`, lines
500 to 585), using `qEverything` and `qCompressed`. That is cluster 1 plus
two missing builtins. In the corpus, `opFillet` appears in 68 unique FS files
(22 families), `opChamfer` in 16 (8), `qGeometry` in 45 (12) and `toString`
in 12 (7).

### 4.3 Regression outside the cluster

`next-blocker.mjs --keys-file tmp/corpus/fs-interpreter-semantics/regression-keys.json --out regression`
re-ran, with the prototype fix, every other FS unit whose file contains a
precondition parameter, `color(`, a bound spec, `unitless`, `isAngle`,
`isInteger`, `isReal` or `qNothing`, plus all 7 successful units. That is 689
units in 216 files. Parse-failure clusters (fragments, parser syntax) were
excluded, because the parser does not change. Each first blocker was compared
with the recorded production result (message and line). Results are in
`out/corpus/fs-interpreter-semantics/regression.jsonl`.

**687 of 689 units are unchanged. The 2 changes are intended, and there were
no timeouts.** The run took 10 min at concurrency 2, load 39 to 99.

- All 7 successful units still build with the same body counts and volumes:
  5277.8757 and 2010.6193 mm³ for the r4 drive coupling and shaft copies,
  219.1261 mm³ for `top-clamp-washers-r29.fs`.
- `cad-project-039/belt-fixed-r30/experimental-belt-segments-r1/cad/unchanged-link-test-strip.fs`
  was blocked by `'isInteger' is not defined` (fs-missing-builtin). It now
  gets past it to `'qContainsPoint' is not defined` (`:14`).
- `cad-project-043/fsocct/cases/workspace/printed_joints.fs` was blocked by
  `'unitless' is not defined` (`:242`, in `{ (unitless) : [1, 1, 8] } as
  IntegerBoundSpec`). It now reaches `opLoft currently requires two coaxial
  circular profiles` (`:77`, kernel-sketch-and-ops).

These two units are in fs-missing-builtin, but their cause is bound-spec
semantics, so this fix closes them. That leaves fs-missing-builtin with 54 of
its 56 units.

### 4.4 The Boolean next blocker, through the bake-off route

All 19 Boolean next blockers are the same refusal. The probe
(`scripts/corpus/boolean-probe.mjs`, run with the prototype fix loaded)
classifies each as subcause `pierce-admission` with the flags
`ranged-line-edges` and `extra-perpendicular-faces`:

- The target is a planar body that went through earlier planar arrangement
  cuts or unions (22 to 32 faces, all planes).
- Its planes perpendicular to the tool axis arrive split into 2 to 8
  coplanar fragments each (6 to 16 perpendicular faces in all). The stepped
  bodies (gt2 mini-r1, mini_camera) also have a third such plane. The hole
  arm counts every face perpendicular to the tool axis and wants exactly 2
  (`kernel/pierce.bend` `decline()`).
- The arrangement also emits ranged line edges, which `src/boolean.mjs`
  keeps out of the hole arm.
- The refusal then surfaces as the generic "general trimmed-face booleans are
  not implemented" message.

This is the boolean-capability cluster's `pierce-admission` row "ranged line
edges from a planar union, plus coplanar cap fragments"
([cluster-boolean-capability.md](cluster-boolean-capability.md) §1, its
`unitedPlateHole` repro). It is not a new cause.

The geometry differs by family:

| family | units | operation | kind of hole |
|---|---:|---|---|
| lochwand fs233, fs161, fs554 | 17 | `holeCut0`, r 22 to 38 mm through a 6 mm panel with an exit notch | through |
| gt2 mini-r1 (fs473) | 1 | `plateRetain-1/cut`, r 1.7 mm through a 2.4 mm plate, tool 2.6 mm | through |
| mini_camera (fs555) | 1 | `clampPilot52/cut`, r 1.3 mm, 10.1 mm from y = 17 into a saddle whose floor is at y = 16 | **blind**, 1 mm floor |

"Pierce v2" from the boolean-capability analysis selects the two pierced faces
instead of counting all perpendicular faces, and accepts ranged edges. That
covers the 18 through holes. The blind pilot bore would then still be refused,
now with the explicit hole message (`src/boolean.mjs` code 6, "a blind pocket
needs a floor this operation does not build"). It needs a blind-pocket arm or
the general route.

Two minimal repros are in `fixtures/corpus-repro/fs-interpreter-semantics/next/`.
Both fail in production today, independent of this cluster:

- `lochwand-hole-in-notched-panel.fs` (through hole);
- `blind-pilot-in-stepped-body.fs` (blind pilot bore in a planar union).

**Bake-off route.** `node scripts/corpus/fs-interpreter-semantics/next-bakeoff.mjs --probe`
dumps the refused operands with the production probe. For the corpus copies,
the prototype fix is loaded in memory. The script then runs the operands
through the same all-Bend route as `scripts/corpus/boolean-bakeoff.mjs`:

1. `buildCase` with frozen `brep` leaves;
2. corefine, native cpu build, 1 thread;
3. recover, native cpu build;
4. the kernel validator and STEP export through `src/exporters.mjs`;
5. OpenCascade as the oracle, twice: `recover-step.py` checks the recovered
   STEP, and `occt-cut.py` cuts the two operand STEP files (written by
   wonky's serializer) to get the expected volume. For the two repros, the
   closed form agrees with the OCCT cut to 2e-16.

The bake-off binaries and outputs are only read. Results are in
`out/corpus/fs-interpreter-semantics/next-bakeoff.json`.

| case | target faces | corefine | recover | faces after | OCCT | volume rel. error |
|---|---:|---:|---:|---:|---|---:|
| notched-panel repro | 22 | 76 ms, 744 tris | 18 ms | 11 | valid | 0 |
| lochwand topo-native `gameA/holeCut0` | 32 | 71 ms, 1168 tris | 125 ms | 11 | valid | 2.5e-16 |
| mini_camera `clampPilot52/cut` (blind) | 22 | 15 ms, 204 tris | 12 ms | 12 | valid | -3.2e-16 |
| gt2 mini-r1 `plateRetain-1/cut` | 26 | 19 ms, 288 tris | 16 ms | 11 | valid | -1.5e-16 |
| blind-pilot repro | 26 | 97 ms, 208 tris | 14 ms | 12 | valid | 0 |

All five come out exact. Recover also merges the split coplanar cap fragments,
so the result has fewer faces than the target: 22 to 32 faces become 11 or
12. The times are native wall times under load 90 to 116, so they only show
order of magnitude.

The probes of fs161 (`lochwand/r2/source-before-debug.fs`) and fs554
(`cad-project-043/fsocct/cases/workspace/lochwand.fs`) give the same operands as the
notched-panel repro: a 22-face panel, a hole of r 22 mm, and cap fragments at
y = -6 and y = 0. They were not run through the bake-off separately.

The recover route is not in production. In production it would be the last
arm of `booleanInBend`, as the boolean-capability analysis proposes. The
lochwand family then goes on to its next refusals (§4.2): the line/arc sketch
refusal, or the non-coaxial cylinder union after 628 calls.

## 5. Overlap with work in flight

- **Language work.** `src/lang/wk/stage-fs.mjs` (the WK staging prototype)
  already has the same semantics:
  - `featureInputSpecs` gives std bound defaults (`LENGTH_BOUNDS` 0.025 m,
    `ANGLE_360_BOUNDS` 30°, counts 2, reals 1), `false` for booleans and a
    symbolic input for a `Query`;
  - `featureDefaults` wraps annotation evaluation in `try` ("an annotation
    the prototype cannot evaluate (e.g. "Filter" : EntityType.BODY &&
    BodyType.SOLID ...) only loses its Default");
  - `Color` and a few other tags are accepted structurally (`UNTAGGED`).

  `proposal-core-ir.md` §2.4 and the hard-cases table record this. None of it
  is on the production path (`bin/wonky.mjs` → `src/index.mjs` →
  `src/interpreter.mjs`).

  Two differences to reconcile:
  - stage-fs puts std-constant bound defaults *below* the defaults map. The
    prototype puts every bound-spec default above it, like production does
    today for literal specs.
  - stage-fs swallows every annotation error. The fix evaluates only
    `"Default"` and lets a failing `"Default"` fail loudly.

  `src/lang/semcore/` mirrors production and has the same bug; it must follow
  the fix.
- **Boolean bake-off.** This cluster is not a Boolean, so the bake-off does
  not change it. The Boolean that 19 units hit next is the boolean-capability
  cluster's `pierce-admission` subcause. Recover builds all five tested
  operand sets exactly (§4.4). The recover route is not in production.
  The two `next/` repros are the hand-off to the boolean-capability analyst.
  The blind pilot bore is outside that cluster's "pierce v2" plan.
- **Native binding.** No overlap. The interpreter is host JavaScript on every
  backend. `WONKY_BACKEND=native` replaces kernel entries only.
- **Viewer.** No overlap.

## 6. Reproduce

```sh
node scripts/corpus/fs-interpreter-semantics/units.mjs          # cluster units -> tmp/corpus/fs-interpreter-semantics/units.json, all-units.json
node scripts/corpus/fs-interpreter-semantics/param-forms.mjs    # precondition census -> tmp/.../param-forms.json
node bin/wonky.mjs fixtures/corpus-repro/fs-interpreter-semantics/<repro>.fs --check
node --import ./scripts/corpus/fs-interpreter-semantics/prototype/register.mjs bin/wonky.mjs fixtures/corpus-repro/fs-interpreter-semantics/<repro>.fs --check
node scripts/corpus/fs-interpreter-semantics/next-blocker.mjs [--concurrency 2]   # current/fix/fix+ps/stub, 159 jobs
node scripts/corpus/fs-interpreter-semantics/stub-deeper.mjs                        # second level, 7 representatives
node scripts/corpus/fs-interpreter-semantics/next-blocker.mjs --keys-file tmp/corpus/fs-interpreter-semantics/regression-keys.json --out regression
node scripts/corpus/fs-interpreter-semantics/next-bakeoff.mjs --probe               # §4.4: next-blocker Booleans through corefine + recover, OCCT oracle
NODE_OPTIONS="--import=$PWD/scripts/corpus/fs-interpreter-semantics/prototype/register.mjs" node --test --test-concurrency=1 test/language.test.mjs test/lang-semantic-core.test.mjs test/cli.test.mjs
```

The runners read `~/Workspace/cad` only. Copies go to `tmp/corpus/`.
`WONKY_BACKEND` must be unset.

## 7. Limitations

- The claims about Onshape behavior come from the std source in
  `tmp/lang/onshape-std` (`valueBounds.fs`, `properties.fs`, `feature.fs`,
  `query.fs`) and FsDoc wording. They were not checked live in Onshape. The
  enum-first-member and empty-string defaults are FsDoc statements; no corpus
  file depends on them, because every enum parameter in the corpus has a
  `"Default"`.
- "Next blocker" is the first one after the fix. §4.2 goes one level deeper
  for 7 representatives, with stubs that change the model. Nothing here says
  a file would build.
- The prototype is an in-memory patch, not the production change. Only the
  test files listed in §6 ran with it.
- The run times are not comparable to the corpus run's: the load average was
  73 to 140, against 15 to 23 then.
