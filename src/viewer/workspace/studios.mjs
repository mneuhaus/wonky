// Studio manifest adapter (docs/viewer/workspace.md, section 1): a CAD
// project's build/studios/manifest.json (schema r20/studio-build/v1) as a
// workspace file. One model per `order` entry, source <dir>/<studio>.fs,
// feature modules[k].featureType, label modules[k].featureName, frozen
// modules from the store convention of scripts/snapshot-modules.mjs
// (<store>/manifests/<corpus-relative source>.json) when that file exists,
// and one assembly `all` over `order`. Params, transforms and `out` need a
// real workspace file (`--print-workspace` prints this result to start one).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { storeRoot, WORKSPACE_SCHEMA } from './load.mjs';
import { WorkspaceError } from './transform.mjs';

export const STUDIO_SCHEMA = 'r20/studio-build/v1';

export const corpusRoot = (env = process.env) => resolve(env.WONKY_CORPUS_ROOT
  ?? join(env.HOME ?? homedir(), 'Workspace', 'cad'));

const keyOf = name => String(name).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-+|-+$/g, '').slice(0, 40);

export function studioWorkspace(manifest, { manifestPath, env = process.env }) {
  if (manifest?.schema !== STUDIO_SCHEMA) {
    throw new WorkspaceError('$.schema', `expects "${STUDIO_SCHEMA}"`);
  }
  if (!Array.isArray(manifest.order) || !manifest.order.length) {
    throw new WorkspaceError('$.order', 'expects the list of module names');
  }
  const directory = dirname(manifestPath);
  const corpus = corpusRoot(env);
  const store = storeRoot(env);
  const models = manifest.order.map((name, index) => {
    const module = manifest.modules?.[name];
    if (!module || typeof module.featureType !== 'string') {
      throw new WorkspaceError(`$.modules.${name}.featureType`, `module "${name}" of`
        + ` $.order[${index}] has no featureType`);
    }
    const file = `${module.studio ?? name}.fs`;
    const source = join(directory, file);
    const rel = relative(corpus, source);
    const frozen = rel.startsWith('..') || rel.startsWith(sep) ? null
      : join(store, 'manifests', `${rel}.json`);
    return {
      key: keyOf(name),
      label: module.featureName ?? name,
      source,
      feature: module.featureType,
      ...(frozen && existsSync(frozen)
        ? { modules: `store:${relative(store, frozen).split(sep).join('/')}` } : {}),
    };
  });
  const project = directory.split(sep).slice(-3, -2)[0] ?? 'project';
  return {
    schema: WORKSPACE_SCHEMA,
    name: project,
    models,
    assemblies: [{ key: 'all', label: 'All modules', instances: models.map(model => ({
      model: model.key,
    })) }],
    open: 'assembly:all',
  };
}
