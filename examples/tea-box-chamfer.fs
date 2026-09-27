FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Planar tea-box stage: Boolean pocket and 0.42 mm foot chamfer, no fillets.
annotation { "Feature Type Name" : "Tea box with planar foot chamfer" }
export const teaBox = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        const w = 160 * millimeter;
        const d = 45 * millimeter;
        const h = 45 * millimeter;
        const t = 2 * millimeter;
        const zero = 0 * millimeter;
        fCuboid(context, id + "outer", {
            "corner1" : vector(zero, zero, zero), "corner2" : vector(w, d, h)
        });
        fCuboid(context, id + "pocket", {
            "corner1" : vector(t, t, t), "corner2" : vector(w - t, d - t, h)
        });
        opBoolean(context, id + "open", {
            "targets" : qCreatedBy(id + "outer", EntityType.BODY),
            "tools" : qCreatedBy(id + "pocket", EntityType.BODY),
            "operationType" : BooleanOperationType.SUBTRACTION
        });
        const body = qCreatedBy(id + "outer", EntityType.BODY);
        const edges = qOwnedByBody(body, EntityType.EDGE);
        var bottom = [];
        for (var p in [[w / 2, zero], [w, d / 2], [w / 2, d], [zero, d / 2]])
            bottom = append(bottom, qClosestTo(edges, vector(p[0], p[1], zero)));
        opChamfer(context, id + "foot", {
            "entities" : qUnion(bottom), "chamferType" : ChamferType.EQUAL_OFFSETS,
            "width" : 0.42 * millimeter
        });
    });
