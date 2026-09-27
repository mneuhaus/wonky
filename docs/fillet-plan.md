# Fillets and chamfers: design and integration plan

Status: 24 September 2026, judge of the fillet bake-off (part 2). This is the
judge's decision after both prototypes, their verifiers and their Regression reviews
were done. Every prototype ran unchanged on the 71-case catalogue
(`fixtures/fillet/cases.json`, 70 cases plus FP15), on both adversarial files
(`fixtures/fillet/adversarial-fillet-kpart.json`, 31 cases;
`fixtures/fillet/adversarial-fillet-rollingball.json`, 32 cases; every
prototype on both files) and on all 16 Onshape probes (FP01-FP16, which are
catalogue cases; see §1.2). Every run used all four targets (JS, native CPU at
1 and 18 threads, Metal), one run at a time. The raw reports are under
`out/fillet/judge/`, the judge's summary is `out/fillet/judge/judge.json`,
and the worklog with every command is
local development evidence.

Update 25 September 2026: steps 0-5 of §8 are measured, and the integrate
stage ran them as one tree on all four targets. See "Integration of steps
0-5 (measured)" before §9. The production fillet runs on the Bend JS target
behind FeatureScript and build123d. It is not the default dispatch yet: KS07
and the other items listed there are still open. Regression review 1 (same day, see
"Regression review 1 (measured)" after the integration section) removed the Metal
device stage of the fillet and made qCreatedBy(blend id, FACE | EDGE) give
the blend's own faces and edges. Regression review 2 (same day, "Regression review 2
(measured)") made the fillet read the coplanar fragments wonky's planar
Booleans leave as one face, and bounds an obstacle ellipse on a support
cylinder.

Nothing here is in production yet. Every statement is marked as
**measured** (a judge report or a named command shows it) or **conjecture**
(a design expectation that still needs its acceptance test).

Prototypes and names used below:

| name | directory | what it is |
|---|---|---|
| **A** | `kernel/proto/fillet-kpart` | exact analytic ladder, corner network, local B-rep surgery, overflow as notch (7.0k Bend lines) |
| **C-tori** | `kernel/proto/fillet-rollingball-tori` | rolling-ball station solver (65 stations per edge), spine fitted to one line or arc, blend faces are cylinder/torus/sphere/plane/cone labelled approximate at 1e-9 mm |
| **C-spline** | `kernel/proto/fillet-rollingball-spline` | the same solver, blend faces are bicubic B-splines labelled approximate (1e-9 to 1e-7 mm stated) |
| null | `scripts/fillet/proto/null` | harness baseline, refuses everything |
| oracle-occt | `out/fillet/oracle-occt/results` | OCCT 8.0.1 blends replayed (an oracle, never a candidate) |

C-tori and C-spline share `kernel/proto/fillet-rollingball` (4.8k lines; 5.2k together with both drivers).

## 1. Decision

The production fillet and chamfer becomes **A**, `fillet-kpart`, ported into
the kernel on the production surface types:

1. **Selection.** Sort and deduplicate the edge indices, ignore seam edges
   with a note, propagate tangent chains to a fixpoint when
   `tangentPropagation` is on, and record the resulting stripe order in the
   result.
2. **Ladder.** Classify each edge (convexity, dihedral, family) and solve it
   exactly in 2D: a cylinder for the translation family, a torus or sphere for
   the rotation family, a plane or cone for chamfers. Chamfers use Onshape's
   EQUAL_OFFSETS as corrected by probe FP-a: a setback d along each support
   face.
3. **Corner network.** Every stripe end is a planar cut. The ends are caps,
   trimmed mitres, extended mitres (Onshape FP08), G1 chains, sphere corners
   (exact rank test), Onshape's chamfer corner triangle (FP16), or face
   consumption (full round, r = face width, sphere dome).
4. **Surgery.** One pure rebuild of the B-rep, with overflow resolved as a
   notch where v1 allows it ("notch first"). Anything else is a typed
   refusal.

The other outcomes and engines:

- **C is the independent second engine, not a production path.** C-tori
  becomes the differential oracle in CI and in an opt-in "paranoid" mode: on
  every case both build, the volumes agree to 5.9e-12 mm³ and the carrier
  types agree per stripe (measured, §3). C-spline becomes the **opt-in
  tolerance stage** for non-analytic pairs. It is never on the default path,
  and its faces are always labelled approximate with their stated tolerance
  (Marc's decision 3).
- **Candidate B** (fillet by Boolean with declared tangency) waits for the
  hybrid Boolean in production. Its slot is fixed by A's refusal classes
  (§4).
- **Candidate D** is skipped (Marc's decision).
- **Execution.** Production runs on the CPU pool. Metal is off for fillets
  (§6).

**Gate.** A goes into production dispatch only after steps 0-3 of §8. On the
catalogue and both adversarial files A gives no wrong answer (measured).
Before it is the production default, the harness weaknesses of §7 must be
closed, the output must pass the production STEP export, and three open
questions must be settled: the boundary decisions without exact predicates,
the 1e-9 mm sliver topology, and the one in-scope case A over-refuses
(settled in step 2: the riser cap).

### 1.1 Why A (measured, judge run)

71 catalogue cases. Expected results: 53 `ok`, 4 `must-refuse`, 14 `either`.

| | A | C-tori | C-spline | OCCT replay | null |
|---|---|---|---|---|---|
| `ok` (53) | **53 pass** (exact) | 38 pass-approx, 15 declined (`vertex-blend`) | 38 pass-approx, 15 declined | 52 pass, 1 no result (`ch-cone-rim-0.42`) | 53 declined |
| `must-refuse` (4) | 4 typed refusals | 4 | 4 | 4 no result | 4 |
| `either` (14) | **10 pass**, 4 typed refusals | 1 pass-approx, 13 typed refusals | 1 pass-approx, 13 | 1 pass (FP14), 1 mismatch (FP11), 1 invalid (FP08), 11 no result | 14 |
| wrong / invalid / mismatch / no-op | **0** | 0 | 0 | 1 mismatch, 1 invalid | 0 |
| targets byte-identical | 71/71 | 71/71 | 71/71 | (cpu1 only) | 71/71 |
| stated tolerance of blend faces | 0 (exact) | 1e-9 mm | up to 1e-7 mm | exact | - |
| closed forms met | 57/57 (worst 1.5e-9 × V, F32 job input) | 39/39 | 39/39 | 52/52 | - |
| strict STEP (`validate-step.py`, exact CurveOnSurface) | 60/63 (the 3 mitre-ellipse cases fail in the result writer) | 39/39 | 39/39 | 51/53 (same writer failure) | - |
| independent tight check (`tightcheck.mjs`) | 63/63 | 39/39 apart from the "tol 0" rule, which C never meets by design | 39/39 likewise | - | - |

Against the Onshape probes (Onshape is the primary oracle where a probe
exists; `fixtures/fillet/reference.json` section `onshape`,
`node scripts/fillet/onshape-oracle.mjs --check`: up to date):

| probe | case | Onshape | A | C (both variants) |
|---|---|---|---|---|
| FP01 | corpus-notch-trial-r3 | builds, 11 faces, dV +20.8340 | pass, 11 faces, err 2.7e-12 | `face-consumed` |
| FP02 | corpus-notch-trial-r1.5 | builds, 10 faces | pass, 10, err 9.1e-13 | `face-consumed` |
| FP03 | r = face width r10 | builds, 5 faces | pass, 5, err 3.4e-13 | `face-consumed` |
| FP04 | full round r5 | builds, 6 faces | pass, 6, err 5.7e-13 | `face-consumed` |
| FP05 | thin-wall overlap | builds, 7 faces | pass, 7, err 1.1e-13 | `blend-overlap` |
| FP06 | short edge in loop | builds, 11 faces | `blend-overlap` | `vertex-blend` |
| FP07 | narrow ledge overflow | builds, 12 faces | pass, 12, err 1.1e-13 | `overflow` |
| FP08 | boss-root concave mitres | builds, 15 faces, dV +8.9641 | pass, 15, dV +8.967555 (err 3.5e-3, inside Onshape's [8.217, 9.711]) | `vertex-blend` |
| FP09 | small convex face overflow | builds, 7 faces | pass, 7, err 8.3e-8 (F32 job input) | `overflow` |
| FP10 | 178.9° ridge | builds, 8 faces | pass, 8, err 1.2e-10 | pass-approx, err 1.2e-10 |
| FP11 | slot line, no propagation | builds, 7 faces | `vertex-blend` | `vertex-blend` |
| FP12 | tangent edge | **refuses** (FILLET_FAIL_SMOOTH) | `tangent-edge` | `tangent-edge` |
| FP13 | concave rim overflow r6.5 | builds, 5 faces | pass, 5, err 6.8e-12 | `overflow` |
| FP14 | mixed-convexity corner | builds, 12 faces (1 torus) | `mixed-convexity` | `vertex-blend` |
| FP15 | 120° chamfer d 1 | builds, 9 faces, dV -8.6603 | pass, 9, err 2.7e-12 | pass-approx, err 0 |
| FP16 | box-corner chamfer d 1 | builds, 10 faces, dV -29.3333 | pass, 10, err 9.1e-13 | `vertex-blend` |

- A builds 12 of the 15 probes Onshape builds, with Onshape's face count on
  all 12, and refuses FP12 as Onshape does. No prototype builds a case
  Onshape refuses (measured).
- On FP08 A's result is the extended-mitre closed form +8.967555, and A's own
  divergence-theorem volume agrees with OCCT's reading of A's STEP to 9e-8.
  All 11 planar faces of A's FP08 result have exactly Onshape's face areas
  (456, 600, 180, 180, 120, 120, 100, 4 × 10 mm²; `uv run
  tmp/fillet/judge/faces.py`, measured). The 3.5e-3 mm³ gap therefore is not
  in the planar trims. **Conjecture:** Onshape's mass-property value is
  approximate for this body (its own bounds are ±0.75 mm³). OCCT's blend for
  this case is invalid.

Why A and not C as the default:

- A is exact. C labels every blend approximate by design, and its
  analytic-carrier variant only reaches the same carriers within 1e-9 mm.
- A builds 24 catalogue cases that C refuses. They are the mitres, loops,
  corners, chains, face consumption and notches that make up Marc's corpus
  (fillet.md §2.4). C builds no catalogue case that A refuses (measured,
  crosscheck).
- A is faster on the common set (§6).
- C builds exactly one adversarial case that A refuses:
  `adv-rb-step-convex-into-riser`, which A over-refuses (§7).

### 1.2 What the judge ran (measured)

| run | cases | verdicts | targets agree | load (1/5/15 min) start → end |
|---|---|---|---|---|
| null, catalogue | 71 | declined 53, expected-refusal 18 | 71/71 | 8.3/36.4/32.0 → 7.4/34.8/31.5 |
| oracle-occt, catalogue (replay) | 71 | pass 53, no-source 16, expected-refusal 1, mismatch 1 | - | 7.4/34.8/31.5 → 7.4/34.8/31.5 |
| A, catalogue | 71 | pass 63, expected-refusal 8 | 71/71 | 7.4/34.8/31.5 → 9.5/32.3/30.7 |
| C-tori, catalogue | 71 | pass-approx 39, declined 15, expected-refusal 17 | 71/71 | 9.5/32.3/30.7 → 10.4/29.4/29.7 |
| C-spline, catalogue | 71 | pass-approx 39, declined 15, expected-refusal 17 | 71/71 | 10.4/29.4/29.7 → 10.0/23.2/27.2 |
| null, A's adversarial file | 31 | all refused | 31/31 | 10.0/23.2/27.2 → 15.1/21.0/25.9 |
| A, A's adversarial file | 31 | pass 15, expected-refusal 10, step-fail 6 | 31/31 | 15.1/21.0/25.9 → 13.6/19.1/24.5 |
| C-tori, A's adversarial file | 31 | expected-refusal 18, declined 9, tight-fail 4 (tol label only) | 31/31 | 13.6/19.1/24.5 → 33.4/20.9/24.0 |
| C-spline, A's adversarial file | 31 | same verdicts as C-tori | 31/31 | 33.4/20.9/24.0 → 58.7/53.5/38.3 |
| null, C's adversarial file | 32 | all refused | 32/32 | 58.7/53.5/38.3 → 51.0/52.2/38.1 |
| A, C's adversarial file | 32 | pass 23, expected-refusal 4, declined 1, step-fail 4 | 32/32 | 51.0/52.2/38.1 → 32.5/47.4/37.0 |
| C-tori, C's adversarial file | 32 | expected-refusal 8, declined 2, tight-fail 22 (tol label only) | 32/32 | 32.5/47.4/37.0 → 33.3/45.7/37.0 |
| C-spline, C's adversarial file | 32 | same verdicts as C-tori | 32/32 | 33.3/45.7/37.0 → 20.0/39.8/35.4 |

- Commands: `tmp/fillet/judge/runall.sh` (harness runs) and
  `tmp/fillet/judge/post.sh` (cross-checks, tight checks, strict STEP, tests);
  every step has a log and a completion marker next to the worklog.
- All native builds were cached with keys that match the current sources
  (the build key is the Bend version plus the `native.bend` import closure).
- "step-fail" means validator, tight check and closed form pass, but strict
  STEP validation of the exported file fails (§7).
- "tight-fail" for C means only the rule "every face states tol 0". The judge
  filtered it out: no C result has any other tight-check issue (measured).
- Across all 189 adversarial runs of the three prototypes (63 cases × A,
  C-tori, C-spline) no prototype returned a wrong or invalid `ok`, and all targets agreed byte for byte
  (measured).
- `node --test` over the seven fillet test files: 55/55 pass in 6.4 s. The
  validator self-test gives 15/15 (measured).

## 2. Which engine covers what

"Measured" rows are named catalogue or adversarial cases. B does not exist
yet, so every B entry is conjecture.

| configuration | A (v1) | C | OCCT | Onshape | owner after v1 |
|---|---|---|---|---|---|
| plane/plane line, any dihedral, convex or concave, perpendicular caps | exact (41 core cases pass) | pass-approx 1e-9 | builds | builds | A |
| hole and boss rims (torus), spindle torus (r < ρ), sphere dome at r = ρ | exact (`pc-post-top-rim-*`, `pc-hole-*`) | pass-approx | builds | - | A |
| chamfers: plane, cone on rims, setback along the faces (FP-a) | exact; matches the in-support closed form on 60° and cone rims | pass-approx | builds (same reading), fails `ch-cone-rim-0.42` | FP15 builds | A |
| oblique planar caps (ellipse on the blend) | exact (constructed stage-2 cases; `adv-rb-cap-tilt-7.6e-7-r1/r5` match the closed form to 1e-12 by divergence volume) | refused `vertex-blend` above 1e-9/r rad of tilt, naming the needed tolerance | - | - | A |
| caps on a curved face (space quartic) | refused `not-implemented` | refused | - | FP11 builds (conjecture that this is the reason) | A later, or B |
| trimmed mitres, G1 chains, closed loops | exact | refused `vertex-blend` | builds | - | A |
| extended mitres beside an opposite-convexity edge | exact (FP08) | refused | invalid | FP08 builds | A |
| setback mitres (unequal sweeps) | exact for fillets with trimmed outer face (`adv-wedge`, `adv-trapezoid-top-loop-r1`, `adv-drafted-pocket-floor-loop-r1`); semantics **not probed** | refused | builds (trapezoid) | not probed | A behind a probe (§8 step 7) |
| chamfer setback mitre, extended setback mitre | refused `vertex-blend` | refused | - | not probed | A later |
| sphere corners (3 fillets, same convexity) | exact | refused | builds | - | A |
| chamfer corner (3 chamfers) | exact, Onshape's corner triangle | refused | builds (same triangle) | FP16 | A |
| mixed-convexity corner | refused `mixed-convexity` | refused | builds (FP14 matches Onshape to 2.7e-12) | FP14 builds with a torus | A later (analytic), OCCT as reference |
| face consumption: full round, r = width, near full round | exact | refused `face-consumed` | fails | FP03, FP04 build | A |
| overflow on one side as a notch (strip or annulus neighbour, fillets) | exact (FP01, FP02, FP07, FP09, FP13) | refused `overflow` | fails | builds | A |
| two equal fillets overlapping on a strip | exact (FP05, notch r3) | refused | fails | builds | A |
| overlap next to mitres, overflow on both sides, chamfer overflow | refused (`blend-overlap`, `overflow`) | refused | fails | FP06 builds | **B** (conjecture) |
| tangent edge selected | refused `tangent-edge` | refused | refuses | refuses (FP12) | A |
| near-tangent ridge (178.9°; normals 1e-5, 5e-6 and 1e-7 rad apart) | exact on all four | pass-approx at 178.9°, 1e-5 and 5e-6 rad (after its fix D1); refused `tangent-edge` at 1e-7 rad (its threshold) | refuses FP10 | FP10 builds | A |
| hole entering the blend strip (`adv-rb-hole-near-edge-*`) | refused `overflow` (exact width test) | refused `overflow` after fix D2 (certified) | builds | - | A; B for a notch around the hole |
| non-analytic pairs (B-spline edges, oblique holes, crossed cylinders) | refused `unsupported-surface` | the only engine that can blend them; no catalogue input exists | builds | builds | **C-spline, opt-in** |
| convex edge into a perpendicular riser (`adv-rb-step-convex-into-riser`) | **declined** by the prototype (`vertex-blend`, reflex face corner); **exact since step 2** (riser cap, closed form 4.5e-13) | builds, matches the closed form to 6.8e-13 | builds | - | A |
| concave seam of a narrower block on a wider wall, ending at the wall's reflex corner (R20 `edge.fs:807`) | **exact since fillet-setback** (the riser cap's concave dual; fillet and chamfer) | not run | not run | builds: probe RS-F/RS-C, `fixtures/fillet/reflex-setback-reference.json` | A |

- **Covered today (measured on the catalogue).** A covers every
  configuration of Marc's strict and extended analytic classes that the
  catalogue contains. These are the 23-30 of 39 corpus families of fillet.md
  §2.5. A also builds 10 of the 14 `either` cases, including the
  overflow families that fillet.md expected to need B.
- **Left for later.** FP06, FP11 and FP14 are built by Onshape and refused
  by A. All three are analytic in Onshape's result (cylinders and one torus),
  so **conjecture:** they are an A extension (vertex blends and curved caps),
  not B.

## 3. How A and C combine

### 3.1 C as the cross-check (measured)

`node scripts/fillet/crosscheck.mjs` on the judge reports:

| pair | both build | volumes agree | worst volume difference | same face count | only first | only second |
|---|---|---|---|---|---|---|
| A vs C-tori | 39 | 39 | 5.91e-12 mm³ | 38 | 24 | 0 |
| A vs C-spline | 39 | 39 | 1.00e-6 mm³ (inside C's stated tolerance) | 38 | 24 | 0 |
| A vs OCCT replay | 52 | 52 | 1.09e-11 mm³ | 50 | 11 | 2 (FP11, FP14) |

- The carrier type agrees on every stripe both build (A cylinder, C-tori
  `cylinder~`, and so on).
- The only face-count difference, `pc-post-base-concave-r1` (6 against 7), is
  A's coplanar-fragment merge. The same merge explains
  `hard-fillet-after-boolean-fragments-r1` against OCCT (15 against 50).
- A and C are independent: separate solvers (closed-form 2D ladder against a
  Gauss-Newton station solver), separate overflow tests (exact width bounds
  against certified bisection over the edge) and separate surgery. They agree
  on 39 of 39 common cases on the catalogue and on every common adversarial
  case (measured). This is the property exact-plane has for the Boolean.

**Plan (conjecture):** C-tori runs in CI on every harness case, and as an
opt-in "paranoid" mode at run time. Whenever both build, a volume difference
above 1e-9 × V or a different carrier type fails the test or the operation.
On the common set C-tori costs 1.9x A at one thread (260 against 137 ms,
measured §6), so paranoid mode is affordable for single operations but not
worth enabling by default.

### 3.2 C as the opt-in tolerance stage

- **Dispatch (conjecture).** A runs first. Only if A refuses with
  `unsupported-surface` (a non-analytic pair), and the model or call has opted
  in with a tolerance τ, does C-spline run. Its faces carry their stated
  tolerance (1e-9 to 1e-7 mm measured after its fix D6). If the needed
  tolerance exceeds τ, the result is a refusal that names the needed
  tolerance, never a silent growth (Marc's decision 10, measured behaviour of
  C's cap test: "up to 1e-6 mm").
- **Never for** classes where Onshape refuses (`tangent-edge`), must-refuse
  classes (`radius-too-large`, overflow on both faces), or A's `vertex-blend`
  and `blend-overlap` refusals. On all suites C builds exactly one case that
  A refuses (the over-refusal of §7, measured); that gap belongs fixed in A,
  not masked by an approximate stage.
- **Value today: none measured.** No catalogue case is a non-analytic pair,
  because wonky cannot build such inputs yet (fillet.md §5.3). The stage
  earns its keep once B-spline profiles and oblique holes exist (conjecture).
  It is therefore late in the plan (§8 step 9).
- **Before production** C-spline needs vertex handling: mitres and caps
  against non-planar faces. That work is only worth doing once real inputs
  exist.

## 4. Where candidate B fits

B (fillet by Boolean: the blend tool body from A's ladder, applied by the
hybrid Boolean with declared tangency) waits until the hybrid Boolean
(`docs/hybrid-boolean-plan.md`) is the production Boolean and supports
declared tangent pairs.

- **Its targets are A's refusals that Onshape builds and that are not simple
  A extensions:**
  - overlap next to mitres (FP06);
  - overflow on both sides of an edge;
  - chamfer overflow;
  - a notch around a hole that enters the blend strip
    (`adv-rb-hole-near-edge-sampled-overflow`);
  - overlapping chamfers on non-coaxial cones (KS04, §8 step 5), whose
    intersection is a quartic that A's exact curve set cannot hold.

  All of this is conjecture until B exists.
- **B also becomes the second oracle for A's notch results.** On the cases
  both build (FP01, FP05, FP07, FP09, FP13), the volumes must agree within
  1e-9 × V. Today these cases rest on Onshape alone, and OCCT fails all of
  them (measured).
- **B reuses A's ladder.** The shared stripe geometry
  (`kernel/fillet/ladder`, §8 step 2) makes the tool bodies, so A and B differ
  only in the attachment (fillet.md §5.0).
- **Its known risks stand.** Tangent contacts are the hardest Boolean case.
  The Boolean judge refused both corpus tangent cases (hybrid plan §5), and a
  full Boolean per fillet is orders of magnitude slower than A's ≤ 94 ms
  cpu1 worst case (conjecture from the hybrid timings).
- **Dispatch (conjecture).** A first, then B for the refusal classes
  `overflow` and `blend-overlap` only, then a typed refusal. `tangent-edge`,
  `radius-too-large` and `mixed-convexity` never go to B.

## 5. Torus and sphere as production types

- **The production types exist now (measured, by reading
  `kernel/analytic.bend`, 24 September 04:45).**
  - `Sphere{origin, axis, x, radius}`.
  - `Torus{origin, axis, x, major, minor}`, whose point set is
    `(rho − major)² + h² = minor²`. For a spindle torus (minor > major) only
    the sheet on the tube-centre side is kept.
  - Both come with rigid transforms and signed distances. The r20-gate
    workflow is extending tessellation, STEP and Boolean support for them.
- **A's carriers map one to one.** `J.SSphere{o, a, x, r}` →
  `Sphere{origin, axis, x, radius}`, and `J.STorus{o, a, x, big, small}` →
  `Torus{origin, axis, x, major, minor}`. The field order and meaning are the
  same (measured, by reading `kernel/proto/fillet-kpart/job.bend`). C uses the
  same shape in `fillet-rollingball/job.bend`. Since step 1 the mapping is
  Bend code (`kernel/fillet/production.bend`), measured identical to the
  harness decoder on all 134 of A's results (§8 step 1).
- **Spindle sheet (measured in step 1 for STEP and tessellation).**
  - A convex rim fillet with r < ρ spans rho ∈ [major, major + r] (from the
    cap contact above the ball centre to the side contact). That is the outer
    ("apple") sheet on the tube-centre side, so the production convention
    holds: both spindle rims pass strict STEP as `DEGENERATE_TOROIDAL_SURFACE`
    with select_outer .T. at their prototype volume (1.7e-15 × V), and
    `printMesh` meshes them within its stated deviation. `kernel/volume.bend`
    refuses spindle tori and `classifySolid` refuses torus faces (follow-ups
    F2, F3 of step 1).
  - Acceptance: `pc-post-top-rim-spindle-r3.5` and `pc-post-top-rim-r4.99`
    through production tessellation, STEP and classification, with the same
    volume as the prototype.
  - r > ρ (the ball centre crosses the axis) stays `radius-too-large`. At r = ρ, A emits a sphere
    (measured, `pc-post-top-rim-sphere-r5`).
- **Frames and parameter curves.**
  - A frames its corner spheres on their bounding arcs (verifier fix,
    measured). Since that fix, `pp-box-corner-3-r2`, `pp-box-all-edges-r2`
    and `corpus-probestab-all-edges-r1` meet their closed forms to ≤ 9.1e-13
    through STEP and pass strict STEP.
  - Two families of results failed strict STEP through the harness's
    result writer, which writes no pcurves (both pass through the production
    writer since step 1):
    - mitre ellipses on cylinders: 3 catalogue cases, and OCCT's own blends
      fail the same way;
    - the oblique third arc of a sheared-box sphere corner.
  - Production already writes explicit pcurves for trimmed cylinders,
    ellipses included (`docs/step-cylinder-pcurves.md`), and for spheres
    bounded by circles of two directions (r20-gate Regression review 1).
  - **Measured (step 1):** A's mitre results pass through the production
    exporter (planner charts). Oblique sphere corners pass once the frame
    keeps its poles off the boundary arcs (the r20 frame put a pole inside a
    meridian arc of the sheared-box corners). A's trimmed tori need no
    explicit pcurve: every boundary circle is a latitude or a meridian.
- **Downstream.** A fillet result feeds later Booleans. Every torus and
  sphere face A emits must therefore be supported by production tessellation,
  classification, recover and STEP (r20-gate tasks 3 and 9). The fillet
  integration depends on those tasks and does not duplicate them.
- **Per-face tolerance in production (conjecture).** C-spline output needs a
  production face record with a stated tolerance and a B-spline surface. That
  is a production format change, and it is only needed for the opt-in stage
  (§8 step 9).

## 6. Performance

All numbers are compute phase, summed over the cases (ms), from the judge
reports. The machine was shared; the load is in §1.2.

| | js | cpu1 | cpu18 | metal |
|---|---|---|---|---|
| A, all 71 cases | 1,131 | 224 | 304 | 10,058 |
| C-tori, all 71 | 5,920 | 403 | 401 | 7,398 |
| C-spline, all 71 | 32,583 | 2,937 | 1,813 | 7,532 |
| **common set (39 cases all three build):** A | 582 | **137** | 183 | 6,119 |
| C-tori | 3,632 | 260 | 273 | 4,374 |
| C-spline | 16,526 | 1,481 | 966 | 3,763 |

Largest cases, compute ms js / cpu1 / cpu18 / metal:

| case | A | C-tori | C-spline |
|---|---|---|---|
| perf-comb-vertical-edges-r0.5 (50 edges, 102 faces) | 168 / 94 / 128 / 2,859 | 1,834 / 157 / 147 / 212 | 8,195 / 719 / 384 / 686 |
| perf-hole-grid-rims-0.42 | 44 / 11 / 12 / 237 | declined | declined |
| corpus-r22-guide-outline-chamfer-0.42 (the case OCCT fails on the real file) | 56 / 8 / 16 / 187 | declined | declined |
| pp-box-all-edges-r2 | 24 / 6 / 7 / 230 | declined | declined |

- **A is milliseconds (measured).** Its median is 1 ms at cpu1, and its worst
  catalogue case takes 94 ms. A native process starts in about 4 ms (median
  `startupMs`). The JS target costs about 110 ms of module load plus 4.5x the
  cpu1 compute (geo-mean over cases ≥ 5 ms).
- **Threads do not help A (measured).** Only one catalogue case reaches
  20 ms at cpu1, and there cpu18 is slower (0.73x). The fork-join over edges
  costs atomic reference counts on shared data (A1 report, Bend 2.0.25
  CPU-pool trap as in the hybrid plan §3). C-spline, which has real per-station
  work, gains 1.78x at 18 threads (geo-mean over its 34 cases ≥ 20 ms).
- **Metal does not pay (measured).**
  - metal/cpu18 geo-mean over cases ≥ 20 ms at cpu1: A 22.3 (one case),
    C-tori 2.82, C-spline 4.08.
  - A Metal process of any prototype costs about 60-80 ms of start-up alone.
  - A's device program is still only stages 1-2; its surgery runs on the CPU.
  - Decision: fillets run on the CPU pool, `--gpu off`, as for the Boolean.
  - Since Regression review 1 (25 September 2026) `kernel/fillet/native.bend` marks
    no device call, so a Metal build of the production fillet runs it on
    the CPU and gives cpuN's text. The device stage wrote different texts
    (subnormal flush) and overflowed the device stack on the exact
    escalation; see "Regression review 1 (measured)".
- **Where the time will go in production (conjecture).**
  - The fillet is not the cost of a fillet operation. Tessellating new torus
    and sphere faces for the next Boolean and the STEP pcurves will dominate.
  - A first measurement belongs in the KS acceptance (§8 step 5): report
    fillet compute, re-tessellation and export separately.
- **Builds (from the stage reports, measured there).** A cpu 45.7 s and
  Metal 1,322 s under load; C-tori cpu 17 s and Metal 37 s. A's Metal build
  time is one more reason to keep Metal out of the fillet path.

## 7. Verifier defects that gate production

The judge re-ran every prototype on both verifiers' adversarial files and ran
every prototype on the other team's file as well. Status as of this run
(measured unless marked):

| engine | defect | severity | judge status | closed by |
|---|---|---|---|---|
| A | sphere-corner frame made the STEP inexact (4.5e-9 × V) and invalid under exact CurveOnSurface | medium | **fixed**: box-corner cases meet the closed form to ≤ 9.1e-13 through STEP and pass strict STEP. The oblique corner of `adv-sheared-box-all-edges-r1` failed through the harness writer; **fixed in step 1** (production writer, cap frame): strict STEP passes | step 1 (production pcurves) |
| A | drafted-prism mitres of unequal sweep refused | medium | **fixed** as setback mitres (`adv-trapezoid-top-loop-r1`, `adv-wedge-setback-mitre-r1` and `adv-drafted-pocket-floor-loop-r1` build; their divergence volumes equal the closed forms to ≤ 1.8e-12 in the judge run). The semantics is the fixer's own derivation and was **not probed in Onshape** | step 7 (probe before enabling) |
| A | refusal reasons round to 6 decimals: "needs width 1.000000 but the spring of edge 8 lies at 1.000000", "torus major -0.000000 < 0" | low | **fixed in step 0**: needed and available values with ten significant digits and their difference, e.g. `adv-step-1e-7-front-top-edges-r1` "needs width 1.000000000e+0 but the spring of edge 8 lies at 9.999999000e-1 (short by 1.000e-7; blends overlap)", `adv-post-rim-rho-plus-1e-7` "torus major -1.000000012e-7 < 0: the radius exceeds the largest feasible by 1.000e-7" | step 0 |
| A | **new (judge):** at r = width − 1e-9 and r = ρ − 1e-9, A keeps a 1e-9 mm sliver face and edges, below the 1e-6 mm modelling tolerance. The geometry is exact (divergence volume = closed form to 1e-12), but OCCT's import merges the slivers ("topology differs 11 != 15 edges") and the STEP volume is off by 3.3e-8 | medium | new, `adv-rb-box-r-width-minus-1e-9`, `adv-rb-post-rim-r5-minus-1e-9`. C refuses both inputs (the box as `face-consumed` since its fix D5, the post rim as `not-implemented`) | step 3 (one sliver policy for both engines) |
| A | **new (judge):** `adv-rb-step-convex-into-riser` (a convex step edge ending at a perpendicular riser that covers the spandrel end) is declined as `vertex-blend` ("reflex face corner; setback patch needed"). C-tori builds it, and it matches the closed form (6.8e-13), OCCT (0.0) and strict STEP. It is a perpendicular cap, inside v1 scope | medium (over-refusal, not wrong) | **fixed in step 2** (kernel/fillet riser cap; js and cpu1): closed form 4.5e-13, C-tori 2.3e-13, strict STEP valid; the prototype keeps the refusal as the reference | step 2 |
| A | boundary decisions use tolerance bands in F32x2 (vertex merge 1e-9 mm, edge match 1e-7 mm, width and mitre gaps 1e-9 mm). Only the sphere-corner rank test is exact | high (the fillet.md §5.1 risk) | open. The adversarial cases at 1e-7 and 5e-9 mm steps, the 1e-9 kink and ρ ± 1e-7 are typed refusals, and nothing was wrong. That is not a proof | step 3 |
| C | D1 near-tangent ridge with the blend face inverted | high | **fixed**: `adv-rb-ridge-normal-1e-5rad` and `-5e-6rad` build, tight check clean | - |
| C | D2 sampled overflow missed a hole in the strip | high | **fixed**: both hole cases `overflow`, controls build. A refuses them too (exact width test) | - |
| C | D3 270° section at r = 1e-5 | high | **fixed**: tiny radius cases build in both engines | - |
| C | D4 tilted caps admitted as perpendicular | high | **fixed**: tilt 7.6e-7 refused, naming the needed tolerance. A builds these caps exactly | - |
| C | D5 1e-9 mm sliver faces | medium | **fixed** in C (refused `face-consumed`); the same inputs expose A (above) | step 3 |
| C | D6 spline STEP failed strict validity | medium | **fixed**: strict STEP passes on 39/39 catalogue and 26/26 adversarial results (both files) in the judge run | - |
| C | D7 post rim r = 5 − 1e-9 refused as `not-implemented` instead of a sphere cap or `face-consumed` | low | still open (typed refusal, not wrong) | not needed for production |
| harness | result STEP writer (`scripts/bakeoff/recover-stepx.mjs` via `validate.mjs resultStep`) writes no pcurves for analytic faces: mitre ellipses and oblique caps fail strict STEP (A: 3 catalogue cases; 8 adversarial: 5 mitre ellipses, 2 oblique caps, 1 oblique sphere arc; OCCT replay: the same 2 mitre cases) | low (harness only) | **closed in step 1**: A is graded through the production exporter and strict STEP gates it: catalogue 63/63 (with the step-1 fix of the expected volume), A's file 19/21, C's file 25/27; the four left are sub-tolerance topology (3, step 3) and the 1e6 mm envelope (1) | step 1 |
| harness | the main runner grades through OCCT's reading of the exported STEP. Where the writer is lossy the volume is off: A's exact tilted-cap result is 6.8e-6 mm³ off through STEP and 1e-12 by divergence volume | medium | **fixed in step 0**: every pass is also graded by the divergence volume (`grade.mjs`, cones added to `divvolume.mjs`) against the closed form on the job's geometry to 1e-9 × V; A 63/63, worst 4.3e-15 × V | step 0 |
| harness | `validate.mjs` accepts a support plane moved by 1e-8 mm and a blend radius off by 5e-8 (GEOM_TOL 1e-6, RADIUS_TOL 1e-7), and never G1-checks junctions ≥ 0.1 rad; `tightcheck.mjs` closes all three but is only wired into the adversarial runner | low | **fixed in step 0**: `run.mjs` grades every pass by the tight check (`tight-fail`); the self-test has both mutations (22/22) | step 0 |
| harness | `ch-convex-60-d1` and `ch-cone-rim-0.42` still accept the face-offset primary (`acceptAlternatives: true`), so a face-offset chamfer would pass although Onshape FP-a rejects that reading | medium | **fixed in step 0**: setback primary, face offset a rejected alternative; the face-offset mutant is `mismatch` | step 0 |
| harness | job files carry F32-rounded sketch coordinates; closed forms at non-axis angles are off by up to 1.5e-9 × V (`pp-convex-60-r2`), and FP09 differs from Onshape by 8.3e-8 | low | **fixed in step 0** by closed forms on the job's geometry (the kernel's sketch path rounds to F32, `src/kernel.mjs vector`, so the fixture builder cannot give binary64 inputs); FP09 has a notch closed form (design = Onshape to 5.3e-13; job = A to rounding, the 8.3e-8 is the input rounding) | step 0 |
| harness | the adversarial runner's "every face states tol 0" rule marks all C results `tight-fail` | low | **fixed in step 0**: the rule follows the prototype's claim (`prototypes.mjs`: A exact, C approximate; an approximate blend's stated tolerance must hold) | step 0 |

**Oracle limits (measured).** No oracle is safe alone, so acceptance tests use
at least two:

- **OCCT.** Its replayed blends pass on 53 of the 71 catalogue cases (52 `ok`
  cases and FP14). It is wrong on FP11
  (ignores `tangentPropagation: false`, 10 against Onshape's 7 faces) and
  invalid on FP08. It fails every face-consumption, notch and overflow case
  that Onshape builds, and `ch-cone-rim-0.42`. It does build FP14 exactly as
  Onshape does (2.7e-12), which makes it a usable reference for the
  mixed-convexity corner.
- **Onshape.** Its mass-property value can be approximate (FP08, conjecture
  above). Its face areas are mesh areas.
- **Closed forms.** They exist for 57 catalogue cases; they are derivations
  (INFERRED labels in `cases.json`) that A, OCCT and the Onshape probes
  confirm.
- **Divergence volume** (`divvolume.mjs`). It is independent of OCCT and STEP
  and agrees with the closed forms to ≤ 1e-11 where the input is not
  F32-rounded, but it has no cone support yet.

## 8. Ordered integration plan

Every step keeps `npm test` green and adds its acceptance test. Steps 0-3
come before the production dispatch changes. "The suites" means the
catalogue (`node scripts/fillet/run.mjs`) plus both adversarial files
(`node scripts/fillet/run-adversarial.mjs`), on all four targets.

0. **Harness hardening (fillet paths only).**
   - `cases.json`: make the in-support (setback) form primary for
     `ch-convex-60-d1` and `ch-cone-rim-0.42`, and set `acceptAlternatives:
     false`, as already done for FP15.
   - Grade every `ok` result also by `divvolume.mjs`; add cones to it.
   - Wire `tightcheck.mjs` and strict `verify-step.mjs` into `run.mjs`. Make
     the "tol 0" rule depend on the prototype's claim: exact for A,
     approximate for C.
   - Regenerate the jobs from binary64 sketch coordinates. That is the
     fixture builder's work; if it cannot, compute the closed forms from the
     job geometry.
   - Make A's refusal reasons print the needed and the available value with
     their difference in exponent form.
   - *Acceptance:*
     - A stays at 63 pass / 8 expected-refusal;
     - a face-offset chamfer mutant fails `ch-convex-60-d1`;
     - the mutation self-test gains the three `tightcheck` mutations
       (moved plane 1e-8, radius 5e-8, tol) and stays green;
     - `adv-step-1e-7-front-top-edges-r1` reports a difference of 1e-7, not
       "1.000000 vs 1.000000".
   - **Status: done, 24 September 2026** (workflow fillet-prod, stage
     s0-harness; worklog local development evidence, run script
     `tmp/fillet-prod/s0/runall.sh`, reports `out/fillet/fillet-kpart` and
     `out/fillet/s0/`). Measured on all four targets, one run at a time
     (load 90-145 from other workflows):
     - A, catalogue: 63 pass / 8 expected-refusal, targets byte-identical
       71/71; every pass also passes the tight check (63/63) and the
       divergence volume against the closed form on the job's geometry
       (63/63, worst 4.3e-15 × V); strict STEP 60/63, the same three mitre
       cases (reported, gated only with `--step-gate` until step 1). 66 of
       A's 71 result texts are byte-identical to the judge run; the other 5
       differ only in their refusal text.
     - A, adversarial files: 15 / 10 / step-fail 6 and 23 / 4 / declined 1 /
       step-fail 4, as in the judge run; tight and divergence volume clean on
       all 48 results.
     - C-tori and C-spline under the claim "approximate": catalogue 39
       pass-approx as before; the adversarial "tight-fail (tol label only)"
       verdicts (4 and 22) are now pass-approx, and every stated tolerance
       holds. C-spline's B-spline faces are reported as unsupported by the
       divergence volume, never guessed. Null and the OCCT replay give the
       judge's verdicts; the replay's FP14 torus now passes the grounded rule
       (vertex blend), FP11 stays a mismatch.
     - The face-offset chamfer mutant of `ch-convex-60-d1` is `mismatch`
       (and would pass under the pre-hardening entry); the self-test is
       22/22 with the moved plane, the radius and the tol mutations; the
       fillet tests are 64/64; `onshape-oracle.mjs --check` is up to date.
     - `adv-step-1e-7-front-top-edges-r1`: "needs width 1.000000000e+0 but
       the spring of edge 8 lies at 9.999999000e-1 (short by 1.000e-7; blends
       overlap)".
     - Jobs stay F32: the kernel's sketch path rounds to F32
       (`src/kernel.mjs vector`), so 42 cases carry a closed form on the
       job's geometry (`closedform.mjs`), including every F32-rounded one,
       and FP09 has a notch closed form (design = Onshape to 5.3e-13).
1. **Production types and export for A's output** (depends on r20-gate
   tasks 3 and 9).
   - Map `SSphere`/`STorus` to the production `Sphere`/`Torus`.
   - Export A's results with the production STEP writer (explicit pcurves on
     cylinders, spheres and tori).
   - *Acceptance:*
     - strict `validate-step.py` passes on all 63 catalogue results and on
       every built adversarial result: 21 of A's file and 27 of C's file,
       today 60/63, 15/21 and 23/27 through the harness writer;
     - the spindle rims keep their prototype volumes to 1e-12 × V through
       production tessellation and classification;
     - KS06 and KS08 (no blends; they use the sphere and torus types) stay as
       the r20 gate measured them.
   - **Status: done where the exporter decides; four results and the
     production volume and classification of spindle and curved blends are
     named gaps, 24 September 2026** (workflow fillet-prod, stage
     s1-types-export; worklog local development evidence,
     run script `tmp/fillet-prod/s1/runall.sh`, reports `out/fillet/s1/`,
     follow-ups `tmp/fillet-prod/followups/s1-types-export.md`). The runs used
     an isolated tree, HEAD plus the fillet workflow's changes
     (`tmp/fillet-prod/s1/mktree.sh`), because the adversarial runner builds
     its inputs through `loadKernel()`, which the parallel hybrid-robust
     workflow's in-flight `kernel/hybrid` edits broke for a while. All four
     targets, one run at a time (load 40-170 from other workflows).
     - **Types (measured).** `kernel/fillet/production.bend` reads A's
       result text and maps it onto `kernel/analytic.bend`: `J.SSphere` →
       `Sphere` and `J.STorus` → `Torus` with the same fields, planes,
       cylinders and curves one to one, a cone with a negative angle to the
       reversed axis with the positive angle, and a whole closed circle to a
       periodic edge without a range (the production convention). A face that
       states a tolerance, a non-positive radius, a cone half-angle outside
       (0, π/2) or a malformed text is refused by name. `src/fillet.mjs`
       decodes the solid into the production body. All 134 of A's results
       (111 built, 23 refusals) map identically to the harness decoder, and
       Bend's incidence validation (`decodeAnalytic`) passes on all 111
       (`tmp/fillet-prod/s1/check-map.mjs`; `test/fillet-production.test.mjs`).
     - **Export (measured).** The harness grades A through `src/exporters.mjs`
       (`prototypes.mjs` `stepWriter: 'production'`), and strict STEP gates A.
       Two writer changes, both for bodies the writer used to refuse or
       break: a sphere face whose frame puts a pole inside a boundary arc
       (A's sheared-box corners: the reader split the arc at the pole) gets a
       certified cap frame, poles 90° from the face (`sphere_face_frame`,
       `kernel/step-pcurves.bend`); and an unresolved cylinder plan is no
       longer fatal when every cylinder boundary is a parameter line, whose
       parameter curve every reader builds exactly (`cylinder_lines_only`;
       A's 1e7 and 9e3 mm top edges). Tori need no explicit parameter curve
       for A's output: all 100 boundary circles of A's 25 torus faces are
       latitudes or meridians (census). The 66 mitre and cap ellipses on
       cylinders get the planner's explicit curves.
     - **Strict STEP (acceptance 1):** catalogue 63/63 through the
       production writer, gating, all four targets agreeing on 71/71
       (second pass, `tmp/fillet-prod/s1/runall2.sh`; tight 63/63,
       divergence 63/63, worst 4.3e-15 × V). The first pass had 62/63
       because of a harness defect found here: FP08 has no catalogue
       closed form and Onshape's value is only in range, so run.mjs compared
       the (valid) STEP with the volume of OCCT's *invalid* blend. Fixed: the
       expected volume is a matching reference or the result's divergence
       volume, never an unmatched oracle's (FP08 now 3808.9675548296 against
       its divergence volume 3808.9675548236). A's file 19/21, C's file 25/27
       (before: 60/63, 15/21, 23/27 through the harness writer). The four left
       are not exporter defects:
       - `adv-rb-box-r-width-minus-1e-9`, `adv-rb-post-rim-r5-minus-1e-9`:
         1e-9 mm slivers, merged by OpenCascade's 1e-7 mm confusion at any
         stated uncertainty (step 3, sliver policy);
       - `adv-post-rim-rho-minus-1e-6`: a top disc of radius 1e-6 mm. The
         production writer states the body's vertex tolerance, 3e-4 mm for
         kernel bodies; at that uncertainty OpenCascade finds the STEP
         invalid (`invalid`), at ≤ 1e-6 mm it passes (tested by editing the
         file). Sub-tolerance topology under production semantics: step 3
         must choose between the kernel's 3e-4 mm and the fillet program's
         1e-6 mm;
       - `adv-far-1e6-box-top-loop-r2`: mitre ellipses at 1e6 mm, beyond the
         kernel's ±1e4 mm envelope; the cylinder planner is unresolved there
         and the export is refused by name (`step-fail`). Explicit curves
         there need a planner in local coordinates.
     - **Spindle rims (acceptance 2): not met as written.** Through the
       production STEP and OpenCascade the spindle rims keep their volumes
       (`pc-post-top-rim-spindle-r3.5` 715.723028805478 against 715.7230288054767,
       1.7e-15 × V), and the print tessellation (`printMesh`) meshes them
       within its stated deviation. But `kernel/volume.bend` refuses spindle
       tori (code 3) and `classifySolid` answers `UnsupportedSurface` next to
       every sphere, torus and cone face (cylinder blends classify). Both are
       production modules outside the fillet workflow; a draft
       `kernel/volume.bend` patch for spindle faces is follow-up F2, the
       classifier is the r20-gate gap of §5 (F3). Measured over all 111
       built results (`scripts/fillet/production-measures.mjs`,
       `out/fillet/s1/production-measures.json`): `integrateVolume` 104 to
       ≤ 5.5e-14 × V, the 4 spindle rims refused, 3 far or tiny cases over
       120 s; with the F2 draft patch both catalogue spindle rims integrate
       to 1.4e-15 and 4.0e-15 × V and every other torus result is
       bit-identical. `printMesh` meshes 92 of 108 (all spindle rims); it
       refuses mitre ellipses, three concave roots and the sheared-box
       sphere faces by name (F8). `classifySolid`: 0 wrong, all 37 results
       with sphere, torus or cone faces unresolved.
     - **KS06/KS08 (acceptance 3): met.** `node scripts/r20/acceptance.mjs
       --cases ks06,ks08` passes 2/2 in the step-1 tree and in a pure HEAD
       tree with the r20 gate's numbers (KS06b 946.376, 5.15e-10 stated;
       KS08 2260.152, 1.64e-7 stated), and their STL and manifests are
       byte-identical. KS06's STEP export is byte-identical to HEAD's (minus
       `FILE_NAME`) and passes strict `validate-step.py` (1892.7511616773 mm³
       = 2 × 946.37558); KS08's STEP is refused identically (a certified-mesh
       body). The sphere-frame change leaves every face whose own or first
       latitude frame keeps its poles off the arcs exactly as before.
2. **Port A into the kernel.**
   - Move the prototype to `kernel/fillet/` (ladder, corners, surgery, notch,
     bounds) on production types, with no proto-local carrier types, and keep
     the prototype directory as the reference.
   - Fix the over-refusal on `adv-rb-step-convex-into-riser`: a perpendicular
     cap on a riser that covers the spandrel end is a cap, not a setback.
   - *Acceptance:*
     - result text byte-identical to the prototype on all suites and targets,
       except the fixed case and type names;
     - `adv-rb-step-convex-into-riser` builds and agrees with C-tori and the
       closed form within 1e-9 × V;
     - the deterministic stripe order and the seam note are in the result
       record.
   - **Status: done on js and cpu1, 24 September 2026; cpuN and Metal are
     the integrate stage's** (workflow fillet-prod, stage s2-port; worklog
     local development evidence, run script
     `tmp/fillet-prod/s2/runall.sh`, reports `out/fillet/s2/p1` (pure port)
     and `out/fillet/s2/p2` (with the riser fix); an isolated tree, HEAD plus
     the fillet workflow's files, as in step 1).
     - **Port (measured).** `kernel/fillet/` holds job, geom, ladder, bounds,
       corners, notch, surgery, main and native. The carriers are
       `kernel/analytic.bend`'s `Surface` and `Curve` (`Plane`,
       `Cylinder`, `Cone`, `Sphere`, `Torus`, `Line`, `Circle`,
       `Ellipse`, same fields in the same order); the prototype's own
       carrier types are gone. The working topology (edges with their stated
       parameter range, loops, faces) stays fillet-local: the surgery reads the
       ranges, and the production `Edge` has none. A cone may carry a
       negative angle inside the fillet (analytic.bend's radius
       r + h·tan(angle) allows it); `production.bend` writes it with the axis
       reversed, as in step 1. The harness engine is `fillet`
       (`scripts/fillet/prototypes.mjs`); `kernel/proto/fillet-kpart` is
       unchanged and stays the reference.
     - **Byte identity (acceptance 1, js and cpu1).** Every result text on
       both targets plus the cpu1 ladder and network texts, compared with a
       fresh prototype run (`tmp/fillet-prod/s2/cmp.sh`): catalogue 284 of
       284 files identical, A's adversarial file 124 of 124, C's file 125 of
       128. The three that differ are the fixed case
       (`adv-rb-step-convex-into-riser`: both result texts and its network
       text; its ladder is identical). The pure port (pass p1) was
       byte-identical on all 536 files. The fresh prototype texts equal the
       stored step-1 texts on all 536 files. Verdicts: catalogue 63 pass / 8
       expected-refusal; A's file 19 / 10 / step-fail 1 / invalid 1 as in
       step 1; C's file 26 pass / 4 / step-fail 2 (step 1: 25 / 4 / declined
       1 / 2).
     - **Riser cap (acceptance 2, measured).** A spring end behind the vertex
       on the line of a convex cap edge is admitted as a cap (`corners.bend`
       `riser`) when the stripe is convex, the tip has no notch, the vertex
       has valence 3, the other cap edge is concave (the solid is locally
       H_i ∩ (H_j ∪ H_c), so the cap face's material lies behind the whole
       spandrel end), and a conservative ball certificate holds: every other
       edge of the body stays out of the ball around the vertex that holds
       the spandrel end, or lies wholly behind the cap plane in the material.
       The cap face grows over the spandrel end through the surgery's
       existing tip-point rule. `adv-rb-step-convex-into-riser` passes on
       both targets (one result hash): 14 vertices, 21 edges, 9 faces;
       closed form 1991.4159265358974, STEP volume 1991.4159265358978
       (4.5e-13), divergence volume 1991.415926535897; strict STEP valid;
       C-tori (judge report) differs by -2.27e-13 mm³ (1.1e-16 × V) with the
       same face count and carrier (`crosscheck.mjs`). The job prisms of
       `test/fillet-port.test.mjs` add the chamfer riser (d 1: -L d²/2) and a
       1 mm riser wall (builds, closed form). A riser block that starts 1 mm
       below the step is refused (`overflow`, by the width bounds), and a
       0.5 mm high riser is refused by the certificate although its fillet
       would be valid (conservative, typed). **No claim:** no constructed input
       shows the certificate alone preventing a wrong answer (the width bounds
       refuse the bad prisms first, and a pocketed FeatureScript input came
       out of the input Boolean fragmented), and the chamfer riser cap is not
       probed in Onshape.
     - **Record (acceptance 3).** `production.bend` `fillet(job)` returns
       the produced solid (or the typed refusal) with the stripe order
       (ascending edge index, tangent continuations added) and the notes
       ("seam-ignored e", "propagated e"); `src/fillet.mjs` `filletJob`
       exposes them (`body.fillet.order`, `.notes`). Tested on
       `fl-slot-one-line-propagate-r1` (propagation notes, a shuffled and
       repeated selection gives the same record and text) and on
       `pc-post-top-rim-r1` with its seam edge added (note, unchanged
       result). The harness result text has no field for them and stays
       byte-identical.
     - **Harness change (for the record).** `run-adversarial.mjs` now
       compiles the engine's `main.bend` before its JS runs, as `run.mjs`
       does: with a cold Bend cache every JS run was `error` (the worker's
       `--stack-size` flag stops it from starting the compiler worker).
3. **Exact decisions near boundaries.**
   - Replace the F32x2 tolerance bands (width, mitre gap, spring-on-edge,
     face consumption, vertex merge, edge pairing) with filtered predicates
     that escalate to exact arithmetic (`kernel/robust-predicates.bend`, as
     the sphere-corner rank test already does), plus an explicit `undecidable`
     refusal.
   - Adopt one sliver policy for A and C: a face or edge narrower than the
     modelling tolerance (1e-6 mm) is consumed exactly (merged) or refused
     with the needed tolerance, never emitted.
   - *Acceptance:*
     - sweeps r = w ± {1e-6, 1e-9, 1e-12} mm, r = ρ ± the same, the dihedral
       towards 180°, and chamfer d = w ± the same: the verdict changes only at
       the exact boundary or becomes a typed refusal;
     - rigid motions (rotation, translation to 1e4 and 1e7 mm) and uniform
       scale keep the verdict;
     - `adv-rb-box-r-width-minus-1e-9` and `adv-rb-post-rim-r5-minus-1e-9`
       give no sub-tolerance topology;
     - no wrong result on the suites.
   - **Status: done for A on js and cpu1, 25 September 2026; cpuN and Metal
     are the integrate stage's; C is unchanged** (workflow fillet-prod, stage
     s3-exact; worklog local development evidence, suite script
     `tmp/fillet-prod/s3/runall.sh`, reports `out/fillet/s3/p1`, sweeps
     `out/fillet/s3/sweeps-js-cpu1/report.json`).
     - **Exact decisions (measured on the sweeps).** New modules
       `kernel/fillet/exact.bend` (dyadic numbers on
       `robust-predicates.bend`'s big integers, and `u + v·√p` with an exact
       sign), `decide.bend` (the filter, tau, the refusal texts),
       `refine.bend` (the width bounds decided again) and `frame.bend`
       (the local frame). The filter keeps the F32x2 sign when the value
       exceeds 2^-36 × the operands' magnitude. Inside that allowance the
       sign of v − w, v − w ∓ tau is taken exactly on the job's words where an
       exact form exists: the width of a translation stripe between two
       planes against a boundary line or another plane/plane stripe's spring
       (unit-vector words), a rim (plane ⟂ axis, coaxial cylinder) against the
       axis or a circle exactly coaxial on the words (normal and centre offset
       parallel to the axis; a circle off the axis has no exact form here,
       see "Regression review 1" below), the torus major ρ_c = R ± r against 0 and
       tau, the blend chord of a plane/plane stripe against tau, and the
       tangent-edge test (the normals' cross product is exactly zero).
       Anything else inside the allowance is refused as `undecidable`, naming
       the value and the allowance. No suite case and no step-3 sweep point
       hit `undecidable`; verify-1's new families (a line against a bore
       circle, two bore cones, a triangle at its inradius, two coaxial rim
       springs) hit it at ±1e-12 and 0 (typed refusals, no wrong result).
     - **Sliver policy (A).** tau = 1e-6 mm (its F32 word). A configuration
       exactly on a boundary builds with the boundary's topology (r = w: the
       face is consumed; r = ρ: a sphere dome); one within tau of it is
       refused as `sliver` with the width it would have, which is the
       tolerance a merge would need. Constructed points without an exact form
       (mitre gap, a spring near an edge end, G1 chain sections, corner-ball
       contacts, vertex merge, edge pairing) are compared three-way: the same
       point within max(1e-9 mm, 2^-36 × magnitude), `sliver` below tau,
       distinct above. A net in the surgery refuses any result with two
       vertices closer than tau. A merge within tolerance is never done:
       every sub-tau case is a refusal (**refusal-only, still open** as a
       capability; Onshape's behaviour there is not probed).
     - **Local frame.** A job whose centre lies more than 16 extents from the
       origin is moved by a power-of-two multiple T (word-exact, checked in
       big integers, otherwise not moved), solved there and moved back by the
       surgery writer. Without it `box-r` at −1e-6, translated by 1e7 mm,
       builds a result with sub-tolerance topology (planted negative).
     - **Sweeps (acceptance 1 and 2, js and cpu1, one text per target).**
       `node scripts/fillet/sweeps.mjs --targets js,cpu1`: families box-r
       (r = 5 + d on a 5 mm face), box-d (chamfer d = 5 + d), post-r (rim of
       a post of radius 5, r = ρ + d), root-r (concave post root, annulus 6
       wide), d ∈ {±1e-3, ±1e-6, ±1e-9, ±1e-12, 0}; ridge-a and valley-a
       (dihedral 180° − a, a ∈ {1e-3, 1e-6, 1e-9, 1e-12, 0}). Verdicts: d = 0
       builds (consumed face, sphere dome, full annulus); 0 < |d| < tau is
       `sliver` (post-r: `radius-too-large` from +1e-12 on, exact); |d| ≥ tau
       as at ±1e-3; a ≥ 1e-6 builds, 1e-9 and 1e-12 `sliver`, 0
       `tangent-edge`. 0 failures, every built result passes the validator
       and has no vertex pair or circle below tau. Motions: translations by
       1e4 and 1e7 mm, quarter turns about z and x and scale 2 keep every
       verdict. **Not met as written for two motions (11 of 322 moved
       points, 46 family points × 7 motions):** a general rotation
       (3/5, 4/5) rounds the job words, which moves the exact boundary
       d = 0 (and d = −1e-6, a width within 1e-12 of tau) off the
       boundary, so 4 points become `sliver`; scale 1/2 moves ±1e-6 offsets to 5e-7, below the absolute tau, so 7 points become
       `sliver`. Both are typed refusals, and an absolute tau cannot be
       scale-invariant; the sweep report lists them as expected changes, not
       passes.
     - **Suites (acceptance 3 and 4, js and cpu1).** Catalogue 63 pass / 8
       expected-refusal (as step 2). A's file 18 / 11 / invalid 1 /
       step-fail 1: `adv-near-tangent-ridge-1e-7rad-r2` (a 2e-7 mm blend)
       moved from pass to `sliver`. C's file 24 / 8 (step 2: 26 / 4 /
       step-fail 2): `adv-rb-box-r-width-minus-1e-9` and
       `adv-rb-post-rim-r5-minus-1e-9` (step-fail: 1e-9 mm slivers) are now
       `sliver`, so they emit no sub-tolerance topology;
       `adv-rb-fix-box-r-width-minus-5e-7` (built a 5e-7 mm strip) is
       `sliver`; `adv-rb-post-rim-r5-plus-1e-12` (built) is
       `radius-too-large`, decided exactly (the ball centre crosses the
       axis). No `wrong` verdict; all rows agree across the targets.
     - **Still open.** `adv-post-rim-rho-minus-1e-6` stays `invalid`: its
       disc is exactly tau wide, so A builds it, and the production writer
       states the kernel's vertex tolerance of 3e-4 mm, at which OpenCascade
       rejects the disc. The choice between the kernel's 3e-4 mm and the
       fillet's 1e-6 mm is Marc's; the 3e-4 mm floor sits in
       `src/analytic.mjs` (`validateAnalytic`), outside the fillet workflow.
       C keeps its own classes: it refuses sub-tau slivers as `face-consumed`
       and builds r = ρ + 1e-12 within its approximate tolerance.
     - **Harness changes (for the record).** `brepfmt.mjs` `REFUSALS` gains
       `sliver` and `undecidable`. `scripts/fillet/sweeps.mjs` is new (sweeps
       and motions; built results are checked against tau − 2^-36 × M,
       because a width decided ≥ tau may be written up to its rounding
       below it). New test: `test/fillet-exact.test.mjs`.
4. **Frontend wiring.**
   - FeatureScript `opFillet`/`opChamfer` (EQUAL_OFFSETS only; other chamfer
     types are typed refusals) and build123d `fillet`/`chamfer` call A.
   - A refusal is an ordinary operation error, so Marc's `try` fallbacks
     behave as in Onshape.
   - Seam edges are ignored with a note, and the recorded order is visible in
     the result.
   - *Acceptance:* unit tests per frontend, including FP12 refused, and
     `tangentPropagation: false` stopping at the unselected continuation
     (today a typed refusal, FP11).
   - **Status: done on the Bend JS target, 25 September 2026** (workflow
     fillet-prod, stage s4-frontend; worklog
     local development evidence; runs in the isolated tree of
     `tmp/fillet-prod/s4/mktree.sh`, because the parallel hybrid-robust
     workflow's in-flight `kernel/hybrid` edits did not compile at the time).
     - **Wiring (measured).** `src/fillet-op.mjs` writes the job of a host
       body (word for word the harness's `encodeJob` on `normaliseBody`,
       tested on all 71 catalogue bodies) and runs `kernel/fillet`;
       `src/fillet-fs.mjs` is `opFillet`/`opChamfer` (std defaults:
       `tangentPropagation` false; std keys accepted only at their defaults;
       entities are edges and faces, a face standing for all its loop edges;
       TWO_OFFSETS, OFFSET_ANGLE and RAW_OFFSET refused by name);
       `src/fillet-python.mjs` and `python/_b3d_blend.py` are build123d
       `fillet`/`chamfer` and `Shape.fillet`/`.chamfer` (tangent chains
       followed, as OCCT does; `length2`/`angle`/`reference` refused by
       name). The fillet is a modeling service on the Bend JS target
       (`loadModelingServices`); the native backend refuses by name.
     - **Errors.** Only a refusal class Onshape is measured to raise for the
       same input is an ordinary error: `tangent-edge` (FP12,
       FILLET_FAIL_SMOOTH), a FeatureScript exception that `try` catches,
       and a `ValueError` in Python. Every other refusal is a capability
       error, also inside `try silent` / `except`. Refusal texts carry the
       class, A's reason and the record (`[order ...; notes]`).
     - **Record.** `body.fillet` (engine, claim `exact`, face roles,
       `order`, `notes`) and the operation evidence (`blend.order`,
       `.notes`, `.quantizationMm`); a seam edge gives `seam-ignored e`.
     - **Marc's house style end to end (FeatureScript,
       `fixtures/fillet/fs-frontend.fs`, `test/fs-fillet.test.mjs`).**
       Volumes through `kernel/volume.bend` against closed forms derived in
       the test: P1 0.42 chamfer loops on a box top (plane/plane, mitres,
       1.2e-15), a stadium (plane and cone, G1, 1.6e-15) and a box top with a
       R3.3 bore rim (9e-16); P3 R4.2 on four vertical edges,
       `tangentPropagation` false (8e-15); P4 the chamfer over the filleted
       top loop (9e-16); P2 R2 concave rib root (2.1e-15). All six STEP
       exports pass strict `validate-step.py` with OCCT volumes on the
       closed forms. build123d (`test/python-fillet.test.mjs`): P3, the bore
       rim and top loop, a propagated rounded-rectangle rim (8 edges).
     - **Acceptance.** FP12 refused as Onshape refuses it, caught by
       `try silent` (FS) and `except ValueError` (Python). FP11:
       `tangentPropagation` false (and by default) stops at the unselected G1
       continuation; that is `vertex-blend`, a capability error even inside
       `try silent` (**refusal-only, still open**: Onshape builds FP11).
     - **Not claimed.** cpuN and Metal (the frontends run A on the JS target;
       the CPU-pool dispatch of §1 is not wired); KS01-KS09 (step 5); Python
       `.volume` of a fillet body is still a capability error (the host's
       `volume` request does not integrate analytic bodies; follow-up in
       `tmp/fillet-prod/followups/s4-frontend.md`); no Onshape probe of
       `radius-too-large` or `overflow`, so those stay capability errors
       although Onshape may fail on them too.
5. **R20 acceptance set KS01-KS09**
   (`~/Workspace/cad/cad-project-041/single-step-r20/kernel-cases/ks*`,
   read only). The oracle is Onshape's volume in each case's
   `reference.json`.
   - Today every blend case stops at its first `opFillet`/`opChamfer`, and
     the earlier gates (`qContainsPoint`, `qAdjacent`, general Booleans,
     `opRevolve`) are r20-gate's (measured, `local design note`).
   - The expected v1 outcome per case is **conjecture**, read from the
     `case.fs` sources; the step measures it:

   | case | blends | expected v1 outcome | acceptance |
   |---|---|---|---|
   | KS01 clamp | R4.2 vertical fillets (plane/plane), then 0.42 chamfer over the bottom outline (lines and R4.2 arcs, countersink rim cone) and the cradle boundary | fillets and the bottom chamfer: A. The cradle cylinder (axis Y) cuts the vertical R4.2 fillet cylinders, so the cradle boundary contains cylinder/cylinder quartic edges. Refusal `unsupported-surface` naming the edge | fillet volume = Onshape within 1e-9 × V after step 1; the chamfer call is a typed refusal until quartic edges exist (then C-spline opt-in or B) |
   | KS02 teardrop | 0.42 chamfer on the front face: box outline and teardrop mouth (arc G1 into two 45° lines, apex mitre) | A: plane and cone chamfers, G1 chain, mitre | volume = Onshape 10,435.198 within 1e-9 × V; strict STEP |
   | KS03 disc | chamfers 2.5 / 1.0 on outer rims, 0.6 on both cone rims, then ∩ box | A: cone chamfers on plane/cylinder and plane/cone rims | volume = Onshape 13,381.432 within 1e-9 × V after the Boolean |
   | KS04 cam lever | 0.6 bore-rim chamfers, then 0.42 on all top/bottom edges; 0.2 mm land left between the bore chamfer rim and the disc edge | the two 0.42 chamfers overlap on the land, on non-coaxial cones: A refuses `blend-overlap` | typed refusal in v1; B target (§4). Onshape builds 2,811.923 |
   | KS05 flat ring | 0.42 chamfer ring around each flat, convex and concave edges | must refuse, like Parasolid (CHAMFER_ADJOINING_EDGE_NOT_CHAMFERED) | typed refusal on all targets, and still a refusal after later stages add plane/cylinder line chamfers (a rule for "adjoining edge not chamfered" is needed) |
   | KS06 detent | none | unchanged | sphere-type regression: identical volumes at both positions, strict STEP |
   | KS07 union seam | R2 fillet on every edge of the merged top face of two boxes (7° apart); extended mitres at the notch corners, trimmed mitres at box corners, coplanar fragments | A: fragment merge, trimmed and extended mitres | volume = Onshape 8,663.990 within 1e-9 × V (OCCT is 0.170 mm³ off); face count = Onshape's |
   | KS08 torus stem | none | unchanged | torus-type regression |
   | KS09 severed rim | 0.42 chamfer on all top-face edges; counterbores break the rim, so plane chamfers meet cone chamfers at vertices with a vertical cylinder/plane edge | A refuses (mitre against a rotation blend, `vertex-blend`) | typed refusal in v1; A extension target. Onshape builds 8,374.639 |

   **Conjecture:** A builds KS02, KS03 and KS07 exactly, KS05 is refused as
   required, and KS01 (cradle chamfer), KS04 and KS09 are typed refusals
   that name their gap. The step is done when each row shows its expected
   outcome on all four targets, or the plan is corrected with the measured
   outcome.
   - **Status: measured on the JS target and the native backend, 25
     September 2026; open** (workflow fillet-prod, stage s5-ks). KS02 and
     KS03 build exactly and match Onshape; KS07 is refused (the conjecture
     said it builds); KS05 and KS09 refuse by name; KS01 and KS04 do not
     reach the blend the conjecture is about. The native backend reaches no
     blend. Table and gaps: "Step 5 measured" below.
6. **Corpus fillet families.**
   - Convert the saved pre-blend solids of fillet.md §2
     (`tmp/fillet/b3d/brep`, `tmp/fillet/fsocct-out/brep`,
     `tmp/fillet/wonky/out`; 891 invocations in 70 files, 39 families) into
     harness jobs and run A on them.
   - *Acceptance:*
     - every strict-analytic invocation (619 measured) builds exact, and
       agrees with OCCT where OCCT's result is valid and outside its known
       defect classes;
     - every other invocation either builds exact (A's notch and face
       consumption, checked by divergence volume and, where valid, OCCT) or is
       a typed refusal whose class matches the corpus classification
       (overflow beyond v1, B-spline edge, mixed convexity, tangent seam);
     - 0 wrong;
     - the real `r22-planar-guides.fs` outline chamfer (20 edges, OCCT fails)
       builds;
     - end to end: every family that reaches its blend through the
       production CLI (7 build123d files today) builds or refuses by name,
       with volume against the build123d/OCCT oracle where that one is valid.
7. **Onshape probes before widening A** (session bridge, public documents,
   about six small documents).
   - Setback mitres: `adv-trapezoid-top-loop-r1`,
     `adv-drafted-pocket-floor-loop-r1`. Enable them in production only if
     Onshape's volume matches.
   - A face pinched at a point by consumption.
   - A finer volume query for FP08.
   - The chamfer setback mitre (`adv-trapezoid-top-loop-d1`) and the
     extended setback mitre (`adv-drafted-boss-root-loop-r1`).
   - Then extend A with the analytic vertex blends Onshape builds: the FP14
     torus corner (OCCT agrees with Onshape there), FP06 and the FP11 curved
     cap.
   - *Acceptance:* Onshape's face count and dV within 1e-9 × V (or inside
     Onshape's bounds where its value is approximate, with the divergence
     volume as the exact side).
8. **C-tori as the CI cross-check and paranoid mode.**
   - *Acceptance:* on every suite case both build, the volumes agree within
     1e-9 × V and the carrier types agree per stripe (today 39/39 catalogue);
     a planted mismatch fails CI.
9. **Opt-in tolerance stage (C-spline).**
   - It runs behind an explicit model- or call-level flag with a tolerance τ,
     only after A's `unsupported-surface`.
   - It needs the production face record with a stated tolerance and B-spline
     export with pcurves.
   - *Acceptance:*
     - dense deviation ≤ stated tolerance on every face (C's Regression review measured ≤ 0.49 of it; not re-measured by the judge);
     - strict STEP;
     - the needed tolerance is named when it exceeds τ;
     - never used for `tangent-edge`, must-refuse, `vertex-blend` or
       `blend-overlap`.

   Its first real input is a B-spline profile edge (cad-project-003 leg roots),
   once wonky can build one.
10. **Candidate B** after the hybrid Boolean is the production Boolean with
    declared tangency.
    - *Acceptance:*
      - on A's notch cases (FP01, FP05, FP07, FP09, FP13) the volume equals
        A's within 1e-9 × V;
      - KS04 and FP06 build and match Onshape;
      - no wrong `ok` on both adversarial files.
11. **Largest feasible radius** (Marc's decision 10, a wonky extension).
    - A's refusals already carry the needed and available widths and ρ.
    - Expose them as a query.
    - *Acceptance:* the reported r_max builds and r_max plus one ulp of the
      exact predicate refuses, on the sweeps of step 3.

### Step 5 measured

Workflow fillet-prod, stage s5-ks, 25 September 2026; worklog
local development evidence. The main working tree, which compiles
again; it holds the parallel hybrid-robust workflow's in-flight
`kernel/hybrid` edits. Each case's source is read from
`~/Workspace/cad/cad-project-041/single-step-r20/kernel-cases/ks*/case.fs`
without changes. The CLI is the production one (`bin/wonky.mjs --format
r20-check`), and the driver is `scripts/r20/acceptance.mjs`, run as is:

```sh
tmp/fillet-prod/s5/run-acc.sh js-main js          # out/fillet/s5/r20-js-main, 30 s
tmp/fillet-prod/s5/run-acc.sh native-main native  # out/fillet/s5/r20-native-main
```

Oracle: Onshape's B-rep volume `[value, min, max]` from each
`reference.json`. The "rel" column is (ours − value) / value. Bounding box
and Hausdorff distance against Onshape's STL are within tolerance on every
row that builds.

| case | JS target | volume (ours / Onshape, rel) | native backend |
|---|---|---|---|
| KS01 | the R4.2 fillet (`corners`) builds; the next step, `cradleCut`, stops at 52:5 `opBoolean`: "through holes do not admit arc edges yet" (the hybrid, on the fillet's R4.2 arcs). The 0.42 chamfer is not reached | fillet stage only (scratch source cut before the cradle, `tmp/fillet-prod/s5/ks01-fillet-stage.fs`): 13646.300054642314 against the closed form 13646.300054642423 (8e-15). No Onshape value for this stage | 91:18 `qContainsPoint` needs the Bend classifier |
| KS02 | **builds exact**, 16 faces | 10435.19833172702 / 10435.198331727044 (**2.3e-15**); strict STEP valid, OCCT 10435.19833172704 | `kernel.sketchArcs.solve` is not in the native build 87697b90d4a1 |
| KS03 | **builds exact**: the three chamfers, then ∩ slab; 6 faces | 13381.432350856718 / 13381.432350856932 (**1.6e-14**); strict STEP valid, OCCT 13381.432350856925 | 122:5 `kernel.revolve.sweep` is not in the native build |
| KS04 | the 0.6 bore-rim chamfer builds; the second selection stops at 78:18: "qContainsPoint over a cone face is not implemented" (the new chamfer cones). The 0.42 chamfer is not reached | bore-rim stage (scratch): removed 9.9525655266 against the closed form 2πd²(R + d/3) = 9.952565526572466. With the same loops picked by edge points (`ks04-edgesel.fs`, diagnosis only): `overflow`, "needs width 0.42 but edge 4 limits the face to 0.2 (short by 0.22); chamfer overflow is not a notch in v1" | 91:18 `qContainsPoint` |
| KS05 | refused at its `opChamfer`: `not-implemented`, "chamfer setback along a curved section (cylinder support of a line edge)" | - (Onshape: CHAMFER_ADJOINING_EDGE_NOT_CHAMFERED) | `kernel.boolean.coaxial` is not in the native build |
| KS06 | builds (no blend), unchanged | 946.376 / 946.376 (5.15e-10, stated), both parts | `sketchArcs.solve` |
| KS07 | **refused** at its `opFillet`: `overflow`, "the contact of edge 7 on face 1 needs width 2 but edge 9 limits the face to 0.6139228045 (short by 1.386); no notch: the contact of edge 7 leaves its face and the neighbouring face 4 is not a plane along the blend, or the support is not the strip up to edge 9" | - (Onshape 8663.990) | 78:18 `qContainsPoint` |
| KS08 | builds (no blend), unchanged | 2260.152 / 2260.153 (1.64e-7, stated) | `revolve.sweep` |
| KS09 | refused at its `opChamfer`: `not-implemented`, "mitre of edges 0 and 1 at vertex 1 on a curved shared face or a rotation blend (the mitre curve is not a planar conic)" | - (Onshape 8374.639) | 52:5 `opBoolean` (arc edges) |

Counts, with separate denominators:

- blend cases that must build and match Onshape: **2 of 3** (KS02, KS03;
  KS07 is refused);
- declared refusals that refuse at their blend by name: **2 of 4** (KS05,
  KS09). KS01 and KS04 stop earlier, outside the fillet. KS05's refusal is a
  capability gap, not Parasolid's rule, so it is **refusal-only and still
  open**;
- KS06 and KS08 (no blend) unchanged: 2 of 2;
- native backend: 0 of 9 reach a blend.

What this corrects in the conjecture:

- **KS07 does not build.** Box B's bottom face crosses A's right face at
  y = 5·tan 7° = 0.614 mm, which leaves a 0.614 mm step face (edge 8)
  between A's front edge (edge 7) and B's bottom edge (edge 9). At r = 2 the
  front edge's contact overflows onto the step, and A's notch does not cover
  it, because the neighbour along the blend is not a plane strip up to edge
  9. Onshape builds it. This is a v1 gap (overflow across a short step face
  between two convex edges 7° apart) and belongs with the notch work.
- **KS04's blend is `overflow`, not `blend-overlap`.** The 0.42 contact
  does not fit on the 0.2 mm land between the bore chamfer rim and the disc
  edge. Measured only with a diagnostic selection, because the case's own
  face query stops at the cone faces first.
- **KS01's cradle chamfer and KS04's second chamfer are unmeasured.** Both
  cases stop before them, outside the fillet: KS01 in the hybrid Boolean
  (arcs with a curve range on a through-hole target), KS04 in
  `qContainsPoint` over cone faces. Both blockers appear only now that the
  fillet builds its first blend.
- **KS09's refusal is `not-implemented` (mitre on a rotation blend), not
  `vertex-blend`.** It names the same gap.

Gate expectations: `scripts/r20/acceptance.mjs` belongs to the
hybrid-robust workflow. The new KS rows are a patch,
`tmp/fillet-prod/followups/s5-r20-acceptance-ks.patch`: KS02, KS03 and
KS07 must build; KS01, KS04, KS05 and KS09 must stop at a blend with one of
the production fillet's refusal classes (a capability error that is not
one of them fails); the summary line gives must-build and declared-refusal
counts separately. With the patch applied (scratch copy): 6 of 9; must build
4 of 5 (KS07 fails); declared refusals 2 of 4 (KS01 and KS04 fail, blocked
before their blend). Planted negatives, both run: a 5 % larger blend size in
`src/fillet-fs.mjs` fails KS02 and KS03 on volume (1.1e-4 and 1e-3) and on
Hausdorff distance; KS09 with `TWO_OFFSETS` (a capability error at the
blend that is not a fillet refusal) fails under the patch, and the current
`blend-stop` rule would pass it.

**No claim:** cpu1, cpuN and Metal did not run the KS cases. The frontends
run the fillet on the JS target, and the native backend stops before every
blend. Onshape's face counts were not compared, because `reference.json`
has none. KS01's and KS04's intended blends were not reached.

### Integration of steps 0-5 (measured)

Workflow fillet-prod, integrate stage, 25 September 2026. The worklog is
local development evidence, and the scripts are in
`tmp/fillet-prod/integrate/`.

- **Tree.** The runs used one tree, built by `mktree.sh`: a detached git
  worktree at HEAD 87e3974 plus 94 working-tree files.
  - Included: the fillet workflow's 66 files and the in-flight edits of
    tray-view-fix and dxf-admission. Steps 4 and 5 had already run against
    those edits.
  - Excluded: hybrid-robust's in-flight files.
- **Reuse.** The engine sources are byte-identical (`diff -r`) to the ones
  the implementers ran, so their js and cpu1 results were reused:
  - production A from step 3 (`out/fillet/s3/p1`);
  - the prototype from step 2 (`out/fillet/s2/p2/ref-*`);
  - C-tori from step 0 (`out/fillet/s0`).
- **New runs.** cpuN (18 threads) and Metal ran now, graded by today's
  harness, and were compared byte for byte with the reused texts
  (`cmp4.mjs`). The adversarial inputs (`.job`) were identical to the
  reused ones: 31/31 and 32/32.
- **Baseline.** The integrated results are stored under
  `out/bakeoff/<proto>/{main,adv-kpart,adv-rb}` as the baseline for later
  stages.

| engine | suite | four targets byte-identical | verdicts (cpuN + Metal run) |
|---|---|---|---|
| A production (`kernel/fillet`) | catalogue (71) | 70 | pass 62, expected-refusal 8, mismatch 1 |
| | A's file (31) | 30 | pass 17, expected-refusal 11, invalid 1, step-fail 1, mismatch-targets 1 |
| | C's file (32) | 32 | pass 24, expected-refusal 8 |
| A prototype (`kernel/proto/fillet-kpart`, reference) | catalogue | 71 | pass 63, expected-refusal 8 |
| | A's file | 31 | pass 19, expected-refusal 10, invalid 1, step-fail 1 |
| | C's file | 32 | pass 25, expected-refusal 4, declined 1, step-fail 2 |
| C-tori (cross-check) | catalogue | 71 | pass-approx 39, declined 15, expected-refusal 17 |
| | A's file | 31 | pass-approx 4, expected-refusal 18, declined 9 |
| | C's file | 32 | pass-approx 22, expected-refusal 8, declined 2 |

No engine gives a `wrong` verdict on any suite.

**Production A on the catalogue, with separate denominators:**

| class | result |
|---|---|
| `ok` cases | 53 of 53 pass on all four targets |
| `must-refuse` cases | 4 of 4 refused by name |
| `either` cases | 9 pass, 4 typed refusals, 1 `mismatch` (FP03, the Metal fault below) |

Checks on the 63 built results: tight 63/63; divergence volume 63/63 (worst
4.3e-15 × V); strict STEP through the production writer 63/63.

The `invalid` and `step-fail` rows on A's file are the known ones:

- `adv-post-rim-rho-minus-1e-6` is the 3e-4 mm against 1e-6 mm tolerance
  choice (step 3, open).
- `adv-far-1e6-box-top-loop-r2` is beyond the ±1e4 mm envelope; its export
  is refused by name.

**Metal fault (new, measured).** On Metal, the production fillet stops with
"bend: memory fault (machine stack overflow?)" where step 3's exact
escalation decides a plane/plane width. This happens inside the device call
(`solve0`, ladder and network), on big integers
(`kernel/fillet/exact.bend` over `robust-predicates.bend`).

- **Suite cases.** Two suite cases are hit:
  - `hard-single-edge-r-equals-width-r10` (FP03);
  - `adv-top-edge-r-width-minus-1e-6`.
- **Sweeps.** The step-3 sweep points were run with every motion on the
  native targets (`sweeps4.mjs`; 368 points). cpuN equals cpu1 on 368/368.
  Metal faults on 38, all in family `box-r`.
- **Reproducibility.** The fault repeats on every run at `--gpu` 1, 2 and
  4 GB. With `--gpu off`, the same binary gives cpuN's text.
- **No wrong answer.** On these inputs Metal fails the process. (Refuted
  for other inputs by verify-1: on two P2 pockets Metal wrote a different,
  valid text with exit code 0; see Regression review 1.)
- **Unaffected.** The prototype has no exact path and is clean on Metal.
  The production path runs fillets on the CPU pool with `--gpu off` (§6),
  so it is unaffected.
- **Open.** Byte identity on all four targets is **not met** for these
  inputs. There are two ways to close it:
  - keep the exact escalation out of the device program, or make its
    recursion shallow;
  - or decide formally that Metal is not a fillet target.
- **Build time.** The Metal build of `kernel/fillet` took 33 min (device
  compile, single-threaded `MTLCompilerService`). That is more than
  `run.mjs`'s 30-minute build limit, which killed the first attempt, so the
  build was finished by hand. The device program's compile cache is bound
  to the tree's path, so other trees recompiled it (verify-1).
- **Closed in Regression review 1** by removing the device stage (below).

**Harness change (a gate, made stricter).** `run.mjs` used to skip a target
that errored when it checked whether the targets agree. FP03 therefore
scored `pass` with Metal = error. Now every selected target must produce the
same text, as `run-adversarial.mjs` already required, so FP03 is `mismatch`.
The fillet harness tests still pass (18/18).

**Cross-checks** (`crosscheck.mjs` via `xcheck.mjs`; A = production):

| pair, suite | both build | volumes agree (max \|dV\|) | same face count | built by only one |
|---|---|---|---|---|
| A vs C-tori, catalogue | 39 | 39 (7.3e-12) | 38 (`pc-post-base-concave-r1` 6/7, coplanar merge) | only C: 0 |
| A vs prototype, catalogue | 63 | 63 (0) | 63 | 0 |
| A vs OCCT replay, catalogue | 52 | 52 (1.05e-6, see below) | 50 | only OCCT: FP11 (OCCT wrong), FP14 |
| A vs C-tori, A's file | 4 | 4 (3.3e-8) | 4 | only C: 0 |
| A vs C-tori, C's file | 21 | 21 (6.8e-10) | 20 | only C: `adv-rb-post-rim-r5-plus-1e-12` (A: `radius-too-large`, decided exactly) |
| A vs prototype, both files | 42 | 42 (3e-11) | 42 | only A: the riser; only the prototype: the step-3 slivers and r5+1e-12 |

- The carrier types agree on every common case.
- The 1.05e-6 against OCCT is `pp-box-top-loop-r2`. There, OCCT's reading
  of the replay's mitre STEP is off by 9.9e-7 from the closed form. A's
  divergence volume matches the closed form to 1.7e-13.
- Planted negative: a copy of the C-tori report with +1e-3 × V on one case
  shows up as a volume difference.

**Onshape probes** (production A, integrate report):

| probes | result |
|---|---|
| FP01-FP05, FP07, FP09, FP10, FP13, FP15, FP16 | build with Onshape's face count; volume within 8.3e-8 mm³ |
| FP08 | builds with Onshape's face count; 3.47e-3 mm³ off, inside Onshape's bounds |
| FP03 | builds with Onshape's face count, but graded `mismatch` because of the Metal fault |
| FP12 | refused (`tangent-edge`), as Onshape refuses it |
| FP06, FP11, FP14 | refused (`blend-overlap`, `vertex-blend`, `mixed-convexity`); Onshape builds them, so these stay **refusal-only and open** |

`onshape-oracle.mjs --check`: up to date.

**KS01-KS09** go through the production CLI in the tree, driven by HEAD's
`scripts/r20/acceptance.mjs` (`run-ks.sh`). The result is the same as step
5 on both backends:

- **JS backend.**
  - Must-build blend cases that build and match Onshape: 2 of 3 (KS02
    2.27e-15, KS03 1.60e-14). KS07 is refused with `overflow`.
  - Designed refusals that refuse at their blend by name: 2 of 4 (KS05,
    KS09). KS01 stops at the hybrid `opBoolean` (arc edges), and KS04 stops
    at `qContainsPoint` over a cone.
  - KS06 and KS08 (no blend) are unchanged: 2 of 2.
  - HEAD's gate prints 5/9 because its `blend-stop` rule is stale. It fails
    KS02 and KS03 because they build, and it passes KS07's refusal. The
    per-case gate in `tmp/fillet-prod/followups/s5-r20-acceptance-ks.patch`
    applies only to hybrid-robust's in-flight `acceptance.mjs` and is still
    waiting for them.
- **Native backend.** A fresh `planar` build in the tree (96 s) reaches no
  blend: 0 of 9. The classifier, `sketchArcs.solve`, `revolve.sweep` and
  `boolean.coaxial` are missing natively, and KS09 stops at `opBoolean`.

**r10b.** `fixtures/r10b/r10b.fs` has sha256 219ee963…8349, equal to
`provenance.json`, and is unchanged against HEAD in the main tree and in the
integrate tree.

**npm test** in the tree: check:bend passes; 1597 tests, 1587 pass, 5 fail,
2 skipped, 3 todo. No fillet test fails. Each failure was attributed by
re-running it at HEAD alone, at HEAD plus only the fillet files, in the
tree and in the main tree:

| test | fails where | cause |
|---|---|---|
| `lang-wk-real` "fix 2.8" | tree only | tray-view-fix in flight |
| `planar-boolean-integration` g9 | tree and main tree | tray-view-fix's `src/construction-history.mjs`; HEAD plus the fillet files plus that one file fails |
| `public-boolean-regressions` | HEAD and HEAD + fillet files, when three runs overlapped; passes alone | load-flaky uv STEP subprocess, pre-existing |
| `r20-export` #988 | tree only | the test edit pairs with hybrid-robust's in-flight `scripts/r20/mesh.mjs`, which the tree excludes |
| `sketch-arcs-limit` 1000-segment | tree only | dxf-admission's new, in-flight test |

The fast lane at HEAD plus only the fillet files
(`node scripts/test-lane.mjs fast`): 141 ok, 0 failed.

**Still open after steps 0-5:**

- the Metal fault above (closed in Regression review 1 by removing the device stage);
- KS07 (`overflow` across the 0.614 mm step);
- KS01 and KS04, which are blocked outside the fillet;
- KS05's rule (Parasolid's CHAMFER_ADJOINING_EDGE_NOT_CHAMFERED);
- FP06, FP11 and FP14, refusal-only;
- the 3e-4 against 1e-6 mm tolerance choice;
- sub-tau merges, refusal-only;
- follow-ups F2, F3 and F8 of step 1 (volume, classification and print mesh
  of A's torus, sphere and cone faces);
- the CPU-pool dispatch of §1: the frontends run on the Bend JS target, and
  the native backend refuses by name;
- Python `.volume` of a fillet body.

**No claim:**

- Metal is not byte-identical on the exact-escalation inputs (closed in fix
  round 1, without a device stage).
- The KS cases did not run on cpu1, cpuN or Metal (the CLI's backends are
  JS and native).
- The tree is not the main tree: it excludes hybrid-robust's in-flight files
  and includes other workflows' in-flight edits as of 01:08.
-

### Regression review 1 (measured)

Workflow fillet-prod, stage integrate-fix, 25 September 2026, after verify-1.
The worklog is local development evidence, the scripts are
in `tmp/fillet-prod/integrate-fix/`, and the tree is
local development evidence: a git worktree at HEAD 84e314a plus only the
fillet workflow's 66 files.

**Defect 1: Metal wrote a different text, exit code 0.** On verify-1's
`v1-p2-pocket-floor-loop-r2` and `v1-p2-pocket-all-concave-r2` the Metal
binary wrote `dfc52b8fd5f3` and `9fbe993c7a9a`; the same binary with
`--gpu off` and the CPU build wrote `703d202e71ef` and `0719d9cda432`
(re-executed). Both texts are valid.

- **Cause.** The job's pocket floor lies at z ≈ 1e-16, not 0. The F32x2
  reals (`kernel/real.bend`) then reach subnormal F32 values. Metal flushes
  them to zero; the CPU and JS targets keep them. Example: a cylinder axis
  word 0x80000005 (−7e-45) on the CPU against 0 on Metal, and lo words of
  1e-24 components 2e-39 apart. The device stage (`solve0`: ladder and
  network, R.* throughout, plus the exact escalation) cannot be made
  subnormal-free inside the fillet.
- **Fix.** `kernel/fillet/native.bend` marks no device call. The whole
  fillet runs on the CPU in every build, as §6 already decided for
  production. This also removes the exact-escalation stack overflow above.
  The Metal build takes 38 s instead of 33 min.
- **Regression cases.** Both pockets are appended to
  `fixtures/fillet/adversarial-fillet-kpart.json` (group `regression`,
  31 → 33 cases; closed forms from verify-1, labelled INFERRED).
- **Planted negative.** The pre-fix binary (integrate tree, device stage)
  on the two regression cases: `mismatch-targets` on both.
- **No claim.** This does not make Metal run fillets. The `metal` target
  of the fillet harness now measures a CPU program in a Metal build
  (`metalEvidence` false). Whether Metal should come back as a fillet
  device needs subnormal-free arithmetic for the device program; that is
  Marc's call and not planned.

**Defect 2: qCreatedBy(blend id, FACE | EDGE) gave the whole body** (10
faces and 24 edges for R4.2 on the four vertical edges of a box).

- **Fix.** `src/fillet-fs.mjs` records, per blended body, the faces the
  blend created (roles `blend` and `corner`; support faces are trimmed and
  cap faces grown, both kept) and the edges bounding them.
  `src/queries.mjs` answers qCreatedBy(blend id, FACE | EDGE) with those,
  and the body's other creators no longer own them. BODY is unchanged (the
  record's lineage). When a later operation replaced the body, the blend's
  faces are no longer tracked, and qCreatedBy(blend id or another creator
  of that body, FACE | EDGE) refuses by name (a capability error, also in
  try silent) instead of answering with the whole body.
- **Test.** `test/fs-fillet.test.mjs`: box R4.2 → 4 faces, 16 edges, 1 body;
  the block keeps 6 faces and 8 edges; the chamfer after it gives 8 faces
  and 24 edges; the fillet's and the block's faces after the chamfer
  refuse. Planted negative: without the record the test fails with
  `counts 10 24 1 10 24`.
- **No claim.** The EDGE answer (the edges bounding the blend's faces) and
  the refusal after a later operation are not probed in Onshape.

**Rerun** (bake-off economy: the JS target and the CPU build run the same
code as in the integrate stage, so js and cpu1 were reused from its
baseline; cpuN and Metal ran now; the two regression cases ran on all four
targets):

| engine | suite | four targets byte-identical | verdicts |
|---|---|---|---|
| A production | catalogue (71) | 71 | pass 63, expected-refusal 8 |
| | A's file (33) | 33 | pass 20, expected-refusal 11, invalid 1, step-fail 1 |
| | C's file (32) | 32 | pass 24, expected-refusal 8 |
| A prototype, C-tori | catalogue | cpuN rerun 71/71 equal to the integrate baseline | unchanged |

- **Production A on the catalogue.** `ok` cases: 53 of 53 pass.
  `must-refuse`: 4 of 4 refused by name. `either`: 10 pass (FP03 now
  passes), 4 typed refusals. `wrong`: 0 on every suite.
- **A's file.** `adv-top-edge-r-width-minus-1e-6` now passes. The
  `invalid` and `step-fail` rows are the two known ones above.
- **Metal against cpu1** (`metal-check.mjs`): the 368 step-3 sweep points
  with every motion, 0 differ (integrate: 38 faults); the two pockets with
  every motion, 0 of 16 differ (verify-1: 15).
- **Cross-checks, probes, KS, r10b.** Unchanged against the integrate stage:
  A vs C-tori 39/39 (7.3e-12), 4/4, 21/21; A vs the prototype 63/63, 19/19,
  23/23; A vs OCCT replay 52/52. Onshape probes: 13 of the 15 that Onshape
  builds build with Onshape's face count (12 within 8.3e-8 mm³, FP08
  3.47e-3 in range); FP12 refused as Onshape; FP06, FP11, FP14 still
  refusal-only. KS on the JS backend: must-build blend cases that build and
  match Onshape 2 of 3 (KS02, KS03; KS07 refused `overflow`); designed
  refusals that refuse at their blend by name 2 of 4 (KS05, KS09; KS01 and
  KS04 stop outside the fillet); KS06 and KS08 pass. Native backend: 0 of 9
  reach a blend. r10b unchanged (sha256 219ee963…8349).
- **Tests.** `npm test` in the tree: 1593 tests, 1587 pass, 1 fail, 2
  skipped, 3 todo. The failure is `public-boolean-regressions` (the STEP
  subprocess hit 60 s at load 20; alone it passes in 4.3 s), the load flake
  the integrate stage saw at HEAD. The fast lane: 141/141.
- **Baseline.** `out/bakeoff/fillet/{main,adv-kpart,adv-rb}` now holds
  these results (four targets, 71 + 33 + 32 cases). The integrate baseline
  with the Metal device stage is `out/bakeoff/fillet.pre-fix1`.

**Found by verify-1 and still open** (not in this Regression review): a claimed
exact result outside the ±1e4 mm envelope fails the tight check at 1e7 mm
(1.9e-8 mm); `run-adversarial.mjs` computes a null expected volume for
chained inputs (false `step-fail`); the `undecidable` reason prints a value
the decision does not use; `barend-r` at +1.5e-6..+1e-4 refuses
`not-implemented` (an edge piece without partner) while +1e-3 builds.

### Regression review 2 (measured)

Workflow fillet-prod, stage integrate-fix, round 2, 25 September 2026, after
verify-2. The worklog is local development evidence
(section "Regression review 2"), the scripts are in `tmp/fillet-prod/integrate-fix2/`,
and the tree is local development evidence: a git worktree at HEAD d094c04 plus
only the fillet workflow's 67 files. Targets: js, cpu1, cpuN. Metal is not a
fillet production target and was not rerun (maintainer note of Regression review 1).

**Defect 1: coplanar fragments were refused as Onshape's FILLET_FAIL_SMOOTH.**
wonky's planar Booleans leave one plane face split into coplanar fragments
(box 30 × 20 × 6 minus a pocket: 46 faces, Onshape has 11). A fragment edge
was refused `tangent-edge`, which the frontend raises as FILLET_FAIL_SMOOTH,
an ordinary error. try silent swallowed it, so the chamfer was dropped with no
error. The face under a point also gave one fragment's edges only.

- **Fix.**
  - `kernel/fillet/ladder.bend` `is_fragment`: an edge between two plane
    faces whose outward normal words are exactly parallel and point the same
    way. `main.bend` ignores a selected fragment edge with the note
    `fragment-ignored <edge>`, as it ignores seams. The surgery already
    unified such faces.
  - A smooth edge between two faces of one curved kind is now the capability
    refusal `tangent-undecided`, not FILLET_FAIL_SMOOTH. Whether it is one
    split surface is not decided.
  - `production.bend` `fragments(job)` lists the fragment edges; Bend
    decides them. `src/fillet-fragments.mjs` groups faces into regions
    and computes no geometry. A face entity of opFillet/opChamfer stands for
    its region (`src/fillet-fs.mjs`).
  - `qAdjacent(face, EDGE | FACE)` reads regions when the Bend services are
    loaded (`src/queries.mjs`). `src/index.mjs` now loads them also for
    `qAdjacent`. On the native backend each fragment stays its own face.
- **Tests.** `test/fs-fillet.test.mjs`:
  - Marc's ksFaceEdges on the pocket ring builds the closed form, also inside
    try silent.
  - r10b's roundX on the same body builds, with a `fragment-ignored` note.
- **Planted negatives.** Each makes these tests fail:
  - region expansion switched off: 1 test fails;
  - `is_fragment` False: 3 tests fail.

**Defect 3: R4.2 riser caps on a union-built stepped block were refused
`vertex-blend`.** Cause: the riser vertex carries two fragment edges, so
the cap was "not one face next to both supports" and its valence was 5.

- **Fix.** `kernel/fillet/corners.bend`:
  - the cap's edges and faces are found up to coplanar fragments (exact face
    first, so bodies without fragments read as before);
  - the riser valence counts non-fragment edges;
  - the riser clearance certificate skips fragment edges (they bound no
    material).
- **Test.** The union block builds the same closed form as the one-piece
  extrusion, 12 faces.
- **Planted negative.** Exact cap faces only: 2 tests fail.

**Defect 2: an obstacle ellipse on a support face was `not-implemented`**
(a bore rim under an inclined top; a bottom loop after R4.2 under an inclined
top).

- **Fix.** `kernel/fillet/bounds.bend`, on a rotation stripe's cylinder or
  cone side: the width left by an ellipse is bounded from below over the whole
  ellipse, λ ≥ (a·(c − o) − e2_y)/τ_y − H/|τ_y|. The bound admits only a
  contact clearly inside it; anything else stays `not-implemented`.
- **Test.** Both FS models build their closed forms.
- **Planted negative.** Ellipse bound off: 1 test fails.
- **No claim.** Strict STEP fails on both results. The writer gives
  cylinder faces explicit parameter curves only in bodies of planes and
  cylinders, and these results have a cone. The divergence volume equals the
  closed form (2.1e-12 and 2.5e-11), OCCT's volume of the STEP equals it too,
  and the solid is valid without the exact CurveOnSurface check. Follow-up 1
  in `tmp/fillet-prod/followups/integrate-fix2.md`: the owner of
  `kernel/step-cylinder-pcurves.bend` and classificationInput.

**Regression cases.** verify-2's five cases are appended to
`fixtures/fillet/adversarial-fillet-kpart.json` (33 → 38, additions only,
group `regression`, expect `ok`, closed forms INFERRED by verify-2):

- the pocket ring and the stepped block, each with the fragment edges
  selected;
- the stepped block, riser caps;
- the bore rim;
- the wedge bottom loop.

**Test and gate changes** (listed, not incidental):

- `test/fillet-exact.test.mjs` and `scripts/fillet/sweeps.mjs` expect
  `invalid-input` instead of `tangent-edge` at a dihedral of exactly
  180°. There the two faces are one plane, the edge is a coplanar fragment,
  and nothing else is selected. The test also checks the reason text.
- The empty-selection reason now reads "(after ignoring seam and
  coplanar-fragment edges)".

**Rerun** (`runall.sh`; js, cpu1, cpuN):

| engine | suite | js = cpu1 = cpuN | against the Regression review-1 baseline | verdicts |
|---|---|---|---|---|
| A production | catalogue (71) | 71 | 71/71 texts equal | pass 63, expected-refusal 8 |
| | A's file (38) | 38 | 33/33 old texts equal; 5 new | pass 23, expected-refusal 11, invalid 1, step-fail 3 |
| | C's file (32) | 32 | 32/32 equal | pass 24, expected-refusal 8 |
| A prototype, C-tori | the 5 new cases, js and cpu1 | agree | sources unchanged, baseline reused | prototype: 5 declined (the defects); C-tori: bore rim built, 4 declined |

- **Catalogue, production A.** `ok` cases: 53 of 53 pass. `must-refuse`:
  4 of 4 refused by name. `either`: 10 pass, 4 typed refusals. `wrong`:
  0 on every suite.
- **The 5 new cases.** 3 pass (4.5e-12, 2.0e-11, 2.0e-11, strict STEP ok).
  2 are `step-fail` from the writer gap above.
- **A against C-tori on the new cases.** Both build 1, the bore rim, and
  agree to 5.5e-12 with the same faces. Only C builds: none.
- **Sweeps.** `sweeps.mjs` js,cpu1 over families × motions: 0 failures and
  the 11 known step-3 changes. cpu1 against cpuN: 368 points, 0 differ.
  Verdicts: ok 150, sliver 155, overflow 15, radius-too-large 32,
  invalid-input 16 (these were `tangent-edge`).
- **Onshape probes.** Unchanged: 13 of the 15 that Onshape builds build with
  Onshape's face count (12 within 8.3e-8 mm³, FP08 3.47e-3 in range). FP12
  is refused as Onshape refuses it. FP06, FP11 and FP14 are refusal-only.
- **KS on the JS backend.** Unchanged:
  - must-build blend cases that build and match Onshape: 2 of 3 (KS02, KS03;
    KS07 is refused `overflow`);
  - designed refusals that refuse at their blend by name: 2 of 4 (KS05,
    KS09; KS01 and KS04 stop outside the fillet);
  - KS06 and KS08 pass.
  Native backend: 0 of 9 reach a blend.
- **r10b.** Unchanged (sha256 219ee963…8349).
- **FeatureScript probes** (`fe-probes.mjs`, `fe-probes2.mjs`). All
  build their closed forms, including Marc's G2 helpers on the slot pocket,
  the through window and the rib union. The stepped block's step face is
  refused `mixed-convexity` (typed, a known class).
- **Tests.**
  - `npm test` in the tree: 1680 tests, 1674 pass, 1 fail, 2 skipped,
    3 todo. The failure is `public-boolean-regressions` (the STEP subprocess
    failed under load; alone it passes 3/3). It is the load flake of fix
    round 1 and not fillet code.
  - The fast lane: 145/145.
  - `test/fs-fillet.test.mjs`: 17/17.
- **Baseline.** `out/bakeoff/fillet/{main,adv-kpart,adv-rb}` holds these
  results for js, cpu1 and cpuN. The Regression review-1 baseline, which also has
  Metal, is `out/bakeoff/fillet.pre-fix2`.

**Still open.** These are not fixed in this round:

- from verify-2:
  - a 45° cut corner with c ≤ d < c(1 + 1/√2) is refused (FP06 class,
    refusal-only);
  - a drill-point chamfer d = ρ is built by A, but the production mapping
    refuses the cone of radius 0 (refusal-only);
  - divvolume.mjs is 2e-8 off near a tangent overlap (harness);
- from verify-1: #4 and #6;
- the follow-ups above.

### Fix: obstacle extent in the width bound (measured)

Workflow fillet-arc, 25 September 2026, worktree local development evidence at
01cd2ef. The worklog is local development evidence.

**Defect** (found by the end-to-end check at 770170b): R20 `return.fs:1035`,
the 0.42 rim chamfer after the ARM_L junction fillets, was refused "edge 12
limits the face to 1.1e-12". Reduced: a disc R10 crossed by a bar (two arcs
of one circle), R2 junctions, then the chamfer. Two full-extent assumptions
in `kernel/fillet/bounds.bend`, one behind the other:

- an obstacle circle was the whole circle (`OCirc{o, n, r}`): the far arc
  of the disc, as a circle, touches the R2 arc's rotation, so W = 0; the
  spring of a rotation stripe was a whole circle too;
- the RP metric (a rotation stripe on a plane ⟂ its axis) measured over
  the whole turn about the axis, not over the edge's own arc: the two arcs
  of one circle limited each other to 0.

**Fix.**

- A circle obstacle carries its extent (`Ext`: the whole circle, or the arc
  from a to b counter-clockwise about its normal), from the edge's end
  points and sense; a rotation stripe's spring spans its edge's angle.
- TP (translation, plane): the smallest λ over the arc inside the slab, at
  the circle's lowest point, a crossing with a slab side, or an arc end
  point, when on the arc. Exact as before.
- RP: an obstacle counts only inside the edge's wedge (the sector from the
  axis through the edge's end points; a closed edge has the whole plane).
  Nearest and farthest distances come from candidate points: end points,
  segment foot, the circle's points towards and away from the axis, and
  crossings with the wedge's two rays. Exact. A closed edge and a closed
  circle keep the old formula.
- Checked, unchanged: a segment is bounded already; RL's coaxial circle has
  one λ on every arc; RL and TC read no edge extent, which is conservative
  (never short); an ellipse is bounded over the whole ellipse, a lower
  bound for any arc of it (status `unknown` unless clearly inside).

**Tests** (three added to `test/fs-fillet.test.mjs`, one changed):

- translation: a semicircular tab whose circle comes within 0.2 of the
  chamfered edge builds its closed form; a bite arc there and a closed bore
  circle are refused `overflow`, naming that edge, limit 0.2;
- rotation: a 270° C ring (R10/R8), chamfer 1.5 on the outer arc builds
  (Pappus); 2.5 is refused, naming the inner arc, limit 2;
- the disc crossed by a bar, and the one-sided bar (control): fillet and
  chamfer volumes equal area, perimeter and Steiner closed forms;
- changed: `test/fillet-port.test.mjs` compared the port's ladder text with
  the prototype's byte for byte. The prototype keeps full circles, so two
  catalogue ladders now differ in width-bound lines only (results and
  networks equal): corpus-outline-chamfer-lines-arcs-0.42 (3 lines, the port's
  limits 29.58, 29.58 and 45 from the outline by hand, the prototype's 20, 20,
  40) and corpus-r22-guide-outline-chamfer-0.42 (2 lines). The test allows
  exactly those lines, with the same status and a limit not below the
  prototype's, and checks the three values.

**Planted negatives.** On the unfixed bounds the tab and the crossed disc
fail (the old false overflows); "no arc contains a point" fails the bite and
the ring; "RP candidates ignored" fails the ring.

**R20 return.fs** (sha 734535b2, `withBlends=true`): passes line 1035 (both
arm rim chamfers) and the seat block R4.2. Volume changes against closed
forms: arm junction fillets +11.714314 mm³ (each arm), arm rim chamfers
−94.681848 mm³ (both faces, G1 outline: 2(P d²/2 − π d³/3)), block −199.878434
mm³ (4 r²(1 − π/4)·13.2); all within 4e-11 relative. The new first stop is
`return.fs:913:22` (the seat seam fillet's edge query): the ARM_R plate +
block union came back as a certified mesh ("mesh vertex 2: degenerate
vertex, carriers dependent"), a Boolean limit, not the fillet.

**Rerun** (js, cpu1): catalogue 71, adversarial 38 and 32: every cpu1 text
equals the Regression review-2 baseline, js = cpu1. KS02 and KS03 unchanged
(2.27e-15, 1.60e-14 against Onshape). `check:r10b` stops at r10b.fs:25:2
(a curved Boolean) in this worktree with and without the fix. Fast lane:
145 of 145 files.

**Regression review 1: the tie on a rim's plane side** (worklog
local development evidence). verify-1 found that the bound could
now come from a non-coaxial arc's end point (a half ring R10 whose inner
boundary is two arcs meeting at a cusp at radius 9): at w = 1 and 1 + 1e-12
the gap fell inside the rounding allowance, and `refine.bend` re-decided it
with the coaxial form R − rc − w (10 − 7.65 − 1 > 0, "inside"). The chamfer
built a pinched top face (the spring circle through the cusp vertex) claimed
exact; OCCT reported "topology differs: faces 9 edges 19 != 8/18". The same
form also decided a bore circle off the axis at the point tangency (a disc
R10 with a bore R1 at (0, −5), chamfer 4, built 5 faces claimed exact), which
was reachable before the obstacle-extent fix. `refine.bend` now uses the
coaxial form only when the circle is exactly coaxial with the rim cylinder on
the words (cross(axis, normal) = 0 and cross(axis, centre − origin) = 0).
Any other circle obstacle has no exact form: inside the allowance the bound
is `undecidable`, outside it the F32x2 sign stands as before. A coaxial arc
still decides its tie exactly (the C ring at 2 builds consumed; ±1e-12 are
exact slivers). Test: `test/fs-fillet.test.mjs` "rim chamfer against a
circle off the axis" (half ring and bored disc: below the tie builds with its
Pappus volume, at the tie `undecidable` naming the obstacle, past it
`overflow` naming it); the C ring test gained the coaxial tie. No exact form
for the end-point or off-axis tie exists yet; such ties are typed refusals.

### Fix: reflex seams, the riser cap's concave dual (measured)

Workflow fillet-setback, 25 September 2026, worktree local development evidence
at ad8c869. The worklog is local development evidence.

**Defect.** R20 `edge.fs:807` (`r20Edge`, K15, `withBlends=true`), the R2
fillet on the backer-plate seam, was refused `vertex-blend`: "the spring 1 of
edge 27 meets edge 26 behind vertex 23 (reflex face corner; setback patch
needed)". The backer (x ±88) is narrower than the plate (±90.8), so the
plate's face y = 4.5 runs around each end of the seam: a reflex corner.
The spring on that face ends on the line of the concave edge u_i (backer end
face against plate face) 2 mm behind the vertex. The riser cap (step 2)
admitted this only for convex stripes.

**Onshape reference (probe RS, housestyle §5).** A plate 30 wide and a backer
20 wide, R2 and chamfer 2 on the seam (`fixtures/fillet/reflex-setback.fs`,
record `fixtures/fillet/reflex-setback-reference.json`). Onshape builds both:
the input plus L r²(1 − π/4) and L d²/2, with the backer's end planes grown
over the spandrel ends (11 faces, 27 edges, 18 vertices).

**Fix (`corners.bend` `riser.ok`).** Locally the solid is H_i ∪ (H_j ∩ H_c),
the complement of the convex riser's H_i ∩ (H_j ∪ H_c), and a concave blend
of a solid is the convex blend of its complement. So the riser cap holds with
material and air exchanged: the stripe may be concave when u_i is a concave
line and u_j a convex edge; the cap face grows over the spandrel end through
the same tip-point rule. The ball certificate then asks every other edge near
the vertex to lie wholly in front of the cap plane, in the air the grown cap
face looks into (`riser.side`: the cap plane with its normal reversed).
Chamfers share the construction. The surgery needed no change.

**Measured.**

- Probe input, JS target (`test/fs-fillet.test.mjs` "a reflex seam"):
  - fillet R2: 6617.168146928219 against Onshape's 6617.168146928204
    (2.3e-15 relative);
  - chamfer 2: 6640.000000000012 (1.8e-15);
  - face types and face, edge and vertex counts equal Onshape's.
- Strict STEP (`uv run scripts/validate-step.py`): both valid, 11 faces /
  27 edges / 18 vertices; OCCT volumes 6617.168146928204 and
  6640.000000000001.
- R20 `edge.fs` (sha256 9f98148e…b858), `withBlends=true`: passes 807. The
  crest chamfer removes 16.54863302874522 as before. The backer fillet adds
  151.07969296164046 against 176 (4 − π) = 151.07969296819641. That is
  6.6e-9 absolute: 4.3e-11 of ΔV and 4.5e-14 of the body's 145532.286; the
  two integrated volumes differ in the 14th digit. The next stop is
  `edge.fs:818:15`, the model's own check "foot-plate seam edges not exactly
  two": both foot top faces (rz −36) lie under the backer, which covers them
  up to ry 13.5, so no foot edge lies in the plane ry = 4.5. The foot faces
  carry 8 edges, none in that plane. That is the design, not the kernel (not
  probed in Onshape).
- Tests: the probe pair against the reference, a plate lip 1 mm past the
  backer (the lip's edges lie in the ball, in front of the end plane: builds
  to the closed form), and three typed refusals by name. The plate beyond the
  backer only 16 high (the setback would take the plate face there) is
  `overflow` from the width bound; a second blend at the corner, the
  backer's convex top edge, is `mixed-convexity`; a pocket in the backer's
  end face under the seam's end is refused by the certificate, `vertex-blend`
  "behind vertex", although its fillet would be valid (conservative, as the
  0.5 mm riser). Mutants, each run on the two tests: HEAD `corners.bend`
  fails both; the unreversed cap plane refuses the lip; the dropped concave
  certificate builds the pocket.
- Harness, js and cpu1: the probe pair and the lip build on both targets
  with one result each. They agree with the closed forms and pass strict
  STEP. They ran from a scratch case file; no suite gained a case.
- Nothing else changed. The catalogue (71), kpart (38) and rb (32) suites
  give result, ladder and network texts byte-identical to HEAD on js and
  cpu1 (284, 152 and 128 files). `fs-fillet`, `fillet-production` and
  `fillet-port` pass 35 of 35. KS02 and KS03 are unchanged (2.27e-15 and
  1.60e-14 against Onshape). `return.fs` with `withBlends=true` passes 1035
  and stops at 913 as before.

**No claim.**

- As for the convex riser, no constructed input shows the concave
  certificate alone preventing a wrong answer. Without it the pocket builds
  to its correct volume (6616.418146928205), and the width bound and the
  corner network refuse the bad inputs first.
- Selecting the seam together with the concave edge u_i now builds: a
  concave mitre at the one end and the dual cap at the other. Before, it was
  refused at the far end. Its volume is 6630.811219843323. The closed form
  is 6600 + A (35 + 2c), with A = 4 − π and the spandrel's centroid offset
  c = r (5/6 − π/4)/(1 − π/4). Each spandrel runs to the mitre plane
  x − z = −5, and the result matches to 1.4e-15. This case was not probed in
  Onshape and has no test.

## 9. What is proven and what is not

| claim | status |
|---|---|
| A builds all 53 `ok` catalogue cases exactly, with no wrong answer on 71 + 31 + 32 cases on four byte-identical targets | measured (judge run) |
| A matches Onshape on 11 of its 12 built probes to ≤ 8.3e-8 mm³ (9 to ≤ 7e-12, FP10 to 1.2e-10), with Onshape's face count on all 12 | measured |
| A's FP08 result is the correct one and Onshape's value is approximate | conjecture (all planar face areas match exactly; the Onshape bounds are ±0.75) |
| A and C are independent and agree where both build | measured on 39 catalogue cases (5.9e-12) and all common adversarial cases |
| C never labels an approximation exact, and its stated tolerances hold | measured (dense check by its verifier after the fixes; the judge's tight check found no other issue) |
| A's exported STEP is valid | measured through the production exporter (step 1): 63/63 catalogue, 19/21 and 25/27 adversarial; the four failures are 1e-9 and 1e-6 mm sub-tolerance topology (step 3) and mitre ellipses at 1e6 mm (export refused by name). Not met for a cylinder bounded by an ellipse in a body with a cone (Regression review 2: 2 regression cases; writer gap, the geometry equals the closed forms) |
| the production fillet reads coplanar fragments of wonky's planar Booleans as one face (selection, FS face entities, qAdjacent, riser caps) | measured on the JS target and in the harness on js, cpu1 and cpuN (Regression review 2); the native backend's qAdjacent still answers per fragment; curved fragments are refused `tangent-undecided` |
| A's boundary decisions are robust | measured for the production fillet on the step-3 sweeps (js = cpu1 = cpuN = Metal build on all points, 0 failures); exact where an exact form exists, `undecidable` otherwise (not hit on the step-3 sweeps; hit on 9 points of verify-1's new families, typed); a general rotation and scale 1/2 change 11 of 322 moved points to `sliver` (step 3) |
| A emits no topology below the modelling tolerance | measured for the production fillet: sub-1e-6 mm configurations are refused as `sliver` (step 3); merging within tolerance is refusal-only, still open |
| the setback-mitre semantics matches Onshape | conjecture (step 7) |
| v1 builds KS02, KS03, KS07 and refuses KS01's cradle chamfer, KS04, KS05, KS09 by name | partly measured on the JS target (step 5): KS02 (2.3e-15) and KS03 (1.6e-14) build and match Onshape; KS07 is refused (`overflow`); KS05 and KS09 refuse by name (KS05 not by Parasolid's rule); KS01 and KS04 stop before their blend, outside the fillet |
| the opt-in tolerance stage has corpus value | not measured; no non-analytic input exists yet |
| B covers A's remaining overflow refusals | conjecture (step 10) |
| Metal does not pay for fillets | measured (metal/cpu18 2.8-22x; production A's catalogue: Metal 56.9 s against cpuN 0.54 s compute, integrate stage) |
| the production fillet is byte-identical on js, cpu1, cpuN and Metal | measured on 71 + 33 + 32 suite cases and 368 + 16 moved points (Regression review 1), with **no Metal device stage**: the Metal build runs the fillet on the CPU. With the device stage it was not met (stack overflow on 2 suite cases and 38 sweep points, a different text on two P2 pockets) |
| FeatureScript opFillet/opChamfer and build123d fillet/chamfer run the production fillet; P1-P4 house-style models build and match closed forms | measured on the JS target (step 4); not on KS01-KS09 (step 5) |
| the production fillet (kernel/fillet) gives the prototype's texts but for the riser cap | measured on js and cpu1 (step 2: 533 of 536 files identical, the 3 others the fixed case); after step 3 the texts differ where the exact decisions and the sliver policy apply (5 suite cases) |
| the riser certificate prevents a wrong answer on some input | not shown: no constructed input reaches it that the width bounds do not refuse first (also not for the concave dual: fillet-setback) |
| the concave riser cap (reflex seam) matches Onshape | measured on one probe pair (RS-F, RS-C: volume ≤ 2.3e-15, face types and face/edge/vertex counts equal) and on R20 `edge.fs` (backer seam ΔV against the closed form, 4.3e-11 of ΔV); JS target in the tests, js = cpu1 in the harness on a scratch case file (no committed suite case); the committed suites are byte-identical to HEAD |
