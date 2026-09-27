FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function boredSpacer(context is Context, id is Id, definition is map)
{
    var outer = newSketchOnPlane(context, id + "outer", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1))
    });
    skCircle(outer, "circle", { "center" : vector(0, 0) * millimeter, "radius" : 5 * millimeter });
    skSolve(outer);
    opExtrude(context, id + "stock", { "entities" : qSketchRegion(id + "outer"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });

    var inner = newSketchOnPlane(context, id + "inner", {
        "sketchPlane" : plane(vector(0, 0, -1) * millimeter, vector(0, 0, 1))
    });
    skCircle(inner, "circle", { "center" : vector(0, 0) * millimeter, "radius" : 2 * millimeter });
    skSolve(inner);
    opExtrude(context, id + "tool", { "entities" : qSketchRegion(id + "inner"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 12 * millimeter });
    opBoolean(context, id + "bore", { "targets" : qCreatedBy(id + "stock", EntityType.BODY),
        "tools" : qCreatedBy(id + "tool", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
}
