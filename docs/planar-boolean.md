# Native planar Boolean arrangement

This constructor is integrated into production `opBoolean` for admitted
plane/line UNION and SUBTRACTION operands. The unchanged r10b `g7` and subsequent `g9`
operations produce closed, exportable B-reps. It does not yet implement
general curved unions or enclosed cavity shells.

The constructor and all geometric decisions are written in Bend. An enclosing
box is partitioned by the original operands' distinct supporting planes.
Both children of a split and neighboring cells share a cache of intersection
vertices keyed by global edge endpoints and the cutting plane. Coordinates are
not welded by proximity. Every admitted cell has a strictly interior witness;
classification against both original solids selects the material for UNION.
Boundary and unresolved classifications must reject the operation atomically.

SUBTRACTION reuses the same shared arrangement, selects `A && !B`, and orients
tool-owned output boundaries opposite to the original tool face. The actual
output orientation also governs the trim-coverage guard. Original surface
carriers and face references remain intact; the host records each contributor's
orientation explicitly. Components with negative signed volume indicate an
inner cavity shell and reject the entire result at stage 10 until body nesting
and STEP void roles are implemented. Positive outer components are never
published when any component fails. Open recesses, through holes, empty results
and multiple remaining solids are admitted when all other checks succeed.

Only complete, oppositely oriented shared interfaces may be removed. The
remaining faces are assembled into actual closed components, with shared
vertices and edges. Artificial box faces must never survive as modeled
material. Face, edge and vertex contact are separate cases: sharing a point
does not establish a manifold solid, and a branched shell cannot count as a
successful union.

Admission is deliberately finite: embedded, oriented plane/line solids with
simple outer loops, the original construction budget exactly zero, certified
exact contact or sufficiently separated signs, and explicit resource limits.
Each input may contain at most 256 vertices, 512 edges and 256 faces; an
arrangement admits at most 32 distinct support planes and 512 cells. Local
incidence, closed-edge and vertex-link audits do not prove arbitrary global
source embeddedness. There is no automatic tolerance increase, snapping or
approximation. Inner shells, unsupported trims, uncertain incidences and
exhausted limits remain explicit failures. Edge-only contact is rejected;
vertex-only contact can produce two separately compacted manifold bodies.

Only original support planes partition space. The ownership audit checks all
original trim segments against the relative interior of each convex output
patch, including partially overlapping contributors whose centroid lies
outside. If the support planes did not subdivide a coplanar trim sufficiently,
the operation rejects it. Sampling a centroid or vertices is not a proof of
complete trim coverage; no additional curtain planes are currently inserted.

`FaceOrigin` retains all matching original trimmed faces as `contributors`.
Its `owner` is a deterministic representative for serialization, not a claim
that a coplanar overlap has one unique ancestor. Edges distinguish
`OriginalEdge`, `FaceIntersection` and artificial `FaceSubdivision` origins.
These references identify the operands in the operation's original frame;
later transforms retain that evidence and record their transform chain.
Cross-revision split/merge correspondence remains unresolved.

The host adapter checks the native result contract, runs the final native
incidence audit and native planar mass/bounds computation, and publishes the
result only after every component decodes successfully. Exporter tolerances
remain separate from the original zero construction budget.

The integration checks cover the frozen real `g7` operands, reversed operand
order, the following `g9` operation, rigid transforms, budget preservation,
operation history and an ordinary FeatureScript touching-face union. The
external Boolean corpus and strict independent STEP reader provide separate
checks. Progress and measured results belong in the README and versioned
reports; an implementation or test runner existing does not establish coverage.

The [native freeze](../out/boolean-ports/planar-boolean/freeze-v1/freeze.json)
records 7/7 focused tests and 14/14 strict independent STEP checks. `g7`
contains 54 vertices, 104 edges and 52 faces, with volume
51985.642486572266 mm³; `g9` contains 84 vertices, 164 edges and 82 faces,
with expected volume 56948.083435058594 mm³. Each result is one body.
The production integration also has 44 occupancy probes, checked in Bend
and by an independent STEP reader. Full r10b acceptance remains a separate
gate; these two successful operations do not establish its completion.

The [difference freeze](../out/boolean-ports/planar-difference/freeze-v1/freeze.json)
records 7/7 native difference tests, six independently valid STEP exports and
16 independent occupancy probes. All 23 native UNION regression results stayed
byte-identical to the preceding UNION freeze. The public OCCT `cut-h1` fixture
has expected volume 22 mm³ and surface area 68 mm²; both are independently
checked. Production FeatureScript integration additionally checks tool
retention, an empty target result, transform history, contributor orientation
in the geometry inspector and a fatal `try silent` cavity rejection.

Profiling identified repeated planar-face ray classification as the main
cost. Curve and domain checks already established by `prepare_loops` are now
reused during that query, while point/cut/tolerance validation happens once per
ray. Input budgets, radius admission, exact parallel decisions, construction
guards, trim selection and all ambiguity decisions are unchanged. The
prepared-ray helpers are internal and require native prepared records; the
public `classify` entrypoint still performs full validation.
The [paired JavaScript-target comparison](../out/performance/prepared-rays/comparison.json)
retains bit-identical g7/g9 results. Its two g9 pairs averaged 25.93 s before
and 23.75 s after (about 8.4% less elapsed time). Concurrent load and this small
sample prevent general throughput or native CPU/Metal speedup claims.
