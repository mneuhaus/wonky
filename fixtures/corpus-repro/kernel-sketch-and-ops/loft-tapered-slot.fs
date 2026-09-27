FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Cluster kernel-sketch-and-ops, cause "loft", a kind that is not a first blocker of this cluster:
// it is the next blocker of 10 fs398 channel-base units (cad-project-039
// c-channel-bases-arcs-r6/*.fs, c-channel-bases-clean-r5/*.fs, loft n141 at line 222) once their
// Booleans (cluster boolean-capability) and their three planar polygon lofts are solved.
// Two stadium (slot) profiles of lines and arcs on parallel planes 6 mm apart. The arc pairs share
// their centres and shrink from R13 to R10; the straight sides stay parallel. The exact loft is a
// drafted slot: 2 planar sides, 2 half-cone patches, 2 planar caps. No free-form surface is needed.
// Closed-form volume: 2 * 30 * (6 * 11.5) + pi * 6 * (13^2 + 13 * 10 + 10^2) / 3
//                   = 4140 + 798 * pi = 6646.990938 mm^3. The control extrusion builds:
//                   6 * (780 + 169 * pi) = 7865.574951 mm^3.
function slot(context is Context, id is Id, z is number, r is number) returns Query
{
    var s = newSketchOnPlane(context, id, { "sketchPlane" : plane(vector(0, 0, z) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    var lo = 13 - r;
    var hi = 13 + r;
    skLineSegment(s, "bottom", { "start" : vector(0, lo) * millimeter, "end" : vector(30, lo) * millimeter });
    skArc(s, "right", { "start" : vector(30, lo) * millimeter, "mid" : vector(30 + r, 13) * millimeter, "end" : vector(30, hi) * millimeter });
    skLineSegment(s, "top", { "start" : vector(30, hi) * millimeter, "end" : vector(0, hi) * millimeter });
    skArc(s, "left", { "start" : vector(0, hi) * millimeter, "mid" : vector(-r, 13) * millimeter, "end" : vector(0, lo) * millimeter });
    skSolve(s);
    return qSketchRegion(id, false);
}

annotation { "Feature Type Name" : "Tapered slot loft (lines and concentric arcs)" }
export const taperedSlot = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var a = slot(context, id + "a", 0, 13);
        var b = slot(context, id + "b", 6, 10);
        opLoft(context, id + "loft", { "profileSubqueries" : [a, b] });
    });

annotation { "Feature Type Name" : "Control: the R13 slot extruded" }
export const slotExtrudeControl = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var a = slot(context, id + "a", 0, 13);
        opExtrude(context, id + "ex", { "entities" : a, "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
    });
