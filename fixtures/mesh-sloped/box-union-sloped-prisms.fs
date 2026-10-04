FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Servo holder for Bones' jaw linkage: holds the SG90 in the lower-left corner of the rear opening and clamps onto the
// opening's left edge; one screw from outside tightens the clamp (no drilling, any shell thickness up to ~4.5 mm).
// The servo horn drives the jaw crank (jaw-crank.fs) on the hinge peg through a 1 mm wire (paperclip).
// Placement and shapes come from the Revopoint scan of the head (tmp/servo-bracket/scan: edge.py, servospot.py):
// frame H: x = along the opening's edge (the edge runs 1:3 in plan view relative to the peg frame), y = outwards
// (towards the back of the head), z = parallel to the peg axis (into the head); origin on the edge, 6.3 mm out along
// the peg from its base. The shell near the edge leans 1:2 (26.6 deg; measured 25.5 deg), so the clamp jaws are
// parallelograms in the (y, z) plane spanned by W = (-1, -2) (along the shell, away from the edge) and N = (2, -1)
// (outwards); jaw vertices are t * W + k * N with t, k multiples of 0.25 (exact vertex differences).
// Servo (measured SG90, see servo-slide.fs): shaft at (SX, SY), horn face at z = ZHF facing the peg side, case
// towards +x. Ears screw onto the ear plate from the body side with the SG90's own screws.
const SX = -1.3;          // shaft x (mm)
const SY = -7.05;         // shaft y
const ZHF = 3.5;          // horn outer face z; ears' horn-side face at ZHF + 14
const EDGE_Z = 2;         // edge height at the clamp (z rises 0.1 per mm along the edge; clamp spans x 10..22)

function prism(context is Context, id is Id, x0, x1, tk is array)
{
    // Parallelogram t in [tk[0], tk[1]], k in [tk[2], tk[3]] in the (y, z) plane, extruded along x from x0 to x1.
    const mm = millimeter;
    var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(x0, 0, 0) * mm, vector(1, 0, 0), vector(0, 1, 0)) });
    const pt = function(t, k) { return vector(-t + 2 * k, -2 * t - k + EDGE_Z) * mm; };
    skPolyline(sk, "p", { "points" : [pt(tk[0], tk[2]), pt(tk[1], tk[2]), pt(tk[1], tk[3]), pt(tk[0], tk[3]), pt(tk[0], tk[2])] });
    skSolve(sk);
    opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "sk"), "direction" : vector(1, 0, 0), "endBound" : BoundingType.BLIND, "endDepth" : (x1 - x0) * mm });
    opDeleteBodies(context, id + "drop", { "entities" : qCreatedBy(id + "sk", EntityType.BODY) });
    return qCreatedBy(id + "ex", EntityType.BODY);
}

function block(context is Context, id is Id, a is array, b is array)
{
    fCuboid(context, id, { "corner1" : vector(a[0], a[1], a[2]) * millimeter, "corner2" : vector(b[0], b[1], b[2]) * millimeter });
    return qCreatedBy(id, EntityType.BODY);
}

annotation { "Feature Type Name" : "Jaw servo holder" }
export const jawServoHolder = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
    }
    {
        const earZ = ZHF + 14;                                   // ears' horn-side face = ear plate top
        var solids = [
            block(context, id + "earPlate", [-15, -15.5, earZ - 3], [23, 2.4, earZ]),
            block(context, id + "backWall", [-3, -0.6, 5], [23, 2.4, earZ]),       // behind the case, joins the clamp
            prism(context, id + "outerJaw", 10, 22, [-1.25, 3.5, 0.5, 1.5]),       // outside the shell, 1.1 mm off it
            prism(context, id + "innerJaw", 10, 22, [-1.25, 3.25, -2.5, -1.75]),   // inside the shell
            prism(context, id + "spine", 10, 22, [-2.25, -1.25, -2.5, 1.5]),       // 2.8 mm past the edge
            block(context, id + "boss", [13.5, 0.45, -5.1], [18.5, 6, -2.1])        // takes the clamp screw
        ];
        opBoolean(context, id + "join", { "tools" : qUnion(solids), "operationType" : BooleanOperationType.UNION });
    });
