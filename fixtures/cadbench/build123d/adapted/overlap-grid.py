# Adapted from build123d bc19b031cad4bda9568c6ed3f86c51ba17c97fe5: AlgebraTests.test_empty_plus_overlapping_parts
# Apache-2.0; see ../upstream/NOTICE. See manifest.json for omitted assertions.
from build123d import *
boxes = [Pos(ix * 0.8, iy * 0.8, 0) * Box(1, 1, 1) for ix in range(3) for iy in range(3)]
sequential = boxes[0]
for box in boxes[1:]:
    sequential += box
result = sequential
