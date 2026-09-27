"""cad_khana pin check (refused)."""

from cad_khana import _wonky

MIN_PIN_DIA_MM = 2.0
SLENDER_RATIO = 8.0
FULL_SWEEP_RAD = 5.2

_WHAT = "slender pin detection on OCCT cylinder faces"
_M = "cad_khana.printability.pins"

Pin = _wonky.refused_type(f"{_M}.Pin", _WHAT)
detect_pins = _wonky.refused_call(f"{_M}.detect_pins", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
