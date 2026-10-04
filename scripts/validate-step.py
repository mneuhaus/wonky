# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["cadquery-ocp==8.0.1.0.0"]
# ///
"""Independent STEP acceptance check; OpenCascade is a test oracle only.

Usage: uv run scripts/validate-step.py out/box out/bracket out/tilted-plate
Each prefix must have .step and .brep.json siblings produced by the CLI.
Optional: --points probes.json adds independent point-in-solid observations.
"""
# Only live CAD-Acid requests this sidecar; correctness stdout/exit stay intact.
import os
if os.environ.get('WONKY_ACID_PHASE_PERF'):
    from acid.python_perf import start_timing
    start_timing(os.environ['WONKY_ACID_PHASE_PERF'])

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path

from occt_properties import integration_shape

from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_SOLID, TopAbs_VERTEX
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface


def step_fields(text, separator=","):
    """Split Part 21 fields, respecting nesting and escaped quoted strings."""
    fields, start, depth, quoted, i = [], 0, 0, False, 0
    while i < len(text):
        char = text[i]
        if char == "'":
            if quoted and i + 1 < len(text) and text[i + 1] == "'":
                i += 2
                continue
            quoted = not quoted
        elif not quoted:
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            elif char == separator and depth == 0:
                fields.append(text[start:i].strip())
                start = i + 1
        i += 1
    if depth or quoted:
        raise ValueError("Malformed Part 21 nesting or string")
    fields.append(text[start:].strip())
    return fields


CURVE_TYPES = {"LINE", "CIRCLE", "ELLIPSE", "HYPERBOLA", "PARABOLA", "POLYLINE",
               "SURFACE_CURVE", "SEAM_CURVE", "B_SPLINE_CURVE", "B_SPLINE_CURVE_WITH_KNOTS"}


def check_ap214_subset(text):
    """AP214 E3 ADVANCED_FACE WR3, plus curve associations for our subset.

    Schema source: STEPcode data/ap214e3/AP214E3_2010.exp. This is NOT a
    complete EXPRESS evaluator; OCCT reading/healing cannot replace this check.
    """
    entities = {}
    for statement in step_fields(text, ";"):
        match = re.fullmatch(r"#(\d+)\s*=\s*([A-Z_0-9]+)\s*\((.*)\)", statement, re.S)
        if match:
            entities["#" + match[1]] = (match[2], step_fields(match[3]))
            continue
        # A complex instance, e.g. a rational B-spline curve
        # `(BOUNDED_CURVE() B_SPLINE_CURVE(...) ... RATIONAL_B_SPLINE_CURVE(...))`:
        # it is of every listed type; record a curve type it carries, if any.
        match = re.fullmatch(r"#(\d+)\s*=\s*\((.*)\)", statement, re.S)
        if match:
            parts = re.findall(r"([A-Z_0-9]+)\s*\(", match[2])
            kind = next((part for part in parts if part in CURVE_TYPES - {"SURFACE_CURVE", "SEAM_CURVE"}), "COMPLEX")
            entities["#" + match[1]] = (kind, [])
    allowed = CURVE_TYPES
    edges = 0
    for label, (kind, fields) in entities.items():
        if kind == "EDGE_CURVE":
            edges += 1
            geometry = entities.get(fields[3], ("MISSING", []))[0]
            if geometry not in allowed:
                raise ValueError(f"AP214 ADVANCED_FACE.WR3: {label} EDGE_CURVE -> {geometry} is forbidden")
        elif kind in {"SURFACE_CURVE", "SEAM_CURVE"}:
            associations = step_fields(fields[2][1:-1])
            if not 1 <= len(associations) <= 2 or any(ref not in entities for ref in associations):
                raise ValueError(f"AP214 {label}: invalid associated_geometry")
            # Our writer emits PCURVEs, not standalone associated surfaces.
            if any(entities[ref][0] != "PCURVE" for ref in associations):
                raise ValueError(f"AP214 subset {label}: expected PCURVE association")
            if kind == "SEAM_CURVE" and (len(associations) != 2 or
                    entities[associations[0]][1][1] != entities[associations[1]][1][1]):
                raise ValueError(f"AP214 {label}: seam needs two PCURVEs on one surface")
    if edges == 0:
        raise ValueError("AP214 subset: no EDGE_CURVE found")
    return {"profile": "AP214 E3 ADVANCED_FACE.WR3 and emitted curve associations", "edgesChecked": edges}


def unique_shapes(shape, kind):
    found = []
    iterator = TopExp_Explorer(shape, kind)
    while iterator.More():
        current = iterator.Current()
        if not any(current.IsSame(previous) for previous in found):
            found.append(current)
        iterator.Next()
    return found


def count_unique(shape, kind):
    return len(unique_shapes(shape, kind))


def surface_types(shape):
    """Face count per OCCT surface type, named as FreeCAD names them (Plane, SurfaceOfExtrusion, BSplineSurface, ...).

    A writer that turns an exact extrusion into a spline surface shows up here on every host.
    """
    counts = {}
    for face in unique_shapes(shape, TopAbs_FACE):
        name = BRepAdaptor_Surface(TopoDS.Face(face)).GetType().name.removeprefix("GeomAbs_")
        counts[name] = counts.get(name, 0) + 1
    return dict(sorted(counts.items()))


def curve_types(shape):
    """Edge count per OCCT 3D curve type (Line, Circle, BSplineCurve, ...); degenerated edges have none.

    A writer that turns an exact circle into an unlabelled spline shows up here on every host.
    """
    counts = {}
    for edge in unique_shapes(shape, TopAbs_EDGE):
        edge = TopoDS.Edge(edge)
        if BRep_Tool.Degenerated_s(edge):
            continue
        name = BRepAdaptor_Curve(edge).GetType().name.removeprefix("GeomAbs_")
        counts[name] = counts.get(name, 0) + 1
    return dict(sorted(counts.items()))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_point_requests(path, prefixes):
    data = json.loads(Path(path).read_text())
    if not isinstance(data, dict) or data.get("schema") != "wonky-solid-probes/1":
        raise ValueError("Expected wonky-solid-probes/1 point requests")
    tolerance = data.get("toleranceMm")
    if isinstance(tolerance, bool) or not isinstance(tolerance, (int, float)) or not math.isfinite(tolerance) or tolerance <= 0:
        raise ValueError("Point toleranceMm must be finite and positive")
    expected = {str(prefix.resolve()) for prefix in prefixes}
    if len(expected) != len(prefixes):
        raise ValueError("Duplicate requested export prefix")
    models = data.get("models")
    if not isinstance(models, list):
        raise ValueError("Point requests must contain a models array")
    requests, ids = {}, set()
    for model in models:
        if not isinstance(model, dict) or not isinstance(model.get("prefix"), str) or not model["prefix"]:
            raise ValueError("Every point model needs an export prefix")
        prefix = str(Path(model["prefix"]).resolve())
        if prefix not in expected or prefix in requests:
            raise ValueError(f"Unknown or duplicate point prefix: {model['prefix']}")
        points = model.get("points")
        if not isinstance(points, list) or not points:
            raise ValueError(f"Point prefix has no probes: {model['prefix']}")
        for point in points:
            if not isinstance(point, dict) or not isinstance(point.get("id"), str) or not point["id"] or point["id"] in ids:
                raise ValueError("Every probe needs a nonempty, globally unique id")
            ids.add(point["id"])
            coordinates = point.get("pointMm")
            if not isinstance(coordinates, list) or len(coordinates) != 3 or any(
                isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in coordinates
            ):
                raise ValueError(f"Probe {point['id']} needs exactly three finite pointMm coordinates")
        requests[prefix] = points
    if set(requests) != expected:
        raise ValueError("Point requests must cover every requested export prefix exactly once")
    return requests, tolerance


def classify_points(shape, points, tolerance):
    # OCP only reads the already exported STEP and observes membership. It never
    # creates or repairs production geometry or chooses the Bend query results.
    from OCP.BRepClass3d import BRepClass3d_SolidClassifier
    from OCP.TopAbs import TopAbs_IN, TopAbs_OUT, TopAbs_ON, TopAbs_UNKNOWN
    from OCP.gp import gp_Pnt
    from importlib.metadata import version

    solids = unique_shapes(shape, TopAbs_SOLID)
    names = {TopAbs_IN: "Inside", TopAbs_OUT: "Outside", TopAbs_ON: "Boundary", TopAbs_UNKNOWN: "Unknown"}
    observations = []
    for point in points:
        states = [names.get(BRepClass3d_SolidClassifier(TopoDS.Solid(solid), gp_Pnt(*point["pointMm"]), tolerance).State(), "Unknown")
                  for solid in solids]
        present = set(states)
        if not states or "Unknown" in present or {"Inside", "Boundary"}.issubset(present):
            state = "Unknown"
        elif "Inside" in present:
            state = "Inside"
        elif "Boundary" in present:
            state = "Boundary"
        else:
            state = "Outside"
        observations.append({"id": point["id"], "pointMm": point["pointMm"], "state": state, "perSolid": states})
    return {"schema": "wonky-step-point-classification/1", "oracle": "OCP.BRepClass3d_SolidClassifier",
            "ocpPackageVersion": version("cadquery-ocp"), "toleranceMm": tolerance,
            "compositePolicy": "Union of solid states; any Unknown or mixed Inside/Boundary remains Unknown",
            "solidCount": len(solids), "points": observations}


def validate(prefix, points=None, tolerance=None, point_file=None):
    before = None
    if points is not None:
        before = {"stepSha256": digest(str(prefix) + ".step"), "brepSha256": digest(str(prefix) + ".brep.json"),
                  "probesSha256": digest(point_file)}
    model = json.loads(Path(str(prefix) + ".brep.json").read_text())
    step_text = Path(str(prefix) + ".step").read_text()
    schema_check = check_ap214_subset(step_text)
    reader = STEPControl_Reader()
    if reader.ReadFile(str(prefix) + ".step") != IFSelect_RetDone:
        raise ValueError(f"{prefix}: OpenCascade could not parse STEP")
    if not reader.TransferRoots():
        raise ValueError(f"{prefix}: STEP contains no transferrable shapes")
    shape = reader.OneShape()
    edges = [TopoDS.Edge(edge) for edge in unique_shapes(shape, TopAbs_EDGE)]
    if any(not BRep_Tool.SameParameter_s(edge) or not BRep_Tool.SameRange_s(edge) for edge in edges):
        raise ValueError(f"{prefix}: imported edge fails SameParameter/SameRange")
    # Separate budgets, in mm: recorded source allowance, the writer's fixed
    # PCurve approximation limit, and OCCT's documented Confusion floor. Never
    # infer an allowed tolerance from the healed result itself.
    from OCP.Precision import Precision
    source_budget = max(body["validation"]["toleranceMm"] for body in model["bodies"])
    export_budget = 1e-8 if "PCURVE(" in step_text else 0
    reader_budget = Precision.Confusion_s()
    tolerance_budget = source_budget + export_budget + reader_budget
    if not math.isfinite(tolerance_budget) or source_budget < 0:
        raise ValueError(f"{prefix}: invalid source tolerance budget")
    tolerance_maxima = {
        "edgeMm": max((BRep_Tool.Tolerance_s(edge) for edge in edges), default=0),
        "faceMm": max((BRep_Tool.Tolerance_s(TopoDS.Face(face)) for face in unique_shapes(shape, TopAbs_FACE)), default=0),
        "vertexMm": max((BRep_Tool.Tolerance_s(TopoDS.Vertex(vertex)) for vertex in unique_shapes(shape, TopAbs_VERTEX)), default=0),
    }
    if any(not math.isfinite(value) or value > tolerance_budget for value in tolerance_maxima.values()):
        raise ValueError(f"{prefix}: imported tolerance exceeds source/export/reader budget {tolerance_budget}: {tolerance_maxima}")
    # Sampling can miss a reconstructed pcurve leaving its declared tolerance,
    # even when the imported 3D conic itself is precise. Request OCP's exact
    # CurveOnSurface method and report this stronger check explicitly.
    if not BRepCheck_Analyzer(shape, True, False, True).IsValid():
        raise ValueError(f"{prefix}: imported solid fails BRepCheck_Analyzer with exact CurveOnSurface checking")
    expected = {"solids": len(model["bodies"])}
    for key in ["faces", "edges", "vertices"]:
        expected[key] = sum(len(body[key]) for body in model["bodies"])
    kinds = {"solids": TopAbs_SOLID, "faces": TopAbs_FACE, "edges": TopAbs_EDGE, "vertices": TopAbs_VERTEX}
    counts = {key: count_unique(shape, kind) for key, kind in kinds.items()}
    input_seams = sum(
        len(uses) - len(set(uses)) for body in model["bodies"] for face in body["faces"]
        for uses in [[u["edge"] for loop in face["loops"] for u in loop]]
    )
    output_seams = sum(
        BRep_Tool.IsClosed_s(TopoDS.Edge(edge), TopoDS.Face(face))
        for face in unique_shapes(shape, TopAbs_FACE) for edge in unique_shapes(face, TopAbs_EDGE)
    )
    added_seams = output_seams - input_seams
    split_vertices = counts["vertices"] - expected["vertices"]
    source_areas = [area for body in model["bodies"] for area in body.get("referenceMeasurements", {}).get("faceAreasMm2", [])]
    source_perimeters = [v for body in model["bodies"] for v in body.get("referenceMeasurements", {}).get("facePerimetersMm", [])]
    source_tolerances = [v for body in model["bodies"] for v in body.get("referenceMeasurements", {}).get("faceTolerancesMm", [])]
    # OpenCascade represents a pole of a sphere or torus sheet and the apex of
    # a cone by a degenerated edge, which a STEP model does not carry. Such an
    # edge has no 3D curve and adds no geometry: discount exactly those.
    degenerated = sum(BRep_Tool.Degenerated_s(TopoDS.Edge(edge)) for edge in unique_shapes(shape, TopAbs_EDGE))
    if degenerated:
        counts = {**counts, "edges": counts["edges"] - degenerated}
    if counts != expected:
        # Periodic trimmed faces may arrive as two winding boundary loops.
        # A STEP reader connects them with a seam, possibly splitting a boundary
        # edge. Require precisely that topological refinement, and independently
        # check EVERY source face area below. Never accept lost faces/solids.
        refined = (len(source_areas) == expected["faces"] and
                   counts["solids"] == expected["solids"] and counts["faces"] == expected["faces"] and
                   added_seams >= 0 and split_vertices >= 0 and
                   counts["edges"] - expected["edges"] == added_seams + split_vertices)
        if not refined:
            raise ValueError(f"{prefix}: topology differs: {counts} != {expected}")
    if source_areas:
        measured_areas = []
        for face in unique_shapes(shape, TopAbs_FACE):
            properties = GProp_GProps()
            BRepGProp.SurfaceProperties_s(integration_shape(face), properties, Eps=1e-9, SkipShared=False)
            measured_areas.append(properties.Mass())
        if len(source_areas) != len(measured_areas):
            raise ValueError(f"{prefix}: incomplete source face-area oracle")
        for i, (measured, reference) in enumerate(zip(measured_areas, source_areas)):
            # Area uncertainty from a boundary displaced within its recorded
            # spatial tolerance: perimeter * tolerance (+ the corner term).
            eps = source_tolerances[i]
            area_budget = source_perimeters[i] * eps + math.pi * eps * eps
            if not math.isclose(measured, reference, rel_tol=2e-5, abs_tol=max(1e-5, area_budget)):
                raise ValueError(f"{prefix}: face {i} area differs: {measured} != {reference}")
    properties = GProp_GProps()
    integration_tolerance = 1e-10
    integration_error = BRepGProp.VolumeProperties_s(integration_shape(shape), properties, Eps=integration_tolerance, OnlyClosed=True, SkipShared=False)
    if not math.isfinite(integration_error) or integration_error < 0:
        raise ValueError(f"{prefix}: invalid adaptive volume integration error estimate")
    volume = properties.Mass()
    volumes = [body["validation"]["volumeMm3"] for body in model["bodies"]]
    expected_volume = sum(volumes) if all(v is not None for v in volumes) else None
    if volume <= 0:
        raise ValueError(f"{prefix}: nonpositive volume {volume}")
    if expected_volume is not None and not math.isclose(volume, expected_volume, rel_tol=2e-5, abs_tol=1e-5):
        raise ValueError(f"{prefix}: volume differs: {volume} != {expected_volume}")
    result = {"file": str(prefix) + ".step", "valid": True,
              "validityCheck": "BRepCheck_Analyzer(exact CurveOnSurface)", **counts,
              "periodicSeamsAdded": added_seams, "boundaryVerticesAdded": split_vertices, "degeneratedEdgesAdded": degenerated,
              "sourceFaceAreasCompared": len(source_areas),
              "volumeMm3": volume, "volumeComparedWithKernel": expected_volume is not None}
    result["schemaSubset"] = schema_check
    result["surfaceTypes"] = surface_types(shape)
    result["curveTypes"] = curve_types(shape)
    result["sameParameter"] = True
    result["sameRange"] = True
    result["importedTolerance"] = {**tolerance_maxima, "sourceBudgetMm": source_budget,
                                   "exportBudgetMm": export_budget, "readerBudgetMm": reader_budget,
                                   "allowedMm": tolerance_budget}
    result["volumeIntegration"] = {"method": "adaptive Gauss, closed shells",
                                  "requestedRelativeError": integration_tolerance,
                                  "estimatedRelativeError": integration_error}
    if points is not None:
        result["pointClassification"] = {**classify_points(shape, points, tolerance), **before}
        after = {"stepSha256": digest(str(prefix) + ".step"), "brepSha256": digest(str(prefix) + ".brep.json"),
                 "probesSha256": digest(point_file)}
        if before != after:
            raise ValueError(f"{prefix}: STEP, B-rep or probes changed during point validation")
    return result


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Pass one or more export prefixes, e.g. out/bracket")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--points", type=Path, help="Optional wonky-solid-probes/1 JSON file")
    parser.add_argument("prefixes", nargs="+", type=Path)
    args = parser.parse_args()
    if args.points is None:
        report = [validate(prefix) for prefix in args.prefixes]
    else:
        probe_hash = digest(args.points)
        requests, tolerance = load_point_requests(args.points, args.prefixes)
        report = [validate(prefix, requests[str(prefix.resolve())], tolerance, args.points) for prefix in args.prefixes]
        if digest(args.points) != probe_hash:
            raise ValueError("Point request file changed during validation")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    if sys.argv[1:] == ["--serve"]:
        from acid.serve_worker import serve
        serve(sys.argv[0], main)
    else:
        main()
