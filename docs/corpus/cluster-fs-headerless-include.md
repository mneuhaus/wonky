# Cluster fs-headerless-include: header-less include fragments

Date: 2026-09-22, 23:48 to 23:58 local. Repository HEAD `79bbfeec` plus the
uncommitted working tree of that moment. Default JS path (`WONKY_BACKEND`
unset), CLI default policy `strict`, at most 2 wonky processes of mine at once.
The machine was shared with benchmark and bake-off runs. Load averages ran
from 64.8 at the start to 140 at the end (`uptime` is recorded in
`out/corpus/fragments.json` `meta`). Wall times below are therefore inflated.

Re-verified 2026-09-23, 04:11 to 04:15 local (load average 10.0 to 21.5 on
18 cores). No production file that the FS path uses changed after the corpus
run: `src/parser.mjs` dates from 2026-09-21, `src/index.mjs` from 2026-09-22
22:18, and only `src/python.mjs` and `bin/wonky-view.mjs` are newer than
`out/corpus/runs.jsonl`. Every cited line number still holds. The four repros
and five next-blocker spot checks (the `hopper_v2` stub, the `endstop-r11`
stub, the generated superseded r11 `stopHammer`, the generated r20 `datums`
and `r10bRetainedContext` from the frozen fixture) give the same messages as
recorded in `out/corpus/fragments.json`. The cluster membership recomputed
from `runs.jsonl` is unchanged: 293 units, 28 files, 17 families.

Inputs: [run.md](run.md), `out/corpus/runs.jsonl`, `out/corpus/targets.json`,
`tmp/corpus/facts/fs-facts.json`. Output: `out/corpus/fragments.json`.

## Answer in short

1. **This is not a wonky bug.** `src/parser.mjs` refuses a file without the
   `FeatureScript <version>;` header, and so does Onshape. These 28 files are
   pieces that a generator splices into a headed Feature Studio, or that Marc
   pasted into one. The cluster exists because the corpus inventory counts
   header-less files that declare a feature as modeling files.
2. **Most of the 293 units are double counts.** 23 of the 28 files (287
   units) have a headed twin that is already in the run population:
   - 19 twins contain the fragment verbatim;
   - 4 twins contain an edited version.

   The twin already runs every one of the fragment's features. The other 5
   files (6 units) hold design content that no population file has:
   - `endstop-r11.fs` is a superseded endstop;
   - the single-step-r20 `datums` and `probe` modules exist only as sources,
     because the corpus holds no built studios;
   - `hopper_v2.fs` and `hopper_v21.fs` are Feature Studio paste-ins.
3. **The fix belongs in the inventory and the harness, not in the CLI.** One
   classifier line decides this (`scripts/lang/fs-analyze.mjs:135`). The run
   list needs a header filter (`scripts/corpus/targets.mjs:78`), and the
   summary should report the twin coverage. Effort S, risk low. The
   denominators shrink:

   | | before | after |
   |---|---:|---:|
   | FS files | 332 | 304 |
   | FS families | 131 | 115 |
   | FS units | 1,188 | 895 |
   | all units | 1,279 | 986 |

   No design leaves the ladder, because the twins stay in it.
4. **This cluster is the first blocker for all 28 files.** `build()` parses
   before it does anything else. With the header in place, the units hit the
   blockers of other clusters (see [section 4](#4-what-the-files-hit-next)):
   Part Studio imports 90, opBoolean capability 93, InvalidTopology 43,
   sketch and loft limits 45, missing builtins 15, parser syntax 4, Part
   Studio input 2. One unit builds: `r10bRetainedContext`, from the frozen
   fixture with its frozen `modules.json`.
5. **No overlap with in-flight work removes this cluster.**
   - The bake-off does not change it, because it is not a Boolean. 136 of the
     293 units hit a Boolean next, and those are in the bake-off's domain.
   - The native binding does not change it. The parse runs before any kernel
     is loaded; verified with `WONKY_BACKEND=native`.
   - The viewer rework does not change it.
   - The language inventory owns the classifier line, and its coverage table
     counts these files as parser rejects too
     ([language.md](../language.md), "Fragmente").

## 1. Minimal repro

`fixtures/corpus-repro/fs-headerless-include/`, independent of the corpus
([README](../../fixtures/corpus-repro/fs-headerless-include/README.md)):

| file | `node bin/wonky.mjs <file> --check` |
|---|---|
| `geometry-body.fs`: helper function + feature, no header | `6:1: Expected 'FeatureScript', found 'function'`, exit 1 |
| `interface.fs`: the two header lines + `geometry-body.fs`, byte for byte (the `generate_fs.py` / `build_parts.py` rule) | `model/slab: 8 vertices · 12 edges · 6 faces · 600 mm³ · closed topology`, exit 0 |
| `paste-in.fs`: a complete std-only feature without header | `5:1: Expected 'FeatureScript', found 'annotation'`, exit 1 |

The same fragment builds once the generator's header precedes it. The refusal
is the only thing that differs.

## 2. Root cause

**Frontend (correct behavior).** `src/index.mjs:13` `build()` calls
`parse(source)` first. `Parser.program()` (`src/parser.mjs:88-89`) starts with
`this.expect('FeatureScript')`, so a file whose first token is `function`,
`const`, `annotation` or `export` fails at that token. An Onshape Feature
Studio always carries the header, and AGENTS.md requires unmodified Onshape
FeatureScript input. Inventing a header in the CLI would be a silent
fallback.

**Inventory (the actual cause).** `scripts/lang/fs-analyze.mjs:135`:

```js
const role = featureRoots.length ? 'feature' : evalRoots.length ? 'eval' : !ast.header ? 'fragment' : 'library';
```

The header check only runs when a file declares no feature. The tolerant
analysis parser (`scripts/lang/fs-parse.mjs`) accepts header-less files, so a
header-less file with an `export const X = defineFeature(...)` gets role
`feature`. `scripts/corpus/targets.mjs:78` admits `feature`/`library` into the
population, and one unit per declared feature follows:

| | count |
|---|---:|
| paths with role `feature` and `header: false` | 35 |
| unique files | 28 |
| duplicate paths, e.g. `machine-interface-r10/geometry-body.fs` | 7 |
| families | 17 |
| units | 293 |

Header-less files without a feature (54 `fragment`, 37 `eval`, 19
`fragment-splice`) were already excluded. The runner's classifier
(`scripts/corpus/lib.mjs:22`) already names the kind
`parse-headerless-include`.

The first tokens are `function` (13 files), `const` (8), `annotation` (6) and
`export` (1). The fs95 bodies up to R6 start with `const`, from R7 on with
`function`. The cluster summary's example
`machine-interface-r7/geometry-body.fs: … found 'const'` is therefore
slightly off: `runs.jsonl` records `found 'function'` for that file.

The 16 small fragments form singleton families. They are too short to reach
Jaccard 0.6 against their twin. The 12 `geometry-body.fs` files belong to
fs95 (29 unique files in the population). Its other 17 unique files (32
paths) are the headed twins.

## 3. The 28 files

The kinds are:

- **verbatim**: the fragment text occurs verbatim in a headed corpus file;
- **edited**: at least 90 % of the fragment's significant lines and all of
  its features occur in a headed corpus file;
- **generated**: the headed version exists only as generator output, rebuilt
  here into `tmp/`;
- **paste-in**: a complete feature without a header, and no twin.

The generator is the project script that reads the fragment. "Next" is the
effective next blocker, with units per cluster (see
[section 4](#4-what-the-files-hit-next)).

| fragment (first token) | units | kind | twin | generator | next |
|---|---:|---|---|---|---|
| `dpl/machine-interface-r4/geometry-body.fs` (const) | 19 | verbatim | `interface-r4.fs` | `generate_fs.py` | bool-cap 7, import 5, inv-topo 4, sketch 2, builtin 1 |
| `dpl/deliverables/…R3/Source/geometry-body.fs` (const) | 16 | verbatim | `interface-r3.fs` | `generate_fs.py` | bool-cap 6, import 4, inv-topo 3, sketch 2, builtin 1 |
| `dpl/deliverables/…R5/Source/geometry-body.fs` (const) | 19 | verbatim | `interface-r5.fs` | (no script names it) | bool-cap 7, import 5, inv-topo 4, sketch 2, builtin 1 |
| `dpl/deliverables/…R6/Source/geometry-body.fs` (const) | 22 | verbatim | `interface-r6.fs` | (no script names it) | bool-cap 8, import 7, inv-topo 3, sketch 3, builtin 1 |
| `dpl/machine-interface-r7/geometry-body.fs` (function) | 24 | verbatim | `interface-r7.fs` | `generate_fs.py` | bool-cap 9, import 8, inv-topo 3, sketch 3, builtin 1 |
| `dpl/machine-interface-r8/geometry-body.fs` (function) | 24 | verbatim | `interface-r8.fs` | (no script names it) | bool-cap 9, import 8, inv-topo 3, sketch 3, builtin 1 |
| `dpl/deliverables/…R9…/Source/geometry-body.fs` (function) | 24 | verbatim | `interface-r9.fs` | (no script names it) | import 8, bool-cap 8, inv-topo 4, sketch 3, builtin 1 |
| `dpl/deliverables/…R10…/machine-interface-r10/geometry-body.fs` (function) | 24 | verbatim | `interface-r10.fs` | (no script names it) | import 8, bool-cap 8, inv-topo 4, sketch 3, builtin 1 |
| `dpl/machine-interface-r11/geometry-body.fs` (function) | 26 | verbatim | `interface-r11.fs` | `build_parts.py` | import 9, bool-cap 7, sketch 6, inv-topo 3, builtin 1 |
| `dpl/machine-interface-r11/top-entry-r12/baseline/geometry-body.fs` (function) | 26 | verbatim | `baseline/interface-r11.fs` | `build_parts.py`, `prepare_native.py` | import 9, bool-cap 7, sketch 6, inv-topo 3, builtin 1 |
| `dpl/machine-interface-r11/refinement-prep/geometry-body-prepared.fs` (function) | 26 | verbatim | `interface-r11-prepared.fs` | `prepare_source.py` | import 9, bool-cap 8, sketch 5, inv-topo 3, builtin 1 |
| `dpl/machine-interface-r11/superseded-sliding-stop/geometry-body.fs` (function) | 26 | edited (0.94), generated (1.0) | `interface-r11-prepared.fs`; generated `r11-superseded-sliding-stop/interface-r11.fs` | `build_parts.py` rule | import 8, bool-cap 7, sketch 6, inv-topo 4, builtin 1 |
| `dpl/machine-interface-r11/endstop-r11.fs` (function) | 1 | generated (0.83) | generated `r11-superseded-sliding-stop/interface-r11.fs` | `modify_stop_source.py` | inv-topo 1 (`stopHammer`, `unite@187:4`) |
| `dpl/machine-interface-r11/joints-r11.fs` (function) | 1 | edited (0.90) | `interface-r11-prepared.fs` | `modify_joint_source.py` | sketch 1 (`opLoft` coaxial circles) |
| `dpl/…/top-full-module-r4/ct-retention/ct-retention-include.fs` (function) | 1 | verbatim | `native/module-r4-upload.fs` | `make_source.py` | import 1 (`SourceR11`) |
| `dpl/…/top-full-module-r4/hammer-retention/hammer-retention-include.fs` (function) | 1 | verbatim | `native/module-r4-upload.fs` | `make_source.py` | import 1 (`SourceR11`) |
| `cad-project-002/funnel-holder-r3/clamp-finish.fs` (const) | 1 | edited (1.0) | `guide-r3.fs` | `generate.py` | builtin 1 (`makeRobustQuery`) |
| `cad-project-002/funnel-holder-r4/finish.fs` (const) | 1 | edited (1.0) | `guide-r4.fs` | `generate.py`, `finalize.py` | builtin 1 (`makeRobustQuery`) |
| `cad-project-039/c-channel-bases-r2/channel-hardware-r2.fragment.fs` (annotation) | 1 | verbatim | `native-all-r2.fs` | `build_hardware_plate.py` | bool-cap 1 (after 18 calls) |
| `cad-project-039/c-channel-bases-r2/channel-plate-r2.fragment.fs` (annotation) | 1 | verbatim | `native-all-r2.fs` | `build_hardware_plate.py` | Part Studio input 1 ("Use a copy of R30 top plate") |
| `cad-project-039/c-channel-bases-r3/channel-hardware-r3.fragment.fs` (annotation) | 1 | verbatim | `native-all-r3.fs` | `build_hardware_plate.py` | bool-cap 1 (after 18 calls) |
| `cad-project-039/c-channel-bases-r3/channel-plate-r3.fragment.fs` (annotation) | 1 | verbatim | `fixed-frame-r30.fs` | `build_hardware_plate.py` | Part Studio input 1 |
| `cad-project-041/single-step-r10/jobs/r10b/retained_context.fs` (function) | 1 | verbatim | `r10b.fs`; also `fixtures/r10b/r10b.fs` | `merge_fs.py` | **ok** via the frozen fixture (5 retained snapshot bodies); corpus twin: import 1 |
| `cad-project-041/single-step-r10/jobs/r10b/transfer_edge.fs` (export) | 1 | verbatim | `r10b-uploaded-snapshot.fs`; `fixtures/r10b/r10b.fs` (0.97) | `merge_fs.py` | inv-topo 1 (`buildTransferEdge@1360:3 > cut@1278:4`, after 12 calls) |
| `cad-project-041/single-step-r20/fs/modules/datums.fs` (const) | 1 | generated (1.0) | generated `r20/datums.fs` | `tools/build_fs.py` | parser 1 (the string `"-"`, see [section 7](#7-adjacent-finding-the-string---is-parsed-as-minus)) |
| `cad-project-041/single-step-r20/fs/modules/probe.fs` (const) | 1 | generated (1.0) | generated `r20/probe.fs` | `tools/build_fs.py` | builtin 1 (`unitless`) |
| `cad-project-038/scripts/hopper_v2.fs` (annotation) | 1 | paste-in | none | (none) | parser 1 (`try silent { }`, line 98) |
| `cad-project-038/scripts/hopper_v21.fs` (annotation) | 2 | paste-in | none | `gen_v21.py` (writes to a scratchpad) | parser 2 (`try silent { }`, line 52) |

Abbreviations: `dpl` = `cad-project-014`. Clusters: `import` =
fs-module-import, `bool-cap` = boolean-capability, `inv-topo` =
boolean-invalid-topology, `sketch` = kernel-sketch-and-ops, `builtin` =
fs-missing-builtin, `parser` = fs-parser-syntax. The single missing builtin
in each fs95 file is `opTransform`. Generator paths are relative to the
fragment's directory. The search covered `.py`/`.mjs`/`.js`/`.sh` files
in the fragment's directory and its two parents. For R5, R6, R8, R9 and R10
no script there names the file, and the verbatim match is the evidence of the
splice.

## 4. What the files hit next

Method (`scripts/corpus/fragments.mjs`, `scripts/corpus/fragments-generate.sh`):

- **Twin mapping.** Each fragment was compared with every headed corpus file.
  The comparison uses significant lines (trimmed, at least 12 characters, no
  comments) and exported feature names. The effective next blocker of each
  fragment feature is taken from the most faithful headed version:
  1. **A built twin outside the corpus.** These builds ran here with the
     production CLI:
     - the frozen fixture `fixtures/r10b/r10b.fs`, with its frozen
       `modules.json`, for the two r10b fragments;
     - the project's own splice rule, rerun on copies into
       `tmp/corpus/headerless/generated/`. For single-step-r20,
       `tools/build_fs.py --allow-placeholders` ran on a copy of `tools/`,
       `fs/` and `params/` via `uv run --no-project`. For the superseded r11
       stop, the `build_parts.py` rule `header + geometry-body.fs` was applied
       with the current `interface-r11.fs` header.
  2. **The recorded corpus run of the headed twin** (`out/corpus/runs.jsonl`,
     no re-run).
  3. **For paste-ins, a header-prepended stub** in
     `tmp/corpus/headerless/stub/`, with the default Feature Studio header
     `FeatureScript 2909;` and the `common.fs` import.
- **Stubs for every fragment** (twin header + fragment). Twelve stubs are
  byte-identical to their twin and were not re-run. 17 stub units ran:
  - 7 stop on a helper that only the splice target defines: `prism`,
    `twoProfileLoft`, `roundBody` ×2, `block`, and the generated
    `r20StampDatums`/`r20StampProbe`. A header alone is not enough for these
    files;
  - 7 reach the same blocker as their twin: `makeRobustQuery` ×2, the
    three Part Studio imports, and the two "Use a copy of R30 top plate"
    checks;
  - 3 are the paste-in results (`try silent { }`).
- **Load.** 48 CLI runs (17 stubs, 31 built twins), each failure re-probed
  through `scripts/corpus/probe.mjs`. At most 2 processes, 480 s timeout per
  unit. No timeouts. 0.3 to 5.0 s per unit.

Effective next blocker, all 293 units:

| cluster | units | files (primary) | what |
|---|---:|---:|---|
| boolean-capability | 93 | 8 | general trimmed-face `opBoolean` 79 (fs95), arity 6, through-hole limits 6, the c-channel hardware 2 |
| fs-module-import | 90 | 8 | unresolved Part Studio imports (`Mount`, `Gear`, `Core`, `Top`, … in fs95; `SourceR11` in the r4 includes) |
| kernel-sketch-and-ops | 45 | 1 | `opLoft` needs coaxial circular profiles 32, profile vertex count 9, collinear edges 4 |
| boolean-invalid-topology | 43 | 2 | planar arrangement union 28, subtraction 13, convex-tool `UnsupportedArrangement` 2 |
| fs-missing-builtin | 15 | 3 | `opTransform` 12, `makeRobustQuery` 2, `unitless` 1 |
| fs-parser-syntax | 4 | 3 | `try silent { }` 3, the string `"-"` 1 |
| fs-needs-partstudio-input | 2 | 2 | "Use a copy of R30 top plate" |
| ok | 1 | 1 | `r10bRetainedContext` from the frozen fixture |

`r10bRetainedContext` instantiates five retained R6d parts from the frozen
snapshots and copies two of them. It is correct output, but it is not new
R10b geometry. Removing this cluster yields no new modeling result from the
corpus, because the twins already ran these features.

## 5. Fix design

**Where:** the inventory classifier and the corpus harness. Not `src/`,
`kernel/` or `bin/`.

1. **Classifier** (`scripts/lang/fs-analyze.mjs:135`, owned by the language
   inventory):

   ```js
   const role = !ast.header && featureRoots.length ? 'fragment-feature'
     : featureRoots.length ? 'feature' : evalRoots.length ? 'eval' : !ast.header ? 'fragment' : 'library';
   ```

   A separate role keeps the syntax and construct census over these files,
   which is still valid FS code, while the modeling population drops them.
   `scan-fs.mjs` needs no change. Re-run the inventory and update
   `docs/language/corpus.md` and the coverage table in `docs/language.md`.
2. **Run list** (`scripts/corpus/targets.mjs:78`). Add
   `r.header !== false` to the population filter, defensively and
   independently of step 1. Write the excluded files to `targets.json` as
   `fragments[]`, each with `twin`, `kind` and `generator` from
   `scripts/corpus/fragments.mjs`. `summarize.mjs` then reports "28 fragments
   excluded, 23 covered by a population twin, 5 not covered" instead of a
   293-unit failure cluster.
3. **Content without a corpus twin (optional, harness only).**
   - Add the generated r20 studios and the superseded r11 interface
     (`fragments-generate.sh`) as units with `generated: true`. Their
     invocation must name the tmp path and the generator.
   - For the two paste-ins, either leave them out as `fragment-feature`, or
     run them with the default Feature Studio header added by the harness,
     marked `headerSuppliedBy: 'harness'`. Never let the CLI supply the
     header. The cleaner option is for Marc to add the header to the source
     files.
4. **CLI message (optional, frontend owner, XS).** `src/parser.mjs:89` could
   explain the refusal:

   ```text
   Expected 'FeatureScript <version>;' header, found 'function': header-less
   fragments are not Feature Studios; build the file they are spliced into
   ```

   Keep the prefix `Expected 'FeatureScript'`, because
   `scripts/corpus/lib.mjs:22` matches on it. No test depends on the current
   text.

**Rejected:**

- **Accepting header-less input with an implied header** would break the
  "unmodified Onshape FS" rule and the rule against silent fallbacks. It would
  only move 7 of the 16 small fragments to "helper not defined".
- **A generic `--prelude`/`--include` CLI option** cannot work, because the
  splice rules are project-specific:
  - text inserted before `const R5G=58;` (`modify_*_source.py`);
  - a marker replacement (`make_source.py`);
  - trace-block assembly (`merge_fs.py`);
  - a cut from the first `annotation` (`build_hardware_plate.py`);
  - generated constants (`build_fs.py`).

  The headed twin is the file Onshape actually receives, so it is the right
  unit.

**Effort:** S. Step 1 is one line plus an inventory re-run. Step 2 is about
20 lines plus summary text. `fragments.mjs` already exists. Step 3 is S if
wanted.

**Risk:** low, bookkeeping only.
- The FS denominators shrink (see [Answer in short](#answer-in-short)).
  All 16 disappearing families are singletons of a small fragment. 11 of
  them stay in the population through a twin. 5 do not: `endstop-r11`,
  r20 `datums` and `probe`, `hopper_v2` and `hopper_v21`.
- Header detection depends on `ast.header` from the tolerant parser, which
  skips leading comments. All 35 affected paths start with a comment or with
  `function`/`const`/`annotation`/`export`.
- Without step 3, 6 units of unique design content leave the ladder
  unmeasured: a superseded endstop, two r20 probe modules and two hopper
  paste-ins. None of them is a current printable part.

## 6. Overlap with in-flight work

- **Bake-off (`kernel/proto/**`, `recover`).** No effect on this cluster: it
  is a parse refusal and not a Boolean, so there is nothing to run through
  `scripts/bakeoff`. After the fix, 136 of the 293 units reach a Boolean
  first:
  - 93 in boolean-capability;
  - 43 in boolean-invalid-topology, including `stopHammer` via
    `unite@187:4` and `r10bTransferEdge` via `cut@1278:4`.

  These are the Boolean clusters' cases and in `recover`'s declared planar
  and cylindrical scope. They also run through the fs95 twins already, so
  the fix does not create new Boolean work.

  What the bake-off route does with them was measured by the Boolean
  cluster analysts, not here:
  - [boolean-capability](cluster-boolean-capability.md), section 6, ran the
    fs95 Boolean shapes through corefine + recover. The ring union, the
    countersink, the hex socket and the spoke trim come back as exact,
    OCCT-valid B-reps. `ringBoss` (wall ring ∪ screw boss) is refused,
    because recover treats parallel-axis cylinder pairs as space quartics.
    It is the most frequent next blocker in fs95. After the Booleans, fs95
    stops at `opTransform` (87 units).
  - [boolean-invalid-topology](cluster-boolean-invalid-topology.md) shows
    that the planar `InvalidTopology` (for example `stopHammer`) comes from
    F32 operand carriers. recover's leaf intake refuses those same operands
    (vertex off its surface by 7.7e-7 to 3.6e-5 mm), so recover alone does
    not solve it.
- **Native binding (`src/native/**`).** No effect. `build()` parses before
  `loadKernel()`. `WONKY_BACKEND=native node bin/wonky.mjs
  fixtures/corpus-repro/fs-headerless-include/geometry-body.fs --check` gives
  the same `6:1` error.
- **Viewer (`viewer/**`, `src/review-*`).** Not involved.
- **Language work (`docs/language*`, `kernel/lang/**`, `scripts/lang/`).**
  The classifier line belongs to the language inventory. Its coverage table
  ([language.md](../language.md): "wonkys Parser lehnt ab (Fragmente, …)", 43
  unique files) counts these fragments as parser rejects. It should drop them
  from the denominator in the same way.

## 7. Adjacent finding: the string `"-"` is parsed as minus

This is not this cluster, but it is the next blocker of the generated r20
`datums` studio. `tools/build_fs.py` emits `const live = "-";` in every stamp
function. `Parser.at()` (`src/parser.mjs:72`) compares only `token.value`,
not the token kind. The unary branch at `src/parser.mjs:247`
(`this.accept('-')`) therefore consumes the string literal `"-"` as an
operator, and parsing fails with `Unsupported expression ';'`.

This is the same root cause as the fs-parser-syntax repro
`fixtures/corpus-repro/string-function-keyword.fs`, where the string
`"function"` is taken as the keyword. The fix belongs there: `at`/`accept`
must ignore `string` tokens, except where a string is expected. The repro is
`fixtures/corpus-repro/fs-headerless-include/next-string-minus.fs`
(`8:17: Unsupported expression ';'`).

## 8. Reproduce

```sh
node bin/wonky.mjs fixtures/corpus-repro/fs-headerless-include/geometry-body.fs --check   # 6:1 refusal
node bin/wonky.mjs fixtures/corpus-repro/fs-headerless-include/interface.fs --check       # builds
sh scripts/corpus/fragments-generate.sh              # generated twins -> tmp/corpus/headerless/generated/
node scripts/corpus/fragments.mjs --stub --concurrency 2   # twins, stubs, built twins -> out/corpus/fragments.json
node scripts/corpus/fragments.mjs                    # re-summarize, keeps the previous stub results
```

The 2026-09-23 spot checks, each with `--check`:

```sh
node bin/wonky.mjs tmp/corpus/headerless/stub/cad-project-038_scripts_hopper_v2.fs --feature hopperV2   # 100:24 try silent { }
node bin/wonky.mjs tmp/corpus/headerless/stub/cad-project-014_machine-interface-r11_endstop-r11.fs --feature stopHammer   # 16:8 'prism' not defined
node bin/wonky.mjs tmp/corpus/headerless/generated/r11-superseded-sliding-stop/interface-r11.fs --feature stopHammer   # 48:6 InvalidTopology
node bin/wonky.mjs tmp/corpus/headerless/generated/r20/datums.fs --feature r20Datums   # 34:21 the string "-"
node bin/wonky.mjs fixtures/r10b/r10b.fs --feature r10bRetainedContext   # ok, frozen modules.json
```

`fragments.mjs` only reads the corpus. It writes stubs to
`tmp/corpus/headerless/stub/` and records `uptime` at start and end.
`fragments-generate.sh` copies the r20 sources before running their
generator, so nothing is written under `~/Workspace/cad`.

## Limitations

- **Twin matching is textual.** Scores below 1.0 mean the fragment was edited
  after the splice, or before it, as with `endstop-r11.fs` at 0.83 against the
  superseded body. Its next blocker is that of the closest headed version,
  not of the fragment's exact text.
- **Generated twins are reconstructions.** They use the project's own
  generator or splice rule on copies. The r20 `probe` studio keeps
  `<SET_BY_LEAD…>` placeholders for its context import
  (`--allow-placeholders`). It stops on `unitless` before it reaches that
  import.
- **Recorded twin results come from the run at 23:26 to 23:38.** They were not
  repeated here.
