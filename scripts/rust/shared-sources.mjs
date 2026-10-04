// Immutable, content-addressed compiler inputs. sccache's Rust key includes
// cwd and CARGO_MANIFEST_DIR; remapping debug paths alone cannot share hits.
import { mkdirSync, copyFileSync, renameSync, rmSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { sha256, walkRustFiles, outerCargoConfigs } from './build-key.mjs';

export function sharedSources(root, base, key) {
  const destination = join(resolve(base), key.sourceHash);
  const staging = `${destination}.${process.pid}.staging`;
  const inputs = key.files.filter(file => file.path.startsWith('rust/'));
  const verify = directory => {
    // Cargo discovers config from its actual compilation directory, including
    // ancestors reached through a symlinked cache. Those settings are absent
    // from the checkout's key, so refuse them even when reusing a snapshot.
    if (outerCargoConfigs(realpathSync(directory)).length) {
      throw new Error('SHARED_SOURCES_OUTER_CONFIG: shared snapshot has ancestor Cargo configuration');
    }
    if (JSON.stringify(walkRustFiles(directory)) !== JSON.stringify(inputs.map(file => file.path).sort())) {
      throw new Error('SHARED_SOURCE_CORRUPT: input file set changed');
    }
    for (const file of inputs) {
      if (sha256(readFileSync(join(directory, file.path))) !== file.sha256) {
        throw new Error(`SHARED_SOURCE_CORRUPT: ${file.path}`);
      }
    }
  };
  if (!existsSync(destination)) {
    rmSync(staging, { recursive: true, force: true });
    try {
      for (const file of inputs) {
        const target = join(staging, file.path);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(root, file.path), target);
      }
      verify(staging);
      try { renameSync(staging, destination); }
      catch (error) {
        // A concurrent builder may have published the same immutable inputs.
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      }
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  verify(destination);
  return join(destination, 'rust');
}
