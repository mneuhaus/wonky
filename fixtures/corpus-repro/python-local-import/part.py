# Corpus: multi-file build123d projects (cad-project-017, cad-project-032,
# cad-project-026, ...). The runner starts Python with -I -S, so a sibling module
# next to the model file is not importable.
from build123d import *
from params import WIDTH

result = Box(WIDTH, 10, 5)
