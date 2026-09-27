# Simulation on the shared CAD model

Authorized direction, not an implemented capability. Geometry remains in Bend.
Boolean construction and then fillets remain the active priorities.

Simulation should be a separate layer over immutable model revisions and source
identities. A solver consumes geometry, physical properties, joints and boundary
conditions; it returns results with the model hash, configuration, tolerances,
solver revision and validation evidence. A simulation result is not a modified
manufacturing B-rep.

## First implementation: motion and collision

Represent rigid bodies, joint frames, revolute/prismatic joints, limits and
prescribed motion. Begin with a single joint and deterministic pose evaluation,
then chains, and only later closed mechanisms requiring a constraint solver.
Use broad-phase bounds and geometric narrow-phase intersection/distance queries.
Time sampling alone must not be labeled continuous collision detection: fast
crossings between samples need conservative swept bounds or certified temporal
subdivision. Tests include known revolute/prismatic motion, joint reversal,
grazing contacts and a collision entirely between sample times.

Useful code-based assertions include collision-free motion over a specified
interval, a minimum separation and a reachable target. The viewer can reuse
before/after, picking and source links for poses, contacts and motion envelopes.

## Stability and load simulation

Keep three physical questions distinct:

- Static tipping: mass properties, gravity and a support/contact model.
- Rigid-body dynamics: mass/inertia, constraints, contact, friction and time
  integration, with energy/momentum checks on controlled examples.
- Structural mechanics: material laws, a volume/shell/beam mesh, boundary
  conditions and a sparse numerical solve. Start with small-strain linear
  elasticity and validate against a cantilever/axial bar and mesh convergence.
  Buckling, large deformation, plasticity and nonlinear contact are later scopes.

FEA discretization is explicit and separate from the analytic B-rep. Reports
must include mesh size/order, material units, load/support definitions, residuals
and convergence evidence. An attractive stress plot alone is not validation.

## Viewer integration

Reuse the existing immutable reviews and model hashes. Add a motion timeline,
joint/axis controls, recorded contact events and collision locations. Later
physical overlays include supports, loads, displacement and stress fields;
display units, deformation magnification and solver/mesh provenance explicitly.
Keep simulation state and camera state separate from the immutable CAD model.

Picking must connect an overlay/result sample to its geometric entity and
source relationship. Before/after comparison should use matching configurations
and distinguish changed geometry, changed physics inputs and changed solver
settings. Existing arrows, boxes, pen annotations and structured LLM feedback
should include simulation run hash, time/load case and selected entity/sample,
so a reported problem can be reproduced rather than inferred from a screenshot.

## Source relationships and recomputation

Attach joints, supports, loads and probes to source-aware face/edge references.
A split, merge or ambiguous match must produce a visible unresolved assignment;
never silently transfer a load to a nearby face. A feature/geometry/physics
dependency graph can invalidate only affected data. Symbolic construction
references and exact/indirect predicates are candidate foundations, not an
already implemented incremental simulation engine.

Examples of intended assertions: a slider remains collision-free throughout its
stroke; a named surface moves less than a specified distance under a stated load;
the gravity resultant stays within a supported static contact region. Each
assertion needs the matching physical assumptions and an explicit uncertainty.

## Performance evidence

Benchmark geometry preparation, collision queries, meshing, assembly, solve and
visualization separately. Bend is a candidate for independent collision batches
and solver kernels; neither GPU suitability nor an advantage over established
sparse solvers follows from using Bend. Compare equal workloads and accuracy.
