# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["cadquery-ocp==8.0.1.0.0"]
# ///
"""Measure volume and bounding box of STEP/STL files (OpenCascade as an oracle only).

Usage: uv run scripts/corpus/measure.py < paths.json > measurements.json
Input: JSON list of absolute paths. Output: JSON map path -> measurement.
STEP: OCP STEPControl_Reader, BRepGProp volume per solid (summed), BRepBndLib optimal bbox.
STL:  pure-Python binary/ASCII parse, signed tetrahedron volume, vertex bbox.
Never writes next to the inputs.
"""
import json
import math
import struct
import sys


def measure_step(path):
    from OCP.STEPControl import STEPControl_Reader
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID, TopAbs_FACE, TopAbs_EDGE

    reader = STEPControl_Reader()
    if reader.ReadFile(path) != IFSelect_RetDone:
        return {"error": "STEP read failed"}
    reader.TransferRoots()
    shape = reader.OneShape()
    volume, solids = 0.0, 0
    it = TopExp_Explorer(shape, TopAbs_SOLID)
    while it.More():
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(it.Current(), props)
        volume += abs(props.Mass())
        solids += 1
        it.Next()
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    if box.IsVoid():
        bbox = None
    else:
        lo, hi = box.CornerMin(), box.CornerMax()
        bbox = {"min": [lo.X(), lo.Y(), lo.Z()], "max": [hi.X(), hi.Y(), hi.Z()]}
    counts = {}
    for name, kind in (("faces", TopAbs_FACE), ("edges", TopAbs_EDGE)):
        buckets = {}
        ex = TopExp_Explorer(shape, kind)
        while ex.More():
            cur = ex.Current()
            bucket = buckets.setdefault(hash(cur), [])
            if not any(cur.IsSame(prev) for prev in bucket):
                bucket.append(cur)
            ex.Next()
        counts[name] = sum(len(b) for b in buckets.values())
    return {"kind": "step", "solids": solids, "volumeMm3": volume, "bboxMm": bbox, **counts}


def measure_stl(path):
    with open(path, "rb") as f:
        data = f.read()
    tris = []
    ascii_head = data[:5].lower() == b"solid" and b"facet" in data[:2000]
    if not ascii_head and len(data) >= 84:
        n = struct.unpack_from("<I", data, 80)[0]
        if 84 + n * 50 == len(data):
            for i in range(n):
                v = struct.unpack_from("<12f", data, 84 + i * 50)
                tris.append((v[3:6], v[6:9], v[9:12]))
        else:
            ascii_head = True
    if ascii_head:
        pts = []
        for line in data.decode("utf-8", "replace").splitlines():
            s = line.strip().split()
            if s and s[0] == "vertex":
                pts.append(tuple(float(x) for x in s[1:4]))
        tris = [tuple(pts[i:i + 3]) for i in range(0, len(pts) - 2, 3)]
    if not tris:
        return {"error": "empty STL"}
    vol = 0.0
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for a, b, c in tris:
        vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6.0
        for p in (a, b, c):
            for k in range(3):
                lo[k] = min(lo[k], p[k])
                hi[k] = max(hi[k], p[k])
    return {"kind": "stl", "triangles": len(tris), "volumeMm3": abs(vol), "bboxMm": {"min": lo, "max": hi}}


def main():
    paths = json.load(sys.stdin)
    out = {}
    for p in paths:
        try:
            out[p] = measure_step(p) if p.lower().endswith((".step", ".stp")) else measure_stl(p)
        except Exception as e:  # recorded per file; the caller never treats this as agreement
            out[p] = {"error": f"{type(e).__name__}: {e}"}
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
