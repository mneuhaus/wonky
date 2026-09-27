# CGAL Polygon Mesh Processing: corefinement Booleans (the input/output contract)

- Kind: C++ header-only library (package plus user manual). This note concentrates on the **documented and enforced preconditions** and the failure contract. The algorithm internals (exact nodes, patch classification, snap rounding) are covered in depth in `cgal-polygon-mesh-processing-boolean-operations-separate-pac.md`; read that one for porting detail.
- Canonical URL: https://doc.cgal.org/latest/Polygon_mesh_processing/index.html. Since CGAL 6.2 the Boolean part lives in its own package: https://doc.cgal.org/latest/PMP_Boolean_operations/index.html
- Other URLs:
  - Source: https://github.com/CGAL/cgal/tree/main/PMP_Boolean_operations. Sparse shallow clone at `tmp/research/cgal-sparse`, HEAD `4abd208f` (2026-09-21).
  - Manual source read: `tmp/research/cgal-sparse/PMP_Boolean_operations/doc/PMP_Boolean_operations/PMP_Boolean_operations.txt`.
  - Preconditions in `include/CGAL/Polygon_mesh_processing/corefinement.h`. `does_bound_a_volume` lives in `PMP_Mesh_repair/include/CGAL/Polygon_mesh_processing/orientation.h` (fetched from GitHub main).
  - OBB runner: `tmp/research/open-boolean-benchmark-boolean-benchmark-runners/cgal/6.1.1/corefine/epec/`.
- Authors/organization, year(s): Sébastien Loriot (corefinement, CGAL 4.10, 2017), Léo Valque (snap rounding, kernels, 2025), Ilker O. Yaz; GeometryFactory. The package was split out of PMP in CGAL 6.2 (June 2026). DOCUMENTED (manual "Implementation History").
- License: every header is `GPL-3.0-or-later OR LicenseRef-Commercial`; `package_info/PMP_Boolean_operations/license.txt` says "GPL (v3 or later)". A commercial license is available from GeometryFactory. DOCUMENTED. Porting implication: any transliteration makes wonky a GPL derivative, so code is study-only. The contract (what is required, what is refused) is a design idea and is free to re-derive. INFERRED.
- Status and activity (DOCUMENTED, `gh api` 2026-09-23):
  - CGAL/cgal: 6,054 stars, 1,595 forks, 691 open issues, last push 2026-09-21.
  - Releases v6.2 (2026-06-11), v6.2.1 and v6.1.3 (2026-09-04).
  - Production quality. Used by OpenSCAD's former fast-csg path, compas_cgal, and many research pipelines.
  - Re-checked 2026-09-24: 6,054 stars, last push 2026-09-21. #9497 open (last activity 2026-09-22), PR #9363 (Booleans on triangle soups) open, PR #7994 (vertex snapping) open, last updated 2025-09-18, #6363 open. #9154 closed 2025-12-12, #9455 closed 2026-06-01. DOCUMENTED (`gh api repos/CGAL/cgal/issues/<n>`).

## What it is

`corefine_and_compute_union / _intersection / _difference` and `corefine_and_compute_boolean_operations` (all four at once, sharing one corefinement). They compute regularized Booleans of **volumes bounded by closed, manifold, self-intersection-free triangle meshes**. The two meshes are refined until their intersection polylines are edges of both, patches are classified, and the result is assembled. The same core serves `clip`, `split`, `intersection_polylines`, `autorefine_triangle_soup`, slicing, and mesh kernels. DOCUMENTED (manual).

## How it works

Summary only; details in the sibling note.

- Broad phase: `Box_intersection_d` on edge boxes vs face boxes.
- Narrow phase: exact segment–triangle classification. A new node is always "plane of an input triangle ∩ line of an input edge", computed in EPECK and forced exact when the interval is too wide.
- Every intersected face gets an exact 2D CDT.
- Patches (components bounded by intersection edges) are classified **once per patch** from the cyclic order of the 4 faces around an intersection edge. Isolated patches use one exact point-in-mesh query.
- Per-operation bitsets select and orient patches.
- Output coordinates are the double rounding of exact nodes, unless the kernel has exact constructions (EPECK), in which case no rounding happens.

### The contract, clause by clause

| Clause | Source | Checked? |
|---|---|---|
| Inputs are triangle meshes | `CGAL_precondition(is_triangle_mesh(tm))`, `intersection_impl.h:1700` | debug builds only (`CGAL_precondition`) |
| `!does_self_intersect(tm1)`, `!does_self_intersect(tm2)` | `\pre` in `corefinement.h:163-164` | **not checked**. Opt-in `throw_on_self_intersection` checks only "the set of triangles close to the intersection of tm1 and tm2" and throws `Corefinement::Self_intersection_exception` |
| `does_bound_a_volume(tm1)`, `does_bound_a_volume(tm2)` | `\pre` in `corefinement.h:165-166` | **not checked** by the Boolean |
| `does_bound_a_volume` itself requires `is_closed(tm)` and no self-intersections | `orientation.h`: `@pre is_closed(tm)`, "@attention if tm is self-intersecting the behavior of this function is undefined" | `CGAL_precondition` (debug) for closedness |
| Output must be boundable by a manifold mesh: "no region of zero thickness"; "the intersection with an infinitesimally small ball centered at any point of the output volume must be a topological ball"; "not possible to compute the union of two cubes that are disjoint but share an edge" | manual, "Input and Output Requirements" | **checked**: per-operation `false` in the returned `std::array<bool,4>` |
| In-place output with an infeasible operation leaves the input "still corefined" | manual; `@return` doc of `corefine_and_compute_boolean_operations` | side effect |
| Coplanar triangles get identical triangulations in both corefined meshes, and all their edges are reported as intersection edges | manual | guaranteed |
| `do_not_modify` on one mesh lifts the no-self-intersection requirement on the **other** mesh (`corefine()` only) | `corefinement.h:746+` | option |

**"Bounds a volume" (manual, DOCUMENTED).**
- Each connected component splits space into a positive side (sees its faces counter-clockwise) and a negative side.
- The mesh bounds a volume if every subspace lies on the same side (positive or negative) of all its incident components.
- The volume is the union of the subspaces on negative sides.
- Nested shells are therefore allowed if they are oriented consistently. Inside-out closed inputs are detected (`is_outward_oriented`) and treated as complements.

**Kernel choice decides which guarantee you get (manual, DOCUMENTED).**
- *Exact predicates, inexact constructions (EPICK).* "Terminate without crashing"; "the graph structure is then always guaranteed to have the right topology as exact constructions are used internally"; but the rounded embedding "may feature self-intersections".
- *EPECK.* Embedding exact; "for consecutive operations, it is recommended to use a kernel with exact predicates and exact constructions".
- *Alternative.* Keep EPECK points in a vertex property map next to a double mesh (`corefinement_consecutive_bool_op.cpp`).

**What to do when the output would be non-manifold (manual, DOCUMENTED).**
- Use `Nef_polyhedron_3`.
- Or use `Corefinement::Non_manifold_output_visitor`, which yields a **triangle soup**. As a soup it cannot feed the next corefinement (Loriot, https://github.com/CGAL/cgal/issues/9497).
- Open PR https://github.com/CGAL/cgal/pull/9363 (opened 2026-03-06, still open 2026-09-17) adds "Boolean operations on triangle soups", which "handles non-manifold situations" and can chain.

## Robustness and guarantees

- **Guaranteed under the preconditions:** correct combinatorics with EPICK, exact embedding with EPECK. Coplanar consistency. An explicit per-operation refusal of non-manifold results. DOCUMENTED.
- **Not guaranteed:** anything when a precondition is violated. The core self-intersection and volume preconditions are never verified by the Boolean, so violating them is undefined behaviour in practice:
  - a crash, an assertion `oxz_pqr != COLLINEAR` in #6481, or wrong output;
  - validated only if the caller runs `does_self_intersect` and `does_bound_a_volume` first, and those have their own preconditions (closed, triangle, non-self-intersecting).
  - DOCUMENTED (code, issues).
- **Tolerance model:** none. There is no epsilon anywhere in the contract. Near-degenerate double input (coordinates like `-80.000000000000043` from transform chains) is taken literally. A 1e-14 sliver that creates a non-manifold contact makes the difference return `false`. Loriot: "there is no magic way to resolve these tolerance issues" (https://github.com/CGAL/cgal/issues/9497, opened 2026-05-26, still active 2026-09-22). The proposed fix is a snapping pre-process (PR https://github.com/CGAL/cgal/pull/7994, open since 2024-01, "still missing some steps"). DOCUMENTED.
- **Determinism:** output ordering differs between debug and release builds (https://github.com/CGAL/cgal/issues/6363, open). DOCUMENTED.

## Parallelism and performance

- **Corefinement itself is sequential.** Parallelism exists only in self-intersection and autorefinement tests and in snap rounding (`Parallel_tag`, TBB), plus user-level parallel Boolean trees (the `corefinement_parallel_union_meshes.cpp` example). DOCUMENTED (code).
- **Vendor-run iterated CSG** (Solidean blog, OBB runner with EPECK `Surface_mesh` kept **exact across SSA steps**; ops are binary only, and a `false` return is mapped to `invalid_input`; `runner.yaml`, `main.cpp`):
  - 9-op sphere/torus chain: 507 ms, correct;
  - terrain carve with exactly coplanar seams: 11.0 s, canonical (one of 4 engines of 17);
  - 1,999-op cube grid: **declined at op 5**, the first edge-only contact, i.e. a non-manifold intermediate;
  - dome carve: 3.3 s at 100 steps, 157 s at 1,000, ~44 min at 5,000.
  - DOCUMENTED in `solidean-iterated-csg-benchmark-series-2026.md`, HEARSAY until reproduced.
- **OBB self-rating** for CGAL corefine (EPEC): E R I (exact, robust, iterated), not S (self-intersecting input). DOCUMENTED (OBB README).

## Known failures, limitations, war stories

- **Non-manifold intermediates end chains.** Cube grid op 5 (above). Also #9497: three wedge cutters with faces at exactly Z = 3303.0 against a box; `boolean_chain` returns empty, and shifting the cutters by 0.1 makes it succeed. DOCUMENTED.
- **Chained EPICK operations crash where EPECK works:** https://github.com/CGAL/cgal/issues/9455, #6481, #9282. DOCUMENTED (see the sibling note for details).
- **Rounded EPICK output self-intersects** even on valid input: https://github.com/CGAL/cgal/issues/9154. DOCUMENTED.
- **Autorefinement handles at most triple-plane nodes;** code TODO in `intersection_impl.h` around line 1257. DOCUMENTED.
- **Expected-result catalogue:** `test/PMP_Boolean_operations/test_corefinement_bool_op.cmd` lists input pairs with the expected feasibility flag of each operation (tangent stars, `cube_on_cube_edge`, `cube_on_cube_corner`, `coplanar_with_cube*`, …). DOCUMENTED.

## Relevance for wonky

The value here is the **contract design**, not the code (INFERRED throughout).

1. **Write the preconditions down, and check them.** CGAL's split into PRE (manifold, closed, bounds a volume, no self-intersections), POST (manifold result) and a per-operation feasibility flag is the right shape. Its weakness is that the PREs are unchecked, so violations become crashes. Wonky's rule "unsupported cases must fail explicitly" means:
   - a **cheap exact validator** runs before every Boolean on imported meshes: closed plus manifold by sorting edge keys, orientation and nesting via one exact ray per component. Wonky's own tessellations can carry a proof-by-construction flag instead;
   - a typed result: `Unresolved{reason: NonManifoldResult{op, edge ids} | SelfIntersectingInput{tri pair} | NotClosed{edge} | ...}` instead of a bare `false`;
   - **no mutation of inputs** on failure. This is automatic in Bend, which has no in-place output.
2. **Decide the non-manifold policy explicitly.** For FDM, edge-only and vertex-only contacts are real: a checkerboard, a lattice, parts touching in an assembly print. Two consistent options:
   - (a) CGAL-style refusal with a typed error. The user then adds a clearance, which is often the right FDM answer anyway, since a zero-thickness joint prints as a weld or a crack;
   - (b) represent non-manifold solids, as Zhou 2016 and Solidean do, and let the slicer export step split edge contacts deterministically.

   Either way the choice must be visible in the result, not silent.
3. **Exactness across chained operations.** CGAL's own manual recommends exact constructions across steps, and the OBB runner that keeps EPECK across steps is exactly the configuration that survives terrain carve. For wonky: keep symbolic or exact nodes (plane-based in exact-plane, or tuple provenance in corefine) across the CSG tree. Never round between tree levels without validation.
4. **Coplanar consistency guarantee.** "Identical triangulations in both corefined meshes" is precisely what prototype 4 (analytic recovery) needs, so a shared planar face region gets one consistent split with both operands' face tags.
5. **Tolerance-free contract plus explicit snapping.** CGAL's #9497 shows that CAD-style double transforms produce 1e-14 near-coincidences, which an exact kernel then treats as real slivers or non-manifold contacts. Snapping is the missing step CGAL is still working on (PR #7994, open since 2024-01). An earlier version of this note suggested an integer grid would keep rotated coplanar planes coincident "by construction". The bake-off showed that is wrong: rotating grid points leaves the grid, and rounding each operand separately (to F32x2 or to exact-plane's 2^-24 mm grid) makes analytically coplanar faces differ by about 1e-14 mm. See item 6 for what wonky actually did.
6. **Update 2026-09-24: wonky implemented this contract** (DOCUMENTED from `docs/bakeoff.md`, `docs/hybrid-boolean-plan.md`, `docs/proto-corefine.md`; comparison with CGAL INFERRED).
   - **Non-manifold policy: option (a), refusal.** The bake-off corpus scores `cylinder-tangent-box-face` and `hole-tangent-edge` as `non-manifold-contact`: the expected answer is `unresolved <reason>`, and a mesh answer is never a pass. This is CGAL's "the intersection with an infinitesimally small ball … must be a topological ball" requirement, turned into a named refusal instead of a bare `false`.
   - **Postconditions checked at run time,** which CGAL leaves to the caller. `kernel/hybrid/corefine/gate.bend` (plan step 1) runs on every Boolean's result, intermediate CSG results included: a vertex-link check ("non-manifold contact (point)", which catches point contacts that pass edge pairing) and an exact self-intersection gate ("result self-intersects (below 2^-36*scale)"). Measured: 10 point contacts and 4 rotated coplanar invalid `ok` meshes became named refusals; corpus results byte-identical; +10.6-10.8 % cpu18 compute. recover runs its own vertex-link check on its input (defence in depth).
   - **Snapping, done on the analytic carriers, not on mesh vertices.** Carrier unification (`kernel/hybrid/unify.bend`, `docs/proto-corefine.md` step 10) puts two plane tags of different leaves in one class when normals agree within 2^-44 and offsets within 2^-44·scale. The tolerance is derived from the rounding bound of one rigid transform on the F32x2 wire (at most about 2^-46.4·scale; measured at most 2^-50.2·scale) and sits a factor of 5 below the thinnest real skin in the census (2^-41.7·scale). Exactly axis-aligned carriers are never unified. No vertex moves; unified classes only turn near-ties into exact ties for the symbolic perturbation, and refusals state "coplanar plane carriers unified within 2^-44*scale (N classes)". Two verifier rounds found the first choices too loose (2^-40·scale merged real 1e-11 mm skins, and axis-aligned carriers had been merged), which is the concrete version of Loriot's "there is no magic way to resolve these tolerance issues".
   - INFERRED lesson for anyone porting CGAL's contract: the snap belongs where the geometry is still analytic (the face table), with a tolerance derived from a stated rounding model, and it must be reported. CGAL cannot do this because its input is already a mesh.

## Pointers worth porting or studying

- Manual source `PMP_Boolean_operations.txt`: the "Definitions" ("bounds a volume") and "Input and Output Requirements" sections, and "Kernel Choice and Output Validity".
- `corefinement.h`: the doc blocks of `corefine_and_compute_boolean_operations` (preconditions, `@return` semantics, `throw_on_self_intersection`, `do_not_modify`).
- `PMP_Mesh_repair/.../orientation.h`: `does_bound_a_volume`, implemented via `volume_connected_components(..., do_orientation_tests(true))`, and `orient_to_bound_a_volume`. This is the nesting and orientation logic worth re-deriving for wonky's validator.
- `test/PMP_Boolean_operations/test_corefinement_bool_op.cmd` plus `data-coref/`: expected-feasibility test matrix. It is GPL data, so use it locally only.
- `examples/PMP_Boolean_operations/corefinement_mesh_non_manifold_intersection.cpp` and `corefinement_consecutive_bool_op.cpp`: the two escape hatches.

## Verdict: learn-from

Study the documented input/output contract and the per-operation refusal semantics, then re-derive them as wonky's checked preconditions and typed errors. Do not port. The code is GPL. The EPECK lazy-rational model does not fit Bend. The core preconditions are documented but not enforced, and the manifold-only output requirement is exactly what breaks iterated FDM-style CSG (cube grid op 5, #9497). The deep technical note for porting ideas is `cgal-polygon-mesh-processing-boolean-operations-separate-pac.md`. As of 2026-09-24 wonky's hybrid follows the CGAL contract in the checked form this note recommended (named refusal of non-manifold contact, run-time vertex-link and exact self-intersection gate) and has the snapping step CGAL still lacks, done on analytic carriers with a derived, reported tolerance. What remains open for wonky is the other half of the trade-off CGAL documents: FDM parts that legitimately touch along an edge (lattices, checkerboards) are refused rather than represented, so the refusal text must tell the user to add clearance.
