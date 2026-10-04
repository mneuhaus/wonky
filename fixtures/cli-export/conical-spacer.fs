FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// The same 8 mm to 4 mm, 12 mm tall blank as examples/conical-spacer.fs, built as a
// revolved trapezoid because the Rust kernel refuses the circle-to-circle opLoft.
annotation { "Feature Type Name" : "Conical spacer blank (revolved)" }
export const main = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var profile = newSketchOnPlane(context, id + "profile", {
            "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0))
        });
        const points = [vector(0, 0), vector(8, 0), vector(4, 12), vector(0, 12)];
        for (var i = 0; i < 4; i += 1)
            skLineSegment(profile, "s" ~ i, { "start" : points[i] * millimeter, "end" : points[(i + 1) % 4] * millimeter });
        skSolve(profile);
        opRevolve(context, id + "cone", {
            "entities" : qSketchRegion(id + "profile", false),
            "axis" : line(vector(0, 0, 0) * millimeter, vector(0, 0, 1)),
            "angleForward" : 360 * degree
        });
        opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "profile", EntityType.BODY) });
    });
