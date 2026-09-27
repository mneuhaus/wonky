FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Cluster fs-interpreter-semantics, 15 units (cad-project-020 lochwand
// family fs233, definition.returnView). A boolean UI parameter without a
// "Default" annotation gets no value. Onshape passes false; wonky passes
// undefined and fails with "Feature precondition failed".
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Open view" }
        definition.open is boolean;
    }
    {
        fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, definition.open ? 5 : 10) * millimeter });
    });
