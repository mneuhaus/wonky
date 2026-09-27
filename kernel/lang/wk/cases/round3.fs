// Fix round 3 fixtures (docs/language/prototype.md §8), from the verifiers' round-3
// reproductions (tmp/lang/verify/r2/cases). Helpers as there.
FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");
function loftOff(context is Context,id is Id,p is Vector,r0 is number,r1 is number,h is number,dx is number) returns Query
{
 var qq=[];var ss=[];
 for(var k=0;k<2;k+=1){var sid=id+("s"~k);var sk=newSketchOnPlane(context,sid,{"sketchPlane":plane((p+vector(0,0,k*h))*millimeter,vector(0,0,1),vector(1,0,0))});
 skCircle(sk,"circle",{"center":vector(k*dx,0)*millimeter,"radius":(k==0?r0:r1)*millimeter});skSolve(sk);qq=append(qq,qSketchRegion(sid,true));ss=append(ss,qCreatedBy(sid,EntityType.BODY));}
 opLoft(context,id+"loft",{"profileSubqueries":qq});opDeleteBodies(context,id+"ds",{"entities":qUnion(ss)});return qCreatedBy(id+"loft",EntityType.BODY);
}
function cylinder(context is Context,id is Id,p is Vector,r is number,h is number) returns Query
{return loftOff(context,id,p,r,r,h,0);}
function ecyl(context is Context,id is Id,p is Vector,n is Vector,x is Vector,d is Vector,r is number,h is number) returns Query
{
 var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(p*millimeter,n,x)});
 skCircle(s,"c",{"center":vector(0,0)*millimeter,"radius":r*millimeter});skSolve(s);
 opExtrude(context,id+"ex",{"entities":qSketchRegion(id+"s",true),"direction":d,"endBound":BoundingType.BLIND,"endDepth":h*millimeter});
 opDeleteBodies(context,id+"ds",{"entities":qCreatedBy(id+"s",EntityType.BODY)});return qCreatedBy(id+"ex",EntityType.BODY);
}
function prism(context is Context,id is Id,o is Vector,n is Vector,x is Vector,pts is array,d is Vector,h is number) returns Query
{
 var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(o*millimeter,n,x)});
 var q=[];for(var p in pts){q=append(q,p*millimeter);} q=append(q,pts[0]*millimeter);
 skPolyline(s,"o",{"points":q});skSolve(s);
 opExtrude(context,id+"ex",{"entities":qSketchRegion(id+"s",true),"direction":d,"endBound":BoundingType.BLIND,"endDepth":h*millimeter});
 opDeleteBodies(context,id+"ds",{"entities":qCreatedBy(id+"s",EntityType.BODY)});return qCreatedBy(id+"ex",EntityType.BODY);
}
function box(context is Context,id is Id,p0 is Vector,p1 is Vector) returns Query
{return prism(context,id,vector(0,0,p0[2]),vector(0,0,1),vector(1,0,0),[vector(p0[0],p0[1]),vector(p1[0],p0[1]),vector(p1[0],p1[1]),vector(p0[0],p1[1])],vector(0,0,1),p1[2]-p0[2]);}
function subtract(context is Context,id is Id,b is Query,tool is Query)
{opBoolean(context,id,{"targets":b,"tools":tool,"operationType":BooleanOperationType.SUBTRACTION});}
function unite(context is Context,id is Id,a is Query,b is Query)
{opBoolean(context,id,{"tools":qUnion([a,b]),"operationType":BooleanOperationType.UNION});}
function rotz(a is ValueWithUnits) returns Matrix
{return matrix([[cos(a),-sin(a),0],[sin(a),cos(a),0],[0,0,1]]);}
function rotx(a is ValueWithUnits) returns Matrix
{return matrix([[1,0,0],[0,cos(a),-sin(a)],[0,sin(a),cos(a)]]);}

function loftOffY(context is Context,id is Id,p is Vector,r0 is number,r1 is number,h is number,dy is number) returns Query
{
 var qq=[];var ss=[];
 for(var k=0;k<2;k+=1){var sid=id+("s"~k);var sk=newSketchOnPlane(context,sid,{"sketchPlane":plane((p+vector(0,0,k*h))*millimeter,vector(0,0,1),vector(1,0,0))});
 skCircle(sk,"circle",{"center":vector(0,k*dy)*millimeter,"radius":(k==0?r0:r1)*millimeter});skSolve(sk);qq=append(qq,qSketchRegion(sid,true));ss=append(ss,qCreatedBy(sid,EntityType.BODY));}
 opLoft(context,id+"loft",{"profileSubqueries":qq});opDeleteBodies(context,id+"ds",{"entities":qUnion(ss)});return qCreatedBy(id+"loft",EntityType.BODY);
}

// defects 1 and 3: PIERCE with a non-aligned tool into a tilted polyhedral plate
// (verifier tilt-1: F32x2 volume off by 3.5e-5 mm3) and into large plates
// (tilted-20: off by 0.034 mm3; pierce-bigplate: an aligned tool, off by 7.5e-9)
annotation {"Feature Type Name":"tiltedHole"}
export const tiltedHole=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 var n=normalize(vector(1,2,2)); var x=normalize(vector(2,0,-1));
 var q=newSketchOnPlane(context,id+"q",{"sketchPlane":plane(vector(0,0,0)*millimeter,n,x)});
 skRectangle(q,"r",{"firstCorner":vector(-10,-10)*millimeter,"secondCorner":vector(10,10)*millimeter}); skSolve(q);
 opExtrude(context,id+"plate",{"entities":qSketchRegion(id+"q",true),"direction":n,"endBound":BoundingType.BLIND,"endDepth":4*millimeter});
 var c=newSketchOnPlane(context,id+"c",{"sketchPlane":plane(-n*millimeter,n,x)});
 skCircle(c,"c",{"center":vector(2,1)*millimeter,"radius":2*millimeter}); skSolve(c);
 opExtrude(context,id+"rod",{"entities":qSketchRegion(id+"c",true),"direction":n,"endBound":BoundingType.BLIND,"endDepth":6*millimeter});
 opBoolean(context,id+"hole",{"targets":qCreatedBy(id+"plate",EntityType.BODY),"tools":qCreatedBy(id+"rod",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
});
annotation {"Feature Type Name":"bigTiltedPlate"}
export const bigTiltedPlate=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 var n=vector(-0.657,0.796,0.595); var nn=n/norm(n); var x=cross(nn,vector(0,0,1)); x=x/norm(x);
 var p=prism(context,id+"p",vector(90.849,43.53,49.545),nn,x,[vector(-82.701,-82.701),vector(82.701,-82.701),vector(82.701,82.701),vector(-82.701,82.701)],nn,11.341);
 var s=newSketchOnPlane(context,id+"ts",{"sketchPlane":plane((vector(90.849,43.53,49.545)-nn*1.5)*millimeter,nn,x)});
 skCircle(s,"c",{"center":vector(32.689,-15.938)*millimeter,"radius":3.677*millimeter});skSolve(s);
 opExtrude(context,id+"t",{"entities":qSketchRegion(id+"ts",true),"direction":nn,"endBound":BoundingType.BLIND,"endDepth":14.341*millimeter});
 subtract(context,id+"h",p,qCreatedBy(id+"t",EntityType.BODY));
});
annotation {"Feature Type Name":"bigPlate"}
export const bigPlate=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 var p=box(context,id+"p",vector(-150.3,-150.7,0.1),vector(150.9,150.2,40.3)); var t=cylinder(context,id+"t",vector(12.25,-7.5,-1),3.3,45); subtract(context,id+"h",p,t);
});
// defect 2: a loft whose axis dot product is exactly the F32x2 rounding of 1 - 1e-6 (today refuses)
annotation {"Feature Type Name":"axisThreshold"}
export const axisThreshold=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 loftOffY(context,id+"l",vector(0,0,0),5,5,22.39,0.031664265402022086);
});
// defect 4: F32-contract inputs above the F32 range
annotation {"Feature Type Name":"hugeDepth"}
export const hugeDepth=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 prism(context,id+"p",vector(0,0,0),vector(0,0,1),vector(1,0,0),[vector(0,0),vector(10,0),vector(10,10),vector(0,10)],vector(0,0,1),1e39);
});
annotation {"Feature Type Name":"hugeOffset"}
export const hugeOffset=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 var b=box(context,id+"b",vector(0,0,0),vector(10,10,10));
 opPattern(context,id+"p",{"entities":b,"transforms":[transform(vector(1e39,0,0)*millimeter)],"instanceNames":["far"]});
});
annotation {"Feature Type Name":"trySilentHuge"}
export const trySilentHuge=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 try silent(prism(context,id+"p",vector(0,0,0),vector(0,0,1),vector(1,0,0),[vector(0,0),vector(10,0),vector(10,10),vector(0,10)],vector(0,0,1),1e39));
 box(context,id+"b",vector(20,0,0),vector(30,10,10));
});
// defect 6: kernel failures inside try: the decorate idiom, a fallback handler, try silent
annotation {"Feature Type Name":"decorated"}
export const decorated=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 try { loftOff(context,id+"z",vector(0,0,0),5,4,0,0); } catch (e) { throw regenError("decorated: the loft failed"); }
});
annotation {"Feature Type Name":"decoratedMessage"}
export const decoratedMessage=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 box(context,id+"b",vector(20,0,0),vector(30,10,10));
 try { loftOff(context,id+"z",vector(0,0,0),5,4,0,0); } catch (e) { throw regenError("R4 build: " ~ e); }
});
annotation {"Feature Type Name":"fallback"}
export const fallback=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 try { loftOff(context,id+"z",vector(0,0,0),5,4,0,0); } catch (e) { box(context,id+"fb",vector(0,0,0),vector(10,10,10)); }
});
annotation {"Feature Type Name":"silentNullVolume"}
export const silentNullVolume=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 var p=box(context,id+"p",vector(0,0,0),vector(40,20,5)); subtract(context,id+"h",p,cylinder(context,id+"t",vector(10,10,-1),2,7));
 opPattern(context,id+"q",{"entities":p,"transforms":[transform(rotz(90*degree),vector(100,0,0)*millimeter)],"instanceNames":["r"]});
 var q=qCreatedBy(id+"q",EntityType.BODY);
 try silent(subtract(context,id+"h2",q,cylinder(context,id+"t2",vector(90,20,-1),2,7)));
 box(context,id+"b",vector(200,0,0),vector(210,10,10));
});
// defect 4, continued: a Boolean and a pattern consume an above-F32-range body.
// Nothing native may consume it before today's decoder rejects it (stage boundary).
annotation {"Feature Type Name":"hugeConsumed"}
export const hugeConsumed=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 var a=box(context,id+"a",vector(0,0,0),vector(10,10,10));
 var p=prism(context,id+"p",vector(5,5,0),vector(0,0,1),vector(1,0,0),[vector(0,0),vector(10,0),vector(10,10),vector(0,10)],vector(0,0,1),1e39);
 try silent(unite(context,id+"u",a,p));
 opPattern(context,id+"q",{"entities":a,"transforms":[transform(vector(20,0,0)*millimeter)],"instanceNames":["c"]});
});
