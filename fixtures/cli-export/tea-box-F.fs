FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Tea bag box, fillet-first: round the vertical edges of the outer block and of the pocket (single boxes), then subtract.
annotation { "Feature Type Name" : "Tea bag box filleted" }
export const teaBox = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
    }
    {
        const w = 160 * millimeter; const d = 45 * millimeter; const h = 45 * millimeter; const t = 2 * millimeter;
        const z0 = 0 * millimeter; const r = 2 * millimeter;
        fCuboid(context, id + "outer", { "corner1" : vector(z0, z0, z0), "corner2" : vector(w, d, h) });
        const outer = qCreatedBy(id + "outer", EntityType.BODY);
        var outerEdges = [];
        for (var p in [[z0, z0], [w, z0], [w, d], [z0, d]])
            outerEdges = append(outerEdges, qClosestTo(qOwnedByBody(outer, EntityType.EDGE), vector(p[0], p[1], h / 2)));
        opFillet(context, id + "roundOuter", { "entities" : qUnion(outerEdges), "radius" : r });
        fCuboid(context, id + "pocket", { "corner1" : vector(t, t, t), "corner2" : vector(w - t, d - t, h) });
        const pocket = qCreatedBy(id + "pocket", EntityType.BODY);
        var pocketEdges = [];
        for (var p in [[t, t], [w - t, t], [w - t, d - t], [t, d - t]])
            pocketEdges = append(pocketEdges, qClosestTo(qOwnedByBody(pocket, EntityType.EDGE), vector(p[0], p[1], h / 2 + t)));
        opFillet(context, id + "roundPocket", { "entities" : qUnion(pocketEdges), "radius" : r });
        opBoolean(context, id + "open", { "targets" : outer, "tools" : pocket, "operationType" : BooleanOperationType.SUBTRACTION });
    });
