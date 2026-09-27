# Overview of Parasolid, Version 35 (July 2022)

- Kind: vendor overview manual (PDF, 208 pages).
- Canonical URL: http://www.q-solid.com/Parasolid_Docs_V35/pdf/ov.pdf. It is a third-party mirror of the Siemens documentation set. Read from the local copy `tmp/research/pdf/parasolid-overview-v35.pdf` and its text extraction `parasolid-overview-v35.txt`, 5862 lines. Line numbers below refer to that text file.
- Companion: Parasolid XT Format Reference V35 (`tmp/research/pdf/parasolid-xt-v35.pdf`, same mirror).
- Organization: Siemens Digital Industries Software (Parasolid team, Cambridge, UK). Dated "July 2022" (line 5).
- License:
  - Proprietary documentation.
  - Parasolid is a commercial, licensed kernel with royalties. Convergent Modeling has "additional royalty fees" (line 3119).
  - Porting implication: no code is available. Concepts only; reimplement from public descriptions.
  - The XT file format is documented publicly (XT Format Reference), which INFERRED makes an XT reader or writer feasible without licensing the kernel.
- Status:
  - V35 dates from 2022.
  - Parasolid is actively developed. V38.0 was released August 2025, per a Siemens blog cited on Wikipedia: https://blogs.sw.siemens.com/plm-components/whats-new-in-parasolid-v-38-0/ (DOCUMENTED, secondary: https://en.wikipedia.org/wiki/Parasolid). V39.0 was announced 2026-08-25 (DOCUMENTED, Siemens blog, see "Later versions" below).
  - Onshape is listed among Parasolid-based applications (DOCUMENTED, secondary: same Wikipedia article, applications list). INFERRED: this is the kernel whose behaviour FeatureScript programs implicitly assume.

## What it is

A feature-level map of the whole Parasolid kernel. It is not an algorithm description. DOCUMENTED (table of contents, lines ~60-270). Contents:
- model structure (tags, persistent IDs, topology, geometry);
- accuracy and tolerant modelling;
- checking;
- booleans, sectioning, clash detection;
- local operations and offsets;
- convergent (facet) modeling;
- blending;
- import and healing;
- XT storage;
- enquiries;
- attributes, partitions and roll-back;
- error handling;
- SMP and threading.

## How it works

### Topology (§3.1-3.2). DOCUMENTED.
- Entities: body, region, shell, face, loop, fin (half-edge), edge, vertex.
- Solid and void regions, with one infinite void region.
- General (non-manifold) bodies and facet bodies (mesh geometry under Parasolid topology, §3.2.2, line 1016).

### Accuracy (§3.6). DOCUMENTED.
- "default session precision is 1.0e-8 in a world size of 1.0e3. This gives an accuracy ratio of 1.0e11, which is an order of magnitude more accurate than that of any other kernel modeler" (line 550). The default unit is metres.
- Angular precision is 1e-11 (§3.6).
- §3.6.1 Tolerant Modelling:
  - "think of edges as tubes and vertices as spheres".
  - Non-tolerant entities "have a precision of one half of the session precision".
  - Tolerant modelling "is intrinsic to Parasolid ... many modelling operations (for instance, many involving B-surfaces) use tolerances (to a user-supplied precision) to allow operations to succeed where an accurate solution is not possible" (lines 1300-1320).
- §3.6.2 Nominal geometry: a tolerant edge may also reference "a notional accurate curve", which must lie within the edge's precision pipe.

### Checking (§3.7.3, p. 43). DOCUMENTED.
- A full body check runs check groups in sequence. "each group of checks only proceeds if the previous checks have all passed".
- Local checking is an option on the local operation and covers only affected entities. If the body was already invalid elsewhere, local checking is "not guaranteed to identify the body as invalid" (line 1475).
- With checking off, "only relevant simple checks" run, which is useful for intermediate bodies expected to be invalid.
- Fault codes are covered in the sibling note `parasolid-pk-reference-pk-body-check-states-and-fault-types.md`.

### Booleans (§4.2, pp. 45-52). DOCUMENTED.
- "There is always a single target in any boolean operation." With several tools, "Parasolid unites them before the boolean operation proceeds, treating them as a single body from that point on" (text lines ~1581-1583).
- **Global booleans** compare "all pairs of faces in the target and tool", so "the resulting body is guaranteed to be topologically consistent". They "can be computationally very expensive" (line 1598).
- **Local (partial) booleans** take user-specified face sets from target and tool and "can drastically improve performance" (line 1606).
- **Matched regions** (§4.2.2.1): the user declares intended-coincident faces and/or edges. Otherwise, for "slightly mis-aligned geometry and topology ... it is non-trivial for Parasolid to try and evaluate matched regions itself, and the success of this cannot always be guaranteed, leading to slow performance or failed boolean operations" (line 1617).
- Other options:
  - enclose regions with a sheet;
  - punch sheets;
  - fence off sections;
  - retain topologies;
  - "tools do not intersect with each other";
  - exclude regions;
  - edge merge control;
  - extend imprinted edges;
  - treat sheets as solids;
  - repair non-manifold edges from common-extrude-direction target and tool (§4.2.2.6, line 1703).
- **Boolean tools** (§4.2.3): imprint; divide faces into face sets; remove unwanted sets; fuse. These are the user-composable stages of a Boolean.

### Sectioning and clash (§4.5-4.6). DOCUMENTED.
- Non-destructive sectioning can produce wire sections from offsets of one plane, "useful when creating sections in additive manufacturing workflows where models are sliced in preparation for printing" (line 1872).
- Clash detection distinguishes:
  - **interference** (bounding topologies cross);
  - **abutment** (they touch);
  - **containment** (inside without touching) (lines 1892-1894).

### Local operations and offsets (§5). DOCUMENTED.
- Topology changes are supported partially. Result bodies "cannot always be guaranteed to be topologically" valid (line 1954).
- Offset has self-intersection removal (§5.2.1.1).

### Blending (Ch. 10). DOCUMENTED.
- Edge blends: constant, chamfer and variable.
- Blends can be unfixed (attributes) or fixed.
- Overflow types: smooth, cliff, notch (§10.2.3, line 3720).
- Face-face blends with cross-section and contact-point control.

### Convergent Modeling (Ch. 8, pp. 109-116). DOCUMENTED.
- A **facet body** has Parasolid topology whose geometry is mesh (a surface subtype) and polyline (a curve subtype) data (§3.2.2, §8.1). Booleans, sectioning and offsetting run directly on facet bodies, because converting to and from "accurate CAD geometry ... can result in additional complexity and errors".
- **Mixed bodies** hold "an arbitrary mix of facet and classic geometries" in one body. Stated uses: adding "precise analytic surfaces (e.g. machined holes) to scanned data", and restoring "precise, classic mating surfaces" on facet-optimised models (§8.1). Classic topology can be converted to facet selectively; a mesh can be converted to a single trimmed classic surface (§8.2).
- Mesh-specific operations: parameters and normals of a mesh, perimeters of facet groups, facet-topology enquiry, mesh defect checks, hole repair (§8.3).
- Additional royalty for distributing Convergent Modeling (§8.4).

### Import (§11.3). DOCUMENTED.
Parasolid "perceives gaps and overlaps along every edge" of foreign B-reps. Tolerant modelling assigns the foreign resolution to edges and vertices while faces and surfaces keep the designer's intent (line 4149).

### Storage (Ch. 12). DOCUMENTED.
- XT is text or binary.
- Forward compatible back to V1 data.
- Since V14, backward compatible "to at least the next major version" (§12.3).

### Application support (Ch. 15-16). DOCUMENTED.
- Attribute classes define behaviour on split, merge and transfer.
- Partitions and marks give partition-level and session-level roll-back ("what-if").
- Groups; tracking of entity changes; error codes and handler (§16.4).

### SMP (Ch. 17, pp. 194-197). DOCUMENTED.
- "Currently, Parasolid can create a maximum of 8 threads for SMP work" (line 5208).
- SMP-enabled areas (§17.2.3, line 5248):
  - validity checking ("face level");
  - Booleans ("face-face clashing portion of algorithm");
  - wireframe, hidden line, closest approach (multiple points), faceting (body level), mass properties, spline creation, isoclines.
- "you should not expect an automatic 50% speed up ... on a two processor machine". Scaling "is not expected to be linear". Thread-locking overhead can make isolated calls "slightly slower with SMP enabled".
- API functions are concurrent, exclusive or locally exclusive. Partitions can be locked to threads (§17.3-17.4).

### SMP and application threads in detail (Functional Description V35, chapters 113-114). DOCUMENTED.
Sources: http://www.q-solid.com/Parasolid_Docs_V35/chapters/fd_chap.114.html ("Calling Parasolid From Multiple Threads") and http://www.q-solid.com/Parasolid_Docs_V35/chapters/fd_chap.115.html ("Symmetric Multi-Processing In Parasolid"), both fetched over HTTP on 2026-09-24 (HTTPS refused); local copies `tmp/research/parasolid-v35-chapters/fd_chap.11{4,5}.html`.
- Defaults: SMP enables "1 thread per processor core" and is disabled on single-processor machines. The cap is repeated: "the maximum number of SMP threads that Parasolid can work with (currently 8)", queryable via `PK_SESSION_ask_max_threads` (§114.2.1-114.2.2).
- Memory: "with two threads, it can require twice as much workspace"; if that causes swapping, SMP is slower than one thread (§114.2.4).
- **Determinism is not guaranteed** (§114.2.5): with SMP, a Boolean that returns several bodies does not guarantee "the order of the returned bodies" nor "which resultant body inherits the value of the target body tag"; `PK_BODY_check` fault order may vary; wireframe output segments interleave across faces. Applications must be robust to order changes, and Parasolid provides `PK_DEBUG_shuffle_start` / `PK_DEBUG_shuffle_stop` to *deliberately shuffle* returned orders in testing. Support requests must state whether SMP was on.
- Granularity (§114.3): checking is parallel at face level (one body suffices); faceting only at body level (needs more than one body per call); scaling "is not expected to be linear"; a 20% gain on 2 cores does not imply 40% on 4.
- Worker-thread creation failure falls back to running the work in the calling thread and is reported (`PK_REPORT_1_osthread_fail_c`) (§114.3.3).
- Application threads (§113.1): a queue in the PK layer. Concurrent functions run together; an exclusive function waits until Parasolid is empty and blocks everyone; locally exclusive functions run concurrently for threads that locked partitions (`PK_THREAD_lock_partitions`). "All KI functions are exclusive." A single-threaded application should run one `PK_THREAD_chain_exclusive_c` chain for best performance (§113.2).

### Later versions. DOCUMENTED (Siemens blog "Parasolid v39.0: Advancing the Future of Geometry Modeling", 2026-08-25, https://blogs.sw.siemens.com/plm-components/parasolid-v39-0-advancing-the-future-of-geometry-modeling/).
- More enquiry functions may run concurrently; parts and partitions can be transmitted simultaneously in locked application threads.
- Convergent: mesh Euler operations ("local re-triangulation, fin splitting, and facet subdivision"), mesh/B-rep topology mapping, mesh-to-B-rep fitting from vertices alone.
- Slicing "now generate[s] geometrically matched polylines in overlap regions" (lattice/cellular bodies).
- Reblending can change blend size, shape and type; Python bindings are new.
- The public post does not restate the SMP thread cap; whether 8 still holds in V39 is unknown.

## Robustness and guarantees

- DOCUMENTED:
  - Topological consistency is guaranteed only for global booleans.
  - Local booleans, local operations and local checking all carry "not guaranteed" caveats.
  - Matched-region inference for misaligned data "cannot always be guaranteed".
  - The recommended practice is: checking off for intermediates, then a full check on final bodies, then roll back if invalid (§3.7.3 plus §15.3).
- INFERRED: robustness rests on three pieces:
  1. a very tight fixed precision (1e-8 in a 1e3 box);
  2. tolerant modelling as the universal escape hatch;
  3. roll-back.

  There is no exact arithmetic claim anywhere in the overview.

## Parallelism and performance

- DOCUMENTED:
  - Coarse-grained SMP, at most 8 threads, only in sub-algorithms (face-level checking, face-face clash in Booleans, body-level faceting).
  - No GPU use is mentioned.
  - Local booleans and matched regions are the documented performance levers.
- INFERRED: Parasolid's parallelism matches wonky's fork-join model at the same granularity:
  - face-pair clash tests;
  - face-level checks;
  - per-body faceting.

  The topological assembly remains sequential.

## Known failures, limitations, war stories

- DOCUMENTED:
  - "slow performance or failed boolean operations" for slightly misaligned coincident regions without user-declared matches (line 1617).
  - Imported data has "gaps and overlaps along every edge" (line 4149).
  - Local checking misses pre-existing invalidity (line 1475).
  - SMP can slow isolated calls (§17.2.2), can double temporary workspace, and makes result order and target-tag inheritance of multi-body Booleans scheduling-dependent (FD V35 §114.2.4-114.2.5).
- INFERRED: the reliance on tolerant modelling "to allow operations to succeed where an accurate solution is not possible" (line ~1315) is exactly the implicit tolerance growth wonky's rules forbid.

## Relevance for wonky

1. **Numeric targets.**
   - DOCUMENTED: 1e-8 m linear and 1e-11 angular precision, with a 1e11 accuracy ratio.
   - INFERRED:
     - FeatureScript models were authored against this kernel. Wonky's F32x2 (about 48-bit mantissa) and multi-limb exact predicates can match the 1e11 ratio for FDM-scale parts.
     - Wonky's 1e-7 mm contact bound is 100x tighter than Parasolid's 1e-5 mm. Some FeatureScript-intended coincidences may therefore need an explicit, recorded contact budget up to about 1e-5 mm rather than strict rejection.
2. **Matched regions = ACIS glue = wonky's known-coincidence path.**
   - Parasolid explicitly lets the caller declare intended coincidence because inference is unreliable.
   - For wonky, the FeatureScript evaluator often knows these pairs (same sketch plane, same expression). Pass them into the Boolean and verify them exactly. INFERRED.
3. **Global vs local booleans.** Keep a global (all face pairs) path as the reference result. Add a local path only when the operation-scoped record proves locality, and cross-check local against global in tests. INFERRED.
4. **Boolean tools** (imprint → divide into face sets → remove → fuse). This is the same decomposition as ACIS's four stages and wonky's contract 4 (cell classification plus shell assembly). It supports exposing stages separately for debugging. INFERRED.
5. **Clash taxonomy** (interference, abutment, containment) is a ready-made spec for wonky's missing compare/interference output. INFERRED.
6. **AM slicing via non-destructive sections.** A mainstream kernel lists FDM slicing as a first-class use case. This confirms wonky's plan to expose planar sections from the intersection graph. INFERRED.
7. **Checking discipline.**
   - Full checks run grouped and gated (later groups only if earlier pass).
   - Local checks run after local ops.
   - Checks are skipped for intermediates.

   This maps to wonky's tiers: a cheap local check in production, and a full check in tests and acceptance. INFERRED.
8. **SMP granularity.** Face-pair clash and face-level checking are the parallel hot spots even in a mature kernel. These are exactly the balanced fork-join and uniform GPU workloads wonky can run. INFERRED.
9. **Determinism is where wonky can beat the reference kernel.**
   - Parasolid's SMP changes the order of Boolean result bodies *and which body keeps the target's tag* (DOCUMENTED, §114.2.5 above). An Onshape FeatureScript program that relies on "the first result body" or on query order after a multi-body Boolean is therefore relying on unspecified behaviour.
   - Wonky already measures byte-identical output across JS, native at 1 and 18 threads, and Metal (`docs/proto-recover.md`). Keep that as an invariant: sort every parallel map's output by stable ids before any topology is built, and derive topology identity from provenance, never from scheduling. INFERRED.
   - Port the *testing* idea: a `shuffle` debug mode that permutes all internally unordered collections (candidate pairs, fault lists, returned bodies) and asserts that outputs and identities are unchanged. That catches accidental order dependence in the JS frontend and FeatureScript std emulation too. INFERRED.
10. **Mixed facet/classic bodies.** Wonky's plan step 8 adds `CertifiedMesh` bodies and lets chained operations accept mesh operands (`docs/hybrid-boolean-plan.md`). Parasolid goes one step further: one body may mix facet faces and exact faces. For wonky that would let a result keep exact planes and cylinders everywhere except the patch around an unrecoverable space quartic, instead of downgrading the whole body to a mesh. The per-face `approximation` label then carries the deviation (Jackson-style tolerance on the facet faces' boundary edges). INFERRED.

## Pointers worth porting or studying

- §3.6-3.6.2: the tolerant-modelling contract (half-precision for exact entities; nominal geometry inside the precision pipe).
- §3.7.3: grouped, gated full check vs local check semantics.
- §4.2.1-4.2.3: global vs local booleans, matched regions, and boolean tools as composable stages.
- §4.5.2 and §4.6: planar offset sections for AM; the clash taxonomy.
- §10.2.3: blend overflow types. Keep these as the future fillet vocabulary; FeatureScript `opFillet` exposes related options (INFERRED).
- §12.3: versioned forward and backward compatibility policy. A model for wonky's own serialized record format.
- §17.2.3: the SMP-enabled area list as evidence of where parallel payoff lies.
- Functional Description V35 §114.2.5 (order of returned entities under SMP) and the `PK_DEBUG_shuffle_*` debug switch: a template for wonky's determinism tests.
- Ch. 8 (Convergent Modeling): mixed facet/classic bodies as the design target for wonky's `CertifiedMesh` path.
- The XT Format Reference V35 (companion PDF) for field-level entity encoding. Two sections pay off directly:
  - §5.2.1.5 **Intersection** curves (`tmp/research/pdf/parasolid-xt-v35.txt`, lines ~1893-2080). SSI branches are stored *exactly* as:
    - two surfaces;
    - a chart of `hvec`s (position, (u,v) on both surfaces, tangent, parameter), with `chordal_error` and `angular_error`;
    - start and end limits of type help (closed loop), terminator (singularity, stored with a nearby branch point) or limit;
    - a C1 parameterisation `f_i = (cos b_i / cos a_i) f_{i-1}`, `t_i = t_{i-1} + C_{i-1} f_{i-1}`.

    Evaluation at t intersects both surfaces with the plane through the interpolated chord point, orthogonal to the chord. DOCUMENTED. This is the template for wonky's missing space-quartic curves (`docs/proto-recover.md` refusals).
  - The geometry self-intersection check marks (lines ~1849-1863, including `SCH_checked_ok_in_old_version`): persisted checker verdicts that carry a checker version.
- Calibration against the FeatureScript std library. DOCUMENTED, std 2960 `math.fs`: `TOLERANCE.zeroLength` = 1e-8 and `zeroAngle` = 1e-11, identical to the session precisions in §3.6; `booleanDefaultTolerance` = 1e-5 m. FeatureScript code is written against these Parasolid numbers. See the Jackson note for the cross-kernel table.

## Verdict: learn-from

The overview gives no algorithms and no code, and the kernel is proprietary. It is the best public statement of what the reference kernel behind Onshape FeatureScript actually guarantees:
- precision numbers;
- a topological-consistency guarantee only for global booleans;
- tolerant modelling everywhere;
- 8-thread SMP limited to face-level work.

Use it to calibrate wonky's tolerances, check tiers, Boolean staging and interference taxonomy. There is nothing to adopt directly.
