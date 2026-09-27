# Trimmed planar/cylindrical face–plane intersections

`kernel/face-plane.bend` intersects one bounded, trimmed planar or cylindrical
face with an unbounded plane. It returns finite intervals on native line,
circle or ellipse supports, including disconnected pieces, holes and periodic
wraps. All geometric decisions, source attribution, ordering and membership
tests run in Bend. The JavaScript adapter only serializes inputs.

This component uses [supporting intersections](intersections.md),
[finite edge intersections](edge-plane.md), [planar membership](face-classification.md)
and [cylindrical membership](cylinder-classification.md). It does not trim against
a second face, split edges, assemble face loops or produce a Boolean solid.

`kernel/face-bounds.bend` first tests conservative directional bounds of the
prepared finite face. A distant bounded face can be excluded even when its
infinite supporting surface is nearly parallel to the cutting plane. All input,
frame, trim, incidence and budget preparation still happens before this filter;
an invalid face cannot hide behind an empty result.

## API

```js
import { intersectFacePlane, requireResolvedFacePlane } from './src/face-plane.mjs';

const result = await intersectFacePlane(body, faceIndex, {
  type: 'plane', origin: [0, 0, 5], normal: [0, 0, 1],
}, {
  linear: 1e-7,
  angular: 1e-10,
  inputTolerance: 0,
  // domains: per-edge overrides; otherwise use body.edges[].curveRange
});
requireResolvedFacePlane(result);
```

The shared `classificationInput` serializer accepts analytic bodies, raw native
`analytic.Solid` values and existing F32 polyhedral bodies with implicit line
edges. Cutting-plane vectors can be numeric arrays or native `precise.Vec3`
values. Source budgets are combined in Bend from the maximum of the body's
vertex allowances and `inputTolerance`. Native callers must preserve those
allowances explicitly, together with any partial-arc domains.

```text
intersect(solid: analytic.Solid, face_index: U32,
          domains: List<face-classification.DomainChoice>,
          plane_origin: Vec3, plane_normal: Vec3,
          tolerance: intersections.Tolerance, source_budget: Real)
  -> FacePlaneResult

FacePlaneResult =
  Resolved{relation, sections, events, supports, source, linear_resolution}
  NonTransverse{reason, supports, source}
  Unresolved{reason}
  Rejected{reason}

Relation = Empty{} | Transverse{}
FaceSource{index, face, plane_origin, plane_normal, source_budget}
Section{support_index, curve, domain, first, last}

Endpoint =
  Boundary{event, parameter, point}
  PeriodicSeam{parameter, point}

BoundaryEvent{edge, forward, source: edge-plane.EdgeSource,
              hit: edge-plane.EdgeHit, support_index,
              parameter, point, gap, parameter_resolution}
```

`Resolved Empty` is a valid finite result. It may retain supporting curves and
boundary events that delimit outside intervals. `Transverse` means at least one
section was retained. Nonresolved results never publish partial sections or
partial boundary events; the capability helper throws for all of them.

## Source attribution and parameter order

Every finite endpoint retains its original face coedge index and direction,
complete edge source record, native edge-hit parameter and exact native
`hit.point`. The source record includes the original vertices, curve, sense,
domain and allowance. No source vertex is moved or merged by distance.

The event's own `parameter` and `point` belong to the constructed supporting
section curve. Bend recovers the parameter from the original hit, evaluates
that curve and records `gap` between those two represented points. Association
is accepted only within the explicit combined source, query and arithmetic
budget. Zero matching supports is `SupportMismatch`; more than one is
`AmbiguousSupport`. An accepted nonzero gap is retained, never snapped away.

Sections are ordered first by supporting-curve index and then by increasing
native support parameter, independently of face sense or coedge traversal.
`events` retains boundary traversal order; it is not the sorted section list.
The support line's direction is preserved, so reversing a supporting face
normal can reverse the spatial order of otherwise identical section endpoints.

A partial periodic section uses `Interval{first,last}` with increasing bounds.
A wrap through zero lifts the last parameter by `2π`; for example, an arc from
`-0.6` to `0.8` may be `[2π-0.6,2π+0.8]`. Its last endpoint is evaluated at the
lifted parameter. `last.event.parameter` remains canonical, and the original
`last.event.hit.parameter` remains the edge's native parameter. The separately
recorded canonical event point and lifted endpoint point can differ by arithmetic
roundoff. Neither replaces the retained edge hit.

A full circle or ellipse has `Untrimmed` domain and two identical
`PeriodicSeam{parameter:0, point:curve_point(curve,0)}` endpoints. This native seam
is a construction point on the section, not a source-vertex attribution.

## Trimming and contacts

Preparation checks supported geometry, finite budgets, valid edge domains,
source incidence, index-based loop closure and physical boundaries. Planar
faces require exactly one outer loop; hole order and winding are unrestricted.
Cylinder preparation removes only validated opposite uses of an internal seam.
Its membership rules support noncontractible boundary loops without requiring
an outer flag. Partial round edges require explicit domains; no endpoint-based
shortest-arc inference is performed.

Bend constructs the supporting intersection and intersects every physical
boundary edge with the cutting plane. Resolved multiplicity-one interior hits
and certified full-round seam hits become events. Finite source-vertex hits,
tangencies and coincident boundaries remain explicit contacts. Unresolved or
rejected edges take precedence over contacts, so a contact cannot conceal a
different edge's uncertainty.

Each support's events are sorted without merging. Adjacent intervals must have
clear parameter separation, and their midpoint samples use the corresponding
trimmed-face classifier. Transverse crossings must alternate inside/outside.
Lines require an even event count, with the first and last finite intervals
inside. Periodic supports additionally check the wrapped last-to-first span.
With no events, a periodic support is classified at parameter zero and retained
whole or discarded; a line is empty under the bounded-face precondition.

The input must already describe a valid bounded face arrangement: simple
physical boundaries, properly placed disjoint holes and no overlapping or
self-intersecting trims. Preparation validates incidence and closure; it does
not prove the entire arrangement's embedding or hole nesting. The midpoint and
alternation checks detect some inconsistencies but are not an arrangement
validator. Outer and hole trims are interpreted by the existing classifiers.

For a plane, a linear signed-distance function reaches its extrema on the
boundary. Finite lines contribute their evaluated interval endpoints; circles
and ellipses contribute an overestimate of their entire supporting curve using
the sum of absolute sinusoidal coefficients. Source vertices alone would miss
curved extrema. For a cylinder, boundary curves enclose its axial height range;
the full angular range is included separately, so interior radial extrema are
also enclosed. Holes and partial arcs can make these bounds loose, which only
forgoes the early exclusion. Source allowance, query tolerance and sixteen times
the scale-dependent arithmetic guard enlarge the exclusion margin. Near
contacts continue through the original intersection path. These operational
bounds are not certified interval-arithmetic proofs. An early excluded result
has empty sections, events and supports; it does not claim parallel supporting
surfaces or provide an exact tight bound.

`NonTransverse` reasons distinguish `Coplanar`, `TangentSupport`,
`BoundaryCoincidence{edge}`, `BoundaryTangency{edge}`,
`VertexContact{edge,location}` and `SampleBoundary{support,parameter,point}`.
Coplanarity represents a potentially two-dimensional overlap and is never
reported as an empty finite intersection.

`Unresolved` reasons retain preparation, supporting-intersection, edge and
sample-classification failures. Additional reasons include `EventRange`,
`SupportMismatch`, `AmbiguousSupport`, `CrowdedEvents`, `OddEvents` and
`InconsistentIntervals`. Sample failures retain their support, parameter,
point and nested planar/cylindrical classifier reason. `Rejected` distinguishes
invalid input, index or topology, unsupported surfaces and nested supporting
or edge rejections. Conical faces are unsupported.

## Numeric bounds

The selected source surface's normal/axis and `x` are validated as directions.
Their supplied Real words must be normalized and finite, their components must
fit the inherited `1e10` limit, and each vector must have a component of magnitude
at least the shared approximately `1e-12` direction guard. Nonunit vectors are
accepted: Bend normalizes local copies and applies the existing round-curve
frame guard, requiring unit squared lengths and orthogonality within
approximately `1e-11`. Zero, parallel, skewed or malformed frame directions
return `Rejected InvalidInput`, including before empty or coplanar supporting
branches. This fixed frame-validity guard is independent of query/source
tolerances. The cutting-plane normal may also be nonunit. Original source
vectors and the cutting-plane normal remain unchanged in the result; no frame
is repaired. Boundary-curve parameterization retains its existing stricter
unit-frame requirements.

The initial arithmetic resolution is approximately `1e-12` times the maximum
of one, face/cutting-plane origins, cylinder radius and the shared edge scale.
It must be strictly below the requested linear tolerance. A cylinder radius
must exceed source allowance plus linear tolerance plus this resolution, even
when its supporting intersection would be empty. Angular tolerance must be at
least the shared `1e-12` arithmetic guard.

An event association margin includes source allowance, linear tolerance and
both supporting and edge construction resolutions. Parameter clearance is
four times that linear margin divided by minimum support speed: direction
length for a line, radius for a circle and the smaller radius for an ellipse.
An interval must exceed the sum of its endpoint clearances. Close events stay
`CrowdedEvents`; they are never merged, removed or interpreted as a thin sliver.

The inherited finite normalized F32x2 Real and `1e10` geometry/range limits
apply. Each source allowance must be in `[0,0.1]`; invalid entries cannot be
hidden by a larger valid allowance. Source tolerance permits measured
incidence gaps, not exact coincidence or source-vertex identity. These are
operational numeric guards, not certified interval-arithmetic error proofs.

## Validation

```sh
.tools/bend-2.0.25/bin/bend kernel/face-plane.bend
node --test test/face-plane.test.mjs
node scripts/diagnose-face-plane.mjs
```

Focused tests cover finite native lines and F32 edges; circular and elliptical
holes; concave and partial-round boundaries; complete circles and ellipses;
both generator branches; periodic wraps and cylindrical holes; native rigid
transforms, reversed senses and unchanged source words; invalid surface frames
and preserved nonunit supporting directions; retained nonzero source gaps;
explicit contacts; crowded events; malformed topology, trims and budgets; and
scale/radius limits.

The frozen P10 regression verifies the input and FeatureScript hashes, imports
the current seam-aware geometry, applies the actual r10b g0 transform and
constructs its real F32 box. Against box face 3 (`x=-92.79000091552734`), P10 face
9 yields a line with original edges 248 and 190, face 11 a circular arc with
edges 255 and 248, and face 17 a circular arc with edges 251 and 254. Original
hits match direct finite-edge results; their endpoints classify on the source
face boundary and inside the box face, while section midpoints classify inside
both. Face 4 against the box top has three disconnected line sections.

The same fixture retains near-parallel supporting-plane, finite endpoint,
near-parallel edge and near-coincident edge failures against the box's `y=4`
plane. Empty trims include cylinder faces whose ellipse seams were corrected
by the importer. These component results do not establish a closed section
arrangement, split topology, a valid Boolean solid or r10b completion. Overall
suite validation remains with integration.

The complete 1,134 face/box-plane diagnostic now resolves 1,118 pairs. Sixteen
remain unresolved at `y=4`: one near-parallel supporting-plane case, ten
endpoint ambiguities and five curve-resolution cases. The top and right box
planes each contain twelve finite sections; each endpoint's source edge and
native root parameter occurs twice. This is a diagnostic degree count, not a
stitched wire or a Boolean result. The other three box planes resolve empty.
The report rebuilds the frozen operands, records all nonempty/uncertain native
results and binds its outcome to unchanged implementation and input hashes.
