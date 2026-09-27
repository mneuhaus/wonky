"""Independent OCCT check of exported Bend geometry and FS observations.
Run through uv with the project's reference-venv Python, never in production.
"""
import json
import math
import sys
from pathlib import Path

from OCP.Bnd import Bnd_Box
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GeomAbs import GeomAbs_Circle
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Trsf

root = Path(sys.argv[1])
observed = json.loads((root / "observations.json").read_text())
# STEP ASCII binary64 round trip plus Bend F32x2 error at 275 mm is <1e-8 mm.
# No BRep vertex tolerance (usually 1e-7 mm) is added to these carrier checks.
TOL = 1e-8


def near(a, b):
    assert abs(a - b) <= TOL, (a, b)


def point_near(a, b):
    for x, y in zip(a, b):
        near(x, y)


def coords(p):
    return [p.X(), p.Y(), p.Z()]


def read(name):
    reader = STEPControl_Reader()
    assert reader.ReadFile(str(root / name)) == IFSelect_RetDone
    assert reader.TransferRoots() == 1
    shape = reader.OneShape()
    assert BRepCheck_Analyzer(shape).IsValid(), name
    return shape


hub = read("hub.step")
curves = []
seen = []
it = TopExp_Explorer(hub, TopAbs_EDGE)
while it.More():
    edge = TopoDS.Edge_s(it.Current())
    if not any(edge.IsSame(previous) for previous in seen):
        seen.append(edge)
        curve = BRepAdaptor_Curve(edge)
        if curve.GetType() == GeomAbs_Circle:
            curves.append(curve)
    it.Next()

for ring, (x, radius) in zip(observed["rings"], [(133.8, 25), (152.3, 11)]):
    matches = [c for c in curves if abs(c.Circle().Radius() - radius) < TOL
               and abs(c.Circle().Location().X() - x) < TOL]
    assert len(matches) == 1, (x, radius, len(matches))
    curve = matches[0]
    circle = curve.Circle()
    point_near(coords(circle.Location()), [x, 17.453, 274.69])
    point_near(ring["center"], coords(circle.Location()))
    near(ring["radius"], circle.Radius())
    point_near(ring["normal"], coords(circle.Axis().Direction()))
    point_near(ring["x"], coords(circle.XAxis().Direction()))
    near(curve.LastParameter() - curve.FirstParameter(), 2 * math.pi)
    # A full ring is independent of the seam choice. Each evaluator sample
    # must lie on this OCCT carrier with a unit tangent orthogonal to radius.
    for sample in ring["samples"]:
        delta = [v - c for v, c in zip(sample["point"], ring["center"])]
        near(delta[0], 0)
        near(math.hypot(*delta), radius)
        near(sum(v * d for v, d in zip(delta, sample["direction"])), 0)
        near(math.hypot(*sample["direction"]), 1)
    point_near(ring["samples"][0]["point"], ring["samples"][-1]["point"])
    print(f"OCCT ring x={x}, r={radius}: center, frame, 2pi range and 4 tangent samples agree")

box = read("box.step")
for frame, (low, high) in zip(observed["boxes"], [([0, 2, 3], [2, 5, 7]), ([2, -2, 3], [5, 0, 7])]):
    x, z, o = frame["x"], frame["z"], frame["origin"]
    y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
    rows = [x, y, z]
    t = gp_Trsf()
    t.SetValues(*[v for row in rows for v in [*row, -sum(a * b for a, b in zip(row, o))]])
    local_shape = BRepBuilderAPI_Transform(box, t, True).Shape()
    bounds = Bnd_Box()
    BRepBndLib.AddOptimal_s(local_shape, bounds, False, False)
    lo_hi = list(bounds.Get())
    point_near(lo_hi[:3], low)
    point_near(lo_hi[3:], high)
    point_near(frame["min"], lo_hi[:3])
    point_near(frame["max"], lo_hi[3:])
    print(f"OCCT local box {lo_hi}: closed form and evBox3d agree")
