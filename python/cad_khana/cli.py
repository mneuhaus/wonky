"""cad_khana's khana CLI (refused; use bin/wonky-python.mjs)."""

from cad_khana import _wonky

_WHAT = "the khana command line (build/check/view/draw/diff); build models with bin/wonky-python.mjs"

app = _wonky.refused_call("cad_khana.cli.app", _WHAT)
main = _wonky.refused_call("cad_khana.cli.main", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
