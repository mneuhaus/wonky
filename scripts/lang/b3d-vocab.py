"""Dump the build123d public API vocabulary for the corpus scanner.

Run: uv run --no-project --offline --with build123d python scripts/lang/b3d-vocab.py fixtures/lang/b3d-vocab.json
Only introspects names; builds no geometry.

Besides the kind (class/enum/function/value) every top-level name gets a
coarse `category` used by scripts/lang/py-facts.py to tell modeling calls
from measurement, location and I/O calls.
"""
import enum
import inspect
import json
import sys

import build123d as b


def category(name, obj):
    if inspect.isclass(obj):
        if issubclass(obj, enum.Enum):
            return "enum"
        bases = {c.__name__ for c in inspect.getmro(obj)}
        if name in ("BuildPart", "BuildSketch", "BuildLine"):
            return "builder"
        if "BasePartObject" in bases:
            return "part-object"
        if "BaseSketchObject" in bases:
            return "sketch-object"
        if "BaseLineObject" in bases or "BaseEdgeObject" in bases:
            return "line-object"
        if "Location" in bases or name in ("Locations", "GridLocations", "PolarLocations", "HexLocations", "Pos", "Rot",
                                           "Rotation", "RotationLike", "Workplanes"):
            return "location"
        if name in ("Plane", "Axis", "Vector", "Matrix", "BoundBox", "Color"):
            return "geometry-value"
        if "Joint" in bases:
            return "joint"
        if "Shape" in bases or name == "ShapeList":
            return "shape-class"
        return "class"
    if callable(obj):
        if name.startswith("export_") or name in ("Mesher",):
            return "export"
        if name.startswith("import_"):
            return "import"
        if name in ("show", "show_object", "show_all"):
            return "viewer"
        return "operation"
    return "value"


top = {}
categories = {}
for name in dir(b):
    if name.startswith("_"):
        continue
    obj = getattr(b, name)
    if inspect.isclass(obj):
        kind = "enum" if issubclass(obj, enum.Enum) else "class"
    elif callable(obj):
        kind = "function"
    else:
        kind = "value"
    top[name] = kind
    categories[name] = category(name, obj)

methods = {}
for cls_name in ["Shape", "Part", "Sketch", "Curve", "Solid", "Face", "Edge", "Wire", "Vertex", "Compound",
                 "Shell", "ShapeList", "Location", "Plane", "Vector", "Axis", "BoundBox", "Color", "Mesher",
                 "BuildPart", "BuildSketch", "BuildLine", "Locations", "Joint", "RigidJoint"]:
    cls = getattr(b, cls_name, None)
    if cls is None:
        continue
    for m in dir(cls):
        if m.startswith("_"):
            continue
        methods.setdefault(m, []).append(cls_name)

json.dump({"version": getattr(b, "__version__", "unknown"), "top": top, "categories": categories, "methods": methods},
          open(sys.argv[1], "w"), indent=1, sort_keys=True)
print(len(top), len(methods))
