"""cad_khana structural printability checks (refused)."""

from cad_khana import _wonky

VERTICAL_DOT = 0.99
SHARP_INTERIOR_DEG = 91.0
MIN_EDGE_LEN_MM = 2.0
HORIZONTAL_DOT = 0.95

_WHAT = "enclosed-void, floating-solid and sharp-edge checks on OCCT topology"
_M = "cad_khana.printability.structure"

enclosed_voids = _wonky.refused_call(f"{_M}.enclosed_voids", _WHAT)
floating_solids = _wonky.refused_call(f"{_M}.floating_solids", _WHAT)
sharp_vertical_edges = _wonky.refused_call(f"{_M}.sharp_vertical_edges", _WHAT)
sharp_rim_edges = _wonky.refused_call(f"{_M}.sharp_rim_edges", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
