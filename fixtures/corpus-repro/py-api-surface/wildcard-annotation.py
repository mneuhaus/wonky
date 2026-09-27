# Repro, cluster py-api-surface (wildcard import), standing for 6 corpus files:
# cad-project-047/ei.py:53, cad-project-035/project-component-d98e059b.py:136 and
# cad-project-033/case.py:132 ('-> Sketch'), cad-project-026/bar.py:86 ('-> Part'),
# cad-project-032/project-component-32f60153.py:20 (FontStyle.BOLD), cad-project-048/mount.py:47
# (import_step). `from build123d import *` binds only the shim's __all__, so a
# build123d name in a return annotation, evaluated when `def` runs, is a plain
# NameError, not a capability error, and nothing is built before it.
from build123d import *


def plate(size: float = 20.0) -> Sketch:
    return Box(size, size, 2)


result = plate()
