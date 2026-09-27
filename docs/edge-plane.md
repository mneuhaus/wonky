# Finite analytic edge–plane intersections

`kernel/edge-plane.bend` intersects a finite B-rep edge with a supporting plane.
It preserves the analytic curve, its native parameters, its source vertices,
`sameSense`, and any explicit `curveRange`. Source tolerances validate incidence
and enlarge uncertainty margins. They never move geometry or certify exact
coincidence. All numerical and geometric operations run in Bend.

This component builds on [curve-plane](curve-plane.md) and the domain/incidence
helpers in [face-classification](face-classification.md). It does not trim the
plane to a face, split topology, assemble a Boolean result, or complete r10b.

## API

```js
import { intersectEdgePlane, requireResolvedEdgePlane } from './src/edge-plane.mjs';

const result = await intersectEdgePlane(body, edgeIndex, {
  type: 'plane', origin: [0, 0, 5], normal: [0, 0, 1],
}, {
  linear: 1e-7,
  angular: 1e-10,
  inputTolerance: 0,
  // domains: per-edge domain overrides; otherwise use body.edges[].curveRange
});
requireResolvedEdgePlane(result);
```

The adapter uses the shared `classificationInput` serializer. Supported bodies
are ordinary analytic bodies, native `analytic.Solid` values, and existing F32
polyhedral bodies whose edges have `curve: 'line'`. For an implicit polyhedral
edge, Bend constructs `Line{start, end-start}` with the native interval `[0,1]`.
Mixed implicit/analytic curves remain an explicit capability error in the shared
serializer. Plane coordinates may be numeric arrays or native `precise.Vec3`
values. No geometry is constructed by the JavaScript adapter.

The native entry point is:

```text
intersect(solid: analytic.Solid, edge_index: U32,
          domains: List<face-classification.DomainChoice>,
          plane_origin: Vec3, plane_normal: Vec3,
          tolerance: intersections.Tolerance, source_budget: Real)
  -> EdgePlaneResult

EdgePlaneResult =
  Resolved{relation, hits, source, linear_resolution, parameter_resolution}
  Unresolved{reason}
  Rejected{reason}

EdgeSource{index, edge: analytic.Edge, domain: curve-plane.Domain,
           start: Vec3, end: Vec3, source_budget, endpoint_error, resolution}

Hit{parameter: Real, point: Vec3, multiplicity: U32, location: Location}
Location = Interior{} |
  StartVertex{index, point, gap} | EndVertex{index, point, gap} |
  SeamVertex{index, point, gap}
```

Relations retain the curve-plane meaning: `Disjoint`, `Crossing`, `Tangent`, or
`Coincident`. Tangent contact has multiplicity 2; coincidence is a continuum
with no finite hit list, not an empty intersection. Rejected and unresolved
results contain no partial hits. The capability helper throws for either.

`Hit.point` is the evaluated analytic root. A vertex location separately retains
the original represented vertex and its distance from that root. These points
may differ within the explicitly recorded source allowance. The result does not
replace either one or authorize a later topology merge. All native Real words
in the retained source edge and vertices survive serialization.

## Domains, traversal and seams

An automatic line domain comes from both source vertices projected onto the
original line in Bend, using `dot(point-origin,direction)/dot(direction,direction)`.
The direction is not normalized. Explicit line domains retain their supplied
native bounds. Endpoint validation checks the selected interval against both
source vertices; `sameSense` determines which vertex belongs to the first and
last native parameter.

A periodic edge with identical start and end vertex indices defaults to the
full curve. Partial circles and ellipses require explicit increasing closed
intervals. Endpoints alone never select a shorter arc. Interval bounds and
periodic lifting follow `curve-plane`: width strictly below `2π`, endpoint
magnitudes at most `8π`. Full curves use `Untrimmed`. An untrimmed nonperiodic edge,
an untrimmed periodic edge with distinct endpoint indices, and a finite interval
with identical endpoint indices are rejected.

Hits stay sorted by increasing native parameter, independently of traversal.
The retained `edge.same_sense` and `StartVertex`/`EndVertex` assignments describe
source traversal. A consumer that needs traversal ordering must apply that
sense; this module does not rewrite the native parameterization.

Full periodic curves keep the actual source seam vertex, even when its native
parameter is nonzero. Ordinary intersections away from it remain `Interior`.
A source seam can receive `SeamVertex` only when it agrees with `curve_point(0)`
within the arithmetic resolution, its plane incidence is exactly certified,
the analytic zero-parameter incidence is exactly certified, and the root's
parameter is within its arithmetic resolution of that seam. The root is returned
once. Contact near a noncanonical source seam remains unresolved. In particular,
the corrected P10 ellipse seams at edges 309 and 484 are retained at their
cylinder-generator positions; they are not replaced by the ellipse's zero
parameter point.

## Source incidence and endpoint policy

The shared serializer combines all `body.vertexTolerancesMm` and the optional
`inputTolerance` by their maximum in Bend. This body-wide policy is conservative,
including when another edge has the largest allowance. Every supplied allowance
must be finite, normalized, and in `[0,0.1]`. Invalid entries are not hidden by
larger valid ones. Callers using raw native solids must preserve source allowances
explicitly through `inputTolerance` or the native `source_budget` argument.

Preparation validates indices, curve/frame/radius validity, finite domains,
endpoint evaluation range, and source incidence. The stored `endpoint_error` is
the largest evaluated endpoint-to-source-vertex disagreement; for a full periodic
curve the source seam is evaluated at its recovered native parameter. Disagreement
beyond `source_budget + resolution` returns `InputGap`.

The contact policy deliberately distinguishes exact incidence from an allowance:

1. A finite endpoint sufficiently far from the plane is clear.
2. An endpoint on the plane requires both an exact analytic endpoint-incidence
   certificate and an exact original source-vertex/plane certificate.
3. An endpoint inside the combined query/source/arithmetic uncertainty band
   without those certificates makes the whole result unresolved.
4. An interior root too close to a finite source or analytic endpoint is also
   unresolved. No otherwise clear second root is returned as partial success.

The analytic certificates currently support arbitrary valid line endpoint
parameters and a round-curve endpoint exactly at parameter zero. Other round
endpoints can remain `CurveUnresolved{TrimBoundary}`. Source vertices and analytic
endpoints can both lie exactly in the plane while disagreeing within that plane;
the hit then records the source association and its nonzero gap without snapping.

`Coincident` requires the curve-plane exact polynomial certificate and exact
plane incidence of both original source vertices. A curve merely within source
tolerance of the plane is not coincident. A source vertex slightly off an exactly
coplanar analytic curve likewise keeps the edge unresolved.

## Finite separation and arithmetic limits

Before solving roots, Bend tests guarded bounds over the finite edge. A line's
signed plane distance is linear in its native parameter; endpoints wholly on
one side establish separation when their margin is clear. For a round curve,
`|c| - sqrt(a²+b²)` bounds separation of its whole analytic support and therefore
also of a trimmed arc. Source vertices must also be clearly off the plane.
These checks can establish finite `Disjoint` even when an unbounded supporting
line would intersect extremely far away and its root solver returns
`NearParallel`. Near-coincident edges inside the uncertainty band stay unresolved.

The arithmetic resolution is approximately `1e-12` times the maximum of 1,
source endpoint coordinates, curve/plane origins, radii, and native line endpoint
displacements. It must fit the requested linear tolerance. The separation and
endpoint margin includes linear tolerance, source allowance and this resolution.
The final reported linear resolution is at least both this preparation resolution
and the curve-plane construction estimate. Source allowance stays separate in
the result. These are operational guards, not certified interval error bounds.

Curve-plane limits still apply: normalized finite Real words, absolute coordinate
and native line parameter limit `1e10`, valid directions and round frames, and
explicit failures for unsupported arithmetic conditioning. The existing exact
expansion certificates fail closed outside their exponent domain.

`Rejected` distinguishes `InvalidIndex`, `InvalidGeometry`, `InvalidTolerance`,
`InvalidSourceTolerance`, `InvalidTrim`, `InvalidTopology` and nested
`CurveRejected{reason}`. `Unresolved` distinguishes `MissingTrim`,
`InputGap{gap,allowance}`, `ResolutionLimit{resolution}`, `EndpointAmbiguity` and
`CurveUnresolved{reason}`. In particular, `NearCoincidence` is never promoted to
coincidence by this layer.

## Validation and real operands

```sh
.tools/bend-2.0.25/bin/bend kernel/edge-plane.bend
node --test test/edge-plane.test.mjs
```

The 12 focused tests cover native line scaling, F32 segments, automatic and
explicit domains, reversed senses, periodic seams, partial arcs, tangent
multiplicity, source gaps, exact vertex association, withheld partial results,
finite separation, malformed input and rounded-zero impostors. Sixty-four
deterministic cases each compare a finite segment and an ellipse arc with
independent double-precision references. Real-fixture tests verify both frozen
hashes, use the current importer, apply frozen r10b's g0 transform, construct its
actual F32 clipping box, and classify selected accepted hits against their source
P10 and target box faces. Overall `npm test` is collected by the integration lead.

`out/edge-plane/diagnostic.json` records source and implementation hashes, a stable
before/after implementation check, reconstructed geometry hashes, native hit
words, independent plane residuals, target-face classifications, and every
unresolved pair. It imports the fixture afresh after the periodic ellipse-seam
correction; it does not reuse an old failed-build operand snapshot.

| Direction | Pairs | Disjoint | Crossing | Unresolved |
| --- | ---: | ---: | ---: | ---: |
| P10 edges against six box planes | 3,174 | 3,116 | 24 | 34 |
| Box edges against 163 planar P10 faces | 1,956 | 1,504 | 444 | 8 |

The 34 P10-side uncertainties comprise 17 endpoint ambiguities, 12 near-parallel
and 5 near-coincident cases. The reverse direction has 4 endpoint ambiguities and
4 near-parallel cases. Representative stored vertices differ from the intended
`y=4` junction plane by roughly `3e-11` to `6e-11` mm, without exact zero
certificates; source allowance does not erase those differences.

The 24 accepted P10-side hits classify against the trimmed box faces as 8 inside,
2 boundary and 14 outside. The reverse direction yields 2 boundary and 442 outside
hits. Maximum independent supporting-plane residuals are 0 and approximately
`1.76e-13` mm respectively. Twenty-six nonplanar P10 faces are outside this
plane-only diagnostic. These counts do not establish a closed intersection
arrangement, valid split faces, a resulting solid, or r10b completion.
