# Filtered exact and indirect predicates in Bend

`kernel/robust-predicates.bend` implements two native geometric decisions:

- `point_plane(normal, point, origin)`: the exact sign of
  `normal · (point - origin)` for the represented input words;
- `classify(LinePlane{a,b,cut_origin,cut_normal}, origin, normal)`: the sign of a
  second plane at an implicit line/plane intersection, without rounding the
  intermediate intersection coordinates.

This is an implemented numerical component, not a full Boolean or an exact
curved-surface solver. A positive or zero polynomial value does not decide a
modeling contact tolerance, and does not prove a subsequently rounded output
vertex satisfies all its incidences. Callers must still validate geometric
inputs, choose a contact policy and validate constructions.

## Research basis and deliberate differences

[Shewchuk (1997), Adaptive Precision Floating-Point Arithmetic and Fast Robust
Geometric Predicates](https://www.cs.cmu.edu/~quake/robust.html) motivates doing
inexpensive filtered work before exact fallback.
[Attene (2020), Indirect Predicates for Geometric Constructions](https://arxiv.org/html/2105.09772v2)
explains why exact predicates on already-rounded intermediate points cannot
recover the original construction. Sections 2 and 4 describe filtered/exact
evaluation and implicit linear constructions. Section 4.2 uses a plane defined
by three points; our specialization takes the existing normal/origin plane
representation, interpreted exactly as its stored F32x2 words.

The Bend code is independently written from these mathematical principles.
It does not copy the authors' C/C++ implementation, and is not their full
predicate suite. Instead of expansion arithmetic it uses a signed dyadic
integer fallback. There are currently no orient3d/incircle/insphere APIs,
general construction DAG, cached symbolic expressions or curved implicit roots.

## Arithmetic contract

Every finite F32 word is an integer multiple of `2^-149`. The exact path decodes
the sign, mantissa and exponent of **both** F32x2 words and operates on signed
base-4096 integers. Lists have no fixed precision cutoff. Integer digit products
plus carry stay below `2^24`; digit sums and differences stay below `8192`.
The path covers subnormal words and the complete finite F32 exponent range.
NaN and infinity produce `Undefined` with method `Invalid`.

The fast path expands the dot difference into 24 F32 products. It only admits
zero or words with encoded exponents 87 through 167. Thus all nonzero product
and accumulated F32 values remain within the normal finite range. With
round-to-nearest F32 operations, `2^-16` times the rounded sum of absolute
products conservatively exceeds the error bound for 24 products and 23 additions
including the bound's own rounding. A strict exclusion of zero returns
`FloatFilter`; every other case evaluates the source words exactly and returns
`ExactDyadic`. This assumes IEEE F32 arithmetic; current verification uses the
pinned Bend JavaScript target, not an untested GPU compilation configuration.

For the implicit construction let `alpha=cut(a)`, `beta=cut(b)`,
`gamma=test(a)`, `delta=test(b)`. The result is the sign of
`(alpha*delta - beta*gamma) / (alpha - beta)`. The whole polynomial expression
uses integer arithmetic (`IndirectExact`). Zero denominator means no unique
line/plane intersection and returns `Undefined`. The line is unbounded; segment
membership is a separate decision. The method currently has no floating filter.

## Validation

Run `node --test test/robust-predicates.test.mjs`. An independent JavaScript
BigInt oracle decodes the same input words and evaluates the corresponding
polynomial/rational expressions. Cases cover cancellation below F32x2 retained
precision, subnormals, extreme finite exponents, randomized raw words, exact
incidence of an implicit `x=1/3` point, endpoint reversal, undefined intersections
and nonfinite inputs. BigInt is test-only; all implementation arithmetic is Bend.

The module is integrated into selected production contact decisions in
`kernel/ports/hybrid.bend` and `kernel/ports/curved-contact-events.bend`.
Source tolerance and contact policy remain separate from exact represented
signs. The additional exact-support certificate under
`out/planar-curved-union/staging/contact-support.bend` remains staging; see the
current integration boundary.
Neither component establishes a general curved Boolean or full r10b acceptance.
