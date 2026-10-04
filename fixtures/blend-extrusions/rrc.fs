FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Rounded rectangle (lines + 3-point quarter arcs) extruded; outer minus pocket.
function roundedRect(sk is Sketch, p is string, x0, y0, x1, y1, r)
{
    const k = r * (1 - 1 / sqrt(2));
    skLineSegment(sk, p ~ "b", { "start" : vector(x0 + r, y0), "end" : vector(x1 - r, y0) });
    skArc(sk, p ~ "c1", { "start" : vector(x1 - r, y0), "mid" : vector(x1 - k, y0 + k), "end" : vector(x1, y0 + r) });
    skLineSegment(sk, p ~ "r", { "start" : vector(x1, y0 + r), "end" : vector(x1, y1 - r) });
    skArc(sk, p ~ "c2", { "start" : vector(x1, y1 - r), "mid" : vector(x1 - k, y1 - k), "end" : vector(x1 - r, y1) });
    skLineSegment(sk, p ~ "t", { "start" : vector(x1 - r, y1), "end" : vector(x0 + r, y1) });
    skArc(sk, p ~ "c3", { "start" : vector(x0 + r, y1), "mid" : vector(x0 + k, y1 - k), "end" : vector(x0, y1 - r) });
    skLineSegment(sk, p ~ "l", { "start" : vector(x0, y1 - r), "end" : vector(x0, y0 + r) });
    skArc(sk, p ~ "c4", { "start" : vector(x0, y0 + r), "mid" : vector(x0 + k, y0 + k), "end" : vector(x0 + r, y0) });
}

annotation { "Feature Type Name" : "Tea box rounded" }
export const teaBoxRounded = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        const mm = millimeter;
        const w = 160 * mm; const d = 45 * mm; const h = 45 * mm; const t = 2 * mm; const r = 2 * mm;
        var so = newSketchOnPlane(context, id + "so", { "sketchPlane" : plane(vector(0, 0, 0) * mm, vector(0, 0, 1), vector(1, 0, 0)) });
        roundedRect(so, "o", 0 * mm, 0 * mm, w, d, r);
        skSolve(so);
        opExtrude(context, id + "outer", { "entities" : qSketchRegion(id + "so"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : h });
        var si = newSketchOnPlane(context, id + "si", { "sketchPlane" : plane(vector(0, 0, 0) * mm + vector(0, 0, 1) * t, vector(0, 0, 1), vector(1, 0, 0)) });
        roundedRect(si, "i", t, t, w - t, d - t, r);
        skSolve(si);
        opExtrude(context, id + "pocket", { "entities" : qSketchRegion(id + "si"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : h });
        opBoolean(context, id + "open", { "targets" : qCreatedBy(id + "outer", EntityType.BODY), "tools" : qCreatedBy(id + "pocket", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
        const edges = qOwnedByBody(qCreatedBy(id + "outer", EntityType.BODY), EntityType.EDGE);
        const z0 = 0 * mm; const k = r * (1 - 1 / sqrt(2));
        var foot = [];
        for (var p in [[w / 2, z0], [w, d / 2], [w / 2, d], [z0, d / 2], [w - k, k], [w - k, d - k], [k, d - k], [k, k]])
            foot = append(foot, qClosestTo(edges, vector(p[0], p[1], z0)));
        opChamfer(context, id + "foot", { "entities" : qUnion(foot), "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 0.42 * mm });
    });
