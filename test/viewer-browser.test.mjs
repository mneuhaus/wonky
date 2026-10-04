// Real browser provisioning regressions. Failure fixtures test failure handling,
// never substitute for the WebGL execution or the handedness framebuffer tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import {
  copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browserCache, playwrightModule, provisionBrowser } from '../scripts/viewer/qa/provision-browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Provision outside test timeouts on a cold checkout, as the mandatory lane does.
await provisionBrowser();

function child(script, env) {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    processChild.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
    processChild.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    processChild.once('error', reject);
    processChild.once('close', code => resolve({ code, stdout, stderr }));
  });
}

function fixture(directory) {
  for (const name of ['package.json', 'package-lock.json', 'scripts/viewer/qa/browser.mjs',
    'scripts/viewer/qa/provision-browser.mjs']) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    copyFileSync(join(root, name), join(directory, name));
  }
  const target = join(directory, 'tmp/viewer-browser', dirname(playwrightModule).split('/').at(-1));
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(dirname(playwrightModule), target, 'dir');
  return pathToFileURL(join(directory, 'scripts/viewer/qa/browser.mjs')).href;
}

test('pinned Chromium launches and executes real WebGL with clean HOME and bogus user overrides',
  { timeout: 60000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), 'wonky-browser-home-'));
    try {
      const url = new URL('../scripts/viewer/qa/browser.mjs', import.meta.url).href;
      const result = await child(`
        import { launch } from ${JSON.stringify(url)};
        const browser = await launch();
        try {
          const page = await browser.newPage();
          await page.setContent('<canvas width="4" height="4"></canvas>');
          const rgba = await page.evaluate(() => {
            const gl = document.querySelector('canvas').getContext('webgl');
            if (!gl || gl.isContextLost()) throw new Error('WebGL unavailable');
            gl.clearColor(1, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            const pixel = new Uint8Array(4);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL readback failed');
            return Array.from(pixel);
          });
          console.log(JSON.stringify({ rgba, cache: process.env.PLAYWRIGHT_BROWSERS_PATH }));
        } finally { await browser.close(); }
      `, { HOME: home, WONKY_PLAYWRIGHT: join(home, 'nonexistent/index.mjs'),
        PLAYWRIGHT_BROWSERS_PATH: join(home, 'nonexistent-browsers') });
      assert.equal(result.code, 0, result.stderr);
      const observation = JSON.parse(result.stdout.trim().split('\n').at(-1));
      assert.deepEqual(observation.rgba, [255, 0, 0, 255]);
      assert.equal(observation.cache, browserCache, 'checkout cache, not a user browser install');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

test('failed Chromium provisioning fails loudly instead of skipping browser tests',
  { timeout: 60000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'wonky-browser-failure-'));
    const server = createServer((_request, response) => {
      response.writeHead(503); response.end('deliberate browser provisioning failure');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = fixture(directory);
      const result = await child(`import { launch } from ${JSON.stringify(url)}; await launch();`, {
        HOME: directory,
        PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: `http://127.0.0.1:${server.address().port}`,
      });
      assert.notEqual(result.code, 0, 'missing mandatory browser must fail the process');
      assert.match(result.stdout + result.stderr, /503/);
      assert.match(result.stderr, /BROWSER_PROVISION_FAILED/);
      assert.match(result.stderr, /BROWSER_LAUNCH_FAILED/);
    } finally {
      await new Promise(resolve => server.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    }
  });

test('browser manifest/lock drift fails before using an installed browser', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wonky-browser-lock-'));
  try {
    const url = fixture(directory);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    manifest.devDependencies['playwright-core'] = '0.0.0';
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
    const result = await child(`import { launch } from ${JSON.stringify(url)}; await launch();`, {
      HOME: directory,
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /BROWSER_DEPENDENCY_LOCK_MISMATCH/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
