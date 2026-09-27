FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Measurement case (refix 1, verifier probe coax-far-apart): B1 a Ø10 cylinder along Z at
// z 0..10; B2 a Ø6 cylinder along (0, 2e-5, 1) through (0, 0, 500), at z 500..510. At B2 the axes
// are 1e-4 mm apart, at B1 about 0.01 mm (33 t). Expected: neither parallel nor coaxial across
// both faces, and the unsupported row names why (parallel across B2.F3 only).
export function coaxFar(context is Context, id is Id, definition is map)
{
    var a = newSketchOnPlane(context, id + "aSketch", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1))
    });
    skCircle(a, "a", { "center" : vector(0, 0) * millimeter, "radius" : 5 * millimeter });
    skSolve(a);
    opExtrude(context, id + "a", { "entities" : qSketchRegion(id + "aSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
    var b = newSketchOnPlane(context, id + "bSketch", {
        "sketchPlane" : plane(vector(0, 0, 500) * millimeter, vector(0, 0.00002, 1))
    });
    skCircle(b, "b", { "center" : vector(0, 0) * millimeter, "radius" : 3 * millimeter });
    skSolve(b);
    opExtrude(context, id + "b", { "entities" : qSketchRegion(id + "bSketch"),
        "direction" : vector(0, 0.00002, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
}
