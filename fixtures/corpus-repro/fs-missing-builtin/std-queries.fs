FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");
// Std query and id builtins the corpus uses to find bodies. Each feature
// stops at its first missing builtin; run one with --feature.
//
//   robustEverything  makeRobustQuery(context, qBodyType(qEverything(BODY), SOLID))
//                     cad-project-002 system-fixes.fs, guide-r3.fs, guide-r4.fs,
//                     mg995-flap.fs; qEverything alone in r10-adapters.fs (x2).
//                     Today: 'makeRobustQuery' is not defined (line 23).
//                     Expected with the builtins: 1 body (the second cube deleted).
//   containsPoint     qContainsPoint(qAllModifiableSolidBodies(), point)
//                     belt-loop-r29.fs, belt-loop-r30.fs, central-drive-r28.fs.
//                     Today: 'qContainsPoint' is not defined (line 34).
//                     Expected: 1 body, the cube at x 0..10 (the one containing the point is deleted).
//   idFromString      makeId(string) + segment, as in cad-project-040 buildplate-r11..r16.fs.
//                     Today: 'makeId' is not defined (line 43). The CLI root id is "model",
//                     so makeId("model") + "a" names this feature's first cube. Expected: 1 body.
annotation { "Feature Type Name" : "Robust everything query" }
export const robustEverything = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "a", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
        var all = makeRobustQuery(context, qBodyType(qEverything(EntityType.BODY), BodyType.SOLID));
        if (size(evaluateQuery(context, all)) != 1) throw regenError("Expected one solid");
        fCuboid(context, id + "b", { "corner1" : vector(20, 0, 0) * millimeter, "corner2" : vector(30, 10, 10) * millimeter });
        opDeleteBodies(context, id + "drop", { "entities" : qSubtraction(qAllModifiableSolidBodies(), all) });
    });
annotation { "Feature Type Name" : "Body containing a point" }
export const containsPoint = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "a", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
        fCuboid(context, id + "b", { "corner1" : vector(20, 0, 0) * millimeter, "corner2" : vector(30, 10, 10) * millimeter });
        var hit = qContainsPoint(qAllModifiableSolidBodies(), vector(25, 5, 5) * millimeter);
        if (size(evaluateQuery(context, hit)) != 1) throw regenError("Expected one body at the point");
        opDeleteBodies(context, id + "drop", { "entities" : hit });
    });
annotation { "Feature Type Name" : "Id from a string" }
export const idFromString = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "a", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
        var q = qCreatedBy(makeId("model") + "a", EntityType.BODY);
        if (size(evaluateQuery(context, q)) != 1) throw regenError("Expected the cube created by model/a");
    });
