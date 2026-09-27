"""cad_khana exports (refused; the wonky CLI writes STEP and B-rep for `assembly`)."""

from cad_khana import _wonky

_WHAT = ("per-part STL/STEP and glTF exports through OCP; bind the assembly to module-level "
         "`assembly` and let bin/wonky-python.mjs write STEP and brep.json with one named body group per part")
_M = "cad_khana.export"

export_assembly = _wonky.refused_call(f"{_M}.export_assembly", _WHAT)
export_glb = _wonky.refused_call(f"{_M}.export_glb", _WHAT)
export_animated_glb = _wonky.refused_call(f"{_M}.export_animated_glb", _WHAT)
_structural_groups = _wonky.refused_call(f"{_M}._structural_groups", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
