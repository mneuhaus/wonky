"""cad_khana mechanism diagnostics: constants provided, compute() refused."""

from cad_khana import _wonky

SCHEMA_VERSION = "0.2"
INTERFERENCE_VOLUME_EPSILON_MM3 = 0.001

_WHAT = "mechanism diagnostics (per-part bounding boxes, surface areas, centers of mass, pairwise interference volumes)"
_M = "cad_khana.mechanism.diagnostics"

BBox = _wonky.refused_type(f"{_M}.BBox", _WHAT)
PartDiagnostics = _wonky.refused_type(f"{_M}.PartDiagnostics", _WHAT)
Interference = _wonky.refused_type(f"{_M}.Interference", _WHAT)
AssertionResult = _wonky.refused_type(f"{_M}.AssertionResult", _WHAT)
Diagnostics = _wonky.refused_type(f"{_M}.Diagnostics", _WHAT)
compute = _wonky.refused_call(f"{_M}.compute", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
