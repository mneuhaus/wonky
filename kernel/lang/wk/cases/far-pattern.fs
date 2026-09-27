FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Errors today's host adapters raise around the kernel call, not in it:
//   farBox       a polyhedral pattern copy 1e30 mm away: decodeSolid's
//                validateSolid rejects it (FeatureScriptError, coordinate envelope)
//   farCylinder  an analytic pattern copy 1e30 mm away: real() rejects the
//                offset before the kernel runs (RangeError, magnitude <= 1e20)
// The WK path must report the same error, at the opPattern span.

annotation { "Feature Type Name" : "Far box" }
export const farBox = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "box", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 5) * millimeter });
        opPattern(context, id + "p", { "entities" : qCreatedBy(id + "box", EntityType.BODY), "transforms" : [transform(vector(1e30, 0, 0) * millimeter)], "instanceNames" : ["far"] });
    });

annotation { "Feature Type Name" : "Far cylinder" }
export const farCylinder = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : 5 * millimeter });
        skSolve(s);
        opExtrude(context, id + "cyl", { "entities" : qSketchRegion(id + "s", true), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 2 * millimeter });
        opPattern(context, id + "p", { "entities" : qCreatedBy(id + "cyl", EntityType.BODY), "transforms" : [transform(vector(1e30, 0, 0) * millimeter)], "instanceNames" : ["far"] });
    });
