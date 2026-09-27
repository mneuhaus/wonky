# OCCT Modeling Data guide (TopoDS: TShape + Location + Orientation)

- Kind: official documentation, cross-checked against implementation. Canonical URL: https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_data.html (redirects to https://occt3d.com/dev/doc/overview/html/occt_user_guides__modeling_data.html). Repository: https://github.com/Open-Cascade-SAS/OCCT.
- Authors/organization: Matra Datavision / Open CASCADE SAS; code examined contains 1993 creation dates and subsequent OCCT copyright notices; ongoing project.
- DOCUMENTED license: LGPL-2.1 with OCCT exception, alternatively commercial licensing. The exception specifically permits object code incorporating header material under chosen terms with prominent attribution; it is NOT a blanket permissive license for translated library implementation. Study architecture and independently implement it; a source-derived Bend translation requires license review before distribution. Sources: https://github.com/Open-Cascade-SAS/OCCT/blob/master/LICENSE_LGPL_21.txt and https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt.
- DOCUMENTED activity, queried 2026-09-24: C++; GitHub size 217226 KB (repository storage metric, not source LOC); 2910 stars, 684 forks; contributors endpoint last page 63 at per_page=1 (63 listed contributors, not a claim about all historical contributors). Latest default-branch commit 3d097a0328e71b826377d4814ab05ec3c3d23871, 2026-08-24T16:30:03Z; repository pushed_at 2026-09-05; latest release V8.0.1, 2026-07-30. Mature production kernel. Sources: https://api.github.com/repos/Open-Cascade-SAS/OCCT, https://api.github.com/repos/Open-Cascade-SAS/OCCT/commits?per_page=1, https://api.github.com/repos/Open-Cascade-SAS/OCCT/contributors?per_page=1, https://github.com/Open-Cascade-SAS/OCCT/releases/tag/V8.0.1. All code observations below use the pinned commit, not a guessed version.

## What it is

DOCUMENTED: a topology container independent of the geometry implementations. TShape stores the underlying entity definition and its child shape uses; Shape is a value-like wrapper containing a reference-counted TShape handle, Location and Orientation. BRep subclasses attach points, curves, surfaces, pcurves and tolerances. This is sharing within a representation, NOT a cross-regeneration persistent naming scheme. Assignment of Shape copies the wrapper and shares its TShape; it does not deep-copy the B-rep. Sources: Modeling Data, sections Abstract Topology / Manipulating shapes and sub-shapes; https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingData/TKBRep/TopoDS/TopoDS_TShape.hxx.

## How it works

DOCUMENTED identity predicates are exactly:

- IsPartner(a,b): same TShape handle; locations and orientations ignored.
- IsSame(a,b): same TShape handle AND equal locations; orientations ignored.
- IsEqual(a,b), also operator==: same TShape, equal locations, equal orientations.

No curve/surface comparison or distance calculation occurs. Geometrically coincident, independently allocated entities need not match any predicate. EmptyCopy creates a new TShape with the same geometry but no children. Source: https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingData/TKBRep/TopoDS/TopoDS_Shape.hxx#L260-L301.

DOCUMENTED: default TopTools_ShapeMapHasher equality uses IsSame, whereas Shape operator== uses IsEqual; the hash combines TShape pointer and location and deliberately omits orientation. Consequently, a map of entities deduplicates opposite-oriented uses. Do not substitute that map for an occurrence/halfedge table. Source: https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingData/TKBRep/TopTools/TopTools_ShapeMapHasher.hxx and TopoDS_Shape.hxx above.

DOCUMENTED: Location is a chain of shared elementary datums and integer powers, with a cached cumulative transformation. Equality compares datum identities/powers in order, NOT approximate matrix equality. Different chains can yield numerically equal transformations while being unequal locations. The guide explicitly illustrates associative chain equality R1*(R2*R3)=(R1*R2)*R3. Location transforms are right-handed rigid frame changes, not a general scaling/reflection channel. Sources: Modeling Data / Shape Location; https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/FoundationClasses/TKMath/TopLoc/TopLoc_Location.lxx#L80-L105; TopoDS_Shape.hxx validateTransformation.

DOCUMENTED: four orientations exist: FORWARD, REVERSED, INTERNAL, EXTERNAL. Reverse exchanges F/R but leaves I/E fixed; Complement exchanges F/R and I/E. Composition is noncommutative outside the F/R subset. A one-bit representation is faithful only for an explicitly restricted manifold boundary-use model, not full TopAbs. Source: https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingData/TKG3d/TopAbs/TopAbs.hxx#L51-L118.

DOCUMENTED implementation detail worth checking before porting: the pinned Compose code indexes its four-by-four table as aTable[Or2][Or1], whereas its displayed comment table labels rows Or1 and columns Or2. These differ for INTERNAL/EXTERNAL combinations. This note records the discrepancy, not a verified kernel defect; no tests were run. Port an independently specified orientation algebra with all 16 input pairs tested, not a copied comment table. Same source.

DOCUMENTED: TShape stores a linked list of child Shapes and mutable flags (Free, Modified, Checked, Orientable, Closed, Infinite, Convex, Locked). Modified(true) clears Checked. Iteration composes child orientation and location with the parent's unless accumulation is disabled. TopExp exploration is not wire-connectivity order; BRepTools_WireExplorer is the guide's recommended ordered traversal. Sources: TopoDS_TShape.hxx above; https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingData/TKBRep/TopoDS/TopoDS_Iterator.cxx; Modeling Data / Wire Explorer.

DOCUMENTED numeric storage: BRep_TVertex stores gp_Pnt, double tolerance and point representations; BRep_TEdge stores double tolerance, curve-representation list and SameParameter / SameRange / Degenerated flags; BRep_TFace stores surface, geometry location, double tolerance and triangulations. Vertex/edge UpdateTolerance takes the maximum of existing and requested tolerance. Sources: https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingData/TKBRep/BRep/BRep_TVertex.hxx, https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingData/TKBRep/BRep/BRep_TEdge.hxx, https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingData/TKBRep/BRep/BRep_TFace.hxx.

## Robustness and guarantees

DOCUMENTED: Precision::Confusion() is 1e-7 in user length units, conventionally tuned for millimetres. It is a geometric policy, not machine epsilon or a universal accuracy guarantee. The same header explicitly separates Computational() at binary64 epsilon (~2.22e-16) from geometric tolerances. Per-entity tolerances can differ. Source: https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/FoundationClasses/TKernel/Precision/Precision.hxx#L125-L196.

INFERRED: tolerances describe accepted inconsistency between geometric representations; they do not make identity equivalence geometric or prove watertightness. Sharing is also not immutability: editing shared geometry/flags can affect all wrappers. For wonky, a rebuilt entity that has the same semantic origin must not be considered the same definition record solely because originId is equal. Source basis: TShape mutators and handle equality above.

## Parallelism and performance

DOCUMENTED: the guide motivates sharing to avoid redundant copies; Shape wrappers are cheap reference values. No quantitative benchmark, multicore claim or GPU result for this architecture is provided. Location equality includes a shared-list fast path, otherwise traverses the datum sequence. Source: TopLoc_Location.lxx and Modeling Data.

INFERRED: immutable indexed definitions plus compact child-use arrays can retain sharing while avoiding reference counting, mutable linked lists and pointer hashes. Independent face checks and entity comparisons fit balanced fork-join; location chains and adjacency fan-out need bounded batches or levelwise processing for uniform GPU work. No performance estimate is claimed. Source basis: the actual container and iterator implementations above.

## Known failures, limitations, war stories

DOCUMENTED issue report, not independently reproduced: OCCT #1363 reports STEP export/import changing wire order, transferring a tolerance-covered invalidity to a neighbouring face, and leaving a small gap with bad tessellation; originally OCCT 7.7.1, migrated ticket still open when checked. This is direct evidence against persistent names based on traversal ordinal or presumed stable STEP ordering; not evidence that all current releases reproduce it. Source: https://github.com/Open-Cascade-SAS/OCCT/issues/1363.

INFERRED: independently importing or rebuilding the same surface will usually allocate a new TShape, so IsPartner cannot resolve history. Two different assembly occurrences at the same location may satisfy IsSame if they share the same definition: an occurrence path is still required. A seam can use one edge more than once on the same face; an orientation bit alone is not a universal occurrence identifier. Basis: identity predicates and shared-use model in the guide.

## Relevance for wonky

INFERRED implementation proposal, derived from the sources above:

1. Separate EntityDefinition{definitionId, kind, geometryRef, childUseRange, toleranceRef} from EntityUse{definitionId, transformRef, orientation, parentUseId, localUseId}. Keep origin/lineage records separately. IDs and offsets are U32; overflow must fail explicitly.
2. Expose named predicates sameDefinition, samePlacedDefinition, sameOrientedDefinition and sameOccurrence rather than one overloaded equality. A further provenance-based relation is needed across revisions. Neither originId nor instanceId is a literal replacement for a transient TShape address.
3. Store canonical symbolic transform chains, optionally cached F32x2 matrices. Do not approximate-equal matrices to decide identity. Geometry equivalence belongs in a separate, tolerance-bearing query.
4. Publish immutable revision roots with structural sharing. Recompute validation certificates for changed records rather than mutating shared Checked flags. Build reverse incidence as sorted (childDefinition,parentUse) records plus prefix ranges.
5. Keep tolerance values explicit and typed (length, parameter, angle). F32x2 has sufficient resolution for 1e-7 at ordinary part scales, but its ~48-bit mantissa is below binary64 and its exponent range remains F32; copying binary64 epsilon tests or huge-coordinate assumptions is unsafe. Normalize bounded work regions and reject overflow/uncertified comparisons; exact sign decisions can use U32 limbs.

This supports Boolean result sharing, face/edge provenance, instancing, seam-aware pcurves, revision diff and LLM inspection. It does not solve SSI, fillets, persistent naming or general Boolean robustness by itself.

## Pointers worth porting or studying

- Modeling Data: Shape Location; Manipulating shapes and sub-shapes; copy example; Wire Explorer.
- TopoDS_Shape.hxx: IsPartner/IsSame/IsEqual, EmptyCopy, transform validation and std::hash specialization.
- TopLoc_Location.lxx: IsEqual; retain symbolic equality, not address identity across serializations.
- TopoDS_Iterator.cxx: cumulative transforms/orientations. TopTools_ShapeMapHasher.hxx: occurrence versus entity deduplication.
- TopAbs.hxx: explicitly test the composition convention and INTERNAL/EXTERNAL states.
- BRep_TVertex/TEdge/TFace.hxx and Precision.hxx: separate entity tolerance, numeric precision and cached representation. All pinned URLs are above.

## Verdict: adapt

Adopt the separation of definition, placement and use, but independently re-express it as immutable U32-indexed records with explicit occurrence paths and lineage. Reject the tempting shortcuts 'TShape equals persistent origin', 'orientation always one bit', and '1e-7 means F32x2 is a drop-in binary64 replacement'. No production files, builds or tests were touched.

Sources:
- [OCCT Modeling Data guide](https://occt3d.com/dev/doc/overview/html/occt_user_guides__modeling_data.html)
- [Pinned OCCT source](https://github.com/Open-Cascade-SAS/OCCT/tree/3d097a0328e71b826377d4814ab05ec3c3d23871)
- [STEP wire-order issue](https://github.com/Open-Cascade-SAS/OCCT/issues/1363)

