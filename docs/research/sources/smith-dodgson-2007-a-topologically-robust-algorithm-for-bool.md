# Smith & Dodgson 2007: A topologically robust algorithm for Boolean operations on polyhedral shapes using approximate arithmetic

- Kind: journal paper. Canonical: https://doi.org/10.1016/j.cad.2006.11.003 (Computer-Aided Design 39(2):149-163, Feb 2007).
  - Closed access. Crossref, Semantic Scholar and OpenAlex list no OA copy (DOCUMENTED, API queries 2026-09-22).
  - Read instead: the author's extended PhD thesis, J. M. Smith, "Towards robust inexact geometric computation", Cambridge Computer Laboratory Technical Report UCAM-CL-TR-766, Dec 2009, 186 pp. https://www.cl.cam.ac.uk/techreports/UCAM-CL-TR-766.pdf. Local copies: tmp/research/pdf/smith2009-TR766.pdf, and tmp/research/manifold/docs/RobustBoolean.pdf (a byte-different build of the same thesis). Chapter 4 of the thesis *is* the SD07 algorithm, with two errors in SD07 corrected (thesis p.69 footnote 2, credit to Ma Jian, Tsinghua).
  - DBLP: journals/cad/SmithD07. Semantic Scholar lists ~35 citations; Crossref lists 25 (`api.crossref.org/works/10.1016/j.cad.2006.11.003`, 2026-09-22).
  - DOI check (DOCUMENTED, Crossref): 10.1016/j.cad.2006.11.003 is this paper (CAD 39(2):149-163). 10.1016/j.cad.2006.12.003, which appears in some notes, is "Splines in the parameter domain of surfaces and their application in filament winding" (CAD 39(4)), an unrelated paper.
  - Conference predecessor: J. Smith, N. Dodgson, "A Topologically Robust Boolean Algorithm Using Approximate Arithmetic", 22nd European Workshop on Computational Geometry (EuroCG) 2006. Levy 2024 cites this version as [44] (DOCUMENTED, arXiv 2405.12949 references).
- Authors/org: Julian M. Smith and Neil A. Dodgson, University of Cambridge Computer Laboratory. Supervisor Dodgson, second advisor Malcolm Sabin. The algorithm was built earlier at Cadcentre/AVEVA.
- License: the paper is copyrighted by Elsevier and the thesis by the author. Algorithms are not copyrightable, and no patent is known (INFERRED, none cited anywhere in Manifold's Apache-2.0 repo). Re-implementing from the description is unrestricted. Do not copy text or figures into the repo.
- Status: a 2007 journal paper with a 2009 thesis. The algorithm has run in production in AVEVA/Cadcentre PDMS since 1997 (thesis section 5.2). It was revived in 2019+ as the core of Manifold, which ships the thesis as `docs/RobustBoolean.pdf` (DOCUMENTED).

## What it is

A 3D (and 2D) Boolean algorithm for polyhedral solids that runs entirely on ordinary floating point, yet **provably** returns a topologically valid result from any topologically valid input, "irrespective of numerical errors in the computations and the input data" (DOCUMENTED, thesis section 4.1). Even random vertex positions give valid, if meaningless, topology (thesis section 4.9). Geometric validity (no self-intersections, no slivers) is *not* guaranteed. That is delegated to a tolerance-based data-smoothing post-process (thesis chapter 5), which is explicitly "not fully robust".

## How it works

(DOCUMENTED from thesis chapter 4 unless noted.)

- **Topology definitions** (section 4.2). A triangle mesh is valid if each triangle's half-edges form a loop, and, for every vertex pair (P,Q), the number of half-edges P->Q equals the number Q->P. Coincident vertices and zero-length edges are explicitly *allowed*. The same definition is the one Manifold uses and the one that is closed under this Boolean.
- **Dependency pyramid** (section 4.3, fig. 4.4). There are 16 operation types, one per pair of entity kinds (vertex, edge, facet, solid) from A and B. Level = sum of the two dimensions (0..6).
  - Levels 0-3 decide *relations* in progressively higher subspaces: level 1 in x only, level 2 in (x,y), level 3 in full 3D.
  - Levels 3-6 *construct* vertices, edges, facets and the solid.
- **Intersection functions** X_ij and **shadow functions** S_ij (eq. 4.1, table 4.1).
  - S_ij(oA,oB) = X_ij if they intersect in the lower subspace and xi_B >= xi_A in the next coordinate, else 0.
  - The `>=` is the symbolic perturbation: "as though object B had been adjusted by an arbitrarily small shift in the direction of the positive axis". It follows the Edelsbrunner-Muecke SoS idea, but is applied to inexact arithmetic.
  - Every X at level k is a signed sum of S terms at level k-1 over boundary components. Examples:
    - X02(vA, fB) = -sum over h in dfB of S01(vA, h), a 2D winding number.
    - X12(eA, fB) = -S02(ve, fB) + S02(vs, fB) - sum over h in dfB of S11(eA, h).
  - Each lower-level decision is computed once and reused by every higher-level decision that depends on it. That reuse is the entire consistency mechanism.
- **Intersection points by interpolation** (eq. 4.2-4.6). Take one lower-level pair where B shadows A (Delta+ >= 0) and one where A shadows B (Delta- < 0). Then t = Delta+ / (Delta+ - Delta-), which can never divide by zero. Theorem 1 proves such a pair always exists when X != 0. Footnote: evaluate from the nearer end (1-t when t > 1/2). Manifold's `useL` trick implements this.
- **Inclusion values** (eq. 4.7-4.13):
  - I03 = cA + cI·X03, I12 = cI·X12, I21 = cI·X21, I30 = cB + cI·X30.
  - Union: (cA, cB, cI) = (1, 1, -1). Intersection: (0, 0, +1). Difference: (1, 0, -1).
  - The result winding number is phi = cA·a + cB·b + cI·a·b (eq. 4.20), which extends Booleans to arbitrary integer winding numbers.
- **Construction**:
  - Level 4 builds "composite edges" as multisets of start/end vertices with *net end-vertex counts*. Theorem 2: the counts always balance.
  - Any start/end pairing preserves topology. For geometric sanity, sort along v = sum(xe) - sum(xs) (eq. 4.14-4.16).
  - Level 5 collects half-edges per retained facet (Theorem 3: facet closure). Level 6 is the union of all retained facets (Theorem 4: shape closure).
- **Triangulation** (section 4.8) must be specified purely by connectivity so that it works on *geometrically invalid* polygons. Prefer the diagonal that minimises inverted-overlap area (fig. 4.10).
- **Why no self-intersection handling is needed** (section 6.4). Crossing a boundary of A changes phi by cA + cI·b(x), independent of a(x), so self-intersections within A never need to be computed. Only cross-object pairs are tested. Consequently, triples of mutually intersecting edges, the source of inconsistent arrangements, never all get tested. The same argument proves that *simplification* (self-union and overlap removal) cannot be done this way. It needs a sweep (chapter 7), which is exactly the wall Manifold hit in issue #289.
- **Error bound** (section 8.2, eq. 8.17). For the 2D segment intersection with IEEE rounding, the computed point lies within alpha = sqrt(153)·u·L ≈ 12.37·u·L of both segments. Measured in practice (section 8.3): < 2.57u over 10^7 random cases, 99.87% below u. The basic 2D Boolean is "epsilon-tolerant for eps = alpha" (section 8.4). Point-in-polygon classification is correct if the point is more than about 4 ulps-of-range from every edge (section 8.6).

## Robustness and guarantees

- **Proven** (thesis section 4.9, Theorems 1-4): topological validity of the output for topologically valid input, finite work (a fixed number of operations), no forced or discarded data (DOCUMENTED).
- **Not proven:** geometric validity. Near-coincident input yields gaps and slivers whose thickness is bounded by rounding error. Near-vertical non-planar facets in the *polygon* variant yield "quasi-random shard-like artifacts" (section 9.2.2) (DOCUMENTED).
- **Asymmetry.** A ∪ B and B ∪ A can differ structurally, because the perturbation direction is attached to B (section 4.5). Wonky must fix an operand order convention to keep results reproducible (INFERRED).
- **Post-process** (chapter 5, appendix A): vertex merge, zero-length edge removal, edge cracking, half-edge/facet cancellation, with a 0.1 mm tolerance in PDMS. In 5 years there was one field fault, a non-termination with four coincident near-vertical facets. It was "fixed" by forced early termination, which left shard artifacts (DOCUMENTED, section 5.2). Smith himself calls the smoothing an open problem (section 9.2.3).

## Parallelism and performance

- The paper and thesis are single-threaded and give no timings for the 3D algorithm (DOCUMENTED absence). The polygon-mesh variant was faster than the triangle variant in PDMS (section 5.2).
- Structurally, **every level-0..3 decision is a pure function of two entities plus lower-level results**, and each operation "relies only on the data for the entities concerned" (section 4.1). That makes the whole relation phase a DAG of maps. Manifold demonstrates it parallelises on TBB/CUDA (INFERRED + DOCUMENTED via Manifold).
- The chapter 7 simplification sweep is inherently sequential (DOCUMENTED, chapter 7; Manifold Boolean2.md).
- **Iterated-CSG evidence for the family**, via Manifold 3.4.0 in double (vendor-run Solidean series, DOCUMENTED; see `solidean-iterated-csg-benchmark-series-2026.md`):
  - canonical on a 223-op chain with exactly coplanar seams (525 ms; it was the only survivor without exact constructions);
  - canonical on the 1999-op cube grid with an exact per-step oracle (5.3 s);
  - agreeing with exact engines to 1e-4 through a 10k-op carve.
  - This is the strongest available empirical support that "decide once" topology does not degrade under long chains of real operations.
- Levy 2024 on the same lineage: "a completely different paradigm. While the 'manifold' OpenSCAD kernel, based on this paradigm, does not always output a correct result, it does very often, at a spectacular speed" (DOCUMENTED, arXiv 2405.12949 section 4). It fails on heavily coplanar rotated-cube CSG (nasty_gears_1) and drops triangles at 62.5 M vertices (fibo_sphere_500).

## Known failures, limitations, war stories

- **PDMS non-termination** case with coincident near-vertical facets. The workaround produced shards (section 5.2).
- **SD07 contained errors** in the Difference explanation and one other point, corrected in the thesis (p.69 footnote). **Port from the thesis, not the paper** (DOCUMENTED).
- **Slivers are inherent.** Manifold issue #1706: "very much expected to be produced by Smith's Boolean due to symbolic perturbation" (DOCUMENTED, github.com/elalish/manifold/issues/1706).
- **Perturbation direction matters for coincident faces.** The thesis perturbs B by an infinitesimal shift along the positive axes (eq. 4.1).
  - Manifold replaced this with per-operation expand/contract along vertex and face normals, so that touching solids merge and A−A is empty. That choice "effectively perturbs toward one of the 8 octants" and fails for exactly coincident non-axis-aligned faces.
  - Manifold #1430 shows shards. #1656 measures 1.4% failures on random shared-face tetrahedra, graded by the dominant normal axis as X 3.0%, Y 1.2%, Z 0% (DOCUMENTED, https://github.com/elalish/manifold/issues/1430, https://github.com/elalish/manifold/issues/1656).
  - Topology stays valid, as the theorems promise, but the geometric result is wrong-looking. Wonky must specify its tie-break semantics for coincident faces explicitly, not inherit them (INFERRED).
- **No self-union / overlap removal** (section 6.4), and the 3D simplification problem stays open. Triangle meshes risk "laddering" (fig. 9.1) (DOCUMENTED).
- **Tolerance-free guarantees only hold for flat facets.** Curved surfaces are out of scope (section 9.2.4) (DOCUMENTED).
- **Introduction table 1.1** (quoting Mehlhorn-Yap): ACIS, Microstation and Rhino fail on rotated n-gon unions where exact CGAL/LEDA succeeds. This is useful stress-test lore (DOCUMENTED, secondary).

## Relevance for wonky

- This is the theory behind bake-off prototype 1 and the proof obligations it must keep.
  - "Ask once" maps naturally onto wonky's operation-scoped shared decision record (docs/boolean-strategy.md).
  - Each S/X value is a record entry keyed by an entity pair, computed once and read by all dependents. Under no-mutation, fork-join semantics that is simply a sequence of level-wise maps whose outputs are immutable arrays (INFERRED).
- **Precision.** The algorithm never needs exact arithmetic, so F32x2 suffices for *topology*, whatever the rounding.
  - For the *geometric* bound alpha = 12.37·u·L, Smith assumes correctly rounded IEEE ops with relative error <= u.
  - kernel/real.bend is not correctly rounded (INFERRED from reading the code):
    - `add` is the "sloppy" double-word add: TwoSum on hi, plain F32 sum of the lows, then Fast2Sum. This is Algorithm 5 ("SloppyDWPlusDW") of Joldes, Muller & Popescu, "Tight and rigorous error bounds for basic building blocks of double-word arithmetic", ACM TOMS 44(2), 2017, https://doi.org/10.1145/3121432 (HAL hal-01351529v3; local copy tmp/research/pdf/joldes2017-hal.pdf; `joldes2017.pdf` is an HTML stub).
    - Per that paper, for opposite-sign operands "there is no proof that the relative error is bounded", and a concrete example has relative error 1. Recommendation: "never use Algorithm 5, unless you are certain that both operands have the same sign". Algorithm 6 ("AccurateDWPlusDW", two TwoSums, 20 flops vs 11) is bounded by 3u²/(1−4u), Theorem 3.1 (DOCUMENTED).
    - `div` is a single-correction F32 quotient.
  - So wonky must either switch to Algorithm 6 or redo Smith's appendix B error analysis per real.bend operation sequence before quoting any alpha.
  - With Algorithm 6, the add error is at most about 3·2^-48 relative, so alpha is roughly 12.37·c·2^-48·L for a small constant c (INFERRED).
- **Hybrid use.** The level-0..2 shadow decisions could be *certified* by wonky's exact predicates (kernel/robust-predicates.bend, base-4096 U32 digits) where the filter is uncertain. But the S functions must be applied to the *same* computed interpolated points consistently, and exact certification of interpolated points changes the model: lower-level points are rounded constructions. The value of Smith's scheme is precisely that it does *not* need exactness. Mixing the two needs care (INFERRED).
- **Refusal.** The theorem guarantees topology, but wonky wants `Unresolved` over bad geometry. Use the epsilon-tolerance statement (section 8.4) as a *checkable* criterion: flag any decision whose operands lie within alpha of each other, and escalate or refuse (INFERRED).
- **Smith's "valid" is weaker than wonky's "valid".** The thesis definition (section 4.2) only requires that half-edge counts balance per vertex pair and "explicitly allows" coincident vertices and zero-length edges. So a result where two solids touch at one point, or two sheets share a vertex, is valid output under Theorems 1-4 (INFERRED from the definition).
  - Wonky's measured failures are exactly this class. corefine, the port in `kernel/hybrid/corefine/shadow.bend` (moved from `kernel/proto/corefine/`), returned 10 point-contact meshes as `ok` among the 216 adversarial cases. recover turned some of them (`adv-cube-vertex-touch`, `adv2-sdf-box-corner-contact`) into OCCT-valid B-reps of self-touching solids (DOCUMENTED, docs/bakeoff.md "Findings beyond the team reports" 1-2, docs/hybrid-boolean-plan.md section 1).
  - The other wrong answers were geometric, which the theorem never covered: about 1e-10 mm self-intersections on rotated coplanar faces (4) and grazing tools below the deviation (2).
  - Consequence: the theorems give closure of the *half-edge* invariant only. Wonky had to add its own vertex-link (single fan) check and an exact self-intersection check as output gates. That was done in commit aa84b76 (2026-09-24, `gate.bend`, plan section 8 step 1). The 10 point contacts became named refusals and corefine's wrong `ok` count fell from 18 to 3, for about +11 % compute (DOCUMENTED, docs/hybrid-boolean-plan.md).
- **Tie-break policy chosen by wonky** (DOCUMENTED, docs/proto-corefine.md): Manifold's normal-based expand/contract, plus "carrier unification". Plane carriers of different leaves within 2^-44·scale form one class; comparisons within 2^-36·scale between elements touching a class become ties; exactly axis-aligned pairs never unify. This is a deliberate departure from the thesis's pure symbolic shift. It trades Smith's tolerance-free decisions for stable coplanar handling of rotated input, and two gate verifiers found real skins (2e-11 and 1e-11 mm) wrongly opened by the first, looser settings.

## Pointers worth porting or studying

- Thesis table 4.1 (all X/S formulas), eq. 4.1-4.6 (shadow plus interpolation), eq. 4.7-4.20 (inclusion values, general winding mapping), section 4.6 construction rules, Theorems 1-4 (use them as property tests).
- Section 4.8 plus fig. 4.10: triangulation that tolerates invalid polygons.
- Section 6.4: why cross-object-only testing sidesteps triple inconsistency. This is a key argument when deciding which wonky decisions need exact predicates.
- Chapter 7: the robust Bentley-Ottmann sweep for 2D simplification (wonky sketches/sections). Section 7.6.2 is the block rule.
- Section 8.2 / appendix B: the error-analysis template to redo for F32x2.
- Chapter 5 / appendix A: data-smoothing operations. A cautionary list, not a spec.

## Verdict: adapt

Port the algorithm, from the thesis (chapter 4) rather than the paywalled paper, via Manifold's parallel implementation. Wonky's `kernel/hybrid/corefine/shadow.bend` already does this over F32x2, and it won the 2026-09-23 bake-off as the hybrid's topology stage.
- Adopt the proofs as invariants and property tests, and keep the vertex-link and self-intersection gates (added 2026-09-24) that the proofs do not cover.
- Redo the error bound for F32x2.
- Specify the coincident-face tie-break policy explicitly: the thesis axis shift and Manifold's normal-based expand/contract give different geometry.
- Do not adopt the chapter 5 smoothing process as-is.
