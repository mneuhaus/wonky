FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// AC101 additive twin override: measured natural cubic fit; existing twin bytes stay frozen.
export enum AcidVariant
{
    annotation { "Name" : "V0 identity" } V0,
    annotation { "Name" : "V1 translated" } V1,
    annotation { "Name" : "V2 axis permutation" } V2,
    annotation { "Name" : "V3 skew" } V3,
    annotation { "Name" : "V4 radius bump" } V4,
    annotation { "Name" : "V5 alternate idiom" } V5
}

export enum AcidSplinesAZone
{
    annotation { "Name" : "All zones" } ALL,
    AC101
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

// F(p) = cellOrigin + Vk(p); V4 and V5 resolve to V0's frame (catalog baseFrame).
function acidFrame(cellX is number, variant is AcidVariant) returns CoordSystem
{
    const cell = vector(cellX, 3500, 0) * millimeter;
    if (variant == AcidVariant.V1)
        return coordSystem(cell + vector(65536.25, -32768.5, 16384.125) * millimeter,
            vector(1, 0, 0), vector(0, 0, 1));
    if (variant == AcidVariant.V2)
        return coordSystem(cell, vector(0, 0, 1), vector(0, -1, 0));
    if (variant == AcidVariant.V3)
    {
        const rotation = rotationAround(line(vector(3, -2, 5) * millimeter, vector(1, 2, 3)), 0.1 * radian);
        return coordSystem(cell + rotation * (vector(0, 0, 0) * millimeter),
            rotation.linear * vector(1, 0, 0), rotation.linear * vector(0, 0, 1));
    }
    return coordSystem(cell, vector(1, 0, 0), vector(0, 0, 1));
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

// AC101: measured OM1 natural cubic fit with D1 normalised centripetal parameters.
function acidFitSide(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(250, variant);
    const points = [vector(30,0)*millimeter,vector(34,5)*millimeter,vector(33,11)*millimeter,vector(28,16)*millimeter,vector(29,22)*millimeter,vector(30,28)*millimeter];
    var definition = { "points" : points };
    if (variant == AcidVariant.V5)
    {
        var cumulative = [0];
        var total = 0;
        for (var i = 1; i < size(points); i += 1)
        {
            const dx = (points[i][0] - points[i-1][0]) / meter;
            const dy = (points[i][1] - points[i-1][1]) / meter;
            total += sqrt(sqrt(dx * dx + dy * dy));
            cumulative = append(cumulative, total);
        }
        var parameters = [];
        for (var value in cumulative)
            parameters = append(parameters, value / total);
        definition["parameters"] = parameters;
    }
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : plane(cs.origin, cs.zAxis, cs.xAxis) });
    skLineSegment(sketch,"bottom", { "start" : vector(0,0)*millimeter, "end" : points[0] });
    skFitSpline(sketch,"side",definition);
    skLineSegment(sketch,"top", { "start" : points[5], "end" : vector(0,28)*millimeter });
    skLineSegment(sketch,"left", { "start" : vector(0,28)*millimeter, "end" : vector(0,0)*millimeter });
    skSolve(sketch);
    opExtrude(context,id + "prism", { "entities" : qSketchRegion(sketchId,false), "direction" : cs.zAxis,
        "endBound" : BoundingType.BLIND, "endDepth" : 5*millimeter });
    acidLabel(context,qBodyType(qCreatedBy(id + "prism",EntityType.BODY),BodyType.SOLID),"AC101",variant);
}

// Declared variants per zone (catalog zone.variants): zone = ALL skips a zone without the
// variant; an explicit request for an undeclared cell is an error, never a silent V0 build.
function acidDeclares(zone is AcidSplinesAZone, variant is AcidVariant) returns boolean
{
    if (variant == AcidVariant.V4)
        return false;
    return true;
}

function acidRun(requested is AcidSplinesAZone, zone is AcidSplinesAZone, variant is AcidVariant) returns boolean
{
    if (requested != AcidSplinesAZone.ALL && requested != zone)
        return false;
    if (!acidDeclares(zone, variant))
    {
        if (requested == zone)
            throw regenError("CAD-Acid splines-a: " ~ toString(zone) ~ " declares no " ~ acidVariantName(variant));
        return false;
    }
    return true;
}

annotation { "Feature Type Name" : "CAD Acid: Splines A" }
export const acidSplinesA = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Variant", "Default" : AcidVariant.V0 }
        definition.variant is AcidVariant;
        annotation { "Name" : "Zone", "Default" : AcidSplinesAZone.ALL }
        definition.zone is AcidSplinesAZone;
    }
    {
        const variant = definition.variant;
        const zone = definition.zone;
        if (acidRun(zone, AcidSplinesAZone.AC101, variant))
            acidFitSide(context, id + "AC101", variant);
    });
