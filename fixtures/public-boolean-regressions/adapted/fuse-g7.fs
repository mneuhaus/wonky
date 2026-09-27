// Adapted from OCCT tests/boolean/bfuse_simple/G7; see ../NOTICE.md.
FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function main(context is Context, id is Id, definition is map)
{
    var a = newSketchOnPlane(context, id + "wp", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    skPolyline(a, "vp1-vp4", { "points" : [vector(3, 3) * millimeter, vector(8, 3) * millimeter, vector(8, 9) * millimeter, vector(3, 9) * millimeter, vector(3, 3) * millimeter] });
    skSolve(a);
    opExtrude(context, id + "ba", { "entities" : qSketchRegion(id + "wp"), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
    var b = newSketchOnPlane(context, id + "w", {
        "sketchPlane" : plane(vector(0, 2, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0))
    });
    skPolyline(b, "v1-v4", { "points" : [vector(3, 0) * millimeter, vector(4, 0) * millimeter, vector(4, 1) * millimeter, vector(3, 1) * millimeter, vector(3, 0) * millimeter] });
    skSolve(b);
    opExtrude(context, id + "bb", { "entities" : qSketchRegion(id + "w"), "direction" : vector(0, 1, 0),
        "endBound" : BoundingType.BLIND, "endDepth" : 1 * millimeter });
    opBoolean(context, id + "result", { "tools" : qUnion([qCreatedBy(id + "ba", EntityType.BODY), qCreatedBy(id + "bb", EntityType.BODY)]),
        "operationType" : BooleanOperationType.UNION });
}
