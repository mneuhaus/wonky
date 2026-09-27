FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// FP20 small corner radius (docs/fillet-housestyle.md section 5; record
// fixtures/fillet/fp20-reference.json). A rounded rectangle 20 x 10 with
// corner radius r (four lines and four quarter arcs, G1), extruded 6; an
// EQUAL_OFFSETS chamfer d on the whole top loop (the edges in the plane
// z = 6), tangent propagation on. With r < d the corner cone chamfer passes
// its apex (verify-2 refuses that as `overflow`).
// Onshape probe parts: r 0.3125 / d 0.42 (the question), r 0.42 / d 0.42 (the
// cone ends in its apex), r 0.5 / d 0.42 (control, r > d).
// `dx` shifts the case along x (all parts in one Onshape Part Studio).

export function roundedPlate(context is Context, id is Id, r is ValueWithUnits, dx is ValueWithUnits)
{
    const x0 = dx / millimeter;
    const k = r / millimeter;
    const m = k * (1 - 1 / sqrt(2));
    var s0 = newSketchOnPlane(context, id + "s0", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skLineSegment(s0, "l0", { "start" : vector(x0 + k, 0) * millimeter, "end" : vector(x0 + 20 - k, 0) * millimeter });
    skArc(s0, "a0", { "start" : vector(x0 + 20 - k, 0) * millimeter, "mid" : vector(x0 + 20 - m, m) * millimeter, "end" : vector(x0 + 20, k) * millimeter });
    skLineSegment(s0, "l1", { "start" : vector(x0 + 20, k) * millimeter, "end" : vector(x0 + 20, 10 - k) * millimeter });
    skArc(s0, "a1", { "start" : vector(x0 + 20, 10 - k) * millimeter, "mid" : vector(x0 + 20 - m, 10 - m) * millimeter, "end" : vector(x0 + 20 - k, 10) * millimeter });
    skLineSegment(s0, "l2", { "start" : vector(x0 + 20 - k, 10) * millimeter, "end" : vector(x0 + k, 10) * millimeter });
    skArc(s0, "a2", { "start" : vector(x0 + k, 10) * millimeter, "mid" : vector(x0 + m, 10 - m) * millimeter, "end" : vector(x0, 10 - k) * millimeter });
    skLineSegment(s0, "l3", { "start" : vector(x0, 10 - k) * millimeter, "end" : vector(x0, k) * millimeter });
    skArc(s0, "a3", { "start" : vector(x0, k) * millimeter, "mid" : vector(x0 + m, m) * millimeter, "end" : vector(x0 + k, 0) * millimeter });
    skSolve(s0);
    opExtrude(context, id + "x1", { "entities" : qSketchRegion(id + "s0"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "s0", EntityType.BODY) });
    return qCreatedBy(id + "x1", EntityType.BODY);
}

annotation { "Feature Type Name" : "FP20 small corner radius" }
export const fp20SmallCornerRadius = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Corner radius r" }
        isLength(definition.r, ZERO_DEFAULT_LENGTH_BOUNDS);
        annotation { "Name" : "Chamfer d" }
        isLength(definition.d, ZERO_DEFAULT_LENGTH_BOUNDS);
        annotation { "Name" : "Shift" }
        isLength(definition.dx, ZERO_DEFAULT_LENGTH_BOUNDS);
    }
    {
        const body = roundedPlate(context, id + "in", definition.r, definition.dx);
        if (size(evaluateQuery(context, body)) != 1)
            throw regenError("probe harness: input is not one body");
        const inputVolume = evVolume(context, { "entities" : body }) / (millimeter ^ 3);
        const loop = qCoincidesWithPlane(qOwnedByBody(body, EntityType.EDGE), plane(vector(0, 0, 6) * millimeter, vector(0, 0, 1)));
        if (size(evaluateQuery(context, loop)) != 8)
            throw regenError("probe harness: top loop is not 8 edges");
        opChamfer(context, id + "blend", { "entities" : loop, "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : definition.d, "tangentPropagation" : true });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.NAME,
            "value" : "FP20 r" ~ (definition.r / millimeter) ~ " d" ~ (definition.d / millimeter) });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.DESCRIPTION,
            "value" : "input_volume_mm3=" ~ inputVolume });
    });
