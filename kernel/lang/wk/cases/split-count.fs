FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Loud-failure case of the WK real-model spike (docs/language/spike-real-model.md):
// a slab cut through the middle of a bar leaves TWO bodies. The recorder
// speculates one body per Boolean (lineage count), so the native evaluator must
// report a count-speculation failure at the opBoolean span instead of
// returning either piece.
annotation { "Feature Type Name" : "Split count" }
export const splitCount = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "bar", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(30, 10, 10) * millimeter });
        fCuboid(context, id + "slab", { "corner1" : vector(10, -1, -1) * millimeter, "corner2" : vector(20, 11, 11) * millimeter });
        opBoolean(context, id + "cut", { "targets" : qCreatedBy(id + "bar", EntityType.BODY),
            "tools" : qCreatedBy(id + "slab", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });
