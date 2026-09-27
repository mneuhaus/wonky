FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Measurement case (refix 2, verifier probe notch-gap): B1 a Ø10 boss along Z at z 0..10; B2 a
// Ø4 boss along Z through (9, 0) at z 7..12, so the supporting cylinders are 2 mm apart and the
// faces overlap axially at z 7..10. The kernel cannot yet cut an end notch into B1 (a coaxial
// cylinder boolean), so test/viewer-measure.test.mjs trims B1.F3 in memory: the face is missing
// for |angle| < 30° above z 6. Expected then: no "Gap between cylinders" for the faces (the
// closest points (5, 0, z) lie in the notch at every height of the overlap; OCCT BRepExtrema on
// the same geometry: 2.2360680 between (5, 0, 6) and (7, 0, 7)), and the unsupported row says why.
export function notchBase(context is Context, id is Id, definition is map)
{
    var aS = newSketchOnPlane(context, id + "aSketch", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1))
    });
    skCircle(aS, "c", { "center" : vector(0, 0) * millimeter, "radius" : 5 * millimeter });
    skSolve(aS);
    opExtrude(context, id + "a", { "entities" : qSketchRegion(id + "aSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
    var bS = newSketchOnPlane(context, id + "bSketch", {
        "sketchPlane" : plane(vector(0, 0, 7) * millimeter, vector(0, 0, 1))
    });
    skCircle(bS, "c", { "center" : vector(9, 0) * millimeter, "radius" : 2 * millimeter });
    skSolve(bS);
    opExtrude(context, id + "b", { "entities" : qSketchRegion(id + "bSketch"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 5 * millimeter });
}
