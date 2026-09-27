FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Loud-failure case of the WK real-model spike (docs/language/spike-real-model.md):
// a box intersected with a cylinder. Today's host predicates pick the CURVED
// Boolean method (native Bend curved convex-tool intersection), which the WK
// native evaluator does not run: it must answer with a capability error at the
// opBoolean span, never with a result.
annotation { "Feature Type Name" : "Curved intersection" }
export const curvedIntersection = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "block", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(20, 20, 10) * millimeter });
        var sketch = newSketchOnPlane(context, id + "sketch", { "sketchPlane" : plane(vector(10, 10, -5) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skCircle(sketch, "circle", { "center" : vector(0, 0) * millimeter, "radius" : 6 * millimeter });
        skSolve(sketch);
        opExtrude(context, id + "pin", { "entities" : qSketchRegion(id + "sketch"), "direction" : vector(0, 0, 1),
            "endBound" : BoundingType.BLIND, "endDepth" : 20 * millimeter });
        opBoolean(context, id + "core", { "tools" : qUnion([qCreatedBy(id + "block", EntityType.BODY), qCreatedBy(id + "pin", EntityType.BODY)]),
            "operationType" : BooleanOperationType.INTERSECTION });
    });
