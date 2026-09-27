The port itself is not part of the public repository (licence); this page documents the algorithm mapping.

# SolveSpace strategy port: oriented BSP and trim reconstruction

[`kernel/ports/solvespace.bend`](../kernel/ports/solvespace.bend) constructs the
regularized intersection of a closed planar solid with
`dot(point - origin, normal) <= 0`. The native Bend result is a complete connected
`Clipped` B-rep, `Empty`, or explicit `Unresolved`. This is a scoped algorithmic
adaptation of SolveSpace, not a complete SolveSpace Boolean implementation.

## Pinned source and adaptation

The reference is SolveSpace commit
[`cbff7a9112bb7c8abe1851c56d413c0d8bc1ac84`](https://github.com/solvespace/solvespace/tree/cbff7a9112bb7c8abe1851c56d413c0d8bc1ac84).
The original `src/srf/boolean.cpp` SHA-256 is
`3616b6921d59e3a3f4a6c63ac5868f08e8b9ee858ff6bdc9822fd6fdf9b618b0`.
The [source record](../out/boolean-ports/solvespace/upstream.json) and
[BSP excerpt](../out/boolean-ports/solvespace/upstream-bsp.cpp.txt) are retained.
No downloaded C++ was executed.

| Upstream routine | Bend adaptation | Scope and difference |
| --- | --- | --- |
| [`MakeFromBoolean`](https://github.com/solvespace/solvespace/blob/cbff7a9112bb7c8abe1851c56d413c0d8bc1ac84/src/srf/boolean.cpp#L850-L898) | `split_edges`, `cut_faces`, `cap`, `finish` | One clipping plane; global source-edge splitting followed by source-face trimming and cap construction. |
| [`MakeCopyTrimAgainst`, `KeepRegion`, `KeepEdge`](https://github.com/solvespace/solvespace/blob/cbff7a9112bb7c8abe1851c56d413c0d8bc1ac84/src/srf/boolean.cpp#L497-L740) | `kept_uses`, `intervals`, `finish_face` | Oriented retained trim chains and classified cut intervals become complete loops. No general surface/surface intersections. |
| [`SBspUv::From`, `InsertEdge`, `ClassifyPoint`](https://github.com/solvespace/solvespace/blob/cbff7a9112bb7c8abe1851c56d413c0d8bc1ac84/src/srf/boolean.cpp#L925-L1087) | [`solvespace-bsp.bend`](../kernel/ports/solvespace-bsp.bend) | Longest boundary segments first; immutable recursive splitting and oriented point classification. Planar UV tests use equivalent native 3-D dot/cross products. |

Both Bend files carry **GPL-3.0-or-later** notices and credit Jonathan Westhues
(2008–2013) for the upstream algorithm. SolveSpace states its
[GPL version 3 or later license](https://github.com/solvespace/solvespace/blob/cbff7a9112bb7c8abe1851c56d413c0d8bc1ac84/README.md#L354-L356).
The existing repository helpers retain their own provenance.

The BSP classifier returns `Outside`, `Inside`, `Boundary`, or `Unresolved`
(numeric tags 0–3). For a query on an extended splitting line but outside its
actual boundary segments, disagreeing child answers become `Unresolved`.
Upstream logs that disagreement and chooses a child. Temporary BSP split
segments serve classification only; they never replace exported analytic curves.

## Construction and geometry contract

1. Check supported surfaces, curves, original domains and closed source topology
   before any empty or unchanged shortcut. Classify vertices with the existing
   represented-exact contact certificate.
2. Split each crossing source edge once in Bend. Both incident faces consume the
   same new vertex identity and retained edge. Event deduplication uses vertex
   IDs; coordinates are never welded.
3. Build a BSP from each original face boundary. Keep retained source trims and
   select on-plane edges by the incident face's interior side. Sort cut events
   along the face/plane intersection line and classify consecutive interval
   midpoints in the original face. Only interior intervals become cut edges.
4. Stitch retained trims and cut intervals by identity into oriented source-face
   loops. Stitch opposite unmatched boundary uses into cap loops.
5. Compact unused indices and aligned provenance arrays. Normalize line/plane
   frames in Bend, regenerate explicit finite line domains, and check the
   connected closed result, orientation, retained halfspace and positive volume.

All geometry and construction use native Bend `Real` F32x2 arithmetic. Lines and
planes remain analytic; there is no polygonal approximation of curved input.
Normalization changes support parameterization, so output domains are recomputed
on the normalized supports. Returned domains are suitable for another native clip.

Source objects are immutable. `face_origins` and `edge_origins` align with output
indices after compaction: retained pieces carry `SourceFace{index}` or
`SourceEdge{index}` for the immediate input; cap faces carry `CutFace`; new section
edges carry `CutEdge{face}` for the intersected source face. A source face split
into multiple output faces retains the same source index on each piece.

The port reuses arithmetic, curve-domain preparation, exact-contact certificates,
the identity stitcher, and low-level validation, compaction, canonicalization and
volume helpers. It does not call `halfspace.clip`, `halfspace.intersect`,
`halfspace.clip_ring`, `halfspace.clip_polygons`, `halfspace.cap` or
`halfspace.result`. Global splitting, BSP classification, source-trim selection,
cut-interval construction and result assembly belong to this port.

## Supported subset and limits

The input must be one embedded, bounded, oriented, connected genus-zero closed
solid with planar faces and straight finite edges. Each input face has one simple
outer loop; individual faces may be nonconvex. Input and output validation is
bounded at 256 vertices, 512 edges and 256 faces. Tested cases include L/U
profiles, transverse and exact vertex/edge/face contact, rigid transforms,
reversed curve senses, explicit input intervals and repeated clipping.

Validation checks closed opposite edge incidence, connectivity, unique vertices
and edges, finite line/plane frames, endpoint/domain incidence, positive oriented
face area and nonintersecting individual face loops. It does **not** certify global
separation of arbitrary nonadjacent faces in 3-D. An embedded, non-self-intersecting
solid remains an input precondition.

Curved geometry, holes or multiple input loops, nonzero genus, disconnected input
and disconnected output are unsupported. A disconnected U-profile cut returns
`Unresolved{UnsupportedArrangement}`; this port does not currently construct the
shared API's `Components` variant. Negative cap loops cannot become filled disks.
Source tolerance must be exactly zero. Ambiguous contact, insufficient numerical
resolution and failed construction checks produce explicit failure, never a
partial successful shell.

The operational resolution is approximately `1e-12 * max(1, coordinate magnitude)`
and includes the cutter origin's scale. Linear query tolerance must exceed it;
angular tolerance must meet the existing guard. A nonzero vertex distance within
query tolerance plus resolution is ambiguous. A rounded-zero dot product alone
does not establish exact contact. These thresholds are not a complete interval
arithmetic proof, and no snapping or tolerance growth is used to force a result.

## Focused evidence

`node --test test/port-solvespace.test.mjs` passes **14 tests**. Coverage includes
BSP collinear extensions and disagreement, closed topology and provenance,
nonconvex trims, regularized contacts, empty/unchanged results, disconnected-output
rejection, source immutability, explicit domains, transforms, 24 known-volume
perturbation cases, unsupported inputs, rounded-zero contact and malformed source
geometry before empty/unchanged shortcuts. Bend compilation reports
`All terms check.`

Twelve STEP/B-rep pairs in `out/boolean-ports/solvespace/` pass independent
`scripts/validate-step.py` checks. Every STEP has one valid solid, matching native
topology counts and volume. OpenCascade only reads these exported artifacts.

| Artifact prefix | Independent volume mm³, rounded |
| --- | ---: |
| `half-box` | 96 |
| `L-trim` | 80 |
| `L-upper` | 36 |
| `U-trim` | 96 |
| `U-left` | 80 |
| `tetrahedron` | 4.5 |
| `vertex-tetrahedron` | 10.6666666667 |
| `edge-wedge` | 72 |
| `L-reflex-contact` | 72 |
| `chained-L` | 22 |
| `rotated-box` | 96 |
| `rotated-L` | 80 |

The [evidence manifest](../out/boolean-ports/solvespace/evidence.json) binds source,
test, dependency, log and export hashes. These observations establish the tested
subset. They do not establish parity with SolveSpace, comparative robustness or
performance, general solid/solid Boolean support, or completion of frozen r10b.
The shared comparison and project-wide checks belong to root integration.
