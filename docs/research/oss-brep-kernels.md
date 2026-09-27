# Established open-source B-rep and NURBS kernels

Chapter of the wonky research knowledge base, 2026-09-24. English.

**Status and method.**

- **Deep reads.** This chapter rests on 18 deep-read source notes (listed in
  section 2). All of them were re-read in full for this chapter. Notes that
  belong to other chapters (truck, vcad, remus, BREP.io, CADmium,
  monstertruck, OpenSolid) are used only for cross-links.
- **Publish-first step.** None of this topic's 18 slugs had a Codex JSON in
  `tmp/research/notes/`, and all 18 notes already existed in
  `docs/research/sources/`. Nothing had to be published.
- **Checked against wonky's own state (DOCUMENTED, local files):**
  - [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md): decision, pipeline, defects, and steps 1 to 13 with the status of 2026-09-24;
  - [../proto-recover.md](../proto-recover.md): algorithm, numeric model, the Unresolved set;
  - [../fillet.md](../fillet.md): usage, fillet bake-off candidates A to D;
  - [../robust-predicates.md](../robust-predicates.md), [../topology-identity.md](../topology-identity.md), [../public-boolean-regressions.md](../public-boolean-regressions.md), ../development record.md;
  - the SPDX headers of `kernel/ports/*.bend`.
- **Metadata.** `gh api` on 2026-09-24 for the 8 catalog-only repositories
  (section 7). Figures for deep-read repositories come from their notes (dated
  2026-09-22 unless stated).
- **No builds, no test runs.** A CPU benchmark is running on this machine.

**Labels.**

- **DOCUMENTED:** a primary source, linked here or in the linked note.
- **MEASURED:** a wonky run, reported in a linked wonky document.
- **INFERRED:** my reasoning from that evidence.
- **HEARSAY:** secondhand.

**Corrections to the scout's landscape overview.** These were found while
checking the notes and wonky's own documents.

1. **The Boolean bake-off is no longer running.** Judge round 2 decided it on
   2026-09-23. Production becomes **corefine** (a tagged Manifold-style mesh
   Boolean) plus **recover** (exact B-rep recovery from the tags). Plan steps
   1 to 4 were done on 2026-09-24 (DOCUMENTED,
   [hybrid-boolean-plan.md](../hybrid-boolean-plan.md) sections 1 and 9). The
   proposals in section 5 therefore plug into the plan's remaining steps,
   mainly step 2 (the pre-certificate) and step 9 ("close the Unresolved
   set"), and into the fillet bake-off ([fillet.md](../fillet.md) section 5).
2. **"529 to 0 failures" appears in neither source.** Valque and Lazard count
   527 of 4,524 self-intersecting Thingi10K models where naive rounding
   fails. The CGAL blog counts 572 of 9,997 files
   ([note](sources/valque-lazard-iterative-snap-rounding-for-triangle-soup-auto.md)).
3. **GoTools has no closed-form elementary-surface SSI.** `ConeInt.h` and
   `TorusInt.h` are empty stubs. Production converts elementary surfaces to
   splines and calls SISL
   ([note](sources/gotools-sintef-spline-geometry-library-with-intersections-co.md)).
4. **SISL and GoTools treat singular cases as first-class only in part.**
   - GoTools types singular points (TANGENTIAL, ISOLATED, BRANCH,
     HIGHER_ORDER), but decides them with a hard-coded `EPS = 1e-5`.
   - SISL's `itype` codes 3 and 8 are "not used".
   - SISL's `s1859` does flag coincident regions with status 10
     ([note](sources/sisl-sintef-spline-library.md)).
5. **"Add a torus first" is half done.**
   - The production `kernel/analytic.bend` knows plane, cylinder and cone only
     ([fillet.md](../fillet.md) §1 item 10).
   - The hybrid recover format already carries sphere and torus carriers and
     plane/torus sections ([proto-recover.md](../proto-recover.md),
     "Supported and unsupported").
   - The R20 torus cases KS06 and KS08 build (MEASURED,
     development record.md).

## 1. Landscape

### 1.1 The shape of the field: one complete kernel, a long tail, and an exactness research line

**One complete kernel.** Open CASCADE Technology (OCCT) is still the only
complete, industrial open-source B-rep kernel.

- **Scope:** general curved Booleans (the General Fuse Algorithm), rolling-ball
  fillets, offsets, shape healing and STEP.
- **Activity:** 2,904 stars, about 219 contributors, last commit 2026-08-24,
  V8.0.1 released 2026-07-30 (DOCUMENTED,
  [note](sources/open-cascade-technology-occt-intpatch-impimpintersection-and.md)).
- **Front-ends built on it:** almost every open CAD application.
  - FreeCAD.
  - Dune 3D: GPL-3.0, 2,090 stars, SolveSpace's constraint solver plus OCCT.
  - EGADS/ESP.
  - cadrum: `lzpel/cadrum`, MIT, 60 stars, an OCCT wrapper.
  - CadQuery and build123d.
- **Modeling philosophy: the tolerant B-rep.**
  - Every vertex, edge and face carries a tolerance.
  - Booleans *grow* these tolerances (`Tol(V) = max(Tol(V), D + Tol(E))`).
  - A fixed-point loop (`RepeatIntersection`) re-intersects grown vertices.
  - Users can trade exactness for success with a Fuzzy value (DOCUMENTED,
    [GFA note](sources/occt-boolean-operations-specification-general-fuse-algorithm.md)).

**A long tail of small analytic kernels.** They share one pattern: exact
special cases for easy surface pairs, marching otherwise, and death at tangency
and coincidence.

- **SolveSpace** (GPL-3.0, 2008 onward): trimmed rational Bezier patches.
  - Exact cases: plane/plane, plane/extrusion, parallel extrusions.
  - Marching otherwise.
  - All topology runs on a piecewise-linear (PWL) chain, so results depend on
    the chord tolerance
    ([note](sources/solvespace-nurbs-boolean-src-srf-boolean-cpp-surfinter-cpp-r.md)).
- **truck** (Apache-2.0, 2020 onward): transversal Booleans only; coincident
  faces are its documented open failure class
  ([note](sources/truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean.md)).
- **Fornjot** (0BSD): archived 2026-06-19 after about six years without a
  Boolean beyond disjoint grouping
  ([note](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md)).
- **CADmium** (ELv2, on truck): stalled in 2024 ([note](sources/cadmium.md)).
- **LLM-era kernels from 2025 and 2026.** They converge on "analytic first,
  mesh fallback, report the fidelity", all f64 and epsilon-based:
  - vcad (Apache-2.0, 427 stars): [note](sources/vcad-ecto-vcad-kernel-booleans-kernel-naming-torture-corpus.md);
  - remus (Apache-2.0 lineage, about 510k lines written by agents, 0 stars): [note](sources/remus-esaueng-remus.md);
  - BREP.io (MIT since its archival commit of 2026-09-12): [note](sources/brep-io.md);
  - cadcore (MIT, 42 stars): section 7.

**NURBS and SSI libraries without solids.**

- **SISL** (1988 onward, AGPL) and **GoTools** (2007 onward, AGPL): two-stage
  intersection (guide points, then marching). No solid Boolean.
- **openNURBS** (McNeel, permissive): the data structures under BRL-CAD's NURBS
  Boolean.
- **BRL-CAD libbrep** (LGPL-2.1): a NURBS Boolean dormant since 2023, with
  candid limitation notes
  ([note](sources/brl-cad-libbrep-nurbs-boolean-evaluation-bool-eval-developme.md)).
- **Evaluation-only libraries:** verb, tinyspline, NURBS-Python (geomdl),
  curvo, tinynurbs (section 7).

**The exactness research line.**

- **ESOLID** (1999-2004): exact boundary evaluation of low-degree curved
  solids. It refuses degeneracies.
- **CGAL Nef_polyhedron_3** (2003-2007): exact and fully general, but
  polyhedral and slow.
- **CGAL PMP corefinement** (2017 onward): exact predicates, exact
  intersection nodes, rounded output.
- **Valque and Lazard iterative snap rounding** (2025, CGAL 6.1).
- **Geometric Tools Engine (GTE)**: `BSNumber`/`BSRational`/`QFNumber` exact
  arithmetic under the Boost licence (BSL).

**Theory and parallel work.**

- The Patrikalakis-Maekawa-Cho hyperbook: the IPP solver, SSI taxonomy and the
  tangential classifier.
- Krishnamurthy and McMains: GPU NURBS evaluation and SSI.
- IRIT: a non-commercial research modeler.

**Naming.** FreeCAD 1.0's element map (realthunder) is the one serious open
design for persistent naming
([note](sources/freecad-topological-naming-realthunder-s-element-map-algorit.md)).

### 1.2 Lineages

| lineage | chain | what flows along it |
|---|---|---|
| Matra Datavision tolerant B-rep | Matra (1990s) → OCCT → FreeCAD, EGADS/ESP, Dune 3D, cadrum, CadQuery, build123d | the tolerant data model, the GFA Boolean, ChFi3d fillets. Every descendant inherits OCCT's failure modes (DOCUMENTED, notes) |
| BOOLE split-classify-stitch | Krishnan et al. 1995 (BOOLE) → ESOLID (exact) and BRL-CAD libbrep (float) | pairwise SSI, trim, split faces, classify one sample per face |
| GPU box SSI | Krishnamurthy, Khardekar, McMains 2007-2009 → BRL-CAD `intersect.cpp` (a documented CPU port) | uniform box grids, 7-tuple tagged intersection points |
| SINTEF splines | SISL (1988) → GoTools (2007) | guide points, then marching; normal-cone "simple case"; singularity vocabulary |
| Nef polyhedra | Seel's planar Nef (2001) → Nef_3 (2004) → OpenSCAD CGAL rendering → fast-csg corefinement (2022) → Manifold | the end state is a fast mesh Boolean, not an exact B-rep (DOCUMENTED, [Nef note](sources/cgal-nef-polyhedron-3-and-hachenberger-kettner-mehlhorn-bool.md)) |
| truck | truck (2020) → CADmium, monstertruck | `IntersectionCurve` (surface pair plus polyline plus Newton); a fillet prototype |
| brepkit | brepkit ≤ v2.129.15 (Apache) → remus; brepkit v3 onward is AGPL | an OCCT-shaped Rust kernel built by agents |
| wonky's own ports | OCCT (`kernel/ports/occt*.bend`, LGPL notice), SolveSpace (`kernel/ports/solvespace*.bend`, GPL-3.0 SPDX), truck (Apache) → bake-off → corefine (Manifold Boolean3 port) plus recover | shared paves, KeepRegion tables, BSP; now superseded by the hybrid (DOCUMENTED, file headers, [boolean-ports.md](../boolean-ports.md)) |

### 1.3 Trends, 2024 to 2026

- **Mature kernels are still fixing tangency and silent failures** (DOCUMENTED,
  notes):
  - **OCCT, merged in 2026:**
    - PR #1176: near-parallel plane/cylinder faces of small height were
      misclassified;
    - PR #1228: two cylinders tangent along a line gave an invalid point.
  - **OCCT, open:**
    - #1543: a Cut silently removes nothing, depending on where the cylinder
      seam lies;
    - #1371: a fillet reports full success and returns a self-intersecting
      solid.
  - **OCCT, closed 2026-08-23:** #1496, a Common of identical solids returned
    an empty result with `IsDone() == true`.
  - **SolveSpace:** #1291 (a tangent fillet-shaped cut) closed after four years
    and five separate defect fixes (PRs #1729 and #1731). Follow-ups #1751 to
    #1760 are partly co-written with an LLM.
- **From-scratch kernels stall at curved Booleans and fillets, not at the UI.**
  - Fornjot's post-mortem: "ran into a cliff", with another 2-3 years estimated.
  - CADmium stalled because no one owned the kernel
    ([Fornjot note](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md),
    [CADmium note](sources/cadmium.md)).
- **Kernels written by agents grow fast and stress contracts.** vcad publishes
  a fidelity matrix; remus has a failure taxonomy with stable codes. Both
  remain f64 with epsilons (DOCUMENTED, notes).
- **Tagged mesh Booleans displace exact polyhedral Booleans.**
  - OpenSCAD moved from Nef to corefinement to Manifold.
  - CGAL moved Booleans into their own package (6.2, 2026-06-11) and added
    iterative snap rounding (6.1, 2025-10-01).
  - Exactness is spent on *predicates and rounding boundaries*, no longer on
    every construction (DOCUMENTED,
    [CGAL PMP note](sources/cgal-polygon-mesh-processing-boolean-operations-separate-pac.md)).

### 1.4 What is conspicuously missing

Each item below was checked against the notes.

- **Certified tangency and coincidence decisions.** Every surveyed system
  decides them with an epsilon or declares them unsupported (DOCUMENTED, notes):

  | system | how it decides tangency or coincidence |
  |---|---|
  | OCCT | 1e-8 dead band labelled `Undecided`; 1e-12 to 1e-14 axis tests |
  | SolveSpace | `DOTP_TOL = 1e-5`, `LENGTH_EPS = 1e-6` mm |
  | GoTools | `EPS = 1e-5` on unnormalized second fundamental forms |
  | SISL | `ANGULAR_TOLERANCE = 0.01` rad |
  | truck | declares coincident faces unsupported |
  | ESOLID | refuses degeneracies |
  | Nef | decides everything exactly, but only for planes (first order) |

- **Exact non-conic intersection curves in any Boolean result.** In OCCT,
  "only conics survive as exact curves". Quartic ALines become 200-point
  walking lines, then B-splines (DOCUMENTED,
  [ImpImp note](sources/open-cascade-technology-occt-intpatch-impimpintersection-and.md)).
- **A robust open fillet engine beyond OCCT's closed-form set.** OCCT has
  documented gaps:
  - #1177: a full round fails;
  - #1495: a non-terminating loop;
  - unequal-radius corners are filled with approximate Plate surfaces.

  On wonky's fillet harness OCCT builds 49 of 70 cases (MEASURED,
  [fillet.md](../fillet.md) §1 item 9).
- **Certified validity checks.** OCCT's `BRepCheck` samples curve-on-surface at
  23 points and passes a twisted, self-intersecting loft as valid (#1315)
  (DOCUMENTED,
  [healing note](sources/occt-shape-healing-guide-and-brepcheck-validity-checking-and.md)).
- **An F32- or GPU-native exact kernel.**
  - GTE's precision tables assume `uint64_t` carries.
  - CGAL's EPECK assumes GMP and a mutable lazy DAG.
  - ESOLID assumes LiDIA or GMP rationals.

  No surveyed system maps exact predicates onto 32-bit words with uniform work
  (INFERRED from the notes).
- **Public, root-caused Boolean failure corpora.** They are scarce. The usable
  ones are:
  - SolveSpace tracking issue #738 with its fixing commits;
  - OCCT's `tests/boolean` and TKBO GTests;
  - CGAL's `test_corefinement_bool_op.cmd`, a table of expected manifold
    feasibility per operation;
  - ESOLID's near-tangent cylinder series;
  - the non-trivial Thingi10K IDs from Valque-Lazard.
- **Deterministic persistent naming.** FreeCAD's element map uses a random
  duplicate suffix in release builds, and its index order depends on OCCT's
  report order (DOCUMENTED, naming note). vcad's fail-closed naming crate
  retrofits determinism case by case, after `HashMap`-order flakiness
  (DOCUMENTED,
  [vcad note](sources/vcad-ecto-vcad-kernel-booleans-kernel-naming-torture-corpus.md)).

### 1.5 Licensing map (wonky is private and unlicensed)

| licence class | sources | what wonky may do |
|---|---|---|
| permissive: Apache-2.0, MIT, BSD, BSL-1.0, 0BSD, CC BY | GTE (BSL), truck, vcad, remus (≤ v2.129.15 lineage), monstertruck, verb, curvo, tinyspline, geomdl, tinynurbs, cadcore, Fornjot (0BSD), the Valque-Lazard paper (CC BY 4.0), openNURBS (McNeel licence, permissive) | port ideas and transliterate logic. Keep attribution and NOTICE files where code is translated (DOCUMENTED, notes) |
| weak copyleft: LGPL-2.1, MPL-2.0 | OCCT (LGPL-2.1 plus exception), BRL-CAD libbrep, FreeCAD, OpenSolid (MPL) | study and re-derive. A translation is plausibly a derivative work, which matters on distribution (INFERRED) |
| strong copyleft: GPL-3.0, AGPL-3.0 | SolveSpace, CGAL (Nef_3, PMP; commercial alternative), Dune 3D, SISL and GoTools (AGPL with a producer-line clause) | study only; re-derive from papers and manuals. GPL test meshes stay local |
| non-commercial / none | Patrikalakis software package, IRIT, ESOLID mirror (no licence, all rights reserved) | read the math; copy no code |

**Implementation decision (DOCUMENTED plus INFERRED).**

- `kernel/ports/solvespace.bend` and `kernel/ports/solvespace-bsp.bend` carry
  `SPDX-License-Identifier: GPL-3.0-or-later`.
- `kernel/ports/occt.bend` and `kernel/ports/occt-edges.bend` carry the LGPL-2.1
  OCCT notice.
- This is fine while wonky stays private.
- Before any publication, decide per file: keep it under GPL or LGPL, rewrite it
  clean-room, or drop it. The hybrid has superseded most of these paths, so
  dropping may be cheap.

### 1.6 Where wonky sits (INFERRED from the notes and the wonky documents)

**The architecture matches the field's newest direction, with three
differences no surveyed open kernel has.** Like vcad, BREP.io and remus, a
robust mesh Boolean decides topology and analytic recovery follows. The
differences:

1. **Exact carriers per tag.** Recovery takes every curve from its two
   carriers, "never from the polyline" (DOCUMENTED,
   [hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §2.2).
   - This is the Nef authors' own lesson: pair topology by propagated indices,
     not by geometric equality (thesis §9.6.3).
   - It is also what FreeCAD reconstructs expensively from OCCT history.
2. **Named refusals backed by certificates.** Refusals come from the
   pre-certificate, clearance and nesting checks, instead of fuzzy success.
3. **Byte-identical results on JS, cpu1, cpu18 and Metal** (MEASURED, plan §9).

**Precision regime.**

- F32x2 resolves about 2^-48 ≈ 3.6e-15 relative.
- OCCT's `1e-14` absolute and `1e-13` relative epsilons lie below that
  resolution at 100 mm scale. `Precision::Angular = 1e-12` is marginal.
  `Confusion = 1e-7` mm fits.
- So no OCCT constant can be copied as a constant (DOCUMENTED, ImpImp note).

**wonky's open gaps coincide with the field's known weak spots.**

- **Near-tangency is decided by clearance, not exactly.** The pre-certificate
  refuses carrier pairs within `h + h' + 1e-6` mm that it cannot attribute to
  a decided crossing.
- **Carrier classes are merged at fixed tolerances:** 1e-7 mm, and 1e-10 in
  `1 - |cos|`.
- **These curve types are refused:**
  - space quartics;
  - spiric sections;
  - plane/cone hyperbolas and parabolas;
  - degenerate tangent vertices.
- **Boolean outputs carry no names across split and merge**
  (`unsupported-split-merge-correspondence`).

(DOCUMENTED, [proto-recover.md](../proto-recover.md) algorithm steps 0-1 and
"Supported and unsupported";
[topology-identity.md](../topology-identity.md).)

**SolveSpace issue #1268 is exactly wonky's current refusal class.** It is a
cube and cylinder union that meet tangentially. The recover suite refuses
`cylinder-tangent-box-face` ("plane and cylinder within 0 mm") on purpose, and
`hex-nut` fails on a degenerate tangent vertex (MEASURED,
[proto-recover.md](../proto-recover.md) corpus table).

## 2. Comparison table

Status figures come from the notes (gh api 2026-09-22) unless marked.

**Verdicts:**

- **adapt:** re-derive and build it into wonky.
- **learn-from:** take lessons, specifications or tests only.

| # | name | kind | status (2026) | licence | verdict | key idea for wonky | note |
|---|---|---|---|---|---|---|---|
| 1 | OCCT IntPatch_ImpImpIntersection / IntAna_QuadQuadGeo | kernel source, quadric-pair SSI | active; 2,904★, ~219 contributors, last commit 2026-08-24; both files fixed in 2026 (#1176, #1228) | LGPL-2.1 + exception | adapt | the pair table (plane 1 … torus 5) and the conic decision trees, re-derived as exact sign predicates; the cylinder/cylinder closed form `cos(U2−FI2) = B cos(U1−FI1) + C` | [sources/open-cascade-technology-occt-intpatch-impimpintersection-and.md](sources/open-cascade-technology-occt-intpatch-impimpintersection-and.md) |
| 2 | OCCT Boolean Operations specification (GFA) | spec plus TKBO source (~54k lines) | active; GTests; open #1543, #1041, #245, #1360 | LGPL-2.1 docs | learn-from | ordered interference classes (V/V … F/F), paves and common blocks, same-domain faces, Modified/Generated history; reject tolerance growth, Fuzzy and RepeatIntersection | [sources/occt-boolean-operations-specification-general-fuse-algorithm.md](sources/occt-boolean-operations-specification-general-fuse-algorithm.md) |
| 3 | OCCT BRep format specification | file format spec | current (V1-V3) | LGPL docs; format = facts | learn-from | exact definitions of vertex, edge and face deviation, SameParameter/SameRange, seam and degenerated edges, regularity; to be computed and capped, never grown | [sources/occt-brep-format-specification-tolerant-modeling-semantics.md](sources/occt-brep-format-specification-tolerant-modeling-semantics.md) |
| 4 | OCCT Modeling Algorithms guide + TKFillet/ChFi3d | guide plus source (~63k lines) | active, fragile; open #1177, #1371, #1495 | LGPL-2.1 + exception | adapt | the closed-form fillet table (`ChFi3d_KParticular`) as the FDM fillet set; the failure API (faulty contours and vertices, stripe status) | [sources/occt-modeling-algorithms-guide-and-tkfillet-chfi3d-fillets-c.md](sources/occt-modeling-algorithms-guide-and-tkfillet-chfi3d-fillets-c.md) |
| 5 | OCCT Shape Healing guide + BRepCheck | guide plus source | active (V8.0.1) | LGPL-2.1 + exception | learn-from | 37 validity status codes; intrinsic then contextual checks; the Boolean argument self-interference check; never heal silently | [sources/occt-shape-healing-guide-and-brepcheck-validity-checking-and.md](sources/occt-shape-healing-guide-and-brepcheck-validity-checking-and.md) |
| 6 | SolveSpace NURBS Boolean (`src/srf`) | small kernel source (~6.6k lines) | active; 4,165★, v3.2 2026-03-27; 82 NURBS issues (42 open) | GPL-3.0-or-later | learn-from | exact directrix projection for plane ∩ extrusion; KeepRegion/KeepEdge tables; chain classification; second-order tangent probe; its bug tracker predicts wonky's next failures | [sources/solvespace-nurbs-boolean-src-srf-boolean-cpp-surfinter-cpp-r.md](sources/solvespace-nurbs-boolean-src-srf-boolean-cpp-surfinter-cpp-r.md) |
| 7 | BRL-CAD libbrep NURBS Boolean | library plus developer guide | repo active (1,032★, 7.44.0); Boolean dormant since 2023; #33, #34 open since 2022 | LGPL-2.1 (openNURBS parts permissive) | learn-from | 3D→2D tolerance maps; "no iterative solvers in classification"; hypothesize-and-verify surface recognition; stage-wise `dplot` debugging | [sources/brl-cad-libbrep-nurbs-boolean-evaluation-bool-eval-developme.md](sources/brl-cad-libbrep-nurbs-boolean-evaluation-bool-eval-developme.md) |
| 8 | Fornjot and "Shutting down Fornjot" | archived Rust kernel plus post-mortem | archived 2026-06-19; 2,553★, 57 contributors | 0BSD | learn-from | risk register: drive from failing models, shared edges by construction, keep (u,v) from construction, introspection | [sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md) |
| 9 | ESOLID (Keyser, Culver, Manocha, Krishnan) | exact research system | dead since mid-2000s; unofficial mirror | papers ©; mirror has no licence | learn-from | implicit curves in (u,v), association-based edge identity, classify-and-propagate, filter → exact cascade; **141 bits** for near-tangent cylinders | [sources/esolid-exact-boundary-evaluation-for-low-degree-curved-solid.md](sources/esolid-exact-boundary-evaluation-for-low-degree-curved-solid.md) |
| 10 | Krishnamurthy, McMains et al., GPU NURBS operations | papers (TVCG 2009, SPM 2008) | finished (2007-2011); no code | paper © | learn-from | uniform box grids, level-synchronous culling with compaction, 7-tuple `(x,y,z,u1,v1,u2,v2)` tagging; no topology guarantee | [sources/krishnamurthy-mcmains-et-al-performing-efficient-nurbs-model.md](sources/krishnamurthy-mcmains-et-al-performing-efficient-nurbs-model.md) |
| 11 | GoTools (SINTEF) | C++ spline library | low activity; 82★, last commit 2025-11-25 | AGPL-3.0 (+ commercial) | learn-from | the SSI decision ladder; `SingularityType` and `LinkType` provenance vocabulary; the second-fundamental-form tangency discriminant | [sources/gotools-sintef-spline-geometry-library-with-intersections-co.md](sources/gotools-sintef-spline-geometry-library-with-intersections-co.md) |
| 12 | SISL (SINTEF Spline Library) | C library plus 384-page manual | dormant; 216★, last commit 2026-09-21 | AGPL-3.0 (+ commercial) | learn-from | two-level contract (guide points, then marched curve plus pcurves with partial-failure status); normal-cone simple case; per-branch in/out pretopology | [sources/sisl-sintef-spline-library.md](sources/sisl-sintef-spline-library.md) |
| 13 | Geometric Tools Engine (Eberly) | header-only C++ library plus PDFs | active; 1,386★, last commit 2026-09-20 | BSL-1.0 (PDFs CC BY) | adapt | odd-mantissa `BSNumber`, fixed-limb `UIntegerFP32<N>`, static bit budgets (`BSPrecision`), `QFNumber` a+b√d, exact root multiplicity, `SWInterval` filter, robust ellipse-ellipse | [sources/geometric-tools-engine-david-eberly-bsnumber-bsrational-exac.md](sources/geometric-tools-engine-david-eberly-bsnumber-bsrational-exac.md) |
| 14 | Valque & Lazard iterative snap rounding (CGAL 6.1) | paper plus library | new (SGP 2025); maintained in CGAL 6.2.1 | paper CC BY 4.0; code GPL-3.0 | adapt | snap offending plus co-cell vertices to a coarse grid, re-refine exactly, ≤ 5 iterations, explicit failure, Hausdorff bound `M·2^-gs·k` | [sources/valque-lazard-iterative-snap-rounding-for-triangle-soup-auto.md](sources/valque-lazard-iterative-snap-rounding-for-triangle-soup-auto.md) |
| 15 | Patrikalakis, Maekawa, Cho: *Shape Interrogation* | textbook (hyperbook) | finished (2002; pages 2009) | text ©, free to read; code non-commercial | adapt | IPP (Bernstein plus projected hulls, one-sided no-root-lost), F3 substitution sign test, characteristic points, `b12² − b11·b22` tangency classifier | [sources/patrikalakis-maekawa-cho-shape-interrogation-for-computer-ai.md](sources/patrikalakis-maekawa-cho-shape-interrogation-for-computer-ai.md) |
| 16 | FreeCAD element map (realthunder) | naming algorithm plus C++ | shipped in 1.0 (2024-11-19); 27 open / 52 closed "Toponaming" issues | LGPL-2.1 (wiki in a GPL-3 repo) | learn-from | names derived from Modified/Generated relations; upper/lower fallback passes; fixed roles for coplanar faces; detect → propose → auto-fix only if confident | [sources/freecad-topological-naming-realthunder-s-element-map-algorit.md](sources/freecad-topological-naming-realthunder-s-element-map-algorit.md) |
| 17 | CGAL PMP Boolean operations (corefinement) | C++ package | production; CGAL 6,054★, v6.2 2026-06-11, v6.2.1 2026-09-04 | GPL-3.0-or-later OR commercial | learn-from | three numeric roles (filtered predicates, exact nodes, rounded embedding); per-patch classification from the cyclic order around intersection edges; per-operation non-manifold flags | [sources/cgal-polygon-mesh-processing-boolean-operations-separate-pac.md](sources/cgal-polygon-mesh-processing-boolean-operations-separate-pac.md) |
| 18 | CGAL Nef_polyhedron_3 (Hachenberger, Kettner, Mehlhorn) | paper, thesis, package | maintained, algorithm frozen since ~2006 | GPL-3.0-or-later OR commercial | learn-from | vertex-local overlay → select → simplify; canonical form; bounded bits while planes stay primary; pair by propagated indices | [sources/cgal-nef-polyhedron-3-and-hachenberger-kettner-mehlhorn-bool.md](sources/cgal-nef-polyhedron-3-and-hachenberger-kettner-mehlhorn-bool.md) |

**Neighbouring notes from other chapters, cross-linked only:**

| name | kind | licence | verdict (their note) | why it matters here | note |
|---|---|---|---|---|---|
| truck | Rust B-rep kernel | Apache-2.0 | adapt | `IntersectionCurve` (surface pair, polyline leader, Newton) is the permissive template for R4; coincident faces are its open failure class | [sources/truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean.md](sources/truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean.md) |
| vcad | Rust CAD with its own kernel (2026) | Apache-2.0 (Cargo says MIT) | learn-from | fidelity report: analytic versus soup, and why | [sources/vcad-ecto-vcad-kernel-booleans-kernel-naming-torture-corpus.md](sources/vcad-ecto-vcad-kernel-booleans-kernel-naming-torture-corpus.md) |
| remus | agent-built Rust kernel | Apache-2.0 (≤ v2.129.15 lineage) | adapt (contract layer) | failure taxonomy with stable codes; qualified SSI results | [sources/remus-esaueng-remus.md](sources/remus-esaueng-remus.md) |
| BREP.io | JS application plus kernel over manifold | MIT (since 2026-09-12) | learn-from | labelled mesh Boolean as topology backbone; heuristic surgery around it | [sources/brep-io.md](sources/brep-io.md) |
| CADmium | browser CAD on truck | ELv2 | learn-from | stalled for lack of a kernel owner | [sources/cadmium.md](sources/cadmium.md) |
| monstertruck | truck fork with a fillet crate | Apache-2.0 | adapt | contact-circle solver for the fillet bake-off (C) | [sources/monstertruck-truck-fork-monstertruck-fillet-crate.md](sources/monstertruck-truck-fork-monstertruck-fillet-crate.md) |
| OpenSolid | Haskell kernel | MPL-2.0 | adapt | dyadic subdivision solver close to Bend's model | [sources/opensolid-ian-mackenzie.md](sources/opensolid-ian-mackenzie.md) |

## 3. State of the art: best techniques, their real guarantees, where they break

### 3.1 Analytic quadric-pair intersection

**Best known: OCCT's pair table** (DOCUMENTED,
[ImpImp note](sources/open-cascade-technology-occt-intpatch-impimpintersection-and.md)).

- **Dispatch.** Surface codes are plane 1, cylinder 2, cone 3, sphere 4 and
  torus 5. The key `10·i1 + i2` selects one of 15 pair routines.
- **Result classes.** `IntAna_QuadQuadGeo` returns a typed class: Point, Line,
  Circle, Ellipse, Parabola, Hyperbola, Same, Empty or NoGeometricSolution.
- **Plane/cylinder:**
  - parallel axis: 0, 1 (tangent) or 2 lines at `omega ± sqrt(r² − d²)(a×n)`;
  - otherwise a circle, or an ellipse with semi-axes `r/|a·n|` and `r`.
- **Plane/cone:** a full conic zoo from `cost = |a·n|`, `sint = |n×a|` and
  `costa = cos(t+φ)`, including the through-apex line and point cases.
- **Cylinder/cylinder:**
  - parallel axes: lines, decided by circle/circle intersection;
  - equal radii with intersecting axes: two planar ellipses (the Steinmetz
    case) with two multiple points;
  - general case: the closed form `cos(U2 − FI2) = B·cos(U1 − FI1) + C`, V
    linear in sin/cos, two branches `U2 = FI2 ± acos(...)`.
- **Other non-conic pairs** are parameterized as
  `A(θ)v² + B(θ)v + C(θ) = 0` over the cylinder or cone angle.

**Two smaller references.**

- **GTE's plane/cylinder `FIQuery`** makes the parallel test exact with exact
  types. It then leaves sqrt and an eigendecomposition approximate (DOCUMENTED,
  [GTE note](sources/geometric-tools-engine-david-eberly-bsnumber-bsrational-exac.md)).
- **SolveSpace's plane ∩ extrusion** is the parallel projection of the
  directrix Bezier onto the plane, with weights unchanged. Projection is affine,
  so the result is exact without any conic case analysis (DOCUMENTED,
  [SolveSpace note](sources/solvespace-nurbs-boolean-src-srf-boolean-cpp-surfinter-cpp-r.md)).

**Real guarantee: none are certified.**

- **Every topological decision is an f64 comparison.** Parallel, tangent,
  circle versus ellipse, same surface and apex-in-plane are all tested against
  constants from 1e-14 to 1e-7, or against the sum of face tolerances.
- **Near-degenerate inputs are reclassified to a nearby simpler case:**
  - a near-parallel plane/cylinder becomes lines, via the face-height rule of
    PR #1176;
  - an ellipse with `major ≥ 1e5·minor` is sent to the walker;
  - the error is absorbed later by tolerance growth.
- **Only conics stay exact.** Other pairs become 200-point walking lines, then
  B-splines.

**Where it breaks** (DOCUMENTED, issues and code comments):

- near-parallel faces of small height (#1176);
- cylinders tangent along a line (#1228);
- dependence on the seam position (#1543);
- the plane/plane origin error of about 1e-4 at 2e-6 rad;
- acos ill-conditioning near cylinder/cylinder branch points, with error
  estimate `aTol0/sqrt(δ(2−δ))`.

**Mapping to wonky (INFERRED, derived in the ImpImp note).** The OCCT
decisions become polynomial sign tests of degree at most 4 in the input words:

- parallel ⇔ `n·a = 0`;
- circle ⇔ `n×a = 0`;
- line count from `sign(d² − r²|n|²)`;
- tangency ⇔ that discriminant is exactly 0.

Constructions (ellipse centre, semi-axes) stay F32x2 with a residual bound.

### 3.2 General (freeform) surface-surface intersection

| technique | representative | real guarantee | where it breaks |
|---|---|---|---|
| boundary-first recursive subdivision, normal-cone "simple case", then marching | SISL (`sh1761`/`sh1762`, `s1741`, `s1310`), GoTools (`Intersector::compute`) | in exact arithmetic with rigorous cones: no closed loop inside a simple-case leaf (Sinha). SISL builds cones from control-patch corner normals, a heuristic enclosure (INFERRED). Marching: none | tangential zones; branch jumps (guard: successive `N1×N2` dot ≤ 0.5); silent local tolerance growth (`aepsge2`); GoTools "complexity not reduced" writes a file and returns (DOCUMENTED) |
| uniform box grids with curvature bounds, level-synchronous culling, leaf triangle tests | Krishnamurthy et al. TVCG 2009; BRL-CAD `intersect.cpp` (CPU port, depth 8) | "guaranteed not to miss" if bounds are small enough, but the bounds come from central differences, not rigorous maxima (INFERRED) | wrong topology when branches are close, at branch points, at tangential contact; proximity assembly left 320 orphan points (DOCUMENTED) |
| interval projected polyhedron (IPP) | Patrikalakis-Maekawa-Cho §4 | one-sided: with rounded interval arithmetic and an exact or interval formulation, no root is lost; boxes may be empty or hold clusters (DOCUMENTED) | non-zero-dimensional solution sets (overlaps) are an open problem; tangential roots degrade to bisection |
| algebraic exact boundary evaluation | ESOLID | every decision exact for **non-degenerate** input (DOCUMENTED) | refuses tangency, coincidence and singular curves; algebraic degree 4 is the practical wall; 54-98 % of time in 2D curve-curve intersection |
| tessellate, intersect meshes, refine onto both surfaces | verb; truck `IntersectionCurve`; BRL-CAD libbrep (plus line and conic fitting) | positional bound only | topology inherited from the mesh; seeds missed below mesh resolution |

**Tangential classification is textbook but not certified anywhere.**

- **The classifier.** Where the normals are parallel, the difference of the
  second fundamental forms gives `b11 w² + 2 b12 w + b22 = 0`. The
  discriminant `b12² − b11·b22` then separates the cases:
  - `< 0`: isolated contact;
  - `= 0` with some `b` nonzero: a tangential curve;
  - `> 0`: a branch point;
  - all `b = 0`: higher-order contact.
- **Sources.** Patrikalakis §6.4 derives it. GoTools implements it with
  `EPS = 1e-5` on unnormalized forms, which is scale-dependent (DOCUMENTED,
  notes).
- **For wonky (INFERRED).** For plane, cylinder and cone the forms are constant
  or depend only on the radius, so the sign is an exact low-degree predicate.

### 3.3 Boolean pipelines compared

| pipeline | topology decided by | classification | numeric regime | documented guarantee | typical failure |
|---|---|---|---|---|---|
| OCCT GFA | pave filler: V/V, V/E, E/E, V/F, E/F, F/F, then containment; nested re-intersection; RepeatIntersection | one interior point per split face, ray classifier; WireSplitter picks the minimum clockwise UV angle | f64, growable tolerances, Fuzzy | none claimed; the spec lists failure sources ("tangency, etc.") | `IsDone() == true` with a wrong result at seams, shared edges and tangent junctions (#1496, #1543, #245, #1041) |
| SolveSpace | PWL chains of exact or marched curves; one shared curve per intersection | chains between "choosing points", KeepRegion table with asymmetric COINC_SAME/COINC_OPP; edge-on-edge by direction cosines; otherwise fixed random ray casts | f64, `LENGTH_EPS` 1e-6 mm, `DOTP_TOL` 1e-5, user chord tolerance | none; end-to-end oracles only (the UV polygon failed to assemble, naked edges) | tangency (#1268, #1291), coincident faces edge-on-edge (#1452), coaxial cone/cylinder stacks (#1091), chord-tolerance dependence (#297) |
| BRL-CAD libbrep (BOOLE) | SSI per bbox-overlapping pair, link curves, Margalit-Knott loop Booleans | one grid point per split face, **single ray, parity**, inner loops ignored | f64, 1e-4 / 1e-3 constants | the guide says it "may produce incorrect output" | coplanar box union loses surfaces (#33); linking and stitching errors, not SSI errors |
| ESOLID | exact implicit curves per patch pair; associations across patches | one sample per subpatch, propagated through adjacency | rational plus filters | exact for non-degenerate input | degeneracies refused; perturbation only as an input workaround |
| CGAL corefinement | exact orientation predicates; nodes = plane(3 input points) ∩ line(2 input points), kept exact | per patch, from the cyclic order of the 4 triangles around each intersection edge; exact point-in-mesh only for isolated patches | filtered doubles plus EPECK for nodes; output rounded | EPICK: right topology, embedding may self-intersect; EPECK: exact; non-manifold results refused per operation | chains of rounded outputs crash (#9455, #6481, #9282); ~1e-14 noise gives a non-manifold result (#9497) |
| CGAL Nef_3 | vertex-local overlay of sphere maps, select, simplify; synthesis by Plücker and plane keys | marks on every item; volumes by ray shooting | exact rationals everywhere | always the exact Nef set; closed under all operations; canonical | speed and memory (2-6× slower than ACIS in 2005; 5-178× slower than corefinement); exact constructions mandatory (#5490) |
| **wonky hybrid** (for reference) | corefine tagged mesh Boolean (symbolic perturbation, F32x2) | recover: carrier classes → patches → corners → curves from carrier pairs; certificates | F32x2 plus exact fallback predicates; named refusals | measured: 32 of 38 corpus cases give exact OCCT-valid STEP. After steps 1-4, recover's wrong `ok` answers went from 15 to 0, and corefine's alone from 18 to 3 (the 3 are grazing cases that the hybrid's pre-certificate refuses) (plan §9) | near-tangency refused by clearance; non-conic curves Unresolved |

### 3.4 Numeric regimes and bit budgets

**Four regimes are in use** (DOCUMENTED, notes):

1. **Tolerance growth (OCCT).** Tolerances are uncapped, absolute and
   scale-dependent.
   - A vertex tolerance of 50 is a legal file.
   - At a scale of about 1e6, the pcurve `acos` loses angle accuracy.
2. **Absolute epsilons (SolveSpace, SISL, BRL-CAD).** A policy, not a
   certificate.
3. **Exact rationals everywhere (Nef, ESOLID).** Correct, but costly:
   - Nef's exact rotation by 1e-6° takes 450 s;
   - Nef's authors found that floating-point filters *slow down* synthesis,
     because synthesis keeps testing equality of near-identical objects;
   - their fix is pairing by propagated indices (`SNC_indexed_items`).
4. **Exact predicates, exact symbolic nodes, one rounding step (CGAL PMP).**
   The manual states the split: exact predicates are enough for termination
   and correct topology; exact constructions are needed for chained
   operations.

**Bit numbers wonky can size against:**

| quantity | bits | source |
|---|---|---|
| ESOLID, real Bradley parts | 41-87 | ESOLID Tables 1, 3 (DOCUMENTED) |
| ESOLID, two barely interpenetrating cylinders | 20-141 as the overlap shrinks | ESOLID Table 4 (DOCUMENTED) |
| GTE `x·y − z·w`, arbitrary float inputs | 554 (18 words); 300 on [-1,1]; 48 on [1,2) without subtraction | GTE `BSPrecision` (DOCUMENTED) |
| GTE orient3d, float inputs | `UIntegerFP32<27>` with BSNumber; 197 words for double | `PrimalQuery3.h` comments (DOCUMENTED) |
| orient3d on B-bit grid integers | 3B + 6 | derived from GTE's rules (INFERRED, GTE note) |
| CGAL segment/plane node | numerator degree 4, denominator degree 3: about 100 / 75 bits at B = 24 | Valque-Lazard §5 (DOCUMENTED); bits INFERRED |
| orientation of four such nodes | degree up to 16: about 400 bits, about 13 U32 limbs, at B = 24 | INFERRED (CGAL PMP note) |
| Nef, 30-bit inputs | planes 93 bits, edge/plane vertices up to 158 bits; bits grow only when primitives are re-derived | Hachenberger thesis §9.5 (DOCUMENTED) |
| wonky exact-plane `big.bend` | ≤ 325 bits (21 16-bit limbs) at B = 34 | Nef and CGAL PMP notes, citing `kernel/proto/exact-plane/big.bend` (DOCUMENTED) |
| F32x2 | about 48-49 significant bits; low word underflows below about 1e-31 | GTE and Patrikalakis notes (INFERRED) |

**Filters that fit Bend** (INFERRED from the notes).

- **`SWInterval`-style widening.** Compute in round-to-nearest, then widen
  each endpoint. This needs no rounding-mode control.
  - Bend has no directed rounding. Widen by a relative
    `|x|·2^-23 + 2^-149` term, or by ±1 on the U32 bit pattern if Bend 2
    exposes an F32 to U32 bitcast (to verify).
  - On Metal, division and sqrt may not be correctly rounded, and fast math
    can flush subnormals to zero. Metal filters need extra slack there. The GTE
    note flags this as still to be checked against the Metal Shading Language
    specification; see [parallel-gpu-geometry.md](parallel-gpu-geometry.md)
    §1.5.
- **ESOLID's `horner_with_err`.** A running error bound, then "don't know",
  then the exact path.
- **CGAL's `double_ceil`.** An interval first, exact division only if both
  interval ends round differently. This is the filter pattern applied to
  *rounding* rather than to a sign.

### 3.5 Validity checking and healing

**The most complete open validity specification is OCCT's `BRepCheck`**
(DOCUMENTED,
[healing note](sources/occt-shape-healing-guide-and-brepcheck-validity-checking-and.md)).

- **Coverage.** It has 37 status codes across these checks:
  - vertex on curve and on surface;
  - edge SameParameter, SameRange and curve-on-surface;
  - wire connected, closed and self-intersecting;
  - wire nesting within a face;
  - shell closed and oriented;
  - solid: growth versus hole, `EnclosedRegion`.
- **Two phases.** Intrinsic `Minimum()` checks run first, then contextual
  `InContext(parent)` checks in parallel.
- **Real guarantee: evidence, not proof.**
  - Curve-on-surface is sampled at 23 points, or optimized by particle swarm
    plus Newton in "exact" mode.
  - Heuristic accept rules are built in: 1 % of the parametric range for 2D
    closure, `1.1 × Tol(V)`, an 8-sample "yawn" test, and one sample point per
    wire for nesting.
- **Where it breaks:**
  - #1315: a twisted, self-intersecting loft is reported valid.
  - #1372: the check costs 17.9 % of all instructions in a Cut of a
    128 × 128 × 5 plate, to measure a deviation of about 1e-16 on analytic
    pairs.
  - BRepCheck-valid is not Boolean-valid. `BOPAlgo_ArgumentAnalyzer` adds
    self-interference and micro-edge checks. Its tangency test is
    `// not implemented`.
- **Healing makes things valid by growing tolerances** up to `MaxTolerance`.
  #1541: `UnifySameDomain` turns a valid box-minus-sphere into an invalid
  shape whose vertex tolerance explodes to 0.6153.

### 3.6 Fillets, chamfers and offsets

The detailed survey is [fillet.md](../fillet.md) with its chapters. This
chapter's sources add the following (DOCUMENTED,
[fillet note](sources/occt-modeling-algorithms-guide-and-tkfillet-chfi3d-fillets-c.md)).

**OCCT's closed-form eligibility (`ChFi3d_KParticular`).** It requires
constant radius, one face a plane, and a line or circle spine. The cases:

| second face and spine | fillet surface |
|---|---|
| plane/plane, line edge | cylinder |
| cylinder, line edge with the axis parallel to the plane | cylinder |
| cylinder cap edge (circle, axis ⊥ plane) | torus, or sphere at major radius 0 |
| cone, circle edge with the axis ⊥ plane | torus or sphere |

- Chamfers mirror this: the result is a plane or a cone.
- **Everything else is walking** on the rolling-ball residuals (4 unknowns per
  spine sample) plus B-spline approximation. Corners with unequal radii get
  Plate surfaces.

**Real guarantee.** The closed-form cases are exact up to f64. Eligibility is
decided by 1e-12 and 1e-7 tests, and the walking path has no certificate.

**The failure API is better than the Boolean's.** It reports
`FaultyContour`/`FaultyVertex` and `StripeStatus` (`WalkingFailure`,
`StartsolFailure`, `TwistedSurface`). But it is unreliable: #1371 reports
success on a self-intersecting result.

**Where it breaks:**

- #1177: a fillet cannot consume a whole face (the full round).
- #1495: a non-terminating `int` counter loop.
- Offsets: "simple" offsets grow tolerances to cover gaps.

### 3.7 Rounding exact results back to floats

**Valque and Lazard 2025** is the best available method (DOCUMENTED,
[note](sources/valque-lazard-iterative-snap-rounding-for-triangle-soup-auto.md)).

**The loop:**

1. Find properly intersecting triangle pairs exactly.
2. Snap their vertices, plus every vertex in the same grid cell, to cell
   centres of a per-axis power-of-two grid with about 24 significant bits.
3. Re-autorefine exactly.
4. Round the new vertices to double.
5. Iterate at most 5 times. Report failure explicitly.

**Results.** It resolves all 527 hard Thingi10K models; Zhou et al. fail on 48
and iterative naive rounding on 273. It processes about 53k arrangement
vertices/s serially. Model 996816 needed a coarser grid (constant 14).

**Real guarantee.**

- If it returns `true`, the output is certified intersection-free.
- The Hausdorff distance is at most `M·2^-gs·k`.
- There is no termination proof and no topology guarantee. The output may be
  non-manifold (CGAL #9192).

**Where it breaks for wonky (INFERRED, derived in the note).**

- The method's safety margin is the 24-bit versus 53-bit gap between the snap
  grid and double output.
- With **F32 output** (binary STL) the same flip bound would need a snap
  significand of at most 3 bits. So the heuristic loses its reason to work
  unless every rounded output gets an exact post-check.
- The CGAL code appears to scale 2 bits coarser than the paper and its own doc
  string. This is INFERRED from reading, not run.

### 3.8 Tolerant B-rep semantics and interchange

**OCCT's BRep format gives exact definitions** (DOCUMENTED,
[note](sources/occt-brep-format-specification-tolerant-modeling-semantics.md)):

- vertex deviation: `max |P − V|` over representations;
- edge deviation: the one-sided Hausdorff distance over all representations;
- face deviation;
- SameParameter, SameRange, seam edges (two pcurves on one closed surface),
  degenerated edges (cone apex, sphere pole), and regularity (C0 … G2) across
  an edge.

**The discipline around them is what fails.**

- Tolerances may only grow, and there is no cap.
- Checks sample.
- Booleans do not set regularity; fillets do. Chamfer, draft and gluing
  consume it.

**A mathematical fact every exporter must handle (INFERRED, in the note).**

- An ellipse on a cylinder has the transcendental pcurve `u = t + ψ`,
  `v = v0 + γ·cos t`. No rational B-spline pcurve is exact.
- So the edge tolerance is the only place to declare that error.
- wonky's own validation shows the consequence (DOCUMENTED,
  [step-validation.md](../step-validation.md)). OCCT's STEP reader
  re-approximates a cylinder pcurve that misses the exact 3D ellipse by about
  1.49e-4 mm, yet keeps the edge tolerance at 1e-7 mm.

### 3.9 Persistent naming

**FreeCAD 1.0's element map** is the reference design (DOCUMENTED,
[note](sources/freecad-topological-naming-realthunder-s-element-map-algorit.md)).

- **How names are built:**
  - from OCCT's Modified/Generated history;
  - the lowest-dimension, lowest-tag source becomes the prefix, plus up to 4
    extra sources;
  - then fallback passes from upper to lower (`;:U`) and from lower to upper
    (`;:L`), and a delayed round.
- **Stable caps.** A coplanar or parallel generated face gets a fixed index, so
  extrude caps survive adding holes.
- **Resolver policy:** detect a broken reference, propose a candidate, and
  auto-resolve only with high confidence. Fillets deliberately never
  auto-resolve.
- **Measured cost:** about +30 % recompute time (40 s to 52 s) and +27 % file
  size.
- **Weak spots:**
  - a random `;D` duplicate suffix in release builds;
  - index order that follows OCCT's report order;
  - a fixed 1e-7 coplanarity tolerance;
  - 27 open "Toponaming" issues two years after release.

### 3.10 What is actually guaranteed, in one table

| guarantee | who has it | condition |
|---|---|---|
| every predicate decided exactly | Nef_3, ESOLID, CGAL PMP (predicates), GTE with exact types | Nef: planar only. ESOLID: non-degenerate input only. CGAL PMP: embedding rounded afterwards |
| degeneracies handled, not refused | Nef_3 only | polyhedra; exact rational constructions |
| no root lost | IPP (Patrikalakis) | rounded intervals plus an exact or interval formulation; boxes may hold clusters |
| rounded output free of self-intersection | Valque-Lazard, CGAL autorefine with snap | only when it returns `true`; no termination proof |
| certified deviation of the representation | nobody in the survey; OCCT *defines* it, but samples and grows it | wonky's recover certifies the boundary deviation per edge (MEASURED maximum 0.37 of the bound, plan §2.2) |
| explicit failure instead of a silent wrong answer | CGAL PMP (per-operation flags), Valque-Lazard (flag), OCCT fillets (API, unreliable), SISL (partial-curve status) | OCCT Booleans, GoTools and BRL-CAD fail silently in documented cases |

## 4. War stories and anti-patterns

### 4.1 Silent success: "IsDone, but wrong"

- **OCCT #1496.** Common of two identical swept solids returns an empty or
  negative volume with `IsDone() == true`. The trigger is a
  cylinder-torus-cylinder G1 junction.
- **OCCT #1543 (open).** A Cut removes nothing, depending only on where the
  tool crosses relative to the cylinder seam. Rotating the cylinder by 90°
  fixes it. Fuzzy, OBB, parallel and non-destructive modes do not help.
- **OCCT #1371.** A fillet reports 0 faulty contours and returns a
  self-intersecting solid. Reporter: "The silent success is the damaging part."
- **GoTools.** `catch (...) { //THROW("Failed intersecting the two spline
  surfaces."); }` in `BoundedUtils.C` line 778. `handleComplexity()` writes a
  file and returns.
- **SISL.** The marcher's local tolerance `aepsge2` grows silently when an
  iterate leaves the parameter domain.
- **SolveSpace.** Newton non-convergence is logged (`dbp`) and computation
  continues.

(All DOCUMENTED in the notes.) **Lesson for wonky:** every stage returns a
typed outcome, and "could not decide" is an outcome.

### 4.2 Tolerance as the repair mechanism

- **OCCT RepeatIntersection** is a fixed-point loop that exists only because
  vertex tolerances grew in the pass before (GFA note).
- **OCCT PR #1176** made plane/cylinder parallelism depend on the *face height*
  `H`. The fix returns lines deliberately not parallel to the axis. It is a
  tolerance device, not a geometric fact (ImpImp note).
- **OCCT #1541.** `UnifySameDomain` breaks a valid shape: a 180° phase flip
  between the 3D circle and the rebuilt pcurve inflates a vertex tolerance to
  the circle's diameter (healing note).
- **The GFA spec's own example.** Near-coincident edges with a 1e-6 deviation
  against a 1e-7 tolerance give 3 spurious vertices and 8 edges instead of a
  common block. The advice is to raise tolerances (GFA note).

### 4.3 Tangency and coincidence

- **SolveSpace #1268 (open since 2022).** "NURBS failure on simple union of
  cube and cylinder." The only workaround is "changing the dimensions ... so
  they no longer meet tangentially".
- **SolveSpace #1291.** A fillet-shaped cut took 4 years and 5 independent
  defect fixes. The fix for grazing tangency then broke the opposite face
  (#1751 to #1760).
- **SolveSpace #1452.** An all-90° model loses a whole face. Causes: phantom
  split points from padded coincident surfaces, and duplicate collinear
  intersection edges.
- **BRL-CAD #33.** The union of two boxes sharing a coplanar face loses
  surfaces.
- **GTE #105.** Tangent circles fail in float: a coefficient that should be
  zero computes to −7.3e-18.
- **CGAL #9497.** Cutter coordinates carrying about 1e-14 noise from double
  transforms create a non-manifold connection. Maintainer: "there is no magic
  way to resolve these tolerance issues".
- **ESOLID.** Exactness alone does not help. "ESOLID cannot be considered a
  robust system", because real parts are full of degeneracies.

### 4.4 Topology from approximations or proximity

- **SolveSpace #297.** Boolean success depends on the chord tolerance, because
  topology lives on the PWL chains.
- **Krishnamurthy et al.** Nearest-neighbour polyline assembly left 320
  single-point "polylines", which were then discarded.
- **BRL-CAD.** Split faces are classified by **one ray** with parity, and inner
  loops are ignored. Its own guide warns against using iterative solvers for
  inside/outside decisions.
- **Fornjot #993 and #1937.** Deciding whether two edges are "the same" took
  months. Coincident half-edges had to be congruent for watertight
  approximation.
- **Nef.** Geometric-equality synthesis defeated floating-point filters. The
  fix was to pair by propagated indices.

### 4.5 Exactness pitfalls

- **Nef cost.** 2-6× slower than ACIS in 2005. One exact rotation by 1e-6°
  takes 450 s. Inexact kernels "explode" (#5490). Derived algorithms still
  have open assertions (#8447, #6973).
- **GTE silently leaves the exact domain.**
  - `std::sqrt/sin/cos` overloads on `BSNumber` go through `double`.
  - `BSRational` has no GCD reduction, so sizes grow multiplicatively.
  - Zero-initializing `UIntegerFP32` limbs took 40.5 s of a 53.5 s run.
  - In February 2026, about 50 bug-fix PRs landed, several in the exact stack
    itself: #122 signed-overflow UB, #146 `BSNumber("0")` with a nonzero sign.
- **Garbage in, exact garbage out (GTE #94).** A user typed a coordinate that
  is not representable as a double. The exact answer is then correct for the
  *rounded* input.
- **ESOLID memory.** Missing reference counting and storing intermediate
  results early made memory "several megabytes on simple problems". The
  authors advise designing memory use up front.

### 4.6 Chains and rounding

- **CGAL #9455, #6481, #9282.** Chained EPICK Booleans crash or assert
  ("can only do two steps"). EPECK works "well under a second".
- **CGAL #9192.** Autorefine turns a self-touching input into a non-manifold
  output that snap rounding can no longer separate.
- **The Valque-Lazard baseline.** Rounding *every* coordinate to float after
  autorefinement fails on 42 % of models, which is worse than naive rounding.

### 4.7 Non-determinism and non-termination

- **CGAL #6363.** Debug and release builds give different output orders
  (`unordered_map` iteration).
- **FreeCAD.** `renameDuplicateElement` draws the `;D` suffix from
  `std::mt19937` seeded by `random_device`, so it is different on every run.
- **OCCT #1495.** A fillet search loops `VFirst + Δ/aDenom` over an `int` with
  an exit condition that needs more steps than an `int` can count.
- **OCCT #1385.** The argument analyzer's self-interference check has
  unbounded runtime.
- **Valque-Lazard.** No termination proof; the iteration cap converts that
  into an explicit `false`.

### 4.8 Process

- **Fornjot.** Writing all intersection tests first "was the wrong one", and
  they became dead code. A "batch kernel with no insight into intermediate
  steps" was a core mistake. The author sold "a dream" to sponsors before a
  product.
- **CADmium.** No one owned the kernel.
- **BRL-CAD.** Debug plotting was on by default until 2023 ("generating too
  many files"). The Boolean has been dormant since then.

### 4.9 Anti-pattern → wonky rule

| anti-pattern (seen in) | wonky rule it violates | what wonky does instead |
|---|---|---|
| tolerance growth, Fuzzy, RepeatIntersection (OCCT) | "approximations need explicit tolerances" | budgets are computed and capped; any increase is a recorded event or a refusal |
| reclassify near-degenerate to simpler topology (OCCT #1176, eccentricity cutoff) | "unsupported cases must fail explicitly" | exact classification; `Unresolved{IllConditioned…}` when F32x2 constructions cannot meet the bound |
| topology on a PWL or chord tolerance (SolveSpace) | exact B-rep | curves from carriers; the mesh decides topology only where certificates hold |
| single-ray parity, one-sample classification (BRL-CAD, GoTools, OCCT) | certified decisions | per-patch classification from tags plus exact or certified winding |
| proximity chaining (GPU SSI, truck welding) | provenance | connectivity from mesh adjacency and tag pairs |
| exact constructions everywhere (Nef, EPECK) | fast, Bend-shaped | exact predicates over symbolic nodes; F32x2 constructions with error bounds |
| random or order-dependent names (FreeCAD) | reproducible diffs | canonical orders from sorted provenance keys |
| silent catch-and-continue (GoTools, SISL, SolveSpace) | fail explicitly | typed refusal with entity IDs |

## 5. What wonky should take: ranked proposals

**Context.** The Boolean architecture is decided: corefine plus recover.
Steps 1 to 4 are done (plan §9). The fillet bake-off has its own candidates
(A: `fillet-kpart`, B: `fillet-boolean`, C: rolling ball, D: morphological).

**Ranking.** The proposals below do not re-open either decision. They are
ranked by expected benefit per unit of risk for *the path that already
exists*:

1. robustness of decisions the hybrid makes today;
2. then coverage of the Unresolved set;
3. then tooling.

All Bend-fit statements are INFERRED.

| rank | proposal | plugs into | size | depends on |
|---|---|---|---|---|
| R1 | exact carrier-pair classifier | recover `tangent.bend` (pre-certificate), carrier classes, curve selection; fillet A eligibility | M | existing exact path; R5 for fixed width |
| R2 | tangent vertices and the missing conics | recover `geom.bend`, body format, STEP writer; plan step 9 | S-M | R1 |
| R3 | root-caused failure corpus from the field | public regressions, R20-style acceptance, bake-off suites | S | none |
| R4 | certified intersection-curve entity for space quartics | recover, body format, STEP (B-spline plus pcurves); plan step 9 | L | R1, R5 |
| R5 | fixed-width exact tier from GTE | `kernel/robust-predicates.bend`, exact-plane `big.bend` | M | none |
| R6 | validator from BRepCheck and the Boolean argument checks, certified | `kernel/ports/curved-validate.bend`, hybrid output, STEP import | M | curve-band |
| R7 | exact-gap local refinement instead of clearance refusal | plan step 2 pre-certificate, tagged tessellation [B] | M | R1 |
| R8 | Boolean naming from tags (element map, re-derived) | `kernel/identity.bend`, `identity.mjs` | M | tags per face (exists) |
| R9 | snap-rounded, exactly checked F32 export | print-mesh and STL export | S-M | hybrid step 1 self-intersection gate |
| R10 | interchange oracles: `.brep` debug writer, SameParameter by construction | STEP and pcurve export, oracle harness | S | none |

### R1. Exact carrier-pair classifier: OCCT's decision trees as exact signs

**Idea.** For every pair of carriers from different leaves (plane, cylinder,
cone, sphere, torus), compute one typed relation by exact sign predicates on
the stored F32x2 words:

```
Disjoint{gapLowerBound}
| Transversal{curveKind}
| Tangent{line | circle | point}
| Coincident
| Unresolved{reason}
```

Examples of the predicates (INFERRED, derived from the OCCT and GTE notes):

- **Plane/cylinder:**
  - `s = n·a = 0` means the axis is parallel to the plane;
  - `n×a = 0` means the section is a circle;
  - for a parallel axis, `sign(d² − r²|n|²)` gives 2 lines, 1 tangent line,
    or none.
- **Plane/cone.** With `sin²φ` stored rationally:
  - ellipse, parabola or hyperbola from `sign((n·a)² − |n|²|a|² sin²φ)`;
  - circle if `n×a = 0`;
  - degenerate if the plane contains the apex.
- **Cylinder/cylinder:**
  - parallel axes: `a1×a2 = 0`, then squared-distance comparisons against
    `(r1 ± r2)²`;
  - coaxial;
  - Steinmetz: coplanar axes (`det(a1, a2, o2−o1) = 0`) with `r1 = r2`.
- **Coincidence:** the same plane, axis line and radius, or apex, axis and
  angle, decided exactly on the represented words.
- **Transition sign** at a point of a section curve: `T·(n2×n1)`. When it is
  zero, the case routes to the tangent machinery, never to an "Undecided"
  default.

**Sources.**

- The decision trees: OCCT `IntAna_QuadQuadGeo`, re-derived; no code
  (LGPL).
- Exact multiplicity by discriminant, and `QFNumber`: GTE (BSL).
- The tangency discriminant `b12² − b11·b22` for curved/curved contact:
  Patrikalakis §6.4 and GoTools.
- Pairing by provenance: Nef.

**Where it plugs in:**

- recover step 0, the pre-certificate in `tangent.bend`;
- step 1, carrier classes (today 1e-7 mm and 1e-10 in `1 − |cos|`);
- the curve-kind choice in `geom.bend`;
- fillet candidate A's existence and fit tests. [fillet.md](../fillet.md) §5.1
  already asks for "exact or filtered predicates with explicit undecidable".

**Bend fit.**

- Each predicate is a pure function on two face-table rows.
- The pre-certificate already runs one forked join over carrier pairs.
- The predicates have degree at most 4 (higher for torus pairs). At a fixed
  degree they have a fixed limb count, sized by R5's calculator: roughly 200
  bits for degree 4 on a 50-bit input grid (INFERRED).
- That is uniform work per pair type. Bucketing by pair type, as OCCT's
  dispatch does, gives uniform batches for Metal.

**Expected benefit.**

- Tangency and coincidence become *decisions* instead of tolerance guesses.
- Carrier unification separates into two parts:
  1. exact equality of represented carriers;
  2. an explicit, recorded snapping policy for design intent. Step 4 already
     keeps this at 2^-44.
- This removes the class of defect the hybrid gate verifier found twice: a
  unification tolerance merged a real 1e-11 mm skin (plan §7).
- It is also the prerequisite for R2, R4 and R7.

**Risk.**

- **Exact on represented words is not design intent.** A face rotated by 1e-13
  is exactly *not* coplanar. The intent layer (step 4) must stay separate and
  recorded.
- **Predicates alone do not make a coarse mesh represent sub-deviation
  topology.** R7 addresses this.
- **Cone and torus parameters need exact-friendly storage:** `sin²φ` or
  `tan φ` as a dyadic rational, not an angle.
- **Torus pairs raise the degree.**

**First acceptance test.** A table of about 30 carrier-pair fixtures built in
FeatureScript. It covers:

- a tangent plane/cylinder;
- a plane through a cone apex parallel to a generatrix;
- equal-radius crossing cylinders;
- coaxial cone/cylinder;
- internally and externally tangent cylinders;
- each of these again offset by 1e-9 mm and rotated by 2^-40 rad.

To pass:

- every exactly constructed relation gets the right label;
- every perturbed twin gets the true non-degenerate label, with a positive gap
  bound where applicable;
- results are byte-identical on JS, cpu1, cpu18 and Metal;
- `grep` finds no epsilon literal in the classifier source.

### R2. Tangent vertices and the missing conics

**Idea.** Close the conic part of the Unresolved set exactly, before any
non-conic work. Three pieces:

1. **Plane/cone hyperbolas and parabolas as exact curve types.**
   - Formulas come from OCCT's plane/cone case analysis.
   - The OCCT BRep format has parabola (record 4) and hyperbola (record 5)
     curves (DOCUMENTED, BRep-format note).
   - STEP's conic family includes both. This is INFERRED from ISO 10303-42
     and should be verified with the STEP validator before relying on it.
2. **Equal-radius cylinders with intersecting axes as two planar ellipses**
   (OCCT's Steinmetz case):
   - axes along `a1 ± a2`;
   - semi-axes `R/cos(θ/2)` and `R/sin(θ/2)`;
   - the two branch points at the ellipse vertices, which are exact
     constructions.

   Today `steinmetz-intersect` and `steinmetz-union` are refused as
   "2-carrier vertex (quartic)". The curve is not a quartic in this
   configuration.
3. **Degenerate tangent vertices** (hex nut; SolveSpace #1268). A circle
   tangent to a line in a plane meets it at the **foot point**, which is a
   rational function of the inputs.
   - Construct the point directly.
   - Verify it on all three carriers with R1's predicates, instead of Newton on
     a singular 3-carrier system.
   - The adjacent faces get a cusp (zero-angle) corner, and the two tangent
     faces carry a G1 regularity mark.

**Where it plugs in:**

- recover `geom.bend` curve table;
- the body format and the STEP writer;
- the hybrid plan's step 9, "close the Unresolved set" (ordered by FDM value:
  hex nuts and chamfered holes are everyday FDM parts).

**Bend fit.** Closed forms per pair, with no iteration.

**Expected benefit.**

- On the recover corpus, 3 of the 4 Unresolved cases (`hex-nut` and the two
  Steinmetz cases) become candidates for exact STEP. Only `pipe-tee` (a true
  quartic) remains, which is R4.
- The #1268 class moves from "refuse" to "decide".
- (MEASURED baseline in [proto-recover.md](../proto-recover.md) corpus table;
  the benefit itself is INFERRED.)

**Risk.**

- The mesh Boolean near a tangent vertex may have the wrong local face
  structure (see open question Q2).
- STEP consumers may re-approximate hyperbola pcurves on the cone (compare
  [step-validation.md](../step-validation.md)).
- Hyperbolas are unbounded, so trimming must be explicit.

**First acceptance test.**

- `hex-nut`, `steinmetz-intersect` and `steinmetz-union` return exact bodies:
  - the strict STEP validator passes;
  - the volume matches a closed form (for the perpendicular equal-radius
    intersection, `16r³/3`) to 1e-12 relative;
  - a FeatureScript recreation of SolveSpace #1268 (a cube and a cylinder of
    the same size from one sketch plane) is exact.
- A new adversarial twin of each, offset by 1e-9 mm, is refused by name or is
  exact. It is never wrong.

### R3. A root-caused failure corpus from the field

**Idea.** Recreate the public, root-caused failures of the surveyed kernels as
FeatureScript fixtures. Each fixture records:

- the upstream URL;
- the root cause;
- the expected wonky outcome: exact, a named Unresolved, or a named
  non-manifold refusal;
- an oracle: a closed form, Onshape, or OCCT where OCCT is known to be right.

Do not copy GPL/AGPL test data. Rebuild the scenario from its description
(SolveSpace note, CGAL PMP note). Sources:

- **SolveSpace:**
  - #1268: cube and cylinder, tangent union;
  - #1291: tangent fillet-shaped cut;
  - #1452: an all-90° model with coincident edge-on-edge faces;
  - #1091: countersunk coaxial cone/cylinder stacks;
  - #1124: extrude and revolve from the same circle;
  - the `test/group/boolean_*` scenarios: `coplanar_union`, `knife_edge`,
    `tangent_crossing`, `tangent_edge`, `tangent_fillet`.
- **OCCT:**
  - #245: a Cut sharing an edge with its argument;
  - #1041: a Fuse of rotated copies;
  - #1543: seam position. Use a cylinder cut by a tool crossing the seam at
    several angles, since wonky has no helical sweep;
  - the GFA spec's fuzzy and gluing examples;
  - the six frozen cases already in
    [public-boolean-regressions.md](../public-boolean-regressions.md).
- **BRL-CAD:** #33 (a coplanar box union) and #34 (two spheres and a box).
- **CGAL:** the named pairs in `test_corefinement_bool_op.cmd`
  (`cube_on_cube_edge`, `cube_on_cube_corner`, `edge_tangent_to_cube`,
  `coplanar_with_cube*`, star tangencies). Their per-operation manifold
  feasibility flags serve as the oracle.
- **ESOLID:** the Table 4 series of two cylinders with shrinking
  interpenetration. It also feeds R5's bit measurements.
- **Patrikalakis:** Example 5.8.4, the Viviani sphere/cylinder curve with a
  singular point.
- **Valque-Lazard:** the rotated-cubes chain benchmark (count until failure).
- **Nef:** ROTCYLINDER at rotation angles down to 1e-7°.

**Where it plugs in:**

- `fixtures/public-boolean-regressions/` and its manifest;
- the R20-style acceptance sets;
- the adversarial suites under `out/bakeoff/judge2/suites/`.

**Bend fit.** Not applicable (test data).

**Expected benefit.**

- The Fornjot lesson: drive the work from real failing models, not from a full
  surface-pair matrix.
- SolveSpace's tracker is an ordered forecast of wonky's next failures on this
  path.
- It is cheap. Most fixtures are a few FeatureScript lines.

**Risk.**

- Oracles disagree on degenerate cases. The plan's "oracles disagree" bucket
  must be used.
- Some scenarios need operations wonky lacks (sweeps, lofts). Record them as
  pending, not as passes.

**First acceptance test.**

- At least 25 fixtures are committed with machine-checked expected outcomes.
- The suite runs on four targets with zero wrong `ok` answers.
- Every refusal names a reason class that matches the documented root cause.

### R4. A certified intersection-curve entity for space quartics

**Idea.** Add one curve type for non-conic carrier pairs. It stores:

1. the two carriers;
2. the branch index;
3. an exact parameterization;
4. a certified approximation with its Hausdorff bound;
5. both pcurves.

The parameterizations:

- **Cylinder/cylinder:** OCCT's closed form, `U2 = FI2 ± acos(B·cos(U1 − FI1)
  + C)`, with V1 and V2 linear in sin and cos.
- **Cylinder or cone against another quadric** (off-axis sphere/cylinder,
  Viviani): `A(θ)v² + B(θ)v + C(θ) = 0` over the cylinder or cone angle.

Supporting pieces:

- **Branch points** are where the acos argument reaches ±1 (turning points in
  Patrikalakis's terms). They are isolated exactly with `QFNumber`
  comparisons (R5).
- **Branch count** is certified from these points, not taken from the mesh.
  Compare it with corefine's tagged polylines as a cross-check.
- **Near a branch point** the construction is ill-conditioned. The ImpImp note
  gives the error estimate `aTol0/sqrt(δ(2−δ))`. Return
  `Unresolved{IllConditionedBranch}` when the F32x2 bound cannot meet τ.

**Sources:**

- OCCT's closed forms (re-derived);
- truck's `IntersectionCurve` representation (surface pair plus polyline
  leader plus Newton; Apache-2.0, portable);
- SISL's two-level contract: topology first, then a curve with pcurves and a
  partial-failure status;
- ESOLID's rule to keep curves implicit per (u,v) domain and glue by
  association.

**Where it plugs in:**

- recover's curve table and the body format;
- STEP export as a B-spline 3D curve plus B-spline pcurves with a stated
  deviation, in the same style as `step-cylinder-pcurves.bend`;
- plan step 9 (`pipe-tee`, `x-rod-cross-hole`, the off-axis sphere/cylinder
  fixtures).

**Bend fit.**

- Sampling U1 or θ is a uniform map, suitable for GPU batches.
- The per-segment interval bound is an F32x2 interval evaluation of the closed
  form.
- Chaining the segments is a scan or tree merge, not sequential marching.

**Expected benefit.** It closes the last common FDM quartic: cross-drilled
holes and pin T-joints.

**Risk.**

- It is the largest item here:
  - a format change;
  - an exporter change;
  - derivation errors in the closed forms;
  - certified approximation near branch points.
- OCCT readers may re-approximate pcurves again (step-validation evidence).

**First acceptance test.**

- `pipe-tee` and `x-rod-cross-hole` become exact bodies:
  - each curve carries a certified bound ≤ τ;
  - STEP passes the strict validator;
  - the volume differs from OCCT by less than area × bound.
- A sweep of radius ratios 1 ± 2^-k (k = 4 … 40) is either certified or
  refused as `IllConditionedBranch`, and never has wrong topology.

### R5. A fixed-width exact tier, ported from GTE (BSL-1.0)

**Idea.** Transliterate GTE's arithmetic *model*, keeping the BSL notice, into
Bend. Six pieces:

1. **A build-time bit-budget calculator** from `BSPrecision`'s rules. Declared
   input ranges and predicate degree give a limb count N per predicate.
2. **Fixed-N integers with 16-bit limbs in U32 words**, in the
   `UIntegerFP32<N>` style, alongside today's dynamic base-4096 lists.
3. **`QFNumber` comparisons for `a + b√d`**, to order hits along edges and
   compare tangent points without evaluating a square root.
4. **Discriminant-based root multiplicity**, which is what tangency means.
5. **Directed conversion back to F32x2** (`Convert` with upward and downward
   rounding) to build conservative boxes.
6. **An exact orient3d**. [robust-predicates.md](../robust-predicates.md)
   states there is none today.

**Where it plugs in:**

- `kernel/robust-predicates.bend`;
- `kernel/proto/exact-plane/big.bend` (one limb model for both);
- R1, R2, R4 and R9.

**Bend fit.** This is the reason to do it:

- a fixed N gives loop bounds without data dependence, hence uniform Metal
  batches;
- 16-bit limbs avoid GTE's `uint64_t` carries;
- no allocation. GTE's own measurement shows zero-initializing limbs took
  40.5 s of 53.5 s, a warning against per-call setup.

**Expected benefit.**

- Predictable cost and documented bit budgets.
- Predicate batches become a real candidate for Metal. None of the current
  kernels pays on Metal (plan §6).

**Risk.**

- **Worst-case budgets explode** when inputs span the full F32 exponent range
  (554 bits for a float 2×2 determinant). wonky needs an input-grid policy:
  a declared model extent and resolution. Where that fails, an
  exponent-aligned `BSNumber` form.
- **Exact stacks have bugs too** (GTE's February 2026 fixes). Property tests
  against the dynamic path are mandatory.

**First acceptance test.**

- The calculator reproduces GTE's documented budgets:
  - 554, 300 and 48 bits for `x·y − z·w`;
  - 27 words for float orient3d;
  - the 325-bit bound of `big.bend`.
- The fixed-N and dynamic paths agree on 10^6 random and 10^4 near-degenerate
  inputs, byte-identically on all four targets.
- The Metal build has no data-dependent loop bounds.

### R6. A validator specification from BRepCheck and the Boolean argument checks, made certified

**Idea.**

- Mirror the applicable subset of `BRepCheck`'s 37 status codes as typed
  findings with entity IDs.
- Add the two checks from `BOPAlgo_ArgumentAnalyzer` that BRepCheck lacks:
  - self-interference: unconnected entities within their combined allowance;
  - micro edges.
- Run it before and after every Boolean and fillet, and on STEP import.
- Make every check exact or certified:

  | check class | how |
  |---|---|
  | combinatorial: edge-use parity, wire closure, shell orientation, connectivity, Euler | sort and group-by over U32 IDs |
  | curve-on-surface residuals | analytic interval bounds, extending `curve-band.bend`, instead of 23 samples or particle swarm |
  | wire and shell nesting | exact orientation predicates |

- Never heal. Any allowance increase is a recorded event.

**Where it plugs in:**

- `kernel/ports/curved-validate.bend` (`audit`);
- an independent re-check of recover's certificates;
- the future STEP importer;
- viewer highlighting and JSON findings for LLM authors.

**Bend fit.** Excellent:

- maps, sorts and reductions;
- connectivity by label propagation;
- the BVH self-join already exists from hybrid step 1.

**Expected benefit.**

- An oracle that does not share code with recover.
- It catches false "valid" results of the #1315 kind.
- It avoids the sampling cost OCCT pays (#1372).

**Risk.**

- It overlaps with recover's certificates. Keep it independent on purpose.
- Curve-on-surface bounds for spheres and tori need new interval code.

**First acceptance test.**

- One invalid fixture per applicable status code, each rejected with the right
  code and entity ID:
  - missing seam;
  - reversed wire;
  - self-intersecting wire;
  - free edge;
  - multi-connexity;
  - enclosed region;
  - bad shell orientation;
  - micro edge;
  - the GFA spec's two self-interference examples.
- All 32 exact corpus outputs pass with zero findings.
- Validation time is at most 10 % of the Boolean.

### R7. Exact-gap local refinement instead of clearance refusal

**Idea.** Today the pre-certificate refuses a pair of leaf faces that come
within `h + h' + 1e-6` mm without a decided crossing.

- When R1 proves such a pair **Disjoint with gap lower bound g > 0**, or
  Transversal with separated curves, re-tessellate *only those faces* with
  deviation below g/3.
- Then rerun, for a bounded number of rounds.
- Refuse by name only below a declared floor (for example 1e-6 mm).

This is ESOLID's "compute more only when the filter fails", applied to
tessellation. [proto-recover.md](../proto-recover.md) "Limitations" states the
need: "a hybrid that must accept them has to tessellate finer or decide such
contacts exactly".

**Where it plugs in:**

- plan step 2 (the pre-certificate);
- stage [B], which then needs a per-face deviation instead of "one deviation
  per operation".

**Bend fit.** Re-tessellation is a per-face map, and the rounds are bounded.

**Expected benefit.** Refusals that are about tolerance, not topology, become
exact results where the exact CSG is valid. Examples from the recover extra
suite: `boss pokes 0.005`, `bore breaks top 0.005`, `sphere flat 0.005 deep`,
and 1 µm walls.

**Risk.**

- **Triangle count grows** as the deviation shrinks.
- **Mixed deviations must stay watertight** on shared edges. This is Fornjot's
  #1937 lesson: coincident half-edges share one approximation.
- **Per-face evidence changes the operation-evidence model.**

**First acceptance test.**

- The 10 "refused, tolerance-level topology" extra cases either become exact,
  with volume matching the closed form or OCCT to 1e-9 relative, or are
  refused naming a gap below the floor.
- There are zero wrong `ok` answers on the 216 adversarial cases.
- Corpus runtime is at most 1.1× today's; refinement runs only where
  triggered.

### R8. Boolean naming from tags: the element map, re-derived

**Idea.** Re-implement FreeCAD's naming *concepts* on wonky's provenance. Do
not use its string grammar.

- **Source keys.** corefine's triangle tags and recover's per-face `tag`
  already form the Modified/Generated relation.
- **Names.** For each result element, sort `(dimension, source key)`. Take the
  first as the prefix and keep at most k further sources.
- **Fallback.** Name edges from faces and faces from edges in bounded rounds.
- **Fixed roles.** Coplanar generated faces keep fixed roles, detected exactly
  on the carriers.
- **Duplicates.** Break them by a canonical order, such as the ordinal along
  the source edge's parameter. Where none exists, return `revision-local`.
- **Resolver.** Detect a broken reference, propose a candidate, and
  auto-resolve only on a unique match.
- **Readable roles.** Expose semantic role names next to the opaque keys for
  LLM authors.

**Where it plugs in.** Boolean outputs in `kernel/identity.bend` are
currently stamped `unsupported-split-merge-correspondence`
([topology-identity.md](../topology-identity.md)).

**Bend fit.** A map plus a sort over U32 keys, and fixpoint rounds with an
immutable table per round.

**Further sources (cross-links).**

- vcad's `vcad-kernel-naming` fails closed (`Resolved | Ambiguous | Lost`).
  But it re-derives provenance in a post-pass, because its Boolean throws the
  result→input face map away.
- vcad's quantized-centroid ordinals are unstable (INFERRED in its note).
- BREP.io has a normative face-tracking specification, worth adapting as test
  invariants.

(DOCUMENTED, [vcad note](sources/vcad-ecto-vcad-kernel-booleans-kernel-naming-torture-corpus.md),
[BREP.io note](sources/brep-io.md).)

**Expected benefit.** Fillet edge references and sketch attachments survive
Boolean edits. Among the surveyed open kernels, none has naming that is both
provenance-carried *through* the Boolean and deterministic by design:

- FreeCAD uses random duplicate suffixes;
- vcad retrofits determinism case by case.

(INFERRED from the notes.)

**Risk.**

- FreeCAD's measured +30 % recompute is a warning. Keep names structural and
  hashed, not string-concatenated.
- Ambiguity must stay a refusal.

**First acceptance test.** The wiki's regressions, recreated:

1. adding a hole to an extrude sketch keeps the cap names;
2. an edge split by a Boolean gives both halves deterministic derived names;
3. reordering independent features keeps names;
4. identical names on all four targets, with no random component.

### R9. Snap-rounded, exactly checked F32 export

**Idea.**

1. Round recover's exact output, or the print mesh, to F32 STL coordinates.
2. Run the exact self-intersection check on the rounded coordinates. They are
   exact dyadic rationals, and the BVH self-join gate from hybrid step 1 can
   be reused.
3. On failure, apply Valque-Lazard:
   - snap the offending vertices and every vertex in the same grid cell to an
     FDM grid (for example 2^-10 mm, which is exactly representable in F32 on a
     ±256 mm bed);
   - re-refine exactly;
   - iterate at most 5 times;
   - report the Hausdorff bound `k × half-cell × √3`.
4. Otherwise refuse, or suggest 3MF.

This is the rounding-validation half of the FDM chapter's certified export
([fdm-geometry.md](fdm-geometry.md) R6).

**Where it plugs in:** print-mesh and STL export, and the repair of imported
meshes (the scan workflow).

**Bend fit.** Maps, sort-unique and the existing broad phase. Only the exact
re-triangulation is irregular, so it runs as CPU fork-join.

**Expected benefit.** It closes the F32 gap that makes the paper's success
argument inapplicable (section 3.7). Exported STL is certified free of
self-intersections.

**Risk.**

- There is no termination proof; the cap and a named failure cover it.
- Snapping can collapse thin features, so the Hausdorff bound must stay below
  the FDM tolerance.

**First acceptance test.**

- All exact corpus and adversarial outputs export with a passing exact
  post-check.
- About 10 non-trivial Thingi10K IDs from the paper (used locally only) are
  repaired within the stated bound.
- The rotated-cubes count is reported.

### R10. Interchange oracles: a `.brep` debug writer and SameParameter by construction

**Idea.** Three small pieces:

1. **A `.brep` text writer.** The format is interface facts. OCP can read it
   with `BRepTools` and run `BRepCheck_Analyzer` and `BRepAlgoAPI_Check`
   (including exact curve-on-surface) *without* the STEP reader.
   [step-validation.md](../step-validation.md) documents that the STEP reader
   re-approximates cylinder pcurves by about 1.49e-4 mm.
2. **Parameterize plane/cylinder ellipses in the principal frame.**
   `E(t) = o + (d0/s)a + cos t·(rX' − (rk/s)a) + sin t·(rY')`, with
   `u = t + ψ` and `v = (d0 − rk cos t)/s` on the cylinder. The 3D curve and
   both pcurves are then SameParameter and SameRange exactly, and only the
   cylinder pcurve needs a certified B-spline (derivation in the BRep-format
   note).
3. **Write regularity (G1)** on tangent edges in `.brep` (fillets, R2's tangent
   vertices).

**Where it plugs in:** the STEP and pcurve writers, and the oracle harness.

**Bend fit.** Serialization only.

**Expected benefit.** An oracle channel free of reader artifacts, and pcurve
error budgets computed against an exact target.

**Risk.** Low. OCCT is used only as an external oracle, never as a backend.

**First acceptance test.** The 32 exact corpus outputs, written as `.brep` and
read by OCP:

- `BRepCheck_Analyzer` reports them valid;
- `BRepAlgoAPI_Check` finds no self-interference;
- the exact CurveOnSurface deviation is at most the declared edge bound.

### 5.11 Inputs for the fillet bake-off (already planned; no new proposal)

[fillet.md](../fillet.md) §5 already adopts OCCT's closed-form idea for
candidate A and names the full round as a topology change. This chapter's
sources add four concrete items for A and C:

- **The exact eligibility table** from `ChFi3d_KParticular` (section 3.6),
  with R1's predicates for the "fits" tests: concave `R < r`, and `R` against
  face widths.
- **OCCT's failure vocabulary as a starting enum:**
  - `FaultyContour`/`FaultyVertex`;
  - `WalkingFailure`, `StartsolFailure`, `TwistedSurface`;
  - `BRepOffset_Error` for offsets (`C0Geometry`, `MixedConnectivity`,
    `CannotTrimEdges`, …).

  Unlike OCCT, the statuses must be honest (#1371).
- **For candidate C, the rolling-ball residual `E1..E4`** (4 unknowns per
  spine sample). It is uniform per sample. Replace sequential continuation
  with fixed-t solves plus a certified interpolant (INFERRED).
- **Report tangent-chain propagation explicitly** in the result, so an LLM can
  check intent. OCCT propagates silently.

### 5.12 Anti-proposals

- **Do not port** OCCT's tolerance growth, Fuzzy mode, RepeatIntersection,
  eccentricity cutoffs or height-dependent parallelism.
- **Do not let topology** depend on a chord tolerance (SolveSpace) or on
  proximity chaining (GPU SSI, truck welding).
- **Do not use** single-ray parity or one-sample classification without exact
  predicates (BRL-CAD, GoTools).
- **Do not convert** planes, cylinders and cones to splines for intersection
  (the GoTools and SISL production path).
- **Do not build** exact rational constructions everywhere (Nef, EPECK).
  Use exact predicates on symbolic nodes and F32x2 constructions with bounds.
- **Do not build** a general IPP or marching SSI engine before a fillet or
  freeform face needs it. Fornjot's intersection-tests-first became dead code.
- **Do not transliterate** GPL, AGPL, LGPL or non-commercial code, and settle
  the existing GPL and LGPL ports (section 1.5).
- **Do not introduce** random or report-order-dependent naming (FreeCAD).

## 6. Open questions worth a prototype

1. **Q1. What limb counts do real near-tangencies need on F32x2 inputs?**
   - Instrument the dynamic exact path on the corpus and on an ESOLID-style
     series: two cylinders whose interpenetration shrinks by 2^-k.
   - Compare with R5's static budget.
   - ESOLID saw up to 141 bits for rational inputs. It is unknown what F32x2
     dyadic inputs on an FDM-sized grid need.
2. **Q2. Can corefine's tagged mesh give the right local face structure at an
   exactly tangent vertex, or must recover build cusp faces analytically?**
   - Prototype on #1268, `hex-nut` and a tangent slot end.
   - Measure where the mesh topology and R1's exact relation disagree.
3. **Q3. Is F32x2 evaluation of the cylinder/cylinder closed form with interval
   bounds enough near branch points?**
   - Sweep the radius ratio 1 ± 2^-k with crossing axes offset by 2^-j.
   - Report where `IllConditionedBranch` must trigger, and whether
     `QFNumber`-isolated branch points move that frontier.
4. **Q4. Can a Nef-style vertex-local overlay with a second-order tie-break be
   an independent oracle for degenerate vertices of plane/cylinder/cone
   solids?**
   - The first-order overlay uses tangent planes as great circles. The
     tie-break is the curvature sign.
   - Run it against corefine plus recover on CGAL's feasibility cases
     (`cube_on_cube_edge` …) and on R3's tangent fixtures.
5. **Q5. How often does rounding recover's exact output to F32 create
   self-intersections, and does a coarse FDM grid make Valque-Lazard converge
   in 1 or 2 iterations?**
   - Measure on the corpus plus the rotated-cubes chain.
   - Report the Hausdorff bound per case.
6. **Q6. How many face and edge references survive parametric edits with
   tag-derived names (R8), compared with today's revision-local identities?**
   Measure on the corpus families with fillet edge lists.
7. **Q7. Is SolveSpace's directrix projection worth having for extruded
   non-circular profiles?** It gives an exact rational plane ∩ extrusion curve
   with no conic case analysis. It becomes relevant once extruded splines or
   imported curves reach the Boolean (fillet.md lists B-spline edges in 2
   families).

## 7. Catalog of the remaining sources

These are catalog-only (not deep-read). Metadata comes from
`gh api repos/...` and `.../commits?per_page=1` on 2026-09-24 (DOCUMENTED)
unless marked **(sweep)**. "Priority" is the scout's (3 high, 1 low).

| name | kind | URL | licence | activity (2026-09-24) | one line | relevance for wonky | priority |
|---|---|---|---|---|---|---|---|
| verb | library (Haxe/JS NURBS) | https://github.com/pboyer/verb | MIT | 815★, last commit 2025-04-02; effectively abandoned | SSI = tessellate both surfaces, intersect meshes, Newton-refine onto both surfaces, fit a cubic | a few-hundred-line toy of the hybrid's idea with no topology or certificates; a readable reference for R4's refinement step | 3 |
| IRIT (Gershon Elber, Technion) | research modeler | https://gershon.cs.technion.ac.il/irit/ | non-commercial / academic (sweep) | maintained (sweep) | trimmed NURBS, trivariates, a multivariate constraint solver used by many SSI and bisector papers | subdivision solvers with uniform, balanced work shapes; read the papers, never the code | 3 |
| Christoph Hoffmann, "How Solid Is Solid Modeling?" (1996) | paper | https://www.cs.purdue.edu/cgvlab/www/resources/papers/Hoffmann-Workshop_on_App_Comp_geo-1996-How_SolidIs_Solid_Modeling.pdf | academic | historical | unsolved B-rep problems: robustness, blend semantics, order dependence, naming ambiguity | the background argument for R8's refusal policy and for fillet-corner semantics being underspecified | 3 |
| curvo | Rust NURBS library | https://github.com/mattatz/curvo | MIT | 213★, last commit 2026-06-25 | closest point, curve-curve and curve-surface intersection, 2D Booleans of closed NURBS curves | a permissive reference if wonky ever needs 2D region Booleans on spline profiles | 2 |
| NURBS-Python (geomdl) | Python NURBS library | https://github.com/orbingol/NURBS-Python | MIT | 766★, last commit 2025-05-24 | textbook implementations of The NURBS Book algorithms | the clearest readable source for B-spline pcurve fitting in STEP export | 2 |
| tinyspline | C NURBS library with bindings | https://github.com/msteinbeck/tinyspline | MIT | 1,352★, last commit 2024-04-11 | small B-spline and NURBS curves and surfaces | evaluation and knot-insertion reference; nothing Boolean | 2 |
| openNURBS | C++ 3dm toolkit | https://github.com/mcneel/opennurbs | McNeel openNURBS licence (permissive; GitHub reports NOASSERTION) | 563★, pushed 2026-09-15 | Rhino file I/O and the NURBS/B-rep data structures under BRL-CAD's Boolean | its `IsCylinder`/`IsSphere` hypothesize-and-verify recognition is permissively licensed (BRL-CAD note); useful for STEP-import recognition of freeform faces | 2 |
| Dune 3D | parametric CAD application | https://github.com/dune3d/dune3d | GPL-3.0 | 2,090★, pushed 2026-09-06 | SolveSpace's solver plus OCCT solids | evidence that new open CAD applications still choose OCCT; nothing to port | 2 |
| ESP / EGADS (MIT ACDL) | geometry API over OCCT | https://acdl.mit.edu/ESP/ | LGPL-2.1 (EGADS) (sweep) | maintained (sweep); no canonical GitHub repo found | a thin, stable C API over OCCT plus watertight tessellation for analysis meshes | an API-design reference for a stable, small kernel surface; OCCT-bound | 2 |
| tinynurbs | header-only C++ NURBS evaluation | https://github.com/pradeep-pyro/tinynurbs | BSD-3-Clause | 512★, last commit 2023-05-28 | NURBS curve and surface evaluation with glm | nothing beyond tinyspline or geomdl | 1 |
| cadcore and other 2026 Rust micro-kernels | small kernels | https://github.com/YATSKOVSKYI/cadcore ; https://github.com/lzpel/cadrum | cadcore MIT; cadrum MIT | cadcore 42★, pushed 2026-08-22; cadrum 60★, pushed 2026-09-13 (an OCCT wrapper, not a kernel); `neco-brep` not found on GitHub (sweep says MIT) | analytic B-rep plus STEP AP203 (cadcore) | watch-list only: the same "LLM-era analytic-first" pattern as vcad and remus, robustness unproven | 1 |

**Deep-read notes of neighbouring chapters, relevant here:**

- **Other kernels:** truck, vcad, remus, BREP.io, CADmium, monstertruck and
  OpenSolid (section 2, second table).
- **SSI and Boolean theory:**
  - [qi-quadric-intersection-library-loria-gamble.md](sources/qi-quadric-intersection-library-loria-gamble.md): exact quadric pencils, the natural partner to R4;
  - [piegl-1989-geometric-method-of-intersecting-natural-quadrics.md](sources/piegl-1989-geometric-method-of-intersecting-natural-quadrics.md);
  - [miller-goldman-1995-geometric-algorithms-for-detecting-and-c.md](sources/miller-goldman-1995-geometric-algorithms-for-detecting-and-c.md);
  - [shene-johnstone-1994-on-the-lower-degree-intersections-of-tw.md](sources/shene-johnstone-1994-on-the-lower-degree-intersections-of-tw.md).
- **Mesh Booleans behind the hybrid:**
  - [manifold-elalish-manifold.md](sources/manifold-elalish-manifold.md);
  - [ember-exact-mesh-booleans-via-efficient-robust-local-arrange.md](sources/ember-exact-mesh-booleans-via-efficient-robust-local-arrange.md);
  - [cgal-polygon-mesh-processing-corefinement-booleans.md](sources/cgal-polygon-mesh-processing-corefinement-booleans.md).
