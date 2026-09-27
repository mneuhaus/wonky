---
title: Fillet prototype C "fillet-rollingball"
status: stage 1 (contact-circle solver) and stage 2 (two approximate B-rep outputs) built and measured, 2026-09-24
---

# Fillet prototype C: `fillet-rollingball`

Prototype C of the fillet bake-off (docs/fillet.md §5.3). It is a general
rolling-ball walker whose output states its tolerance. Stages are appended
below; each one records design, evidence and open items.

## Stage C1: the contact-circle solver (2026-09-24)

**Scope.** For every selected edge, solve the rolling-ball contact circles at
fixed edge parameters, each station independently, not by sequential
marching. Certify every station by its maximum ball residual and output the
sampled blend. Chamfers get the matching contact pairs (Onshape
EQUAL_OFFSETS setback). Stage 1 builds no B-rep: every successful solve still
ends as `unresolved not-implemented ...` with the evidence in the reason, and
the sampled blend goes to a separate `.samples` output.

### Files

| file | lines | content |
|---|---|---|
| `kernel/proto/fillet-rollingball/io.bend` | 233 | token reader and printer, a private copy of the hybrid wire code. Words below 2^-60 print as 0 (see Determinism) |
| `kernel/proto/fillet-rollingball/job.bend` | 430 | job parser: vertices, edges with curves, faces with surfaces and edge uses, selection |
| `kernel/proto/fillet-rollingball/geom.bend` | 280 | carriers inside the proto directory: plane, cylinder, cone, sphere and torus; signed distances with a reference direction; curve evaluation and edge intervals |
| `kernel/proto/fillet-rollingball/contact.bend` | 146 | one station: the 3×3 solve, Gauss-Newton and the certificate; the chamfer setback |
| `kernel/proto/fillet-rollingball/main.bend` | 366 | fork-join over edges and stations, classification, result and sample text |
| `kernel/proto/fillet-rollingball/native.bend` | 155 | the harness driver; also writes `<result>.samples` |
| `scripts/fillet/rollingball-c1.mjs` | 308 | independent checker (float64 re-certification, closed forms, swept volume, Onshape, target bytes) |
| `test/fillet-c1-solver.test.mjs` | 123 | 7 focused tests |

The prototype uses only `kernel/real.bend` (F32x2, about 48 bits) and
`kernel/precise.bend` from outside its directory. It carries its own sphere
and torus. `kernel/analytic.bend` is untouched: r20-gate owns it.

### Algorithm

**Per edge.**
- Find the two faces that use the edge. An edge used twice by one face is a
  seam: it is ignored and named in the result (`seam edges ignored: 14`).
- Parameter interval `t0 → t1` in the start→end direction (geom.bend
  `interval`: ranged edges, lines by vertex projection, circles and ellipses
  by angle, closed curves over 2π).
- Stations at `t_k = t0 + (t1 − t0)·k/64`, k = 0..64. The 33 even stations are
  the sampled blend. The 32 odd ones are midpoint checks: the distance of the
  solved midpoint from the chord of its two neighbours, for the centre and for
  both contact curves, measures how far the sampled polyline is from the
  solved curve.

**Per station** (contact.bend). P = C(t), T = unit tangent in the edge
direction, n_A and n_B = outward face normals at P, and T_A = the edge as
face A's coedge runs it.
- Convexity: s = (n_A × n_B)·T_A. s > 0 is convex, so σ = −1 (the ball lies
  in the material); s < 0 is concave, so σ = +1 (the ball lies in the void).
- **Fillet.** Unknown: the ball centre c with
  `sd_A(c) = σr`, `sd_B(c) = σr` and `T·(c − P) = 0`,
  where sd is the signed face distance (outward positive).
  - The Jacobian rows are the unit normals at the current feet and T. So
    every Newton step is monstertruck's contact-circle step: intersect the
    two offset tangent planes at the feet with the normal plane of the edge
    (a 3×3 Cramer solve).
  - Step 0 uses the tangent planes at P. It is exact wherever the section is
    two lines: plane/plane edges and coaxial rims on planes, cylinders and
    cones.
  - Then 8 Gauss-Newton steps (a fixed count, the same work on every lane).
    Each step re-projects c onto both supports by closed-form closest points
    and solves again. These closest points are the limit of monstertruck's
    uv Newton projection. Only the idea is ported (Apache-2.0,
    docs/fillet/implementations.md §5); no code is copied.
  - Contact feet: q_i = c − sd_i(c)·∇sd_i(c).
- **Reference direction.** Next to an axis, the radial direction of c itself
  is undefined. This happens in the sphere cap, where the fillet radius
  equals the post radius and c lies on the axis. So the Newton system
  measures the radial coordinate of c signed along P's radial direction. On
  P's side that is the true distance; through the axis it continues smoothly
  to the distance to P's generator. A centre that ends on the far side
  (signed coordinate < −1e-9) is refused as `radius-too-large`.
- **Chamfer** (Onshape EQUAL_OFFSETS, corrected by probe FP-a): the setback d
  is measured along each support face, perpendicular to the edge:
  p_i = P + d·(n_i × T_i). That is the geodesic when n_i × T_i is a straight
  line in the face: planes, and cylinder and cone generators at a rim. The
  certificate checks p_i against the true surface, so any other
  configuration fails it. It is then refused as `unsupported-surface`, never
  approximated.
- **Certificate** `res`: the maximum of
  - `|d_A(c) − σr|`, `|d_B(c) − σr|` and `|T·(c − P)|`;
  - `|d_A(q_A)|`, `|d_B(q_B)|`, `||q_A − c| − r|` and `||q_B − c| − r|`.

  All distances use the **true** (unsigned-radial) surface distances, not
  the signed ones the Newton step used. For a chamfer: `|d_A(p_A)|`,
  `|d_B(p_B)|`, `||p_i − P| − d|` and `|T·(p_i − P)|`. A station certifies
  when res < 1e-9 mm.

**Parallelism.** No station reads another.
- `tree(d)` in main.bend splits the index range in halves with a parallel
  let: 2^6 leaves, plus the last station.
- `edges.par` halves the selection the same way.
- On Metal the whole `solve` is the device call (`# @bakeoff-device-call`).
  The harness recorded Metal passes (`metalEvidence` true).

**Refusals** (first refusing edge in selection order names the result):

| class | condition |
|---|---|
| `tangent-edge` | min over stations of `\|s\|` < 1e-7. Onshape refuses the same case: FP12, FILLET_FAIL_SMOOTH |
| `mixed-convexity` | s changes sign along the edge |
| `radius-too-large` | the fillet centre crosses the axis or tube centre of a curved support |
| `unsupported-surface` | a chamfer station fails the certificate: the setback is not straight in its face |
| `not-implemented` | a fillet station fails the certificate. Also every successful stage-1 solve, because there is no B-rep yet |
| `invalid-input` | malformed job, edge index out of range, an edge with ≠ 2 face uses, or a selection of seams only |

The per-vertex refusals (mixed convexity at a vertex, vertex blends), overflow,
face consumption and blend overlap belong to later stages. They need the
trimmed faces, which stage 1 does not look at.

### Output

`run(job)` returns the result text. A successful solve reads:

```
unresolved not-implemented rolling-ball stage 1 solves contact circles only (no B-rep yet): 1 edges, 65 stations, every contact circle certified to 1e-9 mm (residuals and the sampled blend in the .samples output)
end
```

`sample(job)` and the native `<result>.samples` file hold the sampled blend
(reals as two U32 words, like the job):

```
wonky-fillet-samples 1
case <id> / op fillet|chamfer / size <real> / intervals 32 / edges <k>
edge <index> ok convex|concave 33
s <k> <t> <P> <c> <pA> <pB> <res> <s>      (33 lines; c = P for chamfers)
cert <max res> <max midpoint deviation>
edge <index> unresolved <class> <reason>   |   edge <index> seam ignored
end
```

### Evidence (MEASURED 2026-09-24, Apple M5 Pro, Bend 2.0.25)

**Harness** (`node scripts/fillet/run.mjs --proto fillet-rollingball --targets js,cpu1,cpuN,metal`;
out/fillet/fillet-rollingball/report.json):
- 70 cases: declined 52 (the `ok` cases; stage 1 has no B-rep) and
  expected-refusal 18.
- All 70 results agree byte for byte on js, cpu1, cpuN and metal.
- Classes: not-implemented 68, radius-too-large 1
  (pc-post-top-rim-too-large-r6, must-refuse) and tangent-edge 1
  (hard-tangent-edge-selection-r1, the case Onshape refuses).

**Independent checker** (`node scripts/fillet/rollingball-c1.mjs --targets cpu1,cpuN,metal`;
tmp/fillet/c1-check.md, out/fillet/fillet-rollingball/c1-check.json), over
all 68 solved cases:

| check | result |
|---|---|
| solver certificate, max over all stations | 4.6e-13 mm (chamfer outlines); ≤ 1.3e-13 on fillets |
| float64 re-certification (geom.mjs, separate surface code): distances, contact normal c − p = σ r n(p), normal plane; chamfer: on-face, setback d into the face | ≤ 2.3e-13 mm |
| closed-form centre, two-line sections (c* = P + σr(n_A+n_B)/(1+n_A·n_B)): 51 cases with plane/plane or coaxial-rim fillet edges | ≤ 1.2e-13 mm |
| closed-form centre, line-circle sections (plane meets cylinder along a generator: pc-dflat, pc-bump) | ≤ 1.8e-14 mm |
| `.samples` bytes js = cpu1 = cpuN = metal | 70 / 70 |

The table below compares the swept section volume with the references. It
only covers single edges, and edges that share no vertex. The volume is a
prism for lines and Pappus for full circles, from the sampled contact points.

| case | ΔV sampled | vs closed form | vs OCCT | vs Onshape probe |
|---|---|---|---|---|
| pp-box-vertical-edge-r2 | −6.867259 | 7.1e-15 | 3.2e-13 | |
| hard-single-edge-r9.999 | −214.558918 | 3.4e-13 | 2.8e-13 | |
| hard-single-edge-r-equals-width-r10 | −214.601837 | 1.1e-13 | (not done) | 4.0e-13 (FP03) |
| hard-full-round-r5 | −107.300918 | 5.7e-14 | (not done) | 3.1e-13 (FP04) |
| corpus-notch-trial-r1.5 | +5.794250 | 2.7e-15 | (not done) | 4.6e-14 (FP02) |
| hard-near-tangent-ridge-178.9-r2 | −2.3589e-5 | 1.2e-10 * | (not done) | 1.2e-10 (FP10) * |
| pc-hole-rim-r1 (torus) | −5.694718 | 8.9e-16 | 1.6e-12 | |
| pc-post-base-concave-r1 (torus) | +5.694718 | 3.4e-14 | 3.1e-13 | |
| pc-post-top-rim-sphere-r5 (sphere cap) | −130.899694 | 5.7e-14 | 1.1e-13 | |
| pc-post-top-rim-spindle-r3.5 | −69.675135 | 2.8e-14 | 1.4e-14 | |
| pc-cone-rim-r1 | −3.203850 | 6.7e-14 | 9.3e-13 | |
| ch-box-vertical-edge-d1 | −4 | 0 | 4.5e-13 | |
| ch-hole-rim-0.42 / ch-post-rim-0.42 | −2.294293 / −2.693300 | 2.0e-14 / 2.8e-14 | 1.8e-13 / 3.1e-13 | |
| ch-convex-60-d1 | −4.330127 | face-offset form 8.7; in-support form 1.1e-7 * | 4.9e-13 | |
| ch-cone-rim-0.42 | −2.601067 | face-offset form 1.2; in-support form 8.9e-14 | (not done) | |
| hex 120° edge, chamfer d = 1 (test variant of pp-convex-120-hex-r2, L = 10) | −4.330127 | | | FP-a (L = 20) −8.660254 → per length agrees to 1e-6 * |

\* See "Fixture geometry" below.

The single-edge closed forms of the corpus (u-plate, comb, roundx, rib root,
L concave+convex, boolean fragments) agree to ≤ 9.4e-13, and OCCT to
≤ 1.1e-11.

**Chamfer semantics confirmed.** The setback reading, not the face offset,
matches:
- Onshape FP-a on the 120° edge;
- the `inSupport` alternatives of ch-convex-60-d1 and ch-cone-rim-0.42;
- OCCT on ch-convex-60-d1 (4.9e-13).

The primary closed forms of those two cases still use the face offset (the
old reading). They need updating in cases.json (open, owner: fixtures).

**Where the sampled volume differs, and why.** These are the overflow,
propagation and cap cases, which stage 1 does not model:
- fl-slot-one-line-propagate-r1: 11 mm³. Stage 1 solves only the selected
  edges; the G1 chain is not propagated.
- fl-slot-one-line-no-propagate-r1: 0.59 against Onshape, from the run-out
  and cap ends.
- corpus-notch-trial-r3: 2.3 against FP01.
- hard-overlapping-blends-thin-wall-r1: 0.11 against FP05.
- hard-overflow-narrow-ledge-r0.4: 0.094 against FP07.
- hard-overflow-convex-small-face-r2: 0.014 against FP09.
- hard-concave-rim-overflow-r6.5: 0.20 against FP13.

In the overflow cases the contact points leave their faces; the stage 2
trimming must detect that ("notch first"). The contact circles themselves
certify there too.

**Midpoint deviation of the sampled blend.**
- Straight plane/plane edges: 0, because the spine is a line.
- Rims with 32 intervals: 2.1e-2 to 2.5e-2 mm; the concave rim at 6.5 reaches
  5.1e-2 mm. That is the chord sag of the spine and contact circles, R(1 − cos(π/32)).
- A stage that fits bi-arcs or tori to the stations must bound this, not the
  polyline.

**Timings** (compute phase, 70 cases):

| target | sum over 70 cases | slowest case |
|---|---|---|
| js | 1013 ms | 166 ms |
| cpu1 | 57 ms | 12 ms |
| cpuN | 68 ms | 7 ms |
| metal | 3908 ms | 69 ms (≈ 55 ms fixed dispatch per job) |

The slowest case is perf-comb-vertical-edges-r0.5 (50 edges, 3250 stations):
166 ms on js, 12 ms on cpu1, 7 ms on cpuN and 69 ms on metal. Builds: cpu
6.3 s, metal 18.9 s.

### Determinism: Metal flushes subnormals

The first harness run matched the result bytes but not the `.samples`
sidecars. Metal differed in 10 of 70 cases:
- in 9 cases only in words that are −0 or subnormal (values below 1.2e-38);
- in the sphere cap, lo-word flips up to 5e-15 mm. There |c − axis|² is
  subnormal next to the axis, and the CPU keeps it where Metal flushes it.

Two fixes:
- geom.bend `slen` returns an exact 0 when |v|² < 1e-20, so no decision near
  an axis depends on a subnormal;
- io.bend prints every word below 2^-60 mm as 0, a printed noise floor of
  8.7e-19 mm.

After them all 70 sample files are identical on js, cpu1, cpuN and metal.
The result text also no longer prints residual exponents. It says "certified
to 1e-9 mm", so it cannot flip between targets at a power of two.

Stage 2 needs the same care. Any exact B-rep coordinate that lands near zero
must be decided by a threshold, not by F32x2 rounding of a subnormal product.

### Fixture geometry (a finding for the fixture owner)

The job bodies carry **F32-rounded** sketch coordinates wherever a value is
not an F32. Two MEASURED examples:
- the hexagon vertex 10·sin 60° is 8.66025447845459 = fround(8.660254037844386);
- the 178.9° ridge apex z is 10.143994331359863.

The sidecar's "quantization error 1.8e-14" compares F32x2 with the kernel
body, not with the FeatureScript source. So at non-axis angles the job
differs from the source by up to about 4e-7 mm. The closed forms (and
Onshape, which builds the source) then differ from any exact result on the
job by:
- 6.6e-8 to 2.8e-6 relative on the 30° to 150° prisms;
- 5e-6 relative on the near-tangent ridge, because the spandrel there is a
  cubic in the angle.

OCCT on the same job agrees with this solver to 1e-13 in every one of these
cases. So the difference is in the fixture, not the solver. The harness
volume tolerance 1e-7·V will flag it for exact prototypes; the pp-convex-60
and pp-convex-30 closed forms are off by 1e-7 relative.

Suggested fixes, to be decided by the fixture owner:
- regenerate the jobs from binary64 sketch endpoints (commit 48c025c did this
  for line sketches);
- or compute the closed forms from the job geometry.

### Open (stage 1 → stage 2)

- **B-rep.** Turn the certified stations into faces. For exact cases the
  stations already equal the closed-form cylinder, torus or sphere to 1e-13.
  A stage-2 builder can recognise the carrier from the stations and check it
  against every station: an exact face when res and the carrier fit are
  < 1e-9 mm, else a stated tolerance. That is the "independent oracle for A"
  role of fillet.md §5.3.
- **Trimming and overflow.** Contact points leaving their faces; notch first.
  **Propagation** along G1 chains (`propagate 1`: the solver takes the
  selection as given today). **Corners and mitres** at shared vertices
  (mixed convexity at a vertex is a vertex matter, not an edge matter).
- Near-tangent edges between 1e-7 and about 1e-2 in |s|: the 3×3 condition is
  1/|s|. The 178.9° ridge (|s| = 0.019) certifies at 1.2e-14; the threshold
  itself is not measured.
- Chamfers on sphere or torus supports, and non-coaxial chamfers on curved
  faces, are refused (`unsupported-surface`). The geodesic setback is not
  straight there, and Onshape's reading of "along the face" on a curved face
  is not probed. Probing it is an Onshape task.
- Metal costs about 55 ms per job in dispatch. Batching several jobs per
  device call is a harness question, not a solver one.
- Not done in this stage:
  - the `onshape` oracle entry in fixtures/fillet/reference.json;
  - the two chamfer probe cases.

  The checker reads the probes directly from
  `~/Workspace/cad/cad-project-041/single-step-r20/kernel-cases/fp-*`.

## Stage C2: two approximate B-rep outputs (2026-09-24)

**Scope.** Turn the certified stations of stage C1 into a full blended body
in the harness result format, in two variants that compete:

- **tori** (`fillet-rollingball-tori`, the task's "C1 output"): the spine
  (the ball centres) is replaced by an arc or a line, so the blend becomes a
  cylinder, torus or sphere (fillet), or a plane or cone (chamfer). The
  measured distance from the true rolling-ball blend is stated;
- **spline** (`fillet-rollingball-spline`, the task's "C2 output"): a
  non-rational B-spline skinned from the station sections, with a stated
  tolerance.

Both variants label every blend face **approximate** with its tolerance
(`tol > 0` in the face record). Neither ever claims exact: prototype A is the
exact producer, and C is its independent cross-check. Support and cap edges
stay exact analytic (lines and circles) in both variants. Only the blend
surface differs.

### Files

| file | lines | content |
|---|---|---|
| `kernel/proto/fillet-rollingball/job.bend` | 451 | now keeps the loops of every face (`Face.loops`), needed for the surgery |
| `kernel/proto/fillet-rollingball/solve2.bend` | 115 | the 65-station solve of one edge, with face A as the face that runs the edge forward |
| `kernel/proto/fillet-rollingball/fit.bend` | 868 | spring recognition (point, line, circle), exact end sections, tori carriers, the skinned B-spline, the deviation certificate and the stated tolerance |
| `kernel/proto/fillet-rollingball/brep.bend` | 803 | one blend record per edge, admission (stage-C2 scope), overflow checks |
| `kernel/proto/fillet-rollingball/clear.bend` | 578 | certified clearance of an edge against a blend strip or end triangle (fix:fillet-rollingball) |
| `kernel/proto/fillet-rollingball/assemble.bend` | 650 | the surgery: vertices, edges, cap loops, blend faces; the driver `build(job, variant)` |
| `kernel/proto/fillet-rollingball/obrep.bend` | 130 | the result body and its printer, including the `bspline` surface record |
| `kernel/proto/fillet-rollingball/main.bend` | 366 | `stations(p)` (the solve, the device call) and `finish(s)` (fits and surgery on the CPU) |
| `kernel/proto/fillet-rollingball-tori/{main,native}.bend` | 39 + 163 | variant 0 as a harness prototype |
| `kernel/proto/fillet-rollingball-spline/{main,native}.bend` | 39 + 163 | variant 1 as a harness prototype |
| `scripts/fillet/bspline.mjs` | 141 | B-spline evaluation, derivatives, closest point and normal (float64) |
| `scripts/fillet/stepx.mjs` | 298 | a copy of the recover STEP serializer plus `B_SPLINE_SURFACE_WITH_KNOTS` and isoline PCURVEs |
| `scripts/fillet/{brepfmt,geom,validate}.mjs` | +32 | the `bspline` result record (docs/fillet/harness.md, "Format extension: bspline"); the validator requires `tol > 0` on it |
| `scripts/fillet/rollingball-c2.mjs` | 267 | independent checker: spline against tori, C against A, closed forms, OCCT, Onshape probes, FP15/FP16 as extra cases |
| `test/fillet-c2-output.test.mjs` | 187 | 8 focused tests |
| `test/fillet-rb-fixes.test.mjs` | 145 | 7 regression tests of fix:fillet-rollingball |

The C1 prototype `fillet-rollingball` itself is unchanged in behaviour: C1's
7 tests still pass.

### Algorithm

1. **Solve** every selected edge as in stage C1 (65 stations, fork-join).
   This is the only device call (see "Metal" below).
2. **Springs.** Each contact curve is recognised from all 65 stations as a
   point, a line or a circle (circle through three stations, then every
   station checked). Every station must lie within 1e-9 mm of the fitted
   curve. Otherwise the blend is refused: a spring off an exact support would
   need a toleranced support face, which is not built. So the support and cap
   geometry of the result stays exact analytic in both variants.
3. **End sections** are exact: the arc of radius r about the end ball centre
   (fillet), or the segment between the two contact points (chamfer). A rim
   gets one section, the seam of its blend face.
4. **Blend surface.**
   - *tori:* the spine is fitted like a spring. A line gives a cylinder, a
     circle a torus, a point (fillet radius = post radius) a sphere. Its frame
     puts the u = 0 seam on the section, and the sphere's axis runs to the
     pole. Chamfers: two lines give a plane, two coaxial circles a cone (a
     plane when they are coplanar). Anything else is `unsupported-surface`.
     A spine that is not one arc or line within 1e-9 mm is refused as
     `not-implemented`: a chain of several bi-arcs (several tori with G1
     joints) is **not built**. No case in the 70 needs it; every spine in the
     corpus is a line or a circle.
   - *spline:* each section arc is 8 cubic Bezier spans (25 poles; 4
     spans until fix:fillet-rollingball), from the contact on A through the
     ball point next to the edge to the contact on B. A chamfer section is
     linear (2 poles). The 33 even stations are the v-rows. The v-direction
     is cubic Hermite, with tangents from a central 7-point difference
     (O(h^6)) on closed spines and 4-point differences at open ends; on a
     circular edge (a rim, whose sections are rotations of one another) the
     tangent is the exact rotation derivative scaled to the best circular
     cubic, 4 tan(θ/4) n × (Q − o) for the step θ per v-span (error ~θ⁶
     instead of θ⁴: the rim tolerance fell from 1e-4 to 1e-8 mm). The result is a bicubic net with 32 v-spans and clamped knots
     with interior multiplicity 3. A straight edge whose sections are
     translates first tries a one-span net, and keeps it if it certifies to
     1e-9 mm.
5. **Certificate and stated tolerance.** Both variants measure the distance
   of their surface from the true rolling-ball blend at all 65 stations. They
   check the contact points, the spine or the section mid points, and for the
   spline the Hermite mid rows at the 32 odd stations, which the fit never
   used. The stated tolerance is the smallest of 1e-9, 1e-8, …, 1e-2 mm at or
   above twice the measured deviation. Above 1e-2 mm the blend is refused,
   and the refusal names the tolerance decade that would be needed (no
   silent growth). Example reason: "a stated tolerance of 0.1 mm would be
   needed, above the 0.01 mm limit".
6. **Admission (stage-C2 scope).** Every selected edge must be one of:
   - an open edge whose two end vertices have degree 3 and carry no other
     selected edge, and whose cap (the third face there) is a plane
     perpendicular to the edge, so that the end section lies in the cap:
     the section, in the edge's normal plane, may leave the exact cap plane
     by at most 1e-9 mm, max(|a − v|, |b − v|)·|n × t| ≤ 1e-9 (until
     fix:fillet-rollingball: 1 − |n·t| < 1e-12, which admitted a tilt of
     7.6e-7 rad and left section edges 3.8e-6 mm off a tol-0 cap);
   - a closed rim whose vertex carries only seam edges besides it.

   Everything else is refused as `vertex-blend`, naming the vertex: mitres,
   G1 chains, corners, degree-5 fragments, oblique caps. Seam edges in the
   selection are ignored with a note.
7. **Overflow (notch first, certified; clear.bend).**
   - Each contact point must lie inside the edge it slides along by more
     than the modelling tolerance τ = 1e-6 − 1e-9 mm. `face-consumed` within
     τ of the far end (the face would vanish or keep a sliver below the
     tolerance), `overflow` beyond it.
   - Every other edge of a support face must stay out of the strip the blend
     removes from that face (points within the contact width w of the edge,
     between the end sections).
   - Other cap edges must stay out of the end triangle (v, a, b).
   - The springs of blends that share a face must stay out of each other's
     strips (`blend-overlap`).

   These are certified over the whole edge, not sampled (until
   fix:fillet-rollingball: 17 samples per edge, and a hole slipped into the
   strip between two of them). The region functions (σ along and across a
   line strip; X and X² − 4R²ρ² for the distance from a circle; the side
   and vertex functions of the triangle) are quadrics in the point, so on a
   line piece they are polynomials and on a circle or ellipse piece
   trigonometric polynomials of degree ≤ 4, with exact coefficients. A piece
   is clear when a second-order Taylor bound proves it out of the region by
   τ/2, or when it lies outside a ball around the region; otherwise it is
   split (at most 4096 pieces, depth 48). A point inside (by τ) refuses
   (`overflow`), a point within τ is `face-consumed`, and a piece that
   cannot be certified is refused too ("not certified"), never passed.
8. **Surgery** (assemble.bend). The end vertex keeps its index and moves to
   the contact on A. The contact on B is appended as a new vertex. Edges on
   face B move to it: lines are rebuilt, and circles keep their curve and
   lose their stated range. Edge e becomes spring B. Spring A, XS and XE are
   appended. Face A uses spring A. A cap loop that no longer chains gets the
   section edge that closes it. The blend face is [-SA, -XS, +SB, -XE], or
   [-SA, +X, +SB, -X] for a rim. For the sphere cap, face A (the disc) is
   dropped and the blend face is [+X, +SB, -X]. Every face is tagged
   `support` or `blend`. Blend faces carry `tol` and the ids of the edge's
   two faces.

### Evidence (MEASURED 2026-09-24, Apple M5 Pro, Bend 2.0.25)

Full harness runs, 70 cases, 4 targets:
`node scripts/fillet/run.mjs --proto fillet-rollingball-{tori,spline} --targets js,cpu1,cpuN,metal`.
The logs are in local development evidence. The checker is
`node scripts/fillet/rollingball-c2.mjs` (2.9 s) and writes
`out/fillet/fillet-rollingball/c2-check.json`.

| verdict | tori | spline |
|---|---:|---:|
| pass-approx (valid, OCCT valid, volume matches closed form or OCCT) | 37 | 37 |
| declined (expect ok, typed refusal `vertex-blend`) | 15 | 15 |
| expected-refusal (typed) | 17 | 17 |
| no-op (178.9° ridge: ΔV −2.36e-5 is below the harness no-op tolerance) | 1 | 1 |
| invalid / mismatch / wrong ok | **0** | **0** |

- **Targets agree.** The result bytes are identical on js, cpu1, cpuN and
  Metal for 70/70 cases in both variants.
- **The two variants agree** on the verdict in 70/70 cases.
- **Stated tolerances.**
  - tori: all 109 blend faces state 1e-9 mm (90 cylinders, 10 tori,
    1 sphere, 3 planes, 5 cones). The spine and springs fit to the 1e-9
    floor everywhere. These faces coincide with A's exact carriers (below)
    but are still labelled approximate.
  - spline: 109 B-spline faces. By count: 1e-9 on 6 (the 3 plane chamfers, as one-span nets, and 3 shallow cylinders of 30° or less), 1e-8
    on 2, 1e-7 on 54, 1e-6 on 28, 1e-5 on 3, 1e-4 on 16. The 1e-4 faces are
    the rims: the Hermite error in v is R θ⁴/384 per span, 1.9e-5 mm at
    R = 5 with 32 spans (`tmp/fillet/c2/devcheck.mjs`).
  - The largest spring tangency angle is 2.6e-8 rad for tori and 6.1e-5 rad
    for spline (G1 only up to the stated tolerance).
- **Spline against tori.** The checker samples every spline face against
  the tori face of the same edge. The largest distance is **1.94e-5 mm**
  over 109 faces, and every face is within its stated tolerance.
- **Volumes.**
  - tori: largest closed-form error 2.76e-6 mm³, on pp-convex-30-acute and
    pp-convex-60. This is the F32 job coordinates of stage C1's fixture
    finding. OCCT's oracle agrees with the result to 3.6e-12 on those cases.
    Exact-axis cases are at 1e-12.
  - spline: largest error 1.49e-3 mm³ (pc-post-both-rims-r1), which fits
    1e-4 mm × the blend area.
  - All 38 volume-checked cases match the closed form in both variants.
    ch-convex-60-d1 and ch-cone-rim-0.42 match the `inSupport` alternative,
    which is the Onshape setback reading (FP-a). The primary form still uses
    the face-offset reading (stage C1 finding).

**Cross-check of A** (prototype A's ladder sidecars,
`out/fillet/fillet-kpart/results/*.cpu1.result.ladder`):

| | cases | |
|---|---:|---|
| both build | 38 | 109 stripes. For each: C's boundary samples on A's carrier, A's contacts on C's face, C's springs on A's spring curves. Largest distance **1.42e-13 mm**, and the carrier types agree on every stripe |
| A admits, C refuses | 19 | 16 are C's stage-C2 scope (`vertex-blend`: mitres, loops, corners, chains, fragments, boss-root mitres). 3 are consumption merges that A builds and C refuses as `face-consumed`: notch r1.5, r = width r10, full round r5 |
| both refuse | 13 | the refusal class agrees in 10. It differs in three places: notch r3 (A `blend-overlap`, C `face-consumed`), short edge in loop (A `blend-overlap`, C `vertex-blend`), mixed-convexity corner (A `mixed-convexity`, C `vertex-blend`) |
| C admits, A refuses | 0 | |

C's refusal classes over all 70 cases:
- `vertex-blend` 19;
- `overflow` 6: notch r6, r12, chamfer d5, narrow ledge r0.4, convex small
  face r2, concave rim r6.5;
- `face-consumed` 4;
- `blend-overlap` 1;
- `radius-too-large` 1 (post rim r6);
- `tangent-edge` 1.

**Onshape probes** (primary oracle where a probe exists; read from the probe
folders, since the `onshape` oracle is not yet in reference.json):

| probe | case | Onshape | C (both variants) |
|---|---|---|---|
| FP01, FP02 | notch r3, r1.5 | builds (+20.834, +5.794) | `face-consumed` |
| FP03, FP04 | r = width r10, full round r5 | builds (−214.602, −107.301) | `face-consumed` |
| FP05 | overlapping blends, thin wall | builds | `blend-overlap` |
| FP06, FP08, FP11, FP14 | short edge, boss-root mitres, slot no-propagate, mixed corner | builds | `vertex-blend` |
| FP07, FP09, FP13 | narrow ledge, convex small face, concave rim r6.5 | builds | `overflow` |
| FP10 | 178.9° ridge | builds, ΔV −2.358875e-5 | builds, ΔV −2.358887e-5 (err 1.2e-10) |
| FP12 | tangent-edge selection | **refuses** (FILLET_FAIL_SMOOTH) | **refuses** (`tangent-edge`) |
| FP15 | chamfer 120° edge, d = 1 | V 5187.4921686687885, chamfer face 34.641016 mm², 9 faces | valid, V **5187.492168668795** (6e-12), chamfer face 34.6410161513775 mm², 9 faces |
| FP16 | chamfer box corner, d = 1 ×3 | builds, 10 faces, ΔV −29.3333 | `vertex-blend` (corner) |

C never builds something that Onshape refuses. Every case that Onshape builds
and C refuses gets a typed class. FP15 confirms the setback chamfer
bit-for-bit within 6e-12 mm³. FP15 and FP16 run as extra cases through the
harness-built binaries. Their jobs come from
`node scripts/fillet/ladder.mjs --probes` (tmp/fillet/a1/probes).

**Timings** (computeMs per case: median / max / sum over 70):

| target | tori | spline |
|---|---|---|
| js | 133 / 1630 / 11913 | 118 / 3597 / 14335 |
| cpu1 | 3 / 144 / 397 | 10 / 344 / 1364 |
| cpuN (18 threads) | 4 / 96 / 391 | 7 / 196 / 881 |
| metal | 125 / 885 / 11594 | 66 / 284 / 5104 |

The slowest case is perf-comb-vertical-edges-r0.5 (50 edges): 144 ms tori,
344 ms spline on cpu1. Build times: tori cpu 14.7 s, Metal 33.8 s; spline
cpu 95 s, Metal 64 s. Metal remains dispatch-bound (about 55 ms per job, as
in stage C1).

### Findings (Bend 2.0.25 native backend)

- **Arity over 255.** Sum types are flattened into words. J.Curve is about
  23 words and a Blend record about 200, so two blends in one constructor
  broke the native build ("an arity over 255"). Fix: Blend is made recursive
  with a `BlendNil{next: Blend}` that is never built, which keeps it boxed
  (one word). The walks use `match` helpers instead of `Bool.pick` over
  records.
- **`Bool.pick` is eager.** `Bool.pick(c, f(t), h <> f(t))` evaluates both
  recursive calls, so the walks became exponential. The comb case took more
  than 2 min on cpu1, and 277 ms after the fix with `match` helpers
  (`cons_if`, `inc_if`). The same fix on the pairwise overflow side test
  brought the comb from 274 ms to 92 ms on cpu1 (bytes unchanged).
- **Metal: the whole build as the device call overflowed the machine stack**
  ("memory fault (machine stack overflow?)" on 68/70). Fix: only the station
  solve is the device call (`stations(p)`). Fits and surgery run on the CPU
  (`finish(s)`). The Metal build fell from 504 s to 35 s.
- **F32x2 words from Bend are not always the encoder's canonical split.**
  Compare round trips by value, not by bytes.

### Open (stage 2 → stage 3)

- **Bi-arc chains.** A spine that is not one arc or line is refused
  (`not-implemented`). The corpus has none. A real bi-arc chain (several
  tori, G1 joints, one deviation certificate per piece) is the next step for
  general spines, for example a fillet along a B-spline edge, which v1 does
  not admit anyway.
- **Vertex blends** (19 cases: mitres, loops, corners, G1 chains, fragments)
  and the **consumption merges** Onshape builds (notch r1.5/r3, r = width,
  full round) are not built. A's corner stage covers some of them. C stays
  the cross-check for the stripes only.
- **The overflow checks** are certified since fix:fillet-rollingball
  (clear.bend); they refuse, not notch: `overflow: notch first` is the
  decision for v1, the notch itself is not built.
- **The spline tolerance at rims** is 1e-8 mm since fix:fillet-rollingball
  (exact rotation tangents with circular arms, 8 section spans); it was
  1e-4 mm with difference tangents.
- For the fixtures owner (repeated from stage C1):
  - the `onshape` oracle entry in fixtures/fillet/reference.json;
  - the two chamfer probe cases as real cases (they currently run as extra
    cases in the checker);
  - the face-offset primary closed forms of ch-convex-60-d1 and
    ch-cone-rim-0.42;
  - the F32 job coordinates.

## fix:fillet-rollingball (2026-09-24)

Six defects found by verify:fillet-rollingball, fixed at the root; each
repro is in fixtures/fillet/adversarial-fillet-rollingball.json with a
`regression` record, and the `adv-rb-fix-*` cases pin the fixes at their
limits.

| # | defect | root cause | fix |
|---|---|---|---|
| D1 | near-tangent ridge (normal angle ≤ 1e-5 rad): ok with the blend face inverted | the reference normal unit(P − section mid) has length r(1/cos b − 1) ≈ 2.5e-11 mm, below the 1e-20 floor of unit() | the reference normal is n_A(p_A) + n_B(p_B), the supports' outward normals at the springs (brep.bend `ref_normal`); exactly the chamfer normal, the fillet normal at the section mid |
| D2 | a hole entering the blend strip between two of the 17 samples: ok with intersecting loops | sampled overflow | certified clearance (clear.bend, above) |
| D3 | r = 1e-5: start section swept 270° | arc_shape normal unit((pf − c) × (m − c)), |·|² = r⁴ sin²45° < 1e-20 | normals from unit radii (fit.bend arc_shape, section_row; clear.bend triangle) |
| D4 | cap tilted by < 1.41e-6 rad admitted; section edges up to 3.8e-6 mm off the tol-0 cap | admission 1 − |n·t| < 1e-12 | admission bounds the section's distance from the cap: max(|a − v|, |b − v|)·|n × t| ≤ 1e-9, else `vertex-blend` naming the needed decade |
| D5 | r = width − 1e-9: 1e-9 mm sliver faces | absolute eps 1e-9 in over.slide | the band τ = 1e-6 − 1e-9 mm in every overflow test: a face within τ is consumed |
| D6 | spline STEP: 34 of 39 exports failed strict CurveOnSurface | no pcurves (OpenCascade projected the edges itself: other parametrisation, re-trimmed faces), and a spline boundary up to 2e-5 mm off the exact edges, above the 1e-7 mm edge tolerance OpenCascade derives on import | scripts/fillet/stepx.mjs writes isoline PCURVEs in the 3D curve parameter (Hermite nodes at the knots); the spline is skinned with 8 section spans and exact rotation tangents on rims (boundary within ~1e-8 mm) |

