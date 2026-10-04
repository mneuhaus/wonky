FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// AC29–AC38: each zone is constructed in its own frame; the frame is applied
// to operands, sketch planes, queries and draft directions before the tested op.
export enum AcidVariant
{
    annotation { "Name" : "V0" } V0,
    annotation { "Name" : "V1" } V1,
    annotation { "Name" : "V2" } V2,
    annotation { "Name" : "V3" } V3
}
export enum AcidBlendZone
{
    annotation { "Name" : "ALL" } ALL,
    annotation { "Name" : "AC29" } AC29,
    annotation { "Name" : "AC30" } AC30,
    annotation { "Name" : "AC31" } AC31,
    annotation { "Name" : "AC32" } AC32,
    annotation { "Name" : "AC33" } AC33,
    annotation { "Name" : "AC34" } AC34,
    annotation { "Name" : "AC35" } AC35,
    annotation { "Name" : "AC36" } AC36,
    annotation { "Name" : "AC37" } AC37,
    annotation { "Name" : "AC38" } AC38
}

function acidFrame(column is number, variant is AcidVariant) returns CoordSystem
{
    const cell = vector(250 * column, 750, 0) * millimeter;
    if (variant == AcidVariant.V0)
        return coordSystem(cell, vector(1, 0, 0), vector(0, 0, 1));
    if (variant == AcidVariant.V1)
        return coordSystem(cell + vector(65536.25, -32768.5, 16384.125) * millimeter,
                           vector(1, 0, 0), vector(0, 0, 1));
    if (variant == AcidVariant.V2)
        return coordSystem(cell, vector(0, 0, 1), vector(0, -1, 0));
    const turn = rotationAround(line(vector(3, -2, 5) * millimeter, vector(1, 2, 3)), 0.1 * radian);
    return coordSystem(cell + turn * (vector(0, 0, 0) * millimeter),
                       turn.linear * vector(1, 0, 0), turn.linear * vector(0, 0, 1));
}
function acidPoint(cs is CoordSystem, x is number, y is number, z is number) returns Vector
{
    return toWorld(cs, vector(x, y, z) * millimeter);
}
function acidDirection(cs is CoordSystem, x is number, y is number, z is number) returns Vector
{
    // Translation must never be applied to a direction.
    return toWorld(cs).linear * vector(x, y, z);
}
function acidPlane(cs is CoordSystem, x is number, y is number, z is number) returns Plane
{
    return plane(acidPoint(cs, x, y, z), acidDirection(cs, 0, 0, 1), acidDirection(cs, 1, 0, 0));
}
function acidBox(context is Context, id is Id, cs is CoordSystem, lo is Vector, hi is Vector) returns Query
{
    fCuboid(context, id + "solid", { "corner1" : lo * millimeter, "corner2" : hi * millimeter });
    const body = qCreatedBy(id + "solid", EntityType.BODY);
    opTransform(context, id + "pose", { "bodies" : body, "transform" : toWorld(cs) });
    return body;
}
function acidCylinder(context is Context, id is Id, cs is CoordSystem, lo is Vector, hi is Vector,
                      radius is ValueWithUnits) returns Query
{
    fCylinder(context, id + "solid", { "bottomCenter" : lo * millimeter,
        "topCenter" : hi * millimeter, "radius" : radius });
    const body = qCreatedBy(id + "solid", EntityType.BODY);
    opTransform(context, id + "pose", { "bodies" : body, "transform" : toWorld(cs) });
    return body;
}
function acidEdge(body is Query, point is Vector) returns Query
{
    return qClosestTo(qOwnedByBody(body, EntityType.EDGE), point);
}
function acidLabel(context is Context, body is Query, zone is string, variant is AcidVariant)
{
    var v = "V0";
    if (variant == AcidVariant.V1) v = "V1";
    else if (variant == AcidVariant.V2) v = "V2";
    else if (variant == AcidVariant.V3) v = "V3";
    setProperty(context, { "entities" : body, "propertyType" : PropertyType.NAME,
        "value" : zone ~ "_0_" ~ v });
    setProperty(context, { "entities" : body, "propertyType" : PropertyType.DESCRIPTION,
        "value" : "acid=" ~ zone ~ "@" ~ v });
}

function acidAC29(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(0, variant);
    const body = acidBox(context, id, cs, vector(0, 0, 0), vector(16, 12, 8));
    opFillet(context, id + "blend", { "entities" : acidEdge(body, acidPoint(cs, 16, 12, 4)),
        "radius" : 4 * millimeter });
    acidLabel(context, body, "AC29", variant);
}
function acidAC30(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(1, variant);
    const body = acidBox(context, id, cs, vector(0, 0, 0), vector(16, 16, 16));
    opFillet(context, id + "first", { "entities" : acidEdge(body, acidPoint(cs, 0, 0, 8)),
        "radius" : 4 * millimeter });
    opFillet(context, id + "second", { "entities" : acidEdge(body, acidPoint(cs, 16, 0, 8)),
        "radius" : 12 * millimeter });
    acidLabel(context, body, "AC30", variant);
}
function acidAC31(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(2, variant);
    const body = acidBox(context, id, cs, vector(0, 0, 0), vector(16, 16, 2));
    // Infeasible rolling ball: centre at local y=4, z=-2 lies below the plate.
    opFillet(context, id + "infeasible", { "entities" : acidEdge(body, acidPoint(cs, 8, 0, 2)),
        "radius" : 4 * millimeter });
    acidLabel(context, body, "AC31", variant);
}
function acidAC32(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(3, variant);
    var sketch = newSketchOnPlane(context, id + "sketch", { "sketchPlane" : acidPlane(cs, 0, 0, 0) });
    skLineSegment(sketch, "bottom", { "start" : vector(4, 0) * millimeter, "end" : vector(12, 0) * millimeter });
    skArc(sketch, "right", { "start" : vector(12, 0) * millimeter, "mid" : vector(16, 4) * millimeter,
        "end" : vector(12, 8) * millimeter });
    skLineSegment(sketch, "top", { "start" : vector(12, 8) * millimeter, "end" : vector(4, 8) * millimeter });
    skArc(sketch, "left", { "start" : vector(4, 8) * millimeter, "mid" : vector(0, 4) * millimeter,
        "end" : vector(4, 0) * millimeter });
    skSolve(sketch);
    opExtrude(context, id + "prism", { "entities" : qSketchRegion(id + "sketch", false),
        "direction" : acidDirection(cs, 0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "sketch", EntityType.BODY) });
    const body = qCreatedBy(id + "prism", EntityType.BODY);
    // Select the entire top loop, including both semicircular edges.
    const rim = qCoincidesWithPlane(qOwnedByBody(body, EntityType.EDGE), acidPlane(cs, 0, 0, 6));
    opFillet(context, id + "rim", { "entities" : rim, "radius" : 1 * millimeter });
    acidLabel(context, body, "AC32", variant);
}
function acidAC33(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(4, variant);
    var sketch = newSketchOnPlane(context, id + "sketch", { "sketchPlane" : acidPlane(cs, 0, 0, 0) });
    skCircle(sketch, "circle", { "center" : vector(0, 0) * millimeter, "radius" : 8 * millimeter });
    skSolve(sketch);
    opExtrude(context, id + "post", { "entities" : qSketchRegion(id + "sketch", false),
        "direction" : acidDirection(cs, 0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 8 * millimeter });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "sketch", EntityType.BODY) });
    const body = qCreatedBy(id + "post", EntityType.BODY);
    opChamfer(context, id + "rim", { "entities" : acidEdge(body, acidPoint(cs, 8, 0, 8)),
        "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 2 * millimeter });
    acidLabel(context, body, "AC33", variant);
}
function acidAC34(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(5, variant);
    const body = acidBox(context, id, cs, vector(0, 0, 0), vector(16, 16, 16));
    const edges = qUnion([acidEdge(body, acidPoint(cs, 8, 0, 0)),
        acidEdge(body, acidPoint(cs, 0, 8, 0)),
        acidEdge(body, acidPoint(cs, 0, 0, 8))]);
    opFillet(context, id + "corner", { "entities" : edges, "radius" : 4 * millimeter });
    acidLabel(context, body, "AC34", variant);
}
function acidAC35(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(6, variant);
    const body = acidBox(context, id, cs, vector(0, 0, 0), vector(16, 12, 8));
    const edge = acidEdge(body, acidPoint(cs, 16, 12, 4));
    const vertices = qOwnedByBody(body, EntityType.VERTEX);
    opFillet(context, id + "variable", { "entities" : edge, "radius" : 2 * millimeter,
        "isVariable" : true, "smoothTransition" : false,
        "vertexSettings" : [
            { "vertex" : qClosestTo(vertices, acidPoint(cs, 16, 12, 0)), "vertexRadius" : 2 * millimeter },
            { "vertex" : qClosestTo(vertices, acidPoint(cs, 16, 12, 8)), "vertexRadius" : 4 * millimeter }
        ] });
    acidLabel(context, body, "AC35", variant);
}
function acidAC36(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(7, variant);
    const post = acidCylinder(context, id + "post", cs, vector(0, 0, -12), vector(0, 0, 12), 8 * millimeter);
    const branch = acidCylinder(context, id + "branch", cs, vector(0, 0, 0), vector(16, 0, 0), 4 * millimeter);
    opBoolean(context, id + "union", { "tools" : qUnion([post, branch]),
        "operationType" : BooleanOperationType.UNION });
    const body = qUnion([post, branch, qCreatedBy(id + "union", EntityType.BODY)]);
    opFillet(context, id + "junction", { "entities" : acidEdge(body,
        acidPoint(cs, sqrt(48), 4, 0)), "radius" : 1 * millimeter,
        "tangentPropagation" : true });
    acidLabel(context, body, "AC36", variant);
}
function acidAC37(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(8, variant);
    const body = acidBox(context, id, cs, vector(0, 0, 0), vector(16, 16, 8));
    const top = qClosestTo(qOwnedByBody(body, EntityType.FACE), acidPoint(cs, 8, 8, 8));
    opShell(context, id + "shell", { "entities" : top, "thickness" : -2 * millimeter });
    acidLabel(context, body, "AC37", variant);
}
function acidAC38(context is Context, id is Id, variant is AcidVariant)
{
    const cs = acidFrame(9, variant);
    const body = acidBox(context, id, cs, vector(0, 0, 0), vector(16, 16, 8));
    const face = qClosestTo(qOwnedByBody(body, EntityType.FACE), acidPoint(cs, 16, 8, 4));
    opDraft(context, id + "draft", { "draftType" : DraftType.REFERENCE_SURFACE,
        "draftFaces" : face, "referenceSurface" : acidPlane(cs, 0, 0, 0),
        "pullVec" : acidDirection(cs, 0, 0, 1), "angle" : atan(0.125) });
    acidLabel(context, body, "AC38", variant);
}

annotation { "Feature Type Name" : "CAD acid: blends" }
export const acidBlend = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Variant", "Default" : AcidVariant.V0 }
        definition.variant is AcidVariant;
        annotation { "Name" : "Zone", "Default" : AcidBlendZone.ALL }
        definition.zone is AcidBlendZone;
    }
    {
        if (definition.zone == AcidBlendZone.ALL || definition.zone == AcidBlendZone.AC29) acidAC29(context, id + "AC29", definition.variant);
        if (definition.zone == AcidBlendZone.ALL || definition.zone == AcidBlendZone.AC30) acidAC30(context, id + "AC30", definition.variant);
        if (definition.zone == AcidBlendZone.ALL || definition.zone == AcidBlendZone.AC31) acidAC31(context, id + "AC31", definition.variant);
        if (definition.zone == AcidBlendZone.ALL || definition.zone == AcidBlendZone.AC32) acidAC32(context, id + "AC32", definition.variant);
        if (definition.zone == AcidBlendZone.ALL || definition.zone == AcidBlendZone.AC33) acidAC33(context, id + "AC33", definition.variant);
        if (definition.zone == AcidBlendZone.ALL || definition.zone == AcidBlendZone.AC34) acidAC34(context, id + "AC34", definition.variant);
        if (definition.zone == AcidBlendZone.ALL || definition.zone == AcidBlendZone.AC35) acidAC35(context, id + "AC35", definition.variant);
        if (definition.zone == AcidBlendZone.ALL || definition.zone == AcidBlendZone.AC36) acidAC36(context, id + "AC36", definition.variant);
        if (definition.zone == AcidBlendZone.ALL || definition.zone == AcidBlendZone.AC37) acidAC37(context, id + "AC37", definition.variant);
        if (definition.zone == AcidBlendZone.ALL || definition.zone == AcidBlendZone.AC38) acidAC38(context, id + "AC38", definition.variant);
    });
