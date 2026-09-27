FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

// Controls for the Rust line-sketch region (test/rust-host.test.mjs), outside
// fixtures/cad-acid so the zone catalog hash and the Onshape freeze stay valid.
// CAD-Acid AC45's four skLineSegment calls (a 16 x 8 rectangle), with its
// 2^-30 mm gap (OPEN) or closed bit-equal (CLOSED), in shuffled order
// (SHUFFLED), with one segment reversed (REVERSED), and a figure-eight that
// touches itself at a vertex (TOUCHING). Lengths are local millimetres.
export enum SegmentControl
{
    OPEN,
    CLOSED,
    SHUFFLED,
    REVERSED,
    TOUCHING
}

export const segmentControl = defineFeature(function(context is Context, id is Id, definition is map)
    precondition
    {
        annotation { "Name" : "Control" }
        definition.control is SegmentControl;
    }
    {
        var sketch = newSketchOnPlane(context, id + "sketch", { "sketchPlane" : plane(vector(1500, 1000, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
        const gap = definition.control == SegmentControl.OPEN ? 0.000000000931322574615478515625 : 0;
        if (definition.control == SegmentControl.SHUFFLED)
        {
            skLineSegment(sketch, "s2", { "start" : vector(16, 8) * millimeter, "end" : vector(0, 8) * millimeter });
            skLineSegment(sketch, "s0", { "start" : vector(0, 0) * millimeter, "end" : vector(16, 0) * millimeter });
            skLineSegment(sketch, "s3", { "start" : vector(0, 8) * millimeter, "end" : vector(0, 0) * millimeter });
            skLineSegment(sketch, "s1", { "start" : vector(16, 0) * millimeter, "end" : vector(16, 8) * millimeter });
        }
        else if (definition.control == SegmentControl.TOUCHING)
        {
            skPolyline(sketch, "eight", { "points" : [vector(0, 0) * millimeter, vector(8, 0) * millimeter,
                vector(8, 8) * millimeter, vector(16, 8) * millimeter, vector(16, 16) * millimeter,
                vector(8, 16) * millimeter, vector(8, 8) * millimeter, vector(0, 8) * millimeter, vector(0, 0) * millimeter] });
        }
        else
        {
            skLineSegment(sketch, "s0", { "start" : vector(0, 0) * millimeter, "end" : vector(16, 0) * millimeter });
            if (definition.control == SegmentControl.REVERSED)
                skLineSegment(sketch, "s1", { "start" : vector(16, 8) * millimeter, "end" : vector(16, 0) * millimeter });
            else
                skLineSegment(sketch, "s1", { "start" : vector(16, 0) * millimeter, "end" : vector(16, 8) * millimeter });
            skLineSegment(sketch, "s2", { "start" : vector(16, 8) * millimeter, "end" : vector(0, 8) * millimeter });
            skLineSegment(sketch, "s3", { "start" : vector(0, 8) * millimeter, "end" : vector(0, gap) * millimeter });
        }
        skSolve(sketch);
        opExtrude(context, id + "extrude", { "entities" : qSketchRegion(id + "sketch", false),
            "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 4 * millimeter });
        setProperty(context, { "entities" : qCreatedBy(id + "extrude", EntityType.BODY), "propertyType" : PropertyType.NAME, "value" : "control" });
    });
