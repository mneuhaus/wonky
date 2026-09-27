import { rustModel, rustModelKernel, rustModelRecord } from './native/rust-host.mjs';
import { geometryRevision } from './identity.mjs';
import { binary64Host, number, real } from './real.mjs';

export function constructionBudget(nativeCeiling) {
  return { schema: 'wonky-construction-budget/1', ceilingMm: number(nativeCeiling), nativeCeiling: structuredClone(nativeCeiling) };
}

// The native Real words a budget may carry: an F32x2 pair for Bend, the binary64
// itself (lo = 0, wire v2) for WONKY_BACKEND=rust.
const nativeRealWords = native => binary64Host() ? native.lo === 0 && !Object.is(native.lo, -0)
  : Math.fround(native.hi) === native.hi && Math.fround(native.lo) === native.lo;

// Reader/export incidence allowances never become new construction budgets.
export function inheritedConstructionBudget(body, inputTolerance = 0) {
  const budget = body.constructionBudget;
  if (!budget) return null;
  const native = budget.nativeCeiling;
  if (budget.schema !== 'wonky-construction-budget/1' || native?.$ !== 'Real' ||
      !Number.isFinite(budget.ceilingMm) || budget.ceilingMm < 0 ||
      !Number.isFinite(native.hi) || !Number.isFinite(native.lo) ||
      !nativeRealWords(native) ||
      number(native) !== budget.ceilingMm) throw new TypeError('Invalid inherited construction budget');
  real(budget.ceilingMm);
  if (!Number.isFinite(inputTolerance) || inputTolerance < 0 || inputTolerance > budget.ceilingMm) {
    throw new RangeError('inputTolerance cannot enlarge the inherited construction budget');
  }
  return structuredClone(native);
}

function inputRecord(body, operand) {
  return { operand, bodyId: body.id, revision: geometryRevision(body),
    identity: body.identity ? structuredClone(body.identity) : null,
    topologyCounts: { vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length },
    constructionBudget: body.constructionBudget ? structuredClone(body.constructionBudget) : null,
    history: (body.operationHistory ?? []).map(historyReference) };
}

// An input's earlier operations are recorded by reference, not copied: the
// full evidence of each is its own entry in the model-level operationEvidence
// list of brep.json (look it up by operationId among the entries with
// outputs). Copying it here nested every earlier input's history again, so a
// chain of n Booleans held O(n^2) copies (381 MB of evidence for the R20 tray).
// The transform chain between that operation and this one stays here, because
// it belongs to this input and nowhere else records it. In memory the
// reference also holds the evidence object itself (not enumerable, so never
// serialized): a producer without a model-level list (Python, wonky-compare)
// still reaches it, and serializeModel writes it into the list.
const referenced = Symbol('referenced operation evidence');

function historyReference({ evidence, transformChain }) {
  const reference = { evidence: { schema: evidence?.schema ?? null, operationId: evidence?.operationId ?? null, operation: evidence?.operation ?? null,
    method: evidence?.method ?? null, status: evidence?.status ?? null },
  transformChain: structuredClone(transformChain ?? []) };
  if (evidence) Object.defineProperty(reference, referenced, { value: evidence });
  return reference;
}

const producedBy = (list, id) => (list ?? []).filter(entry => entry?.operationId === id && Array.isArray(entry.outputs));

// The full evidence a history reference names: the one model-level entry of
// that operation that produced bodies; without one, the evidence the reference
// holds in memory. null when none or several match.
export function historyEvidence(model, reference) {
  const id = reference?.evidence?.operationId;
  const found = typeof id === 'string' ? producedBy(model?.operationEvidence, id) : [];
  if (found.length) return found.length === 1 ? found[0] : null;
  return reference?.[referenced] ?? null;
}

// Every evidence the model reaches: its list, then the evidence of each body's
// history and, depth first, the evidence each input's history references. One
// entry per operation that produced bodies is added only when the list has
// none, so a producer's own list is never duplicated or reordered.
function completeEvidence(model) {
  const list = Array.isArray(model.operationEvidence) ? [...model.operationEvidence] : [];
  const seen = new Set(list), pending = [];
  const reach = evidence => {
    if (!evidence || typeof evidence !== 'object' || seen.has(evidence)) return;
    seen.add(evidence);
    if (Array.isArray(evidence.outputs) && typeof evidence.operationId === 'string' && !producedBy(list, evidence.operationId).length) list.push(evidence);
    pending.push(evidence);
  };
  list.forEach(entry => pending.push(entry));
  for (const body of model.bodies ?? []) for (const entry of body?.operationHistory ?? []) reach(entry?.evidence);
  while (pending.length) {
    for (const input of pending.pop().inputs ?? []) for (const reference of input?.history ?? []) reach(reference?.[referenced]);
  }
  return list;
}

export const operationEvidenceSchema = 'wonky-operation-evidence/2';

export function operationEvidence(id, operation, inputs, policy, details) {
  return { schema: operationEvidenceSchema, operationId: id, operation,
    frame: { id: `${id}/input-frame`, units: 'millimeter', description: 'Operand coordinates at operation execution' },
    modelingPolicy: policy, inputs: inputs.map(inputRecord), ...details };
}

export function attachOperationEvidence(bodies, evidence) {
  evidence.outputs = bodies.map(body => ({ bodyId: body.id, revision: geometryRevision(body),
    topologyCounts: { vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length } }));
  for (const body of bodies) body.operationHistory = [{ evidence, transformChain: [] }];
  // Empty operations retain their evidence at context/model level.
  Object.defineProperty(bodies, 'operationEvidence', { value: [evidence] });
  return bodies;
}

export function transformConstructionHistory(source, result, operationId, rows, offset) {
  if (source.constructionBudget) result.constructionBudget = structuredClone(source.constructionBudget);
  // The evidence is the record of an operation that already ran: shared, not
  // copied, like the output bodies of one operation share it.
  if (source.operationHistory) result.operationHistory = source.operationHistory.map(entry => ({
    evidence: entry.evidence,
    transformChain: [...structuredClone(entry.transformChain), { operationId, rows: structuredClone(rows), offsetMm: [...offset] }],
  }));
}

// brep.json stores the input identities in a pool of shared JSON values. In
// memory an evidence input carries its identity inline (a snapshot taken when
// the operation ran). Written inline, a Boolean chain repeated each snapshot
// per nesting level (138 MB of the R20 tray's 381 MB); one table entry per
// distinct identity still grew as O(steps x entities), because every snapshot
// of a growing body is new and each entity repeats its parents' full keys and
// its own origin inside its instance (a plate 120 holes deep: 182.7 MB, about
// 170 holes past V8's string limit). encodeModel replaces each inline input
// identity by identityRef, a key of model.inputIdentities (its geometry
// revision, '#2', '#3' ... when two different identities share one), whose
// value is the index of the identity's root in model.identityPool. The pool
// stores every distinct JSON value once, children before parents:
//   "text" | number | true | false | null     the value itself
//   {"a": [i, ...]}                            array of pool values
//   {"o": [key, value, ...]}                   object, as pool index pairs
//   {"k": [i, ...]}                            "wk1/" + the framed parts
//   {"f": [i, ...]}                            the framed parts alone
// so an entity's parent keys, and the origin inside its instance, are the
// entries the parent's own identity already holds. Idempotent: an encoded
// model comes back unchanged. inputIdentity reads inline, legacy table
// (identity objects as values) and pool forms.
export const identityPoolSchema = 'wonky-identity-pool/1';

// The parts of prefix + frames(parts) (identity.bend), or null when the text
// is not exactly that; re-framing must give the text back.
function framedParts(text, prefix) {
  if (!text.startsWith(prefix) || text.length === prefix.length) return null;
  const parts = [];
  for (let at = prefix.length; at < text.length;) {
    const colon = text.indexOf(':', at), digits = text.slice(at, colon);
    if (colon < 0 || !/^\d{1,9}$/.test(digits)) return null;
    const end = colon + 1 + Number(digits);
    if (end > text.length) return null;
    parts.push(text.slice(colon + 1, end));
    at = end;
  }
  return prefix + parts.map(part => `${part.length}:${part}`).join('') === text ? parts : null;
}

function poolWriter(entries = []) {
  entries = [...entries];
  const strings = new Map(), shaped = new Map(), objects = new WeakMap();
  const shapeKey = entry => entry !== null && typeof entry === 'object' ? JSON.stringify(entry) : `=${JSON.stringify(entry)}`;
  entries.forEach((entry, index) => typeof entry === 'string' ? strings.set(entry, index) : shaped.set(shapeKey(entry), index));
  const add = entry => {
    const key = shapeKey(entry);
    if (!shaped.has(key)) { shaped.set(key, entries.length); entries.push(entry); }
    return shaped.get(key);
  };
  const jsonValue = item => item === undefined || typeof item === 'function' || typeof item === 'symbol';
  const value = item => {
    if (typeof item === 'string') {
      if (strings.has(item)) return strings.get(item);
      const key = framedParts(item, 'wk1/'), parts = key ?? (item.length >= 32 ? framedParts(item, '') : null);
      let index;
      if (parts) index = add({ [key ? 'k' : 'f']: parts.map(value) });
      else { index = entries.length; entries.push(item); }
      strings.set(item, index);
      return index;
    }
    if (typeof item === 'number') return add(Number.isFinite(item) ? item : null);
    if (item === null || typeof item === 'boolean') return add(item);
    if (typeof item !== 'object') throw new TypeError(`Identity value of type ${typeof item} has no JSON form`);
    if (objects.has(item)) return objects.get(item);
    const index = typeof item.toJSON === 'function' ? value(item.toJSON())
      : Array.isArray(item) ? add({ a: item.map(element => value(jsonValue(element) ? null : element)) })
      : add({ o: Object.entries(item).filter(([, field]) => !jsonValue(field)).flatMap(([name, field]) => [value(name), value(field)]) });
    objects.set(item, index);
    return index;
  };
  return { entries, value };
}

const decodedPools = new WeakMap();

// Pool value i, decoded once per pool and frozen: readers share it.
function poolValue(pool, root) {
  if (pool?.schema !== identityPoolSchema || !Array.isArray(pool.entries)) throw new TypeError('Missing or unsupported identity pool');
  const { entries } = pool;
  if (!decodedPools.has(pool)) decodedPools.set(pool, new Map());
  const decoded = decodedPools.get(pool);
  const read = (index, parent) => {
    if (!Number.isInteger(index) || index < 0 || index >= parent) throw new TypeError(`Identity pool reference ${index} from ${parent} is not an earlier entry`);
    if (decoded.has(index)) return decoded.get(index);
    const entry = entries[index], shape = entry !== null && typeof entry === 'object' ? Object.keys(entry) : null;
    const list = shape?.length === 1 && Array.isArray(entry[shape[0]]) ? entry[shape[0]].map(child => read(child, index)) : null;
    const names = list?.filter((_, at) => at % 2 === 0);
    let result;
    if (!shape) result = entry;
    else if (!list) throw new TypeError(`Invalid identity pool entry ${index}`);
    else if (shape[0] === 'a') result = Object.freeze(list);
    else if (shape[0] === 'o' && list.length % 2 === 0 && names.every(name => typeof name === 'string')) {
      result = Object.freeze(Object.fromEntries(names.map((name, at) => [name, list[2 * at + 1]])));
    } else if ((shape[0] === 'k' || shape[0] === 'f') && list.every(part => typeof part === 'string')) {
      result = (shape[0] === 'k' ? 'wk1/' : '') + list.map(part => `${part.length}:${part}`).join('');
    } else throw new TypeError(`Invalid identity pool entry ${index}`);
    decoded.set(index, result);
    return result;
  };
  return read(root, entries.length);
}

function encodeModel(model) {
  const { identityPool: prior, ...rest } = model;
  if (prior !== undefined && (prior?.schema !== identityPoolSchema || !Array.isArray(prior.entries))) throw new TypeError('Unsupported identity pool');
  const pool = poolWriter(prior?.entries), table = {}, keys = new Map(), byRoot = new Map();
  for (const [key, recorded] of Object.entries(model.inputIdentities ?? {})) {
    if (typeof recorded === 'number') poolValue(prior, recorded);
    const root = typeof recorded === 'number' ? recorded : pool.value(recorded);
    table[key] = root;
    if (!byRoot.has(root)) byRoot.set(root, key);
  }
  const intern = identity => {
    if (keys.has(identity)) return keys.get(identity);
    const root = pool.value(identity);
    let key = byRoot.get(root);
    if (key === undefined) {
      const base = typeof identity.revision === 'string' ? identity.revision : 'unrevisioned';
      key = base;
      for (let n = 2; Object.hasOwn(table, key); n++) key = `${base}#${n}`;
      table[key] = root; byRoot.set(root, key);
    }
    keys.set(identity, key);
    return key;
  };
  const input = record => !record || !Object.hasOwn(record, 'identity') ? record
    : Object.fromEntries(Object.entries(record).map(([key, value]) => key === 'identity' ? ['identityRef', value ? intern(value) : null] : [key, value]));
  const encoded = new Map();
  const evidence = entry => {
    if (!Array.isArray(entry?.inputs) || !entry.inputs.some(record => record && Object.hasOwn(record, 'identity'))) return entry;
    if (!encoded.has(entry)) encoded.set(entry, { ...entry, inputs: entry.inputs.map(input) });
    return encoded.get(entry);
  };
  const result = rest;
  const complete = completeEvidence(model);
  if (complete.length || Array.isArray(model.operationEvidence)) result.operationEvidence = complete.map(evidence);
  if (Array.isArray(model.bodies)) result.bodies = model.bodies.map(body => !Array.isArray(body?.operationHistory) ? body
    : { ...body, operationHistory: body.operationHistory.map(entry => ({ ...entry, evidence: evidence(entry.evidence) })) });
  if (Object.keys(table).length) result.inputIdentities = table;
  if (pool.entries.length) result.identityPool = { schema: identityPoolSchema, entries: pool.entries };
  return result;
}

// The brep.json text: bin/wonky.mjs and the viewer write exactly this. The
// model is indented; the identity pool, last, holds one compact entry per line
// (indenting its index lists would multiply its size).
export function serializeModel(model) {
  // Strict rust: each body's WC0 reading plus the Rust-written legacy-shaped
  // projection that scripts/validate-step.py reads (native/rust-host.mjs).
  if (rustModel(model)) return JSON.stringify(rustModelRecord(rustModelKernel(model), model), null, 2) + '\n';
  const { identityPool, ...rest } = encodeModel(model);
  const text = JSON.stringify(rest, null, 2);
  if (!identityPool) return text + '\n';
  const pool = `"identityPool": {\n    "schema": ${JSON.stringify(identityPool.schema)},\n    "entries": [\n      ${identityPool.entries.map(entry => JSON.stringify(entry)).join(',\n      ')}\n    ]\n  }`;
  return text === '{}' ? `{\n  ${pool}\n}\n` : `${text.slice(0, -2)},\n  ${pool}\n}\n`;
}

// The identity an evidence input recorded: inline, or through the model table
// (a pool index, or the identity itself in brep.json written before the pool).
export function inputIdentity(model, input) {
  if (input && Object.hasOwn(input, 'identity')) return input.identity ?? null;
  const table = model?.inputIdentities;
  if (typeof input?.identityRef !== 'string' || !table || !Object.hasOwn(table, input.identityRef)) return null;
  const recorded = table[input.identityRef];
  return typeof recorded === 'number' ? poolValue(model.identityPool, recorded) : recorded;
}
