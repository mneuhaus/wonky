import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fail, unsupported } from './errors.mjs';
import { importOnshapeBody, transformAnalytic } from './analytic.mjs';
import { EnumValue, Id, isMap, Matrix, Transform, vectorNumbers } from './values.mjs';
import { TopologyQuery, resolveTopology } from './queries.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const builtin = (name, min, max, call) => ({ type: 'builtin', name, min, max, call });
const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const SCHEMAS = new Set(['wonky-onshape-inputs/1', 'wonky-onshape-inputs/2']);
const ONSHAPE_ID = /^[0-9a-f]{24}$/;
// A B-rep snapshot does not say which source feature created a part, so
// qCreatedBy over an imported source context has no honest answer: refuse it
// instead of finding nothing.
const UNRECORDED_CREATORS = Object.freeze({
  has() { unsupported('qCreatedBy over an imported source context is not implemented: frozen Onshape inputs do not record which source feature created each part'); },
  add() { fail('An imported source context is read-only'); },
  [Symbol.iterator]() { return this.has(); },
});

// A composite part in a captured part list (docs/onshape-inputs.md, decision
// 11 of docs/entscheidungen.md). The module still loads; only using the
// composite raises, by name:
// - its geometry (addInstance selecting it, instantiate, any body access);
// - its kind, which every query over the whole source context reads
//   (qAllModifiableSolidBodies, qBodyType(qEverything(...), ...)). In Onshape
//   those queries return the bodies a closed composite consumes (std
//   query.fs qConsumed), which the part list does not show and the capture
//   does not hold; whether a composite is closed is not recorded either. So
//   the answer would be invented, and the query is refused instead.
// The getters carry the location of the call that built the source context (a
// getter does not see the query that reads it). Consumers that resolve queries
// themselves (src/lang/dataflow/fs-trace.mjs) check isCompositeRecord and call
// refuseComposite with the location of their own query or instance.
function compositeRecord(key, namespace, part, loc) {
  const composite = { namespace, name: part.name, partId: part.partId };
  return Object.defineProperties({ key, name: part.name, appearance: part.appearance, createdBy: UNRECORDED_CREATORS, sourcePartId: part.partId, composite }, {
    kind: { enumerable: true, get() { refuseComposite(this, loc, { wholeContext: true }); } },
    body: { enumerable: true, get() { refuseComposite(this, loc); } },
  });
}

/** True for the source-context record of a composite part (decision 11). */
export const isCompositeRecord = record => !!record?.composite;

/**
 * Raise the named capability error for a composite part record: `wholeContext`
 * for a query over the whole source context (whose Onshape answer would
 * include consumed bodies), otherwise for using the part itself.
 */
export function refuseComposite(record, loc, { wholeContext = false } = {}) {
  const { namespace, name, partId } = record.composite;
  if (wholeContext) unsupported(`A query over the whole source context of imported module '${namespace}' meets its composite part '${name}' (${partId}): composite parts are not implemented, and Onshape's answer would include the bodies a closed composite consumes, which the captured part list does not hold`, loc);
  unsupported(`Using the composite part '${name}' (${partId}) of imported module '${namespace}' is not implemented: composite parts are not implemented`, loc);
}

// An Onshape import path is either an element of the importing document
// (`<element>`) or a full `<document>/<version>/<element>` triple. Anything
// else (a Feature Studio source, an fsocct `version: "local"` path) is not a
// Part Studio revision this loader can bind.
export function parseImportPath(path) {
  if (typeof path !== 'string') return null;
  if (ONSHAPE_ID.test(path)) return { document: null, documentVersion: null, element: path };
  const parts = path.split('/');
  if (parts.length === 3 && parts.every(p => ONSHAPE_ID.test(p))) return { document: parts[0], documentVersion: parts[1], element: parts[2] };
  return null;
}

// Module entries of either schema, normalized. Schema 1 (fixtures/r10b) keeps
// its layout: one host `document`, files under `modules/<namespace>/`.
// Schema 2 names each entry's document (and version for other-document
// imports) and lists its files relative to an optional `store` root.
function entriesOf(manifest) {
  return manifest.modules.map(entry => ({
    entry,
    document: entry.document ?? manifest.hostDocument ?? manifest.document ?? null,
    documentVersion: entry.documentVersion ?? null,
    // Schema 2 only: the document microversion the captured bytes name, when
    // the import version is the element's own microversion (pinned at capture).
    pinned: manifest.schema === 'wonky-onshape-inputs/2' && entry.documentMicroversion ? entry.documentMicroversion : entry.microversion,
    parts: manifest.schema === 'wonky-onshape-inputs/1'
      ? { file: `modules/${entry.namespace}/parts.json`, sha256: entry.partsSha256 }
      : entry.parts,
  }));
}

function readManifest(manifestPath, manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))) {
  if (!SCHEMAS.has(manifest?.schema)) fail('Unsupported frozen module manifest schema');
  if (!Array.isArray(manifest.modules)) fail('Frozen module manifest has no module list');
  const manifestRoot = dirname(resolve(manifestPath));
  const root = manifest.schema === 'wonky-onshape-inputs/2' && manifest.store ? resolve(manifestRoot, manifest.store) : manifestRoot;
  return { manifest, root, entries: entriesOf(manifest) };
}

// Every file a manifest makes the loader read (for watchers and packaging).
// Pass the parsed `manifest` when the caller already holds its bytes (the
// viewer's watcher does); otherwise it is read from disk.
export function manifestInputFiles(manifestPath, manifest) {
  const { root, entries } = readManifest(manifestPath, manifest);
  const files = entries.flatMap(({ entry, parts }) => [parts?.file, ...(entry.bodies ?? []).map(b => b.file)]).filter(f => typeof f === 'string');
  return [...new Set(files.map(f => resolve(root, f)))];
}

// A snapshot is bound to immutable Onshape revisions (element@microversion,
// plus the document and its version for other-document imports). Any import
// of a captured revision resolves, whatever its namespace name and whichever
// source file imports it. The optional `sourceSha256` is provenance only: a
// mismatch is recorded on the resolver and on each imported body, never
// refused. Part lists and bodies stay SHA-256-checked. Loading never makes
// network requests.
export function frozenModules(manifestPath, source, createContext) {
  const { manifest, root, entries } = readManifest(manifestPath);
  const sourceSha256 = hash(source);
  const sourceBinding = !manifest.sourceSha256 ? 'absent' : manifest.sourceSha256 === sourceSha256 ? 'match' : 'mismatch';
  const verified = (file, expected) => {
    if (typeof file !== 'string' || typeof expected !== 'string') fail('Frozen module file entry needs a path and a SHA-256');
    const path = resolve(root, file);
    if (!path.startsWith(root + sep)) fail('Frozen module file is outside its manifest directory');
    const data = readFileSync(path);
    if (hash(data) !== expected) fail(`Frozen module checksum mismatch: ${file}`);
    return JSON.parse(data);
  };
  const resolver = spec => {
    const target = parseImportPath(spec.path);
    if (!target) return undefined;
    const sameRevision = ({ entry, document, documentVersion }) => entry.element === target.element && entry.microversion === spec.version
      && (target.document ? document === target.document && documentVersion === target.documentVersion : !documentVersion);
    const found = entries.find(sameRevision);
    if (!found) {
      const other = entries.find(({ entry }) => entry.element === target.element);
      if (other) fail(`Frozen module revision mismatch: ${spec.namespace} imports ${spec.path} at ${spec.version}; the manifest holds ${other.entry.element} at ${other.entry.microversion}${other.documentVersion ? ` (document version ${other.documentVersion})` : ''}`);
      return undefined;
    }
    const { entry, document, documentVersion, pinned, parts: partsFile } = found;
    let context;
    const build = builtin(`${spec.namespace}::build`, 1, 1, ([configuration], loc) => {
      if (!isMap(configuration) || Object.keys(configuration).length) unsupported('Frozen source-body imports support only their captured default configuration', loc);
      if (context) return context;
      const engine = createContext(); engine.readOnly = true;
      const parts = verified(partsFile?.file, partsFile?.sha256);
      if (!Array.isArray(parts)) fail('Frozen module part list is not an array', loc);
      for (const part of parts) {
        if (part.bodyType !== 'solid' && part.bodyType !== 'composite') unsupported(`Imported module '${spec.namespace}' contains unsupported body type '${part.bodyType}'`, loc);
        if (part.microversionId !== pinned || part.elementId !== entry.element) fail('Part-list revision mismatch', loc);
        if (part.bodyType === 'composite') {
          const key = String(engine.nextRecord++);
          engine.records.set(key, compositeRecord(key, spec.namespace, part, loc));
          continue;
        }
        const record = { key: String(engine.nextRecord++), kind: 'solid', name: part.name, appearance: part.appearance, createdBy: UNRECORDED_CREATORS, sourcePartId: part.partId };
        let body;
        Object.defineProperty(record, 'body', { get() {
          if (!body) {
            const captured = entry.bodies.find(b => b.partId === part.partId);
            if (!captured) unsupported(`Body '${part.name}' was not captured in this input snapshot`, loc);
            const raw = verified(captured.file, captured.sha256);
            if (raw.documentMicroversion !== pinned || raw.bodies.length !== 1 || raw.bodies[0].id !== part.partId) fail('Body snapshot revision/identity mismatch', loc);
            // Schema-1 provenance stays byte-identical when the source binding
            // holds; everything else says how the input was bound.
            const provenance = { document, element: entry.element, microversion: entry.microversion, partId: part.partId, sha256: captured.sha256 };
            if (documentVersion) provenance.documentVersion = documentVersion;
            if (pinned !== entry.microversion) provenance.documentMicroversion = pinned;
            if (sourceBinding !== 'match') provenance.sourceBinding = sourceBinding;
            body = importOnshapeBody(engine.kernel, raw.bodies[0], `${spec.namespace}/${part.partId}`, provenance);
            body.name = part.name; body.appearance = part.appearance;
          }
          return body;
        } });
        engine.records.set(record.key, record);
      }
      context = engine.context; context.moduleBuild = build;
      return context;
    });
    return { build };
  };
  resolver.binding = { manifest: resolve(manifestPath), schema: manifest.schema, sourceSha256, manifestSourceSha256: manifest.sourceSha256 ?? null, sourceBinding };
  return resolver;
}

class Instantiator {
  constructor(id) { this.id = id; this.instances = []; this.done = false; }
}

const ADD_INSTANCE_FIELDS = ['name', 'partQuery', 'loadedContext', 'transform', 'configuration'];

// Rotation rows and translation (mm) of a rigid FeatureScript Transform.
// Scale, shear and reflection are refused by name.
function rigidTransform(transform, loc) {
  if (!(transform instanceof Transform) || !(transform.linear instanceof Matrix)) fail('addInstance transform must be a Transform', loc);
  const rows = transform.linear.rows;
  if (rows.length !== 3 || rows.some(row => row.length !== 3 || row.some(v => typeof v !== 'number' || !Number.isFinite(v)))) fail('addInstance transform must have a numeric 3×3 linear part', loc);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const det = rows[0][0] * (rows[1][1] * rows[2][2] - rows[1][2] * rows[2][1]) - rows[0][1] * (rows[1][0] * rows[2][2] - rows[1][2] * rows[2][0]) + rows[0][2] * (rows[1][0] * rows[2][1] - rows[1][1] * rows[2][0]);
  const orthonormal = rows.every((row, j) => Math.abs(Math.sqrt(dot(row, row)) - 1) < 1e-9 && rows.every((other, k) => j === k || Math.abs(dot(row, other)) < 1e-9));
  if (!orthonormal) unsupported('addInstance transform with scale or shear is not implemented; only rigid transforms are', loc);
  if (Math.abs(det - 1) > 1e-9) unsupported('addInstance transform with a reflection is not implemented; only proper rigid transforms are', loc);
  return { rows: rows.map(row => [...row]), offset: vectorNumbers(transform.translation, 1, 3, loc) };
}

export function instantiatorBuiltins(engine) {
  return {
    newInstantiator: builtin('newInstantiator', 1, 1, ([id], loc) => {
      if (!(id instanceof Id)) fail('newInstantiator expects an Id', loc);
      return new Instantiator(id);
    }),
    addInstance: builtin('addInstance', 3, 3, ([instantiator, build, definition], loc) => {
      if (!(instantiator instanceof Instantiator) || instantiator.done || !isMap(definition)) fail('Invalid instantiator', loc);
      for (const key of Object.keys(definition)) if (!ADD_INSTANCE_FIELDS.includes(key)) unsupported(`addInstance field '${key}' is not implemented`, loc);
      const { name, partQuery, configuration, transform } = definition;
      if (typeof name !== 'string' || !name || name.includes('/') || instantiator.instances.some(i => i.name === name)) fail('Instance names must be nonempty and unique', loc);
      if (configuration !== undefined && (!isMap(configuration) || Object.keys(configuration).length)) unsupported('addInstance configuration is not implemented; frozen imports hold only their captured default configuration', loc);
      if (build?.type !== 'builtin' || !build.name?.endsWith('::build')) fail('addInstance expects a frozen module build function', loc);
      // Onshape builds the source context itself when none is given: the
      // module's default configuration, memoized by its build function.
      const loadedContext = definition.loadedContext ?? build.call([Object.create(null)], loc);
      if (!loadedContext?.engine || loadedContext.moduleBuild !== build) fail('loadedContext must belong to the specified frozen module build', loc);
      const placement = transform === undefined ? { rows: identity, offset: [0, 0, 0] } : rigidTransform(transform, loc);
      const rows = resolveTopology(loadedContext.engine, partQuery, loc);
      const composite = rows.find(row => isCompositeRecord(row.record));
      if (composite) refuseComposite(composite.record, loc);
      if (!rows.length || rows.some(row => row.kind !== 'body')) fail('An instance requires source solid bodies', loc);
      const id = new Id([...instantiator.id.parts, name]);
      instantiator.instances.push({ name, id, rows, placement });
      return new TopologyQuery('created', { id, entityType: new EnumValue('EntityType', 'BODY') });
    }),
    instantiate: builtin('instantiate', 2, 2, ([context, instantiator], loc) => {
      if (!(instantiator instanceof Instantiator) || instantiator.done) fail('Invalid or already evaluated instantiator', loc);
      // Materialize every source before changing the target context.
      const instances = instantiator.instances.flatMap(i => i.rows.map(row => ({ id: i.id, body: row.record.body, placement: i.placement,
        name: i.rows.length === 1 ? i.id.toString() : `${i.id}/${row.record.sourcePartId ?? row.record.key}` })));
      engine.claim(context, instantiator.id, loc);
      for (const { id, body, placement, name } of instances) {
        engine.addSolid(id, transformAnalytic(engine.kernel, body, name, placement.rows, placement.offset));
        // Onshape counts instance bodies as created by the instantiator too,
        // so qCreatedBy(<instantiator id>) finds them (exact id match).
        const record = engine.records.get(String(engine.nextRecord - 1));
        if (!record?.createdBy.has(id.key())) fail('Instantiated body record was not found', loc);
        record.createdBy.add(instantiator.id.key());
      }
      instantiator.done = true;
    }),
  };
}
