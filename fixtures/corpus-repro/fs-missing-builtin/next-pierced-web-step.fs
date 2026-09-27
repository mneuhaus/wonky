FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");
// NEXT blockers of module-r4-upload.fs#frameR4Diagonal once opTransform exists.
// The diagonal web and its two holes, with the file's values, built without
// opTransform (the foot hole tool is sketched on a plane normal to +X instead of
// being posed by axialCylinder), so no missing builtin is involved.
//
// Feature `footHole` builds (native Bend through-hole pierce, 12 faces,
// 116252.854131 mm^3), but `--format step` writes no .step:
// "STEP cylindrical parameter curves unresolved: InvalidSource" (exit 1; the
// .brep.json is written). The same hole in a box or pentagon profile exports.
//
// Feature `headPilot` adds the corpus's second cut, a BLIND r 1.35 pilot from the
// top (it stops 2.2 mm above the underside at y = 181). It stops with "opBoolean
// through holes need a tool axis perpendicular to exactly two faces of the
// target": the web has three faces normal to Z, and a blind hole is outside the
// pierce admission anyway. The bake-off `recover` route builds this exactly
// (scripts/corpus/fs-missing-builtin/recover-next.mjs, case r4-diagonal-headpilot).
const H = 778.5895640637211;
function web(context is Context, id is Id) returns Query
{
    var pts = [[170, H], [192, H], [198, H - 8], [344, 603.2], [344, 571.2], [320, 571.2], [320, 583.2], [184, H - 12], [170, H - 12], [170, H]];
    var vs = [];
    for (var p in pts)
        vs = append(vs, vector(p[0], p[1]) * millimeter);
    var s = newSketchOnPlane(context, id + "ws", { "sketchPlane" : plane(vector(-10, 0, 0) * millimeter, vector(1, 0, 0), vector(0, 1, 0)) });
    skPolyline(s, "outline", { "points" : vs });
    skSolve(s);
    opExtrude(context, id + "web", { "entities" : qSketchRegion(id + "ws", false), "direction" : vector(1, 0, 0), "endBound" : BoundingType.BLIND, "endDepth" : 20 * millimeter });
    opDeleteBodies(context, id + "dws", { "entities" : qCreatedBy(id + "ws", EntityType.BODY) });
    var c = newSketchOnPlane(context, id + "fs", { "sketchPlane" : plane(vector(-11, 332, 586.2) * millimeter, vector(1, 0, 0), vector(0, 1, 0)) });
    skCircle(c, "circle", { "center" : vector(0, 0) * millimeter, "radius" : 2.75 * millimeter });
    skSolve(c);
    opExtrude(context, id + "footTool", { "entities" : qSketchRegion(id + "fs", false), "direction" : vector(1, 0, 0), "endBound" : BoundingType.BLIND, "endDepth" : 22 * millimeter });
    opDeleteBodies(context, id + "dfs", { "entities" : qCreatedBy(id + "fs", EntityType.BODY) });
    opBoolean(context, id + "footHole", { "targets" : qCreatedBy(id + "web", EntityType.BODY), "tools" : qCreatedBy(id + "footTool", EntityType.BODY),
            "operationType" : BooleanOperationType.SUBTRACTION });
    return qCreatedBy(id + "web", EntityType.BODY);
}
annotation { "Feature Type Name" : "Web with foot hole" }
export const footHole = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        web(context, id);
    });
annotation { "Feature Type Name" : "Web with foot hole and blind head pilot" }
export const headPilot = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var b = web(context, id);
        var s = newSketchOnPlane(context, id + "ps", { "sketchPlane" : plane(vector(0, 181, H - 9.8) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skCircle(s, "circle", { "center" : vector(0, 0) * millimeter, "radius" : 1.35 * millimeter });
        skSolve(s);
        opExtrude(context, id + "headTool", { "entities" : qSketchRegion(id + "ps", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
        opDeleteBodies(context, id + "dps", { "entities" : qCreatedBy(id + "ps", EntityType.BODY) });
        opBoolean(context, id + "headPilot", { "targets" : b, "tools" : qCreatedBy(id + "headTool", EntityType.BODY),
                "operationType" : BooleanOperationType.SUBTRACTION });
    });
