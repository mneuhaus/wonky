"""Run WPy / build123d files on real build123d + OCCT for validation only.

    uv run --no-project --offline --with build123d python scripts/lang/surface-occt.py FILE...

For each file: executes it as __main__ with the wonky shim importable, turns
export_* calls into named outputs (nothing is written), counts calls of the
kernel-relevant build123d API, and prints one JSON object per file with the
volume, bounding box, validity and topology counts of every output.
"""
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "src", "lang", "surface", "py"))

import build123d  # noqa: E402

COUNTED = ["Box", "Cylinder", "Cone", "Polygon", "Rectangle", "Circle", "Text", "extrude", "fillet", "chamfer", "offset", "revolve", "loft"]
calls = {}
outputs = {}


def counting(name, fn):
    def wrapper(*args, **kwargs):
        calls[name] = calls.get(name, 0) + 1
        return fn(*args, **kwargs)
    return wrapper


for name in COUNTED:
    original = getattr(build123d, name)
    if isinstance(original, type):
        # subclass so isinstance checks inside build123d keep working
        setattr(build123d, name, type(name, (original,), {"__init__": counting(name, original.__init__)}))
    else:
        setattr(build123d, name, counting(name, original))


def recorder(fmt):
    def record(shape, path=None, *args, **kwargs):
        stem = os.path.splitext(os.path.basename(str(path or fmt)))[0]
        outputs[stem] = shape
    return record


for fn in ["export_stl", "export_step", "export_brep", "export_gltf"]:
    setattr(build123d, fn, recorder(fn))
build123d.show = build123d.show_object = lambda *a, **k: None


def describe(shape):
    bb = shape.bounding_box()
    return {
        "volume": shape.volume,
        "bbox": [bb.min.X, bb.min.Y, bb.min.Z, bb.max.X, bb.max.Y, bb.max.Z],
        "valid": bool(shape.is_valid),
        "solids": len(shape.solids()),
        "faces": len(shape.faces()),
        "edges": len(shape.edges()),
    }


def run(path):
    calls.clear()
    outputs.clear()
    for mod in ["wonky"]:
        sys.modules.pop(mod, None)
    g = {"__name__": "__main__", "__file__": path}
    t0 = time.perf_counter()
    try:
        with open(path, encoding="utf8") as f:
            exec(compile(f.read(), path, "exec"), g)
    except Exception as exc:  # report, never hide
        return {"file": path, "error": f"{type(exc).__name__}: {exc}", "trace": traceback.format_exc()[-2000:]}
    ms = (time.perf_counter() - t0) * 1000
    if not outputs and "result" in g:
        res = g["result"]
        items = res if isinstance(res, (list, tuple)) else [res]
        for i, s in enumerate(items):
            outputs["result" if len(items) == 1 else f"result[{i}]"] = s
    return {"file": path, "ms": round(ms, 1), "calls": dict(sorted(calls.items())),
            "outputs": {k: describe(v) for k, v in outputs.items()}}


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(json.dumps(run(os.path.abspath(p))), flush=True)
