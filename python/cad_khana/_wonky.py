"""Shared helpers of wonky's cad_khana compatibility package.

Everything here works on B-reps that the Bend build123d shim already built.
No OpenCascade, OCP or installed cad_khana code is imported. Diagnostics that
need geometry analysis wonky does not have raise an UnsupportedFeatureError at
the call, through the shim's host-latched capability request. check() and
inspect() can instead be recorded as not run (bin/wonky-python.mjs
--khana-checks=skip); their result then refuses every use.
"""

import math as _math
import os as _os
import sys as _sys

POLICY = "docs/python-khana.md"
SCOPE = ("wonky's cad_khana provides the modeling API only (Assembly, with_part, "
         "with_subassembly, part names, colors and materials)")


def build123d():
    """The Bend build123d shim module that the runner loaded."""
    module = _sys.modules.get("build123d")
    if module is None or not callable(getattr(module, "_unsupported", None)):
        raise RuntimeError("wonky's cad_khana needs the Bend build123d shim; run the model with bin/wonky-python.mjs")
    return module


def unsupported(message):
    """Raise a capability error; the host latches it before Python sees it."""
    return build123d()._unsupported(message)


def _refusal(qualname, what):
    return (f"{qualname} is a cad_khana diagnostic that wonky does not provide: {what}. "
            f"{SCOPE}; see {POLICY}")


def refused_call(qualname, what):
    """A public cad_khana function that fails as a capability at its call site."""
    name = qualname.rsplit(".", 1)[-1]

    def refused(*args, **kwargs):
        return unsupported(_refusal(f"{qualname}()", what))

    refused.__name__ = refused.__qualname__ = name
    refused.__module__ = qualname.rsplit(".", 1)[0]
    refused.__doc__ = f"Not provided by wonky: {what}."
    return refused


def _runtime():
    runtime = _sys.modules.get("_wonky_runtime")
    if runtime is None:
        raise RuntimeError("wonky's cad_khana needs the runner's _wonky_runtime; run the model with bin/wonky-python.mjs")
    return runtime


class NotRun:
    """The result of a cad_khana check that was not run (--khana-checks=skip).

    It never stands in for a result: reading any attribute, truth value,
    comparison, length or item is a capability error at that use, so a model
    cannot branch on a check that did not happen. str()/repr() name it. The
    entry it holds is a copy of the host's record; the record in brep.json is
    the host's own.
    """

    __slots__ = ("_wonky_entry",)

    def __init__(self, entry):
        object.__setattr__(self, "_wonky_entry", entry)

    def _refuse(self, use):
        entry = object.__getattribute__(self, "_wonky_entry")
        location = entry.get("location") or {}
        where = f" at line {location['line']}" if location.get("line") else ""
        return unsupported(f"{entry['call']}() was not run (--khana-checks=skip{where}): its result {use} is not "
                           f"available, and wonky never reports a skipped check as passed; see {POLICY}")

    def __getattr__(self, name):
        return self._refuse(f"attribute '{name}'")

    def __setattr__(self, name, value):
        self._refuse(f"attribute '{name}'")

    def __bool__(self):
        return self._refuse("truth value")

    def __eq__(self, other):
        return self._refuse("comparison")

    def __ne__(self, other):
        return self._refuse("comparison")

    __hash__ = object.__hash__

    def __len__(self):
        return self._refuse("length")

    def __iter__(self):
        return self._refuse("iteration")

    def __getitem__(self, key):
        return self._refuse(f"item {key!r}")

    def __repr__(self):
        entry = object.__getattribute__(self, "_wonky_entry")
        return f"<{entry['call']}() not run: no wonky equivalent yet>"

    __str__ = __repr__


def checked_call(qualname, what):
    """cad_khana check()/inspect(): refused at the call by default (decision 12);
    under --khana-checks=skip the host records the call as not run and it returns NotRun.
    The host decides at every call (src/python.mjs); nothing here holds the mode."""
    name = qualname.rsplit(".", 1)[-1]

    def checked(*args, **kwargs):
        return NotRun(_runtime().khana_check(qualname, what, args, kwargs, _sys._getframe(1)))

    checked.__name__ = checked.__qualname__ = name
    checked.__module__ = qualname.rsplit(".", 1)[0]
    checked.__doc__ = f"Not provided by wonky: {what}. Refused, or recorded as not run with --khana-checks=skip."
    return checked


def refused_type(qualname, what):
    """A cad_khana result type; importable for annotations, fails when constructed."""
    name = qualname.rsplit(".", 1)[-1]

    def __new__(cls, *args, **kwargs):
        return unsupported(_refusal(f"{qualname}()", what))

    return type(name, (), {"__new__": __new__, "__module__": qualname.rsplit(".", 1)[0],
                           "__qualname__": name, "__doc__": f"Not provided by wonky: {what}."})


def module_getattr(module_name, package_file=None):
    """Module __getattr__: names the real cad_khana module may have fail at use.

    For a package (pass its __file__), names of provided submodules raise
    AttributeError, so `from cad_khana import draw` imports the submodule.
    """
    directory = _os.path.dirname(package_file) if package_file else None

    def __getattr__(name):
        if name.startswith("_"):
            raise AttributeError(name)
        if directory and (_os.path.isfile(_os.path.join(directory, name + ".py"))
                          or _os.path.isfile(_os.path.join(directory, name, "__init__.py"))):
            raise AttributeError(name)
        return unsupported(f"{module_name}.{name} is not part of the cad_khana API that wonky provides. "
                           f"{SCOPE}; see {POLICY}")
    return __getattr__


def appearance(color, where):
    """Appearance record of a build123d Color or an (r, g, b[, a]) tuple.

    build123d 0.13 colors iterate as sRGB (red, green, blue, alpha) floats in
    0..1 (older releases expose to_tuple()). The record keeps those values
    unchanged; the viewer reads {red, green, blue} in 0..1 and alpha as opacity.
    """
    if color is None:
        return None
    try:
        if isinstance(color, (str, bytes)):
            channels = None
        elif callable(getattr(type(color), "to_tuple", None)):
            channels = tuple(color.to_tuple())
        else:
            channels = tuple(color)
    except TypeError:
        channels = None
    if (channels is None or len(channels) not in (3, 4)
            or any(isinstance(c, bool) or not isinstance(c, (int, float)) for c in channels)):
        raise TypeError(f"{where}: color must be a build123d Color or an (r, g, b[, a]) tuple "
                        f"of numbers in 0..1, not {type(color).__name__}")
    channels = tuple(float(c) for c in channels) + ((1.0,) if len(channels) == 3 else ())
    if not all(_math.isfinite(c) and 0 <= c <= 1 for c in channels):
        raise ValueError(f"{where}: color channels must be finite numbers in 0..1, got {channels}")
    red, green, blue, alpha = channels
    return {"red": red, "green": green, "blue": blue, "alpha": alpha}


def identity():
    """The identity placement, build123d's Location() (cad_khana's default)."""
    return build123d().Location()


def is_identity(location):
    """True for None and any build123d Location whose transformation is exactly the identity."""
    if location is None:
        return True
    shim = build123d()
    if not isinstance(location, shim.Location):
        return False
    rows, offset = location._wonky_rigid()
    return (all(rows[i][j] == (1.0 if i == j else 0.0) for i in range(3) for j in range(3))
            and all(value == 0.0 for value in offset))


def compose(outer, inner):
    """outer * inner, the parent-frame composition cad_khana uses (build123d Location composition)."""
    if is_identity(outer):
        return inner if inner is not None else outer
    if is_identity(inner):
        return outer
    return outer * inner


def place(location, part, where):
    """The part moved to location, as a Bend shape built now (use-site errors)."""
    shim = build123d()
    if not isinstance(part, shim.Shape):
        return unsupported(f"{where}: the part is a {type(part).__name__}, not a Bend-built build123d Shape; "
                           f"wonky's cad_khana places only shapes the build123d shim constructed")
    if is_identity(location):
        return part
    placed = location * part
    if not isinstance(placed, shim.Shape):
        return unsupported(f"{where}: placing with {type(location).__name__} did not produce a Bend shape")
    return placed


def copy(shape):
    """A distinct Bend copy of a shape (exact zero translation), for repeated placements."""
    shim = build123d()
    return shim.Pos(0, 0, 0) * shape
