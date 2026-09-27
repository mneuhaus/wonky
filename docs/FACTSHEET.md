# Wonky Kernel — Technical Factsheet

**A code-first CAD kernel for programmable modeling, automated checks and LLM-assisted workflows.**

| Area | Current implementation |
|---|---|
| Geometry engine | B-rep construction and geometric decisions in **Bend**. JavaScript handles interpretation, coordination and I/O. No OCCT production fallback. |
| Modeling languages | Original **Onshape FeatureScript syntax**, with a growing library subset; real Python execution with a limited **build123d algebra API**. |
| Geometry | Planar profiles, normal line/arc extrusions, cylinders, conical frustums, rigid transforms and frozen analytic Onshape body imports. Shared vertices, edges, loops and faces; analytic curves remain analytic. |
| Booleans | Coaxial-cylinder union/intersection/difference; bounded planar union/difference; admitted plane/cylinder intersections with a convex planar tool. |
| Numerics | F32x2 arithmetic, selected filtered/exact predicates, explicit construction budgets and separate numerical/export allowances. Ambiguous or unsupported geometry fails explicitly. |
| Output | Analytic **STEP** and structured **B-rep JSON**. |
| Traceability | Geometry-to-code provenance, named sketch entity roles, revision-aware identities and recorded operation ancestry. General split/merge matching remains open. |
| Review & testing | Browser viewer, geometry selection and hover, side-by-side and slider comparison, saved annotations, geometry inspection, standard-view image diffs and independent STEP validation. |

**Verified milestone:** The original 12-arc M3 profile executes through FeatureScript and exports as a closed analytic solid. Real r10b operations `g7` and `g9` pass; the complete model still stops at the subsequent curved-body union.

**Still missing:** General curved Booleans, fillets, revolve, full FeatureScript/build123d coverage and enclosed cavity-shell handling. Six verified identical-code Python workloads currently run slower through Wonky's Bend/JavaScript modeling path than real build123d/OCCT; these are full build API timings, not isolated geometry timings.

*Status: active development, not production-complete. 22 September 2026.*
