FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// FP19 cut-corner chamfers (docs/fillet-housestyle.md section 5; record
// fixtures/fillet/fp19-reference.json). The FP06 input with its 45 degree cut
// made parametric: a 20 x 10 x 6 block whose corner (20, 10) is cut by a
// 45 degree line with legs c. EQUAL_OFFSETS chamfer d on the whole top loop
// (the edges in the plane z = 6), tangent propagation on.
// Onshape probe parts: c 0.5 / d 0.6 (regime i, plain mitres), c 0.5 / d 0.9
// (regime ii, the short edge's stripe is consumed), c 0.125 / d 0.42.
// `dx` shifts the case along x (all parts in one Onshape Part Studio).

export function cutCornerBlock(context is Context, id is Id, c is ValueWithUnits, dx is ValueWithUnits)
{
    const x0 = dx / millimeter;
    const k = c / millimeter;
    var s0 = newSketchOnPlane(context, id + "s0", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skLineSegment(s0, "e0", { "start" : vector(x0, 0) * millimeter, "end" : vector(x0 + 20, 0) * millimeter });
    skLineSegment(s0, "e1", { "start" : vector(x0 + 20, 0) * millimeter, "end" : vector(x0 + 20, 10 - k) * millimeter });
    skLineSegment(s0, "e2", { "start" : vector(x0 + 20, 10 - k) * millimeter, "end" : vector(x0 + 20 - k, 10) * millimeter });
    skLineSegment(s0, "e3", { "start" : vector(x0 + 20 - k, 10) * millimeter, "end" : vector(x0, 10) * millimeter });
    skLineSegment(s0, "e4", { "start" : vector(x0, 10) * millimeter, "end" : vector(x0, 0) * millimeter });
    skSolve(s0);
    opExtrude(context, id + "x1", { "entities" : qSketchRegion(id + "s0"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "s0", EntityType.BODY) });
    return qCreatedBy(id + "x1", EntityType.BODY);
}

annotation { "Feature Type Name" : "FP19 cut-corner chamfer" }
export const fp19CutCornerChamfer = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Cut leg c" }
        isLength(definition.c, ZERO_DEFAULT_LENGTH_BOUNDS);
        annotation { "Name" : "Chamfer d" }
        isLength(definition.d, ZERO_DEFAULT_LENGTH_BOUNDS);
        annotation { "Name" : "Shift" }
        isLength(definition.dx, ZERO_DEFAULT_LENGTH_BOUNDS);
    }
    {
        const body = cutCornerBlock(context, id + "in", definition.c, definition.dx);
        if (size(evaluateQuery(context, body)) != 1)
            throw regenError("probe harness: input is not one body");
        const inputVolume = evVolume(context, { "entities" : body }) / (millimeter ^ 3);
        const loop = qCoincidesWithPlane(qOwnedByBody(body, EntityType.EDGE), plane(vector(0, 0, 6) * millimeter, vector(0, 0, 1)));
        if (size(evaluateQuery(context, loop)) != 5)
            throw regenError("probe harness: top loop is not 5 edges");
        opChamfer(context, id + "blend", { "entities" : loop, "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : definition.d, "tangentPropagation" : true });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.NAME,
            "value" : "FP19 c" ~ (definition.c / millimeter) ~ " d" ~ (definition.d / millimeter) });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.DESCRIPTION,
            "value" : "input_volume_mm3=" ~ inputVolume });
    });
