# Fillet and chamfer harness

Status: 23 September 2026, part 1 of the fillet work (survey, usage analysis,
harness). This is the shared referee for the part-2 prototype bake-off. It
follows the Boolean bake-off ([bakeoff.md](../bakeoff.md)): cases, fixtures,
oracle, validator, runner. It is test infrastructure only. Fixtures are built
by the wonky kernel, every prototype computes its blend in Bend, and
OpenCascade runs only as an independent oracle through `uv run`. Nothing OCCT
produces is fed to a prototype.

Labels: MEASURED (run here, log named), DOCUMENTED (source named), INFERRED
(derived here), HEARSAY.

Hardened on 24 September 2026 (docs/fillet-plan.md §8 step 0; see "Grade on
top of the validator"): the chamfer closed forms follow Onshape's setback
reading, closed forms are evaluated on the job's own geometry, every pass is
also graded by the tight check (with the prototype's claim) and by the
divergence volume (now with cones), and run.mjs checks strict STEP.

Since plan §8 step 1 (24 September 2026) A's valid results are measured and
strictly validated through the production STEP writer (`src/exporters.mjs`
on the production types, `kernel/fillet/production.bend`), and strict STEP
gates A's verdicts; see "STEP writers".

## Result in short

- **71 cases** in `fixtures/fillet/cases.json`, ordered by the corpus ranking
  ([corpus.md](corpus.md) §4.1):
  - 41 analytic core, 12 of Marc's real configurations, 18 known hard cases;
  - 55 fillets and 16 chamfers;
  - expectations: 53 `ok`, 4 `must-refuse`, 14 `either`.
  - Case 71, `ch-convex-120-hex-d1`, was added on 24 September 2026 for
    the Onshape probe FP15 (see "Onshape oracle").
- **Onshape oracle** (24 September 2026, stage A3): the 16 Onshape probes
  FP01 to FP16 are in `fixtures/fillet/reference.json` as a separate
  `onshape` section. Onshape is the primary oracle wherever it was probed.

  Every input is a real wonky B-rep. The kernel evaluates an unmodified-syntax
  FeatureScript snippet through `src/index.mjs build()`. All 70 build
  (development evidence kept locally). The
  regeneration is byte-identical (`fixtures.mjs --check`).
- **59 cases have an independent closed form** for the volume change (INFERRED
  derivations, below; FP15's came with its probe, FP09's notch in step 0). OCCT
  confirms every one it can build to ≤ 1.6e-9 relative (MEASURED,
  `fixtures/fillet/reference.json`). OCCT's 3-edge chamfer corner adds a
  triangle, which Onshape FP16 confirmed (the grade uses that form). Chamfers
  off 90° set back d along each face, as Onshape FP-a/FP15 and OCCT do; the
  face-offset reading is a rejected alternative since step 0.
- **OCCT oracle (MEASURED):** 49 of 70 done and 21 not done. It fails one `ok` case (a plane/cone
  chamfer) and 5 `either` cases that have a closed form (tangent and
  near-tangent edges, full rounds, r = face width). One of its results is
  BRepCheck-invalid (see "Where OCCT fails").
- **Validator:** checks topology, geometry, exact surface types or stated
  approximations, G1 at the springs, the blend radius, and volume/area against
  the closed form and OCCT.
  - All 53 OCCT results that the result format can hold pass (MEASURED,
    `out/fillet/oracle-occt/summary.md`).
  - The mutation self-test gets 22 of 22 verdicts right since step 0 (15
    of 15 before; MEASURED, `scripts/fillet/selftest.mjs`).
  - Since step 0 every pass is also graded by the tight check and the
    divergence volume (`grade.mjs`), and run.mjs reports strict STEP.
- **Runner:** targets `js`, `cpu1`, `cpuN` and `metal`. The `null` prototype
  (Bend, refuses everything) ran on 3 cases on all four targets. It gave
  `declined` on the `ok` case and `expected-refusal` on the `must-refuse` and
  `either` cases, and the targets agree byte for byte (MEASURED,
  `out/fillet/null/summary.md`).

## Layout

| path | role |
|---|---|
| `scripts/fillet/cases.mjs` | case catalogue (source of truth): FS snippet builder, selectors, closed forms; `--write` → `fixtures/fillet/cases.json`, `--list` |
| `scripts/fillet/geom.mjs` | curve/surface evaluation, convexity, 2D closed forms (Green's theorem, exact for lines and arcs) |
| `scripts/fillet/brepfmt.mjs` | job and result text codec (F32x2 reals, shared with the Boolean bake-off), refusal classes |
| `scripts/fillet/fixtures.mjs` | builds every input with the kernel; writes `fixtures/fillet/jobs/<id>.job`, sidecar `<id>.json`, `index.json`, and `out/fillet/input-step/<id>.step` (kernel serializer) for the oracle; `--check` |
| `scripts/fillet/onshape-oracle.mjs` | Onshape oracle: the probes' own numbers (read only from the cad-31 session's probe directory) → the `onshape` section of `fixtures/fillet/reference.json`; `--check` |
| `scripts/fillet/crosscheck.mjs` | cross-check of two prototypes' reports: volumes, face counts, blend types of the cases both build |
| `scripts/fillet/divvolume.mjs` | volume of a result (or job) B-rep from its exact geometry, independent of OCCT and STEP: divergence theorem, face integrals reduced to Gauss-Legendre integrals over the exact edges (planes, cylinders, spheres, tori, cones; B-splines are reported as unsupported). Library (`divVolume`) and CLI |
| `scripts/fillet/closedform.mjs` | closed forms evaluated on the job's own geometry (`closedForm.job`: `edges`, `outline`, `notch`), and the variants a result is graded against |
| `scripts/fillet/tightcheck.mjs` | tight check of `ok` results (supports on input surfaces, edges on faces to 1e-9 mm, grounded blends, G1, stated tolerances by the prototype's claim). Library and CLI |
| `scripts/fillet/grade.mjs` | the grade on top of the validator's verdict: tight check, divergence volume, strict STEP gate |
| `scripts/fillet/verify-step.mjs` | strict STEP of a finished run's passes (`uv run scripts/validate-step.py`) |
| `scripts/fillet/reference.py` | OCCT oracle (`uv run`, cadquery-ocp 8.0.1 = OCCT 8.0.1 as in build123d 0.13): `fixtures/fillet/reference.json`; `--dump` writes OCCT's blends in the result format; `--measure` measures result STEP files |
| `scripts/fillet/validate.mjs` | result validator (CLI and library); `resultStepFor` writes a result's STEP with the prototype's writer (production for A, `--writer` on the CLI) |
| `scripts/fillet/production-measures.mjs` | A's built results through production volume, print tessellation and solid classification on the production types (plan §8 step 1) |
| `scripts/fillet/run.mjs`, `prototypes.mjs` | runner and registry (with each prototype's claim, exact or approximate, and STEP writer, production or harness); JS target through `scripts/bakeoff/js-worker.mjs` |
| `scripts/fillet/run-adversarial.mjs` | runner for an extra catalogue (the verifiers' adversarial files) |
| `scripts/fillet/proto/null/` | baseline Bend prototype (`main.bend`, `native.bend`); template for part-2 teams |
| `scripts/fillet/selftest.mjs` | mutation test of the validator and the grade |
| `out/fillet/<proto>/` | `report.json`, `summary.md`, `results/<case>.<target>.result`, `step/`, `build/` |

## Commands

```sh
node scripts/fillet/cases.mjs --write                  # catalogue -> fixtures/fillet/cases.json
node scripts/fillet/fixtures.mjs [--cases a,b]         # build inputs with wonky (13 s for all)
node scripts/fillet/fixtures.mjs --check               # fail if a regenerated job differs
uv run scripts/fillet/reference.py --dump out/fillet/oracle-occt/results   # OCCT oracle (5 s)
node scripts/fillet/onshape-oracle.mjs [--check]      # Onshape oracle from the probes
node scripts/fillet/crosscheck.mjs --a fillet-kpart --b fillet-rollingball-tori   # prototype A vs C
node scripts/fillet/divvolume.mjs <result> [--expected V]   # exact B-rep volume (no OCCT)
node scripts/fillet/production-measures.mjs out/fillet/fillet-kpart/results [--cases a,b] [--out f.json]   # A through production volume/mesh/classification
node scripts/fillet/run.mjs --proto null --targets js,cpu1,cpuN,metal [--cases a,b] [--group core|corpus|hard]
node scripts/fillet/run.mjs --proto oracle-occt        # replay OCCT's blends through the validator
node scripts/fillet/validate.mjs <job> <result> [--no-occt]   # one result, JSON report
node scripts/fillet/selftest.mjs                       # mutation test (validator and grade)
node scripts/fillet/tightcheck.mjs --results <dir> [--claim exact|approximate]   # tight check of a run
node scripts/fillet/run-adversarial.mjs --file fixtures/fillet/adversarial-fillet-kpart.json --proto fillet-kpart --targets js,cpu1,cpuN,metal
```

Runner options: `--targets` (default `js,cpu1`), `--repeat k`, `--timeout s`
(default 120), `--threads N`, `--rebuild`, `--no-validate`, `--no-occt`,
`--no-step` (skip strict STEP), `--step-gate` / `--no-step-gate` (a strict STEP
failure makes a pass `step-fail`; the default gates for a prototype with the
production writer, A), `--out dir`, `--gpu size`. These are as in the Boolean
runner. Before each case the runner checks that the job file still matches the
sidecar hash. If it does not, the case is an `error` ("stale").

## Cases

Each case records:
- `id`, `group` (`core` | `corpus` | `hard`), `rank` (the edge configuration's
  rank in corpus.md §4.1; 99 = not in the measured corpus), `corpus` (the
  configuration and family it stands for);
- `op` (`fillet` | `chamfer`), `size` (the radius, or the equal-offset chamfer
  distance), `tangentPropagation`;
- `input.source`, a FeatureScript function `filletInput` (sketch + `opExtrude`
  / `opLoft` / `opBoolean`, the calls wonky supports today);
- `select`, `convexity` (asserted during fixture generation), `expect`,
  `refuseClass`, `blendTypes`, `closedForm`, `noOpAllowed`.

**Selectors** are resolved geometrically against the built body. The sidecar
freezes the resulting edge indices and one sample point per edge, and the
oracle finds the same edges in OCCT's copy by these points. Seam edges are
never selected.
- `near: p`: exactly one edge within 1e-6 mm;
- `all`;
- `parallel: axis`: straight edges;
- `inPlane: {point, normal}`: every sample of the edge within 1e-6 mm of the
  plane (face loops);
- `segment: {a, b}`: straight edges on the segment. The covered length must
  equal the segment, which handles the collinear fragments wonky's planar union
  leaves.

**Convexity check (MEASURED).** Fixture generation computes each selected
edge's convexity and dihedral from the face normals (theory §1.2). It refuses
to write a case whose convexity differs from the case's statement. All 70
agree, including the 150°, 240°, 300°, 60° and 30° prisms, the 106.7° cone rim,
the 126.9° D-flat, the 178.9° ridge and the smooth (180°) G1 seam. This
confirms the harness's plane, cylinder and cone normal conventions against the
kernel's B-reps.

**expect:**
- `ok`: a valid blend exists and is well defined. A refusal scores `declined`.
- `must-refuse`: no valid blend exists. It is not enough for a ball to fit
  locally. The cases are: a boss rim with `r > ρ`, `r` above both face widths,
  a chamfer wider than both faces, and a ball wider than the notch. Any result
  scores `wrong`.
- `either`: kernels legitimately differ. These are overflow, face consumption
  (full round), overlapping blends, mixed convexity, tangent or near-tangent
  edges, `tangentPropagation: false` and the concave root loop around a boss.
  A typed refusal and a valid result are both accepted. A result is checked
  against the closed form when the case has one. This is the bake-off's
  honest answer to semantics that Onshape was not probed for (theory §15).

The case table (with the oracle's outcome per case) is at the end of this
document.

## Closed forms (INFERRED derivations; MEASURED agreement with OCCT)

All values are the volume change `ΔV = V_result − V_input`. They are computed
in `cases.mjs` with `geom.mjs`, whose 2D integrals were checked by grid
integration (MEASURED). The expected volume is the kernel's input volume plus
ΔV.
- **Translation family** (straight edge, free ends at perpendicular caps):
  `ΔV = ∓L·A`, where `A` is the 2D spandrel.
  - plane/plane at interior angle `α`: `A = r²(cot(α/2) − (π − α)/2)`
    (theory §14); concave edges use `2π − α` and add material;
  - line/cylinder generator: `A` by Green's theorem on the region bounded by
    line, fillet arc and support arc (`lineCircleFillet2D`);
  - chamfer: the triangle with in-face setback `s`. Onshape EQUAL_OFFSETS
    sets back `s = d` along each support face (probe FP-a, MEASURED on FP15),
    as OCCT does: `A = d² sin(α)/2`. The face-offset reading
    (`s = d·cot(α/2)`, theory §5.1) is kept as a rejected alternative
    (`acceptAlternatives: false`; `ch-convex-60-d1`, `ch-cone-rim-0.42`,
    FP15).
- **Rotation family** (rims): Pappus, `ΔV = ∓2π·∬x dA`, over the same 2D
  regions in the (radius, z) half plane. This covers the torus, spindle torus,
  sphere, cone rim fillet and cone/plane chamfers.
- **Top outline of a vertical-walled prism** (loops with mitres, G1 line/arc
  chains, concave corners). The cross-section at depth `z` is the mitred
  inward offset of the outline by `w(z)`, whose area is `A − P·w + K·w²`, with
  `K = Σ_sharp tan(θ/2) + Σ_arcs θ/2` (θ the signed turning angle). Hence:
  - chamfer `d`: `ΔV = −(P·d²/2 − K·d³/3)`;
  - fillet `r`: `ΔV = −(P·r²(1 − π/4) − K·r³(5/3 − π/2))`.

  For a rectangle loop this reproduces the mitre overlaps `d³/3` and
  `r³(5/3 − π/2)`. For a slot it reproduces Pappus, with the spandrel centroid
  offset `r(1 − k)`, `k = 2/(3(4 − π))` (theory §14). It holds while no offset
  edge collapses.
- **Corners:**
  - 3-edge fillet sphere: `ΔV = −(3r²(1 − π/4)(a − r) + r³(1 − π/6))`;
  - all edges of a box: Steiner (rounded box volume − abc);
  - two of three (fillet mitre): `−(r²(1 − π/4)(L1 + L2) − r³(5/3 − π/2))`;
  - chamfer corner-3: `−(3d²L/2 − d³ + d³/4)` (union of three prisms, planes
    meeting in a point). OCCT instead inserts a corner triangle that removes
    `d³/12` more (MEASURED). Accepted as alternative `cornerTriangle`; Onshape
    FP16 builds the triangle, so the grade uses that form.
- **Overflow notch** (FP09, `hard-overflow-convex-small-face-r2`, added in
  step 0): the ball on the 20-face and the 135° face, whose 0.57 mm width it
  overflows; the blend is trimmed by the top face (`closedform.mjs notch2D`).
  The design value equals Onshape's ΔV to 5.3e-13 (MEASURED).

**Closed forms on the job geometry (step 0).** The kernel builds inputs from F32
sketch coordinates (`src/kernel.mjs vector`), so non-axis inputs such as the
60° triangle move by up to 1e-7 mm, and the design value is off the job's
geometry by up to 1.5e-9 × V (`pp-convex-60-r2`). Rebuilding the jobs from
binary64 coordinates is the kernel's sketch path, not the harness's, so the
harness evaluates the closed form on the job instead: `closedForm.job =
{kind}` names the form (`edges`: dihedral and length of each selected
plane/plane edge with perpendicular caps; `outline`: perimeter and turning of
the selected face loops; `notch`: the prism section). 42 cases carry one, every
F32-rounded case among them. The design value (`deltaVolume`) stays: it is
what an Onshape probe on the design geometry agrees with. On exactly
representable inputs job and design agree to ≤ 1e-13 × V, on the F32 ones to
< 1e-8 × V (MEASURED, `test/fillet-harness.test.mjs`).

Agreement (MEASURED, `reference.json`): every OCCT-done case with a closed form
matches the primary form to ≤ 1.6e-9 relative, except `ch-box-corner-3-d1`
(matches `cornerTriangle`, Onshape's reading). `ch-convex-60-d1` matched its
then `inSupport` alternative, which step 0 made the primary. The kernel's input volume and OCCT's volume of
the same STEP agree to ≤ 6.9e-15 relative.

## Job and result format

ASCII tokens. Reals are two U32 words (F32x2, value `hi + lo`), byte-compatible
with `scripts/bakeoff/jobfmt.mjs`. Input bodies are written as F32x2.
The quantization error is recorded per sidecar. Its maximum over all 70 cases
is 1.8e-14 mm (MEASURED).

```
wonky-fillet-job 1
case <id>
op fillet|chamfer
size <real>
chamfer equal-offsets|none
propagate 0|1
brep <V> <E> <F>
v <x y z>                                         # V lines
e <start> <end> <curve> <sameSense 0|1> <ranged 0|1> <first> <last>
f <sameSense> <surface> <nloops> (l <outer 0|1> <n> (<edge> <forward 0|1>)^n)^nloops
select <k> <edge indices>
end
```

- curves: `line o d`, `circle o n x r`, `ellipse o n x a b`;
- surfaces: `plane o n x`, `cylinder o axis x r`, `cone o axis x r angle`
  (radius `r + h·tan(angle)`), `sphere o axis x r`, `torus o axis x R r`;
- conventions: those of `kernel/analytic.bend` and `geom.mjs`. An edge runs
  start → end; `sameSense` says whether that is increasing parameter. Loops
  are counter-clockwise seen from outside, so every edge is used once forward
  and once reversed.

A result is either

```
ok
brep <V> <E> <F>
... v / e lines as above ...
f <sameSense> <surface> <role> <tol> <nloops> ...   # role: support|blend|corner|cap; tol: 0 = exact, else stated approximation (mm)
end
```

or `unresolved <class> <reason words>` followed by `end`. The classes
(`brepfmt.mjs REFUSALS`) are:
- `radius-too-large`, `face-consumed`, `overflow`, `blend-overlap`,
  `self-intersection`;
- `mixed-convexity`, `vertex-blend`, `tangent-edge`;
- `unsupported-surface`, `unsupported-edge`;
- `invalid-input`, `not-implemented`.

An unknown class is still a refusal, but the report flags it.

### Format extension: `bspline` (prototype C, stage C2, 24 September 2026)

Proposed and implemented with prototype C's spline variant
([proto-rollingball.md](proto-rollingball.md), "Stage C2"). Result files
only; jobs never carry it.

```
bspline <du> <dv> <nu> <nv> <nu+du+1 u-knots> <nv+dv+1 v-knots> <nu*nv poles>
```

- non-rational, clamped knot vectors, poles in u-major order (pole (i, j) at
  `i*nv + j`), natural normal `Su × Sv`; the face sense flips it as for the
  analytic surfaces;
- a `bspline` face is an approximation: the validator rejects it with
  `tol = 0`;
- evaluation, closest point and normal: `scripts/fillet/bspline.mjs`, used by
  `geom.mjs` (`pointSurfaceDistance`, `surfaceNormal`);
- serializer: `scripts/fillet/stepx.mjs`, a copy of the recover serializer
  plus `B_SPLINE_SURFACE_WITH_KNOTS` (the original belongs to another
  workflow). `validate.mjs` uses it only for bodies with a `bspline` face, so
  every other result is written exactly as before. The boundary edges of a
  `bspline` face get PCURVEs (SURFACE_CURVE, SEAM_CURVE on a closed rim):
  the isoline they run along, as a 2D cubic B-spline in the 3D curve's own
  parameter with Hermite nodes at the surface knots; circle edges on such a
  face are written TRIMMED with their range starting in [0, 2π). Without
  them OpenCascade projected the edges itself, with another
  parametrisation, and failed the strict CurveOnSurface check on 34 of 39
  spline results (fix:fillet-rollingball);
- oracle path: OCCT reads the STEP as for every other result
  (`reference.py --measure`).

## Validator

`checkResult` runs first, synchronously:
1. **Format:** the result decodes.
2. **Topology:**
   - every loop chains;
   - every edge is used exactly once forward and once reversed;
   - there are no unused vertices;
   - there is exactly one outer loop per face;
   - Euler–Poincaré gives an integer genus ≥ 0 (shells counted by face
     connectivity).
3. **Geometry** (1e-6 mm, plus the face's stated tolerance):
   - vertices lie on their edge curves;
   - curve ranges end at their vertices;
   - 17 samples per edge lie on the surfaces of both faces.
4. **Surface types:**
   - blend and corner faces carry exact types from the case's `blendTypes`;
   - approximated faces must state `tol ≤ 0.01 mm` and are listed;
   - a result without any blend or corner face is invalid.
5. **Tangency** (fillets):
   - the blend radius (cylinder radius, torus minor, sphere radius) equals
     the requested one within 1e-7 mm;
   - every *spring* is G1 within 1e-6 rad (1e-3 rad next to an
     approximation). A spring is an edge between a blend face and a support
     face on a rolled-on surface (a face adjacent to a selected input edge,
     compared with `sameSurface`) where the faces meet at under 0.1 rad.
     Steeper junctions are trims (caps, mitres) and are only reported;
   - opposed normals (angle > π − 0.1) are an orientation error;
   - at least one spring must exist, unless no face of the result lies on a
     rolled-on surface any more: when every support is consumed (r equal to
     both face widths, FP03) the blend meets only the far faces, and the
     requirement is waived and reported (`tangency.waived`; added in stage
     A3).
   - Chamfers get no G1 requirement (theory §5.2).

Measurement follows for valid results:
- `resultStepFor` writes the B-rep as STEP with the prototype's writer
  (`prototypes.mjs` `stepWriter`; see "STEP writers"). The harness writer
  (`resultStep`) is the Boolean bake-off's sphere/torus serializer
  (`scripts/bakeoff/recover-stepx.mjs`): it changes no coordinates, writes no
  parameter curves, and writes negative cone angles as `(−axis, −angle)`, the
  same cone.
- `reference.py --measure` (OCCT, one batch) reports volume, area,
  BRepCheck, free edges and bad orientation.
- `compareMeasures` compares these against the closed form (primary and
  accepted alternatives), the OCCT oracle's volume and area, and the input
  volume (no-op detection). The volume tolerance is `1e-7·V`, plus
  `area × stated approximation tolerance`.

**Verdicts** (`verdictOf`):
- `error`: malformed result;
- `declined`: refusal where `expect` is `ok`;
- `expected-refusal`: refusal where it is `must-refuse` or `either`;
- `invalid`: any validator issue, or OCCT reads it as invalid or open;
- `wrong`: a result where the case must refuse;
- `no-op`: the volume is unchanged although the closed form changes it (F15).
  A closed-form change below the volume tolerance (the 178.9° ridge:
  −2.4e-5 mm³ on 6043 mm³) cannot be told from a no-op by volume. Such a
  result is scored by its closed-form match; being valid, it has a blend face
  and a G1 spring, so it is not the unchanged input (stage A3);
- `mismatch`: wrong volume or area, or wrong exact blend type;
- `pass` / `pass-approx`: the result matches the closed form, or OCCT when
  there is no closed form. Where an Onshape probe exists it is the primary
  oracle (stage A3):
  - a result on a case Onshape refuses (FP12) is `wrong`;
  - the closed forms Onshape's ΔV agrees with decide. FP16 picks the corner
    triangle of `ch-box-corner-3-d1`, so −29.25 no longer passes;
  - without such a form, Onshape's ΔV within the validator's tolerance, or
    its mass-property bounds [min, max], decide (FP08, the boss root, where
    Onshape's value is 3.5e-3 from the extended-mitre closed form);
- `unverified`: valid, but nothing to compare with (an `either` case OCCT
  cannot build and without a closed form);
- `unmeasured`: the OCCT measurement failed;
- `timeout`, and `no-source` (replay only).

When the targets produce different bytes, a pass is downgraded to `mismatch`.

### Grade on top of the validator (plan §8 step 0, 24 September 2026)

`grade.mjs` grades every `pass` further, in this order (run.mjs,
run-adversarial.mjs and selftest.mjs share it):
- **tight** (`tightcheck.mjs` with the prototype's claim from
  `prototypes.mjs`) → `tight-fail`. The validator admits a support plane
  moved by 1e-8 mm (GEOM_TOL 1e-6) and a blend radius 5e-8 off (RADIUS_TOL
  1e-7); the tight check does not (1e-9 mm). Claims: `exact` (A, OCCT, null)
  means every face states tol 0; `approximate` (C-tori, C-spline) means
  support and cap faces state 0 and blend faces may state a tolerance, which
  must then hold for every edge on them ("stated"). Vertex-blend faces (the
  FP14 torus) are grounded by tangency to an input surface and an adjacent edge
  blend.
- **div** (`divvolume.mjs`, no OCCT, no STEP) → `div-mismatch`: the volume
  change of the result against the input, both from their own geometry,
  against the reference the verdict used: the closed forms on the job's
  geometry to 1e-9 × V (the forms Onshape agrees with, where a probe exists),
  else Onshape's ΔV or bounds, else the OCCT oracle, at their 1e-7 × V.
  Approximated faces add area × stated tolerance.
- **step** (strict STEP: `uv run scripts/validate-step.py`, OpenCascade with
  exact CurveOnSurface, topology and volume) → `step-fail`. run.mjs checks every
  valid result (4 at a time); it gates for the production writer (A, since
  plan §8 step 1) and with `--step-gate`, and reports otherwise (the harness
  writer writes no pcurves: mitre ellipses on cylinders fail for that reason
  alone). run-adversarial.mjs gates as before. A valid result the production
  writer refuses to export (a capability error: no STEP, so `unmeasured`) is
  `step-fail` where STEP gates. The expected volume of the check is the
  matching closed form, else Onshape's value where it matches, else a valid
  matching OCCT oracle's, else the result's divergence volume (since step 1;
  before, an unmatched oracle volume could be used: FP08 got OCCT's invalid
  blend's volume).

**Self-test (MEASURED, 22/22 since step 0; 15/15 before):**
- controls: two OCCT blends → `pass`;
- the input returned as the result → `no-op`;
- torus minor 1 → 1.05 → `invalid` (springs 0.05 mm off the torus);
- flipped blend face → `invalid` (opposed normals);
- dropped face → `invalid`;
- vertex moved 1e-4 mm → `invalid`;
- a fillet on the wrong edge → `invalid`;
- `tol` 0.001 → `pass-approx`, 0.05 → `invalid`;
- a result on a must-refuse case → `wrong`;
- refusals: `declined`, and `expected-refusal` with an unknown class;
- malformed → `error`;
- OCCT's corner triangle → `pass` through the accepted alternative;
- step 0: the 60° chamfer rebuilt from the job with setback 1 → `pass`, with
  the face-offset setback → `mismatch`; a support plane moved by 1e-8 mm, a
  torus minor 5e-8 off, and a blend stating tol 1e-9 under the exact claim →
  `tight-fail`; under the approximate claim the stated tolerance →
  `pass-approx`, a support stating one → `tight-fail`; `tol` 0.001 and 0.05
  run under the approximate claim.

**OCCT replay (MEASURED):** `reference.py --dump` converts OCCT's blends to
the result format. OCCT's roles come from `Modified`/`IsDeleted`, and degenerate
pole edges are dropped. Through the whole validator this gives `pass` 53,
`no-source` 16 (OCCT not done) and `expected-refusal` 1 (the boss-root result
has B-spline faces, which the format cannot hold).

Two harness bugs were found and fixed this way:
- `BRepTools_WireExplorer.Orientation()` differs from
  `Current().Orientation()` on faces with seams (MEASURED on the rim torus,
  `tmp/fillet/harness/orient-debug.py`);
- STEP needs positive cone angles.

### STEP writers (plan §8 step 1, 24 September 2026)

A prototype names the writer its valid results are measured and strictly
validated through (`prototypes.mjs` `stepWriter`):

- **production** (A): `validate.mjs productionStep` maps the result text onto
  the production types in Bend (`kernel/fillet/production.bend` through
  `src/fillet.mjs`: `J.SSphere`/`J.STorus` to `A.Sphere`/`A.Torus` with the
  same fields, a cone with a negative angle to the reversed axis and a
  positive angle, a whole closed circle to a periodic edge without a range;
  a face that states a tolerance, a non-positive radius or a malformed text
  is refused by name) and writes it with `src/exporters.mjs`. That writer
  adds the parameter curves the harness writer lacks: the whole-body cylinder
  charts (mitre ellipses), sphere frames whose poles stay off the boundary
  arcs, with Bend parameter curves for the other circles, and, when the
  cylinder planner is unresolved far from the origin, no parameter curves for
  bodies whose every cylinder boundary is a parameter line (readers build
  those exactly). A production export refusal is reported, never replaced by
  the harness writer.
- **harness** (all others): `resultStep`, no parameter curves.

`node scripts/fillet/production-measures.mjs <resultsDir>...` runs A's built
results through the production modules downstream of a fillet: the
integrated volume (`kernel/volume.bend`), the print tessellation
(`printMesh`) and solid classification (`classifySolid`), against the
divergence volume. The measured outcome is in docs/fillet-plan.md §8 step 1.

## Onshape oracle (24 September 2026)

`scripts/fillet/onshape-oracle.mjs` copies the numbers of the Onshape
probes into the `onshape` section of `fixtures/fillet/reference.json`.
The probes were built by the cad-31 session on 2026-09-24 and are read only:
`~/Workspace/cad/cad-project-041/single-step-r20/kernel-cases/fp-*/reference.json`
and `fp-probes.json`. Onshape runs `opFillet` or `opChamfer`
EQUAL_OFFSETS with its defaults on the case's own FeatureScript input.

Per case the record holds:
- the probe code, Onshape's verdict, feature status and error code;
- the mass properties: volume value and its [min, max] bounds, the input
  volume and ΔV;
- the face count, face types and mesh face areas;
- the SHA-256 of the probe's reference file;
- the relative difference between Onshape's input volume and the kernel's.

That difference is ≤ 4.4e-15 except for two inputs the kernel builds with
F32-rounded sketch coordinates: the ridge (1.2e-8) and the small face
(7.6e-10). The validator therefore applies Onshape's ΔV to the kernel's
input volume, never Onshape's absolute volume.

Mapping:
- FP01 to FP14 are the 14 `either` cases of the same id;
- FP15 is the new case `ch-convex-120-hex-d1`: the probe's hexagon prism,
  extruded 20 along x, one 120° edge chamfered d = 1. Its closed form is the
  setback along the faces, −L·d²·sin(α)/2 = −8.660254. The face-offset
  reading (−11.547) is a rejected alternative;
- FP16's input and selection are word for word those of
  `ch-box-corner-3-d1`, so the probe references that case instead of
  duplicating it.

| probe | case | Onshape | ΔV mm³ | faces |
|---|---|---|---|---|
| FP01 | corpus-notch-trial-r3 | built | +20.834018 | 11 (2 cylinders) |
| FP02 | corpus-notch-trial-r1.5 | built | +5.794250 | 10 (1 cylinder) |
| FP03 | hard-single-edge-r-equals-width-r10 | built | −214.601837 | 5 |
| FP04 | hard-full-round-r5 | built | −107.300918 | 6 (1 cylinder) |
| FP05 | hard-overlapping-blends-thin-wall-r1 | built | −8.478908 | 7 |
| FP06 | hard-short-edge-in-loop-r1 | built | −12.394827 | 11 |
| FP07 | hard-overflow-narrow-ledge-r0.4 | built | +0.249197 | 12 |
| FP08 | hard-boss-root-concave-mitres-r1 | built | +8.964084 (bounds 8.217 to 9.711) | 15 |
| FP09 | hard-overflow-convex-small-face-r2 | built | −0.846754 | 7 |
| FP10 | hard-near-tangent-ridge-178.9-r2 | built | −2.3589e-5 | 8 |
| FP11 | fl-slot-one-line-no-propagate-r1 | built | −4.878634 | 7 |
| FP12 | hard-tangent-edge-selection-r1 | **refused**: FILLET_FAIL_SMOOTH | – | – |
| FP13 | hard-concave-rim-overflow-r6.5 | built | +310.385746 | 5 (torus, 2 cylinders) |
| FP14 | hard-mixed-convexity-corner-r1 | built | −7.279651 | 12 |
| FP15 | ch-convex-120-hex-d1 | built | −8.660254 | 9 |
| FP16 | ch-box-corner-3-d1 | built | −29.333333 | 10 |

The runner passes the record in as `spec.onshape` and its summary shows
two extra columns: the Onshape probe, and the volume error against Onshape.
`expect` is unchanged. An `either` case that Onshape builds and a
prototype refuses is still `expected-refusal`, following Marc's v1 scope
decision.

## Oracle

`reference.py` reads the kernel's STEP of the input. For every case it checks
that the input volume matches the kernel's (≤ 6.9e-15 relative) and finds each
selected edge by its sample point (exactly one OCCT edge within 1e-5 mm). It
then runs `BRepFilletAPI_MakeFillet` / `MakeChamfer` (symmetric distance) and
records:
- status, faulty contours and vertices, exceptions and time;
- volume, area, faces by surface type, solids and shells;
- BRepCheck validity, free edges and orientation (`ShapeAnalysis_Shell`);
- agreement with the closed form and its alternatives.

**Where OCCT fails or is wrong (MEASURED, reference.json):**

| case | expect | OCCT | note |
|---|---|---|---|
| ch-cone-rim-0.42 | ok | not done | plane/cone chamfer at 106.7° (F12 tapered supports); the closed form exists |
| hard-near-tangent-ridge-178.9-r2 | either | not done: "There are no suitable edges for chamfer or fillet" | F11; the closed form is ΔV = −2.4e-5 mm³ |
| hard-tangent-edge-selection-r1 | either | not done, same message | corpus.md measured a no-op success on a real part (different OCCT path) |
| corpus-notch-trial-r1.5 | either | not done (2 faulty vertices) | full round of a 3 mm notch floor (F1); closed form exists |
| hard-full-round-r5 | either | not done (2 faulty vertices) | the #1177 class, as in implementations.md §2.4 |
| hard-single-edge-r-equals-width-r10 | either | not done | F2 boundary; r = 9.999 is done |
| hard-overlapping-blends-thin-wall-r1, hard-short-edge-in-loop-r1, hard-overflow-* , hard-concave-rim-overflow-r6.5, corpus-notch-trial-r3 | either | not done | overflow, consumption and overlap: OCCT refuses them all |
| hard-boss-root-concave-mitres-r1 | either | **done but BRepCheck-invalid**, 4 B-spline faces | concave root loop around a boss (cad-project-026 configuration) |
| fl-slot-one-line-no-propagate-r1 | either | done, whole loop | OCCT always propagates along G1 chains (no `tangentPropagation: false`) |
| corpus-r22-guide-outline-chamfer-0.42 | ok | done, matches the closed form | the real r22 file fails in fsocct (corpus.md); this r22-like outline does not reproduce it |

The 4 `must-refuse` cases are all not done in OCCT, as expected.

## Prototype contract (what part 2 must provide)

- **Location:** a directory `kernel/proto/fillet-<name>/`, registered
  automatically as `--proto fillet-<name>`, holding `main.bend` with
  `def run(job: String) -> String`, and optionally `parse`, `solve` and
  `show` for phase timing on the JS target.
- **Native driver:** `native.bend` (copy `scripts/fillet/proto/null/native.bend`).
  It prints one JSON line with the phase times and marks at most one line
  `# @bakeoff-device-call` for Metal.
- **Result:**
  - the full body, not a patch;
  - every face tagged `support` / `blend` / `corner` / `cap`, with `tol` 0 for
    exact faces or a stated tolerance ≤ 0.01 mm;
  - only surface types the format has (plane, cylinder, cone, sphere, torus)
    and curve types it has (line, circle, ellipse). A prototype that needs
    B-spline or procedural surfaces must propose a format extension, with a
    serializer and an oracle path, before the bake-off;
  - a refusal as `unresolved <class> <reason>`, using the class vocabulary
    and never silently.
- **Determinism:** the same bytes on every target.

## Limitations

- The inputs are what wonky can build today: prisms and profiles,
  posts, coaxial steps, through holes, lofted cones and planar unions. The
  following cannot be built yet, so their configurations are not represented:
  - bosses on plates: a non-coaxial plane/cylinder union is refused by the
    kernel's Boolean admission (MEASURED, `tmp/fillet/harness/probe-fs.mjs`);
  - blind holes;
  - B-spline spines;
  - cylinder/cylinder intersections.

  Corpus configurations 11, 12 and 15 (B-spline) and the concave blind-hole
  floor (spindle limit F10) are missing for that reason.
- The r22 case is "r22-like" (INFERRED from the recorded edge configuration in
  `tmp/fillet/primary-calls.json`), not the file itself.
- Onshape was probed on 16 configurations only (FP01 to FP16, "Onshape
  oracle"). Elsewhere the `either` split and the chamfer alternatives still
  mark the open semantics (theory §15, questions 1 and 4).
- The volume and area of a result are measured by OCCT on the exported STEP.
  This is an oracle reading an artifact, as in the Boolean bake-off's recover
  check. JS computes no independent volume for trimmed tori.
- The G1 spring rule classifies junctions under 0.1 rad as springs. A blend
  meeting a rolled-on support at a genuinely intended 0.05 rad crease would be
  flagged. No case has one.

## Case table

{"ok":53,"must-refuse":4,"either":14} {"core":41,"corpus":12,"hard":18} {"fillet":55,"chamfer":16} closedForms 58
| # | case | group | rank | op | size | expect | closed form ΔV | OCCT | OCCT vs closed form |
|---|---|---|---|---|---|---|---|---|---|
| 1 | pp-box-vertical-edge-r2 | core | 1 | fillet | 2 | ok | -6.867259 | done | agrees (1e-16) |
| 2 | pp-plate-4-vertical-edges-r4.2 | core | 1 | fillet | 4.2 | ok | -181.707667 | done | agrees (1e-16) |
| 3 | pp-roundx-r3 | corpus | 1 | fillet | 3 | ok | -386.283306 | done | agrees (2e-16) |
| 4 | pp-box-top-edge-r1 | core | 1 | fillet | 1 | ok | -4.292037 | done | agrees (1e-16) |
| 5 | pp-box-two-of-three-mitre-r2 | core | 1 | fillet | 2 | ok | -23.268443 | done | agrees (2e-11) |
| 6 | pp-box-top-loop-r2 | core | 1 | fillet | 2 | ok | -82.772884 | done | agrees (2e-11) |
| 7 | pp-box-corner-3-r2 | core | 1 | fillet | 2 | ok | -50.165207 | done | agrees (5e-16) |
| 8 | pp-box-all-edges-r2 | core | 1 | fillet | 2 | ok | -154.100336 | done | agrees (2e-16) |
| 9 | corpus-probestab-all-edges-r1 | corpus | 1 | fillet | 1 | ok | -60.466095 | done | agrees (0e+0) |
| 10 | corpus-u-plate-vertical-edges-r4.2 | corpus | 1 | fillet | 4.2 | ok | -181.707667 | done | agrees (2e-16) |
| 11 | perf-comb-vertical-edges-r0.5 | corpus | 1 | fillet | 0.5 | ok | -1.287611 | done | agrees (4e-15) |
| 12 | ch-box-vertical-edge-d1 | core | 2 | chamfer | 1 | ok | -4.000000 | done | agrees (3e-16) |
| 13 | ch-plate-top-loop-0.42 | core | 2 | chamfer | 0.42 | ok | -12.249216 | done | agrees (2e-16) |
| 14 | ch-plate-both-loops-0.42 | core | 2 | chamfer | 0.42 | ok | -24.498432 | done | agrees (2e-16) |
| 15 | ch-box-corner-3-d1 | core | 2 | chamfer | 1 | ok | -29.250000 | done | matches alternative cornerTriangle |
| 16 | corpus-outline-chamfer-lines-arcs-0.42 | corpus | 2 | chamfer | 0.42 | ok | -13.645258 | done | agrees (6e-16) |
| 17 | corpus-r22-guide-outline-chamfer-0.42 | corpus | 2 | chamfer | 0.42 | ok | -14.107058 | done | agrees (5e-16) |
| 18 | ch-hole-rim-0.42 | core | 3 | chamfer | 0.42 | ok | -2.294293 | done | agrees (0e+0) |
| 19 | ch-post-rim-0.42 | core | 3 | chamfer | 0.42 | ok | -2.693300 | done | agrees (3e-16) |
| 20 | corpus-two-hole-rims-chamfer-0.42 | corpus | 3 | chamfer | 0.42 | ok | -2.926054 | done | agrees (0e+0) |
| 21 | ch-slot-outline-0.42 | core | 3 | chamfer | 0.42 | ok | -6.221300 | done | agrees (0e+0) |
| 22 | perf-hole-grid-rims-0.42 | corpus | 3 | chamfer | 0.42 | ok | -28.597280 | done | agrees (2e-16) |
| 23 | pp-concave-270-r2 | core | 4 | fillet | 2 | ok | 8.584073 | done | agrees (0e+0) |
| 24 | ch-concave-270-d1 | core | 4 | chamfer | 1 | ok | 5.000000 | done | agrees (0e+0) |
| 25 | pp-l-concave-and-convex-r2 | core | 4 | fillet | 2 | ok | -17.168147 | done | agrees (2e-16) |
| 26 | pp-rib-root-concave-r2 | core | 4 | fillet | 2 | ok | 34.336294 | done | agrees (2e-16) |
| 27 | corpus-notch-trial-r6 | corpus | 4 | fillet | 6 | must-refuse | - | not-done | - |
| 28 | corpus-notch-trial-r3 | corpus | 4 | fillet | 3 | either | - | not-done | - |
| 29 | corpus-notch-trial-r1.5 | corpus | 4 | fillet | 1.5 | either | 5.794250 | not-done | - |
| 30 | corpus-notch-trial-r1 | corpus | 4 | fillet | 1 | ok | 2.575222 | done | agrees (2e-16) |
| 31 | pp-concave-240-r2 | core | 5 | fillet | 2 | ok | 2.150060 | done | agrees (6e-11) |
| 32 | pp-convex-150-r2 | core | 6 | fillet | 2 | ok | -0.245992 | done | agrees (2e-11) |
| 33 | pp-ridge-150-horizontal-r2 | core | 6 | fillet | 2 | ok | -0.491984 | done | agrees (2e-11) |
| 34 | pp-convex-120-hex-r2 | core | 6 | fillet | 2 | ok | -2.150060 | done | agrees (1e-10) |
| 35 | pp-concave-300-r1 | core | 7 | fillet | 1 | ok | 6.848533 | done | agrees (2e-11) |
| 36 | pp-convex-60-r2 | core | 8 | fillet | 2 | ok | -27.394130 | done | agrees (2e-9) |
| 37 | pp-convex-30-acute-r1 | core | 8 | fillet | 1 | ok | -24.230539 | done | agrees (7e-10) |
| 38 | ch-convex-60-d1 | core | 8 | chamfer | 1 | ok | -12.990381 | done | matches alternative inSupport |
| 39 | pc-post-top-rim-r1 | core | 9 | fillet | 1 | ok | -6.440730 | done | agrees (0e+0) |
| 40 | pc-post-top-rim-spindle-r3.5 | core | 9 | fillet | 3.5 | ok | -69.675135 | done | agrees (0e+0) |
| 41 | pc-post-top-rim-r4.99 | core | 9 | fillet | 4.99 | ok | -130.451614 | done | agrees (3e-16) |
| 42 | pc-post-top-rim-sphere-r5 | core | 9 | fillet | 5 | ok | -130.899694 | done | agrees (2e-16) |
| 43 | pc-hole-rim-r1 | core | 9 | fillet | 1 | ok | -5.694718 | done | agrees (4e-16) |
| 44 | pc-hole-both-rims-r1 | core | 9 | fillet | 1 | ok | -11.389436 | done | agrees (4e-16) |
| 45 | pc-post-both-rims-r1 | core | 9 | fillet | 1 | ok | -12.881460 | done | agrees (1e-16) |
| 46 | fl-slot-outline-r1 | core | 9 | fillet | 1 | ok | -15.024803 | done | agrees (0e+0) |
| 47 | fl-slot-one-line-propagate-r1 | core | 9 | fillet | 1 | ok | -15.024803 | done | agrees (0e+0) |
| 48 | ch-cone-rim-0.42 | core | 10 | chamfer | 0.42 | ok | -1.447407 | not-done | - |
| 49 | pc-cone-rim-r1 | core | 10 | fillet | 1 | ok | -3.203850 | done | agrees (7e-16) |
| 50 | pc-bump-generator-concave-r1 | core | 14 | fillet | 1 | ok | 2.612236 | done | agrees (7e-16) |
| 51 | pc-post-base-concave-r1 | core | 17 | fillet | 1 | ok | 5.694718 | done | agrees (2e-16) |
| 52 | pc-dflat-generator-convex-r1 | core | 19 | fillet | 1 | ok | -0.820451 | done | agrees (3e-16) |
| 53 | hard-single-edge-r-too-large-r12 | hard | 1 | fillet | 12 | must-refuse | - | not-done | - |
| 54 | hard-single-edge-r-equals-width-r10 | hard | 1 | fillet | 10 | either | -214.601837 | not-done | - |
| 55 | hard-single-edge-r9.999 | hard | 1 | fillet | 9.999 | ok | -214.558918 | done | agrees (0e+0) |
| 56 | hard-full-round-r5 | hard | 1 | fillet | 5 | either | -107.300918 | not-done | - |
| 57 | hard-near-full-round-r4.99 | hard | 1 | fillet | 4.99 | ok | -106.872144 | done | agrees (1e-16) |
| 58 | hard-overlapping-blends-thin-wall-r1 | hard | 1 | fillet | 1 | either | - | not-done | - |
| 59 | hard-fillet-after-boolean-fragments-r1 | hard | 1 | fillet | 1 | ok | -1.716815 | done | agrees (1e-16) |
| 60 | hard-short-edge-in-loop-r1 | hard | 1 | fillet | 1 | either | - | not-done | - |
| 61 | hard-chamfer-exceeds-both-faces-d5 | hard | 2 | chamfer | 5 | must-refuse | - | not-done | - |
| 62 | hard-overflow-narrow-ledge-r0.4 | hard | 4 | fillet | 0.4 | either | - | not-done | - |
| 63 | hard-boss-root-concave-mitres-r1 | hard | 4 | fillet | 1 | either | - | done, BRepCheck invalid | - |
| 64 | hard-overflow-convex-small-face-r2 | hard | 6 | fillet | 2 | either | - | not-done | - |
| 65 | hard-near-tangent-ridge-178.9-r2 | hard | 6 | fillet | 2 | either | -0.000024 | not-done: There are no suitable edges for chamfer or fillet | - |
| 66 | pc-post-top-rim-too-large-r6 | hard | 9 | fillet | 6 | must-refuse | - | not-done | - |
| 67 | fl-slot-one-line-no-propagate-r1 | hard | 9 | fillet | 1 | either | - | done | - |
| 68 | hard-tangent-edge-selection-r1 | hard | 13 | fillet | 1 | either | 0.000000 | not-done: There are no suitable edges for chamfer or fillet | - |
| 69 | hard-concave-rim-overflow-r6.5 | hard | 17 | fillet | 6.5 | either | - | not-done | - |
| 70 | hard-mixed-convexity-corner-r1 | hard | 99 | fillet | 1 | either | - | done | - |
| 71 | ch-convex-120-hex-d1 | core | 6 | chamfer | 1 | ok | -8.660254 | done | agrees (OK) |
