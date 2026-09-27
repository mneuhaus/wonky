# Devillers, Fronville, Mourrain, Teillaud 2002, "Algebraic methods and arithmetic filtering for exact predicates on circle arcs"

- Kind: journal paper. *Computational Geometry: Theory and Applications* 22 (2002) 119-142, [DOI 10.1016/S0925-7721(01)00050-5](https://doi.org/10.1016/S0925-7721(01)00050-5). Open copy: [HAL inria-00166709](https://inria.hal.science/inria-00166709v1) (local `tmp/research/pdf/devillers-2002-cgta-hal.pdf`, 30 pp.; read pp.1-8 and 14-27). Earlier versions: EuroCG 2000 and INRIA RR ([HAL inria-00072832](https://inria.hal.science/inria-00072832v1), local `devillers-2002-circle-arc-predicates.pdf`, not read).
- Authors: O. Devillers, A. Fronville, B. Mourrain, M. Teillaud (INRIA Sophia Antipolis), 2000-2002.
- License: paper (Elsevier; HAL deposit). The formulas are free to reimplement. CGAL's circular kernel descends from this prototype (CGAL manual, Circular_kernel_2 "Design and Implementation History").
- Status: historical, foundational; cited by CGAL's Circular_kernel_2 manual as the origin of its degree-2 comparisons.

## What it is

A method to design **exact, low-degree, filterable predicates for arrangements of circular arcs**, applied to the hardest sweep predicate: comparing the abscissae of two intersection points of circle arcs (predicate "h", Fig. 1), without constructing the points.

## How it works

- **Representation stable under cutting (§2).** A circle is `(x−α)² + (y−β)² − γ` with center (α, β) of degree 1 and squared radius γ of degree 2. An arc endpoint is the leftmost or rightmost intersection of its circle with a *line* `px + qy + s` (p, q degree 1, s degree 2). When arc A is cut by arc A1 on circle C1, the cutting line is the **radical axis** `C − C1`, whose coefficients are again of degree 1 and 2. So cutting never increases the representation's degree (Fig. 2-3, p.5). With this representation, predicates a (x-order of endpoints), e (endpoint vs intersection) and h (intersection vs intersection) are the same predicate.
- **Naive method (§3):** solve two quadratics `(p²+q²)x² − 2(q²α − pqβ − ps)x + (s² + 2qsβ + q²α² + q²β² − q²γ) = 0` and compare roots, or square repeatedly. Repeated squaring introduces spurious roots; making it correct needs extra sign conditions ("would give results similar to ours").
- **Resultant method (§4-6).** Eliminate to a degree-4 polynomial `P(t)` whose roots are the translations making an endpoint of A1 and an endpoint of A2 coincide in x. With `Q_i(v,w) = A_i v² − 2B_i v w + C_i w²` (A_i = p_i²+q_i², B_i, C_i as on p.13), the coefficients reduce to invariants:
  - `P0 = A1²A2²`, `P1 = 4A1A2·J`, `P2 = 4J² + 2A1A2·K`, `P3 = 4JK`, `P4 = K² − 4I1I2 = −4JJ' + J''²`;
  - `I_i = B_i² − A_iC_i` (discriminant; `I_i > 0` iff line meets circle), `J = A1B2 − A2B1` (distance of the chord midpoints' abscissae times A1A2), `J' = B1C2 − B2C1`, `J'' = A1C2 − A2C1`, `K = C1A2 + A1C2 − 2B1B2` (K = 0 iff the four abscissae form a harmonic division).
  - 80 arithmetic operations instead of 659 × 13 = 9048 for the monomial expansion (p.14).
- **Decision (§7).** All roots of P are real; Descartes' rule on the signs of P0..P4 counts positive roots exactly, which identifies the configuration (Cases 1-5, Fig. 7; 12 possible sign sequences, table p.19). Cases 3a/3b are split by `D = I1A2² − I2A1²` (degree 10). Evaluation trees (Fig. 8, 9) evaluate low-degree quantities first: J (degree 5), K (6), J' (7), D (10), P4 (12). **Maximum degree 12** in the input data, and often 5-7 suffices (p.3-4).

## Robustness and guarantees

- Exact when the signs are evaluated exactly on exact (integer) inputs; the algebraic degree bound (≤ 12) is proven via the resultant construction.
- **Filters (§8).** Inputs assumed integers with |α|,|β| ≤ 2^22, |p|,|q| ≤ 2^24, |γ| ≤ 2^44, |s| ≤ 2^47, stored as double.
  - Static filter: per-polynomial bound M(Z) and error ε(Z) precomputed from the rules `M(Z⊥Z') = M(Z)⊥M(Z')`, `ε(Z⊥Z') = ε(Z)⊥ε(Z') ⊥ 2^-54·⌈M(Z⊥Z')⌉`. Table p.23: J: d = 5, M = 5.3e36, ε = 1.3e21; K: d = 6, M = 1.1e44; J': d = 7, M = 5.6e50; D: d = 10, M = 3.5e73; P4: d = 12, M = 1.65e88 (≈ 2^293), ε = 1.3e73.
  - Semi-static filter with the absolute-value polynomial Z̄ and relative error τ(Z) (τ ≈ 4.5e-16 for J up to 1.8e-15 for P4).
  - Dynamic filter: interval arithmetic.

## Parallelism and performance

Measured (Pentium III 500 MHz, g++ 2.95, µs per predicate, table p.26):

- Random 22-bit arcs, `l1 ≤ r2?`: polynomial method double 0.25, static+semi-static+interval+GMP **0.36**, GMP only 82, `leda_real` 20; naive method with `leda_real` 23.8.
- Degenerate inputs (same abscissa): exact GMP 115-130, filtered cascade 128-144 (filters fail 100 %), `leda_real` 1880-2240.
- Plain double gives the **wrong answer in 83-95 % of degenerate cases** (exactness 17 % and 5 %) and 1-22 % of "almost" cases.
- Static filter success: 99 % (rnd22) but 40 % / 7 % on rnd16, because the static bound assumes 22-bit data; the semi-static filter recovers 100 %.

No parallelism discussed; each predicate is an independent straight-line program with a small decision tree.

## Known failures, limitations, war stories

- The resultant route handles circle arcs only; conics need degree-4 algebraic numbers (see [Emiris et al. 2004](cgal-2d-circular-kernel-emiris-et-al-2004.md)).
- The static filter is only as good as its input bounds (rnd16 result above): over-estimated bounds make it fail nearly always.
- Integer input is assumed. With raw binary64 input the degrees still hold but magnitudes explode (INFERRED).

## Relevance for wonky

- **Exactly the predicate a sketch arrangement needs:** ordering intersection points along a circle or in x, with inputs that fit fixed-size integers.
- **Precision mapping (INFERRED).**
  - Snapped sketch coordinates as signed 32-bit integers (2^-17 mm grid within ±10 m): degree-12 values stay below 12·32 + small ≈ 400 bits, so **13 U32 limbs** cover every exact evaluation with *fixed* width. That gives uniform GPU work: no big-integer growth, no allocation.
  - With a sketch-local grid near F32x2 precision (48-bit coordinates, preferred in the [addendum](../addenda/exact-2d-arrangements-of-sketch-curves-lines-arcs-conics-wit.md)) the bound becomes ≈ 600 bits: 19 U32 limbs or about 50 of wonky's base-4096 digits (`kernel/robust-predicates.bend`).
  - Three-point arcs (FS `skArc`) have rational centers with a degree-2 denominator. Clearing denominators roughly triples the bit length unless endpoints are re-expressed as circle ∩ line points (this paper's representation).
  - The radical-axis representation matters for wonky: a vertex is (circle id, line coefficients, left/right bit). All coefficients stay at degree ≤ 2, so they fit 2-3 limbs. It is a natural record for Bend (immutable, fixed size).
  - F32x2 filter: the static bounds (up to 2^293) exceed F32's exponent range (2^127). Evaluate on normalized, locally translated inputs, or use a filter with a separate U32 exponent. On underflow, fall through to limbs.
- **Bend fit (INFERRED).**
  - Every predicate is a straight-line program plus a ≤ 4-level decision tree.
  - For uniform GPU work, evaluate all five quantities (J, K, J', D, P4) and combine the signs by table: about 5× the average arithmetic, no divergence.
  - Batched as "all pairs of vertices on one circle" or "all candidate pairs", this is an ideal map.
- **Where it plugs in:** sketch arrangement vertex ordering; arc membership tests; 2D Booleans on line/arc profiles; offset curve trimming (offset arcs stay circles).
- **Testing:** the rnd22/rnd16/degenerate/almost generators (§9) are a ready-made adversarial suite. Replicate them in wonky's BigInt oracle harness (robust-numerics P3).

## Pointers worth porting or studying

- §2, Fig. 2-3: radical-axis endpoint representation (degree-stable cutting).
- p.13-16: invariant formulas A, B, C, I, J, J', J'', K and their geometric meaning.
- p.18-21: configuration table and evaluation trees (Fig. 8 for `r1 vs l2`, Fig. 9 for `l1 vs l2`).
- p.22-23: static/semi-static error propagation rules (transferable to F32x2 with 2^-48 in place of 2^-54, plus underflow terms).
- p.24-26: benchmark generators and results.

## Verdict: **adopt** (the predicate design)

The degree-12 bound, the radical-axis representation and the Descartes decision table are the right exact core for circle-arc ordering in wonky. They map onto fixed-width U32 limbs with an F32x2 filter. Only the double-based filter constants must be re-derived for F32x2 and F32's exponent range.
