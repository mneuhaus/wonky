FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Frozen Boolean Z1: operands share one frame before each Boolean.
export enum AcidVariant
{
    annotation { "Name" : "V0 identity" } V0,
    annotation { "Name" : "V1 translated" } V1,
    annotation { "Name" : "V2 axis permutation" } V2,
    annotation { "Name" : "V3 skew" } V3,
    annotation { "Name" : "V4 radius bump" } V4,
    annotation { "Name" : "V5 alternate idiom" } V5
}

export enum AcidBooleanZ1Zone
{
    annotation { "Name" : "All zones" } ALL,
    AC66, AC74, AC111, AC112, AC113, AC115
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
    const cell = vector(cellX, 3750, 0) * millimeter;
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

// Body variables are never named `box`: Onshape (FS 3044) refuses to compile such a Feature Studio
// (empty featureSpecs, observed 2026-09-28 while freezing onshape-ext/A).
function acidBox(context is Context, id is Id, corners is array) returns Query
{
    fCuboid(context, id, {
        "corner1" : vector(corners[0][0], corners[0][1], corners[0][2]) * millimeter,
        "corner2" : vector(corners[1][0], corners[1][1], corners[1][2]) * millimeter
    });
    return qCreatedBy(id, EntityType.BODY);
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

// V5 idiom: a box built as an extruded sketch rectangle instead of fCuboid.
// corner1/corner2 are local 3D points; the sketch sits on corner1's z plane.
function acidSketchBox(context is Context, id is Id, corner1 is array, corner2 is array) returns Query
{
    var sk = newSketchOnPlane(context, id + "sk", {
        "sketchPlane" : plane(vector(0, 0, corner1[2]) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    skRectangle(sk, "r", {
        "firstCorner" : vector(corner1[0], corner1[1]) * millimeter,
        "secondCorner" : vector(corner2[0], corner2[1]) * millimeter
    });
    skSolve(sk);
    opExtrude(context, id + "ext", {
        "entities" : qSketchRegion(id + "sk", false), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : (corner2[2] - corner1[2]) * millimeter
    });
    return qCreatedBy(id + "ext", EntityType.BODY);
}

// V5 idiom: a z-axis cylinder built as a sketch circle on the local plane z = z0, extruded
// depth along local +z, instead of fCylinder.
function acidSketchCyl(context is Context, id is Id, centre is array, z0 is number, depth is number, radius is number) returns Query
{
    var sk = newSketchOnPlane(context, id + "sk", {
        "sketchPlane" : plane(vector(0, 0, z0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    skCircle(sk, "c", { "center" : vector(centre[0], centre[1]) * millimeter, "radius" : radius * millimeter });
    skSolve(sk);
    opExtrude(context, id + "ext", {
        "entities" : qSketchRegion(id + "sk", false), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : depth * millimeter
    });
    return qCreatedBy(id + "ext", EntityType.BODY);
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

function z1Frame(context is Context, id is Id, bodies is array, column is number, variant is AcidVariant)
{
    opTransform(context, id, { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(250 * column, variant)) });
}
function z1Cut(context is Context, id is Id, target is Query, tool is Query) returns Query
{
    opBoolean(context, id, { "targets" : target, "tools" : tool, "operationType" : BooleanOperationType.SUBTRACTION });
    return acidResult(context, id, [target]);
}
function z1Union(context is Context, id is Id, bodies is array) returns Query
{
    opBoolean(context, id, { "tools" : qUnion(bodies), "operationType" : BooleanOperationType.UNION });
    return acidResult(context, id, bodies);
}
function z1Poly(context is Context, id is Id, pts is array, sketchPlane is Plane, direction is Vector, depth is number) returns Query
{
    var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : sketchPlane });
    for (var i = 0; i < size(pts); i += 1)
        skLineSegment(sk, "e" ~ i, { "start" : vector(pts[i][0], pts[i][1]) * millimeter,
            "end" : vector(pts[(i + 1) % size(pts)][0], pts[(i + 1) % size(pts)][1]) * millimeter });
    skSolve(sk);
    opExtrude(context, id + "ext", { "entities" : qSketchRegion(id + "sk", false), "direction" : direction,
        "endBound" : BoundingType.BLIND, "endDepth" : depth * millimeter });
    return qCreatedBy(id + "ext", EntityType.BODY);
}
function z1Revolve(context is Context, id is Id, pts is array, centre is Vector) returns Query
{
    var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(centre, vector(0, -1, 0), vector(1, 0, 0)) });
    for (var i = 0; i < size(pts); i += 1)
        skLineSegment(sk, "e" ~ i, { "start" : vector(pts[i][0], pts[i][1]) * millimeter,
            "end" : vector(pts[(i + 1) % size(pts)][0], pts[(i + 1) % size(pts)][1]) * millimeter });
    skSolve(sk);
    opRevolve(context, id + "rev", { "entities" : qSketchRegion(id + "sk", false),
        "axis" : line(centre, vector(0, 0, 1)), "angleForward" : 360 * degree });
    return qCreatedBy(id + "rev", EntityType.BODY);
}
function acidAC66(context is Context, id is Id, variant is AcidVariant)
{
    const r = 2 + acidRadiusDelta(variant);
    const base = acidBox(context, id + "base", [[0,0,0],[32,18,10]]);
    const bore = acidCyl(context, id + "bore", [8,9,-1], [8,9,11], r);
    var pocket;
    if (variant == AcidVariant.V5) pocket = acidSketchBox(context, id + "pocket", [20,4,6], [28,14,12]);
    else pocket = acidBox(context, id + "pocket", [[20,4,6],[28,14,12]]);
    z1Frame(context, id + "frame", [base,bore,pocket], 0, variant);
    const drilled = z1Cut(context, id + "drill", base, bore);
    const result = z1Cut(context, id + "cut", drilled, pocket);
    acidLabel(context, result, "AC66", variant);
}
function acidAC74(context is Context, id is Id, variant is AcidVariant)
{
    const r = 2 + acidRadiusDelta(variant);
    const base = acidBox(context, id + "base", [[0,0,0],[32,24,8]]);
    var tool;
    if (variant == AcidVariant.V5)
    {
        const bore = acidCyl(context, id + "bore", [16,12,-1], [16,12,10], r);
        fCone(context, id + "cone", { "bottomCenter" : vector(16,12,6) * millimeter, "topCenter" : vector(16,12,10) * millimeter, "bottomRadius" : r * millimeter, "topRadius" : (r + 4) * millimeter });
        const cone = qCreatedBy(id + "cone", EntityType.BODY);
        z1Frame(context, id + "frame", [base,bore,cone], 1, variant);
        tool = z1Union(context, id + "tool", [bore,cone]);
    }
    else
    {
        tool = z1Revolve(context, id + "tool", [[0,-1],[r,-1],[r,6],[r+2,8],[r+2,10],[0,10]], vector(16,12,0) * millimeter);
        z1Frame(context, id + "frame", [base,tool], 1, variant);
    }
    const result = z1Cut(context, id + "cut", base, tool);
    acidLabel(context, result, "AC74", variant);
}
function acidAC111(context is Context, id is Id, variant is AcidVariant)
{
    const base = acidBox(context, id + "base", [[0,0,0],[20,20,10]]);
    fSphere(context, id + "sphere", { "center" : vector(10,2,10) * millimeter, "radius" : (4 + acidRadiusDelta(variant)) * millimeter });
    const sphere = qCreatedBy(id + "sphere", EntityType.BODY);
    z1Frame(context, id + "frame", [base,sphere], 2, variant);
    acidLabel(context, z1Cut(context, id + "cut", base, sphere), "AC111", variant);
}
function acidAC112(context is Context, id is Id, variant is AcidVariant)
{
    const dr = acidRadiusDelta(variant);
    const a = acidCyl(context, id + "a", [0,0,0], [0,0,10], 5 + dr);
    const b = acidCyl(context, id + "b", [6,0,0], [6,0,10], 4 + dr);
    z1Frame(context, id + "frame", [a,b], 3, variant);
    acidLabel(context, z1Union(context, id + "union", [a,b]), "AC112", variant);
}
function acidAC113(context is Context, id is Id, variant is AcidVariant)
{
    const r = 5 + acidRadiusDelta(variant);
    var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(0,0,0) * millimeter, vector(1,0,0), vector(0,1,0)) });
    skLineSegment(sk, "bottom", { "start" : vector(-r,0) * millimeter, "end" : vector(r,0) * millimeter });
    skLineSegment(sk, "right", { "start" : vector(r,0) * millimeter, "end" : vector(r,6) * millimeter });
    skArc(sk, "roof", { "start" : vector(r,6) * millimeter, "mid" : vector(0,6+r) * millimeter, "end" : vector(-r,6) * millimeter });
    skLineSegment(sk, "left", { "start" : vector(-r,6) * millimeter, "end" : vector(-r,0) * millimeter });
    skSolve(sk);
    opExtrude(context, id + "arch", { "entities" : qSketchRegion(id + "sk", false), "direction" : vector(1,0,0), "endBound" : BoundingType.BLIND, "endDepth" : 30 * millimeter });
    const arch = qCreatedBy(id + "arch", EntityType.BODY);
    const leg = z1Poly(context, id + "leg", [[10,-8],[20,-8],[20,8],[16,8],[16,-4],[10,-4]], plane(vector(0,0,0) * millimeter, vector(0,0,1), vector(1,0,0)), vector(0,0,1), 20);
    z1Frame(context, id + "frame", [arch,leg], 4, variant);
    acidLabel(context, z1Union(context, id + "union", [arch,leg]), "AC113", variant);
}
function acidAC115(context is Context, id is Id, variant is AcidVariant)
{
    const base = acidBox(context, id + "base", [[0,0,0],[20,16,10]]);
    const y = 4 + 1 / 1073741824;
    const bore = acidCyl(context, id + "bore", [10,y,-1], [10,y,11], 4 + acidRadiusDelta(variant));
    z1Frame(context, id + "frame", [base,bore], 5, variant);
    acidLabel(context, z1Cut(context, id + "cut", base, bore), "AC115", variant);
}
annotation { "Feature Type Name" : "CAD Acid: Boolean Z1" }
export const acidBooleanZ1 = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Variant", "Default" : AcidVariant.V0 }
        definition.variant is AcidVariant;
        annotation { "Name" : "Zone", "Default" : AcidBooleanZ1Zone.ALL }
        definition.zone is AcidBooleanZ1Zone;
    }
    {
        const v = definition.variant;
        const z = definition.zone;
        if (v == AcidVariant.V5 && z != AcidBooleanZ1Zone.ALL && z != AcidBooleanZ1Zone.AC66 && z != AcidBooleanZ1Zone.AC74)
            throw regenError("Boolean Z1: requested zone declares no V5");
        if (z == AcidBooleanZ1Zone.ALL || z == AcidBooleanZ1Zone.AC66) acidAC66(context, id + "AC66", v);
        if (z == AcidBooleanZ1Zone.ALL || z == AcidBooleanZ1Zone.AC74) acidAC74(context, id + "AC74", v);
        if (v != AcidVariant.V5)
        {
            if (z == AcidBooleanZ1Zone.ALL || z == AcidBooleanZ1Zone.AC111) acidAC111(context, id + "AC111", v);
            if (z == AcidBooleanZ1Zone.ALL || z == AcidBooleanZ1Zone.AC112) acidAC112(context, id + "AC112", v);
            if (z == AcidBooleanZ1Zone.ALL || z == AcidBooleanZ1Zone.AC113) acidAC113(context, id + "AC113", v);
            if (z == AcidBooleanZ1Zone.ALL || z == AcidBooleanZ1Zone.AC115) acidAC115(context, id + "AC115", v);
        }
    });
