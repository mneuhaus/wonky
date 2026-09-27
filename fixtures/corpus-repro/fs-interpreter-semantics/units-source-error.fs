FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Cluster fs-interpreter-semantics, 4 units (cad-project-039
// hopper-corner-inserts family fs552, cad-project-043/fsocct/cases/workspace/corner_ramp.fs).
// NOT a wonky gap: a unitless vector plus a length vector is an error in
// FeatureScript too ('q0' lacks '* millimeter'). fsocct's frozen results record
// the same case as "Source unit error". wonky's "Incompatible units in
// expression" is correct; the corpus sources need the fix.
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var q0 = vector(77.1, -498.5, -184.5);
        var uphill = vector(0, 0.5, 0.8660254037844386);
        var origin = q0 + uphill * (-3) * millimeter;
        fCuboid(context, id + "c", { "corner1" : origin, "corner2" : origin + vector(10, 10, 10) * millimeter });
    });
