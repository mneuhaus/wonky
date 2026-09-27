# Edelsbrunner & Mücke 1990, Simulation of Simplicity

- Kind: research paper. Canonical [DOI](https://dl.acm.org/doi/10.1145/77635.77639); [author-hosted complete PDF](https://pub.ista.ac.at/~edels/Papers/1990-04-SimulationofSimplicity.pdf).
- Authors: Herbert Edelsbrunner and Ernst Peter Mücke, University of Illinois at Urbana-Champaign. ACM Transactions on Graphics 9(1), January 1990, pp. 66–104; received May 1987, revised May 1988, accepted June 1988. DOCUMENTED, PDF first/last pages.
- License: ACM copyright, not an open-source software license. The first page permits specified noncommercial copying with notices, not unrestricted code republication. INFERRED porting policy: implement the mathematical technique independently and cite it; do not assume that copying its Pascal listings or a historical SoS library is permissively licensed.
- Status: historical peer-reviewed foundational paper, not a maintained repository; stars/releases/contributor counts do not apply. Read all 20 scanned PDF sheets (39 printed pages). Local evidence: `<repo>/tmp/research/pdf/simulation-of-simplicity-1990.pdf`.

## What it is

DOCUMENTED: SoS evaluates geometric *topological predicates* as if input parameters had undergone one globally consistent, infinitesimal perturbation. It preserves every originally nondegenerate sign and deterministically resolves exact zeros. No numerical epsilon is selected and no perturbed coordinates are materialized. General position is relative to the finite family of predicates being supported, not a claim that every conceivable algebraic expression becomes nonzero. The framework primarily addresses constant-depth algebraic decisions, not numerical construction accuracy ([PDF](https://pub.ista.ac.at/~edels/Papers/1990-04-SimulationofSimplicity.pdf), §§2, 6).

## How it works

1. DOCUMENTED: give each geometric object a unique, persistent index `i`; write each coordinate as `p[i,j] + e(i,j)`, with symbolic epsilon powers whose significance is ordered by indices. Smaller point index dominates; for the same point, larger coordinate index dominates. Products of perturbations are ordered so no cancellation can erase the final constant nonzero coefficient. The paper proves an admissible superincreasing exponent scheme and explains why simple linear/exponential-looking substitutes can leave determinants identically zero (§3.2, Lemmas 3.2–3.3, pp. 75–77).
2. DOCUMENTED: for orientation, form the determinant with one point per row and a final column of ones. Expand only *conceptually* in epsilon. The constant coefficient is the original determinant; subsequent coefficients are signed minors of the original matrix. The answer is the first nonzero coefficient, in decreasing significance. Sort rows by object index first and restore the sign using sorting parity (§4, Predicate 2 and `SignDet`).
3. DOCUMENTED: tables are finite for fixed dimension. Cartesian orient2d has five relevant coefficients (Table IV); Cartesian orient3d has fifteen (Table V). Do not confuse these with the separately tabulated homogeneous determinants: a general 4×4 homogeneous matrix has fifty relevant terms (Table VI). The 0×0 determinant convention is one.
4. DOCUMENTED, with the minors simplified algebraically: for points `i < j < k`, Table IV gives this complete orient2d ladder: `det([[xi,yi,1],[xj,yj,1],[xk,yk,1]])`, `xk-xj`, `yj-yk`, `xi-xk`, `+1`. Return the sign of the first exact nonzero member, then flip for an odd permutation from the caller's order. This is substantially safer to port than inventing a tie-break separately at each use site. It assumes three distinct object IDs; equal coordinates with distinct IDs are allowed, repeated identity is not the theorem's input.
5. DOCUMENTED: §4.2 provides a generic coefficient-table generator (`Next-v`, `Matrix`): a vector encodes deleted row/column pairs, the remaining submatrix supplies the minor, and deletion-index parity determines its sign. Cartesian coordinates avoid perturbing the final ones column, reducing work. This is useful for offline generation of straight-line Bend predicates.
6. DOCUMENTED: §5.2 expresses the side of an intersection of planes without constructing that intersection. Cramer's-rule determinants give a denominator sign and an augmented numerator determinant sign; `OnPositiveSide` compares them with parity corrections. §5.4 obtains an in-sphere predicate by lifting to a sum-of-squares coordinate and then perturbing the *lifted coordinates independently*. That is not the same perturbation as substituting perturbed xyz into a square. All related predicates must share the selected perturbation model.

All algorithm details above are from [the primary PDF](https://pub.ista.ac.at/~edels/Papers/1990-04-SimulationofSimplicity.pdf), pp. 70–97 and Tables III–VI.

## Robustness and guarantees

- DOCUMENTED: nonzero unperturbed signs are unchanged for sufficiently small positive conceptual epsilon; consistent tie-breaking follows from evaluating one perturbed input, rather than unrelated predicate-specific hacks. Correctly identifying a zero coefficient requires exact arithmetic, not a floating epsilon comparison (§§2, 3.2, 4.3).
- DOCUMENTED: integer determinants can use long integers or modular arithmetic/Chinese remaindering. Hadamard's bound gives `|det A| <= μ^D D^(D/2)` for a D×D integer matrix with entries bounded by μ, useful for bounding required limbs. The paper permits floating approximation followed by exact evaluation when a certified bound cannot exclude zero; it does not supply a modern ready-made float filter (§4.3).
- INFERRED: exact dyadic F32/F32x2 inputs can be decoded into signed multi-limb integers with aligned power-of-two denominators; positive denominator clearing preserves determinant sign. This only certifies those represented inputs, not an underlying exact analytic intersection already rounded before the predicate. Implicit constructions need their own exact polynomial/rational representation.
- DOCUMENTED: SoS produces the answer for the perturbed set. Original-boundary answers can require a separate exact boundary test. The point-in-polygon example explicitly warns that a boundary point is assigned arbitrarily but consistently to one side; §6 discusses eliminating zero-measure cells and merging coplanar hull faces afterward.

Source: [PDF](https://pub.ista.ac.at/~edels/Papers/1990-04-SimulationofSimplicity.pdf), pp. 71, 87–91, 97–99.

## Parallelism and performance

DOCUMENTED: no GPU or fork-join benchmark. The implementation report says long-integer multiplication dominated its 3D edge-skeleton implementation; substituting restricted-range machine integers gave roughly a factor-ten speedup. This is a historical implementation observation, not a modern SoS-versus-non-SoS penalty or a Bend prediction (p. 98). For nondegenerate inputs the first determinant already resolves the predicate; the authors call the extra SoS cost zero in that case, apart from implementation bookkeeping (p. 86).

INFERRED: independent predicate calls map to a balanced fork-join tree; fixed-size limb arrays and generated minor tables require no shared mutation. A CPU can stop at the first nonzero coefficient; a uniform GPU path can evaluate a fixed table and reduce to the earliest nonzero `(rank,sign)` or bucket unresolved calls after a certified filter. Degeneracies are *not necessarily rare in CAD*: aligned grids, identical faces and touching solids can make most calls enter the ladder. Integer limb reductions require bounded work/depth, not unbounded data-dependent precision. Source basis: [PDF](https://pub.ista.ac.at/~edels/Papers/1990-04-SimulationofSimplicity.pdf), §4.

## Known failures, limitations, war stories

DOCUMENTED: ad hoc perturbations such as coordinates proportional to a common epsilon can retain algebraic dependence (§3.2). Wrong parity or inconsistent index order invalidates the global-perturbation guarantee. Deep algebraic constructions enlarge polynomial complexity; sums of many square roots are outside the easy determinant cases (§6). Recovering *all original boundary points* of a convex hull is particularly problematic: a boundary point can be moved inside and discarded before postprocessing. The paper identifies this as harder than merely merging final coplanar faces. There is no repository issue tracker; these are explicit author-reported limitations ([PDF](https://pub.ista.ac.at/~edels/Papers/1990-04-SimulationofSimplicity.pdf), pp. 76–77, 97–98).

## Relevance for wonky

INFERRED design recommendation: keep two interfaces, `exact_sign -> negative|zero|positive` and `sos_sign -> negative|positive + tie_provenance`. Use the second to choose triangulation/ray-event ordering in the tagged-mesh Boolean, but preserve the first for face coincidence, contact, common-domain merging, and analytic B-rep recovery. Otherwise a robust combinatorial decision can silently destroy precisely the coplanar/cylindrical coincidence information the CAD operation needs. Store canonical provenance-derived IDs, not thread scheduling order; duplicates that are semantically one entity must not acquire unrelated perturbations. Attach selected minor index/depth to diagnostics for diffs and LLM-readable explanations. These recommendations follow the original-versus-perturbed distinction in [§6](https://pub.ista.ac.at/~edels/Papers/1990-04-SimulationofSimplicity.pdf).

INFERRED Bend fit: excellent for an integer exact-predicate fallback and no mutation; F32x2 is a filter, not an exact-zero oracle. Use U32 multi-limb arithmetic with a proven width budget. The formal infinitesimal need never fit F32's exponent range. This does not by itself solve curved SSI, fillet construction, offset singularities, or restore exact analytic geometry from a mesh. It is deterministic topology policy, not a tolerance model for FDM.

## Pointers worth porting or studying

- [§3.2 and Lemmas 3.2–3.3](https://pub.ista.ac.at/~edels/Papers/1990-04-SimulationofSimplicity.pdf): admissible perturbation ordering and failed alternatives.
- Same PDF, §4.1 `SignDet`, §4.2 `Next-v`/`Matrix`, Tables IV–V: orient2d/orient3d straight-line minor ladders and parity.
- Same PDF, §4.3: exact determinant arithmetic and Hadamard bound; §5.2 `OnPositiveSide`: predicates on implicit plane intersections without rounded construction.
- Same PDF, §5.4: lifted in-sphere caveat; §6: mandatory semantic decision about unperturbed results.

## Verdict: adapt

Adopt the globally consistent minor-ladder principle, but adapt its use to CAD: preserve zero/coincidence as first-class evidence and use SoS only where the operation explicitly permits perturbation semantics. No implementation or benchmark was run during this read-only research pass.
