# /// script
# requires-python = ">=3.11"
# dependencies = ["sympy==1.13.3", "mpmath==1.3.0"]
# ///
"""Closed-form checker for the CAD acid test catalog (fixtures/cad-acid/zones.json).

Recomputes every closed form of every zone from its construction.params by a
route other than the catalog's hand-written expression, and compares:

  exact     sympy exact arithmetic (prism and revolve profiles by Green's
            theorem, axis-aligned box Booleans by coordinate compression with
            Fractions); must agree with the catalog value to 1e-25 relative
  quad      mpmath quadrature at 50 digits (Steinmetz, T-junction, fillet
            cross-sections, helix length); 1e-20 relative
  e9        box Booleans on the binary64 SI payload the FeatureScript
            interpreter produces (`L * millimeter`); compared at 1e-12
            relative; E9 symbols (gaps, overlaps) compared exactly
  numeric   distances to convex pieces by Dykstra projection or 1-D search in
            floats; 1e-9 mm

Spline profiles (splines-a) add two routes:
  bezier-green  Bezier profile pieces (explicit control points) integrated by
            Green's theorem in sympy exact arithmetic; the arc length is exact
            when the hodograph is Pythagorean (|C'| a polynomial), otherwise
            mpmath Gauss-Legendre quadrature (quad)
  payload   controls the FeatureScript computes with cos/sin/tan/atan/sqrt,
            replicated in Python IEEE binary64 in the FS operation order and
            taken as exact dyadics (`x * millimeter`, as AC96's corners); the
            exact Green area of that payload (three-point arcs through the
            payload points, angles in mpmath) must agree with the nominal
            closed form to 1e-12

Binding to the construction (a changed parameter must change a recomputed
value or fail):
  - every top-level key of construction.params is consumed by a route or
    matched by an explicit literal guard; an unbound key is a failure;
  - probe points, body points, edge points and axes are read from the
    measurement definitions, never re-typed here;
  - construction premises a route relies on (tangency, clearance, through
    holes, disjoint instances) are checked from the parameters.

Bounding boxes V0..V3 have two routes where possible:
  A  support elements: boundary pieces of the result (points, arcs, sphere
     zones, tori, helix tube) built from the parameters;
  B  construction solid: the result as primitives built from the parameters
     by the same description the volume route integrates: exact cells of
     axis-aligned box Booleans, prisms and revolves of the profile loops,
     vertex sets of polyhedra.
Zones without route B (AC07 helix tube, AC19 Steinmetz solid, AC32 chain
fillet, AC34 vertex blend) are reported as single-route; the independent part
there is containment in the rotated local box.

It also checks the expression strings (sympy value == stored value), the
Euler-Poincare invariant of every declared topology, every E9 relation with
IEEE floats, the declared local bbox, the scored topology fields and the
catalog structure.

    uv run scripts/acid/closed-forms.py [--zones fixtures/cad-acid/zones.json] [--only AC07,AC20] [--verbose]

Exit status 1 if any check fails. Test tooling only: nothing here builds
kernel geometry.
"""
import argparse
import hashlib
import json
import math
import re
import sys
from fractions import Fraction
from pathlib import Path

import mpmath as mp
import sympy as sp

mp.mp.dps = 50
ROOT = Path(__file__).resolve().parents[2]
ZONES = ROOT / "fixtures/cad-acid/zones.json"
HALF_PI = sp.pi / 2

# ------------------------------------------------------------------ variants
V2M = [[0, -1, 0], [0, 0, -1], [1, 0, 0]]
V1T = [mp.mpf("65536.25"), mp.mpf("-32768.5"), mp.mpf("16384.125")]


def v3_frame():
    n = mp.sqrt(14)
    k = [mp.mpf(1) / n, mp.mpf(2) / n, mp.mpf(3) / n]
    th = mp.mpf("0.1")
    c, s = mp.cos(th), mp.sin(th)
    K = [[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]]
    R = [[c * (1 if i == j else 0) + s * K[i][j] + (1 - c) * k[i] * k[j] for j in range(3)] for i in range(3)]
    P = [mp.mpf(3), mp.mpf(-2), mp.mpf(5)]
    t = [P[i] - sum(R[i][j] * P[j] for j in range(3)) for i in range(3)]
    return R, t


I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
VARIANTS = {"V0": (I3, [0, 0, 0]), "V1": (I3, V1T), "V2": (V2M, [0, 0, 0]), "V3": v3_frame()}
# V4 (parameters) and V5 (idiom) carry no frame: both use V0's (catalog baseFrame).
ALL_VARIANTS = ("V0", "V1", "V2", "V3", "V4", "V5")
BASE_FRAME = {"V4": "V0", "V5": "V0"}
RADIUS_KEYS = {"radius", "r", "R"}


def zone_variants(z):
    """Declared variants of a zone; the 48 base zones omit the field and mean V0-V3."""
    return z.get("variants") or ["V0", "V1", "V2", "V3"]


def frame(v):
    return VARIANTS[BASE_FRAME.get(v, v)]


# ------------------------------------------------------------------ number helpers
def num(x):
    """Any exact or float value -> mpf."""
    if isinstance(x, mp.mpf):
        return x
    if isinstance(x, Fraction):
        return mp.mpf(x.numerator) / x.denominator
    if isinstance(x, sp.Basic):
        return mp.mpf(str(sp.N(x, 45)))
    if isinstance(x, str):
        return num(nominal(x))
    return mp.mpf(x)


def nominal(v):
    """Decimal value of a parameter as written (int, float or an expression string like '8 + 0.0009765625')."""
    if isinstance(v, Fraction):
        return v
    if isinstance(v, int):
        return Fraction(v)
    if isinstance(v, float):
        return Fraction(str(v))
    r = sp.Rational(sp.sympify(v, rational=True))
    return Fraction(int(r.p), int(r.q))


def R_(v):
    f = nominal(v)
    return sp.Rational(f.numerator, f.denominator)


def e9mm(v):
    """binary64 SI payload of `v * millimeter` as the FS interpreter computes it, back in exact mm."""
    f = float(eval(str(v), {"__builtins__": {}}, {}))
    return Fraction(f * 0.001) * 1000


def mpv(v):
    return [num(x) for x in v]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def unit(v):
    n = mp.sqrt(dot(v, v))
    return [x / n for x in v]


# ------------------------------------------------------------------ route A: support elements (local coordinates)
def PT(p):
    return ("pt", mpv(p))


def ARC(c, P, Q, t0, t1):
    return ("arc", mpv(c), mpv(P), mpv(Q), num(t0), num(t1))


def CIRCLE(c, n, r):
    n = unit(mpv(n))
    a = [1, 0, 0] if abs(n[0]) < mp.mpf("0.9") else [0, 1, 0]
    u = unit(cross(n, mpv(a)))
    v = cross(n, u)
    r = num(r)
    return ARC(c, [r * x for x in u], [r * x for x in v], 0, 2 * mp.pi)


def box_pts(lo, hi):
    return [PT([x, y, z]) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]


def arc_support(a, b, t0, t1):
    """max of a cos t + b sin t for t in [t0, t1]."""
    best = max(a * mp.cos(t0) + b * mp.sin(t0), a * mp.cos(t1) + b * mp.sin(t1))
    ts = mp.atan2(b, a)
    for k in range(-3, 4):
        tt = ts + 2 * mp.pi * k
        if t0 <= tt <= t1:
            best = max(best, mp.sqrt(a * a + b * b))
    return best


def maximize_1d(f, t0, t1, n=4001):
    t0f, t1f = float(t0), float(t1)
    grid = [t0f + (t1f - t0f) * i / (n - 1) for i in range(n)]
    vals = [f(mp.mpf(t)) for t in grid]
    i = max(range(n), key=lambda j: vals[j])
    lo, hi = mp.mpf(grid[max(i - 1, 0)]), mp.mpf(grid[min(i + 1, n - 1)])
    g = (mp.sqrt(5) - 1) / 2
    a, b = lo, hi
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = f(c), f(d)
    for _ in range(160):
        if fc > fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = f(d)
    return max(fc, fd, vals[i]), (a + b) / 2


def support(el, d):
    kind = el[0]
    if kind == "pt":
        return dot(d, el[1])
    if kind == "arc":
        _, c, P, Q, t0, t1 = el
        return dot(d, c) + arc_support(dot(d, P), dot(d, Q), t0, t1)
    if kind == "sphzone":  # c, r, n, lo, hi : points c + r u with lo <= u.n <= hi
        _, c, r, n, lo, hi = el
        dn = dot(d, n)
        if lo <= dn <= hi:
            return dot(d, c) + r
        best = None
        for h in (lo, hi):
            cc = [c[i] + r * h * n[i] for i in range(3)]
            rad = r * mp.sqrt(max(mp.mpf(0), 1 - h * h))
            val = dot(d, cc) + rad * mp.sqrt(max(mp.mpf(0), 1 - dn * dn))
            best = val if best is None else max(best, val)
        return best
    if kind == "octsph":  # c, r, signs: interior critical point only (boundary arcs listed separately)
        _, c, r, signs = el
        if all(d[i] * signs[i] >= 0 for i in range(3)):
            return dot(d, c) + r
        return None
    if kind == "torus":
        _, c, n, R, r = el
        dn = dot(d, n)
        return dot(d, c) + R * mp.sqrt(max(mp.mpf(0), 1 - dn * dn)) + r
    if kind == "toruspatch":
        _, c, n, u0, R, r, th0, th1, ph0, ph1 = el
        v0 = cross(n, u0)
        dn = dot(d, n)

        def f(th):
            rho = [mp.cos(th) * u0[i] + mp.sin(th) * v0[i] for i in range(3)]
            dr = dot(d, rho)
            return dot(d, c) + R * dr + r * arc_support(dr, dn, ph0, ph1)
        return maximize_1d(f, th0, th1, n=2001)[0]
    if kind == "bez":  # a 3-D Bezier curve by its control points; golden-section search, not the derivative roots of route B
        _, ctrl = el
        n = len(ctrl) - 1
        w = [dot(d, p) for p in ctrl]
        # Constant for this curve and precision. Keep the evaluation order and
        # full search unchanged; recomputing these at every sample dominated
        # the independent bounding-box verifier.
        coefficients = [mp.binomial(n, i) for i in range(n + 1)]
        return maximize_1d(lambda t: sum(coefficients[i] * t ** i * (1 - t) ** (n - i) * w[i] for i in range(n + 1)), 0, 1)[0]
    if kind == "helixtube":
        _, R, pitch, turns, r = el
        cz = pitch / (2 * mp.pi)
        nrm = mp.sqrt(R * R + cz * cz)

        def f(t):
            h = [R * mp.cos(t), R * mp.sin(t), cz * t]
            T = [-R * mp.sin(t) / nrm, R * mp.cos(t) / nrm, cz / nrm]
            dt = dot(d, T)
            return dot(d, h) + r * mp.sqrt(max(mp.mpf(0), 1 - dt * dt))
        return maximize_1d(f, 0, 2 * mp.pi * turns, n=8001)[0]
    raise ValueError(kind)


def bbox_of(elements, M=I3, t=(0, 0, 0)):
    lo, hi = [], []
    for i in range(3):
        d = [mp.mpf(M[i][j]) for j in range(3)]
        nd = [-x for x in d]
        smax = max(s for s in (support(e, d) for e in elements) if s is not None)
        smin = max(s for s in (support(e, nd) for e in elements) if s is not None)
        hi.append(mp.mpf(t[i]) + smax)
        lo.append(mp.mpf(t[i]) - smin)
    return lo, hi


# ------------------------------------------------------------------ route B: construction solids
def seg_support2(seg, a, b):
    """max of a*u + b*v over one profile segment (line or arc) in the (u, v) plane."""
    if seg[0] == "L":
        (u0, v0), (u1, v1) = seg[1], seg[2]
        return max(a * num(u0) + b * num(v0), a * num(u1) + b * num(v1))
    if seg[0] == "B":  # exact candidates: the ends and the real roots of the derivative in [0,1]
        cx, cy = bez_mp(seg)
        f = [a * cx[k] + b * cy[k] for k in range(len(cx))]
        return max(mp_poly(f, t) for t in [mp.mpf(0), mp.mpf(1)] + mp_real_roots01([k * f[k] for k in range(1, len(f))]))
    (cu, cv), r, t0, t1 = seg[1], seg[2], seg[3], seg[4]
    t0, t1 = sorted([num(t0), num(t1)])
    r = num(r)
    return a * num(cu) + b * num(cv) + arc_support(a * r, b * r, t0, t1)


def piece_support(pc, d):
    kind = pc[0]
    if kind == "pts":
        return max(dot(d, p) for p in pc[1])
    if kind == "prism":  # loops in (u, v), extrusion w in [w0, w1]; local[perm[k]] = (u, v, w)[k]
        _, loops, w0, w1, perm = pc
        du, dv, dw = d[perm[0]], d[perm[1]], d[perm[2]]
        return max(seg_support2(s, du, dv) for lp in loops for s in lp) + max(dw * num(w0), dw * num(w1))
    if kind == "revolve":  # loops in (rho, a), revolved by theta about the local axis ('z': phi from +x to +y; 'x': from +y to +z)
        _, loops, theta, axis = pc
        dp, da = ((d[0], d[1]), d[2]) if axis == "z" else ((d[1], d[2]), d[0])
        s = arc_support(dp[0], dp[1], mp.mpf(0), num(theta))
        return max(seg_support2(sg, s, da) for lp in loops for sg in lp)
    raise ValueError(kind)


def bbox_B(solid, M=I3, t=(0, 0, 0)):
    lo, hi = [], []
    for i in range(3):
        d = [mp.mpf(M[i][j]) for j in range(3)]
        nd = [-x for x in d]
        hi.append(mp.mpf(t[i]) + max(piece_support(pc, d) for pc in solid))
        lo.append(mp.mpf(t[i]) - max(piece_support(pc, nd) for pc in solid))
    return lo, hi


def cells_piece(cells):
    return ("pts", [mpv([x, y, z]) for lo, hi in cells for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])


# ------------------------------------------------------------------ exact routes (profiles)
def L(p0, p1):
    return ("L", [sp.sympify(v) for v in p0], [sp.sympify(v) for v in p1])


def A(c, r, t0, t1):
    return ("A", [sp.sympify(v) for v in c], sp.sympify(r), sp.sympify(t0), sp.sympify(t1))


def BZ(ctrl):
    """A Bezier profile piece by its control points (degree = len - 1), from the first to the last point."""
    return ("B", [[sp.sympify(v) for v in p] for p in ctrl])


TT = sp.Symbol("t")


def bez_xy(seg):
    """Coordinate polynomials x(t), y(t) of a Bezier piece (sympy, exact for exact controls)."""
    ctrl, n = seg[1], len(seg[1]) - 1
    b = [sp.binomial(n, i) * TT ** i * (1 - TT) ** (n - i) for i in range(n + 1)]
    return [sp.expand(sum(b[i] * ctrl[i][d] for i in range(n + 1))) for d in (0, 1)]


def poly_sqrt(p):
    """q with q**2 == p (sympy Poly in TT over Q), or None: the Pythagorean-hodograph test."""
    p = sp.Poly(p, TT)
    if p.degree() % 2 or p.is_zero:
        return None
    lc = p.LC()
    root = sp.sqrt(lc)
    if not root.is_Rational:
        return None
    n = p.degree() // 2
    q = sp.Poly(root * TT ** n, TT)
    for k in range(n - 1, -1, -1):
        rem = p - q ** 2
        coeff = rem.coeff_monomial(TT ** (n + k))
        q = q + sp.Poly(coeff / (2 * root) * TT ** k, TT)
    return q if (q ** 2 - p).is_zero else None


def poly_int01(expr):
    """int_0^1 of a polynomial in TT by its antiderivative (exact for exact coefficients; sympy integrate is slow on Floats)."""
    antiderivative = sp.Poly(sp.expand(expr), TT).integrate()
    return antiderivative.eval(1) - antiderivative.eval(0)


def bez_length(seg):
    """(length, exact?) of a Bezier piece: exact for a Pythagorean hodograph without zeros in [0,1], else Gauss-Legendre quadrature."""
    x, y = bez_xy(seg)
    speed2 = sp.expand(sp.diff(x, TT) ** 2 + sp.diff(y, TT) ** 2)
    if all(v.is_Rational for p in seg[1] for v in p):
        q = poly_sqrt(speed2)
        if q is not None and not [r for r in q.real_roots() if 0 <= r <= 1]:
            return sp.Abs(poly_int01(q.as_expr())), True
    f = sp.lambdify(TT, sp.sqrt(speed2), "mpmath")
    return sp.Float(str(mp.quad(f, mp.linspace(0, 1, 9), method="gauss-legendre")), 50), False


_BEZ_MP = {}


def bez_mp(seg):
    """Power-basis coefficients (ascending, mpf) of x(t) and y(t) of a Bezier piece (cached per piece object)."""
    hit = _BEZ_MP.get(id(seg))
    if hit is None or hit[0] is not seg:
        n = len(seg[1])
        coeffs = [[num(c) for c in reversed(sp.Poly(p, TT).all_coeffs())] for p in bez_xy(seg)]
        hit = _BEZ_MP[id(seg)] = (seg, [c + [mp.mpf(0)] * (n - len(c)) for c in coeffs])
    return hit[1]


def mp_poly(c, t):
    return sum(c[k] * t ** k for k in range(len(c)))


def mp_real_roots01(c):
    """Real roots in [0,1] of the polynomial with ascending mpf coefficients c."""
    c = list(c)
    while c and abs(c[-1]) < mp.mpf("1e-40"):
        c.pop()
    if len(c) < 2:
        return []
    return [mp.re(r) for r in mp.polyroots(list(reversed(c)), maxsteps=400, extraprec=400) if abs(mp.im(r)) < mp.mpf("1e-25") and 0 <= mp.re(r) <= 1]


def loop_area_perimeter(loop):
    area, per = 0, 0
    for seg in loop:
        if seg[0] == "L":
            (x0, y0), (x1, y1) = seg[1], seg[2]
            area += (x0 * y1 - x1 * y0) / 2
            per += sp.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2)
        elif seg[0] == "B":
            x, y = bez_xy(seg)
            area += poly_int01(x * sp.diff(y, TT) - y * sp.diff(x, TT)) / 2
            per += bez_length(seg)[0]
        else:
            (cx, cy), r, t0, t1 = seg[1], seg[2], seg[3], seg[4]
            area += (r ** 2 * (t1 - t0) + cx * r * (sp.sin(t1) - sp.sin(t0)) - cy * r * (sp.cos(t1) - sp.cos(t0))) / 2
            per += r * sp.Abs(t1 - t0)
    return area, per


def prism(loops, h):
    measured = [loop_area_perimeter(lp) for lp in loops]
    area = sum(a for a, _ in measured)
    per = sum(p for _, p in measured)
    h = sp.sympify(h)
    return sp.simplify(area * h), sp.simplify(2 * area + per * h), area


def revolve(loops, theta):
    """Profile loops in the (rho, a) half plane, CCW; returns (V, A_surface)."""
    t = sp.Symbol("t")
    vol, surf, area = 0, 0, 0
    for loop in loops:
        a, _ = loop_area_perimeter(loop)
        area += a
        for seg in loop:
            if seg[0] == "L":
                (r0, z0), (r1, z1) = seg[1], seg[2]
                vol += (z1 - z0) / 2 * (r0 ** 2 + r0 * r1 + r1 ** 2) / 3
                if not (r0 == 0 and r1 == 0):
                    surf += sp.sqrt((r1 - r0) ** 2 + (z1 - z0) ** 2) * (r0 + r1) / 2
            else:
                (cr, cz), r, t0, t1 = seg[1], seg[2], seg[3], seg[4]
                rho = cr + r * sp.cos(t)
                vol += sp.integrate(rho ** 2 / 2 * r * sp.cos(t), (t, t0, t1))
                surf += sp.integrate(rho * r, (t, t0, t1)) * sp.sign(t1 - t0)
    theta = sp.sympify(theta)
    V = sp.simplify(theta * vol)
    Asurf = theta * surf + (2 * area if theta != 2 * sp.pi else 0)
    return V, sp.simplify(Asurf)


def rect_loop(x0, y0, x1, y1, cw=False):
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    if cw:
        pts = pts[::-1]
    return [L(pts[i], pts[(i + 1) % 4]) for i in range(4)]


def poly_loop(pts):
    return [L(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]


def circle_loop(cx, cy, r, cw=False):
    return [A((cx, cy), r, 2 * sp.pi, 0)] if cw else [A((cx, cy), r, 0, 2 * sp.pi)]


# ------------------------------------------------------------------ box Booleans (coordinate compression)
def box_boolean(boxes, op, conv):
    names = list(boxes)
    B = {k: ([conv(x) for x in boxes[k][0]], [conv(x) for x in boxes[k][1]]) for k in names}
    axes = [sorted({b[s][i] for b in B.values() for s in (0, 1)}) for i in range(3)]

    def inside(p):
        ins = [all(B[k][0][i] <= p[i] <= B[k][1][i] for i in range(3)) for k in names]
        if op == "UNION":
            return any(ins)
        if op == "INTERSECTION":
            return all(ins)
        return ins[0] and not any(ins[1:])
    nx, ny, nz = (len(a) - 1 for a in axes)
    cells = {}
    for i in range(nx):
        for j in range(ny):
            for k in range(nz):
                c = [(axes[0][i] + axes[0][i + 1]) / 2, (axes[1][j] + axes[1][j + 1]) / 2, (axes[2][k] + axes[2][k + 1]) / 2]
                cells[(i, j, k)] = inside(c)
    vol, area = Fraction(0), Fraction(0)
    size = [[axes[d][i + 1] - axes[d][i] for i in range(len(axes[d]) - 1)] for d in range(3)]
    for (i, j, k), inn in cells.items():
        if not inn:
            continue
        idx = (i, j, k)
        vol += size[0][i] * size[1][j] * size[2][k]
        for d in range(3):
            for step in (-1, 1):
                nb = list(idx)
                nb[d] += step
                if not cells.get(tuple(nb), False):
                    o = [size[e][idx[e]] for e in range(3) if e != d]
                    area += o[0] * o[1]
    inidx = [ijk for ijk, inn in cells.items() if inn]
    boxes_in = {ijk: ([axes[0][ijk[0]], axes[1][ijk[1]], axes[2][ijk[2]]], [axes[0][ijk[0] + 1], axes[1][ijk[1] + 1], axes[2][ijk[2] + 1]]) for ijk in inidx}
    return vol, area, boxes_in, B


def components(cells):
    """Bodies of a box-Boolean result: cells joined through shared faces (edge or vertex contact does not join)."""
    parent = {c: c for c in cells}

    def find(c):
        while parent[c] != c:
            parent[c] = parent[parent[c]]
            c = parent[c]
        return c
    for c in cells:
        for d in range(3):
            nb = list(c)
            nb[d] += 1
            nb = tuple(nb)
            if nb in parent:
                parent[find(c)] = find(nb)
    comps = {}
    for c in cells:
        comps.setdefault(find(c), []).append(c)
    return list(comps.values())


def dist_point_box(p, lo, hi):
    s = 0
    for i in range(3):
        if p[i] < lo[i]:
            s += (lo[i] - p[i]) ** 2
        elif p[i] > hi[i]:
            s += (p[i] - hi[i]) ** 2
    return s


def box_gaps(a, b):
    return [max(b[0][i] - a[1][i], a[0][i] - b[1][i], 0) for i in range(3)]


def in_closed(p, lo, hi):
    return all(lo[i] <= p[i] <= hi[i] for i in range(3))


def in_open(p, lo, hi):
    return all(lo[i] < p[i] < hi[i] for i in range(3))


# ------------------------------------------------------------------ 2D distance to line/arc regions (floats via mpmath)
def seg_dist(p, seg):
    if seg[0] == "L":
        a = [num(v) for v in seg[1]]
        b = [num(v) for v in seg[2]]
        d = [b[0] - a[0], b[1] - a[1]]
        t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2)
        t = min(max(t, 0), 1)
        q = [a[0] + t * d[0], a[1] + t * d[1]]
        return mp.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2)
    if seg[0] == "B":  # the ends and the real roots of (C - p).C' in [0,1] (degree 2n - 1)
        cx, cy = bez_mp(seg)
        qx, qy = [cx[0] - p[0]] + cx[1:], [cy[0] - p[1]] + cy[1:]
        dx, dy = [k * cx[k] for k in range(1, len(cx))], [k * cy[k] for k in range(1, len(cy))]
        g = [mp.mpf(0)] * (len(qx) + len(dx) - 1)
        for i in range(len(qx)):
            for j in range(len(dx)):
                g[i + j] += qx[i] * dx[j] + qy[i] * dy[j]
        return min(mp.sqrt(mp_poly(qx, t) ** 2 + mp_poly(qy, t) ** 2) for t in [mp.mpf(0), mp.mpf(1)] + mp_real_roots01(g))
    c = [num(v) for v in seg[1]]
    r = num(seg[2])
    t0, t1 = sorted([num(seg[3]), num(seg[4])])
    ang = mp.atan2(p[1] - c[1], p[0] - c[0])
    for k in range(-2, 3):
        if t0 <= ang + 2 * mp.pi * k <= t1:
            return abs(mp.sqrt((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2) - r)
    ends = [[c[0] + r * mp.cos(t), c[1] + r * mp.sin(t)] for t in (t0, t1)]
    return min(mp.sqrt((p[0] - e[0]) ** 2 + (p[1] - e[1]) ** 2) for e in ends)


_LOOP_SAMPLES = {}


def loop_samples(loop):
    """The polygon winding() walks for one loop: line starts, 64 points per arc and per Bezier (cached per loop object)."""
    hit = _LOOP_SAMPLES.get(id(loop))
    if hit is not None and hit[0] is loop:
        return hit[1]
    pts = []
    for seg in loop:
        if seg[0] == "L":
            pts.append([num(v) for v in seg[1]])
        elif seg[0] == "B":
            cx, cy = bez_mp(seg)
            pts += [[mp_poly(cx, mp.mpf(i) / 64), mp_poly(cy, mp.mpf(i) / 64)] for i in range(64)]
        else:
            c = [num(v) for v in seg[1]]
            r, t0, t1 = num(seg[2]), num(seg[3]), num(seg[4])
            for i in range(64):
                t = t0 + (t1 - t0) * i / 64
                pts.append([c[0] + r * mp.cos(t), c[1] + r * mp.sin(t)])
    _LOOP_SAMPLES[id(loop)] = (loop, pts)
    return pts


def winding(p, loops):
    tot = mp.mpf(0)
    for loop in loops:
        pts = loop_samples(loop)
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            tot += mp.atan2((a[0] - p[0]) * (b[1] - p[1]) - (a[1] - p[1]) * (b[0] - p[0]), (a[0] - p[0]) * (b[0] - p[0]) + (a[1] - p[1]) * (b[1] - p[1]))
    return abs(tot) > mp.pi


def dist2d(p, loops):
    p = [num(p[0]), num(p[1])]
    if winding(p, loops):
        return mp.mpf(0)
    return min(seg_dist(p, s) for loop in loops for s in loop)


def dist_prism(p, loops, w0, w1, perm=(0, 1, 2)):
    q = [num(p[perm[0]]), num(p[perm[1]]), num(p[perm[2]])]
    d2 = dist2d(q[:2], loops)
    dz = max(num(w0) - q[2], q[2] - num(w1), mp.mpf(0))
    return mp.sqrt(d2 ** 2 + dz ** 2)


def dist_revolve(p, loops, axis="z"):
    x, y, z = (num(v) for v in p)
    q = [mp.sqrt(x * x + y * y), z] if axis == "z" else [mp.sqrt(y * y + z * z), x]
    return dist2d(q, loops)


def dist_partial_revolve(p, loops, theta):
    """Profile loops revolved about local z over [0, theta]: lateral surfaces within the range plus the two end caps."""
    x, y, z = (num(v) for v in p)
    th = num(theta)
    rho = mp.sqrt(x * x + y * y)
    phi = mp.atan2(y, x)
    if phi < 0:
        phi += 2 * mp.pi
    cands = []
    if rho == 0 or phi <= th:
        cands.append(dist2d([rho, z], loops))
    for ang in (mp.mpf(0), th):
        u = x * mp.cos(ang) + y * mp.sin(ang)
        w = -x * mp.sin(ang) + y * mp.cos(ang)
        cands.append(mp.sqrt(w * w + dist2d([u, z], loops) ** 2))
    return min(cands)


# ------------------------------------------------------------------ convex projections (Dykstra, floats)
def dykstra(p, projs, iters=200000, tol=1e-15):
    x = [float(v) for v in p]
    incr = [[0.0, 0.0, 0.0] for _ in projs]
    for it in range(iters):
        prev = x[:]
        for k, P in enumerate(projs):
            y = [x[i] + incr[k][i] for i in range(3)]
            nx = P(y)
            incr[k] = [y[i] - nx[i] for i in range(3)]
            x = nx
        if max(abs(x[i] - prev[i]) for i in range(3)) < tol and it > 50:
            break
    return mp.mpf(math.dist(x, [float(v) for v in p]))


def proj_cyl(axis, r, lo, hi):
    ax = "xyz".index(axis)

    def P(y):
        y = y[:]
        o = [i for i in range(3) if i != ax]
        rho = math.hypot(y[o[0]], y[o[1]])
        if rho > r:
            y[o[0]] *= r / rho
            y[o[1]] *= r / rho
        y[ax] = min(max(y[ax], lo), hi)
        return y
    return P


def proj_halfspace(n, off):  # n . y <= off
    def P(y):
        s = sum(n[i] * y[i] for i in range(3)) - off
        if s <= 0:
            return y
        nn = sum(v * v for v in n)
        return [y[i] - s * n[i] / nn for i in range(3)]
    return P


def proj_box(lo, hi):
    return lambda y: [min(max(y[i], lo[i]), hi[i]) for i in range(3)]


def proj_dilation(projK, r):
    def P(y):
        q = projK(y)
        d = [y[i] - q[i] for i in range(3)]
        n = math.sqrt(sum(v * v for v in d))
        if n <= r:
            return y
        return [q[i] + d[i] * r / n for i in range(3)]
    return P


def proj_obround_prism(c1, c2, rad, zmax):
    def P(y):
        ax = c2[0] - c1[0]
        t = min(max((y[0] - c1[0]) / ax, 0.0), 1.0)
        base = [c1[0] + t * ax, c1[1]]
        d = [y[0] - base[0], y[1] - base[1]]
        n = math.hypot(*d)
        xy = [y[0], y[1]] if n <= rad else [base[0] + d[0] * rad / n, base[1] + d[1] * rad / n]
        return [xy[0], xy[1], min(y[2], zmax)]
    return P


def dist_cyl_solid(p, axis, c2d, r, lo, hi):
    ax = "xyz".index(axis)
    o = [i for i in range(3) if i != ax]
    rho = mp.sqrt((num(p[o[0]]) - num(c2d[0])) ** 2 + (num(p[o[1]]) - num(c2d[1])) ** 2)
    dr = max(rho - num(r), 0)
    da = max(num(lo) - num(p[ax]), num(p[ax]) - num(hi), 0)
    return mp.sqrt(dr ** 2 + da ** 2)


def seg3_dist(p, a, b):
    p, a, b = mpv(p), mpv(a), mpv(b)
    d = [b[i] - a[i] for i in range(3)]
    t = min(max(dot([p[i] - a[i] for i in range(3)], d) / dot(d, d), 0), 1)
    q = [a[i] + t * d[i] for i in range(3)]
    return mp.sqrt(dot([p[i] - q[i] for i in range(3)], [p[i] - q[i] for i in range(3)]))


# ------------------------------------------------------------------ special closed routes
def tjunction(R, r, span1, span2):
    """Union of a post (axis z, radius R, z in span1) and a branch (axis x, radius r, x in span2 starting on the post axis)."""
    R, r = num(R), num(r)
    h1 = num(span1[1]) - num(span1[0])
    h2 = num(span2[1]) - num(span2[0])
    Vcap = mp.quad(lambda y: mp.sqrt(R * R - y * y) * 2 * mp.sqrt(r * r - y * y), [-r, r])
    th0 = mp.asin(r / R)
    Ahole = mp.quad(lambda th: 2 * R * mp.sqrt(max(mp.mpf(0), r * r - R * R * mp.sin(th) ** 2)), [-th0, th0])
    Ain = mp.quad(lambda ph: r * mp.sqrt(R * R - r * r * mp.cos(ph) ** 2), [0, 2 * mp.pi])
    V = mp.pi * R * R * h1 + mp.pi * r * r * h2 - Vcap
    A_ = 2 * mp.pi * R * h1 - Ahole + 2 * mp.pi * R * R + 2 * mp.pi * r * h2 - Ain + mp.pi * r * r
    return V, A_


def quartic_length(R=8, r=4):
    R, r = num(R), num(r)
    return mp.quad(lambda ph: mp.sqrt(r * r + (r * r * mp.cos(ph) * mp.sin(ph)) ** 2 / (R * R - r * r * mp.cos(ph) ** 2)), [0, mp.pi / 2, mp.pi, 3 * mp.pi / 2, 2 * mp.pi])


def chain_fillet_quad(a, Lh, hh, r):
    a, Lh, hh, r = num(a), num(Lh), num(hh), num(r)
    P_ = 2 * a * Lh + mp.pi * a * a
    per = lambda aa: 2 * Lh + 2 * mp.pi * aa
    area = lambda aa: 2 * aa * Lh + mp.pi * aa * aa
    inset = lambda zz: r - mp.sqrt(max(mp.mpf(0), r * r - (zz - (hh - r)) ** 2))
    V = P_ * (hh - r) + mp.quad(lambda zz: area(a - inset(zz)), [hh - r, hh])
    blend = mp.quad(lambda ph: per(a - r + r * mp.cos(ph)) * r, [0, mp.pi / 2])
    A_ = area(a - r) + P_ + per(a) * (hh - r) + blend
    return V, A_


def trihedral_quad(a, r):
    a, r = num(a), num(r)
    rho = lambda zz: mp.sqrt(max(mp.mpf(0), r * r - (r - zz) ** 2))
    s = lambda zz: r - rho(zz)
    k = 1 - mp.pi / 4
    V = mp.quad(lambda zz: (a - s(zz)) ** 2 - k * rho(zz) ** 2, [0, r]) + (a - r) * (a * a - k * r * r)
    lat_low = mp.quad(lambda zz: 2 * (a - s(zz)) + 2 * (a - r) * r / rho(zz) + mp.pi / 2 * r, [0, r])
    lat_high = (a - r) * (2 * a + 2 * (a - r) + mp.pi * r / 2)
    A_ = (a - r) ** 2 + (a * a - k * r * r) + lat_low + lat_high
    return V, A_


def poly_distance(a, b):
    def pseg(p, s0, s1):
        d = [s1[0] - s0[0], s1[1] - s0[1]]
        t = min(max(((p[0] - s0[0]) * d[0] + (p[1] - s0[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2), 0), 1)
        return math.hypot(p[0] - s0[0] - t * d[0], p[1] - s0[1] - t * d[1])
    best = math.inf
    for P_, Q_ in ((a, b), (b, a)):
        for p in P_:
            for i in range(len(Q_)):
                best = min(best, pseg(p, Q_[i], Q_[(i + 1) % len(Q_)]))
    return mp.mpf(best)


def polyhedron(faces):
    V, Ar = 0, 0
    for f in faces:
        f = [sp.Matrix(v) for v in f]
        for i in range(1, len(f) - 1):
            a, b, c = f[0], f[i], f[i + 1]
            V += a.dot(b.cross(c)) / 6
            Ar += sp.sqrt(((b - a).cross(c - a)).dot((b - a).cross(c - a))) / 2
    return sp.simplify(V), sp.simplify(Ar)


def fillet_box_profile(x0, y0, x1, y1, r):
    r = sp.sympify(r)
    return [L((x0, y0), (x1, y0)), L((x1, y0), (x1, y1 - r)), A((x1 - r, y1 - r), r, 0, HALF_PI), L((x1 - r, y1), (x0, y1)), L((x0, y1), (x0, y0))]


# ------------------------------------------------------------------ per-zone models (bound to construction.params)
class Params:
    """construction.params with consumption tracking: every key must be read by a route or a literal guard."""

    def __init__(self, d):
        self._d = d
        self.used = set()

    def __getitem__(self, k):
        self.used.add(k)
        return self._d[k]

    def unused(self):
        return [k for k in self._d if k not in self.used]


MODELS = {}


def model_for(*ids):
    def deco(f):
        for i in ids:
            MODELS[i] = f
        return f
    return deco


def chk(m, label, ok, detail=""):
    m["checks"].append((label, bool(ok), detail))


def lit(m, P, key, expected):
    v = P[key]
    chk(m, f"param {key} == {expected!r}", v == expected, repr(v))
    return v


def prism_model(m, loops, w0, w1, perm=(0, 1, 2)):
    V, A_, _ = prism(loops, sp.sympify(w1) - sp.sympify(w0))
    m["V"], m["A"] = V, A_
    m["solid"] = [("prism", loops, w0, w1, perm)]
    m["fn"]["probeDistance"] = lambda d: (dist_prism(d["point"], loops, w0, w1, perm), "numeric")


def revolve_model(m, loops, axis="z"):
    m["V"], m["A"] = revolve(loops, 2 * sp.pi)
    m["solid"] = [("revolve", loops, 2 * sp.pi, axis)]
    m["fn"]["probeDistance"] = lambda d: (dist_revolve(d["point"], loops, axis), "numeric")


def box_model(m, boxes, op, conv, route):
    vol, area, cells, B = box_boolean(boxes, op, conv)
    m["V"], m["A"], m["route"] = vol, area, route
    comps = components(list(cells))
    m["bodies"] = len(comps)
    m["solid"] = [cells_piece(list(cells.values()))] if cells else None
    corners = [[b[s0][0], b[s1][1], b[s2][2]] for b in B.values() for s0 in (0, 1) for s1 in (0, 1) for s2 in (0, 1)]
    names = list(B)

    def in_result(p):
        if op == "UNION":
            return any(in_closed(p, *B[k]) for k in names)
        if op == "INTERSECTION":
            return all(in_closed(p, *B[k]) for k in names)
        return in_closed(p, *B[names[0]]) and not any(in_open(p, *B[k]) for k in names[1:])
    kept = [c for c in corners if in_result(c)]
    m["elements"] = [PT(c) for c in kept] if kept else None
    comp_of = {}
    for i, comp in enumerate(comps):
        for c in comp:
            comp_of[c] = i

    def comp_at(p):
        for ijk, (lo, hi) in cells.items():
            if in_closed(p, lo, hi):
                return comp_of[ijk]
        return None
    pr = "exact" if route == "exact" else "e9"

    def probe(d):
        p = [conv(v) for v in d["point"]]
        return mp.sqrt(num(min(dist_point_box(p, lo, hi) for lo, hi in cells.values()))), pr

    def body_distance(d):
        ca, cb = comp_at([conv(v) for v in d["bodyA"]]), comp_at([conv(v) for v in d["bodyB"]])
        if ca is None or cb is None or ca == cb:
            return None, f"body points not in two different bodies ({ca}, {cb})"
        best = None
        for ia in comps[ca]:
            for ib in comps[cb]:
                g = box_gaps(cells[ia], cells[ib])
                nz = [x for x in g if x != 0]
                val = (nz[0] if len(nz) == 1 else Fraction(0)) if len(nz) <= 1 else mp.sqrt(num(sum(x * x for x in g)))
                if best is None or num(val) < num(best):
                    best = val
        return best, ("exact" if route == "exact" else "e9exact") if isinstance(best, Fraction) else pr

    def extent(d):
        ax = "xyz".index(d["axis"].split()[-1])
        return max(hi[ax] for lo, hi in cells.values()) - min(lo[ax] for lo, hi in cells.values()), ("exact" if route == "exact" else "e9exact")
    m["fn"]["probeDistance"] = probe
    m["fn"]["bodyDistance"] = body_distance
    m["fn"]["bboxExtent"] = extent
    return cells, B


@model_for("AC01")
def _m01(z, P, m, cat):
    poly, d = P["polygon"], P["depth"]
    prism_model(m, [poly_loop(poly)], 0, d)
    m["elements"] = [PT([x, y, zz]) for x, y in poly for zz in (0, d)]


@model_for("AC02")
def _m02(z, P, m, cat):
    (x0, y0), (x1, y1) = P["square"]
    h, d = P["hole"], P["depth"]
    (cx, cy), r = h["center"], h["radius"]
    chk(m, "hole strictly inside the square", x0 < cx - r and cx + r < x1 and y0 < cy - r and cy + r < y1)
    prism_model(m, [rect_loop(x0, y0, x1, y1), circle_loop(cx, cy, r, cw=True)], 0, d)
    m["elements"] = box_pts([x0, y0, 0], [x1, y1, d])


@model_for("AC03")
def _m03(z, P, m, cat):
    a, (c1, c2), d = P["a"], P["centers"], P["depth"]
    chk(m, "obround centres on one horizontal line, c1 left of c2", c1[1] == c2[1] and c1[0] < c2[0])
    loops = [[L((c1[0], c1[1] - a), (c2[0], c2[1] - a)), A(c2, a, -HALF_PI, HALF_PI), L((c2[0], c2[1] + a), (c1[0], c1[1] + a)), A(c1, a, HALF_PI, 3 * HALF_PI)]]
    prism_model(m, loops, 0, d)
    h = mp.pi / 2
    m["elements"] = [e for zz in (0, d) for e in (ARC([c2[0], c2[1], zz], [a, 0, 0], [0, a, 0], -h, h), ARC([c1[0], c1[1], zz], [a, 0, 0], [0, a, 0], h, 3 * h))]


@model_for("AC04")
def _m04(z, P, m, cat):
    (r0, r1), (z0, z1), ang = P["rho"], P["z"], P["angleDeg"]
    th = sp.pi * sp.Rational(ang) / 180
    loops = [rect_loop(r0, z0, r1, z1)]
    m["V"], m["A"] = revolve(loops, th)
    m["solid"] = [("revolve", loops, th, "z")]
    m["fn"]["probeDistance"] = lambda d: (dist_partial_revolve(d["point"], loops, th), "numeric")
    thm = num(th)
    m["elements"] = [PT([r * mp.cos(phi), r * mp.sin(phi), zz]) for r in (r0, r1) for phi in (mp.mpf(0), thm) for zz in (z0, z1)]
    m["elements"] += [ARC([0, 0, zz], [r, 0, 0], [0, r, 0], 0, thm) for zz in (z0, z1) for r in (r0, r1)]


@model_for("AC05")
def _m05(z, P, m, cat):
    (b0, b1), (t0, t1), H = P["bottom"], P["top"], P["height"]
    bot = [(b0[0], b0[1], 0), (b1[0], b0[1], 0), (b1[0], b1[1], 0), (b0[0], b1[1], 0)]
    top = [(t0[0], t0[1], H), (t1[0], t0[1], H), (t1[0], t1[1], H), (t0[0], t1[1], H)]
    faces = [bot[::-1], top] + [[bot[i], bot[(i + 1) % 4], top[(i + 1) % 4], top[i]] for i in range(4)]
    m["V"], m["A"] = polyhedron(faces)
    projs = []
    for f in faces:
        a, b, c = (sp.Matrix(v) for v in f[:3])
        n = (b - a).cross(c - a)
        chk(m, f"ruled side planar {f[0]}", all(n.dot(sp.Matrix(q) - a) == 0 for q in f), "")
        projs.append(proj_halfspace([float(x) for x in n], float(n.dot(a))))
    m["fn"]["probeDistance"] = lambda d: (dykstra(d["point"], projs), "numeric")
    m["solid"] = [("pts", [mpv(p) for p in bot + top])]
    m["elements"] = [PT(p) for p in bot + top]


@model_for("AC07")
def _m07(z, P, m, cat):
    R, pitch, turns, r = num(P["R"]), num(P["pitch"]), P["turns"], num(P["r"])
    cz = pitch / (2 * mp.pi)
    chk(m, "tube radius below curvature radius and half pitch", r < (R * R + cz * cz) / R and r < pitch / 2)
    Lh = mp.quad(lambda t: mp.sqrt((R * mp.sin(t)) ** 2 + (R * mp.cos(t)) ** 2 + cz ** 2), [0, 2 * mp.pi * turns])
    m["V"], m["A"], m["route"] = mp.pi * r ** 2 * Lh, 2 * mp.pi * r * Lh + 2 * mp.pi * r ** 2, "quad"

    def probe(d):
        pt = mpv(d["point"])
        f = lambda t: -mp.sqrt((R * mp.cos(t) - pt[0]) ** 2 + (R * mp.sin(t) - pt[1]) ** 2 + (cz * t - pt[2]) ** 2)
        best, targ = maximize_1d(f, 0, 2 * mp.pi * turns, n=20001)
        if not (mp.mpf("0.1") < targ < 2 * mp.pi * turns - mp.mpf("0.1")):
            return None, "nearest core point at a tube end: end-disc route not implemented"
        return -best - r, "numeric"
    m["fn"]["probeDistance"] = probe
    m["elements"] = [("helixtube", R, pitch, turns, r)]


@model_for("AC08")
def _m08(z, P, m, cat):
    seed, count, step = P["seed"], P["count"], P["stepDeg"]
    (cx, cy), rr, hh = seed["center"], seed["radius"], seed["height"]
    centers = []
    for k in range(count):
        ang = sp.pi * sp.Rational(step * k, 180)
        c, s = sp.cos(ang), sp.sin(ang)
        centers.append((sp.simplify(c * cx - s * cy), sp.simplify(s * cx + c * cy)))
    chk(m, "instances disjoint", all(sp.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) > 2 * rr for i, a in enumerate(centers) for b in centers[i + 1:]))
    V1, A1 = revolve([rect_loop(0, 0, rr, hh)], 2 * sp.pi)
    m["V"], m["A"] = count * V1, count * A1
    m["fn"]["probeDistance"] = lambda d: (min(dist_cyl_solid(d["point"], "z", c, rr, 0, hh) for c in centers), "numeric")
    m["solid"] = [("prism", [circle_loop(c[0], c[1], rr)], 0, hh, (0, 1, 2)) for c in centers]
    m["elements"] = [CIRCLE([c[0], c[1], zz], [0, 0, 1], rr) for c in centers for zz in (0, hh)]


@model_for("AC09")
def _m09(z, P, m, cat):
    tri, d = P["triangle"], P["depth"]
    lit(m, P, "mirrorPlane", "local x = 0")
    mir = [[-x, y] for x, y in tri]
    loops, mloops = [poly_loop(tri)], [poly_loop(mir[::-1])]
    V, A_, _ = prism(loops, d)
    Vm, Am, _ = prism(mloops, d)
    chk(m, "mirror image disjoint from the seed", min(x for x, _ in tri) > 0)
    m["V"], m["A"] = V + Vm, A_ + Am
    m["fn"]["probeDistance"] = lambda q: (min(dist_prism(q["point"], loops, 0, d), dist_prism(q["point"], mloops, 0, d)), "numeric")

    def body_distance(q):
        ok = dist_prism(q["bodyA"], loops, 0, d) == 0 and dist_prism(q["bodyB"], mloops, 0, d) == 0
        return (poly_distance(tri, mir), "numeric") if ok else (None, "body points not in seed/mirror")
    m["fn"]["bodyDistance"] = body_distance
    m["solid"] = [("prism", loops, 0, d, (0, 1, 2)), ("prism", mloops, 0, d, (0, 1, 2))]
    m["elements"] = [PT([s * x, y, zz]) for s in (1, -1) for x, y in tri for zz in (0, d)]


@model_for("AC10", "AC11", "AC12", "AC13", "AC14", "AC15", "AC16", "AC17")
def _mbox(z, P, m, cat):
    box_model(m, P["boxes"], P["op"], nominal, "exact")


@model_for("AC18", "AC47")
def _mplate(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = P["plate"]
    lit(m, P, "op", "SUBTRACTION")
    if "holes" in z["construction"]["params"]:
        h = P["holes"]
        centers, r, hz = h["centers"], h["radius"], h["z"]
    else:
        h = P["hole"]
        centers, r, hz = [h["center"]], h["r"], h["z"]
    r = R_(r)
    chk(m, "holes through (tool overhangs both faces)", hz[0] < z0 and hz[1] > z1)
    chk(m, "holes inside the plate", all(x0 < cx - r and cx + r < x1 and y0 < cy - r and cy + r < y1 for cx, cy in centers))
    chk(m, "holes disjoint", all(sp.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) > 2 * r for i, a in enumerate(centers) for b in centers[i + 1:]))
    prism_model(m, [rect_loop(x0, y0, x1, y1)] + [circle_loop(cx, cy, r, cw=True) for cx, cy in centers], z0, z1)
    m["elements"] = box_pts([x0, y0, z0], [x1, y1, z1])


@model_for("AC19")
def _m19(z, P, m, cat):
    cx, cy = P["cylX"], P["cylY"]
    lit(m, P, "op", "INTERSECTION")
    r = num(cx["r"])
    chk(m, "axes x and y, equal radii, caps clear of the intersection", cx["axis"] == "x" and cy["axis"] == "y" and cx["r"] == cy["r"]
        and all(s[0] < -cx["r"] and s[1] > cx["r"] for s in (cx["span"], cy["span"])))
    m["V"] = mp.quad(lambda zz: 4 * (r * r - zz * zz), [-r, r])
    m["A"] = 2 * mp.quad(lambda th: 2 * r * abs(mp.cos(th)) * r, [0, mp.pi / 2, 3 * mp.pi / 2, 2 * mp.pi])
    m["route"] = "quad"
    pr = [proj_cyl("x", float(r), *cx["span"]), proj_cyl("y", float(r), *cy["span"])]
    m["fn"]["probeDistance"] = lambda d: (dykstra(d["point"], pr), "numeric")
    m["elements"] = [ARC([0, 0, 0], [r, r, 0], [0, 0, r], 0, 2 * mp.pi), ARC([0, 0, 0], [r, -r, 0], [0, 0, r], 0, 2 * mp.pi)]


def tee(m, C1, C2):
    R, s1, r, s2 = C1["R"], C1["span"], C2["r"], C2["span"]
    chk(m, "post along z, branch along x starting on the post axis and leaving the post, branch inside the post height",
        C1["axis"] == "z" and C2["axis"] == "x" and s2[0] == 0 and s2[1] > R and s1[0] < -r and s1[1] > r and r < R)
    solid = [("prism", [circle_loop(0, 0, R)], s1[0], s1[1], (0, 1, 2)), ("prism", [circle_loop(0, 0, r)], s2[0], s2[1], (1, 2, 0))]
    elements = [CIRCLE([0, 0, s1[0]], [0, 0, 1], R), CIRCLE([0, 0, s1[1]], [0, 0, 1], R), CIRCLE([s2[1], 0, 0], [1, 0, 0], r)]
    return R, r, s1, s2, solid, elements


@model_for("AC20")
def _m20(z, P, m, cat):
    C1, C2 = P["C1"], P["C2"]
    lit(m, P, "op", "UNION")
    R, r, s1, s2, m["solid"], m["elements"] = tee(m, C1, C2)
    m["V"], m["A"] = tjunction(R, r, s1, s2)
    m["route"] = "quad"
    m["fn"]["probeDistance"] = lambda d: (min(dist_cyl_solid(d["point"], "z", (0, 0), R, *s1), dist_cyl_solid(d["point"], "x", (0, 0), r, *s2)), "numeric")


@model_for("AC21")
def _m21(z, P, m, cat):
    C1, C2 = P["C1"], P["C2"]
    lit(m, P, "op", "UNION")
    chk(m, "same radius, C2 starts at C1's top cap", C1["r"] == C2["r"] and C1["z"][1] == C2["z"][0])
    r = C1["r"]
    revolve_model(m, [rect_loop(0, C1["z"][0], r, C2["z"][1])])
    m["elements"] = [CIRCLE([0, 0, C1["z"][0]], [0, 0, 1], r), CIRCLE([0, 0, C2["z"][1]], [0, 0, 1], r)]


def two_cylinders(m, C1, C2, conv_center=None):
    m["solid"] = [("prism", [circle_loop(R_(c["center"][0]), R_(c["center"][1]), c["r"])], c["z"][0], c["z"][1], (0, 1, 2)) for c in (C1, C2)]
    m["elements"] = [CIRCLE([c["center"][0], c["center"][1], zz], [0, 0, 1], c["r"]) for c in (C1, C2) for zz in c["z"]]
    V1, A1 = revolve([rect_loop(0, C1["z"][0], C1["r"], C1["z"][1])], 2 * sp.pi)
    V2, A2 = revolve([rect_loop(0, C2["z"][0], C2["r"], C2["z"][1])], 2 * sp.pi)
    m["V"], m["A"] = V1 + V2, A1 + A2


def in_cyl(p, c):
    return dist_cyl_solid(p, "z", (num(c["center"][0]), num(c["center"][1])), c["r"], *c["z"]) == 0


@model_for("AC22")
def _m22(z, P, m, cat):
    C1, C2 = P["C1"], P["C2"]
    lit(m, P, "op", "UNION")
    dc = sp.sqrt((R_(C2["center"][0]) - R_(C1["center"][0])) ** 2 + (R_(C2["center"][1]) - R_(C1["center"][1])) ** 2)
    chk(m, "exact external tangency |c2 - c1| == r1 + r2", sp.simplify(dc - C1["r"] - C2["r"]) == 0, str(dc))
    chk(m, "same z range", C1["z"] == C2["z"])
    two_cylinders(m, C1, C2)
    m["fn"]["bodyDistance"] = lambda d: ((sp.simplify(dc - C1["r"] - C2["r"]), "exact") if in_cyl(d["bodyA"], C1) and in_cyl(d["bodyB"], C2) else (None, "body points"))


@model_for("AC23")
def _m23(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = box = P["box"]
    c = P["cutter"]
    lit(m, P, "op", "SUBTRACTION")
    (cx, cy), r = c["center"], c["r"]
    dx, dy = max(x0 - cx, cx - x1, 0), max(y0 - cy, cy - y1, 0)
    chk(m, "cutter axis exactly r from the box (tangent, no interior overlap)", sp.sqrt(sp.Integer(dx) ** 2 + sp.Integer(dy) ** 2) == r)
    chk(m, "cutter spans the box height", c["z"][0] < z0 and c["z"][1] > z1)
    box_model(m, {"A": box}, "UNION", nominal, "exact")


@model_for("AC24")
def _m24(z, P, m, cat):
    s, box = P["sphere"], P["box"]
    lit(m, P, "op", "INTERSECTION")
    c, r = s["center"], s["r"]
    chk(m, "half-space box: bottom through the sphere centre, covers the upper half", c == [0, 0, 0] and box[0][2] == c[2]
        and box[0][0] < -r and box[0][1] < -r and box[1][0] > r and box[1][1] > r and box[1][2] > r)
    revolve_model(m, [[L((0, 0), (r, 0)), A((0, 0), r, 0, HALF_PI), L((0, r), (0, 0))]])
    m["elements"] = [("sphzone", mpv(c), num(r), mpv([0, 0, 1]), mp.mpf(0), mp.mpf(1)), CIRCLE(c, [0, 0, 1], r)]


@model_for("AC25")
def _m25(z, P, m, cat):
    tri = P["triangle"]
    chk(m, "one profile edge on the axis (apex on the axis)", sum(1 for u, _ in tri if u == 0) == 2)
    revolve_model(m, [poly_loop(tri)])
    m["elements"] = [PT([0, 0, v]) if u == 0 else CIRCLE([0, 0, v], [0, 0, 1], u) for u, v in tri]


@model_for("AC26", "AC48")
def _mtorus(z, P, m, cat):
    circ = P["circle"]
    (cu, cv), r = circ["center"], circ["r"]
    if z["id"] == "AC26":
        chk(m, "ring torus: centre distance > r", cu > r)
    else:
        chk(m, "horn torus: centre distance == r (axis tangency)", cu == r)
    loops = [circle_loop(cu, cv, r)]
    revolve_model(m, loops)
    m["elements"] = [("torus", mpv([0, 0, cv]), mpv([0, 0, 1]), num(cu), num(r))]

    def line_distance(d):
        ok = d["point"] == [0, 0, 0] and d["direction"] == [0, 0, 1]
        return (sp.Max(sp.Integer(cu) - r, 0), "exact") if ok else (None, "only the revolve axis is supported")
    m["fn"]["lineDistance"] = line_distance


@model_for("AC27")
def _m27(z, P, m, cat):
    S1, S2 = P["S1"], P["S2"]
    lit(m, P, "op", "INTERSECTION")
    r, d = S1["r"], S2["center"][0] - S1["center"][0]
    chk(m, "equal spheres on the local x axis, S1 at the origin, 0 < d < 2r", S1["center"] == [0, 0, 0] and S2["center"][1:] == [0, 0] and S1["r"] == S2["r"] and 0 < d < 2 * r)
    tr = sp.asin(sp.Rational(d, 2 * r))
    loops = [[A((0, d), r, -HALF_PI, -tr), A((0, 0), r, tr, HALF_PI), L((0, r), (0, d - r))]]
    revolve_model(m, loops, axis="x")
    hr = mp.mpf(d) / (2 * r)
    m["elements"] = [("sphzone", mpv([0, 0, 0]), num(r), mpv([1, 0, 0]), hr, mp.mpf(1)), ("sphzone", mpv([d, 0, 0]), num(r), mpv([-1, 0, 0]), hr, mp.mpf(1)),
                     CIRCLE([mp.mpf(d) / 2, 0, 0], [1, 0, 0], mp.sqrt(r * r - (mp.mpf(d) / 2) ** 2))]


@model_for("AC28")
def _m28(z, P, m, cat):
    s, cyl = P["sphere"], P["cylinder"]
    lit(m, P, "op", "SUBTRACTION")
    Rs, a = s["r"], cyl["r"]
    h = sp.sqrt(Rs ** 2 - a ** 2)
    chk(m, "coaxial through bore: centre at origin, a < R, cylinder beyond the sphere", s["center"] == [0, 0, 0] and a < Rs and cyl["z"][0] < -h and cyl["z"][1] > h)
    ta = sp.asin(h / Rs)
    revolve_model(m, [[A((0, 0), Rs, -ta, ta), L((a, h), (a, -h))]])
    hr = num(h) / Rs
    m["elements"] = [("sphzone", mpv([0, 0, 0]), num(Rs), mpv([0, 0, 1]), -hr, hr), CIRCLE([0, 0, h], [0, 0, 1], a), CIRCLE([0, 0, -h], [0, 0, 1], a)]


def fillet_edge_box(m, P):
    (x0, y0, z0), (x1, y1, z1) = P["box"]
    lit(m, P, "edge", f"x={x1}, y={y1}, along z")
    return (x0, y0, z0), (x1, y1, z1)


def fillet_edge_elements(x0, y0, z0, x1, y1, z1, r):
    h = mp.pi / 2
    els = [PT([x, y, zz]) for x, y in [(x0, y0), (x1, y0), (x0, y1)] for zz in (z0, z1)]
    return els + [ARC([x1 - r, y1 - r, zz], [r, 0, 0], [0, r, 0], 0, h) for zz in (z0, z1)]


@model_for("AC29")
def _m29(z, P, m, cat):
    r = P["radius"]
    (x0, y0, z0), (x1, y1, z1) = fillet_edge_box(m, P)
    chk(m, "radius fits both faces", 0 < r < min(x1 - x0, y1 - y0))
    prism_model(m, [fillet_box_profile(x0, y0, x1, y1, r)], z0, z1)
    m["elements"] = fillet_edge_elements(x0, y0, z0, x1, y1, z1, r)


@model_for("AC30")
def _m30(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = P["box"]
    E = P["edges"]
    k0, k1 = f"x={x0},y={y0}", f"x={x1},y={y0}"
    chk(m, "edges are the two vertical edges of face y=min", set(E) == {k0, k1}, str(sorted(E)))
    r0, r1 = E[k0], E[k1]
    chk(m, "radii fill the face width exactly (critical)", r0 + r1 == x1 - x0)
    chk(m, "radii fit the side faces", r0 <= y1 - y0 and r1 <= y1 - y0)
    loop = [A((x1 - r1, y0 + r1), r1, 3 * HALF_PI, 4 * HALF_PI), L((x1, y0 + r1), (x1, y1)), L((x1, y1), (x0, y1)), L((x0, y1), (x0, y0 + r0)), A((x0 + r0, y0 + r0), r0, 2 * HALF_PI, 3 * HALF_PI)]
    if x0 + r0 < x1 - r1:
        loop.append(L((x0 + r0, y0), (x1 - r1, y0)))
    prism_model(m, [loop], z0, z1)
    h = mp.pi / 2
    m["elements"] = [PT([x, y1, zz]) for x in (x0, x1) for zz in (z0, z1)]
    m["elements"] += [e for zz in (z0, z1) for e in (ARC([x0 + r0, y0 + r0, zz], [r0, 0, 0], [0, r0, 0], 2 * h, 3 * h), ARC([x1 - r1, y0 + r1, zz], [r1, 0, 0], [0, r1, 0], 3 * h, 4 * h))]


@model_for("AC31")
def _m31(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = P["plate"]
    lit(m, P, "edge", f"y={y0}, z={z1}, along x")
    r = P["radius"]
    # CE8: radius > thickness requires edge overflow; it does not prove
    # infeasibility. opFillet permits overflow by default. Preserve the frozen
    # parameter check without endorsing v1's disputed refusal-only outcome.
    chk(m, "radius exceeds plate thickness (edge overflow required; CE8)", Fraction(r) > Fraction(z1 - z0), f"{r} > {z1 - z0}")
    m["route"] = "none (v1 refusal-only contract disputed by CE8)"


@model_for("AC32")
def _m32(z, P, m, cat):
    a, Ls, (c1, c2), hh, r = P["a"], P["L"], P["centers"], P["h"], P["radius"]
    chk(m, "obround: centres horizontal, distance L; r < a, r < h", c1[1] == c2[1] and c2[0] - c1[0] == Ls and r < a and r < hh)
    m["V"], m["A"] = chain_fillet_quad(a, Ls, hh, r)
    m["route"] = "quad"
    pr = [proj_dilation(proj_obround_prism(c1, c2, a - r, hh - r), r), proj_halfspace([0, 0, -1], 0)]
    m["fn"]["probeDistance"] = lambda d: (dykstra(d["point"], pr), "numeric")
    h = mp.pi / 2
    els = []
    for zz in (0, hh - r):
        els += [ARC([c2[0], c2[1], zz], [a, 0, 0], [0, a, 0], -h, h), ARC([c1[0], c1[1], zz], [a, 0, 0], [0, a, 0], h, 3 * h)]
    els += [("toruspatch", mpv([c2[0], c2[1], hh - r]), mpv([0, 0, 1]), mpv([1, 0, 0]), num(a - r), num(r), -h, h, mp.mpf(0), h),
            ("toruspatch", mpv([c1[0], c1[1], hh - r]), mpv([0, 0, 1]), mpv([1, 0, 0]), num(a - r), num(r), h, 3 * h, mp.mpf(0), h)]
    els += [PT([x, y, hh]) for x in (c1[0], c2[0]) for y in (c1[1] - (a - r), c1[1] + (a - r))]
    m["elements"] = els


@model_for("AC33")
def _m33(z, P, m, cat):
    cyl, c = P["cylinder"], P["chamfer"]
    R, H = cyl["R"], cyl["h"]
    chk(m, "chamfer fits", 0 < c < min(R, H))
    revolve_model(m, [poly_loop([[0, 0], [R, 0], [R, H - c], [R - c, H], [0, H]])])
    m["elements"] = [CIRCLE([0, 0, 0], [0, 0, 1], R), CIRCLE([0, 0, H - c], [0, 0, 1], R), CIRCLE([0, 0, H], [0, 0, 1], R - c)]


@model_for("AC34")
def _m34(z, P, m, cat):
    lo, hi = P["box"]
    v, r = P["vertex"], P["radius"]
    a = hi[0] - lo[0]
    chk(m, "cube at the origin, blended vertex = its min corner", lo == [0, 0, 0] and hi == [a, a, a] and v == lo and 0 < r < a)
    m["V"], m["A"] = trihedral_quad(a, r)
    m["route"] = "quad"
    pr = [proj_box([0, 0, 0], [a, a, a]), proj_dilation(proj_box([r, r, r], [1e9, 1e9, 1e9]), r)]
    m["fn"]["probeDistance"] = lambda d: (dykstra(d["point"], pr), "numeric")
    pts = [[a, a, a], [a, a, 0], [a, 0, a], [0, a, a], [a, 0, r], [a, r, 0], [0, a, r], [r, a, 0], [0, r, a], [r, 0, a], [r, 0, r], [r, r, 0], [0, r, r]]
    h = mp.pi / 2
    els = [PT(p) for p in pts]
    els += [ARC([x, r, r], [0, -r, 0], [0, 0, -r], 0, h) for x in (r, a)]
    els += [ARC([r, y, r], [-r, 0, 0], [0, 0, -r], 0, h) for y in (r, a)]
    els += [ARC([r, r, zz], [-r, 0, 0], [0, -r, 0], 0, h) for zz in (r, a)]
    els.append(("octsph", mpv([r, r, r]), num(r), [-1, -1, -1]))
    m["elements"] = els


@model_for("AC35")
def _m35(z, P, m, cat):
    rad = P["radius"]
    lit(m, P, "law", "linear (smoothTransition false)")
    (x0, y0, z0), (x1, y1, z1) = fillet_edge_box(m, P)
    k0, k1 = f"z={z0}", f"z={z1}"
    chk(m, "radius law keys are the edge's end heights", set(rad) == {k0, k1}, str(sorted(rad)))
    r0, r1 = rad[k0], rad[k1]
    rmin, rmax = min(r0, r1), max(r0, r1)
    m["bounds"] = {"lower": prism([fillet_box_profile(x0, y0, x1, y1, rmax)], z1 - z0)[0], "upper": prism([fillet_box_profile(x0, y0, x1, y1, rmin)], z1 - z0)[0]}
    m["route"] = "bounds only (cross-comparison)"
    m["solid"] = [("prism", [fillet_box_profile(x0, y0, x1, y1, rmin)], z0, z1, (0, 1, 2))]
    m["solidInner"] = [("prism", [fillet_box_profile(x0, y0, x1, y1, rmax)], z0, z1, (0, 1, 2))]
    m["elements"] = fillet_edge_elements(x0, y0, z0, x1, y1, z1, rmax)
    # straight edges of the result: spring lines y = y1 - r(z) on face x = x1 and x = x1 - r(z) on face y = y1 (linear law, both blend conventions)
    fx = [(x1, y0, z0), (x1, y1 - r0, z0), (x1, y1 - r1, z1), (x1, y0, z1)]
    fy = [(x0, y1, z0), (x1 - r0, y1, z0), (x1 - r1, y1, z1), (x0, y1, z1)]
    segs = [(f[i], f[(i + 1) % 4]) for f in (fx, fy) for i in range(4)]
    segs += [((x0, y0, z0), (x1, y0, z0)), ((x0, y0, z0), (x0, y1, z0)), ((x0, y0, z0), (x0, y0, z1)), ((x0, y0, z1), (x1, y0, z1)), ((x0, y0, z1), (x0, y1, z1))]
    corner_sq = [((x1 - r0, y1 - r0), z0), ((x1 - r1, y1 - r1), z1)]

    def edge_length(d):
        p = mpv(d["point"])
        ds = sorted((seg3_dist(p, a, b), a, b) for a, b in segs)
        on = ds[0][0] < mp.mpf("1e-30")
        clear = ds[1][0] >= 1
        cclear = all(mp.sqrt(max(num(sq[0]) - p[0], 0) ** 2 + max(num(sq[1]) - p[1], 0) ** 2 + (p[2] - num(zz)) ** 2) >= 1 for sq, zz in corner_sq)
        if not (on and clear and cclear):
            return None, f"point not unambiguously on one straight edge (on={on}, others>=1: {clear}, blend curves>=1: {cclear})"
        a, b = ds[0][1], ds[0][2]
        return sp.sqrt(sum((sp.Integer(b[i]) - a[i]) ** 2 for i in range(3))), "exact"
    m["fn"]["edgeLength"] = edge_length


@model_for("AC36")
def _m36(z, P, m, cat):
    a20 = cat["AC20"]["construction"]["params"]
    C1, C2 = a20["C1"], a20["C2"]
    lit(m, P, "base", f"AC20 geometry (R={C1['R']} post, r={C2['r']} branch)")
    rf = P["radius"]
    R, r, s1, s2, m["solid"], m["elements"] = tee(m, C1, C2)
    Vt = tjunction(R, r, s1, s2)[0]
    m["bounds"] = {"lower": Vt, "upper": Vt + mp.mpf(2) / 5 * num(rf) ** 2 * quartic_length(R, r)}
    m["route"] = "bounds only (cross-comparison)"


@model_for("AC37")
def _m37(z, P, m, cat):
    box, t = P["box"], P["thickness"]
    (x0, y0, z0), (x1, y1, z1) = box
    lit(m, P, "removeFace", f"z={z1}")
    box_model(m, {"A": box, "T": [[x0 + t, y0 + t, z0 + t], [x1 - t, y1 - t, z1 + 1]]}, "SUBTRACTION", nominal, "exact")


@model_for("AC38")
def _m38(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = P["box"]
    lit(m, P, "face", f"x={x1}")
    lit(m, P, "neutral", f"z={z0}")
    lit(m, P, "pull", "+z")
    tn = sp.Rational(P["tanAngle"])
    prof = [[x0, z0], [x1, z0], [x1 - (z1 - z0) * tn, z1], [x0, z1]]
    prism_model(m, [poly_loop(prof)], y0, y1, perm=(0, 2, 1))
    m["elements"] = [PT([u, y, v]) for u, v in prof for y in (y0, y1)]


@model_for("AC39", "AC40", "AC41", "AC42", "AC43")
def _mgap(z, P, m, cat):
    A_, B_ = P["A"], P["B"]
    op = P["op"]
    if z["id"] in ("AC39", "AC40", "AC41"):
        dl = nominal(P["delta"])
        sign = -1 if z["id"] == "AC41" else 1
        chk(m, "param delta == nominal offset between A's end and B's start", sign * (nominal(B_[0][0]) - nominal(A_[1][0])) == dl)
    box_model(m, {"A": A_, "B": B_}, op, e9mm, "e9")


@model_for("AC46")
def _m46(z, P, m, cat):
    X, plate, slot = P["X"], P["plate"], P["slot"]
    lit(m, P, "op", "SUBTRACTION")
    chk(m, "plate starts at X", plate[0][0] == X)
    chk(m, "slot through the plate thickness and inside it", nominal(slot[0][2]) < plate[0][2] and nominal(slot[1][2]) > plate[1][2]
        and plate[0][0] < nominal(slot[0][0]) and nominal(slot[1][0]) < plate[1][0] and plate[0][1] < slot[0][1] and slot[1][1] < plate[1][1])
    cells, B = box_model(m, {"plate": plate, "slot": slot}, "SUBTRACTION", e9mm, "e9")
    xc = (B["slot"][0][0] + B["slot"][1][0]) / 2
    chk(m, "E9 probe x within 1e-10 mm of the E9 slot centre (probe measured at the centre)", abs(e9mm(X + 8) - xc) < Fraction(1, 10 ** 10), f"{float(e9mm(X + 8) - xc)!r}")

    def probe(d):
        p = [e9mm(v) for v in d["point"]]
        if nominal(d["point"][0]) == X + 8:
            p[0] = xc
        return mp.sqrt(num(min(dist_point_box(p, lo, hi) for lo, hi in cells.values()))), "e9"
    m["fn"]["probeDistance"] = probe


@model_for("AC44")
def _m44(z, P, m, cat):
    C1, C2 = P["C1"], P["C2"]
    lit(m, P, "op", "UNION")
    chk(m, "centres on local y = 0, same z range", C1["center"][1] == 0 and C2["center"][1] == 0 and C1["z"] == C2["z"])
    two_cylinders(m, C1, C2)
    gap = e9mm(C2["center"][0]) - e9mm(C1["center"][0]) - e9mm(C1["r"]) - e9mm(C2["r"])
    m["fn"]["bodyDistance"] = lambda d: ((gap, "e9exact") if in_cyl(d["bodyA"], C1) and in_cyl(d["bodyB"], C2) else (None, "body points"))


@model_for("AC45")
def _m45(z, P, m, cat):
    segs, d = P["segments"], P["depth"]
    chk(m, "consecutive segments share endpoints", all(segs[i][1] == segs[i + 1][0] for i in range(len(segs) - 1)))
    chk(m, "loop open in the nominal values", segs[-1][1] != segs[0][0])
    xs = [nominal(p[0]) for s in segs for p in s]
    ys = [nominal(p[1]) for s in segs for p in s]
    for o in z["expected"]["outcomes"]:
        ocf = o.get("closedForm")
        if isinstance(ocf, dict) and ocf.get("bbox"):
            loc = ocf["bbox"]["local"]
            chk(m, f"{o['id']} closed box = segment extents x depth", [Fraction(str(v)) for v in loc["min"]] == [min(xs), min(ys), 0]
                and [Fraction(str(v)) for v in loc["max"]] == [max(xs), max(ys), d])
    m["route"] = "none (refusal for the exact class)"


@model_for("AC49")
def _m49(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = P["plate"]
    ho, c = P["hole"], P["chamfer"]
    lit(m, P, "op", "SUBTRACTION")
    lit(m, P, "select", {"plane": f"local z = {z1}", "lineEdges": "parallel to local x", "circleEdges": "all"})
    (hx, hy), r, hz = ho["center"], ho["radius"], ho["z"]
    rc = r + c
    chk(m, "bore through", hz[0] < z0 and hz[1] > z1)
    chk(m, "countersink clear of the chamfers and plate ends", y0 + c < hy - rc and hy + rc < y1 - c and x0 < hx - rc and hx + rc < x1)
    hexp = [[y0, z0], [y1, z0], [y1, z1 - c], [y1 - c, z1], [y0 + c, z1], [y0, z1 - c]]
    hexl = [poly_loop(hexp)]
    Vh, Ah, _ = prism(hexl, x1 - x0)
    rev = [poly_loop([[0, z0], [r, z0], [r, z1 - c], [rc, z1], [0, z1]])]
    Vr, Ar = revolve(rev, 2 * sp.pi)
    m["V"] = Vh - Vr
    m["A"] = Ah + Ar - 2 * (sp.pi * r ** 2 + sp.pi * rc ** 2)
    verts = [[x, u, v] for x in (x0, x1) for u, v in hexp]
    chk(m, "hexagonal-prism vertices outside the bore and countersink (bbox route valid)", all((x - hx) ** 2 + (u - hy) ** 2 > rc ** 2 for x, u, _ in verts))
    m["solid"] = [("prism", hexl, x0, x1, (1, 2, 0))]
    m["elements"] = [PT(p) for p in verts]
    Rm = min(hy - (y0 + c), (y1 - c) - hy, hx - x0, x1 - hx)
    near = [poly_loop([[r, z0], [Rm, z0], [Rm, z1], [rc, z1], [r, z1 - c]])]

    def foot_hex(p):
        """Nearest point of the convex hexagonal prism (exact projection: polygon in (y, z), clamp in x)."""
        q = [num(p[1]), num(p[2])]
        if winding(q, hexl):
            f2 = q
        else:
            best = None
            for s in hexl[0]:
                a_, b_ = [num(v) for v in s[1]], [num(v) for v in s[2]]
                dd = [b_[0] - a_[0], b_[1] - a_[1]]
                t = min(max(((q[0] - a_[0]) * dd[0] + (q[1] - a_[1]) * dd[1]) / (dd[0] ** 2 + dd[1] ** 2), 0), 1)
                f = [a_[0] + t * dd[0], a_[1] + t * dd[1]]
                dist = (q[0] - f[0]) ** 2 + (q[1] - f[1]) ** 2
                if best is None or dist < best[0]:
                    best = (dist, f)
            f2 = best[1]
        return [min(max(num(p[0]), num(x0)), num(x1)), f2[0], f2[1]]

    def probe(d):
        p = mpv(d["point"])
        f = foot_hex(p)
        if mp.sqrt((f[0] - hx) ** 2 + (f[1] - hy) ** 2) > rc:
            return mp.sqrt(sum((p[i] - f[i]) ** 2 for i in range(3))), "numeric"
        if p[0] == hx and p[1] == hy:
            dv = dist2d([0, p[2]], near)
            return (dv, "numeric") if dv < Rm else (None, "nearest point beyond the axis neighbourhood")
        return None, "foot inside the bore neighbourhood and point off the axis: no route"
    m["fn"]["probeDistance"] = probe


# ------------------------------------------------------------------ extension zones (holes-a: AC61, AC63, AC64, AC65)
# Second routes, independent of the catalog's hand expressions: the pipe is a
# revolved profile (Pappus, exact); a blind pocket and a drilled L-block are
# stacked z-prisms whose shared interface is subtracted twice (exact); the
# cross-bored block integrates its z-slices (mpmath quadrature) for the volume
# and takes a z-prism plus the x-bore's own faces for the area. V4 re-runs the
# same model on construction.paramsByVariant.V4 (see check_v4).
def z_layers_model(m, layers):
    """Solid = z-stacked prisms [(loops, z0, z1)]; each upper section lies inside the section below it."""
    V, A, sections = 0, 0, []
    for loops, z0, z1 in layers:
        v, a, s = prism(loops, sp.sympify(z1) - sp.sympify(z0))
        V, A = V + v, A + a
        sections.append(s)
    for s in sections[1:]:
        A -= 2 * s  # the glued interface is the upper section, counted by both prisms
    m["V"], m["A"] = sp.simplify(V), sp.simplify(A)
    m["solid"] = [("prism", loops, z0, z1, (0, 1, 2)) for loops, z0, z1 in layers]
    m["fn"]["probeDistance"] = lambda d: (min(dist_prism(d["point"], loops, z0, z1) for loops, z0, z1 in layers), "numeric")


def axis_of(p0, p1):
    """Coordinate axis index of a catalog cylinder p0 -> p1, or None when it is not axis-parallel."""
    moving = [i for i in range(3) if R_(p0[i]) != R_(p1[i])]
    return moving[0] if len(moving) == 1 else None


def bore(spec):
    """(axis, lo, hi, centre in the other two axes, radius) of an axis-parallel catalog cylinder."""
    ax = axis_of(spec["p0"], spec["p1"])
    if ax is None:
        return None
    o = [i for i in range(3) if i != ax]
    lo, hi = sorted([R_(spec["p0"][ax]), R_(spec["p1"][ax])])
    return ax, lo, hi, (R_(spec["p0"][o[0]]), R_(spec["p0"][o[1]])), R_(spec["radius"])


def bore_through_box(b, lo, hi):
    ax, a0, a1, (c0, c1), r = b
    o = [i for i in range(3) if i != ax]
    return a0 < lo[ax] and a1 > hi[ax] and lo[o[0]] < c0 - r and c0 + r < hi[o[0]] and lo[o[1]] < c1 - r and c1 + r < hi[o[1]]


def dist_box_minus_bores(p, lo, hi, bores):
    """Distance from a point inside the closed box to (box minus open through-bores); None when out of scope."""
    q = mpv(p)
    if not all(num(lo[i]) <= q[i] <= num(hi[i]) for i in range(3)):
        return None, "probe outside the box: no route"
    radial = []
    for ax, _, _, c, r in bores:
        o = [i for i in range(3) if i != ax]
        u = [q[o[0]] - num(c[0]), q[o[1]] - num(c[1])]
        radial.append((ax, o, c, num(r), u, mp.sqrt(u[0] ** 2 + u[1] ** 2)))
    inside = [b for b in radial if b[5] < b[3]]
    if not inside:
        return mp.mpf(0), "numeric"
    if len(inside) > 1:
        return None, "probe inside two bores: no route"
    ax, o, c, r, u, rho = inside[0]

    def material(w):
        return all(num(lo[i]) <= w[i] <= num(hi[i]) for i in range(3)) and all(
            mp.sqrt((w[b[1][0]] - num(b[2][0])) ** 2 + (w[b[1][1]] - num(b[2][1])) ** 2) >= b[3] for b in radial if b is not inside[0])
    directions = [[u[0] / rho, u[1] / rho]] if rho > 0 else [[mp.cos(2 * mp.pi * k / 720), mp.sin(2 * mp.pi * k / 720)] for k in range(720)]
    for d in directions:
        w = list(q)
        w[o[0]], w[o[1]] = num(c[0]) + r * d[0], num(c[1]) + r * d[1]
        if material(w):
            return r - rho, "numeric"
    return None, "no wall point of the enclosing bore is material"


@model_for("AC61")
def _m61(z, P, m, cat):
    outer, inner = bore(P["outer"]), bore(P["inner"])
    chk(m, "both cylinders along local z", outer is not None and inner is not None and outer[0] == 2 and inner[0] == 2)
    (_, z0, z1, co, ro), (_, w0, w1, ci, ri) = outer, inner
    chk(m, "coaxial, inner radius below outer radius", co == ci and 0 < ri < ro, f"{co} {ci} r {ri} < {ro}")
    chk(m, "bore open at both ends (inner overhangs both caps)", w0 < z0 and w1 > z1)
    chk(m, "axis through the local origin", co == (0, 0))
    loops = [rect_loop(ri, z0, ro, z1)]
    revolve_model(m, loops)
    m["elements"] = [CIRCLE([0, 0, zz], [0, 0, 1], ro) for zz in (z0, z1)]


@model_for("AC63")
def _m63(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = [[R_(v) for v in c] for c in P["box"]]
    h = bore(P["hole"])
    chk(m, "hole along local z", h is not None and h[0] == 2)
    _, h0, h1, (cx, cy), r = h
    chk(m, "blind: floor inside the box, mouth opens through the top face", z0 < h0 < z1 < h1)
    chk(m, "hole inside the box footprint", x0 < cx - r and cx + r < x1 and y0 < cy - r and cy + r < y1)
    z_layers_model(m, [([rect_loop(x0, y0, x1, y1)], z0, h0), ([rect_loop(x0, y0, x1, y1), circle_loop(cx, cy, r, cw=True)], h0, z1)])
    m["elements"] = box_pts([x0, y0, z0], [x1, y1, z1])


@model_for("AC64")
def _m64(z, P, m, cat):
    lo, hi = [[R_(v) for v in c] for c in P["box"]]
    bores = [bore(h) for h in P["holes"]]
    chk(m, "one bore along local z, one along local x", [b and b[0] for b in bores] == [2, 0])
    chk(m, "both bores through the box, inside its faces", all(bore_through_box(b, lo, hi) for b in bores))
    (_, _, _, (zx, zy), rz), (_, _, _, (xy, xz), rx) = bores
    chk(m, "bores disjoint: skew axes farther apart than the radii", abs(xy - zy) > rz + rx, f"{abs(xy - zy)} > {rz + rx}")
    W, D, H = (hi[i] - lo[i] for i in range(3))
    rzf, rxf, xzf = num(rz), num(rx), num(xz)

    def section(t):
        chord = 2 * mp.sqrt(rxf ** 2 - (t - xzf) ** 2) if abs(t - xzf) < rxf else mp.mpf(0)
        return num(W * D) - mp.pi * rzf ** 2 - num(W) * chord
    m["V"] = mp.quad(section, [num(lo[2]), xzf - rxf, xzf + rxf, num(hi[2])])
    _, Az, _ = prism([rect_loop(lo[0], lo[1], hi[0], hi[1]), circle_loop(zx, zy, rz, cw=True)], H)
    m["A"] = sp.simplify(Az - 2 * sp.pi * rx ** 2 + 2 * sp.pi * rx * W)
    m["route"] = "quad"
    m["solid"] = [("prism", [rect_loop(lo[0], lo[1], hi[0], hi[1])], lo[2], hi[2], (0, 1, 2))]
    m["elements"] = box_pts(lo, hi)
    m["fn"]["probeDistance"] = lambda d: dist_box_minus_bores(d["point"], lo, hi, bores)


@model_for("AC65")
def _m65(z, P, m, cat):
    boxes = P["boxes"]
    (ax0, ay0, az0), (ax1, ay1, az1) = [[R_(v) for v in c] for c in boxes["A"]]
    (wx0, wy0, wz0), (wx1, wy1, wz1) = [[R_(v) for v in c] for c in boxes["W"]]
    b = bore(P["bore"])
    chk(m, "bore along local z", b is not None and b[0] == 2)
    _, b0, b1, (cx, cy), r = b
    chk(m, "W stands on A's top face inside A's footprint", wz0 == az1 and ax0 <= wx0 < wx1 <= ax1 and ay0 <= wy0 < wy1 <= ay1)
    chk(m, "bore through A, inside A's footprint", b0 < az0 and b1 > az1 and ax0 < cx - r and cx + r < ax1 and ay0 < cy - r and cy + r < ay1)
    chk(m, "bore misses W (circle clear of W's footprint) and stays below W's top", (cx - r > wx1 or cx + r < wx0 or cy - r > wy1 or cy + r < wy0) and b1 < wz1)
    z_layers_model(m, [([rect_loop(ax0, ay0, ax1, ay1), circle_loop(cx, cy, r, cw=True)], az0, az1), ([rect_loop(wx0, wy0, wx1, wy1)], wz0, wz1)])
    m["elements"] = box_pts([ax0, ay0, az0], [ax1, ay1, az1]) + box_pts([wx0, wy0, wz0], [wx1, wy1, wz1])


# ------------------------------------------------------------------ extension zones (regions-a: AC52, AC53, AC56, AC57, AC91, AC92)
# Second routes, independent of the catalog's hand expressions: the sketch region
# arrangement is rebuilt from the parameters (circle crossings, the side of a split
# line, nested loops, rectangle crossings by 2-D coordinate compression), every
# region becomes its own boundary loop (arcs by polar angle range, lines by end
# points) integrated by Green's theorem (prism()), and every region point is
# classified exactly into the region it must select. Probe distances go to the
# union of the region prisms; bboxes come from rim circles/arcs (route A) and the
# region prisms (route B).
CLEARANCE = sp.Rational(1, 2)  # proposal section 8: features that do not touch on purpose keep >= 0.5 mm


def rect_regions(rects):
    """Regions of an arrangement of axis-aligned rectangles: cells of equal membership, joined across shared cell sides."""
    xs = sorted({x for r in rects for x in (r[0][0], r[1][0])})
    ys = sorted({y for r in rects for y in (r[0][1], r[1][1])})
    sig = {}
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            s = tuple(r[0][0] < cx < r[1][0] and r[0][1] < cy < r[1][1] for r in rects)
            if any(s):
                sig[(i, j)] = s
    parent = {c: c for c in sig}

    def find(c):
        while parent[c] != c:
            c = parent[c]
        return c
    for (i, j), s in sig.items():
        for nb in ((i + 1, j), (i, j + 1)):
            if sig.get(nb) == s:
                parent[find(nb)] = find((i, j))
    regions = {}
    for c in sig:
        regions.setdefault(find(c), []).append(c)
    out = []
    for cells in regions.values():
        own = set(cells)
        area = sum((xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]) for i, j in cells)
        per = 0
        for i, j in cells:
            w, h = xs[i + 1] - xs[i], ys[j + 1] - ys[j]
            per += sum(length for nb, length in (((i - 1, j), h), ((i + 1, j), h), ((i, j - 1), w), ((i, j + 1), w)) if nb not in own)
        out.append({"signature": sig[cells[0]], "cells": cells, "area": area, "perimeter": per,
                    "contains": lambda p, cells=cells: any(xs[i] < p[0] < xs[i + 1] and ys[j] < p[1] < ys[j + 1] for i, j in cells)})
    return out


def arc_angles(c, start, mid, end):
    """Polar angles (t0, t1), t0 < t1, of the CCW three-point arc start -> mid -> end about c; None when mid is not between."""
    ang = [sp.atan2(p[1] - c[1], p[0] - c[0]) for p in (start, mid, end)]
    sweep = lambda a, b: sp.Mod(b - a, 2 * sp.pi)
    if not sweep(ang[0], ang[1]) < sweep(ang[0], ang[2]):
        return None
    return ang[0], ang[0] + sweep(ang[0], ang[2])


def regions_prism_model(m, regions, depth):
    """Separate bodies, one prism per region loop set; probes go to the union."""
    V = Ar = 0
    for loops in regions:
        v, a, _ = prism(loops, depth)
        V, Ar = V + v, Ar + a
    m["V"], m["A"] = sp.simplify(V), sp.simplify(Ar)
    m["bodies"] = len(regions)
    m["solid"] = [("prism", loops, 0, depth, (0, 1, 2)) for loops in regions]
    m["fn"]["probeDistance"] = lambda d: (min(dist_prism(d["point"], loops, 0, depth) for loops in regions), "numeric")


@model_for("AC52")
def _m52(z, P, m, cat):
    c1, c2 = P["circles"]
    (x1, y1), (x2, y2) = [R_(v) for v in c1["center"]], [R_(v) for v in c2["center"]]
    r, r2 = R_(c1["radius"]), R_(c2["radius"])
    d = x2
    chk(m, "equal radii, centres on local x symmetric about x = 0", r == r2 and y1 == y2 == 0 and x1 == -x2 and d > 0)
    chk(m, "circles cross, neither contains the other: 0 < d < r (half centre distance d)", 0 < d < r)
    th = sp.acos(d / r)
    C1, C2 = (x1, 0), (x2, 0)
    regions = {"lens": [[A(C1, r, -th, th), A(C2, r, sp.pi - th, sp.pi + th)]],
               "left": [[A(C1, r, th, 2 * sp.pi - th), A(C2, r, sp.pi + th, sp.pi - th)]],
               "right": [[A(C2, r, th - sp.pi, sp.pi - th), A(C1, r, th, -th)]]}
    pts = P["regionPoints"]
    inside = lambda p, c: (R_(p[0]) - c[0]) ** 2 + (R_(p[1]) - c[1]) ** 2 < r ** 2
    sig = {"lens": (True, True), "left": (True, False), "right": (False, True)}
    chk(m, "every region point lies strictly inside its region (lens in both discs, crescents in one)",
        set(pts) == set(sig) and all((inside(pts[k], C1), inside(pts[k], C2)) == sig[k] for k in sig), str(pts))
    regions_prism_model(m, list(regions.values()), P["depth"])
    m["elements"] = [CIRCLE([cx, 0, zz], [0, 0, 1], r) for cx in (x1, x2) for zz in (0, P["depth"])]


@model_for("AC53")
def _m53(z, P, m, cat):
    (cx, cy), r = [R_(v) for v in P["circle"]["center"]], R_(P["circle"]["radius"])
    (ax, ay), (bx, by) = [[R_(v) for v in p] for p in P["line"]]
    chk(m, "line is the horizontal diameter through the centre", ay == by == cy and ax < cx < bx)
    chk(m, "line overhangs the circle at both ends by >= 0.5 (dangling ends bound no region)", ax <= cx - r - CLEARANCE and bx >= cx + r + CLEARANCE)
    px, py = [R_(v) for v in P["regionPoint"]]
    chk(m, "region point strictly inside the upper half disc", py > cy and (px - cx) ** 2 + (py - cy) ** 2 < r ** 2)
    depth = P["depth"]
    regions_prism_model(m, [[[L((cx - r, cy), (cx + r, cy)), A((cx, cy), r, 0, sp.pi)]]], depth)
    m["elements"] = [ARC([cx, cy, zz], [r, 0, 0], [0, r, 0], 0, mp.pi) for zz in (0, depth)]


@model_for("AC56")
def _m56(z, P, m, cat):
    (ox0, oy0), (ox1, oy1) = [[R_(v) for v in p] for p in P["outer"]]
    (ix0, iy0), (ix1, iy1) = [[R_(v) for v in p] for p in P["inner"]]
    chk(m, "inner loop strictly inside the outer loop, walls >= 0.5", ox0 + CLEARANCE <= ix0 < ix1 <= ox1 - CLEARANCE and oy0 + CLEARANCE <= iy0 < iy1 <= oy1 - CLEARANCE)
    depth = P["depth"]
    regions_prism_model(m, [[rect_loop(ox0, oy0, ox1, oy1), rect_loop(ix0, iy0, ix1, iy1, cw=True)]], depth)
    m["elements"] = box_pts([ox0, oy0, 0], [ox1, oy1, depth])


@model_for("AC57")
def _m57(z, P, m, cat):
    (x0, y0), (x1, y1) = [[R_(v) for v in p] for p in P["rectangle"]]
    centers, r = [[R_(v) for v in c] for c in P["holes"]["centers"]], R_(P["holes"]["radius"])
    depth = P["depth"]
    chk(m, "bores inside the plate, walls >= 0.5", all(x0 + r + CLEARANCE <= cx <= x1 - r - CLEARANCE and y0 + r + CLEARANCE <= cy <= y1 - r - CLEARANCE for cx, cy in centers))
    chk(m, "bores disjoint, gaps >= 0.5", all(sp.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) >= 2 * r + CLEARANCE for i, a in enumerate(centers) for b in centers[i + 1:]))
    t0, t1 = [R_(v) for v in P["v5ToolZ"]]
    chk(m, "V5 cylinders overhang both plate faces", t0 < 0 and t1 > depth)
    regions_prism_model(m, [[rect_loop(x0, y0, x1, y1)] + [circle_loop(cx, cy, r, cw=True) for cx, cy in centers]], depth)
    m["elements"] = box_pts([x0, y0, 0], [x1, y1, depth])


@model_for("AC91")
def _m91(z, P, m, cat):
    arcs, lines, hole, depth = P["arcs"], P["lines"], P["hole"], P["depth"]
    pts = lambda a: [[R_(v) for v in a[k]] for k in ("start", "mid", "end", "center")] + [R_(a["radius"])]
    segs, spans = [], []
    for a in arcs:
        s, mid, e, c, r = pts(a)
        chk(m, f"arc through {a['start']} {a['mid']} {a['end']} lies on its circle", all((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 == r ** 2 for p in (s, mid, e)))
        span = arc_angles(c, s, mid, e)
        chk(m, f"arc about {a['center']} runs counter-clockwise through its mid point", span is not None)
        segs.append((s, e, c, r, span))
    ls = [[[R_(v) for v in p] for p in ln] for ln in lines]
    chain = [segs[0][1] == ls[0][0], ls[0][1] == segs[1][0], segs[1][1] == ls[1][0], ls[1][1] == segs[0][0]]
    chk(m, "arc, line, arc, line close one loop", all(chain))
    tangent = []
    # line 0 runs from the end of arc 0 to the start of arc 1, line 1 from arc 1 back to arc 0
    for (p, q), (arc_at_p, arc_at_q) in zip(ls, ((segs[0], segs[1]), (segs[1], segs[0]))):
        for pt, arc in ((p, arc_at_p), (q, arc_at_q)):
            c = arc[2]
            tangent.append((q[0] - p[0]) * (pt[0] - c[0]) + (q[1] - p[1]) * (pt[1] - c[1]) == 0)
    chk(m, "lines meet the arcs tangentially (line direction perpendicular to the radius), exactly", all(tangent))
    (hx, hy), hr = [R_(v) for v in hole["center"]], R_(hole["radius"])
    c0, r0 = segs[0][2], segs[0][3]
    chk(m, "hole inside the left round end with a wall >= 0.5", sp.sqrt((hx - c0[0]) ** 2 + (hy - c0[1]) ** 2) + hr + CLEARANCE <= r0)
    t0, t1 = [R_(v) for v in P["v5ToolZ"]]
    chk(m, "V5 cylinder overhangs both faces", t0 < 0 and t1 > depth)
    if not all(s[4] is not None for s in segs):
        return
    loop = [A(segs[0][2], segs[0][3], *segs[0][4]), L(*ls[0]), A(segs[1][2], segs[1][3], *segs[1][4]), L(*ls[1])]
    regions_prism_model(m, [[loop, circle_loop(hx, hy, hr, cw=True)]], depth)
    m["elements"] = [ARC([s[2][0], s[2][1], zz], [s[3], 0, 0], [0, s[3], 0], num(s[4][0]), num(s[4][1])) for s in segs for zz in (0, depth)]


@model_for("AC92")
def _m92(z, P, m, cat):
    rects = [[[R_(v) for v in p] for p in rc] for rc in P["rectangles"]]
    regs = rect_regions(rects)
    pts = {k: [R_(v) for v in p] for k, p in P["regionPoints"].items()}
    hits = {k: [i for i, rg in enumerate(regs) if rg["contains"](p)] for k, p in pts.items()}
    chk(m, "every region point selects exactly one region, all regions distinct and covered",
        all(len(h) == 1 for h in hits.values()) and sorted(h[0] for h in hits.values()) == list(range(len(regs))), str(hits))
    chk(m, "the overlap is its own region (membership in both rectangles)", any(all(rg["signature"]) for rg in regs))
    depth = R_(P["depth"])
    m["V"] = sum(rg["area"] for rg in regs) * depth
    m["A"] = sum(2 * rg["area"] + rg["perimeter"] * depth for rg in regs)
    m["bodies"] = len(regs)
    loops = [[rect_loop(r[0][0], r[0][1], r[1][0], r[1][1])] for r in rects]
    m["solid"] = [("prism", lp, 0, depth, (0, 1, 2)) for lp in loops]
    m["fn"]["probeDistance"] = lambda d: (min(dist_prism(d["point"], lp, 0, depth) for lp in loops), "numeric")
    m["elements"] = [e for r in rects for e in box_pts([r[0][0], r[0][1], 0], [r[1][0], r[1][1], depth])]


# ------------------------------------------------------------------ extension zones, Batch A chunk 2
# regions-a AC93 AC95 AC99, holes-a AC51, shapes-a AC60 AC96. Second routes: regions are
# rebuilt from the parameters (the chord's two halves, the one rectangle holding the point),
# polygon corners are evaluated exactly in sympy from the construction's own expressions
# (h = 6/sqrt(3), cos/sin of k*pitch) and integrated by Green's theorem; the binary64 corner
# payload the FeatureScript interpreter builds (sqrt, cos, sin in f64, times millimeter) is
# integrated separately by the shoelace formula in Fractions and must agree to 1e-12.
def fs_mm(x):
    """A binary64 length as `x * millimeter` stores it (SI payload), back in exact mm."""
    return Fraction(float(x) * 0.001) * 1000


def shoelace(pts):
    return sum(Fraction(pts[i][0]) * Fraction(pts[(i + 1) % len(pts)][1]) - Fraction(pts[(i + 1) % len(pts)][0]) * Fraction(pts[i][1]) for i in range(len(pts))) / 2


def polygon_premises(m, pts, label):
    """Simple polygon, counter-clockwise, edges >= 0.5: corners strictly increasing in polar angle about the origin."""
    ang = [sp.atan2(p[1], p[0]) % (2 * sp.pi) for p in pts]
    chk(m, f"{label}: corners strictly counter-clockwise around the centre (star-shaped, simple)", all(num(ang[i]) < num(ang[i + 1]) for i in range(len(ang) - 1)))
    chk(m, f"{label}: every edge >= 0.5", all(num(sp.sqrt((pts[i][0] - pts[(i + 1) % len(pts)][0]) ** 2 + (pts[i][1] - pts[(i + 1) % len(pts)][1]) ** 2)) >= num(CLEARANCE) for i in range(len(pts))))


def edge_line_distance(pts):
    """Smallest distance from the origin to the carrier line of any polygon edge: a lower bound for the distance to the
    outline (for the star the feet lie beyond the roots, so the outline points nearest the centre are the roots)."""
    return min(num(abs(a[0] * b[1] - a[1] * b[0]) / sp.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)) for a, b in zip(pts, pts[1:] + pts[:1]))


def payload_check(m, exact_pts, payload_pts, label):
    ex, pl = num(sp.Abs(loop_area_perimeter(poly_loop(exact_pts))[0])), num(abs(shoelace(payload_pts)))
    chk(m, f"{label}: binary64 corner payload area (Fraction shoelace) equals the nominal area to 1e-12", close(pl, ex, rel=1e-12), f"{mp.nstr(pl, 20)} vs {mp.nstr(ex, 20)}")


def star_corners(S):
    n, pitch = S["points"], R_(S["pitchDeg"])
    tip, root = R_(S["tipRadius"]), R_(S["rootRadius"])
    radius = lambda k: tip if (k % 2 == 0) == S["tipsAtEvenIndex"] else root
    exact = [(radius(k) * sp.cos(sp.pi * pitch * k / 180), radius(k) * sp.sin(sp.pi * pitch * k / 180)) for k in range(n)]
    # FS: rr * cos(i * 15 * degree) -> f64 (i*15)*(pi/180), cos, product; then * millimeter
    payload = [(fs_mm(float(radius(k)) * math.cos((k * float(pitch)) * (math.pi / 180))), fs_mm(float(radius(k)) * math.sin((k * float(pitch)) * (math.pi / 180)))) for k in range(n)]
    return exact, payload, tip, root, pitch


def star_premises(m, S):
    exact, payload, tip, root, pitch = star_corners(S)
    chk(m, "star: even corner count closing the full turn (points * pitch = 360)", S["points"] % 2 == 0 and S["points"] * pitch == 360)
    chk(m, "star: roots are reflex corners (root < tip*cos(pitch), non-convex), root > 0", 0 < root < tip * sp.cos(sp.pi * pitch / 180))
    polygon_premises(m, exact, "star")
    payload_check(m, exact, payload, "star")
    return exact


@model_for("AC93")
def _m93(z, P, m, cat):
    (x0, y0), (x1, y1) = [[R_(v) for v in p] for p in P["rectangle"]]
    (ax, ay), (bx, by) = [[R_(v) for v in p] for p in P["line"]]
    chk(m, "line parallel to local y, strictly inside the rectangle, regions >= 0.5 wide", ax == bx and x0 + CLEARANCE <= ax <= x1 - CLEARANCE)
    chk(m, "line crosses both long edges and overhangs each by >= 0.5 (dangling ends bound no region)", min(ay, by) <= y0 - CLEARANCE and max(ay, by) >= y1 + CLEARANCE)
    halves = {"left": (x0, ax), "right": (ax, x1)}
    pts = P["regionPoints"]
    chk(m, "one region point strictly inside each half", set(pts) == set(halves) and all(a < R_(pts[k][0]) < b and y0 < R_(pts[k][1]) < y1 for k, (a, b) in halves.items()), str(pts))
    depth = P["depth"]
    regions_prism_model(m, [[rect_loop(a, y0, b, y1)] for a, b in halves.values()], depth)
    m["elements"] = box_pts([x0, y0, 0], [x1, y1, depth])


@model_for("AC95")
def _m95(z, P, m, cat):
    H, hole, depth = P["hexagon"], P["hole"], P["depth"]
    h = sp.sympify(H["h"])
    corners = [[sp.sympify(str(v), locals={"h": h}) for v in c] for c in H["corners"]]
    hf = 6 / math.sqrt(3) if H["h"] == "6/sqrt(3)" else None  # FS: const h = 6 / sqrt(3)
    chk(m, "h is written 6/sqrt(3) (the payload route evaluates that expression in binary64)", hf is not None, H["h"])
    payload = [tuple(fs_mm(eval(str(v), {"__builtins__": {}}, {"h": hf})) for v in c) for c in H["corners"]] if hf else []
    a = R_(H["apothem"])
    chk(m, "regular hexagon: six equal sides, every edge carrier at the apothem from the centre",
        len(corners) == 6 and len({sp.nsimplify(sp.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2)) for p, q in zip(corners, corners[1:] + corners[:1])}) == 1
        and all(sp.simplify(sp.Abs(p[0] * q[1] - p[1] * q[0]) / sp.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2) - a) == 0 for p, q in zip(corners, corners[1:] + corners[:1])))
    polygon_premises(m, corners, "hexagon")
    if payload:
        payload_check(m, corners, payload, "hexagon")
    v5 = H["v5Corners"]
    R5 = sp.sympify(v5["circumradius"])
    alt = [(R5 * sp.cos(sp.pi * (R_(v5["firstAngleDeg"]) + k * R_(v5["stepDeg"])) / 180), R5 * sp.sin(sp.pi * (R_(v5["firstAngleDeg"]) + k * R_(v5["stepDeg"])) / 180)) for k in range(6)]
    chk(m, "V5 cos/sin corners equal the V0 corners exactly", all(sp.simplify(p[i] - q[i]) == 0 for p, q in zip(alt, corners) for i in (0, 1)))
    (cx, cy), r = [R_(v) for v in hole["center"]], R_(hole["radius"])
    chk(m, "bore centred, wall to every flat >= 0.5", (cx, cy) == (0, 0) and a - r >= CLEARANCE)
    regions_prism_model(m, [[poly_loop(corners), circle_loop(cx, cy, r, cw=True)]], depth)
    m["elements"] = [PT([p[0], p[1], zz]) for p in corners for zz in (0, depth)]


@model_for("AC99")
def _m99(z, P, m, cat):
    rects = [[[R_(v) for v in p] for p in rc] for rc in P["rectangles"]]
    (a0, a1), (b0, b1) = rects
    chk(m, "two rectangles, disjoint with a gap >= 0.5 (two separate regions, no crossing)", max(b0[0] - a1[0], a0[0] - b1[0], b0[1] - a1[1], a0[1] - b1[1]) >= CLEARANCE)
    px, py = [R_(v) for v in P["regionPoint"]]
    inside = [r[0][0] < px < r[1][0] and r[0][1] < py < r[1][1] for r in rects]
    chk(m, "region point strictly inside exactly one rectangle (so qContainsPoint and qClosestTo pick the same region)", inside.count(True) == 1)
    (lo, hi) = rects[inside.index(True)] if True in inside else rects[0]
    depth = P["depth"]
    regions_prism_model(m, [[rect_loop(lo[0], lo[1], hi[0], hi[1])]], depth)
    m["elements"] = box_pts([lo[0], lo[1], 0], [hi[0], hi[1], depth])


@model_for("AC96")
def _m96(z, P, m, cat):
    corners = star_premises(m, P["star"])
    depth = P["depth"]
    regions_prism_model(m, [[poly_loop(corners)]], depth)
    m["elements"] = [PT([p[0], p[1], zz]) for p in corners for zz in (0, depth)]


@model_for("AC51")
def _m51(z, P, m, cat):
    corners = star_premises(m, P["star"])
    depth, b = P["depth"], bore(P["bore"])
    chk(m, "bore along local z through both faces", b is not None and b[0] == 2 and b[1] < 0 and b[2] > R_(depth))
    _, _, _, (cx, cy), r = b
    chk(m, "bore coaxial with the star centre, wall to every flank >= 0.5 (flank carrier lines as a lower bound)",
        (cx, cy) == (0, 0) and edge_line_distance(corners) - num(r) >= num(CLEARANCE),
        f"flank carrier lines {mp.nstr(edge_line_distance(corners), 12)} - r {r}")
    prism_model(m, [poly_loop(corners), circle_loop(cx, cy, r, cw=True)], 0, depth)
    m["elements"] = [PT([p[0], p[1], zz]) for p in corners for zz in (0, depth)]


@model_for("AC60")
def _m60(z, P, m, cat):
    lo, hi = [[R_(v) for v in c] for c in P["box"]]
    bores = [bore(h) for h in P["holes"]]
    chk(m, "every bore along local z, through both faces", all(b is not None and b[0] == 2 and b[1] < lo[2] and b[2] > hi[2] for b in bores))
    chk(m, "bores inside the plate footprint with walls >= 0.5", all(lo[0] + CLEARANCE <= b[3][0] - b[4] and b[3][0] + b[4] <= hi[0] - CLEARANCE and lo[1] + CLEARANCE <= b[3][1] - b[4] and b[3][1] + b[4] <= hi[1] - CLEARANCE for b in bores))
    chk(m, "bores pairwise disjoint, gaps >= 0.5", all(sp.sqrt((p[3][0] - q[3][0]) ** 2 + (p[3][1] - q[3][1]) ** 2) >= p[4] + q[4] + CLEARANCE for i, p in enumerate(bores) for q in bores[i + 1:]))
    prism_model(m, [rect_loop(lo[0], lo[1], hi[0], hi[1])] + [circle_loop(b[3][0], b[3][1], b[4], cw=True) for b in bores], lo[2], hi[2])
    m["fn"]["probeDistance"] = lambda d: dist_box_minus_bores(d["point"], lo, hi, bores)
    m["elements"] = box_pts(lo, hi)


# ------------------------------------------------------------------ extension zones, Batch A chunk 3
# holes-a AC62 AC67 AC68 AC71 AC75, shapes-a AC72. Second routes: every solid is cut into z-slabs
# whose cross-sections are rebuilt from the parameters (the tool footprints in each slab: bore
# circles, the hexagon, the slot notch, the pattern copies as seed + translation) and integrated by
# Green's theorem; the area adds each slab's prism area and removes, at every slab interface, twice
# the section they share (the smaller section, which must lie inside the larger). The revolve goes
# through Pappus on its profile. The hexagon's binary64 corner payload is integrated separately
# (shoelace in Fractions, 1e-12). Probes go to the union of the slab prisms (or the profile).
def section_inside(inner, outer):
    """Every boundary sample of the inner section lies in the closed outer section (winding + boundary distance)."""
    pts = []
    for loop in inner:
        for seg in loop:
            if seg[0] == "L":
                a, b = [num(v) for v in seg[1]], [num(v) for v in seg[2]]
                pts += [[a[0] + (b[0] - a[0]) * k / 8, a[1] + (b[1] - a[1]) * k / 8] for k in range(8)]
            elif seg[0] == "B":
                cx, cy = bez_mp(seg)
                pts += [[mp_poly(cx, mp.mpf(k) / 32), mp_poly(cy, mp.mpf(k) / 32)] for k in range(32)]
            else:
                c, r, t0, t1 = [num(v) for v in seg[1]], num(seg[2]), num(seg[3]), num(seg[4])
                pts += [[c[0] + r * mp.cos(t0 + (t1 - t0) * k / 64), c[1] + r * mp.sin(t0 + (t1 - t0) * k / 64)] for k in range(64)]
    return all(winding(p, outer) or min(seg_dist(p, s) for lp in outer for s in lp) < mp.mpf("1e-30") for p in pts)


def z_slabs_model(m, slabs):
    """Solid = z-stacked prisms [(loops, z0, z1)] glued face to face; at each interface the shared section is the
    smaller one, contained in the larger (checked), and counts twice in the prism areas."""
    V, A, secs = 0, 0, []
    for loops, z0, z1 in slabs:
        v, a, s = prism(loops, sp.sympify(z1) - sp.sympify(z0))
        V, A = V + v, A + a
        secs.append((loops, s))
    for (lo_loops, lo_s), (up_loops, up_s), (_, _, z_lo1), (_, z_up0, _) in zip(secs, secs[1:], slabs, slabs[1:]):
        chk(m, f"slabs glued at z = {z_up0}", sp.sympify(z_lo1) == sp.sympify(z_up0))
        small, large = (up_loops, lo_loops) if num(up_s) <= num(lo_s) else (lo_loops, up_loops)
        chk(m, f"slab interface z = {z_up0}: the smaller section lies inside the larger", section_inside(small, large))
        A -= 2 * min(lo_s, up_s, key=num)
    m["V"], m["A"] = sp.simplify(V), sp.simplify(A)
    m["solid"] = [("prism", loops, z0, z1, (0, 1, 2)) for loops, z0, z1 in slabs]
    m["fn"]["probeDistance"] = lambda d: (min(dist_prism(d["point"], loops, z0, z1) for loops, z0, z1 in slabs), "numeric")


def z_bore(m, spec, label):
    b = bore(spec)
    chk(m, f"{label} along local z", b is not None and b[0] == 2)
    return b


def disc_clear_of(m, label, c, r, rect):
    (x0, y0), (x1, y1) = rect
    chk(m, label, x0 + CLEARANCE <= c[0] - r and c[0] + r <= x1 - CLEARANCE and y0 + CLEARANCE <= c[1] - r and c[1] + r <= y1 - CLEARANCE, f"centre {c} r {r} in {rect}")


@model_for("AC62")
def _m62(z, P, m, cat):
    bar, b, hexp = z_bore(m, P["cylinder"], "bar"), z_bore(m, P["bore"], "bore"), P["hexPocket"]
    _, z0, z1, cb, R = bar
    _, w0, w1, cc, r = b
    h = sp.sympify(hexp["h"])
    corners = [[sp.sympify(str(v), locals={"h": h}) for v in c] for c in hexp["corners"]]
    a = R_(hexp["apothem"])
    chk(m, "h is written 5/sqrt(3) (the payload route evaluates that expression in binary64)", hexp["h"] == "5/sqrt(3)", hexp["h"])
    chk(m, "regular hexagon: six equal sides, every edge carrier at the apothem from the centre",
        len(corners) == 6 and len({sp.nsimplify(sp.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2)) for p, q in zip(corners, corners[1:] + corners[:1])}) == 1
        and all(sp.simplify(sp.Abs(p[0] * q[1] - p[1] * q[0]) / sp.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2) - a) == 0 for p, q in zip(corners, corners[1:] + corners[:1])))
    polygon_premises(m, corners, "hexagon")
    payload = [tuple(fs_mm(eval(str(v), {"__builtins__": {}}, {"h": 5 / math.sqrt(3)})) for v in c) for c in hexp["corners"]]
    payload_check(m, corners, payload, "hexagon")
    p0, p1 = [R_(v) for v in hexp["z"]]
    chk(m, "bar, bore and pocket coaxial on the local z axis", cb == cc == (0, 0))
    chk(m, "bore through both bar faces", w0 < z0 and w1 > z1)
    chk(m, "pocket floor inside the bar, pocket open through the top face", z0 < p0 < z1 < p1)
    chk(m, "bore inside the hexagon (wall to the flats >= 0.5): above the floor the pocket already removes it", a - r >= CLEARANCE, f"{a} - {r}")
    circum = max(sp.sqrt(p[0] ** 2 + p[1] ** 2) for p in corners)
    chk(m, "hexagon inside the bar with a wall >= 0.5", num(R - circum) >= num(CLEARANCE), f"R {R} - circumradius {sp.nsimplify(circum)}")
    hole_hex = poly_loop(corners[::-1])
    z_slabs_model(m, [([circle_loop(0, 0, R), circle_loop(0, 0, r, cw=True)], z0, p0), ([circle_loop(0, 0, R), hole_hex], p0, z1)])
    m["elements"] = [CIRCLE([0, 0, zz], [0, 0, 1], R) for zz in (z0, z1)]


@model_for("AC67")
def _m67(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = [[R_(v) for v in c] for c in P["plate"]]
    _, b0, b1, (cx, cy), R = z_bore(m, P["boss"], "boss")
    chk(m, "boss starts inside the plate and stands above its top face", z0 <= b0 < z1 < b1, f"{b0} {z1} {b1}")
    disc_clear_of(m, "boss footprint inside the plate with walls >= 0.5", (cx, cy), R, ((x0, y0), (x1, y1)))
    z_slabs_model(m, [([rect_loop(x0, y0, x1, y1)], z0, z1), ([circle_loop(cx, cy, R)], z1, b1)])
    m["elements"] = box_pts([x0, y0, z0], [x1, y1, z1]) + [CIRCLE([cx, cy, b1], [0, 0, 1], R)]


@model_for("AC68")
def _m68(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = [[R_(v) for v in c] for c in P["box"]]
    (sx0, sy0, sz0), (sx1, sy1, sz1) = [[R_(v) for v in c] for c in P["slot"]]
    _, w0, w1, (cx, cy), r = z_bore(m, P["bore"], "bore")
    chk(m, "bore through the box", w0 < z0 and w1 > z1)
    chk(m, "slot opens through the front face y = y0 (overhang >= 0.5) and ends inside the box (wall >= 0.5)", sy0 <= y0 - CLEARANCE and y0 < sy1 <= y1 - CLEARANCE)
    chk(m, "slot strictly inside the box in x and z (walls >= 0.5)", x0 + CLEARANCE <= sx0 < sx1 <= x1 - CLEARANCE and z0 + CLEARANCE <= sz0 < sz1 <= z1 - CLEARANCE)
    disc_clear_of(m, "bore crosses the slot inside its footprint (walls to the slot sides and end >= 0.5)", (cx, cy), r, ((sx0, y0), (sx1, sy1)))
    rect_minus_bore = [rect_loop(x0, y0, x1, y1), circle_loop(cx, cy, r, cw=True)]
    notch = [poly_loop([(x0, y0), (sx0, y0), (sx0, sy1), (sx1, sy1), (sx1, y0), (x1, y0), (x1, y1), (x0, y1)])]
    z_slabs_model(m, [(rect_minus_bore, z0, sz0), (notch, sz0, sz1), (rect_minus_bore, sz1, z1)])
    m["elements"] = box_pts([x0, y0, z0], [x1, y1, z1])


@model_for("AC71")
def _m71(z, P, m, cat):
    lo, hi = [[R_(v) for v in c] for c in P["box"]]
    seed = z_bore(m, P["seed"], "seed")
    moves = [[R_(v) for v in t] for t in P["pattern"]["translations"]]
    chk(m, "pattern translations in the local xy plane, none zero", all(t[2] == 0 and (t[0], t[1]) != (0, 0) for t in moves))
    ax, s0, s1, (cx, cy), r = seed
    bores = [seed] + [(ax, s0, s1, (cx + t[0], cy + t[1]), r) for t in moves]
    chk(m, "seed and copies through both faces", s0 < lo[2] and s1 > hi[2])
    for i, b in enumerate(bores):
        disc_clear_of(m, f"bore {i} inside the box footprint with walls >= 0.5", b[3], r, ((lo[0], lo[1]), (hi[0], hi[1])))
    chk(m, "seed and copies pairwise disjoint, gaps >= 0.5", all(sp.sqrt((p[3][0] - q[3][0]) ** 2 + (p[3][1] - q[3][1]) ** 2) >= 2 * r + CLEARANCE for i, p in enumerate(bores) for q in bores[i + 1:]))
    prism_model(m, [rect_loop(lo[0], lo[1], hi[0], hi[1])] + [circle_loop(b[3][0], b[3][1], r, cw=True) for b in bores], lo[2], hi[2])
    m["fn"]["probeDistance"] = lambda d: dist_box_minus_bores(d["point"], lo, hi, bores)
    m["elements"] = box_pts(lo, hi)


@model_for("AC75")
def _m75(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = [[R_(v) for v in c] for c in P["box"]]
    _, w0, w1, c1, r = z_bore(m, P["bore"], "bore")
    _, k0, k1, c2, R = z_bore(m, P["counterbore"], "counterbore")
    chk(m, "bore and counterbore coaxial", c1 == c2)
    chk(m, "bore through the box; counterbore from a shoulder inside the box through the top face", w0 < z0 and w1 > z1 and z0 < k0 < z1 < k1)
    chk(m, "shoulder width >= 0.5", R - r >= CLEARANCE, f"{R} - {r}")
    disc_clear_of(m, "counterbore inside the box footprint with walls >= 0.5", c2, R, ((x0, y0), (x1, y1)))
    rect = rect_loop(x0, y0, x1, y1)
    z_slabs_model(m, [([rect, circle_loop(c1[0], c1[1], r, cw=True)], z0, k0), ([rect, circle_loop(c2[0], c2[1], R, cw=True)], k0, z1)])
    m["elements"] = box_pts([x0, y0, z0], [x1, y1, z1])


@model_for("AC72")
def _m72(z, P, m, cat):
    lower, upper = P["lower"], P["upper"]
    R, r = R_(lower["radius"]), R_(upper["radius"])
    (a0, a1), (b0, b1) = [R_(v) for v in lower["z"]], [R_(v) for v in upper["z"]]
    chk(m, "full revolve", R_(P["angleDeg"]) == 360)
    chk(m, "stacked steps: the upper step starts where the lower ends", a0 < a1 == b0 < b1)
    chk(m, "stepped down: shoulder width >= 0.5, both radii > 0", R - r >= CLEARANCE and r > 0)
    prof = [(0, a0), (R, a0), (R, a1), (r, a1), (r, b1), (0, b1)]
    loop = poly_loop(prof)
    revolve_model(m, [loop])
    # Topology by a second route, from the profile (Euler-Poincare alone accepts e.g. F5 E4 V4 with no ring edges):
    # in a full revolve every profile edge off the axis sweeps one face, every profile point off the axis sweeps
    # one ring edge (closed; its vertex is dropped by the canonical convention), each face has one loop per
    # off-axis end of its profile edge, and a profile point on the axis is a singular point only where its
    # off-axis edge meets the axis obliquely (a cone apex, AC25); a perpendicular edge sweeps a planar disc,
    # whose centre is regular.
    sweeps = [(p, q) for p, q in zip(prof, prof[1:] + prof[:1]) if not (p[0] == 0 and q[0] == 0)]
    chk(m, "consecutive profile edges not collinear (each sweeps its own face)",
        all((q[0] - p[0]) * (t[1] - s[1]) != (q[1] - p[1]) * (t[0] - s[0]) for (p, q), (s, t) in zip(sweeps, sweeps[1:])))
    rims = [p for p in prof if p[0] != 0]
    apexes = [p for p in prof if p[0] == 0 and any(p in e and e[0][1] != e[1][1] for e in sweeps)]
    derived = {"faces": len(sweeps), "edges": len(rims), "ringEdges": len(rims), "vertices": 0,
               "loops": sum(1 for e in sweeps for q in e if q[0] != 0), "singularPoints": len(apexes)}
    declared = z["closedForm"].get("topology") or {}
    chk(m, "revolve topology from the profile (faces, ring edges, loops, no vertices, singular points only at oblique axis meets)",
        all(declared.get(k) == v for k, v in derived.items()), f"derived {derived}")
    m["elements"] = [CIRCLE([0, 0, zz], [0, 0, 1], rr) for zz, rr in ((a0, R), (a1, R), (a1, r), (b1, r))]


# ------------------------------------------------------------------ extension zones, Batch A chunk 4
# holes-a AC79 AC98, shapes-a AC77 AC81 AC84 AC89. Second routes: every result except the shell is a right prism
# over a profile rebuilt from the parameters (the L outline with the cutter square as a hole, the moved block with its
# bore, the L with the concave fillet arc, the box outline with its rounded corner, the rounded plate with four bore
# circles) and integrated by Green's theorem; its canonical topology is derived from the same loops (one side face
# per profile segment, a full circle giving a closed face with two ring edges) and must equal the declared one. The
# open-top shell is an exact box Boolean (outer box minus the cavity box through the removed face, as AC37).
SURFACE_OF = {"L": "Plane", "A": "Cylinder", "B": "SurfaceOfExtrusion"}  # extrusion of a profile piece, as OCCT names the face class


def surface_histogram(pieces):
    """Face-class histogram {class: count} of a list of profile pieces swept by an extrusion, plus extra (class) faces."""
    hist = {}
    for s in pieces:
        k = SURFACE_OF[s[0]] if isinstance(s, tuple) else s
        hist[k] = hist.get(k, 0) + 1
    return hist


def prism_topology(m, z, loops, label="prism"):
    """Canonical topology of a right prism over profile loops (outer CCW first, holes CW), compared with the declared one."""
    segs = [s for lp in loops for s in lp]
    full = [s for s in segs if s[0] == "A" and sp.Abs(s[4] - s[3]) == 2 * sp.pi]
    n = len(segs) - len(full)
    for lp in loops:
        if len(lp) < 2:
            continue
        pairs = list(zip(lp, lp[1:] + lp[:1]))
        chk(m, f"{label}: consecutive profile segments are distinct carriers (each sweeps its own face)",
            all(not (a[0] == b[0] == "L" and (a[2][0] - a[1][0]) * (b[2][1] - b[1][1]) == (a[2][1] - a[1][1]) * (b[2][0] - b[1][0]))
                and not (a[0] == b[0] == "A" and a[1] == b[1] and a[2] == b[2]) for a, b in pairs))
        chk(m, f"{label}: profile loop closed", all([sp.simplify(v) for v in seg_end(a)] == [sp.simplify(v) for v in seg_start(b)] for a, b in pairs))
    derived = {"faces": 2 + len(segs), "edges": 3 * n + 2 * len(full), "vertices": 2 * n, "ringEdges": 2 * len(full),
               "loops": 2 * len(loops) + n + 2 * len(full), "genus": len(loops) - 1, "singularPoints": 0}
    declared = z["closedForm"].get("topology") or {}
    chk(m, f"{label} topology from the profile loops (faces, edges, vertices, ring edges, loops, genus)", all(declared.get(k) == v for k, v in derived.items()), f"derived {derived}")
    if "surfaceTypes" in declared:
        hist = surface_histogram(segs + ["Plane", "Plane"])
        chk(m, f"{label} surface classes from the profile pieces (line: Plane, arc: Cylinder, Bezier: SurfaceOfExtrusion; two Plane caps)", declared["surfaceTypes"] == hist, f"derived {hist}")


def seg_start(s):
    if s[0] == "B":
        return s[1][0]
    return s[1] if s[0] == "L" else [s[1][0] + s[2] * sp.cos(s[3]), s[1][1] + s[2] * sp.sin(s[3])]


def seg_end(s):
    if s[0] == "B":
        return s[1][-1]
    return s[2] if s[0] == "L" else [s[1][0] + s[2] * sp.cos(s[4]), s[1][1] + s[2] * sp.sin(s[4])]


def rect_clear(m, label, lo, hi, loop_pts):
    """Axis-aligned rectangle [lo, hi] strictly inside a simple polygon with every side >= 0.5 from its edges (corners sampled on the rectangle boundary)."""
    corners = [(lo[0], lo[1]), (hi[0], lo[1]), (hi[0], hi[1]), (lo[0], hi[1])]
    loops = [poly_loop(loop_pts)]
    samples = [[num(a[0]) + (num(b[0]) - num(a[0])) * k / 16, num(a[1]) + (num(b[1]) - num(a[1])) * k / 16] for a, b in zip(corners, corners[1:] + corners[:1]) for k in range(16)]
    chk(m, label, all(winding(p, loops) and min(seg_dist(p, s) for s in loops[0]) >= num(CLEARANCE) for p in samples))


@model_for("AC79")
def _m79(z, P, m, cat):
    prof = [[R_(v) for v in p] for p in P["profile"]]
    depth = R_(P["depth"])
    (c0x, c0y, c0z), (c1x, c1y, c1z) = [[R_(v) for v in c] for c in P["cutter"]]
    area = loop_area_perimeter(poly_loop(prof))[0]
    chk(m, "profile counter-clockwise and simple (every corner a distinct point)", area > 0 and len({tuple(p) for p in prof}) == len(prof))
    cross_z = [(prof[i][0] - prof[i - 1][0]) * (prof[(i + 1) % len(prof)][1] - prof[i][1]) - (prof[i][1] - prof[i - 1][1]) * (prof[(i + 1) % len(prof)][0] - prof[i][0]) for i in range(len(prof))]
    chk(m, "profile non-convex: exactly one reflex corner (the L notch)", sum(1 for c in cross_z if c < 0) == 1, str(cross_z))
    chk(m, "cutter through both caps (overhang >= 0.5)", c0z <= -CLEARANCE and c1z >= depth + CLEARANCE)
    rect_clear(m, "cutter footprint inside the profile, every side >= 0.5 from the outline", (c0x, c0y), (c1x, c1y), prof)
    loops = [poly_loop(prof), rect_loop(c0x, c0y, c1x, c1y, cw=True)]
    prism_model(m, loops, 0, depth)
    prism_topology(m, z, loops)
    m["elements"] = [PT([p[0], p[1], zz]) for p in prof for zz in (0, depth)]


@model_for("AC98")
def _m98(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = [[R_(v) for v in c] for c in P["box"]]
    t = [R_(v) for v in P["move"]]
    chk(m, "block built at the local origin, move is a translation in the local xy plane", (x0, y0, z0) == (0, 0, 0) and t[2] == 0 and (t[0], t[1]) != (0, 0))
    lo, hi = [x0 + t[0], y0 + t[1], z0 + t[2]], [x1 + t[0], y1 + t[1], z1 + t[2]]
    _, w0, w1, (cx, cy), r = z_bore(m, P["bore"], "bore")
    chk(m, "bore through the moved block", w0 < lo[2] and w1 > hi[2])
    disc_clear_of(m, "bore inside the moved block's footprint with walls >= 0.5", (cx, cy), r, ((lo[0], lo[1]), (hi[0], hi[1])))
    chk(m, "bore misses the unmoved block (an ignored move leaves the tool outside the target)", cx - r >= x1 + CLEARANCE or cy - r >= y1 + CLEARANCE)
    loops = [rect_loop(lo[0], lo[1], hi[0], hi[1]), circle_loop(cx, cy, r, cw=True)]
    prism_model(m, loops, lo[2], hi[2])
    prism_topology(m, z, loops)
    m["elements"] = box_pts(lo, hi)


@model_for("AC77")
def _m77(z, P, m, cat):
    (fx0, fy0, fz0), (fx1, fy1, fz1) = [[R_(v) for v in c] for c in P["foot"]]
    (ux0, uy0, uz0), (ux1, uy1, uz1) = [[R_(v) for v in c] for c in P["upright"]]
    r = R_(P["radius"])
    ex, ey, ez = [R_(v) for v in P["edgePoint"]]
    chk(m, "upright stands on the foot's top (face contact), flush with its x = min end and its full y width", uz0 == fz1 and ux0 == fx0 < ux1 < fx1 and (uy0, uy1) == (fy0, fy1))
    chk(m, "selection point on the concave seam edge, >= 1 mm from its ends", (ex, ez) == (ux1, fz1) and fy0 + 1 <= ey <= fy1 - 1)
    chk(m, "fillet fits both faces with >= 0.5 to spare", 0 < r <= fx1 - ux1 - CLEARANCE and r <= uz1 - uz0 - CLEARANCE)
    # profile in (x, z), CCW; the concave corner (ux1, fz1) becomes a clockwise arc about (ux1 + r, fz1 + r)
    cxz = (ux1 + r, fz1 + r)
    loop = [L((fx0, fz0), (fx1, fz0)), L((fx1, fz0), (fx1, fz1)), L((fx1, fz1), (cxz[0], fz1)), A(cxz, r, 3 * HALF_PI, 2 * HALF_PI),
            L((ux1, cxz[1]), (ux1, uz1)), L((ux1, uz1), (ux0, uz1)), L((ux0, uz1), (fx0, fz0))]
    v5 = P["v5Profile"]
    union_outline = [[fx0, fz0], [fx1, fz0], [fx1, fz1], [ux1, fz1], [ux1, uz1], [ux0, uz1]]
    chk(m, "V5 profile is the union's (x, z) outline and its extrusion the common y width", [[R_(v) for v in p] for p in v5["points"]] == union_outline and R_(v5["extrudeY"]) == fy1 - fy0)
    prism_model(m, [loop], fy0, fy1, perm=(0, 2, 1))
    prism_topology(m, z, [loop])
    m["elements"] = [PT([x, y, zz]) for x, zz in ((fx0, fz0), (fx1, fz0), (fx1, fz1), (ux1, uz1), (ux0, uz1)) for y in (fy0, fy1)]


@model_for("AC81")
def _m81(z, P, m, cat):
    r = R_(P["radius"])
    (x0, y0, z0), (x1, y1, z1) = [[R_(v) for v in c] for c in fillet_edge_box(m, P)]
    chk(m, "radius fits both faces with >= 0.5 to spare", 0 < r <= min(x1 - x0, y1 - y0) - CLEARANCE)
    loop = fillet_box_profile(x0, y0, x1, y1, r)
    prism_model(m, [loop], z0, z1)
    prism_topology(m, z, [loop])
    m["elements"] = fillet_edge_elements(x0, y0, z0, x1, y1, z1, r)


@model_for("AC84")
def _m84(z, P, m, cat):
    box, t = P["box"], R_(P["thickness"])
    (x0, y0, z0), (x1, y1, z1) = [[R_(v) for v in c] for c in box]
    lit(m, P, "removeFace", f"z={box[1][2]}")
    chk(m, "cavity >= 0.5 in every direction", min(x1 - x0, y1 - y0) - 2 * t >= CLEARANCE and z1 - z0 - t >= CLEARANCE and t > 0)
    box_model(m, {"A": [[x0, y0, z0], [x1, y1, z1]], "T": [[x0 + t, y0 + t, z0 + t], [x1 - t, y1 - t, z1 + 1]]}, "SUBTRACTION", nominal, "exact")
    # one removed face: 5 outer faces, 5 cavity faces, one rim ring; outer and cavity box edges, the cavity's opening edges
    # bound the rim; outer and cavity corners
    derived = {"faces": 5 + 5 + 1, "edges": 12 + 12, "vertices": 8 + 8, "ringEdges": 0, "loops": 5 + 5 + 2, "genus": 0, "singularPoints": 0}
    declared = z["closedForm"].get("topology") or {}
    chk(m, "open-top shell topology from the construction (5 + 5 faces and a rim ring)", all(declared.get(k) == v for k, v in derived.items()), f"derived {derived}")


@model_for("AC89")
def _m89(z, P, m, cat):
    (x0, y0, z0), (x1, y1, z1) = [[R_(v) for v in c] for c in P["plate"]]
    C = R_(P["cornerRadius"])
    chk(m, "corner radius fits the plate with a straight edge >= 0.5 left on every side", 0 < C and 2 * C <= min(x1 - x0, y1 - y0) - CLEARANCE)
    centres = {(x0 + C, y0 + C): (2 * HALF_PI, 3 * HALF_PI), (x1 - C, y0 + C): (3 * HALF_PI, 4 * HALF_PI), (x1 - C, y1 - C): (0, HALF_PI), (x0 + C, y1 - C): (HALF_PI, 2 * HALF_PI)}
    bores = [z_bore(m, h, f"bore {i}") for i, h in enumerate(P["holes"])]
    chk(m, "every bore through the plate", all(b[1] < z0 and b[2] > z1 for b in bores))
    chk(m, "one bore concentric with each rounded corner", sorted(b[3] for b in bores) == sorted(centres))
    chk(m, "wall between bore and rounded corner >= 0.5", all(C - b[4] >= CLEARANCE for b in bores), str([C - b[4] for b in bores]))
    edges = [[R_(v) for v in p] for p in P["edgePoints"]]
    chk(m, "one selection point on each vertical plate corner edge, strictly between the faces",
        sorted((p[0], p[1]) for p in edges) == sorted((x, y) for x in (x0, x1) for y in (y0, y1)) and all(z0 < p[2] < z1 for p in edges))
    mids = [[R_(v) for v in p] for p in P["v5Outline"]["arcMidPoints"]]

    def on_quarter(p):
        for (cx, cy), (t0, t1) in centres.items():
            if (p[0] - cx) ** 2 + (p[1] - cy) ** 2 == C ** 2:
                ang = sp.atan2(p[1] - cy, p[0] - cx) % (4 * HALF_PI)
                return (cx, cy) if num(t0) < num(ang) < num(t1) else None
        return None
    chk(m, "V5 arc mids are rational points strictly inside each corner's quarter circle (one per corner)", sorted(filter(None, map(on_quarter, mids))) == sorted(centres) and len(mids) == 4)
    (a, b_), (c_, d_) = (x0 + C, x1 - C), (y0 + C, y1 - C)
    outline = [L((a, y0), (b_, y0)), A((b_, c_), C, 3 * HALF_PI, 4 * HALF_PI), L((x1, c_), (x1, d_)), A((b_, d_), C, 0, HALF_PI),
               L((b_, y1), (a, y1)), A((a, d_), C, HALF_PI, 2 * HALF_PI), L((x0, d_), (x0, c_)), A((a, c_), C, 2 * HALF_PI, 3 * HALF_PI)]
    loops = [outline] + [circle_loop(bb[3][0], bb[3][1], bb[4], cw=True) for bb in bores]
    prism_model(m, loops, z0, z1)
    prism_topology(m, z, loops)
    m["elements"] = [ARC([cx, cy, zz], [C, 0, 0], [0, C, 0], t0, t1) for (cx, cy), (t0, t1) in centres.items() for zz in (z0, z1)]


# ------------------------------------------------------------------ extension zones, splines-a (AC100, AC102)
# bezier-green: Bezier pieces (explicit control points) are integrated exactly (sympy polynomials) in the same
# Green's-theorem machinery as lines and arcs; a Pythagorean-hodograph arc length is exact, otherwise it is a
# Gauss-Legendre quadrature. payload: AC102's controls are what acid-splines-a.fs computes with cos/sin/tan/atan/sqrt;
# they are replicated here in IEEE binary64 in the FS operation order, taken as exact dyadics (`x * millimeter`) and
# integrated exactly (three-point arcs through the payload points: exact circumcentre, angle in mpmath); that payload
# area must agree with the nominal closed form to 1e-12. The nominal gear is rebuilt tooth by tooth (not by symmetry)
# and integrated in the Cartesian-free sector form over the explicit loop.
def bez_elevate(ctrl):
    """Exact degree elevation of a Bezier control polygon: the same curve with one more control point."""
    n = len(ctrl) - 1
    inner = [[sp.Rational(i, n + 1) * ctrl[i - 1][d] + (1 - sp.Rational(i, n + 1)) * ctrl[i][d] for d in (0, 1)] for i in range(1, n + 1)]
    return [list(ctrl[0])] + inner + [list(ctrl[-1])]


def exact_seg_d2(q, seg):
    """Exact squared distance from a rational point to a line piece or a rational Bezier piece (nearest point among
    the ends and the exact real roots of (C - q).C' in [0,1])."""
    if seg[0] == "L":
        a, b = seg[1], seg[2]
        d = [b[0] - a[0], b[1] - a[1]]
        t = min(max(((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2), 0), 1)
        return (q[0] - a[0] - t * d[0]) ** 2 + (q[1] - a[1] - t * d[1]) ** 2
    if seg[0] != "B":
        raise ValueError("exact distance route covers lines and Bezier pieces")
    x, y = bez_xy(seg)
    g = sp.expand((x - q[0]) * sp.diff(x, TT) + (y - q[1]) * sp.diff(y, TT))
    d2 = sp.expand((x - q[0]) ** 2 + (y - q[1]) ** 2)
    cands = [sp.Integer(0), sp.Integer(1)] + [r for r in sp.Poly(g, TT).real_roots() if 0 <= r <= 1]
    return min((d2.subs(TT, r) for r in cands), key=lambda v: sp.N(v, 50))


def exact_bezier_prism_distance(p, loops, w0, w1):
    """Probe distance to a right prism over loops of lines and rational Bezier pieces (exact candidates; the inside
    test by winding, valid because probes keep >= 0.5 mm off the boundary)."""
    q = [R_(v) for v in p]
    dz = max(R_(w0) - q[2], q[2] - R_(w1), 0)
    inside = winding([num(q[0]), num(q[1])], loops)
    d2 = 0 if inside else min((exact_seg_d2(q, s) for lp in loops for s in lp), key=lambda v: sp.N(v, 50))
    return sp.sqrt(d2 + dz ** 2)


@model_for("AC101")
def _m101(z, P, m, cat):
    m["route"] = "spline-fit"
    from spline_fit import contract_fit
    points = P["fit"]["points"]
    ts, spans, knots, poles = contract_fit(points)
    chk(m, "D1 explicit parameters bit-equal to IEEE default", [float(v) for v in ts] == P["fit"]["parameters"])
    chk(m, "contract knots equal exact D1 interpolation knots", knots == [R_(v) for v in P["fit"]["knots"]])
    chk(m, "contract poles equal independent exact interpolation solve", poles == [[R_(v) for v in p] for p in P["fit"]["poles"]])
    curves = [BZ(ctrl) for ctrl in spans]
    loop = [L([0,0], spans[0][0])] + curves + [L(spans[-1][-1],[0,28]), L([0,28],[0,0])]
    prism_model(m, [loop], 0, R_(P["depth"]))
    # Knot spans remain one geometric edge: no B-rep split at C2 interior knots.
    t = z["closedForm"]["topology"]
    chk(m, "one fit carrier + three lines, two caps: F6 E12 V8", (t["faces"],t["edges"],t["vertices"],t["surfaceTypes"]) == (6,12,8,{"Plane":5,"SurfaceOfExtrusion":1}))
    m["fn"]["probeDistance"] = lambda d: (exact_bezier_prism_distance(d["point"], [loop], 0, P["depth"]), "exact")
    m["elements"] = [("bez", [mpv([p[0],p[1],zz]) for p in ctrl]) for ctrl in spans for zz in (0,P["depth"])] + [PT([0,y,zz]) for y in (0,28) for zz in (0,P["depth"])]


@model_for("AC100")
def _m100(z, P, m, cat):
    ctrl = [[R_(v) for v in p] for p in P["bezier"]["controls"]]
    c0, c1 = [[R_(v) for v in p] for p in P["chord"]]
    depth = R_(P["depth"])
    v5 = [[R_(v) for v in p] for p in P["v5Controls"]]
    chk(m, "chord closes the Bezier from its last to its first control point, on the local x axis", c0 == ctrl[-1] and c1 == ctrl[0] and c0[1] == c1[1] == 0)
    chk(m, "V5 controls are the exact degree elevation of the V0 controls (the same curve)", v5 == bez_elevate(ctrl), str(bez_elevate(ctrl)))
    arch = BZ(ctrl)
    x, y = bez_xy(arch)
    chk(m, "arch is a graph over x (x' has no root in [0,1]) and above the chord strictly inside (0,1): one simple loop",
        not [r for r in sp.Poly(sp.diff(x, TT), TT).real_roots() if 0 <= r <= 1] and not [r for r in sp.Poly(y, TT).real_roots() if 0 < r < 1] and y.subs(TT, sp.Rational(1, 2)) > 0)
    length, exact = bez_length(arch)
    chk(m, "Pythagorean hodograph: |C'| is a polynomial without zeros in [0,1], the arc length exact", exact, str(length))
    quad = mp.quad(sp.lambdify(TT, sp.sqrt(sp.diff(x, TT) ** 2 + sp.diff(y, TT) ** 2), "mpmath"), [0, 1])
    chk(m, "exact arc length equals tanh-sinh quadrature of |C'| to 1e-40", abs(quad - num(length)) < mp.mpf("1e-40"), mp.nstr(quad, 30))
    loop = [L(c1, c0), BZ(ctrl[::-1])]  # counter-clockwise: along the chord, back over the arch
    prism_model(m, [loop], 0, depth)
    prism_topology(m, z, [loop])
    m["fn"]["probeDistance"] = lambda d: (exact_bezier_prism_distance(d["point"], [loop], 0, depth), "exact")
    m["elements"] = [("bez", [mpv([p[0], p[1], zz]) for p in ctrl]) for zz in (0, depth)] + [PT([c[0], c[1], zz]) for c in (c0, c1) for zz in (0, depth)]


def gear_data(m, P):
    """Gear parameters of AC102 (module, teeth, pressure angle, addendum/dedendum in modules, handles) with premises."""
    G, F = P["gear"], P["flank"]
    g = {"m": R_(G["module"]), "z": G["teeth"], "alpha": R_(G["pressureAngleDeg"]), "ha": R_(G["addendumModules"]),
         "hf": R_(G["dedendumModules"]), "th0": R_(G["toothCentreDeg"]), "h0": R_(F["handles"][0]), "h1": R_(F["handles"][1])}
    chk(m, "gear: integer tooth count >= 3, module > 0, 0 < pressure angle < 45 deg, tooth 0 centred on local +x (the FS literal)",
        isinstance(g["z"], int) and g["z"] >= 3 and g["m"] > 0 and 0 < g["alpha"] < 45 and g["th0"] == 0)
    chk(m, "flank handles: 0 < h0, h1 < 1 of the chord", all(0 < g[k] < 1 for k in ("h0", "h1")))
    mm_, z = num(g["m"]), g["z"]
    alpha = mp.pi * num(g["alpha"]) / 180
    rp = mm_ * z / 2
    n = {"rp": rp, "rb": rp * mp.cos(alpha), "ra": rp + num(g["ha"]) * mm_, "rf": rp - num(g["hf"]) * mm_, "pitch": 2 * mp.pi / z}
    n["psib"] = mp.pi / (2 * z) + mp.tan(alpha) - alpha
    n["ta"] = mp.sqrt(n["ra"] ** 2 / n["rb"] ** 2 - 1)
    n["psia"] = n["psib"] - (n["ta"] - mp.atan(n["ta"]))
    chk(m, "root circle inside the base circle (radial root-to-base lines of positive length, >= 0.5)", n["rb"] - n["rf"] >= num(CLEARANCE), mp.nstr(n["rb"] - n["rf"], 12))
    chk(m, "tip land and root land positive (psia > 0, pitch > 2 psib)", n["psia"] > 0 and n["pitch"] > 2 * n["psib"], f"psia {mp.nstr(n['psia'], 10)}")
    return g, n


def gear_flank(n, h0, h1, th, side):
    """Nominal flank controls (mpf) of tooth angle th, side +1 upper / -1 lower, from the base point to the tip point."""
    a0, a3 = th + side * n["psib"], th + side * n["psia"]
    a1 = a0 - side * n["ta"]
    B = [n["rb"] * mp.cos(a0), n["rb"] * mp.sin(a0)]
    T = [n["ra"] * mp.cos(a3), n["ra"] * mp.sin(a3)]
    c = mp.sqrt((T[0] - B[0]) ** 2 + (T[1] - B[1]) ** 2)
    P1 = [B[0] + num(h0) * c * mp.cos(a0), B[1] + num(h0) * c * mp.sin(a0)]
    P2 = [T[0] - num(h1) * c * mp.cos(a1), T[1] - num(h1) * c * mp.sin(a1)]
    return [B, P1, P2, T], [n["rf"] * mp.cos(a0), n["rf"] * mp.sin(a0)]


def gear_outline(g, n):
    """The nominal gear outline as one counter-clockwise loop, tooth by tooth: radial line, lower flank, tip arc,
    upper flank (reversed), radial line, root arc."""
    loop = []
    for k in range(g["z"]):
        th = k * n["pitch"]
        lo, lo_foot = gear_flank(n, g["h0"], g["h1"], th, -1)
        up, up_foot = gear_flank(n, g["h0"], g["h1"], th, 1)
        loop += [L(lo_foot, lo[0]), BZ(lo), A((0, 0), n["ra"], th - n["psia"], th + n["psia"]), BZ(up[::-1]), L(up[0], up_foot),
                 A((0, 0), n["rf"], th + n["psib"], th + n["pitch"] - n["psib"])]
    return loop


def gear_payload(g):
    """acid-splines-a.fs's payload in IEEE binary64, in its operation order (lengths mm, before `* millimeter`):
    per tooth {upper, lower: (poles, foot), tipMid, rootMid}."""
    m_, z = float(g["m"]), g["z"]
    alpha = float(g["alpha"]) * (math.pi / 180)
    rp = m_ * z / 2
    rb = rp * math.cos(alpha)
    ra = rp + float(g["ha"]) * m_
    rf = rp - float(g["hf"]) * m_
    psib = math.pi / (2 * z) + math.tan(alpha) - alpha
    ta = math.sqrt(ra * ra / (rb * rb) - 1)
    psia = psib - (ta - math.atan(ta))
    pitch = 2 * math.pi / z
    h0, h1 = float(g["h0"]), float(g["h1"])
    teeth = []
    for k in range(z):
        th = k * pitch
        tooth = {}
        for name, s in (("upper", 1), ("lower", -1)):
            a0, a3 = th + s * psib, th + s * psia
            a1 = a0 - s * ta
            c0, s0 = math.cos(a0), math.sin(a0)
            B, F, T = (rb * c0, rb * s0), (rf * c0, rf * s0), (ra * math.cos(a3), ra * math.sin(a3))
            dx, dy = T[0] - B[0], T[1] - B[1]
            chord = math.sqrt(dx * dx + dy * dy)
            c1, s1 = math.cos(a1), math.sin(a1)
            tooth[name] = ([B, (B[0] + h0 * chord * c0, B[1] + h0 * chord * s0), (T[0] - h1 * chord * c1, T[1] - h1 * chord * s1), T], F)
        tooth["tipMid"] = (ra * math.cos(th), ra * math.sin(th))
        tooth["rootMid"] = (rf * math.cos(th + pitch / 2), rf * math.sin(th + pitch / 2))
        teeth.append(tooth)
    return teeth


def payload_area(teeth):
    """Exact Green area of the payload outline: lines and Bezier pieces in Fractions, three-point arcs through the
    payload points by their exact circumcentre (the sweep angle in mpmath)."""
    P2 = lambda p: (fs_mm(p[0]), fs_mm(p[1]))
    exact, angular = Fraction(0), mp.mpf(0)

    def line(a, b):
        a, b = P2(a), P2(b)
        return (a[0] * b[1] - b[0] * a[1]) / 2

    def bez(ctrl):
        x, y = bez_xy(BZ([[sp.Rational(v.numerator, v.denominator) for v in P2(p)] for p in ctrl]))
        v = poly_int01(x * sp.diff(y, TT) - y * sp.diff(x, TT)) / 2
        return Fraction(int(v.p), int(v.q))

    def arc(a, mid, b):
        (ax, ay), (bx, by), (cx, cy) = P2(a), P2(mid), P2(b)
        d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
        ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
        uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
        ang = lambda px, py: mp.atan2(num(py - uy), num(px - ux))
        t0, tm, t1 = ang(ax, ay), ang(bx, by), ang(cx, cy)
        while tm < t0:
            tm += 2 * mp.pi
        while t1 < tm:
            t1 += 2 * mp.pi
        return (ux * (cy - ay) - uy * (cx - ax)) / 2, num((ax - ux) ** 2 + (ay - uy) ** 2) * (t1 - t0) / 2
    for k, tooth in enumerate(teeth):
        (lo, lo_foot), (up, up_foot), nxt = tooth["lower"], tooth["upper"], teeth[(k + 1) % len(teeth)]
        exact += line(lo_foot, lo[0]) + bez(lo) - bez(up) + line(up[0], up_foot)
        for e, a in (arc(lo[3], tooth["tipMid"], up[3]), arc(up_foot, tooth["rootMid"], nxt["lower"][1])):
            exact += e
            angular += a
    return num(exact) + angular


@model_for("AC102")
def _m102(z, P, m, cat):
    g, n = gear_data(m, P)
    depth = R_(P["depth"])
    _, h0z, h1z, hc, R = z_bore(m, P["hub"], "hub")
    _, b0, b1, bc, r = z_bore(m, P["bore"], "bore")
    chk(m, "hub and bore coaxial with the gear centre", hc == bc == (0, 0))
    chk(m, "hub stands on the gear top (z = depth) and inside the root circle with a wall >= 0.5", h0z == depth < h1z and num(R) + num(CLEARANCE) <= n["rf"])
    chk(m, "bore inside the hub with a wall >= 0.5, flush with the gear bottom and the hub top (E4 contact at equal levels)", r + CLEARANCE <= R and b0 == 0 and b1 == h1z)
    # E9: V0 extrudes each circle from its sketch plane, so a level is plane + depth as exact binary64 SI payloads; the
    # flush contacts hold exactly only if those sums agree (fl(0.006) + fl(0.005) != fl(0.011): a membrane over the bore).
    si = lambda v: Fraction(float(v) * 0.001)
    chk(m, "E9: gear top = hub plane, and hub plane + hub depth = bore plane + bore depth exactly (binary64 SI payloads)",
        si(0) + si(depth) == si(h0z) and si(h0z) + si(h1z - h0z) == si(b0) + si(b1 - b0), f"{float(si(h0z) + si(h1z - h0z) - si(b0) - si(b1 - b0))} m")
    v5 = P["v5"]
    _, vh0, vh1, vhc, vR = z_bore(m, v5["hub"], "V5 hub")
    _, vb0, vb1, vbc, vr = z_bore(m, v5["bore"], "V5 bore")
    chk(m, "V5 hub equals the hub; V5 bore: the same axis and radius with >= 0.5 overshoot through both faces",
        (vh0, vh1, vhc, vR) == (h0z, h1z, hc, R) and vbc == bc and vr == r and vb0 <= b0 - CLEARANCE and vb1 >= b1 + CLEARANCE)
    outline = gear_outline(g, n)
    # the hub section lies inside the gear section: every outline piece keeps radius >= rf (lines and flanks by their
    # squared radius over [0,1], arcs by their radius) and the hub disc has R + 0.5 <= rf, checked above
    def min_radius(s):
        if s[0] == "A":
            return num(s[2])
        cx, cy = bez_mp(s) if s[0] == "B" else ([num(s[1][0]), num(s[2][0]) - num(s[1][0])], [num(s[1][1]), num(s[2][1]) - num(s[1][1])])
        r2 = [mp.mpf(0)] * (2 * len(cx) - 1)
        for i in range(len(cx)):
            for j in range(len(cx)):
                r2[i + j] += cx[i] * cx[j] + cy[i] * cy[j]
        return mp.sqrt(min(mp_poly(r2, t) for t in [mp.mpf(0), mp.mpf(1)] + mp_real_roots01([k * r2[k] for k in range(1, len(r2))])))
    chk(m, "every outline piece stays at radius >= rf (so the hub disc lies inside the gear section)", min(min_radius(s) for s in outline) >= n["rf"] - mp.mpf("1e-40"))
    bore_loop = circle_loop(bc[0], bc[1], r, cw=True)
    slabs = [([outline, bore_loop], 0, depth), ([circle_loop(hc[0], hc[1], R), bore_loop], depth, h1z)]
    (v1, a1, s1), (v2, a2, s2) = [prism(loops, sp.sympify(z1) - sp.sympify(z0)) for loops, z0, z1 in slabs]
    m["V"], m["A"] = v1 + v2, a1 + a2 - 2 * s2  # the glued interface z = depth is the hub section, counted by both prisms
    m["solid"] = [("prism", loops, z0, z1, (0, 1, 2)) for loops, z0, z1 in slabs]
    m["fn"]["probeDistance"] = lambda d: (min(dist_prism(d["point"], loops, z0, z1) for loops, z0, z1 in slabs), "numeric")
    m["route"] = "quad"  # nominal transcendental controls at 50 digits, flank lengths by quadrature
    cap = num(s1) + num(r) ** 2 * mp.pi
    # payload route: the binary64 FS controls, exact dyadic Green
    pl = payload_area(gear_payload(g))
    chk(m, "payload route: exact Green area of the binary64 FS payload outline equals the nominal cap area to 1e-12", close(pl, cap, rel=1e-12), f"{mp.nstr(pl, 25)} vs {mp.nstr(cap, 25)}")
    # first-principles sanity (catalog check, not scored): the Bezier gear is within 1e-3 of the true involute gear
    s_inv = -n["rb"] ** 2 * n["ta"] ** 3 / 6  # 1/2 int (x dy - y dx) along the involute from the base to the tip
    a_inv = g["z"] * (n["rf"] ** 2 * (mp.pi / g["z"] - n["psib"]) + n["ra"] ** 2 * n["psia"] - 2 * s_inv)
    chk(m, "the cap area is within 1e-3 relative of the true involute gear (it describes a gear)", abs(cap - a_inv) <= mp.mpf("1e-3") * a_inv, f"{mp.nstr(cap, 15)} vs involute {mp.nstr(a_inv, 15)}")
    # topology from the construction: one face per outline piece, the caps, hub wall and top, bore wall
    pieces = len(outline)
    derived = {"faces": pieces + 5, "edges": 3 * pieces + 4, "vertices": 2 * pieces, "ringEdges": 4, "loops": pieces + 10, "genus": 1, "singularPoints": 0}
    declared = z["closedForm"].get("topology") or {}
    chk(m, "gear topology from the outline (one face per piece, bottom, gear top, hub wall, hub top, bore wall; bore and hub rings)", all(declared.get(k) == v for k, v in derived.items()), f"derived {derived}")
    hist = surface_histogram(outline + ["Plane", "Plane", "Plane", "Cylinder", "Cylinder"])
    chk(m, "gear surface classes from the outline pieces plus the bottom, gear top and hub top planes and the hub and bore walls", declared.get("surfaceTypes") == hist, f"derived {hist}")
    m["elements"] = [ARC([0, 0, zz], [n["ra"], 0, 0], [0, n["ra"], 0], k * n["pitch"] - n["psia"], k * n["pitch"] + n["psia"]) for k in range(g["z"]) for zz in (0, depth)] + \
        [CIRCLE([0, 0, zz], [0, 0, 1], R) for zz in (depth, h1z)]


# ------------------------------------------------------------------ checks
class Report:
    def __init__(self):
        self.rows, self.fail = [], 0

    def add(self, zid, check, ok, detail=""):
        self.rows.append((zid, check, bool(ok), detail))
        if not ok:
            self.fail += 1


def close(a, b, rel=None, absol=None):
    a, b = num(a), num(b)
    if absol is not None and abs(a - b) <= absol:
        return True
    if rel is not None:
        return abs(a - b) <= rel * max(abs(a), abs(b), mp.mpf("1e-300"))
    return a == b


PREC = {"spline-fit": 1e-25, "exact": 1e-25, "quad": 1e-20, "e9": 1e-12, "numeric": None}
SYMLOC = {"pi": sp.pi, "sqrt": sp.sqrt, "Rational": sp.Rational, "K": lambda m_: sp.elliptic_k(m_), "E": lambda m_: sp.elliptic_e(m_)}
MEASURE_KINDS = {"probeDistance", "bodyDistance", "bboxExtent", "edgeLength", "lineDistance"}
# OCCT GeomAbs_SurfaceType names as scripts/acid/measure.py files faces (GeomAbs_ prefix dropped).
SURFACE_CLASSES = {"Plane", "Cylinder", "Cone", "Sphere", "Torus", "BezierSurface", "BSplineSurface", "SurfaceOfRevolution", "SurfaceOfExtrusion", "OffsetSurface", "OtherSurface"}


def euler_ok(t):
    if not t or not t.get("eulerPoincareCheck"):
        return None
    lhs = t["vertices"] + t["ringEdges"] - t["edges"] + 2 * t["faces"] - t["loops"] - 2 * t["closedToroidalFaces"] + 2 * t.get("pinchPoints", 0)
    return lhs == 2 * t["shells"] - 2 * t["genus"], lhs


def e9_checks(z, rep):
    for d in z["construction"].get("e9", []):
        env = {"__builtins__": {}, "abs": abs}
        lf, rf = eval(d["lhs"], env, {}), eval(d["rhs"], env, {})
        rel = d["relation"]
        ok = {"==": lf == rf, "<": lf < rf, ">": lf > rf}[rel]
        rep.add(z["id"], f"e9 {d['name']} {rel}", ok, f"lhs={lf!r} rhs={rf!r}")
        if "symbol" in d:
            v = (Fraction(lf) - Fraction(rf)) * 1000
            num_, den_ = (int(x) for x in d["symbolValueMm"].split("/"))
            rep.add(z["id"], f"e9 symbol {d['symbol']} exact", v == Fraction(num_, den_), f"{float(v)!r} mm")


def expr_locals(item, rational):
    """SYMLOC plus the item's named definitions (`where`: [[name, expression], ...] in order), each evaluated to 60
    digits: closed forms of spline zones name their intermediate quantities (base radius, flank controls, arc length)."""
    loc = dict(SYMLOC)
    for name, text in item.get("where", []):
        loc[name] = sp.N(sp.sympify(text, locals=loc, rational=rational), 60)
    return loc


def expr_check(zid, label, item, rep, subs, rational=False):
    # V4 literals are decimal radii (9.025): parse them as exact rationals, never binary floats.
    e = sp.sympify(item["expression"], locals=expr_locals(item, rational), rational=rational)
    if subs:
        e = e.subs({sp.Symbol(k): sp.Rational(*map(int, v.split("/"))) if "/" in v else sp.Rational(v) for k, v in subs.items()})
    v = sp.N(e, 40)
    ok = close(v, sp.Float(item["value"], 40), rel=1e-28) and math.isclose(float(v), item["valueFloat"], rel_tol=1e-15, abs_tol=1e-300)
    rep.add(zid, f"expr {label}", ok, f"{item['expression']} = {item['value']}")
    return v


def symbols_of(z):
    return {d["symbol"]: d["symbolValueMm"] for d in z["construction"].get("e9", []) if "symbol" in d}


def build_model(z, cat_by_id):
    P = Params(z["construction"]["params"])
    m = {"route": "exact", "checks": [], "fn": {}, "elements": None, "solid": None}
    f = MODELS.get(z["id"])
    if f is None:
        m["route"] = "none"
        m["missing"] = True
        return m, P
    f(z, P, m, cat_by_id)
    return m, P


def topology_scope_check(zid, label, t, profile, rep):
    if not t:
        return
    sc = set(t["scored"])
    need = {"bodies", "shells", "genus"} if profile == "approximation" else {"bodies", "shells", "faces", "edges", "vertices", "genus", "singularPoints"}
    if t.get("pinchPoints", 0):
        need.add("pinchPoints")
    rep.add(zid, f"topology {label} scored fields", need <= sc, f"scored {sorted(sc)}, required {sorted(need)}")
    if "surfaceTypes" in sc or "surfaceTypes" in t:
        # measure.py names every face by its OCCT surface class; a scored histogram counts every face once.
        h = t.get("surfaceTypes")
        ok = "surfaceTypes" in sc and isinstance(h, dict) and set(h) <= SURFACE_CLASSES and all(isinstance(v, int) and v > 0 for v in h.values()) and sum(h.values()) == t["faces"]
        rep.add(zid, f"topology {label} surfaceTypes scored, known OCCT classes, one per face", ok, str(h))


def bbox_checks(z, m, rep, cf=None, frames=None, tag=""):
    zid, cf = z["id"], cf or z["closedForm"]
    frames = frames or {v: frame(v) for v in zone_variants(z) if v != "V4"}
    bb = cf.get("bbox")
    if bb is None:
        rep.add(zid, "bbox null", cf.get("bboxNullReason") is not None or cf.get("nullReason") is not None, "reason given")
        return
    routes = []
    if m.get("elements"):
        routes.append(("A support elements", lambda M, t: bbox_of(m["elements"], M, t)))
    if m.get("solid"):
        routes.append(("B construction solid", lambda M, t: bbox_B(m["solid"], M, t)))
    if m.get("solidInner"):
        routes.append(("B' inner construction solid", lambda M, t: bbox_B(m["solidInner"], M, t)))
    if not routes:
        rep.add(zid, "bbox has no route", False, "add support elements or a construction solid")
        return
    single = len(routes) == 1
    # E9 routes carry the binary64 payload: at 131 m it differs from the nominal local bbox by up to 1.5e-11 mm
    ltol = 1e-10 if m["route"] == "e9" else 1e-12
    for name, fn in routes:
        lo, hi = fn(I3, [0, 0, 0])
        ok = all(close(lo[i], bb["local"]["min"][i], absol=ltol) and close(hi[i], bb["local"]["max"][i], absol=ltol) for i in range(3))
        rep.add(zid, f"{tag}bbox local [{name}]", ok, f"{[float(x) for x in lo]} {[float(x) for x in hi]}")
    for k, (Mx, t) in frames.items():
        stored = bb.get("variants", {}).get(k)
        if stored is None:
            ok = k == "V3" and cf.get("bboxV3CrossComparison")
            rep.add(zid, f"bbox {k} absent", bool(ok), "cross-comparison only" if ok else "missing")
            continue
        for name, fn in routes:
            lo, hi = fn(Mx, t)
            ok = all(close(lo[i], stored["min"][i], absol=1e-9) and close(hi[i], stored["max"][i], absol=1e-9) for i in range(3))
            label = f"{name}, single-route" if (single and k == "V3") else name
            rep.add(zid, f"{tag}bbox {k} [{label}]", ok, "" if ok else f"route {[float(x) for x in lo]} {[float(x) for x in hi]} vs stored {stored}")
        if k == "V3":
            clo, chi = bbox_of(box_pts(bb["local"]["min"], bb["local"]["max"]), Mx, t)
            inside = all(clo[i] - mp.mpf("1e-9") <= stored["min"][i] and stored["max"][i] <= chi[i] + mp.mpf("1e-9") for i in range(3))
            rep.add(zid, "bbox V3 within rotated local box", inside, "")
        if k == "V1":
            ok = all(close(stored["min"][i], mp.mpf(bb["local"]["min"][i]) + V1T[i], absol=1e-9) and close(stored["max"][i], mp.mpf(bb["local"]["max"][i]) + V1T[i], absol=1e-9) for i in range(3))
            rep.add(zid, "bbox V1 == local + translation", ok, "")
        if k == "V2":
            lo_, hi_ = bb["local"]["min"], bb["local"]["max"]
            exp_lo, exp_hi = [-hi_[1], -hi_[2], lo_[0]], [-lo_[1], -lo_[2], hi_[0]]
            ok = all(close(stored["min"][i], exp_lo[i], absol=1e-9) and close(stored["max"][i], exp_hi[i], absol=1e-9) for i in range(3))
            rep.add(zid, "bbox V2 == permuted local", ok, "")


def v4_closed_form(z):
    """The V4 closed form of the zone's geometry outcome (outcome.closedFormByVariant.V4 -> zone.closedFormByVariant)."""
    for o in z["expected"]["outcomes"]:
        name = (o.get("closedFormByVariant") or {}).get("V4")
        if o["kind"] == "geometry" and name is not None:
            return o["id"], z["closedForm"] if name == "primary" else name if isinstance(name, dict) else z.get("closedFormByVariant", {}).get(name)
    return None, None


def radius_bumps(a, b, delta, path=""):
    """Leaves where V4 parameters differ from V0: allowed only on radius keys, by exactly +delta. Returns (bumped, violations)."""
    if isinstance(a, dict) and isinstance(b, dict):
        if set(a) != set(b):
            return 0, [f"{path}: keys {sorted(a)} vs {sorted(b)}"]
        out = [radius_bumps(a[k], b[k], delta, f"{path}.{k}") for k in a]
        return sum(x[0] for x in out), [v for x in out for v in x[1]]
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return 0, [f"{path}: length"]
        out = [radius_bumps(x, y, delta, f"{path}[{i}]") for i, (x, y) in enumerate(zip(a, b))]
        return sum(x[0] for x in out), [v for x in out for v in x[1]]
    key = path.rsplit(".", 1)[-1]
    if key in RADIUS_KEYS and not isinstance(a, (dict, list)):
        return (1, []) if nominal(b) - nominal(a) == delta else (0, [f"{path}: {a} -> {b} is not +{delta}"])
    return (0, []) if a == b else (0, [f"{path}: {a!r} -> {b!r} (only radii change in V4)"])


def check_v4(z, rep, cat_by_id, cat):
    """V4 is recomputed from construction.paramsByVariant.V4 by the same zone model, against its own closed form."""
    zid = z["id"]
    params4 = z["construction"].get("paramsByVariant", {}).get("V4")
    oid, cf4 = v4_closed_form(z)
    rep.add(zid, "V4 parameters and closed form declared", params4 is not None and isinstance(cf4, dict) and cf4 is not z["closedForm"], oid or "")
    if params4 is None or not isinstance(cf4, dict):
        return
    delta = nominal(cat["variants"]["V4"]["radiusDeltaMm"])
    bumped, bad = radius_bumps(z["construction"]["params"], params4, delta)
    rep.add(zid, f"V4 parameters = V0 with every radius +{float(delta)} mm", bumped > 0 and not bad, "; ".join(bad) or f"{bumped} radii")
    z4 = dict(z, construction=dict(z["construction"], params=params4), closedForm=cf4)
    for key in ("volume", "area"):
        expr_check(zid, f"V4 {key}", cf4[key], rep, {}, rational=True)
    for mm in cf4.get("measurements", []) or []:
        expr_check(zid, f"V4 measurement {mm['name']}", mm, rep, {}, rational=True)
    m, P = build_model(z4, cat_by_id)
    for label, ok, detail in m["checks"]:
        rep.add(zid, "V4 construction " + label, ok, detail)
    rep.add(zid, "V4 every construction parameter bound to a route", not P.unused(), f"unbound: {P.unused()}" if P.unused() else "")
    t = cf4.get("topology")
    r = euler_ok(t)
    rep.add(zid, "V4 euler-poincare", bool(r and r[0]), f"lhs={r[1] if r else None}")
    topology_scope_check(zid, "V4", t, z["tolerance"]["profile"], rep)
    t0 = z["closedForm"].get("topology") or {}
    rep.add(zid, "V4 topology equals V0 (same branch, radius bump only)", all(t.get(k) == t0.get(k) for k in t0.get("scored", [])), "")
    route = m["route"]
    for key, sym in (("volume", "V"), ("area", "A")):
        ok = sym in m and close(m[sym], sp.Float(cf4[key]["value"], 40), rel=PREC.get(route, 1e-20))
        rep.add(zid, f"V4 {key} [{route}]", ok, f"recomputed {mp.nstr(num(m[sym]), 25) if sym in m else None} vs {cf4[key]['value']}")
    for mm in cf4.get("measurements", []) or []:
        fn = m["fn"].get(mm["definition"]["kind"])
        val, mroute = fn(mm["definition"]) if fn else (None, "no independent route")
        ok = val is not None and (close(val, sp.Float(mm["value"], 40), rel=1e-25, absol=1e-40) if mroute == "exact" else close(val, sp.Float(mm["value"], 40), absol=1e-9))
        rep.add(zid, f"V4 measurement {mm['name']} [{mroute}]", ok, f"{mp.nstr(num(val), 20) if val is not None else None} vs {mm['value']}")
    bbox_checks(z4, m, rep, cf=cf4, frames={"V4": frame("V4")}, tag="V4 ")


def check_zone(z, rep, cat_by_id, cat=None):
    zid, cf = z["id"], z["closedForm"]
    subs = symbols_of(z)
    e9_checks(z, rep)
    for key in ("volume", "area"):
        if cf.get(key):
            expr_check(zid, key, cf[key], rep, subs)
    for mm in cf.get("measurements", []) or []:
        expr_check(zid, f"measurement {mm['name']}", mm, rep, subs)
        rep.add(zid, f"measurement {mm['name']} kind known", mm["definition"]["kind"] in MEASURE_KINDS, mm["definition"]["kind"])
    m, P = build_model(z, cat_by_id)
    rep.add(zid, "checker model exists", not m.get("missing"), "")
    for label, ok, detail in m["checks"]:
        rep.add(zid, "construction " + label, ok, detail)
    unused = P.unused()
    rep.add(zid, "every construction parameter bound to a route", not unused, f"unbound: {unused}" if unused else "")
    b = cf.get("bounds", {}).get("volume")
    if b:
        extra = {}
        if zid == "AC36":
            a20 = cat_by_id["AC20"]["construction"]["params"]
            extra["LQ"] = str(sp.Rational(str(quartic_length(a20["C1"]["R"], a20["C2"]["r"]))))
        for side in ("lower", "upper"):
            e = sp.sympify(b[side]["expression"], locals=SYMLOC)
            if extra:
                e = e.subs({sp.Symbol(k): sp.Rational(v) for k, v in extra.items()})
            rep.add(zid, f"expr bound {side}", close(sp.N(e, 40), sp.Float(b[side]["value"], 40), rel=1e-15), b[side]["expression"])
    # topology
    prof = z["tolerance"]["profile"]
    tops = [("primary", cf.get("topology"))] + [(o["id"], o["closedForm"].get("topology")) for o in z["expected"]["outcomes"] if isinstance(o.get("closedForm"), dict)]
    for label, t in tops:
        r = euler_ok(t)
        if r is not None:
            rep.add(zid, f"euler-poincare {label}", r[0], f"lhs={r[1]} rhs={2 * t['shells'] - 2 * t['genus']}")
        elif t:
            rep.add(zid, f"euler-poincare {label} declared off", False, "every declared topology must pass the (pinch-aware) invariant")
        topology_scope_check(zid, label, t, prof, rep)
    if "bodies" in m and cf.get("topology"):
        rep.add(zid, "body count [exact cell components]", m["bodies"] == cf["topology"]["bodies"], f"{m['bodies']} vs {cf['topology']['bodies']}")
    # volume and area
    route = m["route"]
    for key, sym in (("volume", "V"), ("area", "A")):
        if cf.get(key) and sym in m:
            prec = PREC.get(route, 1e-20)
            ok = close(m[sym], sp.Float(cf[key]["value"], 40), rel=prec)
            rep.add(zid, f"{key} [{route}]", ok, f"recomputed {mp.nstr(num(m[sym]), 25)} vs {cf[key]['value']}")
        elif cf.get(key):
            rep.add(zid, f"{key} [no independent route]", False, "missing recomputation")
    if "bounds" in m:
        for side in ("lower", "upper"):
            pr = 1e-20 if zid == "AC36" else 1e-25
            rep.add(zid, f"bound {side} [{'quad' if zid == 'AC36' else 'exact'}]", close(m["bounds"][side], sp.Float(cf["bounds"]["volume"][side]["value"], 40), rel=pr), "")
    # measurements
    for mm in cf.get("measurements", []) or []:
        d = mm["definition"]
        fn = m["fn"].get(d["kind"])
        if fn is None:
            rep.add(zid, f"measurement {mm['name']} [no independent route]", False, d["kind"])
            continue
        val, mroute = fn(d)
        if val is None:
            rep.add(zid, f"measurement {mm['name']} [route refused]", False, mroute)
            continue
        target = sp.Float(mm["value"], 40)
        if mroute == "e9exact":
            sym = mm["expression"]
            ok = sym in subs and Fraction(val) == Fraction(*(int(x) for x in subs[sym].split("/")))
        elif mroute == "exact":
            ok = close(val, target, rel=1e-25, absol=1e-40)
        elif mroute == "e9":
            ok = close(val, target, rel=1e-12, absol=1e-12)
        else:
            ok = close(val, target, absol=1e-9)
        rep.add(zid, f"measurement {mm['name']} [{mroute}]", ok, f"{mp.nstr(num(val), 20)} vs {mm['value']}")
    bbox_checks(z, m, rep)
    declared = zone_variants(z)
    if "V4" in declared:
        check_v4(z, rep, cat_by_id, cat)
    if "V5" in declared:
        # V5 is V0's geometry in another idiom: it has no closed form of its own.
        own = [o["id"] for o in z["expected"]["outcomes"] if "V5" in (o.get("closedFormByVariant") or {})]
        rep.add(zid, "V5 shares V0's closed form", not own and "V5" not in z.get("closedFormByVariant", {}), str(own))
    # alternative outcomes (boxes)
    for o in z["expected"]["outcomes"]:
        ocf = o.get("closedForm")
        if isinstance(ocf, dict) and ocf.get("volume"):
            for key in ("volume", "area"):
                expr_check(zid, f"{o['id']} {key}", ocf[key], rep, subs)
            if not ocf.get("bbox"):
                ok = num(sp.Float(ocf["volume"]["value"], 40)) == 0 and ocf["topology"]["bodies"] == 0
                rep.add(zid, f"{o['id']} empty outcome", ok, "")
                continue
            vb = variants_from_local(ocf["bbox"]["local"])
            ok = all(close(vb[k]["min"][i], ocf["bbox"]["variants"][k]["min"][i], absol=1e-9) and close(vb[k]["max"][i], ocf["bbox"]["variants"][k]["max"][i], absol=1e-9) for k in VARIANTS for i in range(3))
            rep.add(zid, f"{o['id']} bbox variants", ok, "")
            lo, hi = ocf["bbox"]["local"]["min"], ocf["bbox"]["local"]["max"]
            ext = [Fraction(str(hi[i])) - Fraction(str(lo[i])) for i in range(3)]
            vol = ext[0] * ext[1] * ext[2]
            ar = 2 * (ext[0] * ext[1] + ext[1] * ext[2] + ext[0] * ext[2])
            rep.add(zid, f"{o['id']} volume [exact box]", close(vol, sp.Float(ocf["volume"]["value"], 40), rel=1e-25), "")
            rep.add(zid, f"{o['id']} area [exact box]", close(ar, sp.Float(ocf["area"]["value"], 40), rel=1e-25), "")


def variants_from_local(local):
    els = box_pts(local["min"], local["max"])
    return {k: fmt_box(bbox_of(els, *VARIANTS[k])) for k in VARIANTS}


def fmt_box(b):
    lo, hi = b
    return {"min": [float(x) for x in lo], "max": [float(x) for x in hi]}


def variant_bboxes_for_all(zones):
    """Per-variant bboxes of every zone's primary outcome from route A (used by the scratch generator)."""
    by_id = {z["id"]: z for z in zones}
    out = {}
    for z in zones:
        m, _ = build_model(z, by_id)
        els = m.get("elements")
        if els is None or z["closedForm"].get("bbox") is None:
            out[z["id"]] = None
            continue
        vb = {}
        for k, (M, t) in VARIANTS.items():
            if k == "V3" and z["closedForm"].get("bboxV3CrossComparison"):
                vb[k] = None
                vb["V3_nullReason"] = "cross-comparison only: blend surface near a rotated extreme is kernel-defined"
                continue
            vb[k] = fmt_box(bbox_of(els, M, t))
        out[z["id"]] = vb
    return out


def base_catalog(cat, rep):
    """The frozen catalog an extension grows from (history baseSha256, bytes from fixtures/cad-acid/catalog-history)."""
    shas = {h["baseSha256"] for h in cat.get("history", []) if h.get("baseSha256")}
    if cat.get("schema") != "wonky/cad-acid-zones/2":
        rep.add("catalog", "schema /1 catalog has no extension base", not shas, str(sorted(shas)))
        return None
    rep.add("catalog", "extension names exactly one base catalog", len(shas) == 1, str(sorted(shas)))
    if len(shas) != 1:
        return None
    sha = next(iter(shas))
    path = ROOT / "fixtures/cad-acid/catalog-history" / f"{sha}.json"
    data = path.read_bytes() if path.is_file() else b""
    ok = hashlib.sha256(data).hexdigest() == sha
    rep.add("catalog", "base catalog copy present with matching SHA-256", ok, str(path.relative_to(ROOT)))
    return json.loads(data) if ok else None


def structural_checks(cat, rep):
    zones = cat["zones"]
    ids = [z["id"] for z in zones]
    retired = [r["id"] for r in cat.get("retiredZones", [])]
    base = base_catalog(cat, rep)
    if base is None:
        rep.add("catalog", "zone count 36..48", 36 <= len(zones) <= 48, str(len(zones)))
    else:
        # One catalog, extended in place: every base zone stays (unchanged unless a history entry amends it).
        base_ids = [z["id"] for z in base["zones"]]
        amended = {i for h in cat.get("history", []) for i in h.get("amendedZones", [])}
        by_id = {z["id"]: z for z in zones}
        rep.add("catalog", "zone count >= base catalog", len(zones) >= len(base_ids) >= 48, f"{len(zones)} >= {len(base_ids)}")
        rep.add("catalog", "every base zone present", all(i in by_id for i in base_ids), str([i for i in base_ids if i not in by_id]))
        changed = [z["id"] for z in base["zones"] if z["id"] in by_id and z["id"] not in amended and json.dumps(z, sort_keys=True) != json.dumps(by_id[z["id"]], sort_keys=True)]
        rep.add("catalog", "base zones byte-identical unless amended in history", not changed, str(changed))
        added = [i for i in ids if i not in base_ids]
        rep.add("catalog", "new zone ids AC50 and up", all(re.fullmatch(r"AC(?:[5-9]\d|[1-9]\d{2,})", i) for i in added), str(added))
        rep.add("catalog", "history lists the added zones", sorted(added) == sorted({i for h in cat["history"] for i in h.get("addedZones", [])}), str(added))
        v4, v5 = cat["variants"].get("V4", {}), cat["variants"].get("V5", {})
        rep.add("catalog", "V4 spec (parameters, frame V0, radius +0.025 mm)", v4.get("kind") == "parameters" and v4.get("baseFrame") == "V0" and nominal(v4.get("radiusDeltaMm", 0)) == Fraction(1, 40), "")
        rep.add("catalog", "V5 spec (idiom, frame V0)", v5.get("kind") == "idiom" and v5.get("baseFrame") == "V0", "")
        for z in zones:
            if z["id"] in added:
                vs = zone_variants(z)
                rep.add(z["id"], "declares its variants, V0-V3 first, canonical order", "variants" in z and vs[:4] == ["V0", "V1", "V2", "V3"] and vs == [v for v in ALL_VARIANTS if v in vs], str(vs))
                rep.add(z["id"], "every omitted V4/V5 has a variantNotes reason", all(v in vs or (z.get("variantNotes") or {}).get(v) for v in ("V4", "V5")), "")
                rep.add(z["id"], "family declared", z.get("family") in {f["id"] for f in cat.get("families", [])}, str(z.get("family")))
    rep.add("catalog", "unique ids", len(set(ids)) == len(ids), "")
    rep.add("catalog", "ids match AC and two or more digits", all(re.fullmatch(r"AC\d{2,}", i) for i in ids), "")
    rep.add("catalog", "retired ids never reused", not (set(retired) & set(ids)), str(retired))
    rep.add("catalog", "every retired zone gives a reason", all(r.get("reason") for r in cat.get("retiredZones", [])), "")
    order = [z["group"] for z in zones]
    rep.add("catalog", "zones grouped contiguously in group order", order == sorted(order, key=[g["id"] for g in cat["groups"]].index), "")
    base_groups = {g["id"]: g for g in (base["groups"] if base else [])}
    for g in cat["groups"]:
        if base is None or g["id"] in base_groups:
            rep.add("catalog", f"group {g['id']} size 8..12", 8 <= len(g["zoneIds"]) <= 12, str(len(g["zoneIds"])))
            if base is not None:
                rep.add("catalog", f"group {g['id']} unchanged from the base catalog", json.dumps(g, sort_keys=True) == json.dumps(base_groups[g["id"]], sort_keys=True), "")
        else:
            # Extension groups are capture units frozen as a whole: 4..12 zones each. A group still being
            # filled within its batch names its full membership (plannedZoneIds, from the batch plan):
            # the bound applies to the plan, the present zones must belong to it, and the field goes
            # once the group is complete.
            planned = g.get("plannedZoneIds")
            if planned is None:
                rep.add("catalog", f"group {g['id']} size 4..12", 4 <= len(g["zoneIds"]) <= 12, str(len(g["zoneIds"])))
            else:
                ok = 4 <= len(planned) <= 12 and len(set(planned)) == len(planned) and set(g["zoneIds"]) < set(planned)
                rep.add("catalog", f"group {g['id']} incomplete: planned size 4..12, present zones part of the plan", ok, f"{len(g['zoneIds'])} of {len(planned)} planned")
            rep.add("catalog", f"group {g['id']} variant enum covers its zones' variants", g["featureScript"]["parameters"]["variant"]["values"] == [v for v in ALL_VARIANTS if any(v in zone_variants(z) for z in zones if z["group"] == g["id"])], "")
        rep.add("catalog", f"group {g['id']} zoneIds match zones", g["zoneIds"] == [z["id"] for z in zones if z["group"] == g["id"]], "")
        fsd = g["featureScript"]
        rep.add("catalog", f"group {g['id']} zone selector covers its zones", fsd["parameters"]["zone"]["values"] == ["ALL"] + g["zoneIds"], "")
    cells = [tuple(z["cell"]["originMm"]) for z in zones]
    rep.add("catalog", "distinct cells", len(set(cells)) == len(cells), "")
    v = cat["variants"]
    rep.add("catalog", "V1 translation", v["V1"]["translationMm"] == [65536.25, -32768.5, 16384.125], "")
    rep.add("catalog", "V2 matrix", v["V2"]["matrix"] == V2M, "")
    rep.add("catalog", "V3 spec", v["V3"]["angleRad"] == 0.1 and v["V3"]["axis"] == [1, 2, 3] and v["V3"]["throughPointMm"] == [3, -2, 5], "")
    R, _ = VARIANTS["V3"]
    det = mp.det(mp.matrix(R))
    rep.add("catalog", "V3 rotation det 1, orthonormal", abs(det - 1) < mp.mpf("1e-40"), mp.nstr(det, 5))
    sc = cat["scoring"]["perZonePerKernel"]
    rep.add("catalog", "scoring points", sc == {"PASS": 1, "REFUSED_EXPECTED": 1, "REFUSED": 0, "ERROR": 0, "WRONG": 0, "NOT_RUN": 0}, "")
    rep.add("catalog", "measurement kinds documented", set(cat["measurements"]) >= MEASURE_KINDS, "")
    for z in zones:
        need = ["id", "group", "title", "intent", "construction", "fsFeatures", "b3dFeatures", "expected", "closedForm", "tolerance", "metamorphic", "kernelNotes", "cell"]
        if base is not None and z["id"] not in {b["id"] for b in base["zones"]}:
            need += ["variants", "family"]
        rep.add(z["id"], "fields", all(k in z for k in need), "")
        rep.add(z["id"], "kernelNotes complete", set(z["kernelNotes"]) == {"onshape", "occt", "wonkyBend", "wonkyRust"}, "")
        rep.add(z["id"], "silentWrong listed", len(z["expected"]["silentWrong"]) > 0, "")
        cls = {o["kernelClass"] for o in z["expected"]["outcomes"]}
        rep.add(z["id"], "outcomes cover exact and tolerance", "any" in cls or {"exact", "tolerance"} <= cls, str(sorted(cls)))
        names = [mm["name"] for mm in z["closedForm"].get("measurements", []) or []]
        rep.add(z["id"], "measurement names unique", len(names) == len(set(names)), "")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--zones", default=str(ZONES))
    ap.add_argument("--only", default="")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()
    cat = json.loads(Path(a.zones).read_text())
    by_id = {z["id"]: z for z in cat["zones"]}
    rep = Report()
    only = set(filter(None, a.only.split(",")))
    if not only:
        structural_checks(cat, rep)
    for z in cat["zones"]:
        if only and z["id"] not in only:
            continue
        try:
            check_zone(z, rep, by_id, cat)
        except Exception as exc:  # a checker crash is a failed check, reported, never swallowed
            rep.add(z["id"], "checker exception", False, f"{type(exc).__name__}: {exc}")
    by_zone = {}
    for zid, check, ok, detail in rep.rows:
        by_zone.setdefault(zid, []).append((check, ok, detail))
    for zid, rows in by_zone.items():
        bad = [r for r in rows if not r[1]]
        print(f"{zid}: {'OK  ' if not bad else 'FAIL'} {len(rows) - len(bad)}/{len(rows)} checks")
        for check, ok, detail in rows:
            if not ok or a.verbose:
                print(f"   {'ok  ' if ok else 'FAIL'} {check} {detail}")
    single = sum(1 for r in rep.rows if "single-route" in r[1])
    print(f"total checks {len(rep.rows)}, failed {rep.fail}, single-route V3 bbox checks {single}")
    sys.exit(1 if rep.fail else 0)


if __name__ == "__main__":
    main()
