import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CATALOG = path.join(ROOT, 'fixtures/cad-acid/zones.json');
export const VARIANTS = ['V0', 'V1', 'V2', 'V3'];
export const KERNELS = ['onshape', 'occt', 'wonky-bend', 'wonky-rust'];
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function writeJSON(file, value) { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(value, null, 2)+'\n'); }
export function loadCatalog(file = CATALOG) { const bytes = fs.readFileSync(file); const catalog = JSON.parse(bytes); validateCatalog(catalog); return {catalog, zonesSha256:sha256(bytes)}; }
export function loadErrata(file = path.join(ROOT, 'fixtures/cad-acid/errata.json')) {
  const errata = readJSON(file);
  if (errata.schema !== 'wonky/cad-acid-errata/1' || !Array.isArray(errata.entries) || errata.entries.some(e => !e.id || !e.reason || !e.evidence?.length || !e.zones?.length || !e.kernels?.length)) throw new Error('ERRATA_SCHEMA');
  return errata;
}
export function kernelClass(catalog, kernel) {
  const matches = Object.entries(catalog.kernelClasses).filter(([, c]) => c.kernels.includes(kernel));
  if (matches.length !== 1) throw new Error(`CATALOG_KERNEL_CLASS: ${kernel}`);
  return matches[0][0];
}
export function closedForm(zone, outcome) {
  if (outcome.closedForm === 'primary') return zone.closedForm;
  if (outcome.closedForm === 'sliverBound') return {sliverBound:true};
  if (outcome.closedForm && typeof outcome.closedForm === 'object') return outcome.closedForm;
  throw new Error(`CATALOG_OUTCOME: ${zone.id}/${outcome.id}`);
}
export function validateCatalog(c) {
  const fail = text => { throw new Error(`CATALOG_SCHEMA: ${text}`); };
  if (c.schema !== 'wonky/cad-acid-zones/1' || c.units !== 'mm' || !c.zones?.length) fail('schema/units/zones');
  if (new Set(c.zones.map(z=>z.id)).size !== c.zones.length) fail('duplicate zone');
  for (const v of VARIANTS) if (!c.variants[v]) fail(`missing ${v}`);
  const membership = c.groups.flatMap(g=>g.zoneIds);
  if (membership.length !== c.zones.length || new Set(membership).size !== membership.length) fail('group membership');
  for (const z of c.zones) {
    if (!c.groups.some(g=>g.id===z.group && g.zoneIds.includes(z.id))) fail(`${z.id} group`);
    if (!z.cell?.originMm?.every(Number.isFinite) || z.cell.originMm.length !== 3) fail(`${z.id} cell`);
    if (!z.expected?.outcomes?.length || !Array.isArray(z.expected.silentWrong)) fail(`${z.id} outcomes`);
    for (const name of ['volumeRel','areaRel','bboxAbsMm','measureAbsMm']) for (const cl of ['exact','tolerance'])
      if (!(Number.isFinite(z.tolerance?.[name]?.[cl]) && z.tolerance[name][cl]>=0)) fail(`${z.id} ${name}/${cl}`);
    for (const o of z.expected.outcomes) {
      if (!['any','exact','tolerance'].includes(o.kernelClass) || !['geometry','refusal'].includes(o.kind) || !Number.isInteger(o.bodies) || o.bodies<0) fail(`${z.id} outcome`);
      if (o.kind==='refusal' && !o.refusalCategory) fail(`${z.id} unnamed refusal`);
      if (o.kind==='geometry') { const cf=closedForm(z,o); if (!cf.sliverBound && !cf.topology?.scored?.length) fail(`${z.id} topology`); }
    }
  }
  // Compare the declared world AABBs at EACH variant, never V0 against V1.
  for (const v of VARIANTS) {
    const boxes=c.zones.flatMap(z=>z.expected.outcomes.filter(o=>o.kind==='geometry').map(o=>{
      const b=closedForm(z,o).bbox?.variants?.[v];
      return b ? {id:z.id,min:b.min.map((x,i)=>x+z.cell.originMm[i]),max:b.max.map((x,i)=>x+z.cell.originMm[i])}:null;
    }).filter(Boolean));
    for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
      const a=boxes[i],b=boxes[j]; if(a.id!==b.id && [0,1,2].every(k=>a.min[k]<=b.max[k] && b.min[k]<=a.max[k])) fail(`GRID_INTERACTION: ${v} ${a.id}/${b.id}`);
    }
  }
  for(const k of KERNELS) kernelClass(c,k);
  return c;
}
export function sourceHashes(catalog) {
  return Object.fromEntries(catalog.groups.flatMap(g=>[g.fs,g.b3d]).map(f=>[f,fs.existsSync(path.join(ROOT,f))?sha256(fs.readFileSync(path.join(ROOT,f))):null]));
}
export function verifyFrozenReference(dir, expectedHash, sources = {}) {
  const refuse = (name, detail) => { const e=new Error(`${name}: ${detail}`); e.name=name; throw e; };
  const p=readJSON(path.join(dir,'provenance.json'));
  if (p.zonesSha256!==expectedHash) refuse('REFERENCE_ZONES_SHA_MISMATCH', 'zones.json differs from frozen reference');
  for(const [f,hash] of Object.entries(sources)) if(f.endsWith('.fs') && p.sources?.[f]!==hash) refuse('REFERENCE_STUDIO_SHA_MISMATCH',f);
  const listed=new Set();
  for(const line of fs.readFileSync(path.join(dir,'SHA256SUMS'),'utf8').trim().split('\n')) {
    const m=line.match(/^([a-f0-9]{64}) {2}(.+)$/); if(!m) refuse('REFERENCE_CHECKSUM_INVALID',line);
    const target=path.resolve(dir,m[2]);
    if(!target.startsWith(path.resolve(dir)+path.sep) || listed.has(m[2])) refuse('REFERENCE_CHECKSUM_INVALID',m[2]);
    listed.add(m[2]); if(sha256(fs.readFileSync(target))!==m[1]) refuse('REFERENCE_CHECKSUM_MISMATCH',m[2]);
  }
  if(!listed.has('provenance.json')) refuse('REFERENCE_CHECKSUM_INVALID','unhashed provenance');
  const requireListed = rel => { if(typeof rel!=='string'||!listed.has(rel))refuse('REFERENCE_ARTIFACT_UNHASHED',String(rel)); };
  if(p.schema!=='wonky/cad-acid-onshape/1')refuse('REFERENCE_SCHEMA_MISMATCH',p.schema);
  requireListed('inputs/zones.json');
  if(sha256(fs.readFileSync(path.join(dir,'inputs/zones.json')))!==expectedHash)refuse('REFERENCE_ZONES_SHA_MISMATCH','frozen input bytes');
  for(const [f,hash] of Object.entries(p.sources??{}))if(f.endsWith('.fs')) {
    const rel=`inputs/${path.basename(f)}`;requireListed(rel);
    if(sha256(fs.readFileSync(path.join(dir,rel)))!==hash)refuse('REFERENCE_STUDIO_SHA_MISMATCH',f);
  }
  for(const s of p.studios??[])if(s.featureStatus==='OK') {
    for(const rel of [s.parts,s.bodydetails,s.boundingboxes,s.translation,s.step,...Object.values(s.mass??{})])requireListed(rel);
  }
  for(const s of p.studios??[]) if(s.featureStatus==='OK' && (!/^[a-f0-9]{24}$/.test(s.microversion??'') || !s.element || !p.document || !p.workspace)) refuse('REFERENCE_IMMUTABLE_ID_MISSING',s.group);
  return p;
}
export function sortBodies(bodies) {
  return [...bodies].sort((a,b)=>a.volume-b.volume || (a.centroid?.[0]-b.centroid?.[0]) || (a.centroid?.[1]-b.centroid?.[1]) || (a.centroid?.[2]-b.centroid?.[2]));
}
export const isMain = url => process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(url);
// The zone frame F(p) = cellOrigin + Vk(p) as [R, t] (rows of R), mirroring
// measure.py frame(): the harness passes it to a kernel only as data.
export function zoneFrame(catalog, zone, variant) {
  const v = catalog.variants[variant];
  let r, t;
  if (v.matrix) { r = v.matrix; t = v.translationMm; }
  else {
    const length = Math.sqrt(v.axis.reduce((s, x) => s + x * x, 0)), a = v.axis.map(x => x / length);
    const c = Math.cos(v.angleRad), s = Math.sin(v.angleRad);
    const cross = [[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]];
    r = [0, 1, 2].map(i => [0, 1, 2].map(j => c * (i === j ? 1 : 0) + (1 - c) * a[i] * a[j] + s * cross[i][j]));
    const p = v.throughPointMm;
    t = [0, 1, 2].map(i => p[i] - [0, 1, 2].reduce((sum, j) => sum + r[i][j] * p[j], 0));
  }
  return [r, t.map((x, i) => x + zone.cell.originMm[i])];
}
