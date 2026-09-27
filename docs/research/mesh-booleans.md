# Robust mesh Booleans

Chapter of the wonky research knowledge base, 2026-09-24. English.

**Status and method.**

- **Deep reads.** 18 source notes cover this topic. They are under
  [sources/](sources/) and linked in section 2. This chapter re-read all 18
  in full.
- **Publish-first step.** It was a no-op: `tmp/research/notes/` holds no JSON
  for this topic, and every note already had its Markdown file.
- **Workflow input.** The scout's landscape and catalog. The 17 catalog-only
  sources are in section 7.
- **Checks made for this chapter** (working tree, 2026-09-24):
  - [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) (full),
    [../proto-corefine.md](../proto-corefine.md) ("Numeric model and
    guarantees"), [../bakeoff.md](../bakeoff.md).
  - `kernel/real.bend`: `add` is still the "sloppy" double-word add (TwoSum
    on the high words, then a plain F32 sum of the error and both low words).
    `kernel/hybrid/corefine/shadow.bend` calls `R.add`/`R.sub` 12 times in its
    `Interpolate`/`Intersect` ports. Both DOCUMENTED by reading the code.
  - `fixtures/bakeoff/*.json` and `docs/*.md` contain no Solidean,
    ThingiCSG or cube-grid case (grep). So the iterated-CSG evidence below is
    external only.
- Nothing was built or run: a CPU benchmark is running on this machine.

**Labels.**

- **DOCUMENTED**: read in a primary source, either by the note author or for
  this chapter. The link leads to the note, and the note carries the primary
  URL.
- **INFERRED**: reasoning from evidence, including derivations the note
  authors added but did not prove.
- **HEARSAY**: secondhand, or vendor-run and not reproduced.

**Correction to the scout's framing (DOCUMENTED, wonky docs).** The scout
wrote "a bake-off is running right now". By 2026-09-24 it is decided:

- **corefine decides the topology.** It is a Bend port of Manifold's
  Boolean3 over F32x2 Reals, with shared symbolic-perturbation decisions and
  per-triangle face tags. **recover** rebuilds the exact B-rep from the tags,
  or refuses by name. Source: [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §1.
- **exact-plane** (the EMBER-style prototype) stays as an independent
  differential oracle. **sdf** produces no Boolean results.
- **Plan steps 1-5 are done** (step 5 uncommitted). corefine now has output
  gates (vertex-link check, exact self-intersection gate) and carrier
  unification at 2^-44. corefine's wrong `ok` answers on the adversarial
  suites fell from 18 to 3; those 3 are grazing cases that recover's
  pre-certificate refuses on the hybrid path. recover's wrong outputs fell
  from 15 to 0. Rotated coplanar input is exact on 14 of 14 cases.
- **Step 7** made the hybrid the default last arm of `src/boolean.mjs`
  (`hybrid-last`, uncommitted).

So this chapter does not score the bake-off again. It asks three questions
the bake-off left open:

1. Does the chosen Manifold-style stage survive long chains of operations in
   F32x2?
2. Which ideas from the exact lineages close the hybrid's remaining gaps:
   provenance per new edge, coincident faces, termination, export rounding?
3. What would it cost to move exactness into the production path later?

---

## 1. Landscape

### 1.1 Three lineages and one hybrid

Robust mesh Booleans split into three lineages by where they put exactness.
The scout's split holds up on the primary sources.

**(1) Inexact arithmetic, guaranteed topology.**

- Smith and Dodgson 2007 and Smith's thesis TR-766 (2009). In production in
  AVEVA PDMS since 1997, revived as the core of Manifold (2019+). DOCUMENTED
  ([SD07](sources/smith-dodgson-2007-a-topologically-robust-algorithm-for-bool.md),
  [TR-766](sources/julian-m-smith-towards-robust-inexact-geometric-computation-.md),
  [Manifold](sources/manifold-elalish-manifold.md)).
- The idea: answer every geometric question exactly once, from lower-level
  answers, with a symbolic tie-break. The combinatorics follow from those
  answers, so the output is topologically valid whatever the rounding.
- Manifold is now the default in much of the open-source world. Blender 4.5
  shipped a Manifold solver after its EMBER port stalled (DOCUMENTED,
  [Blender note](sources/blender-issue-114476-exact-boolean-v2-howard-trickey.md)).
  The Manifold README also names OpenSCAD and Godot; what each integration
  uses it for is HEARSAY in the note.

**(2) Vertex-based exact predicates, constructed output points.**

- Zhou et al. 2016 (libigl, CGAL lazy rationals), CGAL corefinement,
  Blender's "Exact" solver (GMP), Cherchi et al. 2020 and 2022 on Attene's
  indirect predicates, and Lévy 2024 in Geogram. DOCUMENTED
  ([Zhou](sources/zhou-grinspun-zorin-jacobson-2016-mesh-arrangements-for-soli.md),
  [CGAL](sources/cgal-polygon-mesh-processing-corefinement-booleans.md),
  [Cherchi 2020](sources/cherchi-livesu-scateni-attene-2020-fast-and-robust-mesh-arra.md),
  [Cherchi 2022](sources/cherchi-pellacini-attene-livesu-2022-interactive-and-robust-.md),
  [Lévy](sources/levy-2024-exact-predicates-exact-constructions-and-combinato.md),
  [Geogram](sources/geogram-brunolevy-geogram.md)).
- New vertices are exact rationals or implicit tuples of input primitives.
  Every decision within one operation is exact. The output is rounded to
  float at the end. The rounded mesh is either the persistent state
  (degrades) or exact values are carried forward (grow without bound).
- The parallel grid work of Magalhães and Franklin sits here too (catalog
  only).

**(3) Plane-based exact representations with fixed-width integers.**

- Bernstein and Fussell 2009, Campen and Kobbelt 2010, Nehring-Wirxel,
  Trettner and Kobbelt 2021 (octree-embedded BSPs), EMBER 2022,
  commercialised as Solidean. DOCUMENTED
  ([BF09](sources/bernstein-fussell-2009-fast-exact-linear-booleans.md),
  [CK10](sources/campen-kobbelt-2010-exact-and-robust-self-intersections-for--mesh-bool.md),
  [NW21](sources/nehring-wirxel-trettner-kobbelt-2021-fast-exact-booleans-for.md),
  [EMBER](sources/ember-exact-mesh-booleans-via-efficient-robust-local-arrange.md),
  [Solidean](sources/solidean-shaped-code-gmbh-exact-boolean-sdk.md)).
- A polygon is a supporting plane plus edge planes. A vertex is a triple of
  planes. Every plane that ever appears is an input plane (or an axis plane),
  so the bit width of every predicate is fixed by the input grid, not by the
  depth of the CSG tree.

**The hybrid: trueform (2026).**

- Integer-exact predicates of degree at most 3, on input lattice coordinates
  only. Created points are named by provenance, the radial order around
  intersection edges comes from the input planes, and a weighted majority
  vote settles disagreeing readings. Output is float. DOCUMENTED
  ([trueform](sources/trueform-polydera-and-sajovic-et-al-2026-uncertainty-aware-m.md)).

**Across all lineages: winding numbers classify.**

Generalized winding numbers (Jacobson 2013, Barill 2018, the Antipodal
Method 2026; catalog) and their integer form, the winding-number vector per
cell (Zhou 2016, EMBER), have become the standard way to classify. In
practice all serious implementations cast **one ray per connected
component** and propagate labels, instead of one ray per piece. DOCUMENTED:
Manifold `Winding03_`, Lévy's per-component ray, Cherchi 2022's per-patch
ray, trueform's per-component SoS segment, EMBER's reference point carried
down the subdivision. Section 3.5 compares them.

### 1.2 Which guarantees survive iterated CSG, and at what numeric cost

A FeatureScript part is a chain of Booleans. The question that matters is
not "is one operation right" but "is the 200th operation still right".

**Two separate guarantees.** They behave differently under iteration
(INFERRED from the sources below):

- **Topological validity** (closed, oriented, manifold) survives any number
  of operations in the Smith/Manifold approach, because each operation's
  combinatorics are derived from its own predicate answers, independent of
  precision.
- **Exactness of the represented solid** survives only if the
  representation stored between operations is (a) closed under Booleans and
  (b) of bounded size. Only plane-based fixed-width integers meet both.

| stored between operations | closed under Booleans | size | iterated evidence (vendor-run unless noted) |
|---|---|---|---|
| float mesh, topology from "ask once" (Manifold) | topologically yes | fixed | canonical on the 223-op terrain carve (525 ms) and the 1999-op cube grid (5.3 s); within 1e-4 of exact engines through 10k dome steps; timeout at op 17,257 of 100k |
| exact rationals (CGAL Nef; CGAL corefine kept in EPECK) | yes | unbounded growth | Nef canonical but 280 s (cube grid) and 330 s (terrain). Corefine EPECK canonical on terrain (11 s) but declines at op 5 of the cube grid (non-manifold intermediate) |
| implicit points of implicit points (Cherchi) | no: "cascading is explicitly unsupported" | explodes | IARMB fails all three iterated cases: residual solid, no result, "exit (needs rationals)" |
| Shewchuk expansions (open Geogram) | yes in principle | overflows the 11-bit exponent at ~65k components | Geogram 1.10.0 canonical on the cube grid (112 s), no result on terrain and dome |
| double mesh, rounded each step (libigl `mesh_boolean`) | no | fixed | cube grid canonical (62 s); terrain crash at op 184 |
| lattice ints + float materialisation (trueform 0.7.0, float build) | topology only | fixed | cube grid canonical (4.1 s); terrain inverted; dome wrong from 250 steps. The double build survived 1000 steps |
| plane-based fixed-width ints (Solidean = EMBER + engineering) | yes, bits bounded | bounded bits, output grows | canonical on every case; the only engine to finish 100k dome steps in 1 h (~23 min, 7.9 GiB) |

Sources: [Solidean benchmark note](sources/solidean-iterated-csg-benchmark-series-2026.md)
and the per-engine notes. Two conclusions (INFERRED):

- **The Manifold lineage is the strongest empirical evidence that "decide
  once" topology does not degrade over long chains**, but every data point
  is in double. Trueform's float32-internal build is the one lower-precision
  data point, and it failed where its double build survived. F32x2 (about 48
  significand bits, F32 exponent) lies in between and is unmeasured.
- **Exactness across a chain costs either unbounded memory (rationals) or a
  fixed, large integer width (plane-based).** The Open Boolean Benchmark
  legend says the same thing from the other side: methods that output float
  meshes "generally cannot claim" iteration stability (DOCUMENTED,
  [OBB note](sources/open-boolean-benchmark-boolean-benchmark-runners.md)).

**Where wonky sits.** wonky's hybrid does not store a mesh between exact
steps. It stores the recovered exact B-rep and re-tessellates it for the next
operation, so drift cannot accumulate through exact steps (DOCUMENTED design
argument, plan §2.4). Only after an `Unresolved` recovery does a mesh-only
chain start, and the plan's bound for that ("about 2^-44 relative per
constructed point") is marked "conjecture: arithmetic, not measured over
long chains". The bake-off's longest chains were 3-6 steps (DOCUMENTED,
[Solidean benchmark note](sources/solidean-iterated-csg-benchmark-series-2026.md)).

### 1.3 Materialisation: the step nobody solved

Every exact method ends by writing coordinates somewhere. The sources agree
that this is where exactness is lost (DOCUMENTED):

- Trueform's thesis: "Only index-based topology survives materialisation."
- EMBER §6: the method "can only be considered exact if input and output are
  in integer homogeneous coordinates"; float export "might re-introduce tiny
  self-intersections".
- NW21 §4.6: topology-preserving rounding is NP-hard (Milenkovic and Nackman
  1990).
- Cherchi 2020: naive rounding to double gives a valid complex for only
  85.2 % of 4k Thingi10K models. Zhou 2016: naive rounding breaks solidity in
  2.19 % of outputs; the single-precision re-round heuristic reaches 99.95 %
  with no guarantee.
- Lévy 2024 leaves snap rounding "explicitly out of scope"; Geogram issue
  #233 plans the Valque heuristic.
- Devillers, Lazard and Lenhart give the first provable 3D snap rounding
  (DCG 2020, catalog), but the Valque-Lazard note calls it impractical.
  Valque and Lazard 2025 (CGAL 6.1) is a bounded-iteration heuristic: snap
  offending vertices and their cell neighbours to a 24-bit grid, re-refine
  exactly, repeat at most 5 times
  ([note](sources/valque-lazard-iterative-snap-rounding-for-triangle-soup-auto.md)).

So "exact Boolean" in this literature means exact **between** import and
export. Solidean's product gap list over EMBER is mostly about this boundary:
"exact materialization of intermediates", "flexible exports with topological
guarantees", "true iteration-proofness" (DOCUMENTED,
[Solidean note](sources/solidean-shaped-code-gmbh-exact-boolean-sdk.md)).

For wonky, materialisation happens in two places (INFERRED):

- **Exact results.** recover's B-rep is the persistent state, and the print
  mesh is generated from it with a certified deviation. The mesh Boolean's
  rounding never reaches the model.
- **CertifiedMesh results** (after an `Unresolved` recovery). Here corefine's
  mesh *is* the result, and STL/3MF export rounds it to F32. The step-7
  status notes a task-11 diff that has to "drop float32-collapsed slivers of
  a hybrid mesh in the r20 export" (DOCUMENTED, plan step 7). That is the
  materialisation problem appearing in wonky (proposal P6).

### 1.4 The arithmetic, mapped to Bend

Bend 2.0.25 gives wonky F32 and U32 only. `u32_mul` returns the low 32 bits
(DOCUMENTED, `bend2/comp.ts:187-190`, README "no U64, I64 or F64"), so exact
products need **16-bit half-limbs**: an n-limb × n-limb product costs n²
multiplies. A 256×256-bit product is 256 multiplies against 16 `mulx` on
x64, i.e. **16×** the paper implementations' multiply count, not 4×
(DOCUMENTED in the [NW21 note](sources/nehring-wirxel-trettner-kobbelt-2021-fast-exact-booleans-for.md);
the ratio is INFERRED).

What each lineage asks of that arithmetic (bits are worst-case predicate
widths on a B-bit input grid; INFERRED from the notes' derivations unless
marked):

| representation | hardest routine predicate | width | 16-bit limbs | source |
|---|---|---|---|---|
| Smith/Manifold shadows | coordinate comparisons and interpolation only; no orientation determinant | none: topology is precision-free; accuracy follows u | 0 | TR-766 table 4.1 (DOCUMENTED) |
| trueform lattice | orient3d, degree 3 in lattice coordinates; one degree-4 sign by limb splitting | about 3B+5: ~99 bits on a 31-bit lattice, ~78 on 24-bit | ~5-7 | trueform §2.1 (DOCUMENTED); widths INFERRED |
| CK10 plane coefficients | exact plane from grid points | M ≥ 3L + 2·log2(δ) + 3: 81 bits at L = 26, δ = 1 | 6 | CK10 §3.2 (DOCUMENTED) |
| plane-based, quantized planes (N = B = 24) | classify ≈ 4N + B + 6 | ~126 bits, only if every vertex is a plane triple | 8 | NW21 eq. 7 (INFERRED) |
| EMBER / NW21, planes from vertices | classify a plane-triple vertex, degree 9 | 9B + ~18: 256 bits at B ≈ 26 | 16 | NW21 eq. 9 (DOCUMENTED) |
| wonky exact-plane at B = 34 | same | 9B + 19 = 325 bits (observed ≤ ~256) | 21 | [../proto-exact-plane.md](../proto-exact-plane.md) (DOCUMENTED) |
| BF09 plane triples | sign(det3)·sign(det4), det4 as a Plücker dot product | 3α + β + 5 = 325 bits for exact-plane's planes | 21 | BF09 note (INFERRED) |
| Cherchi implicit points | orient2d on three TPI points, degree 26 | ~26B + 50 ≈ 675 bits at B = 24 | 43 | Cherchi 2020 appendix degrees (DOCUMENTED); width INFERRED |
| Lévy / Geogram vertex points | SoS-perturbed incircle on three-plane points | over 1000 bits | 60+ | Geogram note (INFERRED) |

Three consequences (INFERRED):

1. **F32x2 cannot host exact constructions.** Its exponent is F32's (about
   276 binades against double's 2098), so Shewchuk expansions would exhaust
   it 7-8× sooner than Lévy's double expansions did. Its ~48-bit significand
   is below even trueform's degree-3 width. F32x2 is a **filter** only.
2. **Fixed widths matter more than the width itself.** Measured in wonky's
   exact-plane with variable-length `List<U32>` integers: 6.0 µs per exact
   constructed-vertex classify against about 34 ns for NW21's 256-bit
   classify (~175×, across different CPUs), and even the F32x2 filter
   (0.20 µs) is ~6× slower than NW21's exact path (DOCUMENTED numbers,
   [NW21 note](sources/nehring-wirxel-trettner-kobbelt-2021-fast-exact-booleans-for.md)).
   The 16× limb penalty explains only part of that gap; allocation and
   length branches explain the rest.
3. **Exact zeros dominate on CAD input.** exact-plane's filter certifies
   60-100 % of signs, and almost every exact evaluation is a zero from
   coplanar or touching faces. On `hex-nut` the exact zeros are 7 % of signs
   but cost as much as all filtered signs (DOCUMENTED,
   [EMBER note](sources/ember-exact-mesh-booleans-via-efficient-robust-local-arrange.md)).
   No static filter can certify a zero. The cheap zero is the symbolic one:
   "this vertex was built from this plane".

### 1.5 Trends 2024-2026

- **Comparative data on iteration exists for the first time.** The Solidean
  series (four posts, 2026-05-28 to 2026-07-02) runs 17-19 engines on one
  harness and publishes MIT runners and CC BY 4.0 meshes. It is vendor-run by
  the EMBER author: treat rankings as biased, the data as reproducible
  (DOCUMENTED, [benchmark note](sources/solidean-iterated-csg-benchmark-series-2026.md),
  [OBB note](sources/open-boolean-benchmark-boolean-benchmark-runners.md)).
- **Each vendor wins its own protocol.** In trueform's pairwise protocol
  (arrays in and out, 1000 Thingi10K pairs, M4 Max) trueform's median is
  15.7 ms against Manifold 118 ms and EMBER/Solidean 143.8 ms. In Solidean's
  iterated protocol trueform is 4.2× slower than Solidean on the cube grid
  and wrong on terrain and dome (DOCUMENTED, both vendor-run). Import cost
  and persistence across operations decide the ranking (INFERRED).
- **Manifold moved from float to double** (v3.0, 2024-11) "for coordinate
  accuracy, not robustness", added cross-platform determinism CI (v3.5.0),
  and on 2026-09-22 replaced its accumulated precision tracking with a
  relative 1e-12 × bounding-box epsilon (PR #1836). DOCUMENTED
  ([Manifold note](sources/manifold-elalish-manifold.md)).
- **A Metal backend for Manifold was proposed and closed.** PR #1646
  (external contributor, 2026-04-12) moved sort, scan and reduce to Metal.
  Its author closed it a day later: "the per-dispatch overhead of individual
  GPU primitive calls doesn't yield meaningful speedups at typical mesh
  sizes — the data needs to stay on GPU across the full boolean pipeline".
  A maintainer added that an efficient GPU version "will probably require
  rewriting a lot of stuff". DOCUMENTED (`gh api
  repos/elalish/manifold/issues/1646/comments`, checked for this chapter).
  This matches wonky's own measurement that Metal is 2.4× slower than cpu18
  for corefine (plan §6).
- **Plane-based exactness became a product, not an open library.** EMBER has
  no public code; Solidean is proprietary; Blender's port was shelved;
  wonky's exact-plane is the only public-in-spirit implementation known to
  this knowledge base (DOCUMENTED absence).
- **Provenance naming replaces coordinate matching.** trueform names every
  created point by its generating primitives; Cherchi's implicit points and
  CK10's plane triples do the same thing in other words; Manifold carries
  `faceID`/`originalID`. "Cross-face consistency follows from identity, not
  from coordinate comparison" (trueform, DOCUMENTED).
- **Contracts are getting explicit.** OBB's E/R/I/S letters and status
  vocabulary; Solidean's solid/supersolid classes; CGAL's per-operation
  refusal; a formally verified exact intersection in Lean 4 (other chapter,
  [note](sources/verified-3d-mesh-intersection-lean-4.md)).

### 1.6 What is conspicuously missing

(DOCUMENTED absences in the notes; significance INFERRED.)

- **No open implementation of EMBER or of octree-embedded BSPs.** The only
  public code is an unlicensed 128-bit NW21 fragment (`quadmotor/hypercut`)
  that ignores the paper's overflow bounds.
- **No exact Boolean on a GPU.** EMBER and NW21 are CPU work-stealing. The
  only lead is exact predicates on GPUs (Menezes et al. 2022, catalog, not
  read). Manifold's Metal PR #1646 was closed for dispatch overhead.
- **No study of iterated CSG below double precision** except trueform's
  float32 failure. F32x2 is unmeasured everywhere.
- **No practical 3D snap rounding with a guarantee.**
- **No purely functional or immutable implementation** of any of these
  algorithms. Every one uses mutation, locks or atomics somewhere:
  union-find, concurrent maps, `AtomicAdd` index allocation, in-place
  half-edge cutting.
- **Nothing for curved faces.** All methods decide the topology of
  *tessellations*. The literature's only answer to curved B-reps is the
  hybrid route wonky took (mesh Boolean decides topology, surfaces give
  geometry; see [brep-booleans-ssi.md](brep-booleans-ssi.md) §1.4).
- **No shared non-manifold policy.** CGAL refuses, Zhou and Solidean
  represent, Manifold duplicates vertices silently. OBB planned an "N"
  letter "pending a correctness definition".

### 1.7 Where wonky stands (working tree, 2026-09-24; DOCUMENTED)

| part | file | state |
|---|---|---|
| topology stage | `kernel/hybrid/corefine/` (`shadow.bend`, `boolean.bend`, `assemble.bend`, `earclip.bend`, `weld.bend`, `gate.bend`, ...) | Manifold Boolean3 kernels over F32x2; union-find, assembly and weld sequential; cpu1/cpu18 geo-mean 1.46 |
| output gates | `kernel/hybrid/corefine/gate.bend` | vertex-link check; exact self-intersection gate on pairs of different tags (F32 certified filter, structural shortcuts, Reals, big integers); +10.6-10.8 % cpu18 |
| coplanar policy | `kernel/hybrid/unify.bend` | plane carriers of different leaves within 2^-44 (normals) and 2^-44·scale (offsets) form one class; comparisons within 2^-36·scale between elements touching a class are ties; exactly axis-aligned pairs never unified |
| topological tolerances | corefine | short-edge collapse at 2^-36 × the largest absolute coordinate; zero-width faces and T-junctions within the same eps; 1e-7 rad triangulator flatness. No vertex is moved |
| exact recovery | `kernel/hybrid/recover/` | curves from carrier pairs; certificates; named refusals; pre-certificate for grazing pairs |
| entry | `kernel/hybrid/main.bend` `boolean(job)` | `exact` / `mesh <dev> <reason>` / `unresolved`; all four targets byte-identical on 260 cases |
| differential oracle | `kernel/proto/exact-plane/` | plane-based, 2^-24 mm grid, variable-length 16-bit-limb Bigs; 2.5-5.6× slower than corefine |
| double-word reals | `kernel/real.bend` | `add` is Joldes-Muller-Popescu Algorithm 5 ("sloppy"); no error bound for opposite-sign operands |

**Measured gaps that this chapter's sources speak to:**

- no chain longer than 6 steps was ever run;
- corefine's `ok` mesh does not record a unification (plan §9, open);
- recover re-derives each new edge's carrier pair from patch adjacency
  instead of receiving it (plan §2.2 "Gap", step 9);
- legitimate edge contacts (lattices) are refused;
- no stated epsilon bound for corefine's constructed points under the
  current `add`.

### 1.8 Licensing for porting (INFERRED, not legal advice)

wonky has no open-source licence (all rights reserved). Noncommercial licences
are off limits for anything that may be used commercially.

| class | sources | what wonky may do |
|---|---|---|
| permissive | Manifold, meshbool (Apache-2.0); Geogram, ThingiCSG (BSD-3); Cherchi 2020/2022 Boolean code, OBB runners, bench-blog-data code, verified-3d-mesh-intersection (MIT); bench meshes (CC BY 4.0); Valque-Lazard paper (CC BY 4.0) | port or transliterate with an attribution header, as `shadow.bend` already does |
| file-level copyleft | libigl core, boolmesh (MPL-2.0) | re-implement from the paper; do not translate files |
| copyleft | CGAL, Blender, Carve (GPL); Cork, mcut (LGPL); Indirect_Predicates (LGPL; LICENSE says 2.1, headers "v3 or later") | study only; re-derive predicates from the papers |
| noncommercial / proprietary | trueform (PolyForm Noncommercial 1.0.0), Solidean, QuickCSG | papers and blog posts only |
| no licence (all rights reserved) | quadmotor/hypercut, VolumeMesher, MeshIntersection, 3D-EPUG-Overlay | do not copy |
| papers without code | SD07, TR-766, BF09, CK10, NW21, EMBER, Lévy 2024 | clean-room from the text; no patent found in any note (not a freedom-to-operate check) |

Verification note (DOCUMENTED, SD07 note): the commonly cited Smith-Dodgson
DOI 10.1016/j.cad.2006.12.003 is a filament-winding paper; the correct DOI
is 10.1016/j.cad.2006.11.003.

---

## 2. Comparison table

Status and stars re-checked by the note authors with `gh api` on 2026-09-22 to
2026-09-24.

| name | kind | status | license | verdict | key idea (one line) | note |
|---|---|---|---|---|---|---|
| Smith & Dodgson 2007 | paper (CAD 39(2)) | historical; in AVEVA PDMS since 1997; core of Manifold | Elsevier ©, no code | adapt | ask each shadow question once; symbolic tie-break; topology valid under any rounding | [link](sources/smith-dodgson-2007-a-topologically-robust-algorithm-for-bool.md) |
| Smith, TR-766 (thesis) | PhD tech report | historical; productized in Manifold 3D and Boolean2 | © author, free PDF | adapt | table 4.1 X/S hierarchy, Theorems 1-4, 2D bound α = 12.37·u·L, block-rule sweep | [link](sources/julian-m-smith-towards-robust-inexact-geometric-computation-.md) |
| Manifold (elalish/manifold) | C++ library | very active: 2288★, pushed 2026-09-23, v3.5.3 | Apache-2.0 | **adapt** (ported as corefine) | parallel Smith Boolean; normal-based expand/contract; one ray per component; `faceID` provenance | [link](sources/manifold-elalish-manifold.md) |
| EMBER (Trettner et al. 2022) | paper (TOG 41(4)) | no code; commercialised as Solidean | ACM ©, author PDF | adapt (blueprint of exact-plane) | plane-based 26-bit ints, ≤ 256-bit predicates, kd recursion with a reference winding vector, variadic CSG | [link](sources/ember-exact-mesh-booleans-via-efficient-robust-local-arrange.md) |
| Nehring-Wirxel et al. 2021 | paper (CAD 135) | historical; arithmetic base of EMBER | Elsevier ©, arXiv; no official code | learn-from | homogeneous vertices make classify a 4D dot product; v+ ≤ 0.239·2^(b/9); persistent octree of BSPs | [link](sources/nehring-wirxel-trettner-kobbelt-2021-fast-exact-booleans-for.md) |
| Bernstein & Fussell 2009 | paper (CGF 28(5)) | historical | paper only | learn-from | planes not points: 4 fixed-depth predicates and a plane-emitting clip table, no constructions | [link](sources/bernstein-fussell-2009-fast-exact-linear-booleans.md) |
| Campen & Kobbelt 2010 | paper (CGF 29(2)) | historical; superseded by NW21 and EMBER | paper only | learn-from | exact vertex-to-plane budget M ≥ 3L + 2·log2(δ) + 3; octree critical cells between grid points; exact connectivity by plane triples | [link](sources/campen-kobbelt-2010-exact-and-robust-self-intersections-for--mesh-bool.md) |
| Solidean SDK | commercial SDK | active (2026.1); blog last post 2026-07-02 | proprietary; community edition non-commercial | learn-from | Fixed256Pos26: exact between import and export; solid/supersolid classes; command-buffer operations | [link](sources/solidean-shaped-code-gmbh-exact-boolean-sdk.md) |
| Solidean iterated-CSG benchmarks | vendor blog + open data | 4 posts, 2026-05 to 2026-07 | text ©; data MIT and CC BY 4.0 | **adopt** (as tests) | the only public long-chain data: 9-op chain, 223-op terrain carve, 1999-op cube grid, dome carve | [link](sources/solidean-iterated-csg-benchmark-series-2026.md) |
| Open-Boolean-Benchmark runners | benchmark harness | dormant since 2026-06-08; 9★; 0 issues | MIT | adapt | subprocess SSA request/result protocol, status vocabulary, E/R/I/S capability letters | [link](sources/open-boolean-benchmark-boolean-benchmark-runners.md) |
| Lévy 2024 | paper (TOG 44(5)) | new; arXiv v2 (2025-06) latest | © author/ACM; code in Geogram (BSD-3) | learn-from | exact constructions; expansions overflow the exponent; mpz + 32-bit exponent; one ray per component | [link](sources/levy-2024-exact-predicates-exact-constructions-and-combinato.md) |
| Geogram | C++ library | very active: 2547★, v1.10.1 | BSD-3-Clause | adapt | PCK predicate DSL, SoS-unique CDT, Weiler 3-map with operand bitmasks, coplanar simplification | [link](sources/geogram-brunolevy-geogram.md) |
| Cherchi et al. 2020, mesh arrangements | paper (TOG 39(6)) + code | maintenance-only: 172★, last push 2024-04 | MIT; predicates LGPL | adapt | implicit points (LPI, TPI) with indirect predicates; combinatorics equal to rationals | [link](sources/cherchi-livesu-scateni-attene-2020-fast-and-robust-mesh-arra.md) |
| Cherchi et al. 2022, IARMB | paper (TOG 41(6)) + code | maintenance-only: 244★ | MIT; predicates LGPL | adapt | one exact ray per patch; bitset selection; no cascading | [link](sources/cherchi-pellacini-attene-livesu-2022-interactive-and-robust-.md) |
| Zhou et al. 2016, mesh arrangements | paper (TOG 35(4)) + libigl | stable; libigl 5,090★ | MPL-2.0 + CGAL GPL | learn-from | arrangement, winding-number vector per cell, extraction by f(w); PWN contract; one CDT per coplanar cluster | [link](sources/zhou-grinspun-zorin-jacobson-2016-mesh-arrangements-for-soli.md) |
| CGAL corefinement Booleans | C++ library | active: 6,054★; own package since 6.2 | GPL-3.0+ or commercial | learn-from | manifold-only contract with a per-operation refusal; exact constructions for chaining | [link](sources/cgal-polygon-mesh-processing-corefinement-booleans.md) |
| trueform + Sajovic et al. 2026 | C++ library + paper | very active: 146★, v0.10.5 | PolyForm Noncommercial or commercial | learn-from | degree ≤ 3 lattice predicates; points named by provenance; radial order from input planes; majority vote | [link](sources/trueform-polydera-and-sajovic-et-al-2026-uncertainty-aware-m.md) |
| Blender #114476, Exact Boolean V2 | issue + abandoned branch | issue open; branch last commit 2024-03; Blender 4.5 ships Manifold | GPL-2.0+ | learn-from | an EMBER port whose exact core worked and whose output assembly did not | [link](sources/blender-issue-114476-exact-boolean-v2-howard-trickey.md) |

---

## 3. State of the art: techniques, their real guarantees, where they break

### 3.1 "Ask once" with symbolic perturbation (Smith-Dodgson, Manifold)

**Technique** (DOCUMENTED, TR-766 ch. 4, Manifold `boolean3.cpp`, `shared.h`):

- 16 pair functions X_ij between an i-dimensional entity of A and a
  j-dimensional entity of B, levels 0-6. Levels 0-3 decide relations in x,
  then (x, y), then 3D. Levels 3-6 construct.
- Each X is a small signed sum of lower-level shadow values S. The shadow
  rule compares one coordinate with a symbolic tie-break. No orientation
  determinant is ever evaluated.
- Intersection points are interpolated from the nearer endpoint with
  t = Δ+ / (Δ+ − Δ−). The shadow signs guarantee a nonzero denominator
  (Theorem 1).
- Inclusion numbers I03 = cA + cI·X03 etc., with (cA, cB, cI) = union
  (1, 1, −1), intersection (0, 0, 1), difference (1, 0, −1). They generalize
  to any winding mapping φ = cA·a + cB·b + cI·a·b, so invalid winding still
  gives a defined result.
- Manifold's single primitive: `Shadows(p, q, dir) = p == q ? dir < 0 : p < q`.
  The tie direction is a vertex normal component or the sum of two face
  normal components, signed per operation: union expands, difference and
  intersection contract P. So touching solids merge and A − A is empty.
- Winding numbers: union-find over P's edges that no Q face crosses, one
  `Kernel02` ray per component, flood fill.

**Real guarantee** (DOCUMENTED):

- Theorems 1-4: valid topology in gives valid topology out, for any
  rounding, even random vertex coordinates. The algorithm is a fixed
  sequence of finite operations, so it terminates.
- "Valid" means: every facet boundary is a closed loop, and for every vertex
  pair the half-edges P→Q and Q→P balance. Coincident vertices and
  zero-length edges are explicitly allowed.
- Geometric accuracy is proven only for the 2D segment intersection:
  α = sqrt(153)·u·L ≈ 12.37·u·L. There is no 3D bound. Manifold calls its
  "epsilon-valid" output contract unprovable and treats counterexamples as
  bugs.

**Where it breaks** (DOCUMENTED unless marked):

- **Point and edge contact are "valid".** Smith's definition allows them.
  corefine returned 10 point-contact meshes as `ok` in the bake-off, and
  recover turned some into B-reps of self-touching solids. wonky needed its
  own vertex-link gate.
- **Exactly coincident, non-axis-aligned faces.** Manifold #1430 (shards),
  #1656 (1.4 % duplicate internal faces over 1000 random shared-face
  tetrahedra, graded by the dominant normal axis: X 3.0 %, Y 1.2 %, Z 0 %).
  Lalish: the perturbation "effectively perturbs toward one of the 8
  octants". Lévy: Manifold fails `nasty_gears_1` (two sets of 50 rotated
  cubes). corefine reproduced the class: 4 of 13 rotated coplanar sweep
  cases returned self-intersecting `ok` meshes before the gate and
  unification.
- **SoS on CAD input is arbitrary.** trueform's box-divider example: 2^4 = 16
  SoS outcomes, one of them intended. INFERRED consequence: a tie-break that
  is consistent is not the same as a tie-break that is right.
- **The cleanup, not the kernels, is the fragile half.** PR #895 (more tests
  fail when the tolerance shrinks), #1838/#1842 (edge-swap recursion without
  a decreasing measure; the merged fix is a depth cap of 100), #1834
  (`faceID` round trip changed coplanar collapse), #1706 (slivers "very much
  expected").
- **Parallel index allocation breaks determinism**: #1320 (open), #1848
  (`AtomicAdd` in `LevelSet`; "Booleans also use AtomicAdd").
- **Self-union is impossible** with cross-object-only pairs (TR §6.4;
  Manifold #289); it needs the sequential chapter 7 sweep.

### 3.2 Exact arrangements with constructed vertices (Zhou, Cherchi, Lévy, CGAL)

**Technique** (DOCUMENTED):

- Resolve all triangle-triangle intersections exactly. New vertices are
  exact rationals (Zhou, CGAL EPECK), implicit tuples of input primitives
  (Cherchi: LPI = edge line × triangle plane, TPI = three triangle planes),
  or homogeneous points on expansions or multi-precision floats (Lévy).
- Re-triangulate every cut triangle: one CDT per coplanar cluster (Zhou), an
  SoS-unique Delaunay CDT per triangle so coplanar overlaps triangulate
  identically (Lévy), or earcut plus pocket deduplication by sorted corner
  keys (Cherchi).
- Deduplicate vertices by exact lexicographic compare
  (`sign(w1)·sign(w2)·sign(w2·x1 − w1·x2)`, Lévy).
- Classify: winding-number vectors by BFS over the cell graph (Zhou), XOR
  flood fill over a Weiler 3-map with operand bitmasks and one ray per
  component (Lévy), one exact ray per patch (Cherchi 2022).
- CGAL corefinement: exact segment-triangle nodes, per-face exact CDT, one
  classification per patch from the cyclic order of four faces around an
  intersection edge.

**Real guarantee** (DOCUMENTED):

- Within one operation the combinatorics are exact. Cherchi 2020 matched
  libigl's rational V/E/F counts on 4,407 Thingi10K models. Zhou's self-union
  passed all 8,616 PWN Thingi10K meshes on every checked criterion.
- CGAL: correct combinatorics with EPICK, an exact embedding with EPECK, and
  a `false` flag per operation when the result would be non-manifold.

**Where it breaks** (DOCUMENTED):

- **Output rounding.** 85.2 % valid naive rounding (Cherchi 2020); 2.19 %
  broken solids (Zhou); CGAL EPICK output self-intersects (#9154).
- **Cascading.** Cherchi §7.1: composed implicit points make "the arithmetic
  filtering fail in virtually all cases" and exhaust memory. In Aug 2026,
  Indirect_Predicates PR #15 showed cascaded-point filters wrong in 66 % of
  queries in one reproducer. Livesu (issue #2): the fix would be
  "backtracking" every point to input primitives; unbuilt.
- **Expansion exponent range.** Lévy: 65,000-component expansions,
  overflow/underflow on ThingiCSG example0021-0024 and Thingi10K #101633,
  40-100× the cost of plain double. Open Geogram aborts with "you may need
  geogramplus".
- **Rational growth.** libigl chaining roughly doubles the per-vertex
  arithmetic size per operation (Jacobson, #2377); CGAL Nef takes 280-330 s
  on the long chains.
- **Unchecked preconditions.** CGAL documents but never checks
  self-intersection and "bounds a volume"; libigl compiles its output
  self-intersection check out (`DOUBLE_CHECK_EXACT_OUTPUT`) and returns a
  mesh plus `false` on non-PWN input in release builds.
- **Manifold-only output ends chains.** CGAL corefine declines at op 5 of the
  cube grid; #9497 fails on 1e-14 near-coincidences from double transforms,
  and its snapping PR #7994 has been open since 2024-01.
- **Environment.** FMA contraction broke Geogram's predicates on Apple
  Silicon (#382); Cherchi's filters need directed rounding
  (`-frounding-math`, safe clang builds only at `-O0` in 2020); a missing
  `Expansion::initialize()` looked like an algebra bug (#391).

### 3.3 Plane-based fixed-width exactness (BF09, CK10, NW21, EMBER, Solidean)

**Technique** (DOCUMENTED):

- A plane has integer coefficients (a, b, c, d). A polygon is a supporting
  plane plus edge planes. A vertex is three planes; NW21 caches it as a
  homogeneous point (|A1|, |A2|, |A3|, |A|) so classification is
  sign(⟨x, s⟩)·sign(x4), a 4D dot product.
- BF09 clips convex polygons by emitting planes, never points: a 27-code
  table over three consecutive vertices.
- No midpoints, no segments between constructed points, no re-triangulation
  (EMBER §3.2): every plane stays an input or axis plane.
- Localisation: CK10 octree critical cells placed between grid points; NW21 a
  persistent octree of 100-200-node BSPs; EMBER one adaptive kd subdivision
  that carries a reference point with a known winding-number vector, so every
  leaf is solved locally.
- Coplanar overlaps resolved by a total order on polygon index (EMBER),
  classification by winding-number-vector propagation along ≤ 3-segment
  exact paths, and automaton-derived early-outs (EMBER §4.5).

**Real guarantee** (DOCUMENTED):

- Inside the fixed-width world everything is exact, and the bit width never
  grows with CSG depth. NW21: the core algorithms are "unconditionally stable
  and correct" within the bit limits (fuzzed). EMBER: "iterated CSG
  operations can be performed without intermediate loss of precision".
- Performance is not traded away: EMBER 1.6 ms geometric mean on Thingi10K
  pairs; Solidean leads every iterated case.

**Where it breaks** (DOCUMENTED unless marked):

- **Quantization is a different problem.** Trickey (Blender): "only exact in
  the space where all vertex positions are converted to 26-bit integers"; a
  rotated cube becomes an almost-zero-area face. wonky measured it:
  exact-plane's 2^-24 mm grid sealed rotated coplanar pockets into voids,
  closed 1e-9 mm gaps into point contacts, and missed sub-micron skins by up
  to 19 %. 26 wrong `ok` of 216 adversarial cases, more than corefine's 18.
  BF09 said it in 2009: "no rotations". The EMBER note's proposed remedy
  (INFERRED) is a quantization refusal rule: detect when rounding to the
  grid flips or zeroes an orientation that was nonzero in the unquantized
  input, and refuse instead of solving the neighbouring problem.
- **Output assembly.** Blender's EMBER port stalled on disconnected faces,
  T-junctions "all over the place", near-zero-area slivers, and float-epsilon
  welding hacks. wonky's exact-plane showed these are solvable (one input
  triangle per cell, segment-bounded cuts, exact T-junction insertion, one
  exact rounding with a flip check), at 2.5-5.6× corefine's cost.
- **Float export can self-intersect** (EMBER §6, NW21 §4.6).
- **Non-degradation needs engineering beyond the paper.** Solidean's gap
  list: output-sensitive cost, clean manifold export, bounded fragmentation
  over long chains. EMBER rebuilds its subdivision every operation and emits
  more faces and low-valence vertices than other methods.
- **Import preconditions.** NW21 needs watertight, self-intersection-free
  input; EMBER needs PWN; CK10 needs the M-bit budget or re-quantization.
  CK10 crashed after 12 steps of NW21's milling chain.
- **Bend cost** (INFERRED from §1.4): a 256-bit classify is 16 limbs;
  products are 16× the paper's multiply count.

### 3.4 Exact topology on bounded-degree lattice predicates (trueform)

**Technique** (DOCUMENTED, arXiv 2607.15905):

- One integer lattice over the union bounding box (31 bits for float input).
  Every predicate has degree ≤ 3 in lattice coordinates on a fixed
  int32/int64/int128 ladder, with no filter and no fallback. One degree-4
  sign uses a three-limb split.
- Exact five-type contact classification (VV, VE, VF, EE, EF) from the zero
  patterns of three orient3d signs, without SoS.
- Created points are named: VV/VE/VF reuse input identities, EE/EF are
  (home edge, snapped dyadic parameter), crossings are face triples. "Cross-
  face consistency follows from identity, not from coordinate comparison."
- Radial order around an intersection edge from the input planes' normals
  (degree 2): "exact without exact constructions".
- Classification: inclusion bitvector potential b(d') = b(d) XOR B(c); one
  SoS segment per nested connected component; any N-ary expression is a
  per-domain bit test.
- A "tolerance door": the tolerance quantizes input planes and moves
  vertices by at most the tolerance, with a certificate; predicates stay
  exact; tolerance 0 is the identity.

**Real guarantee** (DOCUMENTED): exact predicates, exact contact types, exact
in-build radial order. Created points are grid-snapped, so the per-face 2D
arrangement is exact for the rounded configuration, not the true one
(INFERRED from §2.2 plus code).

**Where it breaks** (DOCUMENTED):

- The majority vote is "statistical, not worst-case"; "a configuration can
  be built to defeat it".
- Materialized output can self-intersect.
- v0.10.3/0.10.4 silently lost operand membership and wall pieces; "a failed
  plane is silent downstream".
- Welded multi-line pieces fall back to coordinates: "an open question, not
  a fix".
- The float32 build fails the terrain and dome chains.

### 3.5 Classification: one question per component

| method | seed | propagation | rays |
|---|---|---|---|
| Manifold `Winding03_` | `Kernel02` vertical shadow per component of unbroken P edges | union-find, flood fill | one per component |
| Zhou 2016 | ambient cell via the max-x vertex and its steepest hull edge | BFS over the cell/patch graph, w += ±e_i | none (point location by dummy facet) |
| Lévy 2024 | outer shell = largest enclosed volume | XOR flood over the 3-map | one per component, random re-shoot |
| Cherchi 2022 | exact ray from an explicit vertex or a verified barycenter | per-patch bit | one per patch |
| trueform | voted wedges inside a component; most negative volume outside | XOR-BFS over domains | one SoS segment per nested component |
| EMBER | reference point carried down the kd tree | WNV along ≤ 3-segment paths | local only |
| wonky exact-plane | exact axis ray per piece | none | one per piece (INFERRED from the notes: the most expensive variant) |

(DOCUMENTED per note.) The shared lesson: count once, propagate
combinatorially. For wonky's corefine the Manifold form is already ported.
For N-ary Booleans, operand bitmasks in U32 words (Lévy, Cherchi, trueform)
are the compact form; Geogram's 32-operand cap is a warning to size them
explicitly.

### 3.6 Contracts

(DOCUMENTED per note; comparison INFERRED.)

| system | input contract | checked? | non-manifold result | failure signal |
|---|---|---|---|---|
| CGAL corefine | closed, triangle, manifold, bounds a volume, no self-intersections | only triangles (debug); rest unchecked | refused per operation | `false` flag; UB on violated preconditions |
| Zhou / libigl | PWN | exact check exists; release builds continue | represented | mesh plus `false` |
| Manifold | closed manifold | yes (non-manifold input is an error in Blender's integration) | represented; coincident vertices are valid output | always returns a mesh |
| Solidean | solid or supersolid; `heal` otherwise | yes | represented ("Solid" closure) | `ExecuteResult` diagnostics, may still return a mesh |
| OBB protocol | per-runner flags | self-reported | "N" letter planned | `success`, `timeout`, `crash`, `invalid_input`, `invalid_output`, `unsupported` |
| wonky hybrid | tagged tessellations of exact B-reps | yes (recover's input checks) | refused by name | `exact`, `mesh <dev> <reason>`, `unresolved <reason>` |

wonky's contract is already the strictest of these. Its open question is the
same one OBB could not settle: whether touching-but-disjoint solids are
refused or represented.

### 3.7 Summary

| technique | guarantee | numeric cost | breaks when |
|---|---|---|---|
| "ask once" + SoS (Manifold, corefine) | valid half-edge topology under any rounding | plain F32x2; no exact arithmetic | exact coincidences off the axes; point contact; cleanup loops; long chains below double (unmeasured) |
| exact arrangement, constructed vertices | exact combinatorics per operation | rationals, expansions or high-degree filters; F32 exponent too small | output rounding; cascading; unchecked preconditions |
| plane-based fixed width | exact and closed across chains | 256-bit (16-limb) predicates; 16× multiplies in Bend | quantization of rotated input; output assembly; export rounding |
| bounded-degree lattice (trueform) | exact predicates and contact types | ≤ 128-bit, fixed ladder | vote is statistical; snapped created points; float32 chains |
| tag-based recovery on top (wonky hybrid) | exact B-rep where recover certifies; named refusal otherwise | exact predicates only in gates and recovery | curve types not yet covered; touching policy; unmeasured chains |

---

## 4. War stories and anti-patterns

### 4.1 War stories (DOCUMENTED unless marked)

**Termination and cleanup.**

- **PDMS, five years in the field, one fault.** Smith's smoothing
  post-process did not terminate on four coincident near-vertical facets.
  The "fix" was forced early termination, which left shard artifacts (TR-766
  §5.2).
- **Manifold #1838/#1842 (2026-09-22).** An intersection of two real meshes
  sent `RecursiveEdgeSwap` into unbounded recursion: a symmetric condition
  `length2(next − last) < ε²` swapped a diagonal back and forth. The
  reporter found a one-way condition; the merged fix is `if (depth > 100)
  return 0;` "in case the underlying issue isn't completely solved". A depth
  cap turns a hang into silently unfinished cleanup.
- **Manifold PR #895.** When Manifold moved to double, tightening the
  tolerance made *more* tests fail (sponge triangle counts changed under
  rotation, a flaky hull test, a triangulation failure on CI). The kernels
  were fine; the epsilon cleanup and triangulator were not.

**Identity by coordinates.**

- **Manifold #1516.** Two slices from two separate `TrimByPlane` calls
  cannot be re-unioned watertight: their intersection vertices are
  recomputed, and "if it's anything other than float identical, it won't
  work". `Split` works because it computes the cut once.
- **Manifold #1834.** Copying triangle ids into `faceID` on export stopped
  coplanar triangles from being collapsed after re-import, so the same mesh
  behaved differently after a round trip.
- **Blender's EMBER port.** The exact core worked. Output assembly welded
  vertices by `float3` equality in an O(n²) scan and clustered overlapping
  edges "hackily" with an epsilon (lines 4991, 5209, 5283, 5366). Trickey:
  "quite difficult to get a reasonable, connected mesh". Shelved 2025-02.

**Determinism.**

- **Manifold #1320 (open) and #1848.** With parallel execution on, a union of
  19 partly coplanar cubes gives different triangles on repeated runs;
  `LevelSet` handed out indices with `AtomicAdd`, and about 1 in 4 runs
  differed, sometimes in topology. "Booleans also use `AtomicAdd` in places."
- **Geogram #268.** The symbolic-perturbation mode is a global flag, so two
  Booleans in parallel are not thread-safe.
- wonky's counterexample: corefine is byte-identical on JS, cpu1, cpu18 and
  Metal on every case, because Bend has no atomics in user code and indices
  come from prefix sums (plan §1).

**Numerics and environment.**

- **Geogram #382 (closed 2026-08-18).** On Apple Silicon, clang contracted
  predicate code into FMAs (`orient_3d` into 5 fused operations). Delaunay
  point location then hit its 2500-step guard, and a 9 s run became 30 s to
  over 13 min, nondeterministically. The Linux flags had
  `-ffp-contract=off`; the Darwin file did not.
- **Geogram #391.** An algebraic zero came out nonzero under MSVC. Cause: a
  missing `Expansion::initialize()` in the test program.
- **Cherchi 2020 #8.** Clang long ignored `-frounding-math`; in 2020 the only
  safe clang build was `-O0`.
- **Smith.** IEEE compliance had to be forced by disabling optimization,
  because x87 80-bit registers changed results.
- **Lévy.** Expansions reached 65,000 components and over- or underflowed
  double's exponent on ThingiCSG example0021-0024 and Thingi10K #101633.
  Geogram 1.9.8 took ~37 min on the 1999-op cube grid; 1.10.0 took 112 s.
- **Thingi10K #356074.** Choosing the projection axis in floating point
  degenerated a skinny triangle near normal (1, 1, 1): "not pedantic".
- **Indirect_Predicates PR #15 (Aug 2026).** New cascaded implicit points
  reported an undecided interval sign as usable: `orient3D` wrong in 233,200
  of 355,200 filtered queries in one reproducer.
- **quadmotor/hypercut.** An unofficial NW21 reimplementation computes plane
  cross products in `int32`, silently ignoring the paper's overflow bound
  (INFERRED from code in the NW21 note).
- **Cherchi 2020 `computeMultiplier`** builds 2^e with a 32-bit `1 << e`; for
  parts below about 7.4 units the scaling silently falls back to 1 or is
  undefined behaviour (INFERRED from code in the note; not reported
  upstream).

**Tolerances inside "exact" systems.**

- **trueform v0.10.0.** The retired band-on-predicates tolerance "left open
  arrangements at both bands and annihilated half of the union mass at
  1e-5". The replacement quantizes input planes and certifies vertex moves.
- **libigl.** A 1e-3 absolute small-cell relabel (`SMALL_CELL_REMOVAL`) and
  the output self-intersection check (`DOUBLE_CHECK_EXACT_OUTPUT`) have both
  been compiled out since 2016. In release builds, non-PWN input returns
  `false` plus a mesh.
- **CGAL #9497.** Wedge cutters at exactly Z = 3303.0 against a box give an
  empty chain; shifting by 0.1 fixes it. Loriot: "there is no magic way to
  resolve these tolerance issues". The snapping PR #7994 has been open since
  2024-01.
- **wonky's own carrier unification** (plan step 4). The first tolerance,
  2^-40·scale, was about 1000× the rounding it absorbs. Two gate verifiers
  found real skins (2e-11 mm under an axis-aligned face, then 1e-11 mm under
  a tilted face) opened into pockets and written as "exact" B-reps. Fixed by
  never unifying exactly axis-aligned carriers and by tightening to 2^-44,
  derived from the F32x2 rounding of one rigid transform.

**Silent loss.**

- **trueform v0.10.3/0.10.4.** An N-operand build "lost every operand's
  membership"; misplaced split points "exhausted the recovery wave into
  silently missing wall pieces". "A failed plane is silent downstream."
- **Solidean terrain carve.** One unrecovered triangle in trueform 0.7.0
  misclassified whole patches later: "one unrecovered error is all it
  takes". Engines "usually die pretty fast after introducing the first real
  topological error, we basically see no self-healing behavior at all".
- **Carve on the terrain carve.** Volume right, area +10.7 %: duplicated
  opposite-facing coincident faces. A volume-only check misses it.
- **wonky's recover** (bake-off, fixed in step 2). Sliver absorption deleted
  real, exactly meshed faces (volume error up to 2.7e-4, labelled exact);
  the near-tangency pre-check was bypassed by tilts above 1e-12; recover
  wrote a B-rep of a self-touching solid from corefine's invalid
  point-contact mesh.

**Iterated crashes.**

- NW21's milling chain: Cork crashed after 17 steps, Zhou 2016 and Cherchi
  2020 after 71, Campen-Kobbelt after 12.
- Solidean's cube grid: Cork at op 5, CGAL corefine declined at op 5, MeshLib
  exited at op 554, QuickCSG diverged near op 996.
- Zhou 2016's self-union test: the Bernstein-Fussell code "failed on most
  examples"; the Campen-Kobbelt web service failed about 40 % of the time.

**Oracles are wrong too** (wonky, plan §7): OCCT's exact CSG was off by
1.3e-6 relative on a sphere-minus-cone case (recover matched a closed-form
volume to 3.5e-15); OCCT's 1e-7 mm fuzzy tolerance merged a real 1e-9 mm
gap; manifold3d splits rotated touching unions that OCCT keeps as one
solid.

### 4.2 Anti-patterns (INFERRED from the war stories)

1. **Symmetric epsilon rewrite rules.** Every cleanup rule needs a strictly
   decreasing measure. A depth cap or a forced stop is a hidden failure;
   report it as `Unresolved`.
2. **Tolerances on predicates.** Widening a predicate by a band moves the
   problem into every decision. Put the tolerance on the input (quantize
   planes, move vertices, certify the move) or on a named, derived carrier
   merge, and keep predicates exact.
3. **Identity by coordinate equality.** Weld by construction (which
   primitives made this point), not by float equality. Compute each
   intersection once and reuse the bits.
4. **Feeding rounded meshes back as persistent state.** Every lineage that
   does this without a validity check degrades under iteration.
5. **Unchecked preconditions, silent fallbacks, "mesh plus false".** An
   operation must either certify its result or refuse by name. Non-finite
   guards, `exit(1)`, disabled postcondition checks and dormant tolerances
   are all variants of the same mistake.
6. **Global mutable predicate state and atomic index allocation.** Both
   break determinism under parallelism.
7. **Snap tolerances not derived from a rounding model.** A tolerance that
   is not tied to a stated error bound will merge real geometry sooner or
   later; wonky's 2^-40 did within a day.
8. **Symbolic perturbation as semantics.** SoS makes ties consistent, not
   intended. Flush CAD faces need an explicit coplanar policy per operation.
9. **Trusting one oracle, or volume alone.** Use two independent oracles
   plus a closed form or set identity, and check area, bbox, open edges and
   duplicate opposite faces as well as volume.
10. **"Exact" after quantization.** Exact arithmetic on a quantized input is
    exact for a neighbouring problem. Say so, and refuse when quantization
    changes a sign that was nonzero before.
11. **Untested environment assumptions.** FMA contraction, rounding mode,
    flush-to-zero and initialization are part of the predicate contract and
    need a runtime self-test on every target.
12. **Vendor rankings as truth.** Each vendor wins its own protocol. Compare
    on your own workload.
13. **Majority votes where a refusal is expected.** A statistical estimator
    can be defeated by a constructed input; report disagreement instead.

---

## 5. What wonky should take: ranked proposals

**Ranking rule.**

1. First, measurements that could invalidate claims the decided design
   already relies on: "chains do not drift" (P1) and "the coincident-face
   class is closed" (P2).
2. Then fixes on the production path in the plan's own order: the named
   provenance gap (P3), a provable numeric model (P4), termination (P5), and
   the one place where wonky ships a mesh as the result (P6).
3. Then infrastructure (P7) and futures (P8, P9).

**Relation to the bake-off.** The bake-off decided the topology engine
(corefine) and the geometry stage (recover). No proposal reopens that
decision. The exact lineage enters in three ways: as the oracle
(exact-plane), as a source of exact *sub*-decisions (P2, P4), and as naming
discipline (P3). Section 1.2 is the reason to keep the path back open: only
plane-based fixed width is exact *and* bounded across chains.

### P1. An iterated-CSG acceptance suite with exact oracles, and an explicit touching-solid policy

**Idea.** Port the Solidean cases as fixtures, adapted so every oracle is
exact and engine-independent:

- **Cube grid in three variants**, all with dyadic coordinates so every value
  is exact on the F32x2 wire:
  - (a) *as published*: unit cubes; even-parity cubes touch only along
    edges;
  - (b) *shrunk*: cubes of side 0.75 on the same centres, no contact;
  - (c) *grown*: side 1.25, neighbours overlap, many exactly coplanar
    axis-aligned faces.
- **Oracle for the grid**: a JS test helper that compresses the box
  coordinates into cells and evaluates the operation sequence per cell. It
  gives exact volume, area and component count after every step, with no
  reference engine (test infrastructure, like `scripts/bakeoff/arbiter.mjs`).
- **Scales**: 3×3×3 (53 operations) on the JS target in `npm test`; 5×5×5
  (249) native; 10×10×10 (1999) as a nightly native run.
- **Two chain modes**:
  - *hybrid*: every step recovers the exact B-rep and re-tessellates it (the
    production path; boxes are planar, so recover must be exact every step);
  - *mesh-only*: corefine's `ok` mesh is fed back as the next operand. This
    measures the plan's unmeasured "about 2^-44 relative per constructed
    point" directly.
- **The other Solidean cases**:
  - the 9-op chain (sphere − 3 tori − 6 spheres) with *analytic* leaves, a
    recover test on sphere/torus curves against OCCT or a closed form;
  - the 223-op terrain carve (CC BY 4.0 meshes) as a mesh-only corefine chain
    with exactly coplanar seams;
  - dome carve at 100, 250 and 1000 steps as a time-per-cut canary. Not
    100k.
- **Touching policy.** Prediction (INFERRED): variant (a) is refused at the
  first edge-contact step, like CGAL corefine at op 5, because recover and
  the gate refuse line contact. Record that as an expected refusal whose
  message tells the user to add clearance, or decide to represent
  touching-but-disjoint solids (open question Q2). Either way the choice is
  written down, not emergent.

**Where it plugs in.**

- `fixtures/bakeoff/` (a new `iterated` suite), `scripts/bakeoff/run.mjs
  --suite`, a new oracle helper next to `arbiter.mjs`.
- Plan §2.4 ("chained CSG") and §9 ("chained operations do not drift":
  "argued, not measured").

**Bend fit.** No kernel change. Chains are sequential by nature; each step
uses the existing `hybrid.boolean(job)` entry.

**Expected benefit.**

- Turns the plan's drift argument into a measurement, and produces the first
  iterated-CSG data below double precision anywhere (§1.6).
- Catches the failure taxonomy of §4.1 ("one lost triangle poisons later
  steps") in CI instead of in a model.

**Risks.**

- JS runtime for 53 steps (each hybrid call is tens to hundreds of ms on JS;
  acceptable).
- The terrain meshes are untagged. Each input triangle needs a planar tag,
  so the face table grows large.
- The mesh-only chain mode may need a job encoder for mesh operands (plan
  step 6).

**First acceptance test.** Cube grid 3×3×3, variant (c), on JS and cpu1:
all 53 steps match the cell oracle (volume within 1e-12 relative, area
within 1e-12, component count equal), `exact` at every step, byte-identical
across the two targets. Variant (a): a named refusal at the first
edge-contact step, identical on both targets.

### P2. Replay Manifold's coincident-face failures against corefine, then decide coplanar ties exactly only if needed

**Idea.** Manifold's documented weak spot is exactly coincident faces off
the axes. wonky added carrier unification and the gates, and 14 of 14
rotated coplanar cases are now exact. But the external reproducers were
never run. So, first measure:

- **#1656**: union of two random tetrahedra sharing one exact face, 1000
  trials (Manifold keeps duplicate internal faces in 1.4 %, graded by axis:
  X 3.0 %, Y 1.2 %, Z 0 %).
- **#1430**: the octagon-with-two-bars subtraction that leaves shards.
- **ThingiCSG `nasty_gears_1`** and the `seven_sins` files (BSD-3): two sets
  of 50 rotated cubes. Needs a small converter from OpenSCAD `.csg` (cube,
  cylinder, sphere, `multmatrix`) to bake-off jobs.
- **Zhou 2016's clone tests**: A ∩ clone(A), and A ∪ ten rotated copies.

Expected outcome (INFERRED): no wrong `ok`, because the gate refuses a
duplicate coincident face pair of different tags ("touching counts"). The
risk has moved from wrong answers to a **refusal rate** on flush CAD faces.
Only if that rate is material, add an exact coplanar pass:

- For pairs of input triangles from different leaves whose carriers are
  exactly equal or in one unified class, classify the contact exactly
  (trueform's five types VV, VE, VF, EE, EF from orient3d zero patterns)
  with fixed-width U32 predicates on the dyadic wire values.
- Resolve the tie by a written policy per operation (coincident opposite
  faces cancel in a union, a total order on leaf index as in EMBER and
  Zhou), and feed those answers to corefine as fixed shadow decisions
  instead of letting the octant-based perturbation decide.

**Where it plugs in.** New fixtures in `fixtures/bakeoff/adversarial-corefine.json`;
if needed, a pass in `kernel/hybrid/corefine/prep.bend` before `shadow.bend`,
sharing `kernel/hybrid/unify.bend`'s classes.

**Bend fit.** The tests need nothing new. The exact pass is degree ≤ 3 on
dyadic inputs: fixed-width, branch-free, one map over candidate pairs.

**Expected benefit.** Either evidence that the class is closed, or exact
results where corefine now refuses flush faces. Flush faces are the normal
case in FDM CAD (pockets, stacked parts, chamfers on rotated bodies).

**Risks.**

- Injecting exact answers into Smith's hierarchy must keep "each question
  answered once": every dependent decision must read the injected answer.
- New code in the most delicate stage; the byte-identical corpus is the
  guard.

**First acceptance test.** #1656 × 1000 trials on cpu1: 0 wrong `ok`, and
the refusal count reported. If the exact pass is built: 0 refusals on the
same 1000 trials, and the corpus plus the four suites byte-identical.

### P3. Exact provenance records from corefine to recover

**Idea.** corefine already knows, for every constructed vertex, which pair
created it: each `Kernel12` record is (edge of P, face of Q). Emit that as
provenance in the result:

- **per new vertex**: the set of tags it lies on (the tags of the P edge's
  two incident triangles plus the Q face's tag). Two distinct tags on the
  edge mean a vertex where three carriers meet;
- **per intersection edge**: the (P tag, Q tag) pair.

This is the same object under three names in the sources: Cherchi's implicit
points (LPI = edge × plane, TPI = plane triple), CK10's "every output vertex
is an input plane triple", and trueform's EF records and face triples (all
DOCUMENTED). recover then takes curve assignments from the records, checks
them against patch adjacency (a disagreement is a named refusal), and no
longer needs sliver absorption where the assignment is known. The plan lists
exactly this as the last item of step 9 (DOCUMENTED, plan §2.2 "Gap").

**Where it plugs in.** `kernel/hybrid/corefine/assemble.bend` and
`weld.bend` (records), an optional `prov` section in
`kernel/hybrid/mesh-io.bend`, the consumer in `kernel/hybrid/recover/`, and
`src/identity.mjs` for source faces of new edges.

**Bend fit.** The records are per-pair values the kernels already compute in
parallel. Carrying two U32 tags per record is uniform work; emitting is one
sort by output edge key.

**Expected benefit.**

- Removes the heuristic that deleted real faces in the bake-off (plan §7).
- Cuts recover's re-derivation. recover is 48 % of hybrid compute at 18
  threads (plan §3).
- Gives exact "which input faces meet here" for every new edge and vertex:
  stable names for identity, diff and review.

**Risks.**

- corefine's weld and 2^-36·scale short-edge collapse merge vertices built
  from different pairs, so provenance becomes a set; a merged set whose
  carriers cannot meet must be a named refusal.
- Tessellation edges inside one analytic face carry the same tag on both
  sides and add no information.
- The wire format grows; keep the section optional until recover consumes it.

**First acceptance test.** On the 38-case corpus: every corefine output
edge between two different carrier classes carries a provenance pair equal
to the pair recover derives today (0 mismatches). Then recover driven by
the records gives byte-identical B-reps on the 32 exact cases, and the 6
sliver cases of the adv-recover suite stay exact or named refusals.

### P4. F32x2 numeric hygiene: an accurate double-word add, a derived error bound, and a target self-test

**Idea.**

1. Replace the "sloppy" add in `kernel/real.bend` (Joldes-Muller-Popescu
   Algorithm 5, no bound for opposite-sign operands; their advice is "never
   use Algorithm 5, unless you are certain that both operands have the same
   sign") with Algorithm 6 (AccurateDWPlusDW, 20 flops instead of 11,
   relative error ≤ 3u²/(1 − 4u), about 3·2^-48 for F32 words). At least do
   it in corefine's `Interpolate`/`Intersect` ports, whose differences of
   nearly equal coordinates are exactly the opposite-sign case (DOCUMENTED:
   12 `R.add`/`R.sub` calls in `shadow.bend`).
2. Redo Smith's chapter 8 tables for corefine's actual operation sequence
   with double-word bounds (add 3u² + 13u³; mul 7u² without FMA). Replace
   the stated "about 2^-44" with a derived constant α.
3. Check and document that corefine's topological tolerances sit above α
   with a stated margin: the 2^-36·scale collapse, the 2^-36·scale tie band
   and the 2^-44 unification (derived from 2^-49 wire rounding).
4. Add a start-up self-test on every target (JS, C, Metal): TwoSum and
   Dekker splitting on known inputs, round-to-nearest, no flush-to-zero in
   the used range, no contraction. Refuse to run otherwise (Geogram #382 and
   #391; the MSL spec allows flush-to-zero and round-toward-zero).

**Where it plugs in.** `kernel/real.bend`, `kernel/hybrid/corefine/shadow.bend`,
the certified filter constants in `gate.bend`, `docs/proto-corefine.md`
"Numeric model", and the native/Metal drivers for the self-test.

**Bend fit.** Pure F32 operations, uniform, branch-free. Bend already pins
contraction off (`#pragma clang fp contract(off)`, `MTLMathModeSafe`, CUDA
`--fmad=false`; DOCUMENTED in the TR-766 note).

**Expected benefit.** A provable numeric model instead of a stated one. The
gate's certified F32 filters and unification's derivation assume bounded
arithmetic. INFERRED: it also removes a latent source of wrong ties for
short edges far from the origin, where the sloppy add's absolute error
(about u² × the operand) is large relative to the difference.

**Risks.**

- Every output bit may change, so the byte-identical baselines must be
  re-recorded, with verdict identity as the gate.
- About 9 more flops per add. corefine's decisions are 1-3 % of a Boolean
  (plan §6), so the cost should be small; measure it.

**First acceptance test.** A Bend property test over 10^6 random
opposite-sign F32x2 pairs, checked against exact dyadic subtraction in big
integers: Algorithm 6 stays within 3·2^-48 relative, and the test records a
counterexample for the current add. Then the corpus and the four suites give
identical verdicts, with volumes within 1e-12 relative of the current
results.

### P5. Terminating cleanup, and closing the same-tag gap in the gate

**Idea.**

- **Termination.** For every repair rule in corefine (short-edge collapse,
  zero-width face removal, T-junction handling, the ear-clipping fallback,
  the weld), write down a strictly decreasing measure: edges shorter than
  eps, triangles, reflex corners. Every fuel exhaustion becomes a named
  refusal that states the counter. This is the lesson of Manifold #1842 and
  of Smith's PDMS fault (§4.1).
- **The same-tag gap.** corefine's gate does not test two triangles of the
  same tag, cut from one input face, against each other (DOCUMENTED,
  `docs/proto-corefine.md`: "one between two triangles of the same tag ...
  is not tested"). Such triangles are coplanar, so the test is a cheap 2D
  overlap check in the tag's plane. Add it to the existing BVH join.

**Where it plugs in.** `kernel/hybrid/corefine/assemble.bend`,
`earclip.bend`, `weld.bend`, `gate.bend`; Manifold's #1842 pair
(`test/models/r1.obj`, `r2.obj`, Apache-2.0) as a fixture.

**Bend fit.** Fuel loops already exist in the hybrid util (plan step 5). The
2D overlap test is uniform per candidate pair.

**Expected benefit.** No hidden hangs, and a complete "no self-intersection"
claim for the output mesh, which the CertifiedMesh path relies on.

**Risks.**

- Some current rules may have no decreasing measure and need redesign.
- The same-tag join adds candidate pairs; the gate already costs about +11 %
  at cpu18.

**First acceptance test.** The #1842 pair, converted to a job with one
planar tag per input plane, finishes on all four targets with `ok` or a
named refusal. A fuzz run of 1000 random near-coincident jobs never hits a
fuel limit without naming it.

### P6. Validated F32 snap rounding for CertifiedMesh export

**Idea.** CertifiedMesh bodies are corefine meshes. Writing them as STL or
3MF rounds F32x2 coordinates to F32, which can collapse slivers and create
self-intersections. The step-7 status already needed a diff that drops
"float32-collapsed slivers of a hybrid mesh in the r20 export" (DOCUMENTED,
plan step 7). Do the rounding in Bend and certify it:

1. Round to F32. Run the exact self-intersection gate and the vertex-link
   check on the rounded mesh.
2. On a hit, apply the snapping half of Valque-Lazard (CC BY 4.0 paper):
   snap the offending vertices *and every vertex in the same grid cell* to
   cell centres of a coarse power-of-two grid, drop triangles that became
   exactly degenerate, and check again. At most 5 rounds with a coarser grid
   each time, then a named refusal.
3. Add the largest vertex move to the stated deviation.

Valque-Lazard re-refine the snapped mesh exactly after each snap
(autorefinement). wonky has no self-union in this lineage (Smith §6.4:
cross-object-only pairing cannot compute it), so where they repair, wonky
refuses by name. How often that happens is part of the measurement.

This is CK10's "coordinates last" plus Valque-Lazard's bounded iteration,
with wonky's rule that approximations carry a stated tolerance.

**Where it plugs in.** A Bend entry next to `kernel/hybrid/main.bend`;
called from `src/hybrid-mesh.mjs` (`certifiedMeshBody()`) and the STL/3MF
exporters. Replaces the task-11 sliver-dropping diff.

**Bend fit.** Rounding and the gate are uniform maps and the existing BVH
join; the retry is a small fixed loop.

**Expected benefit.** The CertifiedMesh claim ("passes
`validate-print-mesh.py` within the stated deviation") becomes guaranteed
rather than usually true. It closes §1.3's materialisation gap on the only
path where wonky ships a mesh as the result.

**Risks.** Without an arrangement step the loop can only snap or refuse,
never repair, so the refusal rate on sliver-rich meshes is unknown. The snap
moves vertices by up to half a cell, which must stay below FDM resolution (a
2^-10 mm cell moves at most about 0.5 µm).

**First acceptance test.** pipe-tee and both Steinmetz CertifiedMesh
results, exported to STL: an exact self-intersection check on the F32 file
finds nothing, `uv run scripts/validate-print-mesh.py` passes within the
stated deviation, and the snap count is reported.

### P7. Validator and harness: the failure taxonomy, the OBB protocol, differential counts

**Idea.**

1. Extend the bake-off validator with the failure classes other engines hit
   in long chains (Solidean taxonomy): duplicated opposite coincident faces
   (Carve), zero-volume walls, negative volume, open edges, and the bbox
   check that tells A − B from B − A (OBB smoke test). Add Zhou's
   postcondition: zero total signed incidence on every edge.
2. Adopt OBB's status vocabulary for wonky's Boolean driver (`success`,
   `unsupported`, `invalid_input`, `invalid_output`, `timeout`, `crash`),
   mapped from `exact`, `mesh`, `unresolved`.
3. Write an out-of-tree runner (a `uv` script calling the native hybrid
   binary) that speaks `request.json`/`result.json`. State the capability
   letters honestly: at most "R I" for the mesh stage, never "E".
4. In CI, compare corefine and exact-plane on V/E/F counts, Euler
   characteristic and components, the method Cherchi 2020 used against
   libigl.

**Where it plugs in.** `scripts/bakeoff/validate.mjs`, `run.mjs`,
`judge.mjs`; a new out-of-tree runner directory under `tmp/` or `tools/`.

**Bend fit.** Harness only.

**Expected benefit.** External comparability with 17 engines without
linking any of them (the project's no-linking rule holds: the runner is a
subprocess), and early detection of the silent-loss classes of §4.1.

**Risks.** A full OBB build takes 30+ minutes plus a 60+ minute vcpkg warm-up,
so not while the CPU benchmark runs. OBB inputs are untagged meshes, so it
measures only the mesh stage. Rankings stay protocol-specific.

**First acceptance test.** The OBB smoke test (unit cube minus a
corner-offset cube) through the wonky runner reports `success` with volume,
area and bbox equal to the reference. A fixture with duplicated opposite
faces is flagged by the validator although its volume is right.

### P8. Fixed-width limb records and a predicate generator

**Idea.** Replace the variable-length `List<U32>` integers in the exact tiers
with statically sized records of U32 words holding 16-bit limbs. The limb
count is chosen per subexpression from its degree and a declared input range
(Solidean's "Surrat" compiler, trueform's T0/T1/T2 ladder). A build-time
generator takes one polynomial and emits three Bend functions:

- an F32x2 static filter with a double-word error constant (P4's bounds, no
  FMA);
- the fixed-width exact evaluation;
- the SoS cascade.

That is Lévy's "one expression for the filter, another for exact
evaluation, a third for SoS", and Geogram's PCK pattern re-targeted to Bend.
Also ask HigherOrderCO for a U32 multiply-high (or u32 × u32 → (lo, hi))
primitive: it would cut every limb product 4×.

**Where it plugs in.** `kernel/robust-predicates.bend`; the big-integer tier
of `kernel/hybrid/corefine/gate.bend`; `kernel/proto/exact-plane/big.bend`
and `geom.bend`; P2's exact coplanar pass. The generator is a script that
writes Bend source, so production geometry is still computed in Bend.

**Bend fit.** The best possible: fixed shape, no allocation, branch-free,
uniform enough to batch on a GPU.

**Expected benefit.** INFERRED: a 5-10× faster exact tier (the measured gap
to NW21 is ~175×, of which the limb penalty explains 16×). A cheaper oracle.
The path back to exactness in production (§1.2), and a cheap substrate for
P2 and for exact-plane's missing quantization refusal rule (§3.3).

**Risks.** Generator correctness must be property-tested against the current
Bigs. Out-of-range input must refuse. Very large records may hit Bend code
generation limits (the "arity over 255" failure seen in
`ports/curved-intersection.bend`).

**First acceptance test.** `tmp/exact-plane/pred-bench.bend`: the exact
constructed-vertex classify drops from 6.0 µs to at most 1.0 µs (native, 1
thread), 10^6 random predicates agree bit for bit with the current Bigs, and
exact-plane's corpus outputs stay byte-identical.

### P9. N-ary Booleans by operand bitmasks, after measuring

**Idea.** A FeatureScript `opBoolean` with many tools, or a whole feature
tree, becomes one job whose classification is an operand bitmask per patch
plus a compiled expression: Zhou's f(w), Lévy's XOR flood, trueform's
bitvector potential, EMBER's indicator function. wonky already has
restricted forms: exact-plane evaluates a CSG tree per piece, and corefine's
CSG layer flattens union chains and subtraction spines. Measure first: chain
versus balanced tree versus flattened job, on multi-tool fixtures.

Note the constraint from Smith §6.4 (DOCUMENTED): cross-object-only pairing
cannot compute the self-union of overlapping tools. A general N-ary corefine
must process all operand pairs and classify at arrangement level. That is a
substantial change to the validated stage.

**Where it plugs in.** corefine's CSG layer (plan stage [A]) and plan step 12
("`opBoolean` with many tools becomes one n-ary job").

**Bend fit.** Bitmask selection is uniform per patch; pair kernels run in
parallel across all operand pairs. The operand count must be an explicit cap
with a named refusal above it (Geogram's hidden 32-operand cap).

**Expected benefit.** Vendor-run numbers suggest large wins: trueform at
N = 64 in 103 ms against Manifold's 1467 ms; Zhou's 10-tetrahedra union 6.5×
faster than a chain. For wonky, fewer recover runs per feature.

**Risks.** A large change to the topology stage for a gain that is not yet
measured on wonky's workload.

**First acceptance test.** A FeatureScript fixture with 20 bosses and 20
holes in one `opBoolean`: time the flattened job against 40 sequential
operations; both give the same exact B-rep (face, edge and vertex counts;
volume within 1e-9 relative).

### Not proposed, on purpose

- **Expansion arithmetic** in any form. The F32 exponent would fail 7-8×
  sooner than Lévy's double expansions (§1.4).
- **A majority vote** (trueform). Report disagreement instead.
- **Smith's smoothing post-process.** No termination or accuracy guarantee.
- **exact-plane in production.** Quantization changes topology on rotated
  CAD input, and it is 2.5-5.6× slower; it stays the oracle.
- **The Boolean on Metal.** Measured 2.4× slower than cpu18 (plan §6), and
  Manifold's own Metal attempt failed on dispatch overhead (§1.5).
- **The 100k-step dome carve** as a target.

---

## 6. Open questions worth a prototype

Each question names the smallest prototype that would answer it.

**Q1. Where does F32x2 "ask once" stop surviving a chain?**

- Why: every iterated data point for the Manifold lineage is in double; the
  one float32 data point (trueform 0.7.0) failed the terrain carve and the
  dome at 250 steps (§1.2). wonky's mesh-only chains after an `Unresolved`
  recovery run exactly this regime.
- Prototype: P1's mesh-only mode on the 223-op terrain carve. After every
  step, compare corefine's mesh with a double reference (manifold3d as a
  test oracle) on volume, area, components and the Hausdorff distance of the
  vertices. Record the first step where they disagree beyond 2^-44·scale
  per step.
- Settles: whether the plan's "about 6e-10 mm after 100 operations" holds,
  and whether mesh-only chains need a periodic exact re-anchor.

**Q2. Refuse or represent touching-but-disjoint solids?**

- Why: CGAL refuses (and ends the cube grid at op 5); Zhou, Manifold and
  Solidean represent them. For FDM, an edge contact usually prints as a weld
  or a crack, so refusal is a defensible default. But lattices,
  checkerboards and print-in-place assemblies produce contact on purpose
  (the CGAL note's open question).
- Prototype: on cube-grid variant (a), let corefine duplicate vertices along
  contact edges (Solidean's "Solid" closure), and let recover emit separate
  shells that share an edge. Check what STEP writers and slicers make of it.
- Settles: whether representation is cheap enough to offer as an explicit
  policy (`contacts: 'refuse' | 'separate'`), never as a silent default.

**Q3. Can coplanarity come from identity instead of a tolerance?**

- Why: BF09's "no rotations" and trueform's "identity, not coordinates" both
  say that coplanarity should never be rediscovered numerically. wonky's
  2^-44 unification is derived and reported, but a tolerance merged real
  geometry twice before it was tightened.
- Prototype: in the body → job encoder (plan step 6), record for each face
  the FeatureScript reference its plane came from (the same sketch plane, an
  "up to face" target, one transformed carrier). Count, on the corpus and
  the R20 models, how many unified pairs share such an upstream reference.
- Settles: whether identity can replace most of the tolerance, leaving
  unification only for coplanarity the user typed in as numbers.

**Q4. Could exact contact typing replace the pre-certificate, gate and unification stack?**

- Why: trueform decides contact types exactly with degree-3 predicates and no
  SoS (§3.4). wonky decides with SoS, then checks with exact gates, then
  refuses near contacts through recover's pre-certificate. Fewer tolerances
  would be easier to explain.
- Prototype: a degree-3 lattice classifier on the dyadic F32x2 wire values
  (P8's fixed-width records), run as a side channel next to corefine on the
  four suites; compare its contact types with corefine's decisions and
  refusals.
- Settles: which of the current refusals are really undecidable at the
  deviation (they stay) and which are artifacts of SoS (candidates for P2).

**Q5. Is an exact membership structure worth it for interference and clearance?**

- Why: the plan answers interference with corefine intersect, and a
  face-touching intersect is refused rather than returned empty (plan §5).
  NW21's persistent octree of BSPs gives exact point membership, contact
  versus overlap, A xor B for diffs, and structural sharing between feature
  steps (a Merkle-style history).
- Prototype: after P8, a functional octree of small plane-based cells for
  planar bodies only; measure contact-versus-overlap classification on the
  sdf verifier's FDM fixtures.
- Settles: whether exact contact classes need their own structure or can
  stay a corefine refusal with a clearance hint.

**Q6. Is there any uniform kernel in the Boolean that beats cpu18 on Metal?**

- Why: Metal is 2.4× slower than cpu18 for corefine (plan §6), and
  Manifold's Metal PR died of dispatch overhead. The only uniform candidates
  are batched broad phase, batched filtered predicates across all Booleans
  of a model, and the gate's certified F32 filters.
- Prototype: read Menezes et al. 2022 (catalog) first. Then one flat SoA F32
  kernel for the gate's filter over every candidate pair of a whole model,
  timed against cpu18, as plan §6's three conditions require.
- Settles: whether the GPU has any role in the Boolean, or only in the sdf
  analyses.

**Q7. Can the sequential stages go parallel without atomics?**

- Why: corefine scales 1.46× from 1 to 18 threads because union-find,
  assembly walks and the weld are sequential (plan §3). Every source uses
  mutation there. No purely functional version exists (§1.6).
- Prototype: min-label propagation or pointer jumping for Winding03's
  components, and sort-based assembly (sort half-edges by key, pair by
  segmented scan), in Bend, inside `tmp/corefine/prof/`. Watch Bend's two
  CPU-pool traps (sharing forces atomic counts; a fork before a Boolean in
  the same frame serializes it).
- Settles: whether one Boolean can use more than 1.5× of 18 cores, or the
  parallel win stays across operations (plan step 12).

**Q8. Which metamorphic properties hold, and which are policy?**

- Why: exact oracles are wrong sometimes (§4.1), and a property test needs
  no oracle.
- Prototype: property tests on generated jobs:
  - operand order: A ∪ B and B ∪ A give the same solid up to face identity
    (Smith's axis shift would fail this; Manifold's normal-based ties should
    pass);
  - rigid motion: rotate-then-Boolean equals Boolean-then-rotate within the
    unification bound;
  - trueform's "commutes with idealization": idealize(op(noisy)) equals
    op(idealize(noisy)) for small noise;
  - (A − B) ∪ (A ∩ B) equals A (OBB's definition of "E").
- Settles: which invariants wonky can promise in its API, and which depend
  on the tie-break policy and must be documented as such.

---

## 7. Catalog of the remaining sources

### 7.1 Catalog-only sources from the scout (not deep-read)

The one-line descriptions are the scout's; the wonky relevance is INFERRED.

| name | kind | year | status | license | one line | wonky relevance | link |
|---|---|---|---|---|---|---|---|
| Jacobson, Kavan, Sorkine-Hornung: generalized winding numbers | paper | 2013 | historical | paper | robust insideness for non-watertight, self-intersecting soups; plus a 2016 note on Booleans via GWN | classifying imported dirty STL; wonky's own tessellations are closed, so parity suffices there | [igl.ethz.ch](https://igl.ethz.ch/projects/winding-number/) |
| Martens, Trettner, Bessmeltsev: the Antipodal Method | paper | 2026 | new | paper | GWN as a signed ray count plus a boundary integral, to arbitrary precision | an exact-friendly GWN for import classification; a local copy is at `tmp/research/pdf/martens2026-antipodal-gwn.pdf` per the Solidean note | [arXiv 2605.01536](https://arxiv.org/abs/2605.01536) |
| Edelsbrunner & Mücke: Simulation of Simplicity | paper | 1990 | historical | paper | symbolic perturbation that resolves every degenerate case consistently | the formal base of corefine's tie-break and of P8's SoS cascade; wonky's normal-based ties are not SoS proper | [doi](https://doi.org/10.1145/77635.77639) |
| Devillers, Lazard, Lenhart: rounding meshes in 3D | paper | 2018/2020 | historical | paper | first provable 3D snap rounding without new intersections | the guarantee P6 lacks; the Valque-Lazard note calls it impractical | [doi](https://doi.org/10.1007/s00454-020-00202-2) |
| de Magalhães, Franklin, Andrade: 3D-EPUG-Overlay | paper + code | 2020 | abandoned | no license file | exact parallel mesh intersection with rationals, arithmetic filters, SoS and a uniform grid | a uniform-grid broad phase suits fork-join and GPU batches; code not reusable | [doi](https://doi.org/10.1016/j.cad.2019.102801) |
| Menezes, de Magalhães et al.: exact predicates on GPUs | paper | 2022 | historical | paper | exact geometric predicates evaluated in parallel on GPUs | the only lead for Q6; read before any Metal trial | [doi](https://doi.org/10.1016/j.cad.2022.103285) |
| Thingi10K (Zhou & Jacobson) | dataset | 2016-2026 | maintained | Apache-2.0 tooling; per-model licences vary | 10,000 real 3D-printing meshes with defect annotations | stress fixtures by id (#996816, #101633, #356074, #252784); store ids and a fetch script, check each model's licence | [GitHub](https://github.com/Thingi10K/Thingi10K) |
| Diazzi & Attene: convex polyhedral meshing | paper + code | 2021 | maintained | no license file | defective soups to a convex polyhedral volume mesh with indirect predicates | Livesu names it as the heuristic workaround for cascading, "for very shallow CSG trees"; a candidate for dirty-import repair only | [arXiv 2109.14434](https://arxiv.org/abs/2109.14434) |
| libigl | library | 2013-2026 | active | MPL-2.0 core; GPL via CGAL for `copyleft/cgal` | hosts Zhou's Booleans and the (fast) winding-number code | behavioural reference only (see the Zhou note) | [GitHub](https://github.com/libigl/libigl) |
| Barill et al.: fast winding numbers | paper | 2018 | historical | paper | Barnes-Hut GWN for soups and point clouds, with an accuracy parameter | an explicit-tolerance classifier for scans (the scan reverse-engineering workflow) | [project](https://www.dgp.toronto.edu/projects/fast-winding-numbers/) |
| Bartels, Fisikopoulos, Weiser: fast floating-point filters | paper | 2023 | historical | paper | systematic static and semi-static error bounds for predicates | the method to derive P4's and P8's F32x2 filter constants | [doi](https://doi.org/10.1007/s10543-023-00975-x) |
| Cork (gilbo/cork) | library | 2013-2016 | abandoned | LGPL with exception | early float Boolean "without users caring about floating point" | negative example: crashed at op 5 of the cube grid and after 17 milling steps | [GitHub](https://github.com/gilbo/cork) |
| QuickCSG (Douze, Franco, Raffin) | paper + code | 2017 | abandoned | non-commercial | very fast multi-operand CSG in floats with a kd-tree, no guarantees | negative example: diverged near op 996 of the cube grid | [arXiv 1706.01558](https://arxiv.org/abs/1706.01558) |
| boolmesh and meshbool | Rust libraries | 2025-2026 | new | MPL-2.0 (boolmesh), Apache-2.0 (meshbool) | small Rust ports of Manifold's Boolean | meshbool PR #11 rewrites the symbolic perturbation (open, "not tested very thoroughly"); watch for P2 | [boolmesh](https://github.com/komietty/boolmesh), [meshbool](https://github.com/luisfonsivevo/meshbool) |
| OpenSCAD (Manifold backend) | product | 2023-2026 | active | GPL-2.0+ | the reference code-CAD tool; moved from CGAL Nef to Manifold for speed | the closest product analogue to wonky; its `.csg` format feeds ThingiCSG (P2) | [GitHub](https://github.com/openscad/openscad) |
| MCUT (cutdigital/mcut) | library | 2021-2025 | maintained | LGPL-3.0 or commercial | mesh cutting and Booleans with exact-predicate kernels | negative example: crashed at op 4 of the terrain carve and the 9-op chain, no result on the cube grid | [GitHub](https://github.com/cutdigital/mcut) |
| Carve | library | 2009-2014 | abandoned | GPL-2.0/3.0 | classic float CSG, formerly in Blender | canonical on the cube grid (23 s), but duplicated opposite faces on the terrain carve (area +10.7 %): the reason P7 checks area, not only volume | [GitHub mirror](https://github.com/VTREEM/Carve) |

### 7.2 Related deep-read notes that belong to other chapters

- [Valque & Lazard 2025, iterative snap rounding](sources/valque-lazard-iterative-snap-rounding-for-triangle-soup-auto.md):
  the heuristic behind P6 (verdict adapt, from the CC BY paper only).
- [CGAL PMP Boolean operations, internals](sources/cgal-polygon-mesh-processing-boolean-operations-separate-pac.md):
  exact nodes, patch classification and snap rounding in code detail; the
  companion of the CGAL contract note.
- [Interactive and Robust Mesh Booleans, code-level sibling note](sources/interactive-and-robust-mesh-booleans-cherchi-et-al.md):
  file and line pointers for Cherchi 2022 (P3).
- [CGAL Nef_polyhedron_3](sources/cgal-nef-polyhedron-3-and-hachenberger-kettner-mehlhorn-bool.md):
  "never wrong on degeneracies" through exact rationals; 280-330 s on the
  long chains.
- [verified-3d-mesh-intersection (Lean 4)](sources/verified-3d-mesh-intersection-lean-4.md):
  a machine-checked mesh-validity contract and a slow exact reference
  intersection (P7).
- [csgrs](sources/csgrs.md) and [hypermesh](sources/hypermesh-hyperreal-hyper-stack-under-csgrs.md):
  agent-driven CSG with certainty-tagged outcomes; unbounded exact reals.
- [Yang et al. 2025, hybrid-representation Boolean](sources/yang-jia-wang-yang-xin-yan-2025-boolean-operation-for-cad-mo.md):
  the published version of wonky's corefine + recover idea; covered in
  [brep-booleans-ssi.md](brep-booleans-ssi.md) §3.7.
- [BREP.io](sources/brep-io.md): a labelled mesh Boolean (over Manifold) as a
  topology backbone; covered in [oss-brep-kernels.md](oss-brep-kernels.md).
- [libfive](sources/libfive.md) and [fidget](sources/fidget-matt-keeter.md):
  the sdf prototype's lineage, now reused for FDM analyses only. The sources
  are covered in [parallel-gpu-geometry.md](parallel-gpu-geometry.md); the
  sdf prototype's FDM role is in [fdm-geometry.md](fdm-geometry.md).
