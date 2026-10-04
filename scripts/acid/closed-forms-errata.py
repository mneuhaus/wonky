# /// script
# requires-python = ">=3.10"
# dependencies = ["sympy==1.13.3", "mpmath==1.3.0"]
# ///
"""Current catalog closed forms, extending the preserved historical checker.

The base source is frozen by gear-oracle provenance. The CE8 extension reuses
its exact boundary integration and validation, preserving those recorded bytes.
Run: uv run scripts/acid/closed-forms-errata.py --only AC31
"""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("historical_forms", Path(__file__).with_name("closed-forms.py"))
forms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(forms)

def _m31(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = P["plate"]
    forms.lit(m, P, "edge", f"y={y0}, z={z1}, along x")
    r = P["radius"]
    h = forms.sp.Integer(z1 - z0)
    radius = forms.sp.Integer(r)
    forms.chk(m, "overflow requires 0 < thickness < radius", 0 < h < radius)
    cy, cz = forms.sp.Integer(y0) + radius, forms.sp.Integer(z1) - radius
    theta = forms.sp.asin((forms.sp.Integer(z0) - cz) / radius)
    start = forms.sp.pi - theta
    bottom = cy - forms.sp.sqrt(radius**2 - (forms.sp.Integer(z0)-cz)**2)
    # Independent Green-theorem route: integrate the closed meridian boundary,
    # rather than subtracting the catalog's circular-segment expression.
    loop = [forms.L((bottom,z0),(y1,z0)), forms.L((y1,z0),(y1,z1)),
            forms.L((y1,z1),(cy,z1)), forms.A((cy,cz),radius,forms.sp.pi/2,start)]
    forms.prism_model(m, [loop], x0, x1, perm=(1,2,0))
    m["V"], m["A"] = forms.sp.simplify(m["V"]), forms.sp.simplify(m["A"])
    m["route"] = "exact"
    m["elements"] = [forms.PT([x,y,zz]) for x in (x0,x1) for y,zz in ((bottom,z0),(y1,z0),(y1,z1),(cy,z1))]
    m["elements"] += [forms.ARC([x,cy,cz],[0,radius,0],[0,0,radius],forms.num(forms.sp.pi/2),forms.num(start)) for x in (x0,x1)]


forms.MODELS["AC31"] = _m31

import zw1_forms

# ------------------------------------------------------------------ Sweep ZW1 (no kernel observations)

def _zw1_model(z, P, m, cat):
    zid = z["id"]
    params = {k: P[k] for k in zw1_forms.PARAMS[zid]}
    # Bind the pre-existing inclination as a premise, not as a rotation offset.
    if zid == "AC131":
        forms.chk(m, "already-inclined input differs from target", zw1_forms.Q(params["initialSlope"]) != zw1_forms.Q(params["targetSlope"]))
    first = zw1_forms.forms(zid, params)
    second = zw1_forms.independent(zid, params)
    for key, a, b in zip(("volume", "area"), first, second):
        delta = abs(forms.z1_forms.integral_value(a) - b)
        forms.chk(m, key + " two independent routes <= 1e-12 absolute", delta <= forms.mp.mpf("1e-12"), forms.mp.nstr(delta, 12))
    m["V"], m["A"], m["route"] = *second, "quad"
    F, E, V, loops, rings = zw1_forms.topology(zid)
    genus = 1 if zid == "AC131" else 0
    for k, v in dict(bodies=1,shells=1,faces=F,edges=E,vertices=V,loops=loops,ringEdges=rings,genus=genus,singularPoints=0).items():
        forms.chk(m, "hand-derived topology " + k, z["closedForm"]["topology"][k] == v)
    for v in ("V0","V1","V2","V3"):
        delta = zw1_forms.verify_support(zid,params,forms.frame(v)[0])
        forms.chk(m,"bbox " + v + " independent parametric support <= 1e-12",delta<=forms.mp.mpf("1e-12"),forms.mp.nstr(delta,12))
    m["bboxFunction"] = lambda M, t: zw1_forms.bbox(zid, params, M, t)


for zid in zw1_forms.IDS:
    forms.MODELS[zid] = _zw1_model

# Existing checker's bbox element algebra remains frozen. Additional models can
# expose a directional support callback without discarding bbox assertions.
_previous_bbox_checks = forms.bbox_checks
def _support_bbox_checks(z, m, rep, cf=None, frames=None, tag=""):
    if not m.get("bboxFunction"):
        return _previous_bbox_checks(z,m,rep,cf,frames,tag)
    cf = cf or z["closedForm"]
    frames = frames or {v:forms.frame(v) for v in forms.zone_variants(z) if v != "V4"}
    for v,(M,t) in {"local":(forms.I3,[0,0,0]),**frames}.items():
        b = cf["bbox"]["local"] if v == "local" else cf["bbox"]["variants"][v]
        lo,hi = m["bboxFunction"](M,t)
        ok = all(abs(lo[i]-b["min"][i])<=forms.mp.mpf("1e-9") and abs(hi[i]-b["max"][i])<=forms.mp.mpf("1e-9") for i in range(3))
        rep.add(z["id"],tag+"bbox "+v+" [analytic support, independently parameterized]",ok,str(b) if not ok else "")
forms.bbox_checks = _support_bbox_checks

if __name__ == "__main__":
    forms.main()
