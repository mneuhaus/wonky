FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Corpus: cad-project-014 bottom-drive family (27 units). A string
// literal "function" used as a map value is parsed as the keyword.
function note(context is Context, m is map) { return m; }
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        note(context, { "id" : "a", "kind" : "function" });
        fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
    });
