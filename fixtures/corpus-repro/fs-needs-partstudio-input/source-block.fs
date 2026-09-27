FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// The part the two repros expect to find: a 40 x 20 x 10 mm block
// (8,000 mm^3). It stands for the earlier Part Studio feature (Derive or
// copy). Builds on its own today; it is the input for the proposed
// Part Studio contract (docs/corpus/cluster-fs-needs-partstudio-input.md).
annotation { "Feature Type Name" : "Source block" }
export const sourceBlock = defineFeature(function(context is Context, id is Id, definition is map)
    precondition { }
    {
        var sketch = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skPolyline(sketch, "outline", { "points" : [vector(0, 0) * millimeter, vector(40, 0) * millimeter, vector(40, 20) * millimeter, vector(0, 20) * millimeter, vector(0, 0) * millimeter] });
        skSolve(sketch);
        opExtrude(context, id + "block", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
        opDeleteBodies(context, id + "ds", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    });
