// W2 re-baseline fixtures (local-development-evidence): the F32x2 profile
// ring merge and polygon prism of production, through the WK evaluator. Helpers as round3.fs.
FeatureScript 2892;
import(path : "onshape/std/common.fs", version : "2892.0");
function prism(context is Context,id is Id,o is Vector,n is Vector,x is Vector,pts is array,d is Vector,h is number) returns Query
{
 var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(o*millimeter,n,x)});
 var q=[];for(var p in pts){q=append(q,p*millimeter);} q=append(q,pts[0]*millimeter);
 skPolyline(s,"o",{"points":q});skSolve(s);
 opExtrude(context,id+"ex",{"entities":qSketchRegion(id+"s",true),"direction":d,"endBound":BoundingType.BLIND,"endDepth":h*millimeter});
 opDeleteBodies(context,id+"ds",{"entities":qCreatedBy(id+"s",EntityType.BODY)});return qCreatedBy(id+"ex",EntityType.BODY);
}
function boxBody(context is Context,id is Id,p0 is Vector,p1 is Vector) returns Query
{return prism(context,id,vector(0,0,p0[2]),vector(0,0,1),vector(1,0,0),[vector(p0[0],p0[1]),vector(p1[0],p0[1]),vector(p1[0],p1[1]),vector(p0[0],p1[1])],vector(0,0,1),p1[2]-p0[2]);}
function subtract(context is Context,id is Id,b is Query,tool is Query)
{opBoolean(context,id,{"targets":b,"tools":tool,"operationType":BooleanOperationType.SUBTRACTION});}
function unite(context is Context,id is Id,a is Query,b is Query)
{opBoolean(context,id,{"tools":qUnion([a,b]),"operationType":BooleanOperationType.UNION});}
function rotz(a is ValueWithUnits) returns Matrix
{return matrix([[cos(a),-sin(a),0],[sin(a),cos(a),0],[0,0,1]]);}

// A near-collinear vertex (1e-6 mm off the line, tolerance 1e-5 mm): a regularized
// merge, recorded; then a rigid copy (it keeps the record) and a planar union.
annotation {"Feature Type Name":"regularizedMerge"}
export const regularizedMerge=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 var p=prism(context,id+"p",vector(0,0,0),vector(0,0,1),vector(1,0,0),[vector(0,0),vector(10,0.000001),vector(20,0),vector(20,10),vector(0,10)],vector(0,0,1),5);
 opPattern(context,id+"c",{"entities":p,"transforms":[transform(rotz(30*degree),vector(40,0,0)*millimeter)],"instanceNames":["r"]});
 var b=boxBody(context,id+"b",vector(5,5,0),vector(15,30,5));
 unite(context,id+"u",p,b);
});
// A sketch plane whose x axis is 1e-7 off perpendicular: the host admits it (1e-5),
// prismInputs regularizes only up to 1e-8, so the prism refuses it by name
// (InvalidFrame, budget 1e-11).
annotation {"Feature Type Name":"invalidFrame"}
export const invalidFrame=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 prism(context,id+"p",vector(0,0,0),vector(0,0,1),vector(1,0,0.0000001),[vector(0,0),vector(10,0),vector(10,10),vector(0,10)],vector(0,0,1),5);
});
// W2 integrate: a generated plane (x 8.43e-11 off perpendicular, as archive-r16/hopper.fs:121):
// src/kernel.mjs prismInputs projects x and records construction.frameRegularization.
annotation {"Feature Type Name":"generatorFrame"}
export const generatorFrame=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 prism(context,id+"p",vector(0,0,0),vector(0,0,1),vector(1,0,0.0000000000843),[vector(0,0),vector(10,0),vector(10,10),vector(0,10)],vector(0,0,1),5);
});
// W2 integrate: an open-top tray. The two tops are reached by different sums (0 + 11.78 and
// 1.68 + 10.1); prismInputs sums the cap origins in binary64, so they get equal words.
annotation {"Feature Type Name":"coplanarTray"}
export const coplanarTray=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 var a=boxBody(context,id+"a",vector(-28,-14.72,0),vector(28,14.72,11.78));
 var b=boxBody(context,id+"b",vector(-26.32,-12.2,1.68),vector(26.32,12.2,11.78));
 subtract(context,id+"s",a,b);
});
// A tilted, rotated copy cut by a box: prism transform words through the round trip into a planar Boolean.
annotation {"Feature Type Name":"rotatedCut"}
export const rotatedCut=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 var p=prism(context,id+"p",vector(3,-2,1),vector(0,0.6,0.8),vector(1,0,0),[vector(0,0),vector(30,0),vector(30,20),vector(15,20),vector(0,20)],vector(0,0.6,0.8),12);
 opPattern(context,id+"c",{"entities":p,"transforms":[transform(rotz(37*degree),vector(0,0,0)*millimeter)],"instanceNames":["r"]});
 var b=boxBody(context,id+"b",vector(-5,-5,-5),vector(12,40,40));
 subtract(context,id+"s",qCreatedBy(id+"c",EntityType.BODY),b);
});
// W2 integrate fix 1: a regularized plate (a vertex 5e-6 mm off the line) cut by a box and
// pierced: the Boolean and the pierce results state exactness 'regularized' and name the merge
// (src/exactness.mjs), and the pierce scope says its volume is exact only relative to it.
annotation {"Feature Type Name":"regularizedCut"}
export const regularizedCut=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 var p=prism(context,id+"p",vector(0,0,0),vector(0,0,1),vector(1,0,0),[vector(0,0),vector(20,0),vector(20.000005,8),vector(20,16),vector(0,16)],vector(0,0,1),5);
 var b=boxBody(context,id+"b",vector(5,4,-1),vector(10,12,6));
 subtract(context,id+"s",p,b);
});
annotation {"Feature Type Name":"regularizedPierce"}
export const regularizedPierce=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 var p=prism(context,id+"p",vector(0,0,0),vector(0,0,1),vector(1,0,0),[vector(0,0),vector(20,0),vector(20.000005,8),vector(20,16),vector(0,16)],vector(0,0,1),5);
 var s=newSketchOnPlane(context,id+"hs",{"sketchPlane":plane(vector(0,0,-1)*millimeter,vector(0,0,1),vector(1,0,0))});
 skCircle(s,"c",{"center":vector(10,8)*millimeter,"radius":2*millimeter});skSolve(s);
 opExtrude(context,id+"h",{"entities":qSketchRegion(id+"hs",true),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":7*millimeter});
 subtract(context,id+"s",p,qCreatedBy(id+"h",EntityType.BODY));
 opPattern(context,id+"c",{"entities":qCreatedBy(id+"s",EntityType.BODY),"transforms":[transform(vector(0,30,0)*millimeter)],"instanceNames":["t"]});
});
// W2 integrate fix 2: a pocket built centred and moved twice by opPattern translations
// (6.73 = 3 + 3.73) so its top lands on the box top (11.78): an open-top pocket. The
// translations are folded into the prism (src/kernel.mjs translatedPrismInputs), so the tops
// get equal words; the F32x2 transform left them 2.9e-14 mm apart (AmbiguousContact).
annotation {"Feature Type Name":"patternFlush"}
export const patternFlush=defineFeature(function(context is Context,id is Id,definition is map)
precondition {}
{
 var a=boxBody(context,id+"a",vector(0,0,0),vector(30,30,11.78));
 var t=boxBody(context,id+"t",vector(5,5,-5.05),vector(25,25,5.05));
 opPattern(context,id+"m1",{"entities":t,"transforms":[transform(vector(0,0,3)*millimeter)],"instanceNames":["a"]});
 opPattern(context,id+"m2",{"entities":qCreatedBy(id+"m1",EntityType.BODY),"transforms":[transform(vector(0,0,3.73)*millimeter)],"instanceNames":["b"]});
 subtract(context,id+"s",a,qCreatedBy(id+"m2",EntityType.BODY));
});
