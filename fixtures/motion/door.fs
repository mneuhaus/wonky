FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");
annotation { "Feature Type Name" : "Door and stop" }
export const f = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        const mm = millimeter;
        fCuboid(context, id + "door", { "corner1" : vector(0, 0, 0) * mm, "corner2" : vector(100, 10, 50) * mm });
        fCuboid(context, id + "stop", { "corner1" : vector(55, -30, 0) * mm, "corner2" : vector(100, -10, 50) * mm });
    });
