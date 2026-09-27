"""Geometric configuration of the edges a fillet/chamfer call selects.

Measurement only (OCP/OCCT as an oracle, never as wonky geometry). Given the solid
BEFORE the blend and the selected edges, report per edge:

  curve        line / circle / ellipse / bspline / ...
  faces        surface types of the two adjacent faces (plane/cylinder/cone/...)
  dihedral     material wedge angle alpha at 3 samples (0.1/0.5/0.9 of the range):
               alpha < 180 convex, > 180 concave, ~180 smooth (G1, degenerate blend)
  convexity    convex / concave / smooth / mixed (varies along the edge)
  relation     for circles: rim of a cylinder (axis || plane normal, circle is a
               cross-section) etc.; for lines on cylinders: generator
  widths       distance from the edge midpoint across each adjacent face to the face
               boundary (marched along the in-face normal direction, projected onto
               the surface; approximate for curved faces) and size/width
and per end vertex (deduplicated): valence, selected incident edges, tangent
continuity between selected edges (chains), mixed convexity, and for free ends
whether the capping face is perpendicular to the edge.

Pure function of (TopoDS_Shape, [TopoDS_Edge], size, kind); used by the build123d
probe, the fsocct probe, the STEP-based analysis and the wonky brep analysis.
"""
import math

from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.BRepLProp import BRepLProp_SLProps
from OCP.GeomAbs import (GeomAbs_BezierCurve, GeomAbs_BezierSurface, GeomAbs_BSplineCurve,
                         GeomAbs_BSplineSurface, GeomAbs_Circle, GeomAbs_Cone, GeomAbs_Cylinder,
                         GeomAbs_Ellipse, GeomAbs_Hyperbola, GeomAbs_Line, GeomAbs_OffsetCurve,
                         GeomAbs_OffsetSurface, GeomAbs_OtherCurve, GeomAbs_OtherSurface,
                         GeomAbs_Parabola, GeomAbs_Plane, GeomAbs_Sphere,
                         GeomAbs_SurfaceOfExtrusion, GeomAbs_SurfaceOfRevolution, GeomAbs_Torus)
from OCP.gp import gp_Pnt, gp_Pnt2d, gp_Vec
from OCP.ShapeAnalysis import ShapeAnalysis_Surface
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_IN, TopAbs_ON, TopAbs_REVERSED, TopAbs_VERTEX
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS
try:  # OCP 7.7 names
    from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape, TopTools_IndexedMapOfShape
except ImportError:  # OCP 7.8+ (cadquery-ocp >= 7.8 exposes NCollection templates here)
    from OCP.collections import (
        IndexedDataMap_TopoDS_Shape_List_TopoDS_Shape_TopTools_ShapeMapHasher as TopTools_IndexedDataMapOfShapeListOfShape,
        IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher as TopTools_IndexedMapOfShape)

_edge = getattr(TopoDS, "Edge_s", None) or TopoDS.Edge
_face = getattr(TopoDS, "Face_s", None) or TopoDS.Face
_vertex = getattr(TopoDS, "Vertex_s", None) or TopoDS.Vertex

CURVE = {GeomAbs_Line: "line", GeomAbs_Circle: "circle", GeomAbs_Ellipse: "ellipse",
         GeomAbs_Hyperbola: "hyperbola", GeomAbs_Parabola: "parabola", GeomAbs_BezierCurve: "bezier",
         GeomAbs_BSplineCurve: "bspline", GeomAbs_OffsetCurve: "offset", GeomAbs_OtherCurve: "other"}
SURF = {GeomAbs_Plane: "plane", GeomAbs_Cylinder: "cylinder", GeomAbs_Cone: "cone",
        GeomAbs_Sphere: "sphere", GeomAbs_Torus: "torus", GeomAbs_BezierSurface: "bezier",
        GeomAbs_BSplineSurface: "bspline", GeomAbs_SurfaceOfRevolution: "revolution",
        GeomAbs_SurfaceOfExtrusion: "extrusion", GeomAbs_OffsetSurface: "offset",
        GeomAbs_OtherSurface: "other"}

SMOOTH_DEG = 1.0      # |alpha - 180| below this: tangent (G1) edge
TANGENT_DEG = 1.0     # chain continuity at a vertex
PERP_DEG = 1.0        # cap face perpendicular to the edge


def _v(p):
    return (p.X(), p.Y(), p.Z())


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(a, b, s=1.0):
    return (a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a):
    return math.sqrt(_dot(a, a))


def _unit(a):
    n = _norm(a)
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-15 else (0.0, 0.0, 0.0)


def _ang(a, b):
    c = max(-1.0, min(1.0, _dot(_unit(a), _unit(b))))
    return math.degrees(math.acos(c))


class Topo:
    def __init__(self, shape):
        self.shape = shape
        self.emap = TopTools_IndexedMapOfShape()
        TopExp.MapShapes_s(shape, TopAbs_EDGE, self.emap)
        self.fmap = TopTools_IndexedMapOfShape()
        TopExp.MapShapes_s(shape, TopAbs_FACE, self.fmap)
        self.vmap = TopTools_IndexedMapOfShape()
        TopExp.MapShapes_s(shape, TopAbs_VERTEX, self.vmap)
        self.e2f = TopTools_IndexedDataMapOfShapeListOfShape()
        TopExp.MapShapesAndAncestors_s(shape, TopAbs_EDGE, TopAbs_FACE, self.e2f)
        self.v2e = TopTools_IndexedDataMapOfShapeListOfShape()
        TopExp.MapShapesAndAncestors_s(shape, TopAbs_VERTEX, TopAbs_EDGE, self.v2e)
        self.v2f = TopTools_IndexedDataMapOfShapeListOfShape()
        TopExp.MapShapesAndAncestors_s(shape, TopAbs_VERTEX, TopAbs_FACE, self.v2f)
        self._sas = {}

    def faces_of_edge(self, e):
        out = []
        if not self.e2f.Contains(e):
            return out
        for f in self.e2f.FindFromKey(e):
            f = _face(f)
            if not any(f.IsSame(g) for g in out):
                out.append(f)
        return out

    def edges_of_vertex(self, v):
        out = []
        for e in self.v2e.FindFromKey(v):
            e = _edge(e)
            if BRep_Tool.Degenerated_s(e):
                continue
            if not any(e.IsSame(g) for g in out):
                out.append(e)
        return out

    def faces_of_vertex(self, v):
        out = []
        for f in self.v2f.FindFromKey(v):
            f = _face(f)
            if not any(f.IsSame(g) for g in out):
                out.append(f)
        return out

    def sas(self, face):
        k = self.fmap.FindIndex(face)
        if k not in self._sas:
            self._sas[k] = ShapeAnalysis_Surface(BRep_Tool.Surface_s(face))
        return self._sas[k]

    def uv(self, face, p):
        return self.sas(face).ValueOfUV(gp_Pnt(*p), 1e-7)

    def normal(self, face, p):
        uv = self.uv(face, p)
        ad = BRepAdaptor_Surface(face)
        props = BRepLProp_SLProps(ad, uv.X(), uv.Y(), 1, 1e-9)
        if not props.IsNormalDefined():
            return None, uv
        n = props.Normal()
        v = (n.X(), n.Y(), n.Z())
        if face.Orientation() == TopAbs_REVERSED:
            v = (-v[0], -v[1], -v[2])
        return v, uv

    def inside(self, face, p, tol=1e-6):
        uv = self.uv(face, p)
        # distance of the projected point from p: a march that left a curved
        # surface far behind is outside
        q = _v(self.sas(face).Value(uv))
        st = BRepClass_FaceClassifier(face, gp_Pnt2d(uv.X(), uv.Y()), tol).State()
        return st == TopAbs_IN, q


def surf_type(face):
    return SURF.get(BRepAdaptor_Surface(face).GetType(), "other")


def surf_info(face):
    ad = BRepAdaptor_Surface(face)
    t = SURF.get(ad.GetType(), "other")
    info = {"type": t}
    if t == "plane":
        pl = ad.Plane()
        d = pl.Axis().Direction()
        info["normal"] = (d.X(), d.Y(), d.Z())
    elif t == "cylinder":
        c = ad.Cylinder()
        d = c.Axis().Direction()
        info.update(axis=(d.X(), d.Y(), d.Z()), origin=_v(c.Location()), radius=c.Radius())
    elif t == "cone":
        c = ad.Cone()
        d = c.Axis().Direction()
        info.update(axis=(d.X(), d.Y(), d.Z()), halfAngleDeg=math.degrees(c.SemiAngle()))
    elif t == "sphere":
        info.update(radius=ad.Sphere().Radius())
    elif t == "torus":
        tt = ad.Torus()
        info.update(major=tt.MajorRadius(), minor=tt.MinorRadius())
    return info


def curve_info(edge):
    c = BRepAdaptor_Curve(edge)
    t = CURVE.get(c.GetType(), "other")
    info = {"type": t, "first": c.FirstParameter(), "last": c.LastParameter()}
    if t == "circle":
        ci = c.Circle()
        d = ci.Axis().Direction()
        info.update(radius=ci.Radius(), axis=(d.X(), d.Y(), d.Z()), center=_v(ci.Location()))
    if t == "line":
        d = c.Line().Direction()
        info.update(direction=(d.X(), d.Y(), d.Z()))
    return info, c


def point_tangent(c, t):
    p, v = gp_Pnt(), gp_Vec()
    c.D1(t, p, v)
    return _v(p), _unit((v.X(), v.Y(), v.Z()))


def edge_length(c):
    from OCP.GCPnts import GCPnts_AbscissaPoint
    try:
        return GCPnts_AbscissaPoint.Length_s(c)
    except Exception:
        return None


def interior_dir(topo, face, p, T, n, eps):
    d = _unit(_cross(n, T))
    for s in (1.0, -1.0):
        q = _add(p, d, s * eps)
        ok, _ = topo.inside(face, q)
        if ok:
            return (s * d[0], s * d[1], s * d[2])
    # retry with a larger step (tiny faces / tolerance)
    for s in (1.0, -1.0):
        q = _add(p, d, s * eps * 20)
        ok, _ = topo.inside(face, q)
        if ok:
            return (s * d[0], s * d[1], s * d[2])
    return None


def width_across(topo, face, p, d, limit, step0):
    """Distance from p along direction d inside `face` until it leaves the face."""
    if d is None:
        return None
    s, last_in = step0, 0.0
    while s <= limit:
        ok, _ = topo.inside(face, _add(p, d, s))
        if not ok:
            lo, hi = last_in, s
            for _ in range(30):
                mid = 0.5 * (lo + hi)
                ok2, _ = topo.inside(face, _add(p, d, mid))
                if ok2:
                    lo = mid
                else:
                    hi = mid
            return lo
        last_in = s
        s *= 1.35
    return None  # wider than the limit


def dihedral_at(topo, e, faces, c, t, eps):
    p, T = point_tangent(c, t)
    f1, f2 = faces
    n1, _ = topo.normal(f1, p)
    n2, _ = topo.normal(f2, p)
    if n1 is None or n2 is None:
        return None
    d1 = interior_dir(topo, f1, p, T, n1, eps)
    d2 = interior_dir(topo, f2, p, T, n2, eps)
    if d1 is None or d2 is None:
        # fall back on normals only: angle between normals, convexity unknown
        return {"p": p, "alpha": None, "normalsDeg": _ang(n1, n2), "d": (None, None)}
    phi = _ang(d1, d2)
    convex = _dot(d1, n2) < 0 or _dot(d2, n1) < 0
    if abs(_ang(n1, n2)) < SMOOTH_DEG:
        alpha = 180.0
    else:
        alpha = phi if convex else 360.0 - phi
    return {"p": p, "T": T, "alpha": alpha, "normalsDeg": _ang(n1, n2), "d": (d1, d2), "n": (n1, n2)}


def classify_alpha(a):
    if a is None:
        return "unknown"
    if abs(a - 180.0) < SMOOTH_DEG:
        return "smooth"
    return "convex" if a < 180.0 else "concave"


def relation(ci, fi):
    """Named analytic relation between the edge curve and its faces."""
    t = ci["type"]
    types = sorted(f["type"] for f in fi)
    if t == "line" and types == ["plane", "plane"]:
        return "line:plane/plane"
    if t == "line" and "cylinder" in types:
        cyl = next(f for f in fi if f["type"] == "cylinder")
        gen = _ang(ci["direction"], cyl["axis"]) < 0.01 or _ang(ci["direction"], cyl["axis"]) > 179.99
        other = [f for f in fi if f is not cyl][0]["type"] if types.count("cylinder") == 1 else "cylinder"
        return f"line:cylinder-generator/{other}" if gen else f"line:cylinder/{other}"
    if t == "circle":
        rel = []
        for f in fi:
            if f["type"] == "plane":
                par = _ang(ci["axis"], f["normal"])
                rel.append("plane" if (par < 0.01 or par > 179.99) else "plane-tilted")
            elif f["type"] in ("cylinder", "cone"):
                par = _ang(ci["axis"], f["axis"])
                rel.append(f["type"] + ("-section" if (par < 0.01 or par > 179.99) else "-oblique"))
            else:
                rel.append(f["type"])
        return "circle:" + "/".join(sorted(rel))
    return f"{t}:" + "/".join(types)


def analyze(shape, edges, size=None, kind="fillet", widths=True):
    topo = Topo(shape)
    sel_idx = []
    for e in edges:
        k = topo.emap.FindIndex(e)
        if k == 0:
            sel_idx.append(None)
        elif k not in sel_idx:
            sel_idx.append(k)
    sel = [k for k in sel_idx if k]
    missing = sum(1 for k in sel_idx if k is None)
    bb_diag = None
    try:
        from OCP.Bnd import Bnd_Box
        from OCP.BRepBndLib import BRepBndLib
        b = Bnd_Box()
        BRepBndLib.Add_s(shape, b)
        lo, hi = b.CornerMin(), b.CornerMax()
        x0, y0, z0, x1, y1, z1 = lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()
        bb_diag = math.dist((x0, y0, z0), (x1, y1, z1))
    except Exception:
        pass
    sz = float(size) if size is not None else None
    out_edges = []
    tangent_at = {}  # (edge idx, vertex idx) -> outward tangent at that vertex
    for k in sel:
        e = _edge(topo.emap.FindKey(k))
        ci, c = curve_info(e)
        L = edge_length(c)
        faces = topo.faces_of_edge(e)
        rec = {"edge": k, "curve": ci["type"], "length": L, "nFaces": len(faces)}
        if ci["type"] == "circle":
            rec["circleRadius"] = ci["radius"]
            rec["closed"] = BRep_Tool.IsClosed_s(e) or abs((ci["last"] - ci["first"]) - 2 * math.pi) < 1e-9
        if ci["type"] == "line":
            rec["direction"] = ci["direction"]
        fi = [surf_info(f) for f in faces]
        rec["faces"] = [f["type"] for f in fi]
        rec["faceIndex"] = [topo.fmap.FindIndex(f) for f in faces]
        for f in fi:
            if f["type"] == "cylinder":
                rec.setdefault("cylRadii", []).append(f["radius"])
        if len(faces) != 2:
            rec["relation"] = f"{ci['type']}:nonmanifold-or-seam({len(faces)})"
            rec["convexity"] = "unknown"
            out_edges.append(rec)
            continue
        rec["relation"] = relation(ci, fi)
        eps = max(1e-4, min(0.02, (L or 1.0) * 1e-3))
        samples = []
        for frac in (0.1, 0.5, 0.9):
            t = ci["first"] + frac * (ci["last"] - ci["first"])
            s = dihedral_at(topo, e, faces, c, t, eps)
            samples.append(s)
        alphas = [s["alpha"] for s in samples if s and s["alpha"] is not None]
        classes = {classify_alpha(a) for a in alphas} or {"unknown"}
        rec["alphaDeg"] = [round(a, 3) for a in alphas]
        rec["convexity"] = classes.pop() if len(classes) == 1 else "mixed"
        mid = samples[1]
        if widths and mid and mid.get("d") and mid["d"][0] is not None:
            limit = max(10.0 * (sz or 1.0), (bb_diag or 100.0))
            ws = []
            for f, d in zip(faces, mid["d"]):
                ws.append(width_across(topo, f, mid["p"], d, limit, max(eps, (sz or 1.0) * 0.05)))
            rec["widths"] = [None if w is None else round(w, 4) for w in ws]
            if sz:
                rec["sizeOverWidth"] = [None if not w else round(sz / w, 4) for w in ws]
        # outward tangents at end vertices (for chains)
        v1 = TopExp.FirstVertex_s(e, True)
        v2 = TopExp.LastVertex_s(e, True)
        ends = []
        for v, t, sign in ((v1, ci["first"], 1.0), (v2, ci["last"], -1.0)):
            if v.IsNull():
                continue
            vi = topo.vmap.FindIndex(v)
            p, T = point_tangent(c, t)
            if e.Orientation() == TopAbs_REVERSED:
                T = (-T[0], -T[1], -T[2])
            tangent_at[(k, vi)] = (T[0] * sign, T[1] * sign, T[2] * sign)
            ends.append(vi)
        rec["vertices"] = sorted(set(ends))
        if len(ends) == 2 and ends[0] == ends[1]:
            rec["closedLoop"] = True
        if L is not None and sz:
            rec["lengthOverSize"] = round(L / sz, 4)
        out_edges.append(rec)

    by_idx = {r["edge"]: r for r in out_edges}
    # vertices
    vrecs = {}
    for r in out_edges:
        for vi in r.get("vertices", []):
            if vi in vrecs:
                continue
            v = _vertex(topo.vmap.FindKey(vi))
            inc = topo.edges_of_vertex(v)
            inc_idx = [topo.emap.FindIndex(x) for x in inc]
            sel_inc = [k for k in inc_idx if k in by_idx]
            vr = {"vertex": vi, "valence": len(inc_idx), "selected": len(sel_inc),
                  "selectedConvexity": sorted({by_idx[k]["convexity"] for k in sel_inc})}
            # tangency among selected pairs
            tans = [tangent_at.get((k, vi)) for k in sel_inc]
            pairs = []
            for i in range(len(sel_inc)):
                for j in range(i + 1, len(sel_inc)):
                    if tans[i] and tans[j]:
                        a = _ang(tans[i], tans[j])
                        pairs.append((sel_inc[i], sel_inc[j], round(a, 3), abs(a - 180.0) < TANGENT_DEG))
            vr["tangentPairs"] = [[a, b] for a, b, _, t in pairs if t]
            vr["pairAnglesDeg"] = [p[2] for p in pairs]
            # unselected incident edges: are they tangent to a selected one (smooth run-out)?
            uns = [x for x, k in zip(inc, inc_idx) if k not in by_idx]
            vr["unselectedCurves"] = sorted(CURVE.get(BRepAdaptor_Curve(x).GetType(), "other") for x in uns)
            # cap face(s): faces at v not adjacent to any selected incident edge
            fadj = set()
            for k in sel_inc:
                fadj.update(by_idx[k].get("faceIndex", []))
            caps = [f for f in topo.faces_of_vertex(v) if topo.fmap.FindIndex(f) not in fadj]
            vr["capFaces"] = [surf_type(f) for f in caps]
            if vr["selected"] == 1 and tans[0]:
                p = _v(BRep_Tool.Pnt_s(v))
                perp = []
                for f in caps:
                    n, _ = topo.normal(f, p)
                    if n is not None:
                        a = _ang(n, tans[0])
                        perp.append(min(a, 180 - a) < PERP_DEG)
                vr["capPerpendicular"] = bool(perp) and all(perp)
            vr["seamOfClosed"] = any(by_idx[k].get("closedLoop") for k in sel_inc)
            vr["class"] = "closed-loop-seam" if (vr["seamOfClosed"] and vr["selected"] == 1) else vertex_class(vr)
            vrecs[vi] = vr
    # chains: components over tangent-continuous selected pairs
    parent = {k: k for k in by_idx}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for vr in vrecs.values():
        for a, b in vr["tangentPairs"]:
            parent[find(a)] = find(b)
    comps = {}
    for k in by_idx:
        comps.setdefault(find(k), []).append(k)
    chains = sorted((len(v) for v in comps.values()), reverse=True)
    return {"size": sz, "kind": kind, "nSelected": len(sel), "nMissing": missing,
            "bboxDiag": bb_diag, "edges": out_edges, "vertices": list(vrecs.values()),
            "chains": chains}


def vertex_class(vr):
    s, val = vr["selected"], vr["valence"]
    conv = set(vr["selectedConvexity"]) - {"smooth"}
    mixed = len(conv) > 1 or "mixed" in conv
    tp = len(vr["tangentPairs"])
    if s == 1:
        if vr.get("capPerpendicular"):
            return "free-end/perpendicular-cap"
        if all(c == "plane" for c in vr["capFaces"]) and vr["capFaces"]:
            return "free-end/oblique-planar-cap"
        if not vr["capFaces"]:
            return "free-end/no-cap(runout)"
        return "free-end/curved-cap"
    if s == 2 and tp == 1:
        return "tangent-chain" + ("/mixed" if mixed else "") + (f"/val{val}" if val > 2 else "")
    if s == 2:
        return "corner-2-of-" + str(val) + ("/mixed" if mixed else "")
    if s == 3 and val == 3:
        return "corner-3" + ("/mixed" if mixed else "")
    return f"corner-{s}-of-{val}" + ("/mixed" if mixed else "") + (f"/tangent{tp}" if tp else "")
