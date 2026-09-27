FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Repro for cluster boolean-capability, sub-cause pierce-admission
// (docs/corpus/cluster-boolean-capability.md). Each feature bores one round
// hole that is a real through hole, and each is refused by the admission of
// the through-hole arm (src/boolean.mjs pierceable gate, kernel/pierce.bend
// decline()).
//
// obliqueHole: cad-project-039/archive-r8/hopper.fs#hybridHopper
//   (panel0 and hole ph0_0, corpus numbers unchanged). The plate normal and the
//   hole axis are the SAME vector in the source, but the planar prism's cap
//   planes come out tilted by about 3e-7 rad against it, and pierce.bend
//   demands |normal x axis| < 1e-7. Stands for 13 units (fs421, fs269, fs244).
// steppedHole: the tool passes a 10 mm flange of an L-shaped prism; the body
//   has a third face perpendicular to the axis (the far end of the long leg),
//   which the tool never reaches. pierce.bend counts all perpendicular faces
//   and wants exactly two. Stands for fs87/fs88 top-structure diagonals.
// arcPlateHole: a plate with rounded corners (line/arc sketch extrusion). Its
//   arc edges carry curveRange, which the JS gate excludes (the kernel pierce
//   reads every circle edge as a full circle). Stands for the fs422/fs425
//   feederOfframp/planar-guides units.
// unitedPlateHole: a hole through a planar arrangement union. The union's
//   line edges carry curveRange too, and its coplanar cap fragments add more
//   perpendicular faces. Stands for module-r4-upload#switchPinCapR4,
//   top-structure-r1#drilledHangerU2, upper-drive-r2#upperMotorHanger.
//
// Observed (node bin/wonky.mjs <file> --check --feature <f>): see README.md.
function polygon(context is Context, id is Id, pl is Plane, pts is array) returns Query
{
    var sketch = newSketchOnPlane(context, id, { "sketchPlane" : pl });
    var points = [];
    for (var p in pts)
        points = append(points, vector(p[0], p[1]) * millimeter);
    skPolyline(sketch, "outline", { "points" : append(points, points[0]) });
    skSolve(sketch);
    return qSketchRegion(id, false);
}

function prism(context is Context, id is Id, pl is Plane, pts is array, depth is number) returns Query
{
    opExtrude(context, id + "ex", { "entities" : polygon(context, id + "s", pl, pts), "direction" : pl.normal,
                "endBound" : BoundingType.BLIND, "endDepth" : depth * millimeter });
    opDeleteBodies(context, id + "del", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    return qCreatedBy(id + "ex", EntityType.BODY);
}

function cylinder(context is Context, id is Id, p is Vector, n is Vector, radius is number, depth is number) returns Query
{
    var sketch = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(p * millimeter, n) });
    skCircle(sketch, "hole", { "center" : vector(0, 0) * millimeter, "radius" : radius * millimeter });
    skSolve(sketch);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : n,
                "endBound" : BoundingType.BLIND, "endDepth" : depth * millimeter });
    opDeleteBodies(context, id + "del", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    return qCreatedBy(id + "ex", EntityType.BODY);
}

function cut(context is Context, id is Id, target is Query, tools is Query)
{
    opBoolean(context, id, { "tools" : tools, "targets" : target, "operationType" : BooleanOperationType.SUBTRACTION });
}

annotation { "Feature Type Name" : "Oblique through hole" }
export const obliqueHole = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var n = vector(-0.3780994811990447, 0.8017359831875825, -0.4628824857123603);
        var panel = prism(context, id + "panel", plane(vector(15.1263837814323, -584.4557347040842, -278.7609780356888) * millimeter, n,
                    vector(0, 0.5000000000000002, 0.8660254037844386)),
                [[0, 0], [198.0000000000001, 7.105427357601002e-15], [494.3470366716323, -267.8865669526646]], 3.2);
        cut(context, id + "hole", panel, cylinder(context, id + "tool", vector(1.618008691260536, -560.4991270254131, -224.072401980415), n, 1.7, 6));
    });

annotation { "Feature Type Name" : "Stepped through hole" }
export const steppedHole = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        // L profile in the XZ plane, extruded 16 mm along -Y: faces normal to Z
        // at z = 0 (whole foot), z = 10 (top of the flange) and z = 30 (top of the post).
        var body = prism(context, id + "bracket", plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)),
            [[0, 0], [60, 0], [60, 10], [20, 10], [20, 30], [0, 30]], 16);
        cut(context, id + "hole", body, cylinder(context, id + "tool", vector(40, -8, -1), vector(0, 0, 1), 1.7, 12));
    });

annotation { "Feature Type Name" : "Hole in a rounded plate" }
export const arcPlateHole = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var sketch = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        var x0 = 0; var y0 = 0; var x1 = 40; var y1 = 24; var r = 4;
        var a = [vector(x0 + r, y0), vector(x1 - r, y0), vector(x1, y0 + r), vector(x1, y1 - r), vector(x1 - r, y1), vector(x0 + r, y1), vector(x0, y1 - r), vector(x0, y0 + r)];
        var k = r / sqrt(2);
        var mid = [vector(x1 - r + k, y0 + r - k), vector(x1 - r + k, y1 - r + k), vector(x0 + r - k, y1 - r + k), vector(x0 + r - k, y0 + r - k)];
        for (var i = 0; i < 4; i += 1)
        {
            skLineSegment(sketch, "l" ~ i, { "start" : a[2 * i] * millimeter, "end" : a[2 * i + 1] * millimeter });
            skArc(sketch, "a" ~ i, { "start" : a[2 * i + 1] * millimeter, "mid" : mid[i] * millimeter, "end" : a[(2 * i + 2) % 8] * millimeter });
        }
        skSolve(sketch);
        opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1),
                    "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
        opDeleteBodies(context, id + "del", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
        cut(context, id + "hole", qCreatedBy(id + "ex", EntityType.BODY), cylinder(context, id + "tool", vector(20, 12, -1), vector(0, 0, 1), 1.7, 6));
    });

annotation { "Feature Type Name" : "Hole in a united plate" }
export const unitedPlateHole = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var top = plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0));
        var plate = prism(context, id + "plate", top, [[0, 0], [40, 0], [40, 20], [0, 20]], 3);
        var tab = prism(context, id + "tab", top, [[30, 5], [60, 5], [60, 15], [30, 15]], 3);
        opBoolean(context, id + "join", { "tools" : qUnion([plate, tab]), "operationType" : BooleanOperationType.UNION });
        cut(context, id + "hole", plate, cylinder(context, id + "tool", vector(12, 10, -0.1), vector(0, 0, 1), 1.7, 3.2));
    });
