FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Measurement case (fix round 3, verifier probe axis-far): two cylinder bodies at z = 500..510,
// sharing the axis point (0, 0, 500): B1 radius 5 along Z, B2 radius 3 along (0, 1e-5, 1). Across
// the parts the axes are at most 1e-4 mm apart, 500 mm from the world origin. Expected: parallel
// and coaxial in both selection orders, radius difference 2 mm (OCCT face distance 1.9999..2.0000).
export function axisFar(context is Context, id is Id, definition is map)
{
    var a = newSketchOnPlane(context, id + "aSketch", {
        "sketchPlane" : plane(vector(0, 0, 500) * millimeter, vector(0, 0, 1))
    });
    skCircle(a, "a", { "center" : vector(0, 0) * millimeter, "radius" : 5 * millimeter });
    skSolve(a);
    opExtrude(context, id + "a", { "entities" : qSketchRegion(id + "aSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
    var b = newSketchOnPlane(context, id + "bSketch", {
        "sketchPlane" : plane(vector(0, 0, 500) * millimeter, vector(0, 0.00001, 1))
    });
    skCircle(b, "b", { "center" : vector(0, 0) * millimeter, "radius" : 3 * millimeter });
    skSolve(b);
    opExtrude(context, id + "b", { "entities" : qSketchRegion(id + "bSketch"),
        "direction" : vector(0, 0.00001, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
}
