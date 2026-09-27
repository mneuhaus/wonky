FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

annotation { "Feature Type Name" : "Line sketch prism" }
export const lineSketch = defineFeature(function(context is Context, id is Id, definition is map)
    {
        const profileId = id + "profile";
        var sketch = newSketchOnPlane(context, profileId, {
            "sketchPlane" : plane(vector(0, 0, 0) * millimeter,
                                  vector(0, 0, 1), vector(1, 0, 0))
        });
        // Deliberately unordered, with independently reversed segment directions.
        skLineSegment(sketch, "slope", {
            "start" : vector(0, 2.1) * millimeter,
            "end" : vector(2.1, 0) * millimeter
        });
        skLineSegment(sketch, "entry", {
            "start" : vector(0, 0) * millimeter,
            "end" : vector(2.1, 0) * millimeter
        });
        skLineSegment(sketch, "axis", {
            "start" : vector(0, 2.1) * millimeter,
            "end" : vector(0, 0) * millimeter
        });
        skSolve(sketch);
        opExtrude(context, id + "extrusion", {
            "entities" : qSketchRegion(profileId, false),
            "direction" : vector(0, 0, 1),
            "endBound" : BoundingType.BLIND,
            "endDepth" : 5 * millimeter
        });
    });
