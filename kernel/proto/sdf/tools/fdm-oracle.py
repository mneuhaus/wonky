# /// script
# requires-python = ">=3.11"
# dependencies = ["build123d==0.13.0", "manifold3d==3.5.3", "numpy==2.5.3"]
# ///
"""TEST ORACLE for the sdf prototype's FDM analyses (never production geometry).

OpenCascade volumes of: face-wise offsets with intersection joins (the same
mitered offset as the prototype's f - r), closed shells (solid minus its
inward intersection-join offset), and the interference (common) of the root
node's two operands. The CSG is built with scripts/bakeoff/reference.py.

    uv run kernel/proto/sdf/tools/fdm-oracle.py   (writes tmp/sdf/fdm-oracle.json)
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts/bakeoff"))
import reference as ref  # noqa: E402

from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut  # noqa: E402
from OCP.BRepGProp import BRepGProp  # noqa: E402
from OCP.BRepOffset import BRepOffset_Skin  # noqa: E402
from OCP.BRepOffsetAPI import BRepOffsetAPI_MakeOffsetShape  # noqa: E402
from OCP.GeomAbs import GeomAbs_Intersection  # noqa: E402
from OCP.GProp import GProp_GProps  # noqa: E402


def volume(shape):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def offset(shape, r):
    mk = BRepOffsetAPI_MakeOffsetShape()
    mk.PerformByJoin(shape, r, 1e-7, BRepOffset_Skin, False, False, GeomAbs_Intersection, False)
    if not mk.IsDone():
        raise RuntimeError("offset failed")
    return mk.Shape()


def main():
    cases = {c["id"]: c for c in json.loads((ROOT / "fixtures/bakeoff/cases.json").read_text())["cases"]}
    out = {}
    demos = [("offset", "plate-through-hole", 0.3), ("offset", "enclosure-shell", -0.2),
             ("shell", "box-union-overlap", 2.0), ("shell", "leaf-cylinder", 1.0),
             ("interference", "box-union-overlap", None), ("interference", "steinmetz-union", None)]
    for op, cid, p in demos:
        csg = cases[cid]["csg"]
        try:
            if op == "offset":
                v = volume(offset(ref.occt_tree(csg), p))
            elif op == "shell":
                solid = ref.occt_tree(csg)
                v = volume(BRepAlgoAPI_Cut(solid, offset(ref.occt_tree(csg), -p)).Shape())
            else:
                a, b = csg["children"]
                v = volume(BRepAlgoAPI_Common(ref.occt_tree(a), ref.occt_tree(b)).Shape())
            out[f"{op}:{cid}"] = {"param": p, "occtVolume": v}
        except Exception as e:  # report, never guess
            out[f"{op}:{cid}"] = {"param": p, "error": str(e)}
        print(op, cid, p, out[f"{op}:{cid}"])
    (ROOT / "tmp/sdf/fdm-oracle.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
