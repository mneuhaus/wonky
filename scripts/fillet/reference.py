# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["cadquery-ocp==8.0.1.0.0"]
# ///
"""Fillet harness TEST ORACLE (OpenCascade through OCP, the kernel build123d uses).

Usage:
  uv run scripts/fillet/reference.py [--cases a,b] [--dump out/fillet/oracle-occt/results]
  uv run scripts/fillet/reference.py --measure <file.step> ...

Oracle mode: for every case in fixtures/fillet/cases.json it reads the input
body that wonky built (out/fillet/input-step/<id>.step, written by the
kernel's own STEP serializer), finds the selected edges by the sample points in
fixtures/fillet/jobs/<id>.json, runs BRepFilletAPI_MakeFillet /
BRepFilletAPI_MakeChamfer (symmetric distance) and records status, volume,
area, face count per surface type, BRepCheck validity and free edges, time,
and the agreement with the case's closed form. Writes
fixtures/fillet/reference.json. OCCT never feeds geometry into a prototype:
--dump writes OCCT's results in the harness result format only so that the
validator can be exercised on real blends (pseudo prototype `oracle-occt`).

Measure mode: prints one JSON list with the same measurements for result STEP
files written by scripts/fillet/validate.mjs (OCCT reads, never repairs).
"""
import json
import math
import struct
import sys
import time
from pathlib import Path

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeVertex
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet
from OCP.BRepGProp import BRepGProp
from OCP.BRepTools import BRepTools, BRepTools_WireExplorer
from OCP.GeomAbs import (GeomAbs_Circle, GeomAbs_Cone, GeomAbs_Cylinder, GeomAbs_Ellipse, GeomAbs_Line,
                         GeomAbs_Plane, GeomAbs_Sphere, GeomAbs_Torus)
from OCP.GProp import GProp_GProps
from OCP.gp import gp_Pnt
from OCP.IFSelect import IFSelect_RetDone
from OCP.ShapeAnalysis import ShapeAnalysis_Shell
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_FORWARD, TopAbs_SHELL, TopAbs_SOLID, TopAbs_VERTEX, TopAbs_WIRE
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopoDS import TopoDS

ROOT = Path(__file__).resolve().parents[2]
SURF = {GeomAbs_Plane: "plane", GeomAbs_Cylinder: "cylinder", GeomAbs_Cone: "cone", GeomAbs_Sphere: "sphere", GeomAbs_Torus: "torus"}


def read_step(path):
    r = STEPControl_Reader()
    if r.ReadFile(str(path)) != IFSelect_RetDone:
        raise RuntimeError(f"OpenCascade could not parse {path}")
    if not r.TransferRoots():
        raise RuntimeError(f"no transferable shapes in {path}")
    return r.OneShape()


class Index:
    """Unique sub-shapes in exploration order (IsSame identity); OCP 8 exposes no indexed map."""

    def __init__(self, shape, kind):
        self.items = []
        it = TopExp_Explorer(shape, kind)
        while it.More():
            cur = it.Current()
            if self.find(cur) < 0:
                self.items.append(cur)
            it.Next()

    def find(self, s):
        for i, x in enumerate(self.items):
            if x.IsSame(s):
                return i
        return -1


def indexed(shape, kind):
    m = Index(shape, kind)
    return m.items, m


def surface_type(face):
    t = BRepAdaptor_Surface(TopoDS.Face(face)).GetType()
    return SURF.get(t, "other:" + str(t).split(".")[-1])


def measure(shape):
    vp, ap = GProp_GProps(), GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, vp, 1e-10, True, False)
    BRepGProp.SurfaceProperties_s(shape, ap, 1e-10, False)
    faces, _ = indexed(shape, TopAbs_FACE)
    types = {}
    for f in faces:
        k = surface_type(f)
        types[k] = types.get(k, 0) + 1
    sas = ShapeAnalysis_Shell()
    sas.LoadShells(shape)
    bad = sas.CheckOrientedShells(shape, True)
    free = 0
    if sas.HasFreeEdges():
        free = len(indexed(sas.FreeEdges(), TopAbs_EDGE)[0])
    return {
        "volume": vp.Mass(), "area": ap.Mass(), "faces": len(faces), "faceTypes": types,
        "edges": len(indexed(shape, TopAbs_EDGE)[0]), "vertices": len(indexed(shape, TopAbs_VERTEX)[0]),
        "solids": len(indexed(shape, TopAbs_SOLID)[0]), "shells": len(indexed(shape, TopAbs_SHELL)[0]),
        "valid": bool(BRepCheck_Analyzer(shape).IsValid()), "freeEdges": free, "badOrientation": bool(bad),
    }


def point_edge_distance(p, edge):
    v = BRepBuilderAPI_MakeVertex(gp_Pnt(*p)).Vertex()
    d = BRepExtrema_DistShapeShape(v, edge)
    return d.Value() if d.IsDone() else math.inf


# --- result dump in the harness format (scripts/fillet/brepfmt.mjs) ----------

def enc(x):
    """F32x2: hi = fround(x), lo = fround(x - hi), as two U32 bit patterns."""
    if not math.isfinite(x):
        raise ValueError("non-finite real")
    if x == 0:
        x = 0.0
    hi = struct.unpack("f", struct.pack("f", x))[0]
    lo = struct.unpack("f", struct.pack("f", x - hi))[0]
    b = lambda y: struct.unpack("I", struct.pack("f", y))[0]
    return f"{b(hi)} {b(lo)}"


def vec(v):
    return " ".join(enc(c) for c in v)


def xyz(p):
    return (p.X(), p.Y(), p.Z())


def dump_result(shape, role_of):
    verts, vmap = indexed(shape, TopAbs_VERTEX)
    edges, emap = indexed(shape, TopAbs_EDGE)
    faces, _ = indexed(shape, TopAbs_FACE)
    keep = [not BRep_Tool.Degenerated_s(TopoDS.Edge(e)) for e in edges]
    eidx, lines_e = {}, []
    for i, e in enumerate(edges):
        if not keep[i]:
            continue
        ef = TopoDS.Edge(e.Oriented(TopAbs_FORWARD))
        c = BRepAdaptor_Curve(ef)
        f, l = BRep_Tool.Range_s(ef)
        a, b = TopExp.FirstVertex_s(ef), TopExp.LastVertex_s(ef)
        t = c.GetType()
        if t == GeomAbs_Line:
            g = c.Line()
            curve = f"line {vec(xyz(g.Location()))} {vec(xyz(g.Direction()))}"
        elif t == GeomAbs_Circle:
            ax = c.Circle().Position()
            curve = f"circle {vec(xyz(ax.Location()))} {vec(xyz(ax.Direction()))} {vec(xyz(ax.XDirection()))} {enc(c.Circle().Radius())}"
        elif t == GeomAbs_Ellipse:
            g = c.Ellipse()
            ax = g.Position()
            curve = f"ellipse {vec(xyz(ax.Location()))} {vec(xyz(ax.Direction()))} {vec(xyz(ax.XDirection()))} {enc(g.MajorRadius())} {enc(g.MinorRadius())}"
        else:
            raise ValueError(f"edge curve type {str(t).split('.')[-1]} has no harness record")
        eidx[i] = len(lines_e)
        lines_e.append(f"e {vmap.find(a)} {vmap.find(b)} {curve} 1 1 {enc(f)} {enc(l)}")
    lines_f = []
    for fc in faces:
        face = TopoDS.Face(fc)
        s = BRepAdaptor_Surface(face)
        t = s.GetType()
        getter = {GeomAbs_Plane: s.Plane, GeomAbs_Cylinder: s.Cylinder, GeomAbs_Cone: s.Cone, GeomAbs_Sphere: s.Sphere, GeomAbs_Torus: s.Torus}.get(t)
        if getter is None:
            raise ValueError(f"surface type {str(t).split('.')[-1]} has no harness record")
        g = getter()
        ax = g.Position()
        frame = f"{vec(xyz(ax.Location()))} {vec(xyz(ax.Direction()))} {vec(xyz(ax.XDirection()))}"
        if t == GeomAbs_Plane:
            surf = f"plane {frame}"
        elif t == GeomAbs_Cylinder:
            surf = f"cylinder {frame} {enc(g.Radius())}"
        elif t == GeomAbs_Cone:
            surf = f"cone {frame} {enc(g.RefRadius())} {enc(g.SemiAngle())}"
        elif t == GeomAbs_Sphere:
            surf = f"sphere {frame} {enc(g.Radius())}"
        else:
            surf = f"torus {frame} {enc(g.MajorRadius())} {enc(g.MinorRadius())}"
        same = (face.Orientation() == TopAbs_FORWARD) == ax.Direct()
        outer = BRepTools.OuterWire_s(face)
        loops = []
        wx = TopExp_Explorer(face, TopAbs_WIRE)
        while wx.More():
            w = TopoDS.Wire(wx.Current())
            # Connection order from BRepTools_WireExplorer. Orientation from
            # Current().Orientation() (composed with wire and face), not from
            # Orientation(), which differs on faces with seams (MEASURED on the
            # post-rim torus).
            seq = []
            we = BRepTools_WireExplorer(w, face)
            while we.More():
                k = emap.find(we.Current())
                if keep[k]:
                    seq.append([k, we.Current().Orientation() == TopAbs_FORWARD])
                we.Next()
            uses = [f"{eidx[k]} {1 if o else 0}" for k, o in seq]
            loops.append(f"l {1 if w.IsSame(outer) else 0} {len(uses)} {' '.join(uses)}")
            wx.Next()
        lines_f.append(f"f {1 if same else 0} {surf} {role_of(fc)} {enc(0.0)} {len(loops)} {' '.join(loops)}")
    out = ["ok", f"brep {len(verts)} {len(lines_e)} {len(lines_f)}"]
    out += [f"v {vec(xyz(BRep_Tool.Pnt_s(TopoDS.Vertex(v))))}" for v in verts]
    return "\n".join(out + lines_e + lines_f + ["end"]) + "\n"


# --- oracle --------------------------------------------------------------------

def run_case(case, side, dump_dir):
    inp = read_step(ROOT / side["step"])
    m_in = measure(inp)
    edges, _ = indexed(inp, TopAbs_EDGE)
    picked = []
    for sel in side["selected"]:
        ds = sorted((point_edge_distance(sel["sample"], e), i) for i, e in enumerate(edges))
        if ds[0][0] > 1e-5 or (len(ds) > 1 and ds[1][0] < 1e-5):
            return {"status": "error", "error": f"edge sample {sel['sample']} matched {sum(d < 1e-5 for d, _ in ds)} OCCT edges", "input": m_in}
        picked.append(TopoDS.Edge(edges[ds[0][1]]))
    op = BRepFilletAPI_MakeFillet(inp) if case["op"] == "fillet" else BRepFilletAPI_MakeChamfer(inp)
    for e in picked:
        op.Add(case["size"], e)
    rec = {"input": m_in, "edgesMatched": len(picked)}
    t0 = time.perf_counter()
    try:
        op.Build()
        done = op.IsDone()
    except Exception as ex:  # report, never hide
        done = False
        rec["exception"] = f"{type(ex).__name__}: {ex}"
    rec["ms"] = (time.perf_counter() - t0) * 1000
    if case["op"] == "fillet":
        try:
            rec["faultyContours"] = op.NbFaultyContours()
            rec["faultyVertices"] = op.NbFaultyVertices()
        except Exception:
            pass
    if not done:
        rec["status"] = "not-done"
        return rec
    res = op.Shape()
    rec["status"] = "done"
    rec["result"] = measure(res)
    if dump_dir:
        inp_faces, _ = indexed(inp, TopAbs_FACE)
        kept = []
        for f in inp_faces:
            if op.IsDeleted(f):
                continue
            mods = op.Modified(f)
            if mods.Size() == 0:
                kept.append(f)
            else:
                kept.extend(list(mods))

        def role_of(fc):
            if any(fc.IsSame(k) for k in kept):
                return "support"
            return "corner" if surface_type(fc) == "sphere" else "blend"

        target = dump_dir / f"{case['id']}.cpu1.result"
        try:
            target.write_text(dump_result(res, role_of))
            rec["dumped"] = True
        except Exception as ex:
            target.write_text(f"unresolved unsupported-surface oracle-occt dump: {ex}\nend\n")
            rec["dumped"] = f"{type(ex).__name__}: {ex}"
    return rec


def closed_form_check(case, rec):
    cf = case.get("closedForm")
    if not cf or rec.get("status") != "done":
        return None
    base = rec["input"]["volume"]
    exp = base + cf["deltaVolume"]
    err = abs(rec["result"]["volume"] - exp)
    out = {"expectedVolume": exp, "absErr": err, "relErr": err / max(abs(exp), 1e-12), "agrees": err <= 1e-7 * max(abs(exp), 1.0)}
    for k, dv in (cf.get("alternatives") or {}).items():
        e2 = abs(rec["result"]["volume"] - (base + dv))
        out[f"relErrVs_{k}"] = e2 / max(abs(base + dv), 1e-12)
        if e2 <= 1e-7 * max(abs(base + dv), 1.0):
            out["matchesAlternative"] = k
    return out


def main(argv):
    if argv and argv[0] == "--measure":
        out = []
        for p in argv[1:]:
            try:
                out.append({"file": p, **measure(read_step(p))})
            except Exception as ex:
                out.append({"file": p, "error": f"{type(ex).__name__}: {ex}"})
        print(json.dumps(out))
        return
    only = argv[argv.index("--cases") + 1].split(",") if "--cases" in argv else None
    dump_dir = ROOT / argv[argv.index("--dump") + 1] if "--dump" in argv else None
    if dump_dir:
        dump_dir.mkdir(parents=True, exist_ok=True)
    cases = json.loads((ROOT / "fixtures/fillet/cases.json").read_text())["cases"]
    ref_path = ROOT / "fixtures/fillet/reference.json"
    ref = json.loads(ref_path.read_text()) if ref_path.exists() else {"cases": {}}
    ref.update({"schema": "wonky-fillet-reference/1", "tool": {"package": "cadquery-ocp 8.0.1.0.0 (OCCT 8.0.1, as build123d 0.13)"},
                "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "method": "OCCT BRepFilletAPI_MakeFillet / MakeChamfer(symmetric distance) on the wonky input body read from STEP; GProp eps 1e-10"})
    for case in cases:
        if only and case["id"] not in only:
            continue
        side_path = ROOT / "fixtures/fillet/jobs" / f"{case['id']}.json"
        if not side_path.exists():
            ref["cases"][case["id"]] = {"status": "no-fixture"}
            continue
        side = json.loads(side_path.read_text())
        try:
            rec = run_case(case, side, dump_dir)
        except Exception as ex:
            rec = {"status": "error", "error": f"{type(ex).__name__}: {ex}"}
        rec["jobSha256"] = side["jobSha256"]
        kv = side["kernel"]["volumeMm3"]
        if "input" in rec and kv:
            rec["inputVolumeRelErrVsKernel"] = abs(rec["input"]["volume"] - kv) / kv
        rec["closedForm"] = closed_form_check(case, rec)
        ref["cases"][case["id"]] = rec
        r = rec.get("result", {})
        cf = rec["closedForm"]
        cft = "-" if not cf else ("OK" if cf["agrees"] else ("ALT " + cf["matchesAlternative"]) if cf.get("matchesAlternative") else "DIFF %.2e" % cf["relErr"])
        print(f"{case['id']:44} {rec['status']:9} {rec.get('ms', 0):8.1f}ms vol {r.get('volume', float('nan')):14.6f} "
              f"types {r.get('faceTypes', {})} valid {r.get('valid', '-')} free {r.get('freeEdges', '-')} cf {cft} {rec.get('error', '')}", flush=True)
    ref_path.write_text(json.dumps(ref, indent=1) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
