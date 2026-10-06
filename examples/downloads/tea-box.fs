FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Open-top tea bag box for the spice rack: outer block minus inner pocket, open at the top.
annotation { "Feature Type Name" : "Tea bag box" }
export const teaBox = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Width" } isLength(definition.width, POSITIVE_LENGTH_BOUNDS);
        annotation { "Name" : "Depth" } isLength(definition.depth, POSITIVE_LENGTH_BOUNDS);
        annotation { "Name" : "Height" } isLength(definition.height, POSITIVE_LENGTH_BOUNDS);
        annotation { "Name" : "Wall" } isLength(definition.wall, POSITIVE_LENGTH_BOUNDS);
    }
    {
        fCuboid(context, id + "outer", {
            "corner1" : vector(0 * millimeter, 0 * millimeter, 0 * millimeter),
            "corner2" : vector(definition.width, definition.depth, definition.height)
        });
        fCuboid(context, id + "pocket", {
            "corner1" : vector(definition.wall, definition.wall, definition.wall),
            "corner2" : vector(definition.width - definition.wall, definition.depth - definition.wall, definition.height)
        });
        opBoolean(context, id + "open", {
            "targets" : qCreatedBy(id + "outer", EntityType.BODY),
            "tools" : qCreatedBy(id + "pocket", EntityType.BODY),
            "operationType" : BooleanOperationType.SUBTRACTION
        });
    }, { "width" : 160 * millimeter, "depth" : 45 * millimeter, "height" : 45 * millimeter, "wall" : 2 * millimeter });
