"""build123d 0.13 algebra-mode operations on Bend bodies: extrude, containers, Solid, Cone, Booleans, placement.

Loaded by path from python/build123d.py after ``_b3d_core``, ``_b3d_location``
and ``_b3d_sketch``. Every body is built by the Bend host (ops
``extrude_profile``, ``frustum``, ``boolean``); nothing here approximates or
invents geometry. Semantics follow build123d 0.13.0, checked against it as an
oracle (tmp/w5b/d-ops/*.py, frozen in test/python-ops.test.mjs):

- ``extrude(to_extrude, amount, dir, both)``: one prism of the face along
  ``unit(dir or face normal) * amount``; ``both=True`` spans -amount..+amount.
  ``taper``, ``until``, ``target`` and sketches with several faces are
  capability errors; ``clean`` and ``mode`` change nothing in algebra mode, as
  in build123d.
- ``Part()`` and ``Compound()`` are empty (``bool`` False, no body):
  ``Part() + x`` is a new Part holding x's solid, ``x + Part()`` is x,
  ``Part() - x`` and ``Part() & x`` are build123d's ValueErrors.
  ``Part(shape.wrapped)`` is the same shape (is_same) as a Part;
  ``Compound(children=[...])`` / ``Compound([...])`` group shapes.
- A container of several shapes is kept as a group of Bend handles: Booleans
  distribute over its members exactly (a cut or an intersection per member, a
  union folds everything), volume and solid counts add up. Anything that needs
  one Bend body set (export, the query ops) is a capability error naming the
  missing host operation that groups bodies without fusing them.
- ``Solid.make_box`` / ``Solid.make_cylinder`` build on the given plane
  (``extrude_profile`` of a rectangle or circle), ``Solid.extrude(face, v)``
  extrudes along ``v``; ``Cone`` is a Bend frustum, aligned like build123d
  (``align=None`` is the cone's own frame: centred in x/y, base at z=0) and
  then rotated by ``rotation``.
- ``fuse``/``cut``/``intersect`` and the ``+ - &`` operators fold the host's
  binary ``boolean`` op; ``intersect`` returns a ShapeList of Solids or None.
  Result classes (Solid, Part, Compound) follow build123d's for the common
  operand classes.
- ``rotate(axis, angle)`` / ``translate(v)`` are ``moved()`` by one new
  location (gp_Trsf::SetRotation / SetTranslation); ``transform=True``
  (regenerating the B-rep) is a capability error.
- ``shape.wrapped`` is an opaque token: only ``Part``/``Compound``/``Solid``
  accept it; any other use is the OCP capability error.
"""

import collections.abc as _abc
import math as _math
import numbers as _numbers
import sys as _sys

_core = _sys.modules["_b3d_core"]
_loc = _sys.modules["_b3d_location"]
_Shape = _core.Shape
_Implemented = _core._Implemented
_request = _core._request
_unsupported = _core._unsupported
_HANDLE = _Shape.__dict__["_handle"]  # the core's slot; Compound shadows it with a property


def _mode_add():
    return _core.Mode.ADD


def _sketch_types():
    """C's profile classes (python/_b3d_sketch.py) at call time, or () when that module is absent."""
    module = _sys.modules.get("_b3d_sketch")
    if module is None:
        return ()
    return tuple(getattr(module, name) for name in ("Sketch", "Face", "Wire") if hasattr(module, name))


def _profile_dim(value):
    """2 for sketches and faces, 1 for wires/polylines, None for anything else."""
    module = _sys.modules.get("_b3d_sketch")
    if module is None:
        return None
    if isinstance(value, (module.Sketch, module.Face)):
        return 2
    if isinstance(value, module.Wire):
        return 1
    return None


def _real(value, name):
    if isinstance(value, bool) or not isinstance(value, _numbers.Real):
        raise TypeError(f"{name} must be a number, not {type(value).__name__}")
    value = float(value)
    if not _math.isfinite(value):
        raise ValueError(f"{name} must be finite")
    return value


def _xyz(value, name):
    """A VectorLike as a 3-tuple of floats (build123d Vector accepts 2- and 3-tuples and Vectors)."""
    try:
        return tuple(float(c) for c in _loc.Vector(value))
    except (TypeError, ValueError) as exc:
        raise TypeError(f"{name} must be a VectorLike, not {type(value).__name__}") from exc


# ---------------------------------------------------------------------------
# Handles of shapes and containers

def _raw(shape):
    """The single handle stored in a shape's core slot (never a container's group)."""
    return _HANDLE.__get__(shape, type(shape))


def _handles(shape):
    """The Bend handles a shape stands for: one, none (empty container) or several (a group)."""
    members = getattr(shape, "_members", None) if type.__instancecheck__(Compound, shape) else None
    if members is not None:
        return members
    return (_raw(shape),)


def _count(handle):
    return _request("count", handle=handle)


def _solids(handle):
    return _request("solids", handle=handle)


def _boolean(left, right, operation):
    return _request("boolean", left=left, right=right, operation=operation)


def _fold(first, tools, operation):
    for tool in tools:
        first = _boolean(first, tool, operation)
    return first


def _new(cls, handles):
    """An instance of one of the shape classes on one handle, or (Compound classes) on a group."""
    shape = object.__new__(cls)
    if type.__subclasscheck__(Compound, cls):
        object.__setattr__(shape, "_children", ())
        object.__setattr__(shape, "_label", "")
        if len(handles) == 1:
            object.__setattr__(shape, "_handle", handles[0])
        else:
            object.__setattr__(shape, "_members", tuple(handles))
        return shape
    if len(handles) != 1:
        raise RuntimeError(f"{cls.__name__} needs exactly one Bend handle")
    object.__setattr__(shape, "_handle", handles[0])
    return shape


def _regroup(handles):
    """Handles for a new container of these shapes: a new handle on the same solid, or a group.

    build123d's Compound of one shape is a new shape (not is_same) holding the
    same solids. The host's ``solids`` query gives a new handle on the same
    B-rep for a one-solid shape; a shape of several solids keeps its handle.
    """
    handles = tuple(handles)
    if len(handles) != 1:
        return handles
    solids = _solids(handles[0])
    return (solids[0],) if len(solids) == 1 else handles


def _shape_list():
    """build123d.ShapeList when the query module implements it, else a list whose methods are capability errors."""
    candidate = vars(_sys.modules.get("build123d", _core)).get("ShapeList")
    if isinstance(candidate, type) and issubclass(candidate, list):
        return candidate
    return _ShapeList


class _ShapeList(list):
    """Stand-in for build123d.ShapeList until python/_b3d_query.py provides it: a list; selectors are capability errors."""

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return _unsupported(f"ShapeList.{name} is not implemented by the Python frontend")


# ---------------------------------------------------------------------------
# Classes

class _OpsMeta(_Implemented):
    """Class checks as in build123d: Box, Cylinder (BasePartObject) and plain algebra results are Parts."""

    def __instancecheck__(cls, instance):
        if type.__instancecheck__(cls, instance):
            return True
        return cls in _PART_BASES and type(instance) in _core_part_types()

    def __subclasscheck__(cls, subclass):
        if type.__subclasscheck__(cls, subclass):
            return True
        return cls in _PART_BASES and subclass in _core_part_types()


def _core_part_types():
    return (_Shape, _core.Box, _core.Cylinder)


class _Wrapped:
    """The opaque stand-in of a shape's OCP TopoDS object: only Part/Compound/Solid(...) accept it."""

    __slots__ = ("_handles",)

    def __init__(self, handles):
        self._handles = tuple(handles)

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return _unsupported(f"shape.wrapped.{name}: wrapped is an OpenCascade (OCP) TopoDS object, and external "
                            f"geometry is disabled: the Bend shim accepts it only in Part(...), Compound(...) and "
                            f"Solid(...)")

    def __eq__(self, other):
        if isinstance(other, _Wrapped):
            return self._handles == other._handles
        return NotImplemented

    def __hash__(self):
        return hash(self._handles)

    def __repr__(self):
        return f"<Bend wrapped token {', '.join(self._handles)}>"


class Solid(_Shape, metaclass=_OpsMeta):
    """build123d.Solid: one Bend solid."""

    __slots__ = ()
    order = 3.0

    def __init__(self, obj=None, label="", color=None, material="", joints=None, parent=None):
        if label != "" or color is not None or material != "" or joints is not None or parent is not None:
            _unsupported("Solid(label=, color=, material=, joints=, parent=) is not implemented by the Python "
                         "frontend")
        if not isinstance(obj, _Wrapped):
            _unsupported("Solid(...) is implemented by the Python frontend only as Solid(shape.wrapped); build solids "
                         "with Solid.make_box, Solid.make_cylinder, Solid.extrude or the algebra objects")
        if len(obj._handles) != 1 or _count(obj._handles[0]) != 1:
            _unsupported("Solid(shape.wrapped) needs a shape of exactly one solid")
        object.__setattr__(self, "_handle", obj._handles[0])

    @classmethod
    def make_box(cls, length, width, height, plane=None):
        """Solid.make_box: a box from the plane origin along +x, +y and +z of the plane."""
        plane = _loc.Plane.XY if plane is None else plane
        sizes = [_core._number(v, "Solid.make_box dimension", positive=True) for v in (length, width, height)]
        frame = _plane_frame(plane, "Solid.make_box")
        points = [[0.0, 0.0], [sizes[0], 0.0], [sizes[0], sizes[1]], [0.0, sizes[1]]]
        handle = _request("extrude_profile", profile={"kind": "polygon", "points": points}, plane=frame,
                          amount=sizes[2], both=False, dir=None)
        return _new(Solid if cls is Solid else cls, (handle,))

    @classmethod
    def make_cylinder(cls, radius, height, plane=None, angle=360):
        """Solid.make_cylinder: base circle centred on the plane origin, extruded along the plane's z."""
        plane = _loc.Plane.XY if plane is None else plane
        radius = _core._number(radius, "Solid.make_cylinder radius", positive=True)
        height = _core._number(height, "Solid.make_cylinder height", positive=True)
        if _real(angle, "Solid.make_cylinder angle") != 360:
            _unsupported("Solid.make_cylinder(angle=...) with a partial angle is not implemented by the Python "
                         "frontend: Bend has no cylinder sector primitive")
        handle = _request("extrude_profile", profile={"kind": "circle", "center": [0.0, 0.0], "radius": radius},
                          plane=_plane_frame(plane, "Solid.make_cylinder"), amount=height, both=False, dir=None)
        return _new(Solid if cls is Solid else cls, (handle,))

    @classmethod
    def extrude(cls, obj, direction):
        """Solid.extrude(face, direction): the prism of the face along the vector (its length is the depth)."""
        fragments = _faces_of(obj, "Solid.extrude", faces_only=True)
        vector = _xyz(direction, "Solid.extrude direction")
        if len(fragments) != 1:
            _unsupported("Solid.extrude is implemented by the Python frontend for one planar Face")
        fragment = fragments[0]
        length = _math.sqrt(sum(c * c for c in vector))
        handle = _request("extrude_profile", profile=fragment["profile"], plane=fragment["plane"], amount=length,
                          both=False, dir=list(vector) if length > 0 else None)
        return _new(Solid if cls is Solid else cls, (handle,))

    def __repr__(self):
        return f"<Bend Solid {_raw(self)}>"


def _plane_frame(plane, what):
    if not isinstance(plane, _loc.Plane):
        raise TypeError(f"{what} plane must be a Plane, not {type(plane).__name__}")
    return {"origin": list(plane.origin), "x": list(plane.x_dir), "normal": list(plane.z_dir)}


def _group_message(shape, what):
    return f"{what} of an empty {type(shape).__name__} is not implemented by the Python frontend: it has no Bend body"


class Compound(_Shape, metaclass=_OpsMeta):
    """build123d.Compound: one Bend handle, no body (empty) or a group of handles of separate shapes."""

    __slots__ = ("_members", "_children", "_label", "_null", "_group")
    order = 4.0

    def __init__(self, obj=None, label="", color=None, material="", joints=None, parent=None, children=None):
        _init_container(self, obj, label, color, material, joints, parent, children)

    @property
    def _handle(self):
        members = getattr(self, "_members", None)
        if members is None:
            return _raw(self)
        if not members:
            return _unsupported(_group_message(self, "Using the Bend body"))
        # A group as one shape (result, export, queries): the host's 'compound' holds all member
        # solids unfused, as build123d's TopoDS_Compound does. Booleans keep using the members.
        group = getattr(self, "_group", None)
        if group is None:
            group = _request("compound", handles=list(members))
            object.__setattr__(self, "_group", group)
        return group

    @_handle.setter
    def _handle(self, handle):
        _HANDLE.__set__(self, handle)
        object.__setattr__(self, "_members", None)

    def _wonky_identity(self):
        members = getattr(self, "_members", None)
        if members is None:
            return _raw(self)
        return ("group", id(self)) if not members else ("group",) + tuple(members)

    @property
    def children(self):
        return tuple(getattr(self, "_children", ()))

    @property
    def label(self):
        return getattr(self, "_label", "")

    @property
    def volume(self):
        members = _handles(self)
        if not members:
            return 0  # build123d: the sum over no solids
        return float(sum(_request("volume", handle=handle) for handle in members))

    def __bool__(self):
        return any(_count(handle) > 0 for handle in _handles(self))

    def __len__(self):
        return sum(_count(handle) for handle in _handles(self))

    def __iter__(self):
        members = _handles(self)
        if not members and _is_null(self):
            raise AssertionError  # build123d: iterating Compound()/Part() asserts on the missing wrapped shape
        return iter([_new(Solid, (handle,)) for member in members for handle in _solids(member)])

    def _wonky_empty_kind(self):
        """For Plane * shape (build123d lists the operand first): "null" asserts, "empty" lists as []."""
        if _handles(self):
            return None
        return "null" if _is_null(self) else "empty"

    def __copy__(self):
        copied = _new(type(self), _handles(self))
        if _is_null(self):
            object.__setattr__(copied, "_null", True)
        return copied

    def moved(self, loc):
        """Shape.moved; an empty container cannot move, a group moves member by member."""
        members = getattr(self, "_members", None)
        if members is None:
            return _loc_moved(self, loc)
        if not members:
            raise ValueError("Cannot move an empty shape")
        return _new(type(self), tuple(_raw(_loc_moved(_Shape._from_handle(m), loc)) for m in members))

    def __repr__(self):
        members = getattr(self, "_members", None)
        if members is None:
            return f"<Bend {type(self).__name__} {_raw(self)}>"
        return f"<Bend {type(self).__name__}: {len(members)} shape(s)>"


def _is_null(shape):
    """True for a container without any wrapped shape (Compound(), Part(), an empty Boolean result)."""
    return getattr(shape, "_null", False)


def _loc_moved(shape, loc):
    return _Shape.__dict__["moved"](shape, loc)


class Part(Compound):
    """build123d.Part: a Compound of solids."""

    __slots__ = ()


_PART_BASES = (Compound, Part)


def _init_container(self, obj, label, color, material, joints, parent, children):
    """Compound/Part(obj=None, label, color, material, joints, parent, children) of build123d 0.13."""
    name = type(self).__name__
    if not isinstance(label, str):
        raise TypeError(f"{name} label must be a string")
    if color is not None or material not in ("", None) or joints is not None or parent is not None:
        _unsupported(f"{name}(color=, material=, joints=, parent=) is not implemented by the Python frontend")
    object.__setattr__(self, "_label", label)
    object.__setattr__(self, "_children", ())
    if obj is not None and children is not None:
        _unsupported(f"{name}(obj, children=...) with both arguments is not implemented by the Python frontend")
    if isinstance(obj, _Wrapped):
        handles = obj._handles  # the same TopoDS shape: is_same as the shape it came from
    elif obj is not None or children is not None:
        items = obj if obj is not None else children
        if isinstance(items, _Shape) and children is None:
            items = list(items)  # a Compound is iterable: build123d collects its solids
        elif isinstance(items, (str, bytes)) or not isinstance(items, _abc.Iterable):
            return _unsupported(f"{name}(...) takes shape.wrapped or an iterable of Bend shapes in the Python "
                                f"frontend, not {type(items).__name__}")
        items = list(items)
        for item in items:
            if not isinstance(item, _Shape):
                return _unsupported(f"{name}(...) items must be Bend shapes (Part, Solid, Box, ...), not "
                                    f"{type(item).__name__}: 2D and OCP objects cannot be grouped in the Python "
                                    f"frontend")
        handles = _regroup(handle for item in items for handle in _handles(item))
        if children is not None:
            object.__setattr__(self, "_children", tuple(items))
    else:
        handles = ()
        object.__setattr__(self, "_null", True)  # build123d: no wrapped TopoDS shape at all
    if len(handles) == 1:
        object.__setattr__(self, "_handle", handles[0])
    else:
        object.__setattr__(self, "_members", tuple(handles))


# ---------------------------------------------------------------------------
# Result classes (build123d 0.13 _bool_op / Part operators, see test/python-ops.test.mjs)

def _kind(shape):
    if isinstance(shape, Solid):
        return "solid"
    members = _handles(shape)
    if len(members) > 1 or (len(members) == 1 and _count(members[0]) > 1):
        return "multi"
    return "part"


def _result(left_kind, operation, handles, tool_kinds):
    """The build123d class of a Boolean result on these handles, or None (an empty Solid intersection).

    ``operation`` is "fuse"/"cut" for the Shape methods or the host operation
    name for the operators; ``left_kind``/``tool_kinds`` are _kind() values.
    """
    handles = tuple(handles)
    count = sum(_count(h) for h in handles)
    multi_tool = "multi" in tool_kinds
    solid_tool = "solid" in tool_kinds
    if operation == "fuse":
        if left_kind == "multi" or multi_tool:
            cls = Compound
        elif count == 1:
            cls = Solid
        else:
            cls = Part if left_kind == "solid" and all(k == "solid" for k in tool_kinds) else Compound
    elif operation == "cut":
        cls = Compound if left_kind == "multi" or len(handles) != 1 or count != 1 else Solid
    elif operation == "UNION":
        if left_kind == "multi":
            cls = Compound
        elif left_kind == "solid":
            cls = Solid if count == 1 and not multi_tool else Part
        else:
            cls = Part if count == 1 and not multi_tool else Compound
    elif operation == "SUBTRACTION":
        cls = {"multi": Compound, "solid": Solid}.get(left_kind, Part)
    else:  # INTERSECTION operator
        if left_kind == "solid":
            if count == 0:
                return None
            cls = Solid if count == 1 else Compound
        elif count == 1 and not solid_tool:
            cls = Part
        else:
            cls = Compound
    if cls is Solid and (len(handles) != 1 or count != 1):
        cls = Compound
    return _new(cls, handles)


# ---------------------------------------------------------------------------
# Booleans

def _operands(self, other, verb):
    """build123d's operator operands: None, a Shape or an iterable of them; 2D/1D objects fail on dimensions."""
    if other is None:
        return []
    items = [other] if isinstance(other, _Shape) else other
    if _profile_dim(items) is not None:
        items = [items]
    try:
        items = list(items)
    except TypeError:
        return _unsupported("Algebra Boolean operands must be Bend Shape objects")
    shapes = []
    for item in items:
        if item is None:
            continue
        if isinstance(item, _Shape):
            shapes.append(item)
            continue
        dim = _profile_dim(item)
        if dim is not None and verb == "+":
            raise ValueError("Only shapes with the same dimension can be added")
        if dim is not None and verb == "-":
            raise ValueError(f"Only shapes with equal or greater dimension can be subtracted: not "
                             f"{type(self).__name__} (3D) and {type(other).__name__} ({dim}D)")
        if dim is not None:
            return _unsupported("Intersecting a 3D shape with a 2D/1D object is not implemented by the Python "
                                "frontend: Bend has no solid/face section operation")
        return _unsupported("Algebra Boolean operands must be Bend Shape objects")
    return shapes


def _operator(self, other, operation):
    """The + - & operators of build123d 0.13 (Shape.__add__/__sub__/__and__ and Part's)."""
    if operation == "UNION":
        return _add(self, other)
    if operation == "SUBTRACTION":
        return _subtract(self, other)
    if operation == "INTERSECTION":
        return _and(self, other)
    return _unsupported("Unknown algebra Boolean operation")


def _add(self, other):
    if type.__instancecheck__(Compound, self) and not type.__instancecheck__(Part, self) and _is_null(self):
        raise AssertionError  # build123d: Compound._dim reads the missing wrapped shape first
    tools = _operands(self, other, "+")
    tool_handles = [h for tool in tools for h in _handles(tool)]
    if not tool_handles:
        return self  # nothing to add: build123d returns the original object
    kinds = [_kind(tool) for tool in tools if _handles(tool)]
    members = _handles(self)
    if not members:
        # Part() + x: x's solids; one of them is x's solid in a new Part, several are fused.
        solids = [s for h in tool_handles for s in _solids(h)]
        if not solids:
            return self
        if len(solids) == 1:
            return _new(Part, (solids[0],))
        return _result("solid", "fuse", (_fold(solids[0], solids[1:], "UNION"),), ["solid"] * (len(solids) - 1))
    left = _kind(self)
    handle = _fold(members[0], list(members[1:]) + tool_handles, "UNION")
    return _result(left, "UNION", (handle,), kinds)


def _subtract(self, other):
    members = _handles(self)
    if not members:
        raise ValueError("Cannot subtract shape from empty compound")
    tools = _operands(self, other, "-")
    tool_handles = [h for tool in tools for h in _handles(tool)]
    if not tool_handles:
        return self
    left = _kind(self)
    results = tuple(_fold(member, tool_handles, "SUBTRACTION") for member in members)
    return _result(left, "SUBTRACTION", results, [_kind(tool) for tool in tools])


def _and(self, other):
    others = other if isinstance(other, (list, tuple)) else [other]
    if not self or (isinstance(other, _Shape) and not other):
        raise ValueError("Cannot intersect shape with empty compound")
    shapes = _operands(self, list(others), "&")
    pieces = _intersection_chain(_handles(self), shapes)
    if pieces is None:
        if isinstance(self, Solid):
            return None
        empty = _new(Compound, ())
        object.__setattr__(empty, "_null", True)  # build123d: an empty result has no wrapped shape
        return empty
    return _result(_kind(self), "INTERSECTION", pieces, [_kind(s) for s in shapes])


def _intersection_chain(members, others):
    """build123d intersect(): AND over the arguments, OR over a compound argument's members; None if empty."""
    current = list(members)
    for other in others:
        following = []
        for handle in current:
            for tool in _handles(other):
                result = _boolean(handle, tool, "INTERSECTION")
                if _count(result) > 0:
                    following.append(result)
        if not following:
            return None
        current = following
    return current


def _fuse(self, *to_fuse, glue=False, tol=None):
    """Shape.fuse: the union of this shape and the arguments."""
    if glue or tol:
        _unsupported("Shape.fuse(glue=, tol=) is not implemented by the Python frontend (no fuzzy/glue Boolean in "
                     "Bend)")
    for tool in to_fuse:
        if not isinstance(tool, _Shape):
            return _unsupported("Shape.fuse arguments must be Bend shapes")
    tool_handles = [h for tool in to_fuse for h in _handles(tool)]
    members = list(_handles(self))
    handles = members + tool_handles
    if not handles:
        return self
    kinds = [_kind(tool) for tool in to_fuse if _handles(tool)]
    handle = _fold(handles[0], handles[1:], "UNION") if len(handles) > 1 else handles[0]
    if len(handles) == 1:
        handle = _regroup((handle,))[0]
    return _result(_kind(self) if members else "solid", "fuse", (handle,), kinds)


def _cut(self, *to_cut):
    """Shape.cut: this shape minus the arguments (member by member for a group)."""
    for tool in to_cut:
        if not isinstance(tool, _Shape):
            return _unsupported("Shape.cut arguments must be Bend shapes")
    members = _handles(self)
    if not members:
        return self
    tool_handles = [h for tool in to_cut for h in _handles(tool)]
    if not tool_handles:
        results = _regroup(members) if len(members) == 1 else members
    else:
        results = tuple(_fold(member, tool_handles, "SUBTRACTION") for member in members)
    return _result(_kind(self), "cut", results, [_kind(tool) for tool in to_cut])


def _intersect(self, *to_intersect, tolerance=1e-6, include_touched=False):
    """Shape.intersect: a ShapeList of the Solids where all arguments overlap, or None."""
    if not to_intersect:
        return None
    if include_touched:
        _unsupported("Shape.intersect(include_touched=True) is not implemented by the Python frontend: Bend has no "
                     "boundary-contact query")
    if tolerance != 1e-6:
        _unsupported("Shape.intersect(tolerance=...) is not implemented by the Python frontend: Bend Booleans have "
                     "no fuzzy tolerance")
    for other in to_intersect:
        if isinstance(other, (_loc.Vector, _loc.Location, _loc.Axis, _loc.Plane)):
            return _unsupported(f"Shape.intersect with a {type(other).__name__} is not implemented by the Python "
                                f"frontend: Bend has no section/containment query")
        if not isinstance(other, _Shape):
            raise ValueError(f"Unsupported type for intersect: {type(other)}")
    members = _handles(self)
    if not members:
        return None
    pieces = _intersection_chain(members, to_intersect)
    if pieces is None:
        return None
    return _shape_list()(_new(Solid, (handle,)) for piece in pieces for handle in _solids(piece))


# ---------------------------------------------------------------------------
# Placement

def _rotate(self, axis, angle, transform=False):
    """Shape.rotate: moved by a rotation of ``angle`` degrees about ``axis`` (a new location)."""
    if transform:
        return _unsupported("Shape.rotate(transform=True) regenerates the B-rep, which is not implemented by the "
                            "Python frontend; use the default transform=False")
    if not isinstance(axis, _loc.Axis):
        raise AttributeError(f"'{type(axis).__name__}' object has no attribute 'wrapped'")
    if not _handles(self):
        return self
    angle = _real(angle, "rotate angle")
    trsf = _loc._rotation_about(axis._position, axis._direction, angle * (_math.pi / 180))
    return self.moved(_loc.Location._of(_loc._single(trsf)))


def _translate(self, vector, transform=False):
    """Shape.translate: moved by a translation (a new location)."""
    if transform:
        return _unsupported("Shape.translate(transform=True) regenerates the B-rep, which is not implemented by the "
                            "Python frontend; use the default transform=False")
    offset = _xyz(vector, "translate vector")
    if not _handles(self):
        return self
    return self.moved(_loc.Location._of(_loc._single(_loc._with_translation(_loc._IDENTITY_TRSF, offset))))


def _wrapped(self):
    """Shape.wrapped: an opaque token of this shape (build123d asserts on an empty shape)."""
    handles = _handles(self)
    assert handles
    return _Wrapped(handles)


# ---------------------------------------------------------------------------
# extrude and Cone

def _faces_of(obj, what, faces_only=False):
    """extrude_profile fragments of a Face, a Sketch (its faces) or a list of Faces."""
    kinds = _sketch_types()
    face_type = next((k for k in kinds if k.__name__ == "Face"), None)
    if isinstance(obj, (tuple, list, filter)):
        items = [*obj]
        if face_type is None or not all(isinstance(item, face_type) for item in items):
            return _unsupported(f"{what} of a list is implemented by the Python frontend only for Face objects")
        return [fragment for item in items for fragment in item._wonky_faces()]
    if faces_only:
        if face_type is None or not isinstance(obj, face_type):
            return _unsupported(f"{what} is implemented by the Python frontend only for a planar Face "
                                f"(Face(wire)), not {type(obj).__name__}")
        return obj._wonky_faces()
    if kinds and isinstance(obj, kinds[:2]):
        return obj._wonky_faces()
    return _unsupported(f"{what} of a {type(obj).__name__} is not implemented by the Python frontend: pass a "
                        f"Sketch or Face (Circle, Rectangle, RectangleRounded, Polygon, make_face(...), ...)")


def extrude(to_extrude=None, amount=None, dir=None, until=None, target=None, both=False, taper=0.0, clean=True,
            mode=None):
    """build123d.extrude in algebra mode: a Part holding the prism of the face (no BuildPart context)."""
    if to_extrude is None:
        raise ValueError("A face or sketch must be provided")
    if until is not None:
        _unsupported("extrude(until=...) is not implemented by the Python frontend: Bend has no 'extrude until' "
                     "operation (a prism bounded by a target's faces)")
    if target is not None:
        _unsupported("extrude(target=...) is not implemented by the Python frontend: it only bounds 'extrude until', "
                     "which Bend does not have")
    if _real(taper, "extrude taper") != 0:
        _unsupported("extrude(taper=...) is not implemented by the Python frontend: Bend has no 'tapered "
                     "extrusion' operation (drafted side faces)")
    if mode is not None and not isinstance(mode, _core.Mode):
        raise TypeError(f"extrude mode must be a Mode, not {type(mode).__name__}")
    fragments = _faces_of(to_extrude, "extrude")
    if not fragments:
        return _new(Part, ())  # build123d: no faces, an empty Part
    if len(fragments) > 1:
        _unsupported("extrude of several faces at once is not implemented by the Python frontend; extrude each face")
    if amount is None:
        raise ValueError("Either amount or until must be provided")
    amount = _real(amount, "extrude amount")
    direction = None if dir is None else list(_xyz(dir, "extrude dir"))
    fragment = fragments[0]
    handle = _request("extrude_profile", profile=fragment["profile"], plane=fragment["plane"], amount=amount,
                      both=bool(both), dir=direction)
    return _new(Part, (handle,))


def _align_names(align):
    """Cone alignment per axis as the host's MIN/CENTER/MAX; None keeps the cone's own frame (x/y centred, z MIN)."""
    if align is None or isinstance(align, _core.Align):
        align = (align,) * 3
    if not isinstance(align, (tuple, list)) or len(align) != 3:
        raise TypeError("align must be an Align or a tuple of three Align values")
    names = []
    for axis, value in enumerate(align):
        if value is None or value is _core.Align.NONE:
            names.append("MIN" if axis == 2 else "CENTER")
        elif isinstance(value, _core.Align):
            names.append(value.name)
        else:
            raise TypeError(f"align values must be Align members, not {type(value).__name__}")
    return names


class Cone(Part):
    """build123d.Cone(bottom_radius, top_radius, height, arc_size, rotation, align, mode): a Bend frustum."""

    __slots__ = ("bottom_radius", "top_radius", "cone_height", "arc_size", "align", "rotation")

    def __init__(self, bottom_radius, top_radius, height, arc_size=360, rotation=(0, 0, 0),
                 align=(_core.Align.CENTER, _core.Align.CENTER, _core.Align.CENTER), mode=None):
        if mode is not None and mode is not _mode_add():
            _unsupported("Primitive mode supports only Mode.ADD; use Algebra operators for Booleans")
        r0, r1 = _real(bottom_radius, "Cone bottom_radius"), _real(top_radius, "Cone top_radius")
        h = _real(height, "Cone height")
        if _real(arc_size, "Cone arc_size") != 360:
            _unsupported("Cone(arc_size=...) with a partial arc is not implemented by the Python frontend: Bend has "
                         "no cone sector primitive")
        names = _align_names(align)
        rotate = rotation if isinstance(rotation, _loc.Rotation) else _loc.Rotation(*_rotation_tuple(rotation))
        handle = _request("frustum", r0=r0, r1=r1, height=h, align=names)
        _init_container(self, None, "", None, "", None, None, None)
        object.__setattr__(self, "_handle", handle)
        if rotate._trsf().m != _loc._IDENTITY_MATRIX:
            object.__setattr__(self, "_handle", _raw(self.moved(rotate)))
        for name, value in (("bottom_radius", bottom_radius), ("top_radius", top_radius), ("cone_height", height),
                            ("arc_size", arc_size), ("align", align), ("rotation", rotate)):
            object.__setattr__(self, name, value)


def _rotation_tuple(rotation):
    values = tuple(rotation)
    if len(values) != 3:
        raise TypeError("rotation must be three Euler angles or a Rotation")
    return tuple(_real(v, "rotation") for v in values)


# ---------------------------------------------------------------------------
# Registration

for _name, _value in (("fuse", _fuse), ("cut", _cut), ("intersect", _intersect), ("rotate", _rotate),
                      ("translate", _translate), ("wrapped", property(_wrapped))):
    _core.register_shape_method(_name, _value)
del _name, _value

_core._HOOKS["boolean"] = _operator
_core._HOOKS["solid"] = lambda handle: _new(Solid, (handle,))

BUILD123D = {
    "extrude": extrude,
    "Solid": Solid,
    "Compound": Compound,
    "Part": Part,
    "Cone": Cone,
}
