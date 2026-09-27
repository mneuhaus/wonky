# Jackson 1995: Boundary Representation Modelling with Local Tolerances

- Kind: conference paper, 8 pages. Canonical: https://doi.org/10.1145/218013.218067. Readable copy: https://ftp.cs.wisc.edu/pub/users/prem/jackson-SM-95.pdf (fetched 2026-09-22, read in full from `tmp/research/pdf/jackson-sm95-local-tolerances.pdf`).
- Authors/org, year: David J. Jackson, Parasolid Business Unit, EDS Unigraphics, Cambridge UK. Proceedings of the Third ACM Symposium on Solid Modeling and Applications (SM '95), Salt Lake City, pp. 247-254.
  - The symposium was held in **May 1995**: page 1 carries "ACM 0-89791-672-7/95/0005".
  - Crossref records the proceedings' publication date as 1995-12, with 9 references and 23 citing works.

  DOCUMENTED (PDF p. 1; https://api.crossref.org/works/10.1145/218013.218067).
- A parallel note from another research batch covers the same paper, with extra Parasolid Overview V35 sec. 3.6 context: `jackson-boundary-representation-modelling-with-local-toleran.md`.
- License and porting implications: ACM copyright paper and a description of Parasolid internals. There is no code. The ideas (per-entity tolerances, the comparison ordering) are general and have been reimplemented widely: OCCT `BRep_Tolerance`, ACIS tolerant edges. Wonky can re-implement from the description with no licensing issue. INFERRED.
- Status: historical but foundational. It describes what shipped as Parasolid tolerant modelling ("sewing", tolerant edges), and the scheme is still what Parasolid XT stores today: see the XT V35 tolerant-edge rules (http://www.q-solid.com/Parasolid_Docs_V35/pdf/xt.pdf pp. 30, 49-52, 96-98). DOCUMENTED (XT) and INFERRED (continuity).

## What it is

A data model and Boolean algorithm for B-reps where **each topological entity carries its own tolerance**, in place of one global modelling resolution. Motivation: imported and blended geometry never meets exactly. A single global tolerance is either too small to accept real data or too large to resolve small features. DOCUMENTED (sec. 1-2, https://ftp.cs.wisc.edu/pub/users/prem/jackson-SM-95.pdf).

## How it works

### Model representation (sec. 3.1)
- **Vertex:** a tolerance distance, either the default of 5.0e-9 m or larger. Its tolerance region is a sphere around the vertex point. DOCUMENTED. The default is exactly half of the Parasolid linear resolution 1e-8 (XT V35 p. 26, 30). INFERRED link.
- **Edge:**
  - An edge at the default tolerance has a single 3D curve.
  - A **tolerant** edge instead has one parameter-space curve per adjacent face, and no 3D curve (two for a manifold solid edge).
  - The tolerance region is a tube of radius tol around **one** of the p-curves. The choice is arbitrary but fixed per edge, and all the other p-curves must lie inside that tube.
  - DOCUMENTED (sec. 3.1, Fig. 3).
- **Face:** the tolerance is a "thickness". In Parasolid at the time it was always the default. DOCUMENTED.
- **Monotonicity:** vertex tol >= tol of connected edges >= tol of connected faces. DOCUMENTED.
- **Tolerances belong to topology, not geometry.** Points, curves and surfaces are exact. The p-curve ends only need to lie inside the vertex sphere, so bounding curves need not meet end-to-end. DOCUMENTED (sec. 3.1).

### Consistency rules (sec. 3.2)
- Two entities intersect or coincide if they come within **the sum of their tolerances**. DOCUMENTED.
- Every connected component of the intersection of two edge tubes must intersect a common vertex of the two edges. DOCUMENTED (Fig. 4).
- Every connected component of the intersection of two faces' tolerance regions must be contractible onto common edges or vertices. DOCUMENTED (Fig. 4).
- Why one global tolerance fails:
  - A global tolerance cannot split an edge shorter than about 4x tol. DOCUMENTED (Fig. 2).
  - Tangent surfaces may fail to meet at a finer resolution. DOCUMENTED (Fig. 1).

### Topological operations (sec. 3.3)
When an operation such as splitting an edge collides with a nearby entity:
- The tolerances are **increased locally**.
- Redundant topology is removed, for example thin faces collapse (Fig. 5).

Tests use the sum of the tolerances of the entities involved. DOCUMENTED.

### Boolean = imprint, join, select (sec. 4)
1. **Imprint**, in a strict order, each stage seeing the results of the previous one:
   - (a) vertex-vertex. One vertex may match several.
   - (b) vertex-edge. Split the edge; the new vertex inherits the edge tolerance.
   - (c) edge-edge, using the sum of the edge tolerances. Returns intersection points plus "areas of coincidence" as parametric ranges on each edge. Ranges that already contain a vertex are ignored.
   - (d) vertex-face.
   - (e) edge-face. A coincidence adds an edge and an intersection adds a vertex. Split pieces are re-compared.
   - (f) face-face. The surface intersector must return curves and point contacts sufficient to separate the sides. It "need not consider curves (i.e. contact areas) already known to be common by virtue of edge-edge or edge-face comparison", "since computation of near-tangent intersection curves can be very unstable". Results are trimmed against the face boundaries, and split edges are re-compared, only against those with known common vertices.

   Imprinting can create thin degenerate faces that must be removed (Fig. 5). DOCUMENTED (sec. 4.1).
2. **Join:** matched entities are merged, and the merged entity takes **the larger of the two tolerances**. Topology is compressed to a 1:1 correspondence. The result is a non-manifold cellular model. DOCUMENTED (sec. 4.2).
3. **Select:** each entity is kept or dropped by inside/outside classification, which is unambiguous after imprint. Options: drop lower-dimensional topology, split components, return manifold sub-models. DOCUMENTED (sec. 4.3).

### Applications (sec. 5-6)
- Blending (Fig. 6-7): a B-spline sheet with tolerant edges is subtracted from a block to make a blend, and the blend's construction tolerance goes onto its tolerant edges, which are then "sewn in". DOCUMENTED.
- **Sewing** is the Boolean without the face-face and edge-face phases. It joins models known to abut, with edges compared within the sum of tolerances. If faces do not meet to the expected tolerance, the result has a thin hole, which is closed by raising the edge tolerances and re-sewing. DOCUMENTED (sec. 6.1).
- STEP: the paper argues that per-entity "uncertainty" should be attachable to topology in STEP files. DOCUMENTED (sec. 6.2).

## Robustness and guarantees

- The guarantee is **combinatorial validity with respect to the tolerance regions**, not geometric exactness. After a Boolean, all consistency rules in sec. 3.2 hold with the (possibly grown) local tolerances. DOCUMENTED (sec. 3.2, 4).
- The ordering V-V, V-E, E-E, V-F, E-F, F-F is the robustness mechanism. Lower-dimensional coincidences are decided first, and the fragile surface intersector is told to skip anything already known to be common. Near-tangent and coincident SSI is thereby avoided instead of computed. DOCUMENTED (sec. 4.1f).
- Critique of alternatives (sec. 2):
  - Exact rational arithmetic causes numeric blow-up and creates tiny unintended features.
  - Simulation-of-simplicity perturbation destroys intended coincidences.
  - Symbolic reasoning works only for special cases.

  DOCUMENTED.
- Explicitly **not** guaranteed (sec. 7):
  - Bounded tolerance growth. "Although this seems not to be achievable in all cases, tolerance growth should be contained where possible."
  - General recursive topology compression. Only "a subset sufficient for practical use" was implemented.
  - Face tolerances, which were proposed as future work to avoid near-coincident and near-tangent SSI.

  DOCUMENTED (sec. 7.1-7.3).

## Parallelism and performance

- No performance data in the paper. DOCUMENTED (absence).
- Structurally, each imprint stage is a pairwise comparison over candidate pairs (after box culling), and pairs within a stage are independent. The stages themselves are sequential, because each stage splits entities that later stages see. The per-stage pair tests map to fork-join or GPU uniform work, and the splitting and compression between stages is a sequential rebuild. INFERRED.
- Tolerance growth is a monotone max-merge over a union-find of matched entities. That is associative and commutative, so it can be computed as a parallel reduction. INFERRED.

## Known failures, limitations, war stories

- **Tolerance growth**, the author's own open problem (sec. 7.3). Repeated Booleans on tolerant models can inflate vertex and edge tolerances until small features are swallowed. This is the long-standing Parasolid/OCCT "tolerance creep" complaint. DOCUMENTED (paper) and HEARSAY (practitioner folklore, e.g. OCCT forum threads on `ShapeFix` tolerance growth; no single canonical URL).
- The edge tube is centred on one arbitrarily chosen p-curve. The validity of the other p-curves is measured against that choice, so the same edge can be valid or invalid depending on which curve is the reference. DOCUMENTED (the choice) and INFERRED (consequence).
- Face tolerances were unused in Parasolid at the time, so near-tangent face pairs still went through the SSI. DOCUMENTED (sec. 7.1).

## Relevance for wonky

- wonky already has pieces of this model, per `local design note`:
  - A per-operand construction budget (operand B of r10b/g10 carries ~3.0e-4 mm, A carries 0).
  - A separate contact policy: `strict` by default, `tolerated-regularized` with a 1e-7 mm contact cap in acceptance.
  - A rule of "no silent tolerance increase" ("keine stille ... Toleranzerhöhung").

  Jackson moves the budget from body level to **vertex, edge and face level** and makes growth local. That fits wonky if every growth event is recorded in provenance and bounded by a caller-given cap, so it is never silent. INFERRED.
- The **imprint ordering is exactly the pre-pass wonky's curved Boolean needs.** The g10 blocker is a plane/cylinder union with coplanar contact, where a naive face-face SSI either sees nothing or sees a degenerate tangent contact. Deciding V-V, V-E, E-E, V-F and E-F coincidences first, and telling the plane/cylinder SSI to skip regions already known to be shared, is the documented production answer. Truck's shapeops has no such pre-pass, and its open issues on touching and coincident faces (#114, #57) are the symptom. INFERRED.
- The "sum of tolerances" comparison and the "join takes the max" rule are pure functions over immutable values, which fits affine arrays and fork-join. The tolerant-edge storage (per-face p-curves, no 3D curve) matches the STEP pcurve output wonky already produces. INFERRED.
- F32x2 fit: tolerances such as 5e-9 m or 1e-7 mm are far above F32x2's rounding (~1e-15 relative). Tolerance arithmetic can therefore stay in F32x2, while exact predicates (U32 bigints) remain for decisions that must be exact. INFERRED.

## Pointers worth porting or studying

1. The imprint stage order V-V, V-E, E-E, V-F, E-F, F-F with the "F-F need not recompute known-common curves" rule (sec. 4.1). This should be the skeleton of wonky's curved Boolean driver.
2. The E-E result type "points plus coincidence ranges, ignoring ranges containing a vertex" (sec. 4.1c) as the data type for edge overlap.
3. The monotonic tolerance invariant vertex >= edge >= face, and the "sum of tolerances" test (sec. 3.1-3.2), as validator rules in `curved-validate`.
4. The join rule "merged entity takes the max tolerance", with the growth recorded in provenance and rejected if it exceeds the operation's cap. This is wonky's non-silent variant.
5. Sewing as "the Boolean minus F-F/E-F" (sec. 6.1), for STEP import or joining sheets later.
6. The validity conditions of Fig. 4 (connected components of tube intersections must hit a common vertex) as a checkable certificate for the certified print mesh.

### Porting sketch (INFERRED, added 2026-09-23)

Data model. Tolerances are F32x2 lengths in model units. `Tol.accurate` is the default half-resolution value, as in Parasolid.
- `Vertex { point, tol }`
- `Edge { curve3d: Maybe Curve, pcurves: [PCurve], ref_fin: U32, tol }`
  - `curve3d = None` exactly when `tol > accurate`.
  - `ref_fin` selects which p-curve defines the tube, as the paper requires.
- `Face { surface, tol }`

Invariant validator `tol(v) ≥ tol(e) ≥ tol(f)` for all incident pairs. This is a pure fold over the incidence arrays and a GPU-uniform check per incidence.

Comparison predicate `near(a, b) = dist(a, b) ≤ tol(a) + tol(b)`. It should return a three-way result:
- clearly apart
- clearly within
- inside a guard band of the F32x2 error bound. This case escalates to the exact U32 path or fails as `AmbiguousContact`.

Imprint driver (Bend):
- Six stages (V-V, V-E, E-E, V-F, E-F, F-F), each a fork-join map over box-culled candidate pairs.
- Each stage produces an immutable list of `Imprint` events: vertex merge, edge split at t, coincidence range [t0,t1]×[s0,s1], face-face curve.
- A sequential rebuild applies the events before the next stage.
- F-F receives the set of pairs and ranges already known as common and must skip them. This is where Miller-Goldman sec. 4.7 applies: return known conic/conic crossings from the surface data, never recompute them.

Join is a union-find over matched entities with `tol = max`. Every growth `tol_new > tol_old` becomes a `ToleranceGrowth { entity, old, new, cause }` provenance record. If `new` exceeds the operation cap, the whole operation fails with a typed error.

The same skeleton is what Yang 2025's coplanar pre-pass does for planes (2D Boolean first, shared face, merged coincident edges and vertices; see `yang-jia-wang-yang-xin-yan-2025-boolean-operation-for-cad-mo.md`). Jackson generalises it to every dimension.

## Verdict: adapt

Adopt the imprint ordering and the per-topology tolerance invariants. Adapt the growth rule so that every local tolerance increase is explicit, bounded and recorded, as wonky's no-silent-tolerance policy requires. There is no code; the paper is a clear, short specification of the only production-proven way to avoid near-tangent SSI in Booleans.
