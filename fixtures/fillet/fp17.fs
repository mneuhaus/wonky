FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// FP17 variable-dihedral chamfer chains (docs/fillet-housestyle.md section 2.2
// and 5; record fixtures/fillet/fp17-reference.json).
// `boss` false: KS01 without the bore and without the countersink. A block
// 30 x 18 x 26 (x -15..15, y -9..9) with R4.2 vertical corners (sketched as a
// rounded rectangle), cut by the R26.3 cradle (axis Y through z 47.6), which
// removes the whole top face and leaves a 55.23 degree knife along x = +-15.
// EQUAL_OFFSETS chamfer w on every edge of the cradle face (one G1 loop: rim
// arcs on y = +-9, quartics on the R4.2 cylinders, knife lines on x = +-15).
// `reverse` hands the same edges to opChamfer in reversed query order.
// `boss` true: a cylinder R10, z 0..15, cut by the plane z = 10 + x tan 20deg;
// EQUAL_OFFSETS chamfer w on the ellipse rim (dihedral 70..110 degrees).
// Onshape probe parts: (a) cradle w 0.42, (b) cradle w 0.42 reversed, (c) boss
// w 0.42, (d) cradle w 1.0. `dx` shifts the case along x.

function fpPrism(context is Context, id is Id, sketchPlane is Plane, points is array, depth is ValueWithUnits) returns Query
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : sketchPlane });
    for (var i = 0; i < size(points); i += 1)
        skLineSegment(s, "l" ~ i, { "start" : points[i] * millimeter, "end" : points[(i + 1) % size(points)] * millimeter });
    skSolve(s);
    opExtrude(context, id + "x", { "entities" : qSketchRegion(id + "s"), "direction" : sketchPlane.normal, "endBound" : BoundingType.BLIND, "endDepth" : depth });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    return qCreatedBy(id + "x", EntityType.BODY);
}

function fpCylinder(context is Context, id is Id, sketchPlane is Plane, r is number, depth is ValueWithUnits) returns Query
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : sketchPlane });
    skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : r * millimeter });
    skSolve(s);
    opExtrude(context, id + "x", { "entities" : qSketchRegion(id + "s"), "direction" : sketchPlane.normal, "endBound" : BoundingType.BLIND, "endDepth" : depth });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    return qCreatedBy(id + "x", EntityType.BODY);
}

// Rounded rectangle x0..x1, y0..y1, corner radius k (mm), extruded h (mm) from z 0.
function fpRoundedBlock(context is Context, id is Id, x0 is number, y0 is number, x1 is number, y1 is number, k is number, h is number) returns Query
{
    const m = k * (1 - 1 / sqrt(2));
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skLineSegment(s, "l0", { "start" : vector(x0 + k, y0) * millimeter, "end" : vector(x1 - k, y0) * millimeter });
    skArc(s, "a0", { "start" : vector(x1 - k, y0) * millimeter, "mid" : vector(x1 - m, y0 + m) * millimeter, "end" : vector(x1, y0 + k) * millimeter });
    skLineSegment(s, "l1", { "start" : vector(x1, y0 + k) * millimeter, "end" : vector(x1, y1 - k) * millimeter });
    skArc(s, "a1", { "start" : vector(x1, y1 - k) * millimeter, "mid" : vector(x1 - m, y1 - m) * millimeter, "end" : vector(x1 - k, y1) * millimeter });
    skLineSegment(s, "l2", { "start" : vector(x1 - k, y1) * millimeter, "end" : vector(x0 + k, y1) * millimeter });
    skArc(s, "a2", { "start" : vector(x0 + k, y1) * millimeter, "mid" : vector(x0 + m, y1 - m) * millimeter, "end" : vector(x0, y1 - k) * millimeter });
    skLineSegment(s, "l3", { "start" : vector(x0, y1 - k) * millimeter, "end" : vector(x0, y0 + k) * millimeter });
    skArc(s, "a3", { "start" : vector(x0, y0 + k) * millimeter, "mid" : vector(x0 + m, y0 + m) * millimeter, "end" : vector(x0 + k, y0) * millimeter });
    skSolve(s);
    opExtrude(context, id + "x", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : h * millimeter });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    return qCreatedBy(id + "x", EntityType.BODY);
}

function fpSubtract(context is Context, id is Id, target is Query, tool is Query)
{
    opBoolean(context, id, { "targets" : target, "tools" : tool, "operationType" : BooleanOperationType.SUBTRACTION });
}

annotation { "Feature Type Name" : "FP17 variable-dihedral chamfer chain" }
export const fp17VariableDihedral = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Chamfer w" }
        isLength(definition.w, ZERO_DEFAULT_LENGTH_BOUNDS);
        annotation { "Name" : "Reverse edge order", "Default" : false }
        definition.reverse is boolean;
        annotation { "Name" : "Tilted boss", "Default" : false }
        definition.boss is boolean;
        annotation { "Name" : "Shift" }
        isLength(definition.dx, ZERO_DEFAULT_LENGTH_BOUNDS);
    }
    {
        const x0 = definition.dx / millimeter;
        var body;
        var edges;
        var label;
        if (definition.boss)
        {
            body = fpCylinder(context, id + "boss", plane(vector(x0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)), 10, 15 * millimeter);
            const t = tan(20 * degree);
            const cut = fpPrism(context, id + "cut", plane(vector(0, 20, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)),
                [vector(x0 - 20, 10 - 20 * t), vector(x0 + 20, 10 + 20 * t), vector(x0 + 20, 40), vector(x0 - 20, 40)], 40 * millimeter);
            fpSubtract(context, id + "cutBool", body, cut);
            edges = qContainsPoint(qOwnedByBody(body, EntityType.EDGE), vector(x0, 10, 10) * millimeter);
            label = "FP17c tilted boss rim";
        }
        else
        {
            body = fpRoundedBlock(context, id + "block", x0 - 15, -9, x0 + 15, 9, 4.2, 26);
            const cradle = fpCylinder(context, id + "cradle", plane(vector(x0, -10, 47.6) * millimeter, vector(0, 1, 0), vector(1, 0, 0)), 26.3, 20 * millimeter);
            fpSubtract(context, id + "cradleBool", body, cradle);
            const face = qContainsPoint(qOwnedByBody(body, EntityType.FACE), vector(x0 + 8, 0, 47.6 - sqrt(26.3 * 26.3 - 64)) * millimeter);
            if (size(evaluateQuery(context, face)) != 1)
                throw regenError("probe harness: cradle face not unique");
            edges = qAdjacent(face, AdjacencyType.EDGE, EntityType.EDGE);
            label = definition.reverse ? "FP17b cradle loop reversed" : "FP17a cradle loop";
        }
        if (size(evaluateQuery(context, body)) != 1)
            throw regenError("probe harness: input is not one body");
        const inputVolume = evVolume(context, { "entities" : body }) / (millimeter ^ 3);
        const list = evaluateQuery(context, edges);
        if (size(list) < 1)
            throw regenError("probe harness: no edge selected");
        var ordered = [];
        if (definition.reverse)
        {
            for (var i = size(list) - 1; i >= 0; i -= 1)
                ordered = append(ordered, list[i]);
        }
        else
            ordered = list;
        opChamfer(context, id + "blend", { "entities" : qUnion(ordered), "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : definition.w, "tangentPropagation" : true });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.NAME,
            "value" : label ~ " w" ~ (definition.w / millimeter) });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.DESCRIPTION,
            "value" : "input_volume_mm3=" ~ inputVolume ~ "; selected_edges=" ~ size(list) });
    });
