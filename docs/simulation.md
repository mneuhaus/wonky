# Simulation on the shared CAD model

Authorized direction. Only motion sampling ("Motion sampling: implemented" below)
exists; stability and load simulation are not implemented. The geometry kernel
is Rust (Bend is retired).

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

## Motion sampling: implemented

`node bin/wonky-motion.mjs <spec.json> [--json] [--gif out.gif]`. Code:
`src/motion.mjs` (spec, pose evaluation, report), `src/motion-gif.mjs` and
`src/gif.mjs` (animation), tests `test/rust-motion.test.mjs`. It is a separate
layer: it reads the built bodies and never edits them. It reuses the exact
placement (`placeRustBody`, strict rigid and rational-image host operations), the exact
interference of `src/native/rust-clash.mjs` (`clashRustBodies`), and the
viewer's renderer. It is sampling, not continuous collision detection.

### Spec (`wonky-motion/v1`, JSON)

```json
{
  "schema": "wonky-motion/v1",
  "model": { "source": "mechanism.fs", "feature": "f", "parameters": {} },
  "units": { "length": "mm" },
  "joints": [
    { "id": "hinge", "type": "revolute", "body": "door",
      "axis": { "point": [50, 0, 0], "direction": [0, 0, 1] },
      "range": [0, 30], "rotationToleranceDegrees": 0.000001,
      "driver": { "samples": [0, 5, 10, 15, 20, 25, 30] } },
    { "id": "slide", "type": "prismatic", "bodies": ["b"],
      "direction": [1, 0, 0], "range": [-15, 0], "driver": { "count": 4 } }
  ],
  "pairs": [["door", "stop"]]
}
```

- `model.source` is a FeatureScript file (relative to the spec); its Part Studio
  is built with the Rust backend and the bodies of the result are the rigid
  bodies. Bodies are named by their name property, their id, or the last path
  segment of the id (`stop` for `model/stop`); an ambiguous name refuses.
- `revolute`: `axis.point` (default origin) and `axis.direction`, a unit
  coordinate direction; `range` and driver values in degrees. Optional
  `rotationToleranceDegrees` defaults to `1e-6` degrees and must be in `(0, 1]`.
  `prismatic`: `direction`, a unit coordinate direction; range and driver values
  in `units.length` (`mm` or `m`).
- Driver: exactly one of `samples` (a list of values within `range`) or
  `count` (>= 2 values spread over `range`, the last one exactly at its end).
  Pose i takes value i of every joint, so every joint has the same number of
  poses.
- `pairs` limits the pairs checked; default all body pairs. A pair inside one
  rigid motion is decided once, from the original bodies.
- Each joint record carries `parent` (only `"world"` today). A chain is a joint
  whose parent is another joint; the format has the field, the evaluator
  refuses it (`motion/chains-not-supported`) until it is implemented. One body
  is moved by one joint (`motion/body-moved-twice`).

### Exactness policy

A pose is an exact rigid placement of each moved body, composed from a translation
to the axis, the rotation and the translation back. Quarter turns use exact dyadic
maps; other angles use an explicitly disclosed rational realization. Write the
residual angle after the nearest quarter turn as tan(theta/2) = p/q. The exact
matrix uses cos = (q²-p²)/(q²+p²) and sin = 2pq/(q²+p²). These integer numerators
and denominator are transported without binary64 division; frame composition,
Boolean predicates and squared distance remain rational in the kernel.

Continued fractions select a candidate with q <= 1,000,000. An exact integer
alternating-atan enclosure and a 50-decimal-digit pi interval certify its angular
error against the configured binary64 tolerance. Floating trig selects and reports
the candidate, never certifies rigidity or geometry. Each pose discloses the
requested and realized angle, signed deviation, tolerance, certified upper error,
quarter turns and rational tan-half-angle. Collision results apply to the realized
pose, not an undisclosed ideal irrational rotation. The displayed angles are
rounded observations; the rational matrix is authority.

An unattainable tolerance refuses as `motion/rotation-tolerance-unmet`. A rounded
binary64 cos/sin frame (for example 20 degrees) refuses as
`placement/rotation-not-exact`; a nonisometric rational matrix refuses as
`placement/rational-not-isometric`. Failed poses have `exactPlacement: false`
and refused pairs, never clear pairs. Rational placement of curved carriers
currently refuses as `placement/rational-curved-carrier-unimplemented`.
Translations retain the same binary64 input semantics as FeatureScript
`value * millimeter`. No tolerance snaps contact or topology.

### Report (`wonky-motion-report/v1`)

`statement` ("Sampled at N poses; not continuous collision detection. Largest
sample step: ...", also as `sampling`), `model` (source, feature, body ids and
WC0 hashes), `configuration` (spec path and sha256, joints), `validation`,
`poses[]` and `summary`. Per pose: the driver `values` (including each revolute
joint's `rotation` realization metadata), `exactPlacement`, a
`summary` (interference, abutment, clear, refused counts) and per body pair
`type`, `kind` (`interference`, `abutment`, `clear`, `refused`), `volumeMm3` with
`volumeBoundMm3`, `distanceMm` with `distanceBoundMm`, and `refusal` (a code).
An abutment is exact contact: empty intersection and distance exactly 0. A pair
the kernel cannot decide is `refused`, and the exit code is 2. `notChecked` lists
what is not covered.

### Reproduction fixtures

`fixtures/motion/door-motion.json` sweeps the door from 0 to 270 degrees in
19 poses (15-degree steps). Generate both evidence and animation with
`node bin/wonky-motion.mjs fixtures/motion/door-motion.json --json --gif out/door.gif`.
The frozen servo source and actual nonconvex swing variant are adjacent, with
origin and hash in `provenance.json`. Their tests compare whole-body clearance
with the independently split reference, including both swing signs, columns and
the 0.15 mm horn/fork gap. Concave planar bodies use exact polygon partition and
solid membership, not convex hulls. Face holes stay signed regions for distance.
Explicit plane/tile/vertex resource limits still refuse larger arrangements.

### Animation

`--gif` renders one frame per pose with the viewer's renderer (headless
Chromium through Playwright, `scripts/viewer/qa/browser.mjs`), on a fixed camera
framed on all poses, with the pose value and the pair counts printed. Bodies in
interference are red, in abutment amber, refused violet; moving bodies blue,
fixed bodies grey. The colours are a display aid, the numbers are in the report.
The encoder and PNG reader are in `src/gif.mjs` (GIF89a, LZW, global palette:
exact if the frames use at most 256 colours, otherwise flat colours stay exact and
the rest is median cut). Playwright is not a dependency: without
`playwright-core` (`$WONKY_PLAYWRIGHT` or `~/.dev-browser`) and Chromium the
option refuses as `motion/gif-no-browser`; the report never needs it.

### No-Claim

- No continuous collision detection: contact between samples is not checked,
  a collision entirely between two samples is not found. Example: the test door
  (hinged at x = 50 mm, stop block x 55..100, y -30..-10) sweeps through the stop
  from about 99.46 degrees (90 + atan(5/30)) to 180 degrees, yet the samples 90
  and 180 report clear and abutment.
- No dynamics, forces, masses or time; poses are prescribed, not simulated.
- No closed kinematic chains and no joint chains yet.
- No joint limits beyond the driver range, no contact or clearance rules.
- Non-coordinate joint axes and rational placements of curved carriers refuse.
- No collision or clearance guarantee for the requested irrational pose: the
  disclosed rational realization, within certified angular tolerance, is checked.

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
