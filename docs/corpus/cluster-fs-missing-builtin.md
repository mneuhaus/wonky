# Cluster fs-missing-builtin: Onshape std builtins that wonky does not implement

Date: 2026-09-22 23:45 to 2026-09-23 00:11 local. Input: [the corpus run](run.md)
(`out/corpus/runs.jsonl`, cluster 7). HEAD `79bbfeec` plus the working tree of
that moment, Node v22.23.1, default JS path (`WONKY_BACKEND` unset), `strict`
modeling policy, at most 3 wonky processes, 240 s per unit. The machine was
shared with benchmarks: load average 33 at the start, up to 119 at the end
(`uptime` per pass is in `tmp/corpus/fs-missing-builtin/run-meta.jsonl` and in
`out/corpus/cluster-fs-missing-builtin.json`). No production file was changed.

Second pass 2026-09-23 00:20 to 00:35 (load 15 to 42): all repros re-checked
against the production CLI with unchanged results, and the Booleans the
cluster reaches next were run through the bake-off `recover` route with the
corpus files' own values (section 6). That run corrected two claims of the
first pass: the fs95 countersink is not the catalogue case
`plate-countersink` in 12 of 13 files, and `frameR4Diagonal` stops at a blind
pilot hole, not at a tilted through hole.

Third pass 2026-09-23 04:11 to 04:20 (load 10 at the start, 121 at the end,
because of other workflows). Nothing under `src/library.mjs`,
`src/queries.mjs`, `src/scalars.mjs`, `src/interpreter.mjs` or `kernel/*.bend`
changed since the first pass. The bake-off `recover` route (`kernel/proto/**`
outside `sdf/`, `scripts/bakeoff/**`, `docs/proto-recover.md`) did not change
since the recover run either. The native slice still has the same 19 entries.
The findings of this pass:

- Two more repros for the pure value builtins: `pure-values.fs` (`atan2`,
  `rotationAround`, `mirrorAcross`) and `integer-bound.fs` (`unitless`,
  `isInteger`).
- All repros are now checked by a script,
  `scripts/corpus/fs-missing-builtin/verify-repros.mjs`, with the production
  CLI and the harness: 26 of 26 as stated, written to
  `out/corpus/cluster-fs-missing-builtin-verify.json`.
- **Mirrors are a later blocker.** Every `mirrorAcross` in the corpus feeds
  `opPattern`, and production `opPattern` refuses reflections. This affects
  11 headed files in 4 families, 6 of them in this cluster (section 4 F).
- **A failing top-level `const` blocks the whole file**, not only the feature
  that uses it (`printed_joints.fs`).
- **The language spike, updated after the second pass, confirms the
  ranking.** It puts `opTransform` third on the critical path for Marc's
  cylinder parts. All 8 features it found blocked by `opTransform` are units
  of this cluster (section 6).

Machine-readable result: `out/corpus/cluster-fs-missing-builtin.json` (one row
per file, with every unit's next blocker and, for Boolean next blockers, the
`recover` verdict) and `out/corpus/cluster-fs-missing-builtin-recover.json`.
Repros: `fixtures/corpus-repro/fs-missing-builtin/`. Scripts:
`scripts/corpus/fs-missing-builtin/`.

## Answer in short

1. **The cause is coverage, not a bug.** wonky implements the Onshape std
   library as a hand-written JS table (`src/library.mjs`, `src/scalars.mjs`,
   `src/queries.mjs`, `src/modules.mjs`). Any name outside it fails in
   `Environment.lookup` (`src/interpreter.mjs:21`) with an explicit
   `UnsupportedFeatureError`. That behavior is correct and must stay. The names
   are simply not there yet.
2. **The fix is mostly frontend work, with kernel support already in place.**
   - `opTransform` can reuse the rigid-transform adapters that `opPattern`
     already calls (`transformInBend`, `transformAnalytic`).
   - `opRevolve` can reuse `kernel/revolve.bend` (`revolveInBend`), which
     production does not call today.
   - `qContainsPoint` can reuse `kernel/solid-classification.bend`.
   - The rest are pure value or query functions from the std documentation:
     `makeId`, `atan2`, `unitless`, `isInteger`, `coordSystem`, `toWorld`,
     `rotationAround`, `qEverything`, `qNothing` and `makeRobustQuery`.
     `mirrorAcross` also belongs here as a value, but its consumers must keep
     refusing it until F exists.

   Effort **M** (about 2 days including tests). Risk **low to medium**.
3. **The fix alone makes no corpus file build.** I prototyped every builtin in a
   harness outside production and ran all 56 units again. Each unit moved on to
   a different blocker:

   | next blocker | files | families | units |
   |---|---:|---:|---:|
   | `opBoolean` capability (13 are one countersink cut in the fs95 family) | 15 | 3 | 16 |
   | the feature edits parts from an Onshape Part Studio | 12 | 7 | 22 |
   | module import (Part Studio snapshot) | 7 | 2 | 7 |
   | operation limits (`opLoft` profiles, revolve on the axis, open path sketch) | 5 | 4 | 6 |
   | `IntegerBoundSpec` type tag, then the feature parameter default | 2 | 2 | 2 |
   | `skText` | 2 | 2 | 2 |

   Two units build once `skText` is also stubbed out, but they then lack their
   lettering, so that result is not valid: `presentation.fs` (21 bodies) and
   `interface-r3.fs#cableClamp` (1 body, 857.5248 mm³, accepted by
   `scripts/validate-step.py`).
4. **The first-blocker count understates this cluster by a factor of 3 to 4.**
   A static scan of all 287 parseable, headed corpus FS files finds that
   `opTransform` appears in 145 files and 41 families. 236 files (83 of 103
   families) use at least one name from the proposed fix set. The run shows
   only 43, because module imports and parser gaps stop most files earlier. In
   99 files (44 families), every unimplemented name belongs to the fix set.
5. **19 units hide the "Part Studio input" cluster behind a misleading
   Boolean error.** These features start with
   `qAllModifiableSolidBodies()` or `qEverything(BODY)`, which is empty in a
   standalone build. They carry the empty query through `opTransform` and
   `opPattern`, and then fail in `opBoolean` with "requires two tools". A
   cheap companion fix makes empty operands an explicit error at the first
   operation.
6. **Overlap.**
   - This cluster is not a Boolean problem. It does not overlap the bake-off.
   - Its dominant next blocker, the fs95 countersink cut, is **not** solved by
     `recover` in 12 of 13 files. The first countersink breaks out through the
     bar's end face (by 0.2 mm in 11 files, by 5.5e-5 mm in `interface-r5.fs`),
     and `recover` declines: "plane/cone section is a hyperbola (curve type
     missing in the body format)". Only `interface-r4.fs`, whose countersinks
     stay inside the bar, recovers exactly.
   - The other Boolean next blockers: `frameR4Diagonal` (a blind pilot hole)
     and `frameR4HeadRetainer` (screw shaft plus frustum head) recover
     exactly; the `motorCrossmemberU2` boss union recovers with the right
     volume, but its STEP fails OCCT's exact CurveOnSurface check.
   - The native slice would run `opTransform` only for planar bodies.
   - The language work already has std-exact versions of most pure builtins,
     for its tracer only. Promote them rather than write them twice.
   - The language spike (`docs/language/spike-real-model.md`) ranks
     `opTransform` third on the critical path for Marc's cylinder parts. The
     8 features it found blocked by `opTransform` are all units of this
     cluster.
7. **Plan reflections with it (F, kernel).** Mirrors are no first blocker, but
   6 cluster files mirror bodies with `opPattern` further on. Production
   refuses that, and it needs orientation reversal in Bend.

## 1. The cluster

56 units in 43 unique files and 19 families. All are `frontend ·
undefined-builtin` with the message `'<name>' is not defined or not
implemented by this prototype`.

| builtin | units | files | families |
|---|---:|---:|---:|
| `opTransform` | 29 | 22 | 7 |
| `makeId` | 6 | 6 | 1 |
| `qContainsPoint` | 5 | 3 | 2 |
| `makeRobustQuery` | 5 | 4 | 3 |
| `qEverything` | 4 | 2 | 1 |
| `opRevolve` | 2 | 2 | 2 |
| `atan2` | 2 | 2 | 1 |
| `isInteger`, `skText`, `unitless` | 1 each | 1 each | 1 each |

**Is it the file's first blocker?** Each unit (one exported feature) has
exactly one first blocker. Per file:

- **sole** (21 files): every failing unit of the file is in this cluster.
- **primary** (4 files): most failing units are in this cluster:
  `central-drive-r27.fs`, `central-drive-r28.fs`, `central-spur-r26.fs` and
  `mounting-r26.fs`. Together with the sole files these are the 25 files and
  15 families in the run summary.
- **minor** (18 files): this cluster blocks 1 or 2 of up to 26 feature units.
  The rest are blocked by module imports, `opBoolean`, `opLoft` and the planar
  arrangement.
  - 14 of these files are the fs95 distributor bottom-interface family. The
    cluster only reaches its `cableClamp` feature.
  - The others are `module-r4-upload.fs`, `top-structure-r1.fs`, `guide-r3.fs`
    and `guide-r4.fs`.

The full per-file table is in [section 5](#5-what-each-file-hits-next).

## 2. Minimal repros

All repros are in `fixtures/corpus-repro/fs-missing-builtin/`. They are
independent of `~/Workspace/cad`. They were checked with
`node bin/wonky.mjs <file> --check [--feature F]`:

| file | reduced from | today (production CLI) | with the builtins (harness) |
|---|---|---|---|
| `op-transform-pose.fs` | fs95 `cableClamp` (`boreAlong`/`cs` helpers), same idiom in `module-r4-upload.fs` and `top-structure-r1.fs` | `24:9: 'opTransform' is not defined ...` | 1 body, 7 faces (6 planes, 1 cylinder), 884.7623916933765 mm³ = 3·8·38 − π·1.7²·3 |
| `std-queries.fs --feature robustEverything` | `system-fixes.fs`, `guide-r3/r4.fs`, `mg995-flap.fs`, `r10-adapters.fs` | `23:19: 'makeRobustQuery' ...` | 1 body |
| `std-queries.fs --feature containsPoint` | `belt-loop-r29/r30.fs`, `central-drive-r28.fs` | `34:19: 'qContainsPoint' ...` | 1 body |
| `std-queries.fs --feature idFromString` | `cad-project-040/**/buildplate-r1x.fs` | `43:28: 'makeId' ...` | 1 body |
| `op-revolve.fs --feature sleeve` | `cad-project-043/fsocct/examples/revolve_and_loft.fs` | `21:9: 'opRevolve' ...` | 1 body, 4 faces, 13571.68026350788 mm³ = π(18²−12²)·24 |
| `op-revolve.fs --feature reliefCone` | `m3-module/native/qualified-source.fs` (`m3ReliefTool`) | `32:9: 'opRevolve' ...` | capability error: *Revolve of a profile touching the axis is not implemented* (`kernel/revolve.bend` refusal 2) |
| `pure-values.fs --feature atan2Angle` | `corner_loft.fs`, `curved-accepted-source.fs` (`atan2(tn - r, ts - c) - 360 * degree`) | `24:17: 'atan2' ...` | 1 body, 192 mm³ = 8·6·4 (`atan2` on numbers and on lengths) |
| `pure-values.fs --feature rotatedCopy` | the std rotation idiom (`rotationAround`: 45 files, 16 families) | `38:33: 'rotationAround' ...` | 2 bodies of 8 mm³ |
| `pure-values.fs --feature mirroredCopy` | `guide-r3/r4.fs`, `r10-adapters.fs`, `corner_loft.fs`, `curved-accepted-source.fs` (`opPattern` + `mirrorAcross`) | `55:33: 'mirrorAcross' ...` | `54:9: Only proper rigid transforms are implemented` (production `opPattern` refuses the reflection; section 4 F) |
| `integer-bound.fs --feature integerBound` (also `plainBox`) | `printed_joints.fs`, `unchanged-link-test-strip.fs` | `18:25: 'unitless' ...`, for both features | `18:22: Expected IntegerBoundSpec` (the type tag of the fs-interpreter-semantics cluster) |

The earlier one-line `fixtures/corpus-repro/op-transform.fs` still holds. The
new `op-transform-pose.fs` is the shape the corpus actually uses.

`integer-bound.fs --feature plainBox` never touches the bound and still fails
at line 18. A top-level `const` is evaluated when the module loads, so one
missing name in it blocks every feature of the file. In `printed_joints.fs`
that is the `KIND` constant.

All six invocations were re-run on 2026-09-23 00:20 with the production CLI
and the harness. The messages, line numbers and harness volumes were
unchanged. On 2026-09-23 04:15 `verify-repros.mjs` re-checked every repro in
this directory, the next-blocker repros and the harness results (26
invocations). All matched the tables in this section.

**Next-blocker repros.** Two more files show, without any missing builtin,
what the fix exposes next. Both use the corpus values:

| file | stands for | production CLI today |
|---|---|---|
| `next-countersink-breakout.fs --feature countersink` | fs95 `cableClamp` in `interface-r6.fs` to `interface-r11.fs` and the bottom-drive copies (11 files) | `57:9: opBoolean supports coaxial cylinder primitives, ... general trimmed-face booleans are not implemented`. `--feature hole` builds (1067.162397 mm³). |
| `next-pierced-web-step.fs --feature headPilot` | `module-r4-upload.fs#frameR4Diagonal` | `56:9: opBoolean through holes need a tool axis perpendicular to exactly two faces of the target` (a blind pilot) |
| `next-pierced-web-step.fs --feature footHole --format step --out P` | the same | builds (12 faces, 116252.854131 mm³), then `no .step written: STEP cylindrical parameter curves unresolved: InvalidSource`, exit 1 |

## 3. Root cause

- **Where it fails.** `Environment.lookup` (`src/interpreter.mjs:13-22`)
  throws when no binding exists. This happens when the name is evaluated, not
  when the file is parsed. That is why `hot_wire.fs` completes 537 modeling
  calls before `opTransform` stops it, and why every run reports only one
  missing name.
- **What is bound.** `Interpreter` declares exactly
  `ModelingContext.builtins()` (`src/library.mjs:86`). That table merges:
  - `scalarBuiltins()` (`src/scalars.mjs`);
  - `queryBuiltins()` (`src/queries.mjs`);
  - `instantiatorBuiltins()` (`src/modules.mjs`);
  - the sketch and operation builtins defined in place.

  wonky loads no std source. Every std function is re-implemented in JS, as
  AGENTS.md requires: extend the interpreter, and keep all geometry in Bend.
- **What is missing, by layer:**

  | layer | missing names | kernel support today |
  |---|---|---|
  | pure values (std `context.fs`, `units.fs`, `math.fs`, `coordSystem.fs`, `curveGeometry.fs`) | `makeId`, `atan2`, `unitless`, `isInteger`, `coordSystem`, `toWorld`, `rotationAround` | none needed |
  | queries (std `query.fs`, `feature.fs`) | `qEverything`, `makeRobustQuery`, `qContainsPoint` | `kernel/solid-classification.bend` (point in solid, used only by tests today) |
  | operations (std `geomOperations.fs`) | `opTransform`, `opRevolve` | `kernel/topology.bend` `transform` and `kernel/analytic.bend` `transform`, both already used by `opPattern`; `kernel/revolve.bend`, used only by bake-off scripts and tests |
  | sketch | `skText` | none (needs font outlines; see section 4) |

No kernel defect is involved. The error text is also correct. It is an
explicit capability error that stays visible inside `try silent`
(`catchable()` in `src/interpreter.mjs`).

## 4. Fix design

All changes except D2 are in the frontend library. Geometry stays in Bend.
Every refusal stays an explicit capability error.

### A. Pure value builtins: `src/scalars.mjs` (effort S, risk low)

| builtin | semantics (std) | notes |
|---|---|---|
| `makeId(s)` | `[s] as Id` | Refuse `""` and `/`, as `cast(..., 'Id')` does. |
| `atan2(y, x)` | angle; both numbers or both of the same unit | Also add `asin`, `acos` and `atan` (in the corpus: `acos` in 1 file). |
| `unitless` | `1` | Makes `{ (unitless) : [a, b, c] }` evaluate. The `as IntegerBoundSpec` tag and the parameter default belong to the fs-interpreter-semantics cluster (`cast`, `matchesType` and `featureDefaults` in `src/interpreter.mjs`). |
| `isInteger(v[, spec])` | integer test, plus bounds from an `IntegerBoundSpec` | Precondition use. Needs the type tag above. |
| `coordSystem(origin, xAxis, zAxis)` and `coordSystem(plane)` | normalized axes; x must be perpendicular to z | Represent it as a tagged map so that `is CoordSystem` can be added. No corpus file uses `is CoordSystem` today. |
| `toWorld(cs)` and `toWorld(cs, point)` | `Transform(M = [x, z×x, z], origin)`, or a point | Also add `fromWorld` (inverse; std pairs them). |
| `rotationAround(line, angle)` | Rodrigues rotation about the line; translation `o − R·o` | `line()` already normalizes the direction. |
| `mirrorAcross(plane)` | Householder reflection `I − 2nnᵀ`, translation `2(n·o)n` | A value only. Consumers refuse it until F exists; the error then moves from "not defined" to `opPattern`'s explicit "Only proper rigid transforms are implemented" (`pure-values.fs --feature mirroredCopy`). |

**Do not write these a second time.** `src/lang/dataflow/fs-values.mjs`
(`extraValueBuiltins`, language work in flight) already implements `atan2`,
`rotationAround`, `coordSystem`, `toWorld`, `mirrorAcross`, `isInteger`,
`min`, `max`, `toString` and others from the std source, for the graph tracer
only. The right move is to move that module into production (`src/scalars.mjs`)
and let the tracer import it from there, agreed with the language owner.
Differences to settle in that step:

- its `coordSystem` neither normalizes nor checks perpendicularity;
- its `isInteger` has no bound-spec form.

### B. Queries: `src/queries.mjs` (effort S to M, risk low to medium)

- **`qEverything([entityType])`.** A new query kind resolving all records. That
  includes sketch records, because Onshape counts sketch bodies as bodies; the
  existing `qBodyType(…, SOLID)` then filters them out. A face, edge or vertex
  entity type goes through the existing `owned` kind. **`qNothing()`** is an
  empty union (55 corpus files use it).
- **`makeRobustQuery(context, q)`.** Std: `qUnion(evaluateQuery(q) +
  startTrackingIdentity(q))`. Within one wonky build this is a snapshot
  `reference` query of the evaluated rows (the kind `evaluateQuery` already
  returns). Tracking comes from record identity: `opBoolean` keeps the target
  record (`records[0]`), so a robust query to a Boolean target survives, and
  one to a consumed tool resolves empty. State that approximation in a code
  comment. Anything the kernel cannot track must not be invented.
- **`qContainsPoint(q, point)`.** A new kind `containsPoint`, resolved with the
  Bend point-in-solid classifier (`kernel/solid-classification.bend` through
  `classificationInput`). The rules:
  - `Inside` and `Boundary` count as containing.
  - `Unresolved` raises a capability error (`Solid classification
    unresolved: <reason>`).
  - Faces, edges and vertices are refused explicitly for now. The corpus uses
    `qContainsPoint` on bodies in 325 of 335 calls and on edges or faces in 8;
    2 calls pass a variable whose type the scan cannot tell.
  - Load the classifier in `build()` (`src/index.mjs`) before interpretation,
    not in `loadJsKernel()`. Adding a module there changes the kernel wiring
    that `src/native/kernel-wiring.mjs` parses, and makes every native build
    stale.
  - The prototype resolved `qContainsPoint` over analytic and planar bodies
    without refusals.

### C. `opTransform`: `src/queries.mjs`, next to `opPattern` (effort M, risk medium)

Definition `{bodies, transform}`. Rules:

- **Rigid transforms only.** Factor out `opPattern`'s rigid check into one
  helper. Scale or shear (for example `scaleUniformly`) is refused with
  `opTransform supports rigid transforms only`. A reflection (det −1, as from
  `mirrorAcross`) is refused as not implemented. It needs orientation reversal
  in both transform adapters (F below). No corpus file passes a mirror to
  `opTransform`. Mirrors reach the kernel through `opPattern` only.
- **Solid bodies only.** Sketch bodies are refused. The corpus transforms only
  solids.
- **An empty `bodies` query is an explicit error, not a no-op.**
  - std itself guards its own calls with `isQueryEmpty` (`derivedMirror.fs`).
  - Here, an empty query means that the feature expected Part Studio parts
    (section 5).
  - Check Onshape's own behavior once over the session bridge before shipping.
    If Onshape accepts an empty query, follow it.
  - The frozen std mirror does not settle it. `opTransform` is the bare
    builtin `@opTransform` (`geomOperations.fs:1822`). `derivedMirror.fs:111`
    guards its call with `isQueryEmpty`. `transformResultIfNecessary`
    (`feature.fs:507`) and `sheetMetalTransform` (`importDerived.fs:431`) call
    it without a guard, on queries that are rarely empty.
- **Modify in place.** Replace `record.body` with the transformed body, and
  keep `record.key`, `createdBy`, `name` and `appearance`. Then
  `qCreatedBy(originalId)` still finds the moved body, which is what every
  corpus use relies on (`var q = cyl(...); opTransform(q); cut(b, q)`).
  - Planar bodies: `transformInBend`. Analytic bodies: `transformAnalytic`.
  - Both append to `operationHistory.transformChain` and call
    `identifyTransform`.
  - Keep the source body id. The adapters currently use one argument as both
    the body id and the operation id. Pass the operation id separately
    (a small signature change).
- **Two properties to document:**
  - `transformInBend` stores rotation columns and vertices as F32 (`vector()`
    uses `Math.fround`), exactly as `opPattern` does today. Repeated transforms
    compound that rounding.
  - `transformAnalytic` preserves volume only for the construction methods it
    whitelists (for example, not the through-hole pierce result). `evVolume`
    after a transform can then raise its existing capability error.
- **Verified in the harness.** `interface-r3.fs#cableClamp` poses two
  cylinders with `toWorld(coordSystem(...))` and pierces a bar. The result has
  8 faces and 857.5247833867529 mm³, equal to 912 − 2·π·1.7²·3. OCCT reads
  the STEP as a valid solid with the same volume.

### D. `opRevolve`: `src/library.mjs` (D1: effort M, risk low; D2: kernel, effort M to L)

- **D1.** Full turns only: `angleForward` of 360° and `angleBack` absent or
  0; 55 of 58 corpus calls are full turns.
  - The profile must be a solved polygon sketch (rectangle, polyline or line
    segments) in a plane through the axis.
  - Map every vertex to (radius, height) in the axis frame, orient the loop
    counterclockwise, and call `revolveInBend` (`src/analytic.mjs`).
  - Circle and line/arc profiles and partial angles are refused explicitly.
- **D2.** Profiles with an edge on the axis are the normal case for turned
  parts: pins, cones, the M3 relief tool. `kernel/revolve.bend` refuses them
  (refusal code 2). Supporting them needs apex and pole handling in Bend:
  - a disk cap instead of an annulus;
  - a cone apex vertex;
  - no seam edge on the axis.
- `opLoft`'s `"bodyType" : BodyType.SOLID` field (the next blocker of
  `revolve_and_loft.fs`) is a one-line addition in the same area. It belongs
  to the kernel-sketch-and-ops cluster.

### E. Companion fixes (effort S, risk low)

- **Empty Boolean operands.** `opBoolean` with 0 targets or 0 tools
  (`src/library.mjs`) should raise its own error, for example `opBoolean
  targets query resolved to no bodies`, before the arity check. Today it
  reports "currently requires two tools ...", which reads like a kernel limit.
  That hides the real blocker of 14 units in this cluster (section 5).
- **Name diagnostics.** When a lookup fails:
  - Tell std names from unknown ones, using a frozen list of std exports with
    provenance (mirror commit `a2a7b13e`, `tmp/lang/onshape-std`): "Onshape
    std function 'skText' is not implemented by wonky" vs "'foo' is not
    defined".
  - Append all other unimplemented std names the file references, from a
    static walk like `scripts/corpus/fs-missing-builtin/static-scan.mjs`.

  This is a diagnostic only. It must not refuse code that never runs.

### F. Reflections in `opPattern` and `opTransform` (later; kernel, effort M, risk medium)

This is not a first blocker of any file, but it is on the path of 6 cluster
files, so plan it with this cluster rather than find it again later.

- **Corpus use.** `mirrorAcross` appears in 11 headed unique files in 4
  families (static scan). Every use is an `opPattern` transform.
  - Cluster files: `guide-r3.fs`, `guide-r4.fs`, `r10-adapters.fs`
    (archive-r10 and archive-r16), `corner_loft.fs` and
    `curved-accepted-source.fs`.
  - In each of them the mirror comes after the next blocker of section 5
    (Part Studio input, or `opLoft` with non-circular sections). It is at
    best the blocker after next.
- **Why it is kernel work.** `transformInBend` (`src/kernel.mjs:80`) and
  `transformAnalytic` (`src/analytic.mjs:139`) pass the matrix into Bend as a
  `Rotation`. `kernel/topology.bend:transform` and `kernel/analytic.bend`
  (`surface_transform`, `curve_transform`) rotate normals, axes and frames,
  and keep loop order and use direction. Under det −1 that leaves the loop
  orientation inconsistent with the mirrored normal, and it flips the
  parameter sense of circles, arcs and seams.
- **What it needs in Bend:**
  - reverse every loop (order and `forward`) when det < 0;
  - rebuild each face frame right-handed (x mirrored, y = n × x);
  - flip the direction and remap `curveRange` for circles, arcs and seams;
  - add an identity rule for the mirrored copy.

  `opPattern` and `opTransform` share it. Until then both keep their
  explicit refusal.

### Out of scope for this cluster

These are separate projects:

| name | files / families (static) | why |
|---|---:|---|
| `skText` | 101 / 27 | Needs font outlines (TrueType quadratic curves) as exact sketch profiles. Nearly always an engraved revision mark. Skipping it silently is forbidden, so it needs real geometry. Effort L to XL. |
| `opFillet`, `opChamfer`, `opOffsetFace`, `opDeleteFace` | 64 / 19, 13 / 5, 27 / 7, 11 / 4 | Kernel features. |
| `qGeometry` with `GeometryType`, `evPlane`, `qClosestTo`, `qNthElement` | 43 / 10, 18 / 6, 13 / 3, 21 / 6 | Face and edge queries. |

### Effort and risk summary

- Packages A, B, C and D1 plus tests: about 2 days (M).
- D2 is a Bend change (M to L).
- F (reflections in `opPattern` and `opTransform`) is a Bend change (M). It
  is on the path of 6 cluster files, after their next blocker.
- The main risks are all in C: in-place record semantics, the identity and
  operation-id split, F32 rounding of moved planar bodies, and Onshape's
  empty-query behavior.
- Tests: the repros become integration tests with the exact volumes above.
  Also cover:
  - analytic bodies (a frustum posed by `toWorld`);
  - a refused reflection and a refused scale;
  - `qContainsPoint` on a boundary point and on an unresolved case;
  - `makeRobustQuery` after a Boolean that consumed the tool.

## 5. What each file hits next

**Method.** `scripts/corpus/fs-missing-builtin/harness.mjs` runs a unit
through the production parser, `Interpreter`, `ModelingContext`, source-map
tracker, JS kernel and `strict` policy.

- It adds prototype builtins (A, B, C, D1 above), defined only in that script.
- Unprototyped names still fail exactly as in production. The first failure
  after the prototypes is therefore the next blocker.
- It never writes into the corpus.
- It also counts "all-bodies" queries (`qAllModifiableSolidBodies`,
  `qEverything`) that `evaluateQuery` resolves to nothing.

The passes:

- **p1b**: prototypes only, all 56 units. It reproduced p1 exactly (56 of 56
  messages identical).
- **p2**: additionally stubs the next construct in the source copy for 6
  units:
  - removes the `skText` helper calls;
  - removes the hot-wire sweep block;
  - drops the `as IntegerBoundSpec` tag.

  The stubs are in `stubs-p2.json`, and the patched copies are in
  `tmp/corpus/fs-missing-builtin/src/`.
- **p3**: tried to fold multi-tool Booleans pairwise. It showed that the arity
  errors come from empty operands, not from many tools.

**Findings by next blocker:**

- **`opBoolean` capability (15 files, 16 units).**
  - The 13 fs95 `cableClamp` units complete 21 calls and then fail in the
    first countersink cut (`cs > cut`). A lofted frustum (r 1.7 → 3.51 mm,
    1.82 mm long) is posed by `opTransform` onto the bar, and its small circle
    coincides with the wall of the 1.7 mm hole just cut. At the bar top the
    frustum radius is 3.500055 mm. The files differ in how far the hole sits
    from the bar's end face:
    - 11 files (`interface-r6.fs` to `interface-r11.fs`, `interface-r11-prepared.fs`
      and the four bottom-drive `native-source.fs`): 3.3 mm. The countersink
      breaks 0.2 mm out through the end face `z = 25`, a plane parallel to
      the cone axis, so the new edge is a hyperbola.
    - `interface-r5.fs`: 3.5 mm. The rim grazes the end face; the breakout is
      5.5e-5 mm deep and 0.039 mm wide.
    - `interface-r4.fs`: 6 mm. The countersink stays inside the bar, which is
      the catalogue case `plate-countersink`. Its next call after both
      countersinks is `skText` (the revision mark).
  - `module-r4-upload.fs#frameR4Diagonal` (`cut@575`): the foot hole builds.
    The second cut is a **blind** pilot hole: r 1.35, from 0.2 mm above the
    top down 9.8 mm into a section 12 mm thick. The pierce admission declines
    with code 2 ("tool axis perpendicular to exactly two faces"), because the
    web has three faces normal to Z. The message is misleading here; a blind
    hole is outside the pierce admission anyway.
  - `#frameR4HeadRetainer` (`unite@666`): a coaxial union of a screw shaft
    (cylinder r 1.5) and a frustum head (r 1.5 → 3.36) that meet at equal
    radius. The coaxial Boolean only takes cylinders.
  - `top-structure-r1.fs#motorCrossmemberU2` (`unite@133`, first pass,
    side −1): an r 6 boss, posed along X and spun 120° about Z, crosses the
    vertical corner edge of the crossbeam box obliquely.
  - Measured `recover` results for all of these are in section 6.
- **The feature edits existing Part Studio parts (12 files, 22 units).**
  - The empty all-bodies query was measured in 19 units, 9 files:
    - `dual-spur-r25`;
    - `central-drive-r27/r28`, `central-spur-r26`, `mounting-r26`;
    - `r10-adapters` ×2;
    - `belt-loop-r29/r30`.
  - In 14 of those units the empty query flows on and surfaces as `opBoolean
    currently requires two tools ...` (companion fix E).
  - In `guide-r3.fs`, `guide-r4.fs` and `system-fixes.fs#finishSc15Flap`, the
    model's own count check throws first.
  - These belong with the fs-needs-partstudio-input cluster. They are edit
    features, not build-from-source models.
- **Module import (7 files).**
  - `cad-project-040` buildplate r11 to r16 (`makeId` builds the key of a
    `Parts::build` instance, and the import has no snapshot);
  - `mg995-flap.fs`;
  - `system-fixes.fs#correctLargeFunnel`.
- **Operation limits (5 files).**
  - `corner_loft.fs` and `curved-accepted-source.fs` complete 36 and 54 calls,
    then hit `opLoft` with non-circular sections.
  - `revolve_and_loft.fs` builds its revolved sleeve, then hits the `opLoft`
    `bodyType` field.
  - `qualified-source.fs` is revolve D2.
  - `hot_wire.fs` completes 697 calls, then hits an open line/arc path sketch
    (`OpenEndpoint`) for `opSweep`, which is also missing. With that block
    stubbed out, 702 calls complete, and then the planar arrangement refuses
    `switchPocketCut` (`UnsupportedArrangement (stage 10)`). That cut makes a
    fully enclosed internal void, which the next cut opens again. The closest
    bake-off case is `internal-void` (not run with this file's values).
- **Interpreter semantics (2 files).** `unchanged-link-test-strip.fs` and
  `printed_joints.fs` hit `Expected IntegerBoundSpec`. Without the tag they
  hit `Feature precondition failed`, because `featureDefaults` derives no
  default from an integer bound.
- **`skText` (2 files).** `presentation.fs` and `interface-r3.fs#cableClamp`
  build once the text calls are stubbed out (the latter validated with OCCT).
  Neither result is valid, because the lettering is missing.

| file | family | cluster units / all | blocker rank | builtin | calls done before → after | next blocker (→ after stubbing it) |
|---|---|---|---|---|---|---|
| `cad-project-039/belt-fixed-r30/Review/archive-before-internal-keys/native/belt-loop-r30.fs` | fs330 | 2/2 | sole | qContainsPoint | 0→0 | Part Studio input (empty all-bodies query) |
| `cad-project-040/src/buildplate-r16.fs` | fs459 | 1/1 | sole | makeId | 1→1 | module import |
| `cad-project-039/belt-fixed-r30/experimental-belt-segments-r1/cad/unchanged-link-test-strip.fs` | fs327 | 1/1 | sole | isInteger | 0→0 | IntegerBoundSpec type tag → feature parameter default |
| `cad-project-043/fsocct/examples/revolve_and_loft.fs` | fs564 | 1/1 | sole | opRevolve | 3→10 | op limit: opLoft bodyType field |
| `cad-project-043/fsocct/cases/workspace/corner_loft.fs` | fs551 | 1/1 | sole | atan2 | 0→36 | op limit: opLoft non-circular |
| `cad-project-014/document-organization/2026-09-10-current/showroom/presentation.fs` | fs64 | 1/1 | sole | skText | 50→50 | skText → builds without lettering (21 bodies) |
| `cad-project-002/sc15-adaptation/system-fixes.fs` | fs18 | 2/2 | sole | makeRobustQuery | 0→0 | Part Studio input (model check); module import |
| `cad-project-039/archive-r16/r10-adapters.fs` | fs414 | 2/2 | sole | qEverything | 0→6, 0→20 | Part Studio input (empty all-bodies query) |
| `cad-project-002/mg995-flap/mg995-flap.fs` | fs9 | 1/1 | sole | makeRobustQuery | 0→0 | module import |
| `cad-project-041/single-step-r10/jobs/m3-module/native/qualified-source.fs` | fs568 | 1/1 | sole | opRevolve | 21→21 | op limit: revolve profile on the axis (D2) |
| `cad-project-014/machine-interface-r11/top-motor-down-r2/structure/top-structure-r1.fs` | fs87 | 1/9 | minor | opTransform | 10→12 | opBoolean: oblique boss union at a box corner (recover: right volume, STEP fails exact CurveOnSurface) |
| `cad-project-039/belt-return-r25/dual-spur-r25.fs` | fs362 | 3/3 | sole | opTransform | 0→10, 0→6, 0→7 | Part Studio input (empty all-bodies query) |
| `cad-project-002/funnel-holder-r4/guide-r4.fs` | fs20 | 1/2 | minor | makeRobustQuery | 0→0 | Part Studio input (model check) |
| `cad-project-043/fsocct/cases/workspace/printed_joints.fs` | fs565 | 1/1 | sole | unitless | 0→0 | IntegerBoundSpec type tag → feature parameter default |
| `cad-project-039/belt-central-r28/central-drive-r28.fs` | fs276 | 3/4 | primary | opTransform, qContainsPoint | 0→10, 0→7, 0→0 | Part Studio input (empty all-bodies query) |
| `cad-project-043/fsocct/cases/workspace/hot_wire.fs` | fs553 | 2/2 | sole | opTransform | 537→697 | op limit: open path sketch for opSweep → planar arrangement (internal void) |
| `cad-project-014/machine-interface-r11/top-full-module-r4/native/module-r4-upload.fs` | fs84 | 2/17 | minor | opTransform | 10→17, 13→14 | opBoolean: blind pilot hole (recover: exact), and the pierced web does not export to STEP; opBoolean: coaxial shaft + frustum union (recover: exact) |
| `cad-project-039/belt-fixed-r29/native/belt-loop-r29.fs` | fs330 | 2/2 | sole | qContainsPoint | 0→0 | Part Studio input (empty all-bodies query) |
| `cad-project-040/archive/r11/buildplate-r11.fs` | fs459 | 1/1 | sole | makeId | 1→1 | module import |
| `cad-project-040/archive/r12/before-hardware/src/buildplate-r12.fs` | fs459 | 1/1 | sole | makeId | 1→1 | module import |
| `cad-project-040/archive/r13/before-product-r14/src__buildplate-r13.fs` | fs459 | 1/1 | sole | makeId | 1→1 | module import |
| `cad-project-040/archive/r14/before-dfm-r15/src__buildplate-r14.fs` | fs459 | 1/1 | sole | makeId | 1→1 | module import |
| `cad-project-040/archive/r15/before-clamp-reinforcement-r16/src__buildplate-r15.fs` | fs459 | 1/1 | sole | makeId | 1→1 | module import |
| `cad-project-039/hopper-corner-inserts-r2/curved-accepted-source.fs` | fs551 | 1/1 | sole | atan2 | 0→54 | op limit: opLoft non-circular |
| `cad-project-039/belt-central-r26/mounting/mounting-r26.fs` | fs273 | 1/2 | primary | opTransform | 0→6 | Part Studio input (empty all-bodies query) |
| `cad-project-039/archive-r10/r10-adapters.fs` | fs414 | 2/2 | sole | qEverything | 0→6, 0→20 | Part Studio input (empty all-bodies query) |
| `cad-project-039/belt-central-r26/central-spur-r26.fs` | fs276 | 2/3 | primary | opTransform | 0→10, 0→7 | Part Studio input (empty all-bodies query) |
| `cad-project-002/funnel-holder-r3/guide-r3.fs` | fs20 | 1/2 | minor | makeRobustQuery | 0→0 | Part Studio input (model check) |
| `cad-project-039/belt-central-r27/central-drive-r27.fs` | fs276 | 2/3 | primary | opTransform | 0→10, 0→7 | Part Studio input (empty all-bodies query) |
| `cad-project-014/deliverables/Sorter_V2_Printed_Interface_R3/Source/interface-r3.fs` | fs95 | 1/16 | minor | opTransform | 10→20 | skText → builds without lettering (1 body, OCCT-valid) |
| `cad-project-014/machine-interface-r4/interface-r4.fs` | fs95 | 1/19 | minor | opTransform | 10→21 | opBoolean: countersink at the hole wall (recover: exact) → skText revision mark |
| `cad-project-014/deliverables/Sorter_V2_Printed_Interface_R5/Source/interface-r5.fs` | fs95 | 1/19 | minor | opTransform | 10→21 | opBoolean: countersink rim grazes the bar end, 5.5e-5 mm (recover: declined, hyperbola) |
| `cad-project-014/deliverables/Sorter_V2_Bottom_Interface_R6/Source/interface-r6.fs` | fs95 | 1/22 | minor | opTransform | 10→21 | opBoolean: countersink breaks out of the bar end (recover: declined, hyperbola) |
| `cad-project-014/machine-interface-r7/interface-r7.fs` | fs95 | 1/24 | minor | opTransform | 10→21 | opBoolean: countersink breaks out of the bar end (recover: declined, hyperbola) |
| `cad-project-014/machine-interface-r8/interface-r8.fs` | fs95 | 1/24 | minor | opTransform | 10→21 | opBoolean: countersink breaks out of the bar end (recover: declined, hyperbola) |
| `cad-project-014/deliverables/Bottom_Interface_R9_Tapered_Joints/Source/interface-r9.fs` | fs95 | 1/24 | minor | opTransform | 10→21 | opBoolean: countersink breaks out of the bar end (recover: declined, hyperbola) |
| `cad-project-014/deliverables/Bottom_Interface_R10_Design_System/machine-interface-r10/interface-r10.fs` | fs95 | 1/24 | minor | opTransform | 10→21 | opBoolean: countersink breaks out of the bar end (recover: declined, hyperbola) |
| `cad-project-014/machine-interface-r11/top-entry-r12/baseline/interface-r11.fs` | fs95 | 1/26 | minor | opTransform | 10→21 | opBoolean: countersink breaks out of the bar end (recover: declined, hyperbola) |
| `cad-project-014/bottom-drive-review-2026-09-19/baseline/native-source.fs` | fs95 | 1/26 | minor | opTransform | 10→21 | opBoolean: countersink breaks out of the bar end (recover: declined, hyperbola) |
| `cad-project-014/machine-interface-r11/refinement-prep/interface-r11-prepared.fs` | fs95 | 1/26 | minor | opTransform | 10→21 | opBoolean: countersink breaks out of the bar end (recover: declined, hyperbola) |
| `cad-project-014/bottom-drive-review-2026-09-19/iterations/r12-0/native-source.fs` | fs95 | 1/26 | minor | opTransform | 10→21 | opBoolean: countersink breaks out of the bar end (recover: declined, hyperbola) |
| `cad-project-014/bottom-drive-review-2026-09-19/iterations/r12-1/native-source.fs` | fs95 | 1/26 | minor | opTransform | 10→21 | opBoolean: countersink breaks out of the bar end (recover: declined, hyperbola) |
| `cad-project-014/bottom-drive-review-2026-09-19/candidate/native-source.fs` | fs95 | 1/26 | minor | opTransform | 10→21 | opBoolean: countersink breaks out of the bar end (recover: declined, hyperbola) |

"calls done" counts completed modeling calls from the source-map trace:
first in the corpus run, then in the harness (p1b).

## 6. Overlap with in-flight work

- **Boolean bake-off (`kernel/proto/**`, `docs/bakeoff.md`,
  `docs/proto-recover.md`).**
  - This cluster is not a Boolean. The fix does not depend on the bake-off,
    and the bake-off does not solve it.
  - The next blockers of 15 files are Booleans. I ran each of them through
    the `recover` route with the corpus file's own values.
    - Script: `scripts/corpus/fs-missing-builtin/recover-next.mjs`. It is the
      pipeline of `scripts/bakeoff/recover-extra.mjs` (bake-off tessellation,
      manifold3d mesh Boolean with face provenance as the test input, OCCT
      exact CSG as the oracle, recovery in Bend, STEP export and OCCT check),
      with its own directory `tmp/corpus/fs-missing-builtin/recover`. Nothing
      under `fixtures/bakeoff` or `out/bakeoff` was written.
    - Both targets were run: the bake-off's native `cpu1` build and the JS
      target (`--js`). The verdicts are identical. The result file is
      `out/corpus/cluster-fs-missing-builtin-recover.json` (JS run).
    - Deviation 0.01 mm. "exact" means OCCT-valid with exact CurveOnSurface,
      and volume and area within 1e-7 of the OCCT CSG.

    | case (corpus Boolean) | files | recover verdict | detail |
    |---|---:|---|---|
    | `fs95-cs-first`: first countersink cut of `cableClamp` in r6 to r11 and the bottom-drive copies; it breaks 0.2 mm out of the bar end | 11 | **unresolved** | "plane/cone section is a hyperbola (curve type missing in the body format)" |
    | `fs95-cableclamp`: the same feature complete (2 holes, 2 countersinks) | (same 11) | **unresolved** | same reason |
    | `fs95-r5-cs-first`: `interface-r5.fs`, the rim grazes the bar end (5.5e-5 mm) | 1 | **unresolved** | same reason |
    | `fs95-r4-cableclamp`: `interface-r4.fs`, both countersinks inside the bar | 1 | exact | 10/22/14 faces/edges/vertices, volume error 0 |
    | `r4-diagonal-headpilot`: `frameR4Diagonal` web minus foot hole minus blind pilot | 1 | exact | 14/33/22, volume error 2.5e-15 |
    | `r4-head-retainer`: `frameR4HeadRetainer` shaft plus frustum head | (same file) | exact | 4/5/3, volume error 5.2e-14 |
    | `u2-boss-join`: `motorCrossmemberU2` crossbeam plus the oblique boss | 1 | invalid STEP | 8/16/11, 7 planes and 1 cylinder, 2 ellipses; volume error 2.7e-9; OCCT valid only with sampled checking, fails exact CurveOnSurface |

  - `hot_wire.fs` reaches its internal-void cut only after a second missing
    feature (`opSweep` on an open path) is stubbed out. It was not run; the
    closest catalogue case, `internal-void`, is exact.
  - **Consequence for the fs95 family.** Even with this cluster fixed and
    `recover` in production, 12 of 13 fs95 `cableClamp` units stop at the
    countersink until the body format has a hyperbola (more generally, conic
    sections of a cone by a plane parallel to its axis). The breakout is
    0.2 mm and has no function in the printed part. Keeping the first hole at
    least 3.51 mm from the bar end (today 3.3 mm, r5 3.5 mm) removes it, but
    that is a design change for Marc, not a kernel fix.
  - **The production pierce message is misleading for the blind pilot.**
    Decline code 2 reports "tool axis perpendicular to exactly two faces",
    while the real reason is that the tool stops inside the body. A separate
    decline for "tool ends inside the body" would name it (kernel-sketch-and-ops
    or boolean-capability owner).
  - The countersink also needs this cluster's `opTransform`: the tool is a
    lofted frustum posed with `toWorld(coordSystem(...))`, and
    `transformAnalytic` handles it.
- **Native binding (`src/native/**`).**
  - The 19-entry slice includes `topology.bend:transform` and
    `identity.bend:transform`. `opTransform` of planar bodies would run
    natively.
  - `analytic.bend:transform` is not in the slice. Under
    `WONKY_BACKEND=native`, moving an analytic body (every cylinder and
    frustum tool in this cluster) would raise `NativeCapabilityError`, as
    designed.
  - `revolve.bend` and `solid-classification.bend` are not in the slice either.
  - Keep the classifier out of `loadJsKernel()` (B above), so the native build
    key does not change.
- **Language work (`src/lang/**`, `kernel/lang/**`).**
  - `src/lang/dataflow/fs-values.mjs` and `src/lang/wk/stage-fs.mjs` already
    implement most pure builtins, and `makeId`, `qEverything` and
    `makeRobustQuery`, for the tracer and stager.
  - `src/lang/wk/record-fs.mjs` states that `opTransform` stays unsupported
    "exactly as in the production build". Once production has `opTransform`,
    the recorder needs a matching recording builtin.
  - Promote the shared pure module (A) instead of keeping two versions.
  - `docs/language/spike-real-model.md` and `docs/language/prototype.md` were
    updated after the second pass. The spike ran the 25 corpus features whose
    graph uses only its op set; 7 of them, plus its control
    `central-drive-r27#centralShafts26`, stop at `opTransform`
    (`tmp/lang/wk/real/select-all.log`).
    - The 8 features: `central-drive-r27`, `central-drive-r28` and
      `central-spur-r26` `centralShafts26`, `dual-spur-r25#dualShafts25`,
      `top-structure-r1#motorCrossmemberU2`, `interface-r11#cableClamp`,
      `module-r4-upload#frameR4Diagonal` and `#frameR4HeadRetainer`.
    - All 8 are units of this cluster. Their next blockers are in section 5:
      Part Studio input for the four shaft features, `opBoolean` for the
      other four.
    - The four shaft features start from `qAllModifiableSolidBodies()`, which
      is empty in a standalone build. Even with `opTransform` they cannot
      become a language gate workload without a Part Studio snapshot.
    - The spike's order for Marc's cylinder parts is: PIERCE admission for
      non-prismatic targets, the NONE cases, `opTransform`, then `skText`
      and line/arc sketches. That agrees with this report. `opTransform` is
      needed, but it does not by itself make any of those features build.
- **Viewer rework.** No overlap. This is a frontend library gap.

## 7. Corpus-wide reach (static)

`scripts/corpus/fs-missing-builtin/corpus-scan.mjs` parses every unique FS
file with the production parser. It collects the free names that neither the
file declares nor the production builtins provide; `NS::` module names are
excluded.

- 313 of 332 files parse. 26 of them are header-less fragments, parsed with a
  synthetic header. 19 do not parse at all.
- 287 headed files in 103 families remain:

| name | files | families |
|---|---:|---:|
| `opTransform` | 145 | 41 |
| `skText` | 101 | 27 |
| `qEverything` | 91 | 29 |
| `opFillet` | 64 | 19 |
| `qNothing` | 55 | 26 |
| `rotationAround` | 45 | 16 |
| `qGeometry` / `GeometryType` | 43 | 10 |
| `qContainsPoint` | 40 | 19 |
| `opRevolve` | 36 | 11 |
| `toWorld`, `coordSystem` | 35 | 10 |
| `opOffsetFace` | 27 | 7 |
| `atan2` | 23 | 4 |
| `qNthElement` | 21 | 6 |
| `makeRobustQuery` | 12 | 7 |
| `makeId` | 9 | 4 |

- 236 of the 287 files (83 families) use at least one name from the fix set
  A to D.
- In 99 files (44 families), the fix set covers every unimplemented name.
  Those files still meet the other clusters: module imports, Part Studio
  input, Booleans.

A static reference is an upper bound. A name in a branch that never runs costs
nothing at run time.

## 8. Reproduce

```sh
node scripts/corpus/fs-missing-builtin/units.mjs            # cluster units -> tmp/corpus/fs-missing-builtin/cluster-files.json
node scripts/corpus/fs-missing-builtin/static-scan.mjs      # free names per cluster file
node scripts/corpus/fs-missing-builtin/corpus-scan.mjs      # corpus-wide static tally
node scripts/corpus/fs-missing-builtin/batch.mjs --pass p1b # 56 units, prototypes, max 3 processes, uptime logged
node scripts/corpus/fs-missing-builtin/batch.mjs --pass p2 --stubs-file stubs-p2.json --stubbed-only
node scripts/corpus/fs-missing-builtin/analyze.mjs          # -> out/corpus/cluster-fs-missing-builtin.json
# every repro (production CLI and harness) against the stated result, max 3 processes, uptime logged:
node scripts/corpus/fs-missing-builtin/verify-repros.mjs    # -> out/corpus/cluster-fs-missing-builtin-verify.json
# single repros, production CLI and harness:
node bin/wonky.mjs fixtures/corpus-repro/fs-missing-builtin/op-transform-pose.fs --check
HARNESS_ROOT=$PWD node scripts/corpus/fs-missing-builtin/harness.mjs fixtures/corpus-repro/fs-missing-builtin/op-transform-pose.fs
# next-blocker repros (production CLI, no missing builtin involved):
node bin/wonky.mjs fixtures/corpus-repro/fs-missing-builtin/next-countersink-breakout.fs --feature countersink --check
node bin/wonky.mjs fixtures/corpus-repro/fs-missing-builtin/next-pierced-web-step.fs --feature headPilot --check
node bin/wonky.mjs fixtures/corpus-repro/fs-missing-builtin/next-pierced-web-step.fs --feature footHole --format step --out tmp/corpus/fs-missing-builtin/diag/out-web/model
# the Boolean next blockers through the bake-off recover route (uv, manifold3d, OCCT):
node scripts/corpus/fs-missing-builtin/recover-next.mjs --js   # -> out/corpus/cluster-fs-missing-builtin-recover.json
node scripts/corpus/fs-missing-builtin/analyze.mjs              # joins the recover verdicts into the cluster JSON
```

## Limitations

- **The harness shows direction, not correctness.** Its builtins are
  prototypes. The only harness geometry checked independently is the one OCCT
  validation of `interface-r3.fs#cableClamp`, plus the analytic volumes of
  the repros. The `recover` verdicts in section 6 are OCCT-checked, but they
  come from the bake-off prototype, not from production.
- **Onshape parity is open in two places:**
  - `opTransform` with an empty query;
  - `qContainsPoint` on a boundary point.

  Check both over the session bridge before shipping.
- **Stubs remove geometry.** A stubbed "builds" result is never a valid model
  (missing lettering, missing wire).
- **The load was heavy (33 to 119).** Wall times in the harness rows are not
  performance data.
- **The `recover` cases are hand-written CSG trees** of the corpus values, not
  the operands the harness built. The trees were checked against the source
  lines cited in the script, and the OCCT CSG volumes are plausible (for
  example the complete r4 `cableClamp` is 1592.84 mm³), but a transcription
  error would change the verdict of that one case.
- **The STEP failure of the pierced web is not root-caused.** Bend's cylinder
  pcurve planner returns `Unresolved(InvalidSource)` for a hole in the 9-gon
  web (also shifted to the origin), while the same hole in a box or a pentagon
  exports. That belongs to the exporter owner; the repro is
  `next-pierced-web-step.fs`.
