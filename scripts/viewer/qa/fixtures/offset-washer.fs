FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Measurement regression (fix round 3, verifier probe offset-touch): B1 plate 30 x 30 x 6 with a
// Ø4 through hole at the origin. B2 washer on top of the plate (z 6..8), outer Ø12 and inner Ø3,
// both centred at (1, 0): an off-axis hole inside a boss, no axial overlap.
// Expected: B1.F7 / B2.F4 minimum distance between the faces 3 mm, points (-2, 0, 6) and (-5, 0, 6)
// (OCCT BRepExtrema), never the coaxial √((r1 − r2)² + gap²) = 4 mm.
export function offsetWasher(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "plate", {
        "corner1" : vector(-15, -15, 0) * millimeter,
        "corner2" : vector(15, 15, 6) * millimeter
    });
    var hole = newSketchOnPlane(context, id + "holeSketch", {
        "sketchPlane" : plane(vector(0, 0, -1) * millimeter, vector(0, 0, 1))
    });
    skCircle(hole, "hole", { "center" : vector(0, 0) * millimeter, "radius" : 2 * millimeter });
    skSolve(hole);
    opExtrude(context, id + "holeTool", { "entities" : qSketchRegion(id + "holeSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 8 * millimeter });
    opBoolean(context, id + "cut", {
        "targets" : qCreatedBy(id + "plate", EntityType.BODY),
        "tools" : qCreatedBy(id + "holeTool", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION
    });

    var washer = newSketchOnPlane(context, id + "washerSketch", {
        "sketchPlane" : plane(vector(0, 0, 6) * millimeter, vector(0, 0, 1))
    });
    skCircle(washer, "outer", { "center" : vector(1, 0) * millimeter, "radius" : 6 * millimeter });
    skSolve(washer);
    opExtrude(context, id + "washer", { "entities" : qSketchRegion(id + "washerSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 2 * millimeter });
    var inner = newSketchOnPlane(context, id + "innerSketch", {
        "sketchPlane" : plane(vector(0, 0, 5) * millimeter, vector(0, 0, 1))
    });
    skCircle(inner, "inner", { "center" : vector(1, 0) * millimeter, "radius" : 1.5 * millimeter });
    skSolve(inner);
    opExtrude(context, id + "innerTool", { "entities" : qSketchRegion(id + "innerSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
    opBoolean(context, id + "innerCut", {
        "targets" : qCreatedBy(id + "washer", EntityType.BODY),
        "tools" : qCreatedBy(id + "innerTool", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION
    });
}
