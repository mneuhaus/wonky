FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");
// Reduced from cad-project-014/machine-interface-r11/top-full-module-r4/module-r4.fs
// (cluster fs-module-import, 4 files use NS::function). SourceR11 is a Feature
// Studio of another document (document/version/element, pinned to a microversion).
// Its exported features are called as code; no Part Studio is involved.
SourceR11::import(path : "onshape-id-b768d669/3a4a721e9a284a9fce8e3e11/6d0c52f938e154a42dfdee7d", version : "929e22181adee257c576eba0");
annotation { "Feature Type Name" : "Feature Studio import" }
export const featureStudioImport = defineFeature(function(context is Context, id is Id, definition is map)
precondition {}
{
    SourceR11::bottomCarrier(context, id + "source", {});
});
