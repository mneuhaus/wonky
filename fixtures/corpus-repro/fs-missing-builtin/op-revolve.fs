FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");
// opRevolve, full turn, straight-edged profiles. Run one with --feature.
//
//   sleeve      cad-project-043/fsocct/examples/revolve_and_loft.fs: a rectangle 12..18 mm
//               off the Z axis. Today: 'opRevolve' is not defined (line 21). The Bend
//               kernel already has this solid (kernel/revolve.bend, revolveInBend):
//               volume pi*(18^2-12^2)*24 = 13571.680263507906 mm^3.
//   reliefCone  cad-project-041/.../m3-module/native/qualified-source.fs m3ReliefTool: a
//               triangle with one edge ON the axis (a countersink cone). Today:
//               'opRevolve' is not defined (line 32). revolve.bend refuses profiles
//               that touch the axis (refusal 2), so this also needs a kernel change.
annotation { "Feature Type Name" : "Revolved sleeve" }
export const sleeve = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var profile = newSketchOnPlane(context, id + "section", {
                "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)) });
        skRectangle(profile, "section", { "firstCorner" : vector(12, 0) * millimeter, "secondCorner" : vector(18, 24) * millimeter });
        skSolve(profile);
        opRevolve(context, id + "sleeve", { "entities" : qSketchRegion(id + "section"),
                "axis" : line(vector(0, 0, 0) * millimeter, vector(0, 0, 1)), "angleForward" : 360 * degree });
        opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "section", EntityType.BODY) });
    });
annotation { "Feature Type Name" : "Revolved relief cone" }
export const reliefCone = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var sk = newSketchOnPlane(context, id + "Profile", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)) });
        skPolyline(sk, "tri", { "points" : [vector(0, 0) * millimeter, vector(2.1, 0) * millimeter, vector(0, 2.1) * millimeter, vector(0, 0) * millimeter] });
        skSolve(sk);
        opRevolve(context, id + "Revolve", { "entities" : qSketchRegion(id + "Profile", false),
                "axis" : line(vector(0, 0, 0) * millimeter, vector(0, 0, 1)), "angleForward" : 360 * degree });
        opDeleteBodies(context, id + "Clean", { "entities" : qCreatedBy(id + "Profile", EntityType.BODY) });
    });
