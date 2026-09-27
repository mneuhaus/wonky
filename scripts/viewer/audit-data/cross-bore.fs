FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function crossBore(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "block", {
        "corner1" : vector(0, -10, 0) * millimeter,
        "corner2" : vector(30, 10, 20) * millimeter
    });
    var s = newSketchOnPlane(context, id + "boreSketch", {
        "sketchPlane" : plane(vector(-1, 0, 10) * millimeter, vector(1, 0, 0), vector(0, 1, 0))
    });
    skCircle(s, "bore", { "center" : vector(0, 0) * millimeter, "radius" : 4 * millimeter });
    skSolve(s);
    opExtrude(context, id + "boreTool", { "entities" : qSketchRegion(id + "boreSketch"),
        "direction" : vector(1, 0, 0), "endBound" : BoundingType.BLIND, "endDepth" : 32 * millimeter });
    opBoolean(context, id + "bore", {
        "targets" : qCreatedBy(id + "block", EntityType.BODY),
        "tools" : qCreatedBy(id + "boreTool", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION
    });
}
