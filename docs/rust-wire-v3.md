# Geometry / wire v3 (WC0)

Status: frozen WC0 contract on the W0-BREP proposal at base `2d44320`.
Consumers: GE1 (geometry), BR1 (arena/audit/import), N1 (construction
certificates), HS1 (host-op seam). This document specifies transport, not new
geometry algorithms. `docs/rust/brep-provenance.md` remains the original spike
proposal; its private checked-facts/source/symbolic-frame distinction is retained.

**E9 is DECIDED (Marc, 2026-09-26):** authoritative inputs are the exact dyadic
binary64 values delivered by the FeatureScript interpreter. Not decimal literal
intent, not exact reevaluation of earlier interpreter subexpressions, and not a
rounded intermediate computed inside the kernel. `1.68 + 10.1` delivered as one
value means the bits of the interpreter's rounded sum. The older “Default / Marc
confirms” wording in the migration plan and WC0 package description is superseded
by the plan's “Entscheidungen Marc” addendum.

## Opt-in sketch regularization (Sketch rule 2)

The strict E9 interpretation remains the default. The existing policy
`curvedContacts:"tolerated-regularized", contactCapMm:<finite nonnegative number>`
permits a declared change to three-point circular sketch carriers at shared exact
endpoints. This sketch rule does not weld endpoints. The Boolean carrier preflight below
does not construct a Boolean result.

- Keep the original line/arc source arrays in the Interpreter node unchanged.
- Encode the Sketch node as rule 2, with one Interpreter parent and parameters
  `[selectedRegionIndex, capMm]`. Rule 1 retains its previous meaning.
- Replay exact rational circumcircles, then fit a replacement circle through the
  same two endpoints, tangent to the selected adjacent line/circle. Existing exact
  tangencies are preserved. Run the ordinary exact arrangement/topology checks
  on the replacements; an unresolved or over-cap intersection still refuses.
- Bound the entire trimmed arc: for half-chord `a`, centre height `h`, a ray from
  the chord midpoint meets the arc at
  `t = h*cos(theta) + sqrt(a² + h²*cos²(theta))`. Since `|dt/dh| <= 2`, the arc moves
  at most twice its centre displacement. Admission uses the rational bound
  `4000 * (abs(deltaCx) + abs(deltaCy))` mm from the original carrier. The extra
  factor two covers the admitted near-rigid source-plane map; source endpoints
  and lines do not move. No rounded residual decides admission.
- Native audit reconstructs the replacement and compares every arena. Changing
  the cap or removing the rule must not authenticate the old replacement body.
- Native measurement JSON carries `regularization:{mode,label,exact,capMm,merges}`.
  Each merge names the operation and source entity indices and gives an upward
  rounded `maxResidualMm` plus `boundMmExact:{numerator,denominator}` integer strings.
  Indices refer to lines followed by arcs in the Interpreter arrays. Host operation
  reports map indices to FeatureScript entity names and add the sketch id.
- A body with actual merges is **regularized, not exact**, including its STEP and
  B-rep JSON records. Its analytic measurement bounds describe the regularized
  result. STL adds its independent tessellation budget. Selecting the policy with
  no merges does not relabel an exact body. Completed merges survive later refusals.

The optional trailing f64 `capMm` on host requests ARC_REGION (26) and ARC_EXTRUDE
(27, after the selected-region word) opts into rule 2. Requests without it retain
strict semantics. Unsupported follow-on operations still refuse; this rule is not
permission to weaken CAD-Acid's exact-class scoring.

## Opt-in Boolean carrier admission (HS1, not a WC0 construction rule)

HS1 Boolean request 12 accepts an optional final binary64 `capMm`; absence
preserves the exact path. Exact successes are unchanged. On a missing mixed
curved arrangement, audited arc-prism circumcircles can be compared to cylinder
carriers and conical rim circles. Only exact signed permutations of the radial
basis are admitted; exact inverse-frame arithmetic supplies the center and axial
interval. Filleted arc prisms and unsupported frame relations are not coerced.

For source squared radius `s` and positive target radius `r`, the full-circle
radial displacement is at most `abs(s-r*r)/r`. Add both center-coordinate
changes weighted by the exact world columns' L1 norms, and weight the radial
term by the sum of those norms; multiply by 1000 for mm. This rational upper
bound applies to every point, not just endpoints, and does not assume isometry.
Every cap comparison is rational; only the reported decimal bound rounds upward.
For a cone this certifies the rim only, never the adjacent cone surface.

No Boolean topology currently consumes these candidates. Status 7 may carry a
JSON envelope `wonky-carrier-refusal/1` with `reason`, `originalReason`, `capMm`
and `coincidences`. Each candidate identifies the two input bodies and their
profile-segment/carrier indices, gives `withinCap`, `maxResidualMm`,
`boundMmExact`, and explicitly says `applied:false`. The host attaches the
operation and body ids; CLI refusal JSON exposes these under `regularization`,
separately from actual `merges`. No new WC0 body, shared edge, or non-exact label
is invented for a merely proposed replacement. Any prior sketch merges retain
their non-exact labels and reports. There is a 4096 carrier-pair work budget.

## Ownership and trust boundary

* `wonky_contract` owns version-independent transport types and their
  validation. It depends only on wonky-num; wonky-brep re-exports it as `contract`.
  GE1 can depend on this lower-level crate without a geom/brep cycle. These types
  coexist with W0-BREP's convex-polyhedron prototype; WC0 does
  not replace it or claim general solid construction.
* `wonky_wire::v3::{encode,decode}` owns the word protocol. It is deliberately
  separate from `Version::{V1,V2}` and the generated Bend ADT codec. A request for
  v3 must not silently enter Bend's Solid codec or dispatch a Bend fallback.
* `Body` is mutable, untrusted input. `Body::check()` / `decode()` return an
  immutable `CheckedBody`; `body()` only borrows it, `into_body()` gives editable
  data back and loses that wrapper. Encoding also checks raw input.
* `CheckedBody` means references, DAG shape, numeric domains, budget accounting
  and its supported **incidence facts** were checked. It is **not** a manifold
  audit, a complete trimmed domain proof, an SSI Hausdorff proof, or a verified
  numeric enclosure. BR1/GE1/N1/VA1/SI4 remain responsible for those claims.
* The supported source witnesses are re-executed by W0-BREP's exact predicates.
  No host-provided `true`, hash, shared UUID or frame number proves incidence.
  Unsupported witness versions and unresolved numerical evaluations refuse by
  name. A valid message without provenance can be transported but cannot answer
  an E4 proof query.

## Identity, source geometry, and construction

`BodyKey { id: [u32;4], revision: u32 }` scopes every index. Arrays are ordered
arenas with zero-based typed indices (VertexId, CurveId, SurfaceId, PcurveId,
EdgeId, CoedgeId, LoopId, FaceId, ShellId, SolidId, FrameId, NodeId). Cross-body
indices do not exist. Every fact repeats the body key; stale revision/foreign
key refuses. Combining/copying bodies must atomically remap every reference,
including fact keys, source nodes, support backreferences and budget witnesses.
The codec performs no implicit copying, sorting or repair.

Geometry coordinates are **source** data, even when an entity references a moved
frame. A world-space rounded cache is not stored as authoritative geometry.
A `Provenance` is either `None` or `Construction { node }`; no heuristic upgrade.
The node's output frame must equal the entity's frame.

The replayed planar Boolean rule below is an explicit exception to storing
coordinates directly: its source data is the construction DAG, and entity
coordinates are checked observations of that construction. A consumer must
replay that rule or refuse, never treat its cached coordinates as new inputs.

Frames form a topologically ordered DAG (the numeric tags are additive):

* `Source { source: [u32;4] }`: names an interpreter source coordinate system.
* `Rigid { parent, translation, axis, angle }`: exactly
  `R(normalize(axis), angle) * p + translation`, not a pivot rotation. The axis
  is nonzero. Normalization and trigonometry denote the exact symbolic operation,
  **not** an approximately orthogonal f64 matrix. Angles are radians.
* `Interpreter { parent, origin, x, z }` (tag 2): the interpreter's binary64
  axes, with exact `y = z cross x`; never snapped to an ideal orthogonal frame.
* `AffineImage { base, translation, rows }` (tag 3): exactly
  `translation + rows * base(p)`, composed without rounding intermediate
  geometry. A singular matrix refuses; a negative exact determinant reverses
  exported winding. This is not a mathematical-rigidity certificate.
* `InterpreterImage { base, origin, x, z }` (tag 4, schema revision 7): the
  interpreter's placement applied after `base`. With `q = base(p)` the image is
  exactly `origin + q.x * x + q.y * (z cross x) + q.z * z`, evaluated in exact
  arithmetic on the binary64 inputs (`y = z cross x` is exact, never snapped).
  It composes a second interpreter placement onto an already placed body without
  rounding; `x` and `z` must be non-zero and not parallel. An `AffineTransform`
  construction node may bind to it exactly as to an `AffineImage`.
* `RationalImage { base, rows, denominator }` (tag 5, schema revision 8):
  exactly `rows * base(p) / denominator`, without intermediate binary64
  rounding. Numerators and denominator are binary64 input values interpreted
  exactly as rationals. The denominator must be positive and the matrix
  nonsingular; `AffineTransform` binds its parent to `base`. This generic
  transport is not a rigidity certificate. The strict motion host operation
  additionally proves the exact Gram matrix is identity.

A fact is transported only between identical frame IDs and compatible source
nodes. Similar matrices or equal-looking source IDs are not sufficient.
Independent frame chains refuse `CrossFrameUnproved`; a later construction rule
may prove a relation, but WC0 never guesses it.

A construction node stores operation, rule_version, parent node IDs, dyadic
parameters and output frame. Parents precede children, so cycles and forward
references refuse without recursive parsing. Operation tags are:

| tag | operation | parameter convention |
|---:|---|---|
| 0 | Interpreter | authoritative ordered input values, no parents, source frame |
| 1 | LineThrough | one Interpreter parent `[ax,ay,az,bx,by,bz]`, no new parameters |
| 2 | Plane | one Interpreter parent `[ox,oy,oz,nx,ny,nz,xx,xy,xz]` |
| 3 | RigidTransform | one parent in the frame's parent, no flattened matrix |
| 4 | Sketch | producer-defined ordered parameters, explicit parents |
| 5 | Extrude | ditto |
| 6 | Revolve | ditto |
| 7 | Intersection | ditto |
| 8 | Boolean | ditto |
| 9 | Point | one Interpreter parent `[x,y,z]` |
| 10 | Sphere | analytic sphere construction lineage |
| 11 | AffineTransform | one parent in the AffineImage base frame; no new parameters |
| 12 | Fillet | previous solid-construction parent; `[radius, edgeIndex, ...]`, SI radius and prior topology indices |

Fillet outputs require the rolling-ball construction audit in `wonky-ops`; structural
validity alone is not a geometric certificate. Only exact signed-permutation
frames are admitted, not approximately rigid affine transforms.

Rule version is 1 except for Revolve rule 2 (described below) and the audited Intersection extensions: rule 2
records equal-offset planar clipping; rule 3 records circular-rim clipping with
one parent and `[width, bottomSelected, topSelected]` (SI width, boolean 0/1).
The circular-rim audit replays the cylinder parent, binds every carrier and trim
to its source, and independently checks the section generators. Generic operation
nodes 4–8 preserve lineage but do not themselves certify their outputs: N1 must
add separately versioned replayable rules. The decoder does not mistake arbitrary
recorded operations for proof.
Boolean rule 5 records a stacked-prism arrangement: the grafted source DAGs of
2-64 operands, `[kind, frames, nodes] x N` parameters. The `wonky-ops`
prism-stack audit replays every operand and rebuilds the rational arrangement;
the structural check only bounds the layout.
Boolean rule 6 records an axial column arrangement: the grafted source DAGs of
one extruded profile and N coordinate-axis cylinders, parameters
`[kind, frames, nodes] x (N+1)` followed by one operation per cylinder (0 union,
1 difference, in order). The `wonky-ops` column audit replays every operand and
rebuilds the whole boundary; the structural check only bounds the layout.
`Interpreter` is a trust boundary of the kernel call, not an authentication
claim that a remote sender really executed FeatureScript. Exact source predicates
are still rechecked, including geometry-to-input bit bindings.

### Full-turn polygon revolution

`Revolve` rule version 2 constructs one closed polygonal meridian about a
source coordinate axis. Its `Interpreter` parent contains
`[axisMode, origin[3], x[3], z[3], radius0, height0, ...]`, where axisMode
0/1/2 names local X/Y/Z. The source polygon is simple and CCW; a connected
zero-radius axis interval is allowed, but isolated axis contacts and conical
apices refuse. The full-turn sentinel is exactly the interpreter's `360 * degree`.
The independent operation audit checks source binding, every circle ring,
carrier, chart, coedge sense and closed shell; structural transport alone does
not prove these properties. No sampled profile or tessellation is authoritative.

For an independently supplied world axis, exact expansion predicates prove
coincidence with sketch X or Y and identical origins. When `plane` and `line`
normalize the identical input direction using different floating operations,
the interpreter retains their common source construction plus unchanged
input/output snapshots. This proves a source sketch-X axis, not approximate
world incidence. The original sketch frame is retained, including its affine
metric defect; normalized world caches are never incidence evidence.

Surface tag 6, `ConeMeridian { origin, axis, x, start[2], end[2] }`, carries
two exact (radius,height) points. With normalized symbolic basis vectors and
`y = axis × x`, its carrier is
`origin + height*axis + radius*(cos(theta)*x + sin(theta)*y)`, where
`(radius-start.r)*(end.h-start.h) = (height-start.h)*(end.r-start.r)`.
Both radii are nonnegative and both coordinate differences are nonzero, so at
most one meridian point lies on the axis. That point is the exact apex: a face
on such a carrier has one ring loop, and the apex is a singular point of the
chart (no WC0 vertex or edge; STEP writes it as the seam's end vertex, OCCT
adds its degenerated edge). Charts use turns and axial height. The native body never rounds a cone slope, apex or
angle; only STEP observes the half-angle with validated atan2 and an explicit
export budget. Cylinders and planes reuse their existing carrier variants.

This additive carrier used wire schema version 5 (current version 8 also retains the spline and rational-image carriers below). Earlier schema versions
remain explicit decode refusals; clients must rebuild/re-export rather than
silently reinterpret snapshots. General partial angles, trimmed-arc meridians,
offset/oblique source axes, placements, Boolean arrangements and point probes
for these bodies remain named capability refusals in this slice.

### Replayed planar Boolean construction

`Boolean` rule version 1 with parameters `[operation, kind]` identifies the
plane-arrangement rule (`operation`: 0 union, 1 subtraction, 2 intersection).
Kind 1 only admits exactly representable dyadic output vertices/carriers.
Kind 2 replays the exact rational arrangement, including non-dyadic plane
intersections and exact composed operand-frame images. Each leaf is a `Sketch`
node with one `Interpreter` parent holding `[vertexCount, faceCount, xyz...,
faceLength, vertexIndices..., ...]`; the leaf's frame maps those binary64 inputs
exactly. Boolean parents can themselves be arrangements. Convex leaf incidence,
orientation, topology and the result's manifold boundary are independently
rechecked by the operation audit.

For kind 2, vertex points, plane carrier fields and pcurve samples are
reproducible observation caches, not an alternate boundary. Curves use the
additive `ConstructionLine` tag 8 with an `edge` backreference. The exact line
joins that edge's **replayed** endpoints, with unit parameter domain, even when
their binary64 observation coordinates coincide. The contract checks the edge
backreference, endpoint provenance and construction discriminator; only
`wonky-ops` replay certifies geometry. Ordinary `Line` remains unchanged and
still rejects equal endpoints. Old decoders reject the unknown tag.

Audit compares every arena against the reconstructed output and retains its
rational boundary for subsequent Booleans, measurements, plane/edge queries,
closest-edge and supported convex-body distances. STEP rounds the exact world
boundary and publishes its carrier/coordinate error budget. An edge collapsed
at STEP binary64 resolution refuses as
`export/rational-boundary-below-binary64-resolution`, without deleting topology.
Unsupported arrangements (including face holes and multiple shells), blends,
post-Boolean placements and point-distance queries remain named refusals.

### Replayed axial profile-hole arrangement

`Boolean` rule version 3 admits subtraction of disjoint axial cylinders from
an unblended line/arc prism, polygon prism, box, or cylinder. The parameters are
`[1, kind0, frameCount0, nodeCount0, kind1, frameCount1, nodeCount1, ...]`;
each parent points to the last node of that operand's contiguous DAG range.
Kinds 0/1/2/3 select the existing polygon/arc/orthogonal/cylinder source grammar.
Frames and construction references are shifted when grafting and reversed on
replay. Both source arrays must match the corresponding leaf constructor,
then its normal owner audit runs. No observed BRep coordinate is a new input.

Admission proves an exact isometric frame relation and a common coordinate
axis. Related cylinder coordinates must be exactly representable binary64;
otherwise `prism-holes/non-binary64-related-coordinate` refuses rather than
rounding them into construction authority. Rational squared-distance tests
prove strict disc/trim separation; exact source-profile winding distinguishes
material from an external circle. Through holes split both cap faces; a blind
hole splits one cap and retains its reversed floor disc. Opposite coedge uses
are checked after sewing and the complete body is compared on replay. Enclosed
Green integrals supply measures. The shared plane/cylinder STEP writer uses
the audited boundary, including arc trims, floors and periodic seams.

`prism-holes/empty-result` (a covering cylindrical cutter) and
`prism-holes/non-manifold-result` (exact internal cylindrical tangency) are
geometric errors, including at the FeatureScript boundary. Crossing trims,
overlapping tools, closed internal cavities, cone cuts, non-isometric curved
images, follow-on cuts/blends/placements and geometric queries on the result
remain named capability refusals. Point membership and distance are exact /
enclosed for points in the original target; distance outside that target is a
named per-probe refusal. This rule does not claim a general SSI arrangement.
Older validators reject its unknown construction witness version.

### Replayed coaxial meridian Boolean

`Boolean` rule version 4 admits UNION, SUBTRACTION and INTERSECTION of full
polygon revolutions and cylinders about an exactly common axis. Exact isometric
frame relations transport meridians into the selected revolution's chart;
anti-parallel axes are reoriented, never rounded into parallelism. Offset axes
refuse as `revolve/boolean/non-coaxial-axes` pending AxisGraph trimming.

Rational segment intersections split the meridians, including coincident
segments. Exact infinitesimal left/right ray classification chooses surviving
material boundaries. Sewing refuses branching and multiple loops. Every retained
ring event must be exactly binary64-representable, otherwise
`revolve/boolean/non-binary64-meridian-event` refuses. No snap threshold is used.
The existing full-revolution owner supplies rings, planes, cylinders, meridian
cones (including an exact apex), bounded measures and STEP; its isolated-axis
(pinch) restriction remains.

The first two frames/nodes cache the resulting dyadic revolution. Original
operand DAGs follow, with shifted references, then a Boolean root with
`[operation, kind0, frameCount0, nodeCount0, ...]`. Kinds 0/1 mean full revolution
(including prior rule-4 results) / cylinder. Each parent references the last node
of its operand range. The geometric audit reconstructs the original operands,
recomputes the rational arrangement and compares the complete body, including
that derived head. The head alone is not authority. Replay is depth-limited;
post-Boolean placements, offset-axis SSI, planar targets, hybrid arc tools and
multiple meridian loops are not supported by this rule. Older validators reject
this witness version instead of treating it as an opaque successful operation.

## Curves, surfaces, domains and topology

Every curve has geometry, frame, provenance, mandatory `Domain`, and support
references `(surface, pcurve)`. Pcurves carry the reverse `(curve, surface)` pair
and a domain. Edges carry curve, endpoint IDs and a subdomain. Coedges carry edge,
orientation and pcurve. Loops, faces, shells and solids retain explicit arenas.
No “missing pcurve” sentinel or reconstructed shell is silently invented.
A Trace must have at least one support/pcurve binding for **each** of its two
named carriers; two bindings to the same or unrelated carriers do not suffice.
Every binding is checked in both directions. Analytic standalone curves may
have no supports; that does not exempt a Trace from its declared carriers.

The supporting carrier families are Plane, Cylinder, Cone, Sphere, Torus, ConeMeridian and
ConeSlope. Their fields and stable tags are in `rust/wonky-wire/src/v3/layout.rs`
and the JSON Schema. `origin` is source-space; `axis` or `normal` and transverse
`x` are nonzero orthogonal vectors, normalized **symbolically**. `y = normal × x`
after normalization. Radii are lengths, Cone.angle is radians. The additive
surface tag 5, ConeSlope, instead stores positive dyadic `slope`: its chart is
`origin + v*axis + (radius+slope*v)*(cos(2πu)*x + sin(2πu)*y)`, with axial v in
source lengths and angular u in turns. In particular slope=1 is exactly 45°;
no rounded π/4 is promoted to source geometry. STEP alone projects this to a
validated radian angle and slant coordinate under its stated export budget.
Older decoders refuse the unknown tag; existing tag meanings do not change. Full geometric
admissibility (e.g. regularity/singularity of a cone or torus and trimmed surface
domain completeness) belongs to GE1/BR1, not this transport validator.

| curve tag | source semantics and required discriminants |
|---:|---|
| 0 Line | `a + t*(b-a)` with unrounded symbolic difference |
| 1 Circle | `o + r*(cos(2πt)*x + sin(2πt)*y)`, Full or Trimmed |
| 2 Ellipse | `o + major*cos(2πt)*x + minor*sin(2πt)*y`, Full or Trimmed |
| 3 Parabola | `o + focal*(t²*x + 2t*y)`, Whole / Negative / Positive t branch |
| 4 Hyperbola | `o + branch*major*cosh(t)*x + minor*sinh(t)*y`, Negative / Positive branch |
| 5 Trace | two distinct supporting surfaces, piecewise tube and budget reference |
| 6 SphereCircle | exact full ring with radius `sqrt(sphere_radius² - height²)` |
| 7 VectorEllipse | `o + cosine*cos(2πt) + sine*sin(2πt)`, Full or Trimmed; semiaxis vectors are not normalized |
| 8 ConstructionLine | exact line through the replayed endpoints of `edge`; requires planar Boolean kind 2 |
| 9 CylinderIntersection | exact perpendicular-cylinder ring `o + b*sqrt(R²-r²sin²(2πt)) + a*r*cos(2πt) + (b×a)*r*sin(2πt)`, R>r>0, Full domain |

VectorEllipse stores nonzero exactly orthogonal dyadic vectors rather than
rounded semiaxis lengths. Pcurve tag 6, Harmonic, denotes
`offset + linear*t + cosine*cos(2πt) + sine*sin(2πt)` in the surface chart.
Cylinder charts use turns for u and source lengths for axial v. These additive
tags preserve all existing tag meanings; older decoders refuse unknown tags.
Native geometry remains analytic. The bicylinder STEP writer exports analytic
3D ELLIPSE/CYLINDRICAL_SURFACE entities with bounded cubic Hermite pcurves
(maximum chart displacement 1e-9 mm, plus the native placement/export bound).

For parabola/hyperbola `axis` is the supporting plane normal; `x` is the main
in-plane direction. Parameter names and discriminants must not be inferred from
sample points. Circle/ellipse Full uses the **closed [0,1] turn domain**; its two
parameter endpoints represent the same geometric point. Trimmed uses an explicit
increasing unwrapped interval, so wrap crossings do not lose orientation. A
parabola half-branch cannot contain parameters from the other half.

A limit is NegativeInfinity, Finite(value, closed), or PositiveInfinity. No
binary64 Inf is accepted. Domains must be nonempty/increasing with legal limit
positions. Edge and pcurve domains cannot extend outside the curve. Pcurves are
Line, RationalBezier (positive homogeneous weights), Circle (tag 3),
CircularArc (tag 4), SphereLatitude (tag 5), Harmonic (tag 6), or Samples (ordered
parameters plus explicit error bound). RationalBezier maps the declared finite
parameter interval affinely to [0,1]; Samples denotes piecewise linear
interpolation in its carrier's own parameter chart. It is never analytic merely
because its samples coincide with an analytic curve.

CircularArc stores a 2D center, a unit start direction `x`, radius, and clockwise
sense. It is `center + radius*(cos(2πt)*x + sin(2πt)*y)` in turns, where
`y=(-x.y,x.x)` counterclockwise and its negative clockwise. Positive radius is
a structural check; the blend audit proves support incidence and trim bounds.

SphereLatitude stores an exact signed axial height in length units, with
`sin(latitude) = height / sphere radius` and longitude in turns. It requires a
spherical support, a full-turn domain and a height strictly between the poles;
the operation audit proves the ring incidence without rounding an angle.

A tube consists of ordered parameter subdomains, start/end points for each
linear center segment, and explicit radius bounds. It must cover the declared
curve interval without missing endpoints or joints. At each joint, the previous
segment's end and the next segment's start must be exactly the same source-space
point (numeric equality, so +0 and -0 agree while their wire bits are retained).
Radii are approximation bounds, not tolerances for snapping disconnected
centerlines; even overlapping radius bounds do not replace a shared endpoint.
Each radius fits the approximation allocation of the referenced length budget. This rejects a tube
whose last quarter is simply omitted, but is **not** proof of curve-domain
completeness or Hausdorff distance. A tube remains Estimated or an unverified
EnclosureClaim until SI4 checks coverage of the actual intersection, separation,
and its certificate. Boundary samples are not that proof.

### Frozen incidence facts

The W0 proposal's vertex–edge, edge–surface, vertex–surface and tangent-along
facts are explicit enum variants, plus CurveOnSurface for unbounded carrier
incidence. Every fact is body/revision bound. Current replay rules reuse the
existing W0-BREP predicates, not a new intersection algorithm:

* rule 1: CurveOnSurface / EdgeOnSurface, LineThrough in Plane; exact plane-side
  predicates for both source endpoints, checked input bindings and common frame;
* rule 2: VertexOnEdge, Point at declared parameter on the source LineThrough,
  including trimmed endpoint openness and exact `a + t*(b-a)` evaluation;
* rule 3: VertexOnSurface, Point on source Plane;
* rule 4: TangentAlong, two distinct ordered faces sharing the referenced edge,
  both source planes containing its line and exactly parallel normals.

Edge/tangency claims include a checked subdomain. `Contained` means carrier
incidence, never membership in a face's trimmed interior. Tangency is carrier
contact, not oriented G1 continuity. Generic curved-surface witnesses are named
refusals, not opaque accepted facts. No externally supplied incidence fact
survives geometry edits unless the new snapshot passes its source proof again.

## Error classes, units and width policy

`Estimate` and `EnclosureClaim` are different Rust types, not a boolean inside a
float. There is no conversion from Estimate to EnclosureClaim. The latter is
explicitly a **claim** with a rule ID and bound input nodes; a decoded claim is
not a proof of its own magnitude. Only the downstream verifier may construct
its own checked-enclosure type. Unknown claim rules can be transported opaquely
but can never be used as a checked certificate. In contrast, unknown **incidence
fact** rules refuse because CheckedBody exposes checked incidence queries.

Budgets carry Quantity (Length, Area, VolumeClosed, VolumeQuadrature, Angle),
separate approximation/construction/integration/export allocations, their total,
a maximum, scale and optional reference width (zero means absent for non-volume
quantities). Every magnitude is nonnegative. The total must enclose the exact
sum of all four allocations, not a rounded sum. An Enclosed total cannot hide an
Estimated stage. The schema/codec preserves the class of every stage separately.
All allocations are in **final output units after every later magnifier**. A
large radius/transform/conditioning factor cannot silently consume another
stage's budget. WC0 checks accounting; producers/verifiers derive the factors.

The volume quantities represent contributions to **full enclosure width** (not
half-width radius); their maximum cannot exceed `1e-9 * scale` for closed volume
or `1e-7 * scale` for quadrature and also `reference_width / 10`. Products and sums
are checked using exact expansion arithmetic, with a named refusal outside its
range. Other quantities declare a finite explicit maximum; downstream producer
packages set admissible per-operation limits. A tube's length magnitude is its
Hausdorff radius, not a volume interval width. These different units and meanings
must never be interchanged. Empty/NaN/invalid intervals cannot become finite
claims: Binary64 rejects them before a body exists.

## Binary transport and JSON schema

Word arrays are `u32`; byte encodings use little-endian words. Header:

```
word 0 = 0x33564b57     // little-endian ASCII WKV3
word 1 = 8              // current schema revision
word 2 = payload word count, excluding these three words
```

The magic contains a `3` for the v3 transport family. Decoding checks magic
before word 1: an otherwise valid header with a future `WKV4` magic is malformed,
not `UnknownVersion(4)`; changing that policy requires a new decoder. Unknown
word-1 version under the v3 magic -> `Error::UnknownVersion(value)`. Wrong magic/length/truncation,
unknown enum tags, non-0/1 booleans, trailing words and impossible counts are
named malformed refusals. Limit: 4,194,304 total words, a resource policy, not a
geometric tolerance. Counts are checked against the remaining input before
allocating. No recursive wire type exists.

Scalars are exact binary64 low word then high word. Signed zero is preserved.
Allowed numerical policy is zero or a normal finite magnitude in [1e-150,1e150].
Arrays have a u32 element count; fixed arrays omit it. Enums start with a tag,
then fields in declaration order. Record order is fixed by `v3/layout.rs`.
Body fields are key, frames, constructions, vertices, curves, surfaces, pcurves,
edges, coedges, loops, faces, shells, solids, facts, budgets. Topological array
order is identity, not something a decoder may canonicalize by sorting.

`to_json` exports the same checked data with `kind` discriminants; binary64s are
**16 lowercase hex digits** rather than JS numbers. Example from the required
rigid transform:

```json
{"kind":"Rigid","parent":0,"translation":["4008000000000000","c000000000000000","4014000000000000"],"axis":["3ff0000000000000","4000000000000000","4008000000000000"],"angle":"3fb999999999999a"}
```

Hyperbola branches remain distinguishable even if every other field is equal:

```json
{"kind":"Negative"}
{"kind":"Positive"}
```

Revision 8 is emitted. The binary decoder also reads revision 7 losslessly,
provided no `RationalImage` tag is present. Re-encoding migrates that envelope
to revision 8; the strictly canonical `checked_json` host boundary still rejects
old envelopes rather than silently normalizing them. Revisions <= 6 and unknown
versions remain named refusals. Frozen revision-7 geometry fixtures are not
rewritten for this transport extension.

Envelope (current schema revision): `{"magic":"WKV3","schemaVersion":8,"body":{...}}`.
`rust/wonky-wire/wire-v3.schema.json` is generated from the same frozen layout and
rejects omitted/unknown fields, wrong variants and noncanonical hex text. JSON
Schema is a **structural** check, not the cross-reference/DAG/numeric/proof
validator. JSON input parsing/host dispatch is HS1 work; WC0 supplies binary
encode/decode and a JSON exporter, not an unsafe unchecked JSON importer.

## v2 import

`import_v2` consumes the actual generated `analytic_Solid` v2 payload, validates
its decoding/references/canonical re-encoding, and returns `LegacyImport` with
**Provenance::None** and no E4 incidence authority. `contained` refuses
NoProvenance even for coordinates that happen to look coincident. This wrapper
retains the legacy geometry rather than inventing curve ranges, pcurves,
shell decomposition or a construction history. BR1's explicit topology adapter
remains separate. V1 remains legacy replay only. Neither the Rust addon ABI
version nor existing v1/v2 dispatch changes in WC0; production activation is HS1.

## Reproduction and negative controls

All cargo / node commands below ran in an isolated copy of the worktree (the mutation checks
refuse to run in a normal checkout):

```
cd rust && cargo test --offline --locked -p wonky-wire -p wonky-brep -p wonky-contract
node scripts/rust/check-wire-v3-negatives.mjs
cd rust && cargo run --offline --locked -p wonky-wire --example v3-schema -- ../out/wc0 && cd .. && uv run --locked scripts/rust/check-wire-v3-schema.py out/wc0/cases.jsonl
```

128 generated cases each exercise all geometry/branch/pcurve/fact/budget-class
variants and every arena, with three symbolic transforms, arbitrary mantissas and
negative zero. Every case must actually encode and decode; 128/128 success is
required, not acceptance of all-refuse. Tests compare source data bit-for-bit and
re-encoded words, check the exact W0-GEOM `(3,-2,5),(1,2,3),0.1` Contained repro,
and reject stale/forged/cross-frame facts and malformed messages.

The source-mutant runner changes **only the isolated remote copy**, restores it
in `finally`, and requires the named tests to run and fail their data-equality
assertion (compile failure does not count): discarded Hyperbola branch, v2
import with invented provenance, and a rigid producer dropping the rotation angle.
Estimate-to-EnclosureClaim is a compile-fail doctest paired with a compiling
same-type control. The independent pinned Draft 2020-12 validator accepts all 128
Rust-exported messages and rejects missing branch, wrong version, extra property,
enclosure/estimate confusion, bad hex and a trailing newline after valid hex.

No-Claim: no new geometry algorithms, no R20 acceptance, no general B-rep solid
or trimmed-domain audit, no verified tube/volume/transcendental certificate,
no host migration and no silent Bend fallback. This package is contract, codec,
source-witness replay and tests; independent review is still required to land.

## WC0 schema revision 4: algebraic full rings

Schema revision 4 introduced algebraic full rings (retained in revision 5). Revision 3 is
explicitly rejected; its fixed two-endpoint Edge encoding must not be decoded
as the new counted endpoint list. Existing non-ring edges still require two
endpoint references. An empty list is allowed only for a complete domain of an
exact construction carrier, whose topology has no seam vertex: `SphereCircle`,
`CylinderIntersection` (tag 9), or a Full `Circle` that is a cross-section of
one of its supporting cylinders. The contract proves the last case exactly: the
circle radius is the same binary64 input as the cylinder radius, its normal is
exactly parallel to the axis, its origin lies exactly on the axis, and its chart
on that cylinder is a constant-height line spanning one turn. A free binary64
circle (for example a rounded `sqrt(sphere_radius² - height²)` replacing a
`SphereCircle`) has no such support and is rejected as `edge endpoints`.

Curve tag 9 (`CylinderIntersection`) stores the ring origin (where the two
axes meet), the large and small cylinder axes (exactly orthogonal), and both
source radii with R>r>0; flipping the small axis selects the other of the two
disjoint branches. Pcurve tag 7 (`CylinderIntersection {}`) is its exact
pullback onto a supporting cylinder; the contract requires that support to
have one of the two source radii bit-for-bit, an exactly parallel axis, and the
ring origin on that axis. The operation owner (`wonky-ops::cylinder_tee`)
replays both source cylinders and compares the whole body. STEP alone writes
bounded piecewise-cubic 3D and chart splines for the ring and says so in the
uncertainty label; general skew or non-perpendicular quadric pairs remain
named refusals.

Curve tag 6 (`SphereCircle`) stores `origin`, `normal`, `x`, `sphere_radius`,
`height`; its exact radius is the positive square root of
`sphere_radius² - height²`. The source binary64 inputs are retained exactly.
The lens owner checks both source sphere constructions, exact midpoint and
height, carrier parameters, supports, latitude pcurves and coedge orientations.
No rounded radius or exporter-created seam vertex participates in incidence.
General unequal-radius or non-coordinate-axis lenses remain named refusals.

STEP projects the exact ring to an analytic CIRCLE with validated radical and
latitude enclosures, two SPHERICAL_SURFACEs and export-only pole/seam charts.
Those rounding and near-isometry displacements remain in the export budget.

## WC0 schema revision 6: spline carriers

Schema revision 6 adds the carriers a sketched spline needs. Earlier revisions
remain explicit decode refusals. The tags are frozen (`wire-v3.schema.json`,
`rust/wonky-wire/tests/v3_spline_carrier.rs`):

| variant | tag | fields |
|---------|-----|--------|
| `CurveGeometry::BSpline` | 10 | `degree`, `knots`, `controls: Vec<Vector3>`, `weights`, `periodic` |
| `SurfaceGeometry::LinearExtrusion` | 7 | `curve: CurveId`, `direction: Vector3` |
| `PcurveGeometry::BSpline` | 8 | `degree`, `knots`, `controls: Vec<Vector2>`, `weights` |

`weights` is empty for a non-rational spline, otherwise one positive weight per
control. Control points, weights and knots are exact binary64 values.

Contract rules (`validate.rs`, all fail closed on `check()` and on decode):

- degree 1 to 7, `knots.len() == controls.len() + degree + 1`, non-decreasing,
  clamped (the first and last knot have multiplicity `degree + 1`), no empty
  interval, interior knots strictly inside the ends with multiplicity at most
  `degree`. The contract is stricter than a general B-spline: unclamped and
  periodic knot vectors are refused for now.
- `periodic` must be false; the curve or pcurve domain is bounded and lies inside
  the knot range. A pcurve spline follows the same knot rules as a curve spline.
- `LinearExtrusion` is `S(u, v) = C(u) + v * direction`: `curve` must be a
  `BSpline` in the surface's frame (a circle or line has its own Cylinder or Plane
  carrier, so only splines are swept) and `direction` passes the same direction
  rule as the other axis fields (non-zero).
  The chart is `u` = curve parameter and `v` = distance along `direction` in
  metres. The edge pcurves on it are generators (`u` constant) and cap curves
  (`v` constant).
- Sketch rule 3 (`rust/wonky-contract/src/sketch3.rs`) is a tagged entity list
  `[region, (tag, payload...)*]` with tags line 1, arc3 2, circle 3, bezier 4,
  bspline 5, fit 6. It has one parent (the interpreter node); the extrusion depth
  stays on the interpreter node. The contract checks the grammar (tags, counts,
  integrality, positive weights and radii, knot order); admission of regions is
  the replaying operation's job.

Replay (`wonky-ops::curve_source::audit`, exact `BigRational` arithmetic through
`wonky_curve::bspline::BSpline`, the same type as strand S5's `wonky-curve`
carrier) never reads a binary64 cache to decide anything. It rebuilds the
rational controls from the sketch entity list on the construction node (a
`Sketch` rule 3 node, or an `Extrude` rule 1 node whose parent is one and whose
parameters `[lo, hi]` place the cap), compares the cache bit for bit, then checks
that pcurve charts, generators, caps and vertices are those of the sketch.
A tampered cache is refused as `curve-source/spline-cache-mismatch` (or a more
specific reason: `pcurve-chart-mismatch`, `cap-not-swept-curve`,
`generator-not-on-surface`, `vertex-off-curve-end`, `spline-provenance`,
`spline-off-sketch-plane`). A spline edge must run over the whole knot interval,
where the end controls are its end points; a curve or edge domain on a
sub-interval (valid WC0) is refused as `curve-source/edge-domain-unsupported`
until a strand trims splines. A `Fit` entity is refused as
`curve-source/spline-fit-replay-unsupported`; fit replay belongs to a later strand.
The audit does not re-certify closed-manifold orientation, embedding or volume.

STEP (`wonky-ops::step_carrier::write`): a non-rational `BSpline` edge becomes
`B_SPLINE_CURVE_WITH_KNOTS`, a `LinearExtrusion` face becomes
`SURFACE_OF_LINEAR_EXTRUSION` (the extrusion VECTOR has magnitude 1 because the
chart is in millimetres of `v`), planes stay `PLANE`. Rational splines are refused
(`step-carrier/rational-spline-unsupported`), as are reflecting frames and frames
that are not near-rigid (orthonormality defect above 1e-9; affine invariance makes
the written spline the exact image under a near-rigid binary64 rotation). Export budget: rounding the controls to binary64 millimetres moves a
non-rational B-spline by at most `max |dP_i|`, because the basis functions are a
partition of unity and non-negative; that maximum plus the direction rounding
(`EXTRUSION_DIRECTION_ERROR`) is declared in the STEP file description.
The generic WC0 mesher (`mesh_curved`) does not tessellate extrusions
(`extrusion-mesh-unsupported`); curve-profile prisms have their own certified
mesher (below).

Evidence: `rust/wonky-ops/tests/curve_carrier.rs` (audit, tamper refusals, STEP text;
AC100 is a hand-assembled writer test body, not an operation result) and
`test/rust-curve-carrier-step.test.mjs` (OCCT `BRepCheck` valid, 4 faces,
316.8 mm3; FreeCAD imports one `SurfaceOfExtrusion` and three `Plane`s). Planted
negative: `--features plant_step_bspline_surface` writes a
`B_SPLINE_SURFACE_WITH_KNOTS` and the FreeCAD type assertion fails.
No-Claim: no FS reachability. Since strand S9 the curve-profile prism below
produces these carriers; S7's hand-assembled body stays a writer test.

### Curve-profile prism (strand S9)

`wonky-ops::curve_profile` builds the spline prism of the arc-profile path: one
closed chain of sketch rule 3 entities (lines, three-point arcs, Bezier and
non-rational clamped B-splines, at least one spline) extruded along the sketch
normal. The rule 3 node IS the source; the audit rebuilds the body from it and
compares bit for bit (`curve-profile/construction-mismatch`).

| node | operation | rule | parents | parameters |
|------|-----------|------|---------|------------|
| 0 | Interpreter | 1 | - | `[depth, reverse]` |
| 1 | Sketch | 3 | `[0]` | `sketch3::encode(0, entities)` |
| 2 | Extrude | 1 | `[1]` | `[lo, hi]` (cap levels) |

Frames are `[Source, Interpreter]` as for rule 1 arc profiles. Admission goes
through `wonky-curve` only: exact chaining, then the arrangement of the chain
alone must keep every piece whole with one cell (`curve-profile/non-simple-chain`;
a crossing the spline arm cannot store refuses with its own name, e.g.
`curve2/crossing-needs-algebraic-vertex` for the S-arch of plan S10), then the
certified area sign orients it counter-clockwise. Refused by name: `Circle` and
`Fit` entities (`circle-in-chain`, `fit-spline-unsupported`), rational
B-splines (`rational-spline-unsupported`), sketches without a spline
(`spline-required`, they keep rule 1), region indices other than 0.

B-rep: a spline piece becomes one `CurveGeometry::BSpline` edge per cap whose
knots and controls are the entity's binary64 values (the sketch-plane edge names
the sketch node, the other cap the extrusion node, as `curve_source` replays
them), a `LinearExtrusion` side over the lower edge (direction +z of the sketch
frame, chart `(u, v)` with `v` the height above the lower cap) and
`PcurveGeometry::BSpline` cap pcurves. An edge runs along its spline parameter;
when the counter-clockwise profile traverses the piece backwards the edge is
stored reversed, its coedges flip and the side face is `forward = false`. Lines
and arcs keep the rule 1 serialization unchanged.

Measures (`certificate: "CurveProfilePrism"`): the volume is the exact Green
rational of the binary64 inputs rounded once when every piece is a line or a
polynomial spline (`Cycle::area_exact`), otherwise the enclosed route of arc
profiles; face areas from certified arc lengths (exact for a Pythagorean
hodograph); bounding boxes from the exact critical points of the linear forms;
probe distances from `Trimmed::distance`, which for a spline minimizes over its
ends and every interior root of `(C - p) . C'` (`BSpline::closest`). The
published tolerance covers the STEP writer's partition-of-unity budget.

Mesh (`curve_profile_mesh`): one cyclic sample polygon of the exact profile
(`Trimmed::subdivisions`, `sample_enclosure`) shared by both caps and all sides,
so every vertex has one key and the mesh is watertight by construction. The
certified deviation is chord error (at most half the chord budget) + sample
rounding + world rounding, within the requested deviation. Separation
constraint: with `d` = deviation + float32 bound, every two boundary chords
that share no vertex must be at least `5 d` apart in the world (certified from
exact source distances and the frame's smallest stretch); then `d` is at most a
third of the exact separation and no two non-adjacent STL facets touch. A
failing check halves the chord budget and samples again; a feature that stays
below resolution refuses `export/stl/sub-resolution-separation`.

STEP: `step::write_solids` routes a curve-profile body to `step_carrier`
(replayed by `curve_source::audit`), so a mixed export shares one file. A
profile with arcs builds, measures and meshes, but its STEP export refuses
(`curve-source/curve-kind-unsupported`, the circle edges) until the carrier
writer takes circles. So does a line side that is not parallel to a sketch axis
(`curve-source/plane-chart-not-exact`: the carrier writer takes a plane chart
only when its unit vectors are exact in binary64). Host op `OP_CURVE_EXTRUDE`
(35) carries the rule 3 parameters as binary64 words.

Evidence: `rust/wonky-ops/tests/curve_profile_prism.rs` (AC100 V0 and V5 from
sketch data: volume 1584/5, area 1872/5, bbox, the three probes and topology;
exact integer-unit closed forms; V1/V2/V3 frames; the mirrored arch and the
two-arch lens, whose profiles run along a spline parameter; refusals; STL
deviation and separation; the host path) and
`test/rust-curve-profile-step.test.mjs` (V0, V5, V3 and the mirrored arch: OCCT
valid with every kernel face area, 316.8 mm3, one `SurfaceOfExtrusion` and three
`Plane`s on every host; FreeCAD reads the same where it is installed). Planted negatives:
`--features plant_curve_probe_endpoints_only` (probe_normal 3.921875 instead of
37/64) and `--features plant_mesh_skip_separation` (the thin-feature profile
refuses `export/stl/non-simple-contour` and the sub-resolution slit meshes
instead of refusing `export/stl/sub-resolution-separation`). No-Claim: no Boolean,
pattern, query, fillet or distance between bodies takes a spline prism yet;
`qGeometry` names a B-spline edge `OTHER_CURVE`, not `SPLINE`.

### FeatureScript `skBezier` (strand S10)

On `WONKY_BACKEND=rust` the std builtin `skBezier(sketch, id, { points,
construction })` is ported (`src/native/rust-host.mjs`, rows in
`HOST_OPERATIONS` and `RUST_PORTED`). Its points are the CONTROL points of one
Bezier curve of degree `size(points) - 1`, never points it passes through; the
WC0 carrier caps the degree at 7, so nine or more points refuse
`sketch/bezier-degree-cap`, and fewer than two are a FeatureScript precondition
error. Every sketch entity of the Rust port is also kept, in call order, as a
sketch rule 3 entity in `sketch.rust.curves` (lines, three-point arcs, circles,
Beziers). Once a sketch holds a Bezier, that list is the sketch: `skSolve` sends
it to host op `OP_CURVE_REGION` (41: `n`, then the `n` binary64 rule 3
parameters with region 0), which runs the admission of `curve_profile::profile`
and answers one region or its refusal (for example
`curve2/crossing-needs-algebraic-vertex` for the S-arch (0,0), (8,-6), (18,6),
(26,0) over its chord, `curve-profile/circle-in-chain`, an open chain);
`opExtrude` sends the same list with the sketch frame, depth and direction flag
to `OP_CURVE_EXTRUDE`. Consumers that read only the line lists refuse a spline
sketch by name instead of seeing its chords: `opRevolve`
(`revolve/spline-profile`), `opLoft` (`loft/planar-line-profiles-required`),
and `qContainsPoint`/`qClosestTo` over its regions
(`sketch-region/curved-profile-point-selection`). Other backends refuse
`skBezier` as unsupported. The dataflow tracer (`src/lang/dataflow/fs-trace.mjs`)
counts a `skBezier` or `skFitSpline` whose first and last points coincide as a
closed region.

`BSpline::length` memoizes the certified length of the whole domain per spline
value, so the measures of a spline prism (face areas, perimeters and their
bounds) and repeated measure calls on the same body words (the host's audit
memo) run the quadrature once per piece.

Evidence: `test/rust-bezier.test.mjs` (AC100 from the catalog FS in V0-V3 and
V5: 1584/5, 1872/5, F4 E6 V4, degree n - 1 over the interpreter's binary64
controls bit for bit, probes; the STEP carries one `SURFACE_OF_LINEAR_EXTRUSION`;
the CLI's `--json --check` exits 0; degree 7 builds and nine points refuse; the
refusals above; a Bezier with a three-point arc extruded downwards; the tracer
closure rule) and `the_host_region_request_admits_one_closed_chain_and_names_the_rest`
in `rust/wonky-ops/tests/curve_profile_prism.rs`. No-Claim: no spline Booleans
(S11), no fit splines (S12); a spline profile with arcs builds and measures but
its STEP export still refuses (`curve-source/curve-kind-unsupported`).

### General Boolean Model replay (G6–G7)

Boolean rule 6 with parameters `[operation, -6]` and 2–64 parent nodes
is the general Model encoding (`operation`: 0 union, 1 subtraction,
2 intersection). An optional third parameter is a nonnegative integer solid
index. Replay computes the same exact Boolean and extracts that solid; an
out-of-range selector refuses `boolean/contract-violation:solid-selection`.
This gives disconnected outputs separate selectable bodies without deriving
an identity from rounded bounds. Union ownership is the first source with a
proved positive-volume intersection. The pre-existing axial-column rule 6 retains its different
source-layout parameter list unchanged. Dispatch checks this header before
family shape tests. FeatureScript emits this encoding at the planar family's
non-convex-face, non-convex-leaf, leaf-holes-unsupported and
multiple-shells-unsupported boundaries. Exact source replay also identifies
concave leaves admitted by the older planar arrangement. Existing rule-6
operands continue through the general Boolean; a routed curved operand refuses
`boolean/ssi-row-unavailable:plane×curved/A0`.

All output surfaces, vertices, and pcurves are emitted in the result frame;
operand construction frames remain in the parent DAG and exact frame relations
are proved during replay (support-frame option A). `ConstructionLine` is also
valid under this header. Curve tag 11, `ConstructionCurve {slot, closed}`, names
a replay-owned curve; CheckedBody accepts its closed-ring structure, while
geometric replay authenticates the slot, closure, and observations. G6–G7 emit
only planar, straight boundaries; other curve classes are not admitted.

Placement closure (G13): `AffineTransform` rule 6, one parent and no
parameters, places a replayed Model by one more exact map. Its frame must be an
image frame (`InterpreterImage`, `AffineImage`, `RationalImage` or `Rigid`)
whose base is the parent's frame. Replay moves the parent's Model by
world(frame) · world(base)⁻¹, composed in Q from the binary64 coefficients;
chained placements never round an intermediate map. The observation is
re-emitted in the placement frame. A singular map refuses `frame/singular`, a
reflection `model/placement-reflection`; `transform` and `pattern` of a Model
apply the same metric gate as every placement
(`pattern/metric-not-near-isometric`).

The process-local replay cache interns exact structural node keys including
resolved exact frames and parent identities. Hash collisions still require
full key equality. Cache hits never bypass comparison of rebuilt WC0 caches.
Planar Model consumers use the replayed rational boundary for geometry and
measures. STEP retains analytic planes/lines; mesh proposals are accepted only
when exact positive triangle orientations and oriented boundary equality prove
the face coverage, with vertex rounding within the requested export deviation.
