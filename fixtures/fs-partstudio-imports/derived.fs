FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
import(path : "onshape/std/instantiator.fs", version : "3044.0");
rails::import(path : "111111111111111111111111", version : "222222222222222222222222");
railAlias::import(path : "111111111111111111111111", version : "222222222222222222222222");

annotation { "Feature Type Name" : "Derived rail union" }
export const derivedRailUnion = defineFeature(function(context is Context, id is Id, definition is map)
precondition {}
{
    const loaded = rails::build({});
    const sourceParts = evaluateQuery(loaded, qAllModifiableSolidBodies());
    if (size(sourceParts) != 2)
        throw regenError("Expected both source rails");
    // Transient queries remain owned by the source context, including through
    // a namespace alias. Auto0 and the default part selection follow std.
    var inst = newInstantiator(id + "imported");
    const copied = addInstance(inst, railAlias::build, {
        "loadedContext" : loaded,
        "transform" : transform(vector(8, 0, 0) * millimeter)
    });
    instantiate(context, inst);
    if (size(evaluateQuery(context, copied)) != 2 ||
        size(evaluateQuery(context, qCreatedBy(id + "imported", EntityType.BODY))) != 2)
        throw regenError("Both instance and instantiator must own their copies");
    var railQuery = qUnion([]);
    for (var part in evaluateQuery(context, copied))
    {
        if (getProperty(context, { "entity" : part, "propertyType" : PropertyType.NAME }) == "rail")
            railQuery = part;
    }
    fCuboid(context, id + "local", {
        "corner1" : vector(4, 0, 0) * millimeter,
        "corner2" : vector(12, 4, 4) * millimeter
    });
    opBoolean(context, id + "joined", {
        "tools" : qUnion([qCreatedBy(id + "local", EntityType.BODY), railQuery]),
        "operationType" : BooleanOperationType.UNION
    });
    // Derivation never moves, consumes or changes the source bodies.
    if (size(evaluateQuery(loaded, qAllModifiableSolidBodies())) != 2 ||
        abs(evVolume(loaded, { "entities" : qAllModifiableSolidBodies() }) /
            (millimeter ^ 3) - 256) > 0.000000001)
        throw regenError("Derivation modified the source Part Studio");
    if (getProperty(loaded, { "entity" : sourceParts[0], "propertyType" : PropertyType.NAME }) != "rail")
        throw regenError("Source query identity was lost");
    const bounds = evBox3d(loaded, { "topology" : qAllModifiableSolidBodies() });
    const gap = evDistance(loaded, { "side0" : sourceParts[0], "side1" : sourceParts[1] });
    if (abs(bounds.maxCorner[0] / millimeter - 8) > 0.000000001 ||
        abs(gap.distance / millimeter - 4) > 0.000000001 ||
        size(evCollision(loaded, { "targets" : sourceParts[0], "tools" : sourceParts[1] })) != 0)
        throw regenError("Read-only native evaluators lost their source owner");
});
