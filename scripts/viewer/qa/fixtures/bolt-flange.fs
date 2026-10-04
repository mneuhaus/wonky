FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Viewer QA fixture (viewer on Rust): a Ø60 x 8 mm flange with a Ø20 mm bore and
// six Ø6 mm holes on a Ø44 mm bolt circle, built by subtracting extruded
// cylinders. On the Rust kernel this is a stacked-prism body; its display mesh
// must attribute every triangle to a face and sample every edge. Closed forms:
// volume 8 * pi * (30^2 - 10^2 - 6 * 3^2) = 5968 pi mm^3, adjacent hole axes
// 22 mm apart.
export function boltFlange(context is Context, id is Id, definition is map)
{
    var disc = newSketchOnPlane(context, id + "disc", {
        "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1))
    });
    skCircle(disc, "circle", { "center" : vector(0, 0) * millimeter, "radius" : 30 * millimeter });
    skSolve(disc);
    opExtrude(context, id + "stock", { "entities" : qSketchRegion(id + "disc"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 8 * millimeter });

    var bore = newSketchOnPlane(context, id + "bore", {
        "sketchPlane" : plane(vector(0, 0, -1) * millimeter, vector(0, 0, 1))
    });
    skCircle(bore, "circle", { "center" : vector(0, 0) * millimeter, "radius" : 10 * millimeter });
    skSolve(bore);
    opExtrude(context, id + "boreTool", { "entities" : qSketchRegion(id + "bore"),
        "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
    opBoolean(context, id + "boreCut", { "targets" : qCreatedBy(id + "stock", EntityType.BODY),
        "tools" : qCreatedBy(id + "boreTool", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });

    for (var i = 0; i < 6; i += 1)
    {
        var a = i * 60 * degree;
        var hole = newSketchOnPlane(context, id + ("hole" ~ i), {
            "sketchPlane" : plane(vector(0, 0, -1) * millimeter, vector(0, 0, 1))
        });
        skCircle(hole, "circle", { "center" : vector(22 * cos(a), 22 * sin(a)) * millimeter, "radius" : 3 * millimeter });
        skSolve(hole);
        opExtrude(context, id + ("holeTool" ~ i), { "entities" : qSketchRegion(id + ("hole" ~ i)),
            "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 10 * millimeter });
        opBoolean(context, id + ("holeCut" ~ i), { "targets" : qCreatedBy(id + "stock", EntityType.BODY),
            "tools" : qCreatedBy(id + ("holeTool" ~ i), EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    }
}
