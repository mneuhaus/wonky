FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Repro for cluster boolean-invalid-topology (docs/corpus/cluster-boolean-invalid-topology.md).
// Stands for the 8 r10b copies with r10bTransferEdge (buildTransferEdge > cut, model/edge/op),
// e.g. cad-project-041/single-step-r10/jobs/r10b/pass3/camera/r10b.fs: an axis-aligned wall minus a
// 600 mm box that opPattern placed with an oblique rotation. Every face of the box is axis-aligned
// before the copy. The polygon transform rotates vertices in F32, so after the copy the four
// vertices of a face are no longer coplanar (up to 7.3e-6 mm); the arrangement admits 4.9e-10 mm.
// Observed: 35:9: Native planar arrangement subtraction unresolved: InvalidTopology (stage 1, detail 0)
function block(context is Context, id is Id, a is Vector, b is Vector) returns Query
{
    var sketch = newSketchOnPlane(context, id + "sketch", { "sketchPlane" : plane(vector(0, 0, a[2]) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skPolyline(sketch, "outline", { "points" : [vector(a[0], a[1]) * millimeter, vector(b[0], a[1]) * millimeter,
                vector(b[0], b[1]) * millimeter, vector(a[0], b[1]) * millimeter, vector(a[0], a[1]) * millimeter] });
    skSolve(sketch);
    opExtrude(context, id + "extrude", { "entities" : qSketchRegion(id + "sketch"), "direction" : vector(0, 0, 1),
                "endBound" : BoundingType.BLIND, "endDepth" : (b[2] - a[2]) * millimeter });
    return qCreatedBy(id + "extrude", EntityType.BODY);
}

annotation { "Feature Type Name" : "Rotated box cut" }
export const rotatedBoxCut = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        // r10b.fs buildTransferEdge with the default K15 angle, unchanged numbers.
        var wall = block(context, id + "wall", vector(-93.3, 0, 48), vector(93.3, 4, 150));
        var k = tan(15 * degree);
        var n = normalize(vector(-k, -tan(5 * degree), 1));
        var u = normalize(vector(1, 0, k));
        var v = cross(n, u);
        var r = matrix([[u[0], v[0], n[0]], [u[1], v[1], n[1]], [u[2], v[2], n[2]]]);
        var box = block(context, id + "box", vector(-300, -300, 0), vector(300, 300, 300));
        opPattern(context, id + "place", { "entities" : box, "transforms" : [transform(r, vector(0, 4, 121.03 - 90.2 * k) * millimeter)], "instanceNames" : ["upper"] });
        opBoolean(context, id + "cut", { "targets" : wall, "tools" : qCreatedBy(id + "place", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });
