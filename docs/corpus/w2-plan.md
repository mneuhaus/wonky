# W2 plan: construction precision (K1, K2, K6, pierce gate)

Date: 2026-09-23, 18:30. This is a plan. It changes no production file.

Sources:

- [corpus-triage.md](../corpus-triage.md) §6 W2 (scope and acceptance), §4 and §5;
- [cluster-boolean-invalid-topology.md](cluster-boolean-invalid-topology.md) §3 and §4 (fix design);
- [cluster-kernel-sketch-and-ops.md](cluster-kernel-sketch-and-ops.md) §2.1, §2.3, §2.4 and §3 (r10b `r10bSideDrive` chain);
- [cluster-boolean-capability.md](cluster-boolean-capability.md) §4, pierce v2 step 0 (the gate fix);
- the code at the lines named below, read at 18:20.

## 1. The acceptance criteria (from the triage, §6 W2)

| # | criterion | owned by task |
|---|---|---|
| A1 | none of the 57 `boolean-invalid-topology` units ends in `InvalidTopology (stage 1` | D measures, F confirms on the corpus |
| A2 | `archive-strip-only.fs` (fs552) builds in production; its STEP passes `uv run scripts/validate-step.py <prefix>` | D |
| A3 | `cap-normal-far-from-origin.fs`, `through-hole-tilted-panel.fs` and `collinear-polyline-vertex.fs` build | D |
| A4 | `test/pierce.test.mjs` stays green | A, then every later task |
| A5 | `r10bSideDrive` reaches `g7` (the general Boolean) | D |
| A6 | the 10 cap-normal units and the 15 collinear units leave `kernel-sketch-and-ops` | F |
| A7 | the triage's standing rules: no corpus regression, the 7 (now 8) built units keep their volumes, `npm test` green, the r10b anchor unchanged or better | F |
| A8 | one shared re-baseline: native slice bit-identical to JS, WK precision contract moved with it | E |

## 2. Design decisions this plan fixes

These follow the cluster reports. A task may refine them. It must record why in its worklog.

1. **A new Bend module `kernel/polygon-prism.bend`** on `kernel/precise.bend` (F32x2), with its own
   polyhedral types (`G.Vec3` precise vertices and face frames, `T.Edge`/`T.Coedge` topology). It does not change
   `kernel/topology.bend`: that module's `Solid`/`Face` types are imported by about 40 kernel modules, and
   `kernel/lang/wk/real.bend` calls `T.extrude`/`T.transform` directly.
   - `extrude`: the profile in sketch coordinates, one F32x2 frame and the sweep. It builds the prism in the
     sketch frame (caps exactly on z = 0 and z = h), then applies one F32x2 rigid transform to world
     (`construct_frame` in `kernel/sketch-arcs.bend:578` is the pattern).
   - **Oblique sweeps stay.** The sweep is expressed in the frame. Caps are z = 0 and its translate. Each side
     carrier has the normal `cross(edge tangent, sweep)`. A refusal of oblique sweeps is a regression
     (`R10b_Print_Package` `nose`).
   - `transform`: an F32x2 rigid transform of such a body (vertices and face frames with `precise.rotate`).
   - An **O(n) incidence audit**: every vertex against its own face carriers, compared with
     `angular_guard × scale`, the planar arrangement's own admission (`kernel/ports/curved-validate.bend:29`).
     Above that: an explicit refusal. There is no O(n²) audit. The line/arc extruder's audit took 29 s for 192
     points (cluster report §4, item 3).
2. **The body format stays polyhedral.** Edges are `curve: 'line'` without `curveRange`, faces are `plane`.
   New fields are `precision: 'F32x2'` and a construction method name. Every downstream gate
   (`booleanInBend`, pierce, identity, print mesh) keeps working. F32x2 words decode to float64 exactly
   (48 bits), and `src/real.mjs` `real()` re-encodes them. The round trip must be proven bit-identical in a
   test.
3. **The adapters keep their signatures.** `extrudeInBend`/`transformInBend` in `src/kernel.mjs` change
   inside. None of their callers changes. The callers are `src/library.mjs:255` (W1), `src/queries.mjs:247`
   (W1), `src/python.mjs:73,85` (W5), `src/lang/surface/backend-js.mjs` and `src/lang/wk/eval-js.mjs`. So
   **W2 needs no edit in a W1, W4 or W5 file.**
4. **K2 runs in Bend: a new `kernel/profile-ring.bend`.** It is a ring simplification that returns the kept
   indices and, for each merged vertex, its deviation. The collinearity sign is exact on the F32x2 words, using
   the `Big` arithmetic of `kernel/robust-predicates.bend`. A backtracking corner (the middle vertex outside
   the segment) is never merged and stays a self-touch refusal.
   - **Exact merge** (deviation 0): always. This covers the 8 r10b rack units.
   - **Near-collinear merge** (0 < deviation ≤ `tolerance(points)` in `src/brep.mjs:14`): today's
     "nearly collinear" refusal uses the same threshold. The merge is recorded as a stated-tolerance
     regularization: `construction.profileMerge = {kept, merged: [{index, deviationMm}], toleranceMm}` and
     `exactness: 'regularized'` in brep.json.
     **Decision for Marc:** allow this under `strict`? If not, the 6 `bottomSpoke` units (1.8e-9 mm) and
     `archive-r15/hopper.fs` (up to 2.9e-4 mm) keep a refusal. A6 then becomes "8 of 15".
   - **Where it is called:** `src/brep.mjs` `validatePolygon` admits non-backtracking collinear corners of a
     profile. `validateSolid` gets a strict face-loop check (`validateFaceLoop`) that still refuses them.
     `extrudeInBend` merges before it builds. `library.mjs` keeps calling `validatePolygon` unchanged.
5. **K6: a host limit of 4096 vertices**, raised only after measuring the O(n²) self-intersection test and the
   new prism at 470 and 4096 vertices. The planar arrangement's own 256/512/256 limit stays and refuses
   explicitly.
6. **The pierce gate** (`src/boolean.mjs:107-126`), boolean-capability §4 step 0:
   - `curveRange` is refused only on circle edges. Lines are admitted, because pierce reads a line through
     its vertices.
   - A target with `validation.volumeMm3 == null` gets a named `unsupported(...)`, instead of the
     `real(null)` RangeError.
   - `'native Bend through-hole pierce'` is added to the rigid-transform list of `transformAnalytic`
     (`src/analytic.mjs`), with its volume and construction kept.
7. **Last-bit changes are accepted once.** Every polygon body changes in its last bits (93.30000305 becomes
   93.3). One re-baseline covers the kernel, identity and Python tests, the native slice and the WK goldens.
   It happens in wave 3, after the geometry is final.

## 3. Tasks

Three waves. Within a wave, the files are disjoint. Each task follows the checkpoint protocol under
local development evidence. Commands over 2 minutes (a full `npm test` takes about 12 minutes, and corpus
cluster runs take longer) are started in the background, with a log and a `.done` marker next to the worklog.
At most 3 wonky processes run for the corpus.

### Wave 1 (parallel)

#### A `pierce-gate`: the pierce gate and the pierce-after-copy crash

- **Goal:** `opBoolean` through holes accept ranged line edges and refuse a target without a certified
  volume explicitly. A rigid copy of a pierced body keeps its volume.
- **Files:** `src/boolean.mjs`, `src/analytic.mjs` (only the method list in `transformAnalytic`; W1 edited
  this file at 17:35 and is done, so re-read it first), `test/pierce.test.mjs` (append only).
- **Acceptance:**
  - `node bin/wonky.mjs fixtures/corpus-repro/kernel-sketch-and-ops/next-pierce-after-copy.fs --check`
    builds. It gives no RangeError, and its volume equals the closed form (write it into the test).
  - New tests:
    1. a pierce into a body whose line edges carry `curveRange` (for example a line-only sketch-arcs extrusion)
       succeeds;
    2. a target with `volumeMm3 = null` gets a named capability error with a source location;
    3. a pierce, then `opPattern`, then a second pierce yields the exact volume.
  - A body with a ranged **circle** edge is still refused.
  - `node --test test/pierce.test.mjs test/boolean.test.mjs test/analytic.test.mjs` is green.
- **Note:** this task changes no Bend file and no native hash.

#### B `prism-bend`: an F32x2 polygon prism and rigid transform in Bend

- **Goal:** `kernel/polygon-prism.bend` with `extrude` (normal and oblique sweep), `transform` and the O(n)
  audit (decision 1). The task proves the module in isolation. It is not wired into production yet.
- **Files:** `kernel/polygon-prism.bend` (new), `test/polygon-prism.test.mjs` (new; loads the module with
  `loadBend` directly, as `test/sketch-arcs-native.test.mjs` does), `docs/polygon-prism.md` (new, short:
  contract, tolerance, refusals).
- **Acceptance** (float64 checks in the test, diagnosis only):
  - The wedge of `wedge-union.fs#slanted`, the far tilted octagon of `cap-normal-far-from-origin.fs` and a
    600 mm box rotated as in `rotated-box-cut.fs`: every vertex lies within `1e-12 × scale` of each of its
    face carriers. Today the F32 path misses by 7.7e-7, 6.7e-4 and 3.6e-5 mm.
  - The cap normals equal the F32x2 image of +z.
  - An oblique sweep (`(1, sin 25°·k, cos 25°·k)` from a plane with normal `(1, 0, 0)`, the `nose` case)
    builds with parallelogram sides within the same bound.
  - A degenerate sweep, a zero-length edge or an audit above the bound gives a named refusal, not a body.
  - Timing on the JS target for 4, 192, 470 and 4096 vertices, with `uptime`. It must grow about linearly.
  - `npm run check:bend` is green.

#### C `profile-ring`: exact collinear merge and the vertex limit (K2, K6)

- **Goal:** `kernel/profile-ring.bend` (decision 4) and the host side in `src/brep.mjs`, meaning the profile
  versus face-loop split and the vertex limit (decision 5). It is not yet called from `extrudeInBend`.
- **Files:** `kernel/profile-ring.bend` (new), `src/brep.mjs`, `test/profile-ring.test.mjs` (new), and
  `test/kernel.test.mjs`, but only for assertions on the old "3–256 vertices" and "collinear" messages, if
  any exist.
- **Acceptance:**
  - Kernel tests:
    - the r10b rack case (`g0`, exactly collinear) merges with deviation 0;
    - a 1.8e-9 mm case merges as regularized with its deviation;
    - a backtracking corner is refused;
    - kept indices are returned in source order;
    - merging never produces a ring below 3 vertices.
  - `validatePolygon` admits collinear non-backtracking corners and a 470-vertex ring. It still refuses
    self-intersection, backtracking, short edges and over 4096 vertices.
  - `validateSolid` still refuses collinear face loops.
  - The O(n²) self-intersection test is measured at 470 and 4096 vertices (numbers in the worklog). If
    4096 takes more than 1 s, pick the limit from the measurement and write it down.
  - `node --test test/profile-ring.test.mjs test/kernel.test.mjs` is green. Until task D lands,
    `collinear-polyline-vertex.fs` may still fail, but only with the face-loop message.

### Wave 2

#### D `wire-production`: production uses the prism, and the repros build

- **Goal:** `extrudeInBend` = profile-ring merge, then `polygonPrism.extrude` with F32x2 inputs
  (`src/real.mjs` `vector`, not `Math.fround`), then decode with `precision: 'F32x2'` and
  `construction.profileMerge`. `transformInBend` = `polygonPrism.transform`. Wire both modules into
  `loadJsKernel` as plain `loadBend` fields; `src/native/kernel-wiring.mjs` parses only that form.
  - Identity: `I.extrusion` runs over the kept count. The metadata carries the kept indices, so a side face
    names the source edges it spans.
  - `startOffset` goes into the world offset of the one rigid transform.
- **Files:** `src/kernel.mjs`, `src/identity.mjs` (only if the kept-index metadata needs it),
  `fixtures/corpus-repro/kernel-sketch-and-ops/README.md` and
  `fixtures/corpus-repro/boolean-invalid-topology/README.md` (observed output after W2).
- **Acceptance** (production CLI, JS path, `strict`):
  - A3: `cap-normal-far-from-origin.fs` `tiltedOctagonFar` and `tiltedRectangleFar` build (about
    7677.8832 mm³ each), and the control is unchanged. `through-hole-tilted-panel.fs` builds with the
    closed-form volume. `collinear-polyline-vertex.fs` builds. `profile-over-256-vertices.fs` builds.
  - The repros of the invalid-topology cluster give the simulated results of its report §2:
    - `wedge-union.fs#slanted` gives 319 mm³, and `#diag45`/`#square` are unchanged;
    - `slanted-prism-union.fs` gives 206767.2 mm³;
    - `slanted-prism-cut.fs` gives 48766.667 mm³;
    - `rotated-box-cut.fs` gives 36339.2345 mm³;
    - `slanted-prism-intersection.fs` gives 43659.488 mm³;
    - `many-vertex-prism-cut.fs` keeps the input-size refusal;
    - `next-blocker-chamfer.fs#chamferOnEdge` reaches `AmbiguousContact (stage 2`, `#slantedCut` reaches
      `UnsupportedArrangement (stage 6`, and `#chamfer45` gives 1904 mm³.
  - `next-tilted-pocket-subtraction.fs` moves to `UnsupportedArrangement (stage 6`.
  - A2: `node bin/wonky.mjs ~/Workspace/cad/cad-project-039/hopper-corner-inserts-r2/archive/rejected-strips/archive-strip-only.fs --format step --out tmp/w2/strip/model`
    builds 2 bodies. `uv run scripts/validate-step.py tmp/w2/strip/model` passes.
  - A5: `node bin/wonky.mjs fixtures/r10b/r10b.fs --check --feature r10bSideDrive` stops at `g7` with the
    general trimmed-face refusal, after about 31 modeling calls.
    - Also recorded: `--feature r10bTransferEdge` gets past `30:27 InvalidTopology`, with
      `AmbiguousContact` expected in `apronCrest`.
    - Also recorded: `singleStepR10b` (default policy) is unchanged or further. Record the wall time against
      the 58 s baseline.
  - `node --test test/pierce.test.mjs test/polygon-prism.test.mjs test/profile-ring.test.mjs` is green.
  - A full `npm test` runs in the background. Its failures go to
    local development evidence, split into pinned last-bit values (expected, for E and F) and
    anything else. **Anything else is fixed in D.**
- **Expected breakage handed to wave 3:**
  - the native slice is stale: `loadJsKernel` wiring and the entry set changed;
  - the WK oracle tests (`test/lang-wk-real.test.mjs`, `test/lang-surface.test.mjs`) fail;
  - the pinned polygon values in the kernel, boolean and identity tests fail.

### Wave 3 (parallel)

#### E `rebaseline-native-wk`: the shared re-baseline of the native slice and the WK precision contract

- **Goal:** the native slice and the language work's evaluator follow the F32x2 prism in one step.
  - **Native:**
    - In `scripts/native-bridge/slice-ops.mjs` `SLICE_OPS`, replace `topology.bend:extrude`, `:transform`,
      `geometry.bend:frame`, `:lift_points` and `:translate` with the entries `extrudeInBend`/`transformInBend`
      now call.
    - Re-measure `out/native-bridge/profile/calls/*.json` for the 8 workloads with
      `scripts/native-bridge/count-kernel-calls.mjs`.
    - Regenerate `out/native-bridge/surface.json` with `surface-scan.mjs`.
    - Run `node scripts/native-bridge/build-native.mjs --set planar`.
  - **WK:**
    - `kernel/lang/wk/real.bend` op 1 (`extrude_polygon`, around line 922) and op 3 (`transform` of a
      polyhedral body, around line 1091) call the prism entries.
    - In `src/lang/wk/real-host.mjs`, `CONTRACT` becomes F32x2 for `extrude_polygon` and for the polyhedral
      `transform`. The literal canonicalization no longer merges literals that round to the same F32.
    - Update the table in `docs/language/proposal-core-ir.md` §2.2.
- **Files:** `scripts/native-bridge/slice-ops.mjs`, `out/native-bridge/**`, `src/native/**` (only if the
  build needs it), `docs/native-bridge/slice.md` (a short note on the re-baseline), `kernel/lang/wk/real.bend`,
  `src/lang/wk/*.mjs`, `docs/language/proposal-core-ir.md`, `test/native-bridge*.test.mjs`,
  `test/lang-*.test.mjs`.
- **Acceptance:**
  - `node scripts/native-bridge/slice-ops.mjs --check` exits 0.
  - The build succeeds: a new `sourceHash`, and a second run is a cache hit.
  - `node --test test/native-bridge*.test.mjs` is green.
  - The 6 slice workloads are byte-identical on `WONKY_BACKEND=native` and on `js` (`brep.json` without the
    backend block, `.step`, stdout).
  - `WONKY_BACKEND=diff` over the 3 FS workloads gives word-identical calls.
  - Both negative workloads still fail loudly, with no JS kernel loaded.
  - `node --test test/lang-*.test.mjs` is green, and the WK bodies are bit-identical to the production oracle.
- **Coordination:** before starting, check that nobody else is editing `kernel/lang/**`/`src/lang/**` (their
  last change was 06:50). If someone is, hand them the diff instead.

#### F `rebaseline-and-corpus`: pinned values, corpus acceptance and the report

- **Goal:** re-baseline the pinned last-bit values, run the corpus acceptance, and write `docs/corpus/w2.md`.
- **Files:** the tests named in `rebaseline-list.md` other than native and lang. That is expected to be
  `test/kernel.test.mjs`, `test/planar-boolean-native.test.mjs`, `test/planar-boolean-integration.test.mjs`,
  `test/boolean-stress.test.mjs`, `test/identity.test.mjs`, `test/python.test.mjs`, and
  `fixtures/boolean-stress/provenance.json` if it pins r10b `g7`/`g9` volumes. `docs/corpus/w2.md` is new.
  - `test/python.test.mjs`: W5's worklog shows it done. Edit only the pinned numbers there. If W5 is active
    again, hand it the diff.
  - `fixtures/r10b/**` is never touched.
- **Acceptance:**
  - Every re-baselined value is listed in `w2.md` with old value, new value and relative change. A change
    larger than about 1e-6 relative, or any change in topology counts, is a finding and is not re-baselined
    blindly. This covers the r10b freeze volumes 51985.642486572266 and 56948.083435058594.
  - Corpus, labelled `w2`, at most 3 processes, in the background with markers:
    - `run.mjs --label w2 --cluster boolean-invalid-topology`;
    - `--cluster kernel-sketch-and-ops`;
    - `--phase 0`;
    - `--keys-file` with the ok units of the latest full label;
    - then `summarize.mjs --label w2`, `compare.mjs --label w2`, and `compare.mjs --label w2 --base w1-fix`.
  - A1 means 0 units with `InvalidTopology (stage 1`. A6 means the 10 cap-normal and 15 collinear units
    (8 if Marc refuses the regularized merge) are out of the cluster. A7 means no regressions and the ok
    volumes are bit-identical.
  - `uv run scripts/validate-step.py` passes on the fs552 STEP and on every ok unit's STEP.
  - A final `npm test` runs after E's and F's `.done` markers exist, and it is green (known unrelated failures
    listed by name).
  - `docs/corpus/w2.md` reports A1 to A8 with evidence, the new first blockers of the moved units, timings on
    the JS path (the anchor against its 58 s), and the follow-ups below.

## 4. Follow-ups outside W2's files (no edit by W2)

1. **hybrid-gate (`scripts/bakeoff/**`):** the bake-off tessellator refuses F32x2 prism faces
   (`collinear repair diverged`, 15 units, boolean-capability §5). W3/K8 needs this fixed before recover can
   take the new prisms. The leaf intake at `scripts/bakeoff/tessellate.mjs:488` (1e-9 mm) should admit them.
2. **W1 (`src/library.mjs:507`), optional:** line-segment sketches reach `body()` as F32-quantized points
   (`kernel/sketch-lines.bend` `quantize`). They stay admissible and exact-constructed after W2, so this is
   not needed for acceptance. Once the prism has landed, passing the unquantized points would drop that
   rounding. D writes the exact diff into its worklog if it measures a benefit.
3. **Kernel, not W2 acceptance:** split the stage-1 refusal of `kernel/ports/planar-boolean.bend` into a
   family refusal and an input-size refusal (`ResolutionLimit`, detail 1). That fixes the misleading message
   of `channel-bases-r7` (invalid-topology report §4, item 4). It changes the native hash, so land it before
   E or not at all in W2.
4. **Language:** `src/lang/wk/record-fs.mjs:185` and `stage-fs.mjs:525` import `validatePolygon` from
   `src/brep.mjs`. They get the new profile semantics automatically. E checks that the WK graphs record the
   merge.
