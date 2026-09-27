FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Cluster fs-interpreter-semantics, 9 units (cad-project-041 gt2-linie families
// fs473/fs475/fs476, cad-project-043/fsocct/cases/workspace/mini_camera.fs fs555).
// A top-level AngleBoundSpec constant fails at declaration time with
// "Expected AngleBoundSpec": values.mjs cast() only knows LengthBoundSpec.
// In these files the constant is declared but not used by any feature.
const TILT = { (degree) : [60, 65, 70] } as AngleBoundSpec;
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
    });
