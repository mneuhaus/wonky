FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

annotation { "Feature Type Name" : "Conical spacer blank" }
export const main = defineFeature(function(context is Context, id is Id, definition is map)
precondition {}
{
    var bottom = newSketchOnPlane(context, id + "bottom", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1))
    });
    skCircle(bottom, "rim", { "center" : vector(0, 0) * millimeter, "radius" : 8 * millimeter });
    skSolve(bottom);
    var top = newSketchOnPlane(context, id + "top", {
        "sketchPlane" : plane(vector(0, 0, 12) * millimeter, vector(0, 0, 1))
    });
    skCircle(top, "rim", { "center" : vector(0, 0) * millimeter, "radius" : 4 * millimeter });
    skSolve(top);
    opLoft(context, id + "loft", {
        "profileSubqueries" : [qSketchRegion(id + "bottom"), qSketchRegion(id + "top")]
    });
});
