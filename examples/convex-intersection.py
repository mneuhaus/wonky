from build123d import *

first = Box(40, 30, 12, align=Align.MIN)
second = Pos(10, -5, 4) * Box(40, 27, 16, align=Align.MIN)
result = first & second
assert result.volume == 5280
