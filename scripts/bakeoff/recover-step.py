# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["cadquery-ocp==8.0.1.0.0"]
# ///
"""Bake-off TEST ORACLE for the recover prototype (OpenCascade reads STEP only).

Usage: uv run scripts/bakeoff/recover-step.py <file.step> ...
Prints one JSON list: per file BRepCheck validity (exact CurveOnSurface, as in
scripts/validate-step.py), solid/shell/face/edge/vertex counts, seam uses and
degenerated edges, volume and area, and the BOPAlgo_ArgumentAnalyzer
self-interference / small-edge check (BRepCheck does not test face/face
intersections; the adversarial verifier's selfint.py uses the same modes). Errors are reported per file instead of aborting the batch. OCP never
constructs or repairs the geometry it measures.
"""
import json
import sys

from OCP.BOPAlgo import BOPAlgo_ArgumentAnalyzer
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_SHELL, TopAbs_SOLID, TopAbs_VERTEX
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool


def count(shape, kind):
    found = []
    it = TopExp_Explorer(shape, kind)
    while it.More():
        cur = it.Current()
        if not any(cur.IsSame(p) for p in found):
            found.append(cur)
        it.Next()
    return len(found)


def unique(shape, kind):
    found = []
    it = TopExp_Explorer(shape, kind)
    while it.More():
        cur = it.Current()
        if not any(cur.IsSame(p) for p in found):
            found.append(cur)
        it.Next()
    return found


def interference(shape):
    a = BOPAlgo_ArgumentAnalyzer()
    a.SetShape1(shape)
    a.ArgumentTypeMode = True
    a.SmallEdgeMode = True
    a.RebuildFaceMode = True
    a.ContinuityMode = True
    a.CurveOnSurfaceMode = True
    a.SelfInterMode = True
    a.Perform()
    kinds = {}
    for x in a.GetCheckResult():
        k = str(x.GetCheckStatus()).split(".")[-1]
        kinds[k] = kinds.get(k, 0) + 1
    return bool(a.HasFaulty()), kinds


def check(path):
    reader = STEPControl_Reader()
    if reader.ReadFile(path) != IFSelect_RetDone:
        return {"file": path, "error": "OpenCascade could not parse STEP"}
    if not reader.TransferRoots():
        return {"file": path, "error": "no transferable shapes"}
    shape = reader.OneShape()
    valid = BRepCheck_Analyzer(shape, True, False, True).IsValid()
    vp = GProp_GProps()
    err = BRepGProp.VolumeProperties_s(shape, vp, 1e-10, True, False)
    faulty, faults = interference(shape)
    ap = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, ap, 1e-10, False)
    return {
        "file": path, "valid": bool(valid), "interferenceFree": not faulty, "interference": faults,
        # the default (sampled) CurveOnSurface check, reported separately
        "validSampled": bool(BRepCheck_Analyzer(shape).IsValid()), "volume": vp.Mass(), "volumeIntegrationError": err, "area": ap.Mass(),
        "solids": count(shape, TopAbs_SOLID), "shells": count(shape, TopAbs_SHELL), "faces": count(shape, TopAbs_FACE),
        "edges": count(shape, TopAbs_EDGE), "vertices": count(shape, TopAbs_VERTEX),
        # seam uses (an edge closed on its face) and degenerated (pole) edges,
        # to account for the topology the STEP reader adds on periodic faces
        "seams": sum(BRep_Tool.IsClosed_s(TopoDS.Edge(e), TopoDS.Face(fc)) for fc in unique(shape, TopAbs_FACE) for e in unique(fc, TopAbs_EDGE)),
        "degenerated": sum(BRep_Tool.Degenerated_s(TopoDS.Edge(e)) for e in unique(shape, TopAbs_EDGE)),
    }


if __name__ == "__main__":
    out = []
    for p in sys.argv[1:]:
        try:
            out.append(check(p))
        except Exception as e:  # report, never hide
            out.append({"file": p, "error": f"{type(e).__name__}: {e}"})
    print(json.dumps(out))
