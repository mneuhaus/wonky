// Functions-only fragment (no FeatureScript header), as in the fsocct convention.
export function pin(context is Context, id is Id, diameter is ValueWithUnits, depth is ValueWithUnits) returns Query
{
    fCuboid(context, id, {"corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(diameter, diameter, depth)});
    return qCreatedBy(id, EntityType.BODY);
}
