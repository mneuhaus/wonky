#!/usr/bin/env node
// Scores observations, never guesses missing measurements or modifies the frozen bands.
import fs from 'node:fs';
import path from 'node:path';
import {ROOT, ALL_VARIANTS, KERNELS, loadCatalog, kernelClass, closedForm, sortBodies, readJSON, writeJSON, isMain, loadErrata, sha256, zoneVariants, requireZonesBound} from './common.mjs';
import {verifyExactObservation,canonical} from './evidence.mjs';
import {executionEvidence,resultsCatalog} from './execution.mjs';
import {loadToleranceRules, toleranceContract, bindToleranceRules} from './tolerance.mjs';
const defaultToleranceRules=loadToleranceRules();
const defaultErrata=loadErrata();
function requireScoringErrata(errata) {
  if(canonical(errata)!==canonical(defaultErrata))throw new Error('ERRATA_RULES_MISMATCH: scoring requires the versioned fixtures/cad-acid/errata.json; overlays cannot produce a production scoreboard');
}
const finite=Number.isFinite;
const rel=(a,b,t)=>finite(a)&&finite(b)&&Math.abs(a-b)<=Math.abs(b)*t;
const abs=(a,b,t)=>finite(a)&&finite(b)&&Math.abs(a-b)<=t;
const val=x=>x?.valueFloat;
const measurementBand=(m,z,cl)=>m.tolerance?.[cl]??{abs:z.tolerance.measureAbsMm[cl]};
const nearMeasurement=(a,b,band)=>band.abs!==undefined?abs(a,b,band.abs):rel(a,b,band.rel);
// A scored topology field. surfaceTypes is the face-class histogram the OCCT observer (measure.py) records beside the
// canonical counts; a native exact observation carries none, and its OCCT-observed STEP round trip is scored instead.
const NATIVE_BASIS='native-f64-construction';
function topologyValue(m,field) { return field==='surfaceTypes'?canonical(m?.surfaceTypes??null):m?.topology?.[field]; }
function topologyMismatch(m,cf,field) {
  if(field!=='surfaceTypes')return m.topology?.[field]!==cf.topology[field]?`${field}: ${m.topology?.[field]} vs ${cf.topology[field]}`:null;
  if(m.basis===NATIVE_BASIS)return null;
  return topologyValue(m,field)!==canonical(cf.topology.surfaceTypes)?`surfaceTypes: ${JSON.stringify(m.surfaceTypes??null)} vs ${JSON.stringify(cf.topology.surfaceTypes)}`:null;
}
function boxEqual(a,b,t) { return a===null&&b===null || a&&b&&['min','max'].every(s=>a[s]?.length===3&&a[s].every((x,i)=>abs(x,b[s][i],t))); }
// Failed observation processes supply no geometric verdict. A completed observer's
// rejection (or an absent round trip without process evidence) remains WRONG.
function stepInfrastructureFailure(rt) {
  const execution=rt?.execution;
  if(rt?.metrics || rt?.ok===true || execution?.ok!==false)return null;
  const failure=execution.error || (execution.signal?`signal ${execution.signal}`:
    execution.stderrTail?.find(line=>/interpreter.*not found|No interpreter found|Failed to spawn/i.test(line)));
  return failure?`observation infrastructure: STEP measurement did not complete (${failure})`:null;
}
function checks(zone,branch,row,cl,{roundTrip=false,reference=null,topologyPolicy=null}={}) {
  const cf=closedForm(zone,branch,row.variant), m=row.metrics, errors=[];
  const bad=(type,reason)=>errors.push({type,reason});
  if (!m) { bad('geometry','missing measurements'); if(!roundTrip&&row.stepRoundTrip?.ok!==true)bad('validity','STEP round trip missing or failed'); return errors; }
  if (m.cellAttribution===false) bad('geometry','body lies outside declared zone cell');
  if (!Array.isArray(m.bodies) || m.bodies.length!==branch.bodies || m.topology?.bodies!==branch.bodies) bad('topology',`body count: expected ${branch.bodies}, got ${m.bodies?.length}/${m.topology?.bodies}`);
  if (!(m.validity?.brep===true && m.validity?.closed===true && m.validity?.positive===true)) bad('validity','BRepCheck/closed shells/positive volume not verified');
  if (!roundTrip && row.nativeValidity!==true) bad('validity','kernel own validity not verified');
  if (cl==='tolerance' && branch.closedForm==='sliverBound') {
    const e=m.localBbox?.min?.map((x,i)=>m.localBbox.max[i]-x);
    if (!e || !(e[0]>0&&e[0]<=2e-5&&abs(e[1],4,1e-4)&&abs(e[2],4,1e-4)&&m.volume>0&&m.volume<=16*2e-5&&abs(m.area,32,1e-3))) bad('geometry','sliverBound: extent, volume or area');
  } else {
    for(const name of ['volume','area']) {
      const expected=val(cf[name]) ?? (cf.crossComparisonOnly?reference?.metrics?.[name]:undefined);
      if(expected!==undefined && !rel(m[name],expected,zone.tolerance[`${name}Rel`][cl])) bad('geometry',`${name}: ${m[name]} vs ${expected}`);
      const b=cf.bounds?.[name];
      if(b && !(finite(m[name]) && (b.strict?m[name]>val(b.lower)&&m[name]<val(b.upper):m[name]>=val(b.lower)&&m[name]<=val(b.upper)))) bad('geometry',`${name}: outside closed-form bounds`);
    }
    if(topologyPolicy&&!topologyPolicy.accepts(m))bad('topology','tolerance rule requires independently witnessed support, per-body genus and preserved material');
    for(const field of cf.topology?.scored??[]) { const mismatch=!topologyPolicy?.fields.includes(field)&&topologyMismatch(m,cf,field); if(mismatch) bad('topology',mismatch); }
    const b=cf.bbox?.variants?.[row.variant];
    const world=b?{min:b.min.map((x,i)=>x+zone.cell.originMm[i]),max:b.max.map((x,i)=>x+zone.cell.originMm[i])}:null;
    if (b || cf.bbox===null) { if(!boxEqual(m.bbox,world,zone.tolerance.bboxAbsMm[cl])) bad('geometry','bounding box differs'); }
    else if(cf.bboxV3CrossComparison&&row.variant==='V3'&&reference&&!boxEqual(m.bbox,reference.metrics.bbox,zone.tolerance.bboxAbsMm[cl])) bad('geometry','V3 reference bbox differs');
    for(const probe of cf.measurements??[]) if(!nearMeasurement(m.measurements?.[probe.name],val(probe),measurementBand(probe,zone,cl))) bad('geometry',`measurement ${probe.name}: ${m.measurements?.[probe.name]} vs ${val(probe)}`);
  }
  if(!roundTrip) {
    const rt=row.stepRoundTrip;
    // AC41's unhealed file exception is declared by the catalog, not a tolerance widening.
    if(zone.id==='AC41'&&['G','G2'].includes(branch.id)&&m.localBbox?.max?.[0]-m.localBbox?.min?.[0]<1e-7) {
      const p=rt?.unhealedSliver;
      if(!(p?.closedShells===1&&p.distinctShellPoints===8&&p.localExtentX>0&&p.localExtentX<=2e-5)) bad('validity','unhealed STEP sliver exception not proven');
    } else if(!rt?.metrics || rt.ok!==true) bad('validity','STEP round trip missing or failed');
    else {
      for(const imported of [rt,...(rt.secondImport?[rt.secondImport]:[])]) {
        if(imported.ok!==true||!imported.metrics) { bad('validity','STEP second import missing or failed'); continue; }
        for(const error of checks(zone,branch,{...row,metrics:imported.metrics},'tolerance',{roundTrip:true,reference,topologyPolicy})) bad('validity',`STEP round trip ${error.reason}`);
        if(!rel(imported.metrics.volume,m.volume,zone.tolerance.volumeRel.tolerance)) bad('validity','STEP round trip changed kernel volume');
      }
    }
  }
  return errors;
}
function acceptedBranches(zone,cl) { return zone.expected.outcomes.filter(o=>o.kernelClass==='any'||o.kernelClass===cl); }
function strictVariant(catalog,zone,kernel,row,reference=null,{errata=defaultErrata,artifactRoot=ROOT,code=null}={}) {
  if(row&&kernel.startsWith('wonky-')) {
    const execution=executionEvidence(row);
    if(!execution||row.kernel!==kernel||row.zone!==zone.id||code&&row.code?.treeSha256!==code.treeSha256)
      return {status:'UNVERIFIED',reason:row.reverification?.reason??'LIVE_EXECUTION_REQUIRED: stored wonky observations require --reverify; artifact self-consistency is not execution'};
  }
  const disputed=errata.entries.filter(e=>e.zones.includes(zone.id)&&(e.kernels.includes('*')||e.kernels.includes(kernel)));
  if(disputed.length)return {status:'DISPUTED',errata:disputed.map(e=>e.id),reason:disputed.map(e=>`${e.id}: ${e.reason}`).join('; ')};
  if(row&&!kernel.startsWith('wonky-')&&(executionEvidence(row)?.status==='unverified'||row.reverification))return {status:'UNVERIFIED',reason:'Frozen external observation could not be verified'};
  // Old post-build failures remain built observations; retain explicit observer infrastructure evidence.
  if(row?.builtBeforeFailure&&row.outcome!=='built')row={...row,outcome:'built',stepRoundTrip:stepInfrastructureFailure(row.stepRoundTrip)?row.stepRoundTrip:{ok:false,error:row.error}};
  if(!row||row.outcome==='not_run') return {status:'NOT_RUN',reason:row?.reason??'variant not executed'};
  const cl=kernelClass(catalog,kernel);
  if(row.outcome==='refused') {
    const r=row.refusal;
    if(!r?.name) return {status:'ERROR',reason:'unnamed refusal'};
    const branch=acceptedBranches(zone,cl).find(o=>o.kind==='refusal'&&o.refusalCategory===r.category);
    const reason=row.error?.message?`${r.name}: ${row.error.message}`:r.name;
    if(branch && r.operationUnderTest===true && r.capability===false) return {status:'REFUSED_EXPECTED',branch:branch.id,reason};
    return {status:'REFUSED',reason};
  }
  if(row.outcome!=='built') return {status:'ERROR',reason:row.error?.message??row.reason??'execution failed'};
  const infrastructure=stepInfrastructureFailure(row.stepRoundTrip)??(row.stepRoundTrip?.ok===true?stepInfrastructureFailure(row.stepRoundTrip.secondImport):null);
  if(infrastructure)return {status:'ERROR',reason:infrastructure};
  // Execution admission above covers every result, including post-build failure.
  // The complete-artifact consistency check only applies when export succeeded;
  // partial failures can be classified solely because we just executed them.
  if(kernel.startsWith('wonky-')&&cl==='exact'&&!(row.builtBeforeFailure===true&&row.stepRoundTrip?.ok===false)) {
    const evidence=verifyExactObservation(zone,row,{artifactRoot,code});
    if(!evidence.ok)return {status:'UNVERIFIED',reason:evidence.reason};
  }
  const candidates=acceptedBranches(zone,cl).filter(o=>o.kind==='geometry').map(branch=>({branch,errors:checks(zone,branch,row,cl,{reference})}));
  const ok=candidates.find(x=>!x.errors.length);
  if(ok) return {status:zone.closedForm.crossComparisonOnly&&!reference?'DISPUTED':'PASS',branch:ok.branch.id,reason:zone.closedForm.crossComparisonOnly&&!reference?'Onshape/OCCT agreed frozen reference unavailable':'all geometry, topology, measurement and validity checks passed'};
  const nearest=candidates.sort((a,b)=>a.errors.length-b.errors.length)[0];
  return {status:'WRONG',types:[...new Set(nearest?.errors.map(e=>e.type)??['geometry'])],reason:nearest?.errors.map(e=>`${e.type}: ${e.reason}`).join('; ')??'success where only a named refusal is accepted',silentWrong:zone.expected.silentWrong};
}
const correct=status=>['PASS','REFUSED_EXPECTED'].includes(status);
function tiered(verdict) {
  return {...verdict,strictStatus:verdict.status,status:correct(verdict.status)?'CORRECT':verdict.status,
    ...(verdict.status==='REFUSED_EXPECTED'?{expectedRefusal:true}:{})};
}
function matchRule(zone,kernel,row,rule,reference=null) {
  if(row?.outcome!=='built'||row.stepRoundTrip?.secondImport?.ok!==true||!row.stepRoundTrip.secondImport.metrics)return null;
  const contract=toleranceContract(zone,kernel,rule,row);
  return contract&&!checks(contract.zone,contract.branch,row,'tolerance',{reference,topologyPolicy:contract.topologyPolicy}).length?contract:null;
}
export function scoreVariant(catalog,zone,kernel,row,reference=null,options={}) {
  const strict=strictVariant(catalog,zone,kernel,row,reference,options), result=tiered(strict);
  if(strict.status!=='WRONG'||kernelClass(catalog,kernel)==='exact')return result;
  for(const rule of (options.toleranceRules??defaultToleranceRules).rules) {
    const match=matchRule(zone,kernel,row,rule,reference);
    if(match)return {...result,status:'TOLERANT',toleranceRuleIds:[rule.id],toleranceWitness:match.witness,
      reason:`${rule.id}: all declared measurable acceptance checks passed`,strictReason:strict.reason};
  }
  return result;
}
function applyTiers(catalog,zones,byKey,options,admitted) {
  const {toleranceRules}=options;
  bindToleranceRules(toleranceRules,catalog);
  for(const cell of zones) {
    const zone=catalog.zones.find(z=>z.id===cell.zone);
    cell.strictStatus=cell.status;cell.strictPoints=cell.points;cell.practicalPoints=cell.points;
    cell.strictReasons=[...cell.reasons];
    cell.variants=Object.fromEntries(Object.entries(cell.variants).map(([v,r])=>[v,tiered(r)]));
    if(correct(cell.status)){cell.expectedRefusal=cell.status==='REFUSED_EXPECTED';cell.status='CORRECT';}
    const pending=toleranceRules.pendingEvidence?.filter(p=>p.kernel===cell.kernel&&p.zones.includes(cell.zone))??[];
    if(cell.status==='WRONG'&&pending.length)cell.evidencePending=pending.map(p=>p.reason);
    if(cell.status!=='WRONG'||kernelClass(catalog,cell.kernel)==='exact'||
      Object.values(cell.variants).some(v=>!['CORRECT','WRONG'].includes(v.status)))continue;
    const cellVariants=zoneVariants(zone);
    const rows=cellVariants.map(v=>byKey.get(`${cell.kernel}/${cell.zone}/${v}`));
    for(const rule of toleranceRules.rules) {
      const matches=rows.map(row=>matchRule(zone,cell.kernel,row,rule));
      if(matches.some(m=>!m)||new Set(matches.map(m=>m.branch.id)).size!==1)continue;
      // A rule must cover the whole metamorphic outcome, not just one residual.
      // V4 is a parameter change checked against its own closed form by matchRule
      // above, so (as in the strict path) it is not compared with V0's metrics.
      const i0=cellVariants.indexOf('V0'), first=rows[i0], cf=closedForm(matches[0].zone,matches[0].branch), t=matches[0].zone.tolerance;
      const coherent=rows.filter((_,i)=>i!==i0&&cellVariants[i]!=='V4').every(row=>['volume','area'].every(k=>rel(row.metrics[k],first.metrics[k],t[`${k}Rel`].tolerance))&&
        (cf.topology?.scored??[]).filter(k=>!matches[0].topologyPolicy?.fields.includes(k)).every(k=>topologyValue(row.metrics,k)===topologyValue(first.metrics,k))&&
        (cf.measurements??[]).every(p=>nearMeasurement(row.metrics.measurements?.[p.name],first.metrics.measurements?.[p.name],measurementBand(p,zone,'tolerance'))));
      if(!coherent)continue;
      if(!rows.every(admitted)) {
        cell.status='UNVERIFIED';cell.reasons=['Execution or frozen-reference admission required for practical points'];
        for(const v of cellVariants)if(!admitted(byKey.get(`${cell.kernel}/${cell.zone}/${v}`)))cell.variants[v]={...cell.variants[v],status:'UNVERIFIED',reason:cell.reasons[0]};
        break;
      }
      cell.status='TOLERANT';cell.practicalPoints=1;cell.toleranceRuleIds=[rule.id];cell.reasons=[];
      for(const [i,v] of cellVariants.entries())if(cell.variants[v].status==='WRONG')cell.variants[v]={...cell.variants[v],status:'TOLERANT',
        toleranceRuleIds:[rule.id],toleranceWitness:matches[i].witness,strictReason:cell.variants[v].reason,reason:`${rule.id}: all declared measurable acceptance checks passed`};
      break;
    }
  }
}
function agreement(zone,a,b) {
  if(a?.outcome!=='built'||b?.outcome!=='built')return {status:'NOT_COMPARABLE'};
  const reasons=[], t=zone.tolerance;
  for(const name of ['volume','area']) if(!rel(a.metrics?.[name],b.metrics?.[name],t[`${name}Rel`].agreement??t[`${name}Rel`].tolerance)) reasons.push(name);
  if(!boxEqual(a.metrics?.bbox,b.metrics?.bbox,t.bboxAbsMm.tolerance)) reasons.push('bbox');
  const aa=sortBodies(a.metrics?.bodies??[]),bb=sortBodies(b.metrics?.bodies??[]);
  if(aa.length!==bb.length) reasons.push('bodies');
  // Pair by nearest centroid: equal-volume bodies (patterns) have no stable volume order.
  const rest=[...bb];
  aa.forEach((x,i)=>{
    const d=y=>Math.hypot(...[0,1,2].map(k=>(x.centroid?.[k]??NaN)-(y.centroid?.[k]??NaN)));
    const j=rest.reduce((best,y,k)=>best<0||d(y)<d(rest[best])?k:best,-1);
    if(j<0) return;
    const y=rest.splice(j,1)[0];
    if(!rel(x.volume,y.volume,t.volumeRel.agreement??t.volumeRel.tolerance)) reasons.push(`body ${i} volume`);
    if(!x.centroid?.every((c,k)=>abs(c,y.centroid?.[k],t.bboxAbsMm.tolerance))) reasons.push(`body ${i} centroid`);
  });
  const scored=zone.closedForm.topology?.scored??[];
  for(const k of scored) if(topologyValue(a.metrics,k)!==topologyValue(b.metrics,k))reasons.push(k);
  for(const p of zone.closedForm.measurements??[]) if(!nearMeasurement(a.metrics?.measurements?.[p.name],b.metrics?.measurements?.[p.name],measurementBand(p,zone,'tolerance'))) reasons.push(p.name);
  return {status:reasons.length?'DIFFER':'AGREE',reasons};
}
export function score(catalog, results, {zonesSha256=null,errata=defaultErrata,artifactRoot=ROOT,toleranceRules=defaultToleranceRules}={}) {
  const frozen=loadCatalog();
  if(canonical(toleranceRules)!==canonical(defaultToleranceRules))throw new Error('TOLERANCE_RULES_MISMATCH: scoring requires the predeclared versioned rules');
  if(canonical(catalog)!==canonical(frozen.catalog))throw new Error('SCORING_CATALOG_MISMATCH: scoring requires the frozen catalog object');
  if(zonesSha256!==null&&zonesSha256!==frozen.zonesSha256)
    throw Object.assign(new Error('REFERENCE_ZONES_SHA_MISMATCH: result catalog hash differs'),{name:'REFERENCE_ZONES_SHA_MISMATCH'});
  // Results, errata and tolerance rules bind per zone: a catalog extension
  // leaves them valid for every zone it does not change (common.mjs).
  resultsCatalog(results,catalog);
  requireZonesBound(catalog,errata.zonesSha256,[...errata.entries,...(errata.annotations??[])].flatMap(e=>e.zones??[]),'ERRATA_ZONES_SHA_MISMATCH',`errata ${errata.version}`);
  requireScoringErrata(errata);
  const options={errata,artifactRoot,code:results.code??null};
  // Numerical classifications alone are not execution claims. Even callers
  // that skip reference verification cannot mint points from synthetic rows.
  const admitted=row=>row?.kernel?.startsWith('wonky-')
    ? ['live','re-verified'].includes(executionEvidence(row)?.status)
    : ['onshape','occt'].includes(row?.kernel)&&executionEvidence(row)?.status==='frozen';
  const rows=results.rows??[], byKey=new Map();
  for(const row of rows) { const key=`${row.kernel}/${row.zone}/${row.variant}`; if(byKey.has(key))throw new Error(`DUPLICATE_OBSERVATION: ${key}`); byKey.set(key,row); }
  const get=(k,z,v)=>byKey.get(`${k}/${z}/${v}`), zones=[], twinAgreement=[];
  for(const zone of catalog.zones) {
    const references={}, vs=zoneVariants(zone);
    for(const v of vs) {
      const on=get('onshape',zone.id,v),oc=get('occt',zone.id,v),ag=agreement(zone,on,oc);
      twinAgreement.push({zone:zone.id,variant:v,pair:'onshape-FS / occt-b3d',...ag});
      for(const k of ['wonky-bend','wonky-rust']) {
        const row=get(k,zone.id,v);
        twinAgreement.push({zone:zone.id,variant:v,pair:`${k}-FS / occt-b3d`,...(row&&!executionEvidence(row)?{status:'UNVERIFIED'}:agreement(zone,row,oc))});
      }
      // Agreement alone is insufficient: each reference must meet all independent contracts.
      if(zone.closedForm.crossComparisonOnly && ag.status==='AGREE' && ['onshape','occt'].every(k=>admitted(get(k,zone.id,v))&&strictVariant(catalog,zone,k,get(k,zone.id,v),null,options).status==='DISPUTED')) references[v]=on;
    }
    for(const kernel of KERNELS) {
      const variants=Object.fromEntries(vs.map(v=>[v,strictVariant(catalog,zone,kernel,get(kernel,zone.id,v),references[v]??null,options)]));
      let status=['WRONG','UNVERIFIED','ERROR','REFUSED','NOT_RUN','DISPUTED'].find(s=>Object.values(variants).some(v=>v.status===s));
      const reasons=[];
      const successful=Object.values(variants).filter(v=>['PASS','REFUSED_EXPECTED'].includes(v.status));
      if(new Set(successful.map(v=>`${v.status}/${v.branch}`)).size>1) { status='WRONG'; reasons.push('metamorphic: accepted branch differs between variants'); }
      if(!status && successful.length===vs.length) {
        status=successful[0].status;
        if(status==='PASS') {
          // V4 is a genuine parameter change (a radius bump), not a rigid
          // frame transform: it must match its OWN per-variant closed form
          // (already enforced inside checks()/strictVariant above), not V0's
          // raw metrics. V0-V3 and V5 (alternate idiom, same geometry) are
          // required to reproduce V0's observed metrics exactly.
          const first=get(kernel,zone.id,'V0'), branch=acceptedBranches(zone,kernelClass(catalog,kernel)).find(o=>o.id===variants.V0.branch),cf=closedForm(zone,branch),cl=kernelClass(catalog,kernel);
          for(const v of vs.filter(v=>v!=='V0'&&v!=='V4')) {
            const other=get(kernel,zone.id,v);
            for(const field of ['volume','area']) if(!rel(other.metrics[field],first.metrics[field],zone.tolerance[`${field}Rel`][cl]))reasons.push(`metamorphic: ${v} ${field}`);
            for(const field of cf.topology?.scored??[])if(topologyValue(other.metrics,field)!==topologyValue(first.metrics,field))reasons.push(`metamorphic: ${v} ${field}`);
            for(const p of cf.measurements??[])if(!nearMeasurement(other.metrics.measurements[p.name],first.metrics.measurements[p.name],measurementBand(p,zone,cl)))reasons.push(`metamorphic: ${v} ${p.name}`);
          }
          if(reasons.length)status='WRONG';
        }
      }
      status??='NOT_RUN';
      const verified=vs.every(v=>admitted(get(kernel,zone.id,v)));
      if(!verified&&['PASS','REFUSED_EXPECTED'].includes(status)) {
        status='UNVERIFIED';
        for(const v of vs)if(!admitted(get(kernel,zone.id,v)))variants[v]={status:'UNVERIFIED',reason:'Execution or frozen-reference admission required'};
      }
      zones.push({kernel,zone:zone.id,title:zone.title,family:familyOf(zone),declaredVariants:vs,status,points:verified?(catalog.scoring.perZonePerKernel[status]??0):0,variants,reasons});
    }
  }
  const strictZones=structuredClone(zones);
  applyTiers(catalog,zones,byKey,{...options,toleranceRules},admitted);
  const kernels=Object.fromEntries(KERNELS.map(k=>{const zz=zones.filter(z=>z.kernel===k);const strict=zz.reduce((s,z)=>s+z.strictPoints,0);return[k,{score:strict,strict,practical:zz.reduce((s,z)=>s+z.practicalPoints,0),total:catalog.zones.length,WRONG:zz.filter(z=>z.status==='WRONG').length,wrongSubtypes:wrongSubtypes(zz),counts:Object.fromEntries(['CORRECT','TOLERANT','REFUSED','ERROR','WRONG','NOT_RUN','DISPUTED','UNVERIFIED'].map(s=>[s,zz.filter(z=>z.status===s).length])),strictCounts:Object.fromEntries(['PASS','REFUSED_EXPECTED','REFUSED','ERROR','WRONG','NOT_RUN','DISPUTED','UNVERIFIED'].map(s=>[s,strictZones.filter(z=>z.kernel===k&&z.status===s).length])),notRun:zz.filter(z=>z.status==='NOT_RUN').map(z=>z.zone),
    byFamily:byFamily(catalog,zz),byAxis:byAxis(zz)}];}));
  const evidenceKernels=Object.fromEntries(KERNELS.map(kernel=>{
    const rr=rows.filter(r=>r.kernel===kernel);
    const modes=rr.map(r=>executionEvidence(r)?.status??'unverified');
    const counts=Object.fromEntries(['live','re-verified','frozen','unverified'].map(s=>[s,modes.filter(m=>m===s).length]));
    const unique=[...new Set(modes)];
    return [kernel,{status:unique.length===1?unique[0]:'unverified',rows:rr.length,counts}];
  }));
  const addons=Object.fromEntries(KERNELS.map(kernel=>[kernel,[...new Map(rows.filter(r=>r.kernel===kernel&&r.backend)
    .map(r=>{const identity={sourceHash:r.backend.sourceHash??null,addonSha256:r.backend.addonSha256??null};return [canonical(identity),identity];})).values()]]).filter(([,identities])=>identities.length));
  // Fixture identities come from the same private admission as the matched rows,
  // not a caller's JSON fields or a later read of a possibly replaced freeze.
  const referenceFixtures={onshape:{},occt:{}};
  for(const row of rows) {
    const proof=executionEvidence(row);
    if(proof?.status!=='frozen'||!referenceFixtures[row.kernel])continue;
    for(const [file,digest] of Object.entries(proof.fixtures)) {
      if(referenceFixtures[row.kernel][file]&&referenceFixtures[row.kernel][file]!==digest)throw new Error(`REFERENCE_FIXTURE_IDENTITY_MISMATCH: ${file}`);
      referenceFixtures[row.kernel][file]=digest;
    }
  }
  const liveReferences=(results.liveReferences??[]).map(row=>({kernel:row.kernel,zone:row.zone,variant:row.variant,outcome:row.outcome,
    status:executionEvidence(row)?.status==='live-reference'?'live-reference':'unverified',points:0}));
  const verification={status:Object.values(evidenceKernels).some(k=>k.rows&&k.counts.unverified)?'UNVERIFIED':'EXECUTION_SCOPED',kernels:evidenceKernels,addons,referenceFixtures,liveReferences,
    mismatches:results.reverification?.mismatches??[],
    scope:'Wonky points require construction and observation by this scorer process, or matching live re-execution. External reference points require exact frozen-observation matches. Live OCCT diagnostics are live-reference, zero points, excluded from the frozen columns. Artifact hashes establish consistency only, never execution. Unverified identities are recorded claims, not the current tree/addon.',code:results.code??null};
  const cells=catalog.zones.reduce((n,z)=>n+zoneVariants(z).length,0);
  return {schema:'wonky/cad-acid-scoreboard/3',catalog:{version:catalog.version,zones:catalog.zones.length,cells,zonesSha256:frozen.zonesSha256},toleranceRules:{...toleranceRules,sha256:sha256(JSON.stringify(toleranceRules))},verification,errata:{...errata,sha256:sha256(JSON.stringify(errata))},zonesSha256:frozen.zonesSha256,kernels,zones,twinAgreement,noClaim:'No image comparison; missing kernels and observations are zero points. Strict v1 points are unchanged; practical points require an evidenced measured tolerance rule. Synthetic unit tests are not live kernel evidence. Frozen references bind per zone: a zone without an active frozen Onshape or OCCT row is NOT_RUN for that reference, never agreement. OCCT reimport is a tolerance measurement, not an exact E9 construction proof. V4 (radius-bump) is scored against its own closed form, not V0 metamorphic identity; V5 (alternate idiom) is held to the same V0 identity as V1-V3.'};
}
// Families group the headline breakdown: the five base groups plus the
// extension families (catalog.families); a base zone's family is its group.
const familyOf=zone=>zone.family??zone.group;
function byFamily(catalog,rows) {
  const ids=[...new Set(catalog.zones.map(familyOf))];
  const titles=new Map([...catalog.groups.map(g=>[g.id,g.title]),...(catalog.families??[]).map(f=>[f.id,f.title])]);
  return Object.fromEntries(ids.map(id=>{const rr=rows.filter(r=>r.family===id);return [id,{title:titles.get(id)??id,zones:rr.length,
    strict:rr.reduce((s,r)=>s+r.strictPoints,0),practical:rr.reduce((s,r)=>s+r.practicalPoints,0),WRONG:rr.filter(r=>r.status==='WRONG').length}];}));
}
// Variant axes count zones, not cells: how many zones declare the axis and how
// many of those have the axis cell CORRECT (strict) or CORRECT/TOLERANT (practical).
function byAxis(rows) {
  return Object.fromEntries(ALL_VARIANTS.map(v=>{const rr=rows.filter(r=>r.declaredVariants.includes(v));return [v,{zones:rr.length,
    strict:rr.filter(r=>r.variants[v]?.status==='CORRECT').length,practical:rr.filter(r=>['CORRECT','TOLERANT'].includes(r.variants[v]?.status)).length,
    WRONG:rr.filter(r=>r.variants[v]?.status==='WRONG').length}];}).filter(([,a])=>a.zones));
}
// Zone -> kernel WRONG subtype counts (geometry/validity/topology/metamorphic), per the catalog report rule.
function wrongSubtypes(zones) {
  const counts={};
  for(const z of zones.filter(z=>z.status==='WRONG')) {
    const types=new Set(Object.values(z.variants).flatMap(v=>v.status==='WRONG'?v.types??[]:[]));
    if(z.reasons.some(r=>r.startsWith('metamorphic')))types.add('metamorphic');
    for(const t of types)counts[t]=(counts[t]??0)+1;
  }
  return counts;
}
// catalogErrors: {errors:[{id,zone,...}]} recorded outside the frozen catalog; they only annotate.
export function writeScoreboard(report,out,{markdown=true,catalogErrors=null,revision=null}={}) {
  if(revision)report.revision=revision;
  if(catalogErrors) {
    report.catalogErrors=catalogErrors.errors;
    for(const r of report.zones){const ids=catalogErrors.errors.filter(e=>e.zone===r.zone).map(e=>e.id);if(ids.length)r.catalogErrors=ids;}
  }
  writeJSON(path.join(out,'scoreboard.json'),report);
  if(!markdown)return;
  const lines=['# CAD-Acid','',...(report.revision?[`Revision: ${report.revision}`,'']:[]),report.noClaim,'',`Evidence: ${report.verification.status}. ${report.verification.scope}`,'',
    `Catalog ${report.catalog.version}: ${report.catalog.zones} zones, ${report.catalog.cells} declared variant cells (SHA-256 ${report.zonesSha256}).`,
    ...Object.entries(report.kernels).map(([k,v])=>`${k}: strict ${v.strict}/${v.total} · practical ${v.practical}/${v.total} · WRONG ${v.WRONG}`),
    `Recorded tree SHA-256: ${report.verification.code?.treeSha256??'unavailable'}`,
    ...Object.entries(report.verification.addons??{}).flatMap(([kernel,identities])=>identities.map(identity=>`Recorded ${kernel} addon (${report.verification.kernels[kernel].status}): sourceHash=${identity.sourceHash??'unavailable'}; addonSha256=${identity.addonSha256??'unavailable'}`)),
    ...(Object.keys(report.verification.addons??{}).length?[]:['Recorded addon hashes: unavailable']),
    ...Object.entries(report.verification.referenceFixtures).flatMap(([kernel,fixtures])=>Object.keys(fixtures).length
      ?Object.entries(fixtures).map(([file,digest])=>`Frozen ${kernel} fixture SHA-256: ${digest} (${file})`)
      :[`Frozen ${kernel} fixture SHA-256: unavailable (no matched rows)`]),
    ...(report.verification.liveReferences.length?[`Unscored reference diagnostics: ${report.verification.liveReferences.length} observations; live-reference=${report.verification.liveReferences.filter(r=>r.status==='live-reference').length}, unverified=${report.verification.liveReferences.filter(r=>r.status==='unverified').length}. Zero points; excluded from the frozen columns.`]:[]), '',
    '| Kernel | Evidence | Strict | Practical | CORRECT | TOLERANT | WRONG | WRONG subtypes | REFUSED | ERROR | NOT_RUN | DISPUTED | UNVERIFIED |','|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|'];
  for(const [k,v] of Object.entries(report.kernels))lines.push(`| ${k} | ${report.verification.kernels[k].status} | ${v.strict}/${v.total} | ${v.practical}/${v.total} | ${v.counts.CORRECT} | ${v.counts.TOLERANT} | ${v.WRONG?`<strong style="color:red">${v.WRONG}</strong>`:0} | ${Object.entries(v.wrongSubtypes??{}).map(([t,n])=>`${t} ${n}`).join(', ')} | ${v.counts.REFUSED} | ${v.counts.ERROR} | ${v.counts.NOT_RUN} | ${v.counts.DISPUTED} | ${v.counts.UNVERIFIED} |`);
  if(report.errata.entries.length) {
    lines.push('',`Declared errata ${report.errata.version} (${report.errata.sha256}): listed cells are DISPUTED for every kernel until corrected, re-frozen twins are independently verified.`);
    for(const e of report.errata.entries)lines.push(`- ${e.id} ${e.zones.join(', ')}: ${e.reason} Evidence: ${e.evidence.join(' ')}`);
  }
  for(const e of report.errata.annotations??[])lines.push(`- Informational ${e.id}: ${e.reason} ${e.scoreEffect}`);
  lines.push('',`Tolerance rules ${report.toleranceRules.version} (${report.toleranceRules.sha256}): strict = CORRECT; practical = CORRECT + TOLERANT. REFUSED_EXPECTED is CORRECT with an expected-refusal note.`);
  for(const rule of report.toleranceRules.rules)lines.push(`- ${rule.id} (${rule.kernels.join(', ')}): ${rule.phenomenon} ${rule.acceptance.description}`);
  lines.push('','By family (zones; strict/practical points):','','| Kernel | '+Object.values(Object.values(report.kernels)[0].byFamily).map(f=>f.title).join(' | ')+' |','|---|'+Object.keys(Object.values(report.kernels)[0].byFamily).map(()=>'---:').join('|')+'|');
  for(const [k,v] of Object.entries(report.kernels))lines.push(`| ${k} | ${Object.values(v.byFamily).map(f=>`${f.strict}/${f.practical} of ${f.zones}${f.WRONG?`, WRONG ${f.WRONG}`:''}`).join(' | ')} |`);
  lines.push('','By variant axis (zones declaring the axis; strict/practical cells correct):','','| Kernel | '+Object.keys(Object.values(report.kernels)[0].byAxis).join(' | ')+' |','|---|'+Object.keys(Object.values(report.kernels)[0].byAxis).map(()=>'---:').join('|')+'|');
  for(const [k,v] of Object.entries(report.kernels))lines.push(`| ${k} | ${Object.values(v.byAxis).map(a=>`${a.strict}/${a.practical} of ${a.zones}`).join(' | ')} |`);
  lines.push('','NOT_RUN (0 points, in the denominator):');
  for(const [k,v] of Object.entries(report.kernels))if(v.notRun.length)lines.push(`- ${k}: ${v.notRun.length===v.total?'all zones':v.notRun.join(', ')}`);
  if(report.catalogErrors?.length) {
    lines.push('','Catalog errors (recorded; the frozen catalog is unchanged):');
    for(const e of report.catalogErrors)lines.push(`- ${e.id} ${e.zone}: ${e.field}. ${e.impact} ${e.resolution}${e.scoreEffect?` Score effect: ${e.scoreEffect}`:''}`.replaceAll('\n',' '));
  }
  lines.push('','| Zone | Kernel | Verdict | '+ALL_VARIANTS.join(' | ')+' | Details |','|---|---|---|'+ALL_VARIANTS.map(()=>'---').join('|')+'|---|');
  for(const r of report.zones)lines.push(`| ${r.zone}${r.catalogErrors?` (catalog error ${r.catalogErrors.join(', ')})`:''} | ${r.kernel} | ${r.status} | ${ALL_VARIANTS.map(v=>r.variants[v]?.status??'–').join(' | ')} | ${[...r.reasons,...(r.toleranceRuleIds??[]),...(r.evidencePending??[]),...new Set(Object.values(r.variants).filter(v=>!['CORRECT'].includes(v.status)).map(v=>v.reason))].join('; ').replaceAll('|','/').replaceAll('\n',' ')} |`);
  lines.push('','| Zone | Variant | Twins | Agreement | Differences |','|---|---|---|---|---|');
  for(const r of report.twinAgreement)lines.push(`| ${r.zone} | ${r.variant} | ${r.pair} | ${r.status} | ${(r.reasons??[]).join(', ')} |`);
  fs.writeFileSync(path.join(out,'scoreboard.md'),lines.join('\n')+'\n');
}
async function main() {
  try {
    const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);if(i<0)return null;const [,v]=args.splice(i,2);if(!v)throw new Error(`${name} needs a value`);return v;};
    const flag=name=>{const i=args.indexOf(name);if(i<0)return false;args.splice(i,1);return true;};
    const jsonOnly=flag('--json-only'),reverify=flag('--reverify');
    const errorsFile=option('--catalog-errors'),revision=option('--revision'),artifactRoot=option('--artifact-root')??ROOT,errataFile=option('--errata');
    const input=args[0]??path.join(ROOT,'out/cad-acid/results.json'),out=args[1]??path.dirname(input);
    const {catalog,zonesSha256}=loadCatalog(),results=readJSON(input);
    if(args.length>2||args.some(a=>a.startsWith('--')))throw new Error('UNKNOWN_SCORE_OPTION');
    const errata=errataFile?loadErrata(errataFile):defaultErrata;
    requireScoringErrata(errata);
    const {verifyStoredReferences}=await import('./execution.mjs');
    let report;
    if(reverify)report=await (await import('./run.mjs')).run({out:path.join(out,'reverify'),claims:results,kernels:results.rows.some(r=>r.kernel==='wonky-rust')?['wonky-rust']:[],noSmoke:true,jsonOnly:true,errata,artifactRoot});
    else {await verifyStoredReferences(results,{out:path.join(out,'frozen-reference'),artifactRoot});report=score(catalog,results,{zonesSha256,artifactRoot,errata});}
    writeScoreboard(report,out,{markdown:!jsonOnly,catalogErrors:errorsFile?readJSON(errorsFile):null,revision});console.log(JSON.stringify(report.kernels,null,2));
    if(Object.values(report.kernels).some(k=>k.WRONG||k.counts.UNVERIFIED))process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}

if(isMain(import.meta.url))void main();
