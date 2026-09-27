FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");
// Reduced from the cableClamp feature of the distributor bottom-interface
// family (interface-r3.fs ... interface-r11.fs, bottom-drive native-source.fs;
// 13 corpus files). The helper builds a round tool at the origin along +Z,
// poses it with opTransform(toWorld(coordSystem(...))) and cuts a through hole
// into a bar. The same idiom is used by module-r4-upload.fs and
// top-structure-r1.fs.
//
// Today: 'opTransform' is not defined or not implemented by this prototype
// (line 24). With opTransform, coordSystem and toWorld the bar has one exact
// round through hole along X: volume 3*8*38 - pi*1.7^2*3 = 884.7623916933765 mm^3,
// 7 faces (6 planes, 1 cylinder).
annotation { "Feature Type Name" : "Posed through hole" }
export const posedBore = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "bar", { "corner1" : vector(0, 2, 21.8) * millimeter, "corner2" : vector(3, 10, 59.8) * millimeter });
        var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : 1.7 * millimeter });
        skSolve(s);
        opExtrude(context, id + "pin", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
        opDeleteBodies(context, id + "ds", { "entities" : qCreatedBy(id + "s", EntityType.BODY) });
        opTransform(context, id + "pose", { "bodies" : qCreatedBy(id + "pin", EntityType.BODY),
                "transform" : toWorld(coordSystem(vector(-1, 6, 25) * millimeter, vector(0, 1, 0), vector(1, 0, 0))) });
        opBoolean(context, id + "cut", { "targets" : qCreatedBy(id + "bar", EntityType.BODY), "tools" : qCreatedBy(id + "pin", EntityType.BODY),
                "operationType" : BooleanOperationType.SUBTRACTION });
    });
