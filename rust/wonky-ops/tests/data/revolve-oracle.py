# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["cadquery-ocp==8.0.1.0.0"]
# ///
"""Read-only independent oracle for Rust host-op measurements and STEP output."""
import json
import math
import re
import sys
from pathlib import Path
from OCP.BRep import BRep_Tool
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS


def shapes(shape, kind):
    result = []
    explorer = TopExp_Explorer(shape, kind)
    while explorer.More():
        s = explorer.Current()
        if not any(s.IsSame(other) for other in result):
            result.append(s)
        explorer.Next()
    return result


def fields(text):
    result, start, level, quote = [], 0, 0, False
    i = 0
    while i < len(text):
        c = text[i]
        if c == "'":
            if quote and i+1 < len(text) and text[i+1] == "'":
                i += 2
                continue
            quote = not quote
        elif not quote:
            level += (c == "(") - (c == ")")
            if c == "," and level == 0:
                result.append(text[start:i]); start = i+1
        i += 1
    return result + [text[start:]]


def raw_chart_check(text, eps):
    # OCCT may silently replace malformed pcurves while reading a STEP file.
    # Independently evaluate the emitted analytic chart BEFORE that healing.
    entities = {}
    for line in text.splitlines():
        m = re.fullmatch(r"(#\d+)=(\w+)\((.*)\);", line)
        if m:
            entities[m[1]] = (m[2], fields(m[3]))
    def args(ref, kind):
        entity = entities[ref]
        assert entity[0] == kind, (entity, kind)
        return entity[1]
    def vector(ref, kind):
        return [float(x) for x in fields(args(ref, kind)[1][1:-1])]
    def cross(a, b):
        return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
    def placement(ref):
        a = args(ref, "AXIS2_PLACEMENT_3D")
        o, z, x = vector(a[1], "CARTESIAN_POINT"), vector(a[2], "DIRECTION"), vector(a[3], "DIRECTION")
        return o, x, cross(z, x), z
    def image(frame, xyz):
        o, x, y, z = frame
        return [o[k]+x[k]*xyz[0]+y[k]*xyz[1]+z[k]*xyz[2] for k in range(3)]
    seam_count = 0
    for kind, a in entities.values():
        if kind == "PRODUCT":
            assert a[1][1:-1].replace("''", "'") == "ring 'quote' __"
        if kind == "MANIFOLD_SOLID_BREP":
            assert a[0][1:-1].replace("''", "'") == "ring 'id'"
        if kind != "SEAM_CURVE":
            continue
        seam_count += 1
        circle = args(a[1], "CIRCLE")
        frame, radius = placement(circle[1]), float(circle[2])
        for pc in fields(a[2][1:-1]):
            pc = args(pc, "PCURVE")
            torus = args(pc[1], "TOROIDAL_SURFACE")
            tf, major, minor = placement(torus[1]), float(torus[2]), float(torus[3])
            rep = args(pc[2], "DEFINITIONAL_REPRESENTATION")
            line = args(fields(rep[1][1:-1])[0], "LINE")
            origin = vector(line[1], "CARTESIAN_POINT")
            v = args(line[2], "VECTOR")
            direction = vector(v[1], "DIRECTION")
            for t in [0., 0.73, 2.1, 5.2]:
                u, vv = [origin[k]+t*direction[k]*float(v[2]) for k in range(2)]
                r = major+minor*math.cos(vv)
                surface = image(tf, [r*math.cos(u), r*math.sin(u), minor*math.sin(vv)])
                curve = image(frame, [radius*math.cos(t), radius*math.sin(t), 0.])
                assert math.dist(surface, curve) <= eps, (surface, curve, eps)
    assert seam_count == 2


root = Path(sys.argv[1])
for k in range(3):
    expected = json.loads((root / f"{k}.expected").read_text())
    measurement = json.loads((root / f"{k}.json").read_text())
    major, minor, center = expected["major"], expected["minor"], expected["center"]
    volume, area = 2 * math.pi**2 * major * minor**2, 4 * math.pi**2 * major * minor
    for key, value in [("volume", volume), ("area", area)]:
        unit = "Mm3" if key == "volume" else "Mm2"
        actual = measurement[key + unit]
        assert abs(actual - value) < 1e-10 * value, (key, actual, value)
        lower, upper = measurement[key + "Enclosure" + unit]
        assert lower <= value <= upper
        assert abs(actual - value) <= actual * measurement[key + "RelBound"] + value * 3e-16
    assert measurement["centroidMm"] == center
    assert measurement["topology"] == dict(bodies=1, shells=1, faces=1, edges=0, vertices=0, loops=0,
                                           ringEdges=0, closedToroidalFaces=1, genus=1, singularPoints=0, pinchPoints=0)
    assert measurement["validity"] == dict(brep=True, closed=True, positive=True)
    assert measurement["certificate"] == "RingTorus" and measurement["boundToConstruction"] is True
    assert measurement["basis"] == "native-f64-construction"
    assert measurement["faceAreasMm2"] == [measurement["areaMm2"]]
    assert measurement["facePerimetersMm"] == [0]
    assert measurement["frame"]["orthonormalityDefect"] == 0
    eps = measurement["toleranceMm"]
    assert 0 < eps < 1e-8
    assert measurement["projection"]["edges"] == [[0, 0], [0, 0]]
    # The shared host projection is face -> loops -> oriented edge uses.
    faces = measurement["projection"]["faces"]
    assert len(faces) == 1 and len(faces[0]) == 1
    assert faces[0][0] == [[0, True], [1, True], [0, False], [1, False]]
    vertex = measurement["projection"]["vertices"][0]
    for a, b in zip(vertex, expected["vertex"]):
        assert abs(a-b) <= eps
    for key, sign in [("min", -1), ("max", 1)]:
        for axis in range(3):
            extent = minor if axis == expected["axis"] else major + minor
            for measured_key in ["bboxMm", "mappedBboxMm"]:
                assert abs(measurement[measured_key][key][axis] - (center[axis] + sign*extent)) <= eps
    for result, distance, inside in zip(measurement["probes"], [major-minor, 0], [False, True]):
        assert result["inside"] is inside
        assert abs(result["distanceMm"]-distance) <= result["boundMm"]+1e-11

    raw_chart_check((root / f"{k}.step").read_text(), eps)
    reader = STEPControl_Reader()
    assert reader.ReadFile(str(root / f"{k}.step")) == IFSelect_RetDone
    assert reader.TransferRoots()
    shape = reader.OneShape()
    assert len(shapes(shape, TopAbs_SOLID)) == 1
    assert len(shapes(shape, TopAbs_FACE)) == 1
    assert BRepCheck_Analyzer(shape, True).IsValid()
    for edge in shapes(shape, TopAbs_EDGE):
        edge = TopoDS.Edge(edge)
        assert BRep_Tool.SameParameter_s(edge) and BRep_Tool.SameRange_s(edge)
        assert BRep_Tool.Tolerance_s(edge) <= 1e-7 + eps
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props, 1e-10, True, False)
    assert math.isclose(props.Mass(), volume, rel_tol=1e-10)
    centroid = props.CentreOfMass()
    for a, b in zip([centroid.X(), centroid.Y(), centroid.Z()], center):
        assert abs(a-b) < 1e-8
    BRepGProp.SurfaceProperties_s(shape, props)
    assert math.isclose(props.Mass(), area, rel_tol=1e-10)
print("three analytic host-op/STEP torus cases agree with independent closed forms")
