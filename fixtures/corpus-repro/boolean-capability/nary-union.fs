FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Repro for cluster boolean-capability, sub-cause nary
// (docs/corpus/cluster-boolean-capability.md). Onshape's opBoolean takes any
// number of tools (UNION/INTERSECTION) and targets/tools (SUBTRACTION); the
// adapter in src/library.mjs accepts exactly two tools, or one target and one
// tool. The corpus `unite(context, id, [a, b, c])` helpers pass three or four.
// Stands for 13 units: fs95 motorBracket (cheekJoin, join, earJoin),
// module-r4-upload#movingGripKeeperR4, upper-drive-r3#fixedCollar,
// fs422 feederSideGuards.
//
// Observed (node bin/wonky.mjs <file> --check): see README.md.
function block(context is Context, id is Id, p0 is Vector, p1 is Vector) returns Query
{
    var sketch = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, p0[2]) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skPolyline(sketch, "outline", { "points" : [vector(p0[0], p0[1]) * millimeter, vector(p1[0], p0[1]) * millimeter,
                    vector(p1[0], p1[1]) * millimeter, vector(p0[0], p1[1]) * millimeter, vector(p0[0], p0[1]) * millimeter] });
    skSolve(sketch);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1),
                "endBound" : BoundingType.BLIND, "endDepth" : (p1[2] - p0[2]) * millimeter });
    opDeleteBodies(context, id + "ds", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    return qCreatedBy(id + "ex", EntityType.BODY);
}

annotation { "Feature Type Name" : "Three-tool union" }
export const threeToolUnion = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        // Two cheeks on a base plate; all three overlap the base by 1 mm, none overlap each other.
        var base = block(context, id + "base", vector(0, 0, 0), vector(40, 30, 5));
        var left = block(context, id + "left", vector(0, 0, 4), vector(6, 30, 30));
        var right = block(context, id + "right", vector(34, 0, 4), vector(40, 30, 30));
        opBoolean(context, id + "join", { "tools" : qUnion([base, left, right]), "operationType" : BooleanOperationType.UNION });
    });

// The same three blocks, listed so that the first two are disjoint and only
// the third connects them (fs95 motorBracket `join`: the cheeks meet only
// through the web). Onshape unites all tools at once and returns one body; a
// pairwise left fold that continues with its first result body returns two.
annotation { "Feature Type Name" : "Bridged three-tool union" }
export const bridgedThreeToolUnion = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var left = block(context, id + "left", vector(0, 0, 4), vector(6, 30, 30));
        var right = block(context, id + "right", vector(34, 0, 4), vector(40, 30, 30));
        var base = block(context, id + "base", vector(0, 0, 0), vector(40, 30, 5));
        opBoolean(context, id + "join", { "tools" : qUnion([left, right, base]), "operationType" : BooleanOperationType.UNION });
    });
