import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const cadbenchRoot = fileURLToPath(new URL('../', import.meta.url));
export const cadbenchFixtures = join(cadbenchRoot, 'fixtures/cadbench');
export const sha256 = data => createHash('sha256').update(data).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

export function fixturePath(base, path) {
  const full = resolve(base, path);
  if (isAbsolute(path) || !full.startsWith(resolve(base) + sep)) throw new Error(`Invalid CADBench fixture path: ${path}`);
  return full;
}

export function verifyCadbenchFixtures(base = cadbenchFixtures) {
  const provenance = readJson(join(base, 'provenance.json'));
  if (provenance.schema !== 'wonky-cadbench-provenance/1' || provenance.license !== 'Apache-2.0')
    throw new Error('Unsupported CADBench provenance');
  for (const file of provenance.files) {
    if (sha256(readFileSync(fixturePath(base, file.path))) !== file.sha256)
      throw new Error(`CADBench fixture SHA-256 mismatch: ${file.path}`);
  }
  const corpus = readJson(join(base, 'upstream/public-corpus.json'));
  const policy = readJson(join(base, 'upstream/benchmark-v2.json'));
  const pilot = readJson(join(base, 'pilot.json'));
  if (pilot.schema !== 'wonky-cadbench-pilot/1' || policy.tag !== 'v2' || corpus.length !== policy.task_count)
    throw new Error('CADBench corpus/version/count mismatch');
  const ids = corpus.map(row => row.id), officialIds = Object.keys(policy.task_digests);
  if (new Set(ids).size !== ids.length || officialIds.length !== ids.length ||
      ids.some(id => !Object.hasOwn(policy.task_digests, `gnucleus-ai/freecad-${id}`)))
    throw new Error('Public corpus does not match the complete pinned official task inventory');
  if (!pilot.cases.length || new Set(pilot.cases.map(row => row.id)).size !== pilot.cases.length)
    throw new Error('CADBench pilot case IDs must be nonempty and unique');
  for (const row of pilot.cases) {
    if (!/^[a-z0-9-]+$/.test(row.id) || !ids.includes(row.upstreamId)) throw new Error('Invalid CADBench pilot case');
    if (sha256(readFileSync(fixturePath(base, row.source))) !== row.sourceSha256)
      throw new Error(`CADBench adapted source SHA-256 mismatch: ${row.source}`);
  }
  return { provenance, corpus, policy, pilot };
}

// Optional network verification only. Normal benchmark/test runs use the frozen
// metadata and never fetch references, run an agent, or upload anything.
export async function verifyCadbenchUpstream(out = join(cadbenchRoot, 'out/cadbench/upstream-verification')) {
  const { provenance } = verifyCadbenchFixtures();
  mkdirSync(out, { recursive: true });
  const files = [...provenance.files.filter(file => file.url), {
    path: 'dataset.parquet', url: provenance.dataset.parquetUrl, sha256: provenance.dataset.parquetSha256,
  }];
  const verified = [];
  for (const file of files) {
    const response = await fetch(file.url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`CADBench upstream HTTP ${response.status}: ${file.url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== file.sha256) throw new Error(`CADBench upstream SHA-256 mismatch: ${file.url}`);
    const path = fixturePath(out, file.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
    verified.push({ url: file.url, sha256: file.sha256, bytes: bytes.length });
  }
  const extraction = spawnSync('uv', ['run', '--with', 'pyarrow==21.0.0', 'python', '-c',
    'import json,sys; import pyarrow.parquet as pq; json.dump(pq.read_table(sys.argv[1], columns=["id","name","description","key_parameters","fcstd_path","viewer_url"]).to_pylist(), sys.stdout, indent=2, ensure_ascii=False); sys.stdout.write("\\n")',
    join(out, 'dataset.parquet')], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (extraction.status !== 0) throw new Error(`CADBench metadata extraction failed: ${extraction.error?.message ?? extraction.stderr}`);
  const expected = provenance.files.find(file => file.path === 'upstream/public-corpus.json').sha256;
  if (sha256(extraction.stdout) !== expected) throw new Error('Pinned Parquet extraction differs from public-corpus.json');
  writeFileSync(join(out, 'public-corpus.json'), extraction.stdout);
  const report = { schema: 'wonky-cadbench-upstream-verification/1', verifiedAt: new Date().toISOString(),
    files: verified, metadataSha256: expected, metadataRows: JSON.parse(extraction.stdout).length };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (!args.length) {
      const { corpus, pilot } = verifyCadbenchFixtures();
      console.log(`CADBench source hashes verified: ${corpus.length} public rows, ${pilot.cases.length} local adaptations.`);
    } else if (args.length === 1 && args[0] === '--verify-upstream') {
      const report = await verifyCadbenchUpstream();
      console.log(`Pinned upstream files and all ${report.metadataRows} extracted metadata rows verified.`);
    } else throw new Error('Usage: node scripts/cadbench-sources.mjs [--verify-upstream]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
