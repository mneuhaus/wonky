FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Acid profile group, authored from fixtures/cad-acid/zones.json (AC1-2026-09-26-a1).
// Each zone has its own cell; variant transforms are applied to construction inputs,
// not to the finished bodies. All sketch coordinates below are local millimetres.
export enum AcidVariant
{
    annotation { "Name" : "Identity" }
    V0,
    annotation { "Name" : "Translation" }
    V1,
    annotation { "Name" : "Exact axis permutation" }
    V2,
    annotation { "Name" : "Skew about local pivot" }
    V3
}

export enum AcidProfileZone
{
    annotation { "Name" : "All profile zones" }
    ALL,
    annotation { "Name" : "AC01 L profile" }
    AC01,
    annotation { "Name" : "AC02 Inner loop" }
    AC02,
    annotation { "Name" : "AC03 Obround" }
    AC03,
    annotation { "Name" : "AC04 Quarter revolve" }
    AC04,
    annotation { "Name" : "AC05 Square loft" }
    AC05,
    annotation { "Name" : "AC07 Helix sweep" }
    AC07,
    annotation { "Name" : "AC08 Circular pattern" }
    AC08,
    annotation { "Name" : "AC09 Mirror" }
    AC09
}

function acidVariantName(variant is AcidVariant) returns string
{
    if (variant == AcidVariant.V0) return "V0";
    if (variant == AcidVariant.V1) return "V1";
    if (variant == AcidVariant.V2) return "V2";
    return "V3";
}

// F(p) = cellOrigin + Vk(p). V3's rotation is constructed about the local
// point (3,-2,5), before adding the cell offset; using rotated world points
// instead would erase the construction provenance tested by AC1.
function acidFrame(variant is AcidVariant, cellX is number) returns CoordSystem
{
    const cell = vector(cellX, 0, 0) * millimeter;
    if (variant == AcidVariant.V1)
        return coordSystem(cell + vector(65536.25, -32768.5, 16384.125) * millimeter,
                           vector(1, 0, 0), vector(0, 0, 1));
    if (variant == AcidVariant.V2)
        return coordSystem(cell, vector(0, 0, 1), vector(0, -1, 0));
    if (variant == AcidVariant.V3)
    {
        const rotated = rotationAround(line(vector(3, -2, 5) * millimeter, vector(1, 2, 3)),
                                       0.1 * radian);
        return coordSystem(cell + rotated * (vector(0, 0, 0) * millimeter),
                           rotated.linear * vector(1, 0, 0),
                           rotated.linear * vector(0, 0, 1));
    }
    return coordSystem(cell, vector(1, 0, 0), vector(0, 0, 1));
}

function acidXY(cs is CoordSystem) returns Plane
{
    return plane(cs.origin, cs.zAxis, cs.xAxis);
}

function acidExtrude(context is Context, id is Id, sketchId is Id, direction is Vector,
                     depth is ValueWithUnits)
{
    opExtrude(context, id, { "entities" : qSketchRegion(sketchId, false),
        "direction" : direction, "endBound" : BoundingType.BLIND, "endDepth" : depth });
}

function acidLabel(context is Context, body is Query, zone is string, k is number, variant is AcidVariant)
{
    const suffix = acidVariantName(variant);
    setProperty(context, { "entities" : body, "propertyType" : PropertyType.NAME,
        "value" : zone ~ "_" ~ k ~ "_" ~ suffix });
    setProperty(context, { "entities" : body, "propertyType" : PropertyType.DESCRIPTION,
        "value" : "acid=" ~ zone ~ "@" ~ suffix });
}

function acidAC01(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(variant, 0);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    skPolyline(sketch, "outline", { "points" : [vector(0, 0) * millimeter,
        vector(16, 0) * millimeter, vector(16, 4) * millimeter,
        vector(4, 4) * millimeter, vector(4, 12) * millimeter,
        vector(0, 12) * millimeter, vector(0, 0) * millimeter] });
    skSolve(sketch);
    acidExtrude(context, id + "solid", sketchId, cs.zAxis, 8 * millimeter);
    acidLabel(context, qCreatedBy(id + "solid", EntityType.BODY), "AC01", 0, variant);
}

function acidAC02(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(variant, 250);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    skRectangle(sketch, "outline", { "firstCorner" : vector(0, 0) * millimeter,
        "secondCorner" : vector(16, 16) * millimeter });
    skCircle(sketch, "hole", { "center" : vector(8, 8) * millimeter, "radius" : 4 * millimeter });
    skSolve(sketch);
    // filterInnerLoops excludes the separate disk but retains the holed outer region.
    opExtrude(context, id + "solid", { "entities" : qSketchRegion(sketchId, true),
        "direction" : cs.zAxis, "endBound" : BoundingType.BLIND, "endDepth" : 8 * millimeter });
    acidLabel(context, qCreatedBy(id + "solid", EntityType.BODY), "AC02", 0, variant);
}

function acidAC03(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(variant, 500);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    skLineSegment(sketch, "lower", { "start" : vector(2, 0) * millimeter,
        "end" : vector(10, 0) * millimeter });
    skArc(sketch, "right", { "start" : vector(10, 0) * millimeter,
        "mid" : vector(12, 2) * millimeter, "end" : vector(10, 4) * millimeter });
    skLineSegment(sketch, "upper", { "start" : vector(10, 4) * millimeter,
        "end" : vector(2, 4) * millimeter });
    skArc(sketch, "left", { "start" : vector(2, 4) * millimeter,
        "mid" : vector(0, 2) * millimeter, "end" : vector(2, 0) * millimeter });
    skSolve(sketch);
    acidExtrude(context, id + "solid", sketchId, cs.zAxis, 3 * millimeter);
    acidLabel(context, qCreatedBy(id + "solid", EntityType.BODY), "AC03", 0, variant);
}

function acidAC04(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(variant, 750);
    const sketchId = id + "sketch";
    // Normal -Y and x axis +X give sketch y axis +Z (local XZ plane).
    var sketch = newSketchOnPlane(context, sketchId,
        { "sketchPlane" : plane(cs.origin, -cross(cs.zAxis, cs.xAxis), cs.xAxis) });
    skRectangle(sketch, "section", { "firstCorner" : vector(4, 0) * millimeter,
        "secondCorner" : vector(8, 6) * millimeter });
    skSolve(sketch);
    opRevolve(context, id + "solid", { "entities" : qSketchRegion(sketchId, false),
        "axis" : line(cs.origin, cs.zAxis), "angleForward" : 90 * degree });
    acidLabel(context, qCreatedBy(id + "solid", EntityType.BODY), "AC04", 0, variant);
}

function acidAC05(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(variant, 1000);
    const bottomId = id + "bottom";
    var bottom = newSketchOnPlane(context, bottomId, { "sketchPlane" : acidXY(cs) });
    skRectangle(bottom, "section", { "firstCorner" : vector(0, 0) * millimeter,
        "secondCorner" : vector(8, 8) * millimeter });
    skSolve(bottom);
    const topId = id + "top";
    var top = newSketchOnPlane(context, topId, { "sketchPlane" :
        plane(toWorld(cs, vector(0, 0, 6) * millimeter), cs.zAxis, cs.xAxis) });
    skRectangle(top, "section", { "firstCorner" : vector(2, 2) * millimeter,
        "secondCorner" : vector(6, 6) * millimeter });
    skSolve(top);
    opLoft(context, id + "solid", { "profileSubqueries" :
        [qSketchRegion(bottomId, false), qSketchRegion(topId, false)] });
    acidLabel(context, qCreatedBy(id + "solid", EntityType.BODY), "AC05", 0, variant);
}

function acidAC07(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(variant, 1250);
    const helixId = id + "helix";
    const start = toWorld(cs, vector(8, 0, 0) * millimeter);
    // Onshape's "viewed along direction" is from -Z towards +Z. Clockwise
    // from there is counterclockwise seen from +Z: (R*cos(t),R*sin(t),pitch*t/2PI).
    opHelix(context, helixId, { "direction" : cs.zAxis, "axisStart" : cs.origin,
        "startPoint" : start, "interval" : vector(0, 2), "clockwise" : true,
        "helicalPitch" : 4 * millimeter, "spiralPitch" : 0 * millimeter });
    const sketchId = id + "section";
    // Helix derivative at theta=0 is proportional to (0, 4*pi, 1).
    const tangent = normalize(cross(cs.zAxis, cs.xAxis) * (4 * PI) + cs.zAxis);
    var sketch = newSketchOnPlane(context, sketchId,
        { "sketchPlane" : plane(start, tangent, cs.xAxis) });
    skCircle(sketch, "tube", { "center" : vector(0, 0) * millimeter,
        "radius" : 1 * millimeter });
    skSolve(sketch);
    opSweep(context, id + "solid", { "profiles" : qSketchRegion(sketchId, false),
        "path" : qCreatedBy(helixId, EntityType.EDGE), "keepProfileOrientation" : false });
    // The curve is a construction input, not an additional result part.
    opDeleteBodies(context, id + "removeHelix", { "entities" : qCreatedBy(helixId, EntityType.BODY) });
    acidLabel(context, qCreatedBy(id + "solid", EntityType.BODY), "AC07", 0, variant);
}

function acidAC08(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(variant, 1500);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    skCircle(sketch, "seed", { "center" : vector(8, 0) * millimeter,
        "radius" : 2 * millimeter });
    skSolve(sketch);
    acidExtrude(context, id + "seed", sketchId, cs.zAxis, 4 * millimeter);
    const seed = qCreatedBy(id + "seed", EntityType.BODY);
    const axis = line(cs.origin, cs.zAxis);
    for (var k = 1; k < 4; k += 1)
    {
        const copyId = id + ("copy" ~ k);
        opPattern(context, copyId, { "entities" : seed,
            "transforms" : [rotationAround(axis, k * 90 * degree)],
            "instanceNames" : ["quarter" ~ k] });
        acidLabel(context, qCreatedBy(copyId, EntityType.BODY), "AC08", k, variant);
    }
    acidLabel(context, seed, "AC08", 0, variant);
}

function acidAC09(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(variant, 1750);
    const sketchId = id + "sketch";
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : acidXY(cs) });
    skPolyline(sketch, "wedge", { "points" : [vector(2, 0) * millimeter,
        vector(10, 0) * millimeter, vector(2, 6) * millimeter,
        vector(2, 0) * millimeter] });
    skSolve(sketch);
    acidExtrude(context, id + "seed", sketchId, cs.zAxis, 4 * millimeter);
    const seed = qCreatedBy(id + "seed", EntityType.BODY);
    opPattern(context, id + "copy", { "entities" : seed,
        "transforms" : [mirrorAcross(plane(cs.origin, cs.xAxis))],
        "instanceNames" : ["mirror"] });
    acidLabel(context, seed, "AC09", 0, variant);
    acidLabel(context, qCreatedBy(id + "copy", EntityType.BODY), "AC09", 1, variant);
}

annotation { "Feature Type Name" : "CAD Acid: Sketch and profile" }
export const acidProfile = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Variant", "Default" : AcidVariant.V0 }
        definition.variant is AcidVariant;
        annotation { "Name" : "Zone", "Default" : AcidProfileZone.ALL }
        definition.zone is AcidProfileZone;
    }
    {
        if (definition.zone == AcidProfileZone.ALL || definition.zone == AcidProfileZone.AC01)
            acidAC01(context, id + "AC01", definition.variant);
        if (definition.zone == AcidProfileZone.ALL || definition.zone == AcidProfileZone.AC02)
            acidAC02(context, id + "AC02", definition.variant);
        if (definition.zone == AcidProfileZone.ALL || definition.zone == AcidProfileZone.AC03)
            acidAC03(context, id + "AC03", definition.variant);
        if (definition.zone == AcidProfileZone.ALL || definition.zone == AcidProfileZone.AC04)
            acidAC04(context, id + "AC04", definition.variant);
        if (definition.zone == AcidProfileZone.ALL || definition.zone == AcidProfileZone.AC05)
            acidAC05(context, id + "AC05", definition.variant);
        if (definition.zone == AcidProfileZone.ALL || definition.zone == AcidProfileZone.AC07)
            acidAC07(context, id + "AC07", definition.variant);
        if (definition.zone == AcidProfileZone.ALL || definition.zone == AcidProfileZone.AC08)
            acidAC08(context, id + "AC08", definition.variant);
        if (definition.zone == AcidProfileZone.ALL || definition.zone == AcidProfileZone.AC09)
            acidAC09(context, id + "AC09", definition.variant);
    });
