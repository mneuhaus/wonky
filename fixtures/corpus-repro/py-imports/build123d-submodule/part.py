# Corpus: bd_warehouse (cad-project-013/wasteboard.py, cad-project-026/scissor.py)
# imports build123d.build_common. docs/python-frontend.md says build123d
# submodule imports are rejected as capability errors; the shim module has no
# __path__, so CPython raises ModuleNotFoundError ("'build123d' is not a
# package") before the runner's NoExternalGeometry finder is consulted.
from build123d import *
from build123d.build_common import Locations

result = Box(20, 10, 5)
