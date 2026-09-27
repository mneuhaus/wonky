FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// NEXT blocker (not this cluster) of the 17 lochwand units (families fs233,
// fs161, fs554) once fs-interpreter-semantics is fixed: a round through hole
// in a planar panel that already has a notch (exit slot) cut into one edge.
// Shape of cad-project-020/lochwand r2/r3 'exitCut' then 'holeCut0'
// (panel 600 x 6 x 350 mm, slot 100 mm wide, hole r 15 mm). Hand-off to the
// boolean-capability cluster; recover's exact scope includes plate holes.
function prismY(context is Context, id is Id, x0, y0, z0, x1, y1, z1) returns Query
{
    fCuboid(context, id, { "corner1" : vector(x0, y0, z0) * millimeter, "corner2" : vector(x1, y1, z1) * millimeter });
    return qCreatedBy(id, EntityType.BODY);
}
function cylinderY(context is Context, id is Id, x, y, z, r, h) returns Query
{
    var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(x, y, z) * millimeter, vector(0, 1, 0)) });
    skCircle(sk, "circle", { "center" : vector(0, 0) * millimeter, "radius" : r * millimeter });
    skSolve(sk);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "sk", false), "direction" : vector(0, 1, 0), "endBound" : BoundingType.BLIND, "endDepth" : h * millimeter });
    opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "sk", EntityType.BODY) });
    return qCreatedBy(id + "ex", EntityType.BODY);
}
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var panel = prismY(context, id + "front", -300, -6, 0, 300, 0, 350);
        opBoolean(context, id + "exitCut", { "targets" : panel, "tools" : prismY(context, id + "exitTool", -50, -7, -1, 50, 1, 110), "operationType" : BooleanOperationType.SUBTRACTION });
        opBoolean(context, id + "holeCut0", { "targets" : panel, "tools" : cylinderY(context, id + "hole0", 100, -7, 200, 15, 8), "operationType" : BooleanOperationType.SUBTRACTION });
    });
