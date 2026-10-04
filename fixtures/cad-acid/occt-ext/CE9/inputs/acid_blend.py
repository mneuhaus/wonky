"""Independent build123d/OCCT twin for CAD-acid blend zones AC29--AC38.

Each zone is authored in its own local frame.  ``Frame`` maps its construction
inputs into the catalog's grid cell and metamorphic variant *before* the OCCT
operation is performed.  This is intentional: post-transforming an already
filleted result would not exercise transformed construction provenance.

Public entry points:

* ``ac29(frame)`` through ``ac38(frame)`` return a list of labelled solids;
* ``build(variant, zone)`` builds one zone, or the complete group;
* ``build_group(variant)`` performs the group smoke build.  Typed operation
  refusals remain visible per zone so one failure cannot hide other results.

The acid runner loads this file by path with ``importlib`` because ``cad-acid``
is intentionally not a Python package name.  Use the pinned build123d reference
interpreter for every import or execution of this module.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Callable

from build123d import Edge, Face, Kind, Part, Plane, Solid, Vector, draft, offset
from OCP.BRep import BRep_Tool
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.Law import Law_Linear

CATALOG_PATH = Path(__file__).resolve().parents[1] / "zones.json"
CATALOG = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
GROUP = next(group for group in CATALOG["groups"] if group["id"] == "blend")
ZONES = {zone["id"]: zone for zone in CATALOG["zones"]}
ZONE_IDS = tuple(GROUP["zoneIds"])
CELL_PITCH_MM = CATALOG["grid"]["pitchMm"]
BLEND_ROW = next(index for index, group in enumerate(CATALOG["groups"]) if group["id"] == "blend")


class AcidRefusal(RuntimeError):
    """A named refusal raised by the operation under test; the catalog decides
    whether its category is accepted.  ``refusal_category`` and
    ``operation_under_test`` are the attributes scripts/acid/build-occt.py reads."""

    operation_under_test = True

    def __init__(self, category: str, message: str):
        super().__init__(message)
        self.category = category
        self.refusal_category = category


@dataclass(frozen=True)
class Frame:
    """Rigid map from a zone's local millimetres to its world cell."""

    origin: tuple[float, float, float]
    x: tuple[float, float, float]
    y: tuple[float, float, float]
    z: tuple[float, float, float]

    def point(self, point: tuple[float, float, float] | list[float]) -> tuple[float, float, float]:
        return tuple(
            self.origin[index]
            + self.x[index] * point[0]
            + self.y[index] * point[1]
            + self.z[index] * point[2]
            for index in range(3)
        )

    def vector(self, vector: tuple[float, float, float] | list[float]) -> tuple[float, float, float]:
        return tuple(
            self.x[index] * vector[0] + self.y[index] * vector[1] + self.z[index] * vector[2]
            for index in range(3)
        )

    def plane(
        self,
        local_origin: tuple[float, float, float] | list[float] = (0.0, 0.0, 0.0),
        local_x: tuple[float, float, float] | list[float] = (1.0, 0.0, 0.0),
        local_z: tuple[float, float, float] | list[float] = (0.0, 0.0, 1.0),
    ) -> Plane:
        return Plane(self.point(local_origin), self.vector(local_x), self.vector(local_z))


def _mat_vec(matrix: list[list[float]], vector: tuple[float, float, float]) -> tuple[float, float, float]:
    return tuple(sum(matrix[row][column] * vector[column] for column in range(3)) for row in range(3))


def _v3_matrix() -> list[list[float]]:
    """Rodrigues rotation from the predeclared V3 catalog construction."""

    definition = CATALOG["variants"]["V3"]
    axis = tuple(float(value) for value in definition["axis"])
    norm = math.sqrt(sum(value * value for value in axis))
    x, y, z = (value / norm for value in axis)
    cosine = math.cos(definition["angleRad"])
    sine = math.sin(definition["angleRad"])
    one_minus_cosine = 1.0 - cosine
    return [
        [cosine + x * x * one_minus_cosine, x * y * one_minus_cosine - z * sine, x * z * one_minus_cosine + y * sine],
        [y * x * one_minus_cosine + z * sine, cosine + y * y * one_minus_cosine, y * z * one_minus_cosine - x * sine],
        [z * x * one_minus_cosine - y * sine, z * y * one_minus_cosine + x * sine, cosine + z * z * one_minus_cosine],
    ]


def frame_for(zone_id: str, variant: str) -> Frame:
    """Create the catalog F(p) = cellOrigin + Vk(p) frame for one zone."""

    if zone_id not in ZONE_IDS:
        raise ValueError(f"{zone_id} is not a blend zone")
    if variant not in CATALOG["variants"]:
        raise ValueError(f"unknown CAD-acid variant: {variant}")

    definition = CATALOG["variants"][variant]
    if variant == "V3":
        matrix = _v3_matrix()
        pivot = tuple(float(value) for value in definition["throughPointMm"])
        rotated_pivot = _mat_vec(matrix, pivot)
        translation = tuple(pivot[index] - rotated_pivot[index] for index in range(3))
    else:
        matrix = [[float(value) for value in row] for row in definition["matrix"]]
        translation = tuple(float(value) for value in definition["translationMm"])

    column = ZONE_IDS.index(zone_id)
    cell = (CELL_PITCH_MM * column, CELL_PITCH_MM * BLEND_ROW, 0.0)
    origin = tuple(cell[index] + translation[index] for index in range(3))
    return Frame(
        origin=origin,
        x=_mat_vec(matrix, (1.0, 0.0, 0.0)),
        y=_mat_vec(matrix, (0.0, 1.0, 0.0)),
        z=_mat_vec(matrix, (0.0, 0.0, 1.0)),
    )


def _zone(zone_id: str) -> dict:
    return ZONES[zone_id]


def _box(frame: Frame, bounds: list[list[float]]) -> Solid:
    lower, upper = bounds
    return Solid.make_box(
        upper[0] - lower[0],
        upper[1] - lower[1],
        upper[2] - lower[2],
        frame.plane(lower),
    )


def _cylinder(frame: Frame, radius: float, span: list[float], axis: str, origin: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> Solid:
    """Make a cylinder from catalog-local coordinates, with its base at span[0]."""

    if axis == "z":
        local_base = (origin[0], origin[1], origin[2] + span[0])
        plane = frame.plane(local_base, (1.0, 0.0, 0.0), (0.0, 0.0, 1.0))
    elif axis == "x":
        local_base = (origin[0] + span[0], origin[1], origin[2])
        # Plane x is local +y and its normal is local +x; the radial basis is
        # irrelevant to the circular result but keeps the frame right-handed.
        plane = frame.plane(local_base, (0.0, 1.0, 0.0), (1.0, 0.0, 0.0))
    else:
        raise ValueError(f"unsupported cylinder axis {axis!r}")
    return Solid.make_cylinder(radius, span[1] - span[0], plane)


def _nearest(items, point: tuple[float, float, float]):
    """Pick an entity from a transformed shape using a transformed local point."""

    return items.sort_by_distance(Vector(*point))[0]


def _nearest_edge(shape: Part | Solid, frame: Frame, local_point: tuple[float, float, float]) -> Edge:
    return _nearest(shape.edges(), frame.point(local_point))


def _nearest_face(shape: Part | Solid, frame: Frame, local_point: tuple[float, float, float]) -> Face:
    return _nearest(shape.faces(), frame.point(local_point))


def _label(zone_id: str, variant: str, solids: list[Part | Solid]) -> list[Part | Solid]:
    for index, solid in enumerate(solids):
        solid.label = f"{zone_id}_{index}_{variant}"
    return solids


def _ac20_union(frame: Frame) -> Part | Solid:
    """The AC20 construction used by AC36, authored independently from any FS twin."""

    params = _zone("AC20")["construction"]["params"]
    post = _cylinder(frame, params["C1"]["R"], params["C1"]["span"], params["C1"]["axis"])
    branch = _cylinder(frame, params["C2"]["r"], params["C2"]["span"], params["C2"]["axis"])
    return post.fuse(branch)


def ac29(frame: Frame) -> list[Part | Solid]:
    params = _zone("AC29")["construction"]["params"]
    result = _box(frame, params["box"])
    result = result.fillet(params["radius"], [_nearest_edge(result, frame, (16.0, 12.0, 4.0))])
    return [result]


def ac30(frame: Frame) -> list[Part | Solid]:
    """Run the catalog's two native fillets in the declared order.

    The 4 + 12 mm equality is the operation under test.  OCCT 7.8 currently
    refuses the second call; returning the profile that the operation ought to
    have produced would be golden regeneration and would conceal that refusal.
    """

    params = _zone("AC30")["construction"]["params"]
    left_radius = params["edges"]["x=0,y=0"]
    right_radius = params["edges"]["x=16,y=0"]
    result = _box(frame, params["box"])
    # Select outside the try: only the fillet operations themselves may refuse.
    left_edge = _nearest_edge(result, frame, (0.0, 0.0, 8.0))
    try:
        result = result.fillet(left_radius, [left_edge])
    except Exception as error:
        raise AcidRefusal("critical-blend-not-done", f"OCCT rejected AC30's first (4 mm) fillet: {error}") from error
    right_edge = _nearest_edge(result, frame, (16.0, 0.0, 8.0))
    try:
        result = result.fillet(right_radius, [right_edge])
    except Exception as error:
        raise AcidRefusal("critical-blend-not-done", f"OCCT rejected AC30's exact 4 + 12 mm paired fillet: {error}") from error
    return [result]


def ac31(frame: Frame) -> list[Part | Solid]:
    """Only a named infeasible-blend refusal is accepted.

    A body OCCT returns anyway is handed to the scorer unchanged, which counts
    it WRONG (success where only a refusal is accepted). Raising here instead
    would turn that silent-wrong into an unnamed ERROR.
    """

    params = _zone("AC31")["construction"]["params"]
    plate = _box(frame, params["plate"])
    # Select outside the try: only the fillet operation itself may refuse.
    edge = _nearest_edge(plate, frame, (8.0, 0.0, 2.0))
    try:
        result = plate.fillet(params["radius"], [edge])
    except Exception as error:
        raise AcidRefusal("infeasible-blend", f"OCCT rejected AC31's infeasible 4 mm blend: {error}") from error
    return [result]


def ac32(frame: Frame) -> list[Part | Solid]:
    params = _zone("AC32")["construction"]["params"]
    radius = params["a"]
    left_center, right_center = params["centers"]
    height = params["h"]
    # The obround is the union of its rectangular centre strip and the two
    # analytic cylinders. Fusing removes the construction seams before the
    # top tangent chain is selected and filleted.
    centre_strip = _box(
        frame,
        [[left_center[0], left_center[1] - radius, 0.0], [right_center[0], right_center[1] + radius, height]],
    )
    left_cap = _cylinder(frame, radius, [0.0, height], "z", (left_center[0], left_center[1], 0.0))
    right_cap = _cylinder(frame, radius, [0.0, height], "z", (right_center[0], right_center[1], 0.0))
    result = centre_strip.fuse(left_cap).fuse(right_cap)
    top_edge_points = ((8.0, 0.0, height), (8.0, 8.0, height), (0.0, 4.0, height), (16.0, 4.0, height))
    top_edges: list[Edge] = []
    for point in top_edge_points:
        edge = _nearest_edge(result, frame, point)
        if edge not in top_edges:
            top_edges.append(edge)
    result = result.fillet(params["radius"], top_edges)
    return [result]


def ac33(frame: Frame) -> list[Part | Solid]:
    params = _zone("AC33")["construction"]["params"]
    cylinder = params["cylinder"]
    result = _cylinder(frame, cylinder["R"], [0.0, cylinder["h"]], "z")
    result = result.chamfer(params["chamfer"], None, [_nearest_edge(result, frame, (cylinder["R"], 0.0, cylinder["h"]))])
    return [result]


def ac34(frame: Frame) -> list[Part | Solid]:
    params = _zone("AC34")["construction"]["params"]
    lower, upper = params["box"]
    vertex = params["vertex"]
    result = _box(frame, params["box"])
    edge_points = (
        ((lower[0] + upper[0]) / 2.0, vertex[1], vertex[2]),
        (vertex[0], (lower[1] + upper[1]) / 2.0, vertex[2]),
        (vertex[0], vertex[1], (lower[2] + upper[2]) / 2.0),
    )
    result = result.fillet(params["radius"], [_nearest_edge(result, frame, point) for point in edge_points])
    return [result]


def ac35(frame: Frame) -> list[Part | Solid]:
    params = _zone("AC35")["construction"]["params"]
    result = _box(frame, params["box"])
    radius = params["radius"]
    edge = _nearest_edge(result, frame, (16.0, 12.0, 4.0))
    # The catalog law is linear (smoothTransition false).  Add(R1, R2, E) is not:
    # OCCT interpolates the two radii non-linearly (spring line off by up to
    # 0.11 mm).  Law_Linear on the edge's curve range realises r(z) = 2 + z/4;
    # the end at local z=0 is found from the curve itself, not the orientation.
    first, last = BRep_Tool.Range_s(edge.wrapped)
    start = BRep_Tool.Curve_s(edge.wrapped, first, last).Value(first)
    z_axis, origin = frame.vector((0.0, 0.0, 1.0)), frame.point((0.0, 0.0, 0.0))
    start_z = sum((c - origin[i]) * z_axis[i] for i, c in enumerate((start.X(), start.Y(), start.Z())))
    law = Law_Linear()
    if abs(start_z) < abs(start_z - 8.0):
        law.Set(first, radius["z=0"], last, radius["z=8"])
    else:
        law.Set(first, radius["z=8"], last, radius["z=0"])
    maker = BRepFilletAPI_MakeFillet(result.wrapped)
    maker.Add(law, edge.wrapped)
    maker.Build()
    if not maker.IsDone():
        raise RuntimeError("OCCT did not construct AC35's linear variable-radius blend")
    return [Part.cast(maker.Shape())]


def ac36(frame: Frame) -> list[Part | Solid]:
    params = _zone("AC36")["construction"]["params"]
    result = _ac20_union(frame)
    curve_point = (math.sqrt(48.0), 4.0, 0.0)
    result = result.fillet(params["radius"], [_nearest_edge(result, frame, curve_point)])
    return [result]


def ac37(frame: Frame) -> list[Part | Solid]:
    params = _zone("AC37")["construction"]["params"]
    lower, upper = params["box"]
    box = _box(frame, params["box"])
    top = _nearest_face(box, frame, ((lower[0] + upper[0]) / 2.0, (lower[1] + upper[1]) / 2.0, upper[2]))
    # INTERSECTION creates the catalog's sharp internal corners. ARC would
    # create the explicitly silent-wrong rounded-corner shell.
    return [offset(box, amount=-params["thickness"], openings=[top], kind=Kind.INTERSECTION)]


def ac38(frame: Frame) -> list[Part | Solid]:
    params = _zone("AC38")["construction"]["params"]
    lower, upper = params["box"]
    box = _box(frame, params["box"])
    face = _nearest_face(box, frame, (upper[0], (lower[1] + upper[1]) / 2.0, (lower[2] + upper[2]) / 2.0))
    tangent = float(Fraction(params["tanAngle"]))
    # A positive angle moves the top edge inward from x=16 to x=15 while
    # retaining the lower edge on the neutral local z=0 plane.
    return [draft(face, frame.plane((0.0, 0.0, lower[2])), math.degrees(math.atan(tangent)))]


ZONE_FUNCTIONS: dict[str, Callable[[Frame], list[Part | Solid]]] = {
    "AC29": ac29,
    "AC30": ac30,
    "AC31": ac31,
    "AC32": ac32,
    "AC33": ac33,
    "AC34": ac34,
    "AC35": ac35,
    "AC36": ac36,
    "AC37": ac37,
    "AC38": ac38,
}


def build(variant: str, zone: str = "ALL") -> list[Part | Solid] | dict[str, list[Part | Solid] | AcidRefusal]:
    """Build one blend zone, or all zones in catalog order for a smoke run."""

    if zone == "ALL":
        return build_group(variant)
    try:
        builder = ZONE_FUNCTIONS[zone]
    except KeyError as error:
        raise ValueError(f"unknown blend zone: {zone}") from error
    return _label(zone, variant, builder(frame_for(zone, variant)))


def build_group(variant: str) -> dict[str, list[Part | Solid] | AcidRefusal]:
    """Build all blend zones while retaining each typed operation refusal."""

    result: dict[str, list[Part | Solid] | AcidRefusal] = {}
    for zone_id in ZONE_IDS:
        try:
            result[zone_id] = build(variant, zone_id)
        except AcidRefusal as refusal:
            result[zone_id] = refusal
    return result
