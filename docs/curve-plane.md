# Analytic curve–plane intersections

`kernel/curve-plane.bend` intersects lines, circles and ellipses with supporting
planes, optionally restricted to a closed parameter interval. It constructs up
to two analytic parameter/point pairs. Geometry, input checks, zero certificates,
root solving, ordering and trimming all run in Bend. `src/curve-plane.mjs` only
loads Bend and serializes records and options.

This component does not classify a trimmed face, split an edge, construct a
Boolean result or complete the r10b model. No analytic curve becomes a polygon.

## API and results

```text
intersect(curve: analytic.Curve, plane_origin: precise.Vec3,
          plane_normal: precise.Vec3, domain: Domain,
          tolerance: intersections.Tolerance) -> CurvePlaneResult

Domain = Untrimmed{} | Interval{first: Real, last: Real}

CurvePlaneResult =
  Resolved{relation, hits, linear_resolution, parameter_resolution}
  Unresolved{reason, linear_resolution, parameter_resolution}
  Rejected{reason}

Hit{parameter: Real, point: Vec3, multiplicity: U32, position: Position}
Position = Interior{} | FirstEndpoint{} | LastEndpoint{}
```

| Resolved relation | Hits | Meaning |
| --- | --- | --- |
| `Disjoint` | None | No intersection in the requested domain |
| `Crossing` | One or two, multiplicity 1 | Transverse intersections retained by the domain |
| `Tangent` | One, multiplicity 2 | Certified double contact retained by the domain |
| `Coincident` | None | Every point of the curve domain lies in the plane |

`Coincident` is not an empty intersection. A tangent is not a parity crossing.
Hits are ordered by their returned parameters. Unresolved and rejected results
contain no partial hit list.

```js
import { intersectCurvePlane, requireResolvedCurvePlane } from './src/curve-plane.mjs';

const result = await intersectCurvePlane(
  { type: 'circle', origin: [0, 0, 0], normal: [0, 0, 1], x: [1, 0, 0], radius: 2 },
  { type: 'plane', origin: [1, 0, 0], normal: [1, 0, 0] },
  { interval: [-2, 2], linear: 1e-7, angular: 1e-10 },
);
requireResolvedCurvePlane(result);
// Two crossings, with native parameters approximately -π/3 and π/3.
```

`requireResolvedCurvePlane` returns a resolved result unchanged and raises
`UnsupportedFeatureError` otherwise. Callers still inspect its relation.
`loadCurvePlane()` provides the synchronous Bend module after loading.
`curvePlaneCurve()` accepts numeric curve records or existing Bend curve values;
`curvePlaneDomain()` accepts an omitted/null interval, `[first, last]`, or a Bend
domain value. The result preserves the F32x2 words. Nonfinite host numbers fail
serialization before entering Bend.

## Native parameters, frames and intervals

A line retains `point(t) = origin + t * direction`. Its direction is not
normalized, so its parameter need not measure distance. Reversing or scaling the
direction changes the parameter as prescribed by this formula.

Round curves retain their supplied origin, normal, x-axis and radii:

```text
y = normal cross x
circle(t)  = origin + radius * (x*cos(t) + y*sin(t))
ellipse(t) = origin + major*x*cos(t) + minor*y*sin(t)
```

The normal and x-axis must already be unit and perpendicular within an
operational dot-product budget of approximately `1e-11`. They are not silently
normalized or refitted. Both ellipse semiaxes must be positive; their names do
not require `major >= minor`. Plane normals may be non-unit and are normalized
inside Bend for numerical construction.

Untrimmed round curves return radians in `[0, 2π)`, including a seam root once.
An explicit interval is increasing and closed. For a periodic curve its width
must be strictly smaller than `2π`, and both endpoint magnitudes must be at most
`8π`. For example `[-1, 1]` and `[5, 8]` describe arcs crossing the conventional
zero-angle seam. Returned parameters are lifted into the interval's unwrapped
coordinate range. Full circles and ellipses use `Untrimmed`, not `[0, 2π]`.
Line intervals have no periodic restriction.

The root solver uses its estimated parameter resolution to detect uncertain
interval membership. A candidate close to an endpoint is retained at that
endpoint only with an exact incidence certificate; otherwise the whole result
is `Unresolved{TrimBoundary}`. Exact line endpoints are supported at arbitrary
valid parameters. For circles and ellipses the current endpoint certificate
supports only a parameter exactly equal to zero. A nonzero-angle endpoint can
therefore remain unresolved even when its intended source geometry places an
intersection there. It is never silently removed or snapped.

Reusable Bend utilities are `curve_valid`, `curve_periodic`, `domain_valid`,
`coefficients` and `classify_parameter`. `coefficients` requires valid curve and
plane input. It returns `Coefficients{a,b,c}` for signed plane distance:
`b*t+c` for a line, or `a*cos(t)+b*sin(t)+c` for a round curve. The public parameter
classifier has this contract:

```text
classify_parameter(parameter, domain, periodic, resolution) ->
  Inside{parameter} | Outside{} | AtFirst{parameter} | AtLast{parameter} |
  NearFirst{parameter} | NearLast{parameter} | InvalidDomain{}
```

`AtFirst` and `AtLast` report represented parameter equality, not certified
geometric incidence. Near-boundary variants retain the lifted candidate value.
The resolution must be finite, normalized and nonnegative; periodic raw
parameters also require magnitude at most `8π` so angle reduction stays in its
documented range. Invalid raw parameters or resolutions use `InvalidDomain`.

## Certificates and numerical limits

The expansion primitives from [supporting-surface intersections](intersections.md)
operate on original, unnormalized inputs. They certify exact polynomial zeros
for parallelism, coincidence, tangency and supported endpoint incidence. Round
coefficients include an expanded triple product for `n·(normal cross x)`.
Tangency requires an exact zero of `a²+b²-c²`; a rounded zero is insufficient.
Line endpoints require an exact zero of `b*t+c`; the zero-angle round endpoint
requires `a+c=0`. All these statements concern the represented input words.

Expansion exponent restrictions fail closed. An unavailable certificate can
leave an exact degeneracy unresolved. A false certificate means nonzero **or**
unavailable, never certified nonzero. Other numerical decisions use the
operational guards below, not certified interval arithmetic.

Inputs must contain finite normalized Real words. Coordinates, direction
components, radii, line parameters and generated point coordinates have absolute
limit `1e10`. Each direction needs a component of magnitude at least approximately
`1e-12`. A round curve's smaller radius must exceed the requested linear
tolerance. Default linear/angular tolerances are `1e-7`/`1e-10`; angular tolerance
must be positive, at most approximately `0.1`, and no smaller than the
approximately `1e-12` operational angular guard.

The base linear guard is approximately `1e-13 * max(1, input coordinates, radii)`.
For a line, root conditioning also includes generated coordinates, displacement
and the inverse absolute signed-distance derivative `|b|`. For a transverse round
curve it uses `sqrt(a²+b²-c²)` as the root derivative. A root's parameter
resolution is converted to a positional estimate with line speed or the larger
semiaxis. Results exceeding the requested linear budget remain unresolved.
The reported resolutions are operational estimates, not proven upper bounds.

`Unresolved` reasons distinguish `AngularBudget`, `LinearBudget`,
`RadiusBelowTolerance`, `NearParallel`, `NearCoincidence`, `NearTangency` and
`TrimBoundary`. Nonzero gaps inside ambiguity bands do not become tangencies or
coincidences. `Rejected` reasons distinguish `InvalidTolerance`,
`InvalidGeometry`, `InvalidDirection`, `InvalidFrame`, `InvalidRadius`,
`InvalidInterval` and generated `OutputRange` failures.

## Validation

```sh
.tools/bend-2.0.25/bin/bend kernel/curve-plane.bend
node --test test/curve-plane.test.mjs
npm test
```

The focused suite checks every relation, native parameter scaling, translated
and rotated frames, reversal, intervals across periodic seams, certified
endpoints, unresolved degeneracies and invalid inputs. Sixty-four deterministic
random round-curve and line cases use independent double-precision analytic
references and independent point/plane residuals. Separate BigInt polynomial
oracles retain every bit of the represented F32 words and cover rounded-zero
parallel, coincident, tangent and endpoint impostors, as well as certificate
exponent limits. No geometry export or frozen input changes in this component.
