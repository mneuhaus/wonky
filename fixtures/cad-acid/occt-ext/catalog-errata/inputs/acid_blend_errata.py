"""CE8: attempt the specified overflow fillet, without claiming infeasibility."""
from acid_blend import _zone, _box, _nearest_edge, _label, frame_for


def build(variant, zone="AC31"):
    if zone != "AC31":
        raise ValueError(f"unsupported errata zone {zone}")
    params = _zone(zone)["construction"]["params"]
    frame = frame_for(zone, variant)
    plate = _box(frame, params["plate"])
    edge = _nearest_edge(plate, frame, (8.0, 0.0, 2.0))
    try:
        result = plate.fillet(params["radius"], [edge])
    except ValueError as error:
        raise NotImplementedError(
            f"OCCT opFillet edge overflow, radius {params['radius']} mm on a "
            f"{params['plate'][1][2]-params['plate'][0][2]} mm plate, unsupported by this twin: {error}"
        ) from error
    return _label(zone, variant, [result])
