from build123d import Align, Box, Pos

stock = Box(50, 40, 12, align=Align.MIN)
cutter = Pos(8, 8, 4) * Box(30, 24, 10, align=Align.MIN)
result = stock - cutter
