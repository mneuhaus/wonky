"""Independent build123d/OCCT twin for CAD acid shapes-a zones AC60, AC96, AC72, AC77, AC81, AC84, AC89.

Each constructor reads its dimensions from the frozen catalog.  AC60 follows the
primitive+transform frame (as acid_holes_a.py): operands in local coordinates, the shared
zone frame applied to every operand, then the Boolean; V5 builds the plate as an extruded
sketch rectangle like the FS idiom.  AC96 follows the sketch frame (as acid_regions_a.py):
the star is sketched on the zone plane F = cellOrigin + Vk and extruded along its normal;
V0 takes the corners from math.cos/sin, V5 rotates (r, 0, 0) about Z like the FS
rotationMatrix3d idiom.  AC72 is a real revolve (as acid_profile.py AC04): the stepped profile is
sketched on the zone's local XZ plane and revolved 360 deg about the local Z axis; V5 declares the
plane and the axis from literal vectors (V0's cell origin and axes) like the FS idiom.  AC77, AC81, AC84
and AC89 follow the primitive+transform frame of acid_blend.py: operands in local coordinates, the zone
frame applied, the Boolean if any, then the fillet or shell on the edge/face nearest to the frame-mapped
local selection point (AC84 with the intersection-join offset, sharp inner corners, as AC37).  Their V5
twins mirror the FS idioms: AC77 the L profile on the local XZ plane extruded along +y, AC81/AC84 the box
as an extruded sketch rectangle, AC89 one sketch of lines, three-point arcs and circles extruded once
(no Boolean, no fillet).  V4/V5 use V0's frame (catalog baseFrame).  Every result gets the
catalog's b3d refine step clean().  The module never reads the FeatureScript twin or a
kernel result.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Iterable

from build123d import Axis, Box, BuildLine, BuildSketch, Circle, Cylinder, Kind, Line, Locations, Mode, Plane, Polyline, Pos, Shape, Solid, ThreePointArc, Vector, make_face, offset, revolve


ROOT = Path(__file__).resolve().parents[3]
CATALOG = json.loads((ROOT / "fixtures/cad-acid/zones.json").read_text())
ZONES = {zone["id"]: zone for zone in CATALOG["zones"]}
GROUP = next(group for group in CATALOG["groups"] if group["id"] == "shapes-a")
ZONE_IDS = tuple(GROUP["zoneIds"])


def _components(vector: Iterable[float]) -> tuple[float, float, float]:
    values = tuple(float(component) for component in vector)
    if len(values) != 3 or not all(math.isfinite(component) for component in values):
        raise ValueError(f"Expected three finite coordinates, got {vector!r}")
    return values


def _mat_vec(matrix, vector) -> tuple[float, float, float]:
    x, y, z = _components(vector)
    return tuple(sum(float(matrix[row][column]) * (x, y, z)[column] for column in range(3)) for row in range(3))


def _v3_matrix_and_translation():
    """The catalog's f64 Rodrigues frame about its declared point."""
    definition = CATALOG["variants"]["V3"]
    axis = _components(definition["axis"])
    length = math.sqrt(sum(component * component for component in axis))
    unit = tuple(component / length for component in axis)
    cosine, sine = math.cos(float(definition["angleRad"])), math.sin(float(definition["angleRad"]))
    cross = ((0.0, -unit[2], unit[1]), (unit[2], 0.0, -unit[0]), (-unit[1], unit[0], 0.0))
    matrix = [[cosine * float(row == column) + (1.0 - cosine) * unit[row] * unit[column] + sine * cross[row][column]
               for column in range(3)] for row in range(3)]
    pivot = _components(definition["throughPointMm"])
    rotated = _mat_vec(matrix, pivot)
    return matrix, tuple(pivot[index] - rotated[index] for index in range(3))


def _zone_plane(zone_id: str, variant: str) -> Plane:
    """F(p) = cellOrigin + Vk(p) as a Plane (local XY); V4/V5 resolve to V0's frame (baseFrame)."""
    if zone_id not in ZONE_IDS:
        raise ValueError(f"{zone_id} is not a shapes-a acid zone")
    if variant not in ZONES[zone_id]["variants"]:
        raise ValueError(f"{zone_id} declares no {variant}")
    resolved = CATALOG["variants"][variant].get("baseFrame", variant)
    if resolved == "V3":
        matrix, translation = _v3_matrix_and_translation()
    else:
        definition = CATALOG["variants"][resolved]
        matrix, translation = definition["matrix"], _components(definition["translationMm"])
    cell = _components(ZONES[zone_id]["cell"]["originMm"])
    origin = tuple(cell[index] + translation[index] for index in range(3))
    return Plane(origin, tuple(matrix[row][0] for row in range(3)), tuple(matrix[row][2] for row in range(3)))


def _params(zone_id: str, variant: str) -> dict:
    construction = ZONES[zone_id]["construction"]
    return construction.get("paramsByVariant", {}).get(variant, construction["params"])


def _in_frame(shape: Shape, plane: Plane) -> Shape:
    """Primitive+transform frame: one shared placement of a local operand before the Boolean."""
    return shape.moved(plane.location)


def _box(bounds) -> Solid:
    lower, upper = (_components(point) for point in bounds)
    dimensions = tuple(upper[index] - lower[index] for index in range(3))
    if not all(dimension > 0.0 for dimension in dimensions):
        raise ValueError(f"Box bounds must have positive dimensions: {bounds!r}")
    return Pos(*((lower[index] + upper[index]) / 2.0 for index in range(3))) * Box(*dimensions)


def _sketch_box(bounds) -> Solid:
    """V5 idiom: the box as a rectangle sketched on its bottom plane (local z = lower z) and extruded."""
    lower, upper = (_components(point) for point in bounds)
    with BuildSketch(Plane((0.0, 0.0, lower[2]))) as sketch:
        with BuildLine():
            Polyline((lower[0], lower[1]), (upper[0], lower[1]), (upper[0], upper[1]), (lower[0], upper[1]), close=True)
        make_face()
    return Solid.extrude(sketch.sketch.faces()[0], (0.0, 0.0, upper[2] - lower[2]))


def _z_cylinder(spec: dict) -> Solid:
    """A catalog cylinder {p0, p1, radius} along local +z."""
    x0, y0, z0 = _components(spec["p0"])
    x1, y1, z1 = _components(spec["p1"])
    if (x0, y0) != (x1, y1) or not z1 > z0 or not float(spec["radius"]) > 0.0:
        raise ValueError(f"Expected a +z cylinder with positive radius, got {spec!r}")
    return Pos(x0, y0, (z0 + z1) / 2.0) * Cylinder(float(spec["radius"]), z1 - z0)


def _label(zone_id: str, variant: str, result: Shape) -> list[Solid]:
    solids = list(result.solids())
    for index, solid in enumerate(solids):
        solid.label = f"{zone_id}_{index}_{variant}"
    return solids


def ac60(variant: str) -> list[Solid]:
    """AC60: plate 40x30x5 minus four r2 through-bores, one cut (V5: the plate as an extruded sketch rectangle)."""
    params, plane = _params("AC60", variant), _zone_plane("AC60", variant)
    plate = _sketch_box(params["box"]) if variant == "V5" else _box(params["box"])
    tools = [_in_frame(_z_cylinder(spec), plane) for spec in params["holes"]]
    return _label("AC60", variant, _in_frame(plate, plane).cut(*tools).clean())


def _star_corners(star: dict, variant: str) -> list[tuple[float, float]]:
    """Corner k at k*pitch degrees, tip radius at even k (catalog tipsAtEvenIndex), root radius otherwise.
    V0: (r cos, r sin); V5: (r, 0, 0) rotated about Z by k*pitch."""
    corners = []
    for index in range(int(star["points"])):
        tip = (index % 2 == 0) == bool(star["tipsAtEvenIndex"])
        radius = float(star["tipRadius"] if tip else star["rootRadius"])
        degrees = index * float(star["pitchDeg"])
        if variant == "V5":
            point = Vector(radius, 0.0, 0.0).rotate(Axis.Z, degrees)
            corners.append((point.X, point.Y))
        else:
            corners.append((radius * math.cos(math.radians(degrees)), radius * math.sin(math.radians(degrees))))
    return corners


def ac96(variant: str) -> list[Solid]:
    """AC96: 24-corner star (radius 10/8 every 15 deg) sketched on the zone plane and extruded 4."""
    params, plane = _params("AC96", variant), _zone_plane("AC96", variant)
    with BuildSketch(plane) as sketch:
        with BuildLine():
            Polyline(*_star_corners(params["star"], variant), close=True)
        make_face()
    faces = sketch.sketch.faces()
    if len(faces) != 1:
        raise RuntimeError(f"AC96: expected one star face, got {len(faces)}")
    depth, normal = float(params["depth"]), plane.z_dir
    return _label("AC96", variant, Solid.extrude(faces[0], (normal.X * depth, normal.Y * depth, normal.Z * depth)).clean())


def ac72(variant: str) -> list[Solid]:
    """AC72: stepped profile (r,z) (0,0),(R1,0),(R1,z1),(R2,z1),(R2,z2),(0,z2) revolved 360 deg about the local Z axis."""
    params, plane = _params("AC72", variant), _zone_plane("AC72", variant)
    lower, upper = params["lower"], params["upper"]
    r1, r2 = float(lower["radius"]), float(upper["radius"])
    (z0, z1), (z1b, z2) = (tuple(float(value) for value in lower["z"]), tuple(float(value) for value in upper["z"]))
    if z1 != z1b:
        raise ValueError(f"AC72: the upper step must start where the lower ends ({z1} vs {z1b})")
    if variant == "V5":
        origin = _components(ZONES["AC72"]["cell"]["originMm"])
        xz, axis = Plane(origin, (1.0, 0.0, 0.0), (0.0, -1.0, 0.0)), Axis(origin, (0.0, 0.0, 1.0))
    else:
        # local XZ plane: x along the frame x axis, normal along -y (sketch v = local z)
        xz, axis = Plane(plane.origin, plane.x_dir, -plane.y_dir), Axis(plane.origin, plane.z_dir)
    with BuildSketch(xz) as sketch:
        with BuildLine():
            Polyline((0.0, z0), (r1, z0), (r1, z1), (r2, z1), (r2, z2), (0.0, z2), close=True)
        make_face()
    faces = sketch.sketch.faces()
    if len(faces) != 1:
        raise RuntimeError(f"AC72: expected one profile face, got {len(faces)}")
    return _label("AC72", variant, revolve(faces[0], axis=axis, revolution_arc=float(params["angleDeg"])).clean())


def _world(plane: Plane, point) -> Vector:
    """A local zone point mapped by the zone frame (selection points are never world coordinates)."""
    x, y, z = _components(point)
    return plane.origin + plane.x_dir * x + plane.y_dir * y + plane.z_dir * z


def _one_solid(shape: Shape, zone_id: str) -> Solid:
    solids = list(shape.solids())
    if len(solids) != 1:
        raise RuntimeError(f"{zone_id}: expected one solid before the finish operation, got {len(solids)}")
    return solids[0]


def _nearest_edge(shape: Shape, plane: Plane, point):
    return shape.edges().sort_by_distance(_world(plane, point))[0]


def ac77(variant: str) -> list[Solid]:
    """AC77: foot and upright fused (V5: the L profile extruded once), then r2 on the concave seam edge."""
    params, plane = _params("AC77", variant), _zone_plane("AC77", variant)
    if variant == "V5":
        profile = params["v5Profile"]
        local_xz = Plane((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, -1.0, 0.0))  # sketch (u, v) = local (u, 0, v)
        with BuildSketch(local_xz) as sketch:
            with BuildLine():
                Polyline(*[tuple(float(value) for value in point) for point in profile["points"]], close=True)
            make_face()
        body = _in_frame(Solid.extrude(sketch.sketch.faces()[0], (0.0, float(profile["extrudeY"]), 0.0)), plane)
    else:
        body = _in_frame(_box(params["foot"]), plane).fuse(_in_frame(_box(params["upright"]), plane)).clean()
    body = _one_solid(body, "AC77")
    edge = _nearest_edge(body, plane, params["edgePoint"])
    return _label("AC77", variant, body.fillet(float(params["radius"]), [edge]).clean())


def ac81(variant: str) -> list[Solid]:
    """AC81: box 40x30x20 (V5: extruded sketch rectangle), r4 on the vertical edge x = max, y = max."""
    params, plane = _params("AC81", variant), _zone_plane("AC81", variant)
    lower, upper = (_components(point) for point in params["box"])
    if params["edge"] != f"x={params['box'][1][0]}, y={params['box'][1][1]}, along z":
        raise ValueError(f"AC81: unexpected edge {params['edge']!r}")
    box = _one_solid(_in_frame(_sketch_box(params["box"]) if variant == "V5" else _box(params["box"]), plane), "AC81")
    edge = _nearest_edge(box, plane, (upper[0], upper[1], (lower[2] + upper[2]) / 2.0))
    return _label("AC81", variant, box.fillet(float(params["radius"]), [edge]).clean())


def ac84(variant: str) -> list[Solid]:
    """AC84: box 40x30x20 (V5: extruded sketch rectangle) shelled 2 inward with the top face removed."""
    params, plane = _params("AC84", variant), _zone_plane("AC84", variant)
    lower, upper = (_components(point) for point in params["box"])
    if params["removeFace"] != f"z={params['box'][1][2]}":
        raise ValueError(f"AC84: unexpected removed face {params['removeFace']!r}")
    box = _in_frame(_sketch_box(params["box"]) if variant == "V5" else _box(params["box"]), plane)
    top = box.faces().sort_by_distance(_world(plane, ((lower[0] + upper[0]) / 2.0, (lower[1] + upper[1]) / 2.0, upper[2])))[0]
    # INTERSECTION keeps the sharp inner corners the catalog declares (ARC would round them).
    return _label("AC84", variant, offset(box, amount=-float(params["thickness"]), openings=[top], kind=Kind.INTERSECTION).clean())


def ac89(variant: str) -> list[Solid]:
    """AC89: plate minus four bores, then r5 on the four vertical corners (V5: one sketch extruded once)."""
    params, plane = _params("AC89", variant), _zone_plane("AC89", variant)
    (x0, y0, z0), (x1, y1, z1) = (_components(point) for point in params["plate"])
    corner = float(params["cornerRadius"])
    holes = params["holes"]
    if variant == "V5":
        mids = [tuple(float(value) for value in point) for point in params["v5Outline"]["arcMidPoints"]]
        with BuildSketch(Plane.XY.offset(z0)) as sketch:
            with BuildLine():
                Line((x0 + corner, y0), (x1 - corner, y0))
                ThreePointArc((x1 - corner, y0), mids[0], (x1, y0 + corner))
                Line((x1, y0 + corner), (x1, y1 - corner))
                ThreePointArc((x1, y1 - corner), mids[1], (x1 - corner, y1))
                Line((x1 - corner, y1), (x0 + corner, y1))
                ThreePointArc((x0 + corner, y1), mids[2], (x0, y1 - corner))
                Line((x0, y1 - corner), (x0, y0 + corner))
                ThreePointArc((x0, y0 + corner), mids[3], (x0 + corner, y0))
            make_face()
            for spec in holes:
                with Locations(tuple(float(value) for value in spec["p0"][:2])):
                    Circle(float(spec["radius"]), mode=Mode.SUBTRACT)
        faces = sketch.sketch.faces()
        if len(faces) != 1:
            raise RuntimeError(f"AC89: expected one holed plate face, got {len(faces)}")
        return _label("AC89", variant, _in_frame(Solid.extrude(faces[0], (0.0, 0.0, z1 - z0)), plane).clean())
    plate = _in_frame(_box(params["plate"]), plane)
    tools = [_in_frame(_z_cylinder(spec), plane) for spec in holes]
    body = _one_solid(plate.cut(*tools).clean(), "AC89")
    edges = [_nearest_edge(body, plane, point) for point in params["edgePoints"]]
    return _label("AC89", variant, body.fillet(corner, edges).clean())


BUILDERS = {"AC60": ac60, "AC96": ac96, "AC72": ac72, "AC77": ac77, "AC81": ac81, "AC84": ac84, "AC89": ac89}


def build_group(variant: str) -> list[Solid]:
    """Every shapes-a zone that declares the variant (zone = ALL smoke), flattened by solid."""
    return [solid for zone_id in ZONE_IDS if variant in ZONES[zone_id]["variants"] for solid in BUILDERS[zone_id](variant)]
