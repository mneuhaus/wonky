FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Frozen Fillet ZF1: operands share one frame before each Boolean.
export enum AcidVariant
{
    annotation { "Name" : "V0 identity" } V0,
    annotation { "Name" : "V1 translated" } V1,
    annotation { "Name" : "V2 axis permutation" } V2,
    annotation { "Name" : "V3 skew" } V3,
    annotation { "Name" : "V4 radius bump" } V4,
    annotation { "Name" : "V5 alternate idiom" } V5
}

export enum AcidFilletZF1Zone
{
    annotation { "Name" : "All zones" } ALL,
    AC118, AC119, AC120, AC121, AC122, AC123
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
    const cell = vector(cellX, 4500, 0) * millimeter;
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
function zfPoint(cs is CoordSystem, p is Vector) returns Vector
{
    return toWorld(cs, p * millimeter);
}
function zfEdge(body is Query, cs is CoordSystem, p is Vector) returns Query
{
    return qClosestTo(qOwnedByBody(body, EntityType.EDGE), zfPoint(cs, p));
}
function zfTriangle(context is Context, id is Id) returns Query
{
    return z1Poly(context, id, [[0,0],[24,0],[12,12*sqrt(3)]],
        plane(vector(0,0,0) * millimeter, vector(0,0,1), vector(1,0,0)), vector(0,0,1), 8);
}
function acidAC118(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(0, variant);
    const body = zfTriangle(context, id + "base");
    z1Frame(context, id + "pose", [body], 0, variant);
    opFillet(context, id + "round", { "entities" : zfEdge(body, cs, vector(0,0,4)),
        "radius" : (1 + acidRadiusDelta(variant)) * millimeter });
    opChamfer(context, id + "mitre", { "entities" : zfEdge(body, cs, vector(12,0,8)),
        "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 0.5 * millimeter, "tangentPropagation" : false });
    acidLabel(context, body, "AC118", variant);
}
function acidAC119(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(250, variant);
    const stock = acidCyl(context, id + "stock", [0,0,0], [0,0,8], 10);
    const tool = z1Revolve(context, id + "sink", [[0,-1],[2,-1],[2,6],[4,8],[4,9],[0,9]], vector(0,0,0) * millimeter);
    z1Frame(context, id + "pose", [stock,tool], 1, variant);
    const body = z1Cut(context, id + "cut", stock, tool);
    opChamfer(context, id + "rim", { "entities" : zfEdge(body, cs, vector(4,0,8)),
        "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : (0.5 + acidRadiusDelta(variant)) * millimeter });
    acidLabel(context, body, "AC119", variant);
}
function acidAC120(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(500, variant);
    const R = 6 + acidRadiusDelta(variant);
    var sketch = newSketchOnPlane(context, id + "sk", {
        "sketchPlane" : plane(vector(0,0,0) * millimeter, vector(0,0,1), vector(1,0,0)) });
    skLineSegment(sketch, "chord", { "start" : vector(0,R) * millimeter, "end" : vector(0,-R) * millimeter });
    skArc(sketch, "arc", { "start" : vector(0,-R) * millimeter, "mid" : vector(R,0) * millimeter, "end" : vector(0,R) * millimeter });
    skSolve(sketch);
    opExtrude(context, id + "plate", { "entities" : qSketchRegion(id + "sk", false),
        "direction" : vector(0,0,1), "endBound" : BoundingType.BLIND, "endDepth" : 8 * millimeter });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "sk", EntityType.BODY) });
    const body = qCreatedBy(id + "plate", EntityType.BODY);
    z1Frame(context, id + "pose", [body], 2, variant);
    opFillet(context, id + "junction", { "entities" : zfEdge(body, cs, vector(0,R,4)),
        "radius" : (1 + acidRadiusDelta(variant)) * millimeter });
    acidLabel(context, body, "AC120", variant);
}
function acidAC121(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(750, variant);
    const R = 4 + acidRadiusDelta(variant);
    const stock = acidBox(context, id + "plate", [[-16,-16,0],[16,16,4]]);
    const boss = acidCyl(context, id + "boss", [0,0,4], [0,0,12], R);
    z1Frame(context, id + "pose", [stock,boss], 3, variant);
    const body = z1Union(context, id + "union", [stock,boss]);
    opFillet(context, id + "root", { "entities" : zfEdge(body, cs, vector(R,0,4)),
        "radius" : (1 + acidRadiusDelta(variant)) * millimeter });
    acidLabel(context, body, "AC121", variant);
}
function acidAC122(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(1000, variant);
    const body = zfTriangle(context, id + "base");
    z1Frame(context, id + "pose", [body], 4, variant);
    opFillet(context, id + "corner", { "entities" : qUnion([
        zfEdge(body, cs, vector(0,0,4)), zfEdge(body, cs, vector(12,0,0)), zfEdge(body, cs, vector(6,6*sqrt(3),0))]),
        "radius" : (1 + acidRadiusDelta(variant)) * millimeter });
    acidLabel(context, body, "AC122", variant);
}
function acidAC123(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(1250, variant);
    const r = 1 + acidRadiusDelta(variant);
    const body = acidBox(context, id + "base", [[0,0,0],[32,24,8]]);
    z1Frame(context, id + "pose", [body], 5, variant);
    opFillet(context, id + "corners", { "entities" : qUnion([
        zfEdge(body, cs, vector(0,0,4)), zfEdge(body, cs, vector(32,0,4)),
        zfEdge(body, cs, vector(32,24,4)), zfEdge(body, cs, vector(0,24,4))]), "radius" : r * millimeter });
    const rim = qCoincidesWithPlane(qOwnedByBody(body, EntityType.EDGE),
        plane(zfPoint(cs, vector(0,0,8)), toWorld(cs).linear * vector(0,0,1), toWorld(cs).linear * vector(1,0,0)));
    opChamfer(context, id + "boundary", { "entities" : rim, "chamferType" : ChamferType.EQUAL_OFFSETS,
        "width" : r * millimeter, "tangentPropagation" : true });
    acidLabel(context, body, "AC123", variant);
}
annotation { "Feature Type Name" : "CAD Acid: Fillet ZF1" }
export const acidFilletZF1 = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Variant" }
        definition.variant is AcidVariant;
        annotation { "Name" : "Zone" }
        definition.zone is AcidFilletZF1Zone;
    }
    {
        if (definition.zone == AcidFilletZF1Zone.ALL || definition.zone == AcidFilletZF1Zone.AC118) acidAC118(context, id + "AC118", definition.variant);
        if (definition.zone == AcidFilletZF1Zone.ALL || definition.zone == AcidFilletZF1Zone.AC119) acidAC119(context, id + "AC119", definition.variant);
        if (definition.zone == AcidFilletZF1Zone.ALL || definition.zone == AcidFilletZF1Zone.AC120) acidAC120(context, id + "AC120", definition.variant);
        if (definition.zone == AcidFilletZF1Zone.ALL || definition.zone == AcidFilletZF1Zone.AC121) acidAC121(context, id + "AC121", definition.variant);
        if (definition.zone == AcidFilletZF1Zone.ALL || definition.zone == AcidFilletZF1Zone.AC122) acidAC122(context, id + "AC122", definition.variant);
        if (definition.zone == AcidFilletZF1Zone.ALL || definition.zone == AcidFilletZF1Zone.AC123) acidAC123(context, id + "AC123", definition.variant);
    });
