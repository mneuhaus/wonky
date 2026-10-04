"""Operation-faithful OCCT twins for frozen Boolean Z1 contracts.

Construct sketches, extrusions, revolves and sequential Booleans as specified.
All operands share the catalog frame before Boolean evaluation; no cone/revolve
or arc-prism primitive substitution. No Onshape or wonky output is consumed.
"""
import json
import math
from pathlib import Path
from build123d import Axis, Box, Cylinder, Cone, Sphere, Edge, Wire, Face, Solid, Plane, Pos

ROOT=Path(__file__).resolve().parents[3]
CAT=json.loads((ROOT/'fixtures/cad-acid/zones.json').read_text())
ZONES={z['id']:z for z in CAT['zones'] if z['group']=='boolean-z1'}

def scalar(x):
    return float(eval(str(x),{'__builtins__':{}},{}))

def frame(zid,variant):
    v=CAT['variants'][variant].get('baseFrame',variant);d=CAT['variants'][v]
    if v=='V3':
        k=d['axis'];l=math.sqrt(sum(x*x for x in k));k=[x/l for x in k]
        c=math.cos(d['angleRad']);s=math.sin(d['angleRad']);K=[[0,-k[2],k[1]],[k[2],0,-k[0]],[-k[1],k[0],0]]
        M=[[c*(i==j)+(1-c)*k[i]*k[j]+s*K[i][j] for j in range(3)] for i in range(3)]
        p=d['throughPointMm'];t=[p[i]-sum(M[i][j]*p[j] for j in range(3)) for i in range(3)]
    else:M=d['matrix'];t=d['translationMm']
    origin=[a+b for a,b in zip(ZONES[zid]['cell']['originMm'],t)]
    return Plane(origin,x_dir=[M[i][0] for i in range(3)],z_dir=[M[i][2] for i in range(3)]).location

def cuboid(bounds):
    a,b=bounds
    return Pos(*[(x+y)/2 for x,y in zip(a,b)])*Box(*[y-x for x,y in zip(a,b)])

def cyl(x,y,z0,z1,r):return Pos(x,y,(z0+z1)/2)*Cylinder(r,z1-z0)

def polygon(points):
    return Face(Wire([Edge.make_line(a,b) for a,b in zip(points,points[1:]+points[:1])]))

def sketch_box(bounds):
    a,b=bounds;x0,y0,z0=a;x1,y1,z1=b
    return Solid.extrude(polygon([(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0)]),(0,0,z1-z0))

def revolved(profile,cx=0,cy=0):
    return Solid.revolve(polygon([(cx+r,cy,z) for r,z in profile]),360,Axis((cx,cy,0),(0,0,1)))

def build_zone(zid,variant):
    z=ZONES[zid]
    if variant not in z['variants']:raise ValueError(f'{zid} does not declare {variant}')
    p=z['construction'].get('paramsByVariant',{}).get(variant,z['construction']['params']);r=scalar(p['radius']);F=frame(zid,variant)
    move=lambda shape:shape.moved(F)
    if zid=='AC66':
        base=move(cuboid(p['box']));tool=move(cyl(8,9,-1,11,r))
        drilled=base.cut(tool).clean()
        pocket=move(sketch_box(p['pocket']) if variant=='V5' else cuboid(p['pocket']))
        result=drilled.cut(pocket).clean()
    elif zid=='AC74':
        base=move(cuboid(p['box']));cx,cy=p['axis']
        if variant=='V5':
            bore=move(cyl(cx,cy,-1,10,r))
            cone=move(Pos(cx,cy,8)*Cone(r,r+4,4))
            tool=bore.fuse(cone).clean()
        else:tool=move(revolved([(0,-1),(r,-1),(r,6),(r+2,8),(r+2,10),(0,10)],cx,cy))
        result=base.cut(tool).clean()
    elif zid=='AC111':result=move(cuboid(p['box'])).cut(move(Pos(*p['centre'])*Sphere(r))).clean()
    elif zid=='AC112':result=move(cyl(0,0,0,10,r+1)).fuse(move(cyl(6,0,0,10,r))).clean()
    elif zid=='AC113':
        # YZ arch sketch, extruded in X; L sketch in XY, extruded in Z.
        a=(0,-r,0);b=(0,r,0);c=(0,r,6);d=(0,-r,6)
        face=Face(Wire([Edge.make_line(a,b),Edge.make_line(b,c),Edge.make_three_point_arc(c,(0,0,6+r),d),Edge.make_line(d,a)]))
        arch=move(Solid.extrude(face,(p['length'],0,0)))
        L=move(Solid.extrude(polygon([(x,y,0) for x,y in p['profile']]),(0,0,p['depth'])))
        result=arch.fuse(L).clean()
    elif zid=='AC115':result=move(cuboid(p['box'])).cut(move(cyl(p['axisX'],scalar(p['axisY']),*p['toolZ'],r))).clean()
    else:raise ValueError(zid)
    solids=list(result.solids())
    for i,body in enumerate(solids):body.label=f'{zid}_{i}_{variant}'
    return solids

def build_group(variant):
    return [body for zid,z in ZONES.items() if variant in z['variants'] for body in build_zone(zid,variant)]

BUILDERS={zid:(lambda variant,zid=zid:build_zone(zid,variant)) for zid in ZONES}
for zid in ZONES:globals()[zid.lower()]=BUILDERS[zid]
