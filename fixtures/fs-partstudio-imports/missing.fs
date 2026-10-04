FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
missingRails::import(path : "333333333333333333333333", version : "444444444444444444444444");
annotation { "Feature Type Name" : "Missing dependency must refuse" }
export const missingDependency = defineFeature(function(context is Context, id is Id, definition is map)
precondition {}
{
    try silent { missingRails::build({}); }
    fCuboid(context, id + "fallback", {
        "corner1" : vector(0, 0, 0) * millimeter,
        "corner2" : vector(1, 1, 1) * millimeter
    });
});
