# Repro, cluster py-api-surface (named imports), standing for 34 corpus files,
# e.g. cad-project-025/beam_frame.py:30, cad-project-041/.../r10b/cores.py:16,
# cad-project-003/kalibrier.py:13, cad-project-013/camera_mount.py:17.
# The import statement itself fails, at the FIRST unknown name of the list
# (Compound), before any geometry. Part/RectangleRounded/extrude are never
# reached, so the recorded API name is an artifact of import order.
from build123d import Box, Compound, Part, RectangleRounded, extrude

result = Part() + Box(10, 10, 10)
