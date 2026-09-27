FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// NEXT blocker (not this cluster) of cad-project-043/fsocct/cases/workspace/mini_camera.fs
// (fs555; the same pilot() helper is in the gt2 mini camera r4 camera.fs) once
// fs-interpreter-semantics is fixed: a BLIND pilot bore (r 1.3 mm, 10.1 mm
// long, starting 1 mm above the floor) into a planar union with a step, like
// 'clampPilot52/cut' in the camera saddle (faces at y = 16, 19 and 27).
// Production refuses it with the general trimmed-face message (ranged line
// edges from the union). Unlike the lochwand holes it is not a through hole,
// so a through-hole admission fix (pierce v2) alone would still refuse it
// (src/boolean.mjs code 6, "a blind pocket needs a floor"). The bake-off
// recover route builds it exactly (docs/corpus/cluster-fs-interpreter-semantics.md §5).
// Expected volume: 60*3*50 + 20*11*20 - 20*3*20 - pi*1.3^2*10 = 12146.907 mm^3.
function box(context is Context, id is Id, x0, y0, z0, x1, y1, z1) returns Query
{
    fCuboid(context, id, { "corner1" : vector(x0, y0, z0) * millimeter, "corner2" : vector(x1, y1, z1) * millimeter });
    return qCreatedBy(id, EntityType.BODY);
}
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var plate = box(context, id + "plate", 0, 16, -50, 60, 19, 0);
        var block = box(context, id + "block", 40, 16, -40, 60, 27, -20);
        opBoolean(context, id + "join", { "tools" : qUnion([plate, block]), "operationType" : BooleanOperationType.UNION });
        var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(52, 17, -32) * millimeter, vector(0, 1, 0)) });
        skCircle(sk, "c", { "center" : vector(0, 0) * millimeter, "radius" : 1.3 * millimeter });
        skSolve(sk);
        opExtrude(context, id + "pilot", { "entities" : qSketchRegion(id + "sk"), "direction" : vector(0, 1, 0), "endBound" : BoundingType.BLIND, "endDepth" : 10.1 * millimeter });
        opDeleteBodies(context, id + "clean", { "entities" : qCreatedBy(id + "sk", EntityType.BODY) });
        opBoolean(context, id + "cut", { "targets" : qCreatedBy(id + "plate", EntityType.BODY), "tools" : qCreatedBy(id + "pilot", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });
