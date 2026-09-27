FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Cluster kernel-sketch-and-ops, cause "max vertices" (12 corpus units): the planar extrusion path
// accepts 3-256 profile vertices. Corpus profiles: the ribbon-cable reference loop (470 vertices,
// cad-project-014 ribbonReference / cableReferenceR4) and the r10b SideDrive pinion
// (384 vertices, second blocker of r10bSideDrive after the collinear rack).
annotation { "Feature Type Name" : "300-gon" }
export const polygon300 = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var pts = [];
        for (var i = 0; i < 300; i += 1)
            pts = append(pts, vector(20 * cos(i * 1.2 * degree), 20 * sin(i * 1.2 * degree)) * millimeter);
        pts = append(pts, pts[0]);
        var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skPolyline(s, "outline", { "points" : pts });
        skSolve(s);
        opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 2 * millimeter });
    });
