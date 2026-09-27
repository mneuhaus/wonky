FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Corpus: cad-project-043/fsocct cases and generated r10b-era files. Statement-form
// 'try silent { ... }' and 'try { ... }' blocks do not parse.
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
        try silent { opDeleteBodies(context, id + "none", { "entities" : qCreatedBy(id + "missing", EntityType.BODY) }); }
    });
