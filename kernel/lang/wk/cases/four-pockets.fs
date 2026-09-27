FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Four independent pocketed blocks (the spike's par-pockets workload, written
// as ordinary FeatureScript: no parallel construct anywhere in the source).
// WK staging finds the independence from the dataflow alone.
annotation { "Feature Type Name" : "Four pockets" }
export const fourPockets = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        for (var i = 0; i < 4; i += 1)
        {
            const dx = i * 100;
            fCuboid(context, id + ("block" ~ i), { "corner1" : vector(dx, 0, 0) * millimeter, "corner2" : vector(dx + 50, 40, 12) * millimeter });
            fCuboid(context, id + ("pocket" ~ i), { "corner1" : vector(dx + 8, 8, 4) * millimeter, "corner2" : vector(dx + 38, 32, 14) * millimeter });
            opBoolean(context, id + ("cut" ~ i), { "targets" : qCreatedBy(id + ("block" ~ i), EntityType.BODY),
                "tools" : qCreatedBy(id + ("pocket" ~ i), EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
            if (size(evaluateQuery(context, qCreatedBy(id + ("block" ~ i), EntityType.BODY))) != 1)
                throw regenError("Expected one pocketed block " ~ i);
        }
    });
