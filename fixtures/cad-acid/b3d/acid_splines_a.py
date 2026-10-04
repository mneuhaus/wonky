"""Independent build123d/OCCT twin for CAD acid splines-a zones AC100 and AC102.

Every curve is built from the contract's poles, never interpolated: build123d Bezier (an OCCT Geom_BezierCurve,
degree = poles - 1) takes the control points as they are. AC100 follows the sketch frame (as acid_shapes_a.py AC96):
the arch and its chord are sketched on the zone plane F = cellOrigin + Vk and extruded along its normal; V5 uses the
five degree-4 control points of the catalog. AC102 follows the primitive+transform frame (as acid_holes_a.py): the gear
outline, the hub and the bore tool are built in local coordinates, the zone frame is applied to all three, then the
union and the cut. Its poles are the contract's: the payload formulas of acid-splines-a.fs (cos, sin, tan, atan, sqrt
in binary64, in the FS operation order) replicated in Python from the catalog's gear parameters. V0 builds hub and bore
as extruded circle faces like the FS skCircle idiom, V5 as Cylinder primitives (the bore with 1 mm overshoot).
V4/V5 use V0's frame (catalog baseFrame). Every result gets the catalog's b3d refine step clean(). The module never
reads the FeatureScript twin or a kernel result.
"""

from __future__ import annotations

import json
import math
from fractions import Fraction
from pathlib import Path
from typing import Iterable

from build123d import Bezier, BuildLine, BuildSketch, Circle, Cylinder, Line, Plane, Pos, Shape, Solid, ThreePointArc, make_face


ROOT = Path(__file__).resolve().parents[3]
CATALOG = json.loads((ROOT / "fixtures/cad-acid/zones.json").read_text())
ZONES = {zone["id"]: zone for zone in CATALOG["zones"]}
GROUP = next(group for group in CATALOG["groups"] if group["id"] == "splines-a")
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
        raise ValueError(f"{zone_id} is not a splines-a acid zone")
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


def _label(zone_id: str, variant: str, result: Shape) -> list[Solid]:
    solids = list(result.solids())
    for index, solid in enumerate(solids):
        solid.label = f"{zone_id}_{index}_{variant}"
    return solids


def _one_face(sketch, zone_id: str):
    faces = sketch.sketch.faces()
    if len(faces) != 1:
        raise RuntimeError(f"{zone_id}: expected one profile face, got {len(faces)}")
    return faces[0]


def ac100(variant: str) -> list[Solid]:
    """AC100: one Bezier arch (the catalog's control points; V5 the degree-4 elevation) closed by its chord, extruded."""
    params, plane = _params("AC100", variant), _zone_plane("AC100", variant)
    controls = params["v5Controls"] if variant == "V5" else params["bezier"]["controls"]
    poles = [tuple(float(value) for value in point) for point in controls]
    start, end = (tuple(float(value) for value in point) for point in params["chord"])
    if start != poles[-1] or end != poles[0]:
        raise ValueError("AC100: the chord must close the Bezier from its last to its first control point")
    with BuildSketch(plane) as sketch:
        with BuildLine():
            Bezier(*poles)
            Line(start, end)
        make_face()
    depth, normal = float(params["depth"]), plane.z_dir
    return _label("AC100", variant, Solid.extrude(_one_face(sketch, "AC100"), (normal.X * depth, normal.Y * depth, normal.Z * depth)).clean())


def _gear_teeth(gear: dict, flank: dict) -> list[dict]:
    """The contract's poles: acid-splines-a.fs's payload in binary64, in its operation order (mm). Per tooth k (centre
    k * 2 pi/z): lower and upper (poles base -> tip, root foot), the tip-arc and root-arc mid points."""
    if float(gear["toothCentreDeg"]) != 0.0:
        raise ValueError("AC102: the FS centres tooth 0 on +x")
    m, z = float(gear["module"]), int(gear["teeth"])
    alpha = float(gear["pressureAngleDeg"]) * (math.pi / 180)
    rp = m * z / 2
    rb = rp * math.cos(alpha)
    ra = rp + float(gear["addendumModules"]) * m
    rf = rp - float(gear["dedendumModules"]) * m
    psib = math.pi / (2 * z) + math.tan(alpha) - alpha
    ta = math.sqrt(ra * ra / (rb * rb) - 1)
    psia = psib - (ta - math.atan(ta))
    pitch = 2 * math.pi / z
    h0, h1 = (float(Fraction(handle)) for handle in flank["handles"])
    teeth = []
    for k in range(z):
        th = k * pitch
        tooth = {"tipMid": (ra * math.cos(th), ra * math.sin(th)), "rootMid": (rf * math.cos(th + pitch / 2), rf * math.sin(th + pitch / 2))}
        for name, s in (("lower", -1), ("upper", 1)):
            a0, a3 = th + s * psib, th + s * psia
            a1 = a0 - s * ta
            c0, s0 = math.cos(a0), math.sin(a0)
            base = (rb * c0, rb * s0)
            tip = (ra * math.cos(a3), ra * math.sin(a3))
            dx, dy = tip[0] - base[0], tip[1] - base[1]
            chord = math.sqrt(dx * dx + dy * dy)
            c1, s1 = math.cos(a1), math.sin(a1)
            poles = [base, (base[0] + h0 * chord * c0, base[1] + h0 * chord * s0), (tip[0] - h1 * chord * c1, tip[1] - h1 * chord * s1), tip]
            tooth[name] = (poles, (rf * c0, rf * s0))
        teeth.append(tooth)
    return teeth


def _z_cylinder(spec: dict, extruded: bool) -> Solid:
    """A catalog cylinder {p0, p1, radius} along local +z: an extruded circle face (V0 idiom) or a Cylinder primitive (V5)."""
    x0, y0, z0 = _components(spec["p0"])
    x1, y1, z1 = _components(spec["p1"])
    radius = float(spec["radius"])
    if (x0, y0) != (x1, y1) or not z1 > z0 or not radius > 0.0:
        raise ValueError(f"Expected a +z cylinder with positive radius, got {spec!r}")
    if not extruded:
        return Pos(x0, y0, (z0 + z1) / 2.0) * Cylinder(radius, z1 - z0)
    with BuildSketch(Plane((x0, y0, z0))) as sketch:
        Circle(radius)
    return Solid.extrude(_one_face(sketch, "AC102 circle"), (0.0, 0.0, z1 - z0))


def ac102(variant: str) -> list[Solid]:
    """AC102: 16-tooth gear outline (Bezier flanks from the contract poles, radial lines, three-point tip and root arcs)
    extruded 6, a hub united and a bore cut (V0 extruded circles, V5 cylinders with an overshooting bore)."""
    params, plane = _params("AC102", variant), _zone_plane("AC102", variant)
    teeth = _gear_teeth(params["gear"], params["flank"])
    with BuildSketch(Plane.XY) as sketch:
        with BuildLine():
            for k, tooth in enumerate(teeth):
                (lower, lower_foot), (upper, upper_foot) = tooth["lower"], tooth["upper"]
                Line(lower_foot, lower[0])
                Bezier(*lower)
                ThreePointArc(lower[3], tooth["tipMid"], upper[3])
                Bezier(*reversed(upper))
                Line(upper[0], upper_foot)
                ThreePointArc(upper_foot, tooth["rootMid"], teeth[(k + 1) % len(teeth)]["lower"][1])
        make_face()
    gear = Solid.extrude(_one_face(sketch, "AC102"), (0.0, 0.0, float(params["depth"])))
    parts = params["v5"] if variant == "V5" else params
    hub = _z_cylinder(parts["hub"], extruded=variant != "V5")
    bore = _z_cylinder(parts["bore"], extruded=variant != "V5")
    body = _in_frame(gear, plane).fuse(_in_frame(hub, plane)).cut(_in_frame(bore, plane)).clean()
    return _label("AC102", variant, body)


BUILDERS = {"AC100": ac100, "AC102": ac102}


def build_group(variant: str) -> list[Solid]:
    """Every splines-a zone that declares the variant (zone = ALL smoke), flattened by solid."""
    return [solid for zone_id in ZONE_IDS if variant in ZONES[zone_id]["variants"] for solid in BUILDERS[zone_id](variant)]
