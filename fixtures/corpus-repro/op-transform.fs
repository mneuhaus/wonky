FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Corpus: most frequent missing std builtin. opTransform is not implemented.
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
        opTransform(context, id + "move", { "bodies" : qCreatedBy(id + "c", EntityType.BODY), "transform" : transform(vector(5, 0, 0) * millimeter) });
    });
