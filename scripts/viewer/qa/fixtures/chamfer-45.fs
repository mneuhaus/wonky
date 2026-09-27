FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// FDM QA fixture (viewer package fdm): one prism, 20 mm deep along Y, whose
// XZ profile stands on the plate (bed face z = 0, x 0..20) with two
// down-facing flanks:
//   right: a 45 deg chamfer from (20, 0) to (30, 10). Its outward normal is
//          (1, 0, -1)/sqrt 2, so alpha = asin(-n.up) = 45 deg exactly. At
//          alpha_max = 45 deg it is not an overhang (cad-khana: alpha must
//          exceed alpha_max, with 1e-6 deg slack).
//   left:  a 50 deg face from (0, 0) to (-10 tan 50 deg, 10); its outward
//          normal makes alpha = 50 deg, an overhang at alpha_max = 45 deg and
//          not one at alpha_max = 60 deg.
// The prism is 20 mm tall; every other face is vertical or faces up.
export function chamfer45(context is Context, id is Id, definition is map)
{
    const profileId = id + "profile";
    var sketch = newSketchOnPlane(context, profileId, {
        "sketchPlane" : plane(vector(0, 20, 0) * millimeter, vector(0, -1, 0), vector(1, 0, 0))
    });
    skPolyline(sketch, "outline", {
        "points" : [
            vector(0, 0) * millimeter,
            vector(20, 0) * millimeter,
            vector(30, 10) * millimeter,
            vector(30, 20) * millimeter,
            vector(-11.917535925942101, 20) * millimeter,
            vector(-11.917535925942101, 10) * millimeter,
            vector(0, 0) * millimeter
        ]
    });
    skSolve(sketch);
    opExtrude(context, id + "prism", {
        "entities" : qSketchRegion(profileId),
        "direction" : vector(0, -1, 0),
        "endBound" : BoundingType.BLIND,
        "endDepth" : 20 * millimeter
    });
}
