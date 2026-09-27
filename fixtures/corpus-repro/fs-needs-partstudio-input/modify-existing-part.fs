FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Reduced from cad-project-039/belt-fixed-r30/fixed-frame-r30.fs:74-76
// (25 fixed-frame copies) and belt-return-r25/flush-return-guide-r25.fs:61-62.
// The feature edits a part that earlier Part Studio features (Derive, copy)
// put there. wonky runs it in an empty context, so the model's own guard
// throws before any modeling call. Onshape does the same in an empty studio.
annotation { "Feature Type Name" : "Modify existing part" }
export const modifyExistingPart = defineFeature(function(context is Context, id is Id, definition is map)
    precondition { }
    {
        var source = qUnion(evaluateQuery(context, qAllModifiableSolidBodies()));
        if (size(evaluateQuery(context, source)) != 1)
            throw regenError("Derive exactly one source part into this Part Studio first");
        var box = evBox3d(context, { "topology" : source, "tight" : true });
        if (abs((box.maxCorner[0] - box.minCorner[0]) / millimeter - 40) > 0.2)
            throw regenError("Unexpected source part");
        var sketch = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(20, 10, -1) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skCircle(sketch, "hole", { "center" : vector(0, 0) * millimeter, "radius" : 2 * millimeter });
        skSolve(sketch);
        opExtrude(context, id + "tool", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 12 * millimeter });
        opBoolean(context, id + "cut", { "targets" : source, "tools" : qCreatedBy(id + "tool", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
        opDeleteBodies(context, id + "ds", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    });
