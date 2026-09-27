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

Rule version is 1. Generic operation nodes 4–8 preserve lineage but do not by
themselves certify their outputs: N1 must add separately versioned replayable
rules. The decoder does not mistake arbitrary recorded operations for proof.
`Interpreter` is a trust boundary of the kernel call, not an authentication
claim that a remote sender really executed FeatureScript. Exact source predicates
are still rechecked, including geometry-to-input bit bindings.

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

The supporting carrier families are Plane, Cylinder, Cone, Sphere and Torus.
Their fields and stable tags are in `rust/wonky-wire/src/v3/layout.rs` and the
JSON Schema. `origin` is source-space; `axis` or `normal` and transverse `x` are
nonzero orthogonal vectors, normalized **symbolically**. `y = normal × x` after
normalization. Radii are lengths, cone angle is radians. Full geometric
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
word 1 = 4              // current schema revision
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

Envelope (current schema revision): `{"magic":"WKV3","schemaVersion":4,"body":{...}}`.
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

The `WKV3` transport family now emits `schemaVersion: 4`. Revision 3 is
explicitly rejected; its fixed two-endpoint Edge encoding must not be decoded
as the new counted endpoint list. Existing non-ring edges still require two
endpoint references. An empty list is allowed only for a complete
`SphereCircle` domain, whose topology has no seam vertex.

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
