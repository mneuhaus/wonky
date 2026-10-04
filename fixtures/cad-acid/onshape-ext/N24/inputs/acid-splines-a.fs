FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// CAD-Acid splines-a group: AC100 and AC102 (planned AC100-AC104). Row 14 (y = 3500 mm), columns by the planned
// membership (AC100 0, AC102 2). AC100 keeps the sketch frame of acid-shapes-a.fs AC96: the sketch lies on plane(cs),
// extruded along cs.zAxis. AC102 keeps the primitive+transform frame of acid-holes-a.fs: the gear, hub and bore tool
// are built in local coordinates, then ONE opTransform(toWorld(cs)) moves all three before the Booleans, so every
// contact is decided in the construction frame. skBezier points are control points (degree = points - 1).
// V4 (radius +0.025 mm on every circular feature: AC102's hub and bore) and V5 (alternate idiom, same nominal
// geometry) use V0's frame.
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
    AC100, AC102
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

// V4's only geometric effect: +0.025 mm on every circular feature's radius.
function acidRadiusDelta(variant is AcidVariant) returns number
{
    if (variant == AcidVariant.V4) return 0.025;
    return 0;
}

function acidCyl(context is Context, id is Id, p0 is array, p1 is array, radius is number) returns Query
{
    fCylinder(context, id, {
        "bottomCenter" : vector(p0[0], p0[1], p0[2]) * millimeter,
        "topCenter" : vector(p1[0], p1[1], p1[2]) * millimeter,
        "radius" : radius * millimeter
    });
    return qCreatedBy(id, EntityType.BODY);
}

// V0 idiom for a local z-cylinder: skCircle centre (0,0) on the local plane z = z0, extruded `height` along +z.
function acidExtrudedCircle(context is Context, id is Id, z0 is number, radius is number, height is number) returns Query
{
    var sketch = newSketchOnPlane(context, id + "sketch", {
        "sketchPlane" : plane(vector(0, 0, z0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    skCircle(sketch, "circle", { "center" : vector(0, 0) * millimeter, "radius" : radius * millimeter });
    skSolve(sketch);
    opExtrude(context, id + "extrude", {
        "entities" : qSketchRegion(id + "sketch", false), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : height * millimeter
    });
    return qCreatedBy(id + "extrude", EntityType.BODY);
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

// AC100: an arch of one skBezier with the control points (0,0), (8,6), (18,6), (26,0) closed by the chord
// (26,0)-(0,0), sketched on plane(cs) and extruded 4 along cs.zAxis. V5: the same curve as its exact degree-4
// elevation (0,0), (6,4.5), (13,6), (20,4.5), (26,0).
function acidBezierArch(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(0, variant);
    var points = [[0, 0], [8, 6], [18, 6], [26, 0]];
    if (variant == AcidVariant.V5)
        points = [[0, 0], [6, 4.5], [13, 6], [20, 4.5], [26, 0]];
    var controls = [];
    for (var i = 0; i < size(points); i += 1)
        controls = append(controls, vector(points[i][0], points[i][1]) * millimeter);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : plane(cs.origin, cs.zAxis, cs.xAxis) });
    skBezier(sketch, "arch", { "points" : controls });
    skLineSegment(sketch, "chord", { "start" : vector(26, 0) * millimeter, "end" : vector(0, 0) * millimeter });
    skSolve(sketch);
    opExtrude(context, id + "prism", { "entities" : qSketchRegion(sketchId, false), "direction" : cs.zAxis,
        "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
    acidLabel(context, qBodyType(qCreatedBy(id + "prism", EntityType.BODY), BodyType.SOLID), "AC100", variant);
}

// AC102: a 16-tooth spur gear, module 1.5, pressure angle 20 deg, addendum 1 and dedendum 1.25 modules, tooth 0
// centred on local +x. Per tooth and side s (+1 upper, -1 lower) the flank is one cubic skBezier from the base point B
// to the tip point T of the involute, with handles 0.0625 and 0.625 of the chord along the involute's end tangents
// (radial at the base). The outline, per tooth: radial line root foot -> B (lower), lower flank, three-point tip arc,
// upper flank, radial line B -> root foot (upper), three-point root arc to the next tooth's lower foot; every shared
// point is the same computed value. One sketch on the local plane z = 0, extruded 6. V0: the hub as skCircle r 6 on
// the local plane z = 6 extruded 6, the bore tool as skCircle r 2.5 on z = 0 extruded 12 (flush with the gear bottom
// and the hub top: 2 fl(0.006) = fl(0.012) m exactly). V5: both as fCylinder, the bore with 1 mm overshoot.
// V4: hub 6.025, bore 2.525. One opTransform(toWorld(cs)) on all three bodies, then UNION and SUBTRACTION.
function acidSpurGear(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(500, variant);
    const dr = acidRadiusDelta(variant);
    const m = 1.5;
    const z = 16;
    const alpha = 20 * degree;
    const rp = m * z / 2;
    const rb = rp * cos(alpha);
    const ra = rp + m;
    const rf = rp - 1.25 * m;
    const psib = PI / (2 * z) + tan(alpha) - alpha / radian;
    const ta = sqrt(ra * ra / (rb * rb) - 1);
    const psia = psib - (ta - atan(ta) / radian);
    const pitch = 2 * PI / z;
    var teeth = [];
    for (var k = 0; k < z; k += 1)
    {
        const th = k * pitch;
        var tooth = {
            "tipMid" : vector(ra * cos(th * radian), ra * sin(th * radian)) * millimeter,
            "rootMid" : vector(rf * cos((th + pitch / 2) * radian), rf * sin((th + pitch / 2) * radian)) * millimeter
        };
        for (var s = -1; s <= 1; s += 2)
        {
            const a0 = th + s * psib;
            const a3 = th + s * psia;
            const a1 = a0 - s * ta;
            const c0 = cos(a0 * radian);
            const s0 = sin(a0 * radian);
            const B = [rb * c0, rb * s0];
            const T = [ra * cos(a3 * radian), ra * sin(a3 * radian)];
            const dx = T[0] - B[0];
            const dy = T[1] - B[1];
            const chord = sqrt(dx * dx + dy * dy);
            const c1 = cos(a1 * radian);
            const s1 = sin(a1 * radian);
            const flank = {
                "foot" : vector(rf * c0, rf * s0) * millimeter,
                "poles" : [vector(B[0], B[1]) * millimeter,
                    vector(B[0] + 0.0625 * chord * c0, B[1] + 0.0625 * chord * s0) * millimeter,
                    vector(T[0] - 0.625 * chord * c1, T[1] - 0.625 * chord * s1) * millimeter,
                    vector(T[0], T[1]) * millimeter]
            };
            if (s < 0)
                tooth["lower"] = flank;
            else
                tooth["upper"] = flank;
        }
        teeth = append(teeth, tooth);
    }
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    for (var k = 0; k < z; k += 1)
    {
        const tooth = teeth[k];
        const next = teeth[(k + 1) % z];
        skLineSegment(sketch, "radialLower" ~ k, { "start" : tooth["lower"]["foot"], "end" : tooth["lower"]["poles"][0] });
        skBezier(sketch, "flankLower" ~ k, { "points" : tooth["lower"]["poles"] });
        skArc(sketch, "tip" ~ k, { "start" : tooth["lower"]["poles"][3], "mid" : tooth["tipMid"], "end" : tooth["upper"]["poles"][3] });
        skBezier(sketch, "flankUpper" ~ k, { "points" : tooth["upper"]["poles"] });
        skLineSegment(sketch, "radialUpper" ~ k, { "start" : tooth["upper"]["poles"][0], "end" : tooth["upper"]["foot"] });
        skArc(sketch, "root" ~ k, { "start" : tooth["upper"]["foot"], "mid" : tooth["rootMid"], "end" : next["lower"]["foot"] });
    }
    skSolve(sketch);
    opExtrude(context, id + "gear", { "entities" : qSketchRegion(sketchId, false), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
    const gear = qCreatedBy(id + "gear", EntityType.BODY);
    var hub;
    var bore;
    if (variant == AcidVariant.V5)
    {
        hub = acidCyl(context, id + "hub", [0, 0, 6], [0, 0, 12], 6 + dr);
        bore = acidCyl(context, id + "bore", [0, 0, -1], [0, 0, 13], 2.5 + dr);
    }
    else
    {
        hub = acidExtrudedCircle(context, id + "hub", 6, 6 + dr, 6);
        bore = acidExtrudedCircle(context, id + "bore", 0, 2.5 + dr, 12);
    }
    const bodies = [gear, hub, bore];
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(cs) });
    opBoolean(context, id + "union", { "tools" : qUnion([gear, hub]), "operationType" : BooleanOperationType.UNION });
    opBoolean(context, id + "cut", { "targets" : acidResult(context, id + "union", [gear, hub]), "tools" : bore,
        "operationType" : BooleanOperationType.SUBTRACTION });
    acidLabel(context, acidResult(context, id + "cut", bodies), "AC102", variant);
}

// Declared variants per zone (catalog zone.variants): zone = ALL skips a zone without the
// variant; an explicit request for an undeclared cell is an error, never a silent V0 build.
function acidDeclares(zone is AcidSplinesAZone, variant is AcidVariant) returns boolean
{
    if (variant == AcidVariant.V4)
        return zone == AcidSplinesAZone.AC102;
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
        if (acidRun(zone, AcidSplinesAZone.AC100, variant))
            acidBezierArch(context, id + "AC100", variant);
        if (acidRun(zone, AcidSplinesAZone.AC102, variant))
            acidSpurGear(context, id + "AC102", variant);
    });
