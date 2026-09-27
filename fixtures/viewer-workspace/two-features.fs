FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Two exported features in one Part Studio source: a workspace builds each as
// its own model (test/viewer-workspace.test.mjs).
annotation { "Feature Type Name" : "Workspace plate" }
export const plate = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Width" }
        isLength(definition.width, POSITIVE_LENGTH_BOUNDS);
    }
    {
        fCuboid(context, id + "plate", {
            "corner1" : vector(0, 0, 0) * millimeter,
            "corner2" : vector(definition.width, 20 * millimeter, 4 * millimeter)
        });
    }, { "width" : 40 * millimeter });

annotation { "Feature Type Name" : "Workspace post" }
export const post = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
    }
    {
        fCuboid(context, id + "post", {
            "corner1" : vector(0, 0, 4) * millimeter,
            "corner2" : vector(6, 6, 30) * millimeter
        });
    });
