FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Measurement case (fix round 3, verifier probe tilt-cross): B1 plate 300 x 300 x 5; B2 a
// 5 x 5 x 2 pad above the far corner, sketched on a plane tilted by 2e-5 rad about X. The plate top
// B1.F2 and the pad bottom B2.F1 are 4.99995 to 5.00005 mm apart across the pad (OCCT). Expected:
// parallel, offset 5.0000 in both selection orders, evaluated across the pad (the smaller face).
export function tiltPad(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "plate", {
        "corner1" : vector(0, 0, 0) * millimeter,
        "corner2" : vector(300, 300, 5) * millimeter
    });
    var pad = newSketchOnPlane(context, id + "padSketch", {
        "sketchPlane" : plane(vector(282.5, 282.5, 10) * millimeter, vector(0, 0.00002, 1))
    });
    skRectangle(pad, "r", { "firstCorner" : vector(-2.5, -2.5) * millimeter, "secondCorner" : vector(2.5, 2.5) * millimeter });
    skSolve(pad);
    opExtrude(context, id + "pad", { "entities" : qSketchRegion(id + "padSketch"),
        "direction" : vector(0, 0.00002, 1), "endBound" : BoundingType.BLIND, "endDepth" : 2 * millimeter });
}
