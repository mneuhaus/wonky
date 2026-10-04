"""Exact planar face-split fixtures for wonky-bool (boolean3d strand G3).

    uv run --no-project --with sympy==1.14.0 python rust/wonky-bool/tests/data/split_fixtures.py \
        > rust/wonky-bool/tests/data/split-fixtures.txt

Consumer: rust/wonky-bool/tests/face_split.rs. The configurations are the 44
of planar_fixtures.py (strand G2) plus nested ones: section loops around
section loops and around holes, several holes each inside its own section
loop, a hole crossing a section loop, under R0-R3, mirror and far
placements. For every face of both operands, in the face's own chart (the
Rust `Plane3` chart: origin the first vertex, x the first edge, n the
Newell normal), the script computes with sympy Rationals:

* the pieces: the face's edges cut at the P3 paves and the P4 section pieces
  of every transverse face pair (both from planar_fixtures.py, whose own
  expectations are independent of the Rust code);
* slits: section pieces removed by repeatedly dropping a section piece that
  no edge covers and that has an end of degree one; V and E of the rest;
* the fragments and their exact areas by a vertical slab decomposition, which
  shares nothing with the half-edge walk of the Rust arrangement: between
  consecutive vertex abscissae, the trapezoids between consecutive pieces
  that span the slab (all pieces, slits included) are kept when their
  midpoint lies inside the face (even-odd over its loops); trapezoids of
  neighbouring slabs are one fragment when their intervals on the common
  vertical line overlap in more than a point that no vertical piece covers.

Line format: `split <A|B> <face> <V> <E> <slits> <fragments> <areas...>`, the
areas ascending.
"""
import hashlib
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))

import sympy  # noqa: E402
from sympy import Matrix, Rational as R  # noqa: E402

import planar_fixtures as pf  # noqa: E402


# ------------------------------------------------------------ chart geometry
def even_odd(p, segments):
    """p (off every segment) lies inside the region the segments bound."""
    crossings = 0
    for a, b in segments:
        if (a[1] > p[1]) != (b[1] > p[1]):
            x = a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if p[0] < x:
                crossings += 1
    return crossings % 2 == 1


def covered(lo, hi, intervals):
    """The open interval (lo, hi) lies in the union of the closed intervals."""
    cur = lo
    for c, d in sorted(intervals):
        if d <= cur:
            continue
        if c > cur:
            return False
        cur = d
        if cur >= hi:
            return True
    return cur >= hi


def fragments(segments, inside):
    """Areas of the connected regions of `inside` cut by the segments."""
    xs = sorted({p[0] for s in segments for p in s})
    vertical, slanted = {}, []
    for s in segments:
        a, b = sorted(s)
        if a[0] == b[0]:
            vertical.setdefault(a[0], []).append((a[1], b[1]))
        else:
            slanted.append((a, b))

    def y(s, x):
        a, b = s
        return a[1] + (x - a[0]) * (b[1] - a[1]) / (b[0] - a[0])

    slabs = []  # per slab: list of (interval at x0, interval at x1, area) of kept trapezoids
    for x0, x1 in zip(xs, xs[1:]):
        xm = (x0 + x1) / 2
        active = sorted((s for s in slanted if s[0][0] <= x0 and s[1][0] >= x1), key=lambda s: y(s, xm))
        for s, t in zip(active, active[1:]):
            assert y(s, x0) <= y(t, x0) and y(s, x1) <= y(t, x1) and y(s, xm) < y(t, xm), "pieces cross inside a slab"
        kept = []
        for s, t in zip(active, active[1:]):
            if inside((xm, (y(s, xm) + y(t, xm)) / 2)):
                left, right = (y(s, x0), y(t, x0)), (y(s, x1), y(t, x1))
                kept.append((left, right, (x1 - x0) * ((left[1] - left[0]) + (right[1] - right[0])) / 2))
        slabs.append(kept)
    ids = [(i, k) for i, kept in enumerate(slabs) for k in range(len(kept))]
    parent = {n: n for n in ids}

    def find(n):
        while parent[n] != n:
            n = parent[n]
        return n

    for i in range(len(slabs) - 1):
        wall = vertical.get(xs[i + 1], [])
        for k, (_, right, _) in enumerate(slabs[i]):
            for m, (left, _, _) in enumerate(slabs[i + 1]):
                lo, hi = max(right[0], left[0]), min(right[1], left[1])
                if lo < hi and not covered(lo, hi, wall):
                    parent[find((i, k))] = find((i + 1, m))
    areas = {}
    for n in ids:
        areas[find(n)] = areas.get(find(n), R(0)) + slabs[n[0]][n[1]][2]
    return sorted(areas.values())


def prune(old, cut):
    """Drop section segments with an end of degree one until none is left.
    Returns the remaining segments and the number of dropped ones."""
    alive = set(old) | set(cut)
    dropped = 0
    while True:
        degree = {}
        for s in alive:
            for p in s:
                degree[p] = degree.get(p, 0) + 1
        leaf = next((s for s in sorted(alive, key=sorted) if s not in old and any(degree[p] == 1 for p in s)), None)
        if leaf is None:
            return alive, dropped
        alive.remove(leaf)
        dropped += 1


# ------------------------------------------------------------ per face
def face_line(tag, index, face, chart_of, paves, cut_pieces):
    """face: the pf.Face in the working frame (its loops); chart_of: working
    point -> chart point of this face; paves: this operand's pave sets per edge."""
    old = set()
    for a, b in face.segments():
        e = tuple(sorted((a, b)))
        d = pf.sub(b, a)
        pts = sorted(paves[e], key=lambda p: pf.dot(pf.sub(p, a), d))
        for p, q in zip(pts, pts[1:]):
            old.add(frozenset((chart_of(p), chart_of(q))))
    cut = {frozenset((chart_of(x), chart_of(y))) for x, y in cut_pieces} - old
    alive, slits = prune(old, cut)
    vertices = {p for s in alive for p in s}
    loops = [tuple(sorted(s)) for s in old]
    areas = fragments([tuple(sorted(s)) for s in old | cut], lambda p: even_odd(p, loops))
    return f"split {tag} {index} {len(vertices)} {len(alive)} {slits} {len(areas)} {' '.join(str(a) for a in areas)}"


def split_lines(A, B, pa, pb):
    _, paves, rel = pf.interference(A, B, pa, pb)
    to_b = lambda x: pb.inverse_point(pa.point(x))
    cuts = {("A", i): [] for i in range(len(A.faces))}
    cuts.update({("B", j): [] for j in range(len(B.faces))})
    for (i, j), r in rel.items():
        if r[0] == "transverse":
            pieces, _ = pf.section_parts(A.faces[i], B.faces[j], r, paves)
            cuts["A", i].extend((x, y) for x, y, _, _ in pieces)
            cuts["B", j].extend((x, y) for x, y, _, _ in pieces)
    out = []
    for i, face in enumerate(A.faces):
        out.append(face_line("A", i, face, lambda x, i=i: pf.chart(A.own[i], x), paves["A"], cuts["A", i]))
    for j, face in enumerate(B.faces):
        out.append(face_line("B", j, face, lambda x, j=j: pf.chart(B.own[j], to_b(x)), paves["B"], cuts["B", j]))
    return out


# ------------------------------------------------------------ nested configurations
def about(rows, centre, solid):
    """Apply p -> M (p - c) + c."""
    m = Matrix(rows).applyfunc(R)
    c = pf.v(*centre)
    f = lambda p: pf.add(c, tuple(m * Matrix(pf.sub(p, c))))
    return [[[f(p) for p in loop] for loop in face] for face in solid]


SQUARE = lambda lo, hi: [(lo[0], lo[1]), (hi[0], lo[1]), (hi[0], hi[1]), (lo[0], hi[1])]
PLATE = pf.box((0, 0, 0), (12, 12, 2))
PLATE_HOLE = pf.prism(SQUARE((0, 0), (12, 12)), [SQUARE((5, 5), (7, 7))], 0, 2)
PLATE_WIDE_HOLE = pf.prism(SQUARE((0, 0), (12, 12)), [SQUARE((5, 5), (9, 7))], 0, 2)
TUBE = pf.prism(SQUARE((2, 2), (10, 10)), [SQUARE((4, 4), (8, 8))], -1, 3)
THIRDS_TUBE = pf.prism(
    SQUARE((R(7, 3), R(7, 3)), (R(29, 3), R(29, 3))), [SQUARE((R(13, 3), R(13, 3)), (R(23, 3), R(23, 3)))], -1, 3
)
TWO_HOLE_PLATE = pf.prism(SQUARE((0, 0), (16, 8)), [SQUARE((3, 3), (5, 5)), SQUARE((11, 3), (13, 5))], 0, 2)
TWO_SLEEVES = pf.prism(SQUARE((1, 1), (15, 7)), [SQUARE((2, 2), (6, 6)), SQUARE((10, 2), (14, 6))], -1, 3)
NESTED = [
    ("tube-through-plate", PLATE, TUBE, pf.ID, pf.ID),
    ("tube-around-hole", PLATE_HOLE, TUBE, pf.ID, pf.ID),
    ("tube-around-hole-r1", PLATE_HOLE, TUBE, pf.ID, pf.T1),
    ("tube-around-hole-r2", PLATE_HOLE, TUBE, pf.ID, pf.ROT),
    ("tube-around-hole-r3", PLATE_HOLE, TUBE, pf.ID, pf.SHEAR),
    ("tube-around-hole-mirror", PLATE_HOLE, TUBE, pf.ID, pf.MIRROR),
    ("tube-around-hole-far", PLATE_HOLE, TUBE, pf.BIG, pf.BIG),
    ("thirds-tube-around-hole", PLATE_HOLE, THIRDS_TUBE, pf.ID, pf.ID),
    ("rotated-tube-around-hole", PLATE_HOLE, about(pf.ROT_Z, (6, 6, 0), TUBE), pf.ID, pf.ID),
    ("hole-crossing-tube-wall", PLATE_WIDE_HOLE, TUBE, pf.ID, pf.ID),
    ("sleeves-around-two-holes", TWO_HOLE_PLATE, TWO_SLEEVES, pf.ID, pf.ID),
    ("plate-through-tube", TUBE, PLATE_HOLE, pf.ID, pf.ID),
]


def emit(name, a_working, b_working, pa, pb):
    A, B, lines = pf.operands(a_working, b_working, pa, pb)
    return [f"config {name}"] + lines + sorted(split_lines(A, B, pa, pb)) + ["end"]


def main():
    script = pathlib.Path(__file__).read_bytes()
    base = (pathlib.Path(__file__).parent / "planar_fixtures.py").read_bytes()
    configs = pf.CONFIGS + NESTED
    print("# wonky/bool-split-fixtures/1")
    print("# consumer: rust/wonky-bool/tests/face_split.rs (boolean3d strand G3)")
    print(
        "# how: uv run --no-project --with sympy==1.14.0 python rust/wonky-bool/tests/data/split_fixtures.py"
        " > rust/wonky-bool/tests/data/split-fixtures.txt"
    )
    print(
        f"# script sha256 {hashlib.sha256(script).hexdigest()}; planar_fixtures.py sha256"
        f" {hashlib.sha256(base).hexdigest()}; sympy {sympy.__version__}"
    )
    print(f"# configurations: {len(configs)}")
    for c in configs:
        for line in emit(*c):
            print(line)


if __name__ == "__main__":
    main()
