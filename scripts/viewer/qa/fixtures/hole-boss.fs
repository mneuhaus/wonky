FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Hole/boss measurement cases (exact-measure regression, from the verifier
// probe). B1: 40 x 20 x 6 plate with a Ø4 hole at the origin. B2: separate
// Ø6 boss at x = 15 (parallel, not coaxial with the hole). B3: Ø3 pin at
// x = 0.3 inside the hole (eccentric pin in bore).
export function probe(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "plate", {
        "corner1" : vector(-10, -10, 0) * millimeter,
        "corner2" : vector(30, 10, 6) * millimeter
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
    skCircle(boss, "boss", { "center" : vector(15, 0) * millimeter, "radius" : 3 * millimeter });
    skSolve(boss);
    opExtrude(context, id + "boss", { "entities" : qSketchRegion(id + "bossSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 5 * millimeter });

    var pin = newSketchOnPlane(context, id + "pinSketch", {
        "sketchPlane" : plane(vector(0, 0, -2) * millimeter, vector(0, 0, 1))
    });
    skCircle(pin, "pin", { "center" : vector(0.3, 0) * millimeter, "radius" : 1.5 * millimeter });
    skSolve(pin);
    opExtrude(context, id + "pin", { "entities" : qSketchRegion(id + "pinSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
}
