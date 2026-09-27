"""Independent OCCT reference only; never a Wonky construction fallback."""
import hashlib
import json
from pathlib import Path
import runpy
import sys

from build123d import export_stl
from OCP.BRepCheck import BRepCheck_Analyzer

source, target = map(Path, sys.argv[1:3])
shape = runpy.run_path(str(source))["result"]
if not BRepCheck_Analyzer(shape.wrapped).IsValid():
    raise RuntimeError("Reference B-rep is invalid")
target.parent.mkdir(parents=True, exist_ok=True)
if not export_stl(shape, str(target), tolerance=0.01, angular_tolerance=0.1):
    raise RuntimeError("Reference STL export failed")
print(json.dumps({"volumeMm3": shape.volume, "solids": len(shape.solids()), "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "stlSha256": hashlib.sha256(target.read_bytes()).hexdigest(), "brepValid": True, "toleranceMm": 0.01, "angularToleranceRad": 0.1}))
