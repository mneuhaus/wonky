# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["cadquery-ocp==8.0.1.0.0"]
# ///
"""Independent STEP observer, all lengths mm. No geometry construction service.

uv run scripts/acid/measure.py part.step --zone AC01 --variant V0 --out observed.json
Canonicalization drops periodic seams, collapsed edges and smooth split vertices,
never merges faces. Raw topology is retained. Measurements are never read from
closed-form answers: only probe definitions and coordinate frames are consumed.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import sys
from pathlib import Path
import re
import tempfile
from collections import Counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from occt_properties import integration_shape

from OCP.BRep import BRep_Tool, BRep_Builder
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeVertex, BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.GCPnts import GCPnts_AbscissaPoint
from OCP.GProp import GProp_GProps
from OCP.GeomAbs import GeomAbs_Cone, GeomAbs_Torus
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader, STEPControl_Writer, STEPControl_AsIs
from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX, TopAbs_WIRE, TopAbs_IN, TopAbs_ON
from OCP.TopExp import TopExp
from OCP.TopTools import TopTools_IndexedMapOfShape
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.gp import gp_Pnt, gp_Vec, gp_Dir, gp_Lin, gp_Trsf

ROOT = Path(__file__).resolve().parents[2]
CAST = {TopAbs_SOLID: TopoDS.Solid_s, TopAbs_SHELL: TopoDS.Shell_s, TopAbs_FACE: TopoDS.Face_s,
        TopAbs_EDGE: TopoDS.Edge_s, TopAbs_VERTEX: TopoDS.Vertex_s, TopAbs_WIRE: TopoDS.Wire_s}


def entities(shape, kind):
    idx = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(shape, kind, idx)
    return [CAST[kind](idx.FindKey(i)) for i in range(1, idx.Extent() + 1)]


def same_index(items, item):
    return next((i for i, x in enumerate(items) if x.IsSame(item)), None)


def frame(catalog, zone, variant):
    # V4 (radius bump) and V5 (alternate idiom) carry no frame of their own:
    # both point at the frame that actually moves the cell via baseFrame,
    # defaulting to the variant itself so V0-V3 (which never set it) are
    # unaffected.
    v = catalog["variants"][variant]
    v = catalog["variants"][v.get("baseFrame", variant)]
    if "matrix" in v:
        r, t = v["matrix"], v["translationMm"]
    else:
        axis = v["axis"]
        length = math.sqrt(sum(x*x for x in axis))
        a = [x/length for x in axis]
        c, s = math.cos(v["angleRad"]), math.sin(v["angleRad"])
        cross = [[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]]
        r = [[c*(i == j)+(1-c)*a[i]*a[j]+s*cross[i][j] for j in range(3)] for i in range(3)]
        p = v["throughPointMm"]
        t = [p[i]-sum(r[i][j]*p[j] for j in range(3)) for i in range(3)]
    return r, [t[i]+zone["cell"]["originMm"][i] for i in range(3)]


def mapped(p, fr, vector=False):
    r, t = fr
    return [sum(r[i][j]*p[j] for j in range(3))+(0 if vector else t[i]) for i in range(3)]


def local_shape(shape, fr):
    r, t = fr
    inv = [[r[j][i] for j in range(3)] for i in range(3)]
    tr = gp_Trsf()
    tr.SetValues(*[x for i in range(3) for x in inv[i]+[-sum(inv[i][j]*t[j] for j in range(3))]])
    return BRepBuilderAPI_Transform(shape, tr, True).Shape()


def bbox(shape):
    b = Bnd_Box()
    b.SetGap(0)
    BRepBndLib.AddOptimal_s(shape, b, False, False)
    if b.IsVoid():
        return None
    values = b.Get()
    return {"min": list(values[:3]), "max": list(values[3:])}


def distance(a, b):
    d = BRepExtrema_DistShapeShape(a, b)
    d.Perform()
    if not d.IsDone():
        raise RuntimeError("DISTANCE_NOT_DONE")
    return d.Value()


def point_shape(point):
    return BRepBuilderAPI_MakeVertex(gp_Pnt(*point)).Vertex()


def inside(solid, point):
    # Precision::Confusion is the observer's kernel resolution, NOT a score band.
    return BRepClass3d_SolidClassifier(solid, gp_Pnt(*point), 1e-7).State() in (TopAbs_IN, TopAbs_ON)


def surface_class(surface):
    """The face class the observer files: the OCCT GeomAbs surface type name without its prefix (Plane, Cylinder,
    Cone, Sphere, Torus, SurfaceOfExtrusion, BSplineSurface, ...). The canonical histogram (surfaceTypes, which a zone
    can score) and the physical witness buckets both read it."""
    return str(surface.GetType()).split('.')[-1].removeprefix('GeomAbs_')


def canonical(shape):
    faces, edges, vertices = (entities(shape, kind) for kind in (TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX))
    raw = {name: len(entities(shape, kind)) for name, kind in [("bodies",TopAbs_SOLID),("shells",TopAbs_SHELL),("faces",TopAbs_FACE),("edges",TopAbs_EDGE),("vertices",TopAbs_VERTEX),("loops",TopAbs_WIRE)]}
    keep, incidence, ends = [], {}, {}
    for i, edge in enumerate(edges):
        adjacent = [j for j, face in enumerate(faces) if any(e.IsSame(edge) for e in entities(face, TopAbs_EDGE))]
        if BRep_Tool.Degenerated_s(edge) or any(BRep_Tool.IsClosed_s(edge, faces[j]) for j in adjacent):
            continue
        keep.append(i)
        incidence[i] = set(adjacent)
        ends[i] = [same_index(vertices, v) for v in entities(edge, TopAbs_VERTEX)]
    parent = {i:i for i in keep}
    def root(i):
        while parent[i] != i:
            i = parent[i]
        return i
    removed = set()
    for v, vertex in enumerate(vertices):
        inc = [i for i in keep if v in ends[i]]
        if len(inc) == 1 and len(ends[inc[0]]) == 1:
            removed.add(v)
        elif len(inc) == 2 and incidence[inc[0]] == incidence[inc[1]]:
            directions = []
            for i in inc:
                curve = BRepAdaptor_Curve(edges[i])
                p = BRep_Tool.Pnt_s(vertex)
                u = min([curve.FirstParameter(),curve.LastParameter()], key=lambda u: curve.Value(u).Distance(p))
                pos, tangent = gp_Pnt(), gp_Vec()
                curve.D1(u, pos, tangent)
                directions.append(tangent)
            if directions[0].Magnitude()>0 and directions[1].Magnitude()>0 and directions[0].Crossed(directions[1]).Magnitude() <= 1e-12*directions[0].Magnitude()*directions[1].Magnitude():
                parent[root(inc[1])] = root(inc[0])
                removed.add(v)
    used = set(v for i in keep for v in ends[i])-removed
    groups = {}
    for i in keep:
        groups.setdefault(root(i), []).append(i)
    rings = sum(not (set(v for i in group for v in ends[i]) & used) for group in groups.values())
    loops = 0
    histogram = Counter()
    singular = []
    pinch = 0
    closed_tori = 0
    for j, face in enumerate(faces):
        surf = BRepAdaptor_Surface(face)
        histogram[surface_class(surf)] += 1
        fe = [i for i in keep if j in incidence[i]]
        # Boundary loops can be connected by a removed seam in a raw wire.
        remaining = set(fe)
        while remaining:
            component = {remaining.pop()}
            changed = True
            while changed:
                vs = set(v for i in component for v in ends[i])
                extra = {i for i in remaining if vs.intersection(ends[i])}
                changed = bool(extra)
                component |= extra
                remaining -= extra
            loops += 1
        if surf.GetType() == GeomAbs_Cone:
            apex = surf.Cone().Apex()
            if any(BRep_Tool.Pnt_s(v).Distance(apex)<=1e-7 for v in entities(face,TopAbs_VERTEX)):
                if not any(apex.Distance(p)<=1e-7 for p in singular):
                    singular.append(apex)
        if surf.GetType() == GeomAbs_Torus:
            torus = surf.Torus()
            if not fe:
                closed_tori += 1
            if abs(torus.MajorRadius()-torus.MinorRadius())<=1e-7:
                centre = torus.Location()
                if not any(centre.Distance(p)<=1e-7 for p in singular):
                    singular.append(centre)
                    pinch += 1
    euler = len(used)+rings-len(groups)+2*len(faces)-loops-2*closed_tori+2*pinch
    topology = {**raw, "edges":len(groups),"vertices":len(used),"loops":loops,"ringEdges":rings,
                "closedToroidalFaces":closed_tori,"singularPoints":len(singular),"pinchPoints":pinch,
                "genus":(2*raw["shells"]-euler)/2}
    return topology, raw, dict(histogram)


def physical_witness(shape, zone, catalog, variant):
    """Independent per-solid analytic supports and raw Euler characteristic.

    This does not alter canonical(): a split cylindrical face remains split in
    strict v1, while its physical support and raw topology can be checked.
    Raw genus is defined only for valid, closed shells without degenerate edges;
    a numeric value alone never certifies a non-manifold or open STEP.
    """
    local = local_shape(shape, frame(catalog, zone, variant))
    solids = entities(local, TopAbs_SOLID)
    bodies = []
    for solid in solids:
        raw = {key: len(entities(solid, kind)) for key, kind in (
            ('shells', TopAbs_SHELL), ('faces', TopAbs_FACE),
            ('edges', TopAbs_EDGE), ('vertices', TopAbs_VERTEX),
            ('loops', TopAbs_WIRE))}
        valid = BRepCheck_Analyzer(solid).IsValid()
        closed = all(BRep_Tool.IsClosed_s(shell) for shell in entities(solid, TopAbs_SHELL))
        nondegenerate = all(not BRep_Tool.Degenerated_s(edge) for edge in entities(solid, TopAbs_EDGE))
        all_single_wire = all(len(entities(face, TopAbs_WIRE)) == 1
                              for face in entities(solid, TopAbs_FACE))
        # Each face with n boundary wires contributes Euler characteristic 2-n.
        euler = raw['vertices'] - raw['edges'] + 2 * raw['faces'] - raw['loops']
        genus = (2 * raw['shells'] - euler) / 2 if valid and closed and nondegenerate else None
        cylinders, planes, extrusions, bsplines, other = [], [], [], [], []
        for face in entities(solid, TopAbs_FACE):
            surface = BRepAdaptor_Surface(face)
            face_area = GProp_GProps()
            BRepGProp.SurfaceProperties_s(integration_shape(face), face_area, Eps=1e-10)
            kind = surface_class(surface)
            if kind == 'Cylinder':
                cyl = surface.Cylinder()
                p, d = cyl.Location(), cyl.Axis().Direction()
                # V is signed axial distance from the analytic surface origin.
                v0, v1 = surface.FirstVParameter(), surface.LastVParameter()
                origin = [p.X(), p.Y(), p.Z()]
                direction = [d.X(), d.Y(), d.Z()]
                cylinders.append({'radius': cyl.Radius(), 'axisOrigin': origin,
                                  'axisDirection': direction,
                                  'axialMin': min(v0, v1), 'axialMax': max(v0, v1),
                                  'zMin': min(origin[2] + v * direction[2] for v in (v0, v1)),
                                  'zMax': max(origin[2] + v * direction[2] for v in (v0, v1)),
                                  'area': face_area.Mass()})
            elif kind == 'Plane':
                plane = surface.Plane()
                p, d = plane.Location(), plane.Axis().Direction()
                planes.append({'origin': [p.X(), p.Y(), p.Z()],
                               'normal': [d.X(), d.Y(), d.Z()], 'area': face_area.Mass()})
            elif kind == 'SurfaceOfExtrusion':
                # A swept spline (or other) directrix: its generator direction and the directrix class.
                d = surface.Direction()
                extrusions.append({'direction': [d.X(), d.Y(), d.Z()],
                                   'directrix': str(surface.BasisCurve().GetType()).split('.')[-1].removeprefix('GeomAbs_'),
                                   'area': face_area.Mass()})
            elif kind == 'BSplineSurface':
                spline = surface.BSpline()
                bsplines.append({'degrees': [spline.UDegree(), spline.VDegree()], 'poles': [spline.NbUPoles(), spline.NbVPoles()],
                                 'rational': bool(spline.IsURational() or spline.IsVRational()), 'area': face_area.Mass()})
            else:
                other.append(kind)
        body_props = props(solid)
        bodies.append({'volume': body_props['volume'], 'area': body_props['area'],
                       'centroid': body_props['centroid'], 'bbox': body_props['bbox'],
                       'valid': valid, 'closed': closed, 'nondegenerateEdges': nondegenerate,
                       'allFacesSingleWire': all_single_wire,
                       'rawTopology': raw, 'rawEuler': euler, 'rawGenus': genus,
                       'cylinders': cylinders, 'planes': planes, 'extrusions': extrusions, 'bsplines': bsplines,
                       'unsupportedFaces': len(other), 'otherSurfaces': other})
    bodies.sort(key=lambda b: (b['centroid'][0], b['centroid'][1], b['centroid'][2]))
    # A face-only or open-shell export must not pass as a collection of valid solids.
    extra_faces = len(entities(local, TopAbs_FACE)) != sum(b['rawTopology']['faces'] for b in bodies)
    return {'bodies': bodies, 'valid': BRepCheck_Analyzer(local).IsValid() and not extra_faces,
            'closed': not extra_faces and all(b['closed'] for b in bodies)}


def props(shape):
    volume, area = GProp_GProps(), GProp_GProps()
    smooth = integration_shape(shape)
    BRepGProp.VolumeProperties_s(smooth, volume, Eps=1e-10)
    BRepGProp.SurfaceProperties_s(smooth, area, Eps=1e-10)
    centre = volume.CentreOfMass()
    return {"volume":volume.Mass(),"area":area.Mass(),"centroid":[centre.X(),centre.Y(),centre.Z()],"bbox":bbox(shape)}


def probes(shape, solids, zone, fr, variant=None):
    result = {}
    definitions = {m["name"]:m["definition"] for m in zone["closedForm"].get("measurements",[])}
    for outcome in zone["expected"]["outcomes"]:
        if isinstance(outcome.get("closedForm"),dict):
            definitions.update({m["name"]:m["definition"] for m in outcome["closedForm"].get("measurements",[])})
        # A V4 radius bump can move a probe's own point/axis, not just its
        # expected value; when a zone declares a per-variant closed form for
        # the running variant, its measurement definitions take precedence.
        variant_cf = outcome.get("closedFormByVariant",{}).get(variant) if variant else None
        # Same resolution as common.mjs closedForm(): a name other than the
        # two keywords points at zone.closedFormByVariant[name].
        if isinstance(variant_cf,str) and variant_cf not in ("primary","sliverBound"):
            variant_cf = zone.get("closedFormByVariant",{}).get(variant_cf)
        if isinstance(variant_cf,dict):
            definitions.update({m["name"]:m["definition"] for m in variant_cf.get("measurements",[])})
    for name, d in definitions.items():
        kind = d["kind"]
        if not solids:
            result[name] = None
        elif kind == "probeDistance":
            point = mapped(d["point"], fr)
            result[name] = 0.0 if any(inside(s,point) for s in solids) else distance(point_shape(point),shape)
        elif kind == "bodyDistance":
            found = [[s for s in solids if inside(s,mapped(d[key],fr))] for key in ["bodyA","bodyB"]]
            result[name] = distance(found[0][0],found[1][0]) if all(len(x)==1 for x in found) else None
        elif kind == "bboxExtent":
            b = bbox(local_shape(shape,fr))
            axis = "xyz".index(d["axis"][-1])
            result[name] = b["max"][axis]-b["min"][axis]
        elif kind == "edgeLength":
            point = point_shape(mapped(d["point"],fr))
            edge = min(entities(shape,TopAbs_EDGE),key=lambda e:distance(point,e))
            curve = BRepAdaptor_Curve(edge)
            result[name] = GCPnts_AbscissaPoint.Length_s(curve)
        elif kind == "lineDistance":
            # Infinite analytic edge, not a guessed finite segment.
            edge = BRepBuilderAPI_MakeEdge(gp_Lin(gp_Pnt(*mapped(d["point"],fr)),gp_Dir(*mapped(d["direction"],fr,True)))).Edge()
            result[name] = distance(edge,shape)
        else:
            raise ValueError(f"MEASUREMENT_KIND_UNSUPPORTED: {kind}")
    return result


def observe(shape, zone, catalog, variant):
    solids = entities(shape,TopAbs_SOLID)
    fr = frame(catalog,zone,variant)
    bodies = []
    totals = Counter()
    raw_totals = Counter()
    histogram = Counter()
    for solid in solids:
        top, raw, hist = canonical(solid)
        totals.update(top)
        raw_totals.update(raw)
        histogram.update(hist)
        bodies.append({**props(solid),"topology":top,"rawTopology":raw,"valid":BRepCheck_Analyzer(solid).IsValid()})
    bodies.sort(key=lambda b:(b["volume"],*b["centroid"]))
    for k in ['bodies','shells','faces','edges','vertices','loops','ringEdges','closedToroidalFaces','genus','singularPoints','pinchPoints']:
        totals.setdefault(k,0)
    # Face-only/open-shell outputs must never masquerade as successful empty solids.
    extra_faces = len(entities(shape,TopAbs_FACE)) != sum(b['rawTopology']['faces'] for b in bodies)
    all_closed = all(BRep_Tool.IsClosed_s(s) for solid in solids for s in entities(solid,TopAbs_SHELL))
    return {"volume":sum(b["volume"] for b in bodies),"area":sum(b["area"] for b in bodies),
            "bodies":bodies,"bbox":bbox(shape),"localBbox":bbox(local_shape(shape,fr)),
            "topology":dict(totals),"rawTopology":dict(raw_totals),"surfaceTypes":dict(histogram),
            "measurements":probes(shape,solids,zone,fr,variant),
            "cellAttribution":zone['id']=='AC46' or all(all(-90<=x<=90 for x in bbox(local_shape(s,fr))[side]) for s in solids for side in ('min','max')),
            "validity":{"brep":BRepCheck_Analyzer(shape).IsValid() and not extra_faces,"closed":all_closed and not extra_faces,"positive":all(b['volume']>0 for b in bodies)}}


def read_step(file):
    reader = STEPControl_Reader()
    if reader.ReadFile(str(file)) != IFSelect_RetDone:
        raise ValueError(f"STEP_IMPORT_FAILED: {file}")
    if reader.TransferRoots() >= 1:
        return reader.OneShape()
    # OCCT exports an empty compound as SHAPE_REPRESENTATION containing ONLY an
    # axis placement. Its reader reports a product root but transfers no geometry.
    # Admit only that explicit, parsed empty representation, never a failed solid.
    text = Path(file).read_text()
    data = text.split('DATA;',1)[-1].split('ENDSEC;',1)[0]
    kinds = set(re.findall(r'\b([A-Z][A-Z_0-9]+)\s*\(',data))
    allowed = set('APPLICATION_PROTOCOL_DEFINITION APPLICATION_CONTEXT SHAPE_DEFINITION_REPRESENTATION PRODUCT_DEFINITION_SHAPE PRODUCT_DEFINITION PRODUCT_DEFINITION_FORMATION PRODUCT PRODUCT_CONTEXT PRODUCT_DEFINITION_CONTEXT SHAPE_REPRESENTATION AXIS2_PLACEMENT_3D CARTESIAN_POINT DIRECTION GEOMETRIC_REPRESENTATION_CONTEXT GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT GLOBAL_UNIT_ASSIGNED_CONTEXT REPRESENTATION_CONTEXT LENGTH_UNIT NAMED_UNIT SI_UNIT PLANE_ANGLE_UNIT SOLID_ANGLE_UNIT UNCERTAINTY_MEASURE_WITH_UNIT LENGTH_MEASURE PRODUCT_RELATED_PRODUCT_CATEGORY'.split())
    if {'SHAPE_REPRESENTATION','SHAPE_DEFINITION_REPRESENTATION','AXIS2_PLACEMENT_3D'}.issubset(kinds) and kinds.issubset(allowed):
        shape = TopoDS_Compound()
        BRep_Builder().MakeCompound(shape)
        return shape
    raise ValueError(f"STEP_IMPORT_FAILED: {file}")


def export_step(shape, file):
    writer = STEPControl_Writer()
    if writer.Transfer(shape,STEPControl_AsIs) != IFSelect_RetDone or writer.Write(str(file)) != IFSelect_RetDone:
        raise ValueError(f"STEP_EXPORT_FAILED: {file}")


def unhealed_sliver(file, fr):
    text = Path(file).read_text()
    records = {int(n):(kind,body) for n,kind,body in re.findall(r"#(\d+)\s*=\s*(\w+)\s*\((.*?)\)\s*;",text,re.S)}
    shells = [n for n,(kind,_) in records.items() if kind=='CLOSED_SHELL']
    visited = set()
    def visit(n):
        if n in visited or n not in records:
            return
        visited.add(n)
        for child in re.findall(r'#(\d+)',records[n][1]):
            visit(int(child))
    for n in shells:
        visit(n)
    # Count topological shell vertex coordinates, not axes/curve-centre placements.
    points = set()
    for n in visited:
        kind,body = records[n]
        if kind != 'VERTEX_POINT':
            continue
        ref = re.findall(r'#(\d+)',body)[-1]
        pk,pb = records[int(ref)]
        if pk=='CARTESIAN_POINT':
            coords = re.search(r'\(([^()]*)\)\s*$',pb)
            if coords:
                points.add(tuple(float(x) for x in coords[1].split(',')))
    r,t = fr
    xs = [sum(r[i][0]*(p[i]-t[i]) for i in range(3)) for p in points]
    return {"closedShells":len(shells),"distinctShellPoints":len(points),"localExtentX":max(xs)-min(xs) if xs else None,
            "basis":"unhealed STEP vertex points; STEP author must use mm"}


def measure(file, zone, catalog, variant):
    shape = read_step(file)
    initial = observe(shape,zone,catalog,variant)
    with tempfile.TemporaryDirectory(prefix='acid-step-') as temp:
        second = Path(temp)/'roundtrip.step'
        export_step(shape,second)
        roundtrip = observe(read_step(second),zone,catalog,variant)
    return {"schema":"wonky/cad-acid-measure/1","stepSha256":hashlib.sha256(Path(file).read_bytes()).hexdigest(),
            "observer":"OCCT tolerance observer (not exact E9 provenance)","observerVersion":importlib.metadata.version('cadquery-ocp'),"metrics":initial,
            "stepRoundTrip":{"ok":True,"metrics":roundtrip,"unhealedSliver":unhealed_sliver(file,frame(catalog,zone,variant)) if zone['id']=='AC41' else None}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('step')
    parser.add_argument('--zones',default=str(ROOT/'fixtures/cad-acid/zones.json'))
    parser.add_argument('--zone',required=True)
    parser.add_argument('--variant',choices=['V0','V1','V2','V3','V4','V5'],required=True)
    parser.add_argument('--out',required=True)
    a = parser.parse_args()
    catalog = json.loads(Path(a.zones).read_text())
    zone = next(z for z in catalog['zones'] if z['id']==a.zone)
    result = measure(a.step,zone,catalog,a.variant)
    Path(a.out).write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')

if __name__=='__main__':
    main()
