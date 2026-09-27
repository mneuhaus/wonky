from build123d import *

# Dimensions and translations use millimeters. Box is centered by default.
size = (20, 12, 8)
result = Pos(10, 6, 4) * Box(*size)
assert result.volume == 1920
