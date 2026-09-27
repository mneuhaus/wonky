FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");
// Reduced from cad-project-043/fsocct/examples/canonical_m3_tool.fs. The fsocct
// convention: version "local" and a path relative to this file. lib.fs is a
// functions-only fragment without a FeatureScript header, like the original
// cad-project-043/skills/onshape-cad/lib/m3_hybrid_hole.fs.
M3::import(path : "./lib.fs", version : "local");
annotation { "Feature Type Name" : "Local library import" }
export const localLibraryImport = defineFeature(function(context is Context, id is Id, definition is map)
precondition {}
{
    M3::pin(context, id + "pin", 3 * millimeter, 8 * millimeter);
});
