FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// FP21 meet boundaries (docs/fillet-housestyle.md sections 3.2 and 5; record
// fixtures/fillet/fp21-reference.json). Two chamfers on a land narrower than
// 2d meet at a ridge.
// `lever` false: a plate x -15..15, y -10..10, z 0..6 with a through bore R4 at
// (0, 6 - land); EQUAL_OFFSETS chamfer d on the plate's top edge y = 10 and on
// the bore's top rim, so a plane chamfer meets a cone chamfer (a conic ridge).
// `lever` true: KS04 (R20 kernel-cases ks04_cam_lever: disc R7 + bar 40 x 10 +
// tip R5, 6 thick; bore R4.2 with 0.6 rim chamfers; then d on every edge of
// the top and bottom faces) with the bore moved to (0, 2.2 - land), so the
// land between the 0.6 chamfer rim (r 4.8) and the disc edge (r 7) at +Y is
// `land` (KS04 itself: 0.2 at bore y 2).
// Onshape probe parts: (a) plate land 0.3 d 0.42, (b) lever land 0.05 d 0.42.
// `dx` shifts the case along x.

function fpCylinder(context is Context, id is Id, center is Vector, r is number, depth is number) returns Query
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(center * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : r * millimeter });
    skSolve(s);
    opExtrude(context, id + "x", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : depth * millimeter });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    return qCreatedBy(id + "x", EntityType.BODY);
}

function fpOneEdge(context is Context, body is Query, p is Vector) returns Query
{
    const q = qContainsPoint(qOwnedByBody(body, EntityType.EDGE), p * millimeter);
    if (size(evaluateQuery(context, q)) != 1)
        throw regenError("probe harness: no unique edge at " ~ p);
    return q;
}

function fpOneFace(context is Context, body is Query, p is Vector) returns Query
{
    const q = qContainsPoint(qOwnedByBody(body, EntityType.FACE), p * millimeter);
    if (size(evaluateQuery(context, q)) != 1)
        throw regenError("probe harness: no unique face at " ~ p);
    return q;
}

function fpChamfer(context is Context, id is Id, edges is Query, d is ValueWithUnits)
{
    opChamfer(context, id, { "entities" : edges, "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : d, "tangentPropagation" : true });
}

annotation { "Feature Type Name" : "FP21 meet boundaries" }
export const fp21MeetBoundaries = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Land" }
        isLength(definition.land, ZERO_DEFAULT_LENGTH_BOUNDS);
        annotation { "Name" : "Chamfer d" }
        isLength(definition.d, ZERO_DEFAULT_LENGTH_BOUNDS);
        annotation { "Name" : "KS04 lever", "Default" : false }
        definition.lever is boolean;
        annotation { "Name" : "Shift" }
        isLength(definition.dx, ZERO_DEFAULT_LENGTH_BOUNDS);
    }
    {
        const x0 = definition.dx / millimeter;
        const land = definition.land / millimeter;
        var body;
        var edges;
        var label;
        if (!definition.lever)
        {
            fCuboid(context, id + "plate", { "corner1" : vector(x0 - 15, -10, 0) * millimeter, "corner2" : vector(x0 + 15, 10, 6) * millimeter });
            body = qCreatedBy(id + "plate", EntityType.BODY);
            const yb = 6 - land;
            const bore = fpCylinder(context, id + "bore", vector(x0, yb, -0.5), 4, 7);
            opBoolean(context, id + "boreBool", { "targets" : body, "tools" : bore, "operationType" : BooleanOperationType.SUBTRACTION });
            edges = qUnion([fpOneEdge(context, body, vector(x0, 10, 6)), fpOneEdge(context, body, vector(x0, yb + 4, 6))]);
            label = "FP21a plate land " ~ land;
        }
        else
        {
            const yb = 2.2 - land;
            const disc = fpCylinder(context, id + "disc", vector(x0, 0, 0), 7, 6);
            fCuboid(context, id + "bar", { "corner1" : vector(x0, -5, 0) * millimeter, "corner2" : vector(x0 + 40, 5, 6) * millimeter });
            const tip = fpCylinder(context, id + "tip", vector(x0 + 40, 0, 0), 5, 6);
            opBoolean(context, id + "outline", { "tools" : qUnion([disc, qCreatedBy(id + "bar", EntityType.BODY), tip]), "operationType" : BooleanOperationType.UNION });
            body = qUnion([disc, qCreatedBy(id + "bar", EntityType.BODY), tip]);
            if (size(evaluateQuery(context, body)) != 1)
                throw regenError("probe harness: outline is not one body");
            const bore = fpCylinder(context, id + "bore", vector(x0, yb, -0.5), 4.2, 7);
            opBoolean(context, id + "boreBool", { "targets" : body, "tools" : bore, "operationType" : BooleanOperationType.SUBTRACTION });
            fpChamfer(context, id + "boreRims", qUnion([fpOneEdge(context, body, vector(x0, yb + 4.2, 0)), fpOneEdge(context, body, vector(x0, yb + 4.2, 6))]), 0.6 * millimeter);
            const faces = qUnion([fpOneFace(context, body, vector(x0 + 20, 0, 6)), fpOneFace(context, body, vector(x0 + 20, 0, 0))]);
            edges = qAdjacent(faces, AdjacencyType.EDGE, EntityType.EDGE);
            label = "FP21b lever land " ~ land;
        }
        if (size(evaluateQuery(context, body)) != 1)
            throw regenError("probe harness: input is not one body");
        const inputVolume = evVolume(context, { "entities" : body }) / (millimeter ^ 3);
        const selected = size(evaluateQuery(context, edges));
        fpChamfer(context, id + "blend", edges, definition.d);
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.NAME,
            "value" : label ~ " d" ~ (definition.d / millimeter) });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.DESCRIPTION,
            "value" : "input_volume_mm3=" ~ inputVolume ~ "; selected_edges=" ~ selected });
    });
