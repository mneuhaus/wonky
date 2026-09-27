# Explicit tolerated planar contact

`kernel/ports/curved-contact.bend` is a separate native Bend constructor for
`dot(point - origin, normal) <= 0`. It accepts an explicit modeled contact cap:

```text
clip(solid, domains, origin, normal, tolerance, source_budget, contact_cap)
  -> Attempt{result, policy, ledger}
policy = ToleratedRegularized{contact_cap, source_budget, tolerance}
```

This is a **tolerated regularized operation**. Contact decisions can remove a
small represented sliver. They are not exact clipping of the represented
coordinates. Existing `section.section`, `face-plane.intersect`, and
`curved.clip` retain their strict contact semantics. No face, edge, body name or
fixture identifier selects this constructor's algorithm.

## Three separate tolerances

The caller supplies `contact_cap`; neither query tolerance nor source incidence
budget supplies it implicitly. The cap limits complete vertex junction groups
and full bounded curve/face contact relations. Guarded uncertainty at the cap
threshold rejects. Distinct source anchors remain distinct; overlapping guarded
neighborhoods of radius `contact_cap` reject instead of selecting the nearest
anchor. The cap and source budget must each be finite and in `[0, 0.1]` mm,
matching the native bounded-budget contract. Query tolerance uses the existing
positive linear/angular validity and native angular-guard gates.

Output construction always obeys:

```text
required_incidence <= original_source_budget + native_output_resolution
```

The cap and STEP export uncertainty are **never added** to that allowance.
A permitted contact relation can therefore still fail the construction audit.
Every retained source coordinate and analytic support is unchanged. A cutter
projection participates in the checked junction group and planar overlap tests
only as a witness; it never replaces the source representative. Clear crossings
use one native analytic line/plane root shared by all incident faces.

Exact point/plane predicates use the caller's represented normal, before any
normalization. Their exact signs remain in the ledger even when a separate
contact relation changes topological treatment. The actual P10 y=4 fixture has
17 `Negative / ExactDyadic` nearby source vertices and no exact-zero contact
vertices. Its whole contact intervals are `ToleratedBand`, not
`ExactCurveInPlane`.

## Supported slice and construction

The source must pass the existing full-domain native audit, connectedness,
opposite paired edge uses, positive nominal volume, and one vertex-link cycle
per vertex. Linear planar source loops are also checked for projected
self-intersections, repeated vertices, overlap, backtracking and touching.
Edge-end identities distinguish both ends of periodic source edges in the link
audit. These checks do not constitute a general intersection proof for arbitrary
curved source faces; the constructor requires an embedded source solid.

Every face meeting the cutter/contact band must be planar with one linear outer
loop. Faces with conics, cylinders or multiple loops can only be copied or
removed when conservative bounded-domain evidence separates them from the
band. Bounds include measured endpoint/carrier error. Conic domains are kept
explicitly; line-only domain inference never replaces them.

Each contact vertex group includes its original source vertex, every incident
line endpoint sample, and the cutter-projection witness. Two contact endpoints
on an edge additionally require a whole-domain curve-band certificate. Clear
crossings retain the original curve support and original retained domain end.

For active faces, the existing native planar wire/closure primitives produce
retained regions. Entire in-band source faces use their outward orientation to
determine ownership. In-band edge ownership requires a resolved inward
conormal. Generated closure curves use the actual analytic intersection of the
source plane and cutter, and their midpoint must lie inside the original face.
Every retained `SourceEdge` use must have exactly one equally directed use in
its claimed source face. A generated closure edge belongs to its recorded
source face. The reused endpoint-pair lookup cannot bypass these checks.

Caps come from open coedges of retained faces. Projected checking witnesses on
the common cap plane detect crossing, touching, overlap and duplicate segments,
even when original representatives lie on different sides of the contact band.
Cap rings are simple and mutually separated, with unambiguous hole ownership.
Same-oriented rings must not contain one another: nested positive cap regions
and nested negative holes reject. This conservative rule also rejects a valid
material island inside another cap face's hole as `UnsupportedArrangement`;
the slice does not claim a general cap-overlay capability. Extending it requires
a checked containment tree with alternating signs.
The first slice rejects retained in-band source faces combined with any newly
required cap, since that would require a certified source-face/cap overlay.

Every output component passes the fixed-budget native audit and vertex-link
cycle check. Components are independently connected, compact, completely closed
and have positive nominal volume. Failure of any component rejects the whole
operation. `Unresolved` never carries partial result bodies; component audits
remaining in its ledger are diagnostics only. `Empty` still has policy and
ledger records.

Unsupported cases include curved contact/tangency, competing anchors, ambiguous
conormals or thresholds, incompatible edge ownership, branched or overlapping
cap arrangements, active holes, and source-face/cap overlays. An exact source
vertex with cap zero currently rejects when the separately constructed junction
projection needs a nonzero arithmetic guard. The implementation does not raise
a zero cap silently.

## Ledger version 1

`Attempt` holds the common `P.Result`, `ToleratedRegularized` policy and `Ledger`.
The numeric fields below are versioned; consumers must inspect `version` before
interpreting them.

| `stage` | Meaning |
|---:|---|
| 0 | Invalid geometry input, query tolerance or explicit policy |
| 1 | Source audit failure |
| 2 | Unsupported or unprepared face domain |
| 3 | Vertex junction, sign/threshold or competing-anchor failure |
| 4 | Source edge intersection or complete band failure |
| 5 | Face closure, ownership, cap or arrangement failure |
| 6 | At least one final component audit/link failure |
| 7 | Complete successful result, including `Empty` |

| Vertex `kind` | Meaning |
|---:|---|
| 0 | Contact relation accepted |
| 1 | Retained/inside |
| 2 | Removed/outside |
| 3 | Invalid or uncertain, including competing anchors |

| Face `mode` | Meaning |
|---:|---|
| 0 | Unknown/unprepared |
| 1 | Conservatively retained |
| 2 | Conservatively removed |
| 3 | Active planar contact/crossing face |

Vertex records retain source index, exact predicate, signed distance and the
complete optional junction association. A kind-3 vertex can retain an accepted
junction when it failed the later distinct-anchor check. Band records retain
source edge index and all native whole-domain evidence. Face records retain
source index and bounded directional evidence. Component records hold
`vertices` and `edges` compaction maps (`before`, `after`), native `audit`, and
`vertex_links`. Vertex maps refer to the operation's shared vertex table:
original source vertices first, followed by new crossing vertices. Edge maps
refer to the operation's shared edge table. Result `face_origins` and
`edge_origins` separately map retained geometry to original source identities
or generated cut provenance.

## Sequences, volumes and evidence

Subsequent operations must use the returned explicit domains and the same
original source-budget ceiling. Contact state belongs to one operation and its
cutter; a later cut computes new exact signs and relations. Do not add caps,
export floors or previous output allowances to the inherited source budget.
Preserve per-operation policies/ledgers when serializing an operation sequence.

Volumes are nominal analytic values. The incidence allowance is not a mass or
volume-error interval. P10 y=4 removes a represented near-contact sliver under
the explicit policy, so its volume must not be described as exact-set clipping.

Focused reproduction:

```sh
node --test test/curved-contact.test.mjs
```

The test rebuilds P10 from the frozen
`fixtures/r10b/modules/base/ZtoDD.body.json` (SHA-256
`b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9`),
uses the actual transform, and exercises y=4, top-then-y=4, and a subsequent
strict right cut with returned domains. The U crossbar y=2 case must return two
8-vertex, 12-edge, 6-face boxes totaling 64 mm³. Small cases cover immutable
source geometry, exact signs, shifted/tilted contact, a fixed-budget failure,
invalid policy/source, competing anchors, unsupported curved domains,
simple cap holes, the deliberate island-in-hole rejection,
permutation/rigid transforms and repeated clipping.

Native results, exported STEP siblings and timing observations are written to
`out/boolean-ports/contact-work/`. STEP validity is a separate independent check;
a successful native audit alone is not a STEP validity claim. OpenCascade only
reads exported evidence through `scripts/validate-step.py`; it never constructs
production geometry. These timings include native validation and JS interop;
they are not claims about native-machine or GPU execution performance.
