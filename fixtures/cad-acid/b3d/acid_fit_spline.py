"""AC101 independent OCCT twin: cubic from contract poles and knots, never OCCT interpolation."""

from __future__ import annotations

import json
import math
from fractions import Fraction
from pathlib import Path
from typing import Iterable

from build123d import Plane, Shape, Solid


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


def ac101(variant: str) -> list[Solid]:
    """One whole cubic B-spline from contract poles, never OCCT interpolation."""
    from build123d import Edge, Wire, Face
    from OCP.Geom import Geom_BSplineCurve
    from OCP.TColgp import TColgp_Array1OfPnt
    from OCP.TColStd import TColStd_Array1OfReal, TColStd_Array1OfInteger
    from OCP.gp import gp_Pnt
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge
    params, plane = _params("AC101", variant), _zone_plane("AC101", variant)
    fit = params["fit"]
    poles = TColgp_Array1OfPnt(1,len(fit["poles"]))
    for i,p in enumerate(fit["poles"],1):
        poles.SetValue(i,gp_Pnt(float(Fraction(p[0])),float(Fraction(p[1])),0))
    distinct, mult = [], []
    for k in fit["knots"]:
        if distinct and distinct[-1] == k:
            mult[-1] += 1
        else:
            distinct.append(k); mult.append(1)
    knots = TColStd_Array1OfReal(1,len(distinct)); counts = TColStd_Array1OfInteger(1,len(distinct))
    for i,(k,n) in enumerate(zip(distinct,mult),1):
        knots.SetValue(i,float(Fraction(k))); counts.SetValue(i,n)
    curve = Geom_BSplineCurve(poles,knots,counts,3,False)
    side = Edge(BRepBuilderAPI_MakeEdge(curve).Edge())
    wire = Wire([Edge.make_line((0,0,0),(30,0,0)),side,Edge.make_line((30,28,0),(0,28,0)),Edge.make_line((0,28,0),(0,0,0))])
    solid = Solid.extrude(Face(wire),(0,0,float(params["depth"])))
    return _label("AC101",variant,_in_frame(solid,plane).clean())


BUILDERS = {"AC101": ac101}


def build_group(variant: str) -> list[Solid]:
    return ac101(variant) if variant in ZONES["AC101"]["variants"] else []
