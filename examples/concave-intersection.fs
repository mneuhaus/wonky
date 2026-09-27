FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

export function main(context is Context, id is Id, definition is map)
{
    const sketchId = id + "profile";
    var sketch = newSketchOnPlane(context, sketchId, {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter,
                              vector(0, 0, 1), vector(1, 0, 0))
    });
    skPolyline(sketch, "outline", {
        "points" : [vector(0, 0) * millimeter, vector(8, 0) * millimeter,
                    vector(8, 2) * millimeter, vector(3, 2) * millimeter,
                    vector(3, 6) * millimeter, vector(0, 6) * millimeter,
                    vector(0, 0) * millimeter]
    });
    skSolve(sketch);
    opExtrude(context, id + "body", {
        "entities" : qSketchRegion(sketchId),
        "direction" : vector(0, 0, 1),
        "endBound" : BoundingType.BLIND,
        "endDepth" : 4 * millimeter
    });
    fCuboid(context, id + "heightTool", {
        "corner1" : vector(-1, -1, 1) * millimeter,
        "corner2" : vector(9, 7, 3) * millimeter
    });
    opBoolean(context, id + "heightCut", {
        "tools" : qUnion([qCreatedBy(id + "body", EntityType.BODY),
                          qCreatedBy(id + "heightTool", EntityType.BODY)]),
        "operationType" : BooleanOperationType.INTERSECTION
    });
    fCuboid(context, id + "sideTool", {
        "corner1" : vector(1, -1, -1) * millimeter,
        "corner2" : vector(7, 7, 5) * millimeter
    });
    opBoolean(context, id + "sideCut", {
        "tools" : qUnion([qCreatedBy(id + "heightCut", EntityType.BODY),
                          qCreatedBy(id + "sideTool", EntityType.BODY)]),
        "operationType" : BooleanOperationType.INTERSECTION
    });
}
