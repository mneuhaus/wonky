from build123d import Align, Box, Pos

first = Box(40, 30, 10, align=Align.MIN)
second = Pos(20, 10, 0) * Box(30, 25, 10, align=Align.MIN)
result = first + second
