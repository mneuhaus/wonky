// Header-less include fragment, written the way the corpus generators write
// them: cad-project-014/machine-interface-r7/generate_fs.py emits a
// "FeatureScript 3044;" header plus imports and then appends geometry-body.fs
// to produce interface-r7.fs. The fragment alone is not a Feature Studio.
// Stands for 21 of the 28 fs-headerless-include files (found 'function'/'const').
function slab(context is Context, id is Id, z is number) returns Query
{
    fCuboid(context, id, { "corner1" : vector(0, 0, z) * millimeter, "corner2" : vector(20, 10, z + 3) * millimeter });
    return qCreatedBy(id, EntityType.BODY);
}

annotation { "Feature Type Name" : "Slab" }
export const slabPart = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        slab(context, id + "slab", 0);
    });
