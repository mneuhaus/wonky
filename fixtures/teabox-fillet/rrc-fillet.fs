FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Tea box re-authored for an exact kernel (fillets3d design D5): plain rectangles, the corner rounds come from
// opFillet r 2 on the vertical edges (tangent to both walls by construction) instead of three-point sketch arcs,
// whose binary64 mid points are tangent only to about 1e-17 m. The 0.42 mm bottom chamfer is unchanged.
// Each box is rounded before the subtraction (the outer box on its four vertical edges, the pocket tool on its
// four), which gives the same solid as rounding the eight vertical edges of the open box; the foot chamfer and its
// edge selection are unchanged.
function rect(sk is Sketch, p is string, x0, y0, x1, y1)
{
    skLineSegment(sk, p ~ "b", { "start" : vector(x0, y0), "end" : vector(x1, y0) });
    skLineSegment(sk, p ~ "r", { "start" : vector(x1, y0), "end" : vector(x1, y1) });
    skLineSegment(sk, p ~ "t", { "start" : vector(x1, y1), "end" : vector(x0, y1) });
    skLineSegment(sk, p ~ "l", { "start" : vector(x0, y1), "end" : vector(x0, y0) });
}

annotation { "Feature Type Name" : "Tea box rounded" }
export const teaBoxRounded = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        const mm = millimeter;
        const w = 160 * mm; const d = 45 * mm; const h = 45 * mm; const t = 2 * mm; const r = 2 * mm;
        var so = newSketchOnPlane(context, id + "so", { "sketchPlane" : plane(vector(0, 0, 0) * mm, vector(0, 0, 1), vector(1, 0, 0)) });
        rect(so, "o", 0 * mm, 0 * mm, w, d);
        skSolve(so);
        opExtrude(context, id + "outer", { "entities" : qSketchRegion(id + "so"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : h });
        const outer = qCreatedBy(id + "outer", EntityType.BODY);
        var vo = [];
        for (var c in [[0 * mm, 0 * mm], [w, 0 * mm], [w, d], [0 * mm, d]])
            vo = append(vo, qClosestTo(qOwnedByBody(outer, EntityType.EDGE), vector(c[0], c[1], h / 2)));
        opFillet(context, id + "roundOuter", { "entities" : qUnion(vo), "radius" : r });
        var si = newSketchOnPlane(context, id + "si", { "sketchPlane" : plane(vector(0, 0, 0) * mm + vector(0, 0, 1) * t, vector(0, 0, 1), vector(1, 0, 0)) });
        rect(si, "i", t, t, w - t, d - t);
        skSolve(si);
        opExtrude(context, id + "pocket", { "entities" : qSketchRegion(id + "si"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : h });
        const pocket = qCreatedBy(id + "pocket", EntityType.BODY);
        var vi = [];
        for (var c in [[t, t], [w - t, t], [w - t, d - t], [t, d - t]])
            vi = append(vi, qClosestTo(qOwnedByBody(pocket, EntityType.EDGE), vector(c[0], c[1], h / 2)));
        opFillet(context, id + "roundPocket", { "entities" : qUnion(vi), "radius" : r });
        opBoolean(context, id + "open", { "targets" : outer, "tools" : pocket, "operationType" : BooleanOperationType.SUBTRACTION });
        const edges = qOwnedByBody(outer, EntityType.EDGE);
        const z0 = 0 * mm; const k = r * (1 - 1 / sqrt(2));
        var foot = [];
        for (var p in [[w / 2, z0], [w, d / 2], [w / 2, d], [z0, d / 2], [w - k, k], [w - k, d - k], [k, d - k], [k, k]])
            foot = append(foot, qClosestTo(edges, vector(p[0], p[1], z0)));
        opChamfer(context, id + "foot", { "entities" : qUnion(foot), "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 0.42 * mm });
    });
