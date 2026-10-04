"""Exact planar interference fixtures for wonky-bool (boolean3d strand G2).

    uv run --no-project --with sympy python rust/wonky-bool/tests/data/planar_fixtures.py \
        > rust/wonky-bool/tests/data/planar-fixtures.txt

Consumer: rust/wonky-bool/tests/planar_fixtures.rs. Every expected value is
computed here with sympy Rationals, independently of the Rust code:

* relations from the Newell normals of the face loops (the Rust side maps the
  carrier normal by L^-T), transverse lines by solving the two plane equations
  plus one coordinate (Rust: a cross-product formula);
* E-E crossings by Cramer's rule on two coordinate rows (Rust: cross products);
* point location by even-odd crossing counts in the projection that drops the
  dominant normal axis (Rust: half-open winding in the face's own chart);
* sections as intersections of the interval sets of L within each face, cut at
  the paves on L (Rust: sorted paves plus one midpoint test per interval). The
  script asserts that every end of a section component is a pave, which is the
  completeness argument of the Rust module.

Coordinates are model coordinates of operand A (the working frame); B's own
coordinates are derived through the two placements so that the world geometry
of a configuration does not depend on B's placement.
"""
import hashlib
import pathlib

import sympy
from sympy import Matrix, Rational as R

EPS = R(1, 2**30)


def v(*c):
    return tuple(R(x) for x in c)


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def mul(a, s):
    return tuple(x * s for x in a)


def dot(a, b):
    return sum((x * y for x, y in zip(a, b)), R(0))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def zero(a):
    return all(x == 0 for x in a)


def fmt(*points):
    return " ".join(str(x) for p in points for x in p)


# ------------------------------------------------------------ solids
# A solid is a list of faces; a face is a list of loops (outer first), each a
# list of points, counter-clockwise about the outward normal (holes clockwise).


def box(lo, hi):
    (x0, y0, z0), (x1, y1, z1) = v(*lo), v(*hi)
    p = lambda x, y, z: (x, y, z)
    return [
        [[p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0)]],  # -z
        [[p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)]],  # +z
        [[p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)]],  # -y
        [[p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0)]],  # +y
        [[p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0)]],  # -x
        [[p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)]],  # +x
    ]


def prism(outer, holes, z0, z1):
    """Extrusion along +z of a counter-clockwise outline with counter-clockwise holes."""
    z0, z1 = R(z0), R(z1)
    outer = [v(*q) for q in outer]
    holes = [[v(*q) for q in h] for h in holes]
    at = lambda q, z: (q[0], q[1], z)
    top = [[at(q, z1) for q in outer]] + [[at(q, z1) for q in reversed(h)] for h in holes]
    bottom = [[at(q, z0) for q in reversed(outer)]] + [[at(q, z0) for q in h] for h in holes]
    sides = []
    for ring in [outer] + [list(reversed(h)) for h in holes]:
        for i in range(len(ring)):
            a, b = ring[i], ring[(i + 1) % len(ring)]
            sides.append([[at(a, z0), at(b, z0), at(b, z1), at(a, z1)]])
    return [bottom, top] + sides


def sum_points(ps):
    s = (R(0), R(0), R(0))
    for q in ps:
        s = add(s, q)
    return s


def newell(loop):
    n = [R(0)] * 3
    for i in range(len(loop)):
        a, b = loop[i], loop[(i + 1) % len(loop)]
        n[0] += (a[1] - b[1]) * (a[2] + b[2])
        n[1] += (a[2] - b[2]) * (a[0] + b[0])
        n[2] += (a[0] - b[0]) * (a[1] + b[1])
    return tuple(n)


def hull_faces(points, cycles):
    """Faces of a convex polyhedron, each oriented away from the centroid."""
    points = [v(*q) for q in points]
    c = mul(sum_points(points), R(1, len(points)))
    faces = []
    for t in cycles:
        loop = [points[i] for i in t]
        if dot(newell(loop), sub(c, loop[0])) > 0:
            loop = list(reversed(loop))
        faces.append([loop])
    return faces


def tetra(*p):
    return hull_faces(p, [(0, 1, 2), (0, 1, 3), (0, 2, 3), (1, 2, 3)])


def pyramid(base, apex):
    """Square pyramid: four base points in cyclic order, and the apex."""
    return hull_faces(list(base) + [apex], [(0, 1, 2, 3), (0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)])


def linear(rows, solid):
    """Apply p -> M p (M given by rows); reverse loops under a mirror."""
    m = Matrix(rows).applyfunc(R)
    f = lambda p: tuple(m * Matrix(p))
    flip = bool(m.det() < 0)
    return [[[f(p) for p in (reversed(l) if flip else l)] for l in face] for face in solid]


# ------------------------------------------------------------ placements
class Placement:
    def __init__(self, origin, columns):
        self.o = v(*origin)
        self.c = [v(*c) for c in columns]
        self.m = Matrix([[self.c[j][i] for j in range(3)] for i in range(3)])
        self.inv = self.m.inv()

    def point(self, p):
        return add(self.o, tuple(self.m * Matrix(p)))

    def inverse_point(self, p):
        return tuple(self.inv * Matrix(sub(p, self.o)))

    def line(self):
        return fmt(self.o, *self.c)


ID = Placement((0, 0, 0), [(1, 0, 0), (0, 1, 0), (0, 0, 1)])
BIG = Placement((2**25, 2**25, 2**25), [(1, 0, 0), (0, 1, 0), (0, 0, 1)])
T1 = Placement((R(1, 2), -3, 7), [(1, 0, 0), (0, 1, 0), (0, 0, 1)])
ROT = Placement((1, 2, 3), [(R(3, 5), R(4, 5), 0), (R(-4, 5), R(3, 5), 0), (0, 0, 1)])
SHEAR = Placement((0, 0, 0), [(2, 0, 0), (1, 1, 0), (0, 0, R(1, 2))])
MIRROR = Placement((0, 0, 0), [(-1, 0, 0), (0, 1, 0), (0, 0, 1)])


def frame_class(pa, pb):
    """Class of the map from B's frame to A's (R0-R3 as in wonky_geom::frame)."""
    lin = pa.inv * pb.m
    org = tuple(pa.inv * Matrix(sub(pb.o, pa.o)))
    if lin == sympy.eye(3) and zero(org):
        return "R0"
    cols = [list(lin[:, j]) for j in range(3)]
    if all(sum(1 for x in c if x != 0) == 1 and all(x in (0, 1, -1) for x in c) for c in cols):
        return "R1"
    if lin.T * lin == sympy.eye(3):
        return "R2"
    return "R3"


# ------------------------------------------------------------ exact geometry
def on_segment(p, a, b):
    d, w = sub(b, a), sub(p, a)
    if not zero(cross(d, w)):
        return False
    return 0 <= dot(w, d) <= dot(d, d)


def strictly_inside(p, a, b):
    d, w = sub(b, a), sub(p, a)
    return zero(cross(d, w)) and 0 < dot(w, d) < dot(d, d)


def solve_lines(p, d, q, e):
    """(t, u) with p + t d = q + u e for coplanar non-parallel lines, else None."""
    if zero(cross(d, e)) or dot(sub(q, p), cross(d, e)) != 0:
        return None
    w = sub(q, p)
    for i, j in ((0, 1), (0, 2), (1, 2)):
        det = d[i] * (-e[j]) - (-e[i]) * d[j]
        if det != 0:
            t = (w[i] * (-e[j]) - (-e[i]) * w[j]) / det
            u = (d[i] * w[j] - w[i] * d[j]) / det
            return t, u
    raise AssertionError("coplanar non-parallel lines without a regular 2x2 minor")


class Face:
    def __init__(self, loops, normal):
        self.loops = loops
        self.n = normal
        self.o = loops[0][0]
        self.k = max(range(3), key=lambda i: abs(normal[i]))

    def segments(self):
        for l in self.loops:
            for i in range(len(l)):
                yield l[i], l[(i + 1) % len(l)]

    def side(self, p):
        return dot(self.n, sub(p, self.o))

    def locate(self, p):
        assert self.side(p) == 0
        if any(on_segment(p, a, b) for a, b in self.segments()):
            return "boundary"
        i, j = [x for x in range(3) if x != self.k]
        crossings = 0
        for a, b in self.segments():
            if (a[j] > p[j]) != (b[j] > p[j]):
                x = a[i] + (p[j] - a[j]) * (b[i] - a[i]) / (b[j] - a[j])
                if p[i] < x:
                    crossings += 1
        return "inside" if crossings % 2 else "outside"


class Operand:
    def __init__(self, own_solid, working_solid, flip):
        self.own = own_solid
        self.faces = []
        for f in working_solid:
            n = newell(f[0])
            self.faces.append(Face(f, mul(n, -1) if flip else n))
        pts, edges = [], []
        for f in working_solid:
            for l in f:
                for i in range(len(l)):
                    if l[i] not in pts:
                        pts.append(l[i])
                    e = tuple(sorted((l[i], l[(i + 1) % len(l)])))
                    if e not in edges:
                        edges.append(e)
        self.points, self.edges = pts, edges


def chart(own_face, p):
    """The Rust Plane3 chart of a face in its own frame: o = first vertex,
    x = second - first vertex, n = Newell normal, y = n x x."""
    loop = own_face[0]
    o, x, n = loop[0], sub(loop[1], loop[0]), newell(loop)
    y = cross(n, x)
    d = sub(p, o)
    return (dot(d, x) / dot(x, x), dot(d, y) / dot(y, y))


def canonical_line(p, d):
    k = next(i for i in range(3) if d[i] != 0)
    d = mul(d, 1 / d[k])
    p = sub(p, mul(d, p[k]))
    return p, d


def relation(fa, fb):
    c = cross(fa.n, fb.n)
    if zero(c):
        s = dot(fa.n, sub(fb.o, fa.o))
        aligned = bool(dot(fa.n, fb.n) > 0)
        if s == 0:
            return ("identical" if aligned else "opposite",)
        return ("disjoint", int(aligned), int(bool(s > 0)), s * s / dot(fa.n, fa.n))
    k = next(i for i in range(3) if c[i] != 0)
    rows = [list(fa.n), list(fb.n), [1 if i == k else 0 for i in range(3)]]
    x = Matrix(rows).LUsolve(Matrix([dot(fa.n, fa.o), dot(fb.n, fb.o), 0]))
    return ("transverse", tuple(x), c)


def bbox(f):
    pts = [p for l in f.loops for p in l]
    return [tuple(min(p[k] for p in pts) for k in range(3)), tuple(max(p[k] for p in pts) for k in range(3))]


def breakpoints(f, p0, d):
    """Parameters on the line p0 + t d where it meets the boundary of face f."""
    ts = set()
    for a, b in f.segments():
        if zero(cross(d, sub(a, p0))) and zero(cross(d, sub(b, p0))):
            ts.add(dot(sub(a, p0), d) / dot(d, d))
            ts.add(dot(sub(b, p0), d) / dot(d, d))
            continue
        tu = solve_lines(p0, d, a, sub(b, a))
        if tu and 0 <= tu[1] <= 1:
            ts.add(tu[0])
    return ts


def section_parts(fa, fb, r, paves):
    """The section of two transverse faces: its pieces (x, y, location in fa,
    location in fb) in the order of the line, and its isolated points."""
    p0, d = r[1], r[2]
    at = lambda t: add(p0, mul(d, t))
    loc = lambda t: (fa.locate(at(t)), fb.locate(at(t)))
    ts = sorted(breakpoints(fa, p0, d) | breakpoints(fb, p0, d))
    point_in = {t: "outside" not in loc(t) for t in ts}
    interval_in = [("outside" not in loc((t0 + t1) / 2)) for t0, t1 in zip(ts, ts[1:])]
    # Maximal components of the section as parameter intervals, and isolated points.
    comps, isolated = [], []
    k = 0
    while k < len(ts):
        if k < len(interval_in) and interval_in[k]:
            start = k
            while k < len(interval_in) and interval_in[k]:
                k += 1
            comps.append((ts[start], ts[k]))
            continue
        if point_in[ts[k]] and not (k > 0 and interval_in[k - 1]):
            isolated.append(ts[k])
        k += 1
    # Paves of both faces' edges that lie on the line.
    cut = set()
    for s, face in (("A", fa), ("B", fb)):
        for e in {tuple(sorted((a, b))) for a, b in face.segments()}:
            for x in paves[s][e]:
                if fa.side(x) == 0 and fb.side(x) == 0:
                    cut.add(dot(sub(x, p0), d) / dot(d, d))
    for t0, t1 in comps:
        assert t0 in cut and t1 in cut, "a section component ends at a point that is not a pave"
    for t in isolated:
        assert t in cut, "an isolated contact is not a pave"
    pieces = []
    for t0, t1 in comps:
        bounds = [t0] + sorted(t for t in cut if t0 < t < t1) + [t1]
        for u0, u1 in zip(bounds, bounds[1:]):
            pieces.append((at(u0), at(u1)) + loc((u0 + u1) / 2))
    return pieces, [at(t) for t in isolated]


def section(i, j, fa, fb, r, A, B, paves, pa, pb):
    pieces, isolated = section_parts(fa, fb, r, paves)
    out = []
    own_a, own_b = A.own[i], B.own[j]
    to_b = lambda x: pb.inverse_point(pa.point(x))
    for x, y, la, lb in pieces:
        charts = fmt(chart(own_a, x), chart(own_a, y), chart(own_b, to_b(x)), chart(own_b, to_b(y)))
        out.append(f"piece {i} {j} {fmt(x, y)} {int(la == 'boundary')} {int(lb == 'boundary')} {charts}")
    for x in isolated:
        out.append(f"touch {i} {j} {fmt(x)}")
    return out


def interference(A, B, pa, pb):
    """Relations, box meets and the V-V..E-F facts as lines, the paves of
    every edge, and the relation of every face pair."""
    out = [f"frame {frame_class(pa, pb)}"]
    ops = {"A": A, "B": B}
    other = {"A": "B", "B": "A"}
    rel = {}
    for i, fa in enumerate(A.faces):
        for j, fb in enumerate(B.faces):
            r = rel[i, j] = relation(fa, fb)
            if r[0] == "transverse":
                out.append(f"relation {i} {j} transverse {fmt(*canonical_line(r[1], r[2]))}")
            elif r[0] == "disjoint":
                out.append(f"relation {i} {j} disjoint {r[1]} {r[2]} {r[3]}")
            else:
                out.append(f"relation {i} {j} {r[0]}")
            ba, bb = bbox(fa), bbox(fb)
            if all(ba[0][k] <= bb[1][k] and bb[0][k] <= ba[1][k] for k in range(3)):
                out.append(f"boxmeet {i} {j}")
    for p in A.points:
        if p in B.points:
            out.append(f"vv {fmt(p)}")
    paves = {s: {e: set(e) for e in ops[s].edges} for s in ops}
    for s in ops:
        for p in ops[s].points:
            for e in ops[other[s]].edges:
                if strictly_inside(p, *e):
                    out.append(f"ve {s} {fmt(p, *e)}")
                    paves[other[s]][e].add(p)
    for ea in A.edges:
        for eb in B.edges:
            tu = solve_lines(ea[0], sub(ea[1], ea[0]), eb[0], sub(eb[1], eb[0]))
            if tu and 0 < tu[0] < 1 and 0 < tu[1] < 1:
                x = add(ea[0], mul(sub(ea[1], ea[0]), tu[0]))
                assert x == add(eb[0], mul(sub(eb[1], eb[0]), tu[1]))
                out.append(f"ee {fmt(x, *ea, *eb)}")
                paves["A"][ea].add(x)
                paves["B"][eb].add(x)
    for s in ops:
        for p in ops[s].points:
            for fi, f in enumerate(ops[other[s]].faces):
                if f.side(p) == 0 and f.locate(p) == "inside":
                    out.append(f"vf {s} {fmt(p)} {fi}")
    for s in ops:
        for e in ops[s].edges:
            for fi, f in enumerate(ops[other[s]].faces):
                s0, s1 = f.side(e[0]), f.side(e[1])
                if s0 * s1 < 0:
                    x = add(e[0], mul(sub(e[1], e[0]), s0 / (s0 - s1)))
                    if f.locate(x) == "inside":
                        out.append(f"ef {s} {fmt(*e)} {fi} {fmt(x)}")
                        paves[s][e].add(x)
    for s in ops:
        for e, pts in paves[s].items():
            d = sub(e[1], e[0])
            ordered = sorted(pts, key=lambda p: dot(sub(p, e[0]), d))
            out.append(f"paves {s} {fmt(*e)} {len(ordered)} {fmt(*ordered)}")
    return out, paves, rel


def expectations(A, B, pa, pb):
    out, paves, rel = interference(A, B, pa, pb)
    for i, fa in enumerate(A.faces):
        for j, fb in enumerate(B.faces):
            if rel[i, j][0] == "transverse":
                out.extend(section(i, j, fa, fb, rel[i, j], A, B, paves, pa, pb))
    return out


# ------------------------------------------------------------ configurations
CUBE = box((0, 0, 0), (4, 4, 4))
LONG = box((0, 0, 0), (8, 4, 4))
GENERIC_B = box((1, 2, -1), (5, 6, 3))
FRAME = prism([(0, 0), (6, 0), (6, 6), (0, 6)], [[(2, 2), (4, 2), (4, 4), (2, 4)]], 0, 2)
TWO_HOLES = prism(
    [(0, 0), (10, 0), (10, 4), (0, 4)], [[(2, 1), (4, 1), (4, 3), (2, 3)], [(6, 1), (8, 1), (8, 3), (6, 3)]], 0, 2
)
L_PRISM = prism([(0, 0), (6, 0), (6, 2), (2, 2), (2, 6), (0, 6)], [], 0, 2)
ROT_Z = [[R(3, 5), R(-4, 5), 0], [R(4, 5), R(3, 5), 0], [0, 0, 1]]
ROT_X = [[1, 0, 0], [0, R(3, 5), R(-4, 5)], [0, R(4, 5), R(3, 5)]]
TOP_PYRAMID_BASE = [v(1, 1, 6), v(3, 1, 6), v(3, 3, 6), v(1, 3, 6)]

CONFIGS = [
    # name, A and B in the working frame (A's model frame), A placement, B placement
    ("overlap-generic", CUBE, GENERIC_B, ID, ID),
    ("overlap-generic-r1", CUBE, GENERIC_B, ID, T1),
    ("overlap-generic-r2", CUBE, GENERIC_B, ID, ROT),
    ("overlap-generic-r3", CUBE, GENERIC_B, ID, SHEAR),
    ("overlap-generic-mirror", CUBE, GENERIC_B, ID, MIRROR),
    ("overlap-generic-far", CUBE, GENERIC_B, BIG, BIG),
    ("rotated-both-frames", CUBE, GENERIC_B, ROT, ROT),
    ("contained", CUBE, box((1, 1, 1), (2, 2, 2)), ID, ID),
    ("disjoint", CUBE, box((10, 10, 10), (11, 11, 11)), ID, ID),
    ("face-contact-full-opposite", LONG, box((8, 0, 0), (16, 4, 4)), ID, ID),
    ("face-contact-partial", LONG, box((8, 1, 1), (16, 3, 5)), ID, ID),
    ("coincident-bottom-inside", CUBE, box((2, 1, 0), (6, 3, 2)), ID, ID),
    ("coincident-bottom-crossing-edges", CUBE, box((2, -1, 0), (6, 2, 3)), ID, ID),
    ("coplanar-faces-apart", CUBE, box((0, 5, 4), (4, 6, 5)), ID, ID),
    ("parallel-disjoint-aligned", CUBE, box((1, 1, 5), (3, 3, 6)), ID, ID),
    ("identical-copy", CUBE, CUBE, ID, ID),
    ("identical-copy-r2", CUBE, CUBE, ID, ROT),
    ("edge-on-face-inside", CUBE, tetra((1, 1, 4), (3, 3, 4), (2, 1, 6), (1, 3, 5)), ID, ID),
    ("edge-on-face-crossing-boundary", CUBE, tetra((2, 2, 4), (6, 2, 4), (4, 1, 6), (4, 3, 6)), ID, ID),
    ("vertex-on-edge", CUBE, pyramid([v(1, -3, 6), v(3, -3, 6), v(3, -1, 6), v(1, -1, 6)], v(2, 0, 4)), ID, ID),
    ("vertex-on-face", CUBE, pyramid(TOP_PYRAMID_BASE, v(2, 2, 4)), ID, ID),
    ("vertex-on-vertex", CUBE, box((4, 4, 4), (8, 8, 8)), ID, ID),
    ("edge-on-edge-collinear", CUBE, box((4, 4, 1), (8, 8, 3)), ID, ID),
    ("edge-on-edge-t-junction", CUBE, box((1, 2, 4), (3, 4, 6)), ID, ID),
    ("edge-crossing-edge-penetrating", CUBE, tetra((2, -1, 5), (2, 1, 3), (0, -2, 7), (4, -2, 7)), ID, ID),
    ("rod-through", CUBE, box((1, 1, -2), (3, 3, 6)), ID, ID),
    ("rod-through-r3", CUBE, box((1, 1, -2), (3, 3, 6)), ID, SHEAR),
    ("cross-bars-coplanar-crossings", box((-4, -1, -1), (4, 1, 1)), box((-1, -4, -1), (1, 4, 1)), ID, ID),
    ("rotated-generic", linear(ROT_Z, CUBE), box((1, 1, 1), (3, 3, 5)), ID, ID),
    ("tilted-generic", linear(ROT_X, CUBE), box((1, -2, 1), (3, 5, 3)), ID, ID),
    ("slanted-wedge", prism([(0, 0), (6, 0), (0, 6)], [], 0, 4), box((2, 2, 1), (5, 5, 3)), ID, ID),
    ("l-prism-two-pieces", L_PRISM, prism([(5, 0), (10, 10), (0, 5)], [], -1, 3), ID, ID),
    ("frame-with-hole", FRAME, box((3, -1, -1), (8, 7, 1)), ID, ID),
    ("inside-hole", FRAME, box((R(5, 2), R(5, 2), R(1, 2)), (R(7, 2), R(7, 2), R(3, 2))), ID, ID),
    ("hole-wall-contact", FRAME, box((2, R(5, 2), R(1, 2)), (3, R(7, 2), R(3, 2))), ID, ID),
    ("two-holes-three-pieces", TWO_HOLES, box((-1, R(3, 2), -1), (11, R(5, 2), 1)), ID, ID),
    (
        "non-dyadic-tetra",
        tetra((0, 0, 0), (3, 0, 0), (0, 3, 0), (0, 0, 3)),
        box((R(1, 3), R(1, 3), -1), (R(5, 3), R(7, 3), R(2, 3))),
        ID,
        ID,
    ),
    ("diagonal-through-vertices", CUBE, prism([(-2, -2), (6, 6), (-2, 6)], [], 1, 3), ID, ID),
    # Near-coincident pairs 2^-30 apart, placed at 2^25 where binary64 world
    # caches cannot tell them apart (the binary64 spacing there is 2^-27).
    ("near-gap-2^-30", LONG, box((8 + EPS, 0, 0), (16, 4, 4)), BIG, BIG),
    ("near-overlap-2^-30", LONG, box((8 - EPS, 0, 0), (16, 4, 4)), BIG, BIG),
    ("near-vertex-2^-30", CUBE, box((4 + EPS, 4 + EPS, 4 + EPS), (8, 8, 8)), BIG, BIG),
    ("near-apex-2^-30-deep", CUBE, pyramid(TOP_PYRAMID_BASE, v(2, 2, 4 - EPS)), BIG, BIG),
    ("near-shifted-copy-2^-30", CUBE, box((EPS, EPS, 0), (4 + EPS, 4 + EPS, 4)), BIG, BIG),
    ("near-cross-bars-2^-30", box((-4, -1, -1), (4, 1, 1)), box((-1, -4, -1 + EPS), (1, 4, 1 + EPS)), BIG, BIG),
]


def operands(a_working, b_working, pa, pb):
    """A and B (B in its own frame, and back in the working frame with its own
    loop order) and the placement and face lines that define them."""
    to_b = lambda p: pb.inverse_point(pa.point(p))
    flip = bool((pb.inv * pa.m).det() < 0)
    b_own = [[[to_b(p) for p in (reversed(l) if flip else l)] for l in face] for face in b_working]
    # B in the working frame with B's own loop order (reversed back under a mirror).
    to_w = lambda p: pa.inverse_point(pb.point(p))
    b_back = [[[to_w(p) for p in l] for l in face] for face in b_own]
    A = Operand(a_working, a_working, False)
    B = Operand(b_own, b_back, flip)
    lines = [f"placement A {pa.line()}", f"placement B {pb.line()}"]
    for tag, solid in (("A", a_working), ("B", b_own)):
        for i, face in enumerate(solid):
            loop = face[0]
            o, x, n = loop[0], sub(loop[1], loop[0]), newell(loop)
            body = " ".join(f"{len(l)} {fmt(*l)}" for l in face)
            lines.append(f"face {tag} {i} {fmt(o, x, n)} {len(face)} {body}")
    return A, B, lines


def emit(name, a_working, b_working, pa, pb):
    A, B, lines = operands(a_working, b_working, pa, pb)
    lines = [f"config {name}"] + lines
    lines.extend(sorted(expectations(A, B, pa, pb)))
    lines.append("end")
    return lines


def main():
    script = pathlib.Path(__file__).read_bytes()
    print("# wonky/bool-planar-fixtures/1")
    print("# consumer: rust/wonky-bool/tests/planar_fixtures.rs (boolean3d strand G2)")
    print(
        "# how: uv run --no-project --with sympy python rust/wonky-bool/tests/data/planar_fixtures.py"
        " > rust/wonky-bool/tests/data/planar-fixtures.txt"
    )
    print(f"# script sha256 {hashlib.sha256(script).hexdigest()}; sympy {sympy.__version__}")
    print(f"# configurations: {len(CONFIGS)}")
    for c in CONFIGS:
        for line in emit(*c):
            print(line)


if __name__ == "__main__":
    main()
