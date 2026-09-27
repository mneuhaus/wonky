// Model revision registry (frozen read API: get, list, scene, model, sources,
// archive, onRevision).
//
// A revision is identified by the SHA-256 of its exact .brep.json bytes.
// Registration is serialized through one queue. A new input revision is
// validated (geometry inspector) and fully display-prepared before it is
// archived or published (SRV-02, SRV-03). Archived snapshots found at startup
// are hash- and inspector-validated at once, but their display scene is
// prepared lazily on first request; their workspace entry gains `bounds`
// once prepared.
//
// Live revisions (live-server, spec 10.4) arrive fully prepared from the build
// worker (scene JSON, draw payload) through registerLive(). They are not
// archived at registration (D7): they live in a byte-bounded revision ring.
// Over the display budget, unpinned revisions drop their scene and draw
// payload (rebuilt on demand); over the model budget, unpinned revisions
// leave memory for the session spool (<state>/spool/<session>/<id>.brep.json),
// from which archive(), bytes(), model() and review saves still work. Pins
// come from clients (/api/live/pins) and from the sessions (current revision).
import { readFile, readdir, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { reviewScene } from '../review-scene.mjs';
import { createGeometryInspector } from '../geometry-summary.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const snapshotPattern = /^[a-f0-9]{64}\.brep\.json$/;
const MiB = 1024 * 1024;

export const inputLabel = path => basename(path).replace(/\.brep\.json$/, '');

const toBuffer = bytes => (Buffer.isBuffer(bytes)
  ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));

const drawSize = draw => {
  if (!draw) return 0;
  const buffer = draw.buffer?.byteLength ?? 0;
  return buffer + Buffer.byteLength(JSON.stringify(draw.header ?? null));
};

// Byte-bounded LRU of live revisions. Map order is the recency order (oldest
// first); touch() moves an entry to the end. enforce() is serialized.
export function createRevisionRing({
  displayBudgetBytes = 512 * MiB,
  modelBudgetBytes = 256 * MiB,
  isPinned = () => false,
  spool = async () => {
    throw new Error('No spool configured');
  },
  onDisplayDropped = () => {},
  onSpooled = () => {},
} = {}) {
  const entries = new Map();
  let running = Promise.resolve();

  const displayBytes = () => [...entries.values()]
    .reduce((total, entry) => total + entry.sceneBytes + entry.drawBytes, 0);
  const modelBytes = () => [...entries.values()]
    .reduce((total, entry) => total + (entry.bytes?.length ?? 0), 0);

  const dropDisplay = entry => {
    entry.sceneText = null;
    entry.sceneBytes = 0;
    entry.draw = null;
    entry.drawBytes = 0;
  };

  async function enforceNow() {
    let display = displayBytes();
    for (const entry of entries.values()) {
      if (display <= displayBudgetBytes) break;
      if (!entry.sceneBytes && !entry.drawBytes) continue;
      if (isPinned(entry.id)) continue;
      display -= entry.sceneBytes + entry.drawBytes;
      dropDisplay(entry);
      onDisplayDropped(entry.id);
    }
    let models = modelBytes();
    for (const entry of [...entries.values()]) {
      if (models <= modelBudgetBytes) break;
      if (entry.spooled || !entry.bytes || isPinned(entry.id)) continue;
      const bytes = entry.bytes;
      entry.spoolPath = await spool(entry.id, bytes);
      if (isPinned(entry.id) || entry.bytes !== bytes) continue;
      models -= bytes.length;
      entry.bytes = null;
      entry.spooled = true;
      dropDisplay(entry);
      onSpooled(entry.id);
    }
  }

  const ring = {
    add({ id, bytes, sceneText = null, sceneBytes, draw = null }) {
      entries.delete(id);
      const entry = {
        id, bytes, sceneText, draw,
        sceneBytes: sceneText ? sceneBytes ?? Buffer.byteLength(sceneText) : 0,
        drawBytes: drawSize(draw),
        spooled: false, spoolPath: null, archived: false,
      };
      entries.set(id, entry);
      return entry;
    },
    get: id => entries.get(id),
    has: id => entries.has(id),
    touch(id) {
      const entry = entries.get(id);
      if (!entry) return null;
      entries.delete(id);
      entries.set(id, entry);
      return entry;
    },
    setDisplay(id, { sceneText, sceneBytes, draw }) {
      const entry = entries.get(id);
      if (!entry) return;
      if (sceneText !== undefined) {
        entry.sceneText = sceneText;
        entry.sceneBytes = sceneText ? sceneBytes ?? Buffer.byteLength(sceneText) : 0;
      }
      if (draw !== undefined) {
        entry.draw = draw;
        entry.drawBytes = drawSize(draw);
      }
    },
    restore(id, bytes) {
      const entry = ring.touch(id);
      if (!entry) return null;
      entry.bytes = bytes;
      entry.spooled = false;
      return entry;
    },
    enforce() {
      running = running.then(enforceNow, enforceNow);
      return running;
    },
    ids: () => [...entries.keys()],
    stats: () => {
      const values = [...entries.values()];
      return {
        revisions: values.length,
        inMemory: values.filter(entry => entry.bytes).length,
        withDisplay: values.filter(entry => entry.sceneBytes || entry.drawBytes).length,
        spooled: values.filter(entry => entry.spooled).length,
        pinned: values.filter(entry => isPinned(entry.id)).length,
        displayBytes: displayBytes(),
        modelBytes: modelBytes(),
        displayBudgetBytes,
        modelBudgetBytes,
      };
    },
  };
  return ring;
}

export function createRegistry({
  reviewDirectory,
  sources,
  spoolDirectory = join(tmpdir(), `wonky-view-spool-${randomBytes(4).toString('hex')}`),
  ring: ringOptions = {},
  log = () => {},
}) {
  const snapshotDirectory = join(reviewDirectory, 'models');
  const models = new Map();
  const inspectors = new Map();
  const scenes = new Map();
  const lazyScenes = new Map();
  const listeners = new Set();
  const clientPins = new Map();
  const serverPins = new Map();
  let sourcesProvider = () => [];
  let sceneBuilder = null;
  let queue = Promise.resolve();

  const isPinned = id => [...clientPins.values(), ...serverPins.values()]
    .some(set => set.has(id));

  // Raw models by id. A spooled live revision is read back on demand, so the
  // reviews module (which reads this Map directly) keeps working for it.
  class RevisionModels extends Map {
    get(id) {
      return super.get(id) ?? rehydrate(id)?.model;
    }
  }
  const rawModels = new RevisionModels();

  const spoolPath = id => join(spoolDirectory, `${id}.brep.json`);
  const ring = createRevisionRing({
    ...ringOptions,
    isPinned,
    async spool(id, bytes) {
      const path = spoolPath(id);
      await mkdir(spoolDirectory, { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, path);
      return path;
    },
    onSpooled(id) {
      Map.prototype.delete.call(rawModels, id);
      inspectors.delete(id);
    },
  });
  const enforce = () => ring.enforce().catch(error => log(`revision ring: ${error.message}`));

  // Synchronous read-back of a spooled revision (rare: it was evicted as the
  // least recently used unpinned revision over the model budget).
  function rehydrate(id) {
    const entry = ring.get(id);
    if (!entry?.spooled) return null;
    const bytes = readFileSync(entry.spoolPath);
    if (sha256(bytes) !== id) throw new Error(`Spooled model hash mismatch: ${entry.spoolPath}`);
    const model = JSON.parse(bytes);
    const inspector = createGeometryInspector(model, { modelBytes: bytes, modelId: id });
    Map.prototype.set.call(rawModels, id, model);
    inspectors.set(id, inspector);
    ring.restore(id, bytes);
    enforce();
    return { model, inspector };
  }

  // Geometry inspector of any known revision; live ones are created lazily
  // (tens of milliseconds for r10b-sized models, kept off the build path).
  function inspectorOf(id) {
    if (inspectors.has(id)) return inspectors.get(id);
    const entry = ring.get(id);
    if (!entry) return undefined;
    if (entry.spooled) return rehydrate(id)?.inspector;
    const inspector = createGeometryInspector(Map.prototype.get.call(rawModels, id),
      { modelBytes: entry.bytes, modelId: id });
    inspectors.set(id, inspector);
    return inspector;
  }

  const enqueue = task => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  const snapshotPath = id => join(snapshotDirectory, `${id}.brep.json`);

  async function writeSnapshot(id, bytes) {
    const snapshot = snapshotPath(id);
    try {
      await writeFile(snapshot, bytes, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (sha256(await readFile(snapshot)) !== id) {
        throw new Error(`Stored model snapshot hash mismatch: ${snapshot}`);
      }
    }
    return snapshot;
  }

  // `inspect: false` (live revisions): the build worker already ran the
  // geometry inspector on these exact bytes; it is created here on first use.
  function parse(bytes, { inspect = true } = {}) {
    const id = sha256(bytes);
    const model = JSON.parse(bytes);
    if (model.schema !== 'wonky-brep/1' || !Array.isArray(model.bodies) || !model.bodies.length) {
      throw new Error('Expected a nonempty wonky-brep/1 model');
    }
    const inspector = inspect
      ? createGeometryInspector(model, { modelBytes: bytes, modelId: id }) : null;
    const metadata = {
      id, label: undefined, sha256: id, sourcePath: undefined,
      bodyCount: model.bodies.length,
      faceCount: model.bodies.reduce((count, body) => count + body.faces.length, 0),
    };
    return { id, model, inspector, metadata };
  }

  function publish({ id, model, inspector, metadata }, scene, prepared) {
    models.set(id, metadata);
    rawModels.set(id, model);
    if (inspector) inspectors.set(id, inspector);
    if (scene) scenes.set(id, scene);
    if (prepared) sources.commit(prepared);
    for (const listener of [...listeners]) listener(metadata);
  }

  // Full registration of an input revision: nothing is published or archived
  // unless validation and display preparation both succeed.
  async function registerNow(bytes, label, sourcePath) {
    const parsed = parse(bytes);
    parsed.metadata.label = label;
    parsed.metadata.sourcePath = sourcePath;
    const scene = await reviewScene(parsed.model, parsed.metadata);
    parsed.metadata.bounds = scene.bounds;
    const prepared = await sources.prepare(parsed.model);
    await writeSnapshot(parsed.id, bytes);
    publish(parsed, scene, prepared);
    return parsed.metadata;
  }

  // An archived snapshot: validated now, displayed on demand.
  async function registerArchivedNow(bytes, label, sourcePath) {
    const parsed = parse(bytes);
    parsed.metadata.label = label;
    parsed.metadata.sourcePath = sourcePath;
    const prepared = await sources.prepare(parsed.model);
    lazyScenes.set(parsed.id, stripBounds(parsed.metadata));
    publish(parsed, null, prepared);
    return parsed.metadata;
  }

  const mergeLive = (metadata, live) => {
    const previous = metadata.live ?? {};
    const revisions = [...new Set([...(previous.revisions ?? []), live.revision])]
      .sort((a, b) => a - b);
    metadata.live = {
      ...previous, ...live, revision: Math.max(live.revision, previous.revision ?? -1), revisions,
      previousSession: revisions.every(revision => revision === 0),
    };
  };

  // A live revision prepared by the build worker. The scene and draw payload
  // came from the worker; the event loop only hashes, parses, runs the
  // inspector and freezes the source from the exact built bytes.
  async function registerLiveNow({
    bytes, sceneText = null, sceneBytes, bounds, draw = null, label, sourcePath,
    frozen = new Map(), live,
  }) {
    const buffer = toBuffer(bytes);
    const id = sha256(buffer);
    const existing = models.get(id);
    if (existing) {
      if (live) mergeLive(existing, live);
      const entry = ring.touch(id);
      if (entry && !entry.sceneBytes && sceneText) {
        ring.setDisplay(id, { sceneText, sceneBytes, draw });
      }
      if (!existing.sourcePath) existing.sourcePath = sourcePath;
      if (frozen.size) sources.commit(await sources.prepare(rawModels.get(id), { frozen }));
      enforce();
      return { metadata: existing, created: false };
    }
    const parsed = parse(buffer, { inspect: false });
    parsed.metadata.label = label;
    parsed.metadata.sourcePath = sourcePath;
    parsed.metadata.bounds = bounds;
    if (live) {
      parsed.metadata.live = {
        ...live, revisions: [live.revision], previousSession: Boolean(live.previousSession),
      };
    }
    const prepared = await sources.prepare(parsed.model, { frozen });
    ring.add({ id, bytes: buffer, sceneText, sceneBytes, draw });
    publish(parsed, null, prepared);
    enforce();
    return { metadata: parsed.metadata, created: true };
  }

  const baseMetadata = id => {
    const { bounds, live, ...rest } = models.get(id);
    return rest;
  };

  const preparing = new Map();
  async function rebuildLiveScene(id) {
    if (!preparing.has(id)) {
      const run = (async () => {
        const text = sceneBuilder
          ? await sceneBuilder(id, baseMetadata(id))
          : JSON.stringify(await reviewScene(rawModels.get(id), baseMetadata(id)));
        ring.setDisplay(id, { sceneText: text });
        enforce();
        return text;
      })().finally(() => preparing.delete(id));
      preparing.set(id, run);
    }
    return JSON.parse(await preparing.get(id));
  }

  // The last two parsed live scenes, so repeated requests parse once.
  const parsedScenes = new Map();
  const parsedScene = (id, text) => {
    const hit = parsedScenes.get(id);
    if (hit?.text === text) return hit.scene;
    const value = JSON.parse(text);
    parsedScenes.delete(id);
    parsedScenes.set(id, { text, scene: value });
    while (parsedScenes.size > 2) parsedScenes.delete(parsedScenes.keys().next().value);
    return value;
  };

  async function scene(id) {
    if (scenes.has(id)) return scenes.get(id);
    const entry = ring.touch(id);
    if (entry) {
      if (entry.sceneText) return parsedScene(id, entry.sceneText);
      return rebuildLiveScene(id);
    }
    if (!lazyScenes.has(id)) throw new Error('Unknown model revision');
    if (!preparing.has(id)) {
      const run = reviewScene(rawModels.get(id), lazyScenes.get(id)).then(prepared => {
        scenes.set(id, prepared);
        lazyScenes.delete(id);
        models.get(id).bounds = prepared.bounds;
        return prepared;
      }).finally(() => preparing.delete(id));
      preparing.set(id, run);
    }
    return preparing.get(id);
  }

  // Exact bytes of any known revision (live: memory or spool; else snapshot).
  async function bytesOf(id) {
    if (!models.has(id)) throw new Error('Unknown model revision');
    const entry = ring.get(id);
    const bytes = entry
      ? entry.bytes ?? await readFile(entry.spoolPath)
      : await readFile(snapshotPath(id));
    if (sha256(bytes) !== id) throw new Error(`Model bytes hash mismatch for ${id}`);
    return bytes;
  }

  return {
    snapshotDirectory,
    spoolDirectory,
    models,
    rawModels,
    inspectors,
    async init() {
      await mkdir(snapshotDirectory, { recursive: true });
      await mkdir(sources.directory, { recursive: true });
    },
    register: (bytes, label, sourcePath) => enqueue(() => registerNow(bytes, label, sourcePath)),
    // Registers `bytes` unless that exact revision is already known.
    registerIfNew: (bytes, label, sourcePath) => enqueue(() => (models.has(sha256(bytes))
      ? models.get(sha256(bytes)) : registerNow(bytes, label, sourcePath))),
    registerLive: options => enqueue(() => registerLiveNow(options)),
    // Loads every <reviews>/models/<sha>.brep.json not registered yet. A
    // corrupt or invalid snapshot fails with its path and is left untouched.
    loadArchive: () => enqueue(async () => {
      for (const file of await readdir(snapshotDirectory)) {
        if (!snapshotPattern.test(file)) continue;
        const id = file.slice(0, 64);
        if (models.has(id)) continue;
        const snapshot = join(snapshotDirectory, file);
        try {
          const bytes = await readFile(snapshot);
          if (sha256(bytes) !== id) throw new Error('Stored model snapshot hash mismatch');
          await registerArchivedNow(bytes, `Saved revision ${id.slice(0, 8)}`, snapshot);
        } catch (error) {
          throw new Error(`Cannot load archived model snapshot ${snapshot}: ${error.message}`,
            { cause: error });
        }
      }
    }),
    get: id => models.get(id),
    list: () => [...models.values()],
    has: id => models.has(id),
    model: id => rawModels.get(id),
    inspector: inspectorOf,
    scene,
    // Compact JSON text of a live revision's scene as the build worker wrote
    // it (sendable without a parse/stringify round trip), else null.
    sceneText: id => ring.touch(id)?.sceneText ?? null,
    bytes: bytesOf,
    // Precomputed binary draw payload of a live revision (render-transport).
    drawPayload: id => ring.get(id)?.draw ?? null,
    // Live sources (live-server); a .brep.json session has none.
    sources: () => sourcesProvider(),
    attachSources(provider) {
      sourcesProvider = provider;
    },
    // Rebuilds an evicted live scene as JSON text (the query worker in a
    // server; in-process without one).
    setSceneBuilder(builder) {
      sceneBuilder = builder;
    },
    snapshotPath,
    // Path of the immutable archived snapshot; idempotent. Live revisions are
    // archived from memory or from the session spool.
    async archive(id) {
      if (!models.has(id)) throw new Error('Unknown model revision');
      const entry = ring.get(id);
      if (entry) {
        const path = await writeSnapshot(id, await bytesOf(id));
        entry.archived = true;
        return path;
      }
      const path = snapshotPath(id);
      const bytes = await readFile(path);
      if (sha256(bytes) !== id) throw new Error(`Stored model snapshot hash mismatch: ${path}`);
      return path;
    },
    isLive: id => ring.has(id),
    // Client pins replace that client's set; server pins are keyed (a source).
    pin(clientId, ids) {
      const known = ids.filter(id => models.has(id));
      clientPins.set(clientId, new Set(known));
      enforce();
      return known;
    },
    unpin(clientId) {
      clientPins.delete(clientId);
      enforce();
    },
    setServerPins(key, ids) {
      serverPins.set(key, new Set(ids));
      enforce();
    },
    pinned: id => isPinned(id),
    ringStats: () => ({ ...ring.stats(), clients: clientPins.size }),
    enforceRing: () => ring.enforce(),
    onRevision(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      await rm(spoolDirectory, { recursive: true, force: true });
    },
  };
}

const stripBounds = metadata => {
  const { bounds, ...rest } = metadata;
  return rest;
};
