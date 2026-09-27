"""wonky's cad_khana compatibility package (not the cad-khana distribution).

Provides cad_khana's modeling API on B-reps built by the Bend build123d shim:
Assembly with named, placed, colored parts. A model that binds a module-level
`assembly` becomes one wonky body group per part, with the part name and
color. cad_khana's diagnostics (check, inspect, printability, drawings,
exports, viewer push) raise explicit capability errors at their call.
Policy and coverage: docs/python-khana.md.
"""

from cad_khana import _wonky

__wonky_shim__ = "cad_khana"

__getattr__ = _wonky.module_getattr(__name__, __file__)
