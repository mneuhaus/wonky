FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// A planar arrangement subtraction (a through pocket) and union on small boxes:
// the planar construction provenance (stats, face / edge origins, audit,
// contributor orientations), the operation evidence and operationHistory of
// both, cheap enough for a focused test.
annotation { "Feature Type Name" : "Planar small" }
export const planarSmall = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "a", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 4) * millimeter });
        fCuboid(context, id + "c", { "corner1" : vector(2, 2, -1) * millimeter, "corner2" : vector(5, 5, 5) * millimeter });
        opBoolean(context, id + "cut", { "targets" : qCreatedBy(id + "a", EntityType.BODY), "tools" : qCreatedBy(id + "c", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
        fCuboid(context, id + "b", { "corner1" : vector(10, 3, 0) * millimeter, "corner2" : vector(14, 7, 4) * millimeter });
        opBoolean(context, id + "join", { "tools" : qUnion([qCreatedBy(id + "a", EntityType.BODY), qCreatedBy(id + "b", EntityType.BODY)]), "operationType" : BooleanOperationType.UNION });
        setProperty(context, { "entities" : qCreatedBy(id + "a", EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : "block" });
    });
