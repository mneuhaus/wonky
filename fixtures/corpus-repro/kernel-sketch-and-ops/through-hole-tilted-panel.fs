FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");
// Same root cause as cap-normal-far-from-origin.fs, seen through a Boolean: the F32 cap normal
// of a far, tilted extrusion is off by about 1e-5 rad, so the through-hole admission
// (tool axis parallel to exactly two face normals within 1e-7) refuses a hole whose axis is
// the sketch-plane normal itself. Reduced from the cad-project-039 hopper family
// (archive-r7..r17/hopper.fs, hopper_r19.fs, r21-hopper-current.fs: panel0 with an M3 hole).
annotation { "Feature Type Name" : "Tilted panel with a perpendicular hole" }
export const tiltedPanelHole = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var o = vector(26.1263837814323, -498.4724643754777, -184.5128995194368);
        var n = vector(0, 0.8660254037844386, -0.5);
        var x = vector(0, 0.5, 0.8660254037844386);
        var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(o * millimeter, n, x) });
        skPolyline(s, "outline", { "points" : [vector(0, -60) * millimeter, vector(280, -60) * millimeter, vector(280, 10) * millimeter, vector(0, 10) * millimeter, vector(0, -60) * millimeter] });
        skSolve(s);
        opExtrude(context, id + "panel", { "entities" : qSketchRegion(id + "s", false), "direction" : n, "endBound" : BoundingType.BLIND, "endDepth" : 3.2 * millimeter });
        var h = newSketchOnPlane(context, id + "h", { "sketchPlane" : plane((o - n) * millimeter, n, x) });
        skCircle(h, "c", { "center" : vector(37.6, -15) * millimeter, "radius" : 1.7 * millimeter });
        skSolve(h);
        opExtrude(context, id + "tool", { "entities" : qSketchRegion(id + "h", false), "direction" : n, "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
        opBoolean(context, id + "hole", { "tools" : qCreatedBy(id + "tool", EntityType.BODY), "targets" : qCreatedBy(id + "panel", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });
