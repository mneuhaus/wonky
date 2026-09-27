# Analytic planar-face classification

`kernel/face-classification.bend` classifies a point against one trimmed planar
face as `Inside`, `Outside`, `Boundary`, or `Unresolved`. It uses the face's
actual line, circle, and ellipse curves, including explicit partial arcs and
holes. Geometry, parameter selection, projections, distance bounds, and ray
decisions run in Bend. Curves are never replaced with polygonal approximations.

This is a component for trimming the first P10/box Boolean. It does not construct
intersection edges, split faces, classify a solid, stitch a shell, or complete
that Boolean. Cylindrical and conical faces return `NonPlanarFace`.

## API

```js
import {
  classifyPlanarFace,
  requireResolvedFaceClassification,
} from '../src/face-classification.mjs';

const result = await classifyPlanarFace(body, faceIndex, point, {
  linear: 1e-7,       // model units; imported bodies use millimetres
  angular: 1e-10,    // angular/conditioning tolerance
  inputTolerance: 0, // additional source-incidence allowance
  // domains: per-edge overrides; null means automatic
});
requireResolvedFaceClassification(result); // raises on Unresolved
```

The body may be an ordinary analytic body, a native `analytic.Solid`, or an
existing polyhedral body whose edges have `curve: 'line'`. For the last form,
Bend constructs native line curves from the represented endpoint coordinates.
The adapter supplies the single-loop outer role used by existing polyhedral
faces. Multiple implicit loops require explicit `face.outer` metadata; mixed
implicit/analytic edges are an explicit capability error.

The point may be an array or a native `precise.Vec3`. Native words are retained.
The returned Bend ADTs are:

| Result | Meaning |
| --- | --- |
| `Inside { rays }` | Projected point lies in the outer region and outside every hole; at least two rays agree. |
| `Outside { rays }` | Point is outside the trimmed region; at least two rays agree. `rays: 0` instead denotes a point clearly off the supporting plane. |
| `Boundary { edge, parameter }` | An evaluated point of the projected, trimmed analytic edge is within the guarded query tolerance. The parameter belongs to that curve's native parameterization. |
| `Unresolved { reason }` | Input is invalid, unsupported, insufficiently resolved, or geometrically ambiguous under the budgets. |

The native entry point is
`classify(solid, face_index, domains, point, tolerance, source_budget)`.
`domains` is a Bend list of `AutoDomain {}` or
`GivenDomain { domain: curve-plane.Domain }` values indexed by edge.

## Trims and topology

The JavaScript adapter uses `options.domains` when supplied; otherwise it uses
each analytic edge's `curveRange`. An array `[first, last]` is an increasing,
closed native parameter interval. A native `Domain` or `DomainChoice` is also
accepted. See [curve-plane.md](curve-plane.md) for domain bounds and the native
line and round-curve parameter conventions.

Automatic line ranges are derived in Bend from both endpoints without
normalizing the native direction. A periodic edge whose start and end indices
are identical defaults to the full curve. Partial circles and ellipses require
explicit ranges; a missing range produces `MissingTrim`. Endpoint positions
alone do not select the shorter arc. Native first/last incidence respects
`edge.sameSense`; loop closure respects coedge direction. Face sense, normal
reversal, loop order, and loop winding do not change region membership.

The classifier checks referenced indices, finite supported geometry, curve
frames, ranges, endpoint incidence, supporting-plane deviation, nonempty closed
ordered loops, and exactly one outer loop. These checks **do not prove a valid
face arrangement**: simple nonintersecting loops, holes inside the outer loop,
and disjoint holes remain caller preconditions. There is no global arrangement
validator in this module.

## Tolerances and conservative decisions

The default query budget is `linear = 1e-7`, `angular = 1e-10`. Arithmetic uses
the existing F32x2 `Real`. A scale-dependent operational resolution is
`1e-12 * max(1, input coordinate/curve-origin/radius scale)`. The query budget
must exceed it. This guard is not a certified interval-arithmetic proof.

A point clearly farther from the face plane than the linear budget is outside.
A point clearly within it is projected onto that plane. The tolerance threshold
itself has an unresolved band (`NearFacePlane`). Edge candidates are also
evaluated through face-plane projection without changing stored geometry.
Consequently this is a face-membership tolerance policy, not a three-dimensional
Euclidean distance-to-face computation.

`inputTolerance` is combined in Bend with all `body.vertexTolerancesMm` using
the maximum. Every supplied source budget must be finite, normalized, and in
`[0, 0.1]`; a negative entry is not hidden by a larger valid entry. For a raw
native solid, callers must preserve source allowances through `inputTolerance`
when no metadata is attached. The maximum over the body is deliberately
conservative, including when another face has the largest allowance.

Source allowance plus arithmetic resolution bounds endpoint and curve/plane
incidence. Excess disagreement returns `InputGap`. Source allowance is also
subtracted from boundary lower-distance bounds and included in ray-origin and
finite-vertex avoidance margins. It therefore cannot merely authorize a gap
and then disappear from the classification.

For a line segment, the native closest parameter is clamped to its trim.
For a round curve, the nearest point on the corresponding unit-circle arc
provides a lower distance bound through the minimum axis radius. Its actual
curve point provides an upper bound. Interval endpoints are also candidates.
Periodic lifting uses F32x2 comparisons, including near shifted seams. An upper
bound clearly below the query budget establishes `Boundary`; a lower bound
clearly beyond the combined query/source budget establishes clearance. A gap
between those bounds returns `NearBoundary`. This can conservatively leave
some ellipse-near-boundary queries unresolved.

After boundary clearance, five deterministic in-plane rays use directions
`u`, `u + 0.375 v`, `u + 0.8125 v`, `u + 1.3125 v`, and `v`. Every actual
ray/edge crossing comes from `curve-plane.intersect` against the ray's cutting
plane. Only resolved, interior, multiplicity-one hits clearly ahead or behind
the query contribute. Coincidence, tangency, trim endpoints, near-origin hits,
uncertain curve/plane results, and rays near finite trim vertices discard that
ray. No forced endpoint or tangent parity is used. At least two rays must
resolve; all resolved rays must agree. Otherwise the result is
`AmbiguousRays` or `ConflictingRays`.

Other explicit reasons are `InvalidInput`, `InvalidIndex`, `InvalidTopology`,
`InvalidTrim`, `MissingTrim`, `NonPlanarFace`, and `ResolutionLimit`. The
adapter's capability helper raises `UnsupportedFeatureError` for every
unresolved result; callers must not treat it as an empty region or success.

## Validation and current limits

`test/face-classification.test.mjs` covers concave line loops, holes, circles,
ellipses, minor and major arcs, angular seams, reversed senses and uses,
translations/rotations, tolerance thresholds, source gaps, malformed inputs,
ambiguous rays, native hit-word preservation, and existing F32 boxes.

The frozen P10 regression checks SHA-256
`b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9` for
`fixtures/r10b/modules/base/ZtoDD.body.json`. Its source has 316 vertices,
513 edges, and 189 faces; the existing seam-aware import has 348 vertices,
529 edges, and 189 faces. Tests cover a tilted rectangle, hole centers, an outer
circle, and direct line/partial-circle/full-circle intersection hits on actual
face boundaries.

The same fixture is also placed with the rigid transform from frozen r10b
line 215 and tested against the actual first clipping box, from
`[-119, 4, -61]` to `[-92.79, 46, 68]` mm. Its represented upper x coordinate is
`-92.79000091552734`. Real edge/box-plane crossings classify on the P10 boundary
and inside or on the boundary of the corresponding box face. A point on the
shared plane-intersection line classifies inside both faces. These are bounded
face-classification integration checks, not a Boolean result or a proof that
every P10 face is supported.

The remaining scope includes nonplanar-face membership, validation of complete
trim arrangements, face splitting and shell construction, and more resolving
methods for cases that the current conservative ellipse bounds or five rays
leave unresolved.
