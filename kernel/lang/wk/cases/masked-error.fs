FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// A kernel failure (a Boolean no method admits: box united with a cylinder,
// line 23) BEFORE a builtin the production library lacks (opTransform, line
// 24). Today's sequential build stops at line 23; the recorder only stops at
// line 24, so the partial graph must be evaluated for the first error.

function cylinder(context is Context, id is Id, r is number) returns Query
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skCircle(s, "c", { "center" : vector(5, 5) * millimeter, "radius" : r * millimeter });
    skSolve(s);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", true), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 8 * millimeter });
    return qCreatedBy(id + "ex", EntityType.BODY);
}

annotation { "Feature Type Name" : "Masked error" }
export const maskedError = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "box", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 4) * millimeter });
        opBoolean(context, id + "join", { "tools" : qUnion([qCreatedBy(id + "box", EntityType.BODY), cylinder(context, id + "cyl", 3)]), "operationType" : BooleanOperationType.UNION });
        opTransform(context, id + "move", { "bodies" : qCreatedBy(id + "box", EntityType.BODY), "transform" : transform(vector(0, 0, 1) * millimeter) });
    });
