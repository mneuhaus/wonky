FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// A concave L profile. These are the ordinary Onshape library calls and
// defineFeature wrapper; the local runner supplies context, id and definition.
annotation { "Feature Type Name" : "Wonky bracket" }
export const bracket = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Thickness" }
        isLength(definition.thickness, POSITIVE_LENGTH_BOUNDS);
    }
    {
        const profileId = id + "profile";
        var sketch = newSketchOnPlane(context, profileId, {
            "sketchPlane" : plane(vector(0, 0, 0) * millimeter,
                                  vector(0, 0, 1), vector(1, 0, 0))
        });
        skPolyline(sketch, "outline", {
            "points" : [
                vector(0, 0) * millimeter,
                vector(50, 0) * millimeter,
                vector(50, 12) * millimeter,
                vector(18, 12) * millimeter,
                vector(18, 40) * millimeter,
                vector(0, 40) * millimeter,
                vector(0, 0) * millimeter
            ]
        });
        skSolve(sketch);
        opExtrude(context, id + "extrusion", {
            "entities" : qSketchRegion(profileId),
            "direction" : vector(0, 0, 1),
            "endBound" : BoundingType.BLIND,
            "endDepth" : definition.thickness
        });
    }, { "thickness" : 8 * millimeter });

