These owned STEP inputs exercise reference observations, certified enclosures
and reference-body admission. They do not establish exact reconstruction, solid
validity, repair, or the mesh/viewer delivery of I1c.
Their immutable byte hashes, origin and licence are in `provenance.json`.

`analytical.step` contains closed, ring-bounded cylinder and truncated-cone
observations, two hemispheres and an upper half torus with an annular base,
SI millimetres, declared 1e-6 mm uncertainty, and nested translations 7 + 11 mm.
`rational-pcurves.step` extends the owned tetrahedron with a collinear rational
3D spline and matching rational planar pcurves. The historical planar fixtures
remain unmodified and also exercise exact inch conversion and unknown tolerance.

Rust tests in `wonky-geom/tests/reference_import.rs` check topology, semantic
circle-frame enclosures and whole-domain certificates, including disconnected
coedges, off-surface spline interiors, pcurve mismatch and an omitted torus face.
The local `reference-step` example prints observations and partial certificates;
it exits 2 because full reference admission is still unavailable. The two
third-party SG90 STEP files are deliberately absent from committed fixtures.

`tetra-reference.step` declares zero uncertainty for its owned rational geometry.
`spline-trim.step` puts the tetrahedron's triangular bottom trim on a rational
bilinear tensor surface, with explicit pcurves and declared 1e-6 mm uncertainty.
Their source geometry remains analytic; bounds are enclosures with reported slack.

The normal reference body report is available with:

```sh
WONKY_BACKEND=rust node bin/wonky.mjs fixtures/step-reference/spline-trim.step --json
```

It includes every face's outcome, enclosure method and slack, the union bbox,
source labels, uncertainty and digest. Reference bodies have `exact:false`;
modelling refuses `import/reference-body/<operation>` until exact repair/admission.
Area, volume, solid-interior validity and display exports are not evaluated here.

Spherical polar trimming currently supports an oriented single latitude ring.
Other spherical loop decompositions refuse `import/sphere-polar-trim-undecidable`
until their pole/winding proof is implemented.
