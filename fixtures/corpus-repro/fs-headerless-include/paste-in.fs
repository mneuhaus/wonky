// Header-less Feature Studio paste: a complete std-only feature whose
// "FeatureScript N;" header and std import were left to the Onshape Feature
// Studio it was pasted into (cad-project-038/scripts/hopper_v2.fs,
// hopper_v21.fs). Same parser refusal, found 'annotation'.
annotation { "Feature Type Name" : "Plate" }
export const plate = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "plate", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(30, 20, 2) * millimeter });
    });
