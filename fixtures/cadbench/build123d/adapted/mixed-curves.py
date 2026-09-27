# Adapted from build123d bc19b031cad4bda9568c6ed3f86c51ba17c97fe5: AlgebraTests.test_empty_plus_mixed_curved_parts
# Apache-2.0; see ../upstream/NOTICE. See manifest.json for omitted assertions.
from build123d import *
shapes = [Box(2, 2, 1), Pos(0.5, 0.5, 0) * Cylinder(0.8, 1), Pos(-0.4, 0.3, 0) * Cylinder(0.5, 1), Pos(0.2, -0.6, 0) * Box(0.8, 0.8, 1)]
sequential = shapes[0]
for shape in shapes[1:]:
    sequential += shape
result = sequential
