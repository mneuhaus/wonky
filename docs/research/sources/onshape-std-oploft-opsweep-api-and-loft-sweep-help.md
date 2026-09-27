# Onshape FeatureScript `opLoft` / `opSweep` / `opRuledSurface` API (std 3083) and the Loft and Sweep help pages

- Kind: official library source + official documentation.
  - std mirror (MIT): `wonky-kernel/tmp/research/onshape-std-3083/repo/` — `geomOperations.fs` l.1092–1131 (`opLoft` doc), l.1776–1797 (`opSweep`), l.1525 (`opRuledSurface`), `loft.fs` (the Loft feature, 1251 lines), `lofttopology.gen.fs`, `sweep.fs` (630 lines), `sweeptwisttype.gen.fs`, `ruledsurfacetype.gen.fs`, `ruledsurfacecornertype.gen.fs`.
  - Help: https://cad.onshape.com/help/Content/loft.htm , https://cad.onshape.com/help/Content/sweep.htm (both fetched 2026-09-24). `ruledsurface.htm` did not return feature content (fetch landed on the help home page).
- Authors/organization: PTC/Onshape, 2013–present. std version 3083 (files carry `FeatureScript 2985` headers on generated enums).
- License: std library MIT (`LICENSE` in the mirror). The `@opLoft` builtin itself is closed (Parasolid behind it). Porting the FS-level logic (parameter handling, error enums, connection bookkeeping) is fine with attribution; the geometry must be re-derived.
- Status: current Onshape; the mirror is the one wonky's interpreter already targets.

## What it is
The exact contract wonky's FS interpreter must honour for `opLoft` and `opSweep`. The FS layer is thin: `loft.fs` collects profile queries, guides, derivative conditions, connections and spine, then calls the builtin `@opLoft`.

## How it works (DOCUMENTED from the source/doc strings)
- **`opLoft(definition)` fields:** `profileSubqueries` (ordered; for solids: sheet bodies, faces or vertices; for surfaces also wires/edges), `guideSubqueries`, `connections` (array of maps: `connectionEntities` = one vertex or edge per profile, `connectionEdges`, `connectionEdgeParameters` on those edges), `connectionsArcLengthParameterization` (default false, "for better performance"), `makePeriodic`, `bodyType` SOLID/SURFACE, `trimGuidesByProfiles`, `trimProfiles`, `derivativeInfo` (per profile index: `vector`, `magnitude`, `tangentToPlane`, `matchTangent`, `matchCurvature`, `adjacentFaces`), `loftTopology` (`MINIMAL` default: "Minimal number of faces created"; `COLUMNS`: "One face is created for each matching set of profile segments"; `GRID`: "Faces created for COLUMNS option are split at each profile"), `addSections` + `spine` + `sectionCount` (1…50, default 5 in the feature UI).
- **Loft feature (`loft.fs`)** maps UI end conditions (`NORMAL_TO_PROFILE`, `TANGENT_TO_PROFILE`, `MATCH_TANGENT`, `MATCH_CURVATURE`, `NORMAL_DIRECTION`, `TANGENT_DIRECTION`) to `derivativeInfo`; with `matchConnections` false it passes `connections = []`. Errors raised in FS: `LOFT_SELECT_PROFILES`, `LOFT_CONNECTION_MATCHING` (edge/parameter count mismatch), `LOFT_SPINE_TOO_MANY_GUIDES` (>3 guides with spine), `LOFT_NO_PLANE_FOR_START_CLAMP` etc.
- **`opSweep`:** `profiles` (edges and faces), `path` (edges in any order, must be connected), `keepProfileOrientation` (default false: "the profile rotates to remain normal to the path"), `lockFaces`, `lockDirection`, `profileControl` (NONE, KEEP_ORIENTATION, LOCK_DIRECTION, LOCK_FACES). The Sweep feature adds twist (`SweepTwistType` TURNS/ANGLE/PITCH) and scale.
- **Help, Loft (verbatim):** "For best results, each profile in the loft should contain the same number of vertices." "For best results, all profiles should have the same number of curve segments." "Optionally, select Connections to have more control on the twist of the resulting surface." "If there are guides, those are used for alignment, if not Onshape estimates the proximity within the existing vertices." "Loft profiles cannot contain multiple contours." "Guide curves need to be smooth (multi-edge curves must be tangent), and they must touch the profile."
- **Help, Sweep (verbatim):** profile control "None: No profile control (maintain the profile relationship with the global plane)"; twist Turns/Angle/Pitch; "If the profile sketch is located somewhere along the path rather than at the end of the path, the Sweep feature sweeps the profile in both directions along the entire length of the selected path."

## Robustness and guarantees
None stated. The docs never say which surface class a loft face gets, when faces simplify to analytic, or how "proximity" picks start vertices. Those answers come from the Parasolid docs (simplify, matching rules) and from exports (see `onshape-parasolid-loft-output-in-corpus-step-exports.md`).

## Parallelism and performance
Not documented.

## Known failures, limitations
- Unequal vertex counts "may cause twisting" (help wording is only "for best results"); matching is heuristic unless `connections` are given.
- `connectionsArcLengthParameterization` defaults to false: connection parameters are raw edge parameters, not arc length; any reimplementation must use the same parameterisation or connection points land elsewhere.

## Relevance for wonky
- Corpus usage (MEASURED, rg over `~/Workspace/cad`, 2026-09-24): 275 FS files call `opLoft`; none passes `connections`, `derivativeInfo`, `guideSubqueries`, `loftTopology`, `makePeriodic` or `addSections` (the two "connections" hits are comments). `opSweep`: 5 files (circle along planar line/tangent-arc paths), `opRuledSurface`/`opHelix`: 0. So wonky needs the default semantics first: `MINIMAL` topology, no end conditions, proximity matching, solid body from sketch regions.
- Interpreter: unsupported fields must raise explicit capability errors naming the field, not be ignored.
- LLM ergonomics: the default-matching heuristic is the main source of silent twist; wonky should report the matching it chose (introspection) and refuse ambiguous cases instead of guessing.

## Pointers worth porting or studying
`loft.fs` `createProfileConditions` (end-condition → derivativeInfo map), `updateConnections` (keeps connection parameters synchronized with edges), `lofttopology.gen.fs`; `geomOperations.fs` opLoft/opSweep doc strings as the interface spec.

## Verdict: adopt (as interface spec)
It is the contract the FS frontend must meet; it says nothing about geometry, which must come from Parasolid docs, exports and wonky's own design.
