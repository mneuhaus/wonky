"""cad_khana wall thickness check (refused)."""

from cad_khana import _wonky

RAY_OFFSET_MM = 1e-4
SLIVER_HIT_DISTANCE_MM = 0.05

_WHAT = "minimum wall thickness by ray casting against OCCT shapes"
_M = "cad_khana.printability.wall"

min_wall = _wonky.refused_call(f"{_M}.min_wall", _WHAT)
min_wall_mm = _wonky.refused_call(f"{_M}.min_wall_mm", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
