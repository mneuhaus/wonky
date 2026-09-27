import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { geometryRevision, topologyReference } from './identity.mjs';
import { inputIdentity } from './construction-history.mjs';

const summarySchema = 'wonky-geometry-summary/1';
const identitySchema = 'wonky-topology-identity/1';
const groups = { face: 'faces', edge: 'edges', vertex: 'vertices' };
const letters = { face: 'F', edge: 'E', vertex: 'V' };
const hash = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const own = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, copy(value[key])]));
const aliasFor = (bodyIndex, kind = 'body', index = 0) => `B${bodyIndex + 1}${kind === 'body' ? '' : `.${letters[kind]}${index + 1}`}`;
const entityIdentity = (body, kind, index) => kind === 'body' ? body.identity : body.identity?.topology?.[groups[kind]]?.[index];
const shortIdentity = identity => identity ? { role: identity.role, stability: identity.stability, matching: identity.lineage?.matching ?? null } : null;
const bodySource = body => body.identity?.operation?.source ?? body.debug?.source ?? null;
const sourcePoint = source => source ? { file: source.file ?? null, sha256: source.sha256 ?? null, span: copy(source.span ?? null) } : null;
const curveType = edge => typeof edge.curve === 'string' ? edge.curve : edge.curve?.type ?? 'unknown';
const counts = (values, key) => values.reduce((result, value) => { const name = key(value); result[name] = (result[name] ?? 0) + 1; return result; }, {});
const snapshots = new WeakMap();

const scope = {
  purpose: 'Lossy semantic overview for navigation and feedback; selected details resolve against the original B-rep snapshot.',
  aliases: 'Aliases are local to this exact modelId. They are not persistent topology IDs.',
  measurements: 'Only recorded measurements are copied; null means unknown. Bounds are envelopes, not occupancy or voxels.',
  omitted: ['complete curve/surface frames', 'ordered coedge winding and trims', 'vertex coordinates', 'full identity keys and ancestry', 'full source/parameter evidence'],
  notComputed: ['voxel occupancy', 'distances', 'interference', 'new mass properties', 'tessellation', 'geometric equivalence'],
};

function checkMesh(body) {
  const mesh = body.mesh, vertices = mesh?.vertices, triangles = mesh?.triangles;
  if (body.vertices.length || body.edges.length || !Array.isArray(vertices) || !Array.isArray(triangles) || !triangles.length) throw new Error(`Certified-mesh body '${body.id}' needs its mesh and no B-rep vertices or edges`);
  if (vertices.some(vertex => !Array.isArray(vertex) || vertex.length !== 3 || !vertex.every(Number.isFinite))) throw new Error('Mesh vertex coordinates must be finite triples');
  if (body.faces.some(face => !face.surface)) throw new Error('Mesh face is missing its carrier surface');
  if (triangles.some(triangle => !Array.isArray(triangle) || triangle.length !== 4 ||
    triangle.slice(0, 3).some(index => !Number.isInteger(index) || index < 0 || index >= vertices.length) ||
    !Number.isInteger(triangle[3]) || triangle[3] < 0 || triangle[3] >= body.faces.length)) throw new Error('Mesh triangle references an unknown vertex or face');
}

function checkModel(model) {
  if (model?.schema !== 'wonky-brep/1' || !Array.isArray(model.bodies) || !model.bodies.length) throw new Error('Expected a nonempty wonky-brep/1 model');
  if (new Set(model.bodies.map(body => body.id)).size !== model.bodies.length) throw new Error('Duplicate body IDs cannot produce unambiguous viewer targets');
  model.bodies.forEach(body => {
    if (typeof body.id !== 'string' || !body.id || !Object.values(groups).every(group => Array.isArray(body[group]))) throw new Error('Body is missing its ID or topology arrays');
    if (body.vertices.some(vertex => !Array.isArray(vertex) || vertex.length !== 3 || !vertex.every(Number.isFinite))) throw new Error('Vertex coordinates must be finite triples');
    if (body.edges.some(edge => ![edge.start, edge.end].every(index => Number.isInteger(index) && index >= 0 && index < body.vertices.length))) throw new Error('Edge references an unknown vertex');
    // A certified-mesh body (src/hybrid-mesh.mjs) has faces (carrier + triangle
    // region) but no B-rep edges, vertices or loops: its mesh is the geometry.
    if (body.geometry === 'mesh') checkMesh(body);
    else for (const face of body.faces) {
      if (!face.surface || !Array.isArray(face.loops) || face.loops.some(loop => !Array.isArray(loop) || loop.some(use =>
        !Number.isInteger(use.edge) || use.edge < 0 || use.edge >= body.edges.length || typeof use.forward !== 'boolean'))) throw new Error('Face references invalid coedges');
    }
    if (body.identity) {
      if (body.identity.schema !== identitySchema) throw new Error('Unsupported topology identity schema');
      const revision = geometryRevision(body);
      if (body.identity.revision !== revision) throw new Error(`Stale geometry revision in identity metadata for '${body.id}'`);
      const identities = [body.identity];
      for (const [kind, group] of Object.entries(groups)) {
        const entries = body.identity.topology?.[group];
        if (!Array.isArray(entries) || entries.length !== body[group].length) throw new Error(`Identity ${group} do not match the B-rep`);
        if (entries.some(entry => entry.kind !== kind || entry.revision !== revision || typeof entry.originId !== 'string' || typeof entry.instanceId !== 'string')) {
          throw new Error(`Invalid or stale ${kind} identity metadata`);
        }
        identities.push(...entries);
      }
      if (body.identity.kind !== 'body' || identities.some(entry => typeof entry.originId !== 'string' || !entry.originId ||
        typeof entry.instanceId !== 'string' || !entry.instanceId || !['semantic', 'source', 'revision-local'].includes(entry.stability))) throw new Error('Invalid authoritative identity metadata');
      if (new Set(identities.map(entry => entry.instanceId)).size !== identities.length) throw new Error('Duplicate authoritative topology identities');
    }
  });
}

function surfaceSummary(surface) {
  if (surface.type === 'plane') return own(surface, ['type', 'origin', 'normal']);
  if (surface.type === 'cylinder') return own(surface, ['type', 'origin', 'axis', 'radius']);
  if (surface.type === 'cone') return own(surface, ['type', 'origin', 'axis', 'radius', 'angle']);
  return { type: surface.type ?? 'unknown', description: 'Parameters available in the entity detail; no semantic interpretation supplied' };
}

function makeSummary(model, modelId, revisionBasis) {
  return {
    schema: summarySchema, modelId, revisionBasis, detailLevel: 'faces', units: model.units ?? null,
    source: own(model.source, ['language', 'feature', 'filename', 'api']),
    scope: copy(scope),
    counts: { bodies: model.bodies.length, ...Object.fromEntries(Object.values(groups).map(group => [group, model.bodies.reduce((n, body) => n + body[group].length, 0)])) },
    bodies: model.bodies.map((body, bodyIndex) => ({
      alias: aliasFor(bodyIndex), id: body.id, name: body.name ?? null,
      representation: body.geometry ?? 'planar', precision: body.precision ?? model.backend?.precision ?? null,
      identity: shortIdentity(body.identity),
      operation: body.identity?.operation ? { ...own(body.identity.operation, ['id', 'type', 'parentOperations']), source: sourcePoint(bodySource(body)) } : null,
      validation: own(body.validation, ['closed', 'scope', 'toleranceMm']),
      volumeMm3: body.validation?.volumeMm3 ?? null,
      boundsMm: copy(body.validation?.boundsMm ?? null),
      aliases: Object.fromEntries(Object.entries(groups).map(([kind, group]) => [group, {
        count: body[group].length, first: body[group].length ? aliasFor(bodyIndex, kind, 0) : null,
        last: body[group].length ? aliasFor(bodyIndex, kind, body[group].length - 1) : null,
      }])),
      edgeTypes: counts(body.edges, curveType),
      faces: body.faces.map((face, index) => ({
        alias: aliasFor(bodyIndex, 'face', index), identity: shortIdentity(entityIdentity(body, 'face', index)),
        surface: surfaceSummary(face.surface), sameSense: face.sameSense ?? null, loops: face.loops?.length ?? 0,
        edges: [...new Set((face.loops ?? []).flatMap(loop => loop.map(use => aliasFor(bodyIndex, 'edge', use.edge))))],
      })),
    })),
  };
}

function sourceReferences(body, kind, index) {
  if (kind !== 'face' || !body.referenceMeasurements) return null;
  const r = body.referenceMeasurements;
  return { source: r.source ?? null, areaMm2: r.faceAreasMm2?.[index] ?? null,
    perimeterMm: r.facePerimetersMm?.[index] ?? null, toleranceMm: r.faceTolerancesMm?.[index] ?? null };
}

function constructionOrigin(model, body, kind, index) {
  const construction = body.construction;
  const origin = kind === 'face' ? construction?.faceOrigins?.[index]
    : kind === 'edge' ? construction?.edgeOrigins?.[index] : null;
  if (!origin) return null;
  const history = body.operationHistory?.find(entry => entry.evidence?.frame?.id === construction.frameId);
  const nativeList = value => {
    const values = [];
    while (value?.$ === 'Con') { values.push(value.head); value = value.tail; }
    return value?.$ === 'Nil' ? values : null;
  };
  let refs = null;
  if (kind === 'face') {
    const faces = origin.contributors ? nativeList(origin.contributors) : [origin];
    if (faces) refs = faces.map(ref => ({ kind: 'face', ref }));
  } else if (origin.$ === 'OriginalEdge') refs = [{ kind: 'edge', ref: origin }];
  else if (origin.$ === 'FaceIntersection') refs = [origin.first, origin.second].map(ref => ({ kind: 'face', ref }));
  else if (origin.$ === 'SurfaceSeam') refs = [{ kind: 'face', ref: origin.face }];
  else if (origin.$ === 'FaceSubdivision') refs = nativeList(origin.faces)?.map(ref => ({ kind: 'face', ref })) ?? null;
  const references = refs?.map(({ kind: entityKind, ref }) => {
    const input = history?.evidence?.inputs?.find(input => input.operand === ref?.operand);
    const group = groups[entityKind];
    const valid = Number.isInteger(ref?.operand) && Number.isInteger(ref?.index) && ref.index >= 0 &&
      input && ref.index < input.topologyCounts?.[group];
    const recorded = valid ? inputIdentity(model, input) : null;
    const identity = recorded && recorded.revision === input.revision ? recorded.topology?.[group]?.[ref.index] : null;
    return { operand: ref?.operand ?? null, kind: entityKind, index: ref?.index ?? null,
      ...(entityKind === 'face' && construction.operation === 'SUBTRACTION' ? { reversed: ref?.operand === 1 } : {}),
      status: valid ? 'recorded-input-reference' : 'unresolved-input-reference',
      bodyId: valid ? input.bodyId : null, geometryRevision: valid ? input.revision : null,
      identity: identity ?? null, operation: recorded?.operation ?? null };
  }) ?? null;
  return { method: construction.method, origin,
    frame: history?.evidence?.frame ?? (construction.frameId ? { id: construction.frameId } : null),
    transformChain: history?.transformChain ?? null, references,
    scope: 'Native construction ancestry in the recorded input frame. All coplanar contributors are retained; an owner does not establish unique ancestry. No cross-revision correspondence or recursive split/merge matching is inferred.' };
}

/** An immutable geometry snapshot with revision-bound, nonpersistent aliases. */
export function createGeometryInspector(model, { modelBytes, modelId } = {}) {
  const serialized = JSON.stringify(model);
  if (serialized === undefined) throw new Error('A B-rep model is required');
  const snapshot = JSON.parse(serialized);
  const raw = modelBytes === undefined ? Buffer.from(serialized) : Buffer.from(modelBytes);
  if (JSON.stringify(JSON.parse(raw.toString('utf8'))) !== serialized) throw new Error('Model bytes and the supplied model object differ');
  const actualId = hash(raw);
  if (modelId !== undefined && modelId !== actualId) throw new Error('Supplied modelId does not match the exact model snapshot bytes');
  checkModel(snapshot);
  const revisionBasis = modelBytes === undefined ? 'sha256 of compact JSON.stringify(model)' : 'sha256 of supplied exact model bytes';
  const summary = makeSummary(snapshot, actualId, revisionBasis), aliases = new Map();
  const bodyRevisions = snapshot.bodies.map(geometryRevision);
  snapshot.bodies.forEach((body, bodyIndex) => {
    aliases.set(aliasFor(bodyIndex), { bodyIndex, kind: 'body', index: 0 });
    for (const [kind, group] of Object.entries(groups)) body[group].forEach((_, index) => aliases.set(aliasFor(bodyIndex, kind, index), { bodyIndex, kind, index }));
  });
  const locate = reference => {
    if (!reference || reference.modelId !== actualId) throw new Error('Alias lookup requires the matching immutable modelId');
    if (typeof reference.alias !== 'string' || !aliases.has(reference.alias)) throw new Error(`Unknown geometry alias '${reference?.alias}'`);
    return aliases.get(reference.alias);
  };
  const resolve = reference => {
    const { bodyIndex, kind, index } = locate(reference), body = snapshot.bodies[bodyIndex];
    return {
      modelId: actualId, alias: reference.alias, bodyId: body.id, entityType: kind, entityIndex: index,
      geometryRevision: bodyRevisions[bodyIndex],
      identity: body.identity ? topologyReference(body, kind, index) : null,
      referencePolicy: 'Exact model snapshot only. Alias positions are not persistent identity.',
    };
  };
  const detail = reference => {
    const { bodyIndex, kind, index } = locate(reference), body = snapshot.bodies[bodyIndex];
    const identity = entityIdentity(body, kind, index);
    const geometry = kind === 'body'
      ? own(body, ['geometry', 'precision', 'vertices', 'edges', 'faces', 'shell', 'primitive', 'construction'])
      : kind === 'vertex' ? { point: copy(body.vertices[index]) } : copy(body[groups[kind]][index]);
    let relations;
    if (kind === 'body') {
      relations = Object.fromEntries(Object.entries(groups).map(([entityKind, group]) => [group, body[group].map((_, i) => aliasFor(bodyIndex, entityKind, i))]));
    } else if (kind === 'face') {
      const face = body.faces[index];
      relations = { loops: (face.loops ?? []).map((loop, i) => ({ outer: face.outer?.[i] ?? (body.geometry === 'analytic' ? null : i === 0),
        uses: loop.map(use => ({ edge: aliasFor(bodyIndex, 'edge', use.edge), forward: use.forward })) })) };
    } else if (kind === 'edge') {
      const edge = body.edges[index];
      relations = { start: aliasFor(bodyIndex, 'vertex', edge.start), end: aliasFor(bodyIndex, 'vertex', edge.end),
        uses: body.faces.flatMap((face, f) => face.loops.flatMap((loop, l) => loop.flatMap((use, u) => use.edge === index
          ? [{ face: aliasFor(bodyIndex, 'face', f), loop: l, coedge: u, forward: use.forward }] : []))) };
    } else {
      const edges = body.edges.flatMap((edge, i) => edge.start === index || edge.end === index ? [i] : []);
      relations = { edges: edges.map(i => aliasFor(bodyIndex, 'edge', i)),
        faces: body.faces.flatMap((face, f) => face.loops.some(loop => loop.some(use => edges.includes(use.edge))) ? [aliasFor(bodyIndex, 'face', f)] : []) };
    }
    const ownIdentity = identity ? Object.fromEntries(Object.entries(identity).filter(([key]) => key !== 'topology')) : null;
    return copy({ schema: 'wonky-geometry-detail/1', reference: resolve(reference),
      units: snapshot.units ?? null, bodyName: body.name ?? null,
      identity: ownIdentity, operation: body.identity?.operation ?? null, source: bodySource(body), debug: body.debug ?? null,
      geometry, relations, bodyValidation: body.validation ?? null, sourceReferenceMeasurements: sourceReferences(body, kind, index),
      constructionOrigin: constructionOrigin(snapshot, body, kind, index),
      scope: 'Original selected B-rep data and recorded evidence. Adjacency comes from topology references; no new geometry or mass properties are computed.' });
  };
  const inspector = Object.freeze({
    modelId: actualId,
    summary: ({ includeFaces = true } = {}) => {
      if (typeof includeFaces !== 'boolean') throw new Error('includeFaces must be boolean');
      const overview = copy(summary);
      if (!includeFaces) {
        overview.detailLevel = 'bodies';
        overview.scope.omitted.push('face surface descriptors and incident edge lists');
        for (const body of overview.bodies) delete body.faces;
      }
      return overview;
    },
    resolve,
    detail,
    lookup: () => Object.fromEntries([...aliases.keys()].map(alias => [alias, resolve({ modelId: actualId, alias })])),
  });
  snapshots.set(inspector, { raw: raw.toString('utf8'), compact: serialized, snapshot });
  return inspector;
}

const valueText = value => value === null || value === undefined ? 'unknown' : typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value);
const sourceText = source => !source ? 'unknown' : `${source.file ?? '<unknown file>'}${source.span?.line ? `:${source.span.line}${source.span.column ? `:${source.span.column}` : ''}` : ''}`;
const rangeText = range => !range.count ? 'none' : range.first === range.last ? range.first : `${range.first}..${range.last}`;

export function formatGeometrySummary(summary) {
  if (summary?.schema !== summarySchema) throw new Error('Expected a geometry summary');
  const lines = [`Model ${summary.modelId}`, `Units: ${summary.units ?? 'unknown'}; ${summary.counts.bodies} bodies, ${summary.counts.faces} faces, ${summary.counts.edges} edges, ${summary.counts.vertices} vertices.`,
    'Aliases require this modelId. Overview omits exact trims, winding, vertices and full provenance; use detail for authoritative data.',
    'Recorded bounds are envelopes, not voxels/occupancy. No distance, interference or new mass properties are evaluated.'];
  if (summary.detailLevel === 'bodies') lines.push('Face descriptors omitted in this body overview; use an entity alias for exact detail.');
  for (const body of summary.bodies) {
    lines.push('', `${body.alias} ${JSON.stringify(body.name ?? body.id)} (${body.representation}; ${body.precision ?? 'unknown precision'}; identity ${body.identity?.stability ?? 'unavailable'})`,
      `  volume=${valueText(body.volumeMm3)} mm³; bounds=${valueText(body.boundsMm)} mm; closed=${valueText(body.validation.closed)}`,
      `  topology: faces ${rangeText(body.aliases.faces)}; edges ${rangeText(body.aliases.edges)} ${JSON.stringify(body.edgeTypes)}; vertices ${rangeText(body.aliases.vertices)}`);
    if (body.operation) lines.push(`  operation=${JSON.stringify(body.operation.id)} type=${JSON.stringify(body.operation.type)} source=${sourceText(body.operation.source)}`);
    if (body.validation.scope) lines.push(`  validation scope: ${body.validation.scope}`);
    for (const face of body.faces ?? []) {
      lines.push(`  ${face.alias} ${face.surface.type}; role=${valueText(face.identity?.role)}; ${face.identity?.stability ?? 'identity unavailable'}; surface=${JSON.stringify(face.surface)}; sameSense=${valueText(face.sameSense)}; loops=${face.loops}; edges=${face.edges.join(',')}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function formatGeometryDetail(detail) {
  if (detail?.schema !== 'wonky-geometry-detail/1') throw new Error('Expected a geometry detail');
  return `${detail.reference.alias} in model ${detail.reference.modelId}\n${detail.scope}\n${JSON.stringify(detail, null, 2)}\n`;
}

const tokenizerScript = `
import hashlib, importlib.metadata, json, platform, sys
import tiktoken
import tiktoken.load
def no_network(path):
    raise RuntimeError("Tokenizer assets are not cached locally; cache the requested encoding before measuring")
tiktoken.load.read_file = no_network
request = json.load(sys.stdin)
encoding = tiktoken.get_encoding(request["encoding"])
counts = {}
for name, text in request["payloads"].items():
    data = text.encode("utf-8")
    counts[name] = {"tokens": len(encoding.encode(text, disallowed_special=())), "characters": len(text), "utf8Bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
print(json.dumps({"tokenizer": {"library": "tiktoken", "version": importlib.metadata.version("tiktoken"), "encoding": encoding.name, "pythonVersion": platform.python_version(), "assets": "local cache; network disabled"}, "counts": counts}))
`;

/** Optional local accounting, never needed to inspect or construct geometry. */
export async function measureGeometrySummaryTokens(inspector, { python = 'python3', encoding = 'o200k_base', cacheDirectory, timeoutMs = 30000 } = {}) {
  const state = snapshots.get(inspector);
  if (!state) throw new Error('Token measurement requires a geometry inspector from this module');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Tokenizer timeoutMs must be a positive integer');
  const summary = inspector.summary();
  const geometryOnly = { schema: state.snapshot.schema, units: state.snapshot.units,
    bodies: state.snapshot.bodies.map(body => own(body, ['id', 'geometry', 'precision', 'vertices', 'edges', 'faces', 'shell'])) };
  const payloads = {
    rawBrep: state.raw,
    compactBrep: state.compact,
    compactGeometryOnly: JSON.stringify(geometryOnly),
    summaryJson: JSON.stringify(summary),
    summaryText: formatGeometrySummary(summary),
    bodyOverviewJson: JSON.stringify(inspector.summary({ includeFaces: false })),
    bodyOverviewText: formatGeometrySummary(inspector.summary({ includeFaces: false })),
    aliasLookupJson: JSON.stringify(inspector.lookup()),
  };
  const measured = await new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-c', tokenizerScript], { stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(cacheDirectory ? { TIKTOKEN_CACHE_DIR: cacheDirectory } : {}) } });
    let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = new Error(`Tokenizer exceeded ${timeoutMs} ms`); child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { failure = new Error(`Cannot start local tokenizer '${python}': ${error.message}`); });
    child.stdin.on('error', error => { failure ??= error; });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure || code !== 0) { reject(failure ?? new Error(`Local tokenizer failed: ${stderr.trim()}`)); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Local tokenizer returned invalid accounting data')); }
    });
    child.stdin.end(JSON.stringify({ encoding, payloads }));
  });
  return {
    schema: 'wonky-geometry-token-accounting/1', modelId: inspector.modelId, ...measured,
    payloadScopes: {
      rawBrep: 'Exact supplied B-rep JSON bytes (or compact serialization when no bytes were supplied), including any identity/debug/source metadata.',
      compactBrep: 'Same complete B-rep payload with JSON whitespace removed.',
      compactGeometryOnly: 'Only model schema/units plus body ID, geometry/precision, vertices, edges, faces and shell; identity, source, validation and display metadata excluded.',
      summaryJson: 'Lossy semantic overview; exact geometry, full identity keys and lineage require lookup/detail.',
      summaryText: 'Readable rendering of the lossy semantic overview.',
      bodyOverviewJson: 'Further-reduced body overview with alias ranges and recorded body measurements; face descriptors omitted.',
      bodyOverviewText: 'Readable body overview; face/edge/vertex details require additional queries.',
      aliasLookupJson: 'All revision-bound alias targets with available authoritative identity references; optional external lookup payload, not included in summary counts.',
    },
    limitations: ['Text tokens for the named encoding only; message framing and a particular LLM request are not measured.',
      'Summary and raw B-rep have different information scopes. Lower counts do not establish equal quality, preserved geometry or task-level savings.',
      'Detail responses and repeated queries add tokens and are not included in overview counts.'],
  };
}
