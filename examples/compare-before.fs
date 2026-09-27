FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export function part(context is Context, id is Id, definition is map)
{
    var s = newSketchOnPlane(context, id + "sketch", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1))
    });
    skCircle(s, "circle", { "center" : vector(0, 0) * millimeter, "radius" : 5 * millimeter });
    skSolve(s);
    opExtrude(context, id + "body", { "entities" : qSketchRegion(id + "sketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
}
