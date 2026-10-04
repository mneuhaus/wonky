#!/usr/bin/env node
// Live inputs for quadratic prism contacts. No catalog/score contract is changed.
// Public-corpus windows have unspecified axial placement: centre them, with
// paired keys on opposite sides. Unchamfered pins gate crossing capability;
// full pins separately preserve the named, out-of-scope blend refusal.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const keywayCases=[
  ['b0baf87576',50,80,5,3,20,2],
  ['e74ef5c001',30,50,7,4,20,1],
  ['e74ef5c002',50,80,5,5,20,2],
  ['e74ef5c003',30,60,6,3,30,2],
  ['e74ef5c004',50,80,8,4,50,1],
  ['e74ef5c005',50,80,8,3,50,2],
];
const cylinder=(name,radius,length,x=0)=>`fCylinder(context,id+"${name}",{"bottomCenter":vector(${x},0,0)*millimeter,"topCenter":vector(${x},0,${length})*millimeter,"radius":${radius}*millimeter});`;
const box=(name,a,b)=>`fCuboid(context,id+"${name}",{"corner1":vector(${a.join(',')})*millimeter,"corner2":vector(${b.join(',')})*millimeter});`;
const bodyQuery=name=>`qCreatedBy(id+"${name}",EntityType.BODY)`;
const subtract=(target,tools)=>`opBoolean(context,id+"cut",{"targets":${bodyQuery(target)},"tools":qUnion([${tools.map(bodyQuery).join(',')}]),"operationType":BooleanOperationType.SUBTRACTION});`;
export const featureSource=body=>`FeatureScript 3044;
import(path:"onshape/std/geometry.fs",version:"3044.0");
export const probe=defineFeature(function(context is Context,id is Id,definition is map) precondition {} {${body}});\n`;

export function keywayBody([,diameter,length,width,depth,height,count]){
  const radius=diameter/2,half=width/2,low=(length-height)/2;
  let body=cylinder('shaft',radius,length);
  for(let i=0;i<count;i++){
    const y0=i===0?radius-depth:-radius-1,y1=i===0?radius+1:-radius+depth;
    body+=box(`key${i}`,[-half,y0,low],[half,y1,low+height]);
  }
  return body+subtract('shaft',Array.from({length:count},(_,i)=>`key${i}`));
}
export function keywayVolume([,diameter,length,width,depth,height,count]){
  const radius=diameter/2,half=width/2;
  // Integral from -half to +half of sqrt(radius^2-x^2)-(radius-depth).
  const strip=half*Math.sqrt(radius**2-half**2)+radius**2*Math.asin(half/radius)-width*(radius-depth);
  return Math.PI*radius**2*length-count*height*strip;
}

export function probeSources(){
  const inputs=keywayCases.map(c=>({name:c[0],source:featureSource(keywayBody(c)),expectedMm3:keywayVolume(c)}));
  inputs.push({name:'ac73-hub-proposal',expectedMm3:1125*Math.PI-90+75*Math.asin(3/5),source:featureSource(
    cylinder('hub',10,12)+
    `fCylinder(context,id+"bore",{"bottomCenter":vector(0,0,-1)*millimeter,"topCenter":vector(0,0,13)*millimeter,"radius":2.5*millimeter});`+
    box('key',[0,-1.5,-1],[3.5,1.5,13])+subtract('hub',['bore','key']))});
  inputs.push({name:'ac73-shaft-proposal',expectedMm3:750*Math.PI+84-350*Math.asin(3/5),source:featureSource(
    cylinder('shaft',5,30,40)+box('slot',[37,3,8],[43,7,22])+subtract('shaft',['slot']))});
  const chamfer=(target,width)=>{
    const edges=`qOwnedByBody(${bodyQuery(target)},EntityType.EDGE)`;
    // Slots trim the rims into arcs. Select both full circles and their retained
    // arc pieces rather than accidentally presenting an empty spring-pin query.
    return `opChamfer(context,id+"chamfer",{"entities":qUnion([qGeometry(${edges},GeometryType.CIRCLE),qGeometry(${edges},GeometryType.ARC)]),"chamferType":ChamferType.EQUAL_OFFSETS,"width":${width}*millimeter});`;
  };
  const slottedPin=cylinder('pin',0.5,2.5)+box('slot',[-0.1,-1,1.87],[0.1,1,2.6])+subtract('pin',['slot']);
  const removedStrip=0.1*Math.sqrt(0.5**2-0.1**2)+0.5**2*Math.asin(0.1/0.5);
  inputs.push({name:'c4bad6c5af-unchamfered',expectedMm3:Math.PI*0.5**2*2.5-2*(2.5-1.87)*removedStrip,source:featureSource(slottedPin)});
  inputs.push({name:'c4bad6c5af-full',source:featureSource(
    cylinder('pin',0.5,2.5)+box('slot',[-0.1,-1,1.87],[0.1,1,2.5])+subtract('pin',['slot'])+chamfer('pin',0.08))});
  // The spring pin has a full-length 15 degree sector removed, not a rectangular
  // surrogate. A sketch wedge extends beyond the OD. Both tube rims are chamfered.
  const springPin=
    cylinder('pin',0.65,4)+cylinder('bore',0.4,4)+`
    var s=newSketchOnPlane(context,id+"wedgeSketch",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1),vector(1,0,0))});
    skPolyline(s,"w",{"points":[vector(0,0)*millimeter,vector(2*cos(7.5*degree),-2*sin(7.5*degree))*millimeter,vector(2*cos(7.5*degree),2*sin(7.5*degree))*millimeter,vector(0,0)*millimeter]});
    skSolve(s);opExtrude(context,id+"wedge",{"entities":qSketchRegion(id+"wedgeSketch"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":4*millimeter});`+
    subtract('pin',['bore','wedge']);
  inputs.push({name:'740b422c57-unchamfered',expectedMm3:Math.PI*(0.65**2-0.4**2)*4*(1-15/360),source:featureSource(springPin)});
  inputs.push({name:'740b422c57-full',source:featureSource(springPin+chamfer('pin',0.35))});
  return inputs;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const out=path.resolve(process.argv[2]??path.join(root,'out/curve-quadratic-probes'));
  fs.mkdirSync(out,{recursive:true});
  const results=[];
  const references=JSON.parse(fs.readFileSync(new URL('../fixtures/curve-quadratic-consumers.json',import.meta.url),'utf8')).references;
  for(const {name,source,expectedMm3} of probeSources()){
    const input=path.join(out,`${name}.fs`),prefix=path.join(out,name);
    fs.writeFileSync(input,source);
    const r=spawnSync(process.execPath,[path.join(root,'bin/wonky.mjs'),input,'--feature','probe','--json','--format','step','--out',prefix],{cwd:root,encoding:'utf8',env:{...process.env,WONKY_BACKEND:'rust'},stdio:['ignore','pipe','inherit']});
    if(r.error)throw r.error;
    fs.writeFileSync(`${prefix}.json`,r.stdout);
    const cli=JSON.parse(r.stdout);
    const measuredMm3=cli.status==='ok'?cli.bodies?.reduce((n,b)=>n+b.volumeMm3,0):undefined;
    const withinClosedForm=expectedMm3===undefined?undefined:cli.status==='ok'&&Math.abs(measuredMm3-expectedMm3)<=1e-10*Math.abs(expectedMm3);
    const reference=references[name.replace(/-(unchamfered|full)$/,'')];
    const referenceDeltaMm3=measuredMm3===undefined||!reference?undefined:measuredMm3-reference.volumeMm3;
    const withinReference=reference&&!reference.containsChamfers?cli.status==='ok'&&Math.abs(referenceDeltaMm3)<=0.00005:undefined;
    results.push({name,exit:r.status,status:cli.status,expectedMm3,measuredMm3,withinClosedForm,referenceMm3:reference?.volumeMm3,referenceContainsChamfers:reference?.containsChamfers,referenceDeltaMm3,withinReference,refusals:cli.refusals?.map(x=>x.code),sourceHash:cli.backend?.sourceHash});
    console.log(JSON.stringify(results.at(-1)));
    if(![0,2].includes(r.status)||withinClosedForm===false||withinReference===false)process.exitCode=1;
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
  if(!process.exitCode&&results.some(r=>r.status!=='ok'))process.exitCode=2;
}
