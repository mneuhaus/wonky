// Adapted from OCCT tests/boolean/bcommon_simple/E1; see ../NOTICE.md.
FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function main(context is Context, id is Id, definition is map)
{
    var a = newSketchOnPlane(context, id + "wa", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    skPolyline(a, "v1-v4", { "points" : [vector(0, 0) * millimeter, vector(1, 0) * millimeter,
        vector(1, 1) * millimeter, vector(0, 1) * millimeter, vector(0, 0) * millimeter] });
    skSolve(a);
    opExtrude(context, id + "ba", { "entities" : qSketchRegion(id + "wa"), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : 1 * millimeter });
    var b = newSketchOnPlane(context, id + "wb", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    skPolyline(b, "v5-v8", { "points" : [vector(0, 0) * millimeter, vector(1, 0) * millimeter,
        vector(1, 0.5) * millimeter, vector(0, 0.5) * millimeter, vector(0, 0) * millimeter] });
    skSolve(b);
    opExtrude(context, id + "bb", { "entities" : qSketchRegion(id + "wb"), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : 1 * millimeter });
    opBoolean(context, id + "result", { "tools" : qUnion([qCreatedBy(id + "ba", EntityType.BODY), qCreatedBy(id + "bb", EntityType.BODY)]),
        "operationType" : BooleanOperationType.INTERSECTION });
}
