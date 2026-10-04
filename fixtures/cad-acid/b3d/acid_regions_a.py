"""Independent build123d/OCCT twin for CAD acid regions-a zones AC52, AC53, AC56, AC57, AC91, AC92,
AC93, AC95, AC99.

Each constructor reads its dimensions from the frozen catalog and sketches on the zone
plane F = cellOrigin + Vk (the catalog's sketch frame; V4/V5 use V0's frame), then
extrudes 4 mm along the plane normal.  Point-picked regions (AC52, AC53, AC92) come from
the planar arrangement of the sketch curves: a large face on the sketch plane is split by
every sketch edge (OCCT BOPAlgo_Splitter), the exterior face is dropped, and the region
containing the catalog point is extruded (AC52/AC92 V5: every region; AC99 V5: the region
closest to the point).  Point picks: AC52, AC53, AC92, AC93, AC99.  Holed regions (AC56, AC57,
AC91, AC95) use the BuildSketch subtract idiom of the v1 profile twin.  Every extruded region gets
the catalog's b3d refine step clean() (UnifySameDomain), as the other twins do.  The V5
Boolean idioms of AC57 and AC91 build local operands, move all of them with the zone frame,
then cut.  The module never reads the FeatureScript twin or a kernel result.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Iterable

from build123d import (
    Align,
    BuildLine,
    BuildSketch,
    Circle,
    Cylinder,
    Edge,
    Face,
    Line,
    Locations,
    Mode,
    Plane,
    Polyline,
    Pos,
    Rectangle,
    Shape,
    Solid,
    ThreePointArc,
    make_face,
)
from OCP.BOPAlgo import BOPAlgo_Splitter
from OCP.BRepClass import BRepClass_FaceClassifier
from OCP.TopAbs import TopAbs_FACE, TopAbs_IN
from OCP.TopExp import TopExp
from OCP.TopTools import TopTools_IndexedMapOfShape
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Pnt


ROOT = Path(__file__).resolve().parents[3]
CATALOG = json.loads((ROOT / "fixtures/cad-acid/zones.json").read_text())
ZONES = {zone["id"]: zone for zone in CATALOG["zones"]}
GROUP = next(group for group in CATALOG["groups"] if group["id"] == "regions-a")
ZONE_IDS = tuple(GROUP["zoneIds"])
EXTERIOR_POINT = (-95.0, -95.0)  # local; every regions-a sketch lies inside [-10, 30]^2


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
        raise ValueError(f"{zone_id} is not a regions-a acid zone")
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


def _depth(params: dict) -> float:
    return float(params["depth"])


def _world(plane: Plane, local_xy) -> tuple[float, float, float]:
    point = plane.from_local_coords((float(local_xy[0]), float(local_xy[1]), 0.0))
    return (point.X, point.Y, point.Z)


def _circle_edge(plane: Plane, centre, radius: float) -> Edge:
    return Edge.make_circle(float(radius), Plane(_world(plane, centre), plane.x_dir, plane.z_dir))


def _line_edge(plane: Plane, start, end) -> Edge:
    return Edge.make_line(_world(plane, start), _world(plane, end))


def _rect_edges(plane: Plane, corner0, corner1) -> list[Edge]:
    (x0, y0), (x1, y1) = corner0, corner1
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return [_line_edge(plane, corners[index], corners[(index + 1) % 4]) for index in range(4)]


def _contains(face: Face, point) -> bool:
    return BRepClass_FaceClassifier(face.wrapped, gp_Pnt(*point), 1e-7).State() == TopAbs_IN


def _sketch_regions(plane: Plane, edges: list[Edge]) -> list[Face]:
    """Bounded faces of the planar arrangement of the sketch edges (the sketch regions)."""
    canvas = Face.make_rect(200.0, 200.0, Plane(_world(plane, (0.0, 0.0)), plane.x_dir, plane.z_dir))
    splitter = BOPAlgo_Splitter()
    splitter.AddArgument(canvas.wrapped)
    for edge in edges:
        splitter.AddTool(edge.wrapped)
    splitter.SetRunParallel(False)
    splitter.Perform()
    if splitter.HasErrors():
        raise RuntimeError("SKETCH_REGIONS: BOPAlgo_Splitter failed")
    found = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(splitter.Shape(), TopAbs_FACE, found)
    faces = [Face(TopoDS.Face_s(found.FindKey(index))) for index in range(1, found.Extent() + 1)]
    outside = _world(plane, EXTERIOR_POINT)
    regions = [face for face in faces if not _contains(face, outside)]
    if len(regions) != len(faces) - 1:
        raise RuntimeError("SKETCH_REGIONS: exactly one exterior face expected")
    return regions


def _region_at(plane: Plane, regions: list[Face], local_xy) -> Face:
    hits = [face for face in regions if _contains(face, _world(plane, local_xy))]
    if len(hits) != 1:
        raise RuntimeError(f"SKETCH_REGIONS: {len(hits)} regions contain {local_xy}")
    return hits[0]


def _extrude(face: Face, plane: Plane, depth: float) -> Solid:
    """Extrude one region along the plane normal, then the catalog's b3d refine step (clean() =
    UnifySameDomain): a region arc that the splitter keeps split at its circle's parametric
    origin would otherwise extrude into two cylindrical faces of one surface (not canonical)."""
    direction = plane.z_dir
    return Solid.extrude(face, (direction.X * depth, direction.Y * depth, direction.Z * depth)).clean()


def _label(zone_id: str, variant: str, solids: list[Solid]) -> list[Solid]:
    labelled = []
    for index, solid in enumerate(solids):
        for piece in solid.solids():
            piece.label = f"{zone_id}_{index}_{variant}"
            labelled.append(piece)
    return labelled


def _moved(shape: Shape, plane: Plane) -> Shape:
    """Primitive+transform frame: one shared placement of a local operand before the Boolean."""
    return shape.moved(plane.location)


def _cut(target: Shape, tools: list[Shape]) -> Shape:
    return target.cut(*tools).clean()


def _local_cylinder(centre, z0: float, z1: float, radius: float) -> Solid:
    return Pos(float(centre[0]), float(centre[1]), (z0 + z1) / 2.0) * Cylinder(float(radius), z1 - z0)


def ac52(variant: str) -> list[Solid]:
    """AC52: two overlapping circles, three regions (lens, two crescents), three bodies."""
    params, plane = _params("AC52", variant), _zone_plane("AC52", variant)
    edges = [_circle_edge(plane, circle["center"], circle["radius"]) for circle in params["circles"]]
    regions = _sketch_regions(plane, edges)
    if variant == "V5":
        picked = regions
    else:
        picked = [_region_at(plane, regions, params["regionPoints"][name]) for name in ("lens", "left", "right")]
    return _label("AC52", variant, [_extrude(face, plane, _depth(params)) for face in picked])


def ac53(variant: str) -> list[Solid]:
    """AC53: circle split by an overhanging diameter line; the region containing (0,2) is extruded."""
    params, plane = _params("AC53", variant), _zone_plane("AC53", variant)
    edges = [_circle_edge(plane, params["circle"]["center"], params["circle"]["radius"]),
             _line_edge(plane, *params["line"])]
    regions = _sketch_regions(plane, edges)
    return _label("AC53", variant, [_extrude(_region_at(plane, regions, params["regionPoint"]), plane, _depth(params))])


def ac56(variant: str) -> list[Solid]:
    """AC56: nested rectangles; the frame between them is extruded (V5 draws them as polylines)."""
    params, plane = _params("AC56", variant), _zone_plane("AC56", variant)
    (ox0, oy0), (ox1, oy1) = params["outer"]
    (ix0, iy0), (ix1, iy1) = params["inner"]
    with BuildSketch(plane) as sketch:
        if variant == "V5":
            with BuildLine():
                Polyline((ox0, oy0), (ox1, oy0), (ox1, oy1), (ox0, oy1), close=True)
            make_face()
            with BuildLine():
                Polyline((ix0, iy0), (ix1, iy0), (ix1, iy1), (ix0, iy1), close=True)
            make_face(mode=Mode.SUBTRACT)
        else:
            with Locations((float(ox0), float(oy0))):
                Rectangle(float(ox1 - ox0), float(oy1 - oy0), align=(Align.MIN, Align.MIN))
            with Locations((float(ix0), float(iy0))):
                Rectangle(float(ix1 - ix0), float(iy1 - iy0), align=(Align.MIN, Align.MIN), mode=Mode.SUBTRACT)
    return _label("AC56", variant, [_extrude(face, plane, _depth(params)) for face in sketch.sketch.faces()])


def ac57(variant: str) -> list[Solid]:
    """AC57: rectangle with three bore circles; the holed region is extruded (V5: plate cut by three cylinders)."""
    params, plane = _params("AC57", variant), _zone_plane("AC57", variant)
    (x0, y0), (x1, y1) = params["rectangle"]
    centres, radius, depth = params["holes"]["centers"], float(params["holes"]["radius"]), _depth(params)
    if variant == "V5":
        with BuildSketch(Plane.XY) as local:
            with Locations((float(x0), float(y0))):
                Rectangle(float(x1 - x0), float(y1 - y0), align=(Align.MIN, Align.MIN))
        plate = Solid.extrude(local.sketch.faces()[0], (0.0, 0.0, depth))
        z0, z1 = (float(value) for value in params["v5ToolZ"])
        tools = [_moved(_local_cylinder(centre, z0, z1, radius), plane) for centre in centres]
        return _label("AC57", variant, list(_cut(_moved(plate, plane), tools).solids()))
    with BuildSketch(plane) as sketch:
        with Locations((float(x0), float(y0))):
            Rectangle(float(x1 - x0), float(y1 - y0), align=(Align.MIN, Align.MIN))
        with Locations(*[(float(cx), float(cy)) for cx, cy in centres]):
            Circle(radius, mode=Mode.SUBTRACT)
    return _label("AC57", variant, [_extrude(face, plane, depth) for face in sketch.sketch.faces()])


def _obround_faces(plane: Plane, params: dict, hole: dict | None = None) -> list[Face]:
    """The obround region on `plane`; with `hole`, minus the disc (the holed region)."""
    first, second = params["arcs"]
    (bottom_start, bottom_end), (top_start, top_end) = params["lines"]
    with BuildSketch(plane) as sketch:
        with BuildLine():
            ThreePointArc(tuple(first["start"]), tuple(first["mid"]), tuple(first["end"]))
            Line(tuple(bottom_start), tuple(bottom_end))
            ThreePointArc(tuple(second["start"]), tuple(second["mid"]), tuple(second["end"]))
            Line(tuple(top_start), tuple(top_end))
        make_face()
        if hole is not None:
            with Locations(tuple(float(value) for value in hole["center"])):
                Circle(float(hole["radius"]), mode=Mode.SUBTRACT)
    return list(sketch.sketch.faces())


def ac91(variant: str) -> list[Solid]:
    """AC91: obround from three-point arcs and tangent lines with a concentric round hole (V5: cylinder cut)."""
    params, plane = _params("AC91", variant), _zone_plane("AC91", variant)
    hole, depth = params["hole"], _depth(params)
    if variant == "V5":
        body = Solid.extrude(_obround_faces(Plane.XY, params)[0], (0.0, 0.0, depth))
        z0, z1 = (float(value) for value in params["v5ToolZ"])
        tool = _moved(_local_cylinder(hole["center"], z0, z1, float(hole["radius"])), plane)
        return _label("AC91", variant, list(_cut(_moved(body, plane), [tool]).solids()))
    return _label("AC91", variant, [_extrude(face, plane, depth) for face in _obround_faces(plane, params, hole)])


def ac92(variant: str) -> list[Solid]:
    """AC92: overlapping rectangles, three regions (two L-shapes and the overlap), three bodies."""
    params, plane = _params("AC92", variant), _zone_plane("AC92", variant)
    edges = [edge for corner0, corner1 in params["rectangles"] for edge in _rect_edges(plane, corner0, corner1)]
    regions = _sketch_regions(plane, edges)
    if variant == "V5":
        picked = regions
    else:
        picked = [_region_at(plane, regions, params["regionPoints"][name]) for name in ("first", "overlap", "second")]
    return _label("AC92", variant, [_extrude(face, plane, _depth(params)) for face in picked])


def ac93(variant: str) -> list[Solid]:
    """AC93: rectangle split by a line whose ends overhang; the two halves are picked by point (two bodies)."""
    params, plane = _params("AC93", variant), _zone_plane("AC93", variant)
    (x0, y0), (x1, y1) = params["rectangle"]
    if variant == "V5":  # closed polyline instead of a rectangle primitive: the same four edges
        corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
        edges = [_line_edge(plane, corners[index], corners[index + 1]) for index in range(4)]
    else:
        edges = _rect_edges(plane, (x0, y0), (x1, y1))
    regions = _sketch_regions(plane, edges + [_line_edge(plane, *params["line"])])
    picked = [_region_at(plane, regions, params["regionPoints"][name]) for name in ("left", "right")]
    return _label("AC93", variant, [_extrude(face, plane, _depth(params)) for face in picked])


def _hex_corners(params: dict, variant: str) -> list[tuple[float, float]]:
    """V0: the catalog's corner expressions in h (h = 6/sqrt(3) in binary64); V5: circumradius * (cos, sin)."""
    hexagon = params["hexagon"]
    evaluate = lambda text, names: float(eval(str(text), {"__builtins__": {}}, {"sqrt": math.sqrt, **names}))
    if variant == "V5":
        spec = hexagon["v5Corners"]
        radius = evaluate(spec["circumradius"], {})
        angles = [math.radians(float(spec["firstAngleDeg"]) + index * float(spec["stepDeg"])) for index in range(6)]
        return [(radius * math.cos(angle), radius * math.sin(angle)) for angle in angles]
    h = evaluate(hexagon["h"], {})
    return [(evaluate(x, {"h": h}), evaluate(y, {"h": h})) for x, y in hexagon["corners"]]


def ac95(variant: str) -> list[Solid]:
    """AC95: hexagon (across flats 12, irrational corners) with a central circle; the holed region is extruded."""
    params, plane = _params("AC95", variant), _zone_plane("AC95", variant)
    corners = _hex_corners(params, variant)
    with BuildSketch(plane) as sketch:
        with BuildLine():
            Polyline(*corners, close=True)
        make_face()
        with Locations(tuple(float(value) for value in params["hole"]["center"])):
            Circle(float(params["hole"]["radius"]), mode=Mode.SUBTRACT)
    return _label("AC95", variant, [_extrude(face, plane, _depth(params)) for face in sketch.sketch.faces()])


def ac99(variant: str) -> list[Solid]:
    """AC99: two separate rectangles; only the region at the catalog point is extruded (V5: the region closest to it)."""
    params, plane = _params("AC99", variant), _zone_plane("AC99", variant)
    edges = [edge for corner0, corner1 in params["rectangles"] for edge in _rect_edges(plane, corner0, corner1)]
    regions = _sketch_regions(plane, edges)
    if variant == "V5":
        point = _world(plane, params["regionPoint"])
        picked = min(regions, key=lambda face: face.distance_to(point))
    else:
        picked = _region_at(plane, regions, params["regionPoint"])
    return _label("AC99", variant, [_extrude(picked, plane, _depth(params))])


BUILDERS = {"AC52": ac52, "AC53": ac53, "AC56": ac56, "AC57": ac57, "AC91": ac91, "AC92": ac92,
            "AC93": ac93, "AC95": ac95, "AC99": ac99}


def build_group(variant: str) -> list[Solid]:
    """Every regions-a zone that declares the variant (zone = ALL smoke), flattened by solid."""
    return [solid for zone_id in ZONE_IDS if variant in ZONES[zone_id]["variants"] for solid in BUILDERS[zone_id](variant)]
