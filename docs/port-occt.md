The port itself is not part of the public repository (licence); this page documents the algorithm mapping.

# OCCT strategy port: shared edge blocks and face construction

The native Bend entry point is [`kernel/ports/occt.bend`](../kernel/ports/occt.bend).
It constructs a complete regularized intersection with `dot(p-origin, normal) <= 0`.
It returns one connected `Clipped` solid, `Components` containing complete
connected solids, `Empty`, or an explicit `Unresolved`. It is a restricted
algorithmic port, not OCCT running behind a Bend wrapper and not a full OCCT port.

## Pinned primary sources and adaptation

The reference is **OCCT V7_8_1**. The [source manifest](../out/boolean-ports/occt/upstream/sources.json)
records each original URL, SHA-256 and byte count; retained copies include their
original copyright notices. The adapted structure is:

| Upstream primary routine | Native Bend implementation | Restriction or difference |
| --- | --- | --- |
| [`BOPAlgo_PaveFiller::PerformInternal`](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_1/src/BOPAlgo/BOPAlgo_PaveFiller.cxx), ordered interferences before `MakeSplitEdges` | `selected` then `occt-edges.split_edges` | One clipping plane; line/plane events only. No general VV/VE/EE/EF/FF interference graph. |
| [`BOPDS_PaveBlock::Update`](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_1/src/BOPDS/BOPDS_PaveBlock.cxx), ordered paves form blocks retaining original-edge identity | `occt-edges.crossed`, `split_edges`, `Table.blocks` | A finite line segment has at most one transverse root. This fixes the pave order without a general parameter sort. Both source faces consume the same vertex and split edge IDs. |
| [`BOPAlgo_BuilderFace::PerformLoops`](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_1/src/BOPAlgo/BOPAlgo_BuilderFace.cxx), boundary edges become wires | `face_uses`, `ends`, `pairs`, `closed`, `boundary.stitch` | Retained coedges provide a directed boundary. Dangling endpoints are sorted along `faceNormal × cutterNormal` and paired; branch degrees or uncertain separations fail. No coordinate welding. |
| `BOPAlgo_BuilderFace::PerformAreas`, wires classified as growths or holes | `areas` | Positive-area wires become separate faces. Negative or zero-area wires reject the entire operation. Upstream hole containment/attachment is **not ported**. |
| [`BOPAlgo_BuilderSolid::PerformLoops` and `PerformAreas`](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_1/src/BOPAlgo/BOPAlgo_BuilderSolid.cxx), shells become bounded solids | `components`, `edge_pack`, `component`, `finish` | Face adjacency extracts components, then positive volume and exact opposite coedge pairing are checked. Nested cavity-shell classification is not ported. |

OCCT's original double-precision numerics, tolerances, repair, pcurves, broad phase,
parallel scheduling, degenerate-edge handling and general analytic surface
intersection machinery are not inherited. The downloaded `_8.cxx` degenerate-edge
implementation was reviewed as context; it is not the line-edge algorithm used here.

The inspected sources are licensed under **GNU LGPL version 2.1 with the OCCT
exception**, with an alternative commercial-license route stated by upstream.
The [LGPL text](../out/boolean-ports/occt/upstream/LICENSE_LGPL_21.txt) and
[OCCT exception](../out/boolean-ports/occt/upstream/OCCT_LGPL_EXCEPTION.txt) are
retained. Upstream notices credit OPEN CASCADE SAS (1999–2014 for PaveBlock),
and, for BuilderFace/BuilderSolid, OPEN CASCADE SAS (2010–2014), CEA/DEN,
EDF R&D, OPEN CASCADE (2007–2010), and the earlier contributors listed in the
source headers. This is newly written Bend adaptation of that algorithmic
structure; no upstream C++ is compiled or used to construct production geometry.

## Construction and supported input

The supported source is one embedded, bounded, oriented closed shell with planar
faces and finite straight edges. Faces may be concave but currently have one
simple outer loop each. A cut may split both a face and the solid into several
connected pieces. The implementation also handles exact source-face, edge and
vertex contacts, including a cutter coincident with the inner crossbar of a U.

All source supports and topology are checked before disjoint/contained shortcuts:
finite normalized numeric words, valid plane frames, bounded edge indices,
line/plane incidence, explicit curve domains, ordered closed loops, unique vertex
and edge identities, positive face area, per-face nonadjacent segment separation,
opposite paired edge uses, shell connectivity and positive oriented volume.
This is **not a global 3-D self-intersection proof**: an embedded shell is an input
precondition. Unsupported surfaces, curves and loop arrangements are rejected
before shortcuts, so a curved body cannot bypass the subset check by being empty.

Each original edge is split exactly once. The shared table carries its retained
block, new vertex identity, domain and `SourceEdge` provenance. Retained source
faces reference these blocks and close along the section line. On-plane source
edges contribute only when the incident face's material lies on the retained
side; this discards zero-area remnants without creating reverse duplicate edges.
The opposite open uses form the cap. Every cap edge is thus shared with a retained
source face. A split source face keeps its `SourceFace` index; new cap faces use
`CutFace`; new section edges use `CutEdge{face}`.

Component extraction compacts vertices and edges while remapping coedges and
parallel provenance arrays. Every component is validated again after construction.
The output normalizes line and plane frames in Bend for the existing analytic
export contract and recomputes finite domains on those normalized supports.
Source curve senses remain intact. The source objects are never modified.

The code reuses the repository's arithmetic, contact certificates, topology
stitcher, incidence/domain checks and low-level remapping/connectivity/measurement
helpers. It calls neither `halfspace.clip` nor `halfspace.intersect`, nor their
convex polygon clipping and construction functions. Its construction order and
shared source-edge table are separate from that existing convex algorithm.

## Numerical and capability limits

Geometry, roots, sorting, areas, topology decisions and construction run in Bend
with `Real` F32x2 arithmetic. The coordinate-scaled `angular_guard` is an
operational resolution threshold, not an interval proof. Represented exact
on-plane contact uses the existing expansion certificate. A nonzero distance
inside query tolerance plus resolution yields `AmbiguousContact`; the port does
not snap or enlarge tolerance to proceed. It does not yet import the separate
research predicate module, allowing this baseline to be compared independently.

Explicitly unsupported: curved faces/edges; nonzero source tolerance; faces with
holes; cap holes; separate source shells/cavities; ambiguous contact and branch
arrangements; invalid or inconsistent supplied domains. Invalid source geometry
returns `InvalidTopology`; failed output checks return `ConstructionFailure`.
No partial shell is a successful result. A negative cap loop cannot become a
filled disk. The frozen imported r10b body remains outside this port's scope.

## Focused evidence

`node --test test/port-occt.test.mjs` passes nine focused tests covering closed
topology and domain/provenance alignment, source immutability, L/U/C concavity,
two-component cuts, face/edge/vertex contacts, reversed curve senses and reordered
IDs, native rigid transforms, repeated clipping with returned domains, late source
defects, valid annular-prism rejection, curved rejection and uncertain contact.
`.tools/bend-2.0.25/bin/bend kernel/ports/occt.bend` reports `All terms check.`

Actual STEP artifacts were independently read with `scripts/validate-step.py`:

| Artifact in `out/boolean-ports/occt/` | Valid | Solids | Independent volume mm³ |
| --- | --- | ---: | ---: |
| `half-box.step` | yes | 1 | 96 |
| `concave-L.step` | yes | 1 | 56 |
| `U-components.step` | yes | 2 | 48 total |
| `oblique.step` | yes | 1 | 4.500000000000008 |
| `rotated.step` | yes | 1 | 95.99999999999841 |

The validator also checked topology counts and volume against the exported Bend
result. Logs and native B-rep siblings are retained beside these STEP files.
These observations establish this tested subset, not equivalence to OCCT or
completion of general solid/solid Booleans. Root integration owns the common
comparison corpus, full project checks, performance comparison and hybrid selection.

## Next analytic extension

The useful extension point is `occt-edges.Table.blocks`, not an additional local
sign test in `build_one`. Replace one optional block per source edge with an
ordered list of parameter-bounded blocks and shared event-node IDs. Circles and
ellipses can cross a plane twice even when their endpoints have the same side;
the global event stage must therefore call `curve-plane.intersect` on the actual
domain, retain tangency multiplicity and endpoint identity, sort all paves, and
classify each intervening analytic interval. Closed/periodic edges need an explicit
seam and wrap policy. Existing `junction` event and witness types provide a place
to retain common-source and incidence evidence instead of merging nearby points.

For a cylinder face, replace `ends`/`pairs`' straight section-line ordering with
bounded arcs on the plane/cylinder intersection support returned by the analytic
surface intersection machinery. The same event nodes must bound both the cylinder
coedges and the planar cap coedges. The cap then contains actual circular or
elliptic arcs with explicit domains. Source cylinder wires require a periodic UV
chart and seam treatment; the current planar signed-area and segment-separation
validator cannot simply be reused for them. Curved face area construction also
needs hole containment before it can accept general cap arrangements.

The reusable downstream stages are identity-based wire stitching, opposite cap
uses, provenance propagation, connected-shell extraction and compaction. Their
geometric validators and mass checks must be extended to analytic supports before
any curved `Clipped` result is accepted. This yields a constructor with shared
global events; isolated successful circle/plane predicates or section wires alone
would not satisfy the closed-solid contract.
