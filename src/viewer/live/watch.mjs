// Watch set, parent-directory fs.watch, 75 ms debounce, combined content hash.
// Package: live-server.
//
//   const set = await readWatchSet(paths)       -> { hash, bytes: Map<path, Buffer|null> }
//   const watcher = watchSources(paths, { debounceMs, initialHash, onChange, onError })
//     onChange(hash, bytesByPath, changedPaths) runs only when the combined hash changed;
//     `bytesByPath` holds exactly the bytes that were hashed (they go to the worker).
//   watcher.update(paths)   re-arm on a new set (a manifest listing other files)
//   watcher.update(paths, { adopt })   same, where `adopt` maps newly added
//                           paths to the SHA-256 a build already read (null:
//                           absent); a new file whose bytes still match is part
//                           of the baseline, not a change (Python imports)
//   watcher.close()         closes every fs.watch handle and polling fallback
//
// Editors save by writing a temporary file and renaming it over the target,
// so the parent directory is watched and events are filtered by file name.
// Each existing file is watched directly as well: on macOS a directory watch
// goes through FSEvents, which delivers late and coalesced under load, while
// a file watch (kqueue) fires at once. A file watch ends with its inode on a
// rename and is re-armed after the next scan. A directory watcher that errors
// falls back to fs.watchFile polling (500 ms).
// While the first path (the source) is missing or empty, a scan retries
// briefly (10 × 100 ms) instead of reporting a change: atomic saves leave it
// absent for a moment, and truncate-then-write saves leave it empty (fix
// round 3: the empty moment was built as a FAILED revision). A source that
// stays empty is reported after the retries.
import { watch, watchFile, unwatchFile } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname } from 'node:path';

const sha256 = value => createHash('sha256').update(value).digest('hex');

export function combinedHash(bytesByPath) {
  const hash = createHash('sha256');
  for (const path of [...bytesByPath.keys()].sort()) {
    const bytes = bytesByPath.get(path);
    hash.update(`${path}\0${bytes ? sha256(bytes) : 'missing'}\n`);
  }
  return hash.digest('hex');
}

export async function readWatchSet(paths) {
  const bytes = new Map();
  await Promise.all(paths.map(async path => {
    try {
      bytes.set(path, await readFile(path));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      bytes.set(path, null);
    }
  }));
  const ordered = new Map(paths.map(path => [path, bytes.get(path)]));
  return { hash: combinedHash(ordered), bytes: ordered };
}

export function watchSources(paths, {
  debounceMs = 75,
  pollMs = 500,
  initialHash = null,
  initialBytes = null,
  missingRetries = 10,
  missingRetryMs = 100,
  onChange = () => {},
  onError = () => {},
  watchImpl = watch,
} = {}) {
  let current = [...paths];
  let lastHash = initialHash;
  let lastBytes = initialBytes;
  let timer = null;
  let scanning = false;
  let rescan = false;
  let adopt = null;
  let closed = false;
  let missingCount = 0;
  const directories = new Map();
  const files = new Map();
  const polled = new Set();

  const names = () => new Set(current.map(path => basename(path)));

  // A file event scans `debounceMs` after the first event of a burst. Later
  // events of the burst do not push the scan back: the directory watcher
  // repeats the file watcher's event late, and a sliding window would merge
  // two saves 100 ms apart into one build. A scan that is already running
  // rescans once it is done, so nothing is lost either way.
  const onEvent = () => {
    if (closed || timer) return;
    timer = setTimeout(scan, debounceMs);
  };

  const schedule = delay => {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(scan, delay);
  };

  async function scan() {
    timer = null;
    if (closed) return;
    if (scanning) {
      rescan = true;
      return;
    }
    scanning = true;
    try {
      const set = await readWatchSet(current);
      if (closed) return;
      const source = set.bytes.get(current[0]);
      if ((source === null || source?.length === 0) && missingCount < missingRetries) {
        missingCount++;
        schedule(missingRetryMs);
        return;
      }
      missingCount = 0;
      armFiles();
      if (set.hash === lastHash) return;
      const previous = lastBytes;
      const adopted = adopt;
      adopt = null;
      const changed = previous ? current.filter(path => {
        const after = set.bytes.get(path);
        if (!previous.has(path) && adopted?.has(path)) {
          return adopted.get(path) !== (after ? sha256(after) : null);
        }
        const before = previous.get(path);
        if (!before || !after) return before !== after;
        return !before.equals(after);
      }) : [...current];
      lastHash = set.hash;
      lastBytes = set.bytes;
      if (changed.length) onChange(set.hash, set.bytes, changed);
    } catch (error) {
      onError(error);
    } finally {
      scanning = false;
      if (rescan && !closed) {
        rescan = false;
        onEvent();
      }
    }
  }

  const poll = path => {
    if (polled.has(path)) return;
    polled.add(path);
    watchFile(path, { interval: pollMs, persistent: true }, onEvent);
  };

  function armFiles() {
    for (const [path, handle] of files) {
      if (current.includes(path)) continue;
      handle.close();
      files.delete(path);
    }
    for (const path of current) {
      if (files.has(path) || polled.has(path)) continue;
      try {
        const handle = watchImpl(path, { persistent: true }, event => {
          onEvent();
          if (event !== 'rename') return;
          handle.close();
          if (files.get(path) === handle) files.delete(path);
        });
        handle.on('error', () => {
          handle.close();
          if (files.get(path) === handle) files.delete(path);
        });
        files.set(path, handle);
      } catch {
        // Missing or unwatchable: the directory watcher still covers it.
      }
    }
  }

  function arm() {
    const wanted = new Set(current.map(path => dirname(path)));
    for (const [directory, handle] of directories) {
      if (wanted.has(directory)) continue;
      handle?.close();
      directories.delete(directory);
    }
    for (const path of [...polled]) {
      if (current.includes(path)) continue;
      unwatchFile(path);
      polled.delete(path);
    }
    for (const directory of wanted) {
      if (directories.has(directory)) continue;
      try {
        const handle = watchImpl(directory, { persistent: true }, (_event, name) => {
          if (!name || names().has(String(name))) onEvent();
        });
        handle.on('error', error => {
          handle.close();
          directories.set(directory, null);
          onError(error);
          for (const path of current) if (dirname(path) === directory) poll(path);
        });
        directories.set(directory, handle);
      } catch (error) {
        directories.set(directory, null);
        onError(error);
        for (const path of current) if (dirname(path) === directory) poll(path);
      }
    }
    armFiles();
  }

  arm();
  return {
    get paths() {
      return [...current];
    },
    get hash() {
      return lastHash;
    },
    // The bytes of the last scan (the baseline), by path.
    get bytes() {
      return lastBytes;
    },
    // Number of open OS resources (directory and file watchers, polled files).
    handles: () => [...directories.values()].filter(Boolean).length + files.size + polled.size,
    update(paths, { adopt: known = null } = {}) {
      current = [...paths];
      adopt = known;
      arm();
      schedule(0);
    },
    // Forces a scan now (manual rebuild reads the current bytes this way).
    scanNow: () => scan(),
    close() {
      closed = true;
      clearTimeout(timer);
      for (const handle of directories.values()) handle?.close();
      directories.clear();
      for (const handle of files.values()) handle.close();
      files.clear();
      for (const path of polled) unwatchFile(path);
      polled.clear();
    },
  };
}
