FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Repro for cluster boolean-invalid-topology (docs/corpus/cluster-boolean-invalid-topology.md).
// Stands for the 30 union units of the distributor interface family (fs95), e.g.
// Sorter_V2_Printed_Interface_R3/Source/interface-r3.fs#bottomSpoke (unite@162:4, innerTenonJoin):
// a slanted web prism united with an axis-aligned tenon block.
// The web's slanted side faces miss their own far vertices by up to 3.2e-6 mm (F32 carriers);
// the planar arrangement admits 3.3e-10 mm.
// Observed: 33:9: Native planar arrangement union unresolved: InvalidTopology (stage 1, detail 0)
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

annotation { "Feature Type Name" : "Slanted prism union" }
export const slantedPrismUnion = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        // interface-r3.fs bottomSpoke web and inner tenon, unchanged numbers.
        var web = prism(context, id + "web", plane(vector(0, 18, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)),
            [[125, 47], [315, 8], [324.8, 10], [324.8, 30], [315, 36], [125, 76]], 36);
        var tenon = prism(context, id + "tenon", plane(vector(0, 0, 60.15) * millimeter, vector(0, 0, 1), vector(1, 0, 0)),
            [[104, -8], [128, -8], [128, 8], [104, 8]], 10);
        opBoolean(context, id + "join", { "tools" : qUnion([web, tenon]), "operationType" : BooleanOperationType.UNION });
    });
