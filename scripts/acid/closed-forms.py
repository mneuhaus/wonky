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


def loop_area_perimeter(loop):
    area, per = 0, 0
    for seg in loop:
        if seg[0] == "L":
            (x0, y0), (x1, y1) = seg[1], seg[2]
            area += (x0 * y1 - x1 * y0) / 2
            per += sp.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2)
        else:
            (cx, cy), r, t0, t1 = seg[1], seg[2], seg[3], seg[4]
            area += (r ** 2 * (t1 - t0) + cx * r * (sp.sin(t1) - sp.sin(t0)) - cy * r * (sp.cos(t1) - sp.cos(t0))) / 2
            per += r * sp.Abs(t1 - t0)
    return area, per


def prism(loops, h):
    area = sum(loop_area_perimeter(lp)[0] for lp in loops)
    per = sum(loop_area_perimeter(lp)[1] for lp in loops)
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
    c = [num(v) for v in seg[1]]
    r = num(seg[2])
    t0, t1 = sorted([num(seg[3]), num(seg[4])])
    ang = mp.atan2(p[1] - c[1], p[0] - c[0])
    for k in range(-2, 3):
        if t0 <= ang + 2 * mp.pi * k <= t1:
            return abs(mp.sqrt((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2) - r)
    ends = [[c[0] + r * mp.cos(t), c[1] + r * mp.sin(t)] for t in (t0, t1)]
    return min(mp.sqrt((p[0] - e[0]) ** 2 + (p[1] - e[1]) ** 2) for e in ends)


def winding(p, loops):
    tot = mp.mpf(0)
    for loop in loops:
        pts = []
        for seg in loop:
            if seg[0] == "L":
                pts.append([num(v) for v in seg[1]])
            else:
                c = [num(v) for v in seg[1]]
                r, t0, t1 = num(seg[2]), num(seg[3]), num(seg[4])
                for i in range(64):
                    t = t0 + (t1 - t0) * i / 64
                    pts.append([c[0] + r * mp.cos(t), c[1] + r * mp.sin(t)])
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


PREC = {"exact": 1e-25, "quad": 1e-20, "e9": 1e-12, "numeric": None}
SYMLOC = {"pi": sp.pi, "sqrt": sp.sqrt, "Rational": sp.Rational, "K": lambda m_: sp.elliptic_k(m_), "E": lambda m_: sp.elliptic_e(m_)}
MEASURE_KINDS = {"probeDistance", "bodyDistance", "bboxExtent", "edgeLength", "lineDistance"}


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


def expr_check(zid, label, item, rep, subs):
    e = sp.sympify(item["expression"], locals=SYMLOC)
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


def bbox_checks(z, m, rep):
    zid, cf = z["id"], z["closedForm"]
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
        rep.add(zid, f"bbox local [{name}]", ok, f"{[float(x) for x in lo]} {[float(x) for x in hi]}")
    for k, (Mx, t) in VARIANTS.items():
        stored = bb.get("variants", {}).get(k)
        if stored is None:
            ok = k == "V3" and cf.get("bboxV3CrossComparison")
            rep.add(zid, f"bbox {k} absent", bool(ok), "cross-comparison only" if ok else "missing")
            continue
        for name, fn in routes:
            lo, hi = fn(Mx, t)
            ok = all(close(lo[i], stored["min"][i], absol=1e-9) and close(hi[i], stored["max"][i], absol=1e-9) for i in range(3))
            tag = f"{name}, single-route" if (single and k == "V3") else name
            rep.add(zid, f"bbox {k} [{tag}]", ok, "" if ok else f"route {[float(x) for x in lo]} {[float(x) for x in hi]} vs stored {stored}")
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


def check_zone(z, rep, cat_by_id):
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


def structural_checks(cat, rep):
    zones = cat["zones"]
    ids = [z["id"] for z in zones]
    retired = [r["id"] for r in cat.get("retiredZones", [])]
    rep.add("catalog", "zone count 36..48", 36 <= len(zones) <= 48, str(len(zones)))
    rep.add("catalog", "unique ids", len(set(ids)) == len(ids), "")
    rep.add("catalog", "ids match ACnn", all(re.fullmatch(r"AC\d\d", i) for i in ids), "")
    rep.add("catalog", "retired ids never reused", not (set(retired) & set(ids)), str(retired))
    rep.add("catalog", "every retired zone gives a reason", all(r.get("reason") for r in cat.get("retiredZones", [])), "")
    order = [z["group"] for z in zones]
    rep.add("catalog", "zones grouped contiguously in group order", order == sorted(order, key=[g["id"] for g in cat["groups"]].index), "")
    for g in cat["groups"]:
        rep.add("catalog", f"group {g['id']} size 8..12", 8 <= len(g["zoneIds"]) <= 12, str(len(g["zoneIds"])))
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
            check_zone(z, rep, by_id)
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
