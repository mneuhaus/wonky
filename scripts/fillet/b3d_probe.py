"""build123d ORACLE probe for fillet/chamfer calls (validation/measurement only).

    uv run --no-project --offline --with build123d==0.13.0 --with numpy --with trimesh \
        --with pyyaml --with scipy --with bd_warehouse --with pytest \
        python scripts/fillet/b3d_probe.py <mirror model.py> <corpus-relative path> <out.json> <brep dir>

Runs a MIRROR copy of one of Marc's build123d files (never the corpus original) as
__main__ with Mixin3D.fillet / Mixin3D.chamfer wrapped. Every 3D fillet/chamfer
invocation records: the calling line in the model (and the outermost model frame),
size, the pre-blend solid (saved as .brep under <brep dir>), the configuration of
the selected edges (edge_config.analyze), and whether OCCT then succeeded. The
real operation runs afterwards, so the model continues exactly as in build123d.
2D vertex fillets (Face.fillet_2d) are counted, not analysed.
If the file only defines pytest-style test_* functions, those that mention
fillet/chamfer are called after the module ran.
"""
import hashlib
import json
import os
import runpy
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

model, rel, out_path, brep_dir = sys.argv[1:5]
model = os.path.abspath(model)
mirror_root = os.environ.get("FILLET_MIRROR_ROOT", os.path.dirname(model))
extra_paths = [p for p in os.environ.get("FILLET_EXTRA_PATHS", "").split(os.pathsep) if p]
os.makedirs(brep_dir, exist_ok=True)

import build123d  # noqa: E402,F401
from build123d.topology.three_d import Mixin3D  # noqa: E402
from build123d.topology.two_d import Face  # noqa: E402
from OCP.BRepTools import BRepTools  # noqa: E402

import edge_config  # noqa: E402


def _ocp_aliases():
    """Environment adapter: some of Marc's files (and cad_khana) import OCP 7.7 collection
    names that OCP 7.8+ (build123d 0.13) exposes as NCollection templates in
    OCP.collections. Alias them so those files run unchanged. Oracle-side only."""
    import OCP.collections as col
    import OCP.TColStd as tcs
    import OCP.TopTools as tt
    table = {
        (tt, "TopTools_IndexedDataMapOfShapeListOfShape"): "IndexedDataMap_TopoDS_Shape_List_TopoDS_Shape_TopTools_ShapeMapHasher",
        (tt, "TopTools_IndexedMapOfShape"): "IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher",
        (tt, "TopTools_ListOfShape"): "List_TopoDS_Shape",
        (tt, "TopTools_MapOfShape"): "Map_TopoDS_Shape_TopTools_ShapeMapHasher",
        (tt, "TopTools_DataMapOfShapeShape"): "DataMap_TopoDS_Shape_TopoDS_Shape_TopTools_ShapeMapHasher",
        (tt, "TopTools_DataMapOfShapeListOfShape"): "DataMap_TopoDS_Shape_List_TopoDS_Shape_TopTools_ShapeMapHasher",
        (tcs, "TColStd_IndexedDataMapOfStringString"): "IndexedDataMap_TCollection_AsciiString_TCollection_AsciiString",
    }
    for (mod, old), new in table.items():
        if not hasattr(mod, old) and hasattr(col, new):
            setattr(mod, old, getattr(col, new))
    # OCP 7.7 static casts TopoDS.Edge_s(...) are TopoDS.Edge(...) in OCP 7.8+
    from OCP.TopoDS import TopoDS
    for kind in ("Edge", "Face", "Vertex", "Wire", "Shell", "Solid", "Compound", "CompSolid"):
        if not hasattr(TopoDS, kind + "_s") and hasattr(TopoDS, kind):
            setattr(TopoDS, kind + "_s", getattr(TopoDS, kind))


_ocp_aliases()
records = []
counts = {"fillet2d": 0, "chamfer2d": 0}
T0 = time.time()
MAX_ANALYSED = int(os.environ.get("FILLET_MAX_ANALYSED", "400"))


def caller():
    inner = outer = None
    for fr in traceback.extract_stack()[:-2]:
        fn = os.path.abspath(fr.filename)
        if fn.startswith(mirror_root) and "/scripts/fillet/" not in fn:
            rec = {"file": os.path.relpath(fn, mirror_root), "line": fr.lineno, "function": fr.name}
            if outer is None:
                outer = rec
            inner = rec
    return inner, outer


def save_brep(shape):
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    props = GProp_GProps()
    try:
        BRepGProp.VolumeProperties_s(shape, props)
        vol = props.Mass()
    except Exception:
        vol = None
    key = hashlib.sha1(f"{rel}:{len(records)}:{vol}".encode()).hexdigest()[:16]
    path = os.path.join(brep_dir, key + ".brep")
    try:
        BRepTools.Write_s(shape, path)
    except Exception:
        path = None
    return path, vol


def wrap(kind, original):
    def probe(self, *args, **kwargs):
        if kind == "fillet":
            size = kwargs.get("radius", args[0] if args else None)
            edges = kwargs.get("edge_list", args[1] if len(args) > 1 else None)
            size2 = None
        else:
            size = kwargs.get("length", args[0] if args else None)
            size2 = kwargs.get("length2", args[1] if len(args) > 1 else None)
            edges = kwargs.get("edge_list", args[2] if len(args) > 2 else None)
        edges = list(edges or [])
        inner, outer = caller()
        rec = {"kind": kind, "size": size, "size2": size2, "caller": inner, "outer": outer,
               "nEdgesPassed": len(edges), "t": round(time.time() - T0, 3)}
        if len(records) < MAX_ANALYSED:
            try:
                brep, vol = save_brep(self.wrapped)
                rec["brep"] = brep and os.path.relpath(brep, brep_dir)
                rec["volume"] = vol
                t = time.time()
                rec["config"] = edge_config.analyze(self.wrapped, [e.wrapped for e in edges], size, kind)
                rec["analysisS"] = round(time.time() - t, 3)
            except Exception as err:  # the probe must never change the model's behaviour
                rec["analysisError"] = f"{type(err).__name__}: {err}"
        else:
            rec["analysisSkipped"] = "record budget"
        try:
            result = original(self, *args, **kwargs)
            rec["occt"] = "ok"
            return result
        except Exception as err:
            rec["occt"] = "failed"
            rec["occtError"] = f"{type(err).__name__}: {str(err)[:200]}"
            raise
        finally:
            records.append(rec)
    return probe


def count2d(kind, original):
    def probe(self, *args, **kwargs):
        counts[kind] += 1
        return original(self, *args, **kwargs)
    return probe


Mixin3D.fillet = wrap("fillet", Mixin3D.fillet)
Mixin3D.chamfer = wrap("chamfer", Mixin3D.chamfer)
Face.fillet_2d = count2d("fillet2d", Face.fillet_2d)
Face.chamfer_2d = count2d("chamfer2d", Face.chamfer_2d)

status, error, error_tb = "ok", None, None
os.chdir(os.path.dirname(model))
ancestors, d = [], os.path.dirname(os.path.dirname(model))
while d.startswith(mirror_root) and len(d) >= len(mirror_root):
    ancestors.append(d)
    d = os.path.dirname(d)
# model dir first (like `python model.py`), then the libraries, then ancestor
# directories up to the project root (sibling-package imports such as hardware_refs)
sys.path[:0] = [os.path.dirname(model)] + extra_paths + ancestors
sys.argv = [model]
namespace = {}
try:
    namespace = runpy.run_path(model, run_name="__main__")
except SystemExit as e:
    status = "exit" if e.code not in (None, 0) else "ok"
except BaseException as err:  # noqa: BLE001 - record and report
    status = "error"
    error = f"{type(err).__name__}: {str(err)[:300]}"
    error_tb = traceback.format_exc()[-1500:]

tests_run = []
if namespace:
    import inspect
    for name, fn in list(namespace.items()):
        if name.startswith("test_") and callable(fn):
            try:
                src = inspect.getsource(fn)
            except Exception:
                continue
            if "fillet" not in src and "chamfer" not in src:
                continue
            try:
                if inspect.signature(fn).parameters:
                    tests_run.append({"test": name, "status": "skipped-fixture"})
                    continue
                fn()
                tests_run.append({"test": name, "status": "ok"})
            except BaseException as err:  # noqa: BLE001
                tests_run.append({"test": name, "status": f"{type(err).__name__}: {str(err)[:120]}"})

with open(out_path, "w") as fh:
    json.dump({"path": rel, "status": status, "error": error, "traceback": error_tb, "tests": tests_run,
               "counts2d": counts, "wallS": round(time.time() - T0, 2), "records": records}, fh)
print(json.dumps({"path": rel, "status": status, "error": error, "records": len(records),
                  "counts2d": counts, "wallS": round(time.time() - T0, 2)}))
