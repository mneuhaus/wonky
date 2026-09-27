FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// AC10-AC18, AC49. Each zone starts with local primitives; a single shared
// transform places its operands in the chosen coordinate system BEFORE Boolean.
export enum AcidVariant
{
    annotation { "Name" : "V0 identity" } V0,
    annotation { "Name" : "V1 translated" } V1,
    annotation { "Name" : "V2 axis permutation" } V2,
    annotation { "Name" : "V3 skew" } V3
}

// The per-zone selector permits an empty or refusing Boolean to be measured
// without aborting the remaining, independent zones. ALL builds the atlas.
export enum AcidBooleanZone
{
    annotation { "Name" : "All zones" } ALL,
    AC10, AC11, AC12, AC13, AC14, AC15, AC16, AC17, AC18, AC49
}

function acidVariantName(variant is AcidVariant) returns string
{
    if (variant == AcidVariant.V1) return "V1";
    if (variant == AcidVariant.V2) return "V2";
    if (variant == AcidVariant.V3) return "V3";
    return "V0";
}

function acidFrame(cellX is number, variant is AcidVariant) returns CoordSystem
{
    const cell = vector(cellX, 250, 0) * millimeter;
    if (variant == AcidVariant.V1)
        return coordSystem(cell + vector(65536.25, -32768.5, 16384.125) * millimeter,
            vector(1, 0, 0), vector(0, 0, 1));
    if (variant == AcidVariant.V2)
        return coordSystem(cell, vector(0, 0, 1), vector(0, -1, 0));
    if (variant == AcidVariant.V3)
    {
        const rotation = rotationAround(line(vector(3, -2, 5) * millimeter, vector(1, 2, 3)), 0.1 * radian);
        const zero = rotation * (vector(0, 0, 0) * millimeter);
        const xAxis = rotation.linear * vector(1, 0, 0);
        const zAxis = rotation.linear * vector(0, 0, 1);
        return coordSystem(cell + zero, xAxis, zAxis);
    }
    return coordSystem(cell, vector(1, 0, 0), vector(0, 0, 1));
}

function acidBox(context is Context, id is Id, corners is array) returns Query
{
    fCuboid(context, id, {
        "corner1" : vector(corners[0][0], corners[0][1], corners[0][2]) * millimeter,
        "corner2" : vector(corners[1][0], corners[1][1], corners[1][2]) * millimeter
    });
    return qCreatedBy(id, EntityType.BODY);
}

function acidCylinder(context is Context, id is Id, x is number, y is number, z0 is number,
                       z1 is number, radius is number) returns Query
{
    fCylinder(context, id, {
        "bottomCenter" : vector(x, y, z0) * millimeter,
        "topCenter" : vector(x, y, z1) * millimeter,
        "radius" : radius * millimeter
    });
    return qCreatedBy(id, EntityType.BODY);
}

function acidResult(context is Context, operationId is Id, inputs is array) returns Query
{
    // A modifying Boolean may retain the target identity or create new bodies.
    // Deleted operands evaluate to empty; the union therefore catches both.
    return qBodyType(qUnion([qUnion(inputs), qCreatedBy(operationId, EntityType.BODY)]), BodyType.SOLID);
}

function acidLabel(context is Context, result is Query, zone is string, variant is AcidVariant)
{
    const parts = evaluateQuery(context, result);
    for (var i = 0; i < size(parts); i += 1)
    {
        setProperty(context, { "entities" : parts[i], "propertyType" : PropertyType.NAME,
            "value" : zone ~ "_" ~ toString(i) ~ "_" ~ acidVariantName(variant) });
        setProperty(context, { "entities" : parts[i], "propertyType" : PropertyType.DESCRIPTION,
            "value" : "acid=" ~ zone ~ "@" ~ acidVariantName(variant) });
    }
}

function acidBoxes(context is Context, id is Id, zone is string, variant is AcidVariant,
                   cellX is number, boxes is array, operation is BooleanOperationType)
{
    const cs = acidFrame(cellX, variant);
    var bodies = [];
    for (var i = 0; i < size(boxes); i += 1)
        bodies = append(bodies, acidBox(context, id + ("box" ~ toString(i)), boxes[i]));
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(cs) });
    if (operation == BooleanOperationType.SUBTRACTION)
        opBoolean(context, id + "boolean", { "targets" : bodies[0],
            "tools" : bodies[1], "operationType" : operation });
    else
        opBoolean(context, id + "boolean", { "tools" : qUnion(bodies), "operationType" : operation });
    acidLabel(context, acidResult(context, id + "boolean", bodies), zone, variant);
}

function acidPlateHoles(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(2000, variant);
    const plate = acidBox(context, id + "plate", [[0, 0, 0], [32, 32, 4]]);
    var tools = [];
    const centers = [[8, 8], [24, 8], [8, 24], [24, 24]];
    for (var i = 0; i < size(centers); i += 1)
        tools = append(tools, acidCylinder(context, id + ("hole" ~ toString(i)),
            centers[i][0], centers[i][1], -2, 6, 2));
    const inputs = concatenateArrays([plate], tools);
    opTransform(context, id + "frame", { "bodies" : qUnion(inputs), "transform" : toWorld(cs) });
    opBoolean(context, id + "boolean", { "targets" : plate, "tools" : qUnion(tools),
        "operationType" : BooleanOperationType.SUBTRACTION });
    acidLabel(context, acidResult(context, id + "boolean", inputs), "AC18", variant);
}

function acidChamferedPlate(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(2250, variant);
    const plate = acidBox(context, id + "plate", [[0, 0, 0], [16, 12, 8]]);
    const hole = acidCylinder(context, id + "hole", 8, 6, -1, 9, 2);
    const inputs = [plate, hole];
    opTransform(context, id + "frame", { "bodies" : qUnion(inputs), "transform" : toWorld(cs) });
    opBoolean(context, id + "boolean", { "targets" : plate, "tools" : hole,
        "operationType" : BooleanOperationType.SUBTRACTION });
    const body = acidResult(context, id + "boolean", inputs);
    const top = qCoincidesWithPlane(qOwnedByBody(body, EntityType.FACE),
        plane(toWorld(cs, vector(0, 0, 8) * millimeter), cs.zAxis));
    const rim = qAdjacent(top, AdjacencyType.EDGE, EntityType.EDGE);
    const lines = qParallelEdges(qGeometry(rim, GeometryType.LINE), cs.xAxis);
    const circles = qGeometry(rim, GeometryType.CIRCLE);
    opChamfer(context, id + "chamfer", { "entities" : qUnion([lines, circles]),
        "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 1 * millimeter });
    acidLabel(context, qBodyType(qUnion([body, qCreatedBy(id + "chamfer", EntityType.BODY)]), BodyType.SOLID),
        "AC49", variant);
}

annotation { "Feature Type Name" : "CAD Acid: Planar Booleans" }
export const acidBoolean = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Variant", "Default" : AcidVariant.V0 }
        definition.variant is AcidVariant;
        annotation { "Name" : "Zone", "Default" : AcidBooleanZone.ALL }
        definition.zone is AcidBooleanZone;
    }
    {
        const variant = definition.variant;
        const zone = definition.zone;
        if (zone == AcidBooleanZone.ALL || zone == AcidBooleanZone.AC10)
            acidBoxes(context, id + "AC10", "AC10", variant, 0,
                [[[0, 0, 0], [8, 8, 8]], [[4, 4, 4], [12, 12, 12]]], BooleanOperationType.UNION);
        if (zone == AcidBooleanZone.ALL || zone == AcidBooleanZone.AC11)
            acidBoxes(context, id + "AC11", "AC11", variant, 250,
                [[[0, 0, 0], [8, 8, 8]], [[8, 0, 0], [16, 8, 8]]], BooleanOperationType.UNION);
        if (zone == AcidBooleanZone.ALL || zone == AcidBooleanZone.AC12)
            acidBoxes(context, id + "AC12", "AC12", variant, 500,
                [[[0, 0, 0], [8, 8, 8]], [[8, 8, 0], [16, 16, 8]], [[8, -8, 8], [16, 0, 16]]],
                BooleanOperationType.UNION);
        if (zone == AcidBooleanZone.ALL || zone == AcidBooleanZone.AC13)
            acidBoxes(context, id + "AC13", "AC13", variant, 750,
                [[[0, 0, 0], [8, 8, 8]], [[8, 0, 0], [16, 8, 8]]], BooleanOperationType.INTERSECTION);
        if (zone == AcidBooleanZone.ALL || zone == AcidBooleanZone.AC14)
            acidBoxes(context, id + "AC14", "AC14", variant, 1000,
                [[[0, 0, 0], [16, 8, 8]], [[4, 0, 4], [12, 8, 8]]], BooleanOperationType.SUBTRACTION);
        if (zone == AcidBooleanZone.ALL || zone == AcidBooleanZone.AC15)
            acidBoxes(context, id + "AC15", "AC15", variant, 1250,
                [[[0, 0, 0], [8, 8, 8]], [[0, 0, 0], [8, 8, 8]]], BooleanOperationType.SUBTRACTION);
        if (zone == AcidBooleanZone.ALL || zone == AcidBooleanZone.AC16)
            acidBoxes(context, id + "AC16", "AC16", variant, 1500,
                [[[0, 0, 0], [8, 8, 8]], [[0, 0, 0], [8, 8, 8]]], BooleanOperationType.UNION);
        if (zone == AcidBooleanZone.ALL || zone == AcidBooleanZone.AC17)
            acidBoxes(context, id + "AC17", "AC17", variant, 1750,
                [[[0, 0, 0], [16, 16, 16]], [[4, 4, 4], [12, 12, 12]]], BooleanOperationType.SUBTRACTION);
        if (zone == AcidBooleanZone.ALL || zone == AcidBooleanZone.AC18)
            acidPlateHoles(context, id + "AC18", variant);
        if (zone == AcidBooleanZone.ALL || zone == AcidBooleanZone.AC49)
            acidChamferedPlate(context, id + "AC49", variant);
    });
