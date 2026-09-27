FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Reflex-corner setback probe (wonky-kernel fillet-setback, 25 September 2026;
// provenance in reflex-setback-reference.json). The shape of R20 edge.fs:807:
// a plate 30 wide (x -15..15, y -4..0, z 0..30) and a narrower backer 20 wide
// (x -10..10, y -1..10, z 0..15, 1 mm union overlap), unioned. The concave
// seam between the backer top (z 15) and the plate's front face (y 0) runs
// x -10..10 and ends at (+-10, 0, 15), where the plate's front face has a
// reflex (270 degree) corner around the backer.
// `chamfer` false: opFillet R2 on the seam; true: opChamfer EQUAL_OFFSETS 2.
// `dx` shifts the whole case along x (both cases in one Onshape Part Studio).

export function reflexInput(context is Context, id is Id, dx is ValueWithUnits)
{
    const s = vector(1, 0, 0) * dx;
    fCuboid(context, id + "plate", { "corner1" : vector(-15, -4, 0) * millimeter + s, "corner2" : vector(15, 0, 30) * millimeter + s });
    fCuboid(context, id + "backer", { "corner1" : vector(-10, -1, 0) * millimeter + s, "corner2" : vector(10, 10, 15) * millimeter + s });
    opBoolean(context, id + "join", { "tools" : qUnion([qCreatedBy(id + "plate", EntityType.BODY), qCreatedBy(id + "backer", EntityType.BODY)]),
        "operationType" : BooleanOperationType.UNION });
    return qUnion([qCreatedBy(id + "plate", EntityType.BODY), qCreatedBy(id + "backer", EntityType.BODY)]);
}

annotation { "Feature Type Name" : "Reflex setback probe" }
export const reflexSetbackProbe = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Chamfer", "Default" : false }
        definition.chamfer is boolean;
        annotation { "Name" : "Shift" }
        isLength(definition.dx, ZERO_DEFAULT_LENGTH_BOUNDS);
    }
    {
        const body = reflexInput(context, id + "in", definition.dx);
        if (size(evaluateQuery(context, body)) != 1)
            throw regenError("probe harness: input is not one body");
        const inputVolume = evVolume(context, { "entities" : body }) / (millimeter ^ 3);
        const seam = qContainsPoint(qOwnedByBody(body, EntityType.EDGE), vector(definition.dx / millimeter, 0, 15) * millimeter);
        if (size(evaluateQuery(context, seam)) != 1)
            throw regenError("probe harness: seam edge not unique");
        if (definition.chamfer)
            opChamfer(context, id + "blend", { "entities" : seam, "chamferType" : ChamferType.EQUAL_OFFSETS, "width" : 2 * millimeter });
        else
            opFillet(context, id + "blend", { "entities" : seam, "radius" : 2 * millimeter });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.NAME,
            "value" : definition.chamfer ? "RS-C reflex seam chamfer 2" : "RS-F reflex seam fillet R2" });
        setProperty(context, { "entities" : body, "propertyType" : PropertyType.DESCRIPTION,
            "value" : "input_volume_mm3=" ~ inputVolume });
    });
