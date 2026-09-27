from build123d import Align, Box, Pos

stock = Box(50, 40, 10, align=Align.MIN)
opening = Pos(8, 8, -1) * Box(34, 24, 12, align=Align.MIN)
frame = stock - opening
tab = Pos(48, 10, 0) * Box(12, 20, 10, align=Align.MIN)
result = frame + tab
