FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// CAD-Acid Batch A, regions-a group: AC52, AC53, AC56, AC57, AC91, AC92, AC93, AC95, AC99.
// Row 7 (y = 1750 mm).
// Sketch frame (catalog constructionRules): every sketch lies on plane(cs) with local 2D
// coordinates passed unchanged, region points are mapped with toWorld(cs, p), and the
// extrusion direction is cs.zAxis, exactly as acid-profile.fs does for V0-V3. V4 (radius
// +0.025 mm on every circle) and V5 (alternate idiom) use V0's frame (baseFrame). The V5
// Boolean idioms of AC57 and AC91 follow the primitive+transform frame of acid-holes-a.fs:
// local operands first, then ONE opTransform(toWorld(cs)) on all operands, then the Boolean.
export enum AcidVariant
{
    annotation { "Name" : "V0 identity" } V0,
    annotation { "Name" : "V1 translated" } V1,
    annotation { "Name" : "V2 axis permutation" } V2,
    annotation { "Name" : "V3 skew" } V3,
    annotation { "Name" : "V4 radius bump" } V4,
    annotation { "Name" : "V5 alternate idiom" } V5
}

export enum AcidRegionsAZone
{
    annotation { "Name" : "All zones" } ALL,
    AC52, AC53, AC56, AC57, AC91, AC92, AC93, AC95, AC99
}

const DEPTH = 4 * millimeter;

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
    const cell = vector(cellX, 1750, 0) * millimeter;
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

// V4's only geometric effect: +0.025 mm on every circle's radius.
function acidRadiusDelta(variant is AcidVariant) returns number
{
    if (variant == AcidVariant.V4) return 0.025;
    return 0;
}

function acidXY(cs is CoordSystem) returns Plane
{
    return plane(cs.origin, cs.zAxis, cs.xAxis);
}

// The local XY plane at the local origin, for operands placed later by one opTransform.
function acidLocalXY() returns Plane
{
    return plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0));
}

function acidExtrude(context is Context, id is Id, regions is Query, direction is Vector) returns Query
{
    opExtrude(context, id, { "entities" : regions, "direction" : direction,
        "endBound" : BoundingType.BLIND, "endDepth" : DEPTH });
    return qCreatedBy(id, EntityType.BODY);
}

// One region of the sketch, picked by a local point on the sketch plane.
function acidRegionAt(sketchId is Id, cs is CoordSystem, p is array) returns Query
{
    return qContainsPoint(qSketchRegion(sketchId, false), toWorld(cs, vector(p[0], p[1], 0) * millimeter));
}

// V5 idiom of the three-region zones: every region of the sketch extruded in a loop.
function acidExtrudeEachRegion(context is Context, id is Id, sketchId is Id, cs is CoordSystem) returns array
{
    const regions = evaluateQuery(context, qSketchRegion(sketchId, false));
    var bodies = [];
    for (var i = 0; i < size(regions); i += 1)
        bodies = append(bodies, acidExtrude(context, id + ("region" ~ i), regions[i], cs.zAxis));
    return bodies;
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

// AC52: two circles r 5 about (-3,0) and (3,0) form a lens and two crescents; each region
// is picked by a point and extruded as its own body (V5: every region in a loop).
function acidOverlapCircles(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(0, variant);
    const r = (5 + acidRadiusDelta(variant)) * millimeter;
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    skCircle(sketch, "left", { "center" : vector(-3, 0) * millimeter, "radius" : r });
    skCircle(sketch, "right", { "center" : vector(3, 0) * millimeter, "radius" : r });
    skSolve(sketch);
    var bodies = [];
    if (variant == AcidVariant.V5)
        bodies = acidExtrudeEachRegion(context, id, sketchId, cs);
    else
    {
        bodies = append(bodies, acidExtrude(context, id + "lens", acidRegionAt(sketchId, cs, [0, 0]), cs.zAxis));
        bodies = append(bodies, acidExtrude(context, id + "leftCrescent", acidRegionAt(sketchId, cs, [-6, 0]), cs.zAxis));
        bodies = append(bodies, acidExtrude(context, id + "rightCrescent", acidRegionAt(sketchId, cs, [6, 0]), cs.zAxis));
    }
    acidLabel(context, qBodyType(qUnion(bodies), BodyType.SOLID), "AC52", variant);
}

// AC53: circle r 5 about the origin split by the overhanging line (-6,0)-(6,0); only the
// upper half (the region containing (0,2)) is extruded.
function acidSplitCircle(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(250, variant);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    skCircle(sketch, "disc", { "center" : vector(0, 0) * millimeter,
        "radius" : (5 + acidRadiusDelta(variant)) * millimeter });
    skLineSegment(sketch, "split", { "start" : vector(-6, 0) * millimeter, "end" : vector(6, 0) * millimeter });
    skSolve(sketch);
    const upper = acidExtrude(context, id + "upper", acidRegionAt(sketchId, cs, [0, 2]), cs.zAxis);
    acidLabel(context, qBodyType(upper, BodyType.SOLID), "AC53", variant);
}

// AC56: nested rectangles (0,0)-(24,18) and (6,5)-(18,13); the frame between them
// (qSketchRegion with filterInnerLoops) is extruded. V5 draws both loops as polylines.
function acidNestedLoops(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(500, variant);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    if (variant == AcidVariant.V5)
    {
        skPolyline(sketch, "outer", { "points" : [vector(0, 0) * millimeter, vector(24, 0) * millimeter,
            vector(24, 18) * millimeter, vector(0, 18) * millimeter, vector(0, 0) * millimeter] });
        skPolyline(sketch, "inner", { "points" : [vector(6, 5) * millimeter, vector(18, 5) * millimeter,
            vector(18, 13) * millimeter, vector(6, 13) * millimeter, vector(6, 5) * millimeter] });
    }
    else
    {
        skRectangle(sketch, "outer", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(24, 18) * millimeter });
        skRectangle(sketch, "inner", { "firstCorner" : vector(6, 5) * millimeter, "secondCorner" : vector(18, 13) * millimeter });
    }
    skSolve(sketch);
    const frame = acidExtrude(context, id + "frame", qSketchRegion(sketchId, true), cs.zAxis);
    acidLabel(context, qBodyType(frame, BodyType.SOLID), "AC56", variant);
}

// AC57: rectangle 32x24 with three circles r 2 at (8,8), (24,8), (16,16) in one sketch; the
// holed region is extruded. V5: plate from a sketch rectangle, three fCylinder tools, one
// opTransform on all operands, then one subtraction.
function acidThreeBores(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(750, variant);
    const r = (2 + acidRadiusDelta(variant)) * millimeter;
    const centres = [[8, 8], [24, 8], [16, 16]];
    const sketchId = id + "sketch";
    if (variant == AcidVariant.V5)
    {
        var plateSketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidLocalXY() });
        skRectangle(plateSketch, "plate", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(32, 24) * millimeter });
        skSolve(plateSketch);
        const plate = acidExtrude(context, id + "plate", qSketchRegion(sketchId, false), vector(0, 0, 1));
        var tools = [];
        for (var i = 0; i < size(centres); i += 1)
        {
            fCylinder(context, id + ("bore" ~ i), {
                "bottomCenter" : vector(centres[i][0], centres[i][1], -1) * millimeter,
                "topCenter" : vector(centres[i][0], centres[i][1], 5) * millimeter,
                "radius" : r });
            tools = append(tools, qCreatedBy(id + ("bore" ~ i), EntityType.BODY));
        }
        const bodies = concatenateArrays([[plate], tools]);
        opTransform(context, id + "place", { "bodies" : qUnion(bodies), "transform" : toWorld(cs) });
        opBoolean(context, id + "cut", { "targets" : plate, "tools" : qUnion(tools), "operationType" : BooleanOperationType.SUBTRACTION });
        acidLabel(context, acidResult(context, id + "cut", bodies), "AC57", variant);
        return;
    }
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    skRectangle(sketch, "plate", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(32, 24) * millimeter });
    for (var i = 0; i < size(centres); i += 1)
        skCircle(sketch, "bore" ~ i, { "center" : vector(centres[i][0], centres[i][1]) * millimeter, "radius" : r });
    skSolve(sketch);
    const plate = acidExtrude(context, id + "plate", qSketchRegion(sketchId, true), cs.zAxis);
    acidLabel(context, qBodyType(plate, BodyType.SOLID), "AC57", variant);
}

// Obround outline: three-point arcs about (7,9) and (19,9), r 5, joined by tangent lines.
function acidObround(sketch is Sketch)
{
    skArc(sketch, "leftEnd", { "start" : vector(7, 14) * millimeter, "mid" : vector(2, 9) * millimeter, "end" : vector(7, 4) * millimeter });
    skLineSegment(sketch, "bottom", { "start" : vector(7, 4) * millimeter, "end" : vector(19, 4) * millimeter });
    skArc(sketch, "rightEnd", { "start" : vector(19, 4) * millimeter, "mid" : vector(24, 9) * millimeter, "end" : vector(19, 14) * millimeter });
    skLineSegment(sketch, "top", { "start" : vector(19, 14) * millimeter, "end" : vector(7, 14) * millimeter });
}

// AC91: obround with a concentric circle r 1 at (7,9); the holed region is extruded.
// V5: obround extruded, then an fCylinder tool, one opTransform, one subtraction.
function acidObroundHole(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(1000, variant);
    const sketchId = id + "sketch";
    if (variant == AcidVariant.V5)
    {
        var outline = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidLocalXY() });
        acidObround(outline);
        skSolve(outline);
        const body = acidExtrude(context, id + "body", qSketchRegion(sketchId, false), vector(0, 0, 1));
        fCylinder(context, id + "bore", { "bottomCenter" : vector(7, 9, -1) * millimeter,
            "topCenter" : vector(7, 9, 5) * millimeter, "radius" : 1 * millimeter });
        const tool = qCreatedBy(id + "bore", EntityType.BODY);
        const bodies = [body, tool];
        opTransform(context, id + "place", { "bodies" : qUnion(bodies), "transform" : toWorld(cs) });
        opBoolean(context, id + "cut", { "targets" : body, "tools" : tool, "operationType" : BooleanOperationType.SUBTRACTION });
        acidLabel(context, acidResult(context, id + "cut", bodies), "AC91", variant);
        return;
    }
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    acidObround(sketch);
    skCircle(sketch, "hole", { "center" : vector(7, 9) * millimeter, "radius" : 1 * millimeter });
    skSolve(sketch);
    const body = acidExtrude(context, id + "body", qSketchRegion(sketchId, true), cs.zAxis);
    acidLabel(context, qBodyType(body, BodyType.SOLID), "AC91", variant);
}

// AC92: rectangles (0,0)-(10,10) and (5,5)-(15,15) form two L-regions and the overlap
// square; each region is picked by a point and extruded as its own body (V5: loop).
function acidOverlapRects(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(1250, variant);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    skRectangle(sketch, "first", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(10, 10) * millimeter });
    skRectangle(sketch, "second", { "firstCorner" : vector(5, 5) * millimeter, "secondCorner" : vector(15, 15) * millimeter });
    skSolve(sketch);
    var bodies = [];
    if (variant == AcidVariant.V5)
        bodies = acidExtrudeEachRegion(context, id, sketchId, cs);
    else
    {
        bodies = append(bodies, acidExtrude(context, id + "firstL", acidRegionAt(sketchId, cs, [2.5, 2.5]), cs.zAxis));
        bodies = append(bodies, acidExtrude(context, id + "overlap", acidRegionAt(sketchId, cs, [7.5, 7.5]), cs.zAxis));
        bodies = append(bodies, acidExtrude(context, id + "secondL", acidRegionAt(sketchId, cs, [12.5, 12.5]), cs.zAxis));
    }
    acidLabel(context, qBodyType(qUnion(bodies), BodyType.SOLID), "AC92", variant);
}

// AC93: rectangle (0,0)-(20,10) split by the line (10,-2)-(10,12), whose ends overhang; the
// regions at (5,5) and (15,5) are extruded as two bodies. V5: the rectangle as a closed polyline.
function acidLineSplitsRect(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(1500, variant);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    if (variant == AcidVariant.V5)
        skPolyline(sketch, "outline", { "points" : [vector(0, 0) * millimeter, vector(20, 0) * millimeter,
            vector(20, 10) * millimeter, vector(0, 10) * millimeter, vector(0, 0) * millimeter] });
    else
        skRectangle(sketch, "outline", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(20, 10) * millimeter });
    skLineSegment(sketch, "split", { "start" : vector(10, -2) * millimeter, "end" : vector(10, 12) * millimeter });
    skSolve(sketch);
    var bodies = [];
    bodies = append(bodies, acidExtrude(context, id + "left", acidRegionAt(sketchId, cs, [5, 5]), cs.zAxis));
    bodies = append(bodies, acidExtrude(context, id + "right", acidRegionAt(sketchId, cs, [15, 5]), cs.zAxis));
    acidLabel(context, qBodyType(qUnion(bodies), BodyType.SOLID), "AC93", variant);
}

// AC95: hexagon across flats 12 with corners (+-2h,0), (+-h,+-6), h = 6/sqrt(3), and a central
// circle r 1.5; the holed region is extruded. V5: corners (12/sqrt(3)) (cos 60k deg, sin 60k deg).
function acidHexBore(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(1750, variant);
    var corners = [];
    if (variant == AcidVariant.V5)
    {
        const circumradius = 12 / sqrt(3);
        for (var k = 0; k < 6; k += 1)
            corners = append(corners, vector(circumradius * cos(k * 60 * degree), circumradius * sin(k * 60 * degree)) * millimeter);
    }
    else
    {
        const h = 6 / sqrt(3);
        corners = [vector(2 * h, 0) * millimeter, vector(h, 6) * millimeter, vector(-h, 6) * millimeter,
            vector(-2 * h, 0) * millimeter, vector(-h, -6) * millimeter, vector(h, -6) * millimeter];
    }
    corners = append(corners, corners[0]);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    skPolyline(sketch, "hexagon", { "points" : corners });
    skCircle(sketch, "bore", { "center" : vector(0, 0) * millimeter, "radius" : (1.5 + acidRadiusDelta(variant)) * millimeter });
    skSolve(sketch);
    const body = acidExtrude(context, id + "body", qSketchRegion(sketchId, true), cs.zAxis);
    acidLabel(context, qBodyType(body, BodyType.SOLID), "AC95", variant);
}

// AC99: two separate rectangles (0,0)-(10,10) and (20,0)-(30,10); only the region containing
// (25,5) is extruded. V5: the region closest to that point (qClosestTo).
function acidPickRegion(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(2000, variant);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    skRectangle(sketch, "left", { "firstCorner" : vector(0, 0) * millimeter, "secondCorner" : vector(10, 10) * millimeter });
    skRectangle(sketch, "right", { "firstCorner" : vector(20, 0) * millimeter, "secondCorner" : vector(30, 10) * millimeter });
    skSolve(sketch);
    var region;
    if (variant == AcidVariant.V5)
        region = qClosestTo(qSketchRegion(sketchId, false), toWorld(cs, vector(25, 5, 0) * millimeter));
    else
        region = acidRegionAt(sketchId, cs, [25, 5]);
    const body = acidExtrude(context, id + "picked", region, cs.zAxis);
    acidLabel(context, qBodyType(body, BodyType.SOLID), "AC99", variant);
}

// Declared variants per zone (catalog zone.variants): zone = ALL skips a zone without the
// variant; an explicit request for an undeclared cell is an error, never a silent V0 build.
function acidDeclares(zone is AcidRegionsAZone, variant is AcidVariant) returns boolean
{
    if (variant == AcidVariant.V4)
        return zone == AcidRegionsAZone.AC52 || zone == AcidRegionsAZone.AC53 || zone == AcidRegionsAZone.AC57 ||
            zone == AcidRegionsAZone.AC95;
    if (variant == AcidVariant.V5)
        return zone != AcidRegionsAZone.AC53;
    return true;
}

function acidRun(requested is AcidRegionsAZone, zone is AcidRegionsAZone, variant is AcidVariant) returns boolean
{
    if (requested != AcidRegionsAZone.ALL && requested != zone)
        return false;
    if (!acidDeclares(zone, variant))
    {
        if (requested == zone)
            throw regenError("CAD-Acid regions-a: " ~ toString(zone) ~ " declares no " ~ acidVariantName(variant));
        return false;
    }
    return true;
}

annotation { "Feature Type Name" : "CAD Acid: Regions A" }
export const acidRegionsA = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Variant", "Default" : AcidVariant.V0 }
        definition.variant is AcidVariant;
        annotation { "Name" : "Zone", "Default" : AcidRegionsAZone.ALL }
        definition.zone is AcidRegionsAZone;
    }
    {
        const variant = definition.variant;
        const zone = definition.zone;
        if (acidRun(zone, AcidRegionsAZone.AC52, variant))
            acidOverlapCircles(context, id + "AC52", variant);
        if (acidRun(zone, AcidRegionsAZone.AC53, variant))
            acidSplitCircle(context, id + "AC53", variant);
        if (acidRun(zone, AcidRegionsAZone.AC56, variant))
            acidNestedLoops(context, id + "AC56", variant);
        if (acidRun(zone, AcidRegionsAZone.AC57, variant))
            acidThreeBores(context, id + "AC57", variant);
        if (acidRun(zone, AcidRegionsAZone.AC91, variant))
            acidObroundHole(context, id + "AC91", variant);
        if (acidRun(zone, AcidRegionsAZone.AC92, variant))
            acidOverlapRects(context, id + "AC92", variant);
        if (acidRun(zone, AcidRegionsAZone.AC93, variant))
            acidLineSplitsRect(context, id + "AC93", variant);
        if (acidRun(zone, AcidRegionsAZone.AC95, variant))
            acidHexBore(context, id + "AC95", variant);
        if (acidRun(zone, AcidRegionsAZone.AC99, variant))
            acidPickRegion(context, id + "AC99", variant);
    });
