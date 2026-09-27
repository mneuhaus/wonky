# Sibling module of part.py. Uses the same build123d import as the model, like
# cad-project-017/params.py + cutter.py or cad-project-032/project-component-32f60153.py + kasse.py.
from build123d import *

WIDTH = 20


def plate(thickness):
    return Box(WIDTH, 10, thickness, align=(Align.CENTER, Align.CENTER, Align.MIN))
