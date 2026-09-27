// Posts the browser selection to the server (spec 3.7): POST /api/selection
// whenever the multi-selection or the displayed models change, so an agent
// reads "the face Marc selected" with GET /api/selection. Package:
// reviews-context.
//
// Ephemeral and same-origin; the last post from any tab wins. Changes within
// one task are coalesced into one post, and a newer post aborts an older one
// still in flight. Nothing is posted under the legacy seam (VS). A failed
// post never touches #global-error: it is kept in `lastError()` and logged to
// the browser console (fake test environments have none).

// The models on screen: the displayed model, plus the before model in compare.
export const visibleModels = state => [
  ...new Set((state.compare ? [state.after, state.before] : [state.after]).filter(Boolean)),
];

// The body of POST /api/selection: references exactly as selected.
export function selectionPost(state, client) {
  return {
    client,
    references: (state.selectionSet ?? []).map(reference => ({
      modelId: reference.modelId, bodyId: reference.bodyId, entityType: reference.entityType,
      entityIndex: reference.entityIndex,
    })),
    visible: visibleModels(state),
  };
}

const randomClient = env => (env.window?.crypto?.randomUUID?.()
  ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);

const consoleOf = env => {
  const target = env.window?.console;
  return target?.warn ? (...args) => target.warn(...args) : () => {};
};

export function createSelectionShare(ctx, { log = consoleOf(ctx.env) } = {}) {
  const { store, state, api, env } = ctx;
  if (ctx.legacy) return { dispose() {}, flush: async () => null, lastError: () => null };
  const client = randomClient(env);
  let scheduled = false;
  let controller = null;
  let lastError = null;
  let lastKey = null;
  let latest = Promise.resolve(null);

  async function post() {
    const body = selectionPost(state, client);
    const key = JSON.stringify([body.references, body.visible]);
    if (key === lastKey) return null;
    lastKey = key;
    controller?.abort();
    const own = env.AbortController ? new env.AbortController() : null;
    controller = own;
    try {
      const result = await api.post('/api/selection', body, own ? { signal: own.signal } : {});
      lastError = null;
      return result;
    } catch (error) {
      if (own?.signal.aborted) return null;
      lastKey = null;
      if (lastError?.message !== error.message) log('Selection sharing failed:', error.message);
      lastError = error;
      return null;
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      latest = post();
    });
  }
  const stops = [
    store.select(current => current.selection.selectionSet, schedule),
    store.select(current => visibleModels({
      compare: current.compare.compare, after: current.compare.after,
      before: current.compare.before,
    }).join(','), schedule),
  ];
  schedule();
  return {
    dispose: () => stops.forEach(stop => stop()),
    // Resolves with the server's answer to the latest post (tests, QA).
    flush: () => latest,
    lastError: () => lastError,
    client,
  };
}
