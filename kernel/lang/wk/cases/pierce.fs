FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// PIERCE (round through hole in a planar body), the Boolean method whose
// adapter does host binary64 arithmetic (src/boolean.mjs: the tool axis with
// Math.hypot, a polyhedral target's volume from validateSolid).
//   alignedHoles  three axis-aligned holes in a plate: the first target is
//                 polyhedral (volume emulated in F32x2), the next two are the
//                 pierced analytic plate (volume exact); every axis is exact
//   tiltedHole    a hole along (0, 0.6, 0.8) in a tilted plate: axis and
//                 volume both emulated in F32x2

function rod(context is Context, id is Id, x is number, y is number, r is number) returns Query
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(x, y, -1) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : r * millimeter });
    skSolve(s);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", true), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 7 * millimeter });
    opDeleteBodies(context, id + "ds", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    return qCreatedBy(id + "ex", EntityType.BODY);
}

annotation { "Feature Type Name" : "Aligned holes" }
export const alignedHoles = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "plate", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(40, 12, 4.5) * millimeter });
        var plate = qCreatedBy(id + "plate", EntityType.BODY);
        for (var i = 0; i < 3; i += 1)
            opBoolean(context, id + ("hole" ~ i), { "targets" : plate, "tools" : rod(context, id + ("rod" ~ i), 7 + 13 * i, 6, 1.65 + 0.35 * i), "operationType" : BooleanOperationType.SUBTRACTION });
    });

annotation { "Feature Type Name" : "Tilted hole" }
export const tiltedHole = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var n = vector(0, 0.6, 0.8);
        var q = newSketchOnPlane(context, id + "q", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, n, vector(1, 0, 0)) });
        skRectangle(q, "r", { "firstCorner" : vector(-10, -10) * millimeter, "secondCorner" : vector(10, 10) * millimeter });
        skSolve(q);
        opExtrude(context, id + "plate", { "entities" : qSketchRegion(id + "q", true), "direction" : n, "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
        var c = newSketchOnPlane(context, id + "c", { "sketchPlane" : plane(vector(0, -0.6, -0.8) * millimeter, n, vector(1, 0, 0)) });
        skCircle(c, "c", { "center" : vector(2, 1) * millimeter, "radius" : 2 * millimeter });
        skSolve(c);
        opExtrude(context, id + "rod", { "entities" : qSketchRegion(id + "c", true), "direction" : n, "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
        opBoolean(context, id + "hole", { "targets" : qCreatedBy(id + "plate", EntityType.BODY), "tools" : qCreatedBy(id + "rod", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });
