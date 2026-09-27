# Exact revolve

`kernel/revolve.bend` builds solids of revolution as exact analytic B-reps.
Nothing is facetted. It has two entries:

- **`revolve`** (commit 8b21014): a full turn of a closed polygon that stays
  off the axis. It builds one face per segment, and every face carries a seam,
  including the planes. Its results are relied on, so it stays unchanged. The
  JS driver is `revolveInBend` in `src/analytic.mjs`; its tests are in
  `test/revolve.test.mjs`.
- **`sweep`** (the R20 gate, `local design note` task 3): the general entry.
  - line and arc profiles;
  - a full turn, or a partial angle with planar side faces;
  - profile vertices on the axis.

  The JS driver is `sweepInBend`; its tests are in
  `test/revolve-partial.test.mjs`.

## `sweep`

```
sweep(profile: List<Node>, turn: Full{} | Partial{angle}, tolerance, origin, axis, x)
  -> Built{solid: A.Solid, volume: R.Real} | Declined{reason: U32}
Node{point: Ring{radius, height}, segment: Straight{} | Arc{center: Ring, ccw: Bool}}
```

- **Profile.** A closed chain of nodes in the half plane (radius along `x`,
  height along `axis`, measured from `origin`).
  - It must run counterclockwise in (radius, height), with material inside.
  - Node i carries the segment from its point to the point of node i+1; the
    last node closes back to node 0.
  - An `Arc` runs about `center`. It goes counterclockwise in (radius, height)
    when `ccw`. Its radius is the distance from the centre to the node's point.
  - A profile of one node with an arc is a full circle, for example a torus
    profile.
- **Turn.** `Partial{angle}` sweeps from `x` about `axis` by the right-hand
  rule, with 0 < angle < 2π in radians. `Full{}` is the whole turn. Callers
  map Onshape's `angleForward`, `angleBack` and direction flips onto a start
  direction `x` and one positive angle.
- **Frame.** `axis` and `x` must be unit length and perpendicular.
- **Tolerance.** The caller's linear tolerance.

JS driver:

```js
sweepInBend(kernel, id, profile, origin, axis, x, tolerance, angle /* radians, null = full turn */)
```

In the driver:
- each node is `[r, h]` (a straight segment to the next node) or
  `{ at: [r, h], arc: { center: [r, h], ccw } }`;
- a refusal is raised as an `UnsupportedFeatureError` that names the reason;
- the body carries:
  - `validation.volumeMm3` (exact);
  - `primitive: {type: 'revolve', ..., angle}`;
  - `construction.method = 'native Bend exact revolve'`, so a rigid motion
    keeps the volume (`transformAnalytic`).

### Faces

One face per profile segment, plus two side faces for a partial sweep:

| segment | surface | outward sense |
|---|---|---|
| on the axis (both ends at r = 0, straight) | none; a partial sweep keeps it as one line edge shared by the two side faces | |
| straight, perpendicular to the axis | `Plane` | faces −axis when the profile runs outward, +axis when it runs inward |
| straight, parallel to the axis | `Cylinder` | away from the axis when the profile climbs |
| straight, oblique | `Cone` | same rule as the cylinder; a cone ending on the axis is anchored at its other ring, never at radius 0 |
| arc with its centre on the axis | `Sphere{origin, axis, x, radius}` | away from the centre when `ccw` |
| arc with its centre off the axis | `Torus{origin, axis, x, major, minor}` (major = centre radius, minor = arc radius) | away from the tube centre when `ccw` |
| partial sweep, start half plane | `Plane{origin, axis × x, x}` | −(axis × x) |
| partial sweep, end half plane | `Plane{origin, axis × x_end, x_end}` | +(axis × x_end) |

Where a straight segment lies relative to the axis is decided by exact
equality of coordinates. See code 9 below for near-equal values.

### Topology

**Full turn**
- Each node off the axis gives one vertex, the seam point at `x`, and one
  circle edge closed at it.
- Each cylinder, cone, sphere or torus face gets a seam: the profile segment
  at `x`, a line or a circular arc in the meridian half plane.
- A node on the axis becomes a vertex (a pole or an apex) only where such a
  seam ends there.
- Planes have no seam:
  - an annulus has its two circles as loops, the larger one outer;
  - a disc touching the axis has one circle.
- The lateral loop is `[circle(a) fwd, seam fwd, circle(b) back, seam back]`,
  with each circle left out when that end is on the axis. That gives:
  - a cone with an apex: `[circle, seam, seam⁻¹]`;
  - a sphere: `[meridian, meridian⁻¹]`;
  - a torus from a circle profile: `[parallel, meridian, parallel⁻¹, meridian⁻¹]`
    on one vertex.

**Partial sweep**
- Each node off the axis gives two vertices (at `x` and at `x_end`) and one
  arc edge between them.
- Each node on the axis gives one vertex.
- Each segment gives two profile edges, one in each half plane. An axis
  segment gives a single line edge instead.
- Band loop: `[arc(a) fwd, edge_end fwd, arc(b) back, edge_start back]`.
- The start face's loop is the profile's edges in order. The end face's loop is
  the reverse.

Every edge is used once in each direction. Senses follow the counterclockwise
winding: for lines this is the legacy `band_sense`, for arcs it is `ccw`.

Measured in `test/revolve-partial.test.mjs`:
- On every face of every test body, a point on the face moved outward along its
  carrier normal is outside the swept region, and moved inward it is inside.
  Inside and outside are decided by an independent point-in-profile test.
- Every edge is used once in each direction.

### Volume

V = angle · ∮ r²/2 dh. This is Green's theorem on ∫∫ r dA, and for a full turn
it is Pappus. The terms:

- a line: Δh (ra² + ra·rb + rb²) / 6;
- an arc about (cr, ch) with radius ρ from polar angle t0 to t1:

  ρ/2 [cr² (sin t1 − sin t0) + cr ρ (t1 − t0 + sin t1 cos t1 − sin t0 cos t0)
  + ρ² (sin t1 − sin t0 − (sin³ t1 − sin³ t0)/3)].

  The sines and cosines come from the end points. Only the linear term uses
  the swept angle (`atan2`). A full circle sweeps 2π.

`sweep_volume(profile, turn)` returns the same number without building the
solid. The arithmetic is F32x2, about 48 bits. Measured: KT3a, KT3b, the KT1
relief cone, the KS03 cone, the KS06 sphere and the KS08 torus all come within
1e-14 relative of their closed forms.

### Refusal codes (`Declined{reason}`)

| code | meaning |
|---|---|
| 1 | the profile bounds no area (no node, or fewer than three without an arc) |
| 2 | a point lies across the axis, or an arc touches or crosses the axis between its ends (a full circle profile touching the axis included) |
| 3 | a segment (chord) or an arc radius is not longer than the tolerance |
| 4 | not counterclockwise (the swept volume is not positive) |
| 5 | an arc's end point is off its circle by more than the tolerance |
| 6 | a partial angle outside (0, 2π), or within tolerance / (largest radius) of either end |
| 7 | a full turn would pinch: a vertex on the axis has no axis segment on either side, so the solid is not a manifold there (a partial sweep of the same profile is a manifold and builds) |
| 8 | an arc centre lies across the axis (the lemon half of a spindle torus) |
| 9 | a radius, an arc centre radius, or a straight segment is within the tolerance of zero, perpendicular or parallel without being exactly so |

Code 9 exists instead of snapping. The kernel cannot tell which coordinates the
caller meant to be equal. The FeatureScript layer can (an axis that lies on a
sketch line, a line drawn parallel to the axis), so it must deliver them equal.

Known gap: as in `revolve`, a profile that crosses itself but still encloses
positive net area is not detected.

## Sphere and torus carriers

`kernel/analytic.bend` `Surface` has `Sphere{origin, axis, x, radius}` and
`Torus{origin, axis, x, major, minor}` beside `Plane`, `Cylinder` and `Cone`.
The fields are laid out like the recover prototype's `OSphere`/`OTorus`.

- `surface_transform`, `surface_residual` and `periodic_surfaces` handle both.
- The torus residual is |√((ρ − major)² + h²) − minor|. That is the sheet on
  the tube centre's side, which is all that `sweep` builds; a spindle torus
  with minor > major is admitted as that sheet.
- `validateAnalytic` and `decodeAnalytic` accept `sphere` and `torus` faces.

Bend requires exhaustive matches, so every `match` on `A.Surface` names both
new cases. These were added outside the revolve files:

| file | behaviour for sphere and torus |
|---|---|
| `kernel/face-plane.bend` `surface_origin` | the origin |
| `kernel/ray.bend` `surface_valid` | checks the fields |
| `kernel/ray.bend` `intersect_valid` | `none(4)`: line/sphere and line/torus roots are reported as unresolved, so ray classification refuses rather than counting parity |
| `kernel/display.bend` `surface_point` | exact (longitude, latitude or tube angle) |
| `kernel/display.bend` `surface_normal` | equator only (the signature has no v) |
| `kernel/ports/truck-cylinder.bend` `surface_scale` | a scale bound |
| `scripts/{hardware,build123d}-workload.bend` | surface hashes |
| `kernel/proto/recover/main.bend` `put_body_surface` (now `kernel/hybrid/recover/main.bend`) | prints `sphere`/`torus` exactly like `OSphere`/`OTorus` |
| `kernel/lang/wk/real.bend` `rt_surface`, `surf_level`, `surface_rs` | round trip; levels 3 and 4 (curved); encoding |

There must be no comment line inside a `type` body: `scripts/native-bridge/gen-wire.mjs` reads the constructors as consecutive lines, and a comment line hid the new constructors from the generated native codec.

`bend PROOF.bend` checks only the definitions reachable from `PROOF.bend`.
That is why `PROOF.bend` ends with reachability definitions that name `sweep`,
`sweep_volume` and `surface_residual`.

Not covered yet (other tasks of `local design note`):
- STEP `SPHERICAL_SURFACE`/`TOROIDAL_SURFACE` (`src/exporters.mjs`);
- print meshes of revolve faces (`src/print-mesh.mjs`, `kernel/tessellate.bend`);
- ray/point classification against spheres and tori;
- importing Onshape sphere and torus faces (`importOnshapeBody` refuses them
  by name);
- FS `opRevolve` (`src/library.mjs`).

Independent check with OpenCascade as a test oracle only:
- `tmp/revolve-kernel/oracle.py` read the STEP files of 10 revolve bodies
  written by a patched copy of the exporter:
  - KT3a, KT3b, the relief cone, the KS03 cone, a tube;
  - a tube swept 270°;
  - a sphere, a sphere swept 90°;
  - a torus, a torus swept 45°.
- All 10 pass `BRepCheck_Analyzer` with exact CurveOnSurface checking.
- The OCCT volumes are within 1e-14 relative of the kernel volumes.
- The only topology OCCT adds are degenerate edges at poles and apexes.
