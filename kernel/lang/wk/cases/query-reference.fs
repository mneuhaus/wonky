FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// evaluateQuery results as operation arguments (the standard FS idiom
// `for (var b in evaluateQuery(context, q)) opX(..., b, ...)`): each reference
// query's owner is the modeling context, and the source-map snapshot of the
// operation's arguments, which becomes identity.operation.parameters, walks it.
// patternReference also sets appearance and name (in that order) before the
// pattern copies them (setProperty writes into the body object in place).

function washer(context is Context, id is Id, x is number, r is number) returns Query
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(x, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : r * millimeter });
    skSolve(s);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", true), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 2 * millimeter });
    opDeleteBodies(context, id + "ds", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    return qCreatedBy(id + "ex", EntityType.BODY);
}

annotation { "Feature Type Name" : "Each target" }
export const eachTarget = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var outer = washer(context, id + "w", 0, 5);
        var hole = washer(context, id + "h", 0, 2);
        for (var b in evaluateQuery(context, outer))
            opBoolean(context, id + "cut", { "targets" : b, "tools" : hole, "operationType" : BooleanOperationType.SUBTRACTION });
    });

annotation { "Feature Type Name" : "Pattern reference" }
export const patternReference = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var outer = washer(context, id + "w", 0, 5);
        opBoolean(context, id + "cut", { "targets" : outer, "tools" : washer(context, id + "h", 0, 2), "operationType" : BooleanOperationType.SUBTRACTION });
        setProperty(context, { "entities" : outer, "propertyType" : PropertyType.APPEARANCE, "value" : color(0.2, 0.4, 0.6) });
        setProperty(context, { "entities" : outer, "propertyType" : PropertyType.NAME, "value" : "washer" });
        opPattern(context, id + "p", { "entities" : evaluateQuery(context, outer)[0], "transforms" : [transform(vector(20, 0, 0) * millimeter)], "instanceNames" : ["copy"] });
    });
