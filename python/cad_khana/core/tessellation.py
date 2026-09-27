"""cad_khana tessellation helpers of its diagnostics (refused)."""

from cad_khana import _wonky

TESSELLATION_TOLERANCE_MM = 0.1
TESSELLATION_ANGULAR_TOLERANCE = 0.3

_WHAT = "OCCT tessellation into triangles for cad_khana's printability checks"
_M = "cad_khana.core.tessellation"

Triangle = _wonky.refused_type(f"{_M}.Triangle", _WHAT)
_triangle = _wonky.refused_call(f"{_M}._triangle", _WHAT)
_tessellate = _wonky.refused_call(f"{_M}._tessellate", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
