FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function main(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "first", {
        "corner1" : vector(0, 0, 0) * millimeter,
        "corner2" : vector(40, 30, 12) * millimeter
    });
    fCuboid(context, id + "second", {
        "corner1" : vector(10, -5, 4) * millimeter,
        "corner2" : vector(50, 22, 20) * millimeter
    });
    opBoolean(context, id + "intersection", {
        "tools" : qUnion([
            qCreatedBy(id + "first", EntityType.BODY),
            qCreatedBy(id + "second", EntityType.BODY)
        ]),
        "operationType" : BooleanOperationType.INTERSECTION
    });
}
