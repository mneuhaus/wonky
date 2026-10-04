"""ZW1 first-principles contracts, independent of every CAD kernel.

A: radial moments, prismatoid sections and analytically integrated ruled area.
B: disk chords, meridian/path integration and direct surface Jacobians.
All angles here name the design classes; the FS binary64 angle remains the E9
payload, never a licence to snap it. Numerical differences are measured by the
existing bands, not silently replaced in the production kernel.
"""
import sympy as s
import mpmath as mp
IDS=tuple('AC'+str(i) for i in range(126,132))
Q=lambda x:s.sympify(str(x),rational=True)
N=lambda x:mp.mpf(str(s.N(x,70)))
PARAMS={
 'AC126':('radius','R','height','angleDegrees'),
 'AC127':('radius','R','height','angleDegrees'),
 'AC128':('radius','r','height'),
 'AC129':('radius','height'),
 'AC130':('radius','R','length'),
 'AC131':('radius','width','breadth','height','initialSlope','targetSlope'),
}

def forms(zid,p):
    r=Q(p['radius']);pi=s.pi
    if zid in ('AC126','AC127'):
        b=Q(p['R']);h=Q(p['height']);t=Q(p['angleDegrees'])*pi/180
        return t*h*(r*r-b*b)/2,t*((r+b)*h+r*r-b*b)+2*h*(r-b)
    if zid=='AC128':
        a=Q(p['r']);h=Q(p['height']);c=r-a
        return pi*(a*c*c+c*pi*a*a/2+2*a**3/3+r*r*(h-a)+2*r**3/3),pi*c*c+pi*pi*a*c+2*pi*a*a+2*pi*r*(h-a)+2*pi*r*r
    if zid=='AC129':
        a=r;h=Q(p['height']);t=s.Symbol('t',real=True);C=s.sqrt(2)/2;S=C
        B=h*h*(1-2*(1-C)*t*(1-t));d=a*(1-C)*(1-2*t)
        def f(w):return (w*s.sqrt(B+w*w)+B*s.asinh(w/s.sqrt(B)))/(2*S)
        area=8*a*a+4*s.Integral(f(d+a*S)-f(d-a*S),(t,0,1))
        return 4*a*a*h*(2+C)/3,area
    if zid=='AC130':
        R=Q(p['R']);L=Q(p['length']);path=L+pi*R/2
        return pi*r*r*path,2*pi*r*path+2*pi*r*r
    if zid=='AC131':
        w=Q(p['width']);b=Q(p['breadth']);h=Q(p['height']);k=Q(p['targetSlope'])
        V=b*(w*h-k*h*h/2)-pi*r*r*h
        A=b*(2*w-k*h)+b*h*(1+s.sqrt(1+k*k))+2*(w*h-k*h*h/2)-2*pi*r*r+2*pi*r*h
        return V,A
    raise ValueError(zid)

def independent(zid,p):
    r=N(Q(p['radius']));pi=mp.pi
    if zid in ('AC126','AC127'):
        b=N(Q(p['R']));h=N(Q(p['height']));t=N(Q(p['angleDegrees']))*pi/180
        V=mp.quad(lambda x:t*x*h,[b,r])
        A=mp.quad(lambda x:2*t*x,[b,r])+mp.quad(lambda z:t*(r+b),[0,h])+2*mp.quad(lambda z:r-b,[0,h])
        return V,A
    if zid=='AC128':
        a=N(Q(p['r']));h=N(Q(p['height']));c=r-a
        # Different variable: angular meridian for corner; axial sphere sections.
        V=pi*mp.quad(lambda u:(c+a*mp.cos(u))**2*a*mp.cos(u),[-pi/2,0])+pi*r*r*(h-a)+pi*mp.quad(lambda z:r*r-z*z,[0,r])
        A=pi*c*c+2*pi*mp.quad(lambda u:a*(c+a*mp.cos(u)),[-pi/2,0])+2*pi*r*(h-a)+2*pi*mp.quad(lambda u:r*r*mp.cos(u),[0,pi/2])
        return V,A
    if zid=='AC129':
        a=r;h=N(Q(p['height']));C=mp.sqrt(2)/2
        # Shoelace on linearly interpolated vertices, not the prismatoid formula.
        low=[(-a,-a),(a,-a),(a,a),(-a,a)];hi=[(C*(x-y),C*(x+y)) for x,y in low]
        def section(t):
            pts=[((1-t)*x+t*X,(1-t)*y+t*Y) for (x,y),(X,Y) in zip(low,hi)]
            return sum(x*Y-y*X for (x,y),(X,Y) in zip(pts,pts[1:]+pts[:1]))/2
        # Direct cross product of the two partial derivatives of each patch.
        p0=(*low[0],mp.mpf(0));p1=(*low[1],mp.mpf(0));q0=(*hi[0],h);q1=(*hi[1],h)
        def jac(u,t):
            du=[(1-t)*(p1[i]-p0[i])+t*(q1[i]-q0[i]) for i in range(3)]
            dt=[(1-u)*(q0[i]-p0[i])+u*(q1[i]-p1[i]) for i in range(3)]
            cross=[du[1]*dt[2]-du[2]*dt[1],du[2]*dt[0]-du[0]*dt[2],du[0]*dt[1]-du[1]*dt[0]]
            return mp.sqrt(sum(v*v for v in cross))
        A=8*a*a+4*mp.quad(lambda t:mp.quad(lambda u:jac(u,t),[0,1],method='gauss-legendre'),[0,1],method='gauss-legendre')
        return h*mp.quad(section,[0,1]),A
    if zid=='AC130':
        R=N(Q(p['R']));L=N(Q(p['length']))
        disk=mp.quad(lambda y:2*mp.sqrt(max(0,r*r-y*y)),[-r,0,r])
        # Torus Jacobian R+rho*cos(v); odd moment cancels independently.
        V=disk*L+mp.quad(lambda v:(R+r*mp.cos(v))*r*r/2,[0,pi,2*pi])*pi/2
        A=2*pi*r*L+mp.quad(lambda v:r*(R+r*mp.cos(v)),[0,pi,2*pi])*pi/2+2*disk
        return V,A
    if zid=='AC131':
        w=N(Q(p['width']));b=N(Q(p['breadth']));h=N(Q(p['height']));k=N(Q(p['targetSlope']))
        # Section chords of untouched bore + six exposed planes/cylinder.
        disk=mp.quad(lambda y:2*mp.sqrt(max(0,r*r-y*y)),[-r,0,r])
        V=mp.quad(lambda z:b*(w-k*z)-disk,[0,h])
        A=b*w-disk+b*(w-k*h)-disk+b*h+mp.quad(lambda z:b*mp.sqrt(1+k*k)+2*(w-k*z),[0,h])+2*pi*r*h
        return V,A
    raise ValueError(zid)

def topology(zid):
    # Canonical rings have no seam vertices; knots do not introduce faces.
    if zid in ('AC126','AC127','AC129'):return (6,12,8,6,0)
    if zid in ('AC128','AC130'):return (4,3,0,6,3)
    if zid=='AC131':return (7,14,8,10,2)
    raise ValueError(zid)

def extrema_arc(A,B,lo,hi):
    ts=[lo,hi];t=mp.atan2(B,A)
    for k in range(-3,4):
        u=t+k*mp.pi
        if lo<=u<=hi:ts.append(u)
    return [A*mp.cos(t)+B*mp.sin(t) for t in ts]

def support(zid,p,n):
    """Exact candidate extrema from vertices/arcs; returns directional maximum."""
    r=N(Q(p['radius']));x,y,z=n
    if zid in ('AC126','AC127'):
        b=N(Q(p['R']));h=N(Q(p['height']));theta=N(Q(p['angleDegrees']))*mp.pi/180
        vals=extrema_arc(x,y,0,theta)
        return max(v*rr+z*zz for v in vals for rr in (b,r) for zz in (0,h))
    if zid=='AC128':
        a=N(Q(p['r']));h=N(Q(p['height']));q=mp.sqrt(x*x+y*y);c=r-a
        return max(q*c, q*r+z*a,q*r+z*h, z*(h+r),q*c+z*a+a*max(extrema_arc(q,z,-mp.pi/2,0)),z*h+r*max(extrema_arc(q,z,0,mp.pi/2)))
    if zid=='AC129':
        a=r;h=N(Q(p['height']));C=mp.sqrt(2)/2
        pts=[(X,Y,0) for X,Y in ((-a,-a),(a,-a),(a,a),(-a,a))]
        pts += [(C*(X-Y),C*(X+Y),h) for X,Y,_ in pts[:]]
        return max(x*X+y*Y+z*Z for X,Y,Z in pts)
    if zid=='AC130':
        R=N(Q(p['R']));L=N(Q(p['length']))
        line=max(0,x*L)+r*mp.sqrt(y*y+z*z)
        v=max(extrema_arc(x,y,-mp.pi/2,0))
        bend=x*L+y*R+R*v+r*mp.sqrt(v*v+z*z)
        return max(line,bend)
    if zid=='AC131':
        w=N(Q(p['width']));b=N(Q(p['breadth']));h=N(Q(p['height']));k=N(Q(p['targetSlope']))
        return max(x*X+y*Y+z*Z for Z in (0,h) for X in (0,w-k*Z) for Y in (0,b))
    raise ValueError(zid)

def bbox(zid,p,M,t):
    return ([t[i]-support(zid,p,[-v for v in M[i]]) for i in range(3)], [t[i]+support(zid,p,M[i]) for i in range(3)])

def numerical_max(fn,lo,hi):
    """Second support route: evaluate a parameterized boundary and locate extrema.

    Smooth trigonometric intervals here are <= one quadrant, with no singular
    Jacobian. Bracket every derivative sign change on 32 subdivisions, solve at
    50 decimal digits, include endpoints; this is verification, never geometry.
    """
    grid=[lo+(hi-lo)*i/32 for i in range(33)]
    df=lambda t:mp.diff(fn,t)
    ds=[df(t) for t in grid];candidates=[fn(lo),fn(hi)]
    for a,b,da,db in zip(grid,grid[1:],ds,ds[1:]):
        if da==0:candidates.append(fn(a))
        if da*db<0:
            root=mp.findroot(df,(a,b),solver='anderson')
            if lo<=root<=hi:candidates.append(fn(root))
    return max(candidates)

def support_second(zid,p,n):
    r=N(Q(p['radius']));x,y,z=n
    if zid in ('AC126','AC127'):
        b=N(Q(p['R']));h=N(Q(p['height']));t=N(Q(p['angleDegrees']))*mp.pi/180
        return max(numerical_max(lambda u:rr*(x*mp.cos(u)+y*mp.sin(u))+z*zz,0,t) for rr in (b,r) for zz in (0,h))
    if zid=='AC128':
        a=N(Q(p['r']));h=N(Q(p['height']));c=r-a;q=mp.sqrt(x*x+y*y)
        corner=numerical_max(lambda u:q*(c+a*mp.cos(u))+z*(a+a*mp.sin(u)),-mp.pi/2,0)
        sphere=numerical_max(lambda u:q*r*mp.cos(u)+z*(h+r*mp.sin(u)),0,mp.pi/2)
        return max(corner,sphere,q*r+z*a,q*r+z*h,q*c)
    if zid=='AC129':
        a=r;h=N(Q(p['height']));C=mp.sqrt(2)/2
        vertices=[(-a,-a),(a,-a),(a,a),(-a,a)]
        # Bilinear interpolation: an affine objective in each parameter attains
        # its extrema at the four patch corners, independently of hull support.
        vals=[]
        for i in range(4):
            p0=vertices[i];p1=vertices[(i+1)%4]
            q0=(C*(p0[0]-p0[1]),C*(p0[0]+p0[1]));q1=(C*(p1[0]-p1[1]),C*(p1[0]+p1[1]))
            for u in (0,1):
                for t in (0,1):
                    X=(1-t)*((1-u)*p0[0]+u*p1[0])+t*((1-u)*q0[0]+u*q1[0])
                    Y=(1-t)*((1-u)*p0[1]+u*p1[1])+t*((1-u)*q0[1]+u*q1[1])
                    vals.append(x*X+y*Y+z*h*t)
        return max(vals)
    if zid=='AC130':
        R=N(Q(p['R']));L=N(Q(p['length']))
        def elbow(u):
            nr=x*mp.cos(u)+y*mp.sin(u)
            return x*(L+R*mp.cos(u))+y*(R+R*mp.sin(u))+r*mp.sqrt(nr*nr+z*z)
        return max(numerical_max(elbow,-mp.pi/2,0),max(0,x*L)+r*mp.sqrt(y*y+z*z))
    if zid=='AC131':
        w=N(Q(p['width']));b=N(Q(p['breadth']));h=N(Q(p['height']));k=N(Q(p['targetSlope']))
        # Integrate affine section support law by checking endpoints in z.
        fn=lambda Z:max(0,x*(w-k*Z))+max(0,y*b)+z*Z
        return max(fn(0),fn(h))
    raise ValueError(zid)

def verify_support(zid,p,M):
    deltas=[abs(support(zid,p,[sign*x for x in row])-support_second(zid,p,[sign*x for x in row])) for row in M for sign in (-1,1)]
    return max(deltas)
