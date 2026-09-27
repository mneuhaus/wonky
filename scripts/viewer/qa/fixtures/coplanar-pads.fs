FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Viewer QA fixture (package topology-classes): a plate with two separate pads
// whose tops lie on the same plane z = 8 with the same outward normal. Grouping
// faces by support alone would merge the two pad tops; logical faces must not,
// because no edge joins them. The plate top around the pads is split into
// coplanar fragments by the union and does form one logical face.
export function coplanarPads(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "plate", {
        "corner1" : vector(0, 0, 0) * millimeter,
        "corner2" : vector(40, 20, 4) * millimeter
    });
    fCuboid(context, id + "padLeft", {
        "corner1" : vector(5, 5, 3) * millimeter,
        "corner2" : vector(15, 15, 8) * millimeter
    });
    fCuboid(context, id + "padRight", {
        "corner1" : vector(25, 5, 3) * millimeter,
        "corner2" : vector(35, 15, 8) * millimeter
    });
    opBoolean(context, id + "joinLeft", {
        "tools" : qUnion([qCreatedBy(id + "plate", EntityType.BODY),
            qCreatedBy(id + "padLeft", EntityType.BODY)]),
        "operationType" : BooleanOperationType.UNION
    });
    opBoolean(context, id + "joinRight", {
        "tools" : qUnion([qCreatedBy(id + "plate", EntityType.BODY),
            qCreatedBy(id + "padRight", EntityType.BODY)]),
        "operationType" : BooleanOperationType.UNION
    });
}
