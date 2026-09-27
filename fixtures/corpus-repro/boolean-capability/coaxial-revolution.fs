FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Repro for cluster boolean-capability, sub-cause coaxial-revolution
// (docs/corpus/cluster-boolean-capability.md). Both features unite two solids
// of revolution about the same axis. The coaxial arm of booleanInBend only
// admits two cylinder PRIMITIVES, so a ring (itself a coaxial Boolean result)
// or a loft cone falls through to the general refusal.
//
// ringUnion stands for the 56 union units of the distributor interface family
// (fs95), e.g. machine-interface-r8/interface-r8.fs#bottomCarrier
// (unite@... wallJoin): floor ring and wall ring, corpus numbers unchanged.
// countersunkHead stands for 26 units (fs95 fastenersR4/R7, fs365, fs386,
// fs550): an M4 shank united with its countersink cone.
//
// Observed (node bin/wonky.mjs <file> --check --feature <f>):
//   ringUnion:       40:9: opBoolean supports coaxial cylinder primitives, ...; general trimmed-face booleans are not implemented
//   countersunkHead: 50:9: (same message)
function cyl(context is Context, id is Id, z is number, r is number, h is number) returns Query
{
    var sketch = newSketchOnPlane(context, id + "sketch", { "sketchPlane" : plane(vector(0, 0, z) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skCircle(sketch, "circle", { "center" : vector(0, 0) * millimeter, "radius" : r * millimeter });
    skSolve(sketch);
    opExtrude(context, id + "extrude", { "entities" : qSketchRegion(id + "sketch", false), "direction" : vector(0, 0, 1),
                "endBound" : BoundingType.BLIND, "endDepth" : h * millimeter });
    opDeleteBodies(context, id + "drop", { "entities" : qCreatedBy(id + "sketch", EntityType.BODY) });
    return qCreatedBy(id + "extrude", EntityType.BODY);
}

function ring(context is Context, id is Id, z is number, ro is number, ri is number, h is number) returns Query
{
    var outer = cyl(context, id + "outer", z, ro, h);
    opBoolean(context, id + "hole", { "targets" : outer, "tools" : cyl(context, id + "inner", z - 1, ri, h + 2),
                "operationType" : BooleanOperationType.SUBTRACTION });
    return outer;
}

function cone(context is Context, id is Id, z is number, r0 is number, r1 is number, h is number) returns Query
{
    var profiles = [];
    var sketches = [];
    for (var k = 0; k < 2; k += 1)
    {
        var sketch = newSketchOnPlane(context, id + ("s" ~ k), { "sketchPlane" : plane(vector(0, 0, z + k * h) * millimeter, vector(0, 0, 1)) });
        skCircle(sketch, "circle", { "center" : vector(0, 0) * millimeter, "radius" : (k == 0 ? r0 : r1) * millimeter });
        skSolve(sketch);
        profiles = append(profiles, qSketchRegion(id + ("s" ~ k), false));
        sketches = append(sketches, qCreatedBy(id + ("s" ~ k), EntityType.BODY));
    }
    opLoft(context, id + "loft", { "profileSubqueries" : profiles });
    opDeleteBodies(context, id + "drop", { "entities" : qUnion(sketches) });
    return qCreatedBy(id + "loft", EntityType.BODY);
}

annotation { "Feature Type Name" : "Ring union" }
export const ringUnion = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var floor = ring(context, id + "floor", 18.7, 122, 76, 6);
        var wall = ring(context, id + "wall", 24.6, 122, 118.5, 32.6);
        opBoolean(context, id + "wallJoin", { "tools" : qUnion([floor, wall]), "operationType" : BooleanOperationType.UNION });
    });

annotation { "Feature Type Name" : "Countersunk head" }
export const countersunkHead = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var shank = cyl(context, id + "shank", -20, 2, 17.57);
        var head = cone(context, id + "head", -2.48, 2, 4.48, 2.48);
        opBoolean(context, id + "join", { "tools" : qUnion([shank, head]), "operationType" : BooleanOperationType.UNION });
    });
