#!/usr/bin/env python3
"""Independent sympy oracle for the F1a radical-vertex audit (pkg-predicate-audit.fix1, 2026-10-02).

Run from the repository root:
    uv run --no-project --with sympy==1.14.0 python rust/wonky-blend/tests/data/chamfer-audit.py

Writes (generated, do not edit by hand; the seed is fixed):
    rust/wonky-blend/tests/data/chamfer-audit.txt       equal-offset chamfers of random convex prisms
    rust/wonky-blend/tests/data/corner-audit.txt        three-plane corners with radical coefficients

The oracle never runs the Rust code and does not reuse its algorithms:
- arithmetic is sympy's algebraic number field QQ(sqrt r1, ..., sqrt rk)
  (primitive-element representation), not a multiquadratic basis;
- linear systems are solved by sympy's fraction-free LU (DomainMatrix), not Cramer;
- the chamfered solid is the convex polytope "prism intersected with every cut
  halfspace", found by enumerating all plane triples, not by sequential face
  clipping; its volume is a fan sum over the faces of that polytope;
- an unselected edge overflows when the set of its parameters in [0, 1] that
  every cut keeps has no interior, found by testing midpoints between the cut
  crossings, not by an interval update;
- every sign is certified by mpmath interval arithmetic; zero is exact field zero.

Definitions taken from Onshape semantics (std opChamfer EQUAL_OFFSETS, F1a):
the spring line on a support lies at distance `width` from the selected edge,
measured inside that support perpendicular to the edge; the cut plane holds
both spring lines; a vertex where three selected edges meet is cut by the plane
through the three points where each support meets its two incident cuts.
"""

import random
from fractions import Fraction as F
from functools import cmp_to_key
from itertools import combinations
from math import isqrt
from pathlib import Path

import mpmath
import sympy as sp
from sympy.polys.matrices import DomainMatrix

HERE = Path(__file__).resolve().parent
# sympy builds QQ(sqrt r1, ..., sqrt rk) through a primitive element of degree
# 2^k; above three square classes that construction takes minutes per case.
# Selections whose spring lengths span more classes are drawn but not emitted;
# the summary line counts them.
MAX_CLASSES = 3
rng = random.Random(20261002)


def fmt(q):
    q = F(q)
    return f"{q.numerator}/{q.denominator}"


def rat(x):
    x = sp.Rational(x)
    return F(int(x.p), int(x.q))


def square_free_class(r):
    """Square class representative: positive rational r = s^2 * k, k a square-free integer."""
    k = sp.sqrt(sp.Rational(r.numerator, r.denominator))
    c, rest = k.as_coeff_Mul()
    return None if rest == 1 else rest**2


class Field:
    def __init__(self, radicands):
        classes = sorted({c for c in map(square_free_class, radicands) if c is not None})
        self.K = sp.QQ.algebraic_field(*[sp.sqrt(c) for c in classes]) if classes else sp.QQ.algebraic_field(sp.Integer(1))
        self.zero = self.K.zero

    def sqrt(self, m):
        """sqrt(m) = c sqrt(k), k square-free; c is taken exactly so that
        from_sympy never sees a 2^-2148 radicand (its numeric checks give nan)."""
        k = square_free_class(m) or sp.Integer(1)
        c2 = m / F(int(k))
        c = F(isqrt(c2.numerator), isqrt(c2.denominator))
        assert c * c == c2
        return self.K.from_sympy(sp.Rational(c.numerator, c.denominator)) * self.K.from_sympy(sp.sqrt(k))

    def terms(self, a):
        out = []
        for t in sp.Add.make_args(sp.expand(self.K.to_sympy(a))):
            c, rest = t.as_coeff_Mul()
            if rest == 1:
                out.append((F(1), rat(c)))
            else:
                assert isinstance(rest, sp.Pow) and rest.exp == sp.Rational(1, 2) and rest.base.is_Integer, t
                out.append((rat(rest.base), rat(c)))
        return [x for x in out if x[1] != 0]

    def text(self, a):
        ts = self.terms(a)
        return " ".join([str(len(ts))] + [f"{fmt(r)} {fmt(c)}" for r, c in ts])

    def sign(self, a):
        if a == self.zero:
            return 0
        ts = self.terms(a)
        for prec in (128, 1024, 8192, 65536):
            mpmath.iv.prec = prec
            s = mpmath.iv.mpf(0)
            for r, c in ts:
                s += (mpmath.iv.mpf(c.numerator) / c.denominator) * mpmath.iv.sqrt(
                    mpmath.iv.mpf(r.numerator) / r.denominator
                )
            if s.a > 0:
                return 1
            if s.b < 0:
                return -1
        raise AssertionError("sign not certified")


def vsub(a, b):
    return [x - y for x, y in zip(a, b)]


def vdot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vcross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def solve3(K, planes):
    """planes: [(normal, offset)] over K; None when singular."""
    M = DomainMatrix([[x for x in n] for n, _ in planes], (3, 3), K)
    if M.det() == K.zero:
        return None
    b = DomainMatrix([[d] for _, d in planes], (3, 1), K)
    x = M.lu_solve(b)
    return [x[i, 0].element for i in range(3)]


# --------------------------------------------------------------------- prisms

def prism_planes(poly, H, s):
    """Faces as (name, outward normal, offset) over Q. Polygon is counter-clockwise."""
    faces = [("bottom", [0, 0, -1], F(0)), ("top", [-s, F(0), F(1)], H)]
    n = len(poly)
    for i in range(n):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
        nrm = [y1 - y0, x0 - x1, F(0)]
        faces.append((f"side{i}", nrm, nrm[0] * x0 + nrm[1] * y0))
    return faces


def prism_edges(poly, H, s):
    """name -> (p, q, support names)."""
    n = len(poly)
    lo = [[x, y, F(0)] for x, y in poly]
    hi = [[x, y, H + s * x] for x, y in poly]
    edges = {}
    for i in range(n):
        j = (i + 1) % n
        edges[f"b{i}"] = (lo[i], lo[j], ("bottom", f"side{i}"))
        edges[f"t{i}"] = (hi[i], hi[j], ("top", f"side{i}"))
        edges[f"v{i}"] = (lo[i], hi[i], (f"side{(i - 1) % n}", f"side{i}"))
    return edges


def corner_of(name, n):
    kind, i = name[0], int(name[1:])
    if kind == "b":
        return [f"b{(i - 1) % n}", f"b{i}", f"v{i}"]
    return [f"t{(i - 1) % n}", f"t{i}", f"v{i}"]


def chamfer(poly, H, s, width, selected):
    planes = prism_planes(poly, H, s)
    by_name = {name: (nrm, d) for name, nrm, d in planes}
    edges = prism_edges(poly, H, s)
    springs = {}
    radicands = []
    for e in selected:
        p, q, sup = edges[e]
        d = vsub(q, p)
        for a, b in (sup, sup[::-1]):
            u = vcross(by_name[a][0], d)
            if vdot(u, by_name[b][0]) > 0:
                u = [-x for x in u]
            radicands.append(vdot(u, u))
            springs[(e, a)] = u
    if len({c for c in map(square_free_class, radicands) if c is not None}) > MAX_CLASSES:
        return "skip", None
    field = Field(radicands)
    K = field.K
    Kq = lambda x: K.from_sympy(sp.Rational(x.numerator, x.denominator))

    def lift(v):
        return [Kq(F(x)) for x in v]

    cuts = {}
    for e in selected:
        p, q, sup = edges[e]
        pts = []
        for a in sup:
            u = springs[(e, a)]
            inv = K.one / field.sqrt(vdot(u, u))
            pts.append([Kq(F(p[k])) + Kq(width * u[k]) * inv for k in range(3)])
        nrm = vcross(lift(vsub(q, p)), vsub(pts[1], pts[0]))
        off = vdot(nrm, pts[0])
        if field.sign(vdot(nrm, lift(p)) - off) < 0:
            nrm, off = [-x for x in nrm], -off
        cuts[e] = (nrm, off)
    corners = []
    n = len(poly)
    for i in range(n):
        for kind in "bt":
            group = corner_of(f"{kind}{i}", n)
            if all(g in selected for g in group):
                faces = sorted({f for g in group for f in edges[g][2]})
                assert len(faces) == 3
                pts = []
                for f in faces:
                    inc = [g for g in group if f in edges[g][2]]
                    nf, df = by_name[f]
                    x = solve3(K, [(lift(nf), Kq(df)), cuts[inc[0]], cuts[inc[1]]])
                    assert x is not None
                    pts.append(x)
                vtx = edges[f"v{i}"][0 if kind == "b" else 1]
                nrm = vcross(vsub(pts[1], pts[0]), vsub(pts[2], pts[0]))
                off = vdot(nrm, pts[0])
                if field.sign(vdot(nrm, lift(vtx)) - off) < 0:
                    nrm, off = [-x for x in nrm], -off
                corners.append((nrm, off))
    halfspaces = [(lift(nrm), Kq(d)) for _, nrm, d in planes] + list(cuts.values()) + corners

    def side(h, x):
        return vdot(h[0], x) - h[1]

    # Overflow: every unselected source edge must keep a parameter interval with interior.
    for name, (p, q, _) in edges.items():
        if name in selected:
            continue
        P, D = lift(p), lift(vsub(q, p))
        ts = [K.zero, K.one]
        for h in list(cuts.values()) + corners:
            slope = vdot(h[0], D)
            if slope != K.zero:
                t = -side(h, P) / slope
                if field.sign(t) > 0 and field.sign(t - K.one) < 0:
                    ts.append(t)
        ts.sort(key=cmp_to_key(lambda a, b: field.sign(a - b)))
        ok = False
        for a, b in zip(ts, ts[1:]):
            if a == b:
                continue
            mid = (a + b) / K.from_sympy(sp.Integer(2))
            x = [P[k] + mid * D[k] for k in range(3)]
            if all(field.sign(side(h, x)) <= 0 for h in list(cuts.values()) + corners):
                ok = True
                break
        if not ok:
            return "overflow", None
    verts = []
    for tri in combinations(halfspaces, 3):
        x = solve3(K, list(tri))
        if x is None:
            continue
        if any(x == y for y in verts):
            continue
        if all(field.sign(side(h, x)) <= 0 for h in halfspaces):
            verts.append(x)
    # Volume (times six) by fans over every face of the polytope.
    vol6 = K.zero
    face_count = 0
    for h in halfspaces:
        on = [x for x in verts if side(h, x) == K.zero]
        if len(on) < 3:
            continue
        face_count += 1
        # Convex face: every other vertex lies within a half-turn seen from
        # on[0], so the certified sign of n . ((a - v0) x (b - v0)) orders it
        # counter-clockwise about the outward normal.
        v0 = on[0]
        on = [v0] + sorted(
            on[1:], key=cmp_to_key(lambda a, b: -field.sign(vdot(h[0], vcross(vsub(a, v0), vsub(b, v0)))))
        )
        for a, b in zip(on[1:], on[2:]):
            vol6 += vdot(on[0], vcross(a, b))
    return "ok", (field, verts, vol6, face_count)


# ------------------------------------------------------------- case generation

PYTHAGOREAN = [
    [(0, 0), (8, 0), (0, 6)],
    [(0, 0), (4, -3), (8, 0), (4, 3)],
    [(0, 0), (12, 0), (12, 5), (0, 5)],
    [(0, 0), (15, 0), (15, 20)],
]


def convex_polygon():
    while True:
        k = rng.randint(3, 6)
        pts = {(rng.randint(-12, 12), rng.randint(-12, 12)) for _ in range(k + 3)}
        hull = sp.convex_hull(*[sp.Point(*p) for p in pts])
        if isinstance(hull, sp.Polygon) and 3 <= len(hull.vertices) <= 6:
            vs = [(F(int(v.x)), F(int(v.y))) for v in hull.vertices]
            if sp.Polygon(*hull.vertices).area < 0:
                vs.reverse()
            return vs


def ccw(poly):
    a = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    return poly if a > 0 else poly[::-1]


def selection(n):
    mode = rng.random()
    if mode < 0.45:
        return [rng.choice(["b", "t", "v"]) + str(rng.randrange(n))]
    if mode < 0.65:
        i = rng.randrange(n)
        kind = rng.choice("bt")
        return rng.sample(corner_of(f"{kind}{i}", n), 2)
    if mode < 0.85:
        return corner_of(rng.choice("bt") + str(rng.randrange(n)), n)
    return sorted({rng.choice(["b", "t", "v"]) + str(rng.randrange(n)) for _ in range(rng.randint(2, 3))})


def cases():
    out = []
    for _ in range(170):
        scale = F(1, rng.choice([1, 2, 3]))
        poly = ccw([(x * scale, y * scale) for x, y in convex_polygon()])
        s = F(rng.choice([0, 0, 1, -1, 3]), rng.choice([1, 2, 4, 7]))
        H = max(abs(s * x) for x, _ in poly) + rng.randint(8, 30)
        w = F(rng.randint(1, 40), rng.choice([8, 16, 20, 30, 4]))
        out.append(("random", poly, H, s, w, selection(len(poly))))
    # Ties: the cut passes exactly through an unselected vertex; near ties
    # differ by 2^-60 or by one binary64 ulp of the tie value.
    for poly in PYTHAGOREAN:
        poly = [(F(x), F(y)) for x, y in ccw(poly)]
        n = len(poly)
        for i in range(n):
            (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
            length = sp.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2)
            assert length.is_Rational
            L = rat(length)
            for w in (L, L - F(1, 2**60), L + F(1, 2**60), L * (1 - F(1, 2**53)), L * (1 + F(1, 2**52))):
                out.append(("tie", poly, F(20), F(0), w, [f"v{i}"]))
        for w in (F(20), F(20) - F(1, 2**60), F(20) + F(1, 2**60)):
            out.append(("tie", poly, F(20), F(0), w, ["b0"]))
    # Nearly flat dihedrals: a vertex one ulp off a straight edge.
    for eps in (F(1, 2**52), F(1, 2**30)):
        poly = ccw([(F(0), F(0)), (F(1), -eps), (F(2), F(0)), (F(1), F(1))])
        for sel in (["v1"], ["b0"], ["b1"], ["b0", "b1", "v1"]):
            out.append(("flat", poly, F(1), F(0), F(1, 4), sel))
    # Binary64 range: the same prism scaled from 2^-1074 to 2^1023.
    base = [(F(0), F(0)), (F(3), F(0)), (F(2), F(2)), (F(0), F(1))]
    for k in (-1074, -1022, -500, -300, -60, 60, 300, 500, 1023):
        sc = F(2) ** k
        poly = ccw([(x * sc, y * sc) for x, y in base])
        for sel in (["v1"], ["t1"], corner_of("b2", 4)):
            out.append((f"scale{k}", poly, F(5) * sc, F(1, 3), F(1, 4) * sc, sel))
    return out


def main():
    lines = []
    stats = {"ok": 0, "overflow": 0, "vertices": 0, "radical_vertices": 0, "corners": 0, "skipped": 0}
    for tag, poly, H, s, w, sel in cases():
        n = len(poly)
        sel = sorted(set(sel))
        result, data = chamfer(poly, H, s, w, sel)
        if result == "skip":
            stats["skipped"] += 1
            continue
        head = (
            f"case {tag} {fmt(H)} {fmt(s)} {fmt(w)} {n} "
            + " ".join(f"{fmt(x)} {fmt(y)}" for x, y in poly)
            + f" {len(sel)} "
            + " ".join(sel)
        )
        stats["corners"] += sum(all(g in sel for g in corner_of(f"{k}{i}", n)) for i in range(n) for k in "bt")
        if result == "overflow":
            lines.append(head + " | overflow")
            stats["overflow"] += 1
            continue
        field, verts, vol6, faces = data
        stats["ok"] += 1
        stats["vertices"] += len(verts)
        stats["radical_vertices"] += sum(any(r != 1 for c in v for r, _ in field.terms(c)) for v in verts)
        lines.append(
            head
            + f" | ok {faces} {field.text(vol6)} {len(verts)} "
            + " ".join(field.text(c) for v in verts for c in v)
        )
    summary = (
        f"{stats['ok'] + stats['overflow']} chamfer cases: {stats['ok']} exact solids "
        f"({stats['vertices']} vertices, {stats['radical_vertices']} irrational, {stats['corners']} three-edge corners), "
        f"{stats['overflow']} overflows; {stats['skipped']} draws above {MAX_CLASSES} square classes not emitted"
    )
    write(HERE / "chamfer-audit.txt", lines, summary)
    corner_lines, corner_summary = corner_corpus()
    write(HERE / "corner-audit.txt", corner_lines, corner_summary)


def write(path, lines, summary):
    path.parent.mkdir(parents=True, exist_ok=True)
    head = [
        "# Generated by rust/wonky-blend/tests/data/chamfer-audit.py (sympy "
        + sp.__version__
        + ", seed 20261002); do not edit.",
        "# " + summary,
    ]
    path.write_text("\n".join(head + lines) + "\n")
    print(f"{path.relative_to(HERE.parents[3])}: {summary}")


# ------------------------------------------------------- three-plane corners

def radical_coefficient(classes):
    r = rng.choice(classes)
    c = F(rng.randint(-9, 9), rng.choice([1, 2, 3, 2**60]))
    return [(F(1), F(rng.randint(-9, 9), rng.choice([1, 4, 7])))] + ([(r, c)] if c else [])


def corner_corpus():
    lines = []
    n_point = n_singular = 0
    for i in range(160):
        classes = rng.sample([F(2), F(3), F(5), F(6), F(10), F(13), F(2**61 - 1)], 2)
        field = Field(classes)
        K = field.K

        def element(ts):
            return sum((K.from_sympy(sp.Rational(c.numerator, c.denominator) * sp.sqrt(sp.Rational(r.numerator, r.denominator))) for r, c in ts), K.zero)

        planes = [([element(radical_coefficient(classes)) for _ in range(3)], element(radical_coefficient(classes))) for _ in range(3)]
        mode = i % 4
        if mode == 1:
            # Exactly dependent normals with irrational weights.
            a, b = element(radical_coefficient(classes)), element(radical_coefficient(classes))
            planes[2] = ([a * x + b * y for x, y in zip(planes[0][0], planes[1][0])], planes[2][1])
        elif mode == 2:
            # Nearly dependent: perturb a dependent normal by 2^-80.
            a = element(radical_coefficient(classes))
            planes[2] = ([a * x for x in planes[0][0]], planes[2][1])
            planes[2][0][rng.randrange(3)] += K.from_sympy(sp.Rational(1, 2**80))
        x = solve3(K, planes)
        text = " ".join(" ".join(field.text(c) for c in n) + " " + field.text(d) for n, d in planes)
        if x is None:
            lines.append(f"corner {text} | singular")
            n_singular += 1
        else:
            for n, d in planes:
                assert vdot(n, x) - d == K.zero
            lines.append(f"corner {text} | " + " ".join(field.text(c) for c in x))
            n_point += 1
    return lines, f"{n_point} corners, {n_singular} singular"


if __name__ == "__main__":
    main()
