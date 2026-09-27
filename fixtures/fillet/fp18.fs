FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// FP18 curved-section setback (docs/fillet-housestyle.md section 5; record
// fixtures/fillet/fp18-reference.json). Where a chamfer runs along a line
// edge between a plane and a cylinder, does EQUAL_OFFSETS measure w as a
// chord, an arc or a range on the curved face? Each edge has a constant
// dihedral (the KS01 knife lines, KS05-type edges).
// `dflat` true: a D-flat shaft, cylinder R10 along z (z 0..20) with the flat
// x = 7 (depth 3); EQUAL_OFFSETS chamfer w on both flat edges
// (x 7, y +-sqrt 51; dihedral 134.43 degrees, convex).
// `dflat` false: a block x -15..15, y -10..10, z 0..20 with an R10 groove along
// y whose axis lies at z = 20 + a; EQUAL_OFFSETS chamfer w on the groove's
// line edge at x = +sqrt(100 - a^2), z 20. a = 5: dihedral 120 degrees;
// a = -5: 60 degrees, an acute knife like KS01's 55.23.
// Onshape probe parts: (a) D-flat w 1, (b) groove a 5 w 1, (c) groove a -5 w 1.
// `dx` shifts the case along x.

function fpCylinder(context is Context, id is Id, sketchPlane is Plane, r is number, depth is ValueWithUnits) returns Query
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : sketchPlane });
    skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : r * millimeter });
    skSolve(s);
    opExtrude(context, id + "x", { "entities" : qSketchRegion(id + "s"), "direction" : sketchPlane.normal, "endBound" : BoundingType.BLIND, "endDepth" : depth });
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

annotation { "Feature Type Name" : "FP18 curved-section setback" }
export const fp18CurvedSection = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Chamfer w" }
        isLength(definition.w, ZERO_DEFAULT_LENGTH_BOUNDS);
        annotation { "Name" : "D-flat", "Default" : false }
        definition.dflat is boolean;
        annotation { "Name" : "Groove axis above top a" }
        isLength(definition.a, ZERO_DEFAULT_LENGTH_BOUNDS);
        annotation { "Name" : "Shift" }
        isLength(definition.dx, ZERO_DEFAULT_LENGTH_BOUNDS);
    }
    {
        const x0 = definition.dx / millimeter;
        var body;
        var edges;
        var label;
        if (definition.dflat)
        {
            body = fpCylinder(context, id + "shaft", plane(vector(x0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)), 10, 20 * millimeter);
            fCuboid(context, id + "flat", { "corner1" : vector(x0 + 7, -20, -1) * millimeter, "corner2" : vector(x0 + 20, 20, 21) * millimeter });
            opBoolean(context, id + "flatBool", { "targets" : body, "tools" : qCreatedBy(id + "flat", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
            const h = sqrt(51);
            edges = qUnion([fpOneEdge(context, body, vector(x0 + 7, h, 10)), fpOneEdge(context, body, vector(x0 + 7, -h, 10))]);
            label = "FP18a D-flat";
        }
        else
        {
            const a = definition.a / millimeter;
            fCuboid(context, id + "block", { "corner1" : vector(x0 - 15, -10, 0) * millimeter, "corner2" : vector(x0 + 15, 10, 20) * millimeter });
            body = qCreatedBy(id + "block", EntityType.BODY);
            const groove = fpCylinder(context, id + "groove", plane(vector(x0, -11, 20 + a) * millimeter, vector(0, 1, 0), vector(1, 0, 0)), 10, 22 * millimeter);
            opBoolean(context, id + "grooveBool", { "targets" : body, "tools" : groove, "operationType" : BooleanOperationType.SUBTRACTION });
            edges = fpOneEdge(context, body, vector(x0 + sqrt(100 - a * a), 0, 20));
            label = "FP18 groove a" ~ a;
        }
        if (size(evaluateQuery(context, body)) != 1)
            throw regenError("probe harness: input is not one body");
        const inputVolume = evVolume(context, { "entities" : body }) / (millimeter ^ 3);
        opChamfer(context, id + "blend", { "entities" : edges, "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : definition.w, "tangentPropagation" : true });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.NAME,
            "value" : label ~ " w" ~ (definition.w / millimeter) });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.DESCRIPTION,
            "value" : "input_volume_mm3=" ~ inputVolume });
    });
