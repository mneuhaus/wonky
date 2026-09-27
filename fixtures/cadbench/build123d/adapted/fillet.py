# Adapted from build123d bc19b031cad4bda9568c6ed3f86c51ba17c97fe5: OperationsTests.test_fillet_3d
# Apache-2.0; see ../upstream/NOTICE. See manifest.json for omitted assertions.
from build123d import *
b = Box(1, 2, 3)
c = fillet(b.edges(), radius=0.2)
result = c
