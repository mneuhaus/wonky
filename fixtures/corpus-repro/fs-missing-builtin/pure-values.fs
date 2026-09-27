FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");
// Pure std value builtins (std math.fs, transform.fs, units.fs) that the
// corpus calls. None of them needs the kernel. Run one with --feature.
//
//   atan2Angle     atan2 on plain numbers and on lengths, as in corner_loft.fs
//                  and curved-accepted-source.fs (the same helper, 2 corpus files):
//                  `var a1 = atan2(tn - r, ts - c) - 360 * degree`.
//                  Today: 'atan2' is not defined (line 29).
//                  Expected with the builtin: a = 36.87 deg, b = 216.87 deg, one box
//                  8 x 6 x 4 mm = 192 mm^3.
//   rotatedCopy    opPattern with rotationAround(line, angle), the std way to spin a
//                  body about an axis (45 corpus files, 16 families).
//                  Today: 'rotationAround' is not defined (line 40).
//                  Expected: 2 bodies of 8 mm^3; the copy spans x -2..0, y 5..7.
//
// The integer-bound idiom (unitless, isInteger) is in integer-bound.fs, because a
// top-level const that fails blocks every feature of its file.
annotation { "Feature Type Name" : "Angle from atan2" }
export const atan2Angle = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        // plain numbers in, an angle out
        var a = atan2(3, 4);
        // lengths in; shifting by a full turn, as the corpus helper does
        var b = atan2(-3 * millimeter, -4 * millimeter) + 360 * degree;
        fCuboid(context, id + "box", { "corner1" : vector(0, 0, 0) * millimeter,
                "corner2" : vector(10 * cos(a), 10 * sin(a), -5 * cos(b)) * millimeter });
    });

annotation { "Feature Type Name" : "Rotated copy" }
export const rotatedCopy = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "cube", { "corner1" : vector(5, 0, 0) * millimeter, "corner2" : vector(7, 2, 2) * millimeter });
        var axis = line(vector(0, 0, 0) * millimeter, vector(0, 0, 1));
        opPattern(context, id + "spin", { "entities" : qCreatedBy(id + "cube", EntityType.BODY),
                "transforms" : [rotationAround(axis, 90 * degree)], "instanceNames" : ["quarter"] });
    });

// mirroredCopy   opPattern with mirrorAcross(plane), the corpus' only mirror idiom
//                (11 headed files, 4 families; 6 of them in this cluster: guide-r3/r4.fs,
//                r10-adapters.fs archive-r10/r16, corner_loft.fs, curved-accepted-source.fs).
//                No corpus file passes a mirror to opTransform.
//                Today: 'mirrorAcross' is not defined (line 55).
//                With mirrorAcross: 'Only proper rigid transforms are implemented' (line 54):
//                production opPattern refuses a reflection. Expected once reflections are
//                supported: 2 bodies of 8 mm^3; the copy spans x -7..-5.
annotation { "Feature Type Name" : "Mirrored copy" }
export const mirroredCopy = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "cube", { "corner1" : vector(5, 0, 0) * millimeter, "corner2" : vector(7, 2, 2) * millimeter });
        opPattern(context, id + "mirror", { "entities" : qCreatedBy(id + "cube", EntityType.BODY),
                "transforms" : [mirrorAcross(plane(vector(0, 0, 0) * millimeter, vector(1, 0, 0)))], "instanceNames" : ["right"] });
    });
