FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Cluster kernel-sketch-and-ops, cause "inner loops" (2 corpus units): one sketch with a line/arc
// outline and circles inside it, extruded as a region with holes (qSketchRegion(id, true)).
// Reduced from cad-project-039/belt-fixed-r29/wall-r29/archive-before-part26-clearance/
// hopper-rear-wall-r29.fs and its twin cad-project-043/fsocct/cases/workspace/rear_wall.fs.
// Splitting the holes into separate cylinders does not help today: a line/arc extrusion has arc
// edges, so the through-hole path refuses it and the general Boolean is not implemented.
annotation { "Feature Type Name" : "Plate with holes" }
export const plateWithHoles = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skLineSegment(s, "bottom", { "start" : vector(0, 0) * millimeter, "end" : vector(40, 0) * millimeter });
        skLineSegment(s, "right", { "start" : vector(40, 0) * millimeter, "end" : vector(40, 20) * millimeter });
        skArc(s, "top", { "start" : vector(40, 20) * millimeter, "mid" : vector(20, 30) * millimeter, "end" : vector(0, 20) * millimeter });
        skLineSegment(s, "left", { "start" : vector(0, 20) * millimeter, "end" : vector(0, 0) * millimeter });
        skCircle(s, "hole", { "center" : vector(20, 10) * millimeter, "radius" : 1.7 * millimeter });
        skSolve(s);
        opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", true), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 3.2 * millimeter });
    });
