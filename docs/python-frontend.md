# Python Algebra frontend

The Python frontend executes real Python with a small `build123d` compatibility
module. Every `Shape` refers to B-reps already constructed by the existing Bend
kernel. The existing FeatureScript frontend remains a separate entrypoint.

This is a first, bounded frontend component. It is **not full build123d
compatibility or a complete geometry kernel**. The supported subset below
exposes current kernel capabilities and fails explicitly at their boundaries.

## Run a model

Node.js 22.18 or newer, the repository's installed Bend toolchain (`npm run
setup`), and Python 3.10 or newer are required. No build123d, OCP or CAD Python
package is installed or imported for model construction. The frontend was
checked with Python 3.14.5.

```sh
node bin/wonky-python.mjs examples/python-spacer.py --out out/python-spacer
node bin/wonky-python.mjs examples/python-box.py --format all --out out/python-box
node bin/wonky-python.mjs examples/python-spacer.py --check
```

The default output is `.step` plus `.brep.json`. `--format all` additionally
exports STL and HTML for planar bodies; curved-body tessellation is explicitly
unsupported there (a model's own `export_stl()` meshes curved bodies within its
tolerance, see "Exports"). Export contents are generated before any output is
written.

```python
from build123d import *
from math import isclose, pi

outer = Cylinder(8, 12)
tool = Cylinder(3, 14)
result = Pos(20, -10, 6) * (outer - tool)
assert isclose(result.volume, pi * 12 * (8**2 - 3**2), rel_tol=1e-10)
```

A model runs like `python model.py`: as `__main__` with `__file__` and
`sys.argv` set, so its `if __name__ == "__main__":` block runs. Intermediate
shapes are computed eagerly, but only the result's bodies are exported.
Ordinary Python loops, functions, conditions, comprehensions and
standard-library imports execute in CPython; volume queries can drive those
decisions. Printed output is separate from the geometry protocol.

### Result contract

The model's result is resolved after the module has run; the first match wins:

1. a module-level `result` (a `Shape` or an assembly);
2. a module-level `assembly` (the cad_khana convention, see
   [python-khana.md](python-khana.md));
3. the objects passed to `show()` / `show_object()` (wonky's `ocp_vscode`) or
   to `export_step()` / `export_stl()`, in call order, each under the name used:
   `names=` / `name=`, else the export file's stem, else the variable name.
   A body passed several times appears once, under its first name. Exports are
   recorded as outputs **and** write their file at the call (see "Exports"
   below; `--out` still writes the model); non-default options wonky does not
   apply are listed as ignored. `colors=` / `alphas=` and
   `show_object(options={"color": ...})` become the bodies' `appearance`;
4. otherwise the build fails with `NoResultError`, which lists the
   module-level bindings and their types and restates this contract.

Several top-level shapes are never guessed between. When `result` or
`assembly` wins, show/export calls are counted in `model.source.ignoredCaptures`
and the CLI says so. An assembly is any object whose type defines
`_wonky_parts()` (cad_khana's `Assembly` does): each part becomes a body with
its name and color, which the viewer's parts tree shows.

### Exports

Decision 13 (product owner, 2026-09-24): `export_step()` and `export_stl()`
write real files, from Bend geometry, at the moment they are called, so a
script can read its exports back (tile-clip's `build.py` hashes them).

- **Path.** Resolved as `open()` resolves it: joined to the Python process's
  working directory, which is the directory the CLI was started in (and
  follows `os.chdir()` in the model), and not normalized lexically, so in
  `link/../x.step` the `..` applies after the symlink, as the OS does. A
  missing directory before `..` is `FileNotFoundError`, a NUL byte
  `ValueError`. The host resolves the existing prefix with realpath(3)
  (`realpathSync.native`), which also yields the on-disk case of each
  component. `buildPython({ cwd })` sets the working directory for embedders.
- **Scope.** The target, with symlinks resolved, must lie inside the model's
  project directory: the nearest ancestor holding a `pyproject.toml` (as for
  `sys.path`), else the model directory. Anything else is refused with
  `ExportRefusedError` (Python sees `PermissionError`), latched like a
  capability error, so `try/except` cannot turn it into a success. A model
  without a file on disk (in-memory source) has no project directory, and its
  exports are refused. The model's own source file is never overwritten.
- **Read-only roots.** `--read-only <dir>` (`readOnlyRoots`) refuses writes
  below `<dir>` explicitly. On macOS and Windows the comparison is
  case-insensitive, so `FROZEN/x.step` cannot bypass a read-only `frozen` on
  APFS. The corpus root `~/Workspace/cad` (and `WONKY_CORPUS_ROOT` when set)
  is read only for every run, with no opt-out: for the corpus mirror of
  `scripts/corpus/run.mjs` under `tmp/corpus/src`, and also for a model run
  from the corpus directly; the refusal says so.
- **Writing.** The file is written to a fresh temporary file next to the
  target (random name, opened with `O_CREAT|O_EXCL|O_NOFOLLOW`), then renamed
  over it, so a model cannot plant a symlink at the temporary name to
  redirect the write. A symlink at the target itself is resolved before the
  scope check.
- **Contents.** The exporters of `bin/wonky.mjs`: `toStep` from
  `src/exporters.mjs` for STEP (all bodies of the exported shape, assembly or
  list, in one file). For STL, planar bodies are the B-rep's own exact facets
  (`toStl`), which meet any tolerance; a curved body goes through
  `toPrintStl` (`src/print-mesh.mjs`, the mesh of `--format print`) with the
  requested `tolerance` as chord deviation (build123d default 0.001 mm).
  `angular_tolerance` is not applied and the file record says so. STL is
  binary unless `ascii_format=True`, as in build123d. STEP options (`unit`,
  `write_pcurves`, `precision_mode`, `timestamp`) are listed as ignored:
  wonky writes millimeters and its own curves.
- **I/O errors** are Python's: a missing directory is `FileNotFoundError`
  (build123d does not create directories either), a directory target
  `IsADirectoryError`. They are not latched; the output record then has
  `written: false`, and the CLI prints `NOT written`.
- **Provenance.** Every written file is appended to
  `model.source.writtenFiles` (also `error.writtenFiles` on failure):
  `kind`, absolute `path`, `projectPath`, the `requested` path, `sha256`,
  `bytes`, `bodyIds`, source `location`, `format` and the exporter/mesh
  details. The output record of the export carries `written: true` and
  `file: {path, sha256, bytes}`. The CLI prints one line per file:
  `export_step('part.step') wrote /…/part.step (STEP, 5823 bytes, sha256 …) ← python/1`.

The `--check` flag only skips the CLI's own `--out` files; the model's export
calls still write, because the script may depend on them.

Corpus runs (`scripts/corpus/run.mjs`) start Python in `tmp/corpus/work/<slug>`,
not in the mirrored model directory. Exports to absolute paths below the
model's own directory (`Path(__file__).parent / ...`, the common corpus
pattern) land in the mirror. A relative export path resolves into the work
directory and is refused as outside the project. In the policy run on
2026-09-24 no file reached such an export.

## Supported compatibility surface

All dimensions are millimeters, rotation arguments are degrees, and `.volume`
is cubic millimeters. Positive, finite dimensions are required.

| Syntax | Behavior |
| --- | --- |
| `from build123d import *` or named imports | Loads the local Bend compatibility module. |
| `Box(length, width, height)` | Centered box, constructed by Bend's planar extrusion. |
| `Cylinder(radius, height)` | Centered, complete analytic cylinder along Z. |
| `align=Align.MIN`, `.CENTER`, `.MAX` | Applies the alignment to all three axes. |
| `align=(Align.MIN, Align.CENTER, Align.MAX)` | Selects alignment independently for X, Y and Z. |
| `Pos(x, y, z) * shape`, `Rot(x, y, z) * shape`, `Location(...) * shape`, `Plane.XZ * shape`, `shape.moved(loc)` | Returns an immediately placed B-rep; the input is unchanged. See "Locations, rotations, planes and axes" below. |
| `Pos((x, y, z))`, `Pos(X=x, Y=y, Z=z)` | Tuple/list or uppercase keyword coordinates. Missing coordinates are zero. |
| `Pos(...) * Pos(...)`, `Pos(...) * Rot(...)` | Composes locations (a plain `Location`, as in build123d). |
| `shape + shape`, `shape - shape`, `shape & shape` | Bend union, subtraction and intersection within the limits below. |
| `shape.volume` | Reads the computed B-rep volume; sums multiple result solids. |
| `bool(shape)`, `if shape:`, `len(shape)`, `for solid in shape`, `list(shape)` | build123d's `Compound` protocol over the solids Bend holds: an empty Boolean result (`Box(1, 1, 1) & Pos(10, 0, 0) * Box(1, 1, 1)`) is falsy and has length 0; iteration yields one `Shape` per solid, sharing that solid. |
| `shape == other`, `hash(shape)`, `shape in shapes`, `copy.copy(shape)` | build123d's `is_same()`: the same B-rep at the same place, never equal geometry (`Box(1, 1, 1) == Box(1, 1, 1)` is `False`). `copy.copy` shares the B-rep and compares equal; `copy.deepcopy` is a capability error. |
| `shape += other` | `shape + other` bound to `shape`, as build123d's `Part.__iadd__`; other references keep the old shape. |
| `[Pos(...), ...] * shape`, `Pos(...) * [shape, ...]`, `Pos(...) * [Pos(...), ...]` | One placed shape (or composed location) per item, as build123d; planes and locations mix. Any other left operand is build123d's `TypeError` (`Shape cannot be multiplied by int`). |
| `Pos(...) == Pos(...)`, `hash(Pos(...))` | build123d's `Location` key: positions and the canonical quaternion rounded to 5 decimals; equal hashes. |
| `Pos(...) ** n` (integer `n`) | The location applied `n` times, as `TopLoc_Location.Powered`. |
| `repr()`, `str()`, `format()` of a `Pos` | build123d 0.13's text (`Pos((1, 2, 3), (0, 0, 0))`); a composed or powered `Pos` is a plain `Location` (prints and `isinstance()`), as in build123d. |
| `rotation=(0, 0, 0)`, `mode=Mode.ADD` | Accepted primitive defaults. |
| `Cylinder(..., arc_size=360)` | Complete cylinders only. |
| `Vector`, `Location`, `Rotation`/`Rot`, `Plane`, `Axis` | build123d's geometry values; see "Locations, rotations, planes and axes". |
| `Circle`, `Rectangle`, `RectangleRounded`, `Polygon`, `RegularPolygon`, `Polyline`, `Wire.make_polygon`, `Face(wire)`, `make_face`, `Sketch()` | 2D profiles; see "2D profiles". |
| `extrude`, `Part`, `Compound`, `Solid.make_box`, `Solid.make_cylinder`, `Solid.extrude`, `Cone`, `fuse`/`cut`/`intersect`, `rotate`, `translate` | Algebra-mode operations and containers; see "Operations and containers". |
| `shape.edges()`, `shape.solids()`, `shape.bounding_box()`, `shape.is_valid`, `ShapeList.filter_by/group_by/sort_by`, `Edge`, `BoundBox` | Queries and selectors over the Bend B-rep; see "Queries and selectors". |
| `fillet`, `chamfer`, `Text`, `offset`, `mirror`, `loft`, `sweep`, `Spline`, `Edge.make_spline`, `section`, `ExportSVG`, `Torus`, `Sphere` | Capability errors that name the operation the Bend kernel lacks; see "Operations the Bend kernel lacks". |

Alignment follows bounding-box placement: `Box(10, 6, 4)` spans
`(-5, -3, -2)` to `(5, 3, 2)`, while `align=Align.MIN` spans `(0, 0, 0)` to
`(10, 6, 4)`. A centered `Cylinder(3, 10)` spans `(-3, -3, -5)` to `(3, 3, 5)`;
`align=Align.MIN` moves its axis to `(3, 3)` and its bottom to `z=0`.

Planar boxes reuse the existing F32 extrusion/validation path and its finite
±10,000 mm coordinate envelope. Cylinder geometry and its mass properties use
the existing F32x2 analytic Bend path. The exported model records the applicable
precision. Box volume is the existing JavaScript B-rep validator's measurement;
cylinder and supported Boolean volumes are evaluated by Bend. No volume is
substituted from a frontend dimension formula.

### Locations, rotations, planes and axes

`python/_b3d_location.py` implements build123d 0.13's `Vector`, `Location`,
`Rotation`/`Rot`, `Pos`, `Plane` and `Axis` in pure Python. The arithmetic ports
the OpenCascade classes build123d wraps (`gp_Trsf` with its forms,
`TopLoc_Location` chains, `gp_Quaternion` Euler sequences, `gp_Ax3`), so
printed text, equality and hashing match build123d 0.13.0, which
`test/python-location.test.mjs` checks against values frozen from it. Raw
floats (unformatted `format(loc)`, `tuple(loc.position)`) agree to about 1e-15:
OCCT's arm64 build fuses multiply-adds, so build123d's own last bits depend on
the platform.

| Syntax | Behavior (as build123d 0.13.0) |
| --- | --- |
| `Rot(x, y, z)`, `Rotation(x, y, z, ordering)`, `Rot((x, y, z))`, `Rot(axis, angle)` | Intrinsic XYZ Euler angles in degrees (`Rot(x, y, z) == Rot(x, 0, 0) * Rot(0, y, 0) * Rot(0, 0, z)`), every `Intrinsic`/`Extrinsic` order, or a rotation about an `Axis` line. |
| `Location((x, y, z))`, `Location(pos, (a, b, c)[, ordering])`, `Location(pos, angle)`, `Location(pos, direction, angle)`, `Location(plane)`, `Location(location)` | Position plus orientation; `angle` alone turns about Z; `direction, angle` is the axis-angle form (`Location((0, 0, 18.5), (1, 1, 1), -120)` prints `Location((0, 0, 18.5), (-90, 0, -90))`). |
| `a * b`, `a.inverse()`, `a ** n`, `a == b`, `hash(a)` | Composition (a plain `Location`), inverse, power, build123d's `_key` (position and canonical quaternion rounded to 5 digits). |
| `repr()`, `str()`, `format()`, `.position`, `.orientation` (read and assign), `.x_axis`/`.y_axis`/`.z_axis`, `.center()` | build123d's text with intrinsic XYZ Euler angles, e.g. `Rotation((0, 0, 0), (90, 0, 0))`, `Location((1, 2, 3), (0, 0, 90))`. |
| `Plane.XY`, `.XZ`, `.YZ`, `.ZX`, `.YX`, `.ZY`, `.front`, `.back`, `.left`, `.right`, `.top`, `.bottom`, `.isometric` | Named planes; `Plane.XZ` has z = (0, -1, 0), so `Plane.XZ * Box(1, 2, 3, align=Align.MIN)` spans y -3..0. |
| `Plane(origin, x_dir, z_dir)`, `Plane(origin=..., z_dir=...)`, `Plane(origin, x_dir, y_dir=...)`, `Plane(location)`, `Plane(axis)` | A right-handed frame (OCCT `gp_Ax3`; `x_dir` is projected into the plane; a default `x_dir` follows `gp_Ax3`). |
| `plane.offset(d)`, `.location`, `.origin`, `.x_dir`, `.y_dir`, `.z_dir`, `-plane`, `.reverse()`, `.moved(loc)`, `.rotated(angles)`, `==` | `Plane.XZ.offset(2).origin` is (0, -2, 0). |
| `plane * location`, `plane * plane`, `location * plane`, `plane * shape` | `Location(plane) * location`; `plane.moved(location)`; `shape.moved(plane.location)`. |
| `Axis.X`/`.Y`/`.Z`, `Axis(origin, direction)`, `Axis(origin, end_point=...)`, `Axis(location)`, `.position`, `.direction`, `.location`, `.located(loc)`, `-axis`, `==` | A point and a unit direction. |
| `Vector(x, y, z)` and its arithmetic, `dot`, `cross`, `length`, `normalized`, `rotate`, `project_to_plane`, ... | build123d's `Vector`, returned by `.position`, `.origin`, `.direction`. |

A placed shape is its unplaced B-rep at a location chain, as OCCT's TShape at
a `TopLoc_Location`: moving composes the chains and builds the B-rep once at
the composed transformation (host op `translate` for a pure translation,
`transform` otherwise). The same B-rep at an equal chain is the same shape:
`p * box == p * box` and `(p * p.inverse()) * box == box`, while
`Location() * box` is a new shape. `moved()` keeps the class (`Rot(...) * Box(...)`
is a `Box`).

Capability errors at the use site: OCP objects (`.wrapped`, `.to_gp_ax3()`,
`Location(gp_trsf=...)`), `Plane(face)` and `Axis(edge)`, the geometric queries
not listed above (`Plane.to_local_coords`, `Location.mirror` (whose message
names the missing reflection transform), `Axis.is_parallel`,
`Vector.transform`, `&`/`intersect`), `-location` (an orientation flip),
iterating a location, and non-integer powers. Attributes build123d does not have
are ordinary `AttributeError`s.

### 2D profiles

`python/_b3d_sketch.py` implements build123d 0.13's 2D profiles as pure Python
data: a planar frame plus straight lines, three-point arcs or one circle. They
ask the Bend host for nothing until an operation such as `extrude` hands their
faces over; arcs and circles stay analytic, nothing is polygonized.

| Syntax | Behavior (as build123d 0.13.0) |
| --- | --- |
| `Circle(r)`, `Rectangle(w, h)` | Centered; the circle's seam vertex is on the frame's +X. |
| `RectangleRounded(w, h, r)` | 4 lines and 4 tangent quarter arcs; `w > 2*r` and `h > 2*r`, else `ValueError: width and height must be > 2*radius`. |
| `Polygon(*pts)`, `Polygon([pts])` | Keeps its coordinates (`align=(Align.NONE, Align.NONE)`); the face normal follows the winding, so clockwise points face -Z. |
| `RegularPolygon(r, n, major_radius=True, rotation=0)` | Centered on its circumcenter with a vertex at `rotation` degrees from +X (`RegularPolygon(5, 3)` spans x -2.5..5); `major_radius=False` makes `r` the apothem. |
| `Polyline(*pts, close=True)`, `make_face(polyline)` | A polygon wire and its face; `make_face` flips a face whose normal has a negative world Z. |
| `Wire.make_polygon(pts, close=True)`, `Face(wire)` | 2D or 3D points; the planar face keeps the wire's winding. |
| `align=`, `rotation=` | Align on the unrotated bounding box, then rotate about the sketch origin. |
| `Plane * profile`, `Location * profile`, `[locations] * profile`, `profile.moved(loc)` | A placed copy (`shape.moved(plane.location)`); `Plane.XZ * Rectangle(2, 4)` faces -Y. |
| `profile.area` | Analytic (Green's theorem over lines and arcs); `RectangleRounded(10, 6, 1).area` is 59.1415926535898. |
| `Sketch()`, `Sketch() + profile`, `profile + None`, `bool()`, `len()`, iteration, `==` | Empty sketch, the profile itself without a Boolean, the faces, and `is_same()` equality. |

Capability errors: every other 2D Boolean (`+`, `-`, `&` of profiles, and
`Sketch() + [a, b]`) needs a planar region Boolean, which Bend does not have;
`mode` other than `Mode.ADD`; `Circle(arc_size != 360)`; zero, negative or
degenerate dimensions and outlines (collinear, self-intersecting); `make_face`
of several wires or edges; every other attribute of a profile. An open wire in
`make_face`, a non-planar `Face(wire)` and unknown keyword arguments raise the
same `ValueError`/`TypeError` as build123d.

### Operations and containers

`python/_b3d_ops.py` implements build123d 0.13's algebra-mode operations on
Bend bodies; the host builds every body (`extrude_profile`, `frustum`,
`boolean`), and `test/python-ops.test.mjs` holds the values frozen from
build123d.

| Syntax | Behavior (as build123d 0.13.0) |
| --- | --- |
| `extrude(profile, amount, dir=None, both=False)` | One prism of the face along `unit(dir or face normal) * amount`; `both=True` spans -amount..+amount. Polygons, circles (a Bend cylinder, so pierce and coaxial Booleans stay available) and line/arc profiles such as `RectangleRounded` (exact arcs). `clean=` and `mode=` change nothing in algebra mode, as there. |
| `Part()`, `Compound()`, `Part(shape.wrapped)`, `Compound(children=[...])`, `Compound([...])` | Empty containers are falsy: `Part() + x` is a new Part with x's solid, `x + Part()` is x, `Part() - x` and `Part() & x` raise build123d's `ValueError`. `Compound()`, `Part()`, `Sketch()` and an empty Boolean result have no wrapped shape, as there: moving one is `ValueError: Cannot move an empty shape`, and listing one (also `Plane * x`, which lists `x` first) or `Compound() + x` is build123d's bare `AssertionError`; `Compound([])` lists as `[]`. A container of several shapes keeps their Bend bodies apart: Booleans distribute over the members exactly, volumes and solid counts add up, and used as one shape (result, export, queries) it is the host's `compound` op, all member solids unfused and unchanged. |
| `Solid.make_box(l, w, h, plane)`, `Solid.make_cylinder(r, h, plane)`, `Solid.extrude(face, v)` | On the given plane; `Solid.extrude` for one planar face. |
| `Cone(bottom_radius, top_radius, height, align=..., rotation=...)` | A Bend frustum aligned like build123d (`align=None` is the cone's own frame), then rotated. |
| `a.fuse(b, ...)`, `a.cut(b, ...)`, `a.intersect(b)`, `+`, `-`, `&` | The host's binary Boolean folded over the operands; `intersect` returns a `ShapeList` of solids or `None`. Result classes (`Solid`, `Part`, `Compound`) follow build123d's for the common operand classes. |
| `shape.rotate(axis, angle)`, `shape.translate(v)` | `moved()` by one new location. |

Capability errors at their use: `extrude(until=, target=, taper=)` and extruding
several faces at once, an oblique `dir` for circles and line/arc profiles,
`Cone(arc_size=)` partial arcs and a zero radius (the frustum apex Bend lacks),
`Solid.make_cylinder(angle=)`, other `Solid(...)` constructions,
`fuse(glue=, tol=)`, `intersect(include_touched=True, tolerance=)`, intersecting
a solid with a 2D or 1D object, `rotate`/`translate(transform=True)`, the
`color=`/`material=`/`joints=`/`parent=` arguments, any use of `shape.wrapped`
other than handing it to `Part`/`Compound`/`Solid`, and using an empty container
as a Bend body (it has none). The Boolean limits below apply unchanged.

Profiles Bend can only build approximately are refused, not built: a polygon
vertex that lies off the line of its neighbours by no more than the profile
tolerance (`tolerance(points)`, at least 1e-5 mm; the kernel would merge it
under its `PROFILE_MERGE.allowRegularized` policy and mark the body
'regularized', while build123d keeps it as a corner, e.g.
`Polygon((0, 0), (200, 1e-4), (400, 0), (400, 300), (0, 300))`), and any
profile edge at or below the length Bend resolves (the profile tolerance before
building, the body's own `validation.toleranceMm` after it, 3e-4 mm for small
line/arc bodies): `RectangleRounded(10, 6, 3 - 1e-10)` has two 2e-10 mm sides
that build123d merges into half circles and that would export as no solid.
Exactly collinear vertices merge in both, as build123d's `clean()` does.

### Queries and selectors

`python/_b3d_query.py` evaluates build123d 0.13's queries from two host
queries over the Bend B-rep (`bounds` and `edges` in `src/python.mjs`): the
tight bounds of the solids and one analytic record per edge (line or circle
arc, end points, carrier range). Everything else is computed exactly from
those records; `test/python-query.test.mjs` and `test/python-unify.test.mjs`
freeze the build123d values.

The edge records are build123d's edges after `clean()`
(ShapeUpgrade_UnifySameDomain, which `+`, `-`, `&`, `fuse`, `cut` and
`extrude` apply), not Bend's raw topology: Bend keeps coplanar faces and
collinear edges split after a Boolean, so the host query removes every edge
between two faces of one plane (OCCT's tolerances, 1e-7 mm and 1e-12 rad),
merges partial cylinder or cone faces split along a circle, and chains
collinear lines and co-circular arcs that meet at a vertex of only those two
edges between the same two faces. `(Box(10, 10, 10) + Pos(5, 5, 5) *
Box(10, 10, 10)).edges()` has build123d's 30 edges (Bend's body has 84). The
body itself, its volume and its export are unchanged.

| Syntax | Behavior (as build123d 0.13.0) |
| --- | --- |
| `shape.bounding_box()` → `BoundBox` with `.min`, `.max`, `.size`, `.center()`, `.diagonal`, `.measure` | build123d's `optimal` box: tight, no gap; the union of the solids' boxes; zeros for an empty shape. |
| `shape.is_valid` | `True`: every Bend body passed its construction audit when it was built. |
| `shape.solids()`, `shape.edges()` | `ShapeList`s of solids (sharing their B-reps) and of `Edge`s of every solid. |
| `Edge.center()` (`CenterOf.GEOMETRY`, `CenterOf.MASS`), `.length`, `.radius`, `.arc_center`, `.geom_type`, `.is_closed`, `.start_point()`, `.end_point()`, `.position_at(t)`, `.tangent_at(t)` (`PositionMode.PARAMETER` or `LENGTH`), `edge @ t`, `edge % t` | Exact for lines and circle arcs; `center()` is the arc-length midpoint (`position_at(0.5)`), so a full circle's center is the point opposite its seam; `CenterOf.MASS` is the analytic centroid. `radius`/`arc_center` of a line raise build123d's `ValueError`. |
| `ShapeList.filter_by(Axis \| GeomType \| callable \| property, reverse=, tolerance=)`, `.group_by(Axis \| SortBy \| callable \| property)` (indexing, `group(key)`, `group_for(shape)`), `.sort_by(...)` (same criteria), `>`, `<`, `\|`, `<<`, `>>`, `+`, `-`, `&`, `==`, `.first`, `.last`, `.center()`, `.edges()`, `.solids()`, list operations | build123d's tolerances (`filter_by(Axis)`: parallel within `tolerance` degrees, gp_Dir.Angle), keys (`round(z, 6)` in the axis frame) and group order; `SortBy.LENGTH`, `RADIUS`, `DISTANCE`. |

Where OpenCascade's merge is not determined by the Bend body, `edges()` is a
capability error, never a guess: a full (seamed) cylinder or cone that Bend
splits into several faces (`Cylinder(3, 4) + Pos(0, 0, 4) * Cylinder(3, 4)`,
a blind pocket in a cylinder), since build123d merges such faces or keeps them
depending on their surface parametrizations (seam angle, extrusion direction);
a curved face split along a line; and a circle extruded with `both=True`
(build123d fuses two extrusions and keeps 4 faces and 5 edges; Bend builds one
cylinder), including every body later built from it.

Two things build123d takes from OpenCascade's topology traversal, which Bend
does not reproduce: the order of `edges()` and each edge's direction. Neither
is guessed. A `ShapeList` knows which of its edges are only in Bend's order
among each other: `edges()` as a whole, set results of `-` and `&`, and
edges with equal keys after `sort_by` or inside a group. Indexing, `first`,
`last`, a slice that cuts through such a tie, `index` and `pop` that would
pick one of them are capability errors (`Box(1, 2, 3).edges().sort_by(Axis.Z)[0]`
ties four bottom edges); picks by keys that separate the edges work and equal
build123d (`Box(1, 2, 3).edges().sort_by(Axis.Z)[-4:]`, the top four as a set),
as do filters, groups, whole-list iteration and passing whole lists on.

Float noise is treated the same way. build123d does not round sort keys, so
keys that are mathematically equal carry OpenCascade's rounding noise there and
Bend's here (the edges of `extrude(Plane(z_dir=(1, 2, 3)) * Rectangle(2, 2), 1)`
are exactly 1.0 and 2.0 long in build123d, 0.9999999999999994 to
2.0000000000000067 in Bend). Every edge record states its body's coordinate
noise (1e-10 of the coordinate scale for Bend's F32x2 words, more if the
kernel's incidence audit says so; 1e-5 of it for F32 words). Keys within
their combined slack (4 x noise + 1e-10 of the key) of each other are one tie
after `sort_by`, even when Bend computes them exactly equal (OpenCascade may
not): `.sort_by(Axis.X).sort_by(Axis.Y).sort_by(Axis.Z)[0]` on a box is
refused, because its four bottom edges share one Z key. `group_by` refuses a
key whose rounding to `tol_digits` the noise could flip (`Pos(0, 0, 5e-7) *
Box(1, 1, 1)`), and groups by keys `round()` cannot round (tuples) only when
no two keys lie within noise. `filter_by(Axis)` refuses an edge whose angle to
the axis lies within its noise of the tolerance (`Rot(1e-5, 0, 0) * Box(1, 1,
1)` with the default 1e-5 degrees). User code that compares noisy values
itself (`e.center().X > 0`, `e.length == 2`) sees Bend's rounding and is not
checked. Direction-
dependent evaluations are capability errors: `start_point()`/`end_point()`
of an open edge, `position_at(t)` other than the midpoint (`t = 0.5`; a
closed circle also allows 0 and 1, its seam vertex), `tangent_at`, `@` and
`%` accordingly. Plain Python iteration order (`for e in shape.edges()`, a
list comprehension indexed afterwards) is Bend's and cannot be checked.

Seams: a full cylinder (or cone) face has one seam line, and its end circles
start there, so `center()` of such a circle (the point opposite the seam),
`position_at(0)`/`(1)` and the seam line's own center depend on where it lies.
build123d keeps the seam of the operand surface a face comes from, also after a
Boolean: `Box(10, 10, 4) - Pos(2, 1, 0) * Rot(0, 0, 70) * Cylinder(1, 5)` has
its hole seam at (2.342, 1.940, 0), the tool's. Bend rebuilds such surfaces
with its own reference direction, so the host records, per Boolean result,
the angle from Bend's seam to the operand's (kept through rigid moves and later
Booleans) and `edges()` reports the seam line and end circles there. When no
single operand surface fixes the seam (two coaxial equal cylinders with
different seams, `Rot(0, 0, 70) * Cylinder(1, 4) & Rot(0, 0, 10) *
Cylinder(1, 8)`), those edges refuse `center()`, `position_at` and
`start_point`/`end_point`; lengths, `filter_by` and keys along the cylinder
axis still work. A seam that must move on a face bounded by anything other than
its seam and end circles, or an unknown seam on a cone, makes `edges()` a
capability error. A full circle merged from arcs with no vertex left (its seam
would be OpenCascade's choice) refuses `center()` and `position_at` the same
way. Centers, lengths, radii, groups, their order and their contents are
build123d's. Capability errors at their use: `faces()`,
`vertices()`, `wires()`, `Edge(...)` and `BoundBox(...)` construction,
`select=` other than `Select.ALL`, `bounding_box(optimal=False)`,
`filter_by(Plane | Convexity)`, `group_by`/`sort_by` by an edge or `Convexity`,
`SortBy.AREA`/`VOLUME`, `tangent_at(point)`, `center(CenterOf.BOUNDING_BOX)`,
bounds of an analytic body whose tight bounds Bend has not evaluated, and every
other `Edge`/`BoundBox`/`ShapeList` attribute.

### Operations the Bend kernel lacks

Some build123d operations cannot be built by any shim code because the Bend
kernel has no such operation. Their capability error (at the use site, like
every other) names the missing kernel operation, from `_KERNEL_GAPS` in
`python/build123d.py`, so a model that stops there shows kernel demand, not a
missing binding:

```text
build123d.fillet is not implemented by the Python frontend; Bend has no edge blend (fillet of solid edges);
2D vertex fillets of sketch profiles are not implemented either
```

| build123d name (also as the method) | Missing Bend operation | What Bend has instead |
| --- | --- | --- |
| `fillet`, `chamfer` (`part.fillet`, `part.chamfer`) | edge blend (fillet/chamfer of solid edges); 2D vertex fillets and chamfers of sketch profiles are not implemented either | `RectangleRounded` builds its corner arcs directly |
| `Text` (`Compound.make_text`) | font outlines (font loading, glyph outline curves) | – |
| `offset` (`offset_2d`, `offset_3d`) | offset of 2D wires and faces or of solid surfaces | – |
| `mirror` (`shape.mirror`, `Location.mirror`) | reflection transform | rigid transforms (rotation with determinant +1) |
| `loft` (`Solid.make_loft`) | general loft (ruled or skinned surfaces) | the exact frustum between two coaxial circles (`Cone`) |
| `sweep` (`Solid.sweep`, `Face.sweep`) | sweep along a path | straight extrusion and revolution |
| `Spline`, `Edge.make_spline` | B-spline curves | lines, circles and ellipses |
| `section` | planar section faces | solid/plane section contours (`kernel/section.bend`) |
| `ExportSVG` | 2D drawing export (edge projection with hidden-line removal) | STEP and STL export |
| `Torus` (`Solid.make_torus`) | torus surface | planes, cylinders and cones |
| `Sphere` (`Solid.make_sphere`) | sphere surface | planes, cylinders and cones |

The method forms are the build123d 0.13.0 methods of the same operation
(`Shape`, `Part`, `Compound`, `Solid`, `Sketch` and the 2D profiles `mirror`,
`fillet`, `chamfer`, `offset_3d`; `Wire`/`Edge.offset_2d`). On an implemented
class, reading the attribute is the use site (`Pos.mirror` fails there, as any
other unimplemented attribute of an implemented class does); an implementation
added later by a shim module takes precedence over the note.

## Kernel and API limits

The coaxial Boolean path accepts **two coaxial cylinder primitives**, including
translated cylinders, and uses the existing radial/axial arrangement in Bend.
Through holes, open recesses, intersections, unions and split/disconnected
results are supported. Axis tolerance is 1e-9 mm; radial/axial intervals must
exceed 1e-7 mm. Enclosed void shells remain unsupported.

The additional [convex planar intersection](halfspace.md) path supports
`Box(...) & Box(...)`, translated boxes and subsequent intersections of its
results. Its shared-edge construction, caps, volume and bounds run in Bend.
`examples/convex-intersection.py` exercises this path. It exports STEP and B-rep;
`--format all` is still unavailable for its analytic result representation.

The integrated [planar arrangement](planar-boolean.md) also supports admitted
plane/line **union and subtraction**, including nonconvex results, open pockets,
through holes and subsequent planar operations. Its resource, trim-coverage,
zero construction-budget and embedded-source requirements apply unchanged to
Python. The [identical-code benchmark](build123d-performance.md) includes real
Python union, pocket and frame-with-tab programs through this path.

General mixed planar/curved Booleans, noncoaxial cylinders and new
Booleans on the coaxial arrangement results remain unsupported. A Boolean result can contain several
solids; translation and volume work on that collection. An empty Boolean has
volume zero, but an empty final `result` is rejected rather than exported as a
successful model. Empty and multi-solid operands follow build123d (see "Operations and containers").

Primitive `rotation=` arguments, partial cylinders, Builder mode, 2D sketch
Booleans, face and vertex queries, shelling and other unlisted build123d APIs
are not implemented here; fillets, chamfers, lofts and the other operations the
kernel lacks are listed above. Primitive keyword arguments are checked; unknown arguments
and unsupported modes fail explicitly. Shape attributes and mutation are not
silently accepted. The Python protocol of `Shape` and `Location` (truth value,
length, iteration, equality, hashing, copying, printing, operators) either
behaves as build123d 0.13 does, checked against build123d itself in
`test/python-shape-protocol.test.mjs` and `test/python-location.test.mjs`, or is
a capability error at its use: `-Pos(...)` (an orientation flip), iterating a
`Pos` (build123d `Vector`s), `Pos(...) & ...`, a non-integer `Pos` power and
`copy.deepcopy(shape)`. An undefined Python local variable remains an ordinary
Python `NameError`.

### The build123d name table

The shim binds every public name of build123d 0.13.0. The table is generated
from the real package, introspection only, and frozen with its provenance in
`python/build123d_names.json`:

```sh
uv run --no-project --quiet --with build123d==0.13.0 \
  python scripts/python/build123d-names.py python/build123d_names.json
```

It holds the 203 names of `build123d.__all__` (exactly what `from build123d
import *` binds), the other public module attributes (build123d helpers such as
`Shape`, `Drawing` and `TOLERANCE`, re-exported OCP and standard-library names)
and every public attribute of every build123d submodule: its `__all__`,
module constants (`build_constants.MM`), type aliases (`geometry.VectorLike`,
`build_enums.Align2D`), mixins (`topology.Mixin1D`) and re-exports. So
`from build123d.<submodule> import <name>` fails only where build123d 0.13.0
fails, and `from build123d.<submodule> import *` binds the submodule's declared
`__all__` (all public names when it declares none), as there.

| Name | Behavior in the shim |
| --- | --- |
| `Box`, `Cylinder`, `Shape` | Bend construction, as listed above. Any other public class attribute (`Shape.cast`, `Box.cast`) or shape attribute (`.faces()`, `.vertices()`) is a capability error at its use site. |
| `Vector`, `Location`, `Rotation`, `Rot`, `Pos`, `Plane`, `Axis` | build123d's geometry values (`python/_b3d_location.py`, see above). An unimplemented build123d attribute is a capability error at its use site, an attribute build123d lacks an `AttributeError`. |
| `Sketch`, `Circle`, `Rectangle`, `RectangleRounded`, `Polygon`, `RegularPolygon`, `Polyline`, `Wire`, `Face`, `make_face` | 2D profiles (`python/_b3d_sketch.py`, see "2D profiles"); 2D Booleans and other attributes are capability errors at their use. |
| `extrude`, `Part`, `Compound`, `Solid`, `Cone` | Operations and containers (`python/_b3d_ops.py`, see "Operations and containers"); other `Solid` class methods and constructions are capability errors. |
| `BoundBox`, `Edge`, `ShapeList`, `GroupBy` | Queries and selectors (`python/_b3d_query.py`, see "Queries and selectors"); constructing a `BoundBox` or `Edge` directly is a capability error. |
| `fillet`, `chamfer`, `Text`, `offset`, `mirror`, `loft`, `sweep`, `Spline`, `section`, `ExportSVG`, `Torus`, `Sphere`, and the methods `Edge.make_spline`, `shape.mirror`, `Solid.make_sphere`, ... | Sentinels (or, on implemented classes, attributes) whose capability error names the missing Bend operation; see "Operations the Bend kernel lacks". |
| `Color` | build123d 0.13.0 `Color` as a value object without OpenCascade (`python/_wonky_color.py`, see [python-khana.md](python-khana.md)); `build123d.geometry.Color` is the same class. |
| `export_step`, `export_stl` | Model outputs under the result contract that write their file at the call (see "Exports"); build123d's signature. |
| the 32 enums (`Align`, `Mode`, `Keep`, `GeomType`, `FontStyle`, ...) | Real enums with build123d 0.13.0's members and values. A member build123d 0.13.0 lacks (`FontStyle.WIDE`) is an `AttributeError`, as there. Consumers that are not implemented fail where they are used. |
| unit constants (`MM`, `CM`, `M`, `IN`, `FT`, `THOU`, `G`, `KG`, ...), `TOLERANCE` | Plain numbers (millimeters, grams). |
| re-exported standard-library names (`pi`, `inf`, `Path`, `Any`, `dataclass_field`, `TYPE_CHECKING`, `math`, ... 80 in all) | The very stdlib object build123d re-exports, bound on first use. The generator records a `stdlib` source only when it verified the identity. |
| every other name (`Mesher`, `BuildPart`, `revolve`, `Vertex`, `import_step`, ...) | A sentinel: importing it builds and fails nothing. The readers (`import_step`, `import_stl`, `import_brep`, `import_svg`, `import_dxf`) state the external-geometry package policy when called. |
| `build123d.<submodule>` (`exporters`, `build_common`, `topology.one_d`, ...) | A view of the same table; `from build123d.exporters import Drawing` binds the same sentinel as `build123d.Drawing`, `from build123d.build_constants import MM` the same number as `build123d.MM`. Names only the submodule has get their own sentinel (`build123d.topology.Mixin1D`). |
| type aliases (`VectorLike`, `RotationLike`, `Align2D`, `ColorLike`, ...) | Sentinels of kind alias: usable in annotations, `Optional[...]` and unions with `None`; `isinstance()` against one is a capability error at its use. |
| a name build123d 0.13.0 does not have | `AttributeError` / `ImportError`, as with the real package. |

A sentinel can be imported, compared, hashed and used in type expressions:
`-> Sketch`, `Part | None`, `ShapeList[Edge]`, `typing.Optional[Plane]`. Every
use that would need the real object is a capability error **at its use site**:
calling it, reading an attribute (`Solid.make_box`, `Compound.make_text`), `isinstance()`
and `issubclass()` against it, subclassing it, truth value, iteration,
arithmetic, and subscripting a non-type value (`UNITS_PER_METER[...]`). The
first real blocker of a model is therefore the first construct it actually
uses, not the import line. Re-exported OCP names state that external geometry
is disabled; re-exported third-party names (`np`, `ConvexHull`, `ezdxf`, ...) name
the package wonky does not provide; the few stdlib-typed objects without a
verified stdlib source (`logger`, `CLASS_REGISTRY`) name their source module.

The request carries the use site's line and, on Python 3.11 and newer, its
1-based character column (from `co_positions()`); the host copies it into
`error.line` / `error.column` (column 1 on older Pythons), and the CLI prints
`file:line:col`. When the construct is used inside a project module, the
message ends with that module's site, for example
`build123d.Mesher is not implemented by the Python frontend (at helpers.py:5:50)`,
`error.useSite` holds `{file, line, column}` of it, and `error.line` stays the
executed file's line that led there. Capability errors raised by the runtime
(`ocp_vscode`, `cad_khana`, output capture, the import policy) use the same
locator.

Capability errors are recorded independently by the Node host before Python
receives `UnsupportedFeatureError`. Even `except BaseException: pass` cannot
turn a rejected capability into a successful result or export. Existing
FeatureScript `UnsupportedFeatureError` is also the JavaScript API error type.

## Execution and embedding

```javascript
import { buildPython } from './src/python.mjs';
import { toStep } from './src/exporters.mjs';

const model = await buildPython(source, {
  filename: '/abs/path/part.py', // the project directory for exports derives from it
  python: 'python3',
  timeoutMs: 30000,
  maxRequests: 20000,
  cwd: undefined,            // Python's working directory (default: this process's)
  khanaChecks: 'refuse',     // or 'skip' (docs/python-khana.md)
  readOnlyRoots: [],         // directories exports must never write into
});
const step = toStep(model, 'part');
```

The result uses the existing `wonky-brep/1` schema. `model.execution` captures
stdout, stderr and request count; `model.source` identifies Python, its version,
the compatibility surface, the SHA-256 of the executed model text
(`model.source.sha256`, `error.sourceSha256` on failure) and the `result`
binding (`result`, `assembly` or `capture`), and `model.source.outputs` lists one record per output: kind, name,
bodyIds, source location, the export path with `written` and the written
`file`, ignored viewer/export options and appearance; `model.source.writtenFiles`
lists every file the model wrote, and `model.source.khanaChecks` the cad_khana
checks recorded as not run under `khanaChecks: 'skip'`. `model.source.modules` and
`model.source.environment` are the import provenance described below. Python
execution failures raise `PythonExecutionError` with source location/traceback
where available; an error raised inside a project module also names that
module's file and line.

`model.sourceMap` additionally records actual eager construction requests,
source SHA-256, call lines, parameters and Python function stacks. Bodies carry
the operation source in `identity.operation.source` and `debug`; transforms
retain earlier operations in `identity.lineage.history`. The viewer can inspect
these records just like FeatureScript sources. Call columns are real
`co_positions()` columns on Python 3.11 and newer and stay null before.
`trace: false` disables tracing without changing geometry. Failed
capabilities retain failed records on `error.modelTrace`, including when the
Python exception was caught. Current Python shape IDs are sequential within
the build, so inserting unrelated operations does not yet preserve those IDs.

The runner launches Python with `-I -S -B` (no user site-packages, no
`PYTHON*` variables, no site-packages at all), loads the shim explicitly, and
uses dedicated file descriptors 3/4 for JSON requests and responses. Shape
proxies hold opaque handles to actual host B-reps, never deferred expression
trees. Python is ordinary trusted local code, **not a security sandbox**;
standard Python file, process and network access still works.

### Imports and `sys.path`

Imports behave like `python model.py`. The model directory and the nearest
ancestor holding a `pyproject.toml` are at the front of `sys.path`
(`projectPath: false`, CLI `--no-project-path`, disables that), and directories
the model adds to `sys.path` itself work too. Lookup follows CPython's own
`sys.path` order. A `src/` layout package below the project root is not on the
path, exactly as without `pip install -e`.

Every module that resolves outside the standard library is recorded as
`{module, path, sha256}` (real path) in `model.source.modules`, or in
`error.sourceFiles` when the build fails, so a review can reproduce exactly
which helper code ran. Python files loaded by path, outside the import system,
are recorded too, through an audit hook on `exec` and `open` events:

| Load | Record |
| --- | --- |
| `import helper` (model directory, project root, a directory the model added) | `{module: "helper", path, sha256}` |
| `importlib.util.spec_from_file_location(...)` + `spec.loader.exec_module(...)` | `{module: <spec name>, path, sha256, loader: "exec"}` |
| `runpy.run_path(path)` | `{module: "<run_path>", path, sha256, loader: "exec"}` |
| `exec(compile(text, path, "exec"))` | `{module: null, path, sha256, loader: "exec"}` |
| `exec(open(path).read())` and any other read of a `.py` file | `{module: null, path, sha256, loader: "open"}` |

A recorded module is compiled from exactly the bytes its SHA-256 describes.
`-B` only stops Python from writing bytecode; CPython would still execute a
`__pycache__` `.pyc` whose recorded mtime and size match an edited file (a
same-size edit within the same second) or whose hash it is told not to check
(unchecked-hash `.pyc`). The runner therefore never runs cached bytecode for
project modules or for files loaded by path through `importlib`; the standard
library and wonky's own modules keep CPython's cache. A project `.pyc` without
source (a legacy `helper.pyc` next to the model) is executed as is and hashed
as the `.pyc` it is.

The executed model text has its own `model.source.sha256`.
`model.source.environment` records the isolation flags, the interpreter, the
project path and the wonky-provided modules.

The runner and the shim import standard-library modules before the model runs
(`json`, `enum`, `inspect`, `colorsys`, `textwrap`, ...). Under `python
model.py` a project module of such a name would win, so it wins here too: on
the model's first import of the name, the runner looks it up on the current
`sys.path` as CPython would, and when a project file answers, that file is
imported and its record carries `shadows` with the standard-library file it
replaces. Wonky's own code keeps its standard-library references. Modules the
interpreter already has at startup (builtin and frozen modules such as `os`,
`sys`, `io`, `codecs`, `abc`, and `encodings`) keep the standard library, as
in plain Python.

### Package policy

| Import | Behavior |
| --- | --- |
| standard library | Imports normally. |
| project modules (model directory, `pyproject.toml` root, directories the model adds) | Import normally; recorded with SHA-256. |
| `build123d`, `build123d.<submodule>` | Wonky's Bend shim (name table above). Takes precedence over any project module of that name. |
| `cad_khana` | Wonky's modeling-compatible package: `Assembly`, named and colored parts, joints, materials. Its diagnostics (`check()`, `inspect()`, printability checks, drawing, export, viewer) raise a capability error at their call. See [python-khana.md](python-khana.md). |
| `ocp_vscode` | `show()` and `show_object()` record outputs (result contract); every other name is a capability error at its use. |
| `OCP`, `OCC`, `cadquery` | Refused at the import line by the external-geometry guard, also inside `try`, also when a project ships a module of that name. |
| any other package (`bd_warehouse`, `numpy`, `trimesh`, `pytest`, `yaml`, ...) | A capability error at the import line naming the package, the policy and, where `python/_wonky_packages.py` has one, the package-specific reason. |
| an installed package on a directory the model put on `sys.path`: a site-packages, dist-packages or `.egg` location (including the interpreter's own `lib/pythonX.Y/site-packages`, which `-S` keeps off `sys.path` although it lies below the standard library, and where pip installs into a Homebrew or uv Python), or any directory whose installation record lists the file (`<dist>.dist-info/RECORD` from pip or uv, `<egg>.egg-info/installed-files.txt`), such as `pip install --target .deps` or uv's `archive-v0` cache | A capability error at the import line that names the file and the evidence (`recognized by its installation record .../numpy-2.1.0.dist-info/RECORD`). Loading such a file by path (`spec_from_file_location`, `runpy.run_path`) is refused the same way. An editable checkout's own `*.egg-info` lists no installed files, so the checkout stays project code. |
| build123d's readers (`import_step`, `import_stl`, `import_brep`, ...) | Build123d names: they import, and fail at their call because they read external geometry. |

How many corpus files each unavailable package blocks is recorded in
[python-khana.md](python-khana.md#what-each-package-blocks-in-the-corpus) and,
for the W5 integration run, in [corpus/w5.md](corpus/w5.md).

Each session defaults to a 30-second Python execution timeout, 20,000 bridge
requests and 1 MiB of captured output. Kernel startup precedes that timeout.
The timer cannot interrupt a synchronous Bend call already running in Node.
`--python`, `--timeout-ms` and `--max-requests` configure the corresponding CLI
options; `--khana-checks refuse|skip` and `--read-only <dir>` are described in
[python-khana.md](python-khana.md) and under "Exports". No benchmark or native/GPU performance claim follows from this bridge.

## Validation

```sh
node --test test/python*.test.mjs
node bin/wonky-python.mjs examples/python-box.py --out out/python-box
node bin/wonky-python.mjs examples/python-spacer.py --out out/python-spacer
uv run scripts/validate-step.py out/python-box out/python-spacer
npm test
```

Tests compare complete bodies against equivalent FeatureScript builds,
including aligned primitives, all three Boolean operators and multiple-solid
results. They cover real Python control flow, eager volume reads, translations,
sticky capability failures, isolated sessions, process limits and CLI export
behavior. The existing independent STEP validator checks OpenCascade import,
solid validity, topology counts and volume after export; OpenCascade is only a
validation oracle.
