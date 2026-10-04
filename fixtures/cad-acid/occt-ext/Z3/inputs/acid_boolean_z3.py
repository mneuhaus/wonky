"""Specified fCylinder-equivalent operands, placed BEFORE their Boolean."""
import json
import math
from pathlib import Path
from build123d import Solid, Plane
ROOT=Path(__file__).resolve().parents[3]
CAT=json.loads((ROOT/'fixtures/cad-acid/zones.json').read_text())
ZONES={z['id']:z for z in CAT['zones'] if z['group']=='boolean-z3'}
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


def cylinder(endpoints,r):
    a,b=endpoints;direction=[y-x for x,y in zip(a,b)]
    height=math.sqrt(sum(v*v for v in direction))
    # Same directed axis and end planes as fCylinder, no alternative primitive.
    xdir=(0,1,0) if direction[0] else (1,0,0)
    return Solid.make_cylinder(r,height,Plane(a,x_dir=xdir,z_dir=direction))

def build_zone(zid,variant):
    z=ZONES[zid]
    if variant not in z['variants']:raise ValueError(f'{zid} does not declare {variant}')
    p=z['construction'].get('paramsByVariant',{}).get(variant,z['construction']['params'])
    F=frame(zid,variant)
    a=cylinder(p['shaft'],scalar(p['R'])).moved(F)
    b=cylinder(p['tool'],scalar(p['radius'])).moved(F)
    result=(a.fuse(b) if p['operation']=='UNION' else a.cut(b)).clean()
    solids=list(result.solids())
    for i,body in enumerate(solids):body.label=f'{zid}_{i}_{variant}'
    return solids

def build_group(variant):
    return [body for zid,z in ZONES.items() if variant in z['variants'] for body in build_zone(zid,variant)]
BUILDERS={zid:(lambda variant,zid=zid:build_zone(zid,variant)) for zid in ZONES}
for zid in ZONES:globals()[zid.lower()]=BUILDERS[zid]
