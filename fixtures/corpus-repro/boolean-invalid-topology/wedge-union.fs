FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Minimal repro for cluster boolean-invalid-topology (docs/corpus/cluster-boolean-invalid-topology.md).
// A right-triangle wedge (legs 10 mm and 7 mm, 5 mm high) united with an axis-aligned box.
// The only difference between the three features is the direction of the wedge's hypotenuse.
// The F32 polygon extruder (kernel/topology.bend, extrude/side_face) anchors each side face
// at its first vertex with an F32-rounded normal. For the slanted hypotenuse the far
// vertices miss that plane by 7.7e-7 mm; the planar arrangement admits
// angular_guard 1e-12 x model scale (about 1.2e-11 mm here) and refuses the operand.
// At 45 degrees the rounding is symmetric and the residual is exactly zero.
//   node bin/wonky.mjs fixtures/corpus-repro/boolean-invalid-topology/wedge-union.fs --check --feature slanted
//     -> 33:5: Native planar arrangement union unresolved: InvalidTopology (stage 1, detail 0)
//   --feature diag45 -> builds (394 mm3), --feature square -> builds (494 mm3)
// Expected once fixed: --feature slanted builds one body of 319 mm3 (175 + 180 - 36).
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

function run(context is Context, id is Id, corner is array)
{
    var wedge = prism(context, id + "wedge", plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)), [[0, 0], [10, 0], corner], 5);
    var box = prism(context, id + "box", plane(vector(0, 0, 2) * millimeter, vector(0, 0, 1), vector(1, 0, 0)), [[-2, -2], [4, -2], [4, 3], [-2, 3]], 6);
    opBoolean(context, id + "join", { "tools" : qUnion([wedge, box]), "operationType" : BooleanOperationType.UNION });
}

annotation { "Feature Type Name" : "Slanted wedge union" }
export const slanted = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    { run(context, id, [0, 7]); });

annotation { "Feature Type Name" : "45 degree wedge union (control)" }
export const diag45 = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    { run(context, id, [0, 10]); });

annotation { "Feature Type Name" : "Rectangle union (control)" }
export const square = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var block = prism(context, id + "block", plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)), [[0, 0], [10, 0], [10, 7], [0, 7]], 5);
        var box = prism(context, id + "box", plane(vector(0, 0, 2) * millimeter, vector(0, 0, 1), vector(1, 0, 0)), [[-2, -2], [4, -2], [4, 3], [-2, 3]], 6);
        opBoolean(context, id + "join", { "tools" : qUnion([block, box]), "operationType" : BooleanOperationType.UNION });
    });
