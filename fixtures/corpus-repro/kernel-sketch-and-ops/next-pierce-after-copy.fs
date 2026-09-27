FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Not this cluster: the blocker that follows it in r10bSideDrive (7 corpus units and
// fixtures/r10b/r10b.fs). r10b's cut() clones its target with opPattern before every Boolean.
// A copied through-hole body has no volume (transformAnalytic keeps volumeMm3 only for a list of
// construction methods that lacks 'native Bend through-hole pierce'), and the second pierce
// serializes that null volume: a JS RangeError without a source location instead of a result
// or an explicit capability error.
function pin(context is Context, id is Id, x is number) returns Query
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(x, 10, -1) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : 1.6 * millimeter });
    skSolve(s);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 8 * millimeter });
    return qCreatedBy(id + "ex", EntityType.BODY);
}
annotation { "Feature Type Name" : "Pierce a copied pierced plate" }
export const pierceAfterCopy = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "plate", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(40, 20, 5) * millimeter });
        opBoolean(context, id + "b1", { "tools" : pin(context, id + "t1", 10), "targets" : qCreatedBy(id + "plate", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
        opPattern(context, id + "copy", { "entities" : qCreatedBy(id + "plate", EntityType.BODY), "transforms" : [identityTransform()], "instanceNames" : ["copy"] });
        opBoolean(context, id + "b2", { "tools" : pin(context, id + "t2", 30), "targets" : qCreatedBy(id + "copy", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });
