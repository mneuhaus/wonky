# Complete solid/plane contours

`kernel/section.bend` constructs all closed, directed analytic contours of a
validated planar/cylindrical solid against one unbounded plane. It retains the
finite face sections and their original source records. It does not construct
a cap, classify nested contours, split source faces, trim to another face, or
authorize a Boolean result.

```bend
section(solid, domains, plane_origin, plane_normal, tolerance, source_budget)
```

```js
import { sectionSolid, requireResolvedSection } from './src/section.mjs';
const result = requireResolvedSection(await sectionSolid(body, {
  origin: [2, 0, 0], normal: [1, 0, 0],
}, { linear: 1e-7, angular: 1e-10 }));
```

The JavaScript adapter only serializes inputs. It accepts the same native
`Solid`, analytic B-rep, implicit line B-rep, domain overrides, and source
allowances as face classification. Use explicit domain overrides for partial
round edges in native solids: a native `Solid` does not carry these ranges.
All validation, numerics, root decisions, orientation and stitching run in
Bend. The module loads through the source-bound persistent Bend loader.

## Result and completeness

- `Resolved` contains `relation` (`Empty` or `Transverse`), `roots`, `edges`,
  `pieces`, `contours`, `faces` and the original `tolerance`.
- `Failed` contains an indexed `reason` and `faces`. It has no roots, edges,
  pieces or partial contours. `FaceRejected`, `FaceUnresolved` and `FaceContact`
  retain the original face-level reason and face index. Global invalid inputs
  and an empty source have no meaningful face index; malformed vertices and
  source closure failures identify the offending vertex or edge.
- Once the global input/source checks pass, every source face goes through
  `face-plane.intersect`, including faces yielding `Empty`. All its full result
  records appear in `faces`, also on failure. A failure on any face prevents
  construction of the entire set. A valid empty intersection has empty lists.

`edges[i]` corresponds to `pieces[i]`; contour coedges index these lists.
An edge retains the native increasing-parameter curve, with `same_sense=True`.
Its `start` and `end` index **roots**, not source vertices. Coedge `forward`
encodes the directed traversal. Every piece retains its `FaceSource`, the
original `face-plane.Section` (curve, domain, support index and endpoints),
both endpoint references, and orientation evidence. Full `EdgeSource` and
original `EdgeHit` data remain available at each boundary association/root.
These are wire records, not an `analytic.Solid` suitable for a solid exporter.

## Identity and retained endpoint gaps

A `SourceRoot` is keyed only by source edge index and the **identical two F32
words of the original edge-hit parameter**. Both words of each original hit
coordinate must also match. Signed zeros remain distinct words. A conflicting
coordinate for the same key fails with `RootPointMismatch`; nearby or even
identical coordinates belonging to different keys never join. There is no
nearest-neighbour search, snapping, sorting by angle, or proximity welding.

An untrimmed circle or ellipse receives one explicit `SyntheticSeam` root,
identified by its source face and local section index. Both endpoints use that
root. This identity is separate from every source-edge root, including actual
source periodic-edge seam hits. Native periodic wrap intervals stay lifted;
their original canonical boundary events are preserved unchanged.

The section endpoint on its supporting curve can differ from the original
edge-hit point within the accepted source/query allowance. These two points
are never substituted for one another. `BoundaryAssociation` retains the
original event, a separately checked event evaluated at the **actual section
endpoint**, and its margin. The check reuses `face-plane.mapping_point`, with

```
margin = source_budget + linear_tolerance + 2 * face_linear_resolution
```

The final face resolution is the maximum of the contributing edge/support
resolutions, so twice that value bounds the sum used by the original mapping.
The checked event retains the original hit/source plus actual endpoint
parameter, point, distance gap and parameter resolution. This also covers a
lifted periodic end whose represented point differs from its canonical event.
Failure to associate either endpoint fails the whole result.

Thus closure is explicit topological closure with separately checked endpoint
associations. It is not a claim that all represented curve endpoints are
bitwise identical, nor an exact coincidence certificate. No new source vertex
or replacement geometry is fabricated for a tolerant gap.

## Orientation and stitching

The direction is positive for the cutter normal: its tangent is parallel to
`cross(normalized cutter normal, outward face normal)`. The face normal uses
`same_sense`; cylinder normals are computed in Bend by removing the axial
component of `point-origin` and normalizing the radial vector. Circle and
ellipse derivatives are the existing native analytic tangents.

Only the already validated supporting families are admitted: plane/plane
lines, transverse cylinder circles/ellipses, and nontangent cylinder
generators. On each connected regular support, its nonzero analytic tangent
and the nonzero surface-intersection tangent are parallel continuous fields.
Their relative sign cannot change without a degeneracy. A native midpoint
(parameter zero for a full period) selects that constant sign. This argument
depends on the validated supporting intersection; sampling is not used as a
proof for arbitrary curves. The native check also requires a nondegenerate
cross product, finite normalized vectors, nonambiguous alignment and a
parallel residual no greater than the query angular tolerance. Uncertainty
returns `AmbiguousOrientation`.

Every source edge must first have exactly one forward and one backward coedge.
Every output source root must occur once from each of those source coedge
directions. Finally `boundary.stitch` processes every directed output edge in
one operation, requiring exactly one incoming and one outgoing use at each
used root. Open boundaries, branches and inconsistent orientation fail with
no partial rings. Multiple valid rings stay separate; no outer/hole nesting
classification is inferred from their direction or containment.

## Preconditions and limits

The existing face and supporting-intersection validity rules apply, including
finite normalized numeric words, valid frames/radii, physical cylindrical seam
cancellation, valid explicit partial trims and supported arithmetic budgets.
Ordinary source-vertex contacts, coincident or tangent boundaries/supports,
ambiguous trimming and unresolved face preparation remain explicit failures.
No special case depends on r10b source indices.

An embedded, bounded, nonintersecting face arrangement with globally correct
outward face orientation remains a caller precondition. Closed opposite
coedges alone do not prove embeddedness or globally outward orientation.
The numeric guards are operational F32x2 error guards inherited from these
modules, not interval-arithmetic proofs. This API does not extend support to
cones, arbitrary parametric surfaces, degenerate section contacts or general
Boolean operations.

## Verification

```sh
.tools/bend-2.0.25/bin/bend kernel/section.bend
node --test test/section.test.mjs
node scripts/diagnose-section.mjs
```

The focused tests cover boxes, disconnected sections of concave prisms,
transverse/oblique/longitudinal cylinders, clipped periodic intervals, bored
annular solids, normal reversal, native rigid transforms, preserved source
words and endpoint gaps, strict root identity, contacts, invalid/uncertain
inputs, empty-face validation and failure despite other valid sections.
Independent JavaScript references are test-only.

The diagnostic freshly reconstructs the frozen transformed P10 and its actual
F32 clipping-box planes. Right x is `-92.79000091552734`; top z is `68`. Each
produces 12 finite sections used exactly once in closed directed contours:
two rings with 4 and 8 edges at right x, one ring with 12 edges at top z.
The y=4 plane retains 16 unresolved face results and returns no contours.
The other three box planes are complete empty sections. The report preserves
all native results, frozen-input hashes and before/after implementation hashes
in `out/section/diagnostic.json`. These are contours on unbounded planes, not
clipping-box face trims or completed Boolean geometry.
