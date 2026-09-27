#!/usr/bin/env node
// Start and stop a private viewer instance for browser QA.
//
//   node scripts/viewer/qa/serve.mjs start --port 4350 [--reviews DIR] [--entry bin/x.mjs]
//     [model.brep.json ...]
//   node scripts/viewer/qa/serve.mjs stop --port 4350
//   node scripts/viewer/qa/serve.mjs status --port 4350
//
// Ports are limited to 4320-4399; 4310 and 4311 are Marc's viewers and are
// never touched. Without models it serves the QA fixtures from
// tmp/viewer/fixtures/ (build them with qa/fixtures.mjs). Every start gets a
// fresh private reviews directory under tmp/viewer/qa/reviews/ unless
// --reviews is given. The instance runs detached; its pid and log live in
// tmp/viewer/qa/serve-<port>.{json,log}.
//
// As a module: `const viewer = await startViewer({port}); ...; await viewer.stop();`
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const stateDirectory = join(root, 'tmp/viewer/qa');

export const defaultModels = () => {
  const fixtures = join(root, 'tmp/viewer/fixtures');
  const names = [
    'compare-before', 'compare-after', 'bracket', 'bored-spacer', 'conical-spacer',
    'arc-slot', 'cross-bore', 'pocket-plate',
  ];
  const paths = names.map(name => join(fixtures, name + '.brep.json')).filter(existsSync);
  const large = join(root, 'out/r10b-retained.brep.json');
  if (existsSync(large)) paths.push(large);
  return paths;
};

export function checkPort(port) {
  if (!Number.isInteger(port) || port < 4320 || port > 4399) {
    throw new Error(`QA ports must be in 4320-4399 (got ${port})`);
  }
}

const statePath = port => join(stateDirectory, `serve-${port}.json`);

async function waitForServer(url, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`viewer exited with ${child.exitCode}`);
    try {
      const response = await fetch(url + 'api/workspace');
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error(`viewer at ${url} did not answer within ${timeoutMs} ms`);
}

export async function startViewer({
  port,
  models = defaultModels(),
  reviews,
  entry = 'bin/wonky-view.mjs',
  extraArgs = [],
  timeoutMs = 180000,
} = {}) {
  checkPort(port);
  mkdirSync(stateDirectory, { recursive: true });
  const privateDirectory = join(stateDirectory, 'reviews', `${port}-${Date.now()}`);
  const reviewDirectory = resolve(reviews ?? privateDirectory);
  mkdirSync(reviewDirectory, { recursive: true });
  const logPath = join(stateDirectory, `serve-${port}.log`);
  const log = openSync(logPath, 'w');
  const args = [resolve(root, entry), ...models, '--port', String(port)];
  args.push('--reviews', reviewDirectory, ...extraArgs);
  const child = spawn('nice', ['-n', '5', process.execPath, ...args], {
    cwd: root, detached: true, stdio: ['ignore', log, log],
  });
  child.unref();
  const url = `http://127.0.0.1:${port}/`;
  const record = { pid: child.pid, port, url, reviewDirectory, logPath, entry, models };
  writeFileSync(statePath(port), JSON.stringify(record, null, 2) + '\n');
  try {
    await waitForServer(url, timeoutMs, child);
  } catch (error) {
    stopViewer(port);
    throw new Error(`${error.message}\n${readFileSync(logPath, 'utf8')}`);
  }
  return { ...record, viewerUrl: url + 'viewer/', stop: () => stopViewer(port) };
}

export function stopViewer(port) {
  checkPort(port);
  const path = statePath(port);
  if (!existsSync(path)) return false;
  const { pid } = JSON.parse(readFileSync(path, 'utf8'));
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  rmSync(path, { force: true });
  return true;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const models = [];
  let port;
  let reviews;
  let entry;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--port') port = Number(rest[++i]);
    else if (rest[i] === '--reviews') reviews = rest[++i];
    else if (rest[i] === '--entry') entry = rest[++i];
    else models.push(resolve(rest[i]));
  }
  if (command === 'start') {
    const viewer = await startViewer({
      port, reviews, ...(entry ? { entry } : {}), ...(models.length ? { models } : {}),
    });
    console.log(`${viewer.viewerUrl}\nreviews ${viewer.reviewDirectory}\nlog ${viewer.logPath}`);
  } else if (command === 'stop') {
    console.log(stopViewer(port) ? `stopped ${port}` : `no QA viewer recorded on ${port}`);
  } else if (command === 'status') {
    checkPort(port);
    console.log(existsSync(statePath(port)) ? readFileSync(statePath(port), 'utf8') : 'stopped');
  } else {
    console.error('Usage: serve.mjs start|stop|status --port <4320-4399> [...]');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`serve: ${error.message}`);
    process.exitCode = 1;
  });
}
