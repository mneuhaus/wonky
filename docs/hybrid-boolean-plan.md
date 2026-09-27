# Hybrid Boolean: design and integration plan

Status: 23 September 2026, judge round 2. This is the judge's decision after
the Boolean bake-off. The evidence is in `docs/bakeoff.md`, section "Results",
and its raw reports are under `out/bakeoff/judge2/`. Every prototype ran
unchanged on the 38-case corpus and on all 216 adversarial cases of the four
verifiers, on JS, native CPU at 1 and 18 threads, and Metal.

Nothing here is implemented in production yet. Each statement is marked as
**measured** (a judge report shows it) or **conjecture** (a design
expectation that still needs its acceptance test).

## 1. Decision

The production Boolean becomes a two-stage hybrid:

1. **corefine decides the topology.** corefine is a tagged mesh Boolean in
   Bend: a port of Manifold's Boolean3 with shared symbolic-perturbation
   decisions over F32x2 Reals. It runs on tagged tessellations of the exact
   operands, and every output triangle keeps the tag of the analytic face it
   came from.
2. **recover rebuilds the exact B-rep.** recover takes corefine's tagged
   result and computes every curve and vertex exactly from the carrier
   surfaces of the tags. It certifies the result against the mesh. If it
   cannot, it refuses with a named reason.

The other outcomes and engines:

- **Recovery Unresolved.** If recovery is Unresolved (a curve type is
  missing), the result is a **certified-deviation mesh body**. It is labelled
  as an approximation with its deviation and can be exported as STL/3MF. STEP
  export refuses it and gives the reason. It is never passed off as an exact
  B-rep, and it is only produced when the pre-certificate of section 2.3
  holds.
- **exact-plane** becomes the independent second topology oracle for
  differential testing (CI and an opt-in "paranoid" mode). It is not on the
  default path.
- **sdf** does not produce Boolean results. Its field and tape machinery is
  reused for FDM analyses (wall-thickness estimates, offsets, clearance
  shells), each labelled as an approximation.
- **Execution.** Production runs on the **CPU pool** (`--gpu off`). Metal is
  off by default (section 6).

**Gate.** The hybrid does not go into the production dispatch until steps 1
and 2 of section 8 remove the wrong `ok` answers the verifiers and the judge
found (section 7). On the corpus the hybrid is already correct. Under
adversarial input it is not yet safe.

### Why corefine and not the others (measured, judge round 2)

| | corefine | exact-plane | sdf |
|---|---|---|---|
| corpus (38) | 36 pass + 2 expected refusals | 36 + 2 | 35 + 2; r10b refused (no CSG form for `brep` leaves) |
| accuracy vs manifold3d on the same leaves | all "exact" tier, max 3.6e-14 | all "exact", max 5.5e-9 (input quantization) | chordal approximation; 11 of 35 in the exact tier (planar cases), max 3.5e-3; OCCT bound only |
| all 4 targets byte-identical | 38/38 corpus, 216/216 adversarial | 38/38, 216/216 | 38/38, 216/216 where all ran |
| adversarial (216): good / refused / **wrong `ok`** / error | 181 / 17 / **18** / 0 | 170 / 20 / **26** / 0 | 128 / 35 / **47** / 3 |
| of the wrong ones: oracles disagree below 1e-7 mm | 2 | 5 | 4 |
| common-set compute, 35 cases, sum ms js / cpu1 / cpu18 / metal | **30,974 / 6,157 / 4,187 / 6,596** | 114,400 / 34,389 / 10,593 / 25,154 | 178,224 / 33,077 / 7,505 / 97,306 (4 Metal OOM) |
| cpu1/cpu18 geo-mean over cases >= 20 ms | 1.46 | 3.30 | 3.57 |
| output feeds recover: exact STEP on the corpus | yes, 32/38 | yes, 32/38 | no (a new vertex set with no tag pairs) |

Why corefine, even though it scales worst:

- It is the fastest at 1 thread, at 18 threads and on the JS target, by
  5.6x at 1 thread, 2.5x at 18 threads and 3.7x on JS over exact-plane (measured, common set).
- Its tags are exact provenance. Every output face lies inside one input
  triangle, and every new edge comes from one (P face, Q face) pair.
- It has the fewest wrong answers under the 216 adversarial cases, and every
  one of them is of a kind a local check can catch: point contact (10), a
  1e-10 mm self-intersection on rotated coplanar faces (4), a grazing tool
  below the deviation (2), and 2 cases where the oracles disagree
  (section 7).
- It moves no vertex. The one topological tolerance is a documented
  2^-36·scale short-edge collapse.

Why not the others:

- **exact-plane** is exact after one input quantization to a 2^-24 mm grid.
  That quantization changes topology below the grid: it seals rotated
  coplanar pockets, closes 1e-9 mm gaps into point contacts, and misses
  sub-micron skins by up to 19 % (all measured, section 7). It is
  2.5x (18 threads) to 5.6x (1 thread) slower than corefine. Its value is an independent code base with
  independent predicates, which is exactly what a differential oracle needs.
- **sdf** answers `ok` with wrong geometry for features thinner than its grid
  cell. In the judge run it lost a 1.2 mm enclosure wall and a 3 mm base plate
  and closed a 0.4 mm slot and a 0.5 mm clearance. It returned two 5 mm cubes
  500 mm apart as empty. FDM parts are full of such features, so it cannot
  produce results. It also has the most wrong answers (47/216) and is
  30.9x (geo-mean, range 5.1-69.1x) slower on Metal than on 18 cores.

## 2. Pipeline

```
FeatureScript opBoolean(targets, tools, op)
  │  src/boolean.mjs dispatch: existing exact special cases first (coaxial,
  │  planar arrangement, convex intersection, pierce), then the hybrid
  ▼
[A] CSG layer (Bend)            flatten unions, subtract spine A − ∪B, drop box-disjoint
  │                               tools, concatenate box-disjoint operands   (corefine csg)
[B] tagged tessellation         printMesh(body, dev, {tags:true}); face table = the bodies'
  │   (Bend samples, JS I/O)      exact carriers (plane/cylinder/cone/sphere/torus); leaves
  │                               are `brep` leaves; one deviation per operation
[C] pre-certificates (Bend)     every carrier pair from different leaves: near-tangent,
  │                               near-coincident or grazing within h + h' → refuse early
  │                               (tangent.bend generalised, step 2)
[D] topology oracle (Bend)      corefine tagged Boolean → closed, oriented, 2-manifold
  │                               mesh; NEW: vertex-link check + exact self-intersection
  │                               check refuse instead of returning ok (step 1)
[E] exact recovery (Bend)       recover: carrier classes → patches → corners (Newton)
  │                               → exact curves per tag pair → faces → shells;
  │                               certificates: boundary deviation, clearance, nesting,
  │                               NEW: no area-changing sliver absorption, own contact check
  ▼
 Exact{bodies}              → decodeAnalytic bodies, identity (tags → source faces),
                              STEP / STL / queries as today
 CertifiedMesh{mesh, dev,   → mesh body, labelled approximation; STL/3MF only;
   reason}                     STEP and exact-edge queries raise a capability error
 Unresolved{reason}         → UnsupportedFeatureError (as today)
```

The contract is the bake-off wire format (`docs/bakeoff.md`, "Job and result
format"). It already carries everything the stages need:

- the CSG tree;
- the face table with exact carriers (`tag` = row);
- tagged leaf meshes in world coordinates;
- the tagged result;
- the recover B-rep text (`kernel/proto/recover/main.bend` header).

It is canonical text. That makes the JS and native targets byte-comparable.
It is how the judge run showed that all four targets agree for corefine and
recover: 38/38 on the corpus and 216/216 adversarial cases for corefine, and
every recover run on all four targets (measured).

### 2.1 Which engine decides what

| operation / situation | decided by | evidence |
|---|---|---|
| admitted special cases (coaxial cylinders, planar arrangement union/subtract, convex plane/cylinder intersection, round through hole) | existing exact Bend paths, unchanged | already exact and tested. The hybrid runs beside them in diff mode (step 7) until it has shown agreement |
| every other union / subtract / intersect of analytic bodies | corefine topology, then recover geometry | measured: 32/38 corpus cases exact end to end on corefine's own meshes |
| all-planar inputs outside the admissions | corefine, then recover | planar tessellation has deviation 0, so the mesh *is* the exact boundary. recover only merges coplanar patches. Measured exact on all box, coplanar, touching and r10b cases. **Measured gap:** rotated coplanar faces from different leaves (carriers equal only to ~1e-13) are exact in only 2 of 13 sweep cases; the rest are refused (step 4) |
| results that touch themselves (along a line or at a point) | refusal (`non-manifold contact`) | measured for line contact. Point contact comes back as an invalid `ok` today (step 1) |
| operands that are already mesh bodies (after an earlier Unresolved) | corefine. recover is attempted, and CertifiedMesh is kept if it refuses | tags survive, so the carriers stay exact |
| CI / paranoid mode | corefine and exact-plane must agree on components, Euler characteristic and volume (within 1e-7 relative) | independent code and predicates. Conjecture: this catches corefine's unproven decisions below 1e-13 relative |

### 2.2 How tags flow into analytic recovery

- **Tessellation.** A tag is a face-table row: `(leaf, faceIndex, carrier)`.
  In production, leaf = operand body and faceIndex = the body's face index,
  so `identity.mjs` can map every recovered face back to its source face.
  recover already emits a `tag` per output face.
- **corefine** keeps the tag of the input triangle in every output triangle
  and never creates a triangle outside an input triangle's plane. The
  validator checks every triangle corner against its tagged carrier (within
  deviation + 1e-9 mm). The judge run found 0 off-surface corners on every
  passing corpus case (measured).
- **recover** does the following:
  - It groups tags into carrier classes: the same plane, axis or sphere
    across leaves, so coplanar faces of two operands merge.
  - It builds patches from the tagged triangles.
  - It takes corners where 3 or more patches meet and refines them by Newton
    on the three carriers (residual at most 1e-7 mm, observed at most
    1e-12).
  - It takes each edge's curve from its **two carriers only**, never from the
    polyline: line, circle, ellipse, generator line, and the torus sections
    listed in `docs/proto-recover.md`.
  - It certifies that the mesh boundary stays within a stated bound of the
    exact curve (measured maximum 0.37 of the bound on the corpus).
- **Gap (conjecture, step 9).** corefine can emit exact provenance per new
  edge (its tag pair). An optional provenance section in the result format
  would let recover take curve assignments from the Boolean instead of
  re-deriving them from patch adjacency. It would also remove the need for
  sliver heuristics: the slivers come from differently tessellated
  coincident curves, and the sliver absorption is where recover deletes real
  faces today (section 7).

### 2.3 When recovery is Unresolved

The measured Unresolved causes on the corpus are the same for all three
inputs (manifold3d, corefine and exact-plane meshes):

- `pipe-tee`: non-coaxial cylinder/cylinder, a space quartic;
- `steinmetz-intersect` and `steinmetz-union`: two-carrier vertices on the
  quartic;
- `hex-nut`: a degenerate tangent vertex, plus plane/cone hyperbolas.

These 4 of 38 cases get a **CertifiedMesh** result:

- It is the corefine mesh, whose triangles lie on the input tessellation's
  planes.
- Its stated deviation is the operation's tessellation deviation. The
  validator's corner-to-carrier check (≤ dev + 1e-9 mm) is the per-vertex
  certificate.
- The volume error against OCCT is within area × deviation in every corpus
  case (measured, maximum ratio 0.61).
- The body carries `approximation: {kind: 'certified-mesh', deviationMm,
  reason}`.
- STL/3MF export states the deviation. STEP export and exact-edge queries
  raise a capability error that names the reason (for example "space quartic
  curve type missing").

**What is not certified (measured counter-examples, closed by step 2).** The
two-sided Hausdorff distance between the corefine mesh and the exact CSG is
not bounded by the deviation. Near a tangency, a mesh Boolean can drop or
invent topology below the deviation. The judge run reproduced all 9 such
cases from the recover verifier on the current code: a tool tilted 1e-8 rad
that grazes a cylinder, crossed cylinders, cone and torus shaves. In each,
the meshes of corefine, exact-plane and manifold3d agree with each other,
and the topology they share is wrong against the exact CSG (7 wrong
solids, 2 empty results where a sliver of material exists). So stage [C] must pass before a CertifiedMesh is
labelled with a deviation. Otherwise the answer is Unresolved.

### 2.4 Chained CSG

- **Batching (measured).** The CSG layer flattens chains before any Boolean
  runs. pin-array-chain-20 goes from 20 Booleans to 1. corefine passes the
  iterated adversarial cases (repeated self-unions, split and re-glue,
  repeated subtracts).
- **No drift through exact steps.** After an exact recovery, the next
  operation re-tessellates the *exact* B-rep. Error therefore does not
  accumulate through a chain of exact steps; each operation starts from
  exact carriers.
- **Mesh-only steps (after an Unresolved).** Chaining corefine on its own
  output adds at most about 2^-44 relative per constructed point (corefine
  doc, numeric model). That is about 6e-10 mm after 100 operations on a
  100 mm part (conjecture: arithmetic, not measured over long chains). The
  carriers never change, so a later exact recovery is still possible if the
  offending curve is cut away.
- **Budgets.** Operation evidence records the deviation, the certificates and
  the maximum boundary deviation over its bound, as `operationEvidence` does
  today. Budgets never grow silently.

## 3. Performance model

All numbers are from the judge round 2 reports. The per-case table and the
machine load of every measurement are in `docs/bakeoff.md` "Results".

- **Hybrid total (measured).** corefine plus recover on corefine's own
  meshes, summed over the 32 exact corpus cases: 5,922 + 4,368 ms
  at 1 thread, 4,023 + 3,770 ms at 18 threads. recover is
  48 % of the total at 18 threads. The largest cases, corefine + recover at
  cpu18 (ms):

  | case | corefine cpu1 / cpu18 | recover cpu1 / cpu18 | total cpu18 |
  |---|---|---|---|
  | fine-spheres-50k | 2,094 / 1,220 | 840 / 580 | 1,800 |
  | plate-hole-grid-10x10 | 1,818 / 1,309 | 2,049 / 1,838 | 3,147 |
  | torus-minus-box | 424 / 324 | 216 / 161 | 485 |
  | r10b-g10-union | 50 / 35 | 50 / 41 | 76 |

- **recover follows corefine's triangle count, superlinearly (measured).** On
  the 10x10 hole grid, recover takes 2,049 ms at 1 thread on corefine's mesh
  against 277 ms on manifold3d's (7.4x), while corefine emits
  about 2x the triangles (it keeps split points on straight edges). The
  corefine collinear-vertex collapse (step 9) is therefore also a recover
  speed-up (conjecture until measured).
- **Scaling (measured).** cpu1/cpu18 geo-mean over the cases with at least
  20 ms: corefine 1.46, recover 1.10, exact-plane 3.30, sdf 3.57.
  The hybrid is latency-bound by sequential stages: union-find, assembly
  walks, weld, and recover's finish stage. The big parallel win left is
  **across operations**: independent subtrees and independent parts
  (conjecture; corefine's "level-synchronous scheduler" idea). Bend 2.0.25
  has two CPU-pool traps that bound what fork trees inside one Boolean can
  gain: sharing forces atomic counts, and a fork before a Boolean in the same
  frame serializes it (corefine reproduces both in
  `tmp/corefine/prof/micro.bend`).
- **Start-up (measured).** A native process costs about 6 ms (median
  `startupMs`, corefine cpu1); a Metal process about 57 ms plus 35-60 ms per device
  pass. The JS target costs about 123 ms module load plus 5.0x the native 1-thread
  compute (corefine common set: 30,974 ms JS against 6,157 ms cpu1).

## 4. Native (non-JS) execution path for the CLI

Both routes use the same Bend entry point, `hybrid.boolean(job: String) ->
String`:

1. **Subprocess binary (available now, measured).**
   - A native driver like the bake-off `native.bend`, built with `bend -o`,
     reads the job file and writes the result.
   - The bake-off runs exactly this for corefine and recover on cpu1, cpu18
     and Metal, byte-identical to JS on every case.
   - It costs about 5-10 ms of process start-up per call.
   - It is the first native path because it needs no new machinery.
2. **In-process N-API addon (the target).**
   - `docs/native-bridge.md` has already put Bend-emitted C into the Node
     process: the planar slice under `WONKY_BACKEND=native|diff`, word-exact
     against the JS target and 8.3-9.7x faster at 1 thread.
   - The hybrid adds **one coarse entry** that takes and returns canonical
     text, not a fine-grained surface. The per-call boundary cost therefore
     stays negligible, and the existing `diff` mode compares native and JS
     byte for byte.
   - Known risk: Bend 2.0.25 fails to emit C for
     `ports/curved-intersection.bend` ("arity over 255"). corefine and
     recover already compile to C for the bake-off (measured), so this path
     is not blocked by that.

The CLI gains the hybrid only through `WONKY_BACKEND` selection. There is no
silent fallback between backends (native-bridge rule).

## 5. Checks and features that reuse the engines

| feature | engine | status |
|---|---|---|
| **interference** (assembly: do two parts overlap?) | corefine intersect → volume > 0 and components. Zero-volume contact comes back as a refusal or an empty mesh | as an operation: measured (intersect cases). As a check: conjecture. Note the measured minor defect: a face-touching intersect is refused, not returned empty |
| **clearance** (minimum gap between parts, print-in-place) | recover's `clear.bend`: a Morton BVH over triangles that carry their geometry, exact triangle/triangle distance, forked self-join. A two-body variant reports the minimum distance with the deviation as uncertainty | the component is measured inside recover. The two-body report is conjecture |
| **self-intersection gate** (step 1) | the same `clear.bend` BVH join with an exact triangle/triangle intersection test instead of a distance | conjecture; closes the corefine rotated-coplanar defect |
| **wall thickness** | sdf rays: sphere tracing on the 1-Lipschitz field from triangle centroids. A sampled estimate, labelled as such, never a certificate | measured by the sdf team and its verifier: found the 1.0 mm vent membrane in enclosure-shell (min 0.999 mm) |
| **offset / shell / clearance hole** | sdf face-wise (mitred) offset `f − r` keeps exact carriers (a plane stays a plane, a cylinder's radius grows by r). Tessellate the offset carriers and run the hybrid | offsets measured against OCCT by the sdf team (6809.320 vs 6809.260 mm³). The hybrid route is conjecture |
| **fillets / chamfers** | chamfer = subtract a planar wedge (exact, hybrid). A constant-radius fillet on a line edge between planes = subtract (edge wedge − tangent cylinder). The cylinder is exactly tangent to both planes, which recover supports as a "generator line (incl. the tangent contact line)" | conjecture. Tangent tessellations are a known risk: both corpus tangent cases are refused. Acceptance: an OCCT fillet oracle within 1e-7 volume, and exact STEP |

## 6. Metal versus CPU

**Measured.** Metal is slower than the 18-thread CPU pool for every
prototype. metal/cpu18 geo-mean over the cases with at least 20 ms at cpu1:

| | corefine | exact-plane | sdf | recover |
|---|---|---|---|---|
| metal / cpu18 | 2.40 | 2.09 | 30.94 | 2.77 |
| Metal passes per case | 0 or 2 | 1 | 0 or 1 | 1 |

The reasons, measured by the teams and consistent with the judge run:

- about 40-60 ms device start-up and 35-60 ms per device pass;
- divergent, list-heavy kernels;
- the parts moved to the device are small: corefine's decisions are 1-3 % of
  a Boolean, and exact-plane's certified pair filter takes about 1 ms on the
  CPU pool.

sdf also runs out of memory at `--gpu 1GB` on 4 corpus cases (plate-hole-grid-10x10, hex-nut, enclosure-shell, pin-array-chain-20),
and exact-plane on one 8k-triangle adversarial case. The only uniform
kernels measured (sdf dense sampling and thickness rays, by the sdf team)
reach roughly parity with 18 cores.

**Decision.** The production default is `--gpu off`. Metal stays an
experiment. It gets another trial only for a kernel that meets three
conditions: (a) flat SoA F32 records, (b) batched across all Booleans of an
operation or of a tree level, and (c) faster than cpu18 in a benchmark
(acceptance in step 13). **Conjecture:** a batched broad phase plus
decisions over a whole model might pay; no measurement supports it yet.

## 7. Verifier defects that gate production

The judge re-ran every case each verifier named, on all four targets with
unchanged prototype code, and ran every prototype on every other verifier's
suite as well. The status per case is in `docs/bakeoff.md` "Results",
"Verifier defects: current status". Every defect below reproduced. None was
fixed, because the teams had stopped.

| engine | defect | severity | judge run | closed by |
|---|---|---|---|---|
| corefine | point contact (vertex touch, sphere on a face, cone apex on a face, two spheres pole to pole) returned `ok` with a non-manifold vertex | critical | reproduced on 3/3 named cases, plus 7 more in the other suites (10 in total) | step 1 |
| corefine | **new (judge):** rotated block minus an equally rotated coplanar pocket, or a rotated touching union, returned `ok` with an exact self-intersection (and in one case a non-manifold vertex) | critical | 4 of the 13 rotated coplanar cases in the exact-plane suite (`adv-ep2-rot-coplanar-pocket`, `sweep-pocket-3`, `sweep-pocket-5`, `sweep-touch-union-5`). corefine's own doc says it does not test self-intersection | step 1 |
| corefine | near-coincident sphere union: refused only after seconds (JS about 70 s) | major | reproduced (explicit refusal) | step 11 (budget) |
| corefine | zero-volume face-touch intersection refused instead of empty | minor | reproduced (explicit refusal) | later |
| pipeline | a grazing tool below the deviation: every mesh engine and manifold3d return the same wrong topology (`adv3-cyl-plane-shave-tilt-intersect`, `adv3-torus-top-cap-intersect` come back empty) | critical for CertifiedMesh | reproduced | step 2 |
| recover | sliver absorption deletes real, exactly meshed faces: planar corner chips and bumps, cone tip dimples and bumps. Volume error up to 2.7e-4, labelled exact | critical | reproduced 6/6, identical on manifold3d and corefine meshes | step 2 |
| recover | near-tangency pre-check bypassed by a tilt above 1e-12, crossed cylinders, cones and tori → exact STEP of the wrong solid | critical | reproduced 9/9 (7 wrong geometry, 2 wrong empty) | step 2 |
| recover | **new (judge):** accepts corefine's invalid point-contact mesh and writes a B-rep of a self-touching solid (`contact-accepted`: `adv-cube-vertex-touch`, `adv2-sdf-box-corner-contact`). With manifold3d inputs the same cases are refused | critical (hybrid) | measured | steps 1 and 2 |
| recover | the team's adversarial replay silently skipped fixture cases without prebuilt inputs | major (test infra) | the judge replays through `run.mjs --suite`, which builds every case | done in the judge harness |
| recover | recovered B-rep at 1e5 mm cannot be written by the kernel exporter (`InvalidSource`, `ResolutionLimit`) | minor | reproduced; 6 adversarial cases over the four suites | step 9 |
| exact-plane | point contact returned `ok` (edge-only self-check); 1e-9 mm gaps quantized into point contacts | critical | reproduced 5/5 | differential oracle only |
| exact-plane | rotated coplanar pocket sealed into a void by input quantization | critical | reproduced (2 wrong, 1 refused) | differential oracle only |
| exact-plane | Metal out of memory at `--gpu 1GB` on an 8k-triangle case | major | reproduced | not needed |
| corefine + recover | **new (hybrid gate verifier, after step 4):** the step-4 unification merged exactly representable axis-aligned planes: a sealed void under a 2e-11 mm skin came back as an opened pocket (`ok`, 1 component), and recover wrote an exact B-rep of it | high | `advn-skin-2e-11`, and at 1000 mm with a 5e-10 mm skin | fixed 23 September 2026 (step 4 status) |
| harness | **new (hybrid gate verifier):** the recover grader compared only with OCCT's fuzzy CSG; a wrong topology OCCT shares was graded `exact` | medium | `advn-skin-2e-11` graded exact | fixed 23 September 2026 (step 3 status) |
| corefine + recover | **new (hybrid gate verifier #2, after fix 1):** the unification tolerance 2^-40·scale was about 1000 times the rounding it absorbs and still merged exact carriers that are not axis-aligned: a sealed void 1e-11 mm under a tilted prism face (normal (1,1,0)/sqrt2), and one under a rotated block's top, came back from corefine as an opened pocket (`ok`, 1 component), and recover wrote an exact B-rep of it with the `unified` record | high (prism: regression against HEAD), medium (rotated) | `advn2-prism-tilted-skin-1e-11`, `advn2-rot-skin-1e-11` | fixed 24 September 2026 (step 4 status) |
| recover | **new (hybrid gate verifier #2):** the pre-certificate trusted a (plane, cylinder) pair whose leaf tessellations cross only where a third operand removed them; recover wrote an exact plain cylinder segment where the exact result keeps a 0.45-0.6 mm flat strip (volume 628.3185 against 628.2986), on corefine and manifold3d meshes | high | `advn2-graze-crossing-removed` | fixed 24 September 2026 (step 2 status) |
| sdf | thin walls, plates, ribs, membranes, slots and gaps vanish or close; small parts in a large extent come back empty; a pointed cone leaf gives an empty `ok`; invalid meshes returned `ok` | critical | reproduced on every named case; 2 timeouts | sdf is not a result producer |

**Oracle limits (measured).** Both oracles are wrong on some adversarial
cases, so acceptance tests must not trust either one alone:

- OCCT's exact CSG is off by 1.3e-6 relative on
  `adv-ep2-rot-sphere-minus-cone`. recover's B-rep (from all three mesh
  sources) matches a closed-form volume of revolution to 3.5e-15
  (`tmp/judge2/closed-form-sphere-cone.mjs`). On fine-spheres OCCT is off by
  7.8e-10.
- OCCT's fuzzy 1e-7 mm tolerance merges a 1e-9 mm gap that is really two
  solids.
- manifold3d splits rotated touching unions and pockets that OCCT keeps as
  one solid.

The judge's scorer therefore reports "oracles disagree" separately (2
corefine, 5 exact-plane and 4 sdf cases) and counts them as neither right nor
wrong. Step 3 makes this arbitration part of the harness.

## 8. Ordered integration plan

Every step keeps `npm test` green and adds its acceptance test. Steps 1-3
remove known wrong answers and come first. The production dispatch does not
change before them. "Suites" below means `run.mjs --proto <p> --suite
out/bakeoff/judge2/suites/adv-*` for all four suites, on all four targets.

1. **corefine: refuse instead of returning an invalid mesh.**
   - Add a vertex-link (umbrella) check after triangulation. The link of every
     vertex must be one cycle, otherwise return `unresolved non-manifold
     contact (point)`.
   - Add an exact self-intersection gate. Use a BVH self-join (reuse
     `kernel/proto/recover/clear.bend`) with the exact orient3d
     triangle/triangle test on non-adjacent triangle pairs. A hit returns
     `unresolved result self-intersects (below 2^-36·scale)`.
   - *Acceptance:*
     - the 10 point-contact cases become expected-refusal on all four
       targets;
     - the 4 rotated coplanar cases become pass or a named refusal;
     - corefine's WRONG count on the four suites drops from 18 to at most the
       2 grazing cases (closed by step 2) plus the 2 oracle disputes;
     - the corpus results stay byte-identical;
     - the cpu18 compute sum over the corpus grows by at most 15 %.
   - *Status 23 September 2026 (evening): done in `kernel/proto/corefine`
     (measured).* New `gate.bend`, called on every Boolean's result: a
     vertex-link check ("non-manifold contact (point)") and an exact
     self-intersection gate ("result self-intersects (below 2^-36*scale)").
     The join follows `clear.bend` (rebuilt in corefine, not imported), so
     pairs of triangles with the same tag are not tested; every other pair
     gets the validator's closed test, exact (F32 filters with certified
     bounds, then Reals, then big integers). On the four suites, all four
     targets byte-identical (216/216): the 10 point contacts are
     expected-refusal, the 4 rotated coplanar cases named refusals (1 point,
     3 self-intersection), invalid 14 -> 0. corefine WRONG: 18 -> 4 under
     the judge round scorer (the 2 grazing, the 2 disputes); 3 (all grazing)
     plus 2 `ambiguous` under the step-3 arbiter. Corpus: 152/152 result
     files byte-identical to the judge round. cpu18 corpus compute sum,
     interleaved medians of 5: +10.8 % and +10.6 % (two runs, load 47-77).
     Details: `docs/proto-corefine.md`, step 9 "Output gate".
2. **recover and the pre-certificate: no silent topology below the
   deviation.**
   - Replace `tangent.bend`'s closed-form pair list (plane/cylinder only when
     parallel or perpendicular within 1e-12; no cones, tori or crossed
     cylinders) with a general test. For every carrier pair from different
     leaves, run the leaf-mesh distance test (`tangent.bend region()` over
     `clear.bend`) and refuse if the pair comes within h + h' without the
     result containing their intersection.
   - Refuse two more situations: "a tool face whose tessellation comes within
     h + h' of the other operand but contributes no triangle to the result",
     and "an empty result whose operands come within h + h'".
   - Sliver absorption: never absorb a patch when the patch and its
     neighbours are all planes. With deviation 0 there is no tessellation
     mismatch to repair. On curved carriers, refuse with the absorbed area
     when it exceeds (deviation × patch perimeter).
   - Make recover run its own vertex-link check on the input mesh, so an
     invalid mesh from any source is refused (defence in depth against
     `contact-accepted`).
   - *Acceptance:*
     - all 15 wrong recover outputs of the adv-recover suite (13 wrong
       geometry, 2 wrong empty) become named refusals or exact;
     - `contact-accepted` is 0 on every source;
     - the corpus still gives 32 exact cases on corefine meshes, r10b
       included.
   - *Status 23 September 2026 (evening): done in `kernel/proto/recover`
     (measured).* On the judge-round suites and meshes, all four targets
     byte-identical: the adv-recover wrong outputs drop from 15 to 0 on
     corefine meshes (14 → 0 exact-plane, 15 → 0 manifold3d); the 4 planar
     chips and bumps become exact and the other 11 are named refusals.
     `contact-accepted` is 0 on every source. The corpus gives 32 exact on
     corefine meshes, r10b included, with recover output byte-identical to
     the judge round. The only remaining wrong grade is the OCCT oracle error
     on `adv-ep2-rot-sphere-minus-cone` (step 3). Recover compute on the
     corpus grows by about 12 % at 1 thread and 11 % at 18 threads
     (interleaved A/B, loaded machine), mostly the pre-certificate's join.
     Details in `docs/proto-recover.md`, "Plan step 2".
   - *Status 24 September 2026 (fix of a verifier defect, hybrid gate
     verifier #2):* `tangent.bend` kept every close pair whose leaf
     tessellations touch or cross somewhere, "even when a third operand
     removed it from the result". A rod minus a plane tilted 5e-4 along its
     axis (0.005-0.015 mm inside the surface, crossing the facets only where
     z < 12), minus the half z < 12, came back from recover as an exact
     plain cylinder segment; the exact result keeps a 0.45-0.6 mm flat strip
     (OCCT 628.2986 mm^3, the verifier's quadrature of the cross section
     agrees to 3e-12 relative; the B-rep had 628.3185, on corefine and on
     manifold3d meshes). New rule in `tangent.bend`:
     a touching pair on a curved carrier whose result has no edge between
     the two classes goes through a second, bipartite join (`clear.bend
     close2`): the result's triangles of each class against the other
     class's leaf triangles of other leaves. A pair whose result triangles
     come within h + h' + 1e-6 mm of the other's leaf triangles and never
     touch or cross them is refused by name ("... cross only where the result
     does not keep them, and the result's faces on one of them come within
     ... without touching them or an edge between them"). A pair whose result
     faces cross the other leaf is a transversal crossing through the
     result's interior (a tee's branch bore through the main pipe's wall,
     inside the branch) and stays decided. The case now gives a named refusal
     on corefine and manifold3d meshes, on all four targets. Regression case
     `adv-graze-crossing-removed` plus the control
     `adv-transversal-crossing-removed` (exact) in
     `fixtures/bakeoff/adversarial-recover.json`, and a test in
     `test/proto-recover.test.mjs`. Nothing else changed: no grade of
     any old case changes on any source (corefine, exact-plane, manifold3d;
     corpus and four suites), and every recover output is byte-identical to
     fix 1 except the `unified` statements of step 4's tolerance fix.
     Recover compute on the corpus (interleaved A/B against the same code
     without the rule, medians of 5, outputs identical, load about 10):
     +5.2 % at 1 thread, +8.4 % at 18 threads, mostly the half-edge sort
     on jobs whose touching curved pairs are both in the result. Raw
     reports: `out/bakeoff/fix2/`.
3. **Harness: arbitrate the oracles.**
   - For every case where OCCT and manifold3d disagree on shells or on the
     volume beyond area × deviation, add a third, closed-form or
     independently constructed reference (as the judge did for the
     sphere-minus-cone), or mark the case `ambiguous` with the reason.
   - Also: score an `ok` answer with an invalid mesh on a
     `non-manifold-contact` case as a failure, not `info`; hash only the
     prototype's own directory in the build key; add `--gpu` per prototype.
   - *Acceptance:* `judge.mjs` reports 0 unarbitrated disputes on the four
     suites.
   - *Status 23 September 2026: done (harness only, uncommitted).*
     `scripts/bakeoff/arbiter.mjs` + `fixtures/bakeoff/arbiter.json`: 16
     disputes (corpus 0), each with a third reference (closed form,
     quadrature, set identity or a validator-checked constructed mesh);
     derived decisions: manifold3d 7, OCCT 4, expectation 1, ambiguous 4 (the
     rotated coplanar cases, decided by the F32x2 input rounding).
     `judge.mjs --judge out/bakeoff/judge2` prints "oracle disputes: 16,
     unarbitrated: 0". Invalid `ok` on a contact case scores `invalid`
     (tested); build keys contain no other prototype's directory (tested);
     `--gpu` per prototype (registry `gpu`, sdf 8GB). On the judge round 2
     reports corefine WRONG goes 18 -> 17: 2 disputes become `ambiguous`,
     and `adv3-cyl-plane-shave-tilt-union` becomes a WRONG answer (2 solids
     where the exact CSG has 1, grazing class, step 2). Details:
     `docs/bakeoff.md`, "Oracle arbitration".
   - *Status 23 September 2026 (late night, fix of a verifier defect):* the
     recover grader (`recover-check.mjs`, used by `judge-recover.mjs`)
     compared only with OCCT's fuzzy CSG, so a wrong topology that OCCT
     shares was graded `exact` (the hybrid gate verifier's opened sealed
     void). Disputed cases are now graded against the arbiter entry; a
     dispute without an entry is `unarbitrated` (or `mismatch` if the
     answer matches neither oracle), never `exact` or `pass`, in both the
     recover grader and `run.mjs`. Re-grading the stored runs changes one
     grade: recover on exact-plane's mesh of `adv-box-union-gap-1e-9`, an
     exact B-rep of the gap closed by exact-plane's quantization, goes from
     `exact` to `mismatch`; every grade of the corefine-source runs is
     unchanged. Tests in `test/bakeoff-harness.test.mjs`; 18 arbiter entries
     (the 2 new regression cases, both `manifold`).
4. **Carrier unification for rotated coplanar input.**
   - Carriers from different leaves that agree within the F32x2 rounding of
     one rigid transform (plane normal and offset within 2^-40·scale) get the
     same carrier class. The decision uses exact predicates on the
     face-table values and is recorded in the output as a stated tolerance.
   - *Acceptance:* the 13 rotated coplanar sweep cases give exact STEP or a
     refusal that names the tolerance. None is wrong, and at least the 6
     pocket cases are exact.
   - *Status 23 September 2026 (night): done (measured).* The decision is
     `kernel/proto/unify.bend` (exact big-integer tests on the face table;
     scale = the smallest power of two at or above the largest leaf
     |coordinate|), shared by corefine and recover. The judge's diagnosis
     needed one correction: recover already merged such planes (1e-7 mm);
     corefine decided the rounding and left slivers and membranes. So
     corefine applies the classes in its predicates: a comparison between
     elements touching a unified class, within 2^-36·scale, is an exact tie
     for the symbolic perturbation (`docs/proto-corefine.md`, algorithm
     step 10). recover writes `unified <classes> <tolerance>` into the B-rep,
     and refusals of such jobs end with "; coplanar plane carriers unified
     within 2^-40*scale (N classes)". All 14 rotated coplanar cases of the
     exact-plane suite (the 13 above plus `adv-ep2-rot-coplanar-intersect`)
     give exact STEP on corefine meshes (OCCT, strict `validate-step.py`),
     all 7 pockets included; none is refused, none is wrong (before: 3
     exact). corefine on the four suites, judge scorer with the step-3
     arbiter: 196 good / 13 refused / 3 wrong (the grazing cases) / 4
     `ambiguous` / 0 errors (step 1: 190 / 21 / 3 / 2 / 0; judge round:
     181 / 17 / 18 / 0). All four targets are byte-identical (corefine
     216/216 and 38/38, recover on every run). The corpus stays
     byte-identical (corefine 152/152; recover changes only in
     `r10b-g10-union`, which gains the `unified` line), with 32 exact.
     Corpus compute against the step-1 binary is within noise (cpu18 +0.8 %
     and +5.2 %, cpu1 -2.0 %).
   - *Status 23 September 2026 (late night, fix of a verifier defect):* the
     hybrid gate verifier found that the unification also merged exactly
     representable, non-rotated planes: a sealed void under a 2e-11 mm skin
     (below 2^-40·scale at scale 32), and the same void at 1000 mm under a
     5e-10 mm skin, came back from corefine as an opened pocket (1
     component, no stated tolerance in the mesh), and recover wrote an
     "exact" 11-face B-rep of it. Fixed in `kernel/proto/unify.bend`: a pair
     whose two normals are both exactly axis-aligned is never unified (no
     rotation rounded those carriers; they are the input as given). Both
     cases give 2 components with the exact area on all four targets
     (on the verifier's job, byte-identical to the HEAD kernel), and recover refuses
     the 2e-11 mm skin by name instead of writing a wrong B-rep. Regression
     cases `adv-skin-void-2e-11` and `adv-skin-void-5e-10-at-1000` in
     `fixtures/bakeoff/adversarial-corefine.json` (arbitrated, closed form: 2
     shells; the step-4 binary scores `mismatch` on both) plus tests in
     `test/proto-corefine.test.mjs` and `test/proto-recover.test.mjs`.
     Nothing else changes: corefine native results on the corpus and the
     four suites are byte-identical to the step-4 run (762/762 files), recover
     likewise (660/660, r10b keeps its `unified` line: one of its normals is
     not axis-aligned), JS == cpu1 on the corpus and the new cases. corefine
     on the suites (218 cases): 198 good / 13 refused / 3 wrong (grazing) / 4
     `ambiguous`; `judge.mjs`: 18 disputes, 0 unarbitrated. Raw reports:
     `out/bakeoff/fix1/`.
   - *Status 24 September 2026 (fix of a verifier defect, hybrid gate
     verifier #2):* the tolerance 2^-40·scale (2.9e-11 mm at scale 32) was
     about 1000 times the F32x2 rounding of one rigid transform (at most
     2.6e-14 mm measured), so it merged real skins of input that is not
     axis-aligned: a triangular prism minus a sealed pocket whose tilted face
     lies 1e-11 mm under the tilted outer face (a regression against HEAD),
     and a rotated block minus an equally rotated sealed pocket 1e-11 mm under
     its top, came back from corefine with 1 component (the void opened, no
     tolerance stated in the mesh), and recover wrote the opened pocket with
     `unified 1`. Fixed in `kernel/proto/unify.bend`: normals within 2^-44
     per component and offsets within 2^-44·scale. The bound: F32x2 wire
     values round by at most 2^-49 relative per coordinate, so analytically
     coplanar carriers of equally transformed leaves differ in n.o by at
     most about 6·2^-49·scale; the census of every rotated coplanar job
     (corpus, four suites, both verifiers' extra cases) gives identical
     normals and offsets at most 2^-50.2·scale, while real separations start
     at 2^-41.7·scale (the 1e-11 mm skins). The axis-aligned exception of
     fix 1 stays. Both skin cases give 2 components with the exact area on
     all four targets, byte-identical to the HEAD kernel; recover refuses
     both skins by name (clearance certificate). Regression cases
     `adv-skin-void-prism-tilted-1e-11` and `adv-skin-void-rot-1e-11` in
     `fixtures/bakeoff/adversarial-corefine.json` (arbitrated by a
     constructed nested mesh: 2 shells; the fix-1 binary gives 1 component
     on both) and tests in `test/proto-corefine.test.mjs` (including the
     boundary: a rotated pocket top moved by 1e-12 mm stays unified, by
     4e-12 mm it does not) and `test/proto-recover.test.mjs`. All 14 rotated
     coplanar cases stay unified and exact. corefine results on the corpus
     and the four suites are byte-identical to fix 1 except the refusal
     suffix of `adv-ep2-rot-cylinders-line-touch` ("within 2^-44*scale");
     recover outputs change only in the `unified` tolerance (2^-35 -> 2^-39
     at scale 32), and `r10b-g10-union`, whose frozen faces (normal
     (0, -1, 2.5e-13), 2^-41.7·scale apart) are no longer unified, is
     byte-identical to the judge round again. Still 32 exact on the corpus.
     corefine on the suites (222 cases): 202 good / 13 refused / 3 wrong
     (the grazing trio) / 4 `ambiguous`; `judge.mjs`: 20 disputes, 0
     unarbitrated. Raw reports: `out/bakeoff/fix2/`.
   - *Status 24 September 2026 (hybrid-robust X1 + X2, `docs/hybrid-robust.md`):*
     identical carriers used to join silently, on the assumption that an
     identical carrier means exactly coplanar vertices. That holds only for
     axis-aligned carriers. On a tilted plane every leaf vertex is a rounded
     point (the probe's ReliefUnion at 612:9 and `adv:kt1-rot`: cap vertices
     up to 6.5e-14 mm above and below the identical cone-base carrier), and
     corefine decided that rounding (pinched face loops: "face
     triangulation failed"). Now an identical pair is unified unless both
     carriers are exactly axis-aligned (X1, `kernel/hybrid/unify.bend`),
     and a tie decided under unification is constructed from the compared
     value (X2, `corefine/shadow.bend tie_canon`), so the two constructions
     of one symbolic point are one vertex. The 32-bit class limit is now
     explicit: `Unified` counts all unified classes and those past the
     limit, and the refusal suffix names them (at most 6 classes measured on
     388 jobs). The corpus has unified classes again (`tilted-holes-17deg`:
     `unified 4`, B-rep otherwise byte-identical). Probe and `kt1-rot`
     ReliefUnion give the canonical KT1 answer class (certified mesh), 388
     jobs: 18 refusals -> results, 0 regressions (`docs/proto-corefine.md`
     step 10, `local design note` section 9).
5. **Promote the code.**
   - Move `kernel/proto/corefine` and `kernel/proto/recover`, plus a shared
     util (stable parallel sort, read-only table, fuel loops), to
     `kernel/hybrid/`.
   - Add one entry, `hybrid.boolean(job) -> result`. The result is
     `exact <brep>`, `mesh <dev> <reason> <mesh>` or `unresolved <reason>`.
   - Register `hybrid` in `scripts/bakeoff/prototypes.mjs` so the bake-off
     harness keeps testing it.
   - *Acceptance:* `run.mjs --proto hybrid` on the corpus and the four suites
     gives the same verdicts as corefine + recover after steps 1-4, with the
     four targets byte-identical.
   - *Status 24 September 2026: done (measured, uncommitted).*
     - **Layout.** `kernel/hybrid/` holds `corefine/`, `recover/` and the
       shared `mesh.bend`, `mesh-io.bend` (the wire format) and `unify.bend`;
       relative imports are unchanged (same depth). `kernel/proto/mesh.bend`
       and `mesh-io.bend` are symlinks to them, so exact-plane, null and sdf
       build as before. `kernel/proto/corefine`, `recover` and the new
       `hybrid` hold only the bake-off entry `main.bend` (delegating `run`,
       `parse`, `solve`, `show`) and the native driver. corefine's and
       recover's own `util.bend` were not merged: their tables and sorts have
       different signatures, and a merge changes evaluation order, so it
       needs its own identity and timing run.
     - **Entry** `kernel/hybrid/main.bend` `boolean(job)`: corefine; on its
       `ok`, recover on the job plus corefine's result text (the bake-off's
       recover-mode input, so the entry is the two prototypes in sequence).
       Answers: `exact` + recover's B-rep; `mesh <dev> <reason>` + corefine's
       mesh; `unresolved <reason>`. Which recover refusal keeps the mesh is a
       new class in recover (`topo.bend` `Out`; recover's text is unchanged):
       `BCert` (answered `unresolved`) for the pre-certificate, the input
       checks (vertex within dev of its carrier, 2-manifold, vertex links),
       shell nesting, clearance, and a mesh boundary or corner farther from
       the exact curve or vertex than its certified bound; `BNo` (answered
       `mesh`) when only the exact recovery is refused. `<dev>` is the job
       deviation, a per-vertex distance to the tagged carrier, not a
       Hausdorff bound (section 2.3).
     - **Wiring.** `hybrid` in `scripts/bakeoff/prototypes.mjs` (output kind
       `hybrid`, verdicts `exact`, `mesh-<verdict>` on the validated mesh,
       `unresolved`); `judge-recover.mjs` grades its B-reps;
       `loadJsKernel()` exposes `kernel.hybrid` (about 0.1 s of module load
       at low machine load).
     - **Evidence.** `run.mjs --proto hybrid`, cpu1/cpuN/metal and JS, compared
       file by file by `scripts/bakeoff/hybrid-check.mjs` with the fix-2
       corefine + recover results (`out/bakeoff/fix2/judge`): corpus 114/114
       native + 38/38 JS, adv-corefine 102 + 34, adv-exact-plane 132 + 44,
       adv-sdf 180 + 60, adv-recover 252 + 84 identical; all targets
       byte-identical on all 260 cases. The corefine and recover shims
       reproduce the fix-2 corpus results byte for byte (76 and 72 files).
       Verdicts (native): corpus exact 32, mesh 4 (pipe-tee, both Steinmetz
       cases, hex-nut: the section 2.3 set, all `mesh-pass`), expected refusal
       2; adv-corefine 16 / 3 / 15 (exact / mesh / refused), adv-exact-plane
       25 / 3 / 16, adv-sdf 43 / 7 / 10, adv-recover 44 / 7 / 33. Every mesh
       answer validates and matches the oracles (`mesh-pass`); the grazing trio
       (corefine's 3 wrong answers) is `unresolved` by the pre-certificate.
       Two recover refusals that measure the mesh beyond its bound
       (`adv2-sphere-flat-within-dev`, boundary 0.157 mm at bound 0.1;
       `adv3-cone-side-shave-phase0`, corner 0.124 mm) are `unresolved`, not
       `mesh`. Tests: `test/hybrid-entry.test.mjs`.
     - **Timing, JS target against cpu1** (stub-probe operands of the R20
       cases, local development evidence, interleaved,
       medians, load about 6): KT6 union (step 1) 47.6 ms against 6 ms
       (7.9x; cpu1 mesh 3 + recover 3 ms, process wall 10.9 ms); KT2 seat cut
       (step 0) 194 ms against 33 ms (5.9x; mesh 22 + recover 11 ms, wall
       38.6 ms); both exact, JS == cpu1 byte for byte. At load 50-90 the JS
       target took 373 and 1,334 ms (cpu1 11 and 68 ms).
     - **Open.** The text hand-off from corefine to recover costs a show and
       a parse of the mesh (JS, loaded machine: 120 ms for pipe-tee, 1.9 s
       for plate-hole-grid-10x10); an in-memory hand-off would need the mesh
       twice. Recovery checks of later stages (boundary distances, nesting,
       clearance) are not evaluated when recovery stops earlier, so such a
       `mesh` answer rests on the pre-certificate and the input checks
       (step 8). The native backend has no hybrid entry yet (step 11); the
       native addon's build key covers `loadJsKernel()`'s wiring and must be
       rebuilt.
6. **Body → job encoder (JS, I/O only).**
   - Run `printMesh(body, dev, {tags: true})` for each operand. The face table
     comes from the bodies' surfaces, with `brep` leaves.
   - Weld equal coordinates as `recover-roundtrip.mjs` does.
   - Move `recover-brep.mjs toBodies` to `src/hybrid.mjs` as the decoder.
   - *Acceptance:* the round-trip test `body → tagged mesh → recover` is exact
     on the 13 round-trip bodies (today `recover-roundtrip.mjs`, 13/13), as a
     `node --test` file.
7. **Dispatch in `src/boolean.mjs` behind a policy.**
   - Replace the final `unsupported(...)` of `booleanInBend` (the one after
     the pierce admission), and the coaxial `!result.supported` refusal, with
     the hybrid when `modelingPolicy.boolean === 'hybrid'` (default off).
   - `operationEvidence` records method `hybrid corefine+recover`, the
     deviation, the certificate maxima and the refusal reason. Tags feed
     `identifyBoolean`.
   - Under `WONKY_BOOLEAN_DIFF=1`, where an existing special case admits the
     operation, the hybrid also runs. The two are compared on topology (face,
     edge and vertex counts, genus), on volume within 1e-9 relative, and on
     the source-face identities of the faces.
   - *Acceptance:*
     - New FeatureScript fixtures (plate with a 17° tilted hole, sphere minus
       box, enclosure shell, torus minus box, r10b-style bosses) give exact
       STEP that passes `uv run scripts/validate-step.py`, with volume within
       1e-7 of an OCCT oracle (or of the step-3 arbiter).
     - Every Boolean in `npm test` agrees in diff mode, or the divergence is
       filed and explained.
     - The existing tests are unchanged. Only then does `hybrid` become the
       default for non-admitted operations.
   - *Status 24 September 2026 (R20 gate task hybrid-dispatch, uncommitted).*
     The R20 stage-1 gate (`local design note` task 10) made the hybrid the
     default last arm; the tests that pinned the exact arms' refusals run
     with `exact-only` (test followUp, below).
     - **Policy.** `modelingPolicy.boolean`: `hybrid-last` (default; not
       written into the normalized policy, so existing policies and evidence
       read as before) or `exact-only` (today's refusals, word for word).
       `src/modeling-policy.mjs` `booleanPolicy()`.
     - **Where the hybrid runs** (`src/boolean.mjs` `last()`): the general
       refusal; the pierce declines (all eight codes, the ranged-circle
       refusal and the missing certified volume); the coaxial `!supported`;
       the planar arrangement's `Unresolved` after its cap-snap retry; the
       curved convex-tool intersection's `Unresolved` (r10b 25:2); and any
       certified-mesh operand (the exact arms would admit it vacuously over
       its empty edge list). An `Unresolved` whose reason is a verdict on the
       input (`InvalidInput`, `InvalidTopology`, `SourceTolerance`) stays the
       exact arm's refusal: a damaged or out-of-budget operand is never
       re-meshed. The coaxial enclosed-void refusal also stays. Exact arms run
       first and unchanged, so no result that built before changes.
     - **Answers.** `exact`: the recovered body, validated
       (`validateAnalytic`; a recovered void shell is refused by name), its
       volume integrated in Bend (`kernel/volume.bend`): stated as
       `validation.volumeMm3` only when closed-form, otherwise kept with label
       and bound in `validation.integratedVolume`. `mesh`:
       `certifiedMeshBody()` (`src/hybrid-mesh.mjs`), never exact.
       `unresolved`, and every named refusal on the way (printMesh of an
       operand, a void): `UnsupportedFeatureError` `<exact arm's refusal>
       [hybrid: <reason>]`, with evidence.
     - **Evidence.** `method 'hybrid corefine+recover'`, `booleanPolicy`,
       `declined` (the exact arm, its message, reason, stage), `answer`,
       `deviationMm`, `leaves` (how each operand was meshed), `certificate`
       (recover's maxima), `statements`, `volumes`, `attachedMesh`; a refusal
       has `status 'Refused'` and its reason.
     - **Provenance.** Each result face lists its operand faces (recover's
       tags); `identity.topology.faces[i].sources` records them, and
       `removedMaterial` (`src/library.mjs`) reads them: a SUBTRACTION removed
       material iff a face comes from the tool on a carrier no target face
       shares; a tool face on a shared carrier (coincident contact) or a face
       without provenance is not evidence, and if nothing else decides, the
       result is refused by name.
     - **Diff mode.** `WONKY_BOOLEAN_DIFF=1`: every admitted result is also run
       through the hybrid and compared on counts and genus, volume (1e-9
       relative) and face sources; the report is `evidence.hybridDiff` plus one
       stderr line, the admitted result is returned unchanged.
       `WONKY_HYBRID_DUMP=<dir>` writes each job and answer.
     - **Evidence (R20 acceptance, live tree).** KT2, KT6 PASS (volume
       3.8e-15 and 0 relative, exact); KS02, KS03, KS05, KS07, KS09 stop at
       their first `opChamfer`/`opFillet`; KS08 PASS through a certified mesh
       (task 11). KT4 builds steps 0-7 exactly and needs two task-11 diffs
       (attach the result mesh when carriers were unified; drop
       float32-collapsed slivers of a hybrid mesh in the r20 export): with
       them KT4 (8.9e-16, exact) and KS06 (a = b to 7e-12 mm³, 5.1e-10 from
       Onshape) PASS. r10b unchanged at 25:2 (the hybrid refuses an operand
       printMesh does not cover). Tests: `test/hybrid-dispatch.test.mjs`.
8. **CertifiedMesh bodies.**
   - Add a body kind `mesh` with an `approximation` label. It is produced
     only when the step-2 pre-certificate passed.
   - STL/3MF export states the deviation. STEP export and edge-geometry
     queries raise `UnsupportedFeatureError` with the recover reason.
     Chained operations accept mesh operands.
   - *Acceptance:* pipe-tee as FeatureScript gives STL that passes
     `uv run scripts/validate-print-mesh.py` within the stated deviation;
     STEP refuses and names "space quartic"; the body summary prints
     "approximate, 0.01 mm".
9. **Close the Unresolved set.** Tracked separately, ordered by FDM value:
   - plane/cone hyperbola and the degenerate tangent vertex (hex-nut);
   - space quartics of cylinder/cylinder as B-spline curves with a stated
     bound computed in Bend (pipe-tee, Steinmetz, cross holes);
   - sphere/torus surfaces and `BREP_WITH_VOIDS` in the body format and in
     `src/exporters.mjs`. Today only the test serializer `recover-stepx.mjs`
     writes them. That is why the 4 sphere corpus results pass
     `validate-step.py` only through the refinement rule, and why 2 torus
     results pass strictly only through the test serializer;
   - the exporter's coordinate limit (`InvalidSource` at 1e3-1e5 mm scale);
   - the corefine collinear-vertex collapse, to halve the triangles on
     straight edges;
   - the corefine → recover provenance section.

   *Acceptance per item:* the named corpus or adversarial case becomes exact
   with strict `validate-step.py` through `src/exporters.mjs`.
10. **r10b.**
    - Evaluate `fixtures/r10b/r10b.fs` `singleStepR10b` with the hybrid at the
      g10 union, where the exact general-fuse route stalled.
    - *Acceptance:* the AGENTS.md target: real geometry, `validate-step.py`
      passes, and the g10 union volume is within 1e-7 of OCCT's 87218.0358
      mm³ (the bake-off shows 1.2e-10 on the frozen operands, exact through
      the kernel exporter). The frozen snapshot stays untouched.
11. **Native CLI path.**
    - (a) A subprocess binary `wonky-hybrid` built from
      `kernel/hybrid/native.bend`, selected by `WONKY_BACKEND=native` for the
      hybrid entry only.
    - (b) Then the coarse N-API entry in the native bridge: one call per
      operation, canonical text wire, `bx_heap_clear` after each call.
    - Add a work budget: refuse after N candidate pairs or triangulation
      retries with a named reason (the near-coincident sphere case spends
      seconds before refusing).
    - *Acceptance:*
      - the step-7 fixtures run under `WONKY_BACKEND=native` with
        byte-identical `brep.json`, `.step` and `.stl` against the JS target;
      - `WONKY_BACKEND=diff` shows 0 divergences;
      - the native Bend JS kernel is never loaded (slice guard);
      - the end-to-end speed-up over the JS target is measured and reported
        per phase.
12. **Operation batching and scheduling.**
    - `opBoolean` with many tools becomes one n-ary job.
    - Independent operations of a model run level-synchronously in one fork
      tree (the corefine scheduler idea).
    - *Acceptance:* a FeatureScript model with 20 bosses makes 1 hybrid call.
      A two-part model shows cpu18 over cpu1 > 2x on the pair (conjecture
      until measured).
13. **FDM checks.**
    - `interference(a, b)` (corefine intersect).
    - `clearance(a, b)` (two-body `clear.bend`, minimum distance ± deviation).
    - `wallThickness(body, t)` (sdf rays, labelled as an estimate).
    - *Acceptance:* the sdf verifier's FDM fixtures. The 0.5 mm
      print-in-place gap is reported as 0.5 ± 0.01 mm, the 0.3 mm membrane is
      found, and the interference of overlapping boxes is 1500 mm³ exact.
    - Metal gets a trial here only if a flat, batched kernel beats cpu18
      (section 6).

## 9. What is proven and what is not

| claim | status |
|---|---|
| corefine + recover give OCCT-valid exact STEP on 32/38 corpus cases, r10b g10 included, on corefine's own meshes | measured (judge round 2): 25 through the kernel exporter and strict `validate-step.py`, 2 torus results strict through the test serializer, 4 sphere results through the refinement rule, 1 empty. The same 32 with manifold3d and with exact-plane meshes |
| corefine, exact-plane and recover give byte-identical results on JS, cpu1, cpu18 and Metal | measured on the corpus (38/38) and on all adversarial runs |
| hybrid compute (corefine + recover) at 18 threads: fine-spheres-50k 1,800 ms, plate-hole-grid-10x10 3,147 ms, r10b-g10-union 76 ms | measured, compute only (load in the Results table) |
| Metal does not pay for any current kernel | measured |
| the hybrid is safe near tangencies and contacts | **not yet**: 18 wrong `ok` answers from corefine and 15 wrong exact STEP from recover on the adversarial suites; steps 1-2 are required |
| CertifiedMesh deviation equals the tessellation deviation | conjecture, true only with the step-2 pre-certificate (measured counter-examples without it) |
| rotated coplanar CAD input is handled | **not yet**: 2 of 13 exact, recover refuses the rest. 4 of those refusals sit on invalid corefine meshes that a CertifiedMesh fallback would pass on, so steps 1 and 4 are both needed |
| chained operations do not drift | argued from the design (re-tessellation of exact results; 2^-44 per mesh step), not measured over long chains |
| fillets through tangent-cylinder Booleans | conjecture |
| cross-operation parallelism gives more than the 1.46x that 18 threads give inside one corefine Boolean | conjecture |

**Status 24.09.2026, at commit.**
- Steps 1-4 are done.
- Corpus: byte-identical; all four targets agree.
- Point contacts: refused by name.
- Rotated coplanar input: exact, 14 of 14.
- Wrong `ok` answers: recover 15 → 0; corefine alone 18 → 3, the 3 being the grazing cases that step 2's pre-certificate refuses on the hybrid path.
- The last verification round found three defects; the final Regression review addressed all of them at the root, and no further verification ran after it:
  - unification merged a real 1e-11 mm skin; the tolerance was tightened to 2^-44;
  - recover accepted a grazing tool whose crossing a third operand removed;
  - the tolerance was looser than the rounding it absorbs.
- Open:
  - corefine's own `ok` mesh does not yet record a unification;
  - the step-1 timing criterion is borderline, one run of four at +22.8 % on a loaded machine.
