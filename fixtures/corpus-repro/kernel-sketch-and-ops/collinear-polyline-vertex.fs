FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Cluster kernel-sketch-and-ops, cause "collinear" (15 corpus units): an skPolyline with a vertex
// in the middle of a straight edge. Onshape extrudes it; wonky refuses the profile.
// Reduced from cad-project-041 r10b SideDrive g0 (the rack: 147 vertices, two exact collinear
// vertices on its straight back edge; also in fixtures/r10b/r10b.fs, feature r10bSideDrive)
// and cad-project-014 bottomSpoke (collinear to 2e-9 mm after arithmetic).
annotation { "Feature Type Name" : "Collinear vertex" }
export const collinearVertex = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skPolyline(s, "outline", { "points" : [vector(0, 0) * millimeter, vector(20, 0) * millimeter, vector(20, 8) * millimeter, vector(20, 16) * millimeter, vector(0, 16) * millimeter, vector(0, 0) * millimeter] });
        skSolve(s);
        opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 5 * millimeter });
    });
