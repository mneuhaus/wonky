# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["cadquery-ocp==8.0.1.0.0"]
# ///
"""Read-only OCCT oracle for exported apex cones: one valid solid (exact
CurveOnSurface check), the closed-form volume, the face count, and exactly one
degenerated edge (OCCT's apex representation) per apex."""
import json
import math
import sys
from pathlib import Path
from OCP.BRep import BRep_Tool
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS


def shapes(shape, kind):
    result = []
    explorer = TopExp_Explorer(shape, kind)
    while explorer.More():
        s = explorer.Current()
        if not any(s.IsSame(other) for other in result):
            result.append(s)
        explorer.Next()
    return result


def main(directory):
    files = sorted(Path(directory).glob("*.step"))
    assert files, "no STEP files"
    for step in files:
        expected = json.loads(step.with_suffix(".expected").read_text())
        reader = STEPControl_Reader()
        assert reader.ReadFile(str(step)) == IFSelect_RetDone, step
        reader.TransferRoots()
        shape = reader.OneShape()
        assert len(shapes(shape, TopAbs_SOLID)) == 1, step
        assert BRepCheck_Analyzer(shape, True, False, True).IsValid(), f"{step}: BRepCheck"
        faces = shapes(shape, TopAbs_FACE)
        assert len(faces) == expected["faces"], (step, len(faces))
        degenerated = sum(BRep_Tool.Degenerated_s(TopoDS.Edge(e)) for e in shapes(shape, TopAbs_EDGE))
        assert degenerated == expected["apexes"], (step, degenerated)
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(shape, props, 1e-10, True, False)
        assert math.isclose(props.Mass(), expected["volume"], rel_tol=1e-7), (step, props.Mass(), expected["volume"])
    print(f"apex oracle: {len(files)} STEP files valid")


if __name__ == "__main__":
    main(sys.argv[1])
