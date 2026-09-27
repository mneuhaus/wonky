// Local FeatureScript adaptation of gNucleus AI cad-gen-freecad row 0f27beedee.
// Apache-2.0 source data; see ../NOTICE.md. This is not an official CADBench submission.
FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function main(context is Context, id is Id, definition is map)
{
    var profile = newSketchOnPlane(context, id + "profile", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0))
    });
    skPolyline(profile, "steps", { "points" : [
        vector(0, 0) * millimeter, vector(1500, 0) * millimeter,
        vector(1500, 850) * millimeter, vector(1200, 850) * millimeter,
        vector(1200, 680) * millimeter, vector(900, 680) * millimeter,
        vector(900, 510) * millimeter, vector(600, 510) * millimeter,
        vector(600, 340) * millimeter, vector(300, 340) * millimeter,
        vector(300, 170) * millimeter, vector(0, 170) * millimeter,
        vector(0, 0) * millimeter
    ] });
    skSolve(profile);
    opExtrude(context, id + "stairs", { "entities" : qSketchRegion(id + "profile"),
        "direction" : vector(0, 1, 0), "endBound" : BoundingType.BLIND, "endDepth" : 1200 * millimeter });
}
