"""Z3 first-principles measures and topology; no geometry-kernel imports.

Cross-bores: integrate the product of two disk chords in y. Exposed area
is the original shaft minus its two mouth patches plus the bore wall.
The independent route uses the bore angle for volume and exposed
wall area; the centered case additionally has complete elliptic K/E forms.
The tee is post + branch - half a Steinmetz solid, with exposed wall strips.
"""
import mpmath as mp
import sympy as s
from z1_forms import Q, N, integral_value as _integral_value

def integral_value(expr):
    # Endpoint square-root integrals need guard digits for 1e-28 expression checks.
    with mp.workdps(max(75, mp.mp.dps)):
        return _integral_value(expr)

IDS = ('AC106', 'AC107', 'AC108')
PARAMS = ('radius', 'R', 'shaft', 'tool', 'operation')

def forms(zid, p):
    r, R = Q(p['radius']), Q(p['R'])
    H = Q(p['shaft'][1][2])-Q(p['shaft'][0][2])
    if zid == 'AC107':
        L = Q(p['tool'][1][0])-Q(p['tool'][0][0])
        return s.pi*r*r*(H+L)-8*r**3/3, 2*s.pi*r*(H+L)+3*s.pi*r*r-8*r*r
    d = Q(p['tool'][0][1])
    if zid == 'AC106':
        m = r*r/(R*R); K, E = s.elliptic_k(m), s.elliptic_e(m)
        return (s.pi*R*R*H-8*R**3*((1+m)*E-(1-m)*K)/3,
                2*s.pi*R*H+2*s.pi*R*R-8*R*R*(E-(1-m)*K)+8*R*r*E)
    y = s.Symbol('y', real=True)
    a, b = s.sqrt(R*R-y*y), s.sqrt(r*r-(y-d)**2)
    return (s.pi*R*R*H-4*s.Integral(a*b,(y,d-r,d+r)),
            2*s.pi*R*H+2*s.pi*R*R-4*R*s.Integral(b/a,(y,d-r,d+r))+4*r*s.Integral(a/b,(y,d-r,d+r)))

def independent(zid, p):
    r, R = N(Q(p['radius'])), N(Q(p['R']))
    H = N(Q(p['shaft'][1][2])-Q(p['shaft'][0][2]))
    if zid == 'AC107':
        L = N(Q(p['tool'][1][0])-Q(p['tool'][0][0]))
        # y slabs of the half intersection: x in [0,sqrt(r²-y²)],
        # z in [-sqrt(r²-y²),sqrt(r²-y²)]. Surface strips in angle.
        overlap = mp.quad(lambda y:2*(r*r-y*y),[-r,0,r])
        cap = mp.quad(lambda y:2*mp.sqrt(r*r-y*y),[-r,0,r])
        post = mp.quad(lambda t:r*(H-2*r*mp.cos(t)),[-mp.pi/2,0,mp.pi/2])+mp.pi*r*H
        branch = mp.quad(lambda t:r*(L-r*abs(mp.sin(t))),[0,mp.pi/2,mp.pi,3*mp.pi/2,2*mp.pi])
        return (H+L)*cap-overlap,post+branch+3*cap
    d = N(Q(p['tool'][0][1]))
    a = lambda t:mp.sqrt(R*R-(d+r*mp.sin(t))**2)
    overlap = 4*r*r*mp.quad(lambda t:a(t)*mp.cos(t)**2,[-mp.pi/2,0,mp.pi/2])
    mouth = 4*R*r*r*mp.quad(lambda t:mp.cos(t)**2/a(t),[-mp.pi/2,0,mp.pi/2])
    # Independent bore wall is its circumference times local x-span.
    inner = 2*r*mp.quad(a,[-mp.pi/2,0,mp.pi/2,mp.pi,3*mp.pi/2])
    return mp.pi*R*R*H-overlap,2*mp.pi*R*H+2*mp.pi*R*R-mouth+inner

def premises(zid, p):
    r, R = Q(p['radius']), Q(p['R'])
    tee = zid == 'AC107'; d = 2 if zid == 'AC108' else 0
    yield 'shaft endpoints bind construction', p['shaft'] == [[0,0,-12 if tee else -20],[0,0,12 if tee else 20]]
    yield 'tool endpoints bind construction', p['tool'] == ([[0,0,0],[16,0,0]] if tee else [[-10,d,0],[10,d,0]])
    yield 'Boolean operation binds construction', p['operation'] == ('UNION' if tee else 'SUBTRACTION')
    yield 'radius is nominal or +0.025', r in (s.Integer(4 if tee else 2),s.Rational(161 if tee else 81,40))
    yield 'both circular radii receive the same bump', R-r == (0 if tee else 3)
    yield 'positive radius', r > 0
    yield 'cross-bore clear of caps and shaft extremal generators', tee or (R>d+r and r<20 and R<10)

def topology(zid):
    # Each closed circle/quartic ring counts as an edge with no vertex.
    # Bore: two cap disks; post wall with four loops; bore wall with two.
    # Tee: three cap disks; post wall three loops; branch wall two loops.
    return (5,5,2,8,3,0,0) if zid == 'AC107' else (4,4,0,8,4,1,0)

def branch_discriminant(p):
    """Shaft chart x=R(1-t²)/(1+t²), y=2Rt/(1+t²), z=v.

    The discriminant of (1+t²)² v² - [r²(1+t²)² -
    (2Rt-d(1+t²))²] in v includes its chart denominator.
    """
    t = s.Symbol('t'); r,R,d = Q(p['radius']),Q(p['R']),Q(p['tool'][0][1])
    numerator = s.expand(r*r*(1+t*t)**2-(2*R*t-d*(1+t*t))**2)
    return s.factor(4*(1+t*t)**2*numerator)
