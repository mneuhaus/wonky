# Analytic supporting-surface intersections

`kernel/intersections.bend` implements intersections of unbounded supporting
planes and cylinders. Construction, normalization, predicates, and tolerance
decisions run in Bend. The JavaScript adapter only loads Bend and serializes
inputs; the result retains the original F32x2 words and `analytic.Curve` types.

This is a component for trimmed B-rep operations. It does **not** trim curves to
faces, split boundaries, classify solid cells, assemble shells, or implement
general solid Booleans. Existing Boolean and coaxial behavior is unchanged.

## Entry points and result contract

The safe Bend entry points are:

```text
intersect(first: analytic.Surface, second: analytic.Surface, tolerance: Tolerance)
plane_plane(first_origin, first_normal, second_origin, second_normal, tolerance)
plane_cylinder(plane_origin, normal, cylinder_origin, axis, radius, tolerance)
```

Directions may be non-unit; Bend normalizes them. Surface `x` directions do not
affect supporting sets and are unused. A plane/cylinder pair may be supplied
in either order.

```text
Tolerance{linear: Real, angular: Real}

Resolved{relation, curves, linear_resolution, angular_resolution}
Unresolved{reason, linear_resolution, angular_resolution}
Rejected{reason}
```

`Resolved` has one of these relations:

| Relation | Curves | Meaning |
| --- | --- | --- |
| `CrossingPlanes` | One line | Two nonparallel planes |
| `CoincidentPlanes` | None | The planes share their whole supporting set |
| `ParallelPlanes` | None | Distinct, separated parallel planes |
| `CircleSection` | One circle | Plane normal parallel to cylinder axis |
| `EllipseSection` | One ellipse | Oblique plane with a resolved, nonzero axial component |
| `TwoGenerators` | Two lines | Plane parallel to the axis cuts the cylinder |
| `TangentGenerator` | One line | Certified tangent plane parallel to the axis |
| `EmptySection` | None | Plane parallel to the axis lies outside the cylinder |

`CoincidentPlanes` is not an empty intersection. `TangentGenerator` represents
one geometric line with double contact; it does not provide a transverse
crossing for a later solid classifier. Line directions and curve senses are
parameterizations, not face orientations. There are no trim intervals.

The adapter supports numeric surface records or existing Bend surface values:

```js
import { intersectSurfaces, requireResolvedIntersection } from './src/intersections.mjs';

const result = await intersectSurfaces(
  { type: 'plane', origin: [0, 0, 2], normal: [1, 0, 1] },
  { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 3 },
  { linear: 1e-7, angular: 1e-10 },
);
requireResolvedIntersection(result); // Throws a capability error otherwise.
```

`loadIntersections()` returns the Bend module for synchronous calls after
loading. `intersectionSurface()` and `intersectionTolerance()` serialize inputs.
`requireResolvedIntersection()` preserves the result and raises
`UnsupportedFeatureError` for unresolved or rejected results. Callers must
inspect the relation even after this check.

## Tolerance and arithmetic domain

Linear tolerance uses the same units as the surfaces, conventionally mm. Angular
tolerance is a dimensionless sine/cosine threshold. Defaults are `1e-7` and
`1e-10`. Tolerances are not licenses to move geometry or collapse intersections:
nonzero separations, angles, and tangent gaps inside the corresponding ambiguity
band produce `Unresolved`.

Input Real words must be finite and normalized. Absolute input coordinates,
direction components, and radii must be at most `1e10`. A direction must have a
component of magnitude at least approximately `1e-12`. Radius must be positive
and larger than the requested linear tolerance. Angular tolerance must be
positive and at most approximately `0.1`; a request below the approximately
`1e-12` angular guard is unresolved.

The base linear guard is approximately
`1e-13 * max(1, absolute input coordinates, radius)`. Curve construction amplifies
it by the relevant conditioning: inverse plane crossing sine; inverse axial
cosine or major-axis projection sine for ellipses; and `radius / half-separation`
for generator pairs. Output origin coordinates and ellipse semiaxes must also
fit `1e10`. Curves are withheld when the amplified guard exceeds the requested
linear tolerance.

These linear and angular guards are conservative operational checks tested
against independent references. They are **not certified interval error bounds**
for all nonzero calculations. F32x2 construction remains finite precision.
The guards deliberately reject some geometrically valid, poorly conditioned
inputs. Resolving those cases requires stronger arithmetic or a separately
specified local-coordinate strategy.

`Unresolved` reasons distinguish requested budget limits (`LinearBudget`,
`AngularBudget`, `RadiusBelowTolerance`) from near degeneracies
(`NearParallelPlanes`, `NearCoincidentPlanes`, `NearAxisParallelPlane`,
`NearCircleSection`, `NearTangency`). `Rejected` distinguishes invalid tolerance,
geometry, direction, radius, generated output range, and unsupported surface
pairs. Input magnitude or malformed-word failures use `InvalidGeometry`.
Cylinder/cylinder and cone pairs return `UnsupportedSurfacePair`.

## Zero certificates

Checking a rounded F32x2 determinant for equality with zero is insufficient.
For example, with `e = 2^-40`, the determinant of `[1, 1+e, 0]` and
`[1+e, 1+2e, 0]` is `-e^2`, although ordinary F32x2 multiplication and subtraction
round it to zero. The module requires a floating-expansion zero certificate
before accepting parallel, perpendicular, coincident, or tangent branches.

The expansions use error-free F32 sums and guarded Dekker products. A nonzero
word product is admitted when both words are normal F32 values with biased
exponents from 1 through 240, and their exponent sum is from 151 through 350.
This keeps splitter operations and the complete product bits within the F32
range, with headroom for polynomial sums. Unsafe products mark the whole
expansion unavailable. No zero classification may use an unavailable expansion.
This can leave an exact degeneracy unresolved, particularly when it contains
extremely small low words or very large polynomial terms.

Reusable Bend helpers are:

| Helper | What a `True` result certifies |
| --- | --- |
| `parallel_certificate(candidate, a, b)` | Exact zero cross product of represented vectors |
| `perpendicular_certificate(candidate, a, b)` | Exact zero dot product |
| `coincidence_certificate(candidate, n, a, b)` | Exact zero `n · (a - b)` |
| `tangency_certificate(candidate, n, p, c, r)` | Exact zero `(n · (p-c))² - r²(n · n)` |

`candidate` should be the corresponding computed-zero predicate. A false
certificate means either a nonzero polynomial **or an unavailable certificate**;
it must not be interpreted as proof of nonzero. The certificate's mathematical
meaning concerns the represented input words, not an intended exact source
geometry before serialization. Tangency also needs the separately certified
axis-perpendicular condition and valid positive radius.

For other polynomial certificates, `expansion_real`, `exact_product`,
`exact_dot`, `exact_dot_delta`, `expansion_add`, `expansion_neg`, and
`expansion_mul` return `Expansion{safe, words}`. Only
`expansion_zero(expansion)` is a zero certificate; it returns false when `safe`
is false. Inputs must be finite normalized Real values. These helpers do not
provide certified nonzero signs or root intervals.

## Evidence

Validation commands:

```sh
.tools/bend-2.0.25/bin/bend kernel/intersections.bend
node --test test/intersections.test.mjs
```

The focused suite covers every relation, rotated and translated frames, reversal
of normals and axes, swapping operand order, near parallelism/coincidence/circle
sections/tangency, requested tolerance failures, input/output range failures,
invalid words, and unsupported pairs. Eighty deterministic random oblique
sections and crossing-plane cases use independent double-precision analytic
references. Returned curves are sampled through Bend and checked against both
supporting surfaces with independent residual formulas. Exact zero certificates
are checked with a separate BigInt oracle that retains all bits of the F32
words, including regressions where F32x2 arithmetic alone rounds a nonzero
polynomial to zero. Product underflow and overflow limitations fail closed.

No external geometry engine constructs these results. No frozen fixture or
STEP export is changed by this module.
