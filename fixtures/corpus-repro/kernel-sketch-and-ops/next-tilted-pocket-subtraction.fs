FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");
// Not this cluster: the blocker that follows it for feederMounts (9 units, after the cap-normal
// fix) and for fixedCableClamp / switchBracket (8 units, after a planar-sided loft). A shallow
// pocket cut into the face of a prism on a tilted plane, here at the origin, so the F32
// cap-normal error of cap-normal-far-from-origin.fs plays no part. The axis-aligned variant
// (n = z, u = x) builds. Belongs to cluster boolean-invalid-topology.
function prism(context is Context, id is Id, pl is Plane, pts is array, depth is number) returns Query
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : pl });
    var points = [];
    for (var p in pts) points = append(points, vector(p[0], p[1]) * millimeter);
    points = append(points, points[0]);
    skPolyline(s, "outline", { "points" : points });
    skSolve(s);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : pl.normal, "endBound" : BoundingType.BLIND, "endDepth" : depth * millimeter });
    return qCreatedBy(id + "ex", EntityType.BODY);
}
annotation { "Feature Type Name" : "Tilted key pocket" }
export const tiltedKeyPocket = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var n = vector(-0.25, -sqrt(3) / 4, sqrt(3) / 2);
        var u = vector(sqrt(3) / 2, -0.5, 0);
        var foot = prism(context, id + "foot", plane(vector(0, 0, 0) * millimeter, n, u), [[-32, -10], [32, -10], [32, 10], [-32, 10]], 6);
        var pocket = prism(context, id + "pocket", plane(-n * 0.1 * millimeter, n, u), [[-20.2, -3], [20.2, -3], [20.2, 3], [-20.2, 3]], 1.6);
        opBoolean(context, id + "keyRecess", { "tools" : pocket, "targets" : foot, "operationType" : BooleanOperationType.SUBTRACTION });
    });
