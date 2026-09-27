"""Belt hopper rounded corner inserts R1, hand-translated to WPy from
~/Workspace/cad/cad-project-039/hopper-corner-inserts-r1/inserts.fs
(sha256 ba2fb8d6..., 55 lines). Same numbers, same order of operations."""
from wonky import *
from math import atan2, cos, radians, sin, sqrt

K = 1.0344073449972673
SECTIONS_X = [-120, -95, -72, -51, -44, -36.5]
TRIM_NORMAL = Vector(-0.6932337712483952, -0.6241555926213797, -0.360356399416164).normalized()
POSE = Location((77.1263837814323, -498.4724643754777, -184.5128995194368), (60, 0, 0))


def fill_section(x, r, floor_n):
    """Chute cross-section in the YZ plane at `x` (lines + one arc)."""
    sn = sqrt(1 + K * K)
    origin_s = (floor_n + 0.3 * sn) / K
    c = r * (1 + sn) / K
    ts = (c + K * r) / (1 + K * K)
    tn = K * ts
    end_s = c - sqrt(2 * r - 1)
    centre = (origin_s + c, floor_n + r)
    a0 = atan2(1 - r, end_s - c)
    a1 = atan2(tn - r, ts - c) - radians(360)
    am = (a0 + a1) / 2
    mid = (centre[0] + r * cos(am), centre[1] + r * sin(am))
    o, b = (origin_s, floor_n), (origin_s + end_s, floor_n)
    f, t = (origin_s + end_s, floor_n + 1), (origin_s + ts, floor_n + tn)
    outline = Line(o, b) + Line(b, f) + ThreePointArc(f, mid, t) + Line(t, o)
    return Plane(origin=(x, 0, 0), x_dir=(0, 1, 0), z_dir=(1, 0, 0)) * make_face(outline)


def trim_outside(body, normal, point):
    """Remove everything on the positive side of the plane (point, normal)."""
    half_space = extrude(Plane(origin=point, z_dir=normal) * Rectangle(1000, 1000), 500)
    return body - half_space


sections = []
for x in SECTIONS_X:
    floor_n = 0.3 if x <= -51 else 0.3 - (x + 51) / 14.5 * 12.3
    r = 18 + 0.55 * (-x - 36.5)
    sections.append(fill_section(x, r, floor_n))

left = loft(sections)
left = trim_outside(left, TRIM_NORMAL, Vector(-51, 0, 0) - TRIM_NORMAL * 0.3)
# exact main-panel seat: remove interpolation overshoot only outside the belt
seat_cut = extrude(Plane.XY.offset(0.3) * (Pos(-300, -100) * Rectangle(249, 400, align=Align.MIN)), -100)
left = left - seat_cut
right = mirror(left, about=Plane.YZ)

left.label = "P01 Hopper rounded corner L R1 - glue in"
right.label = "P02 Hopper rounded corner R R1 - glue in"
left.color = right.color = Color(0.28, 0.64, 0.53)
result = [POSE * left, POSE * right]
