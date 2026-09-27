# BREP.io

- Kind: browser CAD application plus JS "kernel" (TypeScript, with a C++ `manifold-plus` extension compiled to WASM together with manifold-3d).
- URLs:
  - Canonical: https://github.com/mmiscool/BREP.io
  - Site: https://brep.io
  - npm: https://www.npmjs.com/package/brep-io-kernel
- Shallow clone: `tmp/research/brep-io/` (head `22f1c0db`, 2026-09-12).
- Authors: Mike (`mmiscool`, Autodrop3d LLC), sole contributor (923 commits). Created 2025-09-07 (public), last push 2026-09-12. The same author wrote `aiCoder` (an LLM coding tool); heavy LLM assistance is INFERRED.
- License history, the key point for porting:
  - 2025-09 to 2026-09-12: a custom "MIT plus mandatory copyright assignment of all modifications to Autodrop3d" license. It was not OSI; see the discussion in issue #3 (https://github.com/mmiscool/BREP.io/issues/3).
  - Commit `22f1c0db` (2026-09-12, "Changing licence to MIT before archiving repo") replaced it with plain MIT (`LICENSE.md`). GitHub still reports `NOASSERTION`.
  - Consequence: study and port only from the MIT head `22f1c0db` or later, keeping the copyright notice. Older snapshots carry the assignment clause.
- Status (`gh api`, 2026-09-22, re-checked 2026-09-24): 256 stars, 19 forks, 5 open issues (new UI bug #19 on 2026-09-23), no releases (npm package only). Last code commit 2026-07-15 ("Enhanceing CAM workbench"); the last commit overall is the license change `22f1c0db` on 2026-09-12, whose message body reads "Changing licence to MIT before archiving repo". Not formally archived as of 2026-09-24. About 221k lines of TypeScript in `src/` plus 14.5k lines of C++ in `manifold-plus/`.

## What it is
A feature-based browser CAD with modeling, sketch, sheet metal, assemblies, PMI, CAM, wire harness and more, whose "B-rep" is a triangle mesh with topology labels. `Solid` (`src/BREP/BetterSolid.ts`) stores MeshGL arrays (`vertProperties`, `triVerts`) plus a per-triangle `faceID`. Face names map to IDs reserved via `Manifold.reserveIDs()`, so labels survive manifold-3d Booleans. Edges are derived, not stored: an edge exists exactly where adjacent triangles carry different face labels (`docs/developer/kernel/topological-face-tracking.md`). Analytic intent is side-car metadata, e.g. `{type: 'cylindrical', radius, height, axis, center}` on faces (`cylindrical-face-radius-embedding.md`), used for dimensions and PMI, not for geometry.

## How it works
Face naming spec (DOCUMENTED, `topological-face-tracking.md`, a normative MUST/SHOULD document):
- Every triangle belongs to exactly one face.
- An edge is the boundary between exactly two faces. Each connected boundary chain between the same pair is a separate boundary component.
- Retessellating or trimming a face SHOULD preserve its name; a genuinely new region MUST get a new name.
- This is a clean, language-agnostic contract for label-based topology on meshes.

Boolean (DOCUMENTED, `src/BREP/applyBooleanOperation.ts`, `SolidMethods/booleanOps.ts`, `solidOverlapDiagnosticsCore.ts`):
- manifold-3d CSG propagates labels, and a face-ID map is merged from both operands.
- Before the Boolean, an overlap-conditioning plan (`buildBooleanOverlapConditioningPlan`) detects coplanar overlapping face pairs:
  - defaults: normal tolerance 1 degree, plane distance 1e-4, overlap area 1e-6;
  - it physically pushes the tool's faces by `max(4*1e-4, 1e-5*scale)` model units, with the sign chosen by a probe-vote (SUBTRACT always pushes outward).
- After the Boolean: tiny faces (area < 0.001) and edge points closer than 1e-4 are cleaned.
- INFERRED: manifold's symbolic perturbation already makes coplanar cases topologically consistent. The physical nudge exists to steer which way coplanar faces resolve (no zero-thickness remnants, labels on the expected side). It silently moves geometry and is not reported.

Fillet (DOCUMENTED, `docs/developer/kernel/fillet-process.md` flowchart, `src/BREP/SolidMethods/fillet.ts:2860-3216`, `manifold-plus/fillet_segment_builder.cpp` 7.4k lines): per selected edge polyline,
1. AUTO direction per edge: signed dihedral first, then inside/outside sample probing. INSET means subtract, OUTSET means union. There are "fallback" and "ambiguous" counts when the classifier is not confident.
2. Centerline. For each sample, project onto the two host face meshes, get local normals, build a tangent frame and bisector, and estimate the maximum allowed radius from face projection ranges.
   - Solve inset and outset centre candidates from offset planes, score them against the projected tangency, and fall back to the bisector or average normal.
   - "Clamp pathological center distances." This yields rails: centerline, tangentA, tangentB, edge.
3. Helper bodies:
   - a wedge (a triangle prism between the edge rail and the two tangency rails; open edges get end caps pushed outward by `nudgeFaceDistance = 1e-4`);
   - a tube (a circle of `resolution = 32` segments swept along the centerline);
   - `wedge - tube` gives the per-edge fillet tool. `inflate = 0.1` offsets the tangency rails outward "to avoid coplanar leftovers".
   - The inflate geometry (DOCUMENTED, `manifold-plus/fillet_segment_builder.cpp:4624-4642`, `InflateChamferRails` `:4735-4770`). The edge rail point moves by `inflate * (n_a + n_b) / (1 + n_a.n_b)`, which puts it at signed distance exactly `inflate` outside both host planes (because `(n_a + n_b).n_a / (1 + n_a.n_b) = 1`). Each tangency rail point moves within the wedge's bevel plane along the host normal's in-plane component `d = n - (p.n)p`, scaled by `inflate/|d|^2`, so its height above its host face also grows by exactly `inflate`. `inflate` is an absolute model-unit constant (default 0.1, i.e. 0.1 mm in mm models), not scaled to radius or model size. It is skipped when `|inflate| <= 1e-12`.
4. Corner bridges where two filleted edges share a non-tangent endpoint: a wedge hull minus the adjacent tubes, minus a bridge tube. Rejected if the centerlines cross or the tube gap is too small.
5. Combine: union all INSET tools and subtract them from the target; union all OUTSET tools into the target.
6. Post-processing heuristics, each with its own epsilon:
   - relabel faces by adjacency;
   - reverse the end-cap nudge;
   - merge coplanar end caps (distance tolerance `max(0.008, min(0.03, 2*maxDist))`, planarity `0.03..0.12`);
   - collapse the wedge side walls into the round face; reassign sliver triangles;
   - clean up single-neighbor islands and tiny face islands (area 0.01);
   - a final `simplify(0.0004)`.
- Failure contract (DOCUMENTED): if the native build throws, it "Log[s] native failure and return[s] unchanged clone" (flowchart node S10A, `fillet.ts:2964-2970`). The same happens for no resolved edges or a missing snapshot. A failed fillet is therefore a silent no-op, apart from a console message.

Mesh import (DOCUMENTED, `src/BREP/meshToBrep.ts`, `MeshRepairer.ts`):
- `MeshToBrep(geometry, faceDeflectionAngle = 30 deg, weldTolerance = 1e-5)` groups neighbouring triangles into faces when their normals deviate less than the angle. Optionally, large planar regions (at least 5% of area, 1 degree normal tolerance) are extracted first.
- `MeshRepairer.repairAll({weldEps = 5e-4, lineEps = 5e-4, gridCell = 0.01})`: grid weld, T-junction fixing by projecting points onto segments within `lineEps`, overlapping-triangle removal on a `posEps = 1e-6` grid, and a signed-volume flip.

Vertex identity: `BetterSolid` uniques vertices "by exact coordinate match (string key of x,y,z)"; tolerance welding is left to the author.

## Robustness and guarantees
- Boolean robustness is manifold-3d's: exact topology decisions via symbolic perturbation on f64 or f32 inputs. The wrapper adds heuristic conditioning, with the nudges above.
- Nothing about fillets is guaranteed. They are chords of radius-r tubes (32 segments) with inflated tangency; the geometric error against a true rolling-ball blend is not computed or reported (INFERRED from code). `simplify(0.0004)` changes geometry again.
- Epsilons are absolute model-unit constants scattered through the code (1e-4, 5e-4, 1e-5, 0.001, 0.01, 0.1, 0.0004 ...), sometimes scaled by bounding-box diagonal (`deriveSolidToleranceFromVerts`: `max(1e-5, diag*1e-6)`). There is no declared tolerance model.

## Parallelism and performance
- No published numbers. Single-threaded JS plus WASM manifold-3d (manifold itself can use TBB natively, but not in this browser build; INFERRED).

## Known failures, limitations, war stories
- Issue #12: a non-manifold error when sweeping multi-part sketches along a helix. Issue #4: STEP export requested; only faceted STEP (`toSTEP`) exists.
- The fillet post-processing pipeline is about 2,800 lines of label and vertex surgery (`collapseFilletSideWallFaces`, `reassignTinyFilletSidewallSliverTriangles`, `mergeTinyFilletHostRemnantsIntoRoundFaces`, ...). It is evidence of how much cleanup "fillet = Boolean with a helper body" needs on a tagged mesh when the helper is not exact.
- Test suite: dozens of `test_generated_history_<timestamp>.ts` regression replays, plus fillet corner-bridge and degenerate-segment tests (`src/tests/`). They check volumes via `solidVolumeExpectations.ts`; there is no robustness metric.

## Relevance for wonky
- Positive: the label-propagating mesh Boolean is exactly the topology layer of wonky's leading hybrid (a robust mesh Boolean decides topology, analytic SSI recovers the exact B-rep). BREP.io shows the first half working at app scale:
  - per-triangle face IDs survive CSG;
  - edges are derived from label changes;
  - a normative naming spec exists (worth adapting as a test contract for wonky's identity layer).
- Positive: "fillet as Boolean with a swept helper body" (wedge minus tube, INSET subtract or OUTSET union, corner bridges) is a practical fallback-free way to get fillets onto a tagged mesh.
  - Wonky could do the same with exact analytic helper bodies: a plane-plane fillet tool is exactly a prism minus a cylinder. The hybrid's analytic recovery would then label the result face as a cylinder with the fillet's provenance.
  - That keeps fillets inside the one Boolean pipeline instead of a separate blend engine (INFERRED design option).
  - The catch (INFERRED from the geometry): a true fillet cylinder is tangent (G1) to both host faces along the tangency lines. "Target minus (wedge minus tube)" therefore always contains a tangential surface contact, the hardest Boolean degeneracy. Inflating the wedge removes the coplanar wedge/host faces, but the tube-to-host tangency stays. On a 32-gon tube it turns into polygon vertices grazing the plane, which is where BREP.io's slivers and its roughly 2,800 lines of sliver cleanup come from. If wonky uses helper bodies, the tangency edges must come from the construction (the known rolling-ball contact lines), not from intersecting the tube with the host faces. The Boolean should only have to resolve the transversal end caps.
- Negative and instructive:
  - Physical nudges (coplanar conditioning, end-cap nudge, inflate 0.1, simplify 0.0004) silently change geometry. They violate wonky's "approximations need explicit tolerances" rule.
  - The fillet's failure mode is a silent no-op (unchanged clone). This violates "unsupported must fail explicitly".
  - Wonky must never nudge. Coplanar handling must come from symbolic perturbation plus analytic recovery that recognises coincident carriers.
- Bend fit: the data model (flat arrays of vertices, triangle indices and face IDs) maps well onto affine U32/F32 arrays. The heuristic post-passes (adjacency walks with hash maps and string keys) do not, and should not be ported.
- FDM relevance: the 32-segment tube resolution is fine for printing but not for an exact B-rep. Wonky's certified-deviation print mesh is strictly better.

## Pointers worth porting or studying
- `docs/developer/kernel/topological-face-tracking.md` (normative face and edge naming spec; adapt as wonky test invariants).
- `docs/developer/kernel/fillet-process.md` (full fillet pipeline flowchart).
- `src/BREP/BetterSolid.ts:1-80` (label-propagation design notes), `src/BREP/SolidMethods/booleanOps.ts:300-460` (face-ID remapping after CSG).
- `src/BREP/solidOverlapDiagnosticsCore.ts:552-640` (conditioning nudge; a counter-example).
- `src/BREP/SolidMethods/fillet.ts:2860-3216` (coordination and failure-as-clone; a counter-example).
- `manifold-plus/fillet_segment_builder.cpp` (centerline and rail solve, wedge/tube construction, corner bridge; `ShiftEdgePoint` and `TranslatePointWithinPlane` at `:4624-4642` for the exact-distance inflate formulas).
- `src/BREP/meshToBrep.ts`, `src/BREP/MeshRepairer.ts` (normal-deflection face grouping; weld and T-junction epsilons).

## Verdict: learn-from
BREP.io confirms that a label-carrying robust mesh Boolean is a workable topology backbone, and that fillets can be expressed as Booleans with helper bodies. Its naming spec is worth adapting. Everything around the Boolean is heuristic, unreported geometric surgery:
- nudges, inflation, simplify and sliver reassignment;
- fillet failures that silently return the input.

Both of these are exactly what wonky's rules forbid. MIT at head makes porting legal, but the code is not worth porting beyond the naming spec and the helper-body idea.
