"""cad_khana printability inspection (refused, or recorded as not run with --khana-checks=skip)."""

from cad_khana import _wonky

EPS = 1e-6

_WHAT = ("printability inspection (minimum wall thickness, overhangs, bores, pins, "
         "printability.json) needs ray casting and tessellation of OCCT shapes")
_M = "cad_khana.printability.inspect"

PrintabilityDiagnostics = _wonky.refused_type(f"{_M}.PrintabilityDiagnostics", _WHAT)
inspect = _wonky.checked_call(f"{_M}.inspect", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
