"""build123d 0.13 queries and selectors: bounding_box, is_valid, solids, edges, ShapeList, Edge.

Loaded by path from python/build123d.py after ``_b3d_core`` and
``_b3d_location``. The geometry comes from two host queries over the Bend
B-reps a handle owns (src/python.mjs, never re-attributing a body):

- ``bounds {handle}``: ``{min, max}`` in mm, the union of the solids' tight
  bounds, ``None`` for a shape without solids; a body whose tight bounds Bend
  has not evaluated is a capability error raised by the host;
- ``edges {handle}``: one record per edge of every solid, in Bend topology
  order: ``curve`` (``line``/``circle``/...), the ``start``/``end`` vertex
  coordinates, ``sameSense``, the carrier ``range``, ``length``, and for a
  line its unit ``direction`` (start to end), for a circle ``center``,
  ``axis``, ``x``, ``radius``, ``closed``.

Everything else is evaluated here, exactly, from those analytic records,
following build123d 0.13.0 (tmp/w5b/g-query/oracle.py, frozen in
test/python-query.test.mjs):

- ``Edge.center()`` is ``position_at(0.5)``: the arc-length midpoint (for a
  full circle the point opposite its seam vertex, not the circle's center);
  ``CenterOf.MASS`` is the analytic centroid of the line or arc;
- ``filter_by(Axis)`` keeps straight edges whose direction is parallel to the
  axis within ``tolerance`` degrees (gp_Ax1.IsParallel, gp_Dir.Angle);
- ``group_by(Axis)`` keys are ``round(z, 6)`` of the center in the axis
  frame, groups sorted by key (itertools.groupby over the sorted list);
  ``sort_by(Axis)`` sorts by the unrounded key; both sorts are stable;
- ``bounding_box()`` is build123d's ``optimal`` box: tight, without gap.

The host's ``edges`` records are unified as build123d's ``clean()``
(ShapeUpgrade_UnifySameDomain) leaves them: Bend's split coplanar faces and
collinear edge pieces are merged there; where OpenCascade's outcome is not
determined by the Bend body, the query is a capability error.

Two things build123d takes from OpenCascade's topology traversal, which Bend
does not reproduce: the ORDER of ``edges()`` and an edge's DIRECTION. Neither
is ever guessed. A ShapeList records which of its items are in Bend order
among each other (``_wonky_ties``); indexing, ``first``/``last``, slicing,
``index`` and ``pop`` that would pick one of them by that order are capability
errors, while filters, groups, sorts by distinct keys, iteration of whole
lists and set operations work. Evaluations that depend on the direction
(``start_point``/``end_point`` of an open edge, ``position_at`` away from the
midpoint, ``tangent_at``, ``@``, ``%``) are capability errors; centers, lengths,
radii, groups, their order and their contents are build123d's. Faces,
vertices, wires and the remaining selectors are capability errors at their use.

Float noise is a third such source: keys closer than the edges' coordinate
noise (the host's ``noise`` field) are one tie after a sort, a group_by key
whose rounding the noise could flip and a filter_by(Axis) angle within noise of
the tolerance are refused. Seams of full cylinder faces after Booleans are the
operand's (the host moves them); where no operand fixes one, the edges carry
``seam: unknown`` and refuse seam-dependent evaluations.
"""

import itertools as _itertools
import math as _math
import sys as _sys

_core = _sys.modules["_b3d_core"]
_location = _sys.modules["_b3d_location"]
_unsupported = _core._unsupported
_request = _core._request
_Shape = _core.Shape
_GeometryMeta = _location._GeometryMeta
_missing = _location._missing
Vector = _location.Vector
Location = _location.Location
Axis = _location.Axis
Plane = _location.Plane


def _enum(name):
    """A frozen build123d enum (GeomType, CenterOf, ...), bound by the loader after this module loads."""
    return getattr(_sys.modules["build123d"], name)


# ---------------------------------------------------------------------------
# Small vector helpers (plain tuples, mm).

def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a):
    return _math.sqrt(_dot(a, a))


def _unit(a):
    length = _norm(a)
    return (a[0] / length, a[1] / length, a[2] / length)


def _dir_angle(a, b):
    """gp_Dir::Angle, operation for operation (acos near 90 degrees, asin of the cross product otherwise)."""
    cosine = _dot(a, b)
    if -0.70710678118655 < cosine < 0.70710678118655:
        return _math.acos(cosine)
    sine = _norm(_cross(a, b))
    return _math.pi - _math.asin(sine) if cosine < 0.0 else _math.asin(sine)


def _parallel(a, b, tolerance_degrees):
    """gp_Ax1::IsParallel with build123d's angular tolerance in degrees."""
    angle = _dir_angle(_unit(a), _unit(b))
    tolerance = tolerance_degrees * (_math.pi / 180)
    return angle <= tolerance or _math.pi - angle <= tolerance


def _axis_key(axis):
    """build123d's Axis sort key: z of the object's center in the axis frame (axis.location.inverse())."""
    if not isinstance(axis, Axis):
        raise ValueError("Cannot group by an empty axis")
    frame = axis.location.inverse()

    def key(obj):
        # An edge whose seam OCCT would place (a full circle, the seam line of a
        # full cylinder): turning it about its axis keeps its key along a
        # parallel axis, so Bend's own position of it gives that key.
        if isinstance(obj, Edge) and obj._seam_unknown():
            seam_axis = obj._record.get("seamAxis") or obj._record["axis"]
            if _parallel(axis._direction, seam_axis, 1e-12 * 180 / _math.pi):
                return (frame * Location(obj._seam_invariant_point())).position.Z
        return (frame * Location(obj.center())).position.Z
    return key


def _number_arg(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a number")
    return float(value)


# ---------------------------------------------------------------------------
# BoundBox

class BoundBox(metaclass=_GeometryMeta):
    """build123d.BoundBox of a shape: the tight (``optimal``) axis-aligned box, no gap."""

    build123d_type = "BoundBox"
    _wonky_public = frozenset({
        "add", "center", "contains", "contains_properly", "covered_by", "covers", "diagonal", "disjoint",
        "find_outside_box_2d", "from_topo_ds", "intersects", "is_inside", "max", "measure", "min", "overlaps",
        "size", "to_align_offset", "touches", "within", "wrapped"})

    def __init__(self, *args, **kwargs):
        _unsupported("BoundBox(...) takes an OpenCascade (OCP) Bnd_Box or shape, and external geometry is disabled: "
                     "use shape.bounding_box()")

    @classmethod
    def _of(cls, bounds):
        box = object.__new__(cls)
        # An empty shape: build123d's void Bnd_Box gives zeros and wrapped None.
        lo, hi = (bounds["min"], bounds["max"]) if bounds is not None else ((0.0,) * 3, (0.0,) * 3)
        lo, hi = tuple(float(v) for v in lo), tuple(float(v) for v in hi)
        box._void = bounds is None
        box.min = Vector._of(lo)
        box.max = Vector._of(hi)
        box.size = Vector._of((hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]))
        return box

    @property
    def diagonal(self):
        """Body diagonal length (Bnd_Box.SquareExtent ** 0.5 without gap)."""
        if self._void:
            return 0.0
        dx, dy, dz = self.size
        return (dx * dx + dy * dy + dz * dz) ** 0.5

    @property
    def measure(self):
        """Product of the extents larger than build123d's TOLERANCE (1e-6)."""
        return _math.prod([x for x in self.size if x > _location.TOLERANCE])

    def center(self):
        return (self.min + self.max) / 2

    def __repr__(self):
        return (f"bbox: {self.min.X} <= x <= {self.max.X}, {self.min.Y} <= y <= {self.max.Y}, "
                f"{self.min.Z} <= z <= {self.max.Z}")

    def __getattr__(self, name):
        return _missing(self, name)


# ---------------------------------------------------------------------------
# Edge

class Edge(metaclass=_GeometryMeta):
    """build123d.Edge selected from a Bend shape: a line or circle (arc) with exact analytic geometry.

    Not a ``Shape`` subclass here: a Shape is a host handle of solids, an Edge a
    read-only record of one of its edges. Its identity (``==``, hashing, sets in
    ShapeList ``-``/``&``) is the edge of that solid in that shape.
    """

    __slots__ = ("_record", "_key")
    build123d_type = "Edge"
    order = 1.0
    _wonky_public = frozenset({
        "ancestors", "anchestors", "arc_center", "area", "as_shape", "bounding_box", "build123d_type", "cast",
        "center", "children", "clean", "close", "closest_points", "color", "combined_center", "common_plane",
        "composite_factories", "compound", "compounds", "compute_mass", "compute_volume", "convexity",
        "copy_attributes_to", "curvature_comb", "cut", "depth", "derivative_at", "descendants", "distance",
        "distance_to", "distance_to_with_closest_points", "distances", "distribute_locations", "downcast_LUT", "edge",
        "edges", "end_point", "entities", "extrude", "face", "faces", "faces_intersected_by_axis",
        "find_intersection_points", "find_tangent", "fix", "fuse", "geom_LUT_EDGE", "geom_LUT_FACE", "geom_adaptor",
        "geom_equal", "geom_type", "geometry_constructors", "get_shape_list", "get_single_shape",
        "get_top_level_shapes", "global_location", "height", "intersect", "inverse_shape_LUT", "is_closed",
        "is_equal", "is_forward", "is_infinite", "is_interior", "is_leaf", "is_manifold", "is_null", "is_root",
        "is_same", "is_valid", "iter_path_reverse", "leaves", "length", "locate", "located", "location",
        "location_at", "locations", "make_bezier", "make_bspline", "make_circle", "make_composite",
        "make_constrained_arcs", "make_constrained_lines", "make_ellipse", "make_helix", "make_hyperbola",
        "make_line", "make_mid_way", "make_parabola", "make_spline", "make_spline_approx", "make_tangent_arc",
        "make_three_point_arc", "mass", "material", "matrix_of_inertia", "mesh", "mirror", "move", "moved", "normal",
        "offset_2d", "order", "orientation", "oriented_bounding_box", "param_at", "param_at_point", "parent", "path",
        "perpendicular_line", "position", "position_at", "positions", "principal_properties", "project",
        "project_faces", "project_to_shape", "project_to_viewport", "radius", "radius_of_gyration",
        "register_composite_factory", "register_geometry_constructor", "register_shape_constructor", "reversed",
        "root", "rotate", "scale", "separator", "shape_LUT", "shape_constructors", "shape_properties_LUT",
        "shape_type", "shell", "shells", "show_topology", "siblings", "size", "solid", "solids", "split",
        "start_point", "static_moments", "tangent_angle_at", "tangent_at", "tessellate", "tessellate_with_uvs",
        "to_splines", "topo_owner", "topo_parent", "touch", "transform_geometry", "transform_shape", "transformed",
        "translate", "trim", "trim_infinite", "trim_to_length", "trim_to_other", "vertex", "vertices", "volume",
        "wire", "wires", "wrapped"})

    def __init__(self, *args, **kwargs):
        _unsupported("Edge(...) construction is not implemented by the Python frontend; "
                     "edges come from shape.edges()")

    @classmethod
    def _of(cls, record, key):
        edge = object.__new__(cls)
        edge._record = record
        edge._key = key
        return edge

    # --- geometry of the carrier curve -----------------------------------

    def _kind(self):
        return self._record["curve"]

    def _circle_frame(self):
        record = self._record
        z = _unit(record["axis"])
        x = _unit(record["x"])
        return tuple(record["center"]), x, _cross(z, x), float(record["radius"])

    def _sweep(self):
        """(first, last) carrier parameters of a circle edge, as OCCT's curve range."""
        record = self._record
        if record.get("closed"):
            center, x, y, _ = self._circle_frame()
            v = _sub(record["start"], center)
            first = _math.atan2(_dot(v, y), _dot(v, x))
            return first, first + 2 * _math.pi
        first, last = record["range"]
        return float(first), float(last)

    def _require_analytic(self, what):
        kind = self._kind()
        if kind not in ("line", "circle"):
            return _unsupported(f"Edge.{what} is not implemented for a {kind} edge by the Python frontend "
                                f"(only lines and circles are evaluated)")
        return kind

    def _circle_point(self, parameter):
        center, x, y, radius = self._circle_frame()
        c, s = _math.cos(parameter), _math.sin(parameter)
        return tuple(center[k] + radius * (c * x[k] + s * y[k]) for k in range(3))

    def _parameter(self, fraction):
        """Circle parameter at a normalized arc-length fraction from the edge's start (edge direction)."""
        first, last = self._sweep()
        forward = self._record.get("sameSense", True) is not False
        return first + fraction * (last - first) if forward else last - fraction * (last - first)

    def _fraction(self, position, position_mode):
        mode = _enum("PositionMode")
        position = _number_arg(position, "position")
        if position_mode is mode.PARAMETER:
            return position
        if position_mode is mode.LENGTH:
            return position / self.length
        raise ValueError(f"Unsupported position_mode: {position_mode}")

    # --- build123d Edge API ----------------------------------------------

    @property
    def geom_type(self):
        kind = self._kind()
        name = {"line": "LINE", "circle": "CIRCLE", "ellipse": "ELLIPSE"}.get(kind)
        if name is None:
            return _unsupported(f"Edge.geom_type is not implemented for a Bend '{kind}' edge")
        return getattr(_enum("GeomType"), name)

    @property
    def length(self):
        length = self._record.get("length")
        if length is None:
            return _unsupported(f"Edge.length is not implemented for a {self._kind()} edge: Bend has no exact "
                                f"length for it (elliptic arc length), and it is never approximated")
        return float(length)

    @property
    def radius(self):
        if self._kind() != "circle":
            raise ValueError("Shape could not be reduced to a circle")
        return float(self._record["radius"])

    @property
    def arc_center(self):
        kind = self._kind()
        if kind in ("circle", "ellipse") and "center" in self._record:
            return Vector._of(tuple(float(v) for v in self._record["center"]))
        raise ValueError(f"{self.geom_type} has no arc center")

    @property
    def is_closed(self):
        record = self._record
        return bool(record.get("closed")) or tuple(record["start"]) == tuple(record["end"])

    @property
    def is_valid(self):
        return True

    def _seam_unknown(self):
        """A full circle (merged from Bend arcs, or ending a full cylinder face) or the seam line of a full
        cylinder face whose seam OpenCascade places, from data Bend does not keep."""
        return self._record.get("seam") == "unknown"

    def _seam_invariant_point(self):
        """A point of the edge whose projection on its seam axis does not depend on where the seam lies."""
        record = self._record
        if self._kind() == "circle":
            return Vector._of(tuple(float(v) for v in record["center"]))
        a, b = record["start"], record["end"]
        return Vector._of(tuple((a[k] + b[k]) / 2 for k in range(3)))

    def _refuse_seam(self, what):
        return _unsupported(f"Edge.{what} is not implemented for this edge: it depends on where the seam of its full "
                            f"curved face lies, which build123d takes from OpenCascade's surface parametrization and "
                            f"Bend's body does not fix")

    def _refuse_direction(self, what):
        return _unsupported(f"Edge.{what} is not implemented by the Python frontend: it depends on the edge's direction, "
                            f"which build123d takes from OpenCascade's topology and Bend does not reproduce "
                            f"(centers, lengths and radii are exact)")

    def start_point(self):
        if self._seam_unknown():
            return self._refuse_seam("start_point")
        if not self.is_closed:
            return self._refuse_direction("start_point")
        return Vector._of(tuple(float(v) for v in self._record["start"]))

    def end_point(self):
        if self._seam_unknown():
            return self._refuse_seam("end_point")
        if not self.is_closed:
            return self._refuse_direction("end_point")
        return Vector._of(tuple(float(v) for v in self._record["end"]))

    def position_at(self, position, position_mode=None):
        """Point at a normalized arc-length parameter (or a length with PositionMode.LENGTH) from the edge start.

        Only where the edge's direction does not matter: the midpoint, and for a
        closed circle also its seam (0 and 1).
        """
        mode = _enum("PositionMode")
        fraction = self._fraction(position, mode.PARAMETER if position_mode is None else position_mode)
        kind = self._require_analytic("position_at")
        if self._seam_unknown():
            return self._refuse_seam("position_at")
        if fraction != 0.5 and not (self.is_closed and fraction in (0.0, 1.0)):
            return self._refuse_direction(f"position_at({position})")
        record = self._record
        if fraction != 0.5:
            # The seam vertex of a closed circle, whichever way OCCT runs it
            # (evaluated at 0 or 2*pi it differs from the vertex by ~1e-16 * r).
            return Vector._of(tuple(float(v) for v in record["start"]))
        if kind == "line":
            a, b = record["start"], record["end"]
            return Vector._of(tuple(a[k] + fraction * (b[k] - a[k]) for k in range(3)))
        return Vector._of(self._circle_point(self._parameter(fraction)))

    def tangent_at(self, position=0.5, position_mode=None):
        """Unit tangent in the edge direction at a normalized parameter (or length); points are not supported."""
        if not isinstance(position, (int, float)) or isinstance(position, bool):
            return _unsupported("Edge.tangent_at(point) is not implemented by the Python frontend; "
                                "pass a normalized parameter")
        mode = _enum("PositionMode")
        fraction = self._fraction(position, mode.PARAMETER if position_mode is None else position_mode)
        kind = self._require_analytic("tangent_at")
        self._refuse_direction("tangent_at")
        record = self._record
        if kind == "line":
            return Vector._of(_unit(record["direction"]))
        _, x, y, _ = self._circle_frame()
        parameter = self._parameter(fraction)
        c, s = _math.cos(parameter), _math.sin(parameter)
        derivative = tuple(-s * x[k] + c * y[k] for k in range(3))
        if record.get("sameSense", True) is False:
            derivative = tuple(-v for v in derivative)
        return Vector._of(_unit(derivative))

    def center(self, center_of=None):
        """build123d Edge.center: GEOMETRY = position_at(0.5); MASS = the analytic centroid."""
        center_enum = _enum("CenterOf")
        if center_of is None or center_of is center_enum.GEOMETRY:
            if self._seam_unknown():
                return self._refuse_seam("center()")
            return self.position_at(0.5)
        if center_of is center_enum.MASS:
            kind = self._require_analytic("center(CenterOf.MASS)")
            if kind == "line":
                return self.position_at(0.5)
            first, last = self._sweep()
            half = (last - first) / 2
            center, _, _, radius = self._circle_frame()
            if abs(half - _math.pi) <= 1e-15:
                return Vector._of(tuple(float(v) for v in center))
            middle = self._circle_point(first + half)
            factor = _math.sin(half) / half
            return Vector._of(tuple(center[k] + factor * (middle[k] - center[k]) for k in range(3)))
        if center_of is center_enum.BOUNDING_BOX:
            return _unsupported("Edge.center(CenterOf.BOUNDING_BOX) is not implemented by the Python frontend")
        raise ValueError(f"Unsupported center_of: {center_of}")

    def edges(self):
        return ShapeList([self])

    def __matmul__(self, position):
        """Mixin1D ``edge @ t``: position_at(t)."""
        return self.position_at(position)

    def __mod__(self, position):
        """Mixin1D ``edge % t``: tangent_at(t)."""
        return self.tangent_at(position)

    def __eq__(self, other):
        if isinstance(other, Edge):
            return self._key == other._key
        return NotImplemented

    def __hash__(self):
        return hash(("Edge",) + self._key)

    def __repr__(self):
        return f"<Bend Edge {self._record['curve']} {self._key[0]}[{self._key[1]}].{self._key[2]}>"

    def __getattr__(self, name):
        return _missing(self, name)


def _handles(shape):
    """The host handles whose solids make up ``shape``, in order.

    A plain Shape owns one handle. A Python-side container of python/_b3d_ops.py
    (an empty ``Part()``, a ``Compound`` grouping several shapes) stands for
    none or several; that module's ``_handles`` knows which.
    """
    ops = _sys.modules.get("_b3d_ops")
    if ops is not None:
        return list(ops._handles(shape))
    return [shape._handle]


def _edge_list(shape):
    """ShapeList of a shape's edges, solid by solid, in Bend topology order."""
    return _unordered(Edge._of(record, (handle, int(record["solid"]), int(record["index"])))
                      for handle in _handles(shape) for record in _request("edges", handle=handle))


# ---------------------------------------------------------------------------
# ShapeList and GroupBy

def _topology(value):
    return isinstance(value, (_Shape, Edge, Vector))


# Tie labels. ``_wonky_ties`` maps id(item) to (item, label); items that share
# a label are in Bend's order among each other, which build123d would take
# from OpenCascade's traversal instead. Items without a label have the
# position build123d gives them. Labels are hashable tuples.

class _Token:
    __slots__ = ()


def _label(items, item):
    entry = (getattr(items, "_wonky_ties", None) or {}).get(id(item))
    return entry[1] if entry is not None and entry[0] is item else None


def _with_ties(items, labels):
    """A ShapeList of ``items`` whose labels (None: determined) are ``labels``."""
    result = ShapeList(items)
    counts = {}
    for label in labels:
        if label is not None:
            counts[label] = counts.get(label, 0) + 1
    ties = {id(item): (item, label) for item, label in zip(items, labels) if label is not None and counts[label] > 1}
    if ties:
        result._wonky_ties = ties
    return result


def _unordered(items):
    """A ShapeList whose whole order is not build123d's (Bend topology order, or set order)."""
    items = list(items)
    token = (_Token(),)
    return _with_ties(items, [token] * len(items))


def _refined(label, key):
    """The label of an item after a stable sort or group by ``key``: ties stay only among equal keys."""
    if label is None:
        return None
    try:
        hash(key)
    except TypeError:
        return label
    return (label, key)


def _refuse_order(what):
    return _unsupported(f"ShapeList{what} is not implemented here: it picks among edges whose order build123d takes from "
                        f"OpenCascade's topology traversal or from float rounding noise (keys equal within noise), "
                        f"which Bend does not reproduce; select by a key that "
                        f"separates them (sort_by, group_by, filter_by) or use the whole list")


# Float noise. build123d does not round sort keys: two edges whose keys are
# mathematically equal get OpenCascade's rounding noise, and Bend's keys get
# Bend's, a different one. Their order (and, for group_by, the rounding of a
# key that lies on a rounding boundary) is then noise, not geometry. Each host
# edge record states its body's coordinate noise in mm (src/python.mjs
# coordinateNoise); keys closer than their combined slack are not ordered by
# the model. A sort makes them one tie (picking among them is refused), a
# group_by whose rounding they could flip is refused.
_RELATIVE_SLACK = 1e-10
_DEFAULT_NOISE = 1e-10  # objects without a noise record (whole shapes): an absolute floor in mm


def _noise(obj):
    if isinstance(obj, Edge):
        noise = obj._record.get("noise")
        if isinstance(noise, (int, float)) and noise >= 0:
            return float(noise)
    return _DEFAULT_NOISE


def _is_real(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _slack(obj, value):
    """Bound on how far ``value`` (a key derived from ``obj``'s coordinates) may lie from the exact key.

    Keys are lengths, projections, distances, radii (at most twice a coordinate
    error), or a callable's value; 4x the coordinate noise plus 1e-10 of the key
    covers them with margin.
    """
    return 4 * _noise(obj) + _RELATIVE_SLACK * abs(value)


def _compare(key_a, obj_a, key_b, obj_b):
    """'apart' (ordered by the geometry), 'equal' (exactly equal non-float keys) or 'noisy'."""
    if _is_real(key_a) and _is_real(key_b):
        if isinstance(key_a, int) and isinstance(key_b, int):
            return "equal" if key_a == key_b else "apart"
        if abs(key_a - key_b) > _slack(obj_a, key_a) + _slack(obj_b, key_b):
            return "apart"
        return "noisy"
    if isinstance(key_a, (tuple, list)) and isinstance(key_b, (tuple, list)):
        for a, b in zip(key_a, key_b):
            state = _compare(a, obj_a, b, obj_b)
            if state != "equal":
                return state
        return "equal" if len(key_a) == len(key_b) else "apart"
    try:
        return "equal" if key_a == key_b else "apart"
    except Exception:  # noqa: BLE001 - unorderable keys fail in sorted() as in build123d
        return "apart"


def _refuse_noise(what, detail):
    return _unsupported(f"ShapeList.{what} is not implemented for these edges: {detail}, which is float noise (build123d "
                        f"gets OpenCascade's, Bend its own), not geometry; select by a key that separates them")


def _rounded_key(obj, value, digits, what):
    """build123d's round(key, tol_digits), refused when the key's noise could round it either way."""
    try:
        rounded = round(value, digits)
    except TypeError:
        return value
    if _is_real(value) and not isinstance(value, int):
        slack = _slack(obj, value)
        if round(value - slack, digits) != rounded or round(value + slack, digits) != rounded:
            return _refuse_noise(what, f"the key {value!r} lies within {slack:.1e} of a boundary of its rounding to "
                                       f"{digits} digits, so which group it falls in")
    return rounded


class ShapeList(list):
    """build123d.ShapeList: a list with CAD filters, sorts and groups."""

    build123d_type = "ShapeList"
    _wonky_public = frozenset({
        "append", "build123d_type", "center", "clear", "compound", "compounds", "copy", "count", "edge", "edges",
        "expand", "extend", "face", "faces", "filter_by", "filter_by_position", "first", "group_by", "index",
        "insert", "last", "pop", "remove", "reverse", "shell", "shells", "solid", "solids", "sort", "sort_by",
        "sort_by_distance", "vertex", "vertices", "wire", "wires"})

    @property
    def first(self):
        return self[0]

    @property
    def last(self):
        return self[-1]

    def _labels(self):
        return [_label(self, o) for o in self]

    def __add__(self, other):
        left = (_Token(),)
        labels = [None if label is None else (left, label) for label in self._labels()]
        if _topology(other):
            return _with_ties(list(self) + [other], labels + [None])
        if isinstance(other, (list, tuple, ShapeList)) or hasattr(other, "__iter__"):
            items = list(other)
            if all(_topology(o) for o in items):
                right = (_Token(),)
                return _with_ties(list(self) + items, labels + [None if _label(other, o) is None else (right, _label(other, o))
                                                                 for o in items])
        raise TypeError(f"Cannot add object of type {type(other)} to ShapeList")

    def __iadd__(self, other):
        combined = self + other  # the same TypeError as +
        list.extend(self, list.__getitem__(combined, slice(len(self), None)))
        self._wonky_ties = getattr(combined, "_wonky_ties", None) or {}
        return self

    # build123d builds these from Python sets: their order is not defined there either.
    def __and__(self, other):
        return _unordered(set(self) & set(other))

    def __sub__(self, other):
        return _unordered(set(self) - set(other))

    def __eq__(self, other):
        return set(self) == set(other) if isinstance(other, ShapeList) else NotImplemented

    def __ne__(self, other):
        return set(self) != set(other) if isinstance(other, ShapeList) else NotImplemented

    __hash__ = None

    def __getitem__(self, key):
        if isinstance(key, slice):
            items = list.__getitem__(self, key)
            labels = [_label(self, o) for o in items]
            inside = {}
            for label in labels:
                if label is not None:
                    inside[label] = inside.get(label, 0) + 1
            if inside:
                whole = {}
                for label in self._labels():
                    if label in inside:
                        whole[label] = whole.get(label, 0) + 1
                if whole != inside:
                    return _refuse_order(f"[{key.start}:{key.stop}:{key.step}]")
            return _with_ties(items, labels)
        item = list.__getitem__(self, key)
        if _label(self, item) is not None:
            return _refuse_order(f"[{key}]")
        return item

    def index(self, *args):
        position = list.index(self, *args)
        if _label(self, list.__getitem__(self, position)) is not None:
            return _refuse_order(".index")
        return position

    def pop(self, index=-1):
        if _label(self, list.__getitem__(self, index)) is not None:
            return _refuse_order(f".pop({index})")
        return list.pop(self, index)

    def __gt__(self, sort_by=None):
        return self.sort_by(Axis.Z if sort_by is None else sort_by)

    def __lt__(self, sort_by=None):
        return self.sort_by(Axis.Z if sort_by is None else sort_by, reverse=True)

    def __or__(self, filter_by=None):
        return self.filter_by(Axis.Z if filter_by is None else filter_by)

    def __lshift__(self, group_by=None):
        return self.group_by(Axis.Z if group_by is None else group_by)[0]

    def __rshift__(self, group_by=None):
        return self.group_by(Axis.Z if group_by is None else group_by)[-1]

    def center(self):
        if not self:
            return Vector(0, 0, 0)
        total = sum((o.center() for o in self), Vector(0, 0, 0))
        return total / len(self)

    def edges(self):
        return _unordered(e for shape in self for e in shape.edges())

    def edge(self):
        edges = self.edges()
        if len(edges) != 1:
            raise ValueError(f"Expected exactly one edge, found {len(edges)}")
        return edges[0]

    def solids(self):
        return ShapeList([s for shape in self for s in shape.solids()])

    def solid(self):
        solids = self.solids()
        if len(solids) != 1:
            raise ValueError(f"Expected exactly one solid, found {len(solids)}")
        return solids[0]

    def filter_by(self, filter_by, reverse=False, tolerance=1e-5):
        """Filter by a callable, a property, an Axis (parallel straight edges) or a GeomType."""
        geom_type = _enum("GeomType")
        if callable(filter_by):
            predicate = filter_by
        elif isinstance(filter_by, property):
            def predicate(obj):
                return filter_by.__get__(obj)
        elif isinstance(filter_by, Axis):
            direction = filter_by._direction
            tolerance = _number_arg(tolerance, "tolerance")

            def predicate(obj):
                if isinstance(obj, Edge) and obj._kind() == "line":
                    # An edge whose angle to the axis lies within its float noise
                    # of the tolerance is kept or dropped by rounding noise.
                    angle = _dir_angle(_unit(direction), _unit(obj._record["direction"]))
                    limit = tolerance * (_math.pi / 180)
                    noise = 8 * _noise(obj) / max(obj.length, 1e-300) + 1e-15
                    if abs(angle - limit) <= noise or abs(_math.pi - angle - limit) <= noise:
                        return _refuse_noise("filter_by(Axis)", f"an edge's angle to the axis ({angle:.3e} rad) lies "
                                                                f"within {noise:.1e} rad of the {tolerance} degree "
                                                                f"tolerance, so whether it is kept")
                    return _parallel(direction, obj._record["direction"], tolerance)
                if isinstance(obj, (Edge, _Shape)):
                    return False  # neither a planar face nor a straight edge (a solid, a compound), as build123d
                return _unsupported(f"filter_by(Axis) on a {type(obj).__name__} is not implemented by the Python "
                                    f"frontend (only edges are selected from Bend shapes)")
        elif isinstance(filter_by, geom_type):
            def predicate(obj):
                return obj.geom_type == filter_by
        elif isinstance(filter_by, Plane):
            return _unsupported("filter_by(Plane) is not implemented by the Python frontend")
        elif isinstance(filter_by, _enum("Convexity")):
            return _unsupported("filter_by(Convexity) is not implemented by the Python frontend: it needs the "
                                "faces adjacent to each edge")
        else:
            raise ValueError(f"Unsupported filter_by predicate: {filter_by}")
        kept = [obj for obj in self if not predicate(obj)] if reverse else list(filter(predicate, self))
        return _with_ties(kept, [_label(self, o) for o in kept])

    def _key_function(self, criterion, what, round_digits=None):
        sort_enum = _enum("SortBy")

        def rounded(obj, value):
            return value if round_digits is None else _rounded_key(obj, value, round_digits, what)

        if isinstance(criterion, Axis):
            key = _axis_key(criterion)
            return lambda obj: rounded(obj, key(obj))
        if isinstance(criterion, sort_enum):
            if criterion is sort_enum.LENGTH:
                return lambda obj: rounded(obj, obj.length)
            if criterion is sort_enum.RADIUS:
                return lambda obj: rounded(obj, obj.radius)
            if criterion is sort_enum.DISTANCE:
                return lambda obj: rounded(obj, obj.center().length)
            return _unsupported(f"{what}(SortBy.{criterion.name}) is not implemented by the Python frontend "
                                f"(edges have no area or volume)")
        return _unsupported(f"{what}({type(criterion).__name__}) is not implemented by the Python frontend")

    def group_by(self, group_by=None, reverse=False, tol_digits=6):
        """Group by an Axis, SortBy, callable or property; groups sorted by their (rounded) key."""
        group_by = Axis.Z if group_by is None else group_by
        if isinstance(group_by, type):
            if group_by is not _enum("Convexity"):
                raise ValueError(f"Unsupported group_by function: {group_by}")
            return _unsupported("group_by(Convexity) is not implemented by the Python frontend: it needs the "
                                "faces adjacent to each edge")
        if isinstance(group_by, (Axis, _enum("SortBy"))):
            key_f = self._key_function(group_by, "group_by", tol_digits)
        elif not group_by:
            raise ValueError("Cannot group by an empty object")
        elif isinstance(group_by, Edge):
            return _unsupported("group_by(Edge) is not implemented by the Python frontend")
        elif callable(group_by):
            def key_f(obj):
                return _rounded_key(obj, group_by(obj), tol_digits, "group_by")
        elif isinstance(group_by, property):
            def key_f(obj):
                return _rounded_key(obj, group_by.__get__(obj), tol_digits, "group_by")
        else:
            raise ValueError(f"Unsupported group_by function: {group_by}")
        return GroupBy(key_f, self, reverse=reverse)

    def sort_by(self, sort_by=None, reverse=False):
        """Sort by an Axis, SortBy, callable or property (stable: equal keys keep list order)."""
        sort_by = Axis.Z if sort_by is None else sort_by
        if callable(sort_by):
            return self._sorted(self, sort_by, reverse)
        if isinstance(sort_by, property):
            return self._sorted(self, sort_by.__get__, reverse)
        if isinstance(sort_by, Edge):
            return _unsupported("sort_by(Edge) is not implemented by the Python frontend")
        if not isinstance(sort_by, (Axis, _enum("SortBy"))):
            if not sort_by:
                raise ValueError("Cannot sort by an empty object")
            raise ValueError("Invalid sort_by criteria provided")
        items = self
        if sort_by is _enum("SortBy").RADIUS:
            # build123d's own filter: hasattr() lets a line's ValueError through, as there.
            items = [obj for obj in self if hasattr(obj, "radius")]
        return self._sorted(items, self._key_function(sort_by, "sort_by"), reverse)

    def _sorted(self, items, key, reverse):
        """Python's stable sort (as build123d's), keeping ties only among items with equal keys.

        Neighbours whose keys lie within float noise of each other become one
        tie: build123d orders them by OpenCascade's rounding, Bend by its own.
        """
        keyed = [(key(o), o) for o in items]
        order = sorted(range(len(keyed)), key=lambda i: keyed[i][0], reverse=reverse)
        labels = [_refined(_label(self, keyed[i][1]), keyed[i][0]) for i in order]
        run = None
        for position in range(1, len(order)):
            (key_a, obj_a), (key_b, obj_b) = keyed[order[position - 1]], keyed[order[position]]
            if _compare(key_a, obj_a, key_b, obj_b) == "noisy":
                if run is None:
                    run = (_Token(),)
                    labels[position - 1] = run
                labels[position] = run
            else:
                run = None
        return _with_ties([keyed[i][1] for i in order], labels)

    def __getattr__(self, name):
        if name.startswith("_") or name not in ShapeList._wonky_public:
            raise AttributeError(f"'ShapeList' object has no attribute {name!r}")
        return _unsupported(f"ShapeList.{name} is not implemented by the Python frontend")

    def __repr__(self):
        return f"ShapeList({list.__repr__(self)})"


class GroupBy:
    """Result of ShapeList.group_by: groups by index (sorted by key) or by key."""

    build123d_type = "GroupBy"

    def __init__(self, key_f, shapelist, *, reverse=False):
        self.key_to_group_index = []
        self.groups = []
        self.key_f = key_f

        def order(shape):
            # enums are not orderable; build123d groups them in definition order
            key = key_f(shape)
            return key.value if isinstance(key, _core._Enum) else key

        ordered = sorted(shapelist, key=order, reverse=reverse)
        # Keys round() cannot round (tuples, vectors) group by exact equality, as
        # in build123d: float components within noise of each other would group
        # by rounding noise there.
        keys = [key_f(shape) for shape in ordered]
        for position in range(1, len(ordered)):
            a, b = keys[position - 1], keys[position]
            if not (_is_real(a) and _is_real(b)) and _compare(a, ordered[position - 1], b, ordered[position]) == "noisy":
                _refuse_noise("group_by", f"the keys {a!r} and {b!r} differ by less than their float noise, so whether "
                                          f"they share a group")
        for i, (key, group) in enumerate(_itertools.groupby(ordered, key=key_f)):
            group = list(group)
            self.groups.append(_with_ties(group, [_refined(_label(shapelist, o), key) for o in group]))
            self.key_to_group_index.append((key, i))

    def __getitem__(self, key):
        return self.groups[key]

    def __iter__(self):
        return iter(self.groups)

    def __len__(self):
        return len(self.groups)

    def __repr__(self):
        return repr(ShapeList(self))

    def group(self, key):
        for k, i in self.key_to_group_index:
            if key == k:
                return self.groups[i]
        raise KeyError(key)

    def group_for(self, shape):
        return self.group(self.key_f(shape))


# ---------------------------------------------------------------------------
# Shape methods

def _select_all(select, what):
    select_enum = _enum("Select")
    if select is not select_enum.ALL:
        return _unsupported(f"Shape.{what}(select=Select.{getattr(select, 'name', select)}) is not implemented by the "
                            f"Python frontend: Bend shapes carry no build123d operation history")
    return None


def _shape_edges(self, select=None):
    """Shape.edges(): every edge of every solid as a ShapeList of Edge (Bend topology order)."""
    if select is not None:
        _select_all(select, "edges")
    return _edge_list(self)


def _shape_solids(self, select=None):
    """Shape.solids(): one shape per solid (sharing the solid's B-rep), as a ShapeList."""
    if select is not None:
        _select_all(select, "solids")
    solid = getattr(_sys.modules["build123d"], "Solid", None)
    cls = solid if isinstance(solid, type) and issubclass(solid, _Shape) else _Shape
    result = ShapeList()
    for owner in _handles(self):
        for handle in _request("solids", handle=owner):
            shape = object.__new__(cls)
            object.__setattr__(shape, "_handle", handle)
            result.append(shape)
    return result


def _shape_bounding_box(self, tolerance=None, optimal=True):
    """Shape.bounding_box(): build123d's optimal box (the tolerance argument has no effect in build123d 0.13)."""
    if tolerance is not None:
        _number_arg(tolerance, "tolerance")
    if optimal is not True:
        return _unsupported("bounding_box(optimal=False) is not implemented by the Python frontend: it is "
                            "OpenCascade's triangulation box enlarged by shape tolerances, which Bend does not model")
    boxes = [box for box in (_request("bounds", handle=handle) for handle in _handles(self)) if box is not None]
    if not boxes:
        return BoundBox._of(None)
    # The union of the solids' tight boxes, as one Bnd_Box of all of them.
    return BoundBox._of({"min": [min(box["min"][k] for box in boxes) for k in range(3)],
                         "max": [max(box["max"][k] for box in boxes) for k in range(3)]})


def _shape_is_valid(self):
    """Shape.is_valid: every Bend body passed its construction audit (closed, oriented, incident) when built."""
    for handle in _handles(self):
        _request("count", handle=handle)
    return True


_core.register_shape_method("edges", _shape_edges)
_core.register_shape_method("solids", _shape_solids)
_core.register_shape_method("bounding_box", _shape_bounding_box)
_core.register_shape_method("is_valid", property(_shape_is_valid))


BUILD123D = {
    "BoundBox": BoundBox,
    "Edge": Edge,
    "ShapeList": ShapeList,
    "GroupBy": GroupBy,
}
