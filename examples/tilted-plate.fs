FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

export function tiltedPlate(context is Context, id is Id, definition is map)
{
    const sketchId = id + "profile";
    const workplane = plane(vector(5, 10, 15) * millimeter,
                            vector(0, 1, 1), vector(1, 0, 0));
    var sketch = newSketchOnPlane(context, sketchId, { "sketchPlane" : workplane });
    skRectangle(sketch, "rectangle", {
        "firstCorner" : vector(-10, -5) * millimeter,
        "secondCorner" : vector(10, 5) * millimeter
    });
    skSolve(sketch);
    opExtrude(context, id + "plate", {
        "entities" : qSketchRegion(sketchId),
        "direction" : workplane.normal,
        "startBound" : BoundingType.BLIND,
        "startDepth" : 2 * millimeter,
        "endBound" : BoundingType.BLIND,
        "endDepth" : 3 * millimeter
    });
}
