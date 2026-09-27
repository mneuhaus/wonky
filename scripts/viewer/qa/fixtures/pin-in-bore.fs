FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Measurement QA fixture (viewer package exact-measure): two bodies on one
// axis. A 20 x 20 x 12 mm block with a Ø8.4 mm through bore and a separate
// Ø8.0 mm pin that sticks out on both sides. Expected closed forms between
// the bore and the pin surface: radial gap 0.2 mm, diametral clearance 0.4 mm
// (supporting cylinders).
export function pinInBore(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "block", {
        "corner1" : vector(-10, -10, 0) * millimeter,
        "corner2" : vector(10, 10, 12) * millimeter
    });
    var bore = newSketchOnPlane(context, id + "boreSketch", {
        "sketchPlane" : plane(vector(0, 0, -1) * millimeter, vector(0, 0, 1))
    });
    skCircle(bore, "bore", { "center" : vector(0, 0) * millimeter, "radius" : 4.2 * millimeter });
    skSolve(bore);
    opExtrude(context, id + "boreTool", { "entities" : qSketchRegion(id + "boreSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 14 * millimeter });
    opBoolean(context, id + "bore", {
        "targets" : qCreatedBy(id + "block", EntityType.BODY),
        "tools" : qCreatedBy(id + "boreTool", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION
    });

    var pin = newSketchOnPlane(context, id + "pinSketch", {
        "sketchPlane" : plane(vector(0, 0, -4) * millimeter, vector(0, 0, 1))
    });
    skCircle(pin, "pin", { "center" : vector(0, 0) * millimeter, "radius" : 4 * millimeter });
    skSolve(pin);
    opExtrude(context, id + "pin", { "entities" : qSketchRegion(id + "pinSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 20 * millimeter });
}
