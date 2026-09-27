// Viewer settings document (spec D19): <reviews>/viewer-settings.json,
// schema wonky.viewer-settings/1, written atomically.
//
//   {
//     schema: 'wonky.viewer-settings/1',
//     global:  { <key>: <json> },                       scope G
//     sources: { <source path>: { <key>: <json> } },    scope S
//     bodies:  { <source path>: { <body>: { <key>: <json> } } }   scope SB
//   }
//
// PUT merges a patch of the same shape: a key set to null is deleted.
// Values are arbitrary JSON; the document is limited to 256 KiB.
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { HttpError } from './http.mjs';

export const SETTINGS_SCHEMA = 'wonky.viewer-settings/1';
export const SETTINGS_LIMIT = 256 * 1024;

export const emptySettings = () => ({
  schema: SETTINGS_SCHEMA, global: {}, sources: {}, bodies: {},
});

const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function mergeLevel(target, patch, depth, path) {
  if (!plainObject(patch)) throw new HttpError(400, `Settings ${path} must be an object`);
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !key.length) {
      throw new HttpError(400, `Invalid settings key ${JSON.stringify(key)}`);
    }
    if (value === null) delete target[key];
    else if (depth > 0) {
      target[key] = plainObject(target[key]) ? target[key] : {};
      mergeLevel(target[key], value, depth - 1, `${path}.${key}`);
      if (!Object.keys(target[key]).length) delete target[key];
    } else target[key] = value;
  }
}

export function mergeSettings(document, patch) {
  if (!plainObject(patch)) throw new HttpError(400, 'Settings patch must be an object');
  const unknown = Object.keys(patch).filter(key => !['schema', 'global', 'sources', 'bodies']
    .includes(key));
  if (unknown.length) throw new HttpError(400, `Unknown settings scope ${unknown[0]}`);
  if (patch.schema !== undefined && patch.schema !== SETTINGS_SCHEMA) {
    throw new HttpError(400, `Settings schema must be ${SETTINGS_SCHEMA}`);
  }
  const next = structuredClone(document);
  if (patch.global !== undefined) mergeLevel(next.global, patch.global, 0, 'global');
  if (patch.sources !== undefined) mergeLevel(next.sources, patch.sources, 1, 'sources');
  if (patch.bodies !== undefined) mergeLevel(next.bodies, patch.bodies, 2, 'bodies');
  if (JSON.stringify(next).length > SETTINGS_LIMIT) {
    throw new HttpError(413, `Settings exceed ${SETTINGS_LIMIT} bytes`);
  }
  return next;
}

export function createSettingsStore({ reviewDirectory }) {
  const file = join(reviewDirectory, 'viewer-settings.json');
  let queue = Promise.resolve();
  async function read() {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return emptySettings();
      throw error;
    }
    const document = JSON.parse(text);
    if (document?.schema !== SETTINGS_SCHEMA) {
      throw new Error(`Unsupported settings file ${file}; expected ${SETTINGS_SCHEMA}`);
    }
    return { ...emptySettings(), ...document };
  }
  return {
    file,
    read,
    update(patch) {
      const run = queue.then(async () => {
        const next = mergeSettings(await read(), patch);
        const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
          await rename(temporary, file);
        } finally {
          await rm(temporary, { force: true });
        }
        return next;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
