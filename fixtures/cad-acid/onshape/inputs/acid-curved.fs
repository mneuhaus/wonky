FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Curved acid zones: all operands are authored in local millimetres; their
// shared frame is applied once before each Boolean. No finished solid is moved.
export enum AcidVariant
{
    annotation { "Name" : "V0" } V0,
    annotation { "Name" : "V1" } V1,
    annotation { "Name" : "V2" } V2,
    annotation { "Name" : "V3" } V3
}

export enum AcidCurvedZone
{
    annotation { "Name" : "ALL" } ALL,
    annotation { "Name" : "AC19" } AC19,
    annotation { "Name" : "AC20" } AC20,
    annotation { "Name" : "AC21" } AC21,
    annotation { "Name" : "AC22" } AC22,
    annotation { "Name" : "AC23" } AC23,
    annotation { "Name" : "AC24" } AC24,
    annotation { "Name" : "AC25" } AC25,
    annotation { "Name" : "AC26" } AC26,
    annotation { "Name" : "AC27" } AC27,
    annotation { "Name" : "AC28" } AC28
}

function acidVariantName(variant is AcidVariant) returns string
{
    if (variant == AcidVariant.V0) return "V0";
    if (variant == AcidVariant.V1) return "V1";
    if (variant == AcidVariant.V2) return "V2";
    return "V3";
}

// column 0..9, curved group row 2. The pivot of V3 is local to each cell.
function acidFrame(variant is AcidVariant, column is number) returns CoordSystem
{
    const cell = vector(250 * column, 500, 0) * millimeter;
    if (variant == AcidVariant.V0)
        return coordSystem(cell, vector(1, 0, 0), vector(0, 0, 1));
    if (variant == AcidVariant.V1)
        return coordSystem(cell + vector(65536.25, -32768.5, 16384.125) * millimeter,
                           vector(1, 0, 0), vector(0, 0, 1));
    if (variant == AcidVariant.V2)
        return coordSystem(cell, vector(0, 0, 1), vector(0, -1, 0));
    const turn = rotationAround(line(vector(3, -2, 5) * millimeter, vector(1, 2, 3)), 0.1 * radian);
    const zero = turn * (vector(0, 0, 0) * millimeter);
    const xAxis = (turn * (vector(1, 0, 0) * millimeter) - zero) / millimeter;
    const zAxis = (turn * (vector(0, 0, 1) * millimeter) - zero) / millimeter;
    return coordSystem(cell + zero, xAxis, zAxis);
}

function acidCylinder(context is Context, id is Id, bottom is Vector, top is Vector, radius is ValueWithUnits)
{
    fCylinder(context, id, { "bottomCenter" : bottom, "topCenter" : top, "radius" : radius });
}

function acidSphere(context is Context, id is Id, center is Vector, radius is ValueWithUnits)
{
    opSphere(context, id, { "center" : center, "radius" : radius });
}

function acidBox(context is Context, id is Id, lo is Vector, hi is Vector)
{
    fCuboid(context, id, { "corner1" : lo, "corner2" : hi });
}

function acidPlaceOperands(context is Context, id is Id, frame is CoordSystem, operands is Query)
{
    opTransform(context, id, { "bodies" : operands, "transform" : toWorld(frame) });
}

function acidBoolean(context is Context, id is Id, a is Query, b is Query, operation is BooleanOperationType)
{
    if (operation == BooleanOperationType.SUBTRACTION)
        opBoolean(context, id, { "targets" : a, "tools" : b, "operationType" : operation });
    else
        opBoolean(context, id, { "tools" : qUnion([a, b]), "operationType" : operation });
}

function acidLabel(context is Context, body is Query, zone is string, index is number, variant is AcidVariant)
{
    setProperty(context, { "entities" : body, "propertyType" : PropertyType.NAME,
                           "value" : zone ~ "_" ~ index ~ "_" ~ acidVariantName(variant) });
    setProperty(context, { "entities" : body, "propertyType" : PropertyType.DESCRIPTION,
                           "value" : "acid=" ~ zone ~ "@" ~ acidVariantName(variant) });
}

// Boolean result may retain either operand's body identity; the union of all
// three creation queries resolves the survivor without introducing a new body.
function acidResult(a is Query, b is Query, result is Query) returns Query
{
    return qUnion([a, b, result]);
}

function acidAC19(context is Context, id is Id, cs is CoordSystem, variant is AcidVariant)
{
    acidCylinder(context, id + "a", vector(-12, 0, 0) * millimeter, vector(12, 0, 0) * millimeter, 8 * millimeter);
    acidCylinder(context, id + "b", vector(0, -12, 0) * millimeter, vector(0, 12, 0) * millimeter, 8 * millimeter);
    const a = qCreatedBy(id + "a", EntityType.BODY);
    const b = qCreatedBy(id + "b", EntityType.BODY);
    acidPlaceOperands(context, id + "place", cs, qUnion([a, b]));
    acidBoolean(context, id + "boolean", a, b, BooleanOperationType.INTERSECTION);
    acidLabel(context, acidResult(a, b, qCreatedBy(id + "boolean", EntityType.BODY)), "AC19", 0, variant);
}

function acidAC20(context is Context, id is Id, cs is CoordSystem, variant is AcidVariant)
{
    acidCylinder(context, id + "a", vector(0, 0, -12) * millimeter, vector(0, 0, 12) * millimeter, 8 * millimeter);
    acidCylinder(context, id + "b", vector(0, 0, 0) * millimeter, vector(16, 0, 0) * millimeter, 4 * millimeter);
    const a = qCreatedBy(id + "a", EntityType.BODY);
    const b = qCreatedBy(id + "b", EntityType.BODY);
    acidPlaceOperands(context, id + "place", cs, qUnion([a, b]));
    acidBoolean(context, id + "boolean", a, b, BooleanOperationType.UNION);
    acidLabel(context, acidResult(a, b, qCreatedBy(id + "boolean", EntityType.BODY)), "AC20", 0, variant);
}

function acidAC21(context is Context, id is Id, cs is CoordSystem, variant is AcidVariant)
{
    acidCylinder(context, id + "a", vector(0, 0, 0) * millimeter, vector(0, 0, 8) * millimeter, 4 * millimeter);
    acidCylinder(context, id + "b", vector(0, 0, 8) * millimeter, vector(0, 0, 16) * millimeter, 4 * millimeter);
    const a = qCreatedBy(id + "a", EntityType.BODY);
    const b = qCreatedBy(id + "b", EntityType.BODY);
    acidPlaceOperands(context, id + "place", cs, qUnion([a, b]));
    acidBoolean(context, id + "boolean", a, b, BooleanOperationType.UNION);
    acidLabel(context, acidResult(a, b, qCreatedBy(id + "boolean", EntityType.BODY)), "AC21", 0, variant);
}

function acidAC22(context is Context, id is Id, cs is CoordSystem, variant is AcidVariant)
{
    acidCylinder(context, id + "a", vector(0, 0, 0) * millimeter, vector(0, 0, 16) * millimeter, 4 * millimeter);
    acidCylinder(context, id + "b", vector(8, 0, 0) * millimeter, vector(8, 0, 16) * millimeter, 4 * millimeter);
    const a = qCreatedBy(id + "a", EntityType.BODY);
    const b = qCreatedBy(id + "b", EntityType.BODY);
    acidPlaceOperands(context, id + "place", cs, qUnion([a, b]));
    acidBoolean(context, id + "boolean", a, b, BooleanOperationType.UNION);
    // An Onshape non-manifold Boolean failure is accepted by the catalog;
    // a successful operation must instead retain two separate solids. Label the
    // post-Boolean survivors (either operand or a new body), one index per body,
    // so a silent merge into one body is labelled once and not twice.
    const parts = evaluateQuery(context, acidResult(a, b, qCreatedBy(id + "boolean", EntityType.BODY)));
    for (var i = 0; i < size(parts); i += 1)
        acidLabel(context, parts[i], "AC22", i, variant);
}

function acidAC23(context is Context, id is Id, cs is CoordSystem, variant is AcidVariant)
{
    acidBox(context, id + "a", vector(0, 0, 0) * millimeter, vector(16, 16, 8) * millimeter);
    acidCylinder(context, id + "b", vector(8, -4, -2) * millimeter, vector(8, -4, 10) * millimeter, 4 * millimeter);
    const a = qCreatedBy(id + "a", EntityType.BODY);
    const b = qCreatedBy(id + "b", EntityType.BODY);
    acidPlaceOperands(context, id + "place", cs, qUnion([a, b]));
    acidBoolean(context, id + "boolean", a, b, BooleanOperationType.SUBTRACTION);
    acidLabel(context, acidResult(a, b, qCreatedBy(id + "boolean", EntityType.BODY)), "AC23", 0, variant);
}

function acidAC24(context is Context, id is Id, cs is CoordSystem, variant is AcidVariant)
{
    acidSphere(context, id + "a", vector(0, 0, 0) * millimeter, 8 * millimeter);
    acidBox(context, id + "b", vector(-16, -16, 0) * millimeter, vector(16, 16, 16) * millimeter);
    const a = qCreatedBy(id + "a", EntityType.BODY);
    const b = qCreatedBy(id + "b", EntityType.BODY);
    acidPlaceOperands(context, id + "place", cs, qUnion([a, b]));
    acidBoolean(context, id + "boolean", a, b, BooleanOperationType.INTERSECTION);
    acidLabel(context, acidResult(a, b, qCreatedBy(id + "boolean", EntityType.BODY)), "AC24", 0, variant);
}

function acidAC25(context is Context, id is Id, cs is CoordSystem, variant is AcidVariant)
{
    const sketchId = id + "profile";
    var sk = newSketchOnPlane(context, sketchId,
            { "sketchPlane" : plane(cs.origin, -cross(cs.zAxis, cs.xAxis), cs.xAxis) });
    skLineSegment(sk, "base", { "start" : vector(0, 0) * millimeter, "end" : vector(6, 0) * millimeter });
    skLineSegment(sk, "slope", { "start" : vector(6, 0) * millimeter, "end" : vector(0, 8) * millimeter });
    skLineSegment(sk, "axis", { "start" : vector(0, 8) * millimeter, "end" : vector(0, 0) * millimeter });
    skSolve(sk);
    opRevolve(context, id + "revolve", { "entities" : qSketchRegion(sketchId, false),
        "axis" : line(cs.origin, cs.zAxis), "angleForward" : 360 * degree });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(sketchId, EntityType.BODY) });
    acidLabel(context, qCreatedBy(id + "revolve", EntityType.BODY), "AC25", 0, variant);
}

function acidAC26(context is Context, id is Id, cs is CoordSystem, variant is AcidVariant)
{
    const sketchId = id + "profile";
    var sk = newSketchOnPlane(context, sketchId,
            { "sketchPlane" : plane(cs.origin, -cross(cs.zAxis, cs.xAxis), cs.xAxis) });
    skCircle(sk, "circle", { "center" : vector(8, 0) * millimeter, "radius" : 2 * millimeter });
    skSolve(sk);
    opRevolve(context, id + "revolve", { "entities" : qSketchRegion(sketchId, false),
        "axis" : line(cs.origin, cs.zAxis), "angleForward" : 360 * degree });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(sketchId, EntityType.BODY) });
    acidLabel(context, qCreatedBy(id + "revolve", EntityType.BODY), "AC26", 0, variant);
}

function acidAC27(context is Context, id is Id, cs is CoordSystem, variant is AcidVariant)
{
    acidSphere(context, id + "a", vector(0, 0, 0) * millimeter, 8 * millimeter);
    acidSphere(context, id + "b", vector(8, 0, 0) * millimeter, 8 * millimeter);
    const a = qCreatedBy(id + "a", EntityType.BODY);
    const b = qCreatedBy(id + "b", EntityType.BODY);
    acidPlaceOperands(context, id + "place", cs, qUnion([a, b]));
    acidBoolean(context, id + "boolean", a, b, BooleanOperationType.INTERSECTION);
    acidLabel(context, acidResult(a, b, qCreatedBy(id + "boolean", EntityType.BODY)), "AC27", 0, variant);
}

function acidAC28(context is Context, id is Id, cs is CoordSystem, variant is AcidVariant)
{
    acidSphere(context, id + "a", vector(0, 0, 0) * millimeter, 10 * millimeter);
    acidCylinder(context, id + "b", vector(0, 0, -12) * millimeter, vector(0, 0, 12) * millimeter, 6 * millimeter);
    const a = qCreatedBy(id + "a", EntityType.BODY);
    const b = qCreatedBy(id + "b", EntityType.BODY);
    acidPlaceOperands(context, id + "place", cs, qUnion([a, b]));
    acidBoolean(context, id + "boolean", a, b, BooleanOperationType.SUBTRACTION);
    acidLabel(context, acidResult(a, b, qCreatedBy(id + "boolean", EntityType.BODY)), "AC28", 0, variant);
}

annotation { "Feature Type Name" : "CAD acid: curved surfaces" }
export const acidCurved = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Variant" }
        definition.variant is AcidVariant;
        annotation { "Name" : "Zone" }
        definition.zone is AcidCurvedZone;
    }
    {
        if (definition.zone == AcidCurvedZone.ALL || definition.zone == AcidCurvedZone.AC19)
            acidAC19(context, id + "AC19", acidFrame(definition.variant, 0), definition.variant);
        if (definition.zone == AcidCurvedZone.ALL || definition.zone == AcidCurvedZone.AC20)
            acidAC20(context, id + "AC20", acidFrame(definition.variant, 1), definition.variant);
        if (definition.zone == AcidCurvedZone.ALL || definition.zone == AcidCurvedZone.AC21)
            acidAC21(context, id + "AC21", acidFrame(definition.variant, 2), definition.variant);
        if (definition.zone == AcidCurvedZone.ALL || definition.zone == AcidCurvedZone.AC22)
            acidAC22(context, id + "AC22", acidFrame(definition.variant, 3), definition.variant);
        if (definition.zone == AcidCurvedZone.ALL || definition.zone == AcidCurvedZone.AC23)
            acidAC23(context, id + "AC23", acidFrame(definition.variant, 4), definition.variant);
        if (definition.zone == AcidCurvedZone.ALL || definition.zone == AcidCurvedZone.AC24)
            acidAC24(context, id + "AC24", acidFrame(definition.variant, 5), definition.variant);
        if (definition.zone == AcidCurvedZone.ALL || definition.zone == AcidCurvedZone.AC25)
            acidAC25(context, id + "AC25", acidFrame(definition.variant, 6), definition.variant);
        if (definition.zone == AcidCurvedZone.ALL || definition.zone == AcidCurvedZone.AC26)
            acidAC26(context, id + "AC26", acidFrame(definition.variant, 7), definition.variant);
        if (definition.zone == AcidCurvedZone.ALL || definition.zone == AcidCurvedZone.AC27)
            acidAC27(context, id + "AC27", acidFrame(definition.variant, 8), definition.variant);
        if (definition.zone == AcidCurvedZone.ALL || definition.zone == AcidCurvedZone.AC28)
            acidAC28(context, id + "AC28", acidFrame(definition.variant, 9), definition.variant);
    }, { "variant" : AcidVariant.V0, "zone" : AcidCurvedZone.ALL });
