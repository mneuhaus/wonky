# Corpus: `try: diag = inspect(...)` (cad-project-003 family files). A refused
# cad_khana diagnostic stays a capability error even when the model catches it.
from build123d import Box

from cad_khana.printability.inspect import inspect
from cad_khana.printability.methods import FDM

result = Box(10, 10, 10)
try:
    diag = inspect(result, method=FDM(wall_min_mm=0.8), name="cube", out="outputs")
except Exception:
    diag = None
