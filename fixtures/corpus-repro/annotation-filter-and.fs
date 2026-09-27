FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Corpus: cad-project-039 r19/r20 and alternate-chute sc15 features.
// A query-parameter annotation with Filter 'EntityType.BODY && BodyType.SOLID'
// fails with "FeatureScript conditions must be boolean" before the body runs.
// (The feature also needs a UI pick for definition.part, see README.)
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {
        annotation { "Name" : "Part", "Filter" : EntityType.BODY && BodyType.SOLID, "MaxNumberOfPicks" : 1 }
        definition.part is Query;
    }
    {
        fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
    });
