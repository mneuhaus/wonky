FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");

function block(context is Context, id is Id, lo is Vector, hi is Vector) returns Query
{
    fCuboid(context, id, { "corner1" : lo * millimeter, "corner2" : hi * millimeter });
    return qCreatedBy(id, EntityType.BODY);
}

function faceAt(context is Context, body is Query, p is Vector) returns Query
{
    const f = qContainsPoint(qOwnedByBody(body, EntityType.FACE), p * millimeter);
    if (size(evaluateQuery(context, f)) != 1)
        throw regenError("no unique face at " ~ p);
    return f;
}

function edgesAt(context is Context, body is Query, points is array) returns Query
{
    var edges = [];
    for (var p in points)
        edges = append(edges, qContainsPoint(qOwnedByBody(body, EntityType.EDGE), p * millimeter));
    return qUnion(edges);
}

// P1 plane/plane: 0.42 chamfer on the top face loop of a 30 x 18 x 26 block.
export function p1Box(context is Context, id is Id, definition is map)
{
    const part = block(context, id + "block", vector(-15, -9, 0), vector(15, 9, 26));
    opChamfer(context, id + "break", { "entities" : faceAt(context, part, vector(1, 1, 26)), "chamferType" : ChamferType.EQUAL_OFFSETS,
        "width" : 0.42 * millimeter, "tangentPropagation" : true });
}

// P1 plane/cylinder: a stadium (lines and G1 arcs) 20 + 2 x R5, 6 high; 0.42 chamfer on its top loop.
export function p1Stadium(context is Context, id is Id, definition is map)
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skLineSegment(s, "a", { "start" : vector(0, 0) * millimeter, "end" : vector(20, 0) * millimeter });
    skArc(s, "b", { "start" : vector(20, 0) * millimeter, "mid" : vector(25, 5) * millimeter, "end" : vector(20, 10) * millimeter });
    skLineSegment(s, "c", { "start" : vector(20, 10) * millimeter, "end" : vector(0, 10) * millimeter });
    skArc(s, "d", { "start" : vector(0, 10) * millimeter, "mid" : vector(-5, 5) * millimeter, "end" : vector(0, 0) * millimeter });
    skSolve(s);
    opExtrude(context, id + "x", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 6 * millimeter });
    const part = qCreatedBy(id + "x", EntityType.BODY);
    opChamfer(context, id + "break", { "entities" : faceAt(context, part, vector(10, 5, 6)), "chamferType" : ChamferType.EQUAL_OFFSETS,
        "width" : 0.42 * millimeter, "tangentPropagation" : true });
}

// P1 bore rim: a block with a through bore of radius 3.3 (Boolean); 0.42 chamfer on the top face (outer loop and bore rim).
export function p1Bore(context is Context, id is Id, definition is map)
{
    const part = block(context, id + "block", vector(-15, -9, 0), vector(15, 9, 10));
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, -1) * millimeter, vector(0, 0, 1), vector(1, 0, 0)) });
    skCircle(s, "c", { "center" : vector(0, 0) * millimeter, "radius" : 3.3 * millimeter });
    skSolve(s);
    opExtrude(context, id + "bore", { "entities" : qSketchRegion(id + "s"), "direction" : vector(0, 0, 1), "endBound" : BoundingType.BLIND, "endDepth" : 12 * millimeter });
    opBoolean(context, id + "cut", { "targets" : part, "tools" : qCreatedBy(id + "bore", EntityType.BODY), "operationType" : BooleanOperationType.SUBTRACTION });
    opChamfer(context, id + "break", { "entities" : faceAt(context, part, vector(10, 5, 10)), "chamferType" : ChamferType.EQUAL_OFFSETS,
        "width" : 0.42 * millimeter, "tangentPropagation" : true });
}

// P3: R4.2 on the four vertical edges of a 30 x 18 x 26 block, tangentPropagation false.
export function p3Corners(context is Context, id is Id, definition is map)
{
    const part = block(context, id + "block", vector(-15, -9, 0), vector(15, 9, 26));
    opFillet(context, id + "corners", { "entities" : edgesAt(context, part, [vector(15, 9, 13), vector(-15, 9, 13), vector(15, -9, 13), vector(-15, -9, 13)]),
        "radius" : 4.2 * millimeter, "tangentPropagation" : false });
}

// P4: P3, then the 0.42 chamfer over the top loop (lines and R4.2 arcs).
export function p4ChamferAfterFillet(context is Context, id is Id, definition is map)
{
    const part = block(context, id + "block", vector(-15, -9, 0), vector(15, 9, 26));
    opFillet(context, id + "corners", { "entities" : edgesAt(context, part, [vector(15, 9, 13), vector(-15, 9, 13), vector(15, -9, 13), vector(-15, -9, 13)]),
        "radius" : 4.2 * millimeter });
    opChamfer(context, id + "break", { "entities" : faceAt(context, part, vector(1, 1, 26)), "chamferType" : ChamferType.EQUAL_OFFSETS,
        "width" : 0.42 * millimeter, "tangentPropagation" : true });
}

// P2: an L-section rib (30 long): R2 at the concave root, tangentPropagation true.
export function p2Root(context is Context, id is Id, definition is map)
{
    var s = newSketchOnPlane(context, id + "s", { "sketchPlane" : plane(vector(0, 0, 0) * millimeter, vector(1, 0, 0), vector(0, 1, 0)) });
    skPolyline(s, "p", { "points" : [vector(0, 0) * millimeter, vector(20, 0) * millimeter, vector(20, 4) * millimeter, vector(4, 4) * millimeter, vector(4, 16) * millimeter, vector(0, 16) * millimeter, vector(0, 0) * millimeter] });
    skSolve(s);
    opExtrude(context, id + "x", { "entities" : qSketchRegion(id + "s"), "direction" : vector(1, 0, 0), "endBound" : BoundingType.BLIND, "endDepth" : 30 * millimeter });
    const part = qCreatedBy(id + "x", EntityType.BODY);
    opFillet(context, id + "root", { "entities" : edgesAt(context, part, [vector(15, 4, 4)]), "radius" : 2 * millimeter, "tangentPropagation" : true });
}
