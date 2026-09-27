FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// FDM QA fixture (viewer package fdm): the audit cross bore with a Ø16 mm
// bore instead of Ø8 mm. A 30 x 20 x 20 mm block with a horizontal through
// bore along X at z = 10 mm, so its ceiling overhangs. Ø16 mm is above the
// cad-khana small-bore limit (Ø <= 12 mm), so the bore is not exempt: with
// up = +Z and alpha_max = 45 deg its exact overhang band on the supporting
// cylinder is 45 deg to 135 deg, measured about +X from the cylinder frame
// x = +Y (the ceiling above z = 10 + 8 sin 45 deg = 15.657 mm).
export function crossBore16(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "block", {
        "corner1" : vector(0, -10, 0) * millimeter,
        "corner2" : vector(30, 10, 20) * millimeter
    });
    var s = newSketchOnPlane(context, id + "boreSketch", {
        "sketchPlane" : plane(vector(-1, 0, 10) * millimeter, vector(1, 0, 0), vector(0, 1, 0))
    });
    skCircle(s, "bore", { "center" : vector(0, 0) * millimeter, "radius" : 8 * millimeter });
    skSolve(s);
    opExtrude(context, id + "boreTool", { "entities" : qSketchRegion(id + "boreSketch"),
        "direction" : vector(1, 0, 0), "endBound" : BoundingType.BLIND,
        "endDepth" : 32 * millimeter });
    opBoolean(context, id + "bore", {
        "targets" : qCreatedBy(id + "block", EntityType.BODY),
        "tools" : qCreatedBy(id + "boreTool", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION
    });
}
