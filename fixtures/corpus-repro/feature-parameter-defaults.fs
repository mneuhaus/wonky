FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Corpus: cad-project-040 z-axis snapshots, project-component-9eb7ee7f lochwand topo-native.
// Onshape fills UI parameters from their specs: isLength(x, LENGTH_BOUNDS)
// defaults to the std bound's default, and a boolean parameter defaults to
// false. wonky fails with "Expected a length with units" / "Feature
// precondition failed" before the body runs.
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {
        annotation { "Name" : "Position" }
        isLength(definition.position, LENGTH_BOUNDS);
        annotation { "Name" : "Review" }
        definition.review is boolean;
    }
    {
        fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter + vector(0, 0, 1) * definition.position });
    });
