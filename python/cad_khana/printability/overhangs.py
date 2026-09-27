"""cad_khana overhang check (refused)."""

from cad_khana import _wonky

BUILD_PLATE_EPSILON_MM = 1e-3

_WHAT = "overhang detection on OCCT tessellations"
_M = "cad_khana.printability.overhangs"

Overhang = _wonky.refused_type(f"{_M}.Overhang", _WHAT)
detect_overhang = _wonky.refused_call(f"{_M}.detect_overhang", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
