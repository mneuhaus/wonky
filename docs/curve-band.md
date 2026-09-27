# Explicit finite curve–plane bands

`kernel/curve-band.bend` computes analytic signed-distance bounds over a finite
line interval, a valid circle/ellipse interval, or one full periodic curve. A
caller-supplied contact cap determines whether the **whole interval** fits in
the plane's symmetric distance band. All numerical operations and decisions
run in Bend; the JavaScript adapter serializes inputs.

This is a separate geometric statement. It does not resolve an existing
edge/plane intersection, establish overlap with another edge or trimmed face,
create ordered events, authorize a junction, split topology, or permit a
Boolean operation. Original curves, domains, vertices and indices are retained.
No source point is projected, moved, averaged or identified with another point.

## API

```js
import {
  boundCurvePlaneBand, boundEdgePlaneBand, requireResolvedCurveBand,
} from './src/curve-band.mjs';

const result = await boundCurvePlaneBand(curve, {
  type: 'plane', origin: [0, 0, 0], normal: [0, 0, 1],
}, {
  interval: [0, 10],       // Required for lines; omitted means a full round curve.
  contactTolerance: 1e-7,  // Required explicitly; no default or inferred cap.
  sourceTolerance: 0,     // Retained separately; never added to the cap.
});
requireResolvedCurveBand(result);

const edgeResult = await boundEdgePlaneBand(body, edgeIndex, plane, {
  contactTolerance: 1e-7,
  linear: 1e-7, angular: 1e-10, // Existing finite-edge preparation tolerances.
  inputTolerance: 0,           // Combined with body vertex allowances in Bend.
  // domains: optional per-edge overrides; otherwise use curveRange metadata.
});
```

The curve API accepts ordinary analytic curve records or native `analytic.Curve`
values. The edge API uses the shared `classificationInput` serializer and
`edge-plane.prepare_edge`, accepting analytic bodies, raw native solids and
existing implicit F32 line edges. Numeric or native cutting-plane vectors are
accepted. Native Real policy values and native domains are preserved.

The validating native entrypoints are:

```text
bound(curve: analytic.Curve, domain: curve-plane.Domain,
      plane_origin: Vec3, plane_normal: Vec3,
      contact_tolerance: Real, source_allowance: Real) -> BandResult

bound_edge(solid: analytic.Solid, index: U32,
           domains: List<face-classification.DomainChoice>,
           plane_origin: Vec3, plane_normal: Vec3,
           preparation_tolerance: intersections.Tolerance,
           contact_tolerance: Real, source_allowance: Real) -> BandResult
```

Both entrypoints validate raw input before calculation. Other exported Bend
helpers are implementation stages and assume the preceding validation; they
are not alternate validating entrypoints.

```text
BandResult =
  Resolved{relation, evidence}
  Unresolved{reason}
  Rejected{reason}

Relation = ExactCurveInPlane{} | ToleratedBand{} | ExceedsBand{}

Evidence{source, minimum, maximum, candidates, max_absolute,
         arithmetic_guard, parameter_guard, contact_tolerance, certificate}

Source{curve, domain, plane_origin, plane_normal, source_allowance,
       edge: Maybe<edge-plane.EdgeSource>}

Extremum{parameter, point, signed_distance, position}
Position = FirstEndpoint{} | LastEndpoint{} |
           StationaryMinimum{} | StationaryMaximum{} |
           ConstantRepresentative{}

Certificate = ExactZeroCoefficients{} | NotCertified{}
```

`minimum` and `maximum` retain their native parameters and evaluated curve
points. `candidates` preserves the evaluated analytic candidate set, including
ties. A finite line has both endpoint candidates. A certified constant round
function uses its first interval parameter, or zero for a full period, as a
representative. Ties retain the first candidate; the extrema are not promised
to be unique. The raw curve API has `source.edge=None`; the edge API preserves
the complete prepared `EdgeSource`, including its original start/end vertices,
sense, domain, index, source allowance and endpoint disagreement.

`requireResolvedCurveBand` only checks that the bounds comparison resolved.
Callers must inspect the relation: `ExceedsBand` is a resolved negative answer
to the whole-interval question.

## Analytic range calculation

Let `n` be the locally normalized cutting-plane normal. For a line, the signed
distance is `d(t)=b*t+c`, where `b=n·direction` and
`c=n·(curveOrigin-planeOrigin)`. Its finite minimum and maximum occur at the
interval endpoints. A small slope does not justify treating a long interval
as coincident or close.

For a circle or ellipse, the distance is
`d(t)=a*cos(t)+b*sin(t)+c`. The coefficients include the original frame,
semiaxes and `normal × x`; the existing curve-plane coefficient helpers are
reused. With `h=sqrt(a²+b²)` and `phi=atan2(b,a)`, its stationary maximum occurs
at `phi+2kπ`, and its stationary minimum at `phi+π+2kπ`. Bend includes every such
extremum in the interval, together with both endpoints. Full periodic curves
use both stationary extrema. The amplitude calculation scales `a` and `b`
before squaring to avoid unnecessary underflow or overflow.

Explicit periodic intervals have increasing native bounds, width strictly
below `2π` and endpoint magnitudes at most `8π`, following `curve-plane`.
Stationary parameters are lifted into that original range, so negative and
wrapped intervals remain native. Full curves return canonical stationary
parameters. No polygonization or sample grid establishes coverage. The retained
points are evaluations at analytically selected candidates, not a sampling
argument for the bound.

Stationary signed distances use the analytic values `c-h` and `c+h`.
Endpoint values use the distance function at their supplied parameters.
The separately evaluated 3D point can differ from that scalar formula by
arithmetic roundoff. Both are retained, with a guard; neither is a plane foot
or a constructed intersection point.

## Contact policy and exact certificates

The contact cap must be supplied explicitly and must be a finite, normalized,
nonnegative Real in the existing approximately `[0,0.1]` range. Source allowance
uses that same supported range but is separate. It validates finite-edge source
incidence and is retained as provenance; it never enlarges the contact cap or
certifies coincidence. In particular, an accepted analytic curve band does not
prove that tolerant source vertices lie in the band.

With `m=max(abs(minimum),abs(maximum))` and reported arithmetic guard `g`:

- `ToleratedBand` requires `m+g <= contactTolerance`.
- `ExceedsBand` requires `m-g > contactTolerance`.
- Otherwise the result is `Unresolved / Threshold{evidence}`.

`ExceedsBand` means that the curve is **not wholly contained** in the band. It
does not mean that every point is outside the band or that the curve is disjoint
from the plane. A curve crossing the plane may have this result.

`ExactCurveInPlane` instead requires `ExactZeroCoefficients`: the original
represented, unnormalized geometric coefficients must all have certified zero
floating expansions. For round curves, this includes the original triple
product `planeNormal · (curveNormal × x)` and its radius factor through
`curve-plane.exact_coefficients`. There is no certificate based on a previously
rounded dot product or cross product. The existing guarded exponent limits
apply; unavailable expansion arithmetic yields `NotCertified`. That means
nonzero **or unavailable**, never a proof of nonzero.

The exact certificate concerns the analytic curve's mathematical support, not
the independently retained tolerant source vertices, topology, or a second
trimmed face. Numeric extrema remain finite-precision estimates even when that
certificate establishes exact zero. A zero contact cap can accept a certified
curve; numeric proximity with a positive guard stays unresolved. If a round
amplitude computes to zero but its original varying coefficients are not
certified zero, `CoefficientConditioning` withholds a constant-range claim.

## Guards, validation and limits

The base arithmetic guard is approximately `4e-12 * scale`, with `scale` the
maximum of one, absolute curve/plane origin components, round radii and native
line endpoint displacements. The edge API additionally carries its preparation
resolution into that guard. Source allowance remains separate.

For a nonconstant round curve, `parameter_guard=min(π,4*baseGuard/h)` estimates
phase uncertainty. The final distance guard adds `h*parameter_guard`, using the
distance function's `h`-Lipschitz bound. This also covers the effect of phase
uncertainty changing whether a stationary candidate lies just inside or outside
the trim. Lines and certified constant round functions have zero phase guard.
These are operational F32x2 arithmetic estimates, not certified interval error
bounds. The module fails closed at the contact threshold under these estimates;
it does not claim a formal proof for all nonzero floating calculations.

The existing `curve-plane` geometry/domain and `edge-plane` preparation rules
apply: normalized finite Real words; input components, radii and line bounds
within `1e10`; nonzero directions; positive round radii; unit orthogonal round
frames under the existing fixed frame guard; and valid finite trims. Cutting
plane normals may be nonunit and are normalized only locally. Untrimmed lines
are rejected. Candidate points, parameters, distances and guards are checked
for supported output range. Native source data is not normalized or repaired.

`Rejected` distinguishes `InvalidGeometry`, `InvalidDomain`,
`InvalidContactTolerance`, `InvalidSourceAllowance`,
`InvalidPreparationTolerance`, `OutputRange` and nested `EdgeRejected`.
`Unresolved` distinguishes `Threshold`, `CoefficientConditioning` and unchanged
finite-edge preparation failures under `EdgeUnresolved`. Missing partial-arc
trim metadata, invalid endpoint topology and excessive source gaps retain their
existing finite-edge failures. Invalid raw inputs never produce partial band
acceptance.

## Validation and frozen interval cases

```sh
.tools/bend-2.0.25/bin/bend kernel/curve-band.bend
node --test test/curve-band.test.mjs
CURVE_BAND_REPORT=1 node --test test/curve-band.test.mjs
```

The final command regenerates `out/curve-band/diagnostic.json`. Ordinary tests
retain only the prior report's pair indices and unresolved reasons, so they do
not require generated artifacts in a fresh checkout. When
`out/junction/diagnostic.json` is present, its native source records and original
results are compared too. Geometry always comes from a fresh hash-verified
frozen import, the actual r10b transform and the actual F32 clipping box.

The nine focused tests cover analytic line and periodic ranges, interior extrema
missed by endpoint-only checks, wrapped/negative domains, explicit thresholds,
separate source allowances, unchanged native records, rounded-zero certificate
impostors, malformed inputs, native rigid transforms and 48 independently
computed tilted/translated interval ranges.

Under explicit `contactTolerance:1e-7` mm, the frozen report records:

| Observation | Count |
| --- | ---: |
| Original unresolved finite-edge pairs reverified | 42 |
| Whole-interval cases: 16 near-parallel + 5 near-coincident | 21 |
| `ToleratedBand` results | 21 |
| `ExactCurveInPlane` results | 0 |
| Endpoint ambiguity cases kept separately and excluded | 21 |
| Additional unresolved/rejected band results | 0 / 0 |

The interval cases are all lines: 17 P10 edges against box planes and four box
edges against P10 planes. Their maximum computed absolute distance is
`6.343924069618293e-11` mm; the maximum arithmetic guard is
`9.059999939240866e-10` mm. Independent double endpoint formulas differ by at
most `4.4408920930722534e-16` mm. The largest retained source allowance is
`0.0003000000251806075` mm and does not contribute to the cap.

The artifact retains all native extrema, full prepared source records, IDs,
original unresolved results, frozen and implementation hashes, stable
before/after implementation verification, reconstruction parameters and geometry
revisions. All 42 original edge-plane results remain unresolved after this
separate query. The band evidence creates no overlap events or clipped solid
and does not complete r10b's first Boolean.
