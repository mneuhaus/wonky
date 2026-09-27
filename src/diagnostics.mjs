// Observations only. No matching by proximity, geometry repair, or new kernel
// verdicts. Weak side tables keep diagnostics out of B-rep bytes and identities.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const sources = new WeakMap(), sketches = new WeakMap(), parents = new WeakMap(), fallbacks = new WeakMap(), profileFaces = new WeakMap();
const list = value => {
  if (Array.isArray(value)) return value;
  const result = [];
  for (let v = value; v?.$ === 'Con'; v = v.tail) result.push(v.head);
  return result;
};
const unique = values => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
const safe = value => String(value).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+$/, '_');

export function noteSketch(sketch, entityId, record) {
  if (!sketches.has(sketch)) sketches.set(sketch, new Map());
  sketches.get(sketch).set(entityId, record);
}
export function noteSource(body, record, sketch = null) { sources.set(body, { record, sketch }); }
// Supplied by the constructors' actual ordered profile uses, never inferred
// from nearby coordinates after the fact.
export function noteProfileFaces(body, entities) { profileFaces.set(body, entities); }
export function noteParents(body, operands, { transformed = false, rows = null, offset = null } = {}) {
  parents.set(body, { operands, transformed, rows, offset });
}

function directSource(body, faceIndex) {
  const observed = sources.get(body), identity = body.identity;
  const operation = observed?.record;
  const source = operation?.source ?? identity?.operation?.source ?? body.debug?.source;
  const faceSource = identity?.topology?.faces?.[faceIndex]?.source;
  const sketch = observed?.sketch, recorded = sketches.get(sketch);
  let entityIds = profileFaces.get(body)?.[faceIndex] ?? (faceSource?.entityId ? [faceSource.entityId] : []);
  const profile = body.sketchProfile ?? sketch?.arcProfileSource ?? sketch?.lineProfileSource;
  if (!entityIds.length && faceSource?.sourceEdges && profile?.profileUses)
    entityIds = faceSource.sourceEdges.map(i => profile.profileUses[i]?.entityId).filter(Boolean);
  // A circle/rectangle/polyline is one named profile. Caps identify the
  // generating feature, not a made-up boundary entity.
  if (!entityIds.length && faceIndex >= 2 && recorded?.size === 1) entityIds = [...recorded.keys()];
  const entities = entityIds.length ? entityIds : [null];
  return entities.map(entityId => {
    const entity = entityId === null ? null : recorded?.get(entityId);
    const located = entity?.source ?? (faceSource?.span ? { ...source, span: faceSource.span } : source);
    const geometry = profile?.entities?.find(e => e.id === entityId) ?? profile?.segments?.find(e => e.id === entityId);
    return {
      featureId: operation?.feature?.id ?? identity?.operationId ?? body.id,
      featureName: operation?.feature?.name ?? operation?.name ?? identity?.operation?.type ?? null,
      featureLine: operation?.feature?.line ?? null,
      operationId: operation?.operationId ?? identity?.operationId ?? body.id,
      operationName: operation?.name ?? identity?.operation?.type ?? null,
      file: located?.file ?? null, line: located?.span?.line ?? null,
      operationLine: source?.span?.line ?? null,
      operationParameters: operation?.parameters?.at(-1) ?? null,
      sketchId: faceSource?.sketchId ?? (sketch ? String(sketch.id) : null),
      sketchEntityId: entityId,
      sketchOperation: entity?.name ?? null,
      entityGeometry: geometry ? Object.fromEntries(Object.entries(geometry).filter(([key]) => !['native'].includes(key))) : entity?.parameters?.at(-1) ?? null,
      sketchPlane: sketch ? { origin: sketch.plane.origin.items.map(v => v.value * 1000), normal: sketch.plane.normal.items, x: sketch.plane.x.items } : null,
      ...(located?.span?.line ? {} : { missing: 'source call location was not recorded' }),
    };
  });
}

function originRefs(body, faceIndex, parent) {
  if (parent.transformed) return [{ operand: 0, index: faceIndex }];
  const refs = body.provenance?.faces?.[faceIndex]?.sources;
  if (refs?.length) return refs.map(ref => ({ operand: ref.leaf, index: ref.face }));
  const origin = body.construction?.faceOrigins?.[faceIndex];
  if (origin?.contributors) return list(origin.contributors);
  if (Number.isInteger(origin?.operand)) return [{ operand: origin.operand, index: origin.index ?? origin.face }];
  return null;
}

function provenance(body, faceIndex, seen = new Set()) {
  const key = `${body.id}\0${body.identity?.revision}\0${faceIndex}`;
  if (seen.has(key)) return [{ missing: 'cyclic face lineage', bodyId: body.id, faceIndex }];
  const next = new Set(seen).add(key), parent = parents.get(body);
  if (parent) {
    const refs = originRefs(body, faceIndex, parent);
    if (refs?.length) return unique(refs.flatMap(ref => {
      const operand = parent.operands[ref.operand];
      if (!operand?.faces[ref.index]) return [{ missing: 'operand face referenced by lineage is unavailable', bodyId: body.id, faceIndex, ref }];
      const origins = provenance(operand, ref.index, next);
      return parent.transformed ? origins.map(origin => ({ ...origin, transforms: [...(origin.transforms ?? []), { rows: parent.rows, offsetMm: parent.offset }] })) : origins;
    }));
    return [{ ...directSource(body, faceIndex)[0], missing: 'exact-arm output-face to input-face correspondence is unavailable', bodyId: body.id, faceIndex }];
  }
  return directSource(body, faceIndex);
}

export function carrierRecord(body, faceIndex) {
  const surface = body?.faces?.[faceIndex]?.surface;
  return { bodyId: body?.id ?? null, faceIndex, type: surface?.type ?? null,
    parameters: surface ? structuredClone(surface) : null,
    provenance: body ? provenance(body, faceIndex) : [{ missing: 'operand body is unavailable' }] };
}

export function reasonMeasurements(reason) {
  const value = pattern => { const match = String(reason).match(pattern); return match ? Number(match[1]) : null; };
  return { residualMm: value(/residual\s+([\d.eE+-]+)\s*mm/),
    gapMm: value(/(?:come within|gap)\s+([\d.eE+-]+)\s*mm/),
    determinant: value(/\|det\|\s+([\d.eE+-]+)/) };
}

// The reason's vertex indexes the ORIGINAL corefine mesh, not the compacted
// mesh on certifiedMeshBody. Resolve it here before that index space is lost.
export function hybridDiagnostic(result, operands) {
  const reason = result.reason, match = reason?.match(/mesh vertex (\d+)/), vertex = match ? Number(match[1]) : null;
  const pair = reason?.match(/carriers of tags (\d+) and (\d+)/);
  const tags = pair ? pair.slice(1).map(Number) : vertex !== null && result.mesh
    ? [...new Set(result.mesh.triangles.filter(t => t.slice(0, 3).includes(vertex)).map(t => t[3]))].sort((a, b) => a - b) : [];
  const carriers = tags.map(tag => {
    const row = result.job?.faces[tag];
    return { tag, carrierClass: result.classes?.[tag] ?? null, leaf: row?.leaf ?? null,
      ...carrierRecord(row ? operands[row.leaf] : null, row?.faceIndex ?? null) };
  });
  return { reason, ...reasonMeasurements(reason), meshVertex: vertex,
    meshVertexMm: vertex !== null ? result.mesh?.vertices[vertex] ?? null : null,
    carriers,
    ...(!tags.length ? { missing: 'reason contains neither carrier tags nor a mesh vertex in the available result' } : {}) };
}

export function noteFallback(body, result, operands) { fallbacks.set(body, hybridDiagnostic(result, operands)); }
export function fallbackRecord(body) {
  const records = [], seen = new Set();
  const visit = current => {
    if (seen.has(current)) return;
    seen.add(current);
    const diagnostic = fallbacks.get(current);
    if (diagnostic) records.push({ bodyId: current.id, ...diagnostic });
    for (const operand of parents.get(current)?.operands ?? []) visit(operand);
  };
  visit(body);
  if (!records.length) return null;
  return { schema: 'wonky-carrier-diagnostic/1', bodyId: body.id, part: body.name ?? null,
    units: 'millimeter', current: records[0], history: records.slice(1) };
}

export async function writeFallbackDiagnostics(directory, bodies) {
  const dir = join(directory, 'fallbacks');
  await rm(dir, { recursive: true, force: true });
  const used = new Set();
  for (const body of bodies) {
    const record = fallbackRecord(body);
    if (!record) continue;
    const base = safe(body.name?.trim().split(/\s+/)[0] || body.id);
    let key = base, serial = 1;
    while (used.has(key.toLowerCase())) key = `${base}-${serial++}`;
    used.add(key.toLowerCase());
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${key}.json`), JSON.stringify(record, null, 2) + '\n');
  }
}

// These object references are deliberately non-enumerable: error.json retains
// its existing small record and gains just the relative dump pointer.
export function noteRefusal(error, operands, result = null) {
  if (!error || typeof error !== 'object') return;
  if (!error.diagnosticOperands) Object.defineProperty(error, 'diagnosticOperands', { value: operands });
  if (result && !error.carrierDiagnostic) Object.defineProperty(error, 'carrierDiagnostic', { value: hybridDiagnostic(result, operands) });
}

export async function writeRefusalDump(directory, error, kernel, { deviationMm = 0.01, startedAt = performance.now() } = {}) {
  const context = error.diagnosticContext;
  if (!context && !error.diagnosticOperands) return null;
  const { printMesh } = await import('./print-mesh.mjs');
  const { packStl } = await import('./r20-export.mjs');
  const operation = context?.operation ?? { name: 'operation', operationId: null, sequence: 0 };
  const relative = `refused/${String(operation.sequence ?? 0).padStart(4, '0')}-${safe(operation.name)}`;
  const dir = join(directory, relative);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const stored = new Map();
  const saveBody = async (body, role) => {
    if (!stored.has(body)) {
      const stem = `${String(stored.size).padStart(3, '0')}-${safe(body.id)}`;
      const bounds = body.validation?.boundsMm;
      const row = { bodyId: body.id, name: body.name ?? null, geometry: body.geometry ?? 'planar',
        faceCounts: body.faces.reduce((counts, face) => { const type = face.surface.type; counts[type] = (counts[type] ?? 0) + 1; return counts; }, {}),
        bboxMm: bounds ? { min: bounds.min, max: bounds.max } : null,
        carriers: body.faces.map((_, i) => carrierRecord(body, i)), stl: null };
      stored.set(body, row);
      try {
        const mesh = printMesh(kernel, body, deviationMm);
        const packed = packStl(mesh.triangles, `diagnostic ${body.id}`, { collapseFloat32: !!mesh.source });
        row.stl = `${stem}.stl`;
        row.meshDeviationMm = mesh.achievedDeviationMm;
        if (!row.bboxMm) {
          const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
          for (const triangle of mesh.triangles) for (const point of triangle) for (let k = 0; k < 3; k++) {
            const v = Math.fround(point[k]); min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v);
          }
          row.bboxMm = { min, max };
          row.bboxBasis = 'diagnostic STL vertices (float32), not exact solid bounds';
        } else row.bboxBasis = 'body validation bounds';
        await writeFile(join(dir, row.stl), packed.buffer);
      } catch (failure) {
        row.stlRefusal = failure.message;
        process.stderr.write(`wonky: diagnostic STL ${body.id} refused: ${failure.message}\n`);
      }
      await writeFile(join(dir, `${stem}.json`), JSON.stringify(row, null, 2) + '\n');
    }
    const { carriers, ...summary } = stored.get(body);
    return { ...summary, role, metadata: `${String([...stored.keys()].indexOf(body)).padStart(3, '0')}-${safe(body.id)}.json` };
  };
  const inputs = [];
  const inputBodies = [...new Set([...(error.diagnosticOperands ?? []), ...(context?.inputs ?? [])])];
  for (const [i, body] of inputBodies.entries())
    inputs.push(await saveBody(body, context?.roles?.get(body) ?? `operand-${i}`));
  const studio = [];
  for (const body of context?.bodies ?? []) studio.push(await saveBody(body, 'studio'));
  const record = { schema: 'wonky-refusal-dump/1', units: 'millimeter', operation,
    refusal: { class: error.name, message: error.message, file: context?.file ?? null, line: error.line ?? null, column: error.column ?? null,
      ...(error.carrierDiagnostic ?? reasonMeasurements(error.message)) },
    inputs, studio,
    resources: { module: operation.feature?.name ?? null, wallTimeMs: performance.now() - startedAt, maxRSSKiB: process.resourceUsage().maxRSS,
      scope: 'failed CLI module through refusal diagnostics; process high-water mark in KiB' },
    ...(context?.inputResolutionError ? { inputResolutionError: context.inputResolutionError } : {}) };
  await writeFile(join(dir, 'refusal.json'), JSON.stringify(record, null, 2) + '\n');
  return `${relative}/refusal.json`;
}
