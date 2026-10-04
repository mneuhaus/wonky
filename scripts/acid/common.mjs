import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CATALOG = path.join(ROOT, 'fixtures/cad-acid/zones.json');
export const VARIANTS = ['V0', 'V1', 'V2', 'V3'];
// V4 (radius-bump on circular features) and V5 (alternate-idiom, same geometry)
// both reuse V0's frame via catalog.variants[v].baseFrame; they only exist for
// zones that declare them in zone.variants. Legacy zones never see these.
export const ALL_VARIANTS = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5'];
export const KERNELS = ['onshape', 'occt', 'wonky-bend', 'wonky-rust'];
export const CATALOG_HISTORY = path.join(ROOT, 'fixtures/cad-acid/catalog-history');
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export function writeJSON(file, value) { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(value, null, 2)+'\n'); }
export function loadCatalog(file = CATALOG) { const bytes = fs.readFileSync(file); const catalog = JSON.parse(bytes); validateCatalog(catalog); return {catalog, zonesSha256:sha256(bytes)}; }

// Per-zone reference binding (catalog extension, proposal §4). A catalog grows by
// appending zones; frozen references, errata, tolerance evidence, results and
// wonky request stamps name the catalog they were produced against by its
// whole-file SHA-256 and stay bound only to the zones they actually cover.
// The named catalog must be recoverable with those exact bytes: the current
// file, fixtures/cad-acid/catalog-history/<sha>.json, or a caller-supplied copy
// (a capture's inputs/zones.json). A history file whose bytes do not hash to its
// name is tampering and a hard error, never a missing copy.
export function catalogBySha(sha, candidates = []) {
  if (typeof sha !== 'string' || !/^[a-f0-9]{64}$/.test(sha)) return null;
  const history = path.join(CATALOG_HISTORY, `${sha}.json`);
  for (const file of [CATALOG, history, ...candidates]) {
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    if (sha256(bytes) === sha) return JSON.parse(bytes);
    if (file === history) throw Object.assign(new Error(`CATALOG_HISTORY_MISMATCH: ${path.relative(ROOT, file)}`), {name:'CATALOG_HISTORY_MISMATCH'});
  }
  return null;
}
const frameDefinition = (catalog, variant) => {
  const own = catalog.variants?.[variant];
  return own ? {variant:own, base:catalog.variants[own.baseFrame ?? variant] ?? null} : null;
};
// construction.paramsByVariant only binds the variant it parameterises: adding a
// V4 literal to a zone later leaves its V0-V3 rows bound.
function constructionFor(zone, variant) {
  const {paramsByVariant, ...construction} = zone.construction ?? {};
  return {...construction, variantParams:paramsByVariant?.[variant] ?? null};
}
// Binding levels, each a canonical digest input for one (zone, variant) row:
//   geometry  what a twin builds: construction, cell, the variant's frame, group
//             (Onshape rows are re-observed from the frozen STEP at every run);
//   contract  geometry plus the observed contract (expected outcomes, closed
//             forms, tolerance), for stored observations such as frozen OCCT rows;
//   zone      the whole zone object and the frames of all its declared variants,
//             for results, wonky request stamps, errata and tolerance evidence.
export function zoneBinding(catalog, zone, variant, level) {
  if (!zone) return null;
  if (level === 'zone') return canonical({zone, frames:Object.fromEntries(zoneVariants(zone).map(v => [v, frameDefinition(catalog, v)]))});
  const geometry = {id:zone.id, group:zone.group, declared:zoneVariants(zone).includes(variant), construction:constructionFor(zone, variant),
    cell:zone.cell, frame:frameDefinition(catalog, variant)};
  if (level === 'geometry') return canonical(geometry);
  if (level === 'contract') return canonical({...geometry, expected:zone.expected, closedForm:zone.closedForm,
    closedFormByVariant:zone.closedFormByVariant ?? null, tolerance:zone.tolerance});
  throw new Error(`ZONE_BINDING_LEVEL: ${level}`);
}
// True when zone `id` is identical (level 'zone') in the catalog named by `sha`
// and in `catalog`. Unknown catalogs and absent zones are never bound.
export function zoneBoundTo(catalog, id, sha, candidates = []) {
  const copy = catalogBySha(sha, candidates), zone = catalog.zones.find(z => z.id === id);
  if (!copy || !zone) return false;
  return zoneBinding(copy, copy.zones.find(z => z.id === id), null, 'zone') === zoneBinding(catalog, zone, null, 'zone');
}
// Errata, tolerance rules and results name the catalog they were written for.
// They stay valid across an extension only while every zone they cover is
// unchanged; a changed covered zone requires a new version of the document.
export function requireZonesBound(catalog, sha, ids, code, what) {
  const copy = catalogBySha(sha);
  const fail = detail => { throw Object.assign(new Error(`${code}: ${what} ${detail}`), {name:code}); };
  if (!copy) fail(`names catalog ${sha}, which is neither current nor in fixtures/cad-acid/catalog-history`);
  for (const id of new Set(ids)) if (!zoneBoundTo(catalog, id, sha)) fail(`covers ${id}, which differs between catalog ${String(sha).slice(0, 12)} and the current catalog`);
  return copy;
}
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
export function zoneVariants(zone) {
  return zone.variants ?? VARIANTS;
}
export function closedForm(zone, outcome, variant) {
  // V4 zones carry a genuinely different closed form per variant (a radius
  // bump changes volume/area/measurements); everything else keeps using the
  // single shared closed form. closedFormByVariant is optional and additive:
  // omitting it (every zone today) reproduces the exact prior lookup.
  if (variant && outcome.closedFormByVariant && outcome.closedFormByVariant[variant]) {
    const cf = outcome.closedFormByVariant[variant];
    if (cf === 'primary') return zone.closedForm;
    if (cf === 'sliverBound') return {sliverBound:true};
    if (typeof cf === 'object') return cf;
    // Any other string names a zone-level closed form (zone.closedFormByVariant[name]).
    // An unresolvable name must fail loudly, never fall back to V0's closed form.
    if (typeof cf === 'string' && zone.closedFormByVariant?.[cf] && typeof zone.closedFormByVariant[cf] === 'object') return zone.closedFormByVariant[cf];
    throw new Error(`CATALOG_OUTCOME: ${zone.id}/${outcome.id}/${variant} closedFormByVariant ${cf}`);
  }
  if (outcome.closedForm === 'primary') return zone.closedForm;
  if (outcome.closedForm === 'sliverBound') return {sliverBound:true};
  if (outcome.closedForm && typeof outcome.closedForm === 'object') return outcome.closedForm;
  throw new Error(`CATALOG_OUTCOME: ${zone.id}/${outcome.id}`);
}
export function validateCatalog(c) {
  const fail = text => { throw new Error(`CATALOG_SCHEMA: ${text}`); };
  // Schema /1 is the frozen 48-zone catalog; /2 adds per-zone variants (V4
  // parameters, V5 idiom), twin overrides, families and the extension history.
  const extended = c.schema === 'wonky/cad-acid-zones/2';
  if (!extended && c.schema !== 'wonky/cad-acid-zones/1' || c.units !== 'mm' || !c.zones?.length) fail('schema/units/zones');
  if (new Set(c.zones.map(z=>z.id)).size !== c.zones.length) fail('duplicate zone');
  for (const v of VARIANTS) if (!c.variants[v]) fail(`missing ${v}`);
  // V4/V5 carry no frame of their own: kind and baseFrame V0 are mandatory.
  for (const [v,kind] of [['V4','parameters'],['V5','idiom']]) if (c.variants[v]) {
    if (!extended || c.variants[v].kind !== kind || c.variants[v].baseFrame !== 'V0') fail(`${v} kind/baseFrame`);
  }
  if (!extended && (c.families || c.zones.some(z=>z.variants || z.twin || z.family || z.variantNotes || z.construction?.paramsByVariant || z.closedFormByVariant))) fail('extension fields need schema wonky/cad-acid-zones/2');
  const families = new Set((c.families ?? []).map(f=>f.id));
  if (extended && (!Array.isArray(c.families) || families.size !== c.families.length || c.families.some(f=>!f.id || !f.title))) fail('families');
  const membership = c.groups.flatMap(g=>g.zoneIds);
  if (membership.length !== c.zones.length || new Set(membership).size !== membership.length) fail('group membership');
  for (const z of c.zones) {
    if (!c.groups.some(g=>g.id===z.group && g.zoneIds.includes(z.id))) fail(`${z.id} group`);
    if (!z.cell?.originMm?.every(Number.isFinite) || z.cell.originMm.length !== 3) fail(`${z.id} cell`);
    if (!z.expected?.outcomes?.length || !Array.isArray(z.expected.silentWrong)) fail(`${z.id} outcomes`);
    if (z.variants !== undefined) {
      // V0-V3 are mandatory frames; declared variants keep canonical order.
      if (!Array.isArray(z.variants) || VARIANTS.some(v=>!z.variants.includes(v))) fail(`${z.id} variants`);
      if (new Set(z.variants).size !== z.variants.length || z.variants.some(v=>!ALL_VARIANTS.includes(v))) fail(`${z.id} variants`);
      if (z.variants.join() !== ALL_VARIANTS.filter(v=>z.variants.includes(v)).join()) fail(`${z.id} variant order`);
      for (const v of z.variants) if (!c.variants[v]) fail(`${z.id} declares undefined ${v}`);
    }
    const declared = zoneVariants(z);
    // New zones (AC50 and later) list their variants and give a reason for each omitted axis.
    if (extended && Number(z.id.slice(2)) >= 50) {
      if (!z.variants) fail(`${z.id} must declare variants`);
      for (const v of ['V4','V5']) if (!declared.includes(v) && !z.variantNotes?.[v]) fail(`${z.id} omits ${v} without variantNotes`);
      if (!families.has(z.family)) fail(`${z.id} family`);
    } else if (z.family !== undefined && !families.has(z.family)) fail(`${z.id} family`);
    for (const file of [z.twin?.fs, z.twin?.b3d, ...Object.values(z.twin?.byVariant ?? {}).flatMap(o=>[o.fs, o.b3d])].filter(Boolean))
      if (!fs.existsSync(path.join(ROOT, file))) fail(`${z.id} twin override ${file} missing`);
    if (declared.includes('V4') !== Boolean(z.construction?.paramsByVariant?.V4)) fail(`${z.id} V4 needs construction.paramsByVariant.V4`);
    if (Object.keys(z.construction?.paramsByVariant ?? {}).some(v=>v!=='V4' || !declared.includes(v))) fail(`${z.id} paramsByVariant`);
    for (const name of ['volumeRel','areaRel','bboxAbsMm','measureAbsMm']) for (const cl of ['exact','tolerance'])
      if (!(Number.isFinite(z.tolerance?.[name]?.[cl]) && z.tolerance[name][cl]>=0)) fail(`${z.id} ${name}/${cl}`);
    for (const o of z.expected.outcomes) {
      if (!['any','exact','tolerance'].includes(o.kernelClass) || !['geometry','refusal'].includes(o.kind) || !Number.isInteger(o.bodies) || o.bodies<0) fail(`${z.id} outcome`);
      if (o.kind==='refusal' && !o.refusalCategory) fail(`${z.id} unnamed refusal`);
      if (o.kind==='geometry') { const cf=closedForm(z,o); if (!cf.sliverBound && !cf.topology?.scored?.length) fail(`${z.id} topology`); }
      if (o.kind==='geometry' && (declared.includes('V4') || declared.includes('V5') || o.closedFormByVariant)) {
        // V5 is V0's geometry in another idiom: never an own closed form.
        if (Object.keys(o.closedFormByVariant ?? {}).some(v=>v!=='V4' || !declared.includes(v))) fail(`${z.id}/${o.id} closedFormByVariant`);
        const primary = closedForm(z,o), probes = cf => canonical(Object.fromEntries((cf.measurements ?? []).map(m=>[m.name,m.definition])));
        for (const v of declared.filter(v=>['V4','V5'].includes(v))) {
          const cf = closedForm(z,o,v);
          if (v==='V4' && (cf===primary || !cf.topology?.scored?.length || !cf.volume || !cf.area)) fail(`${z.id}/${o.id} V4 closed form`);
          // Native observers read probe definitions from the primary closed form: a variant changes values only.
          if (probes(cf) !== probes(primary)) fail(`${z.id}/${o.id} ${v} probe definitions differ from V0`);
          const box = cf.bbox === null ? null : cf.bbox?.variants?.[v];
          if (cf.bbox !== null && !box) fail(`${z.id}/${o.id} ${v} bbox`);
          if (v==='V5' && canonical(box) !== canonical(primary.bbox === null ? null : primary.bbox?.variants?.V0)) fail(`${z.id}/${o.id} V5 bbox differs from V0`);
        }
      }
    }
  }
  // Compare the declared world AABBs at EACH variant a zone actually runs,
  // never V0 against V1. Legacy zones (no `variants` field) keep checking
  // exactly VARIANTS, reproducing the original behaviour byte-for-byte.
  const usedVariants = [...new Set(c.zones.flatMap(z=>zoneVariants(z)))];
  for (const v of usedVariants) {
    const boxes=c.zones.filter(z=>zoneVariants(z).includes(v)).flatMap(z=>z.expected.outcomes.filter(o=>o.kind==='geometry').map(o=>{
      const b=closedForm(z,o,v).bbox?.variants?.[v];
      return b ? {id:z.id,min:b.min.map((x,i)=>x+z.cell.originMm[i]),max:b.max.map((x,i)=>x+z.cell.originMm[i])}:null;
    }).filter(Boolean));
    for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
      const a=boxes[i],b=boxes[j]; if(a.id!==b.id && [0,1,2].every(k=>a.min[k]<=b.max[k] && b.min[k]<=a.max[k])) fail(`GRID_INTERACTION: ${v} ${a.id}/${b.id}`);
    }
  }
  for(const k of KERNELS) kernelClass(c,k);
  return c;
}
// Resolve which source file backs a (zone, kernel, variant) build: a zone
// may override its group's default .fs/.b3d, either uniformly or only for
// specific variants (e.g. V5's alternate-idiom rewrite). Zones without a
// `twin` field always fall back to the group default, so every existing
// zone resolves exactly as the old inline `group.fs`/`group.b3d` lookup did.
export function twinSource(catalog, group, zone, kernel, variant) {
  const key = kernel === 'occt' ? 'b3d' : 'fs';
  const perVariant = zone.twin?.byVariant?.[variant]?.[key];
  if (perVariant) return path.join(ROOT, perVariant);
  if (zone.twin?.[key]) return path.join(ROOT, zone.twin[key]);
  return path.join(ROOT, group[key]);
}
export function sourceHashes(catalog) {
  const files = new Set(catalog.groups.flatMap(g=>[g.fs,g.b3d]));
  for (const z of catalog.zones) {
    if (z.twin?.fs) files.add(z.twin.fs);
    if (z.twin?.b3d) files.add(z.twin.b3d);
    for (const ov of Object.values(z.twin?.byVariant ?? {})) { if (ov.fs) files.add(ov.fs); if (ov.b3d) files.add(ov.b3d); }
  }
  return Object.fromEntries([...files].map(f=>[f,fs.existsSync(path.join(ROOT,f))?sha256(fs.readFileSync(path.join(ROOT,f))):null]));
}
// A frozen row (zone, variant) of a capture is active when (1) the capture's
// manifest verifies, (2) the zone's binding at `level` is canonically equal in
// the capture's catalog copy and in the current catalog, and (3) the twin file
// the zone uses today for this side and variant is the file the capture froze,
// with the same hash. A superseded row is inactive, not an error.
export function activeReferenceKeys(catalog, copy, sources, frozenSources, side, level) {
  const active = new Set(), inactive = [];
  for (const zone of catalog.zones) for (const variant of zoneVariants(zone)) {
    const frozen = copy.zones.find(z => z.id === zone.id);
    if (!frozen || !zoneVariants(frozen).includes(variant)) continue;
    const group = catalog.groups.find(g => g.id === zone.group), frozenGroup = copy.groups.find(g => g.id === frozen.group);
    const file = path.relative(ROOT, twinSource(catalog, group, zone, side, variant));
    const reason = file !== path.relative(ROOT, twinSource(copy, frozenGroup, frozen, side, variant)) ? 'twin file replaced'
      : !sources[file] || frozenSources?.[file] !== sources[file] ? 'twin file changed'
      : zoneBinding(copy, frozen, variant, level) !== zoneBinding(catalog, zone, variant, level) ? `${level} binding changed` : null;
    if (reason) inactive.push({zone:zone.id, variant, reason});
    else active.add(`${zone.id}/${variant}`);
  }
  return {active, inactive};
}
export function verifyFrozenReference(dir, catalog, sources = {}) {
  const refuse = (name, detail) => { const e=new Error(`${name}: ${detail}`); e.name=name; throw e; };
  const p=readJSON(path.join(dir,'provenance.json'));
  const copy=catalogBySha(p.zonesSha256, [path.join(dir,'inputs/zones.json')]);
  if (!copy) refuse('REFERENCE_ZONES_SHA_MISMATCH', 'no verified catalog copy for the frozen reference');
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
  if(sha256(fs.readFileSync(path.join(dir,'inputs/zones.json')))!==p.zonesSha256)refuse('REFERENCE_ZONES_SHA_MISMATCH','frozen input bytes');
  for(const [f,hash] of Object.entries(p.sources??{}))if(f.endsWith('.fs')) {
    const rel=`inputs/${path.basename(f)}`;requireListed(rel);
    if(sha256(fs.readFileSync(path.join(dir,rel)))!==hash)refuse('REFERENCE_STUDIO_SHA_MISMATCH',f);
  }
  for(const s of p.studios??[])if(s.featureStatus==='OK') {
    for(const rel of [s.parts,s.bodydetails,s.boundingboxes,s.translation,s.step,...Object.values(s.mass??{})])requireListed(rel);
  }
  for(const s of p.studios??[]) if(s.featureStatus==='OK' && (!/^[a-f0-9]{24}$/.test(s.microversion??'') || !s.element || !p.document || !p.workspace)) refuse('REFERENCE_IMMUTABLE_ID_MISSING',s.group);
  // Onshape rows are re-observed from the frozen STEP at every run: the
  // geometry binding suffices; the current contract scores the observation.
  return {provenance:p, catalog:copy, ...activeReferenceKeys(catalog, copy, sources, p.sources, 'onshape', 'geometry')};
}
export function sortBodies(bodies) {
  return [...bodies].sort((a,b)=>a.volume-b.volume || (a.centroid?.[0]-b.centroid?.[0]) || (a.centroid?.[1]-b.centroid?.[1]) || (a.centroid?.[2]-b.centroid?.[2]));
}
export const isMain = url => process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(url);
// The zone frame F(p) = cellOrigin + Vk(p) as [R, t] (rows of R), mirroring
// measure.py frame(): the harness passes it to a kernel only as data.
export function zoneFrame(catalog, zone, variant) {
  // V4/V5 carry no geometric frame of their own (V4 is a parameter bump, V5
  // an alternate idiom): both point at the frame that actually moves the
  // cell, via baseFrame. Absent baseFrame resolves to the variant itself,
  // so V0-V3 (which never set it) are unaffected.
  const resolved = catalog.variants[variant].baseFrame ?? variant;
  const v = catalog.variants[resolved];
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
