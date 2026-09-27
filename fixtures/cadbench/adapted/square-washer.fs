// Local FeatureScript adaptation of gNucleus AI cad-gen-freecad row 3582a53285.
// Apache-2.0 source data; see ../NOTICE.md. This is not an official CADBench submission.
// General planar/cylinder subtraction is deliberately attempted, never skipped.
FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function main(context is Context, id is Id, definition is map)
{
    fCuboid(context, id + "plate", { "corner1" : vector(-20, -20, 0) * millimeter,
        "corner2" : vector(20, 20, 5) * millimeter });
    var bore = newSketchOnPlane(context, id + "boreProfile", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1))
    });
    skCircle(bore, "circle", { "center" : vector(0, 0) * millimeter, "radius" : 3.75 * millimeter });
    skSolve(bore);
    opExtrude(context, id + "bore", { "entities" : qSketchRegion(id + "boreProfile"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 5 * millimeter });
    opBoolean(context, id + "washer", {
        "targets" : qCreatedBy(id + "plate", EntityType.BODY),
        "tools" : qCreatedBy(id + "bore", EntityType.BODY),
        "operationType" : BooleanOperationType.SUBTRACTION
    });
}
