FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Repro for cluster boolean-invalid-topology (docs/corpus/cluster-boolean-invalid-topology.md).
// Stands for cad-project-039/c-channel-bases-onepiece-r7/channel-bases-r7.fs
// (subtract@78:9, model/v3/op): a generated arc band polygon with 192 points (a 384-vertex prism)
// minus a second polygon prism. The planar arrangement admits at most 256 vertices, 512 edges and
// 256 faces per operand and reports the size refusal with the same code as a family refusal.
// The tool's slanted faces would fail the incidence check next (InvalidTopology).
// Observed: 37:9: Native planar arrangement subtraction unresolved: UnsupportedArrangement (stage 1, detail 0)
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

annotation { "Feature Type Name" : "Many-vertex prism cut" }
export const manyVertexPrismCut = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        // An annular band 90..105 mm over 150 degrees, 96 points per arc (channel-bases-r7 v1 has 192 points).
        var outline = [];
        for (var i = 0; i < 96; i += 1)
            outline = append(outline, [105 * cos((-30 + i * 150 / 95) * degree), 105 * sin((-30 + i * 150 / 95) * degree)]);
        for (var i = 95; i >= 0; i -= 1)
            outline = append(outline, [90 * cos((-30 + i * 150 / 95) * degree), 90 * sin((-30 + i * 150 / 95) * degree)]);
        var band = prism(context, id + "band", plane(vector(0, 0, -18.8) * millimeter, vector(0, 0, 1), vector(1, 0, 0)), outline, 10);
        var tool = prism(context, id + "tool", plane(vector(0, 0, -18.9) * millimeter, vector(0, 0, 1), vector(1, 0, 0)),
            [[62.871092299, 91.478006937], [45, 80], [60, 70], [80, 75]], 12);
        opBoolean(context, id + "cut", { "targets" : band, "tools" : tool, "operationType" : BooleanOperationType.SUBTRACTION });
    });
