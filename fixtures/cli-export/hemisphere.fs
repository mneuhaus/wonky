FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// The equatorial cut exposes a planar cap and a curved spherical surface.
annotation { "Feature Type Name" : "Export hemisphere" }
export const hemisphere = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        opSphere(context, id + "sphere", {
            "center" : vector(0, 0, 0) * millimeter,
            "radius" : 8.3 * millimeter
        });
        fCuboid(context, id + "halfspace", {
            "corner1" : vector(-20, -20, 0) * millimeter,
            "corner2" : vector(20, 20, 20) * millimeter
        });
        opBoolean(context, id + "cap", {
            "tools" : qUnion([
                qCreatedBy(id + "sphere", EntityType.BODY),
                qCreatedBy(id + "halfspace", EntityType.BODY)
            ]),
            "operationType" : BooleanOperationType.INTERSECTION
        });
    });
