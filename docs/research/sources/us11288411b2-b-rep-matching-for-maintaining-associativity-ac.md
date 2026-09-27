# US11288411B2: B-rep matching for maintaining associativity across CAD interoperation (PTC)

- Kind: granted US patent. Canonical: https://patents.google.com/patent/US11288411B2/en. Grant PDF, all 17 PDF pages read: https://patentimages.storage.googleapis.com/73/62/34/884f51f05f98df/US11288411.pdf. Below, column numbers refer to the printed patent, not PDF pages.
- DOCUMENTED inventors: Ilya Baran and Adriana Schulz; applicant/assignee on the grant: PTC Inc. Provisional priority 2019-01-04 (62/788,338); US application filed 2020-01-06 (16/735,194); granted 2022-03-29. Sources: grant cover and Cross-reference section; canonical page.
- DOCUMENTED status evidence as of 2026-09-24: Google Patents labels Active, adjusted expiry 2040-07-18, and records a fourth-year maintenance-fee payment on 2025-09-04. Google explicitly says legal status, priority and assignee data are assumptions, not legal conclusions. No independent USPTO-register/prosecution/family review performed; do not treat the displayed expiry or status as a legal opinion. Source: canonical page / Legal Events.
- License: patent disclosure is not a software license or patent implementation permission. The text additionally reserves copyright, allowing facsimile reproduction of the patent disclosure (column 1). Independently written code can still raise patent questions. There is no public implementation repository, language/LOC/contributor inventory or release history established by this source.

## What it is

DOCUMENTED: a staged, partly heuristic matcher between an existing CAD model and an updated imported B-rep, permitting references in downstream features/constraints to migrate. It outputs a partial matching between entities of the same type, optionally seeded by user correspondences. It is not Boolean topology construction, a persistent naming syntax or an exact geometric-equivalence proof. Import associativity without access to the originating feature history is the stated problem. Sources: abstract; columns 1-5, Terminology and Operation; https://patents.google.com/patent/US11288411B2/en#description.

## How it works

### Body selection and alignment (columns 5-6; Fig. 3)

DOCUMENTED: if each input has exactly one body, consider that pair matched. Otherwise compute s(B)=(volume, AABB diagonal length, vertex count, edge count, face count). Candidate filters in the preferred embodiment: volumes differ by at most factor 10; diagonals by at most factor 2; each larger entity count is at most 100+2*(smaller count). Sort candidates by a score combining volume/AABB-volume/count ratios and pre-alignment AABB overlap divided by smaller AABB volume. Exact weights/formula are NOT supplied. Greedily process highest-scoring unmatched body pairs. Source: grant columns 5-6.

DOCUMENTED: a body point cloud contains its vertices and edge/face centroids. To estimate translation, rotate the coordinate frame randomly and project both point sets on its three axes. For each 1D problem, use the most frequent pairwise difference; if either cloud has fewer than 100 points enumerate all pairs, otherwise sample. Sampling is chosen so an alignment covering at least half of the smaller cloud is expected to leave at least 50 aligned samples; test sampled differences occurring at least 25 times on the full clouds. Accept a translation aligning more than half the points within a preferred tolerance 0.00005. A second candidate pass accepts zero translation if AABB overlap volume is at least half the smaller box. Source: grant column 6; claims 9-11.

The preferred algorithm aligns translations, not arbitrary rotations. Randomly rotating the evaluation frame does not rotate one object into another. Other Embodiments proposes rigid rotation alignment via ICP and deterministic FFT convolution for 1D differences, but does not implement or benchmark these variants. Source: columns 8-9.

### Coincidence and overlap (columns 6-7)

DOCUMENTED stage 1: match coincident vertices/edges/faces within 0.00005; accelerate candidate generation by centroid proximity in a 3D grid. The word exact here means tolerance-tested coincidence, not rational/exact-predicate arithmetic. Units of this numerical tolerance and scalar precision are not specified. Source: column 6.

DOCUMENTED stage 2: for unmatched edges on identical support curves, compute actual trimmed overlap length Lcap and accept Lcap >= 0.8*min(Lold,Lnew). For faces on identical support surfaces, use Acap >= 0.8*min(Aold,Anew). Broad-phase AABB intersection precedes overlap computation. This is a permissive coverage heuristic, not a distance/intent certificate; a small fragment fully inside a large face passes by construction. Source: columns 6-7 and claim 14.

DOCUMENTED canonical support descriptors for near-neighbour lookup:

- Line: six scalars, closest point to origin plus unit direction; query both direction signs.
- Circle: seven scalars, centre, unit normal and radius; apply the analogous sign-ambiguity handling.
- Ellipse: eleven scalars, centre, normalized normal, normalized major axis, major/minor radii; four sign combinations.
- Planes/cylinders/cones/spheres/tori: respectively 4/7/7/4/8 dimensional vectors; precise coordinate definitions for these surface descriptors are not fully given.
- Other curve kinds: AABB rejection followed by full overlap calculation.

Store old descriptors in type-specific grid structures, query new descriptors within tolerance. The disclosure presumes access to correct centroids, support comparison and overlap computations; it does not supply an SSI/trimmed-face overlap implementation. Source: columns 6-7.

### Adjacency propagation (columns 7-8; Figs. 4-6)

DOCUMENTED: give each established match pair a shared, arbitrary positive integer matchIndex. For unmatched entities construct ordered adjacency signatures:

1. Vertex: traverse adjacent edges/faces counter-clockwise around it. Record matched neighbours' matchIndex, -1 for unmatched, -3 for a missing face at a body boundary. Rotate cyclic sequence to the lexicographically greatest representation.
2. Edge: record the first endpoint, right-side face along traversal, second endpoint, other face; similarly canonicalize the cyclic start.
3. Face: for each boundary loop record alternating vertices/edges; canonicalize each loop by greatest rotation, sort loops lexicographically, concatenate with -2 loop separators. Loops without vertices are allowed in the illustrated example.

Hash old signatures. Queue new signatures by matched/unmatched-neighbour ratio, process most constrained first. Commit a pair only if its old-signature match is unique. Update signatures of adjacent unmatched entities in both models. Rebuild/reprocess the queue when ambiguous candidates remain, stopping when no progress occurs. This preserves cyclic order, not arbitrary adjacency sets; mirror/orientation conventions matter. Source: columns 7-8 and Figs. 4-6.

DOCUMENTED identity transfer: on first import assign persistent IDs (example: sequential integers). On update, new topology matched to old topology inherits its persistent ID; genuinely new entities receive new IDs. Alternatively remap references rather than IDs. This is the application's identity layer, not equality of the geometry descriptors. Source: column 8.

### Claims that matter, distinct from examples

DOCUMENTED: there are 19 claims, not 'claim 1 with 19 subclauses'. Independent claim 1 spells out the elaborate body-signature, alignment, coincidence/overlap, canonical-descriptor and adjacency pipeline. Independent claim 2 is much shorter: importing a B-rep as a new model; selecting an existing old model; computing one or more rigid motions to align topology; matching overlapping topology using coincident underlying curves/surfaces; resolving old-model references to apply features/constraints on matched new topology. Claims 3-19 depend directly or indirectly on claim 2, elaborating near-neighbour lookup, adjacency, filters, alignment and signatures. Do not assess relevance only against the detailed preferred thresholds of claim 1. Source: grant columns 10-18; https://patents.google.com/patent/US11288411B2/en#claims. This is a reading summary, not claim construction or an infringement conclusion.

## Robustness and guarantees

DOCUMENTED: partial matching, optional human seeds and iterative refinement; no theorem of unique intent recovery, no universal error bound and no exact-number requirement. Preferred acceptance values are 0.00005, 80% overlap, majority alignment and loose body filters; other embodiments may change these. The paper-like discussion suggests approximate adjacency across short edges and retries of alternative body alignments. Sources: columns 5-9.

INFERRED: symmetry, repeated identical parts, severe topology change, shuffled equal-score candidates, opposite loop orientation and mistaken early seeds can leave ambiguity or propagate wrong correspondences. A centroid grid can only accelerate a sufficiently conservative candidate search; approximate descriptor equality must never be mistaken for final entity identity. Exact multi-limb predicates could certify some geometry relations, but cannot decide human design intent from indistinguishable B-reps. Source basis: the greedy/filter/partial-signature method above.

## Parallelism and performance

DOCUMENTED inventor-reported number: multiple bodies totaling around 4000 faces can be processed in about 10 seconds (column 2). No hardware, dataset, success rate, baseline, variance or reproducible implementation is provided. Treat it as a disclosure claim, not a measured wonky performance target.

INFERRED: descriptors, centroid grids and pair filters map well to fork-join. Greedy body matching and dynamically reprioritized adjacency are inherently more sequential. An immutable implementation could use sorted key/value arrays and a synchronous frontier of conflict-free unique matches; that changes scheduling and potentially outcomes, so equivalence to the priority queue cannot be presumed. Bucket variable-degree signatures by length for GPU work; high-dimensional grids can suffer sparsity/neighbour-enumeration growth. Basis: columns 5-8.

## Known failures, limitations, war stories

DOCUMENTED: the motivation is downstream constraints breaking after exchanging 'dumb' B-reps. The patent itself identifies a stretched dumbbell where one translation is insufficient and proposes multiple candidate alignments; rotation may need ICP; early body choices may need retry using later topology evidence. Source: Other Embodiments, columns 8-9. There is no source-code issue tracker or independent failure corpus in this disclosure.

INFERRED: overlap-area computation for general trimmed curved faces can require much of the Boolean machinery wonky currently lacks. Therefore this is not a shortcut around the blocked plane/cylinder Boolean. Likewise the matcher, as described, is not a complete many-to-many lineage system with certified split/merge coverage.

## Relevance for wonky

INFERRED: useful for history-free reimport, external-model diff and human-auditable fallback matching. For wonky-native operations, directly recorded feature/surface provenance is preferable to reconstructing identity by geometric guessing. Keep exact provenance and heuristic correspondence as different evidence classes. Source basis: the patent's explicit interoperation problem and partial-match output.

Bend mapping if a legally reviewed research prototype is later authorized: U32 entity/match IDs, immutable incidence ranges, enum tokens instead of signed -1/-2/-3, fixed-length F32x2 support descriptors, conservative cell-neighbour search, explicit model units/tolerances and deterministic random seed/tie policy. Maintain matched > unmatched > loop-separator > missing-face ordering if reproducing signed lexicographic comparisons. Use normalized local frames to limit exponent/conditioning problems; the patent's mixed coordinate/direction/radius descriptors do not justify a single dimensionally untyped epsilon. Exact predicates over U32 limbs can support geometry verification but do not replace tolerance and semantic ambiguity reporting. This is an engineering inference, not a tested port.

IMPORTANT legal correction: 'irrelevant for private use' is not a safe blanket rule. Patent reach and private/research exceptions depend on territory, claims, actual acts and purpose. Germany's PatG §11(1) explicitly excludes acts in the private sphere for non-commercial purposes, but that is not a worldwide exemption or permission for later publication/distribution/commercial use. Source: https://www.gesetze-im-internet.de/patg/__11.html. Before shipping a similar importer, obtain jurisdiction/family/status and claim-specific advice. No finding about Jones 2023 infringement, ownership or freedom to operate follows merely from topical overlap.

## Pointers worth porting or studying

- Fig. 2: stage boundary; Fig. 3: alignment point selection; Figs. 4-6: adjacency canonicalization.
- Columns 5-8: all preferred thresholds, descriptors and signature mechanics; column 8: transfer of persistent IDs.
- Other Embodiments: documented places where the baseline is insufficient.
- Claims 1 and 2 separately, then dependent claims 3-19: review actual scope before implementation decisions.
- Local reading copy: <repo>/tmp/research/pdf/US11288411B2.pdf.

## Verdict: learn-from

A concrete and unusually useful account of tolerance-based import matching and adjacency evidence propagation, but not a ready-to-port permissive algorithm package. Use it to define requirements and failure tests; do not adopt the disclosed pipeline into a distributable implementation without claim/status review. No patent clearance or production code change was performed.

Sources:
- [Patent record and claims](https://patents.google.com/patent/US11288411B2/en)
- [Full grant PDF](https://patentimages.storage.googleapis.com/73/62/34/884f51f05f98df/US11288411.pdf)
- [German private/noncommercial exception](https://www.gesetze-im-internet.de/patg/__11.html)

