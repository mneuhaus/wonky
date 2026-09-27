# Cluster fs-module-import: FeatureScript module imports cannot be resolved

Date: 2026-09-23. Failure analysis of cluster 1 from the
[corpus run](run.md). Repository HEAD `79bbfee` plus the uncommitted working
tree of that moment (production files unchanged by this analysis). Default JS
path, CLI default modeling policy (`strict`), at most 3 wonky processes at
once. The machine was shared with benchmark workflows (load average 20 to 130
on 18 cores). `uptime` at start and end is in
`out/corpus/module-import/run-meta.jsonl`.

Machine-readable results:

- `out/corpus/module-import/scan.json`: static facts per file (imports,
  `NS::` uses, `addInstance` idioms, unresolved callees).
- `out/corpus/module-import/next.jsonl`: one record per next-blocker probe.
- `out/corpus/module-import/next-summary.json`: aggregated next blockers per
  unit, file and level.
- `out/corpus/module-import/files.md`: the per-file table from the appendix.

Repros: [`fixtures/corpus-repro/fs-module-import/`](../../fixtures/corpus-repro/fs-module-import/README.md).

## Answer in short

1. **The error is intended behavior.** The interpreter resolves a namespaced
   import (`NS::import(path, version)`) only through a frozen snapshot
   manifest. No corpus file has one, so the first `NS::` use raises the
   explicit capability error. That covers 274 units in 96 files and 38
   families. The cluster is a missing-input problem plus a thin loader, not a
   kernel bug.
2. **The snapshot mechanism is r10b-shaped.** It has four limits, and each one
   blocks real files even where a capture already exists:
   - It is bound to the SHA-256 of the importing source. 16 corpus files
     import only Onshape revisions that `fixtures/r10b/modules.json` already
     holds (same element, same microversion), and they are still refused.
   - The loader handles only same-document element paths. 43 files (14
     families) import `document/version/element` paths.
   - `addInstance` requires `loadedContext` (56 files lack it) and rejects
     `transform` (14 files).
   - `qCreatedBy(<instantiator id>)` finds nothing (15 files), because
     `qCreatedBy` matches ids exactly.

   The capture script also handles only r10b: one hard-coded document, and
   only parts that are named statically in the source.
3. **Feature Studio code imports have no mechanism at all.** 4 files (17
   units) call imported functions (`SourceR11::bottomCarrier`,
   `M3::m3HybridTool`). One of them is an fsocct `version: "local"` path.
4. **This is the only first blocker for 65 files (33 families).** In another
   31 files (7 families), other features of the same file fail first on
   Booleans, builtins or model checks.
5. **What comes next is known for all 274 units.**
   - The 16 r10b-family files were re-bound to the existing r10b capture and
     run through unchanged production code. They then hit the r10b Boolean
     frontier: 58 units stop at the curved convex-tool intersection or a
     general trimmed-face Boolean, and 6 need parts that were never captured.
     7 units (`r10bRetainedContext`) build real geometry.
   - For the other files, the import was stubbed in a triage-only probe. The
     next blockers are:
     - selecting and measuring imported bodies: `qEverything`, `qNthElement`,
       `qContainsPoint` and `makeId` (43 units), and `evVolume`/`evBox3d` over
       imported analytic bodies (97 units, 22 files);
     - `opTransform` (20 units) and other std builtins (8 units);
     - Booleans (18 units, reached with placeholder bodies, so only
       indicative).
6. **Fix: size L in four stages, all outside the kernel except one.**
   - Stage 1 (S): a revision-keyed loader with the full `addInstance`
     semantics.
   - Stage 2 (M): a general capture script and a shared snapshot store.
   - Stage 3 (M): measurement and part selection over imported bodies. This
     includes Bend volume and bounds for imported analytic B-reps.
   - Stage 4 (M): Feature Studio source imports.

   Stage 1 alone moves 16 files past the import with captures that already
   exist. No file builds completely after any stage alone.
7. **In-flight work.** None of it solves the import.
   - The bake-off `recover` route targets exactly the Booleans that the
     r10b-family files hit next.
   - The native binding does not touch module resolution.
   - The language work reuses the same loader and already lists the
     `qCreatedBy` prefix semantics as an open divergence.

## 1. The cluster

| | count |
|---|---:|
| units / files / families | 274 / 96 / 38 |
| files where the import is the only first blocker / their families | 65 / 33 |
| files where other units of the file fail first elsewhere / their families | 31 / 7 |
| distinct imported Onshape revisions (`element@version`) | 63 |
| import declarations: same document (`<element>`) / other document (`<doc>/<ver>/<element>`) / local path | 179 / 136 / 1 |
| files: same-document only / other-document only / local path (none mixes) | 52 / 43 / 1 |
| files using `NS::build` (Part Studio bodies) / Feature Studio code (`NS::function`) | 95 / 4 |
| files with a sibling `modules.json` (schema `wonky-onshape-inputs/1`) | 0 |
| files byte-identical to the frozen `fixtures/r10b/r10b.fs` | 0 |
| files whose imports are all captured in `fixtures/r10b/modules.json` (same element and microversion) | 16 |

**Instantiator idioms** (477 `addInstance` calls in 95 files):

| idiom | calls | files / families | production today |
|---|---:|---:|---|
| `loadedContext` plus a name table, as in r10b: `n_base[getProperty(b, NAME)] = b` | 298 | 36 / 14 | supported |
| no `loadedContext` (Onshape builds the source context itself) | 175 | 56 / 20 | `loadedContext must belong to the specified frozen module build` |
| `transform` field on the instance | – | 14 / 6 | `addInstance field 'transform' is not implemented` |
| part picked by `qEverything`, `qContainsPoint`, `qNthElement` or all solids of the source | 166 | 56 / 20 (with the rows below) | `qEverything`, `qNthElement` and `qContainsPoint` are missing builtins |
| part picked by the source Part Studio's feature id, `qCreatedBy(makeId("FWWAVZ…") + "rearPlateSource")` | 4 | 3 / 3 | `makeId` missing. A B-rep snapshot also does not record which source feature created a part |
| other (`qUnion(found)`, helper `namedBody`) | 5 | 5 / 4 | depends on the helper |
| instances queried afterwards by `qCreatedBy(<instantiator id>)` | – | 15 / 8 | finds 0 bodies (exact id match) |

Only 23 files (9 families) use nothing but the idiom production supports.

**Feature Studio code** (4 files, 17 units): `SourceR11::bottomCarrier`,
`motorBracket`, `bottomRotor`, `switchBracket`, `fixedCableClamp`,
`stopHammer`, `bottomSpoke` and `TopR3::tieR3`, `stanchionR3`, `upperPlate`
come from Feature Studios of the distributor document (`889f3a9e…`,
`fs` element `6d0c52f9…` in `machine-interface-r9/state.json`). The local
`interface-r*.fs` files are revisions of that source, but it is not known which
one matches microversion `929e2218…`. `M3::m3HybridTool` comes from the
header-less fragment `cad-project-043/skills/onshape-cad/lib/m3_hybrid_hole.fs`
through the fsocct `version: "local"` convention.

## 2. Repros

All files are in `fixtures/corpus-repro/fs-module-import/`. The observed output
is in its [README](../../fixtures/corpus-repro/fs-module-import/README.md).

- `part-studio-import.fs`: the corpus signature for Part Studio bodies
  (`Unresolved Onshape module 'Parts'`).
- `feature-studio-import.fs`: the corpus signature for Feature Studio code.
- `local-path/main.fs` + `lib.fs`: the fsocct local library import.
- `snapshot/idioms.fs` + `snapshot/modules.json`: a real, hash-checked
  snapshot. It holds one r10b body, copied byte for byte from
  `fixtures/r10b/modules/base/`, with one feature per corpus idiom. The r10b
  idiom builds (1 body, 10 faces). The other seven idioms reproduce the
  semantic gaps above:
  - no `loadedContext`;
  - `transform`;
  - `qCreatedBy(<instantiator id>)`;
  - `makeId`;
  - `qNthElement`/`qContainsPoint`;
  - `evVolume` over an imported body;
  - `evBox3d` over an imported body.

  Pointing the same file at `fixtures/r10b/modules.json` reproduces the
  source-SHA refusal.

## 3. Root cause (code, read only)

1. **Resolution.** `Interpreter.run` records every namespaced import and asks
   `moduleResolver` for its exports (`src/interpreter.mjs:48-55`). The only
   resolver is `frozenModules` (`src/modules.mjs:15`). `build` creates it only
   when a manifest is given (`src/index.mjs:15`), and the CLI looks only for a
   sibling `modules.json` or `--modules` (`bin/wonky.mjs:66-67`). Without
   exports, `Environment.lookup` raises the capability error at the first
   `NS::` use (`src/interpreter.mjs:16-20`). The semantic-core evaluator
   repeats the same error (`src/lang/semcore/eval.mjs:81-87`). This is the
   AGENTS.md rule working as intended: frozen inputs with provenance, no
   network, explicit refusal.
2. **Source binding.** `frozenModules` refuses a manifest whose `sourceSha256`
   differs from the importing file (`src/modules.mjs:18`). Each module entry
   is already pinned to an immutable element and microversion, and every body
   file to its SHA-256 (`src/modules.mjs:20-24,29,38,46`). The source hash adds
   no immutability. It only prevents reuse: every edit of r10b and every copy
   of it needs a new capture.
3. **Other-document paths.** The manifest has one `document` field. Entries
   match `spec.path` literally, and the part list must carry the same
   `elementId` (`src/modules.mjs:29,38`). A `doc/ver/elem` path can never
   satisfy both checks.
4. **`addInstance`/`instantiate` subset** (`src/modules.mjs:69-94`):
   - only the `name`, `partQuery` and `loadedContext` keys;
   - `loadedContext` is mandatory;
   - instances are placed with the identity transform;
   - each body records only its instance id in `createdBy`.

   `qCreatedBy` matches exactly (`src/queries.mjs:23`). Onshape counts
   sub-operation ids as created by their parent. That row is still open in
   [semantic-core](../language/semantic-core.md) (probe `qCreatedByPrefix`).
5. **Imported bodies cannot be measured.** `importOnshapeBody` returns an
   analytic body whose `validation.volumeMm3` and `boundsMm` are `null`
   (`src/analytic.mjs:255-271`), so `evVolume` and `evBox3d` refuse them
   (`src/queries.mjs:105,110`). Marc's house style checks imported sources by
   volume or tight bounds before using them
   ([language corpus](../language/corpus.md), "host selection").
6. **No code imports.** A resolver can only return builtins. There is no path
   that parses and evaluates another FeatureScript module into a namespace. The
   parser also requires the `FeatureScript N;` header
   (`src/parser.mjs:89`), which the fsocct library fragment lacks.
7. **Capture tooling.** `scripts/snapshot-r10b-modules.mjs` (not production)
   has these limits:
   - it hard-codes `fixtures/r10b/` and document `889f3a9e…` (lines 9-10);
   - it builds only same-document `m/<microversion>/e/<element>` requests
     (line 53);
   - it captures only parts named by a literal `n_alias["…"]` lookup and
     throws on any other `partQuery` (line 22).

   Even for the r10b family, 6 units need parts it never captured: `T60 …
   journal`, `C00 … camera mast`, `T02 … transfer` and the `P04` clamp jaws.

## 4. Fix design

All stages are frontend or library code, except the volume and bounds
computation in stage 3. The r10b fixture and its manifest stay byte-identical
and keep loading.

### Stage 1 (S, `src/modules.mjs`, `src/queries.mjs`): a revision-keyed loader with full instantiator semantics

- **Bind the manifest to revisions.** A module entry applies to any import
  with the same element path and version. The namespace name does not matter.
  `sourceSha256` becomes optional provenance. When it is present and differs,
  the loader records the fact instead of refusing. Body files stay
  hash-checked, and a part that was not captured stays an explicit
  `Body … was not captured` error.
- **Other-document paths.** Store `document`, `documentVersion` and `element`
  per entry. Match `spec.path` as the full triple, and compare the part list
  against the element segment.
- **`addInstance`:**
  - `loadedContext` becomes optional. The default is the module's frozen
    default-configuration context, which `build` already memoizes.
  - Add the `transform` key through `transformAnalytic`. It must be rigid, and
    a scale or shear is refused explicitly.
  - `configuration` stays refused unless it is empty.
- **`instantiate`:** each body also records the instantiator id, so
  `qCreatedBy(<instantiator id>)` finds it. The general form, prefix semantics
  for `qCreatedBy`, belongs in the language work's query semantics. It must be
  checked against the r10b acceptance run before it replaces the targeted
  form.
- **Tests:** the snapshot repro becomes a test. Each idiom feature must build
  or refuse by name.
- **Effect with existing captures:** the 16 r10b-family files get past the
  import. This was verified with re-bound manifests through unchanged
  production code, see section 5.

### Stage 2 (M, `scripts/snapshot-modules.mjs`, Marc's signed-in bridge): general capture and a shared store

- **Generalize the r10b script.** It takes any source file and handles both
  path forms. A same-document import needs the host document id, which the
  source does not contain, so the script takes `--document` or reads a project
  `state.json`.
- **Capture every solid part of each imported revision.** Alternatively,
  answer each static `partQuery` at capture time with a read-only FeatureScript
  evaluation in the source Part Studio and record the part ids. That is the
  only honest answer for `makeId("<source feature id>")` queries.
- **A content-addressed store**, keyed by `element@microversion`. 63 revisions
  cover all 96 files. Per-source manifests reference the store instead of
  copying bodies.
- **Keep the r10b script's metering, budget and read-only checks**
  (`onshape-bridge`).

### Stage 3 (M, `src/queries.mjs` plus Bend): selecting and measuring imported bodies

- **`evVolume` and tight `evBox3d` over imported plane/cylinder/cone B-reps,
  computed in Bend.** Examples: a divergence-theorem volume over analytic
  faces, and bounds from edge and face extrema. A captured Onshape measurement
  can serve as an oracle, never as the answer. This blocks 97 units in 22
  files (fs95, the distributor bottom interface, is 14 of them).
- **`qEverything`, `qNthElement`, `qContainsPoint` and `makeId`** are shared
  with the fs-missing-builtin cluster. Point membership can use
  `kernel/solid-classification.bend`.

### Stage 4 (M, `src/interpreter.mjs`, `src/modules.mjs`, `src/parser.mjs`): Feature Studio source imports

- **Manifest entries of kind `source`**: a frozen `.fs` file with its SHA-256,
  pinned to the Feature Studio element and microversion. It is fetched from the
  Feature Studio API at capture time.
- **The loader** parses the file and evaluates its declarations in their own
  `Environment`, whose parent holds only the builtins. It binds the exported
  names as `NS::name`. Nested namespaced imports resolve through the same
  manifest or store. `SourceR11` itself imports six Part Studios.
- **Local path imports** (`version: "local"`) resolve relative to the
  importing file. Their SHA-256 goes into the result's `source.imports`. Only
  these may be header-less fragments. This is fsocct's convention, and Marc
  decides whether wonky adopts it.
- **The same mechanism** could later serve `NS::build` from a wonky source
  instead of a frozen Onshape B-rep, where the imported Part Studio is itself
  FeatureScript in the corpus. That is the natural route once Marc models in
  wonky.

### Effort and risk

| stage | effort | unblocks the import for | main risks |
|---|---|---|---|
| 1 loader | S (1 to 2 days with tests) | 16 files with today's captures; all 95 `NS::build` files once captured | policy: AGENTS.md froze r10b's inputs by source. Revision binding keeps immutability, but Marc must approve the rule change. `qCreatedBy` prefix semantics could change r10b query results, so keep the targeted form until acceptance passes. |
| 2 capture | M, plus capture time on Marc's bridge | all 63 revisions | Onshape API budget and metering (the r10b capture used 16 body calls for 8 revisions, and all parts of 63 revisions is many more). Same-document imports need the host document id from outside the source. **Imported surfaces:** `importOnshapeBody` accepts only plane, cylinder and cone faces, and line, circle, ellipse and plane/cylinder curves (`src/analytic.mjs:31-62`). Filleted or spline source parts are refused by name, and how many there are is unknown until capture. |
| 3 measure/select | M (Bend) | 22 files at their model checks; the selection builtins are shared with fs-missing-builtin | exactness: volume and bounds over trimmed curved faces must be exact or carry a stated tolerance, never invented |
| 4 code imports | M | 4 files, 17 units | the exact Feature Studio revision must be captured. The local `interface-r*.fs` copies are not proven to match `929e2218…`. |

Total: **L**. No stage makes a file build completely. The table in section 5
shows why.

## 5. First blocker per file, and what comes next

**Is this cluster the first blocker?** For all 96 files, at least one unit
stops here first, because units report only their first blocker. For 65 files
(33 families), every failing unit stops here. For 31 files (7 families), other
features of the same file fail first elsewhere:

- fs95, the distributor bottom interface (14 files): `opBoolean` capability,
  planar `InvalidTopology`, `opTransform`, profile validation;
- fs549, the r10b copies (8 files): `r10bSideDrive` (collinear profile) and
  `r10bTransferEdge` (planar subtraction);
- fs16, sc15 (3 files): `FeatureScript conditions must be boolean`;
- fs84, fs87 and fs88, the top modules (4 files): `opBoolean` capability,
  `opTransform`, profile validation;
- fs20 (2 files): `makeRobustQuery`.

The appendix lists every file.

**Method.** Three probes per unit, all through the production entrypoint
(`scripts/corpus/module-import-next.mjs`):

- **rebind** (production code unchanged): for the 16 files whose imports are
  all in the r10b capture. It uses a manifest under
  `tmp/corpus/module-import/rebind/` that points the unchanged r10b body files
  at the corpus file's own SHA-256. Only stage 1 is simulated here.
- **stub1** (triage only, `scripts/corpus/module-import-probe.mjs`): the
  following are resolved by stubs.
  - `NS::build` returns an empty source context.
  - `NS::function` and `instantiate` produce 10 mm placeholder cubes.
  - `addInstance` accepts `loadedContext`, `transform` and `configuration`.
  - The instantiator id is recorded in `createdBy`.
  - `partQuery` is still evaluated for real.

  Frontend blockers found this way are real. Model checks and Boolean outcomes
  on cubes are only indicative.
- **stub2**: stub1, but `partQuery` expressions are not evaluated (a stage 2
  capture would answer them).

No probe timed out or crashed. 619 probes: p50 2.4 s, max 163 s (r10b
`UpperCore` under load 60 to 130).

### Real results: the r10b family re-bound to the existing capture (16 files, 71 units)

| next blocker | units | where |
|---|---:|---|
| `Native curved convex-tool intersection unresolved: UnsupportedArrangement` / `InvalidTopology` | 41 | `UpperCore` g2 (the P10 contact, identical to the frozen anchor), `LowerCore`, `Carriage`, `CameraSupports`; `singleStepR10b` stops at `UpperCore` |
| `opBoolean … general trimmed-face booleans are not implemented` | 17 | `Frames`, `TrayArms` (via `join > combine`), `transfer-edge.fs` |
| `Body '…' was not captured in this input snapshot` | 6 | `direct-drop`, `fixed-integration`, both `frames.fs`, both `native/core.fs` |
| **ok** | 7 | `r10bRetainedContext` in 7 files: frozen bodies placed, real geometry |

The import is the first blocker, but for this family the kernel's curved
Boolean is the real frontier. It is the same one the acceptance run reaches
only with `--curved-contacts tolerated-regularized`.

### Estimated results for the other 80 files (203 units, stub1)

| next blocker | units | files | real or indicative |
|---|---:|---:|---|
| model check measuring an imported body (`selectVolume` → `Ambiguous reference volume`, `Pinned source bounds mismatch`, `Source shape changed`) | 97 | 22 | real with a snapshot: `evVolume`/`evBox3d` refuse imported analytic bodies (repro `importedVolume`, `importedBox`) |
| part selection in the source: `qNthElement` 20, `qEverything` 18, `makeId` 3, `qContainsPoint` 2 | 43 | 36 | real (missing builtins) |
| `opTransform` 20, `rotationAround` 5, `qGeometry` 2, `qClosestTo` 1 | 28 | 13 | real (missing builtins) |
| Boolean (`InvalidTopology`, capability) | 18 | 15 | indicative: placeholder cubes instead of the source bodies |
| ok | 13 | 5 | indicative (placeholders); fs95 accounts for 11 of these |
| other model checks and a missing Part Studio input | 4 | 4 | indicative |

With `partQuery` answered (stub2), `opTransform` rises to 39 units: the 14
platform files (fs131) select a part with `qNthElement(qContainsPoint(…))`,
then place it with `opTransform`. The spar-key files go from `makeId` to
`opTransform`.

**Code imports.** The fsocct M3 example was inlined in a copy
(`tmp/corpus/module-import/inline/canonical_m3_tool.inline.fs`, library text
unchanged). It evaluates 21 modeling calls, then stops at `'opRevolve' is not
defined` (fs-missing-builtin). The module-r4 files reach `opTransform` after the
stubbed code calls. For real, they would first run
`SourceR11::bottomCarrier`/`motorBracket`/`bottomRotor`. In the corpus run
their local `interface-r11.fs` counterparts fail on `opBoolean`, planar
`InvalidTopology` and their own unresolved imports.

**Per family (next blocker once imports resolve):**

| family | files | cluster units | imports | next |
|---|---:|---:|---|---|
| fs95 distributor bottom interface R3 to R12 | 14 | 107 | 6 other-document Part Studios (Mount, Gear, Post, Caster, Core, Top) | `evVolume` over imported bodies (96 units) |
| fs549, fs541, fs543, fs544, fs517 single-step r10/r10b | 16 | 71 | r10b's 8 same-document Part Studios | curved/general Boolean (real), 6 parts not captured |
| fs131, fs116, fs36, fs38, fs126 distributor platforms and posts | 19 | 20 | `Bins`/`Legacy` other-document | `qNthElement`/`qContainsPoint`/`qEverything`, then `opTransform`, Boolean, `evSurfaceDefinition` |
| fs84, fs85, fs87, fs88 distributor top module | 6 | 27 | Feature Studio code (`SourceR11`, `TopR3`) and Part Studios | `opTransform`, `qGeometry`, code imports' own blockers |
| fs10, fs11, fs16, fs19, fs20 alternate chute | 12 | 18 | same- and other-document | `qEverything`, then `evBox3d` over imported bodies |
| fs479, fs489, fs491, fs492, fs495, fs499, fs503, fs508, fs511, fs542 rocker/r6d studies | 21 | 22 | r10b-style name table, 14 with `transform` | Booleans (indicative), `rotationAround`, `qClosestTo` |
| fs458, fs460, fs465 spar-key buildplate | 3 | 3 | same-document derive by source feature id | `makeId` (needs capture-time answer), then `opTransform` |
| fs325, fs342, fs392, fs63 sorter | 4 | 4 | same- and other-document | `qContainsPoint`, Boolean, name checks |
| fs562 cad-project-043 fsocct M3 | 1 | 1 | local path code | `opRevolve` |

## 6. Overlap with in-flight work

- **Boolean bake-off** (`docs/bakeoff.md`, `docs/proto-recover.md`). The
  cluster is not a Boolean, so there is no bake-off case for its repro. It
  matters for what comes next: the 58 real Boolean blockers of the r10b family
  are the anchor's frontier. `recover` recovers the r10b g10 fuse
  (`r10b-g10-union`) and most planar and cylindrical cases, but it is not in
  production. The 18 indicative Booleans in other families cannot be judged
  until real snapshots exist.
- **Native binding** (`src/native/**`). The error is raised in the JS
  interpreter before any kernel call. `WONKY_BACKEND=native` changes nothing
  here. Importing bodies uses `kernel.analytic` (assemble, transform). Whether
  those are among the 19 native entries was not checked.
- **Viewer rework.** Not involved.
- **Language work.**
  - `src/lang/semcore/build.mjs:25` and `src/lang/dataflow/fs-trace.mjs:200`
    reuse `frozenModules`, so stage 1 applies there without extra work.
    `src/lang/semcore/eval.mjs:81-87` duplicates the error text.
  - [semantic-core](../language/semantic-core.md) lists the `qCreatedBy`
    prefix semantics as an open divergence and "imports only from hash-pinned
    frozen snapshots" as the rule. A revision-keyed store satisfies that rule.
  - The core-IR proposal has `import`/`import_context` nodes, but no loader.

  None of this resolves the cluster.
- **Neighboring clusters.**
  [fs-needs-partstudio-input](cluster-fs-needs-partstudio-input.md) (51
  files) needs the same Part Studio snapshot input, so stage 2 serves it too.
  The selection builtins (stage 3), `opTransform`, `rotationAround` and
  `opRevolve` are [fs-missing-builtin](cluster-fs-missing-builtin.md) work.

## 7. Reproduce

```sh
node scripts/corpus/module-import-scan.mjs     # static facts -> out/corpus/module-import/scan.json
node scripts/corpus/module-import-next.mjs     # rebind/stub1/stub2 probes, max 3 processes, resumable
node scripts/corpus/module-import-report.mjs   # -> next-summary.json, files.md
node bin/wonky.mjs fixtures/corpus-repro/fs-module-import/snapshot/idioms.fs --check --feature noLoadedContext
```

`module-import-next.mjs` writes re-bound manifests only under
`tmp/corpus/module-import/rebind/`, with body files copied from
`fixtures/r10b/modules/`. The stubs exist only in
`scripts/corpus/module-import-probe.mjs` and are never used for production
geometry. The corpus is read in place and never written.

## Appendix: all 96 files

Columns:

- **units:** cluster units / all units of the file.
- **first blocker:** "only" means every failing unit of the file stops at the
  import.
- **next:** the rebind result where available, otherwise stub1.
- **after source queries:** stub2.
- A backticked name is a missing builtin.

| file | family | units (import/all) | import form | idioms | first blocker | next (stub1 or rebind) | after source queries (stub2) |
|---|---|---:|---|---|---|---|---|
| `cad-project-002/printed-experiment-r1/source/printed-chute-experiment.fs` | fs10 (rep) | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qEverything` 1 | model check 1 |
| `cad-project-002/printed-experiment-r1/source/retained-context.fs` | fs11 (rep) | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qEverything` 1 | model check 1 |
| `cad-project-002/sc15-adaptation/r2-before-edge-review-sc15.fs` | fs16 | 3/6 | same doc | no loadedContext, qEverything/qContainsPoint | shared | `qEverything` 3 | model check 2, ok 1 |
| `cad-project-002/sc15-adaptation/sc15-before-review-r1.fs` | fs16 | 3/6 | same doc | no loadedContext, qEverything/qContainsPoint | shared | `qEverything` 3 | model check 2, ok 1 |
| `cad-project-002/sc15-adaptation/sc15.fs` | fs16 (rep) | 3/6 | same doc | no loadedContext, qEverything/qContainsPoint | shared | `qEverything` 3 | model check 2, ok 1 |
| `cad-project-002/sc15-adaptation/r2-before-head-trim-universal-connector.fs` | fs19 | 1/1 | same doc | no loadedContext, qEverything/qContainsPoint | only | `qEverything` 1 | model check 1 |
| `cad-project-002/sc15-adaptation/universal-connector.fs` | fs19 (rep) | 1/1 | same doc | no loadedContext, qEverything/qContainsPoint | only | `qEverything` 1 | model check 1 |
| `cad-project-002/funnel-holder-r2/guide-before.fs` | fs20 | 1/1 | same doc | no loadedContext, other query | only | `qEverything` 1 | `qEverything` 1 |
| `cad-project-002/funnel-holder-r2/guide-r2.fs` | fs20 | 1/1 | same doc | no loadedContext, other query | only | `qEverything` 1 | `qEverything` 1 |
| `cad-project-002/funnel-holder-r3/guide-r3.fs` | fs20 | 1/2 | same doc | no loadedContext, other query | shared | `qEverything` 1 | `qEverything` 1 |
| `cad-project-002/funnel-holder-r4/baseline-canonical/universal-guide.fs` | fs20 | 1/1 | same doc | no loadedContext, other query | only | `qEverything` 1 | `qEverything` 1 |
| `cad-project-002/funnel-holder-r4/guide-r4.fs` | fs20 (rep) | 1/2 | same doc | no loadedContext, other query | shared | `qEverything` 1 | `qEverything` 1 |
| `cad-project-014/corner-post-base.fs` | fs36 (rep) | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | boolean-capability 1 |
| `cad-project-014/corner-post-underside-archive.fs` | fs38 (rep) | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | boolean-capability 1 |
| `cad-project-014/design-system/sorter-palette-r2/reference-palette.fs` | fs63 (rep) | 1/1 | other doc | other query | only | model check 1 | model check 1 |
| `cad-project-014/machine-interface-r11/top-full-module-r4/native/module-r4-upload.fs` | fs84 (rep) | 10/17 | other doc | code, no loadedContext, qEverything/qContainsPoint | shared | boolean-capability 2, model check 1, `opTransform` 5, `qGeometry` 2 | boolean-capability 2, model check 1, `opTransform` 5, `qGeometry` 2 |
| `cad-project-014/machine-interface-r11/top-full-module-r4/module-r4.fs` | fs85 (rep) | 3/5 | other doc | code, no loadedContext, qEverything/qContainsPoint | only | `opTransform` 3 | `opTransform` 3 |
| `cad-project-014/machine-interface-r11/top-full-module-r4/native/pre-retention-static/module-r4.fs` | fs85 | 3/5 | other doc | code, no loadedContext, qEverything/qContainsPoint | only | `opTransform` 3 | `opTransform` 3 |
| `cad-project-014/machine-interface-r11/top-motor-down-r2/structure/top-structure-r1.fs` | fs87 (rep) | 4/9 | other doc | no loadedContext, qEverything/qContainsPoint | shared | `opTransform` 4 | `opTransform` 4 |
| `cad-project-014/machine-interface-r11/top-motor-down-r2/upper-drive-r2.fs` | fs87 | 3/4 | other doc | no loadedContext, qEverything/qContainsPoint | shared | `opTransform` 2, boolean-capability 1 | `opTransform` 2, boolean-capability 1 |
| `cad-project-014/machine-interface-r11/top-motor-down-r3/upper-drive-r3.fs` | fs88 (rep) | 4/9 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 1, `opTransform` 3 | model check 1, `opTransform` 3 |
| `cad-project-014/bottom-drive-review-2026-09-19/baseline/native-source.fs` | fs95 | 9/26 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 8, ok 1 | model check 8, ok 1 |
| `cad-project-014/bottom-drive-review-2026-09-19/candidate/native-source.fs` | fs95 | 9/26 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 8, ok 1 | model check 8, ok 1 |
| `cad-project-014/bottom-drive-review-2026-09-19/iterations/r12-0/native-source.fs` | fs95 | 9/26 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 8, ok 1 | model check 8, ok 1 |
| `cad-project-014/bottom-drive-review-2026-09-19/iterations/r12-1/native-source.fs` | fs95 | 9/26 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 8, ok 1 | model check 8, ok 1 |
| `cad-project-014/deliverables/Bottom_Interface_R10_Design_System/machine-interface-r10/interface-r10.fs` | fs95 | 8/24 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 7, ok 1 | model check 7, ok 1 |
| `cad-project-014/deliverables/Bottom_Interface_R9_Tapered_Joints/Source/interface-r9.fs` | fs95 | 8/24 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 7, ok 1 | model check 7, ok 1 |
| `cad-project-014/deliverables/Sorter_V2_Bottom_Interface_R6/Source/interface-r6.fs` | fs95 | 7/22 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 6, ok 1 | model check 6, ok 1 |
| `cad-project-014/deliverables/Sorter_V2_Printed_Interface_R3/Source/interface-r3.fs` | fs95 | 4/16 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 4 | model check 4 |
| `cad-project-014/deliverables/Sorter_V2_Printed_Interface_R5/Source/interface-r5.fs` | fs95 | 5/19 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 5 | model check 5 |
| `cad-project-014/machine-interface-r11/refinement-prep/interface-r11-prepared.fs` | fs95 | 9/26 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 8, ok 1 | model check 8, ok 1 |
| `cad-project-014/machine-interface-r11/top-entry-r12/baseline/interface-r11.fs` | fs95 | 9/26 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 8, ok 1 | model check 8, ok 1 |
| `cad-project-014/machine-interface-r4/interface-r4.fs` | fs95 | 5/19 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 5 | model check 5 |
| `cad-project-014/machine-interface-r7/interface-r7.fs` | fs95 | 8/24 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 7, ok 1 | model check 7, ok 1 |
| `cad-project-014/machine-interface-r8/interface-r8.fs` | fs95 | 8/24 | other doc | no loadedContext, qEverything/qContainsPoint | shared | model check 7, ok 1 | model check 7, ok 1 |
| `cad-project-014/platforms-underside-archive.fs` | fs116 (rep) | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/corner-post-r1.fs` | fs126 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `evSurfaceDefinition` 1 |
| `cad-project-014/post-r2/corner-post-r2.fs` | fs126 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `evSurfaceDefinition` 1 |
| `cad-project-014/deliverables/Distributor_Platforms_R12/Source/platforms-r12.fs` | fs131 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/deliverables/Distributor_Platforms_R15/Source/platforms-r15.fs` | fs131 (rep) | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/deliverables/project-component-af20769e_R3/source/Honeycomb_Platforms_R3.fs` | fs131 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/deliverables/project-component-af20769e_R4/source/Honeycomb_Platforms_R4.fs` | fs131 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/deliverables/project-component-af20769e_R5/source/Honeycomb_Platforms_R5.fs` | fs131 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/deliverables/project-component-af20769e_R6/source/Platforms_R6.fs` | fs131 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/deliverables/project-component-af20769e_R7/source/Compact_Platforms_R7.fs` | fs131 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/deliverables/project-component-af20769e_R7/source/Standard_Platforms_R7.fs` | fs131 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/frame-joints-r13/frame-underbeam-r13.fs` | fs131 | 2/2 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 2 | `opTransform` 2 |
| `cad-project-014/platforms-compact-r10/platforms-compact-r10.fs` | fs131 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/platforms-compact-r9/platforms-compact-r9.fs` | fs131 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/platforms-r1.fs` | fs131 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/platforms-r14/platforms-r14.fs` | fs131 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-014/surface-options-r2/platform-surface-r2.fs` | fs131 | 1/1 | other doc | no loadedContext, qEverything/qContainsPoint | only | `qNthElement` 1 | `opTransform` 1 |
| `cad-project-039/belt-fixed-r30/discharge-guides-r6/discharge-r6.fs` | fs325 (rep) | 1/1 | same doc | no loadedContext, qEverything/qContainsPoint | only | `qContainsPoint` 1 | boolean-capability 1 |
| `cad-project-039/belt-fixed-r30/rail-transition-r7/rail-ends-r7.fs` | fs342 (rep) | 1/1 | same doc | no loadedContext, qEverything/qContainsPoint | only | `qContainsPoint` 1 | `qContainsPoint` 1 |
| `cad-project-039/cad-project-005/rotor-experiments-r1.fs` | fs392 (rep) | 1/1 | other doc | other query | only | fs-needs-partstudio-input 1 | fs-needs-partstudio-input 1 |
| `cad-project-040/src/buildplate-r16-rear.fs` | fs458 (rep) | 1/1 | same doc | no loadedContext, makeId query | only | `makeId` 1 | `opTransform` 1 |
| `cad-project-040/src/studies/buildplate-r17-frame.fs` | fs460 (rep) | 1/1 | same doc | no loadedContext, makeId query | only | `makeId` 1 | `opTransform` 1 |
| `cad-project-040/var/cache/buildplate-diagnostic.fs` | fs465 (rep) | 1/1 | same doc | no loadedContext, makeId query | only | `makeId` 1 | `opTransform` 1 |
| `cad-project-041/archiv/rocking-tray-r1-r6c/rocking-photo-tray-r4/final/Single_Step_A1_Rocker_R4/native/csg/r4-native.fs` | fs479 (rep) | 1/1 | same doc | name table | only | `qClosestTo` 1 | `qClosestTo` 1 |
| `cad-project-041/archiv/rocking-tray-r1-r6c/rocking-photo-tray-r6b/final/Single_Step_A1_Rocker_R6b/native/r6b.fs` | fs489 (rep) | 1/1 | same doc | transform, name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/archiv/rocking-tray-r1-r6c/rocking-photo-tray-r6b/review/before-overtravel-clearance/r6b.fs` | fs489 | 1/1 | same doc | transform, name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/archiv/rocking-tray-r1-r6c/rocking-photo-tray-r6b/review/before-throat-transition/r6b.fs` | fs489 | 1/1 | same doc | transform, name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/archiv/rocking-tray-r1-r6c/rocking-photo-tray-r6b/review/first-candidate/r6b.fs` | fs489 | 1/1 | same doc | transform, name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/archiv/rocking-tray-r1-r6c/rocking-photo-tray-r6b/review/second-candidate/r6b.fs` | fs489 | 1/1 | same doc | transform, name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/archiv/rocking-tray-r1-r6c/rocking-photo-tray-r6c/final/Single_Step_A1_Rocker_R6c/native/r6c.fs` | fs491 (rep) | 1/1 | same doc | name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/archiv/studien/rocking-photo-tray-r6d-streamcam-r1/native/streamcam_r1.fs` | fs492 (rep) | 1/1 | same doc | transform, name table | only | `rotationAround` 1 | `rotationAround` 1 |
| `cad-project-041/camera-arm-stiffness-2026-09-19/var/native/source.fs` | fs495 (rep) | 1/1 | same doc | transform, other query | only | model check 1 | boolean-invalid-topology 1 |
| `cad-project-041/obsbot-free-rotation-2026-09-19/iterations/cylindrical-mask-rejected/var/native/source.fs` | fs499 (rep) | 2/2 | same doc | transform, name table | only | `rotationAround` 2 | `rotationAround` 2 |
| `cad-project-041/obsbot-free-rotation-2026-09-19/var/native/source.fs` | fs503 (rep) | 2/2 | same doc | transform, name table | only | `rotationAround` 2 | `rotationAround` 2 |
| `cad-project-041/rocking-photo-tray-r6d-bereinigung/var/native/frame_r2.fs` | fs508 (rep) | 1/1 | same doc | name table | only | ok 1 | ok 1 |
| `cad-project-041/rocking-photo-tray-r6d-bereinigung/var/native/hopper_floor_r2.fs` | fs508 | 1/1 | same doc | name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/rocking-photo-tray-r6d-hopper-floor-r1/native/hopper_floor_r1.fs` | fs508 | 1/1 | same doc | name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/rocking-photo-tray-r6d-bereinigung/var/native/tray_r2.fs` | fs511 (rep) | 1/1 | same doc | name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/rocking-photo-tray-r6d-tray-r1/native/tray_r1.fs` | fs511 | 1/1 | same doc | name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/single-step-r10/designs/direct-drop/direct-drop.fs` | fs517 (rep) | 1/1 | same doc | name table | only | snapshot gap (rebind) 1 | kernel-sketch-and-ops 1 |
| `cad-project-041/single-step-r10/designs/fixed-integration/fixed-integration.fs` | fs541 | 1/1 | same doc | name table | only | snapshot gap (rebind) 1 | boolean-capability 1 |
| `cad-project-041/single-step-r10/jobs/r10b/r59b.fs` | fs541 (rep) | 1/1 | same doc | name table | only | boolean-invalid-topology (rebind) 1 | boolean-invalid-topology 1 |
| `cad-project-041/single-step-r10/jobs/transfer-lip-variants/transfer-edge.fs` | fs541 | 1/1 | same doc | name table | only | boolean-capability (rebind) 1 | boolean-invalid-topology 1 |
| `cad-project-041/rocking-photo-tray-r6d/final/Single_Step_A1_Rocker_R6d/native/r6d.fs` | fs542 | 1/1 | same doc | transform, name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/rocking-photo-tray-r6d/review/candidate-01/r6d.fs` | fs542 | 1/1 | same doc | transform, name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/rocking-photo-tray-r6d/review/candidate-02/r6d.fs` | fs542 | 1/1 | same doc | transform, name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/rocking-photo-tray-r6d/review/candidate-03/r6d.fs` | fs542 | 1/1 | same doc | transform, name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/single-step-r10/native/base-source-before.fs` | fs542 (rep) | 1/1 | same doc | transform, name table | only | boolean-invalid-topology 1 | boolean-invalid-topology 1 |
| `cad-project-041/single-step-r10/native/core.fs` | fs543 (rep) | 1/1 | same doc | name table | only | snapshot gap (rebind) 1 | kernel-sketch-and-ops 1 |
| `cad-project-041/single-step-r10/review/before-20260920-user-corrections/native/core.fs` | fs544 (rep) | 1/1 | same doc | name table | only | snapshot gap (rebind) 1 | kernel-sketch-and-ops 1 |
| `cad-project-041/single-step-r10/dist/R10b_Print_Package/r10b-uploaded-snapshot.fs` | fs549 | 7/9 | same doc | name table | shared | boolean-invalid-topology (rebind) 5, boolean-capability (rebind) 2 | boolean-invalid-topology 6, boolean-capability 1 |
| `cad-project-041/single-step-r10/jobs/r10b/axis-x-candidate/frames.fs` | fs549 | 1/1 | same doc | name table | only | snapshot gap (rebind) 1 | kernel-sketch-and-ops 1 |
| `cad-project-041/single-step-r10/jobs/r10b/frames.fs` | fs549 | 1/1 | same doc | name table | only | snapshot gap (rebind) 1 | kernel-sketch-and-ops 1 |
| `cad-project-041/single-step-r10/jobs/r10b/pass3/camera/r10b.fs` | fs549 (rep) | 8/10 | same doc | name table | shared | boolean-invalid-topology (rebind) 5, boolean-capability (rebind) 2, ok (rebind) 1 | boolean-invalid-topology 6, boolean-capability 1, ok 1 |
| `cad-project-041/single-step-r10/jobs/r10b/pass3/edge-pinion/r10b.fs` | fs549 | 8/10 | same doc | name table | shared | boolean-invalid-topology (rebind) 5, boolean-capability (rebind) 2, ok (rebind) 1 | boolean-invalid-topology 6, boolean-capability 1, ok 1 |
| `cad-project-041/single-step-r10/jobs/r10b/pass3/tray-gap/base-5d2d586d.fs` | fs549 | 8/10 | same doc | name table | shared | boolean-invalid-topology (rebind) 5, boolean-capability (rebind) 2, ok (rebind) 1 | boolean-invalid-topology 6, boolean-capability 1, ok 1 |
| `cad-project-041/single-step-r10/jobs/r10b/pass3/tray-gap/ee691ede-reconstructed.fs` | fs549 | 8/10 | same doc | name table | shared | boolean-invalid-topology (rebind) 5, boolean-capability (rebind) 2, ok (rebind) 1 | boolean-invalid-topology 6, boolean-capability 1, ok 1 |
| `cad-project-041/single-step-r10/jobs/r10b/pass3/tray-gap/r10b.fs` | fs549 | 8/10 | same doc | name table | shared | boolean-invalid-topology (rebind) 5, boolean-capability (rebind) 2, ok (rebind) 1 | boolean-invalid-topology 6, boolean-capability 1, ok 1 |
| `cad-project-041/single-step-r10/jobs/r10b/r10b-uploaded-snapshot.fs` | fs549 | 8/10 | same doc | name table | shared | boolean-invalid-topology (rebind) 5, boolean-capability (rebind) 2, ok (rebind) 1 | boolean-invalid-topology 6, boolean-capability 1, ok 1 |
| `cad-project-043/fsocct/cases/r10b/r10b.fs` | fs549 | 8/10 | same doc | name table | shared | boolean-invalid-topology (rebind) 5, boolean-capability (rebind) 2, ok (rebind) 1 | boolean-invalid-topology 6, boolean-capability 1, ok 1 |
| `cad-project-043/fsocct/examples/canonical_m3_tool.fs` | fs562 (rep) | 1/1 | local-path | code | only | ok 1 | ok 1 |
