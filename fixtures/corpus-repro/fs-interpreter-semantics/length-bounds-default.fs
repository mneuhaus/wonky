FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Cluster fs-interpreter-semantics, 21 units (cad-project-040 z-axis family fs560,
// cad-project-043/fsocct/cases/workspace/sparky_z.fs). A UI length parameter bounded by
// the std LENGTH_BOUNDS gets no value. Onshape fills it from the bound spec
// (valueBounds.fs: default 0.025 m = 25 mm); wonky passes undefined and the
// precondition fails with "Expected a length with units".
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Size" }
        isLength(definition.size, LENGTH_BOUNDS);
    }
    {
        fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(1, 1, 1) * definition.size });
    });
