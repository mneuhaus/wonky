FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Precision cells AC39..AC48. All primitive operands share one local frame;
// sketch profiles are defined on that same frame before extruding/revolving.
export enum AcidVariant
{
    annotation { "Name" : "V0 identity" } V0,
    annotation { "Name" : "V1 translation" } V1,
    annotation { "Name" : "V2 exact quarter turns" } V2,
    annotation { "Name" : "V3 skew rotation" } V3
}

// An isolated cell permits a failed zone to be scored without concealing the others.
export enum AcidPrecisionZone
{
    annotation { "Name" : "All cells" } ALL,
    annotation { "Name" : "AC39" } AC39,
    annotation { "Name" : "AC40" } AC40,
    annotation { "Name" : "AC41" } AC41,
    annotation { "Name" : "AC42" } AC42,
    annotation { "Name" : "AC43" } AC43,
    annotation { "Name" : "AC44" } AC44,
    annotation { "Name" : "AC45" } AC45,
    annotation { "Name" : "AC46" } AC46,
    annotation { "Name" : "AC47" } AC47,
    annotation { "Name" : "AC48" } AC48
}

function acidVariantName(variant is AcidVariant) returns string
{
    if (variant == AcidVariant.V1) return "V1";
    if (variant == AcidVariant.V2) return "V2";
    if (variant == AcidVariant.V3) return "V3";
    return "V0";
}

function acidSelected(selected is AcidPrecisionZone, candidate is AcidPrecisionZone) returns boolean
{
    return selected == AcidPrecisionZone.ALL || selected == candidate;
}

// V3 is a rotation through a LOCAL pivot, followed by the cell translation.
// For V2 the signed basis is used directly: no sin/cos(90 deg) roundoff.
function acidFrame(cell is Vector, variant is AcidVariant) returns CoordSystem
{
    if (variant == AcidVariant.V1)
        return coordSystem(cell + vector(65536.25, -32768.5, 16384.125) * millimeter,
                           vector(1, 0, 0), vector(0, 0, 1));
    if (variant == AcidVariant.V2)
        return coordSystem(cell, vector(0, 0, 1), vector(0, -1, 0));
    if (variant == AcidVariant.V3)
    {
        const rotation = rotationAround(line(vector(3, -2, 5) * millimeter, vector(1, 2, 3)), 0.1 * radian);
        const rotatedOrigin = rotation * (vector(0, 0, 0) * millimeter);
        // Multiplication by the rotation's linear part maps directions without
        // adding its pivot-dependent translation to them.
        return coordSystem(cell + rotatedOrigin,
                           rotation.linear * vector(1, 0, 0), rotation.linear * vector(0, 0, 1));
    }
    return coordSystem(cell, vector(1, 0, 0), vector(0, 0, 1));
}

function acidBox(context is Context, boxId is Id, lo is Vector, hi is Vector) returns Query
{
    fCuboid(context, boxId, { "corner1" : lo, "corner2" : hi });
    return qCreatedBy(boxId, EntityType.BODY);
}

function acidCylinder(context is Context, cylinderId is Id, bottom is Vector, top is Vector,
                      radius is ValueWithUnits) returns Query
{
    fCylinder(context, cylinderId, { "bottomCenter" : bottom, "topCenter" : top, "radius" : radius });
    return qCreatedBy(cylinderId, EntityType.BODY);
}

function acidPair(context is Context, zoneId is Id, first is Query, second is Query,
                  frame is CoordSystem, operation is BooleanOperationType) returns Query
{
    // Transform the two primitives together, once, BEFORE evaluating contact.
    opTransform(context, zoneId + "world", { "bodies" : qUnion([first, second]),
        "transform" : toWorld(frame) });
    if (operation == BooleanOperationType.SUBTRACTION)
        opBoolean(context, zoneId + "boolean", { "targets" : first, "tools" : second,
            "operationType" : operation });
    else
        opBoolean(context, zoneId + "boolean", { "tools" : qUnion([first, second]),
            "operationType" : operation });
    if (operation == BooleanOperationType.SUBTRACTION)
        return qUnion([first, qCreatedBy(zoneId + "boolean", EntityType.BODY)]);
    return qUnion([first, second, qCreatedBy(zoneId + "boolean", EntityType.BODY)]);
}

function acidLabel(context is Context, bodies is Query, zone is string, variant is string)
{
    const solids = evaluateQuery(context, qBodyType(bodies, BodyType.SOLID));
    for (var i = 0; i < size(solids); i += 1)
    {
        setProperty(context, { "entities" : solids[i], "propertyType" : PropertyType.NAME,
            "value" : zone ~ "_" ~ i ~ "_" ~ variant });
        setProperty(context, { "entities" : solids[i], "propertyType" : PropertyType.DESCRIPTION,
            "value" : "acid=" ~ zone ~ "@" ~ variant });
    }
}

function acidBoxPair(context is Context, zoneId is Id, zone is string, variantName is string,
                     frame is CoordSystem, a0 is Vector, a1 is Vector, b0 is Vector, b1 is Vector,
                     operation is BooleanOperationType)
{
    const a = acidBox(context, zoneId + "a", a0, a1);
    const b = acidBox(context, zoneId + "b", b0, b1);
    acidLabel(context, acidPair(context, zoneId, a, b, frame, operation), zone, variantName);
}

annotation { "Feature Type Name" : "CAD acid precision" }
export const acidPrecision = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Variant", "Default" : AcidVariant.V0 }
        definition.variant is AcidVariant;
        annotation { "Name" : "Zone", "Default" : AcidPrecisionZone.ALL }
        definition.zone is AcidPrecisionZone;
    }
    {
        const v = acidVariantName(definition.variant);
        if (acidSelected(definition.zone, AcidPrecisionZone.AC39))
            acidBoxPair(context, id + "AC39", "AC39", v,
                acidFrame(vector(0, 1000, 0) * millimeter, definition.variant),
                vector(0, 0, 0) * millimeter, vector(8, 4, 4) * millimeter,
                vector(8 + 0.000000000931322574615478515625, 0, 0) * millimeter,
                vector(16, 4, 4) * millimeter, BooleanOperationType.UNION);
        if (acidSelected(definition.zone, AcidPrecisionZone.AC40))
            acidBoxPair(context, id + "AC40", "AC40", v,
                acidFrame(vector(250, 1000, 0) * millimeter, definition.variant),
                vector(0, 0, 0) * millimeter, vector(8, 4, 4) * millimeter,
                vector(8 + 0.0009765625, 0, 0) * millimeter,
                vector(16, 4, 4) * millimeter, BooleanOperationType.UNION);
        if (acidSelected(definition.zone, AcidPrecisionZone.AC41))
            acidBoxPair(context, id + "AC41", "AC41", v,
                acidFrame(vector(500, 1000, 0) * millimeter, definition.variant),
                vector(0, 0, 0) * millimeter, vector(8, 4, 4) * millimeter,
                vector(8 - 0.000000000931322574615478515625, 0, 0) * millimeter,
                vector(16, 4, 4) * millimeter, BooleanOperationType.INTERSECTION);
        if (acidSelected(definition.zone, AcidPrecisionZone.AC42))
            acidBoxPair(context, id + "AC42", "AC42", v,
                acidFrame(vector(750, 1000, 0) * millimeter, definition.variant),
                vector(0, 0, 0) * millimeter, vector(0.1 + 8.2, 4, 4) * millimeter,
                vector(8.3, 0, 0) * millimeter, vector(16, 4, 4) * millimeter,
                BooleanOperationType.UNION);
        if (acidSelected(definition.zone, AcidPrecisionZone.AC43))
            acidBoxPair(context, id + "AC43", "AC43", v,
                acidFrame(vector(1000, 1000, 0) * millimeter, definition.variant),
                vector(0, 0, 0) * millimeter, vector(1.68 + 10.1, 4, 4) * millimeter,
                vector(11.78, 0, 0) * millimeter, vector(16, 4, 4) * millimeter,
                BooleanOperationType.UNION);
        if (acidSelected(definition.zone, AcidPrecisionZone.AC44))
        {
            const zoneId = id + "AC44";
            const a = acidCylinder(context, zoneId + "a", vector(0, 0, 0) * millimeter,
                vector(0, 0, 16) * millimeter, 4 * millimeter);
            const b = acidCylinder(context, zoneId + "b",
                vector(8 + 0.000000000931322574615478515625, 0, 0) * millimeter,
                vector(8 + 0.000000000931322574615478515625, 0, 16) * millimeter, 4 * millimeter);
            acidLabel(context, acidPair(context, zoneId, a, b,
                acidFrame(vector(1250, 1000, 0) * millimeter, definition.variant),
                BooleanOperationType.UNION), "AC44", v);
        }
        if (acidSelected(definition.zone, AcidPrecisionZone.AC45))
        {
            const zoneId = id + "AC45";
            const frame = acidFrame(vector(1500, 1000, 0) * millimeter, definition.variant);
            var sketch = newSketchOnPlane(context, zoneId + "sketch",
                { "sketchPlane" : plane(frame.origin, frame.zAxis, frame.xAxis) });
            skLineSegment(sketch, "s0", { "start" : vector(0, 0) * millimeter,
                "end" : vector(16, 0) * millimeter });
            skLineSegment(sketch, "s1", { "start" : vector(16, 0) * millimeter,
                "end" : vector(16, 8) * millimeter });
            skLineSegment(sketch, "s2", { "start" : vector(16, 8) * millimeter,
                "end" : vector(0, 8) * millimeter });
            skLineSegment(sketch, "s3", { "start" : vector(0, 8) * millimeter,
                "end" : vector(0, 0.000000000931322574615478515625) * millimeter });
            skSolve(sketch);
            opExtrude(context, zoneId + "extrude", { "entities" : qSketchRegion(zoneId + "sketch", false),
                "direction" : frame.zAxis, "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
            opDeleteBodies(context, zoneId + "sketchClean", { "entities" : qCreatedBy(zoneId + "sketch", EntityType.BODY) });
            acidLabel(context, qCreatedBy(zoneId + "extrude", EntityType.BODY), "AC45", v);
        }
        if (acidSelected(definition.zone, AcidPrecisionZone.AC46))
            acidBoxPair(context, id + "AC46", "AC46", v,
                acidFrame(vector(0, 1500, 0) * millimeter, definition.variant),
                vector(131072, 0, 0) * millimeter, vector(131088, 16, 4) * millimeter,
                vector(131072 + 8 - 0.001953125, 4, -1) * millimeter,
                vector(131072 + 8 + 0.001953125, 12, 5) * millimeter,
                BooleanOperationType.SUBTRACTION);
        if (acidSelected(definition.zone, AcidPrecisionZone.AC47))
        {
            const zoneId = id + "AC47";
            const a = acidBox(context, zoneId + "a", vector(0, 0, 0) * millimeter,
                vector(64, 64, 8) * millimeter);
            const b = acidCylinder(context, zoneId + "b", vector(32, 32, -1) * millimeter,
                vector(32, 32, 9) * millimeter, 0.00390625 * millimeter);
            acidLabel(context, acidPair(context, zoneId, a, b,
                acidFrame(vector(2000, 1000, 0) * millimeter, definition.variant),
                BooleanOperationType.SUBTRACTION), "AC47", v);
        }
        if (acidSelected(definition.zone, AcidPrecisionZone.AC48))
        {
            const zoneId = id + "AC48";
            const frame = acidFrame(vector(2250, 1000, 0) * millimeter, definition.variant);
            // x = local X, sketch y = local Z, normal = -local Y.
            var sketch = newSketchOnPlane(context, zoneId + "sketch",
                { "sketchPlane" : plane(frame.origin, -cross(frame.zAxis, frame.xAxis), frame.xAxis) });
            skCircle(sketch, "profile", { "center" : vector(4, 0) * millimeter,
                "radius" : 4 * millimeter });
            skSolve(sketch);
            opRevolve(context, zoneId + "revolve", { "entities" : qSketchRegion(zoneId + "sketch", false),
                "axis" : line(frame.origin, frame.zAxis), "angleForward" : 360 * degree });
            opDeleteBodies(context, zoneId + "sketchClean", { "entities" : qCreatedBy(zoneId + "sketch", EntityType.BODY) });
            acidLabel(context, qCreatedBy(zoneId + "revolve", EntityType.BODY), "AC48", v);
        }
    });
