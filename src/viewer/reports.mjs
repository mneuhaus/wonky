// Check report discovery (fixed files under <root>/out/) and the recorded
// render image registry. Unchanged behavior from the pre-foundation server:
// images are served only while their bytes match the SHA-256 in the report,
// and URLs of earlier generations stay valid for the server lifetime.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const hashPattern = /^[a-f0-9]{64}$/;

export const REPORT_FILES = Object.freeze([
  ['acceptance', 'Kernel acceptance', 'out/acceptance/report.json'],
  ['comparison', 'Geometric comparison', 'out/comparison-demo.json'],
  ['visual', 'Rendering comparison', 'out/visual-comparison/report.json'],
  ['curved-visual', 'Curved rendering comparison', 'out/curved-visual-comparison/report.json'],
  ['hardware', 'Hardware performance', 'out/hardware/report.json'],
]);

function registerImages(id, path, data, root, nextImages) {
  const generation = data.assetGeneration;
  if (generation !== undefined && (!generation || !hashPattern.test(generation.id ?? '')
    || generation.directory !== `generations/${generation.id}`)) {
    throw new Error('Invalid recorded render generation');
  }
  const directory = generation
    ? join(root, dirname(path), 'generations', generation.id)
    : join(root, dirname(path));
  const descriptors = [
    data.overview,
    ...(data.views ?? []).flatMap(view => Object.values(view.images ?? {})),
  ].filter(Boolean);
  for (const descriptor of descriptors) {
    if (!/^(comparison|[0-9]+-(before|after|diff))\.png$/.test(descriptor.file)
      || !hashPattern.test(descriptor.sha256 ?? '')) {
      throw new Error('Invalid recorded render image');
    }
    const prefix = generation ? generation.id + '/' : '';
    const key = `${id}/${prefix}${descriptor.file}`;
    if (nextImages.has(key) && nextImages.get(key).sha256 !== descriptor.sha256) {
      throw new Error('Conflicting recorded render image');
    }
    descriptor.url = `/api/reports/${id}/images/${prefix}${descriptor.file}`;
    nextImages.set(key, { path: join(directory, descriptor.file), sha256: descriptor.sha256 });
  }
}

export function createReports({ root, files = REPORT_FILES }) {
  const reports = new Map();
  const images = new Map();
  async function refresh() {
    const nextReports = new Map();
    const nextImages = new Map();
    for (const [id, label, path] of files) {
      try {
        const data = JSON.parse(await readFile(join(root, path), 'utf8'));
        if (data.schema === 'wonky.visual-comparison/1') {
          registerImages(id, path, data, root, nextImages);
        }
        const status = data.status ?? (data.accepted === false ? 'failed' : 'measured');
        nextReports.set(id, { id, label, data, status });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    reports.clear();
    for (const [id, report] of nextReports) reports.set(id, report);
    // A drawer can still reference a previous immutable generation after a
    // refresh. Registered URLs stay for this server lifetime; bytes are
    // always re-checked when served.
    for (const [file, descriptor] of nextImages) images.set(file, descriptor);
  }
  return {
    refresh,
    get: id => reports.get(id),
    list: () => [...reports.values()].map(({ data, ...metadata }) => metadata),
    image: key => images.get(key),
  };
}
