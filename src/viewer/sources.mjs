// Source snapshot freezing (SRV-07, spec D22). A model's recorded source
// descriptors are frozen into <reviews>/sources/<sha>.txt, and the viewer
// never serves newer code as an old revision:
//
// - live sources (passed on the command line) are frozen from the exact bytes
//   the watcher hashed and the worker built, wherever they live (`frozen`
//   option of prepare(), a Map sha256 -> { file, bytes });
// - an existing snapshot whose bytes match the recorded SHA-256 (frozen from
//   exact bytes before, for example a live revision of an earlier session);
// - otherwise only when the file lies inside the project root and its current
//   bytes match the recorded SHA-256.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';

const hashPattern = /^[a-f0-9]{64}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');

export const sourceDescriptors = model => [
  model.sourceMap?.source,
  ...model.bodies.map(body => body.identity?.operation?.source ?? body.debug?.source),
].filter(source => source?.file && hashPattern.test(source.sha256 ?? ''));

async function writeOnce(snapshot, content) {
  try {
    await writeFile(snapshot, content, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

export function createSourceStore({ root, sourceDirectory }) {
  const sources = new Map();
  return {
    directory: sourceDirectory,
    // Freezes every eligible descriptor of `model`; returns the prepared map
    // without publishing it (commit() publishes).
    async prepare(model, { frozen = new Map() } = {}) {
      const prepared = new Map();
      for (const descriptor of sourceDescriptors(model)) {
        if (prepared.has(descriptor.sha256)) continue;
        const file = resolve(descriptor.file);
        const snapshot = join(sourceDirectory, `${descriptor.sha256}.txt`);
        const live = frozen.get(descriptor.sha256);
        if (live?.bytes && sha256(live.bytes) === descriptor.sha256) {
          await writeOnce(snapshot, live.bytes);
          prepared.set(descriptor.sha256, {
            file, sha256: descriptor.sha256, snapshot, live: true,
          });
          continue;
        }
        const inside = relative(root, file);
        const inRoot = !inside.startsWith('..') && resolve(root, inside) === file;
        try {
          let content;
          try {
            content = await readFile(snapshot);
          } catch (error) {
            if (error.code !== 'ENOENT' || !inRoot) throw error;
            content = await readFile(file);
          }
          if (sha256(content) !== descriptor.sha256) continue;
          await writeOnce(snapshot, content);
          prepared.set(descriptor.sha256, { file, sha256: descriptor.sha256, snapshot });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      return prepared;
    },
    commit(prepared) {
      for (const [id, source] of prepared) sources.set(id, source);
    },
    get: id => sources.get(id),
    // Exact frozen bytes, or null when no snapshot is known.
    async read(id) {
      const source = sources.get(id);
      if (!source) return null;
      const bytes = await readFile(source.snapshot);
      if (sha256(bytes) !== source.sha256) throw new Error('Source snapshot hash mismatch');
      return { file: source.file, sha256: source.sha256, text: bytes.toString('utf8') };
    },
  };
}
