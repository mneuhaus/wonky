// Measured practical contracts. No audit classification is an acceptance input.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, readJSON, sha256} from './common.mjs';
import {canonical} from './evidence.mjs';

export function loadToleranceRules(file=path.join(ROOT,'fixtures/cad-acid/tolerance-rules.json')) {
  const rules=readJSON(file), ids=new Set();
  if(rules.schema!=='wonky/cad-acid-tolerance-rules/1'||!rules.version||!Array.isArray(rules.rules))throw new Error('TOLERANCE_RULES_SCHEMA');
  for(const rule of rules.rules) {
    const a=rule.acceptance;
    if(!rule.id||ids.has(rule.id)||!rule.phenomenon||!rule.date||!rule.evidence?.length||!rule.kernels?.length||
      rule.kernels.some(k=>!['onshape','occt'].includes(k))||a?.kind!=='parallel-capped-cylinder-imprint'||
      !['zero','positive-below-limit'].includes(a.inputGap)||!Number.isFinite(a.maxInputGapMm)||a.maxInputGapMm<0||
      !(a.supportAbsMm>0)||!(a.angularAbs>0))throw new Error('TOLERANCE_RULES_SCHEMA');
    ids.add(rule.id);
  }
  return rules;
}

const near=(a,b,t)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=t;
const relative=(a,b,t)=>near(a,b,Math.abs(b)*t);
// Catalog coordinates use decimal sums, not an executable expression language.
function scalar(value) {
  if(typeof value==='number')return Number.isFinite(value)?value:NaN;
  if(typeof value!=='string'||!/^\s*[+-]?\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)*\s*$/.test(value))return NaN;
  return value.split('+').reduce((sum,x)=>sum+Number(x),0);
}
function cylinders(zone) {
  const p=zone.construction?.params;
  if(p?.op!=='UNION'||!p.C1?.center||!p.C2?.center)return null;
  const result=[p.C1,p.C2].map(c=>({center:c.center.map(scalar),radius:scalar(c.r),z:c.z?.map(scalar)}));
  if(result.some(c=>c.center.length!==2||!c.center.every(Number.isFinite)||!(c.radius>0)||c.z?.length!==2||!c.z.every(Number.isFinite)||!(c.z[1]>c.z[0])))return null;
  if(result[0].z.some((x,i)=>x!==result[1].z[i]))return null;
  return result;
}

let frozenEvidence;
function evidence() {
  if(frozenEvidence)return frozenEvidence;
  const dir=path.join(ROOT,'fixtures/cad-acid/occt'), manifest=path.join(dir,'tolerance-SHA256SUMS');
  if(!fs.existsSync(manifest))return {rows:[],files:{}};
  const files={}, text=fs.readFileSync(manifest,'utf8');
  for(const line of text.trim().split('\n')) {
    const m=line.match(/^([a-f0-9]{64}) {2}(.+)$/), file=m&&path.resolve(dir,m[2]);
    if(!m||!file.startsWith(dir+path.sep)||files[m[2]]||sha256(fs.readFileSync(file))!==m[1])throw new Error('TOLERANCE_EVIDENCE_CHECKSUM');
    files[m[2]]=m[1];
  }
  if(!files['tolerance-witness.json'])throw new Error('TOLERANCE_WITNESS_UNHASHED');
  const data=readJSON(path.join(dir,'tolerance-witness.json'));
  if(data.schema!=='wonky/cad-acid-tolerance-witness/1'||!Array.isArray(data.rows))throw new Error('TOLERANCE_WITNESS_SCHEMA');
  const original=readJSON(path.join(dir,'observations.json')), seen=new Set();
  for(const row of data.rows) {
    const key=`${row.kernel}/${row.zone}/${row.variant}`;
    const source=original.rows.find(r=>r.kernel===row.kernel&&r.zone===row.zone&&r.variant===row.variant);
    const digest=source&&sha256(canonical({metrics:source.metrics,stepRoundTrip:source.stepRoundTrip,nativeValidity:source.nativeValidity}));
    const stepFile=row.stepFile, stepHash=row.sourceSTEPsha256;
    if(seen.has(key)||!source||digest!==row.observationSha256||
      typeof stepFile!=='string'||!stepFile.startsWith('artifacts/')||!stepFile.endsWith('.step')||/[\\\x00-\x1f]/.test(stepFile)||
      stepFile.split('/').some(part=>!part||part==='.'||part==='..')||path.isAbsolute(stepFile)||
      typeof stepHash!=='string'||!(/^[a-f0-9]{64}$/.test(stepHash))||
      !Object.hasOwn(files,stepFile)||files[stepFile]!==stepHash)throw new Error('TOLERANCE_WITNESS_BINDING');
    seen.add(key);
  }
  frozenEvidence={rows:data.rows,files:{...files,'tolerance-SHA256SUMS':sha256(text)}};
  return frozenEvidence;
}

// A genus from seam-quotiented edge counts is not physical genus. Keep v1's
// diagnostic untouched; independently use the raw disk-face cell decomposition.
function rawGenus(body) {
  const t=body.rawTopology;
  if(!t||t.shells!==1||t.loops!==t.faces||!['faces','edges','vertices'].every(k=>Number.isInteger(t[k])&&t[k]>=0))return null;
  return (2*t.shells-(t.vertices-t.edges+t.faces))/2;
}
function supportMatches(body,c,a,zone) {
  const height=c.z[1]-c.z[0], volume=Math.PI*c.radius*c.radius*height, area=2*Math.PI*c.radius*(height+c.radius);
  if(body.valid!==true||body.closed!==true||body.nondegenerateEdges!==true||rawGenus(body)!==0||body.rawGenus!==0||body.rawEuler!==2||
    !relative(body.volume,volume,zone.tolerance.volumeRel.tolerance)||!relative(body.area,area,zone.tolerance.areaRel.tolerance))return false;
  if(!body.cylinders?.length||!body.planes?.length||body.otherSurfaces?.length!==0||body.allFacesSingleWire!==true)return false;
  if(body.cylinders.some(s=>!near(s.radius,c.radius,a.supportAbsMm)||
    ![0,1].every(i=>near(s.axisOrigin?.[i],c.center[i],a.supportAbsMm))||
    !near(s.axisDirection?.[0],0,a.angularAbs)||!near(s.axisDirection?.[1],0,a.angularAbs)||!near(Math.abs(s.axisDirection?.[2]),1,a.angularAbs)||
    !near(Math.min(s.axisOrigin?.[2]+s.axialMin*s.axisDirection?.[2],s.axisOrigin?.[2]+s.axialMax*s.axisDirection?.[2]),c.z[0],a.supportAbsMm)||!near(Math.max(s.axisOrigin?.[2]+s.axialMin*s.axisDirection?.[2],s.axisOrigin?.[2]+s.axialMax*s.axisDirection?.[2]),c.z[1],a.supportAbsMm)))return false;
  if(!relative(body.cylinders.reduce((sum,s)=>sum+s.area,0),2*Math.PI*c.radius*height,zone.tolerance.areaRel.tolerance))return false;
  const caps=[0,0];
  for(const plane of body.planes) {
    if(!near(plane.normal?.[0],0,a.angularAbs)||!near(plane.normal?.[1],0,a.angularAbs)||!near(Math.abs(plane.normal?.[2]),1,a.angularAbs)||!(plane.area>0))return false;
    const at=c.z.findIndex(z=>near(plane.origin?.[2],z,a.supportAbsMm));
    if(at<0)return false;
    caps[at]+=plane.area;
  }
  return caps.every(area=>relative(area,Math.PI*c.radius*c.radius,zone.tolerance.areaRel.tolerance));
}
function measuredTopology(metrics,witness,zone) {
  if(metrics.bodies?.length!==2||metrics.topology?.bodies!==2||metrics.topology?.shells!==2||
    metrics.topology?.singularPoints!==0||metrics.topology?.pinchPoints!==0)return false;
  const types=metrics.surfaceTypes;
  if(!types||Object.keys(types).some(t=>!['Cylinder','Plane'].includes(t))||!(types.Cylinder>=2)||!(types.Plane>=4))return false;
  const remaining=[...metrics.bodies];
  for(const body of witness.bodies) {
    const i=remaining.findIndex(m=>m.valid===true&&m.rawTopology?.bodies===1&&rawGenus(m)===0&&
      relative(m.volume,body.volume,zone.tolerance.volumeRel.tolerance)&&relative(m.area,body.area,zone.tolerance.areaRel.tolerance));
    if(i<0)return false;
    remaining.splice(i,1);
  }
  return remaining.length===0;
}

// Called by the scorer on every zone, not by a zone allowlist. Witness lookup
// supplies observed geometry only; it cannot override any measurable contract.
export function toleranceContract(zone,kernel,rule,row) {
  if(!['occt','onshape'].includes(kernel)||!rule.kernels.includes(kernel))return null;
  const cs=cylinders(zone), a=rule.acceptance;
  if(!cs)return null;
  const gap=Math.hypot(...cs[0].center.map((x,i)=>x-cs[1].center[i]))-cs[0].radius-cs[1].radius;
  if(a.inputGap==='zero'?gap!==0:!(gap>0&&gap<a.maxInputGapMm))return null;
  const data=evidence(), item=data.rows.find(w=>w.kernel===kernel&&w.zone===row.zone&&w.variant===row.variant);
  const witness=item?.witness;
  for(const stage of [witness?.stepImport,witness?.stepRoundTrip]) {
    if(stage?.bodies?.length!==2||stage.valid!==true||stage.closed!==true)return null;
    const remaining=[...stage.bodies];
    for(const c of cs) {
      const i=remaining.findIndex(body=>supportMatches(body,c,a,zone));
      if(i<0)return null;
      remaining.splice(i,1);
    }
  }
  const branch=zone.expected.outcomes.find(b=>b.kind==='geometry'&&b.closedForm==='primary'&&b.bodies===2);
  if(!branch)return null;
  return {zone,branch,topologyPolicy:{
    fields:['faces','edges','vertices','genus'],
    accepts:metrics=>measuredTopology(metrics,witness.stepImport,zone),
  },witness:{stepFile:item.stepFile,sourceSTEPsha256:item.sourceSTEPsha256,observationSha256:item.observationSha256,
    manifestSha256:data.files['tolerance-SHA256SUMS']}};
}
