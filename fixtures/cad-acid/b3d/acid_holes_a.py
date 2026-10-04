"""Independent build123d/OCCT twin for CAD acid holes-a zones AC61, AC63, AC64, AC65, AC51,
AC62, AC67, AC68, AC71, AC75, AC79, AC98.

Each constructor reads its dimensions from the frozen catalog, creates operands in
local coordinates, applies the shared zone frame to every operand, and only then
runs the Boolean.  It deliberately does not read the FeatureScript twin.  AC61-AC65
always build via the same Box/Cylinder primitives regardless of which FS idiom
(V0-V4 primitive vs. V5 sketch) a variant exercises on the FeatureScript side --
b3d only needs to reproduce the nominal geometry at the requested frame.  AC51's star
is a polyline face extruded in local coordinates (corners from math.cos/sin); its V5
mirrors the FS idiom: the bore as a circle subtracted in the star sketch, no Boolean.
AC62, AC67, AC68, AC71 and AC75 mirror the FS V5 idiom: the tools (or the boss) as
extruded sketch circles/rectangles instead of Cylinder/Box.  AC62's hexagon corners come
from the catalog's corner expressions with h = apothem/sqrt(3); AC71's copies are the
seed moved by the catalog's pattern translations (in local coordinates, before the frame).
AC79's L profile is a polyline face extruded in local coordinates (V5: a chain of Line segments, like
the FS skLineSegment chain); AC98's block is moved by the catalog's move vector in local coordinates
(V5: by a Plane location, like the FS toWorld(coordSystem) idiom) before the frame.  A zone builds
only the variants it declares (zone.variants); the group smoke skips the others.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Iterable

from build123d import Axis, Box, BuildLine, BuildSketch, Circle, Cylinder, Line, Location, Locations, Mode, Plane, Polyline, Pos, Shape, Solid, make_face


ROOT = Path(__file__).resolve().parents[3]
CATALOG = json.loads((ROOT / "fixtures/cad-acid/zones.json").read_text())
ZONES = {zone["id"]: zone for zone in CATALOG["zones"]}
GROUP = next(group for group in CATALOG["groups"] if group["id"] == "holes-a")
ZONE_IDS = tuple(GROUP["zoneIds"])


def _components(vector: Iterable[float]) -> tuple[float, float, float]:
    """Return a catalog vector as a finite, explicit float triple."""
    values = tuple(float(component) for component in vector)
    if len(values) != 3 or not all(math.isfinite(component) for component in values):
        raise ValueError(f"Expected three finite coordinates, got {vector!r}")
    return values


def _cell_origin(zone_id: str) -> tuple[float, float, float]:
    """Locate a holes-a zone in the cell the catalog declares for it (zone.cell.originMm)."""
    if zone_id not in ZONE_IDS:
        raise ValueError(f"{zone_id} is not a holes-a acid zone")
    return _components(ZONES[zone_id]["cell"]["originMm"])


def _mat_vec(matrix: list[list[float]], vector: Iterable[float]) -> tuple[float, float, float]:
    x, y, z = _components(vector)
    return tuple(sum(float(matrix[row][column]) * (x, y, z)[column] for column in range(3)) for row in range(3))


def _v3_matrix_and_translation() -> tuple[list[list[float]], tuple[float, float, float]]:
    """Construct the catalog's f64 Rodrigues frame about its declared point."""
    definition = CATALOG["variants"]["V3"]
    axis = _components(definition["axis"])
    axis_length = math.sqrt(sum(component * component for component in axis))
    unit = tuple(component / axis_length for component in axis)
    angle = float(definition["angleRad"])
    cosine, sine = math.cos(angle), math.sin(angle)
    cross = (
        (0.0, -unit[2], unit[1]),
        (unit[2], 0.0, -unit[0]),
        (-unit[1], unit[0], 0.0),
    )
    matrix = [
        [
            cosine * float(row == column)
            + (1.0 - cosine) * unit[row] * unit[column]
            + sine * cross[row][column]
            for column in range(3)
        ]
        for row in range(3)
    ]
    pivot = _components(definition["throughPointMm"])
    rotated_pivot = _mat_vec(matrix, pivot)
    return matrix, tuple(pivot[index] - rotated_pivot[index] for index in range(3))


def _zone_plane(zone_id: str, variant: str) -> Plane:
    """Return F(p) = cellOrigin + Vk(p). V4/V5 resolve to V0's frame (baseFrame)."""
    if variant not in ZONES[zone_id].get("variants", ["V0", "V1", "V2", "V3"]):
        raise ValueError(f"{zone_id} declares no {variant}")
    resolved = CATALOG["variants"].get(variant, {}).get("baseFrame", variant) if variant in CATALOG["variants"] else variant
    if resolved not in {"V0", "V1", "V2", "V3"}:
        raise ValueError(f"Unknown acid variant {variant!r} (resolved {resolved!r})")
    if resolved == "V3":
        matrix, translation = _v3_matrix_and_translation()
    else:
        definition = CATALOG["variants"][resolved]
        matrix = definition["matrix"]
        translation = _components(definition["translationMm"])
    cell = _cell_origin(zone_id)
    origin = tuple(cell[index] + translation[index] for index in range(3))
    x_axis = tuple(matrix[row][0] for row in range(3))
    z_axis = tuple(matrix[row][2] for row in range(3))
    return Plane(origin, x_axis, z_axis)


def _params(zone_id: str, variant: str) -> dict:
    """Construction parameters of one variant: V4 has its own literals (construction.paramsByVariant.V4)."""
    construction = ZONES[zone_id]["construction"]
    return construction.get("paramsByVariant", {}).get(variant, construction["params"])


def _in_frame(shape: Shape, plane: Plane) -> Shape:
    """Apply the one shared primitive+transform frame before the Boolean."""
    return shape.moved(plane.location)


def _box(bounds: list[list[float]]) -> Solid:
    """Build one axis-aligned catalog cuboid in local coordinates."""
    lower, upper = (_components(point) for point in bounds)
    dimensions = tuple(upper[index] - lower[index] for index in range(3))
    if not all(dimension > 0.0 for dimension in dimensions):
        raise ValueError(f"Box bounds must have positive dimensions: {bounds!r}")
    centre = tuple((lower[index] + upper[index]) / 2.0 for index in range(3))
    return Pos(*centre) * Box(*dimensions)


def _cylinder_between(p0: Iterable[float], p1: Iterable[float], radius: float) -> Solid:
    """Build a catalog cylinder between two axis-aligned local points (Z- or X-axis)."""
    x0, y0, z0 = _components(p0)
    x1, y1, z1 = _components(p1)
    length = math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2)
    if not radius > 0.0 or not length > 0.0:
        raise ValueError(f"Cylinder needs positive radius and length: {radius!r}, {p0!r}->{p1!r}")
    mid = ((x0 + x1) / 2.0, (y0 + y1) / 2.0, (z0 + z1) / 2.0)
    solid = Cylinder(float(radius), length)
    dx, dy, dz = abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)
    if dx >= dy and dx >= dz and dx > 0.0:
        solid = solid.rotate(Axis((0, 0, 0), (0, 1, 0)), 90)
    elif dy >= dx and dy >= dz and dy > 0.0:
        solid = solid.rotate(Axis((0, 0, 0), (1, 0, 0)), -90)
    return Pos(*mid) * solid


def _clean(shape: Shape) -> Shape:
    """Run OCCT's explicit refine step required by the catalog's b3d contract."""
    return shape.clean()


def _fuse(operands: list[Shape]) -> Shape:
    if len(operands) < 2:
        raise ValueError("A Boolean union needs at least two operands")
    return _clean(operands[0].fuse(*operands[1:]))


def _cut(target: Shape, tools: list[Shape]) -> Shape:
    if not tools:
        raise ValueError("A Boolean subtraction needs at least one tool")
    return _clean(target.cut(*tools))


def _label(zone_id: str, variant: str, result: Shape) -> list[Solid]:
    """Flatten a Boolean result to the individually labelled result solids."""
    solids = list(result.solids())
    for index, solid in enumerate(solids, start=1):
        solid.label = f"{zone_id}_{index}_{variant}"
    return solids


def _cyl_from_params(spec: dict, plane: Plane) -> Shape:
    """Build+frame one catalog cylinder spec {p0, p1, radius}."""
    return _in_frame(_cylinder_between(spec["p0"], spec["p1"], float(spec["radius"])), plane)


def ac61(variant: str) -> list[Solid]:
    """AC61: pipe. Outer r9 (z 0..14) minus inner r3 (z -2..16). Genus 1."""
    params = _params("AC61", variant)
    plane = _zone_plane("AC61", variant)
    outer = _cyl_from_params(params["outer"], plane)
    inner = _cyl_from_params(params["inner"], plane)
    return _label("AC61", variant, _cut(outer, [inner]))


def ac63(variant: str) -> list[Solid]:
    """AC63: blind hole. Box 32x24x10 minus r3 cylinder at (16,12), floor at z=4."""
    params = _params("AC63", variant)
    plane = _zone_plane("AC63", variant)
    box = _in_frame(_box(params["box"]), plane)
    hole = _cyl_from_params(params["hole"], plane)
    return _label("AC63", variant, _cut(box, [hole]))


def ac64(variant: str) -> list[Solid]:
    """AC64: cross-axis holes. Box 40x24x20 minus a Z-bore and a non-crossing X-bore."""
    params = _params("AC64", variant)
    plane = _zone_plane("AC64", variant)
    box = _in_frame(_box(params["box"]), plane)
    holes = [_cyl_from_params(spec, plane) for spec in params["holes"]]
    return _label("AC64", variant, _cut(box, holes))


def ac65(variant: str) -> list[Solid]:
    """AC65: drill after union. Two boxes fused, then a Z-bore through the result."""
    params = _params("AC65", variant)
    plane = _zone_plane("AC65", variant)
    a = _in_frame(_box(params["boxes"]["A"]), plane)
    w = _in_frame(_box(params["boxes"]["W"]), plane)
    unioned = _fuse([a, w])
    bore = _cyl_from_params(params["bore"], plane)
    return _label("AC65", variant, _cut(unioned, [bore]))


def _star_corners(star: dict) -> list[tuple[float, float]]:
    """Corner k at k*pitch degrees, tip radius at even k (catalog tipsAtEvenIndex), root radius otherwise."""
    corners = []
    for index in range(int(star["points"])):
        tip = (index % 2 == 0) == bool(star["tipsAtEvenIndex"])
        radius = float(star["tipRadius"] if tip else star["rootRadius"])
        angle = math.radians(index * float(star["pitchDeg"]))
        corners.append((radius * math.cos(angle), radius * math.sin(angle)))
    return corners


def ac51(variant: str) -> list[Solid]:
    """AC51: 24-corner star prism (depth 4) minus a coaxial r3 cylinder (V5: circle in the star sketch)."""
    params = _params("AC51", variant)
    plane = _zone_plane("AC51", variant)
    depth, bore = float(params["depth"]), params["bore"]
    with BuildSketch(Plane.XY) as local:
        with BuildLine():
            Polyline(*_star_corners(params["star"]), close=True)
        make_face()
        if variant == "V5":
            Circle(float(bore["radius"]), mode=Mode.SUBTRACT)
    faces = local.sketch.faces()
    if len(faces) != 1:
        raise RuntimeError(f"AC51: expected one star face, got {len(faces)}")
    gear = _in_frame(Solid.extrude(faces[0], (0.0, 0.0, depth)), plane)
    if variant == "V5":
        return _label("AC51", variant, _clean(gear))
    return _label("AC51", variant, _cut(gear, [_cyl_from_params(bore, plane)]))


def _sketch_cylinder(centre: Iterable[float], z0: float, depth: float, radius: float) -> Solid:
    """V5 idiom: a circle sketched on the local plane z = z0 and extruded depth along local +z."""
    cx, cy = (float(value) for value in centre)
    if not radius > 0.0 or not depth > 0.0:
        raise ValueError(f"Sketch cylinder needs positive radius and depth: {radius!r}, {depth!r}")
    with BuildSketch(Plane.XY.offset(float(z0))) as sketch:
        with Locations((cx, cy)):
            Circle(float(radius))
    return Solid.extrude(sketch.sketch.faces()[0], (0.0, 0.0, float(depth)))


def _sketch_box(bounds: list[list[float]]) -> Solid:
    """V5 idiom: the box as a rectangle sketched on its bottom plane (local z = lower z) and extruded."""
    lower, upper = (_components(point) for point in bounds)
    with BuildSketch(Plane.XY.offset(lower[2])) as sketch:
        with BuildLine():
            Polyline((lower[0], lower[1]), (upper[0], lower[1]), (upper[0], upper[1]), (lower[0], upper[1]), close=True)
        make_face()
    return Solid.extrude(sketch.sketch.faces()[0], (0.0, 0.0, upper[2] - lower[2]))


def _z_tool(spec: dict, variant: str) -> Solid:
    """A +z catalog cylinder {p0, p1, radius} in local coordinates: Cylinder, or in V5 the sketch idiom."""
    x0, y0, z0 = _components(spec["p0"])
    x1, y1, z1 = _components(spec["p1"])
    if (x0, y0) != (x1, y1) or not z1 > z0:
        raise ValueError(f"Expected a +z cylinder, got {spec!r}")
    if variant == "V5":
        return _sketch_cylinder((x0, y0), z0, z1 - z0, float(spec["radius"]))
    return _cylinder_between(spec["p0"], spec["p1"], float(spec["radius"]))


def ac62(variant: str) -> list[Solid]:
    """AC62: bar r10 (z 0..12) minus a through-bore r2 and a hexagonal pocket (z 8..13), one cut."""
    params = _params("AC62", variant)
    plane = _zone_plane("AC62", variant)
    bar = _in_frame(_cylinder_between(params["cylinder"]["p0"], params["cylinder"]["p1"], float(params["cylinder"]["radius"])), plane)
    bore = _in_frame(_z_tool(params["bore"], variant), plane)
    pocket_spec = params["hexPocket"]
    h = float(pocket_spec["apothem"]) / math.sqrt(3.0)
    corners = [tuple(float(eval(str(value), {"__builtins__": {}}, {"h": h})) for value in corner) for corner in pocket_spec["corners"]]
    z0, z1 = (float(value) for value in pocket_spec["z"])
    with BuildSketch(Plane.XY.offset(z0)) as sketch:
        with BuildLine():
            Polyline(*corners, close=True)
        make_face()
    pocket = _in_frame(Solid.extrude(sketch.sketch.faces()[0], (0.0, 0.0, z1 - z0)), plane)
    return _label("AC62", variant, _cut(bar, [bore, pocket]))


def ac67(variant: str) -> list[Solid]:
    """AC67: plate 24x16x4 fused with a boss r4 at (12,8), z 3..12 (V5: the boss sketched on the plate top, z 4..12)."""
    params = _params("AC67", variant)
    plane = _zone_plane("AC67", variant)
    plate = _in_frame(_box(params["plate"]), plane)
    spec = params["boss"]
    if variant == "V5":
        top = float(params["plate"][1][2])
        boss = _sketch_cylinder(spec["p0"][:2], top, float(spec["p1"][2]) - top, float(spec["radius"]))
    else:
        boss = _cylinder_between(spec["p0"], spec["p1"], float(spec["radius"]))
    return _label("AC67", variant, _fuse([plate, _in_frame(boss, plane)]))


def ac68(variant: str) -> list[Solid]:
    """AC68: block 24x16x12 minus a through-bore r2 and a side-open slot, one cut."""
    params = _params("AC68", variant)
    plane = _zone_plane("AC68", variant)
    block = _in_frame(_box(params["box"]), plane)
    bore = _in_frame(_z_tool(params["bore"], variant), plane)
    slot = _in_frame(_sketch_box(params["slot"]) if variant == "V5" else _box(params["slot"]), plane)
    return _label("AC68", variant, _cut(block, [bore, slot]))


def ac71(variant: str) -> list[Solid]:
    """AC71: box 32x24x8 minus a seed bore r2 and its two pattern copies (translations along local x), one cut."""
    params = _params("AC71", variant)
    plane = _zone_plane("AC71", variant)
    box = _in_frame(_box(params["box"]), plane)
    seed = _z_tool(params["seed"], variant)
    copies = [seed.moved(Location(_components(offset))) for offset in params["pattern"]["translations"]]
    tools = [_in_frame(tool, plane) for tool in [seed, *copies]]
    return _label("AC71", variant, _cut(box, tools))


def ac75(variant: str) -> list[Solid]:
    """AC75: box 32x24x10 minus a through-bore r2 and a coaxial counterbore r4 from z 7, one cut."""
    params = _params("AC75", variant)
    plane = _zone_plane("AC75", variant)
    box = _in_frame(_box(params["box"]), plane)
    tools = [_in_frame(_z_tool(params[key], variant), plane) for key in ("bore", "counterbore")]
    return _label("AC75", variant, _cut(box, tools))


def ac79(variant: str) -> list[Solid]:
    """AC79: L profile extruded along local z minus a square through-cutter in its upright leg, one cut."""
    params = _params("AC79", variant)
    plane = _zone_plane("AC79", variant)
    corners = [tuple(float(value) for value in point) for point in params["profile"]]
    with BuildSketch(Plane.XY) as sketch:
        with BuildLine():
            if variant == "V5":
                for start, end in zip(corners, corners[1:] + corners[:1]):
                    Line(start, end)
            else:
                Polyline(*corners, close=True)
        make_face()
    faces = sketch.sketch.faces()
    if len(faces) != 1:
        raise RuntimeError(f"AC79: expected one L face, got {len(faces)}")
    prism = _in_frame(Solid.extrude(faces[0], (0.0, 0.0, float(params["depth"]))), plane)
    cutter = _in_frame(_box(params["cutter"]), plane)
    return _label("AC79", variant, _cut(prism, [cutter]))


def ac98(variant: str) -> list[Solid]:
    """AC98: block moved by the catalog vector (local), then a through-bore at the moved block's centre, one cut."""
    params = _params("AC98", variant)
    plane = _zone_plane("AC98", variant)
    move = _components(params["move"])
    block = _box(params["box"])
    if variant == "V5":
        block = block.moved(Plane(move, (1.0, 0.0, 0.0), (0.0, 0.0, 1.0)).location)
    else:
        block = block.moved(Location(move))
    bore = _cyl_from_params(params["bore"], plane)
    return _label("AC98", variant, _cut(_in_frame(block, plane), [bore]))


BUILDERS = {
    "AC61": ac61,
    "AC63": ac63,
    "AC64": ac64,
    "AC65": ac65,
    "AC51": ac51,
    "AC62": ac62,
    "AC67": ac67,
    "AC68": ac68,
    "AC71": ac71,
    "AC75": ac75,
    "AC79": ac79,
    "AC98": ac98,
}


def build_group(variant: str) -> list[Solid]:
    """Build every holes-a zone that declares the variant (zone = ALL smoke), flattened by solid."""
    return [solid for zone_id in ZONE_IDS if variant in ZONES[zone_id].get("variants", ["V0", "V1", "V2", "V3"]) for solid in BUILDERS[zone_id](variant)]
