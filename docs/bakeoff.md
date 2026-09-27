# Boolean bake-off harness

Status: 22 September 2026. This is the shared referee for the Boolean engine
bake-off (corefine, exact-plane, sdf, recover, plus the `null` baseline). It
contains test infrastructure only: fixture generation, oracles, validation,
timing and reporting run in JS or Python; every prototype computes its geometry
in Bend (`kernel/proto/<name>/`). OpenCascade (via build123d's OCP) and
manifold3d are used exclusively as independent test oracles through `uv run`;
nothing they produce is ever fed into a prototype or into production.

## Layout

| path | role |
|---|---|
| `scripts/bakeoff/cases.mjs` | case catalogue (source of truth); `--write` regenerates `fixtures/bakeoff/cases.json` |
| `fixtures/bakeoff/cases.json` | 38 cases: CSG trees of analytic primitives (or frozen exact B-rep bodies) |
| `scripts/bakeoff/tessellate.mjs` | primitive -> tagged watertight leaf mesh (TEST INFRASTRUCTURE) |
| `scripts/bakeoff/brep-tessellate.mjs` | frozen exact B-rep body -> tagged watertight leaf mesh (TEST INFRASTRUCTURE) |
| `scripts/bakeoff/fixtures.mjs` | writes `<case>.job`, `<case>.csg.job` and the `<case>.json` sidecar |
| `fixtures/bakeoff/jobs/` | committed jobs up to 256 KiB, every sidecar, `index.json` |
| `out/bakeoff/jobs/` | larger jobs (gitignored); regenerated on demand, verified by the sidecar sha256 |
| `scripts/bakeoff/jobfmt.mjs` | JS codec of the job/result text (byte-compatible with the Bend side) |
| `kernel/hybrid/mesh.bend` (symlink `kernel/proto/mesh.bend`) | shared Bend types (Job, Csg, Prim, Surface, FaceTag, Tri, Mesh, Outcome) |
| `kernel/hybrid/mesh-io.bend` (symlink `kernel/proto/mesh-io.bend`) | Bend parser/printer of the job/result text (JS and native) |
| `kernel/proto/hybrid/` | the production hybrid Boolean `kernel/hybrid/main.bend` as a prototype (output `exact` / `mesh <dev> <reason>` / `unresolved`); `kernel/proto/corefine` and `recover` are thin entries over `kernel/hybrid/{corefine,recover}` |
| `kernel/proto/null/` | baseline prototype: `main.bend` + `native.bend` (template for every team) |
| `scripts/bakeoff/validate.mjs` | result validator (exact predicates in `predicates.mjs`) |
| `scripts/bakeoff/reference.py` | oracles (OCCT exact CSG; manifold3d on the same fixture meshes) |
| `scripts/bakeoff/brep-step.mjs` | writes frozen B-rep leaves as STEP (kernel serializer) for the OCCT oracle |
| `fixtures/bakeoff/reference.json` | computed oracle numbers with tool versions and the job hash they belong to |
| `scripts/bakeoff/run.mjs`, `js-worker.mjs`, `prototypes.mjs` | runner, JS-target worker, registry |
| `out/bakeoff/<proto>/` | `report.json`, `summary.md`, `results/<case>.<target>.result`, `build/` |
| `scripts/bakeoff/suite.mjs` | prepares an extra case set (e.g. `fixtures/bakeoff/adversarial-*.json`) as a suite directory: jobs, OCCT + manifold3d oracles, manifold dumps |
| `scripts/bakeoff/judge-recover.mjs` | grades recover's B-rep output for the corpus or a suite (recover-check functions: OCCT, `validate-step.py`, volume/area vs OCCT CSG) |
| `scripts/bakeoff/judge.mjs` | judge tables from `<judge dir>/**/report.json` (round 2: `--judge out/bakeoff/judge2`); `tmp/judge2/write-docs.mjs` renders them into section "Results" and `docs/hybrid-boolean-plan.md` |
| `scripts/bakeoff/arbiter.mjs` | oracle arbitration: finds the cases where OCCT and manifold3d disagree and computes a third reference for each (section "Oracle arbitration") |
| `fixtures/bakeoff/arbiter.json` | one arbitration entry per disputed case (decision, third reference, evidence, job hash); used by `run.mjs` and `judge.mjs` |
| `test/bakeoff-harness.test.mjs` | fast harness tests (~3-5 s) |

## Commands

```sh
npm run bakeoff -- --proto null                         # all cases, targets js,cpu1,cpuN,metal
npm run bakeoff -- --proto corefine --cases hex-nut,pipe-tee --targets cpu1,cpuN --repeat 5
node scripts/bakeoff/run.mjs --proto recover --source oracle-manifold   # recover mode
npm run bakeoff:fixtures                                # regenerate all jobs (deterministic)
node scripts/bakeoff/fixtures.mjs --check               # fail if a regenerated job differs from its sidecar hash
npm run bakeoff:reference                               # jobs + B-rep STEP + oracles (+ manifold result dumps)
node scripts/bakeoff/validate.mjs <job> <result>        # validate one result, JSON report, exit 1 if invalid
node --test test/bakeoff-harness.test.mjs
node scripts/bakeoff/suite.mjs fixtures/bakeoff/adversarial-sdf.json out/bakeoff/judge/suites/adv-sdf   # extra case set + oracles
node scripts/bakeoff/run.mjs --proto sdf --suite out/bakeoff/judge/suites/adv-sdf --out out/bakeoff/judge/sdf/adv-sdf/native
node scripts/bakeoff/judge-recover.mjs --results <recover results dir> --out <dir> [--suite <dir>]   # grade recovered B-reps (OCCT)
node scripts/bakeoff/judge.mjs --judge out/bakeoff/judge2  # judge tables -> out/bakeoff/judge2/results.md ([--out <dir>])
node tmp/judge2/write-docs.mjs                         # -> docs/bakeoff.md "Results" + docs/hybrid-boolean-plan.md
node scripts/bakeoff/arbiter.mjs --check               # recompute fixtures/bakeoff/arbiter.json; fail on a change or an unarbitrated dispute
node scripts/bakeoff/arbiter.mjs --write               # regenerate it (needs the suites' reference.json, default out/bakeoff/judge2/suites)
```

Runner options: `--targets js,cpu1,cpuN,metal` (default all), `--repeat k`
(native: k processes, median per phase; JS: k warm runs after one cold run),
`--timeout s` per case and target (default 120), `--threads N` for cpuN
(default: logical CPUs, 18 on the M5 Pro), `--rebuild`, `--no-validate`,
`--source oracle-manifold|<proto>|<results dir>` (recover mode input),
`--suite <dir>` (run a case set prepared by `scripts/bakeoff/suite.mjs`
instead of the corpus: its own `cases.json`, jobs, `reference.json` and
manifold3d dumps), `--out <dir>` (write `report.json`, `summary.md` and
`results/` there instead of `out/bakeoff/<proto>/`, so subset and suite runs
never overwrite a prototype's full report), `--gpu <size>` (device heap of
the metal target, `on` or a size like `512MB` / `8GB`; `--gpu-mem` is an
alias). Without `--gpu` the heap is the prototype's own `gpu` in
`prototypes.mjs`: `1GB`, and `8GB` for sdf, whose octrees on four corpus cases
do not fit 1 GB. The report records the suite, source, device heap and where
it came from (`gpuSource`: `prototype` or `cli`), and the load average at
start and end.

## Cases

38 cases, each with `id`, `category`, `fdmRationale`, `deviationMm`, `expect`
and `csg`. Categories: box basics (union/subtract/intersect, rotated
intersect), coplanar and touching faces, holes (through, blind hole, blind
pocket, counterbore, countersink cone, 4 holes, 10x10 grid, 4 holes tilted
17 deg), cylinders (pipe tee, equal-radius Steinmetz intersect/union, coaxial
stack), spheres (minus box, intersect cylinder, spherical cavity), mechanical
(hex nut = hex prism minus bore intersect chamfer cone; enclosure shell with 4
bosses, pilot holes, USB cut-out and vent; 48-tooth gear, 240 side faces,
minus bore), tangency (cylinder resting on a box face; hole wall tangent to a
side face), identity (single leaf, A u A, A - A, A n A), topology (internal
void, disjoint union), many operands (left-deep chain of 20 unions), scale
(two spheres, 50,560 input triangles), tori (torus minus box) and
`r10b-g10-union`: the frozen r10b UpperCore g10 UNION operands
(`fixtures/boolean-stress/r10b-g10-operands.json.gz`, 82 planar faces vs 40
planar + 10 cylindrical faces with circle, ellipse and seam edges) on which
the exact general-fuse route stalled.

CSG conventions (also in `cases.json.conventions`): leaves
`{prim, params, transform: {rotate: [{axis, deg}], translate}}`, rotations
applied in list order, then the translation; `subtract` is `children[0] -
children[1]`. `box {min, max}`, `cylinder {radius, height}` (+Z from z = 0),
`cone {r1 at z=0, r2 at z=height, height}` (a radius may be 0),
`sphere {radius}`, `torus {major, minor}` (axis +Z), `prism {points, height}`
(simple polygon, +Z), `brep {source, body}` (frozen exact B-rep body as stored).

`expect`:
- `solid` (35 cases): a valid closed 2-manifold mesh (possibly several
  components) is the answer.
- `empty` (`self-subtract`): the answer is `ok` with `mesh 0 0`.
- `non-manifold-contact` (`cylinder-tangent-box-face`, `hole-tangent-edge`):
  the exact regularized result touches itself along a line; no closed
  2-manifold mesh represents it without moving geometry. The expected answer is
  `unresolved <reason>` (scored `expected-refusal`); a mesh is reported and
  validated but scored `info`, never `pass`. OCCT returns 2 solids and 1 solid
  respectively; manifold3d resolves both by symbolic perturbation,
  and our validator rejects its outputs for exactly these two cases (touching
  triangles; duplicated directed edges at the tangent line).

## Fixtures

`tessellate.mjs` is fixture generation, not kernel code. Per leaf it emits a
closed, consistently outward-wound, 2-manifold mesh whose vertices are shared
along seams (one vertex per position; the validator confirms zero duplicate
positions) and lie on their analytic surfaces to double precision (checked
<= 1e-9 mm at generation, observed below 5e-12 mm). Rings use exact cos/sin at
quarter turns so axis-aligned tangencies (rod on a face, hole touching a side)
put vertices exactly on the contact line. Segment counts come from the sagitta
formula; the measured deviation is recorded per leaf and generation refuses a
leaf whose measured deviation exceeds the case `deviationMm`
(0.01 mm everywhere, 0.004 mm for `fine-spheres-50k`). Measurement: spheres
exact (closest point of each triangle to the centre); cylinders/cones sampled
on a barycentric 8-grid, which contains the chord midpoints where the maximum
lies; tori sampled on a 16-grid (an estimate, 9.52e-3 <= 0.01).

Frozen B-rep leaves (`brep-tessellate.mjs`) support planar faces with any
number of loops and single-loop cylindrical faces; edges are lines, circles and
ellipses. Every edge is sampled once, so both faces share its points. A
cylindrical face owns the sampling of its curved edges: they are sampled at a
uniform angular grid (sagitta <= deviation) plus the angles of all the face's
vertices, so its unrolled (angle, height) domain splits into angular slabs with
no vertex inside; each slab is cut into trapezoids and zipper-triangulated.
Planar faces are ear-clipped (earcut) and boundary vertices that earcut drops
as collinear are restored by fan splits. Body vertices are used as stored
(they lie within 5e-12 mm of their surfaces although the body states a vertex
tolerance of 3e-4 mm, recorded as `sourceToleranceMm`). Anything else is
refused with an error. Result: body 0 = 84 vertices / 164 triangles,
body 1 = 557 / 1130, measured deviation 9.97e-3 mm, both leaves validate.

Every real is quantized to F32x2 (`hi = fround(x)`, `lo = fround(x - hi)`,
value `hi + lo`, exact in a double) before it is written, so JS, Python and
Bend read identical numbers. Sidecars record counts, tags, segment counts,
measured deviation, analytic leaf volume and the sha256 of both job files;
`ensureJobs` regenerates missing or stale large jobs.

## Job and result format

ASCII, whitespace-separated tokens (the Bend lexer accepts space, tab, CR,
LF). `<real>` is two decimal U32 words: the IEEE-754 bit patterns of hi and lo.
Canonical output is one record per line exactly as below (the JS encoder and
the Bend printer produce identical bytes; the tests check this).

```
wonky-bakeoff-job 1
case <id>
deviation <real>
nodes <N>
<N prefix tokens, one per line: "union" | "subtract" | "intersect" | "leaf <i>">
prims <P>
prim <kind> <k> <k reals> <12 reals>        # kind box|cylinder|cone|sphere|torus|prism|brep
faces <F>
face <leaf> <faceIndex> <type> <reals>      # tag = position in this list (0-based)
meshes <M>                                  # 0 in <case>.csg.job
mesh <leaf> <V> <T>
<V lines: x y z as 3 reals>
<T lines: a b c tag>                        # counter-clockwise seen from outside
end
```

- prim params (local frame): box `x0 y0 z0 x1 y1 z1`; cylinder `r h`; cone
  `r1 r2 h`; sphere `r`; torus `R r`; prism `h x0 y0 x1 y1 ...`; brep none.
  The 12 reals are the row-major 3x4 placement `world = R * local + t`
  (`r00 r01 r02 tx r10 ... tz`). Leaf meshes and the face table are already
  in world coordinates.
- surfaces (world): `plane o n x` (9 reals, n = outward unit normal of the
  leaf solid, x in-plane unit); `cylinder o n x r` (10, n = unit axis);
  `cone o n x r a` (11: radius at o is r, radius at signed axial height h is
  `r + h tan a`); `sphere o r` (4); `torus o n R r` (8). Same conventions as
  `kernel/analytic.bend`.
- Leaf meshes are indexed per leaf (indices start at 0 in each `mesh`). Tags
  are global.

Result:

```
ok
mesh <V> <T>
<V vertex lines> <T triangle lines "a b c tag">
end
```

or `unresolved <reason on one line>` followed by `end`. An empty result is
`ok` + `mesh 0 0`. Result vertices may be duplicated by position (the
validator welds by exact position) but must be real F32x2 values.

Recover mode input is the full job text immediately followed by a result text
(the tagged Boolean mesh to recover from). The recover output starts with `ok`
or `unresolved <reason>`; the body after `ok` is defined by the recover team
(the runner records status, size and time and scores `ok` as `info`).

## Bend API (`kernel/proto/mesh.bend`, `kernel/proto/mesh-io.bend`)

Types: `Op` (`Union`/`Subtract`/`Intersect`), `Csg` (`CLeaf{leaf}`,
`CNode{op, left, right}`), `PrimKind` (`PBox`...`PPrism`, `PBrep`), `Affine
{r0, r1, r2, t}`, `Prim{kind, params, placement}`, `Surface` (`SPlane{o,n,x}`,
`SCylinder{o,n,x,r}`, `SCone{o,n,x,r,a}`, `SSphere{o,r}`, `STorus{o,n,major,minor}`),
`FaceTag{leaf, face, surface}`, `Tri{a, b, c, tag}`, `Mesh{vertices:
List<G.Vec3>, triangles: List<Tri>}`, `LeafMesh{leaf, mesh}`, `Job{id,
deviation, tree, prims, faces, meshes}`, `Outcome` (`Solved{mesh}` |
`Unresolved{reason}`), `JobParse` (`Parsed{job}` | `Malformed{reason}`).
Reals are `R.Real{hi, lo}` from `kernel/real.bend`, vectors `G.V3` from
`kernel/precise.bend`. Helpers: `M.count`, `M.concat` (disjoint mesh
concatenation), `M.empty_mesh`.

Functions (`MIO.`): `parse_job(s) -> JobParse`, `parse_job_prefix(s) ->
JobParse & String` (rest after `end`), `parse_result(s) -> Outcome`,
`parse_recover(s) -> JobParse & Outcome`, `show_outcome(o) -> String`,
`show_mesh(m)`, `show_job(job)`, round trips `round_trip_job`,
`round_trip_result`, `round_trip_recover`. Parsing never guesses: any
malformed token poisons the rest and the parse answers `Malformed` (or
`Unresolved{"malformed-result"}`). Every loop is tail-recursive over a
shrinking Nat/String (the JS target has a bounded stack).

Parser/printer speed (null prototype, M5 Pro): a 50,560-triangle job
(2.4 MB) reads in 23 ms, parses in 26-28 ms native (159 ms on the JS target);
printing a 25,280-triangle mesh takes 24-26 ms native.

## Prototype contract

`kernel/proto/<name>/main.bend` exports `def run(job: String) -> String` and
should export `parse(job: String) -> M.JobParse`, `solve(p: M.JobParse) ->
M.Outcome`, `show(o: M.Outcome) -> String` so the JS target can time phases
(the worker falls back to timing `run` as a whole). `native.bend` is a copy of
`kernel/proto/null/native.bend` (only the import of `./main.bend` matters): it
reads `IO.args = [job, result]`, times read/parse/compute/serialize/write with
`IO.now`, forces each phase with a checksum before the next stamp, writes the
result and prints one JSON line `{"readMs","parseMs","computeMs",
"serializeMs","writeMs"}`. The line marked `# @bakeoff-device-call` is turned
into a `!` call for the Metal build; remove the mark (and place your own `!`
calls in the balanced parallel kernel) when shipping the whole solve to the
GPU is wrong (it usually is: list-heavy code is slow on the device, see the
null numbers). Prototypes must answer `unresolved <reason>` for anything they
cannot do exactly or within their stated tolerance (for `sdf`: every `brep`
leaf, which has no analytic CSG form on the wire).

Registry (`scripts/bakeoff/prototypes.mjs`): `null` (mesh), `corefine` (mesh),
`exact-plane` (mesh), `sdf` (input `csg`: `<case>.csg.job`, no meshes),
`recover` (input `recover`, output `brep`).

To add a prototype: create `kernel/proto/<name>/main.bend` (import
`../mesh.bend as M`, `../mesh-io.bend as MIO`), copy `null/native.bend`,
register the name in `prototypes.mjs` if new, then
`npm run bakeoff -- --proto <name> --cases leaf-cylinder,disjoint-union --targets js,cpu1`
before running everything.

## Runner, timing and scoring

Builds: `bend native.bend -o out/bakeoff/<p>/build/cpu`; Metal: the variant
`kernel/proto/<p>/.bakeoff-native-metal.bend` (gitignored, deleted after use)
is emitted as C, instrumented with the same host-only `wonky_metal_passes`
counter as `scripts/benchmark-hardware.mjs`, compiled with
`clang -DBEND_METAL=1 -x objective-c -fobjc-arc -fmodules -std=c11 -O3` and
`--gpu-build`. Build keys hash the prototype's `native.bend` and every
`.bend` it imports, transitively (`bendSources`): the prototype's own
directory plus the shared files it imports (`kernel/proto/mesh.bend`,
`mesh-io.bend`, `kernel/real.bend`, ...). Unchanged sources reuse the
binaries; edits elsewhere in `kernel/`, and in particular in another
prototype's directory, never force a rebuild (the harness test checks that no
prototype's key contains another prototype's directory). Hashing the
directory alone would reuse a stale binary after an edit to a shared file it
imports. The JS target is precompiled once through
`src/bend-loader.mjs` (cached).

Targets: `js` (fresh `node` process per case; `loadMs` = module load, `coldMs`
= first run, then medians of warm `parseMs/computeMs/serializeMs/totalMs`),
`cpu1` (`--threads 1 --gpu off`), `cpuN` (`--threads N --gpu off`), `metal`
(`--threads N --gpu 1GB`; evidence: `metalPasses >= 1` on stderr, otherwise
flagged `no Metal pass`). Native phases are `IO.now` whole milliseconds
(sub-millisecond work shows 0); `startupMs` = process wall time minus the
phases. All targets' result texts are compared byte for byte
(`targetsAgree`); a disagreement turns `pass` into `mismatch`.

Each case gets one verdict: `pass`, `mismatch` (valid but disagrees with the
oracles), `invalid`, `unresolved`, `expected-refusal`, `info`, `ambiguous`
(an arbitrated case that the input rounding decides; see "Oracle
arbitration"), `unarbitrated` (the oracles disagree, no arbiter entry exists
for the job, and the answer agrees with one of them), `error`, `timeout`,
`no-source` (recover). On a disputed case
the arbitration replaces the overruled oracle (next section). `pass` requires a valid mesh, equal
component count and Euler characteristic as manifold3d, volume within
1e-4 relative of manifold3d OR within the analytic bound (below), and a result
bbox within `2 x deviation + 1e-6 x (1 + extent)` of manifold3d's
(`bboxMatch`). The judge added the bbox check because a dropped 10 mm fin
fits inside the volume bound. It compares with manifold3d because both meshes
lie within one deviation of the exact surface. OCCT's BRepBndLib "optimal"
box is loose on trimmed spheres (2.5 mm on `adv2-sphere-rotated-corner`), so
OCCT's box is not used. An `ok` mesh that the validator rejects is `invalid` for
every expectation, including `non-manifold-contact` (it used to be `info`,
which hid the point-contact defects); only a *valid* mesh for a contact case
is `info`. The report
adds `tier`: `exact` (volume relative error vs manifold3d <= 1e-7, the bar for
exact mesh methods), `agree` (<= 1e-4), `off`. Also reported: area error, the
largest per-tag area difference against manifold3d's face-ID-propagated result
(`tagAreaMaxAbsErrVsManifold`), and `volumeAbsErrVsOcct` against the analytic
bound `OCCT area x deviation` (`withinAnalyticBound`; first order, the volume
between a surface and a mesh within `deviation` of it).

## Validator (`scripts/bakeoff/validate.mjs`)

- Vertices are welded by exact position first, so duplicated indices cannot
  fake a seam or hide a hole.
- Watertight and consistently oriented: every directed edge occurs exactly once
  and its reverse exactly once (`openEdges`, `orientationErrors`,
  `nonManifoldEdges`).
- 2-manifold vertices: the link of every vertex is a single cycle.
- Degenerate triangles: repeated vertex or exactly collinear corners.
- Self-intersections: BVH candidate pairs, then an exact closed
  triangle/triangle test (Shewchuk-filtered `orient3d`/`orient2d` with BigInt
  fallback, exact on the F32x2 wire values). Touching counts as intersecting.
  Triangles sharing an edge may only meet in it (a coplanar fold is caught),
  triangles sharing one vertex only in it.
- Volume (divergence theorem about the bbox centre), area, bbox, connected
  components (by shared vertices: an internal void is 2 components), Euler
  characteristic and genus `(2 C - chi) / 2` (manifold3d reports `1 - chi/2`
  for the whole mesh; the runner compares chi).
- Tags: every tag exists; every corner of a triangle lies within
  `deviation + 1e-9 mm` of its face's carrier surface (unbounded surface; the
  cone distance covers both nappes).

It is tested against deliberately broken meshes (flipped triangle, removed
triangle, degenerate triangle, unknown and wrong tags, split seam, crossing
boxes, face-sharing boxes, corner-touching boxes, dented stack) and against
all 38 manifold3d oracle outputs: it accepts the 36 whose exact result is a
2-manifold and rejects exactly the two tangent-contact cases. Cost: about 0.3 s
for 50k triangles.

## Oracles (`fixtures/bakeoff/reference.json`)

`uv run scripts/bakeoff/reference.py` (PEP 723 pins: build123d 0.13.0 with
cadquery-ocp-novtk 8.0.1.0.0, manifold3d 3.5.3, numpy 2.5.3; Python 3.13.3):

- `occt`: exact CSG with BRepPrimAPI + BRepAlgoAPI (fuzzy 0): volume, area
  (BRepGProp), optimal bbox, solids, shells, BRepCheck validity. `brep` leaves
  are read from STEP written by `scripts/bakeoff/brep-step.mjs` with the
  kernel's own serializer (`src/exporters.mjs`; exact analytic surfaces and
  curves, pcurves as stated-bound UV splines); OCCT validates each body.
- `manifold`: manifold3d Booleans of the same fixture leaf meshes (`Mesh64`,
  face_id = tag): volume, area, genus, components, triangles, bbox, per-tag
  area. `--dump out/bakeoff/oracle-manifold` also writes each result in the
  result format (default recover-mode source).

Every entry stores the `jobSha256` it was computed for; the runner ignores a
reference whose hash does not match the current job.

| case | expect | leaf tris | OCCT volume | OCCT area | solids | manifold volume | genus | comps | result tris |
|---|---|---|---|---|---|---|---|---|---|
| leaf-cylinder | solid | 224 | 1357.1680 | 678.584 | 1 | 1354.3223 | 0 | 1 | 224 |
| box-union-overlap | solid | 24 | 10500.0000 | 3200.000 | 1 | 10500.0000 | 0 | 1 | 36 |
| box-subtract-overlap | solid | 24 | 6500.0000 | 2700.000 | 1 | 6500.0000 | 0 | 1 | 28 |
| box-intersect-overlap | solid | 24 | 1500.0000 | 800.000 | 1 | 1500.0000 | 0 | 1 | 12 |
| box-rotated-intersect | solid | 24 | 5968.9223 | 1843.260 | 1 | 5968.9223 | 0 | 1 | 36 |
| box-coplanar-union | solid | 24 | 9000.0000 | 2800.000 | 1 | 9000.0000 | 0 | 1 | 30 |
| box-coplanar-subtract | solid | 24 | 6000.0000 | 2200.000 | 1 | 6000.0000 | 0 | 1 | 20 |
| box-touching-merge | solid | 24 | 2000.0000 | 1000.000 | 1 | 2000.0000 | 0 | 1 | 20 |
| box-touching-partial | solid | 24 | 1144.0000 | 720.000 | 1 | 1144.0000 | 0 | 1 | 28 |
| plate-through-hole | solid | 172 | 5839.1505 | 3136.191 | 1 | 5839.8111 | 1 | 1 | 176 |
| plate-blind-hole | solid | 156 | 5341.0951 | 2567.124 | 1 | 5341.3937 | 0 | 1 | 158 |
| plate-blind-pocket | solid | 24 | 5160.0000 | 3304.000 | 1 | 5160.0000 | 0 | 1 | 28 |
| plate-counterbore | solid | 300 | 7064.0319 | 2853.682 | 1 | 7064.6950 | 1 | 1 | 304 |
| plate-countersink | solid | 380 | 5203.6798 | 2559.941 | 1 | 5204.2180 | 1 | 1 | 504 |
| plate-4-holes | solid | 524 | 7854.7328 | 4818.269 | 1 | 7855.6644 | 4 | 1 | 540 |
| plate-hole-grid-10x10 | solid | 11212 | 6954.4250 | 8123.717 | 1 | 6972.1772 | 100 | 1 | 11612 |
| tilted-holes-17deg | solid | 524 | 9284.6268 | 4370.249 | 1 | 9286.6493 | 4 | 1 | 540 |
| pipe-tee | solid | 784 | 1673.0857 | 3434.551 | 1 | 1671.0592 | 2 | 1 | 876 |
| steinmetz-intersect | solid | 416 | 666.6667 | 400.000 | 1 | 664.2363 | 0 | 1 | 200 |
| steinmetz-union | solid | 416 | 2474.9260 | 1170.796 | 1 | 2469.7174 | 0 | 1 | 624 |
| coaxial-cylinder-stack | solid | 512 | 3015.9289 | 1156.106 | 1 | 3011.0866 | 0 | 1 | 426 |
| sphere-minus-box | solid | 9812 | 3008.5986 | 1102.699 | 1 | 3003.9237 | 0 | 1 | 5998 |
| sphere-intersect-cylinder | solid | 10040 | 2663.1790 | 987.412 | 1 | 2657.6894 | 0 | 1 | 5360 |
| box-minus-sphere-cavity | solid | 6900 | 2316.8910 | 1788.133 | 1 | 2319.6439 | 0 | 1 | 5054 |
| hex-nut | solid | 596 | 712.8847 | 644.798 | 1 | 713.6685 | 1 | 1 | 592 |
| enclosure-shell | solid | 1332 | 19069.8083 | 18713.168 | 1 | 19059.2926 | 1 | 1 | 1354 |
| gear-48-bore | solid | 1148 | 13051.3374 | 6227.304 | 1 | 13052.4848 | 1 | 1 | 1152 |
| cylinder-tangent-box-face | non-manifold-contact | 220 | 10356.1945 | 3499.557 | 2 | 10350.4653 | -1 | 2 | 220 |
| hole-tangent-edge | non-manifold-contact | 172 | 2858.6283 | 1737.699 | 1 | 2859.2090 | 0 | 1 | 176 |
| self-union | solid | 416 | 785.3982 | 471.239 | 1 | 783.4884 | 0 | 1 | 208 |
| self-subtract | empty | 416 | 0.0000 | 0.000 | 0 | 0.0000 | 1 | 0 | 0 |
| self-intersect | solid | 416 | 785.3982 | 471.239 | 1 | 783.4884 | 0 | 1 | 208 |
| internal-void | solid | 24 | 7000.0000 | 3000.000 | 1 | 7000.0000 | -1 | 2 | 24 |
| disjoint-union | solid | 204 | 1502.6548 | 951.858 | 2 | 1501.2206 | -1 | 2 | 204 |
| pin-array-chain-20 | solid | 1932 | 3439.8230 | 3299.646 | 1 | 3434.8160 | 0 | 1 | 1972 |
| fine-spheres-50k | solid | 50560 | 6534.6753 | 1751.376 | 1 | 6530.9970 | 0 | 1 | 38824 |
| torus-minus-box | solid | 13900 | 1065.9173 | 1163.001 | 1 | 1063.2271 | 1 | 1 | 7192 |
| r10b-g10-union | solid | 1294 | 87218.0358 | 41838.810 | 1 | 87226.7768 | 5 | 1 | 1302 |

(genus as reported by manifold3d, `1 - chi/2`; the validator's own genus of
`internal-void` and `disjoint-union` is 0.) Notable: `r10b-g10-union` is valid
in OCCT as one solid of 87218.0358 mm^3; the manifold result differs by
+8.74 mm^3, the tessellation effect of the ten inscribed cylinder holes.

## Oracle arbitration (`scripts/bakeoff/arbiter.mjs`, `fixtures/bakeoff/arbiter.json`)

Plan step 3 (`docs/hybrid-boolean-plan.md`, section 8). Both oracles are wrong
on some adversarial cases: OCCT's fuzzy CSG merges a 1e-9 mm gap, drops
sub-micron slabs and loses a 1e-6 mm spherical cavity; manifold3d's symbolic
perturbation splits rotated touching faces and re-entered operands, and on
its tessellated leaves it cannot see a tool that grazes a surface by less
than the deviation.

- **Dispute.** A case is disputed when OCCT's shell count differs from
  manifold3d's component count, or their volumes differ by more than OCCT
  area x deviation. The corpus has none; the four adversarial suites have 16
  in the judge round, 18 since the two regression cases of 23 September 2026
  (`adv-skin-void-2e-11`, `adv-skin-void-5e-10-at-1000` in adv-corefine),
  20 since the two of 24 September 2026 (`adv-skin-void-prism-tilted-1e-11`,
  `adv-skin-void-rot-1e-11`).
- **Third reference.** For each disputed case `arbiter.mjs` computes a third
  reference with an independent method, keyed by case id and job hash:
  closed forms on the wire box bounds (gap, slabs, overlaps); a result mesh
  constructed from the wire leaves and accepted by the exact validator plus an
  exact point-in-mesh test (thin spherical shell); a set identity plus a
  closed form (`(((A - B) u B) - B) u B = A u B`); Gauss-Legendre quadrature
  of a closed-form circular-segment cross section (the tilted cylinder
  shaves); Pappus's theorem (the torus cap). The decision is *derived*: the
  oracle whose shells, Euler characteristic (manifold3d) and volume agree
  with the reference within its tolerance is confirmed (`manifold` or
  `occt`); `expectation` when the case expectation decides it (`empty`).
  Tolerance: 1e-4 relative for planar results (the harness's agreement
  bound), max(1e-4 relative, area x deviation) for curved ones.
- **Policy.** The reference is the exact CSG of the analytic input, unless the
  F32x2 rounding of the input itself can change the topology. That is the
  case for the rotated coplanar cases: after the rotation the analytically
  coincident faces are displaced by 4e-15 to 2.6e-14 mm, with vertices on
  both sides or all on one side (measured by `coincidentFaceProbe`, exact).
  Whether the rounded input touches, overlaps, leaves a gap or seals a pocket
  is decided below the input rounding, and neither oracle decides it on the
  rounded input. Those cases are `ambiguous`: an `ok` answer with either
  oracle's topology and the reference volume (and the bbox check) scores
  `ambiguous`, neither right nor wrong; any other answer is still `mismatch`
  or `invalid`. Plan step 4 (carrier unification within 2^-44 x scale) fixes
  the intended answer for the hybrid. Since step 4 (23 September 2026)
  corefine answers all four with the unified topology (one solid, the
  reference volume and area), scored `ambiguous` here, and recover turns
  them into exact STEP that OCCT confirms. The arbiter entries are
  unchanged: deciding these cases by the unification rule would change
  step 3's arbitration for every prototype.
- **Scoring.** `run.mjs compare(report, ref, arb)`: for a decided case the
  topology comes from the reference, and the overruled oracle's volume
  criterion no longer counts (OCCT's area x deviation bound no longer admits
  a wrong volume when OCCT is overruled; manifold3d's 1e-4 relative bound no
  longer admits its wrong topology). The bbox check against manifold3d stays.
  A dispute without an entry for the current job is `unarbitrated`: an
  answer that agrees with one oracle scores `unarbitrated` (neither right
  nor wrong, and visible in the counts), one that agrees with neither is
  `mismatch`. Before 23 September 2026 such a case was scored against
  manifold3d alone.
- **Recover grading** (`recover-check.mjs gradeRows`, used by
  `judge-recover.mjs` and `recover-hybrid.mjs`; since 23 September 2026).
  On a disputed case the B-rep is graded against the arbiter entry: `occt`
  and `expectation` as before (OCCT CSG, 1e-7); `manifold`, `reference`
  and `ambiguous`: the reference's shell count (or one of the admissible
  ones) and volume and area within 1e-7 of the reference are `exact`, a
  volume only within the reference's own tolerance (a constructed-mesh
  reference) is `reference-tolerance`, anything else `mismatch`. Without
  an entry the case is `unarbitrated` (or `mismatch` if the B-rep agrees
  with neither oracle), never `exact`. Before, the grader compared with
  OCCT's fuzzy CSG only, so a wrong topology that OCCT shares was graded
  `exact` (the opened sealed void of `advn-skin-2e-11`, found by the hybrid
  gate verifier). Shells, not solids, are compared (a sealed void is one
  solid with two shells).
- **Judge.** `judge.mjs` re-scores every stored case with the arbitration,
  reports per prototype the verdicts the arbitration changed, and prints the
  dispute census ("Oracle arbitration" table) with the number of
  unarbitrated disputes.

The disputes and their decisions (16 in the judge round, plus the 2 regression cases of 23 September 2026 and the 2 of 24 September 2026):

| suite | case | dispute | decision | third reference |
|---|---|---|---|---|
| adv-corefine | adv-box-union-gap-1e-9 | OCCT 1 shell, manifold3d 2 | manifold | closed form: disjoint boxes, 1e-9 mm gap survives the wire |
| adv-corefine | adv-slab-sliver-1e-7 | OCCT 0 shells | manifold | closed form: 20 x 20 x 1e-7 mm slab |
| adv-corefine | adv-thin-spherical-shell-1e-6 | OCCT 1 shell, volume of the full sphere | manifold | constructed nested result mesh, exact validator: 2 shells |
| adv-corefine | adv-skin-void-2e-11, adv-skin-void-5e-10-at-1000 (regressions, 23 September 2026) | OCCT 1 shell (fuzzy merge opens the void), manifold3d 2 | manifold | closed form: closed internal void, 2 shells |
| adv-corefine | adv-skin-void-prism-tilted-1e-11, adv-skin-void-rot-1e-11 (regressions, 24 September 2026) | OCCT 1 shell (fuzzy merge opens the void), manifold3d 2 | manifold | constructed nested result mesh (outer leaf + reversed pocket leaf), exact validator + point-in-mesh: 2 shells |
| adv-exact-plane | adv-ep2-skin-5e-7, adv-ep2-r1-skin-1e-7 | OCCT 0 shells | manifold | closed form slabs |
| adv-exact-plane | adv-ep2-cube-corner-overlap-1e-7, adv-ep2-cube-edge-overlap-1e-9 | OCCT 2 shells | manifold | closed form: positive-volume overlap, 1 shell |
| adv-exact-plane | adv-ep2-iterated-sub-add-sub | manifold3d 2 components | occt | set identity + closed form of box u tilted cylinder (OCCT within 4e-11 mm^3) |
| adv-exact-plane | adv-ep2-empty-sub-then-intersect | manifold3d 37 sliver components | expectation | `expect: empty` |
| adv-exact-plane | adv-ep2-sweep-touch-union-1, -3, adv-ep2-sweep-pocket-4 | manifold3d 2 components | ambiguous | closed form in the box frame; faces displaced <= 2.6e-14 mm by the rounding |
| adv-sdf | adv2-sdf-countersink-rot | manifold3d 2 components | ambiguous | closed form (plate - bore - frustum); flush faces displaced <= 1.2e-14 mm, 16 vertices in, 33 out |
| adv-recover | adv3-cyl-plane-shave-tilt-intersect, adv3-cyl-plane-shave-tilt-union | manifold3d 0 / 2 components | occt | quadrature of the circular-segment cross section (OCCT within 3e-13 / 9e-9 mm^3) |
| adv-recover | adv3-torus-top-cap-intersect | manifold3d empty | occt | Pappus: V = 2 pi R x segment area (OCCT within 4e-14 mm^3) |

Effect on the judge round 2 reports (`node scripts/bakeoff/judge.mjs --judge
out/bakeoff/judge2 --out <dir>`, same stored results): 0 unarbitrated
disputes. corefine WRONG 18 -> 17: `adv-ep2-sweep-touch-union-3` and
`adv-ep2-sweep-pocket-4` become `ambiguous`, and
`adv3-cyl-plane-shave-tilt-union` goes from `pass` to `mismatch` (corefine,
like manifold3d, returns the cylinder and the box as 2 solids 0.004 mm apart,
where the exact CSG is one solid joined by a 0.005 mm shaving: the grazing
class that plan step 2's pre-certificate must refuse). exact-plane 26 -> 23
(`adv-ep2-iterated-sub-add-sub` now passes), sdf 47 -> 44. The corpus
verdicts do not change. Not a dispute under this definition, and therefore
not arbitrated: `adv-ep2-rot-sphere-minus-cone`, where OCCT's volume is 1.3e-6
relative off (inside area x deviation, so it does not affect mesh scoring;
the recover grading in `judge-recover.mjs` still compares with OCCT at 1e-7
on it, as on every undisputed case).

## Null baseline (M5 Pro, 18 cores, `--repeat 3`)

2 pass (`leaf-cylinder`, `disjoint-union`, volume relative error vs manifold3d
3e-15 and 2e-15), 34 unresolved, 2 expected refusals; all four targets produce
byte-identical results. Builds: cpu 2.0 s, Metal 3.6 s, JS compile 2.1 s.

| case | target | read | parse | compute | serialize | write | startup | process |
|---|---|---|---|---|---|---|---|---|
| leaf-cylinder | cpu1 / cpuN | 0 | 0 | 0 | 0 | 0 | 2.6 / 2.4 | 3.6 / 3.4 |
| leaf-cylinder | metal | 0 | 0 | 34 | 0 | 1 | 36.7 | 79.5 |
| leaf-cylinder | js (warm) | - | 1.78 | 0.01 | 0.65 | - | load 36 | 91 |
| fine-spheres-50k (50,560 tris) | cpu1 | 23 | 28 | 11 | 0 | 0 | 3.8 | 65.9 |
| fine-spheres-50k | cpuN | 23 | 26 | 10 | 0 | 1 | 5.4 | 66.4 |
| fine-spheres-50k | metal | 24 | 28 | 662 | 0 | 0 | 37.6 | 756.6 |
| fine-spheres-50k | js (warm) | - | 158.9 | 4.9 | 0.01 | - | load 37 | 765 |
| plate-hole-grid-10x10 (11,212 tris) | cpu1 | 4 | 4 | 1 | 0 | 1 | 3.7 | 14.6 |
| plate-hole-grid-10x10 | metal | 5 | 4 | 126 | 0 | 0 | 40.3 | 175.3 |

(ms; native phases are whole milliseconds.) The Metal `compute` is the null
`solve` shipped whole to the device (one pass, verified); a Metal target has a
~35-40 ms device start-up and a device pass costs tens of milliseconds even
for trivial work, so only balanced numeric kernels belong behind `!`.

## Known harness limitations

- Native timings are whole milliseconds; use `--repeat` and larger cases for
  small effects. JS runs sequentially and says nothing about native or GPU
  speed.
- The self-intersection test is closed: components that touch (a tangent
  contact, two blocks sharing a face without merging) are invalid. That is the
  intended 2-manifold contract, hence the `non-manifold-contact` cases.
- Components are counted by shared vertices (shells), not solids.
- Tag validation checks the unbounded carrier surface, not the face patch; a
  triangle tagged with the right surface of the wrong coplanar face (e.g.
  another leaf's coplanar top face) passes. Per-tag area against manifold3d is
  reported for that reason but is not a pass criterion (coplanar faces from
  different leaves may legitimately keep either tag).
- Torus and cone deviations are sampled estimates (torus 9.52e-3 against
  the 0.01 bound); sphere, cylinder and B-rep deviations are exact bounds.
- The countersink cone and the hole cylinder share a circle analytically but
  have different segment counts, so their tessellations do not share vertices
  on it (this is part of the test, not a fixture error).
- `brep` leaves exist only as meshes plus face table on the wire; an analytic
  CSG prototype cannot evaluate them and must refuse. The OCCT reference of
  such a case passes through the kernel's STEP writer.
- Large jobs are not committed; `ensureJobs` regenerates them deterministically
  and checks the sidecar sha256 (V8's fdlibm trigonometry is platform
  independent). `reference.json` records the job hash for each case.
- `run.mjs` scores recover-mode output only by its status line (`info`);
  the exact grading (OCCT, `validate-step.py`, volume and area against the
  OCCT CSG) is `scripts/bakeoff/judge-recover.mjs` (or the recover team's
  `recover-check.mjs`), run on the results afterwards.
- For mesh engines the topology oracle is manifold3d on the *same*
  tessellated leaves. A mesh Boolean can therefore pass a case whose exact
  CSG has a different topology below the deviation (a tool grazing the target
  by 0.005 mm) unless OCCT disagrees and the case is arbitrated (then the
  exact CSG decides, as for `adv3-cyl-plane-shave-tilt-union`). The recover
  stage and the step-2 pre-certificate have to catch those (see the verifier
  defects in "Results").
- Arbitration covers only the disputes present in the prepared suites
  (`arbiter.mjs --check` fails on a new one). A new adversarial case whose
  oracles disagree needs a recipe in `arbiter.mjs` before it can be scored.

## Results

<!-- judge-results: generated by tmp/judge2/write-docs.mjs; edit the template, not this section -->

Judge round 2, 23 September 2026, on the M5 Pro (18 cores, Metal). All
prototype code was unchanged since the teams' final reports. The decision and
the integration plan built on these results are in
`docs/hybrid-boolean-plan.md`.

### Verdict

- **Winner: a hybrid, corefine + recover.** corefine (tagged mesh Boolean)
  decides the topology and recover rebuilds the exact B-rep from the tags.
  The chain gives OCCT-valid exact STEP on **32 of 38** corpus cases on
  corefine's own meshes, the same count as on manifold3d's meshes. The other
  6 are named refusals: 4 missing curve types and the 2 expected tangent
  refusals.
- **exact-plane** stays as an independent differential oracle. It is as
  correct as corefine on the corpus but 2.5x (18 threads) to 5.6x (1 thread) slower, and its input
  quantization creates wrong topology below 2^-24 mm.
- **sdf** is not a Boolean candidate: it returns 47 of 216 adversarial cases
  as `ok` with wrong geometry (lost walls and plates, closed slots and gaps,
  empty results) and refuses r10b. Its field and tape machinery is kept for
  FDM analyses.
- **Not production-safe yet.** Under the 216 adversarial cases corefine still
  returns 18 wrong `ok` answers, and recover returns 15 wrong "exact" STEP
  files on its own suite. Every one reproduces a verifier finding or a new
  judge finding (below). Steps 1-3 of the plan close them, and they come before
  any production dispatch.
- **Metal** does not pay for any prototype. It is slower than 18 CPU threads on
  every prototype (geo-mean corefine 2.40x, recover 2.77x, sdf
  30.94x).

| | corefine | exact-plane | sdf | recover (on corefine meshes) |
|---|---|---|---|---|
| corpus (38) | 36 pass, 2 expected refusals | 36 + 2 | 35 + 2, 1 unresolved (r10b) | 32 exact STEP, 4 named refusals, 2 no source |
| adversarial (216) good / refused / wrong / error | 181 / 17 / 18 / 0 | 170 / 20 / 26 / 0 | 128 / 35 / 47 / 3 | see "Recover" |
| common-set compute, 35 cases, ms js / cpu1 / cpu18 / metal | 30,974 / 6,157 / 4,187 / 6,596 | 114,400 / 34,389 / 10,593 / 25,154 | 178,224 / 33,077 / 7,505 / 97,306 (4 Metal OOM) | recover corpus sum on manifold3d meshes: 4,189 / 1,473 / 1,245 / 4,430 |
| cpu1/cpu18 geo-mean | 1.46 | 3.30 | 3.57 | 1.10 |
| targets byte-identical | all runs | all runs | all runs that finished | all runs |

### How the judge ran

- **Corpus timing.** `tmp/judge2/timing.sh` ran every prototype's full corpus
  sequentially with `run.mjs`: native cpu1, cpu18 (`--threads 18 --gpu off`)
  and metal (`--threads 18 --gpu 1GB`) with `--repeat 5`, then JS with
  `--repeat 3` (median of warm runs after one cold run). recover ran on the
  manifold3d dumps (`--repeat 5`) and on the corefine and exact-plane corpus
  results (`--repeat 3`).
- **Load.** The task said no other agent was running. In fact other agents'
  work (a full `npm test`, corpus probes, viewer tests) overlapped parts of the
  judge's runs. The 1-minute load average at the start of every run is in
  "Run conditions" below. An interleaved re-run on a quiet machine could not be completed because other agents kept the load high, so the timing tables use the sequential run. There the prototypes ran at different times under different load (1-minute load at the start: corefine 15, exact-plane 11, sdf 29 with a 5-minute average of 52, recover 6-20; see "Run conditions"). Absolute times are therefore inflated, and cross-prototype ratios carry that noise; only differences of about 1.5x or more are meaningful.
- **Adversarial.** All 216 cases of the four verifier fixtures
  (`fixtures/bakeoff/adversarial-{corefine,exact-plane,sdf,recover}.json`)
  were built into suites with OCCT and manifold3d oracles
  (`scripts/bakeoff/suite.mjs` → `out/bakeoff/judge2/suites/`). Every mesh
  prototype ran every suite on all four targets
  (`tmp/judge2/adversarial.mjs mesh 6`). recover ran every suite on the
  manifold3d, corefine and exact-plane outputs on all four targets
  (`tmp/judge2/adversarial.mjs recover 4`). These runs used a pool of 6 and 4
  concurrent jobs, so **only their verdicts and byte agreement are used, never
  their timings.**
- **sdf on the adv-recover suite.** The native runner itself (node) ran out of
  heap while scoring sdf's huge mesh for `adv-scale-1e3`, twice. That case is
  counted as `error` from the JS run, and the other 81 cases were completed in
  `native` + `native-rest`.
- **Scoring.** `scripts/bakeoff/judge.mjs` re-scores every stored case with the
  current `run.mjs` scorer, so all reports are judged by the same rules. It
  also adds an "oracles disagree" class. A mismatch against manifold3d, where
  OCCT has the prototype's shell count and manifold3d does not (or manifold3d
  is outside OCCT's area × deviation bound and the prototype inside), is
  counted as a WRONG answer but flagged. These are not arbitrated, because
  OCCT itself is wrong on some of them (next section).
- **Recover grading.** `scripts/bakeoff/judge-recover.mjs` grades every
  recover output:
  - kernel validation;
  - STEP through `src/exporters.mjs`, or the sphere/torus test serializer
    `recover-stepx.mjs` where the body format lacks the surface;
  - `uv run scripts/validate-step.py`;
  - OCCT BRepCheck plus BOPAlgo self-interference;
  - volume and area against the OCCT CSG of the case.

  The logs are in `out/bakeoff/judge2/checks-*.log`.

### Findings beyond the team reports

1. **corefine returns invalid meshes on rotated coplanar input (new,
   critical).** On 4 of the 13 rotated coplanar cases of the exact-plane suite
   (`adv-ep2-rot-coplanar-pocket`, `adv-ep2-sweep-pocket-3`,
   `adv-ep2-sweep-pocket-5`, `adv-ep2-sweep-touch-union-5`), corefine answers
   `ok` with a mesh that the validator's exact predicates find
   self-intersecting (and non-manifold at one vertex in the first case). The
   result is identical on all four targets. corefine's doc states the kernel
   does not test self-intersection; this shows the gap is reachable with
   ordinary CAD input (a rotated block with a flush pocket).
2. **The hybrid propagates point contact (new, critical).** recover accepts
   corefine's invalid point-contact meshes and writes an OCCT-valid B-rep of
   a self-touching solid (`adv-cube-vertex-touch`,
   `adv2-sdf-box-corner-contact`; class `contact-accepted`). On manifold3d
   inputs, which split the vertex, recover refuses the same cases. One
   exact-plane point-contact mesh (`adv-ep2-r1-cube-vertex-gap-1e-9`) becomes
   a STEP that OCCT's BOPAlgo flags as self-intersecting.
3. **recover refuses most rotated coplanar CAD input (coverage gap, safe).**
   On corefine's meshes of the 13 rotated coplanar cases, recover gives exact
   STEP on 2. It refuses the rest ("patches of only 2 distinct carriers
   meet", "parallel planes are adjacent"), or has no source where corefine
   refused. The planes of the two operands agree only to ~1e-13 after the
   rotation, so they are not unified into one carrier class.
4. **OCCT is not a sufficient exact oracle.**
   - On `adv-ep2-rot-sphere-minus-cone`, OCCT's CSG volume (1691.2338560)
     is 1.3e-6 relative off. recover's B-rep from all three mesh sources
     (1691.2316932283516) matches the closed-form volume of revolution
     (1691.2316932283456, `tmp/judge2/closed-form-sphere-cone.mjs`) to 3.5e-15.
     The grade `wrong-geometry` there is an oracle error, and recover is
     right.
   - OCCT's fuzzy tolerance also merges a 1e-9 mm gap
     (`adv-box-union-gap-1e-9`) that is really two solids.
   - manifold3d splits rotated touching unions that OCCT keeps as one.
   - Both oracles therefore need arbitration (plan step 3).
5. **recover's cost follows corefine's triangle count superlinearly.**
   On the 10x10 hole grid recover needs 2,049 ms (cpu1) on corefine's mesh against 277 ms on manifold3d's, 7.4x for about 2x the triangles (corefine keeps split points on straight edges). Over the 32 exact corpus cases recover is 48 % of the hybrid's cpu18 compute.
6. **Metal gives no speed-up.** No prototype's Metal target beats its cpu18 target on any corpus case with at least 20 ms of cpu1 compute (smallest metal/cpu18 ratio 1.04).

### Recover: exact STEP that passes `validate-step.py`

The question the task asked was how many cases become exact STEP that passes
`uv run scripts/validate-step.py`. The answer is the same for all three
inputs (manifold3d dumps, corefine results, exact-plane results): **32 of 38
corpus cases are exact**. They break down as follows:

- **25** go through the production exporter `src/exporters.mjs` and pass
  `validate-step.py` strictly;
- **2** torus results pass strictly through the test serializer
  `recover-stepx.mjs`, because the body format has no torus;
- **4** sphere results pass only through the documented seam/vertex
  refinement rule of `recover-check.mjs`. The test serializer writes no seam,
  and the STEP reader adds one;
- **1** (`self-subtract`) is exactly empty and has no STEP.

In every non-empty exact case the volume matches OCCT's CSG within 1.8e-14
relative and the area within 4.5e-14. There are two exceptions. fine-spheres
is off by 7.8e-10, where OCCT's own sphere fuse is off (the recover team
showed the B-rep matches the closed form to 4e-16). r10b is off by 1.2e-10,
because OCCT fuses the tolerant frozen source bodies.

The other 6 cases:

- 4 are named refusals: the pipe-tee space quartic, two Steinmetz two-carrier
  vertices, and the hex-nut degenerate vertex with its hyperbolas;
- 2 are the tangent cases, which corefine refuses before recover runs ("no
  source"). On manifold3d dumps, recover refuses them itself.

On the adversarial suites the wrong recover outputs are only those the
verifier named, all reproduced:

- 13 wrong geometry and 2 wrong empty results on corefine meshes, from sliver
  absorption and the narrow near-tangency check;
- plus the `contact-accepted` propagation above.

The rest of the non-exact outputs are export-path limits: the kernel
exporter's coordinate limit, and the sphere/torus serializer, which writes no
parameter curves.

### Raw reports

| what | path |
|---|---|
| corpus, native (cpu1, cpu18, metal) | `out/bakeoff/judge2/<corefine,exact-plane,sdf>/corpus-native/report.json` |
| corpus, JS | `out/bakeoff/judge2/<proto>/corpus-js/report.json` |
| recover corpus | `out/bakeoff/judge2/recover/corpus-manifold-{native,js}`, `corpus-from-{corefine,exact-plane}-native` |
| recover grading | `out/bakeoff/judge2/recover/check-*/check.json` (+ STEP files) |
| adversarial suites (jobs, OCCT + manifold3d oracles) | `out/bakeoff/judge2/suites/adv-*` |
| adversarial runs | `out/bakeoff/judge2/<proto>/adv-*/{native,js}/report.json`, sdf also `native-rest`; recover `out/bakeoff/judge2/recover/adv-<suite>-<source>/report.json` |
| judge tables, machine-readable | `out/bakeoff/judge2/results.json`, `results.md` |
| judge scripts | `scripts/bakeoff/judge.mjs`, `scripts/bakeoff/judge-recover.mjs`, `tmp/judge2/*.mjs` / `*.sh` |

To regenerate this section: `node scripts/bakeoff/judge.mjs --judge
out/bakeoff/judge2 && node tmp/judge2/write-docs.mjs`.

The tables below are generated from the reports.

### Corpus leaderboard (38 cases, all four targets)

| prototype | pass | expected refusal | unresolved | invalid | mismatch | error / timeout | exact tier (<= 1e-7 vs manifold3d) | max vol rel err vs manifold3d | max vol err / (OCCT area x dev) | bbox within 2 dev of manifold3d | all 4 targets byte-identical |
|---|---|---|---|---|---|---|---|---|---|---|---|
| corefine | 36 | 2 | 0 | 0 | 0 | 0 | 36 | 3.6e-14 | 0.61 | 35/35 | 38/38 |
| exact-plane | 36 | 2 | 0 | 0 | 0 | 0 | 36 | 5.5e-9 | 0.61 | 35/35 | 38/38 |
| sdf | 35 | 2 | 1 | 0 | 0 | 0 | 11 | 3.5e-3 | 0.12 | 34/34 | 38/38 |

### Corpus by category (pass or expected refusal, out of the category's cases)

| category | cases | corefine | exact-plane | sdf |
|---|---|---|---|---|
| identity | 4 | 4/4 | 4/4 | 4/4 |
| box-basics | 4 | 4/4 | 4/4 | 4/4 |
| coplanar | 2 | 2/2 | 2/2 | 2/2 |
| touching | 2 | 2/2 | 2/2 | 2/2 |
| holes | 8 | 8/8 | 8/8 | 8/8 |
| cylinders | 4 | 4/4 | 4/4 | 4/4 |
| spheres | 3 | 3/3 | 3/3 | 3/3 |
| mechanical | 3 | 3/3 | 3/3 | 3/3 |
| tangent | 2 | 2/2 | 2/2 | 2/2 |
| topology | 2 | 2/2 | 2/2 | 2/2 |
| many-operands | 1 | 1/1 | 1/1 | 1/1 |
| scale | 1 | 1/1 | 1/1 | 1/1 |
| tori | 1 | 1/1 | 1/1 | 1/1 |
| frozen-r10b | 1 | 1/1 | 1/1 | 0/1 (r10b-g10-union: unresolved) |

### Corpus compute time per target (ms, median)

Native source: corefine `corpus-native`, exact-plane `corpus-native`, sdf `corpus-native`, median of the processes per target (`IO.now`, whole ms). Sequential run: the prototypes ran at different times (see Run conditions for their load). JS: median of 3 warm runs after one cold run. cpu18 = `--threads 18 --gpu off`; metal = `--threads 18 --gpu 1GB`. A verdict in brackets means the case did not pass.

| case | corefine js / cpu1 / cpu18 / metal | exact-plane js / cpu1 / cpu18 / metal | sdf js / cpu1 / cpu18 / metal |
|---|---|---|---|
| leaf-cylinder | 0.4 / 0.0 / 0.0 / 0.0 | 105 / 10 / 10 / 57 | 974 / 188 / 57 / 2004 |
| box-union-overlap | 42 / 3.0 / 6.0 / 68 | 55 / 7.0 / 8.0 / 64 | 322 / 72 / 33 / 922 |
| box-subtract-overlap | 37 / 4.0 / 4.0 / 67 | 70 / 8.0 / 8.0 / 65 | 482 / 121 / 47 / 1330 |
| box-intersect-overlap | 26 / 2.0 / 4.0 / 70 | 63 / 6.0 / 8.0 / 65 | 244 / 61 / 29 / 774 |
| box-rotated-intersect | 55 / 6.0 / 5.0 / 69 | 117 / 17 / 19 / 77 | 880 / 177 / 60 / 1732 |
| box-coplanar-union | 28 / 3.0 / 4.0 / 65 | 56 / 6.0 / 7.0 / 60 | 294 / 86 / 35 / 1077 |
| box-coplanar-subtract | 33 / 2.0 / 4.0 / 68 | 39 / 6.0 / 7.0 / 67 | 437 / 120 / 44 / 1142 |
| box-touching-merge | 37 / 2.0 / 4.0 / 86 | 32 / 4.0 / 6.0 / 87 | 248 / 58 / 24 / 1036 |
| box-touching-partial | 29 / 2.0 / 4.0 / 64 | 32 / 4.0 / 5.0 / 76 | 287 / 73 / 31 / 849 |
| plate-through-hole | 199 / 21 / 15 / 82 | 486 / 81 / 39 / 90 | 1516 / 237 / 68 / 2852 |
| plate-blind-hole | 143 / 12 / 11 / 73 | 302 / 43 / 29 / 85 | 1196 / 196 / 70 / 3364 |
| plate-blind-pocket | 29 / 3.0 / 4.0 / 61 | 55 / 5.0 / 7.0 / 61 | 262 / 53 / 20 / 843 |
| plate-counterbore | 569 / 61 / 41 / 108 | 1354 / 304 / 96 / 192 | 2905 / 276 / 71 / 3344 |
| plate-countersink | 859 / 126 / 77 / 163 | 1912 / 398 / 115 / 216 | 2093 / 275 / 73 / 2812 |
| plate-4-holes | 561 / 71 / 41 / 101 | 1477 / 280 / 97 / 153 | 3587 / 2034 / 235 / 10964 |
| plate-hole-grid-10x10 | 10168 / 1818 / 1309 / 1355 | 43432 / 7251 / 2604 / 13242 | 34967 / 12241 / 2214 / error |
| tilted-holes-17deg | 420 / 50 / 28 / 83 | 3026 / 981 / 138 / 282 | 3157 / 507 / 138 / 8302 |
| pipe-tee | 1064 / 116 / 66 / 132 | 7716 / 3244 / 405 / 545 | 8057 / 1230 / 331 / 9302 |
| steinmetz-intersect | 276 / 26 / 14 / 73 | 2165 / 675 / 67 / 195 | 1233 / 707 / 78 / 2521 |
| steinmetz-union | 297 / 48 / 48 / 116 | 2321 / 589 / 86 / 234 | 1594 / 566 / 82 / 1668 |
| coaxial-cylinder-stack | 216 / 34 / 26 / 84 | 1421 / 201 / 52 / 169 | 1137 / 415 / 63 / 1093 |
| sphere-minus-box | 1160 / 243 / 187 / 286 | 3929 / 2885 / 474 / 744 | 717 / 220 / 60 / 1284 |
| sphere-intersect-cylinder | 1308 / 272 / 187 / 293 | 4938 / 2531 / 694 / 827 | 1112 / 288 / 94 / 2104 |
| box-minus-sphere-cavity | 622 / 158 / 125 / 205 | 2403 / 935 / 374 / 550 | 1127 / 366 / 107 / 650 |
| hex-nut | 621 / 95 / 71 / 158 | 5973 / 1697 / 692 / 951 | 17027 / 3381 / 946 / error |
| enclosure-shell | 696 / 155 / 115 / 235 | 4952 / 1725 / 507 / 577 | 54450 / 5206 / 1476 / error |
| gear-48-bore | 331 / 47 / 43 / 98 | 704 / 264 / 147 / 255 | 18648 / 1086 / 302 / 20344 |
| cylinder-tangent-box-face | 55 / 5.0 / 7.0 / 64 (expected-refusal) | 84 / 47 / 15 / 164 (expected-refusal) | 2773 / 302 / 98 / 1241 (expected-refusal) |
| hole-tangent-edge | 130 / 14 / 12 / 81 (expected-refusal) | 333 / 139 / 94 / 211 (expected-refusal) | 1207 / 208 / 63 / 254 (expected-refusal) |
| self-union | 367 / 41 / 27 / 111 | 977 / 459 / 109 / 330 | 1488 / 200 / 61 / 3207 |
| self-subtract | 359 / 29 / 14 / 73 | 1099 / 350 / 95 / 267 | 294 / 71 / 22 / 1180 |
| self-intersect | 569 / 31 / 16 / 81 | 1096 / 429 / 120 / 301 | 1316 / 191 / 46 / 3179 |
| internal-void | 18 / 1.0 / 3.0 / 56 | 13 / 3.0 / 3.0 / 96 | 477 / 95 / 35 / 1494 |
| disjoint-union | 0.7 / 0.0 / 0.0 / 0.0 | 84 / 29 / 13 / 114 | 851 / 120 / 35 / 177 |
| pin-array-chain-20 | 1366 / 157 / 140 / 219 | 2504 / 990 / 400 / 517 | 9944 / 1365 / 324 / error |
| fine-spheres-50k | 7069 / 2094 / 1220 / 1381 | 17088 / 7148 / 2751 / 2990 | 2836 / 464 / 107 / 4223 |
| torus-minus-box | 1399 / 424 / 324 / 412 | 2403 / 824 / 401 / 553 | 2065 / 331 / 87 / 1533 |
| r10b-g10-union | 296 / 50 / 35 / 108 | 424 / 61 / 38 / 98 | 0.0 / 0.0 / 0.0 / 0.0 (unresolved) |

### Parallel speed-up and Metal

Over the cases each prototype passes with cpu1 compute >= 20 ms. `cpu1/cpu18` > 1 means 18 threads are faster; `metal/cpu18` > 1 means Metal is slower than the 18-thread CPU pool.

| prototype | cases | sum js ms | sum cpu1 ms | sum cpu18 ms | sum metal ms | cpu1/cpu18 geo-mean (min-max) | metal/cpu18 geo-mean (min-max) | Metal passes per case | Metal failures (whole corpus) |
|---|---|---|---|---|---|---|---|---|---|
| corefine | 23 | 30792 | 6167 | 4169 | 5957 | 1.46 (1.00-2.07) | 2.40 (1.04-5.47) | 0, 2 | none |
| exact-plane | 25 | 114188 | 34374 | 10543 | 24477 | 3.30 (1.48-10.07) | 2.09 (1.09-8.77) | 1 | none |
| sdf | 35 | 178224 | 33077 | 7505 | 97306 | 3.57 (2.10-9.06) | 30.94 (5.06-69.11) | 0, 1 | plate-hole-grid-10x10 error; hex-nut error; enclosure-shell error; pin-array-chain-20 error |

Common set (the 35 cases every mesh prototype passes), summed compute ms:

| prototype | js | cpu1 | cpu18 | metal |
|---|---|---|---|---|
| corefine | 30974 | 6157 | 4187 | 6596 |
| exact-plane | 114400 | 34389 | 10593 | 25154 |
| sdf | 178224 | 33077 | 7505 | 97306 (4 failed) |

### Adversarial suites (the verifiers' 216 cases, all four targets)

Same runner and scorer as the corpus (`run.mjs --suite`). `invalid` = an `ok` answer whose mesh the validator rejects; `mismatch` = a valid mesh whose topology, volume or bbox disagrees with the oracles (bbox: within 2 x deviation of manifold3d); both are wrong answers. `unresolved` is an explicit refusal (safe). `error` includes Metal out-of-memory at `--gpu 1GB`. The oracle for mesh engines is manifold3d on the same tessellated leaves (topology, volume, bbox) plus OCCT (volume bound).

| suite (cases) | corefine | exact-plane | sdf |
|---|---|---|---|
| adv-corefine (30) | pass 23, invalid 3, expected-refusal 2, unresolved 2 | pass 20, mismatch 3, invalid 3, expected-refusal 2, unresolved 2 | pass 16, mismatch 5, unresolved 3, invalid 3, expected-refusal 2, info 1 |
| adv-exact-plane (44) | pass 25, unresolved 8, invalid 7, expected-refusal 2, mismatch 2 | pass 24, mismatch 8, unresolved 5, invalid 5, expected-refusal 2 | pass 19, mismatch 7, unresolved 7, invalid 6, expected-refusal 4, info 1 |
| adv-sdf (60) | pass 52, expected-refusal 3, unresolved 3, invalid 2 | pass 46, unresolved 8, expected-refusal 3, invalid 2, mismatch 1 | pass 33, mismatch 12, unresolved 7, invalid 3, expected-refusal 3, timeout 2 |
| adv-recover (82) | pass 72, unresolved 4, expected-refusal 2, invalid 2, mismatch 2 | pass 71, unresolved 5, expected-refusal 2, invalid 2, mismatch 2 | pass 48, unresolved 18, mismatch 8, expected-refusal 3, invalid 3, info 1, error 1 |

| prototype | cases | pass + expected refusal | explicit refusal | WRONG (invalid + mismatch) | of which the oracles disagree (OCCT sides with the prototype; below 1e-7 mm, not arbitrated) | error / timeout | targets disagree |
|---|---|---|---|---|---|---|---|
| corefine | 216 | 181 | 17 | 18 | 2 | 0 | 0 |
| exact-plane | 216 | 170 | 20 | 26 | 5 | 0 | 0 |
| sdf | 216 | 128 | 35 | 47 | 4 | 3 | 0 |

Adversarial by category, all suites pooled. Cell = good / explicit refusal / WRONG / error+timeout, where good = pass or expected refusal.

| category | cases | corefine | exact-plane | sdf |
|---|---|---|---|---|
| cone-apex | 2 | 2 / 0 / 0 / 0 | 2 / 0 / 0 / 0 | 0 / 0 / 1 / 1 |
| coplanar | 18 | 9 / 3 / 6 / 0 | 11 / 1 / 6 / 0 | 8 / 3 / 7 / 0 |
| degenerate | 3 | 3 / 0 / 0 / 0 | 3 / 0 / 0 / 0 | 1 / 0 / 2 / 0 |
| disjoint | 6 | 6 / 0 / 0 / 0 | 6 / 0 / 0 / 0 | 5 / 0 / 1 / 0 |
| empty | 14 | 9 / 5 / 0 / 0 | 14 / 0 / 0 / 0 | 14 / 0 / 0 / 0 |
| identity | 2 | 2 / 0 / 0 / 0 | 2 / 0 / 0 / 0 | 2 / 0 / 0 / 0 |
| iterated | 13 | 10 / 3 / 0 / 0 | 11 / 1 / 1 / 0 | 10 / 3 / 0 / 0 |
| multi-scale | 1 | 1 / 0 / 0 / 0 | 1 / 0 / 0 / 0 | 1 / 0 / 0 / 0 |
| near-coincident | 3 | 3 / 0 / 0 / 0 | 3 / 0 / 0 / 0 | 0 / 0 / 3 / 0 |
| near-contact | 4 | 4 / 0 / 0 / 0 | 4 / 0 / 0 / 0 | 2 / 0 / 2 / 0 |
| near-degenerate | 2 | 1 / 1 / 0 / 0 | 1 / 1 / 0 / 0 | 0 / 2 / 0 / 0 |
| near-parallel | 1 | 1 / 0 / 0 / 0 | 1 / 0 / 0 / 0 | 0 / 1 / 0 / 0 |
| perturbation | 24 | 21 / 3 / 0 / 0 | 17 / 4 / 3 / 0 | 17 / 3 / 4 / 0 |
| rotation | 21 | 19 / 2 / 0 / 0 | 20 / 1 / 0 / 0 | 6 / 13 / 2 / 0 |
| scale | 21 | 21 / 0 / 0 / 0 | 9 / 12 / 0 / 0 | 17 / 2 / 0 / 2 |
| sliver | 19 | 19 / 0 / 0 / 0 | 15 / 0 / 4 / 0 | 5 / 3 / 11 / 0 |
| sphere-cap | 2 | 2 / 0 / 0 / 0 | 2 / 0 / 0 / 0 | 1 / 0 / 1 / 0 |
| tangent | 20 | 10 / 0 / 10 / 0 | 10 / 0 / 10 / 0 | 13 / 0 / 4 / 0 |
| thin | 12 | 12 / 0 / 0 / 0 | 12 / 0 / 0 / 0 | 6 / 2 / 4 / 0 |
| thin-gap | 1 | 1 / 0 / 0 / 0 | 1 / 0 / 0 / 0 | 0 / 0 / 1 / 0 |
| thin-wall | 2 | 2 / 0 / 0 / 0 | 2 / 0 / 0 / 0 | 1 / 0 / 1 / 0 |
| tolerance-topology | 17 | 15 / 0 / 2 / 0 | 15 / 0 / 2 / 0 | 12 / 2 / 3 / 0 |
| topology | 3 | 3 / 0 / 0 / 0 | 3 / 0 / 0 / 0 | 3 / 0 / 0 / 0 |
| unsupported-curve | 1 | 1 / 0 / 0 / 0 | 1 / 0 / 0 / 0 | 1 / 0 / 0 / 0 |
| void | 4 | 4 / 0 / 0 / 0 | 4 / 0 / 0 / 0 | 3 / 1 / 0 / 0 |

#### Verifier defects: current status (this run)

Every case a verifier named, re-run on all four targets with the unchanged prototype code. "reproduced" = the case still gives the defect's wrong or unsafe outcome.

Later (23 September 2026, after plan steps 1-4): the hybrid gate verifier found two more defects, both fixed the same night (`docs/hybrid-boolean-plan.md`, status lines of steps 3 and 4; raw reports `out/bakeoff/fix1/`). (1) Step 4's carrier unification merged exactly representable axis-aligned planes: a sealed void under a 2e-11 mm skin came back from corefine as an opened pocket and recover wrote an exact B-rep of it. `kernel/proto/unify.bend` no longer unifies two exactly axis-aligned carriers; regression cases `adv-skin-void-2e-11` and `adv-skin-void-5e-10-at-1000` (adv-corefine, now 32 cases) pass on all four targets, every other corefine and recover result is byte-identical to the step-4 run. (2) The recover grader compared only with OCCT's fuzzy CSG, so that wrong B-rep was graded `exact`; disputed cases are now graded against the arbiter, and unarbitrated ones are never `exact` (section "Oracle arbitration"). Re-grading the stored runs turns one more such grade from `exact` into `mismatch`: recover on exact-plane's mesh of `adv-box-union-gap-1e-9`, whose 1e-9 mm gap exact-plane's quantization closes.

Later still (24 September 2026, hybrid gate verifier #2): three more defects, all fixed that night (`docs/hybrid-boolean-plan.md`, status lines of steps 2 and 4; raw reports `out/bakeoff/fix2/`). (1) The step-4 tolerance 2^-40·scale merged real 1e-11 mm skins over sealed voids on a tilted prism face (not axis-aligned; a regression against HEAD) and (2) on a rotated block, about 1000 times the rounding it is meant to absorb; corefine opened the voids and recover wrote the opened pockets with a `unified` record. The tolerance is now 2^-44·scale (normals 2^-44), a bound of the F32x2 rounding of one rigid transform with a margin; both cases keep 2 shells (byte-identical to the HEAD kernel), regression cases `adv-skin-void-prism-tilted-1e-11` and `adv-skin-void-rot-1e-11` (adv-corefine, now 34 cases, both arbitrated `manifold`). (3) recover's pre-certificate trusted a (plane, cylinder) pair whose leaf tessellations cross only where a third operand removed them, and wrote an exact plain cylinder segment where the exact result keeps a flat strip; a second, result-against-leaf join now refuses it by name. Regression case `adv-graze-crossing-removed` plus the control `adv-transversal-crossing-removed` (adv-recover, now 84 cases). Every other corefine and recover result is byte-identical to fix 1 except the tolerance texts of step 4 (refusal suffix, `unified` record) and `r10b-g10-union`, whose recover output is the judge round's again.

| prototype | severity | defect | case: verdict (this run) |
|---|---|---|---|
| corefine | critical | point contact returned ok with a non-manifold vertex | adv-cube-vertex-touch: invalid<br>adv-sphere-point-touch-box: invalid<br>adv-cone-apex-on-face: invalid |
| corefine | major | near-coincident sphere union: slow refusal (JS over the timeout) | adv-perturb-sphere-rot-1e-6deg: unresolved ("face triangulation failed (no valid ear or hole br") |
| corefine | minor | zero-volume face-touch intersection refused instead of empty | adv-empty-intersect-face-touch: unresolved ("weld of coincident or nearly coincident output ver") |
| exact-plane | critical | point contact returned ok (edge-only self-check) | adv-ep2-sphere-sphere-pole-touch: invalid<br>adv-ep2-sphere-inscribed-in-cube: invalid<br>adv-ep2-r1-cone-apex-on-face: invalid<br>adv-ep2-sphere-gap-1e-9-box: invalid<br>adv-ep2-r1-cube-vertex-gap-1e-9: invalid |
| exact-plane | critical | rotated coplanar pocket sealed into a void by input quantization | adv-ep2-rot-coplanar-pocket: mismatch<br>adv-ep2-sweep-pocket-0: mismatch<br>adv-ep2-sweep-pocket-1: unresolved ("exact-plane: non-manifold contact: the exact regul") |
| exact-plane | major | Metal out of memory at --gpu 1GB | adv-ep2-rot-sphere-minus-cone: pass [metal error] |
| exact-plane | minor | sub-micron skins: volume off by the quantization | adv-ep2-skin-5e-7: mismatch<br>adv-ep2-r1-skin-1e-7: mismatch |
| exact-plane | minor | quantization-made contact refused with a reason blaming the exact result | adv-ep2-cube-edge-overlap-1e-9: unresolved ("exact-plane: non-manifold contact: the exact regul") |
| sdf | critical | thin solid features below the cell vanish, returned ok | adv2-sdf-enclosure-wall-1.2: mismatch<br>adv-sdf-large-plate-rib-1.2: mismatch<br>adv-sdf-membrane-0.3: mismatch<br>adv-sdf-large-membrane-0.6: mismatch<br>adv-sdf-rib-0.1: mismatch<br>adv2-sdf-sliver-wedge-blade: mismatch |
| sdf | critical | thin gaps and slots close, returned ok | adv2-sdf-slot-0.4: mismatch<br>adv-sdf-gap-0.02: mismatch<br>adv-sdf-large-gap-0.5: mismatch |
| sdf | critical | small parts in a large extent come back empty | adv2-sdf-far-small-cubes: mismatch |
| sdf | critical | pointed cone leaf gives h = 0 and an empty ok | adv-sdf-cone-apex-leaf: mismatch |
| sdf | critical | invalid meshes returned ok (orientation, point contact) | adv-sdf-pipe-tee-rot: invalid [metal error]<br>adv-sdf-box-edge-contact: invalid<br>adv2-sdf-box-corner-contact: invalid |
| sdf | critical | needle-thin hole dropped | adv-sdf-needle-hole: mismatch [metal error, js timeout] |
| sdf | major | global cell size: timeouts on tiny radii / apex in material | adv-sdf-drill-point-hole: timeout [cpu1 timeout, cpuN timeout, metal error, js timeout]<br>adv-sdf-big-cyl-tiny-pin: timeout [cpu1 timeout, cpuN timeout, metal error, js timeout] |
| recover | critical | sliver absorption deletes real planar faces | adv4-planar-chip-dev0.1: manifold mismatch, vol 1.5e-5, area 2.1e-4; corefine mismatch, vol 1.5e-5, area 2.1e-4<br>adv4-planar-chip-dev0.01-1mm: manifold mismatch, vol 1.4e-7, area 9.5e-6; corefine mismatch, vol 1.4e-7, area 9.5e-6<br>adv4-planar-corner-bump: manifold mismatch, vol 1.4e-5, area 2.0e-4; corefine mismatch, vol 1.4e-5, area 2.0e-4<br>adv4-planar-corner-bump-rotated: manifold mismatch, vol 1.4e-5, area 2.0e-4; corefine mismatch, vol 1.4e-5, area 2.0e-4 |
| recover | critical | cone tips absorbed as slivers | adv4-cone-tip-dimple: manifold mismatch, vol 2.7e-4, area 3.3e-5; corefine mismatch, vol 2.7e-4, area 3.3e-5<br>adv4-cone-tip-bump-rotated: manifold mismatch, vol 2.7e-4, area 3.3e-5; corefine mismatch, vol 2.7e-4, area 3.3e-5 |
| recover | critical | near-tangency pre-check bypassed (tilt, crossed cylinders, cones, tori) | adv4-cyl-shave-tilt-1e-8rad: manifold mismatch, vol 1.9e-5, area 7.6e-6; corefine mismatch, vol 1.9e-5, area 7.6e-6<br>adv3-cyl-plane-shave-tilt-1e-5rad: manifold mismatch, vol 1.8e-5, area 7.4e-6; corefine mismatch, vol 1.8e-5, area 7.4e-6<br>adv3-cyl-plane-shave-tilt-intersect: manifold invalid; corefine invalid<br>adv3-cyl-cyl-graze-tilt-1e-5rad: manifold mismatch, vol 1.3e-5, area 2.5e-6; corefine mismatch, vol 1.3e-5, area 2.5e-6<br>adv3-crossed-cyl-graze: manifold mismatch, vol 4.5e-6, area 2.2e-8; corefine mismatch, vol 4.5e-6, area 2.2e-8<br>adv3-torus-top-shave: manifold mismatch, vol 3.5e-5, area 8.7e-6; corefine mismatch, vol 3.5e-5, area 8.7e-6<br>adv3-torus-top-cap-intersect: manifold invalid; corefine invalid<br>adv3-cone-side-shave: manifold mismatch, vol 1.4e-5, area 5.4e-6; corefine mismatch, vol 1.4e-5, area 5.4e-6<br>adv3-cone-side-shave-rotated: manifold mismatch, vol 1.4e-5, area 5.4e-6; corefine mismatch, vol 1.4e-5, area 5.4e-6 |
| recover | minor | recovered B-rep at 1e5 mm not exportable by the kernel exporter | adv4-far-plate-hole: manifold invalid; corefine invalid |

<details><summary>corefine: 18 wrong, failed or target-disagreeing adversarial answers</summary>

| suite | case | expect | verdict | detail |
|---|---|---|---|---|
| adv-corefine | adv-sphere-point-touch-box | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-corefine | adv-cube-vertex-touch | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-corefine | adv-cone-apex-on-face | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-exact-plane | adv-ep2-rot-coplanar-pocket | solid | invalid | validator: non-manifold-vertex, self-intersection |
| adv-exact-plane | adv-ep2-sphere-sphere-pole-touch | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-exact-plane | adv-ep2-sphere-inscribed-in-cube | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-exact-plane | adv-ep2-r1-cone-apex-on-face | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-exact-plane | adv-ep2-sweep-pocket-3 | solid | invalid | validator: self-intersection |
| adv-exact-plane | adv-ep2-sweep-touch-union-3 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 8.1e-16, vs OCCT 1.1e-12 / bound 7.0e+0, bbox err 0, tris 28; OCCT SIDES WITH THE PROTOTYPE |
| adv-exact-plane | adv-ep2-sweep-pocket-4 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 2.7e-16, vs OCCT 1.8e-12 / bound 1.8e+1, bbox err 0, tris 30; OCCT SIDES WITH THE PROTOTYPE |
| adv-exact-plane | adv-ep2-sweep-pocket-5 | solid | invalid | validator: self-intersection |
| adv-exact-plane | adv-ep2-sweep-touch-union-5 | solid | invalid | validator: self-intersection |
| adv-sdf | adv-sdf-sphere-point-contact | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-sdf | adv2-sdf-box-corner-contact | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-recover | adv2-two-spheres-tangent | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-recover | adv3-cyl-plane-shave-tilt-intersect | solid | mismatch | comps 0 (= manifold3d), chi =, vol rel 0, vs OCCT 2.9e-2 / bound 1.8e-1, bbox err -, tris 0 |
| adv-recover | adv3-torus-top-cap-intersect | solid | mismatch | comps 0 (= manifold3d), chi =, vol rel 0, vs OCCT 2.8e-2 / bound 2.8e-1, bbox err -, tris 0 |
| adv-recover | adv4-cone-apex-point-contact | non-manifold-contact | invalid | validator: non-manifold-vertex |

</details>

<details><summary>exact-plane: 26 wrong, failed or target-disagreeing adversarial answers</summary>

| suite | case | expect | verdict | detail |
|---|---|---|---|---|
| adv-corefine | adv-box-union-gap-1e-9 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 2.6e-11, vs OCCT 2.4e-8 / bound 8.4e+0, bbox err 0, tris 32; OCCT SIDES WITH THE PROTOTYPE |
| adv-corefine | adv-slab-sliver-1e-7 | solid | mismatch | comps 1 (= manifold3d), chi =, vol rel 1.9e-1, vs OCCT 4.8e-5 / bound 0, bbox err 1.9e-8, tris 22 |
| adv-corefine | adv-sphere-point-touch-box | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-corefine | adv-cube-vertex-touch | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-corefine | adv-cone-apex-on-face | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-corefine | adv-thin-spherical-shell-1e-6 | solid | mismatch | comps 2 (= manifold3d), chi =, vol rel 7.7e-4, vs OCCT 4.2e+3 / bound 6.3e+1, bbox err 0, tris 4416 |
| adv-exact-plane | adv-ep2-skin-5e-7 | solid | mismatch | comps 1 (= manifold3d), chi =, vol rel 4.6e-2, vs OCCT 1.9e-4 / bound 0, bbox err 2.3e-8, tris 22 |
| adv-exact-plane | adv-ep2-sphere-gap-1e-9-box | solid | invalid | validator: non-manifold-vertex |
| adv-exact-plane | adv-ep2-rot-coplanar-pocket | solid | mismatch | comps 2 (!= manifold3d), chi !=, vol rel 3.9e-10, vs OCCT 1.3e-6 / bound 1.8e+1, bbox err 2.5e-8, tris 24 |
| adv-exact-plane | adv-ep2-sphere-sphere-pole-touch | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-exact-plane | adv-ep2-sphere-inscribed-in-cube | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-exact-plane | adv-ep2-iterated-sub-add-sub | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 9.0e-11, vs OCCT 6.5e-1 / bound 1.4e+1, bbox err 2.3e-8, tris 1732; OCCT SIDES WITH THE PROTOTYPE |
| adv-exact-plane | adv-ep2-r1-cube-vertex-gap-1e-9 | solid | invalid | validator: non-manifold-vertex |
| adv-exact-plane | adv-ep2-r1-skin-1e-7 | solid | mismatch | comps 1 (= manifold3d), chi =, vol rel 1.9e-1, vs OCCT 4.8e-5 / bound 0, bbox err 1.9e-8, tris 22 |
| adv-exact-plane | adv-ep2-r1-cone-apex-on-face | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-exact-plane | adv-ep2-sweep-pocket-0 | solid | mismatch | comps 2 (!= manifold3d), chi !=, vol rel 8.4e-10, vs OCCT 2.9e-6 / bound 1.8e+1, bbox err 2.2e-8, tris 24 |
| adv-exact-plane | adv-ep2-sweep-touch-union-1 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 2.2e-9, vs OCCT 2.4e-6 / bound 7.0e+0, bbox err 3.0e-8, tris 74; OCCT SIDES WITH THE PROTOTYPE |
| adv-exact-plane | adv-ep2-sweep-touch-union-3 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 2.5e-9, vs OCCT 2.8e-6 / bound 7.0e+0, bbox err 2.2e-8, tris 64; OCCT SIDES WITH THE PROTOTYPE |
| adv-exact-plane | adv-ep2-sweep-pocket-4 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 1.9e-9, vs OCCT 6.5e-6 / bound 1.8e+1, bbox err 2.9e-8, tris 66; OCCT SIDES WITH THE PROTOTYPE |
| adv-sdf | adv-sdf-sphere-point-contact | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-sdf | adv2-sdf-flush-pocket-rot | solid | mismatch | comps 1 (= manifold3d), chi !=, vol rel 7.8e-10, vs OCCT 3.7e-6 / bound 2.6e+1, bbox err 2.7e-8, tris 78 |
| adv-sdf | adv2-sdf-box-corner-contact | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-recover | adv2-two-spheres-tangent | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-recover | adv3-cyl-plane-shave-tilt-intersect | solid | mismatch | comps 0 (= manifold3d), chi =, vol rel 0, vs OCCT 2.9e-2 / bound 1.8e-1, bbox err -, tris 0 |
| adv-recover | adv3-torus-top-cap-intersect | solid | mismatch | comps 0 (= manifold3d), chi =, vol rel 0, vs OCCT 2.8e-2 / bound 2.8e-1, bbox err -, tris 0 |
| adv-recover | adv4-cone-apex-point-contact | non-manifold-contact | invalid | validator: non-manifold-vertex |

</details>

<details><summary>sdf: 53 wrong, failed or target-disagreeing adversarial answers</summary>

| suite | case | expect | verdict | detail |
|---|---|---|---|---|
| adv-corefine | adv-box-union-gap-1e-9 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 2.6e-11, vs OCCT 2.4e-8 / bound 8.4e+0, bbox err 0, tris 13690; OCCT SIDES WITH THE PROTOTYPE |
| adv-corefine | adv-slab-sliver-1e-7 | solid | mismatch | comps 0 (!= manifold3d), chi !=, vol rel 1.0e+0, vs OCCT 0 / bound 0, bbox err -, tris 0 |
| adv-corefine | adv-cavity-skin-1e-6 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 1.5e-8, vs OCCT 1.0e-4 / bound 3.2e+1, bbox err 0, tris 33744 |
| adv-corefine | adv-rotated-coplanar-overlap | solid | invalid | validator: orientation, self-intersection |
| adv-corefine | adv-cube-vertex-touch | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-corefine | adv-cube-edge-touch | non-manifold-contact | invalid | validator: orientation |
| adv-corefine | adv-cone-apex-on-face | non-manifold-contact | info | valid mesh for a contact case |
| adv-corefine | adv-needle-prism-slit | solid | mismatch | comps 1 (= manifold3d), chi !=, vol rel 2.5e-8, vs OCCT 5.0e-5 / bound 1.3e+1, bbox err 0, tris 17130 |
| adv-corefine | adv-thin-spherical-shell-1e-6 | solid | mismatch | comps 0 (!= manifold3d), chi !=, vol rel 1.0e+0, vs OCCT 4.2e+3 / bound 6.3e+1, bbox err -, tris 0 |
| adv-exact-plane | adv-ep2-skin-5e-7 | solid | mismatch | comps 0 (!= manifold3d), chi !=, vol rel 1.0e+0, vs OCCT 0 / bound 0, bbox err -, tris 0 |
| adv-exact-plane | adv-ep2-rot-skin-1e-6 | solid | mismatch | comps 0 (!= manifold3d), chi !=, vol rel 1.0e+0, vs OCCT 4.0e-4 / bound 8.0e+0, bbox err -, tris 0 |
| adv-exact-plane | adv-ep2-cube-corner-overlap-1e-7 | solid | invalid | validator: non-manifold-vertex |
| adv-exact-plane | adv-ep2-cube-edge-overlap-1e-9 | solid | invalid | validator: orientation |
| adv-exact-plane | adv-ep2-needle-prism-cross | solid | mismatch | comps 1 (= manifold3d), chi !=, vol rel 4.5e-7, vs OCCT 5.4e-4 / bound 1.3e+1, bbox err 0, tris 16608 |
| adv-exact-plane | adv-ep2-r1-cube-vertex-gap-1e-9 | solid | invalid | validator: non-manifold-vertex |
| adv-exact-plane | adv-ep2-r1-skin-1e-7 | solid | mismatch | comps 0 (!= manifold3d), chi !=, vol rel 1.0e+0, vs OCCT 0 / bound 0, bbox err -, tris 0 |
| adv-exact-plane | adv-ep2-r1-cone-apex-on-face | non-manifold-contact | info | valid mesh for a contact case |
| adv-exact-plane | adv-ep2-sweep-pocket-1 | solid | invalid | validator: orientation, self-intersection |
| adv-exact-plane | adv-ep2-sweep-touch-union-1 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 1.5e-8, vs OCCT 1.7e-5 / bound 7.0e+0, bbox err 4.5e-7, tris 25860; OCCT SIDES WITH THE PROTOTYPE |
| adv-exact-plane | adv-ep2-sweep-pocket-2 | solid | invalid | validator: self-intersection |
| adv-exact-plane | adv-ep2-sweep-touch-union-3 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 2.6e-8, vs OCCT 3.0e-5 / bound 7.0e+0, bbox err 5.9e-7, tris 22776; OCCT SIDES WITH THE PROTOTYPE |
| adv-exact-plane | adv-ep2-sweep-pocket-4 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 5.0e-8, vs OCCT 1.7e-4 / bound 1.8e+1, bbox err 8.9e-7, tris 23978; OCCT SIDES WITH THE PROTOTYPE |
| adv-exact-plane | adv-ep2-sweep-touch-union-4 | solid | invalid | validator: self-intersection |
| adv-sdf | adv-sdf-pipe-tee-rot | solid | invalid | validator: orientation, self-intersection; metal error: bend: out of memory: run again with a bigger span, as in --g |
| adv-sdf | adv-sdf-box-edge-contact | non-manifold-contact | invalid | validator: orientation |
| adv-sdf | adv-sdf-gap-0.02 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 5.0e-4, vs OCCT 4.0e+0 / bound 3.2e+1, bbox err 0, tris 11582 |
| adv-sdf | adv-sdf-rib-0.1 | solid | mismatch | comps 1 (= manifold3d), chi =, vol rel 8.3e-3, vs OCCT 4.0e+1 / bound 6.0e+1, bbox err 1.0e+1 (off), tris 11864 |
| adv-sdf | adv-sdf-membrane-0.3 | solid | mismatch | comps 1 (= manifold3d), chi !=, vol rel 9.9e-3, vs OCCT 6.0e+1 / bound 3.4e+1, bbox err 0, tris 14376 |
| adv-sdf | adv-sdf-big-cyl-tiny-pin | solid | timeout | cpu1 timeout; cpuN timeout; metal error: bend: out of memory: run again with a bigger span, as in --g; js timeout |
| adv-sdf | adv-sdf-cone-apex-leaf | solid | mismatch | comps 0 (!= manifold3d), chi !=, vol rel 1.0e+0, vs OCCT 2.6e+2 / bound 2.5e+0, bbox err -, tris 0 |
| adv-sdf | adv-sdf-drill-point-hole | solid | timeout | cpu1 timeout; cpuN timeout; metal error: bend: out of memory: run again with a bigger span, as in --g; js timeout |
| adv-sdf | adv-sdf-needle-hole | solid | mismatch | comps 1 (= manifold3d), chi !=, vol rel 2.8e-8, vs OCCT 9.4e-6 / bound 3.2e+0, bbox err 0, tris 1028796; metal error: bend: out of memory: run again with a bigger span, as in --g; js timeout |
| adv-sdf | adv-sdf-large-plate-rib-1.2 | solid | mismatch | comps 1 (= manifold3d), chi =, vol rel 9.6e-1, vs OCCT 8.9e+4 / bound 6.8e+2, bbox err 1.0e+2 (off), tris 1564 |
| adv-sdf | adv-sdf-large-membrane-0.6 | solid | mismatch | comps 1 (= manifold3d), chi !=, vol rel 4.1e-2, vs OCCT 1.1e+4 / bound 8.4e+2, bbox err 0, tris 9900 |
| adv-sdf | adv-sdf-large-gap-0.5 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 2.5e-3, vs OCCT 1.5e+3 / bound 8.0e+2, bbox err 0, tris 12816 |
| adv-sdf | adv2-sdf-enclosure-wall-1.2 | solid | mismatch | comps 1 (= manifold3d), chi =, vol rel 2.1e-1, vs OCCT 4.5e+3 / bound 3.7e+2, bbox err 0, tris 24036 |
| adv-sdf | adv2-sdf-far-small-cubes | solid | mismatch | comps 0 (!= manifold3d), chi !=, vol rel 1.0e+0, vs OCCT 2.5e+2 / bound 3.0e+0, bbox err -, tris 0 |
| adv-sdf | adv2-sdf-sliver-wedge-blade | solid | mismatch | comps 1 (= manifold3d), chi =, vol rel 7.9e-3, vs OCCT 8.0e+0 / bound 1.4e+1, bbox err 4.0e+1 (off), tris 2016 |
| adv-sdf | adv2-sdf-box-corner-contact | non-manifold-contact | invalid | validator: non-manifold-vertex |
| adv-sdf | adv2-sdf-slot-0.4 | solid | mismatch | comps 1 (= manifold3d), chi !=, vol rel 3.3e-3, vs OCCT 4.0e+1 / bound 6.0e+1, bbox err 0, tris 11228 |
| adv-recover | adv-thin-tube-1um | solid | mismatch | comps 0 (!= manifold3d), chi =, vol rel 1.0e+0, vs OCCT 3.1e-4 / bound 6.3e+0, bbox err -, tris 0 |
| adv-recover | adv-countersink-rotated | solid | invalid | validator: self-intersection |
| adv-recover | adv2-void-wall-1um | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 1.5e-8, vs OCCT 1.0e-4 / bound 3.2e+1, bbox err 0, tris 33744 |
| adv-recover | adv2-dome-on-box | solid | invalid | validator: self-intersection |
| adv-recover | adv3-cyl-plane-shave-tilt-intersect | solid | mismatch | comps 0 (= manifold3d), chi =, vol rel 0, vs OCCT 2.9e-2 / bound 1.8e-1, bbox err -, tris 0 |
| adv-recover | adv3-torus-top-cap-intersect | solid | mismatch | comps 0 (= manifold3d), chi =, vol rel 0, vs OCCT 2.8e-2 / bound 2.8e-1, bbox err -, tris 0 |
| adv-recover | adv3-void-wall-3e-6 | solid | mismatch | comps 1 (!= manifold3d), chi !=, vol rel 1.5e-7, vs OCCT 1.1e-4 / bound 8.6e+0, bbox err 0, tris 36048 |
| adv-recover | adv4-planar-corner-bump | solid | invalid | validator: self-intersection |
| adv-recover | adv4-cone-tip-dimple | solid | mismatch | comps 0 (!= manifold3d), chi !=, vol rel 1.0e+0, vs OCCT 3.6e+1 / bound 4.8e+0, bbox err -, tris 0 |
| adv-recover | adv4-cone-tip-bump-rotated | solid | mismatch | comps 0 (!= manifold3d), chi !=, vol rel 1.0e+0, vs OCCT 3.6e+1 / bound 4.8e+0, bbox err -, tris 0 |
| adv-recover | adv4-cone-apex-point-contact | non-manifold-contact | info | valid mesh for a contact case |
| adv-recover | adv4-ball-in-cone-seat-gap | solid | mismatch | comps 0 (!= manifold3d), chi !=, vol rel 1.0e+0, vs OCCT 1.1e+3 / bound 9.2e+0, bbox err -, tris 0 |
| adv-recover | adv-scale-1e3 | solid | error | native error: native runner crashed (node heap out of memory while scoring; js error: 68: 0x183dd44e4 start [/usr/lib/dyld] |

</details>

### Recover: exact B-rep / STEP from tagged meshes

`exact` = OCCT BRepCheck-valid (exact CurveOnSurface), free of self-interference, same solid count, volume and area within 1e-7 relative of the OCCT CSG (an empty result counts when the case expects empty). `strict validate-step` = exact and `uv run scripts/validate-step.py` accepts the STEP as written; the rest pass it only through recover-check's documented seam/vertex refinement rule.

| input meshes | cases | exact | of which strict validate-step | exact via refinement rule | unresolved (named) | expected refusal | wrong | no source (mesh engine refused) |
|---|---|---|---|---|---|---|---|---|
| adv-corefine-corefine | 30 | 13 | 10 | 1 | 9 | 2 | 2 (invalid 1, contact-accepted 1) | 4 |
| adv-corefine-exact-plane | 30 | 15 | 11 | 1 | 8 | 2 | 1 (contact-accepted 1) | 4 |
| adv-corefine-manifold | 30 | 14 | 10 | 1 | 9 | 5 | 2 (invalid 1, invalid-step 1) | 0 |
| adv-exact-plane-corefine | 44 | 11 | 11 | 0 | 18 | 3 | 2 (mismatch 1, valid-sampled 1) | 10 |
| adv-exact-plane-exact-plane | 44 | 11 | 9 | 0 | 20 | 3 | 3 (mismatch 1, invalid-interference 1, valid-sampled 1) | 7 |
| adv-exact-plane-manifold | 44 | 12 | 11 | 0 | 25 | 5 | 2 (mismatch 1, valid-sampled 1) | 0 |
| adv-recover-corefine | 82 | 30 | 22 | 4 | 21 | 2 | 23 (mismatch 14, invalid 5, invalid-step 3, valid-sampled 1) | 6 |
| adv-recover-exact-plane | 82 | 31 | 22 | 4 | 23 | 2 | 19 (mismatch 13, invalid 2, invalid-step 3, valid-sampled 1) | 7 |
| adv-recover-manifold | 82 | 30 | 20 | 5 | 25 | 4 | 23 (mismatch 14, invalid 5, invalid-step 3, valid-sampled 1) | 0 |
| adv-sdf-corefine | 60 | 37 | 33 | 0 | 10 | 1 | 6 (invalid 2, invalid-step 2, contact-accepted 1, valid-sampled 1) | 6 |
| adv-sdf-exact-plane | 60 | 35 | 30 | 0 | 10 | 1 | 3 (invalid-step 2, contact-accepted 1) | 11 |
| adv-sdf-manifold | 60 | 36 | 31 | 0 | 14 | 5 | 5 (invalid 2, invalid-step 2, valid-sampled 1) | 0 |
| corpus-from-corefine | 38 | 32 | 27 | 4 | 4 | 0 | 0 | 2 |
| corpus-from-exact-plane | 38 | 32 | 27 | 4 | 4 | 0 | 0 | 2 |
| corpus-manifold | 38 | 32 | 27 | 4 | 4 | 2 | 0 | 0 |

Why the non-exact, non-refused recover outputs fail (classes: `wrong-geometry` = OCCT-valid exact STEP of a solid whose volume or area differs from the exact CSG; `wrong-empty` = empty output where the exact CSG is not empty; `contact-accepted` = B-rep of a result that touches itself; the two `export` classes are STEP-path limits, not wrong B-reps):

| input meshes | wrong-geometry | wrong-empty | contact-accepted | export: kernel exporter coordinate limit | export: sphere/torus test serializer (no pcurves / seam count) |
|---|---|---|---|---|---|
| adv-corefine-corefine | 0 | 0 | 1 | 1 | 0 |
| adv-corefine-exact-plane | 0 | 0 | 1 | 0 | 0 |
| adv-corefine-manifold | 0 | 0 | 0 | 1 | 1 |
| adv-exact-plane-corefine | 1 | 0 | 0 | 0 | 0 |
| adv-exact-plane-exact-plane | 1 | 0 | 0 | 0 | 0 |
| adv-exact-plane-manifold | 1 | 0 | 0 | 0 | 0 |
| adv-recover-corefine | 13 | 2 | 0 | 3 | 5 |
| adv-recover-exact-plane | 12 | 2 | 0 | 0 | 5 |
| adv-recover-manifold | 13 | 2 | 0 | 3 | 5 |
| adv-sdf-corefine | 0 | 0 | 1 | 2 | 3 |
| adv-sdf-exact-plane | 0 | 0 | 1 | 0 | 2 |
| adv-sdf-manifold | 0 | 0 | 0 | 2 | 3 |
| corpus-from-corefine | 0 | 0 | 0 | 0 | 0 |
| corpus-from-exact-plane | 0 | 0 | 0 | 0 | 0 |
| corpus-manifold | 0 | 0 | 0 | 0 | 0 |

<details><summary>recover adv-corefine-corefine: 2 wrong answers</summary>

| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |
|---|---|---|---|---|---|---|
| adv-cube-vertex-touch | contact-accepted | contact-accepted | 5.7e-16 | 1.9e-16 | true |  |
| adv-scale-1e3-plate-hole | invalid | export: kernel exporter coordinate limit | - | - | - | STEP cylindrical parameter curves unresolved: InvalidSource |

</details>

<details><summary>recover adv-corefine-exact-plane: 1 wrong answers</summary>

| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |
|---|---|---|---|---|---|---|
| adv-cube-vertex-touch | contact-accepted | contact-accepted | 5.7e-16 | 1.9e-16 | true |  |

</details>

<details><summary>recover adv-corefine-manifold: 2 wrong answers</summary>

| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |
|---|---|---|---|---|---|---|
| adv-scale-1e3-plate-hole | invalid | export: kernel exporter coordinate limit | - | - | - | STEP cylindrical parameter curves unresolved: InvalidSource |
| adv-perturb-sphere-rot-1e-6deg | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 4.2e-16 | 4.2e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-corefine-man |

</details>

<details><summary>recover adv-exact-plane-corefine: 2 wrong answers</summary>

| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |
|---|---|---|---|---|---|---|
| adv-ep2-rot-box-minus-tilted-cyl | valid-sampled | valid-sampled | 9.1e-8 | 1.1e-7 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-exact-plane- |
| adv-ep2-rot-sphere-minus-cone | mismatch | wrong-geometry | 1.3e-6 | 8.8e-7 | true |  |

</details>

<details><summary>recover adv-exact-plane-exact-plane: 3 wrong answers</summary>

| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |
|---|---|---|---|---|---|---|
| adv-ep2-rot-box-minus-tilted-cyl | valid-sampled | valid-sampled | 9.2e-8 | 1.1e-7 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-exact-plane- |
| adv-ep2-rot-sphere-minus-cone | mismatch | wrong-geometry | 1.3e-6 | 8.8e-7 | true |  |
| adv-ep2-r1-cube-vertex-gap-1e-9 | invalid-interference | invalid-interference | 1.5e-10 | 1.0e-10 | true |  |

</details>

<details><summary>recover adv-exact-plane-manifold: 2 wrong answers</summary>

| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |
|---|---|---|---|---|---|---|
| adv-ep2-rot-box-minus-tilted-cyl | valid-sampled | valid-sampled | 9.1e-8 | 1.1e-7 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-exact-plane- |
| adv-ep2-rot-sphere-minus-cone | mismatch | wrong-geometry | 1.3e-6 | 8.8e-7 | true |  |

</details>

<details><summary>recover adv-recover-corefine: 23 wrong answers</summary>

| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |
|---|---|---|---|---|---|---|
| adv-scale-1e3 | invalid | export: kernel exporter coordinate limit | - | - | - | STEP cylindrical parameter curves unresolved: InvalidSource |
| adv2-sphere-void | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 6.1e-16 | 1.7e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-core |
| adv2-full-sphere-disjoint | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 3.1e-16 | 2.1e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-core |
| adv2-sphere-two-flats | mismatch | export: sphere/torus test serializer (no pcurves / seam count) | 3.4e-6 | 5.1e-6 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-core |
| adv2-sphere-rotated-corner | valid-sampled | export: sphere/torus test serializer (no pcurves / seam count) | 3.4e-7 | 2.4e-7 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-core |
| adv3-cyl-plane-shave-tilt-1e-5rad | mismatch | wrong-geometry | 1.8e-5 | 7.4e-6 | true |  |
| adv3-cyl-plane-shave-tilt-intersect | invalid | wrong-empty | - | - | - |  |
| adv3-cyl-cyl-graze-tilt-1e-5rad | mismatch | wrong-geometry | 1.3e-5 | 2.5e-6 | true |  |
| adv3-crossed-cyl-graze | mismatch | wrong-geometry | 4.5e-6 | 2.2e-8 | true |  |
| adv3-torus-top-shave | mismatch | wrong-geometry | 3.5e-5 | 8.7e-6 | true |  |
| adv3-torus-top-cap-intersect | invalid | wrong-empty | - | - | - |  |
| adv3-cone-side-shave | mismatch | wrong-geometry | 1.4e-5 | 5.4e-6 | true |  |
| adv3-cone-side-shave-rotated | mismatch | wrong-geometry | 1.4e-5 | 5.4e-6 | true |  |
| adv3-scale-1e3-hole | invalid | export: kernel exporter coordinate limit | - | - | - | STEP cylindrical parameter curves unresolved: InvalidSource |
| adv4-planar-chip-dev0.1 | mismatch | wrong-geometry | 1.5e-5 | 2.1e-4 | true |  |
| adv4-planar-chip-dev0.01-1mm | mismatch | wrong-geometry | 1.4e-7 | 9.5e-6 | true |  |
| adv4-planar-corner-bump | mismatch | wrong-geometry | 1.4e-5 | 2.0e-4 | true |  |
| adv4-planar-corner-bump-rotated | mismatch | wrong-geometry | 1.4e-5 | 2.0e-4 | true |  |
| adv4-cone-tip-dimple | mismatch | wrong-geometry | 2.7e-4 | 3.3e-5 | true |  |
| adv4-cone-tip-bump-rotated | mismatch | wrong-geometry | 2.7e-4 | 3.3e-5 | true |  |
| adv4-cyl-shave-tilt-1e-8rad | mismatch | wrong-geometry | 1.9e-5 | 7.6e-6 | true |  |
| adv4-far-plate-hole | invalid | export: kernel exporter coordinate limit | - | - | - | STEP cylindrical parameter curves unresolved: InvalidSource |
| adv4-ball-in-spherical-void | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 5.7e-16 | 1.4e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-core |

</details>

<details><summary>recover adv-recover-exact-plane: 19 wrong answers</summary>

| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |
|---|---|---|---|---|---|---|
| adv2-sphere-void | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 6.1e-16 | 1.7e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-exac |
| adv2-full-sphere-disjoint | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 3.1e-16 | 2.1e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-exac |
| adv2-sphere-two-flats | mismatch | export: sphere/torus test serializer (no pcurves / seam count) | 3.4e-6 | 5.1e-6 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-exac |
| adv2-sphere-rotated-corner | valid-sampled | export: sphere/torus test serializer (no pcurves / seam count) | 3.4e-7 | 2.4e-7 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-exac |
| adv3-cyl-plane-shave-tilt-1e-5rad | mismatch | wrong-geometry | 1.8e-5 | 7.4e-6 | true |  |
| adv3-cyl-plane-shave-tilt-intersect | invalid | wrong-empty | - | - | - |  |
| adv3-cyl-cyl-graze-tilt-1e-5rad | mismatch | wrong-geometry | 1.3e-5 | 2.5e-6 | true |  |
| adv3-crossed-cyl-graze | mismatch | wrong-geometry | 4.5e-6 | 2.2e-8 | true |  |
| adv3-torus-top-shave | mismatch | wrong-geometry | 3.5e-5 | 8.7e-6 | true |  |
| adv3-torus-top-cap-intersect | invalid | wrong-empty | - | - | - |  |
| adv3-cone-side-shave | mismatch | wrong-geometry | 1.4e-5 | 5.4e-6 | true |  |
| adv3-cone-side-shave-rotated | mismatch | wrong-geometry | 1.4e-5 | 5.4e-6 | true |  |
| adv4-planar-chip-dev0.1 | mismatch | wrong-geometry | 1.5e-5 | 2.1e-4 | true |  |
| adv4-planar-chip-dev0.01-1mm | mismatch | wrong-geometry | 1.4e-7 | 9.5e-6 | true |  |
| adv4-planar-corner-bump | mismatch | wrong-geometry | 1.4e-5 | 2.0e-4 | true |  |
| adv4-planar-corner-bump-rotated | mismatch | wrong-geometry | 1.4e-5 | 2.0e-4 | true |  |
| adv4-cone-tip-dimple | mismatch | wrong-geometry | 2.7e-4 | 3.3e-5 | true |  |
| adv4-cyl-shave-tilt-1e-8rad | mismatch | wrong-geometry | 1.9e-5 | 7.6e-6 | true |  |
| adv4-ball-in-spherical-void | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 4.6e-16 | 1.4e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-exac |

</details>

<details><summary>recover adv-recover-manifold: 23 wrong answers</summary>

| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |
|---|---|---|---|---|---|---|
| adv-scale-1e3 | invalid | export: kernel exporter coordinate limit | - | - | - | STEP cylindrical parameter curves unresolved: InvalidSource |
| adv2-sphere-void | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 6.1e-16 | 1.7e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-mani |
| adv2-full-sphere-disjoint | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 3.1e-16 | 2.1e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-mani |
| adv2-sphere-two-flats | mismatch | export: sphere/torus test serializer (no pcurves / seam count) | 3.4e-6 | 5.1e-6 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-mani |
| adv2-sphere-rotated-corner | valid-sampled | export: sphere/torus test serializer (no pcurves / seam count) | 3.4e-7 | 2.4e-7 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-mani |
| adv3-cyl-plane-shave-tilt-1e-5rad | mismatch | wrong-geometry | 1.8e-5 | 7.4e-6 | true |  |
| adv3-cyl-plane-shave-tilt-intersect | invalid | wrong-empty | - | - | - |  |
| adv3-cyl-cyl-graze-tilt-1e-5rad | mismatch | wrong-geometry | 1.3e-5 | 2.5e-6 | true |  |
| adv3-crossed-cyl-graze | mismatch | wrong-geometry | 4.5e-6 | 2.2e-8 | true |  |
| adv3-torus-top-shave | mismatch | wrong-geometry | 3.5e-5 | 8.7e-6 | true |  |
| adv3-torus-top-cap-intersect | invalid | wrong-empty | - | - | - |  |
| adv3-cone-side-shave | mismatch | wrong-geometry | 1.4e-5 | 5.4e-6 | true |  |
| adv3-cone-side-shave-rotated | mismatch | wrong-geometry | 1.4e-5 | 5.4e-6 | true |  |
| adv3-scale-1e3-hole | invalid | export: kernel exporter coordinate limit | - | - | - | STEP cylindrical parameter curves unresolved: InvalidSource |
| adv4-planar-chip-dev0.1 | mismatch | wrong-geometry | 1.5e-5 | 2.1e-4 | true |  |
| adv4-planar-chip-dev0.01-1mm | mismatch | wrong-geometry | 1.4e-7 | 9.5e-6 | true |  |
| adv4-planar-corner-bump | mismatch | wrong-geometry | 1.4e-5 | 2.0e-4 | true |  |
| adv4-planar-corner-bump-rotated | mismatch | wrong-geometry | 1.4e-5 | 2.0e-4 | true |  |
| adv4-cone-tip-dimple | mismatch | wrong-geometry | 2.7e-4 | 3.3e-5 | true |  |
| adv4-cone-tip-bump-rotated | mismatch | wrong-geometry | 2.7e-4 | 3.3e-5 | true |  |
| adv4-cyl-shave-tilt-1e-8rad | mismatch | wrong-geometry | 1.9e-5 | 7.6e-6 | true |  |
| adv4-far-plate-hole | invalid | export: kernel exporter coordinate limit | - | - | - | STEP cylindrical parameter curves unresolved: InvalidSource |
| adv4-ball-in-spherical-void | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 5.7e-16 | 1.4e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-recover-mani |

</details>

<details><summary>recover adv-sdf-corefine: 6 wrong answers</summary>

| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |
|---|---|---|---|---|---|---|
| adv-sdf-scale-1e3-plate-through-hole | invalid | export: kernel exporter coordinate limit | - | - | - | STEP cylindrical parameter curves unresolved: InvalidSource |
| adv-sdf-far-1e4-plate-through-hole | invalid | export: kernel exporter coordinate limit | - | - | - | STEP cylindrical parameter curves unresolved: ResolutionLimit (faceIndex 6, loopIndex 0, useIndex 0, |
| adv-sdf-union-spheres-disjoint | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 4.3e-16 | 3.6e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-sdf-corefine |
| adv2-sdf-scale-1e3-sphere-minus-box | valid-sampled | export: sphere/torus test serializer (no pcurves / seam count) | 8.2e-8 | 8.2e-8 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-sdf-corefine |
| adv2-sdf-box-corner-contact | contact-accepted | contact-accepted | 5.7e-16 | 1.9e-16 | true |  |
| adv2-sdf-tiny-void | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 5.7e-16 | 1.9e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-sdf-corefine |

</details>

<details><summary>recover adv-sdf-exact-plane: 3 wrong answers</summary>

| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |
|---|---|---|---|---|---|---|
| adv-sdf-union-spheres-disjoint | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 4.3e-16 | 3.6e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-sdf-exact-pl |
| adv2-sdf-box-corner-contact | contact-accepted | contact-accepted | 5.7e-16 | 1.9e-16 | true |  |
| adv2-sdf-tiny-void | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 5.7e-16 | 1.9e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-sdf-exact-pl |

</details>

<details><summary>recover adv-sdf-manifold: 5 wrong answers</summary>

| case | verdict | class | OCCT volume rel err vs exact CSG | area rel err | solids match | detail |
|---|---|---|---|---|---|---|
| adv-sdf-scale-1e3-plate-through-hole | invalid | export: kernel exporter coordinate limit | - | - | - | STEP cylindrical parameter curves unresolved: InvalidSource |
| adv-sdf-far-1e4-plate-through-hole | invalid | export: kernel exporter coordinate limit | - | - | - | STEP cylindrical parameter curves unresolved: ResolutionLimit (faceIndex 6, loopIndex 0, useIndex 0, |
| adv-sdf-union-spheres-disjoint | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 4.3e-16 | 3.6e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-sdf-manifold |
| adv2-sdf-scale-1e3-sphere-minus-box | valid-sampled | export: sphere/torus test serializer (no pcurves / seam count) | 8.2e-8 | 8.2e-8 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-sdf-manifold |
| adv2-sdf-tiny-void | invalid-step | export: sphere/torus test serializer (no pcurves / seam count) | 5.7e-16 | 1.9e-16 | true | ValueError: <repo>/out/bakeoff/judge2/recover/check-adv-sdf-manifold |

</details>

Recover compute ms (median; native 5 processes, JS 3 warm runs), corpus, input = manifold3d dumps:

| case | js | cpu1 | cpu18 | metal (passes) | status |
|---|---|---|---|---|---|
| leaf-cylinder | 21 | 2.0 | 4.0 | 53 (1) | ok |
| box-union-overlap | 14 | 1.0 | 3.0 | 47 (1) | ok |
| box-subtract-overlap | 11 | 1.0 | 3.0 | 44 (1) | ok |
| box-intersect-overlap | 7.0 | 1.0 | 2.0 | 43 (1) | ok |
| box-rotated-intersect | 14 | 2.0 | 3.0 | 45 (1) | ok |
| box-coplanar-union | 11 | 1.0 | 3.0 | 44 (1) | ok |
| box-coplanar-subtract | 9.2 | 1.0 | 2.0 | 43 (1) | ok |
| box-touching-merge | 8.0 | 2.0 | 4.0 | 45 (1) | ok |
| box-touching-partial | 11 | 2.0 | 3.0 | 45 (1) | ok |
| plate-through-hole | 20 | 3.0 | 4.0 | 53 (1) | ok |
| plate-blind-hole | 19 | 3.0 | 4.0 | 52 (1) | ok |
| plate-blind-pocket | 11 | 2.0 | 3.0 | 44 (1) | ok |
| plate-counterbore | 35 | 5.0 | 6.0 | 58 (1) | ok |
| plate-countersink | 51 | 9.0 | 10 | 68 (1) | ok |
| plate-4-holes | 46 | 10 | 11 | 67 (1) | ok |
| plate-hole-grid-10x10 | 731 | 277 | 238 | 431 (1) | ok |
| tilted-holes-17deg | 49 | 11 | 11 | 67 (1) | ok |
| pipe-tee | 39 | 7.0 | 8.0 | 69 (1) | unresolved: cylinder/cylinder intersection off a common axis is a space quartic (c |
| steinmetz-intersect | 11 | 1.0 | 2.0 | 56 (1) | unresolved: mesh vertex 75: patches of only 2 distinct carriers meet (tessellation |
| steinmetz-union | 21 | 4.0 | 5.0 | 74 (1) | unresolved: mesh vertex 231: patches of only 2 distinct carriers meet (tessellatio |
| coaxial-cylinder-stack | 32 | 5.0 | 7.0 | 68 (1) | ok |
| sphere-minus-box | 155 | 53 | 52 | 139 (1) | ok |
| sphere-intersect-cylinder | 155 | 35 | 37 | 132 (1) | ok |
| box-minus-sphere-cavity | 147 | 36 | 37 | 179 (1) | ok |
| hex-nut | 36 | 6.0 | 9.0 | 128 (1) | unresolved: mesh vertex 83: degenerate vertex, carriers dependent (/det/ 5.9168084 |
| enclosure-shell | 122 | 42 | 43 | 100 (1) | ok |
| gear-48-bore | 326 | 77 | 54 | 158 (1) | ok |
| cylinder-tangent-box-face | 32 | 4.0 | 5.0 | 52 (1) | unresolved: faces on a plane and a cylinder carrier come within 0 mm without shari |
| hole-tangent-edge | 6.2 | 1.0 | 2.0 | 49 (1) | unresolved: 2 pairs of distinct mesh vertices coincide: the Boolean mesh touches i |
| self-union | 29 | 3.0 | 4.0 | 52 (1) | ok |
| self-subtract | 1.0 | 0.0 | 1.0 | 43 (1) | ok |
| self-intersect | 23 | 3.0 | 4.0 | 59 (1) | ok |
| internal-void | 12 | 3.0 | 6.0 | 54 (1) | ok |
| disjoint-union | 31 | 4.0 | 6.0 | 63 (1) | ok |
| pin-array-chain-20 | 137 | 43 | 46 | 107 (1) | ok |
| fine-spheres-50k | 1300 | 640 | 458 | 1172 (1) | ok |
| torus-minus-box | 316 | 116 | 92 | 299 (1) | ok |
| r10b-g10-union | 186 | 57 | 53 | 128 (1) | ok |

Recover over 10 cases with cpu1 >= 20 ms: cpu1/cpu18 geo-mean 1.10, metal/cpu18 geo-mean 2.77. Corpus sums (ms): js 4189, cpu1 1473, cpu18 1245, metal 4430. All targets byte-identical on 38/38.

Hybrid end to end (corefine compute + recover compute on corefine's result, native medians; recover-from-corefine ran with 3 processes per target):

| case | hybrid verdict | corefine cpu1 / cpu18 | recover cpu1 / cpu18 | total cpu1 / cpu18 | recover share of total (cpu18) |
|---|---|---|---|---|---|
| plate-through-hole | exact | 21 / 15 | 9.0 / 10 | 30 / 25 | 40 % |
| plate-blind-hole | exact | 12 / 11 | 16 / 10 | 28 / 21 | 48 % |
| plate-counterbore | exact | 61 / 41 | 25 / 24 | 86 / 65 | 37 % |
| plate-countersink | exact | 126 / 77 | 102 / 96 | 228 / 173 | 55 % |
| plate-4-holes | exact | 71 / 41 | 60 / 55 | 131 / 96 | 57 % |
| plate-hole-grid-10x10 | exact | 1818 / 1309 | 2049 / 1838 | 3867 / 3147 | 58 % |
| tilted-holes-17deg | exact | 50 / 28 | 93 / 93 | 143 / 121 | 77 % |
| pipe-tee | unresolved | 116 / 66 | 26 / 22 | 142 / 88 | 25 % |
| steinmetz-intersect | unresolved | 26 / 14 | 6.0 / 6.0 | 32 / 20 | 30 % |
| steinmetz-union | unresolved | 48 / 48 | 15 / 11 | 63 / 59 | 19 % |
| coaxial-cylinder-stack | exact | 34 / 26 | 33 / 37 | 67 / 63 | 59 % |
| sphere-minus-box | exact | 243 / 187 | 143 / 112 | 386 / 299 | 37 % |
| sphere-intersect-cylinder | exact | 272 / 187 | 171 / 112 | 443 / 299 | 37 % |
| box-minus-sphere-cavity | exact | 158 / 125 | 103 / 95 | 261 / 220 | 43 % |
| hex-nut | unresolved | 95 / 71 | 19 / 12 | 114 / 83 | 14 % |
| enclosure-shell | exact | 155 / 115 | 103 / 116 | 258 / 231 | 50 % |
| gear-48-bore | exact | 47 / 43 | 113 / 102 | 160 / 145 | 70 % |
| cylinder-tangent-box-face | no-source | 5.0 / 7.0 | - / - | 5.0 / 7.0 | 0 % |
| hole-tangent-edge | no-source | 14 / 12 | - / - | 14 / 12 | 0 % |
| self-union | exact | 41 / 27 | 8.0 / 7.0 | 49 / 34 | 21 % |
| self-subtract | exact | 29 / 14 | 1.0 / 2.0 | 30 / 16 | 13 % |
| self-intersect | exact | 31 / 16 | 8.0 / 12 | 39 / 28 | 43 % |
| pin-array-chain-20 | exact | 157 / 140 | 177 / 203 | 334 / 343 | 59 % |
| fine-spheres-50k | exact | 2094 / 1220 | 840 / 580 | 2934 / 1800 | 32 % |
| torus-minus-box | exact | 424 / 324 | 216 / 161 | 640 / 485 | 33 % |
| r10b-g10-union | exact | 50 / 35 | 50 / 41 | 100 / 76 | 54 % |

Rows below 20 ms total cpu1 with an exact verdict are omitted. Sum over the exact cases: corefine 5922 / 4023 ms, recover 4368 / 3770 ms (cpu1 / cpu18).

### Run conditions and raw reports

| report | captured (UTC) | load average start -> end | builds |
|---|---|---|---|
| out/bakeoff/judge2/corefine/adv-corefine/js/report.json | 2026-09-23T14:03 | 14.1 14.8 17.4 -> 79.3 62.7 38.6 | js cached |
| out/bakeoff/judge2/corefine/adv-corefine/native/report.json | 2026-09-23T14:21 | 36.3 47.7 41.7 -> 32.5 45.1 41.1 | cpu cached, metal cached |
| out/bakeoff/judge2/corefine/adv-exact-plane/js/report.json | 2026-09-23T14:09 | 79.3 62.7 38.6 -> 38.4 53.0 38.5 | js cached |
| out/bakeoff/judge2/corefine/adv-exact-plane/native/report.json | 2026-09-23T14:21 | 32.5 45.1 41.1 -> 39.0 45.3 41.3 | cpu cached, metal cached |
| out/bakeoff/judge2/corefine/adv-recover/js/report.json | 2026-09-23T14:12 | 38.4 53.0 38.5 -> 73.2 49.2 39.5 | js cached |
| out/bakeoff/judge2/corefine/adv-recover/native/report.json | 2026-09-23T14:22 | 57.3 49.0 42.8 -> 56.7 51.8 44.7 | cpu cached, metal cached |
| out/bakeoff/judge2/corefine/adv-sdf/js/report.json | 2026-09-23T14:10 | 53.8 58.6 39.0 -> 30.5 49.7 37.8 | js cached |
| out/bakeoff/judge2/corefine/adv-sdf/native/report.json | 2026-09-23T14:22 | 39.0 45.3 41.3 -> 57.3 49.0 42.8 | cpu cached, metal cached |
| out/bakeoff/judge2/corefine/corpus-js/report.json | 2026-09-23T13:26 | 19.9 24.0 39.0 -> 13.9 19.9 34.6 | js cached |
| out/bakeoff/judge2/corefine/corpus-native/report.json | 2026-09-23T12:53 | 15.2 7.9 5.0 -> 11.0 8.4 5.6 | cpu cached, metal cached |
| out/bakeoff/judge2/exact-plane/adv-corefine/js/report.json | 2026-09-23T14:12 | 30.5 49.7 37.8 -> 73.2 49.2 39.5 | js cached |
| out/bakeoff/judge2/exact-plane/adv-corefine/native/report.json | 2026-09-23T14:23 | 67.1 51.4 43.7 -> 48.4 48.7 43.1 | cpu cached, metal cached |
| out/bakeoff/judge2/exact-plane/adv-exact-plane/js/report.json | 2026-09-23T14:15 | 32.3 38.2 35.1 -> 36.3 47.7 41.7 | js cached |
| out/bakeoff/judge2/exact-plane/adv-exact-plane/native/report.json | 2026-09-23T14:23 | 48.4 48.7 43.1 -> 56.7 51.8 44.7 | cpu cached, metal cached |
| out/bakeoff/judge2/exact-plane/adv-recover/js/report.json | 2026-09-23T14:17 | 73.2 49.2 39.5 -> 98.1 79.2 59.3 | js cached |
| out/bakeoff/judge2/exact-plane/adv-recover/native/report.json | 2026-09-23T14:24 | 56.7 51.8 44.7 -> 41.4 45.5 43.2 | cpu cached, metal cached |
| out/bakeoff/judge2/exact-plane/adv-sdf/js/report.json | 2026-09-23T14:17 | 73.2 49.2 39.5 -> 67.1 51.4 43.7 | js cached |
| out/bakeoff/judge2/exact-plane/adv-sdf/native/report.json | 2026-09-23T14:24 | 56.7 51.8 44.7 -> 45.1 48.9 44.2 | cpu cached, metal cached |
| out/bakeoff/judge2/exact-plane/corpus-js/report.json | 2026-09-23T13:29 | 13.9 19.9 34.6 -> 10.1 31.4 36.9 | js cached |
| out/bakeoff/judge2/exact-plane/corpus-native/report.json | 2026-09-23T12:55 | 11.0 8.4 5.6 -> 28.8 52.2 31.8 | cpu cached, metal cached |
| out/bakeoff/judge2/recover/adv-corefine-corefine/report.json | 2026-09-23T14:27 | 37.4 44.4 42.9 -> 67.2 50.9 45.3 | cpu cached, metal cached, js cached |
| out/bakeoff/judge2/recover/adv-corefine-exact-plane/report.json | 2026-09-23T14:27 | 37.4 44.4 42.9 -> 67.2 50.9 45.3 | cpu cached, metal cached, js cached |
| out/bakeoff/judge2/recover/adv-corefine-manifold/report.json | 2026-09-23T14:27 | 37.4 44.4 42.9 -> 76.8 54.0 46.5 | cpu cached, metal cached, js cached |
| out/bakeoff/judge2/recover/adv-exact-plane-corefine/report.json | 2026-09-23T14:28 | 67.2 50.9 45.3 -> 85.3 57.8 48.1 | cpu cached, metal cached, js cached |
| out/bakeoff/judge2/recover/adv-exact-plane-exact-plane/report.json | 2026-09-23T14:28 | 67.2 50.9 45.3 -> 84.8 58.2 48.3 | cpu cached, metal cached, js cached |
| out/bakeoff/judge2/recover/adv-exact-plane-manifold/report.json | 2026-09-23T14:27 | 37.4 44.4 42.9 -> 74.1 53.1 46.2 | cpu cached, metal cached, js cached |
| out/bakeoff/judge2/recover/adv-recover-corefine/report.json | 2026-09-23T14:29 | 92.5 62.4 50.2 -> 11.3 38.7 46.9 | cpu cached, metal cached, js cached |
| out/bakeoff/judge2/recover/adv-recover-exact-plane/report.json | 2026-09-23T14:29 | 92.5 62.9 50.4 -> 102.6 78.1 58.2 | cpu cached, metal cached, js cached |
| out/bakeoff/judge2/recover/adv-recover-manifold/report.json | 2026-09-23T14:29 | 84.8 58.2 48.3 -> 99.7 78.2 58.5 | cpu cached, metal cached, js cached |
| out/bakeoff/judge2/recover/adv-sdf-corefine/report.json | 2026-09-23T14:28 | 76.8 54.0 46.5 -> 92.5 62.9 50.4 | cpu cached, metal cached, js cached |
| out/bakeoff/judge2/recover/adv-sdf-exact-plane/report.json | 2026-09-23T14:29 | 85.3 57.8 48.1 -> 81.0 63.4 51.1 | cpu cached, metal cached, js cached |
| out/bakeoff/judge2/recover/adv-sdf-manifold/report.json | 2026-09-23T14:28 | 74.1 53.1 46.2 -> 92.5 62.4 50.2 | cpu cached, metal cached, js cached |
| out/bakeoff/judge2/recover/corpus-from-corefine-native/report.json | 2026-09-23T13:24 | 12.9 26.0 42.3 -> 19.3 25.2 40.7 | cpu cached, metal cached |
| out/bakeoff/judge2/recover/corpus-from-exact-plane-native/report.json | 2026-09-23T13:25 | 19.3 25.2 40.7 -> 19.9 24.0 39.0 | cpu cached, metal cached |
| out/bakeoff/judge2/recover/corpus-manifold-js/report.json | 2026-09-23T13:58 | 6.3 10.2 17.3 -> 7.1 10.1 17.0 | js cached |
| out/bakeoff/judge2/recover/corpus-manifold-native/report.json | 2026-09-23T13:23 | 6.2 28.0 44.0 -> 12.9 26.0 42.3 | cpu cached, metal cached |
| out/bakeoff/judge2/sdf/adv-corefine/js/report.json | 2026-09-23T13:59 | 7.5 10.1 16.9 -> 18.0 15.2 17.8 | js cached |
| out/bakeoff/judge2/sdf/adv-corefine/native/report.json | 2026-09-23T13:59 | 7.5 10.1 16.9 -> 18.8 13.7 17.6 | cpu cached, metal cached |
| out/bakeoff/judge2/sdf/adv-exact-plane/js/report.json | 2026-09-23T13:59 | 7.5 10.1 16.9 -> 32.3 38.2 35.1 | js cached |
| out/bakeoff/judge2/sdf/adv-exact-plane/native/report.json | 2026-09-23T13:59 | 7.5 10.1 16.9 -> 14.1 14.8 17.4 | cpu cached, metal cached |
| out/bakeoff/judge2/sdf/adv-recover/js/report.json | 2026-09-23T13:59 | 7.5 10.1 16.9 -> 26.0 57.8 54.2 | js cached |
| out/bakeoff/judge2/sdf/adv-recover/native-crashed/report.json | 2026-09-23T14:02 | 18.0 15.2 17.8 -> - | cpu cached, metal cached |
| out/bakeoff/judge2/sdf/adv-recover/native-rest/report.json | 2026-09-23T15:17 | 23.5 21.5 29.2 -> 13.2 17.3 25.0 | cpu cached, metal cached |
| out/bakeoff/judge2/sdf/adv-recover/native/report.json | 2026-09-23T14:38 | 9.3 34.3 44.9 -> - | cpu cached, metal cached |
| out/bakeoff/judge2/sdf/adv-sdf/js/report.json | 2026-09-23T13:59 | 7.5 10.1 16.9 -> 30.6 60.3 55.0 | js cached |
| out/bakeoff/judge2/sdf/adv-sdf/native/report.json | 2026-09-23T14:00 | 18.8 13.7 17.6 -> 58.4 48.7 44.4 | cpu cached, metal cached |
| out/bakeoff/judge2/sdf/corpus-js/report.json | 2026-09-23T13:39 | 10.1 31.4 36.9 -> 6.3 10.2 17.3 | js cached |
| out/bakeoff/judge2/sdf/corpus-native/report.json | 2026-09-23T13:02 | 28.8 52.2 31.8 -> 6.2 28.0 44.0 | cpu cached, metal cached |
