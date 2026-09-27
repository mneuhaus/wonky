# Next-blocker repro, cluster py-api-surface (checked 2026-09-23): what
# cad-project-003/project-component-abeb2fd3.py tray() runs before its stage-1 next blocker
# (Circle, line 559), with the file's own values. Only shim API, so it builds
# today, but the planar arrangement returns 114 faces for a solid with 11, and
# the second Boolean alone costs about 30 s of CPU on the JS path. tray() has
# dozens more Booleans after this prefix. See
# docs/corpus/cluster-py-api-surface.md section 5.
from build123d import Box, Pos

TRAY_L, TRAY_W, TRAY_H = 56.0, 29.44, 11.78
FLOOR, INNER_D, INNER_L, CAV_W = 1.68, 10.1, 52.64, 24.4
BLOCK_X0 = 8.38
block_x1 = TRAY_L / 2 - 1.0

body = Pos(0, 0, TRAY_H / 2) * Box(TRAY_L, TRAY_W, TRAY_H)
body -= Pos(0, 0, FLOOR + INNER_D / 2) * Box(INNER_L, CAV_W, INNER_D)
body += Pos((BLOCK_X0 + block_x1) / 2, 0, (0.5 + TRAY_H) / 2) * Box(block_x1 - BLOCK_X0, CAV_W + 2, TRAY_H - 0.5)
result = body
