FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Synthetic frozen Part Studio, not a capture of an Onshape document.
annotation { "Feature Type Name" : "Imported rails" }
export const importedRails = defineFeature(function(context is Context, id is Id, definition is map)
precondition {}
{
    for (var slot = 0; slot < 2; slot += 1)
    {
        const sketchId = id + ("profile" ~ slot);
        var sketch = newSketchOnPlane(context, sketchId, {
            "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1))
        });
        skRectangle(sketch, "outline", {
            "firstCorner" : vector(0, slot * 8) * millimeter,
            "secondCorner" : vector(8, slot * 8 + 4) * millimeter
        });
        skSolve(sketch);
        const solidId = id + ("rail" ~ slot);
        opExtrude(context, solidId, {
            "entities" : qSketchRegion(sketchId),
            "direction" : vector(0, 0, 1),
            "endBound" : BoundingType.BLIND,
            "endDepth" : 4 * millimeter
        });
        setProperty(context, {
            "entities" : qCreatedBy(solidId, EntityType.BODY),
            "propertyType" : PropertyType.NAME,
            "value" : slot == 0 ? "rail" : "spare"
        });
        setProperty(context, {
            "entities" : qCreatedBy(solidId, EntityType.BODY),
            "propertyType" : PropertyType.DESCRIPTION,
            "value" : "Frozen source rail"
        });
        setProperty(context, {
            "entities" : qCreatedBy(solidId, EntityType.BODY),
            "propertyType" : PropertyType.APPEARANCE,
            "value" : color(0.2, 0.4, 0.6)
        });
    }
});
