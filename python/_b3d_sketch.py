"""build123d 0.13 2D profiles as pure Python data: a planar frame plus lines, three-point arcs or one circle.

Loaded by path next to build123d.py (python/_b3d_*.py). Nothing here asks the
Bend host for anything: a profile is geometry data until an operation such as
``extrude`` hands its ``_wonky_faces()`` records to the host (protocol op
``extrude_profile`` in docs/corpus/w5b-plan.md).

Semantics follow build123d 0.13.0 (checked against it as an oracle,
tmp/w5b/c-sketch/oracle.py):

- ``Circle``, ``Rectangle``, ``RectangleRounded`` (4 lines + 4 arcs,
  ``width > 2*radius`` and ``height > 2*radius``), ``Polygon`` (keeps its
  coordinates by default), ``RegularPolygon`` (circumcentred, a vertex on +X
  rotated by ``rotation``; ``major_radius=False`` makes the radius the apothem):
  ``align`` acts on the unrotated bounding box, then ``rotation`` turns the
  face about the sketch origin (BaseSketchObject).
- A ``Polygon`` face's normal follows its winding (clockwise points face -Z);
  ``make_face`` flips a face whose normal has a negative world Z, like
  build123d; ``Face(wire)`` keeps the wire's winding.
- ``Plane * profile``, ``Location * profile`` and ``profile.moved(location)``
  place a copy; the frame is kept exactly, arcs and circles stay analytic.
- ``area`` is analytic (Green's theorem over lines and circular arcs).

Explicit capability errors: 2D Booleans (no planar region Boolean in Bend),
``mode`` other than ``Mode.ADD``, partial circles, degenerate (zero-area or
self-intersecting) outlines, and every other build123d attribute of these
objects.
"""

import math as _math
import numbers as _numbers
import operator as _operator
import sys as _sys

_TOLERANCE = 1e-6  # build123d TOLERANCE: Wire.make_polygon closes when first and last differ by more
_CONFUSION = 1e-7  # OCCT Precision::Confusion: BRepBuilderAPI_MakePolygon merges closer points
_PLANAR = 1e-7  # distance of a wire vertex from its plane before it counts as non-planar


# ---------------------------------------------------------------------------
# Shim helpers, resolved at call time so that this module can be loaded before
# or after the core module that defines them.

def _shim(name):
    for module_name in ("_b3d_core", "build123d"):
        module = _sys.modules.get(module_name)
        if module is not None and name in getattr(module, "__dict__", {}):
            return module.__dict__[name]
    raise RuntimeError(f"_b3d_sketch needs build123d.{name}; load it through python/build123d.py")


def _unsupported(message):
    return _shim("_unsupported")(message)


def _check_mode(name, mode):
    if mode is not _shim("Mode").ADD:
        _unsupported(f"{name}(mode={mode}) is not implemented by the Python frontend: combining sketch faces "
                     f"needs a planar region Boolean, which the Bend kernel does not have; use Mode.ADD")


def _real(value, name):
    if isinstance(value, bool) or not isinstance(value, _numbers.Real):
        raise ValueError(f"{name} must be a finite number")
    value = float(value)
    if not _math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return value


# ---------------------------------------------------------------------------
# Small vector algebra on tuples.

def _add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a):
    return _math.sqrt(_dot(a, a))


def _unit(a, what):
    length = _norm(a)
    if length <= 1e-12:
        raise ValueError(f"{what} has zero length")
    return _scale(a, 1.0 / length)


def _vector_like(value):
    """A Vector-like object: X and Y are attributes of its type (never probe instance __getattr__)."""
    return hasattr(type(value), "X") and hasattr(type(value), "Y")


def _point(value, name="point"):
    """A build123d VectorLike: a 2- or 3-tuple/list of numbers or an object with X, Y (and Z)."""
    if _vector_like(value):
        coordinates = [value.X, value.Y, getattr(value, "Z", 0.0)]
    elif isinstance(value, (tuple, list)) and len(value) in (2, 3):
        coordinates = list(value) + [0.0] * (3 - len(value))
    else:
        raise TypeError(f"{name} must be a 2D or 3D point, not {value!r}")
    return tuple(_real(c, name) for c in coordinates)


def _is_point(value):
    if _vector_like(value):
        return True
    return (isinstance(value, (tuple, list)) and len(value) in (2, 3)
            and all(isinstance(c, _numbers.Real) and not isinstance(c, bool) for c in value))


def _flatten_points(items):
    """build123d flatten_sequence for points: nested lists/tuples/iterables of VectorLikes."""
    points = []
    for item in items:
        if _is_point(item):
            points.append(_point(item))
        elif isinstance(item, (str, bytes)):
            raise TypeError(f"expected points, got {item!r}")
        else:
            try:
                nested = list(item)
            except TypeError:
                raise TypeError(f"expected points, got {item!r}") from None
            points.extend(_flatten_points(nested))
    return points


# ---------------------------------------------------------------------------
# Rigid motions: (rows, offset) with a 3x3 rotation.

_IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def _apply(rows, offset, p):
    return (_dot(rows[0], p) + offset[0], _dot(rows[1], p) + offset[1], _dot(rows[2], p) + offset[2])


def _rotate(rows, v):
    return (_dot(rows[0], v), _dot(rows[1], v), _dot(rows[2], v))


def _z_rotation(degrees):
    angle = _math.radians(degrees)
    c, s = _math.cos(angle), _math.sin(angle)
    return ((c, -s, 0.0), (s, c, 0.0), (0.0, 0.0, 1.0))


def _vector3(value, name):
    try:
        items = list(value)
    except TypeError:
        raise TypeError(f"{name} is not a 3D vector") from None
    if len(items) == 2:
        items.append(0.0)
    if len(items) != 3:
        raise TypeError(f"{name} is not a 3D vector")
    return tuple(_real(c, name) for c in items)


def _rigid(placement):
    """(rows, offset) of a build123d Location, Plane or Pos, or None when it is not location-like.

    Protocol: a location-like object implements ``_wonky_rigid() -> (rows, offset)``
    (3x3 rotation rows, offset in mm). A Plane without it is read from its
    origin/x_dir/z_dir (build123d: Plane * shape == shape.moved(plane.location)).
    """
    method = getattr(type(placement), "_wonky_rigid", None)
    if method is not None:
        rows, offset = method(placement)
        return tuple(tuple(float(v) for v in row) for row in rows), tuple(float(v) for v in offset)
    if type(placement).__name__ == "Pos" and hasattr(placement, "_offset"):
        return _IDENTITY, tuple(float(v) for v in placement._offset)  # the W5 translation-only Pos
    if all(hasattr(type(placement), name) or name in getattr(placement, "__dict__", {})
           for name in ("origin", "x_dir", "z_dir")):
        origin = _vector3(placement.origin, "Plane origin")
        x = _unit(_vector3(placement.x_dir, "Plane x_dir"), "Plane x_dir")
        z = _unit(_vector3(placement.z_dir, "Plane z_dir"), "Plane z_dir")
        y = _cross(z, x)
        return tuple((x[i], y[i], z[i]) for i in range(3)), origin
    return None


def _check_rigid(rows):
    det = (rows[0][0] * (rows[1][1] * rows[2][2] - rows[1][2] * rows[2][1])
           - rows[0][1] * (rows[1][0] * rows[2][2] - rows[1][2] * rows[2][0])
           + rows[0][2] * (rows[1][0] * rows[2][1] - rows[1][1] * rows[2][0]))
    if abs(det - 1.0) > 1e-9:
        _unsupported("Placing a sketch by a reflection or non-rigid transform is not implemented by the Python "
                      "frontend (reflection transform)")


# ---------------------------------------------------------------------------
# Frames and edges.

def _clean(values):
    """A list of floats without negative zeros (-0.0 + 0.0 == 0.0)."""
    return [value + 0.0 for value in values]


class _Frame:
    """A right-handed planar frame: origin, x, y and z (the face normal) in world mm."""

    __slots__ = ("origin", "x", "y", "z")

    def __init__(self, origin, x, y, z):
        self.origin, self.x, self.y, self.z = origin, x, y, z

    def world(self, u, v):
        return _add(self.origin, _add(_scale(self.x, u), _scale(self.y, v)))

    def moved(self, rows, offset):
        return _Frame(_apply(rows, offset, self.origin), _rotate(rows, self.x), _rotate(rows, self.y),
                      _rotate(rows, self.z))


_XY = _Frame((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def _arc_sweep(start, mid, end, center):
    """Signed sweep in radians of the three-point arc start -> mid -> end."""
    a0 = _math.atan2(start[1] - center[1], start[0] - center[0])
    a1 = _math.atan2(end[1] - center[1], end[0] - center[0])
    turn = (mid[0] - start[0]) * (end[1] - mid[1]) - (mid[1] - start[1]) * (end[0] - mid[0])
    if turn > 0:
        return (a1 - a0) % (2 * _math.pi)
    return -((a0 - a1) % (2 * _math.pi))


class _Region:
    """One face: a frame (z = face normal) and one counter-clockwise outer loop in frame coordinates.

    ``loop`` is ``("circle", center, radius)`` or a list of edges
    ``("line", start, end)`` / ``("arc", start, mid, end, center, radius)``.
    """

    __slots__ = ("frame", "loop")

    def __init__(self, frame, loop):
        self.frame, self.loop = frame, loop

    def moved(self, rows, offset):
        return _Region(self.frame.moved(rows, offset), self.loop)

    def flipped(self):
        """The same point set with the opposite normal (build123d -face), loop still counter-clockwise."""
        f = self.frame
        frame = _Frame(f.origin, f.x, _scale(f.y, -1.0), _scale(f.z, -1.0))
        if self.loop[0] == "circle":
            (cx, cy), r = self.loop[1], self.loop[2]
            return _Region(frame, ("circle", (cx, -cy), r))
        mirror = lambda p: (p[0], -p[1])  # noqa: E731
        edges = []
        for edge in reversed(self.loop):
            if edge[0] == "line":
                edges.append(("line", mirror(edge[2]), mirror(edge[1])))
            else:
                edges.append(("arc", mirror(edge[3]), mirror(edge[2]), mirror(edge[1]), mirror(edge[4]), edge[5]))
        return _Region(frame, edges)

    def area(self):
        if self.loop[0] == "circle":
            return _math.pi * self.loop[2] ** 2
        twice = 0.0
        for edge in self.loop:
            if edge[0] == "line":
                (x0, y0), (x1, y1) = edge[1], edge[2]
                twice += x0 * y1 - x1 * y0
            else:
                _, start, mid, end, (cx, cy), r = edge
                sweep = _arc_sweep(start, mid, end, (cx, cy))
                a0 = _math.atan2(start[1] - cy, start[0] - cx)
                a1 = a0 + sweep
                twice += r * r * sweep + r * cx * (_math.sin(a1) - _math.sin(a0)) - r * cy * (_math.cos(a1) - _math.cos(a0))
        return abs(twice) / 2

    def edges(self):
        """World-space edge records: {geom, start, end} plus center/radius/mid for circles and arcs."""
        f = self.frame
        if self.loop[0] == "circle":
            (cx, cy), r = self.loop[1], self.loop[2]
            seam = f.world(cx + r, cy)
            return [{"geom": "CIRCLE", "start": seam, "end": seam, "center": f.world(cx, cy), "radius": r,
                     "mid": f.world(cx - r, cy), "normal": f.z}]
        records = []
        for edge in self.loop:
            if edge[0] == "line":
                records.append({"geom": "LINE", "start": f.world(*edge[1]), "end": f.world(*edge[2])})
            else:
                records.append({"geom": "CIRCLE", "start": f.world(*edge[1]), "end": f.world(*edge[3]),
                                "center": f.world(*edge[4]), "radius": edge[5], "mid": f.world(*edge[2]),
                                "normal": f.z})
        return records

    def vertices(self):
        if self.loop[0] == "circle":
            (cx, cy), r = self.loop[1], self.loop[2]
            return [self.frame.world(cx + r, cy)]
        return [self.frame.world(*edge[1]) for edge in self.loop]

    def host_profile(self):
        """Request fragment of the host's extrude_profile op (mm, sketch-plane 2D, normal = face normal)."""
        f = self.frame
        plane = {"origin": _clean(f.origin), "x": _clean(f.x), "normal": _clean(f.z)}
        if self.loop[0] == "circle":
            return {"profile": {"kind": "circle", "center": _clean(self.loop[1]), "radius": self.loop[2]},
                    "plane": plane}
        if all(edge[0] == "line" for edge in self.loop):
            return {"profile": {"kind": "polygon", "points": [_clean(edge[1]) for edge in self.loop]}, "plane": plane}
        entities = []
        for edge in self.loop:
            if edge[0] == "line":
                entities.append({"type": "line", "start": _clean(edge[1]), "end": _clean(edge[2])})
            else:
                entities.append({"type": "arc", "start": _clean(edge[1]), "mid": _clean(edge[2]), "end": _clean(edge[3])})
        return {"profile": {"kind": "line-arc", "entities": entities}, "plane": plane}


def _segments_cross(p, q, r, s):
    """Proper or touching intersection of the closed segments pq and rs."""
    def orient(a, b, c):
        value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        return 0 if abs(value) <= 1e-12 else (1 if value > 0 else -1)

    def on(a, b, c):
        return min(a[0], b[0]) - 1e-12 <= c[0] <= max(a[0], b[0]) + 1e-12 and \
            min(a[1], b[1]) - 1e-12 <= c[1] <= max(a[1], b[1]) + 1e-12
    o1, o2, o3, o4 = orient(p, q, r), orient(p, q, s), orient(r, s, p), orient(r, s, q)
    if o1 != o2 and o3 != o4:
        return True
    return (o1 == 0 and on(p, q, r)) or (o2 == 0 and on(p, q, s)) or (o3 == 0 and on(r, s, p)) or \
        (o4 == 0 and on(r, s, q))


def _polygon_region(points, what):
    """The face of Face(Wire.make_polygon(points)): normal from the winding (Newell), frame fitted to the plane.

    ``points`` are distinct consecutive world points of a closed polygon
    (the closing point not repeated).
    """
    if len(points) < 3:
        _unsupported(f"{what} with fewer than three distinct points has zero area; Bend builds only "
                     f"regions with a positive area")
    newell = [0.0, 0.0, 0.0]
    for i, p in enumerate(points):
        q = points[(i + 1) % len(points)]
        newell[0] += (p[1] - q[1]) * (p[2] + q[2])
        newell[1] += (p[2] - q[2]) * (p[0] + q[0])
        newell[2] += (p[0] - q[0]) * (p[1] + q[1])
    if _norm(newell) <= 1e-12:
        _unsupported(f"{what} has zero area (collinear points or a self-cancelling outline); Bend builds only "
                     f"regions with a positive area")
    z = _unit(tuple(newell), "normal")
    if all(p[2] == points[0][2] for p in points) and abs(z[0]) == 0.0 and abs(z[1]) == 0.0:
        # Planar in world XY: keep the XY frame (flipped for a clockwise outline).
        up = z[2] > 0
        frame = _Frame((0.0, 0.0, points[0][2]), (1.0, 0.0, 0.0), (0.0, 1.0 if up else -1.0, 0.0),
                       (0.0, 0.0, 1.0 if up else -1.0))
    else:
        origin = points[0]
        x = _unit(_sub(points[1], points[0]), "polygon edge")
        x = _unit(_sub(x, _scale(z, _dot(x, z))), "polygon edge")
        frame = _Frame(origin, x, _cross(z, x), z)
    for p in points:
        if abs(_dot(_sub(p, frame.origin), frame.z)) > _PLANAR * max(1.0, _norm(_sub(p, frame.origin))):
            raise ValueError("Cannot build face(s): wires not planar")
    local = [(_dot(_sub(p, frame.origin), frame.x), _dot(_sub(p, frame.origin), frame.y)) for p in points]
    n = len(local)
    for i in range(n):
        for j in range(i + 1, n):
            if j == i + 1 or (i == 0 and j == n - 1):
                continue
            if _segments_cross(local[i], local[(i + 1) % n], local[j], local[(j + 1) % n]):
                _unsupported(f"{what} outline intersects itself; Bend builds only simple polygon regions")
    return _Region(frame, [("line", local[i], local[(i + 1) % n]) for i in range(n)])


def _polygon_points(points):
    """BRepBuilderAPI_MakePolygon: drop points coincident with their predecessor and a repeated closing point."""
    kept = []
    for p in points:
        if not kept or _norm(_sub(p, kept[-1])) > _CONFUSION:
            kept.append(p)
    if len(kept) > 1 and _norm(_sub(kept[-1], kept[0])) <= _TOLERANCE:
        kept.pop()
    return kept


def _align_offset(minimum, maximum, align, center=None):
    """build123d to_align_offset in the sketch plane (x, y)."""
    Align = _shim("Align")
    if center is None:
        center = ((minimum[0] + maximum[0]) / 2, (minimum[1] + maximum[1]) / 2)
    if align is None or align is Align.NONE:
        return (0.0, 0.0)
    if align is Align.MIN:
        return (-minimum[0], -minimum[1])
    if align is Align.MAX:
        return (-maximum[0], -maximum[1])
    if align is Align.CENTER:
        return (-center[0], -center[1])
    if not isinstance(align, (tuple, list)):
        raise ValueError(f"align must be an Align or a tuple of Align values, not {align!r}")
    offset = [0.0, 0.0]
    for axis, value in enumerate(list(align)[:2]):
        value = Align.NONE if value is None else value
        if not isinstance(value, Align):
            raise ValueError(f"{value!r} is not a valid Align")
        if value is Align.MIN:
            offset[axis] = -minimum[axis]
        elif value is Align.CENTER:
            offset[axis] = -center[axis]
        elif value is Align.MAX:
            offset[axis] = -maximum[axis]
    return tuple(offset)


def _tuplify2(align):
    Align = _shim("Align")
    if align is None or isinstance(align, (tuple, list)):
        return align
    if isinstance(align, Align):
        return (align, align)
    raise ValueError(f"align must be an Align or a tuple of Align values, not {align!r}")


def _arc_extremes(start, mid, end, center, radius):
    """Axis-extreme points strictly inside a three-point arc."""
    sweep = _arc_sweep(start, mid, end, center)
    a0 = _math.atan2(start[1] - center[1], start[0] - center[0])
    points = []
    for k in range(4):
        angle = k * _math.pi / 2
        inside = (0 < (angle - a0) % (2 * _math.pi) < sweep) if sweep > 0 else \
            (0 < (a0 - angle) % (2 * _math.pi) < -sweep)
        if inside:
            points.append((center[0] + radius * _math.cos(angle), center[1] + radius * _math.sin(angle)))
    return points


def _xy_bounds(region):
    """World (x, y) bounding box of a freshly constructed region (build123d's optimal bounding box).

    Polygons: their vertices. Circles and arcs: only in the XY frame, which is
    where the sketch primitives are built before align and rotation.
    """
    loop = region.loop
    if loop[0] != "circle" and all(edge[0] == "line" for edge in loop):
        points = region.vertices()
    else:
        f = region.frame
        if f.x != (1.0, 0.0, 0.0) or f.y != (0.0, 1.0, 0.0):
            raise RuntimeError("curved profiles are aligned only in their construction frame")
        if loop[0] == "circle":
            (cx, cy), r = loop[1], loop[2]
            local = [(cx - r, cy - r), (cx + r, cy + r)]
        else:
            local = []
            for edge in loop:
                local.append(edge[1])
                if edge[0] == "arc":
                    local.extend(_arc_extremes(edge[1], edge[2], edge[3], edge[4], edge[5]))
        points = [f.world(u, v) for u, v in local]
    return (min(p[0] for p in points), min(p[1] for p in points)), (max(p[0] for p in points), max(p[1] for p in points))


class _ProfileType(type):
    """Metaclass: unimplemented class attributes (Face.make_rect, Sketch.cast, ...) are use-site capability errors."""

    def __getattr__(cls, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return _unsupported(f"{cls.__name__}.{name} is not implemented by the Python frontend")


class _Profile(metaclass=_ProfileType):
    """Shared placement and attribute protocol of 2D sketches, faces and wires."""

    def _copy_with(self, **fields):
        """A copy; with changed geometry fields it is a new shape, else the same one (build123d is_same)."""
        if not fields:
            self._same()
        clone = object.__new__(type(self))
        clone.__dict__.update(self.__dict__)
        clone.__dict__.update(fields)
        if fields:
            clone.__dict__.pop("_same_token", None)
        return clone

    def _same(self):
        return self.__dict__.setdefault("_same_token", object())

    def __eq__(self, other):
        """Shape.__eq__ is is_same(): a copy equals its original, a moved or rebuilt profile does not."""
        if isinstance(other, _Profile):
            return self._same() is other._same()
        return NotImplemented

    def __hash__(self):
        return id(self._same())

    def _moved_by(self, rows, offset):
        raise NotImplementedError

    def _wonky_moved(self, placement):
        """A placed copy (build123d Location/Plane * shape); None if placement is not location-like."""
        rigid = _rigid(placement)
        if rigid is None:
            return None
        rows, offset = rigid
        _check_rigid(rows)
        return self._moved_by(rows, offset)

    def __rmul__(self, other):
        """``Plane * profile`` / ``Location * profile``: shape.moved(location), as in build123d."""
        if isinstance(other, (list, tuple)):
            placed = [self._wonky_moved(item) for item in other]
            if all(item is not None for item in placed):
                return placed
        else:
            placed = self._wonky_moved(other)
            if placed is not None:
                return placed
        raise TypeError(f"{type(self).__name__} cannot be multiplied by {type(other).__name__}")

    def moved(self, loc):
        """Shape.moved: a copy placed relative to its current position."""
        placed = self._wonky_moved(loc)
        if placed is None:
            raise TypeError(f"moved() needs a Location, not {type(loc).__name__}")
        return placed

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return _unsupported(f"{type(self).__name__}.{name} is not implemented by the Python frontend")

    def __deepcopy__(self, memo):
        return self._copy_with()

    def __copy__(self):
        return self._copy_with()


def _planar_boolean(verb):
    def fail(self, other):
        if verb == "+" and (other is None or (isinstance(other, (list, tuple)) and not other)):
            return self  # build123d: nothing to add returns the original object
        if verb == "+" and not self._regions and isinstance(other, Sketch):
            return Sketch._of(other._regions)  # empty + one shape is that shape, no Boolean
        if verb == "+" and not self._regions and isinstance(other, (list, tuple)) and len(other) == 1 \
                and isinstance(other[0], Sketch):
            return Sketch._of(other[0]._regions)
        return _unsupported(f"Sketch {verb} Sketch is not implemented by the Python frontend: it needs a planar "
                            f"region Boolean (union/difference/intersection of faces), which the Bend kernel "
                            f"does not have")
    return fail


class Sketch(_Profile):
    """A build123d Sketch (Compound of faces). ``Sketch()`` is empty; 2D Booleans are capability errors."""

    def __init__(self, *args, **kwargs):
        if args or kwargs:
            _unsupported("Sketch(...) from OCCT objects or children is not implemented by the Python frontend; "
                         "build profiles with Circle, Rectangle, RectangleRounded, Polygon, RegularPolygon or "
                         "make_face")
        self._regions = ()

    @classmethod
    def _of(cls, regions):
        sketch = object.__new__(Sketch)
        sketch._regions = tuple(regions)
        return sketch

    def _moved_by(self, rows, offset):
        if not self._regions:
            raise ValueError("Cannot move an empty shape")
        return self._copy_with(_regions=tuple(region.moved(rows, offset) for region in self._regions))

    def _wonky_empty_kind(self):
        """For Plane * sketch: build123d lists the operand first, and Sketch() asserts there (no wrapped)."""
        return None if self._regions else "null"

    @property
    def area(self):
        return sum(region.area() for region in self._regions)

    def __bool__(self):
        return bool(self._regions)

    def __len__(self):
        return len(self._regions)

    __add__ = _planar_boolean("+")
    __sub__ = _planar_boolean("-")
    __and__ = _planar_boolean("&")
    __iadd__ = __add__
    __isub__ = __sub__
    __iand__ = __and__

    def __radd__(self, other):
        if other is None:
            return self
        return _unsupported("... + Sketch is not implemented by the Python frontend: it needs a planar region "
                            "Boolean, which the Bend kernel does not have")

    def __iter__(self):
        """Compound.__iter__: one Face per face of the sketch."""
        if not self._regions:
            raise AssertionError  # build123d: Sketch() has no wrapped shape to iterate
        return iter([Face._of(region) for region in self._regions])

    def _wonky_faces(self):
        """One extrude_profile request fragment per face (see _Region.host_profile)."""
        return [region.host_profile() for region in self._regions]

    def _wonky_edges(self):
        return [edge for region in self._regions for edge in region.edges()]

    def _wonky_vertices(self):
        return [vertex for region in self._regions for vertex in region.vertices()]

    def __repr__(self):
        return f"<Bend {type(self).__name__}: {len(self._regions)} face(s), area {self.area:.6g}>"


_DEFAULT = object()  # marks an omitted align; align=None means "no alignment" in build123d


def _default_align(align):
    if align is _DEFAULT:
        Align = _shim("Align")
        return (Align.CENTER, Align.CENTER)
    return align


def _mode(mode):
    return _shim("Mode").ADD if mode is _DEFAULT else mode


def _no_kwargs(name, kwargs):
    if kwargs:
        raise TypeError(f"{name}.__init__() got an unexpected keyword argument {next(iter(kwargs))!r}")


class _SketchObject(Sketch):
    """BaseSketchObject: align on the unrotated bounding box, then rotate about the sketch origin (world Z)."""

    def _finish(self, name, region, rotation, align, mode):
        _check_mode(name, mode)
        rotation = _real(rotation, "rotation")
        if align is not None:
            minimum, maximum = _xy_bounds(region)
            dx, dy = _align_offset(minimum, maximum, _tuplify2(align))
            if dx or dy:
                region = region.moved(_IDENTITY, (dx, dy, 0.0))
        if rotation:
            region = region.moved(_z_rotation(rotation), (0.0, 0.0, 0.0))
        self._regions = (region,)
        self.rotation = rotation
        self.mode = mode


class Circle(_SketchObject):
    """Circle(radius, arc_size=360, align=(CENTER, CENTER), mode=ADD): one analytic circle, seam on +X."""

    def __init__(self, radius, arc_size=360.0, align=_DEFAULT, mode=_DEFAULT, **kwargs):
        _no_kwargs("Circle", kwargs)
        radius = _real(radius, "Circle radius")
        if _real(arc_size, "arc_size") != 360.0:
            _unsupported("Circle(arc_size != 360) is not implemented by the Python frontend (a circular sector "
                         "profile)")
        if radius == 0:
            raise ValueError("Cannot build face(s): wires not planar")
        if radius < 0:
            raise ValueError("gp_Circ() - radius should be positive number")
        self.radius, self.arc_size = radius, 360.0
        self.align = _tuplify2(_default_align(align))
        self._finish("Circle", _Region(_XY, ("circle", (0.0, 0.0), radius)), 0, self.align, _mode(mode))


class Rectangle(_SketchObject):
    """Rectangle(width, height, rotation=0, align=(CENTER, CENTER), mode=ADD)."""

    def __init__(self, width, height, rotation=0, align=_DEFAULT, mode=_DEFAULT, **kwargs):
        _no_kwargs("Rectangle", kwargs)
        w, h = _real(width, "Rectangle width"), _real(height, "Rectangle height")
        if w <= 0 or h <= 0:
            _unsupported("Rectangle with a zero or negative width or height is not implemented by the Python "
                         "frontend (build123d builds a degenerate or mirrored face)")
        self.width, self.rectangle_height = w, h
        self.align = _tuplify2(_default_align(align))
        x, y = w / 2, h / 2
        corners = [(-x, y), (-x, -y), (x, -y), (x, y)]
        loop = [("line", corners[i], corners[(i + 1) % 4]) for i in range(4)]
        self._finish("Rectangle", _Region(_XY, loop), rotation, self.align, _mode(mode))


class RectangleRounded(_SketchObject):
    """RectangleRounded(width, height, radius, ...): 4 lines and 4 tangent quarter arcs, exact."""

    def __init__(self, width, height, radius, rotation=0, align=_DEFAULT, mode=_DEFAULT, **kwargs):
        _no_kwargs("RectangleRounded", kwargs)
        w, h = _real(width, "RectangleRounded width"), _real(height, "RectangleRounded height")
        r = _real(radius, "RectangleRounded radius")
        if w <= 2 * r or h <= 2 * r:
            raise ValueError("width and height must be > 2*radius")
        if r <= 0:
            _unsupported("RectangleRounded with a zero or negative radius is not implemented by the Python "
                         "frontend (build123d 0.13 fails in OCCT's 2D fillet)")
        self.width, self.rectangle_height, self.radius = w, h, r
        self.align = _tuplify2(_default_align(align))
        x, y = w / 2, h / 2
        a, b = x - r, y - r
        d = r / _math.sqrt(2)
        # build123d's edge order: the left side downwards, then counter-clockwise.
        loop = [
            ("line", (-x, b), (-x, -b)),
            ("arc", (-x, -b), (-a - d, -b - d), (-a, -y), (-a, -b), r),
            ("line", (-a, -y), (a, -y)),
            ("arc", (a, -y), (a + d, -b - d), (x, -b), (a, -b), r),
            ("line", (x, -b), (x, b)),
            ("arc", (x, b), (a + d, b + d), (a, y), (a, b), r),
            ("line", (a, y), (-a, y)),
            ("arc", (-a, y), (-a - d, b + d), (-x, b), (-a, b), r),
        ]
        self._finish("RectangleRounded", _Region(_XY, loop), rotation, self.align, _mode(mode))


class Polygon(_SketchObject):
    """Polygon(*pts, rotation=0, align=(NONE, NONE), mode=ADD): keeps its coordinates by default.

    The face normal follows the winding: counter-clockwise points face +Z,
    clockwise points face -Z (build123d algebra mode).
    """

    def __init__(self, *pts, rotation=0, align=None, mode=_DEFAULT, **kwargs):
        _no_kwargs("Polygon", kwargs)
        points = _flatten_points(pts)
        self.pts = points
        self.align = _tuplify2(align)
        region = _polygon_region(_polygon_points(points), "Polygon")
        self._finish("Polygon", region, rotation, self.align, _mode(mode))


class RegularPolygon(_SketchObject):
    """RegularPolygon(radius, side_count, major_radius=True, rotation=0, align=(CENTER, CENTER), mode=ADD).

    Vertices at angles i*360/n + rotation on the circumscribed circle;
    Align.CENTER puts the circumcentre (not the bounding box centre) on the origin.
    """

    def __init__(self, radius, side_count, major_radius=True, rotation=0, align=_DEFAULT, mode=_DEFAULT,
                 **kwargs):
        _no_kwargs("RegularPolygon", kwargs)
        radius = _real(radius, "RegularPolygon radius")
        if side_count < 3:
            raise ValueError(f"RegularPolygon must have at least three sides, not {side_count}")
        n = _operator.index(side_count)
        rotation = _real(rotation, "rotation")
        rad = radius if major_radius else radius / _math.cos(_math.pi / n)
        if rad <= 0:
            _unsupported("RegularPolygon with a zero or negative radius is not implemented by the Python frontend")
        align = _default_align(align)
        mode = _mode(mode)
        self.radius, self.apothem = rad, rad * _math.cos(_math.pi / n)
        self.side_count, self.align = n, align
        angles = [i * 2 * _math.pi / n + _math.radians(rotation) for i in range(n)]
        pts = [(rad * _math.cos(t), rad * _math.sin(t)) for t in angles]
        minimum = (min(p[0] for p in pts), min(p[1] for p in pts))
        maximum = (max(p[0] for p in pts), max(p[1] for p in pts))
        dx, dy = _align_offset(minimum, maximum, align, center=(0.0, 0.0))
        region = _polygon_region([(x + dx, y + dy, 0.0) for x, y in pts], "RegularPolygon")
        self._finish("RegularPolygon", region, 0, None, mode)


class Face(_Profile):
    """build123d Face built from one closed planar Wire: ``Face(wire)``. The normal follows the wire's winding."""

    def __init__(self, *args, **kwargs):
        if kwargs or len(args) != 1 or not isinstance(args[0], Wire):
            _unsupported("Face(...) is implemented by the Python frontend only as Face(wire) for one closed "
                         "polygon Wire (Wire.make_polygon or Polyline)")
        self._region = args[0]._face_region("Face")

    @classmethod
    def _of(cls, region):
        face = object.__new__(Face)
        face._region = region
        return face

    def _moved_by(self, rows, offset):
        return self._copy_with(_region=self._region.moved(rows, offset))

    @property
    def area(self):
        return self._region.area()

    def __bool__(self):
        return True

    def _wonky_faces(self):
        return [self._region.host_profile()]

    def _wonky_edges(self):
        return self._region.edges()

    def _wonky_vertices(self):
        return self._region.vertices()

    def __add__(self, other):
        return _unsupported("Face + ... is not implemented by the Python frontend: it needs a planar region "
                            "Boolean, which the Bend kernel does not have")

    __sub__ = __and__ = __add__

    def __repr__(self):
        return f"<Bend Face: area {self.area:.6g}>"


class Wire(_Profile):
    """A polygon Wire in world coordinates (Wire.make_polygon, Polyline)."""

    def __init__(self, *args, **kwargs):
        _unsupported("Wire(...) from edges is not implemented by the Python frontend; use Wire.make_polygon or "
                     "Polyline")

    @classmethod
    def _of(cls, points, closed, kind=None):
        wire = object.__new__(kind or Wire)
        wire._points, wire._closed = tuple(points), closed
        return wire

    @classmethod
    def make_polygon(cls, vertices, close=True):
        """Wire.make_polygon(vertices, close=True): closes unless the last point repeats the first."""
        points = [_point(v, "Wire.make_polygon vertex") for v in vertices]
        if not points:
            raise ValueError("Wire.make_polygon needs vertices")
        closed = bool(close)
        if not closed and len(points) > 1 and _norm(_sub(points[0], points[-1])) <= _CONFUSION:
            closed = True
        kept = _polygon_points(points) if closed else [p for i, p in enumerate(points)
                                                       if i == 0 or _norm(_sub(p, points[i - 1])) > _CONFUSION]
        if len(kept) < 2:
            raise ValueError("Wire.make_polygon needs at least two distinct points")
        return Wire._of(kept, closed)

    def _moved_by(self, rows, offset):
        return self._copy_with(_points=tuple(_apply(rows, offset, p) for p in self._points))

    def _face_region(self, what):
        if not self._closed:
            raise ValueError("Face can only be created with closed wires")
        return _polygon_region(list(self._points), what)

    @property
    def area(self):
        return 0.0

    @property
    def is_closed(self):
        return self._closed

    def _wonky_edges(self):
        points = self._points
        count = len(points) if self._closed else len(points) - 1
        return [{"geom": "LINE", "start": points[i], "end": points[(i + 1) % len(points)]} for i in range(count)]

    def _wonky_vertices(self):
        return list(self._points)

    def __add__(self, other):
        return _unsupported("Wire + ... is not implemented by the Python frontend")

    __sub__ = __and__ = __add__

    def __repr__(self):
        return f"<Bend {type(self).__name__}: {len(self._points)} points, {'closed' if self._closed else 'open'}>"


class Polyline(Wire):
    """Polyline(*pts, close=False, mode=ADD): straight edges through the points (a BuildLine Curve)."""

    def __init__(self, *pts, close=False, mode=_DEFAULT, **kwargs):
        _no_kwargs("Polyline", kwargs)
        mode = _mode(mode)
        if mode is not _shim("Mode").ADD:
            _unsupported(f"Polyline(mode={mode}) is not implemented by the Python frontend; use Mode.ADD")
        points = _flatten_points(pts)
        if len(points) < 2:
            raise ValueError("Polyline requires two or more pts")
        for a, b in zip(points, points[1:]):
            if _norm(_sub(a, b)) <= _CONFUSION:
                _unsupported("Polyline with two coincident consecutive points (a zero-length edge) is not "
                             "implemented by the Python frontend (build123d fails in OCCT)")
        if len(points) > 2 and _norm(_sub(points[0], points[-1])) <= 1e-5:
            points, closed = points[:-1], True  # the last point repeats the first: already closed
        else:
            closed = bool(close)  # build123d adds the closing edge
        self._points, self._closed = tuple(points), closed
        self.mode = mode


def make_face(edges=None, mode=_DEFAULT):
    """make_face(wire): the face of one closed polygon wire, flipped when its normal has a negative world Z."""
    mode = _mode(mode)
    if mode is not _shim("Mode").ADD:
        _unsupported(f"make_face(mode={mode}) is not implemented by the Python frontend; use Mode.ADD")
    if edges is None:
        raise ValueError("No objects to create a face")
    items = [edges] if isinstance(edges, Wire) else (list(edges) if isinstance(edges, (list, tuple)) else None)
    if items is None or len(items) != 1 or not isinstance(items[0], Wire):
        return _unsupported("make_face is implemented by the Python frontend only for one closed polygon Wire "
                            "(Polyline or Wire.make_polygon); combining edges needs Wire.combine")
    region = items[0]._face_region("make_face")
    if region.frame.z[2] < 0:
        region = region.flipped()
    return Sketch._of((region,))


BUILD123D = {
    "Sketch": Sketch,
    "Circle": Circle,
    "Rectangle": Rectangle,
    "RectangleRounded": RectangleRounded,
    "Polygon": Polygon,
    "RegularPolygon": RegularPolygon,
    "Polyline": Polyline,
    "Wire": Wire,
    "Face": Face,
    "make_face": make_face,
}

CLASS_ATTRIBUTES = {
    "Wire.make_polygon": Wire.__dict__["make_polygon"],  # the classmethod itself, so subclasses keep it
}
