FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Measurement case (refix 1): two coaxial D-shaped bosses along Z that do not overlap axially and
// whose arcs share no direction. B1: arc of radius 5 over -90..90 deg, closed by x = 0, z 0..4.
// B2: arc of radius 3 over 120..240 deg, closed by x = -1.5, z 6..8. The coaxial radius difference
// is stated, the face distance is refused, and the refusal reason must be reported next to it.
export function coaxialArcs(context is Context, id is Id, definition is map)
{
    var a = newSketchOnPlane(context, id + "aSketch", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1))
    });
    skArc(a, "arc", { "start" : vector(0, -5) * millimeter, "mid" : vector(5, 0) * millimeter,
        "end" : vector(0, 5) * millimeter });
    skLineSegment(a, "chord", { "start" : vector(0, 5) * millimeter, "end" : vector(0, -5) * millimeter });
    skSolve(a);
    opExtrude(context, id + "a", { "entities" : qSketchRegion(id + "aSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
    var b = newSketchOnPlane(context, id + "bSketch", {
        "sketchPlane" : plane(vector(0, 0, 6) * millimeter, vector(0, 0, 1))
    });
    skArc(b, "arc", { "start" : vector(-1.5, 2.598076211353316) * millimeter,
        "mid" : vector(-3, 0) * millimeter, "end" : vector(-1.5, -2.598076211353316) * millimeter });
    skLineSegment(b, "chord", { "start" : vector(-1.5, -2.598076211353316) * millimeter,
        "end" : vector(-1.5, 2.598076211353316) * millimeter });
    skSolve(b);
    opExtrude(context, id + "b", { "entities" : qSketchRegion(id + "bSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 2 * millimeter });
}
