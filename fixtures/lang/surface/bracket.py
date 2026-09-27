"""L-bracket of examples/bracket.fs in WPy: outline 50 x 40 mm, extruded 8 mm."""
from wonky import *

THICKNESS = param(8.0, min=0.1)  # mm; the FeatureScript feature's "thickness"

outline = Polygon((0, 0), (50, 0), (50, 12), (18, 12), (18, 40), (0, 40), align=None)
bracket = extrude(Plane.XY * outline, THICKNESS)

expect(abs(bracket.volume - 8832) < 1e-6, "bracket volume is 8832 mm^3")
result = bracket
