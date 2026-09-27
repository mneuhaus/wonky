// Adapted from OCCT tests/boolean/bfuse_simple/G1; see ../NOTICE.md.
FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function main(context is Context, id is Id, definition is map)
{
    // Tcl box takes origin and dimensions; fCuboid takes opposite corners.
    fCuboid(context, id + "ba", { "corner1" : vector(3, 3, 0) * millimeter, "corner2" : vector(8, 10, 4) * millimeter });
    // The original front face is in y=3 and is extruded in +y by 1.
    var b = newSketchOnPlane(context, id + "w", {
        "sketchPlane" : plane(vector(0, 3, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0))
    });
    skPolyline(b, "v1-v4", { "points" : [vector(3, 4) * millimeter, vector(4, 4) * millimeter, vector(4, 5) * millimeter, vector(3, 5) * millimeter, vector(3, 4) * millimeter] });
    skSolve(b);
    opExtrude(context, id + "bb", { "entities" : qSketchRegion(id + "w"), "direction" : vector(0, 1, 0),
        "endBound" : BoundingType.BLIND, "endDepth" : 1 * millimeter });
    opBoolean(context, id + "result", { "tools" : qUnion([qCreatedBy(id + "ba", EntityType.BODY), qCreatedBy(id + "bb", EntityType.BODY)]),
        "operationType" : BooleanOperationType.UNION });
}
