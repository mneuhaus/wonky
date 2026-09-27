FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Corpus: cad-project-039 instantiator files. Two-variable for-in over
// a map ('for (var k, v in m)') does not parse.
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var sizes = { "a" : 10, "b" : 20 };
        for (var k, s in sizes)
            fCuboid(context, id + k, { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(s, s, s) * millimeter });
    });
