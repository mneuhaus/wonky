"""Core of the Bend build123d shim: the host bridge, Shape, Box, Cylinder, enums and exports.

Loaded by path from python/build123d.py (the loader), before the other private
modules (``_b3d_location``, ``_b3d_sketch``, ...). Files starting with ``_``
are not importable by models, and frames in this directory count as shim
frames for use-site locations.

The runner sets ``_channel`` and ``_source_filename`` on the ``build123d``
module; the bridge helpers here read them from there at call time, and the
loader re-exports the helpers (``build123d._unsupported``, ``_request``,
``_locate``, ``_display``, ``UnsupportedFeatureError``) for the runner, the
runtime and cad_khana.

Other modules extend ``Shape`` through ``register_shape_method(name, value)``
(a function, property or other descriptor) instead of editing this file, and
publish their names through ``BUILD123D`` / ``CLASS_ATTRIBUTES`` dictionaries
that the loader binds.
"""

import enum as _enum
import inspect as _inspect
import itertools as _itertools
import linecache as _linecache
import math as _math
import os as _os
import sys as _sys

_SHIM_DIR = _os.path.dirname(_os.path.abspath(__file__))
_STDLIB_DIR = _os.path.dirname(_os.path.abspath(_os.__file__))


def _shim():
    module = _sys.modules.get("build123d")
    if module is None:
        raise RuntimeError("Use this build123d shim through bin/wonky-python.mjs")
    return module


def _bridge():
    return getattr(_sys.modules.get("build123d"), "_channel", None)


def _source():
    return getattr(_sys.modules.get("build123d"), "_source_filename", None)


def _version():
    return getattr(_sys.modules.get("build123d"), "__version__", "0.13.0")


class UnsupportedFeatureError(RuntimeError):
    """A missing capability, also latched independently by the host process."""


def _is_model_file(filename):
    """Model code: the executed source and project modules, not the shim or the standard library."""
    if filename == _source():
        return True
    if filename.startswith("<frozen"):
        return False
    if filename.startswith("<"):
        return True
    path = _os.path.abspath(filename)
    if path.startswith(_SHIM_DIR + _os.sep):
        return False
    return not (path.startswith(_STDLIB_DIR + _os.sep) and "-packages" not in path)


def _position(frame):
    """{file, line, column} of the instruction a frame is executing; column is 1-based, None before 3.11."""
    filename, line, column = frame.f_code.co_filename, frame.f_lineno, None
    positions = getattr(frame.f_code, "co_positions", None)
    if positions is not None and frame.f_lasti >= 0:
        start = next(_itertools.islice(positions(), frame.f_lasti // 2, None), None)
        if start is not None and start[0] is not None and start[2] is not None:
            line, offset = start[0], start[2]
            text = _linecache.getline(filename, line) if not filename.startswith("<") else ""
            # co_positions counts UTF-8 bytes; report characters.
            column = (len(text.encode("utf-8")[:offset].decode("utf-8", "ignore")) if text else offset) + 1
    return {"file": filename, "line": line, "column": column}


def _locate(frame):
    """Source location of a bridge request: the executed file's innermost frame, its stack and the use site.

    ``location`` is the innermost frame of the executed source (what the source
    map and the host error line refer to). When the construct was used inside a
    project module, ``location["use"]`` names that innermost model frame too.
    """
    source = _source()
    location = use = None
    call_stack = []
    try:
        while frame is not None:
            filename = frame.f_code.co_filename
            if use is None and _is_model_file(filename):
                use = _position(frame)
            if filename == source:
                position = _position(frame) if location is None else {"file": filename, "line": frame.f_lineno}
                if location is None:
                    location = position
                call_stack.append({"name": frame.f_code.co_name, "calledAt": position,
                                   "declaration": {"line": frame.f_code.co_firstlineno}})
            frame = frame.f_back
    finally:
        del frame
    if location is not None and use is not None and use["file"] != location["file"]:
        location["use"] = use
    return location, use, list(reversed(call_stack))


def _request(op, **arguments):
    channel = _bridge()
    if channel is None:
        raise RuntimeError("Use this build123d shim through bin/wonky-python.mjs")
    location, _, call_stack = _locate(_inspect.currentframe().f_back)
    return channel.request(op, location=location, callStack=call_stack, **arguments)


def _display(filename):
    source = _source()
    if source and not filename.startswith("<") and not source.startswith("<"):
        try:  # relative to the executed file, e.g. helpers.py or ../shared/family.py
            return _os.path.relpath(_os.path.realpath(filename), _os.path.dirname(_os.path.realpath(source)))
        except ValueError:  # another drive
            pass
    return filename


def _unsupported(message):
    # The host records this before replying. Catching the Python exception
    # cannot allow an incomplete/unsupported model to become a successful run.
    channel = _bridge()
    if channel is None:
        raise RuntimeError(f"Use this build123d shim through bin/wonky-python.mjs ({message})")
    location, use, call_stack = _locate(_inspect.currentframe().f_back)
    if use is not None and (location is None or "use" in location):
        # The construct is used in a project module: name that file, not only the executed source's line.
        message += f" (at {_display(use['file'])}:{use['line']}{':' + str(use['column']) if use['column'] else ''})"
    return channel.request("unsupported", message=message, location=location, callStack=call_stack)


class _EnumType(_enum.EnumMeta):
    def __getattr__(cls, name):
        # Every member of build123d 0.13.0 is frozen here, so a missing one does
        # not exist in build123d either: an ordinary AttributeError, as there.
        if name.startswith("_"):
            raise AttributeError(name)
        raise AttributeError(f"type object {cls.__name__!r} has no attribute {name!r} "
                             f"({cls.__name__} has no member {name!r} in build123d {_version()})")


class _Enum(_enum.Enum, metaclass=_EnumType):
    """Base of the frozen build123d enums: members are plain values, like build123d 0.13.0's."""


class _Implemented(type):
    """Metaclass of the implemented classes (Shape, Box, Cylinder, Location, Plane, ...).

    build123d's classes carry many more class attributes (``Solid.make_box``,
    ``Shape.cast``, ``Location`` helpers). Reading one that the shim does not
    implement is a capability error at its use site, like on a sentinel, not
    an AttributeError that would look like a model bug.
    """

    def __getattr__(cls, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return _unsupported(f"{cls.__name__}.{name} is not implemented by the Python frontend")


class Align(_Enum):
    MIN = 1
    CENTER = 2
    MAX = 3
    NONE = None


class Mode(_Enum):
    ADD = 1
    SUBTRACT = 2
    INTERSECT = 3
    REPLACE = 4
    PRIVATE = 5


def _number(value, name, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    value = float(value)
    if not _math.isfinite(value) or (positive and value <= 0):
        raise ValueError(f"{name} must be a finite {'positive ' if positive else ''}number")
    return value


def _alignment(value):
    if isinstance(value, Align):
        value = (value,) * 3
    if not isinstance(value, (tuple, list)) or len(value) != 3 or not all(
            isinstance(a, Align) and a is not Align.NONE for a in value):
        return _unsupported("align requires Align.MIN, Align.CENTER or Align.MAX, or a three-axis tuple of these")
    return [a.name for a in value]


def _options(rotation, mode, kwargs):
    if kwargs:
        return _unsupported(f"Unsupported primitive argument(s): {', '.join(sorted(kwargs))}")
    if not isinstance(rotation, (tuple, list)) or len(rotation) != 3 or any(_number(v, "rotation") != 0 for v in rotation):
        return _unsupported("Nonzero rotations are not implemented by the Python frontend")
    if mode is not Mode.ADD:
        return _unsupported("Primitive mode supports only Mode.ADD; use Algebra operators for Booleans")


# Hooks other modules install: _b3d_location's "apply_location_like" (`locations * shape`),
# _b3d_ops's "boolean" (the + - & operators) and "solid" (the class of iterated solids).
_HOOKS = {}


class Shape(metaclass=_Implemented):
    __slots__ = ("_handle",)

    def __init__(self, *args, **kwargs):
        _unsupported("Direct Shape construction is not implemented")

    @staticmethod
    def _from_handle(handle):
        shape = object.__new__(Shape)
        object.__setattr__(shape, "_handle", handle)
        return shape

    @property
    def volume(self):
        """Volume in mm³, measured from the already built Bend B-rep."""
        return float(_request("volume", handle=self._handle))  # JSON turns 6.0 into 6; build123d gives a float

    def _boolean(self, other, operation):
        # _b3d_ops installs build123d's full operator semantics (None/list/empty operands, result classes).
        boolean = _HOOKS.get("boolean")
        if boolean is not None:
            return boolean(self, other, operation)
        if not isinstance(other, Shape):
            return _unsupported("Algebra Boolean operands must be Bend Shape objects")
        return Shape._from_handle(_request("boolean", left=self._handle, right=other._handle, operation=operation))

    def _wonky_identity(self):
        """What is_same compares: the handle (containers without one handle override this)."""
        return self._handle

    def __add__(self, other):
        return self._boolean(other, "UNION")

    def __sub__(self, other):
        return self._boolean(other, "SUBTRACTION")

    def __and__(self, other):
        return self._boolean(other, "INTERSECTION")

    # The rest of build123d 0.13's Shape/Compound protocol (Box and every
    # Algebra result is a Part, a Compound of solids). Python looks these
    # dunders up on the type, never through __getattr__, so each one is either
    # build123d's behavior or an explicit capability error.
    def __bool__(self):
        """Compound.__bool__: False for an empty result, e.g. the intersection of disjoint solids."""
        return _request("count", handle=self._handle) > 0

    def __len__(self):
        """Compound.__len__: the number of solids."""
        return _request("count", handle=self._handle)

    def __iter__(self):
        """Compound.__iter__: one Shape per solid (a Solid once _b3d_ops is loaded), sharing that solid's B-rep."""
        solid = _HOOKS.get("solid", Shape._from_handle)
        return iter([solid(handle) for handle in _request("solids", handle=self._handle)])

    def __eq__(self, other):
        """Shape.__eq__ is is_same(): the same B-rep at the same location, never equal geometry."""
        if isinstance(other, Shape):
            return self._wonky_identity() == other._wonky_identity()
        return NotImplemented

    def __hash__(self):
        return hash(self._wonky_identity())

    def __copy__(self):
        """Shape.__copy__: a new reference to the same B-rep (equal to the original)."""
        return Shape._from_handle(self._handle)

    def __deepcopy__(self, memo):
        return _unsupported("copy.deepcopy() of a Shape is not implemented by the Python frontend")

    def __iadd__(self, other):
        """Part.__iadd__ is ``self + other``: a new shape, other references keep the old one."""
        return self._boolean(other, "UNION")

    def __rmul__(self, other):
        """``location * shape`` / ``[locations] * shape``: build123d's apply_location_like (in _b3d_location)."""
        apply = _HOOKS.get("apply_location_like")
        if apply is not None:
            return apply(self, other)
        raise TypeError(f"{type(self).__name__} cannot be multiplied by {type(other).__name__}")

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return _unsupported(f"Shape.{name} is not implemented by the Python frontend")

    def __setattr__(self, name, value):
        _unsupported(f"Shape attribute assignment '{name}' is not implemented; shapes are immutable")

    def __repr__(self):
        return f"<Bend Shape {self._handle}>"


def register_shape_method(name, value):
    """Add a build123d Shape method or property implemented by another shim module.

    Each name has one owner: registering a name that Shape already has (from
    this file or from another module) is a programming error, not an override.
    """
    if name in vars(Shape):
        raise RuntimeError(f"Shape.{name} is already implemented; one module owns each Shape attribute")
    setattr(Shape, name, value)
    return value


class Box(Shape):
    __slots__ = ()

    def __init__(self, length, width, height, rotation=(0, 0, 0),
                 align=(Align.CENTER, Align.CENTER, Align.CENTER), mode=Mode.ADD, **kwargs):
        _options(rotation, mode, kwargs)
        dimensions = [_number(v, "Box dimension", positive=True) for v in (length, width, height)]
        object.__setattr__(self, "_handle", _request("box", dimensions=dimensions, align=_alignment(align)))


class Cylinder(Shape):
    __slots__ = ()

    def __init__(self, radius, height, arc_size=360, rotation=(0, 0, 0),
                 align=(Align.CENTER, Align.CENTER, Align.CENTER), mode=Mode.ADD, **kwargs):
        _options(rotation, mode, kwargs)
        if _number(arc_size, "arc_size") != 360:
            _unsupported("Cylinder supports only a full 360-degree arc")
        object.__setattr__(self, "_handle", _request("cylinder", radius=_number(radius, "Cylinder radius", positive=True),
                                                    height=_number(height, "Cylinder height", positive=True), align=_alignment(align)))


def _format_vector(values, spec):
    """build123d 0.13 Vector.__format__ for an 'f' or 'g' spec: |v| <= TOLERANCE prints as 0."""
    precision = int(spec[:-1].split(".")[-1]) if "." in spec else (6 if spec[-1] == "f" else 12)
    trimmed = (round(float(value), precision) if abs(value) > 1e-6 else 0.0 for value in values)
    return "(" + ", ".join(f"{value:{spec}}" for value in trimmed) + ")"


# Exports are model outputs (result contract, rule c). The runner's
# _wonky_runtime records them with their names and locations, and the host
# writes each file at the call, from the Bend B-rep, at the path Python
# resolves (docs/python-frontend.md, "Exports").
def _runtime():
    runtime = _sys.modules.get("_wonky_runtime")
    if runtime is None:
        raise RuntimeError("export capture needs the runner's _wonky_runtime; use bin/wonky-python.mjs")
    return runtime


def export_step(to_export, file_path, unit=None, write_pcurves=True, precision_mode=None, *, timestamp=None):
    """build123d.export_step: writes the STEP now and records a named model output; non-default options are listed, not applied."""
    options = {key: value for key, value, default in (
        ("unit", unit, None), ("write_pcurves", write_pcurves, True), ("precision_mode", precision_mode, None),
        ("timestamp", timestamp, None)) if value is not default}
    if options.get("unit") is _shim().Unit.MM:
        del options["unit"]  # wonky writes millimeters, build123d's default
    return _runtime().export_step(to_export, file_path, **options)


def export_stl(to_export, file_path, tolerance=0.001, angular_tolerance=0.1, ascii_format=False):
    """build123d.export_stl: writes the STL now (tolerance and ascii_format applied, angular_tolerance listed) and records a named output."""
    options = {key: value for key, value, default in (
        ("tolerance", tolerance, 0.001), ("angular_tolerance", angular_tolerance, 0.1),
        ("ascii_format", ascii_format, False)) if value != default}
    return _runtime().export_stl(to_export, file_path, **options)


# Module attributes of build123d that are not build123d names: the bridge for
# the runner, _wonky_runtime and cad_khana.
SHIM_ATTRIBUTES = {
    "UnsupportedFeatureError": UnsupportedFeatureError,
    "_is_model_file": _is_model_file,
    "_position": _position,
    "_locate": _locate,
    "_request": _request,
    "_display": _display,
    "_unsupported": _unsupported,
    "_Implemented": _Implemented,
    "_Enum": _Enum,
    "_EnumType": _EnumType,
    "_number": _number,
    "_alignment": _alignment,
    "_options": _options,
    "_format_vector": _format_vector,
}

BUILD123D = {
    "Align": Align,
    "Mode": Mode,
    "Shape": Shape,
    "Box": Box,
    "Cylinder": Cylinder,
    "export_step": export_step,
    "export_stl": export_stl,
}
