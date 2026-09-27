FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");
// NEXT blocker of the fs95 cableClamp units once opTransform exists: the same
// bar, hole and countersink frustum as interface-r6.fs .. interface-r11.fs and
// the bottom-drive native-source.fs copies (11 corpus files), built directly in
// world coordinates so no missing builtin is involved.
//
// bar x -8..8, y 0.9..3.9, z 25..47.8; hole r 1.7 along -Y at z 28.3; the
// countersink frustum runs r 1.7 at y 2.09 to r 3.51 at y 3.91, so its radius
// at the bar top is 3.500055 mm while the hole sits 3.3 mm from the end face
// z = 25. The countersink breaks out through that face: the end face (a plane
// parallel to the cone axis) meets the cone in a hyperbola.
//
// Feature `hole` builds today (native Bend through-hole pierce).
// Feature `countersink` stops at the countersink cut with "opBoolean supports
// coaxial cylinder primitives, ... general trimmed-face booleans are not
// implemented". The bake-off `recover` route also declines this shape: "plane/cone
// section is a hyperbola (curve type missing in the body format)"
// (scripts/corpus/fs-missing-builtin/recover-next.mjs, case fs95-cs-first).
// Onshape: 1043.645308 mm^3 (OCCT exact CSG of the same tree).
function bar(context is Context, id is Id) returns Query
{
    fCuboid(context, id + "bar", { "corner1" : vector(-8, 0.9, 25) * millimeter, "corner2" : vector(8, 3.9, 47.8) * millimeter });
    var s = newSketchOnPlane(context, id + "hs", { "sketchPlane" : plane(vector(0, 4, 28.3) * millimeter, vector(0, -1, 0), vector(1, 0, 0)) });
    skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : 1.7 * millimeter });
    skSolve(s);
    opExtrude(context, id + "pin", { "entities" : qSketchRegion(id + "hs", false), "direction" : vector(0, -1, 0), "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
    opDeleteBodies(context, id + "dhs", { "entities" : qCreatedBy(id + "hs", EntityType.BODY) });
    opBoolean(context, id + "hole", { "targets" : qCreatedBy(id + "bar", EntityType.BODY), "tools" : qCreatedBy(id + "pin", EntityType.BODY),
            "operationType" : BooleanOperationType.SUBTRACTION });
    return qCreatedBy(id + "bar", EntityType.BODY);
}
annotation { "Feature Type Name" : "Bar with hole" }
export const hole = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        bar(context, id);
    });
annotation { "Feature Type Name" : "Countersink breaking out of the bar end" }
export const countersink = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        var b = bar(context, id);
        var qs = [];
        var ss = [];
        for (var k = 0; k < 2; k += 1)
        {
            var sid = id + ("s" ~ k);
            var sk = newSketchOnPlane(context, sid, { "sketchPlane" : plane(vector(0, 2.09 + k * 1.82, 28.3) * millimeter, vector(0, 1, 0), vector(0, 0, 1)) });
            skCircle(sk, "circle", { "center" : vector(0, 0) * millimeter, "radius" : (k == 0 ? 1.7 : 3.51) * millimeter });
            skSolve(sk);
            qs = append(qs, qSketchRegion(sid, false));
            ss = append(ss, qCreatedBy(sid, EntityType.BODY));
        }
        opLoft(context, id + "cone", { "profileSubqueries" : qs });
        opDeleteBodies(context, id + "ds", { "entities" : qUnion(ss) });
        opBoolean(context, id + "cs", { "targets" : b, "tools" : qCreatedBy(id + "cone", EntityType.BODY),
                "operationType" : BooleanOperationType.SUBTRACTION });
    });
