# STEP reference display meshes

Use the Rust backend and the normal STEP input entry point:

```sh
WONKY_BACKEND=rust node bin/wonky.mjs servo.step --format stl --deviation-mm 0.02 --out out/servo
WONKY_BACKEND=rust node bin/wonky.mjs servo.step --format html --out out/servo
WONKY_BACKEND=rust node bin/wonky-view.mjs servo.step --no-open
```

STL is binary, in world millimetres, with STEP item placements applied. Its
`<prefix>.stl.json` sidecar records `exact:false`, `approximation:"tessellated
mesh"`, requested deviation, producer-declared source uncertainty, provenance,
face coverage, watertightness, sampled maximum carrier deviation and the maximum
interpolation bound and combined deviation bound. Source uncertainty remains separate from display deviation.
Unknown uncertainty or an insufficient budget produces a named refusal.

The mesh reuses certified polylines of the retained STEP edges on every incident
face. Planar trims, periodic bands, spherical caps and tensor-product rational
B-splines use their retained carriers; no CAD library constructs the geometry.
Chart triangulation reuses the Rust kernel’s constrained Delaunay legalizer
with exact rational orientation and diagonal decisions. Interior refinement
uses second-derivative interpolation bounds. STEP boundary
vertex identity owns connectivity. Source-coordinate chart inversion precedes
item placement. The normal STL coordinate-welding checks run after float32
storage conversion; a gap, collapsed triangle or non-manifold edge refuses.

Mesh validation reconstructs trim domains from the retained source and checks
vertices against the exact analytic carrier predicates or rational spline
point enclosures in Rust. Sampled triangle deviations are measured at vertices,
edge midpoints and centroids; the reported sampled maximum is **not** an exhaustive
maximum. The separate interpolation bound covers each triangle's interior.
The trim is displayed with the certified edge-polyline deviation; it is never
promoted to an exact polygonal B-rep. Non-C1 spline knots and exhausted refinement
budgets currently refuse by name.

HTML and the live viewer show the same approximate geometry and preserve STEP
placement. Reference area and volume remain unavailable. Reference bodies still
refuse Boolean, fillet, chamfer, pattern and transform operations. The mesh does
not create an exact body or enable those modelling operations.

Committed tests use repository-owned synthetic STEP fixtures. Local third-party
SG90 input and its exported previews remain outside Git. A four-view rendering
is a display check, not geometric validity evidence.
