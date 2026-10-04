"""ZF1 first-principles contracts; no CAD kernel imports or observations.

A: elementary antiderivatives / Green boundary formula.
B: independent section quadrature and face-chart integration, at 60 digits.
All coordinates are nominal mm; no exact SI tangency is assumed for sketch arcs.
"""
import sympy as s
import mpmath as mp
Q=lambda x:s.sympify(str(x),rational=True)
N=lambda x:mp.mpf(str(s.N(x,65)))
IDS=tuple('AC'+str(i) for i in range(118,124))
PARAMS={
 'AC118':dict(radius=1,width='1/2',side=24,height=8,angle='pi/3'),
 'AC119':dict(radius='1/2',stockRadius=10,height=8,boreRadius=2,sinkRadius=4,sinkDepth=2),
 'AC120':dict(radius=1,arc={'radius':6},height=8),
 'AC121':dict(radius=1,boss={'radius':4},plate=[[-16,-16,0],[16,16,4]],bossHeight=8),
 'AC122':dict(radius=1,side=24,height=8,angle='pi/3'),
 'AC123':dict(radius=1,width='radius',box=[[0,0,0],[32,24,8]])}
TOPOLOGY={'AC118':(7,15,10,7,0,0,0),'AC119':(6,6,0,12,6,1,0),
 'AC120':(5,9,6,5,0,0,0),'AC121':(9,15,8,12,3,0,0),
 'AC122':(9,18,11,9,0,0,0),'AC123':(18,36,20,18,0,0,4)}

def forms(z,p):
 r=Q(p['radius']);pi=s.pi
 if z=='AC118':
  w=Q(p['width']);L=Q(p['side']);h=Q(p['height']);a=s.acos(1-w/r);t=s.Symbol('t',real=True)
  y=r*(1-s.cos(t));W=L-y/s.sqrt(3)-s.sqrt(3)*r+r*s.sin(t)
  I=s.integrate(s.expand_trig(W*r*s.sin(t)),(t,0,a))
  D=s.integrate(s.expand_trig((w-y)*W*r*s.sin(t)),(t,0,a))
  J=r*((w-r)*a+r*s.sin(a))
  A=s.sqrt(3)*L**2/4-(s.sqrt(3)-pi/3)*r*r
  P=3*L-2*s.sqrt(3)*r+2*pi*r/3
  return s.simplify(h*A-D),s.simplify(2*A+h*P+(s.sqrt(2)-1)*I-w*(L-s.sqrt(3)*r)-J-w*w/s.sqrt(3))
 if z=='AC119':
  R=Q(p['stockRadius']);h=Q(p['height']);b=Q(p['boreRadius']);c=Q(p['sinkRadius']);d=Q(p['sinkDepth']);a=r/s.sqrt(2)
  V=pi*R*R*h-pi*b*b*(h-d)-pi*d*(b*b+b*c+c*c)/3-pi*a*r*(3*c-a+r)/3
  A=2*pi*R*h+pi*(R*R-b*b)+pi*(R*R-(c+r)**2)+2*pi*b*(h-d)+pi*(b+c-a)*(d-a)*s.sqrt(2)+pi*(2*c+r-a)*s.sqrt(a*a+(r+a)**2)
  return V,A
 if z=='AC120':
  R=Q(p['arc']['radius']);h=Q(p['height']);c=s.sqrt(R*R-2*R*r);a=s.acos(r/(R-r))
  A=(R*R*(a+pi/2)+r*r*(pi-a)-r*r*s.sin(a)+r*c*(1+s.cos(a)))/2
  P=R*(a+pi/2)+r*(pi-a)+c+R
  return h*A,2*A+h*P
 if z=='AC121':
  R=Q(p['boss']['radius']);h=Q(p['bossHeight']);lo,hi=p['plate'];W=Q(hi[0]-lo[0]);D=Q(hi[1]-lo[1]);H=Q(hi[2]-lo[2]);M=R+r
  V=W*D*H+pi*R*R*h+pi*(2*R*r*r+5*r**3/3-pi*M*r*r/2)
  A=2*(W*D+(W+D)*H)+2*pi*R*h-pi*(M*M-R*R)-2*pi*R*r+2*pi*r*(M*pi/2-r)
  return V,A
 if z=='AC122':
  L=Q(p['side']);h=Q(p['height']);C=s.sqrt(3)-pi/3
  A0=s.sqrt(3)*L*L/4-C*r*r;Ab=s.sqrt(3)*(L-4*r/s.sqrt(3))**2/4
  # t=sqrt(r²-(z-r)²); integral t dz=pi*r²/4, integral t² dz=2*r³/3.
  q=L-4*r/s.sqrt(3)
  V=(h-r)*A0+s.sqrt(3)/4*(q*q*r+8*q/s.sqrt(3)*pi*r*r/4+16*s.Rational(1,3)*2*r**3/3)-C*2*r**3/3
  far=L*(h-r)+q*r+pi*r*r/s.sqrt(3)
  bottom=2*r*((L-s.sqrt(3)*r)*pi/2-r/s.sqrt(3)*(pi/2-1))
  A=Ab+A0+2*(L-s.sqrt(3)*r)*(h-r)+far+2*pi*r*(h-r)/3+bottom+2*pi*r*r/3
  return s.simplify(V),s.simplify(A)
 if z=='AC123':
  lo,hi=p['box'];W=Q(hi[0]-lo[0]);D=Q(hi[1]-lo[1]);h=Q(hi[2]-lo[2]);a=W-2*r;b=D-2*r
  Ar=a*b+2*(a+b)*r+pi*r*r;Pr=2*(a+b)+2*pi*r
  return (h-r)*Ar+a*b*r+(a+b)*r*r+pi*r**3/3,Ar+a*b+(h-r)*Pr+s.sqrt(2)*(2*(a+b)*r+pi*r*r)
 raise ValueError(z)

def independent(z,p):
 r=N(Q(p['radius']));pi=mp.pi;quad=mp.quad
 if z=='AC118':
  w=N(Q(p['width']));L=N(Q(p['side']));h=N(Q(p['height']));a=mp.acos(1-w/r)
  # Horizontal strips; y=r(1-cos t) used only to regularize square-root endpoint.
  width=lambda y:L-y/mp.sqrt(3)-mp.sqrt(3)*r+mp.sqrt(max(0,r*r-(y-r)**2))
  # Polygon shoelace minus triangle and circular segment at the acute vertex.
  cut=mp.sqrt(3)*r*r-pi*r*r/3;A=mp.sqrt(3)*L*L/4-cut
  removed=quad(lambda y:(w-y)*width(y),[0,w/2,w])
  opening=quad(width,[0,w/2,w])
  cylinder=quad(lambda t:(w-r+r*mp.cos(t))*r,[0,a])
  P=3*L-2*mp.sqrt(3)*r+2*pi*r/3
  return h*A-removed,2*A+h*P-opening-w*(L-mp.sqrt(3)*r)-w*w/mp.sqrt(3)-cylinder+mp.sqrt(2)*opening
 if z=='AC119':
  R=N(Q(p['stockRadius']));h=N(Q(p['height']));b=N(Q(p['boreRadius']));c=N(Q(p['sinkRadius']));d=N(Q(p['sinkDepth']));a=r/mp.sqrt(2)
  rho=lambda z:b if z<=h-d else (b+z-h+d if z<=h-a else c-a+(z-h+a)*(r+a)/a)
  V=quad(lambda z:pi*(R*R-rho(z)**2),[0,h-d,h-a,h])
  walls=2*pi*b*(h-d)+quad(lambda z:2*pi*rho(z)*mp.sqrt(2),[h-d,h-a])+quad(lambda z:2*pi*rho(z)*mp.sqrt(1+((r+a)/a)**2),[h-a,h])
  return V,2*pi*R*h+pi*(2*R*R-b*b-(c+r)**2)+walls
 if z=='AC120':
  R=N(Q(p['arc']['radius']));h=N(Q(p['height']));c=mp.sqrt(R*R-2*R*r);a=mp.acos(r/(R-r))
  # Green line integral on each arc, independently parameterized Cartesian boundary.
  A=quad(lambda t:R*R/2,[-pi/2,0,a])+quad(lambda t:(r*r+r*r*mp.cos(t)+r*c*mp.sin(t))/2,[a,pi/2,pi])
  P=quad(lambda t:R,[-pi/2,a])+quad(lambda t:r,[a,pi])+c+R
  return h*A,2*A+h*P
 if z=='AC121':
  R=N(Q(p['boss']['radius']));h=N(Q(p['bossHeight']));lo,hi=p['plate'];W=hi[0]-lo[0];D=hi[1]-lo[1];H=hi[2]-lo[2]
  # radial shells: blend height r-sqrt(r²-(rho-R-r)²).
  extra=quad(lambda t:2*pi*(R+r-r*mp.cos(t))*(r-r*mp.sin(t))*r*mp.sin(t),[0,pi/2])
  torus=quad(lambda t:2*pi*(R+r-r*mp.cos(t))*r,[0,pi/2])
  return W*D*H+pi*R*R*h+extra,2*(W*D+(W+D)*H)+2*pi*R*(h-r)-pi*((R+r)**2-R*R)+torus
 if z=='AC122':
  L=N(Q(p['side']));h=N(Q(p['height']));C=mp.sqrt(3)-pi/3
  sec=lambda z:mp.sqrt(3)/4*(L-4*(r-mp.sqrt(max(0,r*r-(z-r)**2)))/mp.sqrt(3))**2-C*(r*r-(z-r)**2)
  A0=mp.sqrt(3)*L*L/4-C*r*r;Ab=mp.sqrt(3)/4*(L-4*r/mp.sqrt(3))**2
  V=quad(sec,[0,r/2,r])+(h-r)*A0
  far=quad(lambda z:L-4*(r-mp.sqrt(max(0,r*r-(z-r)**2)))/mp.sqrt(3),[0,r/2,r])+L*(h-r)
  bottom=2*quad(lambda t:r*(L-mp.sqrt(3)*r-(r-r*mp.sin(t))/mp.sqrt(3)),[0,pi/2])
  sphere=quad(lambda t:2*pi/3*r*r*mp.sin(t),[0,pi/2])
  return V,Ab+A0+2*(L-mp.sqrt(3)*r)*(h-r)+far+2*pi/3*r*(h-r)+bottom+sphere
 if z=='AC123':
  lo,hi=p['box'];W=hi[0]-lo[0];D=hi[1]-lo[1];h=hi[2]-lo[2];a=W-2*r;b=D-2*r
  area=lambda s:a*b+2*(a+b)*s+pi*s*s
  # Sections consist of rectangle, four strips, four quarter disks.
  V=(h-r)*area(r)+quad(lambda z:area(h-z),[h-r,h])
  chamfer=quad(lambda s:mp.sqrt(2)*(2*(a+b)+2*pi*s),[0,r])
  return V,area(r)+a*b+(h-r)*(2*(a+b)+2*pi*r)+chamfer
 raise ValueError(z)

def premises(z,p):
 checks=[]
 for k,v in PARAMS[z].items():
  if k=='radius':continue
  if k in ('arc','boss'):
   checks.append((k+' nominal/+0.025 radius',Q(p[k]['radius']) in (Q(v['radius']),Q(v['radius'])+s.Rational(1,40))))
  else:checks.append((k+' construction binding',p[k]==v))
 checks.append(('fillet radius nominal/+0.025',Q(p['radius']) in (Q(PARAMS[z]['radius']),Q(PARAMS[z]['radius'])+s.Rational(1,40))))
 return checks

def elements(z,p):
 """Exact support candidates, including trimmed circles and sphere-sector critical points."""
 r=N(Q(p['radius']));pi=mp.pi;rt=mp.sqrt(3)
 pt=lambda p:('pt',list(map(mp.mpf,p)))
 arc=lambda c,P,Q,a,b:('arc',list(map(mp.mpf,c)),list(map(mp.mpf,P)),list(map(mp.mpf,Q)),mp.mpf(a),mp.mpf(b))
 circle=lambda R,h:arc([0,0,h],[R,0,0],[0,R,0],0,2*pi)
 if z=='AC119':return [circle(N(Q(p['stockRadius'])),h) for h in (0,p['height'])]
 if z=='AC121':
  lo,hi=p['plate'];pts=[pt([x,y,h]) for x in (lo[0],hi[0]) for y in (lo[1],hi[1]) for h in (lo[2],hi[2])]
  return pts+[circle(N(Q(p['boss']['radius'])),hi[2]+p['bossHeight'])]
 if z=='AC120':
  R=N(Q(p['arc']['radius']));c=mp.sqrt(R*R-2*R*r);a=mp.acos(r/(R-r))
  return [e for h in (0,p['height']) for e in (arc([0,0,h],[R,0,0],[0,R,0],-pi/2,a),arc([r,c,h],[r,0,0],[0,r,0],a,pi))]
 if z=='AC123':
  lo,hi=p['box'];W=hi[0];D=hi[1];h=hi[2]
  centres=[(r,r,pi,3*pi/2),(W-r,r,3*pi/2,2*pi),(W-r,D-r,0,pi/2),(r,D-r,pi/2,pi)]
  return [arc([x,y,z0],[r,0,0],[0,r,0],a,b) for z0 in (0,h-r) for x,y,a,b in centres]+[pt([x,y,h]) for x in (r,W-r) for y in (r,D-r)]
 L=N(Q(p['side']));h=N(Q(p['height']));cx=rt*r;cy=r
 if z=='AC118':
  w=N(Q(p['width']));a=mp.acos(1-w/r)
  return [pt([L,0,0]),pt([L/2,rt*L/2,0]),pt([L,0,h-w]),pt([L-w/rt,w,h]),pt([L/2,rt*L/2,h]),arc([cx,cy,0],[0,-r,0],[-r,0,0],0,2*pi/3),arc([cx,cy,h],[0,-r,0],[-r,0,0],a,2*pi/3),arc([cx,cy,h-w+r],[0,-r,-r],[-r,0,0],0,a)]
 if z=='AC122':
  out=[pt([L,0,h]),pt([L/2,rt*L/2,h]),arc([cx,cy,h],[0,-r,0],[-r,0,0],0,2*pi/3),arc([cx,cy,r],[0,-r,0],[-r,0,0],0,2*pi/3)]
  # Two far ends of the bottom cylinder stripes, reflected in the wedge bisector.
  c=[L-r/rt,r,r];P=[0,0,-r];Qv=[r/rt,-r,0]
  reflect=lambda v:[v[0]/2+rt*v[1]/2,rt*v[0]/2-v[1]/2,v[2]]
  out += [arc(c,P,Qv,0,pi/2),arc(reflect(c),reflect(P),reflect(Qv),0,pi/2)]
  for n in ([0,-1,0],[-rt/2,mp.mpf('.5'),0]):
   out.append(arc([cx,cy,r],[0,0,-r],[r*x for x in n],0,pi/2))
  out.append(('sphcone',[cx,cy,r],r,[[1,0,0],[mp.mpf('.5'),rt/2,0],[0,0,1]]))
  return out
 raise ValueError(z)


def sectional_bbox(z,p,M,translation):
 """Independent support of horizontal sections, maximized over height.

 This route never reads elements(). It derives the convex sectional hulls
 from the stock and offset supports. Optimization is high-precision scalar
 verification, not a discretized geometry construction. Concavity follows
 from projection of the convex solid onto the (height,directional support)
 plane; endpoints and each construction-band boundary are included.
 """
 r=N(Q(p['radius']));rt=mp.sqrt(3);pi=mp.pi
 def peak(f,a,b):
  a,b=mp.mpf(a),mp.mpf(b);ends=[f(a),f(b)]
  ratio=(mp.sqrt(5)-1)/2
  x=b-ratio*(b-a);y=a+ratio*(b-a);fx,fy=f(x),f(y)
  for _ in range(250):
   if fx<fy:
    a=x;x=y;fx=fy;y=a+ratio*(b-a);fy=f(y)
   else:
    b=y;y=x;fy=fx;x=b-ratio*(b-a);fx=f(x)
  return max(*ends,fx,fy)
 def circle_max(A,B,lo,hi):
  # Lagrange multiplier on u²+v²=1, with angular endpoint constraints.
  vals=[A*mp.cos(lo)+B*mp.sin(lo),A*mp.cos(hi)+B*mp.sin(hi)]
  angle=mp.atan2(B,A)
  for k in (-1,0,1):
   if lo<=angle+2*pi*k<=hi:vals.append(mp.sqrt(A*A+B*B))
  return max(vals)
 def directional(d):
  x,y,v=map(mp.mpf,d);rho=mp.sqrt(x*x+y*y)
  if z=='AC119':return N(Q(p['stockRadius']))*rho+max(0,v*p['height'])
  if z=='AC120':
   R=N(Q(p['arc']['radius']));c=mp.sqrt(R*R-2*R*r);contact=mp.acos(r/(R-r))
   section=max(R*circle_max(x,y,-pi/2,contact),x*r+y*c+r*circle_max(x,y,contact,pi))
   return section+max(0,v*p['height'])
  if z=='AC121':
   lo,hi=p['plate'];R=N(Q(p['boss']['radius']));h=p['bossHeight'];H=hi[2]
   plate=sum(max(d[i]*lo[i],d[i]*hi[i]) for i in range(3))
   blend=peak(lambda t:rho*(R+r-mp.sqrt(max(0,r*r-(t-H-r)**2)))+v*t,H,H+r)
   return max(plate,blend,rho*R+v*(H+r),rho*R+v*(H+h))
  if z=='AC123':
   lo,hi=p['box'];W,D,h=hi
   core=max(x*r,x*(W-r))+max(y*r,y*(D-r))
   # Minkowski sum of the centre rectangle and a disk of radius s(z).
   return max(core+rho*r,core+rho*r+v*(h-r),core+v*h)
  L=N(Q(p['side']));h=N(Q(p['height']))
  if z=='AC122':
   def section(t):
    disk=mp.sqrt(max(0,r*r-(t-r)**2));inset=r-disk
    far=max(x*(L-inset/rt)+y*inset,x*(L/2+inset/rt)+y*(rt*L/2-inset))
    return max(far,x*rt*r+y*r+rho*disk)+v*t
   upper=max(x*L,x*L/2+y*rt*L/2,x*rt*r+y*r+rho*r)
   return max(peak(section,0,r),upper+v*r,upper+v*h)
  if z=='AC118':
   w=N(Q(p['width']))
   def section(t):
    cutoff=max(mp.mpf(0),w+t-h)
    # The supporting arc is clipped by the chamfer's moving y half-plane.
    start=mp.acos(1-cutoff/r)
    curved=x*rt*r+y*r+r*circle_max(-y,-x,start,2*pi/3)
    return max(x*(L-cutoff/rt)+y*cutoff,x*L/2+y*rt*L/2,curved)+v*t
   return max(section(0),section(h-w),peak(section,h-w,h))
  raise ValueError(z)
 hi=[mp.mpf(translation[i])+directional(M[i]) for i in range(3)]
 lo=[mp.mpf(translation[i])-directional([-v for v in M[i]]) for i in range(3)]
 return lo,hi
