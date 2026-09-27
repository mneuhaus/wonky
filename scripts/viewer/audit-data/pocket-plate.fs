FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function pocketPlate(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "plate", {
        "corner1" : vector(0, 0, 0) * millimeter,
        "corner2" : vector(40, 30, 6) * millimeter
    });
    fCuboid(context, id + "pocketTool", {
        "corner1" : vector(10, 8, 3) * millimeter,
        "corner2" : vector(30, 22, 10) * millimeter
    });
    opBoolean(context, id + "pocket", {
        "targets" : qCreatedBy(id + "plate", EntityType.BODY),
        "tools" : qCreatedBy(id + "pocketTool", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION
    });
}
