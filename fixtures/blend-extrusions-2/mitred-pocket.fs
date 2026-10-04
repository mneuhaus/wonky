FeatureScript 3044;import(path:"onshape/std/geometry.fs",version:"3044.0");function profile(s,scale) {
const p=[vector(0,-5),vector(10,-5),vector(15,0),vector(15,2),vector(10,7),vector(0,7),vector(-5,2),vector(-5,0)];
const m=[vector(13,-4),vector(14,5),vector(-3,6),vector(-4,-3)];
for(var k=0;k<8;k+=1) {
if(k%2==0)skLineSegment(s,"l"~k,{"start":(p[k]*scale+vector(5,1)*(1-scale))*meter,"end":(p[(k+1)%8]*scale+vector(5,1)*(1-scale))*meter});
else skArc(s,"a"~k,{"start":(p[k]*scale+vector(5,1)*(1-scale))*meter,"mid":(m[(k-1)/2]*scale+vector(5,1)*(1-scale))*meter,"end":(p[(k+1)%8]*scale+vector(5,1)*(1-scale))*meter});
} }

export const f=defineFeature(function(context is Context,id is Id,definition is map) precondition{} {
var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});profile(s,1);skSolve(s);
opExtrude(context,id+"outer",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":8*meter});
var t=newSketchOnPlane(context,id+"t",{"sketchPlane":plane(vector(0,0,2)*meter,vector(0,0,1),vector(1,0,0))});const points=[vector(2,-1),vector(8,-1),vector(8,3),vector(2,3)];for(var k=0;k<4;k+=1)skLineSegment(t,"e"~k,{"start":points[k]*meter,"end":points[(k+1)%4]*meter});skSolve(t);
opExtrude(context,id+"pocket",{"entities":qSketchRegion(id+"t"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":8*meter});
opBoolean(context,id+"open",{"targets":qCreatedBy(id+"outer",EntityType.BODY),"tools":qCreatedBy(id+"pocket",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});
const edges=qOwnedByBody(qCreatedBy(id+"outer",EntityType.BODY),EntityType.EDGE);
var floor=[];for(var p in [[5,-1],[8,1],[5,3],[2,1]])floor=append(floor,qClosestTo(edges,vector(p[0],p[1],2)*meter));opChamfer(context,id+"floor",{"entities":qUnion(floor),"chamferType":ChamferType.EQUAL_OFFSETS,"width":0.5*meter});var rim=[];for(var p in [[5,-5],[13,-4],[15,1],[14,5],[5,7],[-3,6],[-5,1],[-4,-3]])rim=append(rim,qClosestTo(edges,vector(p[0],p[1],8)*meter));


});
