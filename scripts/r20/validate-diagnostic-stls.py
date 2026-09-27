"""Independently load every refusal STL; oracle only, never builds geometry.

Run with uv run --no-project --with trimesh==4.8.3 --with numpy==2.3.3
--python <reference-venv>/bin/python this.py <out/feed>.
The real RACK artifacts own this acceptance, not synthetic kernel mocks.
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import trimesh

root = Path(sys.argv[1]).resolve()
error = json.loads((root / "error.json").read_text())
record_file = root / error["dump"]
record = json.loads(record_file.read_text())
gap = float(re.search(r"come within ([\d.eE+-]+) mm", error["message"])[1])
assert record["refusal"]["gapMm"] == gap == 0.0056079486
bodies = {body["stl"]: body for body in record["inputs"] + record["studio"]}
assert len(bodies) == 6
for stl, body in bodies.items():
    assert stl and "stlRefusal" not in body
    path = record_file.parent / stl
    mesh = trimesh.load(path, force="mesh", process=True)
    assert isinstance(mesh, trimesh.Trimesh), str(path)
    assert len(mesh.faces) > 0 and np.isfinite(mesh.vertices).all(), str(path)
    assert mesh.is_watertight and mesh.is_winding_consistent, str(path)
    assert mesh.volume > 0, str(path)
    bounds = body["bboxMm"]
    assert bounds and np.isfinite([bounds["min"], bounds["max"]]).all(), str(path)
    if body["bboxBasis"].startswith("diagnostic STL"):
        assert np.allclose(mesh.bounds, [bounds["min"], bounds["max"]], rtol=0, atol=1e-12)
    print(f"PASS {path}: {len(mesh.faces)} triangles, volume {mesh.volume:.12g} mm3, watertight")
print(f"PASS RACK gap matches error.json exactly: {gap} mm; {len(bodies)} STLs independently loaded")
