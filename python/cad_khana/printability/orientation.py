"""cad_khana print orientation suggestion (refused)."""

from cad_khana import _wonky

PLATE_TOL_MM = 1e-3

_WHAT = "print orientation scoring (overhang area, plate contact) on OCCT tessellations"
_M = "cad_khana.printability.orientation"

OrientationScore = _wonky.refused_type(f"{_M}.OrientationScore", _WHAT)
score_orientation = _wonky.refused_call(f"{_M}.score_orientation", _WHAT)
suggest_orientation = _wonky.refused_call(f"{_M}.suggest_orientation", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
