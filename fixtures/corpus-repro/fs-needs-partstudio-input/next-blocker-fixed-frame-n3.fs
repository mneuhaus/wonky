FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Next blocker of 20 fixed-frame R29/R30 files in this cluster, after their
// Part Studio guard (m3-sorter stops at a different subtraction of this class).
// Reduced from cad-project-039/belt-fixed-r30/fixed-frame-r30.fs:81-83
// (n3 = subtract(n1, n2)); the prism lines are copied unchanged, the identity
// opPattern copy of n1 is dropped (same failure without it).
// Today: InvalidTopology (stage 1): the F32 polygon extruder leaves the slanted
// vertices 2.5e-6 mm (n1) and 3.8e-5 mm (n2) off their face planes.
// With F32x2 construction simulated: AmbiguousContact (stage 2, detail 15),
// a side face of n1 is coplanar with a face of n2.
function prism(context is Context, id is Id, pl is Plane, pts is array, direction is Vector, depth is number) returns Query
{
    var sk = newSketchOnPlane(context, id + "s", { "sketchPlane" : pl });
    var pp = [];
    for (var p in pts)
        pp = append(pp, vector(p[0], p[1]) * millimeter);
    pp = append(pp, pp[0]);
    skPolyline(sk, "outline", { "points" : pp });
    skSolve(sk);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : direction, "endBound" : BoundingType.BLIND, "endDepth" : depth * millimeter });
    opDeleteBodies(context, id + "ds", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    return qCreatedBy(id + "ex", EntityType.BODY);
}

annotation { "Feature Type Name" : "Fixed-frame n3 subtraction" }
export const fixedFrameN3 = defineFeature(function(context is Context, id is Id, definition is map)
    precondition { }
    {
        var q1 = prism(context, id + "n1", plane(vector(207.71226853282, -80, 34) * millimeter, vector(0, 1, 0), vector(-0.25881904510252, 0, -0.96592582628907)), [[0, 0], [98.531579063322, 0], [98.531579063322, 12.264155139932], [135.63695279857, 150.7432951537], [99.574506958054, 213.20528359467], [83.153767911141, 217.60520736142], [53.759890997742, 200.63464461294]], vector(0, 1, 0), 160);
        var q2 = prism(context, id + "n2", plane(vector(199.81011439418, -139, 4.5087592653505) * millimeter, vector(0.25881904510252, 0, 0.96592582628907), vector(0, 1, 0)), [[0, 0], [80, 0], [88, 5.6016603056777], [160, 5.6016603056777], [160, -1200.1], [0, -1200.1]], vector(0.25881904510252, 0, 0.96592582628907), 1190);
        opBoolean(context, id + "n3", { "targets" : q1, "tools" : q2, "keepTools" : true, "operationType" : BooleanOperationType.SUBTRACTION });
    });
