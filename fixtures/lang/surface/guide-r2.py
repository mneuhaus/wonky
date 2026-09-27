"""Alternate chute - universal funnel bracket R2, hand-translated to WPy from
~/Workspace/cad/cad-project-002/funnel-holder-r2/guide-r2.fs
(sha256 6fa65ec7..., 111 lines). The three imported Part Studios become frozen
imports; FS stage labels become stable node ids (every error names its path)."""
from wonky import *
from math import sqrt

REVS = {"guide": 2}
# R2: closer rigid locating faces, with positive sliding clearance.
FIT = {"chute": 0.10, "seat": 0.10, "funnel": 0.15}
RAIL_AXIS = Vector(0.86602540378443864676, 0, -0.5)
WIDTH_AXIS = Vector(0.5, 0, 0.86602540378443864676)
WIDTH_CENTER = 95.13139720814405
WIDTH_MIRROR = Plane(origin=WIDTH_AXIS * WIDTH_CENTER, z_dir=WIDTH_AXIS)

# Other Part Studios, pinned by document and version (FS: Guides::import(...)).
guides = frozen_import("651610df74efbe36ad793aa1", version="a097c1094ad5072c3034ddc9")
core = frozen_import("4fafda70dadde2a5c15cf725", version="46f77282b3c3b2edf4ca0c2d").solids().sort_by(SortBy.VOLUME)[-1]
funnel = frozen_import("b932c037b6696388ad797968", version="4c5104237e6dd966057b5b0a").solids().sort_by(SortBy.VOLUME)[-1]


def relieve_chute_seat(guide):
    seat = [f for f in guide.faces().filter_by(GeomType.PLANE)
            if abs(f.normal_at().dot(RAIL_AXIS)) < 0.001
            and abs(abs(f.normal_at().Y) - sqrt(0.5)) < 0.001
            and f.bounding_box().min.Y >= -65.001 and f.bounding_box().max.Y <= -59.999]
    expect(2 <= len(seat) <= 4, "symmetric chute seat ramps")
    return offset_faces(guide, seat, -FIT["seat"])


def relieve_envelope(guide, tool, clearance):
    """A translated envelope keeps the small latch details that a global face
    offset would self-intersect; the relief is symmetric about the rail width."""
    shifts = [Pos((RAIL_AXIS * x + Vector(0, y, 0) + WIDTH_AXIS * z) * clearance)
              for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    tools = [tool] + [s * tool for s in shifts]
    tools += [mirror(t, about=WIDTH_MIRROR) for t in tools]
    return guide - tools


left = [b for b in guides.solids() if b.bounding_box().max.Y < 0]
expect(len(left) == 1, "one left source guide")
guide = left[0]
guide = guide & mirror(guide, about=WIDTH_MIRROR)  # matching bevel on both guide ends
guide = relieve_chute_seat(guide)
guide = relieve_envelope(guide, Pos(0.26, -0.15, -29.549666790031) * core, FIT["chute"])
guide = relieve_envelope(guide, Location((0.3206217782650187, -0.15, -88.67319640089098), (0, 0, 180)) * funnel, FIT["funnel"])

mark = Plane(origin=RAIL_AXIS * -14.57574011420742 + WIDTH_AXIS * WIDTH_CENTER + Vector(0, -76, 0),
             x_dir=RAIL_AXIS, z_dir=(0, -1, 0))
guide -= extrude(mark * Text(f"GUIDE R{REVS['guide']}", font_size=2.4), -0.3)  # engrave 0.3 mm
guide.label = "funnel_bracket_universal"
guide.color = Color(0.65, 0.34, 0.26)
expect(len(guide.solids()) == 1, "one reversible printable guide")
result = guide
