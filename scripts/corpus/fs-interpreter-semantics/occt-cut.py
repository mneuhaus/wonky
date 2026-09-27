# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["cadquery-ocp==8.0.1.0.0"]
# ///
"""Corpus failure analysis TEST ORACLE (cluster fs-interpreter-semantics).

Usage: uv run scripts/corpus/fs-interpreter-semantics/occt-cut.py <target.step> <tool.step>
Reads two operand STEP files that wonky's own serializer wrote from the frozen
production operands of a refused opBoolean subtraction, and prints one JSON
object: the OCCT validity and volume of each operand and of target minus tool.
It is the expected-volume oracle for next-bakeoff.mjs. Nothing it computes is
fed back into wonky or into a prototype.
"""
import json
import sys

from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer


def read(path):
    reader = STEPControl_Reader()
    if reader.ReadFile(path) != IFSelect_RetDone:
        raise RuntimeError(f"cannot read {path}")
    reader.TransferRoots()
    return reader.OneShape()


def count(shape, kind):
    n, it = 0, TopExp_Explorer(shape, kind)
    while it.More():
        n += 1
        it.Next()
    return n


def props(shape):
    g = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, g)
    return {
        "valid": BRepCheck_Analyzer(shape).IsValid(),
        "solids": count(shape, TopAbs_SOLID),
        "faces": count(shape, TopAbs_FACE),
        "volume": g.Mass(),
    }


def main():
    target, tool = read(sys.argv[1]), read(sys.argv[2])
    cut = BRepAlgoAPI_Cut(target, tool)
    out = {"target": props(target), "tool": props(tool)}
    if not cut.IsDone():
        out["cut"] = {"error": "BRepAlgoAPI_Cut not done"}
    else:
        out["cut"] = props(cut.Shape())
    print(json.dumps(out))


if __name__ == "__main__":
    main()
