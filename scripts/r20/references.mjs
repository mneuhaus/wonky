// Onshape B-rep reference volumes for the R20 datums and probe studios
// (scripts/r20/acceptance.mjs). cad-31 supplies them in
// kernel-cases/r20-datums-probe-volumes.json (schema r20/brep-volumes/v1):
// Onshape mass properties of the B-rep, volume_mm3_value_min_max =
// [value, min, max] in mm³ (value is the reference), per part the SHA-256 of
// the Onshape mesh it belongs to, and per studio the SHA-256 of the
// FeatureScript source it was measured from.
//
// A reference only counts for the inputs it was measured on: the studio
// source (build/studios/<studio>.fs) and each part's mesh (var/mesh/<key>.stl,
// also listed in var/state/tessellate-manifest.json) must have the recorded
// hashes. A mismatch or a missing entry is a problem named with the part (or
// studio) it concerns; the acceptance runner fails the affected row with it.
// Nothing here falls back to a mesh-derived volume.
//
// Test tooling only: nothing here constructs geometry. The R20 project is read
// only.
import fs from 'node:fs';
import path from 'node:path';
import { sha256File } from './mesh.mjs';

export const BREP_VOLUMES_SCHEMA = 'r20/brep-volumes/v1';
export const BREP_VOLUMES_FILE = 'kernel-cases/r20-datums-probe-volumes.json';
export const STUDIO_SOURCE = studio => `build/studios/${studio}.fs`;
export const MESH_FILE = key => `var/mesh/${key}.stl`;
export const TESSELLATE_MANIFEST = 'var/state/tessellate-manifest.json';

const HEX64 = /^[0-9a-f]{64}$/;

// Parses the document; throws on a malformed one, naming the field. Returns
// { schema, partStudio, studioSha256: {studio: hex}, parts: {key: {key, name,
// partId, meshSha256, volume: {value, min, max, basis: 'onshape-brep'}}} }.
export function parseBrepVolumes(doc, where = BREP_VOLUMES_FILE) {
  const fail = message => { throw new Error(`${where}: ${message}`); };
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail('not a JSON object');
  if (doc.schema !== BREP_VOLUMES_SCHEMA) fail(`schema is ${JSON.stringify(doc.schema)}, expected ${BREP_VOLUMES_SCHEMA}`);
  const studios = doc.studio_sha256;
  if (!studios || typeof studios !== 'object' || Array.isArray(studios)) fail("needs a 'studio_sha256' object");
  for (const [studio, digest] of Object.entries(studios)) if (!HEX64.test(String(digest))) fail(`studio_sha256.${studio} is not a sha256 hex digest`);
  if (!doc.parts || typeof doc.parts !== 'object' || Array.isArray(doc.parts)) fail("needs a 'parts' object");
  const parts = {};
  for (const [key, row] of Object.entries(doc.parts)) {
    const at = `part ${key}`;
    const triple = row?.volume_mm3_value_min_max;
    if (!Array.isArray(triple) || triple.length !== 3 || !triple.every(Number.isFinite))
      fail(`${at}: volume_mm3_value_min_max must be [value, min, max] (three finite numbers), got ${JSON.stringify(triple)}`);
    const [value, min, max] = triple;
    if (!(value > 0)) fail(`${at}: volume ${value} mm³ is not positive`);
    if (!(min <= value && value <= max)) fail(`${at}: volume interval [${min}, ${max}] does not contain its value ${value}`);
    if (typeof row.name !== 'string' || !row.name.trim()) fail(`${at}: row lacks 'name'`);
    if (!HEX64.test(String(row.mesh_sha256))) fail(`${at}: mesh_sha256 is not a sha256 hex digest`);
    parts[key] = { key, name: row.name, partId: row.part_id ?? null, meshSha256: row.mesh_sha256,
      volume: { value, min, max, basis: 'onshape-brep' } };
  }
  return { schema: doc.schema, partStudio: doc.part_studio ?? null, studioSha256: { ...studios }, parts };
}

// The B-rep references of one studio's parts, checked against the inputs in
// <r20>. Returns { file, studio, problems, refs: [{key, name, stl, sha256,
// volume, bbox: null, problems}] }: `problems` of the studio concern every
// part (source hash, a missing or malformed file); a ref's own `problems`
// concern that part (no entry, mesh hash). A ref without a B-rep entry has
// volume null.
export function studioReferences(r20, studio, keys, { file = path.join(r20, BREP_VOLUMES_FILE) } = {}) {
  const problems = [];
  let doc = null;
  if (!fs.existsSync(file)) problems.push(`B-rep reference volumes missing: ${file}`);
  else {
    try { doc = parseBrepVolumes(JSON.parse(fs.readFileSync(file, 'utf8')), file); }
    catch (error) { problems.push(`B-rep reference volumes unreadable: ${error.message}`); }
  }
  const source = path.join(r20, STUDIO_SOURCE(studio));
  if (doc) {
    const recorded = doc.studioSha256[studio];
    if (!recorded) problems.push(`studio ${studio}: no studio_sha256 entry in ${path.basename(file)}`);
    else if (!fs.existsSync(source)) problems.push(`studio ${studio}: source missing (${source})`);
    else {
      const actual = sha256File(source);
      if (actual !== recorded) problems.push(`studio ${studio}: ${STUDIO_SOURCE(studio)} sha256 ${actual.slice(0, 12)} differs from the B-rep references' ${recorded.slice(0, 12)} (volumes measured on another source)`);
    }
  }
  const manifestPath = path.join(r20, TESSELLATE_MANIFEST);
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (error) { problems.push(`tessellate manifest unreadable: ${manifestPath} (${error.message})`); }
  const refs = keys.map(key => {
    const own = [], row = doc?.parts[key], listed = manifest?.parts?.[key];
    const stl = path.join(r20, MESH_FILE(key));
    if (doc && !row) own.push(`${key}: no B-rep volume in ${path.basename(file)}`);
    if (manifest && !listed) own.push(`${key}: not in ${TESSELLATE_MANIFEST}`);
    const actual = fs.existsSync(stl) ? sha256File(stl) : null;
    if (!actual) own.push(`${key}: mesh missing (${stl})`);
    if (row && actual && actual !== row.meshSha256)
      own.push(`${key}: ${MESH_FILE(key)} sha256 ${actual.slice(0, 12)} differs from the B-rep references' mesh_sha256 ${row.meshSha256.slice(0, 12)}`);
    if (listed && actual && actual !== listed.sha256)
      own.push(`${key}: ${MESH_FILE(key)} sha256 ${actual.slice(0, 12)} differs from ${TESSELLATE_MANIFEST} ${String(listed.sha256).slice(0, 12)}`);
    if (row && listed && row.meshSha256 !== listed.sha256)
      own.push(`${key}: B-rep references' mesh_sha256 ${row.meshSha256.slice(0, 12)} differs from ${TESSELLATE_MANIFEST} ${String(listed.sha256).slice(0, 12)}`);
    if (row && listed && row.name !== listed.name) own.push(`${key}: B-rep reference name ${JSON.stringify(row.name)} differs from the mesh's ${JSON.stringify(listed.name)}`);
    return { key, name: row?.name ?? listed?.name ?? key, stl, sha256: row?.meshSha256 ?? listed?.sha256 ?? null,
      volume: row ? { ...row.volume } : null, bbox: null, problems: own };
  });
  return { file, studio, problems, refs };
}
