"""Recover fillet/chamfer configurations from a POST-blend STEP (secondary source).

    uv run --no-project --offline --with build123d==0.13.0 python scripts/fillet/step_blends.py \
        <file.step> <out.json> --fillet 2,4.2 --chamfer 0.42

Used where neither wonky nor an oracle can build a corpus part up to its blend:
the part's exported STEP (Onshape or build123d) already contains the blend faces.
Reconstruction (INFERRED, measurement with OCP only):

fillet faces for radius r (tol 1e-3 mm):
  cylinder radius r, torus minor radius r, sphere radius r, bounded by >= 2 G1
  ("smooth", |alpha-180| < 1 deg) edges, and not a full revolution (a hole or a
  boss is never a blend). A cylinder blend stands for a straight edge, a torus
  blend for a circular edge, a sphere for a 3-edge corner patch. B-spline faces
  touching >= 2 blend faces along G1 edges are corner/setback patches.
  Per blend face: supports = the non-blend faces across its G1 rails; convexity
  from the face orientation (material on the axis side = convex); original
  dihedral alpha = 180 - span (convex) or 180 + span (concave); ends: neighbour
  across a non-rail edge = another blend face (chain / corner) or a cap face
  (free end; perpendicular if the cap normal is parallel to the spine).
chamfer faces for width w (equal offsets): planar faces with two boundary lines
  whose neighbour dihedrals are equal (beta) with alpha = 2*(beta-90) and whose
  width is 2*w*sin(alpha/2) (tol 2e-3 mm); conical faces for circular rims.
"""
import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from OCP.BRep import BRep_Tool  # noqa: E402
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface  # noqa: E402
from OCP.gp import gp_Pnt, gp_Vec  # noqa: E402
from OCP.IFSelect import IFSelect_RetDone  # noqa: E402
from OCP.STEPControl import STEPControl_Reader  # noqa: E402
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED, TopAbs_SOLID  # noqa: E402
from OCP.TopExp import TopExp_Explorer  # noqa: E402

import edge_config as ec  # noqa: E402

_solid = getattr(ec.TopoDS, "Solid_s", None) or ec.TopoDS.Solid


def read(path):
    r = STEPControl_Reader()
    if r.ReadFile(path) != IFSelect_RetDone:
        raise RuntimeError("cannot read " + path)
    r.TransferRoots()
    return r.OneShape()


def solids(shape):
    ex = TopExp_Explorer(shape, TopAbs_SOLID)
    while ex.More():
        yield _solid(ex.Current())
        ex.Next()


def face_edges(topo, f):
    out = []
    ex = TopExp_Explorer(f, TopAbs_EDGE)
    while ex.More():
        e = ec._edge(ex.Current())
        if not BRep_Tool.Degenerated_s(e) and not any(e.IsSame(g) for g in out):
            out.append(e)
        ex.Next()
    return out


def other_face(topo, e, f):
    fs = [g for g in topo.faces_of_edge(e) if not g.IsSame(f)]
    return fs[0] if fs else None


def edge_alpha(topo, e):
    faces = topo.faces_of_edge(e)
    if len(faces) != 2:
        return None
    ci, c = ec.curve_info(e)
    L = ec.edge_length(c) or 1.0
    eps = max(1e-4, min(0.02, L * 1e-3))
    s = ec.dihedral_at(topo, e, faces, c, ci["first"] + 0.5 * (ci["last"] - ci["first"]), eps)
    return None if s is None else s["alpha"]


def mid(c):
    p = gp_Pnt()
    c.D0(0.5 * (c.FirstParameter() + c.LastParameter()), p)
    return (p.X(), p.Y(), p.Z())


def analyse_solid(sh, fillets, chamfers, tol=1e-3):
    topo = ec.Topo(sh)
    nf = topo.fmap.Extent()
    faces = [ec._face(topo.fmap.FindKey(i)) for i in range(1, nf + 1)]
    info = [ec.surf_info(f) for f in faces]
    # --- candidate fillet faces
    blend = {}
    for i, (f, si) in enumerate(zip(faces, info), start=1):
        t = si["type"]
        r = None
        ad = BRepAdaptor_Surface(f)
        if t == "cylinder":
            r = si["radius"]
        elif t == "torus":
            r = si["minor"]
        elif t == "sphere":
            r = si["radius"]
        if r is None:
            continue
        hit = [R for R in fillets if abs(R - r) < tol]
        if not hit:
            continue
        # full revolution -> hole/boss, not a blend
        if t == "cylinder" and (ad.LastUParameter() - ad.FirstUParameter()) > math.pi * 1.5:
            continue
        if t == "torus" and (ad.LastVParameter() - ad.FirstVParameter()) > math.pi * 1.5:
            continue
        smooth, sharp = [], []
        for e in face_edges(topo, f):
            a = edge_alpha(topo, e)
            (smooth if (a is not None and abs(a - 180.0) < 1.0) else sharp).append(e)
        if len(smooth) < (1 if t == "sphere" else 2):
            continue
        blend[i] = {"face": i, "surface": t, "radius": hit[0], "smooth": smooth, "sharp": sharp}
    # corner patches: non-blend faces touching >= 2 blend faces along G1 edges
    patches = {}
    for i, f in enumerate(faces, start=1):
        if i in blend:
            continue
        g1_blend = set()
        for e in face_edges(topo, f):
            o = other_face(topo, e, f)
            if o is None:
                continue
            j = topo.fmap.FindIndex(o)
            if j in blend:
                a = edge_alpha(topo, e)
                if a is not None and abs(a - 180.0) < 1.0:
                    g1_blend.add(j)
        if len(g1_blend) >= 2 and info[i - 1]["type"] not in ("plane",):
            patches[i] = {"face": i, "surface": info[i - 1]["type"], "blends": sorted(g1_blend)}
    # --- per blend face reconstruction
    recs = []
    for i, b in blend.items():
        f = faces[i - 1]
        si = info[i - 1]
        supports, ends = [], []
        for e in b["smooth"]:
            o = other_face(topo, e, f)
            j = topo.fmap.FindIndex(o) if o is not None else 0
            if j in blend or j in patches:
                ends.append(("blend" if j in blend else "patch:" + patches[j]["surface"], j, "g1"))
            else:
                supports.append((j, info[j - 1]["type"], e))
        for e in b["sharp"]:
            o = other_face(topo, e, f)
            j = topo.fmap.FindIndex(o) if o is not None else 0
            ends.append(("blend" if j in blend else ("patch:" + patches[j]["surface"] if j in patches else "cap:" + info[j - 1]["type"]), j, "sharp", e))
        rec = {"face": i, "surface": si["type"], "radius": b["radius"], "supports": sorted(s[1] for s in supports)}
        if si["type"] in ("cylinder", "torus"):
            # convexity: outward normal vs direction away from the axis
            c = BRepAdaptor_Curve(b["smooth"][0])
            p = mid(c)
            n, _ = topo.normal(f, p)
            if si["type"] == "cylinder":
                o, ax = si["origin"], si["axis"]
                v = ec._sub(p, o)
                radial = ec._sub(v, tuple(ax[k] * ec._dot(v, ax) for k in range(3)))
            else:
                ad = BRepAdaptor_Surface(f)
                tor = ad.Torus()
                cen = ec._v(tor.Location())
                ax = (tor.Axis().Direction().X(), tor.Axis().Direction().Y(), tor.Axis().Direction().Z())
                v = ec._sub(p, cen)
                inplane = ec._sub(v, tuple(ax[k] * ec._dot(v, ax) for k in range(3)))
                ring = tuple(ec._unit(inplane)[k] * tor.MajorRadius() for k in range(3))
                radial = ec._sub(v, ring)
            convex = n is not None and ec._dot(n, radial) > 0
            ad = BRepAdaptor_Surface(f)
            span = math.degrees(ad.LastUParameter() - ad.FirstUParameter()) if si["type"] == "cylinder" else math.degrees(ad.LastVParameter() - ad.FirstVParameter())
            rec["convexity"] = "convex" if convex else "concave"
            rec["alphaDeg"] = round(180 - span if convex else 180 + span, 3)
            spine = "line" if si["type"] == "cylinder" else "circle"
            rec["relation"] = f"{spine}:" + "/".join(rec["supports"])
            # ends
            caps = []
            for kind, j, cont, *rest in ends:
                if kind.startswith("cap:") and rest:
                    cf = faces[j - 1]
                    q = mid(BRepAdaptor_Curve(rest[0]))
                    nn, _ = topo.normal(cf, q)
                    perp = None
                    if nn is not None and si["type"] == "cylinder":
                        a = ec._ang(nn, si["axis"])
                        perp = min(a, 180 - a) < 1.0
                    caps.append({"cap": kind[4:], "perpendicular": perp})
            rec["ends"] = [e[0] + "/" + e[2] for e in ends]
            rec["caps"] = caps
        elif si["type"] == "sphere":
            rec["relation"] = "corner:sphere"
            rec["neighbourBlends"] = sum(1 for e in ends if e[0] == "blend")
        recs.append(rec)
    # --- chamfers
    chs = []
    for i, (f, si) in enumerate(zip(faces, info), start=1):
        if si["type"] != "plane" or not chamfers:
            continue
        lines = []
        for e in face_edges(topo, f):
            ci, c = ec.curve_info(e)
            if ci["type"] != "line":
                continue
            a = edge_alpha(topo, e)
            if a is None or a >= 180:
                continue
            lines.append((e, ci, c, a))
        found = None
        for x in range(len(lines)):
            for y in range(x + 1, len(lines)):
                e1, c1, cc1, a1 = lines[x]
                e2, c2, cc2, a2 = lines[y]
                if ec._ang(c1["direction"], c2["direction"]) > 0.5 and ec._ang(c1["direction"], c2["direction"]) < 179.5:
                    continue
                if abs(a1 - a2) > 0.5:
                    continue
                alpha = 2 * (a1 - 90.0)
                if alpha <= 0:
                    continue
                p1 = mid(cc1)
                d = ec._sub(mid(cc2), p1)
                u = ec._unit(c1["direction"])
                perp = ec._norm(ec._sub(d, tuple(u[k] * ec._dot(d, u) for k in range(3))))
                for w in chamfers:
                    if abs(perp - 2 * w * math.sin(math.radians(alpha / 2))) < 2e-3:
                        found = {"face": i, "width": w, "alphaDeg": round(alpha, 3), "relation": "line:plane/plane",
                                 "neighbours": sorted({ec.surf_type(other_face(topo, e1, f)), ec.surf_type(other_face(topo, e2, f))})}
                        break
                if found:
                    break
            if found:
                break
        if found:
            chs.append(found)
    for i, (f, si) in enumerate(zip(faces, info), start=1):
        if si["type"] != "cone" or not chamfers:
            continue
        if abs(abs(si["halfAngleDeg"]) - 45) < 0.5:
            chs.append({"face": i, "width": None, "relation": "circle:cone45", "halfAngleDeg": si["halfAngleDeg"]})
    return {"faces": nf, "fillets": recs, "patches": list(patches.values()), "chamfers": chs}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("step")
    ap.add_argument("out")
    ap.add_argument("--fillet", default="")
    ap.add_argument("--chamfer", default="")
    a = ap.parse_args()
    fil = [float(x) for x in a.fillet.split(",") if x]
    cha = [float(x) for x in a.chamfer.split(",") if x]
    shape = read(a.step)
    res = []
    for k, s in enumerate(solids(shape)):
        try:
            r = analyse_solid(s, fil, cha)
        except Exception as err:
            r = {"error": f"{type(err).__name__}: {err}"}
        r["solid"] = k
        res.append(r)
    json.dump({"step": a.step, "fillet": fil, "chamfer": cha, "solids": res}, open(a.out, "w"), indent=1)
    print(json.dumps({"step": os.path.basename(a.step), "solids": len(res),
                      "fillets": sum(len(r.get("fillets", [])) for r in res),
                      "patches": sum(len(r.get("patches", [])) for r in res),
                      "chamfers": sum(len(r.get("chamfers", [])) for r in res)}))


if __name__ == "__main__":
    main()
