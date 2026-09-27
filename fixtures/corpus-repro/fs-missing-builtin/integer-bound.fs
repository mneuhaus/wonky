FeatureScript 3044;
import(path : "onshape/std/common.fs", version : "3044.0");
// Integer feature parameter with std bounds, reduced from printed_joints.fs
// (`const KIND = { (unitless) : [1, 1, 8] } as IntegerBoundSpec;` at top level) and
// unchanged-link-test-strip.fs (the same bound inline in the precondition).
//
// Today: 'unitless' is not defined (line 18). The const is evaluated when the
// module loads, so it blocks every feature of the file, not only the one that
// uses it.
// With unitless and isInteger: 'Expected IntegerBoundSpec' (line 18), the
// type-tag gap of the fs-interpreter-semantics cluster. With the tag, the
// parameter still needs its default (2) from the bound spec; then one box
// 2 x 1 x 1 mm = 2 mm^3.
//
// Also a second feature that never touches the bound, to show the load-time
// failure: run --feature plainBox.

const COUNT_BOUNDS = { (unitless) : [1, 2, 4] } as IntegerBoundSpec;

annotation { "Feature Type Name" : "Integer bound" }
export const integerBound = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Count" }
        isInteger(definition.count, COUNT_BOUNDS);
    }
    {
        fCuboid(context, id + "cube", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(definition.count, 1, 1) * millimeter });
    });

annotation { "Feature Type Name" : "Plain box" }
export const plainBox = defineFeature(function(context is Context, id is Id, definition is map)
    precondition {}
    {
        fCuboid(context, id + "cube", { "corner1" : vector(0, 0, 0) * millimeter, "corner2" : vector(1, 1, 1) * millimeter });
    });
