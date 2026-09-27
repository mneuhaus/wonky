# Cluster: feature expects existing Part Studio parts (`fs-needs-partstudio-input`)

Failure analysis for cluster 4 of the [corpus run](run.md): 51 files, 27 families,
all FeatureScript.

- First pass: 2026-09-22 23:49 to 2026-09-23 00:12.
- Second pass (this revision): 2026-09-23 04:12 to 04:34. It re-checks the first
  pass against the current tree, corrects the cause of the dominant next
  blocker and probes two levels deeper.

Repository HEAD `79bbfee` plus the working tree. The production files this
analysis depends on (`src/index.mjs`, `library.mjs`, `queries.mjs`,
`modules.mjs`, `analytic.mjs`, `boolean.mjs`, `parser.mjs`) have not changed
since the first pass. Default JS path (`WONKY_BACKEND` unset), at most 3 wonky
processes, `uptime` in section 7. Nothing under `src/`, `kernel/`, `bin/` or
`~/Workspace/cad` was changed.

Machine-readable results:

- `out/corpus/fs-needs-partstudio-input/files.json`: the per-file ladder. It
  holds the first blocker, level 1 (next blocker with a stand-in part), level 2
  (first non-Boolean blocker) and level 2 on the bake-off hybrid route, with an
  owner cluster for each.
- `out/corpus/cluster-fs-needs-partstudio-input.json` and
  `out/corpus/next-blocker-fs-needs-partstudio-input.jsonl`: first pass
  (lineage, first blocker, level 1).
- `out/corpus/fs-needs-partstudio-input/deep-next-blocker-{pass-all,hybrid-all}.jsonl`:
  level 2 raw records.
- `out/corpus/fs-needs-partstudio-input/level3-fixed-frame.jsonl`: level 3
  for two fixed-frame representatives.
- `out/corpus/fs-needs-partstudio-input/n3-recover.json`: the dominant next
  blocker on the bake-off routes.

## Answer in short

1. **This is not a wonky defect.** These files are edit-in-place features. Each
   one modifies a part that already sits in an Onshape Part Studio. The files
   say so themselves: "Apply only in a NEW COPY of the indicated original Part
   Studio", "Derive exactly one unchanged R25 178-mm side into a NEW Part
   Studio first". wonky runs every feature in an empty context. The model's own
   guard therefore throws before the first modeling call, and Onshape would
   throw the same way in an empty studio. The error is correct and explicit.
2. **49 of the 51 files belong here (25 of 27 families).** The other 2 are
   parser errors: `catch { }` without a binding is legal FeatureScript
   (Onshape's own `fillet.fs` uses `catch {}`), but wonky rejects it. The
   corpus probe counted them as model throws because the rejected line also
   contains `throw regenError(`. No other cluster analysis covers this parser
   gap yet.
3. **The 49 files are 6 design lineages, not 25 independent designs.** All of
   them edit parts from the project-component-db8a67a0 and sorter Onshape documents (section
   4).
4. **The fix is a Part Studio input:** a frozen snapshot of the parts that exist
   before the feature, loaded as modifiable bodies. It extends the existing
   frozen-module manifest and capture tooling, which is the same work that
   cluster 1 (module imports) needs. On its own it gets **none** of the 49
   files to build. Behind it come:
   - importer coverage for torus, extruded and spline surfaces (28 files);
   - exact `evVolume`/`evBox3d` over imported curved bodies, which every guard
     calls;
   - Booleans on imported bodies with curved faces (cluster 2);
   - for 11 of the fixed-frame files, Part Studio bodies imported from
     Onshape (`FrozenGuides::build`), i.e. cluster 1 as well.
5. **The blockers behind the guard do not depend on the input part, and they
   are other clusters' work.** They were measured with stand-in parts that
   satisfy the guards, level by level (section 4):

   | level | blocker | files | owner |
   |---|---|---:|---|
   | 1 | planar arrangement `InvalidTopology (stage 1)`, first subtraction | 21 | boolean-invalid-topology |
   | 1 | other `opBoolean` refusals | 12 | boolean-capability |
   | 1 | missing builtins (`opTransform` 7, `rotationAround` 2) | 9 | fs-missing-builtin |
   | 1 | sketch and extrude refusals (line/arc joins 5, plane frame 1) | 6 | kernel-sketch-and-ops |
   | 2 | line/arc sketch joins (`SelfIntersectionOrTouch`) | 20 | kernel-sketch-and-ops |
   | 2 | pierce-after-copy `RangeError` crash | 4 | kernel-sketch-and-ops (known, S) |
   | 2 | `evBox3d` over edges of any analytic body | 3 | library |
   | 3 | `opLoft` of non-circular profiles (fixed frame) | 2 of 2 probed | kernel-sketch-and-ops |

   Level 2 covers the 33 files whose level-1 blocker is a Boolean. The 3
   return-hardware files build on their stand-in once their Booleans pass, and
   the bake-off hybrid route builds those Booleans.
6. **Correction to the first pass: the 21-file subtraction fails on its
   operands, not on the Boolean.** The fixed-frame `n3 = n1 - n2` is refused at
   admission. The F32 polygon extruder leaves the 15°-slanted vertices
   2.5e-6 mm (n1) and 3.8e-5 mm (n2) off their face planes, and the allowance
   is 2.1e-10 mm. That is the root cause of the boolean-invalid-topology
   cluster. With its proposed fix (F32x2 prisms) simulated, the arrangement
   then stops at `AmbiguousContact (stage 2, detail 15)`. Detail 15 is n2 face
   6, which is coplanar with n1 face 2 at 1.0e-12 mm. Bake-off routes:

   | operands | `recover` (oracle mesh) | corefine → `recover` (all Bend) | exact-plane |
   |---|---|---|---|
   | today (F32) | leaf refused (2.5e-6 mm off surface) | not reached | not reached |
   | F32x2 (fix simulated) | exact, 13F/33E/22V, OCCT valid, 2.2e-15 | exact, same result, 54 + 18 ms JS | refused: ±1,024 mm box |

   The test-only hybrid glue (`scripts/corpus/boolean-hybrid.mjs`) does build
   today's F32 operands. Its result has the right topology but inherits the
   F32 error: the volume is off by 2.0e-7 relative.
7. **Priority for the adoption ladder: low.** These parts cannot be built from
   source by definition, because each depends on a proprietary Onshape part.
   Recommended:
   - count them as "needs Part Studio input", outside the build-from-source
     denominator;
   - fix the classifier and the `catch {}` parser gap for the 2 misfiled files;
   - build the Part Studio snapshot only together with cluster 1's capture
     work.

   The blockers behind the guard get fixed with clusters 2, 6, 7 and 10
   anyway. This cluster adds two sketch-join cases to cluster 6 (repro
   `next-blocker-line-arc-joins.fs`).

## 1. Repro

`fixtures/corpus-repro/fs-needs-partstudio-input/` (README there). All checked
on 2026-09-23 04:12 with `node bin/wonky.mjs <file> --check`:

| file | stands for | observed |
|---|---|---|
| `modify-existing-part.fs` | 35 files that use a count guard, then a bounds guard | `15:19: Derive exactly one source part into this Part Studio first` (exit 1) |
| `volume-selected-source.fs` | 14 TOP-clearance files that pick the source part by `evVolume` | `14:15: Expected exactly the declared current TOP source body; matching count=0` (exit 1) |
| `source-block.fs` | the 40×20×10 mm part both repros expect | builds, 8000 mm³ (exit 0) |
| `catch-without-binding.fs` | the 2 misclassified parse files | `14:143: Expected '(', found '{'` (exit 1) |
| `next-blocker-fixed-frame-n3.fs` | level 1 of 20 fixed-frame files: `n3 = n1 - n2`, corpus lines unchanged | `33:9: Native planar arrangement subtraction unresolved: InvalidTopology (stage 1, detail 0)` |
| `next-blocker-line-arc-joins.fs --feature tinyFilletArcJoin` | level 2 of the same 20 files | `27:9: Native line/arc sketch unsupported: SelfIntersectionOrTouch` |
| `next-blocker-line-arc-joins.fs --feature splitStraightEdge` | level 1 of 5 older fixed-frame files; in the 20, the next refusal in the same `n4s0` sketch | `46:9: Native line/arc sketch unsupported: SelfIntersectionOrTouch` |

`scripts/corpus/probe.mjs` puts both Part Studio repros in this cluster
(`FeatureScriptError`, `userThrow=true`, 0 completed modeling calls). It also
puts `catch-without-binding.fs` here, which is the misclassification. With
`source-block.fs` run first in the same context, both Part Studio repros build
a through hole. The prototype harness
`tmp/corpus/cluster-partstudio/seeded-build.mjs` shows that
(`ok: true, bodies: 1`). The CLI has no way to do this.

## 2. Root cause

The frontend has **no notion of a Part Studio before the feature**.

- `src/index.mjs:14` creates one fresh `ModelingContext` per build. Its record
  store is empty (`src/library.mjs:40`, `this.records = new Map()`).
  `src/index.mjs:30` then runs exactly one exported feature in it. No option,
  manifest field or CLI flag seeds bodies, and no feature list exists.
- `qAllModifiableSolidBodies()` (`src/queries.mjs:74`) resolves to the solid
  records of that store (`resolveTopology`, case `allSolid`, line 21). It
  returns 0 bodies, so `size(...) != 1` is true and the model's own
  `regenError` fires.
- The only input path is the frozen-module manifest (`src/modules.mjs:15`,
  schema `wonky-onshape-inputs/1`). It covers namespaced imports (`NS::build`)
  only. The imported bodies live in a separate, read-only context
  (`src/modules.mjs:34`) and enter the feature only as new instances. It
  cannot put a modifiable part into the feature's own context before the
  feature starts.

Two further gaps sit directly behind the guard, even with a way to inject
parts:

- **Captured Onshape bodies carry no mass properties.**
  - `importOnshapeBody` validates topology but sets `volumeMm3: null,
    boundsMm: null` (`src/analytic.mjs:270`).
  - `evVolume` (`src/queries.mjs:102`) and `evBox3d` (`:108`) then refuse with
    a capability error. Every guard in this cluster uses one of them.
  - The prototype confirms it: seeded with a captured r10b carrier body, the
    repros stop at "Tight bounds over analytic imported faces are not
    implemented" and "Volume integration over analytic imported faces is not
    implemented".
  - The bounds must be exact over arcs, not over vertices. The R25 side guard
    expects an X extent of 246.591 mm. The vertices of the captured side span
    only 199.468 mm; the R34.3 arcs around both axes supply the rest.
  - The `evBox3d` check (`src/queries.mjs:110`) refuses **any** edge or face
    row of **any** analytic body, not only imported ones. Its message says
    "imported". The TOP plate files hit it on a plate that wonky pierced
    itself (level 2, section 4).
- **Booleans on imported bodies with curved faces are not admitted.**
  - `booleanInBend` admits frustum primitives or all-planar bodies
    (`src/boolean.mjs:38-40`).
  - A captured part with cylinder faces falls through to "general trimmed-face
    booleans are not implemented" (`:137`). This was measured with the
    captured carrier and a box cut.

## 3. Fix design

### 3.1 Part Studio input (frontend, the actual fix): M

- **Where:**
  - `src/modules.mjs`: manifest loader;
  - `src/index.mjs`: `build()` seeds the engine before `interpreter.run`;
  - `bin/wonky.mjs`: a `--part-studio <manifest>` flag, with a sibling
    `modules.json` as default;
  - a capture script modeled on `scripts/snapshot-r10b-modules.mjs`.
- **What:** a `partStudio` section in `wonky-onshape-inputs/1`, or a schema
  bump. It contains:
  - `document`/`element`/`microversion`;
  - the part list and one `bodydetails` capture per part;
  - SHA-256 per file;
  - the binding to the source SHA-256, as for r10b.
- **How:**
  1. Before the feature runs, import each captured part with
     `importOnshapeBody` into the **target** engine.
  2. Add it as a modifiable solid record (not `readOnly`), with the name and
     appearance from the part list. Its `createdBy` is a reserved id
     `partStudio/<partId>`.
  3. `qAllModifiableSolidBodies`, `qEverything` and `evaluateQuery` then see
     the parts, as Onshape does.
  4. Output bodies record provenance: imported and unchanged, imported and
     modified, or created. This way an untouched Onshape part is never
     reported as wonky-built geometry. Onshape keeps unrelated parts in the
     studio, so they stay in the output, marked as such.
  5. Name the concept `partStudio`, like the symbolic input the language stager
     already uses (`src/lang/wk/stage-fs.mjs:84-87`).
- **Optional (S):** `--before <file.fs>#<feature>`, repeatable. It runs
  earlier FS features in the same context, which is Onshape's feature-list
  semantics with distinct ids. This covers chains of Marc's own features:
  - the R30 top plate that c-channel expects (volume 1992647.99 mm³) is,
    judging by its volume, the output of the TOP-clearance feature;
  - the prototype harness does exactly this.
- **Diagnostic (S):** the model's message must stay unchanged. When a feature
  throws before any modeling call in an empty context, the CLI can add a note
  on stderr: "this feature expects existing Part Studio parts; supply
  --part-studio". This is a hint, not a fallback.
- **Never:** no silent empty context, no invented stand-in parts. The
  stand-ins in this analysis live only in `tmp/`.

### 3.2 What the real inputs need behind the fix (library/kernel)

| need | files | where | effort |
|---|---:|---|---|
| exact volume over imported plane/cylinder/cone faces (divergence theorem over trimmed analytic faces) | 19 (TOP 14, c-channel 4, rotor 1) | Bend kernel, exposed via `src/analytic.mjs` | M |
| exact tight bounds over imported arcs and curved faces, and over edges/faces of any analytic body | 31 (fixed frame, flush guide, TOP mount, TOP plates) | same, plus `src/queries.mjs:110` | M |
| importer: torus, `extruded` (swept spline) and `other` surfaces; `bcurve`/`icurve` edges | 28: 27 on the R25 side, plus the rotor | `src/analytic.mjs:31-36` and the Bend kernel | XL |
| Booleans on imported curved bodies | all that modify the part | cluster 2 / bake-off `recover` | L |
| Part Studio bodies imported from Onshape (`FrozenGuides::build`, line 159 onward) | 11 (the openlock and clip variants of A) | cluster 1 snapshot | with cluster 1 |
| volume guards at 0.01 mm³ (9 R30 TOP files) or 0.02 mm³ (4 c-channel files), down to 1e-8 relative | 13 | kernel precision | see risk |

The volume row is a precision limit. wonky-built F32 bodies miss those guards:
a 6.35-mm plate built in wonky comes out 7.7 mm³ too small (6.35 is stored as
6.3499756). Imported f64 bodies can pass only if the volume is computed in f64
or exactly. Chained FS inputs (`--before`) therefore fail the c-channel guard
by construction.

### 3.3 Classifier and parser (2 files): S

- **Classifier.** In `scripts/corpus/probe.mjs:55`, `userThrow` must exclude
  parse errors. One option is to reject messages that match `^Expected '.*',
  found`. A cleaner one is a `ParseError` subclass in `src/parser.mjs`. Not
  changed here, because the other cluster analyses share that script.
- **Parser.** `src/parser.mjs:171` requires `catch (`. The binding should be
  optional. This belongs to `fs-parser-syntax`: the fixed
  `skirt_collar.fs` then stops at `try silent { }` (line 349), and
  `cad-project-028/sorter.fs` at an `InvalidTopology` subtraction after
  29 calls. Past its Booleans, `sorter.fs` then needs `fCylinder`.

### 3.4 Two sketch-join refusals found behind the guard (cluster 6): S to M

Both come from `kernel/sketch-arcs-intersections.bend`, which the line/arc
solver (`kernel/sketch-arcs.bend:403`, `pairs`) calls for every entity pair.
Neither profile crosses itself. The CLI message drops the pair indices that
the kernel reason carries (`src/sketch-arcs.mjs:43`);
`scripts/corpus/fs-needs-partstudio-input/curved-profiles.mjs` prints them.

- **Near-tangent tiny arc (20 files, level 2).** Sketch `n4s0` (8 copies per
  file) has a 2-mm fillet arc of 0.19° (chord 0.0068 mm) between two lines.
  - The three printed arc points fix the circle centre only to about 1e-6 mm.
    The error is amplified by (r/chord)² ≈ 87,000.
  - At both joins the analytic tangent point therefore lies 1.43e-6 mm from
    the shared endpoint.
  - `tangent_clear` accepts a tangent join only if that point is within the
    solver resolution (1e-12 × input scale, about 6.4e-10 mm).
  - The real line-circle roots lie off the other segment (1.8e-8 mm before
    and 2.9e-6 mm past the joint), so the profile does not self-intersect.
- **Split straight edge (5 older files at level 1, and 2 more pairs per `n4s0`
  in the 20 files).** Two consecutive lines are exactly collinear (turn
  1e-12°, shared endpoint exact).
  - The parallel branch of `line_intersection` accepts overlap only when the
    cross product is exactly 0. In F32x2 it is 2e-14.
  - This is the line/arc twin of cluster 6's "collinear consecutive profile
    edges" (polyline path, `kernel/sketch-lines.bend`). The proposed collinear
    merge must cover this solver too.

Fix direction, for cluster 6 to decide:
- merge exactly collinear consecutive lines before the pair test, with
  provenance;
- for adjacent entities, accept a tangent join when the shared endpoint lies
  on both carriers within resolution and the tangents agree within the
  angular guard, instead of recomputing the tangent point from an
  ill-conditioned centre.

Risk: the join rule is deliberately strict (see the comment above
`tangent_clear`), so relaxing it needs its own proof that no real touch gets
through.

### Effort and risk

- **Effort.** The mechanism alone is **M** (manifest section, seeding, CLI,
  capture script, provenance). To make the 49 files *build* is **L to XL**,
  dominated by the importer's spline and torus coverage and by general
  Booleans. Those belong to other clusters.
- **Risks.**
  1. Every source edit needs a recapture (SHA binding, as for r10b). That is
     correct, but it costs Onshape API budget per revision.
  2. Onshape-context semantics: `qAllModifiableSolidBodies` also sees
     unrelated parts, and helpers such as c-channel's lazy `source` query grow
     as the feature adds bodies. wonky must reproduce that, not "fix" it.
  3. Output provenance: imported geometry must never pass as wonky-built.
  4. The importer must keep refusing surfaces it cannot represent exactly, not
     facet them.
  5. The 1e-8 relative volume guards expose F32 rounding.

## 4. First blocker per file and what comes next

### Is this cluster the first blocker?

- **47 files: yes, and it is their only failing unit.** The guard is the first
  statement of the feature. Header, std imports and top-level declarations
  evaluate without error.
- **2 files: yes for one unit, but other units of the file fail first
  elsewhere.**
  - `c-channel-bases-r2/native-all-r2.fs` and `c-channel-bases-r3/native-all-r3.fs`
    each export 3 features. Only `channelPlateR2`/`channelPlateR3` is in this
    cluster.
  - Their other 2 units fail in cluster 2 (`opBoolean` general trimmed-face).
- **2 files: no, they are misclassified parse errors.**
  `cad-project-028/sorter.fs:35` and
  `cad-project-038/scripts/skirt_collar.fs:18`.

### Lineages

| lineage | files | families | guard | real input in the corpus |
|---|---:|---:|---|---|
| A. fixed frame R29/R30 (`belt-fixed-r30/**`, `belt-fixed-r29/fixed-frame-r29.fs`) | 26 | 16 | exactly 1 part, tight X extent 246.591 ± 0.2 mm | R25 side `RYFD` in `belt-return-r25/long-bodydetails-before.json`. Faces: 128 plane, 262 cylinder, 25 cone, 2 torus, 35 extruded, 2 other. The importer refuses the torus first. `belt-fixed-r30/reference/side-source.step` is the Onshape STEP. |
| B. TOP clearance (`top-clearance-r29/**`, `R30_TOP_Clearance_Prototype_v1/**`, `project-component-db8a67a0-top-plate-r1`) | 14 | 3 | `evVolume` match within 2 mm³ (R29) or 0.01 mm³ (R30) | no captured B-rep. The plate has 82 plane and cylinder faces (`step-baselines.json`), so it is importable. |
| C. c-channel bases (`c-channel-bases-r2/r3`) | 4 | 3 | exactly 1 part, volume within 0.02 mm³ | none. The R30 top plate is probably lineage B's output. |
| D. return hardware (608 bearing) | 3 | 1 | exactly 1 part | mesh only (`reference/608-source.stl`) |
| E. flush return guide R25 | 1 | 1 | exactly 1 part, then ≥ 9 faces picked by `evBox3d` | same `RYFD` capture as A |
| F. rotor centre closure R2 | 1 | 1 | exactly 1 part, then a volume delta | rotor `JFD` (`comment-review/apply-bodydetails-before.json`). Faces: 28 plane, 24 cylinder, 11 cone, 9 torus. The importer refuses the torus. Onshape regenerated this exact source (SHA `91e032ef…`) with status OK. |
| G. misclassified parse errors | 2 | 2 | none | |

### Method

1. `tmp/corpus/cluster-partstudio/seeded-build.mjs` mirrors `src/index.mjs`
   `build()`. It first runs a *seed* feature or imports a captured body into
   the same context, then runs the file's feature with the production
   interpreter and source-map trace.
2. The seeds are stand-ins in `tmp/corpus/cluster-partstudio/seeds/standins.fs`,
   one per lineage. They satisfy the guard (count, bounds or volume) but not
   the real shape.
3. Stubs were applied to copies in `tmp/corpus/cluster-partstudio/stubbed/`:
   - the TOP volume tolerance was widened from 0.01 to 2 mm³, and c-channel's
     from 0.02 to 1 mm³ (F32, see 3.2);
   - the rotor's `vector(0, 0, zBottom)` became length zeros;
   - `catch {` became `catch (stubError) {`.
4. **Level 2** re-runs the 33 files whose level-1 blocker is a Boolean, with
   the same seed and copy, under the in-memory Boolean hook
   `scripts/corpus/boolean-hook-loader.mjs`
   (`scripts/corpus/fs-needs-partstudio-input/deep-next-blocker.mjs`):
   - `pass-all`: every Boolean refusal returns its first operand. The geometry
     is wrong by construction; the run shows the first blocker that is not a
     Boolean.
   - `hybrid-all`: every Boolean refusal goes to the bake-off corefine +
     `recover` prototypes (native builds, test only).
5. **Level 3** stubs the level-2 sketch refusal in two fixed-frame copies
   (`tmp/corpus/cluster-partstudio/stubbed-l3/`): the tiny arc is replaced by
   its chord, and exactly collinear consecutive lines are merged.
6. A blocker is **input-independent** when the failing construct takes nothing
   from the stand-in. For the fixed frame this was verified with seed-free
   extracts (the `n3` Boolean, the `n4s0` sketch).

### Level 1: the next blocker after the guard

| next blocker | files | lineages | input-independent | owner |
|---|---:|---|---|---|
| `opBoolean` subtraction → `InvalidTopology (stage 1)`: fixed frame `n3 = subtract(n1, n2)` after 11 calls; m3 sorter `g12` after 29 | 21 | A (20), G (1) | yes | boolean-invalid-topology (F32 operands, see below) |
| `'opTransform' is not defined` | 7 | B | yes (moves the source part) | cluster 7 |
| `opBoolean` `general trimmed-face`: coaxial cylinder + cone union in `combine` (screw head, countersink), after 18 to 52 calls | 5 | D (3), C (2, r2) | yes | cluster 2 |
| `skSolve` `SelfIntersectionOrTouch` (`curvedProfile` `n2s0`, after 24 calls): split straight edge | 5 | A (older variants) | yes | cluster 6 (section 3.4) |
| planar arrangement `UnsupportedArrangement (stage 6)` | 4 | B (TOP plate ×3, rafter) | no (stand-in box) | indicative only |
| `'rotationAround' is not defined` | 2 | B | yes | cluster 7 |
| `opBoolean` arity (more than one target) | 2 | C (2, r3) | yes: the lazy `qAllModifiableSolidBodies()` includes the new tool body | cluster 2 |
| through hole needs a floor | 1 | B (`top-mounts-m5-r29`) | no | indicative only |
| `Plane frame is not orthonormal` (R29 node 12) | 1 | A | yes | cluster 6 |
| model check: 9 rail faces not found | 1 | E | no (needs the real part) | real input |
| `vector` refuses `vector(0, 0, zBottom)`; after the stub, the stand-in fails the volume check | 1 | F | the `vector` gap: yes | cluster 3 (Onshape accepts this source) |
| parser: `try silent { }` statement | 1 | G | yes | cluster 11 (`try-block-statement.fs`) |

**Why the 20 fixed-frame subtractions fail** (repro
`next-blocker-fixed-frame-n3.fs`, measured with
`scripts/corpus/diagnose-planar-admission.mjs`):

1. Today: admission refuses n1. Its 8 slanted faces miss their stored planes
   by up to 2.5e-6 mm against an allowance of 2.1e-10 mm. n2 misses by up to
   3.8e-5 mm. Both are 15°-tilted prisms from the F32 polygon extruder, which
   is the boolean-invalid-topology root cause.
2. `--simulate carriers,transform` (planes refitted in f64): n1 passes, n2
   does not. Its vertices themselves are off-plane by up to 4.9e-6 mm in f64,
   because the 1,200 × 1,190 mm slab is extruded in F32.
3. `--simulate linearc` (the proposed F32x2 prism fix): both operands pass
   (9.7e-13 and 6.6e-12 mm). The arrangement then stops at
   `AmbiguousContact (stage 2, detail 15)`.
   - Detail 15 is plane 15 of `unique_planes(n1 ++ n2)`, i.e. n2 face 6.
   - It is coplanar with n1 face 2, 1.0e-12 mm apart, opposite sense. Four
     vertices of each body lie 6e-13 to 1.1e-12 mm from the other's plane.
   - `side` (`kernel/halfspace.bend:375`) counts a vertex as "on" a plane only
     at exactly zero distance, so these vertices are ambiguous.
   - The first pass named this coplanarity as the likely trigger. It is the
     second-level trigger; F32 construction comes first.

### Level 2: the first blocker that is not a Boolean

33 files, `pass-all` (2026-09-23 04:20 to 04:24):

| blocker | files | lineages | after calls | Booleans stubbed | owner |
|---|---:|---|---:|---:|---|
| `skSolve` `SelfIntersectionOrTouch`: tiny fillet arc in `curvedProfile` `n4s0` (line 84/86) | 20 | A | 31–39 | 1 (the n3 subtraction) | cluster 6 (section 3.4) |
| builds on the stand-in | 3 | D | all | 6–8 (coaxial cylinder + cone unions) | cluster 2 |
| pierce-after-copy `RangeError`: `real(null)` at `src/boolean.mjs:127`, a JS crash instead of a capability error | 4 | C | 19–41 | 1–5 (N-ary fold, unions) | cluster 6 (known: `next-pierce-after-copy.fs`, fix S) |
| `evBox3d` over the edges of an analytic (pierced) plate, `src/queries.mjs:110`, to pick 9 corner edges for `opFillet` | 3 | B (TOP plates) | 207–239 | 20–24 | library; then `opFillet` (cluster 7) |
| `skPolyline` collinear consecutive edges | 2 | B (mounts, rafter) | 37–61 | 4–7 | cluster 6 |
| `'fCylinder' is not defined` | 1 | G (m3 sorter) | 53 | 11 | cluster 7 |

The same 33 files on the bake-off hybrid route (`hybrid-all`, 04:28 to 04:29):

- **20 fixed-frame files:** the route builds the n3 subtraction (28–156 ms per
  Boolean), then the file stops at the same sketch refusal.
- **3 return-hardware files:** build completely on the stand-in. 6–8 hybrid
  Booleans take 414–632 ms per file (12, 14 and 24 bodies).
- **3 TOP plate files:** 27–32 hybrid Booleans build. Then `recover` refuses:
  "exact vertex is 0.254 mm from the mesh (bound 0.1)".
- **2 c-channel r2 files and the m3 sorter:** corefine refuses an operand:
  "not a closed consistently oriented 2-manifold".
- **2 c-channel r3 files:** they still reach the pierce-after-copy crash,
  because no Boolean there is refused.

### Level 3 (fixed frame, 2 representatives)

With the tiny arc replaced by its chord and 16 collinear pairs merged per file
(`level3-fixed-frame.jsonl`):
- `fixed-frame-r30.fs` completes 113 calls and
  `panel-openlock-crossbar-r5/fixed-frame-r30.fs` completes 192.
- Both then stop at `opLoft currently requires two coaxial circular profiles`
  (`n21`/`n45`, a rounded-rectangle loft), which is cluster 6's
  "planar-sided loft".
- On the way, 7 of 8 and 19 of 24 Booleans were refused and stubbed. Besides the n3
  subtraction, they were convex-tool intersection `InvalidTopology` and
  `UnsupportedArrangement`, curved convex-tool intersection, and
  general trimmed-face Booleans.
- The fixed frame is about 1,000 lines long. It is far from building even
  with every input supplied.

### With the real inputs

For A, E and F (28 files), the next blocker with the real part is the importer
(`Imported surface 'torus' is not implemented`). This was measured by seeding
the captured `RYFD` and `JFD`. For B, C and D, a capture must be made first.
After that come `evVolume`/`evBox3d` over imported faces, then Booleans on
curved imported bodies.

## 5. Overlap with in-flight work

- **Bake-off.** The cluster's own blocker is not a Boolean. The dominant level-1
  blocker is one. `scripts/corpus/fs-needs-partstudio-input/n3-recover.mjs`
  runs it through the bake-off's unchanged infrastructure (`buildCase`,
  `recover-extra.py` oracle, `js-worker.mjs`, `recover-check.mjs`). It uses
  three kinds of leaves: bake-off prisms (binary64), wonky's F32 operands and
  wonky's F32x2 operands. The operands are dumped with
  `scripts/corpus/boolean-invalid-topology/dump-operands.mjs`.

  | leaves | mesh Boolean | `recover` | F/E/V | OCCT | `validate-step` | volume vs exact CSG | compute (JS) |
  |---|---|---|---|---|---|---:|---:|
  | prism (binary64) | manifold3d oracle | ok | 13/33/22 | valid | ok | 7.9e-16 | 89 ms |
  | prism (binary64) | corefine (Bend) | ok | 13/33/22 | valid | ok | 1.4e-15 | 149 + 39 ms |
  | wonky F32 | — | leaf refused: vertex 2.5e-6 mm off its surface | | | | | |
  | wonky F32x2 | manifold3d oracle | ok | 13/33/22 | valid | ok | 2.2e-15 | 25 ms |
  | wonky F32x2 | corefine (Bend) | ok | 13/33/22 | valid | ok | 2.2e-15 | 54 + 18 ms |
  | any | exact-plane (Bend) | — | | | | refused: coordinates outside the ±1,024 mm quantization box | 10–17 ms |

  - The exact CSG volume is 2,965,750.805 mm³ (OCCT on the prism leaves).
  - `recover` does **not** solve the production case today.
  - Once the boolean-invalid-topology fix builds prisms in F32x2, an all-Bend
    corefine → `recover` chain gives the exact result. It also avoids the
    arrangement's second-level `AmbiguousContact`.
  - exact-plane refuses because n2, a 1,200-mm cutting slab, reaches
    x ≈ 1,359 mm. Its doc says a wider box costs bits, not correctness.
  - The test-only hybrid glue (`scripts/corpus/boolean-hybrid.mjs`, which
    falls back to the print mesh) builds today's F32 operands. The result has
    the same 13F/33E/22V topology, but the volume is off by 2.0e-7 relative,
    i.e. the F32 error.
- **Native binding.** It does not change the outcome. The guard fires before
  any kernel call (0 modeling calls). `WONKY_BACKEND=native` now starts; the
  first pass saw `BX_STALE`. It gives the same messages for
  `modify-existing-part.fs`, `volume-selected-source.fs` and
  `next-blocker-fixed-frame-n3.fs`.
- **Viewer rework.** Not involved.
- **Language work.** The WK stager already models a symbolic initial Part
  Studio: an `input{name: 'partStudio'}` record in
  `src/lang/wk/stage-fs.mjs:84-87`, and "49 unique files" in
  `docs/language/proposal-core-ir.md` §4.1. That is staging only and produces
  no geometry. The frontend fix should use the same name and single-record
  shape, so that staged graphs and concrete builds line up.
- **Cluster 1 (module imports).** Same manifest schema, same capture path
  (Onshape session bridge, `bodydetails` per part and microversion), same
  importer limits. Doing both in one piece of work is cheaper than two.
- **Other cluster analyses.**
  - The pierce-after-copy crash and the collinear merge are already in
    `cluster-kernel-sketch-and-ops.md`.
  - The two line/arc join refusals (section 3.4) are not in it yet.
  - The `catch {}` parser gap is in no cluster analysis.

## 6. Reproduce

```
node bin/wonky.mjs fixtures/corpus-repro/fs-needs-partstudio-input/modify-existing-part.fs --check
node bin/wonky.mjs fixtures/corpus-repro/fs-needs-partstudio-input/volume-selected-source.fs --check
node bin/wonky.mjs fixtures/corpus-repro/fs-needs-partstudio-input/next-blocker-fixed-frame-n3.fs --check
node bin/wonky.mjs fixtures/corpus-repro/fs-needs-partstudio-input/next-blocker-line-arc-joins.fs --feature tinyFilletArcJoin --check
node bin/wonky.mjs fixtures/corpus-repro/fs-needs-partstudio-input/next-blocker-line-arc-joins.fs --feature splitStraightEdge --check

# first pass (tmp harness)
node tmp/corpus/cluster-partstudio/list.mjs          # cluster units from runs.jsonl (normalize rules)
node tmp/corpus/cluster-partstudio/static-scan.mjs   # builtins each file calls that wonky lacks
node tmp/corpus/cluster-partstudio/next-blocker.mjs  # level 1, 3 at a time, 300 s each
node tmp/corpus/cluster-partstudio/write-summary.mjs # -> out/corpus/cluster-fs-needs-partstudio-input.json

# second pass
node scripts/corpus/diagnose-planar-admission.mjs tmp/corpus/cluster-partstudio/fixed-frame-r30-n3.fs [--simulate linearc|carriers,transform]
node scripts/corpus/boolean-invalid-topology/dump-operands.mjs tmp/corpus/cluster-partstudio/fixed-frame-r30-n3.fs \
  --out tmp/corpus/cluster-partstudio/operands/n3-f32.json.gz            # and n3-linearc.json.gz with --linearc
node scripts/corpus/fs-needs-partstudio-input/n3-recover.mjs            # oracle/corefine/exact-plane -> recover (uv for the oracle)
node scripts/corpus/fs-needs-partstudio-input/deep-next-blocker.mjs --mode pass-all    # level 2
node scripts/corpus/fs-needs-partstudio-input/deep-next-blocker.mjs --mode hybrid-all  # level 2, bake-off route
node scripts/corpus/fs-needs-partstudio-input/curved-profiles.mjs <fixed-frame.fs>     # refused line/arc pairs with indices
node scripts/corpus/fs-needs-partstudio-input/summarize.mjs             # -> out/corpus/fs-needs-partstudio-input/files.json
```

The static scan agrees with the probes. Beyond the blockers above:

- The fixed-frame files call `qNothing`, which wonky does not implement. It
  runs only on the empty-guard branches of `cp`/`combine`.
- 11 openlock and clip variants import Part Studio bodies,
  `FrozenGuides::import(path: "889f3a9e…/4b66b356…/6759ba84…")`, and
  instantiate them from line 159 on with `qContainsPoint(qEverything(...))`.
  After the Boolean they therefore also need cluster 1's snapshot and two
  more builtins.
- The TOP files call `opTransform`, `rotationAround`, `coordSystem`, `toWorld`
  and `opFillet`.
- The flush guide calls `opMoveFace` and `skText`.

## 7. Run metadata

| step | when (local) | `uptime` load averages |
|---|---|---|
| first pass: repros through the CLI | 2026-09-22 23:49 | 22.85 22.41 20.50 |
| first pass: level 1, 51 units, concurrency 3, 300 s timeout, no timeouts | 23:55 to 23:57 | start 109.03 68.75 42.13, end 140.18 92.92 54.88 |
| first pass: bake-off `recover` on prism leaves | 2026-09-23 00:07 | 104.28 89.03 69.40 |
| second pass: repros re-checked, CLI | 04:12 | 10.66 10.07 9.81 to 11.48 10.34 9.92 |
| n3 admission diagnosis, operand dumps | 04:13 to 04:14 | 21.34 12.71 10.79 to 24.05 14.67 11.61 |
| n3 bake-off routes (`n3-recover.json`) | 04:18 to 04:19 | start 119.97 64.58 33.92, end 114.50 69.39 36.91 |
| level 2 `pass-all`, 33 units, concurrency 3, 300 s, no timeouts | 04:20 to 04:24 | start 56.52 62.28 37.15, end 32.35 54.81 40.28 |
| level 2 `hybrid-all`, 33 units, concurrency 3, 300 s, no timeouts | 04:28 to 04:29 | start 35.92 40.20 37.16, end 68.55 49.15 40.79 |
| native backend check, 3 repros | 04:30 | not recorded separately (between 68.55 and 21.59) |
| level 3, 2 units | 04:32 | 21.59 36.57 37.18 |

Node v22.23.1. Python only via `uv run` (the bake-off oracle and the OCCT
check). All timings are JS target under the shared load above; they are not
performance measurements.
