FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Cluster fs-interpreter-semantics, 16 units (cad-project-002 sc15 family
// fs16/fs12, cad-project-039 r19-hatch fs417 and r20-axle fs418).
// An annotation "Filter" is UI metadata written in a query-filter notation
// ('EntityType.BODY && BodyType.SOLID'). wonky evaluates every annotation map
// as a runtime expression while collecting defaults, and '&&' on two enum
// values fails with "FeatureScript conditions must be boolean" before the body.
// The feature body does not use the query, so after the fix this file builds
// (with the Onshape default for an unpicked query parameter).
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Part", "Filter" : EntityType.BODY && BodyType.SOLID, "MaxNumberOfPicks" : 1 }
        definition.part is Query;
    }
    {
        fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
    });
