// Runner hosts have Node but no package manager, and share an older node_modules.
// Install the dependency-free playwright-core tarball from our package lock into
// this checkout's tmp, then let its pinned CLI provision Chromium there too.
// Never depend on HOME, a global browser, or mutate the shared node_modules.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const dependency = lock.packages['node_modules/playwright-core'];
const version = manifest.devDependencies['playwright-core'];
if (dependency?.version !== version || !dependency.integrity?.startsWith('sha512-')
    || dependency.resolved !== `https://registry.npmjs.org/playwright-core/-/playwright-core-${version}.tgz`) {
  throw new Error('BROWSER_DEPENDENCY_LOCK_MISMATCH: lock playwright-core before running viewer tests');
}
const cache = join(root, 'tmp/viewer-browser');
const packageDir = join(cache, `playwright-core-${version}`);
export const browserCache = join(cache, 'browsers');
export const playwrightModule = join(packageDir, 'index.mjs');

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code ?? signal}`));
    });
  });
}

async function installPackage() {
  if (existsSync(playwrightModule)) return;
  mkdirSync(cache, { recursive: true });
  const staging = mkdtempSync(join(cache, 'install-'));
  try {
    console.log(`Viewer browser: downloading locked playwright-core ${version}`);
    const response = await fetch(dependency.resolved, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${dependency.resolved}`);
    const archive = Buffer.from(await response.arrayBuffer());
    const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64');
    if (integrity !== dependency.integrity) throw new Error('playwright-core tarball integrity mismatch');
    const tarball = join(staging, 'package.tgz');
    writeFileSync(tarball, archive);
    await run('tar', ['-xzf', tarball, '-C', staging]);
    const unpacked = join(staging, 'package');
    const installed = JSON.parse(readFileSync(join(unpacked, 'package.json'), 'utf8'));
    if (installed.name !== 'playwright-core' || installed.version !== version || installed.dependencies) {
      throw new Error('Unexpected playwright-core package; transitive dependencies need provisioning');
    }
    try { renameSync(unpacked, packageDir); }
    catch (error) {
      // Another lane may have installed the identical locked package meanwhile.
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code) || !existsSync(playwrightModule)) throw error;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

let provisioned;
export function provisionBrowser() {
  return provisioned ??= (async () => {
    await installPackage();
    // Always invoke the idempotent pinned installer: it verifies install markers
    // and repairs a missing browser, not just a directory left by a partial run.
    await run(process.execPath, [join(packageDir, 'cli.js'), 'install', 'chromium', '--only-shell'], {
      ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserCache,
    });
    process.env.PLAYWRIGHT_BROWSERS_PATH = browserCache;
    return playwrightModule;
  })().catch(cause => {
    throw new Error('BROWSER_PROVISION_FAILED: viewer tests require pinned Chromium; no skips', { cause });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await provisionBrowser();
}
