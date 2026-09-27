FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Reduced from cad-project-039/belt-fixed-r29/top-clearance-r29/top-plate-clearance-r29.fs:7-13,67
// (13 TOP-clearance files). The source part is picked among all existing
// parts by its measured volume. In an empty context no part matches.
function sourceBody(context is Context, volumeMm3 is number) returns Query
{
    var matches = [];
    for (var b in evaluateQuery(context, qAllModifiableSolidBodies()))
        if (abs(evVolume(context, { "entities" : b }) / millimeter ^ 3 - volumeMm3) < 2)
            matches = append(matches, b);
    if (size(matches) != 1)
        throw regenError("Expected exactly the declared current TOP source body; matching count=" ~ size(matches));
    return qUnion(matches);
}

annotation { "Feature Type Name" : "Edit volume-selected part" }
export const editVolumeSelectedPart = defineFeature(function(context is Context, id is Id, definition is map)
    precondition { }
    {
        var b = sourceBody(context, 8000);
        var sketch = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(20, 10, -1) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skCircle(sketch, "hole", { "center" : vector(0, 0) * millimeter, "radius" : 2 * millimeter });
        skSolve(sketch);
        opExtrude(context, id + "tool", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 12 * millimeter });
        opBoolean(context, id + "cut", { "targets" : b, "tools" : qCreatedBy(id + "tool", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
        opDeleteBodies(context, id + "ds", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    });
