// Scene cache (spec 7.2): one LRU entry per model id holding
//
//   model   the draw model decoded from GET /api/models/:id/draw (rendering,
//           picking and hover use only this once it is loaded)
//   scene   the JSON display scene, loaded on demand for the inspector
//           (identity, source, edgeIndices); `scenes` below is its
//           Map-compatible view (state.scenes, which VS fills directly)
//   gpu     the renderer's buffers for the model (null until uploaded)
//
// A model id with only a JSON scene is drawn and picked through the
// JSON-scene adapter (sceneDrawModel) until its draw model arrives.
//
// Pins keep entries: pin sources are evaluated at eviction time (the
// renderer registers the displayed, compare and selection models; features
// add ghost and annotated revisions with pin(owner, ids)). Unpinned entries
// are evicted least recently used first when there are more than
// `maxUnpinned` of them or the GPU total exceeds `maxGpuBytes`; evicting
// releases the GPU buffers (listeners) and drops the typed arrays and the
// JSON scene. Pinned entries keep their typed arrays, so the renderer can
// rebuild every buffer after `webglcontextrestored`.
import { decodeDrawPayload, drawModel, sceneDrawModel } from './draw-decode.js';

export const MAX_UNPINNED = 8;
export const MAX_GPU_BYTES = 256 * 1024 * 1024;

const owners = new WeakMap();
const adapters = new WeakMap();

// The cache behind a `scenes` map (the picker reaches it through state.scenes).
export const cacheOf = scenes => owners.get(scenes) ?? null;

// JSON-scene adapter, built once per scene object.
export function adapterFor(scene) {
  if (!scene) return null;
  if (!adapters.has(scene)) adapters.set(scene, sceneDrawModel(scene));
  return adapters.get(scene);
}

class SceneMap extends Map {
  constructor(hooks) {
    super();
    this.hooks = hooks;
  }

  set(id, scene) {
    super.set(id, scene);
    this.hooks?.adopt(id, scene);
    return this;
  }

  delete(id) {
    const existed = super.delete(id);
    if (existed) this.hooks?.forget(id);
    return existed;
  }

  clear() {
    for (const id of [...this.keys()]) this.delete(id);
  }

  // Removes a JSON scene without notifying the cache (eviction).
  drop(id) {
    return super.delete(id);
  }
}

async function failure(response) {
  const data = await response.json().catch(() => ({}));
  const error = new Error(data.error || `Request failed (${response.status})`);
  error.status = response.status;
  return error;
}

export function createSceneCache({
  maxUnpinned = MAX_UNPINNED, maxGpuBytes = MAX_GPU_BYTES,
} = {}) {
  const entries = new Map();
  const pins = new Map();
  const pinSources = new Map();
  const listeners = { model: new Set(), evict: new Set() };
  const counters = { evictions: 0, drawLoads: 0, sceneLoads: 0 };
  let fetcher = null;
  let clock = 0;

  const entry = id => {
    if (!entries.has(id)) {
      entries.set(id, {
        id, model: null, gpu: null, gpuBytes: 0, used: 0, drawLoading: null,
        sceneLoading: null, drawError: null,
      });
    }
    return entries.get(id);
  };
  const touch = id => {
    entry(id).used = ++clock;
  };
  const emit = (kind, value) => {
    for (const listener of [...listeners[kind]]) listener(value);
  };

  const scenes = new SceneMap({
    adopt(id) {
      touch(id);
      evict();
    },
    forget(id) {
      const item = entries.get(id);
      if (item && !item.model && !item.gpu) entries.delete(id);
    },
  });

  function pinned() {
    const ids = new Set();
    for (const set of pins.values()) for (const id of set) ids.add(id);
    for (const source of pinSources.values()) {
      for (const id of source() ?? []) if (id) ids.add(id);
    }
    return ids;
  }

  function gpuBytes() {
    let total = 0;
    for (const item of entries.values()) total += item.gpuBytes;
    return total;
  }

  function drop(item) {
    emit('evict', item);
    item.gpu = null;
    item.gpuBytes = 0;
    item.model = null;
    scenes.drop(item.id);
    entries.delete(item.id);
    counters.evictions++;
  }

  function evict() {
    const keep = pinned();
    const unpinned = [...entries.values()].filter(item => !keep.has(item.id))
      .sort((a, b) => a.used - b.used);
    let total = gpuBytes();
    while (unpinned.length > maxUnpinned || (total > maxGpuBytes && unpinned.length)) {
      const item = unpinned.shift();
      total -= item.gpuBytes;
      drop(item);
    }
  }

  const request = (path, options) => {
    if (!fetcher) throw new Error('The scene cache has no fetch configured');
    return fetcher(path, options);
  };

  const cache = {
    scenes,
    configure({ fetch }) {
      fetcher = fetch;
    },
    has: id => entries.has(id),
    entry: id => entries.get(id) ?? null,
    entries: () => [...entries.values()],
    // Draw model for rendering and picking: the payload once loaded, else the
    // JSON-scene adapter.
    model(id) {
      const item = entries.get(id);
      if (item?.model) return item.model;
      return adapterFor(scenes.get(id));
    },
    touch,
    // Stores a draw model (decoded payload) and tells the renderer.
    putModel(id, model) {
      const item = entry(id);
      item.model = model;
      item.drawError = null;
      touch(id);
      emit('model', item);
      evict();
      return model;
    },
    // Fetches, decodes and stores the draw payload (one request per id).
    loadDraw(id, { signal } = {}) {
      const item = entry(id);
      touch(id);
      if (item.model) return Promise.resolve(item.model);
      item.drawLoading ??= (async () => {
        const response = await request(`/api/models/${encodeURIComponent(id)}/draw`, { signal });
        if (!response.ok) throw await failure(response);
        const decoded = decodeDrawPayload(await response.arrayBuffer());
        counters.drawLoads++;
        return cache.putModel(id, drawModel(decoded, { id }));
      })().catch(error => {
        const current = entries.get(id);
        if (current) current.drawError = error;
        throw error;
      }).finally(() => {
        const current = entries.get(id);
        if (current) current.drawLoading = null;
      });
      return item.drawLoading;
    },
    // Loads the compact JSON scene on demand (inspector data).
    loadScene(id, { signal } = {}) {
      if (scenes.has(id)) {
        touch(id);
        return Promise.resolve(scenes.get(id));
      }
      const item = entry(id);
      item.sceneLoading ??= (async () => {
        const response = await request(`/api/models/${encodeURIComponent(id)}`, { signal });
        if (!response.ok) throw await failure(response);
        const scene = await response.json();
        counters.sceneLoads++;
        scenes.set(id, scene);
        return scene;
      })().finally(() => {
        const current = entries.get(id);
        if (current) current.sceneLoading = null;
      });
      return item.sceneLoading;
    },
    bounds: id => entries.get(id)?.model?.bounds ?? scenes.get(id)?.bounds ?? null,
    setGpu(id, gpu, bytes) {
      const item = entry(id);
      item.gpu = gpu;
      item.gpuBytes = gpu ? bytes : 0;
      if (gpu) evict();
    },
    // pin(owner, ids) replaces the owner's pins; pin(owner, []) clears them.
    pin(owner, ids) {
      pins.set(owner, new Set([ids].flat().filter(Boolean)));
      evict();
    },
    unpin(owner) {
      pins.delete(owner);
      evict();
    },
    // pinSource(owner, () => ids): evaluated at every eviction.
    pinSource(owner, source) {
      pinSources.set(owner, source);
      return () => pinSources.delete(owner);
    },
    pinned,
    pins: () => [...pinned()],
    evict,
    onModel(listener) {
      listeners.model.add(listener);
      return () => listeners.model.delete(listener);
    },
    onEvict(listener) {
      listeners.evict.add(listener);
      return () => listeners.evict.delete(listener);
    },
    stats() {
      const keep = pinned();
      const ids = [...entries.keys()];
      return {
        entries: ids.length,
        pinned: ids.filter(id => keep.has(id)).length,
        unpinned: ids.filter(id => !keep.has(id)).length,
        gpuBytes: gpuBytes(),
        withModel: [...entries.values()].filter(item => item.model).length,
        withScene: scenes.size,
        ...counters,
        maxUnpinned,
        maxGpuBytes,
      };
    },
    limits: { maxUnpinned, maxGpuBytes },
  };
  owners.set(scenes, cache);
  return cache;
}
