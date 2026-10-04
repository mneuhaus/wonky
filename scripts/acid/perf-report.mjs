#!/usr/bin/env node
// Reports only: shared-host timings never change a CAD-Acid verdict or gate.
import fs from 'node:fs';
import {isMain} from './common.mjs';
import {PHASES} from './perf.mjs';
export function stats(values) {
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y),n=a.length;
  return {n,median:n?(n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2):null,p95:n?a[Math.ceil(n*.95)-1]:null};
}
export function sameHostContext(a,b) {
  return !!a&&!!b&&a.host===b.host&&a.logicalCpus===b.logicalCpus&&Number.isInteger(a.slotCount)&&a.slotCount>0&&a.slotCount===b.slotCount&&a.parallelCells===b.parallelCells;
}
export function comparable(a,b) {
  return !!a && !!b && a.host===b.host && a.logicalCpus===b.logicalCpus &&
    Number.isInteger(a.slotCount)&&a.slotCount>0&&a.slotCount===b.slotCount &&
    a.parallelCells===b.parallelCells && (typeof a.addonWarm==='boolean'||a.addonWarm===null) && a.addonWarm===b.addonWarm &&
    Number.isFinite(a.load1)&&Number.isFinite(b.load1)&&Math.abs(a.load1-b.load1)<=Math.max(1,.1*a.logicalCpus);
}
const built=c=>c.outcome==='built'&&!c.builtBeforeFailure;
const common=c=>built(c)&&['frontend','kernelBuild','measurement','stepExport'].every(p=>Number.isFinite(c.phases?.[p]?.wallMs))
  ? ['frontend','kernelBuild','measurement','stepExport'].reduce((s,p)=>s+c.phases[p].wallMs,0):null;
const key=c=>`${c.zone}/${c.variant}`;
function group(cells) {
  const matched=cells.filter(c=>built(c)&&c.build123d?.outcome==='built'&&sameHostContext(c.context,c.build123d.context)&&
    Number.isFinite(common(c))&&Number.isFinite(c.build123d.samples?.[0]?.warmPipelineMs)&&c.build123d.samples[0].warmPipelineMs>0);
  const ratios=matched.map(c=>common(c)/c.build123d.samples[0].warmPipelineMs);
  return {cells:cells.length,matched:matched.length,comparableLoadPairs:matched.filter(c=>comparable({...c.context,addonWarm:null},c.build123d.context)).length,ratios:stats(ratios),
    load:stats(cells.map(c=>c.context?.load1)),twinLoad:stats(cells.map(c=>c.build123d?.context?.load1)),
    phases:Object.fromEntries(PHASES.map(p=>[p,{wallMs:stats(cells.map(c=>c.phases?.[p]?.wallMs)),cpuMs:stats(cells.map(c=>c.phases?.[p]?.cpuMs))}])),
    slowest:cells.filter(c=>Number.isFinite(c.phases?.total?.wallMs)).sort((a,b)=>b.phases.total.wallMs-a.phases.total.wallMs).slice(0,10).map(c=>({cell:key(c),wallMs:c.phases.total.wallMs,outcome:c.outcome})),
    failures:cells.filter(c=>!built(c)||c.build123d?.outcome!=='built').map(c=>({cell:key(c),wonky:c.outcome,wonkyError:c.error??c.refusal??c.reason,build123d:c.build123d?.outcome??'not_run',build123dError:c.build123d?.error}))};
}
export function report(perf,previous=null) {
  if(perf.schema!=='wonky/cad-acid-live-perf/1')throw new Error('UNSUPPORTED_PERF_SCHEMA');
  const cells=perf.cells.filter(c=>c.zone!=='ALL');
  if(new Set(cells.map(key)).size!==cells.length)throw new Error('DUPLICATE_PERF_CELL');
  const families=Object.fromEntries([...new Set(cells.map(c=>c.family))].sort().map(id=>[id,group(cells.filter(c=>c.family===id))]));
  const zones=Object.fromEntries([...new Set(cells.map(c=>c.zone))].sort().map(id=>[id,group(cells.filter(c=>c.zone===id))]));
  const denominator={zones:Object.keys(zones).length,both:0,wonkyOnly:0,build123dOnly:0,none:0,matchedCells:Object.values(zones).reduce((n,z)=>n+z.matched,0),cells:cells.length};
  for(const id of Object.keys(zones)) {const rows=cells.filter(c=>c.zone===id),w=rows.some(built),b=rows.some(c=>c.build123d?.outcome==='built');denominator[w&&b?'both':w?'wonkyOnly':b?'build123dOnly':'none']++;}
  let comparison=null;
  if(previous) {
    if(previous.schema!==perf.schema)throw new Error('UNSUPPORTED_PREVIOUS_SCHEMA');
    if(previous.zonesSha256!==perf.zonesSha256)throw new Error('CATALOG_MISMATCH');
    const old=new Map(previous.cells.filter(c=>c.zone!=='ALL').map(c=>[key(c),c]));
    if(old.size!==previous.cells.filter(c=>c.zone!=='ALL').length)throw new Error('DUPLICATE_PREVIOUS_CELL');
    const differences=[],regressions=[],excluded=[],allDifferences=[];
    for(const c of cells) {
      const p=old.get(key(c)),now=c.phases?.total?.wallMs,before=p?.phases?.total?.wallMs;
      if(!perf.finishedAt||!previous.finishedAt||!p||!built(c)||!built(p)||!Number.isFinite(now)||!Number.isFinite(before)||before<=0){excluded.push(key(c));continue;}
      const relative=Math.abs(now-before)/before,similarLoad=comparable(c.context,p.context);
      const difference={cell:key(c),relative,beforeMs:before,nowMs:now,comparableLoad:similarLoad};
      allDifferences.push(difference);
      if(!similarLoad){excluded.push(key(c));continue;}
      differences.push(difference);
      if(now>2*before&&now-before>200)regressions.push({cell:key(c),ratio:now/before,increaseMs:now-before});
    }
    comparison={completed:!!perf.finishedAt&&!!previous.finishedAt,sameTree:!!perf.gitTree&&perf.gitTree===previous.gitTree,cleanTrees:perf.clean===true&&previous.clean===true,
      medianAbsoluteRelativeDifference:stats(allDifferences.map(d=>d.relative)).median,pairedCells:allDifferences.length,
      comparableMedianAbsoluteRelativeDifference:stats(differences.map(d=>d.relative)).median,differences:allDifferences,comparableCells:differences.length,excluded,regressions};
  }
  return {denominator,summary:group(cells),families,zones,comparison,
    timingOverhead:{measuredNativeWrapperMs:perf.cells.reduce((s,c)=>s+(c.overheadMs??0),0),
      upperBoundMs:(perf.publicationMs??0)+perf.cells.reduce((s,c)=>s+(c.timingOverheadUpperBoundMs??0),0),
      comparisonWorkMs:perf.cells.reduce((s,c)=>s+(c.comparisonWorkMs??0),0),runWallMs:perf.runTime?.wallMs??null,
      scope:'Conservative measured bound: native wrapper/clock costs, sidecar bookkeeping/writes, perf publication, optional Python timer import/clock costs (no extra observer process). Final sidecar writes are not self-timed; acceptance measures a conservative write-cost allowance separately. Build123d geometry work and requested STL exports are separate workload, not timing overhead.'},phaseScopes:perf.phaseScopes};
}
const num=x=>x===null||x===undefined?'—':x.toFixed(3);
export function markdown(r) {
  const d=r.denominator;
  const lines=['# CAD-Acid performance','',`Zones: ${d.zones}; both build: ${d.both}; wonky only: ${d.wonkyOnly}; build123d only: ${d.build123dOnly}; neither: ${d.none}. Matched same-host cells: ${d.matchedCells}/${d.cells}.`,
    '','Ratios are wonky/build123d common-pipeline wall time; medians/p95 across matched variants. Similar-load pair counts are shown separately; shared-host noise remains a countermetric. Zone coverage means at least one variant builds on each side. CPU times and every phase are available in --json. No performance gate.',''];
  for(const [label,groups] of [['Family',r.families],['Zone',r.zones]]) {
    lines.push(`| ${label} | Cells | Matched / similar load | Total median ms | Total p95 ms | Ratio median | Ratio p95 |`,'|---|---:|---:|---:|---:|---:|---:|');
    for(const [id,g] of Object.entries(groups))lines.push(`| ${id} | ${g.cells} | ${g.matched} / ${g.comparableLoadPairs} | ${num(g.phases.total.wallMs.median)} | ${num(g.phases.total.wallMs.p95)} | ${num(g.ratios.median)} | ${num(g.ratios.p95)} |`);
    lines.push('');
  }
  lines.push('Slowest 10 cells (total wall ms):',...r.summary.slowest.map(c=>`- ${c.cell}: ${num(c.wallMs)} (${c.outcome})`),'',
    'Refusals/failures (diagnostic, scored verdicts remain in scoreboard.json):',...r.summary.failures.map(c=>`- ${c.cell}: wonky ${c.wonky} ${JSON.stringify(c.wonkyError??'')}; build123d ${c.build123d} ${JSON.stringify(c.build123dError??'')}`));
  if(r.comparison)lines.push('',`Run noise: median absolute relative difference ${num(r.comparison.medianAbsoluteRelativeDifference)} across ${r.comparison.pairedCells} paired built cells (raw, including load variation); similar-load median ${num(r.comparison.comparableMedianAbsoluteRelativeDifference)} across ${r.comparison.comparableCells} cells; excluded ${r.comparison.excluded.length}; same tree ${r.comparison.sameTree}; clean ${r.comparison.cleanTrees}.`,
    ...r.comparison.regressions.map(c=>`- SLOWDOWN ${c.cell}: ${num(c.ratio)}x, +${num(c.increaseMs)} ms`));
  lines.push('',...Object.entries(r.phaseScopes??{}).map(([phase,scope])=>`- ${phase}: ${scope}`));
  return lines.join('\n')+'\n';
}
if(isMain(import.meta.url)) {
  try {const args=process.argv.slice(2),json=args.includes('--json'),files=args.filter(a=>a!=='--json');
    if(files.length<1||files.length>2)throw new Error('Usage: perf-report.mjs current/perf.json [previous/perf.json] [--json]');
    const r=report(JSON.parse(fs.readFileSync(files[0],'utf8')),files[1]?JSON.parse(fs.readFileSync(files[1],'utf8')):null);
    process.stdout.write(json?JSON.stringify(r,null,2)+'\n':markdown(r));
  }catch(error){console.error(error.stack);process.exitCode=1;}
}
