# Curved B-rep Booleans and surface-surface intersection

Chapter of the wonky research knowledge base, 2026-09-24. English.

**Status and method.**

- **Deep reads.** 18 source notes cover this topic. They are under
  [sources/](sources/) and linked in section 2. This chapter re-read all 18
  in full.
- **Publish-first step.** It was a no-op: `tmp/research/notes/` holds no JSON
  for this topic, and every note already had its Markdown file.
- **Workflow input.** The scout's landscape and catalog. The 13 catalog-only
  sources are in section 7.
- **Checks made for this chapter.**
  - wonky's working tree (2026-09-24): [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md),
    [../proto-recover.md](../proto-recover.md), [../bakeoff.md](../bakeoff.md),
    [../intersections.md](../intersections.md), [../entscheidungen.md](../entscheidungen.md),
    `kernel/analytic.bend` and `kernel/hybrid/recover/geom.bend`.
  - GitHub metadata, re-checked with `gh api` on 2026-09-24 for
    ricosjp/truck, ying-yu-yang/SolidBoolean, mfernba/rGWB and CGAL/cgal.
  - The STEP entity pages for `hyperbola`, `parabola` and
    `intersection_curve` on steptools.com (HTTP 200).
- Nothing was built or run.

**Labels.**

- **DOCUMENTED**: read in a primary source, either by the note author or for
  this chapter. The link leads to the note, and the note carries the primary
  URL.
- **INFERRED**: reasoning from evidence. That includes the derivations the
  note authors added and checked numerically but did not prove.
- **HEARSAY**: secondhand.

**Correction to the scout's framing (DOCUMENTED, wonky docs).** The scout
worked from the state of 2026-09-22: "bake-off running", "blocked at a
plane/cylinder union". By 2026-09-24 that has changed:

- **The bake-off is decided** (judge round 2, 2026-09-23).
  - corefine decides the topology. It is a tagged, Manifold-style mesh
    Boolean in Bend with shared symbolic perturbation over F32x2.
  - recover rebuilds the exact B-rep from the tags, and refuses by name what
    it cannot certify.
  - exact-plane stays as a differential oracle. sdf produces no Boolean
    results.
  - Source: [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §1.
- **The r10b g10 plane/cylinder union is exact on the hybrid.**
  - Bake-off results table: `r10b-g10-union` exact, 100 / 76 ms compute at
    cpu1 / cpu18 ([../bakeoff.md](../bakeoff.md), results table).
  - The plan quotes 1.2e-10 relative to OCCT on the frozen operands.
  - In production the r10b model still stops at `25:2`. The reason is not
    SSI: the hybrid dispatch "refuses an operand printMesh does not cover"
    (plan step 7 status).
- **So the g10 blocker is now integration work.** The scout inferred that
  plane/cylinder never needs a non-analytic curve and that the failure had to
  be topological. The outcome agrees: the mesh Boolean decided the topology,
  and recover needed only lines, circles and ellipses.

This chapter therefore aims at the next two problems. The first is recover's
named refusals (plan step 9, "Close the Unresolved set"). The second is the
production analytic SSI: `kernel/intersections.bend` handles only plane/plane
and plane/cylinder ([../intersections.md](../intersections.md)).

---

## 1. Landscape

### 1.1 One pipeline shape, documented three times

Three independent primary sources describe the same Boolean driver
(DOCUMENTED):

- OCCT's General Fuse specification:
  [sources/occt-boolean-operations-specification-general-fuse-algorithm.md](sources/occt-boolean-operations-specification-general-fuse-algorithm.md);
- the ACIS R17 Booleans article:
  [sources/acis-r17-user-guide-booleans-technical-article.md](sources/acis-r17-user-guide-booleans-technical-article.md);
- Parasolid's tolerant modelling, via Jackson 1995:
  [sources/jackson-1995-boundary-representation-modelling-with-local-to.md](sources/jackson-1995-boundary-representation-modelling-with-local-to.md).

The shared driver has six steps:

1. Compute interferences in increasing dimension: V-V, V-E, E-E, V-F, E-F,
   and F-F last.
2. Merge coincidences. OCCT does this with paves, pave blocks and common
   blocks; Parasolid with "sum of tolerances" joins.
3. Compute face/face section curves only for contacts that the
   lower-dimensional stages did not already explain.
4. Trim the curves to both faces and build p-curves.
5. Split edges and faces, and unify same-domain faces.
6. Classify in/out/on, select by operation, and stitch.

**Where the robustness comes from.** Four sources agree that it comes from
the *order* and from *deciding each fact once*, not from arithmetic:

- Jackson (sec. 4.1): F-F "need not consider curves ... already known to be
  common by virtue of edge-edge or edge-face comparison ... since computation
  of near-tangent intersection curves can be very unstable".
- Hoffmann 1989 §3.4.1: "avoid asking the same geometric question more than
  once". The mark-A-on-B-then-B-on-A pipeline is non-robust
  ([note](sources/hoffmann-geometric-and-solid-modeling-1989-fundamental-techn.md)).
- Mäntylä 1986 §7: every test reduces to one point-coincidence primitive,
  and tests run in a fixed order
  ([note](sources/m-ntyl-1986-boolean-operations-of-2-manifolds-through-vertex.md)).
- Miller-Goldman TR-93-02 §4.7: return the known conic/conic crossing
  points from the surface data, because a later conic/conic intersection can
  miss them in "numerical fuzz"
  ([note](sources/miller-goldman-1995-geometric-algorithms-for-detecting-and-c.md)).

All DOCUMENTED.

**Where they differ: what happens to tolerances** (DOCUMENTED).

- OCCT grows vertex and edge tolerances and offers a user "fuzzy" value. Its
  dominant failure class in 2025-2026 issues is "IsDone() == true but wrong",
  triggered by seams, coincident sub-shapes and tangent junctions (#1496,
  #1543 in the OCCT note).
- Parasolid stores tolerances on topology. Its merge takes the maximum, and
  Jackson names unbounded tolerance growth as the open problem.
- wonky forbids silent tolerance growth ("kein stilles Toleranzwachstum,
  stattdessen die nötige Toleranz melden",
  [../entscheidungen.md](../entscheidungen.md) item 10).

### 1.2 Two SSI traditions, and which one fits wonky's surfaces

**General-surface SSI.** This is marching, subdivision, lattice and
algebraic methods over parametric patches (Patrikalakis-Maekawa-Cho, see
[sources/patrikalakis-maekawa-cho-shape-interrogation-for-computer-ai.md](sources/patrikalakis-maekawa-cho-shape-interrogation-for-computer-ai.md)).
Its modern frontier is the AMSS/CAS group of X. Jia, which publishes
topology-guaranteed B-spline SSI (TOG 2023), the hybrid Boolean (TOG 2025),
overlap extraction (SIGGRAPH Asia 2025) and small-loop and tangent handling
(TOG 2026). The group names efficiency as the main limitation (DOCUMENTED,
slides, in the
[survey note](sources/li-yang-jia-2026-advances-and-challenges-in-surface-surface-.md)).

**Special-surface SSI** is the tradition that fits wonky's carriers (plane,
cylinder, cone, sphere, torus). Its lineage (DOCUMENTED in the linked notes):

| year | work | contribution |
|---|---|---|
| 1976-79 | Levin | pencil + ruled member, p = a ± d·√s; loses lines, nested radicals |
| 1987 | Miller | natural-quadric QSIC as a(t)s² + b(t)s + c(t) = 0 on a ruled input surface; critical t values geometrically |
| 1989 | Piegl | geometric natural-quadric SSI for trimmed NURBS; non-planar curves fitted (not read) |
| 1992-95 | Miller-Goldman | complete conic table (GMIP Table 4), tangent-ball plane sections, line + cubic theorems |
| 1994 | Shene-Johnstone | axial-plane quadrilateral, height test, isolated tangency and disjointness |
| 2003 | Wang-Goldman-Tu | Levin enhanced: morphology from the root pattern of s(u), rational singular curves |
| 2006-08 | Dupont-Lazard-Lazard-Petitjean + QI | exact, near-optimal parameterisation of every QSIC; rational-only classification; implementation |
| 2009 | Tu-Wang-Mourrain-Wang | 35-type classification by signature sequences, rational arithmetic only |
| 2024 | Shao-Chen | trimmed QSIC with exact topology and certified endpoint error |
| 1998-2026 | Kim-Kim-Oh, Li-Zhang-Ye, Liu et al., Kim, Jia, Caravantes/Gonzalez-Vega | torus against quadric and torus: circle catalogues, pre-image topology, cutcurve + lift |

The production analogue is OCCT's `IntAna_QuadQuadGeo`. Its closed forms
cover only part of Miller-Goldman's table (DOCUMENTED, code at `3d097a0`, in
the [Miller-Goldman note](sources/miller-goldman-1995-geometric-algorithms-for-detecting-and-c.md)
and the [OCCT IntPatch note](sources/open-cascade-technology-occt-intpatch-impimpintersection-and.md)):

- It lacks the intersecting-axes cylinder/cone and cone/cone conic cases.
  Those go to `IntAna_IntQuadQuad` and come back as an `ALine`, so a conic
  that exists is never recognised as one.
- Torus pairs are closed-form only when coaxial.

### 1.3 The exactness lineage and what it costs

There are three complete exact systems: ESOLID, EXACUS/QuadriX with its
parameterisation successor DHPS, and QI. They show what exactness buys and
what it costs:

- **ESOLID** is the only complete exact curved Boolean published. Its input
  "is restricted to non-degenerate configurations", and the authors write
  that it "cannot be considered a robust system". Its target was to be at
  most two orders of magnitude slower than the floating-point BOOLE; it came
  in under 10x with PRECISE and under 100x in the worst case (DOCUMENTED,
  [ESOLID note](sources/esolid-exact-boundary-evaluation-for-low-degree-curved-solid.md)).
- **EXACUS/QuadriX (SoCG 2005) and DHPS (thesis 2008)** compute exact planar
  maps and adjacency graphs of quadric arrangements.
  - Cost: about 7 ms per edge on random inputs and about 25 ms per edge on
    degenerate ones (2005 hardware). On degenerate inputs, gcds over Q(√δ)
    take about 80 % of the runtime.
  - Neither approach delivered the full 3D arrangement, so there are no
    Booleans on quadric solids (DOCUMENTED,
    [EXACUS note](sources/exacus-berberich-et-al-2005-and-dupont-hemmer-petitjean-sch-.md)).
- **QI** classifies and parameterises pairs in about 3 ms per pair on real
  CSG scenes (2005 P4). The output heights are 22 to 38 times the input
  height (DOCUMENTED, [QI note](sources/qi-quadric-intersection-library-loria-gamble.md)).

The lesson (INFERRED from these three): **exact classification is cheap,
exact geometry is expensive, and degenerate cases dominate the cost exactly
where CAD models live.** The pencil-box scene has 356 nodal quartics among
1,830 pairs (DOCUMENTED, QI §7.2).

The design rule that follows: decide type, topology and incidence exactly on
multi-limb U32, and evaluate geometry in F32x2 with a stated bound.

### 1.4 The hybrid lineage: mesh decides topology, surfaces give geometry

Three systems share this structure:

| | Yang et al. 2025 (TOG) | Truck `shapeops` | wonky corefine + recover |
|---|---|---|---|
| topology from | Cherchi 2022 mesh Boolean on certified meshes | per-face-pair mesh interference, polyline chaining | corefine: tagged Manifold Boolean3 port with shared symbolic perturbation |
| candidate detection | dε-inflated AABBs (no false negatives), Gauss-map filter, seeds for non-crossing pairs | mesh crossings only | the whole tagged mesh Boolean; a pre-certificate refuses pairs closer than h + h' that the result does not decide |
| curve geometry | refined points, then **polylines fitted in (u, v)** | chord-plane Newton on a polyline leader, then a quadratic B-spline fit accepted by one hashed sample per span | **exact analytic curve from the two carriers**, certified against the mesh run |
| contact / coplanar | 2D Boolean pre-pass for coplanar faces only | none (#57, #114) | carrier classes merge coplanar and co-axial faces; point and line contact refused by name |
| measured | 0.06 s average on 10k ABC pairs; 0 failures on 400 hard ops (OCCT 10, Rhino 8, ACIS 1) | only `punched_cube`, no assertions | 32/38 corpus exact STEP; after steps 1-4, 0 wrong recover outputs on the adversarial suites |
| code | empty GPL-3.0 placeholder | Apache-2.0 | wonky |

Sources: [Yang 2025 note](sources/yang-jia-wang-yang-xin-yan-2025-boolean-operation-for-cad-mo.md),
[Truck note](sources/truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean.md),
[../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §1 and §9,
[../proto-recover.md](../proto-recover.md). All DOCUMENTED.

INFERRED: wonky's design is the stricter member of the family. It never fits
curves, and it refuses what it cannot certify. The price is the named
Unresolved set, which consists entirely of curve types and vertex types that
recover lacks (section 1.8).

### 1.5 The curve set a plane/cylinder/cone/sphere/torus Boolean needs

**What the reference formats carry** (DOCUMENTED):

- **Parasolid XT V35** has three analytic curves: LINE, CIRCLE and ELLIPSE.
  - There is no parabola and no hyperbola.
  - Everything else is INTERSECTION (two surfaces, a chart, typed limits),
    B_CURVE, SP_CURVE (a 2D curve in a surface's uv) or TRIMMED_CURVE.
  - Source: [XT note](sources/parasolid-xt-format-reference-v35-intersection-curve-chart-t.md).
- **STEP** does define `hyperbola` (semi_axis, semi_imag_axis) and
  `parabola` as conic subtypes, plus `intersection_curve`:
  - https://www.steptools.com/stds/stp_aim/html/t_hyperbola.html
  - https://www.steptools.com/stds/stp_aim/html/t_parabola.html
  - https://www.steptools.com/stds/stp_aim/html/t_intersection_curve.html
- **wonky today** has `Line`, `Circle` and `Ellipse` in `kernel/analytic.bend`.

Minimal set (INFERRED, from the case tables in section 3):

| carrier pair | curves that occur | wonky today |
|---|---|---|
| plane / plane, cylinder, sphere | line, circle, ellipse, generator lines, tangent line or point | yes |
| plane / cone | circle, ellipse, **hyperbola, parabola**, 1-2 lines or the apex (plane through the apex) | circle only (`geom.bend` refuses hyperbola, parabola and oblique ellipse) |
| natural quadric / natural quadric | conic pairs (Miller-Goldman Table 4), line + space cubic, **space quartic** (smooth, nodal, cuspidal), double lines, isolated points | coaxial circles only |
| plane / torus | circles (⊥ axis, meridians, Villarceau), **spiric quartic** | ⊥ axis and through-axis only |
| torus / quadric, torus / torus | circles in named configurations, otherwise degree ≤ 8 curves | coaxial torus/cylinder only |

So the needed curve kinds are:

1. **Line, circle and ellipse.** Present.
2. **Hyperbola and parabola.** Cheap to add, and STEP has entities for them.
3. **One exact representation of a ruled-quadric section.** Examples are
   Miller 1987's form and the generator chart of section 3.4. It is exact per
   point and needs no iteration.
4. **One exact procedural two-surface curve with terminators**, as in XT's
   INTERSECTION. It serves torus pairs and, later, fillet spines.
5. **p-curves.** A plane section of a cylinder is a sinusoid in (θ, h),
   rational in tan(θ/2).

These relations and vertex types must be first-class outcomes rather than
failures:

- coincident carriers;
- tangent point, tangent line and tangent circle;
- disjoint carriers;
- two-carrier singular vertices, such as the Steinmetz crossings;
- tangent vertices, such as the hex nut's.

### 1.6 Trends 2023-2026

- **The Jia group leads SSI research.** Its line runs from topology
  guarantees (2023) to a hybrid Boolean (2025), overlaps (SIGA 2025),
  small loops and tangency (2026), watertightness (CGF 2025) and a survey
  (CAD 2026). The hybrid paper is the published twin of wonky's decision
  (DOCUMENTED, titles and DOIs in the notes; survey content INFERRED from its
  reference list).
- **Exact special-pair theory keeps moving:**
  - Shao-Chen 2023/2024 (trimming, discriminants);
  - Caravantes/Gonzalez-Vega 2025/2026 (torus/quadric cutcurve without a
    generic-position assumption).

  Both are theory papers with no code (DOCUMENTED).
- **Open-source kernels stall at curved Booleans:**
  - Fornjot shut down in 2026 without them
    ([note](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md)).
  - Truck's Boolean has had no maintainer work since the coplanar and
    touching reports: PRs #110 and #111 have been open without review since
    2026-01/02, and the last push is a 2026-09-07 dependency bump
    (DOCUMENTED, `gh api`, 2026-09-24).
- **LLM-authored fixes have appeared** (DOCUMENTED, Truck PR #110, "done by
  Gemini+Claude"). That PR accepts Newton's initial guess on failure and
  drops tiny loops. It is a cautionary data point for wonky's LLM-driven
  workflow: fixes need adversarial acceptance tests, not just a green case.

### 1.7 What is conspicuously missing

- **There is no permissively licensed, robust, curved-B-rep Boolean.** OCCT
  (LGPL) is the only production-grade open one, and its dominant failure is
  a silent wrong answer. Truck (Apache) and SolveSpace (GPL) fail on
  tangency and coincidence; SolveSpace
  [#1268](https://github.com/solvespace/solvespace/issues/1268), a cube plus
  a tangent cylinder giving naked edges, is wonky's old blocker class
  ([SolveSpace note](sources/solvespace-nurbs-boolean-src-srf-boolean-cpp-surfinter-cpp-r.md)).
- **There is no implementation of Shao-Chen 2024**, no public code for Yang
  2025, and the QI source is lost. The QI web server still answers
  (DOCUMENTED, probes 2026-09-23 and 2026-09-24).
- **There is no open implementation of a Parasolid-style procedural
  intersection curve** with a C1 chart, a uv cache and terminators. Truck
  has only the interior evaluator (DOCUMENTED, XT and Truck notes).
- **There is no public test corpus of degenerate quadric and torus Boolean
  cases.** The closest things are:
  - QI's canonical pairs per type;
  - the 50 quadric pairs of Trocado/Gonzalez-Vega 2019;
  - the 14 torus examples of Caravantes et al.;
  - wonky's own bake-off suites.
- **Torus coverage is thin everywhere.**
  - There is no single-radical parameterisation theory for torus/quadric,
    comparable to DLLP.
  - Kim 2012 (torus/torus circles) could not be read.
  - The CAGD 2026 torus paper excludes the most common FDM case: a
    cylinder parallel to the torus axis, c = 0.

  (DOCUMENTED, [torus-quadric note](sources/tools-for-analyzing-the-intersection-curve-between-a-torus-a.md)
  and [Li-Zhang-Ye note](sources/li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec.md).)
- **Nothing targets double-word floats or pure fork-join execution.**
  - GPU SSI work parallelises candidate detection and sampling, not topology
    assembly ([Zoo note](sources/zoo-kittycad-cad-engine-overview-gpu-surface-surface-interse.md),
    catalog items on Krishnamurthy 2009 and Lin 2014).
  - The exact systems are single-threaded C++ with shared caches.

### 1.8 Where wonky stands (working tree, 2026-09-24; DOCUMENTED)

**Production analytic SSI.** `kernel/intersections.bend` covers plane/plane
and plane/cylinder. Its outcomes are typed: `Resolved{relation}`,
`Unresolved{reason}` or `Rejected`. The relations are `CircleSection`,
`EllipseSection`, `TwoGenerators`, `TangentGenerator`, `EmptySection` and
the plane/plane ones.

**Recover's curve table.**

- Supported: lines, circles and ellipses. That covers plane/plane,
  plane/cylinder, plane/cone ⊥ axis, plane/sphere, sphere/sphere, the
  coaxial pairs, plane/torus ⊥ axis and plane/torus through the axis.
- `geom.bend` refuses everything else with **26 free-text `CvNo{...}`
  strings**, for example:
  - `"plane/cone section is a hyperbola (curve type missing in the body format)"`;
  - `"cylinder/cylinder intersection off a common axis is a space quartic (curve type missing)"`.
- Several decisions use hard-coded absolute thresholds: 1e-12 on
  1 − |n·a|, 1e-9 on the cone slope, 1e-10 on h².

**The named Unresolved set.**

On the corpus:

- `pipe-tee`: space quartic;
- `steinmetz-intersect` and `steinmetz-union`: "2-carrier vertex (quartic)";
- `hex-nut`: a degenerate tangent vertex plus plane/cone hyperbolas.

In the extra and adversarial sets:

- `x-rod-cross-hole`: cylinder/cylinder quartic;
- `x-torus-tilted`: spiric section;
- off-axis sphere/cylinder at 2 mm and at 1e-6 mm;
- a torus tangent to a plane;
- about ten "tolerance-level topology" refusals (bosses that poke through by
  0.005 mm, thin walls, 1 µm features).

Source: [../proto-recover.md](../proto-recover.md), "Supported and
unsupported" and the tables of its "Adversarial replay" and "Extra cases"
sections.

**The plan.** Plan step 9 orders the closure by FDM value:

1. the hex-nut;
2. cylinder/cylinder quartics "as B-spline curves with a stated bound";
3. sphere and torus in the body format and exporter.

**New scope.** Torus and sphere became production face types on 2026-09-24
([../entscheidungen.md](../entscheidungen.md) item 2). Fillet work will
create torus patches at every hole and boss rim.

### 1.9 Licensing for porting

| source | licence | what wonky may do |
|---|---|---|
| Truck | Apache-2.0 | port with attribution and NOTICE; already done for the dataflow |
| rGWB (Mäntylä reimplementation) | MIT | port logic with attribution |
| GWB 1988 | research/education only, no commercial use | study only |
| OCCT | LGPL-2.1 with exception | ported files stay LGPL; study and re-derive instead |
| CGAL algebraic kernel (EXACUS descendant) | LGPL-3.0-or-later OR commercial | study only; oracle use in tests needs Marc's OK |
| QI | proprietary non-commercial; code lost | re-implement DLLP from the papers; store server facts as fixtures, re-check the wording before distributing |
| Yang 2025 | text CC BY-NC; announced code repo GPL-3.0 (empty) | clean-room from the paper only |
| papers (Jackson, Miller-Goldman, Shene-Johnstone, DLLP, WGT, Shao-Chen, Li-Zhang-Ye, Caravantes et al., Hoffmann, Mäntylä, Piegl) | publisher copyright, no code | algorithms are free to re-implement; do not copy text or figures |
| Parasolid XT, ACIS docs, Spatial blog | vendor documents | reimplement the described behaviour and data model |

All rows are DOCUMENTED in the linked notes. wonky is private and
unlicensed; nothing here needs to be linked.

---

## 2. Comparison table

| name | kind | status | license | verdict | key idea (one line) | note |
|---|---|---|---|---|---|---|
| Jackson 1995, B-rep modelling with local tolerances | paper (SMA '95) | historical; still Parasolid's shipped model | ACM ©, no code | adapt | imprint V-V → V-E → E-E → V-F → E-F before F-F; F-F skips contacts already known; tolerances live on topology, a merge takes the max | [link](sources/jackson-1995-boundary-representation-modelling-with-local-to.md) |
| Parasolid XT format reference V35 | vendor format spec | live (2022 edition) | Siemens document, no code | adapt | INTERSECTION curve = 2 surfaces + exact chart + terminator limits; C1 chord parameterisation; 3x3 chord-plane evaluator | [link](sources/parasolid-xt-format-reference-v35-intersection-curve-chart-t.md) |
| Yang, Jia, Wang, Yang, Xin, Yan 2025, hybrid-representation Boolean | paper (TOG 44(4)) | new; code promised, repo empty | text CC BY-NC; repo GPL-3.0 | adapt | certified dε meshes + conservative candidates + surface refinement; the mesh Boolean decides topology; 17x faster than OCCT, 0 failures on 400 hard ops | [link](sources/yang-jia-wang-yang-xin-yan-2025-boolean-operation-for-cad-mo.md) |
| Truck `truck-shapeops` | Rust code | active, slow on Booleans (1,567★, pushed 2026-09-07) | Apache-2.0 | adapt | mesh-seeded `IntersectionCurve{s0, s1, leader}` lifted by chord-plane Newton; no contact pre-pass, fails on touching and coincident faces | [link](sources/truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean.md) |
| Miller & Goldman 1995 (+ TR-93-02, TangentBalls 1992, Miller 1987) | papers | historical, foundational | ©, author-hosted, no code | **adopt** | complete conic table for natural-quadric pairs, transformation-free constructions; a(t)s² + b(t)s + c(t) = 0 for the rest | [link](sources/miller-goldman-1995-geometric-algorithms-for-detecting-and-c.md) |
| Shene & Johnstone 1994 | paper (author manuscript) | historical | ACM ©, no code | adapt | axial-plane quadrilateral and height test; isolated tangency and disjointness; common inscribed sphere iff conics | [link](sources/shene-johnstone-1994-on-the-lower-degree-intersections-of-tw.md) |
| Dupont, Lazard, Lazard, Petitjean 2008, I-III | 3 journal papers | finished theory | Elsevier ©, HAL open | adapt | exact proper QSIC parameterisation with at most one extra √; rational-only pencil classification; singular cases rational | [link](sources/dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md) |
| Li, Zhang, Ye 2004 (+ Liu 2011, Kim 1998/2012) | papers | historical, low impact | journal ©, open PDF | learn-from | torus/cylinder and torus/cone as a quartic per generator; torus/sphere closed form; meridian, Villarceau and profile circle catalogue | [link](sources/li-zhang-ye-2004-algebraic-algorithms-for-computing-intersec.md) |
| Shao & Chen 2024, trimmed quadrics with tolerance control | paper (JSSC) | new, 0 citations, no code | Springer © | adapt | exact QSIC topology + certified endpoints via univariate sign conditions; sign of a + b√c from four signs | [link](sources/shao-chen-2024-topologically-correct-intersection-curves-of-.md) |
| Mäntylä 1986, vertex neighbourhood classification (+ GWB, rGWB) | paper + code | foundational; rGWB last push 2019 | ACM ©; GWB non-commercial; rGWB MIT | adapt | every "on" case reduces to vertex/face and vertex/vertex sector classification; ON policy table (printed "\" row is wrong) | [link](sources/m-ntyl-1986-boolean-operations-of-2-manifolds-through-vertex.md) |
| Li, Yang, Jia 2026, SSI overview | survey (CAD 193) | new; full text unreachable | Elsevier | unreachable | coverage map from 135 references; special pairs "solved", near-critical, overlap and watertightness open (INFERRED) | [link](sources/li-yang-jia-2026-advances-and-challenges-in-surface-surface-.md) |
| QI (LORIA/Gamble) | C++ library + web server | dormant since 2007; code lost; server alive 2026-09-24 | proprietary non-commercial | learn-from | the DLLP implementation, about 3 ms per pair on CSG scenes; a live research-only oracle | [link](sources/qi-quadric-intersection-library-loria-gamble.md) |
| Wang, Goldman, Tu 2003 (+ Tu, Wang, Mourrain, Wang 2009) | papers (CAGD) | historical | Elsevier ©, author PDFs | learn-from | Levin on a ruled input surface; the root pattern of s(u) decides morphology; singular QSICs are rational; 35-type rational classifier | [link](sources/wang-goldman-tu-2003-enhancing-levin-s-method-for-computing-.md) |
| Piegl 1989, geometric natural-quadric SSI | paper (CAD 21(4)) | historical; full text not read | Elsevier, closed | unreachable | geometric case analysis for trimmed NURBS quadrics; non-planar curves traced and fitted (secondary) | [link](sources/piegl-1989-geometric-method-of-intersecting-natural-quadrics.md) |
| Caravantes, Diaz-Toca, Fioravanti, Gonzalez-Vega 2026 (+ Trocado 2019) | papers (CAGD, JCAM; arXiv) | new | arXiv; VoR CC BY-NC | learn-from | torus/quadric cutcurve of degree ≤ 8 + subresultant lift; singularity decision diagram; tangency only along parallel or meridian circles | [link](sources/tools-for-analyzing-the-intersection-curve-between-a-torus-a.md) |
| Hoffmann 1989 book (+ Hoffmann & Vaněček 1991 TR) | book + TR | historical | author-distributed | learn-from | decide each incidence once and post it; 5l + 5-bit exact plane predicates; a vertex at every singular point, with edge disambiguation | [link](sources/hoffmann-geometric-and-solid-modeling-1989-fundamental-techn.md) |
| Spatial blog, Boolean failures and the incremental Boolean | vendor blog | commercial (2017, rev. 2022) | ©, no code | learn-from | six failure causes; local prepare-and-retry with a no-progress stop | [link](sources/spatial-blog-what-to-do-when-your-3d-modeling-boolean-operat.md) |
| EXACUS (2005) + Dupont, Hemmer, Petitjean, Schömer 2007 | papers + library | dormant; CGAL descendants active (6,054★, pushed 2026-09-21) | CGAL parts LGPL-3.0+/commercial | learn-from | vertices as (component, exact parameter root) sorted along curves; modular → interval → exact number tiers | [link](sources/exacus-berberich-et-al-2005-and-dupont-hemmer-petitjean-sch-.md) |

---

## 3. State of the art: techniques, their real guarantees, where they break

### 3.1 The imprint-ordered driver (Jackson, OCCT, ACIS)

**Technique.** Lower-dimensional coincidences are decided first and posted
once. Face/face intersection only handles what is left. A merge takes the
larger tolerance (DOCUMENTED, Jackson sec. 4).

**Guarantee.** Combinatorial validity *relative to the tolerance regions*:
every component of an intersection of two tolerance regions contracts onto
shared topology. There is no geometric exactness (DOCUMENTED, sec. 3.2).

**Where it breaks** (DOCUMENTED):

- Tolerance growth has no bound (Jackson sec. 7.3).
- The edge tube is centred on an arbitrarily chosen p-curve, so the same
  edge can be valid or invalid depending on that choice.
- Face tolerances went unused, so near-tangent face pairs still reached the
  SSI.
- In OCCT, growth plus fuzzy gives "IsDone but wrong".

**For wonky** (INFERRED). corefine already decides the global topology. The
ordering principle still applies in two places:

- where recover decides curves and vertices, it should take facts from one
  decision each (P9);
- analytic carrier relations should be decided before any mesh-distance test
  (P1, P6).

### 3.2 Natural-quadric closed forms (Miller-Goldman, Shene-Johnstone, OCCT)

**Technique.**

- **Miller-Goldman Table 4** lists every configuration with a planar
  component. The intersecting-axis rows are exactly the existence of a
  common inscribed sphere; that is INFERRED in the MG note and proved as
  Shene-Johnstone Theorem 8.1. Examples:
  - cylinder/cylinder with intersecting axes and equal radii;
  - cylinder/cone with |I − V| = r/sin α;
  - cone/cone with d1 sin α1 = d2 sin α2.
- **Constructions.** They are transformation-free: pencil-derived plane
  normals, a common point Q, a law-of-cosines helper, and tangent rulings
  detected up front.
- **TangentBalls** covers plane/cone: ellipse, hyperbola, parabola, and a
  plane through the apex.
- **Theorems 3 and 4** characterise line + cubic.
- **Miller 1987** writes every non-planar QSIC as one quadratic per ruling.
  The critical t values are constructed geometrically.

All DOCUMENTED.

**Guarantee.** The case analysis is complete for planar components and for
line + cubic, with proofs. The authors state that one-point tangencies are
not characterised. Shene-Johnstone Theorem 7.1 and Corollary 7.1 fill that
gap for cone/cone and cylinder/cone, and the skew-axis distance r1 + r2 rule
fills it for cylinders (DOCUMENTED).

**Where it breaks** (INFERRED):

- **Tolerance-based equality tests are discontinuous** at the Table 4
  boundaries. Cylinders of radius 10 and 10.0000001 are "two ellipses" or "a
  quartic" depending on a threshold. Neither paper says what to return near
  a boundary. wonky's answer is a banded `Unresolved(Near*)`.
- **Double cones.** The mathematics describes double cones, so a half-cone
  restriction has to follow.
- **Printed errors** (DOCUMENTED/INFERRED in the SJ note):
  - Shene-Johnstone Corollary 7.1 case 5 has a d1/d2 typo.
  - Shao-Chen misquote SJ Lemma 4.2 as "iff".

**Speed.** 330 to 480 constructions per second on a 1993 SGI (~0.7 MFLOPS),
so O(1) and negligible today (DOCUMENTED).

### 3.3 Exact quadric pairs (DLLP, QI, Wang-Goldman-Tu, Tu 2009, Shao-Chen)

**Technique** (DOCUMENTED):

- **DLLP** takes a rational pencil member, reduces it by Gauss reduction
  (not eigenvectors), parameterises it bilinearly and solves a biquadratic.
  The result is X1 ± X2·√Δ with deg Δ = 4, plus at most one extra √δ.
- **DLLP Part II** classifies about 36 real types with rational arithmetic
  only. **Part III** gives polynomial parameterisations of singular types
  from the smallest-rank pencil member.
- **Wang-Goldman-Tu Theorem 12** reads the morphology (acnode, crunode,
  cusp, 0/1/2 components) off the root pattern of s(u).
- **Tu 2009** gives 35 non-degenerate pencil types with rational-only
  signature sequences.
- **Shao-Chen 2024** trims by univariate sign conditions:
  - Descartes root isolation;
  - Sturm-Habicht signs at the roots;
  - the sign of a + b√c from the signs of a, b, c and a² − b²c;
  - a certified endpoint error ‖P(a) − P(ã)‖ ≤ Mδ.

**Guarantee.** Exact type and topology, and exact carrier curves. Shao-Chen
adds endpoints within a user ε (DOCUMENTED claims; Shao-Chen has no
implementation).

**Where it breaks:**

- **Exact input is assumed.** A near-tangent pair gets an exact *generic*
  answer, a tiny smooth loop that a modeller would regularise (INFERRED from
  DLLP's no-tolerance design).
- **Coefficients grow.** Heights reach 22-38 times the input height. After
  Shao-Chen's squaring, the worst case is about 100 U32 limbs (INFERRED in
  the notes).
- **Shao-Chen trims only by half-spaces.** It covers neither coincident
  quadrics nor curved or holed face boundaries (DOCUMENTED).
- **ELM needs algebraic numbers.** Its exact form needs algebraic numbers of
  degree up to 4, and floating-point Levin gives wrong topology in
  degenerate cases (DOCUMENTED in DLLP Part I §1).

### 3.4 The generator chart: DLLP in wonky's own terms

This derivation was added by the note authors. It is not in the papers, but
it reproduces their structure (INFERRED, checked numerically; see the
[DLLP note](sources/dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md)
and the [WGT note](sources/wang-goldman-tu-2003-enhancing-levin-s-method-for-computing-.md)).

**Construction.**

- Use the input cylinder or cone itself as the ruled pencil member. It is
  rank 3, and wonky already stores its frame.
- For each generator at u = tan(φ/2), substituting into the other quadric
  gives α·w² + 2β(u)·w + γ(u) = 0.
- So each point costs one quadratic, and (1 + u²)²·Δ(u) is a quartic with
  exact coefficients for dyadic inputs.

**Morphology from the real roots of Δ:**

- Δ > 0 everywhere: two branches (the pipe tee, r = 1 into r = 2).
- 2 simple roots: one loop (an offset cross hole).
- 4 simple roots: two loops.
- A double root: a node (internal tangency).
- Δ a perfect square: the curve splits into rational pieces (Steinmetz:
  two ellipses).
- Parallel axes give α ≡ 0: generator lines.

**Checked cases.**

- For the offset cross hole, ŝ = F1·F2 reproduces two loops, one loop, two
  loops and a crunode at (0, r, 0) as r crosses ρ ± a (WGT note).
- The chart beats QI on the pipe tee: rational coefficients and only √Δ,
  where QI needed √14 and flagged NEAR-OPTIMAL (DOCUMENTED server output;
  INFERRED comparison).

**Where it breaks:**

- **Speed singularity.** |dp/du| is unbounded near simple roots of Δ, so
  chart points must cluster there, or the branch must be reparameterised by
  w (INFERRED).
- **Float sampling cannot decide multiplicities.** A 20,000-step float scan
  of Δ reported 4 spurious sign changes each for Steinmetz and for the
  internally tangent pair, where Δ only touches zero (DOCUMENTED,
  `tmp/research/dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz/cyl-generator-chart-check.mjs`).

### 3.5 Tori

**Technique.**

- **Circle catalogue** (Li-Zhang-Ye; Kim 2012 only by summary). Named
  exact configurations: profile circles (coaxial), meridian circles,
  Villarceau circles. For a sphere centred on the torus axis the result is
  profile circles (DOCUMENTED).
- **Generator chart.** For torus/cylinder and torus/cone, each generator
  gives a monic quartic; Li-Zhang-Ye solve it with Ferrari (DOCUMENTED).
- **Pre-image topology** (Liu 2011). Boundary, turning and singular points
  split F(u, v) = 0 into one-valued segments. The error factor 1.22 is
  empirical (DOCUMENTED).
- **Cutcurve and lift** (Caravantes et al. 2026).
  - Res_z(T, Q) has degree ≤ 8, and the lift is z = −sres1,0/sres1.
  - A singularity diagram decides the special points.
  - Theorem 3.17: tangency along a whole curve happens only on parallel or
    meridian circles.
  - The paper excludes planes and c = 0 quadrics, which includes a cylinder
    parallel to the torus axis (DOCUMENTED).
- **Meridian-plane chart for torus/sphere and plane/torus** (INFERRED,
  derived by the note author).
  - On a ring torus every point lies on the meridian circle of its own
    azimuth, so each θ is a circle/circle or circle/line problem with one
    square root.
  - The topology follows from the signs of a concave quadratic in cos θ.
  - Checked on 320,000 random samples; residuals ≤ 3e-14.
- **Vertical-hole closed form** (INFERRED, derived in the torus-quadric
  note): z = ±√(r² − (ρ(θ) − R)²). Its events come from comparing d ± ρc
  with R ± r.

**Guarantee.** No torus pair outside the circle cases has a certified,
implemented method in these sources. Liu's precision factor is empirical,
and Li-Zhang-Ye connect branches heuristically on a Δθ lattice (DOCUMENTED).

**Where it breaks.**

- Horn and spindle tori break the meridian argument (INFERRED).
- Float Ferrari has error of order √ε near double roots (INFERRED).
- The meridian derivations need a CAS re-check before porting (stated in
  the note).

### 3.6 Procedural intersection curves (Parasolid XT, Truck)

**Technique.**

- The curve is defined *exactly* as the locus of two surfaces. The chart of
  hvecs (point, uv on both surfaces, tangent n0 × n1) is a seed.
- Interior evaluation is a 3x3 Newton on {surface 0, surface 1, the plane
  orthogonal to the chord at the chord point}.
- The V35 f_i recurrence makes the parameterisation C1. The 2006 edition's
  wording gives only C0.
- Terminators (tangencies, degenerate surfaces) may only be curve ends. Near
  them, evaluation uses one surface plus two planes.

All DOCUMENTED.

**Truck** has the interior evaluator with an index parameterisation. It has
no uv cache and no terminators, and it `unwrap`s the matrix inverse, which
panics at tangency (DOCUMENTED).

**Guarantee.** Exact by definition. But the chart's `chordal_error` is "an
estimate" and "may be null", so it is not a certificate (DOCUMENTED, V35
p. 45).

**Where it breaks.**

- The format says nothing about how charts are built: no marcher and no
  branch finding (DOCUMENTED).
- A consumer needing a bound must derive its own, for example the sagitta
  bound κmax·C²/8 (INFERRED).

### 3.7 Hybrid mesh/B-rep Booleans (Yang 2025)

**Proven** (DOCUMENTED):

- the surface-to-mesh bound (Theorems A.1 and A.2);
- the normal-cone bound (Theorem 4.1);
- the proximity condition: a true intersection implies triangle distance
  < 2dε.

**Claimed, not proven:** termination of the discretisation and of local
refinement, and watertight, topologically correct output.

**Stated boundary.** "We can only guarantee the correctness of Boolean
operations when there are no small loops whose size and distance are both
smaller than the mesh resolution." Only one seed is created per
non-crossing triangle pair (DOCUMENTED, sec. 6).

**Where it breaks** (DOCUMENTED):

- Output curves are polylines fitted in (u, v), so exactness is lost.
- The coplanar branch handles planes only.
- There is no resolution cap and no typed failure.
- Multi-body common points are not handled.

**wonky's measured counterpart** (DOCUMENTED, plan §2.3). Near a tangency, a
mesh Boolean "can drop or invent topology below the deviation". The judge
reproduced 9 such cases, in which corefine, exact-plane and manifold3d
*agree with each other* and are all wrong. Hence the pre-certificate.

### 3.8 Classification of "on" cases (Mäntylä, and the curved extension)

**Technique** (DOCUMENTED).

- Eight-way boundary classification, with equation (5):
  - b(A∪B) = AoutB & BoutA & AonB+
  - b(A∩B) = AinB & BinA & AonB+
  - b(A\B) = AoutB & (BinA)⁻¹ & AonB−
- The vertex/vertex sector test is int = n1 × n2, followed by inclusion by
  cross products.
- Tables II and III give asymmetric rules, so that exactly one copy of an
  overlap survives.

**Guarantee.** Topological completeness, assuming consistent predicates
(DOCUMENTED). The author states it does not extend to curved faces.

**Curved extension** (INFERRED, worked by hand in the Mäntylä note).

- At a tangent vertex, n1 × n2 = 0 does not mean "coplanar". Use instead the
  sign structure of H = IIA − IIB, the difference of the two second
  fundamental forms:

  | H | meaning |
  |---|---|
  | definite | isolated contact |
  | indefinite | a node, with branch tangents where vᵀHv = 0 |
  | singular | higher-order contact: refuse or decide by the pencil |
  | zero | an overlap candidate |

- It reproduces QI's answers on three cylinder contacts:

  | case | H | QI's answer |
  |---|---|---|
  | Steinmetz | indefinite | secant conics |
  | internal tangency | indefinite | nodal quartic |
  | external skew tangency | definite | a point |

### 3.9 Summary

| technique | real guarantee | breaks at | wonky today |
|---|---|---|---|
| imprint ordering + local tolerances | validity w.r.t. tolerance regions | unbounded growth; near-tangent F-F if not skipped | corefine decides topology; recover's pre-certificate refuses undecided near contacts |
| Miller-Goldman / Shene-Johnstone tables | complete for conics and line + cubic; exact if predicates are exact | discontinuity near boundaries; one-point tangency (SJ fills) | plane/plane and plane/cylinder in production; coaxial pairs in recover |
| DLLP / WGT / Tu / Shao-Chen | exact type, topology and curve; certified endpoints | exact input assumed; heights; half-space trims only; no code | refused ("space quartic") |
| generator chart (derived) | exact morphology from Δ; exact per-point evaluation | speed singularity near simple roots; float sampling unusable for decisions | none |
| torus catalogues and cutcurves | exact for named circle cases; exact event theory | no general implementation; c = 0 and planes excluded | ⊥ and through-axis plane, coaxial cylinder only |
| XT procedural curve | exact by definition | chart error only estimated; the marcher is unspecified | none |
| hybrid mesh Boolean | certified meshes; no false-negative candidates | small loops below resolution; fitted output curves | corefine + recover, exact curves, named refusals |
| Mäntylä ON policy | complete, given consistent predicates | curved tangency (needs second order) | carrier classes, point and line contact refused |

---

## 4. War stories and anti-patterns

### 4.1 War stories (DOCUMENTED unless marked)

- **Near-tangent SSI is the recurring killer.**
  - Jackson avoids it by ordering.
  - Miller-Goldman insist on detecting the tangent ruling *before* building
    the section planes. Otherwise the cylinder/cone section comes out as two
    close lines, a thin ellipse, or nothing (GMIP sec. 5.1.2).
  - Truck's crate doc says tangent faces are unsupported.
  - SolveSpace #1268 is the cube-plus-tangent-cylinder case.
- **Truck's open issues are the negative specification:**
  - #57: two cubes touching on a face return `None`.
  - #114: a shared partial face, edge or vertex returns `None`. A
    downstream user works around it with "catch_unwind + De Morgan fallback
    + perturbation retry".
  - #129: the STEP export of an `INTERSECTION_CURVE` wrote surface1 at
    surface0's index. "A plate with one bore comes out with 30 of its 488
    entities defined twice."
  - The only Boolean test, `punched_cube`, has no assertion.
- **An LLM-authored fix.** Truck PR #110 ("done by Gemini+Claude") accepts
  Newton's initial guess when points coincide with parallel normals, and
  drops tiny loops. It has been open without maintainer review since early
  2026.
- **Perturbation loops.** rGWB scales solid B by 1 + k·1e-4, up to 10
  times, on `IMPROPER_INTERSECTIONS`; its own README admits it "could
  produce an incorrect output". ESOLID's input perturbation is commented
  out.
- **Printed tables and stubs you must not trust.**
  - Mäntylä's Table I "\" row contradicts his own equation (5) and the GWB
    code.
  - GWB's `sectoroverlap()` is a stub that returns 1.
  - rGWB forces asymmetric ON classifications to be symmetric
    ("impossible classifications due to precision errors").
- **Edition drift.** The 2006 XT reference describes chart evaluation as
  "project onto the tangent line". The V35 chord-plane definition with f_i
  normalisation is the correct one, and a port from the old mirror would be
  subtly C0.
- **Algebra blow-ups.**
  - One exact Levin output "fills up over 100 megabytes" in Maple, and
    floating-point Levin gives wrong topology in degenerate cases.
  - QI's observed output heights (36) differ from the predicted ones (38),
    and the authors cannot explain it.
  - DHPS's matching (Algorithm 4) is its "main source of efficiency" and its
    "Achilles' heel": an unverifiable precondition, with silent mismatch or
    non-termination when it fails.
- **Lost code.** QI's source is gone: INRIA gforge is down and the Wayback
  Machine and Software Heritage have no copy. It depended on LiDIA, which
  "may not work at all on 64 bits". EXACUS's QuadriX was never public. Only
  QI's web server survives.
- **Vendor statistics need a careful read.** Spatial's "70% of failed
  Boolean operations successfully corrected ... required only a single
  iteration" is 70 % *of the corrected cases*, with no dataset.
- **wonky's own, from the judge rounds** (plan §7):
  - corefine returned 18 wrong `ok` answers on 216 adversarial cases, for
    example point contacts and rotated coplanar self-intersections.
  - recover's sliver absorption deleted real faces, with a volume error up
    to 2.7e-4, labelled exact.
  - A unification tolerance of 2^-40·scale merged a real 1e-11 mm skin over
    a sealed void. It is now 2^-44.
  - A grazing plane whose crossings a third operand removed came back as an
    exact plain cylinder.
- **Oracles are wrong too.** OCCT's exact CSG is off by 1.3e-6 relative on
  `adv-ep2-rot-sphere-minus-cone`, and its fuzzy 1e-7 mm merges a 1e-9 mm
  gap that is really two solids. That is why wonky has an arbiter
  (plan §7).

### 4.2 Anti-patterns (INFERRED from the war stories)

| anti-pattern | seen in | wonky counterpart |
|---|---|---|
| perturb-and-retry that changes geometry silently | rGWB, a Truck downstream fork, OCCT fuzzy | forbidden; an opt-in, logged prepare step at most (Spatial's fixpoint rule plus 2-cycle detection) |
| one global absolute tolerance used for welding (grid quantisation) | Truck `TOLERANCE = 1e-6`, `PointIndex` | exact vertex ids, per-pair bands, exact predicates |
| ray parity against a tessellation | Truck | winding numbers on the exact result; recover's clearance certificate |
| side label from the midpoint normal triple (n0 × c')·n1 near tangency | Truck | refuse inside a band (`AmbiguousContact`) |
| accepting a curve fit on one random sample per span | Truck | certified bounds (sagitta, Shao-Chen Mδ) |
| `unwrap` / panic in evaluators | Truck | typed `Unresolved` |
| recomputing a known contact in a later stage | Jackson, MG §4.7, Hoffmann §3.4.1 | P9 provenance; recover takes the curve from carriers, never from a polyline |
| snapping a near-special configuration to the special case | implicit in MG and SJ; OCCT `RefineDir` | banded `Unresolved(Near*)` |
| Δθ lattice sampling plus heuristic root matching for topology | Li-Zhang-Ye | exact event points (Δ roots, characteristic points) |
| float Ferrari or float root scans for multiplicity decisions | Li-Zhang-Ye; the check script's spurious sign changes | exact square-free/gcd/Sturm on U32 limbs |
| fitted polyline or B-spline as the stored exact curve | Yang 2025, Piegl, Truck | exact internal form; a B-spline only at export, with a stated bound |

---

## 5. What wonky should take: ranked proposals

**Ranking rule.** First, foundations that later proposals depend on. Then
closures of the named Unresolved set in plan step 9's FDM-value order: hex
nut, cylinder quartics, tori. Then generality. Proposals P1, P3, P4 and P5
close all four corpus refusals. P2 is ranked high because the QI server can
vanish at any time.

**Relation to the bake-off.** The bake-off decided the *topology* engine
(corefine), and every proposal plugs into that decided pipeline. Most work
at the recover stage `[E]` or the pre-certificate `[C]`
([../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §2). exact-plane
stays the differential oracle. Yang 2025's benchmark protocol (10k random
rotated pairs × 4 operations, a slow-case CDF against OCCT) is worth adding
to the judge harness.

### P1. One carrier-pair relation table with banded, typed outcomes, plus hyperbola and parabola

**Idea.** One Bend module maps (surface, surface, tolerance) to one of:

- `Resolved{relation, curves, contacts}`;
- `Unresolved{Near*, measured, band}`;
- `Rejected`.

It serves production and recover alike. Contents, in porting order:

1. Plane × {cone, sphere, torus ⊥/∥} from TangentBalls and the recover
   table. Plane/cone gets the unified ellipse/hyperbola construction, the
   parabola and the plane through the apex.
2. Miller-Goldman Table 4 conic rows with the Part II constructions. That
   includes the intersecting-axis cylinder/cone and cone/cone cases OCCT
   lacks.
3. Theorems 3 and 4 (line + cubic), as a named relation.
4. Shene-Johnstone's `TangentPoint` and `Disjoint` tests (Theorem 7.1,
   Corollary 7.1 with the typo fixed, and the cylinder skew rule).
5. The coaxial rows.

Two further parts:

- Add `Hyperbola` and `Parabola` to `analytic.Curve`. STEP has entities for
  both.
- Store cone slopes as exact words (tan α, or cos/sin as XT does). Then
  every relation test is polynomial in the stored words and can escalate to
  multi-limb U32.

Every refusal carries a typed code with the tags, the measured quantity and
the band. These replace the 26 `CvNo` strings and the hard-coded 1e-12,
1e-9 and 1e-10 thresholds.

**Where it plugs in.**

- `kernel/intersections.bend`, which today has plane/plane and plane/cylinder
  only.
- The pair dispatch in `kernel/hybrid/recover/geom.bend` (lines ~311-520).
- The body format and `src/exporters.mjs`: conic edges on cones, with
  pcurves.
- Plan step 9, item 1.

**Bend fit.** O(1) pure functions on small records, with no iteration.
Fork-join over pairs sorted by type. Equality tests are degree ≤ 3-6
polynomials, exact on a few U32 limbs for dyadic F32x2 inputs.

**Expected benefit.**

- Closes the plane/cone refusals: hyperbola, parabola, oblique ellipse. That
  is half of `hex-nut`, plus countersinks cut by tilted planes.
- Gives more exact conics than OCCT's analytic layer.
- One source of truth for both paths.
- Errors an LLM can act on. Example: `NearTangentCarriers(tag 3 plane,
  tag 9 cylinder, gap 2e-7 mm, band 1e-6)`.

**Risks.**

- Band placement near the Table 4 boundaries.
- Half-cone nappe filtering.
- Readers must accept STEP HYPERBOLA/PARABOLA edges on CONICAL_SURFACE.
  That is not yet verified (open question 3).

**First acceptance test.**

1. A property test over 10,000 random coplanar-axis cylinder/cone pairs
   from dyadic inputs. Miller-Goldman's classifier and Shene-Johnstone's
   axial-plane height test agree, or both return `Unresolved`.
2. A new corpus case, "hex prism minus a chamfer cone" with the cone
   *smaller* than the inscribed circle, so there is no tangency. It comes
   out exact through `src/exporters.mjs`, passes strict
   `uv run scripts/validate-step.py`, and matches the arbiter's volume
   within 1e-7.
3. Every old refusal keeps its meaning, now as a typed code, and every old
   exact output stays byte-identical.

### P2. Harvest the external oracles now

**Idea.** Build a test-infrastructure script (JS or `uv run`, never
production). It posts a canonical, typed set of cylinder, cone and sphere
pairs to the QI server (`POST https://gamble.loria.fr/qi/server/qi.php`,
fields `q1`, `q2`, `noise=0`, `launch=Launch`). Politely: one request at a
time.

- Store per pair: real type, component count, singular points and whether
  it is rational. Archive the raw responses under `tmp/research/qi/`.
- Aim for all real types reachable with those surfaces, including:
  - Steinmetz;
  - internal and external tangency;
  - parallel touching;
  - coaxial cylinder/cone;
  - Viviani;
  - pipe tee;
  - offset cross holes on both sides of r = ρ ± a;
  - countersink/bore;
  - common-apex cones.

Add the published exact fixtures:

- Wang-Goldman-Tu 2003 Examples 1 and 2 (dyadic);
- Shao-Chen Examples 4.1-4.3;
- Caravantes et al. §5, 14 torus/quadric examples;
- Trocado 2019 Annex, 50 quadric pairs;
- Truck #57, #114 and #129 as B-rep regressions;
- Hoffmann §4.2's incidence-asymmetry examples, for tolerance code paths;
- one stress fixture per cause in Spatial's list of six.

**Where it plugs in.** `fixtures/bakeoff/adversarial-*.json` and a new
`fixtures/ssi/` for pairwise facts. The step-3 arbiter uses them as third
references.

**Bend fit.** Not applicable (fixtures). The Bend tests consume them.

**Expected benefit.** Ground truth for P1, P3, P5 and P7 before any code is
written. It also secures a resource whose code is already lost.

**Risks.**

- The QI licence is non-commercial. Store facts (types, counts, points), not
  formulas, and have Marc confirm before any fixture is distributed.
- The server's logging error message is harmless (DOCUMENTED).

**First acceptance test.** `fixtures/ssi/qi-oracle.json` holds at least 40
pairs, each with its raw response archived and its sha256 recorded. A
pending test compares them against wonky's classifier; it activates when P1
and P5 land.

### P3. Two-carrier singular vertices from the pencil (closes Steinmetz)

**Idea.** recover builds every corner as the Newton intersection of three
carriers. The Steinmetz corners lie on only two: they are singular points of
the QSIC, where both surfaces are tangent. When a corner has only two
carrier classes:

1. Form the pencil λA + B from the two implicit forms.
2. Find a rational root λ0 whose member has rank 2, i.e. a plane pair
   (Wang-Goldman-Tu ELM step 1).
3. Split the curve into the two plane/quadric conics. Recover already has
   `Ellipse`.
4. Take the vertices as Sing(λ0·A + B) ∩ A, using the rank rule of
   Shao-Chen Proposition 3.4 (WGT Theorem 8 in general).
5. Give each of the four edges through a vertex Hoffmann §5.7
   disambiguation data (an interior point, or end tangents). Each ellipse
   passes through both vertices.

Add a vertex constructor `SingularPoint{carrier pair, pencil root}` beside
the three-carrier corner.

**Where it plugs in.** recover's corners (step 6) and its cylinder/cylinder
dispatch; plan step 9 item 2, the Steinmetz half. The same constructor
later yields the node of an internally tangent cylinder pair, a rational
nodal quartic.

**Bend fit.** 4x4 integer matrices from dyadic inputs, the quartic
det(λA + B), a rational-root and rank test on multi-limb U32. It is per
pair, tiny, and fork-join.

**Expected benefit.** `steinmetz-intersect` and `steinmetz-union` become
exact with no new curve type. The worked example: x² + y² = 1 against
x² + z² = 1 gives det = λ(λ − 1)², λ0 = 1, the member y² − z², and corners
(±1, 0, 0). All steps are rational (INFERRED, hand computation in the
Shao-Chen and DLLP notes).

**Risks.**

- It works only when λ0 is rational. That holds for equal radii with dyadic
  inputs; otherwise refuse by name.
- The carrier must have *one* definition: implicit form or renormalised
  F32x2 frame. The difference must be reported as a stated deviation (WGT
  note caveat).

**First acceptance test.**

- `steinmetz-intersect` comes out exact through the kernel exporter, passes
  strict `validate-step.py`, and matches the closed-form volume 16r³/3
  within 1e-12 relative. (The formula is the standard Steinmetz bicylinder;
  INFERRED as an oracle.)
- `steinmetz-union` is exact against the arbiter.
- The recovered corners equal the exact singular points; their exact
  residual is 0.

### P4. Tangent vertices by second fundamental forms, plus the corrected Mäntylä ON rule (closes hex-nut with P1)

**Idea.** Some corners have a three-carrier |det| < 1e-6, and recover
refuses them today as "degenerate tangent vertex". Handle them in three
steps:

1. **Get the contact point** from the relation that makes it tangent. For
   the hex nut, P1's plane/cone relation gives the hyperbola's vertex on
   the flat. The top-plane circle is tangent to the flat's line exactly
   there, so the contact point is the foot point of the cone axis on the
   flat plane, at the top-plane height (INFERRED from the case geometry;
   verify on the fixture).
2. **Classify the local sectors** by H = IIA − IIB. For analytic carriers
   the second fundamental forms are closed-form: 0 for a plane, 1/r along
   the circle direction for a cylinder, and so on.
3. **Resolve overlapping sectors** with Mäntylä's equation (5) as a pure
   function `onRule(op, sameNormal, side)`. Use the corrected "\" row
   (AonB+ → AinB, AonB− → AoutB).

The branch tangents come from vᵀHv = 0. The edges come from P1's curves.

**Where it plugs in.**

- recover step 6 (corners) and step 7 (loops at what is now refused as a
  pinch).
- The exact-plane oracle's coplanar handling, for the corrected ON rule.
- Plan step 9 item 1 (the tangent vertex).

**Bend fit.** A 2x2 determinant and a trace sign per vertex. Exact on U32
limbs when the contact point is exact; otherwise an interval evaluation in
F32x2 that refuses on an undecided sign. The work is independent per vertex
but not uniform, so CPU fork-join.

**Expected benefit.**

- With P1, `hex-nut` becomes exact. It is the corpus's mechanical FDM case:
  a hex prism minus a bore, intersected with a chamfer cone.
- Line-contact refusals such as `cylinder-tangent-box-face` get a precise
  name: tangent line, H with one zero direction.

**Risks.**

- Higher-order contact (H singular) must refuse.
- A contact point that is irrational forces the interval path.
- Fillet tangency chains are contact along a whole curve. H = 0 in one
  direction there, so they need their own rule (open question 12).

**First acceptance test.**

- `hex-nut` exact end to end: strict `validate-step.py` through
  `src/exporters.mjs`, and volume within 1e-7 of the arbiter.
- Unit fixtures: the three QI cylinder contacts classify as indefinite,
  indefinite and definite.
- An ON-rule unit test: a unit box A minus a box B sitting on A's top face
  keeps A's top face.

### P5. An exact ruled-quadric section curve (closes pipe-tee, cross holes, off-axis sphere/cylinder)

**Idea.** Add a curve variant, for example
`RuledQuadricSection{ruled: cylinder | cone, other: quadric, sign: ±1,
u0, u1}`.

- **Evaluation.** One quadratic per generator (Miller 1987; the generator
  chart of §3.4), in F32x2, with the residual against both implicit forms
  returned.
- **Morphology is decided exactly** before any curve is built:
  - Δ(u) square-free part, gcd(Δ, Δ′) and a Sturm count on multi-limb U32;
  - the reading by Wang-Goldman-Tu Theorem 12;
  - perfect-square Δ (Steinmetz-like splits) routed to P3.
- **Endpoints** are roots of a third carrier substituted into the branch.
  That is a sign condition on a + b√Δ; use Shao-Chen's isolation plus
  Lemma 3.8. The certified interval bound ‖P(a) − P(ã)‖ ≤ Mδ (§3.4.4) goes
  into provenance.
- **Near simple roots of Δ**, switch to the generator coordinate w as the
  parameter.
- **STEP export** writes a certified B-spline with pcurves as the
  SURFACE_CURVE geometry, with its deviation in provenance. The exact form
  stays internal for diffs, queries and re-evaluation.

**Where it plugs in.**

- `analytic.Curve` and the body format.
- recover's cylinder/cylinder, cylinder/cone, cone/cone, sphere/cylinder and
  sphere/cone refusals ("space quartic").
- Later `kernel/intersections.bend`.
- Plan step 9 item 2. It refines the plan's "B-spline with a stated bound"
  into "exact internally, bounded B-spline at export".

**Bend fit.** The exact stage is small, branchy scalar work per pair (CPU
fork-join). The DLLP note estimates about 7 limbs for matrix entries and
about 25 for D; Δ from the input chart is smaller (INFERRED). Evaluation is
uniform per sample and serves the tessellator, the pcurve sampler and the
certified print mesh.

**Expected benefit.**

- Covers the most common non-planar FDM intersections: cross-drilled holes,
  pipe tees, bores through balls, countersinks crossed by bores.
- The exact carrier curve means chained operations never drift, and edge
  identity is stable.

**Risks.**

- The bigint budget on real inputs (open question 1).
- The speed singularity at branch points.
- Certifying the exported B-spline costs work.
- The exporter's cylinder pcurve planner is already fragile at large
  coordinates (plan step 9).

**First acceptance test.**

- `pipe-tee` and `x-rod-cross-hole` are recovered exactly internally. Every
  curve sample is within 1e-12 mm of both implicit forms.
- Component count and singular points match the P2 QI fixtures for every
  cylinder/cylinder probe, including internal tangency (a node) and
  r = ρ + a (a crunode).
- STEP export passes strict `validate-step.py` with a stated B-spline
  deviation ≤ 1e-6 mm, and the volume is within 1e-7 of the arbiter.
- A regression test feeds the Steinmetz and internal-tangency Δ from the
  check script and asserts the exact double roots, where the float scan
  gave spurious sign changes.

### P6. Decide near contacts from the carriers, and refine locally with a cap

**Idea.** recover's pre-certificate (`tangent.bend`) refuses every carrier
pair from different leaves that comes within h + h' without a decided
crossing. That is correct, but it also refuses real FDM geometry: a boss
that pokes 0.005 mm through a face, a bore 0.005 mm from a face, 1 µm
features. For each flagged pair, ask P1 for the exact relation:

- **Disjoint**, with certified clearance c: the pair passes if c exceeds
  the rounding band. The mesh cannot have invented a crossing.
- **Transversal**, with crossing depth or width d < h + h': re-tessellate
  the two leaves at deviation < d/4 and rerun the job. Cap it at 3
  halvings or a triangle budget; otherwise refuse by name, carrying d.
  This is Yang 2025's local refinement, their Table 3 "resolution
  increases", made explicit and capped.
- **Tangent**: keep today's refusal, now naming the exact tangency (point,
  line or circle).
- **Declared tangency.** The decision log allows declared tangency for
  candidate B ([../entscheidungen.md](../entscheidungen.md) item 8). When
  construction declares a tangency, it can replace the numeric test.

**Where it plugs in.**

- `kernel/hybrid/recover/tangent.bend`.
- The hybrid driver's job generation (`printMesh` deviation per leaf).
- Plan step 11's work budget, which is needed anyway: the near-coincident
  sphere case spends seconds before refusing.

**Bend fit.** The relation test is O(1). Re-tessellation is fork-join. The
retry is a short sequential driver with a hard cap and a typed failure.

**Expected benefit.** Turns part of the roughly ten "tolerance-level
topology" refusals, and `x-thin-wall`, into exact results. True tangency
stays an honest refusal.

**Risks.**

- Triangle counts grow 4x per halving.
- Local-only refinement breaks leaf watertightness for corefine, so start
  with whole-leaf refinement.
- Contacts below F32x2 rounding must still refuse.

**First acceptance test.**

- `x-thin-wall` (a bore 0.005 mm from a face) and the "boss pokes 0.005"
  case come out exact, with volume within 1e-7 of the arbiter.
- `cylinder-tangent-box-face` stays an expected refusal, now naming
  `TangentGenerator`.
- Corpus outputs are byte-identical, since refinement triggers only on
  flagged pairs.

### P7. Torus sections: circle catalogue, meridian-plane chart, vertical-hole form

**Idea.**

- **Exact named circle cases** as polynomial identities on unnormalised
  axes, for example R0²(A0·A1)² = (R0² − r0²)|A0|²|A1|²:
  - torus/sphere with the centre on the axis: profile circles. This pair is
    missing from recover's table.
  - torus/cylinder and torus/cone: meridian and Villarceau circles.
  - torus/torus: minor/minor and minor/profile circle coincidences (Liu
    2011).
- **Plane/torus spiric sections and torus/sphere** use the meridian-plane
  chart: topology from the signs of K(±1), the vertex and the discriminant
  of a quadratic in cos θ, and one square root per θ.
- **Torus/cylinder with parallel axes** (a vertical hole through a fillet
  ring) uses z = ±√(r² − (ρ(θ) − R)²). Its events come from comparing
  d ± ρc with R ± r.
- **Everything else** (oblique torus/cylinder, torus/cone, torus/torus) is
  refused by name until P8.
- **Theorem 3.17 of Caravantes et al.** serves as a snap rule and
  assertion: tangency along a curve is always a parallel or meridian circle.

**Where it plugs in.** `plane_torus` and `torus_cyl` in `geom.bend`; the
missing torus/sphere, torus/cone and torus/torus arms; the fillet track
(torus patches at hole and boss rims,
[../entscheidungen.md](../entscheidungen.md) item 2).

**Bend fit.** Identities of degree ≤ 6 are exact on about 10 limbs. Chart
evaluation is uniform. Topology is a constant number of exact sign tests
per pair (INFERRED in the Li-Zhang-Ye note).

**Expected benefit.** Booleans *after* fillets. A filleted boss or hole rim
cut by a plane, a bore or a sphere is the common case once fillets ship.
Also closes `x-torus-tilted`.

**Risks.**

- The meridian-chart algebra has only been checked numerically; a CAS
  re-derivation is required first.
- Horn and spindle tori are excluded.
- Villarceau circles are traced as ordinary components unless a separate
  exact test fires.

**First acceptance test.**

- A CAS check of K(c) and Kp(c).
- `x-torus-tilted` exact internally: every sample within 1e-12 mm of both
  implicit forms, and a STEP B-spline export with a stated bound.
- A new fixture, "fillet ring with a vertical bore", comes out exact.
- Component counts for the in-scope Caravantes et al. §5 examples.

### P8. A procedural intersection curve (XT chart with terminators) as the general fallback

**Idea.** `ChartCurve{s0, s1, chart: [ChartPt], t0, f0, start: Limit, end:
Limit, chord_bound, angle_bound}`:

- `ChartPt` carries the point, uv on both surfaces, the tangent and t.
- The V35 f_i recurrence gives the C1 parameterisation.
- Interior evaluation is a 3x3 Newton on the implicit forms plus the chord
  plane, with an iteration cap and the residual returned.
- Terminators use the one-surface-plus-two-planes evaluator.
- The chord bound is *certified* (sagitta ≤ κmax·C²/8). XT's is only an
  estimate.

Chart seeding and refinement:

- Seed from corefine's tagged edge run, since the mesh already fixed the
  branch topology.
- Refine with Yang 2025's acceptance rule: arc height < 100·dp,
  chord < 1000·dp, turn < 10°.
- Place terminators at the event points from P4, P5 and P7, never by
  marching through a tangency.

**Where it plugs in.** `analytic.Curve`; recover for pairs with no closed
form (oblique torus/cylinder, torus/cone, torus/torus); later fillet spines.
XT BLENDED_EDGE's spine is itself an INTERSECTION of offset surfaces, and
Truck's `RbfSurface` is its Apache-2.0 open analogue.

**Bend fit.** The chart is an immutable array of F32x2 words, about 14 per
point. Evaluation is a fixed-size Newton, which is uniform work. Chart
construction is fork-join per branch.

**Expected benefit.** Closes the rest of the "curve type missing" class
without a spline fitter, and prepares the ground for fillet surfaces.

**Risks.**

- Certifying the chord bound needs curvature bounds per pair.
- An unflagged tangency inside a segment breaks Newton, so event points
  must be complete.
- STEP still needs a B-spline at export.

**First acceptance test.** On `pipe-tee`, a chart seeded from the corefine
mesh evaluates within 1e-12 mm of the P5 exact form at 10,000 parameters,
and its certified chord bound is at least the true maximum deviation. After
that, an oblique torus/cylinder fixture comes out exact internally.

### P9. Decide once: corefine → recover provenance for new edges and vertices

**Idea.** corefine emits, per new edge, its (P face, Q face) tag pair, and
per new vertex its carrier triple, or a pair plus a singular flag. recover
then takes curve assignments and vertex constructors from these records.
Today it re-derives them from patch adjacency.

This is Hoffmann's "avoid asking the same geometric question more than
once", Jackson's "F-F skips known contacts" and Miller-Goldman §4.7, applied
across the two engines.

**Where it plugs in.** Plan §2.2's "gap" and the last item of plan step 9:
an optional provenance section in the bake-off wire format.

**Bend fit.** The records ride inline with the triangle soup. recover's
maps stay pure.

**Expected benefit.**

- Removes the sliver-absorption heuristic, which is where recover deleted
  real faces. The slivers come from differently tessellated coincident
  curves.
- Gives identity and diffs a direct cause for every edge.

**Risks.** Symbolic perturbation can attribute a vertex to a degenerate
triple, as at the Steinmetz corners. recover must verify provenance, not
trust it.

**First acceptance test.** With provenance on, recover's sliver count on
the corpus is 0, the exact outputs are byte-identical, and the adv-recover
suite stays at 0 wrong.

---

## 6. Open questions worth a prototype

1. **Bit budget of exact morphology on real parts.**
   - Question: how many U32 limbs do Δ(u), its gcd and its Sturm sequence
     need for F32x2 inputs like 0.1 mm or 12.7 mm, which are not dyadic?
   - Question: does an interval-F32x2 first pass decide ≥ 99 % of signs?
   - Prototype: the P5 exact stage over the corpus and the P2 fixtures,
     logging limbs and fallback rate.
2. **Can the analytic morphology certify that the mesh saw every loop?**
   Yang 2025 cannot guarantee small loops below the mesh resolution.
   - Prototype: sweep offset cross holes through r = ρ + a ± ε. Compare
     Theorem 12's component count *after* trimming with corefine's loop
     count, and refuse on disagreement.
   - Caveat (WGT note): the counts are for infinite surfaces, so compare
     only after trimming.
3. **Do STEP readers accept HYPERBOLA and PARABOLA edges on CONICAL_SURFACE
   with wonky's pcurves?** Prototype: export the P1 hex-prism fixture and
   run strict `validate-step.py` (OCCT) plus one more reader.
4. **Chart or closed form for oblique torus pairs?** The candidates are
   Li-Zhang-Ye's quartic per generator and the XT chart. Question: which is
   cheaper to certify end to end (event points plus a chord bound)?
5. **Is the meridian-plane chart correct in general?** It needs a CAS proof
   and a Villarceau detection rule before P7.
6. **Whole-leaf or local refinement in P6.** Does corefine need uniform leaf
   refinement to stay watertight? What is the runtime cost on the
   adversarial "tolerance-level" set?
7. **A fixed exact-predicate grid** in the manner of Hoffmann's 5l + 5 bits.
   The bake-off's exact-plane quantised to 2^-24 mm and thereby changed
   topology below the grid: it sealed pockets and closed gaps (plan §1).
   Probably not for production. Possibly for fixed-size GPU oracle
   kernels.
8. **Jackson-style per-entity tolerances for imported STEP** (sewing =
   Boolean without F-F/E-F). When does imported data meet the hybrid, and
   does wonky need tolerant edges then?
9. **The Li-Yang-Jia 2026 survey.** Get the PDF through Marc or a library,
   and check the inferred solved/open split. Kim 2012 (torus/torus circles)
   and Kim/Kim/Oh 1998 likewise.
10. **Licences of test-only oracles.** Does Marc accept QI-derived facts and
    LGPL CGAL tools as offline oracles (never in production)?
11. **Where do Steinmetz-like reducible pencils end?** How often do FDM
    models produce pencils whose plane-pair root λ0 is irrational (unequal
    radii on intersecting axes with a common inscribed sphere)?
    Prototype: scan the r20 and khana corpora for quadric pairs and
    classify them.
12. **Tangency along a curve after fillets.** A fillet torus meets its plane
    and cylinder tangentially along whole circles (G1). This is H = 0 in
    one direction, P4's "singular" row. OCCT's #1496 (a cylinder-torus-
    cylinder G1 junction giving a wrong Common with IsDone true) shows the
    risk.
    - Prototype: a box with a filleted hole rim, minus a bar crossing the
      fillet.
    - Decide whether Theorem 3.17 of Caravantes et al. (only parallel or
      meridian circles) together with an exact circle-coincidence test is
      enough.

---

## 7. Catalog of the remaining sources

### 7.1 Catalog-only sources from the scout (not deep-read)

| name | kind | year | status | one line | URL | priority |
|---|---|---|---|---|---|---|
| Yang, Jia, Yan, "Topology Guaranteed B-Spline Surface/Surface Intersection" (TOG 42(6)) | paper | 2023 (follow-ups 2025-26) | new | implicitise one patch by a Dixon resultant, substitute the other, take topology from critical points, then trace | https://doi.org/10.1145/3618349 | 3 |
| Liang, Bao, Shen, Wang, "A survey of Boolean operations in 3D geometric modeling" (CAD) | survey | 2026 | new | B-rep, mesh, hybrid and implicit Booleans in one survey | https://doi.org/10.1016/j.cad.2026.104081 | 3 |
| Yang & Jia, "Overlap Region Extraction of Two NURBS Surfaces" (TOG, SIGGRAPH Asia) | paper | 2025 | new | ε-overlap regions by bilevel optimisation; the basis for coaxial/co-cylindrical overlaps beyond planes | https://doi.org/10.1145/3763308 | 3 |
| Yang & Jia, "A Robust and Efficient Intersection Algorithm for NURBS Surfaces: Handling Small Loops and Tangent Intersections" (TOG) | paper | 2026 | new | the two classic SSI killers in NURBS SSI | https://doi.org/10.1145/3807948 | 3 |
| Wang, Jia, Yang et al., "Improving the Watertightness of Parametric Surface/Surface Intersection" (CGF) | paper | 2025 | new | consistent intersection curves across both parameter spaces | https://doi.org/10.1111/cgf.70298 | 3 |
| Hu, Patrikalakis, Ye, "Robust interval solid modelling Part I" (CAD 28(10)) | paper | 1996 | historical | interval geometry and interval SSI; every decision carries a bound | https://doi.org/10.1016/0010-4485(96)00013-9 | 3 |
| Generalized winding numbers for trimmed NURBS (arXiv 2504.11435) and spatially accelerated curved GWN (arXiv 2605.19200) | papers | 2025-26 | new | containment on trimmed curved surfaces that tolerates non-watertight input | https://arxiv.org/abs/2504.11435 | 3 |
| Sederberg, Finnigan, Li, Lin, Ipson, "Watertight trimmed NURBS" (SIGGRAPH) | paper | 2008 | historical | untrimmed T-spline patches, watertight by construction | http://staff.ustc.edu.cn/~lixustc/Figs/2008_TTC.pdf | 2 |
| Hohmeyer, "A surface intersection algorithm based on loop detection" (SMA '91) | paper | 1991 | historical | Gauss-map separation guarantees all closed loops | https://doi.org/10.1145/112515.112543 | 2 |
| Krishnan & Manocha, "An efficient surface intersection algorithm based on lower-dimensional formulation" (TOG 16(1)) | paper | 1997 | historical | plane algebraic curve plus eigenvalue methods for start points and singularities | https://doi.org/10.1145/237748.237751 | 2 |
| Sherman, Michel, Carbin, "Sound and robust solid modeling via exact real arithmetic and continuity" (ICFP) | paper | 2019 | research | functional solid modelling with computable exact reals (StoneWorks) | https://doi.org/10.1145/3341703 | 2 |
| "B-rep Boolean Resulting Model Repair by Correcting Intersection Edges" (arXiv 2310.10351); Liang et al., "Efficient Boolean Operations for B-Rep Models" (JCAD 2025) | papers | 2023/2025 | new | post-hoc repair by set reasoning over intersection edges with adaptive tolerances | https://arxiv.org/abs/2310.10351 | 2 |
| Lin et al., affine-arithmetic B-spline SSI on GPU (TVCG 2014); Krishnamurthy/McMains, GPU NURBS operations (TVCG 2009) | papers | 2009/2014 | historical | GPU subdivision SSI with affine-arithmetic bounds; GPU evaluation and intersection | https://doi.org/10.1109/TVCG.2013.237 | 2 |

The scout verified these DOIs and titles through Crossref. The method
descriptions come from titles and abstracts only, so they are INFERRED.

**Read next for wonky:**

- Yang & Jia 2025 overlap: the ε-overlap definition extends P1's coincidence
  relation to cylinders and cones.
- Yang & Jia 2026 small loops and tangency: open question 2.
- Hohmeyer 1991: the loop-detection criterion, applied analytically to
  quadric Gauss images.

### 7.2 Related deep-read notes that belong to other chapters

These notes were written for neighbouring topics. They are cited above
where relevant:

- [OCCT General Fuse specification](sources/occt-boolean-operations-specification-general-fuse-algorithm.md):
  interference order, pave and common blocks, and the "IsDone but wrong"
  issue pattern.
- [OCCT IntPatch / IntAna quadric SSI](sources/open-cascade-technology-occt-intpatch-impimpintersection-and.md):
  the closed-form subset and the cylinder/cylinder A(θ)v² + B(θ)v + C(θ)
  form.
- [OCCT BRep format tolerant semantics](sources/occt-brep-format-specification-tolerant-modeling-semantics.md)
  and the [parallel Jackson note](sources/jackson-boundary-representation-modelling-with-local-toleran.md).
- [ACIS R17 Booleans](sources/acis-r17-user-guide-booleans-technical-article.md)
  and [ACIS checker and intersectors](sources/acis-r17-checker-and-intersectors-articles.md).
- [SolveSpace NURBS Boolean](sources/solvespace-nurbs-boolean-src-srf-boolean-cpp-surfinter-cpp-r.md):
  #1268 and the `ProbeTangentFace` second-order probe, the numeric cousin
  of P4.
- [ESOLID](sources/esolid-exact-boundary-evaluation-for-low-degree-curved-solid.md):
  exact curved Boolean restricted to non-degenerate input.
- [Smith & Dodgson 2007](sources/smith-dodgson-2007-a-topologically-robust-algorithm-for-bool.md):
  the topology algorithm inside corefine.
- [Patrikalakis-Maekawa-Cho](sources/patrikalakis-maekawa-cho-shape-interrogation-for-computer-ai.md):
  IPP solver, characteristic points, tangential classification.
- [Zoo GPU SSI](sources/zoo-kittycad-cad-engine-overview-gpu-surface-surface-interse.md):
  uniform GPU seeding for SSI.
- [remus](sources/remus-esaueng-remus.md),
  [BRL-CAD libbrep](sources/brl-cad-libbrep-nurbs-boolean-evaluation-bool-eval-developme.md),
  [vcad](sources/vcad-ecto-vcad-kernel-booleans-kernel-naming-torture-corpus.md),
  [Aetheris](sources/aetheris-brep-boolean-lessons-md.md) and
  [Fornjot](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md):
  small open kernels, their failure taxonomies and their post-mortems.
- [Dupin cyclide blends](sources/dupin-cyclide-blends-shene-1998-two-cones-and-foufou-et-al-2.md):
  cones or cylinders are cyclide-blendable essentially iff they meet in
  conics. That makes P1's conic detector the gate for exact fillets between
  them.
