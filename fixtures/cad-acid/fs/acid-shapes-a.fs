FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// CAD-Acid Batch A, shapes-a group: AC60, AC96, AC72, AC77, AC81, AC84, AC89. Row 9 (y = 2250 mm).
// AC60 keeps the primitive+transform frame of acid-holes-a.fs: local operands first, then ONE
// opTransform(toWorld(cs)) on all operands, then the Boolean. AC96 keeps the sketch frame of
// acid-regions-a.fs: the sketch lies on plane(cs), extruded along cs.zAxis. AC72 sketches on the
// local XZ plane of cs (as acid-profile.fs AC04) and revolves about the local Z axis. AC77, AC81, AC84 and
// AC89 keep the primitive+transform frame of acid-blend.fs: local operands, ONE opTransform(toWorld(cs)),
// the Boolean if any, then opFillet/opShell on entities picked with qClosestTo(..., toWorld(cs, p)).
// V4 (radius +0.025 mm on every circular feature, never on a fillet radius) and V5 (alternate idiom,
// same nominal geometry) use V0's frame.
export enum AcidVariant
{
    annotation { "Name" : "V0 identity" } V0,
    annotation { "Name" : "V1 translated" } V1,
    annotation { "Name" : "V2 axis permutation" } V2,
    annotation { "Name" : "V3 skew" } V3,
    annotation { "Name" : "V4 radius bump" } V4,
    annotation { "Name" : "V5 alternate idiom" } V5
}

export enum AcidShapesAZone
{
    annotation { "Name" : "All zones" } ALL,
    AC60, AC96, AC72, AC77, AC81, AC84, AC89
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
    const cell = vector(cellX, 2250, 0) * millimeter;
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

// V5 idiom: a box built as an extruded sketch rectangle on the local plane z = corner1[2].
function acidSketchBox(context is Context, id is Id, corners is array) returns Query
{
    var sk = newSketchOnPlane(context, id + "sk", {
        "sketchPlane" : plane(vector(0, 0, corners[0][2]) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    skRectangle(sk, "r", {
        "firstCorner" : vector(corners[0][0], corners[0][1]) * millimeter,
        "secondCorner" : vector(corners[1][0], corners[1][1]) * millimeter
    });
    skSolve(sk);
    opExtrude(context, id + "ext", {
        "entities" : qSketchRegion(id + "sk", false), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : (corners[1][2] - corners[0][2]) * millimeter
    });
    return qCreatedBy(id + "ext", EntityType.BODY);
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

// AC60: plate 40x30x5 minus four fCylinder r 2 at (6,6), (34,6), (6,24), (34,24) from z -1 to 6,
// one subtraction. V5: the plate as an extruded sketch rectangle instead of fCuboid.
function acidFourHolePlate(context is Context, id is Id, variant is AcidVariant)
{
    const r = 2 + acidRadiusDelta(variant);
    const centres = [[6, 6], [34, 6], [6, 24], [34, 24]];
    var plate;
    if (variant == AcidVariant.V5)
        plate = acidSketchBox(context, id + "plate", [[0, 0, 0], [40, 30, 5]]);
    else
        plate = acidBox(context, id + "plate", [[0, 0, 0], [40, 30, 5]]);
    var tools = [];
    for (var i = 0; i < size(centres); i += 1)
        tools = append(tools, acidCyl(context, id + ("bore" ~ i), [centres[i][0], centres[i][1], -1], [centres[i][0], centres[i][1], 6], r));
    const bodies = concatenateArrays([[plate], tools]);
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(0, variant)) });
    opBoolean(context, id + "cut", { "targets" : plate, "tools" : qUnion(tools), "operationType" : BooleanOperationType.SUBTRACTION });
    acidLabel(context, acidResult(context, id + "cut", bodies), "AC60", variant);
}

// AC96: a 24-corner star, radius 10 at even and 8 at odd index, 15 deg apart, closed over the
// first corner, sketched on plane(cs) and extruded 4. V0: x = r cos, y = r sin. V5: each corner
// as rotationMatrix3d(Z, k * 15 deg) * (r, 0, 0).
function acidStarPrism(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(250, variant);
    var star = [];
    for (var i = 0; i < 24; i += 1)
    {
        const rr = (i % 2 == 0) ? 10 : 8;
        if (variant == AcidVariant.V5)
        {
            const p = rotationMatrix3d(vector(0, 0, 1), i * 15 * degree) * vector(rr, 0, 0);
            star = append(star, vector(p[0], p[1]) * millimeter);
        }
        else
            star = append(star, vector(rr * cos(i * 15 * degree), rr * sin(i * 15 * degree)) * millimeter);
    }
    star = append(star, star[0]);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : plane(cs.origin, cs.zAxis, cs.xAxis) });
    skPolyline(sketch, "star", { "points" : star });
    skSolve(sketch);
    opExtrude(context, id + "gear", { "entities" : qSketchRegion(sketchId, false), "direction" : cs.zAxis,
        "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
    acidLabel(context, qBodyType(qCreatedBy(id + "gear", EntityType.BODY), BodyType.SOLID), "AC96", variant);
}

// AC72: the stepped profile (r,z) (0,0),(8,0),(8,6),(5,6),(5,18),(0,18) on the local XZ plane
// (sketch (u,v) = local (u,0,v)), revolved 360 deg about the local Z axis. V0-V4: plane and axis
// from the zone coordSystem. V5: both declared freely from literal vectors (V0 frame). V4: radii
// 8.025 and 5.025.
function acidStepRevolve(context is Context, id is Id, variant is AcidVariant)
{
    const dr = acidRadiusDelta(variant);
    const r1 = 8 + dr;
    const r2 = 5 + dr;
    var sketchPlane;
    var axis;
    if (variant == AcidVariant.V5)
    {
        sketchPlane = plane(vector(500, 2250, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0));
        axis = line(vector(500, 2250, 0) * millimeter, vector(0, 0, 1));
    }
    else
    {
        const cs = acidFrame(500, variant);
        // Normal -Y and x axis +X give sketch y axis +Z (local XZ plane).
        sketchPlane = plane(cs.origin, -cross(cs.zAxis, cs.xAxis), cs.xAxis);
        axis = line(cs.origin, cs.zAxis);
    }
    const sketchId = id + "profile";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : sketchPlane });
    skPolyline(sketch, "profile", { "points" : [vector(0, 0) * millimeter, vector(r1, 0) * millimeter, vector(r1, 6) * millimeter,
        vector(r2, 6) * millimeter, vector(r2, 18) * millimeter, vector(0, 18) * millimeter, vector(0, 0) * millimeter] });
    skSolve(sketch);
    opRevolve(context, id + "revolve", { "entities" : qSketchRegion(sketchId, false), "axis" : axis, "angleForward" : 360 * degree });
    acidLabel(context, qBodyType(qCreatedBy(id + "revolve", EntityType.BODY), BodyType.SOLID), "AC72", variant);
}

// AC77: foot fCuboid (0,0,0)-(24,16,6) and upright (0,0,6)-(6,16,22), one opTransform, the union, then
// opFillet r 2 on the concave seam edge through local (6,8,6). V5: the L profile (0,0),(24,0),(24,6),
// (6,6),(6,22),(0,22) on the local XZ plane (normal -y, sketch (u,v) = local (u,0,v)) extruded 16 along
// local +y instead of the union; the same opTransform and fillet.
function acidSeamFillet(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(750, variant);
    var body;
    if (variant == AcidVariant.V5)
    {
        var sk = newSketchOnPlane(context, id + "sk", {
            "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0))
        });
        skPolyline(sk, "profile", { "points" : [vector(0, 0) * millimeter, vector(24, 0) * millimeter, vector(24, 6) * millimeter,
            vector(6, 6) * millimeter, vector(6, 22) * millimeter, vector(0, 22) * millimeter, vector(0, 0) * millimeter] });
        skSolve(sk);
        opExtrude(context, id + "L", {
            "entities" : qSketchRegion(id + "sk", false), "direction" : vector(0, 1, 0),
            "endBound" : BoundingType.BLIND, "endDepth" : 16 * millimeter
        });
        const extruded = qCreatedBy(id + "L", EntityType.BODY);
        opTransform(context, id + "frame", { "bodies" : extruded, "transform" : toWorld(cs) });
        body = qBodyType(extruded, BodyType.SOLID);
    }
    else
    {
        const foot = acidBox(context, id + "foot", [[0, 0, 0], [24, 16, 6]]);
        const upright = acidBox(context, id + "upright", [[0, 0, 6], [6, 16, 22]]);
        const bodies = [foot, upright];
        opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(cs) });
        opBoolean(context, id + "union", { "tools" : qUnion(bodies), "operationType" : BooleanOperationType.UNION });
        body = acidResult(context, id + "union", bodies);
    }
    opFillet(context, id + "fillet", {
        "entities" : qClosestTo(qOwnedByBody(body, EntityType.EDGE), toWorld(cs, vector(6, 8, 6) * millimeter)),
        "radius" : 2 * millimeter
    });
    acidLabel(context, body, "AC77", variant);
}

// AC81: fCuboid (0,0,0)-(40,30,20), opTransform, then opFillet r 4 on the vertical edge through local
// (40,30,10). V5: the box as an extruded sketch rectangle.
function acidBoxFillet(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(1000, variant);
    var boxBody;
    if (variant == AcidVariant.V5)
        boxBody = acidSketchBox(context, id + "box", [[0, 0, 0], [40, 30, 20]]);
    else
        boxBody = acidBox(context, id + "box", [[0, 0, 0], [40, 30, 20]]);
    opTransform(context, id + "frame", { "bodies" : boxBody, "transform" : toWorld(cs) });
    opFillet(context, id + "fillet", {
        "entities" : qClosestTo(qOwnedByBody(boxBody, EntityType.EDGE), toWorld(cs, vector(40, 30, 10) * millimeter)),
        "radius" : 4 * millimeter
    });
    acidLabel(context, qBodyType(boxBody, BodyType.SOLID), "AC81", variant);
}

// AC84: fCuboid (0,0,0)-(40,30,20), opTransform, then opShell thickness -2 mm (inward, as acid-blend.fs
// AC37) removing the top face picked through local (20,15,20). V5: the box as an extruded sketch rectangle.
function acidBoxShell(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(1250, variant);
    var boxBody;
    if (variant == AcidVariant.V5)
        boxBody = acidSketchBox(context, id + "box", [[0, 0, 0], [40, 30, 20]]);
    else
        boxBody = acidBox(context, id + "box", [[0, 0, 0], [40, 30, 20]]);
    opTransform(context, id + "frame", { "bodies" : boxBody, "transform" : toWorld(cs) });
    opShell(context, id + "shell", {
        "entities" : qClosestTo(qOwnedByBody(boxBody, EntityType.FACE), toWorld(cs, vector(20, 15, 20) * millimeter)),
        "thickness" : -2 * millimeter
    });
    acidLabel(context, qBodyType(boxBody, BodyType.SOLID), "AC84", variant);
}

// AC89: plate fCuboid (0,0,0)-(40,30,5) and four fCylinder r 2 (z -1..6) at (5,5), (35,5), (5,25),
// (35,25); one opTransform, one subtraction, then one opFillet r 5 on the four vertical corner edges
// (picked through local (x,y,2.5)), each concentric to its bore. V4: bore radius 2.025, the corner
// radius stays 5. V5: one sketch on the local plane z = 0 with four skLineSegment, four skArc (the mids
// (38,1), (39,28), (1,28), (2,1) are rational points of the corner circles) and four skCircle, the
// holed region extruded 5 once, then the opTransform (no Boolean, no fillet).
function acidRoundedPlate(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(1500, variant);
    const r = 2 + acidRadiusDelta(variant);
    const centres = [[5, 5], [35, 5], [5, 25], [35, 25]];
    var result;
    if (variant == AcidVariant.V5)
    {
        var sk = newSketchOnPlane(context, id + "sk", {
            "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
        });
        skLineSegment(sk, "bottom", { "start" : vector(5, 0) * millimeter, "end" : vector(35, 0) * millimeter });
        skArc(sk, "corner1", { "start" : vector(35, 0) * millimeter, "mid" : vector(38, 1) * millimeter, "end" : vector(40, 5) * millimeter });
        skLineSegment(sk, "right", { "start" : vector(40, 5) * millimeter, "end" : vector(40, 25) * millimeter });
        skArc(sk, "corner2", { "start" : vector(40, 25) * millimeter, "mid" : vector(39, 28) * millimeter, "end" : vector(35, 30) * millimeter });
        skLineSegment(sk, "top", { "start" : vector(35, 30) * millimeter, "end" : vector(5, 30) * millimeter });
        skArc(sk, "corner3", { "start" : vector(5, 30) * millimeter, "mid" : vector(1, 28) * millimeter, "end" : vector(0, 25) * millimeter });
        skLineSegment(sk, "left", { "start" : vector(0, 25) * millimeter, "end" : vector(0, 5) * millimeter });
        skArc(sk, "corner4", { "start" : vector(0, 5) * millimeter, "mid" : vector(2, 1) * millimeter, "end" : vector(5, 0) * millimeter });
        for (var i = 0; i < size(centres); i += 1)
            skCircle(sk, "bore" ~ i, { "center" : vector(centres[i][0], centres[i][1]) * millimeter, "radius" : r * millimeter });
        skSolve(sk);
        opExtrude(context, id + "plate", {
            "entities" : qSketchRegion(id + "sk", true), "direction" : vector(0, 0, 1),
            "endBound" : BoundingType.BLIND, "endDepth" : 5 * millimeter
        });
        const plate = qCreatedBy(id + "plate", EntityType.BODY);
        opTransform(context, id + "frame", { "bodies" : plate, "transform" : toWorld(cs) });
        result = qBodyType(plate, BodyType.SOLID);
    }
    else
    {
        const plate = acidBox(context, id + "plate", [[0, 0, 0], [40, 30, 5]]);
        var tools = [];
        for (var i = 0; i < size(centres); i += 1)
            tools = append(tools, acidCyl(context, id + ("bore" ~ i), [centres[i][0], centres[i][1], -1], [centres[i][0], centres[i][1], 6], r));
        const bodies = concatenateArrays([[plate], tools]);
        opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(cs) });
        opBoolean(context, id + "cut", { "targets" : plate, "tools" : qUnion(tools), "operationType" : BooleanOperationType.SUBTRACTION });
        result = acidResult(context, id + "cut", bodies);
        const corners = [[0, 0], [40, 0], [0, 30], [40, 30]];
        var edges = [];
        for (var i = 0; i < size(corners); i += 1)
            edges = append(edges, qClosestTo(qOwnedByBody(result, EntityType.EDGE), toWorld(cs, vector(corners[i][0], corners[i][1], 2.5) * millimeter)));
        opFillet(context, id + "fillet", { "entities" : qUnion(edges), "radius" : 5 * millimeter });
    }
    acidLabel(context, result, "AC89", variant);
}

// Declared variants per zone (catalog zone.variants): zone = ALL skips a zone without the
// variant; an explicit request for an undeclared cell is an error, never a silent V0 build.
function acidDeclares(zone is AcidShapesAZone, variant is AcidVariant) returns boolean
{
    if (variant == AcidVariant.V4)
        return zone == AcidShapesAZone.AC60 || zone == AcidShapesAZone.AC72 || zone == AcidShapesAZone.AC89;
    return true;
}

function acidRun(requested is AcidShapesAZone, zone is AcidShapesAZone, variant is AcidVariant) returns boolean
{
    if (requested != AcidShapesAZone.ALL && requested != zone)
        return false;
    if (!acidDeclares(zone, variant))
    {
        if (requested == zone)
            throw regenError("CAD-Acid shapes-a: " ~ toString(zone) ~ " declares no " ~ acidVariantName(variant));
        return false;
    }
    return true;
}

annotation { "Feature Type Name" : "CAD Acid: Shapes A" }
export const acidShapesA = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Variant", "Default" : AcidVariant.V0 }
        definition.variant is AcidVariant;
        annotation { "Name" : "Zone", "Default" : AcidShapesAZone.ALL }
        definition.zone is AcidShapesAZone;
    }
    {
        const variant = definition.variant;
        const zone = definition.zone;
        if (acidRun(zone, AcidShapesAZone.AC60, variant))
            acidFourHolePlate(context, id + "AC60", variant);
        if (acidRun(zone, AcidShapesAZone.AC96, variant))
            acidStarPrism(context, id + "AC96", variant);
        if (acidRun(zone, AcidShapesAZone.AC72, variant))
            acidStepRevolve(context, id + "AC72", variant);
        if (acidRun(zone, AcidShapesAZone.AC77, variant))
            acidSeamFillet(context, id + "AC77", variant);
        if (acidRun(zone, AcidShapesAZone.AC81, variant))
            acidBoxFillet(context, id + "AC81", variant);
        if (acidRun(zone, AcidShapesAZone.AC84, variant))
            acidBoxShell(context, id + "AC84", variant);
        if (acidRun(zone, AcidShapesAZone.AC89, variant))
            acidRoundedPlate(context, id + "AC89", variant);
    });
