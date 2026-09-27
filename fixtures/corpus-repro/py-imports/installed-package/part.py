# Corpus cluster py-imports, installed-package half (32 units: numpy 18,
# pytest 6, cad_khana 5, bd_warehouse 2, trimesh 1). Run it with the wrapper
# next to this file, whose interpreter HAS numpy:
#   ./python-with-numpy -c "import numpy"      -> works
#   node bin/wonky-python.mjs <this> --check --python <wrapper>  -> No module named 'numpy'
# The runner's -S drops every site-packages directory, including a project venv's.
from build123d import *
import numpy as np

length, width, height = np.array([20.0, 10.0, 5.0]).tolist()
result = Box(length, width, height)
