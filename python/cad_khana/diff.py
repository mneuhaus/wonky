"""cad_khana diagnostics diff (refused)."""

from cad_khana import _wonky

diff = _wonky.refused_call("cad_khana.diff.diff", "diffing cad_khana diagnostics.json files")

__getattr__ = _wonky.module_getattr(__name__)
