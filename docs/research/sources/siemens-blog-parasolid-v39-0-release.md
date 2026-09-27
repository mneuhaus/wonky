# Siemens blog: Parasolid v39.0 release

- **Kind / canonical URL:** vendor release article, [Parasolid v39.0: Advancing the Future of Geometry Modeling](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/) [S]. Entire article body and figure captions read.
- **Organization / author / date — DOCUMENTED:** Siemens Digital Industries Software, PLM Components blog; displayed byline SilviaP, author footer Silvia Peruch; published **2026-08-25**. This date and the v39.0 features were verified from the live primary page, not inferred from model knowledge. [S](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).
- **License — DOCUMENTED / limitation:** vendor article, not a code release. The page offers a commercial integration evaluation, not a permissive implementation license. Independently implement useful API contracts; do not embed Parasolid or assume the described capabilities reveal its proprietary algorithms. A separate patent/license review would be needed before using protected technology. [S](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).
- **Status / activity:** current release announcement as of this research, 2026-09-24. No source repository, language/size/commit/contributor/star statistics or public failure corpus is supplied. It documents advertised shipped capabilities, not source-level behavior or independently benchmarked robustness. [S](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

## What it is

**DOCUMENTED:** a capability overview of Parasolid's combined precise B-rep, faceted and implicit modeling environment. The most relevant additions are bidirectional mesh/B-rep topology queries, direct mesh edits, preservation choices during mesh Booleans, and richer diagnostics. It also covers reblending, lattice handling, concurrency and bindings. [S, opening and section headings](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

**INFERRED:** this is strong evidence that mixed-representation correspondence is a first-class commercial-kernel concern. It does **not** establish that Parasolid uses wonky's proposed sequence “robust tagged mesh Boolean chooses topology, analytic SSI reconstructs the exact B-rep.” No internal algorithm for that sequence is disclosed. [S, “Strengthened Convergent Modeling”](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

## How it works: the actual exposed contracts

**DOCUMENTED capabilities, without invented implementation details:**

1. **Bidirectional topology association:** find all mesh topologies associated with a B-rep topology, and vice versa. Find connected groups of mesh facets **or fins** within a selected set. A figure caption specifically shows finding facets associated with a fin; the article does not define the full fin data layout or expose API names.
2. **Mesh Euler edits:** local retriangulation, fin splitting and facet subdivision, advertised as maintaining geometric/topological consistency. No operator preconditions, degenerate cases or exact invariant equations are published.
3. **Mesh-Boolean preservation control:** select which mesh entities may be preserved or modified **when topology deformation is needed for watertight results**. The article does not claim that every Boolean is deformation-free or that an analytic feature remains exactly unchanged merely because a topological entity is preserved.
4. **Mesh-to-B-rep fitting:** fitting surfaces using mesh vertices alone; applications choose whether trimmed curves are returned. No surface-family restriction, fitting residual, boundary guarantee or analytic-recognition algorithm is specified.
5. **Local edge editing:** choose to create new curve geometry rather than reuse existing curves during face modification. This is a geometry-sharing policy exposed to the application, not evidence of persistent naming guarantees.
6. **Reblending:** change blend size, shape and type; the illustrated example changes constant-width blending to G2 constant-radius blending. No rolling-ball, corner-patch, spine or continuity solver is explained. [S, “Core modeling” / “Strengthened Convergent Modeling” and captions](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

**DOCUMENTED additional relevant controls:**

- Imprint perspective silhouettes onto a collection of topologies; construct isoclines.
- Include implicit embedded lattices in clash operations with additional region-treatment choices.
- Optionally exclude lattice and frame contributions from mass properties when favoring computation time. This is an explicit calculation scope, not evidence that the full mass has been computed faster.
- Generate geometrically matched slice polylines in overlap regions.
- Specify **exact positions along edges that faceted rendering must respect**. This matters for synchronizing geometric landmarks across display/tessellation, but no chordal-error bound is given.
- Expanded data integrity checks on import/export and more accurate operation diagnostics; expose additional system attributes through enquiries.
- Expanded general/cellular topology functions (embossing, instancing, knitting, hollowing) and rendering control over solid/void/internal regions. [S, implicit geometry, performance and platform sections](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

**Numeric model and algorithms:** the article publishes no f32/f64 requirements, exact predicates, tolerance defaults, SSI equations, adjacency implementation, fitted-surface basis or certification scheme. Treat every algorithmic implementation proposed below as inference. [S](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

## Robustness and guarantees

**DOCUMENTED:** “maintaining consistency,” “watertight,” improved checking and better diagnostics are release-level assertions. There are no proofs, quantitative error limits, benchmark models, before/after failure rates or complete edge-case contracts. In particular, the phrase about topology deformation acknowledges a preservation/repair tradeoff rather than proving exactness. [S, mesh Euler and mesh Boolean bullets](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

**INFERRED:** a wonky correspondence query should return source/output relations, not serve as a geometric certificate. After mesh edits, independently check face/edge correspondence, orientation, support-surface residual, trim closure and mesh deviation. A preserved ID is not a proof that geometry was preserved. Explicitly budget/reject any deformation rather than inheriting an unspecified kernel repair policy. [S, correspondence and preservation controls](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

## Parallelism and performance

**DOCUMENTED:** additional enquiry functions can execute concurrently with other Parasolid operations; parts and partitions may be transmitted simultaneously in **appropriately locked application threads**. The article does not name the newly eligible functions or publish lock granularity. It gives **no measured speedup, latency, CPU, core count, memory, mesh size or throughput figures**. ARM/x86 iOS Catalyst support and Python bindings are listed, but neither is evidence of GPU geometric computation. [S, “Improved Performance and Scalability” and final platform paragraph](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

**INFERRED:** separate immutable snapshot enquiries from geometry construction in wonky; allow concurrent read-only bounding, association, render preparation and diagnostic queries. This is an appropriate functional alternative to copying the vendor's unspecified locking scheme. No claim about a possible Bend/Metal speedup can be extracted from this source. [S, concurrency paragraph](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

## Known failures, limitations, war stories

**DOCUMENTED limitations of evidence:** no public issue links or individual failure cases appear. New integrity checking does not identify which previous releases failed or how often. Watertight repair may require topology deformation; concurrent transmission requires appropriate locks; mesh-only fitting has no advertised residual bound in this article; “G2” in the blend caption is not a proof for arbitrary input geometry. Any stronger assessment needs licensed API docs or independently reproducible cases, neither accessed here. [S](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

## Relevance for wonky

**INFERRED, highest-value prototypes:**

1. **A bidirectional correspondence relation, not one tag per triangle.** Use immutable relations between analytic face/edge/vertex IDs and mesh patch/triangle/halfedge/vertex IDs. Record role and operation history: inherited support, tessellation sample, split fragment, constructed SSI edge or fitted approximation. Build both lookup directions from one authoritative relation using U32 IDs and sorted index arrays; round-trip/set-consistency queries should be testable. A source face can produce many mesh triangles and many output fragments, so a single one-to-one map is inadequate. [S, mesh utility functions](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).
2. **Explicit preservation policy.** A Boolean request should distinguish protected source geometry, protected topology identity and permitted tolerance-bounded changes. Return the actual changed entities and maximum deviation, or a precise unsupported/repair-required result. For the current analytic hybrid, preserve support surfaces and reconstruct trims; do not silently deform a precision interface just to close a mesh. [S, mesh Boolean and local-edge controls](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).
3. **Shared edge-landmark constraints in tessellation.** Collect required edge parameters once, sort/deduplicate with an explicit precision rule, then have adjacent face meshes use that same sample sequence. This supports watertight FDM meshing, pcurve/3D-edge coherence, stable visual diffs and exact landmark highlighting. The proposal extends the rendering feature into wonky's mesher; it is not an assertion of how Parasolid implements it. [S, exact edge positions in faceted rendering](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).
4. **Evidence-rich enquiries.** Let code/LLMs ask which analytic entity generated a facet, which facets represent an edge, which connected component changed and which tolerance/preservation check blocked a Boolean. Keep full-versus-excluded-region mass/interference results explicitly typed. The UI can then render correspondence and repair intent instead of reporting only an opaque kernel error. [S, enquiry, diagnostics, mesh groups and mass-property controls](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

**INFERRED Bend fit:** the association/index structures and snapshot enquiries require only U32 handles, functional arrays and balanced map/filter/sort/reduce. Local mesh edits become immutable patches with checked adjacency and orientation, assembled at a join rather than concurrently mutating shared topology. Uniform GPU work is plausible for per-entity predicates/residual checks or fixed-schema query batches; adaptive fitting, component extraction and reblend construction are not made uniform by this release note. F32x2 and exact U32-limb predicates must be selected independently; none of these advertised capabilities establishes their sufficiency. No FFI, Parasolid binding or Python backend belongs in production wonky. [S, basis for these design inferences](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

## Pointers worth porting or studying

- **“Strengthened Convergent Modeling”**: all four bullets, especially bidirectional association and explicit preservation during deformation.
- **“Core modeling”**: new-versus-reused edge curve geometry, and the reblend caption as a future semantic requirement rather than an algorithm.
- **“Broader Support…”**: required edge positions in faceted output and improved integrity diagnostics.
- **“Improved Performance…”**: precise boundary of concurrency claims. All pointers refer to [S](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).

## Verdict: adapt

Adapt the public-facing contracts for bidirectional correspondence, explicit preservation/deformation policy, synchronized edge landmarks and informative queries. These directly support wonky's hybrid Boolean and inspectable CAD goals. The source supplies no transplantable Boolean/SSI/fillet numerics and no evidence that its internal architecture is identical to wonky's proposed hybrid.

## Sources and local evidence

- [Siemens original v39.0 release article, 2026-08-25](https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).
- Local captures: `<repo>/tmp/research/commercial-kernels-2/parasolid-v39.html` and `<repo>/tmp/research/commercial-kernels-2/parasolid-v39.txt`.

