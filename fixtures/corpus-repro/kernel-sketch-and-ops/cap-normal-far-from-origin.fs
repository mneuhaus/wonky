FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");
// Cluster kernel-sketch-and-ops, cause "cap normal" (10 corpus units):
//   "Face vertices do not lie on the analytic plane" and "Plane frame is not orthonormal".
// Reduced from cad-project-039/r22-current-guides.fs#feederMounts (the 2020-rail foot,
// line 277) and hopper-corner-inserts-r2/archive/rejected-strips/archive-strip-only.fs.
// A small prism on a tilted sketch plane about 560 mm from the origin. The same prism at the
// origin builds; only the distance from the origin differs.
function footPrism(context is Context, id is Id, origin is Vector, points is array)
{
    var n = vector(-0.25, -sqrt(3) / 4, sqrt(3) / 2);
    var u = vector(sqrt(3) / 2, -0.5, 0);
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(origin * millimeter, n, u) });
    var pts = [];
    for (var p in points) pts = append(pts, vector(p[0], p[1]) * millimeter);
    pts = append(pts, pts[0]);
    skPolyline(s, "outline", { "points" : pts });
    skSolve(s);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : n, "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
}
// The corpus computes the plane origin exactly like this (side -1 of the two feet).
const FAR = vector(77.1263837814323 - 100, -454.3231642470163, -320.2202765531271) + vector(-0.25, -sqrt(3) / 4, sqrt(3) / 2) * 10;
const OCTAGON = [[-31.58, -10], [31.58, -10], [32, -9.58], [32, 9.58], [31.58, 10], [-31.58, 10], [-32, 9.58], [-32, -9.58]];
// The key pocket of the same foot, sketched 0.1 mm below the foot plane.
const POCKET_ORIGIN = FAR - vector(-0.25, -sqrt(3) / 4, sqrt(3) / 2) * 0.1;
const RECTANGLE = [[-20.2, -3], [20.2, -3], [20.2, 3], [-20.2, 3]];

annotation { "Feature Type Name" : "Tilted octagon far from origin" }
export const tiltedOctagonFar = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    { footPrism(context, id + "foot", FAR, OCTAGON); });

annotation { "Feature Type Name" : "Tilted rectangle far from origin (key pocket)" }
export const tiltedRectangleFar = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    { footPrism(context, id + "pocket", POCKET_ORIGIN, RECTANGLE); });

annotation { "Feature Type Name" : "Tilted octagon at the origin (control)" }
export const tiltedOctagonNear = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    { footPrism(context, id + "foot", vector(0, 0, 0), OCTAGON); });
