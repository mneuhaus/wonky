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
// Observed defect class (G5, 2026-09-28): Onshape's tessellatedfaces endpoint
// is not reliably byte-identical across independently-timed live fetches of
// the SAME immutable microversion -- confirmed for 10/33 parts at
// onshape-id-410ad4a6 (MOTOR_MOUNT_L, HUB_R, CORE_R, ARM_R, P03B_B,
// PINION, P01, K15, CORE_L, RACK): identical triangle counts, mesh-derived
// volumes agreeing to ~1.4e-10 relative in every case -- the same solid,
// retriangulated differently server-side, not a geometry change. A raw
// sha256(STL bytes) equality check conflates that harmless retriangulation
// with a real regression. The B-rep checks above (aggregate bbox vs restore
// version, per-part mass volume vs G0 within 1e-7 mm3) already gate the
// actual geometry and are UNCHANGED and remain authoritative; this
// cross-check is now tessellation-independent instead of byte-exact: same
// triangle count, and the float32 STL bbox within 1 float32 ulp per
// coordinate (the STL format's own representable precision, not an
// arbitrarily chosen tolerance).
//
// The mesh-volume relative tolerance was measured, not guessed: computing
// the STL-derived volume (divergence theorem over the triangulation) for
// all 33 parts against this same live fetch showed 32/33 agreeing to
// <=2.0e-10 relative (most exactly 0, byte-identical STLs), and one part --
// P03B_B, whose curved rail/rack-hybrid faces evidently give the mesher more
// retriangulation freedom -- at 2.6870994241277578e-8 relative. That part's
// bbox matched G0 to 0 float32 ulp (bit-identical), and its B-rep
// mass-property volume carries Onshape's own reported uncertainty of
// (63943.36721759336-63920.39012784927)/63931.878672721265 = 3.6e-4
// relative (see fixtures/r20-modules/studios/r20-modules-volumes.json) --
// i.e. the authoritative analytic check already tolerates >13,000x more
// relative slop than the 2.69e-8 mesh-volume noise observed here. A flat
// 1e-9 relative tolerance would therefore reject this same, unregressed
// part on every future re-freeze that happens to land on this alternate
// triangulation. The tolerance below is set to 1e-7: ~3.7x margin above the
// worst measured cross-triangulation noise, while remaining >1000x tighter
// than the authoritative B-rep check's own precision for the same part, so
// it still catches any real geometry regression long before this secondary,
// tessellation-derived check would.
const parseStl = bytes => {
  const triangles = bytes.readUInt32LE(80);
  if (bytes.length !== 84 + triangles * 50) throw Error('not a binary STL');
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let volume6 = 0;
  for (let i = 0; i < triangles; i++) {
    const offset = 84 + i * 50;
    const v = [0, 1, 2].map(k => [0, 1, 2].map(axis => bytes.readFloatLE(offset + 12 + k * 12 + axis * 4)));
    for (const pt of v) for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], pt[axis]);
      max[axis] = Math.max(max[axis], pt[axis]);
    }
    const [a, b, c] = v;
    volume6 += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return { triangles, bbox: [...min, ...max], volume: Math.abs(volume6) / 6 };
};
// Distance from the float32 value nearest x to its next representable float32
// (away from zero): the size of "1 float32 ulp" at that magnitude, computed
// from the actual bit pattern rather than a log2 approximation.
const f32Ulp = x => {
  const buf = new Float32Array([x]), view = new Uint32Array(buf.buffer);
  if (buf[0] === 0) { view[0] = 1; return buf[0]; }
  view[0] += buf[0] > 0 ? 1 : -1;
  return Math.abs(buf[0] - x);
};
for (const body of defaultFaces) {
  const p = Object.values(frozen.parts).find(x => x.part_id === body.id);
  if (!p) throw Error(`unknown G0 body ${body.id}`);
  const key = oldParts[p.name].key;
  const g0Bytes = fs.readFileSync(path.join(FIXTURE_DIR, 'mesh', `${key}.stl`));
  const g0 = parseStl(g0Bytes), fresh = parseStl(mesh(body).bytes);
  if (fresh.triangles !== g0.triangles)
    throw Error(`${p.name}: default reference triangle count regressed (${fresh.triangles} vs ${g0.triangles})`);
  for (let axis = 0; axis < 6; axis++) {
    const tol = f32Ulp(g0.bbox[axis]);
    if (Math.abs(fresh.bbox[axis] - g0.bbox[axis]) > tol)
      throw Error(`${p.name}: default reference bbox axis ${axis} regressed beyond 1 float32 ulp (${fresh.bbox[axis]} vs ${g0.bbox[axis]}, tolerance ${tol})`);
  }
  const relVolume = Math.abs(fresh.volume - g0.volume) / Math.abs(g0.volume);
  if (relVolume > 1e-7)
    throw Error(`${p.name}: default reference mesh volume regressed beyond 1e-7 relative (${relVolume})`);
}
const doc = base.provenance.onshape.document, element = base.provenance.onshape.partStudio.id;
const microversion = 'onshape-id-410ad4a6', configuration = 'withBlends=true';
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
  restoreVersion: 'onshape-id-34cd8bc5',
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
