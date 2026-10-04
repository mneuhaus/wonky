FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// CAD-Acid Batch A, holes-a group: AC61, AC63, AC64, AC65, AC51, AC62, AC67, AC68, AC71, AC75,
// AC79, AC98. Row 8 (y = 2000 mm).
// V0-V3 keep the primitive+transform frame contract of acid-boolean.fs. V4 (radius
// bump on every circular feature, +0.025 mm) and V5 (alternate sketch-based idiom,
// same nominal geometry) both build their LOCAL operands at the untransformed origin
// and re-use the V0 frame: operands first, then ONE opTransform on all operands,
// then the Boolean(s), exactly as acid-boolean.fs does for V0-V3. Local construction steps
// (AC71's pattern copies, AC98's move) run before that one frame opTransform. AC79 declares no V4
// (no circular feature): zone = ALL skips it there, an explicit AC79/V4 request is an error.
export enum AcidVariant
{
    annotation { "Name" : "V0 identity" } V0,
    annotation { "Name" : "V1 translated" } V1,
    annotation { "Name" : "V2 axis permutation" } V2,
    annotation { "Name" : "V3 skew" } V3,
    annotation { "Name" : "V4 radius bump" } V4,
    annotation { "Name" : "V5 alternate idiom" } V5
}

export enum AcidHolesAZone
{
    annotation { "Name" : "All zones" } ALL,
    AC61, AC63, AC64, AC65, AC51, AC62, AC67, AC68, AC71, AC75, AC79, AC98
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
    const cell = vector(cellX, 2000, 0) * millimeter;
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

// AC61: pipe. Outer cylinder r9 (z 0..14) minus inner cylinder r3 (z -2..16). Genus 1.
function acidPipe(context is Context, id is Id, variant is AcidVariant)
{
    const dr = acidRadiusDelta(variant);
    var bodies;
    var resultQuery;
    if (variant == AcidVariant.V5)
    {
        var sk = newSketchOnPlane(context, id + "sk", {
            "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
        });
        skCircle(sk, "outer", { "center" : vector(0, 0) * millimeter, "radius" : (9 + dr) * millimeter });
        skCircle(sk, "inner", { "center" : vector(0, 0) * millimeter, "radius" : (3 + dr) * millimeter });
        skSolve(sk);
        opExtrude(context, id + "tube", {
            "entities" : qSketchRegion(id + "sk", true), "direction" : vector(0, 0, 1),
            "endBound" : BoundingType.BLIND, "endDepth" : 14 * millimeter
        });
        bodies = [qCreatedBy(id + "tube", EntityType.BODY)];
        resultQuery = qBodyType(qCreatedBy(id + "tube", EntityType.BODY), BodyType.SOLID);
        opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(0, variant)) });
    }
    else
    {
        const outer = acidCyl(context, id + "outer", [0, 0, 0], [0, 0, 14], 9 + dr);
        const inner = acidCyl(context, id + "inner", [0, 0, -2], [0, 0, 16], 3 + dr);
        bodies = [outer, inner];
        opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(0, variant)) });
        opBoolean(context, id + "cut", { "targets" : outer, "tools" : inner, "operationType" : BooleanOperationType.SUBTRACTION });
        resultQuery = acidResult(context, id + "cut", bodies);
    }
    acidLabel(context, resultQuery, "AC61", variant);
}

// AC63: blind hole. Box 32x24x10 minus cylinder r3 at (16,12), z 4..12 (floor 4 mm).
function acidBlindHole(context is Context, id is Id, variant is AcidVariant)
{
    const dr = acidRadiusDelta(variant);
    var boxBody;
    var toolQuery;
    if (variant == AcidVariant.V5)
    {
        boxBody = acidBox(context, id + "box", [[0, 0, 0], [32, 24, 10]]);
        var sk = newSketchOnPlane(context, id + "sk", {
            "sketchPlane" : plane(vector(0, 0, 4) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
        });
        skCircle(sk, "c", { "center" : vector(16, 12) * millimeter, "radius" : (3 + dr) * millimeter });
        skSolve(sk);
        opExtrude(context, id + "tool", {
            "entities" : qSketchRegion(id + "sk", false), "direction" : vector(0, 0, 1),
            "endBound" : BoundingType.BLIND, "endDepth" : 8 * millimeter
        });
        toolQuery = qCreatedBy(id + "tool", EntityType.BODY);
    }
    else
    {
        boxBody = acidBox(context, id + "box", [[0, 0, 0], [32, 24, 10]]);
        toolQuery = acidCyl(context, id + "tool", [16, 12, 4], [16, 12, 12], 3 + dr);
    }
    const bodies = [boxBody, toolQuery];
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(250, variant)) });
    opBoolean(context, id + "cut", { "targets" : boxBody, "tools" : toolQuery, "operationType" : BooleanOperationType.SUBTRACTION });
    acidLabel(context, acidResult(context, id + "cut", bodies), "AC63", variant);
}

// AC64: cross-axis holes. Box 40x24x20 minus a Z-bore r2 at (10,6) and an X-bore r2
// at (y,z) = (18,14), one Boolean, no crossing between the two bores.
function acidCrossHoles(context is Context, id is Id, variant is AcidVariant)
{
    const dr = acidRadiusDelta(variant);
    var boxBody;
    var toolZ;
    var toolX;
    if (variant == AcidVariant.V5)
    {
        boxBody = acidBox(context, id + "box", [[0, 0, 0], [40, 24, 20]]);
        var skz = newSketchOnPlane(context, id + "skz", {
            "sketchPlane" : plane(vector(0, 0, -1) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
        });
        skCircle(skz, "z", { "center" : vector(10, 6) * millimeter, "radius" : (2 + dr) * millimeter });
        skSolve(skz);
        opExtrude(context, id + "toolz", {
            "entities" : qSketchRegion(id + "skz", false), "direction" : vector(0, 0, 1),
            "endBound" : BoundingType.BLIND, "endDepth" : 22 * millimeter
        });
        var skx = newSketchOnPlane(context, id + "skx", {
            "sketchPlane" : plane(vector(-1, 0, 0) * millimeter, vector(1, 0, 0), vector(0, 1, 0))
        });
        skCircle(skx, "x", { "center" : vector(18, 14) * millimeter, "radius" : (2 + dr) * millimeter });
        skSolve(skx);
        opExtrude(context, id + "toolx", {
            "entities" : qSketchRegion(id + "skx", false), "direction" : vector(1, 0, 0),
            "endBound" : BoundingType.BLIND, "endDepth" : 42 * millimeter
        });
        toolZ = qCreatedBy(id + "toolz", EntityType.BODY);
        toolX = qCreatedBy(id + "toolx", EntityType.BODY);
    }
    else
    {
        boxBody = acidBox(context, id + "box", [[0, 0, 0], [40, 24, 20]]);
        toolZ = acidCyl(context, id + "z", [10, 6, -1], [10, 6, 21], 2 + dr);
        toolX = acidCyl(context, id + "x", [-1, 18, 14], [41, 18, 14], 2 + dr);
    }
    const bodies = [boxBody, toolZ, toolX];
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(500, variant)) });
    opBoolean(context, id + "cut", { "targets" : boxBody, "tools" : qUnion([toolZ, toolX]), "operationType" : BooleanOperationType.SUBTRACTION });
    acidLabel(context, acidResult(context, id + "cut", bodies), "AC64", variant);
}

// AC65: drill after union. Box [0,0,0]-[24,16,4] union [0,0,4]-[4,16,18], then a
// Z-bore r2 at (16,8) through the combined solid.
function acidDrillAfterUnion(context is Context, id is Id, variant is AcidVariant)
{
    const dr = acidRadiusDelta(variant);
    var a;
    var w;
    if (variant == AcidVariant.V5)
    {
        a = acidSketchBox(context, id + "a", [0, 0, 0], [24, 16, 4]);
        w = acidSketchBox(context, id + "w", [0, 0, 4], [4, 16, 18]);
    }
    else
    {
        a = acidBox(context, id + "a", [[0, 0, 0], [24, 16, 4]]);
        w = acidBox(context, id + "w", [[0, 0, 4], [4, 16, 18]]);
    }
    const bore = acidCyl(context, id + "bore", [16, 8, -1], [16, 8, 5], 2 + dr);
    const bodies = [a, w, bore];
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(750, variant)) });
    opBoolean(context, id + "union", { "tools" : qUnion([a, w]), "operationType" : BooleanOperationType.UNION });
    const unioned = acidResult(context, id + "union", [a, w]);
    opBoolean(context, id + "cut", { "targets" : unioned, "tools" : bore, "operationType" : BooleanOperationType.SUBTRACTION });
    acidLabel(context, acidResult(context, id + "cut", bodies), "AC65", variant);
}

// Star outline (the same as AC96 in acid-shapes-a.fs): 24 corners 15 deg apart, radius 10 at
// even and 8 at odd index, x = r cos, y = r sin, closed over the first corner.
function acidStarPoints() returns array
{
    var star = [];
    for (var i = 0; i < 24; i += 1)
    {
        const rr = (i % 2 == 0) ? 10 : 8;
        star = append(star, vector(rr * cos(i * 15 * degree), rr * sin(i * 15 * degree)) * millimeter);
    }
    return append(star, star[0]);
}

// AC51: the star sketched on the local XY plane and extruded 4, an fCylinder r 3 coaxial from
// z -1 to 5, one opTransform on both, then the subtraction. V5: the bore as a circle in the
// star sketch, the holed region extruded, then the same opTransform (no Boolean).
function acidStarBore(context is Context, id is Id, variant is AcidVariant)
{
    const r = 3 + acidRadiusDelta(variant);
    var sk = newSketchOnPlane(context, id + "sk", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    skPolyline(sk, "star", { "points" : acidStarPoints() });
    if (variant == AcidVariant.V5)
        skCircle(sk, "bore", { "center" : vector(0, 0) * millimeter, "radius" : r * millimeter });
    skSolve(sk);
    opExtrude(context, id + "gear", {
        "entities" : qSketchRegion(id + "sk", variant == AcidVariant.V5), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter
    });
    const gear = qCreatedBy(id + "gear", EntityType.BODY);
    var resultQuery;
    if (variant == AcidVariant.V5)
    {
        opTransform(context, id + "frame", { "bodies" : gear, "transform" : toWorld(acidFrame(1000, variant)) });
        resultQuery = qBodyType(gear, BodyType.SOLID);
    }
    else
    {
        const bore = acidCyl(context, id + "bore", [0, 0, -1], [0, 0, 5], r);
        const bodies = [gear, bore];
        opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(1000, variant)) });
        opBoolean(context, id + "cut", { "targets" : gear, "tools" : bore, "operationType" : BooleanOperationType.SUBTRACTION });
        resultQuery = acidResult(context, id + "cut", bodies);
    }
    acidLabel(context, resultQuery, "AC51", variant);
}

// AC62: bar r 10 (z 0..12), through-bore r 2 (z -1..13) and a hexagonal pocket tool (apothem 5,
// corners from h = 5/sqrt(3), sketched on the local plane z = 8 and extruded 5 to z = 13), one
// opTransform on all three, then ONE subtraction with both tools (they overlap in z 8..12).
// V5: the bore tool as a sketch circle on z = -1 extruded 14.
function acidHexPocketBar(context is Context, id is Id, variant is AcidVariant)
{
    const dr = acidRadiusDelta(variant);
    const bar = acidCyl(context, id + "bar", [0, 0, 0], [0, 0, 12], 10 + dr);
    var bore;
    if (variant == AcidVariant.V5)
        bore = acidSketchCyl(context, id + "bore", [0, 0], -1, 14, 2 + dr);
    else
        bore = acidCyl(context, id + "bore", [0, 0, -1], [0, 0, 13], 2 + dr);
    const h = 5 / sqrt(3);
    var sk = newSketchOnPlane(context, id + "hexsk", {
        "sketchPlane" : plane(vector(0, 0, 8) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    skPolyline(sk, "hexagon", { "points" : [vector(2 * h, 0) * millimeter, vector(h, 5) * millimeter, vector(-h, 5) * millimeter,
        vector(-2 * h, 0) * millimeter, vector(-h, -5) * millimeter, vector(h, -5) * millimeter, vector(2 * h, 0) * millimeter] });
    skSolve(sk);
    opExtrude(context, id + "pocket", {
        "entities" : qSketchRegion(id + "hexsk", false), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : 5 * millimeter
    });
    const pocket = qCreatedBy(id + "pocket", EntityType.BODY);
    const bodies = [bar, bore, pocket];
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(1250, variant)) });
    opBoolean(context, id + "cut", { "targets" : bar, "tools" : qUnion([bore, pocket]), "operationType" : BooleanOperationType.SUBTRACTION });
    acidLabel(context, acidResult(context, id + "cut", bodies), "AC62", variant);
}

// AC67: plate 24x16x4 and a boss cylinder r 4 at (12,8) from z 3 to 12 (1 mm inside the plate),
// one opTransform, then the union. V5: the boss as a sketch circle on the plate top (z = 4)
// extruded 8, then the same union (face contact instead of overlap; same result solid).
function acidBossOnPlate(context is Context, id is Id, variant is AcidVariant)
{
    const r = 4 + acidRadiusDelta(variant);
    const plate = acidBox(context, id + "plate", [[0, 0, 0], [24, 16, 4]]);
    var boss;
    if (variant == AcidVariant.V5)
        boss = acidSketchCyl(context, id + "boss", [12, 8], 4, 8, r);
    else
        boss = acidCyl(context, id + "boss", [12, 8, 3], [12, 8, 12], r);
    const bodies = [plate, boss];
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(1500, variant)) });
    opBoolean(context, id + "union", { "tools" : qUnion(bodies), "operationType" : BooleanOperationType.UNION });
    acidLabel(context, acidResult(context, id + "union", bodies), "AC67", variant);
}

// AC68: block 24x16x12, through-bore r 2 at (12,8) (z -1..13) and a slot [8,16]x[-2,12]x[5,9]
// that opens through the front face y = 0; one opTransform, then ONE subtraction with both tools
// (the bore crosses the slot). V5: both tools as extruded sketches (rectangle on z = 5, circle on z = -1).
function acidSideSlot(context is Context, id is Id, variant is AcidVariant)
{
    const r = 2 + acidRadiusDelta(variant);
    const block = acidBox(context, id + "block", [[0, 0, 0], [24, 16, 12]]);
    var bore;
    var slot;
    if (variant == AcidVariant.V5)
    {
        bore = acidSketchCyl(context, id + "bore", [12, 8], -1, 14, r);
        slot = acidSketchBox(context, id + "slot", [8, -2, 5], [16, 12, 9]);
    }
    else
    {
        bore = acidCyl(context, id + "bore", [12, 8, -1], [12, 8, 13], r);
        slot = acidBox(context, id + "slot", [[8, -2, 5], [16, 12, 9]]);
    }
    const bodies = [block, bore, slot];
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(1750, variant)) });
    opBoolean(context, id + "cut", { "targets" : block, "tools" : qUnion([bore, slot]), "operationType" : BooleanOperationType.SUBTRACTION });
    acidLabel(context, acidResult(context, id + "cut", bodies), "AC68", variant);
}

// AC71: box 32x24x8 and a seed cylinder r 2 at (8,12) (z -1..9); opPattern copies the seed by
// transform(vector) 8 and 16 mm along local x (local coordinates); one opTransform on the box, the
// seed and the copies, then ONE subtraction with seed and copies. V5: the seed as a sketch circle
// on z = -1 extruded 10; the same opPattern.
function acidPatternBores(context is Context, id is Id, variant is AcidVariant)
{
    const r = 2 + acidRadiusDelta(variant);
    const boxBody = acidBox(context, id + "box", [[0, 0, 0], [32, 24, 8]]);
    var seed;
    if (variant == AcidVariant.V5)
        seed = acidSketchCyl(context, id + "seed", [8, 12], -1, 10, r);
    else
        seed = acidCyl(context, id + "seed", [8, 12, -1], [8, 12, 9], r);
    opPattern(context, id + "copies", { "entities" : seed,
        "transforms" : [transform(vector(8, 0, 0) * millimeter), transform(vector(16, 0, 0) * millimeter)],
        "instanceNames" : ["1", "2"] });
    const copies = qCreatedBy(id + "copies", EntityType.BODY);
    const bodies = [boxBody, seed, copies];
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(2000, variant)) });
    opBoolean(context, id + "cut", { "targets" : boxBody, "tools" : qUnion([seed, copies]), "operationType" : BooleanOperationType.SUBTRACTION });
    acidLabel(context, acidResult(context, id + "cut", bodies), "AC71", variant);
}

// AC75: box 32x24x10, through-bore r 2 (z -1..11) and counterbore r 4 (z 7..11), coaxial at
// (16,12); one opTransform, then ONE subtraction with both tools. V5: both tools as sketch circles
// (z = -1 extruded 12, z = 7 extruded 4).
function acidCounterbore(context is Context, id is Id, variant is AcidVariant)
{
    const dr = acidRadiusDelta(variant);
    const boxBody = acidBox(context, id + "box", [[0, 0, 0], [32, 24, 10]]);
    var bore;
    var sink;
    if (variant == AcidVariant.V5)
    {
        bore = acidSketchCyl(context, id + "bore", [16, 12], -1, 12, 2 + dr);
        sink = acidSketchCyl(context, id + "sink", [16, 12], 7, 4, 4 + dr);
    }
    else
    {
        bore = acidCyl(context, id + "bore", [16, 12, -1], [16, 12, 11], 2 + dr);
        sink = acidCyl(context, id + "sink", [16, 12, 7], [16, 12, 11], 4 + dr);
    }
    const bodies = [boxBody, bore, sink];
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(2250, variant)) });
    opBoolean(context, id + "cut", { "targets" : boxBody, "tools" : qUnion([bore, sink]), "operationType" : BooleanOperationType.SUBTRACTION });
    acidLabel(context, acidResult(context, id + "cut", bodies), "AC75", variant);
}

// AC79: the L profile (0,0),(24,0),(24,6),(6,6),(6,20),(0,20) sketched on the local plane z = 0 and
// extruded 6, a square cutter fCuboid (2,8,-1)-(4,10,7) through its upright leg; one opTransform on
// both, then the subtraction. The target caps are non-convex. V5: the L as a chain of six
// skLineSegment calls instead of one skPolyline.
function acidConcaveProfileCut(context is Context, id is Id, variant is AcidVariant)
{
    const corners = [[0, 0], [24, 0], [24, 6], [6, 6], [6, 20], [0, 20]];
    var sk = newSketchOnPlane(context, id + "sk", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0))
    });
    if (variant == AcidVariant.V5)
    {
        for (var i = 0; i < size(corners); i += 1)
        {
            const a = corners[i];
            const b = corners[(i + 1) % size(corners)];
            skLineSegment(sk, "edge" ~ i, { "start" : vector(a[0], a[1]) * millimeter, "end" : vector(b[0], b[1]) * millimeter });
        }
    }
    else
    {
        var points = [];
        for (var i = 0; i < size(corners); i += 1)
            points = append(points, vector(corners[i][0], corners[i][1]) * millimeter);
        skPolyline(sk, "profile", { "points" : append(points, points[0]) });
    }
    skSolve(sk);
    opExtrude(context, id + "prism", {
        "entities" : qSketchRegion(id + "sk", false), "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter
    });
    const prism = qCreatedBy(id + "prism", EntityType.BODY);
    const cutter = acidBox(context, id + "cutter", [[2, 8, -1], [4, 10, 7]]);
    const bodies = [prism, cutter];
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(2500, variant)) });
    opBoolean(context, id + "cut", { "targets" : prism, "tools" : cutter, "operationType" : BooleanOperationType.SUBTRACTION });
    acidLabel(context, acidResult(context, id + "cut", bodies), "AC79", variant);
}

// AC98: a block fCuboid (0,0,0)-(24,16,8) moved by opTransform with transform(vector(40,8,0) mm)
// (local coordinates, now [40,64]x[8,24]x[0,8]), a bore fCylinder r 2 at the moved block's centre
// (52,16) from z -1 to 9; one frame opTransform on both, then the subtraction. V5: the same local
// move written toWorld(coordSystem(vector(40,8,0) mm, X, Z)).
function acidMovedBlockBore(context is Context, id is Id, variant is AcidVariant)
{
    const block = acidBox(context, id + "block", [[0, 0, 0], [24, 16, 8]]);
    var move;
    if (variant == AcidVariant.V5)
        move = toWorld(coordSystem(vector(40, 8, 0) * millimeter, vector(1, 0, 0), vector(0, 0, 1)));
    else
        move = transform(vector(40, 8, 0) * millimeter);
    opTransform(context, id + "move", { "bodies" : block, "transform" : move });
    const bore = acidCyl(context, id + "bore", [52, 16, -1], [52, 16, 9], 2 + acidRadiusDelta(variant));
    const bodies = [block, bore];
    opTransform(context, id + "frame", { "bodies" : qUnion(bodies), "transform" : toWorld(acidFrame(2750, variant)) });
    opBoolean(context, id + "cut", { "targets" : block, "tools" : bore, "operationType" : BooleanOperationType.SUBTRACTION });
    acidLabel(context, acidResult(context, id + "cut", bodies), "AC98", variant);
}

// Declared variants per zone (catalog zone.variants): zone = ALL skips a zone without the
// variant; an explicit request for an undeclared cell is an error, never a silent V0 build.
function acidDeclares(zone is AcidHolesAZone, variant is AcidVariant) returns boolean
{
    if (variant == AcidVariant.V4)
        return zone != AcidHolesAZone.AC79;
    return true;
}

function acidRun(requested is AcidHolesAZone, zone is AcidHolesAZone, variant is AcidVariant) returns boolean
{
    if (requested != AcidHolesAZone.ALL && requested != zone)
        return false;
    if (!acidDeclares(zone, variant))
    {
        if (requested == zone)
            throw regenError("CAD-Acid holes-a: " ~ toString(zone) ~ " declares no " ~ acidVariantName(variant));
        return false;
    }
    return true;
}

annotation { "Feature Type Name" : "CAD Acid: Holes A" }
export const acidHolesA = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Variant", "Default" : AcidVariant.V0 }
        definition.variant is AcidVariant;
        annotation { "Name" : "Zone", "Default" : AcidHolesAZone.ALL }
        definition.zone is AcidHolesAZone;
    }
    {
        const variant = definition.variant;
        const zone = definition.zone;
        if (acidRun(zone, AcidHolesAZone.AC61, variant))
            acidPipe(context, id + "AC61", variant);
        if (acidRun(zone, AcidHolesAZone.AC63, variant))
            acidBlindHole(context, id + "AC63", variant);
        if (acidRun(zone, AcidHolesAZone.AC64, variant))
            acidCrossHoles(context, id + "AC64", variant);
        if (acidRun(zone, AcidHolesAZone.AC65, variant))
            acidDrillAfterUnion(context, id + "AC65", variant);
        if (acidRun(zone, AcidHolesAZone.AC51, variant))
            acidStarBore(context, id + "AC51", variant);
        if (acidRun(zone, AcidHolesAZone.AC62, variant))
            acidHexPocketBar(context, id + "AC62", variant);
        if (acidRun(zone, AcidHolesAZone.AC67, variant))
            acidBossOnPlate(context, id + "AC67", variant);
        if (acidRun(zone, AcidHolesAZone.AC68, variant))
            acidSideSlot(context, id + "AC68", variant);
        if (acidRun(zone, AcidHolesAZone.AC71, variant))
            acidPatternBores(context, id + "AC71", variant);
        if (acidRun(zone, AcidHolesAZone.AC75, variant))
            acidCounterbore(context, id + "AC75", variant);
        if (acidRun(zone, AcidHolesAZone.AC79, variant))
            acidConcaveProfileCut(context, id + "AC79", variant);
        if (acidRun(zone, AcidHolesAZone.AC98, variant))
            acidMovedBlockBore(context, id + "AC98", variant);
    });
