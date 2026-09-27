# /// script
# requires-python = ">=3.11"
# dependencies = ["build123d==0.13.0", "manifold3d==3.5.3", "numpy==2.5.3"]
# ///
"""Boolean bake-off TEST ORACLES (never production geometry).

Computes, for every case of fixtures/bakeoff/cases.json, two independent
references and writes them to fixtures/bakeoff/reference.json:

  occt      exact analytic CSG through OpenCascade (OCP, as shipped with
            build123d): volume, surface area, tight bounding box, number of
            solids and shells, BRepCheck validity. This is the geometry the
            tessellated fixtures approximate; a mesh result differs from it
            by at most (area x deviation) in volume.
  manifold  manifold3d Booleans of the SAME tessellated leaf meshes the
            prototypes receive (read from the job files, double precision via
            Mesh64, face tags passed as face_id): volume, area, genus,
            components, triangle count, bbox and per-tag area. This is the
            mesh-level reference an exact mesh Boolean must reproduce.

Neither result is ever fed back into a prototype. Jobs must exist first:
    node scripts/bakeoff/fixtures.mjs
    uv run scripts/bakeoff/reference.py [--cases id,...] [--out path]
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import struct
import sys
import time
from pathlib import Path

import numpy as np
import manifold3d
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakePolygon,
    BRepBuilderAPI_Transform,
)
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import (
    BRepPrimAPI_MakeBox,
    BRepPrimAPI_MakeCone,
    BRepPrimAPI_MakeCylinder,
    BRepPrimAPI_MakePrism,
    BRepPrimAPI_MakeSphere,
    BRepPrimAPI_MakeTorus,
)
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_SHELL, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.gp import gp_Pnt, gp_Trsf, gp_Vec

ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "fixtures/bakeoff/cases.json"
JOBS = ROOT / "fixtures/bakeoff/jobs"
OUT = ROOT / "fixtures/bakeoff/reference.json"
BREP_STEP = ROOT / "out/bakeoff/brep"


# ---------------------------------------------------------------------------
# Transforms: identical construction to scripts/bakeoff/tessellate.mjs
# (rotations in list order, then translation; exact cos/sin at quarter turns).

def cos_sin_deg(deg):
    q = ((deg % 360) + 360) % 360
    if q == 0:
        return 1.0, 0.0
    if q == 90:
        return 0.0, 1.0
    if q == 180:
        return -1.0, 0.0
    if q == 270:
        return 0.0, -1.0
    r = deg * math.pi / 180
    return math.cos(r), math.sin(r)


def axis_rotation(axis, deg):
    c, s = cos_sin_deg(deg)
    a = {"x": [1, 0, 0], "y": [0, 1, 0], "z": [0, 0, 1]}.get(axis, axis) if isinstance(axis, str) else axis
    n = math.sqrt(sum(v * v for v in a))
    x, y, z = (v / n for v in a)
    t = 1 - c
    return [
        [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
        [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
        [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ]


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def resolve_transform(t):
    R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    for r in (t or {}).get("rotate", []):
        R = mat_mul(axis_rotation(r["axis"], r["deg"]), R)
    tr = (t or {}).get("translate", [0, 0, 0])
    return R, tr


def place(shape, transform):
    R, tr = resolve_transform(transform)
    trsf = gp_Trsf()
    trsf.SetValues(R[0][0], R[0][1], R[0][2], tr[0], R[1][0], R[1][1], R[1][2], tr[1], R[2][0], R[2][1], R[2][2], tr[2])
    return BRepBuilderAPI_Transform(shape, trsf, True).Shape()


# ---------------------------------------------------------------------------
# (a) exact analytic CSG through OCCT

def occt_leaf(leaf):
    p = leaf["params"]
    kind = leaf["prim"]
    if kind == "box":
        shape = BRepPrimAPI_MakeBox(gp_Pnt(*p["min"]), gp_Pnt(*p["max"])).Shape()
    elif kind == "cylinder":
        shape = BRepPrimAPI_MakeCylinder(p["radius"], p["height"]).Shape()
    elif kind == "cone":
        shape = BRepPrimAPI_MakeCone(p["r1"], p["r2"], p["height"]).Shape()
    elif kind == "sphere":
        shape = BRepPrimAPI_MakeSphere(p["radius"]).Shape()
    elif kind == "torus":
        shape = BRepPrimAPI_MakeTorus(p["major"], p["minor"]).Shape()
    elif kind == "brep":
        # Frozen exact B-rep, serialized by the kernel's STEP writer
        # (node scripts/bakeoff/brep-step.mjs); placed as stored.
        stem = Path(p["source"]).name.removesuffix(".gz").removesuffix(".json")
        path = BREP_STEP / f"{stem}-body{p['body']}.step"
        if not path.exists():
            raise FileNotFoundError(f"{path} missing; run node scripts/bakeoff/brep-step.mjs")
        reader = STEPControl_Reader()
        if reader.ReadFile(str(path)) != IFSelect_RetDone or not reader.TransferRoots():
            raise RuntimeError(f"OCCT could not read {path}")
        shape = reader.OneShape()
        if not BRepCheck_Analyzer(shape).IsValid():
            raise RuntimeError(f"OCCT reports {path.name} invalid")
        return shape
    elif kind == "prism":
        poly = BRepBuilderAPI_MakePolygon()
        for x, y in p["points"]:
            poly.Add(gp_Pnt(x, y, 0))
        poly.Close()
        face = BRepBuilderAPI_MakeFace(poly.Wire(), True).Face()
        shape = BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, p["height"])).Shape()
    else:
        raise ValueError(f"unknown primitive {kind}")
    return place(shape, leaf.get("transform"))


def occt_tree(node):
    if "prim" in node:
        return occt_leaf(node)
    a = occt_tree(node["children"][0])
    b = occt_tree(node["children"][1])
    algo = {"union": BRepAlgoAPI_Fuse, "subtract": BRepAlgoAPI_Cut, "intersect": BRepAlgoAPI_Common}[node["op"]](a, b)
    if not algo.IsDone():
        raise RuntimeError(f"OCCT {node['op']} failed")
    return algo.Shape()


def count(shape, kind):
    n = 0
    ex = TopExp_Explorer(shape, kind)
    while ex.More():
        n += 1
        ex.Next()
    return n


def occt_reference(case):
    t0 = time.perf_counter()
    shape = occt_tree(case["csg"])
    vp = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, vp)
    sp = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape, sp)
    solids = count(shape, TopAbs_SOLID)
    out = {
        "volume": vp.Mass(),
        "area": sp.Mass(),
        "solids": solids,
        "shells": count(shape, TopAbs_SHELL),
        "valid": bool(BRepCheck_Analyzer(shape).IsValid()),
        "bbox": None,
    }
    if solids:
        box = Bnd_Box()
        BRepBndLib.AddOptimal_s(shape, box, False, False)
        lo, hi = box.CornerMin(), box.CornerMax()
        out["bbox"] = {"min": [lo.X(), lo.Y(), lo.Z()], "max": [hi.X(), hi.Y(), hi.Z()]}
    out["ms"] = (time.perf_counter() - t0) * 1000
    return out


# ---------------------------------------------------------------------------
# (b) manifold3d on the tessellated fixture meshes

def f32(word):
    return struct.unpack("<f", struct.pack("<I", int(word)))[0]


class Tokens:
    def __init__(self, text):
        self.words = text.split()
        self.i = 0

    def word(self):
        w = self.words[self.i]
        self.i += 1
        return w

    def expect(self, w):
        got = self.word()
        if got != w:
            raise ValueError(f"expected {w!r}, got {got!r}")

    def u32(self):
        return int(self.word())

    def real(self):
        # hi + lo of two F32 values is exact in a double.
        return f32(self.word()) + f32(self.word())


SURFACE_REALS = {"plane": 9, "cylinder": 10, "cone": 11, "sphere": 4, "torus": 8}


def decode_job(text):
    tok = Tokens(text)
    tok.expect("wonky-bakeoff-job")
    tok.expect("1")
    tok.expect("case")
    case_id = tok.word()
    tok.expect("deviation")
    deviation = tok.real()
    tok.expect("nodes")
    nodes = [None] * tok.u32()
    for i in range(len(nodes)):
        w = tok.word()
        nodes[i] = ("leaf", tok.u32()) if w == "leaf" else (w,)
    tok.expect("prims")
    for _ in range(tok.u32()):
        tok.expect("prim")
        tok.word()
        k = tok.u32()
        for _ in range(2 * (k + 12)):
            tok.word()
    tok.expect("faces")
    nf = tok.u32()
    for _ in range(nf):
        tok.expect("face")
        tok.u32()
        tok.u32()
        kind = tok.word()
        for _ in range(2 * SURFACE_REALS[kind]):
            tok.word()
    tok.expect("meshes")
    meshes = {}
    for _ in range(tok.u32()):
        tok.expect("mesh")
        leaf, nv, nt = tok.u32(), tok.u32(), tok.u32()
        verts = np.array([tok.real() for _ in range(3 * nv)], dtype=np.float64).reshape(nv, 3)
        tris = np.array([tok.u32() for _ in range(4 * nt)], dtype=np.uint32).reshape(nt, 4)
        meshes[leaf] = (verts, tris)
    tok.expect("end")

    pos = [0]

    def tree():
        n = nodes[pos[0]]
        pos[0] += 1
        if n[0] == "leaf":
            return {"leaf": n[1]}
        a = tree()
        b = tree()
        return {"op": n[0], "children": [a, b]}

    return {"id": case_id, "deviation": deviation, "tree": tree(), "faces": nf, "meshes": meshes}


def manifold_leaf(verts, tris):
    mesh = manifold3d.Mesh64(
        vert_properties=np.ascontiguousarray(verts, dtype=np.float64),
        tri_verts=np.ascontiguousarray(tris[:, :3], dtype=np.uint32),
        face_id=np.ascontiguousarray(tris[:, 3], dtype=np.uint32),
    )
    m = manifold3d.Manifold(mesh)
    status = m.status()
    if str(status) not in ("Error.NoError", "NoError"):
        raise RuntimeError(f"manifold rejected a fixture leaf: {status}")
    return m


def manifold_tree(node, leaves):
    if "leaf" in node:
        return leaves[node["leaf"]]
    a = manifold_tree(node["children"][0], leaves)
    b = manifold_tree(node["children"][1], leaves)
    if node["op"] == "union":
        return a + b
    if node["op"] == "subtract":
        return a - b
    return a ^ b


def encode_real(x):
    x = float(x) + 0.0  # no negative zero on the wire
    hi = struct.unpack("<f", struct.pack("<f", x))[0]
    lo = struct.unpack("<f", struct.pack("<f", x - hi))[0]
    return f"{struct.unpack('<I', struct.pack('<f', hi))[0]} {struct.unpack('<I', struct.pack('<f', lo))[0]}"


def result_text(m):
    """The manifold result in the bake-off result format (tags = face_id).
    Used only to cross-check the validator against an independent engine;
    vertices are rounded to F32x2 (~1e-14 relative)."""
    if m.is_empty():
        return "ok\nmesh 0 0\nend\n"
    mesh = m.to_mesh64()
    v = np.asarray(mesh.vert_properties)[:, :3]
    t = np.asarray(mesh.tri_verts)
    fid = np.asarray(mesh.face_id)
    lines = ["ok", f"mesh {len(v)} {len(t)}"]
    lines += [" ".join(encode_real(c) for c in p) for p in v]
    lines += [f"{a} {b} {c} {int(f)}" for (a, b, c), f in zip(t, fid)]
    lines.append("end")
    return "\n".join(lines) + "\n"


def manifold_reference(job, dump=None):
    t0 = time.perf_counter()
    leaves = {leaf: manifold_leaf(v, t) for leaf, (v, t) in job["meshes"].items()}
    m = manifold_tree(job["tree"], leaves)
    if dump is not None:
        dump.write_text(result_text(m))
    out = {
        "volume": m.volume(),
        "area": m.surface_area(),
        "genus": m.genus(),
        "components": len(m.decompose()) if not m.is_empty() else 0,
        "triangles": m.num_tri(),
        "vertices": m.num_vert(),
        "empty": bool(m.is_empty()),
        "bbox": None,
        "tagArea": {},
    }
    if not m.is_empty():
        b = m.bounding_box()
        out["bbox"] = {"min": list(b[:3]), "max": list(b[3:])}
        mesh = m.to_mesh64()
        v = np.asarray(mesh.vert_properties)[:, :3]
        t = np.asarray(mesh.tri_verts)
        fid = np.asarray(mesh.face_id)
        a = 0.5 * np.linalg.norm(np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]]), axis=1)
        for tag in np.unique(fid):
            out["tagArea"][str(int(tag))] = float(a[fid == tag].sum())
    out["ms"] = (time.perf_counter() - t0) * 1000
    return out


# ---------------------------------------------------------------------------

def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default="")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--dump", default="", help="also write each manifold result as <dir>/<case>.result (validator cross-check)")
    args = ap.parse_args()
    cases = json.loads(CASES.read_text())["cases"]
    only = [c for c in args.cases.split(",") if c]
    if only:
        known = {c["id"] for c in cases}
        missing = [c for c in only if c not in known]
        if missing:
            sys.exit(f"unknown case(s): {missing}")
        cases = [c for c in cases if c["id"] in only]
    out_path = Path(args.out)
    dump_dir = Path(args.dump) if args.dump else None
    if dump_dir:
        dump_dir.mkdir(parents=True, exist_ok=True)
    previous = json.loads(out_path.read_text())["cases"] if out_path.exists() else {}
    results = dict(previous) if only else {}
    for case in cases:
        sidecar = json.loads((JOBS / f"{case['id']}.json").read_text())
        job_path = ROOT / sidecar["job"]
        if not job_path.exists() or sha256(job_path) != sidecar["jobSha256"]:
            sys.exit(f"{case['id']}: job missing or stale; run node scripts/bakeoff/fixtures.mjs first")
        entry = {"jobSha256": sidecar["jobSha256"], "deviationMm": case["deviationMm"]}
        try:
            entry["occt"] = occt_reference(case)
        except Exception as err:  # recorded, never hidden
            entry["occt"] = {"error": f"{type(err).__name__}: {err}"}
        try:
            entry["manifold"] = manifold_reference(decode_job(job_path.read_text()), dump_dir / f"{case['id']}.result" if dump_dir else None)
        except Exception as err:
            entry["manifold"] = {"error": f"{type(err).__name__}: {err}"}
        results[case["id"]] = entry
        o, m = entry["occt"], entry["manifold"]
        print(
            f"{case['id']:28s} occt V={o.get('volume', float('nan')):.6f} solids={o.get('solids')} valid={o.get('valid')}"
            f" | manifold V={m.get('volume', float('nan')):.6f} genus={m.get('genus')} comps={m.get('components')} tris={m.get('triangles')}",
            flush=True,
        )
    doc = {
        "schema": "wonky-bakeoff-reference/1",
        "generator": "uv run scripts/bakeoff/reference.py",
        "role": "independent test oracle; never production geometry",
        "tools": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "build123d": importlib.metadata.version("build123d"),
            "cadquery-ocp-novtk": importlib.metadata.version("cadquery-ocp-novtk") if _has("cadquery-ocp-novtk") else None,
            "manifold3d": importlib.metadata.version("manifold3d"),
            "numpy": importlib.metadata.version("numpy"),
        },
        "notes": {
            "occt": "exact analytic CSG (BRepPrimAPI + BRepAlgoAPI, fuzzy value 0); volume/area from BRepGProp; bbox from BRepBndLib.AddOptimal",
            "manifold": "manifold3d Booleans of the fixture leaf meshes (Mesh64, face_id = job tag); genus/components of the result mesh; tagArea = result area per tag",
        },
        "cases": {k: results[k] for k in sorted(results)},
    }
    out_path.write_text(json.dumps(doc, indent=1) + "\n")
    print(f"wrote {out_path}")


def _has(dist):
    try:
        importlib.metadata.version(dist)
        return True
    except importlib.metadata.PackageNotFoundError:
        return False


if __name__ == "__main__":
    main()
