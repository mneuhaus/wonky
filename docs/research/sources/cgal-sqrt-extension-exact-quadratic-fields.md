# CGAL Sqrt_extension: exact arithmetic in a quadratic extension Q(√r)

- Kind: library documentation (number type). Canonical: [CGAL::Sqrt_extension reference](https://doc.cgal.org/latest/Number_types/classCGAL_1_1Sqrt__extension.html) (read via fetch, 2026-09-24). Part of the CGAL Number_types package.
- Organization: CGAL project (GeometryFactory and academic partners). License: CGAL packages are LGPL-3.0-or-later or GPL-3.0-or-later depending on package, plus commercial (INFERRED from CGAL's dual licensing; not re-checked for this header). Reimplement, do not copy.
- Activity: CGAL main repo 6,055 stars, last push 2026-09-21 (`gh api`, see the [CGAL rational rotation note](cgal-rational-rotation-approximation.md)).

## What it is

A number type for expressions `a0 + a1·√root` with `a0, a1` in a base ring NT (DOCUMENTED: "a0 + a1 √(root)", NT an `IntegralDomainWithoutDivision`). Used in CGAL for circular arcs and other degree-2 constructions. For wonky it is the model for **exact cosines and sines of special pattern angles**: `cos 45° = √2/2`, `cos 30° = √3/2`, `cos 15° = (√6 + √2)/4`, `cos 36° = (1 + √5)/4`.

## How it works (DOCUMENTED)

- Elements of `Z[√a]` (or over a field NT, `Q(√a)`); ring operations are componentwise polynomial arithmetic with `√a² = a`.
- Sign: "Determines the sign of ext by (repeated) squaring": for `a0 + a1√r` with opposite-sign parts compare `a0²` with `a1²·r`, exactly.
- Restriction: "Arithmetic operations among different extensions, say ℤ[√a] and ℤ[√b], are not supported. The user is responsible to check that arithmetic operations are carried out for elements from the same extensions only"; violations are undefined behavior. A root that is a perfect square is not simplified ("an extension by a square root of a square is considered as an extension").
- Optional interval filtering on doubles (`FilterPredicates`).

## Robustness and guarantees

- DOCUMENTED: exact sign by squaring (no rounding) when the base type is exact.
- INFERRED: nesting two extensions (`Q(√2)(√3)`) covers `cos(2πk/24)` for all k; degree 4 over Q; a sign decision needs two rounds of squaring, so bit growth is about 4× the coefficient size.

## Parallelism and performance

Not measured. INFERRED: fixed-size coefficient pairs; branchy sign logic but bounded (at most two squarings per level).

## Known failures, limitations, war stories

- DOCUMENTED: mixing roots is UB, a sharp edge that a Bend port must turn into an explicit refusal.
- INFERRED: generic N-fold patterns need `Q(cos 2π/N)` of degree φ(N)/2 (N = 7: degree 3, cubic irrationals), which quadratic extensions do not cover. A rotation needs cos **and** sin. The practical exact set is N ∈ {1, 2, 3, 4, 6, 8, 12, 24}, all in `Q(√2, √3)` (for example `sin 15° = (√6 − √2)/4`). N ∈ {5, 10} need a degree-4 tower, because `cos 72° = (√5 − 1)/4` lies in `Q(√5)` but `sin 72° = √(10 + 2√5)/4` does not.

## Relevance for wonky

- **Circular patterns as exact group elements (INFERRED design):** a pattern instance is `(axis, k, N)`. For decisions between instances (is instance i's face coplanar with instance j's face? do they touch?), wonky can either (a) reason purely symbolically (`k ≡ k' mod N` means the same placement; a plane containing the axis maps to a plane containing the axis), or (b) evaluate exact predicates on rotated carriers in `Q(√2, √3)` with multi-limb U32 coefficients for N | 24. Everything else is rounded with a stated bound.
- **Bend fit:** a pair (or quadruple) of multi-limb integers per coordinate; sign by squaring is a fixed small arithmetic circuit: uniform, fork-join friendly. Mixing fields becomes a typed refusal.
- **Where:** Boolean contact classification between pattern instances (gears, bolt circles, vents), exact coaxiality/coplanarity checks after a pattern, and test oracles for the rounded path.

## Pointers worth porting or studying

- The class reference (sign by squaring; same-extension rule). The CGAL `Sqrt_extension` sources were not read.

## Verdict: learn-from

Use as the conceptual template for an optional exact `Q(√2, √3)` evaluator for N | 24 patterns; the primary mechanism for patterns should be symbolic group elements, with this as the exact fallback for predicates that need coordinates.
