# Adapted from build123d bc19b031cad4bda9568c6ed3f86c51ba17c97fe5: AlgebraTests.test_empty_plus_rotated_parts
# Apache-2.0; see ../upstream/NOTICE. See manifest.json for omitted assertions.
from build123d import *
boxes = [Rot(0, 0, index * 17) * Pos(index * 0.35, index * 0.15, 0) * Box(1.2, 0.8, 1) for index in range(5)]
sequential = boxes[0]
for box in boxes[1:]:
    sequential += box
result = sequential
