"""cad_khana error hints for its CLI diagnostics (refused)."""

from cad_khana import _wonky

match_hint = _wonky.refused_call("cad_khana.mechanism.hints.match_hint",
                                 "hints for build123d/OCCT error texts in khana diagnostics")

__getattr__ = _wonky.module_getattr(__name__)
