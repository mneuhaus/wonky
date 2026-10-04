"""Independent build123d/OCCT twin for CAD-acid curved zones AC19--AC28.

Every primitive is created in the zone's local coordinates, placed through the
catalogue's V0--V3 ``Plane(...).location`` frame into its curved-row grid cell,
and only then passed to the Boolean under test.  This mirrors the construction
provenance required by the frozen catalogue without importing FeatureScript.

Run from the pinned reference environment, for example:
  uv run --python out/build123d-performance/reference-venv/bin/python -- python ...
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Callable

from build123d import Align, Box, Compound, Cone, Cylinder, Location, Plane, Sphere, Torus
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse


ROOT = Path(__file__).resolve().parents[3]
CATALOG_PATH = ROOT / "fixtures" / "cad-acid" / "zones.json"
CATALOG = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
ZONES = {zone["id"]: zone for zone in CATALOG["zones"]}
CURVED_ZONE_IDS = tuple(f"AC{index}" for index in range(19, 29))
CURVED_ROW = 2
PITCH_MM = CATALOG["grid"]["pitchMm"]

Vector3 = tuple[float, float, float]


def _as_vector(values: list[float] | tuple[float, float, float]) -> Vector3:
    if len(values) != 3:
        raise ValueError(f"expected three coordinates, got {values!r}")
    return (float(values[0]), float(values[1]), float(values[2]))


def _add(left: Vector3, right: Vector3) -> Vector3:
    return tuple(a + b for a, b in zip(left, right, strict=True))  # type: ignore[return-value]


def _scale(value: Vector3, factor: float) -> Vector3:
    return tuple(factor * coordinate for coordinate in value)  # type: ignore[return-value]


def _mat_vec(matrix: list[list[float]], vector: Vector3) -> Vector3:
    return tuple(sum(float(matrix[row][column]) * vector[column] for column in range(3)) for row in range(3))  # type: ignore[return-value]


def _v3_rotation(variant: dict) -> tuple[list[list[float]], Vector3]:
    """Return the f64 Rodrigues frame documented for the inexact V3 variant."""
    axis = _as_vector(variant["axis"])
    norm = math.sqrt(sum(component * component for component in axis))
    unit = _scale(axis, 1.0 / norm)
    angle = float(variant["angleRad"])
    cosine, sine = math.cos(angle), math.sin(angle)
    kx, ky, kz = unit
    skew = ((0.0, -kz, ky), (kz, 0.0, -kx), (-ky, kx, 0.0))
    rotation = [
        [
            cosine * (1.0 if row == column else 0.0)
            + sine * skew[row][column]
            + (1.0 - cosine) * unit[row] * unit[column]
            for column in range(3)
        ]
        for row in range(3)
    ]
    pivot = _as_vector(variant["throughPointMm"])
    return rotation, _add(pivot, _scale(_mat_vec(rotation, pivot), -1.0))


def _variant_frame(zone_id: str, variant_name: str) -> Location:
    """Map local zone coordinates into the catalogue's grid cell and variant."""
    if variant_name not in CATALOG["variants"] or variant_name == "passRule":
        raise ValueError(f"unknown CAD-acid variant: {variant_name!r}")
    variant = CATALOG["variants"][variant_name]
    if variant_name == "V3":
        rotation, translation = _v3_rotation(variant)
    else:
        rotation = variant["matrix"]
        translation = _as_vector(variant["translationMm"])

    column = CURVED_ZONE_IDS.index(zone_id)
    cell_origin = (float(PITCH_MM * column), float(PITCH_MM * CURVED_ROW), 0.0)
    origin = _add(cell_origin, translation)
    x_direction = tuple(float(rotation[row][0]) for row in range(3))
    z_direction = tuple(float(rotation[row][2]) for row in range(3))
    return Plane(origin, x_direction, z_direction).location


def _operand(local_shape, zone_id: str, variant_name: str):
    """Place one construction operand before, never after, a Boolean."""
    return local_shape.moved(_variant_frame(zone_id, variant_name))


def _boolean(operation, left, right):
    """Realise the Boolean the zone's b3dFeatures names (fuse, cut, intersect).

    build123d 0.10.0's fuse/cut/intersect run the OCCT Boolean and then
    Shape.clean() (ShapeUpgrade_UnifySameDomain; SkipClean.clean defaults to
    True). This helper does the same with the serial Boolean for
    reproducibility; the only difference from build123d is its parallel flag,
    which changes no observed result (test/cad-acid.test.mjs compares every
    curved Boolean zone and variant with build123d's own operation).

    clean() is therefore part of every curved Boolean, not only of AC20, AC21
    and AC23, whose b3dFeatures also list it explicitly. It decides AC19: the
    raw Boolean leaves cylinder patches split at their seams (F6 E7 V5),
    clean() gives the closed form (F4 E4 V2); disclosed as catalog ambiguity
    CE3 in docs/cad-acid.md. clean() also turns AC27's valid lens (raw F3 E2
    V2, V 670.21) into an invalid full sphere (V 2144.66): that is
    UnifySameDomain, identical under build123d's own intersect and independent
    of the parallel flag.
    """
    algorithm = operation(left.wrapped, right.wrapped)
    algorithm.Build()
    if not algorithm.IsDone():
        raise RuntimeError(f"{operation.__name__} did not complete")
    return Compound.cast(algorithm.Shape()).clean()


def _axis_vector(axis: str) -> Vector3:
    try:
        return {"x": (1.0, 0.0, 0.0), "y": (0.0, 1.0, 0.0), "z": (0.0, 0.0, 1.0)}[axis]
    except KeyError as error:
        raise ValueError(f"unsupported cylinder axis in frozen catalogue: {axis!r}") from error


def _axis_start(axis: str, span_start: float, center: tuple[float, float] = (0.0, 0.0)) -> Vector3:
    if axis == "x":
        return (span_start, center[0], center[1])
    if axis == "y":
        return (center[0], span_start, center[1])
    if axis == "z":
        return (center[0], center[1], span_start)
    raise ValueError(f"unsupported cylinder axis in frozen catalogue: {axis!r}")


def _perpendicular_x(axis: str) -> Vector3:
    return {"x": (0.0, 1.0, 0.0), "y": (1.0, 0.0, 0.0), "z": (1.0, 0.0, 0.0)}[axis]


def _cylinder(axis: str, radius: float, span: list[float], center: tuple[float, float] = (0.0, 0.0)):
    start, end = (float(span[0]), float(span[1]))
    if not end > start:
        raise ValueError(f"cylinder span must increase, got {span!r}")
    local = Cylinder(float(radius), end - start, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return local.moved(Plane(_axis_start(axis, start, center), _perpendicular_x(axis), _axis_vector(axis)).location)


def _sphere(center: list[float], radius: float):
    return Sphere(float(radius)).moved(Location(_as_vector(center)))


def _box(corner0: list[float], corner1: list[float]):
    minimum, maximum = _as_vector(corner0), _as_vector(corner1)
    dimensions = tuple(high - low for low, high in zip(minimum, maximum, strict=True))
    if not all(dimension > 0.0 for dimension in dimensions):
        raise ValueError(f"box corners must define positive dimensions, got {corner0!r}, {corner1!r}")
    return Box(*dimensions, align=(Align.MIN, Align.MIN, Align.MIN)).moved(Location(minimum))


def _solids(zone_id: str, variant_name: str, result):
    solids = tuple(result.solids())
    if not solids:
        raise ValueError(f"{zone_id} {variant_name} produced no solids")
    for index, solid in enumerate(solids):
        solid.label = f"{zone_id}_{index}_{variant_name}"
    return solids


def _params(zone_id: str) -> dict:
    zone = ZONES[zone_id]
    if zone["group"] != "curved":
        raise ValueError(f"{zone_id} is not a curved CAD-acid zone")
    return zone["construction"]["params"]


def build_ac19(variant: str):
    params = _params("AC19")
    first = params["cylX"]
    second = params["cylY"]
    left = _operand(_cylinder(first["axis"], first["r"], first["span"]), "AC19", variant)
    right = _operand(_cylinder(second["axis"], second["r"], second["span"]), "AC19", variant)
    result = _boolean(BRepAlgoAPI_Common, left, right)
    return _solids("AC19", variant, result)


def build_ac20(variant: str):
    params = _params("AC20")
    post = params["C1"]
    branch = params["C2"]
    left = _operand(_cylinder(post["axis"], post["R"], post["span"]), "AC20", variant)
    right = _operand(_cylinder(branch["axis"], branch["r"], branch["span"]), "AC20", variant)
    result = _boolean(BRepAlgoAPI_Fuse, left, right)
    return _solids("AC20", variant, result)


def build_ac21(variant: str):
    params = _params("AC21")
    first, second = params["C1"], params["C2"]
    left = _operand(_cylinder("z", first["r"], first["z"]), "AC21", variant)
    right = _operand(_cylinder("z", second["r"], second["z"]), "AC21", variant)
    result = _boolean(BRepAlgoAPI_Fuse, left, right)
    return _solids("AC21", variant, result)


def build_ac22(variant: str):
    params = _params("AC22")
    first, second = params["C1"], params["C2"]
    left = _operand(_cylinder("z", first["r"], first["z"], tuple(first["center"])), "AC22", variant)
    right = _operand(_cylinder("z", second["r"], second["z"], tuple(second["center"])), "AC22", variant)
    result = _boolean(BRepAlgoAPI_Fuse, left, right)
    return _solids("AC22", variant, result)


def build_ac23(variant: str):
    params = _params("AC23")
    cutter = params["cutter"]
    cutter_shape = _cylinder("z", cutter["r"], cutter["z"], tuple(cutter["center"]))
    left = _operand(_box(*params["box"]), "AC23", variant)
    right = _operand(cutter_shape, "AC23", variant)
    result = _boolean(BRepAlgoAPI_Cut, left, right)
    return _solids("AC23", variant, result)


def build_ac24(variant: str):
    params = _params("AC24")
    left = _operand(_sphere(params["sphere"]["center"], params["sphere"]["r"]), "AC24", variant)
    right = _operand(_box(*params["box"]), "AC24", variant)
    result = _boolean(BRepAlgoAPI_Common, left, right)
    return _solids("AC24", variant, result)


def build_ac25(variant: str):
    triangle = _params("AC25")["triangle"]
    if triangle[0] != [0, 0] or triangle[1][1] != 0 or triangle[2][0] != 0:
        raise ValueError(f"AC25 must remain the axis-touching right-triangle profile, got {triangle!r}")
    result = _operand(
        Cone(float(triangle[1][0]), 0.0, float(triangle[2][1]), align=(Align.CENTER, Align.CENTER, Align.MIN)),
        "AC25",
        variant,
    )
    return _solids("AC25", variant, result)


def build_ac26(variant: str):
    circle = _params("AC26")["circle"]
    if float(circle["center"][1]) != 0.0:
        raise ValueError(f"AC26 profile must remain on the local X axis, got {circle!r}")
    result = _operand(Torus(float(circle["center"][0]), float(circle["r"])), "AC26", variant)
    return _solids("AC26", variant, result)


def build_ac27(variant: str):
    params = _params("AC27")
    first, second = params["S1"], params["S2"]
    left = _operand(_sphere(first["center"], first["r"]), "AC27", variant)
    right = _operand(_sphere(second["center"], second["r"]), "AC27", variant)
    result = _boolean(BRepAlgoAPI_Common, left, right)
    return _solids("AC27", variant, result)


def build_ac28(variant: str):
    params = _params("AC28")
    sphere, cylinder = params["sphere"], params["cylinder"]
    left = _operand(_sphere(sphere["center"], sphere["r"]), "AC28", variant)
    right = _operand(_cylinder("z", cylinder["r"], cylinder["z"]), "AC28", variant)
    result = _boolean(BRepAlgoAPI_Cut, left, right)
    return _solids("AC28", variant, result)


BUILDERS: dict[str, Callable[[str], tuple]] = {
    "AC19": build_ac19,
    "AC20": build_ac20,
    "AC21": build_ac21,
    "AC22": build_ac22,
    "AC23": build_ac23,
    "AC24": build_ac24,
    "AC25": build_ac25,
    "AC26": build_ac26,
    "AC27": build_ac27,
    "AC28": build_ac28,
}


def build_zone(zone_id: str, variant: str):
    """Build exactly one curved zone, isolating Boolean/refusal behaviour."""
    try:
        return BUILDERS[zone_id](variant)
    except KeyError as error:
        raise ValueError(f"unknown curved CAD-acid zone: {zone_id!r}") from error


def build_group(variant: str) -> Compound:
    """Build the frozen curved group as ten isolated grid-cell constructions."""
    solids = [solid for zone_id in CURVED_ZONE_IDS for solid in build_zone(zone_id, variant)]
    group = Compound(solids, children=solids)
    group.label = f"AC_CURVED_{variant}"
    return group
