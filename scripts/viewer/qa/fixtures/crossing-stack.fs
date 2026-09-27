FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Measurement case (fix round 3): parallel cylinder faces whose cross-section circles cross and
// that do not overlap axially. B1 plate 30 x 30 x 6 with a Ø4 through hole at the origin (B1.F7).
// B2 separate Ø6 boss at (3, 0), z 8..11 (B2.F3), 2 mm above the plate.
// Expected: minimum distance between the faces 2 mm (the axial gap), at the crossing points of the
// circles, x = 2/3, y = ±√32/3 (OCCT BRepExtrema).
export function crossingStack(context is Context, id is Id, definition is map)
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

    var boss = newSketchOnPlane(context, id + "bossSketch", {
        "sketchPlane" : plane(vector(0, 0, 8) * millimeter, vector(0, 0, 1))
    });
    skCircle(boss, "boss", { "center" : vector(3, 0) * millimeter, "radius" : 3 * millimeter });
    skSolve(boss);
    opExtrude(context, id + "boss", { "entities" : qSketchRegion(id + "bossSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 3 * millimeter });
}
