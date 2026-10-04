FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

annotation { "Feature Type Name" : "Wonky box" }
export const boxBody = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Width" }
        isLength(definition.width, POSITIVE_LENGTH_BOUNDS);
    }
    {
        fCuboid(context, id + "box", {
            "corner1" : vector(0, 0, 0) * millimeter,
            "corner2" : vector(definition.width, 20 * millimeter, 5 * millimeter)
        });
    }, { "width" : 40 * millimeter });

