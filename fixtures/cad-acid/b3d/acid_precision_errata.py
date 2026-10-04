"""CE11 horn-torus twin: revolve the specified tangent circle, not a primitive."""
from build123d import Axis, Edge, Face, Plane, Solid, Wire
from acid_precision import zone_frame, _solids


def build(variant, zone="AC48"):
    if zone != "AC48":
        raise ValueError(f"unsupported errata zone {zone}")
    circle = Edge.make_circle(4.0, Plane(origin=(4,0,0), x_dir=(1,0,0), z_dir=(0,-1,0)))
    profile = Face(Wire([circle]))
    solids = _solids(zone_frame(zone, variant).transform(Solid.revolve(profile, 360, Axis.Z)))
    for index, solid in enumerate(solids):
        solid.label = f"{zone}_{index}_{variant}"
    return solids
