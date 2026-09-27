"""Generate synthetic OpenCascade reference cases for Rust-kernel validation.

OCCT is an independent test oracle only; this script never constructs geometry
for the production kernel. Run with the repository's pinned reference venv:

    uv run --python out/build123d-performance/reference-venv/bin/python \\
      scripts/rust/occt-oracle/generate.py
    uv run --python out/build123d-performance/reference-venv/bin/python \\
      scripts/rust/occt-oracle/generate.py --check
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.metadata
import json
import math
import re
import tempfile
from pathlib import Path
from typing import Any

import OCP
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakePolygon,
    BRepBuilderAPI_Transform,
)
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.BRepGProp import BRepGProp
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepPrimAPI import (
    BRepPrimAPI_MakeBox,
    BRepPrimAPI_MakeCone,
    BRepPrimAPI_MakeCylinder,
    BRepPrimAPI_MakePrism,
    BRepPrimAPI_MakeSphere,
)
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Reader, STEPControl_Writer
from OCP.StlAPI import StlAPI_Writer
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_VERTEX
from OCP.TopExp import TopExp, TopExp_Explorer
from OCP.TopTools import TopTools_IndexedMapOfShape
from OCP.TopoDS import TopoDS
from OCP.GeomAbs import GeomAbs_Line
from OCP.gp import gp_Pnt, gp_Trsf, gp_Vec

ROOT = Path(__file__).resolve().parents[3]
ORACLE_DIR = ROOT / "fixtures/rust/occt-oracle"
DEFAULT_CORPUS = ORACLE_DIR / "corpus.json"
DEFAULT_EXPORTS = ORACLE_DIR / "exports"
ANALYTIC_REL_TOL = 2e-10
ANALYTIC_ABS_TOL = 2e-9
STEP_ROUNDTRIP_REL_TOL = 1e-7
STEP_ROUNDTRIP_ABS_TOL = 1e-7
STL_BBOX_TOL = 0.11  # Mesh deflection is 0.1 mm.



def _box(size: list[float], origin: list[float] | None = None) -> dict[str, Any]:
    return {"kind": "box", "size": size, "origin": origin or [0.0, 0.0, 0.0]}


def _cylinder(radius: float, height: float, position: list[float] | None = None) -> dict[str, Any]:
    return {"kind": "cylinder", "radius": radius, "height": height, "position": position or [0.0, 0.0, 0.0]}


def _analytic_primitives() -> list[dict[str, Any]]:
    box_size = [20.0, 30.0, 40.0]
    prism_points = [[0.0, 0.0], [6.0, 0.0], [0.0, 8.0]]
    prism_height = 10.0
    prism_base_area = 24.0
    prism_perimeter = 24.0
    return [
        {
            "id": "primitive-box",
            "operation": "primitive",
            "geometry": _box(box_size),
            "analytic": {
                "volume": math.prod(box_size),
                "area": 2.0 * (box_size[0] * box_size[1] + box_size[1] * box_size[2] + box_size[2] * box_size[0]),
            },
        },
        {
            "id": "primitive-prism",
            "operation": "primitive",
            "geometry": {"kind": "prism", "points": prism_points, "height": prism_height},
            "analytic": {
                "volume": prism_base_area * prism_height,
                "area": prism_perimeter * prism_height + 2.0 * prism_base_area,
            },
        },
        {
            "id": "primitive-cylinder",
            "operation": "primitive",
            "geometry": _cylinder(5.0, 12.0),
            "analytic": {
                "volume": math.pi * 5.0**2 * 12.0,
                "area": 2.0 * math.pi * 5.0 * (5.0 + 12.0),
            },
        },
        {
            "id": "primitive-cone",
            "operation": "primitive",
            "geometry": {"kind": "cone", "r1": 6.0, "r2": 2.0, "height": 10.0},
            "analytic": {
                "volume": math.pi * 10.0 * (6.0**2 + 6.0 * 2.0 + 2.0**2) / 3.0,
                "area": math.pi * (6.0**2 + 2.0**2) + math.pi * (6.0 + 2.0) * math.hypot(10.0, 4.0),
            },
        },
        {
            "id": "primitive-sphere",
            "operation": "primitive",
            "geometry": {"kind": "sphere", "radius": 7.0},
            "analytic": {"volume": 4.0 * math.pi * 7.0**3 / 3.0, "area": 4.0 * math.pi * 7.0**2},
        },
    ]


def _boolean_cases() -> list[dict[str, Any]]:
    operations = ("union", "subtract", "intersect")
    cases: list[dict[str, Any]] = []

    overlapping_boxes = (_box([10.0, 10.0, 10.0]), _box([8.0, 8.0, 8.0], [6.0, 4.0, 3.0]))
    coplanar_boxes = (_box([10.0, 10.0, 10.0]), _box([10.0, 10.0, 10.0], [5.0, 0.0, 0.0]))
    for label, pair in (("overlap", overlapping_boxes), ("coplanar-coincident-faces", coplanar_boxes)):
        for operation in operations:
            cases.append({
                "id": f"boolean-{label}-{operation}",
                "operation": "boolean",
                "boolean": operation,
                "left": pair[0],
                "right": pair[1],
            })

    # The radii and center offsets encode exact internal tangency at 6 - 2 = 4 mm.
    # The two neighboring placements exercise a small contained clearance and a
    # small protrusion without creating empty intersections that STEP cannot carry.
    for label, distance in (("internal-tangent", 4.0), ("near-tangent-contained", 3.999), ("near-tangent-protruding", 4.001)):
        left = {"kind": "sphere", "radius": 6.0}
        right = {"kind": "sphere", "radius": 2.0, "position": [distance, 0.0, 0.0]}
        for operation in operations:
            cases.append({
                "id": f"boolean-sphere-{label}-{operation}",
                "operation": "boolean",
                "boolean": operation,
                "left": left,
                "right": right,
            })

    # Contact-only intersections are valid empty results in OCCT. STEP does not
    # round-trip these as transferred roots, so they are checked as empties.
    empty_intersections = (
        ("sphere-external-tangent", {"kind": "sphere", "radius": 2.0}, {"kind": "sphere", "radius": 2.0, "position": [4.0, 0.0, 0.0]}),
        ("box-face-tangent", _box([10.0, 10.0, 10.0]), _box([10.0, 10.0, 10.0], [10.0, 0.0, 0.0])),
        ("box-near-disjoint", _box([10.0, 10.0, 10.0]), _box([10.0, 10.0, 10.0], [10.001, 0.0, 0.0])),
    )
    for label, left, right in empty_intersections:
        cases.append({
            "id": f"boolean-{label}-intersect",
            "operation": "boolean",
            "boolean": "intersect",
            "left": left,
            "right": right,
            "expectedOutcome": "empty",
        })
    return cases


def _fillet_cases() -> list[dict[str, Any]]:
    return [
        {
            "id": "fillet-box-all-edges-r1_5",
            "operation": "fillet",
            "geometry": _box([20.0, 16.0, 12.0]),
            "selection": "all-edges",
            "radius": 1.5,
        },
        {
            "id": "fillet-plate-vertical-edges-r1_5",
            "operation": "fillet",
            "geometry": _box([32.0, 20.0, 4.0]),
            "selection": "vertical-edges",
            "radius": 1.5,
        },
    ]


def cases() -> list[dict[str, Any]]:
    """Return the fixed, fully synthetic reference case catalog."""
    return _analytic_primitives() + _boolean_cases() + _fillet_cases()


def _translated(shape: Any, translation: list[float] | None) -> Any:
    if not translation or not any(translation):
        return shape
    transform = gp_Trsf()
    transform.SetTranslation(gp_Vec(*translation))
    return BRepBuilderAPI_Transform(shape, transform, True).Shape()


def make_geometry(spec: dict[str, Any]) -> Any:
    kind = spec["kind"]
    if kind == "box":
        origin = spec.get("origin", [0.0, 0.0, 0.0])
        size = spec["size"]
        shape = BRepPrimAPI_MakeBox(gp_Pnt(*origin), gp_Pnt(*(origin[i] + size[i] for i in range(3)))).Shape()
    elif kind == "prism":
        polygon = BRepBuilderAPI_MakePolygon()
        for x, y in spec["points"]:
            polygon.Add(gp_Pnt(x, y, 0.0))
        polygon.Close()
        face = BRepBuilderAPI_MakeFace(polygon.Wire(), True).Face()
        shape = BRepPrimAPI_MakePrism(face, gp_Vec(0.0, 0.0, spec["height"])).Shape()
    elif kind == "cylinder":
        shape = BRepPrimAPI_MakeCylinder(spec["radius"], spec["height"]).Shape()
    elif kind == "cone":
        shape = BRepPrimAPI_MakeCone(spec["r1"], spec["r2"], spec["height"]).Shape()
    elif kind == "sphere":
        shape = BRepPrimAPI_MakeSphere(spec["radius"]).Shape()
    else:
        raise ValueError(f"unsupported synthetic primitive {kind!r}")
    return _translated(shape, spec.get("position"))


def _count(shape: Any, topology: Any) -> int:
    unique_shapes = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(shape, topology, unique_shapes)
    return unique_shapes.Extent()


def _number(value: float) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"OCCT returned a non-finite metric: {number!r}")
    return 0.0 if number == 0.0 else number


def measure(shape: Any) -> dict[str, Any]:
    volume_properties = GProp_GProps()
    area_properties = GProp_GProps()
    if not shape.IsNull():
        BRepGProp.VolumeProperties_s(shape, volume_properties)
        BRepGProp.SurfaceProperties_s(shape, area_properties)

    bounds = Bnd_Box()
    if not shape.IsNull():
        BRepBndLib.AddOptimal_s(shape, bounds, False, False)
    bbox = None
    if not bounds.IsVoid():
        low, high = bounds.CornerMin(), bounds.CornerMax()
        bbox = {
            "min": [_number(low.X()), _number(low.Y()), _number(low.Z())],
            "max": [_number(high.X()), _number(high.Y()), _number(high.Z())],
        }
    return {
        "volume": _number(volume_properties.Mass()),
        "area": _number(area_properties.Mass()),
        "bbox": bbox,
        "faces": _count(shape, TopAbs_FACE),
        "edges": _count(shape, TopAbs_EDGE),
        "vertices": _count(shape, TopAbs_VERTEX),
        "valid": shape.IsNull() or bool(BRepCheck_Analyzer(shape).IsValid()),
    }


def _is_empty_result(result: dict[str, Any]) -> bool:
    return (
        result["volume"] == 0.0
        and result["area"] == 0.0
        and result["bbox"] is None
        and result["faces"] == 0
        and result["edges"] == 0
        and result["vertices"] == 0
    )


def _assert_measurements_match(actual: dict[str, Any], expected: dict[str, Any], artifact: Path) -> None:
    if not actual["valid"] or not expected["valid"]:
        raise AssertionError(f"invalid B-rep measurement for {artifact}")
    for metric in ("volume", "area"):
        if not math.isclose(
            actual[metric], expected[metric],
            rel_tol=STEP_ROUNDTRIP_REL_TOL,
            abs_tol=STEP_ROUNDTRIP_ABS_TOL,
        ):
            raise AssertionError(
                f"{artifact} {metric} mismatch: expected {expected[metric]}, got {actual[metric]}"
            )
    # STEP translation may canonicalize tangent seams and change edge/vertex counts.
    if actual["faces"] != expected["faces"]:
        raise AssertionError(
            f"{artifact} faces mismatch: expected {expected['faces']}, got {actual['faces']}"
        )
    actual_bbox, expected_bbox = actual["bbox"], expected["bbox"]
    if (actual_bbox is None) != (expected_bbox is None):
        raise AssertionError(f"{artifact} bounding-box presence does not match the corpus")
    if actual_bbox is not None and expected_bbox is not None:
        for bound in ("min", "max"):
            for axis, (actual_value, expected_value) in enumerate(zip(actual_bbox[bound], expected_bbox[bound])):
                if not math.isclose(
                    actual_value, expected_value,
                    rel_tol=STEP_ROUNDTRIP_REL_TOL,
                    abs_tol=STEP_ROUNDTRIP_ABS_TOL,
                ):
                    raise AssertionError(
                        f"{artifact} bbox {bound}[{axis}] mismatch: expected {expected_value}, got {actual_value}"
                    )


def _step_sha256(path: Path) -> str:
    data = path.read_bytes()
    data, timestamp_count = re.subn(
        rb"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d", b"<timestamp>", data
    )
    data, translator_count = re.subn(
        rb"Open CASCADE STEP translator \d+\.\d+ \d+",
        b"Open CASCADE STEP translator VERSION",
        data,
    )
    if timestamp_count != 1 or translator_count != 2:
        raise AssertionError(f"STEP export has unexpected volatile metadata: {path}")
    return hashlib.sha256(data).hexdigest()


def _validate_step_export(case: dict[str, Any], path: Path) -> None:
    expected_sha = case["exports"].get("stepSha256")
    if not isinstance(expected_sha, str) or len(expected_sha) != 64:
        raise AssertionError(f"canonical corpus lacks the STEP integrity hash: {path}")
    reader = STEPControl_Reader()
    if reader.ReadFile(str(path)) != IFSelect_RetDone:
        raise AssertionError(f"STEP export cannot be read: {path}")
    if _step_sha256(path) != expected_sha:
        raise AssertionError(f"STEP geometry mismatch: SHA-256 differs from the canonical corpus for {path}")
    transferred_roots = reader.TransferRoots()
    shape = reader.OneShape()
    expected = case["result"]
    if case["exports"].get("stepMode") == "empty-result":
        if not _is_empty_result(expected):
            raise AssertionError(f"corpus marks nonempty {case['id']} STEP as empty")
        if transferred_roots != 0 or not shape.IsNull():
            raise AssertionError(f"empty-result STEP unexpectedly transferred geometry: {path}")
        if _step_sha256(path) != expected_sha:
            raise AssertionError(f"STEP geometry mismatch: SHA-256 differs from the canonical corpus for {path}")
        return
    if not transferred_roots:
        raise AssertionError(f"STEP export cannot transfer roots: {path}")
    if not BRepCheck_Analyzer(shape).IsValid():
        raise AssertionError(f"STEP export failed BRepCheck after re-import: {path}")
    _assert_measurements_match(measure(shape), expected, path)
    if _step_sha256(path) != expected_sha:
        raise AssertionError(f"STEP geometry mismatch: SHA-256 differs from the canonical corpus for {path}")


def _parse_ascii_stl(path: Path) -> tuple[int, dict[str, list[float]] | None, int]:
    try:
        text = path.read_bytes().decode("ascii")
    except UnicodeDecodeError as error:
        raise AssertionError(f"STL export is not ASCII: {path}") from error
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if (
        len(lines) < 2
        or lines[0].split()[0].lower() != "solid"
        or lines[-1].split()[0].lower() != "endsolid"
    ):
        raise AssertionError(f"STL export has invalid ASCII framing: {path}")

    def tokens_at(index: int, prefix: str, count: int) -> list[str]:
        if index >= len(lines):
            raise AssertionError(f"truncated STL before {prefix} record: {path}")
        tokens = lines[index].split()
        if len(tokens) != count or tokens[0].lower() != prefix:
            raise AssertionError(f"malformed STL {prefix} record at line {index + 1}: {path}")
        return tokens

    def vector_at(index: int, prefix: str) -> list[float]:
        tokens = tokens_at(index, prefix, 4)
        try:
            values = [float(token) for token in tokens[1:]]
        except ValueError as error:
            raise AssertionError(f"invalid STL numeric value at line {index + 1}: {path}") from error
        if not all(math.isfinite(value) for value in values):
            raise AssertionError(f"non-finite STL numeric value at line {index + 1}: {path}")
        return values

    facets = 0
    coordinates: list[list[float]] = []
    edge_incidence: dict[tuple[tuple[float, ...], tuple[float, ...]], int] = {}
    index = 1
    end = len(lines) - 1
    while index < end:
        normal_tokens = lines[index].split()
        if (
            len(normal_tokens) != 5
            or normal_tokens[0].lower() != "facet"
            or normal_tokens[1].lower() != "normal"
        ):
            raise AssertionError(f"malformed STL facet normal at line {index + 1}: {path}")
        try:
            normal = [float(token) for token in normal_tokens[2:]]
        except ValueError as error:
            raise AssertionError(f"invalid STL facet normal at line {index + 1}: {path}") from error
        if not all(math.isfinite(value) for value in normal):
            raise AssertionError(f"non-finite STL facet normal: {path}")
        if math.sqrt(sum(value * value for value in normal)) == 0.0:
            raise AssertionError(f"zero STL facet normal: {path}")
        tokens_at(index + 1, "outer", 2)
        if lines[index + 1].split()[1].lower() != "loop":
            raise AssertionError(f"malformed STL outer loop at line {index + 2}: {path}")
        points = [vector_at(index + offset, "vertex") for offset in (2, 3, 4)]
        tokens_at(index + 5, "endloop", 1)
        tokens_at(index + 6, "endfacet", 1)
        coordinates.extend(points)
        # OCCT emits zero-area pole facets on spheres; they do not contribute mesh edges.
        if len({tuple(point) for point in points}) == 3:
            for start, finish in zip(points, points[1:] + points[:1]):
                edge = tuple(sorted((tuple(start), tuple(finish))))
                edge_incidence[edge] = edge_incidence.get(edge, 0) + 1
        facets += 1
        index += 7
    if index != end:
        raise AssertionError(f"STL has unexpected trailing records: {path}")
    open_or_nonmanifold_edges = sum(incidence != 2 for incidence in edge_incidence.values())
    if not coordinates:
        return facets, None, open_or_nonmanifold_edges
    bbox = {
        "min": [min(point[axis] for point in coordinates) for axis in range(3)],
        "max": [max(point[axis] for point in coordinates) for axis in range(3)],
    }
    return facets, bbox, open_or_nonmanifold_edges


def _validate_stl_export(case: dict[str, Any], path: Path) -> None:
    facets, bbox, open_or_nonmanifold_edges = _parse_ascii_stl(path)
    mode = case["exports"]["stlMode"]
    expected = case["result"]
    expected_sha = case["exports"].get("stlSha256")
    if not isinstance(expected_sha, str) or len(expected_sha) != 64:
        raise AssertionError(f"canonical corpus lacks the STL integrity hash: {path}")
    if mode == "empty-result":
        if not _is_empty_result(expected) or facets != 0:
            raise AssertionError(f"empty-result STL does not match corpus expectation: {path}")
    else:
        if mode != "occt" or facets == 0 or bbox is None or expected["bbox"] is None:
            raise AssertionError(f"nonempty STL export has no valid facets: {path}")
        if open_or_nonmanifold_edges:
            raise AssertionError(
                f"STL geometry mismatch: {open_or_nonmanifold_edges} open or non-manifold edges in {path}"
            )
        for bound in ("min", "max"):
            for axis, (actual_value, expected_value) in enumerate(zip(bbox[bound], expected["bbox"][bound])):
                if abs(actual_value - expected_value) > STL_BBOX_TOL:
                    raise AssertionError(
                        f"{path} bbox {bound}[{axis}] mismatch: expected {expected_value}, got {actual_value}"
                    )
    actual_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual_sha != expected_sha:
        raise AssertionError(f"STL geometry mismatch: SHA-256 differs from the canonical corpus for {path}")


def closed_form_check(case: dict[str, Any], result: dict[str, Any]) -> dict[str, Any] | None:
    expected = case.get("analytic")
    if expected is None:
        return None
    checks = {
        metric: math.isclose(
            result[metric], expected[metric], rel_tol=ANALYTIC_REL_TOL, abs_tol=ANALYTIC_ABS_TOL
        )
        for metric in ("volume", "area")
    }
    return {
        "passed": all(checks.values()),
        "relativeTolerance": ANALYTIC_REL_TOL,
        "absoluteTolerance": ANALYTIC_ABS_TOL,
        "expected": expected,
        "checks": checks,
    }


def _fillet(case: dict[str, Any]) -> Any:
    shape = make_geometry(case["geometry"])
    operation = BRepFilletAPI_MakeFillet(shape)
    explorer = TopExp_Explorer(shape, TopAbs_EDGE)
    selected = []
    while explorer.More():
        edge = TopoDS.Edge_s(explorer.Current())
        if case["selection"] == "all-edges":
            selected.append(edge)
        elif case["selection"] == "vertical-edges":
            curve = BRepAdaptor_Curve(edge)
            if curve.GetType() == GeomAbs_Line and abs(curve.Line().Direction().Z()) > 0.999999:
                selected.append(edge)
        else:
            raise ValueError(f"unsupported fillet selection {case['selection']!r}")
        explorer.Next()
    if not selected:
        raise RuntimeError(f"fillet case {case['id']} selected no edges")
    for edge in selected:
        operation.Add(case["radius"], edge)
    operation.Build()
    if not operation.IsDone():
        raise RuntimeError(f"OCCT fillet failed for {case['id']}")
    return operation.Shape()


def build_case(case: dict[str, Any]) -> Any:
    if case["operation"] == "primitive":
        return make_geometry(case["geometry"])
    if case["operation"] == "boolean":
        constructors = {
            "union": BRepAlgoAPI_Fuse,
            "subtract": BRepAlgoAPI_Cut,
            "intersect": BRepAlgoAPI_Common,
        }
        try:
            constructor = constructors[case["boolean"]]
        except KeyError as error:
            raise ValueError(f"unsupported boolean {case['boolean']!r}") from error
        algorithm = constructor(make_geometry(case["left"]), make_geometry(case["right"]))
        algorithm.Build()
        if not algorithm.IsDone():
            raise RuntimeError(f"OCCT {case['boolean']} failed for {case['id']}")
        return algorithm.Shape()
    if case["operation"] == "fillet":
        return _fillet(case)
    raise ValueError(f"unsupported operation {case['operation']!r}")


def _export(shape: Any, stem: str, export_dir: Path) -> dict[str, str]:
    export_dir.mkdir(parents=True, exist_ok=True)
    step_path = export_dir / f"{stem}.step"
    stl_path = export_dir / f"{stem}.stl"
    step_mode = "empty-result" if _is_empty_result(measure(shape)) else "occt"

    step_writer = STEPControl_Writer()
    if step_writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone:
        raise RuntimeError(f"OCCT could not transfer {stem} to STEP")
    if step_writer.Write(str(step_path)) != IFSelect_RetDone:
        raise RuntimeError(f"OCCT could not write STEP export {step_path}")

    if _count(shape, TopAbs_FACE) == 0:
        # OCCT's STL writer returns false for a valid empty Boolean result.
        # This is the canonical zero-triangle ASCII STL representation, not a
        # substitute shape; preserve the empty result rather than omit the export.
        stl_path.write_text(f"solid {stem}\nendsolid {stem}\n", encoding="ascii")
        stl_mode = "empty-result"
    else:
        triangulation = BRepMesh_IncrementalMesh(shape, 0.1, False, 0.5, True)
        if not triangulation.IsDone():
            raise RuntimeError(f"OCCT could not tessellate {stem} for STL")
        if not StlAPI_Writer().Write(shape, str(stl_path)):
            raise RuntimeError(f"OCCT could not write STL export {stl_path}")
        stl_mode = "occt"
    if step_path.stat().st_size == 0 or stl_path.stat().st_size == 0:
        raise RuntimeError(f"OCCT wrote an empty export for {stem}")
    return {
        "step": f"exports/{stem}.step",
        "stl": f"exports/{stem}.stl",
        "stepMode": step_mode,
        "stlMode": stl_mode,
        "stepSha256": _step_sha256(step_path),
        "stlSha256": hashlib.sha256(stl_path.read_bytes()).hexdigest(),
    }


def _versions() -> dict[str, str]:
    return {
        "occt": str(getattr(OCP, "__version__", "unknown")),
        "cadqueryOcpPackage": importlib.metadata.version("cadquery-ocp"),
        "build123d": importlib.metadata.version("build123d"),
    }


def corpus_bytes(export_dir: Path) -> bytes:
    records = []
    for case in cases():
        shape = build_case(case)
        result = measure(shape)
        if not result["valid"]:
            raise AssertionError(f"OCCT BRepCheck rejected {case['id']}")
        expected_outcome = case.get("expectedOutcome")
        if expected_outcome not in (None, "empty"):
            raise ValueError(f"unsupported expected outcome {expected_outcome!r} for {case['id']}")
        if (expected_outcome == "empty") != _is_empty_result(result):
            raise AssertionError(f"unexpected empty/nonempty OCCT result for {case['id']}: {result}")
        analytic = closed_form_check(case, result)
        if analytic is not None and not analytic["passed"]:
            raise AssertionError(f"closed-form mismatch for {case['id']}: {analytic}")
        exports = _export(shape, case["id"], export_dir)
        input_record = {key: value for key, value in case.items() if key != "analytic"}
        records.append({
            "id": case["id"],
            "input": input_record,
            "result": result,
            "closedForm": analytic,
            "exports": exports,
        })
    source_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    corpus = {
        "schemaVersion": 1,
        "purpose": (
            "Synthetic OCCT reference results for Rust-kernel validation only; OCCT never constructs production geometry. "
            "Consumer: direct-better Rust geometry and Boolean/fillet validation. Defect class: silent-wrong geometry "
            "or invalid B-reps. Delete when the Rust validation suite has independent frozen references for these cases."
        ),
        "provenance": {
            "generator": "scripts/rust/occt-oracle/generate.py",
            "generatorSha256": source_hash,
            "versions": _versions(),
            "units": "mm",
            "tessellationDeflection": 0.1,
            "tessellationAngularDeflectionRad": 0.5,
        },
        "caseCount": len(records),
        "cases": records,
    }
    return (json.dumps(corpus, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")


def _write(out: Path, export_dir: Path) -> bytes:
    generated = corpus_bytes(export_dir)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(generated)
    return generated


def _check(out: Path, export_dir: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="occt-oracle-check-") as temp:
        generated = corpus_bytes(Path(temp) / "exports")
    try:
        committed = out.read_bytes()
    except FileNotFoundError as error:
        raise AssertionError(f"missing generated corpus {out}; run without --check first") from error
    if generated != committed:
        raise AssertionError(f"corpus changed on deterministic re-run: {out}")

    for case in json.loads(committed)["cases"]:
        step_path = export_dir / f"{case['id']}.step"
        stl_path = export_dir / f"{case['id']}.stl"
        for path in (step_path, stl_path):
            if not path.is_file() or path.stat().st_size == 0:
                raise AssertionError(f"missing or empty export: {path}")

        _validate_step_export(case, step_path)
        _validate_stl_export(case, stl_path)


def _planted_negative_checks() -> tuple[int, int]:
    catalog = cases()
    count = 0
    for case_id, geometry_key, field, replacement in (
        ("primitive-box", "geometry", "size", [21.0, 30.0, 40.0]),
        ("primitive-cylinder", "geometry", "radius", 5.25),
    ):
        original = next(case for case in catalog if case["id"] == case_id)
        mutant = copy.deepcopy(original)
        mutant[geometry_key][field] = replacement
        check = closed_form_check(mutant, measure(build_case(mutant)))
        if check is None or check["passed"]:
            raise AssertionError(f"planted parameter mutation escaped closed-form check: {case_id}.{field}")
        count += 1

    box = copy.deepcopy(next(case for case in catalog if case["id"] == "primitive-box"))
    box["result"] = measure(build_case(box))
    cylinder = next(case for case in catalog if case["id"] == "primitive-cylinder")
    with tempfile.TemporaryDirectory(prefix="occt-oracle-negative-") as temp:
        directory = Path(temp)
        box["exports"] = _export(build_case(box), "expected-box", directory)
        _export(build_case(cylinder), "wrong-cylinder", directory)
        try:
            _validate_step_export(box, directory / "wrong-cylinder.step")
        except AssertionError as error:
            if "STEP geometry mismatch" not in str(error):
                raise
            count += 1
        else:
            raise AssertionError("planted valid wrong-shape STEP escaped metric validation")

        fake_stl = directory / "malformed.stl"
        fake_stl.write_text("solid fake\nfacet normal nonsensical\nendsolid\n", encoding="ascii")
        try:
            _validate_stl_export(box, fake_stl)
        except AssertionError as error:
            if "STL" not in str(error):
                raise
            count += 1
        else:
            raise AssertionError("planted malformed STL facet escaped parser validation")
    return count, len(catalog)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_CORPUS, help="corpus JSON destination")
    parser.add_argument("--export-dir", type=Path, default=DEFAULT_EXPORTS, help="STEP/STL export directory")
    parser.add_argument("--check", action="store_true", help="compare a fresh run with the frozen JSON and verify exports")
    parser.add_argument(
        "--planted-negatives", action="store_true",
        help="verify parameter, STEP-artifact, and STL-artifact errors are caught",
    )
    args = parser.parse_args()

    try:
        if args.check:
            _check(args.out, args.export_dir)
            records = json.loads(args.out.read_bytes())["cases"]
            step_roundtrips = sum(case["exports"]["stepMode"] == "occt" for case in records)
            empty_steps = sum(case["exports"]["stepMode"] == "empty-result" for case in records)
            print(
                f"PASS deterministic JSON, {step_roundtrips} STEP metric round-trips, "
                f"{empty_steps} explicit empty STEP results, and {len(records)} parsed STL exports: {args.out}"
            )
        else:
            corpus = _write(args.out, args.export_dir)
            parsed = json.loads(corpus)
            valid = sum(case["result"]["valid"] for case in parsed["cases"])
            print(f"Wrote {parsed['caseCount']} cases ({valid} BRepCheck-valid), {len(parsed['cases']) * 2} STEP/STL exports, corpus {args.out}")
        if args.planted_negatives:
            count, total = _planted_negative_checks()
            print(f"PASS planted parameter/artifact negatives caught: {count}; catalog cases: {total}")
    except Exception as error:
        print(f"FAIL {type(error).__name__}: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
