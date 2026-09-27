"""Four independent pocketed blocks. The graph has four disjoint cones; the
native backend evaluates them fork-join without any `par` in the source."""
from wonky import *

def pocket(dx):
    block = Pos(dx, 0, 0) * Box(50, 40, 12, align=Align.MIN)
    cavity = Pos(dx + 8, 8, 4) * Box(30, 24, 10, align=Align.MIN)
    return block - cavity

result = [pocket(dx) for dx in (0, 100, 200, 300)]
