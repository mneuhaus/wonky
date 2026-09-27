"""Independent build123d/OCCT twin for CAD acid Boolean zones AC10–AC18 and AC49.

Each constructor reads its dimensions from the frozen catalog, creates operands in
local coordinates, applies the shared zone frame to every operand, and only then
runs the Boolean.  It deliberately does not read the FeatureScript twin.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Iterable

from build123d import Box, Cylinder, GeomType, Plane, Pos, Shape, Solid, Vector


ROOT = Path(__file__).resolve().parents[3]
CATALOG = json.loads((ROOT / "fixtures/cad-acid/zones.json").read_text())
ZONES = {zone["id"]: zone for zone in CATALOG["zones"]}
GROUP = next(group for group in CATALOG["groups"] if group["id"] == "boolean")
ZONE_IDS = tuple(GROUP["zoneIds"])
PITCH_MM = CATALOG["grid"]["pitchMm"]


def _components(vector: Iterable[float]) -> tuple[float, float, float]:
    """Return a catalog vector as a finite, explicit float triple."""
    values = tuple(float(component) for component in vector)
    if len(values) != 3 or not all(math.isfinite(component) for component in values):
        raise ValueError(f"Expected three finite coordinates, got {vector!r}")
    return values


def _cell_origin(zone_id: str) -> tuple[float, float, float]:
    """Locate a Boolean zone in its frozen grid cell."""
    try:
        column = ZONE_IDS.index(zone_id)
    except ValueError as error:
        raise ValueError(f"{zone_id} is not a Boolean acid zone") from error
    row = next(index for index, group in enumerate(CATALOG["groups"]) if group["id"] == "boolean")
    return (PITCH_MM * column, PITCH_MM * row, 0.0)


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
    """Return F(p) = cellOrigin + Vk(p), as the zone's common build123d frame."""
    if variant not in {"V0", "V1", "V2", "V3"}:
        raise ValueError(f"Unknown acid variant {variant!r}")
    if variant == "V3":
        matrix, translation = _v3_matrix_and_translation()
    else:
        definition = CATALOG["variants"][variant]
        matrix = definition["matrix"]
        translation = _components(definition["translationMm"])
    cell = _cell_origin(zone_id)
    origin = tuple(cell[index] + translation[index] for index in range(3))
    x_axis = tuple(matrix[row][0] for row in range(3))
    z_axis = tuple(matrix[row][2] for row in range(3))
    return Plane(origin, x_axis, z_axis)


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


def _cylinder(center: Iterable[float], radius: float, z_bounds: list[float]) -> Solid:
    """Build a z-axis catalog cylinder in local coordinates."""
    x, y = (float(component) for component in center)
    z0, z1 = (float(component) for component in z_bounds)
    height = z1 - z0
    if not radius > 0.0 or not height > 0.0:
        raise ValueError(f"Cylinder needs positive radius and height: {radius!r}, {z_bounds!r}")
    return Pos(x, y, (z0 + z1) / 2.0) * Cylinder(float(radius), height)


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


def _intersect(operands: list[Shape]) -> Shape:
    if len(operands) != 2:
        raise ValueError("This twin only defines binary intersections")
    return _clean(operands[0].intersect(operands[1]))


def _label(zone_id: str, variant: str, result: Shape) -> list[Solid]:
    """Flatten a Boolean result to the individually labelled result solids."""
    solids = list(result.solids())
    for index, solid in enumerate(solids, start=1):
        solid.label = f"{zone_id}_{index}_{variant}"
    return solids


def _boxes(zone_id: str, variant: str) -> tuple[Plane, dict[str, Shape]]:
    """Construct all catalog boxes and apply their common zone frame."""
    plane = _zone_plane(zone_id, variant)
    boxes = ZONES[zone_id]["construction"]["params"]["boxes"]
    return plane, {name: _in_frame(_box(bounds), plane) for name, bounds in boxes.items()}


def ac10(variant: str) -> list[Solid]:
    """AC10: corner-overlap union."""
    _, boxes = _boxes("AC10", variant)
    return _label("AC10", variant, _fuse([boxes["A"], boxes["B"]]))


def ac11(variant: str) -> list[Solid]:
    """AC11: full-face-touch union."""
    _, boxes = _boxes("AC11", variant)
    return _label("AC11", variant, _fuse([boxes["A"], boxes["B"]]))


def ac12(variant: str) -> list[Solid]:
    """AC12: edge and vertex contact, preserving OCCT's three solid results."""
    _, boxes = _boxes("AC12", variant)
    return _label("AC12", variant, _fuse([boxes["A"], boxes["B"], boxes["C"]]))


def ac13(variant: str) -> list[Solid]:
    """AC13: regularised empty face-touch intersection."""
    _, boxes = _boxes("AC13", variant)
    return _label("AC13", variant, _intersect([boxes["A"], boxes["B"]]))


def ac14(variant: str) -> list[Solid]:
    """AC14: flush-sided U-channel subtraction."""
    _, boxes = _boxes("AC14", variant)
    return _label("AC14", variant, _cut(boxes["A"], [boxes["T"]]))


def ac15(variant: str) -> list[Solid]:
    """AC15: regularised empty coincident-solid subtraction."""
    _, boxes = _boxes("AC15", variant)
    return _label("AC15", variant, _cut(boxes["A"], [boxes["B"]]))


def ac16(variant: str) -> list[Solid]:
    """AC16: idempotent coincident-solid union."""
    _, boxes = _boxes("AC16", variant)
    return _label("AC16", variant, _fuse([boxes["A"], boxes["B"]]))


def ac17(variant: str) -> list[Solid]:
    """AC17: closed internal cavity subtraction."""
    _, boxes = _boxes("AC17", variant)
    return _label("AC17", variant, _cut(boxes["A"], [boxes["B"]]))


def ac18(variant: str) -> list[Solid]:
    """AC18: plate with four analytic through-cylinders."""
    zone = ZONES["AC18"]
    params = zone["construction"]["params"]
    plane = _zone_plane("AC18", variant)
    plate = _in_frame(_box(params["plate"]), plane)
    holes = [_in_frame(_cylinder(center, params["holes"]["radius"], params["holes"]["z"]), plane)
             for center in params["holes"]["centers"]]
    return _label("AC18", variant, _cut(plate, holes))


def _frame_point(plane: Plane, point: Iterable[float]) -> Vector:
    """Map a local catalog point to world coordinates through its zone Plane."""
    return plane.from_local_coords(_components(point))


def _ac49_top_face(result: Shape, plane: Plane, top_z: float) -> Shape:
    """Select the post-Boolean top face from the frame-relative local plane."""
    top_origin = _frame_point(plane, (0.0, 0.0, top_z))
    normal = plane.z_dir.normalized()
    candidates = [
        face for face in result.faces()
        if abs((face.center() - top_origin).dot(normal)) <= 1e-7
        and abs(face.normal_at().normalized().dot(normal)) >= 1.0 - 1e-9
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"AC49 expected one frame-relative top face, got {len(candidates)}")
    return candidates[0]


def _ac49_chamfer_edges(top_face: Shape, plane: Plane) -> list:
    """Select only local-X top rim lines and every top circular rim after the cut."""
    x_axis = plane.x_dir.normalized()
    selected = []
    for edge in top_face.edges():
        if edge.geom_type == GeomType.CIRCLE:
            selected.append(edge)
        elif edge.geom_type == GeomType.LINE and abs(edge.tangent_at().normalized().dot(x_axis)) >= 1.0 - 1e-9:
            selected.append(edge)
    if len(selected) != 3:
        raise RuntimeError(f"AC49 expected two local-X lines and one top circle, got {len(selected)} edges")
    return selected


def ac49(variant: str) -> list[Solid]:
    """AC49: frame-relative face and edge selection after a Boolean."""
    params = ZONES["AC49"]["construction"]["params"]
    plane = _zone_plane("AC49", variant)
    plate = _in_frame(_box(params["plate"]), plane)
    hole = _in_frame(_cylinder(params["hole"]["center"], params["hole"]["radius"], params["hole"]["z"]), plane)
    cut = _cut(plate, [hole])
    top = _ac49_top_face(cut, plane, float(params["plate"][1][2]))
    result = _clean(cut.chamfer(float(params["chamfer"]), float(params["chamfer"]), _ac49_chamfer_edges(top, plane)))
    return _label("AC49", variant, result)


BUILDERS = {
    "AC10": ac10,
    "AC11": ac11,
    "AC12": ac12,
    "AC13": ac13,
    "AC14": ac14,
    "AC15": ac15,
    "AC16": ac16,
    "AC17": ac17,
    "AC18": ac18,
    "AC49": ac49,
}


def build_group(variant: str) -> list[Solid]:
    """Build every Boolean zone for one catalog variant, flattened by solid."""
    return [solid for zone_id in ZONE_IDS for solid in BUILDERS[zone_id](variant)]
