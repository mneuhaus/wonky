# Cluster boolean-capability: opBoolean outside the admitted Boolean paths

Date: 2026-09-22 23:47 to 2026-09-23 01:20 (probe, fix ladder, bake-off
repros, first hybrid pass), completed 2026-09-23 04:10 to 04:40 (repro
re-check, hybrid results, N-ary fold correction, `hybrid-all` and F32x2
passes). Input: [the corpus run](run.md) (`out/corpus/runs.jsonl`, cluster 2).

- HEAD `79bbfeec` plus the working tree. `src/boolean.mjs` (19:16),
  `src/library.mjs` (11:22) and `kernel/pierce.bend` (18:18, all 2026-09-22)
  are unmodified against HEAD and unchanged between the two sessions.
  `kernel/proto/{corefine,recover}` did not change between the sessions either
  (only `kernel/proto/sdf` did).
- Node v22.23.1, default JS path (`WONKY_BACKEND` unset), `strict` modeling
  policy, at most 3 wonky processes, 180 s per unit (360 s for the hybrid
  passes). No unit timed out.
- The machine was shared with benchmarks and other analysts: load average 10
  to 123 on 18 cores. `uptime` per pass is in
  `out/corpus/boolean-capability/run-meta.jsonl`.
- No production file was changed. The instrumentation is an in-memory module
  hook, loaded only by the probe scripts.

Machine-readable results in `out/corpus/boolean-capability/`:

- `probe.jsonl`: every unit of the cluster, with the refused operands described
  and classified into a sub-cause;
- `probe-<step>.jsonl`: the same units with the refusals of one fix step
  stubbed out (the fix ladder, section 5);
- `probe-hybrid.jsonl`, `probe-hybrid-all.jsonl`,
  `probe-hybrid-all-linearc.jsonl`: the same units on real geometry, with the
  refusals handed to the bake-off prototypes (section 6);
- `files.json`: one row per file, with the role of this cluster and every
  unit's next blocker per step;
- `bakeoff.json`: the repros through corefine + recover.

Repros: [`fixtures/corpus-repro/boolean-capability/`](../../fixtures/corpus-repro/boolean-capability/README.md).
Scripts: `scripts/corpus/boolean-*.mjs` (section 8). Raw checks of the second
session: `tmp/corpus/boolean-capability/recheck/`.

## Answer in short

1. **"general trimmed-face booleans are not implemented" is the honest
   summary, but it hides five different gaps.** `booleanInBend`
   (`src/boolean.mjs`) is a dispatcher over five exact special cases. It
   admits operands by their surface and curve families, and refuses everything
   that falls between the arms. The 174 units split into:

   | sub-cause | units | files | families | what is missing |
   |---|---:|---:|---:|---|
   | coaxial-revolution | 83 | 18 | 5 | the coaxial arm takes two cylinder *primitives* only: not a ring (itself a coaxial result), not a loft cone |
   | general | 40 | 39 | 8 | any Boolean in which a plane or cylinder trims a curved face: hex socket in a screw, notch across an arc band, a boss or rounded end united with a box |
   | pierce-admission | 28 | 25 | 8 | a real through hole that the hole arm refuses: tilted F32 caps, a third perpendicular face, arc or ranged edges |
   | nary | 13 | 13 | 4 | more than two operands in one `opBoolean` |
   | general-trim | 10 | 10 | 2 | a large cylinder that trims a body's boundary, taken by the hole arm and declined |

2. **The root causes are in `src/boolean.mjs`, `src/library.mjs` and
   `kernel/pierce.bend`, plus the F32 planar kernel.**
   - The N-ary gap is a frontend guard (`src/library.mjs:254`).
   - The coaxial gap is an admission gate (`src/boolean.mjs:38`): the Bend
     arrangement (`kernel/boolean.bend` `coaxial`) takes one radial/axial
     rectangle per operand.
   - The hole gaps are `kernel/pierce.bend` `decline()`. It counts *every*
     target face perpendicular to the axis and wants exactly two. It reads
     every circle edge as a full circle, which is why `src/boolean.mjs:108`
     keeps ranged edges out.
   - The tilted-cap refusals come from the planar kernel: its prisms are F32
     (`kernel/geometry.bend` `Vec3` of `F32`). A plate 600 mm from the origin
     gets cap normals 1e-7 to 5.4e-7 rad off the source normal, and the hole
     admission demands a sine below 1e-7. In the hopper sources the plate
     normal and the hole axis are the *same* vector.
   - Everything else needs a general plane/cylinder Boolean, which production
     does not have.
3. **Targeted exact fixes are cheap, but alone they make almost nothing
   build.** On stubbed geometry (section 5):
   - after the N-ary fold, the coaxial generalization and a better hole
     admission, 124 units still stop in this cluster (97 at the general case,
     26 at the trims), and one unit reaches its end (`dual-hardware-r25.fs`);
   - with *every* refusal of this cluster answered, 8 units (7 files, 6
     families) reach their end.
4. **On real geometry the bake-off route answers 94 % of the refused
   Booleans, and 6 units build.** I spliced corefine + recover (native CPU
   builds) into whole corpus units, test-only (section 6):
   - The route took 769 refused Booleans in 162 units. 722 (93.9 %) came back
     as exact B-reps that pass the kernel's `validateAnalytic`. The median
     cost was 235 ms per Boolean, the maximum 1.1 s (native, not JS).
   - **6 units (5 files, 4 families) reach their end**, 3 of them whole files,
     all fastener reference models: `direct-mount-r26.fs`,
     `top-m5x25-reference-r30.fs`, `dual-hardware-r25.fs`, plus
     `mounting-r26.fs#mountingHardware26` and `upper-drive-r3.fs#footBolt`,
     `#retentionBolt`. 4 of them export STEP that OCCT
     (`BRepCheck_Analyzer`, exact CurveOnSurface) reports valid. The other 2
     stop at STEP export (`cylindrical parameter curves unresolved:
     InvalidSource`); with F32x2 prisms all 6 export valid STEP.
   - 47 units stop at a named refusal of the route: parallel-axis
     cylinder/cylinder, which recover calls a "space quartic" (14, the whole
     fs95 screw-boss line); plane tangent to a cylinder at stadium ends (10);
     F32 residuals (9); tessellation of the operand (12); corefine
     triangulation (2).
   - The rest move on to other clusters: `opTransform` (70 units), `skText`
     (18), the planar arrangement's InvalidTopology (12), `opLoft` profiles
     (9), F32 cap normals in `opExtrude` (6), `min` (4). 2 units hit a latent
     production bug: the pierce arm passes the null volume of a recovered
     body to `real()` and throws a `RangeError` (section 3).
5. **The F32 planar carrier is the second-biggest cause after the missing
   general Boolean.** It produces the 13 oblique-cap hole refusals, 9 of the
   route's refusals (residuals of 2.7e-7 mm and 3.6e-6 mm), the two-loop
   sliver I dumped (2.1e-7 mm between an F32 prism cap and an F64 cylinder
   cap), both STEP export refusals, and the hoppers' next blocker. With every
   polygon prism built in F32x2 (the neighbouring boolean-invalid-topology
   fix, simulated), those refusals and blockers disappear and all 6 built
   units export valid STEP. **But no further unit builds**:
   - the same units now stop earlier, because the bake-off tessellator cannot
     tessellate F32x2 prism faces (`collinear repair diverged`, 15 units);
   - the F32x2 prisms carry ranged line edges, which the pierce gate refuses.
     So **that fix would break every through hole that builds today** unless
     the gate is relaxed at the same time (section 4, F4).
6. **Fix, in order** (section 4):
   1. N-ary `opBoolean` in `src/library.mjs`, component-aware for UNION (S,
      low risk). A pairwise left fold is not enough: 2 fs95 brackets return
      two bodies with it.
   2. The F32x2 prism fix of the neighbouring cluster, together with a pierce
      gate that admits ranged *lines* and refuses a target without a
      certified volume (M, medium risk; shared).
   3. The general arm: the bake-off hybrid (tagged tessellation, corefine,
      recover, kernel validation) as the last arm of `booleanInBend`, refusing
      with recover's named reason (XL, medium-high risk). This cluster adds
      named prerequisites: parallel-axis cylinder/cylinder lines, tangent
      plane/cylinder corners, a tagged tessellator for every kernel body
      (including F32x2 prisms), a volume for recovered bodies, and JS speed.
   4. The exact fast arms as a complement, not a substitute: a coaxial
      meridian arrangement (M) and a pierce v2 (M). They stay analytic, need
      no tessellation and run in milliseconds on the JS target.
7. **Overlap.**
   - The bake-off owns the fix for the general part (above).
   - The native binding changes speed, not capability: it covers the planar
     entries today, and coaxial/pierce later with identical results.
   - The F32x2 prism fix is owned by the boolean-invalid-topology analysis.
     It must land together with the pierce gate change.
   - This is not a viewer issue. The language work does not touch `opBoolean`
     arity.

## 1. The cluster

174 units in 65 unique files and 17 families. All are
`capability · unsupported · opBoolean`, after 10 to 213 completed modeling
calls. The run's four messages map to the sub-causes like this (from
`probe.jsonl`; the probe message equals the corpus message in all 174):

| corpus message | units | sub-causes |
|---|---:|---|
| `… general trimmed-face booleans are not implemented` | 133 | coaxial-revolution 82, general 40, pierce-admission 11 (ranged edges) |
| `through holes need a tool axis perpendicular to exactly two faces` | 23 | pierce-admission 17, general-trim 5, coaxial-revolution 1 |
| `requires two tools for union/intersection, …` | 13 | nary 13 |
| `through hole must land in material` | 5 | general-trim 5 |

Sub-cause detail (`scripts/corpus/boolean-subcause.mjs`):

| sub-cause | detail | units | files | families |
|---|---|---:|---:|---:|
| coaxial-revolution | tube ∪ tube, shaft ∪ head (fs95 rings: 56); cylinder ∪ loft cone (countersinks: 26); stepped bushing bore (1) | 83 | 18 | 5 |
| general | revolution body − coaxial hex prism (screw sockets) | 18 | 17 | 3 |
| general | arc band (line/arc extrusion) − prism notch (channel bases) | 16 | 16 | 3 |
| general | box ∪ cylinder with coplanar ends and tangent faces (stadium ends, rounded corners) | 6 | 6 | 3 |
| pierce-admission | oblique caps: the cap sine is 1.07e-7 to 5.43e-7, not below 1e-7 (hopper panels) | 13 | 13 | 3 |
| pierce-admission | arc edges (plus more perpendicular faces) | 8 | 8 | 2 |
| pierce-admission | extra perpendicular faces (the tool passes a flange; the body has a third face normal to the axis) | 4 | 2 | 2 |
| pierce-admission | ranged line edges from a planar union, plus coplanar cap fragments (6 to 10 perpendicular faces) | 3 | 3 | 2 |
| nary | `unite(context, id, [a, b, c(, d)])`: 3 or 4 tools | 13 | 13 | 4 |
| general-trim | r = 120 to 122.5 mm cylinder about the machine axis trims a spoke or bracket (vertices inside the tool, or the axis misses the face) | 10 | 10 | 2 |

Rules: two operands that are solids of revolution about one axis line are
`coaxial-revolution`. A cylinder tool is `general-trim` when a target vertex
lies inside it or the kernel reports that the axis misses the face. Otherwise
it is `pierce-admission`. Everything else is `general`.

The four examples of the cluster signature:

| example | sub-cause | real geometry through the route |
|---|---|---|
| `r21-expanded-hopper.fs` (213 calls) | pierce-admission, oblique caps: axis (0, 0.866, −0.5), one cap within the sine limit, the other not | the hole is cut; next: `Plane frame is not orthonormal` in `opExtrude` (F32 cap normal) |
| `direct-mount-r26.fs` (`mountingHardware26 > cut`) | general: revolution − hex prism | **builds**: 8 bodies, 64 faces, OCCT-valid STEP |
| `top-structure-r1.fs#diagonalU2` | pierce-admission, extra perpendicular faces at z = 570, 716, 726 (tool 715 to 733) | the hole is cut; next: `opTransform` |
| `sc15_adapter.fs` (`plate > rrect > join > combine`) | general: planar ∪ cylinder | the route refuses at tessellation: a cylinder face with two loops |

**Is it the file's first blocker?** Each unit (one exported feature) has one
first blocker, and for all 174 units it is this cluster. Per file
(`files.json`):

- **sole** (36 files): every failing unit is in this cluster. This covers:
  - the whole hopper line (fs421, fs269, fs244; 13 files);
  - the channel bases (fs398, fs550, fs386; 15 files);
  - the planar guides (fs425, 3);
  - `housing-r27.fs`, `direct-mount-r26.fs`, `top-m5x25-reference-r30.fs`,
    `dual-hardware-r25.fs` and `sc15_adapter.fs`.
- **primary** (14 files): most failing units are here:
  - 7 fs95 interface files;
  - `upper-drive-r3.fs`;
  - 5 fs422 integration files;
  - `native-all-r2/r3.fs`.
- **minor** (15 files): other clusters block more units, mostly module imports
  in fs95. Examples: `bottom-drive-review-2026-09-19/*/native-source.fs`,
  `module-r4-upload.fs`, `top-structure-r1.fs`, `central-drive-r27/r28.fs`.

Sole plus primary is the run's partition: 50 files, 15 families.

## 2. Minimal repros

All in `fixtures/corpus-repro/boolean-capability/`, independent of
`~/Workspace/cad`, checked with
`node bin/wonky.mjs <file> --check --feature <f>` (0 to 4 s each). Each
reproduces its corpus message exactly. Re-checked at 04:13 on the unchanged
production code, with the same result. The full table with observed output is
in the [README](../../fixtures/corpus-repro/boolean-capability/README.md).

| file `#feature` | reduced from | sub-cause |
|---|---|---|
| `coaxial-revolution.fs#ringUnion` | `machine-interface-r8/interface-r8.fs#bottomCarrier` (floor ring ∪ wall ring, numbers unchanged) | coaxial-revolution |
| `coaxial-revolution.fs#countersunkHead` | `interface-r8.fs#fastenersR7` (M4 shank ∪ loft cone) | coaxial-revolution |
| `through-hole-admission.fs#obliqueHole` | `archive-r8/hopper.fs#hybridHopper` (panel0 + hole ph0_0, numbers unchanged) | pierce-admission, oblique caps |
| `through-hole-admission.fs#steppedHole` | `top-structure-r1.fs#diagonalU2` pattern (hole through a flange of an L prism) | pierce-admission, extra faces |
| `through-hole-admission.fs#arcPlateHole` | `r22/r23/r24-planar-guides.fs` (hole in a line/arc extrusion) | pierce-admission, arc edges |
| `through-hole-admission.fs#unitedPlateHole` | `module-r4-upload.fs#switchPinCapR4` pattern (hole in a planar union) | pierce-admission, ranged lines |
| `general-trimmed-face.fs#socketHex` | `interface-r8.fs#fasteners` (M3 screw − hex socket) | general |
| `general-trimmed-face.fs#bandNotch` | `c-channel-bases-arcs-r6/channel-bases-arcs-r6.fs` (arc band − notch) | general |
| `general-trimmed-face.fs#bossUnion` | `belt-central-r27/housing-r27.fs` (housing box ∪ round end) | general |
| `general-trimmed-face.fs#ringBoss` | `interface-r8.fs#cableTray` (wall ring ∪ screw boss) | general (next blocker of 28 units) |
| `general-trimmed-face.fs#spokeTrim` | `interface-r10.fs#bottomSpoke` (spoke − r 122.2 limit cylinder) | general-trim |
| `nary-union.fs#threeToolUnion` | `interface-r6.fs#motorBracket` (`cheekJoin`, three tools) | nary |
| `nary-union.fs#bridgedThreeToolUnion` | fs95 `motorBracket` `join`: the first two tools are disjoint, the third connects them | nary (decomposition order) |

## 3. Root cause

### The dispatcher (`src/boolean.mjs` `booleanInBend`)

Each arm admits a pair by its operands' surface and curve families. Nothing
else can reach the kernel:

| line | arm | admits | kernel |
|---|---|---|---|
| 38–39, 140 | coaxial | both operands are cylinder *primitives* (`body.primitive.type === 'frustum'`, `r0 === r1`) | `kernel/boolean.bend` `coaxial` |
| 41 | planar arrangement | union/subtraction, all faces planes and all edges lines | `planarBoolean` |
| 59 | planar intersection | both planar, zero construction budget | `halfspace` / `solidIntersection` |
| 79 | curved intersection | INTERSECTION only, faces plane/cylinder, edges line/circle/ellipse | `curvedIntersection` (convex tool) |
| 107–109 | through hole | SUBTRACTION, target faces plane/cylinder, edges line/circle **without curveRange**, tool a cylinder primitive | `kernel/pierce.bend` `pierce` |
| 137 | – | everything else | refusal: "general trimmed-face booleans are not implemented" |

Each sub-cause is one of these gaps:

- **coaxial-revolution.** The coaxial kernel works on a grid of radial/axial
  cells, but its input is one `[z0, z1] × [0, r]` rectangle per operand. A
  ring is a coaxial Boolean result. It has no `primitive`, so neither operand
  of a ring union is admitted, and every other arm needs planes only or
  refuses unions. The cone of a countersink comes from `opLoft` as a frustum
  primitive with `r0 ≠ r1`, which the gate rejects too.
- **general / general-trim.** No arm computes a trimmed plane/cylinder
  Boolean for union or subtraction. The curved arm exists only for
  intersections with a convex tool.
- **nary.** `src/library.mjs:254` accepts exactly two tools
  (union/intersection) or one target and one tool (subtraction). Onshape's
  `opBoolean` takes any number, and the corpus's `unite(..., [a, b, c])`
  helpers pass 3 or 4.

### The hole admission (`kernel/pierce.bend`, `src/boolean.mjs`)

- **`decline()` (line 334) counts every face perpendicular to the axis**
  (`pierced_count`) and wants exactly 2 (code 2). It does not ask whether the
  tool's axis actually meets a face within the tool's own span:
  - A hole through the 10 mm flange of an L bracket sees a third
    perpendicular face at the far end of the long leg (`steppedHole`,
    `top-structure-r1.fs` diagonals: faces at z = 570, 716 and 726, tool from
    715 to 733).
  - A planar union's coplanar cap fragments give 6 to 10 perpendicular faces
    (`switchPinCapR4`: 5 at z = 79, 5 at z = 82).

  `faces_contain` and `spans` already exist. They are applied to all
  perpendicular faces instead of being used to *select* the two pierced ones.
- **Circles are full circles.** `edge_crosses` (line 276) and `edge_clears`
  (line 127) treat every `A.Circle` edge as a whole circle. That is right for
  earlier hole rims and wrong for an arc. The kernel solid carries no curve
  domains (they travel separately as `domains`), and `pierce` gets only
  `first.solid`. So `src/boolean.mjs:108` keeps every ranged edge out: arcs
  of rounded plates (`arcPlateHole`) and the ranged line edges the planar
  arrangement emits (`unitedPlateHole`). For a *line* the range carries no
  geometry, because `edge_crosses`/`edge_clears` read line edges through
  their two vertices, so the gate is stricter than the kernel needs. The
  refusal is correct for arcs, but it surfaces as the generic message, not as
  a hole refusal.
- **Perpendicular within sine 1e-7, while the caps are F32.** The `linear`
  tolerance `real(1e-7)` (`src/boolean.mjs:116`) is used both as a length and
  as the sine limit of `perpendicular()` (line 109). Planar prisms are built
  by `kernel/topology.bend` `extrude` over `kernel/geometry.bend`
  `Vec3{F32, F32, F32}`. For `hopper.fs` panel0:

  | | normal |
  |---|---|
  | source (the same vector as the hole axis) | (0.3780994811990447, −0.8017359831875825, 0.4628824857123603) |
  | cap, as built | (0.378099262714386, −0.8017358779907227, 0.46288275718688965) |

  The sine between them is 3e-7, and the vertices lie up to 2.0e-4 mm off
  their own cap planes (the body states `toleranceMm` 5.6e-4). The admission
  therefore refuses a hole whose axis *is* the plate normal. In
  `r21-expanded-hopper.fs` the two caps of one plate disagree with each other
  too: 5.7e-8 against 5.4e-7.

  `bore()` already builds the rims on the cap's own normal, for exactly this
  reason ("perpendicular() admits a small angle"). But it uses one normal for
  both caps, so non-parallel F32 caps would still leave one rim off its plane.
  This is the same F32-carrier issue that the neighbouring
  boolean-invalid-topology cluster reports for slanted planar faces.
- **The hole volume is read from the target, unchecked.**
  `src/boolean.mjs:126` computes the result volume as
  `pierced_volume(real(a.validation.volumeMm3), …)`. Every production decoder
  sets a volume, but `validateAnalytic` (`src/analytic.mjs:270`) returns
  `volumeMm3: null` by design ("Never report an invented volume"), and
  `real(null)` throws `RangeError: Bend Real serialization requires a finite
  magnitude <= 1e20 without F32 exponent underflow` (`src/real.mjs:5`). A
  body without a certified volume therefore fails in the pierce arm with a
  serialization error instead of a capability refusal. Recovered bodies are
  such bodies, and so are imported analytic snapshots, which
  `src/queries.mjs:105` already treats as volume-less. This hits 2 units in
  the hybrid pass and 12 in the F32x2 pass (section 5).

### What the kernel already has

- **Arcs and ellipses.** `A.Ellipse` curves and ellipse-bounded cylinder
  faces exist, and the curved intersection arm and STEP pcurves handle them.
  `src/print-mesh.mjs` meshes analytic bodies only through full circles, and
  has no ellipse.
- **Revolve.** `kernel/revolve.bend` (`revolveInBend`) exists, but no
  production path calls it.
- **F32x2 prisms.** `kernel/sketch-arcs.bend` already extrudes line/arc
  profiles in F32x2. The neighbouring cluster's fix routes polygon prisms
  through it. All its edges carry `curveRange` (checked on `steppedHole`: 18
  of 18 line edges).

## 4. Fix design

### F1. N-ary `opBoolean` (frontend, `src/library.mjs`) — S, low risk

Decompose into binary `booleanInBend` calls with Onshape semantics:

- **UNION:** the result is the connected components of all tools and
  targets. A pairwise left fold that continues with its first result body is
  **wrong**. When the first two tools are disjoint and a later one connects
  them (fs95 `motorBracket` `join`: two cheeks that meet only through the
  web), it returns two bodies, and the model's own `Expected one connected
  solid` check fails (2 units on real geometry). Keep a list of components,
  and unite every later body with each component. A binary union that
  returns two bodies means "not touching": keep that component as it is.
  Repro: `nary-union.fs#bridgedThreeToolUnion`.
- **SUBTRACTION:** every tool leaves every target, and tools are deleted
  unless `keepTools`.
- **INTERSECTION:** a left fold.

Keep the record and lineage bookkeeping of the binary path: the record that
comes first in source order keeps its identity. The test-only version is in
`scripts/corpus/boolean-hook-loader.mjs` (component-aware since 04:25). It
builds both N-ary repros as one body of 15000 mm³ (closed form: 6000 + 2 ×
4500). The 13 corpus units then stop at the planar arrangement's
InvalidTopology (11), UnsupportedArrangement (1) and one coaxial union.

- **Risk:** the decomposition order decides which intermediate bodies the
  planar arrangement sees, and a disjoint set costs up to n² binary calls
  (n ≤ 4 in the corpus). Keep the source order, and state the decomposition
  in the operation evidence.
- **Effort:** one day with tests.

### F2. The general arm: the bake-off hybrid in production — XL, medium-high risk

Where:

- a new last arm of `booleanInBend`, before the refusal on line 137;
- `kernel/proto/{corefine,recover}` promoted into `kernel/`, as the bake-off
  decides.

What, as run in section 6:

1. Tessellate both operands with face tags at a stated deviation.
2. Run corefine (tagged mesh Boolean, Bend).
3. Run recover (exact B-rep from tags, Bend).
4. `decodeRecover` → `validateAnalytic`.

A recover refusal becomes the operation's explicit refusal with recover's
reason, never a mesh result. Prerequisites this cluster surfaced, with the
units each one stops in the `hybrid` pass (47 route refusals, plus 2
hand-over failures):

| prerequisite | units | where |
|---|---:|---|
| **Parallel-axis cylinder/cylinder → lines.** Recover's curve table treats every non-coaxial cylinder pair as a space quartic ("non-coaxial quadric pairs" are refused by design, `docs/proto-recover.md`). Parallel axes intersect in 0, 1 or 2 generator lines, so this is exact and cheap. | 14 (the fs95 screw bosses on ring walls) | recover |
| **Plane tangent to a cylinder at a corner** (stadium ends, rounded corners). Recover finds no corner where the tangent plane, the cylinder and the end plane meet, walks the half circle as a closed run, and refuses (`mesh boundary does not traverse its exact curve once`). | 10 (fs276 housings, fs398 channel bases) | recover |
| **F32 carriers.** Concurrency residuals of 2.7e-7 mm and vertices 3.6e-6 mm off their exact curves. Also the `obliqueHole` rims (circles on the F64 axis, 5e-7 mm off the F32 caps), which the kernel's STEP pcurve export refuses (`InvalidSource`), as it does for 2 of the 6 built units. See F4. | 9 | recover, STEP |
| **A tagged tessellator for every kernel body.** `brep-tessellate` refuses a cylinder face with two loops (7) and bodies with cone faces; the print-mesh fallback then gives an open mesh (5). In the one two-loop case I dumped (`variant-r5.fs`), the operand is itself a recovered body: an F32 prism cap at z = −6.800329208 and an F64 cylinder cap at z = −6.800329000 left a 2.1e-7 mm sliver. On F32x2 prisms `brep-tessellate` fails with `collinear repair diverged` (15 units in the F32x2 pass). | 12 | tessellation |
| **corefine face triangulation** (`no valid ear or hole bridge`) | 2 (hopper trims) | corefine |
| **A volume for recovered bodies**, or a pierce arm that refuses without one (section 3). | 2 (12 with F32x2) | hand-over |
| **Speed on the JS target.** The splice ran native CPU builds: median 235 ms, maximum 1.1 s per Boolean. Corefine's warm JS compute on the bake-off cases is 18 ms to 13 s per Boolean (plate with a hole: 254 ms; hex nut: 827 ms). The fs95 features run 20 to 50 Booleans each. | – | runtime |
| **Identity.** Recover's face tags give provenance per face. They must be mapped into `identifyBoolean` so that later queries survive. | – | frontend |

Effort: weeks. It is the bake-off's roadmap, so this cluster adds
requirements, not a parallel implementation.

### F3. Exact fast arms (complement to F2)

**Coaxial meridian arrangement** (`kernel/boolean.bend`, `src/boolean.mjs`) —
M (2 to 3 days), low-medium risk.

- **Admission:** both operands are solids of revolution about one axis line.
  Planes must be perpendicular and cylinders/cones on the axis, within the
  kernel's axis tolerance. This is geometric, not `body.primitive`, so rings
  and earlier coaxial results qualify.
- **Kernel:**
  1. Generalize the cell grid from one rectangle per operand to each
     operand's meridian region: z-slabs whose radial bounds are linear in z,
     so cones give trapezoids.
  2. Split slabs where a cone bound crosses another bound.
  3. Classify, merge, and revolve the boundary into planes, cylinders and
     cones with shared circles, as the arm does today.
- **Scope:** 83 units as first blocker (ring unions, countersinks, the
  bushing bore). The route recovered all 128 coaxial Booleans it was given,
  but this arm needs no tessellation. Most units then need F2 (hex sockets,
  bosses).
- **Risk:** tangent cone/cylinder at a shared circle (the countersink starts
  exactly at the shank radius). Refuse ties below the kernel's minimum
  interval, as `coaxial` does.

**Pierce v2** (`kernel/pierce.bend`, `src/boolean.mjs`) — M (2 to 4 days),
medium risk.

0. **Gate fixes, now** (S, `src/boolean.mjs:108` and `:126`): refuse
   `curveRange` only on circle edges, not on lines; and refuse explicitly
   when the target has no certified volume, instead of passing `null` to
   `real()`. F4 needs both.
1. **Select the pierced faces.** Use the planar faces the axis punctures
   *inside the face*, within the tool's span (`faces_contain`, `spans`). Do
   not count every perpendicular face. Keep "exactly one entry and one exit,
   facing opposite ways". Check that no other face comes within the radius of
   the axis segment between them, which the old count implied for prisms.
2. **Arcs.** Pass `domains` to the kernel. Make `edge_crosses`/`edge_clears`
   arc-aware (ray/arc crossing within the angular range, point-to-arc
   distance). Keep the ranges on the output (`decodeAnalytic(…, ranges)`).
3. **Oblique caps.** Either:
   - admit an angle whose worst rim displacement, sin θ · max(depth, r), is
     within the target's stated source budget, and build each rim on its own
     cap; or
   - build exact ellipse rims along the tool axis.

   The second is exact for any tilt, including the bake-off's
   `tilted-holes-17deg`, but `src/print-mesh.mjs` has no ellipse rim yet, so
   the part would stop at print export. With F4 the caps are exact, and this
   step shrinks to the admission.

Scope: 28 units, including all 13 hopper files. The route recovered 391 of
the 394 pierce-admission Booleans it was given. The hoppers then stop at
"Plane frame is not orthonormal" (5), `skText` (4), corefine triangulation
(2), `opLoft` (1) or "face vertices do not lie on the analytic plane" (1)
(section 5).

### F4. F32 planar carriers — shared with boolean-invalid-topology — M, medium risk

The planar prisms' F32 normals and vertices cause the tilted-cap refusals
here, 9 of the route's refusals, the dumped two-loop sliver, both STEP export
refusals, the slanted-face InvalidTopology there, and the "Plane frame is not
orthonormal" / "face vertices do not lie on the analytic plane" next blockers
of the hoppers (kernel-sketch-and-ops cluster). The neighbouring analysis
proposes building polygon prisms in F32x2 through `kernel/sketch-arcs.bend`
(M, about 3 days). I simulated that on this cluster
(`WONKY_CORPUS_SIMULATE=linearc`, with the route for every Boolean refusal):

- **Gone:** the F32 residual refusals (9 → 0), the F32 cap-normal next
  blockers (6 → 0), and both STEP export refusals: all 6 built units export
  STEP that OCCT reports valid, with unchanged volumes for the 4 that
  exported before.
- **No unit advances.** The same 6 units build. 74 units stop at
  `opTransform`.
- **New, and to be fixed together with F4:**
  - Every F32x2 prism edge carries `curveRange`, so the pierce gate refuses
    every hole in such a plate, with the general message (checked on
    `obliqueHole`, `steppedHole`, `unitedPlateHole`). Without pierce v2 step
    0, **F4 turns every through hole that builds today into a refusal**,
    including the plates of `test/pierce.test.mjs` (`skRectangle`,
    `skPolyline`).
  - 12 units then reach the pierce arm with a recovered target and hit the
    null-volume `RangeError` (pierce v2 step 0).
  - `brep-tessellate` refuses the F32x2 prisms of 15 units with `collinear
    repair diverged`: the 11 channel-base units whose route refusals were F32
    residuals (6) or two-loop slivers (5), and the 4 fs276 housings (tangent
    corners before). An F2 prerequisite.
  - The F32x2 extrude itself throws the serialization guard on 4 far, tilted
    hopper panels (`archive-r17`, `hopper_r19`, `r21-expanded-hopper`,
    `r21-hopper-current`: `opExtrude` in `prism`), so some value there falls
    below the F32 normal range. The F32x2 frame needs to flush it to zero.

Coordinate with that cluster's analysis rather than fixing it twice.

## 5. What each file hits next

### Fix ladder on stubbed geometry

Each step re-runs all 174 units with the refusals of that step stubbed in
memory (`scripts/corpus/boolean-hook-loader.mjs`). A stubbed union returns the
first operand, a stubbed subtraction the target unchanged. That geometry is
wrong by construction, and a later blocker can differ on the real geometry.
The steps are cumulative. The N-ary fold is included from step 1.

| next blocker | after nary | + coaxial | + pierce v2 | + all of this cluster (general) | + every Boolean refusal |
|---|---:|---:|---:|---:|---:|
| this cluster: coaxial-revolution | 84 | – | – | – | – |
| this cluster: general | 40 | 94 | 97 | – | – |
| this cluster: pierce-admission | 28 | 30 | – | – | – |
| this cluster: general-trim | 10 | 24 | 26 | – | – |
| planar arrangement InvalidTopology / UnsupportedArrangement | 12 | 12 | 16 | 25 | – |
| `opTransform` | – | 14 | 21 | 87 | 93 |
| `opLoft` profiles | – | – | 2 | 26 | 26 |
| `skText` | – | – | – | 15 | 29 |
| Plane frame is not orthonormal | – | – | 5 | 5 | 9 |
| `min`, `qContainsPoint`, module import, face vertices off plane, body limit | – | – | 6 | 8 | 9 |
| **reaches the end** (units / files) | 0 | 0 | 1 / 1 | 8 / 7 | 8 / 7 |

These passes used the first, left-fold N-ary decomposition. For 12 of the 13
N-ary units the first binary call fails, and it is the same call in both
decompositions, so the ladder is unaffected.

### On real geometry (the bake-off route)

Not cumulative. `hybrid`: this cluster's refusals go through the route.
`hybrid-all`: every `booleanInBend` refusal does (also the planar
arrangement's). `+ F32x2`: the same, with every polygon prism built in F32x2.

| next blocker | hybrid | hybrid-all | hybrid-all + F32x2 |
|---|---:|---:|---:|
| **reaches the end** (units / files / families) | **6 / 5 / 4** | **6 / 5 / 4** | **6 / 5 / 4** |
| `opTransform` | 70 | 76 | 74 |
| `skText` | 18 | 19 | 14 |
| `opLoft` profiles | 9 | 9 | 8 |
| `min` | 4 | 4 | 4 |
| F32 cap normal in `opExtrude` (plane frame / face vertices) | 6 | 6 | – |
| planar arrangement InvalidTopology (not routed) | 12 | – | – |
| route: parallel cylinder/cylinder ("space quartic") | 14 | 14 | 14 |
| route: tangent plane/cylinder corner | 10 | 10 | 6 |
| route: F32 residuals (carriers not concurrent, vertex off curve) | 9 | 9 | – |
| route: triangles not clearly oriented against their carrier | – | 5 | 2 |
| route: tessellation (two-loop cylinder face, open mesh, collinear repair, dropped vertex) | 12 | 12 | 25 |
| route: corefine face triangulation | 2 | 2 | 5 |
| hand-over: pierce arm reads the null volume of a recovered body | 2 | 2 | 12 |
| F32x2 simulation: serialization guard in `opExtrude` | – | – | 4 |

- The 6 units that reach the end are the fastener reference models of
  section 1. 2 of the stubbed ladder's 8 (`native-all-r2/r3.fs#channelHardware`)
  do not build on real geometry, because corefine gets an open tessellation of
  their countersunk (cone) operand.
- In the F32x2 column, 4 of the tangent-corner units (fs276) fail earlier, at
  tessellation. That is why the row drops from 10 to 6.
- In `hybrid-all` the motorBracket units first returned two bodies, with the
  left fold (section 4, F1). The table uses the component-aware
  decomposition.

### Per family (from `files.json`)

- **The whole file reaches its end** only for:
  - `belt-return-r25/dual-hardware-r25.fs` (fs361: 16 coaxial unions and one
    bushing bore; already after pierce v2 on the stubbed ladder);
  - `belt-central-r26/direct-mount/direct-mount-r26.fs` (fs273: hex sockets);
  - `R30_TOP_Clearance_Prototype_v1/top-m5x25-reference-r30.fs` (fs365:
    countersunk M5 screw).

  All three are fastener reference models.
- **Channel bases** (fs398, fs550, fs386; 15 sole files): on stubbed
  geometry, next is `opLoft` in `roundBody` (two equal circles, the
  kernel-sketch-and-ops cluster). On real geometry the route refuses first:
  tangent corners (6), two-loop slivers (5), F32 concurrency residuals (4).
  The two `native-all` files add 2 concurrency residuals and 2 open
  tessellations.
- **Hoppers** (fs421, fs269, fs244; 13 sole files): the route cuts the holes
  (up to 39 routed Booleans per file). Next: "Plane frame is not orthonormal"
  (5), `skText` (4), corefine triangulation (2), `opLoft` (1), "face vertices
  do not lie on the analytic plane" (1).
- **Planar guides** (fs425): open tessellation of the arc plate on real
  geometry; `qContainsPoint` or a module import on stubbed geometry.
- **fs95 interface family** (14 files, 108 units): next is `opTransform`,
  then `skText`. The screw bosses (14 units) need parallel cylinder/cylinder
  in recover. Its module-import units were already blocked before this
  cluster.
- **fs422 integration** (5 files): `min`, `opLoft`, or the planar
  arrangement (recover: triangles not clearly oriented).
- **fs87/fs88 motor hangers**: `opTransform` or the null-volume hand-over.

## 6. Overlap with work in flight

### Bake-off (`kernel/proto/**`, `docs/bakeoff.md`, `docs/proto-*.md`)

**Repros through the route.** Command: `node scripts/corpus/boolean-bakeoff.mjs`.
Run at 00:48; recover and corefine have not changed since.

- The operands are the production operands, frozen by the probe as
  `wonky-acceptance-operands/1`.
- `countersunkHead` and `socketHex` are given as analytic CSG leaves instead:
  `brep-tessellate` has no cone faces and refuses the coaxial arm's split
  cylinder.
- For `obliqueHole`, the fixture check (1e-9 mm) was relaxed to record the
  measured 2.0e-4 mm off-plane distance.
- Native CPU builds of corefine and recover, 1 thread. OCCT through
  `uv run scripts/bakeoff/recover-step.py`.

| repro | corefine (ms, tris) | recover | OCCT | volume vs closed form |
|---|---|---|---|---|
| ringUnion | 368, 5120 | 6 faces (3 planes, 3 cylinders), 45 ms | valid | 4.5e-16 |
| countersunkHead | 24, 480 | 4 faces (incl. cone) | valid | 7.4e-16 |
| steppedHole | 11, 260 | 9 faces | valid | 0 |
| arcPlateHole | 15, 444 | 11 faces | valid | 4.9e-16 |
| unitedPlateHole | 20, 296 | 11 faces | valid | 0 |
| socketHex | 28, 510 | 12 faces | valid | 0 |
| bandNotch | 42, 606 | 14 faces | valid | −2.4e-14 |
| spokeTrim | 24, 128 | 6 faces | valid | −9.3e-16 (against the as-built F32 box) |
| obliqueHole | 18, 244 | 6 faces, rims as circles | – | export: `STEP cylindrical parameter curves unresolved: InvalidSource` |
| bossUnion | 27, 370 | unresolved: `mesh boundary does not traverse its exact curve once (sweep -0.0098, expected 6.283)` | – | – |
| ringBoss | 139, 2234 | unresolved: `cylinder/cylinder intersection off a common axis is a space quartic` | – | – |

**Whole corpus units with the route spliced in (test only).** In the hook's
`hybrid` modes (`scripts/corpus/boolean-hybrid.mjs`), each refused binary
Boolean goes through the pipeline of F2: tagged tessellation
(`brep-tessellate`, falling back to the production print mesh with face
tags, deviation 0.01 mm), corefine, recover (native CPU builds, 1 thread),
`decodeRecover`, and the kernel's `validateAnalytic`. The recovered bodies
replace the refusal, so each unit runs as far as the route would take it. A
route refusal is re-thrown as the production message plus the stage and
reason.

| pass | Booleans routed | recovered | refused | ms per Boolean (median / p90 / max) |
|---|---:|---:|---:|---|
| hybrid (this cluster's refusals) | 769 in 162 units | 722 (93.9 %) | 47 | 235 / 614 / 1097 |
| hybrid-all (every refusal) | 817 in 174 units | 765 (93.6 %) | 52 | 237 / 934 / 2025 |
| hybrid-all + F32x2 prisms | 637 in 174 units | 585 (91.8 %) | 52 | 340 / 661 / 1181 |

Per sub-cause in the `hybrid` pass: coaxial-revolution 128 of 128 recovered,
pierce-admission 391 of 394, general-trim 22 of 22, general 181 of 225. The
refusals and the next blockers are the tables of sections 4 and 5. The
timings are whole native processes on a loaded machine.

The end units' STEP files, checked with `uv run scripts/validate-step.py`
(`tmp/corpus/boolean-capability/recheck/*-step-validate.json`):

| unit | solids | faces | OCCT (hybrid) | OCCT (+ F32x2) | volume (mm³) |
|---|---:|---:|---|---|---:|
| `upper-drive-r3.fs#footBolt` | 1 | 12 | valid | valid | 1027.93 |
| `upper-drive-r3.fs#retentionBolt` | 1 | 12 | valid | valid | 733.40 |
| `direct-mount-r26.fs` | 8 | 64 | valid | valid | 1020.37 |
| `top-m5x25-reference-r30.fs` | 1 | 11 | valid | valid | 580.63 |
| `mounting-r26.fs#mountingHardware26` | 8 | 58 | export refused (`InvalidSource`) | valid | 703.13 |
| `dual-hardware-r25.fs` | 37 | 223 | export refused (`InvalidSource`) | valid | 6273.66 |

There is no reference volume for these parts: the corpus has no Onshape
export for them, and the recovered bodies carry no kernel volume.

**Verdict.** The route is the right fix for this cluster's general part. It
already handles 94 % of the refused Booleans exactly, and every built unit
that exports STEP is OCCT-valid. It is not in production, and its gaps are
real FDM cases with names: parallel-axis bosses, stadium ends, F32 operands
and the tessellation of kernel bodies. The coaxial and pierce arms are not
superseded: they are exact, need no tessellation and cost milliseconds on the
JS target, where the hybrid costs a mesh Boolean per call.

### Native binding (`src/native/**`, `docs/native-bridge*`)

`WONKY_BACKEND=native` runs today's planar entries with bit-identical
results. Its plan adds coaxial/pierce later ("exakte Pierce/Coaxial-Ketten")
and keeps CURVED natively refused. It changes speed, not which Booleans are
admitted, so it neither fixes nor changes this cluster.

If F2 or F3 adds a kernel method, the native façade
`kernel.boolean({ method: PLANAR|CONVEX|CURVED|PIERCE|COAXIAL })` needs the
new method as well. F4 changes the same planar seam the native slice covers.

### Viewer and language

Not involved. The failures are raised in `booleanInBend` and `opBoolean`
before any geometry reaches a viewer. The language work (`kernel/lang`,
`docs/language*`) does not model `opBoolean` arity.

## 7. Limitations

- **Stubbed geometry.** Ladder steps after the first stubbed Boolean run on
  wrong geometry (section 5). "Reaches the end" there means the model's code
  ran to completion. It does not claim a correct part. The hybrid passes are
  the real-geometry check.
- **Heuristic sub-cause rules.** The rules in section 1 are heuristic, and the
  classifier is diagnostic. The two borderline cases were read by hand:
  - `upper-drive-r3.fs#motorBracket` is a trim, not a hole;
  - `dual-hardware-r25.fs` is coaxial, although its first message is a hole
    refusal.
- **The hybrid splice is not the bake-off's own measurement.**
  - It tessellates with `brep-tessellate`, falling back to the production
    print mesh.
  - It does not reproduce the bake-off's timings or validator scoring.
  - Built units are checked by `validateAnalytic` and OCCT validity, not
    against a reference volume.
- **N-ary fold.** The first session used a left fold. I replaced it with the
  component-aware decomposition of F1 and re-ran the 14 affected units in both
  hybrid passes (`scripts/corpus/boolean-merge.mjs`, records marked
  `rerunOf`). The stubbed ladder was not re-run (section 5).
- **F32x2 simulation.** `WONKY_CORPUS_SIMULATE=linearc` is the neighbouring
  cluster's diagnosis build (polygon prisms through the existing line/arc
  extruder), not their final fix. Rigid copies (`opPattern`) stay F32.
- **Two-loop slivers.** I dumped one of the 7 (`variant-r5.fs`). The F32
  attribution of the others is by analogy, not measured. With F32x2 prisms,
  `interface-r3.fs#cableDrum` still shows a two-loop cylinder face, and the 3
  `bottomSpoke` units (vertex off curve before) now show one. So not every
  two-loop face is a prism effect; rigid copies stay F32 in the simulation.
- **Closed forms.** The repro volumes are closed forms written for this
  analysis. For the F32 cases they are computed from the as-built operand
  coordinates (`asBuilt` in `boolean-bakeoff.mjs`).
- **The null-volume hand-over** was traced by reading the code and the
  failing operation (a `cut` right after a routed Boolean), not by
  instrumenting `real()`.

## 8. Reproduce

```sh
node scripts/corpus/boolean-batch.mjs                       # probe.jsonl: operands + sub-cause per unit (3 processes)
node scripts/corpus/boolean-batch.mjs --stub nary           # fix ladder, one file per step
node scripts/corpus/boolean-batch.mjs --stub pass:coaxial-revolution
node scripts/corpus/boolean-batch.mjs --stub pass:coaxial-revolution,pierce-admission
node scripts/corpus/boolean-batch.mjs --stub pass
node scripts/corpus/boolean-batch.mjs --stub pass-all
node scripts/corpus/boolean-batch.mjs --stub hybrid --timeout-s 360 --step-dir tmp/corpus/boolean-capability/hybrid-step
node scripts/corpus/boolean-batch.mjs --stub hybrid-all --timeout-s 360 --step-dir tmp/corpus/boolean-capability/hybrid-all-step
WONKY_CORPUS_SIMULATE=linearc node scripts/corpus/boolean-batch.mjs --stub hybrid-all --timeout-s 360 \
  --out out/corpus/boolean-capability/probe-hybrid-all-linearc.jsonl --step-dir tmp/corpus/boolean-capability/hybrid-all-linearc-step
node scripts/corpus/boolean-batch.mjs --stub hybrid --only '#motorBracket' --out part.jsonl   # partial re-run ...
node scripts/corpus/boolean-merge.mjs out/corpus/boolean-capability/probe-hybrid.jsonl part.jsonl   # ... merged by key
node scripts/corpus/boolean-files.mjs                       # files.json + the tables above
node scripts/corpus/boolean-bakeoff.mjs                     # repros through corefine + recover (bakeoff.json)
node scripts/corpus/boolean-probe.mjs <file.fs> [feature] [--dump operands.json.gz]   # one unit
uv run scripts/validate-step.py tmp/corpus/boolean-capability/hybrid-step/<prefix> ...   # OCCT check of built units
```
