// Freeze the already fetched, immutable configured Onshape responses without
// reading live CAD or changing the G0 reference. Only the five blended modules
// are copied; the other three continue to use their byte-identical G0 meshes.
// Usage: node scripts/r20/freeze-blends.mjs <response-directory>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FIXTURE_DIR, verifyFixture, verifyBlendFixture } from './modules.mjs';

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const responses = process.argv[2];
if (!responses || process.argv.length !== 3) throw Error('usage: freeze-blends.mjs <response-directory>');
const base = verifyFixture();
if (!base.ok) throw Error(`G0 provenance invalid: ${JSON.stringify(base.problems)}`);
const dir = path.resolve(responses), output = path.join(FIXTURE_DIR, 'blends');
if (fs.existsSync(output)) throw Error(`${output} already exists; never overwrite frozen references`);
const read = name => {
  const headers = fs.readFileSync(path.join(dir, `${name}.headers`), 'utf8');
  if (!/^HTTP\/1\.1 200 OK/m.test(headers)) throw Error(`${name}: HTTP status was not 200`);
  const date = headers.match(/^Date:\s*(.+)$/im)?.[1]?.trim();
  if (!date || !Number.isFinite(Date.parse(date))) throw Error(`${name}: no valid server date`);
  return { date: new Date(date).toISOString(), data: JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8')) };
};
const frozen = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'studios/r20-modules-volumes.json')));
const oldParts = Object.fromEntries(Object.entries(frozen.parts).map(([key, p]) => [p.name, { key, ...p }]));
const oldMass = read('default-mass').data, oldBox = read('default-bbox').data;
const preBox = read('pre-bbox').data;
const defaultFaces = read('default-faces').data;
if (JSON.stringify(oldBox) !== JSON.stringify(preBox)) throw Error('default B-rep bbox regressed from restore version');
for (const p of Object.values(frozen.parts)) {
  const values = oldMass.bodies[p.part_id]?.volume?.map(x => x * 1e9);
  if (!values || values.some((x, i) => Math.abs(x - p.volume_mm3_value_min_max[i]) > 1e-7))
    throw Error(`${p.name}: G0 volume regressed`);
}
const mesh = body => {
  const triangles = body.faces.flatMap(f => f.facets);
  if (!triangles.length) throw Error(`${body.id}: empty tessellation`);
  const bytes = Buffer.alloc(84 + triangles.length * 50);
  bytes.writeUInt32LE(triangles.length, 80);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < triangles.length; i++) {
    const { normal, vertices } = triangles[i], offset = 84 + i * 50;
    const xyz = vertices.map(v => Array.isArray(v) ? v : [v.x, v.y, v.z]);
    [...(Array.isArray(normal) ? normal : [normal.x, normal.y, normal.z]), ...xyz.flat().map(x => x * 1000)]
      .forEach((value, j) => bytes.writeFloatLE(value, offset + 4 * j));
    for (let v = 0; v < 3; v++) for (let axis = 0; axis < 3; axis++) {
      const x = bytes.readFloatLE(offset + 12 + v * 12 + axis * 4);
      min[axis] = Math.min(min[axis], x);
      max[axis] = Math.max(max[axis], x);
    }
  }
  return { bytes, bbox_mm: [...min, ...max], triangles: triangles.length };
};
for (const body of defaultFaces) {
  const p = Object.values(frozen.parts).find(x => x.part_id === body.id);
  if (!p) throw Error(`unknown G0 body ${body.id}`);
  if (sha256(mesh(body).bytes) !== base.provenance.files.find(f => f.path === `mesh/${oldParts[p.name].key}.stl`)?.sha256)
    throw Error(`${p.name}: default reference STL regressed`);
}
const doc = base.provenance.onshape.document, element = base.provenance.onshape.partStudio.id;
const microversion = 'c501c5ae9c11a4feb10a8a50', configuration = 'withBlends=true';
const parts = read('blended-parts'), mass = read('blended-mass'), bounds = read('blended-bbox'), faces = read('blended-faces');
if (mass.data.microversionId !== microversion || parts.data.some(p => p.microversionId !== microversion))
  throw Error('configured response is not from the required immutable microversion');
if (parts.data.length !== 33 || faces.data.length !== 33 || Object.keys(mass.data.bodies).length !== 33)
  throw Error('configured response does not contain all 33 parts');
const byName = new Map(parts.data.map(p => [p.name, p]));
const byId = new Map(faces.data.map(b => [b.id, b]));
if (byName.size !== 33 || byId.size !== 33) throw Error('duplicate configured part name or tessellated body');
const provenance = {
  schema: 'wonky/r20-modules-blends/1', frozenAt: execFileSync('date', ['-u', '+%Y-%m-%dT%H:%M:%SZ'], { encoding: 'utf8' }).trim(),
  baseProvenanceSha256: sha256(fs.readFileSync(path.join(FIXTURE_DIR, 'provenance.json'))),
  baseStateSha256: sha256(fs.readFileSync(path.join(FIXTURE_DIR, 'onshape-state.json'))),
  document: doc, workspace: base.provenance.onshape.workspace, element, microversion,
  restoreVersion: 'onshape-id-13dd344e',
  tessellation: 'angleTolerance=0.05 rad; chordTolerance=0.05; facet normals=true; same options as G0 tools/tessellate.py',
  bboxBasis: 'per-part tessellated STL float32 vertices (G0 basis); boundingboxes endpoint returns aggregate B-rep only',
  aggregateBrepBoundingBoxM: bounds.data, modules: {},
};
const staging = fs.mkdtempSync(path.join(FIXTURE_DIR, '.blends-'));
try {
  fs.mkdirSync(path.join(staging, 'mesh'));
  const seen = new Set();
  for (const [module, entry] of Object.entries(base.provenance.modules)) {
    if (!entry.liveParams.includes('withBlends')) continue;
    const source = base.provenance.onshape.featureStudios[module];
    const studio = read(`studio-${module}`).data;
    if (sha256(Buffer.from(studio.contents)) !== source.uploadedSha ||
        sha256(fs.readFileSync(path.join(FIXTURE_DIR, entry.source))) !== source.uploadedSha ||
        studio.sourceMicroversion !== microversion)
      throw Error(`${module}: live studio source differs from the frozen snapshot`);
    const moduleParts = {};
    for (const key of entry.parts) {
      const original = frozen.parts[key], part = byName.get(original.name);
      if (!part || seen.has(part.partId)) throw Error(`${key}: configured part missing or duplicated`);
      seen.add(part.partId);
      if (!part.description.startsWith(`${entry.stamp} live=`) || !part.description.split(' | ')[0].includes('withBlends:true'))
        throw Error(`${key}: configured part does not carry the true live stamp`);
      const body = byId.get(part.partId), volume = mass.data.bodies[part.partId]?.volume;
      if (!body || !volume || volume.length !== 3) throw Error(`${key}: tessellation or B-rep volume missing`);
      const stl = mesh(body), rel = `mesh/${key}.stl`;
      fs.writeFileSync(path.join(staging, rel), stl.bytes);
      const suffix = `/d/${doc}/m/${microversion}/e/${element}`;
      const query = `configuration=withBlends%3Dtrue`;
      const facesQuery = 'angleTolerance=0.05&chordTolerance=0.05&outputFaceAppearances=false&outputVertexNormals=false&outputFacetNormals=true&outputTextureCoordinates=false&outputIndexTable=false&outputErrorFaces=false&combineCompositePartConstituents=false&';
      moduleParts[key] = {
        name: part.name, partId: part.partId, description: part.description, configuration,
        fetchedAt: faces.date, endpoints: {
          parts: `/api/parts${suffix}?${query}`,
          tessellatedfaces: `/api/partstudios${suffix}/tessellatedfaces?${facesQuery}${query}`,
          massproperties: `/api/partstudios${suffix}/massproperties?massAsGroup=false&${query}`,
          boundingboxes: `/api/partstudios${suffix}/boundingboxes?${query}`,
        },
        volume_mm3_value_min_max: volume.map(x => x * 1e9), bbox_mm: stl.bbox_mm,
        sha256: sha256(stl.bytes), bytes: stl.bytes.length, triangles: stl.triangles,
      };
    }
    provenance.modules[module] = {
      configuration, sourceSha256: source.uploadedSha, sourceMicroversion: source.sourceMicroversion, parts: moduleParts,
    };
  }
  fs.writeFileSync(path.join(staging, 'provenance.json'), JSON.stringify(provenance, null, 1) + '\n');
  const verified = verifyBlendFixture(base, staging);
  if (!verified.ok) throw Error(`blended fixture invalid: ${JSON.stringify(verified.problems)} ${JSON.stringify(verified.modules)}`);
  fs.renameSync(staging, output);
  const size = Object.values(provenance.modules).flatMap(m => Object.values(m.parts)).reduce((s, p) => s + p.bytes, 0);
  console.log(`froze ${seen.size} configured parts in ${Object.keys(provenance.modules).length} modules; ${(size / 1e6).toFixed(2)} MB of STL; integrity OK`);
} catch (error) {
  fs.rmSync(staging, { recursive: true, force: true });
  throw error;
}
