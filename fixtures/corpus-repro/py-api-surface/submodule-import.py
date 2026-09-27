# Side repro, cluster py-api-surface: next blocker of the cad_khana users
# (cad_khana/draw.py:8, reached via cad-project-013/camera_mount_assembly.py).
# The runner's NoExternalGeometry finder is meant to refuse build123d
# submodules with a capability error, but the shim module is not a package,
# so Python raises ModuleNotFoundError before any meta-path finder runs.
from build123d.exporters import Drawing

result = Box(1, 1, 1)
