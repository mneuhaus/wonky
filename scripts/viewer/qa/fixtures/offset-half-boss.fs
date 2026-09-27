FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Measurement case (fix round 3): an off-axis arc face whose trimmed arc does not contain the
// closest direction. B1 plate 30 x 30 x 6 with a Ø4 through hole at the origin (B1.F7). B2 D-shaped
// boss on the plate (z 6..8): an arc of radius 6 about (1, 0) on the +x side, closed by the line
// x = 1. The closest points of the full circles lie at -x, outside the arc, so the measurement
// refuses the face distance and names why (OCCT: 4.0828 = √37 − 2, at the arc ends).
export function offsetHalfBoss(context is Context, id is Id, definition is map)
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
        "sketchPlane" : plane(vector(0, 0, 6) * millimeter, vector(0, 0, 1))
    });
    skArc(boss, "arc", { "start" : vector(1, -6) * millimeter, "mid" : vector(7, 0) * millimeter,
        "end" : vector(1, 6) * millimeter });
    skLineSegment(boss, "chord", { "start" : vector(1, 6) * millimeter, "end" : vector(1, -6) * millimeter });
    skSolve(boss);
    opExtrude(context, id + "boss", { "entities" : qSketchRegion(id + "bossSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 2 * millimeter });
}
