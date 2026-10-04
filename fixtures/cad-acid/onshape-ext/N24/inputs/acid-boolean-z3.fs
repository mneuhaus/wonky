FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Frozen Boolean Z3: operands share one frame before each Boolean.
export enum AcidVariant
{
    annotation { "Name" : "V0 identity" } V0,
    annotation { "Name" : "V1 translated" } V1,
    annotation { "Name" : "V2 axis permutation" } V2,
    annotation { "Name" : "V3 skew" } V3,
    annotation { "Name" : "V4 radius bump" } V4,
    annotation { "Name" : "V5 alternate idiom" } V5
}

export enum AcidBooleanZ3Zone
{
    annotation { "Name" : "All zones" } ALL,
    AC106, AC107, AC108
}

function acidVariantName(variant is AcidVariant) returns string
{
    if (variant == AcidVariant.V1) return "V1";
    if (variant == AcidVariant.V2) return "V2";
    if (variant == AcidVariant.V3) return "V3";
    if (variant == AcidVariant.V4) return "V4";
    if (variant == AcidVariant.V5) return "V5";
    return "V0";
}

// V4 and V5 carry no frame of their own (radius bump / alternate idiom only):
// both resolve to the identity V0 frame, mirroring catalog.variants[v].baseFrame.
function acidFrame(cellX is number, variant is AcidVariant) returns CoordSystem
{
    const cell = vector(cellX, 4000, 0) * millimeter;
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

// V4's only geometric effect: +0.025 mm on every circular feature's radius.
function acidRadiusDelta(variant is AcidVariant) returns number
{
    if (variant == AcidVariant.V4) return 0.025;
    return 0;
}

// General cylinder between two local points (covers Z-axis and X-axis bores alike).
function acidCyl(context is Context, id is Id, p0 is array, p1 is array, radius is number) returns Query
{
    fCylinder(context, id, {
        "bottomCenter" : vector(p0[0], p0[1], p0[2]) * millimeter,
        "topCenter" : vector(p1[0], p1[1], p1[2]) * millimeter,
        "radius" : radius * millimeter
    });
    return qCreatedBy(id, EntityType.BODY);
}

function acidResult(context is Context, operationId is Id, inputs is array) returns Query
{
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

function z3Frame(context is Context, id is Id, bodies is array, column is number, variant is AcidVariant)
{
    opTransform(context, id, { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(250 * column, variant)) });
}
function z3Cut(context is Context, id is Id, target is Query, tool is Query) returns Query
{
    opBoolean(context, id, { "targets" : target, "tools" : tool, "operationType" : BooleanOperationType.SUBTRACTION });
    return acidResult(context, id, [target]);
}
function z3Union(context is Context, id is Id, bodies is array) returns Query
{
    opBoolean(context, id, { "tools" : qUnion(bodies), "operationType" : BooleanOperationType.UNION });
    return acidResult(context, id, bodies);
}
function acidAC106(context is Context, id is Id, variant is AcidVariant)
{
    const dr = acidRadiusDelta(variant);
    const shaft = acidCyl(context, id + "shaft", [0,0,-20], [0,0,20], 5 + dr);
    const bore = acidCyl(context, id + "bore", [-10,0,0], [10,0,0], 2 + dr);
    z3Frame(context, id + "frame", [shaft,bore], 0, variant);
    acidLabel(context, z3Cut(context, id + "cut", shaft, bore), "AC106", variant);
}
function acidAC107(context is Context, id is Id, variant is AcidVariant)
{
    const r = 4 + acidRadiusDelta(variant);
    const post = acidCyl(context, id + "post", [0,0,-12], [0,0,12], r);
    const branch = acidCyl(context, id + "branch", [0,0,0], [16,0,0], r);
    z3Frame(context, id + "frame", [post,branch], 1, variant);
    acidLabel(context, z3Union(context, id + "union", [post,branch]), "AC107", variant);
}
function acidAC108(context is Context, id is Id, variant is AcidVariant)
{
    const dr = acidRadiusDelta(variant);
    const shaft = acidCyl(context, id + "shaft", [0,0,-20], [0,0,20], 5 + dr);
    const bore = acidCyl(context, id + "bore", [-10,2,0], [10,2,0], 2 + dr);
    z3Frame(context, id + "frame", [shaft,bore], 2, variant);
    acidLabel(context, z3Cut(context, id + "cut", shaft, bore), "AC108", variant);
}
annotation { "Feature Type Name" : "CAD Acid: Boolean Z3" }
export const acidBooleanZ3 = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Variant", "Default" : AcidVariant.V0 }
        definition.variant is AcidVariant;
        annotation { "Name" : "Zone", "Default" : AcidBooleanZ3Zone.ALL }
        definition.zone is AcidBooleanZ3Zone;
    }
    {
        const v = definition.variant;
        const z = definition.zone;
        if (v == AcidVariant.V5) throw regenError("Boolean Z3: no alternate sketch idiom declared");
        if (z == AcidBooleanZ3Zone.ALL || z == AcidBooleanZ3Zone.AC106) acidAC106(context, id + "AC106", v);
        if (z == AcidBooleanZ3Zone.ALL || z == AcidBooleanZ3Zone.AC107) acidAC107(context, id + "AC107", v);
        if (z == AcidBooleanZ3Zone.ALL || z == AcidBooleanZ3Zone.AC108) acidAC108(context, id + "AC108", v);
    });
