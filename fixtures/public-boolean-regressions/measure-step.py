# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["cadquery-ocp==8.0.1.0.0"]
# ///
"""Test-only extension of the existing STEP reader; never constructs a shape.

Reuse validate-step.py for exact CurveOnSurface validity, native/export topology,
volume, and point classification. Add only independent surface area and bounds
of the already exported shape because the original OCCT tests assert area.
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

from OCP.BRepBndLib import BRepBndLib
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validator", required=True, type=Path)
    parser.add_argument("--points", required=True, type=Path)
    parser.add_argument("prefixes", nargs="+", type=Path)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("wonky_step_validator", args.validator)
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)
    requests, tolerance = validator.load_point_requests(args.points, args.prefixes)
    results = []
    for prefix in args.prefixes:
        try:
            result = validator.validate(prefix, requests[str(prefix.resolve())], tolerance, args.points)
            reader = STEPControl_Reader()
            if reader.ReadFile(str(prefix) + ".step") != IFSelect_RetDone or not reader.TransferRoots():
                raise ValueError("Supplemental STEP read failed")
            shape = reader.OneShape()
            area = GProp_GProps()
            BRepGProp.SurfaceProperties_s(shape, area, 1e-10, False)
            bounds = Bnd_Box()
            BRepBndLib.AddOptimal_s(shape, bounds, False, False)
            bounds.SetGap(0)
            low, high = bounds.CornerMin(), bounds.CornerMax()
            result.update(areaMm2=area.Mass(), boundsMm={"min": [low.X(), low.Y(), low.Z()],
                                                        "max": [high.X(), high.Y(), high.Z()]})
            result["supplementalMeasurements"] = {
                "surfaceArea": "BRepGProp.SurfaceProperties(adaptive, 1e-10)",
                "bounds": "BRepBndLib.AddOptimal(no triangulation, no shape tolerance), zero gap",
                "construction": "None: read and measure exported STEP only",
            }
            if validator.digest(str(prefix) + ".step") != result["pointClassification"]["stepSha256"]:
                raise ValueError("STEP changed during supplemental measurement")
            results.append(result)
        except Exception as error:
            results.append({"file": str(prefix) + ".step", "valid": False,
                            "error": {"name": type(error).__name__, "message": str(error)}})
    json.dump(results, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if all(result["valid"] for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
