"""First-principles Z1 contracts. No geometry kernel imports.

Route A: elementary measures, circular segments and layer-cake integrals.
Route B: section quadrature, explicit exposed surfaces and polar integration.
AC117's wall integral also has an independent incomplete elliptic-E route.
"""
import mpmath as mp
import sympy as s

IDS = ('AC66','AC74','AC111','AC112','AC113','AC115','AC117')
Q = lambda x: s.sympify(str(x), rational=True)
N = lambda x: mp.mpf(str(s.N(x, 65)))

def integral_value(expr):
    """Evaluate explicit one-dimensional definite integrals at the caller's precision."""
    expr = s.sympify(expr, rational=True)
    for i in expr.atoms(s.Integral):
        assert len(i.limits) == 1 and len(i.limits[0]) == 3
        t, a, b = i.limits[0]
        f = s.lambdify(t, i.function, modules='mpmath')
        val = mp.quad(f, [N(a), (N(a)+N(b))/2, N(b)])
        expr = expr.xreplace({i: s.Float(str(mp.re(val)), mp.mp.dps)})
    return N(expr)

def lens(R,r,d):
    return R**2*s.acos((d*d+R*R-r*r)/(2*d*R))+r**2*s.acos((d*d+r*r-R*R)/(2*d*r))-s.sqrt((-d+r+R)*(d+r-R)*(d-r+R)*(d+r+R))/2

def forms(zid,p):
    r=Q(p['radius']); pi=s.pi
    if zid=='AC66':
        return 5440-10*pi*r*r, 2296-2*pi*r*r+20*pi*r
    if zid=='AC74':
        R=r+2
        removed=6*pi*r*r+2*pi*(r*r+r*R+R*R)/3
        return 6144-removed, 2432-pi*(r*r+R*R)+12*pi*r+pi*(r+R)*s.sqrt(8)
    if zid=='AC111':
        top=r*r*s.acos(-2/r)+2*s.sqrt(r*r-4)
        return 4000-pi*(r**3+3*r*r-4)/3,1600-top-pi*(r*r-4)/2+pi*r*(r+2)
    if zid=='AC112':
        R=r+1; a=(R*R-r*r+36)/12; b=6-a
        cap=pi*(R*R+r*r)-lens(R,r,s.Integer(6))
        return 10*cap,2*cap+20*(R*(pi-s.acos(a/R))+r*(pi-s.acos(b/r)))
    if zid=='AC113':
        C=12*r+pi*r*r/2
        low=6*(r-4)+r*r*s.acos(4/r)/2-2*s.sqrt(r*r-16)
        return 30*C+1760-(4*C+6*low),1480+46*r+26*pi*r-6*r*s.acos(4/r)-6*s.sqrt(r*r-16)
    if zid=='AC115':
        a=Q(p['axisY']); cut=pi*r*r
        wall=20*pi*r; opening=0
        if r>a:
            theta=s.acos(a/r);cut-=r*r*theta-a*s.sqrt(r*r-a*a)
            wall=20*r*(pi-theta);opening=20*s.sqrt(r*r-a*a)
        return 3200-10*cut,1360-2*cut+wall-opening
    if zid=='AC117':
        scale=r/s.Rational(13,2); n=s.sqrt(109)/2*scale; d=15*s.sqrt(2)/2*scale; c=s.Rational(15,2)*scale
        rho=s.Symbol('rho', real=True); psi=s.Symbol('psi',real=True)
        L=lens(r,n,d); cap=pi*r*r-4*L
        extra=4*s.Integral(lens(rho,n,d),(rho,d-n,r))
        alpha=s.acos((d*d+n*n-r*r)/(2*d*n))
        wall=4*n*s.Integral(12-r+s.sqrt(d*d+n*n-2*d*n*s.cos(psi)),(psi,-alpha,alpha))
        angle=2*pi-8*s.acos((d*d+r*r-n*n)/(2*d*r))
        return 6400-12*cap-extra,2080-pi*r*r+cap+12*r*angle+wall+4*s.sqrt(2)*L
    raise ValueError(zid)

def independent(zid,p):
    """Different parameterizations from route A; returns measured V,A without kernels."""
    r=N(Q(p['radius'])); pi=mp.pi
    if zid=='AC66':
        # Integrate disk chords; area is face-by-face (pocket opening cancels floor).
        disk=mp.quad(lambda x:2*mp.sqrt(max(0,r*r-x*x)),[-r,0,r])
        return 32*18*10-10*disk-8*10*4, 2*(32*18+32*10+18*10)-2*disk+2*pi*r*10+2*(8+10)*4
    if zid=='AC74':
        R=r+2
        V=6144-mp.quad(lambda z:pi*(r+max(0,z-6))**2,[0,6,8])
        A=2*(32*24+32*8+24*8)-pi*r*r-pi*R*R+2*pi*r*6+mp.quad(lambda z:2*pi*(r+z-6)*mp.sqrt(2),[6,8])
        return V,A
    if zid=='AC111':
        # y slabs: half a disk of radius sqrt(r²-y²).
        rem=mp.quad(lambda y:pi*(r*r-y*y)/2,[-2,r])
        top=mp.quad(lambda y:2*mp.sqrt(max(0,r*r-y*y)),[-2,0,r])
        front=mp.quad(lambda z:2*mp.sqrt(max(0,r*r-4-z*z)),[-mp.sqrt(r*r-4),0])
        sphere=mp.quad(lambda y:pi*r,[-2,r])
        return 4000-rem,1600-top-front+sphere
    if zid=='AC112':
        R=r+1; a=(R*R-r*r+36)/12;b=6-a
        # x slabs of union: max of the two vertical chords, switching at a.
        cap=mp.quad(lambda x:2*mp.sqrt(max(0,R*R-x*x)),[-R,0,a])+mp.quad(lambda x:2*mp.sqrt(max(0,r*r-(x-6)**2)),[a,6,6+r])
        per=mp.quad(lambda t:R, [mp.acos(a/R),2*pi-mp.acos(a/R)])+mp.quad(lambda t:r,[-pi+mp.acos(b/r),pi-mp.acos(b/r)])
        return 10*cap,2*cap+10*per
    if zid=='AC113':
        h=lambda y:6+mp.sqrt(max(0,r*r-y*y))
        C=mp.quad(h,[-r,0,r]); overlap=mp.quad(lambda y:10*h(y),[-r,-4])+mp.quad(lambda y:4*h(y),[-4,0,r])
        # Surface subtraction, integrating cylinder in its angle chart.
        roof=mp.quad(lambda t:4*r,[0,pi])+mp.quad(lambda t:6*r,[pi-mp.acos(4/r),pi])
        # Direct ownership of EXPOSED faces, rather than subtracting the
        # boundary of the volume overlap: coplanar bottom is retained once.
        arch_ends=2*C
        arch_straight_walls=6*((30-10)+(30-4))
        arch_roof=30*pi*r-roof
        union_bottom=60*r+88-(14*r-24)
        L_top=88
        L_exposed_walls=20*52-2*C-6*h(-4)
        return 30*C+20*88-overlap,arch_ends+arch_straight_walls+arch_roof+union_bottom+L_top+L_exposed_walls
    if zid=='AC115':
        a=N(Q(p['axisY'])); low=max(-r,-a)
        cap=mp.quad(lambda y:2*mp.sqrt(max(0,r*r-y*y)),[low,0,r])
        theta=mp.acos(a/r) if r>a else 0
        opening=2*mp.sqrt(r*r-a*a) if r>a else 0
        return 3200-10*cap,1360-2*cap+mp.quad(lambda t:10*r,[theta,2*pi-theta])-10*opening
    if zid=='AC117':
        n=mp.sqrt(109)/2*r/mp.mpf('6.5');d=15*mp.sqrt(2)/2*r/mp.mpf('6.5')
        beta=mp.acos((d*d+r*r-n*n)/(2*d*r));alpha=mp.acos((d*d+n*n-r*r)/(2*d*n))
        q=lambda t:d*mp.cos(t)-mp.sqrt(max(0,n*n-d*d*mp.sin(t)**2))
        # Polar sectors of removed notch lenses, radial antiderivatives.
        L=mp.quad(lambda t:(r*r-q(t)**2)/2,[-beta,0,beta])
        extra=4*mp.quad(lambda t:r*(r*r-q(t)**2)/2-(r**3-q(t)**3)/3,[-beta,0,beta])
        cap=pi*r*r-4*L
        wall=4*n*((12-r)*2*alpha+4*(d-n)*mp.ellipe(alpha/2,-4*d*n/(d-n)**2))
        # Cone patch measured in radial section, unlike route A's lens-area formula.
        cone=4*mp.sqrt(2)*mp.quad(lambda rho:2*rho*mp.acos(min(1,(d*d+rho*rho-n*n)/(2*d*rho))),[d-n,r])
        return 6400-12*cap-extra,2080-pi*r*r+cap+12*r*(2*pi-8*beta)+wall+cone
    raise ValueError(zid)

TOPOLOGY = {
 'AC66':(12,26,16,16,2,1), 'AC74':(8,15,8,12,3,1),
 'AC111':(7,15,10,7,0,0), 'AC112':(4,6,4,4,0,0),
 'AC113':(16,42,28,16,0,0), 'AC115':(7,14,8,10,2,1),
 'AC117':(19,40,24,20,0,0)}

def topology(zid,p):
    if zid=='AC115' and Q(p['radius'])>Q(p['axisY']):return (8,18,12,8,0,0)
    return TOPOLOGY[zid]

PARAMS = {
 'AC66':{'radius':2,'box':[[0,0,0],[32,18,10]],'bore':[[8,9,-1],[8,9,11]],'pocket':[[20,4,6],[28,14,12]]},
 'AC74':{'radius':2,'box':[[0,0,0],[32,24,8]],'axis':[16,12],'profile':'(0,-1),(r,-1),(r,6),(r+2,8),(r+2,10),(0,10)'},
 'AC111':{'radius':4,'box':[[0,0,0],[20,20,10]],'centre':[10,2,10],'frontCircleRationalPoint':False},
 'AC112':{'radius':4,'axes':[[0,0],[6,0]],'height':10,'otherRadius':'radius+1'},
 'AC113':{'radius':5,'archHeight':6,'length':30,'profile':[[10,-8],[20,-8],[20,8],[16,8],[16,-4],[10,-4]],'depth':20},
 'AC115':{'radius':4,'box':[[0,0,0],[20,16,10]],'axisX':10,'axisY':'4 + 1/1073741824','toolZ':[-1,11]},
 'AC117':{'radius':'13/2','box':[[-10,-10,-16],[10,10,0]],'prismDepth':12,'lobeRatios':{'corners':[[12,5],[5,12]],'denominator':13,'notchCentre':[15,15]},'coneSlope':1}}

def premises(zid,p):
    """Literal premises used by the displayed derivations, radius bound separately."""
    checks=[(f'{k} binds construction',p[k]==v) for k,v in PARAMS[zid].items() if k!='radius']
    r=Q(p['radius']);r0=Q(PARAMS[zid]['radius'])
    checks.append(('radius is nominal or declared +0.025',r in (r0,r0+s.Rational(1,40))))
    if zid=='AC111':
        # At r=4: x²+z²=12 has no rational point. Clearing denominators and
        # reducing mod 3 forces all coordinates and the denominator divisible
        # by 3, contradicting primitive integer coordinates (infinite descent).
        checks.append(('E9 no fabricated rational point on front circle',p['frontCircleRationalPoint'] is False))
    return checks

def rim_si_residual():
    """E9: 5-12-13 mm literals do not remain a Pythagorean triple in SI."""
    from fractions import Fraction
    x,y,R=(Fraction(v*0.001) for v in (6,2.5,6.5))
    return x*x+y*y-R*R
