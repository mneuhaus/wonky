// Local FeatureScript adaptation of gNucleus AI cad-gen-freecad row f3e10795e7.
// Apache-2.0 source data; see ../NOTICE.md. This is not an official CADBench submission.
FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function main(context is Context, id is Id, definition is map)
{
    var bottom = newSketchOnPlane(context, id + "bottom", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1))
    });
    skCircle(bottom, "circle", { "center" : vector(0, 0) * millimeter, "radius" : 12.5 * millimeter });
    skSolve(bottom);
    var top = newSketchOnPlane(context, id + "top", {
        "sketchPlane" : plane(vector(0, 0, 30) * millimeter, vector(0, 0, 1))
    });
    skCircle(top, "circle", { "center" : vector(0, 0) * millimeter, "radius" : 7.5 * millimeter });
    skSolve(top);
    opLoft(context, id + "frustum", {
        "profileSubqueries" : [qSketchRegion(id + "bottom"), qSketchRegion(id + "top")]
    });
}
