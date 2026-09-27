"""Isolated real build123d/OCCT reference for benchmark-build123d.mjs.

This process is a benchmark only. It cannot service production Bend requests.
Run with the pinned reference environment, Python -I -B -u, and JSON lines.
"""

import time

worker_start = time.perf_counter()
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import sys
import traceback

import_start = time.perf_counter()
import build123d
import OCP
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.TopAbs import TopAbs_IN, TopAbs_OUT, TopAbs_ON, TopAbs_UNKNOWN
from OCP.gp import gp_Pnt

import_ms = (time.perf_counter() - import_start) * 1000


def send(value):
    # C++ export diagnostics may also use stdout. Only prefixed lines are RPC.
    print("BENCH:" + json.dumps(value, allow_nan=False), flush=True)


def elapsed(start):
    return (time.perf_counter() - start) * 1000


def source_for(request):
    path = Path(request["sourcePath"]).resolve()
    raw = path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != request["sourceSha256"]:
        raise ValueError(f"Reference source SHA-256 mismatch: {path}")
    return path, raw.decode("utf-8"), digest


def observe(shape, probes, tolerance):
    solids = list(shape.solids())
    bounds = shape.bounding_box(optimal=True)
    names = {TopAbs_IN: "Inside", TopAbs_OUT: "Outside", TopAbs_ON: "Boundary", TopAbs_UNKNOWN: "Unknown"}
    points = []
    for probe in probes:
        states = [names.get(BRepClass3d_SolidClassifier(solid.wrapped, gp_Pnt(*probe["pointMm"]), tolerance).State(), "Unknown")
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
        points.append({"id": probe["id"], "state": state, "pointMm": probe["pointMm"], "perSolid": states})
    return {"solids": len(solids), "volumeMm3": shape.volume,
            "boundsMm": {"min": list(bounds.min), "max": list(bounds.max)},
            "topology": {"faces": len(shape.faces()), "edges": len(shape.edges()), "vertices": len(shape.vertices())},
            "probes": points}


def run(request):
    path, source, digest = source_for(request)
    namespace = {"__name__": "__main__", "__file__": str(path)}
    build_start = time.perf_counter()
    start = time.perf_counter()
    code = compile(source, str(path), "exec")
    compile_ms = elapsed(start)
    start = time.perf_counter()
    exec(code, namespace)
    execute_ms = elapsed(start)
    shape = namespace.get("result")
    if not isinstance(shape, build123d.Shape):
        raise TypeError("Reference source must bind a real build123d Shape to result")
    build_ms = elapsed(build_start)

    start = time.perf_counter()
    valid = BRepCheck_Analyzer(shape.wrapped, True, False, True).IsValid()
    validation_ms = elapsed(start)
    if not valid:
        raise ValueError("Real build123d result fails exact BRepCheck_Analyzer")

    start = time.perf_counter()
    observation = observe(shape, request.get("probes", []), request.get("pointToleranceMm", 1e-7))
    observation_ms = elapsed(start)
    prefix = Path(request["prefix"])
    prefix.parent.mkdir(parents=True, exist_ok=True)
    start = time.perf_counter()
    if not build123d.export_step(shape, str(prefix) + ".step"):
        raise ValueError("Real build123d STEP export returned false")
    export_ms = elapsed(start)
    exported = Path(str(prefix) + ".step").read_bytes()
    return {"status": "ok", "sourceSha256": digest, "actual": observation,
            "timingsMs": {"build": build_ms, "pythonCompile": compile_ms,
                          "sourceExecutionIncludingGeometry": execute_ms,
                          "nativeRevalidation": validation_ms, "observation": observation_ms,
                          "stepExportAndWrite": export_ms},
            "nativeValidation": "BRepCheck_Analyzer(exact CurveOnSurface)",
            "export": {"path": str(prefix) + ".step", "bytes": len(exported),
                       "sha256": hashlib.sha256(exported).hexdigest()}}


packages = {distribution.metadata["Name"]: distribution.version for distribution in importlib.metadata.distributions()}
send({"type": "ready", "engine": "real-build123d-occt", "pythonVersion": platform.python_version(),
      "build123dVersion": build123d.__version__, "ocpVersion": getattr(OCP, "__version__", None),
      "build123dModule": build123d.__file__, "ocpModule": OCP.__file__,
      "packages": dict(sorted(packages.items())),
      "timingsMs": {"runtimeImport": import_ms, "workerInitialization": elapsed(worker_start)}})

for line in sys.stdin:
    request = json.loads(line)
    if request.get("action") == "exit":
        break
    try:
        if request.get("action") != "run":
            raise ValueError(f"Unknown independent benchmark action: {request.get('action')}")
        response = run(request)
    except BaseException as error:
        response = {"status": "execution-error", "error": {"name": type(error).__name__, "message": str(error),
                                                            "traceback": traceback.format_exc()}}
    send({"type": "result", "id": request["id"], **response})
