"""cad_khana environment probe (refused)."""

from cad_khana import _wonky

_WHAT = "probing installed packages and the OCP viewer port"
_M = "cad_khana.environment"

ViewerStatus = _wonky.refused_type(f"{_M}.ViewerStatus", _WHAT)
EnvironmentReport = _wonky.refused_type(f"{_M}.EnvironmentReport", _WHAT)
probe = _wonky.refused_call(f"{_M}.probe", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
