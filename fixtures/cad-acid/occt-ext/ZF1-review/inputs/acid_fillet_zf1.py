"""Operation-faithful ZF1 oracle twins: all specified blends run in the catalog frame."""
import json,math
from pathlib import Path
from build123d import Axis, Box, Cylinder, Edge, Wire, Face, Solid, Plane, Pos, Vector
ROOT=Path(__file__).resolve().parents[3]
CAT=json.loads((ROOT/'fixtures/cad-acid/zones.json').read_text())
ZONES={z['id']:z for z in CAT['zones'] if z['group']=='fillet-zf1'}
def scalar(x):return float(eval(str(x),{'__builtins__':{}},{}))
def frame(zid,variant):
 v=CAT['variants'][variant].get('baseFrame',variant);d=CAT['variants'][v]
 if v=='V3':
  k=d['axis'];l=math.sqrt(sum(x*x for x in k));k=[x/l for x in k];c=math.cos(d['angleRad']);s=math.sin(d['angleRad']);K=[[0,-k[2],k[1]],[k[2],0,-k[0]],[-k[1],k[0],0]]
  M=[[c*(i==j)+(1-c)*k[i]*k[j]+s*K[i][j] for j in range(3)] for i in range(3)];p=d['throughPointMm'];t=[p[i]-sum(M[i][j]*p[j] for j in range(3)) for i in range(3)]
 else:M=d['matrix'];t=d['translationMm']
 origin=[a+b for a,b in zip(ZONES[zid]['cell']['originMm'],t)]
 return Plane(origin,x_dir=[M[i][0] for i in range(3)],z_dir=[M[i][2] for i in range(3)]).location,M,origin

def polygon(points):return Face(Wire([Edge.make_line(a,b) for a,b in zip(points,points[1:]+points[:1])]))
def cuboid(bounds):
 a,b=bounds
 return (Pos(*[(x+y)/2 for x,y in zip(a,b)])*Box(*[y-x for x,y in zip(a,b)])).solid()
def cyl(r,z0,z1):return Pos(0,0,(z0+z1)/2)*Cylinder(r,z1-z0)
def build_zone(zid,variant):
 z=ZONES[zid];p=z['construction'].get('paramsByVariant',{}).get(variant,z['construction']['params']);r=scalar(p['radius']);F,M,o=frame(zid,variant)
 move=lambda b:b.moved(F)
 point=lambda q:Vector(*[o[i]+sum(M[i][j]*q[j] for j in range(3)) for i in range(3)])
 edge=lambda b,q:b.edges().sort_by_distance(point(q))[0]
 if zid in ('AC118','AC122'):
  L=p['side'];h=p['height'];pts=[(0,0,0),(L,0,0),(L/2,L*math.sqrt(3)/2,0)]
  b=move(Solid.extrude(polygon(pts),(0,0,h)))
  selected=[edge(b,(0,0,h/2))] if zid=='AC118' else [edge(b,q) for q in [(0,0,h/2),(L/2,0,0),(L/4,L*math.sqrt(3)/4,0)]]
  b=b.fillet(r,selected)
  if zid=='AC118':b=b.chamfer(scalar(p['width']),None,[edge(b,(L/2,0,h))])
 elif zid=='AC119':
  R=p['stockRadius'];h=p['height'];bore=p['boreRadius'];sink=p['sinkRadius'];d=p['sinkDepth']
  stock=move(cyl(R,0,h))
  face=polygon([(0,0,-1),(bore,0,-1),(bore,0,h-d),(sink,0,h),(sink,0,h+1),(0,0,h+1)])
  tool=move(Solid.revolve(face,360,Axis((0,0,0),(0,0,1))))
  b=stock.cut(tool).clean();b=b.chamfer(r,None,[edge(b,(sink,0,h))])
 elif zid=='AC120':
  R=scalar(p['arc']['radius']);h=p['height'];a=(0,R,0);d=(0,-R,0)
  face=Face(Wire([Edge.make_line(a,d),Edge.make_three_point_arc(d,(R,0,0),a)]))
  b=move(Solid.extrude(face,(0,0,h)));b=b.fillet(r,[edge(b,(0,R,h/2))])
 elif zid=='AC121':
  R=scalar(p['boss']['radius']);lo,hi=p['plate'];stock=move(cuboid(p['plate']));boss=move(cyl(R,hi[2],hi[2]+p['bossHeight']))
  b=stock.fuse(boss).clean();b=b.fillet(r,[edge(b,(R,0,hi[2]))])
 elif zid=='AC123':
  lo,hi=p['box'];W,D,h=hi;b=move(cuboid(p['box']))
  b=b.fillet(r,[edge(b,(x,y,h/2)) for x in (0,W) for y in (0,D)])
  # Select the whole actual top wire, not a constructed replacement profile.
  normal=Vector(*[M[i][2] for i in range(3)])
  rim=[e for e in b.edges() if abs((e.center()-point((0,0,h))).dot(normal))<1e-7 and all(abs((v.center()-point((0,0,h))).dot(normal))<1e-7 for v in e.vertices())]
  if len(rim)!=8:raise ValueError(f'ZF1/top-rim-selection: {len(rim)} instead of 8')
  b=b.chamfer(r,None,rim)
 else:raise ValueError(zid)
 result=list(b.solids())
 for i,solid in enumerate(result):solid.label=f'{zid}_{i}_{variant}'
 return result
BUILDERS={zid:(lambda v,zid=zid:build_zone(zid,v)) for zid in ZONES}
for zid in ZONES:globals()[zid.lower()]=BUILDERS[zid]
