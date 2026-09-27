FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");

// Second-level next blockers of the fixed-frame R30 lineage (after the Part
// Studio guard and the n3 subtraction). Both are line/arc sketch joins that
// kernel/sketch-arcs.bend refuses as SelfIntersectionOrTouch; neither profile
// crosses itself. Coordinates are copied unchanged from the corpus.

// 20 current fixed-frame files: sketch n4s0 (and its 7 repeats), entities 3-5,
// cad-project-039/belt-fixed-r30/fixed-frame-r30.fs:84. Two lines join
// a 2-mm fillet arc of 0.19 degrees (chord 0.0068 mm). The three printed arc
// points fix the circle centre only to about 1e-6 mm, so at both joins the
// analytic tangent point lands 1.4e-6 mm from the shared endpoint; the join
// rule (tangent_clear) allows only the solver resolution, about 6e-10 mm here.
// The corpus sketch reports the first join (l0/a1), this one the second (a1/l2).
annotation { "Feature Type Name" : "Tiny fillet arc join" }
export const tinyFilletArcJoin = defineFeature(function(context is Context, id is Id, definition is map)
    precondition { }
    {
        var sk = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skLineSegment(sk, "l0", { "start" : vector(247.31677484043, 214.20407646822) * millimeter, "end" : vector(242.74130209303, 268.62689733251) * millimeter });
        skArc(sk, "a1", { "start" : vector(242.74130209303, 268.62689733251) * millimeter, "mid" : vector(242.74101513844, 268.63027619074) * millimeter, "end" : vector(242.74072245538, 268.63365455757) * millimeter });
        skLineSegment(sk, "l2", { "start" : vector(242.74072245538, 268.63365455757) * millimeter, "end" : vector(224.92971669023, 472.21438201799) * millimeter });
        skLineSegment(sk, "l3", { "start" : vector(224.92971669023, 472.21438201799) * millimeter, "end" : vector(320, 472.21438201799) * millimeter });
        skLineSegment(sk, "l4", { "start" : vector(320, 472.21438201799) * millimeter, "end" : vector(320, 214.20407646822) * millimeter });
        skLineSegment(sk, "l5", { "start" : vector(320, 214.20407646822) * millimeter, "end" : vector(247.31677484043, 214.20407646822) * millimeter });
        skSolve(sk);
        opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 8 * millimeter });
    });

// 5 older fixed-frame variants: sketch n2s0, entities 10-13,
// cad-project-039/belt-fixed-r30/variants/tail-shortening-17p53/fixed-frame-r30.fs.
// A straight edge is split into two exactly collinear segments (angle 1e-12
// degrees, shared endpoint exact). The parallel-line branch accepts only a
// cross product of exactly zero; here it is 2e-14.
annotation { "Feature Type Name" : "Split straight edge" }
export const splitStraightEdge = defineFeature(function(context is Context, id is Id, definition is map)
    precondition { }
    {
        var sk = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        skArc(sk, "a0", { "start" : vector(-293.1020630329, 532.07884515411) * millimeter, "mid" : vector(-294.02266405279, 529.15907174438) * millimeter, "end" : vector(-292.60903569917, 526.44351694289) * millimeter });
        skLineSegment(sk, "l1", { "start" : vector(-292.60903569917, 526.44351694289) * millimeter, "end" : vector(-145.44300825369, 402.95655759156) * millimeter });
        skLineSegment(sk, "l2", { "start" : vector(-145.44300825369, 402.95655759156) * millimeter, "end" : vector(-36.044300825647, 311.16014253742) * millimeter });
        skLineSegment(sk, "l3", { "start" : vector(-36.044300825647, 311.16014253742) * millimeter, "end" : vector(-36.044300825647, 532.07884515411) * millimeter });
        skLineSegment(sk, "l4", { "start" : vector(-36.044300825647, 532.07884515411) * millimeter, "end" : vector(-293.1020630329, 532.07884515411) * millimeter });
        skSolve(sk);
        opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "s", false), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 8 * millimeter });
    });
