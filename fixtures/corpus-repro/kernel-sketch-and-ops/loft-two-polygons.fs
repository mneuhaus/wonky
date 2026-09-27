FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Cluster kernel-sketch-and-ops, cause "loft" (49 corpus units): opLoft admits only two coaxial
// circles. The corpus lofts polygons. Three shapes, all from cad-project-014:
//   prismatoid     two parallel polygons whose side quads are planar (fixedCableClamp,
//                  switchBracket twoProfileLoft, corner-post column); exact as a planar B-rep
//   twistedOctagon neck octagon to chamfered square (upperPost transition): side quads are
//                  not planar (3 mm), so the exact result has ruled (bilinear) faces
//   squareToCircle square to circle (upperRotor throat loft)
function section(context is Context, id is Id, z is number, points is array) returns Query
{
    var s = newSketchOnPlane(context, id, { "sketchPlane" : plane(vector(0, 0, z) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    var pts = [];
    for (var p in points) pts = append(pts, vector(p[0], p[1]) * millimeter);
    pts = append(pts, pts[0]);
    skPolyline(s, "outline", { "points" : pts });
    skSolve(s);
    return qSketchRegion(id, false);
}

annotation { "Feature Type Name" : "Prismatoid loft (planar sides)" }
export const prismatoid = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var a = section(context, id + "a", 0, [[-10, -6], [10, -6], [10, 6], [-10, 6]]);
        var b = section(context, id + "b", 20, [[-8, -4], [8, -4], [8, 4], [-8, 4]]);
        opLoft(context, id + "loft", { "profileSubqueries" : [a, b] });
    });

annotation { "Feature Type Name" : "Twisted octagon loft" }
export const twistedOctagon = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var a = section(context, id + "a", 0, [[-6, -19.4], [6, -19.4], [16.6, -0.65340546], [16.6, 0.65340546], [0.65340546, 16.6], [-0.65340546, 16.6], [-16.6, 0.65340546], [-16.6, -0.65340546]]);
        var b = section(context, id + "b", 40, [[-12, -19.4], [12, -19.4], [20, -11.4], [20, 12], [12, 20], [-12, 20], [-20, 12], [-20, -11.4]]);
        opLoft(context, id + "loft", { "profileSubqueries" : [a, b] });
    });

annotation { "Feature Type Name" : "Square to circle loft" }
export const squareToCircle = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var a = section(context, id + "a", 0, [[-10, -10], [10, -10], [10, 10], [-10, 10]]);
        var s = newSketchOnPlane(context, id + "b", { "sketchPlane" : plane(vector(0, 0, 15) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : 6 * millimeter });
        skSolve(s);
        opLoft(context, id + "loft", { "profileSubqueries" : [a, qSketchRegion(id + "b", false)] });
    });
