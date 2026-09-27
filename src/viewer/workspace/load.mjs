// Viewer workspace files (docs/viewer/workspace.md, section 1).
//
//   readWorkspaceFile(path)            -> normalized workspace (throws WorkspaceError)
//   normalizeWorkspace(json, { file }) -> the same from parsed JSON
//   implicitWorkspace(plan)            -> plain CLI inputs as a workspace
//   isWorkspaceInput(path)             -> a .json that is not .brep.json
//
// A normalized workspace:
//   { schema, name, file, open, limits,
//     models: [{ key, label, source, language, static, build, out, matrix }],
//     assemblies: [{ key, label, instances: [{ id, model, matrix }] }] }
// `build` has exactly the shape bin/wonky-view.mjs passes as `build` for one
// live source (feature, parameters, moduleManifest, maxSteps, modelingPolicy,
// python, timeoutMs, maxRequests); `out` is { prefix, format, deviationMm }
// or null. Model `matrix` is the model placement; an instance `matrix` is
// instance.transform ∘ model.transform. Paths resolve against the file's
// directory; `~/` is $HOME; `store:` is the Onshape store root.
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeModelingPolicy } from '../../modeling-policy.mjs';
import { languageOf } from '../live/session.mjs';
import { compose, IDENTITY, parseTransform, WorkspaceError } from './transform.mjs';

export { WorkspaceError } from './transform.mjs';

export const WORKSPACE_SCHEMA = 'wonky.view-workspace/1';
export const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const DEFAULT_PYTHON = join(REPO, 'scripts/viewer/uv-python');

// Pool and ring bounds (docs/viewer/workspace.md, section 4).
export const DEFAULT_LIMITS = Object.freeze({
  concurrency: 2, maxWorkers: 4, workerRssMb: 1536, displayBudgetMb: 512, modelBudgetMb: 256,
});

const BUILD_FIELDS = ['maxSteps', 'curvedContacts', 'contactCapMm', 'python', 'timeoutMs',
  'maxRequests', 'format', 'deviationMm'];
const MODEL_FIELDS = new Set(['key', 'label', 'source', 'feature', 'params', 'modules', 'out',
  'transform', ...BUILD_FIELDS]);
const TOP_FIELDS = new Set(['schema', 'name', 'defaults', 'limits', 'models', 'assemblies',
  'open']);

export const storeRoot = (env = process.env) => (env.WONKY_ONSHAPE_STORE
  ? resolve(env.WONKY_ONSHAPE_STORE) : join(REPO, 'var/onshape-store'));

export const isWorkspaceInput = path => /\.json$/i.test(path) && !/\.brep\.json$/i.test(path);

const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

function resolvePath(value, at, base, env) {
  if (typeof value !== 'string' || !value) throw new WorkspaceError(at, 'expects a path');
  if (value.startsWith('store:')) return resolve(storeRoot(env), value.slice(6));
  if (value === '~' || value.startsWith('~/')) return join(env.HOME ?? homedir(), value.slice(2));
  return isAbsolute(value) ? value : resolve(base, value);
}

function check(value, test, at, message) {
  if (!test(value)) throw new WorkspaceError(at, message);
  return value;
}

const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

// Build fields shared by defaults and models (same meaning as the CLI flags).
function buildFields(entry, at, base, env) {
  const result = {};
  if (entry.maxSteps !== undefined) {
    result.maxSteps = check(entry.maxSteps, positiveInteger, `${at}.maxSteps`,
      'expects a positive integer');
  }
  if (entry.curvedContacts !== undefined) {
    result.curvedContacts = check(entry.curvedContacts,
      value => ['strict', 'tolerated-regularized'].includes(value), `${at}.curvedContacts`,
      'expects strict or tolerated-regularized');
  }
  if (entry.contactCapMm !== undefined) {
    result.contactCapMm = check(entry.contactCapMm, positive, `${at}.contactCapMm`,
      'expects a positive number');
  }
  if (entry.python !== undefined) {
    result.python = check(entry.python, value => typeof value === 'string' && value.length > 0,
      `${at}.python`, 'expects an executable');
    if (result.python.includes('/')) result.python = resolvePath(result.python, `${at}.python`,
      base, env);
  }
  if (entry.timeoutMs !== undefined) {
    result.timeoutMs = check(entry.timeoutMs, positiveInteger, `${at}.timeoutMs`,
      'expects a positive integer');
  }
  if (entry.maxRequests !== undefined) {
    result.maxRequests = check(entry.maxRequests, positiveInteger, `${at}.maxRequests`,
      'expects a positive integer');
  }
  if (entry.format !== undefined) {
    result.format = check(entry.format, value => ['all', 'step', 'print'].includes(value),
      `${at}.format`, 'expects all, step or print');
  }
  if (entry.deviationMm !== undefined) {
    result.deviationMm = check(entry.deviationMm, positive, `${at}.deviationMm`,
      'expects a positive number');
  }
  return result;
}

function modelingPolicyOf(fields, at) {
  if (fields.contactCapMm !== undefined && fields.curvedContacts !== 'tolerated-regularized') {
    throw new WorkspaceError(`${at}.contactCapMm`, 'requires curvedContacts'
      + ' tolerated-regularized');
  }
  try {
    return { ...normalizeModelingPolicy({
      curvedContacts: fields.curvedContacts ?? 'strict',
      ...(fields.contactCapMm !== undefined ? { contactCapMm: fields.contactCapMm } : {}),
    }) };
  } catch (error) {
    throw new WorkspaceError(at, error.message);
  }
}

function parameters(value, at) {
  if (value === undefined) return {};
  if (!isObject(value)) throw new WorkspaceError(at, 'expects { name: FeatureScript expression }');
  const result = Object.create(null);
  for (const [name, expression] of Object.entries(value)) {
    if (!name || typeof expression !== 'string' || !expression.trim()) {
      throw new WorkspaceError(`${at}.${name}`, 'expects a FeatureScript expression string');
    }
    result[name] = expression;
  }
  return result;
}

const canonical = value => JSON.stringify(value, Object.keys(value ?? {}).sort());

export function normalizeWorkspace(json, { file = null, env = process.env } = {}) {
  if (!isObject(json)) throw new WorkspaceError('$', 'a workspace file is a JSON object');
  if (json.schema !== WORKSPACE_SCHEMA) {
    throw new WorkspaceError('$.schema', `expects "${WORKSPACE_SCHEMA}"`);
  }
  for (const key of Object.keys(json)) {
    if (!TOP_FIELDS.has(key)) throw new WorkspaceError(`$.${key}`, 'unknown field');
  }
  const base = file ? dirname(file) : process.cwd();
  const defaultsEntry = json.defaults ?? {};
  if (!isObject(defaultsEntry)) throw new WorkspaceError('$.defaults', 'expects an object');
  for (const key of Object.keys(defaultsEntry)) {
    if (!BUILD_FIELDS.includes(key)) {
      throw new WorkspaceError(`$.defaults.${key}`, ['feature', 'params', 'modules', 'out']
        .includes(key) ? 'is per model only' : 'unknown field');
    }
  }
  const defaults = buildFields(defaultsEntry, '$.defaults', base, env);

  const limitsEntry = json.limits ?? {};
  if (!isObject(limitsEntry)) throw new WorkspaceError('$.limits', 'expects an object');
  const limits = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(limitsEntry)) {
    if (!(key in DEFAULT_LIMITS)) throw new WorkspaceError(`$.limits.${key}`, 'unknown field');
    limits[key] = check(value, positiveInteger, `$.limits.${key}`, 'expects a positive integer');
  }
  if (limits.maxWorkers < limits.concurrency) {
    throw new WorkspaceError('$.limits.maxWorkers', 'must be at least limits.concurrency');
  }

  if (!Array.isArray(json.models) || !json.models.length) {
    throw new WorkspaceError('$.models', 'expects a non-empty list of models');
  }
  const keys = new Set();
  const identities = new Map();
  const claim = (key, at) => {
    check(key, value => typeof value === 'string' && KEY.test(value), at,
      'expects a key matching ^[a-z0-9][a-z0-9-]{0,39}$');
    if (keys.has(key)) throw new WorkspaceError(at, `duplicate key "${key}"`);
    keys.add(key);
  };
  const models = json.models.map((entry, index) => {
    const at = `$.models[${index}]`;
    if (!isObject(entry)) throw new WorkspaceError(at, 'expects an object');
    for (const field of Object.keys(entry)) {
      if (!MODEL_FIELDS.has(field)) throw new WorkspaceError(`${at}.${field}`, 'unknown field');
    }
    claim(entry.key, `${at}.key`);
    const source = resolvePath(entry.source, `${at}.source`, base, env);
    const language = languageOf(source);
    if (!language) {
      throw new WorkspaceError(`${at}.source`, 'expects a .fs, .py or .brep.json file');
    }
    const isStatic = language === 'brep';
    const own = buildFields(entry, at, base, env);
    const fields = { ...defaults, ...own };
    if (isStatic) {
      const build = ['feature', 'params', 'modules', 'out', ...Object.keys(own)]
        .find(field => entry[field] !== undefined);
      if (build) throw new WorkspaceError(`${at}.${build}`, 'a .brep.json model is shown as saved;'
        + ' build options do not apply');
    }
    if (entry.feature !== undefined) {
      check(entry.feature, value => typeof value === 'string' && value.length > 0,
        `${at}.feature`, 'expects a feature name');
    }
    const params = parameters(entry.params, `${at}.params`);
    const moduleManifest = entry.modules === undefined ? undefined
      : resolvePath(entry.modules, `${at}.modules`, base, env);
    if (moduleManifest && language !== 'featurescript') {
      throw new WorkspaceError(`${at}.modules`, 'applies to .fs sources only');
    }
    if (entry.label !== undefined) {
      check(entry.label, value => typeof value === 'string' && value.trim().length > 0,
        `${at}.label`, 'expects a non-empty string');
    }
    const identity = `${source}\u0000${entry.feature ?? ''}\u0000${canonical({ ...params })}`
      + `\u0000${moduleManifest ?? ''}`;
    if (identities.has(identity)) {
      throw new WorkspaceError(at, `same source, feature, params and modules as model`
        + ` "${identities.get(identity)}"; reuse it through assembly instances`);
    }
    identities.set(identity, entry.key);
    const format = fields.format ?? (language === 'python' ? 'step' : 'all');
    return {
      key: entry.key,
      label: entry.label ?? entry.key,
      source,
      language,
      static: isStatic,
      build: isStatic ? null : {
        feature: entry.feature,
        parameters: params,
        moduleManifest,
        maxSteps: fields.maxSteps,
        modelingPolicy: modelingPolicyOf(fields, at),
        python: language === 'python' ? fields.python ?? DEFAULT_PYTHON : undefined,
        timeoutMs: fields.timeoutMs,
        maxRequests: fields.maxRequests,
      },
      out: entry.out === undefined ? null : {
        prefix: resolvePath(entry.out, `${at}.out`, base, env), format,
        deviationMm: fields.deviationMm ?? 0.02,
      },
      matrix: parseTransform(entry.transform, `${at}.transform`),
    };
  });
  const byKey = new Map(models.map(model => [model.key, model]));

  const assembliesEntry = json.assemblies ?? [];
  if (!Array.isArray(assembliesEntry)) throw new WorkspaceError('$.assemblies', 'expects a list');
  const assemblies = assembliesEntry.map((entry, index) => {
    const at = `$.assemblies[${index}]`;
    if (!isObject(entry)) throw new WorkspaceError(at, 'expects an object');
    for (const field of Object.keys(entry)) {
      if (!['key', 'label', 'instances'].includes(field)) {
        throw new WorkspaceError(`${at}.${field}`, 'unknown field');
      }
    }
    claim(entry.key, `${at}.key`);
    if (!Array.isArray(entry.instances) || !entry.instances.length) {
      throw new WorkspaceError(`${at}.instances`, 'expects a non-empty list');
    }
    return {
      key: entry.key,
      label: entry.label ?? entry.key,
      instances: entry.instances.map((instance, position) => {
        const where = `${at}.instances[${position}]`;
        if (!isObject(instance)) throw new WorkspaceError(where, 'expects { model, transform? }');
        for (const field of Object.keys(instance)) {
          if (!['model', 'transform'].includes(field)) {
            throw new WorkspaceError(`${where}.${field}`, 'unknown field');
          }
        }
        const model = byKey.get(instance.model);
        if (!model) throw new WorkspaceError(`${where}.model`, `unknown model "${instance.model}"`);
        return {
          id: `${entry.key}/${position}`,
          model: model.key,
          matrix: compose(parseTransform(instance.transform, `${where}.transform`), model.matrix),
        };
      }),
    };
  });

  let open = json.open;
  if (open === undefined) {
    open = assemblies.length ? `assembly:${assemblies[0].key}` : `model:${models[0].key}`;
  } else {
    const [kind, key] = typeof open === 'string' ? open.split(':') : [];
    const known = kind === 'model' ? byKey.has(key)
      : kind === 'assembly' && assemblies.some(assembly => assembly.key === key);
    if (!known) throw new WorkspaceError('$.open', 'expects model:<key> or assembly:<key> of this'
      + ' workspace');
  }
  return {
    schema: WORKSPACE_SCHEMA,
    name: typeof json.name === 'string' && json.name.trim() ? json.name
      : file ? file.split('/').at(-1).replace(/\.json$/i, '') : 'Workspace',
    file,
    open,
    limits,
    models,
    assemblies,
  };
}

// Reads and normalizes a workspace file, or (schema r20/studio-build/v1) the
// studio manifest through its adapter.
export async function readWorkspaceFile(path, { env = process.env } = {}) {
  let real;
  try {
    real = realpathSync(resolve(path));
  } catch (error) {
    throw new WorkspaceError(path, `cannot read: ${error.message}`);
  }
  let json;
  try {
    json = JSON.parse(readFileSync(real, 'utf8'));
  } catch (error) {
    throw new WorkspaceError(real, `is not valid JSON: ${error.message}`);
  }
  if (json?.schema === 'r20/studio-build/v1') {
    const { studioWorkspace } = await import('./studios.mjs');
    return normalizeWorkspace(studioWorkspace(json, { manifestPath: real, env }),
      { file: real, env });
  }
  return normalizeWorkspace(json, { file: real, env });
}

// Plain CLI inputs (bin/wonky-view.mjs plan()) as a workspace: one model per
// input with the CLI build flags, no assembly. The server has one code path.
export function implicitWorkspace({ modelPaths = [], sources = [], build = {}, out = null }) {
  const used = new Set();
  const keyOf = path => {
    const stem = path.split('/').at(-1).replace(/\.brep\.json$|\.[^.]+$/i, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'model';
    let key = /^[a-z0-9]/.test(stem) ? stem : `m-${stem}`;
    for (let suffix = 2; used.has(key); suffix++) key = `${stem.slice(0, 30)}-${suffix}`;
    used.add(key);
    return key;
  };
  const inputs = [
    ...sources.map(source => ({ path: typeof source === 'string' ? source : source.path,
      static: false })),
    ...modelPaths.map(path => ({ path, static: true })),
  ];
  return {
    schema: WORKSPACE_SCHEMA,
    name: null,
    file: null,
    implicit: true,
    open: null,
    limits: null,
    models: inputs.map(input => {
      const key = keyOf(input.path);
      return {
        key,
        label: input.path.split('/').at(-1),
        source: resolve(input.path),
        language: languageOf(input.path),
        static: input.static,
        build: input.static ? null : build,
        out: input.static ? null : out,
        matrix: [...IDENTITY],
      };
    }),
    assemblies: [],
  };
}
