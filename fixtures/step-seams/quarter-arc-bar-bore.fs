FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");

// Jaw crank for Bones: glued onto the jaw's hinge peg; a 1 mm steel wire (paperclip) links one of its holes to the
// servo horn. Peg measured on the Revopoint scan (tmp/servo-bracket/scan/pegcyl.py, 2026-09-30): d 5.46 mm, 12.8 mm
// long. The crank is a stadium plate (hub and arm tip share one radius, so the straight sides are tangent exactly)
// with the peg bore at one end and two wire holes along the arm (choose the one that gives the jaw its travel).
// Printed flat; the hub sits on the outer part of the peg with its outer face flush with the peg end.
const BORE_D   = { (millimeter) : [3, 5.8, 12] } as LengthBoundSpec;    // peg 5.46 + play for glue and hole shrink
const END_R    = { (millimeter) : [3, 5, 10] } as LengthBoundSpec;      // hub and arm-tip radius
const ARM_L    = { (millimeter) : [6, 12, 30] } as LengthBoundSpec;     // bore axis to the outer wire hole
const INNER_L  = { (millimeter) : [4, 9, 30] } as LengthBoundSpec;      // bore axis to the inner wire hole
const WIRE_D   = { (millimeter) : [0.6, 1.4, 3] } as LengthBoundSpec;   // wire hole (1 mm wire + print shrink)
const THICK    = { (millimeter) : [2, 6.8, 12] } as LengthBoundSpec;    // crank thickness = glued length on the peg

annotation { "Feature Type Name" : "Jaw crank" }
export const jawCrank = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Peg bore" } isLength(definition.boreD, BORE_D);
        annotation { "Name" : "Hub / tip radius" } isLength(definition.endR, END_R);
        annotation { "Name" : "Outer wire hole distance" } isLength(definition.armL, ARM_L);
        annotation { "Name" : "Inner wire hole distance" } isLength(definition.innerL, INNER_L);
        annotation { "Name" : "Wire hole" } isLength(definition.wireD, WIRE_D);
        annotation { "Name" : "Thickness" } isLength(definition.thick, THICK);
    }
    {
        const mm = millimeter;
        const r = definition.endR;
        const L = definition.armL;
        var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(0, 0, 0) * mm, vector(0, 0, 1), vector(1, 0, 0)) });
        skLineSegment(sk, "bottom", { "start" : vector(0 * mm, -r), "end" : vector(L, -r) });
        // Quarter arcs with 3-4-5 mid points (the mesher takes quarter arcs; a half arc with holes in the face refuses).
        skArc(sk, "tipA", { "start" : vector(L, -r), "mid" : vector(L + 0.6 * r, -0.8 * r), "end" : vector(L + r, 0 * mm) });
        skArc(sk, "tipB", { "start" : vector(L + r, 0 * mm), "mid" : vector(L + 0.6 * r, 0.8 * r), "end" : vector(L, r) });
        skLineSegment(sk, "top", { "start" : vector(L, r), "end" : vector(0 * mm, r) });
        skArc(sk, "hubA", { "start" : vector(0 * mm, r), "mid" : vector(-0.6 * r, 0.8 * r), "end" : vector(-r, 0 * mm) });
        skArc(sk, "hubB", { "start" : vector(-r, 0 * mm), "mid" : vector(-0.6 * r, -0.8 * r), "end" : vector(0 * mm, -r) });
        skSolve(sk);
        opExtrude(context, id + "plate", { "entities" : qSketchRegion(id + "sk"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : definition.thick });
        opDeleteBodies(context, id + "dropSk", { "entities" : qCreatedBy(id + "sk", EntityType.BODY) });
        const holes = [[0 * mm, definition.boreD / 2]];
        var tools = [];
        for (var i = 0; i < size(holes); i += 1)
        {
            fCylinder(context, id + ("hole" ~ i), { "bottomCenter" : vector(holes[i][0], 0 * mm, -1 * mm), "topCenter" : vector(holes[i][0], 0 * mm, definition.thick + 1 * mm), "radius" : holes[i][1] });
            tools = append(tools, qCreatedBy(id + ("hole" ~ i), EntityType.BODY));
        }
        opBoolean(context, id + "drill", { "tools" : qUnion(tools), "targets" : qCreatedBy(id + "plate", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    });
