"""Freeze build123d's public name table for the Bend-backed Python shim.

Run (introspection only, builds no geometry):

    uv run --no-project --quiet --with build123d==0.13.0 \
        python scripts/python/build123d-names.py python/build123d_names.json

The output lists every public name of build123d 0.13.0: the 203 names of
`build123d.__all__` (what `from build123d import *` binds), every other public
module attribute (build123d-defined helpers, re-exported OCP and standard
library names, submodules) and every public attribute of each submodule
(`from build123d.<sub> import <name>` works for all of them, as in build123d,
while `from build123d.<sub> import *` binds the submodule's `__all__`). The shim
(python/build123d.py) binds each name either to its Bend implementation or to a
use-site capability sentinel. Enum members and numeric unit constants are
frozen as values, because they construct no geometry.
"""

import enum
import importlib
import inspect
import json
import math
import numbers
import pkgutil
import sys
import types

import build123d as b

VERSION = "0.13.0"
if b.__version__ != VERSION:
    sys.exit(f"expected build123d {VERSION}, found {b.__version__}")


def origin(obj):
    if isinstance(obj, types.ModuleType):
        return obj.__name__
    return getattr(obj, "__module__", None) or type(obj).__module__


def is_alias(obj):
    """A type alias such as ``VectorLike = Vector | tuple[float, float]`` (types.UnionType or a typing alias)."""
    return isinstance(obj, types.UnionType) or (
        type(obj).__module__ == "typing" and type(obj).__name__.endswith(("Alias", "UnionGenericAlias")))


def describe(name, obj, public, home="build123d"):
    """Table entry of one name; ``home`` is the build123d module that binds it (aliases carry no module)."""
    entry = {}
    if isinstance(obj, types.ModuleType):
        entry["kind"] = "module"
    elif inspect.isclass(obj) and issubclass(obj, enum.Enum):
        entry["kind"] = "enum"
        members = []
        for member_name, member in obj.__members__.items():
            value = member.value
            simple = value is None or isinstance(value, (bool, str)) or (
                isinstance(value, numbers.Real) and not isinstance(value, bool))
            members.append([member_name, value if simple else member_name])
        entry["members"] = members
    elif inspect.isclass(obj):
        entry["kind"] = "class"
    elif callable(obj):
        entry["kind"] = "function"
    elif isinstance(obj, numbers.Real) and not isinstance(obj, bool):
        entry["kind"] = "value"
        if math.isfinite(obj):
            entry["value"] = obj
    elif is_alias(obj) and stdlib_source(name, obj, "typing") is None:
        entry["kind"] = "alias"  # typing.List and friends stay stdlib re-exports below
    else:
        entry["kind"] = "object"
        entry["type"] = type(obj).__name__
    module = origin(obj)
    if entry["kind"] == "value":  # plain numbers carry no module; math re-exports share math's names
        module = "math" if hasattr(math, name) else None
    elif entry["kind"] == "alias":  # an alias reports types/typing as its module; build123d defines it
        module = home
    entry["module"] = module
    if public:
        entry["origin"] = "public"
    elif isinstance(obj, types.ModuleType) and module.startswith("build123d."):
        entry["origin"] = "submodule"
    elif entry["kind"] == "value":
        entry["origin"] = "reexport" if module == "math" else "build123d"
    elif module and module.split(".")[0] == "build123d":
        entry["origin"] = "build123d"
    elif module and module.split(".")[0] == "OCP":
        entry["origin"] = "ocp"
    else:
        entry["origin"] = "reexport"
    if entry["origin"] == "reexport":
        source = stdlib_source(name, obj, module)
        if source is not None:
            entry["stdlib"] = source
    return entry


def is_stdlib(module):
    return bool(module) and module.split(".")[0] in sys.stdlib_module_names


def stdlib_source(name, obj, module):
    """[module, attribute] of the standard library that yields this very object, or None.

    Only identity counts: the shim binds such a re-export to the same stdlib
    object, which builds no geometry. Everything else stays a sentinel.
    """
    if isinstance(obj, types.ModuleType):
        return [obj.__name__, None] if is_stdlib(obj.__name__) else None
    if module and not is_stdlib(module):
        return None  # a third-party object (numpy, scipy, ezdxf, ...)
    candidates = [module] if module and module != "builtins" else []
    # Objects without a module of their own (typing.TYPE_CHECKING is False):
    # any imported public stdlib module that binds this very object.
    candidates += sorted(key for key in sys.modules if is_stdlib(key) and key not in candidates
                         and not any(part.startswith("_") for part in key.split(".")))
    for candidate in candidates:
        try:
            source = importlib.import_module(candidate)
        except ImportError:
            continue
        for attribute in dict.fromkeys((getattr(obj, "__name__", None), name)):
            if isinstance(attribute, str) and getattr(source, attribute, None) is obj:
                return [candidate, attribute]
    return None


def main(target):
    public = sorted(b.__all__)
    names = {}
    for name in sorted(n for n in dir(b) if not n.startswith("_")):
        names[name] = describe(name, getattr(b, name), name in b.__all__)

    submodules = {}
    for info in pkgutil.walk_packages(b.__path__, "build123d."):
        if any(part.startswith("_") for part in info.name.split(".")[1:]):
            continue
        try:
            module = importlib.import_module(info.name)
        except Exception as error:  # optional viewers (jupyter, vtk) may lack dependencies
            submodules[info.name] = {"importable": False, "error": f"{type(error).__name__}: {error}"}
            continue
        declared = getattr(module, "__all__", None)
        members = {}
        # Every public attribute: `from build123d.<sub> import X` works for module
        # constants (build_constants.MM), aliases (geometry.VectorLike), mixins
        # and re-exports alike, whether or not __all__ lists them.
        for name in sorted(n for n in dir(module) if not n.startswith("_")):
            obj = getattr(module, name)
            if name in names and getattr(b, name) is obj:
                members[name] = None  # the same object as the top-level name
            else:
                members[name] = describe(name, obj, False, info.name)
        # `from build123d.<sub> import *` binds __all__, or all public names without one.
        submodules[info.name] = {"importable": True, "all": sorted(declared) if declared is not None else None,
                                 "names": members}

    table = {
        "schema": "wonky-build123d-names/1",
        "provenance": {
            "package": "build123d",
            "version": b.__version__,
            "python": sys.version.split()[0],
            "generator": "scripts/python/build123d-names.py",
            "command": "uv run --no-project --quiet --with build123d==0.13.0 python "
                       "scripts/python/build123d-names.py python/build123d_names.json",
            "note": "Names only. Introspection of the installed package; no geometry was built.",
        },
        "all": public,
        "names": names,
        "submodules": submodules,
    }
    with open(target, "w", encoding="utf-8") as stream:
        json.dump(table, stream, indent=1, sort_keys=False, allow_nan=False)
        stream.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
