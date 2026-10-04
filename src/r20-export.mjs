// The R20 check export (`--format r20-check`): one binary STL per part and a
// manifest in the shape cad-31's R20 project reads (tools/tessellate.py writes
// it from Onshape, checks/meshes.py reads it), so a wonky build can stand in
// for an Onshape tessellation in that project's checks.
//
//   <out>/<key>.stl                 binary STL, mm, world coordinates, Z up
//   <out>/tessellate-manifest.json  {schema, part_studio, fingerprint, parts:
//                                    {key: {name, part_id, triangles, sha256,
//                                    description, wonky: {...}}}}
//
// The key is the first whitespace token of the part's NAME, sanitised to
// [A-Za-z0-9._-], unique case-insensitively and never the part id: the rule
// resolve_bodies applies in tools/tessellate.py, so both sides key a part the
// same way.
//
// Fail closed. Every part is named, meshed, quantised to the float32 the file
// holds and checked (one watertight, consistently wound body of positive
// volume) in memory before a byte is written. Any refusal leaves the
// directory with error.json and without a manifest or STL, so a stale export
// can never be read as the current one.
//
// The mesh is src/print-mesh.mjs: every sample point comes from Bend, and the
// deviation it holds is stated per part. Nothing here constructs geometry; the
// host only quantises, packs and checks.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FeatureScriptError, UnsupportedFeatureError } from './errors.mjs';
import { printMesh, meshDefects } from './print-mesh.mjs';
import { integrateVolume } from './volume.mjs';
import { isMeshBody } from './hybrid-mesh.mjs';
import { fallbackRecord } from './diagnostics.mjs';
import { isRustBody, rustStl } from './native/rust-host.mjs';

export const R20_MANIFEST_SCHEMA = 'r20/tessellate-manifest/v1';
export const R20_MANIFEST_NAME = 'tessellate-manifest.json';
export const R20_ERROR_NAME = 'error.json';

// A refusal of the export contract (a part without a usable key, a mesh the
// file could not carry faithfully). Not a FeatureScript exception: a `try` in
// the source never sees it, since it happens after the build.
export class R20ExportError extends FeatureScriptError {
  constructor(message) { super(message); this.name = 'R20ExportError'; }
}
const refuse = message => { throw new R20ExportError(`r20-check export: ${message}`); };

export const sanitizeKey = token => token.replace(/[^A-Za-z0-9._-]/g, '_');
// onshape_sync.part_key: the first whitespace token, or '' for a blank name.
export const partKey = name => sanitizeKey(String(name ?? '').trim().split(/\s+/)[0] ?? '');

const sha256 = data => createHash('sha256').update(data).digest('hex');
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Keys for every body, all checked before any meshing: a missing NAME, a key
// that is empty, '.', '..' or the part id, and a case-insensitive duplicate
// are each refused by name.
export function partKeys(bodies) {
  const taken = new Map();
  return bodies.map(body => {
    const name = body.name;
    if (typeof name !== 'string' || !name.trim())
      refuse(`body ${body.id} has no NAME; every part is keyed by the first token of its NAME (setProperty PropertyType.NAME)`);
    const key = partKey(name);
    if (['', '.', '..'].includes(key)) refuse(`body ${body.id} has no usable part key in its NAME ${JSON.stringify(name)}`);
    if (key === sanitizeKey(String(body.id))) refuse(`body ${body.id}: the key ${key} of NAME ${JSON.stringify(name)} is its part id, not a part key`);
    const folded = key.toLowerCase();
    if (taken.has(folded))
      refuse(`duplicate part key ${key} (case-insensitive): NAME ${JSON.stringify(name)} of body ${body.id} collides with NAME ${JSON.stringify(taken.get(folded).name)} of body ${taken.get(folded).id}`);
    taken.set(folded, body);
    return key;
  });
}

// Edge-connected components on exact (here: float32) coordinates.
function components(triangles) {
  const ids = new Map(), vid = p => { const k = `${p[0]},${p[1]},${p[2]}`; if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
  const faces = triangles.map(t => t.map(vid)), parent = faces.map((_, i) => i), owner = new Map();
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  faces.forEach((f, index) => {
    for (let k = 0; k < 3; k++) {
      const u = f[k], v = f[(k + 1) % 3], id = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (owner.has(id)) parent[find(index)] = find(owner.get(id)); else owner.set(id, index);
    }
  });
  return new Set(faces.map((_, i) => find(i))).size;
}

// Rust writes a certified binary STL directly from its audited WC0 body.
// The Rust mesher and float32 writer each hold at most half the requested
// deviation (mesh.rs). Validate the actual stored triangles before publishing.
function rustPartStl(kernel, body, where, deviationMm) {
  const buffer = rustStl(kernel, [body], deviationMm);
  const count = buffer.readUInt32LE(80);
  if (!count || count > 2_000_000 || buffer.length !== 84 + 50 * count)
    refuse(where + ': invalid Rust binary STL triangle count');
  const triangles = Array.from({ length: count }, (_, i) => {
    const offset = 84 + 50 * i;
    return Array.from({ length: 3 }, (_, j) =>
      Array.from({ length: 3 }, (_, k) => buffer.readFloatLE(offset + 12 + j * 12 + k * 4)));
  });
  const checked = packStl(triangles, where);
  // Certified upper bounds: Rust proves both before and after quantization.
  const half = deviationMm / 2;
  return { ...checked, buffer, deviationMm, achievedDeviationMm: deviationMm,
    meshDeviationMm: half, float32RoundingMm: half,
    meshSource: 'Rust WC0 certified mesh and float32 storage (each <= half requested deviation)' };
}

// One part: the print mesh, quantised to float32 and checked as the reader
// will see it, then packed as a binary STL (80-byte zero header like
// tools/tessellate.py, uint32 count, 12 float32 + uint16 per triangle).
export function partStl(kernel, body, key, deviationMm) {
  const where = `part ${key} (body ${body.id})`;
  if (isRustBody(body)) return rustPartStl(kernel, body, where, deviationMm);
  let mesh;
  // The mesher's own refusal keeps its class; it only learns which part it was.
  try { mesh = printMesh(kernel, body, deviationMm); }
  catch (error) { if (error instanceof Error) error.message = `r20-check export: ${where}: ${error.message}`; throw error; }
  // A hybrid mesh (an attached result mesh or a certified-mesh body) keeps
  // corefine's slivers, whose corners can round to one float32 point far from
  // the origin; those triangles are dropped (packStl collapseFloat32), and the
  // stored mesh must still pass every check below.
  const packed = packStl(mesh.triangles, where, { collapseFloat32: !!mesh.source });
  if (!(mesh.achievedDeviationMm <= deviationMm)) refuse(`${where}: the print mesh holds ${mesh.achievedDeviationMm} mm, more than the requested ${deviationMm} mm`);
  // --deviation bounds the mesh; the stored-file statement also includes its
  // quantization. Barycentric interpolation bounds each retained triangle;
  // packStl separately checks coverage of triangles deleted by edge collapse.
  return { ...packed, deviationMm, achievedDeviationMm: upperSum(mesh.achievedDeviationMm, packed.float32RoundingMm),
    meshDeviationMm: mesh.achievedDeviationMm, ...(mesh.source ? { meshSource: mesh.source } : {}),
    ...(mesh.approximation?.snap ? { snap: mesh.approximation.snap } : {}) };
}

// Adjacent positive binary64 values, not an unexplained epsilon multiplier.
const roundingBits = new DataView(new ArrayBuffer(8));
function neighbour(x, step) {
  roundingBits.setFloat64(0, x);
  roundingBits.setBigUint64(0, roundingBits.getBigUint64(0) + step);
  return roundingBits.getFloat64(0);
}
const up = x => neighbour(x, 1n);
const upperSum = (a, b) => a === 0 ? b : b === 0 ? a : up(a + b);
function storageRounding(triangles, where) {
  let worst = 0;
  for (const t of triangles) for (const p of t) {
    const differences = p.map(x => {
      const q = Math.fround(x);
      if (!Number.isFinite(x) || !Number.isFinite(q)) refuse(`${where}: non-finite float32 coordinate`);
      // Outward subtraction also covers subnormals, without assuming Sterbenz.
      return q === x ? 0 : up(Math.abs(q - x));
    });
    const scale = Math.max(...differences);
    if (scale === 0) continue;
    // Normalize before squaring: the norm squared stays between 1 and ~3,
    // even when an unscaled displacement square would underflow to zero.
    let square = 0;
    for (const d of differences) if (d !== 0) {
      const relative = up(d / scale);
      square = upperSum(square, up(relative * relative));
    }
    let bound = Math.sqrt(up(square));
    // Verify the root using a DOWN-rounded square, not a hypot epsilon.
    while (neighbour(bound * bound, -1n) < square) bound = up(bound);
    worst = Math.max(worst, up(bound * scale));
  }
  return worst;
}

// Quantise, check and pack one part's triangles; refuses by name. Storage
// deviation is an outward Euclidean norm bound, added to the mesh budget.
export function packStl(meshTriangles, where, { collapseFloat32 = false } = {}) {
  const float32RoundingMm = storageRounding(meshTriangles, where);
  const rounded = meshTriangles.map(t => t.map(p => p.map(Math.fround)));
  const collapsed = ([a, b, c]) => [a, b, c].some((p, i, all) => {
    const q = all[(i + 1) % 3];
    return p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
  });
  // Dropping a triangle whose corners coincide in float32 is an edge collapse
  // of the stored mesh; watertightness and orientation are re-checked below.
  const triangles = collapseFloat32 ? rounded.filter(t => !collapsed(t)) : rounded;
  const collapsedFloat32 = rounded.length - triangles.length;
  if (collapsedFloat32) {
    const vertices = new Set(), edges = new Set();
    const key = p => p.join(','), edgeKey = (a, b) => [a, b].sort().join('|');
    for (const t of triangles) for (let i = 0; i < 3; i++) {
      vertices.add(key(t[i]));
      edges.add(edgeKey(key(t[i]), key(t[(i + 1) % 3])));
    }
    for (const t of rounded) if (collapsed(t)) {
      const points = [...new Set(t.map(key))];
      if (points.length === 1 ? !vertices.has(points[0]) : !edges.has(edgeKey(...points)))
        refuse(`${where}: collapsed float32 triangle is not covered by the stored surface`);
    }
  }
  if (!triangles.length) refuse(`${where}: the mesh has no triangles`);
  const degenerate = triangles.filter(collapsed).length;
  if (degenerate) refuse(`${where}: ${degenerate} triangles collapse when stored as float32`);
  const defects = meshDefects(triangles);
  if (!defects.watertight)
    refuse(`${where} is not watertight as stored (${defects.open} open, ${defects.misoriented} misoriented, ${defects.nonManifold} non-manifold edges)`);
  const pieces = components(triangles);
  if (pieces !== 1) refuse(`${where} has ${pieces} separate bodies; the r20 check takes exactly one body per part`);
  const volume = triangles.reduce((sum, [a, b, c]) => sum + dot(a, cross(b, c)) / 6, 0);
  if (!(volume > 0)) refuse(`${where}: mesh volume ${volume} mm³ is not positive (inside out)`);

  const buffer = Buffer.alloc(84 + 50 * triangles.length);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach(([a, b, c], i) => {
    const n = cross(sub(b, a), sub(c, a)), length = Math.hypot(...n);
    const values = [...(length > 0 ? n.map(v => v / length) : [0, 0, 0]), ...a, ...b, ...c];
    const offset = 84 + 50 * i;
    values.forEach((v, k) => buffer.writeFloatLE(v, offset + 4 * k));
    buffer.writeUInt16LE(0, offset + 48);
  });
  return { buffer, triangles: triangles.length, meshVolumeMm3: volume, float32RoundingMm, ...(collapsedFloat32 ? { collapsedFloat32 } : {}) };
}

// What the part's own B-rep says about its volume and exactness. A body that
// states an approximation (body.approximation, or an exactness label such as
// 'regularized' or 'quantized') is never reported exact.
// A body without a volume of its own (imported, recovered by the hybrid
// Boolean) states the integrated one (src/volume.mjs) with its bound; only a
// closed-form integration counts as exact. A certified-mesh body
// (src/hybrid-mesh.mjs) states the carrier-method volume, or its mesh estimate
// with the area x deviation bound, each labelled; it is never exact, and its
// STL is its own certified mesh ('meshSource').
function wonkyRow(kernel, body, part) {
  let volumeMm3 = body.validation?.volumeMm3 ?? null, integrated = null, volumeRefusal = null;
  if (volumeMm3 === null && (isMeshBody(body) || (body.geometry === 'analytic' && !body.approximation))) {
    // A refused integration leaves the volume unstated (named), not the export.
    try { integrated = integrateVolume(kernel, body); volumeMm3 = integrated.volumeMm3; }
    catch (error) { if (!(error instanceof UnsupportedFeatureError)) throw error; volumeRefusal = error.message; }
  }
  const approximation = body.approximation
    ?? (body.exactness ? { label: body.exactness, ...(body.regularization ? {regularization:body.regularization} : {}), ...(body.regularizedSources?.length ? { sources: body.regularizedSources } : {}) } : null);
  return { volumeMm3, exact: volumeMm3 !== null && approximation === null && (integrated?.label ?? 'exact') === 'exact', approximation,
    ...(integrated ? { volumeBoundMm3: integrated.boundMm3, volumeLabel: integrated.label, volumeMethod: integrated.method,
      ...(integrated.carrierRefusal ? { carrierRefusal: integrated.carrierRefusal } : {}) } : {}),
    ...(volumeRefusal ? { volumeRefusal } : {}),
    meshVolumeMm3: part.meshVolumeMm3, deviationMm: part.deviationMm, achievedDeviationMm: part.achievedDeviationMm,
    meshDeviationMm: part.meshDeviationMm, float32RoundingMm: part.float32RoundingMm,
    ...(part.meshSource ? { meshSource: part.meshSource } : {}), ...(part.snap ? { snap: part.snap } : {}),
    ...(part.collapsedFloat32 ? { collapsedFloat32Triangles: part.collapsedFloat32 } : {}) };
}

// sha256 over what determines the build: the source text, the feature, the
// parameters (sorted) and the frozen-modules manifest (its bytes; the
// manifest pins every imported revision by hash).
export function r20Fingerprint({ source, feature, parameters = {}, moduleManifest = null }) {
  const modules = moduleManifest ? sha256(readFileSync(moduleManifest)) : null;
  const canonical = JSON.stringify({ schema: 'wonky/r20-fingerprint/1', source: sha256(source), feature: feature ?? null,
    parameters: Object.keys(parameters).sort().map(name => [name, parameters[name]]), modules });
  return sha256(canonical);
}

// The whole export in memory. Throws R20ExportError (or the print mesh's own
// refusal) before anything is written.
export function r20Export(kernel, model, { deviationMm, sourcePath, source, feature, parameters = {}, moduleManifest = null, startedAt = performance.now() }) {
  if (!(deviationMm > 0)) refuse('a positive --deviation in mm is required');
  const keys = partKeys(model.bodies);
  const selected = model.source?.feature ?? feature ?? null;
  const manifest = { schema: R20_MANIFEST_SCHEMA, part_studio: `wonky:${sourcePath}#${selected}`,
    fingerprint: r20Fingerprint({ source, feature: selected, parameters, moduleManifest }),
    ...(model.regularization ? {regularization:model.regularization} : {}), parts: {} };
  const files = [];
  model.bodies.forEach((body, i) => {
    const key = keys[i], part = partStl(kernel, body, key, deviationMm);
    files.push({ name: `${key}.stl`, data: part.buffer });
    const diagnostic = fallbackRecord(body);
    if (diagnostic) files.push({ name: `fallbacks/${key}.json`, data: JSON.stringify(diagnostic, null, 2) + '\n' });
    manifest.parts[key] = { name: body.name, part_id: body.id, triangles: part.triangles, sha256: sha256(part.buffer),
      description: body.description ?? null, wonky: wonkyRow(kernel, body, part) };
  });
  manifest.resources = { module: selected, wallTimeMs: performance.now() - startedAt,
    maxRSSKiB: process.resourceUsage().maxRSS,
    scope: 'CLI module build and in-memory export, excluding publication IO; RSS is the process high-water mark in KiB' };
  files.push({ name: R20_MANIFEST_NAME, data: JSON.stringify(manifest, null, 2) + '\n' });
  return { manifest, files };
}

// Files an earlier export may have left: every STL, the manifest and an
// error report. The directory belongs to the export, as var/mesh/ does to
// tools/tessellate.py, which retires stale meshes the same way.
const exportFile = name => /\.stl$/i.test(name) || name === R20_MANIFEST_NAME || name === R20_ERROR_NAME;

async function atomicWrite(target, data) {
  const temporary = `${target}.${process.pid}.tmp`;
  try { await writeFile(temporary, data); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
}

// Meshes first, the manifest last, then stale files go: a reader never sees
// a manifest whose meshes are not all in place.
export async function writeR20Export(outDir, { files }) {
  await mkdir(outDir, { recursive: true });
  // Only our diagnostic directory is retired; println.log is append-only.
  await rm(join(outDir, 'fallbacks'), { recursive: true, force: true });
  for (const file of files) if (file.name !== R20_MANIFEST_NAME) {
    if (file.name.startsWith('fallbacks/')) await mkdir(join(outDir, 'fallbacks'), { recursive: true });
    await atomicWrite(join(outDir, file.name), file.data);
  }
  await atomicWrite(join(outDir, R20_MANIFEST_NAME), files.find(f => f.name === R20_MANIFEST_NAME).data);
  const current = new Set(files.map(f => f.name.toLowerCase()));
  for (const name of readdirSync(outDir)) if (exportFile(name) && !current.has(name.toLowerCase())) await rm(join(outDir, name), { force: true });
  return files.map(f => join(outDir, f.name));
}

// `operation` (only for an error raised inside a traced modeling operation,
// src/source-map.mjs): its id chain (model/T01/hollow/subtract), the std
// function and the FeatureScript calls that reached it; line and column stay
// the innermost source location, which for a shared helper is the helper's.
export function r20ErrorRecord(error, sourcePath) {
  const located = error instanceof FeatureScriptError;
  return { class: located ? error.name : error?.name ?? 'Error', message: String(error?.message ?? error),
    file: sourcePath ? resolve(sourcePath) : null, line: located ? error.line ?? null : null, column: located ? error.column ?? null : null,
    ...(error?.operation?.id ? { operation: error.operation } : {}),
    ...(error?.diagnosticDump ? { dump: error.diagnosticDump } : {}),
    ...(error?.regularization ? {regularization:error.regularization} : {}) };
}

// Any failure: the previous export is retired and error.json says why.
export async function writeR20Error(outDir, error, sourcePath) {
  await mkdir(outDir, { recursive: true });
  for (const name of readdirSync(outDir)) if (exportFile(name)) await rm(join(outDir, name), { force: true });
  const target = join(outDir, R20_ERROR_NAME);
  await atomicWrite(target, JSON.stringify(r20ErrorRecord(error, sourcePath), null, 2) + '\n');
  return target;
}
