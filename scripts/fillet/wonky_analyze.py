"""Analyse the wonky-built pre-blend solids written by scripts/fillet/wonky-probe.mjs.

    uv run --no-project --offline --with build123d==0.13.0 python scripts/fillet/wonky_analyze.py

For every probed call (tmp/fillet/wonky/out/<slug>.json -> calls[k].step) the STEP
that wonky's production CLI exported is read with OCP (measurement only), the
selected edges are located by their wonky records (line: both endpoints; circle:
centre, radius and endpoints), and edge_config.analyze() reports the same fields
as for the oracle runs. Output: tmp/fillet/wonky/analysis.json.
"""
import glob
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO = os.path.dirname(os.path.dirname(HERE))

from OCP.BRepAdaptor import BRepAdaptor_Curve  # noqa: E402
from OCP.gp import gp_Pnt  # noqa: E402
from OCP.IFSelect import IFSelect_RetDone  # noqa: E402
from OCP.STEPControl import STEPControl_Reader  # noqa: E402

import edge_config  # noqa: E402


def read_step(path):
    r = STEPControl_Reader()
    if r.ReadFile(path) != IFSelect_RetDone:
        raise RuntimeError(f"cannot read {path}")
    r.TransferRoots()
    return r.OneShape()


def pts(e):
    c = BRepAdaptor_Curve(e)
    p0, p1 = gp_Pnt(), gp_Pnt()
    c.D0(c.FirstParameter(), p0)
    c.D0(c.LastParameter(), p1)
    return c, (p0.X(), p0.Y(), p0.Z()), (p1.X(), p1.Y(), p1.Z())


def match(topo, rec, tol):
    best = None
    for i in range(1, topo.emap.Extent() + 1):
        e = edge_config._edge(topo.emap.FindKey(i))
        c, a, b = pts(e)
        t = edge_config.CURVE.get(c.GetType(), "other")
        if t != rec["curve"]:
            continue
        s, en = tuple(rec["start"]), tuple(rec["end"])
        d = min(max(math.dist(a, s), math.dist(b, en)), max(math.dist(a, en), math.dist(b, s)))
        if t == "circle":
            ci = c.Circle()
            loc = ci.Location()
            d = max(d, math.dist((loc.X(), loc.Y(), loc.Z()), tuple(rec["center"])), abs(ci.Radius() - rec["radius"]))
        if d < tol and (best is None or d < best[0]):
            best = (d, e)
    return best[1] if best else None


out = []
for path in sorted(glob.glob(os.path.join(REPO, "tmp/fillet/wonky/out/*.json"))):
    rec = json.load(open(path))
    for call in rec.get("calls", []):
        row = {"path": rec["path"], "k": call["k"], "line": call.get("line"), "kind": call["kind"], "size": call["size"],
               "nEdges": call["nEdges"], "omittedBefore": len(call.get("omittedBefore", []))}
        if not call.get("step"):
            row["error"] = "no STEP"
            out.append(row)
            continue
        try:
            shape = read_step(call["step"])
            topo = edge_config.Topo(shape)
            edges, missing = [], 0
            for e in call["edges"]:
                m = match(topo, e["record"], 1e-5)
                if m is None:
                    missing += 1
                else:
                    edges.append(m)
            row["unmatched"] = missing
            row["config"] = edge_config.analyze(shape, edges, call["size"], call["kind"])
        except Exception as err:
            row["error"] = f"{type(err).__name__}: {err}"
        out.append(row)
json.dump(out, open(os.path.join(REPO, "tmp/fillet/wonky/analysis.json"), "w"), indent=1)
print(json.dumps({"calls": len(out), "errors": sum(1 for r in out if r.get("error")),
                  "unmatchedEdges": sum(r.get("unmatched", 0) for r in out)}))
