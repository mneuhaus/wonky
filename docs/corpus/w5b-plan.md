# W5b plan: build123d names behind the Python door

W5 (commit fceffef) left 37 of Marc's 91 Python files at a use-site capability
error for one of 16 build123d names. This plan says what each of those files
needs after that name, what the Bend kernel can build for it, and splits the
work into 8 tasks in 3 waves. Planning date 2026-09-23; all evidence is in
`tmp/w5b/` (paths below).

## Headline

**With a complete shim for all 16 names and everything the 37 files call after
them, none of the 37 builds.** Every file then stops at a kernel operation Bend
does not have, at the package policy, or at a cad_khana diagnostic:

| where the 37 files stop once the shim is complete | files |
| --- | ---: |
| Boolean the Bend dispatch refuses (planar ∪ cylinder, arc-edged bodies from `RectangleRounded`, blind holes, cones, pierce through more than two faces, compound operands) | 13 |
| `fillet` / `chamfer` (no edge blend in Bend) | 8 |
| `import_step` (external-geometry policy; three of them through `cad-project-017/blade.py`) | 5 |
| `Text` (fonts) | 2 |
| `ExportSVG` (2D drawing export) | 2 |
| `offset` (2D/3D offset) | 2 |
| splines (`Spline`, `Edge.make_spline`) | 2 |
| `loft` (non-circular) | 1 |
| `mirror` (reflection) | 1 |
| cad_khana `inspect()` / `check()` in the build flow (`manufacturing/coupons.py`) | 1 |

So the goal "as many files BUILD as possible" is capped at 0 by the kernel for
this set. The work is still worth doing: it replaces 16 "name not implemented"
errors with exact build123d behavior up to the first real kernel limit, which
then is a precise capability error naming the missing kernel operation, and it
turns the corpus into a ranked demand list for W2 (section "Kernel demand").
The files closest to building are listed in "Closest to building".

The plan ranks tasks by files moved past their W5 first blocker: after waves 1
and 2, 26 of 37 reach their final gap; after all tasks, 37 of 37.

## Method

1. **Oracle trace** (`tmp/w5b/trace.py`, `tmp/w5b/runall.mjs`). Each of the 37
   files ran under the real build123d 0.13.0 (`uv run --no-project --with
   build123d==0.13.0`, analysis only, never production geometry) with
   `sys.setprofile` recording every build123d callable that corpus code calls,
   in first-call order, and a wrapper around `Shape._bool_op` recording each
   Boolean's operands (solid count, face and edge geometry types, cylinder
   primitive, bounding box). Exports were no-ops. Marc's real cad_khana
   (read only from `~/Workspace/cad/cad-khana/src`) was written against OCP 7.8;
   the tracer adds the two OCP names OCP 8.0 lacks
   (`TColStd_IndexedDataMapOfStringString`,
   `TopTools_IndexedDataMapOfShapeListOfShape`) as empty classes, so its
   diagnostics fail at the end of the flow, after the model geometry. Output:
   `tmp/w5b/traces/*.json`, 4 to 28 s per file.
2. **Bend feasibility** (`tmp/w5b/classify.mjs` → `classify.txt`). For every
   recorded Boolean, an emulation of the `src/boolean.mjs` dispatch decides
   whether Bend has a path: planar ∪/−/∩, coaxial cylinders, plane/cylinder ∩
   with a convex tool, round through hole in a planar body with full circles
   only. The emulation is optimistic (coaxiality and convexity are not
   checked). Together with the kernel-less names (fillet, Text, ...) this gives
   the first step Bend cannot construct.
3. **Needs** (`tmp/w5b/needs.mjs` → `needs.txt`): the shim API each file calls
   before that step. **Call census** (`tmp/w5b/calls.py` → `calls.txt`):
   argument shapes of every build123d call in the 37 files and the 43 project
   modules they load. All of it is algebra mode: no `BuildPart`,
   `BuildSketch` or `BuildLine` occurs in these files.
4. **Semantics probe** (`tmp/w5b/semantics.py` → `semantics.txt`), oracle
   facts listed under "build123d 0.13 facts".
5. **Kernel probe** (`tmp/w5b/probe/u_pierce.py`, production CLI): a U body
   pierced through both arms fails with `opBoolean through holes need a tool
   axis perpendicular to exactly two faces of the target`. That corrects the
   optimistic classifier for `pin_hinge/assembly.py` (its `clevis()`).

## The 16 names: files, what follows, where they stop

"needs" lists the not yet implemented API the file calls between its W5
blocker and its final gap (Pos, Box, Cylinder, `+ - &`, `volume`, exports are
already implemented and omitted).

| W5 blocker | file | needs after it | final gap |
| --- | --- | --- | --- |
| `RectangleRounded` | `cad-project-032/project-component-32f60153.py`, `kasse.py` | `extrude`, `Plane.XY.offset`, `Plane * sketch` | `Text` (`project-component-32f60153.py:49`) |
| | `cad-project-032/zusatz.py`, `zusatz_seite.py` | `Circle`, `Compound` | `ExportSVG` |
| | `cad-project-025/beam_frame.py` | `extrude` | Boolean: rounded plate (arc edges) − Box (`:134`) |
| | cad-project-003 `current-latch-final/.../family.py`, 3× `family_snapshot.py` | `extrude` | Boolean: rounded shell − rounded inner (`family.py:155`) |
| `Polygon` | `preload_z/coupon.py` | – | `offset` (`:77`) |
| | `cad-project-035/project-component-d98e059b.py` | `Plane(...)`, `extrude`, `edges().filter_by(Axis.Y)`, `Edge.center` | `fillet`/`chamfer` |
| | `tile-clip-sockets/build.py` | `extrude`, `Rot`, `Plane.XZ` | `mirror` (`:251`); afterwards it SHA-256s its own exported files, which wonky records but does not write |
| | `tile-clip-sockets/merged.py` | `extrude`, `Rot` | Boolean: planar ∪ cylinder (`:127`) |
| `Location` | `cad-project-017/cutter.py`, `mount.py`, `servo.py` | – | `import_step` in `blade.py:23` (module level) |
| `Rot` | `pin_hinge/assembly.py` (cad-khana skill example) | `Location` | Boolean: pierce through both clevis arms (`:105`, kernel probe); then `check()` in `__main__` |
| | `manufacturing/coupons.py` | `Polygon`, `extrude`, `Part(shape.wrapped)`, `Compound(children=)`, `bounding_box`, `is_valid`, `solids()` | none in geometry (2 planar Booleans); `inspect()`/`check()` in `build()` |
| | `cad-project-013/sanding_head.py` | `Shape.fuse` | Boolean with 1+9 operands; also fails in real build123d (`invalid printable solids`) |
| `Shape.edges` | `cad-project-003/kalibrier.py`, `cad-project-026/plate.py`, `cad-project-033/case.py` | `edges()`, `filter_by`/`group_by(Axis.Z)`, `Edge.center` | `fillet`/`chamfer` |
| `Part` | `cad-project-017/base.py`, `extruder_stub.py` | `Part() + ...`, `edges().filter_by(Axis.Z)` | `fillet` |
| `Plane.XY` | preload-audit `lateral_preload.py`, `preload_family.py` (via `family.py:76`) | `Polygon`, `extrude`, `Plane * sketch`, `Rot`, `bounding_box` | `offset`; `Edge.make_spline` |
| `Polyline` | `cad-project-013/camera_mount.py`, `camera_mount_assembly.py` | `make_face`, `Plane.YZ`, `extrude`, `bounding_box`, `edges()`, `Edge.tangent_at` | `chamfer` (`camera_mount.py:346`) |
| `import_step` | `cad-project-048/mount.py`, `retrofit-mgn9h/build_p10_mgn9h.py` | – | policy (stays refused; Bend has no STEP import) |
| `Plane.XZ` | `cad-project-026/bar.py` | `Polyline`, `make_face`, `extrude(both=True)`, `Rot` | Boolean: blind cylinder cut (`:122`) |
| `Circle` | `cad-project-003/project-component-abeb2fd3.py` | `Polygon` | sketch Boolean `Circle + Polygon` = cylinder ∪ prism (`:559`) |
| `Cone` | `design-review/lego_test_helpers.py` | – | Boolean: cylinder ∪ cone (`:30`) |
| `RegularPolygon` | `cad-project-013/sanding_pad_sprung.py` | – | `loft` (`:162`) |
| `Solid.make_box` | `single-step-r10/jobs/endstop/geometry.py` | `Plane(...)`, `Solid.make_cylinder`, `Shape.fuse` | Boolean: planar ∪ cylinder (`:14`) |
| `Spline` | `cad-project-047/ei.py` | – | splines (no B-spline curves in Bend) |
| `Wire.make_polygon` | `single-step-r10/jobs/gears/geometry.py` | `Face(wire)`, `Solid.extrude`, `Plane(...) *` | Boolean: blind cylinder cut (`:175`); also reads `CONTRACT.md`, which the corpus mirror lacks |

## API → Bend mapping

| build123d API | Bend operation (existing) | exact? / refusal |
| --- | --- | --- |
| `Location`, `Pos`, `Rot`/`Rotation`, `Location * Location`, `Location * Shape`, `Shape.moved`, `.rotate(axis, deg)`, `.translate(v)` | `transformInBend` (planar) / `transformAnalytic` (analytic), both take a 3×3 rotation and an offset; pure translations keep the existing `translate` op bit for bit | exact rigid motion; a reflection or non-rigid matrix is a capability error ("reflection transform"), `located()` / `.location` are capability errors (no corpus use; they need the shape's stored location) |
| `Plane.XY/XZ/YZ/...`, `Plane(origin, x_dir, z_dir)`, `.offset(d)`, `Plane * Shape` (= `shape.moved(plane.location)`), `Plane * sketch` | Python frame math; placement through the transform above; sketch frames go to the extrusion ops | exact |
| `Polygon`, `Rectangle`, `RegularPolygon`, closed `Polyline` + `make_face`, `Wire.make_polygon(close=True)` + `Face(wire)`, then `extrude` / `Solid.extrude` | `validatePolygon` + orientation + `extrudeInBend` (as `ModelingContext.body()` does for FeatureScript) | exact; collinear corners, self-intersection, holes: the kernel's refusal as a capability error |
| `Circle` extruded | `circularFrustumInBend` (cylinder primitive, so pierce and coaxial Booleans stay available) | exact analytic |
| `RectangleRounded` extruded | 4 lines + 4 three-point arcs → `solveSketchArcs` + `extrudeSketchArcs` (`kernel.sketchArcs`, already loaded by `loadKernel`) | exact analytic arcs, no polygon; the result can only take part in ∩ (curved convex-tool intersection) until W2 has mixed Booleans |
| `Cone(r0, r1, h)` | `circularFrustumInBend` with two radii | exact; a zero radius (apex, valid in build123d: `Cone(3, 0, 2)` = 18.85 mm³) is a capability error ("frustum apex") |
| `Solid.make_box`, `Solid.make_cylinder` | box / cylinder ops with `Align.MIN` and the given `Plane` | exact |
| `Part()`, `Part(x)`, `Compound(children=[...])`, `Shape.fuse/cut/intersect` | Python containers over handles; the existing `boolean` op | `Part()` is empty: `Part() + a` is a new Part equal in geometry to `a`, `bool(Part())` is `False` |
| `a + b` with a multi-solid operand, `fuse(*many)` | distribute over solids in the host: subtraction and intersection solid by solid, union folded solid by solid | exact set identity; today refused ("operands currently require one solid each") |
| 2D sketch Booleans (`Circle + Polygon`, `Rectangle - Circle`) | none (no planar region Boolean). Distributing them over extrusion (`extrude(A ∪ B) = extrude(A) ∪ extrude(B)`) is exact but would only produce cylinder ∪ prism Booleans that Bend refuses in all corpus uses | capability error this round |
| `bounding_box()`, `is_valid`, `solids()`, `shape.wrapped` | host query on `validation.boundsMm` (null for some analytic results: capability error, never invented); every Bend body passed its construction audit, so `is_valid` is `True`; existing `solids` query; `wrapped` returns an opaque token that only `Part()`/`Compound()`/`Solid()` accept | exact or explicit |
| `edges()`, `ShapeList.filter_by/group_by/sort_by(Axis, GeomType)`, `Edge.center/length/radius/geom_type/tangent_at` | new host query over the body's edge records (curve type, endpoints, circle center/axis/radius, curve range) | exact; in all corpus uses these feed `fillet`/`chamfer`, which stay capability errors |
| `fillet`, `chamfer`, `Text`, `offset`, `mirror`, `loft`, `sweep`, `Spline`, `Edge.make_spline`, `section`, `ExportSVG`, `Torus`, `Sphere` | none | capability error naming the missing kernel operation |
| `import_step` (and the other readers) | none; package/external-geometry policy | stays refused |

## build123d 0.13 facts the tasks must reproduce (oracle, `tmp/w5b/semantics.txt`)

- `Rot(x, y, z) == Rot(x,0,0) * Rot(0,y,0) * Rot(0,0,z)` (not the reverse); `Rot(10, 20, 30)` rows
  `[[0.813797681, -0.46984631, 0.342020143], [0.543838142, 0.823172945, -0.163175911], [-0.204874129, 0.318795778, 0.925416578]]`.
- `Rot` is class `Rotation(Location)`, repr `Rotation((0, 0, 0), (90, 0, 0))`; `Pos * Rot` is a plain
  `Location`, repr `Location((1, 2, 3), (0, 0, 90))`; `Location((1,2,3),(10,20,30)) == Pos(1,2,3) * Rot(10,20,30)`.
- Axis-angle form: `Location((0, 0, 18.5), (1, 1, 1), -120)` has repr `Location((0, 0, 18.5), (-90, 0, -90))`.
- `Plane.XY`: x (1,0,0), z (0,0,1). `Plane.XZ`: x (1,0,0), y (0,0,1), **z (0,−1,0)**. `Plane.YZ`: x (0,1,0), z (1,0,0).
  `Plane.XZ.offset(2).origin == (0, -2, 0)`; `extrude(Plane.XZ * Rectangle(2, 4), 3)` spans y −3..0.
- `Polygon((0,0),(4,0),(0,2))` keeps its coordinates by default (same bbox as `align=None`).
- `RegularPolygon(r, n)` is centered on its circumcenter with a vertex on +X (`RegularPolygon(5, 3)` spans x −2.5..5);
  `major_radius=False` makes `r` the apothem.
- `RectangleRounded(w, h, r)` requires `w > 2r` and `h > 2r` (`ValueError: width and height must be > 2*radius`);
  area of `(10, 6, 1)` is 59.14159265358978.
- `extrude(Circle(2), 5)` has faces CYLINDER, PLANE, PLANE; `both=True` extrudes `amount` to each side.
- `Part() + Box(1,1,1)` is a `Part` of volume 1 that is not `is_same` as the box; `bool(Part())` is `False`.
- `Cone(3, 1, 2)` is centered (z −1..1); `align=Align.MIN` puts it in the positive octant.
- `Rot(0, 0, 90) * Box(2, 1, 1)` spans x −0.5..0.5, y −1..1.
- `Solid.make_box(1, 2, 3)` spans the positive octant from the origin.

Call shapes in the corpus (`tmp/w5b/calls.txt`): `RectangleRounded(w, h, r)` only; `Polygon(*pts, align=None)`
or positional points; `Polyline(*pts, close=True)`; `RegularPolygon(r, n, major_radius=, rotation=)`;
`Circle(r)`; `Cone(r0, r1, h[, align])`; `Rot(x, y, z)`; `Location((x, y, z))` and one axis-angle form;
`Plane(origin=, x_dir=, z_dir=)`; `extrude(s, amount=, dir=, both=)`; `Part()` and `Part(shape.wrapped)`;
`Compound(children=[...])`; `edges().filter_by(Axis)`, `.group_by(Axis)[i]`, one `sort_by`.

## Implementation layout

`python/build123d.py` becomes a loader that keeps the name table and sentinels
and binds implemented names from private modules next to it, loaded by path
like `_wonky_color.py` (files starting with `_` are not importable by models,
and frames in them count as shim frames for use-site locations):

- `python/_b3d_core.py`: `Shape`, `Box`, `Cylinder`, `_request`/`_unsupported`
  helpers, exports; `Shape.__getattr__` consults a method registry that other
  modules fill (`register_shape_method(name, fn)`), so wave-2 tasks add methods
  without editing the same file.
- `python/_b3d_location.py`: `Location`, `Pos`, `Rotation`/`Rot`, `Plane`, `Axis`.
- `python/_b3d_sketch.py`: 2D profiles (data only: frame + lines/arcs/circle).
- `python/_b3d_ops.py`: `extrude`, containers, `Solid.*`, `Cone`, Shape
  Boolean/placement methods.
- `python/_b3d_query.py`: `bounding_box`, `is_valid`, `solids`, `edges`,
  `ShapeList`, `Edge`, selectors.

Each module exports `BUILD123D = {name: object}` (top-level names) and
`CLASS_ATTRIBUTES = {"Solid.make_box": fn, ...}`; the loader binds them before
the name table, so the remaining names stay sentinels. A missing module is
skipped, so tasks in one wave can land in any order.

Host protocol additions in `src/python.mjs` (contract for the Python tasks;
queries go into `QUERY_OPS` so they never re-attribute a body):

| op | request | reply |
| --- | --- | --- |
| `transform` | `{handle, rows: [[3]×3], offset: [3]}` | handle; rigid, det +1 within 1e-9, else capability |
| `extrude_profile` | `{profile, plane: {origin, x, normal}, amount, both, dir}`; `profile` is `{kind: "polygon", points}`, `{kind: "circle", center, radius}` or `{kind: "line-arc", entities: [{type: "line"\|"arc", start, mid?, end}]}` (mm, sketch-plane 2D) | handle |
| `frustum` | `{r0, r1, height, align}` | handle (centered like `Cone`) |
| `bounds` | `{handle}` | `{min, max}` or capability when Bend has not evaluated tight bounds |
| `edges` | `{handle}` | edge records `{curve, start, end, center?, axis?, radius?, range?, length}` |
| `boolean` | unchanged request; multi-solid operands are distributed (section above) | handle |

## Tasks

Estimates are about 30 minutes each. Within a wave the file sets are disjoint.
Every task ends with `node --test test/python*.test.mjs` green; expected values
in tests are produced by build123d 0.13.0 offline (`uv run --no-project --with
build123d==0.13.0`) and frozen into the test, as `test/python-shape-protocol.test.mjs` does.

### Wave 1

**A. host-geometry** (`src/python.mjs`, `test/python-host-geometry.test.mjs`).
Ops `transform`, `extrude_profile`, `frustum` from the protocol table. Polygon
profiles through `validatePolygon`/`signedArea` (`src/brep.mjs`) and
`extrudeInBend`; circles through `circularFrustumInBend`; line/arc profiles
through `solveSketchArcs` + `extrudeSketchArcs` (`src/sketch-arcs.mjs`, SI
coordinates = mm / 1000). `dir` not parallel to the plane normal: allowed for
polygons if `extrudeInBend` admits it, capability for circles and line/arc
profiles. Acceptance: bodies equal to the FeatureScript builds of the same
profile (`skLineSegment`/`skArc`/`skCircle` + `opExtrude`, `opTransform`);
rotated cylinder keeps `primitive.type === 'frustum'`; `Rot(90,0,0)`-rotated
through hole still pierces a box; reflection and zero radius give capability
errors.

**B. split + location** (`python/build123d.py`, new `python/_b3d_core.py`,
`python/_b3d_location.py`, `python/cad_khana/_wonky.py`,
`python/cad_khana/mechanism/assembly.py`, `test/python-location.test.mjs`,
`test/python-shape-protocol.test.mjs`). Split the shim as above without
behavior change, then `Location` (3×3 + offset, `*`, `==`/hash by build123d's
`_key`, `repr`/`str`/`format` with intrinsic-XYZ Euler angles, `inverse()`),
`Pos` as its subclass (the Pos protocol tests stay; `isinstance(Pos*Pos, Pos)`
becomes `False` as in build123d, fixing the W5 low finding), `Rot`/`Rotation`,
axis-angle `Location`, `Plane` (named planes, `Plane(origin, x_dir, z_dir)`,
`offset`, `location`, `Plane * Location`, `Plane * Shape`), `Axis.X/Y/Z` and
`Axis(origin, dir)`. cad_khana's identity/compose checks move from `_offset` to
`Location`; nonzero joint angles now work. Acceptance: oracle-frozen matrices,
reprs and equalities from "build123d 0.13 facts"; `pin_hinge/assembly.py`
passes `Location`/`Rot` and stops at the clevis pierce; the three `Location`
files stop at `import_step`; the py-khana repros keep names and colors.

**C. sketch profiles** (new `python/_b3d_sketch.py`,
`test/python-sketch.test.mjs`). `Circle`, `Rectangle`, `RectangleRounded`
(4 lines + 4 three-point arcs, the `w > 2r` check), `Polygon`, `RegularPolygon`
(`major_radius`, `rotation`), `Polyline(close=True)` as a Curve plus
`make_face`, `Wire.make_polygon(close=True)` + `Face(wire)`, `align` on the
bounding box (`None`/`MIN`/`CENTER`/`MAX` per axis), `rotation`, placement by
`Plane *` and `Location *` (a profile keeps its 3D frame), `.area` from the
analytic formula checked against the oracle. `mode` other than `ADD`, 2D
Booleans, open polylines in `make_face` and other kwargs: capability errors.
Pure Python, no host call. Acceptance: vertex/arc lists and areas equal to the
oracle's for every call shape in the census.

### Wave 2

**D. ops** (new `python/_b3d_ops.py`, `test/python-ops.test.mjs`). `extrude`
(algebra mode: `amount`, `dir`, `both`; `taper`, `until`, `target`,
multi-face sketches: capability), `Part()` / `Part(wrapped)` /
`Compound(children=)`, `Solid.make_box`, `Solid.make_cylinder`,
`Solid.extrude(face, vector)`, `Cone` (via `frustum`), `Shape.fuse/cut/intersect`,
`moved`, `rotate(axis, angle)`, `translate`, `wrapped` token. Acceptance: each
corpus call shape against oracle volume and bounding box (relative 1e-9);
`coupons.py` reaches `inspect()`, `endstop/geometry.py` and `merged.py` reach
the planar ∪ cylinder refusal, the 5 cad-project-003 `RectangleRounded` files and
`beam_frame.py` reach the arc-edged Boolean refusal, `bar.py`/`gears/geometry.py`
the blind-hole refusal.

**E. host queries + compound operands** (`src/python.mjs`,
`test/python-host-queries.test.mjs`). `bounds` and `edges` queries (in
`QUERY_OPS`), distribution of Booleans over multi-solid operands. Acceptance:
edge records of a box, a cylinder and a rounded-rect extrusion match the body
JSON; a disjoint union followed by a subtraction builds and equals the
FeatureScript result; bounds of an arc extrusion without evaluated bounds is a
capability error.

**F. kernel-gap messages + user docs** (`python/build123d.py`,
`docs/python-frontend.md`). A `_KERNEL_GAPS` note per kernel-less name
(`fillet`, `chamfer`: "no edge blend in Bend"; `Text`: "no font outlines";
`offset`, `mirror` (reflection), `loft`, `sweep`, `Spline`/`make_spline`
(B-spline curves), `section`, `ExportSVG`, `Torus`, `Sphere`) appended to the
sentinel message; supported-surface and name tables in the user doc.
Acceptance: `python-names` tests updated; every message names the missing
operation.

**G. queries and selectors** (new `python/_b3d_query.py`,
`test/python-query.test.mjs`). `bounding_box()` (`BoundBox` with `min`, `max`,
`size`), `is_valid`, `solids()`, `edges()`/`faces()` as `ShapeList`,
`filter_by(Axis | GeomType)`, `group_by(Axis)` with indexing, `sort_by(Axis)`,
`Edge.center()`, `length`, `radius`, `geom_type`, `tangent_at` — the exact
build123d tolerances and ordering. Acceptance: selector results on a box, a
cylinder and `plate.py`'s first body equal the oracle's (counts, centers); the
eight fillet/chamfer files stop at `fillet`/`chamfer` with the F message.

### Wave 3

**H. corpus run + report** (`docs/corpus/w5b.md`, `docs/python-khana.md` if
needed). `node scripts/corpus/run.mjs --label w5b --only .py --concurrency 3`,
compare with `w5-fix2` (no Python file may regress), classify the new first
blockers, check each moved file's stop against the table above, full `npm
test`, `uv run scripts/validate-step.py` on every STEP a new repro exports.
Acceptance: 37 of 37 moved past their W5 blocker; their new first blockers are
the table's final gaps (or better); 0 regressions among the other 54.

## Closest to building

| file | what is missing after this plan |
| --- | --- |
| `manufacturing/coupons.py` | only the cad_khana diagnostics (`inspect()` inside `try/except SystemExit`, `check()`); the capability is sticky by design |
| `pin_hinge/assembly.py` | kernel: pierce through a U (two arms, four faces perpendicular to the axis); then `check()` in `__main__` |
| `endstop/geometry.py`, `cad-project-025/beam_frame.py`, `gears/geometry.py` | only mixed plane/cylinder Booleans (plus `CONTRACT.md` in the mirror for gears) |
| `tile-clip-sockets/build.py` | `mirror` (reflection) and reading back its own exports |

## Follow-ups outside this workflow's files

**Kernel demand for W2** (files whose first gap it is, after this plan):
1. General plane/cylinder Booleans including arc-edged prisms and cones:
   planar ∪ cylinder, arc body − planar/arc body, blind (pocket) holes,
   pierce through more than two parallel faces, cylinder ∪ cone: 13 files
   first, and the only remaining gap of `endstop/geometry.py`, `beam_frame.py`
   and `gears/geometry.py`.
2. Edge fillet/chamfer on planar and cylinder edges: 8 files first, present in
   19 of the 37 (oracle traces).
3. Reflection transform (`mirror`), frustum with an apex (`Cone(r, 0, h)`),
   planar region Booleans and 2D offset, B-spline curves, non-circular loft.

**Corpus mirror** (`scripts/corpus/run.mjs`, owner of the corpus scripts):
`gears/geometry.py` reads `single-step-r10/CONTRACT.md`, which the mirror does
not copy. Diff:

```diff
-const MIRROR_EXT = /\.(py|json|toml|ya?ml|csv|txt|fs|svg|dxf|cfg|ini)$/i;
+const MIRROR_EXT = /\.(py|json|toml|ya?ml|csv|txt|md|fs|svg|dxf|cfg|ini)$/i;
```

then `rm tmp/corpus/src/.cad-project-041.mirrored` so the project is mirrored again.

**No other JS change is needed**: `src/python.mjs` can import
`validatePolygon`/`signedArea` (`src/brep.mjs`), `extrudeInBend`
(`src/kernel.mjs`), `solveSketchArcs`/`extrudeSketchArcs`
(`src/sketch-arcs.mjs`) and `circularFrustumInBend` (`src/analytic.mjs`) as
they are; `loadKernel()` already loads `kernel.sketchArcs`.

**Policy questions for the product owner** (not decided here):
- cad_khana `check()`/`inspect()` inside the model's build flow is a sticky
  capability error (W5 decision 3). It is the last blocker of `coupons.py` and
  sits behind the geometry of `pin_hinge/assembly.py` and all cad-project-003
  family files. A recorded, non-fatal "diagnostic not run" would let such
  files build once their geometry does.
- Exports are recorded, not written (decision 2); `tile-clip-sockets/build.py`
  hashes its exported files and fails on that alone.

## Risks

- The feasibility emulation is optimistic (coaxiality, tool convexity, pierce
  admission). The kernel probe already moved `pin_hinge` from "none" to a
  pierce refusal; task H confirms every stop with the production CLI.
- Rotations pass through the kernel's F32 vector encoding; volume comparisons
  with the oracle use relative 1e-9, and any larger drift is reported, not
  hidden.
- `sanding_head.py` fails in the real build123d too; it is not an acceptance
  target.
