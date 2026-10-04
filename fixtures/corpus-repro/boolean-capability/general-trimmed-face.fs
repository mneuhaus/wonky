FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Repro for cluster boolean-capability, sub-causes general and general-trim
// (docs/corpus/cluster-boolean-capability.md). Each feature is one binary
// opBoolean between a body with a curved (cylindrical or conical) face and a
// tool whose faces cross it. No arm of booleanInBend admits the pair: the
// planar arrangement wants straight edges only, the curved arm only
// intersects, the pierce arm only bores holes that stay inside the target.
//
// socketHex:  fs95 fasteners (interface-r8.fs#fasteners, f0socket): an M3
//             socket screw (two coaxial cylinders, which the coaxial arm
//             unites) minus the hex socket prism. 18 units (fs95, fs88, fs273).
// bandNotch:  cad-project-039/c-channel-bases-*: an arc band
//             (line/arc sketch extrusion) minus a prism notch across its outer
//             arc. 16 units (fs398, fs550, fs386).
// bossUnion:  cad-project-039/belt-central-r26/central-spur-r26.fs
//             #centralHousing26: a box with a coaxial end cylinder of the same
//             length whose radius equals the box half-height (tangent faces).
//             6 units (fs276, fs398, fs509).
// ringBoss:   fs95 cableTray/upperFixed: a ring wall united with a screw boss
//             on a parallel axis (the next blocker of 28 fs95 units once
//             ring unions work).
// spokeTrim:  fs95 bottomSpoke/switchBracket and fs88 motorBracket: a
//             122.2 mm radius cylinder about the machine axis trims the inner
//             end of a spoke. The through-hole arm takes it and declines,
//             because the axis misses the face. 10 units.
//
// Observed (node bin/wonky.mjs <file> --check --feature <f>): see README.md.
function prism(context is Context, id is Id, pl is Plane, points is array, depth is number) returns Query
{
    var sketch = newSketchOnPlane(context, id + "s", { "sketchPlane" : pl });
    var pts = [];
    for (var p in points)
        pts = append(pts, vector(p[0], p[1]) * millimeter);
    skPolyline(sketch, "outline", { "points" : append(pts, pts[0]) });
    skSolve(sketch);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : pl.normal,
                "endBound" : BoundingType.BLIND, "endDepth" : depth * millimeter });
    opDeleteBodies(context, id + "ds", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    return qCreatedBy(id + "ex", EntityType.BODY);
}

function cyl(context is Context, id is Id, p is Vector, n is Vector, r is number, h is number) returns Query
{
    var sketch = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(p * millimeter, n) });
    skCircle(sketch, "c", { "center" : vector(0, 0) * millimeter, "radius" : r * millimeter });
    skSolve(sketch);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : n,
                "endBound" : BoundingType.BLIND, "endDepth" : h * millimeter });
    opDeleteBodies(context, id + "ds", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
    return qCreatedBy(id + "ex", EntityType.BODY);
}

function cut(context is Context, id is Id, t is Query, q is Query)
{
    opBoolean(context, id, { "targets" : t, "tools" : q, "operationType" : BooleanOperationType.SUBTRACTION });
}

function unite(context is Context, id is Id, qs is array)
{
    opBoolean(context, id, { "tools" : qUnion(qs), "operationType" : BooleanOperationType.UNION });
}

annotation { "Feature Type Name" : "Socket screw hex" }
export const socketHex = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var z = vector(0, 0, 1);
        var b = cyl(context, id + "shaft", vector(0, 0, -8), z, 1.5, 8.05);
        unite(context, id + "join", [b, cyl(context, id + "head", vector(0, 0, 0), z, 2.75, 3)]);
        var hex = [];
        for (var k = 0; k < 6; k += 1)
            hex = append(hex, [2.5 / sqrt(3) * cos(k * 60 * degree), 2.5 / sqrt(3) * sin(k * 60 * degree)]);
        cut(context, id + "socket", b, prism(context, id + "socketTool", plane(vector(0, 0, 1.6) * millimeter, z, vector(1, 0, 0)), hex, 2));
    });

annotation { "Feature Type Name" : "Arc band notch" }
export const bandNotch = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        // Quarter annulus 126..132.25 mm about the Z axis, 12 mm high.
        var sketch = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, -18.8) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        var ro = 132.25; var ri = 126; var c = cos(45 * degree);
        skLineSegment(sketch, "start", { "start" : vector(ri, 0) * millimeter, "end" : vector(ro, 0) * millimeter });
        skArc(sketch, "outer", { "start" : vector(ro, 0) * millimeter, "mid" : vector(ro * c, ro * c) * millimeter, "end" : vector(0, ro) * millimeter });
        skLineSegment(sketch, "end", { "start" : vector(0, ro) * millimeter, "end" : vector(0, ri) * millimeter });
        skArc(sketch, "inner", { "start" : vector(0, ri) * millimeter, "mid" : vector(ri * c, ri * c) * millimeter, "end" : vector(ri, 0) * millimeter });
        skSolve(sketch);
        opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1),
                    "endBound" : BoundingType.BLIND, "endDepth" : 12 * millimeter });
        opDeleteBodies(context, id + "ds", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
        var notch = prism(context, id + "notch", plane(vector(0, 0, -18.9) * millimeter, vector(0, 0, 1), vector(1, 0, 0)),
            [[85, 85], [100, 85], [100, 100], [85, 100]], 12.2);
        cut(context, id + "cut", qCreatedBy(id + "ex", EntityType.BODY), notch);
    });

annotation { "Feature Type Name" : "Housing with round end" }
export const bossUnion = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var boxBody = prism(context, id + "box", plane(vector(0, -61.8, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0)),
            [[0, -22.4], [178, -22.4], [178, 22.4], [0, 22.4]], 15.2);
        var end = cyl(context, id + "end", vector(0, -61.8, 0), vector(0, -1, 0), 22.4, 15.2);
        unite(context, id + "join", [boxBody, end]);
    });

annotation { "Feature Type Name" : "Screw boss on a ring wall" }
export const ringBoss = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        // fs95 cableTray (interface-r8.fs, bossJoin0), corpus numbers unchanged:
        // the tray wall ring and one M3 screw boss whose axis is parallel to
        // the ring axis. This is the most frequent NEXT blocker of the fs95
        // family once coaxial unions work (28 units).
        var z = vector(0, 0, 1);
        var wall = cyl(context, id + "wallOuter", vector(0, 0, 21.4), z, 122, 36.6);
        cut(context, id + "wallHole", wall, cyl(context, id + "wallInner", vector(0, 0, 20.4), z, 118.5, 38.6));
        unite(context, id + "bossJoin", [wall, cyl(context, id + "boss", vector(116, 0, 52), z, 5, 8)]);
    });

annotation { "Feature Type Name" : "Spoke trimmed to radius" }
export const spokeTrim = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var spoke = prism(context, id + "spoke", plane(vector(0, 0, 32) * millimeter, vector(0, 0, 1), vector(1, 0, 0)),
            [[117, -21], [287.8, -21], [287.8, 21], [117, 21]], 54);
        cut(context, id + "trim", spoke, cyl(context, id + "limit", vector(0, 0, 0), vector(0, 0, 1), 122.2, 150));
    });
