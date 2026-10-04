"""CE11 per-zone real revolve twins; shared frozen helpers stay unchanged."""
from build123d import Axis, Edge, Face, Plane, Solid, Wire
from acid_curved import _params, _operand, _solids

def build_ac25(variant: str):
    triangle = _params("AC25")["triangle"]
    if triangle[0] != [0, 0] or triangle[1][1] != 0 or triangle[2][0] != 0:
        raise ValueError(f"AC25 must remain the axis-touching right-triangle profile, got {triangle!r}")
    profile = Face(Wire.make_polygon([(float(u), 0, float(v)) for u, v in triangle], close=True))
    result = _operand(Solid.revolve(profile, 360, Axis.Z), "AC25", variant)
    return _solids("AC25", variant, result)


def build_ac26(variant: str):
    circle = _params("AC26")["circle"]
    if float(circle["center"][1]) != 0.0:
        raise ValueError(f"AC26 profile must remain on the local X axis, got {circle!r}")
    result = _operand(Solid.revolve(Face(Wire([Edge.make_circle(float(circle["r"]), Plane(origin=(float(circle["center"][0]), 0, float(circle["center"][1])), x_dir=(1,0,0), z_dir=(0,-1,0)))])), 360, Axis.Z), "AC26", variant)
    return _solids("AC26", variant, result)


def build_zone(zone_id, variant):
    return {"AC25": build_ac25, "AC26": build_ac26}[zone_id](variant)
