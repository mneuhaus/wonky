import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const hash = value => createHash('sha256').update(value).digest('hex');

// Staging is owned by the caller. Published generations are never overwritten
// or removed, including when the final report replacement fails.
export function publishRenderGeneration({ staging, out, report }) {
  out = resolve(out);
  const files = new Map(fs.readdirSync(staging, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(entry => {
    if (!entry.isFile()) throw new Error(`Render generation contains a non-file: ${entry.name}`);
    return [entry.name, hash(fs.readFileSync(join(staging, entry.name)))];
  }));
  const requireAsset = ({ file, sha256 }) => {
    if (typeof file !== 'string' || basename(file) !== file || !files.has(file)) throw new Error(`Missing render asset: ${file}`);
    if (files.get(file) !== sha256) throw new Error(`Render asset hash mismatch: ${file}`);
  };
  const meshFiles = ['before.display.stl', 'after.display.stl'];
  if (!Array.isArray(report.inputs) || report.inputs.length !== meshFiles.length) throw new Error('Render generation requires both display meshes');
  report.inputs.forEach((input, index) => requireAsset({ file: meshFiles[index], sha256: input.sha256 }));
  requireAsset(report.overview);
  for (const view of report.views) for (const image of Object.values(view.images)) requireAsset(image);
  if (!files.has('camera.json') || !isDeepStrictEqual(JSON.parse(fs.readFileSync(join(staging, 'camera.json'), 'utf8')), report.camera)) {
    throw new Error('Render generation camera does not match the report');
  }

  // Bind the identity to all prepared assets and report metadata before adding
  // paths that themselves contain the generation identity.
  files.delete('report.json');
  const id = hash(JSON.stringify({ report, files: [...files] }));
  const directory = `generations/${id}`, generation = join(out, directory);
  const published = {
    ...report,
    inputs: report.inputs.map((input, index) => ({ ...input, path: join(generation, meshFiles[index]) })),
    assetGeneration: { id, directory },
    cameraFile: join(generation, 'camera.json')
  };
  const bytes = JSON.stringify(published, null, 2) + '\n';
  fs.writeFileSync(join(staging, 'report.json'), bytes);
  fs.mkdirSync(join(out, 'generations'), { recursive: true });
  // Do not replace even an empty directory left at an existing generation path.
  try {
    fs.lstatSync(generation);
    throw new Error(`Render generation already exists: ${generation}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const pending = fs.mkdtempSync(join(out, '.wonky-report-'));
  try {
    const nextReport = join(pending, 'report.json');
    fs.writeFileSync(nextReport, bytes);
    fs.renameSync(staging, generation);
    fs.renameSync(nextReport, join(out, 'report.json'));
  } finally {
    // This temporary directory was created by this invocation. Generations and
    // prior output files are deliberately outside cleanup ownership.
    fs.rmSync(pending, { recursive: true, force: true });
  }
  return published;
}
