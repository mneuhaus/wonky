FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Repro for cluster boolean-invalid-topology (docs/corpus/cluster-boolean-invalid-topology.md).
// Stands for cad-project-043/fsocct/cases/workspace/project-component-4c7a33fe.fs#project-component-4c7a33fe/#project-component-4c7a33fe (noseCut) and the
// interface-r4..r12 retainingKey/switchBracket cuts: a polyline prism with one side edge that is
// neither axis-aligned nor at 45 degrees, minus an axis-aligned box.
// The F32 polygon extruder anchors that side face's plane at the edge start with an F32-rounded
// normal; the far vertices miss it by 1.07e-6 mm, the planar arrangement admits 6.8e-11 mm.
// Observed: 33:9: Native planar arrangement subtraction unresolved: InvalidTopology (stage 1, detail 0)
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

annotation { "Feature Type Name" : "Slanted prism cut" }
export const slantedPrismCut = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        // project-component-4c7a33fe.fs nose profile: the side (47,23)-(64,11) is the slanted face.
        var nose = prism(context, id + "nose", plane(vector(0, 40, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)),
            [[47, 23], [64, 11], [68, 11], [68, 45], [47, 45]], 80);
        var boxBody = prism(context, id + "box", plane(vector(0, 0, 5) * millimeter, vector(0, 0, 1), vector(1, 0, 0)),
            [[50, -5], [66, -5], [66, 5], [50, 5]], 10);
        opBoolean(context, id + "cut", { "targets" : nose, "tools" : boxBody, "operationType" : BooleanOperationType.SUBTRACTION });
    });
