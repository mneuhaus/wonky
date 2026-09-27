# Convex planar solid intersections in Bend

`kernel/halfspace.bend` constructs the regularized intersection of a convex
planar solid with a halfspace, and of two such solids. It produces a complete
shared-edge B-rep with oriented closing faces, volume and tight vertex bounds.
FeatureScript `opBoolean(... INTERSECTION)` and Python Algebra `a & b` dispatch
to this path for planar, straight-edge inputs. The result can be intersected
again and exported to STEP. Examples are `examples/convex-intersection.fs` and
`examples/convex-intersection.py`.

This is an additional, restricted Boolean implementation. Nonconvex bodies,
curved faces, imported source allowances, cavities, planar union/subtraction
and the full P10/box operation are not implemented by this path. The existing
coaxial-cylinder Boolean path remains available. Unsupported or ambiguous
inputs remain errors, including inside FeatureScript `try silent` and Python
`except BaseException`.

## Native API and construction

```text
clip(solid, plane_origin, plane_normal, tolerance, source_budget)
intersect(first, second, tolerance, first_budget, second_budget)

ClipResult = Empty{} |
  Solid{solid: analytic.Solid, volume: Real, bounds: analytic.Bounds} |
  Unresolved{reason}
```

The retained halfspace is `normal · (point - origin) ≤ 0`. Intersection is
regularized: a face, edge or point contact without three-dimensional material
is an actual empty result. Every operand is validated before an empty result
can hide malformed input. Plane normals need not be unit vectors.

```js
import { clipConvexSolid, intersectConvexSolids,
  decodeHalfspace, requireResolvedHalfspace } from '../src/halfspace.mjs';

const native = await clipConvexSolid(body, {
  origin: [4, 0, 0], normal: [1, 0, 0],
}, { linear: 1e-7, angular: 1e-10 });
requireResolvedHalfspace(native);
const bodies = decodeHalfspace(native, 'clipped', kernel); // [] if empty
```

JavaScript only serializes, dispatches and decodes. Bend classifies the source
vertices, computes each crossing once per shared source edge, clips ordered
face boundaries, creates shared edges and stitches the opposing open uses
into the cap. Unreferenced vertices are removed by an explicit index map.
Signed tetrahedral sums compute volume; the extrema of the remaining vertices
give tight bounds for this linear convex class. Rigid transformations retain
volume and recompute bounds in Bend.

`kernel/boundary.bend` is the reusable identity-only directed-ring stitcher.
It requires exactly one incoming and outgoing use at each participating vertex,
supports multiple independent rings, and rejects open or branching graphs.
Distinct coordinates are never welded. The convex clipping caller requires
one cap ring. Periodic seams or intersecting arrangements with multiple valid
outgoing branches need a different arrangement decision and are not guessed.

## Admitted input and numerical policy

Every face must be one simple convex outer polygon on a plane. All edges must
be finite vertex-bounded lines. The input checks include:

- Finite F32x2 coordinates, valid directions, line and plane incidence within
  the arithmetic resolution, consistent ordered loops and positive face area.
- Plane normal and x directions must be perpendicular within the existing
  approximately 1e-11 normalized-frame guard. Nonunit magnitudes are allowed;
  invalid words, zero, parallel or skewed directions are rejected before
  clipping, even if the resulting intersection would be empty.
- Every vertex lies in every oriented supporting halfspace; every face polygon
  has the same winding as its outward normal.
- Every edge has exactly two opposite uses, all topology is referenced, the
  face adjacency graph is connected, and the Euler characteristic is two.
- Separate vertex IDs have resolved spatial separation; duplicate unordered
  endpoint pairs cannot represent additional coincident edges.

These geometric and topological checks are required together. Euler and paired
coedges alone previously admitted duplicated shells; a dedicated regression
now rejects that construction before either an unchanged or a cut result.

The arithmetic resolution is approximately `1e-12 × max(1, coordinate scale)`.
It must be smaller than the requested linear tolerance. Source allowances must
be zero; the separate tolerant-junction component is not implicitly enabled.
Coordinates retain the shared `1e10` operational limit. The adapter rejects
explicit curve-domain overrides rather than ignoring them.

A represented vertex is exactly on a cutting plane only with the existing
floating-expansion zero certificate on the original words. Otherwise its
distance must exceed linear tolerance plus arithmetic resolution. Contacts in
the uncertainty band return `AmbiguousContact`, including rounded-zero
impostors. No near-contact becomes exact coincidence.

New roots use F32x2 line interpolation and are shared by both incident faces.
Output lines are reconstructed from the checked segment endpoints; frames and
line directions are normalized in Bend. The input's actual supporting line
must already agree with its endpoints within the arithmetic resolution, not
a larger imported tolerance. This is finite-precision construction of linear
geometry, not a preservation claim for each original parameterization/native
word and not polygonization of analytic curves. Output is revalidated before
publication. Operational guards are not certified interval bounds for all
calculations.

When a transverse cut touches a subdivided source edge, an excluded face can
leave three or more collinear vertex IDs. A face with no strictly retained
source vertex has no retained area and is omitted under regularization;
its shared vertices are still available to the cap. Near-degenerate slivers
and uncertifiable contacts otherwise remain unresolved.

Boolean origin and operation ancestry are recorded through the existing
identity system. Entity correspondence across splits/merges and component
continuity across model revisions remain explicitly unresolved.

## Validation

```sh
node --test test/boundary.test.mjs test/halfspace.test.mjs
node bin/wonky.mjs examples/convex-intersection.fs --format step --out out/convex-intersection
uv run scripts/validate-step.py out/convex-intersection
```

Regressions cover axis-aligned and oblique caps, cuts through source vertices
and edges, unchanged and empty results, contained/identical/touching operands,
chained intersections, native rotations, malformed and nonconvex inputs, the
duplicated-shell counterexample, and the extra-collinear-vertex case. The
FeatureScript and Python tests execute genuine frontend programs through the
same native constructor. Independent box/simplex volume formulas and a separate
96-case mixed-normal inclusion/exclusion calculation check constructed volume.
STEP validation observes exported bodies only; OpenCascade does not construct
production geometry.

Artifacts are under `out/halfspace/`. Full r10b acceptance remains a separate
required gate and is still failing at its first curved/nonconvex intersection.
