const q = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;
const vec = a => `vector(${a.join(',')})`;
export const box = (id,lo,hi) => `fCuboid(context,id+"${id}",{"corner1":${vec(lo)}*meter,"corner2":${vec(hi)}*meter});`;
export const cylinder = (id,lo,hi,r) => `fCylinder(context,id+"${id}",{"bottomCenter":${vec(lo)}*meter,"topCenter":${vec(hi)}*meter,"radius":${r}*meter});`;
const sphere = (id,c,r) => `fSphere(context,id+"${id}",{"center":${vec(c)}*meter,"radius":${r}*meter});`;
export function prism(id,points,depth,origin=[0,0,0],normal=[0,0,1]) {
  return `const ${id}sketch=newSketchOnPlane(context,id+"${id}sketch",{"sketchPlane":plane(${vec(origin)}*meter,${vec(normal)},vector(1,0,0))});
    skPolyline(${id}sketch,"p",{"points":[${[...points,points[0]].map(p=>`${vec(p)}*meter`).join(',')}]}); skSolve(${id}sketch);
    opExtrude(context,id+"${id}",{"entities":qSketchRegion(id+"${id}sketch",false),"direction":${vec(normal)},"endBound":BoundingType.BLIND,"endDepth":${depth}*meter});
    opDeleteBodies(context,id+"${id}clean",{"entities":qCreatedBy(id+"${id}sketch",EntityType.BODY)});`;
}
const turn = (id,x) => `opTransform(context,id+"${id}turn",{"bodies":${q(id)},"transform":toWorld(coordSystem(vector(0,0,0)*meter,${vec(x)},vector(0,0,1)))});`;
export function generators(large=false) {
  const cases=[];
  const scales=large?[.005,.01,.125,.5,1,2,10,100]:[.005,1,100];
  const push=(id,route,a,b)=>cases.push({id,route,a,b});
  for(const s of scales) {
    const v=a=>a.map(x=>x*s), bx=(id,a,b)=>box(id,v(a),v(b));
    const cy=(id,a,b,r)=>cylinder(id,v(a),v(b),r*s);
    for(const [name,lo,hi] of [
      ['overlap',[1,1,1],[3,3,3]],['face',[2,0,0],[4,2,2]],
      ['edge',[2,2,0],[4,4,2]],['vertex',[2,2,2],[4,4,4]],
      ['coplanar',[1,1,0],[3,3,2]],['nested',[.5,.5,.5],[1.5,1.5,1.5]],
      ['disjoint',[4,3,2],[6,5,4]],['long',[1,.25,.25],[100,.75,.75]],
      ['thin',[1,1,0],[3,3,.0001]],
    ]) push(`box-${name}-${s}`,'orthogonal',bx('a',[0,0,0],[2,2,2]),bx('b',lo,hi));
    const triangle=[[0,0],[3,0],[1,3]].map(v), concave=[[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]].map(v);
    push(`convex-${s}`,'plane-arrangement',prism('a',triangle,2*s),bx('b',[.5,.5,.5],[2,2,3]));
    push(`concave-${s}`,'general-model',prism('a',concave,2*s),bx('b',[.5,.5,.5],[2,2,3]));
    for(const [name,x] of [['345',[4,3,0]],['51213',[12,5,0]]])
      push(`frame-${name}-${s}`,'plane-arrangement',bx('a',[-1,-1,0],[1,1,2])+turn('a',x),bx('b',[0,-1,.5],[2,1,3]));
    for(const [name,rows,denominator] of [['345',[[4,-3,0],[3,4,0],[0,0,5]],5],['51213',[[12,-5,0],[5,12,0],[0,0,13]],13]]) {
      push(`rational-${name}-${s}`,'rational-plane-arrangement',bx('a',[-1,-1,0],[1,1,2]),bx('b',[0,-1,.5],[2,1,3]));
      cases.at(-1).rational={rows,denominator};
    }
    push(`coaxial-${s}`,'coaxial',cy('a',[0,0,0],[0,0,3],2),cy('b',[0,0,1],[0,0,4],1));
    push(`parallel-${s}`,'parallel-cylinders',cy('a',[0,0,0],[0,0,3],2),cy('b',[2,0,0],[2,0,3],2));
    push(`cylinder-contact-${s}`,'parallel-cylinders',cy('a',[0,0,0],[0,0,3],2),cy('b',[4,0,0],[4,0,3],2));
    push(`cylinder-disjoint-${s}`,'parallel-cylinders',cy('a',[0,0,0],[0,0,3],2),cy('b',[6,0,0],[6,0,3],2));
    push(`cylinder-box-${s}`,'columns-holes-stack',bx('a',[-2,-2,0],[2,2,2]),cy('b',[0,0,-1],[0,0,3],1));
    push(`sphere-halfspace-${s}`,'sphere-box',sphere('a',[0,0,0],2*s),bx('b',[0,-3,-3],[3,3,3]));
    push(`cross-cylinder-${s}`,'tee-bicylinder',cy('a',[-3,0,0],[3,0,0],1),cy('b',[0,0,-3],[0,0,3],1));
    push(`tee-unequal-${s}`,'tee-bicylinder',cy('a',[0,0,-11],[0,0,11],7),cy('b',[0,0,0],[19,0,0],3));
    push(`axial-pythagorean-${s}`,'axial',sphere('a',[0,0,0],5*s),cy('b',[0,0,-10],[0,0,10],3));
    push(`sphere-cylinder-${s}`,'axial',sphere('a',[0,0,0],2*s),cy('b',[0,0,-3],[0,0,3],1));
    push(`sphere-sphere-${s}`,'lens',sphere('a',[0,0,0],2*s),sphere('b',[s,0,0],2*s));
    push(`different-axis-${s}`,'plane-arrangement',prism('a',triangle,2*s),prism('b',triangle,2*s,v([0,1,0]),[0,1,0]));
  }
  const cut=(target,tool)=>`opBoolean(context,id+"prepare",{"targets":${q(target)},"tools":${q(tool)},"operationType":BooleanOperationType.SUBTRACTION});`;
  const join=(target,tool)=>`opBoolean(context,id+"prepare",{"tools":qUnion([${q(target)},${q(tool)}]),"operationType":BooleanOperationType.UNION});`;
  const plate=box('a',[-3,-3,0],[3,3,2]);
  const drill=cylinder('c',[0,0,-1],[0,0,3],1);
  push('holed-recut','holes-replay',plate+drill+cut('a','c'),cylinder('b',[2,0,-1],[2,0,3],.5));
  push('holed-prism-recut','holes-replay',prism('a',[[0,0],[6,0],[0,6]],2)+cylinder('c',[1,1,-1],[1,1,3],.25)+cut('a','c'),cylinder('b',[3,1,-1],[3,1,3],.25));
  push('column-cylinder-recut','columns-replay',plate+cylinder('c',[0,0,1],[0,0,4],1)+join('a','c'),cylinder('b',[2,0,1],[2,0,4],.5));
  push('column-recut','columns-replay',plate+cylinder('c',[0,0,1],[0,0,4],1)+join('a','c'),box('b',[-1,-1,1],[1,1,5]));
  const stadium=`const asketch=newSketchOnPlane(context,id+"as",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});
    skLineSegment(asketch,"bottom",{"start":vector(-2,-1)*meter,"end":vector(2,-1)*meter});
    skArc(asketch,"right",{"start":vector(2,-1)*meter,"mid":vector(3,0)*meter,"end":vector(2,1)*meter});
    skLineSegment(asketch,"top",{"start":vector(2,1)*meter,"end":vector(-2,1)*meter});
    skArc(asketch,"left",{"start":vector(-2,1)*meter,"mid":vector(-3,0)*meter,"end":vector(-2,-1)*meter});skSolve(asketch);
    opExtrude(context,id+"a",{"entities":qSketchRegion(id+"as",false),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":2*meter});
    opDeleteBodies(context,id+"aclean",{"entities":qCreatedBy(id+"as",EntityType.BODY)});`;
  push('stack-recut','stack-replay',stadium+box('c',[-.5,-.5,1],[.5,.5,3])+cut('a','c'),cylinder('b',[1,0,-1],[1,0,3],.25));
  push('cylinder-pocket','holes-pocket',cylinder('a',[0,0,0],[0,0,3],2),box('b',[-1,-1,1],[1,1,4]));
  push('coaxial-recut','coaxial-replay',cylinder('a',[0,0,0],[0,0,3],2)+cylinder('c',[0,0,-1],[0,0,4],1)+cut('a','c'),cylinder('b',[0,0,1],[0,0,4],1.5));
  const revolve=(id,points)=>`const ${id}sketch=newSketchOnPlane(context,id+"${id}sketch",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,-1,0),vector(1,0,0))});
    skPolyline(${id}sketch,"p",{"points":[${[...points,points[0]].map(p=>`${vec(p)}*meter`).join(',')}]}); skSolve(${id}sketch);
    opRevolve(context,id+"${id}",{"entities":qSketchRegion(id+"${id}sketch",false),"axis":line(vector(0,0,0)*meter,vector(0,0,1)),"angleForward":360*degree});
    opDeleteBodies(context,id+"${id}clean",{"entities":qCreatedBy(id+"${id}sketch",EntityType.BODY)});`;
  const cone=revolve('a',[[0,0],[2,0],[1,3],[0,3]]);
  push('revolve-coaxial','revolve-profile',cone,cylinder('b',[0,0,1],[0,0,4],.5));
  push('box-revolve','revolve-prism-tools',plate,revolve('b',[[0,-1],[1,-1],[.5,3],[0,3]]));
  const curve=(id)=>`const ${id}sketch=newSketchOnPlane(context,id+"${id}sketch",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});
    skLineSegment(${id}sketch,"bottom",{"start":vector(0,0)*meter,"end":vector(4,0)*meter});
    skLineSegment(${id}sketch,"right",{"start":vector(4,0)*meter,"end":vector(4,4)*meter});
    skBezier(${id}sketch,"arch",{"points":[vector(4,4)*meter,vector(2,6)*meter,vector(0,4)*meter]});
    skLineSegment(${id}sketch,"left",{"start":vector(0,4)*meter,"end":vector(0,0)*meter}); skSolve(${id}sketch);
    opExtrude(context,id+"${id}",{"entities":qSketchRegion(id+"${id}sketch",false),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":3*meter});
    opDeleteBodies(context,id+"${id}clean",{"entities":qCreatedBy(id+"${id}sketch",EntityType.BODY)});`;
  push('polynomial-boss','polynomial-stack',curve('a'),cylinder('b',[2,2,2],[2,2,5],.5));
  // Fixed seeds, precomputed dyadic offsets: no random source is consulted.
  for(const [seed,offset] of [[17,[.125,.375,.625]],[41,[.75,.25,.5]],[73,[1.25,.75,.125]]])
    push(`seed-${seed}`,'orthogonal',box('a',[0,0,0],[2,2,2]),box('b',offset,offset.map(x=>x+2)));
  return cases;
}
export const source = statements => `FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");
export const f=defineFeature(function(context is Context,id is Id,definition is map) precondition {} {${statements}});`;
export function operation(op) {
  return `opBoolean(context,id+"result",{${op==='SUBTRACTION'?`"targets":${q('a')},"tools":${q('b')}`:`"tools":qUnion([${q('a')},${q('b')}])`},"operationType":BooleanOperationType.${op}});`;
}
