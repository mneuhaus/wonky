# Analytic trimmed-cylinder membership

`kernel/cylinder-classification.bend` classifies a point against a bounded,
trimmed cylindrical face. It returns `Inside`, `Outside`, `Boundary`, or an
explicit `Unresolved` result. Geometry, tolerance decisions, seam handling,
distance bounds and intersection parity run in Bend. The JavaScript adapter
uses the shared serialization in `face-classification.mjs`.

Supported boundaries are finite line segments and full or explicitly trimmed
circles/ellipses that pass a global cylinder-incidence bound. This includes
generator/arc patches, complete periodic bands, oblique elliptical rims and
physical holes built from those curves. No boundary is polygonized. Cones and
other supporting surfaces return `NonCylindricalFace`.

This module does not split faces, construct intersection edges, build a solid,
or complete the P10/box Boolean.

## API

```js
import {
  classifyCylinderFace,
  requireResolvedCylinderClassification,
} from '../src/cylinder-classification.mjs';

const result = await classifyCylinderFace(body, faceIndex, point, {
  linear: 1e-7,
  angular: 1e-10,
  inputTolerance: 0,
  // domains: optional per-edge trim overrides
});
requireResolvedCylinderClassification(result);
```

The native API matches the planar classifier's input shape:

```text
classify(solid: analytic.Solid, face_index: U32,
         domains: List<&2, face-classification.DomainChoice>,
         point: precise.Vec3, tolerance: intersections.Tolerance,
         source_budget: real.Real) -> Classification
```

Ordinary analytic bodies and native solids are accepted. Points may be arrays
or native vectors; returned native parameter words are preserved. The shared
serializer checks representation types and topology fields before calling
Bend. Malformed host representations can raise `TypeError`/`RangeError`;
geometric and referenced-index failures stay explicit in the result.

| Result | Meaning |
| --- | --- |
| `Inside { rays: 2 }` | The projected query is inside the bounded face region; the upward and downward axial half-line parities agree. |
| `Outside { rays: 2 }` | Both half-line parities say the projected query is outside. |
| `Outside { rays: 0 }` | The query lies clearly farther from the supporting cylinder than the linear tolerance. |
| `Boundary { edge, parameter }` | A guarded upper-distance bound places the projected query within tolerance of a physical trimmed boundary curve. |
| `Unresolved { reason }` | Invalid, unsupported or uncertain geometry; no membership is asserted. |

The two rays are opposite halves of **one axial generator**, not two
independently directed probes. Their agreement checks that the physical
boundary crossings bound a finite axial region. Uncertainty on that meridian
is not repaired by moving the query or forcing endpoint parity.

Trim selection, native parameters, automatic finite line ranges, explicit
partial-round intervals, source-tolerance metadata and capability-error
behavior follow [face-classification.md](face-classification.md) and
[curve-plane.md](curve-plane.md). A nonclosed round edge without an explicit
range returns `MissingTrim`; no short-arc inference is used.

## Region and seam semantics

The face must describe a valid bounded region on its cylinder, with ordered
closed loops and supported analytic curves. Boundary loops must be simple and
mutually compatible except for represented seams. A global arrangement proof
is not implemented: crossing/overlapping loops, incompatible nesting and
nonmanifold face arrangements remain caller errors/preconditions.

Membership uses parity over the complete **physical** boundary, anchored to
outside at both axial infinities. A meridian crosses each transverse physical
boundary once when entering or leaving a region. Holes add their own boundary
crossings. This also works for periodic bands whose two individual circular
loops do not separately bound finite regions on the cylinder.

Consequently `outer` loop labels do not determine cylindrical membership.
For example, frozen P10 faces 110 and 169 have two original noncontractible
loops both labelled `inner`; together they delimit a finite band. Face sense,
axis sign, loop winding/order and an angular coordinate seam do not change the
represented region.

An edge used exactly twice in opposite coedge directions is a candidate
internal seam. This implementation supports line seams. It first validates
their endpoints, native trim and complete cylinder incidence, then removes
both uses from physical-boundary distance and parity calculations. More than
two uses, equal-direction pairs, and duplicated round-curve seams fail
explicitly. A straight chord between different angular positions cannot hide
behind seam cancellation: its complete incidence check fails. Stored geometry
and topology are never modified by classification.

## Global incidence and distance bounds

Let `n` be the normalized cylinder axis, `r > 0` its radius, and `Q` projection
onto the plane perpendicular to `n`. For a round curve,

```text
Q(P(t) - cylinderOrigin) = c + u cos(t) + v sin(t).
```

The squared radial residual is a trigonometric polynomial

```text
k0 + k1 cos(t) + k2 sin(t) + k3 cos(2t) + k4 sin(2t),
k0 = c·c + (u·u + v·v)/2 - r²,
k1 = 2 c·u,  k2 = 2 c·v,
k3 = (u·u - v·v)/2,  k4 = u·v.
```

`sum(abs(ki)) / r` bounds radial error over the entire supporting curve,
because `abs(ρ-r) = abs(ρ²-r²)/(ρ+r)` and `ρ+r >= r`. This can conservatively
reject a short arc whose supporting curve departs from the cylinder elsewhere;
it cannot accept an arc solely because a few samples happen to lie on the
cylinder. For a line, the maximum radial endpoint error plus the distance
between radial endpoints bounds the entire native trimmed segment.

The endpoint and complete-curve bounds must fit the source allowance plus
arithmetic resolution. Excess disagreement returns `InputGap`. For boundary
distance, lines use their clamped native closest parameter. Round curves use
the nearest point on their unit-circle counterpart, the minimum actual axis
radius, and the perpendicular distance to their supporting plane for a lower
bound. Evaluation of the selected analytic point, radially projected onto the
cylinder, provides an upper bound. Bounds that straddle the query/source
tolerance remain `NearBoundary`, especially for some near-ellipse cases.

The query itself is projected radially only after its distance to the cylinder
is clearly within the linear budget. The threshold has an explicit
`NearCylinder` uncertainty band. Points clearly away, including points on the
axis of a sufficiently large cylinder, return `Outside { rays: 0 }`. This is
a declared surface-membership tolerance policy, not a Euclidean distance-to-
trimmed-face solver.

The source budget is the Bend-computed maximum of `inputTolerance` and every
`body.vertexTolerancesMm` entry, with each entry required to lie in `[0, 0.1]`.
It propagates into boundary clearance and meridian-origin/endpoint avoidance.
The operational arithmetic resolution is `1e-12` times the input scale, as in
the planar classifier. The query linear tolerance must exceed it, and the
cylinder radius must exceed the combined linear/source/resolution budget.
These F32x2 guards are not a certified interval-arithmetic proof.

## Meridian decisions and limits

The plane through the cylinder axis and the query generator intersects each
boundary through `curve-plane.intersect`. A sign test selects the query's
generator and excludes the antipodal generator. Only resolved, interior,
multiplicity-one hits clearly above or below the query count. Finite lines
whose endpoints lie safely on one side of the cutting plane are analytically
disjoint and need no ill-conditioned supporting-line solve.

Tangent/coincident crossings, finite trim endpoints on the meridian, uncertain
curve/plane results, and hits too close to the query return `AmbiguousMeridian`.
Different upward/downward parity returns `UnbalancedMeridian`. In particular,
a point outside a partial panel but aligned with a boundary generator may
remain unresolved. The classifier does not guess a perturbed meridian.

Other reasons are `InvalidInput`, `InvalidIndex`, `InvalidTopology`,
`NonCylindricalFace`, `MissingTrim`, `InvalidTrim`, `InputGap`,
`ResolutionLimit`, `UnsupportedSeam`, `NearCylinder`, and `NearBoundary`.
`requireResolvedCylinderClassification` raises `UnsupportedFeatureError` for
every unresolved result.

## Validation evidence

`test/cylinder-classification.test.mjs` covers full seamed and unseamed bands,
periodic partial patches, holes crossing the coordinate seam, ellipse rims
against independent axial-height inequalities, rigid transforms, reversed
senses/uses/axis, tolerance boundaries, malformed inputs, and unsafe seams.
A negative geometry case passes all four cardinal cylinder-incidence samples
but deviates by more than 1 mm between them; the analytic bound rejects it.

The immutable P10 fixture hash is checked before and after the regression:
`b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9` for
`fixtures/r10b/modules/base/ZtoDD.body.json` (316 source vertices, 513 edges,
189 faces). The regression checks one actual analytic boundary point on each
of its 26 cylindrical faces, the partial ellipse on face 17, independent
inside/outside heights for selected complete bands including 110/169, and
their original two-loop periodic representations. This relies on the import's
corrected synthetic ellipse seam vertices, selected on the cylinder generator
in Bend; original source data and analytic curves remain unchanged.

The actual r10b g0 rigid placement and g1 clipping box are also exercised.
P10 cylinder-face 11/edge 248 and face 17/edge 254 produce curve/box-plane hits
that classify `Boundary` on P10 and `Inside` on box face 3. A point on the
cylinder/box supporting-surface intersection classifies inside both trimmed
faces. These are component checks; they do not establish a finished Boolean
or universal resolution for all points on those faces.
