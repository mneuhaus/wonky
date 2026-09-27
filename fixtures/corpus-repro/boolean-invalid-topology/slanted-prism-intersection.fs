FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Repro for cluster boolean-invalid-topology (docs/corpus/cluster-boolean-invalid-topology.md).
// Stands for machine-interface-r4/interface-r4.fs#bottomSpoke and
// Sorter_V2_Printed_Interface_R5/Source/interface-r5.fs#bottomSpoke (model/flareClip):
// the intersection of two convex slanted prisms. The convex-tool intersection needs one
// operand that passes the same incidence validation as the planar arrangement; with F32
// side-face carriers neither does, so it reports "no convex tool".
// Observed: 33:9: Native convex-tool intersection unresolved: UnsupportedArrangement (tool 0, face 0)
function prism(context is Context, id is Id, pl is Plane, points is array, depth is number) returns Query
{
    var sketch = newSketchOnPlane(context, id + "sketch", { "sketchPlane" : pl });
    var pts = [];
    for (var p in points)
        pts = append(pts, vector(p[0], p[1]) * millimeter);
    skPolyline(sketch, "outline", { "points" : append(pts, pts[0]) });
    skSolve(sketch);
    opExtrude(context, id + "extrude", { "entities" : qSketchRegion(id + "sketch"), "direction" : pl.normal,
                "endBound" : BoundingType.BLIND, "endDepth" : depth * millimeter });
    return qCreatedBy(id + "extrude", EntityType.BODY);
}

annotation { "Feature Type Name" : "Slanted prism intersection" }
export const slantedPrismIntersection = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        // interface-r4.fs bottomSpoke flare and flare profile, unchanged numbers.
        var flare = prism(context, id + "flare", plane(vector(0, 0, 43) * millimeter, vector(0, 0, 1)),
            [[117, -24], [126, -24], [151, -18], [151, 18], [126, 24], [117, 24]], 40);
        var profile = prism(context, id + "profile", plane(vector(0, 26, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)),
            [[117, 47], [151, 41.66], [151, 70.5263158], [125, 76], [117, 76]], 52);
        opBoolean(context, id + "clip", { "tools" : qUnion([flare, profile]), "operationType" : BooleanOperationType.INTERSECTION });
    });
