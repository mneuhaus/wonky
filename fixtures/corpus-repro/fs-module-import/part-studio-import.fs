FeatureScript 3070;
import(path : "onshape/std/common.fs", version : "3070.0");
// Reduced from cad-project-040/src/buildplate-r16-rear.fs (cluster fs-module-import,
// 92 files use NS::build). Onshape's derive idiom: instance one part of another
// Part Studio of the same document, pinned to a microversion, then place it.
// The ids are the real ones; wonky has no snapshot for them.
Parts::import(path : "d9c8543f8a347821ee2e2194", version : "188904c7a670c9866e4b06de");
annotation { "Feature Type Name" : "Part Studio import" }
export const partStudioImport = defineFeature(function(context is Context, id is Id, definition is map)
precondition {}
{
    var inst = newInstantiator(id + "rear");
    addInstance(inst, Parts::build, {"partQuery" : qBodyType(qCreatedBy(makeId("FWWAVZSUNoaiBDj_0") + "rearPlateSource", EntityType.BODY), BodyType.SOLID), "name" : "rear"});
    instantiate(context, inst);
});
