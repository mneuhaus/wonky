# Corpus cluster py-imports, project-local half (17 units: params, project-component-32f60153,
# hardware_refs, case, bar, family, lego_test_helpers). `python part.py` puts
# this directory on sys.path[0]; wonky's runner does not, so the sibling
# module is not importable.
from build123d import *
import helpers

result = helpers.plate(5)
