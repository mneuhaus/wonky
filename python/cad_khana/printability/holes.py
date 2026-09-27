"""cad_khana bore and bridge checks (refused)."""

from cad_khana import _wonky

VERTICAL_DOT = 0.99
HORIZONTAL_DOT = 0.1
SMALL_BORE_MM = 12.0
BRIDGE_MAX_MM = 10.0
CEILING_DOT = 0.985
PLATE_TOUCH_MM = 0.3

_WHAT = "bore and bridge printability checks on tagged OCCT tessellations"
_M = "cad_khana.printability.holes"

Bore = _wonky.refused_type(f"{_M}.Bore", _WHAT)
FaceTag = _wonky.refused_type(f"{_M}.FaceTag", _WHAT)
bore_face_radius = _wonky.refused_call(f"{_M}.bore_face_radius", _WHAT)
tessellate_tagged = _wonky.refused_call(f"{_M}.tessellate_tagged", _WHAT)
self_supporting = _wonky.refused_call(f"{_M}.self_supporting", _WHAT)
detect_bores = _wonky.refused_call(f"{_M}.detect_bores", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
