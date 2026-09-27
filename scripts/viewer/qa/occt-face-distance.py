# Independent check of exact-measure face distances with OCCT (never used to
# build geometry; AGENTS.md).
#
#   uv run --no-project --python ~/Workspace/cad/cad-khana/.venv/bin/python \
#     python scripts/viewer/qa/occt-face-distance.py model.step B1.F7,B2.F4 [B1.F2,B2.F1 ...]
#
# Faces are addressed like the viewer aliases: B<n>.F<m> is face m of solid n
# in STEP explorer order (the order bin/wonky.mjs writes them). Prints one
# JSON line per pair: the surface type and radius of both faces (to confirm
# the alias mapping), BRepExtrema's minimum distance and its closest points.
import json
import sys

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS


def solids_of(path):
    reader = STEPControl_Reader()
    if reader.ReadFile(path) != IFSelect_RetDone:
        raise SystemExit(f"cannot read {path}")
    reader.TransferRoots()
    shape = reader.OneShape()
    solids = []
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    while explorer.More():
        solid = TopoDS.Solid_s(explorer.Current())
        faces = []
        inner = TopExp_Explorer(solid, TopAbs_FACE)
        while inner.More():
            faces.append(TopoDS.Face_s(inner.Current()))
            inner.Next()
        solids.append(faces)
        explorer.Next()
    return solids


def describe(face):
    surface = BRepAdaptor_Surface(face, True)
    kind = surface.GetType()
    if kind == GeomAbs_Cylinder:
        cylinder = surface.Cylinder()
        location = cylinder.Location()
        return {"type": "cylinder", "radius": cylinder.Radius(),
                "axisPoint": [location.X(), location.Y(), location.Z()]}
    if kind == GeomAbs_Plane:
        return {"type": "plane"}
    return {"type": str(kind)}


def face_of(solids, alias):
    body, face = alias.split(".")
    return solids[int(body[1:]) - 1][int(face[1:]) - 1]


def main():
    path, *pairs = sys.argv[1:]
    solids = solids_of(path)
    for pair in pairs:
        first, second = pair.split(",")
        a, b = face_of(solids, first), face_of(solids, second)
        extrema = BRepExtrema_DistShapeShape(a, b)
        if not extrema.IsDone():
            raise SystemExit(f"BRepExtrema failed for {pair}")
        solutions = []
        for index in range(1, extrema.NbSolution() + 1):
            p, q = extrema.PointOnShape1(index), extrema.PointOnShape2(index)
            solutions.append([[p.X(), p.Y(), p.Z()], [q.X(), q.Y(), q.Z()]])
        print(json.dumps({"pair": pair, "faces": [describe(a), describe(b)],
                          "distance": extrema.Value(), "points": solutions}))


main()
