FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Next-blocker repro for cluster boolean-invalid-topology (docs/corpus/cluster-boolean-invalid-topology.md).
// A 20 x 14 x 10 mm plate minus a prism with one slanted face, the everyday FDM chamfer.
// Today both non-45-degree features stop at the carrier admission like the cluster:
//   node bin/wonky.mjs fixtures/corpus-repro/boolean-invalid-topology/next-blocker-chamfer.fs --check --feature chamferOnEdge
//     -> 37:5: Native planar arrangement subtraction unresolved: InvalidTopology (stage 1, detail 0)
//   --feature slantedCut -> 37:5: same message
//   --feature chamfer45  -> builds (1904 mm3): at 45 degrees the F32 carriers happen to be exact.
// With exact carriers (scripts/corpus/diagnose-planar-admission.mjs <this file> <feature> --simulate linearc)
// the operands are admitted and the planar arrangement itself refuses:
//   chamferOnEdge -> AmbiguousContact (stage 2, detail 11): the slanted face starts exactly on the
//                    plate's top edge x = 5, z = 10; the arrangement vertices on that edge are
//                    exact, the slanted carrier through them is not, so their distance is neither
//                    certified zero nor larger than the 1e-12 x scale margin.
//   slantedCut    -> UnsupportedArrangement (stage 6, detail 0): face ownership map, general position.
// The bake-off recover route builds both exactly from the same operands
// (out/corpus/boolean-invalid-topology/bakeoff-recover.json).
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

function chamferCut(context is Context, id is Id, profile is array)
{
    var plate = prism(context, id + "plate", plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)), [[0, 0], [20, 0], [20, 14], [0, 14]], 10);
    var tool = prism(context, id + "tool", plane(vector(0, 20, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)), profile, 30);
    opBoolean(context, id + "cut", { "targets" : plate, "tools" : tool, "operationType" : BooleanOperationType.SUBTRACTION });
}

annotation { "Feature Type Name" : "Chamfer starting on the top edge" }
export const chamferOnEdge = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    { chamferCut(context, id, [[5, 10], [25, 2], [25, 20], [5, 20]]); });

annotation { "Feature Type Name" : "Slanted cut in general position" }
export const slantedCut = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    { chamferCut(context, id, [[5, 11], [25, 2], [25, 20], [5, 20]]); });

annotation { "Feature Type Name" : "45 degree slanted cut (control)" }
export const chamfer45 = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    { chamferCut(context, id, [[5, 13], [16, 2], [25, 2], [25, 20], [5, 20]]); });
