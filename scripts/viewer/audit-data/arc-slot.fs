FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function arcSlot(context is Context, id is Id, definition is map)
{
    var s = newSketchOnPlane(context, id + "s", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    skLineSegment(s, "bottom", { "start" : vector(-10, -5) * millimeter, "end" : vector(10, -5) * millimeter });
    skArc(s, "right", { "start" : vector(10, -5) * millimeter, "mid" : vector(15, 0) * millimeter, "end" : vector(10, 5) * millimeter });
    skLineSegment(s, "top", { "start" : vector(10, 5) * millimeter, "end" : vector(-10, 5) * millimeter });
    skArc(s, "left", { "start" : vector(-10, 5) * millimeter, "mid" : vector(-15, 0) * millimeter, "end" : vector(-10, -5) * millimeter });
    skSolve(s);
    opExtrude(context, id + "slot", { "entities" : qSketchRegion(id + "s", false),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
}
