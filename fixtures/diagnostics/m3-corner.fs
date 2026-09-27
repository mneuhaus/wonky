FeatureScript 3044;
import(path:"onshape/std/geometry.fs", version:"3044.0");
const M3_HYBRID_DEPTH = 8.4 * millimeter;
const M3_HYBRID_RELIEF_DEPTH = 2.1 * millimeter;
const M3_HYBRID_RELIEF_RADIUS = 2.1 * millimeter;
const M3_CLEARANCE_RADIUS = 1.7 * millimeter;
const M3_HYBRID_ARCS = [
    [[1.663246643885392,0.13016887084596582],[0.9526279441628823,0.5500000000000006],[0.9443528708772371,1.375329410940977]],
    [[0.9443528708772365,1.375329410940977],[0.969783865689786,1.7253567251610853],[0.7206058308061871,1.9724926455143315]],
    [[0.7206058308061873,1.9724926455143315],[-6.845637154536563e-16,2.1],[-0.7206058308061887,1.9724926455143315]],
    [[-0.7206058308061889,1.9724926455143315],[-0.9697838656897876,1.7253567251610848],[-0.9443528708772381,1.3753294109409766]],
    [[-0.9443528708772382,1.3753294109409766],[-0.9526279441628829,0.5499999999999993],[-1.663246643885392,0.13016887084596387]],
    [[-1.6632466438853917,0.1301688708459645],[-1.9790946874247182,-0.022820898712910896],[-2.0685316551964785,-0.36218336716381583]],
    [[-2.068531655196479,-0.36218336716381583],[-1.818653347947321,-1.050000000000002],[-1.3479258243902885,-1.6103092783505175]],
    [[-1.347925824390288,-1.610309278350518],[-1.0093108217349296,-1.702535826448175],[-0.7188937730081535,-1.5054982817869427]],
    [[-0.7188937730081535,-1.5054982817869427],[7.564982820643778e-16,-1.1000000000000003],[0.7188937730081556,-1.5054982817869413]],
    [[0.7188937730081557,-1.5054982817869411],[1.0093108217349327,-1.702535826448173],[1.3479258243902912,-1.6103092783505148]],
    [[1.347925824390291,-1.6103092783505155],[1.8186533479473226,-1.0499999999999998],[2.0685316551964794,-0.3621833671638144]],
    [[2.068531655196479,-0.36218336716381383],[1.9790946874247186,-0.02282089871290927],[1.6632466438853921,0.13016887084596593]]
];

function m3CheckFrame(axis is Vector, xDirection is Vector, depth is ValueWithUnits, entryRelief is boolean)
{
    if (abs(norm(axis) - 1) > 1e-10)
        throw regenError("M3 hybrid axis must be unit length");
    if (abs(norm(xDirection) - 1) > 1e-10 || abs(dot(axis, xDirection)) > 1e-10)
        throw regenError("M3 hybrid xDirection must be unit length and orthogonal to axis");
    if (depth <= 0 * millimeter)
        throw regenError("M3 hybrid depth must be positive");
    if (entryRelief && depth < M3_HYBRID_RELIEF_DEPTH)
        throw regenError("M3 hybrid depth is shorter than its entry relief");
}

function m3HybridSketch(context is Context, id is Id, origin is Vector, axis is Vector, xDirection is Vector) returns Query
{
    var sk = newSketchOnPlane(context, id, {"sketchPlane": plane(origin, axis, xDirection)});
    for (var i = 0; i < size(M3_HYBRID_ARCS); i += 1)
    {
        var a = M3_HYBRID_ARCS[i];
        skArc(sk, "a" ~ i, {"start": vector(a[0][0], a[0][1]) * millimeter,
                              "mid": vector(a[1][0], a[1][1]) * millimeter,
                              "end": vector(a[2][0], a[2][1]) * millimeter});
    }
    skSolve(sk);
    return qSketchRegion(id, false);
}

function m3CircleSketch(context is Context, id is Id, origin is Vector, axis is Vector, xDirection is Vector, radius is ValueWithUnits) returns Query
{
    var sk = newSketchOnPlane(context, id, {"sketchPlane": plane(origin, axis, xDirection)});
    skCircle(sk, "c", {"center": vector(0, 0) * millimeter, "radius": radius});
    skSolve(sk);
    return qSketchRegion(id, false);
}

function m3ReliefTool(context is Context, id is Id, origin is Vector, axis is Vector, xDirection is Vector) returns Query
{
    var sketchNormal = cross(xDirection, axis);
    var sk = newSketchOnPlane(context, id + "Profile", {"sketchPlane": plane(origin, sketchNormal, xDirection)});
    skLineSegment(sk, "entry", {"start": vector(0, 0) * millimeter, "end": vector(2.1, 0) * millimeter});
    skLineSegment(sk, "slope", {"start": vector(2.1, 0) * millimeter, "end": vector(0, 2.1) * millimeter});
    skLineSegment(sk, "axis", {"start": vector(0, 2.1) * millimeter, "end": vector(0, 0) * millimeter});
    skSolve(sk);
    opRevolve(context, id + "Revolve", {"entities": qSketchRegion(id + "Profile", false),
        "axis": line(origin, axis), "angleForward": 360 * degree});
    opDeleteBodies(context, id + "Clean", {"entities": qCreatedBy(id + "Profile", EntityType.BODY)});
    return qCreatedBy(id + "Revolve", EntityType.BODY);
}

// origin: Vector of length; axis/xDirection: dimensionless unit vectors;
// depth: LENGTH. Returns one solid Query and performs no target Boolean.
export function m3HybridTool(context is Context, id is Id, origin is Vector, axis is Vector,
                              depth is ValueWithUnits, xDirection is Vector,
                              entryRelief is boolean) returns Query
{
    m3CheckFrame(axis, xDirection, depth, entryRelief);
    var profile = m3HybridSketch(context, id + "Profile", origin, axis, xDirection);
    opExtrude(context, id + "Core", {"entities": profile, "direction": axis,
        "endBound": BoundingType.BLIND, "endDepth": depth});
    opDeleteBodies(context, id + "ProfileClean", {"entities": qCreatedBy(id + "Profile", EntityType.BODY)});
    var result = qCreatedBy(id + "Core", EntityType.BODY);
    if (entryRelief)
    {
        var relief = m3ReliefTool(context, id + "Relief", origin, axis, xDirection);
        opBoolean(context, id + "ReliefUnion", {"tools": qUnion([result, relief]),
            "operationType": BooleanOperationType.UNION});
        result = qUnion([result, relief, qCreatedBy(id + "ReliefUnion", EntityType.BODY)]);
    }
    return result;
}


export const diagnosticCorner = defineFeature(function(context is Context,id is Id,definition is map)
{
    const body = m3HybridTool(context,id+"tool",vector(0,0,0)*millimeter,vector(0,0,1),8.4*millimeter,vector(1,0,0),true);
    setProperty(context,{"entities":body,"propertyType":PropertyType.NAME,"value":"M3 corner"});
});
