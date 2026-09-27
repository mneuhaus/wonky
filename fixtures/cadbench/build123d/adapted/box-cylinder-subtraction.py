# Adapted from build123d bc19b031cad4bda9568c6ed3f86c51ba17c97fe5: AlgebraTests.test_part_minus
# Apache-2.0; see ../upstream/NOTICE. See manifest.json for omitted assertions.
from build123d import *
box = Box(1, 2, 3)
cylinder = Cylinder(0.2, 5)
result = box - cylinder
