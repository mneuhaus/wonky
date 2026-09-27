// Local FeatureScript adaptation of gNucleus AI cad-gen-freecad row 21d1517841.
// Apache-2.0 source data; see ../NOTICE.md. This is not an official CADBench submission.
FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

function cylinder(context is Context, id is Id, radius, height)
{
    var sketch = newSketchOnPlane(context, id + "profile", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1))
    });
    skCircle(sketch, "circle", { "center" : vector(0, 0) * millimeter, "radius" : radius });
    skSolve(sketch);
    opExtrude(context, id, { "entities" : qSketchRegion(id + "profile"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : height });
}

export function main(context is Context, id is Id, definition is map)
{
    cylinder(context, id + "outer", 4.5 * millimeter, 0.8 * millimeter);
    cylinder(context, id + "bore", 1.6 * millimeter, 0.8 * millimeter);
    opBoolean(context, id + "washer", {
        "targets" : qCreatedBy(id + "outer", EntityType.BODY),
        "tools" : qCreatedBy(id + "bore", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION
    });
}
