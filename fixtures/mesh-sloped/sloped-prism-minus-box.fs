FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");
const EDGE_Z = 2;
annotation { "Feature Type Name" : "jaw test" }
export const jawTest = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        const mm = millimeter;
        var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(10, 0, 0) * mm, vector(1, 0, 0), vector(0, 1, 0)) });
        const pt = function(t, k) { return vector(-t + 2 * k, -2 * t - k + EDGE_Z) * mm; };
        skPolyline(sk, "p", { "points" : [pt(-1.25, 0.5), pt(3.5, 0.5), pt(3.5, 1.5), pt(-1.25, 1.5), pt(-1.25, 0.5)] });
        skSolve(sk);
        opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "sk"), "direction" : vector(1, 0, 0), "endBound" : BoundingType.BLIND, "endDepth" : 12 * mm });
        opDeleteBodies(context, id + "drop", { "entities" : qCreatedBy(id + "sk", EntityType.BODY) });
        fCuboid(context, id + "pilot", { "corner1" : vector(14.8, -2.5, -4.8) * mm, "corner2" : vector(17.2, 7, -2.4) * mm });
        opBoolean(context, id + "cut", { "tools" : qCreatedBy(id + "pilot", EntityType.BODY), "targets" : qCreatedBy(id + "ex", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });
