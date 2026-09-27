FeatureScript 2909;
import(path : "onshape/std/geometry.fs", version : "2909.0");
// Not this cluster: the next blocker of the single-step-r20 "datums" studio once
// its generator (tools/build_fs.py) has added the header. build_fs.py emits
// `const live = "-";` in every stamp function. Parser.at() compares token values
// without the token kind, so the string "-" is taken as unary minus. Same root
// cause as ../string-function-keyword.fs (cluster fs-parser-syntax).
const live = "-";
annotation { "Feature Type Name" : "Repro" }
export const repro = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "c", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(10, 10, 10) * millimeter });
    });
