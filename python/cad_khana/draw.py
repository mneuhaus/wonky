"""cad_khana engineering drawings (refused)."""

from cad_khana import _wonky

_auto_enabled = False
_auto_out = None
_auto_fmt = "png"
_auto_themeable = False
_auto_views = None
_auto_part = None


def set_auto(enabled, out=None, fmt="png", themeable=False, views=None, part=None) -> None:
    global _auto_enabled, _auto_out, _auto_fmt, _auto_themeable, _auto_views, _auto_part
    _auto_enabled, _auto_out, _auto_fmt = enabled, out, fmt
    _auto_themeable, _auto_views, _auto_part = themeable, views, part


def auto_enabled():
    return _auto_enabled


def auto_out():
    return _auto_out


def auto_fmt():
    return _auto_fmt


def auto_themeable():
    return _auto_themeable


def auto_views():
    return _auto_views


def auto_part():
    return _auto_part


_WHAT = "hidden-line engineering drawings (build123d.exporters HLR, PIL rasterization)"

View = _wonky.refused_type("cad_khana.draw.View", _WHAT)
draw = _wonky.refused_call("cad_khana.draw.draw", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
