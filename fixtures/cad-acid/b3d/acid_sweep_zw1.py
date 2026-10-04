"""ZW1 operation-faithful twins: no substituted sphere/torus/cone primitives."""
import json, math
from pathlib import Path
from build123d import Axis, Edge, Wire, Face, Solid, Plane, GeomType
ROOT=Path(__file__).resolve().parents[3]
CAT=json.loads((ROOT/'fixtures/cad-acid/zones.json').read_text())
ZONES={z['id']:z for z in CAT['zones'] if z['group']=='sweep-zw1'}

def scalar(v):
    # Only the catalog's rational / quadratic design literals.
    import sympy
    return float(sympy.sympify(str(v),rational=True))

def frame(zid,variant):
    v=CAT['variants'][variant].get('baseFrame',variant);d=CAT['variants'][v]
    if v=='V3':
        k=d['axis'];norm=math.sqrt(sum(x*x for x in k));k=[x/norm for x in k]
        c=math.cos(d['angleRad']);s=math.sin(d['angleRad']);K=[[0,-k[2],k[1]],[k[2],0,-k[0]],[-k[1],k[0],0]]
        M=[[c*(i==j)+(1-c)*k[i]*k[j]+s*K[i][j] for j in range(3)] for i in range(3)]
        p=d['throughPointMm'];t=[p[i]-sum(M[i][j]*p[j] for j in range(3)) for i in range(3)]
    else:M=d['matrix'];t=d['translationMm']
    origin=[a+b for a,b in zip(ZONES[zid]['cell']['originMm'],t)]
    return Plane(origin,x_dir=[M[i][0] for i in range(3)],z_dir=[M[i][2] for i in range(3)])

def polygon(points):return Wire([Edge.make_line(a,b) for a,b in zip(points,points[1:]+points[:1])])

def build_zone(zid,variant):
    z=ZONES[zid]
    if variant not in z['variants']:raise ValueError(f'{zid}/{variant} undeclared')
    p={k:scalar(v) for k,v in z['construction'].get('paramsByVariant',{}).get(variant,z['construction']['params']).items()}
    r=p['radius'];F=frame(zid,variant);move=lambda a:a.moved(F.location)
    axis=Axis(F.origin,F.z_dir)
    if zid in ('AC126','AC127'):
        b=p['R'];h=p['height']
        face=move(Face(polygon([(b,0,0),(r,0,0),(r,0,h),(b,0,h)])))
        result=Solid.revolve(face,p['angleDegrees'],axis)
    elif zid=='AC128':
        a=p['r'];h=p['height'];c=r-a;s=math.sqrt(2)
        edges=[Edge.make_line((0,0,0),(c,0,0)),Edge.make_three_point_arc((c,0,0),(c+a/s,0,a-a/s),(r,0,a)),Edge.make_line((r,0,a),(r,0,h)),Edge.make_three_point_arc((r,0,h),(r/s,0,h+r/s),(0,0,h+r)),Edge.make_line((0,0,h+r),(0,0,0))]
        result=Solid.revolve(move(Face(Wire(edges))),360,axis)
    elif zid=='AC129':
        a=r;h=p['height'];C=math.sqrt(2)/2
        pts=[(-a,-a),(a,-a),(a,a),(-a,a)]
        lower=move(polygon([(x,y,0) for x,y in pts]));upper=move(polygon([(C*(x-y),C*(x+y),h) for x,y in pts]))
        # Explicit ordering and ruled=True: four corresponding edge strips.
        result=Solid.make_loft([lower,upper],ruled=True)
    elif zid=='AC130':
        R=p['R'];L=p['length'];s=math.sqrt(2)
        path=move(Wire([Edge.make_line((0,0,0),(L,0,0)),Edge.make_three_point_arc((L,0,0),(L+R/s,R-R/s,0),(L+R,R,0))]))
        profile=move(Face(Wire.make_circle(r,Plane((0,0,0),x_dir=(0,1,0),z_dir=(1,0,0)))))
        result=Solid.sweep(profile,path,is_frenet=False)
    elif zid=='AC131':
        w=p['width'];b=p['breadth'];h=p['height'];k=p['initialSlope']
        # Inclined XZ trapezoid, extruded along Y, then cut by extruded circle.
        face=move(Face(polygon([(0,0,0),(w,0,0),(w-k*h,0,h),(0,0,h)])))
        base=Solid.extrude(face,F.y_dir*b)
        circle=move(Face(Wire.make_circle(r,Plane((5,5,0)))))
        tool=Solid.extrude(circle,F.z_dir*h)
        base=base.cut(tool).clean()
        # Select by transformed normal, not face index, before actual draft.
        expected=(F.x_dir+k*F.z_dir).normalized()
        selected=[f for f in base.faces() if f.geom_type==GeomType.PLANE and f.normal_at().dot(expected)>1-1e-10]
        if len(selected)!=1:raise ValueError('AC131 draft-face selection is not unique')
        result=base.draft(selected,F,math.degrees(math.atan(p['targetSlope'])))
    else:raise ValueError(zid)
    solids=list(result.solids())
    for i,s in enumerate(solids):s.label=f'{zid}_{i}_{variant}'
    return solids

def build_group(variant):return [s for zid,z in ZONES.items() if variant in z['variants'] for s in build_zone(zid,variant)]
BUILDERS={zid:(lambda v,zid=zid:build_zone(zid,v)) for zid in ZONES}
for zid in ZONES:globals()[zid.lower()]=BUILDERS[zid]
