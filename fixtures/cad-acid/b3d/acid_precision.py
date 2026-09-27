"""Independent build123d/OCCT twin for CAD acid precision zones AC39-AC48.

This module deliberately follows ``fixtures/cad-acid/zones.json``, not any
FeatureScript twin.  Each zone is authored in its own local coordinates.  The
shared zone frame is applied to every primitive before the Boolean, matching
the catalog's construction provenance rule.  In particular, E9 dimensions use
the frozen binary64 SI payload multiplied back to millimetres.

Public entry points:

* ``ac39(frame)`` through ``ac48(frame)`` return labelled result solids;
* ``build(variant, zone="ALL")`` builds an isolated zone or the full group;
* ``build_group(variant)`` builds the group's frozen-model smoke case.

The caller owns measurement, validity, and STEP round-trip scoring.  This file
constructs real OCCT B-reps only; it does not manufacture a verdict.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable

from build123d import Align, Box, Cylinder, Edge, Face, Location, Plane, Solid, Torus, Wire, extrude


ROOT = Path(__file__).resolve().parents[3]
CATALOG_PATH = ROOT / "fixtures" / "cad-acid" / "zones.json"
ZONE_IDS = ("AC39", "AC40", "AC41", "AC42", "AC43", "AC44", "AC45", "AC46", "AC47", "AC48")


def _load_cells() -> dict[str, tuple[float, float, float]]:
    """Read the frozen precision-zone cells instead of duplicating grid coordinates."""
    catalog = json.loads(CATALOG_PATH.read_text())
    cells = {
        zone["id"]: tuple(float(value) for value in zone["cell"]["originMm"])
        for zone in catalog["zones"]
        if zone["id"] in ZONE_IDS
    }
    missing = set(ZONE_IDS).difference(cells)
    if missing:
        raise ValueError(f"CAD acid precision cells missing from catalog: {sorted(missing)}")
    return cells


CELLS = _load_cells()


class Frame:
    """A rigid zone frame: cell origin plus the requested metamorphic variant."""

    def __init__(self, location: Location, z_dir: tuple[float, float, float], variant: str):
        self.location = location
        self.z_dir = z_dir
        self.variant = variant

    def transform(self, shape):
        """Apply this one rigid frame to an authored local B-rep."""
        return self.location * shape


def _rodrigues(axis: tuple[float, float, float], angle: float) -> tuple[tuple[float, float, float], ...]:
    """Return the f64 Rodrigues matrix used by V3's catalog construction."""
    x, y, z = axis
    cosine = math.cos(angle)
    sine = math.sin(angle)
    skew = ((0.0, -z, y), (z, 0.0, -x), (-y, x, 0.0))
    return tuple(
        tuple(
            cosine * float(row == column)
            + sine * skew[row][column]
            + (1.0 - cosine) * axis[row] * axis[column]
            for column in range(3)
        )
        for row in range(3)
    )


def _variant_matrix_and_translation(variant: str) -> tuple[tuple[tuple[float, float, float], ...], tuple[float, float, float]]:
    """Return Vk(p) = matrix * p + translation in the catalog's mm frame."""
    if variant == "V0":
        return ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), (0.0, 0.0, 0.0)
    if variant == "V1":
        return (
            ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
            (65536.25, -32768.5, 16384.125),
        )
    if variant == "V2":
        return ((0.0, -1.0, 0.0), (0.0, 0.0, -1.0), (1.0, 0.0, 0.0)), (0.0, 0.0, 0.0)
    if variant == "V3":
        axis_length = math.sqrt(14.0)
        axis = (1.0 / axis_length, 2.0 / axis_length, 3.0 / axis_length)
        matrix = _rodrigues(axis, 0.1)
        pivot = (3.0, -2.0, 5.0)
        translation = tuple(pivot[row] - sum(matrix[row][column] * pivot[column] for column in range(3)) for row in range(3))
        return matrix, translation
    raise ValueError(f"Unknown CAD acid variant {variant!r}; expected V0, V1, V2, or V3")


def zone_frame(zone_id: str, variant: str) -> Frame:
    """Build F(p) = cellOrigin + Vk(p), with an exact-vector V2 basis."""
    try:
        cell = CELLS[zone_id]
    except KeyError as error:
        raise ValueError(f"Unknown precision zone {zone_id!r}") from error
    matrix, translation = _variant_matrix_and_translation(variant)
    origin = tuple(cell[row] + translation[row] for row in range(3))
    x_dir = tuple(matrix[row][0] for row in range(3))
    z_dir = tuple(matrix[row][2] for row in range(3))
    return Frame(Location(Plane(origin, x_dir=x_dir, z_dir=z_dir)), z_dir, variant)


def _f64_payload_mm(expression: str) -> float:
    """Evaluate a catalog literal as FeatureScript's f64 metre payload, in mm.

    The expressions here are fixed source literals from this module, restricted
    to decimal numerals and ``+``/``-``.  The double conversion is intentional:
    ``fl(fl(L) * 0.001) * 1000`` is the binary64 construction basis declared
    by the catalog for E9 zones.
    """
    length_mm = float(eval(expression, {"__builtins__": {}}, {}))
    return float(length_mm * 0.001) * 1000.0


def _box(corner1: tuple[float, float, float], corner2: tuple[float, float, float]):
    """Create an axis-aligned local cuboid from its catalog corners."""
    lengths = tuple(corner2[index] - corner1[index] for index in range(3))
    return Location(corner1) * Box(*lengths, align=(Align.MIN, Align.MIN, Align.MIN))


def _cylinder(center_x: float, center_y: float, z0: float, z1: float, radius: float):
    """Create a local +Z cylinder from its catalog axis endpoints."""
    return Location((center_x, center_y, z0)) * Cylinder(
        radius,
        z1 - z0,
        align=(Align.CENTER, Align.CENTER, Align.MIN),
    )


def _solids(shape) -> list[Solid]:
    """Return actual B-rep solids, including an intentionally empty Boolean result."""
    return list(shape.solids())


def _label(zone_id: str, variant: str, solids: list[Solid]) -> list[Solid]:
    """Give every result body its stable zone/body/variant identity."""
    for index, solid in enumerate(solids):
        solid.label = f"{zone_id}_{index}_{variant}"
    return solids


def _labeled_zone(zone_id: str):
    """Decorate a zone constructor so direct calls also return stable labels."""
    def decorate(builder):
        def labeled(frame: Frame) -> list[Solid]:
            return _label(zone_id, frame.variant, builder(frame))
        labeled.__name__ = builder.__name__
        labeled.__doc__ = builder.__doc__
        return labeled
    return decorate


def _fuse(frame: Frame, first, second) -> list[Solid]:
    """Transform both local operands through one frame, then perform union."""
    return _solids(frame.transform(first).fuse(frame.transform(second)))


def _intersect(frame: Frame, first, second) -> list[Solid]:
    """Transform both local operands through one frame, then perform intersection."""
    return _solids(frame.transform(first).intersect(frame.transform(second)))


def _cut(frame: Frame, first, tool) -> list[Solid]:
    """Transform both local operands through one frame, then perform subtraction."""
    return _solids(frame.transform(first).cut(frame.transform(tool)))


@_labeled_zone("AC39")
def ac39(frame: Frame) -> list[Solid]:
    """Sub-resolution face gap, using the E9 metre payload rather than 2^-30 mm."""
    gap_start = _f64_payload_mm("8 + 0.000000000931322574615478515625")
    return _fuse(frame, _box((0.0, 0.0, 0.0), (8.0, 4.0, 4.0)), _box((gap_start, 0.0, 0.0), (16.0, 4.0, 4.0)))


@_labeled_zone("AC40")
def ac40(frame: Frame) -> list[Solid]:
    """Resolved face-gap control."""
    gap_start = _f64_payload_mm("8 + 0.0009765625")
    return _fuse(frame, _box((0.0, 0.0, 0.0), (8.0, 4.0, 4.0)), _box((gap_start, 0.0, 0.0), (16.0, 4.0, 4.0)))


@_labeled_zone("AC41")
def ac41(frame: Frame) -> list[Solid]:
    """Sub-resolution E9 overlap sliver intersection."""
    overlap_start = _f64_payload_mm("8 - 0.000000000931322574615478515625")
    return _intersect(frame, _box((0.0, 0.0, 0.0), (8.0, 4.0, 4.0)), _box((overlap_start, 0.0, 0.0), (16.0, 4.0, 4.0)))


@_labeled_zone("AC42")
def ac42(frame: Frame) -> list[Solid]:
    """Decimal E9 gap: build the frozen SI payload, not the decimal intent."""
    first_end = _f64_payload_mm("0.1 + 8.2")
    second_start = _f64_payload_mm("8.3")
    return _fuse(frame, _box((0.0, 0.0, 0.0), (first_end, 4.0, 4.0)), _box((second_start, 0.0, 0.0), (16.0, 4.0, 4.0)))


@_labeled_zone("AC43")
def ac43(frame: Frame) -> list[Solid]:
    """Decimal E9 contact control: the frozen endpoint values are equal."""
    first_end = _f64_payload_mm("1.68 + 10.1")
    second_start = _f64_payload_mm("11.78")
    return _fuse(frame, _box((0.0, 0.0, 0.0), (first_end, 4.0, 4.0)), _box((second_start, 0.0, 0.0), (16.0, 4.0, 4.0)))


@_labeled_zone("AC44")
def ac44(frame: Frame) -> list[Solid]:
    """Sub-resolution curved gap between cylinders."""
    second_center = _f64_payload_mm("8 + 0.000000000931322574615478515625")
    return _fuse(frame, _cylinder(0.0, 0.0, 0.0, 16.0, 4.0), _cylinder(second_center, 0.0, 0.0, 16.0, 4.0))


@_labeled_zone("AC45")
def ac45(frame: Frame) -> list[Solid]:
    """Extrude the deliberately open E9 wire without repairing or closing it."""
    open_end = _f64_payload_mm("0.000000000931322574615478515625")
    local_edges = [
        Edge.make_line((0.0, 0.0, 0.0), (16.0, 0.0, 0.0)),
        Edge.make_line((16.0, 0.0, 0.0), (16.0, 8.0, 0.0)),
        Edge.make_line((16.0, 8.0, 0.0), (0.0, 8.0, 0.0)),
        Edge.make_line((0.0, 8.0, 0.0), (0.0, open_end, 0.0)),
    ]
    local_wire = Wire.combine(local_edges)[0]
    world_face = Face(frame.transform(local_wire))
    return _solids(extrude(world_face, amount=4.0, dir=frame.z_dir, clean=False))


@_labeled_zone("AC46")
def ac46(frame: Frame) -> list[Solid]:
    """Resolved 2^-8 mm through-slot at large local coordinates."""
    slot_min = _f64_payload_mm("131072 + 8 - 0.001953125")
    slot_max = _f64_payload_mm("131072 + 8 + 0.001953125")
    plate = _box((131072.0, 0.0, 0.0), (131088.0, 16.0, 4.0))
    slot = _box((slot_min, 4.0, -1.0), (slot_max, 12.0, 5.0))
    return _cut(frame, plate, slot)


@_labeled_zone("AC47")
def ac47(frame: Frame) -> list[Solid]:
    """Micro cylindrical through-hole in a large plate."""
    plate = _box((0.0, 0.0, 0.0), (64.0, 64.0, 8.0))
    hole = _cylinder(32.0, 32.0, -1.0, 9.0, 0.00390625)
    return _cut(frame, plate, hole)


@_labeled_zone("AC48")
def ac48(frame: Frame) -> list[Solid]:
    """Horn torus (major radius equals minor radius) under the zone frame."""
    return _solids(frame.transform(Torus(4.0, 4.0)))


ZONE_BUILDERS: dict[str, Callable[[Frame], list[Solid]]] = {
    "AC39": ac39,
    "AC40": ac40,
    "AC41": ac41,
    "AC42": ac42,
    "AC43": ac43,
    "AC44": ac44,
    "AC45": ac45,
    "AC46": ac46,
    "AC47": ac47,
    "AC48": ac48,
}


def build(variant: str, zone: str = "ALL") -> list[Solid]:
    """Build one isolated precision zone or all zones for the group smoke case."""
    selected = ZONE_IDS if zone == "ALL" else (zone,)
    unknown = set(selected).difference(ZONE_BUILDERS)
    if unknown:
        raise ValueError(f"Unknown precision zone selector {sorted(unknown)}; expected ALL or one of {ZONE_IDS}")

    result: list[Solid] = []
    for zone_id in selected:
        result.extend(ZONE_BUILDERS[zone_id](zone_frame(zone_id, variant)))
    return result


def build_group(variant: str) -> list[Solid]:
    """Build the precision group's frozen-model smoke case for one variant."""
    return build(variant, zone="ALL")
