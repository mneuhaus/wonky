FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function obliqueCut(context is Context, id is Id, definition is map)
{
    var c = newSketchOnPlane(context, id + "c", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skCircle(c, "c", { "center" : vector(0, 0) * millimeter, "radius" : 5 * millimeter });
    skSolve(c);
    opExtrude(context, id + "rod", { "entities" : qSketchRegion(id + "c"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 20 * millimeter });
    var t = newSketchOnPlane(context, id + "t", { "sketchPlane" : plane(vector(0, 0, 12) * millimeter, normalize(vector(0, 1, 1)), vector(1, 0, 0)) });
    skRectangle(t, "r", { "firstCorner" : vector(-20, -20) * millimeter, "secondCorner" : vector(20, 20) * millimeter });
    skSolve(t);
    opExtrude(context, id + "cutter", { "entities" : qSketchRegion(id + "t"), "direction" : -normalize(vector(0, 1, 1)), "endBound" : BoundingType.BLIND, "endDepth" : 30 * millimeter });
    opBoolean(context, id + "cut", { "tools" : qUnion([qCreatedBy(id + "rod", EntityType.BODY), qCreatedBy(id + "cutter", EntityType.BODY)]), "operationType" : BooleanOperationType.INTERSECTION });
}
