// Viewer settings with scopes G (global), S (per source) and SB (per source
// and body), stored server-side in <reviews>/viewer-settings.json through
// /api/settings (spec D19). Under the legacy seam (VS) settings live in
// memory only and no request is made.
//
//   settings.get('G', 'editor', 'zed')
//   settings.set('S', 'compare', false, { source })
//   settings.get('SB', 'visible', true, { source, body })
export function createSettings({ api, legacy = false, onError = () => {} }) {
  let document = { schema: 'wonky.viewer-settings/1', global: {}, sources: {}, bodies: {} };
  let loaded = legacy;
  const listeners = new Set();
  // Writes not answered yet. A PUT response is the server document after
  // that write only; overlapping writes are re-applied on top of it, so a
  // late response never undoes a newer local value.
  const pending = new Map();
  let sequence = 0;

  const read = (scope, key, { source, body } = {}) => {
    if (scope === 'G') return document.global[key];
    if (scope === 'S') return document.sources[source]?.[key];
    if (scope === 'SB') return document.bodies[source]?.[body]?.[key];
    throw new Error(`Unknown settings scope ${scope}`);
  };
  const patchFor = (scope, key, value, { source, body } = {}) => {
    if (scope === 'G') return { global: { [key]: value } };
    if (scope === 'S') return { sources: { [source]: { [key]: value } } };
    if (scope === 'SB') return { bodies: { [source]: { [body]: { [key]: value } } } };
    throw new Error(`Unknown settings scope ${scope}`);
  };
  const applyLocally = (scope, key, value, where = {}) => {
    const target = scope === 'G' ? document.global
      : scope === 'S' ? (document.sources[where.source] ??= {})
        : ((document.bodies[where.source] ??= {})[where.body] ??= {});
    if (value === null || value === undefined) delete target[key];
    else target[key] = value;
  };
  const adopt = next => {
    document = next;
    for (const write of pending.values()) {
      applyLocally(write.scope, write.key, write.value, write.where);
    }
  };

  return {
    loaded: () => loaded,
    async load() {
      if (legacy) return document;
      try {
        adopt(await api.json('/api/settings'));
        loaded = true;
        for (const listener of [...listeners]) listener(document);
      } catch (error) {
        onError(error);
      }
      return document;
    },
    get(scope, key, fallback, where) {
      const value = read(scope, key, where);
      return value === undefined ? fallback : value;
    },
    async set(scope, key, value, where) {
      applyLocally(scope, key, value, where);
      for (const listener of [...listeners]) listener(document);
      if (legacy) return document;
      const id = ++sequence;
      pending.set(id, { scope, key, value, where });
      try {
        const next = await api.put('/api/settings', patchFor(scope, key, value ?? null, where));
        pending.delete(id);
        adopt(next);
      } catch (error) {
        pending.delete(id);
        onError(error);
      }
      return document;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    document: () => document,
  };
}
