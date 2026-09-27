// Derived stable port and browser tab reuse (spec D17, D18, 10.4). Package: live-server.
//
//   derivePort(realPath, { range }) -> number     4400 + (SHA-256 of the path mod 100)
//   portRange(env) -> [low, high]                 WONKY_VIEW_PORT_RANGE="4320-4399"
//   bindServer(server, { port, preferred, range }) -> { port, derived, preferred }
//     `port` given: strict (busy -> Error "port N is in use", code EADDRINUSE);
//     otherwise `preferred`, then the next free port in the range (wrapping).
//   readSessionMarker / writeSessionMarker        tmp/viewer/sessions/<port>.json
//   waitForTab(marker, { connected, now })        should the opener be skipped?
//   openBrowser(url, { opener })                  WONKY_VIEW_OPENER replaces `open`
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_PORT_RANGE = Object.freeze([4400, 4499]);
export const TAB_REUSE_WINDOW_MS = 10 * 60 * 1000;
export const TAB_RECONNECT_WAIT_MS = 2500;

export function derivePort(realPath, { range = DEFAULT_PORT_RANGE } = {}) {
  const [low, high] = range;
  const digest = createHash('sha256').update(realPath).digest();
  return low + (digest.readUInt32BE(0) % (high - low + 1));
}

export function parsePortRange(value) {
  const match = /^\s*(\d{1,5})\s*-\s*(\d{1,5})\s*$/.exec(String(value));
  const low = Number(match?.[1]);
  const high = Number(match?.[2]);
  if (!match || low < 1 || high > 65535 || low > high) {
    throw new Error(`WONKY_VIEW_PORT_RANGE must look like 4320-4399 (got '${value}')`);
  }
  return [low, high];
}

export const portRange = (env = process.env) => (env.WONKY_VIEW_PORT_RANGE
  ? parsePortRange(env.WONKY_VIEW_PORT_RANGE)
  : [...DEFAULT_PORT_RANGE]);

function listenOnce(server, port, host) {
  return new Promise((done, fail) => {
    const onError = error => {
      server.off('listening', onListening);
      fail(error);
    };
    const onListening = () => {
      server.off('error', onError);
      done();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

const inUse = port => Object.assign(new Error(`port ${port} is in use`), { code: 'EADDRINUSE' });

// Binds `server` on 127.0.0.1. Strict when `port` is a number (0 = any free
// port, used by tests); otherwise tries `preferred` and then every other port
// of `range` in order, wrapping around.
export async function bindServer(server, {
  port, preferred, range = DEFAULT_PORT_RANGE, host = '127.0.0.1',
} = {}) {
  if (port !== undefined && port !== null) {
    try {
      await listenOnce(server, port, host);
    } catch (error) {
      throw error.code === 'EADDRINUSE' ? inUse(port) : error;
    }
    return { port: server.address().port, derived: false, preferred: port };
  }
  const [low, high] = range;
  const size = high - low + 1;
  const start = Number.isInteger(preferred) && preferred >= low && preferred <= high
    ? preferred : low;
  for (let offset = 0; offset < size; offset++) {
    const candidate = low + ((start - low + offset) % size);
    try {
      await listenOnce(server, candidate, host);
      return { port: candidate, derived: true, preferred: start };
    } catch (error) {
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
    }
  }
  throw Object.assign(new Error(`no free port in ${low}-${high}`), { code: 'EADDRINUSE' });
}

export const sessionMarkerPath = (directory, port) => join(directory, `${port}.json`);

export async function readSessionMarker(directory, port) {
  try {
    const marker = JSON.parse(await readFile(sessionMarkerPath(directory, port), 'utf8'));
    return marker?.schema === 'wonky.view-session/1' ? marker : null;
  } catch {
    return null;
  }
}

export async function writeSessionMarker(directory, port, data) {
  await mkdir(directory, { recursive: true });
  const path = sessionMarkerPath(directory, port);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ schema: 'wonky.view-session/1', port, ...data },
    null, 2) + '\n');
  await rename(temporary, path);
  return path;
}

// A tab can only come back if the previous session on this port ended less
// than 10 minutes ago and had a connected browser at shutdown.
export function tabMayReconnect(marker, now = Date.now()) {
  if (!marker?.shutdownAt) return false;
  const age = now - Date.parse(marker.shutdownAt);
  return age >= 0 && age < TAB_REUSE_WINDOW_MS && (marker.clients ?? 0) > 0;
}

// Resolves true once `connected()` reports a client, false after `waitMs`.
export function waitForReconnect(connected, { waitMs = TAB_RECONNECT_WAIT_MS, stepMs = 50 } = {}) {
  return new Promise(done => {
    const started = Date.now();
    const check = () => {
      if (connected()) done(true);
      else if (Date.now() - started >= waitMs) done(false);
      else setTimeout(check, stepMs).unref?.();
    };
    check();
  });
}

// Runs WONKY_VIEW_OPENER (a command taking the URL as its argument) or the
// platform opener. Returns the command that ran.
export function openBrowser(url, { opener = process.env.WONKY_VIEW_OPENER } = {}) {
  const command = opener
    || (process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'explorer' : 'xdg-open');
  const child = spawn(command, [url], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
  return command;
}
