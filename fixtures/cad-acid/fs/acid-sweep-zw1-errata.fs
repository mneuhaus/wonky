FeatureScript 3083;
import(path : "onshape/std/geometry.fs", version : "3083.0");
// Frozen ZW1: operation-faithful, input frames are applied before construction.
export enum AcidVariant { V0, V1, V2, V3, V4, V5 }
export enum AcidSweepZW1Zone { ALL, AC126, AC127, AC128, AC129, AC130, AC131 }
function acidVariantName(v is AcidVariant) returns string
{
    if (v == AcidVariant.V1) return "V1";
    if (v == AcidVariant.V2) return "V2";
    if (v == AcidVariant.V3) return "V3";
    if (v == AcidVariant.V4) return "V4";
    if (v == AcidVariant.V5) return "V5";
    return "V0";
}
function acidFrame(cellX is number, variant is AcidVariant) returns CoordSystem
{
    const cell = vector(cellX, 4250, 0) * millimeter;
    if (variant == AcidVariant.V1)
        return coordSystem(cell + vector(65536.25, -32768.5, 16384.125) * millimeter,
            vector(1, 0, 0), vector(0, 0, 1));
    if (variant == AcidVariant.V2)
        return coordSystem(cell, vector(0, 0, 1), vector(0, -1, 0));
    if (variant == AcidVariant.V3)
    {
        const rotation = rotationAround(line(vector(3, -2, 5) * millimeter, vector(1, 2, 3)), 0.1 * radian);
        const zero = rotation * (vector(0, 0, 0) * millimeter);
        const xAxis = rotation.linear * vector(1, 0, 0);
        const zAxis = rotation.linear * vector(0, 0, 1);
        return coordSystem(cell + zero, xAxis, zAxis);
    }
    return coordSystem(cell, vector(1, 0, 0), vector(0, 0, 1));
}

function acidLabel(context is Context, result is Query, zone is string, variant is AcidVariant)
{
    const parts = evaluateQuery(context, result);
    for (var i = 0; i < size(parts); i += 1)
    {
        setProperty(context, { "entities" : parts[i], "propertyType" : PropertyType.NAME,
            "value" : zone ~ "_" ~ toString(i) ~ "_" ~ acidVariantName(variant) });
        setProperty(context, { "entities" : parts[i], "propertyType" : PropertyType.DESCRIPTION,
            "value" : "acid=" ~ zone ~ "@" ~ acidVariantName(variant) });
    }
}


function zwPoint(F is CoordSystem, p is array) returns Vector
{ return toWorld(F) * (vector(p[0],p[1],p[2]) * millimeter); }
function zwPolygon(sk is Sketch, points is array, variant is AcidVariant)
{
    if (variant == AcidVariant.V5)
        skPolyline(sk, "p", { "points" : append(points, points[0]) });
    else
        for (var i = 0; i < size(points); i += 1)
            skLineSegment(sk, "e" ~ toString(i), {"start":points[i],"end":points[(i+1)%size(points)]});
}
function zwPlane(F is CoordSystem) returns Plane
{ return plane(F.origin, -cross(F.zAxis,F.xAxis), F.xAxis); }
// Erratum: one connection vertex per profile, taken from the profile region itself. qCreatedBy(sketch, VERTEX)
// also holds the coincident sketch wire vertices, so qClosestTo resolved every corner to several vertices.
function zwRegionVertices(sketchId is Id) returns Query
{ return qAdjacent(qSketchRegion(sketchId,false),AdjacencyType.VERTEX,EntityType.VERTEX); }
// std3083 parameterization: quarter periods are exact binary64 values.
// Equal radii specify a circle directly, without a rounded three-point fit.
function zwQuarterArc(sk is Sketch, name is string, center is Vector, radius is ValueWithUnits, start is number)
{
    skEllipticalArc(sk,name,{"center":center,"majorAxis":vector(1,0),
        "majorRadius":radius,"minorRadius":radius,
        "startParameter":start,"endParameter":start+0.25});
}
function zwRevolve(context is Context, id is Id, zone is string, variant is AcidVariant, cellX is number, angle is number)
{
    const F = acidFrame(cellX,variant);
    const delta = variant == AcidVariant.V4 ? 0.025 : 0;
    const r = 4 + delta;
    const b = 2 + delta;
    var sk = newSketchOnPlane(context,id+"sk",{"sketchPlane":zwPlane(F)});
    if (zone == "AC128")
    {
        const a = 1 + delta;
        const c = r-a;
        skLineSegment(sk,"bottom",{"start":vector(0,0)*millimeter,"end":vector(c,0)*millimeter});
        zwQuarterArc(sk,"corner",vector(c,a)*millimeter,a*millimeter,0.75);
        skLineSegment(sk,"cylinder",{"start":vector(r,a)*millimeter,"end":vector(r,6)*millimeter});
        zwQuarterArc(sk,"sphere",vector(0,6)*millimeter,r*millimeter,0);
        skLineSegment(sk,"axis",{"start":vector(0,6+r)*millimeter,"end":vector(0,0)*millimeter});
    }
    else
        zwPolygon(sk,[vector(b,0)*millimeter,vector(r,0)*millimeter,vector(r,3)*millimeter,vector(b,3)*millimeter],variant);
    skSolve(sk);
    opRevolve(context,id+"rev",{"entities":qSketchRegion(id+"sk",false),"axis":line(F.origin,F.zAxis),"angleForward":angle*degree,"angleBack":0*degree});
    acidLabel(context,qCreatedBy(id+"rev",EntityType.BODY),zone,variant);
}
function zwLoft(context is Context, id is Id, variant is AcidVariant)
{
    const F=acidFrame(750,variant);
    const r=4+(variant == AcidVariant.V4 ? 0.025 : 0);
    const a=r;
    const low=[[-a,-a],[a,-a],[a,a],[-a,a]];
    var high=[];
    for (var p in low) high=append(high,[(p[0]-p[1])/sqrt(2),(p[0]+p[1])/sqrt(2)]);
    var sk0=newSketchOnPlane(context,id+"low",{"sketchPlane":plane(F.origin,F.zAxis,F.xAxis)});
    var sk1=newSketchOnPlane(context,id+"high",{"sketchPlane":plane(zwPoint(F,[0,0,6]),F.zAxis,F.xAxis)});
    var pp0=[];var pp1=[];
    for (var i=0;i<4;i+=1)
    { pp0=append(pp0,vector(low[i][0],low[i][1])*millimeter);pp1=append(pp1,vector(high[i][0],high[i][1])*millimeter); }
    zwPolygon(sk0,pp0,variant);zwPolygon(sk1,pp1,variant);skSolve(sk0);skSolve(sk1);
    var connections=[];
    for (var i=0;i<4;i+=1)
        connections=append(connections,{"connectionEntities":qUnion([
            qClosestTo(zwRegionVertices(id+"low"),zwPoint(F,[low[i][0],low[i][1],0])),
            qClosestTo(zwRegionVertices(id+"high"),zwPoint(F,[high[i][0],high[i][1],6]))]),
            "connectionEdges":[],"connectionEdgeParameters":[]});
    opLoft(context,id+"loft",{"profileSubqueries":[qSketchRegion(id+"low",false),qSketchRegion(id+"high",false)],"connections":connections,"bodyType":ToolBodyType.SOLID});
    acidLabel(context,qCreatedBy(id+"loft",EntityType.BODY),"AC129",variant);
}
function zwSweep(context is Context, id is Id, variant is AcidVariant)
{
    const F=acidFrame(1000,variant);const d=variant == AcidVariant.V4 ? 0.025 : 0;
    const R=10+d;const r=2+d;const Fy=cross(F.zAxis,F.xAxis);
    var path=newSketchOnPlane(context,id+"path",{"sketchPlane":plane(F.origin,F.zAxis,F.xAxis)});
    skLineSegment(path,"line",{"start":vector(0,0)*millimeter,"end":vector(8,0)*millimeter});
    zwQuarterArc(path,"bend",vector(8,R)*millimeter,R*millimeter,0.75);
    skSolve(path);
    var profile=newSketchOnPlane(context,id+"profile",{"sketchPlane":plane(F.origin,F.xAxis,Fy)});
    skCircle(profile,"circle",{"center":vector(0,0)*millimeter,"radius":r*millimeter});skSolve(profile);
    opSweep(context,id+"sweep",{"profiles":qSketchRegion(id+"profile",false),"path":qCreatedBy(id+"path",EntityType.EDGE),"keepProfileOrientation":false});
    acidLabel(context,qCreatedBy(id+"sweep",EntityType.BODY),"AC130",variant);
}
function zwDraft(context is Context, id is Id, variant is AcidVariant)
{
    const F=acidFrame(1250,variant);const Fy=cross(F.zAxis,F.xAxis);
    var sk=newSketchOnPlane(context,id+"sk",{"sketchPlane":zwPlane(F)});
    zwPolygon(sk,[vector(0,0)*millimeter,vector(20,0)*millimeter,vector(18,8)*millimeter,vector(0,8)*millimeter],variant);skSolve(sk);
    opExtrude(context,id+"ext",{"entities":qSketchRegion(id+"sk",false),"direction":Fy,"endBound":BoundingType.BLIND,"endDepth":10*millimeter});
    const body=qCreatedBy(id+"ext",EntityType.BODY);
    var hole=newSketchOnPlane(context,id+"hole",{"sketchPlane":plane(F.origin,F.zAxis,F.xAxis)});
    skCircle(hole,"bore",{"center":vector(5,5)*millimeter,"radius":(2+(variant == AcidVariant.V4 ? 0.025 : 0))*millimeter});skSolve(hole);
    opExtrude(context,id+"tool",{"entities":qSketchRegion(id+"hole",false),"direction":F.zAxis,"endBound":BoundingType.BLIND,"endDepth":8*millimeter});
    opBoolean(context,id+"cut",{"targets":body,"tools":qCreatedBy(id+"tool",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
    // Point on the already-inclined x=20-z/4 wall; neutral trace x=20 is invariant.
    const selected=qContainsPoint(qOwnedByBody(body,EntityType.FACE),zwPoint(F,[19,5,4]));
    opDraft(context,id+"draft",{"draftType":DraftType.REFERENCE_SURFACE,"draftFaces":selected,"referenceSurface":plane(F.origin,F.zAxis,F.xAxis),"pullVec":F.zAxis,"angle":atan(1/8),"tangentPropagation":false});
    acidLabel(context,body,"AC131",variant);
}
annotation { "Feature Type Name" : "CAD Acid sweep ZW1" }
export const acidSweepZW1=defineFeature(function(context is Context,id is Id,definition is map)
    precondition
    {
        annotation { "Name" : "Variant", "Default" : AcidVariant.V0 } definition.variant is AcidVariant;
        annotation { "Name" : "Zone", "Default" : AcidSweepZW1Zone.ALL } definition.zone is AcidSweepZW1Zone;
    }
    {
        const v=definition.variant;const z=definition.zone;
        if (z == AcidSweepZW1Zone.ALL || z == AcidSweepZW1Zone.AC126) zwRevolve(context,id+"ac126","AC126",v,0,135);
        if (z == AcidSweepZW1Zone.ALL || z == AcidSweepZW1Zone.AC127) zwRevolve(context,id+"ac127","AC127",v,250,60);
        if (z == AcidSweepZW1Zone.ALL || z == AcidSweepZW1Zone.AC128) zwRevolve(context,id+"ac128","AC128",v,500,360);
        if (z == AcidSweepZW1Zone.ALL || z == AcidSweepZW1Zone.AC129) zwLoft(context,id+"ac129",v);
        if (z == AcidSweepZW1Zone.ALL || z == AcidSweepZW1Zone.AC130) zwSweep(context,id+"ac130",v);
        if (z == AcidSweepZW1Zone.ALL || z == AcidSweepZW1Zone.AC131) zwDraft(context,id+"ac131",v);
    });
