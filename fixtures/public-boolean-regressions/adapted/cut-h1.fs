// Adapted from OCCT tests/boolean/bcut_simple/H1; see ../NOTICE.md.
FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function main(context is Context, id is Id, definition is map)
{
    var a = newSketchOnPlane(context, id + "w", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    skPolyline(a, "v1-v8", { "points" : [vector(0, 0) * millimeter, vector(1, 0) * millimeter, vector(1, 3) * millimeter, vector(2, 3) * millimeter,
        vector(2, 0) * millimeter, vector(3, 0) * millimeter, vector(3, 5) * millimeter, vector(0, 5) * millimeter, vector(0, 0) * millimeter] });
    skSolve(a);
    opExtrude(context, id + "sol", { "entities" : qSketchRegion(id + "w"), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : 2 * millimeter });
    // Retain the active one-tangent-face tool, not the commented alternative.
    fCuboid(context, id + "b", { "corner1" : vector(-1, 2, 1) * millimeter, "corner2" : vector(4, 3, 4) * millimeter });
    opBoolean(context, id + "result", { "targets" : qCreatedBy(id + "sol", EntityType.BODY),
        "tools" : qCreatedBy(id + "b", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
}
