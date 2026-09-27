"""Project module with the part builders (as case.py in cad-project-033)."""
from build123d import Box, Cylinder, Pos, Align


def build_tray():
    return Box(40, 30, 3, align=(Align.CENTER, Align.CENTER, Align.MIN))


def build_hood():
    shell = Box(40, 30, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
    cavity = Pos(0, 0, 3) * Box(36, 26, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return shell - cavity


def build_pin():
    return Cylinder(1.5, 8, align=(Align.CENTER, Align.CENTER, Align.MIN))
