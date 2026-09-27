"""Independent build123d/OCCT twin for CAD acid-test profile zones.

Each zone is constructed from the frozen catalog's local parameters on a Plane
that applies its grid-cell and metamorphic Variant frame before an operation is
run.  This module deliberately imports neither the FeatureScript twin nor a
kernel result: the catalog and its closed forms are the only specification.

Run with the pinned reference environment, for example:
  source out/build123d-performance/reference-venv/bin/activate
  uv run --active python fixtures/cad-acid/b3d/acid_profile.py V0
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from build123d import (
    Align,
    Axis,
    BuildLine,
    BuildPart,
    BuildSketch,
    Circle,
    Helix,
    Line,
    Locations,
    Mode,
    Plane,
    PolarLocations,
    Polyline,
    Rectangle,
    Solid,
    ThreePointArc,
    extrude,
    loft,
    make_face,
    mirror,
    revolve,
    sweep,
)

ROOT = Path(__file__).resolve().parents[3]
CATALOG_PATH = ROOT / "fixtures" / "cad-acid" / "zones.json"


with CATALOG_PATH.open(encoding="utf-8") as catalog_file:
    CATALOG = json.load(catalog_file)

PROFILE_GROUP = next(group for group in CATALOG["groups"] if group["id"] == "profile")
PROFILE_ZONE_IDS = tuple(PROFILE_GROUP["zoneIds"])
ZONES = {zone["id"]: zone for zone in CATALOG["zones"]}

Vector3 = tuple[float, float, float]
LabelledSolid = tuple[str, Solid]


def _mat_vec(matrix: tuple[Vector3, Vector3, Vector3], vector: Vector3) -> Vector3:
    return tuple(sum(matrix[row][column] * vector[column] for column in range(3)) for row in range(3))  # type: ignore[return-value]


def _add(*vectors: Vector3) -> Vector3:
    return tuple(sum(vector[index] for vector in vectors) for index in range(3))  # type: ignore[return-value]


def _scale(factor: float, vector: Vector3) -> Vector3:
    return tuple(factor * value for value in vector)  # type: ignore[return-value]


def _v3_matrix() -> tuple[Vector3, Vector3, Vector3]:
    """Rodrigues rotation for the catalog's 0.1 rad about (1,2,3)."""
    angle = 0.1
    norm = math.sqrt(14.0)
    x, y, z = 1.0 / norm, 2.0 / norm, 3.0 / norm
    cosine, sine, complement = math.cos(angle), math.sin(angle), 1.0 - math.cos(angle)
    return (
        (cosine + x * x * complement, x * y * complement - z * sine, x * z * complement + y * sine),
        (y * x * complement + z * sine, cosine + y * y * complement, y * z * complement - x * sine),
        (z * x * complement - y * sine, z * y * complement + x * sine, cosine + z * z * complement),
    )


@dataclass(frozen=True)
class Frame:
    """A catalog zone frame: cell origin plus exactly one V0--V3 transform."""

    zone: dict
    variant: str
    matrix: tuple[Vector3, Vector3, Vector3]
    offset: Vector3

    def point(self, local: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> Vector3:
        return _add(self.offset, _mat_vec(self.matrix, local))

    def vector(self, local: Vector3) -> Vector3:
        return _mat_vec(self.matrix, local)

    @property
    def xy(self) -> Plane:
        return Plane(self.point(), self.vector((1.0, 0.0, 0.0)), self.vector((0.0, 0.0, 1.0)))

    @property
    def xz(self) -> Plane:
        # Plane.XZ maps its two sketch coordinates to local (x, z) and has -y normal.
        return Plane(self.point(), self.vector((1.0, 0.0, 0.0)), self.vector((0.0, -1.0, 0.0)))

    def xy_at(self, local: tuple[float, float, float]) -> Plane:
        return Plane(self.point(local), self.vector((1.0, 0.0, 0.0)), self.vector((0.0, 0.0, 1.0)))

    @property
    def mirror_x0(self) -> Plane:
        # The local YZ plane has normal +X and local Y as its in-plane X direction.
        return Plane(self.point(), self.vector((0.0, 1.0, 0.0)), self.vector((1.0, 0.0, 0.0)))


def frame_for(zone: dict, variant: str) -> Frame:
    """Return the exact mapping `cellOrigin + Vk(local)` declared in zones.json."""
    if variant not in CATALOG["variants"] or variant == "rule" or variant == "passRule":
        raise ValueError(f"unknown acid-test variant: {variant}")

    cell_origin = tuple(float(value) for value in zone["cell"]["originMm"])
    if variant == "V0":
        matrix = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
        transform_offset = (0.0, 0.0, 0.0)
    elif variant == "V1":
        matrix = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
        transform_offset = tuple(float(value) for value in CATALOG["variants"][variant]["translationMm"])
    elif variant == "V2":
        matrix = tuple(tuple(float(value) for value in row) for row in CATALOG["variants"][variant]["matrix"])
        transform_offset = (0.0, 0.0, 0.0)
    else:  # V3 is the catalog's Rodrigues rotation through a local pivot.
        matrix = _v3_matrix()
        pivot = tuple(float(value) for value in CATALOG["variants"][variant]["throughPointMm"])
        transform_offset = _add(pivot, _scale(-1.0, _mat_vec(matrix, pivot)))

    return Frame(zone=zone, variant=variant, matrix=matrix, offset=_add(cell_origin, transform_offset))


def _solids(shape) -> list[Solid]:
    solids = list(shape.solids())
    if not solids:
        raise ValueError("profile construction returned no solids")
    return solids


def _label(zone_id: str, variant: str, solids: list[Solid]) -> list[LabelledSolid]:
    labelled = []
    for index, solid in enumerate(solids):
        label = f"{zone_id}_{index}_{variant}"
        solid.label = label
        labelled.append((label, solid))
    return labelled


def ac01(frame: Frame) -> list[LabelledSolid]:
    """AC01: concave L-profile extrude."""
    params = frame.zone["construction"]["params"]
    with BuildPart() as part:
        with BuildSketch(frame.xy):
            with BuildLine():
                Polyline(*(tuple(point) for point in params["polygon"]), close=True)
            make_face()
        extrude(amount=float(params["depth"]))
    return _label("AC01", frame.variant, _solids(part.part))


def ac02(frame: Frame) -> list[LabelledSolid]:
    """AC02: annular region from a square and one circular inner loop."""
    params = frame.zone["construction"]["params"]
    (x0, y0), (x1, y1) = params["square"]
    hole = params["hole"]
    with BuildPart() as part:
        with BuildSketch(frame.xy):
            with Locations((float(x0), float(y0))):
                Rectangle(float(x1 - x0), float(y1 - y0), align=(Align.MIN, Align.MIN))
            with Locations(tuple(float(value) for value in hole["center"])):
                Circle(float(hole["radius"]), mode=Mode.SUBTRACT)
        extrude(amount=float(params["depth"]))
    return _label("AC02", frame.variant, _solids(part.part))


def ac03(frame: Frame) -> list[LabelledSolid]:
    """AC03: obround from tangent lines and three-point semicircular arcs."""
    params = frame.zone["construction"]["params"]
    radius = float(params["a"])
    (left_x, center_y), (right_x, _) = params["centers"]
    with BuildPart() as part:
        with BuildSketch(frame.xy):
            with BuildLine():
                Line((left_x, center_y - radius), (right_x, center_y - radius))
                ThreePointArc((right_x, center_y - radius), (right_x + radius, center_y), (right_x, center_y + radius))
                Line((right_x, center_y + radius), (left_x, center_y + radius))
                ThreePointArc((left_x, center_y + radius), (left_x - radius, center_y), (left_x, center_y - radius))
            make_face()
        extrude(amount=float(params["depth"]))
    return _label("AC03", frame.variant, _solids(part.part))


def ac04(frame: Frame) -> list[LabelledSolid]:
    """AC04: quarter revolve of the catalog's XZ offset rectangle."""
    params = frame.zone["construction"]["params"]
    rho0, rho1 = (float(value) for value in params["rho"])
    z0, z1 = (float(value) for value in params["z"])
    with BuildPart() as part:
        with BuildSketch(frame.xz):
            with Locations((rho0, z0)):
                Rectangle(rho1 - rho0, z1 - z0, align=(Align.MIN, Align.MIN))
        revolve(axis=Axis(frame.point(), frame.vector((0.0, 0.0, 1.0))), revolution_arc=float(params["angleDeg"]))
    return _label("AC04", frame.variant, _solids(part.part))


def ac05(frame: Frame) -> list[LabelledSolid]:
    """AC05: ruled loft between the specified nested squares."""
    params = frame.zone["construction"]["params"]
    (bottom_x0, bottom_y0), (bottom_x1, bottom_y1) = params["bottom"]
    (top_x0, top_y0), (top_x1, top_y1) = params["top"]
    height = float(params["height"])
    with BuildPart() as part:
        with BuildSketch(frame.xy) as bottom:
            with Locations((float(bottom_x0), float(bottom_y0))):
                Rectangle(float(bottom_x1 - bottom_x0), float(bottom_y1 - bottom_y0), align=(Align.MIN, Align.MIN))
        with BuildSketch(frame.xy_at((0.0, 0.0, height))) as top:
            with Locations((float(top_x0), float(top_y0))):
                Rectangle(float(top_x1 - top_x0), float(top_y1 - top_y0), align=(Align.MIN, Align.MIN))
        loft([bottom.sketch, top.sketch], ruled=True)
    return _label("AC05", frame.variant, _solids(part.part))


def ac07(frame: Frame) -> list[LabelledSolid]:
    """AC07: circular sweep normal to the two-turn right-handed helix."""
    params = frame.zone["construction"]["params"]
    radius = float(params["R"])
    pitch = float(params["pitch"])
    turns = float(params["turns"])
    tube_radius = float(params["r"])
    height = pitch * turns
    # Build the analytic local helix, then apply the full Plane Location.  Passing
    # only a direction to Helix leaves its radial start direction underdefined.
    path = Helix(
        pitch=pitch,
        height=height,
        radius=radius,
        center=(0.0, 0.0, 0.0),
        direction=(0.0, 0.0, 1.0),
        mode=Mode.PRIVATE,
    ).moved(frame.xy.location)
    tangent = frame.vector((0.0, 2.0 * math.pi * radius / pitch, 1.0))
    section_plane = Plane(frame.point((radius, 0.0, 0.0)), frame.vector((1.0, 0.0, 0.0)), tangent)
    with BuildSketch(section_plane) as section:
        Circle(tube_radius)
    tube = sweep(section.sketch, path, is_frenet=True)
    return _label("AC07", frame.variant, _solids(tube))


def ac08(frame: Frame) -> list[LabelledSolid]:
    """AC08: separate polar pattern of four cylinders."""
    params = frame.zone["construction"]["params"]
    seed = params["seed"]
    center_x, center_y = (float(value) for value in seed["center"])
    radial_distance = math.hypot(center_x, center_y)
    count = int(params["count"])
    if count != 4 or float(params["stepDeg"]) != 360.0 / count:
        raise ValueError("AC08 catalog no longer describes the declared equal four-way polar pattern")
    # PolarLocations starts at +X. Its local locations are then placed through
    # the variant Plane, rather than through BuildPart's global Location stack.
    with PolarLocations(radial_distance, count, start_angle=0.0, rotate=False) as pattern:
        centers = [tuple(location.position) for location in pattern.local_locations]
    if tuple(round(value, 12) for value in centers[0][:2]) != (center_x, center_y):
        raise ValueError("AC08 polar pattern no longer starts at the catalog seed")
    if any(not math.isclose(math.hypot(*center[:2]), radial_distance) for center in centers):
        raise ValueError("AC08 polar instances are not all at the seed radius")
    solids = [
        Solid.make_cylinder(
            float(seed["radius"]),
            float(seed["height"]),
            plane=frame.xy_at((center[0], center[1], 0.0)),
        )
        for center in centers
    ]
    return _label("AC08", frame.variant, solids)


def ac09(frame: Frame) -> list[LabelledSolid]:
    """AC09: original asymmetric wedge and its disjoint local-x reflection."""
    params = frame.zone["construction"]["params"]
    with BuildPart() as part:
        with BuildSketch(frame.xy):
            with BuildLine():
                Polyline(*(tuple(point) for point in params["triangle"]), close=True)
            make_face()
        extrude(amount=float(params["depth"]))
    seed = _solids(part.part)
    reflected = _solids(mirror(part.part, about=frame.mirror_x0))
    return _label("AC09", frame.variant, [*seed, *reflected])


BUILDERS: dict[str, Callable[[Frame], list[LabelledSolid]]] = {
    "AC01": ac01,
    "AC02": ac02,
    "AC03": ac03,
    "AC04": ac04,
    "AC05": ac05,
    "AC07": ac07,
    "AC08": ac08,
    "AC09": ac09,
}


def build(variant: str, zone: str = "ALL") -> list[LabelledSolid]:
    """Build one profile zone or the full frozen profile group for a variant."""
    zone_ids = PROFILE_ZONE_IDS if zone == "ALL" else (zone,)
    unknown = [zone_id for zone_id in zone_ids if zone_id not in BUILDERS]
    if unknown:
        raise ValueError(f"zone is not in the profile group: {', '.join(unknown)}")

    result: list[LabelledSolid] = []
    for zone_id in zone_ids:
        result.extend(BUILDERS[zone_id](frame_for(ZONES[zone_id], variant)))
    return result


def build_group(variant: str) -> list[LabelledSolid]:
    """Build all AC profile solids under one V0--V3 frame selection."""
    return build(variant, zone="ALL")


if __name__ == "__main__":
    selected_variant = sys.argv[1] if len(sys.argv) == 2 else "V0"
    for label, solid in build_group(selected_variant):
        bounds = solid.bounding_box(optimal=True)
        print(
            json.dumps(
                {
                    "label": label,
                    "volumeMm3": solid.volume,
                    "areaMm2": solid.area,
                    "faces": len(solid.faces()),
                    "edges": len(solid.edges()),
                    "vertices": len(solid.vertices()),
                    "bboxMm": {"min": list(bounds.min), "max": list(bounds.max)},
                },
                allow_nan=False,
            )
        )
