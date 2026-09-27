"""FeatureScript ORACLE probe for opFillet/opChamfer (validation/measurement only).

Runs one exported feature of one of Marc's FS files through fsocct (Marc's
FeatureScript-on-OpenCascade interpreter, ~/Workspace/cad/cad-project-043/fsocct, used
from a COPY in tmp/fillet/fsocct) with opFillet wrapped and opChamfer added:

    cd tmp/fillet/fsocct && uv run --offline --frozen python \
        ../../../scripts/fillet/fsocct_probe.py <file.fs> <feature> <out.json> <brep dir>

For every call it records the operation id, size, the pre-blend body (.brep), the
configuration of the selected edges (edge_config.analyze), and whether OCCT then
built the blend. fsocct has no opChamfer; the probe supplies one on
BRepFilletAPI_MakeChamfer (equal offsets only) so the feature can continue. This
is oracle geometry, never wonky geometry.
"""
import hashlib
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

src, feature, out_path, brep_dir = sys.argv[1:5]
os.makedirs(brep_dir, exist_ok=True)

import fsocct.kernel as K  # noqa: E402
from fsocct.api import run  # noqa: E402
from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer  # noqa: E402
from OCP.BRepTools import BRepTools  # noqa: E402
from OCP.TopoDS import TopoDS  # noqa: E402

import edge_config  # noqa: E402

_edge = getattr(TopoDS, "Edge_s", None) or TopoDS.Edge
records = []
T0 = time.time()


def save(shape, tag):
    key = hashlib.sha1(f"{src}:{feature}:{tag}:{len(records)}".encode()).hexdigest()[:16]
    path = os.path.join(brep_dir, key + ".brep")
    try:
        BRepTools.Write_s(shape, path)
        return os.path.basename(path)
    except Exception:
        return None


def probe_groups(c, d, kind, size):
    groups = {}
    for e in K.resolve(c, d["entities"]):
        if e.kind == "EDGE" and isinstance(e.owner, int):
            groups.setdefault(e.owner, []).append(e)
    out = []
    for owner, edges in groups.items():
        b = c.bodies[owner]
        rec = {"kind": kind, "size": size, "owner": owner, "nEdgesPassed": len(edges)}
        try:
            rec["brep"] = save(b.shape, kind)
            rec["config"] = edge_config.analyze(b.shape, [e.shape for e in edges], size, kind)
        except Exception as err:
            rec["analysisError"] = f"{type(err).__name__}: {err}"
        out.append(rec)
    return out


def wrap_fillet(original):
    def opFillet(c, id, d):
        size = K.positive(d["radius"]) if isinstance(d, dict) and "radius" in d else None
        recs = probe_groups(c, d, "fillet", size)
        for r in recs:
            r["id"] = [str(x) for x in id]
            r["tangentPropagation"] = str(d.get("tangentPropagation", True))
        try:
            v = original(c, id, d)
            for r in recs:
                r["occt"] = "ok"
            return v
        except Exception as err:
            for r in recs:
                r["occt"] = "failed"
                r["occtError"] = f"{type(err).__name__}: {str(err)[:200]}"
            raise
        finally:
            records.extend(recs)
    return opFillet


@K.operation
def opChamfer(c, id, d):
    K.options(d, ("entities",), ("chamferType", "width", "width1", "width2", "angle", "tangentPropagation", "oppositeDirection"))
    ct = d.get("chamferType", "EQUAL_OFFSETS")
    ctype = str(getattr(ct, "value", ct))
    if "EQUAL_OFFSETS" not in ctype:
        raise K.Unsupported("probe opChamfer supports EQUAL_OFFSETS only")
    width = K.positive(d["width"])
    recs = probe_groups(c, d, "chamfer", width)
    for r in recs:
        r["id"] = [str(x) for x in id]
    try:
        groups = {}
        for e in K.resolve(c, d["entities"]):
            if e.kind != "EDGE" or not isinstance(e.owner, int):
                raise K.RuntimeErrorFS("opChamfer needs solid-body edges")
            groups.setdefault(e.owner, []).append(e)
        if not groups:
            raise K.RuntimeErrorFS("Chamfer query matched no edges")
        for owner, edges in groups.items():
            b = c.bodies[owner]
            mk = BRepFilletAPI_MakeChamfer(b.shape)
            for e in edges:
                mk.Add(width, _edge(e.shape))
            mk.Build()
            if not mk.IsDone():
                raise K.RuntimeErrorFS("OpenCascade could not build chamfer")
            K.replace_body(c, b, mk.Shape(), id, history=[(mk, True)])
        for r in recs:
            r["occt"] = "ok"
    except Exception as err:
        for r in recs:
            r["occt"] = "failed"
            r["occtError"] = f"{type(err).__name__}: {str(err)[:200]}"
        raise
    finally:
        records.extend(recs)


_bindings = K.bindings
_resolve = K.resolve


def resolve(c, q):
    """Probe-side extension of fsocct queries: qAdjacent(face, EDGE, EDGE) -> the face's
    edges (the only adjacency form in the fillet corpus). Anything else stays explicit."""
    if isinstance(q, K.Query) and q.kind == "probe_adjacent":
        src, adj, target = q.args
        out = []
        for e in _resolve(c, src):
            if e.kind == "FACE" and target == "EDGE":
                out.extend(K.Entity("EDGE", s, e.owner, e.revision) for s in K.members(e.shape, "EDGE"))
            else:
                raise K.Unsupported(f"probe qAdjacent supports FACE -> EDGE only, got {e.kind} -> {target}")
        return K.unique(out)
    return _resolve(c, q)


K.resolve = resolve


def bindings():
    b = _bindings()
    b["opFillet"] = wrap_fillet(b["opFillet"])
    b["opChamfer"] = opChamfer
    from fsocct.values import Tagged
    b.setdefault("makeRobustQuery", lambda c, q: q)
    b.setdefault("AdjacencyType", {n: Tagged(n, "AdjacencyType") for n in ("EDGE", "VERTEX")})
    b.setdefault("qAdjacent", lambda q, adj, t: K.Query("probe_adjacent", (q, K.enum_value(adj, "AdjacencyType"), K.enum_value(t, "EntityType"))))
    if "ChamferType" not in b:
        from fsocct.values import Tagged
        b["ChamferType"] = {n: Tagged(n, "ChamferType") for n in ("EQUAL_OFFSETS", "TWO_OFFSETS", "OFFSET_ANGLE")}
    return b


K.bindings = bindings

status, error = "ok", None
# UI defaults of precondition parameters without an explicit defineFeature default
# (FILLET_PARAMS: {name: FS expression}); fsocct needs them explicitly, Onshape takes
# the bound spec's default. Explicit defaults in the defineFeature map win.
implied = json.loads(os.environ.get("FILLET_PARAMS", "{}"))
applied = {}
try:
    from fsocct.runtime import Engine, Feature
    eng = Engine(imports=None)
    mod = eng.load(src)
    fn = mod.env.get(feature)
    explicit = set(fn.defaults.keys()) if isinstance(fn, Feature) else set()
    applied = {k: v for k, v in implied.items() if k not in explicit}
except Exception:
    applied = implied
try:
    fonts = {"OpenSans-Regular.ttf": os.path.abspath("cases/workspace/fonts/OpenSans-Regular.ttf"),
             "OpenSans-Bold.ttf": os.path.expanduser("~/Library/Fonts/OpenSans-Bold.ttf")}
    run(src, feature=feature, parameters=applied, fonts=fonts, max_steps=20_000_000)
except BaseException as err:  # noqa: BLE001
    status = "error"
    error = f"{type(err).__name__}: {str(err)[:400]}"

with open(out_path, "w") as fh:
    json.dump({"path": src, "feature": feature, "status": status, "error": error, "impliedParams": applied,
               "wallS": round(time.time() - T0, 2), "records": records}, fh)
print(json.dumps({"feature": feature, "status": status, "error": error and error[:160], "records": len(records),
                  "wallS": round(time.time() - T0, 2)}))
