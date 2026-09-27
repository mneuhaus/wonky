# Experimental, abandoned, hobby and brand-new kernels (2015-2026)

Chapter of the wonky research knowledge base, 2026-09-24. English.

**Status and method.**

- **Deep reads.** This chapter rests on 18 deep-read source notes (section 2):
  the 17 notes of this topic plus the Fornjot shutdown note. All of them were
  re-read in full for this chapter. Notes that belong to other chapters
  (Manifold, Truck, monstertruck, Levy, EMBER, Zhou 2016) are used only for
  cross-links.
- **Publish-first step.** None of this topic's 17 slugs had a Codex JSON in
  `tmp/research/notes/`, and all 17 notes already existed in
  `docs/research/sources/`. Nothing had to be published.
- **Checked against wonky's own state (DOCUMENTED, local files):**
  - [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md): decision,
    pipeline, defects and the status of steps 1 to 13 on 2026-09-24;
  - [../proto-corefine.md](../proto-corefine.md) and
    [../proto-recover.md](../proto-recover.md): algorithms, the sliver pass,
    the Unresolved set;
  - [../bakeoff.md](../bakeoff.md): harness, grading, arbitration, known
    harness limitations;
  - [../fillet.md](../fillet.md) §5: the fillet bake-off candidates A to D;
  - [../native-bridge.md](../native-bridge.md) (FP contraction flags),
    [../topology-identity.md](../topology-identity.md) (identity matching),
    `kernel/tessellate.bend` (arc sampling), `src/errors.mjs` (refusal type),
    ../development record.md.
- **Metadata.** `gh api` on 2026-09-24 for the 20 catalog-only repositories
  (section 7). The Ondsel post was downloaded to
  `tmp/research/catalog-fringe/ondsel-goodbye.html`. Figures for deep-read
  repositories come from their notes (dated 2026-09-22 to 2026-09-24).
- **No builds, no test runs.** A CPU benchmark is running on this machine.
- **Sibling chapter.** [oss-brep-kernels.md](oss-brep-kernels.md) ranks
  proposals R1 to R10 (exact carrier-pair classifier, tangent vertices and
  conics, space-quartic curve entity, GTE fixed-width tier, validator, naming
  element map, snap-rounded export, ...). This chapter does not repeat them.
  Where a fringe source strengthens one of them, the proposal says so.

**Labels.**

- **DOCUMENTED:** a primary source, linked here or in the linked note.
- **MEASURED:** a wonky run, reported in a linked wonky document.
- **INFERRED:** my reasoning from that evidence.
- **HEARSAY:** secondhand, or a project's own unreproduced self-report.

**Corrections to the scout's landscape overview.** Found while checking the
notes and wonky's own documents.

1. **The Boolean bake-off is no longer running.** Judge round 2 decided it on
   2026-09-23: production is **corefine** (a Bend port of Manifold's Boolean3
   over F32x2 Reals, tagged) plus **recover** (exact B-rep recovery from the
   tags). Plan steps 1 to 4 are committed, step 5 (promotion to
   `kernel/hybrid/`) is done but uncommitted, and step 7 made the hybrid the
   default last arm of `src/boolean.mjs` (uncommitted, R20 gate)
   (DOCUMENTED, [hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §8, §9).
   The proposals in section 5 therefore plug into the remaining plan steps
   (6, 8, 9, 11 to 13), the harness, and the running fillet bake-off.
2. **"Nobody treats analytic recovery from the tagged mesh as the primary
   route" holds, and wonky already does it.** BREP.io keeps analytic intent
   as side-car metadata for dimensions only; Fornjot's tag-for-export idea
   (#2118) was "a bit hand-wavy" and never built; vcad's `QuadricCtx` only
   re-projects mesh vertices onto quadrics. wonky's recover is measured exact
   on 32 of 38 corpus cases (DOCUMENTED in the notes and in
   [proto-recover.md](../proto-recover.md)). So the fringe does not offer a
   competing recovery design, only contracts, tests and representation
   lessons around it.
3. **hypermesh's "512-bit deterministic terminal" is not 16 U32 limbs of
   exact evaluation.** `APPROXIMATE_512` is an absolute cutoff: a lazily
   refined real whose certified interval at 2^-512 straddles zero is called
   zero and the result is labelled `Approximate512Consumed`. For rational
   inputs it is never reached (DOCUMENTED, hypermesh note, `hyperlimit
   resolve.rs`). The only fixed-width analogue in the stack is therefore a
   labelled approximation, not an exact tier.
4. **vcad has about 2,276 commits and 427 stars**, not 2.3k stars; the
   agent-written share is DOCUMENTED for issues and INFERRED for code.
5. **keel's exact layer is unused by its Boolean.** `orient_2d`, `orient_3d`
   and `OneRoot` occur only inside `keel-math` (DOCUMENTED by grep);
   `boolean.rs` holds about 393 literal epsilons, and the cited "10k census"
   log entry (Add. 315) is not in the tree, which ends at Add. 198. Its
   headline numbers are HEARSAY.
6. **More than one postmortem exists, just not for whole projects.** Besides
   Fornjot, three documents are postmortems of an *approach*: Aetheris's
   `brep-boolean-lessons.md` (why general B-rep Booleans were frozen),
   forge's ADR-0023 (why exact measures cover a null set of parameters) and
   hypermesh's EMBER-replacement phase reports (why a 60k-line EMBER-style
   engine lost to a Zhou-2016 arrangement). CADmium never explained its
   stop; its cause below is INFERRED from code and issues.
7. **Fidget's intervals are not outward-rounded; libfive's are.** Fidget
   states "This implementation does not set rounding modes"; libfive wraps
   `boost::numeric::interval<float>` with `save_state`. OpenSolid's double
   intervals also use round-to-nearest (DOCUMENTED in the three notes). For
   wonky on Metal (no rounding modes) all three need explicit widening.
8. **Ondsel.** The post "We are shutting down Ondsel" carries the page
   metadata date 2024-10-30 (its visible date reads "October 30, 2025",
   INFERRED to be a template error: the text refers to the May 2024.2
   release and to FreeCAD 1.0 as upcoming). The scout's "2024-11-22" is not
   on the page.

## 1. Landscape

### 1.1 The shape of the field

Four strategies, not three. The fourth is new in 2026.

1. **Wrap OCCT or Manifold.** Most new CAD apps and code-CAD tools do this:
   replicad, CascadeStudio and bitbybit over opencascade.js; Chili3D (4.9k
   stars, AGPL) over OCCT WASM; BREP.io over manifold-3d; Plasticity over
   Parasolid (DOCUMENTED: "exposes the full power of Parasolid and xNURBS",
   https://www.plasticity.xyz/). Manifold's README lists OpenSCAD, Blender
   and Godot as users (DOCUMENTED there, integration details HEARSAY; see
   [sources/manifold-elalish-manifold.md](sources/manifold-elalish-manifold.md)).
   opencascade.js, the Emscripten OCCT build under most browser code-CAD, was
   last pushed 2023-08-15 (DOCUMENTED, `gh api`).
2. **Write a pure B-rep kernel from scratch.** Fornjot (2020-2026), Truck
   and its app CADmium, monstertruck, OpenSolid, curvo, verb. None of them
   shipped general curved Booleans or fillets that users rely on:
   - Fornjot never had a 3D Boolean (#42-#44 closed NOT_PLANNED) and shut
     down in 2026-06;
   - Truck's coplanar-touch union (#57), fillets (#53) and 13-15 s
     cube/cylinder Booleans (#68) are still open in 2026-09;
   - OpenSolid lists 3D Booleans, SSI and fillets as TODO.
3. **Go implicit or volumetric.** libfive (2015-2021, maintenance),
   Fidget (active), Curv (stalled engine), ImplicitCAD, fogleman/sdf,
   PicoGK (voxels for additive manufacturing). They are robust by
   construction and exact nowhere: no B-rep, no STEP, no deviation
   certificate, and SDF blends are constant-thickness, not constant-radius
   (DOCUMENTED, Curv blend article).
4. **Let agents write the kernel (2026).** vcad (created 2026-01-27,
   2,276 commits), remus (about 510k lines, "All of my contributions are done
   through coding agents"), keel (744 commits in 23 days), Aetheris (1,939
   commits, one account), hypermesh/hypercurve (hypercurve alone 369,550
   lines), gitcad forge (181 commits in 9 days), BREP.io (heavy LLM use
   INFERRED), and the Lean-verified intersector (implementation and about
   100k lines of proofs written by agents). This wave produced more kernel
   code in nine months than the hobby field produced in the previous decade,
   and nearly all of it is unreviewed by a second human.

What the fourth group gets right is not geometry. It is the **contract
layer**: result quality types, failure taxonomies, budgets, oracles and
torture corpora (section 3.8). Their geometry claims (variable fillets,
1M-trial oracles, 2.4B fuzz runs, "WRONG = 0") are HEARSAY until
reproduced, and where the notes checked them, they shrank: keel's WRONG is
volume-only and its gate equals its oracle on one lane; vcad's "0 wrong
solids" matrix checks representation, not volume (#895); forge's 99 %
capability matrix answers 0-9 % of real parameter sweeps (ADR-0023).

### 1.2 Lineages

- **csg.js (Evan Wallace, 2011).** BSP tree with one global epsilon. Its
  descendants: JSCAD's CSG core, csgrs until 2026-05, forge's exact core (the
  same BSP with exact rational classification and constructed vertices), and
  many hobby kernels. csgrs documented the whole failure catalogue before
  replacing it (section 4.2).
- **Manifold (Boolean3, symbolic perturbation).** Direct users: BREP.io
  (labels through `reserveIDs`), OpenSCAD, Blender, Godot (README). wonky's
  corefine is a Bend port. vcad replaced manifold-3d with its own B-rep in
  one night (2026-01-28) and later wrote its own mesh fallback.
- **Exact arrangements.** Zhou-Grinspun-Zorin-Jacobson 2016, Cherchi et al.
  2020/2022 (construction-free indirect predicates), EMBER; hypermesh
  switched from EMBER-style to Zhou-style on 2026-08-03 and csgrs sits on
  top; the Lean intersector started from Feito-Rivero simplicial chains
  (1998) and moved to a winding-number mesh spec.
- **Keeter's implicit line.** libfive (2015-2021) → MPR (SIGGRAPH 2020) →
  Fidget (2022-) → Halfspace (2026, MPL-2.0). Curv vendors libfive as a
  mesher.
- **Truck.** Truck → CADmium (app, died 2024) and monstertruck (fork with a
  fillet crate).
- **OCCT-shaped agent kernels.** remus (brepkit fork, GFA, ShapeFix-like
  healing, ChFi3d-like blends), keel (Parasolid entity names, radial edge),
  Aetheris (recipes instead of a general Boolean).
- **Exact fields.** forge (ℚ, ℚ[√d], ℚ(√p,√q), ℚ[π], certified rational
  intervals, sampled tier).
- **Labels over approximation.** Fornjot's final experiment (topology over
  polylines and triangles, analytic definitions discarded), BREP.io (face
  labels over MeshGL, analytic intent as side-car), wonky (face tags over a
  tagged tessellation, analytic carriers kept and recovered exactly).

### 1.3 Trends, 2024 to 2026

- **Exact predicates replace epsilons, late and expensively.** csgrs spent
  16 months on epsilon BSP and then swapped its core for exact reals
  (2026-05 to 2026-07, "Use hypermesh booleans without fallback"). vcad and
  keel still decide topology with f64 bands and patch the results with
  post-hoc gates.
- **Silent wrong results are the dominant failure class, and projects
  discover it late.** vcad: "Every failure in the 2026-08-11
  hemispherical-socket handoff was *silent*"; remus #190 silently
  substituted a 53-face mesh; BREP.io's failed fillet returns the unchanged
  clone. All three responded by adding refusal paths.
- **Contracts become the product.** remus's operation contract, failure
  taxonomy and capability matrix; vcad's Fidelity report; csgrs's
  `GeometryOutcome{value, certainty}`; keel's PASS/DECLINE/WRONG; forge's
  exact/certified/sampled tiers; hypercurve's `Decided | Uncertain(reason)`.
- **Mesh with topology labels as a substrate.** Fornjot's final data model,
  BREP.io, hypermesh's `TriangleSource` per triangle, Cherchi's label bitset
  per triangle, vcad's fallback wrapped as a B-rep. Two independent projects
  (Fornjot, vcad) converged on the same **global per-circle sample lattice**
  so that shared boundaries sample identically.
- **Implicit engines move to the GPU and to certified pruning.** MPR and
  `fidget-wgpu` evaluate one shortened tape per tile with 64x fan-out; the
  interpreter plus pruning beats a compiled brute-force kernel.
- **Formal specification enters.** The Lean intersector proves `ok ⇒
  correct` for a 93-101-line spec; its author also shows an LLM-written C++
  equivalent with three bugs "almost impossible to catch by black box
  testing".
- **Deterministic ray families converge.** The Lean intersector and
  hypermesh both use axis rays and then moment-curve directions `(1, t, t²)`
  with an exact graze test and a finite budget, instead of random rays or
  ulp nudges.

### 1.4 What is conspicuously missing

- **No F32-only, GPU-native or fixed-width exact B-rep kernel exists.**
  Everything is f64, unbounded rationals (hypermesh, forge, Lean) or
  computable reals. Every port to wonky needs an F32x2 or U32-limb redesign.
  wonky's corefine (F32x2 Reals with exact big-integer fallback) is itself
  the only instance I found (INFERRED from the 18 notes plus the sibling
  chapter).
- **No verified curved Boolean.** The one machine-checked Boolean is
  mesh intersection only, over rationals.
- **Fillets outside OCCT and Parasolid are experiments:** keel's and
  remus's ladders (claims unverified), monstertruck's rolling ball, BREP.io's
  helper-body Booleans with about 2,800 lines of sliver cleanup, forge's
  closed-form composites, SDF smooth-min blends.
- **No shared independent curved-Boolean corpus.** Every project grades
  itself: vcad's 752 cases, keel's lanes, remus's B26, hypermesh's box
  oracle. None publishes results on another project's corpus. wonky's
  bake-off suites (38 corpus, 216+ adversarial, arbitrated) are already more
  independent than any of them (INFERRED).
- **No FDM-specific kernel with a certified print mesh.** PicoGK targets
  additive manufacturing through voxels with no deviation certificate; the
  others treat printing as STL export.
- **No postmortem of a failed curved Boolean in a from-scratch kernel.**
  Fornjot never reached one; CADmium was silent; the agent kernels are still
  running.
- **Zig, OCaml and Lisp have nothing serious** (DOCUMENTED, `gh api`):
  zolygon (Zig, MIT) is a 16 KB repository; kupcad (Zig, AGPL-3.0, created
  2026-07-27) is an early language; OSCADml (OCaml, GPL-2.0) was last pushed
  2023-05-02; ruckus (Racket) is archived since 2018.

### 1.5 Licensing map (wonky is private and unlicensed)

| class | sources | what wonky may do |
|---|---|---|
| public-domain equivalent | Fornjot (0BSD) | copy freely |
| permissive | vcad (Apache-2.0 per LICENSE, MIT per Cargo.toml), remus (Apache-2.0 up to brepkit v2.129.15 only), hypermesh (MIT), hyperreal (Apache-2.0), hypercurve (MIT), csgrs (MIT), forge (Apache-2.0), the Lean intersector (MIT), Cherchi's Boolean layer (MIT), BREP.io (MIT from `22f1c0db` only), Curv (Apache-2.0), curvo, verb, three-bvh-csg, csg.js, JSCAD, replicad, fogleman/sdf (MIT), PicoGK, Manifold (Apache-2.0) | port with the notice (and NOTICE for Apache) |
| file-level copyleft | Fidget, OpenSolid, libfive core, Halfspace (MPL-2.0) | re-implement from papers and descriptions; a translated file stays MPL and must be kept separate and marked |
| ideas only | keel (GPL-3.0-or-later), Aetheris, ImplicitCAD, Chili3D, kupcad (AGPL-3.0), brepkit after v2.129.15 (AGPL-3.0), Cherchi's vendored Indirect_Predicates and pymadcad and opencascade.js (LGPL), libfive Studio and Guile (GPL-2.0+), Dune3D (GPL-3.0), OSCADml (GPL-2.0), CADmium (Elastic License 2.0) | read, then write clean-room from primary papers |

Two traps: BREP.io's history before `22f1c0db` carries a copyright-assignment
clause, and remus's upstream brepkit changed to AGPL after v2.129.15
(DOCUMENTED in both notes).

### 1.6 Where wonky sits (INFERRED from the notes and wonky's documents)

- **Ahead of the fringe:**
  - exact decisions over F32x2 with an exact big-integer fallback, and byte
    identity across JS, CPU (1 and 18 threads) and Metal on every corpus and
    adversarial case (MEASURED, plan §9);
  - analytic recovery with certificates from tags (no fringe kernel has
    it);
  - an arbitrated oracle harness with a third reference for OCCT/manifold3d
    disputes (plan step 3);
  - FP contraction pinned (`-ffp-contract=off -fno-fast-math`, Metal
    `--fmad=false`), the failure remus #483 hit;
  - fail-closed identity matching (`matched | missing | ambiguous |
    unsupported`, topology-identity.md), the property vcad and CADmium #98
    argue for.
- **Behind the fringe:**
  - refusals are prose (`UnsupportedFeatureError(message)`), not stable
    codes with categories, capability cells and budgets (remus, vcad);
  - the tessellation samples each arc from its own start angle
    (`arc_interior(first, sweep, count)` in `kernel/tessellate.bend`), so
    coincident curves from different leaves do not share samples; recover's
    sliver pass exists to repair exactly that (plan §2.2), and the harness
    keeps the countersink case non-conforming on purpose (bakeoff.md, "Known
    harness limitations"); Fornjot and vcad solved this with a lattice;
  - the harness has no metamorphic lanes (transform and scale invariance,
    operand order), no contact lane tied to the declared tolerance, no exact
    box-volume fuzz lane, no non-vacuity gate and no parameter-sweep
    coverage report (grep of `docs/*.md`);
  - corefine's per-vertex provenance (which edge crossed which face) is
    computed and then dropped before recover (plan step 9 lists the missing
    "corefine → recover provenance section").

## 2. Comparison table

Status figures from `gh api` as recorded in the notes (2026-09-22 to
2026-09-24). "Verdict" is the note's verdict.

| name | kind | status | license | verdict | key idea (one line) | note |
|---|---|---|---|---|---|---|
| Fornjot final experiment | hobby B-rep kernel (Rust) | archived 2026-06-19; 2,552 stars; one main author | 0BSD | learn-from | append-only topology labels over tolerance-driven samples; global per-circle lattice; keep (u,v) next to every 3D sample | [sources/fornjot-final-experiment-experiments-2025-12-03-plus-experim.md](sources/fornjot-final-experiment-experiments-2025-12-03-plus-experim.md) |
| Fornjot shutdown post | postmortem + repo | 2026-06-19 | 0BSD (repo) | learn-from | six years, no Boolean: intersection-tests-first became dead code; "local maximum"; prototype earlier | [sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md) |
| vcad | kernel + web CAD (Rust/WASM) | very active; 427 stars; 2,276 commits since 2026-01; agent-heavy | Apache-2.0 (Cargo says MIT) | learn-from | two-tier analytic/mesh Boolean with Fidelity + DegradeReason; canonical circle lattice; fail-closed naming; 752-case torture corpus | [sources/vcad-ecto-vcad-kernel-booleans-kernel-naming-torture-corpus.md](sources/vcad-ecto-vcad-kernel-booleans-kernel-naming-torture-corpus.md) |
| "Building a CAD kernel in one night" | blog (vcad author) | 2026-01-28 | post ©; code Apache-2.0 | learn-from | Booleans "working" in 16 minutes, silent-wrong curved cases fixed seven months later; closedness thresholds cannot separate good from garbage | [sources/building-a-cad-kernel-in-one-night-cam-pedersen.md](sources/building-a-cad-kernel-in-one-night-cam-pedersen.md) |
| Aetheris `brep-boolean-lessons.md` | design doc in a C# kernel | active daily; 6 stars; solo, agent-assisted | AGPL-3.0 | learn-from | intent → bounded recipe → validating surgery; "intersection is not topology"; the stepped-hole composition cliff | [sources/aetheris-brep-boolean-lessons-md.md](sources/aetheris-brep-boolean-lessons-md.md) |
| verified-3d-mesh-intersection | verified library (Lean 4) | one commit 2026-07-27; 106 stars | MIT | adapt | machine-checked exact mesh intersection; 93-101-line spec; moment-curve ray reshoot; coplanar keep-once/drop-both rule | [sources/verified-3d-mesh-intersection-lean-4.md](sources/verified-3d-mesh-intersection-lean-4.md) |
| hypermesh (+ hyperreal, hyperlimit, hypercurve) | exact mesh Boolean stack (Rust) | created 2026-05; 7 stars; single author, agent-driven | MIT / Apache-2.0 | adapt | N-ary exact arrangement; construction identities per vertex; truth DAG with many roots; certify or typed error | [sources/hypermesh-hyperreal-hyper-stack-under-csgrs.md](sources/hypermesh-hyperreal-hyper-stack-under-csgrs.md) |
| csgrs | CSG library (Rust) | active; 255 stars; crates.io stops at the BSP-era 0.20.1 | MIT | learn-from | phased epsilon-to-exact migration; certainty-tagged outcomes; adversarial case matrix | [sources/csgrs.md](sources/csgrs.md) |
| Cherchi, Pellacini, Attene, Livesu 2022 | paper + C++ | maintenance only; 244 stars; last commit 2024-06 | MIT (vendored predicates LGPL) | adapt | construction-free LPI/TPI points; one exact ray per patch; bitset operation selection | [sources/interactive-and-robust-mesh-booleans-cherchi-et-al.md](sources/interactive-and-robust-mesh-booleans-cherchi-et-al.md) |
| keel | B-rep kernel (Rust) | alpha; dormant since 2026-06-30; 4 stars | GPL-3.0-or-later | learn-from | PASS/DECLINE/WRONG oracle with a contact lane; quadratic branch-field SSI; claims unverified | [sources/keel-redwoodrhetorica-keel.md](sources/keel-redwoodrhetorica-keel.md) |
| remus | B-rep kernel (Rust/WASM) | daily; 0 stars; about 510k lines; agent-built | Apache-2.0 (brepkit ≤ v2.129.15) | adapt | operation contract: quality, fallback policy, 9 failure categories with stable codes, deterministic budgets, typed fillet refusals; B26 metamorphic campaign | [sources/remus-esaueng-remus.md](sources/remus-esaueng-remus.md) |
| gitcad forge | exact kernel (Python + Rust) | 9-day burst 2026-07; 1 star | Apache-2.0 | learn-from | exact field tower with named refusals; exact measures cover a null set (ADR-0023); reference ⇄ port bit identity | [sources/gitcad-forge-forgekernel.md](sources/gitcad-forge-forgekernel.md) |
| BREP.io | browser CAD + labelled-mesh kernel on manifold-3d | last code 2026-07-15; 256 stars; archiving announced | MIT from `22f1c0db` | learn-from | per-triangle face IDs survive Manifold CSG; edges derived from label changes; fillet as helper-body Boolean; silent nudges | [sources/brep-io.md](sources/brep-io.md) |
| CADmium | browser CAD app on Truck | archived; last code 2024-06-28; 1,635 stars | Elastic License 2.0 | learn-from | died at the coplanar union, missing fillets and 13 s Booleans; face references must be able to fail | [sources/cadmium.md](sources/cadmium.md) |
| OpenSolid | geometry library (Haskell + C++) | active, human-written; 18 stars | MPL-2.0 | adapt | one bytecode evaluated on doubles and intervals; dyadic cells; Resolved/Unresolved; bisection trees and clusters; procedural implicit curves | [sources/opensolid-ian-mackenzie.md](sources/opensolid-ian-mackenzie.md) |
| Fidget | implicit-surface library (Rust) | active; 494 stars; v0.5.0; no LLM code | MPL-2.0 | learn-from | hash-consed tapes; interval pruning with choice traces; 64x-fan-out GPU hierarchy; evaluators bit-exact to canonical ops | [sources/fidget-matt-keeter.md](sources/fidget-matt-keeter.md) |
| libfive | f-rep kernel (C++) | maintenance; 1,666 stars; last push 2025-11 | MPL-2.0 core; GPL-2.0+ Studio | learn-from | manifold dual contouring; epsilon-cone feature evaluator at min/max ties; topology-safe collapse | [sources/libfive.md](sources/libfive.md) |
| Curv | SDF language (C++) | GitHub archived 2023-09; Codeberg lightly maintained; engine frozen since 2021 | Apache-2.0 | learn-from | restricted F32 recursion-free kernel subset; parameters as GPU uniforms; blends are constant-thickness | [sources/curv.md](sources/curv.md) |

## 3. State of the art: best techniques, their real guarantees, where they break

### 3.1 Mesh Booleans that decide topology exactly

Four designs from this chapter's sources, next to wonky's corefine (a port of
Manifold's Boolean3, see
[sources/manifold-elalish-manifold.md](sources/manifold-elalish-manifold.md)
and [../proto-corefine.md](../proto-corefine.md)).

| | Cherchi et al. 2022 | hypermesh | Lean intersector | wonky corefine |
|---|---|---|---|---|
| decisions | filtered exact indirect predicates on input coordinates only (interval with directed rounding, then Shewchuk expansions, then bigfloat) | exact rationals; hyperlimit cascade; labelled 2^-512 terminal only for irrational input | exact `Rat`/`Int`, machine-checked | exact comparisons on F32x2 Reals with a big-integer fallback; ties broken by symbolic perturbation (Manifold's `expandP`) |
| new vertices | implicit: LPI (edge × plane, degree 4 over 3), TPI (three planes, degree 7 over 6) | materialized rationals plus a construction identity (`SourceEdgePlane`, `PlaneTriple`) | materialized rationals, three-plane cuts plus a centroid fan apex | constructed F32x2 points from edge × face crossings |
| input contract | closed, manifold, no self-intersection, outward; **not checked in the pipeline** (asserts and crashes on bad input, #19, #30) | closed PWN meshes, checked exactly, typed errors | `WellFormedMesh` decided at run time, sound and complete | closed oriented 2-manifold, checked by half-edge pairing, refused otherwise |
| coplanar overlap | label bits OR-ed, no per-source orientation: zero-volume sheets (#13, BRL-CAD shelved its integration) | coincident facets bundled with per-sheet orientation | same orientation kept once, opposite orientation dropped on both sides | perturbation plus carrier unification within 2^-44 (plan step 4) |
| output | rounded to doubles, no snap rounding, may self-intersect | exact, "balanced non-manifold" allowed, certified closed, never repaired | exact, edge and vertex contact allowed, proved well-formed | closed 2-manifold; vertex-link and exact self-intersection gates refuse otherwise (plan step 1) |
| chained operations | unsupported (paper §7, #2) | exact but unbounded bit growth (116 GiB RSS in csgrs) | unbounded (the fan apex has lcm denominators) | re-tessellate the exact recovered B-rep; mesh-only chains add about 2^-44 per constructed point (plan §2.4, argued) |
| speed (self-reported) | 200K triangles in 0.14 s per frame on an M1 Pro; about 25x libigl on 3-21M triangles | 8x slower than CGAL EPECK on two boxes, 534x on 12k × 12k (48 s) | 24 s for 70k × 70k triangles, single thread | corpus sums in plan §3 (MEASURED) |
| provenance | label bitset per triangle; LPI/TPI tuples name the source triangles | `TriangleSource{mesh, triangle, orientation}` per triangle; identity per vertex | none beyond coordinates | tag per triangle; tag pair per new edge group (dropped before recover) |
| parallel | TBB per octree leaf, per triangle, per patch | none (`RefCell` context) | none | Bend fork trees; cpu1/cpu18 = 1.46 |

**What is really guaranteed.**

- Only the Lean intersector is proven, and only for intersection over
  rationals (DOCUMENTED, four theorems).
- Cherchi's arrangement is exact given valid input, but its ray fallback for
  fully implicit patches is missing (`std::exit(EXIT_FAILURE)`) and its
  degenerate-hit handling perturbs the ray endpoint by one ulp in up to 8
  directions, then silently drops the hit (INFERRED from code).
- hypermesh is exact by construction, not by proof, with a fuzzer-found
  history of arrangement bugs (a coplanar overlay vertex not fanned out; a
  real segment discarded as a "shared feature" because its endpoints lay on
  triangle boundaries).

**Where they break.**

1. **Coplanar and touching input**, the everyday FDM case. Cherchi leaves
   sheets; the Lean spec must allow non-manifold output because "If we
   imposed a manifoldness condition, no algorithm would be able to satisfy
   our specification"; wonky refuses line and point contact by name.
2. **Bit growth under chaining.** Every exact design here either forbids
   chaining or grows without bound. The fix all three notes point to is the
   one wonky already uses: construction-free predicates inside one
   operation and re-tessellation of exact geometry between operations
   (INFERRED).
3. **Exact everything is slow without filters.** hypermesh's 534x gap to
   CGAL comes from rational arithmetic on every decision. CGAL wins with
   lazy-exact filters. corefine's F32x2 filter plus big-integer fallback is
   the filter design (MEASURED speed in plan §3).

**Two small, portable techniques** that appear in two independent sources
each:

- **Deterministic ray families.** Axis rays first, then moment-curve
  directions `d_j = (1, j, j²)`. No three are coplanar (Vandermonde), so each
  edge line can be grazed by at most two directions, and a finite budget
  always contains a valid ray. The graze test is exact; a graze means
  "reshoot", never "nudge" (Lean `windingAtH`, hypermesh
  `seed_surface_cell_winding`).
- **One classification per untouched component.** Faces with no candidate
  intersection are grouped by connectivity and classified with one ray per
  component (Lean `clusterFree`); Cherchi casts one ray per patch, not per
  triangle (2 % of 80K rays needed the fallback origin).

### 3.2 Analytic B-rep Booleans in hobby and agent kernels

| kernel | pipeline | curved coverage | acceptance | documented wrong results |
|---|---|---|---|---|
| vcad | AABB, freeze circles to a canonical lattice, closed-form SSI for a small pair table, marching "dust" otherwise, trim, split, ray-parity IN/OUT/ON, sew, repair; mesh-CSG fallback labelled `TriangleSoup` | plane × {plane, sphere, cylinder, cone, torus}, sphere × sphere, perpendicular equal-radius intersecting cylinders | signed volume, Monte-Carlo volume agreement, "difference removed nothing", crack width, union referee, watertightness swap | sphere through-bore returned the untouched sphere; unequal cross-drill merged the drill surface; cone ∩ cylinder 16.8 vs about 502 mm³ (#895); union depended on operand order (#892) |
| keel | front-door checks, per-face-pair SSI seams, imprint, GWN classification with a band, r-set selection, identity-preserving stitch, volume gates; tolerant tier snaps within fuzz | closed forms plus a sampled quadratic branch field for cylinder/cylinder, cylinder/sphere, cone/sphere | analytic mass vs mesh volume, operand-volume intervals | 4 WRONG in 100k (ear-clip on a concave sliver); a multi-component union passed its gate |
| remus | shortcut ladder (containment, coaxial, AABB boxes), OCCT-style GFA, up to 3 heal passes, Euler and manifold gates, mesh fallback within a deflection budget | analytic classifier for 7 primitive kinds; GFA for the rest | Euler with cavities, closed manifold, bounds, representation | box ∩ sphere keeps the wrong region (README); #190 tilted slab cut silently became a 53-face mesh; #195 and PR #603 plane × cylinder lines never clipped against arc-bounded faces |
| Aetheris | recognized bounded recipe, explicit surgery, validation plus STEP round trip | Z-axis holes, pockets, coaxial stacks, sphere cavity, prism cuts, orthogonal unions; general Booleans frozen | correct by admission; typed rejection otherwise | none claimed; the cost is refusal (one side-hole family took 21 milestone documents) |
| forge | exact csg.js BSP for planes; hand-written per-family quadric cuts and closed-form composite classes; Monte-Carlo tier | twelfth-angle special cases only | exact planar volume, certified intervals, property identities | chamfer corners wrong by d³/12 in "every chamfer this kernel ever produced" until caught; a `BiSurd` read dropped terms ("reported 960 for 960 − 20√3") |

**Real guarantees:** none of them is proven. Acceptance is a conjunction of
necessary conditions (closed, Euler-balanced, volume in bounds), so a wrong
solid with plausible invariants passes. Their own issue trackers show it
(DOCUMENTED, table).

**Where they break, and why it matters for wonky.**

- **Clipping a carrier intersection line against an arc-bounded face**
  (remus #195, PR #603) is the plane/cylinder class that blocked wonky before
  the hybrid. A tagged mesh Boolean does not have this step at all: the mesh
  Boolean decides where the curve lies, and recover only picks the curve type
  from the two carriers (INFERRED; plan §2.2).
- **Point dust from marching SSI** (vcad #789): zero splits recorded, then a
  "no crossing" fast path concludes containment. wonky's recover never
  derives topology from sampled SSI.
- **One-sided coincidence** (vcad #901): a small coplanar patch reads
  `OnSame` against the large cap, the large cap reads `Outside` against the
  patch, so both survive in one operand order. A symmetric exact rule (Lean's
  keep-once/drop-both, corefine's perturbation) removes the class.
- **Bistable bands** (keel): detection at 1e-7, classification at 1e-6.
  Fix: derive both from one declared operation tolerance as tol/2.
- **Admission depending on history** (Aetheris "stepped-hole cliff"): each
  family works, compositions fail because a gate counted holes
  (`Holes.Count == 1`). Relevant to wonky's exact arms in front of the
  hybrid (INFERRED).

### 3.3 Certified root finding and SSI by subdivision

| source | method | certificate | where it breaks |
|---|---|---|---|
| OpenSolid | symbolic expressions compiled to one bytecode, evaluated on doubles and intervals; dyadic parameter cells; `resolution = lo/hi ≥ 0.5` to call a sign; bisection trees with cached bounds (value range intersected with the mean-value enclosure); candidate cells clustered by overlap; boundary solutions first, then tangent clusters, then crossing clusters; Newton continues while the residual halves | bounds decide, Newton only polishes inside a cell proven to hold at most one root (independent tangent-direction bounds); zero sets of `f(u,v)` read as graphs where `fu` or `fv` is sign-definite; tangent points and saddles from the Hessian sign | no outward rounding; tangent curves and boundary saddles end in `HigherOrderZero`; one solution per cluster could merge two nearby roots (INFERRED) |
| forge | exact rational de Casteljau subdivision of Bézier patches, control-net box pruning, connected components of surviving 4D cells, float Newton per cell | exact residual `|A − B|² < tol²` (a tolerance certificate); complete at resolution 2^-d | tangential contact is refused by name; unbounded rationals |
| keel, remus | parameterize the ruled surface by (θ, v), solve the quadratic in v, sample the discriminant at N = 1024 angles, bisect bite ends, Chebyshev substitution at turnarounds, least-squares cubic NURBS accepted at 2x safety | sample-based: a small bite between samples is missed (INFERRED) | the same recipe in two agent kernels; the notes call it the common LLM recipe |
| vcad | closed forms for its pair table; marching otherwise | none; up-front "unrepresentable" routing | sampled crossing test (24 points per face) can miss a penetration (INFERRED) |

**Best known technique in the fringe:** OpenSolid's design. It decides
topology by bounds on `f = implicit(B) ∘ param(A)`, which for quadric pairs is
a low-degree polynomial in `cos u, sin u, v` with tight, cheap bounds, and it
stores crossing curves as procedural implicit curves (face A, face B, uv box
chain, monotone axis), evaluated by a monotone 1D solve. The guarantee is
"certified modulo rounding and tolerance-inflated overlap tests". With
outward-rounded F32x2 intervals it would become a real certificate
(INFERRED). The newer bisection-plus-clusters module (issue #69, open since
2026-07-30) is still being migrated; `SurfaceFunction1D.zeros`, the future SSI
kernel, still uses the older 9-way `Solve2D`.

### 3.4 Implicit and SDF engines

- **Evaluation (Fidget, libfive).** A hash-consed DAG flattens to an SSA
  tape; interval evaluation over a cell records min/max choices, and a
  backward pass prunes the tape (17x shorter at 64² tiles, 216x at 8²,
  MPR Fig. 6). Pruning dominates the backend choice: bytecode 6 ms vs JIT
  4.6 ms after pruning, 5.8 s brute force (DOCUMENTED, Fidget writeup).
  MPR runs one shortened tape per warp by subdividing 64x per level.
- **Exactness at ties (libfive).** At exact zeros with min/max ties, a
  `Feature` carries a cone of epsilon directions (a symbolic perturbation for
  min/max trees) to decide inside/outside and the normals at sharp edges.
- **Meshing.** Manifold dual contouring with additive QEFs, a tuned
  eigenvalue or SVD cutoff, Ju-2002 collapse tests. Output: manifold and
  watertight, but self-intersecting where vertices leave their cells
  (libfive #150, #284; Fidget #53, #198), with no deviation bound, with
  resolution tied to the bounding box (libfive #562), and with gradient
  singularities at revolve axes and cone apexes (Fidget #258, #284).
- **Semantics.** Min/max CSG turns exact SDFs into distance bounds, so
  offsets `f − r` are exact only on true SDFs (libfive's `box_exact` vs
  `box_mitered`). SDF blends have constant maximum thickness; CAD fillets have
  constant radius (Curv blend article).
- **wonky's position is already set:** sdf produces no Boolean results
  (plan §1, measured: lost walls, closed slots, 47 wrong answers of 216). The
  fringe adds nothing that changes that; it adds evaluation machinery for FDM
  analyses (section 6).

### 3.5 Numeric regimes and bit budgets

| source | arithmetic | exact where | bit growth | mapping to wonky (INFERRED) |
|---|---|---|---|---|
| Fornjot | f64 with a NaN-free `Scalar` | only spade's CDT predicates | none | lattice angle from an exact integer k, F32x2 cos/sin |
| vcad | f64; Shewchuk predicates on *constructed* coordinates; about 45 file-local epsilons (#463) | point-in-polygon, coplanar detection, mesh ray parity | none | exact grid inputs plus multi-limb predicates remove its coplanar and on-boundary class |
| keel | f64; about 393 literal epsilons in `boolean.rs`; Shewchuk and `OneRoot` unused | nothing in the Boolean | none | ideas only |
| remus | f64 with 7 tolerance classes; filtered `orient3d` normalized into distances | predicates only, then compared against tolerances | none | contract only |
| Aetheris | double; `ToleranceContext {1e-6, 1e-9, 1e-12}` | none | none | none |
| forge | `Fraction`, ℚ[√d], ℚ(√p,√q), ℚ[π], certified rational intervals | predicates and planar measures | unbounded (constructed BSP vertices) | per-intersection `(a, b, D)` surd sign by bounded squaring; fixed degree, fixed limbs |
| hypermesh / csgrs | normalized rationals plus computable reals | all decisions for rational input | unbounded; 116 GiB RSS on one chained case | homogeneous fixed-width limbs on an F32 grid; plane-based radial predicate about 16b bits instead of about 27b |
| Lean intersector | `Rat` and `Int` | everything, proved | bounded by Cramer determinants per operation, except the fan apex | about 300 bits (10 U32 limbs) for a plane-sign test at a three-plane point on a 32-bit grid |
| Cherchi | double; intervals with directed rounding; expansions in fixed 64-double buffers; bigfloat on overflow | all predicates, construction-free | bounded: `orient3d` on four TPI points is degree about 27 (about 660 bits, 21 limbs, at 24-bit coordinates) | semi-static F32x2 filter (re-derive the constant for u ≈ 2^-48) plus fixed limbs; no directed rounding on Metal |
| OpenSolid | double values and double intervals, round-to-nearest | none (bounds modulo rounding) | none | outward-rounded F32x2 intervals: widen by about 2^-44 relative plus an underflow floor |
| Fidget | f32 values and f32 intervals, no outward rounding | none | none | ulp widening by U32 bit manipulation |
| libfive | f32 intervals with directed rounding (boost); double QEFs | pruning is sound | none | widen by 1 ulp per operation on Metal |
| Curv | F32 on the GPU, F64 in the interpreter, no intervals | none | none | none |
| BREP.io | manifold-3d decisions plus absolute nudges | Manifold's decisions only | none | corefine already exceeds it |

wonky today: F32x2 Reals (about 2^-44 relative per constructed point), exact
big-integer fallback in `kernel/robust-predicates.bend`, symbolic
perturbation in corefine, carrier unification within 2^-44 per normal
component and 2^-44·scale in offset (plan step 4), Newton corners with
residual at most 1e-7 mm (observed 1e-12) in recover (DOCUMENTED, plan §2.2).

### 3.6 Fillets in the fringe

| source | method | analytic cases | refusal behaviour | verified? |
|---|---|---|---|---|
| remus | `fillet_cascade`: walking engine (`fillet_v2`), rolling-ball rebuild, then per independent group; engine disclosed in `BlendResult::engine` | plane-plane, plane-cylinder (perpendicular), plane-cone, plane-sphere, sphere-sphere, sphere-cylinder, sphere-cone, cylinder-cylinder, coaxial cone-cone, with chamfers | typed: `CliffEncountered{edge, face, requested_radius, available_radius}`, `RadiusTooLarge{edge, max_radius}`, `UnsupportedVertexBlend`, ...; stable codes; "the flat bevel is not a fillet and is no longer a fallback for one" | HEARSAY-grade (agent-built, self-tested) |
| keel | rolling ball, `spine = SSI(offset(Sa, r), offset(Sb, r))` | plane-plane → cylinder; perpendicular plane-cylinder → torus (convex needs `r_cyl > 2r`); cyclide declines; vertex blends claimed | DECLINE, input unchanged | filleting all 12 box edges declines at the first 3-edge corner (DOCUMENTED, CAPABILITIES) |
| BREP.io | wedge minus a 32-segment tube along a solved centerline, subtracted (INSET) or unioned (OUTSET); corner bridges; inflate 0.1 model units | none (mesh only) | a native failure returns the unchanged clone with a console log | no error bound; about 2,800 lines of sliver and label surgery |
| forge | closed-form composite classes (`FilletedBox`, `VariableFilletedBox`, `RoundedBox`, ...), Pappus volumes in ℚ[π] | box and prism families only | named refusals | exact volumes for those families |
| Curv, libfive | smooth-min blends | none (constant thickness) | none | not CAD fillets |

Two findings worth carrying (DOCUMENTED in the remus note):

- **Plane-cylinder convexity:** `convex = plane_bounded ==
  material_inside_cylinder`. A through-hole rim is convex; the first
  implementation read `reversed` alone as concave.
- **Inward radius bound:** the quarter-tube band used spans `v ∈ [0, π/2]`
  and a spindle torus self-intersects only where `|v| > arccos(−R/r) ≥ π/2`,
  so `r < r_c` (minus a tolerance) suffices; keel's `r_cyl > 2r` refuses
  sound geometry. And the wedge half-angle is `(π − angle(n1, n2))/2`;
  halving the normal angle instead coincides only at 90° and put contacts
  about 100r away on a 178.9° ridge.

### 3.7 Validation and oracles: what works, what lies

| oracle | used by | sound? | catches | misses |
|---|---|---|---|---|
| exact box-volume by coordinate compression (1-4 random integer boxes, any operation) | hypermesh fuzz target | yes, exact | any wrong cell selection on axis boxes, including coplanar and touching faces | curved cases |
| closed-form volumes (box, cylinder, sphere, lens, frustum) | keel lanes, remus B26 | yes for the family | wrong material | a wrong shape with the right volume (a mirrored feature) |
| set identities, e.g. `V(A∪B) + V(A∩B) = V(A) + V(B)` | forge | yes | inconsistent operations | consistent errors |
| metamorphic invariance (translation, scale, symmetry, idempotence, split-and-rejoin, STEP round trip) | remus B26 | yes | translation-variant cuts (PR #603), operand-order dependence (vcad #892) | invariant errors |
| perturbation stability (1e-13 to 1e-6 nudges keep the verdict or refuse typed) | remus | yes, as a flag | fragile decisions near boundaries | - |
| non-vacuity (each family needs one exact success) | remus B26 | yes | a kernel that refuses everything | - |
| parameter-sweep coverage | forge ADR-0023 | yes | exactness that holds only on a null set of parameters ("flat on a bar" 3/33, "slot through a bar" 0/25) | - |
| `WellFormedMesh` plus winding membership | Lean intersector | yes, proved spec | every invalid mesh; set semantics at rational points | - |
| probe-grid set semantics with a 7-point unanimity vote | vcad PR #789 | heuristic | gross wrong topology | thin features between probes |
| mesh closedness thresholds | vcad (abandoned) | **no**: 3 unpaired edges on a sound blade, 64 on a sound fold, 236 on a broken cut | - | - |
| sampled validity oracles | vcad `validate.rs` (removed) | **no**: a correct result disagreed at 4 of 216 probes, a result 32 % short at 7 | - | - |
| volume-only WRONG with the kernel gate equal to the oracle | keel realsoak | **no**: WRONG = 0 partly by construction | - | - |
| OCCT as the only oracle | forge (dropped after one day, "We lose the independent oracle. This is the real cost."), wonky before step 3 | no: OCCT is off by 1.3e-6 on `adv-ep2-rot-sphere-minus-cone` (MEASURED, plan §7) | - | - |
| canonical exact serialization across implementations | forge (Python ⇄ Rust), wonky (JS, cpu1, cpu18, Metal byte identity) | yes for determinism | compiler, FMA and runtime drift | shared logic errors |

Two process findings: remus's first five B26 "findings" were all harness
bugs, and remus PR #603 found that the *volume measurement* integrated a
NURBS-trimmed wall over its analytic rectangle. An oracle needs the same
trim-aware exactness as the kernel, or it lies (DOCUMENTED, remus note).

### 3.8 Contracts compared

| element | vcad | remus | keel | csgrs / hypermesh | forge | OpenSolid | wonky today |
|---|---|---|---|---|---|---|---|
| result quality | `Fidelity{Analytic, TriangleSoup}` + `DegradeReason`, contagious | `quality: Exact \| Approximate \| Repaired`, `fallback`, `tolerance_report`, `stats` | PASS/DECLINE; tolerant tier `Confidence{salvaged, tier, achieved_tolerance}` | `Certified \| Approximate512Consumed`, the weakest certainty consumed | `provenance ∈ {exact, certified, sampled}` | `Fuzzy = Resolved \| Unresolved` (internal) | `exact` / `mesh <dev> <reason>` / `unresolved <reason>`; `approximation` label on mesh bodies; `operationEvidence` |
| failure form | `BooleanError{Ssi, InvalidResult}`; panics turned into errors because a panic poisons WASM | 9 categories, additive stable snake_case codes; `unsupported` cites the capability cell; budget errors report budget and consumption | `Err` with input unchanged | typed `HypermeshError`, `PredicateUndecided` | named refusals, e.g. `NotchRefused` (not this family) vs `NotchOutsideField` (permanent) | `HigherOrderZero`, `InfiniteRecursion`, `RefinementStalled` | `UnsupportedFeatureError(message)`, prose |
| fallback policy | automatic, reported | `ExactOnly \| AllowApproximate{budget} \| ApproximateOnly`; never silent; plain entry points pinned to `ExactOnly` | explicit `boolean_tolerant` call | policy byte `STRICT \| APPROXIMATE_512` | tiers | - | `modelingPolicy.boolean`: `hybrid-last` or `exact-only` (plan step 7) |
| budgets | harness timeouts only | `WorkBudgets` as operation counts (march steps 200, Newton 20, subdivision depth 6 ...), identical native and WASM | none | none (memory grows) | resolve levels | 10 non-shrinking refinements | fuel loops; plan step 11 adds a candidate-pair budget |
| naming | `Resolved \| Ambiguous \| Lost`, hard errors at consumers | evolution complete or explicitly unresolved | `Derivation{Created, Modified, Generated, SplitChild, MergeResult}` | `TriangleSource` per triangle | lineage plus rounded fingerprint | - | tags → source faces; `matched \| missing \| ambiguous \| unsupported` |

### 3.9 Claims versus evidence (agent-built kernels)

| claim | project | evidence found in the note | label |
|---|---|---|---|
| "2.4 billion-plus fuzz executions with zero crashes" | keel | a crash metric, not correctness | HEARSAY |
| "10,000 realistic projects, 0 wrong" | keel | the cited log entry is missing; WRONG is volume-only; one gate equals the oracle | HEARSAY, weakened |
| "0 produce a wrong solid" (fidelity matrix) | vcad | #895: silently wrong cone ∩ cylinder and torus ∩ cylinder; the matrix checks representation only | contradicted |
| 684/752 torture pass | vcad | pass needs only watertightness and volume within 5 %; a no-op difference passes | DOCUMENTED but weak |
| capability matrix 340/345 | forge | parameter sweeps answer 0-9 % (the author's own ADR-0023) | contradicted by the author |
| wins 46/54 against CGAL EPECK | csgrs | self-measured; loses small overlapping Booleans to manifold-rust and boolmesh | HEARSAY |
| exact STEP of curved Booleans | remus | README documents a wrong box ∩ sphere; sphere fuse takes 60-80 s | partly contradicted |
| proof of intersection correctness | Lean intersector | four theorems with standard axioms; the trusted base includes Mathlib definitions and the Lean compiler | DOCUMENTED |

## 4. War stories and anti-patterns

All DOCUMENTED in the linked notes unless marked.

### 4.1 Silent success: a plausible wrong solid

- **vcad, hemispherical socket (2026-08-11):** "Every failure ... was
  *silent*: the pipeline returned a closed, plausible-looking mesh of the
  wrong solid." Also a shell ring read 89 cm³ against a true 43 cm³, and a
  printed rotor's shaft bore came back solid.
- **vcad PR #789:** a Ø20 cylinder bored through a Ø60 sphere returned the
  untouched sphere; marching SSI produced "loose point dust", no split was
  recorded, and the no-crossing fast path sampled a pole vertex and decided
  containment. The fix declares non-analytic crossing pairs up front and
  routes them to the mesh fallback.
- **remus #190:** a cylinder cut by a 30° slab. The general fuse returned an
  open 5-face shell, and the public `boolean` silently substituted a 53-face
  mesh (674.79 against about 678.42). `compound_cut` accepted the fallback
  without disclosure until 2026-09-21.
- **BREP.io fillet:** a native failure "Log[s] native failure and return[s]
  unchanged clone".
- **CADmium:** "Add" printed "Failed to merge with OR" and kept the unmerged
  solid; "Remove" calls Truck's `and()` with the complement commented out
  (`// punch.not();`), so at the archived head it computes an intersection
  (INFERRED from the re-read code).
- **forge:** reading `.b == 0` on a `BiSurd` "silently dropped c√q + e√pq and
  reported 960 for 960 − 20√3"; every chamfer was wrong by d³/12 per corner
  until an invariant test caught it.

### 4.2 Epsilon debt

- **csgrs, BSP era:** coaxial equal-height cylinders lose their caps (#8);
  rotated cubes and frustums recurse until the stack overflows (#21, #110,
  "This is likely an epsilon tolerance issue"); six near-parallel half-spaces
  fail to intersect until a user edits EPSILON from 1e-8 to 1e-6 in a vendored
  fork (#107). The project then rewrote its core on exact reals.
- **keel:** about 393 literal epsilons in `boolean.rs` despite an
  architecture rule that only `tolerance.rs` may define them; a classification
  band that was bistable because detection used 1e-7 and classification 1e-6.
- **vcad #463:** "~45 private per-file consts ... `1e-6` appears
  independently in at least a dozen files".
- **BREP.io:** coplanar tool faces pushed by `max(4e-4, 1e-5·scale)`, fillet
  rails inflated by an absolute 0.1, a final `simplify(0.0004)`, none of it
  reported.
- **libfive:** eigenvalue cutoff 0.1, collapse error 1e-8, cell containment
  1e-6; Fidget's SVD cutoff is "very much a tuned value (alas!)".

### 4.3 Coplanar, touching and coincident geometry

- **Truck #57 (via CADmium):** two unit cubes touching face to face make
  `or` return `None`; overlap and separation work. Root cause (2026-04
  comment): coincident faces have no transversal intersection curve. Still
  open in 2026-09.
- **vcad #901:** three defects in coplanar-cap unions of prismatic parts:
  one-sided coincidence (`ring ∪ post` = 4946.55 exact, `post ∪ ring` =
  4951.99 with 30 open edges); phantom full-width chords from side planes
  that reach 0.5 mm into a 4.75 mm wall (12 posts: −9.3 % volume, 429 open
  edges); a split that used the first crossing span for every segment of a
  notched face.
- **vcad #894 and draft PR #904:** chained mesh Booleans re-split coplanar
  caps without bound; the merge guard is "calibration, not principle".
- **Cherchi #13:** coplanar faces "bite" holes and leave non-manifold sheets;
  the authors call it correct by their definition; BRL-CAD shelved its
  integration.
- **Curv #145:** two touching cubes export with an internal seam; the author:
  "I do not fully grok why union seams appear".

### 4.4 Oracles that lie

- **vcad:** closedness counts of 3, 64 and 236 unpaired edges cannot separate
  two sound results from a broken one; sampled validity oracles misjudged a
  3.2 mm³ plate and were removed; the torture "pass" accepts a difference that
  returns A unchanged (5 % volume slack).
- **keel:** WRONG defined by volume only; on the realistic soak lane the
  kernel gate "mirrors the oracle's threshold", so WRONG = 0 there is partly
  true by construction.
- **remus PR #603:** the volume measure integrated a NURBS-trimmed wall over
  its analytic rectangle; a follow-up fix regressed a revolve test from 5.1e-8
  to 5.68e-5, and the coordinator refused to widen the test budget because
  "it encodes the exactness contract".
- **remus B26:** all five initial findings were harness bugs.
- **forge ADR-0023:** 340/345 capability cells looked like success; parameter
  sweeps answered 3/33 and 0/25, because exact arc measures exist only at
  twelfth angles (Niven). "A null set ... which reads as success on a
  cell-counting instrument and as refusal to every user."
- **forge ADR-0020:** OCCT was dropped as an oracle after one day; "We lose
  the independent oracle. This is the real cost."
- **wonky's own case (MEASURED, plan §7):** the recover grader compared only
  with OCCT's fuzzy CSG and graded a wrong topology that OCCT shares as
  `exact`; fixed by arbitration (plan step 3).

### 4.5 Determinism

- **vcad #893 / PR #903:** per-process `HashMap` order plus LIFO slot-map
  recycling decided vertex keys and tie-breaks. The same 378-face union came
  back with 4067, 4075 or 4083 triangles, and the fallback volume was 8118.6
  or 8150.6 mm³, depending on the size of the process environment block.
  In-process repeats were bit-identical, so ordinary tests never saw it.
  Found by FNV-hashing all 7 fallback stages across 5 processes under
  `env -i` with a padded environment.
- **remus #483:** a tolerance "stamped at measured residual + 1 ulp" failed
  in the WASM build because simd128 contraction changed the residual by
  8.13e-16. Same patch, same test, different verdict.
- **Fidget:** the JIT `modulo` was removed because it did not agree bit-exactly
  with the canonical operator; its solver orders Jacobian columns by
  `HashMap` iteration (INFERRED from code).

### 4.6 Resource blow-ups

- **csgrs / hypermesh:** one chained rotated-copy intersection reached about
  116 GiB RSS with unbounded exact reals; the EMBER-style engine took
  3,312 s on a case the arrangement does in 48 s and CGAL in 0.09 s.
- **remus:** sphere-sphere fuse about 60-80 s per call (moved out of CI); a
  disjoint sphere cut through the mesh fallback lost 0.286 % volume at
  r = 10, 38.8 % at r = 0.01, and refused at r = 10,000.
- **vcad:** a plate took 23.8 s at corner radius 16, 5.2 s at 20 and 68.3 s
  at 25; a face-coincident union took over 400 s against 10 s for its mirror
  (#831); difference chains of about 40 tools did not finish in 25 minutes
  (#879).
- **Truck #68:** a cube/cylinder Boolean took 13-15 s on an M1.
- **keel:** a generic 64-sample pcurve fit cost 69-173 ms per closed seam
  until replaced by exact closed forms (90 ms → 0.9 ms per box trial).

### 4.7 Architecture and process

- **Fornjot:** "All those intersection tests that have already been
  completed are basically dead code"; the hard part was topology surgery and
  constructing test geometry. Edge identity (#993) took months. Five
  architecture experiments over 14 months, then the project ran out of steam
  while integrating. The postmortem: "I ran into a cliff", sponsorship before
  a product, incremental change instead of constant prototyping, "Be a tool
  instead of a building block".
- **Fornjot 2025-03-18 experiment:** storing geometry only in global 3D lost
  the local (u, v) coordinates, which "can't be reconstructed reliably" at
  seams and poles.
- **Aetheris:** a generic CIR executor "succeeded only for families already
  supported below"; one controlled side-hole fixture needed 21 milestone
  documents; admission depended on accumulated history (the stepped-hole
  cliff).
- **CADmium:** an app team with no kernel owner waited for Truck; the gaps
  that stopped it (#53, #57, #68) were still open more than two years later.
- **The one-night kernel:** "Booleans working" 16 minutes after the first
  kernel commit (2026-01-28); "stop Difference silently returning wrong
  solids against curved faces" on 2026-08-11.
- **Agent-scale code:** remus about 510k lines, hypercurve 369,550 lines,
  keel 78.7k lines in 23 days. remus's `AGENTS.md` records 93 `_ =>` match
  arms that silently absorb new surface and curve variants. The Lean author
  shows what an informal spec yields: three C++ bugs no black-box test would
  catch.

### 4.8 Anti-pattern → wonky rule

| anti-pattern (source) | wonky rule it violates or confirms | wonky status |
|---|---|---|
| return the unchanged input on failure (BREP.io, CADmium) | unsupported cases fail explicitly | enforced: refusals throw `UnsupportedFeatureError` |
| silent fallback to a mesh (remus #190, vcad before #789) | approximations carry explicit tolerances | enforced: `mesh <dev> <reason>` answer, `approximation` label, STEP refuses (plan §2.3) |
| geometric nudges and inflation (BREP.io, CADmium's commented +0.001) | explicit tolerances | enforced: corefine moves no vertex; the one topological tolerance is the documented 2^-36·scale collapse |
| two tolerances for one decision (keel's bistable band) | one declared tolerance per decision | open risk: recover has several certificate bounds; audit with the sweep lanes (proposal F1) |
| kernel gate equal to the oracle (keel) | oracles independent of the kernel | enforced: arbitration with third references (plan step 3) |
| sampled capability or validity tests (vcad `unrepresentable.rs`, `validate.rs`) | exact or certified decisions | enforced for the pre-certificate (exact joins over leaf meshes, plan step 2) |
| container order in tie-breaks (vcad #893) | deterministic results | enforced by byte identity across four targets; keep total keys (proposal F3) |
| FMA contraction breaking error-free transforms (remus #483) | F32x2 soundness | enforced: `-ffp-contract=off -fno-fast-math`, Metal `--fmad=false` (native-bridge.md) |
| exactness measured by case count (forge ADR-0023) | honest coverage | open: no sweep coverage report (proposal F1) |
| intersection tests first (Fornjot) | drive by real failing models | followed: bake-off corpus from real parts, R20 acceptance set |
| recipes as the only Boolean (Aetheris) | general Boolean with explicit refusals | followed: exact arms in front, hybrid as the last arm (plan step 7) |

## 5. What wonky should take: ranked proposals

**Context.** The Boolean architecture is decided (corefine plus recover), steps
1 to 5 and 7 of the plan are done, and the fillet bake-off has its own
candidates A to D ([fillet.md](../fillet.md) §5). The fringe kernels offer no
better Boolean. What they offer is (a) test and oracle designs that found real
bugs elsewhere, (b) two representation fixes for the tagged tessellation and
the corefine → recover hand-off, (c) a result contract, and (d) a certified
subdivision design for the curves recover still refuses.

**Ranking.** By expected benefit per unit of risk for the path that already
exists: first guarding the hybrid, which just became the default last arm;
then removing the cause of recover's most dangerous heuristic; then contracts;
then coverage. All Bend-fit statements are INFERRED.

| rank | proposal | plugs into | size | depends on |
|---|---|---|---|---|
| F1 | oracle lanes from the fringe: exact box volume, contact, metamorphic, perturbation stability, non-vacuity, parameter sweeps, compositions | `scripts/bakeoff` (run, judge, arbiter), `fixtures/bakeoff`, R20 acceptance, `npm test` | S-M | none |
| F2 | canonical per-circle sample lattice in the tagged tessellation | `kernel/tessellate.bend`, printMesh `{tags: true}`, plan step 6 encoder; effect on corefine and recover's sliver pass | S-M | none |
| F3 | construction-identity provenance from corefine to recover | corefine assembly and weld output, the wire format, recover corners and curves; plan step 9 | M | none; pairs well with F2 |
| F4 | stable failure codes, capability cells, budgets and certainty lineage | `src/errors.mjs`, refusal sites in `src/` and `kernel/hybrid`, `operationEvidence`, fillet refusals | M | none |
| F5 | exact semantic membership oracle | arbiter (plan step 3), judge, plan step 13 interference | M | F1 lanes to feed it |
| F6 | certified subdivision for quadric-pair branch topology | recover curve table, sibling R4, plan step 9 | L | sibling R4, R5 |
| F7 | multi-root evaluation for compare, interference and revision diff | `kernel/hybrid` entry, plan steps 12 and 13, viewer diff | M | none |

### F1. Oracle lanes from the fringe

**Idea.** Add seven lanes to the bake-off harness. Each lane reports
PASS / DECLINE (named refusal) / WRONG per case, keel-style, next to the
existing grades.

1. **Exact box-volume lane** (hypermesh `boolean_box_oracle.rs`, MIT). 1-4
   axis-aligned boxes on an integer grid, random operation or small CSG DAG.
   The reference is exact: compress coordinates per axis, classify each grid
   cell centre by its winding vector, sum the cell volumes the operation
   keeps. Planar results must match exactly (wonky's planar tessellation has
   deviation 0).
2. **Contact lane** (keel `three_bucket.rs`, ideas only, GPL). Every fourth
   box trial puts B against a face of A at offset δ with the cross axes
   overlapping. Express δ in multiples of the declared tolerance,
   `{0, ±tol/10, ±10·tol}`, plus a lane of a few F32x2 ulps, so the lane
   stays meaningful when tolerance or scale change. "Random floats never
   touch, so without this lane the tolerant tier's whole class would be
   unmeasured."
3. **Metamorphic lane** (remus B26, Apache). Replay every corpus and
   adversarial case under rigid transforms (translation by about 1e3 mm,
   exact 90° rotations, a 17° rotation), uniform scale ×1e-3 and ×1e3, operand
   swap for union and intersect, and idempotence (A ∪ A, A ∩ A, A − A).
   Translation invariance found real bugs in remus (PR #603) and operand order
   in vcad (#892); in F32x2 it also exercises absolute-coordinate precision.
4. **Perturbation-stability rule** (remus). Around every contact or tangency
   case, nudges by multiples of the tolerance may change `exact` into a named
   refusal only at the documented boundary; any change into WRONG, or a
   refusal flipping to success and back, fails.
5. **Non-vacuity gate** (remus B26). Every corpus category needs at least one
   exact result, so a kernel that refuses everything cannot pass.
6. **Parameter-sweep coverage** (forge ADR-0023). Per family, sweep one
   parameter over 20-40 values (hole depth, tilt 0-89°, flat depth on a bar,
   slot offset, boss radius against hole radius) and report the fraction
   exact / mesh / refused / wrong, instead of one representative case.
7. **Composition lane** (Aetheris stepped-hole cliff). N ≥ 3 compositions of
   admitted exact arms (through hole r2, blind r3, larger shallower blind r4;
   counterbore plus countersink plus cross hole), run under
   `WONKY_BOOLEAN_DIFF=1` so each admitted result is compared with the
   hybrid.

Plus vcad's **worse-class baseline**: record each case's class, fail CI on any
per-case worsening, and record flaky cases at their worse class.

**Where it plugs in.** `scripts/bakeoff/run.mjs` and `judge.mjs` (new
suites), `fixtures/bakeoff` (generators, not stored cases, like
`ensureJobs`), `scripts/bakeoff/arbiter.mjs` (the box lane needs no arbiter:
its oracle is exact), the R20 acceptance report.

**Bend fit.** The lanes live in the JS harness. Case generation should use a
counter-based U32 hash of `(lane, trial, draw)` so any trial is addressable
in O(1) and shards sum exactly (keel's LCG needed linear seeking). A Bend
generator is possible and would be a uniform fork over trials.

**Expected benefit.** It targets the wrong-answer classes the corpus lacks
and the fringe found elsewhere: translation variance, operand order, touching
boxes at sub-tolerance offsets, history-dependent admission, and exactness
that holds only on a null set of parameters. The hybrid became the default
last arm on 2026-09-24; these lanes are the cheapest guard for that decision.

**Risk.**

- Harness bugs: remus's first five B26 findings were all harness bugs.
  Budget time to debug the lanes themselves.
- Scale ×1e3 hits the known exporter coordinate limit (`InvalidSource`, plan
  step 9); classify it as a known refusal, not as WRONG.
- Run time on a loaded machine; keep a small deterministic CI replay (remus:
  about 5 s) and an opt-in campaign.

**First acceptance test.**

- Box lane, 10,000 seeded trials at cpu18: WRONG 0, every DECLINE named,
  per-δ breakdown printed.
- Metamorphic replay of the 38 corpus cases × 6 transforms: no verdict change
  except the documented exporter-scale refusal; volumes within area ×
  deviation of the transformed reference.
- Mutation check: re-introduce the step-4 unification tolerance 2^-40·scale
  (fixed on 2026-09-24) and at least one lane must report WRONG.

### F2. A canonical per-circle sample lattice in the tagged tessellation

**Idea.** Sample every circle from one global lattice keyed by the circle,
not by the arc (Fornjot `core/approx/circle.rs`, 0BSD, copyable; vcad
`split::canonical_arc_points` and `freeze.rs`, Apache, rewrite):

- **Key:** centre, sign-canonical normal, radius, taken from the carrier.
- **Frame:** x = the world axis least parallel to the normal, projected and
  normalized (vcad), so two operands with differently oriented input frames
  get the same lattice.
- **Count:** `n` from the chord formula for (radius, deviation), rounded up to
  a canonical ladder (for example 3·2^k), so coaxial circles of different
  radii get nested lattices.
- **Points:** angle `k·2π/n` from the exact integer `k`; an arc emits the
  lattice points strictly inside its span plus its own B-rep end vertices.
  A lattice point within a stated fraction of the spacing from an end vertex
  is skipped, never snapped (Fornjot's missing epsilon creates 1e-15
  slivers).
- **Surfaces:** cylinder and cone rulings, sphere and torus meridians use the
  same angular lattice about the axis.

Today `arc_interior(first, sweep, count)` in `kernel/tessellate.bend` divides
each arc from its own start angle, so coincident curves from different leaves
do not share samples. The plan names the consequence: "the slivers come from
differently tessellated coincident curves, and the sliver absorption is where
recover deletes real faces today" (plan §2.2); `plate-countersink` is exact
with 36 absorbed slivers (proto-recover.md corpus table).

**Where it plugs in.** `kernel/tessellate.bend` (`chord_count`,
`arc_interior`, `row_interior`), printMesh `{tags: true}` and the plan step 6
encoder. Effects downstream: corefine sees exactly coincident segments and
facets instead of near-coincident ones; recover's sliver pass has nothing to
absorb along those curves.

**Bend fit.** Each point is a pure function of (circle key, k, n), so equal
inputs give bit-identical F32x2 words on all four targets without any
neighbour communication. Uniform map, GPU-shaped.

**Expected benefit.**

- Removes the cause of most tessellation slivers instead of repairing them.
  Sliver absorption was behind two critical defects (real faces deleted,
  plan §7); fewer absorptions means fewer chances for that class.
- Fewer triangles on coincident curves; recover time grows superlinearly
  with corefine's triangle count (plan §3).
- Tangent and coaxial cylinders from two leaves get identical facets, which
  corefine's exact coincidence handling decides without near-degenerate
  crossings (INFERRED; open question 1).

**Risk.**

- Rotated leaves carry normals that differ in the last bits, so their frames
  differ and nothing conforms. Deriving the frame from the unified carrier
  class (`kernel/hybrid/unify.bend`) extends the benefit, at the cost of
  running unification before tessellation.
- The ladder can double sample counts on some circles.
- Every tessellation changes, so corpus results stop being byte-identical to
  the judge round. Run behind a flag and re-baseline deliberately.
- The harness keeps the countersink non-conforming *on purpose* to test
  sliver handling ("this is part of the test", bakeoff.md). Keep a
  non-conforming generator for that case and for mesh operands.
- Exact coincidence is itself degenerate input for a mesh Boolean. corefine is
  built for it (symbolic perturbation, exact weld), but the cost must be
  measured.

**First acceptance test.**

- Unit test: two arcs on one circle, from input frames rotated against each
  other, give byte-identical shared interior samples on all four targets.
- `plate-countersink`: exact with 0 absorbed slivers (today 36).
- A new case, a hole circle of leaf A equal to a boss rim of leaf B: shared
  vertices on the circle are identical.
- Corpus: still 32 exact; no adversarial grade worse; corefine triangle count
  on `plate-hole-grid-10x10` within +10 %.

### F3. Construction-identity provenance from corefine to recover

**Idea.** corefine already decides every new vertex as a crossing of an edge
of one operand with a face of the other (`kernel12`), and every new edge
belongs to a (P face, Q face) group (proto-corefine.md, algorithm steps 3 and
5). Emit that as an optional provenance section, in hypermesh's form:

```
vertex identity:  in <leaf> <vertex>
                | x <edge tags (one tag for a tessellation edge, two for a B-rep edge)> <face tag>
edge identity:    source <leaf> <edge> | pair <tag P> <tag Q>
```

- The **carrier set** of a vertex is the union of its tags' carrier classes.
  One class: an interior sample; two: a point on that pair's curve; three: a
  corner, refined by Newton on exactly those three carriers.
- corefine's exact-position repairs (weld, zip, the 2^-36·scale collapse)
  merge identities by union; a merged set that cannot meet in a point is a
  named refusal (hypermesh: "one construction identity materialized at
  contradictory points" is an error).
- A shared feature is elided only when proven by identity, never by a numeric
  zero (hypermesh's fuzzer-found bug; Aetheris: "Do not treat numerical zero
  as proof of topological identity").

recover then takes corners and curve assignments from the Boolean instead of
re-deriving them from patch adjacency, and treats two patches as a sliver
candidate only when identities say both boundaries are the same carrier pair
tessellated twice.

**Sources.** hypermesh `polygon.rs` identity enums and
`ArrangementPointArena::insert` (MIT); Cherchi's LPI/TPI tuples as the same
idea for implicit points (MIT layer); Aetheris for the rule.

**Where it plugs in.** corefine `assemble.bend` and `weld.bend` output; the
wire format (bakeoff.md "Job and result format", optional section); recover
patches, corners and curve selection. This is the plan's step 9 item
"corefine → recover provenance section", made concrete.

**Bend fit.** Identities are small U32 tuples. Dedup and merging are a sort
by a total identity key plus a segmented scan, uniform and hash-map-free (the
vcad #893 lesson).

**Expected benefit.**

- recover's most heuristic stage (corner detection and sliver absorption from
  adjacency) gets exact provenance; this is where recover wrote wrong exact
  B-reps before plan step 2.
- The input R4 needs for space quartics: which vertices lie on which pair's
  curve, and which are corners.
- A cheaper recover: no adjacency search for corners.

**Risk.** The union rule inside corefine's repairs may produce ambiguous
corners; unification classes (plan step 4) must be used instead of raw tags;
the section must stay optional to keep today's byte identity.

**First acceptance test.** With the section on: the 32 exact corpus cases give
the same recover topology counts and volumes within 1e-12; the corner set
from identities equals the adjacency-derived one on every corpus and suite
case where recover succeeds (differences listed and explained); no adversarial
grade worse; corefine compute +5 % at most.

### F4. Stable failure codes, capability cells, budgets and certainty lineage

**Idea.** Keep the prose, add machine-readable fields (remus operation
contract and failure taxonomy, Apache: types and doc text portable with
attribution; vcad `DegradeReason`; csgrs "weakest certainty consumed"; forge
refusal classes; keel decline provenance):

- `code`: stable snake_case, additive only ("Codes are API: never rename one,
  only add"), from one registry file;
- `category`: `invalid_input | invalid_topology | unsupported |
  nonconvergence | resource_limit | tolerance_violation | quality_refused |
  internal` (remus's nine, minus `cancelled`, which a pure batch model does
  not need);
- `capability`: for `unsupported`, the cell, for example
  `recover.curve.cylinder_cylinder_quartic`;
- `permanence`: `not_this_path` (another route may succeed) or
  `not_representable` (forge's `NotchRefused` vs `NotchOutsideField`);
- `budget {name, limit, used}` for resource refusals, with budgets as U32
  operation counts threaded through the recursion, identical on JS, C and
  Metal (remus `WorkBudgets`); this is plan step 11's candidate-pair budget;
- `certainty` on every result, `exact | certified_mesh(dev) | estimate`, plus
  the weakest certainty of its inputs (`lineage`). Re-promotion after a mesh
  operand is allowed only when recover certifies the whole result boundary;
  the rule must be written down, because plan §2.4 allows a later exact
  recovery.
- For fillets: `cliff_encountered {edge, face, requested_radius,
  available_radius}` and `radius_too_large {edge, max_radius}`.

Bend emits `unresolved <code> <reason>`; JS maps it onto
`UnsupportedFeatureError` fields.

**Where it plugs in.** `src/errors.mjs` (today `UnsupportedFeatureError(message,
token)` only), refusal sites in `src/boolean.mjs` and `src/hybrid.mjs`, the
corefine gate and recover `BCert`/`BNo` strings, `operationEvidence`, the R20
report, and the fillet bake-off's "largest feasible radius" (fillet.md §5.1
item 8).

**Bend fit.** Codes are fixed tokens in canonical text; budgets are U32 fuel.
No new numerics.

**Expected benefit.** LLM callers branch on codes, not prose. A census counts
refusals per code across corpus and suites, which yields the capability matrix
and keel's decline provenance (about 70 % of keel's fuzzer declines were
artifacts of ill-posed input). The certainty field makes vcad's
"contagious degradation" visible instead of silent.

**Risk.** Churn across many refusal strings; manual mapping; codes frozen
forever once published.

**First acceptance test.** Every refusal raised by `npm test` and the four
suites carries a registered code; a census script prints counts per code; the
codes are identical on all four targets; a test fails when a new refusal site
lacks a code.

### F5. An exact semantic membership oracle

**Idea.** A fourth reference for arbitration that depends on neither OCCT nor
manifold3d:

1. Sample probe points on a dyadic grid over the case's bounding box.
2. Keep only probes whose distance to every leaf carrier exceeds the
   deviation plus a margin, certified by an interval bound on each carrier's
   implicit function (cheap for plane, cylinder, cone, sphere, torus).
   Subdivide hierarchically: a cell whose interval proves it fully inside or
   outside every leaf needs no probes (Fidget/OpenSolid style).
3. Decide exact CSG membership from the leaves' implicit polynomials: the
   probe is dyadic, so every sign is exact in multi-limb arithmetic.
4. Decide the result's membership by exact ray winding against the result
   mesh, with axis rays and then moment-curve directions and an exact graze
   test (Lean `windingAtH`, hypermesh).
5. Any mismatch is a certified WRONG (vcad's probe grid with a unanimity vote
   was a heuristic version; the negative results on closedness show why a
   semantic oracle is needed).

**Where it plugs in.** `scripts/bakeoff/arbiter.mjs` (plan step 3: "A new
adversarial case whose oracles disagree needs a recipe"), the judge, and the
`interference(a, b)` cross-check of plan step 13.

**Bend fit.** Uniform per probe and per cell; a fork over a dyadic tree; exact
signs at fixed degree (at most 4 for a torus implicit), so a static limb count.

**Expected benefit.** Fewer disputes that need hand-written recipes; an oracle
whose answers are exact wherever it answers.

**Risk.** It cannot see features thinner than the probe spacing or within the
deviation of a carrier, exactly where the grazing cases live. It complements
closed forms and the pre-certificate and never replaces them (the sdf
lesson). `brep` leaves need an exact point-in-B-rep test instead of an
implicit; restrict to CSG-of-primitive cases first. It must never become a
kernel gate (keel).

**First acceptance test.** Agrees with every arbitrated decision where it
answers; flags each judge-round-2 sdf wrong answer whose missing feature is
at least two probe spacings wide (the lost 1.2 mm wall, the 3 mm base plate,
the closed 0.4 mm slot at 0.1 mm spacing); 0 mismatches on the 32 exact corpus
results.

### F6. Certified subdivision for quadric-pair branch topology

**Idea.** Re-implement OpenSolid's zero-set design clean-room (MPL-2.0 source)
for `f(u, v) = implicit_B(param_A(u, v))` over a face's uv domain:

- dyadic cells as U32 `(level, index)` pairs, compared exactly;
- prune a cell when the bound of f excludes zero with resolution
  `|lo/hi| ≥ 0.5`;
- when `fu` or `fv` is sign-definite, the zero set in the cell is a graph read
  from edge signs; when the Hessian determinant is resolved positive, there is
  at most one tangent point; negative, a saddle;
- boundary solutions first, then tangent clusters, then crossing clusters with
  tangent exclusions (OpenSolid `Intersection.solveInterior`);
- tighten each cell's bound with the mean-value enclosure from its endpoints
  (`Curve.Segment.new`);
- at the depth budget: refuse `higher_order_zero` by name.

Output: branch count, turning points, tangent points and a certified uv box
chain per branch. The curve itself stays R4's closed form or a procedural
implicit curve (a monotone 1D solve in certified boxes) for internal
evaluation.

**Where it plugs in.** The certificate half of sibling proposal R4
([oss-brep-kernels.md](oss-brep-kernels.md) §5, "A certified
intersection-curve entity for space quartics"): pipe-tee, Steinmetz, cross
holes, and torus pairs that have no convenient closed form. Plan step 9.

**Bend fit.** Excellent: a pure fork-join recursion with uniform work per
cell (one fixed polynomial per pair type), materialized level by level under
a U32 depth budget because Bend has no lazy trees; clusters merge across
split lines at each join by dyadic keys. F32x2 intervals must be widened
outward (about 2^-44 relative plus an underflow floor); Metal has no rounding
modes.

**Expected benefit.** An independent certificate of branch topology that
does not depend on the mesh, typed tangent and saddle points instead of
sampling accidents, and one machinery for point inversion and curve/face
intersection.

**Risk.** Large. Tangent curves end in refusal by design. Conditioning near
turning points in F32x2 is unknown (open question 4). OpenSolid's own cluster
step can merge two roots in adjacent cells (INFERRED); certify uniqueness
over the cluster hull or return all solutions.

**First acceptance test.** Branch counts and turning points for pipe-tee and
equal-radius Steinmetz agree with R4's closed-form analysis and with the
number of closed tagged polylines per tag pair in corefine's result; a
radius-ratio sweep `1 ± 2^-k` (k = 4 … 40) is certified or refused, never
wrong; all four targets byte-identical.

### F7. Multi-root evaluation for compare, interference and revision diff

**Idea.** Evaluate several Boolean results from one intersection stage
(hypermesh's truth DAG; hypercurve's four region Booleans from one
evaluation; Cherchi's bitset selection). In corefine the decisions depend on
the perturbation direction (Manifold's `expandP`: union expands P,
subtract and intersect contract it), so one decision pass with P = A
contracted yields A ∩ B and A − B, and a second pass with P = B yields B − A.
Broad phase and BVHs are shared; assembly runs per result.

**Where it plugs in.** A `compare(job)` entry next to `hybrid.boolean(job)`;
plan step 13 (`interference(a, b)`); the viewer's diff and review
([../viewer-ui.md](../viewer-ui.md)): between two revisions of one part,
A − B is removed material and B − A is added material, each with source-face
tags.

**Bend fit.** Per-result assembly is an independent fork.

**Expected benefit.** A consistent triple for geometric diff and interference
with provenance, at less than the cost of three Booleans; an introspection
feature none of the fringe kernels ships in a CAD context.

**Risk.** In degenerate contact the two passes may decide a coincident face
differently, so A ∩ B and A − B need not partition A exactly there; test the
identity and document the exceptions. Modest speed gain.

**First acceptance test.** On two revisions of a corpus part:
`V(A∩B) + V(A−B) = V(A)` and `V(A∩B) + V(B−A) = V(B)` within 1e-9 relative
(planar) or area × deviation (curved); results equal separate Booleans on
non-degenerate cases; the compare call costs at most 1.6x one Boolean.

### 5.8 Inputs for the fillet bake-off (already planned; no new proposal)

[fillet.md](../fillet.md) §5 already takes the remus pair list and radius
bounds for candidate A. This chapter's sources add:

- **Typed refusals with numbers** (remus): `CliffEncountered{edge, face,
  requested_radius, available_radius}` makes A's "largest feasible radius"
  (§5.1 item 8) a result field (F4).
- **Unit tests from war stories** (remus): the plane-cylinder convexity table
  (a through-hole rim is convex), the inward bound `r < r_c` instead of keel's
  `r_cyl > 2r` (check the derivation independently), and the wedge half-angle
  `(π − angle(n1, n2))/2` on a 178.9° ridge.
- **Evidence for candidate B's declared tangency** (BREP.io): a helper tube is
  always G1-tangent to its host faces; when the Boolean has to discover that
  contact, the result is slivers and about 2,800 lines of cleanup. Contact
  curves must come from the construction (fillet.md §5.2 step 3 already says
  so).
- **Closed-form fillet oracles** (forge): `FilletedBox`, `RoundedBox`,
  `VariableFilletedBox` volumes via Pappus give exact references beyond OCCT
  and the Onshape probes.
- **A must-pass corner case** (keel): filleting all 12 edges of a box declines
  at the first 3-edge corner in keel; if it is not yet in the fillet corpus,
  add it for A.
- **Disclose the engine** (remus `fillet_cascade`): if more than one fillet
  method reaches production, each blend face records which one built it.
- **User-facing semantics** (Curv blend article): SDF blends are
  constant-thickness, CAD fillets constant-radius; worth one paragraph in
  wonky's documentation for users and LLMs.

### 5.9 Anti-proposals

- **Do not port unbounded exact reals** (hyperreal, forge's fields): one
  chained case reached 116 GiB RSS. Keep fixed-degree predicates on grid or
  F32x2 inputs and re-tessellate exact geometry between operations.
- **Do not add a sampled capability pre-check** (vcad's 24-sample
  `unrepresentable.rs`). wonky's pre-certificate is an exact join; keep it
  that way.
- **Do not accept results by necessary conditions after healing** (remus: up
  to three heal passes, then Euler and manifold gates; a documented wrong
  box ∩ sphere passes).
- **Do not nudge or inflate** geometry to steer coplanar cases (BREP.io).
- **Do not measure coverage by case or cell count** (forge ADR-0023).
- **Do not make recipes the only Boolean** (Aetheris); keep exact arms as a
  front door with the hybrid behind them and diff mode on.
- **Do not let a kernel gate equal an oracle predicate** (keel).
- **Do not port or trust agent-written kernel code by volume** (remus 510k,
  hypercurve 370k lines); take contracts and test designs, which are short and
  checkable.
- **Do not transliterate GPL, AGPL, LGPL or ELv2 code** (keel, Aetheris,
  Cherchi's predicate file, CADmium, pymadcad, libfive Studio).
- **Do not produce Boolean results from SDF or dual contouring** (already
  decided; Curv #145 seams and libfive self-intersections confirm it).

## 6. Open questions worth a prototype

1. **Does a canonical lattice make corefine cheaper or dearer?** Exactly
   coincident samples replace near-degenerate crossings with exact ties.
   corefine resolves ties by symbolic perturbation and exact weld; whether
   that is faster than today's near-misses is unknown. *Prototype:* F2 behind
   a flag; compare corpus cpu18 compute, corefine triangle counts and recover
   sliver counts.
2. **Do construction identities survive corefine's repairs?** Weld, zip and
   the 2^-36·scale collapse merge vertices. *Prototype:* emit identities
   without consuming them; count merged vertices whose carrier sets cannot
   meet in a point, on the corpus and the four suites. If the count is not
   zero, F3 needs a refusal rule first.
3. **Which mesh-validity contract should CertifiedMesh bodies follow?**
   wonky requires a closed 2-manifold and refuses line and point contact. The
   Lean spec allows edge and vertex multiplicity because a manifold output
   requirement is unsatisfiable for some exact intersections. Two FDM bodies
   touching along an edge slice ambiguously, so wonky may prefer refusal, but
   a flagged non-manifold mesh could let more chained operations continue.
   *Prototype:* port `checkMeshWF` (MIT) to a harness grader and count how many
   of today's contact refusals it would accept.
4. **How much outward widening do F32x2 intervals need, and how many cells
   stay unresolved near branch points?** *Prototype:* cylinder/cylinder f on
   dyadic cells with a 2^-44 relative widening plus floor, on pipe-tee and a
   radius-ratio sweep; record depth reached and refusals (feeds F6).
5. **Can wall thickness become a certified lower bound?** Plan step 13 uses
   sdf rays, labelled as an estimate. Fidget-style interval classification
   with outward rounding over exact carrier implicits, or recover's exact
   triangle distances (`clear.bend`), might certify "no wall thinner than t"
   where it answers. *Prototype:* the 1.0 mm vent membrane of
   `enclosure-shell`.
6. **What share of wonky's refusals are ill-posed input?** keel attributes
   about 70 % of its fuzzer declines to ill-posed random input. *Prototype:*
   after F4, a census of the four suites by code and permanence.
7. **Are recover's comparisons all bounded surds?** forge decides
   `sign(a + b·√d)` by comparing `a²` with `b²d`. If every plane/cylinder/cone
   vertex comparison in recover reduces to per-intersection `(a, b, D)`
   comparisons of bounded degree, a static limb count per predicate follows
   (overlaps sibling R5). *Prototype:* enumerate the comparisons in recover's
   `geom.bend`.
8. **Is hypercurve's 2D contract worth adopting for sketches?** Exact
   line/arc region Booleans (all four results from one evaluation), offsets
   with an explicit corner style (FDM clearances), vertex fillets and
   chamfers by radius or setback with `Decided | Uncertain(reason)`; plus
   Fidget's residual tapes with lane-packed forward AD for the sketch solver,
   with DOF diagnostics added. *Prototype:* one FeatureScript sketch family
   with arcs, compared against wonky's current sketch solver.
9. **Does a single lattice frame from carrier unification close the
   rotated-leaf gap of F2?** *Prototype:* compute `unify.bend` classes before
   tessellation and take each circle's frame from its class representative;
   measure on the 14 rotated coplanar cases.

## 7. Catalog of the remaining sources

Not deep-read. Metadata from `gh api` on 2026-09-24 (stars, last push,
license as GitHub reports it); descriptions are the repositories' own. Claims
about what a project uses internally are HEARSAY unless a note covers them.

| name | kind | metadata (2026-09-24) | license | one line | relevance for wonky |
|---|---|---|---|---|---|
| [Manifold](https://github.com/elalish/manifold) | mesh Boolean library (C++) | 2,289 stars; pushed 2026-09-24 | Apache-2.0 | the Boolean3 that corefine ports; README users include OpenSCAD, Blender, Godot | deep-read in the sibling chapter: [sources/manifold-elalish-manifold.md](sources/manifold-elalish-manifold.md) |
| [pymadcad](https://github.com/jimy-byerley/pymadcad) | CAD library (Python) | 293 stars; pushed 2026-09-18 | LGPL-3.0 | script CAD directly on triangle meshes, with mesh bevels and blends (per scout) | ideas only; mesh blends without certification |
| [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | CSG library (JS) | 949 stars; pushed 2026-08-20 | MIT | "fast and dynamic CSG implementation on top of three-mesh-bvh" | viewer-side preview at most; float decisions |
| [csg.js](https://github.com/evanw/csg.js) | CSG library (JS) | 1,861 stars; pushed 2019-10-05 | MIT | the BSP ancestor with one epsilon plane classifier | its failure catalogue is documented by csgrs (section 4.2) |
| [JSCAD (OpenJSCAD.org)](https://github.com/jscad/OpenJSCAD.org) | code-CAD (JS) | 3,245 stars; pushed 2026-09-24 | MIT | JavaScript code-CAD with a csg.js-derived polygon kernel, widely used for printing | user-facing API reference only |
| [ImplicitCAD](https://github.com/Haskell-Things/ImplicitCAD) | implicit CAD (Haskell; GitHub reports JavaScript) | 1,578 stars; pushed 2026-04-13 | AGPL-3.0 | "CSG, bevels, and shells; 2D & 3D geometry; 2D gcode generation" | ideas only; rounded CSG is SDF blending, not fillets |
| [replicad](https://github.com/sgenoud/replicad) (with CascadeStudio, bitbybit) | code-CAD over OCCT WASM (TS) | 688 stars; pushed 2026-09-04 | MIT | "build browser based 3D models with code" | API ergonomics for code-CAD; wraps OCCT, which wonky may not link |
| [opencascade.js](https://github.com/donalffons/opencascade.js) | OCCT Emscripten build | 928 stars; pushed 2023-08-15 | LGPL-2.1 | the WASM OCCT most browser code-CAD depends on | a stale shared dependency of the wrap-OCCT camp |
| [Chili3D](https://github.com/xiangechen/chili3d) | browser CAD app (TS) | 4,859 stars; pushed 2026-09-19 | AGPL-3.0 | "A 3D CAD running entirely in the browser", over OCCT WASM | ideas only |
| [PicoGK](https://github.com/leap71/PicoGK) | voxel kernel (C#, OpenVDB) | 1,109 stars; pushed 2026-08-27 | Apache-2.0 | "compact and robust geometry kernel for Computational Engineering"; additive-manufacturing parts as voxel fields | FDM field operations (lattices, infill) at best; no exact geometry or certificate |
| [Descartes.jl](https://github.com/JuliaGeometry/Descartes.jl) | implicit CSG (Julia) | 51 stars; pushed 2024-07-08 | MIT | "Software Defined Solid Modeling" for 3D printing | dormant; nothing beyond libfive |
| [curvo](https://github.com/mattatz/curvo) | NURBS library (Rust) | 213 stars; pushed 2026-06-25 | MIT | "NURBS curve / surface modeling library for Rust" | portable if wonky ever needs B-spline evaluation for R4 curves; not read |
| [verb](https://github.com/pboyer/verb) | NURBS library (JS/Haxe) | 815 stars; pushed 2025-04-02 | MIT | "Open-source, cross-platform NURBS" | older reference for NURBS evaluation and intersection; not read |
| [fogleman/sdf](https://github.com/fogleman/sdf) | SDF meshing (Python) | 2,006 stars; pushed 2024-08-10 | MIT | "Simple SDF mesh generation in Python" | teaching-grade SDF; nothing beyond Fidget |
| [Dune3D](https://github.com/dune3d/dune3d) | CAD app (C/C++) | 2,090 stars; pushed 2026-09-06 | GPL-3.0 | "3D CAD application"; kernel choice not checked here (scout: wraps OCCT) | ideas only |
| [Halfspace](https://github.com/mkeeter/halfspace) | SDF IDE (Rust) | 35 stars; pushed 2026-09-12 | MPL-2.0 | "An experimental IDE for solid modeling with distance fields"; co-designed with Fidget 0.5.1's GPU pipeline | the newest step of the Keeter line; UI ideas for live parameter editing |
| [zolygon](https://github.com/HundredBillion/zolygon) | kernel (Zig) | 4 stars; 16 KB; pushed 2025-10-17 | MIT | describes a unified NURBS and mesh kernel | essentially empty |
| [kupcad](https://github.com/kupcad/kupcad) | CAD language (Zig) | 0 stars; created 2026-07-27; pushed 2026-09-22 | AGPL-3.0 | "high-level, expression-based parametric CAD language" | early; ideas only |
| [OSCADml](https://github.com/OCADml/OSCADml) | OpenSCAD DSL (OCaml) | 21 stars; pushed 2023-05-02 | GPL-2.0 | OCaml front end for OpenSCAD | dead |
| [ruckus](https://github.com/cbiffle/ruckus) | implicit CAD (Racket) | 53 stars; archived; pushed 2018-12-24 | NOASSERTION | Lisp-family implicit modeling | archived |
| [Ondsel shutdown post](https://www.ondsel.com/blog/goodbye/) | blog | page metadata 2024-10-30 | - | VC-backed FreeCAD company: "we failed to find commercial adoption to justify a venture-capitalized startup"; 145 PRs merged upstream after the 2024.2 release, plus an integrated assembly workbench and solver (DOCUMENTED, downloaded page) | a business postmortem, not a geometry one |
| [Plasticity](https://www.plasticity.xyz/) | commercial NURBS modeler | perpetual licence, $0 trial / $175 / $299 | proprietary | "exposes the full power of Parasolid and xNURBS" (DOCUMENTED, site); the move from C3D to Parasolid is per scout (HEARSAY) | an indie tool that bought a kernel rather than write one |

Sources for this chapter's scout-level claims not repeated above: the
deep-read notes in [sources/](sources/) linked from section 2, and the wonky
documents listed under "Status and method".
