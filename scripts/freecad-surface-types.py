"""Reads a STEP file in FreeCAD and prints the surface type of every face and
the curve type of every edge as JSON.

Run through freecadcmd (an import oracle only, never production geometry):
    WONKY_STEP=path.step freecadcmd scripts/freecad-surface-types.py
The result is the last line that starts with 'SURFACE_TYPES '.
"""
import json
import os

import Part

shape = Part.read(os.environ["WONKY_STEP"])
counts = {}
for face in shape.Faces:
    name = type(face.Surface).__name__
    counts[name] = counts.get(name, 0) + 1
curves = {}
for edge in shape.Edges:
    if edge.Degenerated:
        continue
    name = type(edge.Curve).__name__
    curves[name] = curves.get(name, 0) + 1
print("SURFACE_TYPES " + json.dumps({"solids": len(shape.Solids), "faces": len(shape.Faces), "volume": shape.Volume, "surfaces": counts, "curves": curves}, sort_keys=True))
