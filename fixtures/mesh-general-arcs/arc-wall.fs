FeatureScript 3000;
import(path : "onshape/std/geometry.fs", version : "3000.0");
const V_B = { (unitless) : [0, 0, 3] } as IntegerBoundSpec;
annotation { "Feature Type Name" : "Wall" }
export const wall = defineFeature(function(context is Context, id is Id, definition is map)
    precondition { isInteger(definition.variant, V_B); }
    {
        const mm = millimeter;
        var R; var a; var b; var mid; var step;
        if (definition.variant == 0) { R = 4.1 * mm; a = 2.85 * mm; b = sqrt(R * R - a * a); const t = atan2(b, a); mid = vector(-R * cos(t / 2), -R * sin(t / 2)); step = 0.25 * mm; }
        else if (definition.variant == 1) { R = 5 * mm; a = 3 * mm; b = 4 * mm; mid = vector(-4.8 * mm, -1.4 * mm); step = 0.25 * mm; }
        else if (definition.variant == 2) { R = 4.1 * mm; a = 2.85 * mm; b = sqrt(R * R - a * a); const t = atan2(b, a); mid = vector(-R * cos(t / 2), -R * sin(t / 2)); step = 0 * mm; }
        else { R = 4.1 * mm; a = 2.85 * mm; b = sqrt(R * R - a * a); mid = vector(-R * cos(20 * degree), -R * sin(20 * degree)); step = 0.25 * mm; }
        const W = R + 2.8 * mm; const F = -(R + 6 * mm); const B = R;
        var sk = newSketchOnPlane(context, id + "sk", { "sketchPlane" : plane(vector(0, 0, 0) * mm, vector(0, 0, 1), vector(1, 0, 0)) });
        skLineSegment(sk, "l1", { "start" : vector(-W, F), "end" : vector(-a, F) });
        skLineSegment(sk, "l2", { "start" : vector(-a, F), "end" : vector(-a, -b) });
        skArc(sk, "arc", { "start" : vector(-a, -b), "mid" : mid, "end" : vector(-R, 0 * mm) });
        if (step > 0 * mm) skLineSegment(sk, "l3", { "start" : vector(-R, 0 * mm), "end" : vector(-R - step, 0 * mm) });
        skLineSegment(sk, "l3b", { "start" : vector(-R - step, 0 * mm), "end" : vector(-R - step, B) });
        skLineSegment(sk, "l4", { "start" : vector(-R - step, B), "end" : vector(-W, B) });
        skLineSegment(sk, "l5", { "start" : vector(-W, B), "end" : vector(-W, F) });
        skSolve(sk);
        opExtrude(context, id + "ex", { "entities" : qSketchRegion(id + "sk"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 5.3 * mm });
    });
