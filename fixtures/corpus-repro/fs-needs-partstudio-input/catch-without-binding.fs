FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Not a Part Studio input case. Reduced from cad-project-028/sorter.fs:35
// and cad-project-038/scripts/skirt_collar.fs:18. The parser rejects
// `catch { ... }` without a binding (legal FS: onshape/std fillet.fs uses
// `catch {}`). The corpus probe counted it as a model throw because the
// rejected line also contains `throw regenError(`. Belongs to fs-parser-syntax.
annotation { "Feature Type Name" : "Catch without binding" }
export const catchWithoutBinding = defineFeature(function(context is Context, id is Id, definition is map)
    precondition { }
    {
        fCuboid(context, id + "a", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
        try { fCuboid(context, id + "b", { "corner1" : vector(20, 0, 0) * millimeter, "corner2" : vector(30, 10, 10) * millimeter }); } catch { throw regenError("Box b failed"); }
    });
