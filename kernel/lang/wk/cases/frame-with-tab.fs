FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// FeatureScript twin of fixtures/performance-build123d/cases/frame-with-tab.py
// (proposal-core-ir.md, H1): the same part through the other frontend.
annotation { "Feature Type Name" : "Frame with tab" }
export const frameWithTab = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "stock", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(50, 40, 10) * millimeter });
        fCuboid(context, id + "opening", { "corner1" : vector(8, 8, -1) * millimeter, "corner2" : vector(42, 32, 11) * millimeter });
        opBoolean(context, id + "frame", { "targets" : qCreatedBy(id + "stock", EntityType.BODY),
            "tools" : qCreatedBy(id + "opening", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
        fCuboid(context, id + "tab", { "corner1" : vector(48, 10, 0) * millimeter, "corner2" : vector(60, 30, 10) * millimeter });
        opBoolean(context, id + "join", { "tools" : qUnion([qCreatedBy(id + "stock", EntityType.BODY), qCreatedBy(id + "tab", EntityType.BODY)]),
            "operationType" : BooleanOperationType.UNION });
    });
