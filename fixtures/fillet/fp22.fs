FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// FP22 mixed corner with unequal radii (docs/fillet-housestyle.md sections 3.4
// and 5; record fixtures/fillet/fp22-reference.json). The FP14 input
// (hard-mixed-convexity-corner-r1): an L profile, 10 high, whose concave
// vertical edge (8, 8) meets the convex top edges of the two inner faces at
// (8, 8, 10). One opFillet takes one radius, so unequal radii come from two
// features in sequence: first the concave edge with rc, then the two convex
// top edges with rv (tangent propagation carries the second fillet over the
// top arc of the first). The question: does the convex fillet roll around
// the concave cylinder's end as a torus with major radius rc + rv?
// Onshape probe parts: (a) rc 2 / rv 1, (b) rc 1 / rv 2, (c) rc 1 / rv 1
// (the sequential control of FP14's single fillet, 4152.7203490632).
// `dx` shifts the case along x.

export function lProfile(context is Context, id is Id, dx is ValueWithUnits)
{
    const x0 = dx / millimeter;
    var s0 = newSketchOnPlane(context, id + "s0", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skLineSegment(s0, "e0", { "start" : vector(x0, 0) * millimeter, "end" : vector(x0 + 30, 0) * millimeter });
    skLineSegment(s0, "e1", { "start" : vector(x0 + 30, 0) * millimeter, "end" : vector(x0 + 30, 8) * millimeter });
    skLineSegment(s0, "e2", { "start" : vector(x0 + 30, 8) * millimeter, "end" : vector(x0 + 8, 8) * millimeter });
    skLineSegment(s0, "e3", { "start" : vector(x0 + 8, 8) * millimeter, "end" : vector(x0 + 8, 30) * millimeter });
    skLineSegment(s0, "e4", { "start" : vector(x0 + 8, 30) * millimeter, "end" : vector(x0, 30) * millimeter });
    skLineSegment(s0, "e5", { "start" : vector(x0, 30) * millimeter, "end" : vector(x0, 0) * millimeter });
    skSolve(s0);
    opExtrude(context, id + "x1", { "entities" : qSketchRegion(id + "s0"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "s0", EntityType.BODY) });
    return qCreatedBy(id + "x1", EntityType.BODY);
}

function fpOneEdge(context is Context, body is Query, p is Vector) returns Query
{
    const q = qContainsPoint(qOwnedByBody(body, EntityType.EDGE), p * millimeter);
    if (size(evaluateQuery(context, q)) != 1)
        throw regenError("probe harness: no unique edge at " ~ p);
    return q;
}

annotation { "Feature Type Name" : "FP22 mixed corner, unequal radii" }
export const fp22MixedCorner = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Concave radius rc" }
        isLength(definition.rc, ZERO_DEFAULT_LENGTH_BOUNDS);
        annotation { "Name" : "Convex radius rv" }
        isLength(definition.rv, ZERO_DEFAULT_LENGTH_BOUNDS);
        annotation { "Name" : "Shift" }
        isLength(definition.dx, ZERO_DEFAULT_LENGTH_BOUNDS);
    }
    {
        const x0 = definition.dx / millimeter;
        const body = lProfile(context, id + "in", definition.dx);
        if (size(evaluateQuery(context, body)) != 1)
            throw regenError("probe harness: input is not one body");
        const inputVolume = evVolume(context, { "entities" : body }) / (millimeter ^ 3);
        opFillet(context, id + "concave", { "entities" : fpOneEdge(context, body, vector(x0 + 8, 8, 5)), "radius" : definition.rc, "tangentPropagation" : true });
        const concaveVolume = evVolume(context, { "entities" : body }) / (millimeter ^ 3);
        const rims = qUnion([fpOneEdge(context, body, vector(x0 + 19, 8, 10)), fpOneEdge(context, body, vector(x0 + 8, 19, 10))]);
        opFillet(context, id + "convex", { "entities" : rims, "radius" : definition.rv, "tangentPropagation" : true });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.NAME,
            "value" : "FP22 rc" ~ (definition.rc / millimeter) ~ " rv" ~ (definition.rv / millimeter) });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.DESCRIPTION,
            "value" : "input_volume_mm3=" ~ inputVolume ~ "; after_concave_mm3=" ~ concaveVolume });
    });
