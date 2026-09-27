"""cad_khana check(): assertion evaluation, exports and mechanism.json (refused, or recorded as not run with --khana-checks=skip)."""

from cad_khana import _wonky

_WHAT = ("check() evaluates interference and clearance assertions, exports STL/STEP and writes "
         "mechanism.json; wonky has no interference or clearance evaluation for assemblies")
_M = "cad_khana.mechanism.check"

_export_default = True


def _set_export_default(enabled: bool) -> None:
    global _export_default
    _export_default = enabled


CheckResult = _wonky.refused_type(f"{_M}.CheckResult", _WHAT)
check = _wonky.checked_call(f"{_M}.check", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
