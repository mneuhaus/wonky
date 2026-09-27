"""cad_khana OCP viewer push (refused; use wonky's own viewer)."""

from cad_khana import _wonky

_auto_enabled = False


def set_auto(enabled: bool) -> None:
    global _auto_enabled
    _auto_enabled = enabled


def auto_enabled() -> bool:
    return _auto_enabled


push = _wonky.refused_call(
    "cad_khana.viewer.push",
    "pushing to the OCP CAD viewer (ocp_vscode); bind the assembly to module-level `assembly` "
    "and open the build in wonky's viewer (bin/wonky-view.mjs)")

__getattr__ = _wonky.module_getattr(__name__)
